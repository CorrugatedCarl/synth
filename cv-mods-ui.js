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
/** The body for a mod kind ('wheel' | 'velo' | 'at' | 'bend' | (2b) 'lfo' | 'env' | 'macro' | 'cc' | 'chaos' | 'note'; null for anything else). */
export function bodyFor(kind, o) {
  switch (kind) {
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
