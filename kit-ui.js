// kit-ui.js — our drum machine's faces on the canvas (docs/canvas/IMPL-DM.md §4, §7.3, §9.2; stage DM lane F): the Sequencer (the
// instrument's own module 'iN', 19 columns = 1248 px: the head — KIT ▾, PATTERN A–H, LENGTH, SWING, CLEAR — over the step grid) and one
// voice face per drum ('pm' modules 'iN/k<s>', 4 columns = 288 × 236: TYPE ▾ and HIT over TUNE DECAY LEVEL CHOKE and the type's four
// character knobs). Built as MOD1's plain faces and LC's Combiner are (cv-mods-ui plainFace / editor / combBody): rig-grid's numbers and
// CSS, rig-ui's markup (section.rig-face, .rig-row / .rig-cell), wk's widgets; no donor panel, no cords (decision e). The skins come
// from the module's rig mark (data-cv-rig: lane H's rigMark) — kit-ui injects only its own pieces (KIT_CSS, once per document), colours
// from the skin's tokens, the six type colours KIT.TINT (data). Imports rig-grid.js, wk.js and kit-core.js only (D6, a grep test).
//
// The step grid (§4.2, the family's technique, cv-drum's extras grid): ONE canvas for the cells (repainted on an edit, a skin or a zoom
// end only — kitStats.grid counts it), ONE hit layer over the sixteen step columns (the cell by arithmetic), ONE playhead moved by a
// transform at each heard step, a lamp per row (a CSS flash: two keyframes alternate, the family's LED idiom), DOM row headers (the name,
// the tint; a tap mutes, a long press or a right-click solos) and "+ ADD DRUM" under the last row (hidden at 16). Cells: off the screen
// tone (the beat columns lighter), on a bar rising to v / 127 in the voice's colour, past LENGTH dimmed and inert, a muted row dimmed.
// Gestures (§4.4, touch first): a tap toggles (on at the row's last-used velocity, else KIT.VEL.normal); a sideways drag paints the first
// cell's new state along the row; a vertical drag from an on-cell sets its velocity (up louder, a readout follows); the first 6 px decide;
// Shift-drag (a mouse) sets velocity from any cell; a long press (500 ms ≤ 8 px: wk.longPress) or a right-click opens the step menu (Soft ·
// Normal · Accent · Off); a second finger (gesture.js's flagged pointercancel) cancels a paint or a drag — the cells revert, nothing is
// written. Keyboard: the hit layer is one focusable element with a cursor element — arrows, Space / Enter, + / − (±8), Delete, M, S;
// its aria-label "Kick, step 5, on, velocity 100". Below 50 % a press pans: cv-world's sleeping controls (nothing here).
// The heard time (§4.2, §7.3): the faces subscribe to the drum host's api — step(fn) (the playhead: leds(S, D).step), lit(fn) (the
// monitor's 16-bit mask: the lamps and the HIT pads), on(fn) (a record / transport change: change-gated by the record's identity) — a
// listener only records and asks ONE frame (deps.raf, else wk.frame); that frame writes ≤ 1 transform + ≤ 16 attribute flips, never reads
// layout, creates nothing; no post, no frame (stopped: nothing runs); off screen ([data-cv-off] on an ancestor) it writes nothing and
// catches up at shown(true) / sync(). No wk.clock client (the playhead steps per sixteenth).
// Writes (§4.6, §5.5): a grid gesture, a pattern / LENGTH / SWING pick, CLEAR, mute, solo → ONE deps.edit(t, dev, label, { press }) (lane
// S's press input: the host runs it through the drum host inside one History step); a knob → deps.set(t, dev, id, v, 'move' | 'end')
// (kitKnob: no step); structural edits (add, Remove, TYPE, Reset sound, a kit) → ONE deps.edit with { vals, press? } (the host's kitBack).
//   kitHost(deps) → { face(kind 'seq' | 'voice', root, { t, dev, slot? }) → View, devices(t, dev), size(t, dev, key), rack(t, dev),
//     cellRect(t, dev, lane, step), FACE, layoutOf, destroy() }
//   View = { el, face, jacks (none: an empty Map), update(), sync(), shown(on), menuItems(), value() (null), destroy() } (+ seq:
//     pending(), cursor())
//   deps: doc · get(t, dev, id) → vals[id] (knobs 0–10, TYPE / CHOKE indices) · set(t, dev, id, v, ph) · drum(t, dev) → the drum host's
//     api ({ state() → { D, S }, step(fn), lit(fn), on(fn) → off, pads: { on(code, v, ts), off(code, ts) } }) · edit(t, dev, label, r) ·
//     menu?(x, y, items, opts) (else wk.contextMenu) · notice?(text, ms) · presets?(t, dev) → KIT ▾'s items, presetName?(t, dev) ·
//     rec?(t, dev) → the record (else drum().state().D) · leds?(t, dev) → { step } (else kit-core leds(S, D)) · barH (cv-module's bar:
//     size / rack / cellRect are module px) · raf?(fn) (tests)
// Rules: plain ES module, no DOM at module top level (node imports it), imports carry ?v=9, every layout number is rig-grid's GRID (the
// recipes here are data: columns and items, as MOD_FACE's), original content (no other machine's name or look).
import * as wk from './wk.js?v=9';
import { GRID, rowH, faceW, layoutOf, ensureRigCSS, deepFreeze } from './rig-grid.js?v=9';
import * as KC from './kit-core.js?v=9';

const { KIT } = KC;
const fin = x => typeof x === 'number' && isFinite(x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const mk = (d, tag, cls, txt) => { const e = d.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const set1 = (el, k, v) => { if (v == null) { if (el.hasAttribute(k)) el.removeAttribute(k); } else if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
const text1 = (el, t) => { if (el.textContent !== t) el.textContent = t; };
const stop = e => { if (e.stopPropagation) e.stopPropagation(); };
const prevent = e => { if (e.preventDefault) e.preventDefault(); };
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const px = v => v + 'px';
const r2 = x => Math.round(x * 1000) / 100;                    // a position → a knob value (0–10, two decimals: kit-core's kits)
// a control: never the world's press, no browser menu
const ctl = e => { e.addEventListener('pointerdown', stop); e.addEventListener('contextmenu', prevent); return e; };

/* ================================================================ the recipes (data: columns and items; the numbers are GRID's) */
/** The step grid: 16 steps a pattern (§3.1), the row headers' columns before them, the lamps' after. */
export const N_STEPS = 16, HEAD_COLS = 2;
/** The Sequencer's and a voice face's columns (§4.2–4.3). */
export const SEQ_COLS = HEAD_COLS + N_STEPS + 1, VOICE_COLS = 4;
/** Tidy's rows: four voices a row; the gap between them and under the Sequencer — so that four voice faces and three gaps are the
 * Sequencer's width (§4.2): (1248 − 4 · 288) / 3 = 32. */
export const RACK_ROW = 4, RACK_GAP = (faceW(SEQ_COLS) - RACK_ROW * faceW(VOICE_COLS)) / (RACK_ROW - 1);
const R = (t, items, h) => ({ t, h: rowH(t, h), items });
const COL = GRID.col, ST = GRID.steps;
const gridH = n => { const k = clamp(n | 0, 0, KIT.SLOTS); return ST.ruler + ST.cell * (k + (k < KIT.SLOTS ? 1 : 0)); };
const RECIPES = new Map();
/** The Sequencer's recipe at n voices (one per n, frozen): the head, then the grid row (numeric h: the ruler + a cell row a voice + the
 * add row while there is room — layoutOf honours it, as LC's list row). */
export function seqRecipe(n) {
  const k = clamp(n | 0, 0, KIT.SLOTS);
  let F = RECIPES.get(k);
  if (!F) RECIPES.set(k, (F = deepFreeze({ cols: SEQ_COLS, rows: [R('head', ['#kit', '#pat', '#len', '#swing', '#clear*']), { t: 'grid', h: gridH(k), items: ['#grid'] }] })));
  return F;
}
/** (§4.2–4.3) The faces' recipes: the voice face; the Sequencer at no voice (seqRecipe(n) for n). */
export const FACE = deepFreeze({
  voice: { cols: VOICE_COLS, rows: [R('head', ['#tint', '#type*', '#hit']), R('knobs', ['u', 'd', 'l', '#c']), R('knobs', ['1', '2', '3', '4'])] },
  seq: seqRecipe(0),
});
/** The Sequencer's face height at n voices; a voice face's (236). */
export const seqH = n => layoutOf(seqRecipe(n)).h;
export const voiceH = layoutOf(FACE.voice).h;

/* ================================================================ readouts, the pad's curve */
/** A knob's readout by its law (kit-core KIT.TYPES): Hz / kHz, ms / s, ×, st, Q, a count, else a percentage. */
export function fmtKnob(L, x) {
  if (!L) return '';
  const p = fin(x) ? clamp(x, 0, 1) : L.def, v = KC.lawVal(L, p);
  switch (L.unit) {
    case 'Hz': return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + ' kHz' : Math.round(v) + ' Hz';
    case 's': return v >= 1 ? v.toFixed(2) + ' s' : v >= 0.01 ? Math.round(v * 1000) + ' ms' : (v * 1000).toFixed(1) + ' ms';
    case 'x': return v.toFixed(2) + '×';
    case 'st': return v.toFixed(1) + ' st';
    case 'Q': return 'Q ' + v.toFixed(1);
    default: return L.law === 'int' ? String(v) : Math.round((L.law === 'lin' ? v : p) * 100) + ' %';
  }
}
/** LEVEL's readout: the gain (l / 0.7)² in dB (§2.1). */
export function fmtLevel(x) {
  const p = fin(x) ? clamp(x, 0, 1) : KIT.LAW.lRef;
  if (p <= 0) return '−∞ dB';
  const db = 20 * Math.log10(Math.pow(p / KIT.LAW.lRef, 2));
  return Math.abs(db) < 0.05 ? '0.0 dB' : (db > 0 ? '+' : '−') + Math.abs(db).toFixed(1) + ' dB';
}
// (review R2-4) a typed value → the knob's position (0…1) | null, fmtKnob / fmtLevel inverted: the unit optional — a bare number reads in
// the unit the readout `cur` shows (ms or s, Hz or kHz); − and , accepted
const NUM_T = /^\s*([+\-\u2212]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*([a-z×%µ]*)\s*$/i;
const posOf = (L, v) => { if (!fin(v)) return null; if (L.law === 'exp') return v > 0 ? clamp(Math.log(v / L.lo) / Math.log(L.hi / L.lo), 0, 1) : null; return clamp(L.hi === L.lo ? 0 : (v - L.lo) / (L.hi - L.lo), 0, 1); };
export function parseKnob(L, text, cur = '') {
  const t = String(text).replace(/^\s*Q\s+/i, ''), m = L ? NUM_T.exec(t) : null;
  if (!m) return null;
  const n = parseFloat(m[1].replace('\u2212', '-').replace(',', '.')), u = m[2].toLowerCase(), c = String(cur).trim().toLowerCase();
  switch (L.unit) {
    case 'Hz': { const k = u ? (u === 'khz' || u === 'k' ? 1000 : u === 'hz' ? 1 : 0) : (c.endsWith('khz') ? 1000 : 1); return k ? posOf(L, n * k) : null; }
    case 's': { const k = u ? (u === 'ms' ? 0.001 : u === 's' ? 1 : 0) : (c.endsWith('ms') ? 0.001 : 1); return k ? posOf(L, n * k) : null; }
    case 'x': return !u || u === 'x' || u === '×' ? posOf(L, n) : null;
    case 'st': return !u || u === 'st' ? posOf(L, n) : null;
    case 'Q': return !u ? posOf(L, n) : null;
    default:
      if (L.law === 'int') return !u ? posOf(L, Math.round(n)) : null;
      return !u || u === '%' ? (L.law === 'lin' ? posOf(L, n / 100) : clamp(n / 100, 0, 1)) : null;
  }
}
export function parseLevel(text) {
  const t = String(text).trim().toLowerCase().replace('\u2212', '-');
  if (/^-?\s*(∞|inf(inity)?)\s*(db)?$/.test(t)) return 0;
  const m = /^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*(db)?$/.exec(t);
  return m ? clamp(KIT.LAW.lRef * Math.pow(10, parseFloat(m[1].replace(',', '.')) / 40), 0, 1) : null;
}
/** CHOKE's readout: – (none) or its group 1–4. */
export const fmtChoke = c => (c >= 1 ? String(Math.round(c)) : '–');
// LEVEL's knob (§2.1: 0…1, its default the reference); CHOKE's groups
const LEVEL = deepFreeze({ id: 'level', label: 'Level', law: 'lin', lo: 0, hi: 1, unit: 'dB', def: KIT.LAW.lRef });
const CHOKES = 4;
/** The HIT pad's velocity by depth (f 0 at its top … 1 at its front edge): the 1i curve, cv-keys KEY_VEL's lo 0.3 / span 0.75 — copied
 * (D6 keeps kit-ui's imports to three; a test holds them equal). */
export const padVel = f => Math.min(1, 0.3 + 0.75 * clamp(fin(f) ? f : 1, 0, 1));
/** A key's hit on the pad (Space / Enter): an unaccented step's velocity. */
export const PAD_KEY_V = KIT.VEL.normal / 127;
/** The gestures' numbers (screen px, ms): the first 6 px decide paint / velocity; the long press; a header's tap slop; the keys' velocity step. */
export const DECIDE_PX = 6, LONG_MS = 500, SLOP_PX = 8, VEL_STEP = 8;
/** (G9) The faces' counters: frames that wrote (paints), grid canvas repaints (grid). */
export const kitStats = { paints: 0, grid: 0 };

/* ================================================================ KIT_CSS (§4.8): the faces' own pieces; sizes GRID's, colours the skin's */
const LAB = 'font: 600 var(--rig-f-lab) / 1 var(--rig-font, var(--ui, system-ui, sans-serif)); letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap;';
const HEADF = 'font: 600 var(--rig-f-head) / 1 var(--rig-font, var(--ui, system-ui, sans-serif)); letter-spacing: 0.04em; white-space: nowrap;';
const BAND = "content: ''; position: absolute; left: 0; top: calc((var(--rig-box) - var(--rig-hit)) / 2 - 1px); width: 100%; height: var(--rig-hit);";
const FLASH = 'from { background: var(--kit-c, var(--sx-accent, #e8a33d)); box-shadow: 0 0 calc(var(--rig-margin) * 2) var(--kit-c, var(--sx-accent, #e8a33d)); }';
export const KIT_CSS_ID = 'kit-css';
export const KIT_CSS = `
/* kit-ui.js — the drum machine's faces (IMPL-DM §4): the head's picks, the step grid's pieces, the HIT pad; sizes GRID's, colours the skin's tokens */
.rig-face.kit-seq { --kit-cell: ${ST.cell}px; --kit-ruler: ${ST.ruler}px; --kit-col: var(--rig-col); }
.rig-face .kit-hg { display: flex; align-items: center; gap: var(--rig-u); }
.rig-face .kit-cap { ${HEADF} text-transform: uppercase; color: var(--sx-mute, #9c978a); }
.rig-face .kit-btn { position: relative; flex: none; height: var(--rig-box); margin: 0; padding: 0 var(--rig-u); border: 1px solid var(--sx-line, #2c2e32); border-radius: 4px; cursor: pointer;
  background: var(--sx-panel2, #141518); color: var(--sx-ink, #ebe6d8); ${HEADF} -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; }
.rig-face .kit-btn::after, .rig-face .kit-pat::after, .rig-face .kit-hg > .wk-nb > .wk-nbv::after, .rig-face .kit-hit::after { ${BAND} }
.rig-face .kit-clear { margin-left: auto; text-transform: uppercase; }
.rig-face .kit-pats { display: flex; flex: none; }
.rig-face .kit-pat { position: relative; flex: none; width: var(--rig-hit); height: var(--rig-box); margin: 0; padding: 0; border: 1px solid var(--sx-line, #2c2e32); border-left-width: 0; border-radius: 0; cursor: pointer;
  background: var(--sx-panel2, #141518); color: var(--sx-ink, #ebe6d8); ${HEADF} -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; }
.rig-face .kit-pat:first-child { border-left-width: 1px; border-radius: 4px 0 0 4px; }
.rig-face .kit-pat:last-child { border-radius: 0 4px 4px 0; }
.rig-face .kit-pat[data-used]::before { content: ''; position: absolute; left: calc(50% - var(--rig-margin)); bottom: 3px; width: calc(var(--rig-margin) * 2); height: 2px; border-radius: 1px; background: currentColor; opacity: 0.55; }
.rig-face .kit-pat[aria-checked="true"] { background: var(--sx-accent, #e8a33d); border-color: var(--sx-accent, #e8a33d); color: var(--sx-bg, #17181a); }
.rig-face .kit-hg > .wk-nb { position: relative; display: flex; flex-direction: row; align-items: center; min-width: 0; margin: 0; padding: 0; gap: 0; cursor: ns-resize; touch-action: none; }
.rig-face .kit-hg > .wk-nb > .wk-lab { display: none; }
.rig-face .kit-hg > .wk-nb > .wk-nbv { position: relative; display: flex; align-items: center; justify-content: center; height: var(--rig-box); min-height: 0; min-width: var(--rig-hit); padding: 0 6px;
  border: 1px solid var(--sx-line, #2c2e32); border-radius: 4px; background: var(--sx-bg, #17181a); color: var(--sx-ink, #ebe6d8); font: 600 var(--rig-f-head) / 1 var(--mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; }
.rig-face .kit-btn:focus-visible, .rig-face .kit-pat:focus-visible, .rig-face .kit-rh:focus-visible, .rig-face .kit-add:focus-visible, .rig-face .kit-hit:focus-visible { z-index: 1; outline: none; box-shadow: 0 0 0 2px var(--sx-accent, #e8a33d); }
/* the grid row: the screen (its canvas under everything), the ruler, the headers, the lamps, the hit layer and its cursor / readout, the playhead */
.rig-face .rig-kgrid { position: relative; }
.rig-face .kit-scr { position: absolute; inset: 0; border-radius: var(--rig-radius); overflow: hidden; background: var(--rig-screen, #141518); }
.rig-face .kit-cv { position: absolute; left: 0; top: 0; display: block; width: 100%; height: 100%; pointer-events: none; }
.rig-face .kit-rul { position: absolute; top: var(--rig-margin); height: var(--rig-f-lab); ${LAB} text-align: center; color: var(--sx-mute, #9c978a); pointer-events: none; }
.rig-face .kit-rh, .rig-face .kit-add { position: absolute; left: 0; display: block; margin: 0; padding: 0 var(--rig-u) 0 calc(var(--rig-u) * 2); border: 0; border-radius: 4px; background: transparent; cursor: pointer;
  text-align: left; overflow: hidden; text-overflow: ellipsis; ${LAB} line-height: var(--kit-cell); -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; }
.rig-face .kit-rh { color: var(--sx-ink, #ebe6d8); }
.rig-face .kit-rh::before { content: ''; position: absolute; left: var(--rig-margin); top: calc(50% - var(--rig-u)); width: calc(var(--rig-u) / 2); height: calc(var(--rig-u) * 2); border-radius: 2px; background: var(--kit-c, var(--sx-mute, #9c978a)); }
.rig-face .kit-rh[data-muted] { color: var(--sx-mute, #9c978a); text-decoration: line-through; }
.rig-face .kit-rh[data-muted]::before { opacity: 0.4; }
.rig-face .kit-rh[data-solo] { box-shadow: inset 0 0 0 1px var(--sx-accent, #e8a33d); }
.rig-face .kit-add { color: var(--sx-mute, #9c978a); }
.rig-face .kit-add[hidden] { display: none; }
.rig-face .kit-lamp { position: absolute; pointer-events: none; }
.rig-face .kit-lamp::before { content: ''; position: absolute; left: calc(50% - var(--rig-margin)); top: calc(50% - var(--rig-margin)); width: calc(var(--rig-margin) * 2); height: calc(var(--rig-margin) * 2); border-radius: 50%;
  background: var(--sx-line, #2c2e32); }
.rig-face .kit-lamp[data-hit="0"]::before { animation: kit-fl0 0.2s ease-out; }
.rig-face .kit-lamp[data-hit="1"]::before { animation: kit-fl1 0.2s ease-out; }
@keyframes kit-fl0 { ${FLASH} }
@keyframes kit-fl1 { ${FLASH} }
.rig-face .kit-hits { position: absolute; touch-action: none; cursor: pointer; outline: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
.rig-face .kit-cur { position: absolute; left: 0; top: 0; width: var(--rig-col); height: var(--kit-cell); border: 2px solid var(--sx-accent, #e8a33d); border-radius: var(--rig-radius); pointer-events: none; visibility: hidden; }
.rig-face .kit-cur[data-on] { visibility: visible; }
.rig-face .kit-vr { position: absolute; left: 0; top: 0; min-width: var(--rig-box-w); height: var(--rig-box); padding: 0 6px; border: 1px solid var(--sx-line, #2c2e32); border-radius: 4px; pointer-events: none;
  background: var(--sx-bg, #17181a); color: var(--sx-ink, #ebe6d8); font: 600 var(--rig-f-head) / calc(var(--rig-box) - 2px) var(--mono, ui-monospace, monospace); text-align: center; }
.rig-face .kit-vr[hidden] { display: none; }
.rig-face .kit-ph { position: absolute; top: 0; width: var(--rig-col); border-top: 3px solid var(--sx-accent, #e8a33d); pointer-events: none; visibility: hidden; will-change: transform; }
.rig-face .kit-ph::before { content: ''; position: absolute; inset: 0; background: var(--sx-accent, #e8a33d); opacity: 0.12; }
.rig-face .kit-ph[data-on] { visibility: visible; }
/* a voice face: its tint, TYPE ▾ (the head's grow item), HIT (a pad: the one music zone — touch-action none, its hit the head's 44 px band) */
.rig-face .kit-tint { flex: none; width: var(--rig-margin); height: var(--rig-box); border-radius: 3px; background: var(--kit-c, var(--sx-mute, #9c978a)); }
.rig-face .kit-hit { position: relative; flex: none; display: flex; align-items: center; justify-content: center; width: var(--rig-sw); height: var(--rig-box); border: 1px solid var(--kit-c, var(--sx-line, #2c2e32)); border-radius: 4px;
  background: var(--sx-panel2, #141518); color: var(--sx-ink, #ebe6d8); ${HEADF} cursor: pointer; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; outline: none; }
.rig-face .kit-hit[data-held] { background: var(--sx-accent, #e8a33d); border-color: var(--sx-accent, #e8a33d); color: var(--sx-bg, #17181a); }
.rig-face .kit-hit[data-hit="0"] { animation: kit-fl0 0.2s ease-out; }
.rig-face .kit-hit[data-hit="1"] { animation: kit-fl1 0.2s ease-out; }
.rig-face.kit-voice[data-muted] > .rig-row { opacity: 0.45; }
`;
/** KIT_CSS, once per document (beside rig-grid's). */
export function ensureKitCSS(doc) {
  if (!doc || typeof doc.createElement !== 'function') return;
  if (typeof doc.getElementById === 'function' && doc.getElementById(KIT_CSS_ID)) return;
  const st = doc.createElement('style');
  st.id = KIT_CSS_ID;
  st.textContent = KIT_CSS;
  (doc.head || doc.documentElement).appendChild(st);
}

/* ================================================================ the host (§4.6) */
const TYPE_ITEMS = Object.freeze(KIT.TYPES.filter(Boolean).map(T => Object.freeze({ v: T.n, label: T.label })));
const PAT_L = 'ABCDEFGH';
const SW_LO = 50, SW_HI = 75;                                  // SWING's bounds (§3.3: 50 = off)
let EMPTY = null;
const empty = () => EMPTY || (EMPTY = KC.normKit(undefined));
const bit = (m, j) => (m >> j) & 1;
// a voice's vals at its type's defaults (keep: the fields a TYPE change keeps — LEVEL and CHOKE)
function voiceVals(code, type, keep) {
  const T = KIT.TYPES[type], v = {};
  if (!keep || keep.t) v[code + 't'] = type;
  v[code + 'u'] = r2(T.u.def); v[code + 'd'] = r2(T.d.def);
  if (!keep || keep.l) v[code + 'l'] = r2(KIT.LAW.lRef);
  if (!keep) v[code + 'c'] = 0;
  T.k.forEach((L, i) => { v[code + (i + 1)] = r2(L.def); });
  return v;
}

/**
 * The drum machine's faces and their host-side geometry (§4.6). deps as the header says; every member optional but get / edit / drum.
 */
export function kitHost(deps) {
  const P = deps || {}, views = new Set();
  const docOf = () => P.doc || globalThis.document;
  const raf = f => (typeof P.raf === 'function' ? P.raf(f) : wk.frame(f));
  const barH = () => (fin(+P.barH) ? +P.barH : 0);
  const val = (t, dev, k) => { let v = NaN; try { v = typeof P.get === 'function' ? +P.get(t, dev, k) : NaN; } catch (err) { v = NaN; } return fin(v) ? v : NaN; };
  const typeOf = (t, dev, j) => { const v = val(t, dev, KIT.CODES[j] + 't'); return fin(v) ? clamp(Math.round(v), 0, KIT.TYPES.length - 1) : 0; };
  const apiOf = (t, dev) => { try { const a = typeof P.drum === 'function' ? P.drum(t, dev) : null; return a && typeof a === 'object' ? a : null; } catch (err) { return null; } };
  function recOf(t, dev) {
    try {
      if (typeof P.rec === 'function') { const r = P.rec(t, dev); if (isObj(r) && r.m === KIT.ID) return r; }
      const a = apiOf(t, dev), s = a && typeof a.state === 'function' ? a.state() : null;
      return s && isObj(s.D) && s.D.m === KIT.ID ? s.D : empty();
    } catch (err) { return empty(); }
  }
  const edit = (t, dev, label, r) => { try { return typeof P.edit === 'function' ? P.edit(t, dev, label, r) : false; } catch (err) { console.error(err); return false; } };
  const menuAt = (x, y, items, anchor) => (typeof P.menu === 'function' ? P.menu(x, y, items, { anchor }) : wk.contextMenu(x, y, items, { anchor }));
  const menuAtEl = (el, items) => { let r = null; try { r = el.getBoundingClientRect(); } catch (err) { r = null; } return menuAt(r ? r.left : 0, r ? r.bottom : 0, items, el); };
  const notice = (text, ms) => { if (typeof P.notice === 'function') P.notice(text, ms || 4000); };
  // the present voices in slot order → out (slot per row); their count
  function present(t, dev, out) { let n = 0; for (let j = 0; j < KIT.SLOTS; j++) if (typeOf(t, dev, j) > 0) { if (out) out[n] = j; n++; } return n; }
  // the 16 names: lane S's names(D), else the record's nm, else the type's label + an ordinal among the same type's present voices
  function namesOf(t, dev, D) {
    let N = null;
    try { N = KC.names(D); } catch (err) { N = null; }
    const out = [], seen = new Array(KIT.TYPES.length).fill(0);
    for (let j = 0; j < KIT.SLOTS; j++) {
      const ty = typeOf(t, dev, j), T = KIT.TYPES[ty];
      if (!T) { out.push(''); continue; }
      const k = seen[ty]++;
      const s = (N && typeof N[j] === 'string' && N[j]) || (D && Array.isArray(D.nm) && D.nm[j]) || (k ? T.label + ' ' + (k + 1) : T.label);
      out.push(s);
    }
    return out;
  }
  const keyOf = (dev, j) => dev + '/' + KIT.CODES[j];
  const slotOfKey = (dev, key) => { const s = String(key || ''); if (s.slice(0, String(dev).length + 1) !== dev + '/') return -1; return KIT.CODES.indexOf(s.slice(String(dev).length + 1)); };
  const seqModH = (t, dev) => seqH(present(t, dev)) + barH();
  const voiceModH = () => voiceH + barH();

  /** A module's size (cv-module's fixed: the bar included) — the Sequencer (key = dev) or a present voice; else null. */
  function size(t, dev, key) {
    if (key === dev) return { fixed: { w: faceW(SEQ_COLS), h: seqModH(t, dev) } };
    const j = slotOfKey(dev, key);
    return j >= 0 && typeOf(t, dev, j) > 0 ? { fixed: { w: faceW(VOICE_COLS), h: voiceModH() } } : null;
  }
  /** Tidy's places of the voices (§4.5): rows of four under the Sequencer in slot order, RACK_GAP apart — relative to its top-left. */
  function rack(t, dev) {
    const o = {}, y0 = seqModH(t, dev) + RACK_GAP, dx = faceW(VOICE_COLS) + RACK_GAP, dy = voiceModH() + RACK_GAP;
    let i = 0;
    for (let j = 0; j < KIT.SLOTS; j++) if (typeOf(t, dev, j) > 0) { o[keyOf(dev, j)] = { x: (i % RACK_ROW) * dx, y: y0 + Math.floor(i / RACK_ROW) * dy }; i++; }
    return o;
  }
  /** The track view's entries of the voices (main.js cvDevices, after the Sequencer's): one 'pm' module each. */
  function devices(t, dev) {
    const D = recOf(t, dev), N = namesOf(t, dev, D), out = [];
    for (let j = 0; j < KIT.SLOTS; j++) {
      const ty = typeOf(t, dev, j);
      if (!ty) continue;
      out.push({ key: keyOf(dev, j), kind: 'pm', dev, slot: j, code: KIT.CODES[j], type: ty, model: KIT.ID, title: N[j], sub: N[j] === KIT.TYPES[ty].label ? '' : KIT.TYPES[ty].label, color: KIT.TINT[ty],
        fixed: { w: faceW(VOICE_COLS), h: voiceModH() }, nofold: true, compact: true, jacks: [] });
    }
    return out;
  }
  /** (§6.1) A cell's box in module px from the Sequencer module's top-left (its bar included): { x, y, w, h } | null. */
  function cellRect(t, dev, lane, step) {
    if (!(Number.isInteger(lane) && lane >= 0 && lane < KIT.SLOTS && Number.isInteger(step) && step >= 0 && step < N_STEPS) || !typeOf(t, dev, lane)) return null;
    let r = 0;
    for (let j = 0; j < lane; j++) if (typeOf(t, dev, j) > 0) r++;
    return { x: GRID.pad + (HEAD_COLS + step) * COL, y: barH() + GRID.top + GRID.rows.head + GRID.gap + ST.ruler + r * ST.cell, w: COL, h: ST.cell };
  }

  /* ---------------------------------------------------------------- the heard-time plumbing both faces share */
  const offScreen = el => { for (let n = el; n && n.nodeType === 1; n = n.parentNode) if (n.hasAttribute && n.hasAttribute('data-cv-off')) return true; return false; };
  function subscribe(api, name, fn) { try { const f = api && typeof api[name] === 'function' ? api[name](fn) : null; return typeof f === 'function' ? f : () => {}; } catch (err) { return () => {}; } }
  const flip = el => el.setAttribute('data-hit', el.getAttribute('data-hit') === '1' ? '0' : '1'); // (two keyframes alternate: the flash restarts)

  /* ================================================================ the Sequencer (§4.2) */
  function seqFace(A) {
    const t = A.t, dev = A.dev, d = docOf();
    ensureRigCSS(d); ensureKitCSS(d);
    const api = apiOf(t, dev);
    const el = mk(d, 'section', 'rig-face kit-seq');
    el.setAttribute('data-rig-kind', 'kit-seq'); el.setAttribute('data-rig-variant', 'kit-seq'); el.setAttribute('data-kit', 'seq'); el.setAttribute('aria-label', 'Sequencer');
    el.style.setProperty('--rig-n', String(SEQ_COLS));
    const row = (cls, i) => { const r = mk(d, 'div', 'rig-row ' + cls); r.setAttribute('data-row', String(i)); return r; };
    const group = (cap, ...xs) => { const g = mk(d, 'div', 'kit-hg'); if (cap) g.appendChild(mk(d, 'span', 'kit-cap', cap)); g.append(...xs); return g; };
    const button = (cls, txt) => { const b = ctl(mk(d, 'button', 'kit-btn ' + cls, txt)); b.type = 'button'; return b; };
    // the head
    const head = row('rig-head', 0);
    const kitB = button('kit-kit', '');
    kitB.setAttribute('aria-haspopup', 'menu');
    const pats = mk(d, 'div', 'kit-pats');
    pats.setAttribute('role', 'radiogroup'); pats.setAttribute('aria-label', 'Pattern');
    const patB = PAT_L.split('').map((c, i) => {
      const b = ctl(mk(d, 'button', 'kit-pat', c));
      b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('data-kit', 'pat'); b.setAttribute('data-p', String(i)); b.setAttribute('aria-label', 'Pattern ' + c);
      pats.appendChild(b);
      return b;
    });
    // the state the face draws: the record, its pattern as a dense matrix, the rows
    let D = null, pat = 0, len = N_STEPS, swing = SW_LO, mute = 0, solo = 0, nRows = 0, names = [], face = null;
    let lenPend = null, swPend = null;
    const lenN = () => (lenPend != null ? lenPend : len), swN = () => (swPend != null ? swPend : swing);
    const lenBox = wk.numBox({ label: 'Length', get: () => (lenN() - 1) / (N_STEPS - 1), steps: N_STEPS - 1, def: 1, fmt: n => String(1 + Math.round(n * (N_STEPS - 1))),
      set: (n, ph) => { const v = 1 + Math.round(clamp(n, 0, 1) * (N_STEPS - 1)); if (ph === 'start') return; if (ph === 'move') { lenPend = v; return; } lenPend = null; if (v !== len) edit(t, dev, 'Length ' + v, { press: { k: 'len', n: v } }); } });
    const swBox = wk.numBox({ label: 'Swing', get: () => (swN() - SW_LO) / (SW_HI - SW_LO), steps: SW_HI - SW_LO, def: 0, fmt: n => (SW_LO + Math.round(n * (SW_HI - SW_LO))) + ' %',
      set: (n, ph) => { const v = SW_LO + Math.round(clamp(n, 0, 1) * (SW_HI - SW_LO)); if (ph === 'start') return; if (ph === 'move') { swPend = v; return; } swPend = null; if (v !== swing) edit(t, dev, 'Swing ' + v + ' %', { press: { k: 'swing', v } }); } });
    lenBox.el.setAttribute('data-kit', 'len'); swBox.el.setAttribute('data-kit', 'swing'); // ((review R2-12) their names the labels: KIT_CSS hides those, the groups' captions show
    ctl(lenBox.el); ctl(swBox.el);
    const clearB = button('kit-clear', 'Clear');
    head.append(group('Kit', kitB), group('Pattern', pats), group('Length', lenBox.el), group('Swing', swBox.el), clearB);
    // the grid row
    const gRow = row('rig-kgrid', 1), scr = mk(d, 'div', 'rig-disp kit-scr'), cv = mk(d, 'canvas', 'kit-cv');
    cv.setAttribute('aria-hidden', 'true');
    scr.appendChild(cv);
    for (let s = 0; s < N_STEPS; s += 4) { const r = mk(d, 'span', 'kit-rul', String(s + 1)); r.style.left = px((HEAD_COLS + s) * COL); r.style.width = px(COL); r.setAttribute('aria-hidden', 'true'); scr.appendChild(r); }
    const ph = mk(d, 'div', 'kit-ph');
    ph.style.left = px(HEAD_COLS * COL);
    const hits = mk(d, 'div', 'kit-hits');
    hits.style.left = px(HEAD_COLS * COL); hits.style.top = px(ST.ruler); hits.style.width = px(N_STEPS * COL);
    hits.tabIndex = 0; hits.setAttribute('role', 'group'); hits.setAttribute('aria-roledescription', 'step grid');
    const curE = mk(d, 'div', 'kit-cur'), vr = mk(d, 'span', 'kit-vr');
    vr.hidden = true; vr.setAttribute('aria-hidden', 'true'); curE.setAttribute('aria-hidden', 'true');
    hits.append(curE, vr);
    const add = ctl(mk(d, 'button', 'kit-add', '+ Add drum'));
    add.type = 'button'; add.setAttribute('data-kit', 'add'); add.setAttribute('aria-haspopup', 'menu');
    add.style.width = px(HEAD_COLS * COL); add.style.height = px(ST.cell);
    scr.append(ph, hits, add);
    gRow.appendChild(scr);
    el.append(head, gRow);

    const cellV = new Uint8Array(N_STEPS * KIT.SLOTS);           // (s · 16 + lane) → velocity of the selected pattern
    const rowSlot = new Int8Array(KIT.SLOTS), rowType = new Int8Array(KIT.SLOTS), lastV = new Uint8Array(KIT.SLOTS);
    const heads = new Map();                                     // slot → { rh, lamp, hp, swallow }
    let G = null, pend = null, cur = { row: 0, step: 0 }, kbd = false, focused = false, pd = false, quiet = false;
    let due = false, dead = false, stale = false, recDirty = false, gridDirty = false, phDirty = false, litMask = 0, step = -1;
    const aud = j => !bit(mute, j) && (!solo || bit(solo, j));
    const lastOf = j => lastV[j] || KIT.VEL.normal;
    const nameOf = j => names[j] || '';
    function header(j) {
      let H = heads.get(j);
      if (H) return H;
      const rh = ctl(mk(d, 'button', 'kit-rh')), lamp = mk(d, 'span', 'kit-lamp');
      rh.type = 'button'; rh.setAttribute('data-slot', String(j)); rh.style.width = px(HEAD_COLS * COL); rh.style.height = px(ST.cell);
      lamp.setAttribute('data-slot', String(j)); lamp.setAttribute('aria-hidden', 'true');
      lamp.style.left = px((HEAD_COLS + N_STEPS) * COL); lamp.style.width = px(COL); lamp.style.height = px(ST.cell);
      H = { rh, lamp, hp: null, swallow: false };
      // a tap mutes (its click: a finger, a mouse, Enter / Space), a long press solos (at the lift: ≥ LONG_MS within the slop), a
      // right-click (or the browser's own long-press menu) solos — one of them per press, never both
      rh.addEventListener('pointerdown', e => { if (e.button === 0 && !e.ctrlKey) H.hp = { id: e.pointerId, t: e.timeStamp, x: e.clientX, y: e.clientY, done: false }; });
      rh.addEventListener('pointerup', e => {
        const h = H.hp;
        if (!h || h.id !== e.pointerId) return;
        H.hp = null;
        if (h.done) { H.swallow = true; return; }
        if (e.timeStamp - h.t >= LONG_MS && Math.hypot(e.clientX - h.x, e.clientY - h.y) <= SLOP_PX) { H.swallow = true; soloL(j); }
      });
      rh.addEventListener('pointercancel', e => { if (H.hp && H.hp.id === e.pointerId) H.hp = null; });
      rh.addEventListener('contextmenu', e => { prevent(e); stop(e); if (H.hp) H.hp.done = true; soloL(j); });
      rh.addEventListener('click', () => { if (H.swallow) { H.swallow = false; return; } muteL(j); });
      heads.set(j, H);
      return H;
    }
    // the record and the vals → the matrix, the rows, the head; the size
    function rebuild(R) {
      D = isObj(R) && R.m === KIT.ID ? R : empty();
      pat = clamp(D.ui && D.ui.pat | 0, 0, PAT_L.length - 1);
      const Pt = (D.pat && D.pat[pat]) || { len: N_STEPS, cells: [] };
      len = clamp(Pt.len | 0, 1, N_STEPS); swing = clamp((D.x && D.x.swing) | 0, SW_LO, SW_HI); mute = (D.x && D.x.mute) | 0; solo = (D.x && D.x.solo) | 0;
      cellV.fill(0);
      for (const c of Pt.cells || []) if (c && c.l >= 0 && c.l < KIT.SLOTS && c.s >= 0 && c.s < N_STEPS) cellV[c.s * KIT.SLOTS + c.l] = clamp(c.v | 0, 0, 127);
      names = namesOf(t, dev, D);
      nRows = present(t, dev, rowSlot);
      const live = new Set();
      for (let r = 0; r < nRows; r++) {
        const j = rowSlot[r], ty = typeOf(t, dev, j), H = header(j), top = px(ST.ruler + r * ST.cell);
        rowType[r] = ty;
        live.add(j);
        if (H.rh.parentNode !== scr) scr.insertBefore(H.rh, hits);
        if (H.lamp.parentNode !== scr) scr.insertBefore(H.lamp, hits);
        if (H.rh.style.top !== top) { H.rh.style.top = top; H.lamp.style.top = top; }
        const tint = KIT.TINT[ty] || '';
        if (H.rh.style['--kit-c'] !== tint) { H.rh.style.setProperty('--kit-c', tint); H.lamp.style.setProperty('--kit-c', tint); }
        text1(H.rh, nameOf(j));
        set1(H.rh, 'data-muted', bit(mute, j) ? '' : null); set1(H.rh, 'data-solo', bit(solo, j) ? '' : null);
        set1(H.rh, 'aria-label', nameOf(j) + (bit(mute, j) ? ' (muted)' : '') + (bit(solo, j) ? ' (solo)' : '') + ': tap to mute, hold to solo');
      }
      for (const [j, H] of heads) if (!live.has(j)) { H.rh.remove(); H.lamp.remove(); heads.delete(j); }
      const full = nRows >= KIT.SLOTS;
      add.hidden = full;
      add.style.top = px(ST.ruler + nRows * ST.cell);
      const gh = gridH(nRows);
      gRow.style.height = px(gh);
      hits.style.height = px(nRows * ST.cell); ph.style.height = px(ST.ruler + nRows * ST.cell);
      face = Object.freeze({ kind: 'kit-seq', variant: 'kit-seq', cols: SEQ_COLS, w: faceW(SEQ_COLS), h: seqH(nRows) });
      // the head
      patB.forEach((b, i) => { const on = i === pat; set1(b, 'aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; set1(b, 'data-used', D.pat && D.pat[i] && D.pat[i].cells && D.pat[i].cells.length ? '' : null); });
      lenBox.update(); swBox.update();
      set1(clearB, 'aria-label', 'Clear pattern ' + PAT_L[pat]);
      let pn = '';
      try { pn = typeof P.presetName === 'function' ? String(P.presetName(t, dev) || '') : ''; } catch (err) { pn = ''; }
      text1(kitB, (pn || 'Kits') + ' ▾'); set1(kitB, 'aria-label', 'Kit: ' + (pn || 'choose one'));
      if (cur.row >= nRows) cur.row = Math.max(0, nRows - 1);
      aria();
      moveCur();
    }
    // the canvas: the cells (and a gesture's pending ones), in the skin's ink and the voices' tints
    function pendV(j, s) {
      const g = pend;
      if (!g || g.lane !== j) return -1;
      if (g.mode === 'paint') return bit(g.mask, s) ? g.v : -1;
      return s === g.s0 ? g.v : -1;
    }
    function rr(g, x, y, w, h, r) { g.beginPath(); if (typeof g.roundRect === 'function') g.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2)); else g.rect(x, y, w, h); g.fill(); }
    function paintGrid() {
      if (cv.isConnected === false) { stale = true; return; }
      const W = SEQ_COLS * COL, Hh = gridH(nRows), g = wk.fitCanvas(cv, W, Hh);
      if (!g) return;
      kitStats.grid++;
      let ink = '';
      try { const w = d.defaultView || globalThis, cs = typeof w.getComputedStyle === 'function' ? w.getComputedStyle(scr) : null; ink = cs ? String(cs.getPropertyValue('--sx-ink') || '').trim() : ''; } catch (err) { ink = ''; }
      ink = ink || '#dfe6ee';
      const IN = GRID.u / 2, RAD = GRID.radius, cw = COL - 2 * IN, ch = ST.cell - 2 * IN;
      g.clearRect(0, 0, W, Hh);
      for (let r = 0; r < nRows; r++) {
        const j = rowSlot[r], tint = KIT.TINT[rowType[r]] || ink, on = aud(j), y = ST.ruler + r * ST.cell + IN;
        for (let s = 0; s < N_STEPS; s++) {
          const x = (HEAD_COLS + s) * COL + IN, inL = s < len, pv = pendV(j, s), v = pv >= 0 ? pv : cellV[s * KIT.SLOTS + j];
          g.globalAlpha = (s % 4 ? 0.1 : 0.18) * (inL ? 1 : 0.4);      // (the screen tone, the beats lighter: the ink faint enough on every skin)
          g.fillStyle = ink;
          rr(g, x, y, cw, ch, RAD);
          if (v > 0) {
            const bh = Math.max(2, ch * v / 127);
            g.globalAlpha = (inL ? 1 : 0.35) * (on ? 1 : 0.4);
            g.fillStyle = tint;
            rr(g, x, y + ch - bh, cw, bh, RAD);
          }
        }
      }
      g.globalAlpha = 1;
    }
    // the playhead at the heard step (leds: lane S's; the host may hand its own)
    function drawPh() {
      let L = null;
      try {
        if (typeof P.leds === 'function') L = P.leds(t, dev);
        else { const s = api && typeof api.state === 'function' ? api.state() : null; L = s ? KC.leds(s.S, s.D) : null; }
      } catch (err) { L = null; }
      const s = L && fin(L.step) && L.step >= 0 && L.step < N_STEPS ? L.step | 0 : -1;
      if (s === step) return;
      if (s < 0) ph.removeAttribute('data-on');
      else { ph.style.transform = 'translateX(' + s * COL + 'px)'; if (step < 0) ph.setAttribute('data-on', ''); }
      step = s;
    }
    function frame() {
      due = false;
      if (dead) return;
      if (offScreen(el)) { stale = true; litMask = 0; return; }
      kitStats.paints++;
      if (recDirty) { recDirty = false; const R = recOf(t, dev); if (R !== D) { rebuild(R); gridDirty = true; } }
      if (gridDirty) { gridDirty = false; paintGrid(); }
      if (phDirty) { phDirty = false; drawPh(); }
      if (litMask) {
        const m = litMask;
        litMask = 0;
        for (let r = 0; r < nRows; r++) { const j = rowSlot[r]; if (bit(m, j)) { const H = heads.get(j); if (H) flip(H.lamp); } }
      }
    }
    const ask = () => { if (!due && !dead) { due = true; raf(frame); } };
    const offs = [
      subscribe(api, 'step', () => { phDirty = true; ask(); }),
      subscribe(api, 'lit', m => { if (m & 0xFFFF) { litMask |= m & 0xFFFF; ask(); } }), // ((review R2-3) the monitor's activity posts, stopped too: a zero mask asks nothing
      subscribe(api, 'on', () => { recDirty = true; phDirty = true; ask(); }),
      wk.onRescale(cv, () => { gridDirty = true; ask(); }),        // (a zoom end: the new density)
      wk.onRelease(cv, () => { gridDirty = true; ask(); }),        // (an unmounted body's canvas: drawn again when it shows)
    ];

    /* ---- the writes */
    const L0 = j => nameOf(j);
    function setCell(j, s, v, label) { if (v > 0) lastV[j] = v; edit(t, dev, label || 'Edit pattern', { press: { k: 'cell', lane: j, step: s, v } }); }
    function toggle(j, s) { const v = cellV[s * KIT.SLOTS + j]; if (v) { lastV[j] = v; setCell(j, s, 0); } else setCell(j, s, lastOf(j)); }
    function muteL(j) { edit(t, dev, (bit(mute, j) ? 'Unmute ' : 'Mute ') + L0(j), { press: { k: 'mute', lane: j } }); }
    function soloL(j) { edit(t, dev, (bit(solo, j) ? 'Unsolo ' : 'Solo ') + L0(j), { press: { k: 'solo', lane: j } }); }
    function stepMenu(j, s, x, y) {
      const v = cellV[s * KIT.SLOTS + j], it = (label, w) => ({ label, hint: w ? String(w) : '', checked: v === w, action: () => { quiet = false; setCell(j, s, w); } });
      quiet = true; // ((review R2-2) its close focuses the grid again: that focusin stops here — the canvas's reveal would pan to the grid's top)
      menuAt(x, y, [it('Soft', KIT.VEL.soft), it('Normal', KIT.VEL.normal), it('Accent', KIT.VEL.accent), { sep: true }, it('Off', 0)], hits);
    }

    /* ---- the hit layer: tap, paint, velocity, the step menu, two fingers */
    function cellAt(e) {
      const p = wk.localPoint(hits, e), s = Math.floor(p.x / COL), r = Math.floor(p.y / ST.cell);
      return r >= 0 && r < nRows && s >= 0 && s < N_STEPS ? { r, j: rowSlot[r], s } : null;
    }
    function endG() {
      const g = G;
      if (!g) return null;
      G = null;
      if (g.lp) g.lp.cancel();
      try { hits.releasePointerCapture(g.id); } catch (err) { /* released */ }
      vr.hidden = true;
      return g;
    }
    function commit(g) {
      pend = null; gridDirty = true; ask();
      if (g.mode === 'paint') {
        const steps = [];
        for (let s = 0; s < len; s++) if (bit(g.mask, s)) steps.push(s);
        if (!steps.length) return;
        if (g.v > 0) lastV[g.lane] = g.v;
        edit(t, dev, 'Edit pattern', { press: { k: 'paint', lane: g.lane, steps, v: g.v } });
      } else if (g.mode === 'vel' && g.v !== g.v0) setCell(g.lane, g.s0, g.v);
    }
    function revert() { const g = endG(); if (g) { pend = null; gridDirty = true; ask(); } }
    function showVel(g) {
      text1(vr, String(g.v));
      vr.style.transform = 'translate(' + g.s0 * COL + 'px, ' + g.r * ST.cell + 'px)';
      vr.hidden = false;
    }
    hits.addEventListener('pointerdown', e => {
      stop(e);
      pd = true; quiet = false; // (a menu closed by a press elsewhere: no restore came)
      if (kbd) { kbd = false; moveCur(); }
      if (e.button !== 0 || e.ctrlKey || G) return;
      const h = cellAt(e);
      if (!h || h.s >= len) return;                              // (past LENGTH: inert)
      prevent(e);
      try { hits.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      const v0 = cellV[h.s * KIT.SLOTS + h.j], type = e.pointerType || 'mouse';
      G = { id: e.pointerId, type, x0: e.clientX, y0: e.clientY, k: wk.localScale(hits), r: h.r, lane: h.j, s0: h.s, s: h.s, v0, v: v0, base: v0 || lastOf(h.j), mode: null, mask: 0, menu: false, lp: null };
      if (type === 'mouse' && e.shiftKey) { G.mode = 'vel'; G.v = G.base; pend = G; showVel(G); gridDirty = true; ask(); }
      else { const g = G; G.lp = wk.longPress(hits, e, () => { g.menu = true; }); }
      cur = { row: h.r, step: h.s };
    });
    hits.addEventListener('pointermove', e => {
      const g = G;
      if (!g || e.pointerId !== g.id) return;
      if (g.type === 'mouse' && e.buttons === 0) { commit(endG()); return; } // (a swallowed release)
      if (g.lp) g.lp.move(e);
      if (g.menu) return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (!g.mode) {
        if (Math.hypot(dx, dy) < DECIDE_PX) return;
        if (g.lp) { g.lp.cancel(); g.lp = null; }
        g.mode = Math.abs(dx) >= Math.abs(dy) || !g.v0 ? 'paint' : 'vel';
        if (g.mode === 'paint') { g.v = g.v0 ? 0 : lastOf(g.lane); g.mask = 1 << g.s0; }
        pend = g;
      }
      if (g.mode === 'paint') {
        const p = wk.localPoint(hits, e), s = clamp(Math.floor(p.x / COL), 0, len - 1);
        if (s === g.s) return;
        for (let i = Math.min(s, g.s); i <= Math.max(s, g.s); i++) g.mask |= 1 << i;
        g.s = s;
      } else {
        const v = clamp(Math.round(g.base + (g.y0 - e.clientY) * g.k), 1, 127);
        if (v === g.v) return;
        g.v = v;
        showVel(g);
      }
      gridDirty = true; ask();
    }, { passive: true });
    hits.addEventListener('pointerup', e => {
      pd = false;
      if (!G || e.pointerId !== G.id) return;
      const g = endG();
      if (g.menu) { pend = null; return; }                       // (the long press opened the step menu: the press is its)
      if (!g.mode) toggle(g.lane, g.s0); else commit(g);
    });
    hits.addEventListener('pointercancel', e => {
      pd = false;
      if (!G || e.pointerId !== G.id) return;
      if (e.gesture === 'two-finger') { revert(); return; }      // ((D8) a second finger: the pinch / pan takes over, nothing written)
      const g = endG();
      if (g.mode && !g.menu) commit(g); else { pend = null; gridDirty = true; ask(); }
    });
    // ((review R2-5) a second finger anywhere on the face after gesture.js's pairing window — no flagged cancel comes: the paint / drag /
    // tap reverts here, the first finger's gesture spent (its lift writes nothing); the late pinch itself does not start (IMPL-DM §12)
    el.addEventListener('pointerdown', e => { const g = G; if (!g || e.pointerId === g.id || g.menu) return; if (g.lp) { g.lp.cancel(); g.lp = null; } g.menu = true; g.mode = null; pend = null; vr.hidden = true; gridDirty = true; ask(); }, true);
    hits.addEventListener('lostpointercapture', e => { if (G && e.pointerId === G.id) { const g = endG(); if (g.mode && !g.menu) commit(g); else pend = null; } });
    hits.addEventListener('contextmenu', e => {
      prevent(e); stop(e);
      if (G) { G.menu = true; if (G.mode) { pend = null; gridDirty = true; ask(); } G.mode = null; }
      const h = cellAt(e);
      if (h && h.s < len) { cur = { row: h.r, step: h.s }; stepMenu(h.j, h.s, e.clientX, e.clientY); }
    });
    // the keyboard cursor (an element: moved by a transform, no repaint)
    function moveCur() {
      set1(curE, 'data-on', kbd && focused && nRows ? '' : null);
      const tr = 'translate(' + cur.step * COL + 'px, ' + cur.row * ST.cell + 'px)';
      if (curE.style.transform !== tr) curE.style.transform = tr;
    }
    function aria() {
      if (!nRows) { set1(hits, 'aria-label', 'Step grid: no drums — add one'); return; }
      const j = rowSlot[cur.row], v = cellV[cur.step * KIT.SLOTS + j];
      set1(hits, 'aria-label', nameOf(j) + ', step ' + (cur.step + 1) + ', ' + (v ? 'on, velocity ' + v : 'off') + (cur.step >= len ? ', past the length' : ''));
    }
    hits.addEventListener('keydown', e => {
      if (!nRows) return;
      const k = e.key, j = rowSlot[cur.row], s = cur.step, v = cellV[s * KIT.SLOTS + j], inL = s < len;
      const mv = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[k];
      if (mv) cur = { row: clamp(cur.row + mv[0], 0, nRows - 1), step: clamp(cur.step + mv[1], 0, N_STEPS - 1) };
      else if (k === ' ' || k === 'Enter') { if (inL) toggle(j, s); }
      else if (k === '+' || k === '=') { if (inL && v) setCell(j, s, clamp(v + VEL_STEP, 1, 127)); }
      else if (k === '-' || k === '_') { if (inL && v) setCell(j, s, clamp(v - VEL_STEP, 1, 127)); }
      else if (k === 'Delete' || k === 'Backspace') { if (inL && v) setCell(j, s, 0); }
      else if (k === 'm' || k === 'M') muteL(j);
      else if (k === 's' || k === 'S') soloL(j);
      else return;
      prevent(e); stop(e);                                       // (never a canvas nudge)
      kbd = true;
      moveCur(); aria();
    });
    hits.addEventListener('focusin', e => { if (quiet && e.target === hits) { quiet = false; stop(e); } });
    hits.addEventListener('focus', () => { focused = true; if (!pd) kbd = true; moveCur(); aria(); });
    hits.addEventListener('blur', () => { focused = false; moveCur(); });

    /* ---- the head and the add row */
    patB.forEach((b, i) => {
      b.addEventListener('click', () => { if (i !== pat) edit(t, dev, 'Pattern ' + PAT_L[i], { press: { k: 'pat', p: i } }); });
      b.addEventListener('keydown', e => {
        const n = patB.length, k = e.key, q = k === 'ArrowRight' || k === 'ArrowDown' ? (i + 1) % n : k === 'ArrowLeft' || k === 'ArrowUp' ? (i + n - 1) % n : k === 'Home' ? 0 : k === 'End' ? n - 1 : -1;
        if (q < 0) return;
        prevent(e); stop(e);
        if (q !== pat) edit(t, dev, 'Pattern ' + PAT_L[q], { press: { k: 'pat', p: q } });
        try { patB[q].focus({ preventScroll: true }); } catch (err) { /* no focus */ }
      });
    });
    clearB.addEventListener('click', () => edit(t, dev, 'Clear pattern ' + PAT_L[pat], { press: { k: 'clear' } }));
    kitB.addEventListener('click', () => {
      let items = null;
      try { items = typeof P.presets === 'function' ? P.presets(t, dev) : null; } catch (err) { items = null; }
      if (!Array.isArray(items)) items = KIT.KITS.map(K => ({ label: K.name, action: () => edit(t, dev, 'Load kit ' + K.name, { vals: Object.assign({}, K.v), kit: K.name }) }));
      menuAtEl(kitB, items);
    });
    add.addEventListener('click', () => menuAtEl(add, TYPE_ITEMS.map(it => ({ label: it.label, action: () => addVoice(it.v) }))));
    function addVoice(type) {
      let s = -1;
      for (let j = 0; j < KIT.SLOTS && s < 0; j++) if (!typeOf(t, dev, j)) s = j;
      if (s < 0) { notice(KIT.SLOTS + ' drums is the most'); return; }
      edit(t, dev, 'Add ' + KIT.TYPES[type].label, { vals: voiceVals(KIT.CODES[s], type), press: { k: 'voice', slot: s, op: 'add', type } });
    }

    rebuild(recOf(t, dev));
    gridDirty = true; phDirty = true; ask();
    const V = {
      el,
      get face() { return face; },
      jacks: new Map(),
      update() {},
      sync() { if (dead) return; rebuild(recOf(t, dev)); gridDirty = true; phDirty = true; ask(); },
      shown(on) { if (on !== false && !dead) { if (stale) { stale = false; recDirty = true; gridDirty = true; } phDirty = true; ask(); } },
      menuItems() {
        const out = [{ label: 'Clear all patterns', action: () => edit(t, dev, 'Clear all patterns', { press: { k: 'clearAll' } }) }];
        if (KIT.DEMO) out.push({ label: 'Demo beat', action: () => edit(t, dev, 'Demo beat', { press: { k: 'demo' } }) });
        return out;
      },
      value: () => null,
      pending: () => pend,
      cursor: () => ({ row: cur.row, step: cur.step }),
      destroy() {
        if (dead) return;
        dead = true;
        endG();
        for (const f of offs) { try { f(); } catch (err) { /* gone */ } }
        for (const w of [lenBox, swBox]) { try { w.destroy(); } catch (err) { /* gone */ } }
        el.remove();
        views.delete(V);
      },
    };
    return V;
  }

  /* ================================================================ a voice face (§4.3) */
  function voiceFace(A) {
    const t = A.t, dev = A.dev, j = clamp(A.slot | 0, 0, KIT.SLOTS - 1), code = KIT.CODES[j], d = docOf();
    ensureRigCSS(d); ensureKitCSS(d);
    const api = apiOf(t, dev), F = FACE.voice, L = layoutOf(F);
    const el = mk(d, 'section', 'rig-face kit-voice');
    el.setAttribute('data-rig-kind', 'kit-voice'); el.setAttribute('data-rig-variant', 'kit-voice'); el.setAttribute('data-kit', 'voice'); el.setAttribute('data-slot', String(j));
    el.style.setProperty('--rig-n', String(F.cols));
    const type = () => typeOf(t, dev, j), T = () => KIT.TYPES[type()] || KIT.TYPES[1];
    const lawOf = f => (f === 'u' ? T().u : f === 'd' ? T().d : f === 'l' ? LEVEL : T().k[+f - 1]);
    const knobV = f => { const v = val(t, dev, code + f), L1 = lawOf(f); return fin(v) ? clamp(v / 10, 0, 1) : L1.def; };
    const setK = (f, v, ph) => { if (ph === 'start') return; try { if (typeof P.set === 'function') P.set(t, dev, code + f, v, ph === 'move' ? 'move' : 'end'); } catch (err) { console.error(err); } };
    let names = [], D = null;
    const name = () => names[j] || T().label;
    const widgets = [];
    // the head: the tint, TYPE ▾, HIT
    const tint = mk(d, 'span', 'kit-tint');
    tint.setAttribute('aria-hidden', 'true');
    const typeM = wk.menu({ label: 'Type', arrows: false, items: () => TYPE_ITEMS, get: type, set: v => changeType(Math.round(v)), dest: () => code + 't' });
    typeM.el.classList.add('rig-grow'); typeM.el.setAttribute('data-ctl', code + 't');
    ctl(typeM.el);
    widgets.push(typeM);
    const hit = mk(d, 'div', 'kit-hit', 'HIT');
    hit.setAttribute('role', 'button'); hit.tabIndex = 0; hit.setAttribute('data-kit', 'hit'); hit.setAttribute('data-gesture', 'music');
    const pieces = { tint, type: typeM.el, hit };
    const rowsE = [];
    L.rows.forEach((rw, ri) => {
      const re = mk(d, 'div', 'rig-row rig-' + rw.t);
      re.setAttribute('data-row', String(ri));
      if (rw.t === 'head') for (const c of rw.cells) re.appendChild(pieces[c.alts[0].name]);
      else for (const c of rw.cells) {
        const ce = mk(d, 'div', 'rig-cell'), a = c.alts[0];
        ce.style.gridColumn = (c.col + 1) + ' / span ' + c.span;
        let w = null;
        if (a.name === 'c') w = wk.numBox({ label: 'Choke', get: () => { const v = val(t, dev, code + 'c'); return (fin(v) ? clamp(Math.round(v), 0, CHOKES) : 0) / CHOKES; }, steps: CHOKES, def: 0,
          fmt: n => fmtChoke(Math.round(n * CHOKES)), set: (n, ph) => setK('c', Math.round(clamp(n, 0, 1) * CHOKES), ph), dest: () => code + 'c' });
        else { const f = a.id; w = wk.knob({ label: () => lawOf(f).label, get: () => knobV(f), set: (n, ph) => setK(f, r2(clamp(n, 0, 1)), ph), def: () => lawOf(f).def,
          fmt: n => (f === 'l' ? fmtLevel(n) : fmtKnob(lawOf(f), n)), parse: x => (f === 'l' ? parseLevel(x) : parseKnob(lawOf(f), x, fmtKnob(lawOf(f), knobV(f)))), dest: () => code + f }); }
        w.el.setAttribute('data-ctl', code + (a.name === 'c' ? 'c' : a.id));
        ctl(w.el);
        widgets.push(w);
        ce.appendChild(w.el);
        re.appendChild(ce);
      }
      rowsE.push(re);
      el.appendChild(re);
    });
    const face = Object.freeze({ kind: 'kit-voice', variant: 'kit-voice', cols: F.cols, w: L.w, h: L.h });
    function changeType(v) {
      if (!KIT.TYPES[v] || v === type()) return;
      edit(t, dev, name() + ' → ' + KIT.TYPES[v].label, { vals: voiceVals(code, v, { t: true }) });
      sync();
    }
    // HIT: every finger its own hit (velocity by depth over the pad's 44 px band), the note held while any is down
    const ptrs = new Map();
    let held = 0, keyed = false, dead = false, due = false, recDirty = false, stale = false, litMask = 0;
    const padOn = (v, ts) => { held++; set1(hit, 'data-held', ''); try { if (api && api.pads) api.pads.on(code, clamp(v, 0, 1), ts); } catch (err) { console.error(err); } };
    const padOff = ts => { if (held <= 0) return; held--; if (held) return; set1(hit, 'data-held', null); try { if (api && api.pads) api.pads.off(code, ts); } catch (err) { console.error(err); } };
    hit.addEventListener('pointerdown', e => {
      stop(e);
      if (e.button !== 0 || e.ctrlKey || ptrs.has(e.pointerId)) return;
      prevent(e);
      const r = hit.getBoundingClientRect(), k = r.height > 0 && hit.offsetHeight > 0 ? r.height / hit.offsetHeight : 1, band = Math.max(GRID.hit * k, r.height), top = r.top + r.height / 2 - band / 2;
      try { hit.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      ptrs.set(e.pointerId, 1);
      padOn(padVel((e.clientY - top) / band), e.timeStamp);
    });
    const lift = e => { if (!ptrs.delete(e.pointerId)) return; padOff(e.timeStamp); };
    for (const ty of ['pointerup', 'pointercancel', 'lostpointercapture']) hit.addEventListener(ty, lift);
    hit.addEventListener('contextmenu', prevent);
    hit.addEventListener('keydown', e => { if (e.key !== ' ' && e.key !== 'Enter') return; prevent(e); stop(e); if (e.repeat || keyed) return; keyed = true; padOn(PAD_KEY_V, e.timeStamp); });
    hit.addEventListener('keyup', e => { if ((e.key === ' ' || e.key === 'Enter') && keyed) { prevent(e); keyed = false; padOff(e.timeStamp); } });
    hit.addEventListener('blur', () => { if (keyed) { keyed = false; padOff(); } });
    // the record's half: the name, the mute (a muted voice's face dims)
    function readRec() {
      D = recOf(t, dev);
      names = namesOf(t, dev, D);
      const mu = (D.x && D.x.mute) | 0, so = (D.x && D.x.solo) | 0;
      set1(el, 'data-muted', bit(mu, j) || (so && !bit(so, j)) ? '' : null);
    }
    function sync() {
      if (dead) return;
      readRec();
      const ty = type();
      el.style.setProperty('--kit-c', KIT.TINT[ty] || '');
      set1(el, 'aria-label', name());
      set1(hit, 'aria-label', name() + ': hit (velocity by where you press: the front edge loudest)');
      for (const w of widgets) if (typeof w.update === 'function') w.update();
    }
    function frame() {
      due = false;
      if (dead) return;
      if (offScreen(el)) { stale = true; litMask = 0; return; }
      kitStats.paints++;
      if (recDirty) { recDirty = false; if (recOf(t, dev) !== D) { readRec(); set1(el, 'aria-label', name()); } }
      if (litMask) { const m = litMask; litMask = 0; if (bit(m, j)) flip(hit); }
    }
    const ask = () => { if (!due && !dead) { due = true; raf(frame); } };
    const offs = [subscribe(api, 'lit', m => { litMask |= m & 0xFFFF; if (bit(litMask, j)) ask(); else litMask = 0; }), subscribe(api, 'on', () => { if (recOf(t, dev) !== D) { recDirty = true; ask(); } })]; // ((lane G finding 2) a notify a heard post: the record's identity first
    sync();
    const V = {
      el, face, jacks: new Map(),
      update() {},
      sync,
      shown(on) { if (on !== false && stale && !dead) { stale = false; recDirty = true; ask(); } },
      menuItems: () => [
        { label: 'Reset sound', action: () => { const v = voiceVals(code, type(), { l: true }); edit(t, dev, 'Reset ' + name(), { vals: v }); sync(); } },
        { label: 'Remove', action: () => edit(t, dev, 'Remove ' + name(), { vals: { [code + 't']: 0 }, press: { k: 'voice', slot: j, op: 'remove' } }) },
      ],
      value: () => null,
      destroy() {
        if (dead) return;
        dead = true;
        for (const id of [...ptrs.keys()]) { ptrs.delete(id); try { hit.releasePointerCapture(id); } catch (err) { /* released */ } }
        if (held || keyed) { held = 1; keyed = false; padOff(); }
        for (const f of offs) { try { f(); } catch (err) { /* gone */ } }
        for (const w of widgets) { try { w.destroy(); } catch (err) { /* gone */ } }
        el.remove();
        views.delete(V);
      },
    };
    return V;
  }

  /** A face of `kind` ('seq': the Sequencer, 'voice': a drum's, args.slot) mounted into root (when given) → its View. */
  function face(kind, root, args) {
    const A = args || {};
    const V = kind === 'seq' ? seqFace(A) : kind === 'voice' ? voiceFace(A) : null;
    if (!V) return null;
    views.add(V);
    if (root && typeof root.appendChild === 'function') root.appendChild(V.el);
    return V;
  }
  return {
    face, devices, size, rack, cellRect, FACE, layoutOf,
    destroy() { for (const V of [...views]) V.destroy(); },
  };
}
