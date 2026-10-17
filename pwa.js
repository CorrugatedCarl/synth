// pwa.js — SYNTH as an installed app (owner I): the header's Full screen and Install app buttons, the "Add to Home
// Screen" sheet of iOS / iPadOS (Safari, Chrome and the other WebKit browsers there) and of Safari on a Mac, the service
// worker (sw.js) with its update toast, and persistent storage once installed. main.js calls initApp once at boot.
//
// Buttons (appButtons): Full screen — the Fullscreen API on the page (requestFullscreen / webkitRequestFullscreen),
// shown where the browser offers it (not on an iPhone: Safari there has no element full screen); Install app — Chrome /
// Edge / Android / desktop through the browser's own prompt (beforeinstallprompt), iOS / iPadOS and Safari 17+ on a Mac
// through the sheet with the steps for the browser in use. Both are hidden in the installed app (display-mode
// standalone / fullscreen, navigator.standalone) and Install app after an install (appinstalled).
// Updates (sw.js): a new worker installs and waits. When this page already is that version and the only window, the
// worker takes over at once (`adopt`) and nothing changes for the page; otherwise a toast offers "Update available —
// Reload". Nothing reloads by itself: Reload saves the project (opts.beforeReload, given at most 5 s), then the worker is
// activated (`skip`) and the page reloads when it has taken over. Another window's update shows the toast here too. A
// toast put off with × comes back when the page returns to the front after an hour (an iPad app stays suspended for days).
// iPad: the browser's full screen (WebKit's) keeps its own controls, may stop fast tapping with a "typing in full
// screen" warning, and a pinch may leave it (WebKit 227387: zooming the Piano Roll) — the first full screen there says that
// the installed app is the full-screen one.
// The pure parts (platform, appButtons, installSteps, fullscreenApi, isStandalone, swAllowed) are exported for the tests.

/* ------------------------------------------------------------------ pure parts */
// { ios, ipad, mac, browser: 'safari' | 'chrome' | 'firefox' | 'edge' | 'other', safariVersion, desktopUA, inApp }
// desktopUA: an iPad asking for desktop sites (the default of Safari, and of Chrome and the others there): its user agent
// is a Mac's, and it may not name the browser in use (Chrome's can read as Safari's)
export function platform(nav) {
  const n = nav || {}, ua = String(n.userAgent || ''), touchMac = n.platform === 'MacIntel' && (n.maxTouchPoints || 0) > 1 && !/Android/.test(ua);
  const ios = /iP(hone|ad|od)/.test(ua) || touchMac, ipad = /iPad/.test(ua) || touchMac;
  const mac = !ios && !/Android/.test(ua) && (/Macintosh/.test(ua) || /^Mac/.test(String(n.platform || '')));
  const inApp = /(FBAN|FBAV|Instagram|Line\/|GSA\/|Twitter|LinkedInApp)/.test(ua);
  let browser = 'other';
  if (/CriOS\//.test(ua)) browser = 'chrome';
  else if (/FxiOS\//.test(ua)) browser = 'firefox';
  else if (/EdgiOS\/|Edg\//.test(ua)) browser = 'edge';
  else if (ios) browser = /Safari\//.test(ua) && !inApp ? 'safari' : 'other';
  else if (/Chrome\//.test(ua)) browser = 'chrome';
  else if (/Firefox\//.test(ua)) browser = 'firefox';
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'safari';
  const v = /Version\/(\d+)/.exec(ua);
  return { ios, ipad, mac, browser, safariVersion: browser === 'safari' && v ? +v[1] : 0, desktopUA: touchMac && !/iP(hone|ad|od)/.test(ua), inApp };
}
// the sheet's steps exist for iOS / iPadOS (any browser: all of them can add to the home screen, iOS 16.4+) and for
// Safari 17+ on a Mac (File › Add to Dock)
export const sheetFor = p => !!p && (p.ios || (p.mac && p.browser === 'safari' && p.safariVersion >= 17));
// env { standalone, fs (the Fullscreen API works here), prompt (a deferred beforeinstallprompt), sheet (sheetFor),
// installed (appinstalled seen) } → which header buttons show
export function appButtons(env) {
  const e = env || {}, app = !!e.standalone;
  return { fs: !app && !!e.fs, install: !app && !e.installed && (!!e.prompt || !!e.sheet) };
}
// The steps of the install sheet for a platform: { title, steps: [[segment…]], note }; a segment is a text or
// { icon: 'share' | 'add' | 'more' | 'dock' } or { b: text } (a menu item's name, bold).
export function installSteps(p) {
  const P = p || {}, here = P.ipad ? 'iPad' : 'iPhone';
  const note = P.ios
    ? 'SYNTH then opens full screen from its icon and works offline after its first launch. The ' + here + ' keeps the app’s projects separate from the browser’s: to take one across, Save it here and use Open / Import… in the app.'
    : 'SYNTH then opens in its own window from the Dock and works offline after its first launch. Its projects are kept separately from Safari’s: Save a project here and Open it there to take it across.';
  if (!P.ios) {
    return { title: 'Install SYNTH', note, steps: [
      ['In Safari’s menu bar choose ', { b: 'File' }, ' › ', { icon: 'dock' }, { b: 'Add to Dock…' }],
      ['Click ', { b: 'Add' }, '.'],
    ] };
  }
  const add = ['Choose ', { icon: 'add' }, { b: 'Add to Home Screen' }, ' (scroll down the list if you don’t see it).'];
  const last = ['Leave ', { b: 'Open as Web App' }, ' on if it is offered, and tap ', { b: 'Add' }, '.'];
  if (P.desktopUA && (P.browser === 'safari' || (P.browser === 'other' && !P.inApp))) { // (Safari or Chrome: the same agent)
    return { title: 'Install SYNTH on your ' + here, note, steps: [
      ['Tap ', { icon: 'share' }, { b: 'Share' }, ': in Safari in the toolbar at the top (or under ', { icon: 'more' }, '), in Chrome at the right of the address bar.'],
      add, last,
    ] };
  }
  if (P.browser === 'safari') {
    return { title: 'Install SYNTH on your ' + here, note, steps: [
      ['Tap ', { icon: 'share' }, { b: 'Share' }, P.ipad ? ' in Safari’s toolbar at the top' : ' in Safari’s toolbar', ' (in the newest Safari it is under ', { icon: 'more' }, ').'],
      add, last,
    ] };
  }
  if (P.browser === 'chrome') {
    return { title: 'Install SYNTH on your ' + here, note, steps: [
      ['Tap ', { icon: 'share' }, { b: 'Share' }, ' at the right of Chrome’s address bar (or ', { icon: 'more' }, ' › ', { b: 'Share…' }, ').'],
      add, last,
    ] };
  }
  if (P.browser === 'firefox' || P.browser === 'edge') {
    return { title: 'Install SYNTH on your ' + here, note, steps: [
      ['Open the browser’s menu ', { icon: 'more' }, ' and tap ', { icon: 'share' }, { b: 'Share' }, '.'],
      add, last,
    ] };
  }
  return { title: 'Install SYNTH on your ' + here, note, steps: [
    ['Open this page in Safari (this app’s browser cannot add it to the Home Screen).'],
    ['Tap ', { icon: 'share' }, { b: 'Share' }, ', then ', { icon: 'add' }, { b: 'Add to Home Screen' }, '.'],
  ] };
}
const isEl = x => !!x && typeof x === 'object';
const SAVE_WAIT = 5000; // ms: the longest the update waits for the project to be saved
// The Fullscreen API on the page's root element (standard, else WebKit-prefixed): { enabled, active(), enter(), exit() }
// (enter / exit return promises; Safari's prefixed calls return nothing)
export function fullscreenApi(doc) {
  const el = doc && doc.documentElement;
  const std = !!el && typeof el.requestFullscreen === 'function', wk = !!el && typeof el.webkitRequestFullscreen === 'function';
  const enabled = (std && doc.fullscreenEnabled === true) || (wk && doc.webkitFullscreenEnabled === true);
  return {
    enabled,
    active: () => !!doc && (isEl(doc.fullscreenElement) || isEl(doc.webkitFullscreenElement)),
    enter() {
      try { return Promise.resolve(std && doc.fullscreenEnabled === true ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen()); }
      catch (err) { return Promise.reject(err); }
    },
    exit() {
      try {
        if (isEl(doc.fullscreenElement) && typeof doc.exitFullscreen === 'function') return Promise.resolve(doc.exitFullscreen());
        if (typeof doc.webkitExitFullscreen === 'function') return Promise.resolve(doc.webkitExitFullscreen());
        return Promise.resolve();
      } catch (err) { return Promise.reject(err); }
    },
  };
}
const mm = (win, q) => { try { return !!(win && typeof win.matchMedia === 'function' && win.matchMedia(q).matches); } catch (err) { return false; } };
// running as the installed app: iOS's navigator.standalone or the display-mode the manifest asks for. The fullscreen
// display mode is the installed app on Android only (its display_override): desktop browsers report it for a window in
// full screen (F11, the browser's own command) and, like Chrome on Android, for the page in full screen (fsActive).
export function isStandalone(win, nav, fsActive) {
  const android = /Android/.test(String((nav && nav.userAgent) || ''));
  return !!(nav && nav.standalone === true) || mm(win, '(display-mode: standalone)') || (android && !fsActive && mm(win, '(display-mode: fullscreen)'));
}
// service workers only on https: (the site) and on the local development hosts
export const swAllowed = loc => !!loc && (loc.protocol === 'https:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(String(loc.hostname || '')));

/* ------------------------------------------------------------------ the page */
const SVG = 'http://www.w3.org/2000/svg';
const ICON = { // 20 × 20, stroked
  share: 'M10 2.5v9.5M6.5 6 10 2.5 13.5 6M6 8.5H4.5v9h11v-9H14',
  add: 'M3.5 3.5h13v13h-13zM10 7v6M7 10h6',
  more: 'M5 10h.01M10 10h.01M15 10h.01',
  dock: 'M2.5 15.5h15M5 12.5h3v3H5zM8.5 12.5h3v3h-3zM12 12.5h3v3h-3z',
};
// opts { version (the page's ?v=), notice(text, ms), beforeReload() → promise (save the project), win, doc, nav, loc }
export function initApp(opts) {
  const o = opts || {}, win = o.win || globalThis, doc = o.doc || win.document, nav = o.nav || win.navigator || {}, loc = o.loc || win.location;
  const $ = id => doc.getElementById(id);
  const fsBtn = $('fullscreen'), insBtn = $('install'), sheet = $('installSheet'), toast = $('update');
  const P = platform(nav), FS = fullscreenApi(doc), sheetOK = sheetFor(P);
  const say = (t, ms) => { if (typeof o.notice === 'function') o.notice(t, ms); };
  let deferred = null, installed = false, persistAsked = false;
  const standalone = () => isStandalone(win, nav, FS.active());

  function sync() {
    const b = appButtons({ standalone: standalone(), fs: FS.enabled, prompt: !!deferred, sheet: sheetOK, installed });
    if (fsBtn) {
      fsBtn.hidden = !b.fs;
      const on = FS.active(), t = on ? 'Exit full screen' : 'Full screen';
      fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      fsBtn.setAttribute('aria-label', t);
      fsBtn.title = t;
    }
    if (insBtn) insBtn.hidden = !b.install;
    if (!b.install && sheetOpen()) closeSheet();
    if (standalone()) persistOnce();
  }
  // Storage of the installed app: asked once to be persistent (not evicted under storage pressure)
  function persistOnce() {
    const st = nav.storage;
    if (persistAsked || !st || typeof st.persist !== 'function') return;
    persistAsked = true;
    Promise.resolve(typeof st.persisted === 'function' ? st.persisted() : false)
      .then(p => (p ? true : st.persist())).catch(() => {});
  }

  /* full screen */
  let fsTold = false;
  if (fsBtn) fsBtn.onclick = () => {
    const was = FS.active();
    (was ? FS.exit() : FS.enter()).then(() => {
      sync();
      // iPad: WebKit's full screen keeps a control of its own, may stop quick tapping (a played keyboard) with its
      // "typing in full screen" warning, and a pinch (zooming the Piano Roll) may leave it (WebKit 227387) — said once,
      // with the way to a full screen without any of that
      if (!was && P.ios && !fsTold) { fsTold = true; say('The browser’s full screen may stop fast playing with a warning — Install app gives SYNTH a full screen of its own. A pinch (zooming the Piano Roll) may also leave the browser’s full screen.', 10000); }
    }, () => { sync(); if (!was) say('Full screen is not available here', 5000); });
  };
  for (const t of ['fullscreenchange', 'webkitfullscreenchange']) doc.addEventListener(t, sync);

  /* install */
  win.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; sync(); });
  win.addEventListener('appinstalled', () => { installed = true; deferred = null; sync(); persistOnce(); });
  for (const q of ['(display-mode: standalone)', '(display-mode: fullscreen)']) {
    try { const m = win.matchMedia && win.matchMedia(q); if (m && typeof m.addEventListener === 'function') m.addEventListener('change', sync); } catch (err) { /* old engines */ }
  }
  if (insBtn) insBtn.onclick = () => {
    if (!deferred) { openSheet(); return; }
    const e = deferred;
    deferred = null; // a prompt is used once (the browser may offer another later)
    sync();
    Promise.resolve(e.prompt()).then(() => e.userChoice).then(c => { if (c && c.outcome === 'accepted') { installed = true; sync(); } }, () => {});
  };
  function sheetOpen() { return !!sheet && !sheet.hidden; }
  let lastFocus = null;
  function openSheet() {
    if (!sheet) return;
    const S = installSteps(P), list = $('insSteps');
    $('insTitle').textContent = S.title;
    $('insNote').textContent = S.note;
    list.replaceChildren(...S.steps.map(step => {
      const li = doc.createElement('li');
      for (const seg of step) {
        if (typeof seg === 'string') li.append(doc.createTextNode(seg));
        else if (seg.b) { const b = doc.createElement('b'); b.textContent = seg.b; li.append(b); }
        else if (seg.icon) {
          const s = doc.createElementNS(SVG, 'svg'), p = doc.createElementNS(SVG, 'path');
          s.setAttribute('viewBox', '0 0 20 20'); s.setAttribute('class', 'insico'); s.setAttribute('aria-hidden', 'true');
          p.setAttribute('d', ICON[seg.icon]);
          s.append(p); li.append(s);
        }
      }
      return li;
    }));
    lastFocus = doc.activeElement;
    sheet.hidden = false;
    const c = $('insClose'); if (c && c.focus) c.focus();
  }
  function closeSheet() {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (err) { /* gone */ }
    lastFocus = null;
  }
  if (sheet) {
    const c = $('insClose'); if (c) c.onclick = closeSheet;
    // the backdrop closes it: a mouse / pen at the press, a finger on its tap's release (≤ 10 px) — a scroll or a
    // two-finger gesture starting there (gesture.js cancels the first finger) leaves it open
    let bp = null;
    sheet.addEventListener('pointerdown', e => {
      bp = null;
      if (e.target !== sheet) return;
      if (e.pointerType === 'touch') bp = { id: e.pointerId, x: e.clientX, y: e.clientY }; else closeSheet();
    });
    sheet.addEventListener('pointerup', e => {
      const P = bp; bp = null;
      if (P && P.id === e.pointerId && e.target === sheet && Math.hypot(e.clientX - P.x, e.clientY - P.y) <= 10) closeSheet();
    });
    sheet.addEventListener('pointercancel', e => { if (bp && bp.id === e.pointerId) bp = null; });
  }

  /* service worker + update toast */
  let reg = null, controlled = false, reloading = false, adopting = false, offered = null, checked = Date.now();
  let shown = '', later = ''; // the toast's message; the one put off with × (shown again later)
  function showToast(text) {
    if (!toast || reloading) return;
    $('updateMsg').textContent = shown = text;
    later = '';
    const go = $('updateGo'); if (go) go.disabled = false;
    toast.hidden = false;
  }
  const hideToast = () => { if (toast) toast.hidden = true; };
  // a message to a worker and its reply (through a MessageChannel), or null after `ms`
  function ask(w, msg, ms) {
    return new Promise(res => {
      let done = false, ch = null;
      const fin = v => {
        if (done) return;
        done = true;
        if (ch) try { ch.port1.close(); } catch (err) { /* closed */ }
        res(v);
      };
      setTimeout(() => fin(null), ms);
      try {
        ch = new MessageChannel();
        ch.port1.onmessage = e => fin(e.data);
        w.postMessage(msg, [ch.port2]);
      } catch (err) { fin(null); }
    });
  }
  function offer(w) {
    if (!w || offered === w) return;
    offered = w;
    adopting = true;
    ask(w, { t: 'adopt', v: String(o.version) }, 3000).then(r => {
      if (r && r.ok) return; // this page is already the new version and alone: the worker took over (no reload needed)
      adopting = false;
      showToast('Update available');
    });
  }
  async function accept() {
    if (reloading) return;
    const go = $('updateGo');
    if (go) go.disabled = true;
    $('updateMsg').textContent = 'Saving…';
    // (a database write that never finishes must not hold the update: the page saves again as it unloads)
    try {
      if (typeof o.beforeReload === 'function') {
        let t = 0;
        const slow = new Promise(r => { t = setTimeout(() => { console.warn('SYNTH: saving before the update is taking long — reloading'); r(); }, SAVE_WAIT); });
        try { await Promise.race([o.beforeReload(), slow]); } finally { clearTimeout(t); }
      }
    } catch (err) { console.warn('SYNTH: saving before the update', err); }
    reloading = true;
    const w = reg && reg.waiting;
    if (!w) { loc.reload(); return; }
    w.postMessage({ t: 'skip' }); // → activate → clients.claim → controllerchange → reload
    setTimeout(() => loc.reload(), 4000); // (should the worker never take over)
  }
  if (toast) {
    const go = $('updateGo'), x = $('updateX');
    if (go) go.onclick = () => { accept(); };
    // later: the waiting worker takes over when every SYNTH window has closed, and the toast comes back when this page
    // returns to the front after an hour
    if (x) x.onclick = () => { if (!reloading) later = shown; hideToast(); };
  }
  const swc = nav.serviceWorker;
  if (swc && typeof swc.register === 'function' && swAllowed(loc)) {
    controlled = !!swc.controller;
    swc.addEventListener('controllerchange', () => {
      if (reloading) { loc.reload(); return; }
      const was = controlled;
      controlled = true;
      if (!was) return;                           // the first worker took control: nothing changed for this page
      if (adopting) { adopting = false; return; } // this page adopted the new worker
      showToast('SYNTH was updated in another window'); // this page still runs the version it loaded
    });
    // a new worker is offered once installed (it then waits); one may already be installing when register() resolves —
    // opening the page after a deploy starts the update check while the page still loads, before the `load` below
    const track = w => { if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && swc.controller) offer(w); }); };
    const go = () => swc.register('sw.js', { scope: './', updateViaCache: 'none' }).then(r => {
      reg = r;
      if (r.waiting && swc.controller) offer(r.waiting);
      track(r.installing);
      r.addEventListener('updatefound', () => track(r.installing));
    }, err => console.warn('SYNTH: offline support is not available (' + (err && err.message) + ')'));
    // registered once the page has loaded (its own requests first); a long session checks for updates when it comes back
    // to the front after an hour, and shows again an update put off with × (still waiting, or taken by another window)
    if (doc.readyState === 'complete') go(); else win.addEventListener('load', go, { once: true });
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden || !reg || Date.now() - checked < 3600e3) return;
      checked = Date.now();
      Promise.resolve(reg.update()).catch(() => {});
      if (reloading || !toast || !toast.hidden) return;
      const w = reg.waiting;
      if (w && swc.controller && w !== offered) offer(w);
      else if (later) showToast(later);
    });
  }

  sync();
  return { sync, sheetOpen, openSheet, closeSheet, platform: P, state: () => ({ deferred: !!deferred, installed, reg, reloading }), accept };
}
