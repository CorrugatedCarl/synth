// The installed-app layer in the page simulation (owner I; pwa.js wired by main.js, tests/main-sim.mjs): a desktop
// Chrome on https — the header's Full screen button (Fullscreen API, aria-pressed), Install app through the browser's
// beforeinstallprompt, persistent storage once installed, the service worker's registration and the update flow (a
// waiting worker adopted quietly by a page that already is its version; otherwise the "Update available — Reload"
// toast, which saves the project before the worker takes over and the page reloads; never a reload by itself). On pwa.js
// alone: a worker already installing when register() resolves, a toast put off with × shown again an hour later, a save
// that never finishes not holding the update. An iPad / iPhone in tests/app-ios.test.mjs.
// Run: node --test tests/app.test.mjs
import './v8-guard.mjs';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootMain, makeDom } from './main-sim.mjs';
import { fakeStorage, fakeIDB } from './fakes.mjs';

const N = /const VERSION = '(\d+)'/.exec(readFileSync(new URL('../main.js', import.meta.url), 'utf8'))[1];
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const { initApp } = await import('../pwa.js?v=' + N);
const later = ms => new Promise(r => setTimeout(r, ms));

// navigator.serviceWorker: register() → a registration; sw.arrive(adoptOk, onSkip) brings a new worker through
// installing (updatefound) to installed / waiting (sw.worker makes one, sw.installed moves it on); adopt is answered on
// the page's MessagePort
function fakeSW() {
  const L = {}, RL = {};
  const C = {
    controller: { name: 'current worker' }, calls: [],
    addEventListener(t, f) { (L[t] || (L[t] = [])).push(f); },
    register(url, opts) { C.calls.push([url, Object.assign({}, opts)]); return Promise.resolve(C.reg); },
    emit(t) { for (const f of L[t] || []) f({ type: t }); },
  };
  C.reg = {
    installing: null, waiting: null, updates: 0,
    addEventListener(t, f) { (RL[t] || (RL[t] = [])).push(f); },
    update() { C.reg.updates++; return Promise.resolve(); },
  };
  C.worker = (adoptOk, onSkip) => {
    const WL = {}, w = {
      state: 'installing', posted: [],
      addEventListener(t, f) { (WL[t] || (WL[t] = [])).push(f); },
      fire(t) { for (const f of WL[t] || []) f({}); },
      postMessage(m, ports) {
        w.posted.push(m);
        if (m.t === 'adopt' && ports && ports[0]) ports[0].postMessage({ t: 'adopt', ok: !!adoptOk(m) });
        if (m.t === 'skip' && onSkip) onSkip();
      },
    };
    return w;
  };
  C.installed = w => { w.state = 'installed'; C.reg.installing = null; C.reg.waiting = w; w.fire('statechange'); };
  C.arrive = (adoptOk, onSkip) => {
    const w = C.worker(adoptOk, onSkip);
    C.reg.installing = w;
    for (const f of RL.updatefound || []) f({});
    C.installed(w);
    return w;
  };
  return C;
}

const sw = fakeSW(), idb = fakeIDB(), LS = fakeStorage({});
let sim = null;
async function page() {
  if (!sim) {
    sim = await bootMain({ ua: CHROME, platform: 'Win32', fs: 'std', sw, idb, ls: LS, location: { protocol: 'https:', hostname: 'synth.domlavin.com', href: 'https://synth.domlavin.com/' } });
    await sim.settle(30);
  }
  return sim;
}

test('desktop Chrome: Full screen shown (the Fullscreen API works), Install app hidden until the browser offers an install; full screen toggles with aria-pressed and its label', async () => {
  const s = await page(), fs = s.$('#fullscreen'), ins = s.$('#install');
  assert.equal(fs.hidden, false);
  assert.equal(ins.hidden, true, 'no beforeinstallprompt yet');
  assert.equal(s.$('#update').hidden, true);
  assert.deepEqual([fs.getAttribute('aria-pressed'), fs.getAttribute('aria-label')], ['false', 'Full screen']);
  fs.click();
  await s.settle();
  assert.deepEqual(s.fsCalls, [['enter', { navigationUI: 'hide' }]], 'the whole page (documentElement), browser UI hidden');
  assert.deepEqual([fs.getAttribute('aria-pressed'), fs.getAttribute('aria-label'), fs.title], ['true', 'Exit full screen', 'Exit full screen']);
  assert.equal(fs.hidden, false, 'still there to leave full screen');
  fs.click();
  await s.settle();
  assert.deepEqual(s.fsCalls.at(-1), ['exit']);
  assert.equal(fs.getAttribute('aria-pressed'), 'false');
  // leaving with the browser's own control (Esc) updates the button through fullscreenchange
  fs.click(); await s.settle();
  s.dom.document.fullscreenElement = null;
  for (const f of s.dom.docL.fullscreenchange || []) f({ type: 'fullscreenchange' });
  assert.equal(fs.getAttribute('aria-pressed'), 'false');
});

test('desktop Chrome: no interface size of the app\'s own (ruling Z1) — no test hook for it, the viewport meta never written, no html[data-uiz], nothing written to storage for it (no old key here)', async () => {
  const s = await page();
  assert.equal(s.api.uiz, undefined);
  assert.equal(s.$('meta[name="viewport"]').getAttribute('content'), null);
  assert.equal(s.dom.document.documentElement.hasAttribute('data-uiz'), false);
  assert.ok(!LS.writes.some(k => /synth-ui\.scale/.test(k)), LS.writes.join());
});

test('no text selection outside fields: style.css makes the app unselectable (no callout, no tap flash) with fields excepted, and boot refuses a selectstart anywhere but a field (iPad double-tap / hold)', async () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /body \{ -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; \}/);
  assert.match(css, /html \{ -webkit-tap-highlight-color: transparent; \}/);
  assert.match(css, /:is\(input:not\(\[type=range\], \[type=checkbox\], \[type=radio\], \[type=button\], \[type=color\]\), textarea, select, \[contenteditable\]:not\(\[contenteditable="false"\]\)\) \{ -webkit-user-select: text; user-select: text;/);
  const s = await page();
  const fs = s.dom.docL.selectstart || [];
  assert.equal(fs.length, 1, 'one selectstart guard');
  const fire = (target) => { let prevented = false; fs[0]({ type: 'selectstart', target, preventDefault() { prevented = true; } }); return prevented; };
  const el = (field) => ({ nodeType: 1, closest: sel => (field && /textarea/.test(sel) ? {} : null) });
  assert.equal(fire(el(false)), true, 'a label, button or panel: refused');
  assert.equal(fire({ nodeType: 3, parentElement: el(false) }), true, 'a text node in a label: refused');
  assert.equal(fire(el(true)), false, 'inside a field: allowed');
  assert.equal(fire({ nodeType: 3, parentElement: el(true) }), false, 'a text node in a field: allowed');
  assert.equal(fire(null), true, 'no target: refused');
});

test('desktop Chrome: Install app through beforeinstallprompt (the browser\'s own banner replaced), one prompt per offer; appinstalled hides it and asks for persistent storage', async () => {
  const s = await page(), ins = s.$('#install'), fs = s.$('#fullscreen');
  let prompted = 0, choose = null;
  const offer = () => s.win('beforeinstallprompt', { prompt() { prompted++; return Promise.resolve(); }, userChoice: new Promise(r => { choose = r; }) });
  let e = offer();
  assert.equal(e.defaultPrevented, true);
  assert.equal(ins.hidden, false);
  ins.click();
  assert.equal(prompted, 1);
  assert.equal(ins.hidden, true, 'a prompt is used once');
  choose({ outcome: 'dismissed' });
  await s.settle();
  assert.equal(ins.hidden, true);
  e = offer();
  assert.equal(ins.hidden, false, 'offered again later');
  assert.deepEqual(s.persist, [], 'not installed yet: no storage request');
  ins.click();
  choose({ outcome: 'accepted' });
  s.win('appinstalled');
  await s.settle();
  assert.equal(prompted, 2);
  assert.equal(ins.hidden, true);
  assert.equal(fs.hidden, false, 'this browser tab keeps Full screen');
  assert.deepEqual(s.persist, ['persisted', 'persist'], 'navigator.storage.persist() once installed');
  offer();
  assert.equal(ins.hidden, true, 'installed: no more Install app');
  s.win('appinstalled'); await s.settle();
  assert.deepEqual(s.persist, ['persisted', 'persist'], 'asked once');
});

test('service worker: registered once the page has loaded — sw.js, scope ./, updateViaCache none', async () => {
  await page();
  assert.deepEqual(sw.calls, [['sw.js', { scope: './', updateViaCache: 'none' }]]);
});

test('AudioWorklet offline where the browser does not route worklet requests through the service worker: each script is fetched by the page (answered from the worker\'s cache) and added from a blob: URL', async () => {
  const s = await page(), AC = globalThis.AudioContext, realFetch = globalThis.fetch, got = [];
  globalThis.AudioContext = class extends AC {
    constructor(o) {
      super(o);
      const mods = this.modules;
      this.audioWorklet = { addModule: async url => { if (!/^blob:/.test(url)) throw new TypeError('Failed to fetch'); mods.push(url); } };
    }
  };
  globalThis.fetch = async url => { got.push(String(url)); return new Response(readFileSync(new URL('../' + String(url).split('?')[0], import.meta.url), 'utf8')); };
  try {
    const c = await s.power();
    assert.equal(c.modules.length, 12, '11 DSP scripts + engine.js');
    assert.ok(c.modules.every(u => u.startsWith('blob:')), 'from blob: URLs');
    const dsp = /const DSP_FILES = \[([^\]]*)\]/.exec(readFileSync(new URL('../main.js', import.meta.url), 'utf8'))[1].match(/'([^']+)'/g).map(x => x.slice(1, -1));
    assert.deepEqual(got.slice().sort(), dsp.concat('engine.js').map(f => f + '?v=' + N).sort(), 'the versioned URLs (the worker\'s cache keys)');
    assert.equal(s.api.ctx(), c, 'the engine is up');
    assert.ok(s.api.nodes.size >= 1);
  } finally { globalThis.AudioContext = AC; globalThis.fetch = realFetch; }
});

test('updates: a worker of this page\'s version is adopted quietly (no toast, no reload); an update from another window shows the toast; an hour later back in front checks for updates', async () => {
  const s = await page(), toast = s.$('#update');
  const w1 = sw.arrive(m => m.v === N);
  await s.settle(20);
  assert.deepEqual(w1.posted, [{ t: 'adopt', v: N }]);
  assert.equal(toast.hidden, true);
  sw.controller = w1;
  sw.emit('controllerchange');
  assert.equal(toast.hidden, true, 'adopted: nothing to tell');
  assert.equal(s.reloads, 0, 'never a reload by itself');
  // another window accepted an update: this page still runs the version it loaded
  sw.emit('controllerchange');
  assert.equal(toast.hidden, false);
  assert.equal(s.$('#updateMsg').textContent, 'SYNTH was updated in another window');
  s.$('#updateX').click();
  assert.equal(toast.hidden, true, 'Later');
  assert.equal(s.reloads, 0);
  // back in front after more than an hour: registration.update(), and the toast put off with × again
  const now = Date.now;
  try {
    Date.now = () => now() + 2 * 3600e3;
    for (const f of s.dom.docL.visibilitychange || []) f({ type: 'visibilitychange' });
    assert.equal(sw.reg.updates, 1);
    assert.equal(toast.hidden, false);
    assert.equal(s.$('#updateMsg').textContent, 'SYNTH was updated in another window');
    s.$('#updateX').click();
    for (const f of s.dom.docL.visibilitychange || []) f({ type: 'visibilitychange' });
    assert.equal(sw.reg.updates, 1, 'at most hourly');
  } finally { Date.now = now; }
});

test('updates: an older page gets "Update available — Reload"; Reload saves the project first (IndexedDB written), then the worker takes over (skip) and the page reloads', async () => {
  const s = await page(), { api } = s, toast = s.$('#update');
  let saved = null;
  const tracks = () => [...idb.data('synth-app', 'tracks').keys()].filter(k => k.startsWith('t:'));
  const w2 = sw.arrive(() => false, () => { saved = tracks(); });
  await s.settle(20);
  assert.deepEqual(w2.posted, [{ t: 'adopt', v: N }]);
  assert.equal(toast.hidden, false);
  assert.equal(s.$('#updateMsg').textContent, 'Update available');
  assert.equal(s.reloads, 0, 'waits for the user (audio may be playing, work unsaved)');
  // an edit the 400 ms autosave has not written yet
  api.addTrack();
  const id = api.project().tracks.at(-1).id;
  assert.ok(!tracks().includes('t:' + id));
  s.$('#updateGo').click();
  assert.equal(s.$('#updateGo').disabled, true);
  await s.settle(60);
  assert.deepEqual(w2.posted.at(-1), { t: 'skip' });
  assert.ok(saved && saved.includes('t:' + id), 'the project was in the database before the worker was activated');
  assert.equal(s.reloads, 0, 'reloads when the new worker has taken over');
  sw.controller = w2;
  sw.emit('controllerchange');
  assert.equal(s.reloads, 1);
});

// pwa.js initApp on the simulation's DOM stub (no page): desktop Chrome with a service worker fake
function bareApp(sw, extra = {}) {
  const dom = makeDom(), reloads = [];
  for (const id of ['install', 'fullscreen', 'installSheet', 'update']) dom.document.querySelector('#' + id).hidden = true;
  dom.document.readyState = 'complete';
  const win = { addEventListener() {}, matchMedia: () => ({ matches: false }) };
  const nav = { userAgent: CHROME, platform: 'Win32', maxTouchPoints: 0, serviceWorker: sw };
  const loc = { protocol: 'https:', hostname: 'synth.domlavin.com', reload() { reloads.push(Date.now()); } };
  const app = initApp(Object.assign({ win, doc: dom.document, nav, loc, version: N }, extra));
  const $ = id => dom.document.querySelector('#' + id);
  return { app, reloads, $, toast: $('update'), front: () => { for (const f of dom.docL.visibilitychange || []) f({ type: 'visibilitychange' }); } };
}

test('updates: a worker already installing when register() resolves (the update check began while the page loaded) is offered once installed; with one waiting too, both', async () => {
  let sw = fakeSW();
  const w = sw.worker(() => false);
  sw.reg.installing = w;
  let B = bareApp(sw);
  await later(5);
  assert.deepEqual(w.posted, [], 'still installing');
  assert.equal(B.toast.hidden, true);
  sw.installed(w);
  await later(20);
  assert.deepEqual(w.posted, [{ t: 'adopt', v: N }]);
  assert.equal(B.toast.hidden, false);
  assert.equal(B.$('updateMsg').textContent, 'Update available');
  // a waiting worker and a newer one installing
  sw = fakeSW();
  const old = sw.worker(() => false), next = sw.worker(m => m.v === N);
  old.state = 'installed'; sw.reg.waiting = old; sw.reg.installing = next;
  B = bareApp(sw);
  await later(20);
  assert.deepEqual(old.posted, [{ t: 'adopt', v: N }]);
  sw.installed(next);
  await later(20);
  assert.deepEqual(next.posted, [{ t: 'adopt', v: N }], 'the newer one offered too');
  // the page not controlled yet (its first worker): nothing to offer
  sw = fakeSW();
  sw.controller = null;
  const first = sw.worker(() => true);
  sw.reg.installing = first;
  B = bareApp(sw);
  sw.installed(first);
  await later(20);
  assert.deepEqual(first.posted, []);
  assert.equal(B.toast.hidden, true);
});

test('updates: a toast put off with × comes back when the page returns to the front after an hour (an iPad app suspended for days), at most hourly; a newer waiting worker is offered then', async () => {
  const sw = fakeSW(), B = bareApp(sw), now = Date.now;
  sw.arrive(() => false);
  await later(20);
  assert.equal(B.toast.hidden, false);
  B.$('updateX').click();
  assert.equal(B.toast.hidden, true);
  B.front();
  assert.equal(B.toast.hidden, true, 'not within the hour');
  try {
    Date.now = () => now() + 2 * 3600e3;
    B.front();
    assert.equal(sw.reg.updates, 1);
    assert.equal(B.toast.hidden, false, 'shown again');
    assert.equal(B.$('updateMsg').textContent, 'Update available');
    B.$('updateX').click();
    B.front();
    assert.equal(B.toast.hidden, true, 'at most hourly');
    // a newer worker waiting by then (found by that update check): offered (adopt asked) rather than the old toast
    Date.now = () => now() + 4 * 3600e3;
    const w = sw.worker(m => m.v === N);
    w.state = 'installed'; sw.reg.waiting = w;
    B.front();
    await later(20);
    assert.deepEqual(w.posted, [{ t: 'adopt', v: N }]);
    assert.equal(B.toast.hidden, true, 'adopted quietly');
    assert.deepEqual(B.reloads, []);
  } finally { Date.now = now; }
});

test('updates: Reload waits for the project to be saved at most 5 s — a database write that never finishes does not hold the update', async () => {
  const sw = fakeSW();
  let saves = 0, skips = 0;
  const B = bareApp(sw, { beforeReload: () => { saves++; return new Promise(() => {}); } });
  const w = sw.arrive(() => false, () => { skips++; });
  await later(20);
  assert.equal(B.toast.hidden, false);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    B.$('updateGo').click();
    for (let k = 0; k < 5; k++) await Promise.resolve();
    assert.equal(saves, 1);
    assert.equal(B.$('updateMsg').textContent, 'Saving…');
    mock.timers.tick(4900);
    for (let k = 0; k < 5; k++) await Promise.resolve();
    assert.equal(skips, 0, 'still saving');
    mock.timers.tick(100);
    for (let k = 0; k < 5; k++) await Promise.resolve();
    assert.equal(skips, 1, 'the worker takes over after 5 s');
    assert.deepEqual(w.posted.at(-1), { t: 'skip' });
    sw.emit('controllerchange');
    assert.equal(B.reloads.length, 1);
  } finally { mock.timers.reset(); }
});
