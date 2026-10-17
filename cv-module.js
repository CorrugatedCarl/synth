// cv-module.js — canvas module chrome (top bar, body, jacks, fold, resize), the stage-1b track layout (instrument,
// FX panel, OUT) and the camera-pref helpers (SPEC-canvas §2.6, §2.8, §4.5, §5.1 lay; contract: docs/canvas/IMPL-1b.md
// §4.4). Owner: MODULES lane.
// Rules: plain ES module, no DOM at module top level (node imports it), survives tests/main-sim.mjs's DOM stub;
// imports carry ?v=9.
//
// A module = .cv-mod[data-cv-mod][data-cv-kind] absolutely positioned in #world at its lay entry (top-left, world px):
//   .cv-bar (40 world px; drag = move, tap = select, double-tap = focus, long-press / right-click / ⋯ = menu, ▾ = fold)
//   .cv-body (the existing panel: #inst, #fxrack, the scope), .cv-card (the drawing; below CARD_K), .cv-jack × n, and
//   the instrument's right-edge .cv-grip (width). The module's ring is a box-shadow, so a folded module is exactly BAR_H
//   tall and the jack offsets are pure geometry (w, fold): nothing is measured per frame. contain: paint sits on the body,
//   not the root: the jacks' hit circles and the bar's upward hit extension lie outside the module box.
// Bodies cull by hiding in 1b (cull 'hide': the SerumUI instance keeps its panel undo, page and editors); the 'unmount'
// path (body.unmount + wk.releaseCanvases) is built for 1c.
import * as wk from './wk.js?v=9';
import { DOT } from './cv-world.js?v=9';
import * as cvArt from './cv-art.js?v=9';
import { createCables, deriveCables } from './cv-cables.js?v=9';

/** Top bar height on every device (world px); the bar's hit area grows upward only (::before, calc(… * var(--ik))). */
export const BAR_H = 40;
/** Resizable instrument width range and defaults (world px). */
export const MIN_W = 480, MAX_W = 1600, W_CLASSIC = 1080, W_SERUM = 1200, W_FX = 760, W_OUT = 280;
/** The Serum panel's narrowest module width (its ≥ 1100 container layout reflows below; 768: the tablet layout). */
export const MIN_W_SERUM = 768;
/** Column gap Tidy leaves between instrument → FX panel → OUT (world px). */
export const GAP = 160;
/** Stage-1b module ids (= track.lay keys, = the device ids stage 1c's toV2 gives them, SPEC §5.1 / §5.4). */
export const ID = Object.freeze({ inst: 'i1', fx: 'fx1', sxFx: 'i1/fx', out: 'out' });
/** The camera pref record (appstore key, stored as synthc.cam): { v: 1, e: [[key, tx, ty, k], …] }, most recent last, at
 * most CAM_MAX entries; key = cv-migrate.js camKey(project.uid, trackId) (stage 1a). One record, not one key per camera:
 * appstore has no delete, so an LRU of separate keys could never shrink. Device prefs only: never in the project / History. */
export const CAM_PREF = 'synth.cam', CAM_MAX = 200;
/** Press targets that pan the camera with one finger / the mouse (the press target itself must match; IMPL-1b §4.4):
 * panel backgrounds and the card — never the top bar (it moves the module), a control, an editor canvas or a jack. */
export const BG_SEL = '.cv-body, .cv-card, .cv-art, .cv-art *, .cv-cardname, .inst, .plate, .nameplate, .nameplate > div, .plate > .tag, .secs, '
  + '.sec, .sec > h3, .ctls, .ctl, .opswrap, .sxhost, .sx-root, .sx-head, .fxtab, .fxr-root, .fxr2-bar, .fxr-side, .fxr-rack, .fxr-empty, '
  + '.cv-out, .scope, .scope > canvas, .cv-outlab, '
  // the Serum panel's containers (a third of its surface) and the TB-303 sequencer's chrome (not .snote, not its buttons)
  + '.sx-panel, .sx-pbody, .sx-krow, .sx-ptitle, .sx-tabs, .sx-colO, .sx-col, .sx-rowA, .sx-row, .sx-master, .sx-pages, .sx-page, '
  + '.steps, .step, .seqbar, .snum, .seqhint';
/** Jack centre below the bar on the module's edge (world px); folded modules carry their jacks on the bar's middle. */
export const JACK_Y = 28;
/** Tidy's guess of a module's height before it was measured (world px): the instrument's per model in sizeFor. */
const H_GUESS = { inst: 560, serum: 840, fx: 420, out: 260 };

const fin = x => typeof x === 'number' && isFinite(x);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const gsnap = v => Math.round(v / DOT) * DOT; // the visible grid's dots (cv-world DOT)
const gup = v => Math.ceil(v / DOT) * DOT;

/**
 * @typedef {{x: number, y: number, w?: number, fold?: 1, z?: number}} LayEntry  world px (top-left incl. the bar)
 * @typedef {Object<string, LayEntry>} Lay  track.lay (view only: never compiled, never in presets)
 * @typedef {{id: 'in' | 'out', side: 'left' | 'right', kind: 'audio', label: string}} Jack
 * @typedef {{
 *   id: string, kind: 'inst' | 'fx' | 'out', title: string, sub?: string, color?: string,
 *   x: number, y: number, w: number, fold?: boolean, z?: number,
 *   resizable?: {min: number, max: number}, cull: 'hide' | 'unmount', cost?: number,
 *   jacks: Jack[],
 *   body: {mount: (bodyEl: HTMLElement) => void, unmount: (bodyEl: HTMLElement) => void},
 *   chip?: HTMLElement | string,
 *   menu?: () => Array<object>,
 *   art?: () => string,
 *   onMove?: (x: number, y: number, phase: 'start' | 'move' | 'end' | 'cancel') => void,
 *   onFold?: (fold: boolean) => void,
 *   onResize?: (w: number, phase: 'start' | 'move' | 'end' | 'cancel') => void,
 *   onSelect?: () => void, onDouble?: () => void, onPress?: () => void, onView?: (v: string) => void,
 * }} ModuleOpts  (additions: art — the card drawing's SVG markup; onPress — a press on the bar (bring to front);
 *   onView — the body was shown / hidden (monitors))
 * @typedef {{
 *   id: string, el: HTMLElement, bar: HTMLElement, body: HTMLElement, cull: 'hide' | 'unmount', cost: number,
 *   rect: () => {x: number, y: number, w: number, h: number},
 *   view: (v: 'body' | 'card', why?: string) => void,
 *   setPos: (x: number, y: number, live?: boolean) => void,
 *   setW: (w: number) => void, setFold: (fold: boolean) => void, setZ: (z: number) => void,
 *   setTitle: (title: string, sub?: string) => void, setChip: (chip: HTMLElement | string | null) => void,
 *   port: (jackId: string) => {x: number, y: number},
 *   destroy: () => void,
 * }} Module  implements cv-world Item
 */

/* ---------------------------------------------------------------- pure helpers */
/** Is el a module background (one finger / the mouse pans the camera from it)? el itself must match BG_SEL and lie
 * in a [data-cv-mod]. @param {Element} el @returns {boolean} */
export function isBackground(el) {
  if (!el || el.nodeType !== 1 || typeof el.matches !== 'function' || typeof el.closest !== 'function') return false;
  try { return !!el.matches(BG_SEL) && !!el.closest('[data-cv-mod]'); } catch (err) { return false; }
}
/** The lay key of a track's FX module: 'i1/fx' (a Serum's own FX) or 'fx1' (a classic track's panel).
 * @param {string} model @returns {string} */
export function fxKey(model) { return model === 'serum' ? ID.sxFx : ID.fx; }
/** A module's default width (world px) on a track of `model`. */
export function defaultW(key, model) {
  return key === ID.inst ? (model === 'serum' ? W_SERUM : W_CLASSIC) : key === ID.out ? W_OUT : W_FX;
}
/** The instrument's width range for `model`. */
export const widthRange = model => ({ min: model === 'serum' ? MIN_W_SERUM : MIN_W, max: MAX_W });
/** Tidy: instrument → FX → OUT in columns from (0, 0), GAP apart, tops aligned. sizes: id → {w, h} (measured or default).
 * Each column starts on the grid. Positions only: widths and folds stay the caller's.
 * @param {{model: string}} track @param {Object<string, {w: number, h: number}>} sizes @returns {Lay} */
export function tidy(track, sizes) {
  const model = track && track.model, lay = {};
  let x = 0;
  for (const k of [ID.inst, fxKey(model), ID.out]) {
    const s = isObj(sizes) ? sizes[k] : null, w = s && fin(s.w) && s.w > 0 ? s.w : defaultW(k, model);
    lay[k] = { x, y: 0 };
    x = gup(x + w + GAP);
  }
  return lay;
}
const okEntry = e => isObj(e) && fin(e.x) && fin(e.y);
/** The lay entry of `key`, falling back to the other FX key after a classic ↔ Serum model change (its place, fold and
 * z; not its width), else Tidy's. Always a copy. @param {{model: string, lay?: Lay}} track @param {string} key
 * @param {Lay} tidied @returns {LayEntry} */
export function layOf(track, key, tidied) {
  const L = track && isObj(track.lay) ? track.lay : null;
  if (L && okEntry(L[key])) return Object.assign({}, L[key]);
  if (L && (key === ID.fx || key === ID.sxFx)) {
    const o = L[key === ID.fx ? ID.sxFx : ID.fx];
    if (okEntry(o)) { const e = Object.assign({}, o); delete e.w; return e; }
  }
  const t = isObj(tidied) && okEntry(tidied[key]) ? tidied[key] : { x: 0, y: 0 };
  return { x: t.x, y: t.y };
}
const camOk = c => Array.isArray(c) && typeof c[0] === 'string' && fin(c[1]) && fin(c[2]) && fin(c[3]) && c[3] > 0;
/** The camera stored under `key` (cv-migrate camKey) in a CAM_PREF record (any shape: invalid → null).
 * @param {{v: 1, e: Array} | null} rec @param {string} key @returns {{tx: number, ty: number, k: number} | null} */
export function camGet(rec, key) {
  if (!isObj(rec) || rec.v !== 1 || !Array.isArray(rec.e)) return null;
  for (let i = rec.e.length - 1; i >= 0; i--) {
    const c = rec.e[i];
    if (camOk(c) && c[0] === key) return { tx: c[1], ty: c[2], k: c[3] };
  }
  return null;
}
/** LRU put: `key` moves to the end with `cam`; the oldest go past `max` (default CAM_MAX). Pure.
 * @returns {{v: 1, e: Array}} a new record */
export function camPut(rec, key, cam, max) {
  const n = fin(max) && max >= 1 ? Math.floor(max) : CAM_MAX;
  const old = isObj(rec) && rec.v === 1 && Array.isArray(rec.e) ? rec.e.filter(c => camOk(c) && c[0] !== key) : [];
  if (typeof key === 'string' && isObj(cam) && fin(cam.tx) && fin(cam.ty) && fin(cam.k) && cam.k > 0) {
    old.push([key, Math.round(cam.tx * 100) / 100, Math.round(cam.ty * 100) / 100, Math.round(cam.k * 1e4) / 1e4]);
  }
  return { v: 1, e: old.slice(Math.max(0, old.length - n)) };
}
/** The world size of a module about to be dropped for `modelId` (the tray's true-size outline). @returns {{w: number, h: number}} */
export function sizeFor(modelId) {
  return modelId === 'serum' ? { w: W_SERUM, h: H_GUESS.serum } : { w: W_CLASSIC, h: H_GUESS.inst };
}

/* ---------------------------------------------------------------- one module */
const FOLD_SVG = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.25 6 7.75l3.5-3.5"/></svg>';
/** Builds one module's chrome (top bar · colour stripe · title · chip · ⋯ · ▾, body, jacks) as a cv-world Item.
 * env.world: the World (k, toWorld, dragPointer, on, select, focusItem); without one the module still works at k = 1.
 * @param {ModuleOpts} o @param {{world?: object, doc?: Document}} [env] @returns {Module} */
export function createModule(o, env) {
  const E = env || {}, doc = E.doc || globalThis.document, W = () => E.world || null;
  const snapOn = () => { const wd = W(); return !(wd && typeof wd.snapOn === 'function') || wd.snapOn(); }; // the toolbar's toggle
  const mk = (tag, cls, txt) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const btn = (cls, label, html) => { const b = mk('button', cls); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; if (html) b.innerHTML = html; return b; };
  const id = String(o.id), kind = o.kind || 'inst', cull = o.cull === 'unmount' ? 'unmount' : 'hide';
  let RZ = o.resizable && fin(o.resizable.min) && fin(o.resizable.max) ? { min: o.resizable.min, max: o.resizable.max } : null; // (setRange: a model change)
  let x = fin(o.x) ? o.x : 0, y = fin(o.y) ? o.y : 0, lx = x, ly = y; // committed left / top, live position
  let w = fin(o.w) && o.w > 0 ? o.w : defaultW(kind === 'inst' ? ID.inst : kind === 'out' ? ID.out : ID.fx);
  let fold = !!o.fold, z = fin(o.z) ? o.z : 1, cur = 'body', mounted = false, hCache = 0, dead = false, title = '', chipCur;
  const el = mk('div', 'cv-mod');
  el.setAttribute('data-cv-mod', id); el.setAttribute('data-cv-kind', kind); el.setAttribute('data-cv-view', 'body');
  el.setAttribute('role', 'group');
  if (o.color) el.style.setProperty('--mc', o.color);
  const bar = mk('div', 'cv-bar');
  bar.setAttribute('data-cv-bar', ''); bar.tabIndex = 0;
  const pow = mk('span', 'cv-pow'); pow.hidden = true; // power: the slot is reserved (instruments switch on / off from 1e)
  const stripe = mk('span', 'cv-stripe'); stripe.setAttribute('aria-hidden', 'true');
  const ttl = mk('span', 'cv-ttl'), tEl = mk('span', 'cv-title'), sEl = mk('span', 'cv-sub');
  ttl.append(tEl, sEl);
  const chipEl = mk('span', 'cv-chip'), cpu = mk('span', 'cv-cpu'); // CPU: per module from 1d (empty until then)
  const more = btn('cv-btn cv-more', 'Module menu'); more.textContent = '⋯'; more.setAttribute('aria-haspopup', 'menu');
  const foldB = btn('cv-btn cv-fold', 'Fold', FOLD_SVG);
  bar.append(pow, stripe, ttl, chipEl, cpu, more, foldB);
  const body = mk('div', 'cv-body'), card = mk('div', 'cv-card');
  card.setAttribute('aria-hidden', 'true');
  const cardArt = mk('div', 'cv-art'), cardName = mk('div', 'cv-cardname');
  card.append(cardArt, cardName);
  el.append(bar, body, card);
  const jacks = new Map(); // jack id → {el, side}
  for (const j of Array.isArray(o.jacks) ? o.jacks : []) {
    const je = mk('span', 'cv-jack');
    je.setAttribute('data-cv-jack', id + '.' + j.id); je.setAttribute('data-side', j.side === 'left' ? 'left' : 'right');
    je.setAttribute('data-kind', j.kind || 'audio');
    if (j.label) { je.setAttribute('aria-label', j.label); je.title = j.label; }
    el.append(je);
    jacks.set(j.id, { el: je, side: j.side === 'left' ? 'left' : 'right' });
  }
  let grip = null;
  if (RZ) {
    grip = mk('div', 'cv-grip');
    grip.setAttribute('role', 'separator'); grip.setAttribute('aria-orientation', 'vertical'); grip.setAttribute('aria-label', 'Module width');
    grip.title = 'Drag to change the width';
    el.append(grip);
  }
  // ---- geometry
  const jackY = () => (fold ? BAR_H / 2 : BAR_H + JACK_Y);
  function placeJacks() {
    const yy = jackY() + 'px';
    for (const j of jacks.values()) if (j.el.style.top !== yy) j.el.style.top = yy;
  }
  function measure() { // the module's layout height (world px): a layout read, never per frame
    if (fold) return BAR_H;
    const hh = +el.offsetHeight || 0;
    if (hh > 0) hCache = hh;
    return hCache || BAR_H;
  }
  let ro = null;
  const RO = globalThis.ResizeObserver;
  if (typeof RO === 'function') {
    try { ro = new RO(() => { if (!dead) { const h0 = hCache; measure(); if (hCache !== h0 && o.onSize) o.onSize(); } }); ro.observe(el); } catch (err) { ro = null; }
  }
  const setPos = (nx, ny, live) => {
    if (!fin(nx) || !fin(ny)) return;
    lx = nx; ly = ny;
    if (live) {
      el.style.transform = `translate3d(${nx - x}px, ${ny - y}px, 0)`;
      if (el.style.willChange !== 'transform') el.style.willChange = 'transform';
      return;
    }
    x = nx; y = ny;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    if (el.style.transform) el.style.transform = '';
    if (el.style.willChange) el.style.willChange = '';
  };
  const setW = nw => {
    if (!fin(nw) || nw <= 0) return;
    w = RZ ? clamp(Math.round(nw), RZ.min, RZ.max) : Math.round(nw);
    el.style.width = w + 'px';
  };
  const setFold = f => {
    fold = !!f;
    if (fold) el.setAttribute('data-cv-fold', ''); else el.removeAttribute('data-cv-fold');
    foldB.setAttribute('aria-expanded', fold ? 'false' : 'true');
    const lbl = fold ? 'Unfold' : 'Fold';
    foldB.setAttribute('aria-label', lbl); foldB.title = lbl;
    placeJacks();
    if (!fold) hCache = 0; // re-measured on the next rect()
  };
  const setZ = nz => { if (fin(nz)) { z = Math.round(nz); el.style.zIndex = String(z); } };
  const setTitle = (t, sub) => {
    title = String(t || '');
    if (tEl.textContent !== title) tEl.textContent = title;
    const s = sub == null ? '' : String(sub);
    if (sEl.textContent !== s) sEl.textContent = s;
    sEl.hidden = !s;
    el.setAttribute('aria-label', title + ' module');
    bar.setAttribute('aria-label', title + (s ? ' · ' + s : '') + ' — drag to move');
    if (cardName.textContent !== title) { cardName.textContent = title; cardArt.textContent = ''; if (cur === 'card') drawArt(); } // (a model change: its drawing)
  };
  function drawArt() { if (!cardArt.firstChild && o.art) { try { cardArt.innerHTML = o.art() || ''; } catch (err) { /* no drawing */ } } }
  const setChip = c => { // the same element again stays put (an open select keeps its picker and focus)
    if (c === chipCur && (typeof c !== 'object' || !c || c.parentNode === chipEl)) return;
    chipCur = c;
    if (typeof c === 'string') chipEl.textContent = c;
    else { chipEl.textContent = ''; if (c) chipEl.append(c); }
    chipEl.hidden = !c;
  };
  // ---- body: mounted at creation (the default view is 'body'; the world may switch it to a card)
  function mount() { if (mounted || dead) return; mounted = true; if (o.body && o.body.mount) o.body.mount(body); }
  function unmount() {
    if (!mounted) return;
    mounted = false;
    if (typeof wk.releaseCanvases === 'function') { try { wk.releaseCanvases(body); } catch (err) { /* kit without it */ } }
    if (o.body && o.body.unmount) o.body.unmount(body);
  }
  function view(v, why) {
    v = v === 'card' ? 'card' : 'body';
    if (why) el.setAttribute('data-cv-why', String(why)); else el.removeAttribute('data-cv-why');
    if (v === cur) return;
    if (v === 'card') {
      if (!fold) { const hb = measure() - BAR_H; if (hb > 0) card.style.minHeight = hb + 'px'; } // the card keeps the body's footprint
      drawArt();
      if (cull === 'unmount') unmount();
    } else mount();
    cur = v;
    el.setAttribute('data-cv-view', v);
    if (o.onView) o.onView(v);
  }
  // ---- bar: move (wk.dragSource), tap / double-tap, menu
  const ctl = t => { for (let n = t; n && n !== bar; n = n.parentNode) if (n === chipEl || n === more || n === foldB) return true; return false; };
  for (const c of [chipEl, more, foldB]) c.addEventListener('pointerdown', e => e.stopPropagation()); // controls never start a move
  let D = null, camOff = null, press = null; // the live drag: {x0, y0 (module), p0 (world point under the press), last info}
  const W2 = (cx, cy) => { const wd = W(); return wd && typeof wd.toWorld === 'function' ? wd.toWorld(cx, cy) : { x: cx, y: cy }; };
  const pointer = p => { const wd = W(); if (wd && typeof wd.dragPointer === 'function') wd.dragPointer(p); };
  function follow(i) {
    if (!D) return;
    D.i = i;
    const p = W2(i.x, i.y);
    let nx = D.x0 + p.x - D.p0.x, ny = D.y0 + p.y - D.p0.y;
    if (!i.fine && snapOn()) { nx = gsnap(nx); ny = gsnap(ny); }
    if (nx === lx && ny === ly) return;
    setPos(nx, ny, true);
    if (o.onMove) o.onMove(nx, ny, 'move');
  }
  function dragEnd() { pointer(null); if (camOff) { camOff(); camOff = null; } bar.classList.remove('cv-moving'); }
  const moveDrag = wk.dragSource(bar, {
    data: id, scrollAxis: 'none', autoScroll: false,
    begin(i) { // (the drag starts past the slop: the module follows from the press point, not from there)
      D = { x0: x, y0: y, p0: press ? W2(press.x, press.y) : W2(i.x, i.y), i };
      bar.classList.add('cv-moving');
      select();
      if (o.onMove) o.onMove(x, y, 'start');
      const wd = W();
      if (wd && typeof wd.on === 'function') camOff = wd.on('camera', () => { if (D) follow(D.i); }); // edge pan / a second finger: re-project
      pointer({ x: i.x, y: i.y, pointerType: i.pointerType });
    },
    move(i) { follow(i); pointer({ x: i.x, y: i.y, pointerType: i.pointerType }); },
    drop(i) {
      if (!D) return;
      follow(i);
      D = null; dragEnd();
      setPos(lx, ly, false);
      if (o.onMove) o.onMove(x, y, 'end');
    },
    cancel() { // Escape or a second finger (gesture.js two-finger pointercancel): back to where it started
      if (!D) return;
      const s = D; D = null; dragEnd();
      setPos(s.x0, s.y0, false);
      if (o.onMove) o.onMove(x, y, 'cancel');
    },
  });
  // tap = world.select, double-tap = world.focusItem (100 % and edit state); then the owner's callbacks
  function select() { const wd = W(); if (wd && typeof wd.select === 'function') wd.select(id); if (o.onSelect) o.onSelect(); }
  function focus() { const wd = W(); if (wd && typeof wd.focusItem === 'function') wd.focusItem(id, { animate: true }); if (o.onDouble) o.onDouble(); }
  let tapT = -1e9, tapX = 0, tapY = 0;
  const onClick = e => {
    if (ctl(e.target)) return;
    const t = typeof e.timeStamp === 'number' ? e.timeStamp : Date.now(), dbl = t - tapT < 350 && Math.hypot(e.clientX - tapX, e.clientY - tapY) < 24;
    tapT = dbl ? -1e9 : t; tapX = e.clientX; tapY = e.clientY;
    if (dbl) focus(); else select();
  };
  bar.addEventListener('click', onClick);
  // the press captures the pointer at once: a quick mouse flick leaves the 40 px bar before the drag's 4 px slop, and its
  // moves would go to whatever lies under it (dragSource captures only once the drag starts)
  const grab = (n, e) => { try { n.setPointerCapture(e.pointerId); } catch (err) { /* pointer gone */ } };
  bar.addEventListener('pointerdown', e => { if (e.button !== 0) return; press = { x: e.clientX, y: e.clientY }; grab(bar, e); if (o.onPress) o.onPress(); });
  bar.addEventListener('keydown', e => {
    if (e.target !== bar) return;
    if (e.key === 'Enter') { e.preventDefault(); focus(); }
  });
  const menuOff = wk.menuSource(bar);
  function openMenu(cx, cy) {
    const items = o.menu ? o.menu() : [];
    if (items && items.length) wk.contextMenu(cx, cy, items, { anchor: more });
  }
  bar.addEventListener('contextmenu', e => {
    if (ctl(e.target) && e.target !== more) return; // the chip's own menu (a select) stays the browser's
    e.preventDefault();
    if (D) return;
    openMenu(e.clientX, e.clientY);
  });
  more.addEventListener('click', e => {
    e.stopPropagation();
    const r = more.getBoundingClientRect();
    openMenu(r.left, r.bottom + 4);
  });
  foldB.addEventListener('click', e => {
    e.stopPropagation();
    setFold(!fold);
    if (o.onFold) o.onFold(fold);
  });
  // ---- width grip (instrument): world delta / k, grid-snapped (Shift / Fine: free), one onResize start / end pair
  let R = null, gripDrag = null, gpress = null;
  const size = i => {
    if (!R) return;
    const p = W2(i.x, i.y), nw0 = R.w0 + p.x - R.p0.x, before = w;
    setW(i.fine || !snapOn() ? nw0 : gsnap(nw0));
    if (w !== before && o.onResize) o.onResize(w, 'move');
  };
  if (grip) {
    gripDrag = wk.dragSource(grip, {
      data: id, scrollAxis: 'none', autoScroll: false,
      begin(i) { R = { w0: w, p0: gpress ? W2(gpress.x, gpress.y) : W2(i.x, i.y) }; el.classList.add('cv-sizing'); if (o.onResize) o.onResize(w, 'start'); },
      move: size,
      drop(i) { if (!R) return; size(i); R = null; el.classList.remove('cv-sizing'); if (o.onResize) o.onResize(w, 'end'); },
      cancel() { if (!R) return; const w0 = R.w0; R = null; el.classList.remove('cv-sizing'); setW(w0); if (o.onResize) o.onResize(w, 'cancel'); },
    });
    grip.addEventListener('pointerdown', e => { if (e.button !== 0) return; gpress = { x: e.clientX, y: e.clientY }; grab(grip, e); });
  }
  // ---- initial state
  setPos(x, y, false); setW(w); setFold(fold); setZ(z);
  setTitle(o.title, o.sub);
  setChip(o.chip || null);
  mount();
  const M = {
    id, el, bar, body, card, cull, cost: fin(o.cost) ? o.cost : 600, kind,
    rect: () => ({ x: lx, y: ly, w, h: fold ? BAR_H : measure() }),
    view,
    setPos, setW, setFold, setZ, setTitle, setChip,
    /** (addition) the grip's width range after a classic ↔ Serum model change (a resizable module only); re-clamps w */
    setRange(r) {
      if (!RZ || !r || !fin(r.min) || !fin(r.max) || (r.min === RZ.min && r.max === RZ.max)) return;
      RZ = { min: r.min, max: r.max };
      setW(w);
    },
    /** module-local offset of a jack (pure geometry: w and fold) */
    port(jackId) { const j = jacks.get(jackId); return j ? { x: j.side === 'left' ? 0 : w, y: jackY() } : { x: w / 2, y: BAR_H / 2 }; },
    // (additions) state reads for the track view, main.js and tests
    get x() { return lx; }, get y() { return ly; }, get w() { return w; }, get z() { return z; }, get fold() { return fold; },
    get shown() { return cur; }, get title() { return title; },
    dragging: () => !!D || !!R,
    /** the canvas arrow keys (cv-world key): one onMove start / end pair per nudge (one undo step) */
    nudge(dx, dy) {
      if (D || R || !fin(dx) || !fin(dy) || (!dx && !dy)) return;
      if (o.onMove) o.onMove(x, y, 'start');
      setPos(x + dx, y + dy, false);
      if (o.onMove) o.onMove(x, y, 'end');
    },
    jack: jackId => (jacks.get(jackId) || {}).el || null,
    openMenu,
    destroy() {
      if (dead) return;
      if (D) { D = null; dragEnd(); }
      moveDrag.destroy(); if (gripDrag) gripDrag.destroy(); menuOff();
      if (ro) { try { ro.disconnect(); } catch (err) { /* gone */ } }
      unmount();
      dead = true;
      el.remove();
    },
  };
  return M;
}

/* ---------------------------------------------------------------- the track view */
/**
 * The stage-1b view of one track: instrument (ID.inst), FX module (fxKey(model)), OUT (ID.out), positioned from
 * track.lay (layOf), added to the world, plus the derived cables (cv-cables). main.js (MODULES region) supplies the
 * bodies and the edits; this module never touches the project except through host callbacks.
 * host.lay(key, entry, phase, what): 'start' opens the undo step of a move / fold / resize (what), 'end' writes the
 * entry; an 'end' without a 'start' (bring to front: z) writes without an undo step; 'cancel' changes nothing.
 * (Additions: host.root — the element modules live in (default world.el: #world); host.shown(key) — a body was shown /
 * hidden or folded (main.js: monitors.sync); host.art(kind) — the card drawing; host.select(key) / host.focus(key).)
 * @param {object|null} world  cv-world World (null: modules still lay out in host.root at k = 1)
 * @param {{id: string, model: string, name: string, color: string, lay?: Lay}} track
 * @param {object} host
 * @returns {{trackId: string, model: string, modules: Map<string, Module>, sync: (track: object) => void,
 *   ports: () => Map<string, {x: number, y: number}>, live: (key: string) => boolean, destroy: () => void}}
 */
export function createTrackView(world, track, host) {
  const H = host || {}, doc = H.doc || globalThis.document, root = H.root || (world && world.el) || null;
  let T = track;
  const mods = new Map(); // key → Module
  const cables = createCables(root, { doc });
  const keys = () => [ID.inst, fxKey(T.model), ID.out];
  const kindOf = key => (key === ID.inst ? 'inst' : key === ID.out ? 'out' : 'fx');
  const sizes = () => { const o = {}; for (const [k, m] of mods) { const r = m.rect(); o[k] = { w: r.w, h: r.h }; } return o; };
  const tidied = () => { const o = {}; for (const [k, m] of mods) o[k] = { w: m.w }; return tidy(T, o); }; // (widths only: no layout read)
  // the lay entry of a module as it stands: w only once the user set one (a model's default width follows the model:
  // a Serum's 1200 is its ≥ 1100 container layout), z only once brought to front
  const entryOf = key => {
    const m = mods.get(key);
    if (!m) return null;
    const e = { x: Math.round(m.x), y: Math.round(m.y) };
    if (m.wSet) e.w = m.w;
    if (m.fold) e.fold = 1;
    if (m.zSet) e.z = m.z;
    return e;
  };
  let lastPorts = null;
  function ports() {
    const p = new Map();
    for (const [k, m] of mods) for (const j of ['in', 'out']) if (m.jack(j)) { const o = m.port(j); p.set(k + '.' + j, { x: m.x + o.x, y: m.y + o.y }); }
    return p;
  }
  function relay() { lastPorts = ports(); cables.layout(lastPorts); }
  const meta = kind => { try { return (H.title && H.title(kind)) || {}; } catch (err) { return {}; } };
  const lay = (key, phase, what) => {
    if (!H.lay) return;
    H.lay(key, entryOf(key), phase, what);
    // the first write pins the modules Tidy still places, where they stand (else a later sync re-tidies them from the
    // current widths: they jump, or land on a moved sibling); inside the step 'start' opened, so undo takes them too.
    // An untouched track keeps no lay key (its History snapshots stay the same)
    if (phase === 'end') for (const k of mods.keys()) if (k !== key && !(isObj(T.lay) && okEntry(T.lay[k]))) H.lay(k, entryOf(k), 'end', 'pin');
  };
  const update = key => { if (world && typeof world.update === 'function') world.update(key); };
  function make(key) {
    const kind = kindOf(key), M0 = meta(kind), L = layOf(T, key, tidied());
    const jk = kind === 'inst' ? [{ id: 'out', side: 'right', kind: 'audio', label: (M0.title || 'Instrument') + ' out' }]
      : kind === 'fx' ? [{ id: 'in', side: 'left', kind: 'audio', label: (M0.title || 'FX') + ' in' }, { id: 'out', side: 'right', kind: 'audio', label: (M0.title || 'FX') + ' out' }]
        : [{ id: 'in', side: 'left', kind: 'audio', label: 'OUT in' }];
    const m = createModule({
      id: key, kind, title: M0.title || '', sub: M0.sub, chip: M0.chip, color: T.color,
      x: L.x, y: L.y, w: kind === 'inst' && fin(L.w) ? L.w : defaultW(key, T.model), fold: !!L.fold, z: fin(L.z) ? L.z : 1,
      resizable: kind === 'inst' ? widthRange(T.model) : undefined,
      cull: 'hide', cost: kind === 'inst' ? (T.model === 'serum' ? 3700 : 600) : kind === 'fx' ? 900 : 40,
      jacks: jk,
      body: H.bodies && H.bodies[kind] ? H.bodies[kind] : null,
      menu: () => (H.menu ? H.menu(kind, key) : []),
      art: () => (H.art ? H.art(kind) : ''),
      onPress: () => front(key),
      onSelect: () => { if (H.select) H.select(key); },
      onDouble: () => { if (H.focus) H.focus(key); },
      onMove: (x, y, phase) => {
        if (phase !== 'move') lay(key, phase, 'move');
        relay();
        if (phase === 'end' || phase === 'cancel') update(key);
      },
      onFold: f => { lay(key, 'start', 'fold'); lay(key, 'end', 'fold'); relay(); update(key); if (H.shown) H.shown(key); },
      onResize: (w, phase) => {
        if (phase === 'start') { m.w0Set = m.wSet; m.wSet = true; } else if (phase === 'cancel') m.wSet = m.w0Set;
        if (phase !== 'move') lay(key, phase, 'resize');
        relay();
        if (phase === 'end' || phase === 'cancel') update(key);
      },
      onView: () => { if (H.shown) H.shown(key); },
      onSize: () => { relay(); update(key); },
    }, { world, doc });
    m.zSet = fin(L.z); m.wSet = kind === 'inst' && fin(L.w);
    if (root) root.append(m.el);
    mods.set(key, m);
    if (world && typeof world.add === 'function') world.add(m);
    return m;
  }
  // bring to front: z only (pointer capture survives); renormalised to 1…n once it passes 9999; no undo step
  function front(key) {
    const m = mods.get(key);
    if (!m) return;
    let top = -Infinity, tie = false;
    for (const [k, o] of mods) if (k !== key) { if (o.z > top) top = o.z; }
    for (const [k, o] of mods) if (k !== key && o.z === m.z) tie = true;
    if (m.z > top && !tie) return;
    if (top + 1 > 9999) {
      const order = [...mods.entries()].filter(([k]) => k !== key).sort((a, b) => a[1].z - b[1].z);
      order.forEach(([k, o], i) => { o.setZ(i + 1); o.zSet = true; lay(k, 'end', 'z'); });
      top = order.length;
    }
    m.setZ(top + 1); m.zSet = true;
    lay(key, 'end', 'z');
  }
  for (const k of keys()) make(k);
  cables.set(deriveCables(T));
  relay();
  // cables touching the selection are raised, the others dimmed (§2.9); kept by module id, so a re-derived cable list
  // (a model change, a Serum route edit) is highlighted again
  let selOff = null, selId = null;
  const hl = () => cables.highlight(selId && mods.has(selId) ? cables.list().filter(c => c.a.startsWith(selId + '.') || c.b.startsWith(selId + '.')).map(c => c.id) : null);
  if (world && typeof world.on === 'function') selOff = world.on('select', d => { selId = (d && d.id) || null; hl(); });
  const V = {
    trackId: T.id, model: T.model, modules: mods, cables,
    /** applies lay / title / model changes without remounting bodies (an FX key swap moves the FX body to the new module) */
    sync(track) {
      T = track || T;
      V.trackId = T.id; V.model = T.model;
      const want = keys();
      for (const k of [...mods.keys()]) if (!want.includes(k)) { const m = mods.get(k); if (world && typeof world.remove === 'function') world.remove(k); m.destroy(); mods.delete(k); }
      let vis = false; // a fold changed (an undo / redo restore): host.shown once, after every module is in its state
      for (const k of want) { // (instrument first: Tidy places the others from its new width — a model change on an untouched track)
        let m = mods.get(k);
        if (!m) { make(k); continue; }
        const kind = kindOf(k), M0 = meta(kind), L = layOf(T, k, tidied());
        if (kind === 'inst') m.setRange(widthRange(T.model)); // (the grip's limits follow the model, even mid-drag)
        if (!m.dragging()) {
          m.setPos(L.x, L.y, false);
          if (kind === 'inst') { const r = widthRange(T.model); m.wSet = fin(L.w); m.setW(fin(L.w) ? clamp(L.w, r.min, r.max) : defaultW(k, T.model)); }
          if (m.fold !== !!L.fold) { m.setFold(!!L.fold); vis = true; }
        }
        m.zSet = fin(L.z);
        m.setZ(fin(L.z) ? L.z : 1);
        m.setTitle(M0.title || '', M0.sub);
        if (M0.chip !== undefined) m.setChip(M0.chip);
        if (T.color) m.el.style.setProperty('--mc', T.color);
        update(k);
      }
      cables.set(deriveCables(T));
      hl();
      relay();
      if (vis && H.shown) H.shown(); // (main.js: monitors.sync — the Serum / FX live displays follow an undone fold)
    },
    /** (addition) titles, chips and the derived cables after an edit (no lay, no world update) */
    refresh(track) {
      if (track) T = track;
      for (const [k, m] of mods) { const M0 = meta(kindOf(k)); m.setTitle(M0.title || '', M0.sub); if (M0.chip !== undefined) m.setChip(M0.chip); }
      cables.set(deriveCables(T));
      hl();
      relay();
    },
    ports,
    /** the module `key` shows its body (not a card, not folded) */
    live(key) { const m = mods.get(key); return !!m && m.shown === 'body' && !m.fold; },
    /** user actions from the module menus (each one undo step, except front) */
    toggleFold(key) { const m = mods.get(key); if (!m) return; m.setFold(!m.fold); lay(key, 'start', 'fold'); lay(key, 'end', 'fold'); relay(); update(key); if (H.shown) H.shown(key); },
    resetWidth(key) {
      const m = mods.get(key);
      if (!m || kindOf(key) !== 'inst') return;
      lay(key, 'start', 'resize');
      m.wSet = false;
      m.setW(defaultW(key, T.model));
      lay(key, 'end', 'resize');
      relay(); update(key);
    },
    front,
    sizes,
    destroy() {
      if (selOff) selOff();
      for (const [k, m] of mods) { if (world && typeof world.remove === 'function') world.remove(k); m.destroy(); }
      mods.clear();
      cables.destroy();
    },
  };
  return V;
}

/** The card drawing of a module kind (cv-art; '' while the SHELL lane's drawings are not in). */
export function cardArt(kind, model) {
  try { return kind === 'inst' ? cvArt.art(model, { w: 320, h: 188 }) : cvArt.glyph(kind === 'out' ? 'out' : 'fx', { w: 160, h: 96 }); } catch (err) { return ''; }
}
