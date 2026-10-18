import './v8-guard.mjs';
// classic-panel.js (SPEC-canvas §10 stage 1c): the classic panel as an instance — two instances on two tracks never share
// state (values, updaters, the 303's step lights), destroy() empties the root and a remount shows the track's values, both
// layouts (Hardware: cv-panel; Resizable: today's sections) carry data-ctl = data-dest = the models.js id under a
// [data-dev] root. tests/wk-dom.mjs, a fake host; never fake-DOM nodes in assert.*.
// Run alone: node --max-old-space-size=2048 --test tests/classic-panel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { ClassicPanel, SEQ_DEF, fmt } from '../classic-panel.js?v=9';
import * as cvPanel from '../cv-panel.js?v=9';
import { MODELS, DX_ALGS } from '../models.js?v=9';
import { fresh, all, key } from './wk-dom.mjs';

const modelOf = id => MODELS.find(m => m.id === id);
const defaults = m => Object.fromEntries(m.controls.map(c => [c.id, c.def]));
const track = (id, model) => ({ id, name: 'T ' + id, prim: 'i1', model, vals: defaults(modelOf(model)), preset: 'Init' });
function host(doc, log) {
  const seqHw = new Map(), running = new Set();
  return {
    doc,
    changed: (t, id) => { log.push(t.id + ':' + id); if (t.preset) t.preset = null; },
    presetTouched: t => log.push(t.id + ':preset'),
    kit: { track() {}, pressOrTap() {}, noMenu() {}, hoverable() {}, wheelIn: () => null, wheelStep: () => 0, tip() {}, untip() {} },
    presets: { list: () => [], cur: () => null, load() {}, step() {}, save() {}, del() {}, init() {}, touch() {} },
    chip: () => log.push('chip'),
    presetNo: () => null,
    seq: { of: t => (t.seq || (t.seq = JSON.parse(JSON.stringify(SEQ_DEF)))), send: t => log.push(t.id + ':seq'), running: t => running.has(t.id),
      toggle: (t, on) => { if (on) running.add(t.id); else running.delete(t.id); }, toRoll() {}, hw: t => seqHw.get(t.id) || (seqHw.set(t.id, { cur: 0, mode: 'pitch' }), seqHw.get(t.id)) },
    dx: () => ({ state: { op: 1, param: 7, eg: 1, mode: 'edit' }, algs: DX_ALGS, layout: () => ({ xs: [], lvl: [] }), presets: 32, load() {}, presetName: () => null }),
  };
}
const ctl = (root, id) => all(root).find(n => n.getAttribute && n.getAttribute('data-ctl') === id) || null;
const widget = (root, id) => { const w = ctl(root, id); return w ? w.childNodes.find(n => n.nodeType === 1 && /\b(knob|slider|num|sel|tog)\b/.test(n.className)) || w.childNodes[0] : null; };
const mount = (doc, t, layout, log) => { const root = doc.createElement('div'); doc.body.append(root); return new ClassicPanel(root, { track: t, model: modelOf(t.model), layout, host: host(doc, log) }); };

for (const ui of ['flow', 'hw']) {
  test(`${ui === 'hw' ? 'Hardware' : 'Resizable'} layout: two instances on two tracks share nothing; destroy empties the root; a remount shows the values`, () => {
    const doc = fresh(), log = [], m = modelOf('minimoog'), L = ui === 'hw' ? cvPanel.usable('minimoog', m) : null;
    if (ui === 'hw') assert.ok(L, 'the Minimoog has its hardware layout');
    const a = track('trk_1', 'minimoog'), b = track('trk_2', 'minimoog');
    const A = mount(doc, a, L, log), B = mount(doc, b, L, log);
    assert.notEqual(A.ui, B.ui);
    const id = 'fc', w = widget(A.root, id), v0 = a.vals[id];
    assert.ok(w, 'the cutoff knob');
    key(w, 'ArrowUp');
    assert.ok(a.vals[id] > v0, 'A moved');
    assert.equal(b.vals[id], v0, 'B untouched');
    assert.deepEqual(log, ['trk_1:fc'], 'the page hears of A\'s track only');
    assert.equal(widget(A.root, id).getAttribute('aria-valuenow'), String(a.vals[id]));
    assert.equal(widget(B.root, id).getAttribute('aria-valuenow'), String(v0));
    assert.equal(a.preset, null, 'A\'s preset became Custom'); assert.equal(b.preset, 'Init');
    // data-ctl = data-dest on every control, the root a [data-dev] (canvas modulation drops)
    for (const c of m.controls) {
      const c1 = ctl(A.root, c.id);
      assert.ok(c1, c.id);
      assert.equal(c1.getAttribute('data-dest'), c.id);
    }
    assert.equal(A.root.getAttribute('data-dev'), 'i1');
    // destroy → empty; a new instance from the track shows its values
    const root = A.root;
    A.destroy();
    assert.deepEqual([root.childNodes.length, A.ui.size, root.getAttribute('data-dev')], [0, 0, null]);
    A.set(id, 1); // (a dead instance writes nothing)
    assert.notEqual(a.vals[id], 1);
    const A2 = new ClassicPanel(root, { track: a, model: m, layout: L, host: host(doc, log) });
    assert.equal(widget(A2.root, id).getAttribute('aria-valuenow'), String(a.vals[id]));
    assert.equal(widget(A2.root, id).getAttribute('aria-valuetext'), fmt(m.controls.find(c => c.id === id), a.vals[id]));
    B.destroy(); A2.destroy();
  });
}

test('TB-303 (both layouts): each instance has its own sequencer parts and step lights', () => {
  const doc = fresh(), log = [], m = modelOf('tb303');
  for (const L of [null, cvPanel.usable('tb303', m)]) {
    const a = track('trk_1', 'tb303'), b = track('trk_2', 'tb303');
    const A = mount(doc, a, L, log), B = mount(doc, b, L, log);
    assert.equal(A.stepEls.length, 16); assert.equal(B.stepEls.length, 16);
    A.seqStep(3);
    assert.deepEqual([A.stepEls[3].classList.contains('now'), B.stepEls[3].classList.contains('now')], [true, false]);
    A.seq.clear.onclick();
    assert.ok(a.seq.pat.every(s => s.n === 0), 'A cleared'); assert.ok(b.seq.pat.some(s => s.n !== 0), 'B kept its pattern');
    assert.ok(log.includes('trk_1:seq') && !log.includes('trk_2:seq'));
    A.destroy(); B.destroy();
    log.length = 0;
  }
});

test('every classic model renders in both layouts with one data-dest per control', () => {
  const doc = fresh(), log = [];
  for (const m of MODELS.filter(x => !x.custom)) {
    for (const L of [null, cvPanel.usable(m.id, m)]) {
      const P = mount(doc, track('trk_1', m.id), L, log);
      const dests = all(P.root).filter(n => n.getAttribute && n.getAttribute('data-dest')).map(n => n.getAttribute('data-dest'));
      if (m.id !== 'dx7' || !L) for (const c of m.controls) assert.ok(dests.includes(c.id), `${m.id} ${L ? 'hw' : 'flow'} ${c.id}`);
      assert.equal(new Set(dests).size, dests.length, `${m.id}: one per control`);
      P.destroy();
    }
  }
});
