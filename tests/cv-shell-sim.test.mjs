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

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const shellOf = () => globalThis.__synthTest.shell;
const fn = v => typeof v === 'function';
const bound = (el, type) => fn(el['on' + type]) || ((el.listeners && el.listeners[type]) || []).length > 0;
const resize = async (s, w, h) => { if (w) globalThis.innerWidth = w; if (h) globalThis.innerHeight = h; for (const f of s.dom.winL.resize || []) f({ type: 'resize' }); await s.settle(160); };

test('index.html: the shell of IMPL-1b §3.1 — every id of the tree and of today\'s controls (§7 rows 1–11), once; the model nav, the FX tab and the old tabs gone; no inline script', () => {
  const ids = ['app', 'topTray', 'topRow', 'appMenuBtn', 'appMenu', 'fNew', 'fOpen', 'fFile', 'fSave', 'fMidi', 'fBounce', 'install', 'fullscreen', 'helpBtn',
    'transport', 'tStart', 'tPlay', 'tRec', 'tBBT', 'tTime', 'tBpm', 'tSigN', 'tSigD', 'tLoop', 'tMetro', 'tCount', 'tUndo', 'tRedo', 'trkChip', 'trkDots', 'tabTrack',
    'engMore', 'engPop', 'power', 'master', 'masterG', 'rate', 'cpu', 'latL', 'lat', 'latPop', 'gearBtn', 'gearPop', 'sr', 'os', 'drift', 'tRecMode', 'tInQ', 'pinchMode',
    'arrbar', 'aAdd', 'aMulti', 'aRange', 'aCopy', 'aPaste', 'aDup', 'aClear', 'aDel', 'aIns', 'aLoopSel', 'tBars', 'studio', 'arrwrap', 'heads', 'lanes', 'topGrip',
    'stage', 'tab-inst', 'viewport', 'world', 'cvParts', 'inst', 'boot', 'fxrack', 'scope', 'about-title', 'about', 'algo', 'overlay', 'cvToolbar',
    'srcTray', 'srcGrip', 'fxTray', 'tab-roll', 'rolltools', 'rollwrap', 'perf', 'kbGrip', 'notice', 'kbrow', 'keys', 'helpParts', 'ov',
    'modal', 'installSheet', 'update', 'tip'];
  for (const id of ids) assert.equal((HTML.match(new RegExp(`\\sid="${id}"`, 'g')) || []).length, 1, id);
  for (const gone of ['id="models"', 'id="tab-fx"', 'id="fxtitle"', 'data-tab="inst"', 'data-tab="fx"', 'class="console"', '<footer']) assert.ok(!HTML.includes(gone), gone);
  assert.match(HTML, /<div id="world" class="cv-world" data-cv-world>/);
  assert.match(HTML, /<div id="viewport" class="cv-viewport" tabindex="0" aria-label="Track canvas">/);
  assert.match(HTML, /<aside id="srcTray"[^>]*data-wk-inset="left"/);
  assert.match(HTML, /<aside id="fxTray"[^>]*data-wk-inset="right"/);
  assert.match(HTML, /<button type="button" data-tab="canvas"[^>]*>Canvas<\/button>\s*<button type="button" data-tab="roll"/);
  // the parts the modules take: inside #world, not hidden
  const parts = HTML.slice(HTML.indexOf('id="cvParts"'), HTML.indexOf('id="overlay"'));
  for (const id of ['inst', 'fxrack', 'scope']) assert.ok(parts.includes(`id="${id}"`), id + ' inside #cvParts');
  assert.doesNotMatch(/<div id="cvParts"[^>]*>/.exec(HTML)[0], /hidden/);
  // help kept for the ≡ → Help sheet
  assert.match(HTML.slice(HTML.indexOf('id="helpParts"')), /^[^]*?<p class="help"><b>Play:<\/b>[^]*installed app keeps its own projects[^]*<div class="foot">/);
  assert.deepEqual([...HTML.matchAll(/<script\b([^>]*)>/g)].map(m => m[1]).filter(a => !/\ssrc=/.test(a)), []);
});

test('boot: today\'s controls keep their handlers in the shell (transport, ≡ file items, arrangement toolbar, ⚙ settings, engine), the menus are wired', async () => {
  const s = await bootMain({});
  const click = ['tStart', 'tPlay', 'tRec', 'tLoop', 'tMetro', 'tInQ', 'tUndo', 'tRedo', 'fNew', 'fOpen', 'fSave', 'fMidi', 'fBounce', 'aAdd', 'aMulti',
    'aCopy', 'aPaste', 'aDup', 'aClear', 'aDel', 'aIns', 'aLoopSel', 'power', 'fullscreen', 'helpBtn', 'srcClose', 'fxClose', 'octdn', 'octup', 'panic', 'hold', 'kbHide'];
  for (const id of click) assert.ok(bound(s.$('#' + id), 'click'), id + ' click');
  for (const id of ['tCount', 'tRecMode', 'tSigD', 'fFile', 'sr', 'os', 'pinchMode', 'tBpm', 'tSigN', 'tBars']) assert.ok(bound(s.$('#' + id), 'change'), id + ' change');
  for (const id of ['drift', 'master', 'masterG']) assert.ok(bound(s.$('#' + id), 'input'), id + ' input');
  // ⚙'s master level (shown where the top row's folds away, ≤ 1099 px) drives the master level through #master's handler
  s.$('#masterG').value = '0.42'; s.$('#masterG').oninput();
  assert.deepEqual([s.api.settings().master, s.$('#master').value], [0.42, '0.42'], 'the ⚙ mirror sets the master level');
  for (const id of ['appMenuBtn', 'gearBtn', 'tMore', 'aBars', 'trkChip', 'engMore', 'srcRail', 'fxRail', 'meter', 'rollhelp']) assert.ok(bound(s.$('#' + id), 'click'), id + ' (menu / tray) click');
  for (const id of ['topGrip', 'kbGrip', 'srcGrip']) assert.ok(bound(s.$('#' + id), 'pointerdown') && bound(s.$('#' + id), 'keydown') || bound(s.$('#' + id), 'pointerdown'), id + ' grip');
  assert.equal(s.$('#topGrip').getAttribute('role'), 'slider');
  assert.equal(s.$('#topGrip').getAttribute('aria-valuenow'), '160', 'first run: one track row shown (the arrangement toolbar, the ruler, the row)');
  // the selected track in the top row
  const t = s.api.project().tracks[0];
  assert.equal(s.$('#trkChip .cv-cn').textContent, t.name);
  assert.match(s.$('#trkChip .cv-cv').textContent, new RegExp('^' + MODELS.find(m => m.id === t.model).name + ' · '));
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

test('+ Track opens the Sources tray in "new track" mode; a tile tap there adds a track with that instrument (one undo step) and closes the tray', async () => {
  const s = await bootMain({ hash: '#minimoog' }), sh = shellOf(), api = s.api;
  s.$('#aAdd').onclick();
  assert.deepEqual([sh.shell.src.isOpen(), sh.shell.tiles.mode()], [true, 'track']);
  assert.match(s.$('#srcMode').children.map(c => c.textContent || '').join(''), /a new track/);
  const n0 = api.project().tracks.length;
  sh.srcPick('dx7', sh.shell.tiles.mode());
  const P = api.project();
  assert.equal(P.tracks.length, n0 + 1);
  assert.equal(P.tracks.at(-1).model, 'dx7');
  assert.equal(P.selTrack, P.tracks.at(-1).id, 'the new track selected');
  assert.equal(sh.shell.src.isOpen(), false, 'closed');
  s.$('#tUndo').onclick(); s.raf();
  assert.equal(api.project().tracks.length, n0, 'one undo step');
  // the rail opens it in "replace" mode
  s.$('#aAdd').onclick(); sh.shell.src.close();
  sh.shell.src.open();
  assert.equal(sh.shell.tiles.mode(), 'replace');
});

test('Sources tray, replace mode: a tap replaces the selected track\'s instrument (one undo step, the undo notice); the same model does nothing', async () => {
  const s = await bootMain({ hash: '#minimoog' }), sh = shellOf(), api = s.api;
  sh.cvOpenSources('replace');
  const t = api.project().tracks[0];
  assert.equal(t.model, 'minimoog');
  sh.srcPick('prophet5', 'replace');
  assert.equal(api.project().tracks[0].model, 'prophet5');
  assert.equal(api.project().tracks.length, 1);
  assert.equal(sh.shell.src.isOpen(), true, 'the tray stays open (audition another)');
  assert.match(s.$('#notice').textContent, /^Replaced Minimoog with Prophet-5/);
  s.$('#tUndo').onclick(); s.raf();
  assert.equal(api.project().tracks[0].model, 'minimoog', 'one undo step');
  s.$('#tUndo').onclick(); s.raf();
  assert.equal(api.project().tracks[0].model, 'minimoog');
  const n = api.project().tracks.length;
  sh.srcPick('minimoog', 'replace');
  assert.deepEqual([api.project().tracks[0].model, api.project().tracks.length], ['minimoog', n], 'the same model: nothing');
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
  assert.deepEqual([api.project().tracks.length, api.project().tracks.at(-1).model], [n0 + 1, 'juno60']);
  s.$('#tUndo').onclick(); s.raf();
  assert.equal(api.project().tracks.length, n0, 'one undo step');
  sh.srcDrag.move('dx7', i('canvas'));
  assert.equal(sh.srcDrag.drop('dx7', i('canvas')), true);
  assert.equal(api.project().tracks[0].model, 'dx7', 'replaced in place');
  assert.equal(sh.srcDrag.drop('obxa', i(null)), false);
  assert.equal(api.project().tracks[0].model, 'dx7', 'elsewhere: nothing');
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
  // the top tray: one row by default; its stops follow the track count
  assert.equal(sh.topWant(), 160);
  for (let k = 0; k < 4; k++) api.addTrack();
  assert.equal(sh.topMaxH(), 384, 'five tracks: 48 + 32 + 24 + 5 · 56');
  sh.topSet(272, 'end');
  assert.equal(sh.shell.topShown, 272);
  assert.deepEqual(JSON.parse(ls.m.get('synthc.cv.trays')), { top: 272, topLast: 272 }, 'persisted');
  assert.equal(s.$('#topGrip').getAttribute('aria-valuenow'), '272');
  assert.equal(s.$('#topGrip').getAttribute('aria-valuetext'), '3 track rows');
  // the top tray leads: a short window lowers the keys, never below 70 px
  await resize(s, 1400, 700);
  assert.equal(sh.shell.topShown, 272);
  assert.equal(api.kb().h, Math.max(70, 700 - 240 - 272 - chrome), 'the keys pushed (' + api.kb().h + ')');
  // the keyboard leads again (a key on its grip): the top tray is pushed instead
  const g = s.$('#kbGrip');
  g.dispatchEvent({ type: 'keydown', key: 'End', shiftKey: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(api.kb().h, api.kbMaxH(chrome));
  assert.equal(sh.shell.topShown, Math.max(48, 700 - 240 - chrome - api.kb().h), 'the top tray folds toward its row');
  // fold toggle (double-tap): folded ↔ the last height
  await resize(s, 1400, 900);
  sh.topToggle();
  assert.equal(sh.shell.topShown, 48);
  assert.equal(JSON.parse(ls.m.get('synthc.cv.trays')).top, 48);
  sh.topToggle();
  assert.equal(sh.shell.topShown, 272, 'the last height again');
  sh.topSet(0, 'reset');
  assert.equal(sh.shell.topShown, 48, 'reset (Enter) from open: folded');
  sh.topSet(0, 'reset');
  assert.equal(sh.shell.topShown, 160, 'and from folded: one row');
  // a two-finger cancel of a drag: as it was, nothing saved
  const saved = ls.m.get('synthc.cv.trays');
  sh.topSet(216, 'move');
  assert.equal(sh.shell.topShown, 216);
  sh.topSet(160, 'cancel');
  assert.deepEqual([sh.shell.topShown, ls.m.get('synthc.cv.trays')], [160, saved]);
  // the prefs come back in the next session
  const s2 = await bootMain({ ls });
  assert.equal(shellOf().shell.topShown, 160);
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
  sh.shell.fx.open();
  assert.equal(sh.cvShellEscape(), true, 'the Effects tray');
  assert.equal(sh.cvShellEscape(), false, 'nothing left');
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

test('side trays: both may stay open on a wide window; at portrait width (< 1100 px) the one not in use folds to its rail; their open state and width come back', async () => {
  const ls = fakeStorage({});
  const s = await bootMain({ ls }), sh = shellOf();
  sh.shell.src.open(); sh.shell.fx.open();
  assert.deepEqual([sh.shell.src.isOpen(), sh.shell.fx.isOpen()], [true, true], 'wide: both');
  sh.shell.fx.close();
  globalThis.innerWidth = 834;
  sh.shell.fx.open();
  assert.deepEqual([sh.shell.src.isOpen(), sh.shell.fx.isOpen()], [false, true], 'portrait: the other folds');
  sh.shell.src.open();
  assert.deepEqual([sh.shell.src.isOpen(), sh.shell.fx.isOpen()], [true, false]);
  globalThis.innerWidth = 1400;
  assert.deepEqual(JSON.parse(ls.m.get('synthc.cv.trays')), { src: { open: true, w: 240 }, fx: { open: false, w: 240 } });
  const s2 = await bootMain({ ls });
  assert.deepEqual([shellOf().shell.src.isOpen(), shellOf().shell.fx.isOpen()], [true, false], 'restored');
  void s; void s2;
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
  sh.shell.src.close(); sh.shell.fx.close();
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
  assert.deepEqual([s.api.project().tracks[0].model, r1.x, r1.y], ['juno60', r0.x, r0.y], 'replaced where the outline showed');
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
