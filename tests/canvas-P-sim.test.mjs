import './v8-guard.mjs';
// Stage P lane H (docs/canvas/IMPL-P.md §2, §6 row H, §7 H): the performance preset in the page simulation — ⚙ → Canvas's
// Performance line (High · Medium · Low, High on a fresh device: no detection), a device pref (synthc.cv.perf) never in the
// project or its History, applied live through the world (cv-world setPerf → cv-face's texture density + the cords' physics)
// with no worklet message (D1), ?perf= over it for the session (shown, never stored); the heavy notices' lines the same at every
// preset (§1.4); and the lifted bounds through the host (§3.1) — a System 55 + 30 modules greys no tile, a full track's add says
// why (never a silent null), a module numbered past 9 999 still binds its sequencer and posts its events (skeptic #1: the
// host's two binds, PT.isMid). Accessor-free (a guard build: instruments read as devices, cv-model instOf); the real cv-world
// on the stub DOM (its cord layer on the SVG path: no WebGL in node), the real engine; strings, numbers and booleans only
// into assert (never a stub DOM node). Run alone: node --max-old-space-size=2048 --test tests/canvas-P-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CMOD from '../cv-model.js?v=9';
import * as PT from '../patch-core.js?v=9';
import * as cvWorld from '../cv-world.js?v=9';
import * as cvTray from '../cv-tray.js?v=9';
import * as FACES from '../cv-face.js?v=9';
import { MODELS } from '../models.js?v=9';

const KEY = 'synthc.cv.perf'; // (store's synth.cv.perf in the app namespace, JSON)
const ls = fakeStorage({});
const sim = await bootMain({ ls, hash: '#m900' });
{ // (a Serum's / an LFO's graph editors animate through wk.ticker, which asks getClientRects: the stub DOM's elements answer one box — canvas-2b-sim's)
  const ce = globalThis.document.createElement;
  globalThis.document.createElement = tag => { const e = ce(tag); e.getClientRects = () => [{}]; return e; };
  const cn = globalThis.document.createElementNS;
  globalThis.document.createElementNS = (ns, tag) => { const e = cn(ns, tag); e.getClientRects = () => [{}]; return e; };
}
const api = sim.api, cv = globalThis.__synthTest.cv, sh = globalThis.__synthTest.shell;
await sim.power(); sim.raf(); await sim.settle(5); sim.raf();

const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), I = (t, dev) => CMOD.instOf(t, dev);
const dev = (t = T()) => CMOD.primId(t), rec = (t = T()) => cv.patchOf(t, dev(t));
const note = () => sim.$('#notice').textContent;
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };
const sel = () => sh.shell.perfSel;
const pick = v => { sel().value = v; sel().onchange({ type: 'change', target: sel() }); };
const W = () => cv.world();
const look = () => ({ sel: sel().value, world: W().perf, faces: FACES.FACES.perf, cords: cv.cords().stats().quality, stored: ls.getItem(KEY) });
const node = t => sim.nodeOf(t.id), sent = (t, k) => node(t).posted.map(x => x.m).filter(m => m.t === k);

test('⚙ → Canvas: the Performance line — High · Medium · Low, High on a fresh device (nothing stored, no detection), its one-line hint; the world built at it', () => {
  const s = sel();
  assert.equal(!!s, true, 'the select');
  assert.deepEqual([s.id, s.tagName], ['cvPerf', 'SELECT']);
  assert.deepEqual(s.children.map(o => [o.value, o.textContent]), [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], 'its three options (cv-world PERFS)');
  assert.deepEqual(cvWorld.PERFS, ['high', 'medium', 'low']);
  assert.deepEqual(look(), { sel: 'high', world: 'high', faces: 'high', cords: 'full', stored: null }, 'a fresh device: High, nothing stored');
  // the line: a label "Performance" holding the select, in the Canvas section (after Pinch on canvas: appended to #gearPop), its hint below
  const gp = sim.$('#gearPop').children, i = gp.findIndex(c => c.children && c.children.includes(s)), line = gp[i], hint = gp[i + 1];
  assert.deepEqual([i >= 0, line.tagName, line.className, line.children.length, line.children[0] === s], [true, 'LABEL', 'field cv-perf', 1, true], 'a label.field (its text "Performance ": the stub keeps no text nodes)');
  assert.deepEqual([hint.tagName, hint.className, hint.id, s.getAttribute('aria-describedby')], ['P', 'cv-ghint', 'cvPerfHint', 'cvPerfHint']);
  assert.equal(hint.textContent, 'Lower settings draw panels and cords more simply, for slower tablets. Sound is unaffected.');
  assert.match(s.title, /Visual only/);
});

test('a pick applies live (the world, cv-face, the cords) and is stored per device — never in the project or its History, no worklet message (D1); the same pick again changes nothing', async () => {
  await settle();
  const p0 = JSON.stringify(P()), h0 = cv.hist.u.length, set0 = JSON.stringify(api.settings()), os0 = sim.$('#os').value;
  const n0 = sim.posted.length;
  await settle(3);
  assert.equal(sim.posted.length, n0, '(the control: nothing posted at rest)');
  const seen = [];
  for (const v of ['low', 'medium', 'high', 'low']) {
    pick(v); await settle(3);
    seen.push(look());
  }
  assert.deepEqual(seen, [
    { sel: 'low', world: 'low', faces: 'low', cords: 'still', stored: '"low"' },
    { sel: 'medium', world: 'medium', faces: 'medium', cords: 'light', stored: '"medium"' },
    { sel: 'high', world: 'high', faces: 'high', cords: 'full', stored: '"high"' },
    { sel: 'low', world: 'low', faces: 'low', cords: 'still', stored: '"low"' }]);
  assert.equal(sim.posted.length, n0, 'no worklet message at any switch');
  assert.deepEqual([JSON.stringify(P()) === p0, cv.hist.u.length], [true, h0], 'the project untouched, no History step');
  assert.deepEqual([JSON.stringify(api.settings()) === set0, sim.$('#os').value, /perf/.test(ls.getItem('synthc.settings') || '')], [true, os0, false], 'D2: the settings (Oversampling) untouched, the preset not among them');
  const w0 = ls.writes.length;
  pick('low'); await settle();
  assert.deepEqual([look().world, ls.writes.slice(w0).filter(k => k === KEY).length], ['low', 1], 'the same pick: stored again, nothing else');
  pick('nonsense'); await settle();
  assert.deepEqual(look(), { sel: 'high', world: 'high', faces: 'high', cords: 'full', stored: '"high"' }, 'anything else: High (cv-world perfOf)');
  pick('low'); await settle();
});

test('§1.4: the heavy notices\' lines and texts are the same at every preset (hints, never a refusal)', async () => {
  const at = [];
  for (const v of cvWorld.PERFS) {
    pick(v); await settle();
    at.push(JSON.stringify([cv.parts.HEAVY, cv.parts.HEAVY_MS, cv.ptHeavy().PT_HEAVY]));
  }
  assert.deepEqual([new Set(at).size, JSON.parse(at[0])[2]], [1, 2048]);
  pick('low'); await settle();
});

test('§3.1: a System 55 + 30 modules (past 9b\'s 48) greys no tile — the module tiles, the set tiles —; a tap adds the next one', async () => {
  cv.setPick('s55', 'replace'); await settle(3);
  const t = T(), d = dev(t), n0 = Object.keys(rec().mods).length;
  // (30 more opened as a project — one sync, not 30 taps: canvas-9-sim's way)
  const big = JSON.parse(JSON.stringify(P())), bd = big.tracks.find(x => x.id === t.id).dev[d];
  let br = bd.patch;
  for (let i = 0; i < 30; i++) br = PT.addModule(br, bd.vals, '995').rec;
  bd.patch = br;
  api.applyRestore(cv.loadProject(JSON.stringify(big))); await settle(3);
  const tiles = sh.shell.tiles, n = Object.keys(rec().mods).length;
  tiles.setView('moog'); await settle();
  assert.deepEqual([I(T(), dev()).model, n, n > 48], ['m900', n0 + 30, true]);
  const all = [...cvTray.MOOG_TILES.map(x => tiles.moogTile(x.id)), ...cvTray.SET_TILES.map(x => tiles.setTile(x.id))];
  assert.deepEqual([all.filter(Boolean).length, all.filter(b => b && b.getAttribute('aria-disabled') === 'true').length], [cvTray.MOOG_TILES.length + cvTray.SET_TILES.length, 0], 'every tile there, none greyed');
  cv.patch.add('995'); await settle();
  assert.equal(Object.keys(rec().mods).length, n + 1, 'a tap adds one more');
  assert.doesNotMatch(note(), /at most/);
});

test('§3.1: a full track (CMOD.DEV_MAX devices) — a modulator, an instrument, a Serum → classic Replace: refused with cv-model\'s reason (devFull), before any History step (9dde7e6 + B: a silent null); one device less and the modulator adds', async () => {
  const fillTo = t => { const out = []; for (let k; (k = CMOD.addModDev(t, 'lfo'));) out.push(k); return out; }; // (the model API, synchronously: no render while full)
  const t = T(), before = JSON.stringify(t), h0 = cv.hist.u.length, fill = fillTo(t);
  try {
    assert.equal(Object.keys(t.dev).length, CMOD.DEV_MAX);
    const why = 'A track holds at most ' + CMOD.DEV_MAX + ' devices';
    sim.$('#notice').textContent = '';
    assert.deepEqual([cv.mod.add('lfo'), note(), cv.hist.u.length], [null, why, h0], 'a modulator (a tap)');
    sim.$('#notice').textContent = '';
    assert.deepEqual([cv.mod.add('env', { x: -600, y: 0 }), note(), cv.hist.u.length], [null, why, h0], 'a modulator (a drop)');
    sim.$('#notice').textContent = '';
    assert.deepEqual([cv.add('juno60'), note(), cv.hist.u.length, CMOD.instIds(t).length], [null, why, h0, 1], 'an instrument (cv-model addInst)');
    assert.equal(Object.keys(t.dev).length, CMOD.DEV_MAX, 'nothing added');
  } finally { for (const k of fill) CMOD.removeModDev(t, k); }
  assert.equal(JSON.stringify(t), before, '(the track as it was)');
  // a Serum replaced by a classic unfolds its FX into a panel: one more device
  api.addTrack(MODELS.find(m => m.id === 'serum')); await settle(3);
  const s = T(), sb = JSON.stringify(s), h1 = cv.hist.u.length, fs = fillTo(s);
  try {
    assert.deepEqual([I(s, dev(s)).model, Object.keys(s.dev).length], ['serum', CMOD.DEV_MAX]);
    sim.$('#notice').textContent = '';
    const r = cv.setTrackModel(s, 'minimoog');
    assert.deepEqual([r, note(), I(s, dev(s)).model, cv.hist.u.length], ['A track holds at most 1024 devices', 'A track holds at most 1024 devices', 'serum', h1], 'refused before the step, said');
    sim.$('#notice').textContent = '';
    assert.deepEqual([cv.drop('minimoog', null), note(), I(s, dev(s)).model, cv.hist.u.length], [true, 'A track holds at most 1024 devices', 'serum', h1], 'a Replace from the Sources tray (cvDropInstrument): its reason, no "Replaced …" notice');
  } finally { for (const k of fs) CMOD.removeModDev(s, k); }
  assert.equal(JSON.stringify(s), sb, '(the Serum track as it was)');
  await settle(2);
  cv.setTrackModel(s, 'minimoog'); await settle(3);
  assert.deepEqual([I(s, dev(s)).model, cv.hist.u.length], ['minimoog', h1 + 1], 'with room: replaced (its panel unfolds)');
  api.selectTrack(t.id); await settle(3);
  const k = cv.mod.add('lfo'); await settle(2);
  assert.deepEqual([typeof k, k in t.dev, cv.hist.u.length], ['string', true, h1 + 2], 'room again: added, one step');
});

test('skeptic #1: a 960 numbered m10000 (past 4 digits) — its events post ({t: seq, s: {pe: [10000, k]}}) and a preset that binds it starts its clock after the graph (the step\'s sequencers): the host\'s two binds read PT.isMid', async () => {
  const t0 = T(), d = dev(t0);
  assert.equal(I(t0, d).model, 'm900');
  // (this patch without its 960s and numbered on from 10000, opened as a project — the track a new object after it —; then a 960 by the tap: m10000)
  const big = JSON.parse(JSON.stringify(P())), bd = big.tracks.find(x => x.id === t0.id).dev[d];
  let br = bd.patch;
  for (const m of Object.keys(br.mods).filter(k => br.mods[k].t === '960')) br = PT.removeModule(br, m).rec;
  bd.patch = Object.assign({}, br, { nid: 10000 });
  api.applyRestore(cv.loadProject(JSON.stringify(big))); await settle(3);
  assert.deepEqual([Object.keys(rec().mods).filter(k => rec().mods[k].t === '960').length, rec().nid], [0, 10000]);
  cv.patch.add('960'); await settle(3);
  const t = T(), m960 = Object.keys(rec().mods).find(k => rec().mods[k].t === '960');
  assert.deepEqual([m960, PT.isMid(m960)], ['m10000', true]);
  const ev = PT.FAMILIES[rec().f].types['960'].ev, k1 = ev.findIndex(e => e.id === 'e1');
  node(t).posted.length = 0;
  assert.equal(cv.ptEv(t, d, m960, 'e1'), true, 'its SET 1 posts');
  assert.deepEqual(sent(t, 'seq').filter(m => m.s && m.s.pe).map(m => [m.i, m.s.pe.join()]), [[d, '10000,' + k1]]);
  // Step bass binds the 960 (its CLOCK AT START on): OSC ON (k 0) after the graph
  node(t).posted.length = 0;
  cv.patch.preset('Step bass'); await settle(3);
  assert.deepEqual(sent(t, 'seq').map(m => (m.s.pg ? 'pg' : m.s.pe ? 'pe ' + m.s.pe.join() : '?')), ['pg', 'pe 10000,0'], 'the graph, then OSC ON for m10000');
});

test('R2 fix: {t: ptErr, why: graph} (a patch the evaluator cannot build — the machine keeps its previous graph) is a visible notice, once a burst — repeated edits that keep throwing say nothing more until 30 s pass quiet; a dropped item (cord) stays a console line; the load notice is its own', async () => {
  const t = T(), N = node(t), warn = console.warn, dn = Date.now, lines = [];
  let clock = 1e9;
  Date.now = () => clock;
  console.warn = (...a) => lines.push(a.join(' '));
  const post = why => N.port.onmessage({ data: { t: 'ptErr', why, i: dev(t) } });
  const TOO = /^This patch is too complex to run — the last working version stays in use$/;
  try {
    api.notice('', 0);
    post('cord');
    assert.equal(note(), '', 'a dropped item: no notice (a console line)');
    post('graph');
    assert.match(note(), TOO, 'the first graph failure: a notice');
    api.notice('', 0); clock += 5000;
    post('graph');
    assert.equal(note(), '', 'the same burst (5 s on): nothing more');
    clock += 29000; post('graph');
    assert.equal(note(), '', 'each report keeps the burst open (29 s after the last): still quiet');
    clock += 31000; post('graph');
    assert.match(note(), TOO, '31 s of quiet: a new occurrence says so again');
    api.notice('', 0); clock += 1000;
    post('load');
    assert.match(note(), /^The patch engine did not load: this 900 Series is silent$/, 'the load notice is its own (a session once)');
  } finally { console.warn = warn; Date.now = dn; api.notice('', 0); }
  assert.equal(lines.filter(l => /dropped a payload item \(graph\)/.test(l)).length, 4, 'a console line for every graph report, notice or not');
});

test('?perf= overrides the pref for the session: shown in ⚙, never stored; a pick after it is stored and applied; the pref read again at the next boot', async () => {
  const L2 = fakeStorage({ [KEY]: '"medium"' });
  const s2 = await bootMain({ ls: L2, hash: '#minimoog', location: { search: '?perf=low' } });
  const sh2 = globalThis.__synthTest.shell.shell, W2 = globalThis.__synthTest.cv.world();
  assert.deepEqual([W2.perf, sh2.perfSel.value, FACES.FACES.perf, L2.getItem(KEY)], ['low', 'low', 'low', '"medium"'], '?perf=low over a stored Medium: Low shown, Medium kept');
  sh2.perfSel.value = 'high'; sh2.perfSel.onchange({ type: 'change', target: sh2.perfSel }); s2.raf();
  assert.deepEqual([W2.perf, sh2.perfSel.value, L2.getItem(KEY)], ['high', 'high', '"high"'], 'the person\'s own pick: stored and live');
  const L3 = fakeStorage({ [KEY]: '"medium"' });
  await bootMain({ ls: L3, hash: '#minimoog' });
  const sh3 = globalThis.__synthTest.shell.shell, W3 = globalThis.__synthTest.cv.world();
  assert.deepEqual([W3.perf, sh3.perfSel.value, globalThis.__synthTest.cv.cords().stats().quality], ['medium', 'medium', 'light'], 'a reload: the stored Medium');
  const L4 = fakeStorage({ [KEY]: '"turbo"' });
  await bootMain({ ls: L4, hash: '#minimoog' });
  assert.deepEqual([globalThis.__synthTest.cv.world().perf, globalThis.__synthTest.shell.shell.perfSel.value], ['high', 'high'], 'a stored value it does not know: High');
});
