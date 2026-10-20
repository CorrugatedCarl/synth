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

/* ================================================================ phase 2: the host and the widgets (§7.4, §12.7) */
const r3 = v => Math.round(v * 1000) / 1000;
const cls = n => n.getAttribute('class') || '';
const byCtl = (root, id) => all(root).filter(n => n.getAttribute && n.getAttribute('data-ctl') === id);
const W = (root, id) => { const w = byCtl(root, id)[0]; return w ? w.childNodes[0] : null; };
const stepKeys = root => byCtl(root, 'dr:step').map(w => w.childNodes[0]);
// a fake main.js: the device's record, the transport, the heard frame, the notes, the notices, a manual frame clock
function rig(o = {}) {
  const tr = { id: 't1' };
  const R = { D: DC.normDrum(o.D), log: [], sent: [], notes: [], notices: [], heard: NaN, rate: 48000, playing: false, bpm: 120, sel: true, frames: [], confirm: true };
  const deps = {
    mem: t => (t && t.id === 't1' ? R.D : null), put: (t, D) => { R.D = D; },
    send: (t, D, S, at) => R.sent.push(at), play: () => R.log.push('play'), stop: () => R.log.push('stop'),
    playing: () => R.playing, bpm: () => R.bpm, setBpm: (v, ph) => R.log.push('bpm ' + v + ' ' + ph),
    heard: () => R.heard, rate: () => R.rate,
    noteOn: (t, n, v) => R.notes.push(['on', n, r3(v)]), noteOff: (t, n) => R.notes.push(['off', n]),
    sel: () => R.sel, notice: (text, ms, tap) => R.notices.push({ text, tap }), toRoll: (t, b) => R.log.push('toRoll ' + b),
    confirm: () => R.confirm, loadSample: (t, s) => Promise.resolve({ id: 'smp:0123456789abcdef', name: 'my ' + s }),
    learn: (t, fn) => { R.learn = fn; return () => { R.learn = null; }; }, monitor: (t, on) => R.log.push('mon ' + on), loop: () => R.loop,
    raf: f => R.frames.push(f),
  };
  const H = CD.drumHost(deps);
  const frame = () => { const q = R.frames.splice(0); for (const f of q) f(); };
  return { tr, R, H, deps, frame };
}
// cv-panel's hw api in miniature (classic-panel's contract: dragB with o.tap and b.end, tap with the event)
function fakeApi(doc) {
  const vals = {}, ui = new Map(), tips = [];
  for (const c of M808.controls) vals[c.id] = c.def;
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
function mount(withHost, o) {
  const doc = fresh(), root = doc.createElement('div'), api = fakeApi(doc), g = withHost ? rig(o) : null;
  if (g) { // (every press the widgets make, TAP's included, recorded as JSON)
    api.drum = g.H.api(g.tr); g.presses = [];
    const p = api.drum.press, t = api.drum.tap;
    api.drum.press = (i, ph) => { g.presses.push(JSON.stringify(i)); return p(i, ph); };
    api.drum.tap = ts => { g.presses.push('{"k":"tap"}'); return t(ts); };
  }
  doc.body.append(root);
  const r = P.render(root, TR_FX, M808, api);
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
