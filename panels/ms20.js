// panels/ms20.js — the hardware front panel of the Korg MS-20, as layout data for the canvas's fixed-size instrument
// module (docs/canvas/IMPL-panels.md §3 format, §10 acceptance). Owner: the AUTHOR lane of this model (this file only).
// No imports, no DOM, no logos or maker names; the default export is plain data (a few local helpers build the repeated
// legends). Units: mm in the research frame of scratchpad/canvas/panels/research/ms20.json (fact-checked twice; ±2–3 mm):
// the 545 × 185 mm sloped face between the end cheeks. Section titles sit top-left, knob names under the knobs and the
// patch bay keeps its printed signal-flow diagram, as on the hardware; everything we don't emulate is dimmed (inert).
const N10 = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const PM5 = ['-5', '-4', '-3', '-2', '-1', '0', '+1', '+2', '+3', '+4', '+5'];
const SW = 280; // the printed 0–10 dials run from about 7 to 5 o'clock
const DIAL = { n: 11, labels: N10, size: 1.9 };
const LAB = 2.1; // knob names (printed under the knob)
const lab = [];  // the knob names, collected by the helpers below and appended to the decor
const T = (x, y, s, size, more) => Object.assign({ t: 'text', x, y, s, size: size || LAB, anchor: 'middle' }, more || {});
// a knob (live with an id, or inert) and its printed name under it (small 18 mm: +13.6 mm; large 25 mm: +18.6 mm)
const K = (id, x, y, d, name, more) => {
  if (name) lab.push(T(x, y + (d > 20 ? 18.6 : 13.6), name));
  return Object.assign(id ? { id } : { inert: true }, { kind: 'knob', x, y, d, sweep: SW, label: name, lab: 'none', scale: DIAL }, more || {});
};
// an inert patch jack (12 mm chrome nut): its tooltip name; the printed legends are decor
const J = (x, y, name) => ({ kind: 'jack', x, y, d: 12, inert: true, label: name, lab: 'none' });
const S = (x, y, s, size, more) => T(x, y, s, size || 1.85, more);           // a patch-bay legend
const BOX = (x, y, w, h) => ({ t: 'rect', x, y, w, h, stroke: '#d8d8d8', sw: 0.3 }); // a patch-bay module box
const AR = (x, y, dir) => ({ t: 'path', x, y, d: dir === 'u' ? 'M0 0L-0.9 1.8H0.9Z' : dir === 'd' ? 'M0 0L-0.9 -1.8H0.9Z' : dir === 'l' ? 'M0 0L1.8 -0.9V0.9Z' : 'M0 0L-1.8 -0.9V0.9Z', fill: '#d8d8d8' });
const L = (x1, y1, x2, y2) => ({ t: 'line', x1, y1, x2, y2, sw: 0.25, stroke: '#d8d8d8' });
const R = (x1, y1, x2, y2) => ({ t: 'line', x1, y1, x2, y2, sw: 0.4 }); // a section rule

const controls = [
  // VCO 1: WAVE FORM (4-way selector, legends on the upper arc) · PW · SCALE
  { id: 'w1', kind: 'rotary', x: 21.5, y: 32.5, d: 25, sweep: 120, legends: ['wave:tri', 'wave:saw', 'wave:rect', 'wave:noise'], label: 'WAVE FORM', lab: 'none' },
  K('pw1', 23, 76, 18, 'PW', { scale: { n: 11 } }),
  { id: 'sc1', kind: 'rotary', x: 23, y: 113.5, d: 25, sweep: 120, legends: ["32'", "16'", "8'", "4'"], label: 'SCALE', lab: 'none' },
  // VCO 2: WAVE FORM · PITCH (−5…+5 = our ±12 st) · SCALE (our 32′–4′ printed: the panel says what you hear)
  { id: 'w2', kind: 'rotary', x: 63.5, y: 31.5, d: 25, sweep: 120, legends: ['wave:saw', 'wave:sq', 'wave:narrow', 'RING'], label: 'WAVE FORM', lab: 'none' },
  K('pt', 64.5, 75, 18, 'PITCH', { scale: { n: 11, labels: PM5, size: 1.8 } }),
  { id: 'sc2', kind: 'rotary', x: 64.5, y: 112.5, d: 25, sweep: 120, legends: ["32'", "16'", "8'", "4'"], label: 'SCALE', lab: 'none' },
  // VCO MIXER
  K('l1', 105.5, 35, 18, 'VCO 1 LEVEL'),
  K('l2', 105.5, 78.5, 18, 'VCO 2 LEVEL'),
  // HIGHPASS / LOWPASS FILTER: the large CUTOFF FREQUENCY over PEAK
  K('hc', 141.5, 32.5, 25, 'CUTOFF FREQUENCY'),
  K('hpk', 143.5, 78.5, 18, 'PEAK'),
  K('lc', 181, 32.5, 25, 'CUTOFF FREQUENCY'),
  K('lpk', 181.5, 79.5, 18, 'PEAK'),
  // PORTAMENTO · MASTER TUNE (no name under the knob: the section title only)
  K('pr', 21.5, 163, 18, 'TIME'),
  K('mt', 64.5, 162, 18, null, { label: 'MASTER TUNE', scale: { n: 11, labels: PM5, size: 1.8 } }),
  // FREQUENCY MODULATION · the two CUTOFF FREQUENCY MODULATION columns (HPF MG/T.EXT and FM EG1/EXT are not ours)
  K('mp', 105.5, 132, 18, 'MG/T.EXT'),
  K(null, 105.5, 164, 18, 'EG1/EXT'),
  K(null, 143.5, 132, 18, 'MG/T.EXT'),
  K('eh', 143.5, 164, 18, 'EG2/EXT'),
  K('mc', 182, 132, 18, 'MG/T.EXT'),
  K('ec', 182, 164, 18, 'EG2/EXT'),
  // MODULATION GENERATOR: its rate LED, WAVE FORM (a continuous morph on the hardware; ours 3 detents at its printed
  // CCW / 12 o'clock / CW legends: Square · Tri · Saw), FREQUENCY
  { kind: 'lamp', x: 221.5, y: 102, d: 3.5, inert: true, color: '#d8261c', label: 'MG rate LED', lab: 'none' },
  { id: 'mw', kind: 'rotary', x: 220.5, y: 132, d: 18, sweep: 270, map: [2, 0, 1], legends: ['wave:sq', 'wave:tri', 'wave:saw'], label: 'WAVE FORM', lab: 'none', scale: { n: 11 } },
  K('mr', 220.5, 164, 18, 'FREQUENCY'),
  // ENVELOPE GENERATOR 1 (not ours: our EG 2 drives filter and amp, as the hardware's EG 2 does)
  K(null, 259, 101.5, 18, 'DELAY TIME'),
  K(null, 258.5, 132, 18, 'ATTACK TIME'),
  K(null, 258.5, 164, 18, 'RELEASE TIME'),
  { kind: 'lamp', x: 278.5, y: 81.5, d: 3.5, inert: true, color: '#d8261c', label: 'trigger LED', lab: 'none' },
  // ENVELOPE GENERATOR 2: the full-height column
  K(null, 297, 34, 18, 'HOLD TIME'),
  K('a', 298.5, 71.5, 18, 'ATTACK TIME'),
  K('d', 298.5, 101.5, 18, 'DECAY TIME'),
  K('s', 297, 133, 18, 'SUSTAIN LEVEL'),
  K('r', 297, 164.5, 18, 'RELEASE TIME'),
  // the patch panel: VOLUME (it carries the power switch: POWER OFF at its minimum) and 29 jacks, none of them ours
  { id: 'vol', kind: 'knob', x: 494.5, y: 30, d: 25, sweep: SW, label: 'VOLUME', lab: 'none', scale: { n: 10, labels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], size: 1.9 } },
  J(527, 16.5, 'SIGNAL OUT'), J(527, 38.5, 'PHONES'),
  J(335.5, 38.5, 'TOTAL (−5V~+5V)'), J(362, 38.5, 'FREQ (−5V~+5V)'), J(386, 38.5, 'EXT SIGNAL IN'), J(409, 38.5, 'HPF CUTOFF FREQ'),
  J(433.5, 38.5, 'LPF CUTOFF FREQ'), J(460.5, 38.5, 'INITIAL GAIN'),
  J(333.5, 64.5, 'MG OUT (triangle)'), J(375, 64.5, 'MG OUT (pulse)'), J(394.5, 64.5, 'EG 1 OUT'), J(468.5, 64.5, 'EG 2 REV OUT'),
  J(505.5, 64.5, 'VCO 1+2 CV IN'), J(527, 64.5, 'KBD CV OUT'), J(488, 76, 'VCO 2 CV IN'),
  J(355, 88, 'S&H CLOCK'), J(394.5, 88, 'EG 1 REV OUT'), J(414.5, 88, 'VCA CONTROL INPUT'), J(445, 88, 'EG 1 TRIG IN'),
  J(505.5, 88, 'TRIG IN'), J(527, 88, 'KBD TRIG OUT'),
  J(333.5, 107.5, 'S&H IN'), J(375, 107.5, 'S&H OUT'), J(394.5, 107.5, 'VCA IN'), J(425.5, 107.5, 'VCA OUT'), J(445, 107.5, 'NOISE PINK'),
  J(485.5, 107.5, 'NOISE WHITE'), J(505.5, 107.5, 'CONTROL WHEEL OUT'), J(527, 107.5, 'MOMENTARY SW OUT'),
  // the EXTERNAL SIGNAL PROCESSOR: 6 jacks, 2 LEDs, 5 knobs
  J(334, 136, 'ESP SIGNAL IN'), J(377, 136, 'ESP AMP OUT'), J(414.5, 136, 'ESP BAND PASS FILTER OUT'), J(453.5, 136, 'ESP F-V CV OUT'),
  J(505.5, 136, 'ESP ENV OUT'), J(527, 136, 'ESP TRIG OUT'),
  { kind: 'lamp', x: 480.5, y: 124, d: 3.5, inert: true, color: '#d8261c', label: 'ESP PEAK LED', lab: 'none' },
  { kind: 'lamp', x: 524, y: 124, d: 3.5, inert: true, color: '#d8261c', label: 'ESP TRIG LED', lab: 'none' },
  K(null, 338, 164.5, 18, 'SIGNAL LEVEL'), K(null, 368.5, 164.5, 18, 'LOW CUT FREQ'), K(null, 399.5, 164.5, 18, 'HIGH CUT FREQ'),
  K(null, 430, 164.5, 18, 'CV ADJUST'), K(null, 460.5, 164.5, 18, 'THRESHOLD LEVEL'),
];
// the hardware's own legends around the PW knob, in OUR direction (our PW narrows anticlockwise: the hardware's turns the
// other way, so its printed square-at-CCW would lie)
const PWG = [['wave:narrow', -140], ['wave:rect', 0], ['wave:sq', 140]].map(([g, a]) => ({ t: 'glyph', g, x: +(23 + Math.sin(a * Math.PI / 180) * 13.6).toFixed(2), y: +(76 - Math.cos(a * Math.PI / 180) * 13.6).toFixed(2), size: 3.2 }));

const decor = [
  // section rules (thin white lines, as printed)
  R(46, 0, 46, 185), R(0, 136, 87.5, 136), R(87.5, 0, 87.5, 185), R(87.5, 101, 202, 101), R(125, 0, 125, 185), R(163.5, 0, 163.5, 185),
  R(202, 0, 202, 185), R(202, 65.5, 278.5, 65.5), R(240.5, 65.5, 240.5, 185), R(278.5, 0, 278.5, 185), R(316, 0, 316, 185), R(316, 119.5, 545, 119.5),
  // section titles, top-left as printed
  T(2.5, 4.8, 'VOLTAGE CONTROLLED\nOSCILLATOR 1', 2.85, { anchor: 'start', weight: 600 }),
  T(48, 4.8, 'VOLTAGE CONTROLLED\nOSCILLATOR 2', 2.85, { anchor: 'start', weight: 600 }),
  T(93.5, 4.8, 'VCO MIXER', 2.85, { anchor: 'start', weight: 600 }),
  T(126.2, 4.8, 'VOLTAGE CONTROLLED\nHIGHPASS FILTER', 2.7, { anchor: 'start', weight: 600 }),
  T(164.7, 4.8, 'VOLTAGE CONTROLLED\nLOWPASS FILTER', 2.7, { anchor: 'start', weight: 600 }),
  T(209.5, 6.2, 'VOLTAGE CONTROLLED AMPLIFIER', 2.85, { anchor: 'start', weight: 600 }),
  T(23, 142.8, 'PORTAMENTO', 2.4, { weight: 600 }), T(64.5, 142.8, 'MASTER TUNE', 2.4, { weight: 600 }),
  T(106.25, 106.2, 'FREQUENCY\nMODULATION', 2.3, { weight: 600 }),
  T(127, 106.2, 'CUTOFF FREQUENCY\nMODULATION', 2.3, { anchor: 'start', weight: 600 }),
  T(165.5, 106.2, 'CUTOFF FREQUENCY\nMODULATION', 2.3, { anchor: 'start', weight: 600 }),
  T(209.5, 71.4, 'MODULATION\nGENERATOR', 2.6, { anchor: 'start', weight: 600 }),
  T(248, 71.4, 'ENVELOPE\nGENERATOR 1', 2.6, { anchor: 'start', weight: 600 }),
  T(286, 4.8, 'ENVELOPE\nGENERATOR 2', 2.6, { anchor: 'start', weight: 600 }),
  // knob names that are not under a knob helper: the selectors', the VCA diagram
  T(21.5, 51, 'WAVE FORM'), T(23, 132.1, 'SCALE'), T(63.5, 50, 'WAVE FORM'), T(64.5, 131.1, 'SCALE'), T(220.5, 145.6, 'WAVE FORM'),
  ...PWG,
  // the VCA: an amplifier triangle with its control input from below ("EG 2 & EXT"); no controls
  { t: 'path', d: 'M233 28.5L247.5 34.5L233 40.5Z', sw: 0.35, stroke: '#e6e6e6' },
  { t: 'line', x1: 219.5, y1: 34.5, x2: 233, y2: 34.5, sw: 0.35 }, { t: 'line', x1: 247.5, y1: 34.5, x2: 256, y2: 34.5, sw: 0.35 },
  { t: 'line', x1: 240.25, y1: 46, x2: 240.25, y2: 39.2, sw: 0.35 }, { t: 'path', x: 240.25, y: 37.6, d: 'M0 0L-0.9 1.8H0.9Z', fill: '#e6e6e6' },
  T(240.5, 50.4, 'EG 2 & EXT', 1.9),
  // small dark caps beside several knobs (not controls), panel screws
  ...[[37.3, 88.3], [78.7, 89.4], [36.7, 131.4], [79.2, 131.9], [37.3, 173.9], [78.5, 174.8], [129.1, 60], [166.6, 60]]
    .map(([x, y]) => ({ t: 'rect', x: x - 3, y: y - 3, w: 6, h: 6, r: 3, fill: '#070707', stroke: '#3a3a3a', sw: 0.3 })),
  { t: 'screws', pts: [[4.5, 18], [4.5, 160], [539, 23], [539, 172]], d: 3.4 },
  // ---- the patch panel's printed signal flow: VCO 1 → VCO 2 → VCO MIXER → HP → LP → AMPLIFIER → VOLUME → SIGNAL OUT
  BOX(327.5, 6.5, 21.5, 9), S(338.25, 9, 'VOLTAGE\nCONTROLLED\nOSCILLATOR 1', 1.7),
  BOX(354, 6.5, 22, 9), S(365, 9, 'VOLTAGE\nCONTROLLED\nOSCILLATOR 2', 1.7),
  BOX(381.5, 6.5, 11.5, 9), S(387.25, 10, 'VCO\nMIXER', 1.7),
  BOX(399.5, 7.5, 21, 7), S(410, 10.2, 'VOLTAGE\nCONTROLLED\nHP FILTER', 1.55),
  BOX(425.5, 7.5, 21, 7), S(436, 10.2, 'VOLTAGE\nCONTROLLED\nLP FILTER', 1.55),
  BOX(451, 6.5, 20, 9), S(461, 9, 'VOLTAGE\nCONTROLLED\nAMPLIFIER', 1.7),
  L(349, 11, 352.4, 11), AR(354, 11, 'r'), L(376, 11, 379.9, 11), AR(381.5, 11, 'r'), L(393, 11, 397.9, 11), AR(399.5, 11, 'r'),
  L(420.5, 11, 423.9, 11), AR(425.5, 11, 'r'), L(446.5, 11, 449.4, 11), AR(451, 11, 'r'), L(471, 11, 478.4, 11), AR(480, 11, 'r'),
  L(338.25, 6.5, 338.25, 4), L(338.25, 4, 387.25, 4), L(387.25, 4, 387.25, 4.9), AR(387.25, 6.5, 'd'),
  L(506, 16.5, 513.4, 16.5), AR(515, 16.5, 'r'),
  T(494.5, 11.6, 'VOLUME', 2.3, { weight: 600 }), T(494.5, 49.3, 'POWER OFF', 1.9), S(527, 8.9, 'SIGNAL OUT'), S(527, 30.9, 'PHONES'),
  // row 1: external inputs feeding the flow strip (legend above, range below)
  S(335.5, 31.1, 'TOTAL'), S(362, 31.1, 'FREQ'), S(386, 31.1, 'EXT SIGNAL IN'), S(409, 31.1, 'CUTOFF FREQ'), S(433.5, 31.1, 'CUTOFF FREQ'), S(460.5, 31.1, 'INITIAL GAIN'),
  S(335.5, 47.1, '−5V~+5V', 1.5), S(362, 47.1, '−5V~+5V', 1.5), S(386, 47.1, '3VPP MAX', 1.5), S(409, 47.1, '−5V~+5V', 1.5),
  S(433.5, 47.1, '−5V~+5V', 1.5), S(460.5, 47.1, '0V~+5V', 1.5),
  L(362, 29, 362, 22), L(338.25, 22, 365, 22), L(338.25, 22, 338.25, 17.1), AR(338.25, 15.5, 'u'), L(365, 22, 365, 17.1), AR(365, 15.5, 'u'),
  L(386, 29, 386, 22), L(386, 22, 387.25, 22), L(387.25, 22, 387.25, 17.1), AR(387.25, 15.5, 'u'),
  L(409, 29, 409, 16.1), AR(409, 14.5, 'u'), L(433.5, 29, 433.5, 16.1), AR(433.5, 14.5, 'u'), L(460.5, 29, 460.5, 17.1), AR(460.5, 15.5, 'u'),
  // row 2: MODULATION GENERATOR, ENVELOPE GENERATORS 1 and 2
  BOX(344.5, 59.5, 20.5, 10), S(354.75, 63.6, 'MODULATION\nGENERATOR', 1.7),
  BOX(413, 59.5, 19.5, 10), S(422.75, 63.6, 'ENVELOPE\nGENERATOR 1', 1.7),
  BOX(439, 59.5, 19, 10), S(448.5, 63.6, 'ENVELOPE\nGENERATOR 2', 1.7),
  L(339.5, 64.5, 344.5, 64.5), L(365, 64.5, 369, 64.5), L(400.5, 64.5, 413, 64.5), L(458, 64.5, 462.5, 64.5),
  S(333.5, 57.2, 'OUT'), S(375, 57.2, 'OUT  +5V/0V'), S(394.5, 57.2, 'OUT'), S(468.5, 57.2, 'REV OUT'), S(505.5, 55.1, 'VCO 1+2\nCV IN'), S(527, 55.1, 'KBD\nCV OUT'),
  { t: 'glyph', g: 'wave:tri', x: 330, y: 72.6, size: 3 }, S(336.6, 73.3, '±2.5V', 1.45, { anchor: 'start' }),
  { t: 'glyph', g: 'wave:sq', x: 371.5, y: 72.6, size: 3 }, S(377.8, 73.3, '+5V/0V', 1.45, { anchor: 'start' }),
  S(488, 67.3, 'VCO 2\nCV IN'),
  // row 3: CLOCK, EG 1 REV OUT, VCA CONTROL INPUT, EG 1 TRIG IN; the KBD box between TRIG IN and TRIG OUT
  S(355, 80.9, 'CLOCK'), S(394.5, 80.9, 'REV OUT'), S(414.5, 78.8, 'CONTROL\nIN PUT'), S(445, 78.8, 'EG 1\nTRIG IN'), S(505.5, 80.9, 'TRIG IN'), S(527, 80.9, 'TRIG OUT'),
  BOX(512.5, 79.2, 8.6, 4), S(516.8, 82.3, 'KBD', 1.7),
  L(355, 94, 355, 102.5), L(414.5, 94, 414.5, 101.5), L(414.5, 101.5, 409, 101.5), L(409, 101.5, 409, 103.4),
  // row 4: SAMPLE & HOLD, the VCA, NOISE GENERATOR, the wheel and momentary-switch outputs
  BOX(344.5, 102.5, 20.5, 10), S(354.75, 106.6, 'SAMPLE\n& HOLD', 1.7),
  { t: 'path', d: 'M403.5 103L414.5 107.5L403.5 112Z', sw: 0.3, stroke: '#d8d8d8' }, S(407.3, 108.1, 'VCA', 1.5),
  BOX(453.5, 102.5, 20.5, 10), S(463.75, 106.6, 'NOISE\nGENERATOR', 1.7),
  L(339.5, 107.5, 344.5, 107.5), L(365, 107.5, 369, 107.5), L(400.5, 107.5, 403.5, 107.5), L(414.5, 107.5, 419.5, 107.5),
  L(451, 107.5, 453.5, 107.5), L(474, 107.5, 479.5, 107.5),
  S(333.5, 100.4, 'IN'), S(375, 100.4, 'OUT'), S(394.5, 100.4, 'IN'), S(425.5, 100.4, 'OUT'), S(445, 100.4, 'PINK'), S(485.5, 100.4, 'WHITE'),
  { t: 'path', x: 505.5, y: 100.6, d: 'M-2.6 0A2.6 2.6 0 0 1 2.6 0Z', sw: 0.25, stroke: '#d8d8d8' },
  { t: 'path', x: 527, y: 99.4, d: 'M-2 0H2M-1.2 0V1.2H1.2V0M0 1.2V2.2', sw: 0.3, stroke: '#d8d8d8' },
  S(530.5, 116.2, 'GND', 1.4), S(509.2, 116.2, '−5V~+5V', 1.4),
  // the EXTERNAL SIGNAL PROCESSOR
  T(382.7, 123.6, 'EXTERNAL SIGNAL PROCESSOR', 2.4, { weight: 600 }),
  { t: 'path', d: 'M349.5 131.5L360.5 136L349.5 140.5Z', sw: 0.3, stroke: '#d8d8d8' }, S(353.6, 136.6, 'AMP', 1.45),
  BOX(385, 131.5, 20, 9), S(395, 135.4, 'BAND PASS\nFILTER', 1.7),
  BOX(424.5, 131.5, 20, 9), S(434.5, 136.6, 'F-V CONVERTER', 1.6),
  BOX(470.5, 131.5, 20, 9), S(480.5, 135.4, 'ENVELOPE\nFOLLOWER', 1.7),
  L(340, 136, 349.5, 136), L(360.5, 136, 371, 136), L(383, 136, 385, 136), L(405, 136, 408.5, 136), L(420.5, 136, 424.5, 136),
  L(444.5, 136, 447.5, 136), L(355, 140.5, 355, 144.5), L(355, 144.5, 465, 144.5), L(465, 144.5, 465, 136), L(465, 136, 470.5, 136),
  L(490.5, 136, 499.5, 136), L(511.5, 136, 521, 136),
  S(334, 128.7, 'SIGNAL IN'), S(377, 128.7, 'OUT'), S(414.5, 128.7, 'OUT'), S(453.5, 126.6, 'F∝V\nCV OUT'), S(505.5, 128.7, 'ENV OUT'),
  S(527, 128.7, 'TRIG OUT'), S(480.5, 128.4, 'PEAK', 1.6),
  // the model name in plain type where the hardware has its badge
  T(502.5, 172, 'MS-20', 8, { weight: 700, ls: 0.4 }),
];

export default {
  v: 1,
  id: 'ms20',
  hw: 'MS-20 (1978–83 panel): the sloped face between the end cheeks',
  case: '#0b0b0b',
  scheme: {
    panel: '#161616', legend: '#e6e6e6', rule: '#dedede', accent: '#d8261c', font: 'sans',
    knob: { skirt: '#0d0d0d', cap: '#1b1b1b', ptr: '#f2f2f2', ptrStyle: 'line', knurl: true, capR: 0.78 },
    jack: { nut: '#c9c9c6', hole: '#050505' },
  },
  areas: [{ id: 'main', src: [0, 0, 545, 185], at: [0, 0] }],
  sections: [
    { id: 'vco1', label: 'VOLTAGE CONTROLLED OSCILLATOR 1', x: 0, y: 0, w: 46, h: 136, frame: 'none', title: 'none' },
    { id: 'vco2', label: 'VOLTAGE CONTROLLED OSCILLATOR 2', x: 46, y: 0, w: 41.5, h: 136, frame: 'none', title: 'none' },
    { id: 'mixer', label: 'VCO MIXER', x: 87.5, y: 0, w: 37.5, h: 101, frame: 'none', title: 'none' },
    { id: 'hpf', label: 'VOLTAGE CONTROLLED HIGHPASS FILTER', x: 125, y: 0, w: 38.5, h: 101, frame: 'none', title: 'none' },
    { id: 'lpf', label: 'VOLTAGE CONTROLLED LOWPASS FILTER', x: 163.5, y: 0, w: 38.5, h: 101, frame: 'none', title: 'none' },
    { id: 'vca', label: 'VOLTAGE CONTROLLED AMPLIFIER', x: 202, y: 0, w: 76.5, h: 65.5, frame: 'none', title: 'none' },
    { id: 'porta', label: 'PORTAMENTO', x: 0, y: 136, w: 46, h: 49, frame: 'none', title: 'none' },
    { id: 'mtune', label: 'MASTER TUNE', x: 46, y: 136, w: 41.5, h: 49, frame: 'none', title: 'none' },
    { id: 'fm', label: 'FREQUENCY MODULATION', x: 87.5, y: 101, w: 37.5, h: 84, frame: 'none', title: 'none' },
    { id: 'hpfmod', label: 'CUTOFF FREQUENCY MODULATION (HPF)', x: 125, y: 101, w: 38.5, h: 84, frame: 'none', title: 'none' },
    { id: 'lpfmod', label: 'CUTOFF FREQUENCY MODULATION (LPF)', x: 163.5, y: 101, w: 38.5, h: 84, frame: 'none', title: 'none' },
    { id: 'mg', label: 'MODULATION GENERATOR', x: 202, y: 65.5, w: 38.5, h: 119.5, frame: 'none', title: 'none' },
    { id: 'eg1', label: 'ENVELOPE GENERATOR 1', x: 240.5, y: 65.5, w: 38, h: 119.5, frame: 'none', title: 'none' },
    { id: 'eg2', label: 'ENVELOPE GENERATOR 2', x: 278.5, y: 0, w: 37.5, h: 185, frame: 'none', title: 'none' },
    { id: 'patch', label: 'PATCH PANEL', x: 316, y: 0, w: 229, h: 119.5, frame: 'none', title: 'none' },
    { id: 'esp', label: 'EXTERNAL SIGNAL PROCESSOR', x: 316, y: 119.5, w: 229, h: 65.5, frame: 'none', title: 'none' },
  ],
  controls,
  decor: decor.concat(lab),
  extras: { ids: [] },
  notes: [
    'All 25 MS-20 controls have a hardware home: no extras strip (research §Mapping); the caption row only says that dimmed controls are not emulated.',
    'VCO 2 SCALE prints our 32′ 16′ 8′ 4′ (the hardware reads 16′–2′): the panel says what you hear (IMPL-panels §3.4.2).',
    'PW: the hardware narrows the pulse clockwise (square at the CCW end); our pw1 rises clockwise (0.05 → 0.5) and a knob cannot be inverted in format v1, so the end glyphs are printed in our direction (narrow · rect · square). If ENGINE adds knob `invert`, swap them back to the hardware order.',
    'MG WAVE FORM is a continuous morph on the hardware; ours is a 3-way switch drawn as the same small knob with detents at its printed legends: CCW = Square (stand-in for the falling ramp / wide pulse), 12 o\'clock = Tri, CW = Saw (our rising ramp): map [2, 0, 1].',
    'Inert (dimmed, "not emulated"): FM EG1/EXT, HPF MG/T.EXT, EG 1 (3 knobs), EG 2 HOLD, the MG rate and trigger LEDs, all 29 patch jacks, SIGNAL OUT / PHONES, the ESP (6 jacks, 2 LEDs, 5 knobs). No cables.',
    'VCA triangle measured on Korg_MS-20.jpg at ≈ 240 mm (the research note said 226.5): drawn where the photo shows it.',
    'Knob names are decor text (lab: none) so they sit as close under the knob as printed; a renderer label would collide with the next knob\'s dial in the EG 2 column.',
  ],
};
