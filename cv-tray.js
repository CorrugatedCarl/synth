// cv-tray.js — the shell's trays (SPEC-canvas §2.1–§2.4, §3 drag-in; contract: docs/canvas/IMPL-1b.md §4.6): the one
// height budget of the top tray and the keyboard tray, the grip helper both use (lifted from main.js initKbView), the side
// trays (Sources left, Effects right; opened by a tap on their rail, never an edge swipe), the Sources tray's tiles and
// their drag-out, the ≡ / ⚙ popovers and the sheets in #ov. Owner: SHELL lane. Stage 1e (IMPL-1e §4.3): the Effects
// tray's tiles (effectsTray: the empty FX panel + the effect types, their cost; the same drag-out as a Sources tile).
// Stage 2a (IMPL-2a §3): the Sources tray's Modulators section (sourcesTray o.mods: Mod Wheel, Velocity, Aftertouch, Bend;
// setPlaced greys a singleton that is already there). Milestone 3 (IMPL-3 §2.6): the Serum view's Serum parts (OSC, SUB,
// NOISE, FILTER, MACROS) and Note tools (ARP, CLIP) tiles (sourcesTray o.parts: PART_TILES; the drops are the host's).
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
 * the screen edge), closes only on its rail, its ✕ and Escape (the caller's chain) — never by itself: not on a press
 * outside it (a tap on the canvas keeps it open), a tile's tap, a drag leaving it or a drop (the user's rule).
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
  // (1e, U15) the stage (the tray's parent) knows it too — class cv-<side>-open, --cv-<side>-w: the canvas toolbar moves
  // past the open tray (style.css)
  const host = () => (el.parentNode && el.parentNode.classList ? el.parentNode : null);
  const applyW = () => {
    if (el.style && el.style.setProperty) el.style.setProperty('--cv-side-w', w + 'px');
    const H = host();
    if (H && H.style && H.style.setProperty) H.style.setProperty('--cv-' + side + '-w', w + 'px');
  };
  function setOpen(on, persist = true) {
    if (open === on) return;
    open = on;
    el.classList.toggle('open', on);
    if (host()) host().classList.toggle('cv-' + side + '-open', on);
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
 * o.tray (a notice only: main.js leaves the tray open — the canvas beside it takes the drop).
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
 *   tiles: () => HTMLElement[], setView: (v: string) => void, view: () => string, setLayout: (l: 'hw' | 'flow') => void,
 *   layout: () => 'hw' | 'flow', closeView: () => boolean, destroy: () => void}}
 */
// (stage 1c →2026-10-19) the tray's views: o.views (default SRC_VIEWS), an ordered list {id, label, tip, layout?, note?,
// sections}; a dropdown picks one (o.viewBtn: the button showing the view, aria-haspopup menu; o.viewMenu: a .cv-pop
// role=menu of menuitemradio buttons — both made in o.layoutEl when not given; menuPop: a press outside, Escape, a pick
// close it; ↑ / ↓ on the button open it on the current view). o.view (or o.layout): the starting view; o.onView(v) (or
// o.onLayout): the user switched. A section is {id, models: m => bool} (the synth tiles it shows: all in el, in o.models
// order), {id: 'mods'} (the Modulators section below) or {id, head, note} (a heading and a one-line note — a placeholder,
// made in o.secEl after the Modulators); a tile or section outside the view gets `hidden`. A view's layout ('hw' | 'flow')
// is the classic synths': 'flow' (Simple) marks every classic tile SIMPLE, a tap or drop creates the synth in its Simple
// layout (the caller's: lay.i1.ui = 'flow'); a view without one keeps the last (layout()); Serum has no hardware panel.
// o.noteEl gets the view's note. A new family (drum machines, pad controllers) is a new entry, not a new tray.
// (7a, IMPL-7a §8) Drums: the drum machines (family 'drums') with their real front panel — never in Hardware / Simple, no
// SIMPLE badge, no Simple layout (the view's layout is 'hw'); a drum tile names no maker (D4) and says its sounds are our
// model of the circuits.
// (2a, IMPL-2a §3) o.mods: [{id: 'wheel' | 'velo' | 'at' | 'bend', name, scope?: 'project' | 'track'}] — the Modulators
// section: one button.cv-tile.cv-mtile[data-mod] per item (an original monochrome glyph, the name, span.cv-treason) in
// o.modsEl (its section o.modsSec shown in a view with 'mods'; without modsEl: an h3.cv-tgrp "Modulators" and the tiles
// after the synths in el). A tap: (o.modPick || o.pick)(id, mode); a drag as a synth tile's through (o.modDrag || o.drag)
// with info.mod = true, info.over 'canvas' or null (never 'tracks') and info.at the point (o.toWorld(x, y): world px; else
// client px); its ghost hides over the canvas only while o.modCanvasGhost() says the world draws an outline for it.
// setPlaced(id, reason | null): the tile greys out (aria-disabled, .cv-placed) with the reason ("already on this
// track" / "already in this project"); a placed tile neither picks nor drags. modTiles() / modTile(id). (2b) an item with
// multi: true (LFO, ENV, Macro, CC, Chaos — MOD_TILES) carries data-multi and ignores setPlaced.
// (milestone 3, IMPL-3 §2.6) o.parts: [{id, name, group: 'parts' | 'notes'}] (PART_TILES: OSC, SUB, NOISE, FILTER, MACROS —
// "Serum parts" —, ARP, CLIP — "Note tools") — one button.cv-tile.cv-ptile[data-part][data-group] each (an original glyph,
// the name, span.cv-treason) in o.partsEl / o.notesEl (their sections o.partsSec / o.notesSec shown in a view with that
// section; without the elements: a section of their own in o.secEl, in place of the placeholder). A tap: (o.partPick ||
// o.pick)(id, mode); a drag as a modulator tile's through (o.partDrag || o.drag) with info.part = true, info.over 'canvas' or
// null, info.at the world point; the ghost hides over the canvas while o.partCanvasGhost() says the world draws an outline.
// setPartPlaced(id, reason | null) greys a tile with its reason (the host's: "This Serum already has 3 oscillators"); the
// drop's own refusals are the host's (§2.6). Without o.parts the two sections stay placeholders.
const CLASSIC = m => !m.custom && m.family !== 'drums', DRUMS = m => m.family === 'drums', TO_SERUM = 'Serum and its modulators: the Serum view (the menu above).';
export const SRC_VIEWS = [
  { id: 'hw', label: 'Hardware', tip: 'The classic synths with their real front panel', layout: 'hw', note: TO_SERUM, sections: [{ id: 'synths', models: CLASSIC }] },
  { id: 'flow', label: 'Simple', tip: 'The classic synths with the simple panel', layout: 'flow', note: TO_SERUM, sections: [{ id: 'synths', models: CLASSIC }] },
  { id: 'serum', label: 'Serum', tip: 'Serum and the modules made for it', note: 'Drop a modulator on the canvas and cable its jack to any knob.',
    sections: [{ id: 'serum', models: m => !!m.custom }, { id: 'mods' }, { id: 'parts', head: 'Serum parts', note: 'Arrive in milestone 3.' },
      { id: 'notes', head: 'Note tools', note: 'Note tools: later.' }] },
  { id: 'drums', label: 'Drums', tip: 'Drum machines with their real front panel', layout: 'hw',
    note: 'More machines later: TR-606, TR-909, then the Simmons SDS-V with the pad controller.', sections: [{ id: 'drums', models: DRUMS }] },
];
/** (milestone 3, §2.6) The Serum parts and note tools tiles (id = the part kind sx-edges firstFree takes). */
export const PART_TILES = Object.freeze([
  { id: 'osc', name: 'OSC', group: 'parts' }, { id: 'sub', name: 'SUB', group: 'parts' }, { id: 'noise', name: 'NOISE', group: 'parts' },
  { id: 'filter', name: 'FILTER', group: 'parts' }, { id: 'macros', name: 'MACROS', group: 'parts' },
  { id: 'arp', name: 'ARP', group: 'notes' }, { id: 'clip', name: 'CLIP', group: 'notes' },
].map(Object.freeze));
// original monochrome glyphs: a wave in a frame, a low sine, a scatter, a low-pass slope, four dials, rising steps, a clip of notes
const PART_GLYPH = {
  osc: '<svg viewBox="0 0 40 28" aria-hidden="true"><rect x="4.5" y="3.5" width="31" height="21" rx="3"/><path d="M8 14c3-7 6-7 8 0s5 7 8 0 5-7 8 0"/></svg>',
  sub: '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M4 14c6-11 10-11 16 0s10 11 16 0"/><path d="M4 24.5h32"/></svg>',
  noise: '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M4 15l3-6 2 11 3-14 2 12 3-8 2 9 3-12 2 13 3-9 2 7 3-10 2 6 2-2"/></svg>',
  filter: '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M4 9h17c4 0 5-3 7-3 2 0 3 6 8 18"/><path d="M4 24.5h32"/></svg>',
  macros: '<svg viewBox="0 0 40 28" aria-hidden="true"><rect x="5" y="4" width="13" height="9" rx="2"/><rect x="22" y="4" width="13" height="9" rx="2"/><rect x="5" y="16" width="13" height="9" rx="2"/><rect x="22" y="16" width="13" height="9" rx="2"/></svg>',
  arp: '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M5 23h6v-5h6v-5h6v-5h6v-5h6"/><circle cx="8" cy="23" r="1.6"/><circle cx="14" cy="18" r="1.6"/><circle cx="20" cy="13" r="1.6"/><circle cx="26" cy="8" r="1.6"/></svg>',
  clip: '<svg viewBox="0 0 40 28" aria-hidden="true"><rect x="4.5" y="3.5" width="31" height="21" rx="2"/><path d="M9 9h7M19 14h9M12 19h6M24 9h6"/></svg>',
};
const partGlyph = id => PART_GLYPH[id] || PART_GLYPH.osc;
/** (2b, IMPL-2b §1.1 / §6.1) The Modulators section's tiles, in MOD_ORDER: id = the mod kind, scope 'project' (the wheel)
 * or 'track', multi = any number per track (its tile never greys out: setPlaced ignores it). The host passes them as
 * o.mods (with its own names if it likes). */
export const MOD_TILES = Object.freeze([
  { id: 'wheel', name: 'Mod Wheel', scope: 'project' }, { id: 'velo', name: 'Velocity', scope: 'track' },
  { id: 'at', name: 'Aftertouch', scope: 'track' }, { id: 'bend', name: 'Bend', scope: 'track' }, { id: 'note', name: 'Note', scope: 'track' },
  { id: 'lfo', name: 'LFO', scope: 'track', multi: true }, { id: 'env', name: 'ENV', scope: 'track', multi: true },
  { id: 'macro', name: 'Macro', scope: 'track', multi: true }, { id: 'cc', name: 'CC', scope: 'track', multi: true },
  { id: 'chaos', name: 'Chaos', scope: 'track', multi: true },
].map(Object.freeze));
// original monochrome glyphs (stroked with currentColor): a wheel, velocity bars, an aftertouch pad, a bend curve, (2b) a
// sine with a point, an ADSR, four macro dials, a CC fader, a scribble, a key
const MOD_GLYPH = {
  wheel: '<svg viewBox="0 0 40 28" aria-hidden="true"><rect x="14" y="2.5" width="12" height="23" rx="3"/><path d="M15.5 9.5h9M15.5 12h9M15.5 14.5h9"/></svg>',
  velo: '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M5 24.5h30"/><path d="M8 24.5v-4M14 24.5v-8M20 24.5v-12M26 24.5v-16M32 24.5v-20"/></svg>',
  at: '<svg viewBox="0 0 40 28" aria-hidden="true"><rect x="7" y="13.5" width="26" height="11" rx="2"/><path d="M20 3.5v7M16.5 7.5 20 11l3.5-3.5"/></svg>',
  bend: '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M4 14h8c4 0 5-9 8-9s4 18 8 18 4-9 8-9"/></svg>',
  lfo: '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M4 14c4-9 8-9 12 0s8 9 12 0 6-7 8-4"/><circle cx="20" cy="14" r="2"/></svg>',
  env: '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M4 24.5 10 4l5 10h8l3 4h4l4 6.5"/><path d="M4 24.5h32"/></svg>',
  macro: '<svg viewBox="0 0 40 28" aria-hidden="true"><circle cx="11" cy="9" r="5"/><circle cx="29" cy="9" r="5"/><circle cx="11" cy="21" r="5"/><circle cx="29" cy="21" r="5"/><path d="M11 9v-3.5M29 9l2.5-2.5M11 21l-2.5 2.5M29 21h3.5"/></svg>',
  cc: '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M8 4v20M20 4v20M32 4v20"/><rect x="4" y="15" width="8" height="4" rx="1"/><rect x="16" y="7" width="8" height="4" rx="1"/><rect x="28" y="11" width="8" height="4" rx="1"/></svg>',
  chaos: '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M4 16c3-10 5 4 8-4s4 14 7 2 4-10 7 0 3 12 6-2 3-8 4-4"/></svg>',
  note: '<svg viewBox="0 0 40 28" aria-hidden="true"><rect x="6" y="3.5" width="28" height="21" rx="2"/><path d="M13 3.5v21M20 3.5v21M27 3.5v21"/><path d="M11 3.5v12h4v-12M18 3.5v12h4v-12M25 3.5v12h4v-12"/></svg>',
};
const modGlyph = id => MOD_GLYPH[id] || '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M4 14c4-8 8-8 12 0s8 8 12 0 6-6 8-3"/></svg>';
export function sourcesTray(el, o) {
  const d = docOf(o, el);
  const VIEWS = Array.isArray(o.views) && o.views.length ? o.views : SRC_VIEWS, viewOf = v => VIEWS.find(V => V.id === v) || VIEWS[0];
  let mode = 'replace', cur = null, lay = 'hw', view = viewOf(o.view || o.layout).id;
  const tiles = new Map(), offs = [];
  const labelOf = (id, over) => (o.label ? o.label(id, over) : over === 'tracks' ? '+ New track' : '');
  for (const m of o.models) {
    const meta = cvArt.tileMeta(m.id);
    const b = mk(d, 'button', 'cv-tile');
    b.type = 'button';
    b.setAttribute('data-model', m.id);
    const dr = DRUMS(m); // ((7a) a drum machine: no maker name on its tile, D4)
    b.title = dr ? `${meta.label} (${meta.year}) — our model of its circuits, not recordings — tap to use it, or drag it onto the canvas or the track list`
      : `${meta.label} (${meta.year} · ${meta.maker}) — tap to use it, or drag it onto the canvas or the track list`;
    const pic = mk(d, 'span', 'cv-tart');
    pic.setAttribute('aria-hidden', 'true');
    pic.innerHTML = cvArt.art(m.id, cvArt.TILE);
    const nm = mk(d, 'span', 'cv-tname', meta.label), mt = mk(d, 'span', 'cv-tmeta', dr ? `${meta.year} · drum machine` : `${meta.year} · ${meta.maker}`);
    b.append(pic, nm, mt);
    if (CLASSIC(m)) { const bd = mk(d, 'span', 'cv-tbadge', 'SIMPLE'); bd.setAttribute('aria-hidden', 'true'); b.append(bd); } // (shown in Simple: CSS)
    offs.push(listen(b, 'click', e => { if (e && e.defaultPrevented) return; o.pick(m.id, mode); }));
    offs.push(tileDrag(d, o, b, m.id, { pic: () => cvArt.art(m.id, cvArt.TILE), label: over => labelOf(m.id, over) }));
    el.appendChild(b);
    tiles.set(m.id, b);
  }
  // (2a) the Modulators section
  const mtiles = new Map(), placed = new Map();
  let mhead = null;
  if (Array.isArray(o.mods) && o.mods.length) {
    const box = o.modsEl || el;
    if (!o.modsEl) { const hd = mk(d, 'h3', 'cv-tgrp cv-mhead', 'Modulators'); el.appendChild(hd); mhead = hd; offs.push(() => hd.remove()); }
    const pick = o.modPick || o.pick, drag = o.modDrag || o.drag || {};
    const at = i => { if (o.toWorld) { try { const p = o.toWorld(i.x, i.y); if (p && isFinite(p.x) && isFinite(p.y)) return { x: p.x, y: p.y }; } catch { /* no world */ } } return { x: i.x, y: i.y }; };
    for (const m of o.mods) {
      const id = m && typeof m.id === 'string' ? m.id : null;
      if (!id || mtiles.has(id)) continue;
      const name = String(m.name || id), b = mk(d, 'button', 'cv-tile cv-mtile');
      b.type = 'button';
      b.setAttribute('data-mod', id);
      if (m.scope) b.setAttribute('data-scope', m.scope);
      if (m.multi) b.setAttribute('data-multi', ''); // ((2b) any number per track: never placed)
      const tip = `${name} — tap to add${m.multi ? ' one' : ' it'}${m.scope === 'project' ? ' (one for the whole project)' : ''}, or drag it onto the canvas`;
      b.title = tip;
      const pic = mk(d, 'span', 'cv-mglyph');
      pic.setAttribute('aria-hidden', 'true');
      pic.innerHTML = modGlyph(id);
      const nm = mk(d, 'span', 'cv-tname', name), rs = mk(d, 'span', 'cv-treason');
      rs.hidden = true;
      b.append(pic, nm, rs);
      const off = () => placed.has(id);
      offs.push(listen(b, 'click', e => { if ((e && e.defaultPrevented) || off()) return; pick(id, mode); }));
      const dd = { begin: (x, i) => { i.mod = true; if (drag.begin) drag.begin(x, i); }, move: (x, i) => { i.mod = true; if (drag.move) drag.move(x, i); },
        drop: (x, i) => { i.mod = true; return !!drag.drop && drag.drop(x, i); }, cancel: (x, i) => { i.mod = true; if (drag.cancel) drag.cancel(x, i); } };
      offs.push(tileDrag(d, Object.assign({}, o, { drag: dd, canvasGhost: o.modCanvasGhost }), b, id, { pic: () => modGlyph(id), picCls: 'cv-mglyph', cls: 'cv-mghost', off,
        norm: r => ({ over: (r && typeof r === 'object' ? r.over : r) === 'canvas' ? 'canvas' : null, key: null, near: null }), at,
        label: over => (over === 'canvas' ? '+ Add ' + name : '') }));
      box.appendChild(b);
      mtiles.set(id, { b, rs, tip, name, multi: !!m.multi });
      offs.push(() => b.remove());
    }
  }
  // (milestone 3) the Serum parts and note tools: a section per group (the host's elements, else made in o.secEl / el)
  const ptiles = new Map(), pplaced = new Map(), pbox = new Map(); // id → {b, rs, tip, name, group}; group → {sec, box, head}
  const PT = Array.isArray(o.parts) ? o.parts : o.parts === true ? PART_TILES : null;
  if (PT) {
    const pick = o.partPick || o.pick, drag = o.partDrag || o.drag || {};
    const at = i => { if (o.toWorld) { try { const p = o.toWorld(i.x, i.y); if (p && isFinite(p.x) && isFinite(p.y)) return { x: p.x, y: p.y }; } catch { /* no world */ } } return { x: i.x, y: i.y }; };
    const HEAD = { parts: 'Serum parts', notes: 'Note tools' };
    const boxOf = g => {
      let B = pbox.get(g);
      if (B) return B;
      const own = g === 'notes' ? o.notesEl : o.partsEl;
      if (own) B = { sec: (g === 'notes' ? o.notesSec : o.partsSec) || null, box: own, head: null };
      else if (o.secEl) {
        const sec = mk(d, 'section', 'cv-tsec cv-psec'), box = mk(d, 'div', 'cv-tiles cv-ptiles');
        sec.setAttribute('data-sec', g); sec.setAttribute('aria-label', HEAD[g] || g);
        sec.append(mk(d, 'h3', 'cv-tgrp', HEAD[g] || g), box);
        o.secEl.appendChild(sec);
        offs.push(() => sec.remove());
        B = { sec, box, head: null };
      } else { const hd = mk(d, 'h3', 'cv-tgrp cv-phead', HEAD[g] || g); el.appendChild(hd); offs.push(() => hd.remove()); B = { sec: null, box: el, head: hd }; }
      pbox.set(g, B);
      return B;
    };
    for (const m of PT) {
      const id = m && typeof m.id === 'string' ? m.id : null;
      if (!id || ptiles.has(id)) continue;
      const g = m.group === 'notes' ? 'notes' : 'parts', name = String(m.name || id), b = mk(d, 'button', 'cv-tile cv-ptile');
      b.type = 'button';
      b.setAttribute('data-part', id); b.setAttribute('data-group', g);
      const tip = `${name} — tap to add it to this track's Serum, or drag it onto the canvas`;
      b.title = tip;
      const pic = mk(d, 'span', 'cv-mglyph');
      pic.setAttribute('aria-hidden', 'true');
      pic.innerHTML = partGlyph(id);
      const nm = mk(d, 'span', 'cv-tname', name), rs = mk(d, 'span', 'cv-treason');
      rs.hidden = true;
      b.append(pic, nm, rs);
      const off = () => pplaced.has(id);
      offs.push(listen(b, 'click', e => { if ((e && e.defaultPrevented) || off()) return; pick(id, mode); }));
      const dd = { begin: (x, i) => { i.part = true; if (drag.begin) drag.begin(x, i); }, move: (x, i) => { i.part = true; if (drag.move) drag.move(x, i); },
        drop: (x, i) => { i.part = true; return !!drag.drop && drag.drop(x, i); }, cancel: (x, i) => { i.part = true; if (drag.cancel) drag.cancel(x, i); } };
      offs.push(tileDrag(d, Object.assign({}, o, { drag: dd, canvasGhost: o.partCanvasGhost }), b, id, { pic: () => partGlyph(id), picCls: 'cv-mglyph', cls: 'cv-mghost', off,
        norm: r => ({ over: (r && typeof r === 'object' ? r.over : r) === 'canvas' ? 'canvas' : null, key: null, near: null }), at,
        label: over => (over === 'canvas' ? '+ Add ' + name : '') }));
      boxOf(g).box.appendChild(b);
      ptiles.set(id, { b, rs, tip, name, group: g });
      offs.push(() => b.remove());
    }
  }
  // the placeholder sections (a heading, a one-line note), once each, in o.secEl after the Modulators ((3) not for a group
  // the parts tiles fill)
  const secs = new Map();
  for (const V of VIEWS) for (const S of V.sections || []) {
    if (!o.secEl || !S || S.models || S.id === 'mods' || !S.head || secs.has(S.id) || pbox.has(S.id)) continue;
    const sec = mk(d, 'section', 'cv-tsec cv-tsoon');
    sec.setAttribute('data-sec', S.id); sec.setAttribute('aria-label', S.head);
    sec.append(mk(d, 'h3', 'cv-tgrp', S.head), mk(d, 'p', 'cv-tnote', S.note || ''));
    o.secEl.appendChild(sec);
    secs.set(S.id, sec);
    offs.push(() => sec.remove());
  }
  // the view dropdown: a button showing the view, a menu of the views (menuPop)
  const host = o.layoutEl || null, vitems = new Map();
  let vbtn = o.viewBtn || null, vmenu = o.viewMenu || null, vpop = null;
  if (!vbtn && host) { const b = vbtn = host.appendChild(mk(d, 'button', 'cv-vbtn')); offs.push(() => b.remove()); }
  if (vbtn && !vmenu && host) { const m = vmenu = host.appendChild(mk(d, 'div', 'cv-pop cv-menupop cv-vmenu')); offs.push(() => m.remove()); }
  if (vbtn && vmenu) {
    vbtn.type = 'button';
    vbtn.setAttribute('aria-haspopup', 'menu');
    vmenu.setAttribute('role', 'menu');
    vmenu.setAttribute('aria-label', 'Sources view');
    if (!vbtn.children.length) { const c = mk(d, 'span', 'cv-vcaret', '▾'); c.setAttribute('aria-hidden', 'true'); vbtn.append(mk(d, 'span', 'cv-vlab'), c); }
    for (const V of VIEWS) {
      const b = mk(d, 'button', 'cv-vitem');
      b.type = 'button';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('data-view', V.id);
      b.append(mk(d, 'span', 'cv-vname', V.label), mk(d, 'span', 'cv-vtip', V.tip || ''));
      // the pick closes it (focus back on the button)
      offs.push(listen(b, 'click', () => {
        const was = view;
        setView(V.id);
        if (vpop) vpop.close();
        if (view !== was) { const f = o.onView || o.onLayout; if (f) f(view); }
      }), () => b.remove());
      vmenu.appendChild(b);
      vitems.set(V.id, b);
    }
    const P = vpop = menuPop(vbtn, vmenu, { doc: d });
    const focusCur = () => { const b = vitems.get(view); if (b && b.focus) b.focus(); };
    offs.push(listen(vbtn, 'click', e => { if (P.isOpen() && e && e.detail === 0) focusCur(); }), // (Enter / Space: on the current view)
      listen(vbtn, 'keydown', e => {
        const k = e.key;
        if (k === 'Escape' && P.isOpen()) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); P.close(); return; }
        if (k !== 'ArrowDown' && k !== 'ArrowUp') return;
        if (e.preventDefault) e.preventDefault();
        P.open(); focusCur();
      }), () => P.destroy());
  }
  function setView(v) {
    const V = viewOf(v), S = V.sections || [], has = id => S.some(x => x && x.id === id);
    view = V.id;
    if (V.layout) lay = V.layout === 'flow' ? 'flow' : 'hw';
    el.setAttribute('data-layout', lay);
    el.setAttribute('data-view', view);
    for (const m of o.models) {
      const b = tiles.get(m.id);
      if (!b) continue;
      b.hidden = !S.some(x => x && typeof x.models === 'function' && x.models(m));
      if (CLASSIC(m)) b.setAttribute('aria-description', lay === 'flow' ? 'simple panel' : 'hardware panel');
    }
    const mods = has('mods') && mtiles.size > 0;
    if (o.modsSec) o.modsSec.hidden = !mods;
    if (mhead) { mhead.hidden = !mods; for (const T of mtiles.values()) T.b.hidden = !mods; }
    for (const [id, sec] of secs) sec.hidden = !has(id);
    for (const [g, B] of pbox) { // ((3) the parts / note tools sections)
      const on = has(g);
      if (B.sec) B.sec.hidden = !on;
      if (B.head) B.head.hidden = !on;
      if (!B.sec) for (const T of ptiles.values()) if (T.group === g) T.b.hidden = !on;
    }
    if (vbtn) {
      const lab = vbtn.children[0];
      if (lab && lab.textContent !== V.label) lab.textContent = V.label;
      vbtn.setAttribute('aria-label', 'Sources view: ' + V.label);
      vbtn.setAttribute('data-view', view);
      vbtn.title = (V.tip || V.label) + ' — tap for the other views';
    }
    for (const [id, b] of vitems) b.setAttribute('aria-checked', String(id === view));
    if (o.noteEl) o.noteEl.textContent = V.note || '';
  }
  setView(view);
  function setPlaced(id, reason) {
    const T = mtiles.get(id);
    if (!T || T.multi) return; // ((2b) a multi-instance tile never greys out)
    const r = reason == null || reason === '' ? null : String(reason);
    if (r) placed.set(id, r); else placed.delete(id);
    T.b.classList.toggle('cv-placed', !!r);
    if (r) T.b.setAttribute('aria-disabled', 'true'); else T.b.removeAttribute('aria-disabled');
    T.rs.textContent = r || '';
    T.rs.hidden = !r;
    T.b.title = r ? T.name + ' — ' + r : T.tip;
  }
  return {
    /** the view (an o.views id: 'hw' | 'flow' | 'serum' | 'drums'; setView is a restore: no callback); the dropdown's close (→ was it open) */
    setView, view: () => view, views: () => VIEWS.map(V => V.id), closeView: () => !!vpop && vpop.close(), viewOpen: () => !!vpop && vpop.isOpen(),
    /** the classic synths' layout: setLayout('hw' | 'flow') = that view; layout() the last one (kept through Serum) */
    setLayout: l => setView(l === 'flow' ? 'flow' : 'hw'), layout: () => lay,
    /** (2a) the Modulators section's tiles; greying one out with its reason (null: available again) */
    modTiles: () => [...mtiles.values()].map(T => T.b), modTile: id => (mtiles.get(id) || {}).b || null,
    setPlaced, placed: id => placed.get(id) || null,
    /** (milestone 3) the Serum parts / note tools tiles; greying one out with its reason (null: available again) */
    partTiles: () => [...ptiles.values()].map(T => T.b), partTile: id => (ptiles.get(id) || {}).b || null,
    setPartPlaced(id, reason) {
      const T = ptiles.get(id);
      if (!T) return;
      const r = reason == null || reason === '' ? null : String(reason);
      if (r) pplaced.set(id, r); else pplaced.delete(id);
      T.b.classList.toggle('cv-placed', !!r);
      if (r) T.b.setAttribute('aria-disabled', 'true'); else T.b.removeAttribute('aria-disabled');
      T.rs.textContent = r || ''; T.rs.hidden = !r;
      T.b.title = r ? T.name + ' — ' + r : T.tip;
    },
    partPlaced: id => pplaced.get(id) || null,
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

// A tray tile's drag-out (the Sources and the Effects tray): wk.dragSource {scrollAxis: 'y', autoScroll: false} — out of the
// tray at once, along it a scroll, any way after a 250 ms hold; the ghost (T.pic() 40 px above a finger, beside a mouse)
// in o.layer, hidden over the canvas while o.canvasGhost() says the world draws the outline; info.over / info.left on every
// callback (T.norm(raw over) → {over, key} adds info.key; T.at(info) adds info.at); a quick touch drag drops only on a zone
// it rested on SETTLE_MS (a flick is a cancel); o.onLeave() once the pointer leaves o.tray (a notice: the tray stays open).
// Returns a remover.
function tileDrag(d, o, b, id, T) {
  let G = null;
  const overOf = (t, x, y) => { let r = null; try { r = o.overOf ? o.overOf(t, x, y) || null : null; } catch { r = null; } return T.norm ? T.norm(r) : { over: r }; };
  const mkGhost = type => {
    const g = mk(d, 'div', 'cv-tghost' + (type === 'touch' ? ' touch' : '') + (T.cls ? ' ' + T.cls : ''));
    const pic = mk(d, 'span', T.picCls || 'cv-tart');
    pic.innerHTML = T.pic();
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
    const R = overOf(i.target, i.x, i.y), over = R.over || null, key = R.key == null ? null : R.key;
    if (over !== G.over || key !== G.key) { G.over = over; G.key = key; G.at = i.t; }
    i.over = over;
    if (T.norm) { i.key = key; i.near = R.near == null ? null : R.near; }
    if (T.at) i.at = T.at(i);
    if (!G.left && o.tray) {
      const r = G.trayR;
      if (r && (i.x < r.left || i.x > r.right || i.y < r.top || i.y > r.bottom)) { G.left = true; if (o.onLeave) o.onLeave(); }
    }
    i.left = G.left || !o.tray; // (the pointer has left the tray: from then on the canvas may edge-pan for it)
    if (G.ghost) {
      const hide = over === 'canvas' && !!(o.canvasGhost && o.canvasGhost());
      G.ghost.el.classList.toggle('off', hide);
      G.ghost.el.classList.toggle('drop', !!over);
      const L = T.label(over, key);
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
      if (T.off && T.off()) return; // ((2a) a placed modulator tile: no drag)
      G = { type: i.pointerType, over: null, key: null, at: i.t, left: false, trayR: o.tray ? rectOf(o.tray) : null, ghost: null };
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

/** (1e) The Effects tray's panel tile id. */
export const FX_PANEL = 'panel';
// a tile's glyph: the empty panel a pedalboard outline, an effect its initials (original, no product art)
const PANEL_SVG = '<svg viewBox="0 0 40 28" aria-hidden="true"><rect x="2.5" y="4.5" width="35" height="19" rx="3"/><rect x="7" y="9" width="7" height="10" rx="1.5"/><rect x="16.5" y="9" width="7" height="10" rx="1.5"/><rect x="26" y="9" width="7" height="10" rx="1.5"/></svg>';
const initials = s => { const w = String(s || '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean); return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).replace(/^./, c => c.toUpperCase()); };
/**
 * (1e) The Effects tray's tiles (SPEC §2.4, §2.8; IMPL-1e §4.3), mirroring sourcesTray: the empty FX Panel tile first, then
 * one per effect type grouped as the rack's add menu (an h3.cv-tgrp before each group). o.items: [{id: 'panel'} | {id |
 * type: <effect type>, name | label, group}] (fx-ui addMenuItems gives the latter; disabled ones are skipped); o.cost(id) →
 * '~3 %' | '' on each tile (refresh() re-reads). Tiles: button.cv-tile.cv-ftile[data-fx]. A tap: o.pick(id). A drag (as a
 * Sources tile): every callback's info.over is 'canvas' | 'panel' | 'inst' | null and info.key the module's key, from
 * o.overOf(target, x, y) → 'canvas' | 'panel' | {over, key} | null (the panel tile over a panel or an instrument counts as
 * 'canvas' with info.near that module: a new panel beside it); info.at the point under the pointer (o.toWorld(x, y) when
 * given: world px; else client px);
 * drag.drop(id, info) → true when done (else drag.cancel). (1f) o.panel === false: no panel tile (nor a FX_PANEL item); an effect's
 * tile then says it goes into the track's effects. The tray never closes by itself — not as a drag leaves it, nor
 * on a drop (the user's rule, ROADMAP 2026-10-17 / 18: only its rail, ✕ or Escape): o.onLeave is a notice.
 * @param {HTMLElement} el  the tray panel's list container (#fxList)
 * @param {{
 *   items: Array<{id?: string, type?: string, name?: string, label?: string, group?: string, disabled?: boolean}>,
 *   pick: (id: string) => void,
 *   drag: {begin?: Function, move?: Function, drop: (id: string, info: {over: 'canvas' | 'panel' | 'inst', key?: string, near?: string, at: {x: number, y: number}}) => boolean, cancel?: Function},
 *   overOf?: (target: Element | null, x: number, y: number) => 'canvas' | 'panel' | {over: 'panel' | 'inst' | 'canvas', key?: string} | null,
 *   cost?: (id: string) => string, toWorld?: (x: number, y: number) => {x: number, y: number},
 *   canvasGhost?: () => boolean, tray?: HTMLElement, onLeave?: () => void, layer?: HTMLElement,
 *   label?: (id: string, over: string | null, key: string | null) => string, doc?: Document,
 * }} o
 * @returns {{tiles: () => HTMLElement[], tile: (id: string) => HTMLElement | null, refresh: () => void, destroy: () => void}}
 */
export function effectsTray(el, o) {
  const d = docOf(o, el), tiles = new Map(), costs = new Map(), offs = [], heads = [];
  const L0 = Array.isArray(o.items) ? o.items : [];
  const list = [];
  const P = o.panel !== false;
  if (P && !L0.some(it => it && (it.id || it.type) === FX_PANEL)) list.push({ id: FX_PANEL });
  for (const it of L0) { const id = it && (it.id || it.type); if (typeof id === 'string' && !it.disabled && !list.some(x => x.id === id) && (P || id !== FX_PANEL)) list.push(Object.assign({}, it, { id })); }
  const nameOf = it => (it.id === FX_PANEL ? it.name || it.label || 'FX Panel' : String(it.name || it.label || it.id));
  const groupOf = it => (it.id === FX_PANEL ? it.group || 'Panel' : String(it.group || 'Effects'));
  const costOf = id => { try { return o.cost ? String(o.cost(id) || '') : ''; } catch { return ''; } };
  const labelOf = (id, over, key) => {
    if (o.label) { try { return String(o.label(id, over, key) || ''); } catch { return ''; } }
    return over === 'panel' ? '+ Add to the panel' : over === 'inst' ? '+ Add to its effects' : over === 'canvas' ? (id === FX_PANEL ? '+ New FX panel' : P ? '+ New panel with it' : '+ Add to the track’s effects') : '';
  };
  // (U11) 'inst' (an instrument module: the effect goes into its FX) beside 'canvas' / 'panel'; the empty panel over a
  // module is a canvas drop beside that module (near), never into it
  const norm = id => r => {
    let over = r && typeof r === 'object' ? r.over || null : r || null, key = r && typeof r === 'object' && r.key != null ? String(r.key) : null, near = null;
    if (over !== 'canvas' && over !== 'panel' && over !== 'inst') over = null;
    if ((over === 'panel' || over === 'inst') && id === FX_PANEL) { over = 'canvas'; near = key; key = null; } // (an empty panel never goes into a module)
    if (over !== 'panel' && over !== 'inst') key = null;
    return { over, key, near };
  };
  const at = i => { if (o.toWorld) { try { const p = o.toWorld(i.x, i.y); if (p && isFinite(p.x) && isFinite(p.y)) return { x: p.x, y: p.y }; } catch { /* no world */ } } return { x: i.x, y: i.y }; };
  let grp = null;
  for (const it of list) {
    const g = groupOf(it), id = it.id, name = nameOf(it), panel = id === FX_PANEL;
    if (g !== grp) { grp = g; const hd = mk(d, 'h3', 'cv-tgrp', g); el.appendChild(hd); heads.push(hd); }
    const b = mk(d, 'button', 'cv-tile cv-ftile');
    b.type = 'button';
    b.setAttribute('data-fx', id);
    b.title = panel ? 'An empty FX panel — tap to add one, or drag it onto the canvas' : P ? `${name} — tap to add it, or drag it into an FX panel or onto the canvas (a new panel)` : `${name} — tap or drag it onto the canvas: it goes into the track’s effects`;
    const pic = mk(d, 'span', 'cv-fglyph' + (panel ? ' cv-fpanel' : ''));
    pic.setAttribute('aria-hidden', 'true');
    if (panel) pic.innerHTML = PANEL_SVG; else pic.textContent = initials(name);
    const nm = mk(d, 'span', 'cv-tname', panel ? 'Empty FX Panel' : name), cs = mk(d, 'span', 'cv-tcost');
    b.append(pic, nm, cs);
    costs.set(id, cs);
    offs.push(listen(b, 'click', e => { if (e && e.defaultPrevented) return; o.pick(id); }));
    offs.push(tileDrag(d, o, b, id, { pic: () => pic.innerHTML || '<b>' + initials(name) + '</b>', picCls: 'cv-fglyph' + (panel ? ' cv-fpanel' : ''), cls: 'cv-fghost',
      norm: norm(id), at, label: (over, key) => labelOf(id, over, key) }));
    el.appendChild(b);
    tiles.set(id, b);
  }
  function refresh() {
    for (const [id, cs] of costs) {
      const c = costOf(id);
      if (cs.textContent !== c) cs.textContent = c;
      cs.hidden = !c;
      cs.title = c ? 'Estimated DSP load on this device: ' + c : '';
    }
  }
  refresh();
  el.setAttribute('data-tray', 'fx');
  return {
    tiles: () => [...tiles.values()],
    tile: id => tiles.get(id) || null,
    refresh,
    destroy() { for (const f of offs) f(); offs.length = 0; for (const b of tiles.values()) b.remove(); for (const h of heads) h.remove(); tiles.clear(); },
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
