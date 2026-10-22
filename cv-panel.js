// cv-panel.js — the fixed hardware front panels of the classic synths (docs/canvas/IMPL-panels.md §3–§6; owner: ENGINE).
// A model's layout (panels/<model>.js: data only, mm of the real instrument) becomes one fixed-size module body: a cached
// SVG of the static art (areas, sections, rules, legends, dials, inert controls) under one absolutely placed widget per
// live control, plus the "extras" strip of our controls the hardware lacks. Nothing here measures layout or reflows: every
// position is pure maths from the layout and PX_PER_MM, so the module looks the same at every zoom and on every device.
// Rules: plain ES module, no DOM / window / storage at module top level (node imports it: tests, tools/panel-check.mjs);
// render() survives tests/main-sim.mjs's DOM stub (keeps references to its nodes, no querySelector of its own nodes, no
// layout reads). Widgets register in main.js's `ui` map through the api (main.js hwApi, IMPL-panels §4.4).
// Stage 1g: below native resolution (camera k < 1 at a zoom end) the face SVG is shown as a bitmap at that zoom's device
// resolution, filtered down from a finer vector raster (faceTier): no aliased thin lines, no per-frame vector raster in a pinch.
// Stage 1h: on the GL path the face is a texture (cv-face FACES.register: a mipmapped base, a finer window above k = 1)
// drawn under #world every frame; faceTier stays as the 'dom' mode (an overlapping / folded module) and the 2D fallback.
// Stage 1i: the keyboards and the performance controls (IMPL-1i §2–§3): kinds keys / wheel / lever / ribbon / pad, live
// with the shared perf: tokens of every model; a bed's geometry (o.bed, unrounded) from cv-keys.bedLayout.
// Stage 7a: the TR-808 (IMPL-7a §7): its dr: tokens (the sequencer's rotaries, switches, keys and LEDs; the extras' step grid,
// pads and small controls, TOK_CELL), the 16 step keys all present, detented tokens' positions (TOKENS.tr808.pos), the
// `inert: 'later'` jack (full contrast, "cable-able with full patching"), a drum machine's extras caption; the dr: widgets
// are cv-drum.js drumPanel's (over api.drum; null: the same nodes, silent).
// Stage 7b: the TR-606 (IMPL-7b §7.2–§7.3): TOKENS.tr606 (its own cell sizes and extras row breaks, a token's required
// orientation: SCALE vertical), a rotary's `rot` (its sweep's centre: the 606's MODE dial sits off 12 o'clock), cv-drum's
// ctx.model (a stub-hosted 606 panel builds the 606's widgets).
// Stage 7c: the TR-909 (IMPL-7c §7.2–§7.3): TOKENS.tr909 — a `display` token (the 3-digit display: its box holds `digits`
// characters at the .hw-dsp font, DSP_FONT), repeated LED keys and LEDs (TRACK 1–4, PATTERN 1–3, the scale rows: `multi` /
// `idx` / `full` as the step keys, an LED's index checked too), keys that must show their LED (`led`), the model's own
// extras caption (`caption`: our own cymbal sounds named, D4 — the layout omits it or carries it exactly; too long for its
// strip, its type steps down: xcapFit, estimated, never measured); its 4 × 3 pads.
// Stage 8: the SDS-V (IMPL-8 §13): TOKENS.sdsv — a token repeated per group (`grp`: the channel b s 1 2 3; `idx` within it):
// the memory keys (dr:mem n 1–4, each with its LED, a radio bound to the channel's models.js switch x<ch>p: `bind`, the
// switch placed by its keys) and the trimmer rows (dr:trim mem 3 / 4: our art of six trimmers, one hit box; `hitOff`, the
// hit box's centre off the art's, so two close rows keep disjoint 14 mm boxes); the five hexagonal pads' cell (DRV_PADS),
// MAP… · SOUNDS… · TRIM…; its caption names our factory sounds (D4); "Simmons" among the maker words.
// Stage 9: the 900 Series (IMPL-9 §2.2, §4.1–§4.2): live patch jacks — a layout's `{ kind: 'jack' | 'strig', port, label,
// x, y, d | w, h }` (no id, never inert) drawn at full contrast in the face, validated (the port one of the model's jacks,
// each once, an S-trigger socket a strig; centres ≥ JACK_PITCH_MM apart and ≥ JACK_CLEAR_MM from every other live hit box)
// and listed by geometry().jacks (body px, pure maths; no widget here: cv-module places a span over each); the module faces
// of a patch family (moduleModel: a synthetic model per module type over the family's table, moduleLayout: its validated
// face from panels/index.js MODULE_LAYOUTS), the controller's face its model's console (layoutOf('m900')).
import * as wk from './wk.js?v=9';
import { DOT } from './cv-world.js?v=9';
import { BAR_H } from './cv-module.js?v=9';
import { FACES } from './cv-face.js?v=9';
import * as KY from './cv-keys.js?v=9';
import * as CD from './cv-drum.js?v=9';
import * as MG from './moog-core.js?v=9';
import { LAYOUTS, HW_IDS, layoutOf, MODULE_LAYOUTS, moduleLayoutOf } from './panels/index.js?v=9';

export { LAYOUTS, HW_IDS, layoutOf, MODULE_LAYOUTS, moduleLayoutOf };
/** Layout format version; world px per mm of the real instrument (one scale for every model, IMPL-panels §3.1). */
export const FORMAT = 1, PX_PER_MM = 2;
/** Hit areas (mm): every live control's ≥ HIT_MIN_MM both ways; by default a control's own box grows to HIT_DEF_MM. */
export const HIT_MIN_MM = 14, HIT_DEF_MM = 15;
/** The seam of case colour between the face and an aux plate (mm); a cropped band without controls (mm, R2). */
export const SEAM_MM = 8, BAND_MAX_MM = 24;
/** The extras strip (world px): a row, its caption, the inner padding; cell widths per our control type. */
export const XROW = 64, XCAP = 16, XPAD = 8;
export const XCELL = Object.freeze({ k: 72, b: 72, s: n => Math.max(72, 16 + 52 * (n | 0)) });
/** A selector's extras cell: XCELL.s, wider when its option names are long (today's .sel pills in one row: ~26 px of LED
 * and padding + 5.8 px a character each, 3 px apart) — from the names, never measured. @param {string[]} opts */
export const selCellW = opts => Math.max(XCELL.s(opts.length), Math.ceil(16 + opts.reduce((a, o) => a + 26 + 5.8 * String(o).length, 0) + 3 * (opts.length - 1)));
/** TB-303's 16-step grid block in the extras strip (px). */
export const SEQ_GRID = Object.freeze({ w: 16 * 36, h: 192 });
/** Limits: decor items per layout, content size (mm). */
export const MAX_DECOR = 3000, MAX_W_MM = 2000, MAX_H_MM = 1000;
/** Maker names never printed on a panel (whole words, case-sensitive: "ARPEGGIO" and "Minimoog" pass). */
export const MAKERS = Object.freeze(['Moog', 'ARP', 'Eminent', 'Yamaha', 'Sequential', 'Korg', 'Roland', 'Oberheim', 'Simmons']);
/** Control kinds → the models.js types a live one may carry ([]: display or decoration only; §3.4.1). */
export const KINDS = Object.freeze({
  knob: ['k'], slider: ['k', 's'], rotary: ['s', 'k'], switch: ['b', 's', 'k'], button: ['b', 's', 'k'], buttons: ['s', 'k'], jacks: ['s'],
  led: [], display: [], jack: [], lamp: [], screw: [], fuse: [], strig: [], slot: [],
  keys: [], wheel: [], lever: [], ribbon: [], pad: [], // (1i) live only with a perf: token; drawn at rest when inert
});
/** Waveform / arrow pictograms (path data in a −1…1 box, stroked). */
export const GLYPHS = Object.freeze({
  'wave:sine': 'M-1 0C-0.67-1.15-0.33-1.15 0 0S0.67 1.15 1 0',
  'wave:tri': 'M-1 0.6L0-0.6L1 0.6',
  'wave:saw': 'M-1 0.6L0-0.6V0.6L1-0.6V0.6',
  'wave:rsaw': 'M-1-0.6L0 0.6V-0.6L1 0.6V-0.6',
  'wave:trisaw': 'M-1 0.6C-0.55 0.45-0.15 0-0.05-0.6L0.15 0.6C0.55 0.45 0.85 0 1-0.6',
  'wave:sq': 'M-1 0.6V-0.6H0V0.6H1V-0.6',
  'wave:rect': 'M-1 0.6V-0.6H-0.35V0.6H1V-0.6',
  'wave:narrow': 'M-1 0.6V-0.6H-0.75V0.6H1V-0.6',
  'wave:pulse': 'M-1 0.6H-0.2V-0.6H0.2V0.6H1',
  'wave:noise': 'M-1 0.1L-0.8-0.5L-0.6 0.4L-0.4-0.2L-0.2 0.6L0-0.6L0.2 0.3L0.4-0.4L0.6 0.5L0.8-0.3L1 0.2',
  'arrow:up': 'M0 0.8V-0.8M-0.5-0.3L0-0.8L0.5-0.3',
  'arrow:down': 'M0-0.8V0.8M-0.5 0.3L0 0.8L0.5 0.3',
  'arrow:right': 'M-0.8 0H0.8M0.3-0.5L0.8 0L0.3 0.5',
});
/** (9, IMPL-9 §4.2) A live patch jack's port id; the least distance (mm) between two patch jacks' centres (their 14 mm hit
 * circles never touch) and from a jack's centre to any other live control's hit box (the widest hit circle never covers it). */
export const PORT_RE = /^[a-z][a-z0-9]{0,7}$/, JACK_PITCH_MM = 15, JACK_CLEAR_MM = 9;
/** (9) A patch jack's widest hit circle when nothing bounds it (px: 44 screen px at k 0.5). */
export const JACK_HIT_MAX = 88;
/** (9, IMPL-9 §2.6, §4.1) The patch families whose module faces this build draws: the family's table (moog-core FAMILY: its
 * types, jacks, controller type and the instrument model whose hardware layout is the controller's console) and the module
 * faces' theme (the 900 Series model's, models.js m900.theme, no wood). A later family (the ARP 2600, the MS-20) adds a row. */
export const PATCH_FAMS = Object.freeze([Object.freeze({ fam: MG.FAMILY,
  theme: Object.freeze({ ctl: 'knob', knob: 'moog', panel: '#121110', face: '#0b0b0b', ink: '#e9e4d8', label: '#bdb6a6', accent: '#d9d2bf', font: 'helvetica' }) })]);
/** The default extras caption; a drum machine's says what its sounds are (IMPL-7a §2.5, §7.5: D4). */
export const XCAPTION = 'EXTRAS · not on the original', XCAPTION_DRUMS = XCAPTION + ' · Sounds: our model of the circuits';
/** (7c) A display token's characters at the .hw-dsp font (style.css: 700 20px mono): px, a character's advance (em), the
 * window's margin (mm) — a box of n characters is ≥ dspMin(n) mm (w × h). */
export const DSP_FONT = Object.freeze({ px: 20, em: 0.62, pad: 2 });
export const dspMin = n => [Math.round((n * DSP_FONT.em * DSP_FONT.px / PX_PER_MM + DSP_FONT.pad) * 100) / 100, DSP_FONT.px / PX_PER_MM + DSP_FONT.pad];
/** The special tokens of a model (§3.4.3): live ids the renderer binds itself (`multi`: may repeat, `idx`: the field that
 * tells the repeats apart [field, lo, hi], each value once; `full`: every value lo…hi present), extras-only ones, the kind
 * each must be (a list: any of them) and (`pos`) a detented token's hardware positions. Every token is validated;
 * `usable()` refuses a layout whose tokens this build cannot draw. (7b) `orient`: a switch token's required orientation
 * (v | h: its `orient`, else taller than wide = v); `cells`: the model's own extras cell sizes (over TOK_CELL); `xbreak`:
 * its own extras row breaks (over XBREAK). (7c) `led`: keys that show their LED (led cap | above | below, never none);
 * `digits`: a display token's characters (its box ≥ dspMin); `caption`: the model's extras caption (the layout's own, if
 * any, must equal it). (8) `grp`: a repeated token's group [field, values] — `idx` and `full` count within each group
 * (the SDS-V's keys by channel); `bind`: a grouped token that writes a models.js switch per group ('x?p': ? the group's
 * value), which its controls place (once per group present). */
export const TOKENS = Object.freeze({
  tb303: {
    kind: { 'seq:tempo': 'knob', 'seq:runLed': 'led', 'seq:run': 'button', 'seq:clear': 'button', 'seq:key': 'button', 'seq:pitch': 'button', 'seq:time': 'button',
      'seq:down': 'button', 'seq:up': 'button', 'seq:accent': 'button', 'seq:slide': 'button', 'seq:back': 'button', 'seq:next': 'button' },
    extras: ['seq:sync', 'seq:swing', 'seq:random', 'seq:demo', 'seq:toRoll', 'seq:grid'], multi: ['seq:key'], idx: { 'seq:key': ['note', 0, 12] },
  },
  dx7: {
    kind: { 'dx:data': 'slider', 'dx:no': 'button', 'dx:yes': 'button', 'dx:btn': 'button', 'dx:opsel': 'button', 'dx:edit': 'button', 'dx:function': 'button',
      'dx:memInt': 'button', 'dx:led': 'display', 'dx:lcd': 'display', 'dx:chart': 'display' },
    extras: [], multi: ['dx:btn'], idx: { 'dx:btn': ['n', 1, 32] },
  },
  // (7a, IMPL-7a §7.2) the TR-808's sequencer (drum-core's state machine through api.drum, cv-drum.js): MODE, INSTRUMENT /
  // TRACK and AUTO FILL IN rotaries (their legends one per position), TEMPO (40 click stops) and FINE, BASIC / I/F
  // VARIATION, PRE-SCALE (a slide switch or a rotary, as the photos show), START/STOP, TAP, CLEAR, the 16 step keys (n 1–16,
  // all present, each with its LED), the PART and variation LEDs; the extras of §3.6
  tr808: {
    kind: { 'dr:mode': 'rotary', 'dr:inst': 'rotary', 'dr:fill': 'rotary', 'dr:tempo': 'knob', 'dr:fine': 'knob', 'dr:bvar': 'switch', 'dr:ifv': 'switch',
      'dr:pre': ['switch', 'rotary'], 'dr:start': 'button', 'dr:tap': 'button', 'dr:clear': 'button', 'dr:step': 'button',
      'dr:part1': 'led', 'dr:part2': 'led', 'dr:varA': 'led', 'dr:varB': 'led' },
    extras: ['dr:grid', 'dr:pads', 'dr:sync', 'dr:swing', 'dr:toRoll', 'dr:rec', 'dr:map', 'dr:sounds', 'dr:demo'],
    multi: ['dr:step'], idx: { 'dr:step': ['n', 1, 16] }, full: ['dr:step'],
    pos: { 'dr:mode': 6, 'dr:inst': 12, 'dr:fill': 6, 'dr:bvar': 3, 'dr:ifv': 2, 'dr:pre': 4 },
  },
  // (7b, IMPL-7b §7.2) the TR-606's sequencer (drum-core's 606 machine through api.drum, cv-drum.js): MODE (4) and TRACK /
  // INSTRUMENT (8) rotaries, TEMPO (continuous), SCALE (a vertical slide switch: its first position, the top, is SCALE 4),
  // RUN/STOP and its LED, CLEAR/RESET and FUNCTION (held states), PATTERN GROUP and its I / II LEDs, TAP, the 16 step keys
  // (n 1–16, all present, each with its LED); the extras of §3.7 + SYNC 303s; a 608 px module's strip (592 inside, review
  // #10): the grid 592 × 192 (a 48 px header + 16 × 34; a 32 px top + 8 × 20), the 2 × 4 pads 232 × 116; its rows (§7.5):
  // the grid · the pads, SYNC, SWING · TUNE / DECAY 8 + 3 (models.js order: bdu … htd, then cyd ohd chd) · → PIANO ROLL …
  // SYNC 303s
  tr606: {
    kind: { 'dr:mode': 'rotary', 'dr:inst': 'rotary', 'dr:tempo': 'knob', 'dr:sc': 'switch', 'dr:start': 'button', 'dr:runLed': 'led', 'dr:clear': 'button',
      'dr:fn': 'button', 'dr:grp': 'button', 'dr:grpI': 'led', 'dr:grpII': 'led', 'dr:tap': 'button', 'dr:step': 'button' },
    extras: ['dr:grid', 'dr:pads', 'dr:sync', 'dr:swing', 'dr:toRoll', 'dr:rec', 'dr:map', 'dr:sounds', 'dr:demo', 'dr:link'],
    multi: ['dr:step'], idx: { 'dr:step': ['n', 1, 16] }, full: ['dr:step'],
    pos: { 'dr:mode': 4, 'dr:inst': 8, 'dr:sc': 4 }, orient: { 'dr:sc': 'v' },
    cells: { 'dr:grid': [592, 192], 'dr:pads': [232, 116] }, xbreak: ['dr:grid', 'dr:swing', 'htd', 'chd'],
  },
  // (7c, IMPL-7c §7.2) the TR-909's sequencer (drum-core's 909 machine through api.drum, cv-drum.js): START and STOP/CONT
  // (taps), the 3-digit display, TEMPO (continuous), the small LED keys — TRACK 1–4 and PATTERN 1–3 (one token each, by
  // n), the TEMPO key, BACK, FWD, AVAILABLE MEAS, CYCLE/GUIDE —, ENTER (its LED), the left cluster (LAST STEP, SCALE,
  // SHUFFLE/FLAM, CLEAR, INSTRUMENT SELECT — a new id: dr:inst is a rotary —, SHIFT), the 16 step keys (n 1–16, each with its
  // LED) and the four scale rows' LEDs (n 1–4); the extras of §3.7 (no SWING: the face's SHUFFLE; no knobs, §13 Q3): a 992
  // px module's strip (976 inside), the 808's grid 640 × 272 and the 4 × 3 pads 232 × 184 (52 px pads, 8 px gaps, 8 px top)
  // in one row, then SYNC · → PIANO ROLL · REC · MAP… · SOUNDS… · DEMO (560 px); its caption names our cymbal sounds (D4)
  tr909: {
    kind: { 'dr:start': 'button', 'dr:stop': 'button', 'dr:disp': 'display', 'dr:tempo': 'knob', 'dr:trk': 'button', 'dr:pat': 'button',
      'dr:tkey': 'button', 'dr:back': 'button', 'dr:fwd': 'button', 'dr:avail': 'button', 'dr:cyc': 'button', 'dr:enter': 'button',
      'dr:last': 'button', 'dr:scale': 'button', 'dr:shuf': 'button', 'dr:clear': 'button', 'dr:isel': 'button', 'dr:shift': 'button',
      'dr:step': 'button', 'dr:scl': 'led' },
    extras: ['dr:grid', 'dr:pads', 'dr:sync', 'dr:toRoll', 'dr:rec', 'dr:map', 'dr:sounds', 'dr:demo'],
    multi: ['dr:step', 'dr:trk', 'dr:pat', 'dr:scl'], idx: { 'dr:step': ['n', 1, 16], 'dr:trk': ['n', 1, 4], 'dr:pat': ['n', 1, 3], 'dr:scl': ['n', 1, 4] },
    full: ['dr:step', 'dr:trk', 'dr:pat', 'dr:scl'],
    led: ['dr:trk', 'dr:pat', 'dr:tkey', 'dr:back', 'dr:fwd', 'dr:avail', 'dr:cyc', 'dr:enter'], digits: { 'dr:disp': 3 },
    cells: { 'dr:pads': [232, 184] }, xbreak: ['dr:pads'],
    caption: XCAPTION_DRUMS + ' · Hi-hats and cymbals: our own sounds through the 909’s chip circuit',
  },
  // (8, IMPL-8 §13.2) the SDS-V (no sequencer): per channel (`grp` ch b s 1 2 3 — bass, snare, toms 1–3) its four memory keys
  // (dr:mem n 1–4, each with its LED: one radio per channel bound to the models.js switch x<ch>p, index n − 1 — `bind`: the
  // switch is placed by its keys, never on its own) and its two trimmer rows (dr:trim mem 3 / 4: our art of six trimmers ≤ 8
  // mm, one hit box opening TRIM… at that row); the extras: the five hexagonal pads (DRV_PADS), MAP… · SOUNDS… · TRIM… (no
  // sequencer: no grid, SYNC, REC, DEMO, → Piano roll); its caption names our factory sounds (D4)
  sdsv: {
    kind: { 'dr:mem': 'button', 'dr:trim': 'button' },
    extras: ['dr:pads', 'dr:map', 'dr:sounds', 'dr:trimMenu'],
    multi: ['dr:mem', 'dr:trim'], idx: { 'dr:mem': ['n', 1, 4], 'dr:trim': ['mem', 3, 4] }, full: ['dr:mem', 'dr:trim'],
    grp: { 'dr:mem': ['ch', ['b', 's', '1', '2', '3']], 'dr:trim': ['ch', ['b', 's', '1', '2', '3']] }, bind: { 'dr:mem': 'x?p' },
    led: ['dr:mem'], cells: { 'dr:pads': [328, 200] }, xbreak: ['dr:pads'],
    caption: XCAPTION + ' · Factory sounds: ours, through our model of its circuits', // (not XCAPTION_DRUMS + …: its "Sounds: our model of the circuits" says the same)
  },
});
/** (1i, IMPL-1i §2) The performance tokens of every model: the bed and its controllers (the id names the target, the kind
 * the widget: one of its list). Each at most once per layout; never in the extras. */
export const PERF_TOKENS = Object.freeze({ kind: Object.freeze({ 'perf:keys': ['keys'], 'perf:bend': ['wheel', 'lever', 'ribbon'], 'perf:mod': ['wheel', 'lever', 'pad'] }) });
/** Tokens this build renders (a layout using another one falls back to the Simple panel, §4.5). */
export const RENDERED_TOKENS = new Set([...Object.keys(TOKENS.tb303.kind), ...TOKENS.tb303.extras, ...Object.keys(TOKENS.dx7.kind), ...Object.keys(PERF_TOKENS.kind),
  ...Object.keys(TOKENS.tr808.kind), ...TOKENS.tr808.extras, ...Object.keys(TOKENS.tr606.kind), ...TOKENS.tr606.extras, ...Object.keys(TOKENS.tr909.kind), ...TOKENS.tr909.extras,
  ...Object.keys(TOKENS.sdsv.kind), ...TOKENS.sdsv.extras]);
/** (7a) An inert control's title / tip: not emulated (dimmed), or `inert: 'later'` (a jack drawn at full contrast that
 * becomes cable-able with full patching, IMPL-7a §7.3). */
export const INERT_TIP = ' — not emulated', LATER_TIP = ' — cable-able with full patching (stage 4)';
/** The extras cells of the tokens (world px, w × h): the TB-303's parts and grid, the TR-808's (IMPL-7a §7.2: the step
 * grid, the 4 × 4 pads, the small controls); every other cell is a models.js control's (XCELL, selCellW) at XROW. (7b) A
 * model's own sizes (TOKENS.<model>.cells: the TR-606's grid and pads, DR6_GRID / DR6_PADS) win; SYNC 303s (dr:link).
 * (7c) The TR-909's 4 × 3 pads: DR9_PADS (its grid the 808's). (8) The SDS-V's kit of five hexagonal pads: DRV_PADS (= cv-drum
 * PADSV's box); TRIM… (dr:trimMenu). */
export const DR_GRID = Object.freeze({ w: 640, h: 272 }), DR_PADS = Object.freeze({ w: 232, h: 232 });
export const DR6_GRID = Object.freeze({ w: 592, h: 192 }), DR6_PADS = Object.freeze({ w: 232, h: 116 });
export const DR9_PADS = Object.freeze({ w: 232, h: 184 });
export const DRV_PADS = Object.freeze({ w: 328, h: 200 });
export const TOK_CELL = Object.freeze({
  'seq:grid': [SEQ_GRID.w, SEQ_GRID.h], 'seq:sync': [128, XROW], 'seq:toRoll': [128, XROW], 'seq:random': [104, XROW],
  'dr:grid': [DR_GRID.w, DR_GRID.h], 'dr:pads': [DR_PADS.w, DR_PADS.h], 'dr:sync': [96, XROW], 'dr:swing': [104, XROW], 'dr:toRoll': [128, XROW],
  'dr:rec': [72, XROW], 'dr:map': [88, XROW], 'dr:sounds': [104, XROW], 'dr:demo': [72, XROW], 'dr:link': [128, XROW], 'dr:trimMenu': [88, XROW],
});
/** Extras cells after which the full-width strip starts a new row (the 808: the grid and the pads, then the small controls, §7.5;
 * (7b) a model's TOKENS.<model>.xbreak replaces it). */
export const XBREAK = Object.freeze(['dr:pads']);
/** (7c) The extras caption's type when its text would overrun `room` px at style.css's .hw-xcap (600 9px uppercase, 0.08 em
 * tracking): 8 px, else 7 px, the tracking 0.04 em — or null (it fits: as before). Estimated from the characters (a letter
 * or digit ≈ 0.72 em + the tracking, anything else 0.32 em + it: above Chrome's measure), never measured (the 909's caption
 * names its cymbal sounds, D4, and with the dimmed note runs past its 976 px). (7c review 2 F4) "Does it fit at 9 px" reads
 * the estimate calibrated on Chrome's measure (XCAP_K: the plain caption 379.9 px of an estimated 406.8 — the Prophet-5's /
 * OB-Xa's 384 px room fits, the Solina's 366 does not); the smaller size is chosen on the plain (higher) estimate. render()
 * applies it to every strip: one that fits keeps its type as before. */
export const XCAP_K = 0.935;
/* (8) k: the calibration — XCAP_K was fitted to the plain caption's letters only; a model's own caption (the 909's, the SDS-V's)
 * reads the plain estimate (k 1, conservative): the SDS-V's old caption (157 characters, its facts said twice) measured 976.5 px at
 * 9 px in Chrome (its letters wider: 0.972 of the estimate) in a 976 px room; said once (121) it fits at 9 px */
export function xcapFit(text, room, k = XCAP_K) {
  const est = (fs, ls) => [...String(text)].reduce((a, ch) => a + ((/[A-Za-z0-9]/.test(ch) ? 0.72 : 0.32) + ls) * fs, 0);
  if (!(room > 0) || k * est(9, 0.08) <= room) return null;
  return { fs: est(8, 0.04) <= room ? 8 : 7, ls: 0.04 };
}
/** (7b) A model's extras cell (w × h, or null: a models.js control's own) and row breaks. */
export const tokCell = (model, id) => { const T = model && TOKENS[model.id], c = T && T.cells && T.cells[id]; return c || TOK_CELL[id] || null; };
export const xbreakOf = model => { const T = model && TOKENS[model.id]; return (T && T.xbreak) || XBREAK; };
/** The DX7's buttons 1–32 (§6.3): the parameter each live one selects in edit mode (op: per operator; eg: per EG step),
 * the function-mode one, and its LCD names. */
export const DX_EDIT = Object.freeze({ 7: 'alg', 8: 'fb', 10: 'ls', 18: 'r', 19: 'f', 20: 'd', 21: 'R', 22: 'L', 26: 's', 27: 'l', 28: 'v', 31: 'tr' });
export const DX_FUNC = Object.freeze({ 17: 'pmd' });
const DX_NAME = { alg: 'ALGORITHM', fb: 'FEEDBACK', ls: 'LFO SPEED', tr: 'TRANSPOSE', pmd: 'WHEEL RANGE', r: 'COARSE', f: 'FINE', d: 'DETUNE', R: 'RATE', L: 'LEVEL', s: 'RATE SCL', l: 'OUT LEVEL', v: 'KEY VEL' };
/** The id a DX7 button addresses in a state {op, eg, mode} (null: not live in that mode). */
export function dxAddr(n, st) {
  if (st.mode === 'function') return DX_FUNC[n] || null;
  if (st.mode !== 'edit') return null;
  const p = DX_EDIT[n];
  if (!p) return null;
  if (p === 'R' || p === 'L') return p + st.eg + '_' + st.op;
  return p.length === 1 ? p + st.op : p; // (r f d s l v: per operator)
}
/** The DX7 LCD's two lines (16 characters each) for a state, the addressed control and its value text. */
export function dxLcd(st, alg, addr, valText, presetNo, presetName) {
  const fit = t => String(t).slice(0, 16).padEnd(16, ' ');
  if (st.mode === 'play') return [fit('INTERNAL' + (presetNo ? ' ' + String(presetNo).padStart(2, '0') : '')), fit(presetName || 'CUSTOM')];
  if (st.mode === 'function') return [fit('FUNCTION CONTROL'), fit((DX_NAME[addr] || '') + '=' + valText)];
  const head = 'ALG' + String(alg).padStart(2, '0') + '     111111';
  if (!addr) return [fit(head), fit('')];
  const m = /^([a-zA-Z])(\d)(?:_(\d))?$/.exec(addr);
  if (m && !['alg', 'fb', 'ls', 'tr'].includes(addr)) {
    const key = m[1], op = m[3] || m[2], eg = m[3] ? m[2] : '';
    return [fit(head), fit('OP' + op + ' ' + DX_NAME[key] + eg + '=' + valText)];
  }
  return [fit(head), fit((DX_NAME[addr] || addr.toUpperCase()) + '=' + valText)];
}

const FONTS = { sans: "'Helvetica Neue', Helvetica, Arial, sans-serif", condensed: "'Arial Narrow', 'Helvetica Neue', Arial, sans-serif",
  rounded: "ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', 'Helvetica Neue', Arial, sans-serif" };
const FRAMES_A = ['none', 'wood', 'metal', 'line'], FRAMES_S = ['box', 'outline', 'header', 'rule', 'none'], TITLES = ['top', 'bottom', 'break', 'header', 'none'];
const DECOR_T = ['rect', 'line', 'path', 'text', 'glyph', 'scale', 'ladder', 'grille', 'stripes', 'louvres', 'screws'];
const STYLES = ['rocker', 'bat', 'slide', 'lever', 'paddle'], LABS = ['n', 's', 'e', 'w', 'none'], PTRS = ['line', 'triangle', 'notch', 'dot', 'fin', 'bar'];
const PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9 .,eE+-]*$/;
const MAKER_RE = new RegExp('\\b(' + MAKERS.join('|') + ')\\b');
const KNOB_BOX = 64 / 50; // today's knob SVG: the skirt is 50 of its 64 viewBox units → the box that draws the skirt at d
const DIAL_IN = 0.6, DIAL_TICK = 1.4, DIAL_LAB = 3.9, DIAL_OUT = 5.4; // printed dial: tick from / length, label radius, extent (mm past the skirt)
const HDR_MM = 7; // a 'header' section's band
const fin = x => typeof x === 'number' && isFinite(x);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const r05 = v => Math.round(v * 2) / 2;
const ceil32 = v => Math.max(DOT, Math.ceil(v / DOT - 1e-9) * DOT);
const q3 = v => Math.round(v * 1000) / 1000;
const n3 = v => String(q3(v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const colorOk = c => typeof c === 'string' && /^(#[0-9a-fA-F]{3,8}|[a-z]+|rgba?\([0-9., %]+\))$/.test(c);

/* ---------------------------------------------------------------- model + layout helpers */
const ctlMaps = new WeakMap();
/** models.js controls of a model by id. @returns {Map<string, object>} */
function ctlsOf(model) {
  let m = ctlMaps.get(model);
  if (!m) { m = new Map(); for (const c of (model && model.controls) || []) m.set(c.id, c); ctlMaps.set(model, m); }
  return m;
}
/** (9) The patch jacks a model's face carries by id, or null (none): a module model's own (moduleModel), else — the
 * instrument model whose console is a patch family's controller (m900) — that controller type's (moog-core's table). */
const jackMaps = new WeakMap();
function portMap(model) {
  if (!isObj(model)) return null;
  if (jackMaps.has(model)) return jackMaps.get(model);
  let js = Array.isArray(model.jacks) ? model.jacks : null;
  if (!js) for (const F of PATCH_FAMS) if (F.fam.model === model.id && F.fam.types[F.fam.ctl]) js = F.fam.types[F.fam.ctl].jacks;
  const m = js ? new Map(js.filter(isObj).map(j => [j.id, j])) : null;
  jackMaps.set(model, m);
  return m;
}
/** (9, IMPL-9 §4.1) A module type's synthetic model (memoised; null: no such module type, or the controller — its face is
 * its instrument model's console, layoutOf(FAMILY.model)): { id 'pm-<type>', name, type, layout (its MODULE_LAYOUTS key),
 * patch (the family id), theme,
 * sections [{ title, c: TYPE.params }], controls (the params: the stored value is the dial position, IMPL-9 §2.3), jacks }. */
const modC = new Map();
export function moduleModel(type) {
  if (modC.has(type)) return modC.get(type);
  for (const F of PATCH_FAMS) {
    const T = typeof type === 'string' && Object.prototype.hasOwnProperty.call(F.fam.types, type) ? F.fam.types[type] : null;
    if (!T || T.face !== 'module') continue;
    const m = Object.freeze({ id: 'pm-' + type, name: T.name, type, layout: T.layout, patch: F.fam.id, theme: F.theme,
      sections: Object.freeze([Object.freeze({ title: T.name, c: T.params })]), controls: T.params, jacks: T.jacks });
    modC.set(type, m);
    return m;
  }
  return null;
}
const isPerf = id => typeof id === 'string' && Object.prototype.hasOwnProperty.call(PERF_TOKENS.kind, id);
const tokOf = (model, id) => { const T = model && TOKENS[model.id]; return T && typeof id === 'string' && id.includes(':') ? T : null; };
const isTok = (model, id) => { if (isPerf(id)) return true; const T = tokOf(model, id); return !!T && (id in T.kind || T.extras.includes(id)); };
/** The kinds a token may take (the model's table: its kind or list — the 808's PRE-SCALE —; a perf token: its list), null
 * for a non-token. */
const tokKinds = (model, id) => { if (isPerf(id)) return PERF_TOKENS.kind[id]; const T = tokOf(model, id); return T && id in T.kind ? [].concat(T.kind[id]) : null; };
/** (7a) A detented token's hardware positions (TOKENS.<model>.pos), else 0. */
export const tokPos = (model, id) => { const T = tokOf(model, id); return (T && T.pos && T.pos[id]) | 0; };
/** (1i) The perf kinds; a lever's raising directions per axis (§5.1: away from the player −y, toward +y, right +x). */
const PERF_K = ['keys', 'wheel', 'lever', 'ribbon', 'pad'], LEVER_UP = { x: ['+x'], y: ['-y', '+y'] };
const capOf = c => (Array.isArray(c.cap) && fin(c.cap[0]) && fin(c.cap[1]) ? c.cap : [10, 6]);
/** A control's own size (mm, w × h). */
function ownOf(c) {
  switch (c.kind) {
    case 'keys': { const B = bedOk(c) ? KY.bedLayout(c) : null; return B ? [B.w, B.h] : [0, 0]; } // (the keys' rectangle: whites · pitch × len)
    case 'knob': case 'rotary': case 'jack': case 'lamp': case 'led': case 'screw': return [+c.d || 0, +c.d || 0];
    case 'slider': { const cap = capOf(c), t = (+c.len || 0) + cap[1]; return c.orient === 'h' ? [t, cap[0]] : [cap[0], t]; }
    default: return [+c.w || 0, +c.h || 0];
  }
}
/** The element box (mm): a knob's / rotary's SVG box draws its skirt at d. */
const boxOf = c => (c.kind === 'knob' || c.kind === 'rotary' ? [c.d * KNOB_BOX, c.d * KNOB_BOX] : ownOf(c));
const hitOf = (c, own) => (Array.isArray(c.hit) && fin(c.hit[0]) && fin(c.hit[1]) ? [c.hit[0], c.hit[1]] : [Math.max(own[0], HIT_DEF_MM), Math.max(own[1], HIT_DEF_MM)]);
/** (8) The SDS-V's trimmer row (dr:trim): TRIM_N trimmers across its box (art), their diameter (mm: d, else what fits, ≤ 5);
 * its hit box's centre off the art's (hitOff [dx, dy] mm: two close rows keep disjoint 14 mm boxes), else null. */
export const TRIM_N = 6;
const trimD = c => (fin(c.d) ? c.d : Math.max(0, Math.min(5, +c.h || 0, (+c.w || 0) / TRIM_N)));
const hitOffOf = c => (c.id === 'dr:trim' && Array.isArray(c.hitOff) && c.hitOff.length === 2 && c.hitOff.every(fin) ? c.hitOff : null);
/** The entries of a buttons / jacks control (each its own press target). */
const entriesOf = c => (Array.isArray(c.at) ? c.at.filter(isObj) : []);
const entryOwn = (c, e) => (c.kind === 'jacks' ? [+(e.d || c.d) || 0, +(e.d || c.d) || 0] : [+(e.w || c.w) || 0, +(e.h || c.h) || 0]);
/** The hardware positions → the value each writes (null: a position we don't emulate), or null for a continuous control.
 * @param {object} c layout control @param {object} mc models.js control */
export function positionsOf(c, mc) {
  if (!mc) return null;
  if (c.kind === 'knob' || (c.kind === 'slider' && mc.t === 'k') || (c.kind === 'switch' && c.level)) return null;
  if (c.kind === 'buttons' || c.kind === 'jacks') return entriesOf(c).map(e => e.v);
  if (c.kind === 'button') return Array.isArray(c.cycle) ? c.cycle.slice() : [0, 1];
  if (Array.isArray(c.map)) return c.map.slice();
  if (mc.t === 'b') return [0, 1];
  if (mc.t === 's') return mc.opts.map((o, i) => i);
  return null;
}
/** (1i) A keys control whose numbers make a bed (the full rules: validate). */
const bedOk = c => Number.isInteger(c.n) && c.n >= 1 && c.n <= 88 && Number.isInteger(c.lo) && fin(c.pitch) && c.pitch > 0 && fin(c.len) && c.len > 0;
const valOk = (mc, v) => (mc.t === 'b' ? v === 0 || v === 1 : mc.t === 's' ? Number.isInteger(v) && v >= 0 && v < mc.opts.length : fin(v) && v >= Math.min(mc.min, mc.max) - 1e-9 && v <= Math.max(mc.min, mc.max) + 1e-9);
/** Where a live control's section is: `sec` by id, else the first section (of its area) holding its centre. */
function secIndex(L, c) {
  const S = Array.isArray(L.sections) ? L.sections : [], a = c.a || 'main';
  if (typeof c.sec === 'string') return S.findIndex(s => s && s.id === c.sec);
  const p = c.kind === 'buttons' || c.kind === 'jacks' ? (entriesOf(c)[0] || c) : c;
  return S.findIndex(s => s && (s.a || 'main') === a && p.x >= s.x - 1e-9 && p.x <= s.x + s.w + 1e-9 && p.y >= s.y - 1e-9 && p.y <= s.y + s.h + 1e-9);
}
const liveOf = (c, model) => !c.inert && typeof c.id === 'string' && c.kind in KINDS && (KINDS[c.kind].length > 0 || (isTok(model, c.id) && c.kind !== 'led' && c.kind !== 'display'));
const showOf = c => !c.inert && (c.kind === 'led' || c.kind === 'display');
/** (9) A live patch jack (validate holds the full rules): never live / show — no widget, cv-module places its span. */
const isPatchJack = c => isObj(c) && !c.inert && c.id == null && (c.kind === 'jack' || c.kind === 'strig') && typeof c.port === 'string' && PORT_RE.test(c.port);

/* ---------------------------------------------------------------- validation */
/**
 * Every problem of a layout for its models.js model, as readable strings (empty = valid; §3.3). The renderer refuses a
 * layout with problems (the model falls back to its Simple panel).
 * @param {object} L layout @param {object} model models.js model @returns {string[]}
 */
export function validate(L, model) {
  const P = [], bad = s => { if (P.length < 200) P.push(s); };
  if (!isObj(L)) return ['layout: not an object'];
  if (!isObj(model) || !Array.isArray(model.controls)) return ['model: not a models.js model'];
  if (L.v !== FORMAT) bad('v: must be ' + FORMAT);
  if (L.id !== model.id) bad(`id: "${L.id}" is not the model's ("${model.id}")`);
  const words = (where, s) => { if (typeof s === 'string' && MAKER_RE.test(s)) bad(`${where}: a maker name ("${s}")`); };
  // scheme and case
  if (L.scheme != null && !isObj(L.scheme)) bad('scheme: not an object');
  if (L.case != null && L.case !== 'wood' && !colorOk(L.case)) bad('case: not a colour (or "wood")');
  const S = isObj(L.scheme) ? L.scheme : {};
  if (S.font != null && !(S.font in FONTS)) bad('scheme.font: one of ' + Object.keys(FONTS).join(', '));
  if (isObj(S.knob) && S.knob.ptrStyle != null && !PTRS.includes(S.knob.ptrStyle)) bad('scheme.knob.ptrStyle: one of ' + PTRS.join(', '));
  for (const f of PERF_K) if (S[f] != null) { if (!isObj(S[f])) bad(`scheme.${f}: not an object`); else for (const [k, v] of Object.entries(S[f])) if (!colorOk(v)) bad(`scheme.${f}.${k}: not a colour`); }
  if (S.trim != null) { if (!isObj(S.trim)) bad('scheme.trim: not an object'); else for (const [k, v] of Object.entries(S.trim)) if (!colorOk(v)) bad(`scheme.trim.${k}: not a colour`); } // ((8) the trimmers' art)
  // areas
  const A = new Map();
  if (!Array.isArray(L.areas) || !L.areas.length) bad('areas: at least one');
  else {
    L.areas.forEach((a, i) => {
      const w = `areas[${i}]`;
      if (!isObj(a)) { bad(w + ': not an object'); return; }
      if (typeof a.id !== 'string' || !a.id) { bad(w + ': id'); return; }
      if (A.has(a.id)) bad(w + `: duplicate id "${a.id}"`);
      if (!Array.isArray(a.src) || a.src.length !== 4 || !a.src.every(fin) || !(a.src[2] > 0) || !(a.src[3] > 0)) { bad(w + ': src [x, y, w, h] with w, h > 0'); return; }
      if (!Array.isArray(a.at) || a.at.length !== 2 || !a.at.every(fin)) { bad(w + ': at [x, y]'); return; }
      if (a.frame != null && !FRAMES_A.includes(a.frame)) bad(w + ': frame one of ' + FRAMES_A.join(', '));
      if (a.fill != null && !colorOk(a.fill)) bad(w + ': fill');
      A.set(a.id, a);
    });
    if (L.areas[0] && L.areas[0].id !== 'main') bad('areas[0]: its id must be "main"');
  }
  const inArea = (a, x, y, w, h, where) => {
    const r = A.get(a || 'main');
    if (!r) { bad(`${where}: unknown area "${a}"`); return false; }
    const e = 1e-6, [sx, sy, sw, sh] = r.src;
    if (x < sx - e || y < sy - e || x + w > sx + sw + e || y + h > sy + sh + e) { bad(`${where}: outside its area "${r.id}"`); return false; }
    return true;
  };
  // content size
  if (A.size) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const a of A.values()) { x0 = Math.min(x0, a.at[0]); y0 = Math.min(y0, a.at[1]); x1 = Math.max(x1, a.at[0] + a.src[2]); y1 = Math.max(y1, a.at[1] + a.src[3]); }
    if (x1 - x0 > MAX_W_MM || y1 - y0 > MAX_H_MM) bad(`content: ${Math.round(x1 - x0)} × ${Math.round(y1 - y0)} mm > ${MAX_W_MM} × ${MAX_H_MM}`);
  }
  // sections
  const secIds = new Set();
  if (!Array.isArray(L.sections)) bad('sections: an array');
  else L.sections.forEach((s, i) => {
    const w = `sections[${i}]`;
    if (!isObj(s)) { bad(w + ': not an object'); return; }
    if (typeof s.id !== 'string' || !s.id || secIds.has(s.id)) bad(w + ': a unique id');
    secIds.add(s.id);
    if (typeof s.label !== 'string') bad(w + ': label');
    words(w + '.label', s.label);
    if (![s.x, s.y, s.w, s.h].every(fin) || !(s.w > 0) || !(s.h > 0)) { bad(w + ': x, y, w, h'); return; }
    if (s.frame != null && !FRAMES_S.includes(s.frame)) bad(w + ': frame one of ' + FRAMES_S.join(', '));
    if (s.title != null && !TITLES.includes(s.title)) bad(w + ': title one of ' + TITLES.join(', '));
    inArea(s.a, s.x, s.y, s.w, s.h, w);
  });
  // controls
  const M = ctlsOf(model), seen = new Map(), T = TOKENS[model.id] || null, hits = [];
  const count = id => seen.set(id, (seen.get(id) || 0) + 1);
  // a repeated token's index (seq:key note 0–12, dx:btn n 1–32, dr:step n 1–16; 7c: an LED's too, the 909's scale rows): in range, each value once
  // ((8) within its group: the SDS-V's memory keys n 1–4 and trimmer rows mem 3 / 4 per channel — the group's field one of its values)
  const idxOk = (c, w) => {
    const ix = T && T.idx && T.idx[c.id];
    if (!ix) return;
    const [f, lo, hi] = ix, g = T.grp && T.grp[c.id];
    if (g && !g[1].includes(c[g[0]])) { bad(w + `: ${g[0]} one of ${g[1].join(', ')}`); return; }
    const key = c.id + '#' + (g ? c[g[0]] + ':' : '') + c[f];
    if (!(Number.isInteger(c[f]) && c[f] >= lo && c[f] <= hi)) bad(w + `: ${f} ${lo}–${hi}`);
    if (seen.has(key)) bad(w + `: ${f} ${c[f]} twice` + (g ? ` (${g[0]} ${c[g[0]]})` : ''));
    seen.set(key, 1);
  };
  // (9) the live patch jacks: kind jack | strig, no id, never inert; the port one of the model's jacks (an S-trigger socket a
  // strig, a 1/4" one a jack), each once, its label named; centres in content mm for the spacing rules below
  const PJ = portMap(model), ports = new Set(), jacks = [];
  const patchJack = (c, w) => {
    if (c.kind !== 'jack' && c.kind !== 'strig') { bad(w + ': port is a patch jack\'s (kind jack | strig)'); return; }
    if (c.inert != null) bad(w + ': a patch jack is live (no inert)');
    if (c.id != null) bad(w + ': a patch jack has no id (its port names it)');
    if (typeof c.port !== 'string' || !PORT_RE.test(c.port)) { bad(w + ': port ' + PORT_RE); return; }
    if (!(typeof c.label === 'string' && c.label.trim())) bad(w + ': a patch jack needs its label');
    if (ports.has(c.port)) bad(w + `: port "${c.port}" twice`);
    ports.add(c.port);
    const J = PJ && PJ.get(c.port);
    if (!J) bad(w + `: port "${c.port}" is not a jack of the model`);
    else if ((J.sig === 's') !== (c.kind === 'strig')) bad(w + `: ${c.port} is ${J.sig === 's' ? 'an S-trigger socket (strig)' : 'a 1/4" jack (jack)'}`);
    if (secIndex(L, c) < 0) bad(w + ': not inside a section' + (c.sec ? ` ("${c.sec}" unknown)` : ''));
    const ar = A.get(c.a || 'main');
    if (ar) jacks.push({ w, x: c.x + ar.at[0] - ar.src[0], y: c.y + ar.at[1] - ar.src[1] });
  };
  if (!Array.isArray(L.controls)) bad('controls: an array');
  else L.controls.forEach((c, i) => {
    const w = `controls[${i}]` + (c && c.id ? ` (${c.id})` : '');
    if (!isObj(c)) { bad(w + ': not an object'); return; }
    if (!(c.kind in KINDS)) { bad(w + `: unknown kind "${c.kind}"`); return; }
    if (!fin(c.x) || !fin(c.y)) { bad(w + ': x, y'); return; }
    if (c.lab != null && !LABS.includes(c.lab)) bad(w + ': lab one of ' + LABS.join(', '));
    if (c.label != null && typeof c.label !== 'string') bad(w + ': label');
    words(w + '.label', c.label);
    if (Array.isArray(c.legends)) c.legends.forEach(s => words(w + '.legends', s));
    if (c.style != null && !STYLES.includes(c.style)) bad(w + ': style one of ' + STYLES.join(', '));
    if (c.orient != null && c.orient !== 'v' && c.orient !== 'h') bad(w + ': orient v | h');
    // (7b) a rotary's sweep centre (degrees clockwise from 12 o'clock; the 606's MODE detents sit at +37° … +127°)
    if (c.rot != null && !(c.kind === 'rotary' && fin(c.rot) && Math.abs(c.rot) <= 180)) bad(w + ': rot (a rotary\'s sweep centre) −180…180°');
    if (isObj(c.skin) && c.skin.ptrStyle != null && !PTRS.includes(c.skin.ptrStyle)) bad(w + ': skin.ptrStyle');
    // sizes
    const k = c.kind;
    // (7a) inert: true (dimmed, not emulated) or 'later' (a labelled jack at full contrast: cable-able with full patching)
    if (c.inert != null && typeof c.inert !== 'boolean' && c.inert !== 'later') bad(w + ": inert true | 'later'");
    if (c.inert === 'later' && k !== 'jack') bad(w + ": inert 'later' is for a jack only");
    if (c.inert === 'later' && !(typeof c.label === 'string' && c.label.trim())) bad(w + ": inert 'later' needs its label (the output it names)");
    if ((k === 'knob' || k === 'rotary' || k === 'jack' || k === 'lamp' || k === 'led' || k === 'screw') && !(c.d > 0)) bad(w + ': d > 0');
    if (k === 'slider' && (!(c.len > 0) || (c.cap != null && !(Array.isArray(c.cap) && c.cap[0] > 0 && c.cap[1] > 0)))) bad(w + ': len > 0, cap [w, h]');
    if ((k === 'switch' || k === 'button' || k === 'display' || k === 'fuse' || k === 'strig' || k === 'slot') && (!(c.w > 0) || !(c.h > 0))) bad(w + ': w, h > 0');
    if ((k === 'buttons' || k === 'jacks') && (!entriesOf(c).length || entriesOf(c).some(e => !fin(e.x) || !fin(e.y)))) { bad(w + ': at [{v, x, y}, …]'); return; }
    if (k === 'jacks' && !entriesOf(c).every(e => (e.d || c.d) > 0)) bad(w + ': d > 0');
    if (k === 'buttons' && !entriesOf(c).every(e => (e.w || c.w) > 0 && (e.h || c.h) > 0)) bad(w + ': w, h > 0');
    if (k === 'switch' && c.positions != null && !(Number.isInteger(c.positions) && c.positions >= 2 && c.positions <= 4)) bad(w + ': positions 2–4');
    // (1i) the bed and the controllers (IMPL-1i §2): a bed's numbers; a controller's slot; skins are colours
    if (k === 'keys') {
      if (!(Number.isInteger(c.n) && c.n >= 1 && c.n <= 88)) bad(w + ': n an integer 1–88');
      if (!Number.isInteger(c.lo)) bad(w + ': lo an integer');
      else if (Number.isInteger(c.n) && !(c.lo >= 0 && c.lo + c.n - 1 <= 127 && KY.isWhite(c.lo) && KY.isWhite(c.lo + c.n - 1))) bad(w + ': lo and lo + n − 1 white keys within 0–127');
      if (!(fin(c.pitch) && c.pitch >= 18 && c.pitch <= 26)) bad(w + ': pitch 18–26 mm');
      if (!(fin(c.len) && c.len >= 80 && c.len <= 200)) bad(w + ': len 80–200 mm');
      if (c.black != null && !isObj(c.black)) bad(w + ': black { w, len }');
      else if (c.black != null) {
        if (c.black.w != null && !(fin(c.black.w) && c.black.w > 0 && c.black.w < c.pitch)) bad(w + ': black.w > 0, < pitch');
        if (c.black.len != null && !(fin(c.black.len) && c.black.len > 0 && c.black.len < c.len)) bad(w + ': black.len > 0, < len');
      }
      if (c.front != null && !(fin(c.front) && c.front >= 0 && c.front <= KY.FRONT_MM)) bad(w + `: front 0–${KY.FRONT_MM} mm`);
      if (c.at != null && typeof c.at !== 'boolean') bad(w + ': at true | false');
    } else if (PERF_K.includes(k)) {
      if (!(c.w > 0) || !(c.h > 0)) bad(w + ': w, h > 0');
      if (k === 'wheel' && c.detent != null && typeof c.detent !== 'boolean') bad(w + ': detent true | false');
      if (k === 'lever' && !(Object.prototype.hasOwnProperty.call(LEVER_UP, c.axis) && LEVER_UP[c.axis].includes(c.up))) bad(w + ': axis x (up +x) | y (up -y | +y)');
      if (k === 'ribbon' && c.span != null && !(fin(c.span) && c.span > 0)) bad(w + ': span > 0');
      if (k === 'pad' && c.rise != null && !(fin(c.rise) && c.rise > 0)) bad(w + ': rise > 0 s');
    }
    if (PERF_K.includes(k) && c.skin != null) {
      if (!isObj(c.skin)) bad(w + ': skin');
      else for (const [f, v] of Object.entries(c.skin)) { words(`${w}.skin.${f}`, v); if (!colorOk(v)) bad(`${w}: skin.${f} not a colour`); }
    }
    // inside the area
    const parts = k === 'buttons' || k === 'jacks' ? entriesOf(c).map(e => ({ x: e.x, y: e.y, o: entryOwn(c, e) })) : [{ x: c.x, y: c.y, o: ownOf(c) }];
    for (const p of parts) inArea(c.a, p.x - p.o[0] / 2, p.y - p.o[1] / 2, p.o[0], p.o[1], w);
    if (c.port != null) { patchJack(c, w); return; } // ((9) a live patch jack)
    // (8) hitOff [dx, dy]: a live trimmer row's hit box off its art (the SDS-V's two close rows), no other control's
    if (c.hitOff != null && !(c.id === 'dr:trim' && !c.inert && hitOffOf(c))) bad(w + ': hitOff [dx, dy] (mm) is a trimmer row\'s (dr:trim) only');
    if (c.inert) { if (c.id != null && !(typeof c.id === 'string' && c.id.startsWith('#'))) bad(w + ': an inert control has no id'); return; }
    // displays
    const tk = tokKinds(model, c.id); // (a token's kinds: the model's one, a perf token's list)
    if (k === 'led' || k === 'display') {
      if (c.id != null && !(tk && tk.includes(k))) bad(w + ': a display carries no id (or its token)');
      if (k === 'led' && c.id == null) {
        if (!M.has(c.of)) bad(w + `: of "${c.of}" is not a control of the model`);
        if (!Array.isArray(c.when) || !['ne', 'eq', 'ge', 'in'].includes(c.when[0])) bad(w + ': when [op, value]');
      }
      if (k === 'display' && c.id == null && c.show !== 'preset') bad(w + ': show "preset"');
      if (c.id != null && tk && tk.includes(k)) { // (7c) a repeated LED token by its index; a display token's characters fit its box
        idxOk(c, w);
        const dg = T && T.digits && T.digits[c.id], mn = dg ? dspMin(dg) : null;
        if (mn && k === 'display' && (c.w < mn[0] - 1e-9 || c.h < mn[1] - 1e-9)) bad(w + `: ${dg} characters need a box ≥ ${mn[0]} × ${mn[1]} mm (the display's ${DSP_FONT.px} px font)`);
      }
      if (c.id != null) count(c.id);
      return;
    }
    if (!(KINDS[k].length || (tk && tk.includes(k)))) { // (a token of another kind; a token-like id we do not know: say so)
      bad(w + (tk ? `: ${c.id} must be a ${tk.join(' | ')}` : typeof c.id === 'string' && c.id.includes(':') ? `: "${c.id}" is not a control of the model` : `: a ${k} is decoration only (inert: true)`));
      return;
    }
    if (typeof c.id !== 'string' || !c.id) { bad(w + ': a live control needs an id (or inert: true)'); return; }
    const mc = M.get(c.id);
    if (!mc) {
      if (!tk) { bad(w + `: "${c.id}" is not a control of the model`); return; }
      if (!tk.includes(k)) bad(w + `: ${c.id} must be a ${tk.join(' | ')}`);
      idxOk(c, w);
      // (7a) a detented token (the 808's rotaries and switches): its legends one per hardware position (a rotary prints them)
      const np = tokPos(model, c.id);
      if (np && tk.includes(k)) {
        if (Array.isArray(c.legends) ? c.legends.length !== np : k === 'rotary') bad(w + `: ${Array.isArray(c.legends) ? c.legends.length : 'no'} legends for ${np} positions`);
        if (k === 'switch' && c.positions != null && c.positions !== np) bad(w + `: positions ${c.positions} ≠ ${np}`);
      }
      // (7b) a switch token's orientation (the 606's SCALE: vertical, its first position at the top)
      const want = T && T.orient && T.orient[c.id];
      if (want && k === 'switch' && (c.orient || (c.h > c.w ? 'v' : 'h')) !== want) bad(w + `: ${c.id} is a ${want === 'v' ? 'vertical' : 'horizontal'} switch (orient ${want})`);
      if (c.id === 'dr:step' && c.led === 'none') bad(w + ': a step key shows its LED (led cap | above | below)');
      else if (T && T.led && T.led.includes(c.id) && c.led === 'none') bad(w + `: ${c.id} shows its LED (led cap | above | below)`); // (7c: the 909's LED keys; 8: the SDS-V's memory keys)
      // (8) a trimmer row: TRIM_N trimmers (art, 2–8 mm) across its box; its hit box (hitOff) still covers that art
      if (c.id === 'dr:trim' && k === 'button') {
        const td = trimD(c), ho = hitOffOf(c), hb = hitOf(c, ownOf(c));
        if (c.d != null && !(fin(c.d) && c.d >= 2 && c.d <= 8)) bad(w + ': d (a trimmer\'s diameter) 2–8 mm');
        else if (TRIM_N * td > c.w + 1e-9 || td > c.h + 1e-9) bad(w + `: ${TRIM_N} trimmers of ${n3(td)} mm do not fit its ${n3(c.w)} × ${n3(c.h)} mm box`);
        if (ho && (Math.abs(ho[0]) > (hb[0] - c.w) / 2 + 1e-9 || Math.abs(ho[1]) > (hb[1] - c.h) / 2 + 1e-9)) bad(w + ': hitOff moves the hit box off its trimmers (it must cover the row)');
      }
      count(c.id);
    } else {
      if (!KINDS[k].includes(mc.t)) bad(w + `: a ${k} cannot carry a "${mc.t}" control`);
      if (mc.t === 'k' && k === 'switch' && !c.level && !Array.isArray(c.map)) bad(w + ': a "k" switch needs map or level');
      if (mc.t === 'k' && k === 'rotary' && !Array.isArray(c.map)) bad(w + ': a "k" rotary needs map');
      if (mc.t === 'k' && k === 'button' && !Array.isArray(c.cycle)) bad(w + ': a "k" button needs cycle');
      if (mc.t === 'k' && k === 'buttons' && entriesOf(c).some(e => !fin(e.v))) bad(w + ': a "k" buttons entry needs v');
      if (mc.t === 's' && k === 'slider' && !Array.isArray(c.legends) && !Array.isArray(c.map)) bad(w + ': an "s" slider needs legends (its detents)');
      if (mc.t === 's' && k === 'button' && !Array.isArray(c.cycle)) bad(w + ': an "s" button needs cycle');
      if (mc.t === 'b' && k === 'switch' && c.level) bad(w + ': level is for a "k" control');
      const pos = positionsOf(c, mc);
      if (pos) {
        if (pos.length < 2) bad(w + ': at least 2 positions');
        if (!pos.some(v => v != null)) bad(w + ': every position is null');
        for (const v of pos) if (v != null && !valOk(mc, v)) { bad(w + `: ${JSON.stringify(v)} is not a value of ${mc.id}`); break; }
        if (Array.isArray(c.legends) && c.legends.length !== pos.length) bad(w + `: ${c.legends.length} legends for ${pos.length} positions`);
        if (k === 'switch' && c.positions != null && c.positions !== pos.length) bad(w + `: positions ${c.positions} ≠ ${pos.length}`);
        if (k === 'switch' && pos.length > 4) bad(w + ': a switch has 2–4 positions');
        if (mc.t === 's' && !Array.isArray(c.map) && k !== 'buttons' && k !== 'jacks' && k !== 'button' && pos.length !== mc.opts.length) bad(w + ': positions ≠ options (use map)');
      }
      if (k === 'buttons' && isObj(c.combo)) {
        for (const [v, pr] of Object.entries(c.combo)) if (!valOk(mc, +v) || !Array.isArray(pr) || pr.length !== 2 || !pr.every(x => entriesOf(c).some(e => e.v === x))) bad(w + `: combo ${v}`);
      }
      count(c.id);
    }
    // hit boxes (content mm)
    if (A.has(c.a || 'main')) {
      const ar = A.get(c.a || 'main'), dx = ar.at[0] - ar.src[0], dy = ar.at[1] - ar.src[1];
      const ho = hitOffOf(c) || [0, 0]; // ((8) a trimmer row's hit box off its art)
      for (const p of parts) {
        const hb = k === 'keys' ? p.o : hitOf(c, p.o); // (1i) a bed: the keys' rectangle (its band, clamped by geometry to the room the others leave, never overlaps one)
        if (hb[0] < HIT_MIN_MM - 1e-9 || hb[1] < HIT_MIN_MM - 1e-9) bad(`${w}: hit box ${n3(hb[0])} × ${n3(hb[1])} mm < ${HIT_MIN_MM} mm`);
        hits.push({ w, x: p.x + dx + ho[0] - hb[0] / 2, y: p.y + dy + ho[1] - hb[1] / 2, ww: hb[0], hh: hb[1] });
      }
    }
    if (secIndex(L, c) < 0) bad(w + ': not inside a section' + (c.sec ? ` ("${c.sec}" unknown)` : ''));
  });
  for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) {
    const a = hits[i], b = hits[j];
    if (a.x < b.x + b.ww - 1e-6 && b.x < a.x + a.ww - 1e-6 && a.y < b.y + b.hh - 1e-6 && b.y < a.y + a.hh - 1e-6) bad(`${a.w} and ${b.w}: hit boxes overlap`);
  }
  // (9) patch jacks: centres ≥ JACK_PITCH_MM apart, each ≥ JACK_CLEAR_MM from every other live control's hit box; every jack
  // of the model on the face
  for (let i = 0; i < jacks.length; i++) for (let j = i + 1; j < jacks.length; j++) {
    const a = jacks[i], b = jacks[j], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d < JACK_PITCH_MM - 1e-9) bad(`${a.w} and ${b.w}: jack centres ${n3(d)} mm apart < ${JACK_PITCH_MM} mm`);
  }
  for (const j of jacks) for (const r of hits) {
    const d = Math.hypot(Math.max(r.x - j.x, 0, j.x - r.x - r.ww), Math.max(r.y - j.y, 0, j.y - r.y - r.hh));
    if (d < JACK_CLEAR_MM - 1e-9) bad(`${j.w}: its centre ${n3(d)} mm from ${r.w}'s hit box < ${JACK_CLEAR_MM} mm`);
  }
  if (PJ) for (const id of PJ.keys()) if (!ports.has(id)) bad(`${id}: not placed (a patch jack of the model)`);
  // extras
  const ex = L.extras;
  if (!isObj(ex) || !Array.isArray(ex.ids)) bad('extras: { ids: [] }');
  else {
    for (const id of ex.ids) {
      if (M.has(id)) count(id);
      else if (T && T.extras.includes(id)) count(id);
      else bad(`extras: "${id}" is not a control of the model`);
    }
    if (ex.caption != null) { if (typeof ex.caption !== 'string') bad('extras.caption'); words('extras.caption', ex.caption); }
    // (7c) a model's own caption (the 909's names our cymbal sounds, D4): the layout omits it (the geometry supplies it) or carries it exactly
    if (ex.caption != null && T && T.caption && ex.caption !== T.caption) bad(`extras.caption: the ${model.id}'s is "${T.caption}" (or none: the geometry supplies it)`);
    if (ex.at != null) {
      if (!Array.isArray(ex.at) || ex.at.length !== 4 || !ex.at.every(fin) || !(ex.at[2] > 0) || !(ex.at[3] > 0)) bad('extras.at: [x, y, w, h]');
      else {
        for (const a of A.values()) {
          const [ax, ay] = a.at, [, , aw, ah] = a.src, [x, y, ww, hh] = ex.at;
          if (x < ax + aw - 1e-6 && ax < x + ww - 1e-6 && y < ay + ah - 1e-6 && ay < y + hh - 1e-6) bad(`extras.at: overlaps area "${a.id}"`);
        }
        const g = P.length ? null : geometry(L, model);
        if (g && g.extras && g.extras.over) bad('extras.at: the cells do not fit');
      }
    }
  }
  // (8) a grouped token bound to a models.js switch (the SDS-V's memory keys → x<ch>p) places it once for each group present
  if (T && T.bind) for (const [id, pat] of Object.entries(T.bind)) {
    const g = T.grp && T.grp[id], ks = [...seen.keys()];
    for (const gv of g ? g[1] : []) if (ks.some(k => k.startsWith(id + '#' + gv + ':'))) count(pat.replace('?', gv));
  }
  // every models.js id exactly once (live or extras); tokens at most once (seq:key / dx:btn may repeat); the DX7's
  // buttons address the operator ids (§6.3: they count as placed when dx:btn is)
  const dxAddr = model.id === 'dx7' && seen.has('dx:btn');
  for (const id of M.keys()) {
    const n = seen.get(id) || 0;
    if (n === 0 && !(dxAddr && id !== 'vol' && id !== 'dac')) bad(`${id}: not placed (a live control or extras.ids)`);
    if (n > 1) bad(`${id}: placed ${n} times`);
  }
  // tokens: at most once (seq:key / dx:btn may repeat); the perf tokens on every model, whether it has a table or not
  for (const [id, n] of seen) if (!M.has(id) && !id.includes('#') && n > 1 && (isPerf(id) || (T && !T.multi.includes(id)))) bad(`${id}: placed ${n} times`);
  // (7a) a repeated token that needs every index (the 808's 16 step keys; (8) in every group: the SDS-V's four memory keys and
  // two trimmer rows of each channel)
  if (T && T.full) for (const id of T.full) {
    const [f, lo, hi] = T.idx[id], g = T.grp && T.grp[id];
    for (const gv of g ? g[1] : [null]) {
      const miss = [], pre = id + '#' + (g ? gv + ':' : '');
      for (let i = lo; i <= hi; i++) if (!seen.has(pre + i)) miss.push(i);
      if (miss.length) bad(`${id}: ${g ? g[0] + ' ' + gv + ' ' : ''}${f} ${miss.join(', ')} missing (all ${hi - lo + 1}${g ? ' of every ' + g[0] : ''} are on the panel)`);
    }
  }
  // decor
  if (L.decor != null && !Array.isArray(L.decor)) bad('decor: an array');
  else if (Array.isArray(L.decor)) {
    if (L.decor.length > MAX_DECOR) bad(`decor: ${L.decor.length} items > ${MAX_DECOR}`);
    L.decor.forEach((d, i) => {
      const w = `decor[${i}]`;
      if (!isObj(d) || !DECOR_T.includes(d.t)) { bad(w + ': t one of ' + DECOR_T.join(', ')); return; }
      if (d.t === 'text') {
        if (typeof d.s !== 'string') bad(w + ': s');
        words(w, d.s);
        // (7a review 2) xs: one x per character (a row of glyphs as one <text>); variant: small-caps only
        if (d.xs != null && !(Array.isArray(d.xs) && typeof d.s === 'string' && d.xs.length === [...d.s].length && d.xs.every(fin))) bad(w + ': xs (one finite x per character of s)');
        if (d.variant != null && d.variant !== 'small-caps') bad(w + ': variant (small-caps)');
      }
      if (d.t === 'path' && (typeof d.d !== 'string' || !PATH_RE.test(d.d))) bad(w + ': path data');
      if (d.t === 'glyph' && !(d.g in GLYPHS)) bad(w + `: unknown glyph "${d.g}"`);
      if ((d.t === 'scale' || d.t === 'ladder') && Array.isArray(d.labels)) d.labels.forEach(s => words(w, s));
      for (const f of ['fill', 'stroke']) if (d[f] != null && d[f] !== 'wood' && d[f] !== 'none' && !colorOk(d[f])) bad(w + ': ' + f);
      const bb = decorBox(d);
      if (!bb) { bad(w + ': coordinates'); return; }
      if (bb !== 'skip') inArea(d.a, bb[0], bb[1], bb[2], bb[3], w);
    });
  }
  return P;
}
// a decor item's bounding box in its area frame (mm), or null when its numbers are not finite
function decorBox(d) {
  const all = (...v) => v.every(fin);
  switch (d.t) {
    case 'rect': case 'grille': case 'stripes': case 'louvres': return all(d.x, d.y, d.w, d.h) ? [d.x, d.y, d.w, d.h] : null;
    case 'line': return all(d.x1, d.y1, d.x2, d.y2) ? [Math.min(d.x1, d.x2), Math.min(d.y1, d.y2), Math.abs(d.x2 - d.x1), Math.abs(d.y2 - d.y1)] : null;
    case 'text': return !all(d.x, d.y) ? null : Array.isArray(d.xs) && d.xs.length && d.xs.every(fin) ? [Math.min(d.x, ...d.xs), d.y, Math.max(d.x, ...d.xs) - Math.min(d.x, ...d.xs), 0] : [d.x, d.y, 0, 0];
    case 'glyph': return all(d.x, d.y, d.size) ? [d.x - d.size / 2, d.y - d.size / 2, d.size, d.size] : null;
    case 'scale': return all(d.x, d.y, d.d) ? [d.x, d.y, 0, 0] : null;
    case 'ladder': return all(d.x, d.y, d.len) ? [d.x, d.y, 0, 0] : null;
    case 'screws': return Array.isArray(d.pts) && d.pts.length && d.pts.every(p => Array.isArray(p) && all(p[0], p[1]))
      ? (() => { const xs = d.pts.map(p => p[0]), ys = d.pts.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]; })() : null;
    case 'path': return d.x == null && d.y == null ? 'skip' : all(d.x, d.y) ? [d.x, d.y, 0, 0] : null; // (path data: its own frame, unchecked)
    default: return null;
  }
}

/** The layout of `id` when it validates against `model` (problems: console.warn once, then null: Simple only).
 * (globalThis.__synthTest.panels: the page simulations' fixture layouts, by model id — never cached.) */
const usableC = new Map();
const testLayout = id => { const t = globalThis.__synthTest; return t && t.panels && Object.prototype.hasOwnProperty.call(t.panels, id) ? t.panels[id] : undefined; };
export function usable(id, model) {
  const TL = testLayout(id);
  if (TL === undefined && usableC.has(id)) { const u = usableC.get(id); if (u.model === model) return u.L; }
  const L = TL !== undefined ? TL : layoutOf(id);
  let ok = null;
  if (L && model && model.id === id) {
    const p = validate(L, model);
    const toks = [];
    for (const c of L.controls || []) if (c && typeof c.id === 'string' && isTok(model, c.id) && !RENDERED_TOKENS.has(c.id)) toks.push(c.id);
    for (const t of (L.extras && L.extras.ids) || []) if (isTok(model, t) && !RENDERED_TOKENS.has(t)) toks.push(t);
    if (toks.length) p.push('tokens not rendered by this build: ' + [...new Set(toks)].join(', '));
    if (p.length) { try { console.warn(`cv-panel: the ${id} hardware layout is not used (Simple panel instead):\n  ` + p.slice(0, 12).join('\n  ')); } catch (err) { /* no console */ } }
    else ok = L;
  }
  if (TL === undefined) usableC.set(id, { model, L: ok });
  return ok;
}
/** (9, IMPL-9 §4.1) A module type's face when it validates against moduleModel(type) (problems: console.warn once, then null:
 * the host draws no face); __synthTest.panels['pm-<type>'] a page simulation's fixture, never cached. Render it with
 * render(root, moduleLayout(type), moduleModel(type), api). */
const moduleC = new Map();
export function moduleLayout(type) {
  const model = moduleModel(type);
  if (!model) return null;
  const TL = testLayout(model.id);
  if (TL === undefined && moduleC.has(type)) return moduleC.get(type);
  const L = TL !== undefined ? TL : moduleLayoutOf(model.layout);
  let ok = null;
  if (L) {
    const p = validate(L, model);
    if (p.length) { try { console.warn(`cv-panel: the ${type} module face is not used:\n  ` + p.slice(0, 12).join('\n  ')); } catch (err) { /* no console */ } }
    else ok = L;
  }
  if (TL === undefined) moduleC.set(type, ok);
  return ok;
}

/* ---------------------------------------------------------------- geometry */
const geoC = new WeakMap();
/**
 * The panel in module-body px (origin: the body's top-left, under the 40 px bar), pure maths (cached per layout).
 * (1i) A keys control's o.bed: { lo, hi, n, whites, at, x, y, w, h (the keys' rectangle), front, band, box (keys + band),
 * keys: [{ note, black, x, y, w, h }], mm (the cv-keys layout with the clamped front) } — body px, unrounded (three decimals).
 * @returns {{W: number, H: number, body: {w: number, h: number}, content: {x: number, y: number, w: number, h: number},
 *   mm: {x0: number, y0: number, offX: number}, areas: object[], sections: object[], controls: object[], order: number[],
 *   extras: {x: number, y: number, w: number, h: number, cells: object[], over: boolean, note: boolean} | null}}
 */
export function geometry(L, model) {
  let g = geoC.get(L);
  if (g && g.model === model) return g.geo;
  const A = new Map();
  for (const a of L.areas) A.set(a.id, a);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const a of A.values()) { x0 = Math.min(x0, a.at[0]); y0 = Math.min(y0, a.at[1]); x1 = Math.max(x1, a.at[0] + a.src[2]); y1 = Math.max(y1, a.at[1] + a.src[3]); }
  const ex = isObj(L.extras) ? L.extras : { ids: [] }, xat = Array.isArray(ex.at) && ex.at.length === 4 ? ex.at : null;
  if (xat) { x0 = Math.min(x0, xat[0]); y0 = Math.min(y0, xat[1]); x1 = Math.max(x1, xat[0] + xat[2]); y1 = Math.max(y1, xat[1] + xat[3]); }
  const cw = x1 - x0, ch = y1 - y0, X = PX_PER_MM;
  const W = ceil32(cw * X), offX = r05((W - cw * X) / 2);
  const px = x => r05(offX + (x - x0) * X), py = y => r05((y - y0) * X);
  const toC = (a, x, y) => { const r = A.get(a || 'main') || A.get('main'); return [x - r.src[0] + r.at[0], y - r.src[1] + r.at[1]]; };
  const rectPx = (cx, cy, w, h) => ({ x: r05(offX + (cx - x0 - w / 2) * X), y: r05((cy - y0 - h / 2) * X), w: r05(w * X), h: r05(h * X) });
  const rectQ = (cx, cy, w, h) => ({ x: q3(offX + (cx - x0 - w / 2) * X), y: q3((cy - y0 - h / 2) * X), w: q3(w * X), h: q3(h * X) }); // (1i: unrounded)
  const M = ctlsOf(model);
  // controls
  const controls = (L.controls || []).map((c, i) => {
    const live = liveOf(c, model), show = showOf(c), [cx, cy] = toC(c.a, c.x, c.y);
    const o = { i, id: typeof c.id === 'string' ? c.id : null, kind: c.kind, live, show, inert: !!c.inert, a: c.a || 'main', cx, cy, sec: live || show ? secIndex(L, c) : -1 };
    if (c.kind === 'buttons' || c.kind === 'jacks') {
      o.entries = entriesOf(c).map(e => { const [ex2, ey2] = toC(c.a, e.x, e.y), ow = entryOwn(c, e), hb = hitOf(c, ow); return { v: e.v, cx: ex2, cy: ey2, box: rectPx(ex2, ey2, ow[0], ow[1]), hit: rectPx(ex2, ey2, hb[0], hb[1]) }; });
      const u = (k) => { let a = Infinity, b = Infinity, cc = -Infinity, d = -Infinity; for (const e of o.entries) { const r = e[k]; a = Math.min(a, r.x); b = Math.min(b, r.y); cc = Math.max(cc, r.x + r.w); d = Math.max(d, r.y + r.h); } return { x: a, y: b, w: cc - a, h: d - b }; };
      o.box = u('box'); o.hit = u('hit');
    } else {
      const ow = ownOf(c), bx = boxOf(c), hb = hitOf(c, ow), ho = hitOffOf(c); // ((8) a trimmer row's hit box off its art)
      o.box = rectPx(cx, cy, bx[0], bx[1]); o.own = rectPx(cx, cy, ow[0], ow[1]); o.hit = ho ? rectPx(cx + ho[0], cy + ho[1], hb[0], hb[1]) : rectPx(cx, cy, hb[0], hb[1]);
      if (PERF_K.includes(c.kind) && c.kind !== 'keys') o.box = o.own = rectQ(cx, cy, ow[0], ow[1]); // (1i) a controller's DOM window exactly over its slot's art
    }
    if (live && M.has(c.id)) o.mc = M.get(c.id);
    if (isPatchJack(c)) o.port = c.port; // ((9) a live patch jack: no widget here, listed in jacks)
    return o;
  });
  // the DOM / Tab order: sections in layout order, then rows (top to bottom, 8 mm apart), left to right in each
  const order = [], bySec = new Map();
  for (const o of controls) if (o.live || o.show) { const k = o.sec; if (!bySec.has(k)) bySec.set(k, []); bySec.get(k).push(o); }
  for (const k of [...bySec.keys()].sort((a, b) => (a < 0 ? 1e9 : a) - (b < 0 ? 1e9 : b))) {
    const list = bySec.get(k).sort((a, b) => a.cy - b.cy || a.cx - b.cx);
    let row = [], top = -Infinity;
    const flush = () => { row.sort((a, b) => a.cx - b.cx || a.cy - b.cy); for (const o of row) order.push(o.i); row = []; };
    for (const o of list) { if (o.cy - top > 8) { flush(); top = o.cy; } row.push(o); }
    flush();
  }
  // extras
  // (the "Dimmed controls are not emulated" note: the dimmed inert items; a 7a `inert: 'later'` jack is drawn at full contrast)
  const ids = Array.isArray(ex.ids) ? ex.ids.filter(id => typeof id === 'string') : [], inert = (L.controls || []).some(c => c && c.inert && c.inert !== 'later');
  let extras = null, exH = 0;
  const XB = xbreakOf(model);
  const cellW = id => { const mc = M.get(id), tc = tokCell(model, id); if (tc) return tc[0]; return mc ? (mc.t === 's' ? selCellW(mc.opts) : XCELL[mc.t] || 72) : 72; };
  const cellH = id => { const tc = tokCell(model, id); return tc ? tc[1] : XROW; };
  if (ids.length || inert) {
    const r = xat ? { x: px(xat[0]), y: py(xat[1]), w: r05(xat[2] * X), h: r05(xat[3] * X) } : { x: 0, y: r05(ch * X), w: W, h: 0 };
    const cells = [];
    let x = r.x + XPAD, y = r.y + XCAP, rowH = 0, over = false, brk = false;
    for (const id of ids) {
      const w = cellW(id), h = cellH(id);
      if (!xat && x > r.x + XPAD && (brk || x + w > r.x + r.w - XPAD)) { x = r.x + XPAD; y += rowH; rowH = 0; }
      cells.push({ id, x, y, w, h });
      x += w; rowH = Math.max(rowH, h); brk = XB.includes(id);
      if (xat && (x > r.x + r.w + 1e-6 || y + h > r.y + r.h + 1e-6)) over = true;
    }
    if (!xat) { r.h = XCAP + (ids.length ? rowH + (y - r.y - XCAP) + XPAD : 0); exH = r.h; }
    const T = model && TOKENS[model.id]; // ((7c) a model's own caption: the 909's)
    extras = Object.assign(r, { cells, over, note: inert, caption: ids.length ? (typeof ex.caption === 'string' ? ex.caption : T && T.caption ? T.caption : model && model.family === 'drums' ? XCAPTION_DRUMS : XCAPTION) : '' });
  }
  const H = ceil32(BAR_H + ch * X + exH);
  // (1i) a bed: cv-keys.bedLayout in body px, unrounded (mm × 2, three decimals — never rectPx: its half-px steps would
  // offset the pressed-key shades from the art), the one source for the art, the overlays, the hit test and the tests. The
  // front band (c.front, default FRONT_MM) is clamped to the room below the keys inside the body: never over the extras
  // strip or another live hit box, 0 where the keys end at the body's edge (an inert bed: none). Box and hit = keys + band.
  for (const o of controls) {
    const c = L.controls[o.i];
    if (o.kind !== 'keys' || !bedOk(c)) continue;
    const B0 = KY.bedLayout(c), bx = offX + (o.cx - B0.w / 2 - x0) * X, by = (o.cy - B0.h / 2 - y0) * X, bot = by + B0.h * X, rt = bx + B0.w * X;
    let lim = H - BAR_H;
    const under = r => r.y + r.h > bot + 1e-6 && r.x < rt - 1e-6 && bx < r.x + r.w - 1e-6; // reaches below the keys' front, across the bed
    if (o.live && extras && under(extras)) lim = Math.min(lim, extras.y);
    if (o.live) for (const q of controls) if (q.live && q !== o) for (const r of q.entries ? q.entries.map(e => e.hit) : [q.hit]) if (under(r)) lim = Math.min(lim, r.y);
    const B = KY.bedLayout(c, o.live ? Math.max(0, Math.min(B0.front * X, lim - bot)) / X : 0);
    const R = (x, y, w, h) => ({ x: q3(x), y: q3(y), w: q3(w), h: q3(h) });
    const kr = R(bx, by, B.w * X, B.h * X), band = R(bx, bot, B.w * X, B.front * X), box = R(bx, by, B.w * X, (B.h + B.front) * X);
    o.bed = Object.assign({ lo: B.lo, hi: B.hi, n: B.n, whites: B.whites, at: c.at === true, front: band.h, band, box }, kr,
      { keys: B.keys.map(k => Object.assign({ note: k.note, black: k.black }, R(bx + k.x * X, by + k.y * X, k.w * X, k.h * X))), mm: B });
    o.own = kr; o.box = box; o.hit = box;
  }
  // (9, IMPL-9 §4.2) the live patch jacks in body px (the jack spec adds BAR_H — one owner, the host's), unrounded (three
  // decimals: the face draws them at the layout's mm): centre, the nut (d; a strig's w × h, d its longer side), the jack's
  // own label (the model's table, else the layout's), and `hit` — the widest hit circle (px) that touches no other jack's
  // (its nearest centre − 2) and covers no other live control's hit box (twice its clearance), ≤ JACK_HIT_MAX; jackPitch:
  // the face's least centre distance (null under two jacks), jackHit: the least `hit` (null: no jack)
  const PJ = portMap(model), jacks = [], liveHits = [];
  for (const o of controls) if (o.live) for (const r of o.entries ? o.entries.map(e => e.hit) : [o.hit]) liveHits.push(r);
  for (const o of controls) {
    if (!o.port) continue;
    const c = L.controls[o.i], J = PJ && PJ.get(o.port), ow = ownOf(c);
    jacks.push({ port: o.port, kind: c.kind, sig: J ? J.sig : c.kind === 'strig' ? 's' : 'v', dir: J ? J.dir : null, label: J ? J.label : String(c.label || o.port),
      x: q3(offX + (o.cx - x0) * X), y: q3((o.cy - y0) * X), d: q3(Math.max(ow[0], ow[1]) * X), w: q3(ow[0] * X), h: q3(ow[1] * X), hit: JACK_HIT_MAX });
  }
  let jackPitch = null;
  for (const j of jacks) {
    for (const k of jacks) if (k !== j) { const d = Math.hypot(j.x - k.x, j.y - k.y); j.hit = Math.min(j.hit, d - 2); jackPitch = jackPitch == null ? d : Math.min(jackPitch, d); }
    for (const r of liveHits) j.hit = Math.min(j.hit, 2 * Math.hypot(Math.max(r.x - j.x, 0, j.x - r.x - r.w), Math.max(r.y - j.y, 0, j.y - r.y - r.h)));
    j.hit = q3(j.hit);
  }
  const geo = {
    W, H, body: { w: W, h: H - BAR_H }, content: { x: offX, y: 0, w: r05(cw * X), h: r05(ch * X) }, mm: { x0, y0, offX },
    areas: [...A.values()].map(a => { const [cx, cy] = [a.at[0], a.at[1]]; return { id: a.id, x: px(cx), y: py(cy), w: r05(a.src[2] * X), h: r05(a.src[3] * X) }; }),
    sections: (L.sections || []).map(s => { const [sx, sy] = toC(s.a, s.x, s.y); return { id: s.id, label: s.label, x: px(sx), y: py(sy), w: r05(s.w * X), h: r05(s.h * X) }; }),
    controls, order, extras,
    jacks, jackPitch: jackPitch == null ? null : q3(jackPitch), jackHit: jacks.length ? Math.min(...jacks.map(j => j.hit)) : null,
  };
  geoC.set(L, { model, geo });
  return geo;
}
/** The module's outer size (world px; the 40 px bar included): multiples of DOT. @returns {{w: number, h: number}} */
export function sizeOf(L, model) { const g = geometry(L, model); return { w: g.W, h: g.H }; }
/** The live hit boxes in body px (each buttons / jacks entry its own; a bed once, its front band included).
 * @returns {{id: string, x: number, y: number, w: number, h: number}[]} */
export function hitBoxes(L, model) {
  const out = [];
  for (const o of geometry(L, model).controls) {
    if (!o.live) continue;
    if (o.entries) for (const e of o.entries) out.push(Object.assign({ id: o.id, v: e.v }, e.hit));
    else out.push(Object.assign({ id: o.id }, o.hit));
  }
  return out;
}

/* ---------------------------------------------------------------- the static art (one SVG) */
const svgC = new WeakMap();
/** A colour shaded by f (−1 darker … +1 lighter). */
function shade(hex, f) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16), ch = s => { const v = (n >> s) & 255, t = f < 0 ? v * (1 + f) : v + (255 - v) * f; return Math.round(Math.max(0, Math.min(255, t))); };
  return '#' + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join('');
}
/**
 * The static SVG markup of a panel: viewBox in content mm over the whole body (width / height in px), area fills and
 * frames, section frames and titles, decor items, printed labels / dials / legends, inert controls (dimmed, titled
 * "LABEL — not emulated"). aria-hidden; no <image>, href, xlink, foreignObject or script; text escaped. Cached per layout.
 * Self-contained (1g): every fill, stroke, font and text-rendering is an attribute (nothing from style.css), so the same
 * string loads as an image (faceTier) and draws the same picture.
 */
export function decorSvg(L, model) {
  const c0 = svgC.get(L);
  if (c0 && c0.model === model) return c0.s;
  const s = buildSvg(L, model);
  svgC.set(L, { model, s });
  return s;
}
function buildSvg(L, model) {
  const g = geometry(L, model), S = isObj(L.scheme) ? L.scheme : {}, X = PX_PER_MM;
  const LEG = S.legend || '#eeeeee', RULE = S.rule || LEG, PANEL = S.panel || '#151515', ACC = S.accent || '#f2a33a';
  const K = Object.assign({ skirt: '#151515', cap: '#2a2a2a', ptr: '#ffffff', ptrStyle: 'line', capR: 0.7 }, isObj(S.knob) ? S.knob : {});
  const SL = Object.assign({ cap: '#e8e8e4', line: '#111111', groove: '#050505' }, isObj(S.slider) ? S.slider : {});
  const BT = Object.assign({ cap: '#2b2b2b', led: '#ff3b2a', ledOff: '#3a1512', text: LEG }, isObj(S.button) ? S.button : {});
  const JK = Object.assign({ nut: '#c8c8c8', hole: '#050505' }, isObj(S.jack) ? S.jack : {});
  const TR = Object.assign({}, TRIM_SKIN, isObj(S.trim) ? S.trim : {}); // ((8) the SDS-V's trimmers)
  const named = n => (n && isObj(S.rocker) && S.rocker[n]) || (n && isObj(S.switch) && S.switch[n]) || (colorOk(n) && n.startsWith('#') ? n : null);
  const wid = 'hw-wood-' + String(L.id).replace(/[^\w-]/g, '');
  const wood = S.wood || '#5a3218';
  const col = c => (c === 'wood' ? `url(#${wid})` : c);
  const A = new Map(); for (const a of L.areas) A.set(a.id, a);
  const off = a => { const r = A.get(a || 'main') || A.get('main'); return [r.at[0] - r.src[0], r.at[1] - r.src[1]]; };
  const inA = (a, s) => { const [dx, dy] = off(a); return dx || dy ? `<g transform="translate(${n3(dx)} ${n3(dy)})">${s}</g>` : s; };
  const o = [];
  const { x0, y0, offX } = g.mm;
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" class="hw-svg" viewBox="${n3(x0 - offX / X)} ${n3(y0)} ${n3(g.W / X)} ${n3(g.body.h / X)}" width="${g.W}" height="${g.body.h}" aria-hidden="true" focusable="false" font-family="${esc(FONTS[S.font] || FONTS.sans)}" text-rendering="geometricPrecision">`);
  o.push(`<defs><linearGradient id="${wid}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="9" y2="1.6" spreadMethod="repeat">`
    + [[0, -0.18], [0.22, 0.1], [0.4, -0.05], [0.55, 0.16], [0.75, -0.12], [1, -0.18]].map(([p, f]) => `<stop offset="${p}" stop-color="${shade(wood, f)}"/>`).join('') + '</linearGradient></defs>');
  // areas
  for (const a of L.areas) {
    const [x, y, w, h] = [a.at[0], a.at[1], a.src[2], a.src[3]], r = fin(a.r) ? a.r : 0;
    o.push(`<rect x="${n3(x)}" y="${n3(y)}" width="${n3(w)}" height="${n3(h)}" rx="${n3(r)}" fill="${esc(col(a.fill || PANEL))}"/>`);
    const fr = a.frame || 'none';
    if (fr === 'metal') o.push(`<rect x="${n3(x + 0.6)}" y="${n3(y + 0.6)}" width="${n3(w - 1.2)}" height="${n3(h - 1.2)}" rx="${n3(r)}" fill="none" stroke="#a9a8a2" stroke-width="1.2"/>`);
    else if (fr === 'wood') o.push(`<rect x="${n3(x + 1.5)}" y="${n3(y + 1.5)}" width="${n3(w - 3)}" height="${n3(h - 3)}" rx="${n3(r)}" fill="none" stroke="url(#${wid})" stroke-width="3"/>`);
    else if (fr === 'line') o.push(`<rect x="${n3(x + 0.2)}" y="${n3(y + 0.2)}" width="${n3(w - 0.4)}" height="${n3(h - 0.4)}" rx="${n3(r)}" fill="none" stroke="${esc(RULE)}" stroke-width="0.35" opacity="0.6"/>`);
  }
  // sections
  for (const s of L.sections || []) {
    const fr = s.frame || 'none', ti = s.title || 'none', ink = s.headerInk || LEG;
    let q = '';
    if (s.fill) q += `<rect x="${n3(s.x)}" y="${n3(s.y)}" width="${n3(s.w)}" height="${n3(s.h)}" fill="${esc(col(s.fill))}"/>`;
    if (fr === 'box') q += `<rect x="${n3(s.x + 0.2)}" y="${n3(s.y + 0.2)}" width="${n3(s.w - 0.4)}" height="${n3(s.h - 0.4)}" rx="0.8" fill="none" stroke="${esc(RULE)}" stroke-width="0.4"/>`;
    if (fr === 'outline') q += `<rect x="${n3(s.x + 0.8)}" y="${n3(s.y + 0.8)}" width="${n3(s.w - 1.6)}" height="${n3(s.h - 1.6)}" rx="2.5" fill="none" stroke="${esc(RULE)}" stroke-width="0.5"/>`;
    if (fr === 'header') q += `<rect x="${n3(s.x)}" y="${n3(s.y)}" width="${n3(s.w)}" height="${HDR_MM}" fill="${esc(col(s.headerFill || ACC))}"/>`;
    if (fr === 'rule') q += `<path d="M${n3(s.x)} ${n3(s.y)}V${n3(s.y + s.h)}M${n3(s.x + s.w)} ${n3(s.y)}V${n3(s.y + s.h)}" stroke="${esc(RULE)}" stroke-width="0.5" fill="none"/>`;
    const tsz = s.titleSize > 0 ? s.titleSize : ti === 'bottom' ? 4.6 : 3.2;
    if (ti === 'top' || (ti === 'header' && fr !== 'header')) q += text(s.x + s.w / 2, s.y + 2 + tsz * 0.8, s.label, { size: tsz, weight: 700, anchor: 'middle', fill: LEG, ls: 0.25 });
    else if (ti === 'header') q += text(s.x + s.w / 2, s.y + HDR_MM / 2 + tsz * 0.36, s.label, { size: tsz, weight: 700, anchor: 'middle', fill: ink, ls: 0.25 });
    else if (ti === 'bottom') q += text(s.x + s.w / 2, s.y + s.h - 3.5, s.label, { size: tsz, weight: 700, anchor: 'middle', fill: LEG, ls: 0.35 });
    else if (ti === 'break') {
      const tw = String(s.label).length * tsz * 0.62 + 3, y = s.y + 0.8;
      q += `<rect x="${n3(s.x + s.w / 2 - tw / 2)}" y="${n3(y - tsz * 0.6)}" width="${n3(tw)}" height="${n3(tsz * 1.2)}" fill="${esc(col(s.fill || PANEL))}"/>`;
      q += text(s.x + s.w / 2, y + tsz * 0.36, s.label, { size: tsz, weight: 700, anchor: 'middle', fill: LEG, ls: 0.25 });
    }
    if (q) o.push(inA(s.a, q));
  }
  // decor items
  for (const d of L.decor || []) { const q = decorItem(d, { LEG, RULE, PANEL, col, wid }); if (q) o.push(inA(d.a, q)); }
  // printed parts of the controls (labels, dials, legends) and the inert controls; (9) the live patch jacks
  const M = ctlsOf(model), PJ = portMap(model);
  for (const c of L.controls || []) {
    if (!isObj(c) || !(c.kind in KINDS)) continue;
    let q = '';
    const ls = c.labSize > 0 ? c.labSize : 2.6, lab = c.lab || 'n';
    const dial = (c.kind === 'knob' || c.kind === 'rotary') && (isObj(c.scale) || Array.isArray(c.legends));
    // printed dial (a knob's scale) and rotary detents
    const rot = c.kind === 'rotary' && fin(c.rot) ? c.rot : 0; // (7b: a rotary's sweep centre)
    if ((c.kind === 'knob' || c.kind === 'rotary') && isObj(c.scale)) q += scaleSvg(c.x, c.y, c.d, c.sweep || 270, c.scale, LEG, rot);
    if (c.kind === 'rotary' && Array.isArray(c.legends)) q += detentsSvg(c.x, c.y, c.d, c.sweep || 270, c.legends, LEG, rot);
    if (c.kind === 'slider' && isObj(c.scale)) q += ladderSvg(Object.assign({ x: c.x, y: c.y, len: c.len, orient: c.orient, gap: capOf(c)[0] / 2 }, c.scale), LEG);
    if (c.kind === 'slider' && Array.isArray(c.legends)) q += ladderSvg({ x: c.x, y: c.y, len: c.len, orient: c.orient, gap: capOf(c)[0] / 2, n: c.legends.length, labels: c.legends, side: c.side || 'r', invert: c.invert }, LEG);
    if (c.kind === 'jacks') for (const e of entriesOf(c)) { q += jackSvg(e.x, e.y, (e.d || c.d), JK); if (e.label) q += text(e.x, e.y - (e.d || c.d) / 2 - 1.2, e.label, { size: ls, anchor: 'middle', fill: LEG }); }
    if (c.kind === 'buttons') for (const e of entriesOf(c)) if (e.label) q += text(e.x, e.y - (e.h || c.h) / 2 - 1.4 - (c.led === 'above' ? 3 : 0), e.label, { size: ls, anchor: 'middle', fill: LEG });
    // the printed label
    if (c.label && lab !== 'none' && c.kind !== 'buttons' && c.kind !== 'jacks') {
      const ow = ownOf(c), ext = (c.kind === 'knob' || c.kind === 'rotary') ? c.d / 2 + (dial ? DIAL_OUT : 1.2) : 0;
      const ey = ext || ow[1] / 2 + 1.3 + (c.kind === 'button' && c.led === 'above' ? 3 : 0), exx = ext || ow[0] / 2 + 1.3;
      const lines = String(c.label).split('\n'), lh = ls * 1.12;
      const t = { size: ls, weight: c.labWeight || 600, fill: LEG, ls: 0.12 };
      if (lab === 'n') q += text(c.x, c.y - ey - 0.5 - (lines.length - 1) * lh, c.label, Object.assign(t, { anchor: 'middle' }));
      else if (lab === 's') q += text(c.x, c.y + ey + ls * 0.85, c.label, Object.assign(t, { anchor: 'middle' }));
      else q += text(c.x + (lab === 'e' ? exx : -exx), c.y + ls * 0.36 - (lines.length - 1) * lh / 2, c.label, Object.assign(t, { anchor: lab === 'e' ? 'start' : 'end' }));
    }
    if (PERF_K.includes(c.kind) && !c.inert) q += perfSvg(c, S); // (1i) the keys / a controller at rest
    if (c.inert) q += inertSvg(c, { K, SL, BT, JK, LEG, named, M, S });
    else if (isPatchJack(c)) q += patchJackSvg(c, JK, (PJ && PJ.get(c.port) || {}).label || c.label || c.port); // ((9) a live patch jack)
    else if (c.id === 'dr:trim' && c.kind === 'button' && fin(c.w) && fin(c.h)) q += trimSvg(c, TR); // ((8) the SDS-V's trimmer rows)
    if (q) o.push(inA(c.a, q));
  }
  o.push('</svg>');
  return o.join('');
}
// t.xs: one x per character (each its own chunk, anchored as t.anchor: a row of glyphs in one element); t.variant: small-caps
function text(x, y, s, t) {
  const lines = String(s).split('\n'), lh = t.size * 1.12, xs = Array.isArray(t.xs) && t.xs.length && lines.length === 1 ? t.xs.map(n3).join(' ') : n3(x);
  const a = `x="${xs}" y="${n3(y)}" font-size="${n3(t.size)}"${t.anchor && t.anchor !== 'start' ? ` text-anchor="${t.anchor}"` : ''}${t.weight ? ` font-weight="${t.weight}"` : ''}`
    + `${t.fill ? ` fill="${esc(t.fill)}"` : ''}${t.ls ? ` letter-spacing="${n3(t.ls)}"` : ''}${t.font && FONTS[t.font] ? ` font-family="${esc(FONTS[t.font])}"` : ''}`
    + `${t.variant === 'small-caps' ? ' font-variant="small-caps"' : ''}${fin(t.rot) && t.rot ? ` transform="rotate(${n3(t.rot)} ${n3(x)} ${n3(y)})"` : ''}`;
  if (lines.length === 1) return `<text ${a}>${esc(t.caps ? s.toUpperCase() : s)}</text>`;
  return `<text ${a}>` + lines.map((l, i) => `<tspan x="${n3(x)}"${i ? ` dy="${n3(lh)}"` : ''}>${esc(t.caps ? l.toUpperCase() : l)}</tspan>`).join('') + '</text>';
}
const polar = (x, y, r, deg) => { const a = deg * Math.PI / 180; return [x + Math.sin(a) * r, y - Math.cos(a) * r]; };
function glyphSvg(g, x, y, size, colr, sw) {
  const s = size / 2;
  return `<path d="${GLYPHS[g]}" transform="translate(${n3(x)} ${n3(y)}) scale(${n3(s)})" fill="none" stroke="${esc(colr)}" stroke-width="${n3((sw || 0.32) / s)}" stroke-linejoin="round" stroke-linecap="round"/>`;
}
function scaleSvg(x, y, d, sweep, sc, LEG, rot = 0) {
  const n = Math.max(2, sc.n | 0 || 11), r0 = d / 2 + DIAL_IN, r1 = r0 + DIAL_TICK, rl = d / 2 + DIAL_LAB, sz = sc.size > 0 ? sc.size : 2.3;
  let p = '', q = '';
  for (let i = 0; i < n; i++) {
    const a = rot - sweep / 2 + sweep * i / (n - 1), [ax, ay] = polar(x, y, r0, a), [bx, by] = polar(x, y, r1, a);
    p += `M${n3(ax)} ${n3(ay)}L${n3(bx)} ${n3(by)}`;
  }
  const labs = Array.isArray(sc.labels) ? sc.labels : [];
  labs.forEach((l, i) => {
    if (l == null || l === '') return;
    const a = rot - sweep / 2 + sweep * (labs.length === n ? i / (n - 1) : i / Math.max(1, labs.length - 1)), [lx, ly] = polar(x, y, rl, a);
    q += text(lx, ly + sz * 0.36, String(l), { size: sz, anchor: 'middle', fill: LEG });
  });
  return `<path d="${p}" stroke="${esc(LEG)}" stroke-width="0.32" fill="none"/>` + q;
}
// a dial with a multi-line legend (the 808's MODE) lays its word legends out by their estimated boxes (7a review 2 #5): a
// multi-line one as a block centred on its radial line, pushed out until it clears the knob (d / 2) and every detent tick by
// DET_GAP; a single-line one where it always was unless its box touches a tick, then pushed out the same way. Other dials
// print at the label radius, as ever
const DET_GAP = 0.5, LEG_EM = ch => (ch === ' ' ? 0.28 : /[A-Z]/.test(ch) ? 0.7 : /[a-z0-9]/.test(ch) ? 0.56 : 0.6);
function boxGap(bx, segs, r) { // the least distance from a box [x0, y0, x1, y1] (centre-relative) to the segments (sampled), and a disc r
  const d = (x, y) => Math.hypot(Math.max(bx[0] - x, 0, x - bx[2]), Math.max(bx[1] - y, 0, y - bx[3]));
  let m = r > 0 ? Math.max(0, d(0, 0) - r) : Infinity;
  for (const [ax, ay, cx, cy] of segs) for (let k = 0; k <= 16; k++) m = Math.min(m, d(ax + (cx - ax) * k / 16, ay + (cy - ay) * k / 16));
  return m;
}
function detentsSvg(x, y, d, sweep, legends, LEG, rot = 0) {
  const n = legends.length, r0 = d / 2 + DIAL_IN, r1 = r0 + DIAL_TICK * 0.8, rl = d / 2 + DIAL_LAB + 0.4, SZ = 2.4;
  const blocks = legends.some(l => typeof l === 'string' && l.includes('\n')), ang = i => rot + (n > 1 ? -sweep / 2 + sweep * i / (n - 1) : 0);
  const ticks = blocks ? legends.map((l, i) => [...polar(0, 0, r0, ang(i)), ...polar(0, 0, r1, ang(i))]) : [];
  let p = '', q = '';
  legends.forEach((l, i) => {
    const a = ang(i), [ax, ay] = polar(x, y, r0, a), [bx, by] = polar(x, y, r1, a), [lx, ly] = polar(x, y, rl + (typeof l === 'string' && l in GLYPHS ? 0.6 : 0), a);
    p += `M${n3(ax)} ${n3(ay)}L${n3(bx)} ${n3(by)}`;
    if (typeof l === 'string' && l in GLYPHS) q += glyphSvg(l, lx, ly, 3.4, LEG, 0.34);
    else if (l != null && l !== '' && blocks) {
      const lines = String(l).split('\n'), multi = lines.length > 1, lh = SZ * 1.12, cap = SZ * 0.72;
      const hw = Math.max(...lines.map(s => [...s].reduce((w, ch) => w + LEG_EM(ch), 0))) * SZ / 2, hh = (cap + (lines.length - 1) * lh) / 2;
      const box = R => { const [cx, cy] = polar(0, 0, R, a); return multi ? [cx - hw, cy - hh, cx + hw, cy + hh] : [cx - hw, cy + 0.85 - cap, cx + hw, cy + 0.85]; };
      let R = rl;
      for (let k = 0; k < 200 && boxGap(box(R), ticks, multi ? d / 2 : 0) < DET_GAP; k++) R += 0.1;
      const [px, py] = polar(x, y, R, a);
      q += text(px, multi ? py - hh + cap : py + 0.85, String(l), { size: SZ, anchor: 'middle', fill: LEG }); // (a block: its top + a cap is the first baseline)
    } else if (l != null && l !== '') q += text(lx, ly + 0.85, String(l), { size: SZ, anchor: 'middle', fill: LEG });
  });
  return `<path d="${p}" stroke="${esc(LEG)}" stroke-width="0.32" fill="none"/>` + q;
}
// a slide pot's printed ladder: n ticks along its travel beside the slot (side l | r | both), labels from the minimum end
function ladderSvg(d, LEG) {
  const n = Math.max(2, d.n | 0 || 11), h = d.orient === 'h', len = +d.len || 0, gap = (+d.gap || 4) + 0.8, tl = 1.6, sz = d.size > 0 ? d.size : 2.2;
  const sides = d.side === 'both' ? [-1, 1] : d.side === 'l' ? [-1] : [1];
  let p = '', q = '';
  const labs = Array.isArray(d.labels) ? d.labels : [];
  for (let i = 0; i < n; i++) {
    let f = i / (n - 1);
    if (d.invert) f = 1 - f;
    const along = h ? d.x - len / 2 + f * len : d.y + len / 2 - f * len;
    for (const sd of sides) {
      if (h) p += `M${n3(along)} ${n3(d.y + sd * gap)}V${n3(d.y + sd * (gap + tl))}`;
      else p += `M${n3(d.x + sd * gap)} ${n3(along)}H${n3(d.x + sd * (gap + tl))}`;
    }
    const l = labs.length === n ? labs[i] : null;
    if (l != null && l !== '') {
      const sd = sides[sides.length - 1];
      if (h) q += text(along, d.y + sd * (gap + tl + 1) + (sd > 0 ? sz * 0.8 : 0), String(l), { size: sz, anchor: 'middle', fill: LEG });
      else q += text(d.x + sd * (gap + tl + 0.8), along + sz * 0.36, String(l), { size: sz, anchor: sd > 0 ? 'start' : 'end', fill: LEG });
    }
  }
  return `<path d="${p}" stroke="${esc(LEG)}" stroke-width="0.3" fill="none"/>` + q;
}
function jackSvg(x, y, d, JK) {
  return `<circle cx="${n3(x)}" cy="${n3(y)}" r="${n3(d / 2)}" fill="${esc(JK.nut)}"/><circle cx="${n3(x)}" cy="${n3(y)}" r="${n3(d * 0.24)}" fill="${esc(JK.hole)}"/>`;
}
/** (9) A live patch jack's art: a 1/4" jack's nut at full contrast (the `inert: 'later'` look), or an S-trigger socket — our
 * drawing of a two-pin Cinch-Jones socket: a dark insulator ringed in the nut's colour, two flat contact slots — titled with
 * its jack's label (data-port: the port; no data-tip, the jack's span above it takes the press). */
function patchJackSvg(c, JK, name) {
  const { x, y } = c;
  let q;
  if (c.kind === 'strig') {
    const w = c.w, h = c.h, sw = Math.max(0.5, w * 0.09), sh = h * 0.46;
    q = `<rect x="${n3(x - w / 2)}" y="${n3(y - h / 2)}" width="${n3(w)}" height="${n3(h)}" rx="${n3(Math.min(w, h) * 0.32)}" fill="#1b1b1b" stroke="${esc(JK.nut)}" stroke-width="0.45"/>`
      + `<path d="M${n3(x - w * 0.2 - sw / 2)} ${n3(y - sh / 2)}h${n3(sw)}v${n3(sh)}h${n3(-sw)}zM${n3(x + w * 0.2 - sw / 2)} ${n3(y - sh / 2)}h${n3(sw)}v${n3(sh)}h${n3(-sw)}z" fill="${esc(JK.hole)}"/>`;
  } else q = jackSvg(x, y, c.d, JK);
  return `<g class="hw-jack" data-port="${esc(c.port)}"><title>${esc(String(name).replace(/\n/g, ' '))}</title>${q}</g>`;
}
/** (8) The SDS-V's trimmer row (dr:trim; our art): TRIM_N metal discs evenly across its box, each with its screwdriver slot
 * at an angle of its own (static: TRIM… shows the values) — one path for the discs, one for the slots (the DOM budget).
 * TR: the colours (scheme.trim: body, rim, slot). */
export const TRIM_SKIN = Object.freeze({ body: '#b9bcbf', rim: '#55595d', slot: '#26282b' });
function trimSvg(c, TR) {
  const d = trimD(c), r = d / 2, p = c.w / TRIM_N, x0 = c.x - c.w / 2 + p / 2;
  if (!(r > 0)) return '';
  let D = '', L = '';
  for (let i = 0; i < TRIM_N; i++) {
    const x = x0 + i * p, a = ((i * 47 + (c.mem === 4 ? 23 : 0)) % 150 - 75) * Math.PI / 180, s = r * 0.78, ux = Math.cos(a) * s, uy = Math.sin(a) * s;
    D += `M${n3(x - r)} ${n3(c.y)}a${n3(r)} ${n3(r)} 0 1 0 ${n3(d)} 0a${n3(r)} ${n3(r)} 0 1 0 ${n3(-d)} 0Z`;
    L += `M${n3(x - ux)} ${n3(c.y - uy)}L${n3(x + ux)} ${n3(c.y + uy)}`;
  }
  return `<path d="${D}" fill="${esc(TR.body)}" stroke="${esc(TR.rim)}" stroke-width="${n3(Math.max(0.2, d * 0.06))}"/>`
    + `<path d="${L}" fill="none" stroke="${esc(TR.slot)}" stroke-width="${n3(d * 0.16)}" stroke-linecap="round"/>`;
}
function decorItem(d, C) {
  const st = (dflt) => ` stroke="${esc(C.col(d.stroke || dflt))}" stroke-width="${n3(d.sw > 0 ? d.sw : 0.3)}"`;
  switch (d.t) {
    case 'rect': return `<rect x="${n3(d.x)}" y="${n3(d.y)}" width="${n3(d.w)}" height="${n3(d.h)}"${d.r > 0 ? ` rx="${n3(d.r)}"` : ''} fill="${esc(C.col(d.fill || 'none'))}"${d.stroke ? st(C.RULE) : ''}/>`;
    case 'line': return `<line x1="${n3(d.x1)}" y1="${n3(d.y1)}" x2="${n3(d.x2)}" y2="${n3(d.y2)}"${st(C.RULE)}${Array.isArray(d.dash) ? ` stroke-dasharray="${d.dash.filter(fin).map(n3).join(' ')}"` : ''}/>`;
    case 'path': return `<path d="${esc(d.d)}" fill="${esc(C.col(d.fill || 'none'))}"${d.stroke || !d.fill ? st(C.RULE) : ''}${fin(d.x) && fin(d.y) ? ` transform="translate(${n3(d.x)} ${n3(d.y)})"` : ''}/>`;
    case 'text': return text(d.x, d.y, d.s, { size: d.size > 0 ? d.size : 2.6, weight: d.weight, anchor: d.anchor, fill: d.fill || C.LEG, ls: d.ls, rot: d.rot, font: d.font, caps: d.caps, xs: d.xs, variant: d.variant });
    case 'glyph': return glyphSvg(d.g, d.x, d.y, d.size, d.fill || C.LEG, d.sw);
    case 'scale': return scaleSvg(d.x, d.y, d.d, d.sweep || 270, d, d.fill || C.LEG);
    case 'ladder': return ladderSvg(d, d.fill || C.LEG);
    case 'grille': {
      const hole = d.hole > 0 ? d.hole : 1.6, pit = d.pitch > hole ? d.pitch : hole * 2;
      let p = '';
      for (let y = d.y + pit / 2, r = 0; y < d.y + d.h; y += pit * 0.866, r++) for (let x = d.x + pit / 2 + (r % 2 ? pit / 2 : 0); x < d.x + d.w; x += pit) p += `M${n3(x - hole / 2)} ${n3(y)}a${n3(hole / 2)} ${n3(hole / 2)} 0 1 0 ${n3(hole)} 0a${n3(hole / 2)} ${n3(hole / 2)} 0 1 0 ${n3(-hole)} 0`;
      return `<rect x="${n3(d.x)}" y="${n3(d.y)}" width="${n3(d.w)}" height="${n3(d.h)}" fill="${esc(C.col(d.fill || '#1b1b1b'))}"/><path d="${p}" fill="#050505"/>`;
    }
    case 'stripes': case 'louvres': {
      const pit = d.pitch > 0 ? d.pitch : 2.4;
      let p = '';
      for (let y = d.y + pit / 2; y < d.y + d.h; y += pit) p += `M${n3(d.x)} ${n3(y)}H${n3(d.x + d.w)}`;
      const sw = d.t === 'louvres' ? pit * 0.45 : (d.sw > 0 ? d.sw : 0.3);
      return (d.fill ? `<rect x="${n3(d.x)}" y="${n3(d.y)}" width="${n3(d.w)}" height="${n3(d.h)}" fill="${esc(C.col(d.fill))}"/>` : '')
        + `<path d="${p}" stroke="${esc(d.stroke || (d.t === 'louvres' ? '#050505' : C.RULE))}" stroke-width="${n3(sw)}" fill="none"/>`;
    }
    case 'screws': {
      const r = (d.d > 0 ? d.d : 4) / 2;
      return d.pts.map(([x, y]) => `<circle cx="${n3(x)}" cy="${n3(y)}" r="${n3(r)}" fill="#b7b7b2" stroke="#5c5c58" stroke-width="0.25"/><path d="M${n3(x - r * 0.7)} ${n3(y)}H${n3(x + r * 0.7)}" stroke="#4a4a46" stroke-width="${n3(r * 0.28)}"/>`).join('');
    }
    default: return '';
  }
}
/* ---- (1i, IMPL-1i §3) the keys and the controllers: drawn at rest in the face (the GL texture); the moving parts of a live
   controller are DOM over their own window, from the same numbers (perfParts: mm from the slot's top-left, × 2 in the DOM) */
/** The skins' defaults (layout `scheme.<kind>`, then the control's `skin`, override them). */
export const PERF_SKIN = Object.freeze({
  keys: { white: '#f0ece1', whiteEdge: '#cbc4b2', black: '#141414', blackTop: '#2b2b2b', gap: '#090909' },
  wheel: { slot: '#050505', surface: '#2b2b2b', ridge: '#161616', mark: '#dcdcdc' },
  lever: { slot: '#050505', cap: '#cfcfcf' },
  ribbon: { felt: '#1b1b1b', edge: '#8c8c8c' },
  pad: { face: '#3a3a3a', lit: '#ff6a3a' },
});
export const skinOfPerf = (c, S) => Object.assign({}, PERF_SKIN[c.kind], isObj(S) && isObj(S[c.kind]) ? S[c.kind] : {}, isObj(c.skin) ? c.skin : {});
/** Wheel / lever constants (mm): the wheel's window inset, ridge pitch and width, its mark, the share of the surface the
 * mark travels; a white key's front-edge band; a black key's top-face inset. */
export const WHEEL = Object.freeze({ inset: 1.5, ridgeP: 3, ridgeW: 0.6, mark: 1.2, travel: 0.84 }), KEY_EDGE = 2.5, BLACK_TOP = { side: 0.9, front: 5 };
/**
 * A controller's moving part at v (mm, from the slot's top-left): a wheel's surface window, its ridge phase (`roll`, mm the
 * ridges moved from rest along the raising direction) and its mark; a lever's cap. kind: 'bend' | 'wheel'.
 */
export function perfParts(c, kind, v) {
  const w = +c.w, h = +c.h;
  if (c.kind === 'wheel') {
    const hz = c.orient === 'h', I = WHEEL.inset, sw = w - 2 * I, sh = h - 2 * I, L = hz ? sw : sh;
    const roll = (KY.partAt(kind, v) - KY.partAt(kind, 0)) * WHEEL.travel * L, at = (0.5 + (KY.partAt(kind, v) - 0.5) * WHEEL.travel) * L; // (the mark along the raising direction)
    const mark = hz ? { x: I + at - WHEEL.mark / 2, y: I, w: WHEEL.mark, h: sh } : { x: I, y: I + L - at - WHEEL.mark / 2, w: sw, h: WHEEL.mark };
    return { surf: { x: I, y: I, w: sw, h: sh }, roll, mark };
  }
  if (c.kind === 'lever') {
    const ax = c.axis === 'x', len = ax ? w : h, across = ax ? h : w, cl = Math.max(6, Math.min(14, 0.22 * len)), T = len - cl - 2, p = 1 + KY.partAt(kind, v) * T;
    const along = c.up === '-y' ? len - p - cl : p; // (from the start end along the raising direction)
    return { cap: ax ? { x: along, y: 1, w: cl, h: across - 2 } : { x: 1, y: along, w: across - 2, h: cl } };
  }
  return {};
}
// the art of a keys / wheel / lever / ribbon / pad control at rest, in its area frame (mm)
function perfSvg(c, S) {
  const k = skinOfPerf(c, S), R = (x, y, w, h, f, more) => `<rect x="${n3(x)}" y="${n3(y)}" width="${n3(w)}" height="${n3(h)}" fill="${esc(f)}"${more || ''}/>`;
  if (c.kind === 'keys') {
    if (!bedOk(c)) return '';
    const B = KY.bedLayout(c), bx = c.x - B.w / 2, by = c.y - B.h / 2;
    let q = R(bx, by, B.w, B.h, k.gap), wp = '', ep = '', bp = '', tp = '';
    const P = (x, y, w, h) => `M${n3(x)} ${n3(y)}h${n3(w)}v${n3(h)}h${n3(-w)}z`;
    for (const key of B.keys) {
      const x = bx + key.x, y = by + key.y;
      if (!key.black) { wp += P(x, y, key.w, key.h); ep += P(x, y + key.h - KEY_EDGE, key.w, KEY_EDGE); }
      else { bp += P(x, y, key.w, key.h); tp += P(x + BLACK_TOP.side, y, key.w - 2 * BLACK_TOP.side, key.h - BLACK_TOP.front); }
    }
    return q + `<path d="${wp}" fill="${esc(k.white)}"/><path d="${ep}" fill="${esc(k.whiteEdge)}"/><path d="${bp}" fill="${esc(k.black)}"/><path d="${tp}" fill="${esc(k.blackTop)}"/>`;
  }
  if (!(c.w > 0 && c.h > 0)) return '';
  const x0 = c.x - c.w / 2, y0 = c.y - c.h / 2, kind = KY.ctlKind(c.id) || (c.kind === 'pad' ? 'wheel' : 'bend');
  if (c.kind === 'wheel') {
    const { surf, mark } = perfParts(c, kind, 0), hz = c.orient === 'h';
    let rp = '';
    if (hz) for (let x = surf.x; x < surf.x + surf.w - 1e-9; x += WHEEL.ridgeP) rp += `M${n3(x0 + x)} ${n3(y0 + surf.y)}h${n3(Math.min(WHEEL.ridgeW, surf.x + surf.w - x))}v${n3(surf.h)}h${n3(-Math.min(WHEEL.ridgeW, surf.x + surf.w - x))}z`;
    else for (let y = surf.y; y < surf.y + surf.h - 1e-9; y += WHEEL.ridgeP) rp += `M${n3(x0 + surf.x)} ${n3(y0 + y)}h${n3(surf.w)}v${n3(Math.min(WHEEL.ridgeW, surf.y + surf.h - y))}h${n3(-surf.w)}z`;
    return R(x0, y0, c.w, c.h, k.slot) + R(x0 + surf.x, y0 + surf.y, surf.w, surf.h, k.surface) + `<path d="${rp}" fill="${esc(k.ridge)}"/>`
      + (c.detent ? R(x0 + mark.x, y0 + mark.y, mark.w, mark.h, k.mark) : '');
  }
  if (c.kind === 'lever') { const { cap } = perfParts(c, kind, 0); return R(x0, y0, c.w, c.h, k.slot) + R(x0 + cap.x, y0 + cap.y, cap.w, cap.h, k.cap, ' rx="0.5"'); }
  if (c.kind === 'ribbon') return R(x0, y0, c.w, c.h, k.felt) + `<path d="M${n3(x0)} ${n3(y0 + 0.3)}h${n3(c.w)}M${n3(x0)} ${n3(y0 + c.h - 0.3)}h${n3(c.w)}" stroke="${esc(k.edge)}" stroke-width="0.6" fill="none"/>`;
  if (c.kind === 'pad') return R(x0, y0, c.w, c.h, k.face, ' rx="2"');
  return '';
}
// an inert (not emulated) control: drawn with the model's skin at opacity 0.55, titled "LABEL — not emulated"; (7a) an
// `inert: 'later'` jack at full contrast, titled "LABEL — cable-able with full patching (stage 4)"
function inertSvg(c, C) {
  const later = c.inert === 'later', name = String(c.label || c.kind).replace(/\n/g, ' '), tip = name + (later ? LATER_TIP : INERT_TIP), p = fin(c.p) ? Math.max(0, Math.min(1, c.p)) : 0.5;
  const sk = Object.assign({}, C.K, isObj(c.skin) ? c.skin : {});
  let q = '';
  const { x, y } = c;
  switch (c.kind) {
    case 'knob': case 'rotary': {
      const r = c.d / 2, a = (c.kind === 'rotary' && fin(c.rot) ? c.rot : 0) - (c.sweep || 270) / 2 + (c.sweep || 270) * p, [px1, py1] = polar(x, y, r * 0.94, a), [px2, py2] = polar(x, y, r * (sk.capR || 0.6) + 0.4, a);
      q = `<circle cx="${n3(x)}" cy="${n3(y)}" r="${n3(r)}" fill="${esc(sk.skirt)}"/><circle cx="${n3(x)}" cy="${n3(y)}" r="${n3(r * (sk.capR || 0.6))}" fill="${esc(sk.cap)}"/>`
        + `<line x1="${n3(px1)}" y1="${n3(py1)}" x2="${n3(px2)}" y2="${n3(py2)}" stroke="${esc(sk.ptr)}" stroke-width="${n3(Math.max(0.6, c.d * 0.05))}" stroke-linecap="round"/>`;
      break;
    }
    case 'slider': {
      const cap = capOf(c), h = c.orient === 'h', len = +c.len || 0, f = c.invert ? 1 - p : p;
      const cx = h ? x - len / 2 + f * len : x, cy = h ? y : y + len / 2 - f * len, cw = h ? cap[1] : cap[0], ch = h ? cap[0] : cap[1];
      q = (h ? `<line x1="${n3(x - len / 2)}" y1="${n3(y)}" x2="${n3(x + len / 2)}" y2="${n3(y)}"` : `<line x1="${n3(x)}" y1="${n3(y - len / 2)}" x2="${n3(x)}" y2="${n3(y + len / 2)}"`)
        + ` stroke="${esc(C.SL.groove)}" stroke-width="1.6" stroke-linecap="round"/><rect x="${n3(cx - cw / 2)}" y="${n3(cy - ch / 2)}" width="${n3(cw)}" height="${n3(ch)}" rx="0.6" fill="${esc(C.named(c.color) || C.SL.cap)}"/>`
        + (h ? `<line x1="${n3(cx)}" y1="${n3(cy - ch / 2 + 0.6)}" x2="${n3(cx)}" y2="${n3(cy + ch / 2 - 0.6)}"` : `<line x1="${n3(cx - cw / 2 + 0.6)}" y1="${n3(cy)}" x2="${n3(cx + cw / 2 - 0.6)}" y2="${n3(cy)}"`) + ` stroke="${esc(C.SL.line)}" stroke-width="0.5"/>`;
      break;
    }
    case 'switch': {
      const w = c.w, h = c.h, fill = C.named(c.color) || '#2a2a2a', v = c.orient === 'v' || (c.orient == null && h > w);
      if ((c.style || 'rocker') === 'rocker' || c.style === 'paddle') {
        const on = p >= 0.5, [hx, hy, hw, hh] = v ? [x - w / 2, on ? y : y - h / 2, w, h / 2] : [on ? x : x - w / 2, y - h / 2, w / 2, h];
        q = `<rect x="${n3(x - w / 2)}" y="${n3(y - h / 2)}" width="${n3(w)}" height="${n3(h)}" rx="0.8" fill="${esc(fill)}"/><rect x="${n3(hx)}" y="${n3(hy)}" width="${n3(hw)}" height="${n3(hh)}" rx="0.8" fill="#000" opacity="0.28"/>`;
      } else {
        const k = Math.min(w, h) * 0.42, f = p, kx = v ? x : x - w / 2 + k + f * (w - 2 * k), ky = v ? y + h / 2 - k - f * (h - 2 * k) : y;
        q = `<rect x="${n3(x - w / 2)}" y="${n3(y - h / 2)}" width="${n3(w)}" height="${n3(h)}" rx="${n3(Math.min(w, h) / 2)}" fill="#0c0c0c" stroke="#555" stroke-width="0.3"/><circle cx="${n3(kx)}" cy="${n3(ky)}" r="${n3(k)}" fill="${esc(C.named(c.color) || '#cfcfcf')}"/>`;
      }
      break;
    }
    case 'button': {
      const fill = C.named(c.color) || C.BT.cap, led = c.led || 'none', lit = !!c.lit;
      q = `<rect x="${n3(x - c.w / 2)}" y="${n3(y - c.h / 2)}" width="${n3(c.w)}" height="${n3(c.h)}" rx="0.8" fill="${esc(fill)}"/>`;
      if (led !== 'none') { const ly = led === 'cap' ? y - c.h * 0.22 : led === 'above' ? y - c.h / 2 - 2 : y + c.h / 2 + 2; q += `<circle cx="${n3(x)}" cy="${n3(ly)}" r="1" fill="${esc(lit ? C.BT.led : C.BT.ledOff)}"/>`; }
      if (c.onCap) q += text(x, y + 1, c.onCap, { size: Math.min(2.4, c.h * 0.3), anchor: 'middle', fill: C.BT.text });
      break;
    }
    case 'jack': q = jackSvg(x, y, c.d, C.JK); break;
    case 'lamp': case 'led': q = `<circle cx="${n3(x)}" cy="${n3(y)}" r="${n3(c.d / 2)}" fill="#2a2a2a" stroke="#777" stroke-width="0.3"/><circle cx="${n3(x)}" cy="${n3(y)}" r="${n3(c.d * 0.36)}" fill="${esc(C.named(c.color) || c.color || '#c8321e')}" opacity="${c.lit ? 1 : 0.45}"/>`; break;
    case 'screw': q = `<circle cx="${n3(x)}" cy="${n3(y)}" r="${n3(c.d / 2)}" fill="#b7b7b2"/><path d="M${n3(x - c.d * 0.35)} ${n3(y)}H${n3(x + c.d * 0.35)}" stroke="#4a4a46" stroke-width="${n3(c.d * 0.14)}"/>`; break;
    case 'display': q = `<rect x="${n3(x - c.w / 2)}" y="${n3(y - c.h / 2)}" width="${n3(c.w)}" height="${n3(c.h)}" rx="0.6" fill="#140606"/>`; break;
    case 'fuse': case 'strig': q = `<rect x="${n3(x - c.w / 2)}" y="${n3(y - c.h / 2)}" width="${n3(c.w)}" height="${n3(c.h)}" rx="${n3(Math.min(c.w, c.h) / 2)}" fill="#1a1a1a" stroke="#888" stroke-width="0.3"/>`; break;
    case 'slot': q = `<rect x="${n3(x - c.w / 2)}" y="${n3(y - c.h / 2)}" width="${n3(c.w)}" height="${n3(c.h)}" rx="0.6" fill="#070707" stroke="#3a3a3a" stroke-width="0.4"/>`; break;
    case 'buttons': case 'jacks': for (const e of entriesOf(c)) q += c.kind === 'jacks' ? jackSvg(e.x, e.y, e.d || c.d, C.JK) : `<rect x="${n3(e.x - (e.w || c.w) / 2)}" y="${n3(e.y - (e.h || c.h) / 2)}" width="${n3(e.w || c.w)}" height="${n3(e.h || c.h)}" rx="0.8" fill="${esc(C.named(e.color || c.color) || C.BT.cap)}"/>`; break;
    case 'keys': case 'wheel': case 'lever': case 'ribbon': case 'pad': q = perfSvg(c, C.S); break;
    default: break;
  }
  return later ? `<g class="hw-inert hw-later" data-tip="${esc(tip)}"><title>${esc(tip)}</title>${q}</g>`
    : `<g class="hw-inert" opacity="0.55" data-tip="${esc(tip)}"><title>${esc(tip)}</title>${q}</g>`;
}

/* ---------------------------------------------------------------- (1g) the face's bitmap tier below native resolution */
/** The finer vector raster a face bitmap is filtered down from: FACE_SS × the target, never above native; ≤ FACE_MAX_PX. */
export const FACE_SS = 2, FACE_MAX_PX = 16e6;
/** The face bitmaps painted (all panels; tests/ui-bench.html reads it): count, total and longest paint (ms, main thread). */
export const faceStats = { n: 0, ms: 0, max: 0 };
const msNow = () => (globalThis.performance && typeof globalThis.performance.now === 'function' ? globalThis.performance.now() : Date.now());
/**
 * The bitmap tier of a face (`svg`: the .hw-decor > svg built from `markup`, w × h world px). refresh() — at creation (next
 * frame) and at each zoom end (wk.onRescale on `deco`) — reads the camera's k (wk.canvasScale): k ≥ 1 → the SVG shows, no
 * bitmap; k < 1 → the markup loads as an Image (a Blob URL), is rastered at FACE_SS × (devicePixelRatio · k) and drawn,
 * smoothed ('high'), onto a canvas of exactly w·dpr·k × h·dpr·k device px, CSS-sized w × h in the same place; then the canvas
 * shows and the SVG is hidden (visibility: layout unchanged). Until a load lands the previous picture stays (a pinch scales
 * the old bitmap). A failed load keeps the SVG for good (failed). Memory: one canvas at the on-screen size, released at k ≥ 1,
 * by wk.releaseCanvases (an unmounted body: the SVG again; re-tried next frame if still mounted) and by destroy().
 * env (tests): {win, doc, scale, raf, Image, Blob, URL, now, onChange? (1h: the bitmap landed / the load failed)}.
 * @returns {{refresh, drop, destroy, readonly shown, readonly failed, readonly canvas, readonly k}}
 */
export function faceTier(deco, svg, markup, w, h, env) {
  env = env || {};
  const doc = env.doc || deco.ownerDocument || globalThis.document, win = env.win || (doc && doc.defaultView) || globalThis;
  const scale = typeof env.scale === 'function' ? env.scale : () => (typeof wk.canvasScale === 'function' ? wk.canvasScale(deco) : 1);
  const raf = typeof env.raf === 'function' ? env.raf : f => (typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame(f) : setTimeout(f, 16));
  const Img = env.Image || win.Image || globalThis.Image, Bl = env.Blob || win.Blob || globalThis.Blob, U = env.URL || win.URL || globalThis.URL;
  let gen = 0, cv = null, at = 0, dead = false, failed = false, due = false, offR = null;
  const vis = hide => { try { svg.style.visibility = hide ? 'hidden' : ''; } catch (err) { /* inert */ } };
  // mounted and showing: connected, in the world, no [hidden] ancestor (#cvParts at home) — no layout read
  const live = () => {
    if (deco.isConnected === false) return false;
    for (let n = deco; n && n.nodeType === 1; n = n.parentNode) { if (n.hasAttribute && n.hasAttribute('hidden')) return false; if (n.hasAttribute && n.hasAttribute('data-cv-world')) return true; }
    return false;
  };
  function drop() {
    gen++; at = 0;
    if (cv) { const c = cv; cv = null; try { c.width = 0; c.height = 0; c.remove(); } catch (err) { /* gone */ } }
    vis(false);
  }
  // (1h) env.onChange: the bitmap landed or the load failed — cv-face keeps its GL quad under a pending tier until then
  const changed = () => { if (typeof env.onChange === 'function') { try { env.onChange(); } catch (err) { console.error(err); } } };
  function fail(err) {
    if (!failed) console.warn('cv-panel: the face bitmap could not be made — the SVG stays', err);
    failed = true; drop();
    changed();
  }
  function later() { if (due || dead) return; due = true; raf(() => { due = false; refresh(); }); }
  function refresh() {
    if (dead || failed) return;
    const k = +scale() || 1;
    if (!(k < 1 - 1e-6)) { if (cv || at) drop(); else gen++; return; } // (a load in flight is dropped too)
    if (!live()) return;
    const d = Math.min(3, Math.max(1, +win.devicePixelRatio || 1)), s = d * k;
    const Wd = Math.max(1, Math.round(w * s)), Hd = Math.max(1, Math.round(h * s));
    if (cv && at === s && cv.width === Wd && cv.height === Hd) return;
    if (typeof Img !== 'function' || typeof Bl !== 'function' || !U || typeof U.createObjectURL !== 'function') { fail('no Image / Blob URL'); return; }
    const g = ++gen;
    let url = '', img = null;
    try { url = U.createObjectURL(new Bl([markup], { type: 'image/svg+xml' })); img = new Img(); } catch (err) { fail(err); return; }
    const done = ok => {
      try { U.revokeObjectURL(url); } catch (err) { /* gone */ }
      img.onload = img.onerror = null;
      if (g !== gen || dead) return; // superseded (another zoom end, k ≥ 1, a release) or destroyed
      if (!ok) { fail('the SVG did not decode as an image'); return; }
      paint(img, d, s, Wd, Hd);
    };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = url;
  }
  function paint(img, d, s, Wd, Hd) {
    const t0 = msNow();
    try {
      let si = Math.min(d, FACE_SS * s), src = img, tmp = null;
      if (w * h * si * si > FACE_MAX_PX) si = Math.sqrt(FACE_MAX_PX / (w * h));
      if (si > s * 1.25) { // the finer vector raster, then one filtered downscale
        tmp = doc.createElement('canvas');
        tmp.width = Math.max(1, Math.round(w * si)); tmp.height = Math.max(1, Math.round(h * si));
        tmp.getContext('2d').drawImage(img, 0, 0, tmp.width, tmp.height);
        src = tmp;
      }
      const c = cv || doc.createElement('canvas');
      c.width = Wd; c.height = Hd;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(src, 0, 0, Wd, Hd);
      if (tmp) { tmp.width = 0; tmp.height = 0; }
      if (!cv) {
        c.className = 'hw-bm'; c.setAttribute('aria-hidden', 'true');
        c.style.width = w + 'px'; c.style.height = h + 'px';
        deco.append(c); cv = c;
        offR = typeof wk.onRelease === 'function' ? wk.onRelease(c, () => { if (cv === c) { drop(); later(); } }) : null;
      }
      at = s; vis(true);
      const ms = msNow() - t0; faceStats.n++; faceStats.ms += ms; faceStats.max = Math.max(faceStats.max, ms);
      changed();
    } catch (err) { fail(err); }
  }
  const offS = typeof wk.onRescale === 'function' ? wk.onRescale(deco, refresh) : () => {};
  later();
  return {
    refresh, drop,
    destroy() { if (dead) return; dead = true; offS(); if (offR) offR(); drop(); },
    get shown() { return !!cv && at > 0; }, get failed() { return failed; }, get canvas() { return cv; }, get k() { return at; },
  };
}

/* ---------------------------------------------------------------- render: the live layer */
const SVGNS = 'http://www.w3.org/2000/svg';
/** The detented positions of a control: P (position → value, null = not emulated), V (the valid positions, in order),
 * posOf(v) (the position whose value is nearest v: a k control between detents shows the nearest one), kOf(v) (its
 * index in V). Taps, drags, keys and the wheel move over V, so a null position is drawn and always skipped. */
export function stepper(P) {
  const V = [];
  P.forEach((v, i) => { if (v != null) V.push(i); });
  const posOf = v => { let best = V[0], bd = Infinity; for (const i of V) { const d = Math.abs(P[i] - v); if (d < bd - 1e-9) { bd = d; best = i; } } return best; };
  return { P, V, posOf, kOf: v => Math.max(0, V.indexOf(posOf(v))) };
}
/**
 * Fills `root` (#inst) with the hardware panel of `L` and registers its controls through `api` (main.js hwApi: knob /
 * slider / selector / toggle are today's widgets, the rest are built here on api.bind / dragB / tap / watch).
 * Synchronous; one widget per live control; never measures. @returns {{w: number, h: number, destroy: () => void}}
 */
export function render(root, L, model, api) {
  const geo = geometry(L, model), S = isObj(L.scheme) ? L.scheme : {}, M = ctlsOf(model);
  const doc = (api && api.doc) || root.ownerDocument || globalThis.document;
  const mk = (tag, cls) => { const e = doc.createElement(tag); if (cls) e.className = cls; return e; };
  const sv = (tag, at) => { const e = doc.createElementNS(SVGNS, tag); for (const k in at) e.setAttribute(k, String(at[k])); return e; };
  const prop = (el, k, v) => { if (v == null || v === '') return; try { el.style.setProperty(k, String(v)); } catch (err) { /* inert */ } };
  const place = (el, r, ox, oy) => { el.style.left = (r.x - (ox || 0)) + 'px'; el.style.top = (r.y - (oy || 0)) + 'px'; el.style.width = r.w + 'px'; el.style.height = r.h + 'px'; };
  const hitVars = (el, hit) => { prop(el, '--hit-w', hit.w + 'px'); prop(el, '--hit-h', hit.h + 'px'); };
  const named = n => (n && isObj(S.rocker) && S.rocker[n]) || (n && isObj(S.switch) && S.switch[n]) || (n && isObj(S.button) && S.button[n]) || (typeof n === 'string' && n.startsWith('#') ? n : null);
  if (typeof root.replaceChildren === 'function') root.replaceChildren(); else root.textContent = '';
  const th = model.theme || {};
  root.className = `inst hw knob-${th.knob || 'std'} m-${model.id}` + (L.case === 'wood' ? ' hw-wood' : '');
  root.setAttribute('data-hw', L.id);
  root.style.width = geo.W + 'px'; root.style.height = geo.body.h + 'px';
  const K = Object.assign({ ptrStyle: 'line', capR: 0.7 }, isObj(S.knob) ? S.knob : {}), SL = isObj(S.slider) ? S.slider : {}, BT = isObj(S.button) ? S.button : {}, JK = isObj(S.jack) ? S.jack : {};
  for (const [k, v] of [['--hw-panel', S.panel], ['--hw-legend', S.legend], ['--hw-rule', S.rule || S.legend], ['--hw-accent', S.accent], ['--hw-wood', S.wood],
    ['--hw-case', L.case === 'wood' ? S.wood || '#5a3218' : L.case || S.panel], ['--hw-font', FONTS[S.font] || FONTS.sans],
    ['--hw-knob-skirt', K.skirt], ['--hw-knob-cap', K.cap], ['--hw-knob-ptr', K.ptr], ['--hw-sl-cap', SL.cap], ['--hw-sl-line', SL.line], ['--hw-sl-groove', SL.groove],
    ['--hw-btn-cap', BT.cap], ['--hw-led', BT.led], ['--hw-led-off', BT.ledOff], ['--hw-btn-text', BT.text], ['--hw-jack-nut', JK.nut], ['--hw-jack-hole', JK.hole]]) prop(root, k, v);
  root.setAttribute('data-ptr', K.ptrStyle);
  if (K.knurl) root.setAttribute('data-knurl', ''); else root.removeAttribute('data-knurl');
  if (SL.capShape) root.setAttribute('data-cap', SL.capShape);
  const deco = mk('div', 'hw-decor'), art = decorSvg(L, model);
  deco.innerHTML = art;
  const ctls = mk('div', 'hw-ctls');
  ctls.setAttribute('role', 'group'); ctls.setAttribute('aria-label', (model.name || model.id) + ' front panel');
  root.append(deco, ctls);
  const txtOf = (c, mc, P, i) => {
    const l = Array.isArray(c.legends) ? c.legends[i] : null;
    if (mc.t === 's' && P[i] != null && mc.opts[P[i]] != null && (l == null || String(l) in GLYPHS)) return String(mc.opts[P[i]]);
    if (l != null && !(String(l) in GLYPHS)) return String(l).replace(/\n/g, ' ');
    return P[i] == null ? '—' : mc.t === 'b' ? (P[i] ? 'On' : 'Off') : api.fmt(mc, P[i]);
  };
  // a binding over the valid positions (index in V) for dragB: a drag, the keys and the wheel step through them
  // (dragB's y axis runs up = more; `invert` makes up = fewer: for a rotary / slide pot the layout's, for a switch the art's)
  const posBinding = (c, mc, stp, axis, invert = !!c.invert) => Object.assign({}, api.bind(mc), {
    label: mc.label, get: () => stp.kOf(api.get(mc.id)), min: 0, max: Math.max(1, stp.V.length - 1), step: 1, def: stp.kOf(mc.def), axis, invert,
    set: k => { k = Math.max(0, Math.min(stp.V.length - 1, Math.round(k))); const v = stp.P[stp.V[k]]; if (v !== api.get(mc.id)) api.set(mc.id, v); },
    fmt: k => txtOf(c, mc, stp.P, stp.V[Math.max(0, Math.min(stp.V.length - 1, Math.round(k)))]),
  });
  const nextOf = (mc, stp) => () => { const k = stp.kOf(api.get(mc.id)), v = stp.P[stp.V[(k + 1) % stp.V.length]]; if (v !== api.get(mc.id)) api.set(mc.id, v); };
  // the knob drawing (today's structure and classes, so the knob skins apply): skirt, the rotating group, cap, pointer
  function pointer(rot, sk) {
    const ps = sk.ptrStyle || 'line', cr = 25 * (fin(sk.capR) ? Math.max(0.2, Math.min(1, sk.capR)) : 0.7);
    if (ps === 'dot') rot.append(sv('circle', { class: 'hw-pt', cx: 32, cy: n3(32 - cr + 4), r: 2.2 }));
    else if (ps === 'triangle') rot.append(sv('path', { class: 'hw-pt', d: 'M32 7.5L28.8 13.2H35.2Z' }));
    else if (ps === 'fin') rot.append(sv('path', { class: 'hw-pt hw-fin', d: 'M32 1.5L26.2 13.5A6.6 6.6 0 0 0 37.8 13.5Z' }));
    else if (ps === 'bar') rot.append(sv('rect', { class: 'hw-bar', x: 27.5, y: 7, width: 9, height: 50, rx: 4.5 }), sv('line', { class: 'ind', x1: 32, y1: 9.5, x2: 32, y2: 22 }));
    else rot.append(sv('line', cr < 19 ? { class: 'ind', x1: 32, y1: 8, x2: 32, y2: n3(32 - cr - 1) } : { class: 'ind', x1: 32, y1: n3(32 - cr + 1.8), x2: 32, y2: n3(32 - cr + 11) }));
  }
  function knobSvg(sk) {
    const cr = 25 * (fin(sk.capR) ? Math.max(0.2, Math.min(1, sk.capR)) : 0.7);
    const svg = sv('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true', focusable: 'false' }), rot = sv('g', { class: 'rot' });
    rot.append(sv('circle', { class: 'cap', cx: 32, cy: 32, r: n3(cr) }));
    pointer(rot, sk);
    svg.append(sv('circle', { class: 'skirt', cx: 32, cy: 32, r: 25 }), rot);
    return { svg, rot };
  }
  const skinOf = c => Object.assign({}, K, isObj(c.skin) ? c.skin : {});
  function skinVars(el, c) {
    const s = isObj(c.skin) ? c.skin : null;
    if (!s) return;
    prop(el, '--hw-knob-skirt', s.skirt); prop(el, '--hw-knob-cap', s.cap); prop(el, '--hw-knob-ptr', s.ptr);
    if (s.ptrStyle) el.setAttribute('data-ptr', s.ptrStyle);
    if (s.knurl != null) el.setAttribute('data-knurl', s.knurl ? '1' : '0');
  }
  // today's knob, its drawing adjusted to the skin (cap radius, pointer shape): its own nodes, looked up once
  function skinKnob(el, c) {
    skinVars(el, c);
    const sk = skinOf(c);
    if (typeof el.querySelector !== 'function') return;
    let cap = null, ind = null, rot = null; // (api.knob({ hw }) draws no tick ring or shine: 7a review 2 #3)
    try { cap = el.querySelector('.cap'); ind = el.querySelector('.ind'); rot = el.querySelector('.rot'); } catch (err) { return; }
    const cr = n3(25 * (fin(sk.capR) ? Math.max(0.2, Math.min(1, sk.capR)) : 0.7));
    if (cap && cap.setAttribute) cap.setAttribute('r', cr);
    if (ind && typeof ind.remove === 'function') ind.remove();
    if (rot && typeof rot.append === 'function') pointer(rot, sk);
  }
  function hwRotary(c, mc) {
    const P = positionsOf(c, mc), stp = stepper(P), sweep = c.sweep || 270, N = P.length, r0 = fin(c.rot) ? c.rot : 0;
    const el = mk('div', 'knob hw-rot');
    el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', mc.label);
    el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', String(N - 1));
    skinVars(el, c);
    const { svg, rot } = knobSvg(skinOf(c));
    el.append(svg);
    const upd = () => {
      const i = stp.posOf(api.get(mc.id));
      rot.setAttribute('transform', `rotate(${n3(r0 + (N > 1 ? -sweep / 2 + sweep * i / (N - 1) : 0))} 32 32)`);
      el.setAttribute('aria-valuenow', String(i)); el.setAttribute('aria-valuetext', txtOf(c, mc, P, i));
    };
    api.watch(mc.id, upd); upd();
    api.dragB(el, posBinding(c, mc, stp, 'y'), { tap: nextOf(mc, stp) });
    return el;
  }
  function hwSlider(c, mc) { // a detented slide pot (an "s" control, or "k" with map): the cap snaps to its legends
    const P = positionsOf(c, mc), stp = stepper(P), N = P.length, h = c.orient === 'h';
    const el = mk('div', 'slider hw-det');
    el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', mc.label);
    el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', String(N - 1));
    if (h) el.setAttribute('data-orient', 'h');
    const cap = mk('div', 'cap');
    if (named(c.color)) cap.style.background = named(c.color);
    el.append(mk('div', 'groove'), cap);
    const upd = () => {
      const i = stp.posOf(api.get(mc.id));
      let f = N > 1 ? i / (N - 1) : 0;
      if (c.invert) f = 1 - f;
      const p = `calc(${n3(f)} * (100% - var(--cap-h, 14px)))`;
      if (h) cap.style.left = p; else cap.style.bottom = p;
      el.setAttribute('aria-valuenow', String(i)); el.setAttribute('aria-valuetext', txtOf(c, mc, P, i));
    };
    api.watch(mc.id, upd); upd();
    api.dragB(el, posBinding(c, mc, stp, h ? 'x' : 'y'), { tap: nextOf(mc, stp) });
    return el;
  }
  function hwSwitch(c, mc, o) {
    const el = mk('button', 'hw-sw'), style = c.style || 'rocker', orient = c.orient || (c.h > c.w ? 'v' : 'h');
    el.type = 'button'; el.setAttribute('aria-label', mc.label);
    prop(el, '--kd', r05(Math.min(o.own.w, o.own.h) * 0.8) + 'px'); // (a bat / lever / slide knob's size)
    el.setAttribute('data-style', style); el.setAttribute('data-orient', orient);
    prop(el, '--sw-c', named(c.color));
    if (c.level) { // a level rocker (CS-80 SAW / SQUARE): a tap toggles 0 ↔ the last level, a drag along it sets the level
      el.setAttribute('data-level', ''); el.setAttribute('role', 'slider');
      el.setAttribute('aria-valuemin', String(mc.min)); el.setAttribute('aria-valuemax', String(mc.max));
      const fill = mk('u', 'hw-sw-fill');
      el.append(mk('i', 'hw-sw-a'), mk('i', 'hw-sw-b'), fill);
      let last = mc.max;
      const upd = () => {
        const v = api.get(mc.id), f = (v - mc.min) / ((mc.max - mc.min) || 1);
        if (v !== mc.min) last = v;
        fill.style[orient === 'v' ? 'height' : 'width'] = n3(Math.max(0, Math.min(1, f)) * 100) + '%';
        el.setAttribute('data-pos', v !== mc.min ? '1' : '0');
        el.setAttribute('aria-valuenow', String(v)); el.setAttribute('aria-valuetext', api.fmt(mc, v));
      };
      api.watch(mc.id, upd); upd();
      api.dragB(el, Object.assign({}, api.bind(mc), { axis: orient === 'h' ? 'x' : 'y' }), { tap: () => api.set(mc.id, api.get(mc.id) !== mc.min ? mc.min : last) });
      return el;
    }
    const P = positionsOf(c, mc), stp = stepper(P), N = P.length;
    el.setAttribute('data-n', String(N));
    let knob = null;
    if (style === 'rocker' || style === 'paddle') el.append(mk('i', 'hw-sw-a'), mk('i', 'hw-sw-b'));
    else { knob = mk('b', 'hw-sw-k'); el.append(mk('i', 'hw-sw-t'), knob); }
    if (N > 2) { el.setAttribute('role', 'slider'); el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', String(N - 1)); }
    const upd = () => {
      const i = stp.posOf(api.get(mc.id));
      el.setAttribute('data-pos', String(i));
      if (knob) prop(knob, '--f', n3(N > 1 ? i / (N - 1) : 0));
      if (N > 2) { el.setAttribute('aria-valuenow', String(i)); el.setAttribute('aria-valuetext', txtOf(c, mc, P, i)); }
      else { el.setAttribute('aria-pressed', i === 1 ? 'true' : 'false'); if (Array.isArray(c.legends) || mc.t === 's') el.setAttribute('aria-valuetext', txtOf(c, mc, P, i)); }
    };
    api.watch(mc.id, upd); upd();
    // (a vertical switch draws position 0 at the top, so up = fewer: invert, as cv-drum's slide(); the art ignores `invert` on a switch, so does this; 7a review 2)
    api.dragB(el, posBinding(c, mc, stp, orient === 'h' ? 'x' : 'y', orient === 'v'), { tap: nextOf(mc, stp) });
    return el;
  }
  const ledOn = (when, v) => { const [op, x] = Array.isArray(when) ? when : ['ne', 0]; return op === 'eq' ? v === x : op === 'ge' ? v >= x : op === 'in' ? Array.isArray(x) && x.includes(v) : v !== x; };
  function hwButton(c, mc) { // a latching push button: a tap steps through `cycle`; its LED shows the step (ledLevels)
    const P = positionsOf(c, mc), stp = stepper(P);
    const el = mk('button', 'hw-btn');
    el.type = 'button'; el.setAttribute('aria-label', mc.label); el.setAttribute('data-led', c.led || 'cap');
    prop(el, '--btn-c', named(c.color));
    const led = mk('span', 'hw-led');
    el.append(led);
    if (c.onCap) { const t = mk('span', 'hw-cap'); t.textContent = String(c.onCap); el.append(t); }
    const upd = () => {
      const k = stp.kOf(api.get(mc.id)), i = stp.V[k];
      el.setAttribute('aria-pressed', k > 0 ? 'true' : 'false');
      el.setAttribute('data-lit', Array.isArray(c.ledLevels) ? String(c.ledLevels[i] || 'off') : k > 0 ? 'on' : 'off');
      if (stp.V.length > 2) el.setAttribute('aria-valuetext', txtOf(c, mc, P, i)); else el.removeAttribute('aria-valuetext');
    };
    api.watch(mc.id, upd); upd();
    api.tap(el, nextOf(mc, stp));
    return el;
  }
  function hwButtons(c, mc, o) { // one lit of a group (radio); a combo value lights two (pressing the lit one of two releases it to the other)
    const jack = c.kind === 'jacks', combo = isObj(c.combo) ? c.combo : {};
    const grp = mk('div', 'hw-grp' + (jack ? ' hw-jacks' : ''));
    grp.setAttribute('role', 'radiogroup'); grp.setAttribute('aria-label', mc.label);
    const es = entriesOf(c), btns = es.map((e, i) => {
      const b = mk('button', jack ? 'hw-jk' : 'hw-btn hw-opt'), r = o.entries[i];
      b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('data-v', String(e.v));
      b.setAttribute('aria-label', String(e.label || (mc.t === 's' ? mc.opts[e.v] : api.fmt(mc, e.v))).replace(/\n/g, ' '));
      if (!jack) { b.setAttribute('data-led', c.led || 'cap'); prop(b, '--btn-c', named(e.color || c.color)); b.append(mk('span', 'hw-led')); if (e.onCap || c.onCap) { const t = mk('span', 'hw-cap'); t.textContent = String(e.onCap || c.onCap); b.append(t); } }
      else b.append(mk('i', 'hw-jk-ring'), mk('b', 'hw-jk-cord'));
      place(b, r.box, o.box.x, o.box.y);
      hitVars(b, r.hit);
      api.tap(b, () => press(e.v));
      grp.append(b);
      return b;
    });
    const litOf = v => { const pr = combo[v]; if (Array.isArray(pr)) return pr; let best = null, bd = Infinity; for (const e of es) { const d = Math.abs(e.v - v); if (d < bd) { bd = d; best = e.v; } } return [best]; };
    function press(v) {
      const cur = api.get(mc.id), lit = litOf(cur);
      let nv = v;
      if (lit.length === 2 && lit.includes(v)) nv = lit[0] === v ? lit[1] : lit[0]; // the lit one of two: release it
      else if (lit.length === 1 && lit[0] !== v) { for (const [cv, pr] of Object.entries(combo)) if (Array.isArray(pr) && pr.includes(v) && pr.includes(lit[0])) nv = +cv; }
      if (nv !== cur) api.set(mc.id, nv);
    }
    const upd = () => {
      const lit = litOf(api.get(mc.id));
      btns.forEach((b, i) => { const on = lit.includes(es[i].v); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.setAttribute('data-lit', on ? 'on' : 'off'); b.tabIndex = on && lit[0] === es[i].v ? 0 : -1; });
    };
    api.watch(mc.id, upd); upd();
    grp.addEventListener('keydown', e => { // radio group: one tab stop, the arrows move the selection
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      const cur = litOf(api.get(mc.id))[0], i = Math.max(0, es.findIndex(x => x.v === cur)), j = (i + d + es.length) % es.length;
      api.set(mc.id, es[j].v);
      try { btns[j].focus({ preventScroll: true }); } catch (err) { /* inert */ }
    });
    return grp;
  }
  /* ---- the special areas (§6.2 TB-303, §6.3 DX7): widgets bound to api.seq / api.dx, not to one models.js id */
  const post = []; // run once every widget is built (watchers chained after today's widgets set their own updater)
  const SQ = api.seq || null, DX = api.dx || null;
  const PF = api.perf || null, perfs = []; // (1i) the host's performance api (main.js PERF.api); every bed / controller / audition: {release, destroy}
  const tapBtn = (label, fn, cls) => { const b = mk('button', 'hw-btn' + (cls ? ' ' + cls : '')); b.type = 'button'; b.setAttribute('aria-label', label); b.append(mk('span', 'hw-led')); api.tap(b, fn); return b; };
  const lit = (el, on) => el.setAttribute('data-lit', on === 'dim' ? 'dim' : on ? 'on' : 'off');
  function seqWidget(c, o) {
    const id = c.id, st = SQ.state, step = () => SQ.q.pat[st.cur];
    const edit = () => { SQ.send(); SQ.redraw(); SQ.changed(); };
    const next = d => { st.cur = (st.cur + d + 16) % 16; SQ.redraw(); SQ.changed(); };
    if (id === 'seq:tempo') { // TEMPO over the pattern's bpm (40–220): today's number box as the hardware knob
      const el = mk('div', 'knob hw-tempo'), sw = c.sweep || 300, q = () => SQ.q;
      el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', 'Tempo');
      el.setAttribute('aria-valuemin', '40'); el.setAttribute('aria-valuemax', '220');
      skinVars(el, c);
      const { svg, rot } = knobSvg(skinOf(c));
      el.append(svg);
      const upd = () => { const v = q().bpm; rot.setAttribute('transform', `rotate(${n3(-sw / 2 + sw * (v - 40) / 180)} 32 32)`); el.setAttribute('aria-valuenow', String(v)); el.setAttribute('aria-valuetext', v + ' BPM'); };
      const b = { label: 'Tempo', min: 40, max: 220, step: 1, def: 128, axis: 'y', get: () => q().bpm, fmt: v => v + ' BPM',
        set: v => { v = Math.max(40, Math.min(220, Math.round(v))); if (v !== q().bpm) { q().bpm = v; SQ.send(); upd(); } }, snap: () => ({ v0: q().bpm }), restore: k => b.set(k.v0) };
      upd();
      api.dragB(el, b);
      return el;
    }
    if (id === 'seq:run') { // RUN / STOP (id seqrun: main.js seqToggle keeps it current; its last child is the state text)
      const b = tapBtn('Run / Stop', () => { if (!SQ.q.sync) SQ.toggle(!SQ.running()); });
      b.id = 'seqrun'; b.setAttribute('data-led', c.led || 'cap');
      const t = mk('span', 'hw-sr'); b.append(t);
      const upd = () => { const on = SQ.running(); b.setAttribute('aria-pressed', on ? 'true' : 'false'); t.textContent = on ? 'Stop' : 'Run'; lit(b, on); b.setAttribute('aria-disabled', SQ.q.sync ? 'true' : 'false'); };
      api.watch('@seqrun', upd); upd();
      return b;
    }
    if (id === 'seq:clear') { const b = tapBtn('Pattern clear', () => SQ.doClear()); b.setAttribute('data-led', c.led || 'cap'); return b; }
    const keyFn = {
      'seq:key': () => { if (st.mode !== 'pitch') return; const s0 = step(); s0.n = c.note; s0.g = 1; edit(); },
      'seq:pitch': () => { st.mode = 'pitch'; SQ.changed(); },
      'seq:time': () => { st.mode = 'time'; SQ.changed(); },
      'seq:down': () => { const s0 = step(); if (st.mode === 'time') { s0.g = 1; SQ.send(); next(1); } else { s0.o = s0.o === -1 ? 0 : -1; edit(); } },
      'seq:up': () => { const s0 = step(); if (st.mode === 'pitch') { s0.o = s0.o === 1 ? 0 : 1; edit(); } }, // (time mode: a tie — not emulated)
      'seq:accent': () => { const s0 = step(); if (st.mode === 'time') { s0.g = 0; SQ.send(); next(1); } else { s0.a = s0.a ? 0 : 1; edit(); } },
      'seq:slide': () => { const s0 = step(); if (st.mode === 'pitch') { s0.s = s0.s ? 0 : 1; edit(); } },
      'seq:back': () => next(-1), 'seq:next': () => next(1),
    }[id];
    if (!keyFn) return null;
    const NAMES = { 'seq:pitch': 'Pitch mode', 'seq:time': 'Time mode', 'seq:down': 'Transpose down', 'seq:up': 'Transpose up', 'seq:accent': 'Accent', 'seq:slide': 'Slide', 'seq:back': 'Back', 'seq:next': 'Write / next' };
    const KEYS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B', 'C′'];
    const b = tapBtn(id === 'seq:key' ? 'Key ' + KEYS[c.note] : NAMES[id], keyFn);
    if (c.onCap) { const t = mk('span', 'hw-cap'); t.textContent = String(c.onCap); b.append(t); }
    if (id === 'seq:key' && PF) { // (1i §6.4) PITCH mode: a press also sounds the note while held (the cursor step's octave and accent)
      b.setAttribute('data-gesture', 'music'); // (two fingers on two cells: two notes, never a pinch; the cell released last writes)
      const held = new Map(); // pointerId → note
      b.addEventListener('pointerdown', e => {
        if (st.mode !== 'pitch' || e.button !== 0 || e.ctrlKey || held.has(e.pointerId)) return;
        const s0 = step(), n = KY.seqNote({ n: c.note, o: s0.o });
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
        held.set(e.pointerId, n);
        PF.on(n, KY.seqVel(s0), e.timeStamp);
      });
      const end = e => { const n = held.get(e.pointerId); if (n == null) return; held.delete(e.pointerId); PF.off(n, e.timeStamp); };
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, end);
      const rel = () => { for (const [pid, n] of [...held]) { held.delete(pid); try { b.releasePointerCapture(pid); } catch (err) { /* released */ } PF.off(n); } };
      const offBed = PF.bed(rel);
      perfs.push({ release: rel, destroy: () => { offBed(); rel(); } });
    }
    b.setAttribute('data-led', c.led || 'cap');
    const ledOf = {
      'seq:key': () => st.mode === 'pitch' && step().g && step().n === c.note, 'seq:pitch': () => st.mode === 'pitch', 'seq:time': () => st.mode === 'time',
      'seq:down': () => step().o === -1, 'seq:up': () => step().o === 1, 'seq:accent': () => !!step().a, 'seq:slide': () => !!step().s,
    }[id];
    const upd = () => { const on = ledOf ? !!ledOf() : false; lit(b, on); if (id !== 'seq:back' && id !== 'seq:next') b.setAttribute('aria-pressed', on ? 'true' : 'false'); };
    SQ.onChange(upd); upd();
    return b;
  }
  // the DX7 (§6.3): select a parameter with a button, set it with DATA ENTRY or NO / YES; the LCD and LED say what
  const dxB = []; // {n, el, wrap}
  let dxRefresh = () => {};
  function dxWidget(c, o, w) {
    const id = c.id, st = DX.state, addr = () => (st.mode === 'edit' || st.mode === 'function' ? dxAddr(st.mode === 'function' ? 17 : st.param, st) : null);
    if (id === 'dx:btn') {
      const b = mk('button', 'hw-btn hw-dxb');
      b.type = 'button'; b.setAttribute('data-n', String(c.n)); b.setAttribute('data-led', 'none');
      prop(b, '--btn-c', named(c.color));
      b.append(mk('span', 'hw-led'));
      if (c.onCap) { const t = mk('span', 'hw-cap'); t.textContent = String(c.onCap); b.append(t); }
      const label = String(c.label || 'Button ' + c.n).replace(/\n/g, ' ');
      api.tap(b, () => {
        if (st.mode === 'play') { if (c.n <= DX.presets) DX.load(c.n); dxRefresh(); return; }
        const a = dxAddr(c.n, st);
        if (!a) { if (api.tip) { api.tip(b, label + ' — not emulated'); if (api.untip) api.untip(1200); } return; }
        if (st.mode === 'edit') { if ((c.n === 21 || c.n === 22) && st.param === c.n) st.eg = st.eg % 4 + 1; st.param = c.n; }
        dxRefresh();
      });
      dxB.push({ n: c.n, el: b, wrap: w, label });
      return b;
    }
    if (id === 'dx:opsel' || id === 'dx:edit' || id === 'dx:function' || id === 'dx:memInt') {
      const names = { 'dx:opsel': 'Operator select', 'dx:edit': 'Edit / compare', 'dx:function': 'Function', 'dx:memInt': 'Memory select internal' };
      const b = tapBtn(names[id], () => {
        if (id === 'dx:opsel') { st.op = st.op % 6 + 1; if (st.mode !== 'edit') st.mode = 'edit'; }
        else st.mode = id === 'dx:edit' ? 'edit' : id === 'dx:function' ? 'function' : 'play';
        dxRefresh();
      });
      prop(b, '--btn-c', named(c.color));
      b.setAttribute('data-led', 'none');
      const upd = () => { const on = id === 'dx:opsel' ? false : st.mode === { 'dx:edit': 'edit', 'dx:function': 'function', 'dx:memInt': 'play' }[id]; b.setAttribute('aria-pressed', on ? 'true' : 'false'); lit(b, on); };
      dxB.push({ n: 0, el: b, upd });
      return b;
    }
    if (id === 'dx:no' || id === 'dx:yes') {
      const d = id === 'dx:yes' ? 1 : -1;
      const b = tapBtn(d > 0 ? 'Yes (+1)' : 'No (−1)', () => {
        const a = addr(), mc = a && M.get(a);
        if (!mc) return;
        const stp = mc.step || (mc.max - mc.min) / 100, v = Math.max(mc.min, Math.min(mc.max, +(api.get(a) + d * stp).toFixed(4)));
        if (v !== api.get(a)) api.set(a, v);
      });
      prop(b, '--btn-c', named(c.color));
      b.setAttribute('data-led', 'none');
      return b;
    }
    if (id === 'dx:data') { // DATA ENTRY: a slide pot over whatever is selected (its cap jumps to the selection's value)
      const el = mk('div', 'slider hw-dx');
      el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', 'Data entry');
      const cap = mk('div', 'cap');
      if (named(c.color)) cap.style.background = named(c.color);
      el.append(mk('div', 'groove'), cap);
      const cur = () => { const a = addr(), mc = a && M.get(a); return mc ? api.bind(mc) : null; };
      const NONE = { label: 'Data entry', min: 0, max: 1, step: 0, def: 0, get: () => 0, set: () => {}, fmt: () => '—', snap: () => null, restore: () => {} };
      const b = {
        get label() { return (cur() || NONE).label; }, get min() { return (cur() || NONE).min; }, get max() { return (cur() || NONE).max; },
        get step() { return (cur() || NONE).step; }, get def() { return (cur() || NONE).def; }, axis: c.orient === 'h' ? 'x' : 'y',
        get: () => (cur() || NONE).get(), set: v => (cur() || NONE).set(v), fmt: v => (cur() || NONE).fmt(v),
        snap: () => { const k = cur(); return k ? { k, t: k.snap() } : null; }, restore: s0 => { if (s0) s0.k.restore(s0.t); },
      };
      api.dragB(el, b);
      const upd = () => {
        const k = cur(), f = k ? (k.get() - k.min) / ((k.max - k.min) || 1) : 0, p = `calc(${n3(Math.max(0, Math.min(1, f)))} * (100% - var(--cap-h, 14px)))`;
        if (c.orient === 'h') cap.style.left = p; else cap.style.bottom = p;
        el.setAttribute('aria-valuetext', k ? k.label + ' ' + k.fmt(k.get()) : '—');
      };
      dxB.push({ n: 0, el, upd });
      return el;
    }
    return null;
  }
  function dxShow(c, o) { // the LED (preset number), the LCD, the algorithm chart
    const st = DX.state, r = o.own || o.box;
    if (c.id === 'dx:led') {
      const el = mk('span', 'hw-dsp'); place(el, r);
      el.setAttribute('aria-live', 'off'); el.setAttribute('aria-label', 'Preset number');
      const upd = () => { const n = typeof api.presetNo === 'function' ? api.presetNo() : null; el.textContent = n ? String(n).padStart(2, ' ') : '--'; };
      api.watch('@preset', upd); upd();
      return el;
    }
    if (c.id === 'dx:lcd') {
      const el = mk('div', 'hw-lcd'), l1 = mk('span'), l2 = mk('span');
      place(el, r);
      prop(el, '--lcd-fs', n3(Math.max(6, Math.min(14, (r.w - 12) / (16 * 0.62), (r.h - 2) / 2.5))) + 'px'); // 16 × 2 characters fill the window

      el.setAttribute('aria-live', 'polite'); el.setAttribute('aria-label', 'Display');
      el.append(l1, l2);
      const upd = () => {
        const a = st.mode === 'play' ? null : dxAddr(st.mode === 'function' ? 17 : st.param, st), mc = a && M.get(a);
        const n = typeof api.presetNo === 'function' ? api.presetNo() : null;
        const [x, y] = dxLcd(st, Math.round(api.get('alg')), a, mc ? api.fmt(mc, api.get(a)) : '', n, DX.presetName ? DX.presetName() : '');
        l1.textContent = x; l2.textContent = y;
      };
      dxB.push({ n: 0, el, upd });
      api.watch('@preset', upd);
      return el;
    }
    if (c.id === 'dx:chart') { // all 32 algorithms, two rows of 16 (algoLayout), the current one lit
      const el = mk('div', 'hw-chart'); place(el, r);
      el.setAttribute('aria-hidden', 'true');
      const W = r.w, H = r.h, cw = W / 16, ch = H / 2, svg = sv('svg', { viewBox: `0 0 ${n3(W)} ${n3(H)}`, width: n3(W), height: n3(H) }), cells = [];
      for (let i = 0; i < 32 && DX.algs && DX.algs[i]; i++) {
        const [edges, car] = DX.algs[i], L2 = DX.layout(edges, car), g = sv('g', { transform: `translate(${n3((i % 16) * cw)} ${n3(Math.floor(i / 16) * ch)})` });
        const bs = Math.min((cw - 4) / Math.max(1, L2.cols), (ch - 10) / (L2.maxL + 1)) * 0.62, px2 = (cw - 4) / Math.max(1, L2.cols), py2 = (ch - 10) / (L2.maxL + 1);
        const P2 = k => ({ x: 2 + L2.xs[k] * px2 + px2 / 2, y: 2 + (L2.maxL - L2.lvl[k]) * py2 + py2 / 2 });
        let d = '';
        for (const [f, t] of edges) { const A = P2(f), B = P2(t); d += `M${n3(A.x)} ${n3(A.y)}L${n3(B.x)} ${n3(B.y)}`; }
        g.append(sv('path', { d: d || 'M0 0', class: 'hw-ch-e' }));
        for (let k = 1; k <= 6; k++) { const A = P2(k); g.append(sv('rect', { x: n3(A.x - bs / 2), y: n3(A.y - bs / 2), width: n3(bs), height: n3(bs), class: car.includes(k) ? 'hw-ch-c' : 'hw-ch-o' })); }
        const t = sv('text', { x: n3(cw / 2), y: n3(ch - 2), class: 'hw-ch-n' }); t.textContent = String(i + 1);
        g.append(t);
        svg.append(g); cells.push(g);
      }
      el.append(svg);
      let on = -1;
      const upd = () => { const a = Math.max(1, Math.min(32, Math.round(api.get('alg')))) - 1; if (a === on) return; if (cells[on]) cells[on].removeAttribute('data-on'); if (cells[a]) cells[a].setAttribute('data-on', ''); on = a; };
      upd();
      post.push(() => api.watch('alg', upd));
      return el;
    }
    return null;
  }
  /* ---- (1i, IMPL-1i §3.2, §4, §5) the keys and the controllers, bound to api.perf (null: the same nodes, silent) */
  const tipOn = (el, text) => {
    el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse' && api.tip) api.tip(el, text); });
    el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && api.untip) api.untip(); });
  };
  function bedWidget(c, o) {
    const ob = o.bed, el = mk('div', 'hw-keys'), shades = new Map();
    if (!ob) return null;
    const note = KY.velNote(model.id);
    el.setAttribute('data-gesture', 'music'); el.setAttribute('role', 'group'); el.setAttribute('aria-roledescription', 'keyboard');
    el.setAttribute('aria-label', `${model.name || model.id} keyboard, ${ob.n} keys, ${KY.noteName(ob.lo)}–${KY.noteName(ob.hi)}; ${note}`);
    for (const k of ob.keys) { // a pressed key's dip: at its art, unrounded (o.bed), hidden until pressed
      const s = mk('div', 'hw-kd');
      s.setAttribute('data-note', String(k.note)); s.setAttribute('hidden', '');
      place(s, { x: q3(k.x - ob.box.x), y: q3(k.y - ob.box.y), w: k.w, h: k.h });
      if (!k.black) { // (a white key's full rectangle runs under its black neighbours, which the art draws over it: clip the shade to what shows, static, in its own px)
        let lx = 0, rx = k.w, bl = 0;
        for (const b of ob.keys) {
          if (!b.black || !(b.x < k.x + k.w - 1e-6 && b.x + b.w > k.x + 1e-6)) continue;
          if (b.x + b.w / 2 < k.x + k.w / 2) lx = Math.max(lx, b.x + b.w - k.x); else rx = Math.min(rx, b.x - k.x);
          bl = Math.max(bl, b.y + b.h - k.y);
        }
        if (bl > 0) { const pt = (x, y) => n3(x) + 'px ' + n3(y) + 'px'; s.style.clipPath = `polygon(${[pt(lx, 0), pt(rx, 0), pt(rx, bl), pt(k.w, bl), pt(k.w, k.h), pt(0, k.h), pt(0, bl), pt(lx, bl)].join(', ')})`; }
      }
      el.append(s); shades.set(k.note, s);
    }
    if (!PF) { el.setAttribute('aria-disabled', 'true'); return el; }
    const shade = (n, on) => { const s = shades.get(n); if (s) { if (on) s.removeAttribute('hidden'); else s.setAttribute('hidden', ''); } };
    const E = KY.bed(el, ob.mm, { on: (n, v, ts) => PF.on(n, v, ts), off: (n, ts) => PF.off(n, ts), at: ob.at ? v => PF.at(v) : null, shade });
    const offLit = PF.lit((n, on) => E.lit(n, on)), offBed = PF.bed(() => E.release());
    for (const n of PF.held() || []) E.lit(n, true); // (a bed mounts lit)
    tipOn(el, 'Keyboard: ' + note);
    perfs.push({ release: () => E.release(), destroy: () => { offLit(); offBed(); E.destroy(); } });
    return el;
  }
  const CTL_NAME = { bend: { wheel: 'Pitch bend wheel', lever: 'Pitch bend lever', ribbon: 'Ribbon controller (pitch bend)' }, wheel: { wheel: 'Modulation wheel', lever: 'Modulation lever', pad: 'Modulation pad' } };
  function ctlWidget(c, o) {
    const kind = KY.ctlKind(c.id), K = c.kind, sk = skinOfPerf(c, S), r = o.own, el = mk('div', 'hw-' + K);
    el.setAttribute('data-gesture', 'perf');
    const name = (CTL_NAME[kind] && CTL_NAME[kind][K]) || c.id;
    el.setAttribute('aria-label', name);
    if (K === 'pad') { el.setAttribute('role', 'button'); el.setAttribute('aria-pressed', 'false'); }
    else {
      el.setAttribute('role', 'slider'); el.setAttribute('aria-valuemin', kind === 'bend' ? '-1' : '0'); el.setAttribute('aria-valuemax', '1');
      el.setAttribute('aria-orientation', K === 'ribbon' || (K === 'lever' && c.axis === 'x') || (K === 'wheel' && c.orient === 'h') ? 'horizontal' : 'vertical');
    }
    if (K === 'wheel') el.setAttribute('data-orient', c.orient === 'h' ? 'h' : 'v');
    if (K === 'lever') el.setAttribute('data-axis', c.axis === 'x' ? 'x' : 'y');
    for (const [k, v] of [['--pf-slot', sk.slot], ['--pf-surface', sk.surface], ['--pf-ridge', sk.ridge], ['--pf-mark', sk.mark], ['--pf-cap', sk.cap], ['--pf-lit', sk.lit]]) prop(el, k, v);
    const X2 = PX_PER_MM, rect = (n, m) => place(n, { x: q3(m.x * X2), y: q3(m.y * X2), w: q3(m.w * X2), h: q3(m.h * X2) });
    let upd = () => {};
    if (K === 'wheel') {
      const hz = c.orient === 'h', ws = mk('i', 'hw-ws'), wm = c.detent ? mk('b', 'hw-wm') : null;
      prop(el, '--pf-dir', hz ? '90deg' : '180deg'); prop(el, '--pf-rp', n3(WHEEL.ridgeP * X2) + 'px'); prop(el, '--pf-rw', n3(WHEEL.ridgeW * X2) + 'px');
      el.append(ws); if (wm) el.append(wm);
      upd = v => {
        const p = perfParts(c, kind, v), off = n3(-p.roll * X2) + 'px'; // (the ridges move with the finger: up / right raises)
        rect(ws, p.surf); ws.style.backgroundPosition = hz ? `${n3(p.roll * X2)}px 0` : `0 ${off}`;
        if (wm) rect(wm, p.mark);
      };
    } else if (K === 'lever') {
      const cap = mk('b', 'hw-lc');
      el.append(cap);
      upd = v => rect(cap, perfParts(c, kind, v).cap);
    } else if (K === 'ribbon') {
      const m = mk('b', 'hw-rm');
      m.setAttribute('hidden', '');
      el.append(m);
      upd = (v, t) => { if (t == null) m.setAttribute('hidden', ''); else { m.removeAttribute('hidden'); m.style.left = n3(Math.max(0, Math.min(c.w, t)) * X2) + 'px'; } };
    } else if (K === 'pad') {
      const l = mk('b', 'hw-pl');
      el.append(l); el.style.borderRadius = n3(2 * X2) + 'px';
      upd = v => { l.style.opacity = n3(Math.max(0, Math.min(1, v))); };
    }
    const show = (v, t) => {
      upd(v, t);
      if (K !== 'pad') { el.setAttribute('aria-valuenow', n3(v)); el.setAttribute('aria-valuetext', KY.ctlText(kind, v)); }
    };
    if (!PF) { show(0, null); el.setAttribute('aria-disabled', 'true'); el.tabIndex = -1; return el; }
    el.tabIndex = 0;
    show(PF.value(kind), null);
    const C = KY.controller(el, c, { perf: PF, track: typeof api.track === 'function' ? api.track : null, show, pressed: on => el.setAttribute('aria-pressed', on ? 'true' : 'false') });
    const offBed = PF.bed(() => C.release());
    const orig = typeof c.tip === 'string' && c.tip ? c.tip : kind === 'bend' && KY.BEND_ORIG[model.id] ? 'the original: ' + KY.BEND_ORIG[model.id] : '';
    tipOn(el, name + (kind === 'bend' ? ' · ±' + KY.BEND_ST + ' semitones' : '') + (orig ? (kind === 'bend' ? ' (' + orig + ')' : ' · ' + orig) : ''));
    perfs.push({ release: () => C.release(), destroy: () => { offBed(); C.destroy(); } });
    return el;
  }
  const perfWidget = (c, o) => { KY.ensureCSS(doc); return c.kind === 'keys' ? bedWidget(c, o) : ctlWidget(c, o); };
  // (7a, IMPL-7a §7.4) the TR-808's dr: widgets (cv-drum.js drumPanel) over api.drum (null: the same nodes, silent); (7b) the 606's
  let DRP = null;
  const drp = () => DRP || (DRP = CD.drumPanel(api.drum || null, { doc, api, root, model: model.id, mk, sv, place, prop, hitVars, named, knobSvg, skinVars, skinOf, n3, r05 })); // ((7b) model: the machine's widgets before a record exists)
  // (8, IMPL-8 §13.2) a grouped token bound to a switch (the SDS-V's memory keys): one radio per group — built at the group's
  // first key in the Tab order, the others skipped — over the keys' own boxes and hit boxes (hwButtons: the LEDs, the arrows,
  // one tab stop), its wrapper the switch's (data-ctl = data-dest = x<ch>p: the mod drop, the halo, the ui entry). A key
  // writes the switch (index n − 1) as any panel switch: presets carry it, no History step (undo never reverts a knob or switch)
  const MEM_TXT = ['our factory sound', 'the knobs', 'trimmers (TRIM…)', 'trimmers (TRIM…)'], bound = new Set();
  function boundWidget(c) {
    const T = TOKENS[model.id], g = T && T.grp && T.grp[c.id], pat = T && T.bind && T.bind[c.id], ix = T && T.idx && T.idx[c.id];
    if (!g || !pat || !ix || bound.has(c.id + '#' + c[g[0]])) return null;
    bound.add(c.id + '#' + c[g[0]]);
    const id = pat.replace('?', c[g[0]]), mc = M.get(id);
    if (!mc) return null;
    const ks = geo.controls.filter(q => q.live && q.id === c.id && L.controls[q.i][g[0]] === c[g[0]]).map(q => ({ o: q, c: L.controls[q.i] })).sort((a, b) => a.c[ix[0]] - b.c[ix[0]]);
    const u = { x: Math.min(...ks.map(k => k.o.box.x)), y: Math.min(...ks.map(k => k.o.box.y)) };
    u.w = Math.max(...ks.map(k => k.o.box.x + k.o.box.w)) - u.x; u.h = Math.max(...ks.map(k => k.o.box.y + k.o.box.h)) - u.y;
    const sec = (model.sections || []).find(s => (s.c || []).some(x => x.id === id)), name = sec ? sec.title : '';
    const cc = { kind: 'buttons', led: ks[0].c.led || 'cap', color: ks[0].c.color,
      at: ks.map(k => ({ v: k.c[ix[0]] - ix[1], color: k.c.color, onCap: k.c.onCap, label: `Memory ${k.c[ix[0]]} · ${MEM_TXT[k.c[ix[0]] - 1] || ''}` })) };
    const el = hwButtons(cc, Object.assign({}, mc, { label: (name ? name + ' · ' : '') + mc.label }), { box: u, entries: ks.map(k => ({ box: k.o.box, hit: k.o.hit })) });
    const w = mk('div', 'hw-c');
    w.setAttribute('data-ctl', id); w.setAttribute('data-dest', id); w.setAttribute('data-kind', 'buttons');
    place(w, u);
    w.append(el);
    return w;
  }
  function liveWidget(c, o) {
    const mc = M.get(c.id);
    if (!mc && TOKENS[model.id] && TOKENS[model.id].bind && TOKENS[model.id].bind[c.id]) return boundWidget(c); // ((8) the SDS-V's memory keys)
    if (!mc) { // a token (TB-303 / DX7 special areas; 1i: the keys and the controllers; 7a: the 808's sequencer)
      const w = mk('div', 'hw-c'), el = c.id.startsWith('seq:') && SQ ? seqWidget(c, o) : c.id.startsWith('dx:') && DX ? dxWidget(c, o, w) : c.id.startsWith('perf:') ? perfWidget(c, o)
        : c.id.startsWith('dr:') ? drp().widget(c, o) : null;
      if (!el) return null;
      w.setAttribute('data-ctl', c.id); w.setAttribute('data-kind', c.kind);
      // (2b, IMPL-2b §6.2) no data-dest: a seq: / dx: token is no models.js control (cv-mods CLASS_TABLE has no class for
      // it — the 303's pattern tempo, the DX7's mode buttons and DATA ENTRY address no fixed parameter); data-nomod makes a
      // mod drag say so instead of falling through to the module
      w.setAttribute('data-nomod', '1');
      place(w, o.box);
      if (c.kind === 'slider') { const cap = capOf(c); prop(w, '--cap-w', cap[0] * PX_PER_MM + 'px'); prop(w, '--cap-h', cap[1] * PX_PER_MM + 'px'); } // (DATA ENTRY)
      hitVars(el, o.hit);
      w.append(el);
      return w;
    }
    const w = mk('div', 'hw-c'), k = c.kind;
    w.setAttribute('data-ctl', c.id); w.setAttribute('data-dest', c.id); w.setAttribute('data-kind', k); // (data-dest: 1c, the canvas's modulation drops)
    place(w, o.box);
    let el = null;
    if (k === 'knob') { el = api.knob(Object.assign({}, mc, { sweep: c.sweep || 270, hw: true })); skinKnob(el, c); }
    else if (k === 'slider' && mc.t === 'k' && !Array.isArray(c.map)) {
      const cap = capOf(c);
      prop(w, '--cap-w', cap[0] * PX_PER_MM + 'px'); prop(w, '--cap-h', cap[1] * PX_PER_MM + 'px');
      el = api.slider(Object.assign({}, mc, { orient: c.orient === 'h' ? 'h' : 'v', invert: !!c.invert, hw: true, capColor: named(c.color) }), -1);
    } else if (k === 'slider') { const cap = capOf(c); prop(w, '--cap-w', cap[0] * PX_PER_MM + 'px'); prop(w, '--cap-h', cap[1] * PX_PER_MM + 'px'); el = hwSlider(c, mc); }
    else if (k === 'rotary') el = hwRotary(c, mc);
    else if (k === 'switch') el = hwSwitch(c, mc, o);
    else if (k === 'button') el = hwButton(c, mc);
    else if (k === 'buttons' || k === 'jacks') el = hwButtons(c, mc, o);
    if (!el) return null;
    if (k !== 'buttons' && k !== 'jacks') hitVars(el, o.hit);
    w.append(el);
    return w;
  }
  function showWidget(c, o) { // a live display: an LED following a control, the preset number
    if (c.id === 'seq:runLed' && SQ) {
      const el = mk('span', 'hw-led hw-show'); place(el, o.own || o.box);
      prop(el, '--led-c', named(c.color) || c.color);
      const upd = () => el.setAttribute('data-lit', SQ.running() ? 'on' : 'off');
      api.watch('@seqrun', upd); upd();
      return el;
    }
    if (typeof c.id === 'string' && c.id.startsWith('dx:') && DX) return dxShow(c, o);
    if (typeof c.id === 'string' && c.id.startsWith('dr:')) return drp().show(c, o); // (7a) the PART and variation LEDs
    if (c.kind === 'led' && c.id == null) {
      const el = mk('span', 'hw-led hw-show'), r = o.own || o.box;
      place(el, r);
      prop(el, '--led-c', named(c.color) || c.color);
      const upd = () => el.setAttribute('data-lit', ledOn(c.when, api.get(c.of)) ? 'on' : 'off');
      api.watch(c.of, upd); upd();
      return el;
    }
    if (c.kind === 'display' && c.show === 'preset') {
      const el = mk('span', 'hw-dsp'), r = o.own || o.box, dg = c.digits > 0 ? c.digits | 0 : 2;
      place(el, r);
      el.setAttribute('aria-live', 'off'); el.setAttribute('aria-label', 'Preset number');
      prop(el, '--dsp-c', named(c.color) || c.color);
      const upd = () => { const n = typeof api.presetNo === 'function' ? api.presetNo() : null; el.textContent = n ? String(n).padStart(dg, ' ') : '-'.repeat(dg); };
      api.watch('@preset', upd); upd();
      return el;
    }
    return null;
  }
  for (const i of geo.order) {
    const c = L.controls[i], o = geo.controls[i];
    const el = o.live ? liveWidget(c, o) : o.show ? showWidget(c, o) : null;
    if (el) ctls.append(el);
  }
  // the extras strip: our controls with no hardware counterpart, as today's widgets (they look like ours, never like the hardware)
  const X = geo.extras;
  if (X) {
    const xs = mk('div', 'hw-extras' + (X.cells.length ? '' : ' hw-xnote'));
    place(xs, X);
    const cap = mk('span', 'hw-xcap');
    cap.textContent = [X.caption, X.note ? 'Dimmed controls are not emulated' : ''].filter(Boolean).join(' · ');
    const own = TOKENS[model.id] && TOKENS[model.id].caption && X.caption === TOKENS[model.id].caption; // ((8) a model's own caption: the plain estimate)
    const fit = xcapFit(cap.textContent, X.w - 2 * XPAD, own ? 1 : XCAP_K); // ((7c; review 2 F4: every strip) a caption that does not fit: smaller type, never measured; one that fits as before)
    if (fit) { cap.style.fontSize = fit.fs + 'px'; cap.style.letterSpacing = fit.ls + 'em'; }
    xs.append(cap);
    const SEQX = SQ ? { 'seq:sync': SQ.sync, 'seq:swing': SQ.swing, 'seq:random': SQ.rnd, 'seq:demo': SQ.demo, 'seq:toRoll': SQ.toRoll, 'seq:grid': SQ.steps } : {};
    for (const cell of X.cells) {
      const mc = M.get(cell.id);
      const dex = !mc && cell.id.startsWith('dr:') ? drp().extra(cell) : null; // (7a) the 808's grid, pads and small controls
      if (!mc && (SEQX[cell.id] || dex)) { // today's sequencer parts (classes and ids unchanged), the grid included
        const w = mk('div', 'hw-xcell'); w.setAttribute('data-ctl', cell.id); w.setAttribute('data-nomod', '1'); // ((2b) a token: no parameter)
        place(w, cell, X.x, X.y);
        w.append(dex || SEQX[cell.id]);
        xs.append(w);
        continue;
      }
      if (!mc) continue;
      const w = mk('div', 'ctl t-' + mc.t);
      w.setAttribute('data-ctl', cell.id); w.setAttribute('data-dest', cell.id);
      place(w, cell, X.x, X.y);
      const el = mc.t === 'k' ? api.knob(mc) : mc.t === 's' ? api.selector(mc) : api.toggle(mc), lab = mk('label');
      lab.textContent = mc.label;
      w.append(el, lab);
      xs.append(w);
    }
    root.append(xs);
  }
  // the DX7's buttons follow its state: the id each addresses (data-ctl, rebound on OP / EG / mode), live or dimmed in this
  // mode, the selected one ringed; every DX7 id refreshes the displays when it is the addressed one (one watcher each)
  if (DX && dxB.length) {
    const st = DX.state;
    dxRefresh = () => {
      const sel = st.mode === 'edit' ? st.param : st.mode === 'function' ? 17 : 0;
      for (const B of dxB) {
        if (B.upd) { B.upd(); continue; }
        const a = st.mode === 'play' ? null : dxAddr(B.n, st), on = st.mode === 'play' ? B.n <= DX.presets : !!a;
        B.wrap.setAttribute('data-ctl', a || 'dx:btn');
        B.el.setAttribute('aria-label', a && M.get(a) ? B.label + ' — ' + M.get(a).label : st.mode === 'play' && on ? 'Preset ' + B.n : B.label);
        if (on) B.el.removeAttribute('data-off'); else B.el.setAttribute('data-off', '');
        if (B.n === sel && a) B.el.setAttribute('data-sel', ''); else B.el.removeAttribute('data-sel');
        B.el.setAttribute('aria-pressed', B.n === sel && a ? 'true' : 'false');
      }
    };
    post.push(() => { for (const id of M.keys()) api.watch(id, () => { const a = st.mode === 'play' ? null : dxAddr(st.mode === 'function' ? 17 : st.param, st); if (id === a || id === 'alg') dxRefresh(); }); });
    dxRefresh();
  }
  for (const f of post) f();
  if (DRP) DRP.start(); // (7a) the 808's widgets: the first paint, then the host's step clock
  // (1h) the face registered with cv-face (api.tier: false → none; an object → the tier's / the loader's env): a GPU
  // texture on the GL path ('gl'), else the 1g bitmap tier ('dom', faceTier). moduleOf: the .cv-mod ancestor's id;
  // offset: the deco's top-left inside the module (world px) — offsetLeft / offsetTop up the offset parents, a layout
  // read cv-face makes at mount / refresh / a rest only (a stub DOM without offsets: 0, BAR_H)
  const face = deco.firstChild;
  const moduleOf = () => { for (let n = deco; n && n.nodeType === 1; n = n.parentNode) if (n.hasAttribute && n.hasAttribute('data-cv-mod')) return n.getAttribute('data-cv-mod'); return null; };
  const offset = () => {
    let x = 0, y = 0, n = deco;
    for (; n && n.nodeType === 1 && !(n.hasAttribute && n.hasAttribute('data-cv-mod')); n = n.offsetParent) {
      const l = +n.offsetLeft, t = +n.offsetTop;
      if (l !== l || t !== t) return { x: 0, y: BAR_H };
      x += l; y += t;
    }
    return n && n.nodeType === 1 ? { x, y } : { x: 0, y: BAR_H };
  };
  const tier = api && api.tier === false || !face ? null : FACES.register(deco, { markup: art, w: geo.W, h: geo.body.h, moduleOf, offset, tier: faceTier, env: api && typeof api.tier === 'object' ? api.tier : null });
  // a tap on a dimmed (inert) control says it is not emulated (under the bitmap or the GL face — the SVG visibility:
  // hidden — the SVG is hit-tested for that one point, in every mode)
  deco.addEventListener('click', e => {
    let t = e.target;
    if (tier && tier.shown && t === deco && typeof doc.elementFromPoint === 'function') {
      try { face.style.visibility = ''; t = doc.elementFromPoint(e.clientX, e.clientY) || deco; } catch (err) { t = deco; }
      face.style.visibility = 'hidden';
    }
    for (let n = t; n && n !== deco; n = n.parentNode) {
      const t = typeof n.getAttribute === 'function' ? n.getAttribute('data-tip') : null;
      if (t) { if (api.tip) api.tip(n, t); if (api.untip) api.untip(1200); return; }
    }
  });
  // destroy: the face; every bed, controller and audition released (a held note ends, a spring posts its rest) and unhooked
  // from the host (every listener is on the panel's own nodes); (7a) the 808's pads and a held CLEAR released, its
  // listeners off
  return { w: geo.W, h: geo.H, tier, destroy() {
    if (tier) tier.destroy();
    for (const p of perfs.splice(0)) { try { p.destroy(); } catch (err) { console.error(err); } }
    if (DRP) { try { DRP.destroy(); } catch (err) { console.error(err); } }
  } };
}
