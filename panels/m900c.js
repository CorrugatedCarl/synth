// panels/m900c.js — the 1960s extras' faces (IMPL-9c §1.0–§1.7, §4 lane X; the ten new module types), as layout data for cv-panel in
// the house treatment of panels/m900.js and panels/m900b.js (black panels inset 1 mm from a silver frame, cream legends, the title at
// the top and the number in plain type at the foot, knurled knobs with silver caps, screws). Data only: no imports, no DOM, no logos
// or maker names; the small builders below are m900b.js's (copied: that file exports MODULES alone, tests/moog-core.test.mjs reads
// every exported object for faces) — what they return is plain data. MODULES = { <type>: layout } for the ten 9c types (keyed by
// moog-core TYPES[t].layout = the type id, each layout's id 'pm-<type>': cv-panel moduleModel's); panels/index.js merges it into
// MODULE_LAYOUTS. No default export. Every face is `lite` (cv-panel: knob skirts and caps are art — the 984's 22 knobs stay within
// IMPL-9c §3 G6's 130 painted).
// No photograph was fetched or viewed: every face is ours, laid out from the contract's table (IMPL-9c §1.0: ids, jacks, params,
// widths) and §1.1–§1.7; the stand-ins (the 901C, the 904C's inside pair, the 905, the 991) say OURS on their plates (D5). No maker
// word anywhere — cv-panel's MAKERS rule, and the 905's tank maker too (not in MAKERS: tests/cv-panel.test.mjs checks it).
// Units: mm of a panel in its own frame. 1 MU = 53.975 mm; a 5U face is 222.25 mm tall, a console panel 142.875 mm. Sizes (cv-panel
// sizeOf, the 40 px bar included) = moog-core TYPES[t].w / h: 1 MU 128 × 512, 2 MU 224 × 512, 3 MU 352 × 512, 4 MU 448 × 512; the
// CP3 (4 MU, console height) 448 × 352.
// Live parts: knobs, rotaries and bat switches (params); the CP3's routing as lit push switches (a `button` with cycle [0, 1], as the
// CP3A's); patch jacks as stage 9's (centres ≥ 15 mm apart, ≥ 9 mm from every hit box), the 912's S-trigger output a socket
// (`strig`); the CP3's rear terminal (`xr`) never placed; its trunks drawn dimmed ("not emulated", inert).

const MU = 53.975, H5 = 222.25, HC = 142.875, W2 = 2 * MU, W3 = 3 * MU, W4 = 4 * MU;
// the shared skin (panels/m900b.js's) + the push caps: a cream cap, an amber lamp
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
const FRAME = '#a3a39e', PANEL = '#121212', BAT = '#d2d2ce', CAP = '#e4dfd2';
const D10S = ['0', '', '', '', '', '5', '', '', '', '', '10'], ENDS = ['0', '', '', '', '', '', '', '', '', '', '10'];
const DV6 = ['-6', '', '-4', '', '-2', '', '0', '', '2', '', '4', '', '6'];
const DV5 = ['-5', '-4', '-3', '-2', '-1', '0', '1', '2', '3', '4', '5', '6']; // the 901's FIXED VOLTAGE −5 … +6 (an integer a stop)
const PW9 = ['10', '20', '30', '40', '50', '60', '70', '80', '90'];
const FEET = ['LO', '32\'', '16\'', '8\'', '4\'', '2\''];
const C1 = 26.99; // a 1 MU face's centre line

/* ---------------------------------------------------------------- builders (plain data out) */
const KN = (id, x, y, d, label, o) => Object.assign({ id, kind: 'knob', x, y, d, sweep: 300, label, lab: 'none' }, o);
const ROT = (id, x, y, d, sweep, legends, label) => ({ id, kind: 'rotary', x, y, d, sweep, label, lab: 'none', legends });
const BV = (id, x, y, label) => ({ id, kind: 'switch', style: 'bat', orient: 'v', x, y, w: 6, h: 14, color: BAT, label, lab: 'none' });
const LIT = (id, x, y, label) => ({ id, kind: 'button', x, y, w: 11, h: 8, cycle: [0, 1], led: 'cap', color: CAP, label, lab: 'none' });
const JK = (port, x, y, label, d) => ({ kind: 'jack', port, x, y, d: d || 14, label, lab: 'none' });
const SK = (port, x, y, label) => ({ kind: 'strig', port, x, y, w: 10, h: 8, label, lab: 'none' });
const TRUNK = (n, x, y) => ({ kind: 'jack', x, y, d: 14, inert: true, label: 'TRUNK ' + n, lab: 'none' });
const TX = (x, y, s, size, weight, o) => Object.assign({ t: 'text', x, y, s, size: size || 1.85, weight: weight || 600, anchor: 'middle', ls: 0.12 }, o);
const TS = (x, y, s, size) => TX(x, y, s, size || 1.4, 600, { anchor: 'start', ls: 0.08 });
const HEAD = (x, y, s, size) => TX(x, y, s, size || 2.45, 700, { ls: 0.2 });
const RULE = (y, x1, x2) => ({ t: 'line', x1, y1: y, x2, y2: y, sw: 0.35 });
const VRULE = (x, y1, y2) => ({ t: 'line', x1: x, y1, x2: x, y2, sw: 0.35 });
const DIAL = (x, y, d, labels, size) => ({ t: 'scale', x, y, d, sweep: 300, n: labels.length, labels, size: size || 1.6 });
const NUM = (x, y, s) => TX(x, y, s, 4, 700, { ls: 0.3 });
const SEC = (id, label, x, w, h, y) => ({ id, label, x, y: y || 0, w, h, frame: 'none', title: 'none' });
const GL = (g, x, y, size) => ({ t: 'glyph', g, x, y, size: size || 3.2 });
// the baseline of a legend over a dial: the dial (d dd, digits size sz) at y, its labels at r = dd / 2 + 3.9, 1.5 mm clear
const UP = (y, dd, sz) => Math.round((y - dd / 2 - 3.9 - 0.36 * sz - 1.5) * 100) / 100;
// a boxed plate: the "OURS" legend of a stand-in (D5) — a thin outline and its lines, centred on x
const PLATE = (x, y, w, lines, size) => [{ t: 'rect', x: x - w / 2, y, w, h: 3.6 + 3.3 * lines.length, stroke: '#ece9df', sw: 0.3 },
  ...lines.map((s, i) => TX(x, y + 4.4 + 3.3 * i, s, size || 1.4, 700, { ls: 0.1 }))];
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

/* ---------------------------------------------------------------- 901 oscillator (3 MU): a 901A and a 901B on one panel */
// four columns (sine · sawtooth · triangle · pulse) the whole way down: the level knobs, the fixed outputs, the variable ones
const X901 = [30, 66, 102, 138], CX3 = W3 / 2;
const WV = [['sin', 'SINE', 'wave:sine'], ['saw', 'SAWTOOTH', 'wave:saw'], ['tri', 'TRIANGLE', 'wave:tri'], ['pls', 'PULSE', 'wave:rect']];
const m901 = face('901', 'the 901 oscillator (3 MU): ours — a 901A and a 901B on one panel, self-contained: eight outputs, three control inputs', W3, H5,
  [SEC('freq', '901 OSCILLATOR', 0, W3, 74.4), SEC('wave', 'WAVEFORMS', 0, W3, H5 - 74.4, 74.4)],
  [KN('fv', X901[0], 54, 28, 'FIXED VOLTAGE', { skin: { capR: 0.78 } }), ROT('rg', X901[1], 54, 20, 180, FEET, 'FREQUENCY RANGE'),
    KN('fq', X901[2], 54, 24, 'FINE'), KN('pw', X901[3], 54, 24, 'PULSE WIDTH'),
    ...WV.map(([, n], i) => KN('v' + (i + 1), X901[i], 102, 18, n + ' LEVEL')),
    ...WV.map(([p, n], i) => JK(p, X901[i], 131, n + ' OUT')), ...WV.map(([p, n], i) => JK('v' + p, X901[i], 157, 'VARIABLE ' + n + ' OUT')),
    ...[1, 2, 3].map(k => JK('f' + k, CX3 + 28 * (k - 2), 194, 'CONTROL INPUT ' + k))],
  [HEAD(CX3, 14.35, 'VOLTAGE CONTROLLED', 2.05), HEAD(CX3, 17.25, 'OSCILLATOR', 2.05), NUM(CX3, 213.4, '901'), RULE(21.6, 2.6, W3 - 2.6),
    DIAL(X901[0], 54, 27, DV5, 1.9), TX(X901[0], UP(54, 27, 1.9), 'FIXED VOLTAGE', 1.75), TX(X901[1], UP(54, 27, 1.9), 'FREQUENCY RANGE', 1.75),
    DIAL(X901[2], 54, 23, DV6, 1.9), TX(X901[2], UP(54, 27, 1.9), 'FINE · ±1 OCT.', 1.75),
    DIAL(X901[3], 54, 23, PW9, 1.9), TX(X901[3], UP(54, 27, 1.9), 'PULSE WIDTH', 1.75),
    RULE(74.4, 2.6, W3 - 2.6),
    ...WV.flatMap(([, n, g], i) => [GL(g, X901[i], 80.6), TX(X901[i], 85.8, n, 1.6), DIAL(X901[i], 102, 17, D10S, 1.5)]),
    RULE(119.4, 2.6, W3 - 2.6), TS(3.4, 131.6, 'FIXED', 1.5), TS(3.4, 157.6, 'VARIABLE', 1.5),
    ...WV.flatMap(([, n], i) => [TX(X901[i], 142.6, n, 1.4), TX(X901[i], 168.6, n, 1.4)]),
    RULE(173.4, 2.6, W3 - 2.6), TX(CX3, 181, 'CONTROL INPUTS', 1.7)],
  [OURS + 'FIXED VOLTAGE (−5…+6), FREQUENCY RANGE (LO and five footages), FINE (±1 octave) and PULSE WIDTH (10…90 %) across the top; one LEVEL knob a waveform (sine, sawtooth, triangle, pulse), each over its fixed and its variable output (the variable jack = the fixed one × the level); three summed CONTROL INPUTS. A 901A and a 901B on one panel, no link and no width jack, in the house style.'],
);

/* ---------------------------------------------------------------- 901A oscillator controller (1 MU): no audio outputs, no range switch */
const m901a = face('901a', 'the 901A oscillator controller (1 MU): ours — the driver of the 901Bs, no audio output, no range switch', MU, H5,
  [SEC('drv', '901A OSCILLATOR CONTROLLER', 0, MU, H5)],
  [KN('fv', C1, 52, 28, 'FIXED VOLTAGE', { skin: { capR: 0.78 } }), KN('fq', C1, 96, 24, 'FINE'), KN('pw', C1, 140, 24, 'PULSE WIDTH'),
    JK('f1', 14, 176, 'CONTROL INPUT 1'), JK('f2', 40, 176, 'CONTROL INPUT 2'), JK('f3', C1, 197, 'CONTROL INPUT 3')],
  [HEAD(C1, 13.6, 'OSCILLATOR', 2.05), HEAD(C1, 16.5, 'CONTROLLER', 2.05), TX(C1, 21.2, 'DRIVES UP TO THREE 901B', 1.4), NUM(C1, 213.4, '901A'), RULE(24.6, 2.6, 51.375),
    DIAL(C1, 52, 27, DV5, 1.9), TX(C1, UP(52, 27, 1.9), 'FIXED VOLTAGE', 1.85), RULE(74.4, 2.6, 51.375),
    DIAL(C1, 96, 23, DV6, 1.9), TX(C1, UP(96, 23, 1.9), 'FINE · ±1 OCT.', 1.85), RULE(118.6, 2.6, 51.375),
    DIAL(C1, 140, 23, PW9, 1.9), TX(C1, UP(140, 23, 1.9), 'PULSE WIDTH', 1.85), RULE(157.6, 2.6, 51.375),
    TX(C1, 164.4, 'CONTROL INPUTS', 1.85)],
  [OURS + 'FIXED VOLTAGE (−5…+6), FINE (±1 octave) and PULSE WIDTH (10…90 %, the 901Bs\' width), the three summed CONTROL INPUTS (two over one), in the 921A face\'s order. No front output: it drives up to three 901Bs over the rear link; no range switch (their footages set the range).'],
);

/* ---------------------------------------------------------------- 901B oscillator (1 MU): range, vernier; a row a waveform [fixed · level · variable] */
const Y901B = [124, 146, 168, 190];
const m901b = face('901b', 'the 901B oscillator (1 MU): ours — driven by a 901A; range, vernier, four levels, eight outputs', MU, H5,
  [SEC('osc', '901B OSCILLATOR', 0, MU, H5)],
  [ROT('rg', C1, 45, 18, 180, FEET, 'FREQUENCY RANGE'), KN('vn', C1, 82, 22, 'FREQUENCY'),
    ...WV.flatMap(([p, n], i) => [JK(p, 9, Y901B[i], n + ' OUT', 11), KN('v' + (i + 1), C1, Y901B[i], 14, n + ' LEVEL'), JK('v' + p, 45, Y901B[i], 'VARIABLE ' + n + ' OUT', 11)])],
  [HEAD(C1, 13.2, 'OSCILLATOR', 2.45), TX(C1, 18, 'DRIVEN BY A 901A', 1.4), NUM(C1, 213.4, '901B'), RULE(21.2, 2.6, 51.375),
    TX(C1, 28, 'FREQUENCY RANGE', 1.7), RULE(58.4, 2.6, 51.375),
    DIAL(C1, 82, 21, DV6, 1.8), TX(C1, UP(82, 21, 1.8), 'FREQUENCY', 1.7), RULE(100.4, 2.6, 51.375),
    TX(9, 108, 'FIXED', 1.35), TX(C1, 108, 'LEVEL', 1.35), TX(45, 108, 'VARIABLE', 1.35),
    ...WV.map(([, n], i) => TX(C1, Y901B[i] - 8.6, n, 1.45)),
    TX(C1, 204, 'PULSE WIDTH FROM THE 901A', 1.3)],
  [OURS + 'FREQUENCY RANGE (LO and five footages) and FREQUENCY (a −6…+6 vernier: ±1 octave and a major third) over four rows, one a waveform (sine, sawtooth, triangle, pulse): its fixed output, its LEVEL knob and its variable output. No width knob: the 901A\'s sets it.'],
);

/* ---------------------------------------------------------------- 901C output stage (1 MU): a stand-in */
const m901c = face('901c', 'the 901C output stage (1 MU): an honest stand-in, ours — an amplitude knob and two outputs 180° apart', MU, H5,
  [SEC('out', '901C OUTPUT STAGE', 0, MU, H5)],
  [JK('in', C1, 44, 'INPUT'), KN('am', C1, 98, 28, 'AMPLITUDE', { skin: { capR: 0.78 } }), JK('p', 14, 148, 'OUTPUT +'), JK('n', 40, 148, 'OUTPUT −')],
  [HEAD(C1, 14.35, 'OUTPUT', 2.05), HEAD(C1, 17.25, 'STAGE', 2.05), NUM(C1, 213.4, '901C'), RULE(21.6, 2.6, 51.375),
    TX(C1, 33.6, 'INPUT', 1.85), RULE(58.4, 2.6, 51.375),
    DIAL(C1, 98, 27, D10S, 1.9), TX(C1, UP(98, 27, 1.9), 'AMPLITUDE', 1.85), RULE(124, 2.6, 51.375),
    TX(C1, 131.6, 'OUTPUTS', 1.85), TX(14, 139, '+', 2.6, 600), TX(40, 139, '−', 2.6, 600),
    TX(C1, 164, 'TWO OUTPUTS', 1.4), TX(C1, 167, '180° APART', 1.4),
    RULE(176, 2.6, 51.375), ...PLATE(C1, 184, 46, ['OURS — A STAND-IN', 'FOR ITS OUTPUT STAGE'], 1.4)],
  [OURS + 'an honest stand-in, its plate says so: INPUT, AMPLITUDE (0…10) and two OUTPUTS, + and − (the same signal, 180° apart), in the house style.'],
);

/* ---------------------------------------------------------------- 904C filter coupler (2 MU): mode, centre, bandwidth */
const m904c = face('904c', 'the 904C filter coupler (2 MU): ours — a low pass and a high pass inside the module, a mode switch, centre and bandwidth', W2, H5,
  [SEC('cpl', '904C FILTER COUPLER', 0, W2, H5)],
  [BV('md', 42, 46, 'MODE'), KN('fc', 30, 96, 30, 'CENTER FREQUENCY', { skin: { capR: 0.78 } }), KN('bw', 80, 96, 24, 'BANDWIDTH'),
    JK('c1', 17, 138, 'CENTER FREQUENCY CONTROL 1'), JK('c2', 43, 138, 'CENTER FREQUENCY CONTROL 2'), JK('b1', 80, 138, 'BANDWIDTH CONTROL'),
    JK('in', 22, 180, 'SIGNAL INPUT'), JK('out', 86, 180, 'SIGNAL OUTPUT')],
  [HEAD(W2 / 2, 14.35, 'FILTER COUPLER', 2.45), TX(W2 / 2, 18.8, 'BAND PASS · BAND REJECT', 1.4), NUM(W2 / 2, 213.4, '904C'), RULE(22.4, 2.6, W2 - 2.6),
    TX(42, 31, 'MODE', 1.85), TS(48.6, 41.9, 'BAND REJECT', 1.45), TS(48.6, 46.55, 'OFF', 1.45), TS(48.6, 51.2, 'BAND PASS', 1.45), RULE(62, 2.6, W2 - 2.6),
    DIAL(30, 96, 29, DV6, 1.9), TX(30, UP(96, 29, 1.9), 'CENTER FREQUENCY', 1.75),
    DIAL(80, 96, 23, ['0', '', '1', '', '2', '', '3'], 1.9), TX(80, UP(96, 29, 1.9), 'BANDWIDTH', 1.75), TX(80, 113, 'OCTAVES', 1.35),
    RULE(118.4, 2.6, W2 - 2.6), TX(30, 126.4, 'CENTER FREQUENCY', 1.45), TX(30, 129.4, 'CONTROL', 1.45), TX(80, 126.4, 'BANDWIDTH', 1.45), TX(80, 129.4, 'CONTROL', 1.45),
    RULE(154.4, 2.6, W2 - 2.6), TX(22, 168.4, 'SIGNAL INPUT', 1.75), TX(86, 168.4, 'SIGNAL OUTPUT', 1.75), GL('arrow:right', W2 / 2, 180, 5),
    ...PLATE(W2 / 2, 193, 90, ['OURS — THE LOW PASS AND HIGH PASS', 'PAIR IS INSIDE THE MODULE'], 1.4)],
  [OURS + 'MODE (BAND REJECT / OFF / BAND PASS, a vertical bat switch), CENTER FREQUENCY (−6…+6) and BANDWIDTH (0…3 octaves), then the two CENTER FREQUENCY CONTROL jacks and the BANDWIDTH CONTROL jack, SIGNAL INPUT → SIGNAL OUTPUT. A self-contained module: its plate says the low pass and high pass pair is inside.'],
);

/* ---------------------------------------------------------------- 905 reverberation (2 MU): a stand-in */
// the spring: a posted coil across the panel (one path)
const SPRING = 'M14 120h6l2.3 -6.2' + Array.from({ length: 13 }, (_, i) => 'l4.6 ' + (i % 2 ? '-' : '') + '12.4').join('') + 'l2.3 -6.2h9.55';
const m905 = face('905', 'the 905 spring reverberation (2 MU): an honest stand-in, ours — WET / DRY, one input, one (inverted) output', W2, H5,
  [SEC('rev', '905 SPRING REVERBERATION', 0, W2, H5)],
  [KN('mx', W2 / 2, 64, 32, 'WET / DRY', { skin: { capR: 0.78 } }), JK('in', 26, 172, 'SIGNAL INPUT'), JK('out', 82, 172, 'SIGNAL OUTPUT')],
  [HEAD(W2 / 2, 14.35, 'SPRING', 2.05), HEAD(W2 / 2, 17.25, 'REVERBERATION', 2.05), NUM(W2 / 2, 213.4, '905'), RULE(21.6, 2.6, W2 - 2.6),
    DIAL(W2 / 2, 64, 31, ['DRY', '', '', '', '', '5', '', '', '', '', 'WET'], 1.7), TX(W2 / 2, UP(64, 31, 1.7), 'WET / DRY', 2.1),
    RULE(94.4, 2.6, W2 - 2.6), { t: 'path', d: SPRING, sw: 0.5 }, { t: 'rect', x: 11, y: 112, w: 3, h: 16, fill: '#a3a39e' }, { t: 'rect', x: 93.95, y: 112, w: 3, h: 16, fill: '#a3a39e' },
    TX(W2 / 2, 140, 'SPRING TANK', 1.4), RULE(147.4, 2.6, W2 - 2.6),
    TX(26, 160.6, 'SIGNAL INPUT', 1.75), TX(82, 160.6, 'SIGNAL OUTPUT', 1.75), GL('arrow:right', W2 / 2, 172, 5), TX(82, 186.4, 'INVERTED', 1.4),
    ...PLATE(W2 / 2, 193.6, 90, ['OURS — OUR OWN MODEL', 'OF A SPRING TANK'], 1.4)],
  [OURS + 'an honest stand-in, its plate says so: one WET / DRY knob (0…10), SIGNAL INPUT and SIGNAL OUTPUT (phase-inverted, said under it), a drawn spring. Our model of a tank: no maker is named.'],
);

/* ---------------------------------------------------------------- 912 envelope follower (1 MU): a follower and its comparator */
const m912 = face('912', 'the 912 envelope follower (1 MU): ours — a follower (response, signal in, control out) and a comparator (threshold, trigger out)', MU, H5,
  [SEC('follow', 'FOLLOWER', 0, MU, 96.4), SEC('comp', 'COMPARATOR', 0, MU, H5 - 96.4, 96.4)],
  [JK('in', 14, 42, 'SIGNAL INPUT'), JK('co', 40, 42, 'CONTROL OUTPUT'), BV('rs', 20, 80, 'RESPONSE'),
    KN('th', C1, 126, 24, 'THRESHOLD'), JK('ci', 14, 170, 'COMPARATOR INPUT'), SK('st', 40, 170, 'TRIGGER OUTPUT')],
  [HEAD(C1, 14.35, 'ENVELOPE', 2.05), HEAD(C1, 17.25, 'FOLLOWER', 2.05), NUM(C1, 213.4, '912'), RULE(21.6, 2.6, 51.375),
    TX(14, 31.6, 'SIGNAL INPUT', 1.5), TX(40, 31.6, 'CONTROL OUTPUT', 1.5), TX(C1, 62.4, 'RESPONSE', 1.85), TS(25.6, 75.9, 'SHORT', 1.45), TS(25.6, 80.55, 'MEDIUM', 1.45), TS(25.6, 85.2, 'LONG', 1.45),
    RULE(96.4, 2.6, 51.375), DIAL(C1, 126, 23, D10S, 1.75), TX(C1, UP(126, 23, 1.75), 'THRESHOLD', 1.85), RULE(150.4, 2.6, 51.375),
    TX(14, 159.6, 'COMPARATOR', 1.5), TX(14, 162.4, 'INPUT', 1.5), TX(40, 159.6, 'TRIGGER', 1.5), TX(40, 162.4, 'OUTPUT', 1.5),
    TX(14, 181, 'NORMALLED TO', 1.3), TX(14, 183.8, 'CONTROL OUTPUT', 1.3)],
  [OURS + 'a follower — SIGNAL INPUT, CONTROL OUTPUT and RESPONSE (SHORT / MEDIUM / LONG, a vertical bat switch) — over a comparator: THRESHOLD (0…10), COMPARATOR INPUT (normalled to the CONTROL OUTPUT, said under it) and the TRIGGER OUTPUT as an S-trigger socket, in the house style.'],
);

/* ---------------------------------------------------------------- 984 four-channel mixer (4 MU): a 4 × 4 matrix, a master a bus, bass and treble */
// bus columns x BUSX, input rows y ROWY (jack at the row's head), the masters under the matrix, then the four outputs; BASS / TREBLE (all four buses) right
const BUSX = [58, 90, 122, 154], ROWY = [50, 76, 102, 128], CX4 = W4 / 2;
const m984 = face('984', 'the 984 four-channel mixer (4 MU): ours — a 4 × 4 level matrix, a master a bus, bass and treble; four inputs, four outputs', W4, H5,
  [SEC('mix', '984 FOUR-CHANNEL MIXER', 0, 173.4, H5), SEC('tone', 'TONE', 173.4, W4 - 173.4, H5)],
  [...ROWY.flatMap((y, i) => [JK('i' + (i + 1), 24, y, 'INPUT ' + (i + 1)), ...BUSX.map((x, o) => KN('l' + (i + 1) + (o + 1), x, y, 17, 'INPUT ' + (i + 1) + ' → BUS ' + (o + 1)))]),
    ...BUSX.map((x, o) => KN('m' + (o + 1), x, 168, 20, 'BUS ' + (o + 1) + ' MASTER')), ...BUSX.map((x, o) => JK('o' + (o + 1), x, 196, 'OUTPUT ' + (o + 1))),
    KN('bs', 194, 86, 22, 'BASS'), KN('tb', 194, 148, 22, 'TREBLE')],
  [HEAD(CX4 - 21, 14.6, 'FOUR-CHANNEL MIXER', 2.45), TX(CX4 - 21, 19, '4 INPUTS · 4 BUSES · LEVEL MATRIX', 1.4), NUM(CX4, 213.4, '984'), RULE(22.4, 2.6, W4 - 2.6),
    VRULE(173.4, 22.4, 210.6),
    TX(24, 34.8, 'INPUTS', 1.6), TX((BUSX[0] + BUSX[3]) / 2, 30.4, 'OUTPUT BUSES', 1.5), ...BUSX.map((x, o) => TX(x, 35.8, String(o + 1), 2.1, 700)),
    ...ROWY.flatMap((y, i) => [TX(40, y + 0.8, String(i + 1), 2.2, 700), ...BUSX.map(x => DIAL(x, y, 16, ENDS, 1.4))]),
    RULE(146, 2.6, 171), TX(24, 168.8, 'MASTER', 1.7), ...BUSX.map(x => DIAL(x, 168, 19, ENDS, 1.4)),
    TX(24, 196.8, 'OUTPUTS', 1.7), ...BUSX.map((x, o) => TX(x, 207.4, 'OUT ' + (o + 1), 1.5)),
    TX(194, 36, 'TONE', 1.8, 700), TX(194, 40, 'ALL FOUR BUSES', 1.4), DIAL(194, 86, 21, D10S, 1.6), TX(194, UP(86, 21, 1.6), 'BASS', 1.85),
    DIAL(194, 148, 21, D10S, 1.6), TX(194, UP(148, 21, 1.6), 'TREBLE', 1.85), TX(194, 176, 'FLAT AT 5', 1.4)],
  [OURS + 'four INPUT jacks, each at the head of a row of four LEVEL knobs (one to each bus, 0…10), BUS MASTERs under the matrix, then the four OUTPUT jacks; BASS and TREBLE (flat at 5) one pair for all four buses, at the right. Every knob is lite: 22 knobs and 8 jacks within §3 G6\'s 130 painted.'],
);

/* ---------------------------------------------------------------- 991 filter and attenuator (1 MU): a stand-in */
const m991 = face('991', 'the 991 filter and attenuator (1 MU): an honest stand-in, ours — a low pass, a high pass and an attenuator in one line', MU, H5,
  [SEC('flt', '991 FILTER AND ATTENUATOR', 0, MU, H5)],
  [KN('lp', C1, 46.5, 22, 'LOW PASS'), KN('hp', C1, 89, 22, 'HIGH PASS'), KN('at', C1, 132, 22, 'ATTENUATOR'),
    JK('in', 14, 172, 'SIGNAL INPUT'), JK('out', 40, 172, 'SIGNAL OUTPUT')],
  [HEAD(C1, 14.35, 'FILTER AND', 2.05), HEAD(C1, 17.25, 'ATTENUATOR', 2.05), NUM(C1, 213.4, '991'), RULE(21.6, 2.6, 51.375),
    DIAL(C1, 46.5, 21, ['20', '200', '2K', '20K'], 1.6), TX(C1, UP(46.5, 21, 1.6), 'LOW PASS', 1.85), TX(C1, 60.9, 'HZ', 1.4), RULE(65.4, 2.6, 51.375),
    DIAL(C1, 89, 21, ['10', '100', '1K', '10K'], 1.6), TX(C1, UP(89, 21, 1.6), 'HIGH PASS', 1.85), TX(C1, 103.4, 'HZ', 1.4), RULE(108.4, 2.6, 51.375),
    DIAL(C1, 132, 21, D10S, 1.6), TX(C1, UP(132, 21, 1.6), 'ATTENUATOR', 1.85), RULE(150.4, 2.6, 51.375),
    TX(14, 161.6, 'SIGNAL INPUT', 1.75), TX(40, 161.6, 'SIGNAL OUTPUT', 1.75), RULE(184, 2.6, 51.375),
    ...PLATE(C1, 189, 46, ['OURS — A STAND-IN', 'FOR ITS FILTER', 'AND ATTENUATOR'], 1.4)],
  [OURS + 'an honest stand-in, its plate says so: LOW PASS (20 Hz … 20 kHz), HIGH PASS (10 Hz … 10 kHz) and ATTENUATOR (0…10) in line, SIGNAL INPUT → SIGNAL OUTPUT, in the house style.'],
);

/* ---------------------------------------------------------------- the console panel (142.875 mm tall) */
// CP3 mixer and routing (4 MU; the 901 systems): MIXER (2 MU) · ROUTING (1 MU) · MULTIPLES and TRUNKS (1 MU)
const XM = [18, 42, 66, 90];
const cp3 = face('cp3', 'the CP3 mixer and routing panel (4 MU, console height): ours', W4, HC,
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
    NUM(54, 133, 'CP3'),
    HEAD(134.95, 12.6, 'ROUTING'), RULE(17.6, 110.55, 159.3), TX(122, 31.6, 'KEYBOARD', 1.35), TX(148, 31.6, 'WHEEL', 1.35), TX(122, 57.6, 'PRESSURE', 1.35),
    TX(148, 57.6, 'EXT', 1.35), TX(122, 88.6, 'EXT LEVEL', 1.4), DIAL(122, 100, 15, ENDS, 1.4), TX(148, 95.4, 'EXT IN', 1.4),
    TX(134.95, 121.4, 'TO AN OSCILLATOR', 1.3), TX(134.95, 124.2, 'CONTROL, BEHIND', 1.3),
    HEAD(188.9, 12.6, 'MULTIPLES', 2.2), RULE(17.6, 164.5, 213.3), { t: 'path', d: 'M176 34H202V58H176Z', sw: 0.5 },
    TX(188.9, 81.4, 'TRUNKS', 1.5, 700), TX(188.9, 128.6, 'NOT EMULATED', 1.25)],
  [OURS + 'MIXER (four INPUTS over their LEVELS, MASTER, MIX + / −), ROUTING (KEYBOARD, WHEEL, PRESSURE and EXT as lit push switches — lit = routed behind the panel to the oscillator control of this panel\'s number —, EXT LEVEL over EXT IN), the four MULTIPLES and four TRUNKS (drawn, dimmed: not emulated). The rear terminal is not drawn.'],
);

/** The 1960s extras' faces by module type (moog-core TYPES[t].layout = the type id). */
export const MODULES = Object.freeze({ 901: m901, '901a': m901a, '901b': m901b, '901c': m901c, '904c': m904c, 905: m905, 912: m912, 984: m984, 991: m991, cp3 });
