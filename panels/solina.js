// panels/solina.js — the hardware front panel of the Solina String Ensemble, as layout data for the canvas's fixed-size
// instrument module (docs/canvas/IMPL-panels.md §3 format, §10 acceptance). Owner: the AUTHOR lane of this model (this file
// only). Data only: no imports, no functions, no DOM, no logos or maker names. Units: mm in the research frame of
// scratchpad/canvas/panels/research/solina.json (fact-checked twice; x ±4 mm along the strip): the one long control strip
// under the lid's front edge (lid cropped to 10 mm, R2), between the walnut cheeks, and the small panel right of the keys
// (an aux area, R3: MODULATION = our ensemble on / off). Everything sits in one row, left to right, as on the instrument.

export default {
  v: 1,
  id: 'solina',
  hw: 'Solina String Ensemble (SE-II / SE-III cabinet: the MODULATION switch right of the keys) — strip + lid edge + modulation panel',
  case: 'wood',
  scheme: {
    panel: '#333331',
    legend: '#d8c48a',
    rule: '#d8c48a',
    accent: '#e0301e',
    wood: '#5a3a26',
    font: 'sans',
    knob: { skirt: '#141414', cap: '#c9c9c4', ptr: '#141414', ptrStyle: 'line', knurl: false, capR: 0.42 },
    slider: { cap: '#e0301e', line: '#b5260f', groove: '#0d0d0d', capShape: 'flat' },
    button: { cap: '#e0301e', led: '#ffe2a0', ledOff: '#9c1c0c', text: '#f6e7cf' },
    rocker: { black: '#1b1b1b' },
  },
  areas: [
    { id: 'main', src: [0, 185, 978, 55], at: [0, 0] },
    { id: 'modulation', src: [896, 285, 61, 45], at: [896, 63], frame: 'none' },
  ],
  sections: [
    { id: 'power', label: 'POWER', x: 70, y: 195, w: 75, h: 45, frame: 'none', title: 'none' },
    { id: 'name', label: 'NAME', x: 145, y: 195, w: 125, h: 45, frame: 'none', title: 'none' },
    { id: 'tune', label: 'TUNING', x: 276, y: 195, w: 34, h: 45, frame: 'none', title: 'none' },
    { id: 'bass', label: 'BASS VOICES', x: 360, y: 195, w: 55, h: 45, frame: 'none', title: 'none' },
    { id: 'sliders', label: 'SLIDERS', x: 430, y: 195, w: 310, h: 45, frame: 'none', title: 'none' },
    { id: 'orchestra', label: 'UPPER VOICES', x: 752, y: 195, w: 90, h: 45, frame: 'none', title: 'none' },
    { id: 'modulation', label: 'MODULATION', a: 'modulation', x: 896, y: 285, w: 61, h: 45, frame: 'none', title: 'none' },
  ],
  controls: [
    // power: the wide ON / OFF rocker (ON under its left end) and the square pilot lamp beside it
    { kind: 'switch', style: 'rocker', orient: 'h', x: 92, y: 215, w: 38, h: 16, color: 'black', inert: true, label: 'POWER ON / OFF', lab: 'none', p: 0 },
    // tuning: the small black knob with a bright insert, a flat / sharp arc printed above it (no word label)
    { kind: 'knob', x: 293, y: 216, d: 12, sweep: 120, inert: true, label: 'TUNING', lab: 'none', skin: { skirt: '#141414', cap: '#c9c9c4', ptr: '#141414', capR: 0.42 } },
    // bass voices: CONTRA BASS and CELLO (red latching push buttons; the LED in the cap is the Type-1 version)
    { id: 'cb', x: 377, y: 214, kind: 'button', w: 13, h: 13, led: 'cap', lab: 'none', label: 'CONTRA BASS' },
    { id: 'ce', x: 398, y: 214, kind: 'button', w: 13, h: 13, led: 'cap', lab: 'none', label: 'CELLO' },
    // the four horizontal slide pots with red block caps (left = minimum); VOLUME BASS has no counterpart in our engine
    { x: 465, y: 213, kind: 'slider', orient: 'h', len: 42, cap: [18, 12], lab: 'none', inert: true, label: 'VOLUME BASS', p: 0.75 },
    { id: 'cr', x: 546, y: 213, kind: 'slider', orient: 'h', len: 42, cap: [18, 12], lab: 'none', label: 'CRESCENDO' },
    { id: 'su', x: 627, y: 213, kind: 'slider', orient: 'h', len: 42, cap: [18, 12], lab: 'none', label: 'SUSTAIN LENGTH' },
    { id: 'vol', x: 705, y: 213, kind: 'slider', orient: 'h', len: 42, cap: [18, 12], lab: 'none', label: 'VOLUME' },
    // upper voices: VIOLA, VIOLIN, TRUMPET, HORN
    { id: 'va', x: 768, y: 214, kind: 'button', w: 13, h: 13, led: 'cap', lab: 'none', label: 'VIOLA' },
    { id: 'vn', x: 787, y: 214, kind: 'button', w: 13, h: 13, led: 'cap', lab: 'none', label: 'VIOLIN' },
    { id: 'tp', x: 807, y: 214, kind: 'button', w: 13, h: 13, led: 'cap', lab: 'none', label: 'TRUMPET' },
    { id: 'hn', x: 826, y: 214, kind: 'button', w: 13, h: 13, led: 'cap', lab: 'none', label: 'HORN' },
    // the panel right of the keys (aux): MODULATION = the ensemble (chorus) on / off
    { id: 'en', a: 'modulation', x: 925, y: 305, kind: 'button', w: 13, h: 13, led: 'cap', lab: 'none', label: 'MODULATION' },
  ],
  decor: [
    // the lid's front edge (cropped to 10 mm) with its lighter edge line, the black strip, the walnut cheeks
    { t: 'rect', x: 22, y: 185, w: 935, h: 10, fill: 'wood' },
    { t: 'line', x1: 22, y1: 193.2, x2: 957, y2: 193.2, stroke: '#8a6446', sw: 0.6 },
    { t: 'line', x1: 22, y1: 195.1, x2: 957, y2: 195.1, stroke: '#151412', sw: 0.5 },
    { t: 'rect', x: 0, y: 185, w: 22, h: 55, fill: 'wood' },
    { t: 'rect', x: 957, y: 185, w: 21, h: 55, fill: 'wood' },
    { t: 'line', x1: 21.8, y1: 185, x2: 21.8, y2: 240, stroke: '#2a1a10', sw: 0.6 },
    { t: 'line', x1: 957.2, y1: 185, x2: 957.2, y2: 240, stroke: '#2a1a10', sw: 0.6 },
    // power legends; the square pilot lamp (an indicator, drawn unlit)
    { t: 'text', x: 80, y: 233.5, s: 'ON', size: 2.3, weight: 600, anchor: 'middle', ls: 0.15 },
    { t: 'text', x: 104, y: 233.5, s: 'OFF', size: 2.3, weight: 600, anchor: 'middle', ls: 0.15 },
    { t: 'rect', x: 126, y: 208, w: 12, h: 12, r: 0.6, fill: '#7d1408', stroke: '#3a0a04', sw: 0.4 },
    { t: 'rect', x: 127.6, y: 209.6, w: 8.8, h: 3.2, r: 0.4, fill: '#a32a18' },
    // the model name in plain type where the original prints its script; the plain model name where the badge sits
    { t: 'text', x: 205, y: 218.5, s: 'String Ensemble', size: 6.4, weight: 600, anchor: 'middle', ls: 0.3 },
    { t: 'text', x: 916, y: 216.5, s: 'Solina', size: 6, weight: 600, anchor: 'middle', ls: 0.6 },
    // tuning: flat · centre tick · sharp on a short arc above the knob
    { t: 'path', d: 'M286.2 209.4A9 9 0 0 1 299.8 209.4', stroke: '#d8c48a', sw: 0.3 },
    { t: 'line', x1: 293, y1: 205.3, x2: 293, y2: 207.4, stroke: '#d8c48a', sw: 0.35 },
    { t: 'text', x: 284.6, y: 209, s: '♭', size: 3.2, weight: 400, anchor: 'middle', ls: 0.15 },
    { t: 'text', x: 301.6, y: 209, s: '♯', size: 3.2, weight: 400, anchor: 'middle', ls: 0.15 },
    // printed legends under the controls (small gold caps)
    { t: 'text', x: 377, y: 229.2, s: 'CONTRA', size: 2.5, weight: 600, anchor: 'middle', ls: 0.15 },
    { t: 'text', x: 377, y: 232.4, s: 'BASS', size: 2.5, weight: 600, anchor: 'middle', ls: 0.15 },
    { t: 'text', x: 398, y: 230.5, s: 'CELLO', size: 2.5, weight: 600, anchor: 'middle', ls: 0.15 },
    { t: 'text', x: 465, y: 232, s: 'VOLUME  BASS', size: 2.5, weight: 600, anchor: 'middle', ls: 0.15 },
    { t: 'text', x: 546, y: 232, s: 'CRESCENDO', size: 2.5, weight: 600, anchor: 'middle', ls: 0.15 },
    { t: 'text', x: 627, y: 232, s: 'SUSTAIN LENGTH', size: 2.5, weight: 600, anchor: 'middle', ls: 0.15 },
    { t: 'text', x: 705, y: 232, s: 'VOLUME', size: 2.5, weight: 600, anchor: 'middle', ls: 0.15 },
    { t: 'text', x: 768, y: 230.5, s: 'VIOLA', size: 2.5, weight: 600, anchor: 'middle', ls: 0.15 },
    { t: 'text', x: 787, y: 230.5, s: 'VIOLIN', size: 2.5, weight: 600, anchor: 'middle', ls: 0.15 },
    { t: 'text', x: 807, y: 230.5, s: 'TRUMPET', size: 2.5, weight: 600, anchor: 'middle', ls: 0.15 },
    { t: 'text', x: 826, y: 230.5, s: 'HORN', size: 2.5, weight: 600, anchor: 'middle', ls: 0.15 },
    // the modulation panel (aux): its recessed inset, legend, the in / out pictograms and ON / OFF
    { t: 'rect', a: 'modulation', x: 900.5, y: 286, w: 52, h: 43, r: 1, fill: '#2b2b29', stroke: '#1a1a19', sw: 0.6 },
    { t: 'text', a: 'modulation', x: 925, y: 295.5, s: 'MODULATION', size: 2.3, weight: 600, anchor: 'middle', ls: 0.15 },
    { t: 'path', a: 'modulation', d: 'M913 322.5H919.5M915.2 322.5V314.5H917.6L919.3 316.3V322.5', stroke: '#d8c48a', sw: 0.35 },
    { t: 'path', a: 'modulation', d: 'M931 322.5H937.5M933.2 322.5V313L935.5 314.4L937.2 318.6V322.5', stroke: '#d8c48a', sw: 0.35 },
    { t: 'text', a: 'modulation', x: 916, y: 327.6, s: 'ON', size: 2.1, weight: 600, anchor: 'middle', ls: 0.15 },
    { t: 'text', a: 'modulation', x: 934.5, y: 327.6, s: 'OFF', size: 2.1, weight: 600, anchor: 'middle', ls: 0.15 },
  ],
  extras: { ids: ['tn'], at: [612, 63, 268, 42] },
  notes: [
    'Every control sits in one row on the strip as on the instrument (power, lamp, name, tuning, CONTRA BASS, CELLO, VOLUME BASS, CRESCENDO, SUSTAIN LENGTH, VOLUME, VIOLA, VIOLIN, TRUMPET, HORN, badge); MODULATION (our ensemble on / off) alone on the panel right of the keys (aux area, R3).',
    'The lid keeps only its front 10 mm (R2); the blank panel left of the keys and the rear jacks are not drawn (no controls).',
    'CRESCENDO, SUSTAIN LENGTH and VOLUME are horizontal slide pots (left = minimum, as both photos suggest; no manual states it). VOLUME BASS (bass level) has no counterpart in our engine: inert.',
    'Inert: the ON / OFF rocker, the tuning knob, VOLUME BASS; the pilot lamp is printed art (unlit). The buttons carry the Type-1 LED in the cap so the latched state reads on screen.',
    'tn (Tone) has no hardware counterpart: the extras box sits in the empty keybed band left of the modulation panel (extras.at), never on the strip.',
    'Original artwork: plain type "String Ensemble" where the original prints its script logo and "Solina" where the boxed badge sits; no logo is copied.',
  ],
};
