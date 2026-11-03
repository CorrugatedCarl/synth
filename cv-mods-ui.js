// cv-mods-ui.js — the faces of the modulator modules (contract: docs/canvas/IMPL-2a.md §3, IMPL-2b §6.1, (MOD1) IMPL-MOD1.md §4; SPEC-canvas
// §2.10, §7.10): every modulator wears a rig face on the RIG grid (MOD1 D3). The project Mod Wheel (a vertical wheel: a drag or the
// keys set it; the "+N on other tracks" chip on its screen), Velocity (the last velocity on the default curve), Aftertouch and Bend
// (meters; Bend bipolar), CC (number, channel, Learn, a meter) and Note (the keyboard meter) are plain faces (below: MOD_FACE, no
// SerumHost); LFO, Envelope, Macros and Chaos are rig-ui's slot faces over a slot host (slotBody). Each returns {el, update(v),
// destroy()} (the wheel also setOthers(n); the editing ones sync() too); the host mounts el into the module's body (cv-module
// host.bodies.mount) and pushes live values through update — nothing here polls. Values: the wheel, velocity and aftertouch 0…1, bend
// −1…1 (main.js ctl's). Owner: WIDGETS lane (2a B, 2b C; milestone 3 B; MOD1 F).
// (milestone 3, IMPL-3 §2.2–2.3 → MOD1 §4.1) LFO, Envelope, Macros and Chaos edit through the donors a rig's own modules use
// (sx-ui-mod's LfoPanel / EnvPanel / MacrosPanel / ChaosRow) on a slot host, laid as rig-ui faces (slotBody below).
// (2b) The editing bodies take o = { doc?, get: () => the device's state (track.dev[id], plain data), edit(fields): the
// host writes the fields given (device-level keys; a nested lfo / env / chaos object is given whole, the host replaces it)
// as ONE History step (the 2a modPre / modStep glue) — called once per gesture at its end (a wk 'end' / 'set' phase, an
// input's change, a menu pick); (3) live?(fields): a gesture's moves (the first opens the step, each writes and reposts);
// cancel?(): a gesture that ended where it began after live writes; set?(k, v): a macro knob's live value per move (the
// host posts {t:'mval'}: no History, no patch); learn?(on): the CC body's Learn button arms / disarms MIDI learn; bpm?:
// () => the project tempo; (3) rows?, storage?, notify?, view?, devKey? (the module id: a numbered face's title), (MM) lock?
// (slotBody), (MOD1) shown?: () => on screen (a slot face's view: its host paints and ticks for shown views only) }. A body reads the
// state through o.get(): after an undo / redo / external edit the host calls sync(). State shapes (IMPL-2b §1.1, mirroring Serum's:
// the object serum-core normalises plus the p values):
//   lfo    { kind: 'lfo', lfo: <normLfo shape: mode, mono, bpm, dot, trip, pts, …>, rate: n }  rate = Serum's l<k>.rate n
//          (pow4 0…100 Hz; BPM-synced: the ladder index over its length − 1, as Serum's p holds it)
//   env    { kind: 'env', env: <serum-core env: bpm, legInv, stealRe>, att, hold, dec, sus, rel: n (Serum's e<k>.* laws:
//          pow5 0…32 s, sus lin), crv: [a, d, r] (0…1, 0.5 linear: Serum's e<k>.ca / cd / cr, the attack / decay / release curvature bent by 10 · (2c − 1)) }
//   macro  { kind: 'macro', v: [8 × 0…1], names: [8 × ≤ 16 chars] }
//   cc     { kind: 'cc', cc: 0…127, ch: 0 (omni) | 1…16, v: 0…1 }
//   chaos  { kind: 'chaos', chaos: <serum-core chaos: mono, sh>, rate: n (Serum's c<k>.rate: pow5 0…1000 Hz; BPM-synced:
//          the LFO_LADDER index over 14), bpm: 0 | 1, smooth: 0…1 (kept, never compiled nor shown: no Serum field) }
//   note   { kind: 'note' }
// Live values (update): lfo / env / chaos / cc a value 0…1 (the lfo also { v, ph, y, out } — the phase dot and the PATH
// playhead; the env { v, stage, t } — the playhead); note the last MIDI note (0…127, null = none).
// (LC, IMPL-LC §7) the Combiner (combBody): a plain face of its own on the RIG grid, 6 columns — Mode / Window / Marks, the whole-bar
// screen (lc-view, imported on demand like the slot faces), the input list (the IN's cord picker), IN Σ (a drop target, no registered
// jack) and OUT; its view on ModCore's combine / preview (the page's DSP scripts: wk.loadDSP when not there yet).
// Rules: plain ES module, no DOM at module top level, survives tests/main-sim.mjs's DOM stub; imports carry ?v=9 (the
// slot faces' modules are imported on demand: the app's boot graph stays without them; rig-grid.js is a leaf).
// iPad: the wheel's screen is touch-action: none (MOD_CSS) and ends its drag on a pointercancel (a second finger:
// gesture.js) or a lost capture; listeners are passive where they never prevent.
import * as wk from './wk.js?v=9';
import { GRID, rowH, faceW, layoutOf, ensureRigCSS, deepFreeze } from './rig-grid.js?v=9';

/** The wheel's thumb height (px). */
export const THUMB = 26;
/** The wheel's keyboard steps (of 127): arrows, Page Up / Down. */
export const STEP = 1, PAGE = 16;

const SVG = 'http://www.w3.org/2000/svg';
const fin = x => typeof x === 'number' && isFinite(x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const docOf = o => (o && o.doc) || globalThis.document;
const mk = (d, tag, cls, txt) => { const e = d.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const svgEl = (d, tag, attrs) => { const e = d.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const listen = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); return () => t.removeEventListener(type, fn, opt); };
const read = (o, def) => { let v = def; try { v = typeof o.get === 'function' ? +o.get() : def; } catch (err) { v = def; } return fin(v) ? v : def; };
const set1 = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
const text1 = (el, t) => { if (el.textContent !== t) el.textContent = t; };
const pct = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.round(Math.abs(v) * 100) + '%';
const numOf = id => { const m = /(\d+)$/.exec(String(id || '')); return m ? +m[1] : 0; };

/* ================================================================ (MOD1 §4.2) the plain faces: the RIG grid without a SerumHost */
// The six plain modulators wear the rig face as the FX panels do (fx-ui, the FX look): rig-grid's numbers (GRID, layoutOf, faceW,
// its CSS) and rig-ui's markup — section.rig-face[data-rig-kind], .rig-row / .rig-cell, a screen's .rig-disp, the jack row's
// span.rig-jack.cv-jack.cv-fjack[data-jack="out"] (cv-module's inline anchor, as a rig face's) with its label. MOD_FACE the recipes
// (columns = cv-mods MOD_COLS, MOD1 §2.3): a large screen (the meter, the curve, the keyboard, the wheel: four of them fill the grid's band
// only at its 128 px), CC's knob row, the jack row. Their screens' pieces: MOD_CSS (sizes from the grid's properties, colours the
// skin's display tokens). ≤ 48 elements each (G5); update(v) change-gated (no layout read; nothing written for the same value).
const R = (t, items, h) => ({ t, h: rowH(t, h), items });
/** (MOD1 §4.2) The plain faces' recipes (rig-grid layoutOf's shape; frozen). */
export const MOD_FACE = deepFreeze({
  wheel: { cols: 3, rows: [R('screen', ['#wheel'], 'L'), R('jacks', ['>out'])] }, // ((MOD1 review 2) the wheel, Aftertouch, Bend 3 columns: their bar's title whole
  velo: { cols: 3, rows: [R('screen', ['#meter'], 'L'), R('jacks', ['>out'])] },
  at: { cols: 3, rows: [R('screen', ['#meter'], 'L'), R('jacks', ['>out'])] },
  bend: { cols: 3, rows: [R('screen', ['#meter'], 'L'), R('jacks', ['>out'])] },
  note: { cols: 3, rows: [R('screen', ['#meter'], 'L'), R('jacks', ['>out'])] },
  cc: { cols: 3, rows: [R('screen', ['#meter'], 'L'), R('knobs', ['#cc', '#ch', '#learn']), R('jacks', ['>out'])] },
});
export const MOD_CSS_ID = 'rig-mods-css';
const LAB = 'font: 600 var(--rig-f-lab) / var(--rig-lab) var(--rig-font, var(--ui, system-ui, sans-serif)); letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap;';
/** The plain faces' screen pieces (one place; injected once per document, beside rig-grid's). */
export const MOD_CSS = `
/* cv-mods-ui.js — the modulators' plain faces (MOD1 §4.2): the screens' pieces; the grid's custom properties, the skin's display tokens */
.rig-face .rig-mscr { display: flex; align-items: stretch; gap: var(--rig-u); padding: var(--rig-u); color: var(--sxd-ink, #dfe6ee); }
.rig-face .rig-mscr.rig-mcol { flex-direction: column; justify-content: center; }
.rig-face .rig-mread { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
.rig-face .rig-mval { font: 600 18px / 22px var(--mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; color: var(--sxd-ink, #dfe6ee); white-space: nowrap; }
.rig-face .rig-mlab { ${LAB} color: var(--sxd-mute, #7f8b98); }
.rig-face .rig-mbar { position: relative; flex: none; width: calc(2 * var(--rig-margin)); border-radius: var(--rig-margin); overflow: hidden;
  background: var(--sxd-bg, #0a0d10); box-shadow: inset 0 0 0 1px var(--sxd-grid, #2a333d); }
.rig-face .rig-mfill { position: absolute; left: 0; right: 0; bottom: 0; height: 0; background: var(--sxd-wave, #59c2ff); }
.rig-face .rig-mbi > .rig-mfill { bottom: auto; }
.rig-face .rig-mmid { position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: var(--sxd-mute, #7f8b98); }
.rig-face .rig-mcurve { flex: none; align-self: center; width: calc(var(--rig-row-screenL) - 4 * var(--rig-u)); height: calc(var(--rig-row-screenL) - 4 * var(--rig-u)); overflow: visible; }
.rig-face .rig-mframe { fill: none; stroke: var(--sxd-grid, #2a333d); stroke-width: 1; }
.rig-face .rig-mcrv { fill: none; stroke: var(--sxd-mute, #7f8b98); stroke-width: 2; }
.rig-face .rig-mdrop { fill: none; stroke: var(--sxd-wave, #59c2ff); stroke-width: 1; stroke-dasharray: 3 3; }
.rig-face .rig-mdot { fill: var(--sxd-wave, #59c2ff); }
.rig-face .rig-mkeys { display: block; width: 100%; height: calc(5 * var(--rig-u)); flex: none; }
.rig-face .rig-mwhite { fill: var(--sxd-ink, #dfe6ee); stroke: var(--sxd-bg, #0a0d10); stroke-width: 0.4; }
.rig-face .rig-mblack { fill: var(--sxd-bg, #0a0d10); }
.rig-face .rig-mkeyon { fill: var(--sxd-wave, #59c2ff); }
.rig-face .rig-mread.rig-mrow { flex: none; flex-direction: row; align-items: baseline; gap: var(--rig-u); }
/* the wheel: the whole screen takes the press (touch-action: none); the slider's slot and ribbed thumb; the chip on the screen */
.rig-face .rig-mpress { touch-action: none; cursor: ns-resize; -webkit-user-select: none; user-select: none; }
.rig-face .rig-mw { position: relative; flex: none; display: flex; justify-content: center; width: var(--rig-box-w); border-radius: var(--rig-radius); outline: none; }
.rig-face .rig-mw:focus-visible { box-shadow: 0 0 0 2px var(--sx-accent, #e8a33d); }
.rig-face .rig-mw-slot { position: relative; width: calc(4 * var(--rig-u)); border-radius: var(--rig-radius); overflow: hidden; background: var(--sxd-bg, #0a0d10); box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.6), inset 0 0 0 1px var(--sxd-grid, #2a333d); }
.rig-face .rig-mw-thumb { position: absolute; left: 3px; right: 3px; height: ${THUMB}px; border-radius: 4px; border: 1px solid var(--sxd-grid, #2a333d);
  background: repeating-linear-gradient(0deg, var(--sxd-mute, #7f8b98) 0 1px, var(--sxd-bg, #0a0d10) 1px 3px); }
.rig-face .rig-mw.rig-on .rig-mw-thumb { border-color: var(--sxd-wave, #59c2ff); }
.rig-face .rig-mothers { position: relative; margin-top: var(--rig-u); height: calc(var(--rig-box) - var(--rig-u)); padding: 0 calc(var(--rig-u) / 2); border-radius: var(--rig-box); cursor: pointer;
  border: 1px solid var(--sxd-grid, #2a333d); background: var(--sxd-bg, #0a0d10); color: var(--sxd-ink, #dfe6ee); font: 600 var(--rig-f-val) / 1 var(--rig-font, var(--ui, system-ui, sans-serif)); white-space: nowrap; -webkit-tap-highlight-color: transparent; }
.rig-face .rig-mothers[hidden] { display: none; }
.rig-face .rig-mothers::before { content: ''; position: absolute; left: 50%; top: 50%; width: 100%; height: var(--rig-hit); transform: translate(-50%, -50%); }
/* CC: the number (the grid's box), the channel (a menu over its caption), Learn (lit while listening) */
.rig-face .rig-cell > .rig-mlearn { position: relative; flex: none; margin-top: var(--rig-box-top); width: var(--rig-sw); height: var(--rig-box); padding: 0 2px; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--sx-line, #2c2e32); background: var(--sx-bg, #17181a); color: var(--sx-ink, #ebe6d8); font: 600 var(--rig-f-sw) / 1 var(--rig-font, var(--ui, system-ui, sans-serif)); white-space: nowrap; overflow: hidden; -webkit-tap-highlight-color: transparent; }
.rig-face .rig-cell > .rig-mlearn::after { content: ''; position: absolute; left: 50%; top: 50%; width: 100%; height: var(--rig-hit); transform: translate(-50%, -50%); }
.rig-face .rig-cell > .rig-mlearn.rig-on { background: var(--sx-accent, #e8a33d); border-color: var(--sx-accent, #e8a33d); color: var(--rig-face, #1f2023); animation: rig-mblink 1s steps(2, start) infinite; }
.rig-face .rig-mlearn:focus-visible, .rig-face .rig-mothers:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--sx-accent, #e8a33d); }
@keyframes rig-mblink { to { opacity: 0.55; } }
.cv-mod[data-cv-off] .rig-mlearn.rig-on { animation: none; }
/* (LC §7) the Combiner: the head's two picks (Mode, Window: 2 columns each) and Marks (the rest); the screen's two canvases (the curves,
   the overlay above them: no press); the input list — a 32 px line each (the head row's height), name over 3 columns (its cord's colour
   dot), amount over 2, MUTE over 1, every box the grid's 28 px with its hit the line's band (no line steals the next one's press); the IN
   socket's count beside it (the stacked jack's chip, lines canvases) */
.rig-face .rig-cseg { flex: none; display: flex; width: calc(2 * var(--rig-col) - var(--rig-u)); height: var(--rig-box); }
.rig-face .rig-cseg > button, .rig-face .rig-cmark { position: relative; min-width: 0; height: var(--rig-box); margin: 0; border: 1px solid var(--sx-line, #2c2e32); cursor: pointer;
  background: var(--sx-panel2, #141518); color: var(--sx-ink, #ebe6d8); font: 600 var(--rig-f-head) / 1 var(--rig-font, var(--ui, system-ui, sans-serif)); white-space: nowrap; -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; }
.rig-face .rig-cseg > button { flex: 1 1 auto; padding: 0 6px; border-left-width: 0; border-radius: 0; }
.rig-face .rig-cwin > button { flex: 1 1 0; padding: 0; }
.rig-face .rig-cseg > button:first-child { border-left-width: 1px; border-radius: 4px 0 0 4px; }
.rig-face .rig-cseg > button:last-child { border-radius: 0 4px 4px 0; }
.rig-face .rig-cseg > button[aria-checked="true"], .rig-face .rig-cmute[aria-pressed="true"] { background: var(--sx-accent, #e8a33d); border-color: var(--sx-accent, #e8a33d); color: var(--sx-bg, #17181a); }
.rig-face .rig-cmark { flex: 1 1 auto; padding: 0 8px; border-radius: 4px; text-align: left; overflow: hidden; text-overflow: ellipsis; }
.rig-face .rig-cseg > button::after, .rig-face .rig-cmark::after { content: ''; position: absolute; left: 0; top: calc((var(--rig-box) - var(--rig-hit)) / 2 - 1px); width: 100%; height: var(--rig-hit); }
/* (review 2 R2-4, the lead) the Window's four picks are ≈ 30 px wide in their two columns: their hit is their own box (full height 44 on touch) —
   four 44 px bands would have to skew off the boxes (the outer picks' centres on a band edge: the right half of ½ picking 1), so the §7.1
   width rule is refined for this segment (IMPL-LC §17 fix round K; the layout harness asks the box's width of them) */
/* (review 2 R2-4) Marks ellipsizes (overflow: hidden clips its own ::after): its 44 px band is the head row's ::before over its two columns,
   under it (Marks and the Window's bands on top); a press or a tap there is Marks' (combBody forwards it) */
.rig-face[data-rig-kind="comb"] > .rig-head::before { content: ''; position: absolute; right: 0; width: calc(2 * var(--rig-col) - var(--rig-u)); top: calc((var(--rig-row-head) - var(--rig-hit)) / 2); height: var(--rig-hit); cursor: pointer; }
.rig-face .rig-cseg > button:focus-visible, .rig-face .rig-cmark:focus-visible, .rig-face .rig-cline > :focus-visible { z-index: 1; outline: none; box-shadow: 0 0 0 2px var(--sx-accent, #e8a33d); }
.rig-face .rig-cscr > canvas { position: absolute; left: 0; top: 0; display: block; width: 100%; height: 100%; }
.rig-face .rig-cscr > .rig-cov { pointer-events: none; }
.rig-face .rig-cline { position: relative; display: grid; grid-template-columns: repeat(var(--rig-n), var(--rig-col)); align-items: center; height: var(--rig-row-head); border-radius: 4px; }
.rig-face .rig-cline > * { position: relative; box-sizing: border-box; min-width: 0; height: var(--rig-box); margin: 0 calc(var(--rig-u) / 2); border: 1px solid var(--sx-line, #2c2e32); border-radius: 4px;
  color: var(--sx-ink, #ebe6d8); -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; }
.rig-face .rig-cline > ::after { content: ''; position: absolute; left: -1px; top: calc((var(--rig-box) - var(--rig-row-head)) / 2 - 1px); width: calc(100% + 2px); height: var(--rig-row-head); }
.rig-face .rig-cname { grid-column: 1 / span 3; display: block; padding: 0 8px 0 22px; border-color: transparent; background: transparent; cursor: pointer; text-align: left;
  font: 600 var(--rig-f-head) / calc(var(--rig-box) - 2px) var(--rig-font, var(--ui, system-ui, sans-serif)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rig-face .rig-cname::before { content: ''; position: absolute; left: 8px; top: calc(50% - 4px); width: 8px; height: 8px; border-radius: 50%; background: var(--rig-cc, var(--sx-mute, #9c978a)); }
.rig-face .rig-capx { margin-left: var(--rig-margin); color: var(--sx-mute, #9c978a); }
.rig-face .rig-camt { grid-column: 4 / span 2; display: flex; align-items: center; justify-content: center; background: var(--sx-bg, #17181a); cursor: ns-resize; touch-action: none; outline: none;
  font: 600 var(--rig-f-lab) / 1 var(--mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; -webkit-user-select: none; user-select: none; }
.rig-face .rig-camt > input { width: 100%; height: 100%; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: center; outline: none; }
.rig-face .rig-cmute { grid-column: 6 / span 1; padding: 0; background: var(--sx-panel2, #141518); cursor: pointer; ${LAB} font-size: var(--rig-f-sw); }
.rig-face .rig-cline[data-muted] > .rig-cname { color: var(--sx-mute, #9c978a); }
.rig-face .rig-cline[data-left] > * { opacity: 0.45; }
.rig-face .rig-cline.rig-hl { box-shadow: inset 0 0 0 1px var(--sx-accent, #e8a33d); }
.rig-face .rig-chint { display: block; height: var(--rig-row-head); padding: 0 8px; font: 500 var(--rig-f-head) / var(--rig-row-head) var(--rig-font, var(--ui, system-ui, sans-serif)); color: var(--sx-mute, #9c978a); white-space: nowrap; }
.rig-face .rig-cn { position: absolute; z-index: 4; left: calc(50% + var(--rig-jack) / 2 + var(--rig-margin)); top: calc(var(--rig-jack-top) + var(--rig-jack) / 2); transform: translateY(-50%);
  box-sizing: border-box; min-width: 1.4em; height: 1.4em; padding: 0 0.28em; border-radius: 0.7em; font: 600 var(--rig-f-jack) / 1.4 var(--rig-font, var(--ui, system-ui, sans-serif));
  font-variant-numeric: tabular-nums; text-align: center; white-space: nowrap; color: color-mix(in srgb, var(--rig-title, #ebe6d8) 75%, var(--rig-case, #17181a)); background: var(--rig-case, #17181a);
  box-shadow: 0 0 0 1px var(--rig-line, #2c2e32); pointer-events: none; -webkit-user-select: none; user-select: none; }
`;
/** The plain faces' CSS, once per document (beside rig-grid's). */
export function ensureModCSS(doc) {
  if (!doc || typeof doc.createElement !== 'function') return;
  if (typeof doc.getElementById === 'function' && doc.getElementById(MOD_CSS_ID)) return;
  const st = doc.createElement('style');
  st.id = MOD_CSS_ID;
  st.textContent = MOD_CSS;
  (doc.head || doc.documentElement).appendChild(st);
}
// the face of `kind` laid from its recipe: pieces[name] → an element (or a list) for each '#name' → { el, rows: [row elements], jacks }
function plainFace(d, kind, title, pieces) {
  ensureRigCSS(d); ensureModCSS(d);
  const F = MOD_FACE[kind], L = layoutOf(F), el = mk(d, 'section', 'rig-face'), rows = [], jacks = new Map();
  el.setAttribute('data-rig-kind', kind);
  el.setAttribute('data-rig-variant', kind);
  el.setAttribute('aria-label', title);
  el.style.setProperty('--rig-n', String(F.cols));
  const put = (box, name) => { const p = pieces[name]; if (p) box.append(...(Array.isArray(p) ? p : [p])); };
  L.rows.forEach((row, ri) => {
    const re = mk(d, 'div', 'rig-row rig-' + row.t);
    re.setAttribute('data-row', String(ri));
    if (row.t === 'screen') { re.setAttribute('data-h', F.rows[ri].h === GRID.rows.screenL ? 'L' : 'S'); for (const c of row.cells) put(re, c.alts[0].name); }
    else for (const c of row.cells) {
      const ce = mk(d, 'div', 'rig-cell');
      ce.style.gridColumn = (c.col + 1) + ' / span ' + c.span;
      if (c.jack) {
        const je = mk(d, 'span', 'rig-jack cv-jack cv-fjack'), name = title + ' · ' + c.jack.port.toUpperCase();
        je.setAttribute('data-jack', c.jack.port);
        je.setAttribute('data-rig-dir', c.jack.dir);
        je.setAttribute('data-rig-sig', 'mod');
        je.setAttribute('data-cv-awake', ''); // (cv-module's inline anchor: as a rig face's jack)
        je.setAttribute('aria-label', name);
        je.title = name;
        jacks.set(c.jack.port, je);
        ce.append(je, mk(d, 'span', 'rig-jl', c.jack.port.toUpperCase()));
      } else put(ce, c.alts[0].name);
      re.appendChild(ce);
    }
    rows.push(re);
    el.appendChild(re);
  });
  return { el, rows, jacks, face: Object.freeze({ kind, variant: kind, cols: F.cols, w: faceW(F.cols), h: L.h }) };
}
// a screen's frame (.rig-disp, its content a flex row; col: a column) — a meter's role and name on it
const screen = (d, col, role, label) => { const s = mk(d, 'div', 'rig-disp rig-mscr' + (col ? ' rig-mcol' : '')); if (role) { s.setAttribute('role', role); s.setAttribute('aria-label', label); } return s; };
// the value readout: [box, value, label]
const readout = (d, label, cls) => { const rd = mk(d, 'div', 'rig-mread' + (cls ? ' ' + cls : '')), val = mk(d, 'span', 'rig-mval'), lab = mk(d, 'span', 'rig-mlab', label); rd.append(val, lab); return [rd, val, lab]; };
// a level bar (bi: bipolar, a centre line) → [bar, fill]
const levelBar = (d, bi) => { const bar = mk(d, 'div', 'rig-mbar' + (bi ? ' rig-mbi' : '')), fill = mk(d, 'div', 'rig-mfill'); bar.append(fill); if (bi) bar.append(mk(d, 'div', 'rig-mmid')); return [bar, fill]; };

/**
 * The Mod Wheel's face: its screen is the wheel — the slider (div.rig-mw[role=slider], 0…127: its slot and ribbed thumb), its value
 * and the "+N on other tracks" chip (button.rig-mothers, hidden at 0) — a tap: o.onJump(chip) (the host lists them at it).
 * A press anywhere on the screen (the face's first child) moves the thumb under the pointer and o.set(v) follows the drag (each move; a
 * two-finger cancel puts the value from before the press back); arrows ±1/127, Page Up / Down ±16/127, Home 0, End 1. update(v) from
 * the host (a MIDI wheel, the other on-screen wheel, the selected track's lane in playback) redraws without calling set — ignored while
 * a drag runs.
 * @param {{get?: () => number, set?: (v: number) => void, onJump?: (chip: HTMLElement) => void, doc?: Document, label?: string}} o
 * @returns {{el: HTMLElement, update: (v: number) => void, setOthers: (n: number) => void, value: () => number, destroy: () => void}}
 */
export function wheelBody(o) {
  const O = o || {}, d = docOf(O), title = O.label || 'Mod Wheel';
  const scr = screen(d), w = mk(d, 'div', 'rig-mw'), slot = mk(d, 'div', 'rig-mw-slot'), th = mk(d, 'div', 'rig-mw-thumb');
  slot.append(th);
  w.append(slot);
  w.setAttribute('role', 'slider'); w.tabIndex = 0;
  w.setAttribute('aria-label', title); w.setAttribute('aria-orientation', 'vertical');
  w.setAttribute('aria-valuemin', '0'); w.setAttribute('aria-valuemax', '127');
  const [rd, val] = readout(d, 'Mod'), oth = mk(d, 'button', 'rig-mothers');
  oth.type = 'button'; oth.hidden = true;
  rd.append(oth);
  scr.append(w, rd);
  const F = plainFace(d, 'wheel', title, { wheel: scr }), el = F.el, press = F.rows[0];
  press.classList.add('rig-mpress');
  let v = clamp(read(O, 0), 0, 1), drag = null, others = 0, dead = false;
  function draw() {
    const t = `calc(${(1 - v).toFixed(4)} * (100% - ${THUMB}px))`;
    if (th.style.top !== t) th.style.top = t;
    const n = String(Math.round(v * 127));
    set1(w, 'aria-valuenow', n);
    text1(val, n);
  }
  const put = nv => { nv = clamp(nv, 0, 1); if (!fin(nv)) return; v = nv; draw(); if (typeof O.set === 'function') O.set(v); };
  function at(e) { // the pointer's value: the thumb's centre under it (the slot's screen rect: any zoom)
    const r = slot.getBoundingClientRect(), lh = +slot.offsetHeight || 0, s = lh > 0 && r.height > 0 ? r.height / lh : 1, t = THUMB * s;
    return r.height > t ? 1 - (e.clientY - r.top - t / 2) / (r.height - t) : v;
  }
  function end() {
    if (!drag) return;
    const D = drag;
    drag = null;
    for (const f of D.offs) f();
    try { press.releasePointerCapture(D.id); } catch (err) { /* released */ }
    w.classList.remove('rig-on');
  }
  const offs = [
    listen(press, 'pointerdown', e => { // (the whole screen takes the press: wider than the slot at small zooms)
      if (drag || e.button !== 0 || e.ctrlKey) return; // (right / Ctrl-click: a menu could swallow the release)
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation(); // (a control: never the world's press)
      try { press.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      drag = { id: e.pointerId, type: e.pointerType || 'mouse', offs: [], v0: v };
      const mv = ev => { if (!drag || ev.pointerId !== drag.id) return; if (drag.type === 'mouse' && ev.buttons === 0) { end(); return; } put(at(ev)); };
      // (U3) two fingers win: their cancel (gesture.js, flagged) takes the press's jump and the drag back
      const fin2 = ev => { if (!drag || ev.pointerId !== drag.id) return; const v0 = drag.v0, back = ev.type === 'pointercancel' && ev.gesture === 'two-finger'; end(); if (back && v0 !== v) put(v0); };
      drag.offs.push(listen(press, 'pointermove', mv, { passive: true }), listen(press, 'pointerup', fin2), listen(press, 'pointercancel', fin2), listen(press, 'lostpointercapture', fin2));
      w.classList.add('rig-on');
      put(at(e));
      try { w.focus({ preventScroll: true }); } catch (err) { /* no focus */ }
    }),
    listen(press, 'contextmenu', e => { if (e.preventDefault) e.preventDefault(); }),
    listen(press, 'keydown', e => { // (the slider's keys bubble here; canvas-2a-sim presses them on the face's first child)
      if (e.target === oth) return; // (the chip's own: Enter / Space tap it)
      const k = e.key, s = (k === 'ArrowUp' || k === 'ArrowRight') ? STEP : (k === 'ArrowDown' || k === 'ArrowLeft') ? -STEP : k === 'PageUp' ? PAGE : k === 'PageDown' ? -PAGE : 0;
      if (s) put(Math.round(v * 127 + s) / 127);
      else if (k === 'Home') put(0);
      else if (k === 'End') put(1);
      else return;
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation(); // (never a canvas nudge)
    }),
    listen(oth, 'pointerdown', e => { if (e.stopPropagation) e.stopPropagation(); }),
    listen(oth, 'click', e => { if (e.stopPropagation) e.stopPropagation(); if (typeof O.onJump === 'function') O.onJump(oth); }), // (U14: the list at the chip)
  ];
  draw();
  return {
    el, face: F.face, jacks: F.jacks,
    update(nv) { if (drag || !fin(nv)) return; const c = clamp(nv, 0, 1); if (c !== v) { v = c; draw(); } },
    setOthers(n) {
      others = fin(n) && n > 0 ? Math.round(n) : 0;
      oth.hidden = !others;
      const s = others === 1 ? '' : 's', t = others ? '+' + others + ' on other track' + s : '';
      text1(oth, others ? '+' + others + ' track' + s : '');
      oth.title = others ? t + ' — tap to list them' : '';
      if (others) oth.setAttribute('aria-label', t + ': list them'); else oth.removeAttribute('aria-label');
    },
    others: () => others,
    value: () => v,
    dragging: () => !!drag,
    destroy() { if (dead) return; dead = true; end(); for (const f of offs) f(); el.remove(); },
  };
}

// a curve [[x, y], …] (0…1, x ascending) at x; the default (no points): the diagonal (Serum's DIAG, the velocity default)
function curveAt(pts, x) {
  if (!Array.isArray(pts) || pts.length < 2) return x;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (x <= x1) return x1 > x0 ? y0 + (y1 - y0) * (x - x0) / (x1 - x0) : y1;
  }
  return pts[pts.length - 1][1];
}
const okPts = p => Array.isArray(p) && p.length >= 2 && p.every(q => Array.isArray(q) && fin(q[0]) && fin(q[1]));
/**
 * Velocity's face: on its screen the curve (svg.rig-mcurve: the default diagonal, or o.curve [[x, y], …] 0…1) with the last velocity
 * marked on it (a dot and a drop line), a level bar and its value (1…127). update(v): v 0…1 (velocity / 127).
 * @param {{get?: () => number, curve?: Array<[number, number]>, doc?: Document}} o
 * @returns {{el: HTMLElement, update: (v: number) => void, value: () => number, destroy: () => void}}
 */
export function veloBody(o) {
  const O = o || {}, d = docOf(O), pts = okPts(O.curve) ? O.curve.map(q => [clamp(q[0], 0, 1), clamp(q[1], 0, 1)]) : null;
  const scr = screen(d, false, 'meter', 'Last velocity');
  scr.setAttribute('aria-valuemin', '0'); scr.setAttribute('aria-valuemax', '127');
  const sv = svgEl(d, 'svg', { class: 'rig-mcurve', viewBox: '0 0 100 100', 'aria-hidden': 'true', preserveAspectRatio: 'none' });
  const P = pts || [[0, 0], [1, 1]];
  const path = svgEl(d, 'path', { class: 'rig-mcrv', d: P.map((q, i) => (i ? 'L ' : 'M ') + Math.round(q[0] * 1000) / 10 + ' ' + Math.round((1 - q[1]) * 1000) / 10).join(' ') });
  const drop = svgEl(d, 'path', { class: 'rig-mdrop', d: 'M 0 100 V 100' }), dot = svgEl(d, 'circle', { class: 'rig-mdot', cx: '0', cy: '100', r: '4' });
  sv.append(svgEl(d, 'rect', { class: 'rig-mframe', x: '0', y: '0', width: '100', height: '100' }), path, drop, dot);
  const [bar, fill] = levelBar(d), [rd, val] = readout(d, 'Vel');
  scr.append(sv, bar, rd);
  const F = plainFace(d, 'velo', 'Velocity', { meter: scr }), el = F.el;
  let v = -1;
  function update(nv) {
    if (!fin(nv)) return;
    const c = clamp(nv, 0, 1);
    if (c === v) return;
    v = c;
    const x = Math.round(v * 1000) / 10, y = Math.round((1 - curveAt(pts, v)) * 1000) / 10, n = String(Math.round(v * 127));
    dot.setAttribute('cx', String(x)); dot.setAttribute('cy', String(y));
    drop.setAttribute('d', 'M ' + x + ' 100 V ' + y);
    fill.style.height = x + '%';
    text1(val, n);
    set1(scr, 'aria-valuenow', n);
  }
  update(clamp(read(O, 0), 0, 1));
  return { el, face: F.face, jacks: F.jacks, update, value: () => v, destroy() { el.remove(); } };
}

// a level meter face (Aftertouch: 0…1 from the bottom; Bend: −1…1 from the centre, up = up)
function levelBody(o, kind, title, label, short, bi) {
  const O = o || {}, d = docOf(O), scr = screen(d, false, 'meter', label);
  scr.setAttribute('aria-valuemin', bi ? '-100' : '0'); scr.setAttribute('aria-valuemax', bi ? '100' : '127');
  const [bar, fill] = levelBar(d, bi), [rd, val] = readout(d, short);
  scr.append(bar, rd);
  const F = plainFace(d, kind, title, { meter: scr }), el = F.el;
  let v = NaN;
  function update(nv) {
    if (!fin(nv)) return;
    const c = bi ? clamp(nv, -1, 1) : clamp(nv, 0, 1);
    if (c === v) return;
    v = c;
    if (bi) { const a = Math.round(Math.abs(c) * 500) / 10; fill.style.top = (c > 0 ? 50 - a : 50) + '%'; fill.style.height = a + '%'; }
    else fill.style.height = Math.round(c * 1000) / 10 + '%';
    const t = bi ? (c ? pct(c) : '0') : String(Math.round(c * 127));
    text1(val, t);
    set1(scr, 'aria-valuenow', bi ? String(Math.round(c * 100)) : t);
  }
  update(bi ? clamp(read(O, 0), -1, 1) : clamp(read(O, 0), 0, 1));
  return { el, face: F.face, jacks: F.jacks, update, value: () => v, destroy() { el.remove(); } };
}
/** Aftertouch's face: a level bar (0…1, from the bottom) and its value (0…127). @param {{get?: () => number, doc?: Document}} o */
export function atBody(o) { return levelBody(o, 'at', 'Aftertouch', 'Aftertouch', 'AT', false); }
/** Bend's face: a bipolar bar (−1…1, from the centre) and its value (−100 %…+100 %). @param {{get?: () => number, doc?: Document}} o */
export function bendBody(o) { return levelBody(o, 'bend', 'Bend', 'Pitch bend', 'Bend', true); }

/* ================================================================ (2b) the editing bodies' frame */
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const call = (f, ...a) => { try { return typeof f === 'function' ? f(...a) : undefined; } catch (err) { console.error(err); return undefined; } };
const stateOf = o => { const v = call(o.get); return isObj(v) ? v : {}; };
const n01 = (v, d) => (fin(v) ? clamp(v, 0, 1) : d);
const stop = e => { if (e.stopPropagation) e.stopPropagation(); };
// the editing bodies' common frame: pending values override the state until the gesture ends (one o.edit per gesture)
function editor(o) {
  const O = o || {}, d = docOf(O), pend = new Map();
  const st = () => stateOf(O);
  const val = (k, def) => (pend.has(k) ? pend.get(k) : st()[k] === undefined ? def : st()[k]);
  const live = (k, v) => pend.set(k, v); // a move: shown, not written
  const E = { after: null }; // after: the body's sync (its widgets follow its own edit at once, before the host's sync)
  const commit = fields => { for (const k of Object.keys(fields)) pend.delete(k); call(O.edit, fields); call(E.after); };
  const widgets = [];
  const keep = w => { widgets.push(w); return w; };
  const syncAll = () => { for (const w of widgets) if (w && typeof w.update === 'function') w.update(); };
  return Object.assign(E, { O, d, st, val, live, commit, keep, widgets, syncAll, pend,
    destroyAll(el) { for (const w of widgets) if (w && typeof w.destroy === 'function') try { w.destroy(); } catch (err) { /* gone */ } widgets.length = 0; el.remove(); } });
}

/* ================================================================ (MOD1 §4.1) LFO, Envelope, Macros, Chaos: rig-ui's slot faces */
// The LFO, Envelope, Macros and Chaos modules are rig-ui faces (slot: true) on a slot host (sx-host slotHost: a SerumHost over a
// synthetic Serum state with the device in one slot — LFO 1, ENV 2 (START / END), macros 1–8, chaos 1), over the donors a rig's
// own modules use (LfoPanel / EnvPanel / MacrosPanel / ChaosRow): the same bindings, one History step per gesture end (o.edit), o.live
// per move when the host gives it (the sound follows the drag), o.cancel for a rollback, o.set(k, v) per macro knob move; view edits
// (zoom, LOCK, grid, tool) stay in the module (o.view); every control data-nomod (a modulator's knob takes no cable; the host's opts).
// The modules are loaded on the first such body (the app loads them lazily: main.js uiLoad); a body made before they arrive fills in
// when they do (ready()).
let SX = null, SXP = null;
/** The slot faces' modules ({ host: sx-host.js, mod: sx-ui-mod.js, rig: rig-ui.js }), loaded once; resolves when they are there. */
export function ready() {
  if (!SXP) SXP = Promise.all([import('./sx-host.js?v=9'), import('./sx-ui-mod.js?v=9'), import('./rig-ui.js?v=9')]).then(([host, mod, rig]) => { SX = { host, mod, rig }; return SX; });
  return SXP;
}
/** (milestone 3) The modulator kinds whose body is a slot host's face. */
export const SLOT_KINDS = Object.freeze(['lfo', 'env', 'macro', 'chaos']);
// the face kind and the slot host's part of each (sx-host SLOT: LFO 1, ENV 2, macros, chaos 1)
const SLOT_FACE = Object.freeze({ lfo: ['lfo', 'lfo1'], env: ['env', 'env2'], macro: ['macros', 'macros'], chaos: ['chaos', 'chaos1'] });
/**
 * The body of an LFO / Envelope / Macros / Chaos module: rig-ui's face over a slot host. o = { doc?, get: () => the device record,
 * edit(fields) (one History step), live?(fields), cancel?(), set?(k, v) (macro knob moves), bpm?(), rows?: { count, bypassed,
 * bypass(on), remove } (its ⋯ menu's Bypass / Remove All Destinations), storage?, notify?, view? (kept by the host per module: zoom,
 * grid, tool), devKey? (the module id: the face's number), lock?: { mono: 1 } (MM, IMPL-MM §7.2: the master's LFO / Chaos have no notes
 * — their MONO switch shows GLOBAL, disabled; a presentation, the host forces the field too), heardFrame?(), sampleRate?() (FR Cut B
 * §4.4: forwarded to the slot host), shown?() (MOD1 §4.3: the face's view — an off-screen one stops its host's tick and paints) }.
 * → { el, update(v), sync(), menuItems(), host(), view(), value(), knobs(), destroy() };
 * update(v): the monitor — a level, or { v, ph, y, out } (an LFO's phase dot / PATH playhead), { v, stage, t } (an Envelope's
 * playhead), each with F (the audio frame of a fast post: into the host's ring, shown at the heard frame); a macro body ignores it
 * (its knobs show the values). host(): the slot host (Cut B's bodyAns / bodyReset read its ring); view(): the face's View.
 * @param {'lfo'|'env'|'macro'|'chaos'} kind
 */
export function slotBody(kind, o) {
  const O = o || {}, d = docOf(O), el = mk(d, 'div', 'cv-mface');
  let H = null, V = null, dead = false, pend = null;
  el.setAttribute('data-slot-kind', kind);
  const build = () => {
    if (dead || H || !SX) return;
    H = SX.host.slotHost(kind, { get: O.get, live: O.live, edit: O.edit, cancel: O.cancel, set: kind === 'macro' ? O.set : undefined, bpm: O.bpm,
      rows: O.rows, storage: O.storage, notify: O.notify, view: O.view, devKey: O.devKey, lock: O.lock, doc: d,
      heardFrame: O.heardFrame, sampleRate: O.sampleRate });   // ((FR Cut B §4.4) an update with F: read at the heard frame)
    const [face, part] = SLOT_FACE[kind];
    V = SX.rig.rigHost({}).face(face, el, { host: H, part, slot: true, dev: O.devKey, shown: O.shown });
    if (pend !== null) H.live(pend);
  };
  if (SX) build(); else ready().then(build, err => console.error('cv-mods-ui: the slot faces', err));
  return {
    el,
    update(v) { if (kind === 'macro' || v == null) return; if (H) H.live(v); else pend = v; },
    sync() { if (H) H.sync(); },
    menuItems: () => (V ? V.menuItems() : []),
    host: () => H,
    view: () => V,
    // (the 2b body API kept) the last monitor level; a macro body's eight knob elements
    value: () => (H ? H.liveV : NaN),
    knobs: () => (V && V.donor && Array.isArray(V.donor.knobs) ? V.donor.knobs.slice() : []),
    destroy() { if (dead) return; dead = true; if (H) H.destroy(); el.remove(); },
  };
}
/** (2b → MOD1) The LFO body: its face (LFO 1 of its slot host). */
export function lfoBody(o) { return slotBody('lfo', o); }
/** (2b → MOD1) The Envelope body: its face in ENV 2's variant (START / END; the curves 0…1, 0.5 linear). */
export function envBody(o) { return slotBody('env', o); }
/** (2b → MOD1) The Macros body: its face, 4 × 2 (names ≤ 16; each name tile is its jack k1…k8). */
export function macroBody(o) { return slotBody('macro', o); }
/** (2b → MOD1) The Chaos body: its face (its scope, S&H, BPM · RATE · MONO; the 2b smooth knob is gone: never compiled). */
export function chaosBody(o) { return slotBody('chaos', o); }

/**
 * (2b → MOD1) The CC face: the value meter on its screen; the knob row — the controller number (a numBox 0…127), the channel (Omni /
 * 1…16), Learn (button.rig-mlearn: o.learn(on) arms the host's MIDI learn; setLearn(on) from the host when it lands or is cancelled);
 * update(v) 0…1. Titled by its module id (o.devKey 'c3' → "CC 3").
 * @param {{get: () => object, edit: (fields: object) => void, learn?: (on: boolean) => void, doc?: Document, devKey?: string}} o
 */
export function ccBody(o) {
  const E = editor(o), d = E.d, n = numOf(E.O.devKey);
  const ccOf = () => { const c = E.val('cc', 1); return fin(c) ? clamp(Math.round(c), 0, 127) : 1; };
  const chOf = () => { const c = E.val('ch', 0); return fin(c) ? clamp(Math.round(c), 0, 16) : 0; };
  const num = E.keep(wk.numBox({ label: 'CC', get: () => ccOf() / 127, def: 1 / 127, steps: 127, fmt: v => String(Math.round(v * 127)),
    set: (v, ph) => { const c = Math.round(n01(v, 0) * 127); if (ph === 'end' || ph === 'set') E.commit({ cc: c }); else E.live('cc', c); } }));
  const ch = E.keep(wk.menu({ label: 'Channel', arrows: false, items: () => [{ v: 0, label: 'Omni' }].concat(Array.from({ length: 16 }, (_, i) => ({ v: i + 1, label: 'Ch ' + (i + 1) }))),
    get: chOf, set: v => E.commit({ ch: clamp(Math.round(v), 0, 16) }) }));
  const learn = mk(d, 'button', 'rig-mlearn', 'Learn'); learn.type = 'button'; learn.setAttribute('aria-pressed', 'false');
  learn.title = 'Arm MIDI learn: the next controller received becomes this module’s';
  let armed = false;
  const setLearn = on => { armed = !!on; set1(learn, 'aria-pressed', armed ? 'true' : 'false'); learn.classList.toggle('rig-on', armed); text1(learn, armed ? 'Listening…' : 'Learn'); };
  learn.addEventListener('pointerdown', stop);
  learn.addEventListener('click', () => { setLearn(!armed); call(E.O.learn, armed); });
  const scr = screen(d, false, 'group', 'MIDI CC'), [bar, fill] = levelBar(d), [rd, val] = readout(d, 'Val');
  scr.append(bar, rd);
  const F = plainFace(d, 'cc', n ? 'CC ' + n : 'CC', { meter: scr, cc: num.el, ch: [ch.el, mk(d, 'span', 'rig-cap', 'CHANNEL')], learn }), el = F.el;
  let v = NaN;
  function update(nv) { if (!fin(nv)) return; const c = clamp(nv, 0, 1); if (c === v) return; v = c; fill.style.height = Math.round(c * 1000) / 10 + '%'; text1(val, String(Math.round(c * 127))); }
  function sync() { E.syncAll(); const s = E.st(); if (fin(s.v) && !fin(v)) update(s.v); }
  E.after = sync;
  sync();
  if (!fin(v)) update(0);
  return { el, face: F.face, jacks: F.jacks, update, sync, setLearn, armed: () => armed, value: () => v, destroy() { E.destroyAll(el); } };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// (MOD1 review 2) a piano's two octaves from a C (128 keys in 192 px read as a barcode): 14 white keys WW wide, 10 black ones BW wide on the
// white keys' boundaries; pitch class → its white key (WX) or the boundary its black key sits on (BX)
const WIN = 24, WW = 10, BW = 6, KW = 14 * WW, KH = 40, BH = KH * 0.6, LO0 = 48; // (C3 … B4: middle C inside)
const WX = [0, -1, 1, -1, 2, 3, -1, 4, -1, 5, -1, 6], BX = [-1, 1, -1, 2, -1, -1, 4, -1, 5, -1, 6, -1];
const keyPaths = () => [0, 1].map(b => { let s = ''; for (let i = 0; i < WIN; i++) { const o = Math.floor(i / 12) * 7, p = i % 12; if (b ? BX[p] >= 0 : WX[p] >= 0) s += b ? 'M' + ((o + BX[p]) * WW - BW / 2) + ' 0h' + BW + 'v' + BH + 'h-' + BW + 'Z' : 'M' + (o + WX[p]) * WW + ' 0h' + WW + 'v' + KH + 'h-' + WW + 'Z'; } return s; });
const KEYS = keyPaths(); // (an octave-aligned window: the same two paths wherever it stands)
/**
 * (2b → MOD1) The Note face: a keyboard meter of the last note on its screen (svg.rig-mkeys: two octaves from a C — its lowest note
 * data-lo —, the last note's key lit: a white one under the black keys, a black one over them) and its name; the window follows the
 * notes, an octave-aligned step only when one falls outside it (below: down to its octave; above: its octave the upper one).
 * update(n): a MIDI note 0…127 (null / NaN: none). ≤ 48 elements: two paths and two marks.
 * @param {{get?: () => object, doc?: Document}} o
 */
export function noteBody(o) {
  const O = o || {}, d = docOf(O), scr = screen(d, true, 'meter', 'Last note');
  scr.setAttribute('aria-valuemin', '0'); scr.setAttribute('aria-valuemax', '127');
  const [wp, bp] = KEYS;
  const sv = svgEl(d, 'svg', { class: 'rig-mkeys', viewBox: `0 0 ${KW} ${KH}`, 'aria-hidden': 'true', preserveAspectRatio: 'none', 'data-lo': String(LO0) });
  const mw = svgEl(d, 'rect', { class: 'rig-mkeyon', x: '0', y: '0', width: String(WW), height: String(KH), display: 'none' });
  const mb = svgEl(d, 'rect', { class: 'rig-mkeyon', x: '0', y: '0', width: String(BW), height: String(BH), display: 'none' });
  sv.append(svgEl(d, 'path', { class: 'rig-mwhite', d: wp }), mw, svgEl(d, 'path', { class: 'rig-mblack', d: bp }), mb);
  const [rd, val] = readout(d, 'Note', 'rig-mrow');
  text1(val, '—');
  scr.append(sv, rd);
  const F = plainFace(d, 'note', 'Note', { meter: scr }), el = F.el;
  let v = null, lo = LO0;
  const off = m => { if (!m.hasAttribute('display')) m.setAttribute('display', 'none'); };
  function update(n) {
    if (n == null || !fin(n)) { if (v !== null) { v = null; off(mw); off(mb); text1(val, '—'); scr.removeAttribute('aria-valuenow'); } return; }
    const k = clamp(Math.round(n), 0, 127);
    if (k === v) return;
    v = k;
    if (k < lo || k >= lo + WIN) { lo = 12 * Math.floor(k / 12) - (k >= lo + WIN ? 12 : 0); set1(sv, 'data-lo', String(lo)); }
    const i = k - lo, o = Math.floor(i / 12) * 7, p = i % 12, b = BX[p] >= 0, m = b ? mb : mw;
    set1(m, 'x', String(b ? (o + BX[p]) * WW - BW / 2 : (o + WX[p]) * WW));
    if (m.hasAttribute('display')) m.removeAttribute('display');
    off(b ? mw : mb);
    text1(val, NOTE_NAMES[k % 12] + (Math.floor(k / 12) - 1));
    set1(scr, 'aria-valuenow', String(k));
  }
  return { el, face: F.face, jacks: F.jacks, update, sync() {}, value: () => v, destroy() { el.remove(); } };
}
/* ================================================================ (LC §7) the Combiner: its face and its whole-bar view */
// Several LFOs on ONE input (IN Σ: its cords stacked, a discreet count), their combined waveform over a window of the song's beat grid
// on the screen (lc-view, loaded on demand beside the face: the boot graph as it was), OUT the sum the knob gets. The list is the IN's
// cord picker: a line per input row (its cord's colour, its name, its amount, MUTE; a tap on the name: Mute / Unplug / Select the cord).
const CMB_LINE = GRID.rows.head;                              // (a list line: the head row's 32 px — no new number)
const CMB_WIN = Object.freeze([0.5, 1, 2, 4]), CMB_WLAB = Object.freeze(['½', '1', '2', '4']);
const CMB_MODES = Object.freeze([['add', 'Add'], ['mul', 'Multiply']]);
const CMB_WHY = Object.freeze({ slots: 'The track runs 10 LFOs' }); // (a left input's reason, IMPL-LC §7.1)
/** (LC review R2-5, the lead) The list's tints: a line's dot and its faint curve by its place in the list (the cords keep their own colours),
 * eight hues apart from every skin's sum (--sxd-wave), each ≥ 3 : 1 on the charcoal / glass screens and the ivory screen and face. */
export const CMB_TINT = Object.freeze(['#e0533d', '#b07a10', '#2a8f4c', '#9b5fd6', '#128a84', '#d6528f', '#5a6fe0', '#7a8618']);
const RECIPES = new Map();
/** (LC §7.1) The Combiner's recipe at n inputs (rig-grid layoutOf's shape; frozen, one per n): the head (Mode · Window · Marks), the large
 * screen, the input list (32 px a line, one at least: the hint), the jack row (IN Σ at the left, OUT at the right). */
export function combRecipe(n) {
  const k = Math.max(1, n | 0);
  let F = RECIPES.get(k);
  if (!F) RECIPES.set(k, (F = deepFreeze({ cols: 6, rows: [R('head', ['#mode', '#win', '#marks*']), R('screen', ['#scr'], 'L'), { t: 'list', h: CMB_LINE * k, items: ['#list'] }, R('jacks', ['<in', '>out'])] })));
  return F;
}
/** (LC §7.1) The recipe at its one line (no input: the hint). */
export const CMB_FACE = combRecipe(0);
/** (LC review R2-2) The face's height at n inputs (layout px: the host makes room under it by the difference). */
export const combFaceH = n => layoutOf(combRecipe(n)).h;
let LV = null, LVP = null, DSPP = null;
const viewMod = () => { if (!LVP) LVP = import('./lc-view.js?v=9').then(m => (LV = m)); return LVP; };
// the page's DSP scripts (ModCore: combine, preview): there already, else loaded once (the panels' way)
const dsp = () => { if (globalThis.ModCore) return Promise.resolve(globalThis.ModCore); if (!DSPP) DSPP = wk.loadDSP().then(r => (r && r.ModCore) || globalThis.ModCore || null, () => null); return DSPP; };
const sameMark = (a, b) => (a == null || b == null ? a == null && b == null : a.t === b.t && (a.n | 0) === (b.n | 0));
/**
 * (LC §7.2) The Combiner's face. o = { doc?, devKey (its id: "Combiner n"), shown(), get: () => the device ({ kind, mode, win, mark }),
 * edit(fields) (mode / win / mark: one History step), heardFrame(), sampleRate(), song() → { bpm, sig, playing, tick, cursor, loop, start?,
 * pass? } (one reused object), inputs() → [{ row, src, l, name, color, amt, byp, why, apx }] (the IN's rows in t.mods order; why: left,
 * apx: the "≈" reason), setAmt(row, v, phase) ('move' live, 'end' the step), setMute(row, on), unplug(row), select(row), payload() (the
 * track's last posted payload | null), marks(t0, t1) → ticks, markList() → [{ value, label }], cords?() (a cords canvas: the cord layer
 * counts the IN) } → { el, face, jacks (OUT; the IN is no registered jack: inJack), inJack, update({ F, cb, i }), sync(), menuItems(),
 * value(), highlight(row), view(), ready(), destroy() }.
 */
export function combBody(o) {
  const O = o || {}, d = docOf(O), nId = numOf(O.devKey), title = 'Combiner' + (nId ? ' ' + nId : '');
  ensureRigCSS(d); ensureModCSS(d);
  const el = mk(d, 'section', 'rig-face');
  el.setAttribute('data-rig-kind', 'comb'); el.setAttribute('data-rig-variant', 'comb'); el.setAttribute('aria-label', title);
  el.style.setProperty('--rig-n', '6');
  const row = (t, i) => { const r = mk(d, 'div', 'rig-row rig-' + t); r.setAttribute('data-row', String(i)); return r; };
  const ctl = e => { e.addEventListener('pointerdown', stop); e.addEventListener('contextmenu', e2 => { if (e2.preventDefault) e2.preventDefault(); }); return e; }; // (a control: never the world's press)
  // the head: Mode, Window (radio groups, one tab stop each: the arrows move the pick), Marks (a menu)
  const head = row('head', 0);
  const seg = (label, c2, items) => {
    const s = mk(d, 'div', 'rig-cseg ' + c2);
    s.setAttribute('role', 'radiogroup'); s.setAttribute('aria-label', label);
    const bs = items.map(([t, aria]) => { const b = ctl(mk(d, 'button', '', t)); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', aria); s.appendChild(b); return b; });
    return [s, bs];
  };
  const [modeS, modeB] = seg('Mode', 'rig-cmode', CMB_MODES.map(m => [m[1], m[1]]));
  const [winS, winB] = seg('Window', 'rig-cwin', CMB_WLAB.map((t, i) => [t, t + (CMB_WIN[i] > 1 ? ' bars' : ' bar')]));
  modeS.title = 'Add: the sum, clipped flat at 100 % · Multiply: each input a gain at its depth';
  winS.title = 'Window: how much of the song the screen shows';
  const mark = ctl(mk(d, 'button', 'rig-cmark'));
  mark.type = 'button'; mark.setAttribute('aria-haspopup', 'menu');
  head.append(modeS, winS, mark);
  // (review 2 R2-4) the head row's band round Marks (its ::before: Marks clips its own) is Marks' — never the world's press
  const atMark = e => { if (e.target !== head) return false; const r = mark.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right; };
  head.addEventListener('pointerdown', e => { if (atMark(e)) stop(e); });
  head.addEventListener('click', e => { if (atMark(e)) mark.click(); });
  // the screen: the curves and the overlay (lc-view's)
  const sRow = row('screen', 1), scr = mk(d, 'div', 'rig-disp rig-cscr'), cvC = mk(d, 'canvas', 'rig-ccv'), cvO = mk(d, 'canvas', 'rig-cov');
  sRow.setAttribute('data-h', 'L');
  scr.setAttribute('role', 'img'); scr.setAttribute('aria-label', 'Combined waveform');
  cvC.setAttribute('aria-hidden', 'true'); cvO.setAttribute('aria-hidden', 'true');
  scr.append(cvC, cvO); sRow.appendChild(scr);
  // the list
  const list = row('list', 2);
  list.setAttribute('role', 'list'); list.setAttribute('aria-label', 'Inputs');
  // the jacks: IN Σ (a drop target of the modulation drag — [data-dest="in"] under the module's [data-dev]: no registered jack), OUT
  const jr = row('jacks', 3), cIn = mk(d, 'div', 'rig-cell'), cOut = mk(d, 'div', 'rig-cell');
  cIn.style.gridColumn = '1 / span 1'; cOut.style.gridColumn = '6 / span 1';
  const IN = mk(d, 'span', 'rig-jack cv-fjack rig-cin'), OUT = mk(d, 'span', 'rig-jack cv-jack cv-fjack');
  IN.setAttribute('data-dest', 'in'); IN.setAttribute('data-rig-dir', 'in'); IN.setAttribute('data-rig-sig', 'mod'); IN.setAttribute('role', 'button'); IN.tabIndex = 0;
  IN.setAttribute('aria-label', title + ' · IN Σ'); IN.title = 'any number of LFO cords';
  OUT.setAttribute('data-jack', 'out'); OUT.setAttribute('data-rig-dir', 'out'); OUT.setAttribute('data-rig-sig', 'mod'); OUT.setAttribute('data-cv-awake', '');
  OUT.setAttribute('aria-label', title + ' · OUT'); OUT.title = title + ' · OUT';
  cIn.append(IN, mk(d, 'span', 'rig-jl', 'IN Σ')); cOut.append(OUT, mk(d, 'span', 'rig-jl', 'OUT'));
  jr.append(cIn, cOut);
  el.append(head, sRow, list, jr);
  const jacks = new Map([['out', OUT]]);
  let face = null, nLines = -1, hint = null, chip = null, V = null, clk = null, dead = false, hl = null, offR = null;
  const lines = new Map(), pend = new Map();                   // row → its line; row → an amount shown ahead of the host (a gesture)
  const get0 = f => { try { return typeof f === 'function' ? f() : undefined; } catch (err) { console.error(err); return undefined; } }; // (no rest array: the frame's reads)
  const NODEV = Object.freeze({});
  const dev = () => { const v = get0(O.get); return isObj(v) ? v : NODEV; };
  const inputs = () => { const I = get0(O.inputs); return Array.isArray(I) ? I : []; };
  const liveInputs = () => { const I = inputs(); return pend.size ? I.map(x => (x && pend.has(x.row) ? Object.assign({}, x, { amt: pend.get(x.row) }) : x)) : I; };
  const shownNow = () => !dead && get0(O.shown) !== false;
  const modeOf = D => (D.mode === 'mul' ? 'mul' : 'add'), winOf = D => (CMB_WIN.includes(D.win) ? D.win : 1);
  function pick(k, v) {
    const D = dev();
    if ((k === 'mode' ? modeOf(D) : winOf(D)) === v) return;
    call(O.edit, { [k]: v });
    sync();
  }
  const radio = (bs, vals, k) => bs.forEach((b, i) => {
    b.addEventListener('click', () => pick(k, vals[i]));
    b.addEventListener('keydown', e => {
      const n = bs.length, j = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
      if (j < 0) return;
      if (e.preventDefault) e.preventDefault();
      stop(e);
      pick(k, vals[j]);
      try { bs[j].focus({ preventScroll: true }); } catch (err) { /* no focus */ }
    });
  });
  radio(modeB, CMB_MODES.map(m => m[0]), 'mode');
  radio(winB, CMB_WIN, 'win');
  const markLabel = m => { if (m == null) return 'Off'; const L = call(O.markList) || [], it = L.find(x => x && sameMark(x.value, m)); return it ? it.label : String(m.t || 'Off'); };
  const menuAt = (b, items) => { const r = b.getBoundingClientRect(); wk.contextMenu(r.left, r.bottom, items, { anchor: b }); };
  mark.addEventListener('click', () => {
    const D = dev(), L = call(O.markList) || [{ value: null, label: 'Off' }];
    menuAt(mark, L.map(x => ({ label: x.label, checked: sameMark(x.value, D.mark), action: () => { if (!sameMark(x.value, dev().mark)) { call(O.edit, { mark: x.value == null ? null : Object.assign({}, x.value) }); sync(); } } })));
  });
  /* ------------------------------------------------ the list's lines */
  function makeLine(r) {
    const L = { row: r, x: null, label: null, apx: null, v: NaN, drag: null, box: null };
    const e = mk(d, 'div', 'rig-cline'), name = ctl(mk(d, 'button', 'rig-cname')), amt = ctl(mk(d, 'span', 'rig-camt')), mute = ctl(mk(d, 'button', 'rig-cmute', 'Mute'));
    e.setAttribute('data-row', r); e.setAttribute('role', 'listitem');
    name.type = 'button'; name.setAttribute('aria-haspopup', 'menu');
    amt.setAttribute('role', 'spinbutton'); amt.tabIndex = 0; amt.setAttribute('aria-label', 'Amount'); amt.setAttribute('aria-valuemin', '-100'); amt.setAttribute('aria-valuemax', '100');
    mute.type = 'button';
    e.append(name, amt, mute);
    Object.assign(L, { el: e, name, amt, mute });
    name.addEventListener('click', () => {
      const x = L.x || {};
      menuAt(name, [{ label: x.byp ? 'Unmute' : 'Mute', action: () => call(O.setMute, r, !x.byp) }, { label: 'Unplug', action: () => call(O.unplug, r) }, { label: 'Select the cord', action: () => call(O.select, r) }]);
    });
    mute.addEventListener('click', () => call(O.setMute, r, !(L.x && L.x.byp)));
    // the amount: a vertical drag (1 % a layout px, Shift ×0.1; 'move' live, one 'end'), keys (an end each), typed (Enter)
    const cur = () => (pend.has(r) ? pend.get(r) : L.x && fin(+L.x.amt) ? clamp(+L.x.amt, -1, 1) : 0);
    const put = (v, ph) => { v = clamp(Math.round(v * 100) / 100, -1, 1) + 0; pend.set(r, v); paintAmt(L, v); call(O.setAmt, r, v, ph); recombine(); };
    const end = (back) => {
      const D = L.drag;
      if (!D) return;
      L.drag = null;
      for (const f of D.offs) f();
      try { amt.releasePointerCapture(D.id); } catch (err) { /* released */ }
      if (back) put(D.v0, 'end'); else if (D.moved) put(D.v, 'end');
    };
    amt.addEventListener('pointerdown', e2 => {
      if (L.drag || L.box || e2.button !== 0 || e2.ctrlKey) return;
      if (e2.preventDefault) e2.preventDefault();
      try { amt.setPointerCapture(e2.pointerId); } catch (err) { /* gone */ }
      try { amt.focus({ preventScroll: true }); } catch (err) { /* no focus */ }
      const v0 = cur(), D = { id: e2.pointerId, y0: e2.clientY, v0, v: v0, moved: false, k: wk.localScale(amt), offs: [] };
      L.drag = D;
      const mv = ev => {
        if (L.drag !== D || ev.pointerId !== D.id) return;
        if ((ev.pointerType || 'mouse') === 'mouse' && ev.buttons === 0) { end(false); return; }
        const v = clamp(Math.round((D.v0 + (D.y0 - ev.clientY) * D.k * (ev.shiftKey ? 0.001 : 0.01)) * 100) / 100, -1, 1) + 0;
        if (v === D.v) return;
        D.v = v; D.moved = true;
        put(v, 'move');
      };
      const fin2 = ev => { if (L.drag !== D || ev.pointerId !== D.id) return; end(ev.type === 'pointercancel' && ev.gesture === 'two-finger'); }; // ((U3) two fingers: back)
      D.offs.push(listen(amt, 'pointermove', mv, { passive: true }), listen(amt, 'pointerup', fin2), listen(amt, 'pointercancel', fin2), listen(amt, 'lostpointercapture', fin2));
    });
    amt.addEventListener('keydown', e2 => {
      if (L.box) return;
      const k = e2.key, s = k === 'ArrowUp' || k === 'ArrowRight' ? 0.01 : k === 'ArrowDown' || k === 'ArrowLeft' ? -0.01 : k === 'PageUp' ? 0.1 : k === 'PageDown' ? -0.1 : 0;
      if (s) put(cur() + s, 'end');
      else if (k === 'Home') put(-1, 'end');
      else if (k === 'End') put(1, 'end');
      else if (k === 'Enter') typeIn(L, cur, put);
      else return;
      if (e2.preventDefault) e2.preventDefault();
      stop(e2);                                                  // (never a canvas nudge)
    });
    amt.addEventListener('dblclick', () => { if (!L.box) typeIn(L, cur, put); });
    L.end = end;
    return L;
  }
  // typing an amount (Enter / a double-click): a box in place of the text, Enter / leaving it sets it, Escape keeps the old one
  function typeIn(L, cur, put) {
    const box = mk(d, 'input', '');
    box.type = 'text'; box.setAttribute('inputmode', 'decimal'); box.setAttribute('aria-label', 'Amount (%)');
    box.value = String(Math.round(cur() * 100));
    L.amt.textContent = '';
    L.amt.appendChild(box);
    L.box = box;
    let done = false;
    const close = ok => {
      if (done) return;
      done = true;
      const t = String(box.value).replace(/[−–]/g, '-').replace(/[%+\s]/g, ''), v = +t;
      L.box = null; box.remove();
      paintAmt(L, cur(), true);
      if (ok && t !== '' && fin(v)) put(v / 100, 'end');
      try { L.amt.focus({ preventScroll: true }); } catch (err) { /* no focus */ }
    };
    box.addEventListener('keydown', e => { stop(e); if (e.key === 'Enter') { if (e.preventDefault) e.preventDefault(); close(true); } else if (e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); close(false); } });
    box.addEventListener('blur', () => close(true));
    box.addEventListener('pointerdown', stop);
    try { box.focus({ preventScroll: true }); if (box.select) box.select(); } catch (err) { /* no focus */ }
  }
  function paintAmt(L, v, force) {
    if (L.box || (v === L.v && !force)) return;
    L.v = v;
    const t = pct(v);
    text1(L.amt, t);
    set1(L.amt, 'aria-valuenow', String(Math.round(v * 100))); set1(L.amt, 'aria-valuetext', t);
  }
  function paintLine(L, x) {
    L.x = x;
    const label = String(x.name || x.row), apx = typeof x.apx === 'string' ? x.apx : '';
    if (label !== L.label || apx !== L.apx) {
      L.label = label; L.apx = apx;
      L.name.textContent = label;
      if (apx) { const s = mk(d, 'span', 'rig-capx', '≈'); s.title = apx; s.setAttribute('aria-label', apx); L.name.appendChild(s); }
      set1(L.name, 'aria-label', label + (apx ? ' — ' + apx : '') + ': Mute, Unplug, Select the cord');
    }
    if (L.name.style['--rig-cc'] !== x.color && typeof L.name.style.setProperty === 'function') L.name.style.setProperty('--rig-cc', typeof x.color === 'string' ? x.color : '');
    if (!L.drag) paintAmt(L, pend.has(x.row) ? pend.get(x.row) : fin(+x.amt) ? clamp(+x.amt, -1, 1) : 0);
    set1(L.mute, 'aria-pressed', x.byp ? 'true' : 'false');
    const mt = x.byp ? 'Unmute ' + label : 'Mute ' + label;
    if (L.mute.title !== mt) L.mute.title = mt;
    const why = x.why ? CMB_WHY[x.why] || String(x.why) : '';
    if (why) { set1(L.el, 'data-left', ''); if (L.el.title !== why) L.el.title = why; } else if (L.el.hasAttribute('data-left')) { L.el.removeAttribute('data-left'); L.el.title = ''; }
    if (x.byp) set1(L.el, 'data-muted', ''); else if (L.el.hasAttribute('data-muted')) L.el.removeAttribute('data-muted');
  }
  /* ------------------------------------------------ sync: the device, the inputs, the count, the height; the view's redraw */
  function sync() {
    if (dead) return;
    const D = dev(), m = modeOf(D), w = winOf(D);
    modeB.forEach((b, i) => { const on = CMB_MODES[i][0] === m; set1(b, 'aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    winB.forEach((b, i) => { const on = CMB_WIN[i] === w; set1(b, 'aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    const ml = markLabel(D.mark);
    text1(mark, 'Marks: ' + ml); set1(mark, 'aria-label', 'Marks: ' + ml); mark.title = 'Marks: a track\'s hits on the grid (' + ml + ')';
    const I = inputs();
    for (const [r] of pend) { const L = lines.get(r); if (!L || !L.drag) pend.delete(r); } // (the host's state holds the gesture's end now)
    if (!I.length) { if (!hint) { hint = mk(d, 'span', 'rig-chint', 'Plug LFOs into IN'); list.appendChild(hint); } }
    else if (hint) { hint.remove(); hint = null; }
    const keep = new Set();
    for (const x of I) {
      if (!x || typeof x.row !== 'string' || keep.has(x.row)) continue;
      let L = lines.get(x.row);
      if (!L) { L = makeLine(x.row); lines.set(x.row, L); }
      const at = list.children[keep.size];
      keep.add(x.row);
      if (at !== L.el) list.insertBefore(L.el, at || null);
      paintLine(L, x);
    }
    for (const [r, L] of lines) if (!keep.has(r)) { if (L.end) L.end(false); L.el.remove(); lines.delete(r); }
    if (hl && !lines.has(hl)) hl = null;
    // the IN's count: the cords on it, ≥ 2 — the face's own chip on a lines canvas (the cord layer counts a cords canvas's)
    const n = keep.size, cnt = n >= 2 && !call(O.cords);
    if (cnt) { if (!chip) { chip = mk(d, 'span', 'rig-cn'); chip.setAttribute('aria-hidden', 'true'); cIn.appendChild(chip); } text1(chip, String(n)); }
    else if (chip) { chip.remove(); chip = null; }
    if (n !== nLines) {
      nLines = n;
      const F = combRecipe(n);
      list.style.height = F.rows[2].h + 'px';
      face = Object.freeze({ kind: 'comb', variant: 'comb', cols: F.cols, w: faceW(F.cols), h: layoutOf(F).h });
    }
    if (V) { V.restyle(); V.dirty(1); if (shownNow()) V.frame(); kick(); } // (an edit, an undo, a skin: drawn now; the view's own keys say what recomputes)
  }
  /* ------------------------------------------------ the view: lc-view on demand, the DSP when it comes; a clock client while live */
  const tick = () => {
    if (!V) return;
    if (!shownNow()) { drop(); return; }
    if (!V.frame()) drop();                                    // (idle: the overlay painted once more, then no client)
  };
  function drop() { if (clk) { const f = clk; clk = null; f(); } }
  // an amount moved: the sum again (the cached curves, §6.6) — at the next frame while a client runs, else now
  function recombine() { if (!V) return; V.dirty(1); if (!clk && shownNow()) V.frame(); kick(); }
  function kick() { if (dead || clk || !V || !shownNow() || !V.live()) return; clk = wk.clock.add({ name: 'lc', el, fn: tick, shed: true }); }
  const build = M => {
    if (dead || V) return;
    V = M.createView({ curves: cvC, overlay: cvO, el: scr, devKey: O.devKey, mc: () => globalThis.ModCore || null, payload: () => get0(O.payload) || null, inputs: liveInputs,
      dev, song: () => get0(O.song) || null, heardFrame: () => +get0(O.heardFrame), sampleRate: () => +get0(O.sampleRate) || 48000, marks: O.marks,
      density: () => wk.storedDensity(cvC) || wk.deviceRatio() });
    offR = wk.onRescale(cvC, () => { if (V) { V.dirty(2); V.frame(); } }); // (a zoom end: the screens at the new density, its points)
    V.frame();                                                   // (the grid at once; the curves when the DSP is there)
    kick();
  };
  const ready = Promise.all([viewMod().then(build), dsp().then(() => { if (V && !dead) { V.dirty(2); V.frame(); kick(); } })]).then(() => undefined, err => console.error('cv-mods-ui: the Combiner\'s view', err));
  sync();
  return {
    el, jacks, inJack: IN,
    get face() { return face; },
    update(v) { if (dead || !V || !v || !v.cb) return; V.push(+v.F, v.cb, v.i | 0); kick(); },
    sync,
    menuItems: () => [],
    value: () => (V ? V.value() : NaN),
    highlight(r) { hl = typeof r === 'string' && lines.has(r) ? r : null; for (const [k, L] of lines) L.el.classList.toggle('rig-hl', k === hl); },
    view: () => V,
    ready: () => ready,
    destroy() {
      if (dead) return;
      dead = true;
      drop();
      if (offR) offR();
      for (const L of lines.values()) if (L.end) L.end(false);
      if (V) V.destroy();
      V = null;
      el.remove();
    },
  };
}

/** The body for a mod kind ('wheel' | 'velo' | 'at' | 'bend' | (2b) 'lfo' | 'env' | 'macro' | 'cc' | 'chaos' | 'note' | (LC) 'comb'; null for anything else). */
export function bodyFor(kind, o) {
  switch (kind) {
    case 'comb': return combBody(o);
    case 'wheel': return wheelBody(o);
    case 'velo': return veloBody(o);
    case 'at': return atBody(o);
    case 'bend': return bendBody(o);
    case 'lfo': return lfoBody(o);
    case 'env': return envBody(o);
    case 'macro': return macroBody(o);
    case 'cc': return ccBody(o);
    case 'chaos': return chaosBody(o);
    case 'note': return noteBody(o);
    default: return null;
  }
}
