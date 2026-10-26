// cv-tray.js — the shell's trays (SPEC-canvas §2.1–§2.4, §3 drag-in; contract: docs/canvas/IMPL-1b.md §4.6): the one
// height budget of the top tray and the keyboard tray, the grip helper both use (lifted from main.js initKbView), the side
// tray (Sources, at the left), the Sources tray's tiles and their drag-out, the ≡ / ⚙ popovers and the sheets in #ov.
// Owner: SHELL lane. (2026-10-22, the user) The Effects tray (stage 1e's right side tray) is gone — its load estimates are in
// the FX rack's "+" menu (fx-ui opts.cost) —, the Sources tray folds all the way to a pull tab on the canvas edge (no rail),
// and every pull tab (the Sources tray's, the track list's, the keyboard's) works alike: a tap toggles, a pull drags the
// tray like a drawer and its release snaps it open or shut (pullSnap: a flick goes its way, else past half opens).
// Stage 2a (IMPL-2a §3): the Sources tray's Modulators section (sourcesTray o.mods: Mod Wheel, Velocity, Aftertouch, Bend;
// setPlaced greys a singleton that is already there). Milestone 3 (IMPL-3 §2.6): the Serum view's Serum parts (OSC, SUB,
// NOISE, FILTER, MACROS) and Note tools (ARP, CLIP) tiles (sourcesTray o.parts; the drops are the host's) — (WC) the rig's now.
// Stage 9 (IMPL-9 §4.6): the Sources view "Moog modules" — the Model 15 tile (the m900 model tile: the whole set, patched; no
// maker word, D4) and a tile row of its own (sourcesTray o.moog: MOOG_TILES — the module types by group, each an original
// monochrome glyph, MOOG_GLYPH); CLASSIC is models.js classicOf (a patch instrument is never in Hardware / Simple).
// Stage 9b (IMPL-9b §4.3; lane U9b): the set tiles System 35 / System 55 beside the Model 15 tile (sourcesTray o.sets:
// SET_TILES — not model tiles: tiles() stays the synths'; their art cv-art setArt; setPick / setDrag / setSetPlaced, setFull's
// reason at the cap), the module row in five groups (Sources · Modifiers · Control · Sequencing · Console & routing: 25 tiles)
// and the sixteen 9b glyphs, drawn from our faces (panels/m900b.js) as the nine were.
// Stage 9c (IMPL-9c §1.8, §2; lane K9c): the System IIIc set tile (s3c) and a sixth group, "1960s" (the ten new types: 35 tiles in all);
// their ten glyphs laid out from the tables (a dot per knob, a ring per jack), the CP3's the CP3A's.
// Stage WC (IMPL-WC §7; lane U): the rig's view (RIG.VIEW, after Serum, named by the display constant RIG.NAME — every word of it here
// reads the constant): the rig tile ("<year> · modular synth", no maker), the module tiles (RIG_TILES: milestone 3's part tiles became
// the rig's — Oscillator, Sub oscillator, Noise, Filter, Envelope, LFO, Macros; Arpeggiator and Clip sequencer arrive with the next cut,
// RIG_CUT, so WC-1's Note tools section is a placeholder), their headings written from the constant into the host's sections, rigFull's
// "full" texts for setPartPlaced; the Serum view keeps its tile and the modulators.
// Rules: plain ES module, no DOM at module top level, survives tests/main-sim.mjs's DOM stub (it keeps references to the
// nodes it makes or is given, never queries them back); imports carry ?v=9.
import * as wk from './wk.js?v=9';
import * as cvArt from './cv-art.js?v=9';
import { classicOf, isSerumModel, isRigModel } from './models.js?v=9';
import { RIG, MODULES } from './rig-core.js?v=9';
import * as MG from './moog-core.js?v=9';
import { MAX_MODS } from './patch-core.js?v=9';

/** Top tray heights (px): the collapsed row, the arrangement toolbar, the ruler, one track row (= arrange.js rowHeight). */
export const TOP_ROW = 48, ARR_BAR = 32, RULER = 24, ROW_H = 56;
/** The canvas never gets less than CANVAS_MIN px between the trays. */
export const CANVAS_MIN = 240;
/** Side trays: the default open width, a grip's least distance from the screen edge (gesture.js EDGE_PX). No rail
 * (2026-10-22): a closed tray is its pull tab on the canvas edge. */
export const SIDE_W = 240, EDGE_INSET = 24;
/** Side-tray panel widths a grip drag may give (px; the upper one also ≤ half the window). */
export const SIDE_MIN = 200, SIDE_MAX = 440;
/** Tray prefs (appstore): { top, topLast, src: {open, w} } (an `fx` record of the gone Effects tray is ignored). */
export const TRAY_PREF = 'synth.cv.trays';
/** A quick touch drag (wk.dragSource info.quick: no hold) drops only on a zone it rested on this long (a flick is a cancel). */
export const SETTLE_MS = 100;
/** The pull tabs (the user, 2026-10-22: "tap the tab as well as pull it out like a physical tray"): a press that travels
 * less than PULL_SLOP px is a tap (it toggles the tray), more a pull (the tray follows it); a release faster than FLICK_V
 * px / s is a flick (it goes its way, however far it was pulled); SNAP_MS the snap's glide (none with reduced motion). */
export const PULL_SLOP = 6, FLICK_V = 500, SNAP_MS = 220;
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

/** (stage M, IMPL-M §5.1) The track list's footer — the Master row (master-ui.js: 44 px) — under the rows' scroller. */
export const FOOT_H = 44;
/** The top tray's height stops for n tracks: [TOP_ROW, TOP_ROW + ARR_BAR + RULER + ROW_H·1 + foot, …, + ROW_H·n + foot] — foot
 * (stage M: the footer's height, FOOT_H) on every stop but the collapsed one (the footer shows whenever the rows do).
 * @param {number} n @param {number} [foot] @returns {number[]} */
export function topSnaps(n, foot = 0) {
  const out = [TOP_ROW], k = Math.max(0, Math.floor(+n || 0)), f = Math.max(0, +foot || 0);
  for (let i = 1; i <= k; i++) out.push(TOP_ROW + ARR_BAR + RULER + ROW_H * i + f);
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
/** Where a pulled tray settles: `out` px of its `full` travel pulled out, `v` its release speed (px / s, + outward) → open?
 * A flick (|v| ≥ FLICK_V) goes its way; slower, past half its travel opens. Pure.
 * @param {number} out @param {number} full @param {number} [v] @returns {boolean} */
export function pullSnap(out, full, v = 0) {
  if (v >= FLICK_V) return true;
  if (v <= -FLICK_V) return false;
  return full > 0 ? out >= full / 2 : out > 0;
}
/** A pull's release speed (px / s, + outward) from its samples [{t: ms, p: px outward}]: the travel over the last ≤ 100 ms
 * (a finger that rested before lifting: 0). Pure. @param {Array<{t: number, p: number}>} S @returns {number} */
export function pullSpeed(S) {
  const n = S ? S.length : 0;
  if (n < 2) return 0;
  const b = S[n - 1];
  let a = S[n - 2];
  for (let i = n - 3; i >= 0 && b.t - S[i].t <= 100; i--) a = S[i];
  const dt = b.t - a.t;
  return dt > 0 ? ((b.p - a.p) / dt) * 1000 : 0;
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

/** (WC pre-deploy [toast]) The notice line's room: NOTICE_GAP px from what it sits beside, at most NOTICE_MAX px wide, never squeezed
 * under NOTICE_MIN px (a narrower room wraps it into a column); NOTICE_LIFT px over the stage's foot where nothing else decides;
 * (round 2) NOTICE_FLOOR px: the narrowest column a narrow window's free span gives it (two short words a line) before a narrower one. */
export const NOTICE_GAP = 12, NOTICE_MAX = 620, NOTICE_MIN = 200, NOTICE_LIFT = 24, NOTICE_FLOOR = 96;
const crosses = (a, b, m = 0) => !!a && !!b && a.left < b.right + m && a.right > b.left - m && a.top < b.bottom + m && a.bottom > b.top - m;
/**
 * (WC pre-deploy [toast]) Where the notice line goes (main.js noticePlace; the 8 s "· tap to undo" lay centred on the canvas toolbar's
 * row: a tap meant for Fit / Tidy landed on it and undid the last step). It never lies over the toolbar (its row, its fold button, the
 * page-zoom chip), the minimap, the keyboard's grip, the open Sources tray or its pull tab. The rooms, in order: beside the toolbar on
 * its row (on the row's centre line, lifted clear of the grip's box), above the row right of the minimap (the toolbar's left without
 * one) — the toolbar's foot, which a fit keeps clear of modules (cv-world band) — and above both (centred past the tray). Of the rooms
 * that touch none of them, the one where the line takes the fewest lines, a room above both counting 1.5 more (one line there loses to
 * two in the foot), the earlier on a tie; a wrapped line grows upward from its foot. No toolbar (the roll; the canvas hidden): centred
 * over the stage NOTICE_LIFT px above its foot, lifted clear of the grip. (round 2 — the skeptic) None of them clear (a narrow window —
 * a 1/3 or 1/2 split, Slide Over, a phone — with the Sources tray open; the tray pulled wide): a free column of the stage (below), never
 * the old fall back onto the tray, its tab or the toolbar's fold button; only where no column is left at all (the tray wider than the
 * window) the last room tried. Its size at a width: o.fit's measure where given (a wrap carries whole words down — a line more than
 * need / width), else that estimate. Pure (o.fit aside).
 * @param {{stage: Box | null, bar?: Box | null, map?: Box | null, grip?: Box | null, tray?: Box | null, tab?: Box | null, top?: Box | null,
 *   w: number, h: number, fit?: (maxW: number) => {w: number, h: number, lines?: number}}} o
 *   client boxes ({left, top, right, bottom}; null: not shown; top: the track list's grip over the stage's top edge) and the notice's
 *   one-line size (px); fit: its size at a whole-px max width
 * @returns {{x: number, bottom: number, maxW: number} | null} its left edge and its bottom edge (client px) and the width it may take;
 *   null: nothing measured (the stylesheet's spot)
 * @typedef {{left: number, top: number, right: number, bottom: number}} Box
 */
export function noticeSpot(o) {
  const S = o && o.stage;
  if (!S || !(S.right > S.left) || !(S.bottom > S.top)) return null;
  const box = n => (n && n.right > n.left && n.bottom > n.top ? n : null);
  const bar = box(o.bar), map = box(o.map), grip = box(o.grip), tray = box(o.tray), tab = box(o.tab), avoid = [bar, map, grip, tray, tab, box(o.top)].filter(Boolean);
  const need = Math.min(Math.max(0, +o.w || 0), NOTICE_MAX), h = Math.max(0, +o.h || 0), G = NOTICE_GAP;
  const L = Math.max(S.left, tray ? tray.right : S.left) + G, R = S.right - G;
  const fits = new Map(), size = mw => { // (its size at a max width: measured once a width, else need / width lines of h)
    const lines = Math.max(1, Math.ceil(need / mw - 1e-9)), est = { w: Math.min(need, mw), h: h * lines, lines };
    if (typeof o.fit !== 'function') return est;
    const k = Math.floor(mw);
    if (!fits.has(k)) { const f = o.fit(k) || {}; fits.set(k, +f.h > 0 ? { w: Math.min(+f.w || k, k), h: +f.h, lines: Math.max(1, Math.round(+f.lines) || lines) } : est); }
    return fits.get(k);
  };
  const rooms = []; // { x (null: centred over L…R), b: its foot }
  if (bar) {
    rooms.push({ x: bar.right + G, b: bar.bottom, row: bar.bottom - bar.top });
    rooms.push({ x: map ? map.right + G : bar.left, b: bar.top - 8 });
    rooms.push({ x: null, b: Math.min(bar.top, map ? map.top : bar.top) - 8 });
  } else rooms.push({ x: null, b: S.bottom - NOTICE_LIFT });
  let best = null, rank = Infinity, last = null;
  for (const q of rooms) {
    const room = Math.min(R - (q.x == null ? L : q.x), NOTICE_MAX);
    if (room < Math.min(need, NOTICE_MIN)) continue;
    const z = size(room), lines = z.lines, ww = z.w, hh = z.h, x = q.x == null ? L + (R - L - ww) / 2 : q.x;
    let b = q.row ? q.b - Math.max(0, (q.row - hh) / 2) : q.b; // (on the row's centre line; taller, up from its foot)
    if (grip && crosses({ left: x, top: b - hh, right: x + ww, bottom: b }, grip, 2)) b = Math.min(b, grip.top - 4); // (lifted clear of the grip)
    const r = { left: x, top: b - hh, right: x + ww, bottom: b }, k = lines + (q.x == null && bar ? 1.5 : 0);
    last = { x, bottom: b, maxW: room };
    if (r.top < S.top || r.right > S.right || avoid.some(n => crosses(r, n, 2)) || k >= rank) continue;
    best = last; rank = k;
  }
  if (best) return best;
  // (round 2) the free column: at a foot — that last room's, over the top of each thing, the toolbar's foot, the stage's top
  // (NOTICE_GAP px under it) — the widest span of the stage that the band of the line's height crosses nothing in (each thing cut out
  // NOTICE_GAP px either side: the tray and its width grip, its tab, the grips, the toolbar, the minimap), the band as tall as the line
  // takes in that span; at least NOTICE_FLOOR px wide (a narrower span only when none is); centred in it; the fewest lines, the lowest on
  // a tie. No column at all (a short window, the tray pulled over most of it: the toolbar, the minimap and the tab fill what is left):
  // the same with the minimap given up — the chrome least tapped right after an add or a swap (not the toolbar's row, the tray, its tab,
  // a grip, the track list); only where even that has none (the tray wider than the window), the last room tried
  const T0 = S.top + G, f0 = rooms[rooms.length - 1].b;
  const column = (things, floor) => {
    const feet = [f0, ...things.map(n => n.top - 8), ...(bar ? [bar.bottom] : [])].filter((f, i, a) => f > T0 && f <= S.bottom && a.indexOf(f) === i);
    feet.sort((a, c) => c - a).push(null); // (null: the stage's top)
    const spans = (t, b) => {
      let out = [[S.left + G, R]];
      for (const n of things) {
        if (!(n.top < b + 2 && n.bottom > t - 2)) continue;
        const a = n.left - G, e = n.right + G;
        out = out.flatMap(([l, r]) => (e <= l || a >= r ? [[l, r]] : [...(a > l ? [[l, a]] : []), ...(e < r ? [[e, r]] : [])]));
      }
      return out.reduce((a, sp) => (!a || sp[1] - sp[0] > a[1] - a[0] ? sp : a), null);
    };
    let col = null, fk = Infinity;
    for (const f of feet) {
      let hh = h, z = null, sp = null;
      for (let i = 0; i < 8 && !z; i++) { // (a taller band only narrows the span: the lines settle)
        const b = f == null ? T0 + hh : f;
        if (b - hh < T0 - 0.5) break;
        sp = spans(b - hh, b);
        if (!sp || sp[1] - sp[0] < floor) break;
        const c = size(Math.min(sp[1] - sp[0], NOTICE_MAX));
        if (c.h <= hh + 0.5) z = c; else hh = c.h;
      }
      if (!z || z.lines >= fk) continue;
      col = { x: sp[0] + (sp[1] - sp[0] - z.w) / 2, bottom: f == null ? T0 + z.h : f, maxW: Math.min(sp[1] - sp[0], NOTICE_MAX) }; fk = z.lines;
    }
    return col;
  };
  const bare = avoid.filter(n => n !== map);
  return column(avoid, NOTICE_FLOOR) || column(avoid, 48) || (map && (column(bare, NOTICE_FLOOR) || column(bare, 48))) || last;
}

/**
 * A tray grip — the pull tab on a top / bottom tray's edge (role=slider): pointer drag with capture (a two-finger
 * pointercancel — e.gesture === 'two-finger' — puts the height back unsaved: set(h0, 'cancel'); the pinch is the page's /
 * the canvas's), arrows / Page Up / Down / Home / End, Delete / Backspace reset, ARIA valuenow / valuemin / valuemax /
 * valuetext. Up / Right = taller whatever the edge. A drag clamps to [min(), max()] and snaps on release when o.snaps is
 * given (keys step from snap to snap then). (2026-10-22, the user: "tap the tab as well as pull it out like a physical
 * tray") a tap — a press of any pointer that travels < PULL_SLOP px — and Enter / Space → o.onTap (the tray opens / folds;
 * no double-tap any more); a release flicked inward (≤ −FLICK_V) folds the tray (set(min(), 'end')), one flicked outward
 * from its fold opens it to o.open(); slower, the snaps decide (the first stop: past half its travel). o.fold: a tray that
 * folds away past its least (the keyboard: nothing but this tab left). Folded (fold.closed()), a pull drags its drawer out
 * — fold.begin() → its travel px, then fold.pull(out px) per move — and the release settles it (fold.done(open, 'end' |
 * 'cancel'): pullSnap, a two-finger cancel shut again); open, a drag below min() goes on as that drawer closing (the height
 * held at min(); fold.pull(null): back above it), released there by pullSnap again — folded away with its height set back
 * to h0 (set(h0, 'cancel')), or open at min(); a flick inward from anywhere folds it away. Folded, the tab is a button
 * (role, aria-expanded false, fold.label; no values) and only a tap / Enter / Space or a pull act on it.
 * @param {HTMLElement} grip
 * @param {{
 *   edge: 'top' | 'bottom', label: string,
 *   get: () => number, set: (px: number, phase: 'move' | 'end' | 'cancel' | 'key' | 'reset') => void,
 *   min: () => number, max: () => number, snaps?: () => number[], step?: number,
 *   onTap?: () => void, open?: () => number, start?: () => void, text?: (px: number) => string, doc?: Document,
 *   fold?: {closed: () => boolean, begin: () => number, pull: (out: number | null) => void, done: (open: boolean, how: 'end' | 'cancel') => void, label?: string},
 * }} o
 * @returns {{sync: () => void, destroy: () => void, dragging: () => boolean}}
 */
export function trayGrip(grip, o) {
  const sign = o.edge === 'top' ? 1 : -1; // a top tray grows downward, a bottom tray upward
  const step = o.step > 0 ? +o.step : 10, F = o.fold || null;
  const lo = () => +o.min() || 0, hi = () => Math.max(lo(), +o.max() || 0);
  const lim = v => clamp(Math.round(v), lo(), hi());
  const snapsOf = () => (typeof o.snaps === 'function' ? o.snaps() || null : null);
  if (!grip.getAttribute('role')) grip.setAttribute('role', 'slider');
  if (grip.getAttribute('tabindex') == null) grip.setAttribute('tabindex', '0');
  grip.setAttribute('aria-orientation', 'vertical');
  if (o.label) grip.setAttribute('aria-label', o.label);
  let drag = null, moved = false;
  const tap = () => { if (typeof o.onTap === 'function') o.onTap(); sync(); };
  function sync() {
    if (F) { // folded away the tab is a button (aria-expanded false, fold.label), else the height slider again
      const shut = !!F.closed();
      grip.setAttribute('role', shut ? 'button' : 'slider');
      if (shut) { grip.setAttribute('aria-expanded', 'false'); grip.setAttribute('aria-label', F.label || (o.label || 'Tray') + ': show it'); for (const a of ['aria-orientation', 'aria-valuenow', 'aria-valuemin', 'aria-valuemax', 'aria-valuetext']) grip.removeAttribute(a); return; }
      grip.removeAttribute('aria-expanded'); grip.setAttribute('aria-orientation', 'vertical');
      if (o.label) grip.setAttribute('aria-label', o.label);
    }
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
    if (!moved) { if (!roll && e && e.type === 'pointerup') tap(); return; } // (a tap: the tray opens / folds)
    if (e && isFinite(e.clientY)) D.S.push({ t: tOf(e), p: sign * (e.clientY - D.y0) });
    const v = roll ? 0 : pullSpeed(D.S);
    if (D.shut) F.done(!roll && pullSnap(D.out, D.full, v), roll ? 'cancel' : 'end'); // (folded: its drawer only)
    else if (roll) { o.set(D.h0, 'cancel'); if (D.out >= 0) F.done(true, 'cancel'); }
    else if (F && (D.out >= 0 || v <= -FLICK_V)) { // in its drawer, or flicked in: back at its least, or folded away (its height as it was)
      if (D.out >= 0 && pullSnap(D.out, D.full, v)) { o.set(lo(), 'end'); F.done(true, 'end'); }
      else { o.set(D.h0, 'cancel'); F.done(false, 'end'); }
    } else if (v <= -FLICK_V) o.set(lo(), 'end'); // flicked in: folded to its least
    else if (v >= FLICK_V && D.h0 <= lo() + 2 && typeof o.open === 'function') o.set(lim(o.open()), 'end'); // flicked out of its fold: open
    else { const S = snapsOf(); o.set(S ? nearestSnap(S, D.cur, hi()) : D.cur, 'end'); }
    sync();
  }
  const offs = [
    listen(grip, 'pointerdown', e => {
      if (e.button > 0 || drag) return;
      if (e.preventDefault) e.preventDefault(); // (a mouse press does not focus it: the arrow keys stay the page's)
      moved = false;
      const h = +o.get() || 0;
      drag = { id: e.pointerId, y0: e.clientY, h0: h, cur: h, shut: !!(F && F.closed()), out: -1, full: 0, S: [{ t: tOf(e), p: 0 }] };
      grip.classList.add('drag');
      try { grip.setPointerCapture(e.pointerId); } catch { /* pointer gone */ }
      if (typeof o.start === 'function') o.start();
    }),
    listen(grip, 'pointermove', e => {
      const D = drag;
      if (!D || e.pointerId !== D.id) return;
      if (e.pointerType === 'mouse' && e.buttons === 0) { finish(e, false); return; } // a swallowed pointerup
      const out = sign * (e.clientY - D.y0); // (+ outward: a top tray down, a bottom tray up)
      D.S.push({ t: tOf(e), p: out });
      if (D.S.length > 8) D.S.shift();
      if (!moved && Math.abs(out) < PULL_SLOP) return; // a tap so far
      moved = true;
      if (D.shut) { // folded: its drawer follows the finger out
        if (D.out < 0) D.full = Math.max(1, +F.begin() || 0);
        D.out = clamp(out, 0, D.full);
        F.pull(D.out);
        return;
      }
      const v = D.h0 + out;
      if (F && v < lo()) { // below its least: the drawer closes under the finger
        if (D.out < 0) { D.cur = lo(); o.set(lo(), 'move'); D.full = Math.max(1, +F.begin() || 0); }
        D.out = clamp(D.full - (lo() - v), 0, D.full);
        F.pull(D.out);
        sync();
        return;
      }
      if (D.out >= 0) { D.out = -1; F.pull(null); } // (back above it: the tray in its place)
      D.cur = lim(v);
      o.set(D.cur, 'move');
      sync();
    }),
    listen(grip, 'pointerup', e => finish(e, false)),
    listen(grip, 'pointercancel', e => finish(e, !!e && e.gesture === 'two-finger')),
    listen(grip, 'lostpointercapture', e => { if (drag && e.pointerId === drag.id) finish(e, false); }),
    listen(grip, 'contextmenu', e => { if (e.preventDefault) e.preventDefault(); }),
    listen(grip, 'keydown', e => {
      const k = e.key, S = snapsOf(), cur = +o.get() || 0;
      let v = null, phase = 'key';
      if ((k === 'Enter' || k === ' ' || k === 'Spacebar') && typeof o.onTap === 'function') { // (2026-10-22) open / fold, as a tap
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation(); // (not the page's Space: play / stop)
        tap();
        return;
      }
      if (F && F.closed()) return; // (folded away: nothing to size)
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
 * A side tray (2026-10-22, the user: "collapse all the way down to the same pull tab that the track list and keyboard have";
 * no rail): closed, only its pull tab shows, on the canvas edge; open, the panel (SIDE_W, resizable by a grip on its inner
 * edge ≥ EDGE_INSET from the screen edge) with the tab riding that edge. The tab (a button: aria-expanded, aria-controls,
 * its label): a tap / Enter / Space toggles; a pull past PULL_SLOP drags the tray with the finger (class `pull`, a
 * translateX on el — no layout), its release snaps it open or shut (pullSnap: a flick goes its way, else past half opens;
 * the glide is the stylesheet's transition) and a two-finger cancel puts it back as it was (the pinch is the canvas's).
 * It closes only on its tab, its ✕ and Escape (the caller's chain) — never by itself: not on a press outside it (a tap on
 * the canvas keeps it open), a tile's tap, a drag leaving it or a drop (the user's rule). Closed = el without `open`: the
 * stylesheet slides it out and hides it (visibility: the panel leaves the tab order), never `hidden` (it would cut the glide).
 * o.tab (o.rail: the older name) / o.panel / o.grip: the tray's nodes (index.html); missing ones are made. o.key: its part of
 * the TRAY_PREF record.
 * @param {HTMLElement} el  #srcTray
 * @param {{side: 'left' | 'right', store?: {get: Function, set: Function}, key?: string, tab?: HTMLElement, rail?: HTMLElement,
 *   panel?: HTMLElement, grip?: HTMLElement, label?: string, onChange?: (open: boolean) => void, doc?: Document}} o
 * @returns {{open: () => void, close: () => boolean, toggle: () => void, isOpen: () => boolean, pulling: () => boolean,
 *   width: () => number, setWidth: (px: number) => void, el: HTMLElement, panel: HTMLElement, tab: HTMLElement,
 *   grip: HTMLElement, destroy: () => void}}
 */
export function sideTray(el, o) {
  const d = docOf(o, el), side = o.side === 'right' ? 'right' : 'left', key = o.key || (side === 'left' ? 'src' : 'fx'), dir = side === 'left' ? 1 : -1;
  const tab = o.tab || o.rail || el.appendChild(mk(d, 'button', 'cv-stab'));
  const panel = o.panel || el.appendChild(mk(d, 'div', 'cv-panel'));
  const grip = o.grip || el.appendChild(mk(d, 'div', 'cv-sgrip'));
  if (tab.tagName === 'BUTTON' && !tab.getAttribute('type')) tab.setAttribute('type', 'button');
  tab.setAttribute('aria-expanded', 'false');
  if (panel.id) tab.setAttribute('aria-controls', panel.id);
  if (!tab.getAttribute('aria-label')) tab.setAttribute('aria-label', o.label || 'Tray');
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.setAttribute('aria-label', (o.label || 'Tray') + ' width');
  if (grip.getAttribute('tabindex') == null) grip.setAttribute('tabindex', '0');
  panel.hidden = false; // (closed is the stylesheet's: el without `open`)
  const pref = () => { const p = o.store ? o.store.get(TRAY_PREF, null) : null; return p && typeof p === 'object' ? p : {}; };
  const saved = pref()[key] || {};
  let w = clamp(+saved.w || SIDE_W, SIDE_MIN, SIDE_MAX), open = false;
  const maxW = () => { const win = d && d.defaultView, vw = win && win.innerWidth > 0 ? win.innerWidth : 1e4; return Math.max(SIDE_MIN, Math.min(SIDE_MAX, Math.floor(vw / 2))); };
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
    tab.setAttribute('aria-expanded', on ? 'true' : 'false');
    // a press outside (the canvas, the top tray …) leaves it open (the user's call): only its tab, its ✕ and Escape close it
    if (persist) save();
    if (typeof o.onChange === 'function') o.onChange(on);
  }
  // the tab's pull: the tray follows the finger (translateX from shut, −w, to open, 0); its release snaps it
  let P = null, eat = false;
  const slide = out => { if (el.style) el.style.transform = out == null ? '' : 'translateX(' + Math.round(dir * (out - w)) + 'px)'; };
  function pullEnd(e, roll) {
    const D = P;
    if (!D || (e && e.pointerId !== D.id)) return;
    P = null;
    try { tab.releasePointerCapture(D.id); } catch { /* released */ }
    if (!D.moved) return; // (a tap: its click toggles)
    if (e && e.type === 'pointerup') eat = true; // (the click a pull ends with is no tap)
    if (e && isFinite(e.clientX)) D.S.push({ t: tOf(e), p: dir * (e.clientX - D.x0) });
    el.classList.remove('pull');
    slide(null); // (the stylesheet's transition glides it on from where it is)
    setOpen(roll ? D.open0 : pullSnap(D.out, w, pullSpeed(D.S)));
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
      w = clamp(Math.round(g.w0 + dir * (e.clientX - g.x0)), SIDE_MIN, maxW());
      applyW();
    }),
    listen(grip, 'pointerup', e => { if (g && e.pointerId === g.id) { g = null; grip.classList.remove('drag'); save(); } }),
    listen(grip, 'pointercancel', e => {
      if (!g || e.pointerId !== g.id) return;
      if (e.gesture === 'two-finger') { w = g.w0; applyW(); }
      g = null; grip.classList.remove('drag'); save();
    }),
    listen(grip, 'keydown', e => {
      const dd = { ArrowRight: 16 * dir, ArrowLeft: -16 * dir }[e.key];
      if (!dd) return;
      if (e.preventDefault) e.preventDefault();
      w = clamp(w + dd, SIDE_MIN, maxW()); applyW(); save();
    }),
    listen(tab, 'pointerdown', e => {
      eat = false;
      if (e.button > 0 || P) return;
      P = { id: e.pointerId, x0: e.clientX, open0: open, out: open ? w : 0, moved: false, S: [{ t: tOf(e), p: 0 }] };
      try { tab.setPointerCapture(e.pointerId); } catch { /* gone */ }
    }),
    listen(tab, 'pointermove', e => {
      const D = P;
      if (!D || e.pointerId !== D.id) return;
      if (e.pointerType === 'mouse' && e.buttons === 0) { pullEnd(e, false); return; } // a swallowed pointerup
      const dx = dir * (e.clientX - D.x0); // (+ outward)
      D.S.push({ t: tOf(e), p: dx });
      if (D.S.length > 8) D.S.shift();
      if (!D.moved && Math.abs(dx) < PULL_SLOP) return; // a tap so far
      if (!D.moved) { D.moved = true; el.classList.add('pull'); }
      D.out = clamp((D.open0 ? w : 0) + dx, 0, w);
      slide(D.out);
    }),
    listen(tab, 'pointerup', e => pullEnd(e, false)),
    listen(tab, 'pointercancel', e => pullEnd(e, !!e && e.gesture === 'two-finger')),
    listen(tab, 'lostpointercapture', e => { if (P && e.pointerId === P.id) pullEnd(e, false); }),
    listen(tab, 'click', () => { if (eat) { eat = false; return; } setOpen(!open); }),
  ];
  applyW();
  if (saved.open) setOpen(true, false);
  return {
    el, panel, tab, grip,
    open: () => setOpen(true),
    close: () => { if (!open) return false; setOpen(false); return true; },
    toggle: () => setOpen(!open),
    isOpen: () => open,
    pulling: () => !!P && P.moved,
    width: () => w,
    setWidth: px => { w = clamp(Math.round(+px || SIDE_W), SIDE_MIN, maxW()); applyW(); save(); },
    destroy() { for (const f of gOffs) f(); if (P) pullEnd(null, true); },
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
// (milestone 3, IMPL-3 §2.6; WC, IMPL-WC §7) o.parts: [{id, name, group: 'rigmods' | 'rignotes', cut}] (RIG_TILES: the rig's
// module tiles — Oscillator … Macros — and its note tools, ARP and CLIP, the next cut's) — one button.cv-tile.cv-ptile[data-part]
// [data-group] per live item (cut ≤ RIG_CUT: an original glyph, the name, span.cv-treason) in o.partsEl / o.notesEl (their sections
// o.partsSec / o.notesSec, headed and labelled from the view's section — RIG.NAME's —, shown in a view with that section; without
// the elements: a section of their own in o.secEl, in place of the placeholder; a group with no live tile is the placeholder, in
// the host's section when it gives one). A tap: (o.partPick || o.pick)(id, mode); a drag as a modulator tile's through (o.partDrag
// || o.drag) with info.part = true, info.over 'canvas' or null, info.at the world point; the ghost hides over the canvas while
// o.partCanvasGhost() says the world draws an outline. setPartPlaced(id, reason | null) greys a tile with its reason (the host's —
// rigFull(kind): "This <NAME> already has 3 oscillators"); the drop's own refusals are the host's (§3.5). Without o.parts the two
// sections stay placeholders.
// (8, IMPL-8 §1.2) o.ctls: [{id: 'pads', name}] (CTL_TILES) — the Controllers view's tile row, a Modulators-style row of its own (not the
// Serum parts): one button.cv-tile.cv-mtile[data-ctl] per item (an original glyph, the name, span.cv-treason) in o.ctlsEl (its section
// o.ctlsSec shown in a view with 'ctls'; without the element: an h3.cv-tgrp "Controllers" and the tiles after the synths in el). A tap:
// (o.ctlPick || o.modPick || o.pick)(id, mode); a drag as a modulator tile's through (o.ctlDrag || o.modDrag || o.drag) with info.ctl =
// true, info.over 'canvas' or null, info.at the world point, the ghost hidden over the canvas while o.ctlCanvasGhost (else
// o.modCanvasGhost)() says the world draws an outline. setPlaced(id, reason | null) greys a tile with its reason (not `multi`: a Pads
// module's tile greys only at the project's 8th); ctlTiles() / ctlTile(id).
// (8) The SDS-V (family 'drums', no sequencer) is a Drums tile like the others: DR_META names it "drum synth".
const DR_TIP = { tr909: 'our model of its analog circuits; its hi-hats and cymbals are our own sounds through its playback circuit, not recordings', // (7c, IMPL-7c §8.2)
  sdsv: 'our model of its analog circuits, with our own factory sounds, not recordings; no sequencer — play it from its pads, a Pads module, the keyboard or MIDI' }; // (8)
const DR_META = { sdsv: 'drum synth' };
// ((9) CLASSIC: a classic keyboard synth — models.js classicOf, so a patch instrument (family 'patch') is never in Hardware / Simple)
const CLASSIC = classicOf, DRUMS = m => m.family === 'drums', PATCH = m => m.family === 'patch', TO_SERUM = 'Serum and its modulators: the Serum view (the menu above).';
export const SRC_VIEWS = [
  { id: 'hw', label: 'Hardware', tip: 'The classic synths with their real front panel', layout: 'hw', note: TO_SERUM, sections: [{ id: 'synths', models: CLASSIC }] },
  { id: 'flow', label: 'Simple', tip: 'The classic synths with the simple panel', layout: 'flow', note: TO_SERUM, sections: [{ id: 'synths', models: CLASSIC }] },
  { id: 'serum', label: 'Serum', tip: 'Serum and the modules made for it', note: 'Drop a modulator on the canvas and cable its jack to any knob.',
    sections: [{ id: 'serum', models: isSerumModel }, { id: 'mods' }] }, // ((WC, IMPL-WC §6, §7) the Serum tile and the modulators: no Serum parts, no note tools (the part tiles are the rig's — its own view); the rig (custom too) is not here)
  // (WC, IMPL-WC §7) the rig: its tile, its module tiles (o.parts: RIG_TILES, group 'rigmods'), Note tools (group 'rignotes': the next
  // cut's — a placeholder until RIG_CUT reaches them), the modulators; no layout of its own (the classics' kept)
  { id: RIG.VIEW, label: RIG.NAME, tip: 'Our own modular synth, patched with cords', // (the menu shows the label above the tip: the name once)
    note: `Drop a module onto the canvas: on a ${RIG.NAME} it adds itself and plugs in; on any other instrument it starts a ${RIG.NAME} with it.`,
    sections: [{ id: 'rig', models: isRigModel }, { id: 'rigmods', head: RIG.NAME + ' modules' }, { id: 'rignotes', head: 'Note tools', note: `The ${RIG.NAME}’s Arpeggiator and Clip sequencer arrive in a later update.` }, { id: 'mods' }] }, // ((WC, integration fixer L — review WC-int P3-8) our words, not the plan's "next cut"
  { id: 'drums', label: 'Drums', tip: 'Drum machines with their real front panel', layout: 'hw',
    note: 'More machines later.', sections: [{ id: 'drums', models: DRUMS }] },
  { id: 'ctl', label: 'Controllers', tip: 'Pad grids that play and modulate any track',
    note: 'A Pads module plays any track (drum hits, notes, chords) and its pads can modulate any knob. More controllers later.', sections: [{ id: 'ctls' }] },
  // (9, IMPL-9 §4.6) the patch modules: the Model 15 tile (a model tile: the tray makes one per MODELS id), then their own row;
  // (9b, IMPL-9b §4.3) the set tiles System 35 / 55 after the Model 15 tile (sets: o.sets)
  { id: 'moog', label: 'Moog modules', tip: 'The 900-series modules, patched with cords', layout: 'hw',
    note: 'Model 15, System 35, System 55 and System IIIc bring a whole set, patched. Drop a module onto a 900 Series track to add it. The Moog Modular (a fixed patch) stays in Hardware.',
    sections: [{ id: 'm15', models: PATCH, sets: true }, { id: 'moog' }] },
];
/** (9b, IMPL-9b §1.2, §4.3; 9c, IMPL-9c §2) The set tiles (System 35, System 55, System IIIc; moog-core SETS — the Model 15's is the m900 model tile): id, name,
 * modules (the tile's "N modules": its set, the controller not counted), starter (the patch it loads). The host passes them as
 * o.sets (or o.sets: true). */
export const SET_TILES = Object.freeze(['s35', 's55', 's3c'].map(id => Object.freeze({ id, name: MG.SETS[id].name, modules: MG.SETS[id].set.length, starter: MG.SETS[id].starter })));
/** (9b) A set tile's reason at the module cap (patch-core setNeeds: the modules loadSet would add): null while count + needs ≤ max. */
export function setFull(count, needs, max = MAX_MODS) {
  const n = (count | 0) + (needs | 0) - max;
  return needs >= 0 && n > 0 ? `This set needs ${n} more module${n === 1 ? '' : 's'} than the patch can hold` : null;
}
/** (9, IMPL-9 §4.6) The Moog modules view's tiles (id = the module type cv-patch adds; group: Sources · Modifiers · Control, in
 * the family's tray order). The host passes them as o.moog (or o.moog: true). */
export const MOOG_TILES = Object.freeze(MG.ORDER.map(t => Object.freeze({ id: t, name: MG.TYPES[t].tile, group: MG.TYPES[t].group })));
/** The groups' headings (moog-core GROUPS). */
export const MOOG_GROUPS = MG.GROUPS;
// original monochrome glyphs (ours, from our own faces: panels/m900.js): a tall panel outline (1, 2 or 3 MU wide), its knobs as
// dots (a switch a small bar), its jacks as rings (an S-trigger socket a small square) in the module's own arrangement; (9b) the
// sixteen of panels/m900b.js the same way (laid out from cv-panel geometry, rear terminals never drawn): 4 and 8 MU 38 wide, a
// console-height panel 27 tall, the 960 at its face's aspect; a routing switch a small square, an event button an outlined cap
// (.e), a live lamp a small disc (.l), inert parts (trunks, the CP8A's) dim (.i)
export const MOOG_GLYPH = Object.freeze({
  921: '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="10" y="1" width="20" height="42" rx="1.5"/><rect class="k" x="11.6" y="7.5" width="3" height="1.8" rx="0.6"/><rect class="k" x="11.2" y="11.2" width="3" height="1.8" rx="0.6"/><circle class="k" cx="18.9" cy="9.9" r="2.1"/><circle class="k" cx="26.2" cy="9.7" r="2.1"/><circle class="j" cx="13" cy="17" r="1.3"/><circle class="j" cx="13" cy="20.7" r="1.3"/><circle class="k" cx="18.9" cy="18.2" r="2.1"/><circle class="k" cx="26.1" cy="18.1" r="2.1"/><circle class="j" cx="13" cy="24.6" r="1.3"/><rect class="j" x="11.7" y="26.9" width="2.6" height="2"/><circle class="k" cx="18.9" cy="26.2" r="2.1"/><circle class="k" cx="26.1" cy="26.3" r="2.1"/><circle class="j" cx="13" cy="32.8" r="1.3"/><circle class="j" cx="16.6" cy="32.8" r="1.3"/><circle class="j" cx="20.1" cy="32.8" r="1.3"/><circle class="j" cx="24.3" cy="32.8" r="1.3"/><circle class="j" cx="27.8" cy="32.8" r="1.3"/><circle class="j" cx="13" cy="36.8" r="1.3"/><circle class="j" cx="17.8" cy="36.8" r="1.3"/><circle class="j" cx="22.5" cy="36.8" r="1.3"/><circle class="j" cx="27.3" cy="36.8" r="1.3"/></svg>',
  '921a': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><rect class="k" x="18.5" y="6.7" width="3" height="1.8" rx="0.6"/><circle class="k" cx="20" cy="14.4" r="2.1"/><circle class="k" cx="20" cy="22.7" r="2.1"/><circle class="j" cx="17.1" cy="28.8" r="1.3"/><circle class="j" cx="22.9" cy="28.8" r="1.3"/><circle class="j" cx="17.1" cy="33.9" r="1.3"/><circle class="j" cx="22.9" cy="33.9" r="1.3"/><circle class="j" cx="20" cy="38" r="1.3"/></svg>',
  '921b': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><circle class="k" cx="20" cy="9.3" r="2.1"/><circle class="k" cx="20" cy="16.9" r="2.1"/><rect class="k" x="16.1" y="22.2" width="3" height="1.8" rx="0.6"/><circle class="j" cx="23.1" cy="23.1" r="1.3"/><circle class="j" cx="17.1" cy="28.4" r="1.3"/><circle class="j" cx="22.9" cy="28.4" r="1.3"/><circle class="j" cx="17.1" cy="33.1" r="1.3"/><circle class="j" cx="22.9" cy="33.1" r="1.3"/><circle class="j" cx="17.1" cy="37.9" r="1.3"/><circle class="j" cx="22.9" cy="37.9" r="1.3"/></svg>',
  923: '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><circle class="j" cx="17.1" cy="7.8" r="1.3"/><circle class="j" cx="22.9" cy="7.8" r="1.3"/><circle class="j" cx="20" cy="12.3" r="1.3"/><circle class="k" cx="20" cy="19.5" r="2.1"/><circle class="j" cx="17.1" cy="25.2" r="1.3"/><circle class="j" cx="22.9" cy="25.2" r="1.3"/><circle class="k" cx="20" cy="32.7" r="2.1"/><circle class="j" cx="17.1" cy="38.4" r="1.3"/><circle class="j" cx="22.9" cy="38.4" r="1.3"/></svg>',
  '904a': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><circle class="k" cx="20" cy="10.4" r="2.1"/><circle class="k" cx="17.1" cy="19.5" r="2.1"/><circle class="k" cx="22.9" cy="19.5" r="2.1"/><circle class="j" cx="17.1" cy="27.5" r="1.3"/><circle class="j" cx="22.9" cy="27.5" r="1.3"/><circle class="j" cx="17.1" cy="33.5" r="1.3"/><circle class="j" cx="22.9" cy="33.5" r="1.3"/><circle class="j" cx="20" cy="37.7" r="1.3"/></svg>',
  '907a': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="3" y="1" width="34" height="42" rx="1.5"/><circle class="k" cx="7.4" cy="10.8" r="1.7"/><circle class="k" cx="13.7" cy="10.8" r="1.7"/><circle class="k" cx="20" cy="10.8" r="1.7"/><circle class="k" cx="26.3" cy="10.8" r="1.7"/><circle class="k" cx="32.6" cy="10.8" r="1.7"/><circle class="k" cx="7.4" cy="22.2" r="1.7"/><circle class="k" cx="13.7" cy="22.2" r="1.7"/><circle class="k" cx="20" cy="22.2" r="1.7"/><circle class="k" cx="26.3" cy="22.2" r="1.7"/><circle class="k" cx="32.6" cy="22.2" r="1.7"/><circle class="j" cx="11.5" cy="32.7" r="1.3"/><circle class="j" cx="28.5" cy="32.7" r="1.3"/></svg>',
  902: '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><rect class="k" x="18.6" y="8" width="3" height="1.8" rx="0.6"/><circle class="k" cx="19.9" cy="17.6" r="2.1"/><circle class="j" cx="16.8" cy="23.4" r="1.3"/><circle class="j" cx="16.8" cy="27.5" r="1.3"/><circle class="j" cx="22.4" cy="23.4" r="1.3"/><circle class="j" cx="22.4" cy="27.5" r="1.3"/><circle class="j" cx="16.8" cy="32.3" r="1.3"/><circle class="j" cx="22.4" cy="32.3" r="1.3"/><circle class="j" cx="19.8" cy="36.1" r="1.3"/></svg>',
  911: '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><circle class="k" cx="20.1" cy="8.7" r="2.1"/><circle class="k" cx="20.1" cy="15.7" r="2.1"/><circle class="k" cx="20.1" cy="22.7" r="2.1"/><circle class="k" cx="20.1" cy="29.7" r="2.1"/><rect class="j" x="16.2" y="34.8" width="2.6" height="2"/><circle class="j" cx="22.7" cy="35.8" r="1.3"/></svg>',
  995: '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><circle class="k" cx="19.8" cy="8.3" r="2.1"/><circle class="j" cx="16.8" cy="14" r="1.3"/><circle class="j" cx="22.9" cy="14" r="1.3"/><circle class="k" cx="19.8" cy="19.7" r="2.1"/><circle class="j" cx="16.8" cy="25.3" r="1.3"/><circle class="j" cx="22.9" cy="25.3" r="1.3"/><circle class="k" cx="19.8" cy="30.9" r="2.1"/><circle class="j" cx="16.8" cy="36.7" r="1.3"/><circle class="j" cx="22.9" cy="36.7" r="1.3"/></svg>',
  '904b': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><circle class="k" cx="20" cy="9.9" r="2.1"/><rect class="k" x="18.5" y="16.5" width="3" height="1.8" rx="0.4"/><circle class="j" cx="17.6" cy="25.9" r="1.3"/><circle class="j" cx="22.4" cy="25.9" r="1.3"/><circle class="j" cx="17.6" cy="31.6" r="1.3"/><circle class="j" cx="22.4" cy="31.6" r="1.3"/><circle class="j" cx="20" cy="35.5" r="1.3"/></svg>',
  914: '<svg viewBox="0 0 40 44" aria-hidden="true" data-fine=""><rect x="1" y="1" width="38" height="42" rx="1.5"/><circle class="k" cx="4.7" cy="10.6" r="1.8"/><circle class="k" cx="9.8" cy="10.6" r="1.8"/><circle class="k" cx="14.9" cy="10.6" r="1.8"/><circle class="k" cx="20" cy="10.6" r="1.8"/><circle class="k" cx="25.1" cy="10.6" r="1.8"/><circle class="k" cx="30.2" cy="10.6" r="1.8"/><circle class="k" cx="35.3" cy="10.6" r="1.8"/><circle class="k" cx="4.7" cy="20.2" r="1.8"/><circle class="k" cx="9.8" cy="20.2" r="1.8"/><circle class="k" cx="14.9" cy="20.2" r="1.8"/><circle class="k" cx="20" cy="20.2" r="1.8"/><circle class="k" cx="25.1" cy="20.2" r="1.8"/><circle class="k" cx="30.2" cy="20.2" r="1.8"/><circle class="k" cx="35.3" cy="20.2" r="1.8"/><circle class="j" cx="7.1" cy="31.3" r="0.7"/><circle class="j" cx="12.2" cy="31.3" r="0.7"/><circle class="j" cx="27.8" cy="31.3" r="0.7"/><circle class="j" cx="32.9" cy="31.3" r="0.7"/></svg>',
  '911a': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><circle class="k" cx="20" cy="9.2" r="2.1"/><circle class="k" cx="20" cy="16.7" r="2.1"/><rect class="k" x="17.4" y="21.9" width="1.8" height="3" rx="0.4"/><rect class="j" x="16.3" y="28.5" width="2.6" height="2"/><rect class="j" x="21.1" y="28.5" width="2.6" height="2"/><rect class="j" x="16.3" y="33.5" width="2.6" height="2"/><rect class="j" x="21.1" y="33.5" width="2.6" height="2"/></svg>',
  '903a': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><circle class="j" cx="17.6" cy="12" r="1.3"/><circle class="j" cx="22.4" cy="12" r="1.3"/><circle class="j" cx="17.6" cy="23.4" r="1.3"/><circle class="j" cx="22.4" cy="23.4" r="1.3"/></svg>',
  960: '<svg viewBox="0 0 40 44" aria-hidden="true" data-fine=""><rect x="1" y="11.6" width="38" height="20.8" rx="1.5"/><rect class="k" x="3" y="16.7" width="1.2" height="0.8" rx="0.4"/><circle class="k" cx="3.6" cy="19.4" r="0.9"/><circle class="k" cx="3.6" cy="21.7" r="0.8"/><rect class="k" x="3" y="23.3" width="1.2" height="0.8" rx="0.4"/><circle class="k" cx="7.9" cy="16.2" r="0.9"/><circle class="k" cx="7.9" cy="18.5" r="0.9"/><circle class="k" cx="7.9" cy="20.8" r="0.9"/><rect class="k" x="7.5" y="22.5" width="0.8" height="1.2" rx="0.4"/><circle class="k" cx="11.3" cy="16.2" r="0.9"/><circle class="k" cx="11.3" cy="18.5" r="0.9"/><circle class="k" cx="11.3" cy="20.8" r="0.9"/><rect class="k" x="10.9" y="22.5" width="0.8" height="1.2" rx="0.4"/><circle class="k" cx="14.6" cy="16.2" r="0.9"/><circle class="k" cx="14.6" cy="18.5" r="0.9"/><circle class="k" cx="14.6" cy="20.8" r="0.9"/><rect class="k" x="14.2" y="22.5" width="0.8" height="1.2" rx="0.4"/><circle class="k" cx="18" cy="16.2" r="0.9"/><circle class="k" cx="18" cy="18.5" r="0.9"/><circle class="k" cx="18" cy="20.8" r="0.9"/><rect class="k" x="17.6" y="22.5" width="0.8" height="1.2" rx="0.4"/><circle class="k" cx="21.3" cy="16.2" r="0.9"/><circle class="k" cx="21.3" cy="18.5" r="0.9"/><circle class="k" cx="21.3" cy="20.8" r="0.9"/><rect class="k" x="20.9" y="22.5" width="0.8" height="1.2" rx="0.4"/><circle class="k" cx="24.7" cy="16.2" r="0.9"/><circle class="k" cx="24.7" cy="18.5" r="0.9"/><circle class="k" cx="24.7" cy="20.8" r="0.9"/><rect class="k" x="24.3" y="22.5" width="0.8" height="1.2" rx="0.4"/><circle class="k" cx="28" cy="16.2" r="0.9"/><circle class="k" cx="28" cy="18.5" r="0.9"/><circle class="k" cx="28" cy="20.8" r="0.9"/><rect class="k" x="27.6" y="22.5" width="0.8" height="1.2" rx="0.4"/><circle class="k" cx="31.3" cy="16.2" r="0.9"/><circle class="k" cx="31.3" cy="18.5" r="0.9"/><circle class="k" cx="31.3" cy="20.8" r="0.9"/><rect class="k" x="30.9" y="22.5" width="0.8" height="1.2" rx="0.4"/><rect class="k" x="33.9" y="22.5" width="0.8" height="1.2" rx="0.4"/><rect class="k" x="37" y="23.2" width="1.2" height="0.8" rx="0.4"/><rect class="k" x="37" y="25.1" width="1.2" height="0.8" rx="0.4"/><rect class="k" x="37" y="27.1" width="1.2" height="0.8" rx="0.4"/><circle class="j" cx="2.1" cy="27.1" r="0.7"/><circle class="j" cx="3.6" cy="27.1" r="0.7"/><circle class="j" cx="5.2" cy="27.1" r="0.7"/><circle class="j" cx="2.6" cy="29.2" r="0.7"/><circle class="j" cx="4.7" cy="29.2" r="0.7"/><circle class="j" cx="7.9" cy="27.1" r="0.7"/><circle class="j" cx="7.9" cy="29.2" r="0.7"/><circle class="j" cx="11.3" cy="27.1" r="0.7"/><circle class="j" cx="11.3" cy="29.2" r="0.7"/><circle class="j" cx="14.6" cy="27.1" r="0.7"/><circle class="j" cx="14.6" cy="29.2" r="0.7"/><circle class="j" cx="18" cy="27.1" r="0.7"/><circle class="j" cx="18" cy="29.2" r="0.7"/><circle class="j" cx="21.3" cy="27.1" r="0.7"/><circle class="j" cx="21.3" cy="29.2" r="0.7"/><circle class="j" cx="24.7" cy="27.1" r="0.7"/><circle class="j" cx="24.7" cy="29.2" r="0.7"/><circle class="j" cx="28" cy="27.1" r="0.7"/><circle class="j" cx="28" cy="29.2" r="0.7"/><circle class="j" cx="31.3" cy="27.1" r="0.7"/><circle class="j" cx="31.3" cy="29.2" r="0.7"/><circle class="j" cx="34.3" cy="27.1" r="0.7"/><circle class="j" cx="34.3" cy="29.2" r="0.7"/><circle class="j" cx="36.5" cy="16.2" r="0.7"/><circle class="j" cx="38.1" cy="16.2" r="0.7"/><circle class="j" cx="36.5" cy="18.5" r="0.7"/><circle class="j" cx="38.1" cy="18.5" r="0.7"/><circle class="j" cx="36.5" cy="20.8" r="0.7"/><circle class="j" cx="38.1" cy="20.8" r="0.7"/><rect class="e" x="1.9" y="15.1" width="1" height="0.8"/><rect class="e" x="4.4" y="15.1" width="1" height="0.8"/><rect class="e" x="3.1" y="24.7" width="1" height="0.8"/><rect class="e" x="7.4" y="24.6" width="1" height="0.8"/><rect class="e" x="10.8" y="24.6" width="1" height="0.8"/><rect class="e" x="14.1" y="24.6" width="1" height="0.8"/><rect class="e" x="17.5" y="24.6" width="1" height="0.8"/><rect class="e" x="20.8" y="24.6" width="1" height="0.8"/><rect class="e" x="24.2" y="24.6" width="1" height="0.8"/><rect class="e" x="27.5" y="24.6" width="1" height="0.8"/><rect class="e" x="30.8" y="24.6" width="1" height="0.8"/><rect class="e" x="33.8" y="24.6" width="1" height="0.8"/><circle class="l" cx="3.6" cy="14.2" r="0.5"/><circle class="l" cx="7.9" cy="14.2" r="0.5"/><circle class="l" cx="11.3" cy="14.2" r="0.5"/><circle class="l" cx="14.6" cy="14.2" r="0.5"/><circle class="l" cx="18" cy="14.2" r="0.5"/><circle class="l" cx="21.3" cy="14.2" r="0.5"/><circle class="l" cx="24.7" cy="14.2" r="0.5"/><circle class="l" cx="28" cy="14.2" r="0.5"/><circle class="l" cx="31.3" cy="14.2" r="0.5"/><circle class="l" cx="34.3" cy="14.2" r="0.5"/></svg>',
  961: '<svg viewBox="0 0 40 44" aria-hidden="true" data-fine=""><rect x="3" y="8.5" width="34" height="27" rx="1.5"/><circle class="k" cx="11.1" cy="30.3" r="1.7"/><circle class="k" cx="19.2" cy="30.3" r="1.7"/><circle class="k" cx="28.3" cy="14" r="1.7"/><circle class="j" cx="7.4" cy="13.7" r="0.7"/><circle class="j" cx="10.3" cy="13.7" r="0.7"/><circle class="j" cx="7.4" cy="16.3" r="0.7"/><circle class="j" cx="10.3" cy="16.3" r="0.7"/><circle class="j" cx="7.4" cy="18.9" r="0.7"/><circle class="j" cx="10.3" cy="18.9" r="0.7"/><circle class="j" cx="7.4" cy="21.5" r="0.7"/><circle class="j" cx="10.3" cy="21.5" r="0.7"/><circle class="j" cx="7.4" cy="24.1" r="0.7"/><circle class="j" cx="10.3" cy="24.1" r="0.7"/><circle class="j" cx="7.4" cy="26.7" r="0.7"/><circle class="j" cx="10.3" cy="26.7" r="0.7"/><rect class="j" x="6.7" y="29.4" width="1.4" height="1.1"/><circle class="j" cx="15.6" cy="13.7" r="0.7"/><circle class="j" cx="18.5" cy="13.7" r="0.7"/><circle class="j" cx="15.6" cy="16.3" r="0.7"/><circle class="j" cx="18.5" cy="16.3" r="0.7"/><circle class="j" cx="15.6" cy="18.9" r="0.7"/><circle class="j" cx="18.5" cy="18.9" r="0.7"/><circle class="j" cx="15.6" cy="21.5" r="0.7"/><circle class="j" cx="18.5" cy="21.5" r="0.7"/><circle class="j" cx="15.6" cy="24.1" r="0.7"/><circle class="j" cx="18.5" cy="24.1" r="0.7"/><circle class="j" cx="15.6" cy="26.7" r="0.7"/><circle class="j" cx="18.5" cy="26.7" r="0.7"/><rect class="j" x="14.9" y="29.4" width="1.4" height="1.1"/><circle class="j" cx="23.7" cy="14" r="0.7"/><circle class="j" cx="32.9" cy="13.3" r="0.7"/><circle class="j" cx="32.9" cy="16.5" r="0.7"/><rect class="j" x="23" y="20.8" width="1.4" height="1.1"/><circle class="j" cx="28.3" cy="21.3" r="0.7"/><rect class="j" x="23" y="24.9" width="1.4" height="1.1"/><circle class="j" cx="28.3" cy="25.5" r="0.7"/></svg>',
  962: '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><circle class="j" cx="16.8" cy="7.6" r="1.3"/><circle class="j" cx="23.2" cy="7.6" r="1.3"/><circle class="j" cx="23.2" cy="10.8" r="1.3"/><circle class="j" cx="16.8" cy="15.1" r="1.3"/><circle class="j" cx="23.2" cy="15.1" r="1.3"/><circle class="j" cx="23.2" cy="18.3" r="1.3"/><circle class="j" cx="16.8" cy="22.5" r="1.3"/><circle class="j" cx="23.2" cy="22.5" r="1.3"/><circle class="j" cx="23.2" cy="25.7" r="1.3"/><circle class="j" cx="17.6" cy="31.6" r="1.3"/><circle class="j" cx="22.4" cy="31.6" r="1.3"/><circle class="j" cx="20" cy="35.9" r="1.3"/><rect class="e" x="19.1" y="10.2" width="1.9" height="1.2"/><rect class="e" x="19.1" y="17.6" width="1.9" height="1.2"/><rect class="e" x="19.1" y="25.1" width="1.9" height="1.2"/><circle class="l" cx="20" cy="7.6" r="0.8"/><circle class="l" cx="20" cy="15.1" r="0.8"/><circle class="l" cx="20" cy="22.5" r="0.8"/></svg>',
  'clk': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="10" y="8.5" width="20" height="27" rx="1.5"/><circle class="k" cx="15.4" cy="17.2" r="1.7"/><circle class="k" cx="24.6" cy="17.2" r="1.7"/><rect class="k" x="13.9" y="22.8" width="3" height="1.8" rx="0.4"/><circle class="j" cx="14.3" cy="28.6" r="1.3"/><circle class="j" cx="20" cy="28.6" r="1.3"/><circle class="j" cx="25.7" cy="28.6" r="1.3"/><circle class="l" cx="24.6" cy="23.7" r="0.8"/></svg>',
  'cp2': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="3" y="8.5" width="34" height="27" rx="1.5"/><circle class="k" cx="9.6" cy="15.8" r="1.9"/><circle class="k" cx="20" cy="15.8" r="1.9"/><circle class="j" cx="7.1" cy="23" r="1.3"/><circle class="j" cx="12.1" cy="23" r="1.3"/><circle class="j" cx="17.5" cy="23" r="1.3"/><circle class="j" cx="22.5" cy="23" r="1.3"/><circle class="j" cx="27.9" cy="14.4" r="1.3"/><circle class="j" cx="32.6" cy="14.4" r="1.3"/><circle class="j" cx="27.9" cy="18.5" r="1.3"/><circle class="j" cx="32.6" cy="18.5" r="1.3"/><circle class="j" cx="27.9" cy="25.1" r="1.3"/><rect class="j" x="31.3" y="24.1" width="2.6" height="2"/></svg>',
  'cp3a': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="1" y="8.5" width="38" height="27" rx="1.5"/><circle class="k" cx="4.7" cy="19.6" r="1.5"/><circle class="k" cx="8.8" cy="19.6" r="1.5"/><circle class="k" cx="12.9" cy="19.6" r="1.5"/><circle class="k" cx="16.9" cy="19.6" r="1.5"/><circle class="k" cx="6.8" cy="26.5" r="1.7"/><rect class="k" x="21.3" y="14" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="25.7" y="14" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="21.3" y="18.5" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="25.7" y="18.5" width="2.2" height="2.2" rx="0.4"/><circle class="k" cx="22.4" cy="25.8" r="1.5"/><circle class="i" cx="31.5" cy="24.4" r="1.1"/><circle class="i" cx="35.9" cy="24.4" r="1.1"/><circle class="i" cx="31.5" cy="28.6" r="1.1"/><circle class="i" cx="35.9" cy="28.6" r="1.1"/><circle class="j" cx="4.7" cy="14.4" r="1.3"/><circle class="j" cx="8.8" cy="14.4" r="1.3"/><circle class="j" cx="12.9" cy="14.4" r="1.3"/><circle class="j" cx="16.9" cy="14.4" r="1.3"/><circle class="j" cx="12.9" cy="26.5" r="1.3"/><circle class="j" cx="16.9" cy="26.5" r="1.3"/><circle class="j" cx="26.8" cy="26.5" r="1.3"/><circle class="j" cx="31.5" cy="14.4" r="1.3"/><circle class="j" cx="35.9" cy="14.4" r="1.3"/><circle class="j" cx="31.5" cy="18.5" r="1.3"/><circle class="j" cx="35.9" cy="18.5" r="1.3"/></svg>',
  'cp4a': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="3" y="8.5" width="34" height="27" rx="1.5"/><rect class="k" x="6" y="14.3" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="9.4" y="14.3" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="12.9" y="14.3" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="16.4" y="14.3" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="22.6" y="14.3" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="26.8" y="14.3" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="31.1" y="14.3" width="2.2" height="2.2" rx="0.4"/><circle class="i" cx="9" cy="26.5" r="1.1"/><circle class="i" cx="13.6" cy="26.5" r="1.1"/><circle class="i" cx="26.4" cy="26.5" r="1.1"/><circle class="i" cx="31" cy="26.5" r="1.1"/><circle class="j" cx="17.5" cy="21" r="1.3"/><rect class="j" x="22.4" y="20" width="2.6" height="2"/></svg>',
  'cp35': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="1" y="8.5" width="38" height="27" rx="1.5"/><circle class="k" cx="11.5" cy="15.1" r="1.5"/><circle class="k" cx="15.9" cy="15.1" r="1.5"/><circle class="k" cx="20.3" cy="15.1" r="1.5"/><circle class="k" cx="24.8" cy="15.1" r="1.5"/><circle class="i" cx="30.5" cy="25.5" r="1.1"/><circle class="i" cx="34.9" cy="25.5" r="1.1"/><circle class="i" cx="30.5" cy="29.6" r="1.1"/><circle class="i" cx="34.9" cy="29.6" r="1.1"/><circle class="j" cx="5.1" cy="15.4" r="1.3"/><circle class="j" cx="5.1" cy="20.6" r="1.3"/><circle class="j" cx="11.5" cy="21" r="1.3"/><circle class="j" cx="11.5" cy="25.5" r="1.3"/><circle class="j" cx="15.9" cy="21" r="1.3"/><circle class="j" cx="15.9" cy="25.5" r="1.3"/><circle class="j" cx="20.3" cy="21" r="1.3"/><circle class="j" cx="20.3" cy="25.5" r="1.3"/><circle class="j" cx="24.8" cy="21" r="1.3"/><circle class="j" cx="24.8" cy="25.5" r="1.3"/><circle class="j" cx="30.5" cy="15.1" r="1.3"/><circle class="j" cx="34.9" cy="15.1" r="1.3"/><circle class="j" cx="30.5" cy="19.6" r="1.3"/><circle class="j" cx="34.9" cy="19.6" r="1.3"/></svg>',
  'cp8a': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="10" y="8.5" width="20" height="27" rx="1.5"/><rect class="i" x="14.5" y="18.3" width="2.4" height="1.8" rx="0.4"/><rect class="i" x="23.1" y="18.3" width="2.4" height="1.8" rx="0.4"/></svg>',
  992: '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><rect class="k" x="21" y="7" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="21" y="10.6" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="21" y="14.1" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="21" y="17.7" width="2.2" height="2.2" rx="0.4"/><circle class="k" cx="20" cy="25.6" r="2.1"/><circle class="j" cx="20" cy="34.1" r="1.3"/></svg>',
  993: '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><rect class="k" x="16.5" y="7.4" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="21.3" y="7.4" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="16.5" y="15.2" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="21.3" y="15.2" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="16.5" y="20.5" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="21.3" y="20.5" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="16.5" y="25.9" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="21.3" y="25.9" width="2.2" height="2.2" rx="0.4"/></svg>',
  994: '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><circle class="j" cx="17.6" cy="8.8" r="1.3"/><circle class="j" cx="22.4" cy="8.8" r="1.3"/><circle class="j" cx="17.6" cy="13.8" r="1.3"/><circle class="j" cx="22.4" cy="13.8" r="1.3"/><circle class="j" cx="17.6" cy="25.2" r="1.3"/><circle class="j" cx="22.4" cy="25.2" r="1.3"/><circle class="j" cx="17.6" cy="30.2" r="1.3"/><circle class="j" cx="22.4" cy="30.2" r="1.3"/></svg>',
  901: '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="3" y="1" width="34" height="42" rx="1.5"/><circle class="k" cx="9.3" cy="10.6" r="2.1"/><rect class="k" x="15.4" y="9.7" width="3" height="1.8" rx="0.6"/><circle class="k" cx="24.4" cy="10.6" r="2.1"/><circle class="k" cx="32" cy="10.6" r="2.1"/><circle class="k" cx="9.3" cy="20" r="1.8"/><circle class="k" cx="16.9" cy="20" r="1.8"/><circle class="k" cx="24.4" cy="20" r="1.8"/><circle class="k" cx="32" cy="20" r="1.8"/><circle class="j" cx="9.3" cy="25.7" r="1.3"/><circle class="j" cx="16.9" cy="25.7" r="1.3"/><circle class="j" cx="24.4" cy="25.7" r="1.3"/><circle class="j" cx="32" cy="25.7" r="1.3"/><circle class="j" cx="9.3" cy="30.7" r="1.3"/><circle class="j" cx="16.9" cy="30.7" r="1.3"/><circle class="j" cx="24.4" cy="30.7" r="1.3"/><circle class="j" cx="32" cy="30.7" r="1.3"/><circle class="j" cx="14.1" cy="37.7" r="1.3"/><circle class="j" cx="20" cy="37.7" r="1.3"/><circle class="j" cx="25.9" cy="37.7" r="1.3"/></svg>',
  '901a': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><circle class="k" cx="20" cy="9.3" r="2.1"/><circle class="k" cx="20" cy="17.8" r="2.1"/><circle class="k" cx="20" cy="26.3" r="2.1"/><circle class="j" cx="17.1" cy="34" r="1.3"/><circle class="j" cx="22.9" cy="34" r="1.3"/><circle class="j" cx="20" cy="38.8" r="1.3"/></svg>',
  '901b': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><rect class="k" x="18.5" y="8.6" width="3" height="1.8" rx="0.6"/><circle class="k" cx="20" cy="16.5" r="2.1"/><circle class="j" cx="16.5" cy="24.6" r="1.3"/><circle class="k" cx="20" cy="24.6" r="1.4"/><circle class="j" cx="23.5" cy="24.6" r="1.3"/><circle class="j" cx="16.5" cy="28.8" r="1.3"/><circle class="k" cx="20" cy="28.8" r="1.4"/><circle class="j" cx="23.5" cy="28.8" r="1.3"/><circle class="j" cx="16.5" cy="33" r="1.3"/><circle class="k" cx="20" cy="33" r="1.4"/><circle class="j" cx="23.5" cy="33" r="1.3"/><circle class="j" cx="16.5" cy="37.2" r="1.3"/><circle class="k" cx="20" cy="37.2" r="1.4"/><circle class="j" cx="23.5" cy="37.2" r="1.3"/></svg>',
  '901c': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><circle class="j" cx="20" cy="10" r="1.3"/><circle class="k" cx="20" cy="21" r="2.6"/><circle class="j" cx="17.1" cy="32.5" r="1.3"/><circle class="j" cx="22.9" cy="32.5" r="1.3"/></svg>',
  '904c': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="10" y="1" width="20" height="42" rx="1.5"/><rect class="k" x="16.3" y="7.6" width="3" height="1.8" rx="0.6"/><circle class="k" cx="15.6" cy="18.5" r="2.6"/><circle class="k" cx="24.8" cy="18.5" r="2.2"/><circle class="j" cx="13.2" cy="28.5" r="1.3"/><circle class="j" cx="18" cy="28.5" r="1.3"/><circle class="j" cx="24.8" cy="28.5" r="1.3"/><circle class="j" cx="14.1" cy="37.5" r="1.3"/><circle class="j" cx="26" cy="37.5" r="1.3"/></svg>',
  905: '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="10" y="1" width="20" height="42" rx="1.5"/><circle class="k" cx="20" cy="14" r="2.9"/><circle class="j" cx="15" cy="36" r="1.3"/><circle class="j" cx="25" cy="36" r="1.3"/></svg>',
  912: '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><circle class="j" cx="17.1" cy="9.5" r="1.3"/><circle class="j" cx="22.9" cy="9.5" r="1.3"/><rect class="k" x="16.9" y="17.1" width="3" height="1.8" rx="0.6"/><circle class="k" cx="20" cy="26.5" r="2.1"/><circle class="j" cx="17.1" cy="36" r="1.3"/><rect class="j" x="21.6" y="35" width="2.6" height="2"/></svg>',
  984: '<svg viewBox="0 0 40 44" aria-hidden="true" data-fine=""><rect x="1" y="1" width="38" height="42" rx="1.5"/><circle class="j" cx="5.2" cy="10.4" r="1.3"/><circle class="k" cx="11.2" cy="10.4" r="1.6"/><circle class="k" cx="16.8" cy="10.4" r="1.6"/><circle class="k" cx="22.5" cy="10.4" r="1.6"/><circle class="k" cx="28.1" cy="10.4" r="1.6"/><circle class="j" cx="5.2" cy="15.3" r="1.3"/><circle class="k" cx="11.2" cy="15.3" r="1.6"/><circle class="k" cx="16.8" cy="15.3" r="1.6"/><circle class="k" cx="22.5" cy="15.3" r="1.6"/><circle class="k" cx="28.1" cy="15.3" r="1.6"/><circle class="j" cx="5.2" cy="20.2" r="1.3"/><circle class="k" cx="11.2" cy="20.2" r="1.6"/><circle class="k" cx="16.8" cy="20.2" r="1.6"/><circle class="k" cx="22.5" cy="20.2" r="1.6"/><circle class="k" cx="28.1" cy="20.2" r="1.6"/><circle class="j" cx="5.2" cy="25.1" r="1.3"/><circle class="k" cx="11.2" cy="25.1" r="1.6"/><circle class="k" cx="16.8" cy="25.1" r="1.6"/><circle class="k" cx="22.5" cy="25.1" r="1.6"/><circle class="k" cx="28.1" cy="25.1" r="1.6"/><circle class="k" cx="35.1" cy="17.3" r="1.8"/><circle class="k" cx="35.1" cy="29" r="1.8"/><circle class="k" cx="11.2" cy="32.8" r="1.8"/><circle class="k" cx="16.8" cy="32.8" r="1.8"/><circle class="k" cx="22.5" cy="32.8" r="1.8"/><circle class="k" cx="28.1" cy="32.8" r="1.8"/><circle class="j" cx="11.2" cy="38" r="1.3"/><circle class="j" cx="16.8" cy="38" r="1.3"/><circle class="j" cx="22.5" cy="38" r="1.3"/><circle class="j" cx="28.1" cy="38" r="1.3"/></svg>',
  991: '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/><circle class="k" cx="20" cy="9.3" r="2.1"/><circle class="k" cx="20" cy="18.3" r="2.1"/><circle class="k" cx="20" cy="27.3" r="2.1"/><circle class="j" cx="17.1" cy="35.5" r="1.3"/><circle class="j" cx="22.9" cy="35.5" r="1.3"/></svg>',
  'cp3': '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="1" y="8.5" width="38" height="27" rx="1.5"/><circle class="k" cx="4.7" cy="19.6" r="1.5"/><circle class="k" cx="8.8" cy="19.6" r="1.5"/><circle class="k" cx="12.9" cy="19.6" r="1.5"/><circle class="k" cx="16.9" cy="19.6" r="1.5"/><circle class="k" cx="6.8" cy="26.5" r="1.7"/><rect class="k" x="21.3" y="14" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="25.7" y="14" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="21.3" y="18.5" width="2.2" height="2.2" rx="0.4"/><rect class="k" x="25.7" y="18.5" width="2.2" height="2.2" rx="0.4"/><circle class="k" cx="22.4" cy="25.8" r="1.5"/><circle class="i" cx="31.5" cy="24.4" r="1.1"/><circle class="i" cx="35.9" cy="24.4" r="1.1"/><circle class="i" cx="31.5" cy="28.6" r="1.1"/><circle class="i" cx="35.9" cy="28.6" r="1.1"/><circle class="j" cx="4.7" cy="14.4" r="1.3"/><circle class="j" cx="8.8" cy="14.4" r="1.3"/><circle class="j" cx="12.9" cy="14.4" r="1.3"/><circle class="j" cx="16.9" cy="14.4" r="1.3"/><circle class="j" cx="12.9" cy="26.5" r="1.3"/><circle class="j" cx="16.9" cy="26.5" r="1.3"/><circle class="j" cx="26.8" cy="26.5" r="1.3"/><circle class="j" cx="31.5" cy="14.4" r="1.3"/><circle class="j" cx="35.9" cy="14.4" r="1.3"/><circle class="j" cx="31.5" cy="18.5" r="1.3"/><circle class="j" cx="35.9" cy="18.5" r="1.3"/></svg>',
});
// a type without a glyph (a later module): a bare 1 MU panel
const moogGlyph = id => MOOG_GLYPH[id] || '<svg viewBox="0 0 40 44" aria-hidden="true"><rect x="14" y="1" width="12" height="42" rx="1.5"/></svg>';
/** (8, IMPL-8 §1.2) The Controllers view's tiles (id = the module kind the host adds). The host passes them as o.ctls. */
export const CTL_TILES = Object.freeze([{ id: 'pads', name: 'Pads' }].map(Object.freeze));
// an original monochrome glyph (stroked with currentColor): a 3 × 3 of rounded squares, one lit
const CTL_GLYPH = {
  pads: '<svg viewBox="0 0 40 28" aria-hidden="true"><rect x="4" y="2.5" width="9.5" height="6.5" rx="1.8"/><rect x="15.25" y="2.5" width="9.5" height="6.5" rx="1.8"/><rect x="26.5" y="2.5" width="9.5" height="6.5" rx="1.8"/><rect x="4" y="10.75" width="9.5" height="6.5" rx="1.8"/><rect x="15.25" y="10.75" width="9.5" height="6.5" rx="1.8" fill="currentColor"/><rect x="26.5" y="10.75" width="9.5" height="6.5" rx="1.8"/><rect x="4" y="19" width="9.5" height="6.5" rx="1.8"/><rect x="15.25" y="19" width="9.5" height="6.5" rx="1.8"/><rect x="26.5" y="19" width="9.5" height="6.5" rx="1.8"/></svg>',
};
const ctlGlyph = id => CTL_GLYPH[id] || CTL_GLYPH.pads;
/** (WC, IMPL-WC §7; milestone 3's Serum parts and note tools before it) The rig's module tiles: id = the module kind (rig-core
 * MODULES; sx-edges firstFree's part kind), name = its label there, group 'rigmods' | 'rignotes' (the rig view's two sections), cut =
 * the cut that ships its face (1 = WC-1, 2 = WC-2). A tile is live while its cut ≤ RIG_CUT; a group with no live tile is a placeholder
 * (its heading and note). The host passes them as o.parts (or o.parts: true). */
export const RIG_CUT = 1;
export const RIG_TILES = Object.freeze(['osc', 'sub', 'noise', 'filter', 'env', 'lfo', 'macros', 'arp', 'clip'].map(id => Object.freeze({
  id, name: MODULES[id].label, group: id === 'arp' || id === 'clip' ? 'rignotes' : 'rigmods', cut: MODULES[id].cut })));
/** (WC) A module tile's reason when the track's rig has no room for one more (setPartPlaced; the host decides when): "This <NAME>
 * already has 3 oscillators" (the counts are MODULES' max), "<label> is on the canvas" for a one-off, "<label> is on" for a note tool
 * (its cord is its power); null for an unknown kind. */
const FULL_OF = { osc: 'oscillators', filter: 'filters', env: 'envelopes', lfo: 'LFOs' };
export function rigFull(kind) {
  const M = Object.prototype.hasOwnProperty.call(MODULES, kind) ? MODULES[kind] : null;
  if (!M) return null;
  if (FULL_OF[kind]) return `This ${RIG.NAME} already has ${M.max} ${FULL_OF[kind]}`;
  return M.label + (kind === 'arp' || kind === 'clip' ? ' is on' : ' is on the canvas');
}
// original monochrome glyphs: a wave in a frame, a low sine, a scatter, a low-pass slope, (WC) an ADSR trace and an LFO's shape — each with
// the editor's square handles at its points (so neither reads as the Modulators' ENV / LFO beside them) —, four dials, rising steps, a clip of notes
const PART_GLYPH = {
  osc: '<svg viewBox="0 0 40 28" aria-hidden="true"><rect x="4.5" y="3.5" width="31" height="21" rx="3"/><path d="M8 14c3-7 6-7 8 0s5 7 8 0 5-7 8 0"/></svg>',
  sub: '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M4 14c6-11 10-11 16 0s10 11 16 0"/><path d="M4 24.5h32"/></svg>',
  noise: '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M4 15l3-6 2 11 3-14 2 12 3-8 2 9 3-12 2 13 3-9 2 7 3-10 2 6 2-2"/></svg>',
  filter: '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M4 9h17c4 0 5-3 7-3 2 0 3 6 8 18"/><path d="M4 24.5h32"/></svg>',
  env: '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M4 24.5h32"/><path d="M6 24 12 5l6 9.5h10L34 24"/><rect x="10.5" y="3.5" width="3" height="3"/><rect x="16.5" y="13" width="3" height="3"/><rect x="26.5" y="13" width="3" height="3"/></svg>',
  lfo: '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M5 21C9 21 9 6 14 6s7 15 12 15 5-8 9-8"/><rect x="12.5" y="4.5" width="3" height="3"/><rect x="24.5" y="19.5" width="3" height="3"/><rect x="33.5" y="11.5" width="3" height="3"/></svg>',
  macros: '<svg viewBox="0 0 40 28" aria-hidden="true"><rect x="5" y="4" width="13" height="9" rx="2"/><rect x="22" y="4" width="13" height="9" rx="2"/><rect x="5" y="16" width="13" height="9" rx="2"/><rect x="22" y="16" width="13" height="9" rx="2"/></svg>',
  arp: '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M5 23h6v-5h6v-5h6v-5h6v-5h6"/><circle cx="8" cy="23" r="1.6"/><circle cx="14" cy="18" r="1.6"/><circle cx="20" cy="13" r="1.6"/><circle cx="26" cy="8" r="1.6"/></svg>',
  clip: '<svg viewBox="0 0 40 28" aria-hidden="true"><rect x="4.5" y="3.5" width="31" height="21" rx="2"/><path d="M9 9h7M19 14h9M12 19h6M24 9h6"/></svg>',
};
const partGlyph = id => PART_GLYPH[id] || PART_GLYPH.osc;
// (WC) the rig tile's words: what the tile gives (RIG.STARTER: a starter rig that plays; null: an Amplifier alone), no maker
const RIG_META = 'modular synth', RIG_GIVES = () => (RIG.STARTER ? 'a small starter rig that plays' : 'an Amplifier to add modules to');
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
  // (9b, IMPL-9b §4.3) the set tiles: one button.cv-tile.cv-stile[data-set] per o.sets item (its art cv-art setArt, the name, "N
  // modules", span.cv-treason) right after the patch model's tile (o.setsEl: in that box instead), shown where a view's section
  // says `sets`. A tap: o.setPick(id, mode); a drag through o.setDrag with info.set = true, info.over 'canvas' | 'tracks' | null,
  // info.at the world point (the ghost hidden over the canvas while o.setCanvasGhost() says the world draws the rack's outline);
  // setSetPlaced(id, reason) greys one (setFull's reason: the patch cannot hold the set) — then it neither picks nor drags;
  // (review 2 N3) o.setCost(id) → its load label in span.cv-tcost (the Model 15 tile's "~2 %"; refreshMoog() re-reads it)
  const stiles = new Map(), splaced = new Map();
  const ST = Array.isArray(o.sets) ? o.sets : o.sets === true ? SET_TILES : null;
  const atW = i => { if (o.toWorld) { try { const p = o.toWorld(i.x, i.y); if (p && isFinite(p.x) && isFinite(p.y)) return { x: p.x, y: p.y }; } catch { /* no world */ } } return { x: i.x, y: i.y }; };
  function setTiles(box) {
    const pick = o.setPick || null, drag = o.setDrag || {};
    for (const S of ST || []) {
      const id = S && typeof S.id === 'string' ? S.id : null;
      if (!id || stiles.has(id)) continue;
      const name = String(S.name || id), n = S.modules | 0, meta = n > 0 ? n + ' modules' : '', b = mk(d, 'button', 'cv-tile cv-stile');
      b.type = 'button';
      b.setAttribute('data-set', id);
      const aria = name + (meta ? ' · ' + meta : ''), tip = `${aria} — the whole set, patched${S.starter ? ' as ' + S.starter : ''} (our model of its circuits) — tap to use it, or drag it onto the canvas or the track list`;
      b.title = tip; b.setAttribute('aria-label', aria);
      const pic = mk(d, 'span', 'cv-tart');
      pic.setAttribute('aria-hidden', 'true');
      pic.innerHTML = cvArt.setArt(id, cvArt.TILE);
      const cs = mk(d, 'span', 'cv-tcost'), rs = mk(d, 'span', 'cv-treason');
      cs.hidden = true; rs.hidden = true;
      b.append(pic, mk(d, 'span', 'cv-tname', name), mk(d, 'span', 'cv-tmeta', meta), cs, rs);
      const off = () => splaced.has(id);
      offs.push(listen(b, 'click', e => { if ((e && e.defaultPrevented) || off() || !pick) return; pick(id, mode); }));
      const dd = { begin: (x, i) => { i.set = true; if (drag.begin) drag.begin(x, i); }, move: (x, i) => { i.set = true; if (drag.move) drag.move(x, i); },
        drop: (x, i) => { i.set = true; return !!drag.drop && drag.drop(x, i); }, cancel: (x, i) => { i.set = true; if (drag.cancel) drag.cancel(x, i); } };
      offs.push(tileDrag(d, Object.assign({}, o, { drag: dd, canvasGhost: o.setCanvasGhost }), b, id, { pic: () => cvArt.setArt(id, cvArt.TILE), off,
        norm: r => { const v = r && typeof r === 'object' ? r.over : r; return { over: v === 'canvas' || v === 'tracks' ? v : null, key: null, near: null }; }, at: atW,
        label: over => (over === 'canvas' ? '+ ' + name : over === 'tracks' ? '+ New track' : '') }));
      box.appendChild(b);
      stiles.set(id, { b, rs, cs, tip, aria, name });
      offs.push(() => b.remove());
    }
  }
  for (const m of o.models) {
    const meta = cvArt.tileMeta(m.id);
    const b = mk(d, 'button', 'cv-tile');
    b.type = 'button';
    b.setAttribute('data-model', m.id);
    const dr = DRUMS(m), pa = PATCH(m), rg = isRigModel(m); // ((7a) a drum machine: no maker name on its tile, D4; (7c) the 909 says what is ours: its hi-hats and cymbals; (9) nor a patch set's; (WC) the rig is ours: no maker)
    b.title = dr ? `${meta.label} (${meta.year}) — ${DR_TIP[m.id] || 'our model of its circuits, not recordings'} — tap to use it, or drag it onto the canvas or the track list`
      : pa ? `${meta.label} (${meta.year}) — the whole set of modules, patched with cords and ready to play (our model of its circuits) — tap to use it, or drag it onto the canvas or the track list`
      : rg ? `${meta.label} (${meta.year}) — our modular synth: modules patched with cords, ${RIG_GIVES()} — tap to use it, or drag it onto the canvas or the track list`
      : `${meta.label} (${meta.year} · ${meta.maker}) — tap to use it, or drag it onto the canvas or the track list`;
    const pic = mk(d, 'span', 'cv-tart');
    pic.setAttribute('aria-hidden', 'true');
    pic.innerHTML = cvArt.art(m.id, cvArt.TILE);
    const nm = mk(d, 'span', 'cv-tname', meta.label), mt = mk(d, 'span', 'cv-tmeta', dr ? `${meta.year} · ${DR_META[m.id] || 'drum machine'}` : pa ? `${meta.year} · modular system` : rg ? `${meta.year} · ${RIG_META}` : `${meta.year} · ${meta.maker}`);
    b.append(pic, nm, mt);
    if (CLASSIC(m)) { const bd = mk(d, 'span', 'cv-tbadge', 'SIMPLE'); bd.setAttribute('aria-hidden', 'true'); b.append(bd); } // (shown in Simple: CSS)
    offs.push(listen(b, 'click', e => { if (e && e.defaultPrevented) return; o.pick(m.id, mode); }));
    offs.push(tileDrag(d, o, b, m.id, { pic: () => cvArt.art(m.id, cvArt.TILE), label: over => labelOf(m.id, over) }));
    el.appendChild(b);
    tiles.set(m.id, b);
    if (pa && ST && !o.setsEl) setTiles(el); // ((9b) the set tiles: beside the Model 15 tile)
  }
  if (ST) setTiles(o.setsEl || el); // ((9b) in their own box, or after the synths when no patch model is listed)
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
  // (8) the Controllers section: a tile row of its own (a Modulators-style one: not the Serum parts' tiles), one tile per o.ctls item
  const ctiles = new Map();
  let chead = null;
  if (Array.isArray(o.ctls) && o.ctls.length) {
    const box = o.ctlsEl || el;
    if (!o.ctlsEl) { const hd = mk(d, 'h3', 'cv-tgrp cv-chead', 'Controllers'); el.appendChild(hd); chead = hd; offs.push(() => hd.remove()); }
    const pick = o.ctlPick || o.modPick || o.pick, drag = o.ctlDrag || o.modDrag || o.drag || {};
    const at = i => { if (o.toWorld) { try { const p = o.toWorld(i.x, i.y); if (p && isFinite(p.x) && isFinite(p.y)) return { x: p.x, y: p.y }; } catch { /* no world */ } } return { x: i.x, y: i.y }; };
    for (const m of o.ctls) {
      const id = m && typeof m.id === 'string' ? m.id : null;
      if (!id || ctiles.has(id)) continue;
      const name = String(m.name || id), b = mk(d, 'button', 'cv-tile cv-mtile');
      b.type = 'button';
      b.setAttribute('data-ctl', id);
      const tip = `${name} — tap to add a ${name} module (it plays any track), or drag it onto the canvas`;
      b.title = tip;
      const pic = mk(d, 'span', 'cv-mglyph');
      pic.setAttribute('aria-hidden', 'true');
      pic.innerHTML = ctlGlyph(id);
      const nm = mk(d, 'span', 'cv-tname', name), rs = mk(d, 'span', 'cv-treason');
      rs.hidden = true;
      b.append(pic, nm, rs);
      const off = () => placed.has(id);
      offs.push(listen(b, 'click', e => { if ((e && e.defaultPrevented) || off()) return; pick(id, mode); }));
      const dd = { begin: (x, i) => { i.ctl = true; if (drag.begin) drag.begin(x, i); }, move: (x, i) => { i.ctl = true; if (drag.move) drag.move(x, i); },
        drop: (x, i) => { i.ctl = true; return !!drag.drop && drag.drop(x, i); }, cancel: (x, i) => { i.ctl = true; if (drag.cancel) drag.cancel(x, i); } };
      offs.push(tileDrag(d, Object.assign({}, o, { drag: dd, canvasGhost: o.ctlCanvasGhost || o.modCanvasGhost }), b, id, { pic: () => ctlGlyph(id), picCls: 'cv-mglyph', cls: 'cv-mghost', off,
        norm: r => ({ over: (r && typeof r === 'object' ? r.over : r) === 'canvas' ? 'canvas' : null, key: null, near: null }), at,
        label: over => (over === 'canvas' ? '+ Add ' + name : '') }));
      box.appendChild(b);
      ctiles.set(id, { b, rs, tip, name, multi: false });
      offs.push(() => b.remove());
    }
  }
  // (9, IMPL-9 §4.6) the Moog modules row: one button.cv-tile.cv-gtile[data-moog][data-group] per o.moog item (an original glyph,
  // the name, its load on this device, span.cv-treason) under its group's heading — in o.moogEl (its section o.moogSec), else a
  // section of its own in o.secEl, else after the synths in el. A tap: (o.moogPick || o.pick)(id, mode); a drag through
  // (o.moogDrag || o.drag) with info.moog = true, info.over 'canvas' | 'tracks' | null, info.at the world point; the ghost hides over
  // the canvas while o.moogCanvasGhost() says the world draws the outline. o.moogCost(id) → its label (refreshMoog() re-reads);
  // setPlaced(id, reason) / setMoogPlaced(reason) grey tiles (a full patch: "A patch holds at most 512 modules")
  const gtiles = new Map(), gheads = [];
  let gsec = null, ginEl = false;
  const GT = Array.isArray(o.moog) ? o.moog : o.moog === true ? MOOG_TILES : null;
  if (GT && GT.length) {
    let box;
    if (o.moogEl) { box = o.moogEl; gsec = o.moogSec || null; }
    else if (o.secEl) {
      const sec = gsec = mk(d, 'section', 'cv-tsec cv-gsec');
      sec.setAttribute('data-sec', 'moog'); sec.setAttribute('aria-label', 'Moog modules');
      box = mk(d, 'div', 'cv-tiles cv-gtiles');
      sec.append(box);
      o.secEl.appendChild(sec);
      offs.push(() => sec.remove());
    } else { box = el; ginEl = true; }
    const pick = o.moogPick || o.pick, drag = o.moogDrag || o.drag || {};
    const at = i => { if (o.toWorld) { try { const p = o.toWorld(i.x, i.y); if (p && isFinite(p.x) && isFinite(p.y)) return { x: p.x, y: p.y }; } catch { /* no world */ } } return { x: i.x, y: i.y }; };
    let grp = null;
    for (const m of GT) {
      const id = m && typeof m.id === 'string' ? m.id : null;
      if (!id || gtiles.has(id)) continue;
      const g = typeof m.group === 'string' ? m.group : '';
      if (g !== grp) { grp = g; const hd = mk(d, 'h3', 'cv-tgrp cv-ghead', MOOG_GROUPS[g] || g); box.appendChild(hd); gheads.push(hd); offs.push(() => hd.remove()); }
      const name = String(m.name || id), b = mk(d, 'button', 'cv-tile cv-gtile');
      b.type = 'button';
      b.setAttribute('data-moog', id); b.setAttribute('data-group', g);
      const tip = `${name} — tap to add it to this track's 900 Series (on another track: a 900 Series with it), or drag it onto the canvas`;
      b.title = tip;
      const pic = mk(d, 'span', 'cv-gglyph');
      pic.setAttribute('aria-hidden', 'true');
      pic.innerHTML = moogGlyph(id);
      const nm = mk(d, 'span', 'cv-tname', name), cs = mk(d, 'span', 'cv-tcost'), rs = mk(d, 'span', 'cv-treason');
      cs.hidden = true; rs.hidden = true;
      b.append(pic, nm, cs, rs);
      const off = () => placed.has(id);
      offs.push(listen(b, 'click', e => { if ((e && e.defaultPrevented) || off()) return; pick(id, mode); }));
      const dd = { begin: (x, i) => { i.moog = true; if (drag.begin) drag.begin(x, i); }, move: (x, i) => { i.moog = true; if (drag.move) drag.move(x, i); },
        drop: (x, i) => { i.moog = true; return !!drag.drop && drag.drop(x, i); }, cancel: (x, i) => { i.moog = true; if (drag.cancel) drag.cancel(x, i); } };
      offs.push(tileDrag(d, Object.assign({}, o, { drag: dd, canvasGhost: o.moogCanvasGhost }), b, id, { pic: () => moogGlyph(id), picCls: 'cv-gglyph', cls: 'cv-gghost', off,
        norm: r => { const v = r && typeof r === 'object' ? r.over : r; return { over: v === 'canvas' || v === 'tracks' ? v : null, key: null, near: null }; }, at,
        label: over => (over === 'canvas' ? '+ Add ' + name : over === 'tracks' ? '+ New track' : '') }));
      box.appendChild(b);
      gtiles.set(id, { b, rs, cs, tip, name, multi: false });
      offs.push(() => b.remove());
    }
  }
  function refreshMoog() {
    const fill = (T, f, id) => {
      let c = '';
      try { c = f ? String(f(id) || '') : ''; } catch { c = ''; }
      if (T.cs.textContent !== c) T.cs.textContent = c;
      T.cs.hidden = !c;
      T.cs.title = c ? 'Estimated DSP load on this device: ' + c : '';
    };
    for (const [id, T] of gtiles) fill(T, o.moogCost, id);
    for (const [id, T] of stiles) fill(T, o.setCost, id); // ((9b, review 2 N3) the set tiles' load, as the Model 15 tile's)
  }
  refreshMoog();
  // (milestone 3; WC, IMPL-WC §7) the rig's module tiles and note tools: a section per group — a views' section of that id ('rigmods',
  // 'rignotes'): the host's elements (o.partsEl / o.partsSec, o.notesEl / o.notesSec), else made in o.secEl / el; each heading is the
  // section's `head` (RIG.NAME's: written into the host's section here — index.html holds no name). A tile is live while its cut ≤
  // RIG_CUT; a group with no live tile is a placeholder (below)
  const ptiles = new Map(), pplaced = new Map(), pbox = new Map(); // id → {b, rs, tip, name, group}; group → {sec, box, head}
  const PT = Array.isArray(o.parts) ? o.parts : o.parts === true ? RIG_TILES : null;
  const secOf = g => { for (const V of VIEWS) for (const S of V.sections || []) if (S && S.id === g) return S; return null; };
  const headOf = g => { const S = secOf(g); return (S && S.head) || g; };
  const OWN = { rigmods: ['partsEl', 'partsSec'], rignotes: ['notesEl', 'notesSec'] }; // (the host's box and section of a group)
  const hostOf = g => (OWN[g] && o[OWN[g][0]] ? { box: o[OWN[g][0]], sec: o[OWN[g][1]] || null } : null);
  // a host's section gets the group's heading (first) and label; destroy gives the section back as it was
  const headHost = (sec, g) => {
    const h = mk(d, 'h3', 'cv-tgrp', headOf(g)), had = sec.getAttribute('aria-label');
    sec.insertBefore(h, sec.firstChild || null);
    sec.setAttribute('aria-label', headOf(g));
    offs.push(() => { h.remove(); if (had == null) sec.removeAttribute('aria-label'); else sec.setAttribute('aria-label', had); });
  };
  if (PT) {
    const pick = o.partPick || o.pick, drag = o.partDrag || o.drag || {};
    const at = i => { if (o.toWorld) { try { const p = o.toWorld(i.x, i.y); if (p && isFinite(p.x) && isFinite(p.y)) return { x: p.x, y: p.y }; } catch { /* no world */ } } return { x: i.x, y: i.y }; };
    const boxOf = g => {
      let B = pbox.get(g);
      if (B) return B;
      const H = hostOf(g);
      if (H) { B = { sec: H.sec, box: H.box, head: null }; if (H.sec) headHost(H.sec, g); }
      else if (o.secEl) {
        const sec = mk(d, 'section', 'cv-tsec cv-psec'), box = mk(d, 'div', 'cv-tiles cv-ptiles');
        sec.setAttribute('data-sec', g); sec.setAttribute('aria-label', headOf(g));
        sec.append(mk(d, 'h3', 'cv-tgrp', headOf(g)), box);
        o.secEl.appendChild(sec);
        offs.push(() => sec.remove());
        B = { sec, box, head: null };
      } else { const hd = mk(d, 'h3', 'cv-tgrp cv-phead', headOf(g)); el.appendChild(hd); offs.push(() => hd.remove()); B = { sec: null, box: el, head: hd }; }
      pbox.set(g, B);
      return B;
    };
    for (const m of PT) {
      const id = m && typeof m.id === 'string' ? m.id : null;
      if (!id || ptiles.has(id) || (m.cut | 0) > RIG_CUT) continue; // ((WC) a later cut's kind: no tile yet — its group may be a placeholder)
      const g = m.group === 'rignotes' ? 'rignotes' : 'rigmods', name = String(m.name || id), b = mk(d, 'button', 'cv-tile cv-ptile');
      b.type = 'button';
      b.setAttribute('data-part', id); b.setAttribute('data-group', g);
      const tip = `${name} — tap to add it to this track's ${RIG.NAME} (or start one with it), or drag it onto the canvas`;
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
        norm: r => { const v = r && typeof r === 'object' ? r.over : r; return { over: v === 'canvas' || v === 'tracks' ? v : null, key: null, near: null }; }, at, // ((WC, integration fixer L — review WC-int B4) the track list: a new track with it, as a Moog tile
        label: over => (over === 'canvas' ? '+ Add ' + name : over === 'tracks' ? '+ New track' : '') }));
      boxOf(g).box.appendChild(b);
      ptiles.set(id, { b, rs, tip, name, group: g });
      offs.push(() => b.remove());
    }
  }
  // the placeholder sections (a heading, a one-line note), once each, in o.secEl after the Modulators ((3) not for a group
  // the parts tiles fill; (WC) a group the host has a section for — Note tools — is that section: the heading, the note, the
  // cv-tsoon class, its empty tile box hidden; given back as it was at destroy)
  const secs = new Map();
  for (const V of VIEWS) for (const S of V.sections || []) {
    if (!S || S.models || S.id === 'mods' || !S.head || secs.has(S.id) || pbox.has(S.id)) continue;
    const H = hostOf(S.id);
    if (H && H.sec) {
      const sec = H.sec, p = mk(d, 'p', 'cv-tnote', S.note || ''), was = H.box.hidden;
      headHost(sec, S.id);
      sec.appendChild(p); sec.classList.add('cv-tsoon'); H.box.hidden = true;
      offs.push(() => { p.remove(); sec.classList.remove('cv-tsoon'); H.box.hidden = was; });
      secs.set(S.id, sec);
      continue;
    }
    if (!o.secEl) continue;
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
    const ctls = has('ctls') && ctiles.size > 0; // ((8) the Controllers row)
    if (o.ctlsSec) o.ctlsSec.hidden = !ctls;
    if (chead) { chead.hidden = !ctls; for (const T of ctiles.values()) T.b.hidden = !ctls; }
    const sets = S.some(x => x && x.sets) && stiles.size > 0; // ((9b) the set tiles: with the Model 15 tile)
    for (const T of stiles.values()) T.b.hidden = !sets;
    if (o.setsSec) o.setsSec.hidden = !sets;
    const moog = has('moog') && gtiles.size > 0; // ((9) the Moog modules row)
    if (gsec) gsec.hidden = !moog;
    if (ginEl) { for (const h of gheads) h.hidden = !moog; for (const T of gtiles.values()) T.b.hidden = !moog; }
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
    const T = mtiles.get(id) || ctiles.get(id) || gtiles.get(id); // ((8) a Controllers tile too; (9) a Moog module's)
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
    /** the view (an o.views id: 'hw' | 'flow' | 'serum' | 'rig' | 'drums' | 'ctl' | 'moog'; setView is a restore: no callback); the dropdown's close (→ was it open) */    setView, view: () => view, views: () => VIEWS.map(V => V.id), closeView: () => !!vpop && vpop.close(), viewOpen: () => !!vpop && vpop.isOpen(),
    /** the classic synths' layout: setLayout('hw' | 'flow') = that view; layout() the last one (kept through Serum) */
    setLayout: l => setView(l === 'flow' ? 'flow' : 'hw'), layout: () => lay,
    /** (2a) the Modulators section's tiles; greying one out with its reason (null: available again) */
    modTiles: () => [...mtiles.values()].map(T => T.b), modTile: id => (mtiles.get(id) || {}).b || null,
    setPlaced, placed: id => placed.get(id) || null,
    /** (8) the Controllers row's tiles (greyed through setPlaced) */
    ctlTiles: () => [...ctiles.values()].map(T => T.b), ctlTile: id => (ctiles.get(id) || {}).b || null,
    /** (9) the Moog modules row's tiles; every one greyed with a reason (null: available again); their load labels again */
    moogTiles: () => [...gtiles.values()].map(T => T.b), moogTile: id => (gtiles.get(id) || {}).b || null,
    setMoogPlaced(reason) { for (const id of gtiles.keys()) setPlaced(id, reason); }, refreshMoog,
    /** (9b) the set tiles; greying one with its reason (setFull's; null: available again) */
    setTiles: () => [...stiles.values()].map(T => T.b), setTile: id => (stiles.get(id) || {}).b || null,
    setSetPlaced(id, reason) {
      const T = stiles.get(id);
      if (!T) return;
      const r = reason == null || reason === '' ? null : String(reason);
      if (r) splaced.set(id, r); else splaced.delete(id);
      T.b.classList.toggle('cv-placed', !!r);
      if (r) T.b.setAttribute('aria-disabled', 'true'); else T.b.removeAttribute('aria-disabled');
      T.rs.textContent = r || ''; T.rs.hidden = !r;
      T.b.title = r ? T.aria + ' — ' + r : T.tip;
      T.b.setAttribute('aria-label', r ? T.aria + ' — ' + r : T.aria);
    },
    setPlacedOf: id => splaced.get(id) || null,
    /** (milestone 3; WC) the rig's module tiles (the live ones); greying one out with its reason (rigFull's; null: available again) */
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

// A tray tile's drag-out (the Sources tray's tiles): wk.dragSource {scrollAxis: 'y', autoScroll: false} — out of the
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
