// The installed app (owner I): manifest.webmanifest, the icons (tools/make-icons.mjs), index.html's app tags, the
// precache list (sw.js ASSETS / STATIC against tools/precache.mjs's crawl of what the page requests, its BUILD against
// the files' hash) and the service worker's logic in a fake worker scope — caches, fetch, clients and timers faked:
// install / activate (the fonts kept at install), the fetch strategies (AudioWorklet and Worker scripts served offline
// from the precache, an error page never replacing the cached app), the update messages — plus pwa.js's pure parts
// (platforms, button visibility, install steps, the Fullscreen API wrapper).
// Run: node --test tests/pwa.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { ICONS, renderIcon, decodePng } from '../tools/make-icons.mjs';
import { appRequests, swLists, buildHash } from '../tools/precache.mjs';

const ROOT = new URL('../', import.meta.url);
const read = f => readFileSync(new URL(f, ROOT), 'utf8');
const HTML = read('index.html'), MAIN = read('main.js'), SW = read('sw.js');
const N = /const VERSION = '(\d+)'/.exec(MAIN)[1];
const pwa = await import('../pwa.js?v=' + N);

/* ------------------------------------------------------------------ manifest, icons, index.html */
test('manifest.webmanifest: the installable app — name, id / start_url / scope at the root, standalone with a fullscreen override, the site\'s colours, icons 192 / 512 / maskable 512', () => {
  const M = JSON.parse(read('manifest.webmanifest'));
  assert.equal(M.name, 'SYNTH');
  assert.equal(M.short_name, 'SYNTH');
  assert.ok(typeof M.description === 'string' && M.description.length > 20);
  assert.deepEqual([M.id, M.start_url, M.scope], ['/', '/', '/']);
  assert.equal(M.display, 'standalone');
  assert.deepEqual(M.display_override, ['fullscreen', 'standalone']);
  assert.equal(M.orientation, 'any');
  const bg = /--bg: (#[0-9a-f]{6});/.exec(read('style.css'))[1], theme = /<meta name="theme-color" content="(#[0-9a-f]{6})">/.exec(HTML)[1];
  assert.deepEqual([M.background_color, M.theme_color], [bg, theme], 'the page background (style.css --bg) and index.html theme-color');
  assert.ok(M.categories.includes('music'));
  const want = [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']];
  assert.deepEqual(M.icons.map(i => [i.sizes, i.purpose]), want);
  for (const i of M.icons) {
    assert.equal(i.type, 'image/png');
    assert.ok(existsSync(new URL(i.src, ROOT)), i.src);
    const P = decodePng(readFileSync(new URL(i.src, ROOT)));
    assert.equal(P.w + 'x' + P.h, i.sizes, i.src + ': its pixel size');
  }
});

test('icons: valid PNGs (signature, chunk CRCs, IHDR … IEND) of the stated sizes, exactly tools/make-icons.mjs\'s artwork; full-bleed ones opaque, the rounded one with clear corners', () => {
  for (const I of ICONS) {
    const buf = readFileSync(new URL(I.file, ROOT)), P = decodePng(buf);
    assert.deepEqual([P.w, P.h], [I.size, I.size], I.file);
    assert.equal(P.chunks[0], 'IHDR'); assert.equal(P.chunks.at(-1), 'IEND');
    const ref = renderIcon(I.kind, I.size);
    let worst = 0;
    for (let k = 0; k < ref.length; k++) worst = Math.max(worst, Math.abs(ref[k] - P.rgba[k]));
    assert.ok(worst <= 1, I.file + ': differs from the generator by ' + worst + ' (run node tools/make-icons.mjs)');
    const A = (x, y) => P.rgba[(y * I.size + x) * 4 + 3], c = I.size >> 1;
    assert.equal(A(c, c), 255, I.file + ': opaque centre');
    if (I.kind === 'maskable' || I.kind === 'apple') {
      for (let k = 3; k < P.rgba.length; k += 4) assert.equal(P.rgba[k], 255, I.file + ': full bleed (iOS / Android mask it)');
    } else assert.equal(A(0, 0), 0, I.file + ': transparent corner');
  }
  // the mark is the brand orange (#f2a33a) somewhere in each icon, on the dark background
  for (const I of ICONS) {
    const P = decodePng(readFileSync(new URL(I.file, ROOT)));
    let hot = 0, dark = 0;
    for (let k = 0; k < P.rgba.length; k += 4) {
      const [r, g, b, a] = P.rgba.subarray(k, k + 4);
      if (a === 255 && r === 0xf2 && g === 0xa3 && b === 0x3a) hot++;
      if (a === 255 && r < 40 && g < 40 && b < 40) dark++;
    }
    assert.ok(hot > I.size && dark > I.size, I.file + ': orange mark ' + hot + ', dark background ' + dark);
  }
});

test('index.html: manifest, Apple touch icon (180 px), PNG + SVG favicons, the app meta tags, viewport-fit=cover, CORS Google Fonts; header buttons and sheet present', () => {
  const has = re => assert.match(HTML, re);
  has(/<link rel="manifest" href="manifest\.webmanifest">/);
  has(/<link rel="apple-touch-icon" href="icons\/apple-touch-icon-180\.png">/);
  has(/<link rel="icon" type="image\/png" sizes="32x32" href="icons\/favicon-32\.png">/);
  has(/<link rel="icon" href="data:image\/svg\+xml,/);
  has(/<meta name="apple-mobile-web-app-capable" content="yes">/);
  has(/<meta name="mobile-web-app-capable" content="yes">/);
  has(/<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/);
  has(/<meta name="apple-mobile-web-app-title" content="SYNTH">/);
  has(/<meta name="viewport" content="[^"]*viewport-fit=cover/);
  const fonts = [...HTML.matchAll(/<link [^>]*href="https:\/\/fonts\.googleapis\.com\/css2[^>]*>/g)].map(m => m[0]);
  assert.equal(fonts.length, 3);
  for (const l of fonts) assert.match(l, /\scrossorigin[\s>]/, 'a CORS request (the worker keeps only answers it can check): ' + l);
  for (const id of ['install', 'fullscreen', 'installSheet', 'update']) assert.match(HTML, new RegExp('<[a-z]+ id="' + id + '"[^>]*\\shidden[\\s>]'), id + ' starts hidden');
  has(/id="fullscreen"[^>]*aria-pressed="false"/);
  assert.match(HTML, /installed app keeps its own projects/, 'the in-app help says so');
  // the safe area of the installed app (black-translucent status bar): the canvas shell (IMPL-1b §3.1) is one fixed view —
  // the top tray keeps its row under the status bar's strip, the keyboard tray above the home indicator, #app the sides
  const css = read('style.css');
  assert.match(css, /\.top\.cv-top \{[^}]*height: calc\(var\(--cv-top, 48px\) \+ 1px \+ env\(safe-area-inset-top\)\); padding: env\(safe-area-inset-top\) 0 0/); // (+ its hairline)
  assert.match(css, /\.perf \{[^}]*padding: 12px 12px calc\(12px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.cv-app \{[^}]*position: fixed; inset: 0; height: 100dvh; overflow: clip;[^}]*env\(safe-area-inset-right\)[^}]*env\(safe-area-inset-left\)/);
  assert.match(css, /\.modal \{[^}]*env\(safe-area-inset-top\)[^}]*env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.cv-sheet-bd \{[^}]*env\(safe-area-inset-top\)[^}]*env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.toast \{[^}]*top: calc\(10px \+ env\(safe-area-inset-top\)\)/);
  // the page itself never scrolls (no header scrolling away, so no backdrop under the status bar any more)
  assert.match(css, /\nbody \{ overflow: hidden; overscroll-behavior: none; \}\n/);
  assert.doesNotMatch(css, /body::before/);
  for (const id of ['app', 'topTray', 'topRow', 'topGrip', 'stage', 'viewport', 'world', 'ov', 'appMenu', 'gearPop', 'srcTray', 'srcTab']) assert.match(HTML, new RegExp('id="' + id + '"'), id);
  assert.match(HTML, /<header id="topTray"[^>]*data-wk-inset="top"/);
});

test('index.html / style.css: no interface size of the app\'s own (ruling Z1: the page\'s pinch-zoom is the browser\'s, as at 75926b6) — the static viewport meta, no inline script, no − / % / + in the header, no Size help; no touch-action of the page\'s own on html / body, the html rule as before; uiscale.js gone', () => {
  const css = read('style.css'), bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/<meta name="viewport" content="([^"]+)">/.exec(HTML)[1], 'width=device-width,initial-scale=1,viewport-fit=cover');
  assert.equal((HTML.match(/<meta name="viewport"/g) || []).length, 1);
  assert.deepEqual([...HTML.matchAll(/<script\b([^>]*)>/g)].map(m => m[1]).filter(a => !/\ssrc=/.test(a)), [], 'no inline <script>');
  for (const w of ['uiZoom', 'data-uiz', 'synth-ui.scale', 'uiscale', '<b>Size:</b>', 'user-scalable']) assert.ok(!HTML.includes(w), 'index.html: ' + w);
  for (const w of ['data-uiz', '.uizoom', '.uiz-badge', '--uiz']) assert.ok(!bare.includes(w), 'style.css: ' + w);
  // (Z1 removed the page-wide pinch ban, :where(html[data-uiz]) :where(body, body *) { touch-action: pan-x pan-y }; the
  // canvas's own scrollers inside #world may refuse the page's pinch — user decision Q1: a pinch there is the canvas's)
  for (const m of bare.matchAll(/([^{}]*)\{[^}]*touch-action: pan-x pan-y/g)) assert.match(m[1], /#viewport:not\(\[data-cv-native\]\) #world /, 'touch-action: pan-x pan-y only on scrollers inside the canvas world: ' + m[1].trim());
  assert.match(bare, /\nhtml \{ scroll-padding-top: env\(safe-area-inset-top\); \}\n/, 'the html rule of 75926b6');
  assert.doesNotMatch(bare, /(^|[\s,}])(html|body)\s*\{[^}]*touch-action/, 'no touch-action on html / body');
  assert.equal(existsSync(new URL('uiscale.js', ROOT)), false, 'uiscale.js removed');
  assert.doesNotMatch(MAIN, /import [^;]*uiscale\.js/, 'main.js imports no uiscale.js');
});

/* ------------------------------------------------------------------ precache list */
test('precache: sw.js lists exactly what the page requests (tools/precache.mjs crawl of index.html, the module graph, worklets, workers); one version everywhere', () => {
  const R = appRequests(), S = swLists(SW);
  assert.deepEqual(R.problems, []);
  assert.equal(S.version, N, 'sw.js VERSION = main.js VERSION');
  assert.equal(/const VERSION = '(\d+)'/.exec(read('assets.js'))[1], N, 'assets.js VERSION');
  assert.deepEqual(S.assets.slice().sort(), R.versioned, 'sw.js ASSETS (node tools/precache.mjs --write)');
  assert.deepEqual(S.statics, R.statics, 'sw.js STATIC');
  assert.equal(S.build, buildHash(R), 'sw.js BUILD: a site file changed since node tools/precache.mjs --write (run it; a release also bumps VERSION)');
  // every script of the site is reached by the crawl (a new worker or worklet would show here) — sw.js itself excepted;
  // the hardware panel layouts (panels/*.js, imported directory-relative by panels/index.js) too
  const js = readdirSync(ROOT).filter(f => f.endsWith('.js') && f !== 'sw.js')
    .concat(readdirSync(new URL('panels/', ROOT)).filter(f => f.endsWith('.js')).map(f => 'panels/' + f)).sort();
  assert.deepEqual(R.versioned.filter(f => f.endsWith('.js')), js);
  assert.ok(R.versioned.includes('style.css') && R.versioned.includes('pwa.js') && R.versioned.includes('engine.js'));
  for (const f of ['wtwork.js', 'smpwork.js', 'smprender.js', 'sx-ui-mix.js', 'serum-ui.js']) assert.ok(R.versioned.includes(f), f);
  for (const s of S.statics) if (s !== './') assert.ok(existsSync(new URL(s, ROOT)), s);
  for (const m of HTML.matchAll(/\?v=(\d+)/g)) assert.equal(m[1], N, 'index.html ?v=');
  // DSP scripts: the worklet list of main.js, the render farm's list and wk.loadDSP's are one list
  const dsp = /const DSP_FILES = \[([^\]]*)\]/.exec(MAIN)[1].match(/'[^']+'/g).join(), far = /const DSP = \[([^\]]*)\]/.exec(read('smprender.js'))[1].match(/'[^']+'/g).join();
  assert.equal(far, dsp);
});

/* ------------------------------------------------------------------ the service worker in a fake scope */
const ORIGIN = 'https://synth.test', SHELL = 'synth-shell-v' + N + '-' + swLists(SW).build;
// a site file as the server answers it (GitHub Pages ignores the query; '/' is index.html)
function siteFile(path) {
  const p = path === '/' ? 'index.html' : path.slice(1);
  try { return { body: readFileSync(new URL(p, ROOT)), ct: /\.css$/.test(p) ? 'text/css' : /\.html$/.test(p) ? 'text/html' : /\.png$/.test(p) ? 'image/png' : /\.webmanifest$/.test(p) ? 'application/manifest+json' : 'text/javascript' }; } catch { return null; }
}
const mkRes = (body, status, type, ct) => {
  if (type === 'opaque') { const r = Response.error(); Object.defineProperty(r, 'type', { value: 'opaque' }); return r; }
  const r = new Response(status === 304 || status === 204 ? null : body, { status, headers: { 'Content-Type': ct || 'text/plain' } });
  Object.defineProperty(r, 'type', { value: type });
  return r;
};
class FakeCache {
  constructor() { this.m = new Map(); }
  static key(r) { return typeof r === 'string' ? new URL(r).href : r.url; }
  async match(r, o = {}) {
    const k = FakeCache.key(r), base = k.split('?')[0];
    let hit = this.m.get(k);
    if (!hit && o.ignoreSearch) for (const [kk, v] of this.m) if (kk.split('?')[0] === base) { hit = v; break; }
    return hit ? new Response(hit.body, { status: hit.status, headers: hit.headers }) : undefined;
  }
  async put(r, res) {
    if (res.bodyUsed) throw new TypeError('body used');
    const k = FakeCache.key(r), body = Buffer.from(await res.arrayBuffer());
    this.m.delete(k);
    this.m.set(k, { body, status: res.status, headers: [...res.headers] });
  }
  async keys() { return [...this.m.keys()].map(url => ({ url })); }
  async delete(r) { return this.m.delete(FakeCache.key(r)); }
}
function swScope(o = {}) {
  const origin = o.origin || ORIGIN, L = {}, stores = new Map(), routes = new Map(), held = new Map();
  const env = { L, stores, routes, fetches: [], online: true, skipped: 0, claimed: 0, windows: [{ id: 'w1' }], timers: [] };
  const caches = {
    async open(n) { if (!stores.has(n)) stores.set(n, new FakeCache()); return stores.get(n); },
    async keys() { return [...stores.keys()]; },
    async delete(n) { return stores.delete(n); },
    async match(r, opt) { for (const c of stores.values()) { const h = await c.match(r, opt); if (h) return h; } return undefined; },
  };
  async function fetch(req) {
    const url = new URL(typeof req === 'string' ? req : req.url);
    env.fetches.push({ url: url.href, cache: req.cache || 'default' });
    if (!env.online) throw new TypeError('Failed to fetch');
    const key = url.origin === origin ? url.pathname + url.search : url.href;
    if (held.has(key)) await held.get(key).promise;
    const r = routes.get(key) || routes.get(url.origin === origin ? url.pathname : url.href);
    if (r) return mkRes(r.body, r.status || 200, r.type || (url.origin === origin ? 'basic' : 'cors'), r.ct);
    if (url.origin !== origin) return mkRes('', 404, 'cors');
    const f = siteFile(url.pathname);
    return f ? mkRes(f.body, 200, 'basic', f.ct) : mkRes('not found', 404, 'basic');
  }
  env.hold = key => { let release; const promise = new Promise(r => { release = r; }); held.set(key, { promise }); return () => { held.delete(key); release(); }; };
  const setTimeout = (fn, ms, ...a) => { const t = { fn, ms, a }; env.timers.push(t); return t; };
  const clearTimeout = t => { const i = env.timers.indexOf(t); if (i >= 0) env.timers.splice(i, 1); };
  env.tick = () => { const q = env.timers.splice(0); for (const t of q) t.fn(...t.a); };
  const self = {
    location: new URL(origin + '/sw.js'),
    registration: { scope: origin + '/' },
    addEventListener(t, f) { L[t] = f; },
    skipWaiting() { env.skipped++; return Promise.resolve(); },
    clients: { claim() { env.claimed++; return Promise.resolve(); }, matchAll(opt) { env.matchAll = opt; return Promise.resolve(env.windows.slice()); } },
  };
  const ctx = vm.createContext({ self, caches, fetch, Request, Response, Headers, URL, setTimeout, clearTimeout, console });
  vm.runInContext(SW, ctx, { filename: 'sw.js' });
  const ext = () => { const e = { waits: [], waitUntil(p) { e.waits.push(Promise.resolve(p)); } }; return e; };
  const drain = async e => { let n = -1; while (n !== e.waits.length) { n = e.waits.length; await Promise.allSettled(e.waits); } };
  env.install = async () => { const e = ext(); L.install(e); await drain(e); return Promise.all(e.waits); };
  env.activate = async () => { const e = ext(); L.activate(e); await drain(e); };
  // a fetch event: { handled, res (promise), done() (the response and every waitUntil settled) }
  env.req = (url, r = {}) => ({ url: new URL(url, origin + '/').href, method: r.method || 'GET', mode: r.mode || 'cors', destination: r.dest || '', headers: new Headers(r.headers || {}), cache: 'default' });
  env.fetch = (url, r = {}) => {
    const e = ext();
    let res = null;
    e.request = env.req(url, r);
    e.respondWith = p => { res = Promise.resolve(p); };
    L.fetch(e);
    return { handled: !!res, res, done: async () => { try { await res; } catch { /* a network error */ } await drain(e); } };
  };
  env.get = async (url, r) => { const f = env.fetch(url, r); assert.ok(f.handled, url + ' handled by the worker'); const res = await f.res; await f.done(); return res; };
  env.message = async (data, withPort = true) => {
    const e = ext(), got = [];
    e.data = data; e.ports = withPort ? [{ postMessage: m => got.push(m) }] : [];
    L.message(e);
    await drain(e);
    return JSON.parse(JSON.stringify(got)); // (objects of the worker's realm)
  };
  env.shell = () => stores.get(SHELL);
  return env;
}
const textOf = async res => Buffer.from(await res.arrayBuffer()).toString('utf8');
const fileText = f => read(f);

test('sw install: precaches every shell URL with cache: no-cache (revalidated, never a stale HTTP copy); a page of another version or a failed file fails the install; nothing activates by itself', async () => {
  const S = swLists(SW), E = swScope();
  await E.install();
  const shell = E.shell(), keys = [...shell.m.keys()];
  const want = S.assets.map(f => ORIGIN + '/' + f + '?v=' + N).concat(S.statics.map(f => new URL(f, ORIGIN + '/').href));
  assert.deepEqual(keys.slice().sort(), want.slice().sort());
  assert.ok(E.fetches.filter(f => f.url.startsWith(ORIGIN)).every(f => f.cache === 'no-cache'), 'cache: no-cache');
  assert.equal(E.stores.get('synth-fonts-v1').m.size, 0, 'the fonts unreachable (404): the install goes on without them');
  assert.equal(E.skipped, 0, 'a new worker waits (no skipWaiting at install)');
  assert.equal(E.claimed, 0);
  assert.equal(await textOf(await shell.match(ORIGIN + '/')), fileText('index.html'), 'the page as ./');
  assert.equal(await textOf(await shell.match(ORIGIN + '/engine.js?v=' + N)), fileText('engine.js'));
  // the CDN still answering the previous page: no install (the shell would not match it)
  const E2 = swScope();
  E2.routes.set('/', { body: fileText('index.html').replace(/\?v=\d+/g, '?v=' + (N - 1)), ct: 'text/html' });
  await assert.rejects(E2.install(), new RegExp('the page is version ' + (N - 1) + ', this worker ' + N));
  const E3 = swScope();
  E3.routes.set('/wt.js', { body: 'gone', status: 404 });
  await assert.rejects(E3.install(), /precache: .*wt\.js\?v=\d+ → 404/);
});

test('sw install keeps the page\'s Google Fonts (stylesheet + its latin font files; the first launch loaded them before the worker controlled the page): CORS requests, never a failed install for them, cached ones not fetched again', async () => {
  const href = /<link rel="stylesheet" crossorigin href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/.exec(HTML)[1];
  const inter = 'https://fonts.gstatic.com/s/inter/v18/latin.woff2', mono = 'https://fonts.gstatic.com/s/jetbrainsmono/v20/latin.woff2';
  const cyr = 'https://fonts.gstatic.com/s/inter/v18/cyrillic.woff2';
  const css = `/* cyrillic */\n@font-face { font-family: 'Inter'; font-weight: 400; src: url(${cyr}) format('woff2'); unicode-range: U+0301; }\n` +
    `/* latin */\n@font-face { font-family: 'Inter'; font-weight: 400; src: url(${inter}) format('woff2'); unicode-range: U+0000-00FF; }\n` +
    `/* latin */\n@font-face { font-family: 'Inter'; font-weight: 700; src: url(${inter}) format('woff2'); unicode-range: U+0000-00FF; }\n` +
    `/* latin */\n@font-face { font-family: 'JetBrains Mono'; src: url(${mono}) format('woff2'); unicode-range: U+0000-00FF; }\n`;
  const E = swScope();
  E.routes.set(href, { body: css, ct: 'text/css' });
  E.routes.set(inter, { body: 'INTER', ct: 'font/woff2' });
  E.routes.set(mono, { body: 'MONO', ct: 'font/woff2' });
  E.routes.set(cyr, { body: 'CYR', ct: 'font/woff2' });
  await E.install();
  const F = E.stores.get('synth-fonts-v1');
  assert.deepEqual([...F.m.keys()].sort(), [href, inter, mono].sort(), 'the stylesheet and the latin files (each once)');
  assert.equal(E.timers.length, 0, 'the FONT_WAIT timer is cleared');
  // offline, the page's fonts come from that cache
  E.online = false;
  assert.equal(await textOf(await E.get(href, { dest: 'style' })), css);
  assert.equal(await textOf(await E.get(inter, { dest: 'font' })), 'INTER');
  // the next version's install: cached ones are not fetched again
  E.online = true;
  const n = E.fetches.length;
  await E.install();
  assert.equal(E.fetches.slice(n).filter(f => !f.url.startsWith(ORIGIN)).length, 0);
  // the font hosts unreachable: the install still succeeds, without fonts
  const E2 = swScope();
  E2.routes.set(href, { type: 'opaque' });
  await E2.install();
  assert.ok(E2.shell().m.size > 40);
  assert.equal(E2.stores.get('synth-fonts-v1').m.size, 0, 'an opaque answer is never kept');
});

test('sw activate: the other synth-* caches go (previous shells), the fonts cache and other apps\' caches stay; the open windows are claimed', async () => {
  const E = swScope();
  for (const n of ['synth-shell-v6', 'synth-shell-v5', 'synth-fonts-v1', 'someone-else', 'synth-fonts-v0', 'synth-shell-v' + N + '-0123456789ab']) E.stores.set(n, new FakeCache());
  await E.install();
  await E.activate();
  assert.deepEqual([...E.stores.keys()].sort(), ['someone-else', 'synth-fonts-v1', SHELL].sort(), 'an older build of this version goes too');
  assert.equal(E.claimed, 1);
});

test('sw ?v= files offline: AudioWorklet modules (addModule), module Workers and their imports, the render farm\'s importScripts, the modules and the stylesheet come from the precache — no network', async () => {
  const E = swScope();
  await E.install();
  E.online = false;
  const before = E.fetches.length;
  const reqs = [['engine.js', 'audioworklet'], ['sx-base.js', 'audioworklet'], ['fx-dsp.js', 'audioworklet'], ['serum-dsp.js', 'audioworklet'],
    ['wtwork.js', 'worker'], ['smpwork.js', 'worker'], ['smprender.js', 'worker'], ['wt.js', 'script'], ['smpgen.js', 'script'],
    ['sx-base.js', 'script'], ['engine.js', 'script'], ['main.js', 'script'], ['pwa.js', 'script'], ['serum-ui.js', 'script'], ['sx-ui-mix.js', 'script'],
    ['cv-panel.js', 'script'], ['panels/index.js', 'script'], ['panels/minimoog.js', 'script'], ['style.css', 'style']];
  for (const [f, dest] of reqs) {
    const res = await E.get('/' + f + '?v=' + N, { dest });
    assert.equal(res.status, 200, f);
    assert.equal(await textOf(res), fileText(f), f + ' (' + dest + ')');
  }
  assert.equal(E.fetches.length, before, 'served without the network');
  // online too: cache first (a ?v=N URL names one build)
  E.online = true;
  await E.get('/wk.js?v=' + N, { dest: 'script' });
  assert.equal(E.fetches.length, before);
});

test('sw ?v= files: a miss of this version is fetched and kept; a 404 or an opaque answer never; another version comes from any synth cache (a waiting worker\'s precache), else the network, and is never kept in this shell', async () => {
  const E = swScope();
  await E.install();
  const shell = E.shell(), u = ORIGIN + '/wt.js?v=' + N;
  await shell.delete(u);
  const res = await E.get('/wt.js?v=' + N, { dest: 'script' });
  assert.equal(await textOf(res), fileText('wt.js'));
  assert.ok(shell.m.has(u), 'kept');
  E.routes.set('/nope.js', { body: 'missing', status: 404 });
  assert.equal((await E.get('/nope.js?v=' + N)).status, 404);
  assert.ok(!shell.m.has(ORIGIN + '/nope.js?v=' + N), 'a 404 is not kept');
  E.routes.set('/odd.js', { type: 'opaque' });
  assert.equal((await E.get('/odd.js?v=' + N)).type, 'opaque');
  assert.ok(!shell.m.has(ORIGIN + '/odd.js?v=' + N), 'an opaque answer is not kept');
  // v + 1: from the waiting worker's precache when there is one
  const next = String(+N + 1), nu = ORIGIN + '/main.js?v=' + next;
  E.stores.set('synth-shell-v' + next, new FakeCache());
  await E.stores.get('synth-shell-v' + next).put(nu, new Response('NEXT'));
  E.online = false;
  assert.equal(await textOf(await E.get('/main.js?v=' + next)), 'NEXT');
  const miss = E.fetch('/graph.js?v=' + next);
  await assert.rejects(miss.res, /Failed to fetch/, 'offline and nowhere: a network error');
  E.online = true;
  assert.equal(await textOf(await E.get('/graph.js?v=' + next)), fileText('graph.js'));
  assert.ok(!shell.m.has(ORIGIN + '/graph.js?v=' + next), 'not kept in this version\'s shell');
});

test('sw ?v= files: this worker\'s own precache first — an older build of the same version (a change deployed without a VERSION bump) cached beside it is never served by it', async () => {
  const E = swScope(), old = 'synth-shell-v' + N + '-0123456789ab';
  E.stores.set(old, new FakeCache()); // created first: caches.match would find it first
  await E.stores.get(old).put(ORIGIN + '/main.js?v=' + N, new Response('OLD BUILD'));
  await E.install();
  assert.equal(await textOf(await E.get('/main.js?v=' + N, { dest: 'script' })), fileText('main.js'));
});

test('sw navigations: network first (a page of this version refreshes the cached one, a newer page does not); offline or after 4 s without an answer: the cached page for /, /index.html and /?query', async () => {
  const E = swScope();
  await E.install();
  const shell = E.shell(), html = fileText('index.html');
  // online: the network's page, kept when it is this version
  E.routes.set('/', { body: html + '<!-- MARK-FRESH -->', ct: 'text/html' });
  let res = await E.get('/', { mode: 'navigate', dest: 'document' });
  assert.match(await textOf(res), /MARK-FRESH/);
  assert.match(await textOf(await shell.match(ORIGIN + '/')), /MARK-FRESH/, 'refreshed');
  // a newer page (the next deploy) is shown but never stored under this version's files
  E.routes.set('/', { body: html.replace(/\?v=\d+/g, '?v=' + (+N + 1)), ct: 'text/html' });
  res = await E.get('/', { mode: 'navigate' });
  assert.match(await textOf(res), new RegExp('main\\.js\\?v=' + (+N + 1)));
  assert.match(await textOf(await shell.match(ORIGIN + '/')), new RegExp('main\\.js\\?v=' + N + '"'), 'the cached page stays this version');
  // offline: the cached page for every form of the start URL
  E.online = false;
  for (const p of ['/', '/index.html', '/?source=homescreen', '/#serum']) {
    res = await E.get(p, { mode: 'navigate' });
    assert.equal(res.status, 200, p);
    assert.match(await textOf(res), new RegExp('main\\.js\\?v=' + N), p);
  }
  // another path offline, nothing cached: the network error stands
  await assert.rejects(E.fetch('/tests/bench.html', { mode: 'navigate' }).res, /Failed to fetch/);
  // a slow network: the cached page after NAV_WAIT, the late answer still refreshes the cache
  E.online = true;
  E.routes.set('/', { body: html + '<!-- MARK-LATE -->', ct: 'text/html' });
  const release = E.hold('/');
  const f = E.fetch('/', { mode: 'navigate' });
  await new Promise(r => setImmediate(r));
  assert.equal(E.timers.length, 1);
  assert.equal(E.timers[0].ms, 4000, 'NAV_WAIT');
  E.tick();
  res = await f.res;
  assert.doesNotMatch(await textOf(res), /MARK-LATE/, 'the cached page');
  release();
  await f.done();
  assert.match(await textOf(await shell.match(ORIGIN + '/')), /MARK-LATE/, 'refreshed by the late answer');
  // a quick answer cancels the timer
  E.routes.set('/', { body: html, ct: 'text/html' });
  await E.get('/', { mode: 'navigate' });
  assert.equal(E.timers.length, 0);
});

test('sw navigations: an error page (404 / 5xx while the site deploys) never replaces the cached app, nor the cached page; other paths, a redirect and an uncached app get the network\'s answer', async () => {
  const E = swScope();
  await E.install();
  const shell = E.shell();
  for (const status of [404, 500, 503]) {
    E.routes.set('/', { body: 'Site down ' + status, status, ct: 'text/html' });
    for (const p of ['/', '/index.html', '/?source=homescreen']) {
      const res = await E.get(p, { mode: 'navigate' });
      assert.equal(res.status, 200, p + ' ' + status);
      assert.match(await textOf(res), new RegExp('main\\.js\\?v=' + N), 'the cached app');
    }
  }
  assert.match(await textOf(await shell.match(ORIGIN + '/')), new RegExp('main\\.js\\?v=' + N), 'the cached page kept');
  E.routes.set('/tests/bench.html', { body: 'nope', status: 404, ct: 'text/html' });
  assert.equal((await E.get('/tests/bench.html', { mode: 'navigate' })).status, 404, 'another path: as answered');
  E.routes.set('/', { body: '', status: 302, type: 'opaqueredirect' });
  assert.equal((await E.get('/', { mode: 'navigate' })).type, 'opaqueredirect', 'a redirect is followed');
  // nothing cached: the error page
  const E2 = swScope();
  E2.routes.set('/', { body: 'Site down', status: 503, ct: 'text/html' });
  assert.equal((await E2.get('/', { mode: 'navigate' })).status, 503);
});

test('sw other same-origin GETs: network first; offline the cached copy, then the precached ?v= build of that file (wk.loadDSP\'s unversioned default URLs)', async () => {
  const E = swScope();
  await E.install();
  const n = E.fetches.length;
  assert.equal((await E.get('/manifest.webmanifest')).status, 200);
  assert.equal(E.fetches.length, n + 1, 'network first');
  E.online = false;
  assert.equal(JSON.parse(await textOf(await E.get('/manifest.webmanifest'))).name, 'SYNTH');
  assert.equal((await E.get('/icons/icon-192.png')).status, 200);
  assert.equal(await textOf(await E.get('/fx-dsp.js', { dest: 'script' })), fileText('fx-dsp.js'));
  await assert.rejects(E.fetch('/not-here.txt').res, /Failed to fetch/);
});

test('sw Google Fonts: stale-while-revalidate with CORS answers only (never an opaque one); offline with nothing cached an empty stylesheet (system fonts), a font file fails', async () => {
  const E = swScope();
  const css = 'https://fonts.googleapis.com/css2?family=Inter', woff = 'https://fonts.gstatic.com/s/inter/v1/a.woff2';
  E.routes.set(css, { body: '@font-face{font-family:Inter}', ct: 'text/css' });
  E.routes.set(woff, { body: 'WOFF2', ct: 'font/woff2' });
  assert.match(await textOf(await E.get(css, { dest: 'style' })), /Inter/);
  assert.equal(await textOf(await E.get(woff, { dest: 'font' })), 'WOFF2');
  const F = E.stores.get('synth-fonts-v1');
  assert.deepEqual([...F.m.keys()].sort(), [css, woff].sort());
  // cached copy first, the network refreshes it behind
  E.routes.set(css, { body: '@font-face{font-family:Inter2}', ct: 'text/css' });
  assert.doesNotMatch(await textOf(await E.get(css)), /Inter2/);
  assert.match(await textOf(await F.match(css)), /Inter2/);
  // an opaque (no-cors) answer is passed on, never kept
  const css2 = 'https://fonts.googleapis.com/css2?family=Mono';
  E.routes.set(css2, { type: 'opaque' });
  await E.get(css2);
  assert.ok(!F.m.has(css2));
  // offline: cached ones still served; missing stylesheet → empty CSS; missing font file → network error
  E.online = false;
  assert.equal(await textOf(await E.get(woff)), 'WOFF2');
  const empty = await E.get(css2);
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get('content-type'), 'text/css');
  assert.doesNotMatch(await textOf(empty), /font-face/);
  await assert.rejects(E.fetch('https://fonts.gstatic.com/s/inter/v1/b.woff2').res, /Failed to fetch/);
});

test('sw leaves POST, range requests and other origins to the browser (no respondWith)', async () => {
  const E = swScope();
  await E.install();
  assert.equal(E.fetch('/main.js?v=' + N, { method: 'POST' }).handled, false);
  assert.equal(E.fetch('/', { method: 'POST', mode: 'navigate' }).handled, false);
  assert.equal(E.fetch('/song.js?v=' + N, { headers: { Range: 'bytes=0-10' } }).handled, false);
  assert.equal(E.fetch('https://example.com/x.js?v=' + N).handled, false);
  assert.equal(E.fetch('https://cdn.test/lib.js').handled, false);
});

test('sw messages: skip → skipWaiting; adopt → only for a page of this version that is the only window and no older build of it cached (else ok: false); version', async () => {
  const E = swScope();
  assert.deepEqual(await E.message({ t: 'version' }), [{ t: 'version', v: N }]);
  assert.deepEqual(await E.message({ t: 'adopt', v: String(+N - 1) }), [{ t: 'adopt', ok: false }], 'an older page: the toast instead');
  assert.equal(E.skipped, 0);
  E.windows = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(await E.message({ t: 'adopt', v: N }), [{ t: 'adopt', ok: false }], 'other windows may run the old version');
  assert.deepEqual({ ...E.matchAll }, { type: 'window', includeUncontrolled: true });
  assert.equal(E.skipped, 0);
  E.windows = [{ id: 'a' }];
  // an older build of this version still cached (deployed without a VERSION bump): the page runs on its files
  E.stores.set('synth-shell-v' + N + '-0123456789ab', new FakeCache());
  assert.deepEqual(await E.message({ t: 'adopt', v: N }), [{ t: 'adopt', ok: false }]);
  E.stores.delete('synth-shell-v' + N + '-0123456789ab');
  E.stores.set('synth-shell-v' + (+N - 1), new FakeCache()); // (the previous version's: the page did not use it)
  assert.deepEqual(await E.message({ t: 'adopt', v: N }), [{ t: 'adopt', ok: true }]);
  assert.equal(E.skipped, 1);
  await E.message({ t: 'skip' }, false);
  assert.equal(E.skipped, 2);
  await E.message('junk', false);
  await E.message(null, false);
  assert.equal(E.skipped, 2);
});

test('sw on localhost (development: files change without a version bump): ?v= files network first, the cache offline', async () => {
  const E = swScope({ origin: 'http://localhost:8817' });
  await E.install();
  E.routes.set('/wk.js', { body: 'EDITED', ct: 'text/javascript' });
  assert.equal(await textOf(await E.get('/wk.js?v=' + N)), 'EDITED');
  E.online = false;
  assert.equal(await textOf(await E.get('/wk.js?v=' + N)), 'EDITED', 'the last answer was kept');
  assert.equal(await textOf(await E.get('/engine.js?v=' + N, { dest: 'audioworklet' })), fileText('engine.js'));
});

/* ------------------------------------------------------------------ pwa.js pure parts */
const UA = {
  ipadSafari: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 },
  ipadDesktopFirefox: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0', platform: 'MacIntel', maxTouchPoints: 5 },
  ipadDesktopChrome: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Version/18.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 },
  ipadChrome: { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1', platform: 'iPad', maxTouchPoints: 5 },
  iphoneSafari: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 },
  iphoneFirefox: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15', platform: 'iPhone', maxTouchPoints: 5 },
  iphoneInsta: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0', platform: 'iPhone', maxTouchPoints: 5 },
  macSafari: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 },
  macSafari16: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 },
  winChrome: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', platform: 'Win32', maxTouchPoints: 0 },
  winEdge: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0', platform: 'Win32', maxTouchPoints: 0 },
  android: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', platform: 'Linux armv81', maxTouchPoints: 5 },
  firefox: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', platform: 'Linux x86_64', maxTouchPoints: 0 },
};

test('pwa.js platform(): iPadOS (desktop-class Safari UA + touch), iPhone, the iOS browsers (Chrome / Firefox / in-app), Safari on a Mac, the desktop and Android browsers', () => {
  const P = k => { const p = pwa.platform(UA[k]); return [p.ios, p.ipad, p.mac, p.browser]; };
  assert.deepEqual(P('ipadSafari'), [true, true, false, 'safari']);
  assert.deepEqual(P('ipadChrome'), [true, true, false, 'chrome']);
  assert.deepEqual(P('iphoneSafari'), [true, false, false, 'safari']);
  assert.deepEqual(P('iphoneFirefox'), [true, false, false, 'firefox']);
  assert.deepEqual(P('iphoneInsta'), [true, false, false, 'other']);
  assert.deepEqual(P('macSafari'), [false, false, true, 'safari']);
  assert.deepEqual(P('winChrome'), [false, false, false, 'chrome']);
  assert.deepEqual(P('winEdge'), [false, false, false, 'edge']);
  assert.deepEqual(P('android'), [false, false, false, 'chrome']);
  assert.deepEqual(P('firefox'), [false, false, false, 'firefox']);
  assert.deepEqual((p => [p.ios, p.ipad, p.mac, p.browser])(pwa.platform({ ...UA.android, platform: 'MacIntel' })), [false, false, false, 'chrome'], 'an Android agent on an emulator reporting a Mac platform is not an iPad');
  assert.equal(pwa.platform(UA.macSafari).safariVersion, 18);
  assert.deepEqual(['ipadSafari', 'ipadChrome', 'iphoneSafari', 'macSafari'].map(k => pwa.platform(UA[k]).desktopUA), [true, false, false, false], 'an iPad asking for desktop sites (a Mac\'s user agent)');
  assert.deepEqual(['ipadSafari', 'ipadChrome', 'iphoneSafari', 'iphoneInsta', 'macSafari', 'macSafari16', 'winChrome', 'android'].map(k => pwa.sheetFor(pwa.platform(UA[k]))),
    [true, true, true, true, true, false, false, false], 'the sheet: every iOS browser, Safari 17+ on a Mac');
});

test('pwa.js appButtons(): Full screen where the API works, Install app with a browser prompt or the sheet; neither in the installed app; Install gone after an install', () => {
  const B = env => { const b = pwa.appButtons(env); return [b.fs, b.install]; };
  assert.deepEqual(B({ fs: true }), [true, false], 'desktop Firefox: no install prompt');
  assert.deepEqual(B({ fs: true, prompt: true }), [true, true], 'Chrome / Edge / Android: beforeinstallprompt');
  assert.deepEqual(B({ fs: true, sheet: true }), [true, true], 'iPad Safari');
  assert.deepEqual(B({ fs: false, sheet: true }), [false, true], 'iPhone (no element full screen): Install app instead');
  assert.deepEqual(B({ standalone: true, fs: true, sheet: true, prompt: true }), [false, false], 'the installed app');
  assert.deepEqual(B({ fs: true, prompt: true, installed: true }), [true, false], 'appinstalled: the tab keeps Full screen');
  assert.deepEqual(B({}), [false, false]);
});

test('pwa.js isStandalone / fullscreenApi / swAllowed: navigator.standalone and the display modes (a window or page in full screen is not the app; fullscreen is the app on Android only); prefixed WebKit full screen; service workers on https and localhost only', async () => {
  const win = q => ({ matchMedia: m => ({ matches: q.includes(m) }) });
  assert.equal(pwa.isStandalone(win([]), {}, false), false);
  assert.equal(pwa.isStandalone(win([]), { standalone: true }, false), true, 'iOS home-screen app');
  assert.equal(pwa.isStandalone(win(['(display-mode: standalone)']), {}, false), true);
  assert.equal(pwa.isStandalone(win(['(display-mode: fullscreen)']), UA.android, false), true, 'Android: the installed app (manifest display_override fullscreen)');
  assert.equal(pwa.isStandalone(win(['(display-mode: fullscreen)']), UA.android, true), false, 'Android Chrome: a tab with the page in full screen');
  for (const k of ['winChrome', 'firefox', 'macSafari', 'ipadSafari']) {
    assert.equal(pwa.isStandalone(win(['(display-mode: fullscreen)']), UA[k], false), false, k + ': a browser window in full screen (F11) is not the app');
    assert.equal(pwa.isStandalone(win(['(display-mode: fullscreen)']), UA[k], true), false, k + ': the page in full screen');
  }
  assert.equal(pwa.isStandalone(win(['(display-mode: standalone)']), UA.winChrome, false), true, 'the installed app\'s window on a desktop');
  assert.equal(pwa.isStandalone({ matchMedia() { throw new Error('x'); } }, {}, false), false);
  // WebKit-prefixed (iPad Safari before 16.4): enter / exit return no promise
  const calls = [], root = { webkitRequestFullscreen() { calls.push('enter'); doc.webkitFullscreenElement = root; } };
  const doc = { documentElement: root, webkitFullscreenEnabled: true, webkitFullscreenElement: null, webkitExitFullscreen() { calls.push('exit'); doc.webkitFullscreenElement = null; } };
  let F = pwa.fullscreenApi(doc);
  assert.equal(F.enabled, true);
  await F.enter(); assert.equal(F.active(), true);
  await F.exit(); assert.equal(F.active(), false);
  assert.deepEqual(calls, ['enter', 'exit']);
  // standard: requestFullscreen({ navigationUI: 'hide' }); disabled (an iframe without allow, iPhone): not enabled
  const opts = [], r2 = { requestFullscreen(o) { opts.push(o); return Promise.resolve(); } };
  F = pwa.fullscreenApi({ documentElement: r2, fullscreenEnabled: true, fullscreenElement: null });
  await F.enter();
  assert.deepEqual(opts, [{ navigationUI: 'hide' }]);
  assert.equal(pwa.fullscreenApi({ documentElement: r2, fullscreenEnabled: false }).enabled, false);
  assert.equal(pwa.fullscreenApi({ documentElement: {}, fullscreenEnabled: true }).enabled, false, 'iPhone Safari: no element full screen');
  assert.equal(pwa.fullscreenApi({ documentElement: { requestFullscreen: () => {} }, fullscreenEnabled: () => true }).enabled, false, 'only a real true');
  const rej = pwa.fullscreenApi({ documentElement: { requestFullscreen() { throw new Error('no'); } }, fullscreenEnabled: true, fullscreenElement: null });
  await assert.rejects(rej.enter(), /no/);
  assert.equal(pwa.swAllowed({ protocol: 'https:', hostname: 'synth.domlavin.com' }), true);
  assert.equal(pwa.swAllowed({ protocol: 'http:', hostname: 'localhost' }), true);
  assert.equal(pwa.swAllowed({ protocol: 'http:', hostname: '127.0.0.1' }), true);
  assert.equal(pwa.swAllowed({ protocol: 'http:', hostname: 'synth.domlavin.com' }), false);
  assert.equal(pwa.swAllowed({ protocol: 'file:', hostname: '' }), false);
});

test('pwa.js installSteps(): Share → Add to Home Screen for Safari and Chrome on an iPad with a desktop user agent (either: Safari\'s toolbar at the top, Chrome\'s address bar), Safari (toolbar) and Chrome (address bar) named by an iOS user agent, the menu for Firefox / Edge, "open in Safari" for in-app browsers, File › Add to Dock on a Mac; the note on separate projects', () => {
  const flat = S => S.steps.map(st => st.map(x => (typeof x === 'string' ? x : x.b || '[' + x.icon + ']')).join(''));
  const ipad = pwa.installSteps(pwa.platform(UA.ipadSafari));
  assert.equal(ipad.title, 'Install SYNTH on your iPad');
  assert.match(flat(ipad)[0], /^Tap \[share\]Share: in Safari in the toolbar at the top \(or under \[more\]\), in Chrome at the right of the address bar\./);
  // a desktop user agent that names its browser: that browser's steps; one that names none (Firefox's Gecko one): both
  assert.match(flat(pwa.installSteps(pwa.platform(UA.ipadDesktopChrome)))[0], /^Tap \[share\]Share at the right of Chrome’s address bar/);
  assert.match(flat(pwa.installSteps(pwa.platform(UA.ipadDesktopFirefox)))[0], /in Safari in the toolbar at the top .*in Chrome at the right of the address bar/);
  assert.match(flat(pwa.installSteps(pwa.platform({ ...UA.ipadSafari, userAgent: UA.ipadSafari.userAgent + ' Instagram 350.0' })))[0], /^Open this page in Safari/, 'an in-app browser');
  assert.match(flat(ipad)[1], /\[add\]Add to Home Screen/);
  assert.match(flat(ipad)[2], /Open as Web App/);
  assert.match(ipad.note, /keeps the app’s projects separate from the browser’s/);
  assert.match(ipad.note, /works offline after its first launch/);
  const chrome = pwa.installSteps(pwa.platform(UA.ipadChrome));
  assert.match(flat(chrome)[0], /\[share\]Share at the right of Chrome’s address bar/);
  assert.match(flat(chrome)[1], /Add to Home Screen/);
  const phone = pwa.installSteps(pwa.platform(UA.iphoneSafari));
  assert.equal(phone.title, 'Install SYNTH on your iPhone');
  assert.doesNotMatch(flat(phone)[0], /at the top/);
  assert.match(flat(pwa.installSteps(pwa.platform(UA.iphoneFirefox)))[0], /menu \[more\] and tap \[share\]Share/);
  assert.match(flat(pwa.installSteps(pwa.platform(UA.iphoneInsta)))[0], /Open this page in Safari/);
  const mac = pwa.installSteps(pwa.platform(UA.macSafari));
  assert.match(flat(mac)[0], /File › \[dock\]Add to Dock/);
  assert.match(mac.note, /separately from Safari’s/);
});
