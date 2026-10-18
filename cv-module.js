// cv-module.js — canvas module chrome (top bar, body, jacks, fold), the stage-1b track layout (instrument,
// FX panel, OUT) and the camera-pref helpers (SPEC-canvas §2.6, §2.8, §4.5, §5.1 lay; contract: docs/canvas/IMPL-1b.md
// §4.4). Owner: MODULES lane.
// Rules: plain ES module, no DOM at module top level (node imports it), survives tests/main-sim.mjs's DOM stub;
// imports carry ?v=9.
//
// A module = .cv-mod[data-cv-mod][data-cv-kind] absolutely positioned in #world at its lay entry (top-left, world px):
//   .cv-bar (40 world px; drag = move, tap = select, double-tap = focus, long-press / right-click / ⋯ = menu, ▾ = fold)
//   .cv-body (the existing panel: #inst, #fxrack, the scope) and .cv-jack × n. The module's ring is a box-shadow, so a
//   folded module is exactly BAR_H tall and the jack offsets are pure geometry (w, fold): nothing is measured per frame. contain: paint
//   sits on the body, not the root: the jacks' hit circles and the bar's upward hit extension lie outside the module box.
// Zoom consistency (IMPL-panels §8.2): the body mounts once at creation and stays mounted for the module's life (no cards,
// nothing hidden at any zoom); off screen the root carries [data-cv-off] (CSS animations pause, host.shown → monitors).
// No module is resizable (the user's rule, 2026-10-18): each has one fixed width that fits all of its content — a classic
// instrument's Hardware layout its panel's size (host.size: {fixed: {w, h}}, cv-panel sizeOf: no measuring), its Simple
// layout FLOW_W of its model and a Serum W_SERUM (host.size: {fixed: {w}}: the height measured), the FX panel W_FX, OUT
// W_OUT. A stored width (track.lay.<id>.w, from before the rule) is ignored and never written again.
import * as wk from './wk.js?v=9';
import { DOT } from './cv-world.js?v=9';
import { createCables, deriveCables } from './cv-cables.js?v=9';

/** Top bar height on every device (world px); the bar's hit area grows upward only (::before, calc(… * var(--ik))). */
export const BAR_H = 40;
/** Module widths (world px; fixed — nothing is resizable): a Serum's (its ≥ 1100 container layout), the FX panel's, OUT's,
 * and W_CLASSIC for a classic model FLOW_W does not list. */
export const W_CLASSIC = 1080, W_SERUM = 1200, W_FX = 760, W_OUT = 280;
/** A classic synth's Simple ('flow') layout width per model (world px, on the dots): measured so that every section,
 * control and the TB-303 step sequencer fit with room to spare (nothing clips or scrolls: the TB-303's steps need
 * ≥ 608, the DX7's operator rows ≥ 992), the sections packed into the fewest, fullest rows. */
export const FLOW_W = Object.freeze({
  modular: 1024, minimoog: 1184, arp2600: 1088, solina: 992, cs80: 1024, prophet5: 1088,
  ms20: 1056, tb303: 832, obxa: 1056, jupiter8: 864, juno60: 864, dx7: 1024,
});
/** Column gap Tidy leaves between instrument → FX panel → OUT (world px). */
export const GAP = 160;
/** Stage-1b module ids (= track.lay keys, = the device ids stage 1c's toV2 gives them, SPEC §5.1 / §5.4). */
export const ID = Object.freeze({ inst: 'i1', fx: 'fx1', sxFx: 'i1/fx', out: 'out' });
/** The camera pref record (appstore key, stored as synthc.cam): { v: 1, e: [[key, tx, ty, k], …] }, most recent last, at
 * most CAM_MAX entries; key = cv-migrate.js camKey(project.uid, trackId) (stage 1a). One record, not one key per camera:
 * appstore has no delete, so an LRU of separate keys could never shrink. Device prefs only: never in the project / History. */
export const CAM_PREF = 'synth.cam', CAM_MAX = 200;
/** Press targets that pan the camera with one finger / the mouse (the press target itself must match; IMPL-1b §4.4):
 * panel backgrounds and a hardware panel's art — never the top bar (it moves the module), a control, an editor canvas or a
 * jack. */
export const BG_SEL = '.cv-body, .inst, .plate, .nameplate, .nameplate > div, .plate > .tag, .secs, '
  // a hardware panel (cv-panel): its root, the static art (the decor SVG and everything in it), the live layer's
  // gaps and the extras strip's chrome — never a .hw-c widget
  + '.inst.hw, .hw-decor, .hw-decor *, .hw-ctls, .hw-extras, .hw-xcap, '
  + '.sec, .sec > h3, .ctls, .ctl, .opswrap, .sxhost, .sx-root, .sx-head, .fxtab, .fxr-root, .fxr2-bar, .fxr-side, .fxr-rack, .fxr-empty, '
  + '.cv-out, .scope, .scope > canvas, .cv-outlab, '
  // the Serum panel's containers (a third of its surface) and the TB-303 sequencer's chrome (not .snote, not its buttons)
  + '.sx-panel, .sx-pbody, .sx-krow, .sx-ptitle, .sx-tabs, .sx-colO, .sx-col, .sx-rowA, .sx-row, .sx-master, .sx-pages, .sx-page, '
  + '.steps, .step, .seqbar, .snum, .seqhint';
/** Jack centre below the bar on the module's edge (world px); folded modules carry their jacks at the bar's middle height,
 * JACK_OUT world px outside the left / right edge (so the dot never covers the bar's ⋯ / ▾ / chip; the bar controls also
 * win the hit test over a jack's enlarged touch circle: style.css). */
export const JACK_Y = 28, JACK_OUT = 14;
/** Tidy's guess of a module's height before it was measured (world px): the instrument's per model in sizeFor. */
const H_GUESS = { inst: 560, serum: 840, fx: 420, out: 260 };

const fin = x => typeof x === 'number' && isFinite(x);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const gsnap = v => Math.round(v / DOT) * DOT; // the visible grid's dots (cv-world DOT)
const gup = v => Math.ceil(v / DOT) * DOT;

/**
 * @typedef {{x: number, y: number, fold?: 1, z?: number, ui?: 'flow'}} LayEntry  world px (top-left incl. the bar; a stored w is ignored)
 * @typedef {Object<string, LayEntry>} Lay  track.lay (view only: never compiled, never in presets)
 * @typedef {{id: 'in' | 'out', side: 'left' | 'right', kind: 'audio', label: string}} Jack
 * @typedef {{w: number, h?: number}} Fixed  a fixed module size (world px, the bar included; no h: measured)
 * @typedef {{
 *   id: string, kind: 'inst' | 'fx' | 'out', title: string, sub?: string, color?: string,
 *   x: number, y: number, w: number, fold?: boolean, z?: number,
 *   fixed?: Fixed | null, cost?: number,
 *   jacks: Jack[],
 *   body: {mount: (bodyEl: HTMLElement) => void, unmount: (bodyEl: HTMLElement) => void},
 *   chip?: HTMLElement | string,
 *   menu?: () => Array<object>,
 *   onMove?: (x: number, y: number, phase: 'start' | 'move' | 'end' | 'cancel') => void,
 *   onFold?: (fold: boolean) => void,
 *   onSelect?: () => void, onDouble?: () => void, onPress?: () => void, onScreen?: (on: boolean) => void,
 * }} ModuleOpts  (additions: onPress — a press on the bar (bring to front); onScreen — the module entered / left the
 *   screen (monitors); fixed — the instrument's size: w, and h when it is known (a Hardware layout: no measuring))
 * @typedef {{
 *   id: string, el: HTMLElement, bar: HTMLElement, body: HTMLElement, cost: number,
 *   rect: () => {x: number, y: number, w: number, h: number},
 *   onScreen: (on: boolean) => void,
 *   setPos: (x: number, y: number, live?: boolean) => void,
 *   setW: (w: number) => void, setFold: (fold: boolean) => void, setZ: (z: number) => void,
 *   setFixed: (size: Fixed | null) => void,
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
/** A module's width (world px) on a track of `model` (the instrument: its Simple layout's, or a Serum's; a Hardware
 * layout's comes from its panel: cv-panel sizeOf). */
export function defaultW(key, model) {
  return key === ID.inst ? (model === 'serum' ? W_SERUM : FLOW_W[model] || W_CLASSIC) : key === ID.out ? W_OUT : W_FX;
}
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
 * z), else Tidy's. Always a copy, never with a width (a stored w is ignored: nothing is resizable).
 * @param {{model: string, lay?: Lay}} track @param {string} key @param {Lay} tidied @returns {LayEntry} */
export function layOf(track, key, tidied) {
  const L = track && isObj(track.lay) ? track.lay : null;
  if (L && okEntry(L[key])) { const e = Object.assign({}, L[key]); delete e.w; return e; }
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
  return { w: defaultW(ID.inst, modelId), h: modelId === 'serum' ? H_GUESS.serum : H_GUESS.inst };
}
/** Room for a fixed-size instrument (IMPL-panels §7.3): the modules whose left edge is at or right of the instrument's
 * left edge and whose vertical span overlaps it (R) move right together — their relative layout kept — so the nearest
 * one starts GAP (gap) past the instrument, on the dots; null when R is empty or already starts a dot or more past it.
 * Never moves anything left. Pure. @param {Object<string, {x: number, y: number, w: number, h: number}>} rects
 * @param {string} key the instrument @param {number} [gap] @returns {Object<string, {x: number, y: number}> | null} */
export function makeRoom(rects, key, gap) {
  const I = isObj(rects) ? rects[key] : null, g = fin(gap) ? gap : GAP;
  if (!I || ![I.x, I.y, I.w, I.h].every(fin)) return null;
  const R = [];
  for (const k of Object.keys(rects)) {
    const r = rects[k];
    if (k === key || !r || ![r.x, r.y, r.w, r.h].every(fin)) continue;
    if (r.x >= I.x && r.y < I.y + I.h && I.y < r.y + Math.max(r.h, 1)) R.push(k);
  }
  if (!R.length) return null;
  const x0 = Math.min(...R.map(k => rects[k].x));
  if (x0 >= I.x + I.w + DOT) return null;
  const d = gup(I.x + I.w + g) - x0;
  if (!(d > 0)) return null;
  const out = {};
  for (const k of R) out[k] = { x: rects[k].x + d, y: rects[k].y };
  return out;
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
  const id = String(o.id), kind = o.kind || 'inst';
  const fixOk = f => !!f && fin(f.w) && f.w > 0;
  let FX = fixOk(o.fixed) ? { w: Math.round(o.fixed.w), h: fin(o.fixed.h) && o.fixed.h > BAR_H ? Math.round(o.fixed.h) : 0 } : null; // the instrument's size
  let x = fin(o.x) ? o.x : 0, y = fin(o.y) ? o.y : 0, lx = x, ly = y; // committed left / top, live position
  let w = FX ? FX.w : fin(o.w) && o.w > 0 ? o.w : defaultW(kind === 'inst' ? ID.inst : kind === 'out' ? ID.out : ID.fx);
  let fold = !!o.fold, z = fin(o.z) ? o.z : 1, mounted = false, hCache = 0, dead = false, title = '', chipCur, onScr = true;
  const el = mk('div', 'cv-mod');
  el.setAttribute('data-cv-mod', id); el.setAttribute('data-cv-kind', kind);
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
  const body = mk('div', 'cv-body');
  el.append(bar, body);
  const jacks = new Map(); // jack id → {el, side}
  for (const j of Array.isArray(o.jacks) ? o.jacks : []) {
    const je = mk('span', 'cv-jack');
    je.setAttribute('data-cv-jack', id + '.' + j.id); je.setAttribute('data-side', j.side === 'left' ? 'left' : 'right');
    je.setAttribute('data-kind', j.kind || 'audio');
    if (j.label) { je.setAttribute('aria-label', j.label); je.title = j.label; }
    el.append(je);
    jacks.set(j.id, { el: je, side: j.side === 'left' ? 'left' : 'right' });
  }
  // ---- geometry
  const jackY = () => (fold ? BAR_H / 2 : BAR_H + JACK_Y);
  function placeJacks() {
    const yy = jackY() + 'px';
    for (const j of jacks.values()) if (j.el.style.top !== yy) j.el.style.top = yy;
  }
  function measure() { // the module's layout height (world px): a layout read, never per frame (a fixed height: none)
    if (fold) return BAR_H;
    if (FX && FX.h) return FX.h;
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
    w = FX ? FX.w : Math.round(nw);
    el.style.width = w + 'px';
  };
  // the instrument's size (its layout's: a model change or the layout toggle brings a new one): with h (a Hardware
  // layout) the body's height is set once (no measuring); without, the height is measured
  const setFixed = f => {
    const n = fixOk(f) ? { w: Math.round(f.w), h: fin(f.h) && f.h > BAR_H ? Math.round(f.h) : 0 } : null;
    FX = n;
    if (n) { el.setAttribute('data-cv-fixed', ''); w = n.w; el.style.width = w + 'px'; } else el.removeAttribute('data-cv-fixed');
    body.style.height = n && n.h ? (n.h - BAR_H) + 'px' : '';
    hCache = 0;
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
  };
  const setChip = c => { // the same element again stays put (an open select keeps its picker and focus)
    if (c === chipCur && (typeof c !== 'object' || !c || c.parentNode === chipEl)) return;
    chipCur = c;
    if (typeof c === 'string') chipEl.textContent = c;
    else { chipEl.textContent = ''; if (c) chipEl.append(c); }
    chipEl.hidden = !c;
  };
  // ---- body: mounted at creation, for the module's life (Z1: no cards; unmounted only by destroy)
  function mount() { if (mounted || dead) return; mounted = true; if (o.body && o.body.mount) o.body.mount(body); }
  function unmount() {
    if (!mounted) return;
    mounted = false;
    if (typeof wk.releaseCanvases === 'function') { try { wk.releaseCanvases(body); } catch (err) { /* kit without it */ } }
    if (o.body && o.body.unmount) o.body.unmount(body);
  }
  // on / off screen (the world's plan): nothing visible changes — [data-cv-off] pauses CSS animations, the owner pauses
  // its live displays (monitors)
  function onScreen(on) {
    on = on !== false;
    if (on === onScr) return;
    onScr = on;
    if (on) el.removeAttribute('data-cv-off'); else el.setAttribute('data-cv-off', '');
    if (o.onScreen) o.onScreen(on);
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
      select(true); // (a member of a selection of several keeps it: the group moves with it)
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
  function select(keep, add) { const wd = W(); if (wd && typeof wd.select === 'function') wd.select(id, keep || add ? { keep: !!keep, add: !!add } : undefined); if (o.onSelect) o.onSelect(); }
  function focus() { const wd = W(); if (wd && typeof wd.focusItem === 'function') wd.focusItem(id, { animate: true }); if (o.onDouble) o.onDouble(); }
  let tapT = -1e9, tapX = 0, tapY = 0;
  const onClick = e => {
    if (ctl(e.target)) return;
    const t = typeof e.timeStamp === 'number' ? e.timeStamp : Date.now(), dbl = t - tapT < 350 && Math.hypot(e.clientX - tapX, e.clientY - tapY) < 24;
    tapT = dbl ? -1e9 : t; tapX = e.clientX; tapY = e.clientY;
    if (dbl) focus(); else if (e.shiftKey) select(false, true); else select(); // (Shift-click: add to / take from the selection)
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
  // ---- initial state
  setPos(x, y, false); setFixed(FX); setW(w); setFold(fold); setZ(z);
  setTitle(o.title, o.sub);
  setChip(o.chip || null);
  mount();
  const M = {
    id, el, bar, body, cost: fin(o.cost) ? o.cost : 600, kind,
    rect: () => ({ x: lx, y: ly, w, h: fold ? BAR_H : measure() }),
    onScreen,
    setPos, setW, setFold, setZ, setTitle, setChip, setFixed,
    /** module-local offset of a jack (pure geometry: w and fold) */
    port(jackId) { const j = jacks.get(jackId), o = fold ? JACK_OUT : 0; return j ? { x: j.side === 'left' ? (o ? -o : 0) : w + o, y: jackY() } : { x: w / 2, y: BAR_H / 2 }; },
    // (additions) state reads for the track view, main.js and tests
    get x() { return lx; }, get y() { return ly; }, get w() { return w; }, get z() { return z; }, get fold() { return fold; },
    get screen() { return onScr; }, get fixed() { return FX ? Object.assign({}, FX) : null; }, get title() { return title; },
    dragging: () => !!D,
    /** the canvas arrow keys (cv-world key): one onMove start / end pair per nudge (one undo step) */
    nudge(dx, dy) {
      if (D || !fin(dx) || !fin(dy) || (!dx && !dy)) return;
      if (o.onMove) o.onMove(x, y, 'start');
      setPos(x + dx, y + dy, false);
      if (o.onMove) o.onMove(x, y, 'end');
    },
    jack: jackId => (jacks.get(jackId) || {}).el || null,
    openMenu,
    destroy() {
      if (dead) return;
      if (D) { D = null; dragEnd(); }
      moveDrag.destroy(); menuOff();
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
 * host.lay(key, entry, phase, what): 'start' opens the undo step of a move / fold (what), 'end' writes the
 * entry; an 'end' without a 'start' (bring to front: z) writes without an undo step; 'cancel' changes nothing.
 * (Additions: host.root — the element modules live in (default world.el: #world); host.shown(key) — a module went on /
 * off screen or folded (main.js: monitors.sync); host.size(kind) — the instrument's fixed size: {fixed: {w, h}} (a
 * Hardware layout) or {fixed: {w}} (the Simple layout, a Serum: the height measured; default defaultW(ID.inst, model));
 * host.select(key) / host.focus(key).)
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
  // the instrument's fixed size from the host: {fixed: {w, h}} (a Hardware layout) or {fixed: {w}} (the height measured)
  const sizeOf = () => {
    let s = null;
    try { s = H.size ? H.size('inst') : null; } catch (err) { s = null; }
    return isObj(s) && isObj(s.fixed) && fin(s.fixed.w) && s.fixed.w > 0 ? s : { fixed: { w: defaultW(ID.inst, T.model) } };
  };
  const kindOf = key => (key === ID.inst ? 'inst' : key === ID.out ? 'out' : 'fx');
  const sizes = () => { const o = {}; for (const [k, m] of mods) { const r = m.rect(); o[k] = { w: r.w, h: r.h }; } return o; };
  const tidied = () => { const o = {}; for (const [k, m] of mods) o[k] = { w: m.w }; return tidy(T, o); }; // (widths only: no layout read)
  // the lay entry of a module as it stands: never a width (each module's is fixed: a stored w from before is dropped
  // here, on its next write), z only once brought to front
  const entryOf = key => {
    const m = mods.get(key);
    if (!m) return null;
    const e = { x: Math.round(m.x), y: Math.round(m.y) }, old = isObj(T.lay) && isObj(T.lay[key]) ? T.lay[key] : null;
    if (m.fold) e.fold = 1;
    if (m.zSet) e.z = m.z;
    if (old && old.ui === 'flow') e.ui = 'flow'; // the instrument's layout choice (IMPL-panels §7.1) rides along
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
  let grp = null; // a group move: { key (the mover), x0, y0, list: [{ k, m, x0, y0 }] }
  const groupOf = key => {
    const ids = world && Array.isArray(world.selection) ? world.selection : null, m = mods.get(key);
    if (!m || !ids || ids.length < 2 || !ids.includes(key)) return null;
    return { key, x0: m.x, y0: m.y, list: ids.filter(k => k !== key && mods.has(k)).map(k => { const o = mods.get(k); return { k, m: o, x0: o.x, y0: o.y }; }) };
  };
  function make(key) {
    const kind = kindOf(key), M0 = meta(kind), L = layOf(T, key, tidied()), SZ = kind === 'inst' ? sizeOf() : null;
    const jk = kind === 'inst' ? [{ id: 'out', side: 'right', kind: 'audio', label: (M0.title || 'Instrument') + ' out' }]
      : kind === 'fx' ? [{ id: 'in', side: 'left', kind: 'audio', label: (M0.title || 'FX') + ' in' }, { id: 'out', side: 'right', kind: 'audio', label: (M0.title || 'FX') + ' out' }]
        : [{ id: 'in', side: 'left', kind: 'audio', label: 'OUT in' }];
    const m = createModule({
      id: key, kind, title: M0.title || '', sub: M0.sub, chip: M0.chip, color: T.color,
      x: L.x, y: L.y, w: defaultW(key, T.model), fold: !!L.fold, z: fin(L.z) ? L.z : 1, fixed: SZ ? SZ.fixed : null,
      cost: kind === 'inst' ? (T.model === 'serum' ? 3700 : 600) : kind === 'fx' ? 900 : 40,
      jacks: jk,
      body: H.bodies && H.bodies[kind] ? H.bodies[kind] : null,
      menu: () => (H.menu ? H.menu(kind, key) : []),
      onPress: () => front(key),
      onSelect: () => { if (H.select) H.select(key); },
      onDouble: () => { if (H.focus) H.focus(key); },
      onMove: (x, y, phase) => {
        // a selection of several moves together (stage 1c): the others follow the mover's delta, live, and land in the
        // same undo step (written after the mover's entry, which records it)
        if (phase === 'start') grp = groupOf(key);
        const G2 = grp && grp.key === key ? grp : null;
        if (G2) {
          const dx = m.x - G2.x0, dy = m.y - G2.y0;
          for (const g of G2.list) {
            if (phase === 'cancel') g.m.setPos(g.x0, g.y0, false);
            else if (phase !== 'start') g.m.setPos(g.x0 + dx, g.y0 + dy, phase === 'move');
          }
        }
        if (phase !== 'move') lay(key, phase, 'move');
        if (G2 && phase === 'end') for (const g of G2.list) if (H.lay) H.lay(g.k, entryOf(g.k), 'end', 'group');
        relay();
        if (phase === 'end' || phase === 'cancel') { update(key); if (G2) { for (const g of G2.list) update(g.k); grp = null; } }
      },
      onFold: f => { lay(key, 'start', 'fold'); lay(key, 'end', 'fold'); relay(); update(key); if (H.shown) H.shown(key); },
      onScreen: () => { if (H.shown) H.shown(key); },
      onSize: () => { relay(); update(key); },
    }, { world, doc });
    m.zSet = fin(L.z);
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
        const kind = kindOf(k), M0 = meta(kind), SZ = kind === 'inst' ? sizeOf() : null;
        if (SZ) m.setFixed(SZ.fixed); // (the size follows the model and the layout toggle, even mid-drag; before Tidy reads the widths)
        const L = layOf(T, k, tidied());
        if (!m.dragging()) {
          m.setPos(L.x, L.y, false);
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
    /** the module `key` is on screen (the world's plan, CULL_MARGIN early) and not folded: its live displays run */
    live(key) { const m = mods.get(key); return !!m && m.screen && !m.fold; },
    /** user actions from the module menus (each one undo step, except front) */
    toggleFold(key) { const m = mods.get(key); if (!m) return; m.setFold(!m.fold); lay(key, 'start', 'fold'); lay(key, 'end', 'fold'); relay(); update(key); if (H.shown) H.shown(key); },
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

