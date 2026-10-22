import './v8-guard.mjs';
// cv-panel.js (ENGINE lane; docs/canvas/IMPL-panels.md §9.1): the layout format (a fixture layout + one mutation per
// rule), every authored panels/<model>.js (valid, every models.js id exactly once, the §10 extras, sizes on the dots, hit
// boxes ≥ 28 px and disjoint, original artwork), the renderer on tests/wk-dom.mjs with a fake api (one .hw-c per live
// control in section order, ui registration, redraws, null positions skipped, level rockers, combos, the two-finger
// rollback, no renderer widget classed as a plain knob / slider) and determinism (the hardware layout always comes back
// exactly). Models whose layout is still null are skipped, each by name. Never pass fake-DOM nodes to assert.*.
// Stage 1i (IMPL-1i §2, §9): the keys / wheel / lever / ribbon / pad kinds and the shared perf: tokens (one mutation per
// rule, a model without a token table, the DX7's mixed dx: / perf: tokens), o.bed unrounded and its clamped front band,
// the bed as one hit box; per model: the §1.2 bed, the 1i sizes (pinned from lane K2's hand-back); render with a fake
// api.perf (the nodes, zones, roles, shades at the art, a press's velocity, the velocity note, the tips, destroy → release)
// and without one (the same nodes, silent), the keys' and controllers' art, the TB-303's audition (§6.4).
// Stage 7a (IMPL-7a §11, §12.7): HW_IDS gains tr808 (its layout is lane P2's panels/tr808.js), its §3.6 extras, TARGET
// 1024 × 1024, no keyboard, its 'later' jacks titled "cable-able with full patching"; the dr: token rules: tests/cv-drum.test.mjs.
// Stage 7b (IMPL-7b §7, §12.7): HW_IDS gains tr606 (lane X's panels/tr606.js), its extras (the eleven TUNE / DECAY knobs among
// the §3.7 tokens), TARGET 608 × 864, no keyboard; a rotary's `rot` (its sweep's centre: the art and the widget turn by it).
// Stage 7c (IMPL-7c §7, §12.7–§12.8): HW_IDS gains tr909 (lane X's panels/tr909.js), its extras (the §3.7 tokens: no SWING, no
// knobs — every models.js control on the face), TARGET 992 × 1024, no keyboard; its token rules: tests/cv-drum.test.mjs.
// Stage 8 (IMPL-8 §13, §15.9): HW_IDS gains sdsv (lane X's panels/sdsv.js), its extras (the hexagonal pads, MAP…, SOUNDS…,
// TRIM…: every models.js control on the face — the memory switches through their keys), TARGET 992 × 640, no keyboard; its
// own caption read on the plain estimate: 8 px (585's list); its token rules: tests/cv-drum.test.mjs.
// Stage 9 (IMPL-9 §4.1–§4.2, §8.4): HW_IDS gains m900 (the 900 Series' console, lane P9's panels/m900.js), no extras, PINNED
// 864 × 352, no keyboard (the keys tray plays it); the live patch jacks (one mutation per rule: a jack without port, a bad /
// duplicate port, a port the type lacks, a socket of the wrong kind, an id, inert, no label, one missing, centres < 15 mm,
// < 9 mm from a hit box, a port on a knob), geometry().jacks (body px = the layout's mm × 2 + the centring, the table's
// labels, each one's widest hit circle), the nine module faces (moduleModel / moduleLayout: valid, §2.2's sizes = moog-core's
// w / h, ports = the type's jack ids, original art) and a module face rendered over a fake per-instance api (vals.p[mid]).
// Stage 9b (IMPL-9b §4.1–§4.2, §8.4): the module faces 10 → 26 (panels/m900b.js: the 4 / 8 MU and the console-height sizes;
// moduleModel for every type but the controller, with its ev / lamps); one mutation per new rule (an event button: kind,
// id, inert, cycle, not the type's, twice, missing, its hit box, its overlap and jack clearance; a live lamp: kind, id, not
// the type's, twice, missing; a rear terminal placed; lite off a patch face, a lite fin pointer; a face with no params and
// no jacks valid), geometry().evs / .lamps, the art (event caps, unlit lamps, a lite face's skirts and caps, a patch face's
// inert parts without an extras strip), the lite live layer (3 elements a control: the 960's 121, the 914's 43).
// Run alone: node --max-old-space-size=2048 --test tests/cv-panel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../cv-panel.js?v=9';
import { MODELS } from '../models.js?v=9';
import { BAR_H } from '../cv-module.js?v=9';
import { DOT } from '../cv-world.js?v=9';
import { fresh, all, ptr, fire, key, place as placeEl, raf as rafQ } from './wk-dom.mjs';
import { TB_FX, DX_FX } from './fixtures/panels.mjs';
import * as wk from '../wk.js?v=9';
import { bedLayout, seqNote, seqVel, velOf } from '../cv-keys.js?v=9';
import * as MG from '../moog-core.js?v=9';

const modelOf = id => MODELS.find(m => m.id === id);
const clone = x => JSON.parse(JSON.stringify(x));
const authored = P.HW_IDS.filter(id => P.layoutOf(id));
const missing = P.HW_IDS.filter(id => !P.layoutOf(id));
// §10: the extras of every model; the module sizes (pinned from the authors' hand-back notes; else the target ± a dot)
const EXTRAS = {
  modular: ['kb'], minimoog: [], arp2600: ['sy', 'kb', 'lw', 'src', 'gl'], solina: ['tn'], cs80: [], prophet5: ['li', 'rev', 'ud'], ms20: [],
  tb303: ['al', 'seq:sync', 'seq:swing', 'seq:random', 'seq:demo', 'seq:toRoll', 'seq:grid'], obxa: ['lc', 'ud'], jupiter8: ['pw'], juno60: ['hs'], dx7: ['dac'],
  tr808: ['dr:grid', 'dr:pads', 'dr:sync', 'dr:swing', 'dr:toRoll', 'dr:rec', 'dr:map', 'dr:sounds', 'dr:demo'], // (7a §3.6, §7.5: every models.js control is on the face)
  tr606: ['dr:grid', 'dr:pads', 'dr:sync', 'dr:swing', 'bdu', 'bdd', 'sdu', 'sdd', 'ltu', 'ltd', 'htu', 'htd', 'cyd', 'ohd', 'chd', 'dr:toRoll', 'dr:rec', 'dr:map',
    'dr:sounds', 'dr:demo', 'dr:link'], // (7b §3.7, §7.5: the face's seven knobs; our eleven TUNE / DECAY in the strip)
  tr909: ['dr:grid', 'dr:pads', 'dr:sync', 'dr:toRoll', 'dr:rec', 'dr:map', 'dr:sounds', 'dr:demo'], // (7c §3.7, §7.5: the 28 knobs on the face, §13 Q3)
  sdsv: ['dr:pads', 'dr:map', 'dr:sounds', 'dr:trimMenu'], // (8 §13.3: the 40 knobs on the face, the memory switches through dr:mem; no sequencer)
  m900: [], // (9 §2.4: the controller's nine controls on its console)
};
// (7a, IMPL-7a §11) TARGET.tr808: the 1016 × ≈ 1020 px box on the 32 px dots (± a dot until lane P2's hand-back pins it);
// (7b §7.1) TARGET.tr606: 300 mm → 608 px; the face ≈ 290 + the strip 16 + 192 + 116 + 3 × 64 + 8 = 524 + the bar → 864;
// (7c §7.1) TARGET.tr909: 486 mm → 992 px; the face 600 + the strip 16 + 272 + 64 + 8 = 360 + the bar → 1024 (P1a's geometry)
// (8 §13.1) TARGET.sdsv: 482.6 mm → 992 px; the face 304.8 + the strip 16 + 200 + 64 + 8 = 288 + the bar → 640 (P1a's geometry:
// any face 140.1–156 mm deep)
const TARGET = { modular: [1728, 960], minimoog: [1408, 512], arp2600: [1568, 928], solina: [1984, 256], cs80: [2432, 768], prophet5: [1920, 512],
  ms20: [1120, 416], tb303: [608, 608], obxa: [2048, 576], jupiter8: [2144, 608], juno60: [2144, 416], dx7: [2048, 480], tr808: [1024, 1024], tr606: [608, 864], tr909: [992, 1024],
  sdsv: [992, 640], m900: [864, 352] };
// models without a keyboard (IMPL-1i §1.2: the TB-303's 13 key cells; 7a / 7b: the drum machines' step keys and pads; 9: the
// 900 Series' console — the bottom keys tray plays it)
const NOKEYS = ['tb303', 'tr808', 'tr606', 'tr909', 'sdsv', 'm900'];
const PINNED = { minimoog: [1408, 512], m900: [864, 352] }; // ((9 §2.2) the console: 8 MU × 142.875 mm → 864 × 352)
// (1i, IMPL-1i §1.2) once a model has its bed: the sizes with the keyboards (± a dot until K2's hand-back pins them), the
// ARP's PORTAMENTO on its 3620 slider (out of the extras), each bed's range [lo, n]; the TB-303 has none
const TARGET_1I = { modular: [2176, 1280], minimoog: [1408, 736], arp2600: [1856, 1344], solina: [1984, 448], cs80: [2432, 1024], prophet5: [1920, 864],
  ms20: [1120, 704], tb303: [608, 608], obxa: [2048, 928], jupiter8: [2144, 928], juno60: [2144, 800], dx7: [2048, 800] };
const PINNED_1I = { modular: [2176, 1280], minimoog: [1408, 736], arp2600: [1856, 1344], solina: [1984, 448], cs80: [2432, 1024], prophet5: [1920, 864],
  ms20: [1120, 704], tb303: [608, 608], obxa: [2048, 928], jupiter8: [2144, 928], juno60: [2144, 800], dx7: [2048, 800] }; // (lane K2's hand-back, a8ceaf6)
const EXTRAS_1I = { arp2600: ['sy', 'kb', 'lw', 'src'] };
const BED = { modular: [36, 61], minimoog: [29, 44], arp2600: [36, 49], solina: [36, 49], cs80: [36, 61], prophet5: [36, 61], ms20: [48, 37],
  obxa: [36, 61], jupiter8: [36, 61], juno60: [36, 61], dx7: [36, 61] };
const bedOf = L => (L.controls || []).find(c => c && c.id === 'perf:keys') || null;
// §10 section order where it is pinned (the reference layout)
const SECTIONS = { minimoog: ['controllers', 'oscbank', 'mixer', 'modifiers', 'output', 'power', 'lefthand'] };

/* ---------------------------------------------------------------- a fixture model + layout (every widget kind) */
const FX_MODEL = {
  id: 'fixture', name: 'Fixture', theme: { knob: 'std' },
  controls: [
    { t: 'k', id: 'cut', label: 'Cutoff', min: 0, max: 10, def: 5 },
    { t: 's', id: 'rng', label: 'Range', opts: ['A', 'B', 'C', 'D'], def: 1 },
    { t: 'b', id: 'on', label: 'On', def: 0 },
    { t: 'k', id: 'saw', label: 'Saw', min: 0, max: 1, def: 0 },
    { t: 's', id: 'cho', label: 'Chorus', opts: ['Off', 'I', 'II', 'I+II'], def: 0 },
    { t: 's', id: 'wav', label: 'Wave', opts: ['Tri', 'Saw', 'Sq'], def: 0 },
    { t: 'k', id: 'vol', label: 'Volume', min: 0, max: 10, def: 8 },
    { t: 's', id: 'nz', label: 'Noise', opts: ['White', 'Pink'], def: 0 },
    { t: 'k', id: 'trk', label: 'Track', min: 0, max: 1, def: 0, step: 0.5 },
    { t: 'k', id: 'mod', label: 'Mod amount', min: 0, max: 10, def: 0 },
    { t: 'b', id: 'xtra', label: 'Extra', def: 0 },
  ],
};
const FX_LAYOUT = {
  v: 1, id: 'fixture', hw: 'fixture', case: '#202020',
  scheme: { panel: '#111111', legend: '#eeeeee', knob: { skirt: '#111', cap: '#999', ptr: '#fff', ptrStyle: 'line', capR: 0.6 }, rocker: { blue: '#4585b5' } },
  areas: [{ id: 'main', src: [0, 0, 300, 100], at: [0, 0] }, { id: 'aux', src: [0, 0, 60, 30], at: [0, 108] }],
  sections: [
    { id: 'a', label: 'ONE', x: 0, y: 0, w: 150, h: 100, frame: 'box', title: 'top' },
    { id: 'b', label: 'TWO', x: 150, y: 0, w: 150, h: 100, frame: 'header', title: 'header' },
    { id: 'c', label: 'AUX', a: 'aux', x: 0, y: 0, w: 60, h: 30, frame: 'none', title: 'none' },
  ],
  controls: [
    { id: 'cut', kind: 'knob', x: 30, y: 30, d: 24, sweep: 300, label: 'CUTOFF', scale: { n: 11, labels: ['0', '', '', '', '', '5', '', '', '', '', '10'] } },
    { id: 'rng', kind: 'rotary', x: 80, y: 30, d: 20, sweep: 150, legends: ['A', 'B', 'X', 'C', 'D'], map: [0, 1, null, 2, 3], label: 'RANGE' },
    { id: 'on', kind: 'switch', style: 'rocker', orient: 'h', x: 120, y: 30, w: 20, h: 10, color: 'blue', label: 'ON' },
    { id: 'saw', kind: 'switch', style: 'rocker', orient: 'v', level: true, x: 30, y: 75, w: 10, h: 20, label: 'SAW' },
    { id: 'cho', kind: 'buttons', x: 80, y: 75, w: 14, h: 10, at: [{ v: 0, x: 65, y: 75, label: 'OFF' }, { v: 1, x: 82, y: 75, label: 'I' }, { v: 2, x: 99, y: 75, label: 'II' }], combo: { 3: [1, 2] }, label: 'CHORUS' },
    { id: 'wav', kind: 'jacks', x: 180, y: 30, d: 8, at: [{ v: 0, x: 170, y: 30, label: 'TRI' }, { v: 1, x: 188, y: 30, label: 'SAW' }, { v: 2, x: 206, y: 30, label: 'SQ' }] },
    { id: 'vol', kind: 'slider', orient: 'h', x: 200, y: 75, len: 40, cap: [10, 6], label: 'VOLUME' },
    { id: 'nz', kind: 'slider', x: 260, y: 60, len: 30, cap: [10, 6], legends: ['WHITE', 'PINK'], label: 'NOISE' },
    { id: 'trk', kind: 'button', x: 260, y: 20, w: 14, h: 10, cycle: [0, 0.5, 1], ledLevels: ['off', 'dim', 'on'], led: 'cap', label: 'TRACK' },
    { id: 'mod', kind: 'knob', a: 'aux', x: 20, y: 15, d: 16, label: 'MOD' },
    { kind: 'led', of: 'on', when: ['ne', 0], x: 135, y: 30, d: 3 },
    { kind: 'knob', x: 130, y: 75, d: 20, inert: true, label: 'TUNE' },
    { kind: 'jack', x: 290, y: 90, d: 7, inert: true, label: 'OUT' },
  ],
  decor: [
    { t: 'line', x1: 150, y1: 0, x2: 150, y2: 100, sw: 0.5 },
    { t: 'text', x: 150, y: 96, s: 'Fixture', size: 3, anchor: 'middle' },
    { t: 'glyph', g: 'wave:saw', x: 40, y: 92, size: 4 },
    { t: 'path', d: 'M10 10L20 20', stroke: '#ffffff' },
  ],
  extras: { ids: ['xtra'] },
};

/* ---------------------------------------------------------------- the format */
test('format: PX_PER_MM = 2 and the contract constants; the fixture layout validates', () => {
  assert.deepEqual([P.FORMAT, P.PX_PER_MM, P.HIT_MIN_MM, P.HIT_DEF_MM, P.SEAM_MM, P.BAND_MAX_MM, P.XROW, P.XCAP], [1, 2, 14, 15, 8, 24, 64, 16]);
  assert.deepEqual([P.XCELL.k, P.XCELL.b, P.XCELL.s(2), P.XCELL.s(4), P.SEQ_GRID.w, P.SEQ_GRID.h], [72, 72, 120, 224, 576, 192]);
  // a selector cell grows with long option names (Prophet-5 FILTER: two ~87 px pills in a row overlapped UNI DETUNE in 120)
  assert.deepEqual([P.selCellW(['Off', 'On']), P.selCellW(['Sine', 'Tri', 'Square', 'S&H'])], [120, 224]);
  assert.ok(P.selCellW(['Rev 2 · SSM', 'Rev 3 · CEM']) >= 16 + 2 * 87 + 3);
  assert.deepEqual(P.validate(FX_LAYOUT, FX_MODEL), []);
  assert.deepEqual(P.HW_IDS, ['modular', 'minimoog', 'arp2600', 'solina', 'cs80', 'prophet5', 'ms20', 'tb303', 'obxa', 'jupiter8', 'juno60', 'dx7', 'tr808', 'tr606', 'tr909', 'sdsv', 'm900']); // (7a / 7b / 7c / 8: the drum machines last, as in MODELS; 9: then the 900 Series' console)
  if (missing.length) console.log('# cv-panel: not drawn yet (skipped, Resizable only): ' + missing.join(', '));
});

test('validate: each broken rule is reported (one mutation per rule), naming the field', () => {
  const bad = (f, re, m) => {
    const L = clone(FX_LAYOUT);
    f(L);
    const p = P.validate(L, FX_MODEL);
    assert.ok(p.some(x => re.test(x)), (m || re) + ' → ' + JSON.stringify(p));
  };
  bad(L => { L.v = 2; }, /^v: /);
  bad(L => { L.id = 'other'; }, /^id: /);
  bad(L => { L.areas[0].id = 'face'; }, /areas\[0\]: its id must be "main"/);
  bad(L => { L.areas[1].src = [0, 0, -1, 4]; }, /areas\[1\]: src/);
  bad(L => { L.sections[0].x = 200; }, /sections\[0\]: outside its area/);
  bad(L => { L.sections.push({ id: 'a', label: 'X', x: 0, y: 0, w: 1, h: 1 }); }, /a unique id/);
  bad(L => { L.controls[0].x = 299; }, /controls\[0\] \(cut\): outside its area/);
  bad(L => { L.controls[0].id = 'nope'; }, /"nope" is not a control of the model/);
  bad(L => { L.controls.push({ id: 'cut', kind: 'knob', x: 260, y: 90, d: 10 }); }, /cut: placed 2 times/, 'exactly once');
  bad(L => { L.extras.ids = []; }, /xtra: not placed/, 'every id somewhere');
  bad(L => { L.controls[2].kind = 'knob'; L.controls[2].d = 10; }, /a knob cannot carry a "b" control/, 'kind per type');
  bad(L => { L.controls[1].map = [0, 1, null, 2, 9]; }, /9 is not a value of rng/, 'map values');
  bad(L => { L.controls[1].legends = ['A', 'B']; }, /2 legends for 5 positions/);
  bad(L => { L.controls[0].hit = [10, 20]; }, /hit box 10 × 20 mm < 14 mm/);
  bad(L => { L.controls[2].x = 92; }, /hit boxes overlap/, 'disjoint hit boxes');
  bad(L => { L.controls[0].label = 'Moog CUTOFF'; }, /a maker name/, 'no maker name');
  bad(L => { L.decor.push({ t: 'text', x: 1, y: 1, s: 'by Roland' }); }, /a maker name/);
  bad(L => { L.decor.push({ t: 'path', d: 'M0 0 url(#x)' }); }, /path data/);
  bad(L => { L.decor.push({ t: 'glyph', g: 'wave:bogus', x: 5, y: 5, size: 3 }); }, /unknown glyph/);
  bad(L => { L.controls[4].combo = { 3: [1, 7] }; }, /combo 3/);
  bad(L => { L.controls.push({ kind: 'knob', x: 260, y: 90, d: 6, id: 'vol', inert: true }); }, /an inert control has no id/);
  bad(L => { L.controls[3].level = false; }, /a "k" switch needs map or level/);
  bad(L => { L.areas[0].src[2] = 2100; L.sections[1].w = 1950; }, /content: 2100 × 138 mm > 2000 × 1000/);
  bad(L => { L.decor = Array.from({ length: 3001 }, () => ({ t: 'line', x1: 0, y1: 0, x2: 1, y2: 1 })); }, /decor: 3001 items > 3000/);
  bad(L => { L.controls[9].x = 40; L.controls[9].hit = [14, 14]; L.controls[9].a = 'aux'; L.sections[2].w = 20; }, /not inside a section/);
  bad(L => { L.extras.at = [0, 0, 40, 20]; }, /extras.at: overlaps area "main"/);
  assert.ok(P.validate(Object.assign(clone(FX_LAYOUT), { controls: [] }), FX_MODEL).length > 5, 'nothing placed');
  assert.deepEqual(P.validate(null, FX_MODEL), ['layout: not an object']);
});

test('geometry: mm → body px at 2 px/mm, content centred, W / H on the dots, the bar in H; hit boxes grow to 15 mm; the Tab order is sections, then rows, then x', () => {
  const g = P.geometry(FX_LAYOUT, FX_MODEL), s = P.sizeOf(FX_LAYOUT, FX_MODEL);
  // content 300 × 138 mm → 600 × 276 px; W = 608 (centred: 4 px each side); the extras strip 16 + 64 + 8 → H = ceil32(40 + 276 + 88) = 416
  assert.deepEqual([g.W, g.content.x, g.content.w, g.content.h], [608, 4, 600, 276]);
  assert.deepEqual(s, { w: 608, h: 416 });
  assert.equal(s.w % DOT + s.h % DOT, 0);
  assert.deepEqual(g.extras && [g.extras.x, g.extras.y, g.extras.w, g.extras.h, g.extras.cells.map(c => [c.id, c.x, c.y, c.w, c.h])], [0, 276, 608, 88, [['xtra', 8, 292, 72, 64]]]);
  const cut = g.controls[0];
  assert.deepEqual([cut.box.w, cut.own.w, cut.hit.w, cut.box.x, cut.box.y], [61.5, 48, 48, 33.5, 29.5], 'the knob box draws its skirt at d (61.44 → half px)');
  const on = g.controls[2];
  assert.deepEqual([on.hit.w, on.hit.h], [40, 30], 'a 20 × 10 mm rocker: hit 20 × 15 mm');
  assert.deepEqual(g.controls[9].cx === 20 && g.controls[9].cy === 123, true, 'an aux area maps its frame onto the content');
  assert.deepEqual(g.order.map(i => FX_LAYOUT.controls[i].id || FX_LAYOUT.controls[i].kind), ['cut', 'rng', 'on', 'led', 'saw', 'cho', 'trk', 'wav', 'nz', 'vol', 'mod']);
  const hb = P.hitBoxes(FX_LAYOUT, FX_MODEL);
  assert.equal(hb.filter(h => h.id === 'cho').length, 3, 'a buttons control: one hit box per button');
});

/* ---------------------------------------------------------------- (1i) the keyboards and the performance controls */
// the fixture with a bed (13 keys C4…C5 under a 10 mm lip) and two wheels on plates of their own (FX_MODEL has no token table)
const FX_KEYS = (() => {
  const L = clone(FX_LAYOUT);
  L.areas.push({ id: 'ctl', src: [0, 0, 60, 110], at: [0, 146] }, { id: 'keys', src: [0, 0, 200, 110], at: [62.3, 146] });
  L.sections.push({ id: 'wh', label: '', a: 'ctl', x: 0, y: 0, w: 60, h: 110, frame: 'none', title: 'none' }, { id: 'kb', label: '', a: 'keys', x: 0, y: 0, w: 200, h: 110, frame: 'none', title: 'none' });
  L.controls.push(
    { id: 'perf:bend', kind: 'wheel', a: 'ctl', x: 18, y: 50, w: 20, h: 60, orient: 'v', detent: true, skin: { slot: '#0a0a0a', surface: '#222' } },
    { id: 'perf:mod', kind: 'wheel', a: 'ctl', x: 42, y: 50, w: 20, h: 60 },
    { id: 'perf:keys', kind: 'keys', a: 'keys', x: 100, y: 50, n: 13, lo: 60, pitch: 23.5, len: 100, at: true, skin: { white: '#f4efe2', black: '#151515' } });
  L.scheme.keys = { white: '#f0ebe0', black: '#111', gap: '#000' };
  return L;
})();
const KEYS_I = FX_KEYS.controls.findIndex(c => c.id === 'perf:keys');
const isQ3 = v => typeof v === 'number' && Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;
// a bed's geometry: bedLayout × 2 + its area's offset, unrounded (three decimals); one hit box (keys + band); the band
// within 0…FRONT_MM, clear of the extras strip and every other live hit box, inside the body
function bedChecks(L, model, name) {
  const g = P.geometry(L, model), i = L.controls.findIndex(c => c && c.id === 'perf:keys'), c = L.controls[i], o = g.controls[i], ob = o.bed;
  assert.ok(ob && o.live, name + ': o.bed');
  const ar = L.areas.find(a => a.id === (c.a || 'main')), B = bedLayout(c, ob.front / 2);
  const bx = g.mm.offX + (c.x - ar.src[0] + ar.at[0] - B.w / 2 - g.mm.x0) * 2, by = (c.y - ar.src[1] + ar.at[1] - B.h / 2 - g.mm.y0) * 2, q = v => Math.round(v * 1000) / 1000;
  assert.deepEqual([ob.lo, ob.hi, ob.n, ob.whites, ob.x, ob.y, ob.w, ob.h], [B.lo, B.hi, B.n, B.whites, q(bx), q(by), q(B.w * 2), q(B.h * 2)], name + ': the keys\' rectangle');
  assert.equal(ob.keys.length, c.n);
  let off = 0;
  ob.keys.forEach((k, j) => { const b = B.keys[j]; if (k.note !== b.note || k.black !== b.black || k.x !== q(bx + b.x * 2) || k.y !== q(by + b.y * 2) || k.w !== q(b.w * 2) || k.h !== q(b.h * 2)) off++; });
  assert.equal(off, 0, name + ': every key = bedLayout × 2 + the offset (three decimals)');
  const nums = [ob.x, ob.y, ob.w, ob.h, ob.front, ...ob.keys.flatMap(k => [k.x, k.y, k.w, k.h])];
  assert.equal(nums.filter(v => !isQ3(v)).length, 0, name + ': three decimals');
  assert.ok(ob.front >= 0 && ob.front <= 16, name + ': front ' + ob.front);
  assert.deepEqual([ob.band.x, ob.band.y, ob.band.w, ob.band.h], [ob.x, q(by + B.h * 2), ob.w, ob.front], name + ': the band in front of the keys');
  assert.deepEqual([ob.box.x, ob.box.y, ob.box.w, ob.box.h], [ob.x, ob.y, ob.w, q((B.h + B.front) * 2)], name + ': box = keys + band');
  const hb = P.hitBoxes(L, model), mine = hb.filter(h => h.id === 'perf:keys');
  assert.equal(mine.length, 1, name + ': the bed is one hit box');
  assert.deepEqual([mine[0].x, mine[0].y, mine[0].w, mine[0].h], [ob.box.x, ob.box.y, ob.box.w, ob.box.h]);
  assert.ok(ob.box.y + ob.box.h <= g.body.h + 1e-9, name + ': inside the body');
  const X = g.extras, across = r => r.x < ob.x + ob.w - 1e-6 && ob.x < r.x + r.w - 1e-6;
  if (X && across(X) && X.y + X.h > ob.y + ob.h + 1e-6) assert.ok(ob.box.y + ob.box.h <= Math.max(X.y, ob.y + ob.h) + 1e-6, name + ': the band stops at the extras strip');
  for (const h of hb) if (h.id !== 'perf:keys' && across(h) && h.y + h.h > ob.y + ob.h + 1e-6) assert.ok(ob.box.y + ob.box.h <= Math.max(h.y, ob.y + ob.h) + 1e-6, `${name}: the band stops at ${h.id}`);
  return { g, o, ob, B };
}

test('1i validate: the keys / wheel / lever / ribbon / pad kinds with the perf: tokens validate on a model without a token table; usable(); one mutation per §2 rule, naming the field', () => {
  assert.deepEqual(P.validate(FX_KEYS, FX_MODEL), []);
  assert.deepEqual(Object.keys(P.PERF_TOKENS.kind), ['perf:keys', 'perf:bend', 'perf:mod']);
  for (const t of ['perf:keys', 'perf:bend', 'perf:mod']) assert.ok(P.RENDERED_TOKENS.has(t), t + ' rendered');
  for (const k of ['keys', 'wheel', 'lever', 'ribbon', 'pad']) assert.deepEqual(P.KINDS[k], [], k + ': no models.js type');
  const bad = (f, re, m) => {
    const L = clone(FX_KEYS);
    f(L, L.controls.find(c => c.id === 'perf:keys'), L.controls.find(c => c.id === 'perf:bend'), L.controls.find(c => c.id === 'perf:mod'));
    const p = P.validate(L, FX_MODEL);
    assert.ok(p.some(x => re.test(x)), (m || re) + ' → ' + JSON.stringify(p));
  };
  // tokens and kinds
  bad((L, k, b, md) => { md.kind = 'ribbon'; md.hit = [20, 60]; }, /perf:mod must be a wheel \| lever \| pad/, 'a perf:mod of kind ribbon');
  bad((L, k, b) => { b.kind = 'pad'; }, /perf:bend must be a wheel \| lever \| ribbon/);
  bad((L, k) => { k.kind = 'wheel'; k.w = 20; k.h = 20; }, /perf:keys must be a keys/);
  bad(L => { L.controls.push({ id: 'perf:bend', kind: 'lever', a: 'keys', x: 100, y: 105, w: 16, h: 8, axis: 'x', up: '+x', hit: [16, 14] }); }, /perf:bend: placed 2 times/, 'a perf token twice on a model with no token table');
  bad(L => { L.extras.ids.push('perf:mod'); }, /extras: "perf:mod" is not a control of the model/);
  bad(L => { L.controls.push({ id: 'perf:pitch', kind: 'wheel', a: 'ctl', x: 30, y: 100, w: 10, h: 10 }); }, /"perf:pitch" is not a control of the model/);
  bad(L => { L.controls.push({ kind: 'keys', a: 'keys', x: 100, y: 50, n: 13, lo: 60, pitch: 23.5, len: 100 }); }, /a keys is decoration only/);
  bad((L, k) => { k.inert = true; }, /an inert control has no id/);
  // the bed's numbers
  bad((L, k) => { k.n = 89; }, /n an integer 1–88/); bad((L, k) => { k.n = 12.5; }, /n an integer 1–88/);
  bad((L, k) => { k.lo = 60.5; }, /lo an integer/);
  bad((L, k) => { k.lo = 61; }, /lo and lo \+ n − 1 white keys within 0–127/, 'lo black');
  bad((L, k) => { k.n = 11; }, /lo and lo \+ n − 1 white keys/, 'the top key black (A♯4)');
  bad((L, k) => { k.lo = 120; }, /within 0–127/, 'past 127');
  bad((L, k) => { k.pitch = 17.9; }, /pitch 18–26 mm/); bad((L, k) => { k.pitch = 26.1; }, /pitch 18–26 mm/);
  bad((L, k) => { k.len = 79; }, /len 80–200 mm/); bad((L, k) => { k.len = 201; }, /len 80–200 mm/);
  bad((L, k) => { k.black = { w: 23.5 }; }, /black.w > 0, < pitch/); bad((L, k) => { k.black = { len: 100 }; }, /black.len > 0, < len/);
  bad((L, k) => { k.black = 13; }, /black \{ w, len \}/);
  bad((L, k) => { k.front = 8.5; }, /front 0–8 mm/); bad((L, k) => { k.front = -1; }, /front 0–8 mm/);
  bad((L, k) => { k.at = 'yes'; }, /at true \| false/);
  bad((L, k) => { k.x = 110; }, /\(perf:keys\): outside its area "keys"/, 'the keys\' rectangle inside its area');
  // the controllers
  bad((L, k, b) => { b.w = 0; }, /\(perf:bend\): w, h > 0/);
  bad((L, k, b) => { b.w = 10; b.hit = [10, 60]; }, /hit box 10 × 60 mm < 14 mm/, 'a controller\'s hit ≥ HIT_MIN_MM');
  bad((L, k, b) => { b.detent = 1; }, /detent true \| false/);
  bad((L, k, b) => { b.kind = 'lever'; b.axis = 'x'; b.up = '-y'; }, /axis x \(up \+x\) \| y \(up -y \| \+y\)/);
  bad((L, k, b) => { b.kind = 'lever'; delete b.orient; }, /axis x/, 'a lever needs its axis');
  bad((L, k, b) => { b.kind = 'ribbon'; b.span = 0; }, /span > 0/);
  bad((L, k, b, md) => { md.kind = 'pad'; md.rise = -0.1; }, /rise > 0 s/);
  bad((L, k) => { k.skin.white = 'var(--x)'; }, /skin.white not a colour/);
  bad((L, k) => { k.skin.label = 'Moog'; }, /a maker name/, 'no maker name in a skin');
  bad(L => { L.scheme.wheel = { surface: 'url(#x)' }; }, /scheme.wheel.surface: not a colour/);
  bad(L => { L.scheme.keys = '#fff'; }, /scheme.keys: not an object/);
  bad(L => { L.sections = L.sections.filter(x => x.id !== 'wh'); }, /\(perf:bend\): not inside a section/, 'a perf control inside a section');
  bad(L => { const m = L.controls.find(c => c.id === 'perf:mod'); m.a = 'keys'; m.x = 150; }, /\(perf:mod\) and controls\[\d+\] \(perf:keys\): hit boxes overlap|\(perf:keys\) and controls\[\d+\] \(perf:mod\): hit boxes overlap/, 'the bed counts as one hit box');
  bad(L => { L.areas.find(a => a.id === 'keys').at = [1900, 146]; }, /content: 2100 × 256 mm > 2000 × 1000/);
  // inert controllers are drawn (no id, no token): valid
  const L2 = clone(FX_KEYS);
  L2.controls.push({ kind: 'lever', a: 'keys', x: 100, y: 106, w: 30, h: 6, axis: 'x', up: '+x', inert: true }, { kind: 'pad', a: 'ctl', x: 30, y: 100, w: 12, h: 8, inert: true });
  assert.deepEqual(P.validate(L2, FX_MODEL), []);
  // usable with or without a host (§2: no api.perf → the widgets render inert)
  globalThis.__synthTest = { panels: { fixture: FX_KEYS } };
  try { assert.equal(P.usable('fixture', FX_MODEL) === FX_KEYS, true); } finally { delete globalThis.__synthTest; }
});

test('1i validate: the DX7 mixes dx: and perf: tokens (its layout with both validates; a perf:bend twice, a dx:btn with a perf kind, a perf:mod of kind ribbon are reported)', () => {
  const model = modelOf('dx7'), base = clone(DX_FX);
  base.areas.push({ id: 'wheels', src: [0, 0, 150, 157], at: [0, 172] }, { id: 'keys', src: [0, 0, 846, 157], at: [150, 172] });
  base.sections.push({ id: 'wh', label: '', a: 'wheels', x: 0, y: 0, w: 150, h: 157, frame: 'none', title: 'none' }, { id: 'kb', label: '', a: 'keys', x: 0, y: 0, w: 846, h: 157, frame: 'none', title: 'none' });
  base.controls.push({ id: 'perf:bend', kind: 'wheel', a: 'wheels', x: 50, y: 70, w: 22, h: 64, detent: true }, { id: 'perf:mod', kind: 'wheel', a: 'wheels', x: 100, y: 70, w: 22, h: 64 },
    { id: 'perf:keys', kind: 'keys', a: 'keys', x: 423, y: 75, n: 61, lo: 36, pitch: 23.5, len: 150, at: true });
  assert.deepEqual(P.validate(base, model), []);
  const bad = (f, re) => { const L = clone(base); f(L); const p = P.validate(L, model); assert.ok(p.some(x => re.test(x)), re + ' → ' + JSON.stringify(p)); };
  bad(L => { L.controls.push({ id: 'perf:bend', kind: 'wheel', a: 'wheels', x: 130, y: 140, w: 15, h: 15 }); }, /perf:bend: placed 2 times/);
  bad(L => { L.controls.find(c => c.id === 'dx:btn').kind = 'wheel'; }, /\(dx:btn\): dx:btn must be a button/);
  bad(L => { L.controls.find(c => c.id === 'perf:mod').kind = 'ribbon'; }, /perf:mod must be a wheel \| lever \| pad/);
  bad(L => { Object.assign(L.controls.find(c => c.id === 'perf:keys'), { kind: 'button', w: 20, h: 20 }); }, /perf:keys must be a keys/);
  bad(L => { L.controls.find(c => c.id === 'dx:no').id = 'perf:mod'; }, /perf:mod: placed 2 times|perf:mod must be a wheel/);
  const g = P.geometry(base, model);
  assert.equal(g.controls.filter(o => o.live && /^perf:/.test(o.id)).length, 3, 'the perf controls are live');
  assert.equal(g.controls.filter(o => o.live && o.id === 'dx:btn').length, 32, 'beside the dx: ones');
  bedChecks(base, model, 'dx7 fixture');
});

test('1i geometry: o.bed = bedLayout × 2 + the area\'s offset, unrounded (not on the half-px grid); the front band 8 mm under a lip, clamped by the extras strip and by a live control below, 0 where the keys end at the body\'s edge; the bed is one hit box; the controllers\' boxes as any control', () => {
  const { g, ob } = bedChecks(FX_KEYS, FX_MODEL, 'fixture');
  // the keys area sits at x 62.3 mm: the bed's px are not multiples of 0.5 (rectPx would have rounded them)
  assert.equal(ob.x, Math.round((4 + (62.3 + 6) * 2) * 1000) / 1000, 'bed left: offX 4 + 68.3 mm × 2');
  assert.equal(ob.keys.some(k => Math.round(k.x * 2) !== k.x * 2), true, 'unrounded');
  assert.deepEqual([ob.lo, ob.hi, ob.whites, ob.w, ob.h, ob.front, ob.at], [60, 72, 8, 376, 200, 16, true], 'a 10 mm lip: the full 8 mm band (16 px)');
  assert.equal(g.controls[KEYS_I].box.h, 216);
  const wh = g.controls.find(o => o.id === 'perf:bend');
  assert.deepEqual([wh.own.w, wh.own.h, wh.hit.w, wh.hit.h], [40, 120, 40, 120], 'a 20 × 60 mm wheel: box = slot, hit = slot');
  // a 3 mm lip: the band stops at the extras strip (the content's bottom)
  const lip = (L, h) => { for (const [a, s] of [['keys', 'kb'], ['ctl', 'wh']]) { L.areas.find(x => x.id === a).src[3] = h; L.sections.find(x => x.id === s).h = h; } return L; };
  const L3 = lip(clone(FX_KEYS), 103);
  assert.deepEqual(P.validate(L3, FX_MODEL), []);
  const b3 = bedChecks(L3, FX_MODEL, 'lip 3').ob;
  assert.deepEqual([b3.front, P.geometry(L3, FX_MODEL).extras.y - (b3.y + b3.h)], [6, 6], 'clamped to the extras strip');
  // no lip: 0
  const L0 = lip(clone(FX_KEYS), 100);
  assert.equal(bedChecks(L0, FX_MODEL, 'no lip').ob.front, 0, 'the keys end at the body\'s edge');
  // a live control below the keys (a pad 5 mm under the front): the band stops at its hit box
  const LP = clone(FX_KEYS); LP.areas.find(a => a.id === 'keys').src[3] = 130; LP.sections.find(x => x.id === 'kb').h = 130;
  Object.assign(LP.controls.find(c => c.id === 'perf:mod'), { kind: 'pad', a: 'keys', x: 50, y: 112.5, w: 20, h: 10 });
  assert.deepEqual(P.validate(LP, FX_MODEL), []);
  const bp = bedChecks(LP, FX_MODEL, 'pad below').ob;
  assert.deepEqual([bp.front, P.geometry(LP, FX_MODEL).controls.find(o => o.id === 'perf:mod').hit.y - (bp.y + bp.h)], [10, 10], 'clamped to the pad\'s hit box (15 mm high: its top 5 mm under the keys)');
  // c.front: the author's band (≤ 8 mm)
  const LF = clone(FX_KEYS); LF.controls[KEYS_I].front = 2.5;
  assert.equal(bedChecks(LF, FX_MODEL, 'front 2.5').ob.front, 5);
  // an inert bed: drawn, no band, no hit box
  const LI = clone(FX_KEYS); delete LI.controls[KEYS_I].id; LI.controls[KEYS_I].inert = true;
  assert.deepEqual(P.validate(LI, FX_MODEL), []);
  const oi = P.geometry(LI, FX_MODEL).controls[KEYS_I];
  assert.deepEqual([oi.live, oi.bed.front, oi.bed.keys.length, P.hitBoxes(LI, FX_MODEL).filter(h => h.id === 'perf:keys').length], [false, 0, 13, 0]);
});

/* ---------------------------------------------------------------- every authored model */
for (const id of P.HW_IDS) {
  const L = P.layoutOf(id), model = modelOf(id);
  if (!L) { test(`panels/${id}.js: not drawn yet (null) — skipped`, { skip: 'null layout: the model offers its Resizable panel only' }, () => {}); continue; }
  const bed = bedOf(L);
  test(`panels/${id}.js: valid; every models.js id exactly once; the §10 extras; every live control in a section`, () => {
    assert.deepEqual(P.validate(L, model), []);
    assert.equal(L.id, id);
    assert.deepEqual([...L.extras.ids].sort(), [...((bed && EXTRAS_1I[id]) || EXTRAS[id])].sort(), 'extras (§10; 1i §1.2)');
    const live = new Map(), T = P.TOKENS[id];
    for (const c of L.controls) if (!c.inert && typeof c.id === 'string') live.set(c.id, (live.get(c.id) || 0) + 1);
    // ((8) a switch bound to a grouped token — the SDS-V's x<ch>p — is placed by its group's keys)
    for (const [t, pat] of Object.entries((T && T.bind) || {})) for (const gv of T.grp[t][1]) if (L.controls.some(c => c.id === t && c[T.grp[t][0]] === gv)) live.set(pat.replace('?', gv), (live.get(pat.replace('?', gv)) || 0) + 1);
    for (const c of model.controls) {
      const n = (live.get(c.id) || 0) + (L.extras.ids.includes(c.id) ? 1 : 0);
      if (id === 'dx7' && live.has('dx:btn') && c.id !== 'vol' && c.id !== 'dac') continue; // (addressed by the DATA ENTRY buttons, §6.3)
      assert.equal(n, 1, c.id + ' placed once');
    }
    if (SECTIONS[id]) assert.deepEqual(L.sections.map(s => s.id).filter(s => !bed || SECTIONS[id].includes(s)), SECTIONS[id], 'sections in the §10 order (1i: the bed\'s and the plates\' added)');
    const g = P.geometry(L, model);
    for (const o of g.controls) if (o.live) assert.ok(o.sec >= 0, `${o.id} inside a section`);
    const shown = g.controls.filter(o => o.live || o.show).map(o => o.i), num = (a, b) => a - b;
    assert.deepEqual([...g.order].sort(num), shown.sort(num), 'every live control (and live display) in the Tab order, once');
    if (id === 'dx7') { // 43 widgets by design: every other id is the one some button addresses (EDIT: each OP, each EG step; FUNCTION 17)
      const reach = new Set(['vol', ...L.extras.ids]), ns = L.controls.filter(c => c.id === 'dx:btn').map(c => c.n);
      for (let op = 1; op <= 6; op++) for (let eg = 1; eg <= 4; eg++) for (const n of ns) { const a = P.dxAddr(n, { mode: 'edit', op, eg }); if (a) reach.add(a); }
      for (const n of ns) { const a = P.dxAddr(n, { mode: 'function', op: 1, eg: 1 }); if (a) reach.add(a); }
      for (const c of model.controls) assert.ok(reach.has(c.id), c.id + ' reached through a DX7 button');
    } else assert.ok(g.order.length >= model.controls.length - L.extras.ids.length, 'every live control in the Tab order');
  });
  const pin = bed || id === 'tb303' ? PINNED_1I[id] : PINNED[id];
  test(`panels/${id}.js: the module size on the dots (bar included), ${pin ? 'pinned' : (bed ? 'the 1i' : 'the §10') + ' target ± a dot'}; hit boxes ≥ 28 px, disjoint, inside the body`, () => {
    const s = P.sizeOf(L, model), g = P.geometry(L, model);
    assert.equal(s.w % DOT, 0); assert.equal(s.h % DOT, 0);
    assert.equal(s.h, g.body.h + BAR_H);
    if (pin) assert.deepEqual([s.w, s.h], pin);
    else {
      const [tw, th] = (bed ? TARGET_1I : TARGET)[id];
      assert.ok(Math.abs(s.w - tw) <= DOT || (id === 'ms20' && Math.abs(s.w - 1152) <= DOT), `width ${s.w} vs ${tw}`);
      assert.ok(Math.abs(s.h - th) <= DOT, `height ${s.h} vs ${th}`);
    }
    const hb = P.hitBoxes(L, model);
    for (const h of hb) {
      assert.ok(h.w >= 28 && h.h >= 28, `${h.id}: ${h.w} × ${h.h} px`);
      assert.ok(h.x >= 0 && h.y >= 0 && h.x + h.w <= g.body.w && h.y + h.h <= g.body.h, `${h.id} inside the body`);
    }
    for (let i = 0; i < hb.length; i++) for (let j = i + 1; j < hb.length; j++) {
      const a = hb[i], b = hb[j];
      assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${a.id} × ${b.id} overlap`);
    }
  });
  // (1i) the bed of §1.2 (todo until lane K2's layout lands: then a real test), unrounded and one hit box; the TB-303 none
  test(`panels/${id}.js: (1i) ${NOKEYS.includes(id) ? 'no keyboard (' + (id === 'tb303' ? 'its 13 key cells' : id === 'm900' ? 'the keys tray plays it' : 'its step keys and pads') + ')' : 'one perf:keys bed, MIDI ' + BED[id][0] + '–' + (BED[id][0] + BED[id][1] - 1) + ', its geometry unrounded'}`, { todo: !bed && !NOKEYS.includes(id) ? 'lane K2 (panels/' + id + '.js)' : false }, () => {
    if (NOKEYS.includes(id)) { assert.equal(L.controls.filter(c => typeof c.id === 'string' && c.id.startsWith('perf:')).length, 0); return; }
    assert.equal(L.controls.filter(c => c.id === 'perf:keys').length, 1, 'one bed');
    assert.deepEqual([bed.lo, bed.n], BED[id], 'the §1.2 range');
    if (id === 'jupiter8') assert.equal(bed.pitch, 834 / 36, 'the JP-8 pitch: the division (36 × 23.17 overruns 834 mm)');
    bedChecks(L, model, id);
  });
  test(`panels/${id}.js: original artwork — no image / href / xlink / foreignObject / script, no maker name, the model name only as plain text`, () => {
    const svg = P.decorSvg(L, model);
    for (const bad of ['<image', 'href', 'xlink', '<foreignObject', '<script', 'javascript:']) assert.equal(svg.includes(bad), false, bad);
    const urls = [...svg.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1]);
    for (const u of urls) assert.ok(svg.includes(`id="${u}"`), 'url(#' + u + ') is a gradient the SVG defines itself');
    const texts = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1].replace(/<[^>]+>/g, ' '));
    for (const t of texts) assert.doesNotMatch(t, new RegExp('\\b(' + P.MAKERS.join('|') + ')\\b'), 'maker name in: ' + t);
    assert.doesNotMatch(svg.replace(/<text[\s\S]*?<\/text>/g, '').replace(/<title>[\s\S]*?<\/title>/g, '').replace(/data-tip="[^"]*"/g, ''), new RegExp('\\b' + model.name + '\\b'), 'the model name only in <text>');
    assert.ok(svg.startsWith('<svg') && svg.includes('aria-hidden="true"'));
    // ((9) a live patch jack is titled with its jack's own label — the table's, IMPL-9 §4.2; every other title as before)
    const PJ = new Map((model.jacks || (id === 'm900' ? MG.TYPES.ctl.jacks : [])).map(j => [j.id, j.label]));
    for (const [, port, tip] of svg.matchAll(/<g class="hw-jack" data-port="([^"]*)"><title>([^<]*)<\/title>/g)) assert.equal(tip, PJ.get(port), 'patch jack ' + port + ' titled with its label');
    for (const [, tip] of svg.replace(/<g class="hw-jack"[^>]*><title>[^<]*<\/title>/g, '').matchAll(/<title>([^<]*)<\/title>/g)) assert.match(tip, / — (not emulated|cable-able with full patching \(stage 4\))$/, 'inert controls titled (7a: an inert \'later\' jack, cable-able later)');
  });
}

/* ---------------------------------------------------------------- render on the fake DOM */
// a fake main.js api: today's widgets in miniature (class knob / slider / sel / tog, ui registration) and a dragB with
// the tap and the two-finger rollback (value and preset name back)
function fakeApi(model, doc) {
  const vals = {}, ui = new Map(), log = [];
  for (const c of model.controls) vals[c.id] = c.def;
  const state = { preset: 'Init', tips: [] };
  const set = (id, v) => { vals[id] = v; state.preset = null; const u = ui.get(id); if (u) u(); log.push(id + '=' + v); };
  const mk = (tag, cls) => { const e = doc.createElement(tag); if (cls) e.className = cls; return e; };
  const widget = cls => c => { const el = mk('div', cls); el.setAttribute('aria-label', c.label); const upd = () => el.setAttribute('aria-valuenow', String(vals[c.id])); ui.set(c.id, upd); upd(); return el; };
  const api = {
    doc, model, vals, ui, log, state,
    get: id => vals[id], set,
    watch: (id, fn) => { const p = ui.get(id); ui.set(id, p ? () => { p(); fn(); } : fn); },
    bind: c => ({ id: c.id, label: c.label, min: c.min, max: c.max, step: c.step, def: c.def, get: () => vals[c.id], set: v => set(c.id, v), fmt: v => String(v),
      snap: () => ({ v0: vals[c.id], pre0: state.preset }), restore: k => { if (vals[c.id] !== k.v0) set(c.id, k.v0); state.preset = k.pre0; } }),
    knob: c => { const el = widget('knob')(c); el.setAttribute('data-sweep', String(c.sweep)); return el; },
    slider: c => { const el = widget('slider')(c); el.setAttribute('data-orient', c.orient || 'v'); return el; },
    selector: widget('sel'), toggle: widget('tog'),
    dragB(el, b, o = {}) {
      let st = null;
      el.addEventListener('pointerdown', e => { st = { y: e.clientY, x: e.clientX, k: b.snap(), v0: b.get(), p: (b.get() - b.min) / ((b.max - b.min) || 1), moved: false }; });
      el.addEventListener('pointermove', e => {
        if (!st) return;
        const d = b.axis === 'x' ? e.clientX - st.x : st.y - e.clientY;
        st.moved = st.moved || Math.abs(d) > 4;
        const p = Math.max(0, Math.min(1, st.p + d / 40)), v = b.min + p * (b.max - b.min);
        b.set(b.step ? Math.round(v / b.step) * b.step : v);
      });
      el.addEventListener('pointerup', () => { if (st && !st.moved && b.get() === st.v0 && o.tap) o.tap(); st = null; });
      el.addEventListener('pointercancel', e => { if (st && e.gesture === 'two-finger') b.restore(st.k); st = null; });
      el.addEventListener('keydown', e => { const d = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0; if (d) b.set(Math.max(b.min, Math.min(b.max, b.get() + d * (b.step || 1)))); });
    },
    tap: (el, fn) => el.addEventListener('pointerup', fn),
    tip: (el, t) => state.tips.push(t), untip: () => {},
    fmt: (c, v) => String(v), presetNo: () => 3,
  };
  return api;
}
const cls = n => n.getAttribute('class') || '';
const byCtl = (root, id) => all(root).find(n => n.getAttribute && n.getAttribute('data-ctl') === id) || null;
const widgetOf = (root, id) => { const w = byCtl(root, id); return w ? w.childNodes[0] : null; };

test('render (fixture): one .hw-c[data-ctl] per live control in the Tab order, sized from the geometry; ui registered for every id; the art, the extras strip, the caption', () => {
  const doc = fresh(), root = doc.createElement('div'), api = fakeApi(FX_MODEL, doc);
  doc.body.append(root);
  const r = P.render(root, FX_LAYOUT, FX_MODEL, api);
  assert.deepEqual([r.w, r.h], [608, 416]);
  assert.match(cls(root), /^inst hw knob-std m-fixture$/);
  assert.deepEqual([root.style.width, root.style.height, root.getAttribute('data-hw')], ['608px', '376px', 'fixture']);
  assert.deepEqual(root.childNodes.map(cls), ['hw-decor', 'hw-ctls', 'hw-extras']);
  assert.ok(String(root.childNodes[0].innerHTML).startsWith('<svg'), 'the decor SVG');
  const ctls = root.childNodes[1];
  assert.deepEqual([ctls.getAttribute('role'), ctls.getAttribute('aria-label')], ['group', 'Fixture front panel']);
  assert.deepEqual(ctls.childNodes.map(n => n.getAttribute('data-ctl') || cls(n)), ['cut', 'rng', 'on', 'hw-led hw-show', 'saw', 'cho', 'trk', 'wav', 'nz', 'vol', 'mod']);
  for (const id of ['cut', 'rng', 'on', 'saw', 'cho', 'wav', 'vol', 'nz', 'trk', 'mod', 'xtra']) assert.ok(api.ui.has(id), 'ui ' + id);
  const g = P.geometry(FX_LAYOUT, FX_MODEL), cut = byCtl(root, 'cut');
  assert.deepEqual([cut.style.left, cut.style.width, cut.getAttribute('data-kind')], [g.controls[0].box.x + 'px', g.controls[0].box.w + 'px', 'knob']);
  assert.equal(widgetOf(root, 'cut').style['--hit-w'], '48px', 'the hit area (::before) from the geometry');
  assert.equal(widgetOf(root, 'cut').getAttribute('data-sweep'), '300', 'today\'s knob, with the printed sweep');
  assert.equal(widgetOf(root, 'vol').getAttribute('data-orient'), 'h');
  // no renderer widget is classed as a plain knob / slider (tests find today's continuous widgets by class)
  for (const id of ['rng', 'nz']) assert.ok(!['knob', 'slider'].includes(cls(widgetOf(root, id))), id + ': ' + cls(widgetOf(root, id)));
  assert.deepEqual([cls(widgetOf(root, 'rng')), cls(widgetOf(root, 'nz'))], ['knob hw-rot', 'slider hw-det']);
  const xs = root.childNodes[2];
  assert.deepEqual([xs.childNodes[0].textContent, xs.childNodes[1].getAttribute('data-ctl'), cls(xs.childNodes[1].childNodes[0])], ['EXTRAS · not on the original · Dimmed controls are not emulated', 'xtra', 'tog']);
  // a tap on a dimmed control: "not emulated"
  const svgG = doc.createElement('g'); svgG.setAttribute('data-tip', 'TUNE — not emulated'); root.childNodes[0].append(svgG);
  fire(svgG, 'click');
  assert.deepEqual(api.state.tips, ['TUNE — not emulated']);
});

test('(7b) a rotary\'s rot: its sweep centred there (the art\'s detent ticks and the widget turn by it; absent = 12 o\'clock, the art unchanged); a rotary only, −180…180°', () => {
  const R = clone(FX_LAYOUT), rng = R.controls.find(c => c.id === 'rng');
  assert.equal(P.decorSvg(clone(FX_LAYOUT), FX_MODEL), P.decorSvg(Object.assign(clone(FX_LAYOUT), { controls: FX_LAYOUT.controls.map(c => (c.id === 'rng' ? Object.assign({}, c, { rot: 0 }) : c)) }), FX_MODEL), 'rot 0 = none, byte for byte');
  rng.rot = 30;
  assert.deepEqual(P.validate(R, FX_MODEL), []);
  const n3 = v => String(Math.round(v * 1000) / 1000), pol = (r, a) => [80 + Math.sin(a * Math.PI / 180) * r, 30 - Math.cos(a * Math.PI / 180) * r];
  const tick = a => { const [ax, ay] = pol(10 + 0.6, a), [bx, by] = pol(10 + 0.6 + 1.4 * 0.8, a); return `M${n3(ax)} ${n3(ay)}L${n3(bx)} ${n3(by)}`; };
  const svg = P.decorSvg(R, FX_MODEL), svg0 = P.decorSvg(FX_LAYOUT, FX_MODEL);
  for (const a of [-45, -7.5, 30, 67.5, 105]) assert.ok(svg.includes(tick(a)), 'a detent tick at ' + a + '°');
  assert.ok(svg0.includes(tick(-75)) && !svg.includes(tick(-75)), 'unturned without rot');
  const doc = fresh(), root = doc.createElement('div'), api = fakeApi(FX_MODEL, doc);
  doc.body.append(root);
  P.render(root, R, FX_MODEL, api);
  const rotOf = () => { const g = all(widgetOf(root, 'rng')).find(n => cls(n) === 'rot'); return g ? g.getAttribute('transform') : null; };
  assert.equal(rotOf(), 'rotate(-7.5 32 32)', 'position 1 of 4 detents (map [0, 1, null, 2, 3]) at 30 − 75 + 37.5');
  api.set('rng', 3);
  assert.equal(rotOf(), 'rotate(105 32 32)');
  const bad = (f, re) => { const L = clone(FX_LAYOUT); f(L); assert.ok(P.validate(L, FX_MODEL).some(x => re.test(x)), String(re)); };
  bad(L => { L.controls.find(c => c.id === 'cut').rot = 10; }, /\(cut\): rot \(a rotary's sweep centre\)/);
  bad(L => { L.controls.find(c => c.id === 'rng').rot = 181; }, /\(rng\): rot/);
  bad(L => { L.controls.find(c => c.id === 'rng').rot = '30'; }, /\(rng\): rot/);
});

test('render (fixture): a set redraws its widget; null positions are skipped by taps, drags and keys; a level rocker toggles 0 ↔ its last level; a combo lights two; a two-finger cancel restores value and preset name', () => {
  const doc = fresh(), root = doc.createElement('div'), api = fakeApi(FX_MODEL, doc);
  doc.body.append(root);
  P.render(root, FX_LAYOUT, FX_MODEL, api);
  // rotary with map [0, 1, null, 2, 3]: positions 0 1 _ 3 4
  const rng = widgetOf(root, 'rng');
  assert.deepEqual([rng.getAttribute('aria-valuenow'), rng.getAttribute('aria-valuetext')], ['1', 'B']);
  ptr(rng, 'pointerdown', 10, 100); ptr(rng, 'pointerup', 10, 100);
  assert.deepEqual([api.vals.rng, rng.getAttribute('aria-valuenow'), rng.getAttribute('aria-valuetext')], [2, '3', 'C'], 'a tap skips the null position');
  ptr(rng, 'pointerdown', 10, 100); ptr(rng, 'pointerup', 10, 100); ptr(rng, 'pointerdown', 10, 100); ptr(rng, 'pointerup', 10, 100);
  assert.equal(api.vals.rng, 0, 'wraps');
  key(rng, 'ArrowUp'); key(rng, 'ArrowUp');
  assert.equal(api.vals.rng, 2, 'keys step over the valid positions');
  api.set('rng', 1);
  assert.equal(rng.getAttribute('aria-valuenow'), '1', 'set → redrawn');
  // two-finger rollback on the rotary: value and preset name back
  api.state.preset = 'Fat';
  ptr(rng, 'pointerdown', 10, 100); ptr(rng, 'pointermove', 10, 40);
  assert.notEqual(api.vals.rng, 1);
  fire(rng, 'pointercancel', { gesture: 'two-finger' });
  assert.deepEqual([api.vals.rng, api.state.preset, rng.getAttribute('aria-valuenow')], [1, 'Fat', '1'], 'rolled back');
  // a 2-position rocker: aria-pressed, data-pos
  const on = widgetOf(root, 'on');
  assert.deepEqual([on.localName, cls(on), on.getAttribute('aria-pressed'), on.getAttribute('data-pos')], ['button', 'hw-sw', 'false', '0']);
  ptr(on, 'pointerdown', 0, 0); ptr(on, 'pointerup', 0, 0);
  assert.deepEqual([api.vals.on, on.getAttribute('aria-pressed'), on.getAttribute('data-pos')], [1, 'true', '1']);
  // the LED follows `on`
  const led = root.childNodes[1].childNodes.find(n => cls(n) === 'hw-led hw-show');
  assert.equal(led.getAttribute('data-lit'), 'on');
  // a level rocker: a tap toggles 0 ↔ the last level; a drag sets the level
  const saw = widgetOf(root, 'saw');
  ptr(saw, 'pointerdown', 0, 100); ptr(saw, 'pointerup', 0, 100);
  assert.equal(api.vals.saw, 1, '0 → max (no level yet)');
  api.set('saw', 0.4);
  ptr(saw, 'pointerdown', 0, 100); ptr(saw, 'pointerup', 0, 100);
  assert.equal(api.vals.saw, 0);
  ptr(saw, 'pointerdown', 0, 100); ptr(saw, 'pointerup', 0, 100);
  assert.equal(api.vals.saw, 0.4, 'back to the last level');
  assert.equal(saw.childNodes.find(n => cls(n) === 'hw-sw-fill').style.height, '40%');
  // buttons with a combo: I then II = I+II (two lit); the lit one of two releases it to the other
  const grp = widgetOf(root, 'cho'), btn = v => grp.childNodes.find(n => n.getAttribute('data-v') === String(v));
  const lit = () => grp.childNodes.filter(n => n.getAttribute('aria-checked') === 'true').map(n => +n.getAttribute('data-v'));
  assert.deepEqual([grp.getAttribute('role'), btn(0).getAttribute('role'), lit()], ['radiogroup', 'radio', [0]]);
  ptr(btn(1), 'pointerup', 0, 0);
  assert.deepEqual([api.vals.cho, lit()], [1, [1]]);
  ptr(btn(2), 'pointerup', 0, 0);
  assert.deepEqual([api.vals.cho, lit()], [3, [1, 2]], 'I+II');
  ptr(btn(1), 'pointerup', 0, 0);
  assert.deepEqual([api.vals.cho, lit()], [2, [2]], 'the lit I released: II');
  ptr(btn(0), 'pointerup', 0, 0);
  assert.deepEqual(lit(), [0]);
  // jacks: the selected one lit (a cord stub)
  const jk = widgetOf(root, 'wav');
  ptr(jk.childNodes[2], 'pointerup', 0, 0);
  assert.deepEqual([api.vals.wav, jk.childNodes.map(n => n.getAttribute('data-lit'))], [2, ['off', 'off', 'on']]);
  // a cycling button with LED levels
  const trk = widgetOf(root, 'trk');
  const step = () => { ptr(trk, 'pointerup', 0, 0); return [api.vals.trk, trk.getAttribute('data-lit'), trk.getAttribute('aria-pressed')]; };
  assert.deepEqual([step(), step(), step()], [[0.5, 'dim', 'true'], [1, 'on', 'true'], [0, 'off', 'false']]);
  // a detented slider (an "s" control with legends)
  const nz = widgetOf(root, 'nz');
  ptr(nz, 'pointerdown', 0, 100); ptr(nz, 'pointerup', 0, 100);
  assert.deepEqual([api.vals.nz, nz.getAttribute('aria-valuetext')], [1, 'PINK']);
});

test('render: deterministic — the same layout renders the same DOM (tags, classes, data-ctl, inline geometry), so the Hardware layout always comes back exactly', () => {
  const ser = n => n.localName + '.' + cls(n) + '[' + (n.getAttribute('data-ctl') || '') + ']' + JSON.stringify(n.style) + '(' + n.childNodes.filter(c => c.nodeType === 1).map(ser).join(',') + ')';
  const once = (L, model) => { const doc = fresh(), root = doc.createElement('div'); doc.body.append(root); P.render(root, L, model, fakeApi(model, doc)); return ser(root); };
  assert.equal(once(FX_LAYOUT, FX_MODEL), once(FX_LAYOUT, FX_MODEL));
  for (const id of authored) assert.equal(once(P.layoutOf(id), modelOf(id)), once(P.layoutOf(id), modelOf(id)), id);
});

// 7c review 2 F4: the extras caption's type steps down on every strip whose caption does not fit (xcapFit, calibrated on
// Chrome's measure: the plain caption is 379.9 px at 9 px, ≈ 0.934 of its estimate) — the Solina's 382 px strip (5.9 px over
// in Chrome) at 8 px; the Prophet-5's and OB-Xa's 400 (12 px inside) and every other strip as they were
test('7c review 2 F4: the extras caption steps down where it does not fit — the Solina\'s at 8 px; the Prophet-5\'s, the OB-Xa\'s and every other strip that fits at 9 px unchanged; the 909\'s at 8 px as before', () => {
  const plain = P.XCAPTION + ' · Dimmed controls are not emulated';
  assert.deepEqual([P.xcapFit(plain, 382 - 16), P.xcapFit(plain, 400 - 16), P.xcapFit(plain, 1000)], [{ fs: 8, ls: 0.04 }, null, null], 'calibrated: the Solina\'s room 366 over, 384 fits');
  const sizes = {};
  for (const id of authored) {
    const L = P.layoutOf(id), model = modelOf(id), doc = fresh(), root = doc.createElement('div');
    doc.body.append(root); P.render(root, L, model, fakeApi(model, doc));
    const cap = all(root).find(n => cls(n) === 'hw-xcap');
    if (cap) sizes[id] = cap.style.fontSize || '';
  }
  assert.equal(sizes.solina, '8px', 'the Solina\'s caption fits its strip at 8 px');
  assert.deepEqual([sizes.prophet5, sizes.obxa, sizes.tr909], ['', '', '8px'], 'the Prophet-5 / OB-Xa as before (they fit), the 909 at 8 px');
  assert.deepEqual(Object.keys(sizes).filter(k => sizes[k] !== '').sort(), ['solina', 'tr909'], 'no other strip changed (8: the SDS-V\'s caption, said once, fits at 9 px: R2-F11)');
  if (authored.includes('sdsv')) assert.equal(sizes.sdsv, '', 'the SDS-V at 9 px (Chrome measured its old, doubled caption 976.5 px in its 976 px room)');
});

test('render (every authored model): every live models.js id has one .hw-c (or an extras cell) and a ui entry; controls in the section order', () => {
  for (const id of authored) {
    const L = P.layoutOf(id), model = modelOf(id), doc = fresh(), root = doc.createElement('div'), api = fakeApi(model, doc);
    doc.body.append(root);
    P.render(root, L, model, api);
    const ctl = all(root).filter(n => n.getAttribute && n.getAttribute('data-ctl')).map(n => n.getAttribute('data-ctl'));
    for (const c of model.controls) {
      if (id === 'dx7' && c.id !== 'vol' && c.id !== 'dac') continue;
      assert.equal(ctl.filter(x => x === c.id).length, 1, `${id}: ${c.id} once`);
      assert.ok(api.ui.has(c.id), `${id}: ui ${c.id}`);
    }
    const g = P.geometry(L, model), secs = g.order.map(i => g.controls[i].sec);
    assert.deepEqual(secs, [...secs].sort((a, b) => a - b), id + ': section order');
  }
});

test('usable(): a valid layout, else null (the model keeps its Resizable panel); a token this build cannot draw makes it unusable', () => {
  for (const id of authored) assert.equal(P.usable(id, modelOf(id)), P.layoutOf(id), id);
  for (const id of missing) assert.equal(P.usable(id, modelOf(id)), null, id);
  assert.equal(P.usable('serum', modelOf('serum')), null);
  assert.equal(P.usable('nope', null), null);
});

/* ---------------------------------------------------------------- TB-303 and DX7 special areas (§6.2, §6.3) */
function fakeSeq(doc, api) {
  const st = (n, g = 1) => ({ n, o: 0, a: 0, s: 0, g });
  const fns = new Set(), log = [];
  const node = cls => { const e = doc.createElement('div'); e.className = cls; return e; };
  let run = false;
  const S = {
    q: { bpm: 128, swing: 0, sync: false, pat: Array.from({ length: 16 }, () => st(0)) },
    state: { cur: 0, mode: 'pitch' }, log,
    send: () => log.push('send'), redraw: () => log.push('redraw'), changed: () => { for (const f of fns) f(); }, onChange: fn => fns.add(fn),
    toggle: on => { run = on; log.push('run ' + on); const u = api.ui.get('@seqrun'); if (u) u(); }, running: () => run,
    doClear: () => { S.q.pat = S.q.pat.map(() => st(0)); log.push('clear'); S.changed(); },
    sync: node('seqbtn'), swing: node('seqnum'), rnd: node('seqbtn'), demo: node('seqbtn'), toRoll: node('seqbtn'), steps: node('steps'),
  };
  return S;
}
const algStub = () => ({ xs: [0, 0, 1, 2, 0, 1, 2], lvl: [0, 0, 0, 0, 1, 1, 1], maxL: 1, cols: 3 });

test('TB-303 fixture: validates; RUN / TEMPO / CLEAR, the 13 keys and the step buttons on the face, today\'s parts and grid in the extras', () => {
  assert.deepEqual(P.validate(TB_FX, modelOf('tb303')), []);
  const doc = fresh(), root = doc.createElement('div'), api = fakeApi(modelOf('tb303'), doc);
  api.seq = fakeSeq(doc, api);
  doc.body.append(root);
  P.render(root, TB_FX, modelOf('tb303'), api);
  const ids = all(root).filter(n => n.getAttribute && n.getAttribute('data-ctl')).map(n => n.getAttribute('data-ctl'));
  for (const id of ['seq:tempo', 'seq:run', 'seq:clear', 'seq:pitch', 'seq:time', 'seq:down', 'seq:up', 'seq:accent', 'seq:slide', 'seq:back', 'seq:next', 'seq:sync', 'seq:swing', 'seq:random', 'seq:demo', 'seq:toRoll', 'seq:grid', 'al'])
    assert.ok(ids.includes(id), id);
  assert.equal(ids.filter(x => x === 'seq:key').length, 13);
  const run = widgetOf(root, 'seq:run');
  assert.deepEqual([run.id, run.getAttribute('aria-pressed'), run.childNodes.at(-1).textContent], ['seqrun', 'false', 'Run'], 'id seqrun; its last child is the state text');
  const tempo = widgetOf(root, 'seq:tempo');
  assert.deepEqual([tempo.getAttribute('role'), tempo.getAttribute('aria-label'), cls(tempo), tempo.getAttribute('aria-valuenow')], ['slider', 'Tempo', 'knob hw-tempo', '128']);
  const grid = byCtl(root, 'seq:grid');
  assert.equal(cls(grid.childNodes[0]), 'steps', 'today\'s grid (its classes unchanged) in the extras');
  ptr(run, 'pointerup', 0, 0);
  const led = root.childNodes[1].childNodes.find(n => cls(n) === 'hw-led hw-show');
  assert.deepEqual([api.seq.log.at(-1), run.getAttribute('aria-pressed'), led.getAttribute('data-lit')], ['run true', 'true', 'on'], 'RUN: the sequencer and its LED');
  // TEMPO: a drag changes the pattern's bpm; a two-finger cancel puts it back
  ptr(tempo, 'pointerdown', 0, 200); ptr(tempo, 'pointermove', 0, 160);
  assert.ok(api.seq.q.bpm > 128);
  fire(tempo, 'pointercancel', { gesture: 'two-finger' });
  assert.equal(api.seq.q.bpm, 128);
});

test('TB-303 step entry: PITCH mode (keys set the note, DOWN / UP the octave, ACCENT / SLIDE toggle), TIME mode (DOWN a note, ACCENT a rest, both advance), BACK / NEXT wrap; the LEDs mirror the cursor step', () => {
  const doc = fresh(), root = doc.createElement('div'), api = fakeApi(modelOf('tb303'), doc), S = api.seq = fakeSeq(doc, api);
  doc.body.append(root);
  P.render(root, TB_FX, modelOf('tb303'), api);
  const keys = all(root).filter(n => n.getAttribute && n.getAttribute('data-ctl') === 'seq:key').map(w => w.childNodes[0]);
  const btn = id => widgetOf(root, id), tap = el => ptr(el, 'pointerup', 0, 0), on = el => el.getAttribute('data-lit');
  assert.equal(on(btn('seq:pitch')), 'on', 'PITCH mode lit');
  tap(keys[4]);
  assert.deepEqual([S.q.pat[0].n, S.q.pat[0].g, on(keys[4]), on(keys[0])], [4, 1, 'on', 'off'], 'a key sets the cursor step\'s note');
  tap(btn('seq:down'));
  assert.deepEqual([S.q.pat[0].o, on(btn('seq:down'))], [-1, 'on']);
  tap(btn('seq:down'));
  assert.equal(S.q.pat[0].o, 0, 'the lit one again: back to 0');
  tap(btn('seq:up')); tap(btn('seq:accent')); tap(btn('seq:slide'));
  assert.deepEqual([S.q.pat[0].o, S.q.pat[0].a, S.q.pat[0].s, on(btn('seq:accent')), on(btn('seq:slide'))], [1, 1, 1, 'on', 'on']);
  tap(btn('seq:next'));
  assert.deepEqual([S.state.cur, on(keys[4]), on(btn('seq:accent'))], [1, 'off', 'off'], 'NEXT: step 2, its LEDs');
  tap(btn('seq:back')); tap(btn('seq:back'));
  assert.equal(S.state.cur, 15, 'BACK wraps');
  // TIME mode
  tap(btn('seq:time'));
  assert.deepEqual([S.state.mode, on(btn('seq:time')), on(btn('seq:pitch'))], ['time', 'on', 'off']);
  S.state.cur = 3; S.q.pat[3].g = 0; S.q.pat[4].g = 1;
  tap(btn('seq:down'));
  assert.deepEqual([S.q.pat[3].g, S.state.cur], [1, 4], 'DOWN: a note, next step');
  tap(btn('seq:accent'));
  assert.deepEqual([S.q.pat[4].g, S.state.cur], [0, 5], 'ACCENT: a rest, next step');
  const n5 = JSON.stringify(S.q.pat[5]);
  tap(btn('seq:up')); tap(keys[7]);
  assert.deepEqual([JSON.stringify(S.q.pat[5]), S.state.cur], [n5, 5], 'UP (a tie) and the keys do nothing in TIME mode');
  tap(btn('seq:clear'));
  assert.equal(S.log.includes('clear'), true, 'PATTERN CLEAR');
});

test('DX7 fixture: validates (the 89 other ids addressed through the buttons); button 7 selects ALGORITHM; OPERATOR SELECT and EG stepping rebind data-ctl; DATA ENTRY follows the selection; NO / YES; FUNCTION and MEMORY SELECT modes; the LCD and the chart', () => {
  const model = modelOf('dx7');
  assert.deepEqual(P.validate(DX_FX, model), []);
  const doc = fresh(), root = doc.createElement('div'), api = fakeApi(model, doc), loads = [];
  api.dx = { state: { op: 1, param: 7, eg: 1, mode: 'edit' }, algs: (model.presets && null) || Array.from({ length: 32 }, () => [[[2, 1]], [1], [6, 6]]), layout: algStub, presets: 5, load: n => loads.push(n), presetName: () => 'BRASS 1' };
  doc.body.append(root);
  P.render(root, DX_FX, model, api);
  const st = api.dx.state, B = n => all(root).find(x => x.getAttribute && x.getAttribute('data-n') === String(n)), W = n => B(n).parentNode;
  const tap = el => ptr(el, 'pointerup', 0, 0), lcd = () => all(root).find(x => cls(x) === 'hw-lcd').childNodes.map(l => l.textContent.trimEnd());
  assert.deepEqual([W(7).getAttribute('data-ctl'), B(7).hasAttribute('data-sel'), W(18).getAttribute('data-ctl'), W(1).getAttribute('data-ctl'), B(1).hasAttribute('data-off')], ['alg', true, 'r1', 'dx:btn', true]);
  api.set('alg', 12);
  assert.deepEqual(lcd(), ['ALG12     111111', 'ALGORITHM=12'], 'edit mode: ALG nn + the operators, the parameter and its value');
  const chart = all(root).find(x => cls(x) === 'hw-chart'), lit = () => all(chart).filter(x => x.hasAttribute && x.hasAttribute('data-on')).length;
  assert.equal(lit(), 1, 'the chart lights the current algorithm');
  tap(B(18));
  assert.deepEqual([st.param, B(18).hasAttribute('data-sel'), lcd()[1]], [18, true, 'OP1 COARSE=' + api.vals.r1]);
  tap(widgetOf(root, 'dx:opsel')); tap(widgetOf(root, 'dx:opsel'));
  assert.deepEqual([st.op, W(18).getAttribute('data-ctl'), W(27).getAttribute('data-ctl'), lcd()[1]], [3, 'r3', 'l3', 'OP3 COARSE=' + api.vals.r3], 'OPERATOR SELECT rebinds');
  tap(B(21));
  assert.equal(W(21).getAttribute('data-ctl'), 'R1_3');
  tap(B(21)); tap(B(21));
  assert.deepEqual([st.eg, W(21).getAttribute('data-ctl'), W(22).getAttribute('data-ctl'), lcd()[1]], [3, 'R3_3', 'L3_3', 'OP3 RATE3=' + api.vals.R3_3], 'pressing 21 again steps the EG');
  // DATA ENTRY: the selected parameter (R3_3), the two-finger rollback; NO / YES step it
  const data = widgetOf(root, 'dx:data'), v0 = api.vals.R3_3;
  ptr(data, 'pointerdown', 0, 200); ptr(data, 'pointermove', 0, 180);
  assert.notEqual(api.vals.R3_3, v0);
  fire(data, 'pointercancel', { gesture: 'two-finger' });
  assert.equal(api.vals.R3_3, v0, 'rolled back');
  api.set('R3_3', 50);
  tap(widgetOf(root, 'dx:yes')); tap(widgetOf(root, 'dx:yes')); tap(widgetOf(root, 'dx:no'));
  assert.equal(api.vals.R3_3, 51, 'YES +1 ×2, NO −1');
  assert.equal(data.getAttribute('aria-valuetext'), 'R3 51');
  // a dead button in edit mode: "not emulated"
  tap(B(2));
  assert.deepEqual(api.state.tips.at(-1), 'B2 — not emulated');
  // FUNCTION: only 17 (wheel range → pmd)
  tap(widgetOf(root, 'dx:function'));
  assert.deepEqual([st.mode, W(17).getAttribute('data-ctl'), B(17).hasAttribute('data-off'), W(18).getAttribute('data-ctl'), lcd()], ['function', 'pmd', false, 'dx:btn', ['FUNCTION CONTROL', 'WHEEL RANGE=' + api.vals.pmd]]);
  // MEMORY SELECT INTERNAL: buttons 1–5 load the factory presets
  tap(widgetOf(root, 'dx:memInt'));
  assert.deepEqual([st.mode, B(3).hasAttribute('data-off'), B(9).hasAttribute('data-off')], ['play', false, true]);
  tap(B(3)); tap(B(9));
  assert.deepEqual(loads, [3], 'button 3: factory preset 3; 9: nothing');
  assert.deepEqual(lcd(), ['INTERNAL 03', 'BRASS 1'], 'play mode: the number and the name (presetNo: 3 in the fake)');
  tap(widgetOf(root, 'dx:edit'));
  assert.deepEqual([st.mode, W(18).getAttribute('data-ctl')], ['edit', 'r3']);
});

/* ---------------------------------------------------------------- (1g) the face's bitmap tier */
// stubs: an Image whose load the test lands (or fails) by hand, Blob, URL (object URLs counted), a manual rAF queue, the
// camera's k; the canvases are wk-dom's (recording 2D contexts). Only strings / numbers / booleans go into assert.
const eq1 = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
function tierRig(o = {}) {
  const d = fresh(), win = d.defaultView;
  win.devicePixelRatio = o.dpr || 2;
  const world = d.createElement('div'), root = d.createElement('div'), deco = d.createElement('div'), svg = d.createElementNS('http://www.w3.org/2000/svg', 'svg');
  world.setAttribute('data-cv-world', ''); deco.className = 'hw-decor';
  deco.append(svg); root.append(deco); world.append(root); d.body.append(world);
  const R = { k: o.k == null ? 1 : o.k, imgs: [], urls: new Set(), made: 0, rq: [] };
  class Img { constructor() { this.onload = null; this.onerror = null; R.imgs.push(this); } set src(u) { this._src = u; } get src() { return this._src; } }
  class Bl { constructor(parts, opt) { this.text = parts.join(''); this.type = opt && opt.type; } }
  const URLs = { createObjectURL: b => { const u = 'blob:' + (++R.made); R.urls.add(u); R.blob = b; return u; }, revokeObjectURL: u => R.urls.delete(u) };
  const env = { win, doc: d, scale: () => R.k, raf: f => R.rq.push(f), Image: o.noImage ? null : Img, Blob: Bl, URL: URLs };
  if (o.noImage) win.Image = null;
  const T = P.faceTier(deco, svg, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"></svg>', 400, 200, env);
  const frame = () => { const q = R.rq.splice(0); for (const f of q) f(); };
  const land = (good = true) => { const i = R.imgs.at(-1); if (good) i.onload(); else i.onerror(); };
  const bm = () => deco.childNodes.filter(n => n.localName === 'canvas');
  const st = () => ({ svg: svg.style.visibility || 'visible', n: bm().length, w: T.canvas ? T.canvas.width : 0, h: T.canvas ? T.canvas.height : 0, shown: T.shown });
  return { d, win, deco, svg, root, world, R, T, frame, land, bm, st };
}
const NONE = { svg: 'visible', n: 0, w: 0, h: 0, shown: false };
test('1g faceTier: k < 1 at a zoom end → the face drawn on a canvas at w·dpr·k device px (filtered down from a finer vector raster), the SVG hidden; the old picture stays until the load lands; k ≥ 1 → the SVG again, the canvas gone', () => {
  const g = tierRig({ k: 0.5 });
  eq1(g.st(), NONE, 'nothing until the next frame');
  g.frame();
  eq1([g.R.imgs.length, g.R.blob.type, g.R.blob.text.startsWith('<svg'), g.R.urls.size], [1, 'image/svg+xml', true, 1], 'the markup loads as an image from a Blob URL');
  eq1(g.st().svg, 'visible', 'the SVG shows while it loads');
  g.land();
  eq1(g.st(), { svg: 'hidden', n: 1, w: 400, h: 200, shown: true }, 'dpr 2 × k 0.5 × 400 × 200: the canvas shows, the SVG hidden');
  const cv = g.T.canvas, ctx = cv.getContext('2d');
  eq1([cv.className, cv.style.width, cv.style.height, cv.getAttribute('aria-hidden'), g.R.urls.size, g.T.k], ['hw-bm', '400px', '200px', 'true', 0, 1], 'the same box (CSS w × h), the URL revoked');
  eq1([ctx.imageSmoothingEnabled, ctx.imageSmoothingQuality], [true, 'high']);
  const di = ctx.calls.filter(c => c[0] === 'drawImage');
  eq1([di.length, di[0][1].localName, di[0][1].width, di[0][1].height, di[0].slice(2)], [1, 'canvas', 0, 0, [0, 0, 400, 200]], 'drawn from a finer raster (released after) scaled down to the device size');
  const fine = di[0][1].getContext('2d').calls.filter(c => c[0] === 'drawImage');
  eq1([fine.length, fine[0][1] === g.R.imgs[0], fine[0].slice(2)], [1, true, [0, 0, 800, 400]], 'the vector raster at 2 × the target (= native at dpr 2)');
  g.T.refresh(); eq1(g.R.imgs.length, 1, 'the same zoom again: nothing to do');
  // a zoom end at 25 %: the 50 % picture stays until the new one lands
  g.R.k = 0.25; g.T.refresh();
  eq1([g.R.imgs.length, g.st().svg, g.st().w], [2, 'hidden', 400], 'the previous bitmap stays meanwhile');
  g.land();
  eq1([g.st().w, g.st().h, g.bm().length, g.T.canvas === cv], [200, 100, 1, true], 'redrawn in place at 25 %');
  // two zoom ends before a load lands: only the last one paints
  g.R.k = 0.8; g.T.refresh(); g.R.k = 0.6; g.T.refresh();
  g.R.imgs.at(-2).onload(); eq1(g.st().w, 200, 'a superseded load paints nothing');
  g.land(); eq1([g.st().w, g.st().h], [480, 240], 'the last one');
  // back to 100 %: the SVG, no canvas (its store released)
  g.R.k = 1; g.T.refresh();
  eq1(g.st(), NONE, 'k ≥ 1: the vector face again');
  eq1([cv.width, cv.height], [0, 0], 'released');
  // a load still in flight when k ≥ 1 arrives: discarded
  g.R.k = 0.5; g.T.refresh(); g.R.k = 1.5; g.T.refresh(); g.land();
  eq1(g.st().n, 0, 'k 1.5: the late load is dropped');
  // dpr 1 at 75 %: a finer raster at native (dpr 1 · 1), drawn down to 300 × 150
  const h = tierRig({ k: 0.75, dpr: 1 }); h.frame(); h.land();
  const d2 = h.T.canvas.getContext('2d').calls.filter(c => c[0] === 'drawImage');
  eq1([h.st().w, h.st().h, d2[0][1].localName], [300, 150, 'canvas']);
  // at 90 % (dpr 2): a finer raster would be < 1.25 × the target: the vector drawn straight at the device size
  const q = tierRig({ k: 0.9 }); q.frame(); q.land();
  const d3 = q.T.canvas.getContext('2d').calls.filter(c => c[0] === 'drawImage');
  eq1([q.st().w, q.st().h, d3[0][1] === q.R.imgs[0]], [720, 360, true]);
});
test('1g faceTier: a zoom end reaches it through wk.onRescale (no main.js change); a release (an unmounted body) shows the SVG and re-tries next frame while mounted; not while hidden at home; destroy; a failed decode keeps the SVG for good', () => {
  const g = tierRig({ k: 0.5 });
  g.frame(); g.land();
  eq1(g.st().shown, true);
  g.R.k = 0.25; wk.rescaleCanvases(g.world);
  eq1(g.R.imgs.length, 2, 'the zoom end (wk.rescaleCanvases of the world) refreshed it');
  g.land(); eq1(g.st().w, 200);
  wk.releaseCanvases(g.T.canvas);
  eq1(g.st(), NONE, 'released: the SVG');
  g.frame(); g.land();
  eq1([g.st().shown, g.st().w], [true, 200], 'still mounted: re-made next frame');
  g.root.setAttribute('hidden', ''); wk.releaseCanvases(g.T.canvas); g.frame();
  eq1([g.st().shown, g.R.imgs.length], [false, 3], 'at home (a hidden ancestor): nothing made');
  g.root.removeAttribute('hidden');
  g.root.remove(); g.T.refresh(); eq1(g.R.imgs.length, 3, 'detached: nothing');
  g.world.append(g.root);
  g.T.refresh(); g.land(); eq1(g.st().shown, true);
  const cv = g.T.canvas;
  g.T.destroy();
  eq1([cv.width, g.st().n, g.st().svg], [0, 0, 'visible'], 'destroy: released, the SVG');
  g.R.k = 0.5; wk.rescaleCanvases(g.world); eq1(g.R.imgs.length, 4, 'its rescale hook off');
  const warn = console.warn; let warned = 0; console.warn = () => warned++;
  try {
    const f = tierRig({ k: 0.5 });
    f.frame(); f.land(false);
    eq1([f.st(), f.T.failed, warned], [NONE, true, 1], 'decode failed: the SVG kept, one warning');
    f.R.k = 0.25; f.T.refresh(); eq1(f.R.imgs.length, 1, 'never re-tried');
    const n = tierRig({ k: 0.5, noImage: true }); n.frame();
    eq1([n.T.failed, n.st().svg, warned], [true, 'visible', 2], 'no Image (a stub DOM): the SVG kept');
    const z = tierRig({ k: 1 }); z.frame(); eq1([z.R.imgs.length, z.st().svg], [0, 'visible'], 'at 100 %: nothing loads');
  } finally { console.warn = warn; }
});
test('1h: render() registers a parsed face with cv-face (the Face stands as `tier`: mode, shown; api.tier as the env; false → none): on the 2D path the 1g tier under it, data-cv-face on the module, moduleOf / offset (a stub DOM: 0, BAR_H), the data-tip tap under a shown face, destroy', () => {
  const doc = fresh(), win = doc.defaultView, model = modelOf('tb303');
  const mkEl = doc.createElement.bind(doc);
  doc.createElement = tag => { // (the stub DOM parses no innerHTML: a .hw-decor gets its SVG root from the markup string)
    const el = mkEl(tag);
    if (tag === 'div') Object.defineProperty(el, 'innerHTML', { set(v) { if (/^<svg/.test(String(v))) { el.textContent = ''; el.append(doc.createElementNS('http://www.w3.org/2000/svg', 'svg')); } }, get() { return ''; }, configurable: true });
    return el;
  };
  const world = mkEl('div'), mod = mkEl('div'), body = mkEl('div'), root = mkEl('div');
  world.setAttribute('data-cv-world', ''); mod.setAttribute('data-cv-mod', 'i1'); body.className = 'cv-body';
  body.append(root); mod.append(body); world.append(mod); doc.body.append(world);
  const R = { k: 1, imgs: [], rq: [] };
  class Img { constructor() { this.onload = null; this.onerror = null; R.imgs.push(this); } set src(u) { this._src = u; } get src() { return this._src; } }
  class Bl { constructor(parts, opt) { this.text = parts.join(''); this.type = opt && opt.type; } }
  const env = { win, doc, scale: () => R.k, raf: f => R.rq.push(f), Image: Img, Blob: Bl, URL: { createObjectURL: () => 'blob:1', revokeObjectURL: () => {} } };
  const api = Object.assign(fakeApi(model, doc), { tier: env });
  const r = P.render(root, TB_FX, model, api), F = r.tier;
  assert.ok(F && typeof F.refresh === 'function' && typeof F.destroy === 'function', 'a Face');
  eq1([F.mode, F.shown, !!F.tier, mod.getAttribute('data-cv-face')], ['dom', false, true, 'dom'], 'the 2D path at 100 %: the tier under it shows the SVG (shown false); mode = data-cv-face = dom');
  const deco = root.childNodes.find(n => n.className === 'hw-decor');
  assert.ok(deco.childNodes.some(n => n.localName === 'canvas' && n.className === 'hw-rel'), 'the unmount sentinel in the deco');
  // 50 %: the tier's bitmap → shown; a tap on the deco hit-tests the SVG for that point (elementFromPoint) and tips
  R.k = 0.5; wk.rescaleCanvases(world); R.imgs.at(-1).onload();
  eq1([F.mode, F.shown, deco.childNodes.filter(n => n.className === 'hw-bm').length], ['dom', true, 1]);
  const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g'); g.setAttribute('data-tip', 'CUTOFF — not emulated'); deco.childNodes[0].append(g);
  doc.elementFromPoint = () => g;
  const seen = [];
  deco.addEventListener('click', e => seen.push(e.target === deco), true);
  fire(deco, 'click', { clientX: 10, clientY: 10 });
  eq1([seen.length, api.state.tips.at(-1), deco.childNodes[0].style.visibility], [1, 'CUTOFF — not emulated', 'hidden'], 'the tip through the hidden SVG, the SVG hidden again after');
  r.destroy();
  eq1([mod.getAttribute('data-cv-face'), deco.childNodes.filter(n => n.localName === 'canvas').length, deco.childNodes[0].style.visibility || 'visible'], [null, 0, 'visible'], 'destroy: the attribute, the bitmap and the sentinel gone');
  // api.tier === false: no registration
  const r2 = P.render(mkEl('div'), TB_FX, model, Object.assign(fakeApi(model, doc), { tier: false }));
  eq1(r2.tier, null);
});
test('1g: the face SVG is self-contained (every fill / stroke / font / text-rendering an attribute: it draws the same as an image); render() without a parsed face (a stub DOM) has no tier', () => {
  for (const id of authored) {
    const s = P.decorSvg(P.layoutOf(id), modelOf(id));
    assert.ok(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="hw-svg" [^>]*font-family="[^"]+" text-rendering="geometricPrecision">/.test(s), id + ': the root carries its font and text rendering');
    assert.ok(!/currentColor|var\(--|<style|<image|<foreignObject/.test(s), id + ': nothing from CSS, nothing external');
    assert.ok(!/<text(?![^>]*\sfill=)[^>]*>/.test(s), id + ': every text has its fill');
  }
});

/* ---------------------------------------------------------------- (1i) render: the keys, the controllers, the 303's audition */
// a fake api.perf (main.js PERF.api's surface): its posts, the lit / view / bed registrations, the live values
function fakePerf() {
  const F = { log: [], lits: new Set(), views: { bend: new Set(), wheel: new Set(), at: new Set() }, beds: new Set(), live: { bend: 0, wheel: 0, at: 0 }, held: [] };
  F.api = {
    on: (n, v) => F.log.push(['on', n, Math.round(v * 1000) / 1000]), off: n => F.log.push(['off', n]),
    bend: v => F.log.push(['bend', Math.round(v * 1000) / 1000]), mod: v => F.log.push(['mod', Math.round(v * 1000) / 1000]), at: v => F.log.push(['at', v]),
    value: k => F.live[k] || 0, view: (k, f) => { F.views[k].add(f); return () => F.views[k].delete(f); },
    lit: f => { F.lits.add(f); return () => F.lits.delete(f); }, held: () => F.held, bed: f => { F.beds.add(f); return () => F.beds.delete(f); },
  };
  return F;
}
const renderKeys = (perf, L = FX_KEYS, model = FX_MODEL) => {
  const doc = fresh(), root = doc.createElement('div'), api = fakeApi(model, doc);
  if (perf) api.perf = perf.api;
  doc.body.append(root);
  const r = P.render(root, L, model, api);
  return { doc, root, api, r };
};

test('1i render: one .hw-c per perf token (data-nomod), the bed a music zone with n hidden shades at its keys\' art, the controllers perf zones over their slots (unrounded); a press reaches perf.on with the §4.2 velocity; the velocity note in the bed\'s label; the bed mounts lit', () => {
  const F = fakePerf();
  F.held = [62];
  const { root, doc, r } = renderKeys(F), g = P.geometry(FX_KEYS, FX_MODEL), ob = g.controls[KEYS_I].bed;
  for (const id of ['perf:keys', 'perf:bend', 'perf:mod']) {
    const w = byCtl(root, id);
    assert.ok(w, id);
    assert.deepEqual([cls(w), w.getAttribute('data-nomod'), w.getAttribute('data-kind')], ['hw-c', '1', FX_KEYS.controls.find(c => c.id === id).kind], id);
  }
  const bw = byCtl(root, 'perf:keys'), keys = bw.childNodes[0];
  assert.deepEqual([bw.style.left, bw.style.top, bw.style.width, bw.style.height], [ob.box.x + 'px', ob.box.y + 'px', ob.box.w + 'px', ob.box.h + 'px'], 'the wrapper: keys + band, unrounded');
  assert.deepEqual([cls(keys), keys.getAttribute('data-gesture'), keys.getAttribute('role'), keys.getAttribute('aria-roledescription'), keys.getAttribute('aria-disabled')], ['hw-keys', 'music', 'group', 'keyboard', null]);
  assert.equal(keys.getAttribute('aria-label'), 'Fixture keyboard, 13 keys, C4–C5; not touch-sensitive, like the original (velocity is recorded and sent)');
  const sh = keys.childNodes.filter(n => cls(n) === 'hw-kd');
  assert.equal(sh.length, 13);
  let off = 0;
  sh.forEach((s, i) => { const k = ob.keys[i]; if (s.getAttribute('data-note') !== String(k.note) || s.style.left !== Math.round((k.x - ob.box.x) * 1000) / 1000 + 'px' || s.style.top !== Math.round((k.y - ob.box.y) * 1000) / 1000 + 'px' || s.style.width !== k.w + 'px' || s.style.height !== k.h + 'px') off++; });
  assert.equal(off, 0, 'every shade at its key\'s art (o.bed, unrounded)');
  assert.deepEqual(sh.filter(s => !s.hasAttribute('hidden')).map(s => s.getAttribute('data-note')), ['62'], 'mounted lit: perf.held()');
  // a press (k = 1: the element's rect = its box): the front of D4 (white) → velocity 1; the back of C♯ → 0.3 + …
  placeEl(keys, 0, 0, ob.box.w, ob.box.h);
  const kx = n => { const k = ob.keys.find(q => q.note === n); return k.x - ob.box.x + k.w / 2; };
  fire(keys, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: kx(62), clientY: 199, button: 0, buttons: 1 });
  fire(keys, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: kx(61), clientY: 20, button: 0, buttons: 1 });
  const B = g.controls[KEYS_I].bed.mm;
  assert.deepEqual(F.log, [['on', 62, Math.round(velOf(B, 62, 99.5) * 1000) / 1000], ['on', 61, Math.round(velOf(B, 61, 10) * 1000) / 1000]]);
  assert.equal(sh.filter(s => !s.hasAttribute('hidden')).length, 2, 'pressed: shown');
  for (const f of F.lits) f(64, true);
  assert.equal(sh.find(s => s.getAttribute('data-note') === '64').hasAttribute('hidden'), false, 'perf.lit (keyVis) lights a key');
  // the controllers: perf zones, sliders, over their slots exactly (unrounded)
  for (const id of ['perf:bend', 'perf:mod']) {
    const w = byCtl(root, id), el = w.childNodes[0], o = g.controls.find(q => q.id === id);
    assert.deepEqual([cls(el), el.getAttribute('data-gesture'), el.getAttribute('role'), el.getAttribute('tabindex')], ['hw-wheel', 'perf', 'slider', '0'], id);
    assert.deepEqual([w.style.left, w.style.top, w.style.width, w.style.height], [o.own.x + 'px', o.own.y + 'px', o.own.w + 'px', o.own.h + 'px'], id + ': the window over the slot');
  }
  assert.deepEqual([byCtl(root, 'perf:bend').childNodes[0].getAttribute('aria-label'), byCtl(root, 'perf:bend').childNodes[0].getAttribute('aria-valuetext'), byCtl(root, 'perf:mod').childNodes[0].getAttribute('aria-valuetext')], ['Pitch bend wheel', '0.0 st', '0 %']);
  assert.ok(doc.getElementById('cv-keys-css'), 'the CSS injected once');
  // destroy: the held keys off once each, unhooked from the host
  r.destroy();
  assert.deepEqual(F.log.slice(2).map(x => x.join(' ')).sort(), ['off 61', 'off 62']);
  assert.deepEqual([F.lits.size, F.beds.size, F.views.bend.size, F.views.wheel.size], [0, 0, 0, 0], 'unhooked');
});

test('1i render: the controllers — a drag posts through perf (a spring\'s rest at the release), the host\'s release-all and destroy end a drag with its rest; the velocity note of a touch-sensitive model (DX7)', () => {
  const F = fakePerf();
  const { root, r } = renderKeys(F), el = byCtl(root, 'perf:bend').childNodes[0];
  rafQ.install();
  try {
    placeEl(el, 0, 0, 40, 120);
    fire(el, 'pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 20, clientY: 60, button: 0, buttons: 1 });
    fire(el, 'pointermove', { pointerId: 3, pointerType: 'touch', clientX: 20, clientY: 30, button: 0, buttons: 1 });
    rafQ.flush();
    assert.deepEqual(F.log, [['bend', 0.5]], '15 mm up of 60: +0.5, in the frame');
    assert.deepEqual([el.getAttribute('aria-valuenow'), el.getAttribute('aria-valuetext')], ['0.5', '+1.0 st']);
    fire(el, 'pointerup', { pointerId: 3, pointerType: 'touch', clientX: 20, clientY: 30, button: 0, buttons: 0 });
    assert.deepEqual(F.log.at(-1), ['bend', 0], 'released: 0 at once');
  } finally { rafQ.uninstall(); }
  fire(el, 'pointerdown', { pointerId: 4, pointerType: 'touch', clientX: 20, clientY: 60, button: 0, buttons: 1 });
  fire(el, 'pointermove', { pointerId: 4, pointerType: 'touch', clientX: 20, clientY: 90, button: 0, buttons: 1 });
  for (const f of F.beds) f();
  assert.deepEqual(F.log.at(-1), ['bend', 0], 'the host\'s release-all: the rest posted');
  fire(el, 'pointerdown', { pointerId: 5, pointerType: 'touch', clientX: 20, clientY: 60, button: 0, buttons: 1 });
  fire(el, 'pointermove', { pointerId: 5, pointerType: 'touch', clientX: 20, clientY: 40, button: 0, buttons: 1 });
  const n = F.log.length;
  r.destroy();
  assert.deepEqual([F.log.length > n || F.log.at(-1).join(), F.log.at(-1)], [true, ['bend', 0]], 'destroy: the rest posted');
  // the DX7 fixture with a bed: touch-sensitive
  const D = clone(DX_FX);
  D.areas.push({ id: 'keys', src: [0, 0, 846, 157], at: [150, 172] });
  D.sections.push({ id: 'kb', label: '', a: 'keys', x: 0, y: 0, w: 846, h: 157, frame: 'none', title: 'none' });
  D.controls.push({ id: 'perf:keys', kind: 'keys', a: 'keys', x: 423, y: 75, n: 61, lo: 36, pitch: 23.5, len: 150, at: true });
  const model = modelOf('dx7'), doc = fresh(), root2 = doc.createElement('div'), api = fakeApi(model, doc);
  api.dx = { state: { op: 1, param: 7, eg: 1, mode: 'edit' }, algs: Array.from({ length: 32 }, () => [[[2, 1]], [1], [6, 6]]), layout: algStub, presets: 5, load: () => {}, presetName: () => '' };
  api.perf = fakePerf().api; doc.body.append(root2);
  P.render(root2, D, model, api);
  assert.equal(byCtl(root2, 'perf:keys').childNodes[0].getAttribute('aria-label'), 'DX7 keyboard, 61 keys, C2–C7; touch-sensitive: the front edge is loudest');
});

test('1i render (the real layouts): the hover tips — the bed\'s velocity note, a pitch control\'s ±2 st and its original\'s range (§5.3); every perf token of every model one .hw-c, its zone and role', () => {
  const ROLE = { keys: 'group', wheel: 'slider', lever: 'slider', ribbon: 'slider', pad: 'button' };
  for (const id of authored) {
    const L = P.layoutOf(id), model = modelOf(id), F = fakePerf(), doc = fresh(), root = doc.createElement('div'), api = fakeApi(model, doc);
    api.perf = F.api; doc.body.append(root);
    if (id === 'tb303') api.seq = fakeSeq(doc, api);
    if (id === 'dx7') api.dx = { state: { op: 1, param: 7, eg: 1, mode: 'edit' }, algs: Array.from({ length: 32 }, () => [[[2, 1]], [1], [6, 6]]), layout: algStub, presets: 5, load: () => {}, presetName: () => '' };
    P.render(root, L, model, api);
    for (const c of L.controls.filter(x => typeof x.id === 'string' && x.id.startsWith('perf:'))) {
      const w = byCtl(root, c.id), el = w && w.childNodes[0];
      assert.ok(el, `${id}: ${c.id}`);
      assert.deepEqual([el.getAttribute('data-gesture'), el.getAttribute('role')], [c.kind === 'keys' ? 'music' : 'perf', ROLE[c.kind]], `${id}: ${c.id}`);
    }
  }
  const { root, api } = (() => { const doc = fresh(), root = doc.createElement('div'), api = fakeApi(modelOf('prophet5'), doc); api.perf = fakePerf().api; doc.body.append(root); P.render(root, P.layoutOf('prophet5'), modelOf('prophet5'), api); return { root, api }; })();
  fire(byCtl(root, 'perf:bend').childNodes[0], 'pointerenter', { pointerType: 'mouse' });
  fire(byCtl(root, 'perf:mod').childNodes[0], 'pointerenter', { pointerType: 'mouse' });
  fire(byCtl(root, 'perf:keys').childNodes[0], 'pointerenter', { pointerType: 'mouse' });
  fire(byCtl(root, 'perf:keys').childNodes[0], 'pointerenter', { pointerType: 'touch' });
  assert.deepEqual(api.state.tips, ['Pitch bend wheel · ±2 semitones (the original: about ± a fifth)', 'Modulation wheel', 'Keyboard: not touch-sensitive, like the original (velocity is recorded and sent)'], 'a finger shows no tip');
});

test('1i render (review 2 P1-2): a white key\'s shade is clipped to the white key\'s visible shape — it never covers a neighbouring black key (every model\'s bed: the polygon stays inside the key, leaves out every overlapped black rect, and its area = the visible white); the black shades are not clipped', () => {
  const polyOf = s => { const m = /^polygon\((.*)\)$/.exec(s.style.clipPath || ''); return m ? m[1].split(',').map(t => t.trim().split(/\s+/).map(v => parseFloat(v))) : null; };
  const inside = (P2, x, y) => { let c = false; for (let i = 0, j = P2.length - 1; i < P2.length; j = i++) { const [xi, yi] = P2[i], [xj, yj] = P2[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const area = P2 => { let a = 0; for (let i = 0, j = P2.length - 1; i < P2.length; j = i++) a += P2[j][0] * P2[i][1] - P2[i][0] * P2[j][1]; return Math.abs(a) / 2; };
  let whites = 0, clipped = 0, models = 0;
  const bad = [];
  for (const id of authored) {
    const L = P.layoutOf(id);
    if (!bedOf(L)) continue;
    models++;
    const model = modelOf(id), F = fakePerf(), doc = fresh(), root = doc.createElement('div'), api = fakeApi(model, doc);
    api.perf = F.api; doc.body.append(root);
    P.render(root, L, model, api);
    const g = P.geometry(L, model), ob = g.controls.find(o => o.bed).bed, sh = byCtl(root, 'perf:keys').childNodes[0].childNodes.filter(n => cls(n) === 'hw-kd');
    assert.equal(sh.length, ob.keys.length, id);
    ob.keys.forEach((k, i) => {
      const poly = polyOf(sh[i]);
      if (k.black) { if (sh[i].style.clipPath) bad.push(`${id} ${k.note}: a black shade clipped`); return; }
      whites++;
      const under = ob.keys.filter(b => b.black && b.x < k.x + k.w - 1e-6 && b.x + b.w > k.x + 1e-6);
      if (!under.length) { if (sh[i].style.clipPath) bad.push(`${id} ${k.note}: clipped with no black key over it`); return; }
      clipped++;
      if (!poly || poly.length < 4) { bad.push(`${id} ${k.note}: no polygon (${sh[i].style.clipPath})`); return; }
      if (poly.some(([x, y]) => !(x >= -1e-6 && x <= k.w + 1e-6 && y >= -1e-6 && y <= k.h + 1e-6))) bad.push(`${id} ${k.note}: a point outside the key`);
      let vis = k.w * k.h;
      for (const b of under) {
        const x0 = Math.max(b.x, k.x) - k.x, x1 = Math.min(b.x + b.w, k.x + k.w) - k.x, bh = b.h; // (the overlap, shade-local; the blacks hang from the same back edge)
        vis -= (x1 - x0) * bh;
        for (const [x, y] of [[(x0 + x1) / 2, bh / 2], [x0 + 0.05, 0.05], [x1 - 0.05, 0.05], [x0 + 0.05, bh - 0.05], [x1 - 0.05, bh - 0.05]]) if (inside(poly, x, y)) bad.push(`${id} ${k.note}: the shade covers black ${b.note} at ${x.toFixed(2)},${y.toFixed(2)}`);
        if (!inside(poly, (x0 + x1) / 2, bh + 0.05)) bad.push(`${id} ${k.note}: not shaded under black ${b.note}`);
      }
      if (!inside(poly, 0.05, k.h - 0.05) || !inside(poly, k.w - 0.05, k.h - 0.05)) bad.push(`${id} ${k.note}: the front corners are not shaded`);
      if (Math.abs(area(poly) - vis) > 0.01) bad.push(`${id} ${k.note}: area ${area(poly).toFixed(3)} vs the visible white ${vis.toFixed(3)}`);
    });
  }
  assert.deepEqual(bad.slice(0, 8), []);
  assert.ok(models >= 11 && whites > 300 && clipped > 0.9 * whites,`${models} models, ${whites} white keys, ${clipped} clipped`);
});

test('1i review 2 P2-2: the Solina\'s extras box starts at the walnut cheek\'s inner edge (not over the wood), stays inside the body, its caption still has the room, the size is the pinned one', () => {
  const L = P.layoutOf('solina'), model = modelOf('solina'), g = P.geometry(L, model);
  const cheeks = L.decor.filter(d => d.t === 'rect' && d.fill === 'wood' && d.x === 0);
  assert.equal(cheeks.length, 1, 'the left walnut cheek');
  const edge = g.content.x + cheeks[0].w * 2;
  assert.ok(g.extras.x >= edge - 1e-6, `the extras box at ${g.extras.x} px, the cheek ends at ${edge}`);
  assert.deepEqual([g.extras.over, P.validate(L, model)], [false, []], 'the caption fits');
  assert.deepEqual([P.sizeOf(L, model).w, P.sizeOf(L, model).h], PINNED_1I.solina);
});

test('1i render without api.perf (a host without perf, the tests\' stub): the same nodes, no listener, aria-disabled; deterministic either way', () => {
  const ser = n => n.localName + '.' + cls(n) + '[' + ['data-ctl', 'data-gesture', 'role', 'aria-label', 'data-note', 'hidden'].map(a => n.getAttribute(a)).join('|') + ']' + JSON.stringify(n.style) + '(' + n.childNodes.filter(c => c.nodeType === 1).map(ser).join(',') + ')';
  const A = renderKeys(null), B = renderKeys(fakePerf());
  const bed = A.root && byCtl(A.root, 'perf:keys').childNodes[0], wh = byCtl(A.root, 'perf:bend').childNodes[0];
  assert.deepEqual([bed.getAttribute('aria-disabled'), wh.getAttribute('aria-disabled'), wh.getAttribute('tabindex'), bed.listenerCount('pointerdown'), wh.listenerCount('pointerdown'), wh.listenerCount('keydown')], ['true', 'true', '-1', 0, 0, 0]);
  const strip = s => s.replace(/aria-disabled|tabindex/g, '');
  assert.equal(strip(ser(byCtl(A.root, 'perf:keys'))), strip(ser(byCtl(B.root, 'perf:keys'))), 'the bed: the same nodes');
  assert.equal(ser(A.root), ser(renderKeys(null).root), 'deterministic (no host)');
  assert.equal(ser(B.root), ser(renderKeys(fakePerf()).root), 'deterministic (a host)');
  A.r.destroy();
});

test('1i art: the face draws the keys (gap, whites, front edges, blacks, their tops), the wheels with ridges and the pitch wheel\'s centre mark, a lever\'s cap, the ribbon\'s felt, the pad; an inert controller dimmed and titled; self-contained', () => {
  const L = clone(FX_KEYS);
  L.controls.push({ kind: 'lever', a: 'keys', x: 100, y: 106, w: 30, h: 6, axis: 'x', up: '+x', inert: true, label: 'BEND' }, { kind: 'ribbon', a: 'ctl', x: 30, y: 100, w: 50, h: 6, inert: true }, { kind: 'pad', a: 'ctl', x: 30, y: 92, w: 12, h: 6, inert: true });
  assert.deepEqual(P.validate(L, FX_MODEL), []);
  const s = P.decorSvg(L, FX_MODEL), B = bedLayout(FX_KEYS.controls[KEYS_I]);
  const paths = [...s.matchAll(/<path d="([^"]*)" fill="([^"]+)"\/>/g)].map(m => [m[2], (m[1].match(/M/g) || []).length]);
  assert.deepEqual(paths.filter(p => ['#f4efe2', '#cbc4b2', '#151515', '#2b2b2b'].includes(p[0])), [['#f4efe2', 8], ['#cbc4b2', 8], ['#151515', 5], ['#2b2b2b', 5]], 'the skin\'s white / the default edge / the skin\'s black / the default top: 8 whites, 5 blacks');
  assert.ok(s.includes(`<rect x="6" y="0" width="${B.w}" height="${B.h}" fill="#000"/>`), 'the gap colour (scheme.keys.gap) under the keys, in the area frame');
  assert.equal((s.match(/fill="#dcdcdc"/g) || []).length, 1, 'the pitch wheel\'s centre mark (detent); the mod wheel has none');
  assert.ok(/<path d="(M[^"]*z){19,}" fill="#161616"\/>/.test(s), 'the ridges every 3 mm');
  const titled = [...s.matchAll(/<title>([^<]*) — not emulated<\/title>/g)].map(m => m[1]);
  assert.deepEqual(titled, ['TUNE', 'OUT', 'BEND', 'ribbon', 'pad'], 'the inert controllers dimmed and titled like any inert control');
  assert.ok(!/currentColor|var\(--|<style|<image|<foreignObject/.test(s), 'self-contained');
});

test('1i the TB-303\'s audition (§6.4): PITCH — a key cell sounds seqNote / seqVel of the cursor step while held (off at the release, at lostpointercapture after leaving the cell, at destroy); TIME — silent; two cells: two notes, the last tap writes; music zones', () => {
  const F = fakePerf(), doc = fresh(), root = doc.createElement('div'), api = fakeApi(modelOf('tb303'), doc), S = api.seq = fakeSeq(doc, api);
  api.perf = F.api;
  doc.body.append(root);
  const r = P.render(root, TB_FX, modelOf('tb303'), api);
  const cells = all(root).filter(n => n.getAttribute && n.getAttribute('data-ctl') === 'seq:key').map(w => w.childNodes[0]);
  const noteOf = b => TB_FX.controls.filter(c => c.id === 'seq:key')[cells.indexOf(b)].note;
  assert.deepEqual(cells.map(b => b.getAttribute('data-gesture')), Array(13).fill('music'));
  S.q.pat[0].o = 1; S.q.pat[0].a = 1;
  const k4 = cells.find(b => noteOf(b) === 4), k7 = cells.find(b => noteOf(b) === 7);
  const P1 = { pointerId: 1, pointerType: 'touch', button: 0, buttons: 1 }, P2 = { pointerId: 2, pointerType: 'touch', button: 0, buttons: 1 };
  fire(k4, 'pointerdown', P1);
  assert.deepEqual(F.log, [['on', seqNote({ n: 4, o: 1 }), seqVel({ a: 1 })]], 'C♯ … E an octave up, accented: 64 at 1');
  assert.equal(F.log[0][1], 64);
  fire(k7, 'pointerdown', P2);
  assert.deepEqual(F.log.at(-1), ['on', 67, 1], 'a second finger on another cell: a second note');
  fire(k4, 'pointerup', Object.assign({}, P1, { buttons: 0 }));
  fire(k7, 'pointerup', Object.assign({}, P2, { buttons: 0 }));
  assert.deepEqual(F.log.slice(2), [['off', 64], ['off', 67]]);
  assert.equal(S.q.pat[0].n, 7, 'the cell released last is the step\'s note');
  // lostpointercapture (the pointer left the cell; a mouse released elsewhere)
  fire(k4, 'pointerdown', Object.assign({}, P1, { pointerType: 'mouse' }));
  fire(k4, 'lostpointercapture', P1);
  assert.deepEqual(F.log.at(-1), ['off', 64]);
  // destroy ends a held one
  fire(k7, 'pointerdown', P2);
  S.q.pat[0].a = 0;
  r.destroy();
  assert.deepEqual(F.log.slice(-2), [['on', 67, 1], ['off', 67]]);
  // TIME mode: silent
  const F2 = fakePerf(), doc2 = fresh(), root2 = doc2.createElement('div'), api2 = fakeApi(modelOf('tb303'), doc2), S2 = api2.seq = fakeSeq(doc2, api2);
  api2.perf = F2.api; doc2.body.append(root2);
  P.render(root2, TB_FX, modelOf('tb303'), api2);
  S2.state.mode = 'time';
  const c2 = all(root2).filter(n => n.getAttribute && n.getAttribute('data-ctl') === 'seq:key').map(w => w.childNodes[0]);
  fire(c2[0], 'pointerdown', P1); fire(c2[0], 'pointerup', Object.assign({}, P1, { buttons: 0 }));
  assert.deepEqual(F2.log, [], 'TIME mode: nothing sounds');
  S2.state.mode = 'pitch';
  fire(c2[0], 'pointerdown', P1);
  assert.deepEqual(F2.log, [['on', seqNote({ n: TB_FX.controls.filter(c => c.id === 'seq:key')[0].note, o: 0 }), 0.62]], 'an unaccented step: 0.62');
});

/* ---------------------------------------------------------------- 7a review 2 (fixer B): the 808's face text, MODE's legends */
// Helvetica's advance widths (em; the face's first font), for an estimate independent of the renderer's own
const HW = { ' ': 0.278, "'": 0.191, '1': 0.556, '2': 0.556, A: 0.667, C: 0.722, E: 0.667, L: 0.556, M: 0.833, N: 0.722, O: 0.778, P: 0.667, R: 0.722, S: 0.667, T: 0.611, U: 0.722, Y: 0.667, s: 0.5, t: 0.278, n: 0.556, d: 0.556 };
const textEls = s => [...s.matchAll(/<text ([^>]*)>(.*?)<\/text>/g)].map(m => {
  const a = k => { const r = new RegExp(`(?:^| )${k}="([^"]*)"`).exec(m[1]); return r ? r[1] : null; };
  const lines = [...m[2].matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(t => t[1]);
  return { x: a('x'), y: +a('y'), size: +a('font-size'), anchor: a('text-anchor'), weight: a('font-weight'), variant: a('font-variant'), lines: lines.length ? lines : [m[2]], raw: m[0] };
});
test('7a review 2 #3 / #6: decor text takes xs (one x per character: a row of glyphs is one <text>) and variant small-caps; both validated; the 808\'s name plates are one centred <text> each (small caps: the code letters capitals, the rest small capitals, a space between words), the note-value staves one <text> per row; STEP NUMBER clear of the PATTERN CLEAR box', () => {
  const bad = (f, re) => { const L = clone(FX_LAYOUT); f(L); const p = P.validate(L, FX_MODEL); assert.ok(p.some(x => re.test(x)), re + ' → ' + JSON.stringify(p)); };
  bad(L => { L.decor.push({ t: 'text', x: 5, y: 5, s: 'ab', xs: [5] }); }, /decor\[\d+\]: xs/);
  bad(L => { L.decor.push({ t: 'text', x: 5, y: 5, s: 'ab', xs: [5, 'x'] }); }, /decor\[\d+\]: xs/);
  bad(L => { L.decor.push({ t: 'text', x: 5, y: 5, s: 'ab', xs: [5, 400] }); }, /decor\[\d+\]: outside its area/);
  bad(L => { L.decor.push({ t: 'text', x: 5, y: 5, s: 'ab', variant: 'bogus' }); }, /decor\[\d+\]: variant/);
  const L = clone(FX_LAYOUT); L.decor.push({ t: 'text', x: 5, y: 9, s: '♪♪♪', xs: [5, 10.25, 15.5] }, { t: 'text', x: 50, y: 9, s: 'Bass Drum', variant: 'small-caps' });
  assert.deepEqual(P.validate(L, FX_MODEL), []);
  const s = P.decorSvg(L, FX_MODEL);
  assert.ok(s.includes('<text x="5 10.25 15.5" y="9" font-size="2.6"'), 'the x-list');
  assert.ok(/<text x="50" y="9" font-size="2.6"[^>]* font-variant="small-caps"[^>]*>Bass Drum<\/text>/.test(s), 'small caps');
  // the 808
  const T8 = P.layoutOf('tr808'), svg = P.decorSvg(T8, modelOf('tr808')), els = textEls(svg);
  const plates = els.filter(e => e.variant === 'small-caps');
  assert.equal(plates.length, 17, 'one <text> per plate (12 voices + 5 switch plates)');
  for (const e of plates) assert.equal(e.anchor, 'middle', e.raw);
  const names = plates.map(e => e.lines[0].replace(/&#39;/g, "'"));
  assert.deepEqual(names.slice().sort(), ['ACcent', 'Bass Drum', 'Snare Drum', 'Low Tom', 'Mid Tom', 'Hi Tom', 'Rim Shot', 'hand ClaP', 'Cow Bell', 'CYmbal', 'Open Hihat', "Cls'd Hihat",
    'Low Conga', 'Mid Conga', 'Hi Conga', 'CLaves', 'MAracas'].sort());
  const staves = els.filter(e => /^[♪♩]+$/.test(e.lines[0]));
  assert.deepEqual(staves.map(e => [e.lines[0].length, e.x.split(' ').length]), [[16, 16], [8, 8], [4, 4], [2, 2]], 'the four rows, one x per note');
  const step = els.find(e => e.lines[0] === 'STEP'), box = T8.decor.find(d => d.t === 'rect' && d.x === 48.1 && d.y === 97.4);
  assert.ok(box && step.y - step.size * 0.72 >= box.y + box.h + 0.6, `STEP's cap top ${step.y - step.size * 0.72} ≥ the box's foot ${box.y + box.h} + 0.6 mm`);
  assert.ok(els.length <= 230, 'the face\'s <text> count: ' + els.length);
});
test('7a review 2 #5: a dial with multi-line legends (the 808\'s MODE) lays each legend\'s block clear of the detent ticks and the knob; single-line dials are unchanged', () => {
  const T8 = P.layoutOf('tr808'), c = T8.controls.find(x => x.id === 'dr:mode'), svg = P.decorSvg(T8, modelOf('tr808'));
  const r0 = c.d / 2 + 0.6, r1 = r0 + 1.4 * 0.8, want = c.legends.map(l => l.split('\n')), rad = g => g * Math.PI / 180;
  const ang = i => -c.sweep / 2 + c.sweep * i / (c.legends.length - 1), pt = (r, g) => [Math.sin(rad(g)) * r, -Math.cos(rad(g)) * r];
  const ticks = c.legends.map((l, i) => [pt(r0, ang(i)), pt(r1, ang(i))]);
  const els = textEls(svg).filter(e => e.size === 2.4 && want.some(w => w.join('|') === e.lines.join('|')));
  assert.equal(els.length, 6, 'the six MODE legends');
  for (const e of els) {
    const xs = e.x.split(' ').map(Number), sz = e.size, lh = sz * 1.12, cap = 0.72 * sz;
    const w = Math.max(...e.lines.map(l => [...l].reduce((a, ch) => a + (HW[ch] || 0.7), 0))) * sz;
    const B = [xs[0] - w / 2 - c.x, e.y - cap - c.y, xs[0] + w / 2 - c.x, e.y + (e.lines.length - 1) * lh - c.y];
    const dist = (x, y) => Math.hypot(Math.max(B[0] - x, 0, x - B[2]), Math.max(B[1] - y, 0, y - B[3]));
    let gap = Infinity;
    for (const [[ax, ay], [bx, by]] of ticks) for (let k = 0; k <= 40; k++) gap = Math.min(gap, dist(ax + (bx - ax) * k / 40, ay + (by - ay) * k / 40));
    assert.ok(gap >= 0.3, `${e.lines.join(' ')}: ${gap.toFixed(2)} mm from the nearest detent tick`);
    if (e.lines.length > 1) assert.ok(dist(0, 0) >= c.d / 2 + 0.3, `${e.lines.join(' ')}: ${(dist(0, 0) - c.d / 2).toFixed(2)} mm clear of the knob`);
  }
  // COMPOSE (single-line, clear of its tick) stays where it always was
  const comp = els.find(e => e.lines[0] === 'COMPOSE'), [cx, cy] = pt(c.d / 2 + 3.9 + 0.4, ang(5));
  assert.deepEqual([+(+comp.x).toFixed(2), +comp.y.toFixed(2)], [+(c.x + cx).toFixed(2), +(c.y + cy + 0.85).toFixed(2)]);
  // a single-line dial (the 808's AUTO FILL IN): the legends at the label radius, as before (baseline + 0.85)
  const f = T8.controls.find(x => x.id === 'dr:fill'), rl = f.d / 2 + 3.9 + 0.4;
  const e16 = textEls(svg).find(e => e.size === 2.4 && e.lines[0] === '16'), a = (-f.sweep / 2 + f.sweep / 5) * Math.PI / 180;
  assert.deepEqual([+(+e16.x).toFixed(2), +(e16.y).toFixed(2)], [+(f.x + Math.sin(a) * rl).toFixed(2), +(f.y - Math.cos(a) * rl + 0.85).toFixed(2)]);
});

/* ---------------------------------------------------------------- (9, IMPL-9 §4.1–§4.2, §8.4) the 900 Series faces */
// a small patch module over one knob: its jack table (ids, sig) and a layout with two jacks, a socket and the knob
const PJ_MODEL = { id: 'pjfx', name: 'Jack fixture', theme: { knob: 'std' }, controls: [{ t: 'k', id: 'lv', label: 'Level', min: 0, max: 10, def: 5 }],
  jacks: [{ id: 'in', dir: 'in', sig: 'v', label: 'SIGNAL INPUT' }, { id: 'out', dir: 'out', sig: 'v', label: 'SIGNAL OUTPUT' }, { id: 'trg', dir: 'in', sig: 's', label: 'TRIGGER' }] };
const PJ_LAYOUT = {
  v: 1, id: 'pjfx', hw: 'fixture', case: '#121212', scheme: { panel: '#121212', legend: '#eeeeee', jack: { nut: '#d4d4cf', hole: '#080808' } },
  areas: [{ id: 'main', src: [0, 0, 53.975, 222.25], at: [0, 0] }],
  sections: [{ id: 's', label: 'JACKS', x: 0, y: 0, w: 53.975, h: 222.25 }],
  controls: [
    { id: 'lv', kind: 'knob', x: 27, y: 40, d: 26, label: 'LEVEL', lab: 'none' },
    { kind: 'jack', port: 'in', x: 14, y: 120, d: 14, label: 'SIGNAL INPUT', lab: 'none' },
    { kind: 'jack', port: 'out', x: 40, y: 120, d: 14, label: 'SIGNAL OUTPUT', lab: 'none' },
    { kind: 'strig', port: 'trg', x: 27, y: 150, w: 10, h: 8, label: 'TRIGGER', lab: 'none' },
  ],
  extras: { ids: [] },
};
const TYPES9 = MG.ORDER; // every module type (9: nine, 9b: 25 — the controller's face is m900's console)
// (9b) the 5U and the console-height sizes by MU (IMPL-9b §2.1: 4 MU 448, 8 MU 864; a console panel × 352)
const SIZE9 = { module: { 1: [128, 512], 2: [224, 512], 3: [352, 512], 4: [448, 512], 8: [864, 512] }, console: { 2: [224, 352], 3: [352, 352], 4: [448, 352] } };
const S9 = ['921', '921a', '921b', '923', '904a', '907a', '911', '902', '995']; // stage 9's module types (panels/m900.js)

test('9 validate: a live patch jack — each broken rule reported (one mutation per rule), naming the field; the fixture with its three jacks validates', () => {
  assert.deepEqual(P.validate(PJ_LAYOUT, PJ_MODEL), []);
  const bad = (f, re, m) => {
    const L = clone(PJ_LAYOUT);
    f(L);
    const p = P.validate(L, PJ_MODEL);
    assert.ok(p.some(x => re.test(x)), (m || re) + ' → ' + JSON.stringify(p));
  };
  bad(L => { delete L.controls[1].port; }, /controls\[1\]: a jack is decoration only/, 'a live jack without port');
  bad(L => { L.controls[1].port = 'In'; }, /controls\[1\]: port \/\^\[a-z\]/, 'a bad port id');
  bad(L => { L.controls[1].port = 'abcdefghi'; }, /controls\[1\]: port \//, 'a port over 8 characters');
  bad(L => { L.controls[2].port = 'in'; }, /controls\[2\]: port "in" twice/, 'a duplicate port');
  bad(L => { L.controls[2].port = 'cv'; }, /controls\[2\]: port "cv" is not a jack of the model/, 'a port the type lacks');
  bad(L => { L.controls[2].port = 'cv'; }, /out: not placed \(a patch jack of the model\)/, 'every jack of the type on the face');
  bad(L => { L.controls[3] = { kind: 'jack', port: 'trg', x: 27, y: 150, d: 14, label: 'TRIGGER' }; }, /controls\[3\]: trg is an S-trigger socket \(strig\)/, 'an S-trigger socket drawn as a 1/4" jack');
  bad(L => { L.controls[1] = { kind: 'strig', port: 'in', x: 14, y: 120, w: 10, h: 8, label: 'SIGNAL INPUT' }; }, /controls\[1\]: in is a 1\/4" jack \(jack\)/, 'a 1/4" jack drawn as a socket');
  bad(L => { L.controls[1].id = 'lv'; }, /controls\[1\] \(lv\): a patch jack has no id/, 'an id');
  bad(L => { L.controls[1].inert = 'later'; }, /controls\[1\]: a patch jack is live \(no inert\)/, 'inert');
  bad(L => { L.controls[1].label = ' '; }, /controls\[1\]: a patch jack needs its label/, 'no label');
  bad(L => { L.controls[2].x = 27.9; }, /controls\[1\] and controls\[2\]: jack centres 13\.9 mm apart < 15 mm/, 'two centres < 15 mm apart');
  bad(L => { L.controls[1].y = 60; }, /controls\[1\]: its centre 7 mm from controls\[0\] \(lv\)'s hit box < 9 mm/, 'a centre < 9 mm from a knob\'s hit box');
  bad(L => { L.controls[0].port = 'in'; }, /controls\[0\] \(lv\): port is a patch jack's \(kind jack \| strig\)/, 'a port on a knob');
  bad(L => { L.controls[1].x = 80; }, /controls\[1\]: outside its area/, 'inside the area');
  bad(L => { L.sections[0].h = 100; }, /controls\[1\]: not inside a section/, 'inside a section');
  // a model with no jack table: every port unknown; an inert jack (decoration) is not a patch jack
  const FXJ = clone(FX_LAYOUT);
  FXJ.controls.push({ kind: 'jack', port: 'out', x: 250, y: 90, d: 7, label: 'OUT' });
  assert.ok(P.validate(FXJ, FX_MODEL).some(x => /port "out" is not a jack of the model/.test(x)));
  assert.deepEqual(P.geometry(FX_LAYOUT, FX_MODEL).jacks, [], 'the fixture\'s inert jack is art only');
  assert.deepEqual([P.PORT_RE.test('kp1'), P.PORT_RE.test('1a'), P.JACK_PITCH_MM, P.JACK_CLEAR_MM], [true, false, 15, 9]);
});

test('9 geometry().jacks: body px = the layout\'s mm × 2 + the centring (three decimals), the table\'s labels and directions, a socket\'s w × h, each one\'s widest hit circle (its nearest centre − 2, twice its clearance), jackPitch / jackHit; no widget, no Tab stop, no hit box', () => {
  const g = P.geometry(PJ_LAYOUT, PJ_MODEL), X = P.PX_PER_MM, off = g.mm.offX;
  assert.deepEqual([g.W, g.H, off], [128, 512, 10], '1 MU: 107.95 px centred in 128');
  eq1(g.jacks.map(j => [j.port, j.kind, j.sig, j.dir, j.label, j.x, j.y, j.d, j.w, j.h]), [
    ['in', 'jack', 'v', 'in', 'SIGNAL INPUT', 10 + 14 * X, 120 * X, 28, 28, 28], ['out', 'jack', 'v', 'out', 'SIGNAL OUTPUT', 10 + 40 * X, 120 * X, 28, 28, 28],
    ['trg', 'strig', 's', 'in', 'TRIGGER', 10 + 27 * X, 150 * X, 20, 20, 16]]);
  // in ↔ out 52 px, in ↔ trg √(26² + 60²) = 65.39 px; the knob's hit box (26 mm) ends at y 106 px
  const dIT = Math.hypot(26, 60);
  assert.deepEqual(g.jacks.map(j => j.hit), [50, 50, Math.round((dIT - 2) * 1000) / 1000]);
  assert.deepEqual([g.jackPitch, g.jackHit], [52, 50]);
  assert.deepEqual(g.controls.filter(o => o.port).map(o => [o.port, o.live, o.show, o.sec]), [['in', false, false, -1], ['out', false, false, -1], ['trg', false, false, -1]]);
  assert.deepEqual(P.hitBoxes(PJ_LAYOUT, PJ_MODEL).map(h => h.id), ['lv'], 'a jack is no rect hit box (cv-module\'s span, its circle)');
  assert.equal(g.order.length, 1, 'no Tab stop here: the module\'s one roving stop is cv-module\'s');
  // a jack near the knob: its circle is held to twice its clearance
  const L2 = clone(PJ_LAYOUT); L2.controls[1].y = 75;
  const j2 = P.geometry(L2, PJ_MODEL).jacks[0];
  assert.equal(j2.hit, 2 * (75 - 53) * X, 'twice the 22 mm from the knob\'s 26 mm hit box');
  // the widest circle with nothing near: JACK_HIT_MAX
  const L3 = clone(PJ_LAYOUT); L3.controls = [L3.controls[0], L3.controls[1]]; L3.controls[1].y = 200;
  eq1([P.geometry(L3, Object.assign({}, PJ_MODEL, { jacks: [PJ_MODEL.jacks[0]] })).jacks[0].hit, P.JACK_HIT_MAX], [88, 88]);
  // every existing panel: no jacks
  for (const id of authored) if (id !== 'm900') eq1([P.geometry(P.layoutOf(id), modelOf(id)).jacks, P.geometry(P.layoutOf(id), modelOf(id)).jackPitch], [[], null], id);
});

test('9 the art: a patch jack drawn at full contrast (no opacity), titled with its label, data-port its port; a socket our two-slot drawing; no data-tip', () => {
  const svg = P.decorSvg(PJ_LAYOUT, PJ_MODEL);
  const gs = [...svg.matchAll(/<g class="hw-jack" data-port="([^"]+)"><title>([^<]*)<\/title>(.*?)<\/g>/g)].map(m => [m[1], m[2], (m[3].match(/<circle/g) || []).length, (m[3].match(/<rect/g) || []).length, (m[3].match(/<path/g) || []).length]);
  eq1(gs, [['in', 'SIGNAL INPUT', 2, 0, 0], ['out', 'SIGNAL OUTPUT', 2, 0, 0], ['trg', 'TRIGGER', 0, 1, 1]]);
  assert.ok(!/hw-jack[^>]*opacity/.test(svg) && !/hw-jack[^>]*data-tip/.test(svg), 'full contrast, no tip');
  assert.ok(svg.includes('fill="#d4d4cf"') && svg.includes('fill="#080808"'), 'the scheme\'s nut and hole');
});

test('9 moduleModel / moduleLayout: a synthetic model per module type (memoised; the controller and unknown types: null), its face validated (a broken fixture: null, said once), the console is m900\'s hardware layout', () => {
  eq1(TYPES9.filter(t => MG.TYPES[t].face === 'console'), ['961', 'clk', 'cp2', 'cp3a', 'cp4a', 'cp35', 'cp8a'], '(9b) the console-height types are modules too');
  for (const t of TYPES9) {
    const m = P.moduleModel(t), T = MG.TYPES[t];
    assert.equal(P.moduleModel(t), m, t + ': memoised');
    eq1([m.id, m.name, m.type, m.layout, m.patch, m.theme.knob, m.controls.map(c => c.id), m.sections[0].c === T.params, m.jacks === T.jacks],
      ['pm-' + t, T.name, t, T.layout, 'moog', 'moog', T.params.map(c => c.id), true, true], t);
    eq1([m.ev.map(e => e.id), m.lamps.map(e => e.id)], [(T.ev || []).map(e => e.id), (T.lamps || []).map(e => e.id)], t + ': (9b) its events and lamps');
    assert.equal(P.moduleLayout(t), P.moduleLayoutOf(t), t + ': valid, so used');
    assert.equal(P.moduleLayoutOf(t).id, 'pm-' + t);
  }
  eq1([P.moduleModel('ctl'), P.moduleModel('nope'), P.moduleModel(null), P.moduleLayout('ctl'), P.moduleLayout('nope')], [null, null, null, null, null]);
  assert.equal(P.usable('m900', modelOf('m900')), P.layoutOf('m900'), 'the controller\'s face: the model\'s console');
  // a page simulation's fixture face ('pm-<type>'): used when valid, refused (null, one warning) when not, never cached
  const warn = console.warn, said = [];
  console.warn = s => said.push(String(s));
  try {
    globalThis.__synthTest = { panels: { 'pm-911': Object.assign(clone(P.moduleLayoutOf('911')), { id: 'other' }) } };
    assert.equal(P.moduleLayout('911'), null);
    assert.equal(said.length, 1);
    assert.match(said[0], /the 911 module face is not used/);
  } finally { delete globalThis.__synthTest; console.warn = warn; }
  assert.equal(P.moduleLayout('911'), P.moduleLayoutOf('911'), 'the real face again');
});

test('9 / 9b the faces: the console and the 25 module faces valid; §2.2\'s sizes (1 / 2 / 3 / 4 / 8 MU, the console-height 2 / 3 / 4 MU, the console) = moog-core\'s w / h; every param once, live; the ports = the type\'s jack ids but the rear terminals (a socket where sig s); the event buttons and lamps = the type\'s; hit boxes ≥ 28 px and disjoint (the event buttons\' too), the 14 mm jack circles inside the body; only trunks and the CP8A dimmed; original art', () => {
  const faces = [['m900', P.layoutOf('m900'), modelOf('m900'), MG.TYPES.ctl], ...TYPES9.map(t => [t, P.moduleLayoutOf(t), P.moduleModel(t), MG.TYPES[t]])];
  const INERT = { cp3a: ['jack', 'jack', 'jack', 'jack'], cp4a: ['jack', 'jack', 'jack', 'jack'], cp35: ['jack', 'jack', 'jack', 'jack'], cp8a: ['switch', 'lamp', 'fuse', 'fuse'] };
  for (const [t, L, m, T] of faces) {
    assert.deepEqual(P.validate(L, m), [], t);
    const s = P.sizeOf(L, m), g = P.geometry(L, m);
    eq1([s.w, s.h], [T.w, T.h], t + ': moog-core\'s size');
    eq1([s.w, s.h], t === 'm900' ? [864, 352] : SIZE9[T.face][T.mu], t + ': §2.2');
    assert.equal(g.extras, null, t + ': no extras strip (every control on the face; (9b) a patch face\'s dimmed parts say it in their tips)');
    const live = L.controls.filter(c => typeof c.id === 'string').map(c => c.id).sort();
    eq1(live, T.params.map(c => c.id).sort(), t + ': every param once');
    eq1(L.controls.filter(c => c.inert).map(c => c.kind), INERT[t] || [], t + ': dimmed only the trunks and the CP8A\'s parts');
    for (const c of L.controls.filter(x => x.inert)) assert.ok(c.label && (c.kind !== 'jack' || /^TRUNK [1-4]$/.test(c.label)), t + ': ' + c.label);
    const front = T.jacks.filter(j => !j.rear).map(j => j.id).sort();
    eq1(L.controls.filter(c => c.port != null).map(c => c.port).sort(), front, t + ': the ports = the jack ids, never a rear terminal');
    eq1(g.jacks.map(j => j.port).sort(), front);
    eq1([g.evs.map(e => e.id).sort(), g.lamps.map(e => e.id).sort()], [(T.ev || []).map(e => e.id).sort(), (T.lamps || []).map(e => e.id).sort()], t + ': (9b) the event buttons and lamps');
    for (const j of g.jacks) {
      const J = T.jacks.find(x => x.id === j.port);
      eq1([j.kind, j.label, j.dir], [J.sig === 's' ? 'strig' : 'jack', J.label, J.dir], t + ' ' + j.port);
      assert.ok(j.x - 14 >= 0 && j.y - 14 >= 0 && j.x + 14 <= g.body.w && j.y + 14 <= g.body.h, t + ' ' + j.port + ': its 14 mm circle inside the body');
      assert.ok(j.hit >= 28 && j.hit <= P.JACK_HIT_MAX, t + ' ' + j.port + ': hit ' + j.hit);
    }
    for (let i = 0; i < g.jacks.length; i++) for (let k = i + 1; k < g.jacks.length; k++) {
      const a = g.jacks[i], b = g.jacks[k];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 30 - 1e-6, `${t}: ${a.port} ↔ ${b.port}`);
      assert.ok(a.hit / 2 + b.hit / 2 <= Math.hypot(a.x - b.x, a.y - b.y), `${t}: ${a.port} / ${b.port}: their widest circles never touch`);
    }
    const hb = P.hitBoxes(L, m).concat(g.evs.map(e => Object.assign({ id: 'ev:' + e.id }, e.hit))); // ((9b) an event button's press box with the controls')
    for (const h of hb) {
      assert.ok(h.w >= 28 && h.h >= 28, `${t} ${h.id}: ${h.w} × ${h.h} px`);
      assert.ok(h.x >= 0 && h.y >= 0 && h.x + h.w <= g.body.w && h.y + h.h <= g.body.h, `${t} ${h.id} inside the body`);
      for (const j of g.jacks) assert.ok(Math.hypot(Math.max(h.x - j.x, 0, j.x - h.x - h.w), Math.max(h.y - j.y, 0, j.y - h.y - h.h)) >= j.hit / 2 - 1e-6, `${t}: ${j.port}'s widest circle clear of ${h.id}`);
    }
    for (let i = 0; i < hb.length; i++) for (let k = i + 1; k < hb.length; k++) {
      const a = hb[i], b = hb[k];
      assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${t}: ${a.id} × ${b.id} overlap`);
    }
    for (const l of g.lamps) assert.ok(l.x - l.d / 2 >= 0 && l.y - l.d / 2 >= 0 && l.x + l.d / 2 <= g.body.w && l.y + l.d / 2 <= g.body.h, `${t} ${l.id} inside the body`);
    const svg = P.decorSvg(L, m);
    for (const bad of ['<image', 'href', 'xlink', '<foreignObject', '<script', 'javascript:']) assert.equal(svg.includes(bad), false, t + ' ' + bad);
    for (const tx of [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(x => x[1])) assert.doesNotMatch(tx, new RegExp('\\b(' + P.MAKERS.join('|') + ')\\b'), t + ': ' + tx);
    assert.doesNotMatch(L.hw + JSON.stringify(L.notes || []), /\bMoog\b/, t + ': no maker word in the notes either');
    assert.equal((svg.match(/<g class="hw-jack"/g) || []).length, front.length, t + ': one jack drawing per front jack');
    eq1([(svg.match(/<g class="hw-ev"/g) || []).length, (svg.match(/<g class="hw-lamp"/g) || []).length], [g.evs.length, g.lamps.length], t + ': (9b) one drawing per event button and lamp');
  }
  // the console's caption says it is ours; the four faces without a photograph say so in their notes; (9b) every m900b face
  // says it is ours, the stand-ins and our Song clock on their plates too
  const cs = P.decorSvg(P.layoutOf('m900'), modelOf('m900'));
  assert.ok(cs.includes('>CONTROLLER<') && cs.includes('OURS — STANDS IN FOR THE'));
  for (const t of ['921a', '921b', '907a', '923']) assert.match(P.moduleLayoutOf(t).notes.join(' '), /no photograph viewed/, t);
  for (const t of TYPES9.filter(x => !S9.includes(x))) assert.match(P.moduleLayoutOf(t).notes.join(' '), /^Ours \(no photograph viewed\)/, t);
  for (const [t, re] of [['cp4a', /OURS — ITS ROUTING STANDS IN FOR THE ORIGINAL’S/], ['cp35', /OURS — A STAND-IN/], ['cp2', /OURS — FROM A SHORT LIST/], ['clk', /OURS — THE SONG’S TEMPO AS PULSES/]])
    assert.match(P.decorSvg(P.moduleLayoutOf(t), P.moduleModel(t)), re, t + ': its plate says it is ours');
});

test('9 a module face rendered over a fake per-instance api (vals.p[mid]): one .hw-c per param in the Tab order, writes into that module\'s record only, no History; no widget over a jack; deterministic; every module face renders', () => {
  const t = '904a', L = P.moduleLayout(t), model = P.moduleModel(t), doc = fresh(), root = doc.createElement('div');
  doc.body.append(root);
  const vals = { p: { m3: { _t: t }, m4: { _t: '911' } } }, mid = 'm3', log = [];
  const api = Object.assign(fakeApi(model, doc), {
    get: id => (id in vals.p[mid] ? vals.p[mid][id] : model.controls.find(c => c.id === id).def),
    set: (id, v) => { vals.p[mid][id] = v; log.push(id + '=' + v); const u = api.ui.get(id); if (u) u(); },
    hist: () => log.push('HISTORY'),
  });
  const r = P.render(root, L, model, api);
  eq1([r.w, r.h], [128, 512]);
  const ctl = all(root).filter(n => n.getAttribute && n.getAttribute('data-ctl')).map(n => n.getAttribute('data-ctl'));
  eq1(ctl, ['fc', 'rg', 're'], 'the params, in the Tab order (rows, then x)');
  assert.equal(all(root).filter(n => n.getAttribute && n.getAttribute('data-port')).length, 0, 'no DOM widget for a jack (the face draws them; cv-module\'s spans take them)');
  // the 904A's FREQUENCY RANGE: a three-detent rotary; a tap steps 2 → 3 through the per-instance api
  const rg = widgetOf(root, 'rg');
  eq1([rg.getAttribute('aria-valuenow'), rg.getAttribute('aria-valuetext')], ['1', '2'], 'the default range 2 (index 1)');
  fire(rg, 'pointerdown', { clientX: 0, clientY: 0 }); fire(rg, 'pointerup', { clientX: 0, clientY: 0 });
  eq1([vals.p.m3.rg, vals.p.m4, log], [2, { _t: '911' }, ['rg=2']], 'one write into m3\'s record, m4 untouched, no History');
  r.destroy();
  const ser = n => n.localName + '.' + cls(n) + '[' + (n.getAttribute('data-ctl') || '') + ']' + JSON.stringify(n.style) + '(' + n.childNodes.filter(c => c.nodeType === 1).map(ser).join(',') + ')';
  const once = () => { const d = fresh(), rt = d.createElement('div'); d.body.append(rt); P.render(rt, L, model, fakeApi(model, d)); return ser(rt); };
  assert.equal(once(), once());
  for (const ty of TYPES9) {
    const m = P.moduleModel(ty), d = fresh(), rt = d.createElement('div'), a = fakeApi(m, d);
    d.body.append(rt); P.render(rt, P.moduleLayout(ty), m, a);
    const ids = all(rt).filter(n => n.getAttribute && n.getAttribute('data-ctl')).map(n => n.getAttribute('data-ctl'));
    eq1(ids.slice().sort(), m.controls.map(c => c.id).sort(), ty);
    for (const c of m.controls) assert.ok(a.ui.has(c.id), ty + ': ui ' + c.id);
  }
});

/* ---------------------------------------------------------------- (9b, IMPL-9b §4.1–§4.2, §8.4) the System 35 / 55 faces */
// a patch module with a knob, a three-detent rotary, a bat switch, two event buttons, a lamp, two jacks and a rear terminal;
// its face lite (the knobs' skirts and caps in the art)
const EV_MODEL = { id: 'evfx', name: 'Event fixture', theme: { knob: 'std' }, patch: 'fx',
  controls: [{ t: 'k', id: 'lv', label: 'Level', min: 0, max: 10, def: 5 }, { t: 's', id: 'md', label: 'Mode', opts: ['A', 'B', 'C'], def: 1 }, { t: 's', id: 'sw', label: 'Route', opts: ['Off', 'On'], def: 0 }],
  jacks: [{ id: 'in', dir: 'in', sig: 'v', label: 'SIGNAL INPUT' }, { id: 'out', dir: 'out', sig: 'v', label: 'SIGNAL OUTPUT' }, { id: 'xr', dir: 'out', sig: 'v', label: 'EXT (REAR)', rear: 1 }],
  ev: [{ id: 'go', label: 'GO' }, { id: 'st', label: 'STOP' }], lamps: [{ id: 'l1', label: 'LAMP 1' }] };
const EV_LAYOUT = {
  v: 1, id: 'evfx', hw: 'fixture', case: '#121212', lite: true,
  scheme: { panel: '#121212', legend: '#eeeeee', knob: { skirt: '#101010', cap: '#c9c9c4', ptr: '#f4f2ea', ptrStyle: 'line', knurl: true, capR: 0.56 },
    jack: { nut: '#d4d4cf', hole: '#080808' }, button: { cap: '#e4dfd2', text: '#1a1a1a' } },
  areas: [{ id: 'main', src: [0, 0, 53.975, 222.25], at: [0, 0] }],
  sections: [{ id: 's', label: 'ALL', x: 0, y: 0, w: 53.975, h: 222.25 }],
  controls: [
    { id: 'lv', kind: 'knob', x: 27, y: 36, d: 24, sweep: 300, label: 'LEVEL', lab: 'none' },
    { id: 'md', kind: 'rotary', x: 15, y: 72, d: 16, sweep: 90, legends: ['A', 'B', 'C'], label: 'MODE', lab: 'none' },
    { id: 'sw', kind: 'switch', style: 'bat', orient: 'h', x: 40, y: 72, w: 10, h: 6, label: 'ROUTE', lab: 'none' },
    { kind: 'button', ev: 'go', x: 15, y: 100, w: 10, h: 7, label: 'GO', onCap: 'GO', lab: 'none' },
    { kind: 'button', ev: 'st', x: 40, y: 100, w: 10, h: 7, label: 'STOP', lab: 'none' },
    { kind: 'lamp', lamp: 'l1', x: 27, y: 120, d: 6, color: '#f0642c', label: 'LAMP 1', lab: 'none' },
    { kind: 'jack', port: 'in', x: 14, y: 140, d: 14, label: 'SIGNAL INPUT', lab: 'none' },
    { kind: 'jack', port: 'out', x: 40, y: 140, d: 14, label: 'SIGNAL OUTPUT', lab: 'none' },
  ],
  extras: { ids: [] },
};

test('9b validate: an event button, a live lamp, a rear terminal, lite — each broken rule reported (one mutation per rule); the fixture (a rear terminal not placed) and a face with no params and no jacks validate; panels/m900b.js has no default export', async () => {
  assert.deepEqual(P.validate(EV_LAYOUT, EV_MODEL), []);
  const bad = (f, re, m, model = EV_MODEL) => {
    const L = clone(EV_LAYOUT);
    f(L);
    const p = P.validate(L, model);
    assert.ok(p.some(x => re.test(x)), (m || re) + ' → ' + JSON.stringify(p));
  };
  // the event buttons
  bad(L => { L.controls[3].ev = 'zz'; }, /controls\[3\]: ev "zz" is not an event of the model/, 'an event the type lacks');
  bad(L => { L.controls[3].ev = 'zz'; }, /go: not placed \(an event button of the model\)/, 'every event on the face');
  bad(L => { L.controls[4].ev = 'go'; }, /controls\[4\]: ev "go" twice/, 'an event twice');
  bad(L => { L.controls[3].kind = 'switch'; }, /controls\[3\]: ev is an event button's \(kind button\)/, 'ev on another kind');
  bad(L => { L.controls[3].id = 'lv'; }, /an event button has no id/, 'an id (it stores nothing)');
  bad(L => { L.controls[3].inert = true; }, /controls\[3\]: an event button is live/, 'inert');
  bad(L => { L.controls[3].cycle = [0, 1]; }, /controls\[3\]: an event button has no cycle/, 'a cycle');
  bad(L => { L.controls[3].hit = [10, 10]; }, /controls\[3\]: hit box 10 × 10 mm < 14 mm/, 'its hit box ≥ 14 mm');
  bad(L => { L.controls[3].x = 27; L.controls[3].y = 52; }, /controls\[0\] \(lv\) and controls\[3\]: hit boxes overlap/, 'disjoint from a control\'s');
  bad(L => { L.controls[6].y = 114; }, /controls\[6\]: its centre 6\.5 mm from controls\[3\]'s hit box < 9 mm/, 'a jack ≥ 9 mm from its hit box');
  bad(L => { L.controls[3].sec = 'nope'; }, /controls\[3\]: not inside a section \("nope" unknown\)/, 'inside a section');
  // the lamps
  bad(L => { L.controls[5].lamp = 'zz'; }, /controls\[5\]: lamp "zz" is not a lamp of the model/, 'a lamp the type lacks');
  bad(L => { L.controls[5].lamp = 'zz'; }, /l1: not placed \(a lamp of the model\)/, 'every lamp on the face');
  bad(L => { L.controls.push({ kind: 'lamp', lamp: 'l1', x: 27, y: 128, d: 6 }); }, /controls\[8\]: lamp "l1" twice/, 'a lamp twice');
  bad(L => { L.controls[5].kind = 'led'; }, /controls\[5\]: lamp is a live lamp's \(kind lamp\)/, 'lamp on another kind');
  bad(L => { L.controls[5].id = 'lv'; }, /a live lamp has no id/, 'an id');
  bad(L => { L.controls[5].inert = true; }, /controls\[5\]: a live lamp is not inert/, 'inert');
  // a rear terminal: never on a face
  bad(L => { L.controls.push({ kind: 'jack', port: 'xr', x: 27, y: 175, d: 14, label: 'EXT' }); }, /controls\[8\]: xr is a rear terminal \(never on a face/, 'a rear terminal placed');
  // lite: a patch face's only, its pointers lines
  bad(() => {}, /^lite: true, on a patch module face only/, 'lite off a patch face', Object.assign({}, EV_MODEL, { patch: undefined }));
  bad(L => { L.lite = 'yes'; }, /^lite: true, on a patch module face only/, 'lite is true');
  bad(L => { L.controls[1].skin = { ptrStyle: 'fin' }; }, /controls\[1\] \(md\): a lite face's pointer is a line/, 'a lite fin');
  bad(L => { L.scheme.knob.ptrStyle = 'dot'; }, /scheme\.knob\.ptrStyle: a lite face's pointer is a line/, 'a lite scheme dot');
  // a face with no params and no jacks (the CP8A's shape): valid; its dimmed part makes no extras strip on a patch face
  const NM = { id: 'nofx', name: 'Empty', theme: { knob: 'std' }, patch: 'fx', controls: [], jacks: [], ev: [], lamps: [] };
  const NL = { v: 1, id: 'nofx', hw: 'fixture', case: '#121212', lite: true, areas: [{ id: 'main', src: [0, 0, 53.975, 142.875], at: [0, 0] }],
    sections: [{ id: 's', label: 'ALL', x: 0, y: 0, w: 53.975, h: 142.875 }],
    controls: [{ kind: 'fuse', x: 27, y: 60, w: 9, h: 18, inert: true, label: 'FUSE' }], decor: [{ t: 'text', x: 27, y: 20, s: 'POWER' }], extras: { ids: [] } };
  assert.deepEqual(P.validate(NL, NM), []);
  eq1([P.geometry(NL, NM).extras, P.sizeOf(NL, NM)], [null, { w: 128, h: 352 }], 'no strip: the size is the type\'s');
  const NX = Object.assign({}, NM, { patch: undefined }), NXL = Object.assign(clone(NL), { lite: undefined });
  assert.equal(P.geometry(NXL, NX).extras.note, true, 'a hardware model keeps its "not emulated" strip');
  // the faces' file: { <type>: layout } only (tests/moog-core.test.mjs reads every exported object)
  const B = await import('../panels/m900b.js?v=9');
  eq1([Object.keys(B), B.default], [['MODULES'], undefined]);
  eq1(Object.keys(B.MODULES).sort(), TYPES9.filter(t => !S9.includes(t)).sort(), 'the sixteen 9b types');
  for (const t of TYPES9) assert.equal(P.MODULE_LAYOUTS[t], S9.includes(t) ? P.moduleLayoutOf(t) : B.MODULES[t], t + ': merged by panels/index.js');
});

test('9b geometry().evs / .lamps: body px = the layout\'s mm × 2 + the centring (three decimals), the type\'s labels, an event button\'s press box (≥ 28 px), a lamp\'s d; no widget, no Tab stop, not in hitBoxes(); a jack\'s widest circle kept off an event button; every existing panel: none', () => {
  const g = P.geometry(EV_LAYOUT, EV_MODEL), X = P.PX_PER_MM;
  assert.equal(g.mm.offX, 10);
  eq1(g.evs, [{ id: 'go', label: 'GO', x: 10 + 15 * X, y: 100 * X, w: 20, h: 14, hit: { x: 10 + 7.5 * X, y: 92.5 * X, w: 30, h: 30 } },
    { id: 'st', label: 'STOP', x: 10 + 40 * X, y: 100 * X, w: 20, h: 14, hit: { x: 10 + 32.5 * X, y: 92.5 * X, w: 30, h: 30 } }]);
  eq1(g.lamps, [{ id: 'l1', label: 'LAMP 1', x: 10 + 27 * X, y: 120 * X, d: 12, w: 12, h: 12 }]);
  eq1(g.controls.filter(o => o.ev || o.lamp).map(o => [o.ev || o.lamp, o.live, o.show, o.sec]), [['go', false, false, -1], ['st', false, false, -1], ['l1', false, false, -1]]);
  eq1([P.hitBoxes(EV_LAYOUT, EV_MODEL).map(h => h.id), g.order.map(i => g.controls[i].id)], [['lv', 'md', 'sw'], ['lv', 'md', 'sw']], 'the controls only: the host mounts the buttons and lamps');
  eq1(g.jacks.map(j => j.port), ['in', 'out'], 'the rear terminal is no face jack');
  // a jack 10.5 mm under GO's press box: its widest circle twice that clearance (the button counts as a control's box)
  const L2 = clone(EV_LAYOUT); L2.controls[6].y = 118;
  eq1(P.geometry(L2, EV_MODEL).jacks[0].hit, 2 * (118 - 107.5) * X);
  for (const id of authored) eq1([P.geometry(P.layoutOf(id), modelOf(id)).evs, P.geometry(P.layoutOf(id), modelOf(id)).lamps], [[], []], id);
  for (const t of S9) eq1([P.geometry(P.moduleLayoutOf(t), P.moduleModel(t)).evs, P.geometry(P.moduleLayoutOf(t), P.moduleModel(t)).lamps], [[], []], t);
});

test('9b the art: an event button\'s cap (its onCap word, titled with the event\'s label, data-ev, full contrast) and an unlit lamp (data-lamp, the lens at 0.45); a lite face\'s knob skirts (knurled) and caps — none without lite; a patch face\'s inert parts dimmed with their tips', () => {
  const svg = P.decorSvg(EV_LAYOUT, EV_MODEL);
  const evs = [...svg.matchAll(/<g class="hw-ev" data-ev="([^"]+)"><title>([^<]*)<\/title>(.*?)<\/g>/g)].map(m => [m[1], m[2], (m[3].match(/<rect/g) || []).length, (m[3].match(/<text[^>]*>([^<]*)<\/text>/) || [])[1] || '']);
  eq1(evs, [['go', 'GO', 1, 'GO'], ['st', 'STOP', 1, '']]);
  assert.ok(svg.includes('fill="#e4dfd2"'), 'the scheme\'s cap');
  const lp = /<g class="hw-lamp" data-lamp="l1"><title>LAMP 1<\/title>(.*?)<\/g>/.exec(svg);
  assert.ok(lp && /fill="#f0642c" opacity="0\.45"/.test(lp[1]), 'unlit: the lens dimmed');
  assert.ok(!/hw-(ev|lamp)[^>]*(opacity|data-tip)/.test(svg), 'full contrast, no tip');
  // the lite knob (d 24: u 0.48) and rotary (d 16: u 0.32): the skirt knurled (#101010 → #585858), the cap 25 · 0.56 · u
  assert.ok(svg.includes('<circle cx="27" cy="36" r="12" fill="#101010" stroke="#585858" stroke-width="0.624" stroke-dasharray="0.552 0.552"/><circle cx="27" cy="36" r="6.72" fill="#c9c9c4" stroke="#000" stroke-opacity="0.45" stroke-width="0.288"/>'), 'the knob at rest');
  assert.ok(svg.includes('<circle cx="15" cy="72" r="8" fill="#101010"') && svg.includes('r="4.48" fill="#c9c9c4"'), 'the rotary at rest');
  const NL = clone(EV_LAYOUT); delete NL.lite;
  assert.ok(!P.decorSvg(NL, EV_MODEL).includes('fill="#101010"'), 'not lite: the DOM draws the knobs');
  // the CP8A: its parts dimmed, each saying "not emulated"
  const c8 = P.decorSvg(P.moduleLayoutOf('cp8a'), P.moduleModel('cp8a'));
  eq1([...c8.matchAll(/class="hw-inert" opacity="0\.55" data-tip="([^"]+)"/g)].map(m => m[1]), ['POWER — not emulated', 'PILOT — not emulated', 'FUSE 1 — not emulated', 'FUSE 2 — not emulated']);
});

test('9b render (lite): a knob or a rotary is its widget and a pointer (3 elements with its .hw-c) turned by the value, written through api.bind / its detents; a bat switch without its slot line; no widget for an event button or a lamp; every 9b face\'s live layer is 3 elements a control (the 960: 121, the 914: 43)', () => {
  const doc = fresh(), root = doc.createElement('div'), api = fakeApi(EV_MODEL, doc);
  doc.body.append(root);
  P.render(root, EV_LAYOUT, EV_MODEL, api);
  const ctls = root.childNodes[1];
  eq1(ctls.childNodes.map(n => n.getAttribute('data-ctl')), ['lv', 'md', 'sw']);
  const lv = widgetOf(root, 'lv'), ptrOf = el => el.childNodes.find(n => n.nodeType === 1 && cls(n) === 'hw-lp');
  eq1([cls(lv), lv.childNodes.length, all(byCtl(root, 'lv')).length], ['knob hw-lk', 1, 3]);
  eq1([lv.getAttribute('role'), lv.getAttribute('aria-valuemin'), lv.getAttribute('aria-valuemax'), lv.getAttribute('aria-valuenow'), lv.getAttribute('aria-valuetext')], ['slider', '0', '10', '5', '5']);
  const p = ptrOf(lv).style;
  eq1([p.position, p.left, p.top, p.width, p.height, p.borderRadius, p.background, p.transformOrigin, p.transform],
    ['absolute', '48.125%', '10.625%', '3.75%', '17.813%', '999px', 'var(--hw-knob-ptr, #fff)', '50% 221.053%', 'rotate(0deg)'], 'today\'s line pointer (capR 0.56: y 8 … 17 of 64), at 5 of 0…10');
  api.set('lv', 10);
  eq1([p.transform, lv.getAttribute('aria-valuenow')], ['rotate(150deg)', '10']);
  ptr(lv, 'pointerdown', 0, 100); ptr(lv, 'pointermove', 0, 140); ptr(lv, 'pointerup', 0, 140);
  eq1([api.vals.lv, p.transform], [0, 'rotate(-150deg)'], 'a drag down through api.bind');
  const md = widgetOf(root, 'md');
  eq1([cls(md), md.childNodes.length, ptrOf(md).style.transform, md.getAttribute('aria-valuetext')], ['knob hw-rot hw-lk', 1, 'rotate(0deg)', 'B']);
  ptr(md, 'pointerdown', 0, 0); ptr(md, 'pointerup', 0, 0);
  eq1([api.vals.md, ptrOf(md).style.transform], [2, 'rotate(45deg)'], 'a tap: the next detent');
  const sw = widgetOf(root, 'sw');
  eq1([cls(sw), sw.childNodes.map(cls)], ['hw-sw', ['hw-sw-k']], 'no slot line');
  assert.equal(all(root).filter(n => n.getAttribute && (n.getAttribute('data-ev') || n.getAttribute('data-lamp'))).length, 0, 'the host mounts the buttons and lamps');
  // not lite: today's widgets (the api's knob, the slot line)
  const NL = clone(EV_LAYOUT); delete NL.lite;
  const d2 = fresh(), r2 = d2.createElement('div'); d2.body.append(r2);
  P.render(r2, NL, EV_MODEL, fakeApi(EV_MODEL, d2));
  eq1([cls(widgetOf(r2, 'lv')), widgetOf(r2, 'sw').childNodes.map(cls)], ['knob', ['hw-sw-t', 'hw-sw-k']]);
  // every 9b face over the fake api: 3 elements a control in the live layer, no slot line, no widget over a jack, a button or a lamp
  const counts = {};
  for (const t of TYPES9.filter(x => !S9.includes(x))) {
    const m = P.moduleModel(t), d = fresh(), rt = d.createElement('div'); d.body.append(rt);
    P.render(rt, P.moduleLayout(t), m, fakeApi(m, d));
    const live = all(rt.childNodes[1]);
    counts[t] = live.length;
    assert.equal(live.length, 1 + 3 * m.controls.length, t + ': ' + live.length);
    assert.ok(!live.some(n => cls(n) === 'hw-sw-t'), t + ': no slot line');
    assert.equal(all(rt).filter(n => n.getAttribute && (n.getAttribute('data-port') || n.getAttribute('data-ev') || n.getAttribute('data-lamp'))).length, 0, t);
  }
  eq1([counts['960'], counts['914']], [121, 43]);
});
