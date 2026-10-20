// panels/tr808.js — the hardware front panel of the TR-808 Rhythm Composer, as layout data for the canvas's fixed-size
// instrument module (docs/canvas/IMPL-panels.md §3 format, IMPL-7a.md §7 the panel, §14 Lane P1 the tokens). Owner: lane P2.
// Data only: no imports, no DOM, no logos or maker names (the model name only as plain text). Units: mm of the real box
// (508 × 305, top view: both cheeks and the rear lip included), measured from the Wikimedia Commons top-view photograph of
// a TR-808 (research-drums.md §3 A1) under a 5 mm grid, ± 1.5 mm. Axes are taken from features on the panel's plane (tick
// rings, printed numerals, name plates), not from the knob tops: a tall knob leans away from the photo's centre (up to ~3 mm
// at the ends). Three bands, as on the hardware: the rear legends; the control block, the twelve voice columns and
// MASTER VOLUME; the pattern band (BASIC VARIATION, START/STOP, PRE-SCALE, the note staves over the 16 step keys, I/F
// VARIATION, TAP). All art is ours: colours and type chosen here, no maker mark.
const GRY = '#a3a0a6', LIT = '#ece7d8', ORG = '#e8602c', INK = '#211f1d', PLATE = '#9b958d', CREAM = '#e6e2b6', RED = '#e03a2a';
const r2 = v => Math.round(v * 100) / 100;
const pol = (x, y, r, deg) => [r2(x + Math.sin(deg * Math.PI / 180) * r), r2(y - Math.cos(deg * Math.PI / 180) * r)];
const T = (x, y, s, size, more) => Object.assign({ t: 'text', x, y, s, size: size || 2.6, anchor: 'middle', weight: 600, fill: GRY }, more || {});
const R = (x, y, w, h, fill, more) => Object.assign({ t: 'rect', x, y, w, h, fill }, more || {});
const LN = (x1, y1, x2, y2, stroke, sw) => ({ t: 'line', x1, y1, x2, y2, stroke: stroke || GRY, sw: sw || 0.3 });
const PA = (d, o) => Object.assign({ t: 'path', d }, o || {});
const circ = (x, y, r) => `M${r2(x - r)} ${r2(y)}a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0Z`;
const BOX = (x, y, w, h, stroke, sw) => ({ t: 'rect', x, y, w, h, r: 0.5, stroke: stroke || LIT, sw: sw || 0.35 });

// the voice columns: axis x (28.2 mm pitch), the three knob rows, the slide-switch row, the name plates
const COLX = i => r2(142 + 28.2 * i), ROW = [68.3, 99.1, 130], SWY = 139.8;
// [id, column, row, printed name, level knob?]
const KN = [
  ['ac', 0, 0, 'LEVEL', 1],
  ['bdl', 1, 0, 'LEVEL', 1], ['bdt', 1, 1, 'TONE'], ['bdd', 1, 2, 'DECAY'],
  ['sdl', 2, 0, 'LEVEL', 1], ['sdt', 2, 1, 'TONE'], ['sds', 2, 2, 'SNAPPY'],
  ['ltl', 3, 0, 'LEVEL', 1], ['ltt', 3, 1, 'TUNING'],
  ['mtl', 4, 0, 'LEVEL', 1], ['mtt', 4, 1, 'TUNING'],
  ['htl', 5, 0, 'LEVEL', 1], ['htt', 5, 1, 'TUNING'],
  ['rsl', 6, 0, 'LEVEL', 1], ['cpl', 7, 0, 'LEVEL', 1], ['cbl', 8, 0, 'LEVEL', 1],
  ['cyl', 9, 0, 'LEVEL', 1], ['cyt', 9, 1, 'TONE'], ['cyd', 9, 2, 'DECAY'],
  ['ohl', 10, 0, 'LEVEL', 1], ['ohd', 10, 2, 'DECAY'],
  ['chl', 11, 0, 'LEVEL', 1],
];
// the five tom / conga / rim-claves / clap-maracas slide switches: id, column, upper (top) and lower plate text
const SW = [['lts', 3, 'LC', 'LT'], ['mts', 4, 'MC', 'MT'], ['hts', 5, 'HC', 'HT'], ['rss', 6, 'CL', 'RS'], ['cps', 7, 'MA', 'CP']];
// name plates in small caps: the code letters capitals, the rest lower case (drawn as small capitals, ≈ 0.7 of the capitals)
const NAME = {
  ac: 'ACcent', bd: 'Bass Drum', sd: 'Snare Drum', lt: 'Low Tom', mt: 'Mid Tom', ht: 'Hi Tom', rs: 'Rim Shot', cp: 'hand ClaP', cb: 'Cow Bell',
  cy: 'CYmbal', oh: 'Open Hihat', ch: "Cls'd Hihat", lc: 'Low Conga', mc: 'Mid Conga', hc: 'Hi Conga', cl: 'CLaves', ma: 'MAracas',
};
const LOW = ['ac', 'bd', 'sd', 'lt', 'mt', 'ht', 'rs', 'cp', 'cb', 'cy', 'oh', 'ch'];
// one plate: a cream rounded rect and its name, one centred text (the renderer measures it: even spacing; review 2 #6)
function plate(cx, y, key, size) {
  return [R(r2(cx - 12.2), y, 24.4, 7.6, CREAM, { r: 1.1 }), T(cx, r2(y + 5.3), NAME[key], r2(size * 1.45), { weight: 700, fill: INK, variant: 'small-caps' })];
}

/* ---------------------------------------------------------------- the step keys (n 1–16: red, orange, yellow, off-white) */
const KEYX = n => r2(n <= 12 ? 135 + 18.7 * (n - 1) : 359.9 + 18.8 * (n - 13));
const KEYCOL = ['#e6402c', '#f4893c', '#f5dc4e', '#f6f5f0'];
const STEPS = Array.from({ length: 16 }, (_, i) => ({ id: 'dr:step', kind: 'button', n: i + 1, x: KEYX(i + 1), y: 250.7, w: 13.3, h: 24, led: 'cap', color: KEYCOL[i >> 2], label: 'STEP ' + (i + 1), lab: 'none' }));

/* ---------------------------------------------------------------- skins */
const BLK = { skirt: '#131315', cap: '#1d1d20', ptr: ORG, ptrStyle: 'line', knurl: true, capR: 0.74 };   // the big dark knobs, an orange mark
const LVL = { skirt: '#131315', cap: '#f4ab3a', ptr: '#f1ece0', ptrStyle: 'line', knurl: true, capR: 0.46 }; // LEVEL: an orange disc
const WHT = { skirt: '#131315', cap: '#f4f3ee', ptr: '#f1ece0', ptrStyle: 'line', knurl: true, capR: 0.46 }; // the others: a white disc

/* ---------------------------------------------------------------- controls */
const knobs = KN.map(([id, col, row, name, lvl]) => ({ id, kind: 'knob', x: COLX(col), y: ROW[row], d: 11, sweep: 300, scale: { n: 11 }, label: name, lab: 'none', skin: lvl ? LVL : WHT }));
const switches = SW.map(([id, col]) => ({ id, kind: 'switch', style: 'slide', orient: 'v', x: COLX(col), y: SWY, w: 5, h: 11.5, map: [1, 0], label: 'TOM / CONGA', lab: 'none' }));
// the rear: 18 jacks (+ the sync DIN) at 17.5 mm; the MULTI OUT eleven are drawn here, 'later' (cable-able with full patching)
const MULTI = ['BD', 'SD', 'LT', 'MT', 'HT', 'RS', 'CP', 'CB', 'CY', 'OH', 'CH'];
const RJ = i => r2(134.2 + 17.5 * i);               // jack i (0–17): 134.2 … 431.7 (the photo's 18 nuts: 134 … 436)
const REAR = [['MASTER OUT HI', 'HI'], ['MASTER OUT LO', 'LO'], ...MULTI.map(s => [s + ' OUT', s]), ['TRIGGER OUT COWBELL', 'CB'], ['TRIGGER OUT CLAP', 'CP'], ['TRIGGER OUT ACCENT', 'AC'], ['PEDAL START/STOP', 'ST'], ['PEDAL FILL IN', 'FI']];
const jacks = REAR.map(([label], i) => (i >= 2 && i < 13
  ? { kind: 'jack', x: RJ(i), y: 17.5, d: 7, inert: 'later', label, lab: 'none' }
  : { kind: 'jack', x: RJ(i), y: 17.5, d: 7, inert: true, label, lab: 'none' }));

const controls = [
  // the control block: MODE, INSTRUMENT / TRACK and AUTO FILL IN (rotaries; their legends are printed round the dial), CLEAR, TEMPO, FINE
  { id: 'dr:mode', kind: 'rotary', x: 59.6, y: 82.6, d: 20, sweep: 260, legends: ['PATTERN\nCLEAR', '1st\nPART', '2nd\nPART', 'MANUAL\nPLAY', 'PLAY', 'COMPOSE'], label: 'MODE', lab: 'none', skin: BLK },
  { id: 'dr:inst', kind: 'rotary', x: 104.8, y: 81.2, d: 20, sweep: 330, legends: ['AC', 'BD', 'SD', 'LT', 'MT', 'HT', 'RS', 'CP', 'CB', 'CY', 'OH', 'CH'], label: 'INSTRUMENT / TRACK', lab: 'none', skin: BLK },
  { id: 'dr:fill', kind: 'rotary', x: 105.3, y: 121.7, d: 20, sweep: 130, legends: ['MANUAL', '16', '12', '8', '4', '2'], label: 'AUTO FILL IN', lab: 'none', skin: BLK },
  { id: 'dr:clear', kind: 'button', x: 59.5, y: 110.2, w: 8, h: 8, led: 'none', color: RED, label: 'CLEAR', lab: 'none' },
  { id: 'dr:tempo', kind: 'knob', x: 65.9, y: 163.5, d: 40, sweep: 300, label: 'TEMPO', lab: 'none', skin: Object.assign({}, BLK, { capR: 0.8 }) },
  { id: 'dr:fine', kind: 'knob', x: 109.6, y: 174.4, d: 13, sweep: 300, scale: { n: 11 }, label: 'FINE', lab: 'none', skin: Object.assign({}, BLK, { capR: 0.7 }) },
  // the twelve voice columns (one section each), then MASTER VOLUME
  ...knobs, ...switches,
  { id: 'vol', kind: 'knob', x: 447.2, y: 175.9, d: 22, sweep: 300, scale: { n: 11, labels: ['', '1', '2', '3', '4', '5', '6', '7', '8', '9', ''] }, label: 'MASTER VOLUME', lab: 'none', skin: Object.assign({}, BLK, { capR: 0.72 }) },
  // the pattern band: BASIC VARIATION (A / AB / B) with its two LEDs, START/STOP, PRE-SCALE (4 positions, 1 at the top) with
  // the 1st / 2nd PART LEDs, the 16 step keys, I/F VARIATION (A / B), TAP
  { id: 'dr:bvar', kind: 'switch', style: 'slide', orient: 'h', x: 69.7, y: 212, w: 20.7, h: 5, legends: ['A', 'AB', 'B'], label: 'BASIC VARIATION', lab: 'none' },
  { id: 'dr:varA', kind: 'led', x: 62.2, y: 227, d: 3.6, color: '#ff3322' },
  { id: 'dr:varB', kind: 'led', x: 76.7, y: 227, d: 3.6, color: '#ff3322' },
  { id: 'dr:start', kind: 'button', x: 70.5, y: 250.5, w: 36, h: 19, led: 'none', color: '#f3ead2', onCap: 'START/STOP', label: 'START/STOP', lab: 'none' },
  { id: 'dr:pre', kind: 'switch', style: 'slide', orient: 'v', x: 109.2, y: 217, w: 6.2, h: 17.9, positions: 4, label: 'PRE-SCALE', lab: 'none' },
  { id: 'dr:part1', kind: 'led', x: 110.7, y: 244.1, d: 3.6, color: '#ff3322' },
  { id: 'dr:part2', kind: 'led', x: 110.7, y: 257.8, d: 3.6, color: '#ff3322' },
  ...STEPS,
  { id: 'dr:ifv', kind: 'switch', style: 'slide', orient: 'h', x: 447.6, y: 211.7, w: 13.4, h: 6, legends: ['A', 'B'], label: 'I/F VARIATION', lab: 'none' },
  { id: 'dr:tap', kind: 'button', x: 447, y: 253.5, w: 18, h: 18, led: 'none', color: '#f5ead2', onCap: 'TAP', label: 'TAP (INTRO SET / FILL IN TRIGGER)', lab: 'none' },
  // not emulated: the power switch (top left)
  { kind: 'switch', style: 'rocker', orient: 'h', x: 56, y: 37.8, w: 15, h: 12, color: '#101012', inert: true, label: 'POWER', lab: 'none' },
  // the rear connectors (legends drawn below with their ▲ marks): MASTER OUT, the 11 MULTI OUT (later), TRIGGER OUT × 3, PEDAL × 2, DIN SYNC
  ...jacks,
  { kind: 'jack', x: 477.5, y: 17.5, d: 9, inert: true, label: 'DIN SYNC', lab: 'none' },
];

/* ---------------------------------------------------------------- decor */
const decor = [];
// --- the box: rear lip, both cheeks, the front edge
decor.push(R(0, 0, 508, 8, '#131416'), R(0, 3, 22.5, 302, '#1a1b1f'), R(485.5, 3, 22.5, 302, '#1a1b1f'), R(22.5, 283, 463, 22, '#16171a'),
  LN(22.5, 8, 22.5, 283, '#3b3c42', 0.5), LN(485.5, 8, 485.5, 283, '#3b3c42', 0.5), LN(22.5, 283, 485.5, 283, '#3b3c42', 0.5),
  PA('M0 303V9L4 4H22.5', { stroke: '#2a2b30', sw: 0.5 }), PA('M508 303V9L504 4H485.5', { stroke: '#2a2b30', sw: 0.5 }),
  { t: 'screws', pts: [[30, 24], [57, 27], [57, 47], [99, 26], [30, 104], [399, 162], [476, 162], [75.6, 281.5], [430.8, 283]], d: 3.2 });

// --- the rear legend band: a ▲ for each connector on the rear edge, its code below it, the group names under the jacks
const UP = (x, y) => PA(`M${x} ${y - 1.2}L${r2(x + 1.3)} ${y + 1.2}H${r2(x - 1.3)}Z`, { fill: '#8f8d92' });
REAR.forEach(([, code], i) => decor.push(UP(RJ(i), 3.4), T(RJ(i), 8.9, code, 2.3, { fill: LIT })));
decor.push(UP(477.5, 3.4), T(477.5, 8.9, 'DIN', 2.3, { fill: LIT }));
for (const [a, b, s] of [[0, 1, 'MASTER OUT'], [2, 12, 'MULTI OUT'], [13, 15, 'TRIGGER OUT'], [16, 17, 'PEDAL']]) {
  decor.push(LN(RJ(a) - 5, 23.6, RJ(b) + 5, 23.6, '#6e6c72', 0.3), T(r2((RJ(a) + RJ(b)) / 2), 27.6, s, 2.4));
}
decor.push(T(477.5, 27.6, 'SYNC', 2.4));
// jack 0-1 (MASTER OUT) read HI / LO

// --- the top rule, the column rules
decor.push(R(38.9, 51, 428, 1.4, '#8d8a8e'));
for (let j = 0; j <= 12; j++) {
  const x = r2(127.9 + 28.2 * j);
  decor.push(LN(x, j === 0 ? 57 : 55, x, j === 0 ? 193 : j === 12 ? 196 : 148.7, '#8d8a8e', 0.55));
}
// the control block's frame: the AUTO FILL IN corner, and the rule across the foot of the voice section
decor.push(PA('M38.5 122.6H79.9V102.3H127.7', { stroke: '#8d8a8e', sw: 0.9 }));
decor.push(R(39.3, 194.8, 427.7, 1.8, '#8d8a8e'));

// --- POWER (the switch is a control; ON / OFF printed beside it)
decor.push(T(56, 22, 'POWER', 3), R(67.5, 32.2, 1.8, 1.8, '#8d8a8e'), T(71.4, 34.2, 'ON', 2.6, { anchor: 'start' }), R(67.5, 40.6, 1.8, 1.8, '#8d8a8e'), T(71.4, 42.6, 'OFF', 2.6, { anchor: 'start' }));

// --- MODE (PATTERN WRITE / RHYTHM TRACK), CLEAR and its labels
decor.push(BOX(45.1, 54.8, 26.6, 4.3), T(58.4, 58.1, 'PATTERN WRITE', 2.7, { fill: LIT, weight: 700 }),
  PA('M45.1 57H38.4V109.8H55', { stroke: LIT, sw: 0.4 }), LN(71.7, 57, 88, 57, LIT, 0.4),
  T(89, 57.3, 'INSTRUMENT-SELECT', 2.6, { anchor: 'start', fill: LIT, weight: 700 }),
  BOX(88.7, 58.4, 31.7, 3.7, ORG), T(104.5, 61.2, 'RHYTHM TRACK', 2.5, { fill: ORG, weight: 700 }),
  PA('M88.7 60.2H82.5V77.5M82.5 70.6H78M77.3 82V113.2H65', { stroke: ORG, sw: 0.4 }),
  BOX(48.1, 97.4, 27.1, 4.3), T(61.6, 100.7, 'PATTERN CLEAR', 2.7, { fill: LIT, weight: 700 }),
  LN(60.5, 101.7, 60.5, 106.2, LIT, 0.4),
  T(48, 104.3, 'STEP', 2.6, { fill: LIT }), T(48, 107.7, 'NUMBER', 2.6, { fill: LIT }), T(47.5, 113.4, 'PRE-', 2.6, { fill: LIT }), T(47.5, 116.7, 'SCALE', 2.6, { fill: LIT }),
  T(70.5, 107.1, 'TRACK', 2.6, { fill: ORG }), T(70.5, 110.4, 'CLEAR', 2.6, { fill: ORG }));
// the MODE dial's orange / white print is in its legends; the red CLEAR key is the control

// --- INSTRUMENT / TRACK: a cream outline round each code, the track numbers 1–12 (orange) outside them
for (let i = 0; i < 12; i++) {
  const a = -165 + 30 * i, [bx, by] = pol(104.8, 81.2, 14.3, a), [nx, ny] = pol(104.8, 81.2, 18.4, a);
  decor.push({ t: 'rect', x: r2(bx - 3.1), y: r2(by - 1.9), w: 6.2, h: 3.8, r: 0.9, stroke: LIT, sw: 0.3 }, T(nx, r2(ny + 0.8), String(i + 1), 2.3, { fill: ORG }));
}

// --- AUTO FILL IN: the label under the knob; a "MEASURES" line
decor.push(T(105.3, 136.6, 'MEASURES', 2.2, { weight: 500 }), T(105.3, 140.2, 'AUTO FILL IN', 3, { fill: LIT }));

// --- TEMPO: a light bezel with the numbers 0–10, the 40 click-stop dots; FINE with SLOW / FAST
{
  const cx = 65.9, cy = 163.5;
  decor.push(PA(circ(cx, cy, 25.1), { stroke: '#d4cdbe', sw: 7, fill: 'none' }), PA(circ(cx, cy, 21.4), { fill: '#17181a' }));
  let d = '';
  for (let i = 0; i < 40; i++) { const [x, y] = pol(cx, cy, 22.4, -150 + 300 * i / 39); d += circ(x, y, 0.32); }
  decor.push(PA(d, { fill: '#d9d6cf' }));
  for (let i = 0; i <= 10; i++) { const [x, y] = pol(cx, cy, 25.1, -150 + 30 * i); decor.push(T(x, r2(y + 1.5), String(i), 4.4, { fill: INK, weight: 700 })); }
  decor.push(T(cx, 132.4, 'TEMPO', 3.2, { fill: LIT }));
  decor.push(T(109.6, 162.6, 'FINE', 3.2, { fill: LIT }), T(98.2, 184.8, 'SLOW', 2.4, { fill: '#8d8a8e' }), T(119.4, 184.8, 'FAST', 2.4, { fill: '#8d8a8e' }));
}

// --- the voice columns: printed knob names, the 74° orange mark by each LEVEL knob, the plates
for (const [, col, row, name, lvl] of KN) {
  const x = COLX(col), y = ROW[row];
  decor.push(T(x, r2(y - 10.3), name, 3, { fill: GRY, weight: 500, ls: 0.1 }));
  if (lvl) { const [mx, my] = pol(x, y, 7.1, 74); decor.push(PA(circ(mx, my, 0.75), { fill: '#e8602c' })); }
}
for (let i = 0; i < 12; i++) decor.push(...plate(COLX(i), 148.7, LOW[i], 2.8));
for (const [, col, up] of SW) decor.push(...plate(COLX(col), 124.2, up.toLowerCase(), 2.8));

// --- the title block: plain type, our own lettering (no maker mark); the orange rule
decor.push(LN(130, 180.3, 427, 180.3, ORG, 0.5),
  T(364.5, 178.3, 'Rhythm Composer', 11.2, { anchor: 'end', fill: ORG, weight: 500 }), T(409.5, 178.3, 'TR-808', 9, { anchor: 'end', fill: ORG, weight: 500 }),
  T(410, 187.6, 'Computer Controlled', 6, { anchor: 'end', fill: '#948f9c', weight: 400 }));

// --- MASTER VOLUME: MIN / MAX under the dial
decor.push(T(437.8, 188.6, 'MIN', 2.3), T(457.4, 188.6, 'MAX', 2.3), T(447.7, 192.6, 'MASTER VOLUME', 3.2, { fill: '#b6b2b9', weight: 600 }));

// --- the pattern band
// BASIC VARIATION plate: its title, A / AB / B, the two LEDs' recess, the rule above START/STOP
decor.push(R(39.8, 200.3, 57.7, 74.5, PLATE, { r: 1.2 }), T(68.7, 205.1, 'BASIC-VARIATION', 2.7, { fill: INK }),
  T(62, 221.8, 'A', 2.6, { fill: INK }), T(69.7, 221.8, 'AB', 2.6, { fill: INK }), T(77.2, 221.8, 'B', 2.6, { fill: INK }),
  R(59.2, 224.6, 20.5, 5.7, '#1a1a1c', { r: 0.6 }), LN(41.5, 233.7, 95.9, 233.7, INK, 0.4), R(50, 241, 40, 21, '#171719', { r: 0.8 }));
// the dark strip behind the step keys (and the two PART lamps), their numbers 1–16 above the keys
decor.push(R(99.2, 232.8, 327.6, 34.2, '#171719', { r: 0.8 }));
// PRE-SCALE: the label, the four positions 1–4 with their leaders to the staves, STEP NO →, the PART lamps' names
decor.push(T(110.7, 205.3, 'PRE-SCALE', 3, { fill: LIT, weight: 700 }));
[[210.5, 203.9], [215.3, 212.1], [219.9, 220.4], [224.8, 228.7]].forEach(([y, ry], i) => decor.push(T(113.9, r2(y + 1), String(i + 1), 2.4, { fill: LIT, anchor: 'middle' }), PA(`M115.6 ${y}H119.8L123.6 ${ry}H126.9`, { stroke: LIT, sw: 0.28 })));
decor.push(R(99.7, 233.3, 27.1, 5, PLATE, { r: 0.8 }), T(109.2, 237, 'STEP NO', 3, { fill: INK, weight: 700 }), PA('M121.3 235.8H125.6M123.8 234.4L125.6 235.8L123.8 237.2', { stroke: INK, sw: 0.45 }),
  T(110.7, 249.2, '1st PART', 2.6, { fill: LIT, weight: 500 }), T(110.7, 262.6, '2nd PART', 2.6, { fill: LIT, weight: 500 }));
for (let n = 1; n <= 16; n++) decor.push(T(KEYX(n), 237.1, String(n), 3.5, { fill: LIT, weight: 700 }));
// the note-value staves (the four PRE-SCALE rows): grey bars grouped 3 / 6 / 4 / all keys, the notes over the keys
{
  const rows = [[200.2, [[1, 3], [4, 6], [7, 9], [10, 12], [13, 15], [16, 16]]], [208.3, [[1, 6], [7, 12], [13, 16]]], [216.6, [[1, 4], [5, 8], [9, 12], [13, 16]]], [224.8, [[1, 16]]]];
  for (const [y, groups] of rows) for (const [a, b] of groups) {
    const x0 = r2(KEYX(a) - 8.1), x1 = r2(KEYX(b) + 8.4);
    decor.push(R(x0, y, r2(x1 - x0), 7.5, PLATE, { r: 0.9 }));
    if (b > a && y < 216) decor.push(LN(r2(KEYX(a) + 0.8), r2(y + 1.5), r2(KEYX(b) + 0.8), r2(y + 1.5), INK, 0.25)); // beam
  }
  // the notes: one text per row, an x per note (each its own centred chunk)
  const notes = (y, g, ks) => decor.push(T(r2(KEYX(ks[0]) - 0.7), y, g.repeat(ks.length), 6.4, { fill: INK, weight: 400, xs: ks.map(n => r2(KEYX(n) - 0.7)) }));
  const keys = step => Array.from({ length: 16 / step }, (_, i) => 1 + i * step);
  notes(206.3, '♪', keys(1)); notes(214.4, '♪', keys(2)); notes(222.7, '♩', keys(4)); notes(230.9, '♩', keys(8));
}
// BASIC RHYTHM 1–12 and INTRO / FILL IN 1–4 under the keys, their arrow bars
decor.push(R(70.3, 268.5, 45.5, 5.6, '#2a2a2d', { r: 0.6 }), T(72.3, 272.4, 'BASIC RHYTHM', 3.2, { anchor: 'start', fill: LIT, weight: 700 }), PA('M111.6 271.3H114.6M113.1 269.9L114.8 271.3L113.1 272.7', { stroke: LIT, sw: 0.45 }),
  R(116.5, 266.6, 232.5, 10.1, PLATE, { r: 1 }), R(352.7, 266.6, 74.5, 10.1, PLATE, { r: 1 }),
  R(435, 269.5, 30, 5.6, '#2a2a2d', { r: 0.6 }), T(437, 273.4, 'INTRO/FILL IN', 3, { anchor: 'start', fill: LIT, weight: 700 }), PA('M434.6 272.3H431M432.5 270.9L431 272.3L432.5 273.7', { stroke: '#2a2a2d', sw: 0.45 }));
for (let n = 1; n <= 16; n++) decor.push(T(KEYX(n), 274.6, String(n <= 12 ? n : n - 12), 6.4, { fill: INK, weight: 700 }));
// I/F VARIATION plate: its title, A / B, the INTRO SET / FILL IN TRIGGER words over TAP
decor.push(R(428.7, 200.8, 38.3, 76.2, PLATE, { r: 1.2 }), T(447.7, 205.6, 'I/F-VARIATION', 2.7, { fill: INK }),
  T(443.6, 219.9, 'A', 2.6, { fill: INK }), T(451.8, 219.9, 'B', 2.6, { fill: INK }), LN(431, 225.2, 465, 225.2, INK, 0.4),
  T(447.7, 232.3, 'INTRO SET', 2.6, { fill: INK, weight: 700 }), LN(431.5, 233.6, 464.5, 233.6, INK, 0.3), T(447.7, 237.5, 'FILL IN TRIGGER', 2.6, { fill: INK, weight: 700 }),
  R(437, 242.3, 22, 22.5, '#171719', { r: 0.8 }));

export default {
  v: 1,
  id: 'tr808',
  hw: 'TR-808 Rhythm Composer (1980): the whole top face, both cheeks and the rear lip',
  case: '#1b1c1f',
  scheme: {
    panel: '#2e2f33', legend: '#c9c5bf', rule: '#8d8a8e', accent: ORG, font: 'sans',
    knob: { skirt: '#131315', cap: '#f4f3ee', ptr: '#f1ece0', ptrStyle: 'line', knurl: true, capR: 0.46 },
    button: { cap: '#e7e2cf', led: '#ff3322', ledOff: '#5a1812', text: '#1f1c18' },
    jack: { nut: '#b9bbbe', hole: '#0c0c0d' },
  },
  areas: [{ id: 'main', src: [0, 0, 508, 305], at: [0, 0], r: 3 }],
  sections: [
    { id: 'control', label: 'MODE · INSTRUMENT / TRACK · AUTO FILL IN · TEMPO', x: 30, y: 53, w: 98, h: 142, frame: 'none', title: 'none' },
    ...[['ac', 'ACCENT'], ['bd', 'BASS DRUM'], ['sd', 'SNARE DRUM'], ['lt', 'LOW TOM / LOW CONGA'], ['mt', 'MID TOM / MID CONGA'], ['ht', 'HI TOM / HI CONGA'], ['rs', 'RIM SHOT / CLAVES'],
      ['cp', 'HAND CLAP / MARACAS'], ['cb', 'COWBELL'], ['cy', 'CYMBAL'], ['oh', 'OPEN HI HAT'], ['ch', 'CLOSED HI HAT']]
      .map(([id, label], i) => ({ id, label, x: r2(COLX(i) - 14.1), y: 54.5, w: 28.2, h: 95.5, frame: 'none', title: 'none' })),
    { id: 'master', label: 'MASTER VOLUME', x: 428, y: 155, w: 38.3, h: 41, frame: 'none', title: 'none' },
    { id: 'basicvar', label: 'BASIC VARIATION · START/STOP', x: 39.8, y: 200, w: 57.7, h: 76, frame: 'none', title: 'none' },
    { id: 'prescale', label: 'PRE-SCALE · STEP NO', x: 98, y: 200, w: 29, h: 76, frame: 'none', title: 'none' },
    { id: 'steps', label: 'STEP KEYS 1–16', x: 127, y: 200, w: 300.5, h: 80, frame: 'none', title: 'none' },
    { id: 'iffill', label: 'I/F VARIATION · TAP', x: 428.7, y: 200, w: 38.3, h: 77, frame: 'none', title: 'none' },
  ],
  controls,
  decor,
  extras: { ids: ['dr:grid', 'dr:pads', 'dr:sync', 'dr:swing', 'dr:toRoll', 'dr:rec', 'dr:map', 'dr:sounds', 'dr:demo'] },
  notes: [
    'Source: the Wikimedia Commons top-view photograph of a TR-808 (research-drums.md §3 A1), read under a 5 mm grid and with colour blobs for the orange knob caps, the cream plates and the step keys; the 508 × 305 mm outline of RC §13 is the photo frame (x 7.41 px / mm, y 7.34). Every number is ± 1.5 mm. Knob axes come from panel-plane features (tick rings, printed numerals, plates), not the knob tops, which lean up to 3 mm away from the photo centre.',
    'Measured: the voice columns on a 28.2 mm pitch (AC 142.0 … CH 452.2), the knob rows at y 68.3 / 99.1 / 130.0 (LEVEL / TONE or TUNING / DECAY or SNAPPY; OH DECAY is in the third row), the five slide switches at y 139.8 under their upper plates (y 124.2) and over the name plates (y 148.7); MODE (59.6, 82.6), INSTRUMENT / TRACK (104.8, 81.2), AUTO FILL IN (105.3, 121.7), TEMPO (65.9, 163.5; bezel Ø 57.5), FINE (109.6, 174.4), MASTER VOLUME (447.2, 175.9), the 16 step keys (cap 13.3 × 24 mm, pitch 18.7, a 1 mm wider gap between 12 and 13; y 250.7), START/STOP, the two variation plates, the PRE-SCALE lever (four positions 4.8 mm apart, 1 at the top).',
    'Detent angles: INSTRUMENT / TRACK 12 positions from −165° to +165° (30°, the photo\'s track numbers); TEMPO and the knob dials 300° (0–10 numerals every 30°, 40 click stops drawn as dots); AUTO FILL IN 130° (the photo: 145°) and MODE 260° (the photo: 140°) are widened so the printed words fit round the dial (the renderer prints a rotary\'s legends itself, at 2.4 mm); the MODE legends are two-line strings ("PATTERN\nCLEAR"), cv-panel\'s legend text for a value joins the lines with a space, and the drum rotary should do the same.',
    'The slide switches follow the photo\'s caption order, top = the upper plate: tom / conga, rim shot / claves and clap / maracas use map [1, 0] (the model\'s value 0 = tom is the lower position); BASIC VARIATION left to right A, AB, B; I/F VARIATION A, B; PRE-SCALE top to bottom 1–4.',
    'Estimated (not readable on the photo): the order of the 18 rear jacks and their legends — MASTER OUT HI / LO, the 11 MULTI OUT in voice order, TRIGGER OUT (cowbell, clap, accent), PEDAL (start/stop, fill in), DIN SYNC — only their 17.5 mm pitch (134 … 436 mm) and the sync socket at x 478 are measured; the jack art is drawn below its ▲ legend (the TB-303 WAVEFORM precedent), the 11 MULTI OUT as inert \'later\' jacks ("BD OUT — cable-able with full patching (stage 4)"), the other 8 dimmed.',
    'Estimated: the direction of the three tom / conga switches (up = the upper plate\'s sound), the staves\' note groups (rows 1–4 = pre-scale 1–4: eighth notes per key, per 2 keys, quarter notes per 4, per 8), the screws, the rear lip height (8 mm) and the cheeks (22.5 mm), which carry no controls.',
    'Hit boxes: all ≥ 15 mm and disjoint (the tightest: the step keys, 15 × 24 mm on an 18.7 mm pitch; the voice knobs 15 × 15 on 28.2 × 30.9). No conflict needed a nudge. Sections: one per voice column (each voice\'s knobs and switch together), the control block, MASTER VOLUME, and the pattern band in four (BASIC VARIATION · START/STOP, PRE-SCALE, the 16 step keys, I/F VARIATION · TAP).',
    'Not emulated (dimmed, "not emulated"): the POWER switch and the 8 rear connectors that are not the MULTI OUT eleven. The face is 508 × 305 mm → 1024 × 1024 px with the 360 px extras strip (body 984 px + the 40 px bar; the content is 610 px of the 624 px the 1024 px box allows).',
    'Art: original — dark charcoal panel, cream plates with the two code letters large, orange LEVEL discs, the four-colour step keys, warm-grey plates; the plain-type title "Rhythm Composer · TR-808 · Computer Controlled"; no maker name, no logo (the photo\'s maker mark is left out).',
  ],
};
