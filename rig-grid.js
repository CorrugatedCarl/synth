// rig-grid.js — the RIG grid (docs/canvas/IMPL-WC.md §3.8): the ONE place a layout number lives — GRID, a row's height, a face's
// width, a recipe's geometry (layoutOf) and the grid CSS generated from GRID (custom properties --rig-*, the cells, the head, the
// switches, the screens, the touch hits). A leaf (no imports): rig-ui.js (the rig's faces, which re-exports all of it) and fx-ui.js
// (every track's Effects panel on the canvas, the FX look) lay their faces on it — one family, one set of numbers.
//   GRID            unit 8 · column 64 · side padding 16 (width 64·n + 32) · top 12 / bottom 16 · row gap 12 · rows head 32,
//                   screen 112 | 128, knobs 76, switches 32, jacks 56 · the knob cell 64 × 76 · a box 28 · hits 44 · the font minima ·
//                   the fill band G11 measures
//   rowH(t, h) · faceW(n) · layoutOf(recipe) → { w, h, cols, rows: [{ t, top, h, cells: [{ alts, span, grow, jack, col, cx }] }] }
//                   (recipe.mid: a short row centred exactly — col may be a half; the FX faces)
//   gridVars()      the --rig-* declarations (a rule body) · cssText() the grid CSS · ensureRigCSS(doc) (once per document, #rig-css)
// Browser ES module: nothing touches document / window at module top level.
const fin = x => typeof x === 'number' && isFinite(x);
export function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; }

/* ================================================================ the RIG grid (§3.8) — every layout number, here only */
/** World px at 100 %. The module bar (40 px, cv-module) sits above the face and is not part of it. */
export const GRID = deepFreeze({
  u: 8, col: 64, pad: 16, top: 12, bottom: 16, gap: 12,
  rows: { head: 32, screen: 112, screenL: 128, knobs: 76, switches: 32, jacks: 56 },
  knob: 40, knobTop: 4, labGap: 6, lab: 14, val: 12,           // the knob cell (64 × 76)
  box: 28, boxW: 40, boxMax: 56, sw: 56,                       // a num / toggle / menu box at the knob's centre line; a switch
  jack: 28, jackTop: 4, jackGap: 6, jackLab: 12, hit: 44,      // the jack cell (64 × 56): 4 · jack 28 · 6 · label 12 · 6; every hit ≥ 44
  strip: 28,                                                   // a screen's menu strip (the Oscillator's warp menus)
  font: { lab: 11, val: 10, sw: 11, head: 12, jack: 10 },      // the minima of §3.8 (13: the bar title, cv-module's)
  margin: 6, textGap: 8, radius: 6,                            // text ≥ 6 px from an edge or a control, ≥ 8 px from other text
  fill: [0.55, 0.85],                                          // the fill ratio band G11 measures
});
/** A row's height (px) from its type (a screen: 'S' 112 · 'L' 128). */
export function rowH(t, h) { return t === 'screen' ? (h === 'L' ? GRID.rows.screenL : GRID.rows.screen) : GRID.rows[t]; }
/** A face's width: n columns + the two side paddings — a multiple of the canvas's 32 px dots. */
export const faceW = cols => cols * GRID.col + 2 * GRID.pad;
// a cell item string → { alts: [{ id | name }], span, grow, jack: { port, dir } }
function parseItem(s) {
  const o = { alts: [], span: 1, grow: false, jack: null };
  let t = String(s);
  if (t[0] === '<' || t[0] === '>') { o.jack = { port: t.slice(1), dir: t[0] === '<' ? 'in' : 'out' }; return o; }
  if (t.endsWith('*')) { o.grow = true; t = t.slice(0, -1); }
  const m = /:(\d+)$/.exec(t);
  if (m) { o.span = +m[1]; t = t.slice(0, m.index); }
  o.alts = t.split('|').map(a => (a[0] === '#' ? { name: a.slice(1) } : { id: a }));
  return o;
}
/** The geometry of a recipe (pure; world px, face-local): width, height, each row's top and height, each cell's column, span and
 * centre x. A row of k cells (Σ spans S) in n columns starts at column ⌊(n − S) / 2⌋ — the knobs centre at the column pitch, never
 * spread wider; recipe.mid (the FX faces, fx-ui): at (n − S) / 2 exactly — an odd row half a column in, centred on the face (its
 * cells keep the pitch; the host shifts the row by half a column); jacks: inputs from the left, outputs from the right. A 'K' screen
 * (the kit's interior) counts GRID.rows.screenL. */
export function layoutOf(recipe) {
  const n = recipe.cols, rows = [];
  let y = GRID.top;
  recipe.rows.forEach((r, i) => {
    const h = fin(r.h) ? r.h : r.t === 'screen' ? GRID.rows.screenL : rowH(r.t, r.h);
    if (i) y += GRID.gap;
    const items = r.items.map(parseItem), cells = [];
    if (r.t === 'knobs' || r.t === 'switches') {
      const S = items.reduce((a, c) => a + c.span, 0);
      let c0 = recipe.mid ? (n - S) / 2 : Math.floor((n - S) / 2);
      for (const c of items) { cells.push(Object.assign(c, { col: c0, cx: GRID.pad + GRID.col * (c0 + c.span / 2) })); c0 += c.span; }
    } else if (r.t === 'jacks') {
      const ins = items.filter(c => c.jack.dir === 'in'), outs = items.filter(c => c.jack.dir === 'out');
      ins.forEach((c, j) => cells.push(Object.assign(c, { col: j, cx: GRID.pad + GRID.col * (j + 0.5) })));
      outs.forEach((c, j) => { const col = n - outs.length + j; cells.push(Object.assign(c, { col, cx: GRID.pad + GRID.col * (col + 0.5) })); });
    } else cells.push(...items);
    rows.push({ t: r.t, top: y, h, cells });
    y += h;
  });
  return { w: faceW(n), h: y + GRID.bottom, cols: n, rows };
}

/* ================================================================ the grid CSS (one place, injected once per document) */
const px = v => v + 'px';
/** The grid's custom properties (every --rig-* layout number, from GRID): a rule body. */
export function gridVars() {
  const G = GRID, F = G.font, boxTop = G.knobTop + (G.knob - G.box) / 2, labTop = G.knobTop + G.knob + G.labGap;
  return [['u', G.u], ['col', G.col], ['pad', G.pad], ['top', G.top], ['bottom', G.bottom], ['gap', G.gap], ['row-head', G.rows.head], ['row-screen', G.rows.screen],
    ['row-screenL', G.rows.screenL], ['row-knobs', G.rows.knobs], ['row-switches', G.rows.switches], ['row-jacks', G.rows.jacks], ['knob', G.knob], ['knob-top', G.knobTop],
    ['lab-gap', G.labGap], ['lab', G.lab], ['val', G.val], ['box', G.box], ['box-w', G.boxW], ['box-max', G.boxMax], ['sw', G.sw], ['box-top', boxTop], ['lab-top', labTop],
    ['jack', G.jack], ['jack-top', G.jackTop], ['jack-gap', G.jackGap], ['jack-lab', G.jackLab], ['hit', G.hit], ['strip', G.strip], ['radius', G.radius], ['margin', G.margin],
    ['f-lab', F.lab], ['f-val', F.val], ['f-sw', F.sw], ['f-head', F.head], ['f-jack', F.jack]].map(([k, v]) => '--rig-' + k + ': ' + px(v) + ';').join(' ');
}
function cssText() {
  const vars = gridVars();
  const LAB = 'font: 600 var(--rig-f-lab) / var(--rig-lab) var(--rig-font, var(--ui, system-ui, sans-serif)); letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap;';
  const HIT = "content: ''; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);";
  return `
/* rig-grid.js — the RIG grid (IMPL-WC §3.8): every number below is GRID's, as a custom property; a skin sets colours and the face font only */
.rig-face, .rig-drawer { ${vars} }
.rig-face { --rig-n: 4; }
.sx-root .rig-face.sx-panel, .rig-face { box-sizing: border-box; position: relative; display: flex; flex-direction: column; gap: var(--rig-gap);
  width: calc(var(--rig-col) * var(--rig-n) + 2 * var(--rig-pad)); min-width: 0; margin: 0; padding: var(--rig-top) var(--rig-pad) var(--rig-bottom);
  background: var(--rig-face, var(--sx-panel, #1f2023)); border: 0; border-radius: 0; color: var(--sx-ink, #ebe6d8); }
.rig-face *, .rig-drawer * { box-sizing: border-box; }
.rig-row { position: relative; flex: none; min-width: 0; }
.rig-head { height: var(--rig-row-head); display: flex; align-items: center; gap: var(--rig-u); }
.rig-screen { height: var(--rig-row-screen); display: flex; flex-direction: column; gap: var(--rig-u); }
.rig-screen[data-h="L"] { height: var(--rig-row-screenL); }
.rig-screen[data-h="K"] { height: auto; min-height: var(--rig-row-screenL); }
.rig-knobs, .rig-switches, .rig-jacks { display: grid; grid-template-columns: repeat(var(--rig-n), var(--rig-col)); grid-template-rows: 100%; }
.rig-knobs { height: var(--rig-row-knobs); } .rig-switches { height: var(--rig-row-switches); } .rig-jacks { height: var(--rig-row-jacks); }
.rig-cell { position: relative; grid-row: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; align-items: center; }
.rig-park, .rig-face > .rig-drawer { display: none !important; }
.sx-hidden.rig-keep { display: none !important; }
/* the knob cell: the whole cell is the knob's handle (64 × 76) */
.rig-face .rig-cell > .wk-knob { --wk-d: var(--rig-knob); width: 100%; height: 100%; min-width: 0; padding: var(--rig-knob-top) 0 0; gap: 0; border-radius: var(--rig-radius); justify-content: flex-start; ${LAB} }
.rig-face .rig-cell > .wk-knob > .wk-svg { flex: none; width: var(--rig-knob); height: var(--rig-knob); }
.rig-face .rig-cell > .wk-knob > .wk-lab { flex: none; margin: var(--rig-lab-gap) 0 0; height: var(--rig-lab); ${LAB} font-size: var(--rig-f-lab); color: var(--rig-label, var(--sx-ink, #ebe6d8)); }
.rig-face .rig-cell > .wk-knob > .wk-num { flex: none; min-height: 0; height: var(--rig-val); font: 500 var(--rig-f-val) / var(--rig-val) var(--rig-font, var(--ui, system-ui, sans-serif)); font-variant-numeric: tabular-nums; letter-spacing: 0.02em; color: var(--sx-mute, #9c978a); }
.rig-face .wk-lab[data-l] { font-size: 0 !important; }
.rig-face .wk-lab[data-l]::after { content: attr(data-l); font-size: var(--rig-f-lab); }
/* a box at the knob's centre line (a num, a toggle, a menu or a button) and its label in the knobs' label line */
.rig-face .rig-cell > .wk-nb, .rig-face .rig-cell > .sx-nf { width: 100%; height: 100%; min-width: 0; padding: var(--rig-box-top) 0 0; gap: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; }
.rig-face .rig-cell > .wk-nb > .wk-nbv, .rig-face .rig-cell > .sx-nf > .sx-nfv { order: 0; flex: none; display: flex; align-items: center; justify-content: center; height: var(--rig-box); min-height: 0; min-width: var(--rig-box-w); max-width: var(--rig-box-max); padding: 0 6px;
  font: 600 var(--rig-f-lab) / 1 var(--mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; }
.rig-face .rig-cell > .wk-nb > .wk-lab, .rig-face .rig-cell > .sx-nf > .sx-nfl, .rig-face .rig-cell > .rig-cap { order: 1; flex: none; margin: calc(var(--rig-lab-top) - var(--rig-box-top) - var(--rig-box)) 0 0; height: var(--rig-lab); ${LAB} color: var(--rig-label, var(--sx-ink, #ebe6d8)); }
.rig-face .rig-cell > .wk-tog, .rig-face .rig-cell > .sx-hbtn, .rig-face .rig-cell > .wk-menu { flex: none; margin-top: var(--rig-box-top); }
.rig-face .rig-cell > .wk-menu > .wk-lab { display: none; }
.rig-face .rig-cell > .wk-menu .wk-mbtn { height: var(--rig-box); }
.rig-face .rig-cell > .wk-menu { width: var(--rig-sw); }
/* switches: 56 × 28 at the column pitch; a seg spans its columns */
.rig-face .wk-tog, .rig-face .rig-cell > .sx-hbtn { position: relative; height: var(--rig-box); min-height: 0; width: var(--rig-sw); min-width: 0; padding: 0 4px; ${LAB} font-size: var(--rig-f-sw); }
.rig-face .rig-switches .rig-cell > * { margin-top: calc((var(--rig-row-switches) - var(--rig-box)) / 2); }
.rig-face .rig-switches .rig-cell > .wk-seg, .rig-face .rig-switches .rig-cell > .sx-seg { width: calc(100% - var(--rig-u)); height: var(--rig-box); display: flex; }
.rig-face .rig-switches .wk-seg > .wk-lab, .rig-face .rig-switches .sx-seg > .wk-lab { display: none; }
.rig-face .rig-switches .wk-seg button, .rig-face .rig-switches .sx-seg button, .rig-face .rig-switches .wk-sb { flex: 1 1 0; min-width: 0; height: var(--rig-box); min-height: 0; padding: 0 2px; ${LAB} font-size: var(--rig-f-sw); }
.rig-face .rig-switches .wk-segrow { display: flex; width: 100%; height: 100%; }
/* the head: 28 px controls, 12 px text, 8 px apart; one item grows */
.rig-face .rig-head > * { flex: none; min-width: 0; }
.rig-face .rig-head > .rig-grow { flex: 1 1 auto; }
.rig-face .rig-head .wk-menu > .wk-lab, .rig-face .rig-screen .wk-menu > .wk-lab { display: none; }
.rig-face .rig-head .wk-mbtn, .rig-face .rig-head .wk-arr, .rig-face .rig-head .sx-hbtn, .rig-face .rig-head .wk-tog, .rig-face .rig-head input,
.rig-face .rig-screen .wk-mbtn, .rig-face .rig-screen .wk-arr, .rig-face .rig-screen .sx-hbtn, .rig-face .rig-screen .wk-sb { height: var(--rig-box); min-height: 0; font-size: var(--rig-f-head); }
.rig-face .rig-head .sx-hbtn, .rig-face .rig-screen .sx-hbtn { min-width: var(--rig-box); padding: 0 6px; }
.rig-face .rig-head .wk-arr { width: calc(var(--rig-box) - var(--rig-u)); } /* (touch widens the kit's ◀ ▶ to 28: their 44 px hit stays, the name keeps its room) */
.rig-face .rig-head .wk-tog { width: auto; padding: 0 8px; }
.rig-face .rig-head .wk-menu:not(.rig-grow) { flex: none; } /* (only the grow item gives way: a type or a direction never ellipsizes, a name may) */
.rig-face .rig-head > .wk-menu:not(.rig-grow) .wk-arr, .rig-face .rig-noarr .wk-arr { display: none; }
.rig-face .rig-sel { display: flex; min-width: 0; gap: var(--rig-u); }
.rig-face .rig-sel > .wk-menu { flex: 1 1 auto; min-width: 0; }
.rig-face .rig-head .rig-grow.wk-menu, .rig-face .rig-head .rig-grow .wk-mbtn { min-width: 0; }
.rig-face .rig-head input[type="range"] { flex: 1 1 auto; height: var(--rig-box); margin: 0; accent-color: var(--sx-accent, #e8a33d); }
.rig-face .rig-head input[type="text"] { width: calc(var(--rig-col) - var(--rig-u)); padding: 0 6px; color: var(--sx-ink, #ebe6d8); background: var(--sx-bg, #17181a); border: 1px solid var(--sx-line, #2c2e32); border-radius: 4px; font: 500 var(--rig-f-head) var(--mono, ui-monospace, monospace); text-align: center; }
.rig-face .rig-head .sx-vc { font: 500 var(--rig-f-head) var(--mono, ui-monospace, monospace); color: var(--sx-mute, #9c978a); white-space: nowrap; }
.rig-face .rig-head .wk-meter, .rig-face .rig-head .rig-meter { height: 8px; }
.rig-face .rig-hint { font: 500 var(--rig-f-head) / 1.2 var(--rig-font, var(--ui, system-ui, sans-serif)); color: var(--sx-mute, #9c978a); white-space: nowrap; overflow: hidden; }
.rig-face .rig-glyph { display: inline-flex; align-items: center; justify-content: center; width: var(--rig-box); height: var(--rig-box); color: var(--sx-graph, #ebe6d8); }
.rig-face .rig-glyph svg { width: 22px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; }
/* the screen: the kit's display at the full inner width; the Oscillator's warp menus in a strip under it */
.rig-face .rig-screen > .rig-disp { position: relative; flex: 1 1 auto; min-height: 0; border-radius: var(--rig-radius); overflow: hidden; background: var(--rig-screen, #141518); }
.rig-face .rig-screen .sx-disp, .rig-face .rig-screen .sxo-dw { display: block; width: 100%; height: 100%; margin: 0; border-radius: var(--rig-radius); }
.rig-face .rig-screen .sx-edbox { position: relative; width: 100%; height: 100%; min-height: 0; }
.rig-face .rig-screen .gx-root { height: 100% !important; }
.rig-face .rig-screen > .rig-strip { flex: none; height: var(--rig-strip); display: grid; grid-template-columns: 1fr 1fr; gap: var(--rig-u); }
.rig-face .rig-strip > .rig-half { display: flex; align-items: center; gap: var(--rig-margin); min-width: 0; }
.rig-face .rig-strip .wk-menu { flex: 1 1 auto; min-width: 0; }
.rig-face .rig-strip .wk-arr { display: none; }
.rig-face .rig-strip .wk-mbtn { border-radius: 4px; }
.rig-face .rig-strip .sxo-wl { flex: none; min-width: 0; ${LAB} color: var(--sx-mute, #9c978a); }
.rig-face .rig-strip .wk-sl { flex: 0 1 72px; min-width: 48px; flex-direction: row; align-items: center; gap: 4px; }
.rig-face .rig-strip .wk-sl > .wk-lab { ${LAB} font-size: var(--rig-f-jack); color: var(--sx-mute, #9c978a); }
.rig-face .rig-strip .wk-sl > .wk-num { display: none; }
.rig-face .rig-strip .wk-seg { flex: none; }
.rig-face .rig-screen[data-h="K"] > .rig-disp { overflow: visible; background: none; }
/* a cell whose every member is hidden shows its first one, dimmed and inert: never a hole */
.rig-face .rig-cell[data-dim] > :first-child { display: inline-flex !important; opacity: 0.35; pointer-events: none; }
.rig-face.sx-off > .rig-row:not(.rig-jacks) { opacity: 0.45; }
/* the jack row (§3.2): 28 px cream-ringed jacks at the column centres, a 10 px label line under each */
.rig-face .rig-jack { --jp: var(--rig-hit); position: absolute; z-index: 3; left: 50%; top: calc(var(--rig-jack-top) + var(--rig-jack) / 2); width: var(--rig-jack); height: var(--rig-jack);
  margin: calc(var(--rig-jack) / -2) 0 0 calc(var(--rig-jack) / -2); border-radius: 50%; cursor: crosshair; touch-action: none;
  background: radial-gradient(circle, var(--rig-jack-hole, #0b0b0c) 0 6.5px, #000 7px 7.5px, var(--rig-jack-ring, #ebe6d8) 8px 11px, rgba(0, 0, 0, 0.55) 11.5px 12.5px, transparent 13px);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.55); }
.rig-face .rig-jack::before { ${HIT} width: var(--rig-hit); height: var(--rig-hit); border-radius: 999px; }
/* ((WC, integration fixer K; review P2-3 and its skeptics) a jack's own hit: the grid's 44 px circle — short of the row above, no wider
   than its column; never stretched (the user, 2026-10-26: several cords stack their plugs on the jack itself — the fan is gone); the
   rest of a jack's reach (22 screen px at Fit, past the face's edge, which clips this circle) is the world's near hook (main.js) */
.rig-face .rig-jack[data-ro] { cursor: default; }
.rig-face .rig-jl { position: absolute; left: 50%; top: calc(var(--rig-jack-top) + var(--rig-jack) + var(--rig-jack-gap)); transform: translateX(-50%); height: var(--rig-jack-lab);
  font: 600 var(--rig-f-jack) / var(--rig-jack-lab) var(--rig-font, var(--ui, system-ui, sans-serif)); letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; color: var(--rig-label, var(--sx-ink, #ebe6d8)); }
.rig-face .rig-jl > .rig-nrm { margin-left: 0.4em; color: var(--sx-mute, #9c978a); }
.rig-face .rig-jacks[data-plugged] .rig-nrm { text-decoration: line-through; }
/* the macros: a knob over its name tile (the tile is the jack) */
.rig-face .rig-cell > .wk-knob.rig-mk { height: auto; }
.rig-face .rig-cell > .wk-knob.rig-mk > .wk-num { display: none; }
.rig-face .rig-cell > .sx-tile { position: relative; flex: none; width: calc(100% - var(--rig-u)); height: var(--rig-box); min-height: 0; margin-top: calc(var(--rig-lab-top) - var(--rig-knob-top) - var(--rig-knob) - 2px); padding: 0 4px; justify-content: center;
  ${LAB} font-size: var(--rig-f-lab); text-transform: none; letter-spacing: 0.02em; touch-action: pan-y pinch-zoom; }
.rig-face .rig-cell > .sx-tile .sx-tl { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.rig-face .rig-cell > .sx-tile::before { ${HIT} width: 100%; height: var(--rig-hit); }
.rig-face .rig-cell > .sx-tile .sx-badge { position: absolute; top: -6px; right: -4px; }
.rig-face .rig-cell > input { width: calc(100% - var(--rig-u)); height: var(--rig-box); margin-top: calc(var(--rig-lab-top) - var(--rig-knob-top) - var(--rig-knob) - 2px); }
/* touch: the kit's 44 px minimum heights would break the rows — the hit grows invisibly instead (≥ 44 px, inside the row gaps) */
.rig-face .rig-head .sx-hbtn, .rig-face .rig-screen .sx-hbtn, .rig-face .rig-cell > .sx-hbtn, .rig-face .wk-tog, .rig-face .wk-mbtn, .rig-face .rig-switches button { position: relative; min-height: 0; }
.rig-face .rig-head .sx-hbtn::after, .rig-face .rig-screen .sx-hbtn::after, .rig-face .rig-cell > .sx-hbtn::after, .rig-face .wk-tog::after, .rig-face .wk-mbtn::after, .rig-face .rig-switches button::after { ${HIT} width: 100%; height: var(--rig-hit); }
/* the ⚙ drawer: the face's overflow controls in a sheet at the button (the grid's cells, its padding) */
.rig-drawer { position: fixed; z-index: 45; display: flex; flex-wrap: wrap; align-content: flex-start; gap: var(--rig-gap) 0; width: calc(var(--rig-col) * var(--rig-dn, 5) + 2 * var(--rig-pad)); max-height: calc(100vh - 16px); overflow: auto;
  padding: var(--rig-top) var(--rig-pad) var(--rig-bottom); color: var(--sx-ink, #ebe6d8); background: var(--rig-face, var(--sx-panel, #1f2023)); border: 1px solid var(--sx-line, #2c2e32); border-radius: 10px; box-shadow: 0 18px 44px rgba(0, 0, 0, 0.6); }
.rig-drawer > .rig-dt { flex: 0 0 100%; height: var(--rig-lab); ${LAB} color: var(--sx-mute, #9c978a); }
.rig-drawer > .rig-cell { width: var(--rig-col); height: var(--rig-row-knobs); }
.rig-drawer > .rig-dline { flex: 0 0 100%; display: flex; flex-wrap: wrap; align-items: center; gap: var(--rig-u); min-height: var(--rig-box); }
.rig-drawer .sx-hbtn, .rig-drawer .wk-tog { height: var(--rig-box); min-height: 0; }
.rig-drawer .rig-dhint { flex: 0 0 100%; font: 500 var(--rig-f-head) / 1.2 var(--rig-font, var(--ui, system-ui, sans-serif)); color: var(--sx-mute, #9c978a); }
`;
}
export const CSS_ID = 'rig-css';
/** The grid CSS, once per document (the kit's ensureCSS idiom). */
export function ensureRigCSS(doc) {
  if (!doc || typeof doc.createElement !== 'function') return;
  if (typeof doc.getElementById === 'function' && doc.getElementById(CSS_ID)) return;
  const st = doc.createElement('style');
  st.id = CSS_ID;
  st.textContent = cssText();
  (doc.head || doc.documentElement).appendChild(st);
}
export { cssText };
