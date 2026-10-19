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
// Stage 1e (IMPL-1e §4.1): several devices per track. A module key is a device id ('i1', 'i2', 'fx1', 'i2/fx' — a Serum's
// own FX —, 'out'). createModule gains power (⏻ on the bar, [data-off] dims the module), the key-zone pill (instruments:
// "keys: all" / "keys: C3–C6 · +12", a tap opens low / high / transpose) and a bar badge. createTrackView is device-driven
// when the host gives devices(track) (else exactly the stage-1b view: instrument, FX, OUT); devicesOf(track) is the default
// list, tidy() lays out any number of devices, the cables come from track.wires (cv-cables cablesOf).
// Stage 2a (IMPL-2a §3): modulator modules — kind 'mod' (the project Mod Wheel 'wheel', a track's Velocity 've',
// Aftertouch 'at', Bend 'bd'): W_MOD wide, MOD_H tall by mod kind, one right mod-out jack (patchable whatever host.patch
// says), a column left of the instruments in Tidy; mod cables end on the knobs (destPort: [data-dest] offsets cached per
// module, measured on demand after a layout change, never per frame).
import * as wk from './wk.js?v=9';
import { DOT } from './cv-world.js?v=9';
import { createCables, deriveCables, cablesOf, jackPort, createCableDrag, MOD_COLOR, MOD_PREFIX, keyKind, MACRO_PORTS } from './cv-cables.js?v=9';
export { MOD_COLOR, MOD_PREFIX, keyKind } from './cv-cables.js?v=9';

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
/** (2a) A modulator module's width and its fixed height per mod kind (world px, the bar included, on the dots); the order
 * of Tidy's modulator column (the wheel first; (2b, IMPL-2b §1.1) then the singletons, then the multi-instance kinds by
 * number). (2b) MOD_KINDS: every track-device mod kind devicesOf lists (the project wheel is the host's). */
export const W_MOD = 240;
export const MOD_H = Object.freeze({ wheel: 224, velo: 192, at: 128, bend: 128, note: 160, lfo: 256, env: 224, macro: 288, cc: 160, chaos: 224 });
export const MOD_ORDER = Object.freeze(['wheel', 'velo', 'at', 'bend', 'note', 'lfo', 'env', 'macro', 'cc', 'chaos']);
export const MOD_KINDS = Object.freeze(new Set(MOD_ORDER.filter(k => k !== 'wheel')));
/** (2b) A macro module's knob rows: MACRO_ROW world px each from MACRO_Y0 (the bar, then the body's padding; cv-mods-ui
 * macroBody and style.css .cv-mmacro agree); a jack k<n> sits at the row's middle on the right edge. */
export const MACRO_ROW = 28, MACRO_Y0 = BAR_H + 12;
/** (2b) The module-local y of jack `i` (0-based) of a module of mod kind `kind`, unfolded: a macro's knob rows, every
 * other kind the single out jack at JACK_Y. Pure. */
export function modJackY(kind, i) { return kind === 'macro' ? MACRO_Y0 + MACRO_ROW * (i | 0) + MACRO_ROW / 2 : BAR_H + JACK_Y; }
/** (2b) The jack specs of a modulator module by kind: a macro's k1…k8 (right edge, at its knob rows), else one 'out'. */
export function modJacks(kind, title) {
  const T = title || 'Modulator';
  if (kind === 'macro') return MACRO_PORTS.map((id, i) => ({ id, side: 'right', kind: 'mod', label: T + ' knob ' + (i + 1), y: modJackY(kind, i) }));
  return [{ id: 'out', side: 'right', kind: 'mod', label: T + ' out' }];
}
/** (2a U8) The gap between the modulator column and the instruments (world px): the column at x −(W_MOD + MOD_GAP) = −320,
 * so a fit with the Sources tray open on a portrait iPad keeps it beside the instrument. */
export const MOD_GAP = 80;
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
/** (1e) Tidy's vertical gap between stacked modules (instruments, panels; world px, on the dots). */
export const VGAP = 64;

const fin = x => typeof x === 'number' && isFinite(x);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const gsnap = v => Math.round(v / DOT) * DOT; // the visible grid's dots (cv-world DOT)
const gup = v => Math.ceil(v / DOT) * DOT;

/**
 * @typedef {{x: number, y: number, fold?: 1, z?: number, ui?: 'flow'}} LayEntry  world px (top-left incl. the bar; a stored w is ignored)
 * @typedef {Object<string, LayEntry>} Lay  track.lay (view only: never compiled, never in presets)
 * @typedef {{id: string, side: 'left' | 'right', kind: 'audio' | 'mod', label: string, y?: number}} Jack  (2b) y: the jack's
 *   module-local centre y unfolded (a macro's knob rows); without one JACK_Y below the bar
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
  if (!el || el.nodeType !== 1) return false;
  if (cableHit(el)) return true; // (1e, U13) an editable cable pans like the canvas around it; a tap on it selects (cv-cables)
  for (let n = el, i = 0; n && i < 3 && typeof n.getAttribute === 'function'; n = n.parentNode, i++) { // (2a U4) a mod cable's badge too
    if (/(^|\s)cv-mbadge(\s|$)/.test(n.getAttribute('class') || '')) return true;
  }
  if (typeof el.matches !== 'function' || typeof el.closest !== 'function') return false;
  try { return !!el.matches(BG_SEL) && !!el.closest('[data-cv-mod]'); } catch (err) { return false; }
}
// an editable cable's hit path (cv-cables: path.cv-cable-hit in g[data-cable], no [data-ro])
function cableHit(el) {
  try {
    const g = el.parentNode;
    return /(^|\s)cv-cable-hit(\s|$)/.test(el.getAttribute('class') || '') && !!g && typeof g.getAttribute === 'function' && g.getAttribute('data-cable') != null && !g.hasAttribute('data-ro');
  } catch (err) { return false; }
}
/** The lay key of a track's FX module: 'i1/fx' (a Serum's own FX) or 'fx1' (a classic track's panel).
 * @param {string} model @returns {string} */
export function fxKey(model) { return model === 'serum' ? ID.sxFx : ID.fx; }
/** A module's width (world px) on a track of `model` (the instrument: its Simple layout's, or a Serum's; a Hardware
 * layout's comes from its panel: cv-panel sizeOf). */
export function defaultW(key, model) {
  return key === ID.inst ? (model === 'serum' ? W_SERUM : FLOW_W[model] || W_CLASSIC) : key === ID.out ? W_OUT : W_FX;
}
/** (1e) A module's default width by kind: an instrument its model's (FLOW_W, W_SERUM), an FX module W_FX, OUT W_OUT. */
export function kindW(kind, model) { return kind === 'inst' ? defaultW(ID.inst, model) : kind === 'out' ? W_OUT : kind === 'mod' ? W_MOD : W_FX; }
/** (2a) The mod kind of a module key ('wheel' / 've' / 'at' / 'bd' → 'wheel' / 'velo' / 'at' / 'bend'; (2b) 'nt' → 'note',
 * 'l<n>' / 'e<n>' / 'm<n>' / 'c<n>' / 'h<n>' → 'lfo' / 'env' / 'macro' / 'cc' / 'chaos'; else null). mkOf: the same. */
export function modKind(key) { return keyKind(key); }
export const mkOf = modKind;
// the stage-1b Tidy (the legacy view's: instrument → FX → OUT, keyed by the stage-1b ids)
function tidy1(track, sizes) {
  const model = track && track.model, lay = {};
  let x = 0;
  for (const k of [ID.inst, fxKey(model), ID.out]) {
    const s = isObj(sizes) ? sizes[k] : null, w = s && fin(s.w) && s.w > 0 ? s.w : defaultW(k, model);
    lay[k] = { x, y: 0 };
    x = gup(x + w + GAP);
  }
  return lay;
}
const devNum = id => { const m = /(\d+)$/.exec(id); return m ? +m[1] : 0; };
const byNum = (a, b) => devNum(a) - devNum(b) || (a < b ? -1 : a > b ? 1 : 0);
/**
 * (1e) The modules of a track, in view order: instruments (the primary first, then by device number), each Serum's own FX
 * ('iN/fx'), the shared panels (by number), OUT; (2a) then the track's modulators (every MOD_KINDS kind in MOD_ORDER, by
 * number: 'velo' / 'at' / 'bend' / 'note' / 'lfo' / … → {key, kind: 'mod', mod}) — the project's Mod Wheel ({key: 'wheel', kind: 'mod', mod: 'wheel'}) is
 * the host's to add. A track without dev (v1): the stage-1b three. Pure; the default host.devices of createTrackView.
 * @param {{prim?: string, dev?: object, model?: string}} track
 * @returns {Array<{key: string, kind: 'inst' | 'fx' | 'out' | 'mod', model: string | null, dev: object | null, prim?: boolean, own?: string, mod?: string}>}
 */
export function devicesOf(track) {
  const t = isObj(track) ? track : {}, D = isObj(t.dev) ? t.dev : null;
  if (!D) return [{ key: ID.inst, kind: 'inst', model: t.model || null, dev: null, prim: true }, { key: fxKey(t.model), kind: 'fx', model: t.model === 'serum' ? 'serum' : null, dev: null }, { key: ID.out, kind: 'out', model: null, dev: null }];
  const ids = Object.keys(D).filter(k => isObj(D[k])), of = kind => ids.filter(k => D[k].kind === kind);
  const syn = of('synth').sort(byNum), pr = syn.includes(t.prim) ? t.prim : syn[0];
  if (pr) syn.splice(syn.indexOf(pr), 1), syn.unshift(pr);
  const out = syn.map(k => ({ key: k, kind: 'inst', model: D[k].model || null, dev: D[k], prim: k === pr }));
  for (const k of syn) if (D[k].model === 'serum') out.push({ key: k + '/fx', kind: 'fx', model: 'serum', dev: D[k], own: k });
  for (const k of of('panel').sort(byNum)) out.push({ key: k, kind: 'fx', model: null, dev: D[k] });
  for (const k of of('out').sort(byNum)) out.push({ key: k, kind: 'out', model: null, dev: D[k] });
  for (const m of MOD_ORDER) if (MOD_KINDS.has(m)) for (const k of of(m).filter(k => keyKind(k) === m).sort(byNum)) out.push({ key: k, kind: 'mod', model: null, dev: D[k], mod: m }); // ((2b) every kind whose id fits its prefix (§1.1), Tidy order)
  return out;
}
/**
 * Tidy: instrument → FX → OUT in columns from (0, 0), GAP apart, tops aligned. sizes: id → {w, h} (measured or default).
 * Each column starts on the grid. Positions only: widths and folds stay the caller's.
 * (1e) Any number of devices (a v2 track, or `devs` given — createTrackView's host.devices list): the instruments stacked
 * in the left column (the primary on top, VGAP apart), each Serum's own FX beside its Serum, the shared panels stacked in
 * the next column, OUT right of everything. One instrument → panel → OUT (or a Serum → its own FX → OUT) lays out exactly
 * as the stage-1b Tidy. (2a) Modulators (kind 'mod') stack in a column left of the instruments (x < 0, MOD_GAP from them), in
 * MOD_ORDER (the wheel, Velocity, Aftertouch, Bend), VGAP apart: nothing else moves for them.
 * @param {{model?: string, dev?: object}} track @param {Object<string, {w: number, h: number}>} sizes
 * @param {Array<{key: string, kind: string, model?: string, own?: string}>} [devs] @returns {Lay}
 */
export function tidy(track, sizes, devs) {
  if (!Array.isArray(devs) && !(track && isObj(track.dev))) return tidy1(track, sizes);
  const L = Array.isArray(devs) ? devs.filter(d => isObj(d) && typeof d.key === 'string') : devicesOf(track), lay = {};
  const S = k => (isObj(sizes) && isObj(sizes[k]) ? sizes[k] : null);
  const wOf = d => { const s = S(d.key); return s && fin(s.w) && s.w > 0 ? s.w : kindW(d.kind, d.model); };
  const mkOf = d => d.mod || modKind(d.key);
  const hOf = d => { const s = S(d.key); return s && fin(s.h) && s.h > 0 ? s.h : d.kind === 'inst' ? (d.model === 'serum' ? H_GUESS.serum : H_GUESS.inst) : d.kind === 'mod' ? MOD_H[mkOf(d)] || MOD_H.at : H_GUESS[d.kind] || H_GUESS.fx; };
  const ins = L.filter(d => d.kind === 'inst'), insK = new Set(ins.map(d => d.key));
  const own = new Map(), pans = [], outs = L.filter(d => d.kind === 'out');
  for (const d of L) if (d.kind === 'fx') { const o = d.own || (/^(.+)\/fx$/.exec(d.key) || [])[1]; if (o && insK.has(o) && !own.has(o)) own.set(o, d); else pans.push(d); }
  const max = (A, f) => A.reduce((m, d) => Math.max(m, f(d)), 0);
  const x1 = ins.length ? gup(max(ins, wOf) + GAP) : 0, ownW = max([...own.values()], wOf);
  let y = 0;
  for (const d of ins) {
    lay[d.key] = { x: 0, y };
    let h = hOf(d);
    const f = own.get(d.key);
    if (f) { lay[f.key] = { x: x1, y }; h = Math.max(h, hOf(f)); }
    y = gup(y + h + VGAP);
  }
  const x2 = ownW ? gup(x1 + ownW + GAP) : x1;
  y = 0;
  for (const d of pans) { lay[d.key] = { x: x2, y }; y = gup(y + hOf(d) + VGAP); }
  const x3 = pans.length ? gup(x2 + max(pans, wOf) + GAP) : x2;
  y = 0;
  for (const d of outs) { lay[d.key] = { x: x3, y }; y = gup(y + hOf(d) + VGAP); }
  const ord = d => { const i = MOD_ORDER.indexOf(mkOf(d)); return i < 0 ? MOD_ORDER.length : i; };
  const mods = L.filter(d => d.kind === 'mod').sort((a, b) => ord(a) - ord(b) || byNum(a.key, b.key));
  const x0 = -gup(max(mods, wOf) + MOD_GAP);
  y = 0;
  for (const d of mods) { lay[d.key] = { x: x0, y }; y = gup(y + hOf(d) + VGAP); }
  return lay;
}
/** (1e) A MIDI note's name in the app's naming (C4 = 60). */
export function noteName(n) { const N = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], k = Math.round(+n) || 0; return N[((k % 12) + 12) % 12] + (Math.floor(k / 12) - 1); }
/** (1e) A key zone {lo, hi, xp} (0…127, 0…127, −48…48), clamped and ordered; anything else → all keys. */
export function zoneOf(z) {
  const c = (v, a, b, d) => (fin(v) ? Math.max(a, Math.min(b, Math.round(v))) : d);
  const lo = c(z && z.lo, 0, 127, 0), hi = c(z && z.hi, 0, 127, 127);
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi), xp: c(z && z.xp, -48, 48, 0) };
}
/** (1e) The key-zone pill's text: "keys: all", "keys: C3–C6", "keys: all · +12", "keys: C3–C6 · −5". */
export function zoneLabel(z) {
  const Z = zoneOf(z), all = Z.lo === 0 && Z.hi === 127;
  return 'keys: ' + (all ? 'all' : noteName(Z.lo) + '–' + noteName(Z.hi)) + (Z.xp ? ' · ' + (Z.xp > 0 ? '+' : '−') + Math.abs(Z.xp) : '');
}
const okEntry = e => isObj(e) && fin(e.x) && fin(e.y);
/** The lay entry of `key`, falling back to the other FX key after a classic ↔ Serum model change (its place, fold and
 * z), else Tidy's. Always a copy, never with a width (a stored w is ignored: nothing is resizable).
 * (1e) keys: the track's module keys — while the other FX key is a module of its own (a Serum primary's 'i1/fx' beside a
 * shared panel 'fx1') its entry is its own, never a fallback.
 * @param {{model: string, lay?: Lay}} track @param {string} key @param {Lay} tidied @param {string[]} [keys] @returns {LayEntry} */
export function layOf(track, key, tidied, keys) {
  const L = track && isObj(track.lay) ? track.lay : null;
  if (L && okEntry(L[key])) { const e = Object.assign({}, L[key]); delete e.w; return e; }
  const ox = key === ID.fx ? ID.sxFx : key === ID.sxFx ? ID.fx : null;
  if (L && ox && !(Array.isArray(keys) && keys.includes(ox))) {
    const o = L[ox];
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
const POW_SVG = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4.4 3.6a4.6 4.6 0 1 0 5.2 0M7 1.6v5"/></svg>';
// (1e) createModule options beside ModuleOpts: power {on, onToggle(on)} — the ⏻ button; zone {lo, hi, xp, onChange({lo, hi,
// xp})} — the key-zone pill (instruments); badge — the bar badge's first text; patch — the jacks are focusable buttons
// (role=button, tabindex 0: Enter / Space → cv-cables "Connect to…")
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
  // power (1e): o.power → a ⏻ button (aria-pressed); without it the slot stays reserved and hidden (OUT, the FX panels)
  const pow = o.power ? btn('cv-pow', 'Power', POW_SVG) : mk('span', 'cv-pow');
  if (!o.power) pow.hidden = true;
  const stripe = mk('span', 'cv-stripe'); stripe.setAttribute('aria-hidden', 'true');
  const ttl = mk('span', 'cv-ttl'), tEl = mk('span', 'cv-title'), sEl = mk('span', 'cv-sub');
  ttl.append(tEl, sEl);
  const chipEl = mk('span', 'cv-chip'), cpu = mk('span', 'cv-cpu'); // CPU: per module (setCpu, the engine's stats per Inst / Chain)
  const more = btn('cv-btn cv-more', 'Module menu'); more.textContent = '⋯'; more.setAttribute('aria-haspopup', 'menu');
  const foldB = btn('cv-btn cv-fold', 'Fold', FOLD_SVG);
  bar.append(pow, stripe, ttl, chipEl, cpu, more, foldB);
  const body = mk('div', 'cv-body');
  el.append(bar, body);
  const jacks = new Map(); // jack id → {el, side, y (unfolded module-local centre: a macro's knob rows)}
  for (const j of Array.isArray(o.jacks) ? o.jacks : []) {
    const je = mk('span', 'cv-jack');
    je.setAttribute('data-cv-jack', id + '.' + j.id); je.setAttribute('data-side', j.side === 'left' ? 'left' : 'right');
    je.setAttribute('data-kind', j.kind || 'audio');
    if (j.label) { je.setAttribute('aria-label', j.label); je.title = j.label; }
    if (o.patch) { je.setAttribute('role', 'button'); je.tabIndex = 0; } // (1e) patchable: Enter / Space → "Connect to…"
    el.append(je);
    jacks.set(j.id, { el: je, side: j.side === 'left' ? 'left' : 'right', y: fin(j.y) && j.y > BAR_H ? j.y : BAR_H + JACK_Y });
  }
  // ---- geometry (folded: every jack at the bar's middle height)
  const jackY = j => (fold ? BAR_H / 2 : j ? j.y : BAR_H + JACK_Y);
  function placeJacks() {
    for (const j of jacks.values()) { const yy = jackY(j) + 'px'; if (j.el.style.top !== yy) j.el.style.top = yy; }
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
  // ---- (1e) power, the key-zone pill, the bar badge
  let pwr = !(o.power && o.power.on === false), zv = o.zone ? zoneOf(o.zone) : null, zpill = null, zpop = null, badgeEl = null;
  const setPower = on => {
    pwr = on !== false;
    if (pwr) el.removeAttribute('data-off'); else el.setAttribute('data-off', '');
    if (o.power) {
      pow.setAttribute('aria-pressed', pwr ? 'true' : 'false');
      const L = pwr ? 'Power: on — switch off' : 'Power: off — switch on';
      pow.setAttribute('aria-label', L); pow.title = L;
    }
  };
  if (o.power) pow.addEventListener('click', e => { e.stopPropagation(); setPower(!pwr); if (o.power.onToggle) o.power.onToggle(pwr); });
  const setBadge = text => { // "not connected – silent", "OS 4→2" (null: none); made on first use (no empty slot in the bar)
    const t = text == null || text === '' ? '' : String(text);
    if (!badgeEl) { if (!t) return; badgeEl = mk('span', 'cv-badge'); bar.insertBefore(badgeEl, chipEl); }
    if (badgeEl.textContent !== t) badgeEl.textContent = t;
    badgeEl.hidden = !t;
    badgeEl.title = t;
  };
  if (zv) {
    zpill = btn('cv-zone', 'Key zone');
    zpill.setAttribute('aria-haspopup', 'dialog');
    zpill.addEventListener('pointerdown', e => e.stopPropagation()); // (a control: never the world's press, never a move)
    zpill.addEventListener('click', e => { e.stopPropagation(); if (zpop) zoneClose(); else zoneOpen(); });
    el.append(zpill);
  }
  function setZone(z) {
    if (!zpill) return;
    zv = zoneOf(z);
    const L = zoneLabel(zv);
    if (zpill.textContent !== L) zpill.textContent = L;
    zpill.title = L + ' — tap to set the range and transpose';
    zpill.setAttribute('aria-label', 'Key zone: ' + L.slice(6));
    if (zv.lo === 0 && zv.hi === 127 && !zv.xp) zpill.setAttribute('data-all', ''); else zpill.removeAttribute('data-all');
    if (zpop) zpop.sync();
  }
  // the zone popover: low / high / transpose (wk numBoxes: drag, arrows, typed entry) and "All keys"; in the top layer at the
  // pill (wk.layer), closed by the pill, Escape, a press outside or a camera move (wk transient). A drag's end or a key
  // step commits (o.zone.onChange: one undo step each); the pill follows live
  function zoneOpen() {
    const lay = wk.layer(el), box = mk('div', 'cv-zpop'), r = zpill.getBoundingClientRect();
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Key zone of ' + title);
    let cur = Object.assign({}, zv);
    const commit = ph => { setZone(cur); if (ph !== 'move' && ph !== 'start' && o.zone.onChange) o.zone.onChange(Object.assign({}, zv)); };
    const note = (lab, k) => wk.numBox({ label: lab, steps: 127, get: () => cur[k] / 127, def: k === 'lo' ? 0 : 1,
      fmt: n => noteName(Math.round(n * 127)),
      parse: t => { const m = /^\s*([A-Ga-g])([#b]?)\s*(-?\d+)\s*$/.exec(t); if (!m) { const v = parseFloat(t); return isFinite(v) ? v / 127 : null; } const pc = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); return (pc + (+m[3] + 1) * 12) / 127; },
      set: (n, ph) => { const v = Math.round(n * 127); cur[k] = v; if (k === 'lo' && cur.hi < v) cur.hi = v; if (k === 'hi' && cur.lo > v) cur.lo = v; commit(ph); } });
    const lo = note('Low', 'lo'), hi = note('High', 'hi');
    const xp = wk.numBox({ label: 'Transpose', steps: 96, get: () => (cur.xp + 48) / 96, def: 0.5,
      fmt: n => { const v = Math.round(n * 96) - 48; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v); },
      parse: t => { const v = parseFloat(String(t).replace('−', '-')); return isFinite(v) ? (Math.max(-48, Math.min(48, Math.round(v))) + 48) / 96 : null; },
      set: (n, ph) => { cur.xp = Math.round(n * 96) - 48; commit(ph); } });
    const allB = mk('button', 'cv-zall', 'All keys');
    allB.type = 'button';
    allB.addEventListener('click', () => { cur = { lo: 0, hi: 127, xp: 0 }; commit('set'); sync(); });
    box.append(lo.el, hi.el, xp.el, allB);
    const sync = () => { cur = Object.assign({}, zv); lo.update(); hi.update(); xp.update(); };
    const fixed = lay !== el; // (the top layer: client px; else inside the module, below the pill)
    if (fixed) { box.style.position = 'fixed'; box.style.left = Math.round(r.left) + 'px'; box.style.top = Math.round(r.bottom + 6) + 'px'; }
    lay.append(box);
    const d = doc, onDown = e => { if (!box.contains(e.target) && !zpill.contains(e.target)) zoneClose(); };
    const onKey = e => { if (e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); zoneClose(true); } };
    d.addEventListener('pointerdown', onDown, true);
    box.addEventListener('keydown', onKey);
    const tOff = typeof wk.addTransient === 'function' ? wk.addTransient(() => zoneClose()) : () => {};
    zpop = { box, sync, off() { d.removeEventListener('pointerdown', onDown, true); box.removeEventListener('keydown', onKey); tOff(); for (const w of [lo, hi, xp]) w.destroy(); } };
    zpill.setAttribute('aria-expanded', 'true');
    try { lo.focus(); } catch (err) { /* no focus */ }
  }
  function zoneClose(focusBack) {
    if (!zpop) return false;
    const z = zpop;
    zpop = null;
    z.off(); z.box.remove();
    zpill.setAttribute('aria-expanded', 'false');
    if (focusBack) { try { zpill.focus(); } catch (err) { /* gone */ } }
    return true;
  }
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
  const ctl = t => { for (let n = t; n && n !== bar; n = n.parentNode) if (n === chipEl || n === more || n === foldB || (o.power && n === pow)) return true; return false; };
  for (const c of o.power ? [pow, chipEl, more, foldB] : [chipEl, more, foldB]) c.addEventListener('pointerdown', e => e.stopPropagation()); // controls never start a move
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
  if (o.power) setPower(pwr);
  if (zv) setZone(zv);
  if (o.badge) setBadge(o.badge);
  mount();
  const M = {
    id, el, bar, body, cost: fin(o.cost) ? o.cost : 600, kind,
    rect: () => ({ x: lx, y: ly, w, h: fold ? BAR_H : measure() }),
    onScreen,
    setPos, setW, setFold, setZ, setTitle, setChip, setFixed,
    /** (1d) the module's DSP load on its top bar: a fraction of the audio deadline (the engine's stats.per), null = none */
    setCpu(load) {
      const t = fin(load) && load >= 0 ? (load >= 0.1 ? Math.round(load * 100) : load >= 0.001 ? (load * 100).toFixed(1) : '<0.1') + '%' : '';
      if (cpu.textContent !== t) { cpu.textContent = t; cpu.title = t ? 'DSP load of this module: ' + t + ' of the audio deadline' : ''; }
    },
    /** module-local offset of a jack (pure geometry: w and fold) */
    port(jackId) { const j = jacks.get(jackId), o = fold ? JACK_OUT : 0; return j ? { x: j.side === 'left' ? (o ? -o : 0) : w + o, y: jackY(j) } : { x: w / 2, y: BAR_H / 2 }; },
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
    /** (1e) the jack ids of the module, in order */
    jackIds: () => [...jacks.keys()],
    openMenu,
    /** (1e) power: [data-off] dims the module (and the ⏻ button's aria-pressed when it has one) — the host's state, no callback */
    setPower, get on() { return pwr; },
    /** (1e) the key-zone pill's {lo, hi, xp} (an instrument made with o.zone); no callback */
    setZone, get zone() { return zv ? Object.assign({}, zv) : null; }, zoneOpen: () => { if (zpill && !zpop) zoneOpen(); }, zoneClose,
    /** (1e, U3) how far the pill reaches left of the module (world px: its width and the 10 px gap; 0 without one) — a
     * camera that frames the module keeps it clear of the rail (one layout read) */
    get zoneW() { return zpill ? (+zpill.offsetWidth || 72) + 10 : 0; },
    /** (1e) the bar badge: text or null */
    setBadge, get badge() { return badgeEl && !badgeEl.hidden ? badgeEl.textContent : null; },
    destroy() {
      if (dead) return;
      zoneClose();
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
 * (1e) Device-driven when host.devices(track) is given (IMPL-1e §4.1): its list [{key, kind: 'inst' | 'fx' | 'out', model,
 * dev}] (devicesOf(track) is the default one) makes one module per key — a module key is the device id ('i1', 'fx1',
 * 'i2/fx', 'out') — and sync diffs by key (a kind change rebuilds that one). Then, per key:
 *   host.bodies.mount(key, bodyEl) / host.bodies.unmount(key, bodyEl)   the module's body (mounted for its life)
 *   host.title(key) → {title, sub, chip}   host.menu(key) → items   host.size(key) → {fixed: {w, h?}} | null
 *   host.power(key, on)?  → instruments get the ⏻ button (dev.on !== false shows on)
 *   host.zone(key, {lo, hi, xp})?  → instruments get the key-zone pill (dev.zone)
 *   host.badge(key) → text | null   the bar badge ("not connected – silent", "OS 4→2"), read on every sync / refresh
 *   host.cables: {onSelect(id | null), onAction(id, 'disconnect' | …), menu(id) → items}   the editable cables (cablesOf)
 *   host.patch: false   (1f) read-only cables: every cable and jack data-ro (no press, focus or "Connect to…"; cableDrag
 *        still works when a caller makes one — main.js does not since stage 1f)
 * Instruments' jacks are focusable buttons; the jacks inside a Serum (its out → its own FX's in) carry data-ro.
 * (2a) Modulator devices ({key, kind: 'mod', mod: 'wheel' | 'velo' | 'at' | 'bend'}): W_MOD × MOD_H[mod] (host.size may
 * say otherwise), one right jack {id: 'out', kind: 'mod'} that is always patchable (host.patch: false keeps the audio
 * cables read-only only), colour dev.color else MOD_COLOR[mod], cost 40. Mod cables (cablesOf with {project:
 * host.project(), presetRows: host.presetRows} when the host gives either; track.mods rows always) stay editable and
 * end on their knobs: V.destPort(dev, param) (host.destPort first when given) from [data-dest] offsets cached per module
 * — dropped on a fold, a size change, sync / refresh and V.remeasure(key?) (a Serum page switch) — added to ports()
 * under the cable's b ('<dev>:<param>'). host.cables.onHint(text): the 24+ hint; V.setModsVisible(mode).
 * Tidy (no lay entry) places any number of devices (tidy(track, sizes, devices)). Same geometry on every device.
 * @param {object|null} world  cv-world World (null: modules still lay out in host.root at k = 1)
 * @param {{id: string, model: string, name: string, color: string, lay?: Lay}} track
 * @param {object} host
 * @returns {{trackId: string, model: string, modules: Map<string, Module>, sync: (track: object) => void,
 *   ports: () => Map<string, {x: number, y: number}>, live: (key: string) => boolean, destroy: () => void}}
 */
export function createTrackView(world, track, host) {
  const H = host || {}, doc = H.doc || globalThis.document, root = H.root || (world && world.el) || null;
  const DEV = typeof H.devices === 'function', RO = H.patch === false;
  let T = track;
  const mods = new Map(); // key → Module
  const CB = DEV && isObj(H.cables) ? H.cables : {};
  const cables = createCables(root, { doc, onSelect: CB.onSelect, onAction: CB.onAction, menu: CB.menu, onHint: CB.onHint, ignore: CB.ignore, mods: H.mods,
    k: () => (world && world.k > 0 ? world.k : 1) });
  let DL = [], DM = new Map(); // (1e) the host's devices, by key
  const readDevs = () => {
    if (!DEV) return;
    let L = null;
    try { L = H.devices(T); } catch (err) { console.error(err); L = null; }
    const seen = new Set();
    DL = (Array.isArray(L) ? L : []).filter(d => isObj(d) && typeof d.key === 'string' && /^(inst|fx|out|mod)$/.test(d.kind) && !seen.has(d.key) && seen.add(d.key));
    DM = new Map(DL.map(d => [d.key, d]));
  };
  readDevs();
  const tModel = () => { try { return T.model; } catch (err) { return null; } }; // (a v2 track's accessor throws without an instrument)
  const keys = () => (DEV ? DL.map(d => d.key) : [ID.inst, fxKey(T.model), ID.out]);
  const kindOf = key => (DEV ? (DM.get(key) || { kind: 'fx' }).kind : key === ID.inst ? 'inst' : key === ID.out ? 'out' : 'fx');
  const modelOf = key => (DEV ? (DM.get(key) || {}).model || null : kindOf(key) === 'inst' ? T.model : null);
  const devOf = key => (DEV ? (DM.get(key) || {}).dev || null : null);
  const mkOf = key => (DEV ? (DM.get(key) || {}).mod || modKind(key) : null); // (2a) a modulator's mod kind
  const call = (f, ...a) => { try { return typeof f === 'function' ? f(...a) : undefined; } catch (err) { console.error(err); return undefined; } };
  // the instrument's fixed size from the host: {fixed: {w, h}} (a Hardware layout) or {fixed: {w}} (the height measured);
  // (1e) any module's, by key; an instrument's default its model's width
  const sizeOf = key => {
    const kind = kindOf(key);
    let s = null;
    try { s = H.size ? (DEV ? H.size(key) : kind === 'inst' ? H.size('inst') : null) : null; } catch (err) { s = null; }
    if (isObj(s) && isObj(s.fixed) && fin(s.fixed.w) && s.fixed.w > 0) return s;
    if (kind === 'mod') return { fixed: { w: W_MOD, h: MOD_H[mkOf(key)] || MOD_H.at } };
    return kind === 'inst' ? { fixed: { w: DEV ? kindW('inst', modelOf(key)) : defaultW(ID.inst, T.model) } } : null;
  };
  const sizes = () => { const o = {}; for (const [k, m] of mods) { const r = m.rect(); o[k] = { w: r.w, h: r.h }; } return o; };
  // Tidy's widths (no layout read); (1e) a known fixed height too, so stacked modules never move as heights are measured
  const tidied = () => {
    const o = {};
    for (const [k, m] of mods) { o[k] = { w: m.w }; if (DEV && m.fixed && m.fixed.h) o[k].h = m.fixed.h; }
    return DEV ? tidy(T, o, DL) : tidy1(T, o);
  };
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
    for (const [k, m] of mods) for (const j of m.jackIds()) { const o = m.port(j); p.set(k + '.' + j, { x: m.x + o.x, y: m.y + o.y }); } // ((2b) every jack: a macro's k1…k8)
    for (const c of cables.list()) { // (2a) a mod cable's knob end (cached offsets: no layout read once measured)
      if (c.kind !== 'mod' || p.has(c.b)) continue;
      const i = c.b.indexOf(':'), q = i > 0 ? destPort(c.b.slice(0, i), c.b.slice(i + 1)) : null;
      if (q) p.set(c.b, q);
    }
    return p;
  }
  /* ---- (2a) knob end points: per module, the [data-dest] elements by '<dev>:<param>' (one walk) and their module-local
   * centres (one rect read each, on first use); dropped by fold / size / sync / refresh / remeasure */
  // (U1) a Serum keeps its hidden pages in the DOM: a key can have several elements (one shown, the rest 0 × 0), so every
  // one is indexed and the first with a box wins; an end parked on the bar because none was shown is tried again on the
  // next lookup outside a live move (no rect read per frame of a drag)
  const DC = new Map(); // module key → { idx: Map(dk → [el]), pos: Map(dk → {x, y, hid?}) }
  let quiet = false; // (a module's live move: cached ends only)
  function indexOf(k, m) {
    let c = DC.get(k);
    if (c) return c;
    const idx = new Map(), st = [[m.el, k.split('/')[0]]];
    while (st.length) {
      const [n, dv0] = st.pop();
      for (const e of n.children || []) {
        if (!e || typeof e.getAttribute !== 'function') continue;
        const dv = e.getAttribute('data-dev') || dv0, id = e.getAttribute('data-dest');
        if (id) { const q = dv + ':' + id, L = idx.get(q); if (L) L.push(e); else idx.set(q, [e]); }
        st.push([e, dv]);
      }
    }
    c = { idx, pos: new Map() };
    DC.set(k, c);
    return c;
  }
  const rectOf = e => { try { return e.getBoundingClientRect(); } catch (err) { return null; } };
  const shown = r => !!r && (r.width > 0 || r.height > 0);
  const barPt = () => ({ x: 0, y: BAR_H / 2 }); // (folded, or the knob not shown: the module's left edge at its bar)
  function localDest(k, m, dk) { // the knob's centre in module px; null: not in this module
    let c = indexOf(k, m), L = c.idx.get(dk);
    if (L && L.some(e => e.isConnected === false)) { DC.delete(k); c = indexOf(k, m); L = c.idx.get(dk); } // (the body re-rendered)
    if (!L) return null;
    if (m.fold) return barPt();
    const q = c.pos.get(dk);
    if (q && (!q.hid || quiet)) return q;
    let r = null;
    for (const e of L) { const x = rectOf(e); if (shown(x)) { r = x; break; } }
    const R = rectOf(m.el), s = R && R.width > 0 && m.w > 0 ? R.width / m.w : 1;
    const p = r && R ? { x: Math.round((r.left + r.width / 2 - R.left) / s * 100) / 100, y: Math.round((r.top + r.height / 2 - R.top) / s * 100) / 100 } : Object.assign(barPt(), { hid: true });
    c.pos.set(dk, p);
    return p;
  }
  function destPort(dev, pid) {
    if (typeof H.destPort === 'function') { const q = call(H.destPort, dev, pid); if (q && fin(q.x) && fin(q.y)) return { x: q.x, y: q.y }; }
    const dk = dev + ':' + pid, cand = [...mods.keys()].filter(k => k === dev || k.startsWith(dev + '/'));
    for (const k of cand) { const m = mods.get(k), q = localDest(k, m, dk); if (q) return { x: m.x + q.x, y: m.y + q.y }; }
    const own = /^fx\./.test(pid) && mods.get(dev + '/fx'), m = own || mods.get(dev); // (a knob not on the panel: the module's bar)
    return m ? { x: m.x, y: m.y + BAR_H / 2 } : null;
  }
  function relay() { lastPorts = ports(); cables.layout(lastPorts); }
  const meta = key => { try { return (H.title && H.title(DEV ? key : kindOf(key))) || {}; } catch (err) { return {}; } };
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
  const costOf = key => { const kind = kindOf(key); return kind === 'inst' ? ((DEV ? modelOf(key) : T.model) === 'serum' ? 3700 : 600) : kind === 'fx' ? 900 : 40; };
  const colorOf = key => { const d = devOf(key); return (d && typeof d.color === 'string' && d.color) || (kindOf(key) === 'mod' && MOD_COLOR[mkOf(key)]) || T.color; };
  // (1e) the per-device state a sync / refresh brings: power, zone, badge, the inner Serum jacks, cost, colour
  function decorate(key, m) {
    if (!DEV) return;
    const d = devOf(key), kind = kindOf(key);
    if (kind === 'inst') { m.setPower(!(d && d.on === false)); if (m.zone) m.setZone(d && d.zone); }
    m.setBadge(typeof H.badge === 'function' ? call(H.badge, key) || null : null);
    // a jack inside a Serum is its own route (data-ro): no press, no focus, no "Connect to…" (U12) — the patchable ones buttons
    for (const j of m.jackIds()) {
      const e = m.jack(j);
      if (kind === 'mod' || (!RO && jackPort(T, key + '.' + j))) { e.removeAttribute('data-ro'); e.setAttribute('role', 'button'); e.tabIndex = 0; } // ((2a) a mod-out: always)
      else { e.setAttribute('data-ro', ''); e.removeAttribute('role'); e.tabIndex = -1; }
    }
    m.cost = costOf(key);
    const c = colorOf(key);
    if (c) m.el.style.setProperty('--mc', c);
  }
  function make(key) {
    const kind = kindOf(key), M0 = meta(key), L = layOf(T, key, tidied(), keys()), SZ = kind === 'inst' || DEV ? sizeOf(key) : null, d = devOf(key);
    const jk = kind === 'inst' ? [{ id: 'out', side: 'right', kind: 'audio', label: (M0.title || 'Instrument') + ' out' }]
      : kind === 'fx' ? [{ id: 'in', side: 'left', kind: 'audio', label: (M0.title || 'FX') + ' in' }, { id: 'out', side: 'right', kind: 'audio', label: (M0.title || 'FX') + ' out' }]
        : kind === 'mod' ? modJacks(mkOf(key), M0.title) // ((2b) a macro: k1…k8 at its knob rows)
          : [{ id: 'in', side: 'left', kind: 'audio', label: 'OUT in' }];
    const ext = {};
    if (DEV) {
      ext.patch = !RO;
      if (kind === 'inst' && typeof H.power === 'function') ext.power = { on: !(d && d.on === false), onToggle: on => H.power(key, on) };
      if (kind === 'inst' && typeof H.zone === 'function') ext.zone = Object.assign(zoneOf(d && d.zone), { onChange: z => H.zone(key, z) });
    }
    const m = createModule(Object.assign({
      id: key, kind, title: M0.title || '', sub: M0.sub, chip: M0.chip, color: colorOf(key),
      x: L.x, y: L.y, w: DEV ? kindW(kind, modelOf(key)) : defaultW(key, T.model), fold: !!L.fold, z: fin(L.z) ? L.z : 1, fixed: SZ ? SZ.fixed : null,
      cost: costOf(key),
      jacks: jk,
      body: DEV ? { mount: b => { if (H.bodies && H.bodies.mount) H.bodies.mount(key, b); }, unmount: b => { if (H.bodies && H.bodies.unmount) H.bodies.unmount(key, b); } }
        : H.bodies && H.bodies[kind] ? H.bodies[kind] : null,
      menu: () => (H.menu ? (DEV ? H.menu(key) : H.menu(kind, key)) : []),
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
        quiet = phase === 'start' || phase === 'move';
        try { relay(); } finally { quiet = false; }
        if (phase === 'end' || phase === 'cancel') { update(key); if (G2) { for (const g of G2.list) update(g.k); grp = null; } }
      },
      onFold: f => { DC.delete(key); lay(key, 'start', 'fold'); lay(key, 'end', 'fold'); relay(); update(key); if (H.shown) H.shown(key); },
      onScreen: () => { if (H.shown) H.shown(key); },
      onSize: () => { DC.delete(key); relay(); update(key); },
    }, ext), { world, doc });
    m.zSet = fin(L.z);
    decorate(key, m);
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
  // (2a) the mod context: the project (its wheel) and the preset rows, when the host gives them; read-only (1f) keeps the
  // mod cables editable
  const cOpts = () => (typeof H.project === 'function' || H.presetRows ? { project: call(H.project), presetRows: H.presetRows } : undefined);
  const cablesNow = () => (!DEV ? deriveCables(T) : RO ? cablesOf(T, cOpts()).map(c => (c.kind === 'mod' ? c : Object.assign({}, c, { readonly: true }))) : cablesOf(T, cOpts()));
  for (const k of keys()) make(k);
  cables.set(cablesNow());
  relay();
  // cables touching the selection are raised, the others dimmed (§2.9); kept by module id, so a re-derived cable list
  // (a model change, a Serum route edit) is highlighted again
  let selOff = null, selId = null;
  const touches = (c, k) => c.a.startsWith(k + '.') || c.b.startsWith(k + '.')
    || (c.kind === 'mod' && (c.b.startsWith(k + ':') || (/\/fx$/.test(k) && c.b.startsWith(k.slice(0, -3) + ':fx.')))); // ((2a) a knob of the module)
  const hl = () => cables.highlight(selId && mods.has(selId) ? cables.list().filter(c => touches(c, selId)).map(c => c.id) : null);
  if (world && typeof world.on === 'function') selOff = world.on('select', d => { selId = (d && d.id) || null; hl(); if (selId) cables.select(null); });
  // (2a) a zoom's end: the mod cables' ends are END_PX screen px again
  const zoomOff = world && typeof world.on === 'function' ? world.on('cameraend', () => cables.rezoom()) : null;
  const drags = []; // (1e) the cable drags made through V.cableDrag
  const removeMod = k => { const m = mods.get(k); if (world && typeof world.remove === 'function') world.remove(k); m.destroy(); mods.delete(k); };
  const V = {
    trackId: T.id, model: tModel(), modules: mods, cables,
    /** applies lay / title / model changes without remounting bodies (an FX key swap moves the FX body to the new module);
     * (1e) device-driven: modules come and go with host.devices(track) (diffed by key) */
    sync(track) {
      T = track || T;
      readDevs();
      DC.clear();
      V.trackId = T.id; V.model = tModel();
      const want = keys();
      for (const k of [...mods.keys()]) if (!want.includes(k) || (DEV && mods.get(k).kind !== kindOf(k))) removeMod(k);
      let vis = false; // a fold changed (an undo / redo restore): host.shown once, after every module is in its state
      for (const k of want) { // (instrument first: Tidy places the others from its new width — a model change on an untouched track)
        let m = mods.get(k);
        if (!m) { make(k); continue; }
        const kind = kindOf(k), M0 = meta(k), SZ = kind === 'inst' || DEV ? sizeOf(k) : null;
        if (SZ || (DEV && m.fixed)) m.setFixed(SZ ? SZ.fixed : null); // (the size follows the model and the layout toggle, even mid-drag; before Tidy reads the widths)
        if (DEV && !SZ) m.setW(kindW(kind, modelOf(k)));
        const L = layOf(T, k, tidied(), want);
        if (!m.dragging()) {
          m.setPos(L.x, L.y, false);
          if (m.fold !== !!L.fold) { m.setFold(!!L.fold); vis = true; }
        }
        m.zSet = fin(L.z);
        m.setZ(fin(L.z) ? L.z : 1);
        m.setTitle(M0.title || '', M0.sub);
        if (M0.chip !== undefined) m.setChip(M0.chip);
        if (DEV) decorate(k, m); else if (T.color) m.el.style.setProperty('--mc', T.color);
        update(k);
      }
      cables.set(cablesNow());
      hl();
      relay();
      if (vis && H.shown) H.shown(); // (main.js: monitors.sync — the Serum / FX live displays follow an undone fold)
    },
    /** (addition) titles, chips and the derived cables after an edit (no lay, no world update); (1e) power, zone, badge */
    refresh(track) {
      if (track) T = track;
      readDevs();
      DC.clear();
      for (const [k, m] of mods) { const M0 = meta(k); m.setTitle(M0.title || '', M0.sub); if (M0.chip !== undefined) m.setChip(M0.chip); decorate(k, m); }
      cables.set(cablesNow());
      hl();
      relay();
    },
    ports,
    /** the module `key` is on screen (the world's plan, CULL_MARGIN early) and not folded: its live displays run */
    live(key) { const m = mods.get(key); return !!m && m.screen && !m.fold; },
    /** user actions from the module menus (each one undo step, except front) */
    toggleFold(key) { const m = mods.get(key); if (!m) return; m.setFold(!m.fold); DC.delete(key); lay(key, 'start', 'fold'); lay(key, 'end', 'fold'); relay(); update(key); if (H.shown) H.shown(key); },
    front,
    sizes,
    /** (1e) the host's devices as shown; the jacks [{id, el, dir, mod, label}]; module rects (world px); a jack's model port */
    devices: () => DL.map(d => Object.assign({}, d)),
    jacks() {
      const L = [];
      for (const [k, m] of mods) for (const j of m.jackIds()) { const el = m.jack(j); L.push({ id: k + '.' + j, el, dir: j === 'in' ? 'in' : 'out', mod: k, label: el.getAttribute('aria-label') || k + '.' + j, kind: el.getAttribute('data-kind') || 'audio' }); }
      return L;
    },
    /** (2a) a knob's end point (world px) — host.destPort first, else the [data-dest] centre (cached per module; a folded
     * module, or a knob not shown: its bar's left end); null without the module */
    destPort,
    /** (2a) drop the cached knob offsets of `key` (all without): a body re-rendered or switched page; the cables re-laid */
    remeasure(key) { if (key == null) DC.clear(); else DC.delete(key); relay(); },
    /** (2a) the mod cables' visibility ('always' | 'select' | 'never': the toolbar ∿) */
    setModsVisible: m => cables.setModsVisible(m),
    rects() { const o = {}; for (const [k, m] of mods) o[k] = m.rect(); return o; },
    port: j => jackPort(T, j),
    /** (1e) cv-cables createCableDrag on this view (ports, jacks, rects, port, the cables) — o: canConnect, onConnect,
     * onRepatch, onDisconnect?, onRefuse?; destroyed with the view (or earlier by the caller) */
    cableDrag(o) {
      const D = createCableDrag(world, Object.assign({ ports, jacks: () => V.jacks(), rects: () => V.rects(), port: j => jackPort(T, j), cables, color: () => T.color, doc }, o || {}));
      drags.push(D);
      return D;
    },
    destroy() {
      for (const D of drags.splice(0)) D.destroy();
      if (selOff) selOff();
      if (zoomOff) zoomOff();
      for (const [k, m] of mods) { if (world && typeof world.remove === 'function') world.remove(k); m.destroy(); }
      mods.clear();
      cables.destroy();
    },
  };
  return V;
}
