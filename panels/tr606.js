// panels/tr606.js — the hardware front panel of the TR-606 drum machine, as layout data for the canvas's fixed-size instrument
// module (docs/canvas/IMPL-panels.md §3 format, IMPL-7b.md §7 the panel, §14 Lane P1 the tokens). Owner: lane X.
// Data only: no imports, no DOM, no logos or maker names (the model name only as plain text; the maker-mark and wordmark
// zones of the photograph stay empty). Units: mm of the real box top, 300 × 146 mm (research-606-circuits.md §13, read from a
// top-view photograph at 3.69 px/mm, ± 1.5 mm); the TB-303's form factor and finish: a silver case with two bands of knobs,
// a near-black lower panel with white print, a light strip of sixteen grey step keys with red LEDs. Three bands, as on the
// hardware: the rear-connector legends and the six level knobs; TEMPO · TRACK / INSTRUMENT · MODE · VOLUME; the programming
// section (CLEAR/RESET, RUN/STOP, SCALE, FUNCTION, the scale graphic, the 16 keys with their LAST STEP and BAR numbers,
// PATTERN GROUP, TAP). All art is ours: our note glyphs, our colours.
const KEY = 1.85;                                  // small legends
const INK = '#151515', WHT = '#eeeeea', RED = '#e0461f', HAIR = '#9a9c9b';
const PANEL = '#1a1b1b', ROWC = '#0b0b0b', STRIP = '#d9dad7', LEDC = '#ff2b16';
const r2 = v => Math.round(v * 100) / 100;
const pol = (x, y, r, deg) => [r2(x + Math.sin(deg * Math.PI / 180) * r), r2(y - Math.cos(deg * Math.PI / 180) * r)];
const T = (x, y, s, size, more) => Object.assign({ t: 'text', x, y, s, size: size || 2.2, anchor: 'middle', weight: 700 }, more || {});
const W = (x, y, s, size, more) => T(x, y, s, size, Object.assign({ fill: WHT }, more || {}));       // white on black
const BLK = (x, y, w, h, r) => ({ t: 'rect', x, y, w, h, r: r || 0.5, fill: '#141414' });
const LINE = (x1, y1, x2, y2, stroke, sw) => ({ t: 'line', x1, y1, x2, y2, stroke: stroke || '#3a3a3a', sw: sw || 0.3 });
const BOXL = (x, y, w, h) => ({ t: 'rect', x, y, w, h, r: 0.6, stroke: HAIR, sw: 0.28 });          // a ruled sub-panel (hairline on the dark)
const UP = (x, y) => ({ t: 'path', x, y, d: 'M0 -0.9L1 0.9H-1Z', fill: INK });                       // ▲ rear-connector arrow
const NUM = (x, y, s, w) => [BLK(x - (w || 3.4) / 2, y - 1.7, w || 3.4, 3.4, 0.3), W(x, y + 0.75, s, 2.1)];   // a selector's number box

// the sixteen printed key cells (13.55 mm) and the caps (14 mm apart round the row's centre: the hit rule, notes)
const CELL = n => r2(49.9 + 13.55 * (n - 1)), KX = n => r2(56.6 + 13.55 * (n - 1)), CX = n => r2(53.25 + 14 * (n - 1));
const KNOBS = [['ac', 88.6, 'ACCENT'], ['bdl', 111.4, 'BASS DRUM'], ['sdl', 134.1, 'SNARE DRUM'], ['tml', 157.0, 'L.H.TOM'], ['cyl', 179.9, 'CYMBAL'], ['hhl', 202.4, 'O.C.HIHAT']];
// the two selectors: a chrome ring round a silver cap with a bar grip across it (the TB-303's selector skin)
const SEL = { skirt: '#a9abab', cap: '#7f8181', ptr: '#5b5d5d', capR: 0.18 };
const CAPD = '#c9cbc8', CAPS = '#a7a9a7';                 // key caps: light grey on the dark panel, a darker grey on the light strip
const SCX = 42.5, STOP = [82.1, 86.2, 90.2, 94.9];       // the SCALE switch: its axis and its four stops (4 at the top)
const MODE = { x: 134.0, y: 52.1, d: 22 }, INST = { x: 88.6, y: 52.3, d: 22 };

const controls = [
  // band A: ACCENT and the five level knobs (the tom pair and the hat pair share one each)
  ...KNOBS.map(([id, x, name]) => ({ id, kind: 'knob', x, y: 14.9, d: 17, sweep: 270, label: name, lab: 'none', scale: { n: 11 } })),
  // band B: TEMPO (continuous) · TRACK / INSTRUMENT (8 detents) · MODE (4, off 12 o'clock) · VOLUME
  { id: 'dr:tempo', kind: 'knob', x: 43.2, y: 52, d: 24, sweep: 270, label: 'TEMPO', lab: 'none' },
  { id: 'dr:inst', kind: 'rotary', x: INST.x, y: INST.y, d: INST.d, sweep: 210, legends: ['AC', 'BD', 'SD', 'LT', 'HT', 'CY', 'OH', 'CH'], label: 'TRACK / INSTRUMENT', lab: 'none', skin: SEL },
  // (the bracketed TRACK / PATTERN legends are print: decor)
  { id: 'dr:mode', kind: 'rotary', x: MODE.x, y: MODE.y, d: MODE.d, sweep: 90, rot: 82, legends: ['', '', '', ''], label: 'MODE', lab: 'none', skin: SEL },
  { id: 'vol', kind: 'knob', x: 263.8, y: 52.6, d: 23, sweep: 270, label: 'VOLUME', lab: 'none' },
  // band C, left block: CLEAR/RESET, the RUN lamp, RUN/STOP
  { id: 'dr:clear', kind: 'button', x: 19.7, y: 93, w: 13, h: 5, led: 'none', color: CAPD, label: 'CLEAR/RESET', lab: 'none' },
  { id: 'dr:runLed', kind: 'led', x: 19.5, y: 103.5, d: 3, color: LEDC },
  { id: 'dr:start', kind: 'button', x: 19.2, y: 113.8, w: 17, h: 12, led: 'none', color: CAPD, label: 'RUN/STOP', lab: 'none' },
  // the scale column: the vertical SCALE switch (its stops 4 · 3 · 2 · 1 from the top) and FUNCTION (2.8 mm left of the hardware's x 42)
  { id: 'dr:sc', kind: 'switch', style: 'slide', orient: 'v', x: SCX, y: 88.5, w: 5, h: 16, hit: [14, 16], legends: ['4', '3', '2', '1'], label: 'SCALE', lab: 'none' },
  { id: 'dr:fn', kind: 'button', x: 39.2, y: 113.8, w: 5, h: 12, led: 'none', hit: [14, 15], color: CAPD, label: 'FUNCTION', lab: 'none' },
  // the 16 step keys, each with its LED above
  ...Array.from({ length: 16 }, (_, i) => ({ id: 'dr:step', kind: 'button', n: i + 1, x: CX(i + 1), y: 113.8, w: 5.4, h: 12.2, led: 'above', hit: [14, 15], color: CAPS, label: 'STEP ' + (i + 1), lab: 'none' })),
  // right block: the group lamps I / II, PATTERN GROUP, TAP
  { id: 'dr:grpI', kind: 'led', x: 275.6, y: 84.5, d: 3, color: LEDC },
  { id: 'dr:grpII', kind: 'led', x: 285.8, y: 84.5, d: 3, color: LEDC },
  { id: 'dr:grp', kind: 'button', x: 281.7, y: 92.6, w: 11, h: 5, led: 'none', color: CAPD, label: 'PATTERN GROUP', lab: 'none' },
  { id: 'dr:tap', kind: 'button', x: 281.3, y: 113.8, w: 17.6, h: 12.2, led: 'none', color: CAPD, label: 'TAP', lab: 'none' },
];

const decor = [];

/* ---------------------------------------------------------------- the bands */
// a pressed groove under band A, the raised silver frame of the programming section with its dark panel, the case lip
decor.push(
  LINE(1, 26.9, 299, 26.9, '#8b8d8d', 0.5), LINE(1, 27.5, 299, 27.5, '#e6e7e6', 0.4),
  { t: 'rect', x: 0.8, y: 71.8, w: 298.4, h: 67.6, r: 1.4, fill: '#d3d5d4', stroke: '#8b8d8d', sw: 0.35 },
  { t: 'rect', x: 3.3, y: 75, w: 293.7, h: 62, r: 0.8, fill: PANEL },
  { t: 'rect', x: 0, y: 139.4, w: 300, h: 6.6, fill: '#b6b8b7' }, LINE(0, 139.4, 300, 139.4, '#8b8d8d', 0.35));

/* ---------------------------------------------------------------- band A: the rear legends and the six level knobs */
// each ▲ points at its jack or switch on the rear edge (print only); the maker-mark (x 11–64) and wordmark (x 229–285) zones stay empty
decor.push(LINE(75.3, 1.5, 75.3, 25.4, '#2b2b2b', 0.4), LINE(215.7, 1.5, 215.7, 25.4, '#2b2b2b', 0.4));
for (const [x, s] of [[15.6, 'RUN/STOP'], [58.7, 'SYNC'], [221, 'LT'], [233, 'HT'], [248, 'HEADPHONE'], [267.5, 'OUTPUT'], [283.5, 'DC 9V']]) decor.push(UP(x, 2.9), T(x, 6.9, s, KEY));
decor.push(T(33.2, 6.9, 'INPUT', KEY, { anchor: 'end' }), UP(35, 6.2), T(36.8, 6.9, 'OUTPUT', KEY, { anchor: 'start' }), T(227, 10.6, 'TRIGGER OUT', KEY));
for (const [, x, name] of KNOBS) decor.push(T(x, 3.9, name, 2.05));

/* ---------------------------------------------------------------- band B: TEMPO · TRACK / INSTRUMENT · MODE · model · VOLUME */
decor.push(T(43.2, 30.9, 'TEMPO', 2.6), { t: 'scale', x: 43.2, y: 52, d: 31, sweep: 270, n: 11 },
  T(30.4, 65.2, 'SLOW', KEY, { anchor: 'end' }), T(56, 65.2, 'FAST', KEY, { anchor: 'start' }));
// TRACK / INSTRUMENT: the eight track numbers in black squares round the instrument codes (the knob's legends print the codes)
decor.push(BLK(75.6, 28.1, 9.4, 3.3, 0.3), W(80.3, 30.7, 'TRACK', 2.1), T(86.3, 30.7, 'INSTRUMENT', 2.3, { anchor: 'start' }));
for (let i = 0; i < 8; i++) { const [nx, ny] = pol(INST.x, INST.y, INST.d / 2 + 8.2, -105 + 30 * i); decor.push(...NUM(nx, ny, String(i + 1), 3.2)); }
// MODE: the four detents sit at +37° … +127° (the knob's ticks); to their right TRACK WRITE / PLAY (reversed out) and PATTERN PLAY / WRITE
// in the TB-303's bracketed print
decor.push(T(MODE.x, 30.9, 'MODE', 2.6));
{
  const ys = [0, 1, 2, 3].map(i => pol(MODE.x, MODE.y, MODE.d / 2 + 1.72, 37 + 30 * i)[1]);
  [['WRITE', 1], ['PLAY', 1], ['PLAY', 0], ['WRITE', 0]].forEach(([s, rev], i) => decor.push(...(rev
    ? [BLK(149.0, ys[i] - 1.7, s.length * 1.55 + 1.4, 3.4, 0.3), W(150.0, ys[i] + 0.75, s, 2, { anchor: 'start' })]
    : [T(150.0, ys[i] + 0.75, s, 2, { anchor: 'start', weight: 500 })])));
  const m1 = r2((ys[0] + ys[1]) / 2), m2 = r2((ys[2] + ys[3]) / 2);
  decor.push({ t: 'path', d: `M158.8 ${ys[0]}H160.6V${ys[1]}H158.8M160.6 ${m1}H162.8M158.8 ${ys[2]}H160.6V${ys[3]}H158.8M160.6 ${m2}H162.8`, stroke: INK, sw: 0.3 },
    BLK(162.8, r2(m1 - 1.75), 10.6, 3.5, 0.3), W(168.1, r2(m1 + 0.8), 'TRACK', 2.1), T(163.2, r2(m2 + 0.8), 'PATTERN', 2.1, { anchor: 'start' }));
}
// the model name (plain type, no wordmark) and VOLUME (it carries the power switch)
decor.push(T(211, 51.2, 'TR-606', 6.8, { weight: 500, ls: 0.3 }), LINE(185, 53.8, 237, 53.8, INK, 0.35), T(211, 58.8, 'Computer Controlled', 4.4, { weight: 400 }),
  T(263.8, 30.9, 'VOLUME', 2.6), { t: 'scale', x: 263.8, y: 52.6, d: 27, sweep: 270, n: 11 },
  T(251.6, 67, 'POWER SW OFF', KEY, { anchor: 'end', weight: 600 }), T(276, 67, 'MAX', KEY, { anchor: 'start' }));

/* ---------------------------------------------------------------- band C: the programming section (white print on the dark panel) */
// the ruled sub-panels: CLEAR/RESET · RUN/STOP; FUNCTION; PATTERN GROUP; TAP
decor.push(BOXL(5.9, 76.4, 28.2, 23.2), BOXL(5.9, 100.6, 28.2, 34.8), BOXL(35, 102.4, 14.4, 33), BOXL(268.2, 76.4, 27.8, 23.2), BOXL(268.2, 100.6, 27.8, 34.8));
// left block: D.C. and BAR RESET boxed, PATTERN CLEAR over the CLEAR/RESET key; RUN ● BATTERY over RUN/STOP
decor.push(BOXL(7.2, 79.2, 7.6, 3.6), W(11, 81.9, 'D.C.', 2.0, { weight: 600 }), BOXL(15.4, 79.2, 17.2, 3.6), W(24, 81.9, 'BAR RESET', 1.9, { weight: 500 }),
  W(19.7, 88, 'PATTERN CLEAR', 2.1, { weight: 500 }),
  W(17.7, 104.5, 'RUN', KEY, { anchor: 'end', weight: 500 }), W(21.5, 104.5, 'BATTERY', KEY, { anchor: 'start', weight: 500 }),
  W(19.2, 125.6, 'RUN/STOP', 2.1, { weight: 500 }));
// the scale column: the four stops' numbers, slanted leaders from each stop to its row of the graphic, SCALE and FUNCTION
{
  const rows = [[75.3, 82.4], [83.2, 89.2], [90.0, 94.6], [95.4, 99.7]];     // scale 4 · 3 · 2 · 1 from the top
  const lead = STOP.map((y, i) => { const ry = r2((rows[i][0] + rows[i][1]) / 2); return `M${SCX + 2.6} ${y}H${SCX + 4.2}L49.3 ${ry}`; }).join('');
  decor.push({ t: 'path', d: lead, stroke: '#cfd0ce', sw: 0.24 }, ...STOP.map((y, i) => W(37.6, r2(y + 0.7), String(4 - i), 2)),
    W(SCX, 100, 'SCALE', 2.2, { weight: 500 }), W(SCX, 106, 'FUNCTION', 2.0, { weight: 500 }));
  // the scale graphic: four black rows split by white hairlines — our glyphs: beamed notes under a slur in threes (scale 3) and sixes
  // (scale 4); a quarter note over each group of eight (scale 2) and four (scale 1)
  const G = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i), X = n => KX(n);
  const head = (x, y) => `M${r2(x - 0.85)} ${y}a0.85 0.6 0 1 0 1.7 0a0.85 0.6 0 1 0 -1.7 0Z`, stem = (x, y, h) => `M${r2(x + 0.55)} ${r2(y - 0.2)}V${r2(y - h)}h0.32V${r2(y - 0.2)}Z`;
  const beam = (xa, xb, y) => `M${r2(xa + 0.55)} ${y}H${r2(xb + 0.87)}v0.45H${r2(xa + 0.55)}Z`;
  const dot = (x, y) => `M${r2(x - 0.32)} ${y}a0.32 0.32 0 1 0 0.64 0a0.32 0.32 0 1 0 -0.64 0Z`;
  const beamed = (groups, yh, stemH, ybeam, nb, yslur) => groups.map(([a, b]) => {
    let d = G(a, b).map(n => head(X(n), yh) + stem(X(n), yh, stemH)).join('');
    if (b > a) { for (let k = 0; k < nb; k++) d += beam(X(a), X(b), r2(ybeam + 0.75 * k)); }
    return d;
  }).join('');
  const slurs = (groups, y, up) => groups.filter(([a, b]) => b > a).map(([a, b]) => `M${r2(X(a) - 0.6)} ${y}Q${r2((X(a) + X(b)) / 2)} ${r2(y - up)} ${r2(X(b) + 1.3)} ${y}`).join('');
  const q = (every, y, hs) => Array.from({ length: 16 }, (_, i) => i + 1).map(n => ((n - 1) % every === 0 ? head(X(n), y) + stem(X(n), y, hs) : dot(X(n), y - 1.1))).join('');
  const g6 = [[1, 6], [7, 12], [13, 16]], g3 = [[1, 3], [4, 6], [7, 9], [10, 12], [13, 15], [16, 16]];
  decor.push(...rows.map(([a, b]) => ({ t: 'rect', x: 49.9, y: a, w: 216.8, h: r2(b - a), fill: ROWC })),
    LINE(49.9, 82.8, 266.7, 82.8, '#e8e8e6', 0.22), LINE(49.9, 89.6, 266.7, 89.6, '#e8e8e6', 0.22), LINE(49.9, 95, 266.7, 95, '#e8e8e6', 0.22),
    { t: 'path', d: beamed(g6, 81.4, 3, 78.5, 2), fill: WHT }, { t: 'path', d: slurs(g6, 77.7, 2.2), stroke: WHT, sw: 0.22 },
    { t: 'path', d: beamed(g3, 88.3, 2.7, 85.7, 1), fill: WHT }, { t: 'path', d: slurs(g3, 85.0, 1.8), stroke: WHT, sw: 0.22 },
    { t: 'path', d: q(8, 93.5, 2.8), fill: WHT }, { t: 'path', d: q(4, 98.7, 2.8), fill: WHT });
}
// the light key strip under the graphic: sixteen printed cells (the caps stand on them, 14 mm apart: a few tenths off-centre at the ends)
decor.push({ t: 'rect', x: 49.9, y: 100.3, w: 216.8, h: 22.2, fill: STRIP, stroke: '#2e2e2e', sw: 0.3 },
  ...Array.from({ length: 15 }, (_, i) => LINE(CELL(i + 2), 100.5, CELL(i + 2), 122.3, '#a8aaa8', 0.25)));
// LAST STEP (an outline arrow and 1–16 in orange-red on black) and BAR (1–9, 0, 100, 200, two slashes, DEL, INS in white boxes) under the cells
decor.push({ t: 'rect', x: 49.9, y: 122.8, w: 216.8, h: 5.4, fill: ROWC }, { t: 'path', d: 'M50.8 125.5H53.3M52.2 124.4L53.3 125.5L52.2 126.6', stroke: RED, sw: 0.3 });
for (let n = 1; n <= 16; n++) decor.push(T(KX(n), 126.55, String(n), 2.4, { fill: RED }));
['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '100', '200', '/', '/', 'DEL', 'INS'].forEach((s, i) => {
  const w = s.length > 2 ? 8 : 5;
  decor.push({ t: 'rect', x: r2(KX(i + 1) - w / 2), y: 128.8, w, h: 5.2, r: 1.2, fill: ROWC, stroke: HAIR, sw: 0.2 }, W(KX(i + 1), 132.3, s, 2.1, { weight: 600 }));
});
decor.push(W(35.9, 126.6, 'LAST STEP', 1.9, { anchor: 'start', weight: 500 }), W(35.9, 132.4, 'BAR', 1.9, { anchor: 'start', weight: 500 }));
// right block: the segno sign boxed, the group lamps I / II, PATTERN GROUP; D.S. boxed over TAP, WRITE/NEXT boxed, TAP, STEP RESET
decor.push(BOXL(278.4, 77.4, 5, 3.8), { t: 'path', x: 280.9, y: 79.3, d: 'M0.75 -1.2C0.1 -1.65 -0.95 -1.3 -0.75 -0.55S0.95 0.35 0.75 1.05S-0.25 1.65 -0.85 1.15M-1.15 1.4L1.15 -1.4', stroke: WHT, sw: 0.22 },
  W(272.6, 85.3, 'I', 2.1), W(289.8, 85.3, 'II', 2.1), W(281.7, 88.7, 'PATTERN GROUP', 2.0, { weight: 500 }),
  BOXL(277.4, 101.7, 7, 3.4), W(280.9, 104.3, 'D.S.', 2, { weight: 600 }),
  BOXL(271.8, 121.2, 19, 3.6), W(281.3, 123.9, 'WRITE/NEXT', 2, { weight: 500 }), W(281.3, 128.6, 'TAP', 2.2, { weight: 600 }), W(281.3, 132.2, 'STEP RESET', 1.9, { weight: 500 }));

export default {
  v: 1,
  id: 'tr606',
  hw: 'TR-606 (1981): the whole top face',
  case: '#1b1c1c',
  scheme: {
    panel: '#c6c8c7', legend: INK, rule: '#2b2b2b', accent: RED, font: 'rounded',
    knob: { skirt: '#3a3c3d', cap: '#d3d5d5', ptr: '#262626', ptrStyle: 'line', knurl: true, capR: 0.7 },
    button: { cap: CAPD, led: LEDC, ledOff: '#55170f', text: INK },
  },
  areas: [{ id: 'main', src: [0, 0, 300, 146], at: [0, 0], r: 2 }],
  sections: [
    { id: 'levels', label: 'REAR LEGENDS · LEVEL KNOBS', x: 0, y: 0, w: 300, h: 27.6, frame: 'none', title: 'none' },
    { id: 'mid', label: 'TEMPO · TRACK / INSTRUMENT · MODE · VOLUME', x: 0, y: 27.6, w: 300, h: 44.2, frame: 'none', title: 'none' },
    { id: 'run', label: 'CLEAR/RESET · RUN/STOP', x: 0, y: 71.8, w: 35, h: 74.2, frame: 'none', title: 'none' },
    { id: 'scale', label: 'SCALE · FUNCTION', x: 35, y: 71.8, w: 14.9, h: 74.2, frame: 'none', title: 'none' },
    { id: 'keys', label: 'STEP KEYS 1–16', x: 49.9, y: 71.8, w: 217.1, h: 74.2, frame: 'none', title: 'none' },
    { id: 'group', label: 'PATTERN GROUP · TAP', x: 267, y: 71.8, w: 33, h: 74.2, frame: 'none', title: 'none' },
  ],
  controls,
  decor,
  extras: { ids: ['dr:grid', 'dr:pads', 'dr:sync', 'dr:swing', 'bdu', 'bdd', 'sdu', 'sdd', 'ltu', 'ltd', 'htu', 'htd', 'cyd', 'ohd', 'chd', 'dr:toRoll', 'dr:rec', 'dr:map', 'dr:sounds', 'dr:demo', 'dr:link'] },
  notes: [
    'Source: research-606-circuits.md §13 (a top-view photograph of a TR-606 at 3.69 px / mm, ± 1.5 mm; the 300 × 146 mm box, the case lip to 145.5 mm). Measured: the six level knobs at y 14.9 on a 22.8 mm pitch (ACCENT 88.6 … O.C.HIHAT 202.4), TEMPO (43.2, 52.0), TRACK / INSTRUMENT (88.6, 52.3), MODE (134.0, 52.1: its four detents at +37° … +127°), VOLUME (263.8, 52.6), the dark programming panel (y 75–137 inside the silver frame y 71.8–139), CLEAR/RESET (19.7, 93), RUN lamp (19.5, 103.5), RUN/STOP (19.2, 113.8), the SCALE switch at x 42.5 (stops 4 y 82.1, 3 y 86.2, 2 y 90.2, 1 y 94.9), the printed key cells (13.55 mm from x 49.9; strip y 100.3–122.5), the LAST STEP (y 122.8–128.2) and BAR (128.5–134.4) bands, the segno box (280.9, 79.3), the group lamps (275.6 / 285.8, 84.5), PATTERN GROUP (281.7, 92.6), D.S. (280.9, 103.4), TAP (281.3, 113.8).',
    'Hit-rule nudges (§7.1: every live hit box ≥ 14 mm and disjoint): the 16 step caps stand 14 mm apart round the row\'s centre (x 53.25 + 14 (k − 1); the hardware\'s 13.55 mm pitch puts them 56.6 + 13.55 (k − 1): ≤ 3.4 mm at the ends, k 1 −3.35 and k 16 +3.4, 0.2 at the middle), still inside their printed cells (13.55 mm; the strip, the LAST STEP and BAR numbers keep the hardware\'s cells); FUNCTION is 2.8 mm left of the hardware\'s x 42 (x 39.2, hit 14 × 15) so its hit box clears key 1\'s; SCALE has hit 14 × 16 (its axis is the hardware\'s x 42.5, y 88.5 = the stops\' centre). Every other control sits where it was measured.',
    'The two rotaries: MODE\'s detents are the knob\'s own ticks (sweep 90°, rot 82°: +37°, +67°, +97°, +127°) with the bracketed TRACK WRITE / PLAY · PATTERN PLAY / WRITE print in the decor to their right (the TB-303\'s MODE print: TRACK and its two labels reversed out); TRACK / INSTRUMENT\'s eight detents (−105° … +105°, 30° apart) carry the codes AC BD SD LT HT CY OH CH as legends and the track numbers 1–8 in black squares as decor. SCALE\'s numbers 4 · 3 · 2 · 1 and its leaders to the graphic are decor (a switch\'s legends are not printed).',
    'Print and glyphs are ours: the scale graphic\'s four rows (beamed notes under slurs in threes and sixes, a quarter note over each four and eight keys) are drawn as paths, no font glyphs; the model name is plain type "TR-606 · Computer Controlled" in the free centre of band B (the photograph\'s maker-mark and wordmark zones stay empty); the rear-connector legends (RUN/STOP, INPUT ▲ OUTPUT, SYNC, TRIGGER OUT LT / HT, HEADPHONE, OUTPUT, DC 9V) are print only (§3, D3: one output, the mix) — no inert jacks, no dimmed controls.',
    'Estimated: the key and button cap colours (light grey on the dark panel, a darker grey on the light key strip: the photographs run from light grey to greige), the LED glow, the case lip\'s tone, the TEMPO tick ring\'s radius (the photograph: Ø ≈ 34 mm, skirt Ø ≈ 24) and the exact y of the TRACK / INSTRUMENT numbers (outside the legends: the black squares of the photograph sit at r ≈ 14).',
    'Sections: the two upper bands, then the programming section in four (CLEAR/RESET · RUN/STOP, SCALE · FUNCTION, the 16 keys, PATTERN GROUP · TAP) so the Tab order reads left to right, top to bottom. Face 300 × 146 mm → a 608 px module (the 600 px face centred, ceil32), 608 × 864 with the 524 px extras strip.',
  ],
};
