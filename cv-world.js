// cv-world.js — the canvas camera over a DOM world (SPEC-canvas §2.11, §4; contract: docs/canvas/IMPL-1b.md §4.1).
// Owner: WORLD lane. One CSS transform on one layer (#world): nothing reflows, the page's own zoom stays the browser's.
// Rules: plain ES module, no DOM / window access at module top level (node imports it: tests, tests/main-sim.mjs);
// every runtime path survives main-sim's DOM stub (no ResizeObserver, visualViewport, getComputedStyle, PointerEvent;
// querySelector() returning inert elements): optional browser APIs are guarded, the nodes it makes are kept by reference.
//
// Coordinates (IMPL-1b §3): client px = e.clientX/Y (layout viewport); local px = client − the viewport's rect origin
// (cached: measured on resize, never per frame); world px = canvas units before zoom. Camera { tx, ty, k }:
// local = world·k + t, world = (local − t) / k; #world carries transform: translate(tx px, ty px) scale(k) with
// transform-origin 0 0, and the CSS variable --ik = 1/k (written at zoom end only: hit areas, cable strokes).
//
// Frames: the camera is written once per animation frame (the gesture.js hooks write at once: they already run in its
// frame); a burst of moves — a gesture, a glide, an animation, wheel events up to 150 ms apart, a drag's edge pan — emits
// movestart once (kit popups close: wk.closeTransient), camera per written frame and cameraend at its end. During a
// burst there are no layout reads: #world gets will-change only then ([data-cv-busy]); at its end the translation rounds
// to device px and a zoom re-rasters (--ik, wk.setCanvasScale + rescaleCanvases).
// Stage 1g: the dot grid is one device-px canvas under #world (gridDraw); every dot on a whole device px of one origin (no
// flicker, the major dots never drift from the minor). Hotfix (2026-10-19, "still very laggy, even worse, with one synth"):
// each draw re-uploads the whole store to the GPU (≈ 30 MB a frame on an iPad Pro), so it is drawn only at rest (a burst's
// end, a write outside a burst, a resize / device-ratio change); during a burst it moves by a CSS transform (gridFollow).
// Hotfix 2 ("a noticeable hitch while zooming in and out fast past around 60 %"): never redrawn in a burst at all, whatever
// the scale (soft when zoomed in, tiny when out; a fast zoom out past GRID_REACH shows bare strips at the right / bottom
// until rest); the store is sized for that reach instead. A zoom burst also defers the on-screen plan to its end.
// Zoom consistency (IMPL-panels §8, the user's Z1): zooming never changes how a module looks — no cards, no level of
// detail, nothing hidden, unmounted or resized; modules simply scale with the camera. The world only tells each item
// whether it is on screen (planScreen over cached rects, after every written frame — a zoom burst's at its end: onScreen(on)
// + a 'screen' event), so off-screen live displays can pause invisibly; below READ_K a press inside a module body pans
// (its controls sleep).
// Milestone 3 (IMPL-3 §1.4 H5): every display canvas stores wk.storeDensity's dpr · k px per layout px at rest (≥ 1:1 on
// screen at every zoom; set at a zoom's rest, never in a burst) and Σ every store in #world, on and off screen, stays ≤
// wk.CANVAS_BUDGET (64 MB): at each rest planStores projects every canvas to the rule's density and, past the budget, caps
// the off-screen ones to the dpr first, then the on-screen ones farthest from the viewport centre (wk.setStoreCaps; the
// static owners repaint through rescaleCanvases only when a cap changed). An off-screen canvas a pan brings into view at
// k > 1 shows its dpr store until the next rest (1h's residual). world.canvasStats() → { n, bytes, minDensity, onMin, offN,
// capped, budget, k, dpr } (density: store px per on-screen device px, 1 = 1:1).
// Stage 1c: a selection of several items (Shift-click on a bar adds; ⌘/Ctrl-A; a marquee — Shift-drag on empty canvas
// with the mouse, a 250 ms hold then a drag with a finger — selects what it touches; a mouse drag still pans), the
// selected item that started a move carries the others (cv-module TrackView), and a minimap in the toolbar (item rects +
// the visible area from the cached rects; drag to pan, tap to centre; drawn only when the camera or the layout changes).
// Stage 1e: a press on a jack ([data-cv-jack]) is offered to hooks.jack(e, jackEl) (cv-cables createCableDrag) in the
// capture phase, before any pan, sleeping module or control: a truthy answer takes it (never a pan). A second touch while
// it runs cancels it (the answer's cancel(), else hooks.jackCancel) and the two fingers pinch the camera (two fingers win).
// Stage 1h (IMPL-1h §2): with WebGL2 the grid is a procedural shader on one GL canvas under #world (cv-gl createGL), drawn
// at every written frame, at rest, on resize / a device-ratio change and when the faces change (cv-face: textured quads
// over the same canvas): exact dot centres every frame, nothing rasterised at a zoom end. No 2D grid canvas then (no
// gridStore / gridFollow); `?nogl` or the pref synth.cv.gl = 'off' (and no WebGL2, or three context losses in a minute)
// keep the hotfix-2 2D grid exactly as it was. The world attaches FACES once the GL exists, detaches on loss / destroy.
import * as wk from './wk.js?v=9';
import { createGL } from './cv-gl.js?v=9';
import * as FACES from './cv-face.js?v=9';

/** Smallest / largest camera zoom. */
export const K_MIN = 0.25, K_MAX = 2;
/** READ_K: the smallest zoom a focus or a default camera lands on (a readability floor: nothing changes look there); below
 * it a press in a module body pans the camera unless the module is in edit state. At or above EDIT_K a selected module
 * is in edit state. */
export const READ_K = 0.5, EDIT_K = 0.9;
/** Fine step (world px): keyboard nudges. */
export const GRID = 8;
/** The visible grid (world px): its dots are every DOT, brighter ones every MAJOR; modules snap to DOT. */
export const DOT = 32, MAJOR = 128;
/** The snap-to-grid pref (appstore; stored as synthc.cv.snap): on unless switched off in the toolbar. */
export const SNAP_PREF = 'synth.cv.snap';
/** The on-screen margin around the viewport (screen px, converted with k): an item this close counts as on screen (its
 * live displays resume before they show). */
export const CULL_MARGIN = 256;
/** A touch landing while the camera glides, or within MOMENTUM_GUARD_MS after it stops, only stops the glide. */
export const MOMENTUM_GUARD_MS = 120;
/** The knob wheel veto window after a camera move (ms). */
export const WHEEL_VETO_MS = 300;
/** The DOM budget of the selected track (elements; SPEC §9.3): a soft one — past it the world emits 'budget' and warns
 * once per crossing; nothing visible changes (IMPL-panels §8.1). */
export const BUDGET_EL = 9000;
/** The pinch engages once the finger spread changed this much (physical px; as gesture.js PINCH_PX). */
export const PINCH_PX = 6;
/** Toolbar zoom steps (⊖ / ⊕ go to the next one). */
export const ZOOM_STEPS = Object.freeze([0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1, 1.25, 1.5, 2]);
/** The camera pinch-mode pref (appstore; stored as synthc.cv.pinch). */
export const PINCH_PREF = 'synth.cv.pinch';
/** The minimap pref (appstore; stored as synthc.cv.minimap): shown unless switched off in the toolbar. */
export const MAP_PREF = 'synth.cv.minimap';
/** The lock-view pref (appstore; stored as synthc.cv.lock): off unless switched on in the toolbar. While locked no
 * gesture on the canvas pans or zooms the camera (drags, two fingers, wheel / trackpad, momentum, Safari gesture*, the
 * 0 / 1 keys, double-tap fit / focus, focus reveal, a drag's edge pan); the minimap and the toolbar's zoom / fit buttons
 * still move it, and the app's own moves (a track switch's camera, a reveal after an add) still happen. */
export const LOCK_PREF = 'synth.cv.lock';
/** (2a) The mod-cable visibility pref (appstore; stored as synthc.cv.mods): the toolbar ∿ cycles Always (the default) →
 * On select → Never; each change emits 'mods' with the mode (the track view's setModsVisible). */
export const MODS_PREF = 'synth.cv.mods';
export const MODS_MODES = Object.freeze(['always', 'select', 'never']);
const MODS_LABEL = { always: 'Always', select: 'On select', never: 'Never' };
/** A finger held this long (ms) on empty canvas, then dragged, draws a marquee instead of panning (SPEC §4.1). */
export const MARQUEE_HOLD_MS = 250;
/** The minimap's size (CSS px). */
export const MAP_W = 176, MAP_H = 112;

// momentum: px/ms to start (0.12 = 120 px/s), cap, stop; decay time constant (ms: a gentle glide); camera animation (ms);
// a wheel / hook burst ends this long after its last event; taps: slop per pointer type, double-tap window and distance
const GLIDE_MIN = 0.12, GLIDE_MAX = 4, GLIDE_STOP = 0.02, GLIDE_TAU = 300, ANIM_MS = 220, IDLE_MS = 150, STALE_MS = 3000;
const TAP_PX = { touch: 8, pen: 4, mouse: 4 }, DTAP_MS = 320, DTAP_PX = 24, REVEAL_PAD = 16, FIT_PAD = 48;

/**
 * @typedef {{tx: number, ty: number, k: number}} Camera  local = world·k + t
 * @typedef {{x: number, y: number, w: number, h: number}} Rect  world px unless stated
 * @typedef {{x: number, y: number}} Pt
 * @typedef {{
 *   id: string,
 *   el: HTMLElement,
 *   rect: () => Rect,
 *   cost?: number,
 *   onScreen?: (on: boolean) => void,
 *   nudge?: (dx: number, dy: number) => void,
 *   setPos?: (x: number, y: number) => void,
 *   onMove?: (x: number, y: number, phase: 'start' | 'move' | 'end' | 'cancel') => void,
 * }} Item  a world item (cv-module Module implements it): `el` is absolutely positioned in #world by its owner. The world
 *   never hides, unmounts, swaps or resizes it: it reads rect() only at add / update / resize / cameraend (cached
 *   between: no layout read during a burst) and calls onScreen(on) when the item enters or leaves the viewport grown by
 *   CULL_MARGIN. The canvas arrow keys move the selected item by nudge(dx, dy) when it has one, else setPos + onMove
 *   'start' / 'end' (one undo step: the owner's onMove records it).
 * @typedef {{cx: number, cy: number}} At  a two-finger session's base midpoint, client px
 * @typedef {{
 *   el: HTMLElement, viewport: HTMLElement, overlay: HTMLElement,
 *   readonly cam: Camera, readonly k: number, readonly native: boolean, readonly movedAt: number,
 *   readonly selected: string | null, readonly edit: string | null, readonly pinchMode: 'canvas' | 'page',
 *   readonly busy: boolean,
 *   setCamera: (cam: Camera, o?: {animate?: boolean}) => void,
 *   panBy: (dx: number, dy: number) => void,
 *   zoomAt: (f: number, clientX: number, clientY: number, o?: {animate?: boolean}) => void,
 *   fit: (o?: {ids?: string[], animate?: boolean, kMax?: number}) => void,
 *   focusItem: (id: string, o?: {k?: number, animate?: boolean, edit?: boolean}) => void,
 *   reveal: (target: Element | {left: number, top: number, right: number, bottom: number}) => void,
 *   toWorld: (clientX: number, clientY: number) => Pt,
 *   toClient: (wx: number, wy: number) => Pt,
 *   band: () => {left: number, top: number, right: number, bottom: number},
 *   add: (item: Item) => () => void,
 *   remove: (id: string) => void,
 *   update: (id?: string) => void,
 *   clear: () => void,
 *   ids: () => string[],
 *   onScreen: (id: string) => boolean,
 *   select: (id: string | null) => void,
 *   dragPointer: (p: {x: number, y: number, pointerType: string} | null) => void,
 *   ghost: (g: {x: number, y: number, w: number, h: number, dx?: number, dy?: number, snap?: boolean, label?: string} | null) => Rect | null,
 *   setActive: (on: boolean) => void,
 *   setPinchMode: (m: 'canvas' | 'page') => void,
 *   resize: () => void,
 *   hooks: {pan: (sx: number, sy: number, at: At) => boolean, zoom: (f: number, cx: number, cy: number, at: At) => boolean,
 *     jack?: (e: PointerEvent, jackEl: Element) => (boolean | {cancel?: () => void}), jackCancel?: () => void},
 *   setJackHook: (fn: Function | null, cancel?: Function) => () => void,
 *   wheelVeto: () => boolean,
 *   escape: () => boolean,
 *   key: (e: KeyboardEvent) => boolean,
 *   on: (type: 'camera' | 'movestart' | 'cameraend' | 'screen' | 'budget' | 'native' | 'select' | 'edit' | 'snap' | 'lock' | 'mods', fn: (d: any) => void) => () => void,
 *   canvasStats: () => {n: number, bytes: number, minDensity: number | null, onMin: number | null, offN: number, capped: number, budget: number, k: number, dpr: number},
 *   destroy: () => void,
 * }} World
 */

/* ---------------------------------------------------------------- (milestone 3 H5) the canvas stores' budget (pure) */
/**
 * The budget's caps at a rest (IMPL-3 §1.4 H5). Each store: its canvas's layout size (w × h px), the rule's density t (dpr ·
 * k, the 16e6 px cap given the size), on screen or not, its distance from the viewport centre (world px). While Σ 4·w·h·t²
 * (+ fixed: stores the rule never sized, as they are) ≤ budget: no cap. Past it: the off-screen stores drop to the dpr first
 * (any order: farthest first), then the on-screen ones farthest from the centre, until Σ fits (or every store is at the dpr:
 * the dpr is the floor — never below 1:1). Pure.
 * @param {Array<{key: any, w: number, h: number, t: number, on: boolean, dist: number}>} L @param {number} dpr
 * @param {number} budget @param {number} [fixed] @returns {{caps: Map<any, number>, bytes: number}}
 */
export function planStores(L, dpr, budget, fixed) {
  const caps = new Map();
  let bytes = +fixed > 0 ? +fixed : 0;
  const cand = [];
  for (const x of Array.isArray(L) ? L : []) {
    if (!x || !(x.w > 0 && x.h > 0 && x.t > 0)) continue;
    const a = x.w * x.h, b = a * x.t * x.t * 4, low = Math.min(x.t, dpr);
    bytes += b;
    if (low < x.t) cand.push({ key: x.key, on: !!x.on, dist: +x.dist || 0, low, save: b - a * low * low * 4 });
  }
  if (bytes > budget) {
    cand.sort((p, q) => (p.on === q.on ? q.dist - p.dist : p.on ? 1 : -1));
    for (const c of cand) { if (bytes <= budget) break; caps.set(c.key, c.low); bytes -= c.save; }
  }
  return { caps, bytes };
}

/* ---------------------------------------------------------------- pure camera maths (node-tested) */
/** k clamped to [K_MIN, K_MAX] (NaN → 1). @param {number} k @returns {number} */
export function clampK(k) { k = +k; if (k !== k) return 1; return k < K_MIN ? K_MIN : k > K_MAX ? K_MAX : k; }
/** Viewport-local px → world px. @param {Camera} cam @param {number} lx @param {number} ly @returns {Pt} */
export function toWorld(cam, lx, ly) { return { x: (lx - cam.tx) / cam.k, y: (ly - cam.ty) / cam.k }; }
/** World px → viewport-local px. @param {Camera} cam @param {number} wx @param {number} wy @returns {Pt} */
export function toLocal(cam, wx, wy) { return { x: wx * cam.k + cam.tx, y: wy * cam.k + cam.ty }; }
/** Zoom by f about local point (lx, ly): k' = clampK(k·f), t' = c − (c − t)·k'/k (the point stays put).
 * @param {Camera} cam @param {number} f @param {number} lx @param {number} ly @returns {Camera} */
export function zoomAbout(cam, f, lx, ly) {
  const k = clampK(cam.k * (f > 0 && isFinite(f) ? f : 1)), r = k / cam.k;
  return { tx: lx - (lx - cam.tx) * r, ty: ly - (ly - cam.ty) * r, k };
}
/** Pan by a finger delta (content follows the finger: t += d). @param {Camera} cam @param {number} dx @param {number} dy @returns {Camera} */
export function panCam(cam, dx, dy) { return { tx: cam.tx + (+dx || 0), ty: cam.ty + (+dy || 0), k: cam.k }; }
/** The camera that shows every rect inside a vw × vh local box with `pad` px around, k ≤ kMax (default 1), centred.
 * @param {Rect[]} rects @param {number} vw @param {number} vh @param {{pad?: number, kMax?: number}} [o] @returns {Camera} */
export function fitCam(rects, vw, vh, o) {
  const pad = o && o.pad != null ? Math.max(0, +o.pad || 0) : FIT_PAD, kMax = o && o.kMax > 0 ? +o.kMax : 1;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects || []) {
    if (!r || !isFinite(r.x) || !isFinite(r.y)) continue;
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + Math.max(0, +r.w || 0)); y1 = Math.max(y1, r.y + Math.max(0, +r.h || 0));
  }
  if (!(x1 >= x0)) return { tx: pad, ty: pad, k: clampK(Math.min(1, kMax)) };
  const k = clampK(Math.min(kMax, Math.max(1, vw - 2 * pad) / Math.max(1, x1 - x0), Math.max(1, vh - 2 * pad) / Math.max(1, y1 - y0)));
  return { tx: vw / 2 - (x0 + x1) / 2 * k, ty: vh / 2 - (y0 + y1) / 2 * k, k };
}
/** The world rect visible in a vw × vh viewport, grown by `margin` screen px. @returns {Rect} */
export function visibleRect(cam, vw, vh, margin) {
  const m = +margin || 0;
  return { x: (-m - cam.tx) / cam.k, y: (-m - cam.ty) / cam.k, w: (vw + 2 * m) / cam.k, h: (vh + 2 * m) / cam.k };
}
/** Do two world rects overlap? @param {Rect} a @param {Rect} b @returns {boolean} */
export function intersects(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
/** The dot grid's maths, fixed to the world (it scales and moves exactly with the modules, never re-spaces): MAJOR dots
 * (always shown) and DOT dots, whose alpha fades smoothly out as they crowd together when zoomed out (gone below 10 screen
 * px apart, full from 24) instead of stepping. A dot sits on each world multiple; sizes and positions in screen px, alpha
 * in 1/100 steps. (Stage 1g: drawn on a canvas by gridDraw — this stays the pure maths.)
 * @returns {{major: {size: number, x: number, y: number}, minor: {size: number, x: number, y: number, a: number}}} */
export function gridBg(cam) {
  const layer = s => { const m = v => { const r = v % s; return r < 0 ? r + s : r; }; return { size: s, x: m(cam.tx - s / 2), y: m(cam.ty - s / 2) }; };
  const minor = layer(DOT * cam.k);
  minor.a = Math.round(Math.max(0, Math.min(1, (minor.size - 10) / 14)) * 100) / 100;
  return { major: layer(MAJOR * cam.k), minor };
}
/** gridDraw: a layer is drawn only while its dots sit ≥ GRID_MIN_DPX device px apart; never more than GRID_MAX_DOTS. */
export const GRID_MIN_DPX = 6, GRID_MAX_DOTS = 40000;
/** The grid's dot sizes at device ratio d (device px): a minor dot is a side × side square, a major one a disc of radius r
 * (on the same centre: a major dot IS the minor-grid point at a multiple of MAJOR). q (hotfix 2; default 1): device px
 * per store px — the device sizes of d·q in whole store px (side, rounded up) / half px (r), so a store below the device
 * ratio keeps the dots' size. Pure. */
export function gridSizes(d, q) {
  q = +q > 0 ? +q : 1;
  const D = Math.max(1, (+d || 1) * q), Z = { side: Math.max(2, Math.round(1.6 * D)), r: Math.max(1.5, Math.round(2.2 * D) / 2) };
  return q === 1 ? Z : { side: Math.ceil(Z.side / q - 1e-9), r: Math.max(0.5, Math.round(2 * Z.r / q) / 2) }; // (a square never below its device size)
}
/**
 * (1g) Draws the dot grid on a device-px 2D context w × h (the viewport × d, no transform): every dot of one origin — the
 * world multiples of DOT, each at its whole device px round((i·DOT·k + tx)·d), so the MAJOR ones (i, j multiples of 4) can
 * never drift from the minor ones and every dot rasters alike (no sub-pixel phase: nothing flickers while the camera moves).
 * Minor dots as gridBg fades them (one path of squares, one fill), major ones always (one path of discs). Pure but for the
 * context. q: device px per store px (gridSizes; GRID_MIN_DPX counts device px). @returns {{minor: number, major: number}}
 */
export function gridDraw(ctx, cam, w, h, d, q) {
  const n = { minor: 0, major: 0 };
  if (!ctx) return n;
  d = +d > 0 ? +d : 1; // (a capped store: below 1 too)
  if (typeof ctx.setTransform === 'function') ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  q = +q > 0 ? +q : 1;
  const k = cam.k, sp = DOT * k * d, a = gridBg(cam).minor.a, Z = gridSizes(d, q), o = Z.side >> 1, c = Z.side / 2 - o;
  if (!(sp > 0) || !(w > 0) || !(h > 0)) return n;
  const R = Math.ceil(Z.r) + 1, M = MAJOR / DOT;
  const axis = (t, len) => { const i0 = Math.ceil((-R - t * d) / sp), i1 = Math.floor((len + R - t * d) / sp), p = []; for (let i = i0; i <= i1; i++) p.push([i, Math.round((i * DOT * k + t) * d)]); return p; };
  const xs = axis(cam.tx, w), ys = axis(cam.ty, h), maj = i => i % M === 0;
  const minor = a > 0 && sp * q >= GRID_MIN_DPX && xs.length * ys.length <= GRID_MAX_DOTS;
  if (minor) {
    ctx.fillStyle = 'rgba(233, 231, 226, ' + Math.round(0.15 * a * 1000) / 1000 + ')';
    ctx.beginPath();
    for (const [j, y] of ys) for (const [i, x] of xs) if (!(maj(i) && maj(j))) { ctx.rect(x - o, y - o, Z.side, Z.side); n.minor++; }
    ctx.fill();
  }
  if (sp * q * M >= GRID_MIN_DPX) {
    ctx.fillStyle = 'rgba(233, 231, 226, 0.24)';
    ctx.beginPath();
    for (const [j, y] of ys) if (maj(j)) for (const [i, x] of xs) if (maj(i) && n.major < GRID_MAX_DOTS) { ctx.moveTo(x + c + Z.r, y + c); ctx.arc(x + c, y + c, Z.r, 0, 2 * Math.PI); n.major++; }
    ctx.fill();
  }
  return n;
}
/** (hotfix 2) The grid canvas's store, drawn at rest only (never in a burst): from the viewport's top-left, (vw / r + GRID_OVER)
 * × (vh / r + GRID_OVER) CSS px — GRID_OVER (one MAJOR period at K_MAX) keeps a pan covered, the reach r = GRID_REACH a
 * zoom out to r × the rest zoom (gridFollow wraps its left / top edge into (−P, 0]) — at min(dpr, GRID_MAX_S) store px per
 * CSS px, ≤ GRID_MAX_PX store px. Over the cap the overscan wins over the scale: the scale halves first (2 → 1, a whole
 * device ratio: the dots stay whole store px, sized for the device by gridSizes' q), then the reach gives way (to 1), then
 * the overscan (to 0), then the scale (below 1). Pure. @returns {{w: number, h: number, s: number, r: number}} store px */
export const GRID_OVER = MAJOR * K_MAX, GRID_MAX_PX = 8e6, GRID_MAX_S = 2, GRID_REACH = 0.5;
/** (1h) a lost GL context the browser has not restored after this long is given up: the 2D grid, live (G4). */
export const GL_LOST_MS = 3000;
export function gridStore(vw, vh, d) {
  vw = Math.max(0, +vw || 0); vh = Math.max(0, +vh || 0);
  const S = Math.min(Math.max(1, +d || 1), GRID_MAX_S), A = (u, g, s) => (vw * u + g) * (vh * u + g) * s * s;
  let s = S, u = 1 / GRID_REACH, g = GRID_OVER;
  if (A(u, g, s) > GRID_MAX_PX && S >= 2) s = S / 2;
  if (A(u, g, s) > GRID_MAX_PX) { // the reach: (vw·u + g)(vh·u + g) = M
    const M = GRID_MAX_PX / (s * s), a = vw * vh, b = g * (vw + vh);
    u = a > 0 ? Math.max(1, (-b + Math.sqrt(b * b - 4 * a * (g * g - M))) / (2 * a) * (1 - 1e-9)) : 1;
    if (A(u, g, s) > GRID_MAX_PX) { // then the overscan, then the scale
      const b2 = vw + vh;
      u = 1; g = Math.max(0, Math.min(g, Math.floor((-b2 + Math.sqrt(b2 * b2 - 4 * (vw * vh - M))) / 2)));
      if (A(u, g, s) > GRID_MAX_PX) s = Math.sqrt(GRID_MAX_PX / Math.max(1, (vw + g) * (vh + g)));
    }
  }
  const w = vw > 0 && vh > 0 ? Math.floor((vw * u + g) * s + 1e-6) : 0, h = w ? Math.floor((vh * u + g) * s + 1e-6) : 0;
  return { w, h, s, r: 1 / u };
}
/**
 * (hotfix) The grid canvas's transform during a burst: its last draw (camera c0, a cw × ch CSS px canvas at the viewport's
 * top-left, transform-origin 0 0) mapped onto the camera c — translate(x, y) scale(s), s = c.k / c0.k, x = c.tx − c0.tx·s
 * (a canvas point p = w·k0 + t0 lands at s·p + x = w·k + t: every world point where the camera puts it), then wrapped
 * into (−P, 0] by whole periods P = MAJOR·c.k (the pattern repeats every MAJOR world px; at most one store px of rounding
 * moves at a wrap, mid-motion). ok: the canvas covers the vw × vh viewport. Pure.
 * @returns {{x: number, y: number, s: number, ok: boolean}}
 */
export function gridFollow(c0, c, cw, ch, vw, vh) {
  const s = c.k / c0.k, P = MAJOR * c.k, wrap = v => (P > 0 ? v - P * Math.ceil(v / P) : v) || 0;
  const x = wrap(c.tx - c0.tx * s), y = wrap(c.ty - c0.ty * s);
  return { x, y, s, ok: x <= 1e-6 && y <= 1e-6 && x + s * cw >= vw - 0.5 && y + s * ch >= vh - 0.5 };
}
/** v snapped to the grid g (default DOT, the visible dots). @returns {number} */
export function snap(v, g) { const s = g > 0 ? +g : DOT, r = Math.round(v / s) * s; return r === 0 ? 0 : r; }
/** Which items are on screen: those intersecting the viewport grown by `margin` screen px (default CULL_MARGIN), at any
 * zoom. An item without a rect counts as on screen. Pure. @param {{id: string, rect: Rect | null}[]} items
 * @param {Camera} cam @param {number} vw @param {number} vh @param {number} [margin] @returns {{on: string[], off: string[]}} */
/** The items a marquee touches: ids whose rect intersects the world rect r (rects: [{id, rect}]). Pure. */
export function inRect(list, r) {
  const out = [];
  for (const it of list || []) if (it && it.rect && intersects(it.rect, r)) out.push(it.id);
  return out;
}
/** The minimap's mapping: the union of the item rects and the view rect, padded, fitted (centred) into w × h px →
 * { s, ox, oy } with map = world · s + o. Pure. @param {Rect[]} rects @param {Rect} view */
export function mapFit(rects, view, w, h, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of [...(rects || []), view]) {
    if (!r || !isFinite(r.x) || !isFinite(r.y)) continue;
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + Math.max(0, +r.w || 0)); y1 = Math.max(y1, r.y + Math.max(0, +r.h || 0));
  }
  if (!(x1 > x0) || !(y1 > y0)) return { s: 1, ox: 0, oy: 0 };
  const p = pad != null ? pad : 6, s = Math.min((w - 2 * p) / (x1 - x0), (h - 2 * p) / (y1 - y0));
  return { s, ox: (w - (x1 - x0) * s) / 2 - x0 * s, oy: (h - (y1 - y0) * s) / 2 - y0 * s };
}
export function planScreen(items, cam, vw, vh, margin) {
  const vis = visibleRect(cam, vw, vh, margin != null ? +margin : CULL_MARGIN), on = [], off = [];
  for (const it of items || []) {
    if (!it) continue;
    if (!it.rect || intersects(it.rect, vis)) on.push(it.id); else off.push(it.id);
  }
  return { on, off };
}

/* ---------------------------------------------------------------- the world */
/**
 * Creates the camera on #viewport over #world. Installs: one-finger / mouse pan on empty canvas and known module
 * backgrounds (o.isBackground), momentum + its guard (capture pointerdown on the viewport), the late-finger pinch upgrade,
 * wheel / Ctrl-wheel / Safari gesture* zoom, the native-zoom hand-over (visualViewport.scale > 1 → [data-cv-native],
 * hooks return false), focus reveal, on-screen tracking (onScreen / 'screen'), sleeping controls below READ_K, selection
 * and edit state ([data-cv-edit]),
 * edge auto-pan for drags (dragPointer) and the drop outline (ghost) in #overlay, the floating toolbar in o.toolbar.
 * @param {HTMLElement} viewport  #viewport
 * @param {{
 *   world: HTMLElement, overlay: HTMLElement, toolbar?: HTMLElement, layer?: HTMLElement,
 *   isBackground?: (el: Element) => boolean,
 *   onTidy?: () => void,
 *   store?: {get: (k: string, d: any) => any, set: (k: string, v: any) => void},
 *   env?: {win?: any, doc?: any, raf?: (f: Function) => any, caf?: (id: any) => void, now?: () => number,
 *     setTimeout?: (f: Function, ms: number) => any, clearTimeout?: (id: any) => void},
 * }} o
 * @returns {World}
 */
export function createWorld(viewport, o) {
  o = o || {};
  if (!viewport || !o.world) throw new Error('cv-world: no #viewport / #world');
  const env = o.env || {}, W = o.world, OV = o.overlay || null, store = o.store || null;
  const win = env.win || (typeof window !== 'undefined' ? window : globalThis);
  const doc = env.doc || win.document || globalThis.document || null;
  const now = typeof env.now === 'function' ? env.now : () => { const p = win.performance || globalThis.performance; return p && typeof p.now === 'function' ? p.now() : Date.now(); };
  const later = typeof env.setTimeout === 'function' ? env.setTimeout : (f, ms) => { const id = setTimeout(f, ms); if (id && typeof id.unref === 'function') id.unref(); return id; };
  const unlater = typeof env.clearTimeout === 'function' ? env.clearTimeout : id => clearTimeout(id);
  const raf = typeof env.raf === 'function' ? env.raf : f => (typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame(f) : later(() => f(now()), 16));
  const caf = typeof env.caf === 'function' ? env.caf : id => { if (typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(id); else unlater(id); };
  const isBg = el => { try { return typeof o.isBackground === 'function' && !!el && !!o.isBackground(el); } catch (err) { return false; } };
  const reduced = () => { try { const m = win.matchMedia; return typeof m === 'function' && !!m.call(win, '(prefers-reduced-motion: reduce)').matches; } catch (err) { return false; } };
  const dpr = () => Math.max(1, +win.devicePixelRatio || 1);
  const attr = (el, k, on) => { if (!el) return; try { if (on === false || on == null) { if (el.hasAttribute(k)) el.removeAttribute(k); } else el.setAttribute(k, on === true ? '' : String(on)); } catch (err) { /* inert */ } };
  const copy = c => ({ tx: c.tx, ty: c.ty, k: c.k });

  /* ---- state */
  let cam = { tx: 0, ty: 0, k: 1 }, shown = null, ikK = 1;
  let vp = { left: 0, top: 0, width: 0, height: 0 }, ovO = { left: 0, top: 0 }; // cached rects (resize)
  let active = true, native = false, destroyed = false, pinchMode = 'canvas', movedAt = -1e9, snapping = true, locked = false, modsMode = 'always';
  let sel = null, editId = null, editSup = false, focusBack = null;
  const selSet = new Set(); // the selection (sel: its primary — the one tapped or moved last)
  let pin = null; // a bar double-tap's edit state { id, k }: it holds at the focus zoom even below EDIT_K (a large module's fit)
  let fid = 0, scrDirty = false, overBudget = false; // the frame, the on-screen plan owed, the soft DOM budget crossed
  let planned = 0; // (H5) Σ of the canvas stores projected at the last plan (bytes)
  let mapOn = true, mapDirty = true, MM = null; // the minimap: shown, a redraw owed, its parts { el, cv, btn, drag }
  let GC = null, dprMq = null; // (1g) the grid canvas { cv, ctx, w, h, d, s, r, cw, ch, c0, tf, n, ms, max, dots, moves }; the device-ratio watch
  let GL = null, glOff = null, glDead = false, glWait = 0; // (1h) the GL layer (cv-gl; the 2D grid canvas is not made then), its FACES.onChange remover, given up (G4), the restore timer of a loss
  let B = null; // the live burst: { hook, until, band, timer, last, k (the zoom written before it), zoom (it changed) }
  let G = null; // the world's own pointer gesture (pan / pinch)
  let J = null; // a press hooks.jack took: { id, type, x, y, cancel } until its pointer lifts
  let glide = null, glideEnd = -1e9, anim = null, edge = null, gh = null, gs = null; // gs: Safari gesture scale
  let touches = 0, pressT = -1e9, lastTap = null, outside = null, bandC = null, pctShown = '', pctLab = '', clickUntil = -1e9;
  const items = new Map(); // id → { item, rect (cached: add / update / resize / cameraend), on (on screen) }
  const subs = new Map();
  const offs = [];
  const listen = (t, type, fn, opt) => { if (!t || typeof t.addEventListener !== 'function') return; t.addEventListener(type, fn, opt); offs.push(() => t.removeEventListener(type, fn, opt)); };
  function emit(type, d) {
    const s = subs.get(type);
    if (s) for (const f of [...s]) { try { f(d); } catch (err) { console.error(err); } }
  }

  /* ---- measuring (never per frame) */
  function rectOf(el) { try { const r = el.getBoundingClientRect(); return { left: +r.left || 0, top: +r.top || 0, width: +r.width || 0, height: +r.height || 0 }; } catch (err) { return { left: 0, top: 0, width: 0, height: 0 }; } }
  function resize() {
    const was = vp;
    vp = rectOf(viewport);
    ovO = OV ? rectOf(OV) : { left: vp.left, top: vp.top };
    bandC = null;
    // (1g) the top / left edge moved alone (the top tray's grip: the width kept; a side edge: the height kept): the camera
    // follows it, so every world point keeps its place on the screen (one written frame; no burst, no History). A window
    // resize / rotation (both sizes changed) keeps the world on the viewport's top-left, as before (main.js U14)
    const seen = was.width > 0 && was.height > 0 && vp.width > 0 && vp.height > 0;
    const dx = seen && vp.height === was.height ? vp.left - was.left : 0, dy = seen && vp.width === was.width ? vp.top - was.top : 0;
    if (dx || dy) {
      cam = { tx: cam.tx - dx, ty: cam.ty - dy, k: cam.k };
      if (anim) { for (const c of [anim.c0, anim.c1]) { c.tx -= dx; c.ty -= dy; } anim.x -= dx; anim.y -= dy; }
    }
    if (sizeGrid()) GC.c0 = null; // (cleared: drawn now, in a burst too)
    if (!write()) gridAt();
    recache();
    // (U14) the viewport changed (a tray's height, a rotation): main.js re-derives an untouched default camera — not for a
    // moved edge alone (dx / dy: the camera already kept the world in place)
    if (was.width !== vp.width || was.height !== vp.height || dx || dy) emit('resize', { w: vp.width, h: vp.height, dw: vp.width - was.width, dh: vp.height - was.height, dx, dy });
  }
  // the canvas's visible client rect: the viewport ∩ wk.visibleBand (visual viewport less trays, rails, the keyboard)
  function vis() {
    const r = { left: vp.left, top: vp.top, right: vp.left + vp.width, bottom: vp.top + vp.height };
    let b = null;
    try { b = wk.visibleBand(doc); } catch (err) { b = null; }
    if (!b || !(b.right > b.left) || !(b.bottom > b.top)) return r;
    const o2 = { left: Math.max(r.left, b.left), top: Math.max(r.top, b.top), right: Math.min(r.right, b.right), bottom: Math.min(r.bottom, b.bottom) };
    return o2.right > o2.left && o2.bottom > o2.top ? o2 : r;
  }
  // (1e, U14) the floating toolbar's boxes (its row, the minimap above it while shown), client px — a module under them
  // would lose its presses to them
  function reserved() {
    const out = [], add = el => { const r = el ? rectOf(el) : null; if (r && r.width > 0 && r.height > 0) out.push({ left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height }); };
    if (o.toolbar && TB.bar) add(o.toolbar);
    if (MM && mapOn) add(MM.el);
    return out;
  }
  // b less the reserved boxes at its foot (each overlaps it and reaches its lowest 200 px): its bottom over the highest
  // one's top (gap px; at least 120 px of band stay)
  function cut(b, gap) {
    const c = Object.assign({}, b);
    for (const r of reserved()) {
      if (!(r.left < c.right && r.right > c.left && r.top < b.bottom && r.bottom > b.bottom - 200)) continue;
      c.bottom = Math.max(c.top + 120, Math.min(c.bottom, r.top - gap));
    }
    return c;
  }
  // the band: the visible rect less the toolbar and the minimap (U14) — what a fit, a focus, a reveal and main.js's
  // default camera frame into, so no module lands under them (the gestures, the edge pan and the minimap's own view
  // rect keep the visible rect)
  function band() { return cut(vis(), 8); }
  // the visible rect during a gesture: measured once per burst (or every 250 ms between bursts)
  function bandNow() {
    if (B && B.band) return B.band;
    const t = now();
    if (!bandC || t - bandC.t > 250) bandC = { t, b: vis() };
    if (B) B.band = bandC.b;
    return bandC.b;
  }
  const bandBox = b => ({ x: b.left - vp.left, y: b.top - vp.top, w: b.right - b.left, h: b.bottom - b.top }); // local

  /* ---- the dot grid (1g): one device-px canvas under #world (gridDraw). Hotfix: drawn at rest only — boot, a write
     outside a burst, a burst's end, a resize / device-ratio change (in a burst too: resizing cleared it); in a burst it only
     follows by transform (gridFollow: no layout read, one style write a frame), never redrawn (hotfix 2) */
  function buildGrid() {
    if (!doc || typeof doc.createElement !== 'function') return;
    if (buildGL()) return;
    const cv = doc.createElement('canvas');
    if (!cv) return;
    cv.className = 'cv-grid';
    try { cv.setAttribute('aria-hidden', 'true'); if (W.parentNode === viewport && typeof viewport.insertBefore === 'function') viewport.insertBefore(cv, W); else viewport.prepend(cv); } catch (err) { return; }
    GC = { cv, ctx: null, w: -1, h: -1, d: 0, s: 1, r: 1, cw: 0, ch: 0, c0: null, tf: '', n: 0, ms: 0, max: 0, dots: 0, moves: 0 };
    offs.push(() => { try { cv.width = 0; cv.height = 0; cv.remove(); } catch (err) { /* gone */ } });
  }
  /* ---- (1h) the GL layer: tried first unless the URL says ?nogl / nogl=1 or the pref synth.cv.gl is 'off' (the 2D path
     to compare: tests, ui-bench); ?gltest / the pref 'test' keep the drawing buffer for readPixels (G1 / G3 probes).
     On it the grid is drawn by GL.draw at every written frame (write → gridAt), at rest (endBurst), on resize and the
     device-ratio watch (sizeGrid → GL.resize, then the draw) and when FACES says its quads changed; nothing per frame
     but that one draw (no gridStore, no transform). A context loss detaches FACES (every texture is dead: the faces fall
     back to their DOM tier) and a restore attaches it again; three losses in a minute end the layer: the 2D grid is
     built live (G4), FACES stays detached. */
  function glPref() { // 'off' | 'test' | '' from the URL (first) or the pref
    let q = '';
    try { q = String((win.location && win.location.search) || ''); } catch (err) { q = ''; }
    if (/[?&]nogl(?:=1)?(?:&|$)/.test(q)) return 'off';
    if (/[?&]gltest(?:=1)?(?:&|$)/.test(q)) return 'test';
    let v = '';
    try { const ls = win.localStorage; v = ls && typeof ls.getItem === 'function' ? ls.getItem('synth.cv.gl') : ''; } catch (err) { v = ''; }
    return v === 'off' || v === 'test' ? v : '';
  }
  function buildGL() {
    const pref = glPref();
    if (glDead || pref === 'off') return false;
    const mk = typeof o.createGL === 'function' ? o.createGL : createGL;
    let gl = null;
    try { gl = mk(viewport, { doc, win, world: W, test: pref === 'test', now, onLost: glLost, onRestored: glRestored }); } catch (err) { console.error(err); gl = null; }
    if (!gl) return false;
    GL = gl;
    glOff = FACES.onChange(() => { if (GL && !destroyed) glDraw(); });
    return true;
  }
  function glDraw() { // one frame of the GL layer: the grid, then the faces' quads (FACES.quads: no DOM read)
    if (!GL) return;
    let q = null;
    try { q = FACES.quads(rectById, cam); } catch (err) { console.error(err); q = null; }
    GL.draw(cam, vp.width, vp.height, dpr(), q);
  }
  function glLost(dead) { // a context loss: FACES detached (its textures are dead); the third in a minute, or one not restored within GL_LOST_MS: the 2D grid, live
    if (destroyed || !GL) return;
    if (glOff) { glOff(); glOff = null; } // (the registry's detach emits a change: no draw on a lost context)
    try { FACES.detach(); } catch (err) { console.error(err); }
    unlater(glWait); glWait = 0;
    if (!dead) { glWait = later(() => { glWait = 0; glLost(true); }, GL_LOST_MS); return; } // (no grid, no faces meanwhile: a short wait)
    glDead = true;
    const gl = GL;
    GL = null;
    try { gl.destroy(); } catch (err) { /* gone */ }
    buildGrid();
    sizeGrid();
    gridAt();
  }
  function glRestored() { unlater(glWait); glWait = 0; if (!destroyed && GL) { try { FACES.attach({ gl: GL, world: api }); } catch (err) { console.error(err); } if (!glOff) glOff = FACES.onChange(() => { if (GL && !destroyed) glDraw(); }); glDraw(); } }
  const rectById = id => { const r = items.get(String(id)); return r && r.rect ? r.rect : null; }; // (1h) the cached rect (null unknown)
  // the store (gridStore: the viewport, its overscan for a pan and a zoom out to GRID_REACH, ≤ GRID_MAX_PX) → true when it
  // changed (and was cleared)
  function sizeGrid() {
    if (GL) { GL.resize(vp.width, vp.height, dpr()); return false; } // (the GL path: the buffer follows the viewport; drawn by gridAt)
    if (!GC) return false;
    const d = dpr(), { w, h, s, r } = gridStore(vp.width, vp.height, d);
    if (w === GC.w && h === GC.h && d === GC.d && s === GC.s) return false;
    Object.assign(GC, { w, h, d, s, r, cw: w / s, ch: h / s });
    try { GC.cv.width = w; GC.cv.height = h; GC.cv.style.width = w / s + 'px'; GC.cv.style.height = h / s + 'px'; } catch (err) { /* inert */ }
    return true;
  }
  function drawGrid() { // at the camera (its transform gone)
    if (!GC || !(GC.w > 0) || !(GC.h > 0)) return;
    if (!GC.ctx) { try { GC.ctx = typeof GC.cv.getContext === 'function' ? GC.cv.getContext('2d') : null; } catch (err) { GC.ctx = null; } }
    if (!GC.ctx) return;
    const t0 = now(), n = gridDraw(GC.ctx, cam, GC.w, GC.h, GC.s, GC.d / GC.s), ms = now() - t0;
    GC.n++; GC.ms += ms; GC.max = Math.max(GC.max, ms); GC.dots = n.minor + n.major;
    GC.c0 = copy(cam);
    gridPlace();
  }
  // the transform from the last draw onto the camera ('' when they match): the only per-frame work of a pan
  function gridPlace() {
    const c0 = GC.c0;
    let t = '', f = null;
    if (c0.tx !== cam.tx || c0.ty !== cam.ty || c0.k !== cam.k) {
      f = gridFollow(c0, cam, GC.cw, GC.ch, vp.width, vp.height);
      t = 'translate(' + f.x + 'px, ' + f.y + 'px) scale(' + f.s + ')';
    }
    if (t !== GC.tf) { GC.tf = t; GC.moves++; try { GC.cv.style.transform = t; } catch (err) { /* inert */ } }
    return f;
  }
  // after a written frame (and at a burst's end): at rest drawn when stale; in a burst only moved (an empty store — boot,
  // a resize — is drawn at once)
  function gridAt() {
    if (GL) { glDraw(); return; }
    if (!GC) return;
    if (GC.c0 && (B || (GC.c0.tx === cam.tx && GC.c0.ty === cam.ty && GC.c0.k === cam.k))) gridPlace(); else drawGrid();
  }
  function watchDpr() { // a device-ratio change (browser zoom, another screen) re-sizes the grid's store
    try {
      if (dprMq) dprMq.m.removeEventListener('change', dprMq.f);
      dprMq = null;
      const m = typeof win.matchMedia === 'function' ? win.matchMedia('(resolution: ' + dpr() + 'dppx)') : null;
      if (!m || typeof m.addEventListener !== 'function') return;
      const f = () => { resize(); watchDpr(); };
      m.addEventListener('change', f);
      dprMq = { m, f };
    } catch (err) { dprMq = null; }
  }

  /* ---- writing the camera (once per frame) */
  function write() {
    if (shown && shown.tx === cam.tx && shown.ty === cam.ty && shown.k === cam.k) return false;
    shown = copy(cam);
    W.style.transform = 'translate(' + cam.tx + 'px, ' + cam.ty + 'px) scale(' + cam.k + ')';
    gridAt();
    if (gh && gh.g) placeGhost();
    mapDirty = true;
    if (B && cam.k !== B.k) B.zoom = true;
    const pct = Math.round(cam.k * 100) + '%';
    if (pct !== pctShown && TB.pct) { pctShown = pct; TB.pct.textContent = pct; }
    if (!B) pctLabel();
    emit('camera', copy(cam));
    return true;
  }
  function pctLabel() { // (hotfix 2) the zoom button's label: at rest only (its text follows every frame)
    const l = 'Zoom ' + pctShown + ' — reset to 100 %';
    if (TB.pct && pctShown && l !== pctLab) { pctLab = l; TB.pct.setAttribute('aria-label', l); }
  }
  function request() { if (!fid && !destroyed) fid = raf(tick); }
  function tick() {
    fid = 0;
    if (destroyed) return;
    const T = now();
    if (glide) stepGlide(T);
    if (anim) stepAnim(T);
    if (edge) stepEdge(T);
    // (cached rects only: no layout read in a burst; hotfix 2: a zoom burst's plan waits for its end — modules coming into
    // view by the dozen mid-pinch restyled their subtrees and woke their monitors: endBurst → recache → schedule)
    if ((write() || scrDirty) && active && !(B && B.zoom)) screen();
    if (mapDirty && mapOn && active) drawMap();
    if (glide || anim || (edge && edge.v)) request();
  }

  /* ---- bursts: movestart … cameraend */
  function moved(timed, hook) {
    movedAt = now();
    if (!B) {
      B = { hook: false, until: 0, band: null, timer: 0, last: movedAt, k: shown ? shown.k : cam.k, zoom: false };
      attr(viewport, 'data-cv-busy', true);
      try { wk.closeTransient(); } catch (err) { /* kit absent */ }
      emit('movestart', { cam: copy(cam) });
    }
    B.last = movedAt;
    if (hook) B.hook = true;
    if (timed) { B.until = movedAt + IDLE_MS; arm(IDLE_MS); }
  }
  function arm(ms) { if (!B) return; unlater(B.timer); B.timer = later(settle, ms + 1); }
  function settle() { // ends the burst once nothing moves the camera any more
    if (!B) return;
    unlater(B.timer); B.timer = 0;
    if (G || glide || anim || (edge && edge.v)) return; // (each ends with settle())
    const t = now();
    if (B.hook && touches > 0 && t - B.last < STALE_MS) { arm(IDLE_MS); return; } // fingers still on the glass
    if (t < B.until) { arm(B.until - t); return; }
    endBurst();
  }
  function endBurst() {
    if (!B) return;
    unlater(B.timer);
    B = null;
    const d = dpr();
    cam = { tx: Math.round(cam.tx * d) / d, ty: Math.round(cam.ty * d) / d, k: cam.k }; // crisp at rest
    if (!write()) gridAt(); // (the grid: drawn once at rest, its transform gone)
    pctLabel();
    attr(viewport, 'data-cv-busy', false);
    const zoomed = Math.abs(cam.k - ikK) > 1e-9;
    if (zoomed) {
      ikK = cam.k;
      try { W.style.setProperty('--ik', String(1 / cam.k)); } catch (err) { /* inert */ }
      try { wk.setCanvasScale(cam.k); } catch (err) { console.error(err); }
    }
    const capsMoved = stores(); // (H5: the budget at this rest, before the repaint it may ask for)
    if (zoomed || capsMoved) { try { wk.rescaleCanvases(W); } catch (err) { console.error(err); } }
    emit('cameraend', { cam: copy(cam), zoomed });
    computeEdit();
    recache(undefined, true);
  }
  function stopMotion() { glide = null; anim = null; }

  /* ---- camera changes */
  function jump(c) { // at once: one written frame, the burst ends now unless a gesture runs
    stopMotion();
    cam = { tx: +c.tx || 0, ty: +c.ty || 0, k: clampK(c.k) };
    moved(false);
    B.until = 0;
    write();
    settle();
  }
  function animateTo(c1, ax, ay) { // ≈ ANIM_MS ease-out; k geometric, the anchor's world point linear (no drift)
    c1 = { tx: +c1.tx || 0, ty: +c1.ty || 0, k: clampK(c1.k) };
    if (reduced()) { jump(c1); return; }
    glide = null;
    const c0 = copy(cam), x = ax != null ? ax : vp.width / 2, y = ay != null ? ay : vp.height / 2;
    anim = { c0, c1, w0: toWorld(c0, x, y), w1: toWorld(c1, x, y), x, y, t0: now() };
    moved(false);
    request();
  }
  function stepAnim(T) {
    const a = anim, u = Math.min(1, Math.max(0, (T - a.t0) / ANIM_MS)), e = 1 - Math.pow(1 - u, 3);
    if (u >= 1) cam = copy(a.c1);
    else {
      const k = a.c0.k * Math.pow(a.c1.k / a.c0.k, e), wx = a.w0.x + (a.w1.x - a.w0.x) * e, wy = a.w0.y + (a.w1.y - a.w0.y) * e;
      cam = { tx: a.x - wx * k, ty: a.y - wy * k, k };
    }
    moved(false);
    if (u >= 1) { anim = null; write(); settle(); }
  }
  function setCamera(c, opt) {
    if (!c) return;
    if (opt && opt.animate) animateTo(c); else jump(c);
  }
  function panBy(dx, dy) {
    if (!dx && !dy) return;
    cam = panCam(cam, dx, dy);
    moved(true);
    request();
  }
  function zoomAt(f, clientX, clientY, opt) {
    const lx = clientX - vp.left, ly = clientY - vp.top;
    if (opt && opt.animate) animateTo(zoomAbout(anim ? anim.c1 : cam, f, lx, ly), lx, ly);
    else { stopMotion(); cam = zoomAbout(cam, f, lx, ly); moved(true); request(); }
  }
  function zoomTo(k, opt) { // about the band's centre (toolbar, '1')
    const b = bandNow(), cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2, base = anim ? anim.c1 : cam;
    zoomAt(clampK(k) / base.k, cx, cy, opt);
  }
  function stepZoom(dir) {
    const k = (anim ? anim.c1 : cam).k, e = 1e-3;
    const next = dir > 0 ? ZOOM_STEPS.find(s => s > k + e) : [...ZOOM_STEPS].reverse().find(s => s < k - e);
    zoomTo(next != null ? next : dir > 0 ? K_MAX : K_MIN, { animate: true });
  }
  function rectsOf(ids) {
    const out = [];
    for (const [id, r] of items) if (!ids || ids.includes(id)) { try { out.push(r.item.rect()); } catch (err) { /* gone */ } }
    return out;
  }
  // the band a fit or a focus frames into: less the floating toolbar and the minimap at its foot (a fit never lands under
  // them; the fit's own padding may reach FIT_PAD / 2 over the gap)
  function frameBand() { return cut(bandNow(), 8 - FIT_PAD / 2); }
  function fitCamera(ids, kMax) {
    const bx = bandBox(frameBand()), rs = rectsOf(ids);
    const c = fitCam(rs, bx.w, bx.h, { pad: FIT_PAD, kMax: kMax > 0 ? kMax : 1 });
    return { tx: c.tx + bx.x, ty: c.ty + bx.y, k: c.k };
  }
  function fit(opt) {
    opt = opt || {};
    if (!items.size) return;
    focusBack = null;
    const c = fitCamera(opt.ids || null, opt.kMax);
    if (opt.animate === false) jump(c); else animateTo(c);
  }
  function focusItem(id, opt) {
    opt = opt || {};
    const rec = items.get(id);
    if (!rec) return;
    const k = clampK(opt.k > 0 ? opt.k : 1), edit = opt.edit !== false, animate = opt.animate !== false;
    if (locked && edit) { // the view locked: a double-tap selects and wakes the module where the camera is (no move)
      focusBack = null;
      select(id);
      editSup = false;
      pin = { id, k: cam.k };
      computeEdit();
      return;
    }
    // a second double-tap on the same module goes back to the camera before the first
    if (focusBack && focusBack.id === id && edit && near(cam, focusBack.to)) {
      const back = focusBack.from;
      focusBack = null; pin = null;
      setCamera(back, { animate });
      return;
    }
    let r;
    try { r = rec.item.rect(); } catch (err) { return; }
    const bx = bandBox(frameBand());
    let c;
    if (r.w * k > bx.w - 2 * FIT_PAD || r.h * k > bx.h - 2 * FIT_PAD) {
      c = fitCamera([id], k); // larger than the band at k
      // a fit below the readability floor (a 1300 px Serum in an iPad's canvas: ≈ 0.3) frames its width instead, top
      // aligned (left aligned when still wider), never below READ_K: a double-tap is for editing
      if (c.k < READ_K && k >= READ_K) {
        const kw = Math.max(READ_K, Math.min(k, (bx.w - 2 * FIT_PAD) / Math.max(1, r.w)));
        c = { tx: r.w * kw <= bx.w - 2 * FIT_PAD ? bx.x + bx.w / 2 - (r.x + r.w / 2) * kw : bx.x + FIT_PAD - r.x * kw, ty: bx.y + FIT_PAD - r.y * kw, k: kw };
      }
    } else c = { tx: bx.x + bx.w / 2 - (r.x + r.w / 2) * k, ty: bx.y + bx.h / 2 - (r.y + r.h / 2) * k, k };
    focusBack = edit ? { id, from: copy(anim ? anim.c1 : cam), to: c } : null;
    select(id);
    editSup = !edit;
    pin = edit ? { id, k: c.k } : null;
    setCamera(c, { animate });
    computeEdit();
  }
  const near = (a, b) => Math.abs(a.k - b.k) < 1e-3 && Math.abs(a.tx - b.tx) < 2 && Math.abs(a.ty - b.ty) < 2;
  function reveal(t) {
    if (locked) return; // (the view locked: a focused control or an opened popover never pans it)
    let r = null;
    try { r = t && typeof t.getBoundingClientRect === 'function' ? t.getBoundingClientRect() : t; } catch (err) { r = null; }
    if (!r || !isFinite(r.left) || !isFinite(r.top)) return;
    const right = r.right != null ? r.right : r.left + (r.width || 0), bottom = r.bottom != null ? r.bottom : r.top + (r.height || 0);
    const b = band(), L = b.left + REVEAL_PAD, R = b.right - REVEAL_PAD, T = b.top + REVEAL_PAD, Bo = b.bottom - REVEAL_PAD; // (above the toolbar: U14)
    const dx = right - r.left > R - L || r.left < L ? L - r.left : right > R ? R - right : 0;
    const dy = bottom - r.top > Bo - T || r.top < T ? T - r.top : bottom > Bo ? Bo - bottom : 0;
    if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) setCamera(panCam(anim ? anim.c1 : cam, dx, dy), { animate: true });
  }

  /* ---- items: cached rects, on screen or not (Z1: never hidden, unmounted, swapped or resized) */
  function cacheRect(rec) { try { rec.rect = rec.item.rect(); } catch (err) { rec.rect = null; } }
  function recache(id, planned) { // a layout read: only outside a burst (add / update / resize / cameraend)
    for (const [k, r] of items) if (id == null || k === id) cacheRect(r);
    mapDirty = true;
    budget();
    if (!planned && !B && stores()) { try { wk.rescaleCanvases(W); } catch (err) { console.error(err); } } // (H5: a new module's stores count)
    schedule();
  }
  /* ---- (milestone 3 H5) the canvas stores: Σ ≤ wk.CANVAS_BUDGET, planned at a rest only (no layout read: each store's
   * layout size is its backing size over the density storeDensity gave it; a store the rule never sized counts as it is) */
  function canvasList() { // [{ cv, id (its module's data-cv-mod) }] — the grid / GL canvases live outside #world
    let L = null;
    try { L = typeof W.querySelectorAll === 'function' ? Array.from(W.querySelectorAll('canvas')) : null; } catch (err) { L = null; }
    if (!L) { // (a DOM without querySelectorAll: walk)
      L = [];
      const st = [W];
      while (st.length) { const n = st.pop(); for (const c of n.children || []) { if (c.localName === 'canvas' || c.tagName === 'CANVAS') L.push(c); st.push(c); } }
    }
    return L.map(cv => {
      let id = null;
      for (let n = cv.parentNode; n && n !== W && n.nodeType === 1; n = n.parentNode) { const a = typeof n.getAttribute === 'function' ? n.getAttribute('data-cv-mod') : null; if (a != null) { id = a; break; } }
      return { cv, id };
    });
  }
  function onNow() { // the items on screen for the camera as it stands (the cached rects; a zoom burst's plan is owed at its end)
    const list = [];
    for (const [id, r] of items) list.push({ id, rect: r.rect });
    return vp.width > 0 && vp.height > 0 ? new Set(planScreen(list, cam, vp.width, vp.height).on) : null;
  }
  function stores() { // → whether a cap changed
    try {
      const raw = dpr(), t0 = Math.max(0.5, raw * cam.k), c = toWorld(cam, vp.width / 2, vp.height / 2), ON = onNow(), L = [];
      let fixed = 0;
      for (const { cv, id } of canvasList()) {
        const w0 = +cv.width || 0, h0 = +cv.height || 0, d0 = wk.storedDensity(cv);
        if (!(w0 > 0 && h0 > 0)) continue;
        if (!(d0 > 0)) { fixed += w0 * h0 * 4; continue; }
        const w = w0 / d0, h = h0 / d0, r = id != null ? items.get(id) : null, R = r && r.rect;
        const t = w * h * t0 * t0 > wk.CANVAS_MAX_PX ? Math.sqrt(wk.CANVAS_MAX_PX / (w * h)) : t0;
        L.push({ key: cv, w, h, t, on: !r || !ON || ON.has(id), dist: R ? Math.hypot(R.x + R.w / 2 - c.x, R.y + R.h / 2 - c.y) : 0 });
      }
      const P = planStores(L, raw, wk.CANVAS_BUDGET, fixed);
      planned = P.bytes;
      return wk.setStoreCaps(P.caps);
    } catch (err) { console.error(err); return false; }
  }
  function canvasStats() {
    const raw = dpr(), k = cam.k;
    let n = 0, bytes = 0, minD = Infinity, onMin = Infinity, offN = 0, capped = 0;
    for (const { cv, id } of canvasList()) {
      const w0 = +cv.width || 0, h0 = +cv.height || 0;
      if (!(w0 > 0 && h0 > 0)) continue;
      n++; bytes += w0 * h0 * 4;
      const r = id != null ? items.get(id) : null, on = !r || r.on;
      if (!on) offN++;
      if (wk.storeCap(cv) !== undefined) capped++;
      const lw = +cv.offsetWidth || 0, d = lw > 0 ? w0 / lw : wk.storedDensity(cv); // (the layout box when there is one: the truth)
      if (d > 0) { const q = d / (raw * k); if (q < minD) minD = q; if (on && q < onMin) onMin = q; }
    }
    const R = v => (isFinite(v) ? Math.round(v * 1e4) / 1e4 : null);
    return { n, bytes, minDensity: R(minD), onMin: R(onMin), offN, capped, budget: wk.CANVAS_BUDGET, planned, k, dpr: raw };
  }
  function schedule() { scrDirty = true; request(); }
  // which items are on screen: from the cached rects after each written frame, so off-screen live displays pause
  // (and resume CULL_MARGIN screen px before they show again); 'screen' carries the changes only
  function screen() {
    scrDirty = false;
    if (!(vp.width > 0) || !(vp.height > 0)) return; // (a hidden canvas: everything keeps its state)
    const list = [];
    for (const [id, r] of items) list.push({ id, rect: r.rect });
    const p = planScreen(list, cam, vp.width, vp.height), on = [], off = [];
    const set = (id, v) => {
      const r = items.get(id);
      if (!r || r.on === v) return;
      r.on = v;
      (v ? on : off).push(id);
      if (typeof r.item.onScreen === 'function') { try { r.item.onScreen(v); } catch (err) { console.error(err); } }
    };
    for (const id of p.on) set(id, true);
    for (const id of p.off) set(id, false);
    if (on.length || off.length) emit('screen', { on, off });
  }
  function budget() { // the soft DOM budget: an event and a warning per crossing, nothing visible
    let cost = 0;
    for (const r of items.values()) cost += r.item.cost > 0 ? +r.item.cost : 0;
    const over = cost > BUDGET_EL;
    if (over === overBudget) return;
    overBudget = over;
    if (over) { try { console.warn('cv-world: ' + cost + ' elements on the canvas (budget ' + BUDGET_EL + ')'); } catch (err) { /* no console */ } }
    emit('budget', { over, cost });
  }
  function add(item) {
    if (!item || item.id == null) throw new Error('cv-world.add: an item needs an id');
    const id = String(item.id);
    if (items.has(id)) remove(id);
    const rec = { item, rect: null, on: true }; // (on screen until the plan says otherwise: nothing changes at add)
    items.set(id, rec);
    cacheRect(rec);
    if (sel === id) attr(item.el, 'data-cv-sel', true);
    if (editId === id) attr(item.el, 'data-cv-edit', true);
    budget();
    schedule();
    return () => { if (items.get(id) === rec) remove(id); };
  }
  function remove(id) {
    id = String(id);
    const rec = items.get(id);
    if (!rec) return;
    items.delete(id);
    attr(rec.item.el, 'data-cv-sel', false); attr(rec.item.el, 'data-cv-edit', false);
    if (selSet.delete(id)) { if (sel === id) sel = selSet.size ? [...selSet].pop() : null; emit('select', { id: sel, ids: [...selSet] }); }
    mapDirty = true;
    if (editId === id) { editId = null; emit('edit', { id: null }); }
    budget();
  }
  function clear() { for (const id of [...items.keys()]) remove(id); selSet.clear(); sel = null; focusBack = null; editSup = false; pin = null; mapDirty = true; }
  function update(id) {
    if (id == null) recache(); else if (items.has(String(id))) recache(String(id)); else return;
    // (1h) a drop / fold / resize: the faces' overlap rule over the new rect (IMPL-1h §3.5 "on update") — not in a burst
    // (recheck reads the decos' offsets); the burst's end runs it
    if (GL && !B) { try { FACES.recheck(); } catch (err) { console.error(err); } }
  }

  /* ---- selection and edit state */
  // select(id): only it (null: nothing); {keep}: a member of a selection of several keeps them (a move of the group);
  // {add}: Shift-click toggles it in or out of the selection
  function select(id, o) {
    id = id == null ? null : String(id);
    if (id !== null && !items.has(id)) id = null;
    const keep = o && o.keep && id && selSet.has(id), add = o && o.add && id;
    editSup = false;
    const was = [...selSet].join('\n') + '|' + sel;
    if (add) {
      if (selSet.has(id)) { selSet.delete(id); if (sel === id) sel = selSet.size ? [...selSet].pop() : null; } else { selSet.add(id); sel = id; }
    } else if (keep) sel = id;
    else { selSet.clear(); if (id) selSet.add(id); sel = id; }
    paintSel();
    if (([...selSet].join('\n') + '|' + sel) !== was) { mapDirty = true; request(); emit('select', { id: sel, ids: [...selSet] }); }
    computeEdit();
  }
  function selectMany(ids) {
    const want = (ids || []).map(String).filter(x => items.has(x));
    const was = [...selSet].join('\n') + '|' + sel;
    selSet.clear();
    for (const x of want) selSet.add(x);
    sel = want.length ? want[want.length - 1] : null;
    editSup = false;
    paintSel();
    if (([...selSet].join('\n') + '|' + sel) !== was) { mapDirty = true; request(); emit('select', { id: sel, ids: [...selSet] }); }
    computeEdit();
  }
  function paintSel(extra) { for (const [k, r] of items) attr(r.item.el, 'data-cv-sel', selSet.has(k) || (!!extra && extra.has(k))); }
  function computeEdit() { // edit state: selected, not left (tap outside / Escape), and k ≥ EDIT_K (or ≥ a double-tap's fit)
    if (pin && (pin.id !== sel || editSup || (anim ? anim.c1 : cam).k < pin.k - 0.02)) pin = null; // (zoomed out past it: over)
    const kOk = cam.k >= EDIT_K - 1e-9 || (!!pin && pin.id === sel);
    const e = sel && selSet.size <= 1 && !editSup && items.has(sel) && kOk ? sel : null; // (a selection of several: no edit state)
    if (e === editId) return;
    if (editId && items.has(editId)) attr(items.get(editId).item.el, 'data-cv-edit', false);
    editId = e;
    if (e) attr(items.get(e).item.el, 'data-cv-edit', true);
    emit('edit', { id: editId });
  }
  const modOf = t => { // the world item the node lies in (its [data-cv-mod] root), or null
    for (let n = t; n && n !== viewport && typeof n.getAttribute === 'function'; n = n.parentNode) {
      const id = n.getAttribute('data-cv-mod');
      if (id != null) return items.has(id) ? id : null;
    }
    return null;
  };
  const inside = (el, t) => { for (let n = t; n; n = n.parentNode) if (n === el) return true; return false; };

  /* ---- the world's own pointer gestures */
  const take = e => { if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation(); if (e.cancelable !== false && typeof e.preventDefault === 'function') e.preventDefault(); };
  const capture = (id, on) => { try { if (on) viewport.setPointerCapture(id); else viewport.releasePointerCapture(id); } catch (err) { /* pointer gone */ } };
  const vvScale = () => { const v = win.visualViewport; return v && +v.scale > 0 ? +v.scale : 1; };
  function startPan(e, mid, guard) { // guard: a press the momentum guard took (its tap is no tap, its click no click)
    glide = null;
    if (anim) { anim = null; settle(); } // a press stops an animation where it is
    const x = e.clientX, y = e.clientY, t = now();
    G = { kind: 'pan', id: e.pointerId, type: e.pointerType || 'mouse', mid: !!mid, x, y, px: x, py: y, x0: x, y0: y, t0: t,
      moved: false, s: [[x, y, t]], tgt: e.target, noGlide: false, guard: !!guard, empty: e.target === viewport || e.target === W };
    capture(e.pointerId, true);
  }
  function panMove(e) {
    const x = e.clientX, y = e.clientY;
    G.px = x; G.py = y;
    if (!G.moved) {
      if (Math.hypot(x - G.x0, y - G.y0) <= (TAP_PX[G.type] || 4)) return;
      // a finger held still on empty canvas, then dragged: a marquee (SPEC §4.1), not a pan
      if (G.type === 'touch' && G.empty && !G.mid && !G.guard && !G.sleep && now() - G.t0 >= MARQUEE_HOLD_MS) { toMarquee(G); marqueeMove(e); return; }
      G.moved = true; // the travel since the press follows at once
    }
    const t = now();
    if (!locked) cam = panCam(cam, x - G.x, y - G.y); // (the view locked: still a drag — never a tap, its click eaten — the camera stays)
    G.x = x; G.y = y;
    G.s.push([x, y, t]);
    while (G.s.length > 2 && t - G.s[0][2] > 100) G.s.shift();
    if (locked) return;
    moved(false);
    request();
  }
  function toPinch(e) { // the late finger (or the guard's): the pan becomes a pinch with the same rebase maths
    const a = { id: G.id, x: G.px, y: G.py }, b = { id: e.pointerId, x: e.clientX, y: e.clientY };
    G = { kind: 'pinch', type: 'touch', a, b, base: null, last: null, zoomOn: false, moved: true };
    G.base = G.last = pframe();
    capture(b.id, true);
  }
  function pframe() { const { a, b } = G; return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; }
  function pinchMove(e) {
    const p = e.pointerId === G.a.id ? G.a : e.pointerId === G.b.id ? G.b : null;
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    const f = pframe(), L = G.last;
    G.last = f;
    if (locked) return; // (the view locked: the two fingers are still the world's — nothing pressed — the camera stays)
    cam = panCam(cam, f.cx - L.cx, f.cy - L.cy);
    if (G.zoomOn) { if (L.d > 0 && f.d > 0) cam = zoomAbout(cam, f.d / L.d, f.cx - vp.left, f.cy - vp.top); }
    else if (Math.abs(f.d - G.base.d) > PINCH_PX / vvScale()) G.zoomOn = true; // from here f starts at 1: no jump
    moved(false);
    request();
  }
  function pinchLift(id) { // one finger up: the other pans on (no glide)
    const left = id === G.a.id ? G.b : id === G.b.id ? G.a : null;
    if (!left) return;
    capture(id, false);
    clickUntil = now() + 350; // (the lifted finger's click is the pinch's)
    G = { kind: 'pan', id: left.id, type: 'touch', mid: false, x: left.x, y: left.y, px: left.x, py: left.y, x0: left.x, y0: left.y,
      t0: now(), moved: true, s: [], tgt: null, noGlide: true };
  }
  /* ---- the marquee (selects the items it touches; drawn in #overlay, local to it) */
  function toMarquee(g) {
    const box = doc && OV ? doc.createElement('div') : null;
    if (box) { box.className = 'cv-marquee'; OV.append(box); }
    G = { kind: 'marquee', id: g.id, type: g.type, x0: g.x0, y0: g.y0, x: g.x0, y: g.y0, box, moved: true, hits: new Set() };
    attr(viewport, 'data-cv-marquee', true);
  }
  function marqueeRect() { // world rect of the marquee
    const a = toWorld(cam, G.x0 - vp.left, G.y0 - vp.top), b = toWorld(cam, G.x - vp.left, G.y - vp.top);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  }
  function marqueeMove(e) {
    G.x = e.clientX; G.y = e.clientY;
    if (G.box) {
      const l = Math.min(G.x0, G.x) - ovO.left, t = Math.min(G.y0, G.y) - ovO.top, st = G.box.style;
      st.left = l + 'px'; st.top = t + 'px'; st.width = Math.abs(G.x - G.x0) + 'px'; st.height = Math.abs(G.y - G.y0) + 'px';
    }
    const list = [];
    for (const [id, r] of items) list.push({ id, rect: r.rect });
    G.hits = new Set(inRect(list, marqueeRect()));
    paintSel(G.hits); // (live: what it touches shows selected)
  }
  function marqueeEnd(ok) {
    const g = G;
    G = null;
    capture(g.id, false);
    if (g.box) { try { g.box.remove(); } catch (err) { /* gone */ } }
    attr(viewport, 'data-cv-marquee', false);
    clickUntil = now() + 350;
    if (ok) selectMany([...g.hits]); else paintSel();
  }
  function endGesture(glideToo) { // the pan ends where it is (a two-finger cancel, Escape, native, hidden)
    if (!G) return;
    if (G.kind === 'marquee') { marqueeEnd(false); return; }
    const g = G;
    G = null;
    if (g.moved) clickUntil = now() + 350;
    if (g.kind === 'pinch') { capture(g.a.id, false); capture(g.b.id, false); } else capture(g.id, false);
    if (glideToo) glide = null;
    settle();
  }
  function velocity(g) {
    const s = g.s, t = now();
    if (s.length < 2) return null;
    const a = s[0], b = s[s.length - 1], dt = b[2] - a[2];
    if (t - b[2] > 60 || dt < 8) return null; // the finger stopped before it lifted
    let vx = (b[0] - a[0]) / dt, vy = (b[1] - a[1]) / dt;
    const v = Math.hypot(vx, vy);
    if (v < GLIDE_MIN) return null;
    if (v > GLIDE_MAX) { vx *= GLIDE_MAX / v; vy *= GLIDE_MAX / v; }
    return { vx, vy };
  }
  function stepGlide(T) {
    const dt = Math.min(50, Math.max(0, T - glide.t));
    glide.t = T;
    if (!dt) return;
    cam = panCam(cam, glide.vx * dt, glide.vy * dt);
    moved(false);
    const d = Math.exp(-dt / GLIDE_TAU);
    glide.vx *= d; glide.vy *= d;
    if (Math.hypot(glide.vx, glide.vy) < GLIDE_STOP) { glide = null; glideEnd = T; write(); settle(); }
  }
  function tap(g, e) {
    if (g.mid) return;
    const t = g.tgt, T = now();
    if (g.sleep) { // a tap on a sleeping module selects it; a double-tap focuses it (100 % or its width: edit state)
      clickUntil = T + 350; // (its click is the world's: the control under it never sees it)
      if (lastTap && lastTap.id === g.sleep && T - lastTap.t <= DTAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <= DTAP_PX) {
        lastTap = null;
        if (items.has(g.sleep)) focusItem(g.sleep, { animate: true });
        return;
      }
      lastTap = { t: T, x: e.clientX, y: e.clientY, id: g.sleep };
      select(g.sleep);
      return;
    }
    if (t === viewport || t === W) {
      if (!locked && lastTap && !lastTap.id && T - lastTap.t <= DTAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <= DTAP_PX) { lastTap = null; fit({ animate: true }); return; }
      lastTap = { t: T, x: e.clientX, y: e.clientY };
      select(null);
      return;
    }
    lastTap = null;
    const id = modOf(t);
    if (id) select(id);
  }
  function focusVp() { try { if (doc && doc.activeElement !== viewport && typeof viewport.focus === 'function') viewport.focus({ preventScroll: true }); } catch (err) { /* inert */ } }
  // capture phase on the viewport (after gesture.js's window listeners): the momentum guard, the late finger, and a tap
  // outside the module in edit state
  function onDownCap(e) {
    pressT = now();
    if (!active) return;
    const ed = editId && items.get(editId);
    outside = ed && !inside(ed.item.el, e.target) ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
    if (J && e.pointerId !== J.id && (e.isPrimary === true || J.type !== (e.pointerType || 'mouse'))) { const j = J; J = null; jackStop(j); } // (stale: its lift was lost)
    if (J && e.pointerId !== J.id && e.pointerType === 'touch') { // a second finger during a cable drag: two fingers win
      const j = J;
      J = null;
      jackStop(j);
      if (native || G) return;
      take(e);
      if (pinchMode !== 'canvas') { clickUntil = now() + 350; return; } // ('Zoom page': the browser's pinch has both)
      G = { kind: 'pan', id: j.id, type: 'touch', px: j.x, py: j.y };
      capture(j.id, true);
      toPinch(e);
      return;
    }
    if (!G && !J && (e.button === 0 || e.button == null) && typeof hooks.jack === 'function') { // (under native zoom too: a control)
      const je = jackOf(e.target);
      let r = false;
      if (je) { try { r = hooks.jack(e, je); } catch (err) { console.error(err); r = false; } }
      if (r) {
        take(e);
        J = { id: e.pointerId, type: e.pointerType || 'mouse', x: e.clientX, y: e.clientY, cancel: r && typeof r.cancel === 'function' ? r.cancel : null };
        return;
      }
    }
    if (native) return;
    if (G && (e.pointerType === 'touch' ? e.isPrimary === true : G.type !== 'touch')) endGesture(true); // a stale pan (its lift was lost)
    if (G && e.pointerType === 'touch' && G.type === 'touch') { // a further touch while the world's touch pan runs
      take(e);
      if (pinchMode !== 'canvas') { endGesture(true); clickUntil = now() + 350; return; } // 'Zoom page': the pan stops, the browser's pinch has both (no click)
      if (G.kind === 'marquee' && e.pointerId !== G.id) { // two fingers win over a finger's marquee: it ends, unapplied, and pinches
        const g = G;
        marqueeEnd(false);
        G = { kind: 'pan', id: g.id, type: 'touch', px: g.x, py: g.y };
        capture(g.id, true);
      }
      if (G.kind === 'pan' && e.pointerId !== G.id) toPinch(e);
      return;
    }
    if (glide || now() - glideEnd < MOMENTUM_GUARD_MS) { // the iOS scroll-view rule: this touch only stops the glide
      take(e);
      glide = null; glideEnd = -1e9;
      if (!G) startPan(e, false, true);
      return;
    }
    // controls sleep below READ_K (the cards used to keep a zoomed-out pan from turning whatever knob it landed on; now
    // nothing changes look, so the protection is behaviour only): a press in a module body that is not in edit state
    // pans; a tap selects the module, a double-tap focuses it (edit state wakes its controls). Bars, jacks: as always
    const id = cam.k < READ_K - 1e-9 && !G && (e.button === 0 || e.button == null) ? sleeper(e.target) : null;
    if (id) { take(e); startPan(e, false, false); G.sleep = id; }
  }
  function jackOf(t) { // the [data-cv-jack] t lies in (inside a world item), or null
    for (let n = t; n && n !== viewport && typeof n.getAttribute === 'function'; n = n.parentNode) {
      if (n.getAttribute('data-cv-jack') != null) return n;
      if (n.getAttribute('data-cv-mod') != null) return null;
    }
    return null;
  }
  function jackStop(j) { // cancel a cable drag (the hook's answer, else hooks.jackCancel); idempotent on the hook's side
    const f = j && j.cancel ? j.cancel : typeof hooks.jackCancel === 'function' ? hooks.jackCancel : null;
    if (f) { try { f(); } catch (err) { console.error(err); } }
  }
  function sleeper(t) { // the module whose body t lies in, unless t is in its bar or a jack, or the module is in edit state
    for (let n = t; n && n !== viewport && typeof n.getAttribute === 'function'; n = n.parentNode) {
      if (n.getAttribute('data-cv-bar') != null || n.getAttribute('data-cv-jack') != null) return null;
      const id = n.getAttribute('data-cv-mod');
      if (id != null) return items.has(id) && id !== editId ? id : null;
    }
    return null;
  }
  function onDown(e) {
    if (!active || native || G) return;
    const t = e.target, mid = e.button === 1;
    if (e.button !== 0 && !mid) return;
    const empty = t === viewport || t === W;
    if (!mid && !empty && !isBg(t)) return; // controls keep their own pointerdown: only the press target is tested
    if (!mid && empty && e.shiftKey && e.pointerType !== 'touch') { // Shift-drag with the mouse: a marquee (a plain drag pans)
      startPan(e, false); toMarquee(G); e.preventDefault(); focusVp();
      return;
    }
    startPan(e, mid);
    if (mid || e.pointerType !== 'touch') e.preventDefault(); // no text selection, no middle-button autoscroll
    if (empty) focusVp(); // the canvas keys
  }
  function onMove(e) {
    if (J && e.pointerId === J.id) { J.x = e.clientX; J.y = e.clientY; } // (the finger a late second one pinches from)
    if (!G) return;
    if (G.type === 'mouse' && e.pointerId === G.id && e.buttons === 0) { endGesture(true); return; } // released unseen
    if (G.kind === 'pinch') pinchMove(e);
    else if (G.kind === 'marquee') { if (e.pointerId === G.id) marqueeMove(e); }
    else if (e.pointerId === G.id) panMove(e);
  }
  function onUpCap(e) {
    const o2 = outside;
    if (o2 && o2.id === e.pointerId) {
      outside = null;
      if (Math.hypot(e.clientX - o2.x, e.clientY - o2.y) <= 10 && editId) { editSup = true; computeEdit(); }
    }
  }
  function onUp(e) {
    if (J && e.pointerId === J.id) J = null;
    if (!G) return;
    if (G.kind === 'pinch') { pinchLift(e.pointerId); return; }
    if (G.kind === 'marquee') { if (e.pointerId === G.id) marqueeEnd(true); return; }
    if (e.pointerId !== G.id) return;
    const g = G;
    G = null;
    capture(g.id, false);
    if (!g.moved) { if (g.guard) clickUntil = now() + 350; else tap(g, e); settle(); return; }
    clickUntil = now() + 350;
    const v = g.type === 'touch' && !g.noGlide && !locked && !reduced() ? velocity(g) : null;
    if (v) { glide = { vx: v.vx, vy: v.vy, t: now() }; request(); return; }
    settle();
  }
  function onCancel(e) { // the two-finger layer's flagged cancel: the camera stays (never rolled back), no glide
    if (J && e.pointerId === J.id) { const j = J; J = null; if (e.gesture === 'two-finger') jackStop(j); }
    if (!G) return;
    if (G.kind === 'pinch') { if (e.pointerId === G.a.id || e.pointerId === G.b.id) endGesture(true); return; }
    if (e.pointerId === G.id) endGesture(true);
  }
  function onClickCap(e) { // the click that ends a pan (a mouse drag) or a pinch is the gesture's, not a control's
    if (G || now() < clickUntil) { clickUntil = -1e9; take(e); }
  }

  /* ---- wheel, trackpad, Safari gesture events */
  const OVER = /^(auto|scroll|overlay)$/;
  function scrollerTakes(t, dx, dy) { // an overflow scroller between the target and the viewport that can go that way
    const cs = n => { try { return typeof win.getComputedStyle === 'function' ? win.getComputedStyle(n) : null; } catch (err) { return null; } };
    for (let n = t; n && n !== viewport && n !== W && n.nodeType === 1; n = n.parentNode) {
      const s = cs(n);
      if (!s) return false;
      if (dy && OVER.test(String(s.overflowY || '')) && (+n.scrollHeight || 0) > (+n.clientHeight || 0) + 1) {
        const p = +n.scrollTop || 0, max = n.scrollHeight - n.clientHeight;
        if (dy < 0 ? p > 0.5 : p < max - 0.5) return true;
      }
      if (dx && OVER.test(String(s.overflowX || '')) && (+n.scrollWidth || 0) > (+n.clientWidth || 0) + 1) {
        const p = +n.scrollLeft || 0, max = n.scrollWidth - n.clientWidth;
        if (dx < 0 ? p > 0.5 : p < max - 0.5) return true;
      }
    }
    return false;
  }
  const wheelMul = e => (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? Math.max(100, vp.height || 400) : 1);
  // an own zone (a zoomPan editor: its Ctrl-wheel zooms itself) in a world module — hovered, as today (SPEC §4.1 table;
  // the touch rule's edit state is for two fingers only: a hovered wheel is never a camera pinch that landed on a graph)
  const editorZone = t => {
    for (let n = t; n && n !== viewport && typeof n.getAttribute === 'function'; n = n.parentNode) {
      if (n.getAttribute('data-gesture') === 'own') return !!modOf(n);
    }
    return false;
  };
  // capture phase: a trackpad pinch (Chrome, Firefox) or Ctrl/⌘-wheel zooms the camera at the pointer before any knob
  // under it could take it as a turn (a pinch is never a knob's); a hovered editor keeps its own zoom — except while the
  // camera's own zoom runs (the veto: a graph that slid under the pointer, or a pause in the pinch, keeps it the camera's)
  function onWheelCap(e) {
    if (!active || native || e.defaultPrevented || !(e.ctrlKey || e.metaKey) || (editorZone(e.target) && !wheelVeto())) return;
    e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    if (locked) return; // (the view locked: taken all the same — never a knob's turn, never the page's zoom)
    const f = Math.exp(-(e.deltaY || 0) * wheelMul(e) * 0.002);
    glide = null; anim = null;
    cam = zoomAbout(cam, f, e.clientX - vp.left, e.clientY - vp.top);
    moved(true); request();
  }
  function onWheel(e) { // bubble phase: what no knob, editor or scroller took pans the camera
    if (!active || native || e.defaultPrevented || e.ctrlKey || e.metaKey) return;
    const m = wheelMul(e);
    let dx = (e.deltaX || 0) * m, dy = (e.deltaY || 0) * m;
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    if (!dx && !dy) return;
    if (now() - movedAt > WHEEL_VETO_MS && scrollerTakes(e.target, dx, dy)) return; // (not one sliding under a moving camera)
    e.preventDefault();
    if (locked) return; // (the view locked: the page never scrolls nor swipes back either)
    glide = null; anim = null;
    cam = panCam(cam, -dx, -dy);
    moved(true); request();
  }
  function onGesture(e) { // Safari's trackpad pinch; on a touch screen the two-finger layer's hooks do it (touches down)
    if (!active || native || touches > 0) { gs = null; return; }
    if (e.type === 'gesturestart') { e.preventDefault(); gs = +e.scale || 1; return; }
    if (gs == null) return;
    e.preventDefault();
    if (e.type === 'gestureend') { gs = null; return; }
    const s = +e.scale || 1, f = s / gs;
    gs = s;
    if (locked || f === 1 || !isFinite(f)) return; // (locked: prevented — no page zoom — and the camera stays)
    const x = isFinite(e.clientX) ? e.clientX : vp.left + vp.width / 2, y = isFinite(e.clientY) ? e.clientY : vp.top + vp.height / 2;
    glide = null; anim = null;
    cam = zoomAbout(cam, f, x - vp.left, y - vp.top);
    moved(true); request();
  }

  /* ---- the two-finger layer's hooks (gesture.js) */
  function claims(at) {
    if (!active || native || destroyed || !at || !isFinite(at.cx) || !isFinite(at.cy)) return false;
    const b = bandNow();
    return at.cx >= b.left && at.cx <= b.right && at.cy >= b.top && at.cy <= b.bottom;
  }
  const hooks = {
    pan(sx, sy, at) { // 'Zoom page' (SPEC §4.3): two fingers are the browser's — the canvas pans with one finger only
      if (pinchMode !== 'canvas' || !claims(at)) return false;
      if (locked || (!sx && !sy)) return true; // (locked: the canvas's all the same — no scroller, no page — and nothing moves)
      stopMotion();
      cam = panCam(cam, -sx, -sy);
      moved(true, true); write(); schedule(); // (on screen: planned in the next frame from the cached rects)
      return true;
    },
    zoom(f, cx, cy, at) {
      if (pinchMode !== 'canvas' || !claims(at)) return false;
      if (locked || f === 1 || !(f > 0) || !isFinite(f)) return true;
      stopMotion();
      cam = zoomAbout(cam, f, cx - vp.left, cy - vp.top);
      moved(true, true); write(); schedule();
      return true;
    },
  };

  /* ---- native page zoom: hand everything back (SPEC §4.3) */
  function checkNative() {
    const on = vvScale() > 1.001;
    bandC = null;
    if (on === native) return;
    native = on;
    attr(viewport, 'data-cv-native', on);
    if (on) { endGesture(true); stopMotion(); settle(); }
    if (TB.chip) TB.chip.hidden = !on;
    emit('native', { on });
  }

  /* ---- drags: edge auto-pan and the drop outline */
  function dragPointer(p) {
    away(1, !!p); // (a module / cable / tray drag: the minimap steps aside, U14)
    if (!p || locked) { if (edge) { edge = null; settle(); } return; } // (the view locked: no edge pan)
    if (!edge) { edge = { p, st: {}, last: -1, v: false, bt: -1e9, b: null }; }
    edge.p = { x: +p.x || 0, y: +p.y || 0, pointerType: p.pointerType || 'mouse' };
    const t = now();
    if (!edge.v && t - edge.bt > 100) { edge.b = vis(); edge.bt = t; } // (trays close as a drag leaves them)
    // every position counts for arming (as dragSource's asPlan per move), not only the ones a frame samples: the drag's
    // start point and a quick move into a zone before the next frame
    wk.edgePan2(edge.b || bandNow(), { x: edge.p.x, y: edge.p.y, pointerType: edge.p.pointerType, t }, edge.st);
    request();
  }
  function stepEdge(T) {
    const v = wk.edgePan2(edge.b || bandNow(), { x: edge.p.x, y: edge.p.y, pointerType: edge.p.pointerType, t: T }, edge.st);
    const was = edge.v, dt = edge.last < 0 ? 0 : Math.min(50, T - edge.last);
    edge.v = edge.st.t0 >= 0; // an edge asks (its ramp runs: the first frame's speed is 0)
    edge.last = edge.v ? T : -1;
    if ((v.vx || v.vy) && dt > 0) { cam = panCam(cam, -v.vx * dt / 1000, -v.vy * dt / 1000); moved(false); }
    if (was && !edge.v) settle();
  }
  function ghost(g) {
    if (!g) { if (gh) { gh.g = null; gh.rect = null; gh.el.hidden = true; } return null; }
    if (!OV || !doc) return null;
    if (!gh) {
      const el = doc.createElement('div'), lab = doc.createElement('span');
      el.className = 'cv-ghost'; lab.className = 'cv-ghost-label';
      el.setAttribute('aria-hidden', 'true');
      el.append(lab);
      OV.append(el);
      gh = { el, lab, g: null, rect: null, text: null };
    }
    gh.g = g; gh.el.hidden = false;
    return placeGhost();
  }
  function placeGhost() {
    const g = gh.g, w = Math.max(0, +g.w || 0), h = Math.max(0, +g.h || 0);
    const p = toWorld(cam, g.x - vp.left, g.y - vp.top);
    let x = p.x - (g.dx != null ? +g.dx : w / 2), y = p.y - (g.dy != null ? +g.dy : h / 2);
    if (g.snap !== false && snapping) { x = snap(x); y = snap(y); }
    const l = toLocal(cam, x, y), s = gh.el.style;
    s.transform = 'translate(' + (l.x + vp.left - ovO.left) + 'px, ' + (l.y + vp.top - ovO.top) + 'px)';
    s.width = w * cam.k + 'px'; s.height = h * cam.k + 'px';
    const text = g.label || '';
    if (text !== gh.text) { gh.text = text; gh.lab.textContent = text; }
    if (text) { // the label stays in the visible part of the box (a true-size outline may be taller than the canvas)
      const b = bandNow(), ox = l.x + vp.left, oy = l.y + vp.top;
      const dx = Math.max(0, Math.min(b.left - ox, w * cam.k - 180)), dy = Math.max(0, Math.min(b.top - oy, h * cam.k - 36));
      gh.lab.style.transform = dx || dy ? 'translate(' + Math.round(dx) + 'px, ' + Math.round(dy) + 'px)' : '';
    }
    gh.rect = { x, y, w, h };
    return { x, y, w, h };
  }

  /* ---- keys */
  const formCtl = t => !!t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName || '') || t.isContentEditable === true);
  function canvasFocus(t) { // the viewport itself, a module root or something in its top bar (not a form control)
    if (!t || formCtl(t)) return false;
    if (t === viewport) return true;
    for (let n = t; n && n !== viewport && typeof n.getAttribute === 'function'; n = n.parentNode) {
      if (n.getAttribute('data-cv-bar') != null) return true;
      if (n.getAttribute('data-cv-mod') != null) return n === t;
    }
    return false;
  }
  function nudge(id, dx, dy) {
    const r = items.get(id), it = r && r.item;
    if (!it) return false;
    if (typeof it.nudge === 'function') it.nudge(dx, dy);
    else if (typeof it.onMove === 'function') {
      const q = it.rect(), x = (snapping ? snap(q.x) : q.x) + dx, y = (snapping ? snap(q.y) : q.y) + dy;
      if (typeof it.setPos === 'function') it.setPos(x, y);
      it.onMove(x, y, 'start'); it.onMove(x, y, 'end');
    } else return false;
    update(id);
    return true;
  }
  function key(e) {
    if (!active || !e || e.defaultPrevented || e.altKey) return false;
    if (!canvasFocus(doc && doc.activeElement)) return false;
    const k = String(e.key || ''), mod = e.metaKey || e.ctrlKey;
    if (mod) { // ⌘/Ctrl-A: select every item (the page's text is not the canvas's)
      if (k.toLowerCase() === 'a' && !e.shiftKey) { e.preventDefault(); selectMany([...items.keys()]); return true; }
      return false;
    }
    if (k === '0') { e.preventDefault(); if (!locked) fit({ animate: true }); return true; } // (locked: the canvas's key, no move)
    if (k === '1') { e.preventDefault(); if (!locked) zoomTo(1, { animate: true }); return true; }
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
    if (d && sel) {
      const s = (snapping ? DOT : GRID) * (e.shiftKey ? 4 : 1); // a dot at a time while snapping, else the fine step
      if (!nudge(sel, d[0] * s, d[1] * s)) return false;
      e.preventDefault();
      return true;
    }
    return false;
  }
  function escape() {
    if (J) { const j = J; J = null; jackStop(j); return true; } // (a cable drag)
    if (G) { endGesture(true); return true; }
    if (editId) { editSup = true; computeEdit(); return true; }
    if (sel || selSet.size) { select(null); return true; }
    return false;
  }

  /* ---- the floating toolbar (#cvToolbar): ⊖ 100% ⊕ · fit · tidy · snap · lock · map · ∿ (2a: mod cables) · the native-zoom chip */
  const TB = {};
  const ICON = {
    out: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10"/></svg>',
    in: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10M10 5v10"/></svg>',
    fit: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4"/><rect x="7" y="7.5" width="6" height="5" rx="1"/></svg>',
    tidy: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="5" width="5" height="10" rx="1"/><rect x="9.5" y="5" width="3.5" height="7" rx="1"/><rect x="15" y="5" width="2.5" height="5" rx="0.8"/></svg>',
    mods: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 10c2-5 4-5 5 0s3 5 5 0 4-5 5 0"/></svg>',
    tools: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5"/><path d="M12.2 12.2 17 17M6 8.5h5M8.5 6v5"/></svg>',
    snap: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3.5v6.5a5 5 0 0 0 10 0V3.5M5 7h3M12 7h3"/><circle cx="4" cy="17" r="0.9"/><circle cx="10" cy="17" r="0.9"/><circle cx="16" cy="17" r="0.9"/></svg>',
    map: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="1.5"/><rect x="5" y="6.5" width="4" height="3"/><rect x="10.5" y="8" width="4.5" height="5"/></svg>',
    lock: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9M10 12.2v1.6"/></svg>',
    unlock: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 5.8-1.1M10 12.2v1.6"/></svg>',
  };
  function buildToolbar(host) {
    if (!host || !doc) return;
    const mk = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
    const btn = (name, label, icon, fn) => {
      const b = mk('button', 'cv-tb-btn');
      b.type = 'button';
      b.setAttribute('data-cv-tb', name);
      b.setAttribute('aria-label', label);
      b.title = label;
      if (icon) b.innerHTML = icon;
      if (fn) listen(b, 'click', e => { e.preventDefault(); fn(); });
      return b;
    };
    const bar = mk('div', 'cv-tb');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Canvas');
    const fold = btn('tools', 'Canvas tools', ICON.tools, () => { const on = !bar.hasAttribute('data-open'); attr(bar, 'data-open', on); fold.setAttribute('aria-expanded', String(on)); });
    fold.setAttribute('aria-expanded', 'false');
    const row = mk('div', 'cv-tb-row');
    const pct = btn('pct', 'Zoom 100 %', '', () => zoomTo(1, { animate: true }));
    pct.classList.add('cv-tb-pct');
    pct.textContent = '100%';
    const snapB = btn('snap', 'Snap to grid', ICON.snap, () => setSnap(!snapping));
    const lockB = btn('lock', 'Lock view', ICON.unlock, () => setLock(!locked));
    const mapB = btn('map', 'Minimap', ICON.map, () => setMap(!mapOn));
    const mods = btn('mods', 'Modulation cables', ICON.mods, () => setModsMode(MODS_MODES[(MODS_MODES.indexOf(modsMode) + 1) % MODS_MODES.length]));
    const chip = mk('button', 'cv-tb-chip');
    chip.type = 'button';
    chip.setAttribute('data-cv-tb', 'native');
    chip.textContent = 'page zoomed · 1:1';
    chip.title = 'The page is zoomed by the browser: pinch out to return to 1:1 (the canvas takes its gestures back there)';
    chip.hidden = true;
    let hintT = 0;
    listen(chip, 'click', () => { chip.textContent = 'pinch out to 1:1'; unlater(hintT); hintT = later(() => { chip.textContent = 'page zoomed · 1:1'; }, 2500); });
    row.append(
      btn('out', 'Zoom out', ICON.out, () => stepZoom(-1)), pct, btn('in', 'Zoom in', ICON.in, () => stepZoom(1)), mk('span', 'cv-tb-sep'),
      btn('fit', 'Fit all (0)', ICON.fit, () => fit({ animate: true })),
      btn('tidy', 'Tidy: lay the modules out again', ICON.tidy, () => { if (typeof o.onTidy === 'function') o.onTidy(); }),
      snapB, lockB, mapB, mods);
    bar.append(fold, row, chip);
    host.append(bar);
    Object.assign(TB, { bar, row, pct, chip, fold, snap: snapB, lock: lockB, map: mapB, mods });
    buildMap(host);
    snapUI(); lockUI(); mapUI(); modsUI();
    offs.push(() => { unlater(hintT); try { bar.remove(); } catch (err) { /* gone */ } });
  }

  /* ---- the minimap (toolbar): the item rects and the visible area; drag to pan, tap to centre */
  function buildMap(host) {
    const cv = doc.createElement('canvas'), el = doc.createElement('div');
    el.className = 'cv-minimap';
    el.setAttribute('role', 'img'); el.setAttribute('aria-label', 'Minimap: drag to move the view, tap to centre it');
    el.title = 'Minimap: drag to move the view, tap to centre it';
    el.append(cv);
    host.append(el);
    MM = { el, cv, drag: null, fit: null };
    listen(cv, 'pointerdown', mapDown);
    listen(cv, 'pointermove', mapMove);
    listen(cv, 'pointerup', mapUp);
    listen(cv, 'pointercancel', mapUp);
    listen(cv, 'contextmenu', e => e.preventDefault());
    offs.push(() => { try { el.remove(); } catch (err) { /* gone */ } });
  }
  // (U14) while a drag runs (a module's, a cable's, a tray tile's: dragPointer; bit 2 a caller's hold, setDragging) the
  // toolbar takes no press and the minimap steps aside ([data-cv-drag]: style.css), so a drop there reaches the module under it
  let awayB = 0;
  function away(bit, on) {
    const was = awayB;
    awayB = on ? awayB | bit : awayB & ~bit;
    if (!!was !== !!awayB) attr(o.toolbar, 'data-cv-drag', !!awayB);
  }
  function mapUI() {
    if (MM) attr(MM.el, 'hidden', !mapOn);
    if (TB.map) { TB.map.setAttribute('aria-pressed', String(mapOn)); TB.map.title = 'Minimap: ' + (mapOn ? 'shown' : 'hidden'); TB.map.setAttribute('aria-label', TB.map.title); }
  }
  function setMap(on) {
    on = !!on;
    if (on === mapOn) return;
    mapOn = on;
    mapUI();
    if (store) { try { store.set(MAP_PREF, on); } catch (err) { /* storage */ } }
    if (on) { mapDirty = true; request(); }
  }
  const viewRectW = () => { const b = bandBox(bandNow()); return { x: (b.x - cam.tx) / cam.k, y: (b.y - cam.ty) / cam.k, w: b.w / cam.k, h: b.h / cam.k }; };
  function drawMap() { // cached rects only (no layout read); the mapping is frozen while the map is being dragged
    mapDirty = false;
    if (!MM || !(vp.width > 0)) return;
    const c = MM.cv, ctx = typeof c.getContext === 'function' ? c.getContext('2d') : null;
    if (!ctx) return;
    const r = Math.min(2, dpr()), W2 = Math.round(MAP_W * r), H2 = Math.round(MAP_H * r);
    if (c.width !== W2) c.width = W2;
    if (c.height !== H2) c.height = H2;
    const rects = [], view = viewRectW();
    for (const [id, rec] of items) if (rec.rect) rects.push({ id, r: rec.rect });
    const F = MM.drag ? MM.drag.fit : mapFit(rects.map(x => x.r), view, MAP_W, MAP_H);
    MM.fit = F;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    for (const x of rects) {
      const q = x.r, on = selSet.has(x.id);
      ctx.fillStyle = on ? 'rgba(242, 163, 58, 0.75)' : 'rgba(158, 166, 178, 0.45)';
      ctx.fillRect(q.x * F.s + F.ox, q.y * F.s + F.oy, Math.max(2, q.w * F.s), Math.max(2, q.h * F.s));
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'; ctx.lineWidth = 1.25;
    ctx.strokeRect(view.x * F.s + F.ox, view.y * F.s + F.oy, view.w * F.s, view.h * F.s);
  }
  function mapPt(e) { // a pointer on the map → world px (the map's own rect: outside the world, screen = layout px)
    const rc = rectOf(MM.cv), F = (MM.drag && MM.drag.fit) || MM.fit || { s: 1, ox: 0, oy: 0 };
    return { x: (e.clientX - rc.left - F.ox) / F.s, y: (e.clientY - rc.top - F.oy) / F.s };
  }
  function centreOn(wx, wy, animate) { // the visible band's centre over world (wx, wy), the zoom kept
    const b = bandBox(vis());
    setCamera({ tx: b.x + b.w / 2 - wx * cam.k, ty: b.y + b.h / 2 - wy * cam.k, k: cam.k }, { animate });
  }
  function mapDown(e) {
    if (!MM || (e.button != null && e.button !== 0)) return;
    e.preventDefault(); e.stopPropagation();
    if (!MM.fit) drawMap();
    const p = mapPt(e), v = viewRectW(), inside = p.x >= v.x && p.x <= v.x + v.w && p.y >= v.y && p.y <= v.y + v.h;
    MM.drag = { id: e.pointerId, fit: MM.fit, x0: e.clientX, y0: e.clientY, moved: false, off: inside ? { x: p.x - (v.x + v.w / 2), y: p.y - (v.y + v.h / 2) } : { x: 0, y: 0 }, inside };
    try { MM.cv.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
  }
  function mapMove(e) {
    const D = MM && MM.drag;
    if (!D || e.pointerId !== D.id) return;
    if (!D.moved && Math.hypot(e.clientX - D.x0, e.clientY - D.y0) <= 3) return;
    D.moved = true;
    const p = mapPt(e);
    centreOn(p.x - D.off.x, p.y - D.off.y, false);
  }
  function mapUp(e) {
    const D = MM && MM.drag;
    if (!D || e.pointerId !== D.id) return;
    MM.drag = null;
    try { MM.cv.releasePointerCapture(e.pointerId); } catch (err) { /* gone */ }
    if (e.type === 'pointerup' && !D.moved) { const p = mapPt(e); centreOn(p.x, p.y, true); } // a tap: centre there
    mapDirty = true; request();
  }

  /* ---- setup */
  // snap to grid (toolbar toggle, remembered): module moves, drops, nudges and the width grip land on the dots (DOT);
  // Shift / Fine still moves freely while it is on
  function snapUI() { if (TB.snap) { TB.snap.setAttribute('aria-pressed', String(snapping)); TB.snap.title = 'Snap to grid: ' + (snapping ? 'on' : 'off'); TB.snap.setAttribute('aria-label', TB.snap.title); } }
  function setSnap(on) {
    on = !!on;
    if (on === snapping) return;
    snapping = on;
    snapUI();
    if (store) { try { store.set(SNAP_PREF, on); } catch (err) { /* storage */ } }
    emit('snap', on);
  }
  // (2a) the mod cables' visibility (toolbar ∿, remembered: MODS_PREF): Always → On select → Never → Always
  function modsUI() {
    const b = TB.mods;
    if (!b) return;
    b.setAttribute('data-mode', modsMode);
    b.title = 'Modulation cables: ' + MODS_LABEL[modsMode] + ' (tap: ' + MODS_LABEL[MODS_MODES[(MODS_MODES.indexOf(modsMode) + 1) % 3]] + ')';
    b.setAttribute('aria-label', 'Modulation cables: ' + MODS_LABEL[modsMode]);
  }
  function setModsMode(m) {
    if (!MODS_MODES.includes(m) || m === modsMode) return;
    modsMode = m;
    modsUI();
    if (store) { try { store.set(MODS_PREF, m); } catch (err) { /* storage */ } }
    emit('mods', m);
  }
  // lock view (toolbar toggle, remembered): no gesture on the canvas moves the camera (LOCK_PREF); the minimap and the
  // toolbar's zoom / fit buttons still do. Switching it on stops a glide and a drag's edge pan where they are
  function lockUI() {
    attr(viewport, 'data-cv-locked', locked);
    const b = TB.lock;
    if (!b) return;
    b.setAttribute('aria-pressed', String(locked));
    b.title = 'Lock view: ' + (locked ? 'on' : 'off');
    b.setAttribute('aria-label', b.title);
    b.innerHTML = locked ? ICON.lock : ICON.unlock;
  }
  function setLock(on) {
    on = !!on;
    if (on === locked) return;
    locked = on;
    if (on && (glide || edge)) { glide = null; glideEnd = -1e9; edge = null; settle(); }
    lockUI();
    if (store) { try { store.set(LOCK_PREF, on); } catch (err) { /* storage */ } }
    emit('lock', on);
  }
  function setPinchMode(m) {
    pinchMode = m === 'page' ? 'page' : 'canvas';
    attr(viewport, 'data-cv-pinch', pinchMode);
    if (store) { try { store.set(PINCH_PREF, pinchMode); } catch (err) { /* storage */ } }
  }
  function setActive(on) {
    on = !!on;
    if (on === active) { if (on) resize(); return; }
    active = on;
    if (!on) { endGesture(true); stopMotion(); edge = null; if (B) endBurst(); outside = null; if (J) { const j = J; J = null; jackStop(j); } }
    else resize();
  }
  function onFocusIn(e) { // keyboard focus (Tab) or a text field brings its control on screen; a press's target already is
    const t = e.target;
    if (!t || t === W || !active) return;
    if (now() - pressT < 600 && !formCtl(t)) return;
    reveal(t);
  }
  function onVV() {
    checkNative();
    const a = doc && doc.activeElement; // the software keyboard came or went: keep the field being typed in on screen
    if (a && formCtl(a) && inside(W, a) && !native) reveal(a);
  }

  pinchMode = store && store.get && store.get(PINCH_PREF, 'canvas') === 'page' ? 'page' : 'canvas';
  snapping = !(store && store.get && store.get(SNAP_PREF, true) === false);
  mapOn = !(store && store.get && store.get(MAP_PREF, true) === false);
  locked = !!(store && store.get && store.get(LOCK_PREF, false) === true);
  { const m = store && store.get ? store.get(MODS_PREF, 'always') : 'always'; modsMode = MODS_MODES.includes(m) ? m : 'always'; }
  attr(viewport, 'data-cv-pinch', pinchMode);
  attr(viewport, 'data-cv-locked', locked);
  try { W.style.setProperty('--ik', '1'); } catch (err) { /* inert */ }
  if (o.layer) wk.setLayer(o.layer);
  wk.setWheelVeto(() => wheelVeto());
  // in-panel drags (Serum tiles / labels, the FX grip: wk.dragSource auto-scroll) pan the camera at the band's edges
  if (typeof wk.setEdgeHook === 'function') wk.setEdgeHook({ pan: p => dragPointer(p), onCamera: cb => api.on('camera', cb) });
  buildToolbar(o.toolbar);
  buildGrid();
  watchDpr();
  listen(viewport, 'pointerdown', onDownCap, true);
  listen(viewport, 'pointerup', onUpCap, true);
  listen(viewport, 'pointerdown', onDown);
  listen(viewport, 'pointermove', onMove, { passive: true });
  listen(viewport, 'pointerup', onUp);
  listen(viewport, 'pointercancel', onCancel);
  listen(viewport, 'click', onClickCap, true);
  listen(viewport, 'wheel', onWheelCap, { capture: true, passive: false });
  listen(viewport, 'wheel', onWheel, { passive: false });
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) listen(viewport, t, onGesture, { passive: false });
  listen(W, 'focusin', onFocusIn);
  listen(W, 'wk-reveal', e => { if (active && e.target && e.target !== W) reveal(e.target); }); // a panel's popover / overlay opened (no scroller here)
  // touches on the glass (any): a hook burst ends when the last lifts; Safari gesture events are ignored meanwhile
  const onTouch = e => { touches = e && e.touches ? e.touches.length : 0; if (!touches && B && B.hook) settle(); };
  for (const t of ['touchstart', 'touchend', 'touchcancel']) listen(win, t, onTouch, { capture: true, passive: true });
  listen(win, 'resize', resize, { passive: true });
  const vv = win.visualViewport;
  if (vv) { listen(vv, 'resize', onVV, { passive: true }); listen(vv, 'scroll', onVV, { passive: true }); }
  let ro = null;
  if (typeof win.ResizeObserver === 'function') { try { ro = new win.ResizeObserver(() => resize()); ro.observe(viewport); } catch (err) { ro = null; } }
  resize();
  checkNative();
  write();

  // no knob takes the wheel for 300 ms after a camera move, nor below READ_K (the controls sleep there: §8.1)
  const wheelVeto = () => movedAt > now() - WHEEL_VETO_MS || cam.k < READ_K - 1e-9;
  const api = {
    el: W, viewport, overlay: OV,
    get cam() { return copy(cam); }, get k() { return cam.k; }, get native() { return native; }, get movedAt() { return movedAt; },
    get selected() { return sel; }, get edit() { return editId; }, get pinchMode() { return pinchMode; },
    get busy() { return !!B; }, get jacking() { return !!J; },
    setCamera, panBy, zoomAt, fit, focusItem, reveal,
    toWorld: (x, y) => toWorld(cam, x - vp.left, y - vp.top),
    toClient: (x, y) => { const l = toLocal(cam, x, y); return { x: l.x + vp.left, y: l.y + vp.top }; },
    band, reserved, add, remove, update, clear, ids: () => [...items.keys()], onScreen: id => { const r = items.get(String(id)); return !!r && r.on; },
    select, selectMany, get selection() { return [...selSet]; }, dragPointer, ghost, setActive, setPinchMode, resize, hooks, wheelVeto, escape, key,
    /** (1g) the grid's draws since the last reset: { n, ms (total), max, dots (the last frame's) }; reset: true zeroes them */
    // (hotfix) moves: the transform writes (a burst's frames); tf: the transform now ('' at rest); w / h / s / r: the store, its reach
    // (1h) on the GL path: the GL draws (n / ms / max; dots 0, moves 0, gl: true; w / h / s: the drawing buffer, r 1)
    gridStats(reset) {
      if (GL) { const s = GL.stats(reset); return { n: s.frames, ms: s.ms, max: s.max, dots: 0, moves: 0, tf: '', gl: true, w: s.w, h: s.h, s: s.d, r: 1 }; }
      const g = GC ? { n: GC.n, ms: GC.ms, max: GC.max, dots: GC.dots, moves: GC.moves, tf: GC.tf, w: GC.w, h: GC.h, s: GC.s, r: GC.r } : { n: 0, ms: 0, max: 0, dots: 0, moves: 0, tf: '', w: 0, h: 0, s: 1, r: 1 };
      if (reset && GC) { GC.n = 0; GC.ms = 0; GC.max = 0; GC.moves = 0; }
      return g;
    },
    /** (1h) null on the 2D path; else GL.stats() (frames, ms, max, bytes, texes, lost, w, h) + FACES.stats() (faces, gl →
     * glFaces, dom, bytes → faceBytes, base, windows, paints, paintMs, paintMax); reset: true zeroes the draw counters */
    glStats(reset) {
      if (!GL) return null;
      const s = GL.stats(reset);
      let f = null;
      try { f = FACES.stats(); } catch (err) { f = null; }
      const out = Object.assign({ gl: true }, s);
      if (f) { for (const k of Object.keys(f)) out[k === 'bytes' ? 'faceBytes' : k === 'gl' ? 'glFaces' : k] = f[k]; }
      return out;
    },
    /** (1h) an item's cached rect { x, y, w, h } (world px), null unknown — never a layout read */
    rectOf: rectById,
    /** (milestone 3 H5) the canvas stores in #world: { n, bytes (Σ now), minDensity / onMin (the least store px per on-screen
     * device px, every canvas / the on-screen ones: ≥ 1 at rest is R3; null: none), offN (in off-screen modules), capped (by
     * the budget), budget, planned (Σ projected at the last rest), k, dpr } — a diagnostic (one layout read per canvas) */
    canvasStats,
    /** (H5) re-plan the stores now (a test / bench hook; the world does it at every rest) → whether a cap changed */
    planStores: () => { const ch = stores(); if (ch) { try { wk.rescaleCanvases(W); } catch (err) { console.error(err); } } return ch; },
    snapOn: () => snapping, setSnap, mapOn: () => mapOn, setMap, lockOn: () => locked, setLock,
    /** (2a) the mod cables' visibility: 'always' | 'select' | 'never' (toolbar ∿, MODS_PREF); a change emits 'mods' */
    modsMode: () => modsMode, setModsMode,
    /** (1e, U14) a drag the caller runs (a tray tile's): the toolbar and the minimap step aside until setDragging(false) */
    setDragging: on => away(2, !!on),
    /** (1e) installs the jack hook (cv-cables createCableDrag): fn(e, jackEl) → truthy | {cancel} takes the press;
     * cancel: the fallback two-finger cancel. Returns a remover (only removes its own hook) */
    setJackHook(fn, cancel) {
      const f = typeof fn === 'function' ? fn : null, c = typeof cancel === 'function' ? cancel : null;
      hooks.jack = f; hooks.jackCancel = c;
      return () => { if (hooks.jack === f) { hooks.jack = null; hooks.jackCancel = null; } };
    },
    on(type, fn) {
      let s = subs.get(type);
      if (!s) subs.set(type, s = new Set());
      s.add(fn);
      return () => s.delete(fn);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (fid) caf(fid);
      fid = 0;
      if (B) unlater(B.timer);
      unlater(glWait); glWait = 0;
      B = null; G = null; J = null; glide = null; anim = null; edge = null;
      for (const f of offs.splice(0)) { try { f(); } catch (err) { /* gone */ } }
      if (ro) { try { ro.disconnect(); } catch (err) { /* gone */ } }
      if (dprMq) { try { dprMq.m.removeEventListener('change', dprMq.f); } catch (err) { /* gone */ } dprMq = null; }
      if (GL) { if (glOff) { glOff(); glOff = null; } try { FACES.detach(); } catch (err) { /* gone */ } try { GL.destroy(); } catch (err) { /* gone */ } GL = null; }
      if (gh) { try { gh.el.remove(); } catch (err) { /* gone */ } gh = null; }
      wk.setWheelVeto(null);
      if (typeof wk.setEdgeHook === 'function') wk.setEdgeHook(null);
      if (o.layer) wk.setLayer(null);
      try { wk.setStoreCaps(null); } catch (err) { /* kit absent */ } // (H5: the caps were this world's)
      items.clear(); subs.clear();
    },
  };
  if (GL) { try { FACES.attach({ gl: GL, world: api }); } catch (err) { console.error(err); } }
  return api;
}
