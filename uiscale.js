// uiscale.js — the interface size (lead ruling U1; design ipad-designs/ui-scale.critique.md §3): one zoom of the whole
// page on iOS / iPadOS that stays, made by rewriting <meta name="viewport"> (mechanism A). At scale s the page lays out in
// a layout viewport P / s CSS px wide (P: the window's width in points, visualViewport width × scale) that WebKit scales
// to fill the window — a real layout zoom: media queries, innerWidth / vw / vh, fixed and sticky layers, pointer maths,
// getBoundingClientRect and ResizeObserver stay in one CSS-px space; canvases only go a little soft above 100 %
// (devicePixelRatio does not follow the page scale, as under a native pinch).
//   s = 1   BASE_VP, index.html's own meta (fast taps and Split View behaviour as before)
//   s < 1   width=device-width,initial-scale=s,minimum-scale=s,… — still a "responsive" page for WebKit (no double-tap
//           gestures, no shrink-to-fit); minimum-scale is needed (device-width forms default to a minimum of 1)
//   s > 1   width=N,initial-scale=P/N,shrink-to-fit=no,… with N = round(P / s) — device-width cannot narrow the layout;
//           shrink-to-fit=no stops iPad desktop-class browsing from widening the layout back (undoing the zoom)
//   s ≠ 1   user-scalable=no (Safari ignores it, plain web views honour it); viewport-fit=cover always (WebKit reads it
//           once, at parse time)
// 50–200 %, capped at max(1, P / 360) (a phone: about 108 %); a pinch keeps the size it started at within ±5 % (a sloppy
// two-finger scroll is no size change), else snaps to 100 % within ±4 % and to 5 % steps; − / + step LADDER. Kept in localStorage 'synth-ui.scale' (not a synth.* key: appstore.js migrates and re-syncs those as app
// keys), removed at 100 %, for the whole app (not per project); a change in another window follows (storage event).
// Desktop browsers ignore the viewport meta and have their own zoom, remembered per site: there, and on Android, the
// module is inert (no listeners, the control stays hidden).
// Boot: index.html's inline script right after the viewport meta applies the stored size before the first paint (same
// gate, clamp and strings as here: tests/uiscale.test.mjs runs it against viewportContent) and sets html[data-uiz] on iOS
// at every size, 100 % included: style.css then gives body and everything in it touch-action: pan-x pan-y at zero
// specificity — no native page pinch (WebKit resets the used touch-action at every scroll container, so a rule on html
// alone does nothing), the app's own pinch (gesture.js → pinch* below) instead. A native zoom would also stop meta
// writes from applying (WebKit keeps a scale the user set until the page is back at its minimum scale). One may still
// come (iPhone Safari's focus zoom on a field under 16 px, a double-tap above 100 %, a trackpad): while the page is
// natively zoomed data-uiz is off and available() false — the native pinch back out works (gesture.js leaves it alone)
// — and the size applies again once the page is back at its minimum scale.
// env(safe-area-inset-*) is used undivided: whether WebKit scales it with the page is not known yet (device test); the
// boot and this module set --uiz on html for a calc(env(…) / var(--uiz)) should it stay constant.
//
// API — initUiScale({ notice, onApply, win, doc, nav, ls }) → controller (gesture.js routes two-finger pinches here;
// this module installs no touch, pointer or gesture listener of its own):
//   available()            true where the app's pinch replaces the native one: iOS / iPadOS, at every size — except
//                          while the page is natively zoomed (the native pinch then zooms it back out)
//   pinchStart({x, y, d})  centroid (client px) and finger distance (px) → true when a UI pinch began; false while the
//                          browser's full screen is on (a handled pinch may leave it, WebKit 227387: a notice points to
//                          − / +), a dialog or editor overlay is open, the size is unavailable at this window size,
//                          the page is natively zoomed, or the last size change is still settling (≤ 0.3 s). Called
//                          again during a pinch (a finger re-gripped) it re-bases and continues without committing.
//   pinchMove({x, y, d})   live preview: a composited transform on <body> that keeps the content under the centroid
//                          under it (pans included: don't also scroll during a UI pinch), and the % badge
//   pinchEnd()             one meta write, in the same task as clearing the transform; after the new layout onApply()
//                          (main.js relayout: keyboard height, keys, roll / arrangement) and a scroll that puts the
//                          content under the fingers back under them
//   pinchCancel()          the preview goes, nothing changes
//   get()                  the size in effect; set(s) step(dir) reset(): change it and keep it (header − / % / +;
//                          ⌘= ⌘− ⌘0 in the installed app only — elsewhere those are the browser's page zoom)
//   state() destroy()      { scale, want, P, mode, content, pinching, listeners } (tests); every listener off
// Verification after each write and on every resize (debounced, never mid-pinch; the meta content is compared as a
// string, so the module's own writes cannot loop): applied when clientWidth × vv.scale ≈ P with the whole layout visible
// (true under Safari's aA zoom too); a layout still wider than the window once a write of ours has settled, at that
// write's initial-scale, is WebKit clamping the width (narrow Split View): back to BASE_VP, the control disabled until P
// changes; wider and above that scale (one a reload or a tab restore brings back included), or with no write of ours, is
// a native zoom (double-tap, trackpad, focus): nothing is written until the page is back at its minimum scale, then the
// wanted size applies. A narrower window (rotation, Split View) keeps a width=N meta's N and initial-scale (WebKit
// layoutWidth): wider than its visible part too, but P changed (a native zoom never changes it) — written again for the
// new P. No visualViewport (the node simulation): no verification.
import { platform, isStandalone, fullscreenApi } from './pwa.js?v=8';

export const BASE_VP = 'width=device-width,initial-scale=1,viewport-fit=cover';
export const LS_KEY = 'synth-ui.scale';
export const MIN = 0.5, MAX = 2, MIN_W = 360;
export const LADDER = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const DEBOUNCE = 150, AFTER_MS = 300, SETTLE = 1000;
const OVERLAYS = '.modal:not([hidden]), .gx-overlay:not([hidden]), .sx-seqov:not([hidden]), .sx-ov:not([hidden]), .wk-pop:not([hidden]), .wk-ctx:not([hidden])';
const ZOOMED = 'The page is zoomed by the browser — pinch it back out (or double-tap it); the interface size then applies';
const FS_TXT = 'In the browser’s full screen a pinch may leave it — use − / + at the top for the interface size';
const CLAMPED = 'The interface size is not available at this window size — it comes back in a wider window';

/* ------------------------------------------------------------------ pure parts */
// the same gate as pwa.js platform().ios: an iP(hone|ad|od) agent, or a touch "Mac" that is no Android (iPadOS asking for
// desktop sites)
export const supported = nav => platform(nav).ios;
// 50–200 %, and at most P / 360 (never below 1 for that: a narrow window can still zoom out)
export function clampScale(s, P) {
  const hi = Math.max(1, P > 0 ? Math.min(MAX, P / MIN_W) : MAX);
  return s > 0 ? Math.min(Math.max(s, MIN), hi) : 1;
}
// a pinch's result: 100 % within ±4 %, else 5 % steps
export const snap = s => (!(s > 0) ? 1 : Math.abs(s - 1) <= 0.04 + 1e-9 ? 1 : Math.min(MAX, Math.max(MIN, Math.round(s * 20) / 20)));
// the − / + buttons: the next LADDER size up (dir > 0) or down
export function stepScale(s, dir) {
  if (dir > 0) { for (const x of LADDER) if (x > s + 0.001) return x; return MAX; }
  if (dir < 0) { for (let k = LADDER.length - 1; k >= 0; k--) if (LADDER[k] < s - 0.001) return LADDER[k]; return MIN; }
  return s;
}
// the size in effect for a wanted s at window width P (1: the base meta)
export function effScale(P, s) {
  P = Math.round(P);
  if (!(P >= 200) || !(s >= MIN && s <= MAX)) return 1;
  const c = clampScale(s, P);
  return Math.abs(c - 1) < 0.005 ? 1 : c;
}
// the viewport meta's content for s at window width P (index.html's boot builds the same strings)
export function viewportContent(P, s) {
  P = Math.round(P);
  const k = effScale(P, s);
  if (k === 1) return BASE_VP;
  if (k < 1) return 'width=device-width,initial-scale=' + k + ',minimum-scale=' + k + ',user-scalable=no,viewport-fit=cover';
  const N = Math.round(P / k);
  return 'width=' + N + ',initial-scale=' + P / N + ',shrink-to-fit=no,user-scalable=no,viewport-fit=cover';
}
// the page against the window (cw: documentElement.clientWidth, vs / vw: visualViewport scale / width): 'applied' (the
// layout fills the window, all of it visible: cw × vs ≈ P — Safari's aA zoom divides cw and multiplies vs), 'zoomed'
// (a layout wider than its visible part: a native zoom, or WebKit clamping the width of a write), else 'odd'
export function viewState(cw, vs, vw, P) {
  if (vw < cw - 2) return 'zoomed';
  return Math.abs(cw * vs - P) <= 2 ? 'applied' : 'odd';
}

const INERT = Object.freeze({
  available: () => false, pinchStart: () => false, pinchMove() {}, pinchEnd() {}, pinchCancel() {},
  get: () => 1, set() {}, step() {}, reset() {}, destroy() {},
  state: () => ({ scale: 1, want: 1, P: 0, mode: 'off', content: null, pinching: false, listeners: 0 }),
});
const lsOf = win => { try { return win.localStorage || null; } catch (err) { return null; } };

/* ------------------------------------------------------------------ the page */
export function initUiScale(opts) {
  const o = opts || {}, win = o.win || globalThis, doc = o.doc || win.document, nav = o.nav || win.navigator || {};
  const meta = doc && typeof doc.querySelector === 'function' ? doc.querySelector('meta[name="viewport"]') : null;
  if (!supported(nav) || !meta) return INERT;
  const root = doc.documentElement, $ = id => doc.getElementById(id);
  const box = $('uiZoom'), bOut = $('uiZoomOut'), bPct = $('uiZoomPct'), bIn = $('uiZoomIn');
  const ls = 'ls' in o ? o.ls : lsOf(win), FS = fullscreenApi(doc);
  const now = typeof o.now === 'function' ? o.now : () => Date.now();
  const say = (t, ms) => { if (typeof o.notice === 'function') o.notice(t, ms); };
  const raf = f => (typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame(f) : win.setTimeout(f, 16));
  const L = [];
  const on = (t, type, fn, opt) => { if (t && typeof t.addEventListener === 'function') { t.addEventListener(type, fn, opt); L.push([t, type, fn, opt]); } };
  // want: the size asked for (stored); shown: the size in effect; mode 'applied' | 'zoomed' (native zoom: no writes) |
  // 'clamped' (unavailable at window width latchP); written: a write still to verify { c, at }
  let want = read(), shown = 1, mode = 'applied', latchP = 0, written = null, pinch = null, deferred = false, dead = false;
  let tickT = 0, waitT = 0, waitFn = null, frameId = 0, badge = null, fsTold = false, zTold = false, seen = null, vP = 0;

  function read() { let v = NaN; try { v = ls ? +ls.getItem(LS_KEY) : NaN; } catch (err) { v = NaN; } return v >= MIN && v <= MAX ? v : 1; }
  function save(s) {
    try { if (!ls) return; if (Math.abs(s - 1) < 0.005) ls.removeItem(LS_KEY); else ls.setItem(LS_KEY, String(s)); } catch (err) { /* blocked storage: this session only */ }
  }
  function curP() { const vv = win.visualViewport, p = vv && vv.width > 0 ? vv.width * vv.scale : +win.innerWidth || 0; return Math.round(p); }
  const content = () => (meta.getAttribute('content') || BASE_VP);
  function measure() {
    const vv = win.visualViewport, cw = root ? +root.clientWidth : 0;
    if (!vv || !(vv.width > 0) || !(cw > 0)) return 'skip';
    return viewState(cw, +vv.scale || 1, +vv.width, curP());
  }
  // measure(), a layout left from another window width told apart ('resized'): a narrower window (rotation, Split View)
  // keeps a width=N meta's N and initial-scale (WebKit layoutWidth / initialScale) — wider than its visible part, but
  // no native zoom (that never changes P; vP: the width the layout was last made or verified for)
  function look() { const m = measure(); return m === 'zoomed' && mode === 'applied' && vP > 0 && curP() !== vP ? 'resized' : m; }
  function show(s) {
    shown = s;
    try { root.setAttribute('data-uiz', s === 1 ? '' : String(s)); root.style.setProperty('--uiz', String(s)); } catch (err) { /* no style */ }
  }
  function ui() {
    const hi = clampScale(MAX, curP()), off = mode === 'clamped', pct = Math.round(shown * 100) + ' %';
    if (box) { box.hidden = false; box.title = off ? 'Interface size — not available at this window size' : 'Interface size'; }
    if (bPct) { bPct.textContent = pct; bPct.disabled = off; bPct.setAttribute('aria-label', 'Interface size ' + pct + (shown === 1 ? '' : ' — tap for 100 %')); }
    if (bOut) bOut.disabled = off || shown <= MIN + 0.001;
    if (bIn) bIn.disabled = off || shown >= hi - 0.001;
  }

  // the meta for the wanted size at this window size, written only when its content changes → true if written
  function apply(anchor) {
    if (dead || pinch) return false;
    const P = curP();
    if (mode === 'clamped') { if (P === latchP) { show(1); return false; } mode = 'applied'; } // another window size: again
    if (!written && look() === 'zoomed') { zoomed(); return false; } // natively zoomed: WebKit would keep its scale
    if (mode === 'zoomed') mode = 'applied';
    const c = viewportContent(P, want);
    show(effScale(P, want));
    if (content() === c) return false;
    meta.setAttribute('content', c);
    written = { c, at: now() }; vP = P;
    settle(anchor);
    return true;
  }
  // after a write: the new layout (the visual viewport's resize, or AFTER_MS), a frame, then onApply and the anchor
  function settle(anchor) {
    stopWait();
    const vv = win.visualViewport;
    const go = () => {
      stopWait();
      raf(() => {
        if (dead) return;
        relayout();
        if (anchor) restore(anchor);
        later();
      });
    };
    waitFn = go;
    if (vv && typeof vv.addEventListener === 'function') vv.addEventListener('resize', go);
    waitT = win.setTimeout(go, AFTER_MS);
  }
  function stopWait() {
    const vv = win.visualViewport;
    if (waitFn && vv && typeof vv.removeEventListener === 'function') vv.removeEventListener('resize', waitFn);
    waitFn = null; win.clearTimeout(waitT); waitT = 0;
  }
  function relayout() {
    seen = { cw: root ? +root.clientWidth : 0, ih: +win.innerHeight || 0 };
    if (typeof o.onApply === 'function') { try { o.onApply(shown); } catch (err) { console.error(err); } }
  }
  function later(ms) { win.clearTimeout(tickT); tickT = win.setTimeout(tick, ms == null ? DEBOUNCE : ms); }
  // a resize (or a write of ours) has settled: verify it, then follow the window's size
  function tick() {
    tickT = 0;
    if (dead) return;
    if (pinch) { deferred = true; return; } // never mid-pinch: after it
    const m = look(), w = written;
    if (w && m !== 'applied' && m !== 'skip' && now() - w.at < SETTLE) { later(250); return; } // ours, still settling
    written = null;
    if (m === 'zoomed') {
      if (mode === 'clamped') return;
      if (w && w.c !== BASE_VP && !userZoomed(w.c)) { clamp(); return; } // our width did not take: WebKit keeps the layout wider
      zoomed();
      return;
    }
    if (w && seen && (seen.cw !== +root.clientWidth || seen.ih !== (+win.innerHeight || 0))) relayout(); // it settled later
    apply(); // a new window size, or the size asked for while the page was zoomed
    vP = curP();
    ui();
  }
  // WebKit gives a content of ours its initial-scale, and a width it clamps keeps it (a wider layout at that scale); a
  // native zoom is above it, one a reload or a tab restore brings back from the history item included
  function userZoomed(c) { const vv = win.visualViewport, m = /initial-scale=([\d.e-]+)/.exec(c); return !!(vv && m) && +vv.scale > +m[1] * 1.02; }
  // natively zoomed: no writes; data-uiz off and available() false meanwhile — the native pinch back out works (no
  // notice at 100 %: iPhone Safari's focus zoom on a small field is no news); apply() (back at the minimum scale) sets it
  function zoomed() {
    if (mode !== 'zoomed') { mode = 'zoomed'; zTold = false; try { root.removeAttribute('data-uiz'); } catch (err) { /* no attr */ } }
    if (!zTold && (shown !== 1 || want !== 1)) { zTold = true; say(ZOOMED, 8000); }
    ui();
  }
  function clamp() {
    mode = 'clamped'; latchP = curP();
    show(1);
    if (content() !== BASE_VP) { meta.setAttribute('content', BASE_VP); written = { c: BASE_VP, at: now() }; settle(null); }
    ui();
    say(CLAMPED, 6000);
  }

  /* anchors: the element under a point (and where in it), put back under that point after the new layout */
  function pinned(n) { // inside a fixed or sticky layer (the header, the keyboard panel): scrolling does not move it
    if (typeof win.getComputedStyle !== 'function') return false;
    for (let e = n; e && e !== doc.body && e !== root && e.nodeType === 1; e = e.parentNode) {
      let p = '';
      try { p = win.getComputedStyle(e).position; } catch (err) { p = ''; }
      if (p === 'fixed' || p === 'sticky') return true;
    }
    return false;
  }
  // (x, y): client px; docY: that point's document y in the layout before the change
  function pick(x, y, docY) {
    let el = null, fy = 0.5;
    try { el = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(x, y) : null; } catch (err) { el = null; }
    if (el && (el === doc.body || el === root || typeof el.getBoundingClientRect !== 'function')) el = null;
    if (el && pinned(el)) return null;
    if (el) { const r = el.getBoundingClientRect(); if (r && r.height > 0) fy = (y - r.top) / r.height; else el = null; }
    const se = doc.scrollingElement || root, H = se ? +se.scrollHeight || 0 : 0;
    return { el, fy, frac: H > 0 ? docY / H : -1, y, s0: shown };
  }
  function restore(a) {
    const ty = a.y * a.s0 / shown; // the same point of the screen in the new CSS px
    let y = NaN;
    if (a.el && a.el.isConnected !== false) { try { const r = a.el.getBoundingClientRect(); if (r && r.height > 0) y = r.top + a.fy * r.height; } catch (err) { y = NaN; } }
    if (!(y === y)) { // rebuilt meanwhile (the keys): the same fraction of the page
      const se = doc.scrollingElement || root, H = se ? +se.scrollHeight || 0 : 0;
      if (!(H > 0) || !(a.frac >= 0)) return;
      y = a.frac * H - (+win.scrollY || 0);
    }
    const dy = y - ty;
    if (Math.abs(dy) >= 1 && typeof win.scrollBy === 'function') win.scrollBy(0, dy);
  }
  // a header button: the middle of the window stays where it is (at the top of the page: nothing to keep)
  function viewAnchor() {
    if (!((+win.scrollY || 0) > 0)) return null;
    const x = (+win.innerWidth || 0) / 2, y = (+win.innerHeight || 0) / 2;
    return pick(x, y, (+win.scrollY || 0) + y);
  }

  /* the pinch (gesture.js) */
  function blocked() {
    if (mode === 'clamped') return 'clamped';
    if (waitFn) return 'settling'; // a size change still on its way (its anchor scroll would move the preview)
    if (mode === 'zoomed' || (!written && look() === 'zoomed')) return 'zoomed';
    if (FS.active()) return 'fullscreen';
    try { if (doc.querySelector(OVERLAYS)) return 'overlay'; } catch (err) { /* old engines */ }
    return null;
  }
  const rectOf = n => { try { return n.getBoundingClientRect(); } catch (err) { return { left: 0, top: 0 }; } };
  function pinchStart(p) {
    if (dead || !p || !(p.d > 0)) return false;
    if (pinch) { rebase(p); return true; }
    const why = blocked(), body = doc.body;
    if (why || !body) {
      if (why === 'fullscreen' && !fsTold) { fsTold = true; say(FS_TXT, 6000); }
      if (why === 'zoomed') zoomed();
      return false;
    }
    win.clearTimeout(tickT); tickT = 0; deferred = true; // the pending verification runs after the pinch
    const br = rectOf(body), sy = +win.scrollY || 0;
    // s0: the size the layout is at; sb, d0, (bx, by): the base of the current grip (content point under its centroid,
    // body px); s, r = s / s0, (tx, ty): the preview
    pinch = { P: curP(), s0: shown, sb: shown, d0: p.d, s: shown, r: 1, x: p.x, y: p.y, left: +br.left || 0, top: +br.top || 0, tx: 0, ty: 0, bx: 0, by: 0, a: null };
    pinch.bx = p.x - pinch.left; pinch.by = p.y - pinch.top;
    pinch.a = pick(p.x, p.y, p.y + sy);
    try { body.style.transformOrigin = '0 0'; body.style.willChange = 'transform'; } catch (err) { /* no style */ }
    badgeOn(shown);
    return true;
  }
  function rebase(p) { // a finger re-gripped: continue from the preview as it is
    const P = pinch, sy = +win.scrollY || 0;
    P.bx = (p.x - P.left - P.tx) / P.r; P.by = (p.y - P.top - P.ty) / P.r;
    P.sb = P.s; P.d0 = p.d; P.x = p.x; P.y = p.y;
    P.a = pick(p.x, p.y, P.by + P.top + sy);
  }
  function pinchMove(p) {
    if (!pinch || !p || !(p.d > 0)) return;
    const P = pinch;
    P.s = clampScale(P.sb * p.d / P.d0, P.P); P.x = p.x; P.y = p.y;
    P.r = P.s / P.s0; P.tx = P.x - P.left - P.r * P.bx; P.ty = P.y - P.top - P.r * P.by;
    if (!frameId) frameId = raf(draw);
  }
  // what a release commits: the size the pinch started at within ±5 % (a sloppy two-finger scroll), else snapped
  const endScale = P => (Math.abs(P.s / P.s0 - 1) <= 0.05 + 1e-9 ? P.s0 : clampScale(snap(P.s), P.P));
  function draw() {
    frameId = 0;
    const P = pinch;
    if (!P || !doc.body) return;
    try { doc.body.style.transform = 'translate(' + P.tx + 'px, ' + P.ty + 'px) scale(' + P.r + ')'; } catch (err) { /* no style */ }
    badgeOn(endScale(P));
  }
  function unpreview() {
    frameId = 0; // (a queued draw finds no pinch)
    const b = doc.body;
    if (b) { try { b.style.transform = ''; b.style.transformOrigin = ''; b.style.willChange = ''; } catch (err) { /* no style */ } }
    if (badge) badge.hidden = true;
  }
  function after() { if (deferred) { deferred = false; later(); } }
  function pinchEnd() {
    if (!pinch) return;
    const P = pinch, s1 = endScale(P);
    pinch = null;
    unpreview(); // and in the same task the meta: one new layout, no frame of the old one at the new scale
    if (Math.abs(s1 - P.s0) >= 0.005) {
      want = s1; save(want);
      if (P.a) { P.a.y = P.y; P.a.s0 = P.s0; }
      apply(P.a);
      ui();
    }
    after();
  }
  function pinchCancel() {
    if (!pinch) return;
    pinch = null;
    unpreview();
    after();
  }
  function badgeOn(s) {
    if (!badge) {
      badge = doc.createElement('div');
      badge.className = 'uiz-badge';
      badge.setAttribute('aria-hidden', 'true');
      (root || doc.body).appendChild(badge); // outside <body>: its preview transform leaves the badge alone
    }
    badge.textContent = Math.round(s * 100) + ' %';
    badge.hidden = false;
  }

  /* the controls */
  function set(s, opt) {
    if (dead) return;
    const v = +s;
    want = v > 0 ? Math.min(MAX, Math.max(MIN, v)) : 1;
    if (!opt || opt.save !== false) save(want);
    if (mode === 'zoomed') { zTold = true; say(ZOOMED, 8000); ui(); return; }
    apply(opt && opt.anchor);
    ui();
  }
  const step = dir => set(stepScale(shown, dir), { anchor: viewAnchor() });
  const reset = () => set(1, { anchor: viewAnchor() });
  if (bOut) bOut.onclick = () => step(-1);
  if (bIn) bIn.onclick = () => step(1);
  if (bPct) bPct.onclick = reset;
  // ⌘= / ⌘+ bigger, ⌘− smaller, ⌘0 100 %: the installed app only (a browser's own page zoom otherwise); before the
  // page's keys (main.js skips a prevented keydown)
  on(win, 'keydown', e => {
    if (!e || !e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || !isStandalone(win, nav, FS.active())) return;
    const k = e.key, c = e.code;
    const dir = k === '=' || k === '+' || c === 'Equal' || c === 'NumpadAdd' ? 1 : k === '-' || k === '_' || k === '−' || c === 'Minus' || c === 'NumpadSubtract' ? -1 : k === '0' || c === 'Digit0' || c === 'Numpad0' ? 0 : null;
    if (dir === null) return;
    e.preventDefault();
    if (dir) step(dir); else reset();
  }, true);
  on(win, 'storage', e => { // another window of this app
    if (!e || (e.key !== LS_KEY && e.key !== null)) return;
    want = read();
    if (mode !== 'zoomed') apply();
    ui();
  });
  const resized = () => later();
  on(win.visualViewport, 'resize', resized);
  on(win, 'resize', resized);
  on(win, 'orientationchange', resized);

  // the boot's write (a size stored): verified like one of ours, at once (a clamped width falls back)
  if (content() !== BASE_VP) written = { c: content(), at: -Infinity };
  show(effScale(curP(), want));
  apply(); // (the boot may have read another width; nothing is written when the content is the same)
  vP = curP(); // the boot's layout is for this width (else apply wrote one): a rotation before the first tick is one
  ui();
  later();

  return {
    available: () => !dead && mode !== 'zoomed',
    pinchStart, pinchMove, pinchEnd, pinchCancel,
    get: () => shown,
    set: (s, opt) => set(s, opt),
    step, reset,
    state: () => ({ scale: shown, want, P: curP(), mode, content: content(), pinching: !!pinch, listeners: L.length }),
    destroy() {
      if (dead) return;
      if (pinch) { pinch = null; unpreview(); }
      dead = true;
      for (const [t, type, fn, opt] of L.splice(0)) { try { t.removeEventListener(type, fn, opt); } catch (err) { /* gone */ } }
      stopWait(); win.clearTimeout(tickT); tickT = 0;
      if (bOut) bOut.onclick = null;
      if (bIn) bIn.onclick = null;
      if (bPct) bPct.onclick = null;
    },
  };
}
