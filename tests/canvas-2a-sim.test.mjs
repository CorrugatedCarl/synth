import './v8-guard.mjs';
// Stage 2a on the canvas (docs/canvas/IMPL-2a.md §5, lane D) in the page simulation: the Modulators tiles (a drop / a tap
// adds the module, one History step, the notice undoes it; the singletons greyed), the project Mod Wheel on every track, a
// mod drag onto a Serum knob (a track.mods row whose compile equals the Serum's own WHEEL row), a preset load keeping it,
// the live wheel to a cabled unselected unarmed track (recorded only into the armed targets), the mod layer hosted (the
// inspector's edits one step per gesture, Save with preset / Keep on canvas with the compile unchanged, undo / redo), the
// Mod list's budget, the badge "mods n/64", Delete of the wheel (asked) and of Velocity, Escape.
// The world is canvas-sim's scripted one. One boot per file; strings, numbers and booleans only into assert (never a
// stub DOM node). Run alone: node --max-old-space-size=2048 --test tests/canvas-2a-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CG from '../cv-graph.js?v=9';
import * as CMOD from '../cv-model.js?v=9';
import * as core from '../serum-core.js?v=9';
import { dropRow } from '../serum-ui.js?v=9';
import { MODELS } from '../models.js?v=9';
import { cpOf } from './fixtures/mods-2a.mjs';

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
const api = sim.api, cv = globalThis.__synthTest.cv, sh = globalThis.__synthTest.shell, W = cv.world(), M = cv.mod;
await sim.power(); sim.raf(); await sim.settle(20); sim.raf();
const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), V = () => cv.view();
const hsteps = () => cv.hist.u.length;
const keys = () => [...V().modules.keys()].sort().join(',');
const note = () => sim.$('#notice').textContent;
const tiles = () => sh.shell.tiles;
const MOD = id => MODELS.find(m => m.id === id);
const fresh = (id = 'serum') => { const t = api.addTrack(MOD(id)); sim.raf(); cv.renderViews(); sim.raf(); return t; };
const patches = t => sim.nodeOf(t.id).posted.map(x => x.m).filter(m => m.t === 'patch');
const lastCP = t => { const L = patches(t); return L.length ? cpOf(L[L.length - 1].p) : null; };
const rows = (t = T()) => (t.mods || []).map(r => r.id + ':' + r.src + '>' + r.dst).join(',');
const modCables = () => V().cables.list().filter(c => c.kind === 'mod').map(c => c.id + ':' + c.a + '>' + c.b + (c.preset ? ':preset' : '')).sort().join(',');
const badge = k => { const m = V().modules.get(k); return m ? (m.bar.children.find(c => /cv-badge/.test(c.className || '')) || {}).textContent || '' : null; };
const withConfirm = (ans, fn) => { const was = globalThis.confirm, asked = []; globalThis.confirm = m => { asked.push(String(m)); return ans; }; try { fn(); } finally { globalThis.confirm = was; } return asked; };
const ID = {};

test('a Velocity tile dropped on the canvas adds the module where it lands (one History step, the notice undoes it); its tile greys out; a tap adds it left of the instrument', () => {
  const t = T(), n0 = hsteps();
  ID.a = t.id;
  assert.deepEqual([keys(), tiles().modTiles().length, tiles().placed('velo')], ['i1,i1/fx,out', 4, null]);
  assert.equal(M.drag.drop('velo', { over: 'canvas', x: 200, y: 400, at: { x: -600, y: 300 } }), true); sim.raf();
  assert.deepEqual([keys(), hsteps(), cv.hist.undoLabel, note()], ['i1,i1/fx,out,ve', n0 + 1, 'Add Velocity', 'Added Velocity · tap to undo']);
  assert.deepEqual([t.dev.ve.kind, t.lay.ve.x, t.lay.ve.y], ['velo', -704, 192], 'centred on the drop point, on the dots');
  assert.equal(tiles().placed('velo'), 'already on this track');
  assert.equal(!!api.nodes.get(t.id).graphed, false, 'still a canonical track');
  assert.equal(V().modules.get('ve').kind, 'mod');
  assert.ok(M.bodies.get('ve'), 'its body: the velocity meter');
  sim.$('#notice').onclick(); sim.raf();
  assert.deepEqual([keys(), hsteps(), 've' in T().dev, tiles().placed('velo')], ['i1,i1/fx,out', n0, false, null], 'the notice undid it');
  tiles().modTile('velo').dispatchEvent({ type: 'click' }); sim.raf();
  assert.deepEqual([keys(), hsteps(), T().lay.ve.x, cv.hist.undoLabel], ['i1,i1/fx,out,ve', n0 + 1, -320, 'Add Velocity'], 'a tap: Tidy\'s column, left of the instrument');
  tiles().modTile('velo').dispatchEvent({ type: 'click' }); sim.raf();
  assert.equal(hsteps(), n0 + 1, 'a placed tile adds nothing');
  // its readout: the last velocity of the track
  api.noteOn(60, 0.8, 0); api.noteOff(60, 0);
  assert.equal(M.bodies.get('ve').value(), 0.8);
});

test('the project Mod Wheel: placed from one track (one step "Place Mod Wheel"), it shows on another track\'s view and greys its tile there; Velocity stays per track', () => {
  const n0 = hsteps();
  tiles().modTile('wheel').dispatchEvent({ type: 'click' }); sim.raf();
  assert.deepEqual([keys(), hsteps(), cv.hist.undoLabel, note(), P().perf.wheel ? 1 : 0], ['i1,i1/fx,out,ve,wheel', n0 + 1, 'Place Mod Wheel', 'Added Mod Wheel · tap to undo', 1]);
  assert.deepEqual([tiles().placed('wheel'), T().lay.wheel.x], ['already in this project', -320]);
  const b = fresh('serum');
  ID.b = b.id;
  assert.equal(T().id, b.id);
  assert.deepEqual([keys(), tiles().placed('wheel'), tiles().placed('velo')], ['i1,i1/fx,out,wheel', 'already in this project', null], 'the wheel on the other track; Velocity free there');
  assert.equal(V().modules.get('wheel').kind, 'mod');
  assert.ok(M.bodies.get('wheel'), 'the wheel body');
  assert.deepEqual(cv.menu('wheel').filter(x => !x.sep).map(x => x.label), ['Delete', 'Modulation list…', 'Fold', 'Bring to front', 'Tidy the canvas']);
  assert.deepEqual(cv.menu('i1').filter(x => !x.sep).map(x => x.label), ['About the Serum…', 'Replace with…', 'Modulation list…', 'Fold', 'Bring to front', 'Tidy the canvas']);
});

test('a mod drag from the wheel onto a Serum knob: canMod / markDests from cv-mods destOk; release → one step, a track.mods row, the cable selected; the posted patch\'s matrix equals the same row written by the Serum\'s own addMod', () => {
  const t = T(), n0 = hsteps();
  assert.deepEqual(M.opts.canMod('wheel', 'i1:f.cutoff'), { ok: true, why: '' });
  const mk = M.opts.markDests('wheel');
  assert.deepEqual([mk('i1', 'f.cutoff'), mk('i1', 'a.level'), mk('i1', 'no.such'), mk('out', 'f.cutoff')], [true, true, false, false]);
  assert.equal(M.opts.canMod('wheel', 'i1:no.such').why, 'This knob can\'t be modulated');
  assert.ok(M.cableDrag(), 'the jack hook made with the view');
  M.opts.onMod('wheel', 'i1:f.cutoff'); sim.raf();
  assert.deepEqual([rows(), hsteps(), V().cables.selected()], ['r1:wheel>i1:f.cutoff', n0 + 1, 'r1']);
  assert.match(cv.hist.undoLabel, /^Modulate .+ with Mod Wheel$/);
  assert.equal(modCables(), 'r1:wheel.out>i1:f.cutoff');
  const cp = lastCP(T());
  assert.deepEqual(cp, cpOf(api.buildPatch(T())), 'the posted patch is the injected compile');
  const b = CG.modBudget(T(), 'i1');
  assert.equal(badge('i1'), 'mods ' + (b.preset + 1) + '/64', 'the Serum module\'s badge');
  // the same row through the Serum's own matrix (its WHEEL tile's dropRow, the "Limit mod depth on drop" preference)
  cv.undo(); sim.raf();
  assert.deepEqual([rows(), modCables()], ['', '']);
  let slot = -1;
  api.sxHost(T()).edit(s => { const d = dropRow(s, T().fx, 'wheel', 'f.cutoff', { limit: api.prefs().limitDrop }); slot = d ? d.slot : -1; }); sim.raf();
  assert.ok(slot >= 0);
  assert.deepEqual(lastCP(T()), cp, 'canvas cable ≡ the Serum\'s own row');
  api.sxHost(T()).edit(s => { s.matrix[slot] = core.normRow(null); }); sim.raf();
  cv.redo(); sim.raf();
  assert.deepEqual([rows(), lastCP(T())], ['r1:wheel>i1:f.cutoff', cp], 'redo: the cable and its compile back');
  assert.equal(t.id, T().id);
});

test('refusals: a classic knob is for stage 2b; a release on a refused knob only tells', () => {
  const n0 = hsteps();
  const c = fresh('minimoog');
  assert.equal(M.opts.canMod('wheel', 'i1:fc').why, 'Mod Wheel → Cutoff: this knob can be modulated from stage 2b');
  M.opts.onMod('wheel', 'i1:fc'); sim.raf();
  assert.deepEqual([rows(), hsteps(), note()], ['', n0 + 1, 'Mod Wheel → Cutoff: this knob can be modulated from stage 2b'], '(+1: the new track)');
  M.opts.onRefuse('wheel', 'i1:fc', 'This knob can’t be modulated');
  assert.equal(note(), 'This knob can’t be modulated');
  assert.equal(M.marks()('i1', 'fc'), false, 'no classic knob lights up');
  cv.undo(); sim.raf(); // (the minimoog track goes)
  assert.equal(P().tracks.some(x => x.id === c.id), false);
  api.selectTrack(ID.b); sim.raf(); cv.renderViews(); sim.raf();
  assert.equal(T().id, ID.b);
});

test('a preset load keeps every canvas cable (re-injected) and re-derives the preset cables', () => {
  const t = T(), L = api.sxHost(t).presets.list().filter(p => !p.user);
  const has = p => (api.sxPreset(p.key).v.s.matrix || []).some(r => r && r.src === 'wheel' && r.dst);
  const k = (L.find(has) || L[2]).key;
  api.sxLoad(T(), k); sim.raf();
  assert.equal(rows(), 'r1:wheel>i1:f.cutoff', 'the canvas cable stays');
  assert.deepEqual(lastCP(T()), cpOf(api.buildPatch(T())));
  const inj = CG.injectMods(T().dev.i1, T().mods);
  assert.deepEqual([inj.placed.map(x => x.id), inj.left], [['r1'], []], 'injected into the new preset');
  const pre = CMOD.presetRows(T().dev.i1).filter(r => r.src === 'wheel').map(r => 'p:i1:' + r.slot + ':wheel.out>i1:' + r.dst + ':preset');
  assert.equal(modCables(), ['r1:wheel.out>i1:f.cutoff', ...pre].sort().join(','), 'the preset\'s wheel rows drawn as preset cables');
});

test('the live wheel (the canvas module, the perf tray, ctl) reaches the cabled, unselected, unarmed track; it is recorded only into the armed targets; playback shows the lane on the module', async () => {
  const a = P().tracks.find(x => x.id === ID.a), b = P().tracks.find(x => x.id === ID.b);
  api.selectTrack(a.id); sim.raf(); cv.renderViews(); sim.raf();
  a.arm = true; b.arm = false;
  const na = sim.nodeOf(a.id), nb = sim.nodeOf(b.id), sent = (n, k) => n.posted.filter(x => x.m.t === k).map(x => x.m.v);
  const clear = () => { na.posted.length = 0; nb.posted.length = 0; };
  const w = M.bodies.get('wheel');
  assert.ok(w, 'the wheel on the selected track');
  assert.deepEqual([w.others(), api.wheelTracks().map(x => x.id)], [1, [b.id]], '"+1 on other tracks"');
  clear();
  w.el.children[0].dispatchEvent({ type: 'keydown', key: 'End', preventDefault() {}, stopPropagation() {} }); // (the module's wheel, by keys)
  assert.deepEqual([sent(na, 'wheel'), sent(nb, 'wheel')], [[1], [1]], 'the module → ctl: the selected and the cabled track');
  clear(); api.ctl('wheel', 0.25, 0);
  assert.deepEqual([sent(na, 'wheel'), sent(nb, 'wheel'), w.value()], [[0.25], [0.25], 0.25], 'the perf tray / MIDI wheel moves the module');
  // recording: into the armed target only
  const Tr = api.transport();
  P().metronome.countIn = 0; P().metronome.on = false;
  sim.$('#tPlay').click(); await sim.settle(2);
  sim.$('#tRec').click();
  assert.equal(Tr.rec, true);
  sim.run(4800); sim.raf();
  const nb0 = b.cc.length;
  clear(); api.ctl('wheel', 0.4, 0, sim.ms);
  assert.deepEqual([sent(na, 'wheel'), sent(nb, 'wheel')], [[0.4], [0.4]]);
  assert.ok(a.cc.some(c => c.k === 'wheel' && c.v === 0.4), 'recorded into the armed target');
  assert.equal(b.cc.length, nb0, 'not into the cabled track');
  w.update(0); sim.raf();
  assert.equal(w.value(), 0.4, 'playing: the module shows the selected track\'s lane');
  sim.$('#tRec').click(); sim.$('#tPlay').click();
  a.arm = false;
  a.cc = a.cc.filter(c => c.k !== 'wheel');
  api.selectTrack(b.id); sim.raf(); cv.renderViews(); sim.raf();
});

const walk = (n, f, out = []) => { for (const c of n.children || []) { if (f(c)) out.push(c); walk(c, f, out); } return out; };
const pop = () => walk(sim.$('#ov'), c => /\bcv-ml-pop\b/.test(c.className || '')).pop() || null;
const inPop = f => { const p = pop(); return p ? walk(p, f) : []; };
const ev = (type, o) => Object.assign({ type, preventDefault() {}, stopPropagation() {} }, o || {});

test('the inspector (a badge\'s tap): amount, bipolar, bypass — one History step each gesture, live on the patch; undo / redo of each; Escape closes it', async () => {
  const t = T(), n0 = hsteps(), amt0 = t.mods[0].amt;
  M.sel('r1'); await Promise.resolve();
  assert.equal(M.layer().isOpen(), true, 'opened by the badge');
  assert.ok(pop(), 'its popover in #ov');
  const sl = inPop(c => /\bwk-sl\b/.test(c.className || ''))[0];
  sl.dispatchEvent(ev('keydown', { key: 'PageUp', target: sl }));
  sim.raf();
  const amt1 = T().mods[0].amt;
  assert.deepEqual([hsteps(), cv.hist.undoLabel, Math.round((amt1 - amt0) * 100)], [n0 + 1, 'Mod amount', 20], 'one step');
  assert.ok(lastCP(T()).mAmt.some(x => Math.abs(x - amt1) < 1e-9), 'the patch follows');
  const tog = lab => inPop(c => c.attrs && c.attrs['aria-label'] === lab)[0];
  tog('Bipolar').dispatchEvent(ev('click')); sim.raf();
  assert.deepEqual([hsteps(), cv.hist.undoLabel, T().mods[0].bi], [n0 + 2, 'Mod polarity', 1]);
  tog('Bypass').dispatchEvent(ev('click')); sim.raf();
  assert.deepEqual([hsteps(), cv.hist.undoLabel, T().mods[0].byp], [n0 + 3, 'Mod bypass', 1]);
  // the host as the layer drives it: live edits per move, one step at the gesture's end
  const H = M.host();
  H.edit('r1', { curve: 0.1 }); H.edit('r1', { curve: 0.3 }); H.step('Mod curve'); sim.raf();
  assert.deepEqual([hsteps(), cv.hist.undoLabel, T().mods[0].curve], [n0 + 4, 'Mod curve', 0.3]);
  cv.undo(); sim.raf();
  assert.deepEqual([T().mods[0].curve, T().mods[0].byp], [0, 1]);
  cv.undo(); cv.undo(); cv.undo(); sim.raf();
  assert.deepEqual([T().mods[0].amt, T().mods[0].bi, T().mods[0].byp, hsteps()], [amt0, 0, 0, n0]);
  cv.redo(); cv.redo(); cv.redo(); sim.raf();
  assert.deepEqual([T().mods[0].amt, T().mods[0].bi, T().mods[0].byp], [amt1, 1, 1]);
  assert.equal(M.layer().isOpen(), true, 'still open after undo / redo (synced)');
  sim.key('Escape', true, { key: 'Escape' });
  assert.equal(M.layer().isOpen(), false, 'Escape closes it');
  H.edit('r1', { byp: 0, bi: 0 }); H.step('Mod bypass'); sim.raf();
});

test('Save with preset moves the row into s.matrix (the compile unchanged), Keep on canvas brings it back; each one step, undo / redo keep the two sides consistent', async () => {
  const cp = lastCP(T()), n0 = hsteps();
  const perfRows = () => CMOD.presetRows(T().dev.i1).filter(r => r.src === 'wheel' && r.dst === 'f.cutoff').map(r => r.slot);
  assert.deepEqual(perfRows(), [], 'no such preset row yet');
  M.sel('r1'); await Promise.resolve();
  const save = inPop(c => c.attrs && c.attrs['data-act'] === 'save')[0];
  assert.equal(save.disabled, false);
  save.dispatchEvent(ev('click')); sim.raf();
  const slot = perfRows()[0];
  assert.deepEqual([rows(), perfRows().length, hsteps(), cv.hist.undoLabel, M.layer().isOpen()], ['', 1, n0 + 1, 'Save with preset', false]);
  assert.deepEqual(lastCP(T()), cp, 'the compile unchanged');
  assert.ok(modCables().includes('p:i1:' + slot + ':wheel.out>i1:f.cutoff:preset'), 'now a preset cable');
  assert.notEqual(badge('i1').slice(0, 4), 'mods', 'no canvas rows: no "mods" badge');
  cv.undo(); sim.raf();
  assert.deepEqual([rows(), perfRows(), lastCP(T())], ['r1:wheel>i1:f.cutoff', [], cp], 'undo: on the canvas again, the slot freed');
  cv.redo(); sim.raf();
  assert.deepEqual([rows(), perfRows(), lastCP(T())], ['', [slot], cp], 'redo');
  // Keep on canvas (the preset cable's inspector)
  M.sel('p:i1:' + slot); await Promise.resolve();
  const keep = inPop(c => c.attrs && c.attrs['data-act'] === 'keep')[0];
  assert.ok(keep, 'a preset row: Keep on canvas');
  keep.dispatchEvent(ev('click')); sim.raf();
  assert.deepEqual([rows(), perfRows(), hsteps(), cv.hist.undoLabel, lastCP(T())], ['r2:wheel>i1:f.cutoff', [], n0 + 2, 'Keep on canvas', cp]);
  cv.undo(); sim.raf();
  assert.deepEqual([rows(), perfRows(), lastCP(T())], ['', [slot], cp]);
  cv.redo(); sim.raf();
  assert.deepEqual([rows(), perfRows(), lastCP(T())], ['r2:wheel>i1:f.cutoff', [], cp]);
});

test('the Mod list: every row by Serum with its budget n/64 (as the badge and the compile); Escape closes it', () => {
  const t = T();
  cv.menu('i1').find(x => x.label === 'Modulation list…').action();
  assert.equal(M.layer().isOpen(), true);
  const sheet = walk(sim.$('#ov'), c => /\bcv-ml-list\b/.test(c.className || '')).pop();
  const b = CG.modBudget(t, 'i1'), txt = walk(sheet, c => /\bcv-ml-b\b/.test(c.className || '')).map(c => c.textContent);
  assert.deepEqual(txt, [(b.preset + b.canvas) + '/64']);
  assert.equal(badge('i1'), 'mods ' + (b.preset + b.canvas) + '/64', 'the badge agrees');
  const lines = walk(sheet, c => /\bcv-ml-line\b/.test(c.className || '')).map(c => c.attrs['data-row'] || 'slot' + c.attrs['data-slot']);
  assert.equal(lines[0], 'r2', 'the canvas row first, then the preset rows');
  assert.equal(lines.length, 1 + CMOD.presetRows(t.dev.i1).length);
  sim.key('Escape', true, { key: 'Escape' });
  assert.equal(M.layer().isOpen(), false);
});

test('the parameter list (a jack tap / a drop on the Serum\'s bar): a pick connects, one step', () => {
  const n0 = hsteps(), r0 = rows();
  M.opts.onJackTap('wheel', null);
  assert.equal(M.layer().isOpen(), true);
  const H = M.host();
  assert.equal(H.connect('wheel', 'i1:f.res').ok, true); H.step('Modulate Res with Mod Wheel'); sim.raf();
  assert.deepEqual([rows(), hsteps(), cv.hist.undoLabel], [r0 + ',r3:wheel>i1:f.res', n0 + 1, 'Modulate Res with Mod Wheel']);
  M.layer().close();
  const d = M.descs('i1');
  assert.ok(d.some(x => x.id === 'f.cutoff' && x.group) && d.some(x => /^fx\./.test(x.id)), 'grouped as destMenu, its own FX too');
  M.opts.onBarDrop('wheel', 'i1');
  assert.equal(M.layer().isOpen(), true);
  M.layer().close();
  cv.undo(); sim.raf();
  assert.equal(rows(), r0);
});

test('Delete: Velocity (its rows) one step; the Mod Wheel asks "Remove the Mod Wheel and its N cables on M tracks?" and removes the rows on every track; undo brings all back', () => {
  const a = () => P().tracks.find(x => x.id === ID.a);
  api.selectTrack(ID.a); sim.raf(); cv.renderViews(); sim.raf();
  M.opts.onMod('ve.out', 'i1:a.level'); sim.raf();
  M.opts.onMod('wheel', 'i1:f.cutoff'); sim.raf();
  assert.deepEqual(a().mods.map(r => r.src), ['ve.out', 'wheel']);
  const n0 = hsteps();
  M.del('ve'); sim.raf();
  assert.deepEqual([keys().includes('ve'), a().mods.map(r => r.src), hsteps(), cv.hist.undoLabel], [false, ['wheel'], n0 + 1, 'Delete Velocity']);
  cv.undo(); sim.raf();
  assert.deepEqual([keys().includes('ve'), a().mods.map(r => r.src)], [true, ['ve.out', 'wheel']]);
  assert.equal(CMOD.wheelRows(P()).byTrack.length, 2);
  let asked = withConfirm(false, () => cv.menu('wheel').find(x => x.label === 'Delete').action());
  assert.deepEqual([asked, hsteps(), CMOD.hasWheel(P())], [['Remove the Mod Wheel and its 2 cables on 2 tracks?'], n0, true], 'declined: nothing');
  const b = P().tracks.find(x => x.id === ID.b), k0 = patches(b).length;
  asked = withConfirm(true, () => cv.menu('wheel').find(x => x.label === 'Delete').action()); sim.raf();
  assert.deepEqual([asked.length, hsteps(), cv.hist.undoLabel, CMOD.hasWheel(P()), keys().includes('wheel')], [1, n0 + 1, 'Delete Mod Wheel', false, false]);
  assert.deepEqual([a().mods.map(r => r.src), P().tracks.find(x => x.id === ID.b).mods.length, tiles().placed('wheel')], [['ve.out'], 0, null]);
  assert.ok(patches(b).length > k0, 'the other track recompiled');
  cv.undo(); sim.raf();
  assert.deepEqual([CMOD.hasWheel(P()), CMOD.wheelRows(P()).byTrack.length, keys().includes('wheel')], [true, 2, true]);
});

test('visibility: the toolbar ∿ mode reaches the view', () => {
  W.setModsMode('never');
  assert.equal(V().cables.modsVisible(), 'never');
  W.setModsMode('always');
  assert.equal(V().cables.modsVisible(), 'always');
});

// host fixes (the 2a review round, findings H1–H9: History of Save with preset / Keep on canvas, refusals, the limit on
// drop, Replace, the budget, slots, Duplicate, the render paths)
const perfOf = t => t.dev.i1.vals.s.matrix.map((r, i) => (r && r.src && CMOD.SRC_MOD[r.src] ? i + ':' + r.src + '>' + r.dst + '@' + r.amt : null)).filter(Boolean).join(' ');
const byId = id => P().tracks.find(x => x.id === id);
const pick = t => { api.selectTrack(t.id); sim.raf(); cv.renderViews(); sim.raf(); };
const wheelOn = () => { if (!CMOD.hasWheel(P())) { M.add('wheel', null); sim.raf(); } };
const compiled = (t, src, dst) => { const c = cpOf(api.buildPatch(t)); let n = 0; for (let i = 0; i < c.mN; i++) if (c.mSrc[i] === src && c.mDst[i] === dst) n++; return n; };

test('H1: undo / redo of Save with preset / Keep on canvas move only that row in its slot — Serum edits since (its own matrix, another track\'s) stay', () => {
  wheelOn();
  const a = fresh(), b = fresh();
  api.sxHost(b).edit(s => { core.addMod(s, b.fx, 'wheel', 'f.res', { amt: 0.3 }); }); sim.raf();
  pick(a);
  M.opts.onMod('wheel', 'i1:f.cutoff'); sim.raf();
  const id = T().mods[0].id, H = M.host();
  assert.equal(H.toPreset(id).ok, true); H.step('Save with preset'); sim.raf();
  const saved = perfOf(T());
  assert.match(saved, /^0:wheel>f\.cutoff@/);
  assert.equal(rows(), '');
  api.sxHost(T()).edit(s => { core.addMod(s, T().fx, 'wheel', 'a.level', { amt: 0.4 }); }); sim.raf();
  api.sxHost(byId(b.id)).edit(s => { const i = s.matrix.findIndex(r => r.src === 'wheel' && r.dst === 'f.res'); s.matrix[i] = Object.assign({}, s.matrix[i], { amt: 0.9 }); }); sim.raf();
  assert.deepEqual([perfOf(T()), perfOf(byId(b.id))], [saved + ' 1:wheel>a.level@0.4', '0:wheel>f.res@0.9']);
  cv.undo(); sim.raf();
  assert.deepEqual([rows(), perfOf(T()), perfOf(byId(b.id))], [id + ':wheel>i1:f.cutoff', '1:wheel>a.level@0.4', '0:wheel>f.res@0.9'], 'undo: the saved row back on the canvas, nothing else');
  assert.equal(compiled(T(), 1, 42), 1, 'compiled once');
  cv.redo(); sim.raf();
  assert.deepEqual([rows(), perfOf(T()), perfOf(byId(b.id))], ['', saved + ' 1:wheel>a.level@0.4', '0:wheel>f.res@0.9'], 'redo');
  // Keep on canvas: its undo puts the row back into its slot while that is free
  assert.equal(H.fromPreset('i1', 0).ok, true); H.step('Keep on canvas'); sim.raf();
  const kid = T().mods[0].id;
  assert.deepEqual([rows(), perfOf(T())], [kid + ':wheel>i1:f.cutoff', '1:wheel>a.level@0.4']);
  cv.undo(); sim.raf();
  assert.deepEqual([rows(), perfOf(T())], ['', saved + ' 1:wheel>a.level@0.4']);
  cv.redo(); sim.raf();
  assert.deepEqual([rows(), perfOf(T()), compiled(T(), 1, 42)], [kid + ':wheel>i1:f.cutoff', '1:wheel>a.level@0.4', 1]);
  // its slot taken since (a Serum edit): the undo leaves the matrix alone and says so
  api.sxHost(T()).edit(s => { core.addMod(s, T().fx, 'wheel', 'f.res', { amt: 0.2 }); }); sim.raf();
  assert.equal(perfOf(T()), '0:wheel>f.res@0.2 1:wheel>a.level@0.4');
  cv.undo(); sim.raf();
  assert.deepEqual([rows(), perfOf(T())], ['', '0:wheel>f.res@0.2 1:wheel>a.level@0.4']);
  assert.match(note(), /slot 1\b/);
});

test('H1: Save with preset, another preset loaded, Undo — the loaded preset\'s matrix untouched; the cable back on the canvas', () => {
  wheelOn();
  pick(fresh());
  const L = api.sxHost(T()).presets.list().filter(p => !p.user), mx = p => api.sxPreset(p.key).v.s.matrix || [];
  const pW = L.find(p => mx(p).some(r => r && r.src === 'wheel' && r.dst));
  const ks = mx(pW).map((r, i) => (r && r.src && CMOD.SRC_MOD[r.src] ? i : -1)).filter(i => i >= 0);
  const pN = L.find(p => p !== pW && ks.some(k => !(mx(p)[k] && mx(p)[k].src)));
  api.sxLoad(T(), pW.key); sim.raf();
  M.opts.onMod('wheel', 'i1:f.res'); sim.raf();
  const id = T().mods[0].id;
  M.host().toPreset(id); M.host().step('Save with preset'); sim.raf();
  api.sxLoad(T(), pN.key); sim.raf();
  const N = JSON.stringify(T().dev.i1.vals.s.matrix);
  cv.undo(); sim.raf();
  assert.deepEqual([rows(), JSON.stringify(T().dev.i1.vals.s.matrix) === N], [id + ':wheel>i1:f.res', true]);
});

test('H2: the move is read from the step actually undone (a no-op step above Save with preset); refusals and edits that changed nothing leave no step', () => {
  wheelOn();
  pick(fresh());
  M.opts.onMod('wheel', 'i1:f.cutoff'); sim.raf();
  const H = M.host(), id = T().mods[0].id;
  H.toPreset(id); H.step('Save with preset'); sim.raf();
  cv.hist.record(P(), 'Tidy'); // (a step that changed nothing: Tidy on a tidy canvas)
  cv.undo(); sim.raf();
  assert.deepEqual([rows(), perfOf(T()), compiled(T(), 1, 42)], [id + ':wheel>i1:f.cutoff', '', 1], 'the slot taken back: compiled once');
  cv.redo(); sim.raf();
  assert.deepEqual([rows(), compiled(T(), 1, 42)], ['', 1]);
  assert.match(perfOf(T()), /^0:wheel>f\.cutoff@/);
  // refusals after the step was opened: none left behind
  const n0 = hsteps(), top = cv.hist.undoLabel;
  assert.equal(H.fromPreset('i1', 5).ok, false, 'no row there');
  assert.equal(H.toPreset('r99').ok, false);
  const pf = P().perf; P().perf = { wheel: null }; // (the wheel gone: canMod passes, addMod refuses the source)
  try {
    assert.equal(H.connect('wheel', 'i1:f.res').ok, false);
    assert.equal(M.connect('wheel', 'i1:f.res'), null);
  } finally { P().perf = pf; }
  assert.deepEqual([hsteps(), cv.hist.undoLabel], [n0, top], 'no step from a refusal');
  // a gesture that changed nothing
  M.opts.onMod('wheel', 'i1:f.res'); sim.raf();
  const n1 = hsteps(), lab = cv.hist.undoLabel, rid = T().mods[0].id;
  H.edit(rid, { amt: T().mods[0].amt }); H.step('Mod amount'); sim.raf();
  assert.deepEqual([hsteps(), cv.hist.undoLabel], [n1, lab]);
});

test('H7: a canvas drop follows the Serum\'s "Limit mod depth on drop" — off: the row its WHEEL tile writes with limit 0 (the drag and the parameter list)', () => {
  wheelOn();
  pick(fresh());
  const fx = T().fx, amt = (dst, limit) => { const s = Object.assign({}, T().dev.i1.vals.s, { matrix: [{ src: '' }] }); core.addMod(s, fx, 'wheel', dst, { limit }); return s.matrix[0].amt; };
  const dst = ['a.level', 'f.cutoff', 'a.vol', 'f.res', 'f.drive'].find(d => { try { return amt(d, true) !== amt(d, false); } catch { return false; } });
  assert.ok(dst, '(a knob whose limited drop amount differs)');
  const was = api.store.get('synth.sx.prefs', null);
  api.store.set('synth.sx.prefs', Object.assign({}, was || {}, { limitDrop: 0 })); api.prefsChanged();
  try {
    assert.equal(api.prefs().limitDrop, 0);
    M.opts.onMod('wheel', 'i1:' + dst); sim.raf();
    const cp = lastCP(T());
    cv.undo(); sim.raf();
    let slot = -1;
    api.sxHost(T()).edit(s => { slot = dropRow(s, T().fx, 'wheel', dst, { limit: 0 }).slot; }); sim.raf();
    assert.deepEqual(lastCP(T()), cp, 'the drag ≡ the WHEEL tile, limit off');
    api.sxHost(T()).edit(s => { s.matrix[slot] = core.normRow(null); }); sim.raf();
    assert.equal(M.host().connect('wheel', 'i1:' + dst).ok, true); M.host().step('Modulate'); sim.raf();
    assert.deepEqual(lastCP(T()), cp, 'the parameter list ≡ the WHEEL tile, limit off');
    cv.undo(); sim.raf();
  } finally { api.store.set('synth.sx.prefs', was || {}); api.prefsChanged(); }
});

test('H4: replacing a Serum that has cables with a classic synth says the cables went (Replace with…, setTrackModel); undo brings them back', () => {
  wheelOn();
  pick(fresh());
  M.opts.onMod('wheel', 'i1:f.cutoff'); sim.raf(); M.opts.onMod('wheel', 'i1:f.res'); sim.raf();
  const r0 = rows(), TXT = '2 modulation cables to the Serum removed: classic knobs take modulation from stage 2b';
  assert.equal(r0.split(',').length, 2);
  cv.drop('minimoog', null); sim.raf();
  assert.deepEqual([T().model, rows()], ['minimoog', '']);
  assert.ok(note().includes(TXT), note());
  cv.undo(); sim.raf();
  assert.deepEqual([T().model, rows()], ['serum', r0]);
  cv.setTrackModel(T(), 'juno60'); sim.raf();
  assert.deepEqual([T().model, rows(), note()], ['juno60', '', TXT]);
  cv.undo(); sim.raf();
  assert.deepEqual([T().model, rows()], ['serum', r0]);
});

test('H8: a preset of 64 rows loaded over a canvas cable — the badge says "1 not compiled" as the Mod list and the compile do; the load says so', () => {
  wheelOn();
  pick(fresh());
  const X = api.sxHost(T());
  X.edit(s => { for (let k = 0; k < 64; k++) s.matrix[k] = core.normRow({ src: 'lfo1', amt: (k + 1) / 100, dst: 'f.cutoff' }); }); sim.raf();
  X.presets.save({ name: 'Full 64', cat: 'User' });
  X.edit(s => { for (let k = 0; k < 64; k++) s.matrix[k] = core.normRow(null); }); sim.raf();
  M.opts.onMod('wheel', 'i1:f.res'); sim.raf();
  const id = T().mods[0].id;
  assert.equal(badge('i1'), 'mods 1/64');
  api.sxLoad(T(), 'u:Full 64'); sim.raf();
  const b = CG.modBudget(T(), 'i1'), cp = lastCP(T());
  assert.deepEqual([b.preset, b.canvas, b.left, rows()], [64, 0, [id], id + ':wheel>i1:f.res']);
  assert.deepEqual([cp.mN, cp.mSrc.includes(1)], [64, false], 'the compile: the preset\'s 64 rows, not the cable');
  assert.equal(badge('i1'), 'mods 64/64 · 1 not compiled');
  assert.match(note(), /full \(64\/64\).*1 modulation cable not compiled/);
  cv.menu('i1').find(x => x.label === 'Modulation list…').action();
  const sheet = walk(sim.$('#ov'), c => /\bcv-ml-list\b/.test(c.className || '')).pop();
  assert.deepEqual(walk(sheet, c => /\bcv-ml-b\b/.test(c.className || '')).map(c => c.textContent), ['64/64 · 1 not compiled'], 'the Mod list agrees');
  M.layer().close();
});

test('H6: Duplicate track copies the row-id counter (mid) — a deleted row\'s id is never reused on the copy', () => {
  wheelOn();
  pick(fresh());
  M.opts.onMod('wheel', 'i1:f.cutoff'); sim.raf(); M.opts.onMod('wheel', 'i1:f.res'); sim.raf();
  const [r1, r2] = T().mods.map(r => r.id), mid = T().mid;
  M.host().remove(r2); M.host().step('Disconnect'); sim.raf();
  assert.deepEqual(T().mods.map(r => r.id), [r1]);
  cv.duplicateTrack(T()); sim.raf();
  const c = P().tracks[P().tracks.indexOf(T()) + 1];
  assert.deepEqual([c.mods.map(r => r.id), c.mid], [[r1], mid]);
  assert.notEqual(CMOD.addMod(c, 'wheel', 'i1:a.level', { project: P() }).row.id, r2);
});

test('H9: a panel\'s knob (the effects a classic synth feeds) is refused "…from stage 2b": no row, no step', () => {
  wheelOn();
  const c = fresh('juno60'), n0 = hsteps(), pid = Object.keys(c.dev).find(k => c.dev[k].kind === 'panel');
  assert.ok(pid, '(a classic track: its panel)');
  const why = M.opts.canMod('wheel', pid + ':fx.dly.mix');
  assert.equal(why.ok, false);
  assert.match(why.why, /^Mod Wheel → .+: this knob can be modulated from stage 2b$/);
  assert.equal(M.marks()(pid, 'fx.dly.mix'), false, 'not lit');
  M.opts.onMod('wheel', pid + ':fx.dly.mix'); sim.raf();
  assert.deepEqual([rows(), hsteps(), note()], ['', n0, why.why]);
});

// UI fixes
const U = globalThis.__synthTest.modUI;
test('(U8, U9) a tapped modulator: Tidy\'s column at x −320, in its MOD_ORDER slot when nothing stands there (else below the column); off screen, the camera brings it in (focusItem, no edit)', () => {
  const c = fresh('serum'), foc = [], f0 = W.focusItem;
  ID.c = c.id;
  W.focusItem = (id, o) => foc.push(id + ' ' + JSON.stringify(o));
  try {
    W.setCamera({ tx: 1000, ty: 0, k: 1 }); // (the column in view)
    tiles().modTile('at').dispatchEvent({ type: 'click' }); sim.raf();
    assert.deepEqual([T().lay.at, V().modules.get('wheel').x, foc], [{ x: -320, y: 288 }, -320, []], 'below the wheel (its slot), in view: no camera move');
    W.setCamera({ tx: 0, ty: 0, k: 1 }); // (x −320 left of the band)
    tiles().modTile('bend').dispatchEvent({ type: 'click' }); sim.raf();
    assert.deepEqual([T().lay.bd, foc], [{ x: -320, y: 480 }, ['bd {"k":1,"edit":false}']], 'its slot after the wheel and Aftertouch; brought in');
    M.del('at'); sim.raf();
    tiles().modTile('velo').dispatchEvent({ type: 'click' }); sim.raf();
    assert.deepEqual(T().lay.ve, { x: -320, y: 288 }, 'Velocity\'s slot (after the wheel) is free: there, not below Bend');
    tiles().modTile('at').dispatchEvent({ type: 'click' }); sim.raf();
    assert.deepEqual(T().lay.at, { x: -320, y: 672 }, 'Aftertouch\'s slot (544) is taken by Bend: below the column');
    assert.equal(cvTidyX(), -320, 'Tidy agrees');
  } finally { W.focusItem = f0; }
});
const cvTidyX = () => { cv.tidy(); sim.raf(); return T().lay.ve.x; };

test('(U10) the 24+ hint shows once a session, not again on each track switch', () => {
  const t = T(), was = t.mods;
  const dst = ['f.cutoff', 'f.res', 'a.level', 'a.pan', 'b.level', 'b.pan', 'a.semi', 'b.semi', 'a.fine', 'b.fine'];
  t.mods = Array.from({ length: 26 }, (_, i) => ({ id: 'h' + i, src: i % 2 ? 'wheel' : 've.out', dst: 'i1:' + dst[i % dst.length], amt: 0.1 }));
  t.mid = 100;
  sim.$('#notice').textContent = '';
  cv.render(); sim.raf();
  assert.equal(note(), '24+ mod cables, tap ∿ to filter');
  sim.$('#notice').textContent = '';
  api.selectTrack(ID.a); sim.raf(); cv.renderViews(); sim.raf();
  api.selectTrack(t.id); sim.raf(); cv.renderViews(); sim.raf();
  assert.equal(note(), '', 'a new view: no hint again');
  t.mods = was; cv.render(); sim.raf();
});

test('(U12) a layer gesture that ended where it began drops the step its first edit opened (no no-op step on the undo stack)', () => {
  M.opts.onMod('wheel', 'i1:f.cutoff'); sim.raf();
  const id = T().mods.at(-1).id, n0 = hsteps(), L0 = cv.hist.undoLabel, a0 = T().mods.at(-1).amt;
  const H = M.host();
  H.edit(id, { amt: 0.9 }); H.edit(id, { amt: a0 });
  assert.equal(hsteps(), n0 + 1, 'the step its first edit opened');
  H.cancel(); sim.raf();
  assert.deepEqual([hsteps(), cv.hist.undoLabel, T().mods.at(-1).amt], [n0, L0, a0]);
  H.cancel();
  assert.equal(hsteps(), n0, 'nothing open: nothing dropped');
});

test('(U13) during playback the modulator bodies follow the lanes only on screen (a folded wheel waits); the lane value = perfValue\'s (sorted points, the later of equal ticks, binary search)', async () => {
  const t = T(), w = M.bodies.get('wheel');
  assert.ok(w, 'the wheel on this track');
  const was = t.cc;
  t.cc = [{ t: 960, k: 'wheel', v: 0.6 }, { t: 0, k: 'wheel', v: 0.1 }, { t: 480, k: 'wheel', v: 0.3 }, { t: 480, k: 'wheel', v: 0.35 }, { t: 0, k: 'bend', v: -0.5 }];
  P().metronome.countIn = 0; P().metronome.on = false;
  sim.$('#tPlay').click(); await sim.settle(2);
  const seen = [];
  for (let i = 0; i < 12; i++) { sim.run(4800); sim.raf(); seen.push([U.lane('wheel', t), api.perfValue('wheel', t)]); }
  assert.ok(seen.every(([a, b]) => a === b), 'the same as perfValue: ' + JSON.stringify(seen));
  assert.ok(new Set(seen.map(x => x[0])).size >= 2, 'the playhead crossed points: ' + JSON.stringify(seen));
  assert.equal(U.lane('bend', t), -0.5);
  V().toggleFold('wheel');
  w.update(0.999); sim.run(4800); sim.raf();
  assert.equal(w.value(), 0.999, 'folded (not live): not updated per frame');
  V().toggleFold('wheel');
  sim.raf();
  assert.equal(w.value(), api.perfValue('wheel', t), 'live again');
  sim.$('#tPlay').click();
  t.cc = was;
});

test('(U14) "+N on other tracks" lists the tracks with their wheel cables; a pick shows that track\'s wheel', () => {
  const B = CMOD.wheelRows(P()).byTrack.filter(x => x.trackId !== T().id);
  assert.ok(B.length >= 2, 'two other tracks with wheel cables');
  const items = U.jumpItems();
  assert.deepEqual(items.map(x => x.label), B.map(x => P().tracks.find(y => y.id === x.trackId).name + ' · ' + x.rows.length + ' cable' + (x.rows.length === 1 ? '' : 's')));
  const foc = [], f0 = W.focusItem;
  W.focusItem = (id, o) => foc.push(id);
  try { items[1].action(); sim.raf(); } finally { W.focusItem = f0; }
  assert.deepEqual([T().id, foc.at(-1)], [B[1].trackId, 'wheel']);
  api.selectTrack(ID.c); sim.raf(); cv.renderViews(); sim.raf();
});

test('(U15) the cable\'s long-press menu: Edit…, Bypass (checked when bypassed; a canvas row one step "Mod bypass", a preset row the Serum\'s own edit)', () => {
  const r = T().mods.at(-1), n0 = hsteps();
  let L = M.cmenu(r.id);
  assert.deepEqual(L.map(x => x.label + (x.checked ? ' ✓' : '')), ['Edit…', 'Bypass']);
  L[1].action(); sim.raf();
  assert.deepEqual([T().mods.at(-1).byp, hsteps(), cv.hist.undoLabel], [1, n0 + 1, 'Mod bypass']);
  assert.deepEqual(M.cmenu(r.id).map(x => x.label + (x.checked ? ' ✓' : '')), ['Edit…', 'Bypass ✓']);
  cv.undo(); sim.raf();
  assert.equal(T().mods.at(-1).byp, 0, 'undo');
  // a preset row: the Serum's matrix (no step of its own)
  const pr = V().cables.list().find(c => c.kind === 'mod' && c.preset);
  if (pr) {
    const n1 = hsteps();
    M.cmenu(pr.id)[1].action(); sim.raf();
    assert.deepEqual([T().dev.i1.vals.s.matrix[pr.slot].byp, hsteps()], [pr.byp ? 0 : 1, n1]);
    M.cmenu(pr.id)[1].action(); sim.raf();
  }
});
