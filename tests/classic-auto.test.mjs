import './v8-guard.mjs';
// IMPL-AUTO §6 / G6, lane W: ClassicPanel.follow(id, v | null) (the Simple layout and cv-panel's hardware faces through api.draw) draws at v
// without writing (no vals change, no host.changed), a drag that starts on a followed control starts from the followed value, keys act
// on the base, ClassicPanel.setAuto(id, state) sets data-auto on the [data-dest] wrap. Fake DOM + fake host; never fake-DOM nodes in assert.*.
// Run alone: node --max-old-space-size=2048 --test tests/classic-auto.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { ClassicPanel, SEQ_DEF } from '../classic-panel.js?v=9';
import * as cvPanel from '../cv-panel.js?v=9';
import { MODELS } from '../models.js?v=9';
import { fresh, all, key, ptr } from './wk-dom.mjs';

const modelOf = id => MODELS.find(m => m.id === id);
const track = (id, model) => ({ id, name: 'T ' + id, prim: 'i1', model, vals: Object.fromEntries(modelOf(model).controls.map(c => [c.id, c.def])), preset: 'Init' });
function host(doc, log) {
  const K = {
    track: (el, e, move, end) => { const mv = ev => move(ev), up = ev => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); end(ev); }; el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); },
    pressOrTap() {}, noMenu() {}, hoverable() {}, wheelIn: () => null, wheelStep: () => 0, tip() {}, untip() {},
  };
  return {
    doc, changed: (t, id, ph) => log.push(t.id + ':' + id + ':' + (ph || '')), presetTouched() {}, kit: K,
    presets: { list: () => [], cur: () => null, load() {}, step() {}, save() {}, del() {}, init() {}, touch() {} }, chip() {}, presetNo: () => null,
    seq: { of: t => (t.seq || (t.seq = JSON.parse(JSON.stringify(SEQ_DEF)))), send() {}, running: () => false, toggle() {}, toRoll() {}, hw: () => ({ cur: 0, mode: 'pitch' }) },
  };
}
const wrap = (root, id) => all(root).find(n => n.getAttribute && n.getAttribute('data-ctl') === id) || null;
const widget = (root, id) => { const w = wrap(root, id); return w ? w.childNodes.find(n => n.nodeType === 1 && /\b(knob|slider|num|sel|tog)\b/.test(n.className)) || w.childNodes[0] : null; };
const mount = (doc, t, layout, log) => { const root = doc.createElement('div'); doc.body.append(root); return new ClassicPanel(root, { track: t, model: modelOf(t.model), layout, host: host(doc, log) }); };
const L = cvPanel.usable('minimoog', modelOf('minimoog'));

for (const ui of ['flow', 'hw']) {
  test(`${ui}: follow draws at v with no write; null shows the base; update keeps it`, () => {
    const doc = fresh(), log = [], t = track('trk_1', 'minimoog'), P = mount(doc, t, ui === 'hw' ? L : null, log);
    const c = modelOf('minimoog').controls.find(k => k.id === 'fc'), w = widget(P.root, 'fc');
    const base = t.vals.fc, tgt = c.min + (c.max - c.min) * 0.9;
    assert.notEqual(base, tgt);
    const before = w.getAttribute('aria-valuenow'), tx = w.getAttribute('aria-valuetext');
    P.follow('fc', tgt);
    assert.notEqual(w.getAttribute('aria-valuenow'), before, 'the drawing moved');
    assert.notEqual(w.getAttribute('aria-valuetext'), tx);
    assert.equal(t.vals.fc, base, 'the base is untouched');
    assert.equal(log.length, 0, 'no host.changed: no write, no History, no post');
    P.update('fc');
    P.refresh();
    assert.notEqual(w.getAttribute('aria-valuenow'), before, 'update / refresh keep the followed value');
    P.follow('fc', null);
    assert.equal(w.getAttribute('aria-valuenow'), before);
    assert.equal(w.getAttribute('aria-valuetext'), tx);
    assert.equal(log.length, 0);
    P.follow('nope', 3); P.follow('nope', null); // an unknown id is inert
    assert.equal(log.length, 0);
  });

  test(`${ui}: a drag that starts on a followed control starts from the followed value; keys act on the base`, () => {
    const doc = fresh(), log = [], t = track('trk_1', 'minimoog'), P = mount(doc, t, ui === 'hw' ? L : null, log);
    const c = modelOf('minimoog').controls.find(k => k.id === 'fc'), w = widget(P.root, 'fc');
    const base = t.vals.fc, span = c.max - c.min;
    // measured: the same 20 px upward drag from the base and from a followed value near the top
    const drag = () => { const p = { pointerId: 7 }; ptr(w, 'pointerdown', 100, 100, p); ptr(w, 'pointermove', 100, 90, p); ptr(w, 'pointermove', 100, 80, p); ptr(w, 'pointerup', 100, 80, p); };
    drag();
    const plain = t.vals.fc;
    assert.ok(plain > base, 'the plain drag raised the base');
    t.vals.fc = base; log.length = 0; P.update('fc');
    const hi = c.min + span * 0.8;
    P.follow('fc', hi);
    drag();
    assert.ok(Math.abs(t.vals.fc - (hi + (plain - base))) < 0.05, 'the drag began at the followed 80 % (' + hi + ' + the same travel), not at the base: ' + t.vals.fc);
    assert.ok(log.some(l => l.startsWith('trk_1:fc:')), 'the drag wrote');
    // the drawing during / after the drag shows the base (the drag wrote it); keys still act on the base
    P.follow('fc', null);
    t.vals.fc = base; P.update('fc');
    P.follow('fc', hi);
    log.length = 0;
    w.focus && w.focus();
    key(w, 'End');
    assert.equal(t.vals.fc, c.max, 'End set the base');
    assert.ok(log.length >= 1);
  });

  test(`${ui}: setAuto sets / clears data-auto on the [data-dest] wrap, never adds a child`, () => {
    const doc = fresh(), log = [], t = track('trk_1', 'minimoog'), P = mount(doc, t, ui === 'hw' ? L : null, log);
    const w = wrap(P.root, 'fc'), n0 = w.childNodes.length;
    assert.equal(w.getAttribute('data-dest'), 'fc');
    assert.equal(w.hasAttribute('data-auto'), false);
    P.setAuto('fc', 'on');
    assert.equal(w.getAttribute('data-auto'), 'on');
    P.setAuto('fc', 'off');
    assert.equal(w.getAttribute('data-auto'), 'off');
    P.refresh(); P.follow('fc', 1);
    assert.equal(w.getAttribute('data-auto'), 'off');
    P.setAuto('fc', null);
    assert.equal(w.hasAttribute('data-auto'), false);
    P.setAuto('fc', 'on'); P.setAuto('fc', 'x');
    assert.equal(w.hasAttribute('data-auto'), false);
    P.setAuto('nope', 'on');
    assert.equal(w.childNodes.length, n0);
    assert.equal(log.length, 0);
  });
}

test('hw: a stepped rotary follows and drags from the followed position', () => {
  const doc = fresh(), log = [], m = modelOf('minimoog'), t = track('trk_1', 'minimoog'), P = mount(doc, t, L, log);
  const sel = m.controls.find(c => c.t === 's' && c.opts.length > 2), w = sel && widget(P.root, sel.id);
  assert.ok(sel && w, 'a multi-position control');
  const before = w.getAttribute('data-pos') || w.getAttribute('aria-valuenow');
  P.follow(sel.id, sel.opts.length - 1);
  assert.equal(log.length, 0);
  assert.equal(t.vals[sel.id], sel.def, 'the base is untouched');
  assert.ok(typeof before === 'string');
  // a 1 px nudge from the followed (last) position lands on it; from the base it would stay put
  const p = { pointerId: 9 };
  ptr(w, 'pointerdown', 100, 100, p); ptr(w, 'pointermove', 100, 99, p); ptr(w, 'pointerup', 100, 99, p);
  assert.equal(t.vals[sel.id], sel.opts.length - 1, 'the drag started from the followed position');
  t.vals[sel.id] = sel.def; P.update(sel.id);
  P.follow(sel.id, null);
  assert.equal(w.getAttribute('data-pos') || w.getAttribute('aria-valuenow'), before);
});

test('destroy: follow / setAuto after destroy are inert', () => {
  const doc = fresh(), log = [], t = track('trk_1', 'minimoog'), P = mount(doc, t, null, log);
  P.destroy();
  P.follow('fc', 1); P.setAuto('fc', 'on');
  assert.equal(log.length, 0);
});

// fix 11 (R2 P2-1): the classic / hardware wraps wear the same dot — overridden is a hollow ring (a shape), no rule colours an "off" dot
test('style.css: every [data-auto="off"] rule is hollow (transparent, the ring in the tint) — never a colour of its own', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8'), rules = [];
  for (let i = css.indexOf('[data-auto="off"]'); i >= 0; i = css.indexOf('[data-auto="off"]', i + 1)) { const j = css.indexOf('{', i), k = css.indexOf('}', j); rules.push(css.slice(j, k + 1)); i = k; }
  assert.ok(rules.length >= 1, 'an off rule');
  assert.deepEqual(rules.map(r => /background: transparent/.test(r) && /inset 0 0 0 1\.5px/.test(r) && !/--hot|#f2a33a/.test(r)), rules.map(() => true));
});
