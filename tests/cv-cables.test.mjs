import './v8-guard.mjs';
// cv-cables.js (stage 1b MODULES lane; docs/canvas/IMPL-1b.md §8.3): cablePath tangents, deriveCables (classic and
// Serum), routeLabel, createCables on tests/wk-dom.mjs (visible + hit path per cable, layout on port moves, bounds).
// Never passes fake-DOM nodes to assert.* (ids, strings and numbers only).
// Run alone: node --max-old-space-size=2048 --test tests/cv-cables.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../cv-cables.js?v=9';
import * as core from '../serum-core.js?v=9';
import { fresh, all } from './wk-dom.mjs';

const nums = d => d.match(/-?[\d.]+/g).map(Number);

test('cablePath: a cubic with horizontal tangents d = max(TANGENT_MIN, |dx| / 2)', () => {
  assert.equal(C.TANGENT_MIN, 40);
  assert.equal(C.cablePath(0, 0, 100, 50), 'M 0 0 C 50 0, 50 50, 100 50');
  assert.equal(C.cablePath(0, 0, 20, 0), 'M 0 0 C 40 0, -20 0, 20 0', 'short cables keep 40 px tangents');
  assert.equal(C.cablePath(100, 10, 0, 10), 'M 100 10 C 150 10, -50 10, 0 10', 'a backward cable leaves rightward, arrives from the left');
  for (const [x1, y1, x2, y2] of [[0, 0, 1000, 300], [12.345, 7.5, -400, 20], [5, 5, 5, 400]]) {
    const v = nums(C.cablePath(x1, y1, x2, y2)), d = Math.max(40, Math.abs(x2 - x1) / 2);
    assert.deepEqual(v.map(n => Math.round(n * 100) / 100), [x1, y1, x1 + d, y1, x2 - d, y2, x2, y2].map(n => Math.round(n * 100) / 100));
    assert.equal(v[1], v[3], 'tangent at the start is horizontal');
    assert.equal(v[5], v[7], 'tangent at the end is horizontal');
  }
});

test('deriveCables: classic i1 → fx1 → out; Serum i1 → i1/fx (route label) → out; all read-only audio in the track colour', () => {
  const cl = C.deriveCables({ model: 'minimoog', color: '#3b82c4' });
  assert.deepEqual(cl.map(c => [c.a, c.b, c.kind, c.readonly, c.color]), [['i1.out', 'fx1.in', 'audio', true, '#3b82c4'], ['fx1.out', 'out.in', 'audio', true, '#3b82c4']]);
  assert.equal(new Set(cl.map(c => c.id)).size, 2, 'unique ids');
  assert.ok(cl.every(c => !c.label), 'a classic cable has no route label');
  const s = core.defaultSerum(), fx = core.defaultFx2();
  fx.racks[0].mods.push({ id: 'x1', type: 'rev', v: 2, on: 1, p: {} });
  const sx = C.deriveCables({ model: 'serum', color: '#e2402f', vals: { s }, fx });
  assert.deepEqual(sx.map(c => [c.a, c.b]), [['i1.out', 'i1/fx.in'], ['i1/fx.out', 'out.in']]);
  assert.equal(sx[0].label, 'Main');
  assert.equal(sx[1].label, undefined);
  assert.deepEqual(C.deriveCables(null).map(c => c.a), ['i1.out', 'fx1.out'], 'any input gives the classic shape');
});

test('routeLabel: the Serum\'s non-empty racks and Direct (reads state only)', () => {
  assert.equal(C.routeLabel(null, null), '');
  const s = core.defaultSerum(), fx = core.defaultFx2(), snap = JSON.stringify([s, fx]);
  assert.equal(C.routeLabel(s, fx), '', 'empty racks and nothing routed Direct');
  fx.racks[1].mods.push({ id: 'b1', type: 'dly', v: 2, on: 1, p: {} });
  assert.equal(C.routeLabel(s, fx), 'Bus 1');
  fx.racks[0].mods.push({ id: 'm1', type: 'rev', v: 2, on: 1, p: {} });
  assert.equal(C.routeLabel(s, fx), 'Main · Bus 1');
  const s2 = JSON.parse(JSON.stringify(s));
  s2.osc[0].route = 2; // OSC A (powered by default) → Direct
  assert.equal(C.routeLabel(s2, fx), 'Main · Bus 1 · Direct');
  s2.p['a.on'] = 0; // a switched-off oscillator routes nothing
  assert.equal(C.routeLabel(s2, fx), 'Main · Bus 1');
  const fx2 = JSON.parse(JSON.stringify(fx));
  fx2.racks[1].route = 1; // Bus 1 → Direct
  assert.equal(C.routeLabel(s, fx2), 'Main · Bus 1 · Direct');
  fx2.racks[2].mods.push({ id: 'b2', type: 'cho', v: 2, on: 1, p: {} });
  assert.equal(C.routeLabel(s, fx2), 'Main · Bus 1 · Bus 2 · Direct');
  assert.equal(C.routeLabel(s, { p: {} }), '', 'a v1 FX state has no buses');
  s.p['b.on'] = 1; s.osc[1].route = 2;
  assert.ok(C.routeLabel(s, null).endsWith('Direct'), 'OSC B switched on and routed Direct');
});

test('routeLabel never mutates its inputs', () => {
  const s = core.defaultSerum(), fx = core.defaultFx2(), a = JSON.stringify([s, fx]);
  C.routeLabel(s, fx);
  assert.equal(JSON.stringify([s, fx]), a);
});

test('createCables on wk-dom: two layers, a visible + a hit path per cable, layout follows the ports, the layers sit at the bounds', () => {
  const doc = fresh(), W = doc.createElement('div');
  doc.body.append(W);
  const L = C.createCables(W, { doc });
  const svgs = () => W.childNodes.filter(n => n.localName === 'svg').map(n => n.getAttribute('class'));
  assert.deepEqual(svgs(), ['cv-cables', 'cv-cable-ends']);
  assert.equal(L.under.style.zIndex, '0');
  assert.equal(L.over.style.zIndex, '10000');
  L.set(C.deriveCables({ model: 'minimoog', color: '#3fae5a' }));
  const groups = () => all(L.under).filter(n => n.localName === 'g' && n.getAttribute('data-cable'));
  assert.deepEqual(groups().map(g => g.getAttribute('data-cable')), ['i1.out>fx1.in', 'fx1.out>out.in']);
  assert.deepEqual(groups().map(g => g.childNodes.map(p => p.getAttribute('class')).join(' ')), ['cv-cable-hit cv-cable', 'cv-cable-hit cv-cable']);
  assert.ok(groups().every(g => g.hasAttribute('data-ro')), 'read-only cables are marked (no pointer events: CSS)');
  assert.equal(groups()[0].style['--cc'], '#3fae5a');
  const ports = new Map([['i1.out', { x: 1080, y: 68 }], ['fx1.in', { x: 1240, y: 68 }], ['fx1.out', { x: 2000, y: 68 }], ['out.in', { x: 2160, y: 68 }]]);
  L.layout(ports);
  const d = () => groups().map(g => g.childNodes.map(p => p.getAttribute('d')));
  assert.deepEqual(d()[0], [C.cablePath(1080, 68, 1240, 68), C.cablePath(1080, 68, 1240, 68)], 'the hit path follows the visible one');
  assert.equal(d()[1][1], C.cablePath(2000, 68, 2160, 68));
  const box = () => L.box().split(',').map(Number);
  assert.deepEqual(box(), [1080 - C.PAD, 68 - C.PAD, 2160 - 1080 + 2 * C.PAD, 2 * C.PAD]);
  assert.equal(L.under.style.left, (1080 - C.PAD) + 'px');
  assert.equal(L.under.getAttribute('width'), String(2160 - 1080 + 2 * C.PAD));
  assert.equal(all(L.under).find(n => n.localName === 'g' && !n.getAttribute('data-cable')).getAttribute('transform'), `translate(${-(1080 - C.PAD)} ${-(68 - C.PAD)})`);
  assert.equal(L.over.style.left, L.under.style.left, 'both layers share the box');
  // a module moved: its cable and the box follow
  ports.set('fx1.in', { x: 1300, y: 400 });
  L.layout(ports);
  assert.equal(d()[0][0], C.cablePath(1080, 68, 1300, 400));
  assert.deepEqual(box(), [1080 - C.PAD, 68 - C.PAD, 2160 - 1080 + 2 * C.PAD, 400 - 68 + 2 * C.PAD]);
  // a missing port hides its cable (and leaves the box to the rest)
  ports.delete('out.in');
  L.layout(ports);
  assert.deepEqual(groups().map(g => g.style.display), ['', 'none']);
  assert.deepEqual(box(), [1080 - C.PAD, 68 - C.PAD, 1300 - 1080 + 2 * C.PAD, 400 - 68 + 2 * C.PAD], 'only the shown cable counts');
  // highlight: touching ones raised, the rest dimmed; null clears
  L.highlight(['i1.out>fx1.in']);
  assert.deepEqual(groups().map(g => g.getAttribute('class')), ['cv-cable-g cv-hl', 'cv-cable-g cv-dim']);
  L.highlight(null);
  assert.deepEqual(groups().map(g => g.getAttribute('class')), ['cv-cable-g', 'cv-cable-g']);
  L.destroy();
  assert.deepEqual(svgs(), []);
});

test('createCables: a Serum cable carries its route label at the midpoint; set() replaces, keeps and drops cables', () => {
  const doc = fresh(), W = doc.createElement('div');
  const L = C.createCables(W, { doc });
  const s = core.defaultSerum(), fx = core.defaultFx2();
  fx.racks[0].mods.push({ id: 'm1', type: 'rev', v: 2, on: 1, p: {} });
  L.set(C.deriveCables({ model: 'serum', vals: { s }, fx }));
  L.layout({ 'i1.out': { x: 0, y: 100 }, 'i1/fx.in': { x: 200, y: 100 }, 'i1/fx.out': { x: 600, y: 100 }, 'out.in': { x: 760, y: 100 } });
  const lab = all(L.under).find(n => n.localName === 'text');
  assert.equal(lab.textContent, 'Main');
  assert.deepEqual([lab.getAttribute('x'), lab.getAttribute('y')], ['100', '90']);
  const first = all(L.under).find(n => n.getAttribute && n.getAttribute('data-cable') === 'i1/fx.out>out.in');
  L.set(C.deriveCables({ model: 'minimoog' }));
  const ids = all(L.under).filter(n => n.getAttribute && n.getAttribute('data-cable')).map(n => n.getAttribute('data-cable'));
  assert.deepEqual(ids, ['i1.out>fx1.in', 'fx1.out>out.in']);
  assert.equal(all(L.under).filter(n => n.localName === 'text').length, 0, 'no label on a classic track');
  assert.equal(first.parentNode === null, true, 'a dropped cable leaves the layer');
  assert.deepEqual(L.list().map(c => c.id), ids);
});
