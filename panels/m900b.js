// panels/m900b.js — the System 35 / 55 faces (IMPL-9b §2, §4.1–§4.2; owner: lane P9b), as layout data for cv-panel in the
// house treatment of panels/m900.js (black panels inset 1 mm from a silver frame, cream legends, the title at the top and the
// number in plain type at the foot, knurled knobs with silver caps, screws). Data only: no imports, no DOM, no logos or maker
// names; the small builders below make the repeated parts (the 960's nine stages, the 961's jack blocks) — what they return
// is plain data. MODULES = { <type>: layout } for the sixteen 9b types (keyed by moog-core TYPES[t].layout = the type id,
// each layout's id 'pm-<type>': cv-panel moduleModel's); panels/index.js merges it into MODULE_LAYOUTS. No default export:
// tests/moog-core.test.mjs reads every exported object for faces.
// No photograph was fetched or viewed: every face is ours, laid out from the research's control and jack lists and the MU
// widths (docs/canvas/research-moog-modules.md §3, IMPL-9b §2.2–§2.5); the stand-ins (CP2, CP4A, CP35) and our Song clock
// say so on their plates. Units: mm of a panel in its own frame. 1 MU = 53.975 mm; a 5U face is 222.25 mm tall, a console
// panel 142.875 mm. Sizes (cv-panel sizeOf, the 40 px bar included) = moog-core TYPES[t].w / h: 1 MU 128 × 512, 4 MU 448 ×
// 512, 8 MU 864 × 512; console 2 / 3 / 4 MU 224 / 352 / 448 × 352.
// Live parts: knobs, rotaries and bat switches (params); lit push switches for the routing panels' Off / On switches (a
// `button` with cycle [0, 1]: its lamp shows the value — IMPL-9b §1.4, never a cord); event buttons `{ kind: 'button', ev }`
// (the 960's OSC ON / OFF, SHIFT, SET 1–9; the 962's SET 1–3: nothing stored, IMPL-9b §1.5) and live lamps `{ kind: 'lamp',
// lamp }` (IMPL-9b §1.6) drawn in the art; patch jacks as stage 9's (centres ≥ 15 mm apart, ≥ 9 mm from every hit box); the
// rear terminals (992 / CP3A `xr`, CP4A `tr` / `cr`, CP2 `kpr` / `ksr`) never placed. Trunks and the CP8A's parts: drawn,
// dimmed, "not emulated" (inert). Every face is `lite` (cv-panel: the knobs' skirts and caps are art — the 960's 40 controls
// and the 914's 14 knobs within IMPL-9b §4.2's DOM budget).

const MU = 53.975, H5 = 222.25, HC = 142.875;
// the shared skin (panels/m900.js's) + the push caps: a cream cap, an amber lamp
const SCHEME = {
  panel: '#121212',
  legend: '#ece9df',
  rule: '#ece9df',
  accent: '#d9d2bf',
  font: 'sans',
  knob: { skirt: '#101010', cap: '#c9c9c4', ptr: '#f4f2ea', ptrStyle: 'line', knurl: true, capR: 0.56 },
  jack: { nut: '#d4d4cf', hole: '#080808' },
  button: { cap: '#e4dfd2', led: '#ffb43c', ledOff: '#3a2a14', text: '#1a1a1a' },
};
const FRAME = '#a3a39e', PANEL = '#121212', BAT = '#d2d2ce', CAP = '#e4dfd2', GREEN = '#9cc497', LAMP = '#f0642c';
const D10S = ['0', '', '', '', '', '5', '', '', '', '', '10'], ENDS = ['0', '', '', '', '', '', '', '', '', '', '10'];
const DV6 = ['-6', '', '-4', '', '-2', '', '0', '', '2', '', '4', '', '6'];
const HZ = ['10', '', '', '', '100', '', '', '', '1K', '', '', '', '10K'];
const C1 = 26.99; // a 1 MU face's centre line

/* ---------------------------------------------------------------- builders (plain data out) */
const KN = (id, x, y, d, label, o) => Object.assign({ id, kind: 'knob', x, y, d, sweep: 300, label, lab: 'none' }, o);
const ROT = (id, x, y, d, sweep, legends, label) => ({ id, kind: 'rotary', x, y, d, sweep, label, lab: 'none', legends });
const BH = (id, x, y, label, w) => ({ id, kind: 'switch', style: 'bat', orient: 'h', x, y, w: w || 10, h: 6, color: BAT, label, lab: 'none' });
const BV = (id, x, y, label) => ({ id, kind: 'switch', style: 'bat', orient: 'v', x, y, w: 6, h: 14, color: BAT, label, lab: 'none' });
const LIT = (id, x, y, label, color) => ({ id, kind: 'button', x, y, w: 11, h: 8, cycle: [0, 1], led: 'cap', color: color || CAP, label, lab: 'none' });
const EVB = (ev, x, y, label, cap) => ({ kind: 'button', ev, x, y, w: 10, h: 7, color: CAP, label, lab: 'none', onCap: cap });
const LMP = (lamp, x, y, label) => ({ kind: 'lamp', lamp, x, y, d: 6, color: LAMP, label, lab: 'none' });
const JK = (port, x, y, label) => ({ kind: 'jack', port, x, y, d: 14, label, lab: 'none' });
const SK = (port, x, y, label) => ({ kind: 'strig', port, x, y, w: 10, h: 8, label, lab: 'none' });
const TRUNK = (n, x, y) => ({ kind: 'jack', x, y, d: 14, inert: true, label: 'TRUNK ' + n, lab: 'none' });
const TX = (x, y, s, size, weight, o) => Object.assign({ t: 'text', x, y, s, size: size || 1.85, weight: weight || 600, anchor: 'middle', ls: 0.12 }, o);
const TS = (x, y, s, size) => TX(x, y, s, size || 1.4, 600, { anchor: 'start', ls: 0.08 });
const TE = (x, y, s, size) => TX(x, y, s, size || 1.4, 600, { anchor: 'end', ls: 0.08 });
const HEAD = (x, y, s, size) => TX(x, y, s, size || 2.45, 700, { ls: 0.2 });
const RULE = (y, x1, x2) => ({ t: 'line', x1, y1: y, x2, y2: y, sw: 0.35 });
const VRULE = (x, y1, y2) => ({ t: 'line', x1: x, y1, x2: x, y2, sw: 0.35 });
const DIAL = (x, y, d, labels, size) => ({ t: 'scale', x, y, d, sweep: 300, n: labels.length, labels, size: size || 1.6 });
const NUM = (x, y, s) => TX(x, y, s, 4, 700, { ls: 0.3 });
const SEC = (id, label, x, w, h) => ({ id, label, x, y: 0, w, h, frame: 'none', title: 'none' });
// a face: the silver frame, the black panel inset 1 mm, its screws (one top and one bottom on 1 MU, four corners wider), lite
function face(type, hw, w, h, sections, controls, decor, notes) {
  const sc = w < 60 ? [[C1, 4.6], [C1, h - 4.6]] : [[9, 4.6], [9, h - 4.6], [w - 9, 4.6], [w - 9, h - 4.6]];
  return {
    v: 1, id: 'pm-' + type, hw, case: PANEL, scheme: SCHEME, lite: true,
    areas: [{ id: 'main', src: [0, 0, w, h], at: [0, 0], fill: FRAME }],
    sections, controls,
    decor: [{ t: 'rect', x: 1, y: 0.4, w: Math.round((w - 2) * 1000) / 1000, h: Math.round((h - 0.8) * 1000) / 1000, fill: PANEL }, { t: 'screws', pts: sc, d: 3.4 }, ...decor],
    extras: { ids: [] }, notes,
  };
}
const OURS = 'Ours (no photograph viewed): ';

/* ---------------------------------------------------------------- 904B high pass filter (1 MU): the 904A face's order */
const m904b = face('904b', 'the 904B voltage-controlled high pass filter (1 MU): ours, in the 904A face\'s order', MU, H5,
  [SEC('vcf', '904B HIGH PASS FILTER', 0, MU, H5)],
  [KN('fc', C1, 50, 30, 'FIXED CONTROL VOLTAGE', { skin: { capR: 0.78 } }), BH('rg', C1, 92, 'FREQUENCY RANGE'),
    JK('in', 14, 140, 'SIGNAL INPUT'), JK('out', 40, 140, 'SIGNAL OUTPUT'), JK('c1', 14, 172, 'CONTROL INPUT 1'), JK('c2', 40, 172, 'CONTROL INPUT 2'),
    JK('c3', C1, 194, 'CONTROL INPUT 3')],
  [HEAD(C1, 14.35, 'VOLTAGE CONTROLLED', 2.05), HEAD(C1, 17.25, 'HIGH PASS FILTER', 2.05), NUM(C1, 213.4, '904B'), RULE(21.6, 2.6, 51.375),
    DIAL(C1, 50, 29, DV6, 2.1), TX(C1, 29.37, 'FIXED CONTROL VOLTAGE', 2.1), RULE(73.4, 2.6, 51.375),
    TX(C1, 81.6, 'FREQUENCY RANGE', 1.75), TX(C1 - 10.8, 92.6, 'LOW', 1.65), TX(C1 + 10.8, 92.6, 'HIGH', 1.65), TX(C1, 104.6, 'HIGH = LOW + 1½ OCT.', 1.4),
    RULE(120.4, 2.6, 51.375), TX(14, 131.6, 'SIGNAL INPUT', 1.75, 600, { ls: 0.1 }), TX(40, 131.6, 'SIGNAL OUTPUT', 1.75, 600, { ls: 0.1 }),
    RULE(155.4, 2.6, 51.375), TX(C1, 163.6, 'CONTROL INPUTS')],
  [OURS + 'the 904A face\'s order (FIXED CONTROL VOLTAGE on top, then FREQUENCY RANGE — a LOW / HIGH bat switch: no regeneration —, SIGNAL INPUT / OUTPUT, the three summed CONTROL INPUTS two over one), the research\'s lists in the house style.'],
);

/* ---------------------------------------------------------------- 911A dual trigger delay (1 MU) */
const m911a = face('911a', 'the 911A dual trigger delay (1 MU): ours', MU, H5,
  [SEC('dly', '911A DUAL TRIGGER DELAY', 0, MU, H5)],
  [KN('d1', C1, 46, 24, 'DELAY 1'), KN('d2', C1, 88, 24, 'DELAY 2'), BV('md', 18, 126, 'MODE'),
    SK('i1', 14, 160, 'INPUT 1'), SK('o1', 40, 160, 'OUTPUT 1'), SK('i2', 14, 188, 'INPUT 2'), SK('o2', 40, 188, 'OUTPUT 2')],
  [HEAD(C1, 14.35, 'DUAL TRIGGER', 2.05), HEAD(C1, 17.25, 'DELAY', 2.05), NUM(C1, 213.4, '911A'), RULE(21.6, 2.6, 51.375),
    TX(C1, 27.4, 'DELAY 1', 2.1), DIAL(C1, 46, 23, D10S, 1.75), TX(C1, 69.4, 'DELAY 2', 2.1), DIAL(C1, 88, 23, D10S, 1.75),
    RULE(107.4, 2.6, 51.375), TX(18, 115.4, 'MODE', 1.85), TS(23.6, 121.9, 'OFF', 1.45), TS(23.6, 126.55, 'PARALLEL', 1.45), TS(23.6, 131.2, 'SERIES', 1.45),
    RULE(140.4, 2.6, 51.375), TX(14, 151.4, 'IN 1', 1.6), TX(40, 151.4, 'OUT 1', 1.6), { t: 'glyph', g: 'arrow:right', x: C1, y: 160, size: 4 },
    TX(14, 179.4, 'IN 2', 1.6), TX(40, 179.4, 'OUT 2', 1.6), { t: 'glyph', g: 'arrow:right', x: C1, y: 188, size: 4 }],
  [OURS + 'DELAY 1 and DELAY 2 (0…10 dials: 2 ms … 2 s on the knob\'s readout), MODE OFF / PARALLEL / SERIES (a vertical bat switch), and the two S-trigger IN → OUT pairs as sockets, in the house style.'],
);

/* ---------------------------------------------------------------- 903A random signal (1 MU): no control */
const m903a = face('903a', 'the 903A random signal generator (1 MU): ours', MU, H5,
  [SEC('noise', '903A RANDOM SIGNAL', 0, MU, H5)],
  [JK('wh1', 14, 62, 'WHITE 1'), JK('wh2', 40, 62, 'WHITE 2'), JK('pk1', 14, 126, 'PINK 1'), JK('pk2', 40, 126, 'PINK 2')],
  [HEAD(C1, 14.35, 'RANDOM', 2.05), HEAD(C1, 17.25, 'SIGNAL', 2.05), NUM(C1, 213.4, '903A'), RULE(21.6, 2.6, 51.375),
    { t: 'glyph', g: 'wave:noise', x: C1, y: 34, size: 9, sw: 0.3 }, TX(C1, 50.6, 'WHITE', 2.1), RULE(62, 21, 33),
    RULE(94.4, 2.6, 51.375), { t: 'glyph', g: 'wave:noise', x: C1, y: 104, size: 5, sw: 0.4 }, TX(C1, 114.6, 'PINK', 2.1), RULE(126, 21, 33),
    RULE(150.4, 2.6, 51.375), TX(C1, 158.6, 'TWO JACKS EACH', 1.45)],
  [OURS + 'WHITE and PINK, two jacks each (one source each), joined by a line as the 923\'s WHITE; no control.'],
);

/* ---------------------------------------------------------------- 962 sequential switch (1 MU): three stages, SET buttons, lamps */
const Y962 = k => 37 + 42 * (k - 1); // stage k's top row
const m962 = face('962', 'the 962 sequential switch (1 MU): ours', MU, H5,
  [SEC('sw', '962 SEQUENTIAL SWITCH', 0, MU, H5)],
  [1, 2, 3].flatMap(k => [JK('i' + k, 10, Y962(k), 'SIGNAL INPUT ' + k), LMP('l' + k, C1, Y962(k), 'STAGE ' + k), JK('t' + k, 44, Y962(k), 'TRIGGER IN ' + k),
    EVB('e' + k, C1, Y962(k) + 18, 'SET ' + k, 'SET'), JK('o' + k, 44, Y962(k) + 18, 'TRIGGER OUT ' + k)])
    .concat([JK('q1', 14, 172, 'OUTPUT 1'), JK('q2', 40, 172, 'OUTPUT 2'), JK('sh', C1, 196, 'SHIFT')]),
  [HEAD(C1, 14.35, 'SEQUENTIAL', 2.05), HEAD(C1, 17.25, 'SWITCH', 2.05), NUM(C1, 213.4, '962'), RULE(21.6, 2.6, 51.375),
    ...[1, 2, 3].flatMap(k => [TX(10, Y962(k) - 9, 'IN ' + k, 1.5), TX(44, Y962(k) - 9, 'TRIG IN', 1.4), TX(44, Y962(k) + 9.6, 'TRIG OUT', 1.4),
      TX(10, Y962(k) + 19.1, String(k), 3.2, 700), RULE(Y962(k) + 29.5, 2.6, 51.375)]),
    TX(C1, 162.6, 'OUTPUT', 1.6), RULE(172, 21, 33), TX(C1, 186.4, 'SHIFT', 1.6)],
  [OURS + 'three stages top to bottom — each a SIGNAL INPUT, its lamp, TRIGGER IN, a SET button and TRIGGER OUT —, then the OUTPUT (two jacks, one signal) and SHIFT, in the house style. A plug in INPUT 3 makes the cycle three steps.'],
);

/* ---------------------------------------------------------------- 994 dual multiples (1 MU) */
const m994 = face('994', 'the 994 dual multiples (1 MU): ours', MU, H5,
  [SEC('multA', 'MULTIPLE A', 0, MU, 100), Object.assign(SEC('multB', 'MULTIPLE B', 0, MU, H5 - 100), { y: 100 })],
  [JK('a1', 14, 44, 'MULTIPLE A 1'), JK('a2', 40, 44, 'MULTIPLE A 2'), JK('a3', 14, 72, 'MULTIPLE A 3'), JK('a4', 40, 72, 'MULTIPLE A 4'),
    JK('b1', 14, 136, 'MULTIPLE B 1'), JK('b2', 40, 136, 'MULTIPLE B 2'), JK('b3', 14, 164, 'MULTIPLE B 3'), JK('b4', 40, 164, 'MULTIPLE B 4')],
  [HEAD(C1, 14.35, 'DUAL', 2.05), HEAD(C1, 17.25, 'MULTIPLES', 2.05), NUM(C1, 213.4, '994'), RULE(21.6, 2.6, 51.375),
    TX(C1, 31.4, 'A', 2.6, 700), { t: 'path', d: 'M14 44H40V72H14Z', sw: 0.5 }, RULE(100, 2.6, 51.375),
    TX(C1, 123.4, 'B', 2.6, 700), { t: 'path', d: 'M14 136H40V164H14Z', sw: 0.5 }],
  [OURS + 'two groups of four jacks, A over B, each group joined by a line (a passive multiple: tips and sleeves common).'],
);

/* ---------------------------------------------------------------- 992 control voltages (1 MU): four lit routing switches */
const m992 = face('992', 'the 992 control voltages (1 MU): ours — four lit routing switches to the 904B and an inverting attenuator', MU, H5,
  [SEC('cv', '992 CONTROL VOLTAGES', 0, MU, H5)],
  [LIT('s1', 38, 40, 'KEYBOARD'), LIT('s2', 38, 60, 'WHEEL'), LIT('s3', 38, 80, 'PRESSURE'), LIT('s4', 38, 100, 'EXT'),
    KN('at', C1, 138, 22, 'EXT ATTENUATOR'), JK('x4', C1, 186, 'EXT IN')],
  [HEAD(C1, 14.35, 'CONTROL', 2.05), HEAD(C1, 17.25, 'VOLTAGES', 2.05), NUM(C1, 213.4, '992'), RULE(21.6, 2.6, 51.375),
    TX(C1, 27.4, 'TO THE 904B', 1.4), TE(30.4, 40.6, 'KEYBOARD', 1.6), TE(30.4, 60.6, 'WHEEL', 1.6), TE(30.4, 80.6, 'PRESSURE', 1.6), TE(30.4, 100.6, 'EXT', 1.6),
    RULE(113, 2.6, 51.375), TX(C1, 120.4, 'EXT ATTENUATOR', 1.6), DIAL(C1, 138, 21, ['-10', '', '', '', '', '0', '', '', '', '', '+10'], 1.6),
    TX(C1, 177.4, 'EXT IN', 1.75)],
  [OURS + 'KEYBOARD, WHEEL, PRESSURE and EXT as lit push switches (lit = routed behind the panel to the 904B, no cord), then EXT ATTENUATOR (−10…+10: below 0 it inverts) over EXT IN. The rear terminal is not drawn.'],
);

/* ---------------------------------------------------------------- 993 trigger and envelope voltages (1 MU): eight lit switches */
const m993 = face('993', 'the 993 trigger and envelope voltages (1 MU): ours — eight lit routing switches, no jack', MU, H5,
  [SEC('rt', '993 TRIGGER AND ENVELOPE VOLTAGES', 0, MU, H5)],
  [LIT('f1', 14, 42, 'FROM 1'), LIT('f2', 40, 42, 'FROM 2'),
    ...[1, 2, 3].flatMap(k => [LIT('t' + k, 14, 56 + 30 * k, 'TRIGGER ' + k), LIT('e' + k, 40, 56 + 30 * k, 'ENVELOPE ' + k, GREEN)])],
  [HEAD(C1, 14.35, 'TRIGGER AND', 2.05), HEAD(C1, 17.25, 'ENVELOPE VOLTAGES', 1.9), NUM(C1, 213.4, '993'), RULE(21.6, 2.6, 51.375),
    TX(14, 34.6, 'FROM 1', 1.45), TX(40, 34.6, 'FROM 2', 1.45), TX(C1, 55.4, 'TO THE 911A', 1.3), RULE(62, 2.6, 51.375),
    TX(14, 72.6, 'TRIG.', 1.6, 700), TX(40, 72.6, 'ENV.', 1.6, 700), ...[1, 2, 3].map(k => TX(C1, 56.85 + 30 * k, String(k), 2.4, 700)),
    RULE(160, 2.6, 51.375), TX(C1, 167.4, 'TRIGGERS TO THE 911S', 1.3), TX(C1, 170.4, 'ENVELOPES TO THE 902S', 1.3)],
  [OURS + 'FROM 1 / FROM 2 (the controller\'s triggers into the 911A), then three rows: TRIGGER k (cream) and ENVELOPE k (green), the left, centre and right 911 by number — lit push switches, routed behind the panel (no jack, no cord).'],
);

/* ---------------------------------------------------------------- 914 fixed filter bank (4 MU): fourteen knobs, two in, two out */
const BX914 = i => Math.round((17.95 + 30 * i) * 100) / 100;
const B914 = [['lo', 'LOW'], ['b1', '125'], ['b2', '175'], ['b3', '250'], ['b4', '350'], ['b5', '500'], ['b6', '700'],
  ['b7', '1K'], ['b8', '1.4K'], ['b9', '2K'], ['b10', '2.8K'], ['b11', '4K'], ['b12', '5.6K'], ['hi', 'HIGH']];
const m914 = face('914', 'the 914 fixed filter bank (4 MU): ours', 4 * MU, H5,
  [SEC('bank', '914 FIXED FILTER BANK', 0, 4 * MU, H5)],
  [...B914.map(([id, l], i) => KN(id, BX914(i % 7), i < 7 ? 54 : 108, 20, l)),
    JK('i1', 32, 170, 'SIGNAL INPUT 1'), JK('i2', 62, 170, 'SIGNAL INPUT 2'), JK('o1', 154, 170, 'SIGNAL OUTPUT 1'), JK('o2', 184, 170, 'SIGNAL OUTPUT 2')],
  [HEAD(107.95, 16.6, 'FIXED FILTER BANK'), NUM(107.95, 216.05, '914'), RULE(21.4, 2.6, 213.3),
    TX(107.95, 27.4, 'BAND CENTRES IN HZ · A LOW AND A HIGH SECTION', 1.5),
    ...B914.flatMap(([, l], i) => { const x = BX914(i % 7), y = i < 7 ? 54 : 108; return [TX(x, y - 14.6, l, 2.1), DIAL(x, y, 19, ENDS, 1.55)]; }),
    RULE(141.4, 2.6, 213.3), TX(47, 151.6, 'SIGNAL INPUTS', 1.85), TX(32, 161.4, '1', 1.7), TX(62, 161.4, '2', 1.7),
    TX(169, 151.6, 'SIGNAL OUTPUTS', 1.85), TX(154, 161.4, '1', 1.7), TX(184, 161.4, '2', 1.7),
    { t: 'line', x1: 72, y1: 170, x2: 103.95, y2: 170, sw: 0.35 }, { t: 'glyph', g: 'arrow:right', x: 107.95, y: 170, size: 5 }, { t: 'line', x1: 111.95, y1: 170, x2: 144, y2: 170, sw: 0.35 },
    TX(107.95, 186.6, 'BOTH INPUTS PATCHED: MIXED · THE TWO OUTPUTS: ONE SIGNAL', 1.35)],
  [OURS + 'fourteen pots in two rows of seven (LOW, 125 … 700 Hz; 1 … 5.6 kHz, HIGH), 0…10 dials, then the two SIGNAL INPUTS → the two SIGNAL OUTPUTS, in the house style of the 907A face (no CV: none on the original).'],
);

/* ---------------------------------------------------------------- 960 sequential controller (8 MU) */
// the clock column (x 0 … 60), stages 1–8 (columns of 38 mm from x 60), stage 9 (x 364 … 394: no knobs), the row column (x 394 … 431.8)
const X960 = k => (k < 9 ? 79 + 38 * (k - 1) : 379), YK = [52, 78, 104], RW = ['a', 'b', 'c'], RL = ['A', 'B', 'C'];
const m960 = face('960', 'the 960 sequential controller (8 MU): ours — a clock column, nine stage columns, a row column', 8 * MU, H5,
  [SEC('clock', 'CLOCK', 0, 60, H5), SEC('stages', 'STAGES', 60, 334, H5), SEC('rows', 'ROWS', 394, 37.8, H5)],
  [LMP('lo', 30, 30, 'OSC'), EVB('on', 16, 44, 'OSC ON', 'ON'), EVB('off', 44, 44, 'OSC OFF', 'OFF'), BH('os', 30, 62, 'CLOCK AT START'),
    ROT('rg', 30, 89, 18, 270, ['0.1', '0.4', '1.6', '6.4', '26', '100', '410'], 'RANGE'), KN('vn', 30, 115, 16, 'VERNIER'),
    BH('cc', 30, 137, 'ROW C → CLOCK'), EVB('sh', 30, 153, 'SHIFT', 'SHIFT'),
    JK('on', 12, 176, 'OSC ON'), JK('off', 30, 176, 'OSC OFF'), JK('sh', 48, 176, 'SHIFT'), JK('ci', 18, 200, 'CONTROL INPUT'), JK('co', 42, 200, 'OUTPUT'),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap(k => { const x = X960(k); return [LMP('l' + k, x, 30, 'STAGE ' + k),
      ...(k < 9 ? RW.map((r, i) => KN(r + k, x, YK[i], 18, 'ROW ' + RL[i] + ' ' + k)) : []),
      BV('s' + k, x, 130, 'STAGE ' + k + ' MODE'), EVB('e' + k, x, 152, 'SET ' + k, 'SET'), JK('i' + k, x, 176, 'STAGE ' + k + ' IN'), JK('o' + k, x, 200, 'STAGE ' + k + ' OUT')]; }),
    ...RW.flatMap((r, i) => [JK('r' + r + '1', 403.5, YK[i], 'ROW ' + RL[i] + ' 1'), JK('r' + r + '2', 422.3, YK[i], 'ROW ' + RL[i] + ' 2')]),
    ...RW.map((r, i) => BH('g' + r, 416, 136 + 22 * i, 'ROW ' + RL[i] + ' RANGE', 14))],
  [HEAD(215.9, 14.6, 'SEQUENTIAL CONTROLLER', 2.6), NUM(215.9, 216.05, '960'), RULE(21.4, 2.6, 429.2),
    VRULE(60, 21.4, 210), VRULE(364, 21.4, 210), VRULE(394, 21.4, 210),
    // the clock column
    TX(30, 25.8, 'CLOCK', 1.5, 700), TE(25.4, 30.55, 'OSC', 1.45),
    TX(30, 55.8, 'CLOCK AT START', 1.45), TE(23.4, 62.5, 'STOPPED', 1.3), TS(36.6, 62.5, 'RUNNING', 1.3),
    TX(30, 71.4, 'RANGE · HZ', 1.45), TX(30, 104.6, 'VERNIER', 1.45), DIAL(30, 115, 15, ENDS, 1.45),
    TX(30, 130.2, 'ROW C → CLOCK', 1.4), TE(23.4, 137.5, 'OFF', 1.3), TS(36.6, 137.5, 'ON', 1.3),
    TX(12, 167.4, 'ON', 1.45), TX(30, 167.4, 'OFF', 1.45), TX(48, 167.4, 'SHIFT', 1.45), TX(18, 191.4, 'CONTROL IN', 1.35), TX(42, 191.4, 'OUTPUT', 1.35),
    // the stages: row letters, stage numbers, dials, mode legends, IN / OUT
    ...RL.map((l, i) => TX(65, YK[i] + 0.95, l, 2.6, 700)), RULE(117.6, 61, 363), RULE(162.4, 61, 393),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap(k => { const x = X960(k); return [TE(x - 5.2, 30.8, String(k), 2.2),
      ...(k < 9 ? YK.map(y => DIAL(x, y, 17, D10S, 1.45)) : []),
      TS(x + 4.4, 125.9, 'STOP', 1.3), ...(k < 9 ? [TS(x + 4.4, 130.55, 'NORMAL', 1.3)] : []), TS(x + 4.4, 135.2, 'SKIP', 1.3),
      TX(x, 167.4, 'IN', 1.5), TX(x, 191.4, 'OUT', 1.5)]; }),
    // the row column: two jacks a row, the ranges
    TX(412.9, 26.4, 'ROWS', 1.5, 700), ...RL.map((l, i) => TX(412.9, YK[i] - 8.4, 'ROW ' + l, 1.45)),
    TX(412.9, 122.6, 'RANGE', 1.45, 700), ...RL.flatMap((l, i) => { const y = 136 + 22 * i; return [TX(400.6, y + 0.85, l, 2.4, 700),
      TX(411.375, y - 4.8, '×1', 1.25), TX(416, y - 4.8, '×2', 1.25), TX(420.625, y - 4.8, '×4', 1.25)]; }),
    TX(412.9, 197.6, '2 · 4 · 8 V AT 10', 1.25)],
  [OURS + 'a clock column (the OSC lamp, OSC ON / OFF buttons, CLOCK AT START, RANGE (seven detents, Hz), VERNIER, ROW C → CLOCK, the SHIFT button; jacks OSC ON · OFF · SHIFT · CONTROL INPUT · OUTPUT), nine stage columns (a lamp, the A / B / C knobs (0…10 dials), the STOP / NORMAL / SKIP switch, SET, IN and OUT; stage 9: STOP / SKIP, no knobs) and a row column (two outputs a row, ×1 / ×2 / ×4), in the house style.',
    'IMPL-9b §4.1–§4.2: 15 mm jack pitch, 9 mm clearance, 14 mm hits; lite (the knobs\' skirts and caps are art): the live layer stays within §4.2\'s 960 budget.'],
);

/* ---------------------------------------------------------------- the console panels (142.875 mm tall) */
// CP3A mixer and routing (4 MU): MIXER (2 MU) · ROUTING (1 MU) · MULTIPLES and TRUNKS (1 MU)
const XM = [18, 42, 66, 90];
const cp3a = face('cp3a', 'the CP3A mixer and routing panel (4 MU, console height): ours', 4 * MU, HC,
  [SEC('mix', 'MIXER', 0, 2 * MU, HC), SEC('route', 'ROUTING', 2 * MU, MU, HC), SEC('mult', 'MULTIPLES', 3 * MU, MU, HC)],
  [...XM.map((x, i) => JK('m' + (i + 1), x, 34, 'MIXER INPUT ' + (i + 1))), ...XM.map((x, i) => KN('x' + (i + 1), x, 64, 16, 'LEVEL ' + (i + 1))),
    KN('ms', 30, 104, 18, 'MASTER'), JK('mo', 66, 104, 'MIX +'), JK('mn', 90, 104, 'MIX −'),
    LIT('r1', 122, 38, 'KEYBOARD'), LIT('r2', 148, 38, 'WHEEL'), LIT('r3', 122, 64, 'PRESSURE'), LIT('r4', 148, 64, 'EXT'),
    KN('ra', 122, 100, 16, 'EXT LEVEL'), JK('x4', 148, 104, 'EXT IN'),
    JK('a1', 176, 34, 'MULTIPLE 1'), JK('a2', 202, 34, 'MULTIPLE 2'), JK('a3', 176, 58, 'MULTIPLE 3'), JK('a4', 202, 58, 'MULTIPLE 4'),
    TRUNK(1, 176, 92), TRUNK(2, 202, 92), TRUNK(3, 176, 116), TRUNK(4, 202, 116)],
  [VRULE(2 * MU, 2, 140.8), VRULE(3 * MU, 2, 140.8),
    HEAD(54, 12.6, 'MIXER'), RULE(17.6, 2.6, 105.35), ...XM.map((x, i) => TX(x, 24.6, String(i + 1), 2.1, 700)), ...XM.map(x => DIAL(x, 64, 15, D10S, 1.4)),
    TX(54, 81.4, 'LEVELS', 1.5), TX(30, 91, 'MASTER', 1.6), DIAL(30, 104, 17, ENDS, 1.45), TX(78, 90.6, 'MIX', 1.8, 700), TX(66, 95.4, '+', 2.4), TX(90, 95.4, '−', 2.4),
    NUM(54, 133, 'CP3A'),
    HEAD(134.95, 12.6, 'ROUTING'), RULE(17.6, 110.55, 159.3), TX(122, 31.6, 'KEYBOARD', 1.35), TX(148, 31.6, 'WHEEL', 1.35), TX(122, 57.6, 'PRESSURE', 1.35),
    TX(148, 57.6, 'EXT', 1.35), TX(122, 88.6, 'EXT LEVEL', 1.4), DIAL(122, 100, 15, ENDS, 1.4), TX(148, 95.4, 'EXT IN', 1.4),
    TX(134.95, 121.4, 'TO AN OSCILLATOR', 1.3), TX(134.95, 124.2, 'DRIVER, BEHIND', 1.3),
    HEAD(188.9, 12.6, 'MULTIPLES', 2.2), RULE(17.6, 164.5, 213.3), { t: 'path', d: 'M176 34H202V58H176Z', sw: 0.5 },
    TX(188.9, 81.4, 'TRUNKS', 1.5, 700), TX(188.9, 128.6, 'NOT EMULATED', 1.25)],
  [OURS + 'MIXER (four INPUTS over their LEVELS, MASTER, MIX + / −), ROUTING (KEYBOARD, WHEEL, PRESSURE and EXT as lit push switches — lit = routed behind the panel to the oscillator driver of this panel\'s number —, EXT LEVEL over EXT IN), the four MULTIPLES and four TRUNKS (drawn, dimmed: not emulated). The rear terminal is not drawn.'],
);

// CP4A routing (3 MU; System 35): an honest stand-in
const cp4a = face('cp4a', 'the CP4A routing panel (3 MU, console height): an honest stand-in, ours', 3 * MU, HC,
  [SEC('cv', 'CV ROUTING', 0, 1.5 * MU, HC), SEC('trig', 'TRIGGER ROUTING', 1.5 * MU, 1.5 * MU, HC)],
  [LIT('c1', 14, 40, 'KEYBOARD'), LIT('c2', 32, 40, 'WHEEL'), LIT('c3', 50, 40, 'PRESSURE'), LIT('c4', 68, 40, 'CV IN'), JK('ci', 68, 72, 'CV IN'),
    LIT('t1', 100, 40, 'TRIGGER 1'), LIT('t2', 122, 40, 'TRIGGER 2'), LIT('t3', 144, 40, 'TRIGGER 3'), SK('ti', 100, 72, 'TRIGGER IN'),
    TRUNK(1, 24, 104), TRUNK(2, 48, 104), TRUNK(3, 114, 104), TRUNK(4, 138, 104)],
  [VRULE(1.5 * MU, 2, 90),
    HEAD(40.5, 12.6, 'CV ROUTING', 2.2), HEAD(121.4, 12.6, 'TRIGGER ROUTING', 2.2), RULE(17.6, 2.6, 159.3),
    TX(14, 32.8, 'KEYBOARD', 1.25), TX(32, 32.8, 'WHEEL', 1.25), TX(50, 32.8, 'PRESSURE', 1.25), TX(68, 32.8, 'CV IN', 1.25),
    TX(30, 72.6, 'TO THE 904A', 1.4), TX(68, 63.4, 'CV IN', 1.4),
    TX(100, 32.8, '911 1', 1.35), TX(122, 32.8, '911 2', 1.35), TX(144, 32.8, '911 3', 1.35), TX(100, 63.4, 'TRIGGER IN', 1.4),
    TX(130, 70.6, 'S-TRIG 1 AND', 1.3), TX(130, 73.4, 'TRIGGER IN', 1.3), TX(130, 76.2, 'TO THE 911S', 1.3),
    TX(81, 103.4, 'TRUNKS', 1.5, 700), TX(81, 106.2, 'NOT EMULATED', 1.25), RULE(114, 2.6, 159.3),
    NUM(81, 126, 'CP4A'), TX(81, 132.6, 'OURS — ITS ROUTING STANDS IN FOR THE ORIGINAL’S', 1.45)],
  [OURS + 'an honest stand-in, its plate says so: four CV ROUTING lit switches (KEYBOARD, WHEEL, PRESSURE, CV IN) to the 904A and CV IN; three TRIGGER ROUTING lit switches (to the 911s by number) and the TRIGGER IN socket; four TRUNKS drawn, dimmed. Its two rear terminals are not drawn.'],
);

// CP35 attenuators and sources (4 MU; System 35): an honest stand-in
const XA = [58, 84, 110, 136];
const cp35 = face('cp35', 'the CP35 attenuators and sources panel (4 MU, console height): an honest stand-in, ours', 4 * MU, HC,
  [SEC('src', 'SOURCES', 0, 40, HC), SEC('att', 'ATTENUATORS', 40, 110, HC), SEC('mult', 'MULTIPLES', 150, 4 * MU - 150, HC)],
  [JK('p6', 20, 40, '+6 V'), JK('m6', 20, 70, '−6 V'),
    ...XA.flatMap((x, i) => [KN('a' + (i + 1), x, 38, 16, 'ATTENUATOR ' + (i + 1)), JK('i' + (i + 1), x, 72, 'ATTENUATOR ' + (i + 1) + ' IN'), JK('o' + (i + 1), x, 98, 'ATTENUATOR ' + (i + 1) + ' OUT')]),
    JK('u1', 170, 38, 'MULTIPLE 1'), JK('u2', 196, 38, 'MULTIPLE 2'), JK('u3', 170, 64, 'MULTIPLE 3'), JK('u4', 196, 64, 'MULTIPLE 4'),
    TRUNK(1, 170, 98), TRUNK(2, 196, 98), TRUNK(3, 170, 122), TRUNK(4, 196, 122)],
  [VRULE(40, 2, 116), VRULE(150, 2, 140.8),
    HEAD(20, 12.6, 'SOURCES', 2.05), TX(20, 31.4, '+6 V', 1.6), TX(20, 61.4, '−6 V', 1.6),
    HEAD(95, 12.6, 'ATTENUATORS'), ...XA.flatMap((x, i) => [TX(x, 24.4, String(i + 1), 2.1, 700), DIAL(x, 38, 15, ENDS, 1.4), TX(x, 63.4, 'IN', 1.45), TX(x, 89.4, 'OUT', 1.45)]),
    TX(97, 113.4, 'AN EMPTY IN 1 · 2 READS +6 V, IN 3 · 4 −6 V', 1.3), RULE(17.6, 2.6, 213.3),
    HEAD(183, 12.6, 'MULTIPLES', 2.2), { t: 'path', d: 'M170 38H196V64H170Z', sw: 0.5 }, TX(183, 87.4, 'TRUNKS', 1.5, 700), TX(183, 134.4, 'NOT EMULATED', 1.25),
    NUM(95, 128, 'CP35'), TX(95, 134.4, 'OURS — A STAND-IN FOR ITS ATTENUATORS AND SOURCES', 1.3)],
  [OURS + 'an honest stand-in, its plate says so: +6 V and −6 V SOURCES, four ATTENUATORS (a knob over its IN and OUT; an unpatched IN 1 / 2 reads +6 V, IN 3 / 4 −6 V), four MULTIPLES and four TRUNKS (drawn, dimmed).'],
);

// CP2 filters, multiples, keyboard outputs (3 MU; System 55): a stand-in on a short list
const cp2 = face('cp2', 'the CP2 filters, multiples and keyboard outputs panel (3 MU, console height): a stand-in on a short list, ours', 3 * MU, HC,
  [SEC('lp', 'LOW PASS', 0, MU, HC), SEC('hp', 'HIGH PASS', MU, MU, HC), SEC('mk', 'MULTIPLES · KEYBOARD', 2 * MU, MU, HC)],
  [KN('lp', 27, 42, 18, 'LOW PASS'), JK('li', 14, 84, 'LOW PASS IN'), JK('lo', 40, 84, 'LOW PASS OUT'),
    KN('hp', 81, 42, 18, 'HIGH PASS'), JK('hi', 68, 84, 'HIGH PASS IN'), JK('ho', 94, 84, 'HIGH PASS OUT'),
    JK('u1', 122, 34, 'MULTIPLE 1'), JK('u2', 146, 34, 'MULTIPLE 2'), JK('u3', 122, 58, 'MULTIPLE 3'), JK('u4', 146, 58, 'MULTIPLE 4'),
    JK('po', 122, 96, 'PITCH OUT'), SK('so', 146, 96, 'S-TRIG OUT')],
  [VRULE(MU, 2, 108), VRULE(2 * MU, 2, 108), RULE(17.6, 2.6, 159.3),
    HEAD(27, 12.6, 'LOW PASS', 2.05), DIAL(27, 42, 17, HZ, 1.4), TX(27, 57.8, 'HZ', 1.3), TX(14, 75.4, 'IN', 1.5), TX(40, 75.4, 'OUT', 1.5),
    HEAD(81, 12.6, 'HIGH PASS', 2.05), DIAL(81, 42, 17, HZ, 1.4), TX(81, 57.8, 'HZ', 1.3), TX(68, 75.4, 'IN', 1.5), TX(94, 75.4, 'OUT', 1.5),
    HEAD(134.95, 12.6, 'MULTIPLES', 2.05), { t: 'path', d: 'M122 34H146V58H122Z', sw: 0.5 },
    TX(134.95, 76.6, 'KEYBOARD', 1.5, 700), TX(122, 87.4, 'PITCH', 1.4), TX(146, 87.4, 'S-TRIG', 1.4), RULE(108, 2.6, 159.3),
    NUM(81, 124, 'CP2'), TX(81, 130.6, 'OURS — FROM A SHORT LIST OF ITS PARTS', 1.4)],
  [OURS + 'a stand-in on the short list the research gives (passive LOW PASS and HIGH PASS, multiples, the keyboard\'s pitch and trigger outputs), its plate says so. Its two rear terminals are not drawn.'],
);

// CP8A power (2 MU): drawn only, not emulated
const cp8a = face('cp8a', 'the CP8A power panel (2 MU, console height): ours, drawn only — not emulated', 2 * MU, HC,
  [SEC('pwr', 'POWER', 0, 2 * MU, HC)],
  [{ kind: 'switch', style: 'rocker', orient: 'v', x: 30, y: 62, w: 12, h: 20, color: BAT, inert: true, p: 1, label: 'POWER', lab: 'none' },
    { kind: 'lamp', x: 78, y: 62, d: 10, color: '#f0a03a', lit: true, inert: true, label: 'PILOT', lab: 'none' },
    { kind: 'fuse', x: 30, y: 104, w: 9, h: 18, inert: true, label: 'FUSE 1', lab: 'none' },
    { kind: 'fuse', x: 78, y: 104, w: 9, h: 18, inert: true, label: 'FUSE 2', lab: 'none' }],
  [HEAD(53.98, 12.6, 'POWER'), RULE(17.6, 2.6, 105.35), TX(30, 47.4, 'POWER', 1.6), TS(38.4, 55.6, 'ON', 1.4), TS(38.4, 69.4, 'OFF', 1.4), TX(78, 52.4, 'PILOT', 1.6),
    TX(30, 90.6, 'FUSE', 1.5), TX(78, 90.6, 'FUSE', 1.5), NUM(53.98, 128, 'CP8A'), TX(53.98, 134.4, 'DRAWN ONLY — NOT EMULATED', 1.4)],
  [OURS + 'the power switch, the pilot lamp and two fuse holders, drawn and dimmed — not emulated (the 1b+ rule): a tap says so.'],
);

// 961 interface (the 961CP console format, 3 MU): two V → S blocks of six A and six B inputs, two S → V, audio → V
const Y961 = r => 30 + 15 * (r - 1);
const m961 = face('961', 'the 961 interface in the console format (3 MU): ours', 3 * MU, HC,
  [SEC('v2s1', 'V → S 1', 0, 44.5, HC), SEC('v2s2', 'V → S 2', 44.5, 42.5, HC), SEC('cv', 'S → V · AUDIO → V', 87, 3 * MU - 87, HC)],
  [...[1, 2].flatMap(b => { const xa = b === 1 ? 16 : 58; return [1, 2, 3, 4, 5, 6].flatMap(r => [JK('a' + b + r, xa, Y961(r), 'V→S ' + b + ' A INPUT ' + r), JK('b' + b + r, xa + 15, Y961(r), 'V→S ' + b + ' B INPUT ' + r)])
      .concat([SK('s' + b, xa, 124, 'V→S ' + b + ' S-TRIG OUT'), KN('t' + b, xa + 19, 126, 16, 'SWITCH ON TIME ' + b)]); }),
    JK('ai', 100, 32, 'AUDIO→V IN'), KN('se', 124, 32, 16, 'SENSITIVITY'), JK('ao1', 148, 28, 'AUDIO→V OUT 1'), JK('ao2', 148, 46, 'AUDIO→V OUT 2'),
    SK('v1i', 100, 74, 'S→V 1 IN'), JK('v1o', 124, 74, 'S→V 1 OUT'), SK('v2i', 100, 98, 'S→V 2 IN'), JK('v2o', 124, 98, 'S→V 2 OUT')],
  [HEAD(80.96, 8.8, 'INTERFACE'), TX(23.5, 14.8, 'V → S 1', 1.5, 700), TX(65.5, 14.8, 'V → S 2', 1.5, 700), TX(124, 14.8, 'AUDIO → V', 1.5, 700),
    RULE(17.6, 2.6, 159.3), VRULE(87, 17.6, 140.8),
    ...[16, 58].flatMap(x => [TX(x, 21.9, 'A', 1.6, 700), TX(x + 15, 21.9, 'B', 1.6, 700), TX(x, 118.2, 'S-TRIG OUT', 1.25), TX(x + 19, 115.6, 'ON TIME', 1.25), DIAL(x + 19, 126, 15, ENDS, 1.3)]),
    ...[1, 2, 3, 4, 5, 6].map(r => TX(44.5, Y961(r) + 0.65, String(r), 1.7)),
    TX(100, 23.6, 'IN', 1.4), DIAL(124, 32, 15, ENDS, 1.3), TX(124, 47.6, 'SENSITIVITY', 1.25), TE(139.4, 28.5, '1', 1.4), TE(139.4, 46.5, '2', 1.4),
    TX(112, 60.6, 'S → V', 1.6, 700), TX(100, 67.6, 'IN', 1.35), TX(124, 65.4, 'OUT', 1.35), TE(94, 74.5, '1', 1.4), TE(94, 98.5, '2', 1.4),
    { t: 'glyph', g: 'arrow:right', x: 112, y: 74, size: 4 }, { t: 'glyph', g: 'arrow:right', x: 112, y: 98, size: 4 },
    NUM(124, 128, '961')],
  [OURS + 'the console format (the 961CP of the System 55\'s console row): two V → S blocks, each six A inputs (closed while one is high) beside six B inputs (an edge starts the one-shot) over its S-TRIG OUT and SWITCH ON TIME; AUDIO → V (IN, SENSITIVITY, two OUT jacks); two S → V (an S-trigger IN → a 4 V OUT).'],
);

// our Song clock (2 MU, console height): the song's steps as pulses
const LEN = ['OFF', '', '', '4', '', '', '', '8', '', '', '', '', '', '', '', '16', '', '', '', '', '', '', '', '24', '', '', '', '', '', '', '', '32'];
const clk = face('clk', 'our Song clock (2 MU, console height): the song\'s steps, its run state and its restarts as voltages', 2 * MU, HC,
  [SEC('clk', 'SONG CLOCK', 0, 2 * MU, HC)],
  [ROT('dv', 28, 50, 18, 270, ['1/4', '1/8', '1/16', '1/32', '1/8T', '1/16T'], 'STEP'), ROT('ln', 80, 50, 18, 300, LEN, 'LENGTH'),
    BH('md', 28, 88, 'MODE'), LMP('lr', 80, 88, 'RUN'),
    JK('ck', 22, 116, 'CLOCK'), JK('rn', 54, 116, 'RUN'), JK('rs', 86, 116, 'RESTART')],
  [HEAD(53.98, 10.2, 'SONG CLOCK'), TX(53.98, 15.2, 'OURS — THE SONG’S TEMPO AS PULSES', 1.45), RULE(18.2, 2.6, 105.35),
    TX(28, 30.6, 'STEP', 1.6), TX(80, 30.6, 'LENGTH · STEPS', 1.5),
    TX(28, 80.4, 'MODE', 1.6), TE(21.4, 88.5, 'SONG', 1.35), TS(34.6, 88.5, 'ALWAYS', 1.35), TX(80, 81.4, 'RUN', 1.6),
    RULE(98.4, 2.6, 105.35), TX(22, 107.4, 'CLOCK', 1.5), TX(54, 107.4, 'RUN', 1.5), TX(86, 107.4, 'RESTART', 1.5),
    TX(53.98, 133, 'OUTPUTS 0 / +5 V', 1.35)],
  [OURS + 'not a module of the original: STEP (1/4 … 1/16T), LENGTH (OFF, 2 … 32 steps: RESTART also every LENGTH steps from the song\'s start), MODE SONG / ALWAYS, the RUN lamp; CLOCK, RUN and RESTART jacks. Its plate says it is ours.'],
);

/** The System 35 / 55 faces by module type (moog-core TYPES[t].layout = the type id). */
export const MODULES = Object.freeze({ '904b': m904b, 914: m914, '911a': m911a, '903a': m903a, 960: m960, 962: m962, 992: m992, 993: m993, 994: m994,
  cp2, cp3a, cp4a, cp35, cp8a, 961: m961, clk });
