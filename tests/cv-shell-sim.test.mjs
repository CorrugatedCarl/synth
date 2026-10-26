import './v8-guard.mjs';
// The stage-1b shell in the page simulation (SHELL lane; docs/canvas/IMPL-1b.md §8.1): every legacy control id present
// and wired (≡ / ⚙ / transport / arrangement toolbar), CANVAS | ROLL (saved 'inst' / 'fx' open CANVAS), tray budget
// (canvas ≥ 240 px), Sources tray pick / drop → replace or new track (one undo step each), + Track flow.
// One boot per test (tests/main-sim.mjs); strings and numbers only into assert (never a fake-DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/cv-shell-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import { MODELS } from '../models.js?v=9';
import * as cvTray from '../cv-tray.js?v=9';
import * as CM from '../cv-migrate.js?v=9';
import * as CMOD from '../cv-model.js?v=9';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const shellOf = () => globalThis.__synthTest.shell;
// (milestone 3 R7: a track has no v1 fields — its instrument and its FX rack are read as devices)
const I = t => CMOD.instOf(t), FXR = t => { const f = CMOD.fxDevOf(t); return f ? f.dev.fx : undefined; };
const fn = v => typeof v === 'function';
const bound = (el, type) => fn(el['on' + type]) || ((el.listeners && el.listeners[type]) || []).length > 0;
const resize = async (s, w, h) => { if (w) globalThis.innerWidth = w; if (h) globalThis.innerHeight = h; for (const f of s.dom.winL.resize || []) f({ type: 'resize' }); await s.settle(160); };

test('index.html: the shell of IMPL-1b §3.1 — every id of the tree and of today\'s controls (§7 rows 1–11), once; the model nav, the FX tab and the old tabs gone; no inline script', () => {
  const ids = ['app', 'topTray', 'topRow', 'appMenuBtn', 'appMenu', 'fNew', 'fOpen', 'fFile', 'fSave', 'fMidi', 'fBounce', 'install', 'fullscreen', 'helpBtn',
    'transport', 'tStart', 'tPlay', 'tRec', 'tBBT', 'tTime', 'tBpm', 'tSigN', 'tSigD', 'tLoop', 'tMetro', 'tCount', 'tUndo', 'tRedo', 'trkChip', 'trkDots', 'tabTrack',
    'engMore', 'engPop', 'power', 'master', 'masterG', 'rate', 'cpu', 'latL', 'lat', 'latPop', 'gearBtn', 'gearPop', 'sr', 'os', 'drift', 'tRecMode', 'tInQ', 'pinchMode',
    'arrbar', 'aAdd', 'aMulti', 'aRange', 'aCopy', 'aPaste', 'aDup', 'aClear', 'aDel', 'aIns', 'aLoopSel', 'tBars', 'studio', 'arrwrap', 'heads', 'lanes', 'topGrip',
    'stage', 'tab-inst', 'viewport', 'world', 'cvParts', 'boot', 'scope', 'about-title', 'about', 'algo', 'overlay', 'cvToolbar',
    'srcTray', 'srcGrip', 'srcTab', 'tab-roll', 'rolltools', 'rollwrap', 'perf', 'kbGrip', 'notice', 'kbrow', 'keys', 'helpParts', 'ov',
    'modal', 'installSheet', 'update', 'tip'];
  for (const id of ids) assert.equal((HTML.match(new RegExp(`\\sid="${id}"`, 'g')) || []).length, 1, id);
  for (const gone of ['id="models"', 'id="tab-fx"', 'id="fxtitle"', 'data-tab="inst"', 'data-tab="fx"', 'class="console"', '<footer', 'id="inst"', 'id="fxrack"']) assert.ok(!HTML.includes(gone), gone); // ((milestone 3, R6 / lane D) every device body is its module's own element: no #inst / #fxrack homes)
  assert.match(HTML, /<div id="world" class="cv-world" data-cv-world>/);
  assert.match(HTML, /<div id="viewport" class="cv-viewport" tabindex="0" aria-label="Track canvas">/);
  assert.match(HTML, /<aside id="srcTray"[^>]*data-wk-inset="left"/);
  // (2026-10-22, the user) no Effects tray: the right edge is the canvas's
  for (const gone of ['id="fxTray"', 'id="fxRail"', 'id="fxPanel"', 'id="fxClose"', 'id="fxGrip"', 'id="fxList"', 'id="srcRail"', 'data-wk-inset="right"', 'cv-right', 'cv-rail']) assert.ok(!HTML.includes(gone), gone);
  assert.match(HTML, /<button type="button" data-tab="canvas"[^>]*>Canvas<\/button>\s*<button type="button" data-tab="roll"/);
  // the parts the modules take: inside #world, not hidden
  const parts = HTML.slice(HTML.indexOf('id="cvParts"'), HTML.indexOf('id="overlay"'));
  for (const id of ['boot', 'scope']) assert.ok(parts.includes(`id="${id}"`), id + ' inside #cvParts'); // (the boot message shows there until main.js hides #cvParts)
  assert.doesNotMatch(/<div id="cvParts"[^>]*>/.exec(HTML)[0], /hidden/);
  // help kept for the ≡ → Help sheet
  assert.match(HTML.slice(HTML.indexOf('id="helpParts"')), /^[^]*?<p class="help"><b>Play:<\/b>[^]*installed app keeps its own projects[^]*<div class="foot">/);
  assert.deepEqual([...HTML.matchAll(/<script\b([^>]*)>/g)].map(m => m[1]).filter(a => !/\ssrc=/.test(a)), []);
});

test('boot: today\'s controls keep their handlers in the shell (transport, ≡ file items, arrangement toolbar, ⚙ settings, engine), the menus are wired', async () => {
  const s = await bootMain({});
  const click = ['tStart', 'tPlay', 'tRec', 'tLoop', 'tMetro', 'tInQ', 'tUndo', 'tRedo', 'fNew', 'fOpen', 'fSave', 'fMidi', 'fBounce', 'aAdd', 'aMulti',
    'aCopy', 'aPaste', 'aDup', 'aClear', 'aDel', 'aIns', 'aLoopSel', 'power', 'fullscreen', 'helpBtn', 'srcClose', 'octdn', 'octup', 'panic', 'hold', 'kbHide'];
  for (const id of click) assert.ok(bound(s.$('#' + id), 'click'), id + ' click');
  for (const id of ['tCount', 'tRecMode', 'tSigD', 'fFile', 'sr', 'os', 'pinchMode', 'tBpm', 'tSigN', 'tBars']) assert.ok(bound(s.$('#' + id), 'change'), id + ' change');
  for (const id of ['drift', 'master', 'masterG']) assert.ok(bound(s.$('#' + id), 'input'), id + ' input');
  // ⚙'s master level (shown where the top row's folds away, ≤ 1099 px) drives the master level through #master's handler
  s.$('#masterG').value = '0.42'; s.$('#masterG').oninput();
  assert.deepEqual([s.api.settings().master, s.$('#master').value], [0.42, '0.42'], 'the ⚙ mirror sets the master level');
  for (const id of ['appMenuBtn', 'gearBtn', 'tMore', 'aBars', 'trkChip', 'engMore', 'srcTab', 'meter', 'rollhelp']) assert.ok(bound(s.$('#' + id), 'click'), id + ' (menu / tray) click');
  for (const id of ['topGrip', 'kbGrip', 'srcGrip', 'srcTab']) assert.ok(bound(s.$('#' + id), 'pointerdown') && bound(s.$('#' + id), 'keydown') || bound(s.$('#' + id), 'pointerdown'), id + ' grip');
  for (const t of ['pointermove', 'pointerup', 'pointercancel']) assert.ok(bound(s.$('#srcTab'), t), 'the Sources tab pulls: ' + t);
  assert.equal(s.$('#topGrip').getAttribute('role'), 'slider');
  assert.equal(s.$('#topGrip').getAttribute('aria-valuenow'), '204', 'first run: one track row shown (the arrangement toolbar, the ruler, the row; (M) the Master row: the footer)');
  // the selected track in the top row
  const t = s.api.project().tracks[0];
  assert.equal(s.$('#trkChip .cv-cn').textContent, t.name);
  assert.match(s.$('#trkChip .cv-cv').textContent, new RegExp('^' + MODELS.find(m => m.id === I(t).model).name + ' · '));
  assert.equal(s.$('#tabTrack').textContent.startsWith('Track: ' + t.name), true);
  assert.equal(s.$('#trkDots').children.length, 1, 'one dot per track');
  s.api.addTrack(MODELS.find(m => m.id === 'juno60'));
  assert.equal(s.$('#trkDots').children.length, 2);
  assert.deepEqual(s.$('#trkDots').children.map(d => d.classList.contains('on')), [false, true], 'the selected one marked');
  s.$('#trkDots').children[0].onclick();
  assert.equal(s.api.project().selTrack, s.api.project().tracks[0].id, 'a dot selects its track');
});

test('CANVAS │ ROLL: openTab shows one view; a saved "inst" or "fx" (before the canvas) opens CANVAS, "roll" ROLL; ROLL closes the side trays', async () => {
  const ls = fakeStorage({});
  const s = await bootMain({ ls }), sh = shellOf();
  assert.deepEqual([s.$('#tab-inst').hidden, s.$('#tab-roll').hidden], [false, true], 'CANVAS by default');
  sh.cvOpenSources('replace');
  assert.equal(sh.shell.src.isOpen(), true);
  sh.openTab('roll');
  assert.deepEqual([s.$('#tab-inst').hidden, s.$('#tab-roll').hidden, ls.m.get('synthc.tab')], [true, false, '"roll"']);
  assert.equal(sh.shell.src.isOpen(), false, 'the side trays are the canvas view\'s');
  for (const old of ['inst', 'fx', 'canvas', 'nonsense']) {
    sh.openTab(old);
    assert.deepEqual([s.$('#tab-inst').hidden, s.$('#tab-roll').hidden, ls.m.get('synthc.tab')], [false, true, '"canvas"'], old);
  }
  // the Sources tray from ROLL opens CANVAS first
  sh.openTab('roll');
  sh.cvOpenSources('track');
  assert.deepEqual([s.$('#tab-inst').hidden, sh.shell.src.isOpen()], [false, true]);
  for (const [saved, inst] of [['"fx"', false], ['"inst"', false], ['"roll"', true]]) {
    const s2 = await bootMain({ ls: fakeStorage({ 'synthc.tab': saved }) });
    assert.equal(s2.$('#tab-inst').hidden, inst, 'saved ' + saved);
    assert.equal(s2.$('#tab-roll').hidden, !inst);
  }
});

test('+ Track opens the Sources tray in "new track" mode; a tile tap there adds a track with that instrument (one undo step); the tray stays open (the user\'s rule), back in "replace" mode', async () => {
  const s = await bootMain({ hash: '#minimoog' }), sh = shellOf(), api = s.api;
  s.$('#aAdd').onclick();
  assert.deepEqual([sh.shell.src.isOpen(), sh.shell.tiles.mode()], [true, 'track']);
  assert.match(s.$('#srcMode').children.map(c => c.textContent || '').join(''), /a new track/);
  const n0 = api.project().tracks.length;
  sh.srcPick('dx7', sh.shell.tiles.mode());
  const P = api.project();
  assert.equal(P.tracks.length, n0 + 1);
  assert.equal(I(P.tracks.at(-1)).model, 'dx7');
  assert.equal(P.selTrack, P.tracks.at(-1).id, 'the new track selected');
  assert.deepEqual([sh.shell.src.isOpen(), sh.shell.tiles.mode()], [true, 'replace'], 'still open (only its rail, its ✕ or Escape close it); the next tap replaces');
  assert.match(s.$('#srcMode').children.map(c => c.textContent || '').join(''), /DX7/, 'on the new track');
  s.$('#tUndo').onclick(); s.raf();
  assert.equal(api.project().tracks.length, n0, 'one undo step');
  // the rail opens it in "replace" mode
  s.$('#aAdd').onclick(); sh.shell.src.close();
  sh.shell.src.open();
  assert.equal(sh.shell.tiles.mode(), 'replace');
});

test('Sources views (2026-10-19, the dropdown that replaced "Hardware | Simple"): the saved view comes back (\'serum\' too; an unknown one → Hardware); + Track keeps it; a pick from #srcViewMenu saves it and re-words the intro; closing the tray closes the dropdown', async () => {
  const ls = fakeStorage({ 'synthc.cv.trayLayout': '"serum"' });
  const s = await bootMain({ hash: '#minimoog', ls }), sh = shellOf(), T = sh.shell.tiles, vm = s.$('#srcViewMenu'), vb = s.$('#srcView');
  const tap = t => t.dispatchEvent({ type: 'click', target: t, detail: 1, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual([T.view(), T.layout(), vb.children[0].textContent, T.tiles().filter(b => !b.hidden).map(b => b.getAttribute('data-model')), s.$('#srcModSec').hidden, s.$('#srcNote').textContent],
    ['serum', 'hw', 'Serum', ['serum'], false, 'Drop a modulator on the canvas and cable its jack to any knob.']);
  s.$('#aAdd').onclick();
  assert.deepEqual([sh.shell.src.isOpen(), T.mode(), T.view()], [true, 'track', 'serum'], '+ Track: the view last used');
  tap(vb); tap(vm.children[0]);
  assert.deepEqual([T.view(), JSON.parse(ls.m.get('synthc.cv.trayLayout')), T.mode(), T.viewOpen(), s.$('#srcModSec').hidden], ['hw', 'hw', 'track', false, true]);
  assert.match(s.$('#srcMode').children.map(c => c.textContent || '').join(''), /a new track/, 'the intro redrawn in its mode');
  tap(vb);
  sh.shell.src.close();
  assert.deepEqual([T.viewOpen(), vb.getAttribute('aria-expanded')], [false, 'false'], 'no dropdown left over a closed tray');
  const s2 = await bootMain({ ls: fakeStorage({ 'synthc.cv.trayLayout': '"nope"' }) });
  assert.deepEqual([shellOf().shell.tiles.view(), s2.$('#srcView').children[0].textContent], ['hw', 'Hardware']);
});

test('Sources tray, replace mode: a tap replaces the selected track\'s instrument (one undo step, the undo notice); the tray stays open; the same model in the tray\'s layout does nothing', async () => {
  const s = await bootMain({ hash: '#minimoog' }), sh = shellOf(), api = s.api;
  sh.cvOpenSources('replace');
  const t = api.project().tracks[0];
  assert.equal(I(t).model, 'minimoog');
  sh.srcPick('prophet5', 'replace');
  assert.equal(I(api.project().tracks[0]).model, 'prophet5');
  assert.equal(api.project().tracks.length, 1);
  assert.equal(sh.shell.src.isOpen(), true, 'the tray stays open (audition another)');
  assert.match(s.$('#notice').textContent, /^Replaced Minimoog with Prophet-5/);
  s.$('#tUndo').onclick(); s.raf();
  assert.equal(I(api.project().tracks[0]).model, 'minimoog', 'one undo step');
  s.$('#tUndo').onclick(); s.raf();
  assert.equal(I(api.project().tracks[0]).model, 'minimoog');
  const n = api.project().tracks.length;
  sh.srcPick('minimoog', 'replace');
  assert.deepEqual([I(api.project().tracks[0]).model, api.project().tracks.length], ['minimoog', n], 'the same model: nothing');
});

test('Sources tray drags: over the top tray = the track list (a new track, one undo step), over the canvas = replace, elsewhere nothing; the zones', async () => {
  const s = await bootMain({ hash: '#minimoog' }), sh = shellOf(), api = s.api;
  const el = sel => ({ closest: q => (q.split(',').map(x => x.trim()).includes(sel) ? {} : null) });
  assert.equal(sh.srcOver(el('#topTray')), 'tracks');
  assert.equal(sh.srcOver(el('#viewport')), 'canvas');
  assert.equal(sh.srcOver(el('#perf')), null);
  assert.equal(sh.srcOver(null), null);
  sh.openTab('roll');
  assert.equal(sh.srcOver(el('#viewport')), null, 'ROLL shows: no canvas');
  sh.openTab('canvas');
  const n0 = api.project().tracks.length, i = (over, x = 400, y = 300) => ({ over, x, y, pointerType: 'touch', t: 1 });
  sh.srcDrag.begin('juno60', i('tracks'));
  assert.equal(sh.srcDrag.drop('juno60', i('tracks')), true);
  assert.deepEqual([api.project().tracks.length, I(api.project().tracks.at(-1)).model], [n0 + 1, 'juno60']);
  s.$('#tUndo').onclick(); s.raf();
  assert.equal(api.project().tracks.length, n0, 'one undo step');
  sh.srcDrag.move('dx7', i('canvas'));
  assert.equal(sh.srcDrag.drop('dx7', i('canvas')), true);
  assert.equal(I(api.project().tracks[0]).model, 'dx7', 'replaced in place');
  assert.equal(sh.srcDrag.drop('obxa', i(null)), false);
  assert.equal(I(api.project().tracks[0]).model, 'dx7', 'elsewhere: nothing');
  sh.srcDrag.cancel('obxa', i(null));
});

test('the height budget: kbMaxH keeps the canvas ≥ 240 px with the top tray at its row; the top tray leading pushes the keys toward 70 px; its stops, fold toggle and prefs', async () => {
  const ls = fakeStorage({});
  const s = await bootMain({ ls }), sh = shellOf(), api = s.api;
  const chrome = 64;
  for (const vh of [834, 1024, 1194, 1366, 900, 700, 560]) {
    await resize(s, 1400, vh);
    const kmax = api.kbMaxH(chrome);
    assert.ok(kmax >= 70 && kmax <= 360, vh + ': within 70 … 360');
    if (vh - 240 - 48 - chrome >= 70) assert.ok(vh - 48 - (chrome + kmax) >= 240, `${vh}: canvas ${vh - 48 - chrome - kmax}`);
    assert.ok(vh - sh.topMaxH() - chrome - 70 >= 240 || sh.topMaxH() === 48, `${vh}: the top tray leaves the canvas 240 px`);
  }
  await resize(s, 1400, 900);
  // the top tray: one row by default; its stops follow the track count ((M, IMPL-M §5.1) + the footer, the Master row: 44 px)
  assert.equal(sh.topWant(), 204);
  for (let k = 0; k < 4; k++) api.addTrack();
  assert.equal(sh.topMaxH(), 428, 'five tracks: 48 + 32 + 24 + 5 · 56 + 44');
  sh.topSet(316, 'end');
  assert.equal(sh.shell.topShown, 316);
  assert.deepEqual(JSON.parse(ls.m.get('synthc.cv.trays')), { top: 316, topLast: 316 }, 'persisted');
  assert.equal(s.$('#topGrip').getAttribute('aria-valuenow'), '316');
  assert.equal(s.$('#topGrip').getAttribute('aria-valuetext'), '3 track rows');
  // the top tray leads: a short window lowers the keys, never below 70 px
  await resize(s, 1400, 700);
  assert.equal(sh.shell.topShown, 316);
  assert.equal(api.kb().h, Math.max(70, 700 - 240 - 316 - chrome), 'the keys pushed (' + api.kb().h + ')');
  // the keyboard leads again (a key on its grip): the top tray is pushed instead
  const g = s.$('#kbGrip');
  g.dispatchEvent({ type: 'keydown', key: 'End', shiftKey: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(api.kb().h, api.kbMaxH(chrome));
  assert.equal(sh.shell.topShown, Math.max(48, 700 - 240 - chrome - api.kb().h), 'the top tray folds toward its row');
  // fold toggle (2026-10-22: a tap on the tab, Enter / Space; no double-tap): folded ↔ the last height
  await resize(s, 1400, 900);
  const tg = s.$('#topGrip'), tp = (type, y, o) => Object.assign({ type, pointerId: 41, clientX: 600, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerType: 'touch', timeStamp: performance.now(), preventDefault() {} }, o);
  tg.dispatchEvent(tp('pointerdown', 300)); tg.dispatchEvent(tp('pointerup', 302));
  assert.equal(sh.shell.topShown, 48, 'a tap: folded');
  assert.equal(JSON.parse(ls.m.get('synthc.cv.trays')).top, 48);
  tg.dispatchEvent({ type: 'keydown', key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(sh.shell.topShown, 316, 'Enter: the last height again');
  sh.topToggle(); sh.topToggle();
  assert.equal(sh.shell.topShown, 316);
  sh.topSet(0, 'reset');
  assert.equal(sh.shell.topShown, 48, 'reset (Delete) from open: folded');
  sh.topSet(0, 'reset');
  assert.equal(sh.shell.topShown, 204, 'and from folded: one row');
  // a two-finger cancel of a drag: as it was, nothing saved
  const saved = ls.m.get('synthc.cv.trays');
  sh.topSet(260, 'move');
  assert.equal(sh.shell.topShown, 260);
  sh.topSet(204, 'cancel');
  assert.deepEqual([sh.shell.topShown, ls.m.get('synthc.cv.trays')], [204, saved]);
  // the prefs come back in the next session
  const s2 = await bootMain({ ls });
  assert.equal(shellOf().shell.topShown, 204);
  void s2;
});

test('Escape: a sheet, then a menu, then the side trays close (cvShellEscape → true), then nothing; Help & about moves the help into a sheet and back', async () => {
  const s = await bootMain({}), sh = shellOf();
  sh.cvOpenSources('replace');
  sh.helpSheet();
  assert.ok(sh.shell.sheet, 'the Help sheet');
  assert.equal(s.$('#ov').children.length, 1, 'in #ov');
  assert.equal(sh.cvShellEscape(), true);
  assert.equal(sh.shell.sheet, null);
  assert.equal(s.$('#ov').children.length, 1, '(the stub never removes nodes; the sheet object is gone)');
  sh.shell.menus[1].open();
  assert.equal(sh.cvShellEscape(), true, '⚙');
  assert.equal(sh.shell.menus[1].isOpen(), false);
  assert.equal(sh.cvShellEscape(), true, 'the Sources tray');
  assert.equal(sh.shell.src.isOpen(), false);
  assert.equal(sh.cvShellEscape(), false, 'nothing left (no Effects tray)');
});

test('the instrument chip menu lists every model with its voice mode (R6); the track row\'s chip names the track\'s own', async () => {
  const s = await bootMain({ hash: '#juno60' }), sh = shellOf(), t = s.api.project().tracks[0];
  const items = sh.instItems(t);
  assert.deepEqual(items.map(i => i.value), MODELS.map(m => m.id));
  assert.ok(items.some(i => i.label === 'Juno-60 · Poly 6'));
  assert.ok(items.some(i => i.label === 'Minimoog · Mono'));
  const row = s.$('#heads').children.find(r => r.dataset && r.dataset.id === t.id);
  const chip = row.children[1].children[0];
  assert.equal(chip.className, 'hinst');
  const lab = chip.children[1];
  assert.deepEqual(lab.children.map(c => c.className + '=' + c.textContent), ['hin=Juno-60', 'his= · ', 'hiv=Poly 6'], 'model name (gives way), separator, voice mode (always whole)');
  assert.equal(lab.value, 'juno60', 'registered for voiceSeen (its value names the model)');
  assert.match(chip.title, /^Juno-60 · Poly 6 — tap/, 'the title names the voice mode too');
  assert.equal(cvTray.TRAY_PREF, 'synth.cv.trays');
});

test('the side tray (2026-10-22, the user: "remove it and move the estimates"; the Sources tray to a pull tab): no Effects tray in the shell (shell.fx, its tiles, its __synthTest hooks gone; the right edge free); the Sources tray\'s tab toggles it, a pull drags it out; its open state and width come back, an old Effects record ignored; Escape and ROLL close it', async () => {
  const ls = fakeStorage({ 'synthc.cv.trays': JSON.stringify({ fx: { open: true, w: 300 } }) });
  const s = await bootMain({ ls }), sh = shellOf(), cv = globalThis.__synthTest.cv;
  assert.deepEqual(['fx' in sh.shell, 'fxTiles' in sh.shell, typeof cv.fx.pick, typeof cv.fx.drag, typeof cv.fx.over, typeof cv.fx.tiles], [false, false, 'undefined', 'undefined', 'undefined', 'undefined'], 'no Effects tray');
  assert.deepEqual([typeof cv.fx.addEffect, typeof cv.fx.cost, cv.fx.items.length], ['function', 'function', 17], 'the effects (14 since SC: the Ducker) (the "+" menu\'s list) and their estimates stay');
  assert.equal(s.$('#fxTray').listeners && Object.keys(s.$('#fxTray').listeners).length, 0, 'nothing bound to a #fxTray');
  assert.equal(sh.shell.src.isOpen(), false, 'an old Effects record opens nothing');
  const tab = s.$('#srcTab');
  assert.equal(tab.getAttribute('aria-expanded'), 'false');
  tab.dispatchEvent({ type: 'click', detail: 1 });
  assert.deepEqual([sh.shell.src.isOpen(), tab.getAttribute('aria-expanded'), s.$('#srcTray').classList.contains('open')], [true, 'true', true], 'a tap opens it');
  assert.deepEqual(JSON.parse(ls.m.get('synthc.cv.trays')).src, { open: true, w: 240 });
  // a pull back (a quick 150 px drag inward): shut, its click eaten
  const pe = (type, x, o) => Object.assign({ type, pointerId: 51, clientX: x, clientY: 400, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerType: 'touch', timeStamp: performance.now(), preventDefault() {} }, o);
  tab.dispatchEvent(pe('pointerdown', 250)); tab.dispatchEvent(pe('pointermove', 200)); tab.dispatchEvent(pe('pointermove', 100));
  assert.deepEqual([s.$('#srcTray').classList.contains('pull'), s.$('#srcTray').style.transform], [true, 'translateX(-150px)'], 'the tray under the finger');
  tab.dispatchEvent(pe('pointerup', 100)); tab.dispatchEvent({ type: 'click', detail: 1 });
  assert.deepEqual([sh.shell.src.isOpen(), s.$('#srcTray').classList.contains('pull'), s.$('#srcTray').style.transform], [false, false, ''], 'past half in: shut (the click after it eaten)');
  sh.shell.src.open(); sh.shell.src.setWidth(300);
  globalThis.innerWidth = 834;
  sh.cvOpenSources('track');
  assert.equal(sh.shell.src.isOpen(), true, 'portrait: it opens as on a wide window (no other tray to fold)');
  globalThis.innerWidth = 1400;
  assert.deepEqual(JSON.parse(ls.m.get('synthc.cv.trays')), { fx: { open: true, w: 300 }, src: { open: true, w: 300 } }, 'the old record kept as it was, read by nobody');
  const s2 = await bootMain({ ls });
  assert.deepEqual([shellOf().shell.src.isOpen(), shellOf().shell.src.width()], [true, 300], 'restored');
  shellOf().openTab('roll');
  assert.equal(shellOf().shell.src.isOpen(), false, 'ROLL closes it (the canvas\'s tray)');
  shellOf().openTab('canvas');
  void s; void s2;
});

test('the "+" menus\' load estimates (2026-10-22): an FX module\'s rack gets the host\'s cost (fx-ui opts.cost) — the cv-cost estimate of each effect type on this device, the same labels the Effects tray\'s tiles showed, following ⚙ → Measure this device; a Serum\'s FX page gets it through its host (fxCost)', async () => {
  const s = await bootMain({}), sh = shellOf(), cv = globalThis.__synthTest.cv, api = s.api, acc = globalThis.__synthTest.acc;
  const COSTM = await import('../cv-cost.js?v=9');
  for (const x of cv.fx.items) assert.equal(cv.fx.cost(x.type), COSTM.label(COSTM.estimate(x.type, 0)), x.type);
  assert.match(cv.fx.cost('rev'), /^~\d+ %$|^<1 %$/, 'an estimate: ' + cv.fx.cost('rev'));
  const before = cv.fx.cost('conv');
  api.store.set('synth.cv.devFactor', 4);
  assert.notEqual(cv.fx.cost('conv'), before, 'a slower device: a higher estimate (' + before + ' → ' + cv.fx.cost('conv') + ')');
  assert.equal(cv.fx.cost('conv'), COSTM.label(COSTM.estimate('conv', 4)));
  api.store.set('synth.cv.devFactor', 0);
  // the rack as built on the canvas: a stand-in FXRackUI records its options
  const got = [];
  class FXRec { constructor(box, host, opts) { got.push(opts); this.el = globalThis.document.createElement('div'); box.append(this.el); } refresh() {} destroy() {} paintMods() {} setLive() {} }
  const was = acc.uiLoad(Promise.resolve({ sx: { SerumUI: class {} }, fxui: { FXRackUI: FXRec }, wk: await import('../wk.js?v=9'), mod: {} }));
  try {
    cv.renderViews(); await s.settle(10); s.raf(); await s.settle(5);
    assert.ok(got.length > 0, 'an FX module built');
    assert.deepEqual([typeof got[0].cost, got[0].cost('rev'), got[0].v2Fx], ['function', cv.fx.cost('rev'), true], 'its cost: the host\'s');
  } finally { acc.uiLoad(was); }
  const st = api.addTrack(MODELS.find(m => m.id === 'serum'));
  assert.equal(api.sxHost(st, 'i1').fxCost('rev'), cv.fx.cost('rev'), 'a Serum\'s FX page: its host\'s fxCost');
  void sh;
});

/* ---------------------------------------------------------- stage-1b review fixes (lane 1) */
test('style.css, the layout the node tests cannot see (checked as text): dots own their coarse hit areas; the top tray\'s row stops are all content; the notice floats; ROLL scrolls to a 260 px roll; the top row folds at 840 / 740 px and scrolls below 600 px; the FX rack is no scroller in the world', () => {
  const CSS = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const rule = sel => { const i = CSS.indexOf('\n' + sel + ' {'); assert.ok(i >= 0, sel); return CSS.slice(i, CSS.indexOf('}', i)); };
  const at = w => { const i = CSS.indexOf(`@media (max-width: ${w}px) {`); assert.ok(i >= 0, w + ' px stage'); return CSS.slice(i, CSS.indexOf('\n}', i)); };
  assert.match(rule('.cv-dot'), /position: relative/, 'a dot is its ::after\'s containing block (else on iPad every dot covers the whole track group)');
  assert.match(CSS, /\.tb, \.tt, \.cv-tabs button, \.power, \.cv-dot \{ position: relative; \}/);
  assert.match(rule('.top.cv-top'), /height: calc\(var\(--cv-top, 48px\) \+ 1px \+ env\(safe-area-inset-top\)\)/, 'its hairline outside the row stop');
  assert.match(rule('.cv-top .arrwrap'), /border-top: 0/);
  assert.match(rule('.arrbar.cv-arrbar'), /border-bottom: 1px solid var\(--line\)/);
  assert.match(rule('.notice'), /position: absolute;.*bottom: calc\(100% \+ 24px\)/, 'out of flow: a notice never resizes the canvas');
  assert.match(rule('.cv-roll'), /overflow-y: auto/);
  assert.match(rule('.cv-roll .rollwrap'), /flex: 1 1 0; height: auto; min-height: 260px/);
  assert.match(rule('.cv-tmeta'), /text-wrap: balance/, 'year · maker wraps, never cut');
  assert.match(at(840), /\.cv-tchip \{ min-width: 44px;/);
  assert.match(at(740), /#engMore \{ display: grid; \}/);
  assert.match(at(740), /\.cv-ex\[data-open\] \{ display: flex; \}/);
  assert.match(at(600), /\.cv-row \{ overflow-x: auto;/);
  assert.match(at(600), /\.cv-row :is\(\.cv-pop, \.cv-tx, \.cv-ex\) \{ position: fixed;/);
  assert.match(CSS, /#world \.fxr-rack \{ max-height: none; overflow: visible; \}/, 'a pinch over the FX module zooms the camera, never the page');
  assert.match(CSS, /#viewport:not\(\[data-cv-native\]\) #world :is\(\.opswrap, [^)]*\.wte-strip\) \{ touch-action: pan-x pan-y; \}/);
});

test('narrow windows: "⏻ ▾" (#engMore) opens Power and the meter as a popover (#engPop[data-open]); Escape closes it', async () => {
  const s = await bootMain({}), sh = shellOf();
  assert.equal(sh.shell.menus.length, 6);
  s.$('#engMore').dispatchEvent({ type: 'click', detail: 1 });
  assert.deepEqual([s.$('#engPop').hasAttribute('data-open'), s.$('#engMore').getAttribute('aria-expanded')], [true, 'true']);
  assert.equal(sh.cvShellEscape(), true);
  assert.equal(s.$('#engPop').hasAttribute('data-open'), false);
});

test('Escape with a module selected: focus elsewhere (Hold, a key, a tray) panics at once and keeps the selection; focus on the canvas deselects first (SPEC §4.8, as the roll)', async () => {
  const s = await bootMain({}), W = globalThis.__synthTest.cv.world(), doc = globalThis.document, hold = s.$('#hold'), sh = shellOf();
  sh.shell.src.close();
  const esc = () => { const ev = { type: 'keydown', key: 'Escape', code: 'Escape', keyCode: 27, target: doc.activeElement || s.$('#keys'), defaultPrevented: false, isComposing: false,
    metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault() {}, stopPropagation() {} }; for (const f of s.dom.winL.keydown || []) f(ev); };
  try {
    W.select('i1');
    assert.equal(W.selected, 'i1');
    doc.activeElement = hold; hold.setAttribute('aria-pressed', 'true');
    esc();
    assert.deepEqual([W.selected, hold.getAttribute('aria-pressed')], ['i1', 'false'], 'focus on Hold: panic (sustain released), the selection kept');
    doc.activeElement = s.$('#viewport'); hold.setAttribute('aria-pressed', 'true');
    for (let i = 0; i < 3 && W.selected; i++) esc();
    assert.deepEqual([W.selected, hold.getAttribute('aria-pressed')], [null, 'true'], 'focus on the canvas: edit state / selection first, no panic');
    esc();
    assert.equal(hold.getAttribute('aria-pressed'), 'false', 'then panic');
  } finally { doc.activeElement = null; }
});

test('a Sources tile dragged over the canvas: the true-size outline sits on the instrument it replaces (a drop never moves it), not under the finger', async () => {
  const s = await bootMain({ hash: '#minimoog' }), sh = shellOf(), cv = globalThis.__synthTest.cv;
  const r0 = cv.view().modules.get('i1').rect();
  sh.srcDrag.begin('juno60', { over: 'canvas', x: 900, y: 700, left: true, pointerType: 'touch', t: 1 });
  const g = sh.shell.drop;
  assert.ok(g, 'an outline');
  assert.deepEqual([Math.round(g.x), Math.round(g.y), g.w], [Math.round(r0.x), Math.round(r0.y), cv.size('juno60').w], 'at the instrument\'s origin, the new size');
  assert.equal(sh.srcDrag.drop('juno60', { over: 'canvas', x: 900, y: 700 }), true);
  const r1 = cv.view().modules.get('i1').rect();
  assert.deepEqual([I(s.api.project().tracks[0]).model, r1.x, r1.y], ['juno60', r0.x, r0.y], 'replaced where the outline showed');
});

test('a project file from a newer SYNTH Canvas: read-only while it is the current project (nothing saved, Save off, the notice); Undo brings the user\'s own back and it saves again — the store is never locked (§5.8)', async () => {
  const ls = fakeStorage({});
  const s = await bootMain({ ls }), api = s.api, stored = () => JSON.parse(ls.m.get('synthc.project'));
  api.project().bpm = 133; api.save();
  assert.equal(stored().bpm, 133);
  const newer = Object.assign(JSON.parse(JSON.stringify(api.project())), { schema: CM.SCHEMA + 7, uid: 'p_future0001', bpm: 99, name: 'From the future' });
  const file = { name: 'future.synth.json', type: 'application/json', text: async () => JSON.stringify(newer) };
  await s.$('#fFile').onchange({ target: { files: [file], value: 'future.synth.json' } });
  assert.deepEqual([api.project().name, api.project().bpm, s.$('#fSave').disabled, s.$('#notice').textContent], ['From the future', 99, true, CM.READ_ONLY_NOTICE]);
  api.project().bpm = 98; api.save(); api.save(true);
  assert.deepEqual([stored().bpm, stored().name === 'From the future'], [133, false], 'never written while it is the current project');
  s.$('#tUndo').onclick(); s.raf();
  assert.deepEqual([api.project().bpm, s.$('#fSave').disabled], [133, false], 'Undo: the user\'s own project, Save on again');
  api.project().bpm = 137; api.save(true);
  assert.deepEqual([stored().bpm, api.store.info().readOnly], [137, false], 'its edits are saved: the store was never locked');
  s.$('#tRedo').onclick(); s.raf();
  assert.deepEqual([api.project().name, s.$('#fSave').disabled], ['From the future', true], 'Redo: the newer one, read-only again');
  api.save();
  assert.equal(stored().bpm, 137);
});

// (WC pre-deploy [toast]) the 8 s "· tap to undo" lay centred on the canvas toolbar's row: a tap meant for Fit / Tidy landed on it and undid the
// last step. main.js noticePlace puts it where cv-tray noticeSpot says over the boxes measured now (the iPad portrait boxes Chrome measured:
// the toolbar 56…427, its minimap, the keyboard's grip 468…556), again when the Sources tray opens (the toolbar moves past it); a tap on it
// still undoes
test('(WC pre-deploy [toast]) the notice line is placed off the canvas toolbar by cv-tray noticeSpot over the measured boxes: beside the toolbar\'s row (lifted clear of the keyboard\'s grip); placed again when the Sources tray opens and moves the toolbar; a tap on it still undoes; the roll (no toolbar): centred, clear of the grip', async () => {
  const s = await bootMain({ hash: '#minimoog' }), sh = shellOf(), api = s.api;
  const box = (sel, l, t, r, b) => { s.$(sel).getBoundingClientRect = () => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t }); };
  box('#stage', 0, 205, 1024, 1127); box('#perf', 0, 1127, 1024, 1366); box('#cvToolbar .cv-tb', 56, 1063, 427, 1115); box('#cvToolbar .cv-minimap', 56, 943, 232, 1055);
  box('#kbGrip', 468, 1096, 556, 1140); box('#srcTab', 0, 622, 44, 710); box('#notice', 0, 0, 296.8, 30.8);
  s.$('#srcTray').offsetWidth = 240; s.$('#srcTab').offsetWidth = 44;
  sh.shell.src.close();
  sh.srcPick('prophet5', 'replace');
  const N = s.$('#notice'), spot = () => [N.style.left, N.style.bottom, N.style.maxWidth, N.style.transform];
  assert.match(N.textContent, /^Replaced Minimoog with Prophet-5 · .*tap to undo$/);
  const q = cvTray.noticeSpot({ stage: { left: 0, top: 205, right: 1024, bottom: 1127 }, bar: { left: 56, top: 1063, right: 427, bottom: 1115 }, map: { left: 56, top: 943, right: 232, bottom: 1055 },
    grip: { left: 468, top: 1096, right: 556, bottom: 1140 }, tray: null, tab: { left: 0, top: 622, right: 44, bottom: 710 }, w: 296.8, h: 30.8 });
  assert.deepEqual([q.x, q.bottom], [439, 1092], 'beside the toolbar, lifted clear of the grip');
  assert.deepEqual(spot(), ['439px', 'calc(100% + 35px)', '573px', 'none'], 'placed: its left, its foot over the keyboard tray\'s edge, its room');
  // the tray opens: the toolbar moves past it (style.css .cv-left-open) — the notice follows
  box('#cvToolbar .cv-tb', 296, 1063, 667, 1115); box('#cvToolbar .cv-minimap', 296, 943, 472, 1055);
  sh.shell.src.open();
  assert.deepEqual(spot(), ['679px', 'calc(100% + 23px)', '333px', 'none'], 'beside the moved toolbar, on its row\'s centre line');
  N.onclick(); s.raf();
  assert.deepEqual([CMOD.instOf(api.project().tracks[0]).model, N.hidden], ['minimoog', true], 'a tap on it still undoes');
  // the roll: the canvas hidden (no toolbar, minimap, tray or tab there: empty boxes) — centred over the stage, clear of the grip
  for (const sel of ['#cvToolbar .cv-tb', '#cvToolbar .cv-minimap', '#srcTray', '#srcTab']) box(sel, 0, 0, 0, 0);
  sh.srcPick('prophet5', 'replace');
  assert.deepEqual(spot(), ['364px', 'calc(100% + 35px)', '620px', 'none'], 'centred (12…1012), clear of the grip');
});

// (WC pre-deploy [toast], round 2 — the skeptic) a narrow window (Slide Over / a 1/3 split, 375 px) with the Sources tray open: no room of the
// three cleared the tray, so the line kept the stylesheet's spot — over the tiles, the toolbar's fold button and the grips. main.js measures
// the line at the width it would take (its wrap: a word carried down makes a line more than the estimate) and passes the top grip too
test('(WC pre-deploy [toast], round 2) a 375 px window with the Sources tray open: the notice goes in the free column right of the tray, by its measured wrap — clear of the tray, its tab, the toolbar, the minimap and both grips; a tap on it still undoes; a short window: never over the track list\'s rows that run over the stage', async () => {
  const s = await bootMain({ hash: '#minimoog' }), sh = shellOf(), api = s.api;
  const box = (sel, l, t, r, b) => { s.$(sel).getBoundingClientRect = () => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t }); };
  const B = { stage: [0, 205, 375, 791], perf: [0, 791, 375, 1024], bar: [296, 727, 667, 779], map: [296, 607, 472, 719], grip: [144, 760, 232, 804], tab: [240, 454, 284, 542], top: [144, 192, 232, 236] };
  box('#stage', ...B.stage); box('#perf', ...B.perf); box('#cvToolbar .cv-tb', ...B.bar); box('#cvToolbar .cv-minimap', ...B.map); box('#kbGrip', ...B.grip); box('#srcTab', ...B.tab); box('#topGrip', ...B.top);
  box('#srcTray', 0, 205, 240, 791); s.$('#srcTray').offsetWidth = 240; s.$('#srcTab').offsetWidth = 44;
  // the line's size at its max width: one line of 296.8 × 30.8; narrower, a wrap that carries a word down (16.8 px a line)
  const N = s.$('#notice'), wrap = mw => { const lines = mw > 0 && mw < 296.8 ? Math.ceil(296.8 / (mw - 40) - 1e-9) : 1; return { w: Math.min(296.8, mw > 0 ? mw : 296.8), h: 30.8 + (lines - 1) * 16.8 }; };
  N.getBoundingClientRect = () => { const z = wrap(parseFloat(N.style.maxWidth)); return { left: 0, top: 0, right: z.w, bottom: z.h, width: z.w, height: z.h, x: 0, y: 0 }; };
  sh.shell.src.open();
  sh.srcPick('prophet5', 'replace');
  assert.match(N.textContent, /^Replaced Minimoog with Prophet-5 · .*tap to undo$/);
  assert.equal(N.style.transform, 'none', 'placed (not the stylesheet\'s centred spot)');
  const x = parseFloat(N.style.left) + B.perf[0], foot = B.stage[3] - +/calc\(100% \+ (-?[\d.]+)px\)/.exec(N.style.bottom)[1], z = wrap(parseFloat(N.style.maxWidth));
  const r = [x, foot - z.h, x + z.w, foot], cross = b => r[0] < b[2] && r[2] > b[0] && r[1] < b[3] && r[3] > b[1];
  for (const k of ['bar', 'map', 'grip', 'tab', 'top']) assert.ok(!cross(B[k]), `clear of the ${k} (${r.map(Math.round)})`);
  assert.ok(r[0] >= 240 && r[2] <= 375 && r[1] >= 205 && r[3] <= 791, `right of the tray, inside the stage (${r.map(Math.round)})`);
  assert.ok(parseFloat(N.style.maxWidth) >= cvTray.NOTICE_FLOOR, 'a readable column');
  N.onclick(); s.raf();
  assert.deepEqual([CMOD.instOf(api.project().tracks[0]).model, N.hidden], ['minimoog', true], 'a tap on it still undoes');
  // a short window (700 × 500, the tray pulled to 440): the track list's rows run over the stage's top (its Master row to 124) — the stage
  // is taken from there: never over them; the toolbar, the minimap and the tab fill the canvas's 260 px, so the line gives up the minimap only
  const C = { stage: [0, 66, 700, 305], perf: [0, 305, 700, 500], bar: [496, 241, 867, 293], map: [496, 121, 672, 233], grip: [306, 274, 394, 318], tab: [440, 142, 484, 230], top: [306, 53, 394, 97] };
  box('#stage', ...C.stage); box('#perf', ...C.perf); box('#cvToolbar .cv-tb', ...C.bar); box('#cvToolbar .cv-minimap', ...C.map); box('#kbGrip', ...C.grip); box('#srcTab', ...C.tab); box('#topGrip', ...C.top);
  box('#topRow', 0, 0, 700, 48); box('#arrbar', 0, 48, 700, 80); box('#studio', 0, 80, 700, 80); box('#mfoot', 0, 80, 700, 124);
  box('#srcTray', 0, 66, 440, 305); s.$('#srcTray').offsetWidth = 440;
  sh.srcPick('prophet5', 'replace');
  assert.equal(N.style.transform, 'none', 'placed');
  const x2 = parseFloat(N.style.left) + C.perf[0], foot2 = C.stage[3] - +/calc\(100% \+ (-?[\d.]+)px\)/.exec(N.style.bottom)[1], z2 = wrap(parseFloat(N.style.maxWidth));
  const r2 = [x2, foot2 - z2.h, x2 + z2.w, foot2], cross2 = b => r2[0] < b[2] && r2[2] > b[0] && r2[1] < b[3] && r2[3] > b[1];
  assert.ok(r2[1] >= 124, `under the track list's rows (${r2.map(Math.round)})`);
  for (const k of ['bar', 'grip', 'tab', 'top']) assert.ok(!cross2(C[k]), `clear of the ${k} (${r2.map(Math.round)})`);
  assert.ok(r2[0] >= 440 && r2[2] <= 700 && r2[3] <= 305, `right of the tray, inside the stage (${r2.map(Math.round)})`);
});
