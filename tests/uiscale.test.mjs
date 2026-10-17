// The interface size (uiscale.js, lead ruling U1; design ipad-designs/ui-scale.critique.md §3–§4.1): the pure parts (the
// viewport meta strings, clamp, snap, the − / + ladder, the iOS gate, the verification states), index.html's inline boot
// script run in node:vm against the module (same gate as pwa.js platform(), same strings over the window widths × the
// ladder), and the controller on small local fakes (window, visualViewport, document, timers — never main-sim): the
// header buttons, a pinch (preview transform, one write in the same task as clearing it, the anchor scroll), the
// verification state machine (applied, a clamped width falls back and latches on P, a native zoom writes nothing until
// the page is back at its minimum scale, no visualViewport skips it), the storage event, ⌘= ⌘− ⌘0 in the installed app
// only, desktop / Android inert. Assertions compare strings and numbers only (never a fake node: an AssertionError would
// walk it).
// Run: node --max-old-space-size=2048 --test tests/uiscale.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fakeStorage } from './fakes.mjs';
import { BASE_VP, LS_KEY, LADDER, MIN, MAX, supported, clampScale, snap, stepScale, effScale, viewportContent, viewState, initUiScale } from '../uiscale.js?v=8';
import { platform } from '../pwa.js?v=8';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const UA = {
  ipadSafari: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 },
  ipadChrome: { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1', platform: 'iPad', maxTouchPoints: 5 },
  iphoneSafari: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 },
  macSafari: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 },
  winChrome: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', platform: 'Win32', maxTouchPoints: 0 },
  winTouch: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', platform: 'Win32', maxTouchPoints: 10 },
  android: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', platform: 'Linux armv81', maxTouchPoints: 5 },
  androidMac: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', platform: 'MacIntel', maxTouchPoints: 5 },
};
const zin = (P, N) => 'width=' + N + ',initial-scale=' + P / N + ',shrink-to-fit=no,user-scalable=no,viewport-fit=cover';
const zout = s => 'width=device-width,initial-scale=' + s + ',minimum-scale=' + s + ',user-scalable=no,viewport-fit=cover';

/* ------------------------------------------------------------------ pure parts */
test('viewportContent: 100 % is index.html\'s own meta; zoom-in a numeric width (N = round(P / s), initial-scale P / N, shrink-to-fit=no); zoom-out the device-width form with minimum-scale; capped at max(1, P / 360); invalid → base', () => {
  assert.equal(/<meta name="viewport" content="([^"]+)">/.exec(HTML)[1], BASE_VP, 'index.html\'s static meta is BASE_VP');
  assert.equal(viewportContent(1024, 1), BASE_VP);
  assert.equal(viewportContent(1024, 1.25), zin(1024, 819));
  assert.match(viewportContent(1024, 1.25), /^width=819,initial-scale=1\.250305\d*,shrink-to-fit=no,user-scalable=no,viewport-fit=cover$/);
  assert.equal(viewportContent(1024, 2), zin(1024, 512));
  assert.equal(viewportContent(1400, 1.1), zin(1400, 1273));
  assert.equal(viewportContent(1024, 0.75), zout(0.75));
  assert.equal(viewportContent(1366, 0.5), zout(0.5));
  assert.equal(viewportContent(320, 1.25), BASE_VP, 'Slide Over (P 320): no zoom-in, and never a zoom-out instead');
  assert.equal(viewportContent(320, 0.75), zout(0.75), 'a narrow window can still zoom out');
  assert.equal(viewportContent(390, 2), zin(390, 360), 'a phone: at most P / 360');
  assert.equal(viewportContent(1023.6, 1.25), zin(1024, 819), 'P rounded');
  for (const s of [1.004, 0.996, 0, -1, NaN, 2.5, 0.3, undefined]) assert.equal(viewportContent(1024, s), BASE_VP, String(s));
  assert.equal(viewportContent(150, 1.5), BASE_VP, 'no sensible window width');
  assert.equal(effScale(1024, 1.25), 1.25);
  assert.equal(effScale(320, 1.25), 1);
  assert.equal(effScale(390, 2), 390 / 360);
});

test('clampScale / snap / stepScale: 50–200 % and P / 360; a pinch snaps to 100 % within ±4 % and to 5 % steps; − / + follow the ladder', () => {
  assert.equal(clampScale(2, 390), 390 / 360);
  assert.equal(clampScale(0.4, 1024), MIN);
  assert.equal(clampScale(3, 1366), MAX);
  assert.equal(clampScale(0.5, 320), 0.5);
  assert.equal(clampScale(1.5, 320), 1);
  assert.equal(clampScale(NaN, 1024), 1);
  assert.equal(clampScale(1.7, 0), 1.7, 'unknown P: the range only');
  assert.deepEqual([1.03, 0.97, 1.04, 0.96, 1.06, 1.234, 0.66, 0.3, 2.4, NaN, 1.5].map(snap), [1, 1, 1, 1, 1.05, 1.25, 0.65, 0.5, 2, 1, 1.5]);
  assert.deepEqual([[1, 1], [1, -1], [1.2, 1], [0.5, -1], [2, 1], [1.35, -1], [0.67, 1], [0.6, -1], [1.75, 1]].map(([s, d]) => stepScale(s, d)), [1.1, 0.9, 1.25, 0.5, 2, 1.25, 0.75, 0.5, 2]);
  assert.deepEqual(LADDER, [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]);
});

test('supported(): iOS / iPadOS only — the gate of pwa.js platform().ios (an iPad asking for desktop sites included; a touch Windows, Android, a Mac without touch out)', () => {
  const got = Object.fromEntries(Object.entries(UA).map(([k, n]) => [k, supported(n)]));
  assert.deepEqual(got, { ipadSafari: true, ipadChrome: true, iphoneSafari: true, macSafari: false, winChrome: false, winTouch: false, android: false, androidMac: false });
  for (const [k, n] of Object.entries(UA)) assert.equal(supported(n), platform(n).ios, k);
  assert.equal(supported(undefined), false);
});

test('viewState: applied (the layout fills the window, all of it visible) — under Safari\'s aA zoom too; zoomed (the layout wider than its visible part); odd', () => {
  assert.equal(viewState(1024, 1, 1024, 1024), 'applied');
  assert.equal(viewState(819, 1024 / 819, 819, 1024), 'applied');
  assert.equal(viewState(1365, 0.75, 1365.33, 1024), 'applied');
  const aA = 1.15, k = 1024 / 819, cw = Math.round(819 / aA), vs = k * aA; // aA divides the layout, multiplies the scale
  assert.equal(viewState(cw, vs, 1024 / vs, 1024), 'applied', 'aA 115 % with 125 %');
  assert.equal(viewState(819, 2.5, 409.6, 1024), 'zoomed', 'a native zoom (double-tap)');
  assert.equal(viewState(980, k, 819, 1024), 'zoomed', 'a clamped width with the scale honoured');
  assert.equal(viewState(819, 1, 1024, 1024), 'odd');
});

/* ------------------------------------------------------------------ index.html's boot script */
const BOOT = (() => { const at = HTML.indexOf('<meta name="viewport"'); return /<script>([\s\S]*?)<\/script>/.exec(HTML.slice(at))[1]; })();
function runBoot({ nav = UA.ipadSafari, saved = null, P = 1024, cw, noVV = false, throwLS = false } = {}) {
  const meta = { attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } };
  const h = { attrs: {}, props: {}, clientWidth: cw === undefined ? P : cw, setAttribute(k, v) { this.attrs[k] = String(v); } };
  h.style = { setProperty(k, v) { h.props[k] = String(v); } };
  const ctx = {
    document: { documentElement: h, querySelector: s => (s === 'meta[name="viewport"]' ? meta : null) }, navigator: nav,
    window: { visualViewport: noVV ? undefined : { width: P, scale: 1 } },
    localStorage: { getItem: k => { if (throwLS) throw new Error('blocked'); return k === LS_KEY ? saved : null; } },
  };
  vm.runInNewContext(BOOT, ctx);
  return { content: meta.attrs.content === undefined ? null : meta.attrs.content, uiz: 'data-uiz' in h.attrs ? h.attrs['data-uiz'] : null, v: h.props['--uiz'] === undefined ? null : h.props['--uiz'] };
}

test('boot script: right after the viewport meta, before style.css; no less-than sign (main-sim\'s tag scanner); the same content and data-uiz as uiscale.js over P × the ladder (and odd stored values)', () => {
  const iMeta = HTML.indexOf('<meta name="viewport"'), iScript = HTML.indexOf('<script>'), iCss = HTML.indexOf('<link rel="stylesheet" href="style.css');
  assert.ok(iMeta > 0 && iMeta < iScript && iScript < iCss, 'order: meta ' + iMeta + ', script ' + iScript + ', style.css ' + iCss);
  assert.equal(HTML.slice(iMeta, iScript).replace(/<!--[\s\S]*?-->/g, '').trim(), '<meta name="viewport" content="' + BASE_VP + '">', 'nothing else between them');
  assert.equal(BOOT.includes('<'), false);
  assert.equal(/synth-ui\.scale/.test(BOOT), true);
  const values = LADDER.map(String).concat(['1.35', '0.55', '1.004', '2.5', '0.3', 'abc', '', null]);
  let n = 0;
  for (const P of [320, 375, 768, 834, 1024, 1194, 1366]) {
    for (const saved of values) {
      const r = runBoot({ P, saved }), s = +saved, k = effScale(P, s), want = viewportContent(P, s);
      assert.equal(r.content, want === BASE_VP ? null : want, 'P ' + P + ', stored ' + saved);
      assert.equal(r.uiz, k === 1 ? '' : String(k), 'data-uiz, P ' + P + ', stored ' + saved);
      assert.equal(r.v, k === 1 ? null : String(k), '--uiz, P ' + P + ', stored ' + saved);
      n++;
    }
  }
  assert.equal(n, 7 * 19);
  assert.deepEqual(runBoot({ P: 1024, cw: 1024, noVV: true, saved: '1.25' }), { content: zin(1024, 819), uiz: '1.25', v: '1.25' }, 'no visualViewport: clientWidth');
  assert.equal(runBoot({ P: 320, saved: '1.25' }).content, null, 'Slide Over with 125 % stored: no zoom-out (clamped like the module)');
});

test('boot script: the gate is pwa.js platform().ios; data-uiz on iOS at every size (storage blocked included), never on a desktop or Android', () => {
  for (const [k, nav] of Object.entries(UA)) {
    const r = runBoot({ nav, saved: '1.25' });
    assert.equal(r.uiz !== null, platform(nav).ios, k + ': data-uiz');
    assert.equal(r.content, platform(nav).ios ? zin(1024, 819) : null, k + ': meta');
  }
  assert.deepEqual(runBoot({ saved: '1.25', throwLS: true }), { content: null, uiz: '', v: null }, 'storage blocked: native pinch still off, meta untouched');
  assert.deepEqual(runBoot({ saved: null }), { content: null, uiz: '', v: null }, 'nothing stored: 100 %');
  assert.deepEqual(runBoot({ saved: '1.5', P: 150 }), { content: null, uiz: '', v: null }, 'no sensible width');
});

/* ------------------------------------------------------------------ the controller on fakes */
// what WebKit lays out for a meta content without any clamp: layout width and scale (a numeric width is kept while
// N × initial-scale fills the window — ViewportConfiguration::layoutWidth: a narrower window keeps it, wider than its
// visible part; the initial-scale stays the page's own)
function layoutOf(c, P) {
  if (!c || c === BASE_VP) return { cw: P, vs: 1 };
  let m = /^width=device-width,initial-scale=([\d.]+),minimum-scale=/.exec(c);
  if (m) return { cw: Math.round(P / +m[1]), vs: +m[1] };
  m = /^width=(\d+),initial-scale=([\d.e-]+),/.exec(c);
  return { cw: +m[1] * +m[2] < P - 0.5 ? Math.round(P / +m[2]) : +m[1], vs: +m[2] };
}
function makeEnv(o = {}) {
  const E = { t: 1000, q: [], rq: [], seq: 0, reg: [], writes: [], notes: [], applies: 0, scrolls: [], P: o.P || 1024 };
  const target = name => {
    const L = {};
    return {
      L,
      addEventListener(t, f) { (L[t] || (L[t] = [])).push(f); E.reg.push(name + ':' + t); },
      removeEventListener(t, f) { const l = L[t], i = l ? l.indexOf(f) : -1; if (i >= 0) { l.splice(i, 1); E.reg.splice(E.reg.indexOf(name + ':' + t), 1); } },
      fire(t, ev) { const e = ev || { type: t }; for (const f of (L[t] || []).slice()) f(e); return e; },
    };
  };
  const el = tag => {
    const e = {
      tagName: String(tag).toUpperCase(), nodeType: 1, isConnected: true, attrs: {}, hidden: false, disabled: false, textContent: '', title: '',
      onclick: null, children: [], parentNode: null, rect: { left: 0, top: 0, width: 0, height: 0 }, position: 'static', className: '',
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      hasAttribute(k) { return k in this.attrs; }, removeAttribute(k) { delete this.attrs[k]; },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      getBoundingClientRect() { return Object.assign({}, this.rect); },
      click() { if (typeof this.onclick === 'function') this.onclick({}); },
    };
    e.style = { props: {}, setProperty(k, v) { this.props[k] = String(v); } };
    return e;
  };
  const html = el('html'), body = el('body'), meta = el('meta');
  html.clientWidth = E.P;
  if (o.content) meta.attrs.content = o.content;
  const set0 = meta.setAttribute;
  meta.setAttribute = function (k, v) { if (k === 'content') E.writes.push(String(v)); set0.call(this, k, v); };
  const byId = {};
  for (const id of ['uiZoom', 'uiZoomOut', 'uiZoomPct', 'uiZoomIn']) byId[id] = el(id === 'uiZoom' ? 'div' : 'button');
  byId.uiZoom.hidden = true;
  const vv = o.noVV ? undefined : Object.assign(target('vv'), { width: E.P, scale: 1, height: 700 });
  const ls = o.ls || fakeStorage(o.saved == null ? {} : { [LS_KEY]: String(o.saved) });
  const win = Object.assign(target('win'), {
    innerWidth: o.innerWidth || E.P, innerHeight: 700, scrollY: o.scrollY || 0, visualViewport: vv,
    setTimeout: (f, ms) => { const id = ++E.seq; E.q.push({ id, at: E.t + (+ms || 0), f }); return id; },
    clearTimeout: id => { E.q = E.q.filter(x => x.id !== id); },
    requestAnimationFrame: f => { E.rq.push(f); return E.rq.length; },
    matchMedia: q => ({ matches: !!o.standalone && /standalone/.test(q) }),
    getComputedStyle: n => ({ position: n.position || 'static' }),
    scrollBy(x, y) { win.scrollY += y; E.scrolls.push(y); },
  });
  const doc = Object.assign(target('doc'), {
    documentElement: html, body, scrollingElement: { scrollHeight: 4000 }, fullscreenElement: null, webkitFullscreenElement: null,
    querySelector: sel => (sel === 'meta[name="viewport"]' ? meta : /\.modal:not\(\[hidden\]\)/.test(sel) && E.overlay ? el('div') : null),
    getElementById: id => byId[id] || null, createElement: tag => el(tag), elementFromPoint: () => E.under || null,
  });
  html.requestFullscreen = () => Promise.resolve();
  Object.assign(E, { html, body, meta, byId, vv, ls, win, doc, el });
  E.advance = ms => {
    const end = E.t + ms;
    for (;;) {
      E.q.sort((a, b) => a.at - b.at || a.id - b.id);
      const n = E.q[0];
      if (!n || n.at > end) break;
      E.q.shift(); E.t = n.at; n.f();
    }
    E.t = end;
  };
  E.frames = (k = 1) => { for (let i = 0; i < k; i++) for (const f of E.rq.splice(0)) f(E.t); };
  E.settle = () => { for (let i = 0; i < 8; i++) { E.frames(); E.advance(400); } };
  // WebKit applies the meta (no clamp) at window width E.P: the layout, the scale, a visualViewport resize
  E.webkit = () => { const L = layoutOf(meta.getAttribute('content'), E.P); html.clientWidth = L.cw; vv.scale = L.vs; vv.width = E.P / L.vs; vv.fire('resize'); };
  E.content = () => meta.getAttribute('content') || BASE_VP;
  E.start = (extra = {}) => (E.c = initUiScale(Object.assign({ win, doc, nav: o.nav || UA.ipadSafari, ls, now: () => E.t, notice: t => E.notes.push(t), onApply: () => { E.applies++; } }, extra)));
  return E;
}

test('desktop and Android: inert — available() false, no listener of any kind, the control stays hidden, no meta write, no data-uiz', () => {
  for (const nav of [UA.macSafari, UA.winChrome, UA.winTouch, UA.android]) {
    const E = makeEnv({ nav, saved: '1.25' }), c = E.start();
    assert.equal(c.available(), false);
    assert.equal(c.pinchStart({ x: 10, y: 10, d: 100 }), false);
    c.set(1.5); c.step(1);
    assert.deepEqual(E.reg, []);
    assert.deepEqual(E.writes, []);
    assert.equal(E.byId.uiZoom.hidden, true);
    assert.equal(E.html.hasAttribute('data-uiz'), false);
    assert.equal(c.state().listeners, 0);
    assert.equal(c.get(), 1);
  }
});

test('iPad: the control shown, html[data-uiz] at 100 %, no write; + / − / % write the meta and keep the size (localStorage synth-ui.scale, removed at 100 %); onApply after the new layout; the verification writes nothing more', () => {
  const E = makeEnv(), c = E.start(), b = E.byId;
  assert.equal(c.available(), true);
  assert.equal(b.uiZoom.hidden, false);
  assert.equal(b.uiZoomPct.textContent, '100 %');
  assert.equal(E.html.getAttribute('data-uiz'), '');
  assert.deepEqual(E.writes, []);
  assert.deepEqual(E.reg.slice().sort(), ['vv:resize', 'win:keydown', 'win:orientationchange', 'win:resize', 'win:storage']);
  E.settle();
  assert.deepEqual(E.writes, []);
  b.uiZoomIn.click();
  assert.deepEqual(E.writes, [zin(1024, Math.round(1024 / 1.1))]);
  assert.equal(E.ls.getItem(LS_KEY), '1.1');
  assert.deepEqual([E.html.getAttribute('data-uiz'), E.html.style.props['--uiz'], b.uiZoomPct.textContent], ['1.1', '1.1', '110 %']);
  assert.equal(E.applies, 0, 'not before the new layout');
  E.webkit(); E.frames();
  assert.equal(E.applies, 1, 'the keyboard, roll and arrangement re-fitted');
  E.settle();
  assert.equal(E.writes.length, 1, 'verified: applied');
  assert.equal(c.state().mode, 'applied');
  b.uiZoomIn.click(); E.webkit(); E.settle();
  assert.equal(E.content(), zin(1024, 819));
  assert.equal(c.get(), 1.25);
  b.uiZoomPct.click(); E.webkit(); E.settle();
  assert.equal(E.content(), BASE_VP);
  assert.equal(E.ls.getItem(LS_KEY), null, 'removed at 100 %');
  assert.equal(E.html.getAttribute('data-uiz'), '', 'still marked at 100 %');
  b.uiZoomOut.click(); E.webkit(); E.settle();
  assert.equal(E.content(), zout(0.9));
  assert.equal(E.ls.getItem(LS_KEY), '0.9');
  for (let k = 0; k < 6; k++) { b.uiZoomOut.click(); E.webkit(); E.settle(); }
  assert.deepEqual([c.get(), b.uiZoomOut.disabled, b.uiZoomIn.disabled], [0.5, true, false], 'the bottom of the range');
  assert.deepEqual(E.notes, []);
  c.destroy();
  assert.deepEqual(E.reg, [], 'destroy: every listener off');
});

test('a stored size: the boot\'s meta is kept (no write); a phone caps it at P / 360; a header button keeps the middle of the window in place when scrolled', () => {
  let E = makeEnv({ saved: '1.25', content: viewportContent(1024, 1.25) });
  E.html.clientWidth = 819; E.vv.scale = 1024 / 819; E.vv.width = 819;
  let c = E.start();
  E.settle();
  assert.deepEqual(E.writes, []);
  assert.deepEqual([c.get(), c.state().mode, E.byId.uiZoomPct.textContent], [1.25, 'applied', '125 %']);
  E = makeEnv({ P: 390, saved: '2' });
  c = E.start();
  assert.deepEqual(E.writes, [zin(390, 360)]);
  assert.equal(c.get(), 390 / 360);
  assert.equal(E.byId.uiZoomIn.disabled, true, 'at the cap');
  // scrolled: the element in the middle of the window stays there
  E = makeEnv({ scrollY: 1000 });
  c = E.start();
  const a = E.el('div');
  a.rect = { left: 0, top: 250, width: 500, height: 200 }; // the middle (y 350) is half-way down it
  E.under = a;
  E.byId.uiZoomIn.click();
  a.rect = { left: 0, top: 500, width: 500, height: 300 };
  E.webkit(); E.frames();
  assert.deepEqual(E.scrolls.map(Math.round), [Math.round(500 + 150 - 350 / 1.1)]);
});

test('pinch: preview transform on body that keeps the content under the fingers (the badge on html); release = one write in the same task as clearing it, then the anchor scroll; a re-grip continues; small pinches snap to 100 %; cancel changes nothing', () => {
  const E = makeEnv(), c = E.start(), body = E.body;
  E.settle();
  const a = E.el('div');
  a.rect = { left: 0, top: 300, width: 800, height: 200 };
  E.under = a;
  assert.equal(c.pinchStart({ x: 500, y: 400, d: 100 }), true);
  assert.equal(body.style.transformOrigin, '0 0');
  c.pinchMove({ x: 500, y: 400, d: 150 });
  E.frames();
  assert.equal(body.style.transform, 'translate(-250px, -200px) scale(1.5)');
  const badge = E.html.children.find(n => n.className === 'uiz-badge');
  assert.equal(badge ? badge.textContent : '', '150 %');
  c.pinchMove({ x: 520, y: 380, d: 150 }); // the fingers moved: the content follows them
  E.frames();
  assert.equal(body.style.transform, 'translate(-230px, -220px) scale(1.5)');
  E.vv.fire('resize'); E.advance(5000); // a resize meanwhile: nothing written mid-pinch
  assert.deepEqual(E.writes, []);
  c.pinchEnd();
  assert.deepEqual([body.style.transform, badge.hidden, E.writes.length], ['', true, 1], 'transform cleared and the meta written together');
  assert.equal(E.writes[0], zin(1024, 683));
  assert.equal(E.ls.getItem(LS_KEY), '1.5');
  a.rect = { left: 0, top: 600, width: 600, height: 250 };
  E.webkit(); E.frames();
  assert.equal(E.applies, 1);
  assert.deepEqual(E.scrolls.map(x => Math.round(x * 100) / 100), [Math.round((600 + 0.5 * 250 - 380 / 1.5) * 100) / 100], 'the anchor back under the fingers (new CSS px)');
  E.settle();
  assert.equal(E.writes.length, 1);
  // a re-grip (gesture.js calls pinchStart again): continues from the preview, commits once
  assert.equal(c.pinchStart({ x: 300, y: 300, d: 100 }), true);
  c.pinchMove({ x: 300, y: 300, d: 120 });
  assert.equal(c.pinchStart({ x: 320, y: 300, d: 50 }), true);
  c.pinchMove({ x: 320, y: 300, d: 60 });
  E.frames();
  assert.equal(c.state().pinching, true);
  c.pinchEnd();
  assert.equal(E.writes.at(-1), zin(1024, Math.round(1024 / 2)), '1.5 × 1.2 × 1.2 = 2.16 → 200 %');
  E.webkit(); E.settle();
  // a small pinch snaps back to the size it started at (here 200 %: no write); cancel: nothing
  const n = E.writes.length;
  c.pinchStart({ x: 300, y: 300, d: 100 }); c.pinchMove({ x: 300, y: 300, d: 99 }); c.pinchEnd();
  assert.equal(E.writes.length, n);
  c.pinchStart({ x: 300, y: 300, d: 100 }); c.pinchMove({ x: 300, y: 300, d: 40 }); E.frames(); c.pinchCancel();
  assert.deepEqual([E.writes.length, body.style.transform, c.get()], [n, '', 2]);
  // 100 % ± 4 %: snaps to 100 %
  c.set(1); E.webkit(); E.settle();
  c.pinchStart({ x: 300, y: 300, d: 100 }); c.pinchMove({ x: 300, y: 300, d: 103.5 }); c.pinchEnd();
  assert.deepEqual([c.get(), E.content()], [1, BASE_VP]);
  c.pinchStart({ x: 300, y: 300, d: 100 }); c.pinchMove({ x: 300, y: 300, d: 106 }); c.pinchEnd();
  assert.equal(c.get(), 1.05);
});

test('pinch refused: the browser\'s full screen (once a notice to use − / +), an open dialog, no distance; pinchMove / pinchEnd without a pinch do nothing', () => {
  const E = makeEnv(), c = E.start();
  E.settle();
  E.doc.webkitFullscreenElement = E.html;
  assert.equal(c.pinchStart({ x: 300, y: 300, d: 100 }), false);
  assert.equal(c.pinchStart({ x: 300, y: 300, d: 100 }), false);
  assert.equal(E.notes.length, 1);
  assert.match(E.notes[0], /full screen .* use − \/ \+/);
  E.doc.webkitFullscreenElement = null;
  E.overlay = true;
  assert.equal(c.pinchStart({ x: 300, y: 300, d: 100 }), false);
  E.overlay = false;
  assert.equal(c.pinchStart({ x: 300, y: 300, d: 0 }), false);
  c.pinchMove({ x: 1, y: 1, d: 300 }); c.pinchEnd(); c.pinchCancel();
  assert.deepEqual([E.writes.length, E.body.style.transform === undefined ? '' : E.body.style.transform], [0, '']);
  // a size change still settling
  c.set(1.25);
  assert.equal(c.pinchStart({ x: 300, y: 300, d: 100 }), false);
  E.webkit(); E.settle();
  assert.equal(c.pinchStart({ x: 300, y: 300, d: 100 }), true);
  c.pinchCancel();
});

test('verification: a width WebKit clamps (layout still wider than the window once settled) falls back to 100 %, disables the control and latches on P (same-P resizes write nothing); another window width tries again', () => {
  const E = makeEnv(), c = E.start(), b = E.byId;
  E.settle();
  c.set(1.25);
  assert.deepEqual(E.writes, [zin(1024, 819)]);
  E.html.clientWidth = 980; E.vv.scale = 1024 / 819; E.vv.width = 819; E.vv.fire('resize'); // clamped, scale honoured
  E.frames(); E.advance(400);
  assert.equal(E.writes.length, 1, 'still settling');
  E.settle();
  assert.deepEqual(E.writes, [zin(1024, 819), BASE_VP]);
  assert.deepEqual([c.state().mode, c.get(), b.uiZoomIn.disabled, b.uiZoomOut.disabled, b.uiZoomPct.disabled], ['clamped', 1, true, true, true]);
  assert.match(b.uiZoom.title, /not available at this window size/);
  assert.equal(E.notes.length, 1);
  assert.equal(E.ls.getItem(LS_KEY), '1.25', 'the size asked for is kept');
  E.webkit(); E.settle();
  for (let k = 0; k < 4; k++) { E.vv.fire('resize'); E.win.fire('resize'); E.settle(); }
  c.set(1.5);
  assert.equal(E.writes.length, 2, 'latched on P: no writes');
  assert.equal(c.pinchStart({ x: 300, y: 300, d: 100 }), false);
  E.P = 1366; E.webkit(); E.settle(); // a wider window (rotated, Split View dragged)
  assert.equal(E.writes.at(-1), viewportContent(1366, 1.5));
  assert.deepEqual([c.state().mode, b.uiZoomIn.disabled], ['applied', false]);
});

test('verification: a native zoom (double-tap, trackpad) writes nothing — a notice, the size asked for kept — until the page is back at its minimum scale; then it applies', () => {
  const E = makeEnv({ saved: '1.25', content: viewportContent(1024, 1.25) });
  E.html.clientWidth = 819; E.vv.scale = 1024 / 819; E.vv.width = 819;
  const c = E.start(), b = E.byId;
  E.settle();
  E.vv.scale = 2.5; E.vv.width = 1024 / 2.5; E.vv.fire('resize'); // a double-tap zoomed the page
  E.settle();
  assert.equal(c.state().mode, 'zoomed');
  assert.equal(E.notes.length, 1);
  assert.match(E.notes[0], /pinch it back out .*double-tap/);
  assert.deepEqual([c.available(), E.html.hasAttribute('data-uiz')], [false, false], 'the native pinch back out is the browser\'s');
  b.uiZoomIn.click();
  assert.deepEqual(E.writes, [], 'no write while natively zoomed');
  assert.equal(E.ls.getItem(LS_KEY), '1.5');
  assert.equal(E.notes.length, 2);
  assert.equal(c.pinchStart({ x: 300, y: 300, d: 100 }), false);
  E.vv.scale = 1024 / 819; E.vv.width = 819; E.vv.fire('resize'); // zoomed back out
  E.settle();
  assert.deepEqual(E.writes, [viewportContent(1024, 1.5)]);
  assert.equal(c.state().mode, 'applied');
  assert.deepEqual([c.available(), E.html.getAttribute('data-uiz')], [true, '1.5']);
});

test('verification: iPhone Safari\'s focus zoom at 100 % (a 12 px field) — no notice, data-uiz off and available() false (the native pinch back out works), nothing written; back at the minimum scale all as before', () => {
  const E = makeEnv({ P: 375, nav: UA.iphoneSafari }), c = E.start();
  E.settle();
  assert.deepEqual([c.state().mode, c.available(), E.html.getAttribute('data-uiz')], ['applied', true, '']);
  E.vv.scale = 16 / 12; E.vv.width = 375 * 12 / 16; E.vv.fire('resize');
  E.settle();
  assert.deepEqual([c.state().mode, c.available(), E.html.hasAttribute('data-uiz'), E.notes.length, E.writes.length], ['zoomed', false, false, 0, 0]);
  assert.equal(c.pinchStart({ x: 100, y: 100, d: 100 }), false);
  E.vv.scale = 1; E.vv.width = 375; E.vv.fire('resize');
  E.settle();
  assert.deepEqual([c.state().mode, c.available(), E.html.getAttribute('data-uiz'), E.notes.length, E.writes.length], ['applied', true, '', 0, 0]);
});

test('verification: a narrower window at a zoom-in size (rotation, Split View, Slide Over) keeps the old width=N — written again for the new P, never taken for a native zoom; a native zoom (P unchanged) still writes nothing', () => {
  const E = makeEnv({ P: 1366, saved: '1.25', content: viewportContent(1366, 1.25) });
  E.webkit();
  const c = E.start(), b = E.byId;
  E.settle();
  assert.deepEqual([c.state().mode, E.writes.length], ['applied', 0]);
  E.P = 1024; E.webkit(); E.win.fire('orientationchange'); // landscape → portrait: WebKit keeps width=1093 at 125 %
  assert.deepEqual([E.html.clientWidth, Math.round(E.vv.width)], [1093, 819]);
  E.advance(200);
  assert.deepEqual(E.writes, [viewportContent(1024, 1.25)]);
  E.webkit(); E.settle();
  assert.deepEqual([c.state().mode, c.get(), E.notes.length, E.html.clientWidth], ['applied', 1.25, 0, 819]);
  b.uiZoomIn.click(); E.webkit(); E.settle();
  assert.equal(E.content(), viewportContent(1024, 1.5));
  E.P = 320; E.webkit(); E.advance(200); // Slide Over: no zoom-in there
  assert.equal(E.content(), BASE_VP);
  E.webkit(); E.settle();
  assert.deepEqual([c.state().mode, c.get(), E.notes.length], ['applied', 1, 0]);
  E.P = 1024; E.webkit(); E.settle();
  assert.equal(E.content(), viewportContent(1024, 1.5), 'back: the size asked for');
  E.webkit(); E.settle();
  const n = E.writes.length;
  E.vv.scale = 2.5; E.vv.width = 1024 / 2.5; E.vv.fire('resize'); // a native zoom: P unchanged
  E.settle();
  assert.deepEqual([c.state().mode, E.writes.length], ['zoomed', n]);
  // rotated right after the load (before the boot's layout was verified): written again, never a clamp
  const E2 = makeEnv({ P: 1366, saved: '1.25', content: viewportContent(1366, 1.25) });
  E2.webkit();
  const c2 = E2.start();
  E2.P = 1024; E2.webkit(); E2.advance(200);
  assert.deepEqual([c2.state().mode, E2.writes], ['applied', [viewportContent(1024, 1.25)]]);
});

test('verification at boot: a native zoom a reload / tab restore brings back (above the content\'s initial-scale) is no clamp — zoomed, nothing written, the size back once zoomed out; a clamp (at that scale) still falls back', () => {
  let E = makeEnv({ saved: '1.25', content: viewportContent(1024, 1.25) });
  E.html.clientWidth = 819; E.vv.scale = 2.5; E.vv.width = 1024 / 2.5;
  let c = E.start();
  E.settle();
  assert.deepEqual([c.state().mode, E.writes.length, E.notes.length], ['zoomed', 0, 1]);
  assert.match(E.notes[0], /zoomed by the browser/);
  E.vv.scale = 1024 / 819; E.vv.width = 819; E.vv.fire('resize');
  E.settle();
  assert.deepEqual([c.state().mode, c.get(), E.byId.uiZoomIn.disabled, E.writes.length], ['applied', 1.25, false, 0]);
  E = makeEnv({ saved: '1.25', content: viewportContent(1024, 1.25) });
  E.html.clientWidth = 980; E.vv.scale = 1024 / 819; E.vv.width = 819;
  c = E.start();
  E.settle();
  assert.deepEqual([c.state().mode, E.writes[0]], ['clamped', BASE_VP]);
  E = makeEnv({ saved: '0.75', content: viewportContent(1024, 0.75) });
  E.html.clientWidth = 1365; E.vv.scale = 1.5; E.vv.width = 1024 / 1.5;
  c = E.start();
  E.settle();
  assert.deepEqual([c.state().mode, E.writes.length], ['zoomed', 0], 'the device-width form');
});

test('pinch: within ±5 % of the size it started at a release keeps it (a sloppy two-finger scroll) — the badge shows what release commits; beyond, 5 % steps', () => {
  const E = makeEnv(), c = E.start();
  c.set(1.25); E.webkit(); E.settle();
  const n = E.writes.length;
  c.pinchStart({ x: 300, y: 300, d: 100 }); c.pinchMove({ x: 300, y: 300, d: 104.9 }); E.frames();
  const badge = E.html.children.find(x => x.className === 'uiz-badge');
  assert.equal(badge.textContent, '125 %');
  c.pinchEnd();
  assert.deepEqual([c.get(), E.writes.length], [1.25, n]);
  c.pinchStart({ x: 300, y: 300, d: 100 }); c.pinchMove({ x: 300, y: 300, d: 95 }); c.pinchEnd();
  assert.deepEqual([c.get(), E.writes.length], [1.25, n], '−5 %');
  c.pinchStart({ x: 300, y: 300, d: 100 }); c.pinchMove({ x: 300, y: 300, d: 108 }); E.frames();
  assert.equal(badge.textContent, '135 %');
  c.pinchEnd();
  assert.deepEqual([c.get(), E.writes.at(-1)], [1.35, viewportContent(1024, 1.35)]);
});

test('no visualViewport (the node simulation): P from innerWidth, no verification; another window\'s change follows (storage event); ⌘= ⌘− ⌘0 only in the installed app', () => {
  let E = makeEnv({ noVV: true, innerWidth: 1400 }), c = E.start();
  E.byId.uiZoomIn.click();
  assert.deepEqual(E.writes, [zin(1400, 1273)]);
  E.settle();
  assert.deepEqual([E.writes.length, E.applies, c.state().mode], [1, 1, 'applied']);
  E.ls.setItem(LS_KEY, '1.5');
  E.win.fire('storage', { key: 'synth.other' });
  assert.equal(E.writes.length, 1);
  E.win.fire('storage', { key: LS_KEY });
  assert.equal(E.writes.at(-1), viewportContent(1400, 1.5));
  const key = (key, code, extra) => E.win.fire('keydown', Object.assign({ type: 'keydown', key, code, metaKey: true, ctrlKey: false, altKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }, extra || {}));
  assert.equal(key('=', 'Equal').defaultPrevented, false, 'a browser tab: the browser\'s zoom');
  assert.equal(E.writes.length, 2);
  E = makeEnv({ noVV: true, innerWidth: 1400, standalone: true });
  c = E.start();
  assert.equal(key('=', 'Equal').defaultPrevented, true);
  assert.equal(c.get(), 1.1);
  key('+', 'Equal', { shiftKey: true });
  assert.equal(c.get(), 1.25);
  key('-', 'Minus');
  assert.equal(c.get(), 1.1);
  assert.equal(key('0', 'Digit0').defaultPrevented, true);
  assert.equal(c.get(), 1);
  assert.equal(key('=', 'Equal', { ctrlKey: true }).defaultPrevented, false, 'Ctrl+⌘: not ours');
  assert.equal(key('z', 'KeyZ').defaultPrevented, false, '⌘Z: the page\'s undo');
  assert.equal(c.get(), 1);
});
