import './v8-guard.mjs';
// The TR-808's panel (IMPL-7a §7, §12.7; lane P1): the dr: tokens in cv-panel's validator (one mutation per rule: a step
// key twice with one n, a missing n, a dr: token of the wrong kind, a detented token's legends / positions, the step key's
// LED, `inert: 'later'` on a knob or without its label, extras tokens on the face and face tokens in the extras), the
// geometry (the 1024 × 1024 module, the extras strip's two rows: grid + pads, then the small controls; the drum caption),
// the face art of an `inert: 'later'` jack (full contrast, "cable-able with full patching"). A fixture layout on the real
// models.js tr808 (positions illustrative: panels/tr808.js carries the photographed ones).
// Run alone: node --max-old-space-size=2048 --test tests/cv-drum.test.mjs
// Phase 2 (§7.4, §12.7): cv-drum.js — the host (drumHost with fake deps: press → its commands, the heard-time step clock,
// TAP's fraction of the heard step, transport / panic, COMPOSE's recording, the pads' notes and REC) and the widgets rendered
// on tests/wk-dom.mjs through cv-panel render with api.drum (the 16 step keys' data-lit, the rotaries stepping through their
// positions, CLEAR held + a key, the grid canvas hit-tested at 3 zooms, the pads' velocity from y and two pointers = two
// hits, ≤ 1 LED update a frame, destroy → release, aria / keyboard, determinism) and without one (the same nodes, silent).
// 7b (IMPL-7b §7, §12.7; lane P1a): the TR-606's tokens in the validator (one mutation per rule: the step keys, SCALE a
// vertical switch of 4, the rotaries' 4 / 8 legends and `rot`, the kinds, at most once, face vs extras tokens, the 808's
// and the 606's tokens apart, every models.js id, no maker word), its geometry (608 × 864; the extras rows: the grid 592 ×
// 192, the pads 232 × 116 + SYNC + SWING, TUNE / DECAY 8 + 3, the small controls + SYNC 303s) and MODE's off-centre dial —
// on a fixture face (R6 §13's positions; the step keys at a 14 mm pitch) over the real models.js tr606.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../cv-panel.js?v=9';
import * as CD from '../cv-drum.js?v=9';
import * as DC from '../drum-core.js?v=9';
import { MODELS } from '../models.js?v=9';
import { BAR_H } from '../cv-module.js?v=9';
import { DOT } from '../cv-world.js?v=9';
import { fresh, all, ptr, fire, key, place as placeEl, layout as layoutEl, raf as rafQ } from './wk-dom.mjs';

const M808 = MODELS.find(m => m.id === 'tr808');
const clone = x => JSON.parse(JSON.stringify(x));
const DR_FACE = ['dr:mode', 'dr:inst', 'dr:fill', 'dr:tempo', 'dr:fine', 'dr:bvar', 'dr:ifv', 'dr:pre', 'dr:start', 'dr:tap', 'dr:clear', 'dr:step', 'dr:part1', 'dr:part2', 'dr:varA', 'dr:varB'];
const DR_EXTRAS = ['dr:grid', 'dr:pads', 'dr:sync', 'dr:swing', 'dr:toRoll', 'dr:rec', 'dr:map', 'dr:sounds', 'dr:demo'];
const OUTS = ['BD', 'SD', 'LT', 'MT', 'HT', 'RS', 'CP', 'CB', 'CY', 'OH', 'CH'];

/* ---------------------------------------------------------------- a fixture TR-808 face (508 × 305 mm, §7.1) */
// the control section (MODE, INSTRUMENT / TRACK, AUTO FILL IN, CLEAR, TEMPO, FINE), the twelve voice columns, MASTER
// VOLUME, the bottom band (variation, START/STOP, PRE-SCALE, the PART LEDs, 16 step keys, I/F VARIATION, TAP), the rear
// legend band with the 11 MULTI OUT jacks (inert 'later') and the power switch (inert)
const TR_FX = (() => {
  const cols = [['ac'], ['bdl', 'bdt', 'bdd'], ['sdl', 'sdt', 'sds'], ['ltl', 'ltt', 'lts'], ['mtl', 'mtt', 'mts'], ['htl', 'htt', 'hts'], ['rsl', 'rss'], ['cpl', 'cps'], ['cbl'], ['cyl', 'cyt', 'cyd'], ['ohl', 'ohd'], ['chl']];
  const sw = new Set(['lts', 'mts', 'hts', 'rss', 'cps']);
  const voices = cols.flatMap((ids, i) => ids.map((id, r) => (sw.has(id)
    ? { id, kind: 'switch', style: 'slide', orient: 'h', x: 142 + i * 27, y: 50 + r * 35, w: 10, h: 5 }
    : { id, kind: 'knob', x: 142 + i * 27, y: 50 + r * 35, d: 12, label: id.toUpperCase() })));
  const steps = Array.from({ length: 16 }, (_, i) => ({ id: 'dr:step', kind: 'button', n: i + 1, x: 90 + i * 22, y: 275, w: 18, h: 14, led: 'above', color: ['#d8321e', '#f0862a', '#f2d22a', '#ece7db'][i >> 2] }));
  return {
    v: 1, id: 'tr808', hw: 'fixture', case: '#1d1c1b',
    scheme: { panel: '#2a2927', legend: '#ece7db', accent: '#f0862a' },
    areas: [{ id: 'main', src: [0, 0, 508, 305], at: [0, 0] }],
    sections: [
      { id: 'ctl', label: 'CONTROL', x: 0, y: 14, w: 130, h: 186, frame: 'none', title: 'none' },
      { id: 'voices', label: 'VOICES', x: 130, y: 14, w: 340, h: 186, frame: 'none', title: 'none' },
      { id: 'master', label: 'MASTER', x: 470, y: 14, w: 38, h: 186, frame: 'none', title: 'none' },
      { id: 'seq', label: 'SEQUENCER', x: 0, y: 200, w: 508, h: 105, frame: 'none', title: 'none' },
    ],
    controls: [
      { id: 'dr:mode', kind: 'rotary', x: 22, y: 45, d: 20, sweep: 240, legends: ['PATTERN CLEAR', '1st PART', '2nd PART', 'MANUAL PLAY', 'PLAY', 'COMPOSE'], label: 'MODE' },
      { id: 'dr:inst', kind: 'rotary', x: 65, y: 45, d: 22, sweep: 300, legends: ['AC', 'BD', 'SD', 'LT', 'MT', 'HT', 'RS', 'CP', 'CB', 'CY', 'OH', 'CH'], label: 'INSTRUMENT' },
      { id: 'dr:fill', kind: 'rotary', x: 108, y: 45, d: 20, sweep: 240, legends: ['MANUAL', '16', '12', '8', '4', '2'], label: 'AUTO FILL IN' },
      { id: 'dr:clear', kind: 'button', x: 22, y: 90, w: 14, h: 10, color: '#d8321e', label: 'CLEAR' },
      { id: 'dr:tempo', kind: 'knob', x: 60, y: 120, d: 30, sweep: 300, label: 'TEMPO' },
      { id: 'dr:fine', kind: 'knob', x: 105, y: 120, d: 12, label: 'FINE' },
      ...voices,
      { id: 'vol', kind: 'knob', x: 489, y: 60, d: 22, label: 'MASTER VOLUME' },
      { id: 'dr:varA', kind: 'led', x: 14, y: 212, d: 3 }, { id: 'dr:varB', kind: 'led', x: 26, y: 212, d: 3 },
      { id: 'dr:bvar', kind: 'switch', style: 'slide', orient: 'h', x: 20, y: 228, w: 14, h: 6, legends: ['A', 'AB', 'B'], label: 'BASIC VARIATION' },
      { id: 'dr:start', kind: 'button', x: 20, y: 270, w: 18, h: 14, label: 'START/STOP' },
      { id: 'dr:pre', kind: 'switch', style: 'slide', orient: 'h', x: 55, y: 228, w: 14, h: 6, positions: 4, legends: ['1', '2', '3', '4'], label: 'PRE-SCALE' },
      { id: 'dr:part1', kind: 'led', x: 50, y: 250, d: 3 }, { id: 'dr:part2', kind: 'led', x: 60, y: 250, d: 3 },
      ...steps,
      { id: 'dr:ifv', kind: 'switch', style: 'slide', orient: 'h', x: 452, y: 235, w: 12, h: 6, legends: ['A', 'B'], label: 'I/F VARIATION' },
      { id: 'dr:tap', kind: 'button', x: 485, y: 275, w: 18, h: 14, label: 'TAP' },
      ...OUTS.map((s, i) => ({ kind: 'jack', x: 150 + i * 25, y: 8, d: 6, inert: 'later', label: s + ' OUT', lab: 'none' })),
      { kind: 'switch', style: 'slide', orient: 'h', x: 480, y: 8, w: 10, h: 5, inert: true, label: 'POWER' },
    ],
    decor: [{ t: 'text', x: 300, y: 196, s: 'TR-808 · Rhythm Composer · Computer Controlled', size: 4, anchor: 'middle' }],
    extras: { ids: DR_EXTRAS.slice() },
  };
})();

/* ---------------------------------------------------------------- the tokens (IMPL-7a §7.2) */
test('7a tokens: TOKENS.tr808 lists the §7.2 face tokens (their kinds; PRE-SCALE a switch or a rotary) and the §3.6 extras; the step key repeats by n 1–16, all present; the detented positions; every one rendered; the fixture validates on the real tr808 model', () => {
  const T = P.TOKENS.tr808;
  assert.deepEqual(Object.keys(T.kind), DR_FACE);
  assert.deepEqual(T.extras, DR_EXTRAS);
  assert.deepEqual([T.kind['dr:mode'], T.kind['dr:inst'], T.kind['dr:fill'], T.kind['dr:tempo'], T.kind['dr:fine'], T.kind['dr:bvar'], T.kind['dr:ifv'], T.kind['dr:pre'].join('|'), T.kind['dr:start'], T.kind['dr:step'], T.kind['dr:varB']],
    ['rotary', 'rotary', 'rotary', 'knob', 'knob', 'switch', 'switch', 'switch|rotary', 'button', 'button', 'led']);
  assert.deepEqual([T.multi, T.idx['dr:step'], T.full], [['dr:step'], ['n', 1, 16], ['dr:step']]);
  assert.deepEqual(T.pos, { 'dr:mode': 6, 'dr:inst': 12, 'dr:fill': 6, 'dr:bvar': 3, 'dr:ifv': 2, 'dr:pre': 4 });
  for (const t of [...DR_FACE, ...DR_EXTRAS]) assert.ok(P.RENDERED_TOKENS.has(t), t + ' rendered');
  assert.deepEqual([P.tokPos(M808, 'dr:inst'), P.tokPos(M808, 'dr:step'), P.tokPos(MODELS.find(m => m.id === 'tb303'), 'dr:inst')], [12, 0, 0]);
  assert.equal(M808.family, 'drums');
  assert.deepEqual(P.validate(TR_FX, M808), []);
  // PRE-SCALE as a rotary (4 legends) validates too
  const R = clone(TR_FX);
  Object.assign(R.controls.find(c => c.id === 'dr:pre'), { kind: 'rotary', d: 12, sweep: 120, legends: ['1', '2', '3', '4'] });
  delete R.controls.find(c => c.id === 'dr:pre').positions;
  assert.deepEqual(P.validate(R, M808), []);
  // usable(): the layout once it validates (tests / sims: globalThis.__synthTest.panels)
  globalThis.__synthTest = { panels: { tr808: TR_FX } };
  try { assert.equal(P.usable('tr808', M808) === TR_FX, true); } finally { delete globalThis.__synthTest; }
});

test('7a validate: one mutation per rule, naming the field (§7.3, §12.7)', () => {
  const bad = (f, re, m) => {
    const L = clone(TR_FX);
    f(L, n => L.controls.find(c => c.id === 'dr:step' && c.n === n), id => L.controls.find(c => c.id === id));
    const p = P.validate(L, M808);
    assert.ok(p.some(x => re.test(x)), (m || re) + ' → ' + JSON.stringify(p));
  };
  // the step keys: n 1–16, each once, all 16
  bad((L, st) => { st(7).n = 5; }, /\(dr:step\): n 5 twice/, 'a step key twice with one n');
  bad((L, st) => { st(7).n = 5; }, /dr:step: n 7 missing \(all 16 are on the panel\)/, '… and so a missing one');
  bad(L => { L.controls = L.controls.filter(c => !(c.id === 'dr:step' && c.n === 16)); }, /dr:step: n 16 missing/, 'a missing n');
  bad((L, st) => { st(3).n = 17; }, /\(dr:step\): n 1–16/);
  bad((L, st) => { delete st(3).n; }, /\(dr:step\): n 1–16/, 'no n');
  bad((L, st) => { st(3).n = 2.5; }, /\(dr:step\): n 1–16/, 'n an integer');
  bad((L, st) => { st(9).led = 'none'; }, /\(dr:step\): a step key shows its LED/);
  bad((L, st) => { st(9).hit = [12, 14]; }, /\(dr:step\): hit box 12 × 14 mm < 14 mm/, 'the family exempts nothing');
  bad((L, st) => { st(9).x = st(8).x + 5; }, /hit boxes overlap/, 'disjoint');
  // a dr: token of the wrong kind
  bad((L, st, by) => { by('dr:mode').kind = 'knob'; }, /\(dr:mode\): dr:mode must be a rotary/);
  bad((L, st, by) => { Object.assign(by('dr:pre'), { kind: 'button' }); }, /\(dr:pre\): dr:pre must be a switch \| rotary/);
  bad((L, st, by) => { Object.assign(by('dr:start'), { kind: 'knob', d: 15 }); }, /\(dr:start\): dr:start must be a button/);
  bad((L, st, by) => { Object.assign(by('dr:part1'), { kind: 'button', w: 15, h: 15 }); }, /\(dr:part1\): dr:part1 must be a led/);
  bad((L, st, by) => { Object.assign(by('dr:tempo'), { kind: 'rotary', legends: ['1', '2'] }); }, /dr:tempo must be a knob/);
  bad((L, st) => { Object.assign(st(1), { kind: 'switch', style: 'slide' }); }, /\(dr:step\): dr:step must be a button/);
  // a detented token: its legends one per position (a rotary prints them), a switch's positions
  bad((L, st, by) => { by('dr:inst').legends.pop(); }, /\(dr:inst\): 11 legends for 12 positions/);
  bad((L, st, by) => { delete by('dr:fill').legends; }, /\(dr:fill\): no legends for 6 positions/, 'a rotary token prints its legends');
  bad((L, st, by) => { by('dr:bvar').positions = 2; }, /\(dr:bvar\): positions 2 ≠ 3/);
  bad((L, st, by) => { by('dr:ifv').legends = ['A', 'B', 'C']; }, /\(dr:ifv\): 3 legends for 2 positions/);
  bad((L, st, by) => { by('dr:pre').positions = 5; }, /\(dr:pre\): positions 2–4/);
  // at most once; extras tokens only in the extras, face tokens only on the face
  bad((L, st, by) => { L.controls.push(Object.assign(clone(by('dr:start')), { x: 485, y: 230 })); }, /dr:start: placed 2 times/);
  bad((L, st, by) => { L.controls.push(Object.assign(clone(by('dr:varA')), { x: 40, y: 212 })); }, /dr:varA: placed 2 times/, 'an LED token twice');
  bad(L => { L.extras.ids.push('dr:pads'); }, /dr:pads: placed 2 times/);
  bad(L => { L.controls.push({ id: 'dr:grid', kind: 'button', x: 485, y: 230, w: 15, h: 15 }); }, /\(dr:grid\): "dr:grid" is not a control of the model/, 'an extras token on the face');
  bad(L => { L.extras.ids.push('dr:tap'); }, /extras: "dr:tap" is not a control of the model/, 'a face token in the extras');
  bad(L => { L.controls.push({ id: 'dr:accent', kind: 'button', x: 485, y: 230, w: 15, h: 15 }); }, /"dr:accent" is not a control of the model/, 'a dr: token this build does not know');
  bad(L => { L.controls = L.controls.filter(c => c.id !== 'cbl'); }, /cbl: not placed/, 'every models.js id of the 808 once');
  // inert: true | 'later'; 'later' a labelled jack
  bad(L => { L.controls.push({ kind: 'knob', x: 400, y: 160, d: 10, inert: 'later', label: 'X' }); }, /inert 'later' is for a jack only/, "inert: 'later' on a knob");
  bad(L => { const j = L.controls.find(c => c.inert === 'later'); delete j.label; }, /inert 'later' needs its label/);
  bad(L => { L.controls.find(c => c.inert === 'later').inert = 'soon'; }, /inert true \| 'later'/);
  // original art: no maker word (the model name as plain type is fine)
  bad(L => { L.decor[0].s = 'Roland TR-808'; }, /decor\[0\]: a maker name/);
  bad((L, st, by) => { by('dr:tap').label = 'TAP (Roland)'; }, /a maker name/);
  // the dr: tokens are the 808's only
  const tb = MODELS.find(m => m.id === 'tb303');
  assert.ok(P.validate(Object.assign(clone(TR_FX), { id: 'tb303' }), tb).some(x => /"dr:start" is not a control of the model/.test(x)), 'dr: on another model');
});

/* ---------------------------------------------------------------- geometry (§7.1, §7.2, §7.5) */
test('7a geometry: 508 × 305 mm → 1024 px wide; the extras strip in two rows (the step grid 640 × 272 and the pads 232 × 232, then SYNC · SWING · → PIANO ROLL · REC · MAP… · SOUNDS… · DEMO at 64 px); 1024 × 1024 on the dots; the drum caption', () => {
  const g = P.geometry(TR_FX, M808), s = P.sizeOf(TR_FX, M808);
  assert.deepEqual([g.W, g.content.x, g.content.w, g.content.h], [1024, 4, 1016, 610]);
  assert.deepEqual([P.DR_GRID.w, P.DR_GRID.h, P.DR_PADS.w, P.DR_PADS.h], [640, 272, 232, 232]);
  const X = g.extras;
  assert.deepEqual(X.cells.map(c => [c.id, c.x, c.y, c.w, c.h]), [
    ['dr:grid', 8, 626, 640, 272], ['dr:pads', 648, 626, 232, 232],
    ['dr:sync', 8, 898, 96, 64], ['dr:swing', 104, 898, 104, 64], ['dr:toRoll', 208, 898, 128, 64], ['dr:rec', 336, 898, 72, 64],
    ['dr:map', 408, 898, 88, 64], ['dr:sounds', 496, 898, 104, 64], ['dr:demo', 600, 898, 72, 64]]);
  for (const c of X.cells) assert.ok(c.w >= 72 && c.w <= 640 && c.x + c.w <= X.x + X.w - P.XPAD, c.id);
  assert.deepEqual([X.x, X.y, X.w, X.h, X.over], [0, 610, 1024, 16 + 272 + 64 + 8, false], 'caption + the grid row + the controls row + padding (≈ 370, §7.1)');
  assert.deepEqual([s.w, s.h, s.w % DOT, s.h % DOT, s.h - BAR_H], [1024, 1024, 0, 0, g.body.h], 'TARGET.tr808 = 1024 × 1024 (§11)');
  assert.deepEqual([X.caption, X.note], [P.XCAPTION_DRUMS, true], 'the drum caption (D4) and "Dimmed controls are not emulated" for the power switch');
  assert.equal(P.XCAPTION_DRUMS, 'EXTRAS · not on the original · Sounds: our model of the circuits');
  // a caption of the layout's own wins; a non-drum model keeps the plain one
  const C = clone(TR_FX); C.extras.caption = 'EXTRAS · ours';
  assert.equal(P.geometry(C, M808).extras.caption, 'EXTRAS · ours');
  // only 'later' jacks inert: no dimmed note
  const LT = clone(TR_FX); LT.controls = LT.controls.filter(c => c.inert !== true);
  assert.deepEqual(P.validate(LT, M808), []);
  assert.equal(P.geometry(LT, M808).extras.note, false, "an 'later' jack is not dimmed");
  // the step keys: 16 live hit boxes, n in order left to right; every hit box ≥ 28 px, disjoint, in the body
  const hb = P.hitBoxes(TR_FX, M808), keys = hb.filter(h => h.id === 'dr:step');
  assert.equal(keys.length, 16);
  for (const h of hb) assert.ok(h.w >= 28 && h.h >= 28 && h.x >= 0 && h.y >= 0 && h.x + h.w <= g.body.w && h.y + h.h <= g.body.h, h.id);
  const order = g.order.map(i => TR_FX.controls[i]).filter(c => c.id === 'dr:step').map(c => c.n);
  assert.deepEqual(order, Array.from({ length: 16 }, (_, i) => i + 1), 'Tab order: step 1 … 16');
  // the 'later' jacks and the power switch: not live, no hit box
  assert.equal(g.controls.filter(o => o.inert).length, 12);
  assert.equal(hb.some(h => h.id == null), false);
});

test('7a geometry: the TB-303\'s extras cells are unchanged by the token cell table (sync / toRoll 128, random 104, the grid 576 × 192)', () => {
  const tb = MODELS.find(m => m.id === 'tb303'), L = P.layoutOf('tb303');
  if (!L) return;
  const X = P.geometry(L, tb).extras, w = id => X.cells.find(c => c.id === id);
  assert.deepEqual([w('seq:sync').w, w('seq:toRoll').w, w('seq:random').w, w('seq:grid').w, w('seq:grid').h, w('al').w], [128, 128, 104, 576, 192, 72]);
  assert.deepEqual([P.sizeOf(L, tb).w, P.sizeOf(L, tb).h], [608, 608]);
});

/* ---------------------------------------------------------------- the face art (§7.1, §7.3) */
test("7a art: an inert 'later' jack at full contrast titled \"BD OUT — cable-able with full patching (stage 4)\"; the dimmed power switch \"— not emulated\"; no maker word; the model name only as plain text; self-contained", () => {
  const svg = P.decorSvg(TR_FX, M808);
  const groups = [...svg.matchAll(/<g class="(hw-inert[^"]*)"( opacity="[^"]*")? data-tip="([^"]*)"><title>([^<]*)<\/title>/g)].map(m => [m[1], !!m[2], m[3], m[4]]);
  assert.deepEqual(groups.filter(x => x[0] === 'hw-inert hw-later').map(x => x[3]), OUTS.map(s => s + ' OUT — cable-able with full patching (stage 4)'));
  assert.deepEqual([...new Set(groups.filter(x => x[0] === 'hw-inert hw-later').map(x => x[1]))], [false], 'not dimmed');
  assert.deepEqual(groups.filter(x => x[0] === 'hw-inert').map(x => [x[1], x[3]]), [[true, 'POWER — not emulated']]);
  assert.equal(groups.every(x => x[2] === x[3]), true, 'the tap tip = the title');
  assert.deepEqual([P.INERT_TIP, P.LATER_TIP], [' — not emulated', ' — cable-able with full patching (stage 4)']);
  const texts = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1].replace(/<[^>]+>/g, ' '));
  for (const t of texts) assert.doesNotMatch(t, new RegExp('\\b(' + P.MAKERS.join('|') + ')\\b'), t);
  assert.ok(texts.includes('TR-808 · Rhythm Composer · Computer Controlled'));
  assert.doesNotMatch(svg.replace(/<text[\s\S]*?<\/text>/g, '').replace(/<title>[\s\S]*?<\/title>/g, '').replace(/data-tip="[^"]*"/g, ''), /\bTR-808\b/);
  assert.ok(!/currentColor|var\(--|<style|<image|<foreignObject|href/.test(svg), 'self-contained');
});

/* ================================================================ 7b: the TR-606's tokens, validator and geometry (IMPL-7b §7.1–§7.3, §12.7) */
const M606 = MODELS.find(m => m.id === 'tr606');
const DR6_FACE = ['dr:mode', 'dr:inst', 'dr:tempo', 'dr:sc', 'dr:start', 'dr:runLed', 'dr:clear', 'dr:fn', 'dr:grp', 'dr:grpI', 'dr:grpII', 'dr:tap', 'dr:step'];
const DR6_EXTRAS = ['dr:grid', 'dr:pads', 'dr:sync', 'dr:swing', 'dr:toRoll', 'dr:rec', 'dr:map', 'dr:sounds', 'dr:demo', 'dr:link'];
const X6 = ['bdu', 'bdd', 'sdu', 'sdd', 'ltu', 'ltd', 'htu', 'htd', 'cyd', 'ohd', 'chd'];
// a fixture TR-606 face (300 × 146 mm, R6 §13's positions; the step keys at a 14 mm pitch round the row's centre — the
// hardware's 13.55 is under the 14 mm hit rule — and FUNCTION 2.8 mm left so its hit box clears the first key's): band A's
// six knobs, band B's TEMPO · TRACK / INSTRUMENT · MODE (its detents at +37° … +127°: rot 82, sweep 90; the bracketed
// legends are print, so its own legends are empty) · VOLUME, band C's CLEAR/RESET, RUN LED + RUN/STOP, SCALE (vertical, 4
// at the top), FUNCTION, 16 step keys, the group LEDs + PATTERN GROUP, TAP; the extras in §7.5's order
const TR6_FX = (() => {
  const knobs = [['ac', 88.6, 'ACCENT'], ['bdl', 111.4, 'BASS DRUM'], ['sdl', 134.1, 'SNARE DRUM'], ['tml', 157.0, 'L.H.TOM'], ['cyl', 179.9, 'CYMBAL'], ['hhl', 202.4, 'O.C.HIHAT']];
  const steps = Array.from({ length: 16 }, (_, i) => ({ id: 'dr:step', kind: 'button', n: i + 1, x: 53.25 + 14 * i, y: 113.8, w: 5.4, h: 12.2, led: 'above', hit: [14, 15], color: '#c9cac6' }));
  return {
    v: 1, id: 'tr606', hw: 'fixture', case: '#1b1c1c',
    scheme: { panel: '#c6c8c7', legend: '#151515', accent: '#e0461f', font: 'rounded' },
    areas: [{ id: 'main', src: [0, 0, 300, 146], at: [0, 0], r: 2 }],
    sections: [
      { id: 'top', label: 'LEVELS', x: 0, y: 0, w: 300, h: 27.6, frame: 'none', title: 'none' },
      { id: 'mid', label: 'TEMPO · TRACK / INSTRUMENT · MODE · VOLUME', x: 0, y: 27.6, w: 300, h: 44.2, frame: 'none', title: 'none' },
      { id: 'seq', label: 'SEQUENCER', x: 0, y: 71.8, w: 300, h: 74.2, frame: 'none', title: 'none', fill: '#141414' },
    ],
    controls: [
      ...knobs.map(([id, x, label]) => ({ id, kind: 'knob', x, y: 14.9, d: 17, sweep: 270, label, lab: 'none' })),
      { id: 'dr:tempo', kind: 'knob', x: 43.2, y: 52, d: 24, sweep: 300, label: 'TEMPO', lab: 'none' },
      { id: 'dr:inst', kind: 'rotary', x: 88.6, y: 52.3, d: 23, sweep: 210, legends: ['AC', 'BD', 'SD', 'LT', 'HT', 'CY', 'OH', 'CH'], label: 'TRACK / INSTRUMENT', lab: 'none' },
      { id: 'dr:mode', kind: 'rotary', x: 134, y: 52.1, d: 23, sweep: 90, rot: 82, legends: ['', '', '', ''], label: 'MODE', lab: 'none' },
      { id: 'vol', kind: 'knob', x: 263.8, y: 52.6, d: 23, sweep: 270, label: 'VOLUME', lab: 'none' },
      { id: 'dr:clear', kind: 'button', x: 19.7, y: 93, w: 13, h: 5, label: 'CLEAR/RESET', lab: 'none' },
      { id: 'dr:runLed', kind: 'led', x: 19.5, y: 103.5, d: 3, color: '#ff2b16' },
      { id: 'dr:start', kind: 'button', x: 19.2, y: 113.8, w: 17, h: 12, label: 'RUN/STOP', lab: 'none' },
      { id: 'dr:sc', kind: 'switch', style: 'slide', orient: 'v', x: 42.5, y: 88.5, w: 5, h: 16, hit: [14, 16], legends: ['4', '3', '2', '1'], label: 'SCALE', lab: 'none' },
      { id: 'dr:fn', kind: 'button', x: 39.2, y: 113.8, w: 5, h: 12, hit: [14, 15], label: 'FUNCTION', lab: 'none' },
      ...steps,
      { id: 'dr:grpI', kind: 'led', x: 275.6, y: 84.5, d: 3, color: '#ff2b16' }, { id: 'dr:grpII', kind: 'led', x: 285.8, y: 84.5, d: 3, color: '#ff2b16' },
      { id: 'dr:grp', kind: 'button', x: 281.7, y: 92.6, w: 11, h: 5, label: 'PATTERN GROUP', lab: 'none' },
      { id: 'dr:tap', kind: 'button', x: 281.3, y: 113.8, w: 17.6, h: 12.2, label: 'TAP', lab: 'none' },
    ],
    decor: [{ t: 'text', x: 211, y: 52, s: 'TR-606', size: 6, anchor: 'middle' }, { t: 'text', x: 211, y: 59, s: 'Computer Controlled', size: 4, anchor: 'middle' }],
    extras: { ids: ['dr:grid', 'dr:pads', 'dr:sync', 'dr:swing', ...X6, 'dr:toRoll', 'dr:rec', 'dr:map', 'dr:sounds', 'dr:demo', 'dr:link'] },
  };
})();

test('7b tokens: TOKENS.tr606 lists the §7.2 face tokens (their kinds) and the §3.7 extras with SYNC 303s; the step key repeats by n 1–16, all present; MODE 4, TRACK / INSTRUMENT 8, SCALE 4 (vertical); every one rendered; the fixture validates on the real tr606 model and is usable()', () => {
  const T = P.TOKENS.tr606;
  assert.deepEqual(Object.keys(T.kind), DR6_FACE);
  assert.deepEqual(T.extras, DR6_EXTRAS);
  assert.deepEqual(DR6_FACE.map(t => T.kind[t]), ['rotary', 'rotary', 'knob', 'switch', 'button', 'led', 'button', 'button', 'button', 'led', 'led', 'button', 'button']);
  assert.deepEqual([T.multi, T.idx['dr:step'], T.full, T.pos, T.orient], [['dr:step'], ['n', 1, 16], ['dr:step'], { 'dr:mode': 4, 'dr:inst': 8, 'dr:sc': 4 }, { 'dr:sc': 'v' }]);
  for (const t of [...DR6_FACE, ...DR6_EXTRAS]) assert.ok(P.RENDERED_TOKENS.has(t), t + ' rendered');
  assert.deepEqual([P.tokPos(M606, 'dr:inst'), P.tokPos(M606, 'dr:sc'), P.tokPos(M606, 'dr:fill'), P.tokPos(M808, 'dr:inst')], [8, 4, 0, 12]);
  assert.deepEqual([M606.family, M606.controls.map(c => c.id).filter(id => !X6.includes(id))], ['drums', ['ac', 'bdl', 'sdl', 'tml', 'cyl', 'hhl', 'vol']], 'the face\'s seven knobs (E6a)');
  assert.deepEqual(P.validate(TR6_FX, M606), []);
  globalThis.__synthTest = { panels: { tr606: TR6_FX } };
  try { assert.equal(P.usable('tr606', M606) === TR6_FX, true); } finally { delete globalThis.__synthTest; }
  // SCALE without orient is vertical when taller than wide
  const V = clone(TR6_FX); delete V.controls.find(c => c.id === 'dr:sc').orient;
  assert.deepEqual(P.validate(V, M606), []);
});

test('7b validate: one mutation per rule, naming the field (§7.2, §7.3, §12.7)', () => {
  const bad = (f, re, m) => {
    const L = clone(TR6_FX);
    f(L, n => L.controls.find(c => c.id === 'dr:step' && c.n === n), id => L.controls.find(c => c.id === id));
    const p = P.validate(L, M606);
    assert.ok(p.some(x => re.test(x)), (m || re) + ' → ' + JSON.stringify(p));
  };
  // the step keys: n 1–16, each once, all 16, each with its LED; 14 mm hit boxes, disjoint (the hardware's 13.55 mm pitch fails)
  bad((L, st) => { st(7).n = 5; }, /\(dr:step\): n 5 twice/);
  bad(L => { L.controls = L.controls.filter(c => !(c.id === 'dr:step' && c.n === 16)); }, /dr:step: n 16 missing \(all 16 are on the panel\)/);
  bad((L, st) => { st(3).n = 0; }, /\(dr:step\): n 1–16/);
  bad((L, st) => { st(9).led = 'none'; }, /\(dr:step\): a step key shows its LED/);
  bad((L, st) => { for (let n = 1; n <= 16; n++) st(n).x = 56.6 + 13.55 * (n - 1); }, /\(dr:step\) and controls\[\d+\] \(dr:step\): hit boxes overlap/, 'the 13.55 mm pitch');
  bad((L, st) => { st(4).hit = [13.5, 15]; }, /\(dr:step\): hit box 13.5 × 15 mm < 14 mm/);
  // SCALE: a vertical switch of 4 positions (a rotary or a horizontal switch refused)
  bad((L, st, by) => { by('dr:sc').orient = 'h'; }, /\(dr:sc\): dr:sc is a vertical switch \(orient v\)/);
  bad((L, st, by) => { const c = by('dr:sc'); delete c.orient; Object.assign(c, { w: 16, h: 5, hit: [16, 14] }); }, /dr:sc is a vertical switch/, 'wider than tall');
  bad((L, st, by) => { Object.assign(by('dr:sc'), { kind: 'rotary', d: 12 }); }, /\(dr:sc\): dr:sc must be a switch/);
  bad((L, st, by) => { by('dr:sc').positions = 3; }, /\(dr:sc\): positions 3 ≠ 4/);
  bad((L, st, by) => { by('dr:sc').legends.pop(); }, /\(dr:sc\): 3 legends for 4 positions/);
  // the rotaries: legends one per position (empty strings: ticks only, the print in decor); rot on a rotary only
  bad((L, st, by) => { by('dr:mode').legends.push(''); }, /\(dr:mode\): 5 legends for 4 positions/);
  bad((L, st, by) => { by('dr:inst').legends = ['AC', 'BD', 'SD', 'LT', 'MT', 'HT', 'RS', 'CP', 'CB', 'CY', 'OH', 'CH']; }, /\(dr:inst\): 12 legends for 8 positions/, 'the 808\'s twelve');
  bad((L, st, by) => { delete by('dr:inst').legends; }, /\(dr:inst\): no legends for 8 positions/);
  bad((L, st, by) => { by('dr:mode').rot = 200; }, /\(dr:mode\): rot/);
  bad((L, st, by) => { by('dr:tempo').rot = 10; }, /\(dr:tempo\): rot/, 'rot on a knob');
  // kinds
  bad((L, st, by) => { by('dr:tempo').kind = 'rotary'; by('dr:tempo').legends = ['1', '2']; }, /dr:tempo must be a knob/);
  bad((L, st, by) => { Object.assign(by('dr:fn'), { kind: 'switch', style: 'slide' }); }, /\(dr:fn\): dr:fn must be a button/);
  bad((L, st, by) => { Object.assign(by('dr:runLed'), { kind: 'button', w: 15, h: 15 }); }, /\(dr:runLed\): dr:runLed must be a led/);
  bad((L, st, by) => { Object.assign(by('dr:grpII'), { kind: 'lamp' }); }, /\(dr:grpII\): dr:grpII must be a led/);
  bad((L, st, by) => { Object.assign(by('dr:clear'), { kind: 'knob', d: 15 }); }, /\(dr:clear\): dr:clear must be a button/);
  // at most once; extras tokens only in the extras, face tokens only on the face
  bad((L, st, by) => { L.controls.push(Object.assign(clone(by('dr:fn')), { x: 150, y: 90 })); }, /dr:fn: placed 2 times/);
  bad((L, st, by) => { L.controls.push(Object.assign(clone(by('dr:grpI')), { x: 150, y: 80 })); }, /dr:grpI: placed 2 times/, 'an LED token twice');
  bad(L => { L.extras.ids.push('dr:link'); }, /dr:link: placed 2 times/);
  bad(L => { L.controls.push({ id: 'dr:link', kind: 'button', x: 150, y: 90, w: 15, h: 15 }); }, /\(dr:link\): "dr:link" is not a control of the model/, 'an extras token on the face');
  bad(L => { L.extras.ids.push('dr:grp'); }, /extras: "dr:grp" is not a control of the model/, 'a face token in the extras');
  // the 808's tokens are not the 606's (and the 606's not the 808's)
  for (const t of ['dr:fill', 'dr:fine', 'dr:pre', 'dr:bvar']) bad(L => { L.controls.push({ id: t, kind: t === 'dr:fill' ? 'rotary' : t === 'dr:fine' ? 'knob' : 'switch', x: 150, y: 90, d: 12, w: 15, h: 15, legends: ['1', '2', '3'] }); }, new RegExp(`"${t}" is not a control of the model`), t + ' on a 606');
  bad(L => { L.controls.push({ id: 'dr:part1', kind: 'led', x: 150, y: 90, d: 3 }); }, /\(dr:part1\): a display carries no id/, 'the 808\'s PART LED');
  for (const t of ['dr:fn', 'dr:sc', 'dr:grpI']) assert.ok(P.validate(Object.assign(clone(TR_FX), { controls: [...TR_FX.controls, { id: t, kind: t === 'dr:sc' ? 'switch' : t === 'dr:grpI' ? 'led' : 'button', x: 400, y: 160, w: 15, h: 15, d: 3, legends: ['1', '2', '3', '4'] }] }), M808)
    .some(x => new RegExp(`${t}`).test(x)), t + ' on an 808');
  assert.ok(P.validate(Object.assign(clone(TR_FX), { extras: { ids: [...DR_EXTRAS, 'dr:link'] } }), M808).some(x => /extras: "dr:link" is not a control of the model/.test(x)), 'SYNC 303s is the 606\'s');
  // every models.js id once: the face's knobs and the eleven extras
  bad(L => { L.extras.ids = L.extras.ids.filter(id => id !== 'chd'); }, /chd: not placed/);
  bad(L => { L.controls = L.controls.filter(c => c.id !== 'tml'); }, /tml: not placed/);
  // original art: no maker word
  bad(L => { L.decor[0].s = 'Roland TR-606'; }, /decor\[0\]: a maker name/);
  bad((L, st, by) => { by('dr:tap').label = 'TAP Roland'; }, /a maker name/);
});

test('7b geometry: 300 × 146 mm → a 608 px module (592 inside the strip); the extras rows (§7.5) — the grid 592 × 192 · the 2 × 4 pads 232 × 116, SYNC, SWING · TUNE / DECAY 8 + 3 · → PIANO ROLL … SYNC 303s; 608 × 864 on the dots; the drum caption; the 808\'s and the TB-303\'s cells unchanged', () => {
  const g = P.geometry(TR6_FX, M606), s = P.sizeOf(TR6_FX, M606), X = g.extras;
  assert.deepEqual([g.W, g.content.x, g.content.w, g.content.h], [608, 4, 600, 292]);
  assert.deepEqual([P.DR6_GRID.w, P.DR6_GRID.h, P.DR6_PADS.w, P.DR6_PADS.h, P.tokCell(M606, 'dr:grid'), P.tokCell(M606, 'dr:pads'), P.tokCell(M606, 'dr:link'), P.tokCell(M606, 'bdu')],
    [592, 192, 232, 116, [592, 192], [232, 116], [128, 64], null]);
  assert.deepEqual([P.tokCell(M808, 'dr:grid'), P.tokCell(M808, 'dr:pads'), P.xbreakOf(M808), P.xbreakOf(MODELS.find(m => m.id === 'tb303'))], [[640, 272], [232, 232], P.XBREAK, P.XBREAK]);
  assert.deepEqual(P.xbreakOf(M606), ['dr:grid', 'dr:swing', 'htd', 'chd']);
  const row = (y, ...cells) => { let x = 8; return cells.map(([id, w, h]) => { const c = [id, x, y, w, h || 64]; x += w; return c; }); };
  assert.deepEqual(X.cells.map(c => [c.id, c.x, c.y, c.w, c.h]), [
    ...row(308, ['dr:grid', 592, 192]),
    ...row(500, ['dr:pads', 232, 116], ['dr:sync', 96], ['dr:swing', 104]),
    ...row(616, ...X6.slice(0, 8).map(id => [id, 72])),
    ...row(680, ...X6.slice(8).map(id => [id, 72])),
    ...row(744, ['dr:toRoll', 128], ['dr:rec', 72], ['dr:map', 88], ['dr:sounds', 104], ['dr:demo', 72], ['dr:link', 128])]);
  for (const c of X.cells) assert.ok(c.x >= P.XPAD && c.x + c.w <= X.w - P.XPAD, c.id + ' inside the 592 px');
  assert.deepEqual([X.x, X.y, X.w, X.h, X.over], [0, 292, 608, 16 + 192 + 116 + 3 * 64 + 8, false]);
  assert.deepEqual([s.w, s.h, s.w % DOT, s.h % DOT, s.h - BAR_H], [608, 864, 0, 0, g.body.h], 'TARGET.tr606 = 608 × 864 (§7.1: ≈ 608 × 864)');
  const crop = clone(TR6_FX); crop.areas[0].src[3] = 143; crop.sections[2].h = 71.2; // (the TB-303's crop: the same module)
  assert.deepEqual(P.validate(crop, M606), []);
  assert.deepEqual([P.sizeOf(crop, M606).w, P.sizeOf(crop, M606).h], [608, 864]);
  assert.deepEqual([X.caption, X.note], [P.XCAPTION_DRUMS, false], 'the drum caption; nothing dimmed');
  // every live hit box ≥ 28 px, disjoint, in the body; the step keys in Tab order 1 … 16; the LEDs are no hit boxes
  const hb = P.hitBoxes(TR6_FX, M606);
  for (const h of hb) assert.ok(h.w >= 28 && h.h >= 28 && h.x >= 0 && h.y >= 0 && h.x + h.w <= g.body.w && h.y + h.h <= g.body.h, h.id);
  for (let i = 0; i < hb.length; i++) for (let j = i + 1; j < hb.length; j++) { const a = hb[i], b = hb[j]; assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), a.id + ' × ' + b.id); }
  assert.deepEqual([hb.filter(h => h.id === 'dr:step').length, hb.some(h => /^dr:(runLed|grpI|grpII)$/.test(h.id))], [16, false]);
  assert.deepEqual(g.order.map(i => TR6_FX.controls[i]).filter(c => c.id === 'dr:step').map(c => c.n), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.deepEqual(g.controls.filter(o => o.show).map(o => o.id), ['dr:runLed', 'dr:grpI', 'dr:grpII']);
});

test('7b art: MODE\'s detents at +37° … +127° (rot 82, sweep 90), TRACK / INSTRUMENT\'s at −105° … +105°; no maker word; the model name only as plain text; self-contained', () => {
  const svg = P.decorSvg(TR6_FX, M606), n3 = v => String(Math.round(v * 1000) / 1000);
  const tick = (x, y, d, a) => { const p = r => [x + Math.sin(a * Math.PI / 180) * r, y - Math.cos(a * Math.PI / 180) * r], [ax, ay] = p(d / 2 + 0.6), [bx, by] = p(d / 2 + 0.6 + 1.4 * 0.8); return `M${n3(ax)} ${n3(ay)}L${n3(bx)} ${n3(by)}`; };
  for (const a of [37, 67, 97, 127]) assert.ok(svg.includes(tick(134, 52.1, 23, a)), 'MODE at ' + a + '°');
  for (const a of [-105, -75, -45, -15, 15, 45, 75, 105]) assert.ok(svg.includes(tick(88.6, 52.3, 23, a)), 'TRACK / INSTRUMENT at ' + a + '°');
  const texts = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1].replace(/<[^>]+>/g, ' '));
  for (const t of texts) assert.doesNotMatch(t, new RegExp('\\b(' + P.MAKERS.join('|') + ')\\b'), t);
  assert.ok(texts.includes('TR-606') && texts.includes('AC') && texts.includes('CH') && !texts.includes(''), 'the model in plain type; INSTRUMENT\'s legends; MODE\'s empty ones print nothing');
  assert.doesNotMatch(svg.replace(/<text[\s\S]*?<\/text>/g, ''), /\bTR-606\b/);
  assert.ok(!/currentColor|var\(--|<style|<image|<foreignObject|href/.test(svg), 'self-contained');
});

/* ================================================================ 7c: the TR-909's tokens, validator and geometry (IMPL-7c §7.1–§7.3, §12.8) */
const M909 = MODELS.find(m => m.id === 'tr909');
const DR9_FACE = ['dr:start', 'dr:stop', 'dr:disp', 'dr:tempo', 'dr:trk', 'dr:pat', 'dr:tkey', 'dr:back', 'dr:fwd', 'dr:avail', 'dr:cyc', 'dr:enter',
  'dr:last', 'dr:scale', 'dr:shuf', 'dr:clear', 'dr:isel', 'dr:shift', 'dr:step', 'dr:scl'];
const DR9_EXTRAS = ['dr:grid', 'dr:pads', 'dr:sync', 'dr:toRoll', 'dr:rec', 'dr:map', 'dr:sounds', 'dr:demo'];
const OUTS9 = ['BD', 'SD', 'LT', 'MT', 'HT', 'RS', 'HC', 'HH', 'CRASH', 'RIDE'];
const SMALL9 = [192.8, 204.7, 216.6, 228.3, 247.0, 258.9, 270.9, 281.9, 299.8, 312.6, 324.7, 336.4, 350.4, 362.6]; // (R9 §13: the hardware's x)
// a fixture TR-909 face (486 × 300 mm, R9 §13's positions): the knob band's nine blocks (rows at y 113.4 / 133.0), the middle
// band (START, STOP/CONT, the display, TEMPO, the fourteen small keys — R9 §13's ≈ 11.9 mm inside a group is under the 14 mm
// hit rule: here on a 14 mm pitch from x 186.6, none more than 6.2 mm from the hardware's (§7.1), hit [14, 15] —, ENTER,
// VOLUME), the bottom band (the left cluster at its 14.9 × 17.7 mm pitch, hit boxes 14 wide; the four scale rows' LEDs; the
// 16 step keys at a 23 mm pitch, an LED in each cap); EXT INST and TAPE SYNC dimmed, the ten MULTI OUT jacks inert 'later',
// the cartridge slot print; the extras in §7.5's order, no caption of its own (the geometry supplies the 909's)
const TR9_FX = (() => {
  const knobs = [['bdu', 83.0, 0], ['bdl', 103.8, 0], ['bda', 83.0, 1], ['bdd', 103.8, 1], ['sdu', 129.1, 0], ['sdl', 150.0, 0], ['sdt', 129.1, 1], ['sds', 150.0, 1],
    ['ltu', 175.1, 0], ['ltl', 196.2, 0], ['ltd', 175.1, 1], ['mtu', 221.3, 0], ['mtl', 242.3, 0], ['mtd', 221.3, 1], ['htu', 267.2, 0], ['htl', 288.3, 0], ['htd', 267.2, 1],
    ['rsl', 313.2, 0], ['cpl', 334.5, 0], ['hhl', 380.6, 0], ['chd', 359.8, 1], ['ohd', 380.6, 1], ['crl', 406.0, 0], ['rdl', 426.8, 0], ['cru', 406.0, 1], ['rdu', 426.8, 1],
    ['ac', 53.0, 1]].map(([id, x, r]) => ({ id, kind: 'knob', x, y: r ? 133.0 : 113.4, d: 12.3, sweep: 300, label: id.toUpperCase(), lab: 'none' }));
  const small = [['dr:trk', 'TRACK 1', 1], ['dr:trk', 'TRACK 2', 2], ['dr:trk', 'TRACK 3', 3], ['dr:trk', 'TRACK 4', 4], ['dr:pat', 'PATTERN 1', 1], ['dr:pat', 'PATTERN 2', 2],
    ['dr:pat', 'PATTERN 3', 3], [null, 'EXT INST'], ['dr:tkey', 'TEMPO'], ['dr:back', 'BACK'], ['dr:fwd', 'FWD'], ['dr:avail', 'AVAILABLE MEAS'], ['dr:cyc', 'CYCLE/GUIDE'], [null, 'TAPE SYNC']]
    .map(([id, label, n], i) => Object.assign(id ? { id, hit: [14, 15] } : { inert: true }, { kind: 'button', x: 186.6 + 14 * i, y: 169, w: 7, h: 7, led: 'cap', color: '#d0c8b0', label, lab: 'none' }, n ? { n } : {}));
  const cluster = [['dr:last', 44.5, 201.9, 'LAST STEP'], ['dr:scale', 59.4, 201.9, 'SCALE'], ['dr:shuf', 44.5, 219.6, 'SHUFFLE/FLAM'], ['dr:clear', 59.4, 219.6, 'CLEAR'],
    ['dr:isel', 44.5, 237.2, 'INSTRUMENT SELECT'], ['dr:shift', 59.4, 237.2, 'SHIFT']].map(([id, x, y, label]) => ({ id, kind: 'button', x, y, w: 8, h: 8, hit: [14, 15], color: '#d0c8b0', label, lab: 'none' }));
  const steps = Array.from({ length: 16 }, (_, i) => ({ id: 'dr:step', kind: 'button', n: i + 1, x: 81.7 + 23 * i, y: 236.4, w: 17, h: 19.5, led: 'cap', color: '#d0c8b0' }));
  const scl = [194.0, 201.2, 208.4, 215.6].map((y, i) => ({ id: 'dr:scl', kind: 'led', n: i + 1, x: 71, y, d: 2.4 }));
  return {
    v: 1, id: 'tr909', hw: 'fixture', case: '#e8e8e2',
    scheme: { panel: '#e8e8e2', legend: '#2c3550', accent: '#f28c28', knob: { skirt: '#2c3550', cap: '#2c3550', ptr: '#f28c28' } },
    areas: [{ id: 'main', src: [0, 0, 486, 300], at: [0, 0] }],
    sections: [
      { id: 'knobs', label: 'VOICES', x: 30, y: 92, w: 420, h: 52, frame: 'none', title: 'none' },
      { id: 'mid', label: 'TRANSPORT · TEMPO · KEYS', x: 30, y: 150, w: 420, h: 38, frame: 'none', title: 'none' },
      { id: 'seq', label: 'SEQUENCER', x: 30, y: 188, w: 420, h: 80, frame: 'none', title: 'none' },
    ],
    controls: [
      ...knobs,
      { id: 'dr:start', kind: 'button', x: 49.4, y: 173.8, w: 19, h: 18, color: '#fffddc', label: 'START', lab: 'none' },
      { id: 'dr:stop', kind: 'button', x: 74.0, y: 173.8, w: 19, h: 18, color: '#fffddc', label: 'STOP/CONT', lab: 'none' },
      { id: 'dr:disp', kind: 'display', x: 113.85, y: 173.95, w: 39.1, h: 18.9, color: '#ff3b2a' },
      { id: 'dr:tempo', kind: 'knob', x: 160.0, y: 171.1, d: 22, sweep: 300, label: 'TEMPO', lab: 'none' },
      ...small,
      { id: 'dr:enter', kind: 'button', x: 385.7, y: 173.8, w: 19, h: 18, led: 'cap', color: '#fffddc', label: 'ENTER', lab: 'none' },
      { id: 'vol', kind: 'knob', x: 426.6, y: 171.5, d: 23, sweep: 300, label: 'VOLUME', lab: 'none' },
      ...cluster, ...scl, ...steps,
      ...OUTS9.map((s, i) => ({ kind: 'jack', x: 150 + 24 * i, y: 40, d: 6, inert: 'later', label: s + ' OUT', lab: 'none' })),
      { kind: 'slot', x: 420, y: 40, w: 50, h: 6, inert: true, label: 'CARTRIDGE' },
    ],
    decor: [{ t: 'text', x: 88, y: 80, s: 'TR-909 · Rhythm Composer', size: 5, anchor: 'middle' }],
    extras: { ids: DR9_EXTRAS.slice() },
  };
})();

test('7c tokens: TOKENS.tr909 lists the §7.2 face tokens (their kinds: the display, the LED keys, the scale rows\' LEDs) and the §3.7 extras (no SWING, no knobs); TRACK n 1–4, PATTERN n 1–3, the step keys n 1–16, the scale LEDs n 1–4 — each repeats, all present; the LED keys; the display\'s 3 characters; the pads 232 × 184; the caption; every one rendered; the fixture validates on the real tr909 model and is usable()', () => {
  const T = P.TOKENS.tr909;
  assert.deepEqual(Object.keys(T.kind), DR9_FACE);
  assert.deepEqual(T.extras, DR9_EXTRAS);
  assert.deepEqual(DR9_FACE.map(t => T.kind[t]), ['button', 'button', 'display', 'knob', ...Array(14).fill('button'), 'button', 'led']);
  assert.deepEqual([T.multi, T.idx, T.full], [['dr:step', 'dr:trk', 'dr:pat', 'dr:scl'], { 'dr:step': ['n', 1, 16], 'dr:trk': ['n', 1, 4], 'dr:pat': ['n', 1, 3], 'dr:scl': ['n', 1, 4] }, ['dr:step', 'dr:trk', 'dr:pat', 'dr:scl']]);
  assert.deepEqual([T.led, T.digits, T.cells, T.xbreak, T.pos, T.orient], [['dr:trk', 'dr:pat', 'dr:tkey', 'dr:back', 'dr:fwd', 'dr:avail', 'dr:cyc', 'dr:enter'], { 'dr:disp': 3 }, { 'dr:pads': [232, 184] }, ['dr:pads'], undefined, undefined]);
  assert.equal(T.caption, P.XCAPTION_DRUMS + ' · Hi-hats and cymbals: our own sounds through the 909’s chip circuit', 'D4: our cymbal sounds named');
  for (const t of [...DR9_FACE, ...DR9_EXTRAS]) assert.ok(P.RENDERED_TOKENS.has(t), t + ' rendered');
  assert.deepEqual([P.tokPos(M909, 'dr:step'), P.tokPos(M909, 'dr:inst'), P.dspMin(3), P.DSP_FONT], [0, 0, [20.6, 12], { px: 20, em: 0.62, pad: 2 }]);
  assert.deepEqual([M909.family, M909.controls.length, M909.controls.every(c => c.t === 'k')], ['drums', 28, true], 'the 28 knobs of E9a, no switch');
  assert.deepEqual(P.validate(TR9_FX, M909), []);
  globalThis.__synthTest = { panels: { tr909: TR9_FX } };
  try { assert.equal(P.usable('tr909', M909) === TR9_FX, true); } finally { delete globalThis.__synthTest; }
  // the layout's own caption: exactly the model's
  assert.deepEqual(P.validate(Object.assign(clone(TR9_FX), { extras: { ids: DR9_EXTRAS.slice(), caption: T.caption } }), M909), []);
});

test('7c validate: one mutation per rule, naming the field (§7.2, §7.3, §12.8)', () => {
  const bad = (f, re, m) => {
    const L = clone(TR9_FX);
    f(L, (id, n) => L.controls.find(c => c.id === id && (n == null || c.n === n)));
    const p = P.validate(L, M909);
    assert.ok(p.some(x => re.test(x)), (m || re) + ' → ' + JSON.stringify(p));
  };
  // the step keys: n 1–16, each once, all 16, each with its LED; the TRACK / PATTERN keys and the scale LEDs the same way
  bad((L, by) => { by('dr:step', 7).n = 5; }, /\(dr:step\): n 5 twice/);
  bad(L => { L.controls = L.controls.filter(c => !(c.id === 'dr:step' && c.n === 16)); }, /dr:step: n 16 missing \(all 16 are on the panel\)/);
  bad((L, by) => { by('dr:step', 9).led = 'none'; }, /\(dr:step\): a step key shows its LED/);
  bad((L, by) => { by('dr:trk', 2).n = 5; }, /\(dr:trk\): n 1–4/);
  bad((L, by) => { by('dr:trk', 2).n = 1; }, /\(dr:trk\): n 1 twice/);
  bad((L, by) => { by('dr:trk', 2).n = 1; }, /dr:trk: n 2 missing \(all 4 are on the panel\)/);
  bad((L, by) => { delete by('dr:pat', 3).n; }, /\(dr:pat\): n 1–3/, 'no n');
  bad(L => { L.controls = L.controls.filter(c => !(c.id === 'dr:pat' && c.n === 3)); }, /dr:pat: n 3 missing \(all 3 are on the panel\)/);
  bad((L, by) => { by('dr:scl', 4).n = 5; }, /\(dr:scl\): n 1–4/, 'an LED token\'s index');
  bad((L, by) => { by('dr:scl', 4).n = 1; }, /\(dr:scl\): n 1 twice/);
  bad(L => { L.controls = L.controls.filter(c => !(c.id === 'dr:scl' && c.n === 2)); }, /dr:scl: n 2 missing \(all 4 are on the panel\)/);
  // the LED keys show their LED
  for (const [id, n] of [['dr:trk', 3], ['dr:pat', 1], ['dr:tkey'], ['dr:back'], ['dr:fwd'], ['dr:avail'], ['dr:cyc'], ['dr:enter']]) bad((L, by) => { by(id, n).led = 'none'; }, new RegExp(`\\(${id}\\): ${id} shows its LED`), id + '\'s LED');
  // the display: a display token, once, three characters at the display's font
  bad((L, by) => { by('dr:disp').w = 20; }, /\(dr:disp\): 3 characters need a box ≥ 20\.6 × 12 mm \(the display's 20 px font\)/);
  bad((L, by) => { by('dr:disp').h = 11.5; }, /\(dr:disp\): 3 characters need a box/);
  bad((L, by) => { Object.assign(by('dr:disp'), { kind: 'button' }); }, /\(dr:disp\): dr:disp must be a display/);
  bad((L, by) => { L.controls.push(Object.assign(clone(by('dr:disp')), { x: 113.85, y: 60 })); }, /dr:disp: placed 2 times/);
  bad((L, by) => { Object.assign(by('dr:scl', 1), { kind: 'button', w: 15, h: 15 }); }, /\(dr:scl\): dr:scl must be a led/);
  bad((L, by) => { delete by('dr:disp').w; }, /\(dr:disp\): w, h > 0/);
  // kinds
  for (const id of ['dr:start', 'dr:stop', 'dr:enter', 'dr:isel', 'dr:shift', 'dr:shuf']) bad((L, by) => { Object.assign(by(id), { kind: 'knob', d: 15 }); }, new RegExp(`\\(${id}\\): ${id} must be a button`));
  bad((L, by) => { Object.assign(by('dr:tempo'), { kind: 'rotary', legends: ['1', '2'] }); }, /dr:tempo must be a knob/);
  // the 14 mm hit rule: the hardware's ≈ 11.9 mm middle-band pitch and the left cluster's default 15 mm hit boxes overlap
  bad(L => { L.controls.filter(c => c.y === 169).forEach((c, i) => { c.x = SMALL9[i]; }); }, /\(dr:(trk|pat)\) and controls\[\d+\] \(dr:(trk|pat)\): hit boxes overlap/, 'the 11.9 mm pitch');
  bad((L, by) => { delete by('dr:last').hit; delete by('dr:scale').hit; }, /\(dr:last\) and controls\[\d+\] \(dr:scale\): hit boxes overlap/, 'the left cluster at 14.9 mm with 15 mm hit boxes');
  bad((L, by) => { by('dr:back').hit = [13.5, 15]; }, /\(dr:back\): hit box 13.5 × 15 mm < 14 mm/);
  // at most once; extras tokens only in the extras, face tokens only on the face; the caption the model's
  bad((L, by) => { L.controls.push(Object.assign(clone(by('dr:isel')), { x: 400, y: 60 })); }, /dr:isel: placed 2 times/);
  bad(L => { L.extras.ids.push('dr:pads'); }, /dr:pads: placed 2 times/);
  bad(L => { L.controls.push({ id: 'dr:grid', kind: 'button', x: 400, y: 60, w: 15, h: 15 }); }, /\(dr:grid\): "dr:grid" is not a control of the model/, 'an extras token on the face');
  bad(L => { L.extras.ids.push('dr:enter'); }, /extras: "dr:enter" is not a control of the model/, 'a face token in the extras');
  bad(L => { L.extras.caption = P.XCAPTION_DRUMS; }, /extras\.caption: the tr909's is "EXTRAS · not on the original · Sounds: our model of the circuits · Hi-hats and cymbals: our own sounds/, 'D4: the caption names our cymbal sounds');
  // the 808's and the 606's tokens are not the 909's, and the 909's not theirs
  for (const t of ['dr:tap', 'dr:fn', 'dr:grp', 'dr:fine']) bad(L => { L.controls.push({ id: t, kind: t === 'dr:fine' ? 'knob' : 'button', x: 400, y: 60, d: 12, w: 15, h: 15 }); }, new RegExp(`"${t}" is not a control of the model`), t + ' on a 909');
  bad(L => { L.controls.push({ id: 'dr:mode', kind: 'rotary', x: 400, y: 60, d: 12, legends: ['1', '2', '3', '4'] }); }, /"dr:mode" is not a control of the model/, 'a mode rotary on a 909');
  bad(L => { L.controls.push({ id: 'dr:runLed', kind: 'led', x: 400, y: 60, d: 3 }); }, /\(dr:runLed\): a display carries no id/, 'the 606\'s RUN LED');
  for (const t of ['dr:swing', 'dr:link']) bad(L => { L.extras.ids.push(t); }, new RegExp(`extras: "${t}" is not a control of the model`), t + ' in a 909\'s extras');
  for (const t of ['dr:isel', 'dr:stop', 'dr:enter']) {
    assert.ok(P.validate(Object.assign(clone(TR_FX), { controls: [...TR_FX.controls, { id: t, kind: 'button', x: 400, y: 160, w: 15, h: 15 }] }), M808).some(x => x.includes(`"${t}" is not a control of the model`)), t + ' on an 808');
    assert.ok(P.validate(Object.assign(clone(TR6_FX), { controls: [...TR6_FX.controls, { id: t, kind: 'button', x: 150, y: 90, w: 15, h: 15 }] }), M606).some(x => x.includes(`"${t}" is not a control of the model`)), t + ' on a 606');
  }
  assert.ok(P.validate(Object.assign(clone(TR6_FX), { controls: [...TR6_FX.controls, { id: 'dr:disp', kind: 'display', x: 150, y: 90, w: 40, h: 19 }] }), M606).some(x => /\(dr:disp\): a display carries no id/.test(x)), 'the 909\'s display on a 606');
  assert.ok(P.validate(Object.assign(clone(TR6_FX), { extras: { ids: TR6_FX.extras.ids.slice(), caption: P.TOKENS.tr909.caption } }), M606).length === 0, 'another model\'s caption is free (the 606 has none of its own)');
  // every models.js id once: the 28 face knobs, none in the extras
  bad(L => { L.controls = L.controls.filter(c => c.id !== 'bda'); }, /bda: not placed/);
  bad(L => { L.extras.ids.push('cru'); }, /cru: placed 2 times/);
  // original art: no maker word
  bad(L => { L.decor[0].s = 'Roland TR-909'; }, /decor\[0\]: a maker name/);
  bad((L, by) => { by('dr:enter').label = 'ENTER Roland'; }, /a maker name/);
  // keys with no LED rule: the left cluster, START / STOP (the hardware's have none)
  const N = clone(TR9_FX);
  for (const id of ['dr:last', 'dr:scale', 'dr:shuf', 'dr:clear', 'dr:isel', 'dr:shift', 'dr:start', 'dr:stop']) N.controls.find(c => c.id === id).led = 'none';
  assert.deepEqual(P.validate(N, M909), []);
});

test('7c geometry: 486 × 300 mm → a 992 px module (976 inside the strip); the extras rows (§7.5) — the grid 640 × 272 and the 4 × 3 pads 232 × 184 · SYNC · → PIANO ROLL · REC · MAP… · SOUNDS… · DEMO (560 px); 992 × 1024 on the dots; the 909\'s caption (D4) and the dimmed note; the 808\'s and the 606\'s cells unchanged', () => {
  const g = P.geometry(TR9_FX, M909), s = P.sizeOf(TR9_FX, M909), X = g.extras;
  assert.deepEqual([g.W, g.content.x, g.content.w, g.content.h], [992, 10, 972, 600]);
  assert.deepEqual([P.DR9_PADS.w, P.DR9_PADS.h, P.tokCell(M909, 'dr:pads'), P.tokCell(M909, 'dr:grid'), P.tokCell(M909, 'dr:demo'), P.tokCell(M909, 'bdu'), P.xbreakOf(M909)],
    [232, 184, [232, 184], [640, 272], [72, 64], null, ['dr:pads']]);
  assert.deepEqual([P.tokCell(M808, 'dr:pads'), P.tokCell(M606, 'dr:pads'), P.tokCell(M606, 'dr:grid')], [[232, 232], [232, 116], [592, 192]], 'the 808\'s and the 606\'s cells');
  const row = (y, ...cells) => { let x = 8; return cells.map(([id, w, h]) => { const c = [id, x, y, w, h || 64]; x += w; return c; }); };
  assert.deepEqual(X.cells.map(c => [c.id, c.x, c.y, c.w, c.h]), [
    ...row(616, ['dr:grid', 640, 272], ['dr:pads', 232, 184]),
    ...row(888, ['dr:sync', 96], ['dr:toRoll', 128], ['dr:rec', 72], ['dr:map', 88], ['dr:sounds', 104], ['dr:demo', 72])]);
  assert.equal(X.cells.slice(2).reduce((a, c) => a + c.w, 0), 560, 'row 2: 560 px (§7.5)');
  for (const c of X.cells) assert.ok(c.x >= P.XPAD && c.x + c.w <= X.w - P.XPAD, c.id + ' inside the 976 px');
  assert.deepEqual([X.x, X.y, X.w, X.h, X.over], [0, 600, 992, 16 + 272 + 64 + 8, false]);
  assert.deepEqual([s.w, s.h, s.w % DOT, s.h % DOT, s.h - BAR_H], [992, 1024, 0, 0, g.body.h], 'TARGET.tr909 = 992 × 1024 (§7.1: ≈ 992 × 1024)');
  assert.deepEqual([X.caption, X.note], [P.TOKENS.tr909.caption, true], 'the 909\'s caption (D4); EXT INST / TAPE SYNC dimmed: "Dimmed controls are not emulated"');
  const C = clone(TR9_FX); C.extras.caption = P.TOKENS.tr909.caption;
  assert.equal(P.geometry(C, M909).extras.caption, P.TOKENS.tr909.caption, 'the layout\'s own (the same)');
  assert.equal(P.geometry(TR6_FX, M606).extras.caption, P.XCAPTION_DRUMS, 'the 606 keeps the drum caption');
  // the caption with the dimmed note overruns the 976 px at 9 px (Chrome: 1047 px): 8 px, the tracking halved (Chrome: 887 px)
  const full = P.TOKENS.tr909.caption + ' · Dimmed controls are not emulated';
  assert.deepEqual([P.xcapFit(full, 976), P.xcapFit(P.TOKENS.tr909.caption, 976), P.xcapFit(P.XCAPTION_DRUMS + ' · Dimmed controls are not emulated', 1008), P.xcapFit(full, 700), P.xcapFit(full, 0)],
    [{ fs: 8, ls: 0.04 }, null, null, { fs: 7, ls: 0.04 }, null]);
  // a face a little shallower (≥ 284 mm) keeps the module within a dot of the pin
  const sh = clone(TR9_FX); sh.areas[0].src[3] = 284;
  assert.deepEqual([P.validate(sh, M909), P.sizeOf(sh, M909).w, P.sizeOf(sh, M909).h], [[], 992, 992]);
  // every live hit box ≥ 28 px, disjoint, in the body; the step keys, TRACK and PATTERN in Tab order; the display and the
  // scale LEDs shown (no hit boxes), the display's box 78 × 38 px
  const hb = P.hitBoxes(TR9_FX, M909);
  for (const h of hb) assert.ok(h.w >= 28 && h.h >= 28 && h.x >= 0 && h.y >= 0 && h.x + h.w <= g.body.w && h.y + h.h <= g.body.h, h.id);
  for (let i = 0; i < hb.length; i++) for (let j = i + 1; j < hb.length; j++) { const a = hb[i], b = hb[j]; assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), a.id + ' × ' + b.id); }
  assert.deepEqual([hb.length, hb.filter(h => h.id === 'dr:step').length, hb.filter(h => h.id === 'dr:trk').length, hb.filter(h => h.id === 'dr:pat').length, hb.some(h => /^dr:(disp|scl)$/.test(h.id))], [28 + 1 + 16 + 12 + 2 + 1 + 6, 16, 4, 3, false]);
  const ord = id => g.order.map(i => TR9_FX.controls[i]).filter(c => c.id === id).map(c => c.n);
  assert.deepEqual([ord('dr:step'), ord('dr:trk'), ord('dr:pat'), ord('dr:scl')], [Array.from({ length: 16 }, (_, i) => i + 1), [1, 2, 3, 4], [1, 2, 3], [1, 2, 3, 4]]);
  assert.deepEqual(g.controls.filter(o => o.show).map(o => o.id), ['dr:disp', 'dr:scl', 'dr:scl', 'dr:scl', 'dr:scl']);
  const d = g.controls.find(o => o.id === 'dr:disp');
  assert.deepEqual([d.own.w, d.own.h, d.live, d.sec >= 0], [78, 38, false, true]);
  // the middle band's caps: 14 mm apart, none more than 6.2 mm from the hardware's (§7.1)
  const mid = TR9_FX.controls.filter(c => c.y === 169);
  assert.ok(mid.every((c, i) => Math.abs(c.x - SMALL9[i]) <= 6.2 + 1e-9 && (!i || Math.round((c.x - mid[i - 1].x) * 1000) === 14000)), 'the minimax');
});

test('7c art: the ten MULTI OUT jacks at full contrast "— cable-able with full patching (stage 4)"; EXT INST, TAPE SYNC and the cartridge slot dimmed "— not emulated"; no maker word; the model name only as plain text; self-contained', () => {
  const svg = P.decorSvg(TR9_FX, M909);
  const groups = [...svg.matchAll(/<g class="(hw-inert[^"]*)"( opacity="[^"]*")? data-tip="([^"]*)"><title>([^<]*)<\/title>/g)].map(m => [m[1], !!m[2], m[3], m[4]]);
  assert.deepEqual(groups.filter(x => x[0] === 'hw-inert hw-later').map(x => [x[1], x[3]]), OUTS9.map(s => [false, s + ' OUT — cable-able with full patching (stage 4)']));
  assert.deepEqual(groups.filter(x => x[0] === 'hw-inert').map(x => [x[1], x[3]]), [[true, 'EXT INST — not emulated'], [true, 'TAPE SYNC — not emulated'], [true, 'CARTRIDGE — not emulated']]);
  const texts = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1].replace(/<[^>]+>/g, ' '));
  for (const t of texts) assert.doesNotMatch(t, new RegExp('\\b(' + P.MAKERS.join('|') + ')\\b'), t);
  assert.ok(texts.includes('TR-909 · Rhythm Composer'));
  assert.doesNotMatch(svg.replace(/<text[\s\S]*?<\/text>/g, '').replace(/<title>[\s\S]*?<\/title>/g, '').replace(/data-tip="[^"]*"/g, ''), /\bTR-909\b/);
  assert.ok(!/currentColor|var\(--|<style|<image|<foreignObject|href/.test(svg), 'self-contained');
});

/* ================================================================ phase 2: the host and the widgets (§7.4, §12.7) */
const r3 = v => Math.round(v * 1000) / 1000;
const cls = n => n.getAttribute('class') || '';
const byCtl = (root, id) => all(root).filter(n => n.getAttribute && n.getAttribute('data-ctl') === id);
const W = (root, id) => { const w = byCtl(root, id)[0]; return w ? w.childNodes[0] : null; };
const stepKeys = root => byCtl(root, 'dr:step').map(w => w.childNodes[0]);
// a fake main.js: the device's record, the transport, the heard frame, the notes, the notices, a manual frame clock; (7b)
// o.model 'tr606': a 606's record; SYNC 303s (link303 logged, n303 from R.n303), the confirm's text kept
function rig(o = {}) {
  const tr = { id: 't1' };
  const R = { D: DC.normDrum(o.D, o.model), log: [], sent: [], notes: [], notices: [], heard: NaN, rate: 48000, playing: false, bpm: 120, sel: true, frames: [], confirm: true, n303: null };
  const deps = {
    mem: t => (t && t.id === 't1' ? R.D : null), put: (t, D) => { R.D = D; },
    send: (t, D, S, at) => R.sent.push(at), play: () => R.log.push('play'), stop: () => R.log.push('stop'),
    playing: () => R.playing, bpm: () => R.bpm, setBpm: (v, ph) => R.log.push('bpm ' + v + ' ' + ph),
    heard: () => R.heard, rate: () => R.rate,
    noteOn: (t, n, v) => R.notes.push(['on', n, r3(v)]), noteOff: (t, n) => R.notes.push(['off', n]),
    sel: () => R.sel, notice: (text, ms, tap) => R.notices.push({ text, tap }), toRoll: (t, b) => R.log.push('toRoll ' + b),
    confirm: t => { R.asked = t; return R.confirm; }, loadSample: (t, s) => Promise.resolve({ id: 'smp:0123456789abcdef', name: 'my ' + s }),
    learn: (t, fn) => { R.learn = fn; return () => { R.learn = null; }; }, monitor: (t, on) => R.log.push('mon ' + on), loop: () => R.loop,
    raf: f => R.frames.push(f), link303: (t, sw) => R.log.push('link303 ' + sw), n303: () => R.n303,
  };
  const H = CD.drumHost(deps);
  const frame = () => { const q = R.frames.splice(0); for (const f of q) f(); };
  return { tr, R, H, deps, frame };
}
// cv-panel's hw api in miniature (classic-panel's contract: dragB with o.tap and b.end, tap with the event)
function fakeApi(doc, model = M808) {
  const vals = {}, ui = new Map(), tips = [];
  for (const c of model.controls) vals[c.id] = c.def;
  const set = (id, v) => { vals[id] = v; const u = ui.get(id); if (u) u(); };
  const widget = cl => c => { const el = doc.createElement('div'); el.className = cl; el.setAttribute('aria-label', c.label); const upd = () => el.setAttribute('aria-valuenow', String(vals[c.id])); ui.set(c.id, upd); upd(); return el; };
  return {
    doc, vals, ui, tips, get: id => vals[id], set,
    watch: (id, fn) => { const p = ui.get(id); ui.set(id, p ? () => { p(); fn(); } : fn); },
    bind: c => ({ id: c.id, label: c.label, min: c.min, max: c.max, step: c.step, def: c.def, get: () => vals[c.id], set: v => set(c.id, v), fmt: String, snap: () => vals[c.id], restore: v => set(c.id, v) }),
    knob: widget('knob'), slider: widget('slider'), selector: widget('sel'), toggle: widget('tog'),
    dragB(el, b, o = {}) {
      let s = null;
      el.addEventListener('pointerdown', e => { s = { y: e.clientY, x: e.clientX, k: b.snap(), v0: b.get(), p: (b.get() - b.min) / ((b.max - b.min) || 1), moved: false }; });
      el.addEventListener('pointermove', e => {
        if (!s) return;
        const d = b.axis === 'x' ? e.clientX - s.x : s.y - e.clientY, p = Math.max(0, Math.min(1, s.p + d / 40)), v = b.min + p * (b.max - b.min);
        s.moved = true; b.set(b.step ? Math.round(v / b.step) * b.step : v, 'move');
      });
      el.addEventListener('pointerup', () => { if (s && !s.moved && b.get() === s.v0 && o.tap) o.tap(); if (s && s.moved && b.end) b.end(); s = null; });
      el.addEventListener('pointercancel', e => { if (s && e.gesture === 'two-finger') b.restore(s.k); s = null; });
      el.addEventListener('keydown', e => { const d = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0; if (d) b.set(Math.max(b.min, Math.min(b.max, b.get() + d * (b.step || 1)))); else if (o.tap && e.key === 'Enter') o.tap(); });
    },
    tap: (el, fn) => el.addEventListener('pointerup', e => fn(e)),
    tip: (el, t) => tips.push(t), untip: () => {}, fmt: (c, v) => String(v), presetNo: () => null, tier: false,
  };
}
function mount(withHost, o = {}) { // (7b: o.six — the fixture 606 face on the real tr606 model, a 606 record; 7c: o.nine — the 909's)
  const six = !!o.six, nine = !!o.nine, model = nine ? M909 : six ? M606 : M808, doc = fresh(), root = doc.createElement('div'), api = fakeApi(doc, model);
  const g = withHost ? rig(nine ? Object.assign({ model: 'tr909' }, o) : six ? Object.assign({ model: 'tr606' }, o) : o) : null;
  if (g) { // (every press the widgets make, TAP's included, recorded as JSON)
    api.drum = g.H.api(g.tr); g.presses = [];
    const p = api.drum.press, t = api.drum.tap;
    api.drum.press = (i, ph) => { g.presses.push(JSON.stringify(i)); return p(i, ph); };
    api.drum.tap = ts => { g.presses.push('{"k":"tap"}'); return t(ts); };
  }
  doc.body.append(root);
  const r = P.render(root, nine ? TR9_FX : six ? TR6_FX : TR_FX, model, api);
  return Object.assign({ doc, root, api, r }, g || {});
}
const withRaf = f => { rafQ.install(); try { return f(); } finally { rafQ.uninstall(); } };

test('7a drumHost: press applies drum-core\'s commands — send (now / bar), the transport when synced, the project tempo (a drag: move … end), the one-tap undo notice; transport / bpm / panic / changed notify; a stale panel\'s pads play nothing', () => {
  const { tr, R, H } = rig(), A = H.api(tr);
  let n = 0; const off = A.on(() => n++);
  assert.deepEqual([A.state().run, A.state().S.play, A.state().S.bpm, A.state().D.ui.mode], [false, false, 120, DC.M_MAN]);
  A.press({ k: 'start' });
  assert.deepEqual(R.log, ['play'], 'synced: START is the project\'s ▶');
  H.transport(true);
  assert.deepEqual([A.state().S.play, A.state().run], [true, true]);
  A.press({ k: 'step', n: 3 });
  assert.deepEqual([R.D.ui.sel, R.sent.at(-1)], [2, 'bar'], 'MANUAL PLAY running: the next measure');
  A.press({ k: 'tempo', v: 22 }, 'move'); A.press({ k: 'tempo', v: 23 }, 'move'); A.end();
  const b22 = DC.tempoBpm(22, DC.bpmTempo(120).fine), b23 = DC.tempoBpm(23, DC.bpmTempo(b22).fine);
  assert.deepEqual(R.log.slice(1), ['bpm ' + b22 + ' move', 'bpm ' + b23 + ' move', 'bpm ' + b23 + ' end'], 'one gesture: moves then its end');
  assert.equal(A.state().S.bpm, b23, 'the knob shows it at once');
  H.bpm(133); assert.equal(A.state().S.bpm, 133);
  H.transport(false); A.press({ k: 'mode', v: DC.M_CLEAR });
  R.D = Object.assign({}, R.D, { st: R.D.st.map((r, p) => (p === 4 ? r.map(() => 6) : r)) });
  A.press({ k: 'step', n: 3 }); A.press({ k: 'clear' });
  assert.deepEqual([R.D.st[4][0], R.notices.length, typeof R.notices[0].tap], [0, 1, 'function'], 'PATTERN CLEAR, its notice');
  R.notices[0].tap();
  assert.equal(R.D.st[4][0], 6, 'the notice\'s tap undoes it');
  const n0 = n; H.changed(tr); H.panic(); assert.equal(n, n0 + 2);
  off(); H.changed(tr); assert.equal(n, n0 + 2, 'off');
  R.sel = false;
  assert.deepEqual([A.pads.on('sd', 1, 0), R.notes.length], [false, 0], 'a stale panel: no note');
  R.sel = true;
  assert.deepEqual([A.pads.on('sd', 0.5, 0), R.notes], [true, [['on', 38, 0.5]]], 'the sound\'s primary note (§4.1)');
  A.pads.off('sd'); A.pads.off('sd');
  assert.deepEqual(R.notes.at(-1), ['off', 38]); assert.equal(R.notes.length, 2, 'one off');
  assert.equal(A.bars(), 1, 'the plan in bars (a 16-step pattern at pre-scale 3: one 4/4 bar)');
  A.toRoll(8); assert.equal(R.log.at(-1), 'toRoll 8');
  assert.equal(A.canLoad && A.canLearn, true);
});

test('7a drumHost: posts reach the panels at their HEARD time (a frame\'s lead), the last of a frame once; COMPOSE records each measure\'s key there; TAP writes the nearest step from the heard time (the fraction of the step); REC pads', () => {
  const { tr, R, H, frame } = rig(), A = H.api(tr), seen = [];
  A.step(P0 => seen.push(P0.s));
  // synced, transport playing, COMPOSE on track 2 (inst 1): a measure's first step records its key
  R.playing = true;
  A.press({ k: 'mode', v: DC.M_COMP }); H.transport(true);
  R.heard = 0;
  H.step(tr, 'i1', { s: 0, m: 0, k: 3, v: 0, p: 0, o: 0, M: 0, F: 2000 });
  frame();
  assert.deepEqual([seen, R.D.rt[64]], [[], -1], 'not heard yet (2000 > 0 + 800)');
  R.heard = 1300; H.step(tr, 'i1', { s: 1, m: 0, k: 3, v: 0, p: 0, o: 240, M: 0, F: 8000 }); frame();
  assert.deepEqual([seen, R.D.rt[64], R.D.rtEnd[1]], [[0], 3, 64], 'heard: the LEDs\' post, COMPOSE wrote key 4 into track 2\'s measure 1');
  R.heard = NaN;
  for (let s = 2; s < 7; s++) H.step(tr, 'i1', { s, m: 0, k: 3, v: 0, p: 0, o: 240 * s, M: 0, F: 9000 + s });
  frame();
  assert.deepEqual(seen, [0, 6], 'no audio clock: everything at once, the frame\'s last post to the listeners');
  // TAP in PATTERN WRITE 1st PART, free-running at 120 BPM (25 frames a tick; a sixteenth 240 ticks = 6000 frames)
  const T = rig(), B = T.H.api(T.tr);
  B.press({ k: 'sync', v: false }); B.press({ k: 'mode', v: DC.M_W1 }); B.press({ k: 'start' });
  assert.equal(B.state().run, true);
  T.H.step(T.tr, 'i1', { s: 3, m: 0, k: 0, v: 0, p: 0, o: 720, M: 0, F: 48000 });
  T.R.heard = 48000 + 4000; B.tap(123);
  assert.deepEqual([T.R.D.st[0][4] >> 1 & 1, T.R.D.st[0][3] >> 1 & 1], [1, 0], '2/3 through step 4: the nearest is step 5 (BD, the instrument)');
  T.R.heard = 48000 + 1000; B.tap(124);
  assert.equal(T.R.D.st[0][3] >> 1 & 1, 1, '1/6 through: step 4 itself');
  // REC: a pad hit writes its lane at the nearest step (here the snare at step 4)
  B.press({ k: 'rec', v: true }); B.pads.on('sd', 1, 125);
  assert.deepEqual([T.R.D.st[0][3] >> 2 & 1, T.R.notes[0].join(' ')], [1, 'on 38 1']);
});

test('7a render with api.drum: the 16 step keys (data-lit from leds(), music zones, Shift+Enter), the PART / variation LEDs, the rotaries / switches / TEMPO / FINE (aria), START, TAP, CLEAR; the extras (the grid canvas, 16 pads, the small controls); the CSS once', () => {
  withRaf(() => {
    const m = mount(true), keys = stepKeys(m.root);
    assert.equal(keys.length, 16);
    assert.deepEqual(keys.map(k => k.getAttribute('data-n')), Array.from({ length: 16 }, (_, i) => String(i + 1)));
    assert.deepEqual(keys.map(k => cls(k)), Array(16).fill('hw-btn dr-key'));
    assert.deepEqual(keys.map(k => k.getAttribute('data-lit')), ['flash', ...Array(15).fill('off')], 'stopped: the selected key flashing (§3.3)');
    assert.deepEqual([keys[0].getAttribute('aria-current'), keys[0].getAttribute('data-gesture'), keys[0].getAttribute('aria-label'), keys[14].getAttribute('aria-label'), keys[3].getAttribute('data-led')], ['true', 'music', 'Step 1', 'Step 15 · intro / fill 3', 'above']);
    const leds = all(m.root).filter(n => cls(n) === 'hw-led hw-show dr-led').map(n => n.getAttribute('aria-label'));
    assert.deepEqual(leds, ['Variation A: lit', 'Variation B: off', '1st part: off', '2nd part: off']);
    const mode = W(m.root, 'dr:mode'), inst = W(m.root, 'dr:inst'), fill = W(m.root, 'dr:fill'), tempo = W(m.root, 'dr:tempo'), fine = W(m.root, 'dr:fine');
    assert.deepEqual([cls(mode), mode.getAttribute('role'), mode.getAttribute('aria-valuenow'), mode.getAttribute('aria-valuetext'), mode.getAttribute('aria-valuemax')], ['knob hw-rot dr-rot', 'slider', '3', 'Manual play', '5']);
    assert.deepEqual([inst.getAttribute('aria-valuetext'), fill.getAttribute('aria-valuetext'), tempo.getAttribute('aria-valuetext'), cls(tempo), fine.getAttribute('aria-label')], ['Bass drum', 'Manual', '120 BPM', 'knob hw-tempo dr-tempo', 'Fine tempo']);
    const bv = W(m.root, 'dr:bvar'), pre = W(m.root, 'dr:pre'), ifv = W(m.root, 'dr:ifv');
    assert.deepEqual([cls(bv), bv.getAttribute('role'), bv.getAttribute('aria-valuetext'), pre.getAttribute('aria-valuenow'), pre.getAttribute('aria-valuetext'), ifv.getAttribute('aria-pressed')], ['hw-sw dr-sw', 'slider', 'A', '2', '3 · sixteenths', 'false']);
    for (const id of ['dr:start', 'dr:tap', 'dr:clear']) assert.equal(W(m.root, id).localName, 'button', id);
    for (const id of DR_FACE) assert.ok(byCtl(m.root, id).length || all(m.root).some(n => cls(n) === 'hw-led hw-show dr-led'), id);
    for (const id of DR_FACE.filter(t => !/^dr:(part|var)/.test(t))) assert.equal(byCtl(m.root, id)[0].getAttribute('data-nomod'), '1', id + ': no modulation target (§9)');
    // the extras: one cell each, the grid one canvas (+ no DOM per cell), 16 pads, the small controls
    for (const id of DR_EXTRAS) assert.equal(byCtl(m.root, id).length, 1, id);
    const grid = W(m.root, 'dr:grid'), pads = W(m.root, 'dr:pads');
    assert.deepEqual([cls(grid), grid.childNodes.length, grid.childNodes[0].localName, grid.childNodes[0].getAttribute('aria-roledescription')], ['dr-grid', 1, 'canvas', 'step grid']);
    assert.deepEqual([pads.getAttribute('data-gesture'), pads.childNodes.length, pads.childNodes.map(p => p.getAttribute('data-sound')).join(' ')], ['music', 16, CD.PAD_ORDER.join(' ')]);
    assert.deepEqual(['dr:sync', 'dr:toRoll', 'dr:rec', 'dr:map', 'dr:sounds', 'dr:demo'].map(id => W(m.root, id).textContent), ['Sync · song', '→ Piano roll', 'Rec', 'Map…', 'Sounds…', 'Demo']);
    assert.equal(W(m.root, 'dr:swing').getAttribute('aria-valuetext'), '50 % (off)');
    assert.equal(all(m.doc.head).filter(n => n.id === 'cv-drum-css').length, 1, 'the CSS injected once');
    assert.ok(all(m.root).length < 900, 'DOM ≤ 900 elements (§12.8): ' + all(m.root).length);
    m.r.destroy();
  });
});

test('7a widgets: the rotaries step through their positions (a tap = the next, wrapping; the arrows; a drag; the two-finger rollback); the switches; TEMPO synced sets the project tempo (one gesture), free the machine\'s; ≤ 1 paint a frame', () => {
  withRaf(() => {
    const m = mount(true), mode = W(m.root, 'dr:mode'), tap = el => { ptr(el, 'pointerdown', 0, 100); ptr(el, 'pointerup', 0, 100); };
    tap(mode); tap(mode); tap(mode);
    assert.deepEqual([m.R.D.ui.mode, mode.getAttribute('aria-valuenow')], [0, '3'], 'pressed through 4, 5, 0; the knob paints on the next frame');
    const p0 = CD.drumStats.paints;
    rafQ.flush();
    assert.deepEqual([mode.getAttribute('aria-valuenow'), mode.getAttribute('aria-valuetext'), CD.drumStats.paints - p0], ['0', 'Pattern clear', 1], 'three presses: one paint');
    key(mode, 'ArrowUp'); rafQ.flush();
    assert.equal(mode.getAttribute('aria-valuetext'), 'Pattern write · 1st part');
    ptr(mode, 'pointerdown', 0, 100); ptr(mode, 'pointermove', 0, 60);
    assert.equal(m.R.D.ui.mode, 5, 'a drag up');
    fire(mode, 'pointercancel', { gesture: 'two-finger' });
    assert.equal(m.R.D.ui.mode, 1, 'rolled back');
    const inst = W(m.root, 'dr:inst');
    for (let i = 0; i < 11; i++) tap(inst);
    rafQ.flush();
    assert.deepEqual([m.R.D.ui.inst, inst.getAttribute('aria-valuetext')], [0, 'Accent'], '12 positions, wrapping');
    m.api.drum.press({ k: 'mode', v: DC.M_PLAY }); rafQ.flush();
    assert.equal(inst.getAttribute('aria-valuetext'), 'Track 1', 'PLAY / COMPOSE: the track');
    const bv = W(m.root, 'dr:bvar'), pre = W(m.root, 'dr:pre');
    tap(bv); tap(pre); rafQ.flush();
    assert.deepEqual([m.R.D.ui.bvar, bv.getAttribute('aria-valuetext'), bv.getAttribute('data-pos'), m.R.D.ui.pre, pre.getAttribute('aria-valuetext')], [1, 'A then B', '1', 4, '4 · thirty-seconds']);
    const tempo = W(m.root, 'dr:tempo');
    ptr(tempo, 'pointerdown', 0, 100); ptr(tempo, 'pointermove', 0, 99); ptr(tempo, 'pointermove', 0, 98); ptr(tempo, 'pointerup', 0, 98);
    const bpms = () => m.R.log.filter(x => x.startsWith('bpm '));
    assert.deepEqual(bpms().map(x => x.split(' ').pop()), ['move', 'move', 'end'], 'synced: the project tempo, one gesture');
    m.api.drum.press({ k: 'sync', v: false });
    const t0 = m.R.D.ui.tempo; key(tempo, 'ArrowUp');
    assert.deepEqual([m.R.D.ui.tempo, bpms().length], [t0 + 1, 3], 'free: the machine\'s own TEMPO');
    m.r.destroy();
  });
});

test('7a widgets: CLEAR held + a step key → press({ k: \'clear+step\', n }); released with none → clear; a cancelled CLEAR presses nothing; Shift + a key = CLEAR + N (one mouse); START; TAP at the press (pointer and keys)', () => {
  withRaf(() => {
    const m = mount(true), keys = stepKeys(m.root), clear = W(m.root, 'dr:clear');
    fire(clear, 'pointerdown', { pointerId: 7, button: 0 });
    assert.equal(clear.getAttribute('aria-pressed'), 'true');
    ptr(keys[3], 'pointerup', 0, 0, { pointerId: 8 });
    fire(clear, 'pointerup', { pointerId: 7 });
    assert.deepEqual(m.presses, ['{"k":"clear+step","n":4}'], 'CLEAR + 4, no CLEAR at the release');
    fire(clear, 'pointerdown', { pointerId: 7, button: 0 }); fire(clear, 'pointerup', { pointerId: 7 });
    assert.equal(m.presses.at(-1), '{"k":"clear"}');
    fire(clear, 'pointerdown', { pointerId: 9, button: 0 }); fire(clear, 'pointercancel', { pointerId: 9 });
    assert.equal(m.presses.length, 2, 'cancelled: nothing');
    ptr(keys[4], 'pointerup', 0, 0, { shiftKey: true });
    ptr(keys[5], 'pointerup', 0, 0);
    assert.deepEqual(m.presses.slice(2), ['{"k":"clear+step","n":5}', '{"k":"step","n":6}']);
    key(clear, 'Enter'); fire(clear, 'keyup', { key: 'Enter' });
    assert.equal(m.presses.at(-1), '{"k":"clear"}', 'the keyboard: Enter held = CLEAR held');
    // the real effect: PATTERN WRITE 1st PART running free, CLEAR + 4 sets the 1st part's length
    m.api.drum.press({ k: 'sync', v: false }); m.api.drum.press({ k: 'mode', v: DC.M_W1 });
    ptr(W(m.root, 'dr:start'), 'pointerup', 0, 0);
    assert.equal(m.api.drum.state().run, true, 'START (free)');
    fire(clear, 'pointerdown', { pointerId: 7, button: 0 }); ptr(keys[3], 'pointerup', 0, 0, { pointerId: 8 }); fire(clear, 'pointerup', { pointerId: 7 });
    assert.deepEqual([m.R.D.ui.sel, m.R.D.keys[5].l1], [5, 4], 'CLEAR + 4: the edited key\'s (step 6, selected above) 1st part ends at step 4');
    rafQ.flush();
    assert.equal(W(m.root, 'dr:start').getAttribute('aria-pressed'), 'true');
    const tapB = W(m.root, 'dr:tap'), n0 = m.presses.length;
    fire(tapB, 'pointerdown', { button: 0, timeStamp: 5 }); key(tapB, 'Enter'); key(tapB, 'Enter', { repeat: true });
    assert.deepEqual(m.presses.slice(n0).map(x => JSON.parse(x).k), ['tap', 'tap'], 'at the press; a key\'s repeat is not a tap');
    m.r.destroy();
  });
});

test('7a widgets (review 2 #2): CLEAR + N by touch reads CLEAR at the step key\'s press — whichever finger lifts first, or both in one event; a key pressed before CLEAR is a plain step', () => {
  withRaf(() => {
    const m = mount(true), keys = stepKeys(m.root), clear = W(m.root, 'dr:clear');
    const touch = (el, t, id) => fire(el, t, { pointerId: id, button: 0, pointerType: 'touch' });
    // CLEAR's finger lifts first
    touch(clear, 'pointerdown', 7); touch(keys[3], 'pointerdown', 8); touch(clear, 'pointerup', 7); touch(keys[3], 'pointerup', 8);
    assert.deepEqual(m.presses, ['{"k":"clear+step","n":4}'], 'CLEAR + 4, no CLEAR at CLEAR\'s release');
    // the step finger first (the case that already worked)
    touch(clear, 'pointerdown', 7); touch(keys[10], 'pointerdown', 9); touch(keys[10], 'pointerup', 9); touch(clear, 'pointerup', 7);
    assert.deepEqual(m.presses.slice(1), ['{"k":"clear+step","n":11}']);
    // both lifted in one touch event (CLEAR's pointerup dispatched first)
    touch(clear, 'pointerdown', 7); touch(keys[5], 'pointerdown', 10); touch(clear, 'pointerup', 7); touch(keys[5], 'pointerup', 10);
    assert.deepEqual(m.presses.slice(2), ['{"k":"clear+step","n":6}']);
    // a step key pressed before CLEAR: a plain step (the hardware acts at the key's press); CLEAR's release then latches
    touch(keys[1], 'pointerdown', 11); touch(clear, 'pointerdown', 7); touch(keys[1], 'pointerup', 11); touch(clear, 'pointerup', 7);
    assert.deepEqual(m.presses.slice(3), ['{"k":"step","n":2}', '{"k":"clear"}']);
    // a later plain tap of the key is a step (nothing latched from before)
    touch(keys[3], 'pointerdown', 12); touch(keys[3], 'pointerup', 12);
    assert.deepEqual(m.presses.slice(5), ['{"k":"step","n":4}']);
    m.r.destroy();
  });
});

test('7a the grid canvas: hit-tests to (lane, step) at 3 zooms; a tap toggles that step of the shown pattern (any mode), the lane header mutes (a long press, Alt or a right click solos), the corner switches the part when there is a 2nd; the keyboard; painted at the store density', () => {
  for (const [x, y, want] of [[0, 0, '{"corner":true}'], [64, 10, '{"top":true,"s":0}'], [639, 271, '{"lane":11,"s":15}'], [63, 32, '{"head":true,"lane":0}'], [64 + 5 * 36 + 1, 32 + 2 * 20 + 1, '{"lane":2,"s":5}']]) assert.equal(JSON.stringify(CD.gridAt(x, y)), want, x + ',' + y);
  assert.deepEqual([CD.gridAt(-1, 5), CD.gridAt(640, 5)], [null, null]);
  assert.deepEqual([CD.GRID.w, CD.GRID.h, CD.GRID.w, CD.GRID.h].join(), [P.DR_GRID.w, P.DR_GRID.h, P.TOK_CELL['dr:grid'][0], P.TOK_CELL['dr:grid'][1]].join(), 'the cell = the canvas');
  withRaf(() => {
    const m = mount(true), cv = W(m.root, 'dr:grid').childNodes[0];
    layoutEl(cv, 640, 272);
    const pat = () => DC.gridPat(m.api.drum.state().S, m.R.D), bit = (l, s) => (m.R.D.st[pat()][s] >> l) & 1;
    const hitAt = (k, lane, s, o = {}) => { // a finger at the cell's centre on screen, the canvas at zoom k
      placeEl(cv, 100, 50, 640 * k, 272 * k);
      const X = 100 + (64 + s * 36 + 18) * k, Y = 50 + (32 + lane * 20 + 10) * k;
      fire(cv, 'pointerdown', Object.assign({ pointerType: 'touch', pointerId: 3, clientX: X, clientY: Y, button: 0, timeStamp: 0 }, o));
      fire(cv, 'pointerup', Object.assign({ pointerType: 'touch', pointerId: 3, clientX: X, clientY: Y, timeStamp: o.up || 10 }, o));
    };
    for (const [k, lane, s] of [[0.5, 2, 5], [1, 11, 15], [2, 0, 0]]) { hitAt(k, lane, s); assert.equal(bit(lane, s), 1, `k ${k}: lane ${lane} step ${s + 1}`); }
    hitAt(1, 2, 5); assert.equal(bit(2, 5), 0, 'a second tap clears it');
    // the header (x < 64): a tap mutes, a long press solos
    const head = (k, lane, up) => { placeEl(cv, 100, 50, 640 * k, 272 * k); const X = 100 + 30 * k, Y = 50 + (32 + lane * 20 + 10) * k; fire(cv, 'pointerdown', { pointerType: 'touch', pointerId: 4, clientX: X, clientY: Y, button: 0, timeStamp: 0 }); fire(cv, 'pointerup', { pointerType: 'touch', pointerId: 4, clientX: X, clientY: Y, timeStamp: up }); };
    head(1, 3, 100); assert.equal(m.R.D.x.mute, 1 << 3);
    head(0.5, 2, 700); assert.equal(m.R.D.x.solo, 1 << 2, 'held 0.7 s: solo');
    placeEl(cv, 100, 50, 640, 272);
    fire(cv, 'contextmenu', { clientX: 100 + 30, clientY: 50 + 32 + 4 * 20 + 10 }); assert.equal(m.R.D.x.solo, (1 << 2) | (1 << 4), 'a right click: solo');
    // a finger that moved is not a tap; the mouse acts at the press
    placeEl(cv, 0, 0, 640, 272);
    fire(cv, 'pointerdown', { pointerType: 'touch', pointerId: 5, clientX: 64 + 18, clientY: 32 + 30, button: 0 }); fire(cv, 'pointerup', { pointerType: 'touch', pointerId: 5, clientX: 64 + 18 + 30, clientY: 32 + 30 });
    assert.equal(bit(1, 0), 0, 'moved 30 px: nothing');
    fire(cv, 'pointerdown', { pointerType: 'mouse', clientX: 64 + 18, clientY: 32 + 30, button: 0 });
    assert.equal(bit(1, 0), 1, 'the mouse at the press');
    // the 2nd part: the corner switch when the key has one (MANUAL PLAY: x.part)
    m.R.D = Object.assign({}, m.R.D, { keys: m.R.D.keys.map((K, i) => (i ? K : Object.assign({}, K, { l2: 8 }))) });
    fire(cv, 'pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10, button: 0 }); fire(cv, 'pointerup', { pointerType: 'mouse', clientX: 10, clientY: 10, timeStamp: 1 });
    assert.equal(m.R.D.x.part, 1);
    fire(cv, 'pointerdown', { pointerType: 'mouse', clientX: 64 + 18, clientY: 32 + 30, button: 0 });
    assert.equal(bit(1, 16), 1, 'the 2nd part\'s step 1 = step 17');
    // the keyboard: the arrows move the cell, Space toggles, M mutes, S solos
    fire(cv, 'focus'); key(cv, 'ArrowRight'); key(cv, 'ArrowDown'); key(cv, ' ');
    assert.equal(bit(2, 17), 1, 'lane SD, step 18');
    key(cv, 'm'); assert.equal((m.R.D.x.mute >> 2) & 1, 1);
    rafQ.flush();
    assert.match(cv.getAttribute('aria-label'), /^Step grid · pattern 1 A · 2nd part · SD step 2 on$/);
    // painted: a 640 × 272 store at the density (dpr 1 here), the cells drawn
    const ctx = cv.getContext('2d');
    assert.deepEqual([cv.width, cv.height, ctx.calls.some(c => c[0] === 'fillRect')], [640, 272, true]);
    m.r.destroy();
  });
});

test('7a pads: 16 in a music zone; velocity from where a pad is touched (the back 0.30, the front 1); two pointers = two hits; each finger its own hit, the off when the last lifts; lit on its press and on the monitor\'s hits at their heard time; the keyboard', () => {
  assert.deepEqual([CD.padVel(0), CD.padVel(0.5), CD.padVel(1), CD.padVel(2)].map(r3), [0.3, 0.675, 1, 1]);
  withRaf(() => {
    const m = mount(true), g = W(m.root, 'dr:pads'), pad = s => g.childNodes.find(p => p.getAttribute('data-sound') === s);
    for (const p of g.childNodes) placeEl(p, 0, 0, 52, 52);
    fire(pad('bd'), 'pointerdown', { pointerId: 1, pointerType: 'touch', clientY: 0, button: 0 });
    fire(pad('sd'), 'pointerdown', { pointerId: 2, pointerType: 'touch', clientY: 52, button: 0 });
    fire(pad('bd'), 'pointerdown', { pointerId: 3, pointerType: 'touch', clientY: 26, button: 0 });
    assert.deepEqual(m.R.notes, [['on', 36, 0.3], ['on', 38, 1], ['on', 36, 0.675]], 'the back, the front, the middle: two pads, three fingers, three hits');
    assert.deepEqual([pad('bd').getAttribute('data-held'), pad('sd').getAttribute('data-held'), pad('bd').getAttribute('data-hit') != null], ['', '', true]);
    fire(pad('bd'), 'pointerup', { pointerId: 1 });
    assert.equal(m.R.notes.length, 3, 'one of two fingers off the kick: still held');
    fire(pad('bd'), 'pointerup', { pointerId: 3 }); fire(pad('sd'), 'lostpointercapture', { pointerId: 2 });
    assert.deepEqual(m.R.notes.slice(3), [['off', 36], ['off', 38]]);
    assert.equal(pad('bd').getAttribute('data-held'), null);
    // the monitor's hits light their pads at the heard time
    assert.deepEqual(m.R.log, ['mon true'], 'the panel subscribed the monitor');
    const was = pad('ch').getAttribute('data-hit');
    m.R.heard = 0; m.H.mon(m.tr, { lit: 1 << 10, F: 5000 }); m.frame();
    assert.equal(pad('ch').getAttribute('data-hit'), was, 'not heard yet');
    m.R.heard = 4500; m.frame();
    assert.notEqual(pad('ch').getAttribute('data-hit'), was, 'heard: the closed hat lights');
    // the keyboard: Space / Enter hits at an unaccented step's velocity, the release ends it; the arrows move along the pads
    key(pad('bd'), 'Enter'); fire(pad('bd'), 'keyup', { key: 'Enter' });
    assert.deepEqual(m.R.notes.slice(5), [['on', 36, r3(100 / 127)], ['off', 36]]);
    assert.deepEqual([pad('bd').getAttribute('tabindex'), pad('lt').getAttribute('tabindex')], ['0', '-1']);
    key(pad('bd'), 'ArrowUp');
    assert.deepEqual([pad('bd').getAttribute('tabindex'), pad('lt').getAttribute('tabindex')], ['-1', '0']);
    m.r.destroy();
    assert.deepEqual(m.R.log, ['mon true', 'mon false'], 'destroy: the monitor unsubscribed');
  });
});

test('7a pads (review 2 #3, the DOM budget): a pad is one element — its code and name are data-code / data-name drawn by CSS pseudo-elements, the loaded-slot dot a background on [data-smp]', () => {
  withRaf(() => {
    const m = mount(true), g = W(m.root, 'dr:pads'), pads = g.childNodes;
    assert.equal(pads.length, 16);
    assert.deepEqual(pads.map(p => p.childNodes.length), new Array(16).fill(0), 'no child elements');
    const bd = pads.find(p => p.getAttribute('data-sound') === 'bd'), cl = pads.find(p => p.getAttribute('data-sound') === 'cl');
    assert.deepEqual([bd.getAttribute('data-code'), bd.getAttribute('data-name'), cl.getAttribute('data-code'), cl.getAttribute('data-name')], ['BD', 'Kick', 'CL', 'Claves']);
    const css = m.doc.getElementById('cv-drum-css').textContent;
    assert.ok(/\.dr-pad::before \{[^}]*content: attr\(data-code\)/.test(css) && /\.dr-pad::after \{[^}]*content: attr\(data-name\)/.test(css), 'the pseudo-elements');
    assert.ok(/\.dr-pad\[data-smp\] \{[^}]*radial-gradient/.test(css), 'the slot dot');
    assert.ok(!/\.dr-pad > (b|small|i)\b/.test(css), 'no child rules left');
    m.r.destroy();
  });
});

test('7a the LEDs at the heard time, ≤ 1 update a frame: running synced in MANUAL PLAY the playing key lit, a pending one flashing; a write mode the instrument\'s steps with the playhead inverted; stopped the selected key flashing', () => {
  withRaf(() => {
    const m = mount(true), keys = stepKeys(m.root), lit = () => keys.map(k => k.getAttribute('data-lit')).join(' ');
    m.R.playing = true; m.H.transport(true); m.R.heard = 0;
    m.H.step(m.tr, 'i1', { s: 0, m: 0, k: 0, v: 0, p: 0, o: 0, M: 0, F: 5000 });
    m.frame(); rafQ.flush();
    assert.equal(lit().split(' ')[0], 'flash', 'not heard yet: the selected key');
    m.R.heard = 4500;
    const p0 = CD.drumStats.paints;
    for (let s = 1; s < 6; s++) m.H.step(m.tr, 'i1', { s, m: 0, k: 0, v: 0, p: 0, o: 240 * s, M: 0, F: 5000 + s });
    m.frame(); rafQ.flush(); rafQ.flush();
    assert.equal(CD.drumStats.paints - p0, 1, 'six posts in a frame: one paint');
    assert.equal(lit().split(' ')[0], 'on', 'heard: the playing key steady');
    m.api.drum.press({ k: 'step', n: 3 }); rafQ.flush();
    assert.deepEqual(lit().split(' ').slice(0, 3), ['on', 'off', 'flash'], 'a pending key flashing');
    // a write mode (free, running): BD's steps of the 1st part, the playhead inverted
    m.api.drum.press({ k: 'sync', v: false }); m.api.drum.press({ k: 'mode', v: DC.M_W1 }); m.api.drum.press({ k: 'step', n: 1 });
    m.api.drum.press({ k: 'start' });
    m.api.drum.press({ k: 'step', n: 1 }); m.api.drum.press({ k: 'step', n: 3 });
    m.R.heard = NaN; // (no audio clock: shown at once)
    m.H.step(m.tr, 'i1', { s: 2, m: 0, k: 0, v: 0, p: 0, o: 480, M: 0, F: 6000 }); m.frame(); rafQ.flush();
    assert.deepEqual(lit().split(' ').slice(0, 4), ['on', 'off', 'head-off', 'off'], 'the playhead over a set step: dark');
    m.H.step(m.tr, 'i1', { s: 3, m: 0, k: 0, v: 0, p: 0, o: 720, M: 0, F: 6001 }); m.frame(); rafQ.flush();
    assert.deepEqual(lit().split(' ').slice(0, 4), ['on', 'off', 'on', 'head-on'], 'over an empty one: lit');
    const parts = all(m.root).filter(n => /dr-led/.test(cls(n))).map(n => n.getAttribute('data-lit')).join(' ');
    assert.equal(parts, 'on off on off', 'variation A playing, the 1st part');
    m.H.panic(); rafQ.flush();
    assert.equal(lit().split(' ')[0], 'flash', 'panic: stopped, the edited key flashing');
    // off screen ([data-cv-off] on the module): nothing written
    const mod = m.doc.createElement('div'); mod.setAttribute('data-cv-off', ''); m.doc.body.append(mod); mod.append(m.root);
    const p1 = CD.drumStats.paints; m.api.drum.press({ k: 'step', n: 2 }); rafQ.flush();
    assert.equal(CD.drumStats.paints, p1, 'off screen: no paint');
    m.r.destroy();
  });
});

test('7a review 2 #4 (the lead\'s decision): SYNC on and a song loop shorter than the machine\'s cycle (AB / the auto fills / a rhythm track) → a one-line hint in the extras strip after DEMO, hidden otherwise; the host\'s loop() repaints', () => {
  const BAR = 3840, L4 = { loop: true, ls: 0, le: BAR * 4 }, D0 = DC.normDrum(undefined), ui = (u, x) => DC.normDrum(Object.assign(clone(D0), { ui: Object.assign({}, D0.ui, u), x: Object.assign({}, D0.x, x || {}) }));
  const FILL = 'Loop is shorter than the fill cycle — fills fall outside it';
  assert.equal(CD.loopHint(D0, L4), null, 'pattern 1 A, manual fills: a one-measure cycle');
  assert.equal(CD.loopHint(ui({ fill: 3 }), L4), FILL, 'AUTO FILL IN 8 over a 4-bar loop');
  assert.equal(CD.loopHint(ui({ fill: 3 }), { loop: true, ls: BAR * 2, le: BAR * 10 }), null, 'an 8-bar loop holds the cycle');
  assert.equal(CD.loopHint(ui({ fill: 4, bvar: 1 }), L4), FILL, 'AB + fills every 4: an 8-measure cycle');
  assert.equal(CD.loopHint(ui({ fill: 3 }), Object.assign({}, L4, { loop: false })), null, 'no loop');
  assert.equal(CD.loopHint(ui({ fill: 3 }, { sync: false }), L4), null, 'SYNC off: the machine runs on its own');
  assert.equal(CD.loopHint(ui({ bvar: 1 }), { loop: true, ls: 0, le: BAR }), 'Loop is shorter than the A / B cycle — B falls outside it');
  const T = clone(ui({ mode: DC.M_PLAY, inst: 2 })); for (let i = 0; i < 6; i++) T.rt[128 + i] = 0; T.rtEnd[2] = 133;
  assert.equal(CD.loopHint(DC.normDrum(T), L4), 'Loop is shorter than the rhythm track — its end falls outside it');
  assert.equal(CD.loopHint(ui({ fill: 3 }), null), null, 'a host without a loop');
  withRaf(() => {
    const m = mount(true), demo = W(m.root, 'dr:demo'), hint = demo.parentNode.childNodes.find(n => cls(n) === 'dr-hint');
    assert.ok(hint, 'the hint sits in the DEMO cell, after the button');
    assert.equal(hint.hidden, true, 'no loop: hidden');
    m.R.loop = L4; m.api.drum.press({ k: 'fill', v: 3 }); rafQ.flush();
    assert.deepEqual([hint.hidden, hint.textContent], [false, FILL]);
    m.R.loop = Object.assign({}, L4, { le: BAR * 8 }); m.H.loop(); rafQ.flush();
    assert.equal(hint.hidden, true, 'the loop grew to 8 bars: the host\'s loop() repainted it hidden');
    m.r.destroy();
    const s = mount(false), h2 = W(s.root, 'dr:demo').parentNode.childNodes.find(n => cls(n) === 'dr-hint');
    assert.equal(!!h2 && h2.hidden, true, 'a stub host: the same node, hidden');
    s.r.destroy();
  });
});

test('7a without api.drum (a stub host, the tests\' default): the same nodes, no listeners, aria-disabled; deterministic with and without a host', () => {
  const ser = n => n.localName + '.' + cls(n) + '[' + ['data-ctl', 'data-n', 'data-sound', 'role', 'aria-label', 'data-gesture'].map(a => n.getAttribute(a)).join('|') + ']' + JSON.stringify(n.style) + '(' + n.childNodes.filter(c => c.nodeType === 1).map(ser).join(',') + ')';
  withRaf(() => {
    const A = mount(false), B = mount(true);
    assert.equal(ser(A.root), ser(B.root), 'the same nodes');
    const ids = ['dr:mode', 'dr:tempo', 'dr:bvar', 'dr:start', 'dr:tap', 'dr:clear', 'dr:sync', 'dr:swing', 'dr:demo'];
    for (const id of ids) {
      const el = W(A.root, id);
      assert.deepEqual([el.getAttribute('aria-disabled'), el.listenerCount('pointerdown') + el.listenerCount('pointerup') + el.listenerCount('keydown')], ['true', 0], id);
    }
    const keys = stepKeys(A.root), cv = W(A.root, 'dr:grid').childNodes[0], g = W(A.root, 'dr:pads');
    assert.deepEqual([keys.every(k => k.getAttribute('aria-disabled') === 'true' && k.listenerCount('pointerup') === 0), cv.getAttribute('aria-disabled'), cv.listenerCount('pointerdown'), g.listenerCount('pointerdown'), g.childNodes.every(p => p.getAttribute('aria-disabled') === 'true')], [true, 'true', 0, 0, true]);
    assert.equal(keys[0].getAttribute('data-lit'), 'flash', 'the defaults painted');
    assert.equal(ser(A.root), ser(mount(false).root), 'deterministic (no host)');
    assert.equal(ser(B.root), ser(mount(true).root), 'deterministic (a host)');
    A.r.destroy(); B.r.destroy();
  });
});

test('7a destroy → release: a held pad\'s off once, a held CLEAR dropped (no clear), the host\'s release-all the same; unhooked from the host', () => {
  withRaf(() => {
    const m = mount(true), g = W(m.root, 'dr:pads'), bd = g.childNodes.find(p => p.getAttribute('data-sound') === 'bd'), clear = W(m.root, 'dr:clear');
    placeEl(bd, 0, 0, 52, 52);
    fire(bd, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientY: 40, button: 0 });
    fire(clear, 'pointerdown', { pointerId: 2, button: 0 });
    m.H.release();
    assert.deepEqual([m.R.notes.map(x => x[0] + x[1]).join(' '), clear.getAttribute('aria-pressed'), m.presses.length], ['on36 off36', 'false', 0], 'the host\'s release-all (panic, power off, a hidden page)');
    fire(bd, 'pointerup', { pointerId: 1 }); fire(clear, 'pointerup', { pointerId: 2 });
    assert.deepEqual([m.R.notes.length, m.presses.length], [2, 0], 'a stale lift after the release posts nothing');
    fire(bd, 'pointerdown', { pointerId: 3, pointerType: 'touch', clientY: 40, button: 0 });
    m.r.destroy();
    assert.deepEqual(m.R.notes.map(x => x[0] + x[1]).join(' '), 'on36 off36 on36 off36', 'destroy: its off');
    const pend = rafQ.pending; m.H.changed(m.tr); m.H.release();
    assert.deepEqual([rafQ.pending, m.R.notes.length], [pend, 4], 'unhooked: no paint, no release');
  });
});

test('7a the popovers: → Piano roll (1, 2, 4, 8, 16 bars, the pattern\'s length), MAP… (learn, notes, none, reset), SOUNDS… (circuit | your sound, load, remove), DEMO (confirmed over a pattern), SYNC / REC / SWING', async () => {
  rafQ.install();
  try {
    const m = mount(true), tapB = el => ptr(el, 'pointerup', 0, 0);
    const items = () => all(m.doc.body).filter(n => cls(n) === 'wk-ci' || /wk-ci /.test(cls(n)));
    const label = n => n.childNodes[1].textContent;
    const pick = text => { const it = items().find(n => label(n).startsWith(text)); assert.ok(it, text + ' in ' + items().map(label).join(' | ')); fire(it, 'pointerdown'); it.click(); };
    tapB(W(m.root, 'dr:toRoll'));
    assert.deepEqual(items().map(label), ['1 bar', '2 bars', '4 bars (default)', '8 bars', '16 bars', 'The pattern\'s length (1 bar)']);
    pick('8 bars');
    assert.equal(m.R.log.at(-1), 'toRoll 8');
    tapB(W(m.root, 'dr:map'));
    assert.equal(items().length, 17);
    assert.equal(label(items()[1]), 'Snare · 38 (D2), 40 (E2)', 'the app\'s naming (C4 = 60)');
    pick('Snare'); pick('Learn');
    m.R.learn(41);
    assert.deepEqual(m.R.D.map.sd, [41, 38, 40], 'learnt: the primary, the old notes after it (41 left the low tom)');
    assert.deepEqual(m.R.D.map.lt, [43]);
    tapB(W(m.root, 'dr:map')); pick('Reset');
    assert.deepEqual([m.R.D.map.sd, m.R.D.map.lt], [[38, 40], [41, 43]]);
    tapB(W(m.root, 'dr:sounds')); pick('Kick'); pick('Load');
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(m.R.D.smp.bd, { id: 'smp:0123456789abcdef', name: 'my bd', on: true });
    rafQ.flush();
    const bd = W(m.root, 'dr:pads').childNodes.find(p => p.getAttribute('data-sound') === 'bd');
    assert.deepEqual([bd.getAttribute('data-smp'), bd.getAttribute('title')], ['', 'Kick · your sound: my bd'], 'a loaded slot: the pad\'s dot');
    tapB(W(m.root, 'dr:sounds')); pick('Kick'); pick('Circuit');
    assert.equal(m.R.D.smp.bd.on, false);
    tapB(W(m.root, 'dr:sounds')); pick('Kick'); pick('✕');
    assert.equal(m.R.D.smp.bd, undefined);
    // DEMO: straight into an empty key; over a pattern only when confirmed
    tapB(W(m.root, 'dr:demo'));
    assert.equal(m.R.D.st[0].some(x => x), true, 'the demo pattern');
    const st0 = m.R.D.st; m.R.confirm = false; m.api.drum.press({ k: 'undo' }); m.api.drum.press({ k: 'grid', lane: 1, s: 0 });
    const st1 = m.R.D.st; tapB(W(m.root, 'dr:demo'));
    assert.equal(m.R.D.st, st1, 'refused: unchanged');
    assert.notEqual(st0, st1);
    // SYNC, REC, SWING
    tapB(W(m.root, 'dr:sync')); tapB(W(m.root, 'dr:rec')); rafQ.flush();
    assert.deepEqual([m.R.D.x.sync, W(m.root, 'dr:sync').textContent, W(m.root, 'dr:sync').getAttribute('aria-pressed'), m.R.D.x.rec, W(m.root, 'dr:rec').getAttribute('aria-pressed')], [false, 'Sync · own', 'false', true, 'true']);
    const sw = W(m.root, 'dr:swing');
    key(sw, 'ArrowUp'); key(sw, 'ArrowUp'); rafQ.flush();
    assert.deepEqual([m.R.D.x.swing, sw.getAttribute('aria-valuetext'), sw.childNodes[1].textContent], [52, '52 %', '52 %']);
    m.r.destroy();
  } finally { rafQ.uninstall(); }
});

/* ================================================================ 7b phase 2: the TR-606's widgets and host (IMPL-7b §7.4, §12.7) */
// the presses a 606 panel made, as short words ("fn down", "key 7 down shift", "release")
const words = m => m.presses.splice(0).map(x => { const o = JSON.parse(x); return [o.k, o.n, o.down === true ? 'down' : o.down === false ? 'up' : '', o.shift ? 'shift' : ''].filter(v => v !== undefined && v !== '').join(' '); });
const dn = (el, id, o = {}) => fire(el, 'pointerdown', Object.assign({ pointerId: id, button: 0, pointerType: 'touch' }, o));
const upP = (el, id, o = {}) => fire(el, 'pointerup', Object.assign({ pointerId: id, pointerType: 'touch' }, o));
const leds6 = root => all(root).filter(n => cls(n) === 'hw-led hw-show dr-led');

test('7b drumHost: the session follows the record\'s machine (review #16) — initState(D.m), and changed() with the other machine\'s record starts a fresh one (the transport kept); TAP\'s fraction at the 606\'s own BPM; SYNC 303s → the host\'s link303 with the 606\'s swing, n303(), link303() repaints; the demo\'s confirm names I-1 / I-2', () => {
  const { tr, R, H } = rig({ model: 'tr606' }), A = H.api(tr);
  assert.deepEqual([Array.isArray(A.state().S.held), A.state().D.m, A.state().S.bar], [true, 'tr606', -1], 'a 606 session');
  let n = 0; A.on(() => n++);
  R.playing = true; H.transport(true);
  R.D = DC.normDrum(undefined); H.changed(tr); // (an 808 ↔ 606 Replace undone: the 808's record under the same view)
  assert.deepEqual([Array.isArray(A.state().S.held), 'tap' in A.state().S, A.state().S.play, n], [false, true, true, 2], 'a fresh 808 session, playing');
  R.D = DC.normDrum(undefined, 'tr606'); H.changed(tr);
  assert.deepEqual([Array.isArray(A.state().S.held), A.state().S.play], [true, true], 'and back');
  const S0 = A.state().S; H.changed(tr);
  assert.equal(A.state().S, S0, 'the same machine: the session kept');
  // TAP in PATTERN WRITE, free at 150 BPM (20 frames a tick, a sixteenth 4800 frames): the nearest step from the 606's tempo
  const T = rig({ model: 'tr606' }), B = T.H.api(T.tr);
  B.press({ k: 'sync', v: false }); B.press({ k: 'tempo', v: 150 }); B.press({ k: 'mode', v: DC.M6_PW }); B.press({ k: 'start' });
  assert.deepEqual([B.state().run, T.R.D.ui.tempo], [true, 150]);
  T.H.step(T.tr, 'i1', { s: 3, m: 0, k: 0, v: 0, p: 0, o: 720, M: 0, F: 48000 });
  T.R.heard = 48000 + 2000; B.tap(1);
  assert.deepEqual([(T.R.D.st[0][3] >> 1) & 1, (T.R.D.st[0][4] >> 1) & 1], [1, 0], '0.42 of step 4: step 4 (BD, the instrument)');
  T.R.heard = 48000 + 3200; B.tap(2);
  assert.equal((T.R.D.st[0][4] >> 1) & 1, 1, '0.67: step 5');
  // SYNC 303s
  B.press({ k: 'swing', v: 62 }); B.link();
  assert.equal(T.R.log.at(-1), 'link303 ' + DC.swing303(62), 'the host\'s link303 with the 303s\' swing');
  assert.deepEqual(B.n303(), { n: 0, synced: true }, 'no answer: no 303');
  T.R.n303 = { n: 2, synced: false }; assert.deepEqual(B.n303(), { n: 2, synced: false });
  T.R.n303 = 'x'; assert.deepEqual(B.n303(), { n: 0, synced: true });
  let k = 0; B.on(() => k++); T.H.link303(); assert.equal(k, 1, 'link303(): the panels repaint');
  // DEMO over a pattern that is not empty: confirmed first, naming the 606's patterns
  T.R.confirm = false; const st0 = T.R.D.st; B.demo();
  assert.deepEqual([T.R.D.st === st0, /patterns I-1 and I-2/.test(T.R.asked)], [true, true]);
});

test('7b render with api.drum (a fixture TR-606 face): the 16 step keys (data-lit from leds(): stopped PATTERN PLAY, I-1 flashing), MODE (4, its dial turned by rot), TRACK / INSTRUMENT (8), SCALE (a vertical switch, 4 at the top), TEMPO (BPM 40–300), the group and RUN LEDs, FUNCTION / CLEAR / PATTERN GROUP / RUN/STOP / TAP; the extras (the grid 592 × 192, the 2 × 4 pads with AC, SYNC 303s hidden with no 303); the DOM budget', () => {
  withRaf(() => {
    const m = mount(true, { six: true }), keys = stepKeys(m.root);
    assert.deepEqual([keys.length, keys.map(k => k.getAttribute('data-lit')).join(' ')], [16, ['flash', ...Array(15).fill('off')].join(' ')]);
    assert.deepEqual([keys[0].getAttribute('aria-label'), keys[0].getAttribute('data-gesture'), keys[0].getAttribute('aria-keyshortcuts'), keys[3].getAttribute('data-led'), keys[0].getAttribute('aria-current'), cls(keys[0])],
      ['Step 1', 'music', 'Shift+Enter Alt+Enter', 'above', 'true', 'hw-btn dr-key']);
    const mode = W(m.root, 'dr:mode'), inst = W(m.root, 'dr:inst'), sc = W(m.root, 'dr:sc'), tempo = W(m.root, 'dr:tempo');
    const rotT = el => all(el).find(n => cls(n) === 'rot').getAttribute('transform');
    assert.deepEqual([mode.getAttribute('aria-valuenow'), mode.getAttribute('aria-valuemax'), mode.getAttribute('aria-valuetext'), rotT(mode)], ['2', '3', 'Pattern play', 'rotate(97 32 32)'], 'PATTERN PLAY: +37° + 2 × 30°');
    assert.deepEqual([inst.getAttribute('aria-valuemax'), inst.getAttribute('aria-valuetext'), rotT(inst)], ['7', 'Kick', 'rotate(-75 32 32)']);
    assert.deepEqual([cls(sc), sc.getAttribute('data-orient'), sc.getAttribute('aria-valuemax'), sc.getAttribute('aria-valuenow'), sc.getAttribute('aria-valuetext'), sc.getAttribute('data-pos')],
      ['hw-sw dr-sw', 'v', '3', '3', '1 · sixteenths', '3'], 'SCALE 1: the bottom position');
    assert.deepEqual([cls(tempo), tempo.getAttribute('aria-valuetext'), tempo.getAttribute('aria-valuemin'), tempo.getAttribute('aria-valuemax'), tempo.getAttribute('aria-valuenow')], ['knob hw-tempo dr-tempo', '120 BPM', '40', '300', '120']);
    assert.deepEqual(leds6(m.root).map(n => n.getAttribute('aria-label')), ['Pattern group I: lit', 'Pattern group II: off', 'Run: off']);
    const lab = id => W(m.root, id).getAttribute('aria-label');
    assert.deepEqual(['dr:fn', 'dr:clear', 'dr:grp', 'dr:start', 'dr:tap'].map(lab), ['Function', 'Clear / reset', 'Pattern group · I', 'Run / stop', 'Tap']);
    for (const id of ['dr:fn', 'dr:clear', 'dr:grp', 'dr:start', 'dr:tap']) assert.equal(W(m.root, id).localName, 'button', id);
    assert.deepEqual([W(m.root, 'dr:fn').getAttribute('data-gesture'), W(m.root, 'dr:clear').getAttribute('data-gesture'), W(m.root, 'dr:fn').getAttribute('aria-pressed')], ['music', 'music', 'false']);
    for (const id of DR6_FACE.filter(t => !/Led$|grpI/.test(t))) assert.equal(byCtl(m.root, id)[0].getAttribute('data-nomod'), '1', id + ': no modulation target (§9)');
    for (const id of DR6_EXTRAS) assert.equal(byCtl(m.root, id).length, 1, id);
    const grid = W(m.root, 'dr:grid'), cv = grid.childNodes[0], pads = W(m.root, 'dr:pads');
    assert.deepEqual([cv.style.width, cv.style.height, grid.style.width, grid.style.height], ['592px', '192px', '592px', '192px']);
    assert.deepEqual([pads.childNodes.map(p => p.getAttribute('data-sound')).join(' '), pads.style.height, pads.childNodes[4].style.top, pads.childNodes[4].style.height, pads.getAttribute('data-gesture')],
      [CD.PAD6.join(' '), '116px', '66px', '50px', 'music']); // ((7b review 2 #4) 8 + 50 + 8)
    const link = W(m.root, 'dr:link');
    assert.deepEqual([link.textContent, link.hidden], ['Sync 303s', true], 'no TB-303 in the project: hidden');
    assert.deepEqual(['dr:sync', 'dr:toRoll', 'dr:rec', 'dr:map', 'dr:sounds', 'dr:demo'].map(id => W(m.root, id).textContent), ['Sync · song', '→ Piano roll', 'Rec', 'Map…', 'Sounds…', 'Demo']);
    assert.match(W(m.root, 'dr:sync').title, /the 606 follows the song \(RUN\/STOP is ▶/);
    assert.match(W(m.root, 'dr:toRoll').title, /the 606's own sequencer/);
    // the DOM budget (§7.4: the module ≤ 700): the live layer + the face SVG's elements (the fixture's face is spare: the
    // authored face is measured in headless Chrome)
    const face = (String(all(m.root).find(n => cls(n) === 'hw-decor').innerHTML).match(/<[a-z][^>]*>/g) || []).length, live = all(m.root).length;
    assert.ok(live + face <= 700 && live < 200, `${live} + ${face}`);
    m.r.destroy();
  });
});

test('7b widgets: FUNCTION held + a key → fn down, key down, key up, fn up in that order (running PATTERN WRITE: LAST STEP); CLEAR held + a held key → PATTERN CLEAR (stopped PATTERN WRITE, either order); two keys of one block → a chain, of two blocks → two selections; Shift / Alt with the mouse; Enter / Space held', () => {
  withRaf(() => {
    const m = mount(true, { six: true }), keys = stepKeys(m.root), fn = W(m.root, 'dr:fn'), clr = W(m.root, 'dr:clear'), A = m.api.drum;
    A.press({ k: 'sync', v: false }); A.press({ k: 'mode', v: DC.M6_PW }); A.press({ k: 'start' }); m.presses.length = 0;
    assert.equal(A.state().run, true);
    dn(fn, 1); rafQ.flush();
    assert.equal(fn.getAttribute('aria-pressed'), 'true', 'FUNCTION held');
    dn(keys[6], 2); upP(keys[6], 2); upP(fn, 1); rafQ.flush();
    assert.deepEqual(words(m), ['fn down', 'key 7 down', 'key 7 up', 'fn up']);
    assert.deepEqual([m.R.D.keys[0].l1, fn.getAttribute('aria-pressed')], [7, 'false'], 'LAST STEP 7 of I-1');
    // stopped PATTERN WRITE: a held key + CLEAR = PATTERN CLEAR of that pattern (steps only), either order
    A.press({ k: 'start' });
    m.R.D = Object.assign({}, m.R.D, { st: m.R.D.st.map((r, p) => (p === 2 || p === 3 ? r.map(() => 2) : r)) });
    m.presses.length = 0;
    dn(keys[2], 3); dn(clr, 4); upP(clr, 4); upP(keys[2], 3);
    assert.deepEqual(words(m), ['key 3 down', 'clr down', 'clr up', 'key 3 up']);
    assert.deepEqual([m.R.D.st[2].every(x => !x), m.R.D.st[3][0], m.R.notices.at(-1).text], [true, 2, 'Pattern I-3 cleared · tap to undo']);
    dn(clr, 4); dn(keys[3], 5); upP(keys[3], 5); upP(clr, 4);
    assert.equal(m.R.D.st[3].every(x => !x), true, 'CLEAR held first, then the key');
    // PATTERN PLAY, stopped: two keys held in one block chain them; in two blocks the last one stands
    A.press({ k: 'mode', v: DC.M6_PP });
    dn(keys[4], 6); dn(keys[6], 7); upP(keys[4], 6); upP(keys[6], 7);
    assert.deepEqual([m.R.D.ui.sel, m.R.D.ui.cl], [4, 2], 'keys 5 and 7 held: the chain 5–7');
    dn(keys[3], 8); dn(keys[5], 9); upP(keys[5], 9); upP(keys[3], 8);
    assert.deepEqual([m.R.D.ui.sel, m.R.D.ui.cl], [5, 0], 'keys 4 and 6 (two blocks): two selections');
    // the mouse: Shift-click chains to the selection's first; Alt + a key = FUNCTION + key (held while Alt is)
    const click = (el, id, o = {}) => { fire(el, 'pointerdown', Object.assign({ pointerId: id, button: 0, pointerType: 'mouse' }, o)); fire(el, 'pointerup', Object.assign({ pointerId: id, pointerType: 'mouse' }, o)); };
    click(keys[8], 20); click(keys[10], 21, { shiftKey: true }); rafQ.flush();
    assert.deepEqual([m.R.D.ui.sel, m.R.D.ui.cl, keys.slice(8, 12).map(k => k.getAttribute('data-lit')).join(' ')], [8, 2, 'flash on on off'], 'Shift-click: the chain 9–11, the first flashing');
    A.press({ k: 'mode', v: DC.M6_PW }); A.press({ k: 'start' }); m.presses.length = 0;
    click(keys[11], 22, { altKey: true });
    assert.deepEqual(words(m), ['fn down', 'key 12 down', 'key 12 up'], 'Alt still down: FUNCTION held');
    fire(m.doc, 'keyup', { key: 'Alt' });
    assert.deepEqual([words(m), m.R.D.keys[8].l1], [['fn up'], 12], 'Alt let go: FUNCTION up; LAST STEP 12 of the edited I-9');
    fire(keys[4], 'pointerdown', { pointerId: 23, button: 0, pointerType: 'mouse', altKey: true }); fire(keys[4], 'pointerup', { pointerId: 23, pointerType: 'mouse' });
    assert.deepEqual(words(m), ['fn down', 'key 5 down', 'key 5 up', 'fn up'], 'Alt let go before the button: FUNCTION up after the key');
    fire(m.doc, 'keyup', { key: 'Alt' });
    assert.deepEqual(words(m), [], 'nothing left held');
    // the keyboard: Enter / Space held on a key and on FUNCTION
    key(keys[1], 'Enter'); key(keys[1], 'Enter', { repeat: true }); fire(keys[1], 'keyup', { key: 'Enter' });
    assert.deepEqual(words(m), ['key 2 down', 'key 2 up'], 'one down, one up (the repeat ignored)');
    key(fn, ' '); key(keys[2], ' ', { shiftKey: true }); fire(keys[2], 'keyup', { key: ' ' }); fire(fn, 'keyup', { key: ' ' });
    assert.deepEqual(words(m), ['fn down', 'key 3 down shift', 'key 3 up', 'fn up']);
    m.r.destroy();
  });
});

test('7b widgets: a cancelled hold sends no action — FUNCTION with a bar typed on the keypad, cancelled (a pointercancel, a lost capture, a keyboard hold blurred, the host\'s release-all) sends { k: \'release\' } and no locate; released normally it locates; RUN/STOP and PATTERN GROUP on a tap; destroy → release', () => {
  withRaf(() => {
    const m = mount(true, { six: true }), keys = stepKeys(m.root), fn = W(m.root, 'dr:fn'), A = m.api.drum;
    A.press({ k: 'mode', v: DC.M6_TW }); m.presses.length = 0; // (stopped TRACK WRITE, track 2: FUNCTION + keys = the bar keypad)
    const bar = () => A.state().S.bar, type = (id, end) => { dn(fn, id); dn(keys[4], id + 1); upP(keys[4], id + 1); end(); };
    type(1, () => fire(fn, 'pointercancel', { pointerId: 1 }));
    assert.deepEqual([words(m), bar(), A.state().S.fn, A.state().S.loc], [['fn down', 'key 5 down', 'key 5 up', 'release'], -1, false, null], 'a pointercancel: no locate');
    upP(fn, 1);
    assert.deepEqual(words(m), [], 'its stale up: nothing');
    type(3, () => fire(fn, 'lostpointercapture', { pointerId: 3 }));
    assert.deepEqual([words(m).at(-1), bar()], ['release', -1], 'a lost capture');
    key(fn, 'Enter'); key(keys[4], 'Enter'); fire(keys[4], 'keyup', { key: 'Enter' }); fire(fn, 'blur');
    assert.deepEqual([words(m).at(-1), bar()], ['release', -1], 'a keyboard hold blurred');
    dn(fn, 5); dn(keys[4], 6); m.H.release();
    assert.deepEqual([words(m).at(-1), bar(), A.state().S.held.length], ['release', -1, 0], 'the host\'s release-all (a hidden page, panic)');
    upP(keys[4], 6); upP(fn, 5);
    assert.deepEqual(words(m), [], 'the lifts after it: nothing');
    type(7, () => upP(fn, 7));
    assert.equal(bar(), DC.track606(m.R.D, 1).start + 4, 'released: FUNCTION + 5 locates bar 5 of track 2');
    // RUN/STOP and PATTERN GROUP act on a tap (review 2 #1 / #2: A.tap, the 808's START's)
    words(m);
    dn(W(m.root, 'dr:grp'), 9); upP(W(m.root, 'dr:grp'), 9); dn(W(m.root, 'dr:start'), 10); upP(W(m.root, 'dr:start'), 10);
    assert.deepEqual(words(m), ['grp', 'start']);
    assert.deepEqual([m.R.D.tg[1], m.R.log.at(-1)], [1, 'play'], 'stopped TRACK WRITE: the track\'s group II; RUN synced: the project\'s ▶');
    // destroy → release: a held FUNCTION and a held key let go, once
    dn(fn, 11); dn(keys[0], 12); words(m);
    m.r.destroy();
    assert.deepEqual(words(m), ['release']);
    upP(fn, 11);
    assert.deepEqual(words(m), [], 'after destroy: nothing');
  });
});

test('7b the grid: 8 rows (AC … CH on the 808\'s lane bits) hit-tested at 3 zooms; a tap toggles that lane of the shown pattern, a header mutes / solos its lane bit; the keyboard; the cells past LAST STEP dimmed; a 592 × 192 store', () => {
  for (const [x, y, want] of [[0, 0, '{"corner":true}'], [48, 10, '{"top":true,"s":0}'], [591, 191, '{"lane":11,"row":7,"s":15}'], [47, 32, '{"head":true,"lane":0,"row":0}'], [48 + 5 * 34 + 1, 32 + 4 * 20 + 1, '{"lane":5,"row":4,"s":5}']]) assert.equal(JSON.stringify(CD.gridAt606(x, y)), want, x + ',' + y);
  assert.deepEqual([CD.gridAt606(-1, 5), CD.gridAt606(592, 5)], [null, null]);
  assert.deepEqual([CD.GRID6.w, CD.GRID6.h, CD.PADS6.w, CD.PADS6.h].join(), [P.DR6_GRID.w, P.DR6_GRID.h, P.DR6_PADS.w, P.DR6_PADS.h].join(), 'the cells = cv-panel\'s');
  assert.deepEqual([CD.GRID6.head + 16 * CD.GRID6.col, CD.GRID6.top + 8 * CD.GRID6.row, 4 * CD.PADS6.pad + 3 * CD.PADS6.gap, CD.PADS6.top + 2 * CD.PADS6.ph + CD.PADS6.gap], [592, 192, 232, 116]);
  assert.deepEqual([CD.UI.tr606.lanes, CD.UI.tr606.codes, CD.UI.tr808.lanes.length, CD.UI.tr808.dial, CD.UI.tr606.dial], [DC.LANES606, DC.CODES606, 12, CD.DIAL, CD.DIAL6]);
  withRaf(() => {
    const m = mount(true, { six: true }), cv = W(m.root, 'dr:grid').childNodes[0];
    layoutEl(cv, 592, 192);
    const pat = () => DC.gridPat(m.api.drum.state().S, m.R.D), bit = (l, s) => (m.R.D.st[pat()][s] >> l) & 1;
    const hitAt = (k, row, s) => {
      placeEl(cv, 100, 50, 592 * k, 192 * k);
      const X = 100 + (48 + s * 34 + 17) * k, Y = 50 + (32 + row * 20 + 10) * k;
      fire(cv, 'pointerdown', { pointerType: 'touch', pointerId: 3, clientX: X, clientY: Y, button: 0, timeStamp: 0 });
      fire(cv, 'pointerup', { pointerType: 'touch', pointerId: 3, clientX: X, clientY: Y, timeStamp: 10 });
    };
    for (const [k, row, s] of [[0.5, 4, 5], [1, 7, 15], [2, 0, 0]]) { hitAt(k, row, s); assert.equal(bit(DC.LANES606[row], s), 1, `k ${k}: row ${row} (lane ${DC.LANES606[row]}) step ${s + 1}`); }
    hitAt(1, 4, 5); assert.equal(bit(5, 5), 0, 'a second tap clears it');
    const head = (row, up) => { placeEl(cv, 0, 0, 592, 192); const Y = 32 + row * 20 + 10; fire(cv, 'pointerdown', { pointerType: 'touch', pointerId: 4, clientX: 20, clientY: Y, button: 0, timeStamp: 0 }); fire(cv, 'pointerup', { pointerType: 'touch', pointerId: 4, clientX: 20, clientY: Y, timeStamp: up }); };
    head(5, 100); assert.equal(m.R.D.x.mute, 1 << 9, 'CY (row 6): its lane bit 9 muted');
    head(6, 700); assert.equal(m.R.D.x.solo, 1 << 10, 'held: OH soloed');
    fire(cv, 'focus'); key(cv, 'ArrowDown'); key(cv, 'ArrowDown'); key(cv, 'ArrowRight'); key(cv, ' ');
    assert.equal(bit(10, 6), 1, 'from the cell tapped last (HT step 6): OH (row 7), step 7');
    for (let i = 0; i < 9; i++) key(cv, 'ArrowDown');
    key(cv, 'm'); assert.equal((m.R.D.x.mute >> 11) & 1, 1, 'the arrows stop at CH, its lane 11 muted');
    rafQ.flush();
    assert.match(cv.getAttribute('aria-label'), /^Step grid · pattern I-1 · CH step 7 off$/);
    // the cells past LAST STEP dimmed: a recording context sees each cell's fill
    const rec = [];
    cv._ctx = new Proxy({ calls: [], canvas: cv }, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return s => ({ width: String(s).length * 6 }); if (typeof k === 'symbol') return undefined; return (...a) => { if (k === 'fillRect') rec.push([t.fillStyle, ...a]); t.calls.push([k, ...a]); }; }, set(t, k, v) { t[k] = v; return true; } });
    m.R.D = Object.assign({}, m.R.D, { keys: m.R.D.keys.map((K, i) => (i ? K : Object.assign({}, K, { l1: 8 }))) }); m.H.changed(m.tr); rafQ.flush();
    const cell = (row, s) => rec.find(r => r[1] === 48 + s * 34 + 1 && r[2] === 32 + row * 20 + 1);
    assert.deepEqual([cell(2, 7)[0], cell(2, 8)[0], cell(2, 12)[0]], ['#1a1d22', '#121418', '#121418'], 'step 8 in, 9 and 13 past LAST STEP 8');
    assert.deepEqual([cv.width, cv.height], [592, 192]);
    m.r.destroy();
  });
});

test('7b pads: 2 × 4 (CY OH CH AC over BD SD LT HT) in a music zone; AC is a hold — a hit while it is held plays at 127, AC itself no note; two fingers two hits; the keyboard holds AC too; the host\'s release-all lets it go', () => {
  withRaf(() => {
    const m = mount(true, { six: true }), g = W(m.root, 'dr:pads'), pad = s => g.childNodes.find(p => p.getAttribute('data-sound') === s);
    for (const p of g.childNodes) placeEl(p, 0, 0, 52, 54);
    assert.deepEqual([g.childNodes.length, pad('ac').getAttribute('data-code'), pad('ac').getAttribute('aria-pressed'), pad('bd').getAttribute('data-name'), pad('ht').getAttribute('data-code'), g.childNodes.every(p => !p.childNodes.length)],
      [8, 'AC', 'false', 'Kick', 'HT', true]);
    fire(pad('sd'), 'pointerdown', { pointerId: 1, pointerType: 'touch', clientY: 0, button: 0 });
    fire(pad('ac'), 'pointerdown', { pointerId: 2, pointerType: 'touch', clientY: 0, button: 0 });
    fire(pad('bd'), 'pointerdown', { pointerId: 3, pointerType: 'touch', clientY: 0, button: 0 });
    assert.deepEqual(m.R.notes, [['on', 38, 0.3], ['on', 36, 1]], 'AC held: the kick at 127 though touched at the back; AC plays nothing');
    assert.deepEqual([pad('ac').getAttribute('aria-pressed'), pad('ac').getAttribute('data-held')], ['true', '']);
    fire(pad('ac'), 'pointerup', { pointerId: 2 });
    fire(pad('lt'), 'pointerdown', { pointerId: 4, pointerType: 'touch', clientY: 27, button: 0 });
    assert.deepEqual(m.R.notes.at(-1), ['on', 41, r3(CD.padVel(0.5))], 'AC let go: from where the pad is touched');
    fire(pad('sd'), 'pointerup', { pointerId: 1 }); fire(pad('bd'), 'pointerup', { pointerId: 3 }); fire(pad('lt'), 'lostpointercapture', { pointerId: 4 });
    assert.deepEqual(m.R.notes.slice(3).map(x => x.join(' ')), ['off 38', 'off 36', 'off 41']);
    key(pad('ac'), ' '); key(pad('ch'), 'Enter');
    assert.deepEqual(m.R.notes.at(-1), ['on', 42, 1], 'Space held on AC: Enter on CH at 127');
    fire(pad('ch'), 'keyup', { key: 'Enter' }); fire(pad('ac'), 'keyup', { key: ' ' });
    assert.equal(pad('ac').getAttribute('aria-pressed'), 'false');
    key(pad('bd'), 'ArrowUp');
    assert.deepEqual([pad('bd').getAttribute('tabindex'), pad('cy').getAttribute('tabindex')], ['-1', '0'], 'the arrows move along the 2 × 4');
    const was = pad('oh').getAttribute('data-hit');
    m.R.heard = NaN; m.H.mon(m.tr, { lit: 1 << 9, F: 0 }); m.frame();
    assert.notEqual(pad('oh').getAttribute('data-hit'), was, 'the monitor lights the open hat (sound 9)');
    fire(pad('ac'), 'pointerdown', { pointerId: 5, pointerType: 'touch', clientY: 0, button: 0 }); m.H.release();
    assert.deepEqual([pad('ac').getAttribute('aria-pressed'), pad('ac').getAttribute('data-held')], ['false', null]);
    m.r.destroy();
  });
});

test('7b the LEDs at the heard time, ≤ 1 paint a frame: running PATTERN PLAY the chase; PATTERN WRITE the instrument\'s steps with the playhead inverted, FUNCTION held the beat markers; the RUN LED; PATTERN CLEAR\'s group flash; SYNC 303s shown with a 303, "303s synced" (disabled) when all are, repainted by the host\'s link303()', () => {
  withRaf(() => {
    const m = mount(true, { six: true }), keys = stepKeys(m.root), lit = () => keys.map(k => k.getAttribute('data-lit')), leds = () => leds6(m.root).map(n => n.getAttribute('data-lit')).join(' ');
    m.R.playing = true; m.H.transport(true); m.R.heard = 0;
    m.H.step(m.tr, 'i1', { s: 0, m: 0, k: 0, v: 0, p: 0, o: 0, M: 0, F: 5000 }); m.frame(); rafQ.flush();
    assert.deepEqual([lit().every(x => x === 'off'), leds()], [true, 'on off on'], 'running, nothing heard yet: the RUN LED lit');
    m.R.heard = 4500;
    const p0 = CD.drumStats.paints;
    for (let s = 1; s < 6; s++) m.H.step(m.tr, 'i1', { s, m: 0, k: 0, v: 0, p: 0, o: 240 * s, M: 0, F: 5000 + s });
    m.frame(); rafQ.flush(); rafQ.flush();
    assert.equal(CD.drumStats.paints - p0, 1, 'six posts in a frame: one paint');
    assert.deepEqual(lit().slice(0, 7), ['off', 'off', 'off', 'off', 'off', 'on', 'off'], 'the chase: step 6 heard');
    const A = m.api.drum;
    A.press({ k: 'mode', v: DC.M6_PW });
    for (const n of [1, 3]) { A.press({ k: 'key', n, down: true }); A.press({ k: 'key', n, down: false }); }
    m.R.heard = NaN; m.H.step(m.tr, 'i1', { s: 2, m: 0, k: 0, v: 0, p: 0, o: 480, M: 0, F: 6000 }); m.frame(); rafQ.flush();
    assert.deepEqual(lit().slice(0, 4), ['on', 'off', 'head-off', 'off'], 'BD\'s steps, the playhead over a set one: dark');
    const fn = W(m.root, 'dr:fn');
    dn(fn, 1); rafQ.flush();
    assert.deepEqual(lit().map((x, j) => (x === 'on' ? j + 1 : 0)).filter(Boolean), [1, 5, 9, 13], 'FUNCTION held: the first step of each beat');
    upP(fn, 1);
    m.H.transport(false);
    A.press({ k: 'key', n: 2, down: true }); A.press({ k: 'clr', down: true }); rafQ.flush();
    assert.equal(leds(), 'flash off off', 'PATTERN CLEAR: group I flashing, RUN off');
    A.press({ k: 'clr', down: false }); A.press({ k: 'key', n: 2, down: false });
    // SYNC 303s
    const link = W(m.root, 'dr:link');
    m.R.n303 = { n: 2, synced: false }; m.H.link303(); rafQ.flush();
    assert.deepEqual([link.hidden, link.textContent, link.getAttribute('aria-disabled'), link.tabIndex], [false, 'Sync 303s', null, 0]);
    ptr(link, 'pointerup', 0, 0);
    assert.equal(m.R.log.at(-1), 'link303 0', 'the 606 at swing 50: the 303s at 0');
    m.R.n303 = { n: 2, synced: true }; m.H.link303(); rafQ.flush();
    assert.deepEqual([link.textContent, link.getAttribute('aria-disabled'), link.tabIndex], ['303s synced', 'true', -1]);
    const n0 = m.R.log.length; ptr(link, 'pointerup', 0, 0);
    assert.equal(m.R.log.length, n0, 'all synced: nothing');
    m.r.destroy();
  });
});

test('7b without api.drum: the same nodes (the 606\'s, over its own fallback record: ctx.model), no listeners, aria-disabled; deterministic; a record of the other machine under a panel shows that panel\'s defaults', () => {
  const ser = n => n.localName + '.' + cls(n) + '[' + ['data-ctl', 'data-n', 'data-sound', 'role', 'aria-label', 'data-gesture'].map(a => n.getAttribute(a)).join('|') + ']' + JSON.stringify(n.style) + '(' + n.childNodes.filter(c => c.nodeType === 1).map(ser).join(',') + ')';
  withRaf(() => {
    const A = mount(false, { six: true }), B = mount(true, { six: true });
    assert.equal(ser(A.root), ser(B.root), 'the same nodes');
    for (const id of ['dr:mode', 'dr:sc', 'dr:tempo', 'dr:start', 'dr:tap', 'dr:clear', 'dr:fn', 'dr:grp', 'dr:sync', 'dr:swing', 'dr:link', 'dr:demo']) {
      const el = W(A.root, id);
      assert.deepEqual([el.getAttribute('aria-disabled'), el.listenerCount('pointerdown') + el.listenerCount('pointerup') + el.listenerCount('keydown')], ['true', 0], id);
    }
    const keys = stepKeys(A.root), g = W(A.root, 'dr:pads');
    assert.deepEqual([keys.every(k => k.getAttribute('aria-disabled') === 'true' && k.listenerCount('pointerdown') === 0), g.listenerCount('pointerdown'), g.childNodes.every(p => p.getAttribute('aria-disabled') === 'true')], [true, 0, true]);
    assert.deepEqual([keys[0].getAttribute('data-lit'), W(A.root, 'dr:mode').getAttribute('aria-valuetext'), W(A.root, 'dr:sc').getAttribute('aria-valuetext')], ['flash', 'Pattern play', '1 · sixteenths'], 'the 606\'s defaults painted');
    assert.equal(ser(A.root), ser(mount(false, { six: true }).root), 'deterministic');
    // an 808 record under the 606's panel (a Replace undone before main re-renders the view): the 606's defaults, no throw
    B.api.drum.press({ k: 'mode', v: DC.M6_TW }); rafQ.flush();
    B.R.D = DC.normDrum(undefined); B.H.changed(B.tr); rafQ.flush();
    assert.equal(W(B.root, 'dr:mode').getAttribute('aria-valuetext'), 'Pattern play');
    const C = mount(true); C.R.D = DC.normDrum(undefined, 'tr606'); C.H.changed(C.tr); rafQ.flush();
    assert.deepEqual([W(C.root, 'dr:mode').getAttribute('aria-valuetext'), stepKeys(C.root)[0].getAttribute('data-lit')], ['Manual play', 'flash'], 'a 606 record under the 808\'s panel: the 808\'s defaults');
    A.r.destroy(); B.r.destroy(); C.r.destroy();
  });
});

/* ================================================================ 7b fixes (reviews 1 + 2, IMPL-7b §14) */
test('7b review 1 #1: the host carries the 606\'s transport sends — ■ ends a D.S. in the worklet too; a seek while playing (transport(true) again) ends TRACK WRITE\'s heard key; the 808\'s transport sends nothing', () => {
  const { tr, R, H } = rig({ model: 'tr606' });
  const rt = R.D.rt.slice(); [0, 1, 2, 3].forEach((k, j) => { rt[j] = k; });
  R.D = { ...R.D, rt, sg: [2, -1, -1, -1, -1, -1, -1, -1], dc: [3, -1, -1, -1, -1, -1, -1, -1], ui: { ...R.D.ui, mode: DC.M6_TP, inst: 0 } };
  R.playing = true; H.transport(true);
  H.press(tr, { k: 'tap' });                      // D.S.: one 'bar' send
  assert.deepEqual([R.sent.slice(-1), H.api(tr).state().S.ds], [['bar'], 1]);
  let n = R.sent.length;
  H.transport(false);
  assert.deepEqual([R.sent.slice(n), H.api(tr).state().S.ds], [['now'], 0], 'the plain track at ■');
  n = R.sent.length; H.transport(true);
  assert.deepEqual(R.sent.slice(n), [], '▶ with nothing to end: nothing sent');
  // TRACK WRITE running: a key heard (twSel) — a seek (main's seek() → transport(true) while playing) ends it
  H.press(tr, { k: 'mode', v: DC.M6_TW }); H.press(tr, { k: 'key', n: 3, down: true }); H.press(tr, { k: 'key', n: 3, down: false });
  assert.deepEqual([JSON.stringify(H.api(tr).state().S.twSel), R.sent.at(-1)], ['{"sel":2,"cl":0}', 'bar']);
  n = R.sent.length; H.transport(true);
  assert.deepEqual([R.sent.slice(n), H.api(tr).state().S.twSel, H.api(tr).state().S.play], [['now'], null, true], 'a seek: the bar\'s own pattern again, still playing');
  // the 808: its 'transport' returns no command
  const E = rig(); E.R.playing = true; E.H.transport(true); E.H.transport(true); E.H.transport(false);
  assert.deepEqual(E.R.sent, []);
});

test('7b review 1 #2: a heard post that wipes (CLEAR held, PATTERN WRITE running) sends the payload', () => {
  const { tr, R, H, frame } = rig({ model: 'tr606' });
  const st = R.D.st.slice(); st[0] = DC.DEMO606.a.slice();
  R.D = { ...R.D, st, ui: { ...R.D.ui, mode: DC.M6_PW, inst: 7 } };
  R.playing = true; H.transport(true); H.press(tr, { k: 'clr', down: true });
  const n = R.sent.length;
  R.heard = 1e9; H.step(tr, null, { t: 'step', s: 1, m: 0, k: 0, v: 0, p: 0, o: 240, M: 0, F: 1000 }); frame();
  assert.deepEqual([(R.D.st[0][1] >> 11) & 1, R.sent.slice(n)], [0, ['now']]);
  H.step(tr, null, { t: 'step', s: 3, m: 0, k: 0, v: 0, p: 0, o: 720, M: 0, F: 1001 }); frame();
  assert.deepEqual([(R.D.st[0][3] >> 11) & 1, R.sent.slice(n)], [0, ['now', 'now']], 'one payload per step wiped');
  H.step(tr, null, { t: 'step', s: 3, m: 0, k: 0, v: 0, p: 0, o: 720, M: 0, F: 1002 }); frame();
  assert.equal(R.sent.length - n, 2, 'nothing left there to wipe: nothing sent');
});

test('7b review 1 #5: REC with the AC pad held records the hit with its accent (the AC row too); a pad below full velocity records its sound only; the 808 unchanged', () => {
  const { tr, R, H } = rig({ model: 'tr606' }), A = H.api(tr);
  A.press({ k: 'sync', v: false }); A.press({ k: 'mode', v: DC.M6_PW }); A.press({ k: 'start' }); A.press({ k: 'rec', v: true });
  H.step(tr, 'i1', { s: 4, m: 0, k: 0, v: 0, p: 0, o: 960, M: 0, F: 48000 });
  R.heard = 48000 + 500; A.pads.on('sd', 1, 1);   // (the panel plays a hit at 1 while AC is held)
  assert.deepEqual([(R.D.st[0][4] >> 2) & 1, R.D.st[0][4] & 1], [1, 1], 'SD and AC at step 5');
  H.step(tr, 'i1', { s: 6, m: 0, k: 0, v: 0, p: 0, o: 1440, M: 0, F: 60000 });
  R.heard = 60000 + 500; A.pads.on('bd', CD.padVel(0.5), 2);
  assert.deepEqual([(R.D.st[0][6] >> 1) & 1, R.D.st[0][6] & 1], [1, 0], 'BD at step 7, no accent');
  const E = rig(), B = E.H.api(E.tr);
  B.press({ k: 'sync', v: false }); B.press({ k: 'mode', v: DC.M_W1 }); B.press({ k: 'start' }); B.press({ k: 'rec', v: true });
  E.H.step(E.tr, 'i1', { s: 3, m: 0, k: 0, v: 0, p: 0, o: 720, M: 0, F: 48000 });
  E.R.heard = 48000 + 500; B.pads.on('sd', 1, 3);
  assert.deepEqual([(E.R.D.st[0][3] >> 2) & 1, E.R.D.st[0][3] & 1], [1, 0], 'the 808: its sound only (as 7a)');
});

test('7b review 2 #3 (the lead\'s decision): TAP\'s press carries its heard frame — STEP RESET\'s payload has rstF (the 606 only)', () => {
  const { tr, R, H } = rig({ model: 'tr606' }), A = H.api(tr);
  R.playing = true; H.transport(true);
  R.heard = 123456; A.tap(7);
  const S = A.state().S, s = DC.payload(R.D, S);
  assert.deepEqual([S.rst, S.rstF, s.rst, s.rstF, R.sent.at(-1)], [1, 123456, 1, 123456, 'now']);
  R.heard = NaN; A.tap(8);
  assert.deepEqual([A.state().S.rst, A.state().S.rstF], [2, -1], 'no audio clock: none (DrSeq restarts as before)');
  const E = rig(); E.R.playing = true; E.H.transport(true); E.R.heard = 5000;
  E.H.api(E.tr).tap(9);
  assert.equal('rstF' in DC.payload(E.R.D, E.H.api(E.tr).state().S), false, 'the 808\'s payload unchanged');
});

test('7b review 2 #1 / #2: RUN/STOP and PATTERN GROUP act on a tap (A.tap), not at the pointer\'s press — a touch pressed then cancelled (a pinch) presses nothing; PATTERN GROUP is not a music zone; FUNCTION + PATTERN GROUP still shows the segno bar', () => {
  withRaf(() => {
    const m = mount(true, { six: true }), start = W(m.root, 'dr:start'), grp = W(m.root, 'dr:grp'), fn = W(m.root, 'dr:fn'), A = m.api.drum;
    m.presses.length = 0;
    dn(start, 1);
    assert.deepEqual(words(m), [], 'RUN/STOP: nothing at the press');
    fire(start, 'pointercancel', { pointerId: 1, gesture: 'two-finger' });
    assert.deepEqual([words(m), m.R.log.filter(x => x === 'play' || x === 'stop').length], [[], 0], 'a pinch starting on it: nothing');
    dn(grp, 2);
    assert.deepEqual([words(m), m.R.D.ui.grp, grp.getAttribute('data-gesture')], [[], 0, null], 'PATTERN GROUP: nothing at the press; no music zone');
    fire(grp, 'pointercancel', { pointerId: 2, gesture: 'two-finger' });
    assert.deepEqual([words(m), m.R.D.ui.grp], [[], 0]);
    dn(start, 3); upP(start, 3); dn(grp, 4); upP(grp, 4);
    assert.deepEqual([words(m), m.R.log.at(-1), m.R.D.ui.grp], [['start', 'grp'], 'play', 1], 'a tap: ▶ (synced) and group II');
    // FUNCTION held (the music touch) + PATTERN GROUP's tap: the segno bar shown, the group kept
    A.press({ k: 'mode', v: DC.M6_TW }); m.presses.length = 0;
    dn(fn, 5); dn(grp, 6); upP(grp, 6);
    assert.deepEqual([words(m), A.state().S.show, m.R.D.tg[1]], [['fn down', 'grp'], 'sg', 0]);
    upP(fn, 5);
    m.r.destroy();
  });
});

test('7b review 2 #4: the 606\'s pads 2 × 50 + 8 from top 8 (still 116 px — the pads row clear of the grid), the AC pad named "Hold" (its aria label unchanged)', () => {
  assert.deepEqual([CD.PADS6.h, CD.PADS6.top + 2 * CD.PADS6.ph + CD.PADS6.gap, CD.PADS6.ph, CD.PADS6.top], [116, 116, 50, 8]);
  withRaf(() => {
    const m = mount(true, { six: true }), g = W(m.root, 'dr:pads'), pad = s => g.childNodes.find(p => p.getAttribute('data-sound') === s);
    assert.equal(g.childNodes.map(p => p.style.top + '/' + p.style.height).join(' '), [...Array(4).fill('8px/50px'), ...Array(4).fill('66px/50px')].join(' '));
    assert.deepEqual([pad('ac').getAttribute('data-name'), pad('ac').getAttribute('aria-label'), pad('bd').getAttribute('data-name')], ['Hold', 'Accent pad (hold: every hit at full accent)', 'Kick']);
    m.r.destroy();
    const E = mount(true), p8 = W(E.root, 'dr:pads').childNodes;
    assert.deepEqual([p8[0].style.top, p8[4].style.top, p8[12].style.top], ['0px', '60px', '180px'], 'the 808\'s pads unchanged');
    E.r.destroy();
  });
});

/* ================================================================ 7c phase 2: the TR-909's widgets and host (IMPL-7c §7.4, §12.8) */
// the presses a 909 panel made, as short words ("hold shift down", "tap pat 2", "key 3 down shift", "release")
const words9 = m => m.presses.splice(0).map(x => { const o = JSON.parse(x); return [o.k, o.b, o.n, o.down === true ? 'down' : o.down === false ? 'up' : '', o.shift ? 'shift' : ''].filter(v => v !== undefined && v !== '').join(' '); });
const byN = (root, id) => byCtl(root, id).map(w => w.childNodes[0]);
const dsp9 = root => all(root).find(n => cls(n) === 'hw-dsp dr-dsp');
const scl9 = root => all(root).filter(n => cls(n) === 'hw-led hw-show dr-led');
const tapEl = (el, id) => { dn(el, id); upP(el, id); };
const pw9 = (A, tap) => { // free PATTERN WRITE of I-1-1 (TAP write when tap), running
  A.press({ k: 'sync', v: false }); A.press({ k: 'hold', b: 'shift', down: true }); A.press({ k: 'tap', b: 'pat', n: 1 });
  if (tap) A.press({ k: 'tap', b: 'back' });
  A.press({ k: 'hold', b: 'shift', down: false }); A.press({ k: 'tap', b: 'start' });
};

test('7c drumHost: the session follows the record\'s machine three ways (a 909 session names itself); bpm(v) presses { k: \'bpm\' } for a 909 — a synced plan whose flams move is sent now, nothing when they do not (review #1), its own synced TEMPO too; a TAP-write key: f at its time, its note (the state\'s velocity) through the pads\' path, the off at its up, the sel() gate, the off when the session drops it; the demo\'s confirm names I-1-1 / I-1-2', () => {
  const { tr, R, H } = rig({ model: 'tr909' }), A = H.api(tr);
  assert.deepEqual([A.state().S.m, A.state().D.m, A.state().S.hold.shift, CD.machOf('tr909'), CD.machOf({ m: 'tr909' }), CD.machOf('tr999'), CD.machOf({ m: 'tr606' }), CD.machOf(null)],
    ['tr909', 'tr909', false, 'tr909', 'tr909', 'tr808', 'tr606', 'tr808']);
  R.playing = true; H.transport(true);
  R.D = DC.normDrum(undefined); H.changed(tr);
  assert.deepEqual([A.state().S.m, 'tap' in A.state().S, A.state().S.play], [undefined, true, true], 'an 808 record: a fresh 808 session, playing');
  R.D = DC.normDrum(undefined, 'tr606'); H.changed(tr);
  assert.equal(Array.isArray(A.state().S.held), true, 'a 606\'s');
  R.D = DC.normDrum(undefined, 'tr909'); H.changed(tr);
  assert.deepEqual([A.state().S.m, A.state().S.play], ['tr909', true], 'and the 909\'s');
  const S0 = A.state().S; H.changed(tr);
  assert.equal(A.state().S, S0, 'the same machine: the session kept');
  // review #1: the DEMO (a snare flam, FLAM 11 = 18 ms) synced — the project tempo moves the flam's ticks
  A.press({ k: 'demo' });
  let n = R.sent.length;
  H.bpm(100);
  assert.deepEqual([R.sent.slice(n), A.state().S.bpm], [['now'], 100], '120 → 100 BPM: the flam 35 → 29 ticks, sent now');
  n = R.sent.length; H.bpm(100); H.bpm(100.2);
  assert.deepEqual([R.sent.slice(n), A.state().S.bpm], [[], 100.2], 'the same ticks: nothing sent (the session\'s tempo kept)');
  A.press({ k: 'tempo', v: 90 });
  assert.deepEqual([R.sent.slice(n), R.log.at(-1), A.state().S.bpm], [['now'], 'bpm 90 undefined', 90], 'its own TEMPO synced: the project tempo, the flams sent with it');
  n = R.sent.length; H.bpm(90);
  assert.deepEqual(R.sent.slice(n), [], 'main\'s echo (setProjectBpm → DRUM.bpm): nothing more');
  const E = rig(); E.H.api(E.tr); E.H.bpm(100);
  assert.deepEqual([E.R.sent.length, E.H.api(E.tr).state().S.bpm], [0, 100], 'the 808: its session\'s tempo only');
  // TAP write (free, 120 BPM: 25 frames a tick, a sixteenth 6000): a key's press at its heard time — the nearest step, its note
  const T = rig({ model: 'tr909' }), B = T.H.api(T.tr);
  pw9(B, true);
  assert.deepEqual([T.R.D.ui.mode, T.R.D.ui.wm, B.state().run], [DC.M9_PW, 1, true], 'PATTERN WRITE, TAP, running');
  T.H.step(T.tr, 'i1', { s: 3, m: 0, k: 0, v: 0, p: 0, o: 720, M: 0, F: 48000 });
  T.R.heard = 48000 + 2000; B.press({ k: 'key', n: 1, down: true, ts: 5 });
  T.R.heard = 48000 + 4000; B.press({ k: 'key', n: 4, down: true, ts: 6 });
  assert.deepEqual(T.R.notes, [['on', 36, r3(110 / 127)], ['on', 38, r3(100 / 127)]], 'two keys: two hits — the left key of the BD pair accented (110), the right of the SD pair normal (100)');
  assert.deepEqual([(T.R.D.st[0][3] >> 1) & 1, (T.R.D.ac[0][3] >> 1) & 1, (T.R.D.st[0][4] >> 2) & 1, (T.R.D.ac[0][4] >> 2) & 1], [1, 1, 1, 0], '0.33 of step 4: BD accented there; 0.67: SD at step 5');
  B.press({ k: 'key', n: 1, down: false }); B.press({ k: 'key', n: 4, down: false });
  assert.deepEqual(T.R.notes.slice(2), [['off', 36], ['off', 38]], 'each off at its key\'s up');
  T.R.sel = false; B.press({ k: 'key', n: 15, down: true }); B.press({ k: 'key', n: 15, down: false });
  assert.equal(T.R.notes.length, 4, 'not the selected track: no note (sel())');
  T.R.sel = true; B.press({ k: 'key', n: 16, down: true });
  assert.deepEqual(T.R.notes.at(-1), ['on', 51, r3(100 / 127)], 'the ride: its own note (51)');
  B.press({ k: 'release' });
  assert.deepEqual(T.R.notes.at(-1), ['off', 51], 'a cancelled hold: the session drops the hit, the host ends its note');
  B.press({ k: 'key', n: 13, down: true }); T.H.panic();
  assert.deepEqual(T.R.notes.slice(-2), [['on', 42, r3(110 / 127)], ['off', 42]], 'a panic ends it too');
  // the demo's confirm names the 909's patterns
  T.R.confirm = false; const st0 = T.R.D.st; B.demo();
  assert.deepEqual([T.R.D.st === st0, /patterns I-1-1 and I-1-2/.test(T.R.asked)], [true, true]);
});

test('7c render with api.drum (the fixture TR-909 face): the 16 step keys (stopped PATTERN PLAY: key 1 flashing; each names its voice), the held keys in music zones, the taps not, TRACK 1–4 / PATTERN 1–3 by n with their LEDs, the display\'s three characters, the scale LEDs, TEMPO 37–290; the extras (the 808\'s grid 640 × 272, the 4 × 3 pads, no SWING); the DOM budget', () => {
  withRaf(() => {
    const m = mount(true, { nine: true }), keys = stepKeys(m.root);
    assert.deepEqual([keys.length, keys.map(k => k.getAttribute('data-lit')).join(' ')], [16, ['flash', ...Array(15).fill('off')].join(' ')]);
    assert.deepEqual([keys[0].getAttribute('aria-label'), keys[13].getAttribute('aria-label'), keys[0].getAttribute('data-gesture'), keys[0].getAttribute('aria-keyshortcuts'), keys[3].getAttribute('data-led'), keys[0].getAttribute('aria-current'), cls(keys[0])],
      ['Step 1 · Kick, accent', 'Step 14 · Closed hat', 'music', 'Shift+Enter Alt+Enter', 'cap', 'true', 'hw-btn dr-key']);
    const lab = id => W(m.root, id).getAttribute('aria-label'), gest = id => W(m.root, id).getAttribute('data-gesture');
    const HELD = ['dr:shift', 'dr:isel', 'dr:clear', 'dr:last', 'dr:shuf', 'dr:tkey', 'dr:avail'], TAPS = ['dr:start', 'dr:stop', 'dr:scale', 'dr:back', 'dr:fwd', 'dr:cyc', 'dr:enter'];
    assert.deepEqual(HELD.map(lab), ['Shift', 'Instrument select', 'Clear', 'Last step', 'Shuffle / flam', 'Tempo · Shift: step write', 'Available measures · Shift: bank II']);
    assert.deepEqual(TAPS.map(lab), ['Start', 'Stop / continue', 'Scale', 'Back · Shift: tap write', 'Forward · Shift: bank I', 'Cycle / guide · Shift: last measure', 'Enter']);
    assert.deepEqual([HELD.map(gest).join(), TAPS.map(gest).every(g => g === null), HELD.map(id => W(m.root, id).getAttribute('aria-pressed')).join()], [Array(7).fill('music').join(), true, Array(7).fill('false').join()]);
    for (const id of [...HELD, ...TAPS]) assert.equal(W(m.root, id).localName, 'button', id);
    const trk = byN(m.root, 'dr:trk'), pat = byN(m.root, 'dr:pat');
    assert.deepEqual([trk.map(b => b.getAttribute('data-n')).join(), trk[1].getAttribute('aria-label'), pat[2].getAttribute('aria-label'), pat.map(b => b.getAttribute('data-lit')).join(), pat[0].getAttribute('aria-pressed'), trk.map(b => b.getAttribute('data-lit')).join()],
      ['1,2,3,4', 'Track 2 · Shift: track write', 'Pattern 3 · Shift: pattern write', 'on,off,off', 'true', 'off,off,off,off'], 'PATTERN PLAY, group 1: PATTERN 1 lit');
    assert.deepEqual(['dr:tkey', 'dr:back', 'dr:fwd', 'dr:avail', 'dr:cyc', 'dr:enter'].map(id => W(m.root, id).getAttribute('data-lit') + '/' + W(m.root, id).getAttribute('data-led')).join(' '), 'off/cap off/cap off/cap off/cap off/cap off/cap');
    const d = dsp9(m.root);
    assert.deepEqual([d.textContent, d.getAttribute('aria-label'), d.getAttribute('role'), d.style.width, d.style.height, d.style.fontSize], ['120', 'Display: 120', 'status', '78px', '38px', '30px'], 'the project tempo (synced); its characters fill the window');
    assert.deepEqual(scl9(m.root).map(n => n.getAttribute('aria-label')), ['Scale 16ths: lit', 'Scale 32nds: off', 'Scale 8th triplets: off', 'Scale 16th triplets: off']);
    const tempo = W(m.root, 'dr:tempo');
    assert.deepEqual([cls(tempo), tempo.getAttribute('aria-valuetext'), tempo.getAttribute('aria-valuemin'), tempo.getAttribute('aria-valuemax')], ['knob hw-tempo dr-tempo', '120 BPM', '37', '290']);
    for (const id of DR9_FACE.filter(t => t !== 'dr:disp' && t !== 'dr:scl')) assert.ok(byCtl(m.root, id).length && byCtl(m.root, id).every(w => w.getAttribute('data-nomod') === '1'), id + ': rendered, no modulation target (§9)');
    for (const id of DR9_EXTRAS) assert.equal(byCtl(m.root, id).length, 1, id);
    assert.deepEqual([byCtl(m.root, 'dr:swing').length, byCtl(m.root, 'dr:link').length], [0, 0]);
    const cv = W(m.root, 'dr:grid').childNodes[0], pads = W(m.root, 'dr:pads');
    assert.deepEqual([cv.style.width, cv.style.height, pads.style.width, pads.style.height, pads.getAttribute('data-gesture')], ['640px', '272px', '232px', '184px', 'music']);
    assert.deepEqual([pads.childNodes.map(p => p.getAttribute('data-sound')).join(' '), pads.childNodes.map(p => p.getAttribute('data-code')).join(' ')], [CD.PAD9.join(' '), 'CR RD OH CH LT MT HT AC BD SD RS HC']);
    assert.deepEqual(['dr:sync', 'dr:toRoll', 'dr:rec', 'dr:map', 'dr:sounds', 'dr:demo'].map(id => W(m.root, id).textContent), ['Sync · song', '→ Piano roll', 'Rec', 'Map…', 'Sounds…', 'Demo']);
    assert.match(W(m.root, 'dr:sync').title, /the 909 follows the song \(START and STOP\/CONT are ▶ and ■/);
    assert.match(W(m.root, 'dr:sounds').title, /our own hi-hat and cymbal sounds through the 909’s chip circuit/);
    assert.match(W(m.root, 'dr:toRoll').title, /the 909's own sequencer/);
    const cap = all(m.root).find(n => cls(n) === 'hw-xcap'), cap8 = all(mount(false).root).find(n => cls(n) === 'hw-xcap');
    assert.deepEqual([cap.textContent, cap.style.fontSize, cap.style.letterSpacing, cap8.style.fontSize, cap8.style.letterSpacing], [P.TOKENS.tr909.caption + ' · Dimmed controls are not emulated', '8px', '0.04em', undefined, undefined],
      'the 909\'s caption (D4) in 8 px to fit its strip; the 808\'s as before');
    // the DOM budget (§7.4: the module ≤ 1000): the live layer + the face SVG's elements (the fixture's face is spare: the
    // authored face is measured in headless Chrome)
    const face = (String(all(m.root).find(n => cls(n) === 'hw-decor').innerHTML).match(/<[a-z][^>]*>/g) || []).length, live = all(m.root).length;
    assert.ok(live + face <= 1000 && live < 520, `${live} + ${face}`);
    m.r.destroy();
  });
});

test('7c widgets: SHIFT / INSTRUMENT SELECT held + a key → down, key down, key up, up in that order (SHIFT + PATTERN 2: PATTERN WRITE; INSTRUMENT SELECT + a key, a pair (flam write), ENTER (TOTAL ACCENT)); STEP write running: a key cycles off → normal (dim) → accented → off; LAST STEP + key; SCALE; SHUFFLE/FLAM + keys (its LEDs while held); two keys: a block; Shift / Alt with the mouse; Enter / Space held; TEMPO', () => {
  withRaf(() => {
    const m = mount(true, { nine: true }), keys = stepKeys(m.root), A = m.api.drum, el = id => W(m.root, id), pat = byN(m.root, 'dr:pat');
    A.press({ k: 'sync', v: false }); m.presses.length = 0;
    dn(el('dr:shift'), 1); tapEl(pat[1], 2); upP(el('dr:shift'), 1);
    assert.deepEqual([words9(m), m.R.D.ui.mode, m.R.D.ui.grp], [['hold shift down', 'tap pat 2', 'hold shift up'], DC.M9_PW, 1], 'SHIFT + PATTERN 2: PATTERN WRITE, group 2');
    tapEl(keys[2], 3);
    assert.deepEqual([words9(m), m.R.D.ui.sel], [['key 3 down', 'key 3 up'], 2], 'stopped: the pattern to edit (I-2-3)');
    dn(el('dr:isel'), 4); rafQ.flush();
    assert.equal(el('dr:isel').getAttribute('aria-pressed'), 'true');
    tapEl(keys[2], 5); upP(el('dr:isel'), 4);
    assert.deepEqual([words9(m), m.R.D.ui.inst, m.R.D.ui.fw], [['hold isel down', 'key 3 down', 'key 3 up', 'hold isel up'], 2, false], 'the snare');
    dn(el('dr:isel'), 6); dn(keys[0], 7); dn(keys[1], 8); upP(keys[1], 8); upP(keys[0], 7); upP(el('dr:isel'), 6);
    assert.deepEqual([m.R.D.ui.inst, m.R.D.ui.fw], [1, true], 'both keys of the BD pair: flam write');
    dn(el('dr:isel'), 9); tapEl(el('dr:enter'), 10); upP(el('dr:isel'), 9);
    assert.deepEqual([words9(m).slice(-3), m.R.D.ui.inst, m.R.D.ui.fw], [['hold isel down', 'tap enter', 'hold isel up'], 0, false], '+ ENTER: TOTAL ACCENT');
    dn(el('dr:isel'), 11); tapEl(keys[0], 12); upP(el('dr:isel'), 11);
    tapEl(el('dr:start'), 13); rafQ.flush();
    assert.deepEqual([A.state().run, m.R.D.ui.inst, el('dr:tkey').getAttribute('data-lit'), el('dr:start').getAttribute('aria-pressed')], [true, 1, 'on', 'true'], 'START (free); BD selected; STEP write: the TEMPO key lit');
    const ed = 16 + 2, cyc = () => { tapEl(keys[4], 14); rafQ.flush(); return [(m.R.D.st[ed][4] >> 1) & 1, (m.R.D.ac[ed][4] >> 1) & 1, keys[4].getAttribute('data-lit')]; };
    assert.deepEqual([cyc(), cyc(), cyc()], [[1, 0, 'dim'], [1, 1, 'on'], [0, 0, 'off']], 'off → normal (dim) → accented (on) → off');
    words9(m);
    dn(el('dr:last'), 15); tapEl(keys[11], 16); upP(el('dr:last'), 15);
    assert.deepEqual([words9(m), m.R.D.keys[ed].l1], [['hold last down', 'key 12 down', 'key 12 up', 'hold last up'], 12], 'LAST STEP 12');
    tapEl(el('dr:scale'), 17); rafQ.flush();
    assert.deepEqual([m.R.D.keys[ed].sc, m.R.D.keys[ed].l1, scl9(m.root).map(n => n.getAttribute('data-lit')).join()], [2, 16, 'off,on,off,off'], 'SCALE: 32nds (its row lit), LAST STEP 16');
    dn(el('dr:shuf'), 18); tapEl(keys[2], 19); tapEl(keys[11], 20); rafQ.flush();
    assert.deepEqual([m.R.D.keys[ed].sh, m.R.D.keys[ed].fl, keys.map((k, j) => (k.getAttribute('data-lit') === 'on' ? j + 1 : 0)).filter(Boolean)], [3, 12, [3, 12]], 'SHUFFLE 3, FLAM 12, their keys lit while held');
    upP(el('dr:shuf'), 18); words9(m);
    // PATTERN PLAY, stopped: two keys held → block play; Shift-click the same with the mouse
    A.press({ k: 'tap', b: 'start' }); tapEl(pat[0], 21); words9(m);
    dn(keys[4], 22); dn(keys[6], 23); upP(keys[4], 22); upP(keys[6], 23);
    assert.deepEqual([m.R.D.ui.mode, m.R.D.ui.sel, m.R.D.ui.bl], [DC.M9_PP, 4, 2], 'keys 5 and 7 held: the block 5–7');
    const click = (k, id, o = {}) => { fire(k, 'pointerdown', Object.assign({ pointerId: id, button: 0, pointerType: 'mouse' }, o)); fire(k, 'pointerup', Object.assign({ pointerId: id, pointerType: 'mouse' }, o)); };
    click(keys[8], 24); click(keys[10], 25, { shiftKey: true });
    assert.deepEqual([m.R.D.ui.sel, m.R.D.ui.bl], [8, 2], 'Shift-click: 9–11');
    words9(m);
    click(keys[4], 26, { altKey: true });
    assert.deepEqual(words9(m), ['hold shift down', 'key 5 down', 'key 5 up'], 'Alt still down: SHIFT held');
    fire(m.doc, 'keyup', { key: 'Alt' });
    assert.deepEqual(words9(m), ['hold shift up'], 'Alt let go');
    fire(keys[5], 'pointerdown', { pointerId: 27, button: 0, pointerType: 'mouse', altKey: true }); fire(keys[5], 'pointerup', { pointerId: 27, pointerType: 'mouse' });
    assert.deepEqual(words9(m), ['hold shift down', 'key 6 down', 'key 6 up', 'hold shift up'], 'Alt let go before the button: SHIFT up after the key');
    dn(el('dr:shift'), 28); click(keys[1], 29, { altKey: true }); fire(m.doc, 'keyup', { key: 'Alt' }); upP(el('dr:shift'), 28);
    assert.deepEqual(words9(m), ['hold shift down', 'key 2 down', 'key 2 up', 'hold shift up'], 'SHIFT held and Alt: one SHIFT');
    key(keys[1], 'Enter'); key(keys[1], 'Enter', { repeat: true }); fire(keys[1], 'keyup', { key: 'Enter' });
    key(el('dr:shift'), ' '); key(keys[2], ' ', { shiftKey: true }); fire(keys[2], 'keyup', { key: ' ' }); fire(el('dr:shift'), 'keyup', { key: ' ' });
    assert.deepEqual(words9(m), ['key 2 down', 'key 2 up', 'hold shift down', 'key 3 down shift', 'key 3 up', 'hold shift up'], 'the keyboard: Enter / Space held (the repeat ignored)');
    // TEMPO: free the machine's (whole BPM on the log law), synced the project's in one gesture
    const tempo = el('dr:tempo');
    key(tempo, 'ArrowUp');
    assert.ok(m.R.D.ui.tempo > 120 && Number.isInteger(m.R.D.ui.tempo), 'free: ' + m.R.D.ui.tempo);
    A.press({ k: 'sync', v: true });
    ptr(tempo, 'pointerdown', 0, 100); ptr(tempo, 'pointermove', 0, 99); ptr(tempo, 'pointermove', 0, 98); ptr(tempo, 'pointerup', 0, 98);
    assert.deepEqual(m.R.log.filter(x => x.startsWith('bpm ')).map(x => x.split(' ').pop()), ['move', 'move', 'end'], 'synced: the project tempo, one gesture');
    m.r.destroy();
  });
});

test('7c widgets: TAP write — the step keys are drum pads (two fingers = two hits at their states\' velocities, written where heard; the offs at the lifts; 13 + 14 the open hat); a cancelled hold sends { k: \'release\' } and does nothing (a pointercancel, a lost capture, a keyboard hold blurred, the host\'s release-all) and ends a key\'s note; the taps on A.tap (a pinch starting there presses nothing); destroy → release', () => {
  withRaf(() => {
    const m = mount(true, { nine: true }), keys = stepKeys(m.root), A = m.api.drum, el = id => W(m.root, id);
    pw9(A, true); rafQ.flush();
    assert.deepEqual([m.R.D.ui.wm, el('dr:back').getAttribute('data-lit'), A.state().run], [1, 'on', true], 'TAP write: BACK lit');
    m.H.step(m.tr, 'i1', { s: 3, m: 0, k: 0, v: 0, p: 0, o: 720, M: 0, F: 48000 });
    m.R.heard = 48000 + 1000; m.presses.length = 0;
    dn(keys[0], 1); dn(keys[3], 2);
    assert.deepEqual([m.R.notes, (m.R.D.st[0][3] >> 1) & 1, (m.R.D.st[0][3] >> 2) & 1, (m.R.D.ac[0][3] >> 1) & 1], [[['on', 36, r3(110 / 127)], ['on', 38, r3(100 / 127)]], 1, 1, 1], 'two fingers: two hits, both written at step 4');
    assert.ok(m.presses.every(x => typeof JSON.parse(x).ts === 'number'), 'each key\'s press carries its time');
    upP(keys[3], 2); upP(keys[0], 1);
    assert.deepEqual(m.R.notes.slice(2), [['off', 38], ['off', 36]]);
    dn(keys[12], 3); dn(keys[13], 4); upP(keys[13], 4); upP(keys[12], 3);
    assert.deepEqual([m.R.notes.slice(4).map(x => x.slice(0, 2).join(' ')).join(), (m.R.D.st[0][3] >> 10) & 1, (m.R.D.st[0][3] >> 11) & 1], ['on 42,on 46,off 46,off 42', 1, 0], '13 + 14: the open hat (the closed one taken back off its step)');
    // a cancel: the held key's note ends, one release
    words9(m);
    dn(keys[6], 5); fire(keys[6], 'pointercancel', { pointerId: 5 });
    assert.deepEqual([words9(m), m.R.notes.at(-1)], [['key 7 down', 'release'], ['off', 45]], 'a pointercancel: release, the mid tom\'s note off');
    upP(keys[6], 5);
    assert.deepEqual(words9(m), [], 'its stale up: nothing');
    // TRACK PLAY, stopped, a track of six measures: SHIFT + 5 typed, cancelled → no locate; released → ENTER locates measure 5
    A.press({ k: 'tap', b: 'stop' }); m.R.D = Object.assign({}, m.R.D, { tk: [[0, 1, 2, 3, 4, 5], ...m.R.D.tk.slice(1)] }); tapEl(byN(m.root, 'dr:trk')[0], 6); words9(m);
    const loc = () => A.state().S.loc, type = (id, end) => { dn(el('dr:shift'), id); tapEl(keys[4], id + 1); end(); tapEl(el('dr:enter'), id + 2); };
    type(10, () => fire(el('dr:shift'), 'pointercancel', { pointerId: 10 }));
    assert.deepEqual([words9(m), loc()], [['hold shift down', 'key 5 down', 'key 5 up', 'release', 'tap enter'], 0], 'a pointercancel: no locate');
    type(20, () => fire(el('dr:shift'), 'lostpointercapture', { pointerId: 20 }));
    assert.deepEqual([words9(m).at(-2), loc()], ['release', 0], 'a lost capture');
    // (review 2 F2, the lead's: a key press on a held key latches it — focus may move on; Escape cancels it, nothing done)
    key(el('dr:shift'), 'Enter'); fire(el('dr:shift'), 'keyup', { key: 'Enter' }); fire(el('dr:shift'), 'blur'); key(keys[4], 'Enter'); fire(keys[4], 'keyup', { key: 'Enter' }); fire(m.doc, 'keydown', { key: 'Escape' }); tapEl(el('dr:enter'), 30);
    assert.deepEqual([words9(m).slice(-2), loc()], [['release', 'tap enter'], 0], 'a keyboard latch, Escape: no locate');
    key(el('dr:shift'), 'Enter'); fire(el('dr:shift'), 'keyup', { key: 'Enter' }); fire(el('dr:shift'), 'blur'); key(keys[4], 'Enter'); fire(keys[4], 'keyup', { key: 'Enter' }); tapEl(el('dr:enter'), 31);
    assert.deepEqual([words9(m).slice(-3), loc(), A.state().S.hold.shift], [['key 5 up', 'tap enter', 'hold shift up'], 4, false], 'the keyboard alone: SHIFT latched, 5, ENTER — measure 5 located');
    A.press({ k: 'tap', b: 'back' }); A.press({ k: 'tap', b: 'back' }); A.press({ k: 'tap', b: 'back' }); A.press({ k: 'tap', b: 'back' }); words9(m);
    dn(el('dr:shift'), 31); dn(keys[4], 32); m.H.release();
    assert.deepEqual([words9(m).at(-1), A.state().S.hold.shift, A.state().S.keys.length], ['release', false, 0], 'the host\'s release-all');
    upP(keys[4], 32); upP(el('dr:shift'), 31);
    assert.deepEqual(words9(m), [], 'the lifts after it: nothing');
    type(40, () => upP(el('dr:shift'), 40));
    assert.equal(loc(), 4, 'released: SHIFT + 5, ENTER locates measure 5');
    // the taps act at A.tap (the fake: the pointer's up): a press then a two-finger cancel (a pinch) presses nothing
    words9(m);
    for (const b of [el('dr:start'), byN(m.root, 'dr:trk')[1], el('dr:enter')]) { dn(b, 50); fire(b, 'pointercancel', { pointerId: 50, gesture: 'two-finger' }); }
    assert.deepEqual([words9(m), m.R.D.ui.trk, A.state().run], [[], 0, false], 'a pinch starting on START, TRACK 2 or ENTER: nothing');
    // destroy → release: a held SHIFT and a held key let go, once
    dn(el('dr:shift'), 60); dn(keys[0], 61); words9(m);
    m.r.destroy();
    assert.deepEqual(words9(m), ['release']);
    upP(el('dr:shift'), 60);
    assert.deepEqual(words9(m), [], 'after destroy: nothing');
  });
});

// review 2 F1: the taps act at a finger's release (A.tap), the held keys were read then — a held finger lifted first (or both in
// one touchend: the held one is first) gave the plain key. Now a tap latches what is held at its own press and sends it with
// the tap; drum-core ORs it in (7a review 2 #2's latch)
test('review 2 F1: a held key + a tap key by touch reads the held keys at the tap\'s own press — whichever finger lifts first (SHIFT + PATTERN 2 / TRACK 2 / BACK, INSTRUMENT SELECT + ENTER, TEMPO + ENTER); keys 3 + 4 held + ENTER chains them, the keys lifted first; a cancelled tap latches nothing', () => {
  withRaf(() => {
    for (const first of ['held', 'tap']) {
      const run = (held, tapB, check, msg) => {
        const m = mount(true, { nine: true }), A = m.api.drum, el = id => W(m.root, id);
        A.press({ k: 'sync', v: false });
        const h = el(held), t = typeof tapB === 'string' ? el(tapB) : tapB(m.root);
        dn(h, 1); dn(t, 2);
        if (first === 'held') { upP(h, 1); upP(t, 2); } else { upP(t, 2); upP(h, 1); }
        assert.deepEqual(check(m), true, `${msg}, the ${first} lifted first`);
        assert.equal(A.state().S.hold.shift || A.state().S.hold.isel || A.state().S.hold.tkey, false, 'nothing left held');
        m.r.destroy();
      };
      run('dr:shift', r => byN(r, 'dr:pat')[1], m => m.R.D.ui.mode === DC.M9_PW && m.R.D.ui.grp === 1, 'SHIFT + PATTERN 2: PATTERN WRITE');
      run('dr:shift', r => byN(r, 'dr:trk')[1], m => m.R.D.ui.mode === DC.M9_TW && m.R.D.ui.trk === 1, 'SHIFT + TRACK 2: TRACK WRITE');
      run('dr:shift', 'dr:back', m => m.R.D.ui.wm === 1, 'SHIFT + BACK: TAP write');
      run('dr:isel', 'dr:enter', m => m.R.D.ui.inst === 0, 'INSTRUMENT SELECT + ENTER: TOTAL ACCENT');
      run('dr:tkey', 'dr:enter', m => m.R.D.tt[0] === 120, 'TEMPO + ENTER: the track\'s tempo');
    }
    // the chain: PATTERN WRITE stopped, keys 3 + 4 held, ENTER — the keys lifted before ENTER's release
    for (const first of ['keys', 'enter']) {
      const m = mount(true, { nine: true }), A = m.api.drum, el = id => W(m.root, id), keys = stepKeys(m.root);
      A.press({ k: 'sync', v: false }); A.press({ k: 'hold', b: 'shift', down: true }); A.press({ k: 'tap', b: 'pat', n: 1 }); A.press({ k: 'hold', b: 'shift', down: false });
      dn(keys[2], 1); dn(keys[3], 2); dn(el('dr:enter'), 3);
      if (first === 'keys') { upP(keys[2], 1); upP(keys[3], 2); upP(el('dr:enter'), 3); } else { upP(el('dr:enter'), 3); upP(keys[2], 1); upP(keys[3], 2); }
      assert.deepEqual([m.R.D.keys[2].ch, m.R.D.keys[3].ch], [1, 0], `3 + 4 + ENTER: chained (the ${first} lifted first)`);
      m.r.destroy();
    }
    // a tap pressed under SHIFT, then cancelled (a pinch): the next tap of it reads no stale latch
    const m = mount(true, { nine: true }), A = m.api.drum, el = id => W(m.root, id), pat = byN(m.root, 'dr:pat');
    A.press({ k: 'sync', v: false });
    dn(el('dr:shift'), 1); dn(pat[1], 2); fire(pat[1], 'pointercancel', { pointerId: 2 }); upP(el('dr:shift'), 1);
    dn(pat[1], 3); upP(pat[1], 3);
    assert.deepEqual([m.R.D.ui.mode, m.R.D.ui.grp], [DC.M9_PP, 1], 'PATTERN 2 alone: PATTERN PLAY');
    m.r.destroy();
  });
});

// review 2 F2 (the lead's decision): desktop hold combinations — on a tap key Alt or Shift is SHIFT; a mouse click or a keyboard
// press on a held key latches it (lit, aria-pressed, "latched" in its label) until the next key uses it (then it releases; SHIFT
// stays through a SHIFT sequence — digits, COPY / INS / DEL — until ENTER), a second click or Escape cancels; touch holds as before
test('review 2 F2: Alt- / Shift-click on PATTERN n, TRACK n, BACK = SHIFT +; a click / key press on a held key latches it until the next key uses it — INSTRUMENT SELECT + key 3 (the snare), + ENTER (TOTAL ACCENT), LAST STEP + key, TEMPO + ENTER, SHIFT + digits + ENTER (a locate); a second click or Escape cancels; touch keeps the hold', () => {
  withRaf(() => {
    const m = mount(true, { nine: true }), A = m.api.drum, el = id => W(m.root, id), keys = stepKeys(m.root), pat = byN(m.root, 'dr:pat'), trk = byN(m.root, 'dr:trk');
    const click = (k, id, o = {}) => { fire(k, 'pointerdown', Object.assign({ pointerId: id, button: 0, pointerType: 'mouse' }, o)); fire(k, 'pointerup', Object.assign({ pointerId: id, button: 0, pointerType: 'mouse' }, o)); };
    A.press({ k: 'sync', v: false }); words9(m);
    click(pat[1], 1, { altKey: true });
    assert.deepEqual([m.R.D.ui.mode, m.R.D.ui.grp], [DC.M9_PW, 1], 'Alt-click PATTERN 2: PATTERN WRITE');
    click(pat[0], 2, { shiftKey: true });
    assert.deepEqual([m.R.D.ui.mode, m.R.D.ui.grp], [DC.M9_PW, 0], 'Shift-click PATTERN 1: PATTERN WRITE group 1');
    click(el('dr:back'), 3, { altKey: true });
    assert.equal(m.R.D.ui.wm, 1, 'Alt-click BACK: TAP write');
    click(trk[1], 4, { shiftKey: true });
    assert.deepEqual([m.R.D.ui.mode, m.R.D.ui.trk], [DC.M9_TW, 1], 'Shift-click TRACK 2: TRACK WRITE');
    assert.equal(A.state().S.hold.shift, false, 'no SHIFT left held');
    m.r.destroy();
    // the latch: INSTRUMENT SELECT clicked → lit and announced, then key 3 → the snare, released
    const n = mount(true, { nine: true }), B = n.api.drum, e2 = id => W(n.root, id), k2 = stepKeys(n.root);
    B.press({ k: 'sync', v: false }); B.press({ k: 'hold', b: 'shift', down: true }); B.press({ k: 'tap', b: 'pat', n: 1 }); B.press({ k: 'hold', b: 'shift', down: false });
    words9(n);
    click(e2('dr:isel'), 10); rafQ.flush();
    assert.deepEqual([B.state().S.hold.isel, e2('dr:isel').getAttribute('aria-pressed'), e2('dr:isel').getAttribute('data-latch'), /latched/.test(e2('dr:isel').getAttribute('aria-label'))], [true, 'true', '', true], 'latched: held, lit, announced');
    click(k2[2], 11); rafQ.flush();
    assert.deepEqual([n.R.D.ui.inst, B.state().S.hold.isel, e2('dr:isel').getAttribute('data-latch'), words9(n)], [2, false, null, ['hold isel down', 'key 3 down', 'key 3 up', 'hold isel up']], 'used by key 3: the snare, released');
    click(e2('dr:isel'), 12); click(e2('dr:enter'), 13);
    assert.deepEqual([n.R.D.ui.inst, B.state().S.hold.isel], [0, false], '+ ENTER: TOTAL ACCENT, released');
    click(e2('dr:isel'), 14); click(e2('dr:isel'), 15);
    assert.deepEqual([B.state().S.hold.isel, words9(n).slice(-2)], [false, ['hold isel down', 'hold isel up']], 'a second click cancels');
    key(e2('dr:isel'), 'Enter'); fire(e2('dr:isel'), 'keyup', { key: 'Enter' }); fire(e2('dr:isel'), 'blur');
    assert.equal(B.state().S.hold.isel, true, 'a key press latches too (focus may move on)');
    fire(n.doc, 'keydown', { key: 'Escape' });
    assert.deepEqual([B.state().S.hold.isel, words9(n).slice(-1)], [false, ['release']], 'Escape cancels (nothing done)');
    // LAST STEP + key (running: the edited pattern's)
    B.press({ k: 'tap', b: 'start' });
    click(e2('dr:last'), 16); click(k2[9], 17);
    assert.deepEqual([n.R.D.keys[0].l1, B.state().S.hold.last], [10, false], 'LAST STEP + key 10');
    B.press({ k: 'tap', b: 'stop' });
    // TEMPO + ENTER: the track's tempo; SHIFT + digits + ENTER in TRACK PLAY: SHIFT stays latched through the digits
    click(e2('dr:tkey'), 18); click(e2('dr:enter'), 19);
    assert.deepEqual([n.R.D.tt[0], B.state().S.hold.tkey], [120, false], 'TEMPO + ENTER');
    n.R.D = Object.assign({}, n.R.D, { tk: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], ...n.R.D.tk.slice(1)] }); click(byN(n.root, 'dr:trk')[0], 20);
    click(e2('dr:shift'), 21); click(k2[0], 22); click(k2[1], 23);
    assert.deepEqual([B.state().S.dig, B.state().S.hold.shift], ['12', true], 'SHIFT latched through the digits');
    click(e2('dr:enter'), 24);
    assert.deepEqual([B.state().S.loc, B.state().S.hold.shift], [11, false], 'ENTER: measure 12 located, SHIFT released');
    // touch: the real hold (released at the lift, never latched)
    dn(e2('dr:isel'), 30); upP(e2('dr:isel'), 30);
    assert.deepEqual([B.state().S.hold.isel, e2('dr:isel').getAttribute('data-latch')], [false, null], 'touch: a hold');
    n.r.destroy();
  });
});

// review 2 F3: a pad flashes by flipping its data-hit (two keyframes: the animation restarts) — the parity was one counter for
// every pad, so a pad flashed after an even number of others got the value it had (no restart, no flash). Each pad its own
test('review 2 F3: every flash flips its own pad\'s data-hit — two pads lit alternately (the monitor, the pads), and together, each flash a change (the 808\'s, the 606\'s and the 909\'s pads: shared code)', () => {
  withRaf(() => {
    for (const o of [{}, { six: true }, { nine: true }]) {
      const m = mount(true, o), g = W(m.root, 'dr:pads'), pad = s => g.childNodes.find(p => p.getAttribute('data-sound') === s);
      assert.deepEqual([pad('bd').getAttribute('data-hit'), pad('sd').getAttribute('data-hit')], [null, null], 'at rest: no data-hit');
      m.R.heard = NaN;
      const lit = (bits, msg) => { const was = ['bd', 'sd'].map(s => pad(s).getAttribute('data-hit')); m.H.mon(m.tr, { lit: bits, F: 0 }); m.frame(); return ['bd', 'sd'].map((s, j) => (bits >> j) & 1 ? pad(s).getAttribute('data-hit') !== was[j] : pad(s).getAttribute('data-hit') === was[j]).every(Boolean) || msg; };
      for (const [bits, msg] of [[1, 'BD'], [2, 'SD'], [1, 'BD again'], [2, 'SD again'], [3, 'both'], [3, 'both again'], [1, 'BD']]) assert.equal(lit(bits, msg), true, (o.nine ? '909' : o.six ? '606' : '808') + ': ' + msg);
      m.r.destroy();
    }
  });
});

// review 2 F5: the grid drew its keyboard cursor (a yellow box) on any focus — a mouse / touch press focuses the canvas; now
// only after keyboard navigation (a Tab focus or a key; :focus-visible's rule), a press hides it again (the three grids: shared)
test('review 2 F5: the grid\'s keyboard cursor only after keyboard navigation — not after a mouse / touch press; a Tab focus or an arrow shows it, a press hides it, blur ends it (the 808\'s, 606\'s and 909\'s grids)', () => {
  withRaf(() => {
    for (const o of [{}, { six: true }, { nine: true }]) {
      const m = mount(true, o), cv = W(m.root, 'dr:grid').childNodes[0], ctx = cv.getContext('2d'), tag = o.nine ? '909' : o.six ? '606' : '808';
      placeEl(cv, 0, 0, 640, 272);
      // (each step's own redraw: true / false the cursor drawn or not, null no redraw)
      const step = f => { ctx.calls.length = 0; f(); rafQ.flush(); return ctx.calls.some(c => c[0] === 'fillRect') ? ctx.calls.some(c => c[0] === 'strokeRect') : null; };
      for (const pt of ['mouse', 'touch']) {
        assert.equal(step(() => { fire(cv, 'pointerdown', { pointerId: 1, button: 0, pointerType: pt, clientX: 2, clientY: 2 }); fire(cv, 'focus'); fire(cv, 'pointerup', { pointerId: 1, pointerType: pt, clientX: 2, clientY: 2 }); }) !== true, true, `${tag}: a ${pt} press focuses — no cursor drawn`);
        assert.equal(step(() => key(cv, 'ArrowRight')), true, `${tag}: an arrow — the cursor`);
        assert.equal(step(() => { fire(cv, 'pointerdown', { pointerId: 2, button: 0, pointerType: pt, clientX: 2, clientY: 2 }); fire(cv, 'pointerup', { pointerId: 2, pointerType: pt, clientX: 2, clientY: 2 }); }), false, `${tag}: a ${pt} press hides it`);
        assert.notEqual(step(() => fire(cv, 'blur')), true, `${tag}: blurred`);
      }
      assert.equal(step(() => fire(cv, 'focus')), true, `${tag}: a Tab focus shows it`);
      assert.equal(step(() => fire(cv, 'blur')), false, `${tag}: blur ends it`);
      m.r.destroy();
    }
  });
});

test('7c the grid: 12 rows (AC … RD on the 808\'s lane bits) hit-tested at 3 zooms; a tap cycles a cell as its step key would (BD off → normal → accented → off; RS off ↔ on); a long press / Alt-click / right click / F on a BD … HT cell its flam; the marks (small normal, full accented, double flam); a header mutes / solos its lane bit; the cells past LAST STEP dimmed', () => {
  for (const [x, y, want] of [[0, 0, '{"corner":true}'], [64, 10, '{"top":true,"s":0}'], [639, 271, '{"lane":8,"row":11,"s":15}'], [63, 32, '{"head":true,"lane":0,"row":0}'], [64 + 5 * 36 + 1, 32 + 8 * 20 + 1, '{"lane":11,"row":8,"s":5}']]) assert.equal(JSON.stringify(CD.gridAt909(x, y)), want, x + ',' + y);
  assert.deepEqual([CD.gridAt909(-1, 5), CD.gridAt909(640, 5), CD.UI.tr909.lanes, CD.UI.tr909.codes, CD.UI.tr909.grid, Object.keys(CD.UI.tr909.dial).length], [null, null, DC.LANES909, DC.CODES909, CD.GRID, 0]);
  assert.deepEqual([CD.PADS9.w, CD.PADS9.h, 4 * CD.PADS9.pad + 3 * CD.PADS9.gap, CD.PADS9.top + 3 * CD.PADS9.ph + 2 * CD.PADS9.gap].join(), [P.DR9_PADS.w, P.DR9_PADS.h, 232, 180].join(), 'the pads\' cell = cv-panel\'s');
  withRaf(() => {
    const m = mount(true, { nine: true }), cv = W(m.root, 'dr:grid').childNodes[0], A = m.api.drum;
    layoutEl(cv, 640, 272);
    const pat = () => DC.gridPat(A.state().S, m.R.D), bit = (f, l, s) => (m.R.D[f][pat()][s] >> l) & 1, st = (l, s) => [bit('st', l, s), bit('ac', l, s), bit('fm', l, s)].join('');
    const hitAt = (k, row, s, up = 10) => {
      placeEl(cv, 100, 50, 640 * k, 272 * k);
      const X = 100 + (64 + s * 36 + 18) * k, Y = 50 + (32 + row * 20 + 10) * k;
      fire(cv, 'pointerdown', { pointerType: 'touch', pointerId: 3, clientX: X, clientY: Y, button: 0, timeStamp: 0 });
      fire(cv, 'pointerup', { pointerType: 'touch', pointerId: 3, clientX: X, clientY: Y, timeStamp: up });
    };
    for (const [k, row, s] of [[0.5, 1, 4], [1, 11, 15], [2, 6, 0]]) { hitAt(k, row, s); assert.equal(bit('st', DC.LANES909[row], s), 1, `k ${k}: row ${row} (lane ${DC.LANES909[row]}) step ${s + 1}`); }
    assert.equal(st(1, 4), '100', 'BD normal');
    hitAt(1, 1, 4); assert.equal(st(1, 4), '110', 'accented');
    hitAt(1, 1, 4); assert.equal(st(1, 4), '000', 'off');
    hitAt(1, 6, 0); assert.equal(st(6, 0), '000', 'RS: on ↔ off');
    hitAt(1, 2, 8, 700); assert.equal(st(2, 8), '101', 'a long press on SD: a flam');
    hitAt(1, 2, 8, 700); assert.equal(st(2, 8), '000', 'and back');
    hitAt(1, 6, 9, 700); assert.equal(st(6, 9), '100', 'RS takes no flam: a long press is a tap');
    placeEl(cv, 0, 0, 640, 272);
    const C = (row, s) => ({ clientX: 64 + s * 36 + 18, clientY: 32 + row * 20 + 10 });
    fire(cv, 'pointerdown', Object.assign({ pointerType: 'mouse', pointerId: 4, button: 0, altKey: true }, C(3, 2))); assert.equal(st(3, 2), '101', 'Alt-click: the LT flam');
    fire(cv, 'contextmenu', C(4, 3)); assert.equal(st(4, 3), '101', 'a right click: the MT flam');
    fire(cv, 'contextmenu', C(7, 3)); assert.equal(st(7, 3), '000', 'not on HC');
    fire(cv, 'focus'); key(cv, 'ArrowDown'); key(cv, 'f');
    assert.equal(st(5, 3), '101', 'F on the focused cell (from MT step 4 down: HT)');
    rafQ.flush();
    assert.match(cv.getAttribute('aria-label'), /^Step grid · pattern I-1-1 · HT step 4 flam$/);
    key(cv, 'ArrowUp'); key(cv, ' '); rafQ.flush();
    assert.match(cv.getAttribute('aria-label'), /· MT step 4 accented$/, 'Space: a flammed step\'s accent cycle, its flam dropped (S9\'s reading 8)');
    const head = (row, up) => { placeEl(cv, 0, 0, 640, 272); const Y = 32 + row * 20 + 10; fire(cv, 'pointerdown', { pointerType: 'touch', pointerId: 5, clientX: 20, clientY: Y, button: 0, timeStamp: 0 }); fire(cv, 'pointerup', { pointerType: 'touch', pointerId: 5, clientX: 20, clientY: Y, timeStamp: up }); };
    head(8, 100); assert.equal(m.R.D.x.mute, 1 << 11, 'CH (row 9): its lane bit 11 muted');
    head(10, 700); assert.equal(m.R.D.x.solo, 1 << 9, 'held: CR (lane 9) soloed');
    // the marks: a recording context sees each fill
    const rec = [];
    cv._ctx = new Proxy({ calls: [], canvas: cv }, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return s => ({ width: String(s).length * 6 }); if (typeof k === 'symbol') return undefined; return (...a) => { if (k === 'fillRect') rec.push([t.fillStyle, ...a]); t.calls.push([k, ...a]); }; }, set(t, k, v) { t[k] = v; return true; } });
    const st0 = m.R.D.st.slice(), ac0 = m.R.D.ac.slice(), fm0 = m.R.D.fm.slice();
    st0[0] = Array(16).fill(0); ac0[0] = Array(16).fill(0); fm0[0] = Array(16).fill(0);
    st0[0][0] = 2 | 1 << 6; st0[0][1] = 2; ac0[0][1] = 2; st0[0][2] = 4; fm0[0][2] = 4; st0[0][3] = 4; ac0[0][3] = 4; fm0[0][3] = 4;
    m.R.D = Object.assign({}, m.R.D, { st: st0, ac: ac0, fm: fm0, x: Object.assign({}, m.R.D.x, { mute: 0, solo: 0 }), keys: m.R.D.keys.map((K, i) => (i ? K : Object.assign({}, K, { l1: 8 }))) }); m.H.changed(m.tr); rafQ.flush();
    const X0 = s => 64 + s * 36, Y0 = row => 32 + row * 20;
    const marks = (row, s) => rec.filter(r => r[1] >= X0(s) + 2 && r[1] < X0(s) + 34 && r[2] >= Y0(row) + 2 && r[2] < Y0(row) + 18 && r[3] < 34).map(r => r.slice(1).join(',')).join(' ');
    assert.deepEqual([marks(1, 0), marks(1, 1), marks(2, 2), marks(2, 3), marks(6, 0)],
      [`${X0(0) + 8},${Y0(1) + 6},20,8`, `${X0(1) + 4},${Y0(1) + 4},28,12`, `${X0(2) + 4},${Y0(2) + 6},12,8 ${X0(2) + 20},${Y0(2) + 6},12,8`, `${X0(3) + 4},${Y0(2) + 4},12,12 ${X0(3) + 20},${Y0(2) + 4},12,12`, `${X0(0) + 4},${Y0(6) + 4},28,12`],
      'BD normal: a small mark; accented: a full one; SD flam: a double one (accented: full height); RS on: a full one');
    const cell = (row, s) => rec.find(r => r[1] === X0(s) + 1 && r[2] === Y0(row) + 1);
    assert.deepEqual([cell(2, 7)[0], cell(2, 8)[0], cell(2, 12)[0]], ['#1a1d22', '#121418', '#121418'], 'step 8 in, 9 and 13 past LAST STEP 8');
    assert.deepEqual([cv.width, cv.height], [640, 272]);
    m.r.destroy();
  });
});

test('7c pads: 4 × 3 (CR RD OH CH / LT MT HT AC / BD SD RS HC) in a music zone, by the 909\'s sound keys (its ride / crash on ids 7 / 8); AC a hold (127: "both"); the monitor lights them by sound id; REC writes the state the velocity names', () => {
  withRaf(() => {
    const m = mount(true, { nine: true }), g = W(m.root, 'dr:pads'), pad = s => g.childNodes.find(p => p.getAttribute('data-sound') === s);
    assert.deepEqual(g.childNodes.map(p => p.style.left + '/' + p.style.top + '/' + p.style.height).join(' '),
      ['8px', '68px', '128px'].flatMap(t => ['0px', '60px', '120px', '180px'].map(l => l + '/' + t + '/52px')).join(' '));
    assert.deepEqual([pad('rd').getAttribute('data-name'), pad('cr').getAttribute('aria-label'), pad('cp').getAttribute('data-code'), pad('cp').getAttribute('data-name'), pad('ac').getAttribute('data-name')], ['Ride', 'Crash pad', 'HC', 'Hand clap', 'Hold']);
    m.R.heard = NaN; m.H.mon(m.tr, { lit: 1 << 7 | 1 << 8, F: 0 }); m.frame();
    assert.deepEqual([pad('rd').getAttribute('data-hit'), pad('cr').getAttribute('data-hit'), pad('cy'), g.childNodes.filter(p => p.getAttribute('data-hit') != null).length], ['1', '1', undefined, 2], 'the monitor\'s sounds 7 / 8: the ride and the crash (the 909 has no cymbal pad; each pad its own parity, review 2 F3)');
    for (const p of g.childNodes) placeEl(p, 0, 0, 52, 52);
    fire(pad('rd'), 'pointerdown', { pointerId: 1, pointerType: 'touch', clientY: 52, button: 0 });
    fire(pad('ac'), 'pointerdown', { pointerId: 2, pointerType: 'touch', clientY: 0, button: 0 });
    fire(pad('cr'), 'pointerdown', { pointerId: 3, pointerType: 'touch', clientY: 0, button: 0 });
    assert.deepEqual(m.R.notes, [['on', 51, 1], ['on', 49, 1]], 'the ride (51) at its front edge; AC held: the crash (49) at 127');
    for (const [id, s] of [[1, 'rd'], [2, 'ac'], [3, 'cr']]) fire(pad(s), 'pointerup', { pointerId: id });
    assert.deepEqual(m.R.notes.slice(2), [['off', 51], ['off', 49]]);
    // REC in PATTERN WRITE (free, running): a pad at 127 writes "both" (its accent and TOTAL ACCENT)
    const A = m.api.drum;
    pw9(A, false); A.press({ k: 'rec', v: true });
    m.H.step(m.tr, 'i1', { s: 5, m: 0, k: 0, v: 0, p: 0, o: 1200, M: 0, F: 48000 }); m.R.heard = 48000 + 100;
    A.pads.on('bd', 1, 1);
    assert.deepEqual([(m.R.D.st[0][5] >> 1) & 1, (m.R.D.ac[0][5] >> 1) & 1, m.R.D.st[0][5] & 1], [1, 1, 1], 'BD accented + TOTAL ACCENT at step 6');
    m.r.destroy();
  });
});

test('7c the LEDs and the display at the heard time, ≤ 1 paint a frame: STEP write running — the voice\'s steps dim (normal) / on (accented), the playhead inverted; flam write its flams; the display the tempo, TRACK PLAY running the heard measure; SHIFT digits as typed; AVAILABLE MEAS the free measures', () => {
  withRaf(() => {
    const m = mount(true, { nine: true }), keys = stepKeys(m.root), A = m.api.drum, lit = () => keys.map(k => k.getAttribute('data-lit'));
    A.press({ k: 'hold', b: 'shift', down: true }); A.press({ k: 'tap', b: 'pat', n: 1 }); A.press({ k: 'hold', b: 'shift', down: false });
    const st = m.R.D.st.slice(), ac = m.R.D.ac.slice(), fm = m.R.D.fm.slice();
    st[0] = [2, 0, 2, 0, 2, ...Array(11).fill(0)]; ac[0] = [0, 0, 2, ...Array(13).fill(0)]; fm[0] = [0, 0, 0, 0, 2, ...Array(11).fill(0)];
    m.R.D = Object.assign({}, m.R.D, { st, ac, fm });
    m.R.playing = true; m.H.transport(true); m.R.heard = 0;
    const p0 = CD.drumStats.paints;
    for (let s = 0; s < 3; s++) m.H.step(m.tr, 'i1', { s: 2 * s, m: 0, k: 0, v: 0, p: 0, o: 480 * s, M: 0, F: 100 + s });
    m.frame(); rafQ.flush(); rafQ.flush();
    assert.equal(CD.drumStats.paints - p0, 1, 'three posts in a frame: one paint');
    assert.deepEqual(lit().slice(0, 6), ['dim', 'off', 'on', 'off', 'head-off', 'off'], 'BD: step 1 normal (dim), 3 accented, 5 under the playhead (dark)');
    A.press({ k: 'hold', b: 'isel', down: true }); A.press({ k: 'key', n: 1, down: true }); A.press({ k: 'key', n: 2, down: true });
    A.press({ k: 'key', n: 2, down: false }); A.press({ k: 'key', n: 1, down: false }); rafQ.flush();
    assert.deepEqual(lit().slice(0, 4), ['flash', 'flash', 'off', 'off'], 'INSTRUMENT SELECT held, flam write: both BD keys flashing');
    A.press({ k: 'hold', b: 'isel', down: false }); rafQ.flush();
    assert.deepEqual(lit().slice(0, 6), ['dim', 'off', 'dim', 'off', 'head-off', 'off'], 'flam write: the flams bright, the other steps dim');
    assert.equal(dsp9(m.root).textContent, '120');
    m.R.bpm = 97; m.H.bpm(97); rafQ.flush();
    assert.equal(dsp9(m.root).textContent, ' 97', 'synced: the project tempo');
    // TRACK PLAY running: the heard measure; SHIFT + digits as typed; AVAILABLE MEAS held
    m.R.D = Object.assign({}, m.R.D, { tk: [[0, 1, 2, 3, 4, 5], ...m.R.D.tk.slice(1)] });
    A.press({ k: 'tap', b: 'trk', n: 1 });
    m.H.step(m.tr, 'i1', { s: 0, m: 3, k: 3, v: 0, p: 0, o: 0, M: 3, F: 200 }); m.frame(); rafQ.flush();
    assert.deepEqual([dsp9(m.root).textContent, byN(m.root, 'dr:trk').map(b => b.getAttribute('data-lit')).join()], ['  4', 'on,off,off,off'], 'measure 4 heard; TRACK 1 lit');
    m.H.transport(false); A.press({ k: 'hold', b: 'shift', down: true }); A.press({ k: 'key', n: 1, down: true }); A.press({ k: 'key', n: 1, down: false }); A.press({ k: 'key', n: 2, down: true }); rafQ.flush();
    assert.deepEqual([dsp9(m.root).textContent, W(m.root, 'dr:enter').getAttribute('data-lit')], [' 12', 'flash'], 'SHIFT + 1, 2: "12", ENTER awaited');
    A.press({ k: 'release' }); A.press({ k: 'hold', b: 'avail', down: true }); rafQ.flush();
    assert.deepEqual([dsp9(m.root).textContent, W(m.root, 'dr:avail').getAttribute('data-lit')], ['890', 'on'], 'AVAILABLE MEAS held: the bank\'s free measures');
    m.r.destroy();
  });
});

test('7c without api.drum: the same nodes (the 909\'s, over its own fallback record), no listeners, aria-disabled; deterministic; the defaults painted; a record of another machine under a panel shows that panel\'s defaults', () => {
  const ser = n => n.localName + '.' + cls(n) + '[' + ['data-ctl', 'data-n', 'data-sound', 'role', 'aria-label', 'data-gesture'].map(a => n.getAttribute(a)).join('|') + ']' + JSON.stringify(n.style) + '(' + n.childNodes.filter(c => c.nodeType === 1).map(ser).join(',') + ')';
  withRaf(() => {
    const A = mount(false, { nine: true }), B = mount(true, { nine: true });
    assert.equal(ser(A.root), ser(B.root), 'the same nodes');
    for (const id of ['dr:shift', 'dr:isel', 'dr:clear', 'dr:start', 'dr:stop', 'dr:enter', 'dr:tempo', 'dr:sync', 'dr:demo']) {
      const el = W(A.root, id);
      assert.deepEqual([el.getAttribute('aria-disabled'), el.listenerCount('pointerdown') + el.listenerCount('pointerup') + el.listenerCount('keydown')], ['true', 0], id);
    }
    const keys = stepKeys(A.root), g = W(A.root, 'dr:pads');
    assert.deepEqual([keys.every(k => k.getAttribute('aria-disabled') === 'true' && k.listenerCount('pointerdown') === 0), byN(A.root, 'dr:trk').every(b => b.getAttribute('aria-disabled') === 'true'), g.listenerCount('pointerdown'), g.childNodes.every(p => p.getAttribute('aria-disabled') === 'true')], [true, true, 0, true]);
    assert.deepEqual([keys[0].getAttribute('data-lit'), dsp9(A.root).textContent, W(A.root, 'dr:tempo').getAttribute('aria-valuetext')], ['flash', '120', '120 BPM'], 'the 909\'s defaults painted');
    rafQ.flush(); // (B's first frame, before another mount's fresh document clears the queue)
    assert.equal(ser(A.root), ser(mount(false, { nine: true }).root), 'deterministic');
    // an 808 / 606 record under the 909's panel (a Replace undone before main re-renders the view): the 909's defaults, no throw
    B.api.drum.press({ k: 'tap', b: 'trk', n: 2 }); rafQ.flush();
    assert.equal(byN(B.root, 'dr:trk')[1].getAttribute('data-lit'), 'on');
    B.R.D = DC.normDrum(undefined); B.H.changed(B.tr); rafQ.flush();
    assert.deepEqual([byN(B.root, 'dr:trk')[1].getAttribute('data-lit'), byN(B.root, 'dr:pat')[0].getAttribute('data-lit')], ['off', 'on']);
    B.R.D = DC.normDrum(undefined, 'tr606'); B.H.changed(B.tr); rafQ.flush();
    assert.equal(dsp9(B.root).textContent, '120');
    const C = mount(true); C.R.D = DC.normDrum(undefined, 'tr909'); C.H.changed(C.tr); rafQ.flush();
    assert.deepEqual([W(C.root, 'dr:mode').getAttribute('aria-valuetext'), stepKeys(C.root)[0].getAttribute('data-lit')], ['Manual play', 'flash'], 'a 909 record under the 808\'s panel: the 808\'s defaults');
    const D6 = mount(true, { six: true }); D6.R.D = DC.normDrum(undefined, 'tr909'); D6.H.changed(D6.tr); rafQ.flush();
    assert.equal(W(D6.root, 'dr:mode').getAttribute('aria-valuetext'), 'Pattern play', 'and under the 606\'s: the 606\'s');
    A.r.destroy(); B.r.destroy(); C.r.destroy(); D6.r.destroy();
  });
});

test('7c the popovers: MAP… and SOUNDS… list the 909\'s eleven sounds by its names (the ride and crash on its own keys); SOUNDS… "circuit (ours)" for the analog voices, "our sound" and the chip swap for the hats, crash and ride', async () => {
  rafQ.install();
  try {
    const m = mount(true, { nine: true }), tapB = el => ptr(el, 'pointerup', 0, 0);
    const items = () => all(m.doc.body).filter(n => cls(n) === 'wk-ci' || /wk-ci /.test(cls(n)));
    const label = n => n.childNodes[1].textContent;
    const pick = text => { const it = items().find(n => label(n).startsWith(text)); assert.ok(it, text + ' in ' + items().map(label).join(' | ')); fire(it, 'pointerdown'); it.click(); };
    tapB(W(m.root, 'dr:map'));
    assert.deepEqual(items().map(label).slice(0, 11).map(t => t.split(' · ')[0]), ['Kick', 'Snare', 'Low tom', 'Mid tom', 'Hi tom', 'Rim shot', 'Hand clap', 'Ride', 'Crash', 'Open hat', 'Closed hat']);
    assert.equal(label(items()[7]), 'Ride · 51 (D#3), 59 (B3)');
    pick('Ride'); pick('No note');
    assert.deepEqual([m.R.D.map.rd, m.R.D.map.cr], [[], [49, 57]]);
    tapB(W(m.root, 'dr:sounds'));
    assert.deepEqual(items().map(label).slice(0, 11), ['Kick · circuit (ours)', 'Snare · circuit (ours)', 'Low tom · circuit (ours)', 'Mid tom · circuit (ours)', 'Hi tom · circuit (ours)', 'Rim shot · circuit (ours)',
      'Hand clap · circuit (ours)', 'Ride · our sound', 'Crash · our sound', 'Open hat · our sound', 'Closed hat · our sound']); // (review 2 F5: "ours" once)
    pick('Crash'); pick('Load');
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(m.R.D.smp.cr, { id: 'smp:0123456789abcdef', name: 'my cr', on: true });
    tapB(W(m.root, 'dr:sounds'));
    assert.equal(label(items()[8]), 'Crash · your sound: my cr (through the 909’s chip)');
    pick('Crash');
    assert.ok(items().some(n => label(n) === 'Your sound (through the 909’s chip): my cr') && items().some(n => label(n) === 'Our sound'), items().map(label).join(' | '));
    rafQ.flush();
    const cr = W(m.root, 'dr:pads').childNodes.find(p => p.getAttribute('data-sound') === 'cr');
    assert.deepEqual([cr.getAttribute('data-smp'), cr.getAttribute('title')], ['', 'Crash · your sound: my cr']);
    m.r.destroy();
  } finally { rafQ.uninstall(); }
});
