// The browser half of the iPad app's seams (lane W1; IMPL-A A1, §9.1 G1′): the same page booted as Safari on an iPad
// shows it (https://canvas.domlavin.com, no window.SYNTH_SHELL) — every seam dormant: no SYNTH_SHELL created, app().shell
// false, Install app and Full screen shown and the service worker registered as today, Help & about's App sentence as
// committed (app-build.json never asked for), no "Sound in background" line, a hidden page's context never suspended by
// the page, download() → the download link (saveLink) as today. The app's half: tests/app-shell.test.mjs.
// Run: node --max-old-space-size=2048 --test tests/app-shell-web.test.mjs
import './v8-guard.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';

const keep = setInterval(() => {}, 1000); // (the sim's timers are unref'd: a ref'd beat keeps the process up while the file runs)
after(() => clearInterval(keep));

const SAFARI_IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const text = el => (el.children && el.children.length ? el.children.map(text).join('') : el.textContent || '');
const regs = [], fetched = [];
const sw = { controller: {}, addEventListener() {}, register(...a) { regs.push(a); return Promise.resolve({ waiting: null, installing: null, addEventListener() {}, update() {} }); } };
const realFetch = globalThis.fetch;
globalThis.fetch = (u, ...a) => { fetched.push(String(u)); return realFetch(u, ...a); };
const links = [];
URL.createObjectURL = b => { links.push(b); return 'blob:https://canvas.domlavin.com/' + links.length; };
URL.revokeObjectURL = () => {};

const sim = await bootMain({ ua: SAFARI_IPAD, platform: 'MacIntel', touch: true, fs: 'webkit', sw,
  location: { protocol: 'https:', hostname: 'canvas.domlavin.com', host: 'canvas.domlavin.com', href: 'https://canvas.domlavin.com/' } });
await sim.settle(30);
const { api } = sim;
const T = () => globalThis.__synthTest.shell;
const vis = hidden => {
  sim.dom.document.hidden = hidden; sim.dom.document.visibilityState = hidden ? 'hidden' : 'visible';
  for (const f of sim.dom.docL.visibilitychange || []) f({ type: 'visibilitychange' });
};

test('G1′ Safari on the iPad (no marker): no SYNTH_SHELL made, app().shell false, Install app and Full screen shown, the service worker registered, no restart notice, no "Sound in background" line in ⚙', () => {
  assert.equal(globalThis.SYNTH_SHELL, undefined, 'the page never creates the marker');
  assert.equal('SYNTH_SHELL' in globalThis, false);
  assert.equal(api.app().shell, false);
  assert.deepEqual([sim.$('#install').hidden, sim.$('#fullscreen').hidden], [false, false]);
  assert.equal(regs.length, 1, 'register(sw.js) as today');
  assert.doesNotMatch(sim.$('#notice').textContent, /restarted/);
  const rows = sim.$('#gearPop').children.map(el => el.tagName + ':' + text(el));
  assert.equal(rows.some(r => /Sound in background|^H3:App$|Keep playing/.test(r)), false, rows.join(' | '));
  assert.equal(T().shell.bg, undefined);
});

test('G1′ Help & about: the App sentence as committed (the stub paragraph untouched), app-build.json never fetched', async () => {
  const kids = [];
  for (const it of [{ b: 'Controls:' }, ' drag. ', { b: 'App:' }, ' the full-screen button hides the browser’s bars; ', { b: 'Install app' }, ' … to move it across.']) {
    const n = typeof it === 'string' ? { nodeType: 3, textContent: it } : { nodeType: 1, tagName: 'B', textContent: it.b };
    Object.defineProperty(n, 'nextSibling', { get: () => kids[kids.indexOf(n) + 1] || null });
    n.remove = () => { kids.splice(kids.indexOf(n), 1); }; n.after = m => { kids.splice(kids.indexOf(n) + 1, 0, m); };
    kids.push(n);
  }
  sim.$('#helpParts').querySelectorAll = sel => (sel === 'b' ? kids.filter(n => n.nodeType === 1) : []);
  const before = kids.map(n => n.textContent).join('');
  T().helpSheet(); await sim.settle(10);
  assert.equal(kids.map(n => n.textContent).join(''), before);
  assert.equal(fetched.filter(u => /app-build/.test(u)).length, 0);
  T().shell.sheet.close();
});

test('G1′ files out: download() → the download link, as today (Export MIDI, Save)', async () => {
  let l = links.length;
  sim.$('#fMidi').click();
  assert.equal(links.length - l, 1);
  assert.equal(links.at(-1).type, 'audio/midi');
  l = links.length;
  sim.$('#fSave').click(); await sim.settle(30);
  assert.equal(links.length - l, 1);
  assert.equal(links.at(-1).type, 'application/json');
});

test('G1′ the page hidden with the engine on: no suspend from the page (today\'s keys / pads release only); visible: no extra call', async () => {
  await sim.power(); await sim.settle(10);
  const c = sim.ctx(), n = c.calls.length;
  assert.equal(c.state, 'running');
  vis(true);
  assert.deepEqual([c.calls.length, c.state], [n, 'running']);
  vis(false);
  assert.deepEqual([c.calls.length, c.state], [n, 'running']);
});
