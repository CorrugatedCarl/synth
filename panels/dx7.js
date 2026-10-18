// panels/dx7.js — the hardware front panel of the DX7, as layout data for the canvas's fixed-size instrument
// module (docs/canvas/IMPL-panels.md §3 format, §6.3 select-and-set, §10 acceptance). Owner: the AUTHOR lane of this model.
// No imports, no DOM, no logos or maker names; the default export is plain data (a few local helpers build the 32
// membrane buttons and their legends). Units: mm in the research frame of scratchpad/canvas/panels/research/dx7.json
// (fact-checked twice; ±1.5 mm): the 1018 × 172 mm top surface behind the keys — the printed graphics panel (kept whole:
// it carries the live algorithm chart) over the control strip. As on the hardware there are two continuous controls
// (VOLUME, DATA ENTRY); every voice parameter is chosen with a button (and OPERATOR SELECT) and set with DATA ENTRY or
// NO / YES, the LCD saying what is selected. EDIT legends are printed above the buttons in lavender, FUNCTION legends
// below in tan, each group under (or over) its rule.
const LAV = '#b9adec', TAN = '#d59c63', INK = '#ece7df';
const BX = [502, 523, 544.5, 565.5, 586.5, 607.5, 629, 650, 671, 692, 713.5, 734.5, 755.5, 776.5, 798, 819]; // button centres
const bx = n => BX[(n - 1) % 16], by = n => (n <= 16 ? 100 : 134.5);
const T = (x, y, s, size, more) => Object.assign({ t: 'text', x, y, s, size: size || 1.9, anchor: 'middle', weight: 600 }, more || {});
const RULE = (x1, x2, y, stroke) => ({ t: 'line', x1, y1: y, x2, y2: y, stroke: stroke || INK, sw: 0.25 });
const lines = s => s.split('\n').length;
const LH = 1.9 * 1.12;

// buttons 1–32: EDIT legend (above) and group, FUNCTION legend (below) and group (IMPL-panels §6.3; Benson's chart)
const EDIT = {
  1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: 'ALGORITHM', 8: 'FEEDBACK', 9: 'WAVE', 10: 'SPEED', 11: 'DELAY', 12: 'PMD',
  13: 'AMD', 14: 'SYNC', 15: 'PITCH', 16: 'AMPLITUDE', 17: 'MODE\nSYNC', 18: 'FREQUENCY\nCOARSE', 19: 'FREQUENCY\nFINE', 20: 'DETUNE',
  21: 'RATE', 22: 'LEVEL', 23: 'BREAK\nPOINT', 24: 'CURVE', 25: 'DEPTH', 26: 'KEYBOARD\nRATE SCALING', 27: 'OUTPUT\nLEVEL',
  28: 'KEY VELOCITY\nSENSITIVITY', 29: 'RATE', 30: 'LEVEL', 31: 'KEY\nTRANSPOSE', 32: 'VOICE\nNAME',
};
const EGRP = [['OPERATOR ON/OFF · EG COPY', 1, 6], ['LFO', 9, 14], ['MODULATION SENSITIVITY', 15, 16], ['OSCILLATOR', 17, 20], ['EG', 21, 22],
  ['KEYBOARD LEVEL SCALING', 23, 25], ['OPERATOR', 27, 28], ['PITCH EG', 29, 30]];
const RPAE = ['RANGE', 'PITCH', 'AMPLITUDE', 'EG BIAS'];
const FUNC = {
  1: 'MASTER TUNE\nADJ', 2: 'POLY/MONO', 3: 'RANGE', 4: 'STEP', 5: 'MODE', 6: 'GLISSANDO', 7: 'TIME', 9: 'EDIT\nRECALL', 10: 'VOICE\nINIT',
  14: 'BATTERY\nCHECK', 15: 'SAVE', 16: 'LOAD', ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [17 + i, RPAE[i % 4]])),
};
const FGRP = [['PITCH BEND', 3, 4], ['PORTAMENTO', 5, 7], ['CARTRIDGE', 15, 16], ['MODULATION WHEEL', 17, 20], ['FOOT CONTROL', 21, 24],
  ['BREATH CONTROL', 25, 28], ['AFTER TOUCH', 29, 32]];
const grpOf = (G, n) => (G.find(([, a, b]) => n >= a && n <= b) || [''])[0];
// the button's own name (its aria-label stem and "not emulated" tip): its group + its EDIT legend
const nameOf = n => (n <= 6 ? 'OPERATOR ON/OFF ' + n : [grpOf(EGRP, n), EDIT[n].replace('\n', ' ')].filter(Boolean).join(' '));

// legend rows (baselines, mm): above a button the EDIT name's last line sits 6.1 mm over the cap's centre line and the
// group 1.9 mm over its rule; below, the FUNCTION name's first line 8.2 mm under it, then the rule and the group name
const legends = [];
for (let n = 1; n <= 32; n++) {
  const x = bx(n), y = by(n), e = EDIT[n], f = FUNC[n];
  legends.push(T(x, y - 6.6 - (lines(e) - 1) * LH, e, 1.9, { fill: LAV }));
  if (f) legends.push(T(x, y + 8.2, f, 1.9, { fill: TAN }));
}
for (const [g, a, b] of EGRP) { const y = by(a); legends.push(RULE(bx(a) - 9.5, bx(b) + 9.5, y - 11.6, LAV), T((bx(a) + bx(b)) / 2, y - 12.5, g, 1.9, { fill: LAV })); }
for (const [g, a, b] of FGRP) { const y = by(a); legends.push(RULE(bx(a) - 9.5, bx(b) + 9.5, y + 11.4, TAN), T((bx(a) + bx(b)) / 2, y + 13.7, g, 1.9, { fill: TAN })); }

// a plain-line sketch of the EG (rates / levels) and the keyboard level scaling curves for the graphics panel
const EG = 'M840 59L851 30L862 40L878 44.5L885 44.5L895 59';
const KLS = 'M912 21Q926 30 940 40Q954 50 968 59M912 59Q926 50 940 40Q954 30 968 21M912 40H968';

const controls = [
  // the graphics panel: the algorithm chart (live: the current algorithm lit)
  { id: 'dx:chart', kind: 'display', x: 662.75, y: 43, w: 342.5, h: 40.3 },
  // VOLUME · DATA ENTRY (slide pots) · NO / YES
  { id: 'vol', kind: 'slider', x: 96, y: 115.5, len: 37, cap: [14, 8], label: 'VOLUME', labSize: 2.2, hit: [15, 46] },
  { id: 'dx:data', kind: 'slider', x: 147, y: 117, len: 37, cap: [14, 8], label: 'DATA ENTRY', labSize: 2.2, hit: [15, 46] },
  { id: 'dx:no', kind: 'button', x: 177, y: 134.5, w: 19, h: 9.5, color: 'teal', led: 'none', hit: [20, 22], label: 'NO', labSize: 2 },
  { id: 'dx:yes', kind: 'button', x: 198, y: 134.5, w: 19, h: 9.5, color: 'teal', led: 'none', hit: [20, 22], label: 'YES', labSize: 2 },
  // the mode buttons: STORE · MEMORY PROTECT INT / CART (not ours) · OPERATOR SELECT; EDIT/COMPARE · MEMORY SELECT
  // INTERNAL (play: buttons 1–n load our factory sounds) · CARTRIDGE (not ours) · FUNCTION
  { kind: 'button', x: 255, y: 100, w: 19, h: 9.5, color: 'coral', inert: true, label: 'STORE', labSize: 2 },
  { kind: 'button', x: 276.5, y: 100, w: 19, h: 9.5, color: 'teal', inert: true, label: 'INTERNAL', labSize: 2 },
  { kind: 'button', x: 297.5, y: 100, w: 19, h: 9.5, color: 'teal', inert: true, label: 'CARTRIDGE', labSize: 2 },
  { id: 'dx:opsel', kind: 'button', x: 318.5, y: 100, w: 19, h: 9.5, color: 'lavender', led: 'none', hit: [20, 22], label: 'OPERATOR\nSELECT', labSize: 2 },
  { id: 'dx:edit', kind: 'button', x: 255, y: 134.5, w: 19, h: 9.5, color: 'lavender', led: 'none', hit: [20, 22], label: 'EDIT\nCOMPARE', labSize: 2 },
  { id: 'dx:memInt', kind: 'button', x: 276.5, y: 134.5, w: 19, h: 9.5, color: 'teal', led: 'none', hit: [20, 22], label: 'INTERNAL', labSize: 2 },
  { kind: 'button', x: 297.5, y: 134.5, w: 19, h: 9.5, color: 'teal', inert: true, label: 'CARTRIDGE', labSize: 2 },
  { id: 'dx:function', kind: 'button', x: 318.5, y: 134.5, w: 19, h: 9.5, color: 'tan', led: 'none', hit: [20, 22], label: 'FUNCTION', labSize: 2 },
  // the red 2-digit LED (the factory sound's number) and the 16 × 2 LCD
  { id: 'dx:led', kind: 'display', x: 372.5, y: 126.5, w: 21, h: 13 },
  { id: 'dx:lcd', kind: 'display', x: 428.4, y: 127.5, w: 60, h: 14.5 },
  // buttons 1–32 (two rows of 16 teal membrane keys); which are live depends on the mode (§6.3)
  ...Array.from({ length: 32 }, (_, i) => ({ id: 'dx:btn', kind: 'button', n: i + 1, x: bx(i + 1), y: by(i + 1), w: 19, h: 9.5, color: 'teal',
    onCap: String(i + 1), hit: [20, 22], label: nameOf(i + 1), lab: 'none' })),
  // the cartridge slot (not ours)
  { kind: 'slot', x: 912, y: 104.3, w: 55, h: 13.8, inert: true, label: 'CARTRIDGE slot', lab: 'none' },
];

const decor = [
  // the control strip's tones: the bright edge where it meets the graphics panel, the darker front band, the chrome trim
  { t: 'rect', x: 0, y: 78, w: 1018, h: 94, fill: '#342d2a' },
  { t: 'line', x1: 0, y1: 78.1, x2: 1018, y2: 78.1, stroke: '#8f877f', sw: 0.6 },
  { t: 'rect', x: 0, y: 152.5, w: 1018, h: 19.5, fill: '#221d1b' },
  { t: 'line', x1: 0, y1: 171.4, x2: 1018, y2: 171.4, stroke: '#cdc9c2', sw: 0.9 },
  // ---- the graphics panel: the model name in plain type and its descriptor (no wordmark)
  T(119, 63, 'DX7', 26, { anchor: 'start', weight: 700, ls: 5, fill: INK }),
  T(206, 63, 'DIGITAL PROGRAMMABLE ALGORITHM SYNTHESIZER', 2.5, { anchor: 'start', weight: 500, ls: 0.25, fill: INK }),
  // the algorithm chart's ruled box (the chart itself is live), the EG and keyboard level scaling diagrams
  { t: 'rect', x: 491.5, y: 22.8, w: 342.5, h: 40.3, stroke: INK, sw: 0.3 }, RULE(491.5, 834, 44.9),
  T(492, 20.7, 'ALGORITHMS', 2.1, { anchor: 'start', fill: INK }),
  { t: 'rect', x: 834, y: 22.8, w: 67, h: 40.3, stroke: INK, sw: 0.3 }, T(835, 20.7, 'ENVELOPE GENERATOR', 2.1, { anchor: 'start', fill: INK }),
  { t: 'path', d: EG, stroke: INK, sw: 0.35 }, { t: 'path', d: 'M840 59H896M840 27V59', stroke: INK, sw: 0.2 },
  ...[['L1', 30], ['L2', 40], ['L3', 44.5], ['L4', 59]].map(([s, y]) => T(837.6, y + 0.6, s, 1.5, { fill: INK, weight: 500 })),
  ...[['R1', 845.5], ['R2', 856.5], ['R3', 870], ['R4', 890]].map(([s, x]) => T(x, 62, s, 1.5, { fill: INK, weight: 500 })),
  T(862, 27.4, 'KEY ON', 1.5, { fill: INK, weight: 500 }), T(885, 27.4, 'KEY OFF', 1.5, { fill: INK, weight: 500 }),
  { t: 'line', x1: 885, y1: 29, x2: 885, y2: 59, stroke: INK, sw: 0.2, dash: [0.8, 0.8] },
  { t: 'rect', x: 910, y: 17, w: 60, h: 44, stroke: INK, sw: 0.3 }, T(940, 14.8, 'KEYBOARD LEVEL SCALING', 2.1, { fill: INK }),
  { t: 'path', d: KLS, stroke: INK, sw: 0.35 }, { t: 'line', x1: 940, y1: 17, x2: 940, y2: 61, stroke: INK, sw: 0.2, dash: [0.8, 0.8] },
  T(940, 64.6, 'BREAK POINT', 1.7, { fill: INK, weight: 500 }),
  T(925, 66.8, 'LEFT CURVE · DEPTH', 1.5, { fill: INK, weight: 500 }), T(955, 66.8, 'RIGHT CURVE · DEPTH', 1.5, { fill: INK, weight: 500 }),
  ...[['+LIN', 21.6], ['+EXP', 29], ['−EXP', 51.8], ['−LIN', 59]].flatMap(([s, y]) => [T(907.5, y, s, 1.5, { anchor: 'end', fill: INK, weight: 500 }),
    T(972.5, y, s, 1.5, { anchor: 'start', fill: INK, weight: 500 })]),
  // ---- the control strip: the sliders' ladders (MAX / MIN on VOLUME), the DATA ENTRY rule over NO / YES, OFF / ON
  { t: 'ladder', x: 96, y: 115.5, len: 37, n: 11, side: 'r', gap: 8.2, labels: ['MIN', '', '', '', '', '', '', '', '', '', 'MAX'], size: 1.7 },
  { t: 'ladder', x: 147, y: 117, len: 37, n: 11, side: 'r', gap: 8.2 },
  RULE(155.5, 208, 91.5), T(177, 142.8, 'OFF', 2), T(198, 142.8, 'ON', 2),
  // mode-button groups: MEMORY PROTECT over INTERNAL / CARTRIDGE, MEMORY SELECT likewise with its cream PLAY bar
  RULE(267, 307, 88.4), T(287, 87.5, 'MEMORY PROTECT', 1.9, { fill: INK }),
  RULE(267, 307, 122.9), T(287, 122, 'MEMORY SELECT', 1.9, { fill: INK }),
  { t: 'rect', x: 267, y: 141.6, w: 40, h: 3.2, r: 0.3, fill: '#e6dcc2' }, T(287, 143.95, 'PLAY', 2, { fill: '#2c2623', weight: 700 }),
  // the LED / LCD bezel
  { t: 'rect', x: 353.5, y: 114.3, w: 110, h: 26.4, r: 1.2, fill: '#121010', stroke: '#4a433f', sw: 0.3 },
  // the 32 buttons' EDIT / FUNCTION legends and group rules; the cartridge slot's name
  ...legends,
  T(912, 92.6, 'CARTRIDGE', 2, { fill: INK }),
];

export default {
  v: 1,
  id: 'dx7',
  hw: 'DX7 (1983): the graphics panel and control strip behind the keys',
  case: '#1b1715',
  scheme: {
    panel: '#2c2623', legend: INK, rule: '#d8d1c6', accent: '#47c4b0', font: 'sans',
    slider: { cap: '#151515', line: '#e6e6e6', groove: '#050505' },
    button: { cap: '#47c4b0', text: '#f7f3ea', led: '#ff3b2a', ledOff: '#3a1512' },
    switch: { teal: '#47c4b0', coral: '#e8675f', lavender: '#a99cdc', tan: '#c98e5a', cream: '#e6dcc2' },
  },
  areas: [{ id: 'main', src: [0, 0, 1018, 172], at: [0, 0] }],
  sections: [
    { id: 'graphics', label: 'GRAPHICS PANEL', x: 0, y: 0, w: 1018, h: 78, frame: 'none', title: 'none' },
    { id: 'sliders', label: 'VOLUME · DATA ENTRY', x: 77.5, y: 78, w: 133.5, h: 94, frame: 'none', title: 'none' },
    { id: 'modes', label: 'MODE BUTTONS', x: 242, y: 78, w: 91, h: 94, frame: 'none', title: 'none' },
    { id: 'display', label: 'LED · LCD', x: 340.5, y: 78, w: 131.5, h: 94, frame: 'none', title: 'none' },
    { id: 'params', label: 'BUTTONS 1–32', x: 488.5, y: 78, w: 343.5, h: 94, frame: 'none', title: 'none' },
    { id: 'cartridge', label: 'CARTRIDGE', x: 866.5, y: 78, w: 89, h: 94, frame: 'none', title: 'none' },
  ],
  controls,
  decor,
  extras: { ids: ['dac'] },
  notes: [
    'Two continuous controls, as on the hardware: VOLUME (vol) and DATA ENTRY (dx:data, bound to the selected parameter). Buttons 7 ALGORITHM, 8 FEEDBACK, 10 LFO SPEED, 18–22, 26–28 (per operator, OPERATOR SELECT), 31 KEY TRANSPOSE and FUNCTION 17 (MOD WHEEL RANGE → pmd) address the other 89 models.js ids (IMPL-panels §6.3); in MEMORY SELECT INTERNAL buttons 1–n load our factory sounds.',
    'Not emulated in edit mode (dimmed by the renderer per mode): buttons 1–6, 9, 11–17, 23–25, 29, 30, 32 and every FUNCTION but 17. Inert decoration: STORE, MEMORY PROTECT INTERNAL / CARTRIDGE, MEMORY SELECT CARTRIDGE, the cartridge slot.',
    'Graphics panel kept whole (R2 exception): the algorithm chart box spans the 32 buttons below it; the EG and keyboard-level-scaling diagrams are plain-line sketches, not copies.',
    'Cap characters (1–9, 0, A–V, W X Y Z …) are not drawn: a button carries one centred cap text (its number).',
    'Vintage DAC (dac) is the only extra.',
  ],
};
