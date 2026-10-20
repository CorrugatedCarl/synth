// panels/minimoog.js — the hardware front panel of the Minimoog Model D, as layout data for the canvas's fixed-size instrument
// module (docs/canvas/IMPL-panels.md §3 format, §10 acceptance). Owner: the ENGINE lane wrote this one as the reference
// layout (IMPL-panels §11 E2); data only: no imports, no functions, no DOM, no logos or maker names. Units: mm in the
// research frame of scratchpad/canvas/panels/research/minimoog.json (fact-checked twice; ±2 mm): the 689 × 176.2 mm face,
// and the left-hand controller plate below it (an aux area, R3: only its GLIDE / DECAY rows; the wheels are the keyboard
// tray's). Printed legends sit above their controls as on the hardware; dial numbers follow the printed dials.
// (1i, IMPL-1i §1.2) The left-hand controller plate full depth (offset −7.8 kept) with the PITCH and MOD wheels live in
// front of its rockers, and the 44-key bed (F1–C5, MIDI 29–72) right of it, in the keybed row below the panel.
const N10 = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const TIME = ['10', '200', '600', '1', '5', '10']; // the contour dials: 10 / 200 / 600 M-SEC · 1 / 5 / 10 SEC
const RANGE = ['LO', "32'", "16'", "8'", "4'", "2'"];
const WAVE = ['wave:tri', 'wave:trisaw', 'wave:saw', 'wave:sq', 'wave:rect', 'wave:narrow'];
const FREQ = ['-7', '-6', '-5', '-4', '-3', '-2', '-1', '0', '1', '2', '3', '4', '5', '6', '7'];

export default {
  v: 1,
  id: 'minimoog',
  hw: 'Minimoog Model D (1970–81 panel) + the left-hand controller plate and the 44-key bed',
  case: 'wood',
  scheme: {
    panel: '#141414', legend: '#f2efe6', rule: '#e9e6dc', accent: '#e8321a', wood: '#5a3218', font: 'sans',
    knob: { skirt: '#121212', cap: '#b9b9b6', ptr: '#f6f4ee', ptrStyle: 'line', knurl: true, capR: 0.56 },
    rocker: { blue: '#4585b5', orange: '#e8321a', cream: '#e9e1c8', black: '#1b1b1b' },
    jack: { nut: '#c9c9c4', hole: '#060606' },
    keys: { white: '#f2efe4', whiteEdge: '#c4bfb0', black: '#131313', blackTop: '#2b2b2b', gap: '#060606' },
    wheel: { slot: '#050505', surface: '#1a1a1a', ridge: '#2e2e2e', mark: '#e9e1c8' },
  },
  areas: [
    { id: 'main', src: [0, 0, 689, 176.2], at: [0, 0], frame: 'metal' },
    // (1i) the keybed row (y 192–342, offset −7.8): the left-hand controller plate full depth (x 0–98.7, the CONTROLLERS
    // section's width) and the bed (x 98.7–696.7: 26 whites × 23 mm, 7.7 mm past the panel's right edge, inside the cheeks)
    { id: 'lefthand', src: [0, 192, 98.7, 150], at: [0, 184.2], fill: '#111111', frame: 'line' },
    { id: 'keys', src: [98.7, 192, 598, 150], at: [98.7, 184.2], fill: '#0a0a0a' },
  ],
  sections: [
    { id: 'controllers', label: 'CONTROLLERS', x: 0, y: 0, w: 98.7, h: 176.2, frame: 'none', title: 'none' },
    { id: 'oscbank', label: 'OSCILLATOR BANK', x: 98.7, y: 0, w: 149.8, h: 176.2, frame: 'none', title: 'none' },
    { id: 'mixer', label: 'MIXER', x: 248.5, y: 0, w: 174.9, h: 176.2, frame: 'none', title: 'none' },
    { id: 'modifiers', label: 'MODIFIERS', x: 423.4, y: 0, w: 148.7, h: 176.2, frame: 'none', title: 'none' },
    { id: 'output', label: 'OUTPUT', x: 572.1, y: 0, w: 83.6, h: 176.2, frame: 'none', title: 'none' },
    { id: 'power', label: 'POWER', x: 655.7, y: 0, w: 33.3, h: 176.2, frame: 'none', title: 'none' },
    { id: 'lefthand', label: 'LEFT-HAND CONTROLLER', a: 'lefthand', x: 0, y: 192, w: 98.7, h: 150, frame: 'none', title: 'none' },
    { id: 'keys', label: 'KEYBOARD', a: 'keys', x: 98.7, y: 192, w: 598, h: 150, frame: 'none', title: 'none' },
  ],
  controls: [
    // CONTROLLERS: TUNE alone on top, GLIDE and MODULATION MIX below; the OSCILLATOR MODULATION rocker straddles the rule
    { id: 'tune', kind: 'knob', x: 51.6, y: 60.5, d: 27, sweep: 300, label: 'TUNE', scale: { n: 9, labels: ['-2', '', '-1', '', '0', '', '+1', '', '+2'] } },
    { id: 'gl', kind: 'knob', x: 28.6, y: 106.6, d: 27, sweep: 300, label: 'GLIDE', scale: { n: 11, labels: N10 } },
    { id: 'mm', kind: 'knob', x: 73.6, y: 108, d: 27, sweep: 300, label: 'MODULATION\nMIX', scale: { n: 11, labels: N10 } },
    { id: 'om', kind: 'switch', style: 'rocker', orient: 'h', x: 99, y: 62, w: 24, h: 11, color: 'orange', label: 'OSCILLATOR\nMODULATION', sec: 'controllers' },
    // OSCILLATOR BANK: RANGE · FREQUENCY · WAVEFORM for oscillators 1–3 (no osc-1 FREQUENCY knob: its header only)
    { id: 'r1', kind: 'rotary', x: 137.1, y: 37.5, d: 27, sweep: 150, legends: RANGE, label: 'RANGE', skin: { ptrStyle: 'fin' } },
    { id: 'w1', kind: 'rotary', x: 226.2, y: 37.2, d: 27, sweep: 150, legends: WAVE, label: 'WAVEFORM', skin: { ptrStyle: 'fin' } },
    { id: 'r2', kind: 'rotary', x: 137.3, y: 83.6, d: 27, sweep: 150, legends: RANGE, label: 'RANGE', skin: { ptrStyle: 'fin' } },
    { id: 'f2', kind: 'knob', x: 182.3, y: 86.9, d: 32, sweep: 300, label: 'OSCILLATOR-2', scale: { n: 15, labels: FREQ }, skin: { capR: 0.69 } },
    { id: 'w2', kind: 'rotary', x: 226.6, y: 83.6, d: 27, sweep: 150, legends: WAVE, label: 'WAVEFORM', skin: { ptrStyle: 'fin' } },
    { id: 'r3', kind: 'rotary', x: 137.3, y: 129.9, d: 27, sweep: 150, legends: RANGE, label: 'RANGE', skin: { ptrStyle: 'fin' } },
    { id: 'f3', kind: 'knob', x: 181.2, y: 131, d: 32, sweep: 300, label: 'OSCILLATOR-3', scale: { n: 15, labels: FREQ }, skin: { capR: 0.69 } },
    { id: 'w3', kind: 'rotary', x: 225.7, y: 128.8, d: 27, sweep: 150, legends: ['wave:tri', 'wave:rsaw', 'wave:saw', 'wave:sq', 'wave:rect', 'wave:narrow'], label: 'WAVEFORM', skin: { ptrStyle: 'fin' } },
    { id: 'o3k', kind: 'switch', style: 'rocker', orient: 'v', x: 108.4, y: 131.8, w: 11, h: 24, color: 'orange', label: 'OSC. 3\nCONTROL' },
    // MIXER: the zig-zag — osc volumes on the left, the column of five blue ON rockers, EXTERNAL INPUT and NOISE on the right
    { id: 'v1', kind: 'knob', x: 270.5, y: 37.7, d: 27, sweep: 300, label: 'OSC. 1', scale: { n: 11, labels: N10 } },
    { id: 'm1', kind: 'switch', style: 'rocker', orient: 'h', x: 316.7, y: 39.1, w: 24, h: 11, color: 'blue', label: 'ON', lab: 'e' },
    { id: 'ext', kind: 'knob', x: 359.3, y: 61.6, d: 27, sweep: 300, label: 'EXTERNAL\nINPUT VOLUME', scale: { n: 11, labels: N10 } },
    { id: 'me', kind: 'switch', style: 'rocker', orient: 'h', x: 317, y: 62.2, w: 24, h: 11, color: 'blue', label: 'ON', lab: 'e' },
    { id: 'v2', kind: 'knob', x: 270.9, y: 83.8, d: 27, sweep: 300, label: 'OSC. 2', scale: { n: 11, labels: N10 } },
    { id: 'm2', kind: 'switch', style: 'rocker', orient: 'h', x: 317, y: 85, w: 24, h: 11, color: 'blue', label: 'ON', lab: 'e' },
    { id: 'nz', kind: 'knob', x: 359.6, y: 106.6, d: 27, sweep: 300, label: 'NOISE\nVOLUME', scale: { n: 11, labels: N10 } },
    { id: 'mn', kind: 'switch', style: 'rocker', orient: 'h', x: 316.5, y: 107.9, w: 24, h: 11, color: 'blue', label: 'ON', lab: 'e' },
    { id: 'nc', kind: 'switch', style: 'rocker', orient: 'v', x: 392.6, y: 108.5, w: 11, h: 24, color: 'blue', label: 'WHITE', legends: ['WHITE', 'PINK'] },
    { id: 'v3', kind: 'knob', x: 270.5, y: 130.4, d: 27, sweep: 300, label: 'OSC. 3', scale: { n: 11, labels: N10 } },
    { id: 'm3', kind: 'switch', style: 'rocker', orient: 'h', x: 315.9, y: 130.9, w: 24, h: 11, color: 'blue', label: 'ON', lab: 'e' },
    { kind: 'lamp', x: 389.9, y: 57, d: 11, inert: true, color: '#d9a441', label: 'OVERLOAD' },
    // MODIFIERS: the three routing rockers straddle the MIXER | MODIFIERS rule; FILTER rows over LOUDNESS CONTOUR
    { id: 'fm', kind: 'switch', style: 'rocker', orient: 'h', x: 423.6, y: 38.9, w: 24, h: 11, color: 'orange', label: 'FILTER MODULATION', sec: 'modifiers', labSize: 2.4 },
    { id: 'k1', kind: 'switch', style: 'rocker', orient: 'h', x: 423.4, y: 60.2, w: 24, h: 11, color: 'orange', label: 'KEYBOARD CONTROL 1', sec: 'modifiers', labSize: 2.4 },
    { id: 'k2', kind: 'switch', style: 'rocker', orient: 'h', x: 423.4, y: 81.2, w: 24, h: 11, color: 'orange', label: 'KEYBOARD CONTROL 2', sec: 'modifiers', labSize: 2.4 },
    { id: 'fc', kind: 'knob', x: 461, y: 37.5, d: 27, sweep: 300, label: 'CUTOFF\nFREQUENCY', scale: { n: 11, labels: ['', '-4', '', '-2', '', '0', '', '2', '', '4', ''] } },
    { id: 'em', kind: 'knob', x: 505.5, y: 36.8, d: 27, sweep: 300, label: 'EMPHASIS', scale: { n: 11, labels: N10 } },
    { id: 'ca', kind: 'knob', x: 549.8, y: 37, d: 27, sweep: 300, label: 'AMOUNT\nOF CONTOUR', scale: { n: 11, labels: N10 } },
    { id: 'fa', kind: 'knob', x: 461.2, y: 79.8, d: 27, sweep: 300, label: 'ATTACK\nTIME', scale: { n: 6, labels: TIME } },
    { id: 'fd', kind: 'knob', x: 505.5, y: 80.3, d: 27, sweep: 300, label: 'DECAY\nTIME', scale: { n: 6, labels: TIME } },
    { id: 'fs', kind: 'knob', x: 550, y: 80.3, d: 27, sweep: 300, label: 'SUSTAIN\nLEVEL', scale: { n: 11, labels: N10 } },
    { id: 'la', kind: 'knob', x: 461.2, y: 129.7, d: 27, sweep: 300, label: 'ATTACK\nTIME', scale: { n: 6, labels: TIME } },
    { id: 'ld', kind: 'knob', x: 505.7, y: 129.7, d: 27, sweep: 300, label: 'DECAY\nTIME', scale: { n: 6, labels: TIME } },
    { id: 'ls', kind: 'knob', x: 550.5, y: 129.5, d: 27, sweep: 300, label: 'SUSTAIN\nLEVEL', scale: { n: 11, labels: N10 } },
    // OUTPUT: VOLUME + MAIN OUTPUT ON, A-440, phones VOLUME + jack (only the main VOLUME is ours)
    { id: 'vol', kind: 'knob', x: 593.9, y: 36.8, d: 27, sweep: 300, label: 'VOLUME', scale: { n: 11, labels: N10 } },
    { kind: 'switch', style: 'rocker', orient: 'h', x: 632.2, y: 37.8, w: 24, h: 11, color: 'blue', inert: true, label: 'MAIN OUTPUT\nON', p: 1 },
    { kind: 'switch', style: 'rocker', orient: 'h', x: 594.1, y: 83.9, w: 24, h: 11, color: 'blue', inert: true, label: 'A-440', p: 0 },
    { kind: 'knob', x: 593.5, y: 129.7, d: 27, sweep: 300, inert: true, label: 'VOLUME', scale: { n: 11, labels: N10 } },
    { kind: 'jack', x: 633.4, y: 129.7, d: 15, inert: true, label: 'PHONES' },
    // the power strip
    { kind: 'lamp', x: 669.9, y: 93.1, d: 9, inert: true, color: '#c8321e', lit: true, label: 'POWER' },
    { kind: 'switch', style: 'rocker', orient: 'v', x: 669.9, y: 128.4, w: 11, h: 24, color: 'black', inert: true, label: 'ON', p: 1 },
    // the left-hand controller plate (aux): GLIDE row behind the DECAY row — jack · legend · cream rocker · ON
    { kind: 'jack', a: 'lefthand', x: 14, y: 202, d: 9, inert: true, label: 'GLIDE switch input', lab: 'none' },
    { kind: 'switch', style: 'rocker', orient: 'h', a: 'lefthand', x: 47, y: 202, w: 15, h: 8, color: 'cream', inert: true, label: 'GLIDE', lab: 'w', p: 1 },
    { kind: 'jack', a: 'lefthand', x: 14, y: 219, d: 9, inert: true, label: 'DECAY switch input', lab: 'none' },
    { id: 'dk', kind: 'switch', style: 'rocker', orient: 'h', a: 'lefthand', x: 47, y: 219, w: 15, h: 8, color: 'cream', label: 'DECAY', lab: 'w' },
    // (1i) the wheels in front of the rockers: PITCH (left, centre detent drawn) and MOD (right); then the 44-key bed:
    // felt 3 mm, keys 137 mm, the 10 mm walnut front rail
    { id: 'perf:bend', kind: 'wheel', a: 'lefthand', x: 34, y: 284, w: 22, h: 64, orient: 'v', detent: true, label: 'PITCH', labSize: 2.4 },
    { id: 'perf:mod', kind: 'wheel', a: 'lefthand', x: 66, y: 284, w: 22, h: 64, orient: 'v', label: 'MOD', labSize: 2.4 },
    { id: 'perf:keys', kind: 'keys', a: 'keys', x: 397.7, y: 263.5, n: 44, lo: 29, pitch: 23, len: 137 },
  ],
  decor: [
    // the section rules (printed lines): CONTROLLERS | OSC BANK broken by the OSCILLATOR MODULATION legend and rocker,
    // MIXER | MODIFIERS by the three routing rockers; FILTER over LOUDNESS CONTOUR
    { t: 'line', x1: 98.7, y1: 0, x2: 98.7, y2: 46, sw: 0.5 },
    { t: 'line', x1: 98.7, y1: 69, x2: 98.7, y2: 176.2, sw: 0.5 },
    { t: 'line', x1: 248.5, y1: 0, x2: 248.5, y2: 176.2, sw: 0.5 },
    { t: 'line', x1: 423.4, y1: 0, x2: 423.4, y2: 27, sw: 0.5 },
    { t: 'line', x1: 423.4, y1: 89, x2: 423.4, y2: 176.2, sw: 0.5 },
    { t: 'line', x1: 437, y1: 99.8, x2: 572.1, y2: 99.8, sw: 0.5 },
    { t: 'line', x1: 572.1, y1: 0, x2: 572.1, y2: 176.2, sw: 0.5 },
    { t: 'line', x1: 655.7, y1: 0, x2: 655.7, y2: 176.2, sw: 0.5 },
    // section names, large along the bottom edge; FILTER and LOUDNESS CONTOUR titles
    { t: 'text', x: 49.9, y: 160, s: 'CONTROLLERS', size: 5.2, weight: 700, anchor: 'middle', ls: 0.4 },
    { t: 'text', x: 172.9, y: 160, s: 'OSCILLATOR BANK', size: 5.2, weight: 700, anchor: 'middle', ls: 0.4 },
    { t: 'text', x: 335.8, y: 160, s: 'MIXER', size: 5.2, weight: 700, anchor: 'middle', ls: 0.4 },
    { t: 'text', x: 497.7, y: 160, s: 'MODIFIERS', size: 5.2, weight: 700, anchor: 'middle', ls: 0.4 },
    { t: 'text', x: 613.4, y: 160, s: 'OUTPUT', size: 5.2, weight: 700, anchor: 'middle', ls: 0.4 },
    { t: 'text', x: 504.3, y: 10.5, s: 'FILTER', size: 3.6, weight: 700, anchor: 'middle', ls: 0.3 },
    { t: 'text', x: 505.4, y: 106, s: 'LOUDNESS CONTOUR', size: 3.6, weight: 700, anchor: 'middle', ls: 0.3 },
    // the oscillator headers (osc 1: the header only, over the FREQUENCY column)
    { t: 'text', x: 182, y: 11.5, s: 'OSCILLATOR-1', size: 3, weight: 700, anchor: 'middle' },
    { t: 'text', x: 182, y: 15.5, s: 'FREQUENCY', size: 2.6, anchor: 'middle' },
    // MODULATION MIX ends, the noise colour's other legend
    { t: 'text', x: 61, y: 127.5, s: 'OSC. 3', size: 2.2, anchor: 'middle' },
    { t: 'text', x: 86.5, y: 127.5, s: 'NOISE', size: 2.2, anchor: 'middle' },
    { t: 'text', x: 392.6, y: 125.2, s: 'PINK', size: 2.6, anchor: 'middle' },
    // the mixer's printed links from each volume knob to its ON rocker
    { t: 'line', x1: 285.5, y1: 38.2, x2: 303.5, y2: 39.1, sw: 0.35 },
    { t: 'line', x1: 330, y1: 62.2, x2: 344.5, y2: 61.8, sw: 0.35 },
    { t: 'line', x1: 285.9, y1: 84.2, x2: 303.8, y2: 85, sw: 0.35 },
    { t: 'line', x1: 329.5, y1: 107.9, x2: 344.8, y2: 107, sw: 0.35 },
    { t: 'line', x1: 285.5, y1: 130.6, x2: 302.7, y2: 130.9, sw: 0.35 },
    // the left-hand plate's ON legends; the model name in plain type on the power strip
    { t: 'text', a: 'lefthand', x: 58, y: 203, s: 'ON', size: 2.4, anchor: 'start' },
    { t: 'text', a: 'lefthand', x: 58, y: 220, s: 'ON', size: 2.4, anchor: 'start' },
    { t: 'text', x: 672.3, y: 168, s: 'Minimoog', size: 3.4, anchor: 'middle', weight: 600 },
    // (1i) the bed's felt where the keys run under the panel's hinge, the walnut front rail along the bed and the plate
    { t: 'rect', a: 'keys', x: 98.7, y: 192, w: 598, h: 3, fill: '#3e1414' },
    { t: 'rect', a: 'keys', x: 98.7, y: 332, w: 598, h: 10, fill: 'wood' },
    { t: 'rect', a: 'lefthand', x: 0, y: 332, w: 98.7, h: 10, fill: 'wood' },
    { t: 'line', a: 'keys', x1: 98.7, y1: 332.2, x2: 696.7, y2: 332.2, stroke: '#2a1a10', sw: 0.4 },
    { t: 'line', a: 'lefthand', x1: 0, y1: 332.2, x2: 98.7, y2: 332.2, stroke: '#2a1a10', sw: 0.4 },
  ],
  extras: { ids: [] },
  notes: [
    'All 38 Minimoog controls have a hardware home: the extras strip is empty (research §Mapping).',
    'DECAY (dk) lives on the left-hand controller plate (aux area, R3), drawn under the panel at its real x; GLIDE on/off there is inert (our glide is always on).',
    'TUNE prints the hardware -2…+2 and CUTOFF -4…4 (our ±1 st and 0…10, linear in the knob travel: §3.4.2).',
    'Rockers carry no parallax correction (they sit on their printed legends); knobs are dial-legend centres (research).',
    'Inert: MAIN OUTPUT ON, A-440, phones VOLUME and jack, POWER lamp and rocker, OVERLOAD lamp, GLIDE rocker and the two switch-input jacks.',
    '(1i) The bed: 44 keys F1–C5 (MIDI 29–72: F0…C4 in the maker\'s naming, C3 = middle C there; middle C = 60 here as on every synth), white pitch 23 mm derived ((697 mm inside the cheeks − the 98.7 mm plate) / 26 whites = 23.0: 598 mm), the keybed row 150 mm = 3 mm felt + 137 mm white keys + a 10 mm walnut front rail (the contract default: no photo here reads the rail; it carries the 8 mm front band). The bed runs 7.7 mm past the panel\'s right edge (x 696.7: the inside of the right cheek). Not touch-sensitive on the original.',
    '(1i) The left-hand controller plate full depth (x 0–98.7, y 192–342 at the kept offset −7.8; its width = the CONTROLLERS section above it, the bed\'s left edge): GLIDE / DECAY rows as before, then the two wheels in front of them — PITCH left (perf:bend, centre detent drawn; it springs to centre on glass, the 1970s original only detents; ±2 st), MOD right (perf:mod, stays). Windows 22 × 64 mm (the contract default: the photos here do not resolve the slots), centres x 34 / 66, y 284.',
  ],
};
