// The iPad app's seams in the page (lane W1; IMPL-A §3.1–3.2, §4.1, §4.3, §5.3–5.4, §9.1 G1 / G2): main.js and pwa.js
// booted as the app's WKWebView runs them — the marker window.SYNTH_SHELL (§3.1) on synth://app/ — against a fake native
// half (SYNTH_SHELL.post: the bridge's replies, each a little later). Install app / Full screen / the install sheet / the
// service worker gone; the members main.js adds (openFile, probe, on, save); the posts { t: 'engine', on } (once per
// change), { t: 'bg', on }, { t: 'ready' }; the restart notice; Help & about's App sentence; ⚙ "Sound in background" (off:
// the context suspended while the page is hidden). Files out (G2; the lead's call after lane N's measure — the bridge kept
// +290 MB of WebContent heap after a 100 MB file, a WKDownload of the same blob nothing): every download() caller → the
// download link (the app's WKDownload → the share sheet), no bridge message, a caller's `later` offered every time (the
// bounce's Save WAV…: the same file again, no re-render); SYNTH_SHELL.save (the smoke's) over the chunked bridge (file →
// 2 MiB chunks with `at`, one in flight → end), abort + the link on any refusal. The browser half (no marker):
// tests/app-shell-web.test.mjs. Stage B (IMPL-B §4.1, §6, B4): ⚙ Bluetooth MIDI → Pair a device… posts { t: 'midi-bt' }; the
// Sound in background hint names other apps; probe().midi = { n, wheel, bend } driven through api.midi.message.
// Run: node --max-old-space-size=2048 --test tests/app-shell.test.mjs
import './v8-guard.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bootMain, makeDom } from './main-sim.mjs';
import { fakeStorage, fakeIDB } from './fakes.mjs';
import { openAppStore } from '../appstore.js?v=9';
import { MODELS } from '../models.js?v=9';
import { initApp } from '../pwa.js?v=9';

const WK = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'; // (a WKWebView: no Version/… Safari/)
const MiB = 1 << 20;
const sha = b => createHash('sha256').update(b).digest('hex');
const text = el => (el.children && el.children.length ? el.children.map(text).join('') : el.textContent || '');

// the sim's timers are unref'd and the fake IndexedDB answers on them: a ref'd beat keeps the process up while the file
// runs (the boot at top level, a bare await of the bridge), and the native half replies on a ref'd timer
const realTimeout = globalThis.setTimeout, keep = setInterval(() => {}, 1000);
after(() => clearInterval(keep));

/* ------------------------------------------------------------------ the native half (fake) */
// every message recorded; a transfer's replies (file / chunk / end) come from answer(m) a timer later (a throw: the promise
// rejects — WebKit's reply handler with an error); live / most: the transfer messages awaiting their reply (one in flight)
const sent = [];
let answer = () => ({ ok: true }), live = 0, most = 0;
const XFER = new Set(['file', 'chunk', 'end']);
const SHELL = { os: 'ipados', idiom: 'pad', app: '0.1', build: '412', sha: 'abc1234', site: '9', restarted: true,
  post(m) {
    sent.push(m);
    if (!XFER.has(m && m.t)) return Promise.resolve({ ok: true });
    live++; most = Math.max(most, live);
    return new Promise((res, rej) => realTimeout(() => { live--; try { res(answer(m)); } catch (err) { rej(err); } }, 1));
  } };
const BUILD = { sha: 'abc1234def567', short: 'abc1234', date: '2026-10-23T09:15:00+01:00', version: '9', build: 412, dirty: false };
let fetches = 0;
const realFetch = globalThis.fetch;
const fetchFake = (u, ...a) => (String(u) === 'app-build.json' ? (fetches++, Promise.resolve({ ok: true, json: async () => BUILD })) : realFetch(u, ...a));
// a service worker API that does exist (a future WebKit exposing it to custom schemes): nothing may register
const regs = [], swL = {};
const sw = { controller: {}, addEventListener(t, f) { (swL[t] || (swL[t] = [])).push(f); },
  register(...a) { regs.push(a); return Promise.resolve({ waiting: null, installing: null, addEventListener() {}, update() {} }); } };

// the download link (saveLink): every blob it was given; saved(l): the links made since links.length was l — { name (the
// anchor's download attribute: WKDownload's file name), blob }
const links = [];
URL.createObjectURL = b => { links.push(b); return 'blob:synth://app/' + links.length; };
URL.revokeObjectURL = () => {};
const saved = l => sim.dom.document.body.children.filter(a => a.tagName === 'A' && /^blob:synth:\/\/app\/\d+$/.test(a.href))
  .map(a => ({ name: a.download, blob: links[+a.href.split('/').pop() - 1], i: +a.href.split('/').pop() - 1 })).filter(x => x.i >= l);

// a project autosaved by a session that could not open the database (appstore '#rec:'): offered at boot as a file to save
const proj = name => JSON.stringify({ name, bpm: 120, tracks: [{ id: 't1', model: 'minimoog', notes: [] }] });
const LS = fakeStorage({}), IDB = fakeIDB();
{
  let st = await openAppStore({ ls: LS, idb: IDB, bc: null });
  st.saveProject(proj('Weeks of work')); await st.close();
  const warn = console.warn; console.warn = () => {};
  try { st = await openAppStore({ ls: LS, idb: null, bc: null, timeout: 30 }); } finally { console.warn = warn; }
  st.saveProject(proj('Kept separately'));
}

const sim = await bootMain({ ua: WK, platform: 'MacIntel', touch: true, fs: 'webkit', sw, ls: LS, idb: IDB,
  location: { protocol: 'synth:', hostname: 'app', host: 'app', href: 'synth://app/index.html' }, win: { SYNTH_SHELL: SHELL, fetch: fetchFake } });
await sim.settle(30);
const { api } = sim;
const T = () => globalThis.__synthTest.shell;

// the transfers in `sent` since index k: [{ id, file, chunks, end, abort, bytes() }]
function xfers(k = 0) {
  const by = new Map();
  for (const m of sent.slice(k)) {
    if (!['file', 'chunk', 'end', 'abort'].includes(m.t)) continue;
    if (!by.has(m.id)) by.set(m.id, { id: m.id, file: null, chunks: [], end: null, abort: null });
    const x = by.get(m.id);
    if (m.t === 'chunk') x.chunks.push(m); else x[m.t] = m;
  }
  return [...by.values()].map(x => Object.assign(x, { bytes: () => Buffer.concat(x.chunks.map(c => Buffer.from(c.b64, 'base64'))) }));
}
const vis = hidden => {
  sim.dom.document.hidden = hidden; sim.dom.document.visibilityState = hidden ? 'hidden' : 'visible';
  for (const f of sim.dom.docL.visibilitychange || []) f({ type: 'visibilitychange' });
};

/* ------------------------------------------------------------------ G1: the marker, the boot */
test('G1 the app at boot: Install app and Full screen hidden (the Fullscreen API works here), the sheet never opens, no service worker registered nor listened to, app().shell, persistent storage asked once; SYNTH_SHELL gains openFile / probe / on / save; ready and bg posted once, no engine post with the engine off', async () => {
  assert.deepEqual([sim.$('#install').hidden, sim.$('#fullscreen').hidden], [true, true]);
  const app = api.app();
  assert.deepEqual([app.shell, app.platform.ipad, app.platform.browser], [true, true, 'other'], 'a WKWebView: an iPad, no named browser');
  const e = sim.win('beforeinstallprompt', { prompt() {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual([sim.$('#install').hidden, app.sheetOpen(), sim.$('#installSheet').hidden], [true, false, true], 'nothing to install');
  assert.equal(regs.length, 0, 'no register()');
  assert.deepEqual(Object.keys(swL), [], 'no controllerchange listener');
  assert.equal(sim.$('#update').hidden, true, 'no update toast');
  assert.deepEqual(sim.persist, ['persisted', 'persist']);
  app.sync(); await sim.settle();
  assert.deepEqual(sim.persist, ['persisted', 'persist'], 'asked once');
  assert.deepEqual(['openFile', 'probe', 'on', 'save'].map(k => typeof SHELL[k]), ['function', 'function', 'function', 'function']);
  assert.deepEqual(sent.filter(m => m.t === 'ready'), [{ t: 'ready' }]);
  assert.deepEqual(sent.filter(m => m.t === 'bg'), [{ t: 'bg', on: true }], 'the stored setting (default on), told at boot');
  assert.deepEqual(sent.filter(m => m.t === 'engine'), []);
  assert.ok(sent.findIndex(m => m.t === 'bg') < sent.findIndex(m => m.t === 'ready'), 'bg before ready');
});

test('G1 restarted (the WebContent process was reclaimed): the restart notice leads the boot notices; the recovered project\'s tap-to-save follows it and saves by the download link (the app\'s WKDownload)', async () => {
  const note = sim.$('#notice');
  assert.match(note.textContent, /^SYNTH restarted \(the system reclaimed memory\) — the project came back from its last autosave · /);
  assert.match(note.textContent, /was kept separately — tap to download it$/);
  assert.equal(api.project().name, 'Weeks of work', 'the autosave');
  const k = sent.length, l = links.length;
  note.click(); await sim.settle(5);
  const S = saved(l);
  assert.deepEqual([S.length, S[0].name, S[0].blob.type, xfers(k).length], [1, 'recovered-project.synth.json', 'application/json', 0]);
  assert.equal(JSON.parse(await S[0].blob.text()).name, 'Kept separately');
});

test('G1 probe() before power-on: no context, nothing built; JSON-clean (a native callAsyncJavaScript reads it)', () => {
  const p = SHELL.probe();
  assert.deepEqual(JSON.parse(JSON.stringify(p)), p);
  assert.deepEqual([p.ctx, p.sr, p.baseLatency, p.outputLatency, p.nodes, p.master, p.peak, p.held, p.store], [null, null, null, null, 0, false, 0, 0, 'idb']);
  assert.equal(p.cpu, 'Press Power or play a key');
  assert.deepEqual(p.midi, { n: 0, wheel: 0, bend: 0 }, 'IMPL-B §6: nothing received');
  assert.ok(p.bootMs > 0 && Number.isFinite(p.bootMs), 'bootMs: performance.now() at the end of boot');
});

test('G1 { t: \'engine\', on } once per change: power on (one post through the held warm-up and ready), off, a failed power-on (on, then off)', async () => {
  const E = () => sent.filter(m => m.t === 'engine').map(m => m.on);
  assert.deepEqual(E(), []);
  await sim.power(); await sim.settle(10);
  assert.equal(sim.ctx().state, 'running');
  assert.deepEqual(E(), [true]);
  sim.$('#power').click(); await sim.settle(10);
  assert.deepEqual(E(), [true, false], 'Power off');
  const AC0 = globalThis.AudioContext;
  globalThis.AudioContext = class extends AC0 { constructor(o) { super(o); this.audioWorklet = null; } };
  try { await assert.rejects(api.powerOn(), /AudioWorklet/); } finally { globalThis.AudioContext = AC0; }
  await sim.settle(10);
  assert.deepEqual(E(), [true, false, true, false], 'a failed power-on: on, then off');
  await sim.power(); await sim.settle(10);
  assert.deepEqual(E(), [true, false, true, false, true]);
});

test('G1 probe() with the engine on: the context, its rate and latencies, the nodes, MASTER, the analyser\'s peak, the held keys, the DSP line, the store', async () => {
  const c = sim.ctx(), M = c.nodes.find(n => n.name === 'synth-master'), A = [...M.outs].find(n => n.kind === 'an' && n.fftSize === 8192);
  assert.ok(A, 'the OUT scope\'s analyser');
  A.getFloatTimeDomainData = a => { a.fill(0); a[5] = -0.5; a[9] = 0.25; };
  sim.key('KeyA', true, { key: 'a' });
  const p = SHELL.probe();
  sim.key('KeyA', false, { key: 'a' });
  assert.deepEqual(JSON.parse(JSON.stringify(p)), p);
  assert.deepEqual([p.ctx, p.sr, p.baseLatency, p.outputLatency, p.nodes, p.master, p.peak, p.held, p.store], ['running', c.sampleRate, 0, 0, api.nodes.size, true, 0.5, 1, 'idb']);
  assert.ok(p.nodes >= 1);
  assert.equal(typeof p.cpu, 'string');
  assert.equal(SHELL.probe().held, 0);
});

test('G1 SYNTH_SHELL.on({ t: \'resume\' }) — an interruption ended: wake() resumes the context without a tap; another t, or none, is ignored', async () => {
  const c = sim.ctx();
  await c.suspend(); await sim.settle();
  assert.equal(c.state, 'suspended');
  const n = c.calls.length;
  SHELL.on({ t: 'nope' }); SHELL.on(null); SHELL.on();
  assert.equal(c.calls.length, n, 'ignored');
  SHELL.on({ t: 'resume' });
  assert.deepEqual([c.calls.at(-1), c.state], ['resume', 'running']);
});

test('G1 ⚙ Sound in background (the app only, appended after the canvas lines; a device setting, default on): on → nothing suspends when the app leaves the screen; off → the context suspends on hidden (a resume message then waits) and resumes on visible; each change posted { t: \'bg\', on }', async () => {
  const gp = sim.$('#gearPop'), rows = gp.children.map(el => el.tagName + ':' + text(el)), bb = T().shell.bg;
  const i = rows.indexOf('H3:App');
  assert.ok(i > 0, rows.join(' | '));
  // (fix B R1-F5) the hint must not promise what iPadOS does not keep: the hidden app is suspended ≈ 30 s after it leaves the screen
  // (the simulator; a MIDI app in front then plays nothing) — Split View is the setup that never hits it
  assert.deepEqual(rows.slice(i), ['H3:App', 'DIV:Sound in backgroundOn', 'P:Keep playing when you switch apps (iPadOS may pause it after a while — for a MIDI app, use Split View)',
    'DIV:Bluetooth MIDIPair a device…', 'P:Pair a Bluetooth keyboard or pad controller (USB and other apps need no pairing)'], 'IMPL-B §4.1 / §6 + fix R1-F5: the hint names the pause; the Bluetooth row follows');
  assert.deepEqual([bb.getAttribute('aria-pressed'), bb.textContent, bb.type], ['true', 'On', 'button']);
  const c = sim.ctx(), B = () => sent.filter(m => m.t === 'bg').map(m => m.on);
  let n = c.calls.length;
  vis(true);
  assert.deepEqual([c.calls.length, c.state], [n, 'running'], 'on: keeps playing');
  vis(false);
  bb.click();
  assert.deepEqual([bb.getAttribute('aria-pressed'), bb.textContent, api.store.get('synth.shell.bg', true), B()], ['false', 'Off', false, [true, false]]);
  n = c.calls.length;
  vis(true);
  assert.deepEqual([c.calls.slice(n), c.state], [['suspend'], 'suspended'], 'off: suspended while hidden');
  SHELL.on({ t: 'resume' });
  assert.deepEqual([c.calls.slice(n), c.state], [['suspend'], 'suspended'], 'an interruption\'s end waits for the page to come back');
  vis(false);
  assert.deepEqual([c.calls.at(-1), c.state], ['resume', 'running'], 'visible: resumed');
  bb.click();
  assert.deepEqual([bb.getAttribute('aria-pressed'), bb.textContent, api.store.get('synth.shell.bg', true), B()], ['true', 'On', true, [true, false, true]]);
});

test('B4 ⚙ Bluetooth MIDI (IMPL-B §4.1, the app only; after Sound in background): a "Pair a device…" button (#cvBt, described by its hint) — a tap posts { t: \'midi-bt\' } to native, once per tap, and nothing else; a native refusal changes nothing', async () => {
  const bt = T().shell.bt, gp = sim.$('#gearPop');
  assert.ok(bt, 'the button');
  assert.deepEqual([bt.id, bt.type, bt.className, bt.textContent, bt.getAttribute('aria-describedby')], ['cvBt', 'button', 'tt', 'Pair a device…', 'cvBtHint']);
  const hint = gp.children.find(el => el.id === 'cvBtHint');
  assert.ok(hint && hint.tagName === 'P', 'the hint paragraph');
  const k = sent.length;
  bt.click(); await sim.settle(2);
  assert.deepEqual(sent.slice(k), [{ t: 'midi-bt' }]);
  bt.click(); await sim.settle(2);
  assert.deepEqual(sent.slice(k), [{ t: 'midi-bt' }, { t: 'midi-bt' }], 'one post per tap, no state kept');
  assert.equal(bt.textContent, 'Pair a device…', 'the button never changes');
  const rej = SHELL.post; SHELL.post = () => Promise.reject(new Error('refused'));
  try { bt.click(); await sim.settle(2); } finally { SHELL.post = rej; }
  assert.equal(bt.textContent, 'Pair a device…', 'a refusal is quiet (the sheet is native\'s)');
});

test('B4 probe().midi (IMPL-B §6): { n, wheel, bend } — the messages the MIDI host callbacks received (notes, every CC once, bend, channel pressure; the wheel and the pedal ride their CC, never counted twice) and the last wheel / bend; JSON-clean, driven through api.midi.message', async () => {
  const P = () => SHELL.probe().midi;
  assert.deepEqual(P(), { n: 0, wheel: 0, bend: 0 }, 'nothing received yet');
  api.midi.message([0xb0, 1, 127], 100, 'Pad Box');
  assert.deepEqual(P(), { n: 1, wheel: 1, bend: 0 }, 'CC 1: one message (modCC + the wheel), the wheel at 1');
  api.midi.message([0xe0, 0x7f, 0x7f], 101, 'Pad Box');
  const m = P();
  assert.deepEqual([m.n, m.wheel], [2, 1]);
  assert.ok(Math.abs(m.bend - 1) < 0.001, 'the bend at full: ' + m.bend);
  api.midi.message([0x90, 60, 100], 102, 'Pad Box');
  assert.equal(P().n, 3, 'a note on');
  assert.equal(SHELL.probe().held, 1, 'the note is held (the same path as any MIDI key)');
  api.midi.message([0x80, 60, 0], 103, 'Pad Box');
  assert.equal(P().n, 4, 'a note off');
  api.midi.message([0xb0, 64, 127], 104, 'Pad Box'); api.midi.message([0xb0, 64, 0], 105, 'Pad Box');
  assert.equal(P().n, 6, 'the pedal: its CC once each (the sustain ctl is not counted again)');
  api.midi.message([0xd0, 64], 106, 'Pad Box');
  assert.equal(P().n, 7, 'channel pressure');
  api.midi.message([0xe0, 0x00, 0x00], 107, 'Pad Box'); api.midi.message([0xb0, 1, 0], 108, 'Pad Box');
  assert.deepEqual(P(), { n: 9, wheel: 0, bend: -1 }, 'the last values win; bend −1…1, wheel 0…1');
  assert.deepEqual(JSON.parse(JSON.stringify(SHELL.probe())), SHELL.probe(), 'still JSON-clean for callAsyncJavaScript');
  api.midi.message([0xfe], 109, 'Pad Box'); api.midi.message([0xf8], 110, 'Pad Box');
  assert.equal(P().n, 9, 'clock and active sensing decode to nothing: not counted');
});

test('G1 Help & about in the app: the App sentence (Install app, the browser\'s full screen) is swapped at open for the app\'s build and how projects cross from the browser — app-build.json read once; the labels around it kept', async () => {
  // (the stub DOM has no parsed index.html: a minimal paragraph — text nodes and <b> labels, nextSibling / remove / after)
  const kids = [];
  const wrap = n => Object.defineProperty(Object.assign(n, {
    remove() { const i = kids.indexOf(n); if (i >= 0) kids.splice(i, 1); },
    after(m) { kids.splice(kids.indexOf(n) + 1, 0, wrap(m)); },
  }), 'nextSibling', { get: () => kids[kids.indexOf(n) + 1] || null, configurable: true });
  for (const it of ['Drag up/down. ', { b: 'Controls:' }, ' drag. ', { b: 'App:' }, ' the full-screen button (in the ≡ menu) hides the browser’s bars; ', { b: 'Install app' }, ' (Share → Add to Home Screen) … to move it across.', { b: 'Later:' }, ' kept.']) {
    kids.push(wrap(typeof it === 'string' ? { nodeType: 3, textContent: it } : { nodeType: 1, tagName: 'B', textContent: it.b }));
  }
  const parts = sim.$('#helpParts');
  parts.querySelectorAll = sel => (sel === 'b' ? kids.filter(n => n.nodeType === 1) : []);
  const want = 'Drag up/down. Controls: drag. App: this is the SYNTH app 0.1 (412), build abc1234 (2026-10-23) · site v9. Projects saved in Safari or Chrome are separate: Save the file there and Open / Import… it here (or open it from the Files app).';
  T().helpSheet(); await sim.settle(10);
  const txt = () => kids.map(n => n.textContent).join('');
  assert.ok(txt().startsWith(want), txt());
  assert.match(txt(), /\(or open it from the Files app\)\. Audio now: \d+(\.\d)? kHz, base latency 0\.0 ms, output latency 0\.0 ms\.Later: kept\.$/, 'the engine\'s numbers while it is on (§5.4); the next label kept');
  T().shell.sheet.close();
  T().helpSheet(); await sim.settle(10);
  assert.ok(txt().startsWith(want));
  assert.equal(kids.filter(n => /this is the SYNTH app/.test(n.textContent)).length, 1, 'swapped once');
  assert.equal(fetches, 1, 'app-build.json read once');
  T().shell.sheet.close();
});

test('G1 SYNTH_SHELL.openFile(name, b64) — a file from the Files app (Share → SYNTH): the same path as Open / Import… (a project, a quoted name intact; a bad file alerts and answers false); the file input still opens', async () => {
  const b64 = s => Buffer.from(s).toString('base64');
  const o = JSON.parse(await globalThis.__synthTest.acc.projectFile());
  o.name = 'From the Files app';
  assert.equal(await SHELL.openFile('it\'s "x".synth.json', b64(JSON.stringify(o))), true);
  assert.equal(api.project().name, 'From the Files app');
  const l = sim.logs.length;
  assert.equal(await SHELL.openFile('junk.synth.json', b64('{ not json')), false);
  assert.deepEqual(sim.logs.slice(l), ['alert: Could not open that file: Not a valid project file']);
  o.name = 'From the picker';
  const target = { files: [{ name: 'p.synth.json', type: 'application/json', text: async () => JSON.stringify(o) }], value: 'p.synth.json' };
  await sim.$('#fFile').onchange({ target });
  assert.deepEqual([api.project().name, target.value], ['From the picker', '']);
});

/* ------------------------------------------------------------------ G2: files out */
test('G2 Save, Save as classic and Export MIDI → the download link, named (the app\'s WKDownload takes it to the share sheet): no bridge message, the bytes whole', async () => {
  for (const [id, re, type, check] of [['#fSave', /\.synth\.json$/, 'application/json', b => assert.ok(Array.isArray(JSON.parse(b.toString('utf8')).tracks))],
    ['#fSaveV1', /\.classic\.synth\.json$/, 'application/json', b => assert.ok(Array.isArray(JSON.parse(b.toString('utf8')).tracks))],
    ['#fMidi', /\.mid$/, 'audio/midi', b => assert.equal(b.subarray(0, 4).toString('latin1'), 'MThd')]]) {
    const k = sent.length, l = links.length;
    sim.$(id).click();
    for (let i = 0; i < 200 && links.length === l; i++) await sim.settle(2);
    await sim.settle(5);
    const S = saved(l);
    assert.equal(S.length, 1, id);
    assert.match(S[0].name, re, id);
    assert.deepEqual([S[0].blob.type, xfers(k).length], [type, 0], id);
    check(Buffer.from(await S[0].blob.arrayBuffer()));
  }
});

test('G2 SYNTH_SHELL.save (the smoke\'s, small files) keeps the bridge — a 5 MiB file: 2 MiB chunks at 0 / 2 MiB / 4 MiB, one in flight, the base64 round-trips to the same bytes (the 32 KiB fromCharCode path and the toBase64 builtin alike); save() answers the end reply; ids per transfer', async () => {
  const n = 5 * MiB + 7, u8 = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8[i] = (i * 7) & 255;
  const blob = new Blob([u8], { type: 'application/octet-stream' }), want = sha(u8);
  for (const builtin of [false, true]) {
    if (builtin) Uint8Array.prototype.toBase64 = function () { return Buffer.from(this.buffer, this.byteOffset, this.length).toString('base64'); };
    try {
      const k = sent.length;
      most = 0;
      const r = await SHELL.save(blob, 'smoke-5.bin');
      const [x] = xfers(k);
      assert.deepEqual(r, { ok: true });
      assert.deepEqual([x.file.name, x.file.type, x.file.size], ['smoke-5.bin', 'application/octet-stream', n]);
      assert.deepEqual(x.chunks.map(c => c.at), [0, 2 * MiB, 4 * MiB]);
      assert.deepEqual(x.chunks.map(c => Buffer.from(c.b64, 'base64').length), [2 * MiB, 2 * MiB, MiB + 7]);
      assert.equal(sha(x.bytes()), want, builtin ? 'toBase64' : 'fromCharCode + btoa');
      assert.equal(most, 1, 'one message in flight');
      assert.ok(typeof x.id === 'string' && x.chunks.every(c => c.id === x.id) && x.end.id === x.id, 'one id per transfer');
    } finally { if (builtin) delete Uint8Array.prototype.toBase64; }
  }
  const ids = xfers().map(x => x.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are per transfer');
});

test('G2 SYNTH_SHELL.save refused: a refused file (no room), a chunk rejected half-way, an end that fails, a missing handler — abort with the transfer\'s id (where a transfer began), then the download link with the same file', async () => {
  const warn = console.warn, warns = [];
  console.warn = (...a) => warns.push(a.join(' '));
  const small = new Blob([new Uint8Array(1000).map((_, i) => i & 255)], { type: 'application/octet-stream' });
  const big = new Blob([new Uint8Array(3 * MiB).map((_, i) => i & 255)], { type: 'application/octet-stream' });
  try {
    answer = m => (m.t === 'file' ? { ok: false, error: 'not enough space' } : { ok: true });
    let k = sent.length, l = links.length;
    let r = await SHELL.save(small, 'small.bin');
    let [x] = xfers(k);
    assert.deepEqual([x.chunks.length, x.end, x.abort && x.abort.id === x.id, r.ok, r.error], [0, null, true, false, 'not enough space']);
    assert.deepEqual(saved(l).map(s => [s.name, s.blob === small]), [['small.bin', true]]);
    answer = m => { if (m.t === 'chunk' && m.at > 0) throw new Error('lost'); return { ok: true }; };
    k = sent.length; l = links.length;
    r = await SHELL.save(big, 'half.bin');
    [x] = xfers(k);
    assert.deepEqual([x.chunks.map(c => c.at), x.end, !!x.abort, r.ok], [[0, 2 * MiB], null, true, false]);
    assert.deepEqual(saved(l).map(s => [s.name, s.blob === big]), [['half.bin', true]]);
    answer = m => (m.t === 'end' ? { ok: false, error: 'no sheet' } : { ok: true });
    k = sent.length; l = links.length;
    r = await SHELL.save(small, 'end.bin');
    [x] = xfers(k);
    assert.deepEqual([!!x.end, !!x.abort, r.ok, saved(l).length], [true, true, false, 1]);
    answer = () => ({ ok: true });
    const post = SHELL.post;
    SHELL.post = () => { throw new Error('no handler'); };
    l = links.length;
    try { r = await SHELL.save(small, 'none.bin'); } finally { SHELL.post = post; }
    assert.deepEqual([r.ok, saved(l).map(s => s.name)], [false, ['none.bin']], 'the link');
    assert.ok(warns.length === 4 && warns.every(w => /^SYNTH: saving \S+\.bin through the app failed \(.+\) — downloading it instead$/.test(w)), warns.join(' | '));
  } finally { console.warn = warn; answer = () => ({ ok: true }); }
});

test('G2 Bounce WAV: the file goes to the download link as the render ends (the app\'s sheet, no extra tap), no bridge message; the dialog offers Save WAV… every time (the page cannot know whether the sheet saved it) — the same file again, no re-render; then back to rendering', async () => {
  const p = api.project(), tr = p.tracks[0];
  tr.notes.push({ id: 'n-app', t: 0, d: 240, n: 60, v: 100 });
  p.loop.start = 0; p.loop.end = 480;
  sim.$('#fBounce').click();
  const go = sim.$('#bGo'), bn = sim.$('#bNote');
  assert.equal(go.textContent, 'Render & download');
  Object.assign(sim.$('#bRange'), { value: 'loop' }); Object.assign(sim.$('#bSr'), { value: '44100' }); Object.assign(sim.$('#bBits'), { value: '16' });
  Object.assign(sim.$('#bOs'), { value: '2' }); Object.assign(sim.$('#bTail'), { value: '0' }); sim.$('#bNorm').checked = false;
  const k = sent.length, l = links.length;
  go.click();
  for (let i = 0; i < 600 && !/^(Done|Render failed|No audible)/.test(bn.textContent); i++) await sim.settle(10);
  await sim.settle(5);
  const offl = sim.offline.length, [a] = saved(l);
  assert.deepEqual([saved(l).length, xfers(k).length], [1, 0]);
  assert.match(a.name, /-44\.1k-16bit\.wav$/);
  assert.deepEqual([a.blob.type, Buffer.from(await a.blob.arrayBuffer()).subarray(0, 4).toString('latin1')], ['audio/wav', 'RIFF']);
  assert.match(bn.textContent, /^Done: .* Closed the sheet without saving\? Tap Save WAV… to share it again\.$/);
  assert.deepEqual([go.textContent, go.disabled], ['Save WAV…', false]);
  go.click(); await sim.settle(5);
  const S = saved(l);
  assert.deepEqual([S.length, S[1].name, S[1].blob === a.blob, sim.offline.length - offl, xfers(k).length], [2, a.name, true, 0, 0], 'the same file, no second render');
  assert.equal(go.textContent, 'Render & download', 'back to rendering');
  sim.$('#bCancel').click();
});

test('G2 render-last (a Serum track\'s last notes): its WAV by the download link, no bridge message', async () => {
  const ce = console.error; // (the sim's stub DOM cannot style a Serum panel: its own error, not under test)
  console.error = (e, ...r) => { if (!(e && /getElementById/.test(String(e.message || e)))) ce(e, ...r); };
  try {
    const sx = api.addTrack(MODELS.find(m => m.id === 'serum')); await sim.settle(20);
    api.selectTrack(sx.id); await sim.settle(10);
    const T0 = 2e6;
    api.noteOn(62, 0.8, 0, T0); api.noteOff(62, 0, T0 + 200);
    const k = sent.length, l = links.length;
    const r = await api.renderLast(sx, {});
    await sim.settle(5);
    assert.deepEqual(saved(l).map(s => [s.name, s.blob === r.blob]), [[r.name, true]]);
    assert.match(r.name, /\.wav$/);
    assert.equal(xfers(k).length, 0);
  } finally { console.error = ce; }
});

/* ------------------------------------------------------------------ (fix R1-F3) the tuning picker on iOS */
test('(fix R1-F3) Serum › TUN FILE › Load .scl / .kbm / .tun…: on iOS / iPadOS (the app, Safari) the picker has no accept — iOS\'s document picker greys a .scl under that filter — and the import checks the file itself (a wrong file: the error, a .scl: loaded); the input sits hidden in the document while it is open (the app\'s WKWebView never fires change on a detached one) and leaves after a pick or a cancel; a desktop browser keeps the filter', async () => {
  const ce = console.error; // (the sim's stub DOM cannot style a Serum panel: its own error, not under test)
  console.error = (e, ...r) => { if (!(e && /getElementById/.test(String(e.message || e)))) ce(e, ...r); };
  const D = sim.dom.document, mk = D.createElement, nav = globalThis.navigator, was = { userAgent: nav.userAgent, platform: nav.platform, maxTouchPoints: nav.maxTouchPoints };
  try {
    const sx = api.addTrack(MODELS.find(m => m.id === 'serum')); await sim.settle(20);
    const H = api.sxHost(sx);
    // host.tuningFile() answered with `files` (or cancelled): [the input as it was clicked — accept / multiple / type, hidden, in the
    // document —, a promise of [the import's answer, the input removed]]
    const pick = (files, cancel) => {
      let inp = null, removed = false;
      D.createElement = tag => { const e = mk(tag); if (tag === 'input') { inp = e; e.remove = () => { removed = true; }; } return e; };
      try {
        const p = H.tuningFile();
        const r = { accept: inp.accept, multiple: inp.multiple, type: inp.type, hidden: inp.style.display === 'none', inDoc: D.body.children.includes(inp) };
        if (cancel) inp.dispatchEvent({ type: 'cancel' }); else { inp.files = files; inp.onchange(); }
        return [r, p.then(v => [v, removed])];
      } finally { D.createElement = mk; }
    };
    const IN = { multiple: true, type: 'file', hidden: true, inDoc: true };
    // the app (this boot: a WKWebView — a Mac's UA, MacIntel with touch: isIOS(), as Safari on the iPad)
    let [r, p] = pick([{ name: 'notes.txt', size: 6, text: async () => 'hello\n' }]);
    assert.deepEqual(r, { accept: '', ...IN });
    assert.deepEqual(await p, [{ error: 'no tuning file' }, true], 'a wrong file: the error sx-host shows ("Could not read that tuning file: …")');
    const scl = '! 19-edo.scl\n19 equal divisions of the octave\n 19\n' + Array.from({ length: 19 }, (_, i) => i === 18 ? ' 2/1' : ' ' + (1200 * (i + 1) / 19).toFixed(5)).join('\n') + '\n';
    [, p] = pick([{ name: '19-edo.scl', size: scl.length, text: async () => scl }]);
    const [t, gone] = await p;
    assert.deepEqual([t.kind, t.name, t.error, gone], ['scl', '19-edo', undefined, true]);
    [, p] = pick(null, true);
    assert.deepEqual(await p, [null, true], 'cancelled: nothing, the input gone');
    // a desktop browser: the filter as before
    Object.assign(nav, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', maxTouchPoints: 0 });
    [r, p] = pick(null);
    assert.deepEqual(r, { accept: '.scl,.kbm,.tun,text/plain', ...IN });
    assert.deepEqual(await p, [null, true], 'nothing picked');
  } finally { Object.assign(nav, was); D.createElement = mk; console.error = ce; }
});

/* ------------------------------------------------------------------ pwa.js alone: the shell guard on the service worker */
test('G1 initApp with the marker on an https page (a future WebKit exposing service workers to the app): no register, no toast path — the same page without the marker registers (the guard is what keeps it out)', async () => {
  const run = marker => {
    const dom = makeDom(), R = [];
    for (const id of ['install', 'fullscreen', 'installSheet', 'update']) dom.document.querySelector('#' + id).hidden = true;
    dom.document.readyState = 'complete';
    const sw2 = { controller: {}, addEventListener() {}, register: (...a) => { R.push(a); return Promise.resolve({ waiting: null, installing: null, addEventListener() {}, update() {} }); } };
    const win = Object.assign({ addEventListener() {}, matchMedia: () => ({ matches: false }) }, marker ? { SYNTH_SHELL: { os: 'ipados' } } : {});
    const app = initApp({ win, doc: dom.document, nav: { userAgent: WK, platform: 'MacIntel', maxTouchPoints: 5, serviceWorker: sw2 }, loc: { protocol: 'https:', hostname: 'canvas.domlavin.com', reload() {} }, version: '9' });
    return { app, R, $: id => dom.document.querySelector('#' + id) };
  };
  const S = run(true), B = run(false);
  await sim.settle(5);
  assert.deepEqual([S.app.shell, S.R.length, S.$('install').hidden], [true, 0, true]);
  assert.deepEqual([B.app.shell, B.R.length, B.$('install').hidden], [false, 1, false], 'Safari on the iPad: registers, offers Install app');
});

// fixer N's measure: a detached <input type=file> never fires change / cancel in the app's WKWebView — every picker main.js makes
// (`inp.type = 'file'`) must sit in the document before its click (tuningFile, drumFiles; wk.js / sx-host / sx-ui-osc / wtedit already do)
test('every file picker main.js builds is in the document before its click (WKWebView fires no change on a detached input)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const at = [...src.matchAll(/inp\.type = 'file'/g)].map(m => m.index);
  assert.ok(at.length >= 2, 'the pickers are found');
  for (const i of at) {
    const body = src.slice(i, src.indexOf('\n}\n', i));
    assert.ok(/document\.body\.appendChild\(inp\)[^]*inp\.click\(\)/.test(body), 'appended before the click: ' + src.slice(src.lastIndexOf('\nfunction ', i) + 1, src.lastIndexOf('\nfunction ', i) + 40));
  }
});
