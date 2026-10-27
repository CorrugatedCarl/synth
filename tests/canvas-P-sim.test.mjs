import './v8-guard.mjs';
// Stage P lane H (docs/canvas/IMPL-P.md §2, §6 row H, §7 H): the performance preset in the page simulation — ⚙ → Canvas's
// Performance line (High · Medium · Low, High on a fresh device: no detection), a device pref (synthc.cv.perf) never in the
// project or its History, applied live through the world (cv-world setPerf → cv-face's texture density + the cords' physics)
// with no worklet message (D1), ?perf= over it for the session (shown, never stored); the heavy notices' lines the same at every
// preset (§1.4); and the lifted bounds through the host (§3.1) — a System 55 + 30 modules greys no tile, a full track's add says
// why (never a silent null), a module numbered past 9 999 still binds its sequencer and posts its events (skeptic #1: the
// host's two binds, PT.isMid). Accessor-free (a guard build: instruments read as devices, cv-model instOf); the real cv-world
// on the stub DOM (its cord layer on the SVG path: no WebGL in node), the real engine; strings, numbers and booleans only
// into assert (never a stub DOM node). Stage FR lane K (IMPL-FR §2, §7.2): the Frame rate line after the Performance hint (120 · 144 · 165 ·
// 240 · Display rate, a device pref synthc.cv.fps, ?fps= over it; the options above the measured display greyed, the live hint while ⚙ is
// open; no worklet message either) and the analysers' smoothing τ = 0.75 ^ (f0 / f) following the frame clock's rate. Run alone: node --max-old-space-size=2048 --test tests/canvas-P-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CMOD from '../cv-model.js?v=9';
import * as PT from '../patch-core.js?v=9';
import * as cvWorld from '../cv-world.js?v=9';
import * as cvTray from '../cv-tray.js?v=9';
import * as FACES from '../cv-face.js?v=9';
import * as wk from '../wk.js?v=9';
import { MODELS } from '../models.js?v=9';

const KEY = 'synthc.cv.perf'; // (store's synth.cv.perf in the app namespace, JSON)
const FKEY = 'synthc.cv.fps'; // (synth.cv.fps: IMPL-FR §2.1 — the frame-rate setting, a string option id, JSON)
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
const fsel = () => sh.shell.fpsSel, fhint = () => sh.shell.fpsHint; // (IMPL-FR §2.1: the Frame rate line)
const fpick = v => { fsel().value = v; fsel().onchange({ type: 'change', target: fsel() }); };
const INF = v => (v === Infinity ? 'inf' : v);
const FPS_HINT = 'Smoother motion on fast displays. Medium and Low draw at 60 fps where the display allows; the sound never changes.';

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

test('(IMPL-FR §2.1) ⚙ → Canvas: the Frame rate line — right after the Performance hint (the P pins above hold), 120 fps · 144 · 165 · 240 · Display rate, 120 on a fresh device (nothing stored), its hint below; the world built at it and the frame clock\'s ceiling in force', () => {
  const s = fsel();
  assert.equal(!!s, true, 'the select');
  assert.deepEqual([s.id, s.tagName], ['cvFps', 'SELECT']);
  assert.deepEqual(s.children.map(o => [o.value, o.textContent]), [['120', '120 fps'], ['144', '144 fps'], ['165', '165 fps'], ['240', '240 fps'], ['display', 'Display rate']], 'cv-world FPS_OPTS, labelled');
  assert.deepEqual(cvWorld.FPS_OPTS, ['120', '144', '165', '240', 'display']);
  const gp = sim.$('#gearPop').children, i = gp.findIndex(c => c.children && c.children.includes(sel())), line = gp[i + 2], hint = gp[i + 3];
  assert.deepEqual([i >= 0, line.tagName, line.className, line.children.length, line.children[0] === s], [true, 'LABEL', 'field cv-fps', 1, true], 'a label.field right after the Performance hint');
  assert.deepEqual([hint.tagName, hint.className, hint.id, s.getAttribute('aria-describedby'), hint === fhint()], ['P', 'cv-ghint', 'cvFpsHint', 'cvFpsHint', true]);
  assert.equal(hint.textContent, FPS_HINT);
  assert.match(s.title, /Visual only/);
  assert.deepEqual([s.value, W().fps, wk.clock.cap(), ls.getItem(FKEY)], ['120', '120', 120, null], 'a fresh device: 120 on High, nothing stored');
  assert.deepEqual(gp.slice(i + 4).filter(c => c.className === 'field cv-fps' || c.id === 'cvFpsHint').length, 0, 'once');
});

test('a Frame rate pick applies live (the world, the clock\'s ceiling min(setting, the preset\'s tier)) and is stored per device — never in the project or its History, no worklet message at any pick or preset switch (the :75 pin holds), the settings untouched; the same pick again stored again, nothing else; an unknown value → 120', async () => {
  await settle();
  const p0 = JSON.stringify(P()), h0 = cv.hist.u.length, set0 = JSON.stringify(api.settings()), os0 = sim.$('#os').value, n0 = sim.posted.length;
  const seen = [];
  for (const [f, p] of [['240', 'high'], ['240', 'medium'], ['display', 'medium'], ['display', 'high'], ['144', 'low'], ['165', 'high'], ['120', 'high']]) {
    pick(p); fpick(f); await settle(2);
    seen.push([fsel().value, W().fps, W().perf, INF(wk.clock.cap()), ls.getItem(FKEY)]);
  }
  assert.deepEqual(seen, [
    ['240', '240', 'high', 240, '"240"'], ['240', '240', 'medium', 60, '"240"'], ['display', 'display', 'medium', 60, '"display"'], ['display', 'display', 'high', 'inf', '"display"'],
    ['144', '144', 'low', 60, '"144"'], ['165', '165', 'high', 165, '"165"'], ['120', '120', 'high', 120, '"120"']]);
  assert.equal(sim.posted.length, n0, 'no worklet message at any pick or preset switch');
  assert.deepEqual([JSON.stringify(P()) === p0, cv.hist.u.length], [true, h0], 'the project untouched, no History step');
  assert.deepEqual([JSON.stringify(api.settings()) === set0, sim.$('#os').value, /fps/.test(ls.getItem('synthc.settings') || '')], [true, os0, false], 'the settings untouched, the frame rate not among them');
  const w0 = ls.writes.length;
  fpick('120'); await settle();
  assert.deepEqual([W().fps, ls.writes.slice(w0).filter(k => k === FKEY).length], ['120', 1], 'the same pick: stored again, nothing else');
  fpick('nonsense'); await settle();
  assert.deepEqual([fsel().value, W().fps, wk.clock.cap(), ls.getItem(FKEY)], ['120', '120', 120, '"120"'], 'anything else: 120');
  pick('low'); await settle();
});

test('(IMPL-FR §2.1, P3-15) the Frame rate options above the measured display rate are disabled and the hint says what the display does — live while ⚙ is open (the clock\'s changes, a preset switch, a 1 s tick), plain again once it closes', async () => {
  const btn = sim.$('#gearBtn'), tap = () => btn.dispatchEvent({ type: 'click', detail: 1, target: btn });
  const dis = () => fsel().children.map(o => !!o.disabled);
  const MORE = ' · faster options need a faster display';
  pick('high'); fpick('120'); await settle(2);
  try {
    wk.clock.config({ display: 240 });
    assert.equal(fhint().textContent, FPS_HINT, 'closed: the plain hint');
    tap();
    assert.deepEqual([dis(), fhint().textContent], [[false, false, false, false, false], FPS_HINT + ' Display 240 Hz · drawing at 120 fps'], 'a 240 Hz display on 120: every option open; drawing at 120 (the 25 % rule: 240 / 2)');
    wk.clock.config({ display: 144 });
    assert.deepEqual([dis(), fhint().textContent], [[false, false, true, true, false], FPS_HINT + ' Display 144 Hz · drawing at 144 fps' + MORE], '144 Hz: 165 and 240 greyed; 144 within 25 % of 120 draws at the display\'s rate');
    wk.clock.config({ display: 60 });
    assert.deepEqual([dis(), fsel().value, fhint().textContent], [[true, true, true, true, false], '120', FPS_HINT + ' Display 60 Hz · drawing at 60 fps' + MORE], '60 Hz (the iPad): every fixed rate greyed, "Display rate" open; the pick stays shown');
    wk.clock.config({ display: 120 });
    pick('medium');
    assert.deepEqual([dis(), fhint().textContent], [[false, true, true, true, false], FPS_HINT + ' Display 120 Hz · drawing at 60 fps' + MORE], 'Medium on 120 Hz: drawing at 60; a preset switch refreshes the hint');
    fpick('display');
    assert.equal(fhint().textContent, FPS_HINT + ' Display 120 Hz · drawing at 60 fps' + MORE, 'Display rate on Medium: still 60');
    pick('high');
    assert.equal(fhint().textContent, FPS_HINT + ' Display 120 Hz · drawing at 120 fps' + MORE, 'High: the display\'s 120');
    tap();
    assert.equal(fhint().textContent, FPS_HINT, 'closed: plain again');
    wk.clock.config({ display: 240 });
    assert.equal(fhint().textContent, FPS_HINT, 'closed: a clock change writes nothing (its listener is gone)');
    tap();
    assert.deepEqual([dis(), fhint().textContent], [[false, false, false, false, false], FPS_HINT + ' Display 240 Hz · drawing at 240 fps'], 'opened again: read afresh (Display rate on High: the display\'s 240)');
    tap();
  } finally { wk.clock.config({ display: 60 }); fpick('120'); pick('low'); await settle(); }
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

test('(IMPL-FR §7.2) the analysers\' smoothing in time: τ = 0.75 ^ (f0 / f), f the frame clock\'s effective rate and f0 each analyser\'s own base rate today — the master\'s 8192 `an` read ≈ 30 times a second (f0 30), the OUT scope\'s per-track `sc` at a 60 Hz display (f0 60); set when the clock\'s rate changes (a display, a preset, the setting) and on every new analyser', async () => {
  const an = () => globalThis.__synthTest.master.graph().an, scs = () => [...api.nodes.values()].map(N => N.sc);
  const tau = (f0, f) => Math.pow(0.75, f0 / f), near = (a, b) => Math.abs(a - b) < 1e-12;
  const look = () => [an().smoothingTimeConstant, ...scs().map(x => x.smoothingTimeConstant)];
  const want = f => [tau(30, f), ...scs().map(() => tau(60, f))];
  try {
    pick('high'); fpick('120'); await settle(2);
    wk.clock.config({ display: 60 });
    let got = look(), w = want(60);
    assert.ok(got.length >= 2 && got.every((x, i) => near(x, w[i])), 'at 60: ' + got + ' vs ' + w + ' (the master 0.75^0.5, a scope 0.75^1 — today\'s)');
    wk.clock.config({ display: 120 });
    got = look(); w = want(120);
    assert.ok(got.every((x, i) => near(x, w[i])), 'at 120 (High, 120): ' + got + ' vs ' + w);
    assert.ok(near(got[0], 0.75 ** 0.25) && near(got[1], 0.75 ** 0.5), 'master 0.75^(30/120), a scope 0.75^(60/120)');
    wk.clock.config({ display: 240 });
    fpick('240'); await settle();
    got = look(); w = want(240);
    assert.ok(got.every((x, i) => near(x, w[i])), 'at 240: ' + got);
    pick('medium'); await settle();
    got = look(); w = want(60);
    assert.ok(got.every((x, i) => near(x, w[i])), 'Medium at 240 Hz draws at 60: ' + got);
    wk.clock.config({ display: 120 }); fpick('120'); pick('high'); await settle();
    // a new track\'s analyser starts at the rate in force
    api.addTrack(MODELS.find(m => m.id === 'minimoog')); await settle(3);
    got = look(); w = want(120);
    assert.ok(got.length >= 3 && got.every((x, i) => near(x, w[i])), 'a track added at 120: ' + got);
  } finally { wk.clock.config({ display: 60 }); fpick('120'); pick('low'); await settle(); }
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

test('(IMPL-FR §2.1) ?fps= overrides the pref for the session: shown in ⚙ when it is one of the options, never stored; a pick after it is stored and applied; the pref read again at the next boot (a number or an unknown value tolerated); the preset still caps the clock', async () => {
  const L2 = fakeStorage({ [FKEY]: '"144"' });
  const s2 = await bootMain({ ls: L2, hash: '#minimoog', location: { search: '?fps=240' } });
  const sh2 = globalThis.__synthTest.shell.shell, W2 = globalThis.__synthTest.cv.world();
  assert.deepEqual([W2.fps, sh2.fpsSel.value, wk.clock.cap(), L2.getItem(FKEY)], ['240', '240', 240, '"144"'], '?fps=240 over a stored 144: 240 shown and in force, 144 kept');
  sh2.fpsSel.value = 'display'; sh2.fpsSel.onchange({ type: 'change', target: sh2.fpsSel }); s2.raf();
  assert.deepEqual([W2.fps, sh2.fpsSel.value, wk.clock.cap() === Infinity, L2.getItem(FKEY)], ['display', 'display', true, '"display"'], 'the person\'s own pick: stored and live');
  const L3 = fakeStorage({ [FKEY]: '"165"', [KEY]: '"medium"' });
  await bootMain({ ls: L3, hash: '#minimoog' });
  const sh3 = globalThis.__synthTest.shell.shell, W3 = globalThis.__synthTest.cv.world();
  assert.deepEqual([W3.fps, sh3.fpsSel.value, W3.perf, wk.clock.cap()], ['165', '165', 'medium', 60], 'a reload: the stored 165, Medium caps the clock at 60');
  await bootMain({ ls: fakeStorage({}), hash: '#minimoog', location: { search: '?fps=60' } });
  const sh4 = globalThis.__synthTest.shell.shell, W4 = globalThis.__synthTest.cv.world();
  assert.deepEqual([W4.fps, sh4.fpsSel.value, wk.clock.cap()], ['60', '120', 60], '?fps=60: a number outside the options runs (60), the select keeps showing the pref');
  await bootMain({ ls: fakeStorage({ [FKEY]: '"turbo"' }), hash: '#minimoog' });
  assert.deepEqual([globalThis.__synthTest.cv.world().fps, globalThis.__synthTest.shell.shell.fpsSel.value, wk.clock.cap()], ['120', '120', 120], 'a stored value it does not know: 120');
  const s6 = await bootMain({ ls: fakeStorage({ [FKEY]: '240' }), hash: '#minimoog' });
  assert.deepEqual([globalThis.__synthTest.cv.world().fps, wk.clock.cap()], ['240', 240], 'a number stored: tolerated');
  // a display not measured yet (the clock\'s ring not full): nothing is greyed, the hint says so
  wk.clock._reset();
  const g6 = s6.$('#gearBtn'), f6 = globalThis.__synthTest.shell.shell;
  g6.dispatchEvent({ type: 'click', detail: 1, target: g6 });
  assert.deepEqual([f6.fpsSel.children.map(o => !!o.disabled), f6.fpsHint.textContent], [[false, false, false, false, false], FPS_HINT + ' Measuring the display…']);
  g6.dispatchEvent({ type: 'click', detail: 1, target: g6 });
});

test('(IMPL-FR §2.2, review 1 P3-5) no world ("Canvas camera unavailable": createWorld threw) — main.js sets the frame clock\'s ceiling itself, min(the setting, the preset\'s tier), at boot and at every Frame rate / Performance pick', async () => {
  const L = fakeStorage({ [FKEY]: '"165"', [KEY]: '"medium"' });
  const s7 = await bootMain({ ls: L, hash: '#minimoog', beforeImport: G => { G.document.querySelector('#cvToolbar').append = () => { throw new Error('test: no camera'); }; } });
  const sh7 = globalThis.__synthTest.shell.shell;
  const pk = (s, v) => { s.value = v; s.onchange({ type: 'change', target: s }); s7.raf(); };
  assert.deepEqual([globalThis.__synthTest.cv.world() === null, sh7.fpsSel.value, sh7.perfSel.value, INF(wk.clock.cap())], [true, '165', 'medium', 60], 'booted without a world: Medium caps the clock at 60');
  pk(sh7.perfSel, 'high');
  assert.deepEqual([INF(wk.clock.cap()), L.getItem(KEY)], [165, '"high"'], 'High: the setting');
  pk(sh7.fpsSel, 'display');
  assert.deepEqual([INF(wk.clock.cap()), L.getItem(FKEY)], ['inf', '"display"'], 'Display rate on High: no ceiling');
  pk(sh7.fpsSel, '240');
  assert.equal(INF(wk.clock.cap()), 240);
  pk(sh7.perfSel, 'low');
  assert.equal(INF(wk.clock.cap()), 60, 'Low: 60');
});
