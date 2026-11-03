import './v8-guard.mjs';
// cv-modlayer.js (stage 2a lane C; docs/canvas/IMPL-2a.md §4) on tests/wk-dom.mjs: the refusal texts (SPEC §2.13), the
// inspector (every control → host.edit with the right fields, one host.step per gesture end; Save with preset / Keep on
// canvas → toPreset / fromPreset and close, refused or disabled when the matrix is full; Disconnect → remove), its closing
// (Escape, a press outside — the aux menu's list excepted —, the camera's closeTransient, ✕), the Mod list (grouped by
// device, budgets, "preset" / "not compiled: matrix full" tags, tap → inspector, Disconnect all with a confirm) and the
// parameter list (groups, nomod greyed with a title and a tap's notice, pick → connect, refusals as notices).
// Never pass fake-DOM nodes to assert.*: strings, numbers and booleans only.
// Run alone: node --max-old-space-size=2048 --test tests/cv-modlayer.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as ML from '../cv-modlayer.js?v=9';
import * as wk from '../wk.js?v=9';
import { RIG } from '../rig-core.js?v=9';
import { fresh, all, byCls, one, byAttr, ptr, key, place } from './wk-dom.mjs';

/* ---------------------------------------------------------------- a scripted host */
const ROW = { bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, rise: 0, fall: 0, slink: 0, crv: null };
const LABELS = { wheel: 'Mod Wheel', 've.out': 'Velocity', 'at.out': 'Aftertouch', i2: 'Serum 1', i3: 'Serum 2',
  'i2:f.cutoff': 'Cutoff', 'i2:a.level': 'A Level', 'i2:fx.d1.mix': 'Delay Mix', 'i3:a.level': 'A Level' };
const DESCS = [
  { id: 'f.cutoff', label: 'Cutoff', group: 'Filter 1' }, { id: 'f.res', label: 'Res', group: 'Filter 1' },
  { id: 'a.level', label: 'Level', group: 'Osc A' }, { id: 'a.mode', label: 'Mode', group: 'Osc A', nomod: true },
  { id: 'fx.d1.mix', label: 'Mix', group: 'FX Delay' },
];
const K = k => typeof k === 'string' ? k : k.preset + '#' + k.slot;
function mkHost(doc, o = {}) {
  const log = [];
  const rows = [
    Object.assign({ id: 'r1', src: 'wheel', dst: 'i2:f.cutoff', amt: 0.5 }, ROW),
    Object.assign({ id: 'r2', src: 've.out', dst: 'i2:fx.d1.mix', amt: -0.25 }, ROW, { bi: 1, byp: 1 }),
    Object.assign({ id: 'r3', src: 'at.out', dst: 'i3:a.level', amt: 1 }, ROW),
  ];
  const pre = { i2: [Object.assign({ slot: 5, src: 'velo', dst: 'a.level', amt: 0.3 }, ROW)] };
  const find = k => typeof k === 'string' ? rows.find(r => r.id === k) : (pre[k.preset] || []).find(r => r.slot === k.slot);
  const H = {
    doc, log, rows, pre, answer: true,
    descs: () => (o.descs || DESCS).map(d => Object.assign({}, d)),
    sources: () => [{ id: 'wheel', label: 'Mod Wheel' }, { id: 've.out', label: 'Velocity' }, { id: 'lfo1', label: 'LFO 1', group: 'LFOs' }, { id: 'bogus', label: 'Nope' }],
    rowsOf: dev => rows.filter(r => dev === undefined || r.dst.split(':')[0] === dev),
    presetRows: dev => (pre[dev] || []).map(r => Object.assign({}, r)),
    budget: dev => o.budget ? o.budget(dev) : { preset: (pre[dev] || []).length + 20, canvas: rows.filter(r => r.dst.startsWith(dev + ':')).length, left: [], max: 64 },
    edit: (k, f) => { log.push('edit ' + K(k) + ' ' + JSON.stringify(f)); const r = find(k); Object.assign(r, f); return Object.assign({}, r); },
    remove: k => {
      log.push('remove ' + K(k));
      if (typeof k === 'string') rows.splice(rows.findIndex(r => r.id === k), 1); else pre[k.preset] = pre[k.preset].filter(r => r.slot !== k.slot);
    },
    toPreset: id => { log.push('toPreset ' + id); return o.toPreset ? o.toPreset(id) : { ok: true }; },
    fromPreset: (dev, slot) => { log.push('fromPreset ' + dev + ' ' + slot); return { ok: true }; },
    connect: (src, dst) => { log.push('connect ' + src + ' ' + dst); return o.connect ? o.connect(src, dst) : { ok: true }; },
    select: id => log.push('select ' + id),
    notice: t => log.push('notice ' + t),
    labelOf: id => LABELS[id] || '',
    step: l => log.push('step ' + l),
    confirm: t => { log.push('confirm ' + t); return H.answer; },
  };
  return H;
}
function setup(o) {
  const doc = fresh(), H = mkHost(doc, o), M = ML.createModLayer(H);
  return { doc, H, M, pop: () => one(doc.body, 'cv-ml-pop'), pops: () => byCls(doc.body, 'cv-ml-pop').length };
}
const lab = (root, l) => byAttr(root, 'aria-label', l)[0] || null;
const act = (root, a) => byAttr(root, 'data-act', a)[0] || null;
const take = H => H.log.splice(0);

/* ---------------------------------------------------------------- pure */
test('refusal texts (SPEC §2.13), pct / parsePct, the source maps, STYLE', () => {
  assert.equal(ML.refusal('nomod'), 'This knob can\'t be modulated');
  assert.equal(ML.refusal('full', { dev: 'Serum 1' }), 'Serum 1\'s mod rows are full (64/64)');
  assert.equal(ML.refusal('full', { dev: 'Serum 2', used: 70, max: 64 }), 'Serum 2\'s mod rows are full (64/64)');
  assert.equal(ML.refusal('full'), RIG.NAME + '\'s mod rows are full (64/64)'); // (SX0: a host that names no device: the Serum-engine instrument's own name)
  assert.equal(ML.refusal('stage', { src: 'Mod Wheel', dst: 'Cutoff' }), 'Mod Wheel → Cutoff: this knob can be modulated from stage 2b');
  assert.equal(ML.refusal('2b'), 'This knob can be modulated from stage 2b');
  assert.equal(ML.refusal(undefined, { stage: '5', src: 'Velocity', dst: 'Attack' }), 'Velocity → Attack: this knob can be modulated from stage 5');
  assert.equal(ML.refusal('cycle', { why: 'That would make a loop' }), 'That would make a loop');
  assert.equal(ML.refusal('x'), 'Can\'t connect that');
  assert.deepEqual([ML.pct(0.5), ML.pct(-0.25), ML.pct(0), ML.pct(-0.001), ML.pct(NaN)], ['+50%', '-25%', '0%', '0%', '0%']);
  assert.deepEqual([ML.parsePct('25'), ML.parsePct('+25%'), ML.parsePct('-40 %'), ML.parsePct('−40'), ML.parsePct('250'), ML.parsePct('x'), ML.parsePct('-5', true)],
    [0.25, 0.25, -0.4, -0.4, 1, null, 0]);
  assert.deepEqual([ML.NATIVE['ve.out'], ML.NATIVE['bd.out'], ML.CANVAS.velo, ML.CANVAS.wheel, ML.MAX_ROWS], ['velo', 'bend', 've.out', 'wheel', 64]);
  for (const c of ['.cv-ml-pop', '.cv-ml-h', '.cv-ml-b', '.cv-ml-tag', '.cv-ml-btn', '.cv-ml-item', '.cv-ml-grp', '.cv-ml-list', '.cv-ml-dev', '.cv-ml-line'])
    assert.ok(ML.STYLE.includes(c), c);
  assert.ok(!/min-height/.test(ML.STYLE), 'no min-height (iPad rule): fixed 44 px heights, ::before hit areas');
  assert.ok(/height: 44px/.test(ML.STYLE), '44 px touch targets');
  const doc = fresh(), M = ML.createModLayer(mkHost(doc));
  assert.deepEqual(Object.keys(M).sort(), ['STYLE', 'close', 'isOpen', 'openDestList', 'openInspector', 'openList', 'refusal', 'sync']);
  assert.equal(M.refusal('nomod'), ML.refusal('nomod'));
});

/* ---------------------------------------------------------------- the inspector */
test('inspector: header "<source> → <knob>", the budget "n/64", select; amount slider + number box: host.edit per move, one step per gesture', () => {
  const { doc, H, M, pop } = setup();
  M.openInspector('r1', 0, 0); M.close(); // (the kit's own document listeners install on first use)
  const base = doc.listenerCount('pointerdown');
  take(H);
  assert.equal(M.openInspector('r1', 100, 120), true);
  const p = pop();
  assert.deepEqual([p.getAttribute('data-kind'), p.getAttribute('role'), p.parentNode === doc.body, M.isOpen()], ['insp', 'dialog', true, true]);
  assert.deepEqual([one(p, 'cv-ml-t').textContent, one(p, 'cv-ml-b').textContent, one(p, 'cv-ml-b').hasAttribute('data-full')], ['Mod Wheel → Cutoff', '23/64', false]);
  assert.deepEqual(byCls(p, 'cv-ml-tag').filter(t => !t.hidden).map(t => t.textContent), [], 'a compiled canvas row: no tag');
  assert.deepEqual([p.style.left, p.style.top], ['100px', '120px']);
  assert.deepEqual(take(H), ['select r1']);
  const amt = lab(p, 'Amount'), box = lab(p, 'Amount %');
  assert.deepEqual([amt.getAttribute('aria-valuetext'), box.getAttribute('aria-valuetext')], ['+50%', '+50%']);
  key(amt, 'ArrowRight'); // a key step: one edit, one step
  assert.deepEqual(take(H), ['edit r1 {"amt":0.52}', 'step Mod amount']);
  assert.equal(box.getAttribute('aria-valuetext'), '+52%', 'the number box follows the slider');
  key(box, 'ArrowDown');
  assert.deepEqual(take(H), ['edit r1 {"amt":0.51}', 'step Mod amount']);
  // a drag on the thumb: start, moves (live edits), lift (one step)
  const trk = one(amt, 'wk-slt'), thumb = one(amt, 'wk-slk');
  place(trk, 0, 0, 200, 10);
  ptr(thumb, 'pointerdown', 151, 5, { pointerId: 7 });
  ptr(amt, 'pointermove', 161, 5, { pointerId: 7 });
  ptr(amt, 'pointermove', 171, 5, { pointerId: 7 });
  ptr(amt, 'pointerup', 171, 5, { pointerId: 7 });
  assert.deepEqual(take(H), ['edit r1 {"amt":0.61}', 'edit r1 {"amt":0.71}', 'step Mod amount']);
  assert.equal(H.rows[0].amt, 0.71);
  // a drag that comes back where it started records nothing
  ptr(thumb, 'pointerdown', 171, 5, { pointerId: 8 });
  ptr(amt, 'pointermove', 181, 5, { pointerId: 8 });
  ptr(amt, 'pointermove', 171, 5, { pointerId: 8 });
  ptr(amt, 'pointerup', 171, 5, { pointerId: 8 });
  assert.deepEqual(take(H).filter(l => l.startsWith('step')), []);
  // a second finger rolls the drag back (gesture.js's two-finger pointercancel): the value restored, no step
  ptr(thumb, 'pointerdown', 171, 5, { pointerId: 9 });
  ptr(amt, 'pointermove', 191, 5, { pointerId: 9 });
  ptr(amt, 'pointercancel', 191, 5, { pointerId: 9, gesture: 'two-finger' });
  assert.deepEqual([take(H), H.rows[0].amt], [['edit r1 {"amt":0.91}', 'edit r1 {"amt":0.71}'], 0.71]);
  M.close();
  assert.deepEqual([M.isOpen(), byCls(doc.body, 'cv-ml-pop').length, doc.listenerCount('pointerdown')], [false, 0, base], 'closed: no listener left');
});

test('inspector: Bipolar / Bypass toggles, curve, output, aux source (Serum-native ids only) + invert, slew rise / fall / link', () => {
  const { doc, H, M, pop } = setup();
  M.openInspector('r1', 10, 10);
  const p = pop();
  take(H);
  lab(p, 'Bipolar').click();
  lab(p, 'Bypass').click();
  assert.deepEqual(take(H), ['edit r1 {"bi":1}', 'step Mod polarity', 'edit r1 {"byp":1}', 'step Mod bypass']);
  key(lab(p, 'Curve'), 'ArrowLeft');
  key(lab(p, 'Output'), 'ArrowLeft');
  assert.deepEqual(take(H), ['edit r1 {"curve":-0.02}', 'step Mod curve', 'edit r1 {"out":0.99}', 'step Mod output']);
  // invert is greyed without an aux source
  const inv = lab(p, 'Invert aux');
  assert.equal(inv.getAttribute('aria-disabled'), 'true');
  inv.click();
  assert.deepEqual(take(H), []);
  // the aux menu: (none) + the host's sources mapped to native ids, unknown ids dropped
  const mb = one(p, 'wk-mbtn');
  assert.equal(mb.getAttribute('aria-label'), 'Aux source: (none)');
  mb.click();
  const list = one(doc.body, 'wk-pop');
  const opts = byCls(list, 'wk-opt');
  assert.deepEqual(opts.map(o => o.textContent), ['(none)', 'Mod Wheel', 'Velocity', 'LFO 1']);
  ptr(opts[2], 'pointerdown', 5, 5, { pointerId: 2 });
  assert.equal(byCls(doc.body, 'cv-ml-pop').length, 1, 'a press in the aux list is not "outside"');
  opts[2].click();
  assert.deepEqual(take(H), ['edit r1 {"aux":"velo"}', 'step Mod aux']);
  assert.equal(mb.getAttribute('aria-label'), 'Aux source: Velocity');
  assert.equal(inv.hasAttribute('aria-disabled'), false, 'invert follows the aux');
  inv.click();
  assert.deepEqual(take(H), ['edit r1 {"inv":1}', 'step Mod aux invert']);
  // slew: rise, then link (fall = rise; the fall slider greyed), then rise moves both
  key(lab(p, 'Rise'), 'ArrowRight');
  assert.deepEqual(take(H), ['edit r1 {"rise":0.01}', 'step Mod slew']);
  key(lab(p, 'Fall'), 'ArrowRight');
  assert.deepEqual(take(H), ['edit r1 {"fall":0.01}', 'step Mod slew']);
  key(lab(p, 'Rise'), 'ArrowRight');
  take(H);
  lab(p, 'Link').click();
  assert.deepEqual(take(H), ['edit r1 {"slink":1,"fall":0.02}', 'step Mod slew link']);
  assert.equal(lab(p, 'Fall').getAttribute('aria-disabled'), 'true');
  key(lab(p, 'Rise'), 'ArrowRight');
  assert.deepEqual(take(H), ['edit r1 {"rise":0.03,"fall":0.03}', 'step Mod slew']);
  assert.equal(lab(p, 'Fall').getAttribute('aria-valuetext'), '3%');
  lab(p, 'Link').click();
  assert.deepEqual(take(H), ['edit r1 {"slink":0}', 'step Mod slew link']);
  M.close();
  assert.equal(byCls(doc.body, 'wk-pop').length, 0, 'closing destroys the aux menu');
});

test('inspector: Save with preset → toPreset + close; refused → notice, stays; disabled with the reason when the row found no slot; Disconnect → remove', () => {
  let s = setup();
  s.M.openInspector('r1', 0, 0);
  take(s.H);
  const save = act(s.pop(), 'save');
  assert.deepEqual([save.textContent, save.disabled, act(s.pop(), 'keep') === null], ['Save with preset', false, true]);
  save.click();
  assert.deepEqual([take(s.H), s.M.isOpen()], [['toPreset r1', 'step Save with preset'], false]);
  // refused by the host
  s = setup({ toPreset: () => ({ ok: false, why: 'No free slot' }) });
  s.M.openInspector('r1', 0, 0);
  take(s.H);
  act(s.pop(), 'save').click();
  assert.deepEqual([take(s.H), s.M.isOpen()], [['toPreset r1', 'notice No free slot'], true]);
  s.M.close();
  // a row the compile could not place (budget.left): tagged, Save with preset disabled with the reason
  s = setup({ budget: dev => ({ preset: 62, canvas: 2, left: dev === 'i2' ? ['r1'] : [], max: 64 }) });
  s.M.openInspector('r1', 0, 0);
  take(s.H);
  const p = s.pop(), b = act(p, 'save');
  assert.deepEqual(byCls(p, 'cv-ml-tag').filter(t => !t.hidden).map(t => t.textContent), ['not compiled: matrix full']);
  assert.deepEqual([one(p, 'cv-ml-b').textContent, one(p, 'cv-ml-b').hasAttribute('data-full'), b.disabled, one(p, 'cv-ml-why').textContent, b.title],
    ['64/64', true, true, 'Serum 1\'s mod rows are full (64/64)', 'Serum 1\'s mod rows are full (64/64)']);
  b.click();
  assert.deepEqual(take(s.H), []);
  act(p, 'disconnect').click();
  assert.deepEqual([take(s.H), s.M.isOpen(), s.H.rows.map(r => r.id).join()], [['remove r1', 'step Disconnect'], false, 'r2,r3']);
});

test('inspector on a preset row: "preset" tag, edits address {preset, slot}, Keep on canvas → fromPreset + close', () => {
  const { H, M, pop } = setup();
  assert.equal(M.openInspector({ preset: 'i2', slot: 5 }, 0, 0), true);
  const p = pop();
  assert.deepEqual([one(p, 'cv-ml-t').textContent, byCls(p, 'cv-ml-tag').filter(t => !t.hidden).map(t => t.textContent).join()], ['Velocity → A Level', 'preset']);
  assert.deepEqual(take(H), [], 'a preset row selects no canvas cable');
  key(lab(p, 'Amount'), 'ArrowRight');
  assert.deepEqual(take(H), ['edit i2#5 {"amt":0.32}', 'step Mod amount']);
  assert.equal(act(p, 'save') === null, true);
  act(p, 'keep').click();
  assert.deepEqual([take(H), M.isOpen()], [['fromPreset i2 5', 'step Keep on canvas'], false]);
  M.openInspector({ preset: 'i2', slot: 5 }, 0, 0);
  act(pop(), 'disconnect').click();
  assert.deepEqual(take(H), ['remove i2#5', 'step Disconnect']);
  assert.deepEqual([M.openInspector({ preset: 'i2', slot: 5 }), M.openInspector('r9'), M.openInspector(null), M.isOpen()], [false, false, false, false]);
});

test('inspector closes on Escape, a press outside, the camera (wk.closeTransient) and ✕; one popover at a time; sync follows the row', () => {
  const { doc, H, M, pop, pops } = setup();
  M.openInspector('r1', 0, 0);
  key(pop(), 'Escape');
  assert.equal(pops(), 0, 'Escape');
  M.openInspector('r1', 0, 0);
  key(doc.body, 'Escape');
  assert.equal(pops(), 0, 'Escape with the focus on the body');
  M.openInspector('r1', 0, 0);
  ptr(lab(pop(), 'Amount'), 'pointerdown', 5, 5, { pointerId: 3 });
  ptr(lab(pop(), 'Amount'), 'pointerup', 5, 5, { pointerId: 3 });
  assert.equal(pops(), 1, 'a press inside stays');
  ptr(doc.body, 'pointerdown', 900, 900, { pointerId: 4 });
  assert.equal(pops(), 0, 'a press outside');
  M.openInspector('r1', 0, 0);
  wk.closeTransient();
  assert.equal(pops(), 0, 'a camera move');
  M.openInspector('r1', 0, 0);
  act(pop(), 'close').click();
  assert.equal(pops(), 0, '✕');
  M.openInspector('r1', 0, 0);
  M.openInspector('r2', 0, 0);
  assert.deepEqual([pops(), one(pop(), 'cv-ml-t').textContent], [1, 'Velocity → Delay Mix']);
  M.openDestList('wheel', 'i2', 0, 0);
  assert.deepEqual([pops(), pop().getAttribute('data-kind')], [1, 'dest']);
  // sync: an outside change (undo) re-reads the row; a row gone closes the inspector
  M.openInspector('r1', 0, 0);
  H.rows[0].amt = -1;
  M.sync();
  assert.equal(lab(pop(), 'Amount').getAttribute('aria-valuetext'), '−100%');
  H.rows.shift();
  M.sync();
  assert.equal(pops(), 0);
  // placement stays inside the window
  M.openInspector('r2', 5000, -50);
  assert.deepEqual([pop().style.left, pop().style.top], [(1280 - 8 - 40) + 'px', '8px'], 'clamped into the window (the fake rect: 40 px)');
  M.openInspector('r2', 100, 790);
  assert.equal(pop().style.top, (790 - 40 - 8) + 'px', 'flips above a point near the bottom');
  M.close();
});

/* ---------------------------------------------------------------- the Mod list */
test('Mod list: an instrument\'s own preset row is tagged with the instrument\'s name, the model\'s name for an unnamed one (SX0: never "Serum")', () => {
  const { doc, H, M } = setup();
  H.pre.i2.push(Object.assign({ slot: 6, src: 'lfo1', dst: 'a.level', amt: 0.2, own: true }, ROW));
  H.pre.i4 = [Object.assign({ slot: 1, src: 'lfo1', dst: 'a.level', amt: 0.2, own: true }, ROW)];
  assert.equal(M.openList('Track 1', ['i2', 'i4']), true);
  const tags = dev => byCls(one(doc.body, 'cv-sheet'), 'cv-ml-dev').filter(s => s.getAttribute('data-dev') === dev).flatMap(s => byCls(s, 'cv-ml-tag').filter(t => t.getAttribute('data-tag') === 'own').map(t => t.textContent));
  assert.deepEqual([tags('i2'), tags('i4')], [['Serum 1'], [RIG.NAME]]);
  M.close();
});

test('Mod list: a sheet grouped by device, budgets, tags (preset / bypassed / not compiled), tap → inspector, Disconnect all with a confirm', () => {
  const { doc, H, M, pop } = setup({ budget: dev => ({ preset: dev === 'i2' ? 61 : 0, canvas: dev === 'i2' ? 2 : 1, left: dev === 'i2' ? 1 : [], max: 64 }) });
  assert.equal(M.openList('Track 1', ['i2', { id: 'i3', label: 'Serum B' }]), true);
  const sh = () => one(doc.body, 'cv-sheet');
  assert.equal(!!sh() && M.isOpen(), true);
  assert.equal(one(sh(), 'cv-sheet-h').childNodes[0].textContent, 'Modulation · Track 1');
  const sections = () => byCls(sh(), 'cv-ml-dev');
  const view = () => sections().map(s => ({
    dev: s.getAttribute('data-dev'), head: one(s, 'cv-ml-dh').childNodes[0].textContent, budget: one(s, 'cv-ml-b').textContent,
    lines: byCls(s, 'cv-ml-line').map(l => [l.childNodes[0].textContent, ...byCls(l, 'cv-ml-tag').map(t => t.textContent)].join(' | ')),
  }));
  assert.deepEqual(view(), [
    { dev: 'i2', head: 'Serum 1', budget: '63/64 · 1 not compiled', lines: ['Mod Wheel → Cutoff · +50%', 'Velocity → Delay Mix · ∓25% · bypassed | not compiled: matrix full', 'Velocity → A Level · +30% | preset'] },
    { dev: 'i3', head: 'Serum B', budget: '1/64', lines: ['Aftertouch → A Level · +100%'] },
  ]);
  assert.equal(one(sections()[0], 'cv-ml-b').hasAttribute('data-full'), true);
  // tap a line → its inspector (above the sheet); an edit's step re-renders the list
  byCls(sections()[0], 'cv-ml-line')[0].click();
  assert.deepEqual([one(pop(), 'cv-ml-t').textContent, take(H)], ['Mod Wheel → Cutoff', ['select r1']]);
  lab(pop(), 'Bypass').click();
  assert.equal(view()[0].lines[0], 'Mod Wheel → Cutoff · +50% · bypassed');
  ptr(doc.body, 'pointerdown', 900, 900, { pointerId: 5 });
  assert.equal(byCls(doc.body, 'cv-ml-pop').length, 0);
  byCls(sections()[0], 'cv-ml-line')[2].click();
  assert.equal(byCls(pop(), 'cv-ml-tag').filter(t => !t.hidden).map(t => t.textContent).join(), 'preset');
  M.close(); // (U7: the inspector, then the list)
  M.close();
  assert.equal(M.isOpen(), false);
  // Disconnect all (canvas rows only): the confirm names the count; no → nothing
  M.openList('Track 1', ['i2', 'i3']);
  take(H);
  H.answer = false;
  act(sections()[0], 'all').click();
  assert.deepEqual(take(H), ['confirm Disconnect 2 canvas cables from Serum 1? Rows saved with the preset stay.']);
  H.answer = true;
  act(sections()[0], 'all').click();
  assert.deepEqual(take(H).slice(1), ['remove r1', 'remove r2', 'step Disconnect all']);
  assert.deepEqual([view()[0].lines, act(sections()[0], 'all') === null], [['Velocity → A Level · +30% | preset'], true]);
  key(one(doc.body, 'cv-sheet'), 'Escape');
  assert.deepEqual([M.isOpen(), byCls(doc.body, 'cv-sheet').length], [false, 0]);
  M.openList('Empty', []);
  assert.match(one(doc.body, 'cv-ml-empty').textContent, /^No modulation cables on this track yet/);
  M.close();
});

/* ---------------------------------------------------------------- the parameter list */
test('parameter list: groups, nomod greyed (title; a tap notices why), pick → connect + one step + close; refusals as notices', () => {
  const { H, M, pop } = setup({ connect: (src, dst) => dst === 'i2:f.res' ? { ok: false, code: 'stage', stage: '2b' } : dst === 'i2:fx.d1.mix' ? { ok: false, why: 'That would make a loop' } : { ok: true } });
  assert.equal(M.openDestList('wheel', 'i2', 30, 40), true);
  const p = pop();
  assert.deepEqual([p.getAttribute('data-kind'), one(p, 'cv-ml-t').textContent, one(p, 'cv-ml-b').textContent], ['dest', 'Modulate Serum 1 with Mod Wheel', '23/64']);
  const groups = () => byCls(p, 'cv-ml-grp').map(g => g.getAttribute('data-group') + ' ' + g.childNodes[1].textContent);
  assert.deepEqual(groups(), ['Filter 1 2', 'Osc A 2', 'FX Delay 1']);
  byCls(p, 'cv-ml-grp')[1].click();
  const items = () => byCls(p, 'cv-ml-item');
  assert.deepEqual(items().map(i => [i.getAttribute('data-dest'), i.textContent, i.getAttribute('aria-disabled'), i.title].join(' ')),
    ['a.level Level  ', 'a.mode Mode true This knob can\'t be modulated']);
  items()[1].click();
  assert.deepEqual(take(H), ['notice This knob can\'t be modulated'], 'no connect for a nomod knob');
  act(p, 'back').click();
  assert.deepEqual(groups(), ['Filter 1 2', 'Osc A 2', 'FX Delay 1']);
  byCls(p, 'cv-ml-grp')[0].click();
  items()[1].click();
  assert.deepEqual([take(H), M.isOpen()], [['connect wheel i2:f.res', 'notice Mod Wheel → Res: this knob can be modulated from stage 2b'], true]);
  act(p, 'back').click();
  byCls(p, 'cv-ml-grp')[2].click();
  items()[0].click();
  assert.deepEqual(take(H), ['connect wheel i2:fx.d1.mix', 'notice That would make a loop']);
  act(p, 'back').click();
  byCls(p, 'cv-ml-grp')[0].click();
  items()[0].click();
  assert.deepEqual([take(H), M.isOpen()], [['connect wheel i2:f.cutoff', 'step Modulate Cutoff with Mod Wheel'], false]);
  // one group: its items straight away; Escape closes
  const s = setup({ descs: [{ id: 'f.cutoff', label: 'Cutoff', group: 'Filter 1' }, { id: 'x', label: 'X' }].slice(0, 1) });
  s.M.openDestList('ve.out', 'i3', 0, 0);
  assert.deepEqual([byCls(s.pop(), 'cv-ml-grp').length, byCls(s.pop(), 'cv-ml-item').map(i => i.textContent).join(), act(s.pop(), 'back') === null, one(s.pop(), 'cv-ml-t').textContent],
    [0, 'Cutoff', true, 'Modulate Serum 2 with Velocity']);
  key(s.pop(), 'Escape');
  assert.equal(s.M.isOpen(), false);
  // the full-matrix refusal from the host's code
  const f = setup({ connect: () => ({ ok: false, code: 'full' }), budget: () => ({ preset: 64, canvas: 0, left: [], max: 64 }) });
  f.M.openDestList('wheel', 'i2', 0, 0);
  byCls(f.pop(), 'cv-ml-grp')[0].click();
  byCls(f.pop(), 'cv-ml-item')[0].click();
  assert.deepEqual(take(f.H), ['connect wheel i2:f.cutoff', 'notice Serum 1\'s mod rows are full (64/64)']);
  f.M.close();
  assert.equal(all(f.doc.body).filter(n => n.classList && n.classList.contains('cv-ml-pop')).length, 0);
});

// UI fixes
test('(U7) close() — the Escape chain\'s — closes the inspector first and the Mod list under it on the next one', () => {
  const { doc, M, pop } = setup();
  M.openList('Track 1', ['i2']);
  byCls(one(doc.body, 'cv-sheet'), 'cv-ml-line')[0].click();
  assert.ok(pop(), 'the inspector over the list');
  assert.deepEqual([M.close(), !!pop(), !!one(doc.body, 'cv-sheet'), M.isOpen()], [true, false, true, true], 'the inspector only');
  assert.deepEqual([M.close(), !!one(doc.body, 'cv-sheet'), M.isOpen()], [true, false, false], 'then the list');
  assert.equal(M.close(), false, 'nothing left');
});

test('(U11) one amount format (cv-cables amtText): the Mod list and the inspector say what the badge says — a bipolar row ± / ∓, "−" for a negative one; typed back (parsePct reads ± ∓ −)', () => {
  const { doc, M, pop } = setup();
  M.openList('Track 1', ['i2']);
  const lines = byCls(one(doc.body, 'cv-sheet'), 'cv-ml-line').map(l => l.childNodes[0].textContent);
  assert.deepEqual(lines, ['Mod Wheel → Cutoff · +50%', 'Velocity → Delay Mix · ∓25% · bypassed', 'Velocity → A Level · +30%']);
  M.close(); M.close();
  M.openInspector('r2', 0, 0);
  assert.deepEqual([lab(pop(), 'Amount').getAttribute('aria-valuetext'), lab(pop(), 'Amount %').getAttribute('aria-valuetext')], ['∓25%', '∓25%']);
  lab(pop(), 'Bipolar').click();
  assert.equal(lab(pop(), 'Amount').getAttribute('aria-valuetext'), '−25%', 'unipolar now: the sign');
  M.close();
  assert.deepEqual([ML.parsePct('∓25%'), ML.parsePct('±25'), ML.parsePct('−25%')], [-0.25, 0.25, -0.25]);
});

test('(U12) the inspector: a preset row re-read by its slot (undo, a preset load) retitles itself; a gesture that changed nothing after live edits (a two-finger rollback, a drag back to its start) tells host.cancel (the host drops the step it opened); placed inside the visual viewport (native zoom, the soft keyboard)', () => {
  const s = setup();
  const { H, M, pop } = s;
  M.openInspector({ preset: 'i2', slot: 5 }, 0, 0);
  assert.equal(one(pop(), 'cv-ml-t').textContent, 'Velocity → A Level');
  Object.assign(H.pre.i2[0], { src: 'wheel', dst: 'f.cutoff' });
  M.sync();
  assert.deepEqual([one(pop(), 'cv-ml-t').textContent, one(pop(), 'cv-ml-t').title, pop().getAttribute('aria-label')], ['Mod Wheel → Cutoff', 'Mod Wheel → Cutoff', 'Modulation: Mod Wheel → Cutoff']);
  M.close();
  // host.cancel: live edits that end where they began
  H.cancel = () => H.log.push('cancel');
  M.openInspector('r1', 0, 0);
  const amt = lab(pop(), 'Amount'), trk = one(amt, 'wk-slt'), thumb = one(amt, 'wk-slk');
  place(trk, 0, 0, 200, 10);
  take(H);
  ptr(thumb, 'pointerdown', 151, 5, { pointerId: 9 });
  ptr(amt, 'pointermove', 171, 5, { pointerId: 9 });
  ptr(amt, 'pointercancel', 171, 5, { pointerId: 9, gesture: 'two-finger' });
  assert.deepEqual(take(H), ['edit r1 {"amt":0.7}', 'edit r1 {"amt":0.5}', 'cancel'], 'rolled back: the step dropped');
  ptr(thumb, 'pointerdown', 151, 5, { pointerId: 10 });
  ptr(amt, 'pointermove', 161, 5, { pointerId: 10 }); ptr(amt, 'pointermove', 151, 5, { pointerId: 10 });
  ptr(amt, 'pointerup', 151, 5, { pointerId: 10 });
  assert.deepEqual(take(H), ['edit r1 {"amt":0.6}', 'edit r1 {"amt":0.5}', 'cancel'], 'back to its start');
  ptr(thumb, 'pointerdown', 151, 5, { pointerId: 11 }); ptr(amt, 'pointerup', 151, 5, { pointerId: 11 });
  assert.deepEqual(take(H), [], 'no edit: nothing to drop');
  ptr(thumb, 'pointerdown', 151, 5, { pointerId: 12 }); ptr(amt, 'pointermove', 161, 5, { pointerId: 12 }); ptr(amt, 'pointerup', 161, 5, { pointerId: 12 });
  assert.deepEqual(take(H), ['edit r1 {"amt":0.6}', 'step Mod amount'], 'a change: its step, no cancel');
  M.close();
  // the visual viewport: zoomed in, scrolled to (100, 50), 600 × 400 visible
  s.doc.defaultView.visualViewport = { width: 600, height: 400, offsetLeft: 100, offsetTop: 50, scale: 2 };
  try {
    M.openInspector('r2', 5000, -50);
    assert.deepEqual([pop().style.left, pop().style.top], [(100 + 600 - 8 - 40) + 'px', (50 + 8) + 'px'], 'clamped into what is visible');
    M.openInspector('r2', 300, 420);
    assert.equal(pop().style.top, (420 - 40 - 8) + 'px', 'flips above a point near the visible bottom');
    M.close();
  } finally { delete s.doc.defaultView.visualViewport; }
});

test('(2b fixer C, C7) a classic / panel row (host.budget kind): the inspector hides the Aux source section (a ModCore row\'s aux would name the synthetic CP\'s slot) with Save with preset; its header shows the ModCore slots; the Mod list line counts the host\'s cables', () => {
  const slots = { lfo: [1, 10], env: [0, 4], chaos: [0, 2], macro: [0, 8], vals: [0, 16], ext: [2, 16] };
  const s = setup({ budget: dev => (dev === 'i2' ? { preset: 0, canvas: 2, left: [], max: 64, kind: 'classic', slots } : { preset: 1, canvas: 1, left: [], max: 64, kind: 'serum', slots }) });
  const { M, pop } = s;
  M.openInspector('r1', 10, 10);
  let p = pop();
  const secOf = el => { for (let n = el; n; n = n.parentNode) if (n.classList && n.classList.contains('cv-ml-sec')) return n; return null; };
  const auxSec = secOf(one(p, 'wk-mbtn')), save = byAttr(p, 'data-act', 'save')[0];
  assert.deepEqual([!!auxSec, auxSec && auxSec.hidden, save.hidden, one(p, 'cv-ml-b').textContent], [true, true, true, 'LFO 1/10 · ENV 0/4 · ext 2/16'], 'no aux, no save, the slots');
  M.close();
  M.openInspector('r3', 10, 10); // (a Serum row: the aux menu as before)
  p = pop();
  assert.deepEqual([secOf(one(p, 'wk-mbtn')).hidden, byAttr(p, 'data-act', 'save')[0].hidden, one(p, 'cv-ml-b').textContent], [false, false, '2/64']);
  M.close();
  M.openList('Track 1', ['i2', 'i3']);
  const dh = byCls(one(s.doc.body, 'cv-sheet'), 'cv-ml-b').map(d => d.textContent);
  assert.deepEqual(dh, ['2 cables · LFO 1/10 · ENV 0/4 · ext 2/16', '2/64'], 'the host\'s cable count, the slots');
  M.close();
});

test('(LC §8.4, lane H) a Combiner\'s input row (host.budget kind \'comb\'): the inspector "LFO 2 → Combiner 1 · IN" holds Amount (the slider and its number box: live edits, one step), Mute (the row\'s bypass in the input\'s word: one step "Mute" / "Unmute") and Disconnect — no Bipolar, Curve, Custom…, Output, Aux, Invert, Rise, Fall, Link, Save with preset; its header the LFO slots; the Mod list: the combiner\'s section "n inputs · LFO a/10", its lines "LFO 2 → Combiner 1 · IN · +98%" (a muted one "· muted"); every other row as before', () => {
  const slots = { lfo: [3, 10], env: [0, 4], chaos: [0, 2], macro: [0, 8], vals: [1, 16], ext: [0, 16] };
  const s = setup({ budget: dev => (dev === 'x1' ? { preset: 0, canvas: 2, left: [], max: 64, kind: 'comb', slots } : { preset: (s.H.pre[dev] || []).length + 20, canvas: 1, left: [], max: 64 }) });
  const { H, M, pop } = s;
  H.rows.push(Object.assign({ id: 'r7', src: 'l2.out', dst: 'x1:in', amt: 1 }, ROW), Object.assign({ id: 'r8', src: 'l1.out', dst: 'x1:in', amt: -0.5 }, ROW, { byp: 1 }));
  const L0 = H.labelOf, NM = { 'l1.out': 'LFO 1', 'l2.out': 'LFO 2', x1: 'Combiner 1', 'x1:in': 'Combiner 1 · IN' };
  H.labelOf = id => NM[id] || L0(id);
  take(H);
  assert.equal(M.openInspector('r7', 10, 10), true);
  const p = pop();
  assert.deepEqual([one(p, 'cv-ml-t').textContent, one(p, 'cv-ml-b').textContent, p.getAttribute('data-input')], ['LFO 2 → Combiner 1 · IN', 'LFO 3/10', ''], 'the title, the LFO slots (the input\'s budget)');
  const shown = el => { if (!el) return false; for (let n = el; n && n !== p; n = n.parentNode) if (n.hidden) return false; return true; };
  assert.deepEqual(['Amount', 'Amount %', 'Mute'].map(l => shown(lab(p, l))), [true, true, true], 'Amount, Mute');
  assert.deepEqual(['Bipolar', 'Bypass', 'Curve', 'Output', 'Aux source', 'Invert aux', 'Rise', 'Fall', 'Link'].map(l => shown(lab(p, l))), [false, false, false, false, false, false, false, false, false], 'no row field that means nothing on an input');
  assert.deepEqual(['curve', 'save', 'disconnect'].map(a => shown(act(p, a))), [false, false, true], 'Disconnect alone in the foot');
  assert.deepEqual(take(H), ['select r7']);
  key(lab(p, 'Amount'), 'ArrowLeft');
  assert.deepEqual(take(H), ['edit r7 {"amt":0.98}', 'step Mod amount'], 'an amount step');
  lab(p, 'Mute').click();
  assert.deepEqual([take(H), lab(p, 'Mute').getAttribute('aria-pressed') || lab(p, 'Mute').getAttribute('aria-checked')], [['edit r7 {"byp":1}', 'step Mute'], 'true']);
  lab(p, 'Mute').click();
  assert.deepEqual(take(H), ['edit r7 {"byp":0}', 'step Unmute']);
  M.close();
  // a knob row on the same layer: as before (its Bypass, its curve, its slew)
  M.openInspector('r1', 10, 10);
  assert.deepEqual(['Bypass', 'Bipolar', 'Curve', 'Rise'].map(l => shown(lab(pop(), l))).concat(pop().hasAttribute('data-input')), [true, true, true, true, false]);
  M.close();
  M.openList('Track 1', ['i2', { id: 'x1', label: 'Combiner 1' }]);
  const sh = one(s.doc.body, 'cv-sheet'), sec = byCls(sh, 'cv-ml-dev').find(g => g.getAttribute('data-dev') === 'x1');
  assert.deepEqual([byCls(sec, 'cv-ml-b')[0].textContent, byCls(sec, 'cv-ml-line').map(l => l.childNodes[0].textContent)],
    ['2 inputs · LFO 3/10', ['LFO 2 → Combiner 1 · IN · +98%', 'LFO 1 → Combiner 1 · IN · −50% · muted']]);
  byCls(sec, 'cv-ml-line')[1].click();
  assert.deepEqual([one(pop(), 'cv-ml-t').textContent, pop().hasAttribute('data-input')], ['LFO 1 → Combiner 1 · IN', true], 'a line: the input\'s inspector');
  M.close(); M.close();
});
