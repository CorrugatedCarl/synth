// gesture.js — the two-finger layer (lead ruling G1; ipad-designs/two-finger.critique.md §4): on a touch screen a
// two-finger pan or pinch is recognised before anything else, so it never presses, turns or drags what it lands on.
// The page's own pinch-zoom and scrolling stay the browser's (ruling Z1). Plain ES module, no imports, nothing touches
// document / window at module top level (node imports it; wk.js shares jumpy below).
//
// installGestures(win, opts) puts its listeners on `win` — the WINDOW, never the document (VoiceOver's activation
// looks for touch listeners on nodes) — in the capture phase: the first statement of main.js boot(), so they run
// before every other. Only pointerdown and the click family below may preventDefault; pointermove, pointerup / -cancel,
// pointerover / -enter and the touch events are PASSIVE (there is no touchmove one): while the window has a non-passive
// move / lift listener WebKit makes every touch sequence on the page wait for the main thread at its first move / lift
// (touchMoveTracking / touchEndTracking synchronous), so the browser's scroll, pinch and taps would start late on a
// busy page — they did not at 75926b6 (ruling Z1). Model:
//   · the first touch is never delayed: its pointerdown passes through (keys, knobs, buttons react at once);
//   · a further touch p PAIRS with an earlier one q (not 'music', not spent, not freed) when q landed ≤ PAIR_MS ago
//     and p is ≤ PAIR_DIST from it (the time rule), or q is still (≤ STILL_PX), landed ≤ LATE_MS ago, p is ≤ LATE_PX
//     from it and q is not at the screen's edge (≤ EDGE_PX: a resting thumb) — the late rule. The distances (PAN_PX
//     too) are physical: CSS px at scale 1, divided by the browser's own pinch-zoom (visualViewport.scale); the edge is
//     the visual viewport's (a zoomed page panned sideways). A touch on
//     [data-gesture="music"] (the keys) pairs by the time rule only, never with a q on [data-gesture="perf"] (octave,
//     hold, the grip … then a key: both work); a perf touch (the tray, a hardware wheel / lever / ribbon / pad) never
//     pairs with another perf touch and with anything else by the time rule only (1i G1: two wheels with thumb and
//     finger; a controller held while the other hand turns a knob). A touch whose press opened a menu (contextmenu: a
//     long-press) or a widget's hold chooser (a bubbling 'wk-hold' event at the widget) is FREED: it never pairs, so the
//     other hand can pick from what it opened. Otherwise both are independent touches (two hands: hold a note or a
//     knob, play or tweak);
//   · both inside one [data-gesture="own"] element (piano roll, arrangement, zoomPan canvases) → session 'own':
//     every event reaches the owner's pinch / pan; only the click suppression below applies;
//   · else session 'nav': q's owner is asked to ROLL BACK — claim() callbacks, a range input under q gets its value
//     back (input + change), then a synthetic pointercancel flagged e.gesture === 'two-finger' at the touched element
//     (it bubbles through the capturing widget; a plain pointercancel still means "end, keep"). Every later pointer
//     event of the session's touches is swallowed at the window (stopImmediatePropagation only; pointerover / -enter
//     too; out / leave pass: hover tips hide). Where the browser scrolls under the session by itself it is NATIVE — no
//     script pan (it would scroll twice): WebKit lets a scroll view's pan begin unless one of its touches' used
//     touch-action allows no panning (WKTouchActionGestureRecognizer), so when every active touch allows it (auto,
//     manipulation, pan-x / pan-y: the page's scroll view has every touch) or a session finger is in an overflow
//     scroller that can scroll and whose touches all allow it; pinch-zoom stays the browser's wherever its touches
//     allow it. Else (a touch on touch-action none: a knob, a held key — the browser then pans and zooms nothing) the
//     script pans: once a frame (WebKit sends one pointermove per finger of a touch event; a lift flushes it first,
//     with its own position) the midpoint's travel, past PAN_PX, scrolls the nearest scroller under it that can still
//     go that way, then the page (moves spoilt by WebKit 181954 dropped: jumpy). A range input under a session finger,
//     whose thumb may follow it (its touchmove's default handling is the browser's), gets its value back at the lift
//     and again when the last touch ends;
//   · a nav session down to one finger waits REGRIP_MS for another (a re-grip pans on from the new grip), then that
//     finger is 'spent': swallowed until it lifts, never paired, the session over; an own one too (another finger
//     on its element within REGRIP_MS stays in it), then it simply ends — the finger left goes on as an ordinary
//     touch (no session holding the clicks of the whole page, nor the pairing of another hand, until it lifts);
//   · click / dblclick / auxclick / mousedown / mouseup with detail ≥ 1 (keyboard, Switch Control and VoiceOver
//     clicks pass) and contextmenu are swallowed (and preventDefault-ed: no default action, no focus move) from pairing
//     until every session finger is up + GRACE_MS: WebKit's two-finger tap clicks the midpoint, metaKey set, when it
//     recognises the tap, and the taps a pinch ends with click — inside the grace. touchend is never prevented (WebKit's
//     two-finger double-tap, which resets the page's zoom, stays the browser's); a pointerdown of any type outside a
//     session ends the grace at once;
//   · stale state cannot lock the page: a primary touch (no other touch down) ends a session first, and so do
//     WATCHDOG_MS without an event from its touches, a hidden page, pagehide and the window's blur;
//   · WebKit GestureEvents: not passed on during a nav session (the roll / arrangement would take them for a
//     trackpad pinch), never preventDefault-ed (passive: the page's pinch stays the browser's, a Mac trackpad's too).
// Pen and mouse pointers are never paired or swallowed.
// The canvas camera (SPEC-canvas §4.2; cv-world.js) takes a script session's pan and pinch through two hooks, routed by
// place: pan(sx, sy, at) — the midpoint's travel in scroll convention (sx = −Δx, CSS px), at = { cx, cy } the session's
// grip (client px) — returns false to leave it to the scroller chain and the page as above (trays, roll), anything else
// takes it; zoom(f, cx, cy, at) — the spread's ratio since the last applied frame, about the midpoint (cx, cy) now: it
// engages once the spread changed PINCH_PX on the glass since the grip and starts at f = 1 (no jump); per frame the pan
// first, then the zoom, so the content under the midpoint stays under it. A camera pan the first finger started is never
// rolled back (the canvas registers no claim(): it keeps its camera at the flagged pointercancel and the session goes on
// from there). Inside a canvas module ([data-cv-mod]) an 'own' zone counts only while the module is in edit state
// ([data-cv-edit]): otherwise the walk goes on up, so a pinch on a module's graph moves the camera. A 'music' zone (the
// module's keys) always counts: its chords play, as today (a camera pinch starts off the keys, as on the tray keyboard).
// API: installGestures(win, { pan(sx, sy, at)?, zoom(f, cx, cy, at)?, now, event, setTimeout, clearTimeout (tests) }) →
// { claim(pointerId, { cancel }) → unclaim, busy(), state(), destroy() }.
export const PAIR_MS = 250, PAIR_DIST = 600, STILL_PX = 10, LATE_MS = 1200, LATE_PX = 360, EDGE_PX = 24;
export const GRACE_MS = 400, REGRIP_MS = 400, WATCHDOG_MS = 3000, PAN_PX = 8, PINCH_PX = 6;
// WebKit bug 181954 (iOS): right after the page scrolled by script, a touch / pen move (or two) may report clientX /
// clientY off by hundreds of px. jumpy(last, x, y, t, at): a move to (x, y) at t, more than JUMP_PX from the last
// good point { x, y }, within JUMP_MS of a script scroll of the page at `at` (null: none) — the caller drops it, never
// two in a row (a real fast move is held back one event at most). Shared with wk.js dragSource's edge auto-scroll.
export const JUMP_PX = 48, JUMP_MS = 250;
export const jumpy = (last, x, y, t, at) => at != null && t - at < JUMP_MS && Math.hypot(x - last.x, y - last.y) > JUMP_PX;

const BLOCK = ['click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'contextmenu'];
const OVER = /^(auto|scroll|overlay)$/;
// an own zone inside a canvas module that is not in edit state sleeps (the camera's); music never does (keys never pair:
// a two-finger press on Serum's keyboard or the ARP / CLIP slot keys is a chord far more often than a pinch)
const asleep = n => {
  for (let m = n; m && typeof m.getAttribute === 'function'; m = m.parentNode) if (m.getAttribute('data-cv-mod') != null) return m.getAttribute('data-cv-edit') == null;
  return false;
};
const zoneOf = t => {
  for (let n = t; n && typeof n.getAttribute === 'function'; n = n.parentNode) {
    const z = n.getAttribute('data-gesture');
    if (z && !(z === 'own' && asleep(n))) return { kind: z, el: n };
  }
  return { kind: '', el: null };
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isRange = t => !!t && t.tagName === 'INPUT' && String(t.type).toLowerCase() === 'range';
const css = (win, n) => { try { return typeof win.getComputedStyle === 'function' ? win.getComputedStyle(n) : null; } catch (err) { return null; } };
const PASSIVE = { capture: true, passive: true };
// may the browser pan under a touch on t? Its used touch-action — t's and its ancestors' values intersected up to the
// nearest scroll container, whose own value starts it again (StyleAdjuster computeUsedTouchAction) — has pan-x, pan-y
// or manipulation in it, or is auto (WKTouchActionGestureRecognizer; pinch-zoom alone, or none: no panning)
function mayPan(win, t) {
  if (typeof win.getComputedStyle !== 'function') return true;
  let x = true, y = true;
  for (let n = t; n && n.nodeType === 1; n = n.parentNode) {
    const s = css(win, n), v = String((s && s.touchAction) || 'auto');
    if (v !== 'auto' && v !== 'manipulation') { x = x && /pan-x/.test(v); y = y && /pan-y/.test(v); }
    if (s && (OVER.test(String(s.overflowX || '')) || OVER.test(String(s.overflowY || '')))) break;
  }
  return x || y;
}

export function installGestures(win, opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : () => (win.performance && typeof win.performance.now === 'function' ? win.performance.now() : Date.now());
  const later = typeof o.setTimeout === 'function' ? o.setTimeout : (f, ms) => (typeof win.setTimeout === 'function' ? win.setTimeout(f, ms) : setTimeout(f, ms));
  const unlater = typeof o.clearTimeout === 'function' ? o.clearTimeout : id => (typeof win.clearTimeout === 'function' ? win.clearTimeout(id) : clearTimeout(id));
  const mkEv = typeof o.event === 'function' ? o.event : (type, init) => {
    const E = /^pointer/.test(type) && typeof win.PointerEvent === 'function' ? win.PointerEvent : typeof win.Event === 'function' ? win.Event : Event;
    const e = new E(type, init);
    for (const k in init) if (!(k in e)) try { e[k] = init[k]; } catch (err) { /* read-only */ }
    return e;
  };
  const doc = () => win.document || null;
  const pts = new Map(); // touch pointerId → { id, t0, x0, y0, x, y, target, cap, zone, range, spent, cancelled, held, free }
  const claims = new Map(); // pointerId → Set of { cancel }
  // the range inputs under a session's fingers ({ el, v }): their thumbs may follow a finger (its touchmove's default
  // handling is the browser's, never prevented), so their values go back again when the last touch ends
  const late = new Set();
  // S: { kind: 'nav' | 'own', ids, el (own: its element), at (its last event), native, base / last (frames), panOn, zoomOn,
  // carry (sub-px scroll), chain (scrollers), rootT (the page scrolled), regrip / dog (timers) }
  let S = null, suppressUntil = -1;
  const suppressing = () => !!S || now() < suppressUntil;
  const stop = e => {
    if (e.cancelable !== false && typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
  };
  const swallow = e => { if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation(); };
  // a session's pointerdown: swallowed; in a script session preventDefault-ed too (no compatibility mouse events),
  // never in a native one. Every later event of its touches is swallowed only (passive listeners)
  const eat = e => (S && S.native ? swallow(e) : stop(e));

  /* pairing */
  // CSS px per physical px (an iPad's pt at scale 1): the browser's own pinch-zoom (visualViewport.scale) magnifies
  // the page, so the same distance on the glass covers fewer CSS px
  const perPt = () => { const vv = win.visualViewport, z = vv && +vv.scale > 0 ? +vv.scale : 1; return 1 / z; };
  function atEdge(q, f) { // q landed ≤ EDGE_PX from the screen's edge: the visual viewport's, in client (layout) coordinates
    const vv = win.visualViewport, m = EDGE_PX * f;
    const L = vv ? +vv.offsetLeft || 0 : 0, T = vv ? +vv.offsetTop || 0 : 0;
    const W = vv && +vv.width > 0 ? +vv.width : +win.innerWidth || 0, H = vv && +vv.height > 0 ? +vv.height : +win.innerHeight || 0;
    return q.x0 <= L + m || q.y0 <= T + m || (W > 0 && q.x0 >= L + W - m) || (H > 0 && q.y0 >= T + H - m);
  }
  function partner(p, t) { // the newest touch p pairs with, or null
    const music = p.zone.kind === 'music', perf = p.zone.kind === 'perf', f = perPt();
    let best = null;
    for (const q of pts.values()) {
      if (q === p || q.spent || q.cancelled || q.free || q.zone.kind === 'music') continue;
      // (1i G1) a perf touch never pairs with a perf one (two wheels, two levers, a lever and a pad: thumb and finger), and
      // with anything else by the time rule only (a held controller + a knob of the other hand: two hands)
      const qp = q.zone.kind === 'perf';
      if (perf && qp) continue;
      const age = t - q.t0, d = dist(q, { x: p.x0, y: p.y0 }), timely = age <= PAIR_MS && d <= PAIR_DIST * f;
      if (music) { if (timely && !qp) best = q; continue; }
      if (timely || (!perf && !qp && age <= LATE_MS && d <= LATE_PX * f && dist(q, { x: q.x0, y: q.y0 }) <= STILL_PX * f && !atEdge(q, f))) best = q;
    }
    return best;
  }
  // the overflow scrollers t is in that can scroll (WebKit gives each a scroll view of its own), the page's not included
  function scrollersOf(t) {
    const d = doc(), out = [];
    const root = d ? d.scrollingElement || d.documentElement : null, body = d ? d.body : null;
    for (let n = t; n && n.nodeType === 1 && n !== root && n !== body; n = n.parentNode) {
      const s = css(win, n);
      if (!s) continue;
      const ax = OVER.test(String(s.overflowX || '')) && (+n.scrollWidth || 0) > (+n.clientWidth || 0);
      const ay = OVER.test(String(s.overflowY || '')) && (+n.scrollHeight || 0) > (+n.clientHeight || 0);
      if (ax || ay) out.push(n);
    }
    return out;
  }
  // does the browser scroll under the session by itself (→ native: no script pan)? A scroll view's pan begins unless
  // one of its touches' used touch-action allows no panning (WKTouchActionGestureRecognizer canPreventGestureRecognizer):
  // the page's scroll view has every active touch, an overflow scroller's the touches inside it
  function nativePan(ids) {
    const all = [...pts.values()], pans = new Map(all.map(x => [x, mayPan(win, x.target)]));
    if (all.every(x => pans.get(x))) return true;
    for (const id of ids) {
      const p = pts.get(id);
      if (!p || !pans.get(p)) continue;
      for (const sc of scrollersOf(p.target)) {
        if (all.every(x => pans.get(x) || !x.target || typeof sc.contains !== 'function' || !sc.contains(x.target))) return true;
      }
    }
    return false;
  }
  // a menu or chooser opened by the press of every touch on or in el (contextmenu, wk-hold): that touch is freed
  function freeAt(el) {
    if (!el) return;
    for (const x of pts.values()) {
      if (x.target && (x.target === el || (typeof el.contains === 'function' && el.contains(x.target)))) x.free = true;
    }
  }
  function restoreRec(r) {
    if (!r || r.el.value === r.v) return;
    r.el.value = r.v;
    for (const t of ['input', 'change']) r.el.dispatchEvent(mkEv(t, { bubbles: true }));
  }
  const restoreRange = p => restoreRec(p.range);
  function restoreLate() { if (!late.size) return; const a = [...late]; late.clear(); for (const r of a) restoreRec(r); }
  function cancelOwner(q) { // q's owner rolls its press back
    const set = claims.get(q.id);
    claims.delete(q.id);
    if (set) for (const c of set) { try { if (c && c.cancel) c.cancel(); } catch (err) { console.error(err); } }
    restoreRange(q);
    q.cancelled = true;
    const at = q.cap && q.target && typeof q.cap.contains === 'function' && !q.cap.contains(q.target) ? q.cap : q.target || q.cap;
    if (!at || typeof at.dispatchEvent !== 'function') return;
    const ev = mkEv('pointercancel', { bubbles: true, cancelable: false, pointerId: q.id, pointerType: 'touch', isPrimary: q.primary, clientX: q.x, clientY: q.y });
    try { ev.gesture = 'two-finger'; } catch (err) { /* frozen */ }
    at.dispatchEvent(ev);
  }

  /* the session */
  function open(kind, q, p, t) {
    S = { kind, ids: new Set([q.id, p.id]), el: null, at: t, native: false, base: null, last: null, panOn: false, zoomOn: false,
      carry: { x: 0, y: 0 }, chain: null, rootT: null, regrip: 0, dog: 0 };
    watch(S, WATCHDOG_MS);
  }
  function watch(s, ms) { // the watchdog: WATCHDOG_MS without an event from the session's touches ends it
    s.dog = later(() => {
      if (S !== s) return;
      const idle = now() - s.at;
      if (idle < WATCHDOG_MS) watch(s, WATCHDOG_MS - idle);
      else { spend(s); finish(); }
    }, ms);
  }
  function spend(s) { if (s.kind === 'nav') for (const id of s.ids) { const p = pts.get(id); if (p) p.spent = true; } }
  function finish() { // the session is over
    const s = S;
    if (!s) return;
    S = null;
    unlater(s.dog); unlater(s.regrip);
    suppressUntil = now() + GRACE_MS;
  }
  function reset() { if (S) { spend(S); finish(); } } // the page went away under the fingers
  function frame() { // the midpoint and spread of the first two session touches
    const a = [];
    for (const id of S.ids) { const p = pts.get(id); if (p && !p.spent) a.push(p); if (a.length === 2) break; }
    if (a.length < 2) return null;
    return { cx: (a[0].x + a[1].x) / 2, cy: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) };
  }
  function rebase() { S.base = S.last = frame(); } // the fingers changed: go on from here (no jump)
  function regrip() { // one finger left: another may come within REGRIP_MS, else it is spent and the session over
    S.base = S.last = null;
    unlater(S.regrip);
    const s = S;
    s.regrip = later(() => { if (S === s) { spend(s); finish(); } }, REGRIP_MS);
  }
  // track() once a frame (rAF): after every finger's pointermove of a touch event; flush() at once (a lift)
  let reqId = 0;
  const raf = f => (typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame(f) : later(f, 16));
  function pend() { S.pend = true; if (!reqId) reqId = raf(() => { reqId = 0; flush(); }); }
  function flush() { if (S && S.pend) { S.pend = false; track(); } }
  function track() { // the script's pan: the midpoint's travel, once past PAN_PX from the grip (the travel so far too)
    const f = frame();
    if (!f || !S.base) return;
    const L = S.last;
    let dx = f.cx - L.cx, dy = f.cy - L.cy, zf = 1;
    S.last = f;
    // the zoom hook's pinch: the spread's ratio frame to frame once it changed PINCH_PX since the grip — engaged when the
    // hook takes f = 1 there (no jump); it engages the pan too (the content under the midpoint stays under it)
    if (typeof o.zoom === 'function') {
      if (S.zoomOn) zf = L.d > 0 && f.d > 0 ? f.d / L.d : 1;
      else if (Math.abs(f.d - S.base.d) > PINCH_PX * perPt() && o.zoom(1, f.cx, f.cy, S.base) !== false) S.zoomOn = true;
    }
    if (!S.panOn) {
      if (!S.zoomOn && Math.hypot(f.cx - S.base.cx, f.cy - S.base.cy) <= PAN_PX * perPt()) return;
      S.panOn = true; dx = f.cx - S.base.cx; dy = f.cy - S.base.cy;
    }
    if (dx || dy) panBy(S, -dx, -dy);
    if (zf !== 1 && isFinite(zf)) o.zoom(zf, f.cx, f.cy, S.base);
  }

  /* the pan */
  function chainAt(x, y) { // the scrollers under (x, y), innermost first (the page itself not included)
    const d = doc(), out = [];
    if (!d) return out;
    let t = null;
    try { t = typeof d.elementFromPoint === 'function' ? d.elementFromPoint(x, y) : null; } catch (err) { t = null; }
    const root = d.scrollingElement || d.documentElement;
    for (let n = t; n && n.nodeType === 1 && n !== root && n !== d.body; n = n.parentNode) {
      const s = css(win, n);
      if (!s) continue;
      const ax = OVER.test(String(s.overflowX || '')), ay = OVER.test(String(s.overflowY || ''));
      if (ax || ay) out.push({ n, ax, ay });
    }
    return out;
  }
  // n's scroll offset moved by `want` px within its range (clamped here: iOS doesn't at once, WebKit 179735) → px moved
  function shift(n, k, max, want) {
    const b = +n[k] || 0, to = Math.min(Math.max(0, max), Math.max(0, b + want));
    if (to === b) return 0;
    n[k] = to;
    return to - b;
  }
  // scroll by (dx, dy): the nearest scroller under the session's midpoint that can still go that way (each axis on its
  // own), what it can't take to the next one out, the rest to the page; whole px, the remainders carried
  function panBy(s, dx, dy) {
    if (typeof o.pan === 'function' && o.pan(dx, dy, s.base) !== false) return; // (false: not the canvas's — scroll as below)
    const c = s.carry;
    c.x += dx; c.y += dy;
    let lx = c.x < 0 ? Math.ceil(c.x) : Math.floor(c.x), ly = c.y < 0 ? Math.ceil(c.y) : Math.floor(c.y);
    c.x -= lx; c.y -= ly;
    if (!lx && !ly) return;
    if (!s.chain) { const f = s.base || s.last; s.chain = f ? chainAt(f.cx, f.cy) : []; }
    for (const h of s.chain) {
      const n = h.n;
      if (lx && h.ax) lx -= shift(n, 'scrollLeft', (+n.scrollWidth || 0) - (+n.clientWidth || 0), lx);
      if (ly && h.ay) ly -= shift(n, 'scrollTop', (+n.scrollHeight || 0) - (+n.clientHeight || 0), ly);
      if (!lx && !ly) return;
    }
    const d = doc(), root = d ? d.scrollingElement || d.documentElement : null;
    if (!root || typeof win.scrollBy !== 'function') return;
    const X = +win.scrollX || 0, Y = +win.scrollY || 0;
    const mx = (+root.scrollWidth || 0) - Math.max(+root.clientWidth || 0, +win.innerWidth || 0), my = (+root.scrollHeight || 0) - Math.max(+root.clientHeight || 0, +win.innerHeight || 0);
    const tx = Math.min(Math.max(0, mx), Math.max(0, X + lx)) - X, ty = Math.min(Math.max(0, my), Math.max(0, Y + ly)) - Y;
    if (!tx && !ty) return;
    win.scrollBy(tx, ty);
    if ((+win.scrollX || 0) !== X || (+win.scrollY || 0) !== Y) s.rootT = now(); // jumpy: moves just after it are suspect
  }

  /* listeners (capture, on the window) */
  const L = [];
  const on = (type, fn, opt) => { win.addEventListener(type, fn, opt); L.push(() => win.removeEventListener(type, fn, opt)); };
  const forget = id => { pts.delete(id); claims.delete(id); if (S) S.ids.delete(id); };
  on('pointerdown', e => {
    if (e.pointerType !== 'touch') { suppressUntil = -1; return; } // a pen, the mouse: never paired; a press ends the grace
    const t = now(), tg = e.target;
    if (e.isPrimary === true) { // no other touch is down: whatever is still held is stale (a missed pointerup / touchend)
      if (S) finish();
      pts.clear(); claims.clear(); suppressUntil = -1;
      restoreLate();
    }
    if (pts.has(e.pointerId)) { // an id used again: its old touch is gone
      forget(e.pointerId);
      if (S && !S.ids.size) finish(); else if (S && S.kind === 'own' && S.ids.size < 2 && !S.regrip) regrip();
    }
    const p = { id: e.pointerId, t0: t, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, target: tg, cap: null, zone: zoneOf(tg),
      primary: e.isPrimary === true, range: isRange(tg) ? { el: tg, v: tg.value } : null, spent: false, cancelled: false, held: false,
      free: false };
    pts.set(p.id, p);
    // a further finger of a running session: an own one's on its element; a nav one's anywhere — but while one finger
    // waits for a re-grip, a key plays (the other hand)
    if (S && (S.kind === 'nav' ? !(S.regrip && p.zone.kind === 'music') : p.zone.el === S.el)) {
      if (S.kind === 'nav') flush(); // the frame still pending first (rebase starts afresh from here)
      S.at = t; S.ids.add(p.id);
      if (S.kind === 'nav') { eat(e); if (p.range) late.add(p.range); unlater(S.regrip); S.regrip = 0; rebase(); } else { unlater(S.regrip); S.regrip = 0; }
      return;
    }
    const q = S ? null : partner(p, t);
    if (!q) { if (!S) suppressUntil = -1; return; } // a touch of its own: untouched (its press ends the grace)
    if (q.zone.kind === 'own' && p.zone.el === q.zone.el) { open('own', q, p, t); S.el = q.zone.el; return; }
    open('nav', q, p, t);
    // native where the browser scrolls under the session by itself (WebKit asks every active touch: a held key too)
    S.native = nativePan(S.ids);
    for (const x of [q, p]) if (x.range) late.add(x.range);
    eat(e);
    cancelOwner(q);
    rebase();
  }, true);
  on('gotpointercapture', e => { const p = pts.get(e.pointerId); if (p && !p.cancelled) p.cap = e.target; }, true);
  on('pointermove', e => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    if (p.spent) { swallow(e); return; }
    const mine = !!S && S.ids.has(p.id), t = now();
    if (mine) S.at = t;
    if (mine && S.kind === 'nav' && !p.held && jumpy(p, e.clientX, e.clientY, t, S.rootT)) { p.held = true; swallow(e); return; }
    p.held = false;
    p.x = e.clientX; p.y = e.clientY;
    if (mine && S.kind === 'nav') { swallow(e); if (!S.native) pend(); }
  }, PASSIVE);
  const up = e => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    if (S && S.kind === 'nav' && !S.native && S.ids.has(p.id) && !p.spent) { // the frame still pending, with the lift's own position
      if (e.type === 'pointerup' && Number.isFinite(e.clientX) && Number.isFinite(e.clientY) && !jumpy(p, e.clientX, e.clientY, now(), S.rootT)) {
        if (e.clientX !== p.x || e.clientY !== p.y) { p.x = e.clientX; p.y = e.clientY; S.pend = true; }
      }
      flush();
    }
    pts.delete(p.id); claims.delete(p.id);
    if (p.spent) { swallow(e); restoreRange(p); return; }
    if (!S || !S.ids.has(p.id)) return;
    S.at = now();
    S.ids.delete(p.id);
    if (S.kind === 'nav') { swallow(e); restoreRange(p); } // (a swallowed press that moved a slider, or a thumb that followed: back)
    if (!S.ids.size) finish();
    else if (S.kind === 'nav') { if (frame()) rebase(); else regrip(); }
    else if (S.ids.size < 2) regrip(); // an own pinch down to one finger: over unless another lands on its element within REGRIP_MS
  };
  on('pointerup', up, PASSIVE);
  on('pointercancel', e => { if (e.gesture !== 'two-finger') up(e); }, PASSIVE); // (our own cancel goes on to the owner)
  for (const t of ['pointerover', 'pointerenter']) {
    on(t, e => { const p = pts.get(e.pointerId); if (p && (p.spent || (S && S.kind === 'nav' && S.ids.has(p.id)))) swallow(e); }, PASSIVE);
  }
  // no touchmove listener, a passive touchend: nothing of the browser's scroll, pinch or taps waits for this layer (the
  // two-finger tap's ⌘-click and a pinch's taps are swallowed by BLOCK below)
  const lastUp = e => !(e && e.touches && e.touches.length); // no touch left on the screen
  for (const t of ['touchend', 'touchcancel']) on(t, e => { if (lastUp(e)) restoreLate(); }, PASSIVE);
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
    on(t, e => { if (S && S.kind === 'nav' && typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation(); }, { capture: true, passive: true });
  }
  for (const t of BLOCK) {
    on(t, e => {
      if (suppressing() && (t === 'contextmenu' || e.detail >= 1)) stop(e);
      else if (t === 'contextmenu') freeAt(e.target); // a long-press's menu: its finger may stay down while the other hand picks
    }, true);
  }
  on('wk-hold', e => freeAt(e.target), true); // a widget's hold chooser (bubbling, at the widget): the same
  on('visibilitychange', () => { const d = doc(); if (d && d.visibilityState === 'hidden') reset(); }, true);
  on('pagehide', reset, true);
  on('blur', e => { if (!e || e.target === win || e.target == null) reset(); }, true); // the window's, not a control's

  return {
    // a pointerdown handler registers what undoes its press; called before the synthetic pointercancel
    claim(pointerId, h) {
      let s = claims.get(pointerId);
      if (!s) claims.set(pointerId, s = new Set());
      s.add(h);
      return () => s.delete(h);
    },
    busy: () => suppressing(),
    state: () => ({ session: S ? S.kind : null, native: !!(S && S.native), fingers: S ? S.ids.size : 0, touches: pts.size,
      spent: [...pts.values()].filter(p => p.spent).length, free: [...pts.values()].filter(p => p.free).length, late: late.size,
      suppressing: suppressing(), listeners: L.length }),
    destroy() {
      if (S) finish();
      if (reqId && typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(reqId);
      reqId = 0;
      for (const f of L.splice(0)) f();
      pts.clear(); claims.clear(); late.clear(); suppressUntil = -1;
    },
  };
}
