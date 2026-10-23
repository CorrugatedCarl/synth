// pads-core.js — the pad controller's pure model (IMPL-8 §1.3, §2.2, §3, §5.2, §6.4, §8, §10.1; lane K). Leaf ES module: imports
// only drum-core (song.js imports it as it imports drum-core); no DOM / timers / storage; node-tested (tests/pads-core.test.mjs).
//
// project.pads (§10.1), normalised by normPads (exact lengths, every field bounded, ids unique in pd1…pd64, a hardware binding unique
// across the project — later duplicates dropped —, unknown fields dropped; idempotent, never throws; anything else → []):
//   [≤ 64 × { id 'pd1'…'pd64', name ≤ 24, rows 1–8, cols 1–8, size 0 S | 1 M | 2 L, vel 'pos' | 'fixed', fv 1–127,
//            light 'hit' | 'follow' | 'both', shape 'sq' | 'hex', out: { prof 'off' | 'gen', port ≤ 64 }, pads: [64 × pad | null] }]
//   pad (§3.1): { c 0–15, l ≤ 12, t: [≤ 4 × target], mod: null | { m 'gate' | 'vel' | 'press' | 'tog', lo 0–1, hi 0–1 },
//                 v null | 1–127, latch 0 | 1, hw: null | { port ≤ 64, ch 1–16, n 0–127, cc 0 | 1 } }
//   target: { k 'note', tr, n } | { k 'chord', tr, root, q, inv 0–3, oct −2…2, spread 'close' | 'open' } | { k 'notes', tr, ns [≤ 8] }
//           | { k 'drum', tr, s }   (tr: song.js validId — a missing track is kept: Undo may bring it back; s /^[a-z]{2}$/)
// The 8 × 8 space: slot i = r · 8 + c, r counted from the BOTTOM row (§1.3); a smaller grid hides slots, never deletes them;
// shown number r · cols + c + 1 (pad 1 bottom-left, left → right, then up).
//
// Geometry (§1.3, world px): gridOf / footprint / padAt / padRect; the bed's hit test padHit(G, M) (cv-keys bed o.hit).
// Velocity (§2.2): padVel (= cv-drum padVel: the 1i curve), hitVel (a pad's fixed v wins for every source).
// Targets (§3.2–§3.3): chordNotes, targetNotes, resolve(pad, project, drumOf) → { hits: [{ tr, ns, at }], warn }; labels (a drum
// pad's: the sound's SHORT name — "Tom 1", no parenthetical —; soundName keeps the full one for warnings and the roll), padSourceName
// (a mod pad's one name everywhere: "Pads 1 · Kick").
// Defaults (§3.5): defaultsFor(track, D, order, cols, look) (the machines' pad orders passed in: cv-drum UI[m].pads, top row first;
// look { c: { sound: colour } } a machine's own pad colours), fill(M, how), newModule. Modulation (§5.2): modValue, modBright.
// Colours (§6.4): COLORS, colorFor, nearestColor. Hardware (§8): bindOf, rebind, echo('gen', pad, state).
import { PERS, normDrum } from './drum-core.js?v=9';

/* ---------------------------------------------------------------- bounds and tables */
// IMPL-P §3.1: 64 Pads modules a project (was 8) — a safety bound, not a product cap; PAD_ID below is pd1…pd<MAX_MODS>
export const MAX_MODS = 64, MAX_T = 4, MAX_NS = 8, N_SLOTS = 64, MAX_NAME = 24, MAX_LABEL = 12, MAX_PORT = 64;
/** §1.3: pad sizes S / M / L, the gap, the body's padding, the footer, the module bar (= cv-module BAR_H) — world px. */
export const PAD_PX = Object.freeze([56, 72, 96]), GAP = 8, PADDING = 16, FOOTER = 32, BAR_H = 40;
/** §3.2: chord qualities → semitones from the root (the third, or its stand-in, second). */
const frozen = o => { for (const k of Object.keys(o)) Object.freeze(o[k]); return Object.freeze(o); };
export const QUALITIES = frozen({ maj: [0, 4, 7], min: [0, 3, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
  dim: [0, 3, 6], dim7: [0, 3, 6, 9], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9],
  add9: [0, 4, 7, 14], 5: [0, 7] });
export const Q_ORDER = Object.freeze(['maj', 'min', '7', 'maj7', 'm7', 'dim', 'dim7', 'aug', 'sus2', 'sus4', '6', 'm6', 'add9', '5']);
const Q_SUFFIX = { maj: '', min: 'm', 7: '7', maj7: 'maj7', m7: 'm7', dim: 'dim', dim7: 'dim7', aug: 'aug', sus2: 'sus2', sus4: 'sus4',
  6: '6', m6: 'm6', add9: 'add9', 5: '5' };
/** Fill from… (§3.5): the scales from a root. */
export const SCALES = frozen({ chrom: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10],
  penta: [0, 2, 4, 7, 9] });
export const MOD_MODES = Object.freeze(['gate', 'vel', 'press', 'tog']);
/** §3.5: a synth's chromatic run from C3. A keyboard press (Space / Enter): 100 / 127 (= cv-drum KEY_PAD_V). */
export const CHROM_FROM = 48, KEY_PAD_V = 100 / 127;
/** §2.2: the 1i velocity curve (= cv-keys KEY_VEL lo / span; a test compares). */
const VEL_LO = 0.3, VEL_SPAN = 0.75;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const fin = x => typeof x === 'number' && isFinite(x);
const clamp = (x, lo, hi) => (x > lo ? (x < hi ? x : hi) : lo) + 0;   // (NaN → lo; + 0: no −0 saved)
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const intIn = (x, d, lo, hi) => (fin(x) ? clamp(Math.round(x), lo, hi) : d);
const oneOf = (x, list, d) => (list.includes(x) ? x : d);
const strIn = (x, max) => (typeof x === 'string' ? x.slice(0, max) : '');
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** song.js's track id rule (validId). */
export const validId = id => typeof id === 'string' && id !== '__proto__' && /^[\w.:-]{1,64}$/.test(id);
const SND = /^[a-z]{2}$/;
const PAD_NO = '(?:[1-9]|[1-5]\\d|6[0-4])';                       // 1…64 (= MAX_MODS; tests/pads-core.test.mjs holds them equal)
export const PAD_ID = new RegExp('^pd' + PAD_NO + '$');
const PAD_SRC = new RegExp('^(pd' + PAD_NO + ')\\.p(\\d{1,2})$');
/** 'C3' style (C4 = 60, = cv-keys noteName). */
export const noteName = n => NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

/* ---------------------------------------------------------------- colours (§6.4) */
/** The pad well the colours sit on (dark in both themes, the hardware look) [C]; idle = the colour at 22 % over it (§6.1). */
export const WELL = '#1d1d21', IDLE_A = 0.22;
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgbHex = a => '#' + a.map(x => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0')).join('');
const mix = (h, a) => { const c = hexRgb(h), w = hexRgb(WELL); return rgbHex(c.map((x, i) => w[i] + (x - w[i]) * a)); };
/** 16 swatches of our own: { id, name, lit, idle } (lit ≥ 3:1 on the well — a test). */
export const COLORS = Object.freeze([['red', '#ff4b4b'], ['orange', '#ff8a2a'], ['amber', '#ffb31f'], ['yellow', '#f2df3a'], ['lime', '#a6e22e'],
  ['green', '#3ed16f'], ['teal', '#22c7a9'], ['cyan', '#2ed3f0'], ['sky', '#4fb0ff'], ['blue', '#4a7dff'], ['indigo', '#7a6bff'],
  ['violet', '#a65cff'], ['magenta', '#e84de0'], ['pink', '#ff6fa8'], ['white', '#f2f2f2'], ['grey', '#9a9aa2']]
  .map(([id, lit]) => Object.freeze({ id, name: id[0].toUpperCase() + id.slice(1), lit, idle: mix(lit, IDLE_A) })));
export const C_RED = 0, C_ORANGE = 1, C_AMBER = 2, C_GREEN = 5, C_TEAL = 6, C_CYAN = 7, C_VIOLET = 11, C_MAGENTA = 12, C_GREY = 15;
const TOMS = new Set(['lt', 'mt', 'ht']), METAL = new Set(['cy', 'oh', 'ch', 'rd', 'cr']);
/** A target's default colour (§6.4): kick red, snare orange, toms amber, hats / cymbals cyan, other percussion green, notes
 * violet, chords magenta (a custom list too); none: mod (teal) or grey. */
export function colorFor(x, mod) {
  if (isObj(x)) {
    if (x.k === 'drum') return x.s === 'bd' ? C_RED : x.s === 'sd' ? C_ORANGE : TOMS.has(x.s) ? C_AMBER : METAL.has(x.s) ? C_CYAN : C_GREEN;
    if (x.k === 'note') return C_VIOLET;
    if (x.k === 'chord' || x.k === 'notes') return C_MAGENTA;
  }
  return mod ? C_TEAL : C_GREY;
}

/** The palette entry nearest (in RGB) to a '#rrggbb' colour — a machine's own pad colour (the SDS-V's kit) as a pad colour,
 * as the hardware light-back's "nearest palette entry" (§8.4); the grey for anything that is no such colour. */
export function nearestColor(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return C_GREY;
  const c = hexRgb(hex.toLowerCase());
  let best = C_GREY, bd = Infinity;
  COLORS.forEach((k, i) => { const p = hexRgb(k.lit), d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}

/* ---------------------------------------------------------------- the 8 × 8 space, numbering */
export const slotOf = (r, c) => r * 8 + c;
export const rcOf = i => ({ r: i >> 3, c: i & 7 });
/** Is slot i inside the module's grid (rows × cols from the bottom-left)? */
export const visible = (M, i) => Number.isInteger(i) && i >= 0 && i < N_SLOTS && (i >> 3) < M.rows && (i & 7) < M.cols;
/** The shown number of slot i (1 bottom-left; 0: hidden). */
export const padNo = (M, i) => (visible(M, i) ? (i >> 3) * M.cols + (i & 7) + 1 : 0);
/** The slot of shown number k (−1: none). */
export function slotOfNo(M, k) {
  if (!Number.isInteger(k) || k < 1 || k > M.rows * M.cols) return -1;
  return slotOf(Math.floor((k - 1) / M.cols), (k - 1) % M.cols);
}
/** The visible slots in numbering order. */
export function visibleSlots(M) { const out = []; for (let r = 0; r < M.rows; r++) for (let c = 0; c < M.cols; c++) out.push(slotOf(r, c)); return out; }

/* ---------------------------------------------------------------- geometry (§1.3) */
const ceil32 = x => Math.ceil(x / 32) * 32;
/** The grid element of rows × cols at size 0 / 1 / 2: { rows, cols, size, P, gap, w, h } (world px: the pads and their gaps). */
export function gridOf(rows, cols, size) {
  const R = intIn(rows, 4, 1, 8), C = intIn(cols, 4, 1, 8), z = intIn(size, 1, 0, 2), P = PAD_PX[z];
  return { rows: R, cols: C, size: z, P, gap: GAP, w: C * P + (C - 1) * GAP, h: R * P + (R - 1) * GAP };
}
/** The module's fixed size (host size(key) → { fixed: { w, h } }): w = ceil32(2 · 16 + grid w), h = ceil32(BAR_H + 2 · 16 +
 * grid h + FOOTER); gx / gy: the grid's top-left from the module's (centred across, PADDING under the bar); fy: the footer's
 * top. 4 × 4 M 352 × 416, 8 × 8 M 672 × 736, 8 × 8 L 864 × 928, 1 × 1 S 96 × 160. */
export function footprint(rows, cols, size) {
  const G = gridOf(rows, cols, size), w = ceil32(2 * PADDING + G.w), h = ceil32(BAR_H + 2 * PADDING + G.h + FOOTER);
  return { w, h, gx: Math.floor((w - G.w) / 2), gy: BAR_H + PADDING, fy: h - FOOTER };
}
/** The pad under (x, y) in the grid element (world px from its top-left): { i, r, c, f } (f: the height in the pad from its
 * top, 0…1 — the velocity's "front edge loud") | null (a gap, outside: only visible pads are in the grid). */
export function padAt(G, x, y) {
  if (!(x >= 0 && y >= 0 && x < G.w && y < G.h)) return null;
  const step = G.P + G.gap, c = Math.floor(x / step), rt = Math.floor(y / step), fy = y - rt * step;
  if (x - c * step >= G.P || fy >= G.P || c >= G.cols || rt >= G.rows) return null;
  const r = G.rows - 1 - rt;
  return { i: slotOf(r, c), r, c, f: fy / G.P };
}
/** Slot i's box in the grid element (world px) | null (hidden). */
export function padRect(G, i) {
  if (!visible(G, i)) return null;
  const step = G.P + G.gap, r = i >> 3, c = i & 7;
  return { x: c * step, y: (G.rows - 1 - r) * step, w: G.P, h: G.P };
}

/* ---------------------------------------------------------------- velocity (§2.2) */
/** A pad's velocity from where it is touched (= cv-drum padVel): f = 0 the top edge 0.30 … 1 over the bottom 7 %. */
export const padVel = f => Math.min(1, VEL_LO + VEL_SPAN * clamp(fin(f) ? f : 1, 0, 1));
/** A hit's velocity 0…1 (§2.2; review #22): the pad's own fixed v wins for every source; else hardware as sent ({ hw: 0–127 });
 * else the module's fixed fv (canvas and keyboard) [C]; else a keyboard press ({ key: true }) 100 / 127, a pointer ({ f })
 * padVel(f). M, pad may be null. */
export function hitVel(M, pad, src) {
  if (isObj(pad) && fin(pad.v) && pad.v >= 1) return clamp(Math.round(pad.v), 1, 127) / 127;
  src = isObj(src) ? src : {};
  if (own(src, 'hw')) return clamp(fin(src.hw) ? Math.round(src.hw) : 100, 1, 127) / 127;
  if (isObj(M) && M.vel === 'fixed') return intIn(M.fv, 100, 1, 127) / 127;
  return src.key ? KEY_PAD_V : padVel(src.f);
}
/** The bed's hit test (cv-keys bed o.hit, §2.1): (x, y, s) → { note: slot, v } | null. G: gridOf of the module; mod: its record
 * or a getter (edits apply live). Every visible pad hits, an empty one too (the host plays nothing for it). */
export function padHit(G, mod) {
  return (x, y) => {
    const h = padAt(G, x, y);
    if (!h) return null;
    const M = typeof mod === 'function' ? mod() : mod;
    return { note: h.i, v: hitVel(M, M && Array.isArray(M.pads) ? M.pads[h.i] : null, { f: h.f }) };
  };
}

/* ---------------------------------------------------------------- targets (§3.2, §3.3) */
/** A chord target's notes (§3.2): the quality's intervals, open spread = the third (the 2nd entry) up an octave, inversion inv
 * (the lowest inv notes up an octave; past the chord's size its last inversion) [C], + root + 12 · oct; sorted, unique, notes
 * outside 0–127 dropped, ≤ 8. */
export function chordNotes(x) {
  if (!isObj(x)) return [];
  const iv = QUALITIES[own(QUALITIES, x.q) ? x.q : 'maj'].slice();
  if (x.spread === 'open' && iv.length >= 3) iv[1] += 12;
  iv.sort((a, b) => a - b);
  const inv = Math.min(intIn(x.inv, 0, 0, 3), iv.length - 1);
  for (let k = 0; k < inv; k++) { iv[0] += 12; iv.sort((a, b) => a - b); }
  const base = intIn(x.root, 60, 0, 127) + 12 * intIn(x.oct, 0, -2, 2), out = [];
  for (const d of iv) { const n = base + d; if (n >= 0 && n <= 127 && !out.includes(n)) out.push(n); }
  return out.sort((a, b) => a - b).slice(0, MAX_NS);
}
/** The notes a note / chord / notes target plays (a drum target: [] — its note is the machine's, resolve). */
export function targetNotes(x) {
  if (!isObj(x)) return [];
  if (x.k === 'note') return Number.isInteger(x.n) && x.n >= 0 && x.n <= 127 ? [x.n] : [];
  if (x.k === 'chord') return chordNotes(x);
  if (x.k === 'notes' && Array.isArray(x.ns)) return normNs(x.ns);
  return [];
}
function normNs(a) {
  const out = [];
  for (const n of a) if (fin(n)) { const k = clamp(Math.round(n), 0, 127); if (!out.includes(k)) out.push(k); if (out.length === MAX_NS) break; }
  return out.sort((p, q) => p - q);
}
// a track's instruments, the primary first (cv-model instIds' order: a leaf cannot import cv-model)
function insts(t) {
  const d = isObj(t.dev) ? t.dev : {}, syn = Object.keys(d).filter(k => isObj(d[k]) && d[k].kind === 'synth');
  return own(d, t.prim) && syn.includes(t.prim) ? [t.prim, ...syn.filter(k => k !== t.prim)] : syn;
}
const persOf = m => (typeof m === 'string' && own(PERS, m) ? PERS[m] : null);
/** A sound key's name: on machine `model` (PERS names by sound id), else the first machine that has the key, else the key. */
export function soundName(s, model) {
  const P = persOf(model);
  if (P) { const j = P.sounds.indexOf(s); if (j >= 0 && P.sids.includes(j)) return P.names[j]; }
  for (const m of Object.keys(PERS)) { const j = PERS[m].sounds.indexOf(s); if (j >= 0 && PERS[m].sids.includes(j)) return PERS[m].names[j]; }
  return String(s).toUpperCase();
}
/** A sound key's name for a pad's label: soundName without its trailing parenthetical ("Tom 1 (high)" → "Tom 1": a pad is too
 * narrow for it; the roll, the inspector's list and the warnings keep the full name). */
export function soundShort(s, model) { return soundName(s, model).replace(/\s*\([^)]*\)\s*$/, ''); }
const defDrumOf = (t, k) => { const d = t.dev[k]; return persOf(d.model) ? normDrum(d.drum, d.model) : null; };
/** A drum target's note on track t (§3.3): the first drum machine of t (primary first) that has sound s → its map primary
 * D.map[s][0] (= drum-core primaries; the record by drumOf(t, devId), main.js's; default normDrum) — { n, dev, model } | { n: −1,
 * why: 'sound' (no machine with it: a Replace, a synth) | 'unmapped' (MAP… left it no note) }. */
export function drumNote(t, s, drumOf) {
  let why = 'sound';
  if (!isObj(t) || !SND.test(s)) return { n: -1, why };
  const of = typeof drumOf === 'function' ? drumOf : defDrumOf;
  for (const k of insts(t)) {
    const dev = t.dev[k], P = persOf(dev.model);
    if (!P) continue;
    const j = P.sounds.indexOf(s);
    if (j < 0 || !P.sids.includes(j)) continue;
    const D = of(t, k);
    if (!isObj(D)) continue;
    const m = isObj(D.map) && own(D.map, s) ? D.map[s] : null, n = Array.isArray(m) ? m[0] : -1;
    if (Number.isInteger(n) && n >= 0 && n <= 127) return { n, dev: k, model: dev.model };
    why = 'unmapped';
  }
  return { n: -1, why };
}
const trackOf = (project, id) => (isObj(project) && Array.isArray(project.tracks) ? project.tracks.find(t => isObj(t) && t.id === id) || null : null);
const tname = t => (typeof t.name === 'string' && t.name ? t.name : 'this track');
/**
 * What a hit of `pad` plays (§3, §4.1): { hits: [{ tr, ns, at }], warn: [{ i, tr, why, text }] } — per target track (first-
 * target order) its notes sorted and unique over the pad's targets (a note two targets share: once), at: a note / chord target
 * there (the Pencil's aftertouch goes to it, §2.4; a drum target: none). A target whose track is gone (why 'track'), whose track
 * has no machine with its sound ('sound': a Replace, a deleted machine) or no note for it ('unmapped') plays nothing and warns
 * ("no Kick on “Drums” any more", §3.3). drumOf(t, devId) → the record (main.js's); absent: normDrum of the device's.
 */
export function resolve(pad, project, drumOf) {
  const hits = [], warn = [];
  if (!isObj(pad) || !Array.isArray(pad.t)) return { hits, warn };
  const add = (tr, ns, at) => {
    let h = hits.find(x => x.tr === tr);
    if (!h) hits.push(h = { tr, ns: [], at: false });
    for (const n of ns) if (!h.ns.includes(n)) h.ns.push(n);
    if (at) h.at = true;
  };
  pad.t.forEach((x, i) => {
    if (!isObj(x)) return;
    const t = trackOf(project, x.tr);
    if (!t) { warn.push({ i, tr: x.tr, why: 'track', text: 'Its track was deleted' }); return; }
    if (x.k === 'drum') {
      const d = drumNote(t, x.s, drumOf), name = soundName(x.s, d.model);
      if (d.n >= 0) add(t.id, [d.n], false);
      else warn.push({ i, tr: t.id, why: d.why, text: d.why === 'unmapped' ? `${name} has no note on “${tname(t)}”` : `No ${name} on “${tname(t)}” any more` });
      return;
    }
    const ns = targetNotes(x);
    if (ns.length) add(t.id, ns, true);
  });
  for (const h of hits) h.ns.sort((a, b) => a - b);
  return { hits, warn };
}
/** A target's short label (§3.1): "Kick" (by its track's machine), "C3", "Cm7", "C3 +2" (a custom list); '' for none. */
export function targetLabel(x, project) {
  if (!isObj(x)) return '';
  if (x.k === 'drum') { const t = trackOf(project, x.tr); return soundShort(x.s, t ? modelOfDrum(t, x.s) : null); }
  if (x.k === 'note') return Number.isInteger(x.n) ? noteName(x.n) : '';
  if (x.k === 'chord') return NAMES[intIn(x.root, 60, 0, 127) % 12] + (Q_SUFFIX[own(Q_SUFFIX, x.q) ? x.q : 'maj']);
  if (x.k === 'notes') { const ns = targetNotes(x); return ns.length ? noteName(ns[0]) + (ns.length > 1 ? ' +' + (ns.length - 1) : '') : ''; }
  return '';
}
// the track's first drum machine with sound s, else its first drum machine (a label's names: no record read)
function modelOfDrum(t, s) {
  let first = null;
  for (const k of insts(t)) {
    const m = t.dev[k].model, P = persOf(m);
    if (!P) continue;
    const j = P.sounds.indexOf(s);
    if (j >= 0 && P.sids.includes(j)) return m;
    first = first || m;
  }
  return first;
}
/** A pad's shown label: its own l, else its first target's, else "Mod" (a mod-only pad), else ''. */
export function padLabel(pad, project) {
  if (!isObj(pad)) return '';
  if (typeof pad.l === 'string' && pad.l) return pad.l;
  const x = Array.isArray(pad.t) ? pad.t[0] : null;
  return x ? targetLabel(x, project) : pad.mod ? 'Mod' : '';
}
/** A mod pad's one name everywhere (§5.1; the Mod list, Connect to…, the inspector, the jacks' labels — review 1 E / 2 F8):
 * "<module name> · <the pad's own label | its first target's label ("Kick", "C4", "Tom 1") | Pad k>", k the shown number, a
 * hidden slot its place on the full 8 × 8 (i + 1). project: the tracks the target labels read (absent: by the sounds' first machine). */
export function padSourceName(project, M, i) {
  if (!isObj(M)) return '';
  const pad = Array.isArray(M.pads) ? M.pads[i] : null, own = isObj(pad) && typeof pad.l === 'string' && pad.l ? pad.l : '';
  const tl = !own && isObj(pad) && Array.isArray(pad.t) && pad.t.length ? padLabel(pad, project) : '';
  return (typeof M.name === 'string' && M.name ? M.name : 'Pads ' + String(M.id || '').slice(2)) + ' · ' + (own || tl || 'Pad ' + (visible(M, i) ? padNo(M, i) : i + 1));
}
/** Is the pad off (§3.1: no target and no modulation — dark, plays nothing)? */
export const isOff = pad => !isObj(pad) || ((!Array.isArray(pad.t) || !pad.t.length) && !pad.mod);

/* ---------------------------------------------------------------- normPads (§10.1) */
function normTarget(x) {
  if (!isObj(x) || !validId(x.tr)) return null;
  const tr = x.tr;
  switch (x.k) {
    case 'note': return fin(x.n) ? { k: 'note', tr, n: clamp(Math.round(x.n), 0, 127) } : null;
    case 'chord': return fin(x.root) ? { k: 'chord', tr, root: clamp(Math.round(x.root), 0, 127), q: own(QUALITIES, x.q) ? String(x.q) : 'maj',
      inv: intIn(x.inv, 0, 0, 3), oct: intIn(x.oct, 0, -2, 2), spread: oneOf(x.spread, ['close', 'open'], 'close') } : null;
    case 'notes': { const ns = Array.isArray(x.ns) ? normNs(x.ns) : []; return ns.length ? { k: 'notes', tr, ns } : null; }
    case 'drum': return typeof x.s === 'string' && SND.test(x.s) ? { k: 'drum', tr, s: x.s } : null;
  }
  return null;
}
function normMod(m) {
  if (!isObj(m)) return null;
  return { m: oneOf(m.m, MOD_MODES, 'vel'), lo: fin(m.lo) ? clamp(m.lo, 0, 1) : 0, hi: fin(m.hi) ? clamp(m.hi, 0, 1) : 1 };
}
function normHw(b) {
  if (!isObj(b) || !Number.isInteger(b.ch) || b.ch < 1 || b.ch > 16 || !Number.isInteger(b.n) || b.n < 0 || b.n > 127) return null;
  return { port: strIn(b.port, MAX_PORT), ch: b.ch, n: b.n, cc: b.cc === 1 || b.cc === true ? 1 : 0 };
}
/** One pad record (§3.1) | null (not an object). */
export function normPad(p) {
  try {
    if (!isObj(p)) return null;
    const t = [];
    if (Array.isArray(p.t)) for (const x of p.t) { const y = normTarget(x); if (y) t.push(y); if (t.length === MAX_T) break; }
    const mod = normMod(p.mod);
    return { c: Number.isInteger(p.c) && p.c >= 0 && p.c < 16 ? p.c : colorFor(t[0], mod), l: strIn(p.l, MAX_LABEL), t, mod,
      v: fin(p.v) && p.v >= 1 ? clamp(Math.round(p.v), 1, 127) : null, latch: p.latch === 1 || p.latch === true ? 1 : 0, hw: normHw(p.hw) };
  } catch (e) {
    return null;                                                       // (a hostile getter: an empty pad)
  }
}
const hwKey = b => b.port + '\u0000' + b.ch + ':' + b.n + ':' + b.cc;
function normModule(m, id) {
  const pads = new Array(N_SLOTS), src = Array.isArray(m.pads) ? m.pads : [];
  for (let i = 0; i < N_SLOTS; i++) pads[i] = normPad(src[i]);
  const out = isObj(m.out) ? m.out : {};
  return { id, name: strIn(m.name, MAX_NAME) || 'Pads ' + id.slice(2), rows: intIn(m.rows, 4, 1, 8), cols: intIn(m.cols, 4, 1, 8),
    size: intIn(m.size, 1, 0, 2), vel: oneOf(m.vel, ['pos', 'fixed'], 'pos'), fv: intIn(m.fv, 100, 1, 127), light: oneOf(m.light, ['hit', 'follow', 'both'], 'both'),
    shape: oneOf(m.shape, ['sq', 'hex'], 'sq'), out: { prof: oneOf(out.prof, ['off', 'gen'], 'off'), port: strIn(out.port, MAX_PORT) }, pads };
}
/** project.pads normalised (§10.1): ≤ 8 modules in order (non-objects dropped), a valid unique id kept, any other the lowest
 * free one; a hardware binding unique across the project (module, then slot order: later duplicates → hw null). Idempotent,
 * never throws; anything else → []. */
export function normPads(x) {
  try {
    if (!Array.isArray(x)) return [];
    const ms = [];
    for (const m of x) { try { if (isObj(m)) ms.push(m); } catch (e) { /* hostile */ } if (ms.length === MAX_MODS) break; }
    const ids = ms.map(m => { try { return typeof m.id === 'string' && PAD_ID.test(m.id) ? m.id : null; } catch (e) { return null; } });
    const taken = new Set();
    ids.forEach((id, j) => { if (id && !taken.has(id)) taken.add(id); else ids[j] = null; });
    const out = [], seen = new Set();
    ms.forEach((m, j) => {
      let id = ids[j];
      if (!id) { for (let n = 1; n <= MAX_MODS; n++) if (!taken.has('pd' + n)) { id = 'pd' + n; break; } taken.add(id); }
      let M;
      try { M = normModule(m, id); } catch (e) { M = normModule({}, id); }
      for (const p of M.pads) if (p && p.hw) { const k = hwKey(p.hw); if (seen.has(k)) p.hw = null; else seen.add(k); }
      out.push(M);
    });
    return out;
  } catch (e) {
    return [];
  }
}
/** The lowest free module id (null at MAX_MODS). */
export function freeId(pads) {
  const have = new Set(Array.isArray(pads) ? pads.map(m => (isObj(m) ? m.id : null)) : []);
  for (let n = 1; n <= MAX_MODS; n++) if (!have.has('pd' + n)) return 'pd' + n;
  return null;
}
/** A new module record (normalised): id, "Pads n", 4 × 4 M by default; o's fields over it (defaultsFor's rows / cols / pads). */
export const newModule = (id, o) => normPads([Object.assign({}, isObj(o) ? o : {}, { id })])[0] || null;
/** The mod source of slot i of module id (§5.1): 'pd1.p12'; padOfSrc parses one → { id, i } | null. */
export const padSrc = (id, i) => id + '.p' + i;
export function padOfSrc(src) {
  const m = typeof src === 'string' ? PAD_SRC.exec(src) : null;
  return m && +m[2] < N_SLOTS && String(+m[2]) === m[2] ? { id: m[1], i: +m[2] } : null;
}

/* ---------------------------------------------------------------- defaults and Fill from… (§3.5) */
// look { c: { sound key: colour 0–15 } }: a machine's own pad colours (the SDS-V's kit); a missing / bad one the family's (colorFor)
const lookC = (look, s) => { const c = isObj(look) && isObj(look.c) && own(look.c, s) ? look.c[s] : null; return Number.isInteger(c) && c >= 0 && c < 16 ? c : null; };
const drumPad = (tr, s, look) => { const c = lookC(look, s); return { c: c == null ? colorFor({ k: 'drum', s }) : c, l: '', t: [{ k: 'drum', tr, s }], mod: null, v: null, latch: 0, hw: null }; };
const notePad = (tr, n) => ({ c: C_VIOLET, l: '', t: [{ k: 'note', tr, n }], mod: null, v: null, latch: 0, hw: null });
const isSound = s => typeof s === 'string' && SND.test(s) && s !== 'ac';  // ('ac': the 606's / 909's accent hold — no sound)
// a machine's sounds by sound id (kick first), as a top-row-first order of `cols` (a machine without its pad order)
function sidOrder(D, cols) {
  const P = persOf(isObj(D) && typeof D.m === 'string' ? D.m : 'tr808') || PERS.tr808, list = P.sids.map(j => P.sounds[j]), rows = [];
  for (let j = 0; j < list.length; j += cols) rows.push(list.slice(j, j + cols));
  const top = rows[rows.length - 1];
  while (top && top.length < cols) top.push('');                       // (the top row padded: the kick stays bottom-left)
  return rows.reverse().flat();
}
/**
 * A new module's pads following the track it is added on (§3.5; Q3): a drum machine (D its record) → `order` (cv-drum UI[m].pads:
 * the top row first, left → right) on a grid of `cols` columns × ceil(len / cols) rows — order row r on grid row rows − 1 − r, so
 * the kick lands bottom-left; 'ac' (the 606's / 909's accent hold) an empty pad [C]; the SDS-V: its five, 1 × 5 (cols 5) [C].
 * Without D: a chromatic run from C3 (48) on the track, 4 × 4 (pad k plays 47 + k). look { c: { sound: colour } }: the machine's
 * own colour per sound (the SDS-V's kit), else the family's. → { rows, cols, pads: [64] }.
 */
export function defaultsFor(track, D, order, cols, look) {
  const pads = new Array(N_SLOTS).fill(null), tr = isObj(track) && validId(track.id) ? track.id : null;
  if (!tr) return { rows: 4, cols: 4, pads };
  if (isObj(D)) {
    const C = intIn(cols, 4, 1, 8), ord = (Array.isArray(order) && order.length ? order : sidOrder(D, C)).slice(0, N_SLOTS);
    const R = clamp(Math.ceil(ord.length / C), 1, 8);
    ord.forEach((s, j) => { const r = R - 1 - Math.floor(j / C); if (r >= 0) pads[slotOf(r, j % C)] = isSound(s) ? drumPad(tr, s, look) : null; });
    return { rows: R, cols: C, pads };
  }
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) pads[slotOf(r, c)] = notePad(tr, CHROM_FROM + r * 4 + c);
  return { rows: 4, cols: 4, pads };
}
/**
 * Fill from… (§3.5) onto the module's visible pads, in numbering order (pad 1 first); the visible pads left over empty, the
 * hidden ones kept [C]. how: { k: 'drum', tr, order, cols } (a machine's pad order, top row first as defaultsFor's — read bottom
 * row first so the kick is pad 1; 'ac' skipped; look as defaultsFor's) | { k: 'scale', tr, scale: 'chrom' | 'major' | 'minor' | 'penta', root }
 * (notes up from root; past 127 empty). → a new 64-array (M untouched).
 */
export function fill(M, how) {
  const pads = Array.isArray(M.pads) ? M.pads.slice(0, N_SLOTS) : new Array(N_SLOTS).fill(null), slots = visibleSlots(M);
  while (pads.length < N_SLOTS) pads.push(null);
  for (const i of slots) pads[i] = null;
  if (!isObj(how) || !validId(how.tr)) return pads;
  if (how.k === 'drum') {
    const C = intIn(how.cols, 4, 1, 8), ord = Array.isArray(how.order) ? how.order : [], rows = [];
    for (let j = 0; j < ord.length; j += C) rows.push(ord.slice(j, j + C));
    const seq = rows.reverse().flat().filter(isSound);
    slots.forEach((i, k) => { if (k < seq.length) pads[i] = drumPad(how.tr, seq[k], how.look); });
  } else if (how.k === 'scale') {
    const sc = SCALES[own(SCALES, how.scale) ? how.scale : 'chrom'], root = intIn(how.root, CHROM_FROM, 0, 127);
    slots.forEach((i, k) => { const n = root + 12 * Math.floor(k / sc.length) + sc[k % sc.length]; if (n <= 127) pads[i] = notePad(how.tr, n); });
  }
  return pads;
}

/* ---------------------------------------------------------------- modulation (§5.2) */
/**
 * A mod pad's value after an event (§5.2): ev { e: 'press', v } | { e: 'at', at } | { e: 'release' }; st the source's state
 * { v, on } (null: at rest — v lo, off) → the new { v, on }. gate: hi while held; vel: lo + (hi − lo) · v at the press; press:
 * lo, then lo + (hi − lo) · at while held; all three lo at the release. tog: each press flips lo ↔ hi (on = the toggle; a
 * release leaves it). v 0…1 (lo > hi: an inverted range).
 */
export function modValue(m, ev, st) {
  const lo = fin(m && m.lo) ? m.lo : 0, hi = fin(m && m.hi) ? m.hi : 1, mode = m && m.m;
  const on0 = !!(st && st.on), v0 = st && fin(st.v) ? st.v : lo, e = isObj(ev) ? ev.e : null;
  const at = u => lo + (hi - lo) * clamp(fin(u) ? u : 0, 0, 1);
  if (e === 'press') {
    if (mode === 'tog') return { v: on0 ? lo : hi, on: !on0 };
    return { v: mode === 'gate' ? hi : mode === 'press' ? lo : at(ev.v), on: true };
  }
  if (e === 'at') return mode === 'press' && on0 ? { v: at(ev.at), on: true } : { v: v0, on: on0 };
  if (e === 'release') return mode === 'tog' ? { v: v0, on: on0 } : { v: lo, on: false };
  return { v: v0, on: on0 };
}
/** A mod pad's light (§6.2): 22 % at lo … 100 % at hi. */
export function modBright(m, v) {
  const lo = fin(m && m.lo) ? m.lo : 0, hi = fin(m && m.hi) ? m.hi : 1;
  return IDLE_A + (1 - IDLE_A) * (hi === lo ? 0 : clamp((v - lo) / (hi - lo), 0, 1));
}

/* ---------------------------------------------------------------- hardware (§8) */
/** The pad a hardware message is bound to (§8.3; ch 1–16 and n — the note, or the CC number with cc — as midi.js decode gives
 * them): a binding of its (ch, n, cc) on this port, else one with port '' (any) —
 * { id, i, hidden } (hidden: outside its grid — inert, §1.3: the host swallows it, plays nothing) | null. */
export function bindOf(pads, port, ch, n, cc) {
  if (!Array.isArray(pads)) return null;
  const c1 = cc ? 1 : 0;
  let any = null;
  for (const M of pads) {
    if (!isObj(M) || !Array.isArray(M.pads)) continue;
    for (let i = 0; i < M.pads.length; i++) {
      const b = isObj(M.pads[i]) ? M.pads[i].hw : null;
      if (!b || b.ch !== ch || b.n !== n || b.cc !== c1) continue;
      const hit = { id: M.id, i, hidden: !visible(M, i) };
      if (b.port === port) return hit;
      if (b.port === '' && !any) any = hit;
    }
  }
  return any;
}
/**
 * Bind slot i of module id to the hardware pad b (§8.3; b null: Forget): one binding per (port, ch, n, cc) — another pad holding
 * it loses it (moved). Immutable: → { pads (a new project.pads, untouched modules shared), moved: { id, i } | null }; an empty
 * slot gets an off pad carrying the binding.
 */
export function rebind(pads, id, i, b) {
  const hw = normHw(b);
  let moved = null;
  const out = (Array.isArray(pads) ? pads : []).map(M => {
    if (!isObj(M) || !Array.isArray(M.pads)) return M;
    let P = null;
    M.pads.forEach((p, j) => {
      if (M.id === id && j === i) return;
      if (hw && isObj(p) && p.hw && hwKey(p.hw) === hwKey(hw)) { (P = P || M.pads.slice())[j] = Object.assign({}, p, { hw: null }); moved = { id: M.id, i: j }; }
    });
    const p = M.id === id && Number.isInteger(i) && i >= 0 && i < N_SLOTS ? (P || M.pads)[i] : undefined;
    if (isObj(p) || (p === null && hw)) (P = P || M.pads.slice())[i] = Object.assign({}, isObj(p) ? p : normPad({}), { hw });
    return P ? Object.assign({}, M, { pads: P }) : M;
  });
  return { pads: out, moved };
}
/** The light-back bytes of a learned pad's state (§8.4): prof 'gen' — a note-on on its learned channel and note, velocity 127
 * lit / held, 0 idle / off; null for 'off', no binding or a CC-learned pad (never lit). */
export function echo(prof, pad, state) {
  const b = isObj(pad) ? pad.hw : null;
  if (prof !== 'gen' || !isObj(b) || b.cc) return null;
  return [0x90 | ((b.ch - 1) & 15), b.n & 127, state === 'lit' || state === 'held' ? 127 : 0];
}
