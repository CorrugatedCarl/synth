// panels/tb303.js — the hardware front panel of the TB-303 Bass Line, as layout data for the canvas's fixed-size instrument
// module (docs/canvas/IMPL-panels.md §3 format, §6.2 step entry, §10 acceptance). Owner: the AUTHOR lane of this model.
// No imports, no DOM, no logos or maker names; the default export is plain data (a few local helpers build the repeated
// legends). Units: mm in the research frame of scratchpad/canvas/panels/research/tb303.json (fact-checked twice; ±1.5 mm):
// the whole 300 × 143 mm top of the box. Three bands, as on the hardware: the rear-connector legends and the six filter
// knobs; TEMPO · TRACK/PATT.GROUP · MODE · VOLUME; the programming section with its printed one-octave keyboard.
const KEY = 1.85;   // small legends
const T = (x, y, s, size, more) => Object.assign({ t: 'text', x, y, s, size: size || 2.2, anchor: 'middle', weight: 700 }, more || {});
const W = (x, y, s, size, more) => T(x, y, s, size, Object.assign({ fill: '#f4f4f2' }, more || {}));   // white on black
const RED = (x, y, s, size) => T(x, y, s, size, { fill: '#e0461f' });                                  // the red-orange print
const BLK = (x, y, w, h, r) => ({ t: 'rect', x, y, w, h, r: r || 0.5, fill: '#141414' });
const LINE = (x1, y1, x2, y2, stroke, sw) => ({ t: 'line', x1, y1, x2, y2, stroke: stroke || '#3a3a3a', sw: sw || 0.3 });
const BOXL = (x, y, w, h) => ({ t: 'rect', x, y, w, h, r: 0.6, stroke: '#3a3a3a', sw: 0.3 });           // a ruled sub-panel
const UP = (x, y) => ({ t: 'path', x, y, d: 'M0 -0.9L1 0.9H-1Z', fill: '#151515' });                  // ▲ rear-connector arrow
// a selector's number box (white on black)
const NUM = (x, y, s, w) => [BLK(x - (w || 3.4) / 2, y - 1.7, w || 3.4, 3.4, 0.3), W(x, y + 0.75, s, 2.1)];

const WHITE = [[0, 74, 'C'], [2, 90, 'D'], [4, 106.5, 'E'], [5, 122.5, 'F'], [7, 139.5, 'G'], [9, 155.5, 'A'], [11, 171.5, 'B'], [12, 188, 'C']];
const BLACK = [[1, 82, 'C♯'], [3, 98.5, 'D♯'], [6, 131, 'F♯'], [8, 147.5, 'G♯'], [10, 163.5, 'A♯']];
const KNOBS = [['tu', 88.5, 'TUNING'], ['cf', 111, 'CUT OFF FREQ'], ['rs', 133, 'RESONANCE'], ['em', 155, 'ENV MOD'], ['dc', 177, 'DECAY'], ['ac', 199.5, 'ACCENT']];
// the two selectors: a chrome ring round a silver cap with a bar grip across it (drawn as a long pointer to the hub)
const SEL = { skirt: '#a9abab', cap: '#7f8181', ptr: '#5b5d5d', capR: 0.18 };
const STEPCOL = [['seq:down', 205, 'DOWN'], ['seq:up', 221.5, 'UP'], ['seq:accent', 237.5, 'ACCENT'], ['seq:slide', 254, 'SLIDE']];

const controls = [
  // the top strip: WAVEFORM (the real 2-way switch is on the rear edge, behind its printed legend: drawn here, under it)
  { id: 'wf', kind: 'switch', style: 'slide', orient: 'h', x: 34.5, y: 15.6, w: 10, h: 5, color: '#d6d8d8', label: 'WAVEFORM', lab: 'none' },
  ...KNOBS.map(([id, x, name]) => ({ id, kind: 'knob', x, y: 18, d: 15.5, sweep: 270, label: name, lab: 'none', scale: { n: 11 } })),
  // the middle strip: TEMPO (the pattern's tempo) · TRACK/PATT.GROUP and MODE (not ours) · VOLUME
  { id: 'seq:tempo', kind: 'knob', x: 43.5, y: 55, d: 23, sweep: 270, label: 'TEMPO', lab: 'none' },
  { kind: 'rotary', x: 87.5, y: 55, d: 23, sweep: 270, p: 0.18, inert: true, label: 'TRACK / PATT.GROUP', lab: 'none', skin: SEL },
  { kind: 'rotary', x: 133.5, y: 55, d: 23, sweep: 270, p: 0.87, inert: true, label: 'MODE', lab: 'none', skin: SEL },
  { id: 'vol', kind: 'knob', x: 260, y: 55, d: 23, sweep: 270, label: 'VOLUME', lab: 'none' },
  // the programming section: PATTERN CLEAR, the RUN lamp and RUN/STOP
  { id: 'seq:clear', kind: 'button', x: 20.5, y: 94, w: 12.2, h: 6, led: 'none', hit: [15, 14], label: 'PATTERN CLEAR', lab: 'none' },
  { id: 'seq:runLed', kind: 'led', x: 20.5, y: 104.3, d: 3, color: '#ff2b16' },
  { id: 'seq:run', kind: 'button', x: 20.5, y: 114.2, w: 18.3, h: 11.8, led: 'none', hit: [18.3, 15], label: 'RUN/STOP', lab: 'none' },
  // PITCH MODE (its LED above it) and FUNCTION (not ours: track / bar functions)
  { id: 'seq:pitch', kind: 'button', x: 50, y: 94.1, w: 11.8, h: 5.9, led: 'above', hit: [15, 14], label: 'PITCH MODE', lab: 'none' },
  { kind: 'button', x: 44, y: 114.4, w: 6, h: 12, inert: true, label: 'FUNCTION', lab: 'none' },
  { kind: 'lamp', x: 59.5, y: 104.2, d: 3, inert: true, color: '#ff2b16', label: 'FUNCTION LED', lab: 'none' },
  // the printed one-octave keyboard: each key's whole printed cell is its press area (black-key cells 15 mm wide)
  ...WHITE.map(([note, x, n]) => ({ id: 'seq:key', kind: 'button', note, x, y: 114.4, w: 6.6, h: 12.1, led: 'above', hit: [15.5, 25], label: n, lab: 'none' })),
  ...BLACK.map(([note, x, n]) => ({ id: 'seq:key', kind: 'button', note, x, y: 94.5, w: 5.8, h: 11.6, led: 'above', hit: [15, 14], label: n, lab: 'none' })),
  // TIME MODE (the hardware's LED sits in the header at x 230; ours is above the button), TRANSPOSE DOWN / UP, ACCENT, SLIDE
  { id: 'seq:time', kind: 'button', x: 253.8, y: 90, w: 12.5, h: 5.8, led: 'above', hit: [15, 14], label: 'TIME MODE', lab: 'none' },
  ...STEPCOL.map(([id, x, n]) => ({ id, kind: 'button', x, y: 114.4, w: 6.6, h: 12.1, led: 'above', hit: [15.5, 25], label: n, lab: 'none' })),
  // BACK and WRITE/NEXT (TAP)
  { id: 'seq:back', kind: 'button', x: 278.5, y: 94.1, w: 12.6, h: 6.2, led: 'none', hit: [15, 14], label: 'BACK', lab: 'none' },
  { id: 'seq:next', kind: 'button', x: 278.5, y: 114.2, w: 18.7, h: 12, led: 'none', hit: [18.7, 15], label: 'WRITE/NEXT', lab: 'none' },
];

const decor = [
  // the bands: a pressed groove under the knob strip; the programming section's raised frame and its ruled sub-panels
  LINE(1, 28.6, 299, 28.6, '#8b8d8d', 0.5), LINE(1, 29.2, 299, 29.2, '#e6e7e6', 0.4),
  { t: 'rect', x: 0.8, y: 72.8, w: 298.4, h: 67.6, r: 1.4, fill: '#d3d5d4', stroke: '#8b8d8d', sw: 0.35 },
  { t: 'rect', x: 4.4, y: 77.2, w: 291.2, h: 58.6, r: 0.6, fill: '#cfd1d0', stroke: '#2e2e2e', sw: 0.35 },
  BOXL(5.9, 78.5, 28.7, 21.8), BOXL(5.9, 101.2, 28.7, 34), BOXL(35.6, 101.2, 28.7, 34),
  BOXL(199, 78.5, 62.7, 15.8), BOXL(197.4, 100.3, 64.3, 35), BOXL(264.6, 78.5, 29.6, 21.8), BOXL(264.6, 101.2, 29.6, 34),
  // the keyboard: white-key cells, the black band of note names, black-key blocks (DEL / INS printed on the first two)
  { t: 'rect', x: 64.4, y: 78.5, w: 133, h: 43.8, fill: '#dcdddb', stroke: '#2e2e2e', sw: 0.3 },
  BLK(35.6, 78.5, 28.8, 21.8, 0.6), BLK(64.4, 78.5, 133, 4.4, 0),
  ...BLACK.map(([, x]) => BLK(x - 4.6, 82.4, 9.2, 23.4, 0.7)),
  LINE(114.5, 82.8, 114.5, 122.3, '#4a4a4a'), LINE(179.75, 82.8, 179.75, 122.3, '#4a4a4a'),
  ...[82, 98.25, 131, 147.5, 163.5].map(x => LINE(x, 105.8, x, 122.3, '#4a4a4a')),
  ...WHITE.concat(BLACK).map(([, x, n]) => W(x, 81.75, n, 2.2)),
  W(82, 104.9, 'DEL', 2.1), W(98.5, 104.9, 'INS', 2.1),
  // PATTERN 1–8 in red on the black strip under the white keys (it reaches into the FUNCTION box)
  { t: 'path', d: 'M52 118.4C52 116 53.6 114.4 56 114.4H64.4V122.3H197.4V129.6H52Z', fill: '#141414' },
  RED(60.6, 126.7, 'PATTERN', 2.2), ...WHITE.map(([, x], i) => RED(x, 126.9, String(i + 1), 2.6)),
  // the SELECTOR row along the bottom edge
  T(58.5, 133.5, 'SELECTOR', 2.5, { weight: 500 }),
  ...WHITE.flatMap(([, x], i) => NUM(x, 132.4, String(i + 1))), ...NUM(82, 132.4, 'DEL', 6.4), ...NUM(98.5, 132.4, 'INS', 6.4),
  ...NUM(205, 132.4, '9'), ...NUM(221.5, 132.4, '0'), ...NUM(237.5, 132.4, '100', 6.4), ...NUM(254, 132.4, '200', 6.4),
  // D.C. / BAR RESET / PATTERN CLEAR; RUN ● BATTERY, RUN/STOP
  BOXL(7.2, 80, 7.4, 3.8), T(10.9, 82.85, 'D.C.', 2.1, { weight: 600 }), BOXL(15.2, 80, 18.2, 3.8), T(24.3, 82.85, 'BAR RESET', 2, { weight: 500 }),
  T(20.4, 88.7, 'PATTERN CLEAR', 2.2, { weight: 500 }),
  T(18.4, 105, 'RUN', KEY, { anchor: 'end', weight: 500 }), T(22.6, 105, 'BATTERY', KEY, { anchor: 'start', weight: 500 }),
  T(20.4, 126.4, 'RUN/STOP', 2.2, { weight: 500 }),
  // PITCH MODE (white on black), FUNCTION · NORMAL MODE · BAR
  W(50, 82.6, 'PITCH MODE', 2.8),
  T(46.4, 105.3, 'FUNCTION', 2.7, { weight: 500 }), T(56.6, 109.4, 'NORMAL', KEY, { weight: 500 }), T(56.6, 111.7, 'MODE', KEY, { weight: 500 }),
  BLK(40.1, 123.6, 7.8, 3.6, 0.3), W(44, 126.5, 'BAR', 2.1),
  // TIME MODE: the note · tie · rest marks over DOWN · UP · ACCENT; the TRANSPOSE / ACCENT / SLIDE header
  T(230.1, 82, 'TIME MODE', 2.5, { weight: 500 }),
  LINE(213.25, 87, 213.25, 93.6), LINE(229.5, 87, 229.5, 93.6), LINE(245.75, 87, 245.75, 93.6),
  T(205, 91.6, '● ♪', 2.6, { weight: 400 }), T(221.5, 91.6, '○ ♪', 2.6, { weight: 400 }), T(236.4, 91.6, '—', 2.6, { weight: 400 }),
  { t: 'path', x: 239.6, y: 90.5, d: 'M-0.55 -0.75A0.42 0.42 0 1 0 -0.54 -0.74M-0.3 -0.45Q0.3 -0.4 0.75 -1.05L-0.2 1.5', stroke: '#151515', sw: 0.3 },
  BLK(197.4, 94.3, 64.3, 6, 0),
  W(213.25, 96.55, 'TRANSPOSE', 2), LINE(199.2, 97.2, 227.3, 97.2, '#e8e8e8', 0.25), W(205, 99.75, 'DOWN', 2), W(221.5, 99.75, 'UP', 2),
  W(237.5, 98.5, 'ACCENT', 2.3), W(254, 98.5, 'SLIDE', 2.3),
  LINE(213.25, 97.2, 213.25, 100.3, '#e8e8e8', 0.25), LINE(229.5, 94.3, 229.5, 100.3, '#e8e8e8', 0.25), LINE(245.75, 94.3, 245.75, 100.3, '#e8e8e8', 0.25),
  LINE(213.25, 100.3, 213.25, 122.3, '#4a4a4a'), LINE(229.5, 100.3, 229.5, 122.3, '#4a4a4a'), LINE(245.75, 100.3, 245.75, 122.3, '#4a4a4a'),
  T(205, 126.5, 'STEP', 2.1, { weight: 500 }), T(221.5, 125.8, '♪♪♪', 2.6, { weight: 400 }), T(221.5, 128.4, '└ 3 ┘', 1.6, { weight: 400 }),
  { t: 'path', d: 'M229.5 122.3H261.7V128.7H231C230 128.7 229.5 128.2 229.5 127.2Z', fill: '#141414' },
  RED(237.5, 124.6, 'A', 1.9), RED(254, 124.6, 'B', 1.9), LINE(230.5, 125.25, 261, 125.25, '#e0461f', 0.25), RED(245.6, 127.9, 'PATT. SECTION', 1.9),
  // BACK (under the segno mark), D.S. · WRITE/NEXT · TAP
  BOXL(276.3, 80, 4.4, 3.8),
  { t: 'path', x: 278.5, y: 81.9, d: 'M0.75 -1.2C0.1 -1.65 -0.95 -1.3 -0.75 -0.55S0.95 0.35 0.75 1.05S-0.25 1.65 -0.85 1.15M-1.15 1.4L1.15 -1.4', stroke: '#151515', sw: 0.22 },
  T(278.5, 88.3, 'BACK', 2.3, { weight: 500 }),
  BOXL(275, 102.6, 7, 3.6), T(278.5, 105.3, 'D.S.', 2, { weight: 600 }),
  BOXL(270.6, 123.4, 15.8, 3.9), T(278.5, 126.3, 'WRITE/NEXT', 2, { weight: 500 }), T(278.5, 132.6, 'TAP', 2, { weight: 500 }),
  // ---- the top strip: rear-connector legends (each ▲ points at its jack or switch on the rear edge)
  UP(14, 6.2), T(14, 9.9, 'MIX IN', KEY),
  { t: 'glyph', g: 'wave:saw', x: 31.1, y: 6.2, size: 2.6 }, UP(34.5, 6.2), { t: 'glyph', g: 'wave:sq', x: 37.9, y: 6.2, size: 2.6 }, T(34.5, 9.9, 'WAVEFORM', KEY),
  { t: 'glyph', g: 'wave:saw', x: 26.4, y: 15.6, size: 2.6 }, { t: 'glyph', g: 'wave:sq', x: 42.6, y: 15.6, size: 2.6 },
  UP(59.5, 6.2), T(59.5, 9.9, 'SYNC IN', KEY),
  LINE(75.5, 4.5, 75.5, 27, '#2b2b2b', 0.4), LINE(213.5, 4.5, 213.5, 27, '#2b2b2b', 0.4),
  ...KNOBS.flatMap(([, x, name]) => [T(x, 6.6, name, 2.05), { t: 'rect', x: x - 0.65, y: 8.4, w: 1.3, h: 1.3, fill: '#151515' }]),
  ...[[218.5, 'CV'], [231.5, 'GATE'], [246.5, 'HEADPHONE'], [264.5, 'OUTPUT'], [285.5, 'DC 9V']].flatMap(([x, s]) => [UP(x, 6.2), T(x, 9.9, s, KEY)]),
  T(254.5, 22.4, 'Bass Line', 7.4, { weight: 600, ls: 0.25 }),
  // ---- the middle strip
  T(43.5, 36, 'TEMPO', 2.6), { t: 'scale', x: 43.5, y: 55, d: 27, sweep: 270, n: 11 },
  T(31.4, 69.4, 'SLOW', KEY, { anchor: 'end' }), T(55.6, 69.4, 'FAST', KEY, { anchor: 'start' }),
  // TRACK / PATT.GROUP: track numbers 1–7 in boxes, bracketed into pattern groups I–IV
  BLK(71.4, 33.6, 10, 3.5, 0.3), W(76.4, 36.25, 'TRACK', 2.2), T(83, 36.25, 'PATT.GROUP', 2.6, { anchor: 'start' }),
  ...[[71.5, 58], [71.5, 51.3], [74.8, 45.2], [81.2, 40.4], [94.8, 40.4], [100.2, 45.2], [103.7, 51.3]].flatMap(([x, y], i) => NUM(x, y, String(i + 1), 3.2)),
  { t: 'path', d: 'M69.9 51.3H69V58H69.9', stroke: '#151515', sw: 0.3 }, T(67.6, 55.4, 'I', 2.2, { font: 'sans' }),
  { t: 'path', d: 'M73.2 45.2H72.3V40.4H74.2M77.9 40.4H79.6', stroke: '#151515', sw: 0.3 }, T(76.05, 41.2, 'II', 2.2),
  { t: 'path', d: 'M96.4 40.4H98.1M102.6 40.4H103.6V45.2H101.8', stroke: '#151515', sw: 0.3 }, T(100.35, 41.2, 'III', 2.2),
  T(106.8, 55.7, 'IV', 2.2),
  // MODE: TRACK WRITE / PLAY (reversed out), PATTERN PLAY / WRITE
  T(133.5, 36, 'MODE', 2.6),
  ...[[45.2, 'WRITE', 1], [51.3, 'PLAY', 1], [58.4, 'PLAY', 0], [64.4, 'WRITE', 0]].flatMap(([y, s, rev]) => [
    { t: 'rect', x: 144.1, y: y - 0.45, w: 0.9, h: 0.9, r: 0.45, fill: '#151515' },
    ...(rev ? [BLK(145.6, y - 1.7, s.length * 1.55 + 1.4, 3.4, 0.3), W(146.3, y + 0.75, s, 2, { anchor: 'start' })] : [T(146.3, y + 0.75, s, 2, { anchor: 'start', weight: 500 })]),
  ]),
  { t: 'path', d: 'M154.2 45.2H156V51.3H154.2M156 48.25H158.2M154.2 58.4H156V64.4H154.2M156 61.4H158.2', stroke: '#151515', sw: 0.3 },
  BLK(158.2, 46.5, 10.6, 3.5, 0.3), W(163.5, 49.1, 'TRACK', 2.1), T(158.6, 62.2, 'PATTERN', 2.1, { anchor: 'start' }),
  // the model text (plain type) and VOLUME (it carries the power switch)
  T(204, 52.2, 'TB-303', 6.2, { weight: 500, ls: 0.3 }), LINE(181, 54.6, 228, 54.6, '#151515', 0.35), T(204, 59.4, 'Computer Controlled', 4.2, { weight: 400 }),
  T(260, 36, 'VOLUME', 2.6), { t: 'scale', x: 260, y: 55, d: 27, sweep: 270, n: 11 },
  T(247.8, 69.4, 'POWER SW OFF', KEY, { anchor: 'end', weight: 600 }), T(272.2, 69.4, 'MAX', KEY, { anchor: 'start' }),
];

export default {
  v: 1,
  id: 'tb303',
  hw: 'TB-303 Bass Line (1981): the whole top face',
  case: '#1b1c1c',
  scheme: {
    panel: '#c6c8c7', legend: '#151515', rule: '#2b2b2b', accent: '#e0461f', font: 'rounded',
    knob: { skirt: '#2f3132', cap: '#d3d5d5', ptr: '#262626', ptrStyle: 'line', knurl: true, capR: 0.8 },
    button: { cap: '#d6d8d6', led: '#ff2b16', ledOff: '#55170f', text: '#151515' },
  },
  areas: [{ id: 'main', src: [0, 0, 300, 143], at: [0, 0], r: 2 }],
  sections: [
    { id: 'top', label: 'REAR LEGENDS · FILTER KNOBS', x: 0, y: 0, w: 300, h: 29, frame: 'none', title: 'none' },
    { id: 'mid', label: 'TEMPO · TRACK/PATT.GROUP · MODE · VOLUME', x: 0, y: 29, w: 300, h: 43.8, frame: 'none', title: 'none' },
    { id: 'keys', label: 'PROGRAMMING SECTION', x: 0, y: 72.8, w: 300, h: 70.2, frame: 'none', title: 'none' },
  ],
  controls,
  decor,
  extras: { ids: ['al', 'seq:sync', 'seq:swing', 'seq:random', 'seq:demo', 'seq:toRoll', 'seq:grid'] },
  notes: [
    'TEMPO, RUN/STOP (#seqrun), PATTERN CLEAR, PITCH / TIME MODE, the 13 keys, DOWN / UP / ACCENT / SLIDE and BACK / WRITE-NEXT drive the track\'s 303 pattern through api.seq (IMPL-panels §6.2); the 16-step grid and our other sequencer controls sit in the extras strip with Accent Latch (al).',
    'WAVEFORM (wf) is a slide switch on the rear edge of the real unit, behind its printed "saw ▲ square" legend; it is drawn as a small slide switch under that legend (saw = left, square = right), so the panel stays complete without drawing the rear.',
    'Key press areas are the printed key cells (white 15.5 × 25 mm, black 15 × 14 mm) so the 6.6 mm caps stay playable; they never overlap.',
    'TIME MODE: the hardware\'s LED sits in its header at x 230 mm; the renderer lights a button\'s own LED, so ours is just above the TIME MODE button (a seq:timeLed token would allow the real spot).',
    'Inert (dimmed, "not emulated"): TRACK / PATT.GROUP and MODE selectors, FUNCTION and its LED. Rear-connector legends are print only.',
    'Face cropped to the 143 mm the photos measure (the remaining 3 mm of the 146 mm box are its rounded edge).',
  ],
};
