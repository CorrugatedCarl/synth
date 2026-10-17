// gesture.js — the two-finger layer (lead ruling G1; ipad-designs/two-finger.critique.md §4): on a touch screen a
// two-finger pan or pinch is recognised before anything else, so it never presses, turns or drags what it lands on.
// Plain ES module, no imports, nothing touches document / window at module top level (node imports it; wk.js shares
// jumpy below).
//
// installGestures(win, opts) puts its listeners on `win` — the WINDOW, never the document (VoiceOver's activation
// looks for touch listeners on nodes) — in the capture phase: the first statement of main.js boot(), so they run
// before every other. Model:
//   · the first touch is never delayed: its pointerdown passes through (keys, knobs, buttons react at once);
//   · a further touch p PAIRS with an earlier one q (not 'music', not spent) when q landed ≤ PAIR_MS ago and p is
//     ≤ PAIR_DIST from it (the time rule), or q is still (≤ STILL_PX), landed ≤ LATE_MS ago, p is ≤ LATE_PX from it
//     and q is not at a window edge (≤ EDGE_PX: a resting thumb) — the late rule. These distances and PAN_PX are
//     physical, tuned at 100 %: divided by the interface size s (one CSS px is s pt). A touch on
//     [data-gesture="music"] (the keys) pairs by the time rule only, never with a q on [data-gesture="perf"] (octave,
//     hold, the grip … then a key: both work). Otherwise both are independent touches (two hands: hold a note or a
//     knob, play or tweak);
//   · both inside one [data-gesture="own"] element (piano roll, arrangement, zoomPan canvases) → session 'own':
//     every event reaches the owner's pinch / pan; only the click suppression below applies;
//   · else session 'nav': q's owner is asked to ROLL BACK — claim() callbacks, a range input under q gets its value
//     back (input + change), then a synthetic pointercancel flagged e.gesture === 'two-finger' at the touched element
//     (it bubbles through the capturing widget; a plain pointercancel still means "end, keep"). Every later pointer
//     event of the session's touches is swallowed at the window (pointerover / -enter too; out / leave pass: hover
//     tips hide) and touchmove is preventDefault-ed (no native pan, pinch or range-thumb drag on top). Once a frame
//     (WebKit sends one pointermove per finger of a touch event: in between, a new position pairs with an old one — a
//     sideways two-finger swipe would read as a spread change; a lift flushes it first, with its own position) the
//     midpoint's travel scrolls the nearest scroller under it that can still go that way, then the page (moves spoilt
//     by WebKit 181954 dropped: jumpy); a spread change of PINCH_ENGAGE goes to the interface size (opts.scale: uiscale.js,
//     iOS / iPadOS — available()) and the pan waits meanwhile (the preview follows the fingers; a pinch that ends at
//     the same size keeps its travel as a scroll). Without it (Android, Windows touch) a session whose fingers both
//     sit where the browser may pan and zoom (used touch-action; never at a range input) is left native, else the
//     script pans and nothing zooms;
//   · a nav session down to one finger waits REGRIP_MS for another (a re-grip continues the pinch: pinchStart
//     again), then that finger is 'spent': swallowed until it lifts, never paired, the session over; an own one too
//     (another finger on its element within REGRIP_MS stays in it), then it simply ends — the finger left goes on as an
//     ordinary touch (no session holding the clicks of the whole page, nor the pairing of another hand, until it lifts);
//   · click / dblclick / auxclick / mousedown / mouseup with detail ≥ 1 (keyboard, Switch Control and VoiceOver
//     clicks pass) and contextmenu are swallowed from pairing until every session finger is up + GRACE_MS (WebKit's
//     two-finger tap clicks the midpoint, metaKey set), and touchend is preventDefault-ed (no synthetic click; not on
//     form fields: a slider's drag must end); a pointerdown of any type outside a session ends the grace at once;
//   · stale state cannot lock the page: a primary touch (no other touch down) ends a session first, and so do
//     WATCHDOG_MS without an event from its touches, a hidden page, pagehide and the window's blur;
//   · WebKit GestureEvents: not passed on during a nav session (the roll / arrangement would take them for a
//     trackpad pinch), preventDefault-ed while a touch is down where the app pinches (never with no touch: a Mac
//     trackpad's pinch stays the page's).
// Pen and mouse pointers are never paired or swallowed.
// API: installGestures(win, { scale: uiscale controller | () => it, pan(dx, dy, at)?, now, event, setTimeout,
// clearTimeout (tests) }) → { claim(pointerId, { cancel }) → unclaim, busy(), state(), destroy() }.
export const PAIR_MS = 250, PAIR_DIST = 600, STILL_PX = 10, LATE_MS = 1200, LATE_PX = 360, EDGE_PX = 24, RANGE_PX = 24;
export const GRACE_MS = 400, REGRIP_MS = 400, WATCHDOG_MS = 3000, PAN_PX = 8, PINCH_ENGAGE = 0.06;
// WebKit bug 181954 (iOS): right after the page scrolled by script, a touch / pen move (or two) may report clientX /
// clientY off by hundreds of px. jumpy(last, x, y, t, at): a move to (x, y) at t, more than JUMP_PX from the last
// good point { x, y }, within JUMP_MS of a script scroll of the page at `at` (null: none) — the caller drops it, never
// two in a row (a real fast move is held back one event at most). Shared with wk.js dragSource's edge auto-scroll.
export const JUMP_PX = 48, JUMP_MS = 250;
export const jumpy = (last, x, y, t, at) => at != null && t - at < JUMP_MS && Math.hypot(x - last.x, y - last.y) > JUMP_PX;

const BLOCK = ['click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'contextmenu'];
const OVER = /^(auto|scroll|overlay)$/;
const zoneOf = t => {
  for (let n = t; n && typeof n.getAttribute === 'function'; n = n.parentNode) {
    const z = n.getAttribute('data-gesture');
    if (z) return { kind: z, el: n };
  }
  return { kind: '', el: null };
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isRange = t => !!t && t.tagName === 'INPUT' && String(t.type).toLowerCase() === 'range';
const isField = t => !!t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName || '');
const css = (win, n) => { try { return typeof win.getComputedStyle === 'function' ? win.getComputedStyle(n) : null; } catch (err) { return null; } };
// may the browser pan and pinch-zoom natively under a touch on t? WebKit refuses as soon as one touch's used
// touch-action forbids it (WKTouchActionGestureRecognizer); the used value intersects the ancestors' up to the nearest
// scroll container, whose own value starts it again (StyleAdjuster computeUsedTouchAction)
function nativeOK(win, t) {
  if (typeof win.getComputedStyle !== 'function') return true;
  for (let n = t; n && n.nodeType === 1; n = n.parentNode) {
    const s = css(win, n), v = String((s && s.touchAction) || 'auto');
    if (v !== 'auto' && v !== 'manipulation' && (v === 'none' || !/pinch-zoom/.test(v) || !/pan-x/.test(v) || !/pan-y/.test(v))) return false;
    if (s && (OVER.test(String(s.overflowX || '')) || OVER.test(String(s.overflowY || '')))) return true;
  }
  return true;
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
  // the interface size (uiscale.js) where the app pinches the page itself, else null
  const ui = () => {
    let s = null;
    try { s = typeof o.scale === 'function' ? o.scale() : o.scale; } catch (err) { s = null; }
    return s && typeof s.available === 'function' && s.available() ? s : null;
  };
  // CSS px per pt: the pairing / pan distances are physical (one hand or two, a still finger, a thumb on the bezel),
  // tuned at 100 %; at interface size s one CSS px is s pt (uiscale.js), so they shrink by s (1 where it has none)
  const perPt = () => { const u = ui(); let s = 1; try { s = u ? +u.get() : 1; } catch (err) { s = 1; } return s > 0 ? 1 / s : 1; };
  const doc = () => win.document || null;
  const pts = new Map(); // touch pointerId → { id, t0, x0, y0, x, y, target, cap, zone, range, spent, cancelled, held }
  const claims = new Map(); // pointerId → Set of { cancel }
  // S: { kind: 'nav' | 'own', ids, el (own: its element), at (its last event), native, ui, base / last (frames),
  // panOn, pinch (1 on, -1 refused this grip), travel (the midpoint's while pinching), carry (sub-px scroll), chain
  // (scrollers), rootT (the page scrolled), regrip / dog (timers) }
  let S = null, suppressUntil = -1;
  const suppressing = () => !!S || now() < suppressUntil;
  const stop = e => {
    if (e.cancelable !== false && typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
  };

  /* pairing */
  function atEdge(q, m) { // m: EDGE_PX in CSS px
    const W = +win.innerWidth || 0, H = +win.innerHeight || 0;
    return q.x0 <= m || q.y0 <= m || (W > 0 && q.x0 >= W - m) || (H > 0 && q.y0 >= H - m);
  }
  function partner(p, t) { // the newest touch p pairs with, or null
    const music = p.zone.kind === 'music', f = perPt();
    let best = null;
    for (const q of pts.values()) {
      if (q === p || q.spent || q.cancelled || q.zone.kind === 'music') continue;
      const age = t - q.t0, d = dist(q, { x: p.x0, y: p.y0 }), timely = age <= PAIR_MS && d <= PAIR_DIST * f;
      if (music) { if (timely && q.zone.kind !== 'perf') best = q; continue; }
      if (timely || (age <= LATE_MS && d <= LATE_PX * f && dist(q, { x: q.x0, y: q.y0 }) <= STILL_PX * f && !atEdge(q, EDGE_PX * f))) best = q;
    }
    return best;
  }
  function nearRange(p) { // a range input under p or within RANGE_PX (its thumb could follow a native gesture)
    if (isRange(p.target)) return true;
    const d = doc();
    let list = [];
    try { list = d && typeof d.querySelectorAll === 'function' ? d.querySelectorAll('input[type="range"]') : []; } catch (err) { list = []; }
    for (const r of list) {
      let b = null;
      try { b = r.getBoundingClientRect(); } catch (err) { b = null; }
      if (b && b.width > 0 && p.x0 >= b.left - RANGE_PX && p.x0 <= b.right + RANGE_PX && p.y0 >= b.top - RANGE_PX && p.y0 <= b.bottom + RANGE_PX) return true;
    }
    return false;
  }
  function restoreRange(p) {
    const r = p.range;
    if (!r || r.el.value === r.v) return;
    r.el.value = r.v;
    for (const t of ['input', 'change']) r.el.dispatchEvent(mkEv(t, { bubbles: true }));
  }
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
    S = { kind, ids: new Set([q.id, p.id]), el: null, at: t, native: false, ui: null, base: null, last: null, panOn: false, pinch: 0,
      travel: { x: 0, y: 0 }, carry: { x: 0, y: 0 }, chain: null, rootT: null, regrip: 0, dog: 0 };
    watch(S, WATCHDOG_MS);
  }
  function watch(s, ms) { // the watchdog: WATCHDOG_MS without an event from the session's touches ends it
    s.dog = later(() => {
      if (S !== s) return;
      const idle = now() - s.at;
      if (idle < WATCHDOG_MS) watch(s, WATCHDOG_MS - idle);
      else { spend(s); finish(false); }
    }, ms);
  }
  function spend(s) { if (s.kind === 'nav') for (const id of s.ids) { const p = pts.get(id); if (p) p.spent = true; } }
  function finish(cancel) { // the session is over (cancel: no pinch commit)
    const s = S;
    if (!s) return;
    S = null;
    unlater(s.dog); unlater(s.regrip);
    suppressUntil = now() + GRACE_MS;
    if (s.pinch !== 1 || !s.ui) return;
    if (cancel) { s.ui.pinchCancel(); return; }
    const z0 = s.ui.get();
    s.ui.pinchEnd();
    if (s.ui.get() === z0 && (s.travel.x || s.travel.y)) panBy(s, -s.travel.x, -s.travel.y); // the same size: keep the travel
  }
  function reset() { if (S) { spend(S); finish(true); } } // the page went away under the fingers
  function frame() { // midpoint / spread of the first two session touches
    const a = [];
    for (const id of S.ids) { const p = pts.get(id); if (p && !p.spent) a.push(p); if (a.length === 2) break; }
    if (a.length < 2) return null;
    return { cx: (a[0].x + a[1].x) / 2, cy: (a[0].y + a[1].y) / 2, d: Math.max(20, dist(a[0], a[1])) };
  }
  function rebase() { // the fingers changed: go on from here (no jump; a pinch re-grips)
    const f = frame();
    S.base = S.last = f;
    if (!f) return;
    if (S.pinch === 1) S.ui.pinchStart({ x: f.cx, y: f.cy, d: f.d });
    else if (S.pinch === -1) S.pinch = 0;
  }
  function regrip() { // one finger left: another may come within REGRIP_MS, else it is spent and the session over
    S.base = S.last = null;
    unlater(S.regrip);
    const s = S;
    s.regrip = later(() => { if (S === s) { spend(s); finish(false); } }, REGRIP_MS);
  }
  // track() once a frame (rAF): after every finger's pointermove of a touch event; flush() at once (a lift)
  let reqId = 0;
  const raf = f => (typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame(f) : later(f, 16));
  function pend() { S.pend = true; if (!reqId) reqId = raf(() => { reqId = 0; flush(); }); }
  function flush() { if (S && S.pend) { S.pend = false; track(); } }
  function track() {
    const f = frame();
    if (!f || !S.base) return;
    let dx = f.cx - S.last.cx, dy = f.cy - S.last.cy;
    S.last = f;
    if (S.pinch === 1) { S.travel.x += dx; S.travel.y += dy; S.ui.pinchMove({ x: f.cx, y: f.cy, d: f.d }); return; }
    if (S.pinch === 0 && S.ui && Math.abs(Math.log(f.d / S.base.d)) > PINCH_ENGAGE) {
      // from the grip's spread (no travel lost), anchored under the fingers as they are now; the scrollers under the
      // grip kept for a pinch that ends at the same size (finish: its travel; a lift nulls base / last)
      if (!S.chain && typeof o.pan !== 'function') S.chain = chainAt(S.base.cx, S.base.cy);
      if (S.ui.pinchStart({ x: f.cx, y: f.cy, d: S.base.d })) { S.pinch = 1; S.travel = { x: 0, y: 0 }; S.ui.pinchMove({ x: f.cx, y: f.cy, d: f.d }); return; }
      S.pinch = -1;
    }
    if (!S.panOn) {
      if (Math.hypot(f.cx - S.base.cx, f.cy - S.base.cy) <= PAN_PX * perPt()) return;
      S.panOn = true; dx = f.cx - S.base.cx; dy = f.cy - S.base.cy; // the travel so far too
    }
    if (dx || dy) panBy(S, -dx, -dy);
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
    if (typeof o.pan === 'function') { o.pan(dx, dy, s.base); return; }
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
    if (e.isPrimary === true) { // no other touch is down: whatever is still held is stale (a missed pointerup)
      if (S) finish(false);
      pts.clear(); claims.clear(); suppressUntil = -1;
    }
    if (pts.has(e.pointerId)) { // an id used again: its old touch is gone
      forget(e.pointerId);
      if (S && !S.ids.size) finish(false); else if (S && S.kind === 'own' && S.ids.size < 2 && !S.regrip) regrip();
    }
    const p = { id: e.pointerId, t0: t, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, target: tg, cap: null, zone: zoneOf(tg),
      primary: e.isPrimary === true, range: isRange(tg) ? { el: tg, v: tg.value } : null, spent: false, cancelled: false, held: false };
    pts.set(p.id, p);
    // a further finger of a running session: an own one's on its element; a nav one's anywhere — but while one finger
    // waits for a re-grip, a key plays (the other hand)
    if (S && (S.kind === 'nav' ? !(S.regrip && p.zone.kind === 'music') : p.zone.el === S.el)) {
      if (S.kind === 'nav') flush(); // the frame still pending first (rebase starts afresh from here)
      S.at = t; S.ids.add(p.id);
      if (S.kind === 'nav') { stop(e); unlater(S.regrip); S.regrip = 0; rebase(); } else { unlater(S.regrip); S.regrip = 0; }
      return;
    }
    const q = S ? null : partner(p, t);
    if (!q) { if (!S) suppressUntil = -1; return; } // a touch of its own: untouched (its press ends the grace)
    if (q.zone.kind === 'own' && p.zone.el === q.zone.el) { open('own', q, p, t); S.el = q.zone.el; return; }
    open('nav', q, p, t);
    S.ui = ui();
    S.native = !S.ui && nativeOK(win, q.target) && nativeOK(win, p.target) && !nearRange(q) && !nearRange(p);
    stop(e);
    cancelOwner(q);
    rebase();
  }, true);
  on('gotpointercapture', e => { const p = pts.get(e.pointerId); if (p && !p.cancelled) p.cap = e.target; }, true);
  on('pointermove', e => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    if (p.spent) { stop(e); return; }
    const mine = !!S && S.ids.has(p.id), t = now();
    if (mine) S.at = t;
    if (mine && S.kind === 'nav' && !p.held && jumpy(p, e.clientX, e.clientY, t, S.rootT)) { p.held = true; stop(e); return; }
    p.held = false;
    p.x = e.clientX; p.y = e.clientY;
    if (mine && S.kind === 'nav') { stop(e); if (!S.native) pend(); }
  }, true);
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
    if (p.spent) { stop(e); return; }
    if (!S || !S.ids.has(p.id)) return;
    S.at = now();
    S.ids.delete(p.id);
    if (S.kind === 'nav') { stop(e); if (!p.cancelled) restoreRange(p); } // (a swallowed press that moved a slider: back)
    if (!S.ids.size) finish(false);
    else if (S.kind === 'nav') { if (frame()) rebase(); else regrip(); }
    else if (S.ids.size < 2) regrip(); // an own pinch down to one finger: over unless another lands on its element within REGRIP_MS
  };
  on('pointerup', up, true);
  on('pointercancel', e => { if (e.gesture !== 'two-finger') up(e); }, true); // (our own cancel goes on to the owner)
  for (const t of ['pointerover', 'pointerenter']) {
    on(t, e => { const p = pts.get(e.pointerId); if (p && (p.spent || (S && S.kind === 'nav' && S.ids.has(p.id)))) stop(e); }, true);
  }
  on('touchmove', e => { if (S && S.kind === 'nav' && !S.native && e.cancelable) e.preventDefault(); }, { capture: true, passive: false });
  on('touchend', e => { if (suppressing() && e.cancelable && !isField(e.target)) e.preventDefault(); }, { capture: true, passive: false });
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
    on(t, e => {
      if (S && S.kind === 'nav' && typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      if (pts.size && e.cancelable && ui()) e.preventDefault();
    }, { capture: true, passive: false });
  }
  for (const t of BLOCK) on(t, e => { if (suppressing() && (t === 'contextmenu' || e.detail >= 1)) stop(e); }, true);
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
    state: () => ({ session: S ? S.kind : null, native: !!(S && S.native), pinching: !!(S && S.pinch === 1), fingers: S ? S.ids.size : 0,
      touches: pts.size, spent: [...pts.values()].filter(p => p.spent).length, suppressing: suppressing(), listeners: L.length }),
    destroy() {
      if (S) finish(true);
      if (reqId && typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(reqId);
      reqId = 0;
      for (const f of L.splice(0)) f();
      pts.clear(); claims.clear(); suppressUntil = -1;
    },
  };
}
