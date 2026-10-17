// The installed-app layer on iPad and iPhone (owner I; pwa.js in the page simulation, tests/main-sim.mjs): iPadOS
// Safari (a desktop-class user agent with touch, WebKit-prefixed full screen) shows Full screen and Install app; Install
// app opens the Share → Add to Home Screen sheet (keys do not play behind it; Escape, Done or the backdrop close it); in
// the home-screen app (navigator.standalone) both buttons go and persistent storage is asked for, and the files the
// page hands over (Save, Export MIDI, Bounce WAV) go to the share sheet — after a fresh tap when the first has expired.
// An iPhone (no element full screen in Safari) shows Install app only, with the iPhone's steps; Chrome on iPad its own.
// Run: node --test tests/app-ios.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootMain, makeDom } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';

const N = /const VERSION = '(\d+)'/.exec(readFileSync(new URL('../main.js', import.meta.url), 'utf8'))[1];
const { initApp } = await import('../pwa.js?v=' + N);
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const IPAD_CHROME = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1';
const text = el => (el.children && el.children.length ? el.children.map(text).join('') : el.textContent || '');

// the storage of a device that used build 8's interface size (uiscale.js, removed by ruling Z1): its key at 125 %
const LS = fakeStorage({ 'synth-ui.scale': '1.25' });
let sim = null;
async function page() {
  if (!sim) { sim = await bootMain({ ua: IPAD, platform: 'MacIntel', touch: true, fs: 'webkit', ls: LS }); await sim.settle(20); }
  return sim;
}

test('iPad Safari: Full screen (WebKit-prefixed API) and Install app both shown; full screen toggles; the first time, a word that the installed app is the full screen without WebKit\'s warning', async () => {
  const s = await page(), fs = s.$('#fullscreen'), ins = s.$('#install'), note = s.$('#notice');
  assert.equal(s.api.app().platform.ipad, true);
  assert.deepEqual([fs.hidden, ins.hidden], [false, false]);
  fs.click();
  await s.settle();
  assert.deepEqual(s.fsCalls, [['enter', undefined]], 'webkitRequestFullscreen on the page');
  assert.equal(fs.getAttribute('aria-pressed'), 'true');
  assert.match(note.textContent, /full screen may stop fast playing with a warning — Install app gives SYNTH a full screen of its own/);
  // any pinch may leave WebKit's full screen (227387): with ruling Z1 the page's own zoom too, not only the Piano Roll's
  assert.match(note.textContent, /A pinch may also leave the browser’s full screen\.$/);
  assert.doesNotMatch(note.textContent, /Piano Roll/);
  fs.click();
  await s.settle();
  assert.deepEqual(s.fsCalls.at(-1), ['exit']);
  assert.equal(fs.getAttribute('aria-pressed'), 'false');
  s.api.notice('', 0);
  fs.click(); await s.settle();
  assert.equal(note.textContent, '', 'said once');
  fs.click(); await s.settle();
});

test('iPad Safari: Install app opens the Add to Home Screen sheet for Safari on iPad; computer keys do not play behind it; Escape, Done and the backdrop close it', async () => {
  const s = await page(), { api } = s, sheet = s.$('#installSheet');
  assert.equal(sheet.hidden, true);
  s.$('#install').click();
  assert.equal(sheet.hidden, false);
  assert.equal(s.$('#insTitle').textContent, 'Install SYNTH on your iPad');
  const steps = s.$('#insSteps').children.map(text);
  assert.equal(steps.length, 3);
  assert.match(steps[0], /^Tap Share: in Safari in the toolbar at the top \(or under \), in Chrome at the right of the address bar/, 'a desktop user agent: Safari or Chrome');
  assert.match(steps[1], /Add to Home Screen/);
  assert.equal(s.$('#insSteps').children[0].children.filter(c => c.tagName === 'SVG').length, 2, 'Share (and •••) icons in the step');
  assert.match(s.$('#insNote').textContent, /separate from the browser’s/);
  assert.equal(api.app().sheetOpen(), true);
  s.key('KeyA', true, { key: 'a' });
  assert.equal(api.held.size, 0, 'no note while the sheet is open');
  s.key('KeyA', false, { key: 'a' });
  s.key('Escape', true, { key: 'Escape' });
  assert.equal(sheet.hidden, true, 'Escape closes it');
  s.key('KeyA', true, { key: 'a' });
  assert.equal(api.held.size, 1, 'the keys play again');
  s.key('KeyA', false, { key: 'a' });
  await s.settle(10);
  s.$('#install').click();
  s.$('#insClose').click();
  assert.equal(sheet.hidden, true, 'Done');
  s.$('#install').click();
  for (const f of sheet.listeners.pointerdown || []) f({ target: sheet });
  assert.equal(sheet.hidden, true, 'a tap beside the dialog');
  // a finger closes it on the tap's release: a pan, or a two-finger gesture (gesture.js's flagged pointercancel), leaves it open
  const P = (type, o) => { for (const f of sheet.listeners[type] || []) f(Object.assign({ type, target: sheet, pointerId: 7, pointerType: 'touch', clientX: 100, clientY: 100 }, o)); };
  s.$('#install').click();
  P('pointerdown');
  assert.equal(sheet.hidden, false, 'not at the press');
  P('pointercancel', { gesture: 'two-finger' }); P('pointerup');
  assert.equal(sheet.hidden, false, 'cancelled: still open');
  P('pointerdown'); P('pointerup', { clientX: 140 });
  assert.equal(sheet.hidden, false, 'a 40 px drag is no tap');
  P('pointerdown'); P('pointerup', { clientX: 104 });
  assert.equal(sheet.hidden, true, 'a tap closes it');
});

test('iPad home-screen app (navigator.standalone): no Full screen, no Install app, the sheet closed; persistent storage asked once', async () => {
  const s = await page(), app = s.api.app();
  s.$('#install').click();
  assert.equal(app.sheetOpen(), true);
  assert.deepEqual(s.persist, []);
  globalThis.navigator.standalone = true;
  try {
    app.sync();
    assert.deepEqual([s.$('#fullscreen').hidden, s.$('#install').hidden, app.sheetOpen()], [true, true, false]);
    await s.settle();
    assert.deepEqual(s.persist, ['persisted', 'persist']);
    app.sync(); await s.settle();
    assert.deepEqual(s.persist, ['persisted', 'persist'], 'once');
  } finally { delete globalThis.navigator.standalone; }
});

// pwa.js initApp on the simulation's DOM stub alone (no page): other devices
function bare(nav, o = {}) {
  const dom = makeDom(), win = { addEventListener() {}, matchMedia: q => ({ matches: !!o.display && q.includes(o.display) }) };
  for (const id of ['install', 'fullscreen', 'installSheet', 'update']) dom.document.querySelector('#' + id).hidden = true;
  if (o.fs) { dom.document.fullscreenEnabled = true; dom.document.fullscreenElement = null; dom.document.documentElement.requestFullscreen = () => Promise.resolve(); }
  else { dom.document.fullscreenEnabled = undefined; dom.document.webkitFullscreenEnabled = undefined; dom.document.documentElement.requestFullscreen = undefined; dom.document.documentElement.webkitRequestFullscreen = undefined; }
  dom.document.readyState = 'complete';
  const app = initApp({ win, doc: dom.document, nav, loc: { protocol: 'https:', hostname: 'synth.test', reload() {} }, version: N });
  return { app, $: id => dom.document.querySelector('#' + id) };
}

test('iPhone Safari (no element full screen): Install app instead of Full screen, with the iPhone\'s steps; Chrome on iPad: its address-bar Share; standalone (display-mode): nothing', () => {
  let B = bare({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 });
  assert.deepEqual([B.$('fullscreen').hidden, B.$('install').hidden], [true, false]);
  B.$('install').click();
  assert.equal(B.$('installSheet').hidden, false);
  assert.equal(B.$('insTitle').textContent, 'Install SYNTH on your iPhone');
  assert.match(text(B.$('insSteps').children[0]), /^Tap Share in Safari’s toolbar \(/);
  B = bare({ userAgent: IPAD_CHROME, platform: 'iPad', maxTouchPoints: 5 });
  assert.deepEqual([B.$('fullscreen').hidden, B.$('install').hidden], [true, false], 'Chrome on iPad (no element full screen in its web view)');
  B.$('install').click();
  assert.match(text(B.$('insSteps').children[0]), /Share at the right of Chrome’s address bar/);
  B = bare({ userAgent: IPAD, platform: 'MacIntel', maxTouchPoints: 5 }, { fs: true, display: 'standalone' });
  assert.deepEqual([B.$('fullscreen').hidden, B.$('install').hidden], [true, true], 'the installed app (display-mode: standalone)');
  B = bare({ userAgent: ANDROID, platform: 'Linux armv81', maxTouchPoints: 5 }, { fs: true, display: 'fullscreen' });
  assert.deepEqual([B.$('fullscreen').hidden, B.$('install').hidden], [true, true], 'Android: display_override fullscreen');
  B = bare({ userAgent: IPAD, platform: 'MacIntel', maxTouchPoints: 5 }, { fs: true, display: 'fullscreen' });
  assert.deepEqual([B.$('fullscreen').hidden, B.$('install').hidden], [false, false], 'a browser window in full screen is not the installed app');
});

test('iPad home-screen app: Export MIDI, Save and Bounce WAV hand their file to the share sheet (Save to Files) — an expired tap is asked for again on the notice line, or by Save WAV… in the bounce dialog; refused twice, the download link; a browser tab downloads as before', async () => {
  const s = await page(), nav = globalThis.navigator, note = s.$('#notice'), shared = [], links = [];
  const realURL = URL.createObjectURL;
  URL.createObjectURL = b => { links.push(b); return 'blob:sim/' + links.length; };
  const refuse = name => () => Promise.reject(Object.assign(new Error('refused'), { name }));
  let answer = () => Promise.resolve();
  nav.canShare = d => !!(d && d.files && d.files.length);
  nav.share = d => { shared.push(d.files[0]); return answer(d); };
  try {
    s.$('#fMidi').click();
    assert.deepEqual([links.length, shared.length], [1, 0], 'a browser tab: the download link');
    nav.standalone = true;
    s.$('#fMidi').click();
    assert.deepEqual([links.length, shared.length], [1, 1], 'the home-screen app: the share sheet');
    assert.ok(shared[0] instanceof File);
    assert.match(shared[0].name, /\.mid$/);
    assert.equal(shared[0].type, 'audio/midi');
    // the tap has expired by the time the file is ready (navigator.userActivation): a tap on the notice line shares it
    nav.userActivation = { isActive: false };
    s.$('#fMidi').click();
    assert.equal(shared.length, 1);
    assert.match(note.textContent, /\.mid is ready — tap here to save or share it$/);
    assert.equal(note.dataset.act, '1');
    nav.userActivation = { isActive: true };
    note.click();
    assert.equal(shared.length, 2);
    assert.equal(note.textContent, '');
    // no userActivation API: the share refused (NotAllowedError) → the notice line; refused again → the download link
    delete nav.userActivation;
    answer = refuse('NotAllowedError');
    s.$('#fMidi').click(); await s.settle();
    assert.match(note.textContent, /is ready — tap here/);
    note.click(); await s.settle();
    assert.deepEqual([links.length, shared.length], [2, 4]);
    // the sheet closed by the user: nothing else
    answer = refuse('AbortError');
    s.$('#fMidi').click(); await s.settle();
    assert.deepEqual([links.length, shared.length], [2, 5]);
    // a file the sheet does not take (canShare false): the link
    nav.canShare = () => false;
    s.$('#fMidi').click();
    assert.deepEqual([links.length, shared.length], [3, 5]);
    nav.canShare = d => !!(d && d.files && d.files.length);
    // Save (the project file, made asynchronously)
    answer = () => Promise.resolve();
    s.$('#fSave').click(); await s.settle(20);
    assert.equal(shared.length, 6);
    assert.match(shared[5].name, /\.synth\.json$/);
    assert.equal(shared[5].type, 'application/json');
    // Bounce WAV: the render outlives the tap — the dialog's button becomes Save WAV…
    const p = s.api.project(), tr = p.tracks[0];
    tr.notes.push({ id: 'n-share', t: 0, d: 240, n: 60, v: 100 });
    p.loop.start = 0; p.loop.end = 480;
    s.$('#fBounce').click();
    const go = s.$('#bGo'), bn = s.$('#bNote');
    assert.equal(go.textContent, 'Render & download');
    Object.assign(s.$('#bRange'), { value: 'loop' }); Object.assign(s.$('#bSr'), { value: '44100' }); Object.assign(s.$('#bBits'), { value: '16' });
    Object.assign(s.$('#bOs'), { value: '2' }); Object.assign(s.$('#bTail'), { value: '0' }); s.$('#bNorm').checked = false;
    nav.userActivation = { isActive: false };
    go.click();
    for (let k = 0; k < 600 && !/^(Done|Render failed|No audible)/.test(bn.textContent); k++) await s.settle(10);
    assert.match(bn.textContent, /^Done: .* Tap Save WAV… to keep the file\.$/);
    assert.equal(go.textContent, 'Save WAV…');
    assert.equal(go.disabled, false);
    assert.equal(shared.length, 6);
    nav.userActivation = { isActive: true };
    go.click();
    assert.equal(shared.length, 7);
    assert.match(shared[6].name, /\.wav$/);
    assert.equal(shared[6].type, 'audio/wav');
    assert.ok(shared[6].size > 44 + 0.2 * 44100 * 4, 'the rendered WAV (16-bit stereo)');
    assert.equal(go.textContent, 'Render & download', 'back to rendering');
    assert.equal(links.length, 3);
    s.$('#bCancel').click();
  } finally {
    URL.createObjectURL = realURL;
    for (const k of ['standalone', 'canShare', 'share', 'userActivation']) delete nav[k];
    s.api.notice('', 0);
  }
});

test('iPad: no interface size of the app\'s own (ruling Z1: the page\'s pinch-zoom is the browser\'s) — build 8\'s stored size is main\'s key, left alone by the canvas build (SPEC-canvas §5.6: it never touches main\'s storage), the viewport meta never written, no html[data-uiz], no test hook for it', async () => {
  const s = await page();
  assert.equal(LS.getItem('synth-ui.scale'), '1.25', 'main\'s key left alone (the canvas build shares localhost with main)');
  assert.equal(LS.writes.filter(k => /synth-ui\.scale/.test(k)).length, 0, 'never written nor removed: ' + LS.writes.join());
  assert.equal(s.$('meta[name="viewport"]').getAttribute('content'), null);
  assert.equal(s.dom.document.documentElement.hasAttribute('data-uiz'), false);
  assert.equal(s.api.uiz, undefined);
});
