// panels/tr909.js — the hardware front panel of the TR-909 Rhythm Composer, as layout data for the canvas's fixed-size
// instrument module (docs/canvas/IMPL-panels.md §3 format, IMPL-7c.md §7 the panel, §14 Lane P1 the tokens). Owner: lane X.
// Data only: no imports, no DOM, no logos or maker names (the model name only as plain text; the maker-mark and wordmark
// zones of the photograph stay empty). Units: mm of the real box top, 486 × 300 mm (research-909-circuits.md §13, read from a
// top-view photograph at 4.70 px/mm, ± 3 %): a warm off-white case, three bands as on the hardware — the knob band (nine
// blocks under slate header bars, two rows of dark navy knobs); the middle band (START / STOP/CONT, the red display, TEMPO, the
// fourteen small LED keys with their orange shift legends, ENTER, VOLUME); the bottom band (the left cluster, the four scale
// rows, the sixteen step keys, the shift-legend strip, the instrument boxes). The rear sockets are print (▲ marks) on a strip
// along the top edge; the ten MULTI OUT jacks sit under theirs ('later': cable-able with full patching). All art is ours.
const INK = '#2c3550', SLATE = '#5b6580', ORG = '#f28c28', PAPER = '#e8e8e2', CREAM = '#fffddc', IVORY = '#d0c8b0', WHT = '#f6f4ec', LEDC = '#ff3b2a';
const r2 = v => Math.round(v * 100) / 100;
const T = (x, y, s, size, more) => Object.assign({ t: 'text', x, y, s, size: size || 2.2, anchor: 'middle', weight: 700, fill: INK }, more || {});
const R = (x, y, w, h, fill, more) => Object.assign({ t: 'rect', x, y, w, h, fill }, more || {});
const LN = (x1, y1, x2, y2, stroke, sw) => ({ t: 'line', x1, y1, x2, y2, stroke: stroke || INK, sw: sw || 0.3 });
const PA = (d, o) => Object.assign({ t: 'path', d }, o || {});
const circ = (x, y, r) => `M${r2(x - r)} ${r2(y)}a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0Z`;
const UP = (x, y) => PA(`M${r2(x)} ${r2(y - 1.1)}L${r2(x + 1.2)} ${r2(y + 1.1)}H${r2(x - 1.2)}Z`, { fill: SLATE });   // ▲ rear-socket mark

// the face's geometry (R9 §13, mm): the knob rows, the step keys' centres, the scale rows
const ROW = [113.4, 133.0], KD = 12.3;
const SX = k => r2(81.7 + 23 * (k - 1));                    // step key k's centre x (k 1–16)
const SROW = i => r2(190.9 + 7.2 * i);                      // scale row i's top (i 0–3; 6.2 mm tall, 7.2 mm pitch)
const SMALL = i => r2(186.6 + 14 * i);                      // small key i (0–13): the hit-rule pitch from x 186.6 (notes)
const SY = 169, STY = 173.8;                                // the small keys' y; START / STOP / ENTER's y

/* ---------------------------------------------------------------- controls */
// the 28 knobs [id, x, row (0 top / 1 bottom), printed legend]
const KN = [
  ['ac', 53.0, 1, ''],
  ['bdu', 83.0, 0, 'TUNE'], ['bdl', 103.8, 0, 'LEVEL'], ['bda', 83.0, 1, 'ATTACK'], ['bdd', 103.8, 1, 'DECAY'],
  ['sdu', 129.1, 0, 'TUNE'], ['sdl', 150.0, 0, 'LEVEL'], ['sdt', 129.1, 1, 'TONE'], ['sds', 150.0, 1, 'SNAPPY'],
  ['ltu', 175.1, 0, 'TUNE'], ['ltl', 196.2, 0, 'LEVEL'], ['ltd', 175.1, 1, 'DECAY'],
  ['mtu', 221.3, 0, 'TUNE'], ['mtl', 242.3, 0, 'LEVEL'], ['mtd', 221.3, 1, 'DECAY'],
  ['htu', 267.2, 0, 'TUNE'], ['htl', 288.3, 0, 'LEVEL'], ['htd', 267.2, 1, 'DECAY'],
  ['rsl', 313.2, 0, 'RIM SHOT'], ['cpl', 334.5, 0, 'HAND CLAP'],
  ['hhl', 380.6, 0, 'LEVEL'], ['chd', 359.8, 1, 'CH DECAY'], ['ohd', 380.6, 1, 'OH DECAY'],
  ['crl', 406.0, 0, 'CRASH LEVEL'], ['rdl', 426.8, 0, 'RIDE LEVEL'], ['cru', 406.0, 1, 'CRASH TUNE'], ['rdu', 426.8, 1, 'RIDE TUNE'],
];
const knobs = KN.map(([id, x, r, s]) => ({ id, kind: 'knob', x, y: ROW[r], d: KD, sweep: 300, scale: { n: 11 }, label: s || 'TOTAL ACCENT', lab: 'none' }));

// the 14 small keys (7 mm squares, LED in the cap) at the hit rule's 14 mm pitch; i 7 (EXT INST) and 13 (TAPE SYNC) are dimmed
const SMALLK = [['dr:trk', 'TRACK 1', 1], ['dr:trk', 'TRACK 2', 2], ['dr:trk', 'TRACK 3', 3], ['dr:trk', 'TRACK 4', 4], ['dr:pat', 'PATTERN 1', 1], ['dr:pat', 'PATTERN 2', 2],
  ['dr:pat', 'PATTERN 3', 3], [null, 'EXT INST'], ['dr:tkey', 'TEMPO'], ['dr:back', 'BACK'], ['dr:fwd', 'FWD'], ['dr:avail', 'AVAILABLE MEAS'], ['dr:cyc', 'CYCLE/GUIDE'], [null, 'TAPE SYNC']];
const small = SMALLK.map(([id, label, n], i) => Object.assign(id ? { id, hit: [14, 15] } : { inert: true },
  { kind: 'button', x: SMALL(i), y: SY, w: 7, h: 7, led: 'cap', color: IVORY, label, lab: 'none' }, n ? { n } : {}));
// the left cluster (14.9 mm columns, 17.7 mm rows): LAST STEP · SCALE / SHUFFLE/FLAM · CLEAR / INSTRUMENT SELECT · SHIFT
const CL = [['dr:last', 44.5, 201.9, 'LAST STEP'], ['dr:scale', 59.4, 201.9, 'SCALE'], ['dr:shuf', 44.5, 219.6, 'SHUFFLE/FLAM'], ['dr:clear', 59.4, 219.6, 'CLEAR'],
  ['dr:isel', 44.5, 237.2, 'INSTRUMENT SELECT'], ['dr:shift', 59.4, 237.2, 'SHIFT']];
const cluster = CL.map(([id, x, y, label]) => ({ id, kind: 'button', x, y, w: 8, h: 8, hit: [14, 15], color: IVORY, label, lab: 'none' }));
const steps = Array.from({ length: 16 }, (_, i) => ({ id: 'dr:step', kind: 'button', n: i + 1, x: SX(i + 1), y: 236.4, w: 17, h: 19.5, led: 'cap', color: IVORY, label: 'STEP ' + (i + 1), lab: 'none' }));
const scl = [1, 2, 3, 4].map(n => ({ id: 'dr:scl', kind: 'led', n, x: 71, y: r2(SROW(n - 1) + 3.1), d: 3, color: LEDC }));

// the rear: the ten MULTI OUT jacks (drawn under their ▲ legends, 'later'), the other sockets dimmed, the cartridge slot
const MULTI = ['BD', 'SD', 'LT', 'MT', 'HT', 'RS', 'HC', 'HH', 'CRASH', 'RIDE'];
const MX = i => r2(126.5 + 13.5 * i);                                       // 126.5 … 248.0
const OTH = [['MASTER OUT L', 'L', 268, 6.4], ['MASTER OUT R / MONO', 'R/MONO', 282, 6.4], ['SYNC IN', 'SYNC IN', 302, 6.4], ['START/STOP PEDAL', 'START/STOP', 317, 6.4],
  ['TRIG OUT (RIM SHOT)', 'TRIG OUT', 332, 6.4], ['TAPE SAVE', 'SAVE', 352, 6.4], ['TAPE LOAD', 'LOAD', 366, 6.4], ['MIDI IN', 'IN', 386, 8], ['MIDI OUT', 'OUT', 400, 8], ['MIDI THRU', 'THRU', 414, 8]];
const rear = [
  ...MULTI.map((s, i) => ({ kind: 'jack', x: MX(i), y: 17.5, d: 6.4, inert: 'later', label: s + ' OUT', lab: 'none' })),
  ...OTH.map(([label, , x, d]) => ({ kind: 'jack', x, y: 17.5, d, inert: true, label, lab: 'none' })),
  { kind: 'slot', x: 458, y: 17.5, w: 34, h: 5.5, inert: true, label: 'CARTRIDGE', lab: 'none' },
];

const controls = [
  ...knobs,
  { id: 'dr:start', kind: 'button', x: 49.4, y: STY, w: 19, h: 18, color: CREAM, label: 'START', lab: 'none' },
  { id: 'dr:stop', kind: 'button', x: 74.0, y: STY, w: 19, h: 18, color: CREAM, label: 'STOP/CONT', lab: 'none' },
  { id: 'dr:disp', kind: 'display', x: 113.85, y: 173.95, w: 39.1, h: 18.9, color: LEDC },
  { id: 'dr:tempo', kind: 'knob', x: 160.0, y: 171.1, d: 22, sweep: 300, scale: { n: 11 }, label: 'TEMPO', lab: 'none' },
  ...small,
  { id: 'dr:enter', kind: 'button', x: 385.7, y: STY, w: 19, h: 18, led: 'cap', color: CREAM, label: 'ENTER', lab: 'none' },
  { id: 'vol', kind: 'knob', x: 426.6, y: 171.5, d: 23, sweep: 300, scale: { n: 11 }, label: 'VOLUME', lab: 'none' },
  ...cluster, ...scl, ...steps, ...rear,
];

/* ---------------------------------------------------------------- decor */
const decor = [];

// --- the case: the rear strip (the sockets' print), the front fascia, the lip lines
decor.push(
  PA('M0 36.4V2.4Q0 0 2.4 0H483.6Q486 0 486 2.4V36.4Z', { fill: '#d9d9d1' }), LN(0, 36.4, 486, 36.4, '#9a9a92', 0.5), LN(0, 37.2, 486, 37.2, '#f7f7f1', 0.4),
  PA('M0 270.2H486V297.6Q486 300 483.6 300H2.4Q0 300 0 297.6Z', { fill: '#d9d9d1' }), LN(0, 270.2, 486, 270.2, '#f7f7f1', 0.5), LN(0, 271, 486, 271, '#9a9a92', 0.4));

// --- the rear strip: a ▲ and a code over each socket; the MULTI OUT jacks and the other sockets drawn under them; group brackets
MULTI.forEach((s, i) => decor.push(UP(MX(i), 3.6), T(MX(i), 9.2, s, 2.0)));
OTH.forEach(([, s, x]) => decor.push(UP(x, 3.6), T(x, 9.2, s, 2.0)));
decor.push(UP(458, 3.6), T(458, 9.2, 'CARTRIDGE', 2.0));
for (const [a, b, s] of [[121.5, 253, 'MULTI OUT'], [263, 287, 'MASTER OUT'], [294, 339.5, 'SYNC · PEDAL · TRIG'], [346.5, 371.5, 'TAPE'], [380.5, 419.5, 'MIDI']]) {
  decor.push(PA(`M${a} 25V26.4H${b}V25`, { stroke: SLATE, sw: 0.35 }), T(r2((a + b) / 2), 31.2, s, 2.3, { fill: SLATE }));
}

// --- the model name (plain type; the maker-mark zone x 37–114, y 13.6–24.9 and the product-line zone stay empty) and the orange rule
decor.push(T(36.4, 84.2, 'TR-909 · Rhythm Composer', 6.4, { anchor: 'start', weight: 600, ls: 0.2 }), LN(36.4, 89.2, 438.5, 89.2, ORG, 0.6));

// --- the knob band: nine blocks under slate header bars (the bar names the block; the knobs print their own legends)
const BAR = [['TOTAL ACCENT', 36.4, 33.0], ['BASS DRUM', 70.6, 44.5]];
['SNARE DRUM', 'LOW TOM', 'MID TOM', 'HI TOM', 'RIM SHOT / HAND CLAP', 'HI HAT', 'CYMBAL'].forEach((s, j) => BAR.push([s, r2(116.3 + 46.2 * j), 45.0]));
for (const [s, x, w] of BAR) decor.push(R(x, 93.8, w, 5.3, SLATE, { r: 0.6 }), T(r2(x + w / 2), 97.7, s, s.length > 14 ? 2.4 : 2.6, { fill: WHT, ls: 0.3 }));
for (const [, x, w] of BAR.slice(1)) decor.push(LN(r2(x - 0.6), 101, r2(x - 0.6), 143.5, '#c6c6be', 0.3));
decor.push(LN(36.4, 146.4, 438.5, 146.4, SLATE, 0.4));
// the knob legends (above each knob, clear of its tick ring), in the first row's and the second row's lines
for (const [, x, r, s] of KN) if (s) decor.push(T(x, r2(ROW[r] - 9.35), s, 2.4, { weight: 600 }));

// --- the middle band: START / STOP/CONT, the display (a dark bezel round the live window), TEMPO
decor.push(T(49.4, 186.2, 'START', 2.3), T(74.0, 186.2, 'STOP/CONT', 2.3),
  R(92.1, 162.3, 43.5, 23.1, '#262b3d', { r: 1.6 }),
  T(160.0, 156.4, 'TEMPO', 2.6), T(153.4, 185.6, 'SLOW', 2.0, { anchor: 'end', weight: 600 }), T(166.6, 185.6, 'FAST', 2.0, { anchor: 'start', weight: 600 }),
  T(426.6, 156.4, 'VOLUME', 2.6), T(419.6, 187.4, 'MIN', 2.0, { anchor: 'end', weight: 600 }), T(433.6, 187.4, 'MAX', 2.0, { anchor: 'start', weight: 600 }));
// the small keys' legends: TRACK 1–4 and PATTERN 1–3 numbered under a bracket and their group name; the rest named above their key
for (const [name, a, b] of [['TRACK', 0, 3], ['PATTERN', 4, 6]]) {
  const xa = SMALL(a), xb = SMALL(b);
  decor.push(T(r2((xa + xb) / 2), 158.4, name, 2.2), PA(`M${r2(xa - 3.4)} 161.6V160.2H${r2(xb + 3.4)}V161.6`, { stroke: INK, sw: 0.3 }));
  for (let i = a; i <= b; i++) decor.push(T(SMALL(i), 164.1, String(i - a + 1), 2.4));
}
[[7, 'EXT\nINST'], [8, 'TEMPO'], [9, 'BACK'], [10, 'FWD'], [11, 'AVAILABLE\nMEAS'], [12, 'CYCLE/\nGUIDE'], [13, 'TAPE\nSYNC']]
  .forEach(([i, s]) => decor.push(T(SMALL(i), s.includes('\n') ? 161.9 : 164.1, s, 1.9)));
// the orange shift legends under the keys: a hairline over the group, the sub-legends (STEP / TAP, I / II) and the group name
const SH = (a, b, y, s) => decor.push(T(r2((SMALL(a) + SMALL(b)) / 2), y, s, 1.9, { fill: ORG }));
const BR = (a, b) => decor.push(LN(r2(SMALL(a) - 3.4), 177.4, r2(SMALL(b) + 3.4), 177.4, ORG, 0.3));
BR(0, 3); SH(0, 3, 182.4, 'TRACK WRITE');
BR(4, 6); SH(4, 6, 182.4, 'PATTERN WRITE');
BR(7, 7); SH(7, 7, 182.4, 'EXT INST');
BR(8, 9); decor.push(T(SMALL(8), 181.4, 'STEP', 1.9, { fill: ORG }), T(SMALL(9), 181.4, 'TAP', 1.9, { fill: ORG })); SH(8, 9, 185.6, 'PATTERN WRITE MODE');
BR(10, 11); decor.push(T(SMALL(10), 181.4, 'I', 1.9, { fill: ORG }), T(SMALL(11), 181.4, 'II', 1.9, { fill: ORG })); SH(10, 11, 185.6, 'BANK');
BR(12, 12); SH(12, 12, 182.4, 'LAST MEAS');
BR(13, 13); SH(13, 13, 182.4, 'TEMPO MODE');
// ENTER: its name over the cap, the total-accent legend under it
decor.push(T(385.7, 162.6, 'ENTER', 2.3), T(385.7, 186.2, 'TOTAL ACCENT', 1.9, { fill: ORG }));

// --- the bottom band: the left cluster (its keys' names above them)
decor.push(R(35.2, 191.6, 32.0, 70.8, '#dcdcd3', { r: 1.4 }));
const TWO = { 'LAST STEP': 'LAST\nSTEP', 'SHUFFLE/FLAM': 'SHUFFLE/\nFLAM', 'INSTRUMENT SELECT': 'INSTRUMENT\nSELECT' };   // two-line legends: the last line sits 5.6 mm over the key's centre
CL.forEach(([, x, y, s]) => decor.push(T(x, r2(y - 5.6 - (TWO[s] ? 2.24 : 0)), TWO[s] || s, 2.0)));
// --- the scale indicator: four slate rows (an LED at the left of each), our beamed-note glyphs over the step columns
const head = (x, y) => `M${r2(x - 0.8)} ${r2(y)}a0.8 0.55 0 1 0 1.6 0a0.8 0.55 0 1 0 -1.6 0Z`;
const stem = (x, y, h) => `M${r2(x + 0.5)} ${r2(y - 0.2)}V${r2(y - h)}h0.3V${r2(y - 0.2)}Z`;
const beam = (xa, xb, y) => `M${r2(xa + 0.5)} ${r2(y)}H${r2(xb + 0.8)}v0.42H${r2(xa + 0.5)}Z`;
function notes(row, groups, nb, hy, sh, num) {                       // groups of beamed notes on step columns a…b; num: the tuplet numeral over each
  const y0 = SROW(row);
  let d = '';
  for (const [a, b] of groups) {
    for (let k = a; k <= b; k++) d += head(SX(k), y0 + hy) + stem(SX(k), y0 + hy, sh);
    for (let j = 0; j < nb; j++) d += beam(SX(a), SX(b), y0 + hy - sh + 0.62 * j);
    if (num) decor.push(T(r2((SX(a) + SX(b)) / 2 + 0.4), r2(y0 + 1.95), num, 1.6, { fill: WHT }));
  }
  decor.push(PA(d, { fill: WHT }));
}
for (let i = 0; i < 4; i++) decor.push(R(67.9, SROW(i), 371, 6.2, SLATE, { r: 0.5 }), PA(circ(71, SROW(i) + 3.1, 2.1), { fill: '#3a4258' }));
notes(0, [[1, 4], [5, 8], [9, 12], [13, 16]], 2, 4.9, 3.0);        // 16ths: four to a beat
notes(1, [[1, 8], [9, 16]], 3, 4.9, 3.0);                          // 32nds: eight to a beat
notes(2, [[1, 3], [4, 6], [7, 9], [10, 12]], 1, 5.1, 2.5, '3');    // 8th triplets: three to a beat (12 steps)
notes(3, [[1, 6], [7, 12]], 2, 5.1, 2.5, '6');                     // 16th triplets: six to a beat (12 steps)

// --- the step keys: a recessed strip, the numbers 1–16 over the caps, the shift-legend strip, the instrument boxes
decor.push(R(70.2, 221.4, 368.7, 27.2, '#dcdcd3', { r: 1.4 }));
for (let k = 1; k <= 16; k++) decor.push(T(SX(k), 224.8, String(k), 3.0));
decor.push(R(70.2, 249.6, 368.7, 4.9, SLATE, { r: 0.5 }));
['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'COPY', 'INS', 'DEL', 'SAVE', 'VERIFY', 'LOAD'].forEach((s, i) => decor.push(T(SX(i + 1), 253.0, s, 2.4, { fill: '#ffc480' })));
{
  const box = (x, w, s, size) => decor.push(R(x, 256.4, w, 5.7, INK, { r: 0.8 }), ...(s ? [T(r2(x + w / 2), 260.4, s, size || 2.4, { fill: WHT })] : []));
  ['BASS DRUM', 'SNARE DRUM', 'LOW TOM', 'MID TOM', 'HI TOM'].forEach((s, j) => box(r2(SX(2 * j + 1) - 11), 45.0, s));
  box(r2(SX(11) - 10.5), 21, 'RIM SHOT'); box(r2(SX(12) - 10.5), 21, 'HAND CLAP');
  box(r2(SX(13) - 11), 45.0, '');
  decor.push(T(SX(13), 260.3, 'CLOSED', 2.0, { fill: WHT }), T(r2((SX(13) + SX(14)) / 2), 260.3, 'OPEN', 2.0, { fill: WHT }), T(SX(14), 260.3, 'CLOSED', 2.0, { fill: WHT }));
  box(r2(SX(15) - 10.5), 21, 'CRASH'); box(r2(SX(16) - 10.5), 21, 'RIDE');
}

export default {
  v: 1,
  id: 'tr909',
  hw: 'TR-909 Rhythm Composer (1983): the whole top face and the rear-socket strip',
  case: '#c3c3bb',
  scheme: {
    panel: PAPER, legend: INK, rule: INK, accent: ORG, font: 'sans',
    knob: { skirt: '#2c3550', cap: '#2c3550', ptr: '#f28c28', ptrStyle: 'line', knurl: true, capR: 0.74 },
    button: { cap: IVORY, led: LEDC, ledOff: '#4b1812', text: INK },
    jack: { nut: '#b9bbbe', hole: '#0c0c0d' },
  },
  areas: [{ id: 'main', src: [0, 0, 486, 300], at: [0, 0], r: 2.4 }],
  sections: [
    { id: 'tacc', label: 'TOTAL ACCENT', x: 35.8, y: 93.4, w: 34.2, h: 52.6, frame: 'none', title: 'none' },
    { id: 'bd', label: 'BASS DRUM', x: 70, y: 93.4, w: 45.7, h: 52.6, frame: 'none', title: 'none' },
    ...['SNARE DRUM', 'LOW TOM', 'MID TOM', 'HI TOM', 'RIM SHOT · HAND CLAP', 'HI HAT', 'CYMBAL'].map((label, j) => ({ id: ['sd', 'lt', 'mt', 'ht', 'rscp', 'hh', 'cy'][j], label, x: r2(115.7 + 46.2 * j), y: 93.4, w: 46.2, h: 52.6, frame: 'none', title: 'none' })),
    { id: 'transport', label: 'START · STOP/CONT · DISPLAY · TEMPO', x: 36, y: 147, w: 142, h: 43, frame: 'none', title: 'none' },
    { id: 'keys', label: 'TRACK · PATTERN · MODE KEYS', x: 178, y: 147, w: 198, h: 43, frame: 'none', title: 'none' },
    { id: 'enter', label: 'ENTER', x: 376, y: 147, w: 26, h: 43, frame: 'none', title: 'none' },
    { id: 'volume', label: 'VOLUME', x: 402, y: 147, w: 48, h: 43, frame: 'none', title: 'none' },
    { id: 'cluster', label: 'LAST STEP · SCALE · SHUFFLE/FLAM · CLEAR · INSTRUMENT SELECT · SHIFT', x: 34, y: 190, w: 35, h: 78, frame: 'none', title: 'none' },
    { id: 'steps', label: 'SCALE · STEP KEYS 1–16', x: 69, y: 190, w: 372, h: 78, frame: 'none', title: 'none' },
  ],
  controls,
  decor,
  extras: { ids: ['dr:grid', 'dr:pads', 'dr:sync', 'dr:toRoll', 'dr:rec', 'dr:map', 'dr:sounds', 'dr:demo'] },
  notes: [
    'Source: research-909-circuits.md §13 (a top-view photograph at 4.70 px / mm, ± 3 %; the 486 × 300 × 105 mm box). Measured: the nine header bars (y 93.8–99.1: TOTAL ACCENT 36.4–69.4, BASS DRUM 70.6–115.1, then seven blocks to 438.5), the knob rows at y 113.4 / 133.0 (bodies ≈ 12.3 mm, two columns a block 20.9 mm apart: BD 83.0 / 103.8, SD 129.1 / 150.0, LT 175.1 / 196.2, MT 221.3 / 242.3, HT 267.2 / 288.3, RS 313.2, HC 334.5, HH 359.8 / 380.6, CYMBAL 406.0 / 426.8, TOTAL ACCENT 53.0), START (49.4, 173.8) and STOP/CONT (74.0), the display window (x 94.3–133.4, y 164.5–183.4), TEMPO (160.0, 171.1, Ø 22), ENTER (385.7, 173.8), VOLUME (426.6, 171.5, Ø 23), the left cluster (x 44.5 / 59.4, y 201.9 / 219.6 / 237.2), the four scale rows (x 67.9–438.9, y 190.9–218.7, 6.2 mm on a 7.2 mm pitch), the 16 step keys (x 81.7 + 23 (k − 1), caps 17 × 19.5 at y 236.4), the numbers (y ≈ 223.4), the shift-legend strip (y 249.6–254.5) and the instrument boxes (y 256.4–262.1, one per pair at a 46 mm pitch).',
    'Hit-rule nudges (§7.1: every live hit box ≥ 14 mm and disjoint): the fourteen small middle-band keys (the hardware\'s ≈ 11.9 mm pitch inside a group) stand on a 14 mm pitch from x 186.6 (186.6, 200.6 … 368.6; y 169; none more than 6.2 mm from the hardware\'s 192.8 … 362.6: TRACK 1 −6.2, TAPE SYNC +6.0), each live one with hit 14 × 15, each orange shift legend (and its hairline) moving with its key or keys; EXT INST and TAPE SYNC are dimmed (inert) in their places. The left cluster\'s six keys keep the measured x 44.5 / 59.4 but hit 14 × 15 (the default 15 mm boxes overlap by 0.1 mm at the 14.9 mm column pitch). Everything else is as measured: the step keys (23 mm pitch), START / STOP/CONT, ENTER, TEMPO, VOLUME and the knobs (20.9 × 19.6 mm pitch) need no nudge.',
    'Not emulated (dimmed, "not emulated"): the EXT INST and TAPE SYNC keys, the cartridge slot and the rear sockets other than MULTI OUT (MASTER OUT L, R / MONO, SYNC IN, START/STOP pedal, TRIG OUT, TAPE SAVE / LOAD, MIDI IN / OUT / THRU: their ▲ legends and brackets are print). The ten MULTI OUT jacks (BD, SD, LT, MT, HT, RS, HC, HH, CRASH, RIDE) are drawn at full contrast as inert \'later\' jacks ("BD OUT — cable-able with full patching (stage 4)"); the machine has one mix output (D3).',
    'Print and glyphs are ours: the slate header bars carry the block names, the knobs print their own legends (TUNE, LEVEL, ATTACK, DECAY, TONE, SNAPPY, CH / OH DECAY, CRASH / RIDE LEVEL / TUNE) above the tick ring, the scale indicator\'s four rows are our beamed-note drawings (sixteenths four to a beat, thirty-seconds eight, eighth triplets three, sixteenth triplets six: the last two over 12 steps) as paths, no font glyphs; the model name is plain type "TR-909 · Rhythm Composer" in the photograph\'s wordmark zone (x 34.7–141.7, y 72.3–87.2), the maker-mark zone (x 37–114, y 13.6–24.9) and the product-line zone stay empty (D4); no maker name, no logo.',
    'Estimated (read from a retouched photograph): the colours — case #e8e8e2, header bars / scale rows / legend strips #5b6580, shift legends and the title rule #f28c28, START / STOP/CONT / ENTER caps #fffddc, the other caps #d0c8b0, knobs #2c3550 with an orange line, red LEDs and display —, the rear strip\'s socket order and spacing (only that the machine has MASTER OUT L / R-MONO, ten MULTI OUT, SYNC IN, START/STOP, TRIG OUT, tape SAVE / LOAD and MIDI sockets is read from the manual\'s drawing), the front fascia (the photograph shows the face to y ≈ 268.5; the case runs to 300) and the print sizes.',
    'Sections: the nine knob blocks, then the middle band in four (START · STOP/CONT · DISPLAY · TEMPO; the fourteen small keys; ENTER; VOLUME) and the bottom band in two (the left cluster; the scale rows and the 16 step keys), so the Tab order reads left to right, top to bottom. The face is 486 × 300 mm → a 992 px module (972 px centred, ceil32), 992 × 1024 with the 360 px extras strip; the extras\' caption is the geometry\'s (it names our own hi-hat and cymbal sounds, D4).',
  ],
};
