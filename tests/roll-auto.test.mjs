// roll.js + roll-auto.js: the automation lane in the roll's bottom strip (IMPL-AUTO §5, gate G5's node half) on the fake DOM of
// tests/wk-dom.mjs, against the stub host of tests/roll-auto-stub.mjs (§5.2's methods): autoAt (§2.3); the corner chip's label and
// size; the chooser's items (Velocity, the automated keys, inert ones greyed with a Delete, Add… grouped by module) and a pick;
// each gesture → exactly one host.autoEdit with the right points (tap empty, drag a point — x snaps, y free, never past a
// neighbour —, drag a segment, double-tap / long-press / Delete a point); the point and note selections exclusive; the readout
// (the family's formatter: the heard value, the value under the finger); two fingers never edit; an inert lane never edits; a
// host without the methods draws the roll as before.
// Run: node --max-old-space-size=2048 --test tests/roll-auto.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as dom from './wk-dom.mjs';
import * as S from '../song.js?v=9';
import { PianoRoll } from '../roll.js?v=9';
import { autoAt } from '../roll-auto.js?v=9';
import { autoHost, menuData, KEYS } from './roll-auto-stub.mjs';

// never a fake-DOM node into assert: primitives, else JSON
const safe = v => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
const eq = (a, b, m) => assert.equal(safe(a), safe(b), m);
const ok = (v, m) => assert.ok(!!v, m);

const W0 = 900, H0 = 560, VT = H0 - 72, PAD = 7, LH = 72 - 2 * PAD;
function mk(o = {}) {
  const W = o.w || W0, H = o.h || H0;
  const doc = dom.fresh();
  globalThis.window = doc.defaultView;
  dom.raf.install();
  const box = doc.createElement('div'); doc.body.appendChild(box);
  dom.place(box, 0, 0, W, H);
  const p = S.newProject({ model: 'x', name: 't' });
  const tr = p.tracks[0];
  tr.notes.push(...(o.notes || []).map((n, i) => ({ id: 1000 + i, ...n })));
  if (o.auto) tr.auto = JSON.parse(JSON.stringify(o.auto));
  const A = o.plain ? null : autoHost();
  if (A && o.lane) A.lanes.set(tr.id, o.lane);
  const log = [];
  const host = Object.assign({
    getProject: () => p, getTrack: () => tr,
    edit: (l, fn) => { log.push('edit:' + l); fn(); }, beginEdit: l => log.push('begin:' + l), endEdit: () => log.push('end'), changed: () => {},
    audition: () => {}, auditionOff: () => {}, getPlayhead: () => 0, setPlayhead: () => {}, setLoop: () => {}, getSnap: () => p.snap,
    onSelect: n => log.push('sel' + n), touch: !!o.touch,
  }, A || {}, o.host || {});
  const roll = new PianoRoll(box, host);
  dom.place(roll.el, 0, 0, W, H);
  dom.raf.flush(2);
  roll.ppt = 0.1; roll.sx = 0; roll._view(); F(); // (t2x(t) = 64 + t / 10)
  return { roll, p, tr, A, log, edits: () => (A ? A.log.filter(e => e.op === 'edit') : []) };
}
let T = 5000;
const F = () => dom.raf.flush(1);
const X = t => 64 + t / 10;
const Y = (v, lo = 0, hi = 10) => VT + PAD + (1 - (v - lo) / (hi - lo)) * LH;
const ev = (pt, id, o) => Object.assign({ pointerId: id, pointerType: pt, isPrimary: id === 1, timeStamp: (T += 30) }, o);
const pd = (r, x, y, pt = 'mouse', id = 1, o) => dom.ptr(r.el, 'pointerdown', x, y, ev(pt, id, o));
const pm = (r, x, y, pt = 'mouse', id = 1, o) => dom.ptr(r.el, 'pointermove', x, y, ev(pt, id, o));
const pu = (r, x, y, pt = 'mouse', id = 1, o) => dom.ptr(r.el, 'pointerup', x, y, ev(pt, id, o));
const tap = (r, x, y, pt = 'mouse') => { T += 1000; pd(r, x, y, pt); pu(r, x, y, pt); F(); };
const drag = (r, x0, y0, x1, y1, pt = 'mouse', o) => { T += 1000; pd(r, x0, y0, pt, 1, o); for (let k = 1; k <= 6; k++) pm(r, x0 + (x1 - x0) * k / 6, y0 + (y1 - y0) * k / 6, pt, 1, o); pu(r, x1, y1, pt, 1, o); F(); };
const CF = { 'i1:cf': { pts: [[960, 2], [1920, 8], [2880, 4]] } };

/* ------------------------------------------------------------------ autoAt (§2.3, the local copy until P0M's S.autoAt) */
test('autoAt: none → undefined; before the first its value, after the last the last\'s; linear between; exact at a point', () => {
  const P = [[100, 2], [200, 6], [300, 6], [301, 0]];
  eq([autoAt([], 5), autoAt(null, 5)], [undefined, undefined], 'empty');
  eq([autoAt(P, 0), autoAt(P, 100), autoAt(P, 150), autoAt(P, 200), autoAt(P, 250), autoAt(P, 300), autoAt(P, 301), autoAt(P, 9999)], [2, 2, 4, 6, 6, 6, 0, 0], 'values');
  eq(autoAt(P, 300.5), 3, 'the jump pair is a one-tick ramp');
  eq(autoAt([[50, 7]], 10), 7, 'one point: flat');
});

/* ------------------------------------------------------------------ the chip and the chooser */
test('a host without the automation methods: the strip is the velocity lane, the corner says VEL, no chip, no menu', () => {
  const { roll } = mk({ plain: true });
  eq(roll._region(300, VT + 20), 'vel', 'region');
  ok(roll.el.getContext('2d') && roll.bctx.calls.some(c => c[0] === 'fillText' && c[1] === 'VEL'), 'VEL drawn');
  eq(roll.autoChip(), null, 'no chip');
  eq(roll.openAutoMenu(), false, 'no menu');
});

test('the chip: "▾ Vel" on the velocity lane, "▾ <short>" on a curve; 55 × 20 with a mouse, ≥ 44 × 44 on touch, the drum gutter\'s width; a long name ellipsized to fit', () => {
  const { roll, A, tr } = mk({ auto: CF });
  let c = roll.autoChip();
  eq([c.label, c.text, c.x, c.y, c.w, c.h], ['▾ Vel', '▾ Vel', 4, VT + 4, 55, 20], 'velocity, mouse');
  A.setAutoLane(tr, 'i1:cf'); roll.render(); F();
  c = roll.autoChip();
  eq(c.label, '▾ Cutoff', 'a curve');
  // (the fake's measureText: 6 px a character at any size — 8 of them overflow; Chrome measures the real fit: ui-layout-roll-auto)
  ok((c.text === c.label || (c.text.endsWith('…') && c.label.startsWith(c.text.slice(0, -1)))) && c.tw <= c.w - 10, 'fits: ' + c.text + ' ' + c.tw);
  eq(roll._region(300, VT + 20), 'auto', 'the strip is the lane');
  eq(roll._region(30, VT + 20), 'velg', 'the corner');
  A.setAutoLane(tr, 'i1:em'); roll.render(); F();
  c = roll.autoChip();
  ok(c.text.endsWith('…') && c.tw <= c.w - 10 && c.label === '▾ Emphasis', 'ellipsized: ' + c.text + ' ' + c.tw);
  const t = mk({ touch: true }).roll.autoChip();
  ok(t.w >= 44 && t.h >= 44 && t.y + t.h <= H0, 'touch: ' + t.w + ' × ' + t.h);
  const d = mk({ host: { drumRows: () => [{ n: 36, name: 'Kick' }] } }).roll.autoChip();
  eq(d.w, 120 - 9, 'the drum gutter');
});

test('a tap on the chip opens host.menu below it: Velocity, the automated keys (an inert one greyed with a Delete), a separator, Add… grouped by module; a pick sets the lane', () => {
  const { roll, A, tr, edits } = mk({ auto: Object.assign({ 'i1:gone': { pts: [[0, 1]] } }, CF) });
  tap(roll, 30, VT + 14);
  eq(A.menus.length, 1, 'one menu');
  const m = A.menus[0], D = menuData(m.items);
  eq([m.x, m.y], [4, VT + 24], 'under the chip (client px)');
  eq(D.map(x => (x === '—' ? x : x.label)), ['Velocity', 'i1:gone (no such control)', 'Delete i1:gone automation', 'Minimoog · Cutoff', '—', 'Add…'], 'labels');
  eq([D[0].checked, D[1].disabled, D[2].disabled, D[3].checked], [true, true, false, false], 'flags');
  eq(D[5].sub.map(g => [g.label, g.sub.map(x => x.label)]), [['Minimoog', ['Emphasis']], ['Reverb 1', ['Size']], ['Mixer', ['Volume', 'Pan']]], 'Add… by module, the automated ones left out');
  m.items[5].sub[2].sub[0].action();
  eq([A.lanes.get(tr.id), roll.autoChip().label], ['mix:vol', '▾ Volume'], 'picked from Add…');
  tap(roll, 30, VT + 14);
  const D2 = menuData(A.menus[1].items);
  eq(D2.map(x => (x === '—' ? x : x.label + (x.checked ? ' ✓' : ''))).slice(0, 5), ['Velocity', 'i1:gone (no such control)', 'Delete i1:gone automation', 'Minimoog · Cutoff', 'Volume ✓'], 'the new lane listed, checked');
  A.menus[1].items[2].action();
  eq([edits().length, edits()[0].key, edits()[0].label, edits()[0].pts], [1, 'i1:gone', 'Automation: i1:gone', []], 'Delete: one edit, no points');
  ok(!('i1:gone' in tr.auto), 'removed');
  A.menus[1].items[0].action();
  eq(A.lanes.get(tr.id), 'vel', 'back to Velocity');
});

test('the chip: a drag off it or a second finger opens nothing; touch taps it as a mouse does', () => {
  const { roll, A } = mk({ touch: true });
  drag(roll, 30, VT + 14, 30, VT - 60, 'touch');
  eq(A.menus.length, 0, 'a drag');
  T += 1000; pd(roll, 30, VT + 14, 'touch', 1); pd(roll, 300, VT + 20, 'touch', 2); pu(roll, 30, VT + 14, 'touch', 1); pu(roll, 300, VT + 20, 'touch', 2); F();
  eq(A.menus.length, 0, 'two fingers');
  tap(roll, 30, VT + 14, 'touch');
  eq(A.menus.length, 1, 'a tap');
});

/* ------------------------------------------------------------------ gestures */
test('tap the empty lane: one edit — a point at the snapped tick and the y value; it is selected and the note selection cleared', () => {
  for (const pt of ['mouse', 'touch']) {
    const { roll, edits, tr } = mk({ lane: 'i1:cf', touch: pt === 'touch', notes: [{ t: 0, d: 480, n: 60, v: 100 }] });
    roll.selectAll();
    tap(roll, X(1010), Y(7.5), pt);
    eq(edits().map(e => [e.key, e.label, e.pts]), [['i1:cf', 'Automation: Cutoff', [[960, 7.5]]]], pt + ': one edit');
    eq([roll.autoSelected(), roll.getSelection().length], [960, 0], pt + ': selections');
    eq(tr.auto['i1:cf'].pts, [[960, 7.5]], pt + ': stored');
    tap(roll, X(1910), Y(10.4), pt);
    eq(edits()[1].pts, [[960, 7.5], [1920, 10]], pt + ': clamped to the range');
  }
  const { roll, edits, p } = mk({ lane: 'mix:pan' });
  p.snap = 0;
  tap(roll, X(1234), Y(-0.5, -1, 1));
  eq(edits()[0].pts, [[1234, -0.5]], 'snap off; the range −1…1');
});

test('tap on a point selects it (no edit); a second tap there deletes it; a double-tap on the empty lane makes one point, not a delete', () => {
  const { roll, edits } = mk({ lane: 'i1:cf', auto: CF });
  T += 1000; pd(roll, X(1920), Y(8)); pu(roll, X(1920), Y(8)); F();
  eq([edits().length, roll.autoSelected()], [0, 1920], 'selected');
  pd(roll, X(1920) + 1, Y(8)); pu(roll, X(1920) + 1, Y(8)); F();
  eq(edits().map(e => e.pts), [[[960, 2], [2880, 4]]], 'deleted');
  eq(roll.autoSelected(), null, 'the selection with it');
  T += 1000; pd(roll, X(4800), Y(5)); pu(roll, X(4800), Y(5)); pd(roll, X(4800), Y(5)); pu(roll, X(4800), Y(5)); F();
  eq([edits().length, edits()[1].pts.length, roll.autoSelected()], [2, 3, 4800], 'one point added, selected');
});

test('a finger held still on a point deletes it (one edit); a touch double-tap too', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { roll, edits } = mk({ lane: 'i1:cf', auto: CF, touch: true });
  T += 1000; pd(roll, X(960) + 5, Y(2) - 4, 'touch');
  t.mock.timers.tick(520);
  pu(roll, X(960) + 5, Y(2) - 4, 'touch'); F();
  eq(edits().map(e => e.pts), [[[1920, 8], [2880, 4]]], 'held');
  T += 1000; pd(roll, X(2880), Y(4), 'touch'); pu(roll, X(2880), Y(4), 'touch'); pd(roll, X(2880) + 6, Y(4), 'touch'); pu(roll, X(2880) + 6, Y(4), 'touch'); F();
  eq(edits().length, 2, 'double-tap');
  eq(edits()[1].pts, [[1920, 8]], 'deleted');
});

test('drag a point: x snaps, y free (no snap), never past a neighbour; one edit at the release; the selection follows', () => {
  const { roll, edits } = mk({ lane: 'i1:cf', auto: CF });
  drag(roll, X(1920), Y(8), X(2290), Y(6.27));
  eq(edits().length, 1, 'one edit');
  eq(edits()[0].pts, [[960, 2], [2400, 6.27], [2880, 4]], 'moved: 2290 → the 240 grid, 6.27 kept');
  eq(roll.autoSelected(), 2400, 'selected');
  drag(roll, X(2400), Y(6.27), X(3600), Y(6.27));
  eq(edits()[1].pts, [[960, 2], [2879, 6.27], [2880, 4]], 'stops one tick before the next point');
  drag(roll, X(960), Y(2), X(0) - 40, Y(2));
  eq(edits()[2].pts[0], [0, 2], 'not before 0');
  const before = edits().length;
  T += 1000; pd(roll, X(0), Y(2)); pm(roll, X(0) + 1, Y(2)); pu(roll, X(0) + 1, Y(2)); F();
  eq(edits().length, before, 'a wobble is no drag');
});

test('touch: a point drag mostly up keeps its tick (time follows after 10 px sideways); the readout shows the value under the finger', () => {
  const { roll, edits } = mk({ lane: 'i1:cf', auto: CF, touch: true });
  T += 1000; pd(roll, X(1920), Y(8), 'touch');
  for (let k = 1; k <= 5; k++) pm(roll, X(1920) + k, Y(8) + 4 * k, 'touch');
  F();
  const v = +(8 - 20 / LH * 10).toPrecision(12), want = KEYS['i1:cf'].fmt(Math.round(v * 1000) / 1000);
  eq(roll.autoReadout(), want, 'the value under the finger');
  pu(roll, X(1920) + 5, Y(8) + 20, 'touch'); F();
  eq(edits()[0].pts[1][0], 1920, 'its tick kept');
  ok(Math.abs(edits()[0].pts[1][1] - v) < 1e-3, 'its value: ' + edits()[0].pts[1][1]);
});

test('drag a segment: both ends move in y by the same amount (clamped), the other points stay; one edit', () => {
  const { roll, edits } = mk({ lane: 'i1:cf', auto: CF });
  const x = X(1440), y = Y(5); // (the middle of 960 → 1920, 2 → 8)
  drag(roll, x, y, x + 30, y - LH * 0.1);
  eq(edits().length, 1, 'one edit');
  eq(edits()[0].pts, [[960, 3], [1920, 9], [2880, 4]], 'lifted by 1');
  drag(roll, x, Y(6), x, Y(6) - LH);
  eq(edits()[1].pts, [[960, 10], [1920, 10], [2880, 4]], 'clamped');
});

test('a drag on the empty lane: a finger scrolls time only, a mouse does nothing; neither edits', () => {
  for (const pt of ['touch', 'mouse']) {
    const { roll, edits } = mk({ lane: 'i1:cf', auto: CF, touch: pt === 'touch' });
    roll.sx = 2000; roll._view(); F();
    const sx = roll.sx, sy = roll.sy;
    drag(roll, 700, Y(0.5), 600, Y(0.5) - 30, pt);
    eq(edits().length, 0, pt + ': no edit');
    if (pt === 'touch') eq([Math.round(roll.sx), roll.sy], [Math.round(sx + 100 / roll.ppt), sy], 'touch: time scrolled, the rows held');
    else eq([roll.sx, roll.sy], [sx, sy], 'mouse: no scroll');
  }
});

test('Delete (roll.deleteSelected) removes the selected point — one edit —; with notes selected it deletes the notes; the two selections exclude each other', () => {
  const { roll, edits, log, tr } = mk({ lane: 'i1:cf', auto: CF, notes: [{ t: 0, d: 480, n: 60, v: 100 }] });
  tap(roll, X(2880), Y(4));
  eq(roll.autoSelected(), 2880, 'a point');
  eq(roll.deleteSelected(), 1, 'deleted');
  eq([edits().length, edits()[0].pts], [1, [[960, 2], [1920, 8]]], 'one edit');
  eq(roll.deleteSelected(), 0, 'nothing left selected');
  tap(roll, X(1920), Y(8));
  roll.selectAll();
  eq([roll.autoSelected(), roll.getSelection().length], [null, 1], 'notes clear the point');
  tap(roll, X(960), Y(2));
  eq([roll.autoSelected(), roll.getSelection().length], [960, 0], 'a point clears the notes');
  roll.selectAll();
  eq(roll.deleteSelected(), 1, 'the note');
  eq([tr.notes.length, edits().length, log.includes('edit:Delete notes')], [0, 1, true], 'notes, not points');
  tap(roll, X(960), Y(2));
  roll.selectNone();
  eq(roll.autoSelected(), null, 'Esc / None clears the point too');
});

test('two fingers never edit: a point drag, a segment drag and a pending tap each dropped by a second finger (the pinch goes on); a two-finger pan on the lane is time', () => {
  const { roll, edits, tr } = mk({ lane: 'i1:cf', auto: CF, touch: true });
  const cases = [[X(1920), Y(8)], [X(1440), Y(5)], [X(4000), Y(5)]];
  for (const [x, y] of cases) {
    T += 1000; pd(roll, x, y, 'touch', 1);
    for (let k = 1; k <= 4; k++) pm(roll, x + 5 * k, y - 5 * k, 'touch', 1);
    pd(roll, x + 200, y - 300, 'touch', 2);
    eq([roll.g && roll.g.type, roll.g && roll.g.zone], ['pinch', 'time'], 'a pinch');
    pm(roll, x + 40, y - 40, 'touch', 1); pm(roll, x + 260, y - 340, 'touch', 2); F();
    pu(roll, x + 40, y - 40, 'touch', 1); pu(roll, x + 260, y - 340, 'touch', 2); F();
  }
  eq(edits().length, 0, 'no edit');
  eq(tr.auto['i1:cf'].pts, CF['i1:cf'].pts, 'the curve as it was');
  ok(!roll.adraw || roll.adraw.segs === 3, 'the preview dropped');
});

test('the readout: the heard value at the playhead in the family\'s format; the lane draws the curve in the track\'s tint with its dots, the selected one white', () => {
  const { roll, tr, A } = mk({ lane: 'mix:vol', auto: { 'mix:vol': { pts: [[0, 1], [3840, 0.5]] } } });
  roll.setPlayhead(1920, true);
  eq(roll.autoReadout(), KEYS['mix:vol'].fmt(0.75), 'heard at 1920');
  eq(roll.autoReadout(), '−2.5 dB', 'the stub\'s dB');
  ok(roll.aread && roll.aread.x >= 64 && roll.aread.y >= VT && roll.aread.y + roll.aread.h <= H0, 'inside the lane');
  roll.setPlayhead(99999, true);
  eq(roll.autoReadout(), '−6.0 dB', 'after the last point');
  tap(roll, X(3840), Y(0.5, 0, 1.25)); roll.render(); F();
  eq([roll.adraw.col, roll.adraw.dots, roll.adraw.sel], ['rgb(' + parseInt(tr.color.slice(1, 3), 16) + ',' + parseInt(tr.color.slice(3, 5), 16) + ',' + parseInt(tr.color.slice(5, 7), 16) + ')', 2, 1], 'tint, dots, selected');
  A.setAutoLane(tr, 'i1:cf'); roll.render(); F();
  eq([roll.autoReadout(), roll.adraw.segs], ['', 0], 'an empty lane: no readout');
});

test('an inert lane (no such control) never edits; the velocity lane still edits velocities', () => {
  const { roll, edits, tr, A } = mk({ lane: 'i1:gone', auto: { 'i1:gone': { pts: [[0, 1], [960, 2]] } }, notes: [{ t: 960, d: 480, n: 60, v: 100 }] });
  tap(roll, X(500), Y(5)); drag(roll, X(960), Y(2, 0, 1), X(1200), Y(0, 0, 1));
  eq([edits().length, roll.adraw.ok], [0, false], 'nothing');
  A.setAutoLane(tr, 'vel'); roll.render(); F();
  eq(roll._region(300, VT + 20), 'vel', 'the velocity lane');
  drag(roll, X(960), roll.v2y(100), X(960), roll.v2y(50));
  ok(tr.notes[0].v < 100 && edits().length === 0, 'a velocity: ' + tr.notes[0].v);
});

// fix 14 (R2 P3): the empty lane's hint readable (≥ 4.5 : 1 on the lane); the readout pill on the side away from the playhead
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
test('fix 14: the empty lane\'s hint is ≥ 4.5 : 1 on the lane\'s ground', () => {
  const { roll } = mk({ lane: 'i1:cf' }), seen = [];
  for (const c of [roll.ctx, roll.bctx]) c.fillText = s => { if (/add a point/.test(s)) seen.push(String(c.fillStyle)); };
  roll.render(); F();
  ok(seen.length > 0, 'the hint drawn');
  eq(seen.every(f => /^#[0-9a-f]{6}$/i.test(f) && contrast(f, '#0c0d0f') >= 4.5), true, 'contrast of ' + seen.join(', '));
});
test('fix 14: the readout pill sits away from the playhead — right of it when the playhead is under the left corner, at the left otherwise; never over the heard dot', () => {
  const { roll } = mk({ lane: 'mix:vol', auto: { 'mix:vol': { pts: [[0, 1], [3840, 0.5]] } } });
  roll.setPlayhead(100, true); F();
  const a = roll.aread, px = X(100);
  ok(a && (a.x > px + 6 || a.x + a.w < px - 6) && a.x + a.w <= W0, 'clear of the playhead at ' + px + ': ' + safe(a && [a.x, a.w]));
  roll.setPlayhead(5000, true); F();
  eq(roll.aread.x, 64 + 6, 'at the left, the playhead far right');
});
