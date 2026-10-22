// panels/sdsv.js — the hardware front panel of the SDS-V analog drum synthesizer, as layout data for the canvas's fixed-size
// instrument module (docs/canvas/IMPL-panels.md §3 format, IMPL-8.md §13 the panel, §17 Lane P1 the tokens). Owner: lane X.
// Data only: no imports, no DOM, no logos or maker names (the model name only as plain text; no wordmark, no logo, no
// maker's name anywhere: D4). Units: mm of the brain's face, 482.6 × 152.4 mm (19 × 6 in, research-sdsv-circuits.md §1 / §4:
// "up to seven drum-sound modules plus an output mixer"). A near-black rack face with white print: two rack ears; along the top
// edge the rear sockets (▲ legends; the five per-channel OUT jacks 'later', the rest dimmed); seven 50 mm module slots —
// BASS DRUM · SNARE DRUM · TOM 1 · TOM 2 · TOM 3 (the five cards) and two blank plates for the optional HI-HAT and CYMBAL
// modules (later, IMPL-8 §16 Q7) —; then the MIXER (SENSITIVITY and LEVEL of the five channels, the model name). A card, from
// the top: its name plate, the six knobs in two columns of three (NOISE / TONE · BEND / DECAY · NOISE / TONE · CLICK / DRUM),
// the four memory keys in a 2 × 2 square (1 top left; an LED each), two rows of six small trimmers (memories 3 and 4: art, a
// tap on a row opens TRIM… at it), a printed TRIGGER IN socket. All art is ours.
const WHT = '#ecece6', DIM = '#9a9c9a', FACE = '#25272a', PLATE = '#1c1e21', EDGE = '#3b3e43', BAR = '#34373c', BLANK = '#151618';
const CREAM = '#efe6cf', LEDC = '#e0281e';
const r2 = v => Math.round(v * 100) / 100;
const T = (x, y, s, size, more) => Object.assign({ t: 'text', x, y, s, size: size || 2, anchor: 'middle', weight: 700, fill: WHT }, more || {});
const R = (x, y, w, h, fill, more) => Object.assign({ t: 'rect', x, y, w, h, fill }, more || {});
const PA = (d, o) => Object.assign({ t: 'path', d }, o || {});
const circ = (x, y, r) => `M${r2(x - r)} ${r2(y)}a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0Z`;
// The face's thin art goes into grouped paths — one <path> per colour and width, never one element per rule, tick, triangle or screw
// hole — so the module stays inside IMPL-8 §13.2's 700 DOM elements (review R2-F5: 753 with a <line> or <path> each). The same
// picture: a group is drawn after the plates it sits on (a later plate covered half of a neighbour's edge line, which the next card's
// own line drew again), and nothing else overlaps a rule, a ring or a triangle.
let TRI = '', RULE = '', SIDE = '', HOLE = '', RING = '';       // ▲ marks · EDGE rules · card and plate edges · plate screw holes · knob tick rings
const tri = (x, y) => { TRI += `M${r2(x)} ${r2(y - 1)}L${r2(x + 1.1)} ${r2(y + 1)}H${r2(x - 1.1)}Z`; };                        // ▲ rear-socket mark
const edgeV = (x, y0, y1) => { SIDE += `M${r2(x)} ${r2(y0)}V${r2(y1)}`; };                                                  // a card / plate edge line
const rule = (x0, x1, y) => { RULE += `M${r2(x0)} ${r2(y)}H${r2(x1)}`; };                                                     // a printed rule
const r3 = v => Math.round(v * 1000) / 1000;
const ring = (x, y, d, sweep, n) => { // a knob's printed tick ring: cv-panel's scaleSvg (r0 = d / 2 + 0.6, 1.4 long), as a path of its own
  const r0 = d / 2 + 0.6, r1 = r0 + 1.4;
  for (let i = 0; i < n; i++) {
    const a = (-sweep / 2 + sweep * i / (n - 1)) * Math.PI / 180, sn = Math.sin(a), cs = Math.cos(a);
    RING += `M${r3(x + sn * r0)} ${r3(y - cs * r0)}L${r3(x + sn * r1)} ${r3(y - cs * r1)}`;
  }
};

// the face: 482.6 × 152.4 mm; the five cards from x 25 on a 50 mm pitch, the two blank plates, the mixer (82 mm) from x 375
const FW = 482.6, FH = 152.4;
const CH = ['b', 's', '1', '2', '3'], NAMES = ['BASS DRUM', 'SNARE DRUM', 'TOM 1', 'TOM 2', 'TOM 3'], SHORT = ['BASS', 'SNARE', 'TOM 1', 'TOM 2', 'TOM 3'];
const CX0 = i => 25 + 50 * i;                                  // card i's left edge
const FLD = ['n', 't', 'b', 'd', 'm', 'c'], LEG = ['NOISE', 'TONE', 'BEND', 'DECAY', 'NOISE / TONE', 'CLICK / DRUM'];
const KY = [36.5, 56.5, 76.5], KD = 12.5;                        // the card knobs' rows (20 mm pitch: a ring of 6.75 mm clears the next row's legend)
const MY = [98, 113], MX = [-7.5, 7.5];                          // the memory keys: 15 mm pitch (the hit rule), key n at (n 1 / 3 left, 2 / 4 right)
const TY = [131, 139];                                           // the trimmer rows (memories 3 / 4), 8 mm apart: their 14 mm hit boxes are moved ∓ 3 mm
const SY = 48, LY = 90, MXS = i => 383 + 16 * i;                 // the mixer: SENSITIVITY row, LEVEL row; the channels' columns on a 16 mm pitch
const TOPJ = 9.8;                                                // the rear sockets' y (their ▲ legends over them)

/* ---------------------------------------------------------------- controls */
const knobs = CH.flatMap((ch, i) => FLD.map((f, j) => ({ id: 'x' + ch + f, kind: 'knob', x: CX0(i) + 25 + (j % 2 ? 11 : -11), y: KY[j >> 1], d: KD, sweep: 300, label: LEG[j], lab: 'none' })));
const keys = CH.flatMap((ch, i) => [1, 2, 3, 4].map(n => ({ id: 'dr:mem', kind: 'button', ch, n, x: CX0(i) + 25 + MX[(n - 1) & 1], y: MY[(n - 1) >> 1], w: 11, h: 11, led: 'cap', color: CREAM, onCap: String(n), label: 'MEMORY ' + n, lab: 'none' })));
const trims = CH.flatMap((ch, i) => [3, 4].map(m => ({ id: 'dr:trim', kind: 'button', ch, mem: m, x: CX0(i) + 26, y: TY[m - 3], w: 36, h: 5, d: 4.5, hit: [38, 14], hitOff: [0, m === 3 ? -3 : 3], label: 'TRIMMERS ' + m, lab: 'none' })));
const mixer = CH.flatMap((ch, i) => [['s', SY], ['l', LY]].map(([f, y]) => ({ id: 'x' + ch + f, kind: 'knob', x: MXS(i), y, d: 10.5, sweep: 300, label: f === 's' ? 'SENSITIVITY' : 'LEVEL', lab: 'none' })));

// the rear sockets: the five per-channel OUT jacks ('later': full contrast, cable-able with full patching), STEREO L / R, MONO, the
// HI-HAT PEDAL and the seven PAD IN sockets dimmed ("not emulated"), a TRIGGER IN under each card (dimmed)
const OUTS = CH.map((ch, i) => ({ kind: 'jack', x: CX0(i) + 25, y: TOPJ, d: 4.6, inert: 'later', label: SHORT[i] + ' OUT', lab: 'none' }));
const SOCK = [['STEREO L', 288], ['STEREO R', 301], ['MONO', 314], ['HI-HAT PEDAL', 335]];
const PADX = k => 381 + 11 * k;
const socks = [...SOCK.map(([label, x]) => ({ kind: 'jack', x, y: TOPJ, d: 4.6, inert: true, label, lab: 'none' })),
  ...Array.from({ length: 7 }, (_, k) => ({ kind: 'jack', x: PADX(k), y: TOPJ, d: 4.6, inert: true, label: 'PAD IN ' + (k + 1), lab: 'none' }))];
const trigs = CH.map((ch, i) => ({ kind: 'jack', x: CX0(i) + 10, y: 146.8, d: 4.4, inert: true, label: SHORT[i] + ' TRIGGER IN', lab: 'none' }));
// the optional modules' blank plates (their slots): dimmed, so a tap says what they are
const plates = [['HI-HAT', 300], ['CYMBAL', 350]].map(([s, x]) => ({ kind: 'slot', x, y: 84, w: 36, h: 80, inert: true, label: s + ' MODULE (optional on the original)', lab: 'none' }));

const controls = [...knobs, ...keys, ...trims, ...mixer, ...OUTS, ...socks, ...trigs, ...plates];
for (const k of [...knobs, ...mixer]) ring(k.x, k.y, k.d, k.sweep, 11);                                                        // (11 ticks each)

/* ---------------------------------------------------------------- decor */
const decor = [];

// --- the case: the rack ears (a lighter strip each side, two slotted screw holes) and the chassis lip
decor.push(R(0, 0, 18, FH, '#2e3135'), R(FW - 18, 0, 18, FH, '#2e3135'),
  PA(`M18 0V${FH}M${r2(FW - 18)} 0V${FH}`, { stroke: '#16171a', sw: 0.5 }), PA(`M18.5 0V${FH}M${r2(FW - 18.5)} 0V${FH}`, { stroke: '#43474c', sw: 0.3 }));
let SCREW = '';
for (const x of [9, FW - 9]) for (const y of [14, FH / 2, FH - 14]) // (a slot: a 5.2 × 8.4 mm stadium)
  SCREW += `M${r2(x - 2.6)} ${r2(y - 1.6)}A2.6 2.6 0 0 1 ${r2(x + 2.6)} ${r2(y - 1.6)}V${r2(y + 1.6)}A2.6 2.6 0 0 1 ${r2(x - 2.6)} ${r2(y + 1.6)}Z`;
decor.push(PA(SCREW, { fill: '#0c0d0e' }));

// --- the rear strip (y 0–13.5): a ▲ and a legend over each socket; the sockets are the controls
decor.push(R(18.5, 0, FW - 37, 13.4, '#202225'), PA(`M18.5 13.4H${r2(FW - 18.5)}`, { stroke: '#111214', sw: 0.5 }));
rule(18.5, FW - 18.5, 13.9);
CH.forEach((ch, i) => { tri(CX0(i) + 25, 2.6); decor.push(T(CX0(i) + 25, 6, SHORT[i] + ' OUT', 2)); });
SOCK.forEach(([s, x]) => { tri(x, 2.6); decor.push(T(x, 6, s, 2, { fill: DIM })); });
for (let k = 0; k < 7; k++) { tri(PADX(k), 2.6); decor.push(T(PADX(k), 6, 'PAD ' + (k + 1), 2, { fill: DIM })); }
decor.push(PA(TRI, { fill: DIM }));

// --- the five voice cards: a dark plate, a name plate, legends over the knobs, MEMORY and TRIM print, the TRIGGER IN legend
CH.forEach((ch, i) => {
  const x0 = CX0(i), cx = x0 + 25;
  decor.push(R(x0, 14.4, 50, FH - 14.4, PLATE), R(x0 + 2, 15.6, 46, 6.2, BAR, { r: 0.6 }), T(cx, 20, NAMES[i], 3, { ls: 0.3 }));
  edgeV(x0, 14.4, FH); edgeV(x0 + 50, 14.4, FH);
  FLD.forEach((f, j) => decor.push(T(cx + (j % 2 ? 11 : -11), r2(KY[j >> 1] - 9.4), LEG[j], 2, { weight: 600 })));
  rule(x0 + 5, x0 + 18, 89.4); rule(x0 + 32, x0 + 45, 89.4); decor.push(T(cx, 90.4, 'MEMORY', 2, { fill: DIM, weight: 600 }));
  decor.push(T(cx, 125.2, 'TRIM', 1.9, { fill: DIM, weight: 600 }), T(x0 + 4.2, 132.4, '3', 2.2), T(x0 + 4.2, 140.4, '4', 2.2));
  rule(x0 + 5, x0 + 45, 144.4); decor.push(T(x0 + 30, 147.5, 'TRIGGER IN', 2, { fill: DIM, weight: 600 }));
});

// --- the two blank plates: the optional HI-HAT and CYMBAL modules' slots (later: our own sounds through their loop circuit)
[['HI-HAT', 300], ['CYMBAL', 350]].forEach(([s, x]) => {
  decor.push(R(x - 25, 14.4, 50, FH - 14.4, BLANK), R(x - 23, 15.6, 46, 6.2, '#26282b', { r: 0.6 }), T(x, 20, s, 3, { fill: DIM, ls: 0.3 }),
    T(x, 30, 'OPTIONAL MODULE', 2, { fill: '#6c6e70', weight: 600 }));
  edgeV(x - 25, 14.4, FH); edgeV(x + 25, 14.4, FH);
  HOLE += circ(x - 20, 147.4, 1.5) + circ(x + 20, 147.4, 1.5);
});
decor.push(PA(HOLE, { fill: '#2a2c30' }));

// --- the mixer: a name plate, SENSITIVITY and LEVEL for each channel (their names over the knobs), the model's name in plain type
decor.push(R(375, 14.4, 82, FH - 14.4, PLATE), R(377, 15.6, 78, 6.2, BAR, { r: 0.6 }), T(416, 20, 'MIXER', 3, { ls: 0.3 }));
edgeV(375, 14.4, FH); edgeV(457, 14.4, FH);
for (const [y, s] of [[SY, 'SENSITIVITY'], [LY, 'LEVEL']]) {
  decor.push(T(416, r2(y - 19.2), s, 2.4, { ls: 0.2 })); rule(379, 453, r2(y - 17.2));
  CH.forEach((ch, i) => decor.push(T(MXS(i), r2(y - 9.6), SHORT[i], 2, { fill: DIM, weight: 600 })));
}
rule(379, 453, 106);
decor.push(T(416, 126.4, 'SDS-V', 8.4, { ls: 0.5 }), T(416, 133, 'ANALOG DRUM SYNTHESIZER', 2.2, { fill: DIM, weight: 600 }),
  T(416, 146.4, '5 CHANNELS · 4 MEMORIES EACH', 2, { fill: DIM, weight: 600 }));

// --- the grouped thin art, over the plates: the printed rules, the card and plate edges, the knobs' tick rings
decor.push(PA(RULE, { stroke: EDGE, sw: 0.3 }), PA(SIDE, { stroke: '#2d3034', sw: 0.3 }), PA(RING, { stroke: WHT, sw: 0.32 }));

export default {
  v: 1,
  id: 'sdsv',
  hw: 'SDS-V analog drum synthesizer (1981): the brain\'s face (19 × 6 in), its rear-socket strip and the five voice cards',
  case: '#101112',
  scheme: {
    panel: FACE, legend: WHT, rule: EDGE, accent: LEDC, font: 'sans',
    knob: { skirt: '#d6d8d4', cap: '#d6d8d4', ptr: '#15171a', ptrStyle: 'line', capR: 0.74 },
    button: { cap: CREAM, led: LEDC, ledOff: '#4a1612', text: '#2a2418' },
    jack: { nut: '#9ea1a4', hole: '#08090a' },
    trim: { body: '#b9bcbf', rim: '#55595d', slot: '#26282b' },
  },
  areas: [{ id: 'main', src: [0, 0, FW, FH], at: [0, 0], r: 2 }],
  sections: [
    ...CH.map((ch, i) => ({ id: 'c' + ch, label: NAMES[i], x: CX0(i), y: 14.4, w: 50, h: FH - 14.4, frame: 'none', title: 'none' })),
    { id: 'mix', label: 'MIXER', x: 375, y: 14.4, w: 82, h: FH - 14.4, frame: 'none', title: 'none' },
  ],
  controls,
  decor,
  extras: { ids: ['dr:pads', 'dr:map', 'dr:sounds', 'dr:trimMenu'] },
  notes: [
    'Source: IMPL-8.md §13.1 and research-sdsv-circuits.md §1 / §4 (the facts: a 19-inch rack brain, ≈ 19 × 6 × 7 in, up to seven module slots and a mixer, five modules fitted as standard, per channel six knobs, four memory keys, two rows of front trimmers, a rear socket field). No photograph was fetched or committed (viewing needs a download, which the user has not approved): the positions below are the contract\'s fallback layout (§13.1) as drawn in mm, ESTIMATES, not measurements. A pass with a published photograph (viewing only: the mm of the cards, the knob rows, the key square, the trimmer rows) can retune them without touching a control id; the hit-rule constraints below must stay.',
    'Geometry [C]: the face 482.6 × 152.4 mm (→ a 992 px module: 965 px centred, ceil32; 992 × 640 with the 288 px extras strip); rack ears 18 mm each (two slotted screw holes); the rear strip y 0–13.4; the five cards x 25 + 50 i (50 mm), the HI-HAT / CYMBAL blanking plates x 275 / 325, the MIXER x 375–457 (82 mm); a card\'s name plate y 15.6–21.8, the knobs on a 22 mm column pitch (x + 14 / x + 36) and 20 mm rows (y 36.5 / 56.5 / 76.5; d 12.5 mm, an 11-tick ring), the four memory keys 11 × 11 mm squares on a 15 mm pitch (key 1 top left: y 98 / 113; the digit on the cap under the LED), the two trimmer rows (six 4.5 mm trimmers across 36 mm) at y 131 / 139, TRIGGER IN print at y 146.8; the mixer\'s columns on a 16 mm pitch (x 383 + 16 i), SENSITIVITY at y 48 and LEVEL at y 90 (d 10.5 mm).',
    'The 14 mm hit rule (§7.1 of IMPL-7a): every live hit box ≥ 14 mm and disjoint — the knobs 15 mm default boxes on 22 / 20 mm pitches, the mixer\'s on 16 / 42 mm, the memory keys 15 mm (the pitch), the two trimmer rows 8 mm apart with `hit [38, 14]` and `hitOff` ∓ 3 mm (memory 3\'s box 14 mm up-centred on y 128, memory 4\'s on y 142: 121–135 / 135–149; the keys\' lowest box ends at 120.5).',
    'Sockets: the five per-channel OUT jacks (BASS … TOM 3, at the cards\' centres) are `inert: \'later\'` — drawn at full contrast, "cable-able with full patching (stage 4)"; the SDS-V has one mix output (D3). STEREO L / R, MONO, HI-HAT PEDAL, PAD IN 1–7 (the rear field, drawn in the top strip: our placement) and a TRIGGER IN under each card are dimmed inert jacks ("not emulated"). The two optional modules (HI-HAT, CYMBAL: IMPL-8 §16 Q7, later) are blank plates with a dimmed inert slot each. The knobs, memory keys and trimmer rows are the only live controls besides the extras.',
    'Print and glyphs are ours: the cards\' name plates and the knobs\' legends are decor; the model name is plain type "SDS-V" on the mixer plate (no wordmark, no logo, no maker name: D4); the memory keys are cream squares with a red LED in the cap and the digit under it; the trimmers are drawn by cv-panel\'s `trimSvg` (metal discs with screwdriver slots, static: TRIM… shows the values). Colours are estimates: face #25272a, card plates #1c1e21, light-grey knobs with a dark line, cream keys, red LEDs.',
    'Sections: the five cards (BASS DRUM … TOM 3) then the MIXER, left to right, so the Tab order reads card by card (its six knobs, its memory keys 1 2 / 3 4, its trimmer rows 3 / 4), then the mixer\'s SENSITIVITY row and LEVEL row. The memory switches x?p are never placed on their own: each channel\'s four dr:mem keys write it (IMPL-8 §17 P1a).',
  ],
};
