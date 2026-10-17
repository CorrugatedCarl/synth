// cv-tray.js — the shell's trays (SPEC-canvas §2.1–§2.4, §3 drag-in; contract: docs/canvas/IMPL-1b.md §4.6): the one
// height budget of the top tray and the keyboard tray, the grip helper both use (lifted from main.js initKbView), the side
// trays (Sources left, Effects right; opened by a tap on their rail, never an edge swipe), the Sources tray's tiles and
// their drag-out, the ≡ / ⚙ popovers and the sheets in #ov. Owner: SHELL lane.
// Rules: plain ES module, no DOM at module top level, survives tests/main-sim.mjs's DOM stub (it keeps references to the
// nodes it makes or is given, never queries them back); imports carry ?v=9.
import * as wk from './wk.js?v=9';
import * as cvArt from './cv-art.js?v=9';

/** Top tray heights (px): the collapsed row, the arrangement toolbar, the ruler, one track row (= arrange.js rowHeight). */
export const TOP_ROW = 48, ARR_BAR = 32, RULER = 24, ROW_H = 56;
/** The canvas never gets less than CANVAS_MIN px between the trays. */
export const CANVAS_MIN = 240;
/** Side trays: collapsed rail width, default open width, a grip's least distance from the screen edge (gesture.js EDGE_PX). */
export const RAIL_W = 44, SIDE_W = 240, EDGE_INSET = 24;
/** Side-tray panel widths a grip drag may give (px; the upper one also ≤ half the window). */
export const SIDE_MIN = 200, SIDE_MAX = 440;
/** Tray prefs (appstore): { top, topLast, src: {open, w}, fx: {open, w} }. */
export const TRAY_PREF = 'synth.cv.trays';
/** A quick touch drag (wk.dragSource info.quick: no hold) drops only on a zone it rested on this long (a flick is a cancel). */
export const SETTLE_MS = 100;
/** The drag ghost's lift above a finger (serum-ui.js ghostAt). */
export const GHOST_LIFT = 40;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// the document to build in: o.doc, the element's, the global one — the first that is one (main-sim's inert members are not)
const docOf = (o, el) => { for (const d of [o && o.doc, el && el.ownerDocument, globalThis.document]) if (d && typeof d.createElement === 'function') return d; return null; };
const listen = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); return () => t.removeEventListener(type, fn, opt); };
const mk = (d, tag, cls, txt) => { const e = d.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const inside = (root, n) => { try { return !!root && !!n && typeof root.contains === 'function' && root.contains(n); } catch { return false; } };
const rectOf = el => { try { return el.getBoundingClientRect(); } catch { return null; } };
const tOf = e => (e && typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : Date.now());
// the nearest of n and its ancestors (up to root, excluded) that satisfies f
const upTo = (n, root, f) => { for (; n && n !== root && n.nodeType === 1; n = n.parentNode) if (f(n)) return n; return null; };

/** The top tray's height stops for n tracks: [TOP_ROW, TOP_ROW + ARR_BAR + RULER + ROW_H·1, …, + ROW_H·n].
 * @param {number} n @returns {number[]} */
export function topSnaps(n) {
  const out = [TOP_ROW], k = Math.max(0, Math.floor(+n || 0));
  for (let i = 1; i <= k; i++) out.push(TOP_ROW + ARR_BAR + RULER + ROW_H * i);
  return out;
}
/** The snap nearest to v among those ≤ max (the lowest when none fits). @param {number[]} snaps */
export function nearestSnap(snaps, v, max = Infinity) {
  const ok = snaps.filter(s => s <= max + 0.5);
  const L = ok.length ? ok : [Math.min(...snaps)];
  let best = L[0];
  for (const s of L) if (Math.abs(s - v) < Math.abs(best - v)) best = s;
  return best;
}
/**
 * The one height budget (replaces main.js kbMaxH): the canvas keeps ≥ min px; the tray being dragged (`active`, default
 * 'bottom') gets its request, the other is pushed toward its fold (never below its own min); both at their mins → the
 * active one is clamped to its min too (a window too small for the rule: the canvas gets what is left). Pure.
 * @param {{vh: number, top: number, bottom: number, active?: 'top' | 'bottom', topMin?: number, bottomMin?: number, min?: number}} s
 * @returns {{top: number, bottom: number, canvas: number}}
 */
export function budget(s) {
  const vh = Math.max(0, +s.vh || 0), min = s.min != null && isFinite(s.min) ? Math.max(0, +s.min) : CANVAS_MIN;
  const tMin = Math.max(0, s.topMin != null && isFinite(s.topMin) ? +s.topMin : TOP_ROW), bMin = Math.max(0, +s.bottomMin || 0);
  let top = Math.max(tMin, +s.top || 0), bot = Math.max(bMin, +s.bottom || 0);
  const room = vh - min; // what the two trays may take together
  if (top + bot > room) {
    if (s.active === 'top') {
      bot = Math.max(bMin, room - top);
      if (top + bot > room) top = Math.max(tMin, room - bot);
    } else {
      top = Math.max(tMin, room - bot);
      if (top + bot > room) bot = Math.max(bMin, room - top);
    }
  }
  return { top, bottom: bot, canvas: vh - top - bot };
}

/**
 * A tray grip (role=slider): pointer drag with capture (a two-finger pointercancel — e.gesture === 'two-finger' — puts
 * the height back unsaved: set(h0, 'cancel')), arrows / Page Up / Down / Home / End, Enter / Delete / Backspace reset,
 * double-click / double-tap (two taps < 450 ms and 16 px apart, each < 350 ms and < 4 px, no drag) → o.onDouble, ARIA
 * valuenow / valuemin / valuemax / valuetext. Up / Right = taller whatever the edge. A drag clamps to [min(), max()] and
 * snaps on release when o.snaps is given (keys step from snap to snap then).
 * @param {HTMLElement} grip
 * @param {{
 *   edge: 'top' | 'bottom', label: string,
 *   get: () => number, set: (px: number, phase: 'move' | 'end' | 'cancel' | 'key' | 'reset') => void,
 *   min: () => number, max: () => number, snaps?: () => number[], step?: number,
 *   onDouble?: () => void, start?: () => void, text?: (px: number) => string, doc?: Document,
 * }} o
 * @returns {{sync: () => void, destroy: () => void, dragging: () => boolean}}
 */
export function trayGrip(grip, o) {
  const sign = o.edge === 'top' ? 1 : -1; // a top tray grows downward, a bottom tray upward
  const step = o.step > 0 ? +o.step : 10;
  const lo = () => +o.min() || 0, hi = () => Math.max(lo(), +o.max() || 0);
  const lim = v => clamp(Math.round(v), lo(), hi());
  const snapsOf = () => (typeof o.snaps === 'function' ? o.snaps() || null : null);
  if (!grip.getAttribute('role')) grip.setAttribute('role', 'slider');
  if (grip.getAttribute('tabindex') == null) grip.setAttribute('tabindex', '0');
  grip.setAttribute('aria-orientation', 'vertical');
  if (o.label) grip.setAttribute('aria-label', o.label);
  let drag = null, moved = false, down = null, tap = null, type = 'mouse';
  const dbl = () => { if (typeof o.onDouble === 'function') o.onDouble(); sync(); };
  function sync() {
    const v = Math.round(+o.get() || 0);
    grip.setAttribute('aria-valuenow', String(v));
    grip.setAttribute('aria-valuemin', String(Math.round(lo())));
    grip.setAttribute('aria-valuemax', String(Math.round(Math.max(hi(), v))));
    grip.setAttribute('aria-valuetext', typeof o.text === 'function' ? o.text(v) : v + ' pixels');
  }
  function finish(e, roll) {
    const D = drag;
    if (!D || (e && e.pointerId !== D.id)) return;
    drag = null;
    grip.classList.remove('drag');
    try { grip.releasePointerCapture(D.id); } catch { /* released */ }
    if (!moved) return;
    if (roll) o.set(D.h0, 'cancel');
    else { const S = snapsOf(); o.set(S ? nearestSnap(S, D.cur, hi()) : D.cur, 'end'); }
    sync();
  }
  const offs = [
    listen(grip, 'pointerdown', e => {
      type = e.pointerType || 'mouse';
      down = e.button > 0 || type === 'mouse' ? null : { t: tOf(e), x: e.clientX, y: e.clientY };
      if (e.button > 0 || drag) return;
      if (e.preventDefault) e.preventDefault(); // (a mouse press does not focus it: the arrow keys stay the page's)
      moved = false;
      drag = { id: e.pointerId, y0: e.clientY, h0: +o.get() || 0, cur: +o.get() || 0 };
      grip.classList.add('drag');
      try { grip.setPointerCapture(e.pointerId); } catch { /* pointer gone */ }
      if (typeof o.start === 'function') o.start();
    }),
    listen(grip, 'pointermove', e => {
      const D = drag;
      if (!D || e.pointerId !== D.id) return;
      if (e.pointerType === 'mouse' && e.buttons === 0) { finish(e, false); return; } // a swallowed pointerup
      const dy = e.clientY - D.y0;
      if (!moved && Math.abs(dy) < 3) return; // a tap (or the first of a double tap) leaves it alone
      moved = true;
      D.cur = lim(D.h0 + sign * dy);
      o.set(D.cur, 'move');
      sync();
    }),
    listen(grip, 'pointerup', e => {
      const d = down; down = null;
      const wasDrag = moved;
      finish(e, false);
      if (!d || tOf(e) - d.t > 350 || Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 4 || wasDrag) { tap = null; return; }
      if (tap && d.t - tap.t < 450 && Math.hypot(d.x - tap.x, d.y - tap.y) < 16) { tap = null; dbl(); } else tap = { t: tOf(e), x: d.x, y: d.y };
    }),
    listen(grip, 'pointercancel', e => { down = null; tap = null; finish(e, !!e && e.gesture === 'two-finger'); }),
    listen(grip, 'lostpointercapture', e => { if (drag && e.pointerId === drag.id) finish(e, false); }),
    listen(grip, 'dblclick', () => { if (type === 'mouse') dbl(); }),
    listen(grip, 'contextmenu', e => { if (e.preventDefault) e.preventDefault(); }),
    listen(grip, 'keydown', e => {
      const k = e.key, S = snapsOf(), cur = +o.get() || 0;
      let v = null, phase = 'key';
      if (S && /^(Arrow(Up|Down|Left|Right)|Page(Up|Down))$/.test(k)) {
        const up = k === 'ArrowUp' || k === 'ArrowRight' || k === 'PageUp', L = S.filter(s => s <= hi() + 0.5);
        v = up ? (L.find(s => s > cur + 0.5) ?? Math.max(...L, lo())) : ([...L].reverse().find(s => s < cur - 0.5) ?? lo());
      } else {
        const st = e.shiftKey ? 1 : step;
        const d = { ArrowUp: st, ArrowRight: st, ArrowDown: -st, ArrowLeft: -st, PageUp: 4 * step, PageDown: -4 * step }[k];
        if (d) v = lim(cur + d);
        else if (k === 'Home') v = lo();
        else if (k === 'End') v = hi();
        else if (k === 'Enter' || k === 'Delete' || k === 'Backspace') { v = 0; phase = 'reset'; }
        else return;
      }
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation(); // (not the page's arrow / Home / Delete keys)
      o.set(v, phase);
      sync();
    }),
  ];
  sync();
  return { sync, dragging: () => !!drag && moved, destroy() { for (const f of offs) f(); if (drag) finish(null, true); } };
}

/**
 * A side tray: a RAIL_W rail (a tap opens), the panel (SIDE_W, resizable by a grip on its inner edge ≥ EDGE_INSET from
 * the screen edge), closes on its rail, its ✕, Escape (the caller's chain) and as soon as a drag leaves it — never on a
 * press outside it (a tap on the canvas keeps it open).
 * o.rail / o.panel / o.grip: the tray's nodes (index.html); missing ones are made. o.key: its part of the TRAY_PREF record.
 * @param {HTMLElement} el  #srcTray | #fxTray
 * @param {{side: 'left' | 'right', store?: {get: Function, set: Function}, key?: string, rail?: HTMLElement,
 *   panel?: HTMLElement, grip?: HTMLElement, label?: string, onChange?: (open: boolean) => void,
 *   keepOpen?: (target: Element) => boolean, doc?: Document}} o
 * @returns {{open: (section?: string) => void, close: () => boolean, toggle: () => void, isOpen: () => boolean,
 *   width: () => number, setWidth: (px: number) => void, el: HTMLElement, panel: HTMLElement, rail: HTMLElement,
 *   grip: HTMLElement, destroy: () => void}}
 */
export function sideTray(el, o) {
  const d = docOf(o, el), side = o.side === 'right' ? 'right' : 'left', key = o.key || (side === 'left' ? 'src' : 'fx');
  const rail = o.rail || el.appendChild(mk(d, 'button', 'cv-rail'));
  const panel = o.panel || el.appendChild(mk(d, 'div', 'cv-panel'));
  const grip = o.grip || el.appendChild(mk(d, 'div', 'cv-sgrip'));
  if (rail.tagName === 'BUTTON' && !rail.getAttribute('type')) rail.setAttribute('type', 'button');
  rail.setAttribute('aria-expanded', 'false');
  if (panel.id) rail.setAttribute('aria-controls', panel.id);
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.setAttribute('aria-label', (o.label || 'Tray') + ' width');
  if (grip.getAttribute('tabindex') == null) grip.setAttribute('tabindex', '0');
  const pref = () => { const p = o.store ? o.store.get(TRAY_PREF, null) : null; return p && typeof p === 'object' ? p : {}; };
  const saved = pref()[key] || {};
  let w = clamp(+saved.w || SIDE_W, SIDE_MIN, SIDE_MAX), open = false, offDoc = null;
  const maxW = () => { const win = d && d.defaultView, vw = win && win.innerWidth > 0 ? win.innerWidth : 1e4; return Math.max(SIDE_MIN, Math.min(SIDE_MAX, Math.floor(vw / 2) - RAIL_W)); };
  const save = () => { if (!o.store) return; const p = Object.assign({}, pref()); p[key] = { open, w }; o.store.set(TRAY_PREF, p); };
  const applyW = () => { if (el.style && el.style.setProperty) el.style.setProperty('--cv-side-w', w + 'px'); };
  function setOpen(on, persist = true) {
    if (open === on) return;
    open = on;
    el.classList.toggle('open', on);
    panel.hidden = !on;
    rail.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (offDoc) { offDoc(); offDoc = null; }
    // a press outside (the canvas, the top tray …) leaves it open (the user's call): only its rail, its ✕ and Escape close it
    if (persist) save();
    if (typeof o.onChange === 'function') o.onChange(on);
  }
  // the grip: drag the inner edge (pointer capture; a two-finger cancel puts the width back), arrows ±16 px
  let g = null;
  const gOffs = [
    listen(grip, 'pointerdown', e => {
      if (e.button > 0 || g) return;
      if (e.preventDefault) e.preventDefault();
      g = { id: e.pointerId, x0: e.clientX, w0: w };
      grip.classList.add('drag');
      try { grip.setPointerCapture(e.pointerId); } catch { /* gone */ }
    }),
    listen(grip, 'pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      w = clamp(Math.round(g.w0 + (side === 'left' ? 1 : -1) * (e.clientX - g.x0)), SIDE_MIN, maxW());
      applyW();
    }),
    listen(grip, 'pointerup', e => { if (g && e.pointerId === g.id) { g = null; grip.classList.remove('drag'); save(); } }),
    listen(grip, 'pointercancel', e => {
      if (!g || e.pointerId !== g.id) return;
      if (e.gesture === 'two-finger') { w = g.w0; applyW(); }
      g = null; grip.classList.remove('drag'); save();
    }),
    listen(grip, 'keydown', e => {
      const dir = side === 'left' ? 1 : -1, dd = { ArrowRight: 16 * dir, ArrowLeft: -16 * dir }[e.key];
      if (!dd) return;
      if (e.preventDefault) e.preventDefault();
      w = clamp(w + dd, SIDE_MIN, maxW()); applyW(); save();
    }),
    listen(rail, 'click', () => setOpen(!open)),
  ];
  applyW();
  panel.hidden = true;
  if (saved.open) setOpen(true, false);
  return {
    el, panel, rail, grip,
    open: () => setOpen(true),
    close: () => { if (!open) return false; setOpen(false); return true; },
    toggle: () => setOpen(!open),
    isOpen: () => open,
    width: () => w,
    setWidth: px => { w = clamp(Math.round(+px || SIDE_W), SIDE_MIN, maxW()); applyW(); save(); },
    destroy() { for (const f of gOffs) f(); if (offDoc) offDoc(); offDoc = null; },
  };
}

/**
 * The Sources tray's synth tiles (cv-art drawings, name, year · maker). A tile drags out at once toward the canvas,
 * scrolls along the tray, drags any way after a 250 ms hold (wk.dragSource {scrollAxis: 'y', autoScroll: false}); the
 * ghost is the drawing 40 px above a finger (beside a mouse pointer), hidden while the canvas draws the true-size
 * outline (o.canvasGhost() → true). A tap picks (mode 'replace': the selected track's instrument; 'track': a new
 * track). Every drag callback gets info.over: 'canvas' | 'tracks' | null (o.overOf(target, x, y)) and info.left (the
 * pointer has left o.tray since the drag began); a quick touch drag
 * (no hold) drops only on a zone it rested on SETTLE_MS (a flick is a cancel); o.onLeave() once the pointer leaves
 * o.tray (the side tray closes, so the drop area shows).
 * @param {HTMLElement} el  the tray panel's list container
 * @param {{
 *   models: Array<{id: string, name: string, year: number, maker: string}>,
 *   pick: (modelId: string, mode: 'replace' | 'track') => void,
 *   drag: {
 *     begin?: (modelId: string, info: object) => void,
 *     move?: (modelId: string, info: object) => void,
 *     drop: (modelId: string, info: object) => boolean,
 *     cancel?: (modelId: string, info: object) => void,
 *   },
 *   overOf?: (target: Element | null, x: number, y: number) => 'canvas' | 'tracks' | null,
 *   canvasGhost?: () => boolean, tray?: HTMLElement, onLeave?: () => void, layer?: HTMLElement,
 *   label?: (modelId: string, over: string | null) => string, doc?: Document,
 * }} o
 * @returns {{setCurrent: (modelId: string) => void, setMode: (m: 'replace' | 'track') => void, mode: () => string,
 *   tiles: () => HTMLElement[], destroy: () => void}}
 */
export function sourcesTray(el, o) {
  const d = docOf(o, el);
  let mode = 'replace', cur = null;
  const tiles = new Map(), offs = [];
  const overOf = (t, x, y) => { try { return o.overOf ? o.overOf(t, x, y) || null : null; } catch { return null; } };
  const labelOf = (id, over) => (o.label ? o.label(id, over) : over === 'tracks' ? '+ New track' : '');
  for (const m of o.models) {
    const meta = cvArt.tileMeta(m.id);
    const b = mk(d, 'button', 'cv-tile');
    b.type = 'button';
    b.setAttribute('data-model', m.id);
    b.title = `${meta.label} (${meta.year} · ${meta.maker}) — tap to use it, or drag it onto the canvas or the track list`;
    const pic = mk(d, 'span', 'cv-tart');
    pic.setAttribute('aria-hidden', 'true');
    pic.innerHTML = cvArt.art(m.id, cvArt.TILE);
    const nm = mk(d, 'span', 'cv-tname', meta.label), mt = mk(d, 'span', 'cv-tmeta', `${meta.year} · ${meta.maker}`);
    b.append(pic, nm, mt);
    offs.push(listen(b, 'click', e => { if (e && e.defaultPrevented) return; o.pick(m.id, mode); }));
    offs.push(tileDrag(b, m.id));
    el.appendChild(b);
    tiles.set(m.id, b);
  }
  function tileDrag(b, id) {
    let G = null;
    const mkGhost = type => {
      const g = mk(d, 'div', 'cv-tghost' + (type === 'touch' ? ' touch' : ''));
      const pic = mk(d, 'span', 'cv-tart');
      pic.innerHTML = cvArt.art(id, cvArt.TILE);
      const lab = mk(d, 'span', 'cv-glabel');
      g.append(pic, lab);
      (o.layer || d.body).appendChild(g);
      return { el: g, lab };
    };
    const place = (x, y) => {
      if (!G || !G.ghost) return;
      const gl = G.ghost.el, touch = G.type === 'touch';
      const W = 104, H = 72; // (the tile drawing + its label: fixed, no layout read)
      const left = touch ? Math.round(x - W / 2) : Math.round(x + 14), top = touch ? Math.round(y - GHOST_LIFT - H) : Math.round(y + 10);
      gl.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, top)}px)`;
    };
    const update = i => {
      const over = overOf(i.target, i.x, i.y);
      if (over !== G.over) { G.over = over; G.at = i.t; }
      i.over = over;
      if (!G.left && o.tray) {
        const r = G.trayR;
        if (r && (i.x < r.left || i.x > r.right || i.y < r.top || i.y > r.bottom)) { G.left = true; if (o.onLeave) o.onLeave(); }
      }
      i.left = G.left || !o.tray; // (the pointer has left the tray: from then on the canvas may edge-pan for it)
      if (G.ghost) {
        const hide = over === 'canvas' && !!(o.canvasGhost && o.canvasGhost());
        G.ghost.el.classList.toggle('off', hide);
        G.ghost.el.classList.toggle('drop', !!over);
        const L = labelOf(id, over);
        if (G.ghost.lab.textContent !== L) G.ghost.lab.textContent = L;
        place(i.x, i.y);
      }
      return i;
    };
    const done = () => { if (G && G.ghost) G.ghost.el.remove(); b.classList.remove('lift'); G = null; };
    const ds = wk.dragSource(b, {
      data: id,
      scrollAxis: 'y',
      autoScroll: false,
      begin: i => {
        G = { type: i.pointerType, over: null, at: i.t, left: false, trayR: o.tray ? rectOf(o.tray) : null, ghost: null };
        G.ghost = mkGhost(i.pointerType);
        b.classList.add('lift');
        update(i);
        if (o.drag.begin) o.drag.begin(id, i);
      },
      move: i => { if (!G) return; update(i); if (o.drag.move) o.drag.move(id, i); },
      drop: i => {
        if (!G) return;
        update(i);
        // a quick touch drag (a flick from the tray) counts only on a zone it rested on
        const ok = !!i.over && !(i.quick && i.pointerType === 'touch' && i.t - G.at < SETTLE_MS);
        if (!ok) i.over = null;
        done();
        if (!(ok && o.drag.drop(id, i)) && o.drag.cancel) o.drag.cancel(id, i); // (nothing done: the consumer tidies up)
      },
      cancel: i => { if (!G) return; i.over = null; done(); if (o.drag.cancel) o.drag.cancel(id, i); },
    });
    return () => { ds.destroy(); done(); };
  }
  return {
    setCurrent(id) {
      cur = id;
      for (const [k, b] of tiles) {
        b.classList.toggle('on', k === id);
        if (k === id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      }
    },
    setMode(m) { mode = m === 'track' ? 'track' : 'replace'; el.setAttribute('data-mode', mode); },
    mode: () => mode,
    current: () => cur,
    tiles: () => [...tiles.values()],
    destroy() { for (const f of offs) f(); offs.length = 0; },
  };
}

/** A button + popover pair (≡ app menu, ⚙ settings, the transport's ⋯): aria-expanded, Escape (the caller's chain) /
 * a press outside closes, focus returns to the button; o.pick (default true): a press on a button or menu item inside
 * closes it after its action. o.attr: toggle that attribute (e.g. 'data-open': a group shown in place on a wide screen and
 * as a popover on a narrow one) instead of `hidden`.
 * @param {HTMLElement} btn @param {HTMLElement} pop
 * @param {{onOpen?: Function, onClose?: Function, pick?: boolean, attr?: string, doc?: Document}} [o]
 * @returns {{open: () => void, close: () => boolean, toggle: () => void, isOpen: () => boolean, destroy: () => void}} close() → was it open */
export function menuPop(btn, pop, o = {}) {
  const d = docOf(o, btn), attr = o.attr || null;
  let open = false, offs = [];
  btn.setAttribute('aria-expanded', 'false');
  if (pop.id) btn.setAttribute('aria-controls', pop.id);
  if (!attr) pop.hidden = true;
  const show = on => { if (attr) { if (on) pop.setAttribute(attr, ''); else pop.removeAttribute(attr); } else pop.hidden = !on; };
  function setOpen(on, focusBack) {
    if (open === on) return;
    open = on;
    show(on);
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    btn.classList.toggle('on', on);
    for (const f of offs) f();
    offs = [];
    if (on) {
      if (d) offs.push(listen(d, 'pointerdown', e => { const t = e.target; if (!inside(pop, t) && !inside(btn, t)) setOpen(false, false); }, true));
      offs.push(listen(pop, 'keydown', e => { if (e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); setOpen(false, true); } }));
      keepIn();
      if (typeof o.onOpen === 'function') o.onOpen();
    } else {
      if (focusBack && btn.focus) btn.focus();
      if (typeof o.onClose === 'function') o.onClose();
    }
  }
  // a popover wider than the room right of its button shifts left (one layout read, at open). One the stylesheet makes
  // position: fixed (a row that scrolls sideways, style.css ≤ 600 px: no scroller may clip it) goes under its button,
  // inside the viewport
  function keepIn() {
    const s = pop.style;
    if (s) { s.translate = ''; s.top = ''; s.left = ''; }
    const win = d && d.defaultView, vw = win && win.innerWidth > 0 ? win.innerWidth : 0;
    let fixed = false;
    try { fixed = !!(s && win && typeof win.getComputedStyle === 'function' && win.getComputedStyle(pop).position === 'fixed'); } catch { fixed = false; }
    const r = rectOf(pop);
    if (fixed) {
      const b = rectOf(btn);
      if (b && r) { s.top = Math.round(b.bottom + 8) + 'px'; s.left = Math.round(Math.max(8, Math.min(b.left, (vw || b.right + r.width) - 8 - r.width))) + 'px'; }
      return;
    }
    if (r && vw && r.right > vw - 8 && s) s.translate = Math.round(Math.max(8 - r.left, vw - 8 - r.right)) + 'px 0';
  }
  // a menu (role=menu): the arrow keys / Home / End move between its items; opened from the keyboard, the first has focus
  const items = () => { try { return Array.from(pop.querySelectorAll('button, [role="menuitem"]')).filter(b => !b.disabled && !b.hidden); } catch { return []; } };
  const isMenu = () => pop.getAttribute('role') === 'menu';
  const own = [
    listen(btn, 'click', e => { setOpen(!open, false); if (open && e && e.detail === 0 && isMenu()) { const L = items(); if (L[0] && L[0].focus) L[0].focus(); } }),
    listen(pop, 'keydown', e => {
      if (!open || !isMenu() || !/^(ArrowDown|ArrowUp|Home|End)$/.test(e.key)) return;
      const L = items(), d = docOf(o, pop), i = L.indexOf(d && d.activeElement);
      if (!L.length) return;
      const k = e.key === 'Home' ? 0 : e.key === 'End' ? L.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + L.length) % L.length;
      if (e.preventDefault) e.preventDefault();
      if (L[k].focus) L[k].focus();
    }),
    listen(pop, 'click', e => {
      if (o.pick === false || !open) return;
      const b = upTo(e.target, pop, n => n.tagName === 'BUTTON' || n.getAttribute('role') === 'menuitem');
      if (b && inside(pop, b) && !b.disabled && !b.getAttribute('aria-haspopup')) setOpen(false, false);
    }),
  ];
  return {
    open: () => setOpen(true, false),
    close: () => { if (!open) return false; setOpen(false, true); return true; },
    toggle: () => setOpen(!open, false),
    isOpen: () => open,
    destroy() { for (const f of own) f(); for (const f of offs) f(); offs = []; },
  };
}

/** A sheet in #ov (role=dialog, ✕ / Escape / the backdrop close it, focus restored): Help & about, the instrument's About …
 * @param {{title: string, body: Node, layer?: HTMLElement, onClose?: () => void, wide?: boolean, doc?: Document}} o
 * @returns {{el: HTMLElement, body: HTMLElement, close: () => void, isOpen: () => boolean}} */
export function sheet(o) {
  const d = docOf(o, o.layer), layer = o.layer || d.body;
  const prev = d.activeElement || null;
  const bd = mk(d, 'div', 'cv-sheet-bd');
  const box = mk(d, 'div', 'cv-sheet' + (o.wide ? ' wide' : ''));
  const hid = 'cvsh' + (++sheetN);
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', hid);
  box.tabIndex = -1;
  const head = mk(d, 'div', 'cv-sheet-h'), h2 = mk(d, 'h2', null, o.title || '');
  h2.id = hid;
  const x = mk(d, 'button', 'cv-x', '✕');
  x.type = 'button';
  x.setAttribute('aria-label', 'Close');
  x.title = 'Close (Esc)';
  head.append(h2, x);
  const body = mk(d, 'div', 'cv-sheet-b');
  if (o.body) body.appendChild(o.body);
  box.append(head, body);
  bd.appendChild(box);
  layer.appendChild(bd);
  let open = true, bp = null;
  const offs = [
    listen(x, 'click', () => close()),
    listen(box, 'keydown', e => { if (e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); close(); } }),
    // the backdrop: a mouse at the press, a finger on its tap's release (a scroll or pinch starting there closes nothing)
    listen(bd, 'pointerdown', e => { bp = e.target === bd ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.pointerType } : null; if (bp && bp.t !== 'touch') close(); }),
    listen(bd, 'pointerup', e => { const P = bp; bp = null; if (P && P.t === 'touch' && e.target === bd && Math.hypot(e.clientX - P.x, e.clientY - P.y) <= 10) close(); }),
  ];
  try { x.focus({ preventScroll: true }); } catch { /* no focus */ }
  function close() {
    if (!open) return;
    open = false;
    for (const f of offs) f();
    bd.remove();
    if (typeof o.onClose === 'function') o.onClose();
    try { if (prev && prev.focus && prev !== d.body) prev.focus({ preventScroll: true }); } catch { /* gone */ }
  }
  return { el: box, body, close, isOpen: () => open };
}
let sheetN = 0;

/** A context menu at (x, y) (wk.contextMenu; items {label, action?, sub?, checked?, disabled?, sep?}). */
export function popupMenu(x, y, items, opts) { return wk.contextMenu(x, y, items, opts); }
/** Long-press / ContextMenu key → a `contextmenu` event on el (wk.menuSource). @returns {() => void} remover */
export function menuSource(el, opts) { return wk.menuSource(el, opts); }
