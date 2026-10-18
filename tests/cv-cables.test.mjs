import './v8-guard.mjs';
// cv-cables.js (stage 1b MODULES lane; docs/canvas/IMPL-1b.md §8.3): cablePath tangents, deriveCables (classic and
// Serum), routeLabel, createCables on tests/wk-dom.mjs (visible + hit path per cable, layout on port moves, bounds).
// Stage 1e: jackPort / portJack, cablesOf (wires, a Serum's own route, colour, grey when silent, levels), editable cables
// (tap select, the floating ×, menu, Escape / Delete, a tap elsewhere), createCableDrag (glow / dim with the reason, snap,
// a module body, refuse, backwards from an input, re-patch, "Connect to…", cancels).
// Never passes fake-DOM nodes to assert.* (ids, strings and numbers only).
// Run alone: node --max-old-space-size=2048 --test tests/cv-cables.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../cv-cables.js?v=9';
import * as core from '../serum-core.js?v=9';
import { fresh, all, ptr, fire, key, Ev } from './wk-dom.mjs';

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

/* ---------------------------------------------------------------- 1e: cables from track.wires, editing, patching */
// a v2 track: a Juno-60 (i1) and a Serum (i2: its own FX holds a reverb) into a shared panel fx1 → OUT; a Minimoog (i3)
// straight into OUT at half level; an empty panel fx2
function v2(o = {}) {
  const s = core.defaultSerum(), fx = core.defaultFx2();
  fx.racks[0].mods.push({ id: 'r1', type: 'rev', v: 2, on: 1, p: {} });
  const t = {
    id: 'trk_1', color: '#3b82c4', prim: 'i1', nid: 5,
    dev: { i1: { kind: 'synth', model: 'juno60', vals: {} }, i2: { kind: 'synth', model: 'serum', vals: { s }, fx }, i3: { kind: 'synth', model: 'minimoog', vals: {} },
      fx1: { kind: 'panel', fx: {} }, fx2: { kind: 'panel' }, out: { kind: 'out' } },
    wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in' }, { id: 'w2', a: 'i2.out', b: 'fx1.in' }, { id: 'w3', a: 'fx1.out', b: 'out.in' }, { id: 'w4', a: 'i3.out', b: 'out.in', g: 0.5 }],
  };
  return Object.assign(t, o);
}
const brief = L => L.map(c => [c.id, c.a, c.b, !!c.readonly, !!c.dim, c.label || ''].join(' '));

test('jackPort / portJack (1e): a Serum\'s wire leaves from its own FX module (\'i2/fx.out\' ↔ \'i2.out\'); the jacks inside a Serum and unknown devices are not patchable', () => {
  const t = v2();
  assert.deepEqual(['i1.out', 'fx1.in', 'fx1.out', 'out.in', 'i2/fx.out', 'i2.out', 'i2/fx.in', 'i1/fx.out', 'nope.in', 'fx2.in', '', 'x'].map(j => C.jackPort(t, j)),
    ['i1.out', 'fx1.in', 'fx1.out', 'out.in', 'i2.out', null, null, null, null, 'fx2.in', null, null]);
  assert.deepEqual(['i2.out', 'i1.out', 'fx1.out'].map(p => C.portJack(t, p)), ['i2/fx.out', 'i1.out', 'fx1.out']);
  assert.equal(C.jackPort({ model: 'minimoog' }, 'i1.out'), null, 'a v1 track: nothing patchable');
  assert.deepEqual([C.SNAP_PX, C.TAP_PX], [32, 8]);
});

test('cablesOf (1e): one editable cable per wire (id = the wire id), a Serum\'s from its own FX, its own route read-only inside it; colour per source; grey when every source is silent (off, or another soloed); a level ≠ 1 labelled in dB', () => {
  const t = v2();
  t.dev.i1.color = '#e2402f';
  t.dev.i3.on = false;
  const L = C.cablesOf(t);
  assert.deepEqual(brief(L), [
    'i2.out>i2/fx.in i2.out i2/fx.in true false Main',
    'w1 i1.out fx1.in false false ',
    'w2 i2/fx.out fx1.in false false ',
    'w3 fx1.out out.in false false ',
    'w4 i3.out out.in false true −6.0 dB',
  ]);
  assert.deepEqual(L.map(c => c.wire || null), [null, 'w1', 'w2', 'w3', 'w4']);
  assert.deepEqual([L[2].from, L[2].src, L[3].src, L[4].g], ['i2.out', ['i2'], ['i1', 'i2'], 0.5], 'the panel\'s output carries what reaches it');
  assert.deepEqual(L.map(c => c.color), ['#3b82c4', '#e2402f', '#3b82c4', '#3b82c4', '#3b82c4'], 'the instrument\'s colour, else the track\'s (a mix: the track\'s)');
  assert.ok(L.every(c => c.kind === 'audio'));
  // solo: the others are silent — their cables grey; the panel still carries the soloed one
  t.dev.i3.on = true; t.dev.i1.solo = true;
  assert.deepEqual(C.cablesOf(t).map(c => c.id + (c.dim ? ' off' : '')), ['i2.out>i2/fx.in off', 'w1', 'w2 off', 'w3', 'w4 off']);
  delete t.dev.i1.solo; t.dev.i1.on = false; t.dev.i2.on = false;
  assert.deepEqual(C.cablesOf(t).filter(c => c.dim).map(c => c.id), ['i2.out>i2/fx.in', 'w1', 'w2', 'w3'], 'everything into the panel off: its output too');
  // g 0 and a malformed wire
  t.wires.push({ id: 'w5', a: 'fx2.out', b: 'out.in', g: 0 }, { a: 'i1.out' }, null);
  const L2 = C.cablesOf(t);
  assert.deepEqual([L2.at(-1).id, L2.at(-1).label, L2.at(-1).dim, L2.length], ['w5', '−∞ dB', undefined, 6], 'an empty panel\'s output: not grey (no source)');
  assert.deepEqual(brief(C.cablesOf({ model: 'minimoog' })), brief(C.deriveCables({ model: 'minimoog' })), 'a v1 track: deriveCables');
  const snap = JSON.stringify(t);
  C.cablesOf(t);
  assert.equal(JSON.stringify(t), snap, 'pure');
});

function layers(o = {}) {
  const doc = fresh(), W = doc.createElement('div');
  doc.body.append(W);
  const sel = [], acts = [];
  const L = C.createCables(W, Object.assign({ doc, onSelect: id => sel.push(id), onAction: (id, a) => acts.push(id + ' ' + a), menu: id => [{ label: 'Bypass ' + id, action() {} }] }, o));
  const t = v2();
  L.set(C.cablesOf(t));
  L.layout(new Map([['i1.out', { x: 1000, y: 68 }], ['fx1.in', { x: 1400, y: 900 }], ['i2.out', { x: 1200, y: 800 }], ['i2/fx.in', { x: 1300, y: 800 }],
    ['i2/fx.out', { x: 2100, y: 800 }], ['fx1.out', { x: 2200, y: 900 }], ['out.in', { x: 2600, y: 68 }], ['i3.out', { x: 1000, y: 1700 }]]));
  const g = id => all(L.under).find(n => n.getAttribute && n.getAttribute('data-cable') === id);
  const hit = id => g(id).childNodes.find(n => n.getAttribute('class') === 'cv-cable-hit');
  const xb = () => all(W).find(n => n.getAttribute && n.getAttribute('class') === 'cv-cable-x') || null;
  return { doc, W, L, t, sel, acts, g, hit, xb };
}
const menuLabels = doc => all(doc.body).filter(n => n.getAttribute && /wk-ctx/.test(n.getAttribute('class') || '')).slice(-1).flatMap(m => all(m).filter(n => n.getAttribute && n.getAttribute('class') === 'wk-cl').map(n => n.textContent));

test('createCables (1e): a tap selects an editable cable (.cv-sel, onSelect) and shows the × at its midpoint (onAction disconnect); read-only ones never select; a drag over it is no tap; grey = .cv-off', () => {
  const R = layers();
  assert.deepEqual(['i2.out>i2/fx.in', 'w1', 'w4'].map(id => R.g(id).hasAttribute('data-ro')), [true, false, false]);
  ptr(R.hit('w1'), 'pointerdown', 500, 300, { pointerId: 3 }); ptr(R.hit('w1'), 'pointerup', 503, 302, { pointerId: 3 });
  assert.deepEqual([R.sel, R.L.selected(), R.g('w1').getAttribute('class')], [['w1'], 'w1', 'cv-cable-g cv-sel']);
  const x = R.xb();
  assert.ok(x, 'the floating ×');
  assert.deepEqual([x.hidden, x.style.left, x.style.top, x.getAttribute('aria-label'), x.tagName], [false, '1200px', '484px', 'Disconnect cable', 'BUTTON'], 'at the midpoint (world px)');
  x.click();
  assert.deepEqual(R.acts, ['w1 disconnect']);
  // the cables re-set without it (the host disconnected it): the selection clears
  R.L.set(C.cablesOf(Object.assign(v2(), { wires: v2().wires.filter(w => w.id !== 'w1') })));
  assert.deepEqual([R.sel, R.L.selected(), R.xb().hidden], [['w1', null], null, true]);
  // read-only: no selection; a drag along a cable is no tap
  ptr(R.hit('i2.out>i2/fx.in'), 'pointerdown', 10, 10, { pointerId: 4 }); ptr(R.hit('i2.out>i2/fx.in'), 'pointerup', 10, 10, { pointerId: 4 });
  ptr(R.hit('w3'), 'pointerdown', 10, 10, { pointerId: 5 }); ptr(R.hit('w3'), 'pointermove', 40, 10, { pointerId: 5 }); ptr(R.hit('w3'), 'pointerup', 40, 10, { pointerId: 5 });
  assert.deepEqual(R.sel, ['w1', null], 'neither selected');
  assert.equal(R.L.select('i2.out>i2/fx.in'), undefined);
  assert.equal(R.L.selected(), null, 'select() refuses a read-only one');
  R.L.set(C.cablesOf(Object.assign(v2(), { dev: Object.assign(v2().dev, { i3: { kind: 'synth', model: 'minimoog', on: false } }) })));
  assert.equal(R.g('w4').getAttribute('class'), 'cv-cable-g cv-off', 'grey from a powered-off instrument');
  R.L.destroy();
  assert.equal(R.xb(), null, 'the × goes with the layers');
});

test('createCables (1e): long-press / right-click → the menu (Disconnect, then the host\'s); Escape clears, Delete / Backspace disconnects (consumed: one thing per key), never while typing; a tap elsewhere clears', () => {
  const R = layers();
  fire(R.hit('w4'), 'contextmenu', { clientX: 300, clientY: 200 });
  assert.deepEqual([R.L.selected(), menuLabels(R.doc)], ['w4', ['Disconnect', 'Bypass w4']]);
  const items = all(R.doc.body).filter(n => n.getAttribute && n.getAttribute('class') === 'wk-cl' && n.textContent === 'Disconnect');
  ptr(items.at(-1).parentNode, 'pointerdown', 0, 0, { pointerId: 7 }); items.at(-1).parentNode.dispatchEvent(new Ev('click', { bubbles: true }));
  assert.deepEqual(R.acts, ['w4 disconnect'], 'Disconnect from the menu');
  key(R.doc.body, 'Escape'); // (closes the menu if open; the cable selection too)
  R.L.select('w3');
  const e = key(R.doc.body, 'Delete');
  assert.deepEqual([R.acts.at(-1), e.defaultPrevented, e._stop], ['w3 disconnect', true, true], 'consumed');
  const inp = R.doc.createElement('input'); R.doc.body.append(inp);
  key(inp, 'Backspace');
  assert.equal(R.acts.filter(a => a === 'w3 disconnect').length, 1, 'typing in a field: not the cable\'s');
  key(R.doc.body, 'Backspace');
  assert.equal(R.acts.filter(a => a === 'w3 disconnect').length, 2);
  const esc = key(R.doc.body, 'Escape');
  assert.deepEqual([R.L.selected(), esc._stop, R.sel.at(-1)], [null, true, null], 'Escape clears (and is consumed)');
  const esc2 = key(R.doc.body, 'Escape');
  assert.equal(!!esc2._stop, false, 'nothing selected: Escape is the page\'s again');
  // a tap elsewhere clears; a press that moves (a pan) does not
  R.L.select('w3');
  const other = R.doc.createElement('div'); R.doc.body.append(other);
  ptr(other, 'pointerdown', 50, 50, { pointerId: 9 }); ptr(other, 'pointermove', 150, 50, { pointerId: 9 }); ptr(other, 'pointerup', 150, 50, { pointerId: 9 });
  assert.equal(R.L.selected(), 'w3', 'a pan keeps it');
  ptr(other, 'pointerdown', 50, 50, { pointerId: 9 }); ptr(other, 'pointerup', 52, 50, { pointerId: 9 });
  assert.equal(R.L.selected(), null, 'a tap elsewhere clears it');
  R.L.select('w3');
  assert.equal(R.L.escape(), true);
  assert.equal(R.L.escape(), false, 'for a caller\'s Escape chain');
  R.L.destroy();
});

// the patching rig: a scripted world (k 1, the viewport at client (0, 100)), jacks as elements at their ports
function patchRig(o = {}) {
  const doc = fresh(), el = doc.createElement('div');
  doc.body.append(el);
  const subs = {}, ptrs = [];
  const world = {
    el, k: 1, hooks: {}, jack: null, jackCancel: null,
    toClient: (x, y) => ({ x, y: y + 100 }), toWorld: (x, y) => ({ x, y: y - 100 }),
    dragPointer: p => ptrs.push(p ? p.x + ',' + p.y : null),
    on: (t, f) => { (subs[t] || (subs[t] = [])).push(f); return () => { subs[t] = subs[t].filter(g => g !== f); }; },
    emit: (t, d) => { for (const f of (subs[t] || []).slice()) f(d); },
    setJackHook(f, c) { world.jack = f; world.jackCancel = c; return () => { world.jack = null; }; },
  };
  const t = v2();
  const P = new Map([['i1.out', { x: 1000, y: 68 }], ['i2.out', { x: 1200, y: 668 }], ['i2/fx.in', { x: 1376, y: 668 }], ['i2/fx.out', { x: 2136, y: 668 }],
    ['i3.out', { x: 1000, y: 1500 }], ['fx1.in', { x: 2400, y: 68 }], ['fx1.out', { x: 3160, y: 68 }], ['fx2.in', { x: 2400, y: 600 }], ['fx2.out', { x: 3160, y: 600 }], ['out.in', { x: 3500, y: 68 }]]);
  const jk = [...P.keys()].map(id => { const j = doc.createElement('span'); j.setAttribute('data-cv-jack', id); j.setAttribute('aria-label', id + ' jack'); j.title = id + ' jack'; el.append(j); return { id, el: j }; });
  const J = id => jk.find(x => x.id === id).el;
  const cables = C.createCables(el, { doc });
  cables.set(C.cablesOf(t));
  cables.layout(P);
  const log = [];
  const D = C.createCableDrag(world, Object.assign({
    ports: () => P, jacks: () => jk, port: j => C.jackPort(t, j), cables, doc,
    rects: () => ({ fx2: { x: 2400, y: 560, w: 760, h: 400 }, out: { x: 3500, y: 28, w: 280, h: 260 } }),
    canConnect: (a, b) => (a === 'fx1.out' && b === 'fx1.in' ? { ok: false, why: 'A panel cannot feed itself' } : a === 'fx2.out' ? { ok: false, why: 'fx2 → panels: stage 4' } : { ok: true }),
    onConnect: (a, b) => log.push('connect ' + a + ' ' + b), onRepatch: (w, a, b) => log.push('repatch ' + w + ' ' + a + ' ' + b),
    onDisconnect: w => log.push('disconnect ' + w), onRefuse: (a, b, why) => log.push('refuse ' + a + ' ' + b + ': ' + why),
  }, o));
  // a press as cv-world routes it (capture phase: the hook first), then the drag's own pointer events (to the document)
  const press = (id, x, y, o2 = {}) => { const e = new Ev('pointerdown', Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', button: 0 }, o2)); return world.jack(e, J(id)); };
  const mv = (x, y, o2 = {}) => ptr(doc.body, 'pointermove', x, y, Object.assign({ pointerId: 1, pointerType: 'touch' }, o2));
  const upAt = (x, y, o2 = {}) => ptr(doc.body, 'pointerup', x, y, Object.assign({ pointerId: 1, pointerType: 'touch' }, o2));
  const cls = id => J(id).getAttribute('class') || '';
  const liveD = () => { const p = all(cables.over).find(n => n.getAttribute && /cv-cable-live/.test(n.getAttribute('class') || '')); return p ? p.getAttribute('d') : null; };
  return { doc, el, world, t, P, J, cables, D, log, ptrs, press, mv, upAt, cls, liveD };
}

test('createCableDrag (1e): from an out — the live bézier, compatible jacks glow (cv-ok), the rest dim with the reason; within 32 px the end snaps (cv-hot); release → onConnect(model ports); every trace cleared', () => {
  const R = patchRig();
  assert.equal(typeof R.world.jack, 'function', 'installed as the world\'s jack hook');
  const h = R.press('i1.out', 1000, 168);
  assert.equal(typeof h.cancel, 'function', 'taken: {cancel}');
  R.mv(1005, 170);
  assert.equal(R.liveD(), null, 'within the tap slop: nothing yet');
  R.mv(1500, 300);
  assert.deepEqual(['i1.out', 'fx1.in', 'fx2.in', 'out.in', 'fx1.out', 'i2/fx.in'].map(R.cls), ['cv-from', 'cv-ok', 'cv-ok', 'cv-ok', 'cv-no', 'cv-no']);
  assert.deepEqual([R.J('fx1.out').title, R.J('i2/fx.in').title], ['Connect an output to an input', 'Inside its instrument: not patchable'], 'the reason as the title');
  assert.equal(R.el.hasAttribute('data-cv-patching'), true);
  assert.equal(R.liveD(), C.cablePath(1000, 68, 1500, 200), 'out → the pointer (world px)');
  assert.equal(R.ptrs.at(-1), '1500,300', 'edge auto-pan follows');
  R.mv(3480, 180); // 22 px from out.in (client 3500, 168)
  assert.deepEqual([R.cls('out.in'), R.liveD()], ['cv-ok cv-hot', C.cablePath(1000, 68, 3500, 68)], 'snapped');
  R.upAt(3480, 180);
  assert.deepEqual(R.log, ['connect i1.out out.in']);
  assert.deepEqual([R.cls('out.in'), R.cls('i1.out'), R.cls('fx1.out'), R.J('fx1.out').title, R.el.hasAttribute('data-cv-patching'), R.liveD(), R.ptrs.at(-1)],
    ['', '', '', 'fx1.out jack', false, null, null], 'cleared, titles back');
  // a Serum's wire leaves from its own FX: model port i2.out; the jacks inside it take no press
  R.press('i2/fx.out', 2136, 768); R.mv(2200, 400); R.mv(2405, 702); R.upAt(2405, 702);
  assert.equal(R.log.at(-1), 'connect i2.out fx2.in');
  assert.equal(R.press('i2.out', 1200, 768), false, 'inside the Serum: not taken');
  assert.equal(R.press('i2/fx.in', 1376, 768), false);
  R.D.destroy();
  assert.equal(R.world.jack, null, 'destroy unhooks');
});

test('createCableDrag (1e): a module body\'s first compatible jack; an incompatible target refuses (onRefuse with the reason, nothing connected); from a free input backwards; release on nothing does nothing', () => {
  const R = patchRig();
  R.press('i3.out', 1000, 1600); R.mv(1100, 1500); R.mv(2900, 900); // inside fx2's body (world y 800), far from its jacks
  assert.equal(R.cls('fx2.in'), 'cv-ok cv-hot', 'its first compatible jack is the target');
  assert.equal(R.liveD(), C.cablePath(1000, 1500, 2900, 800), 'the end follows the pointer');
  R.upAt(2900, 900);
  assert.equal(R.log.at(-1), 'connect i3.out fx2.in');
  // fx1.out onto fx1.in: refused
  R.log.length = 0;
  R.press('fx1.out', 3160, 168); R.mv(3000, 300); R.mv(2410, 175);
  assert.equal(R.cls('fx1.in'), 'cv-no');
  R.upAt(2410, 175);
  assert.deepEqual(R.log, ['refuse fx1.out fx1.in: A panel cannot feed itself']);
  // a free input: the cable runs backwards to an output
  R.log.length = 0;
  R.press('fx2.in', 2400, 700); R.mv(2300, 650);
  assert.deepEqual(['i1.out', 'i3.out', 'i2/fx.out', 'fx2.out', 'fx1.in', 'fx2.in'].map(R.cls), ['cv-ok', 'cv-ok', 'cv-ok', 'cv-no', 'cv-no', 'cv-from']);
  assert.equal(R.J('fx2.out').title, 'fx2 → panels: stage 4');
  R.mv(1010, 160);
  assert.equal(R.liveD(), C.cablePath(1000, 68, 2400, 600), 'drawn out → in');
  R.upAt(1010, 160);
  assert.deepEqual(R.log, ['connect i1.out fx2.in']);
  // released on empty canvas: nothing
  R.log.length = 0;
  R.press('i1.out', 1000, 168); R.mv(1300, 400); R.upAt(1300, 400);
  assert.deepEqual(R.log, []);
});

test('createCableDrag (1e): dragging a cable\'s end off its input re-patches it (onRepatch, the cable faded meanwhile); dropped back or nowhere it stays', () => {
  const R = patchRig();
  R.press('out.in', 3500, 168); // w4 (i3 → out) is the last cable arriving there: its end lifts
  R.mv(3400, 300);
  assert.deepEqual([R.cls('i3.out'), R.cls('out.in'), R.cls('fx2.in')], ['cv-from', 'cv-ok', 'cv-ok'], 'its source fixed; any input (its own too)');
  assert.equal(all(R.cables.under).find(n => n.getAttribute && n.getAttribute('data-cable') === 'w4').getAttribute('class'), 'cv-cable-g cv-lift');
  assert.equal(R.liveD(), C.cablePath(1000, 1500, 3400, 200));
  R.mv(2402, 702); R.upAt(2402, 702);
  assert.deepEqual(R.log, ['repatch w4 i3.out fx2.in']);
  assert.equal(all(R.cables.under).find(n => n.getAttribute && n.getAttribute('data-cable') === 'w4').getAttribute('class'), 'cv-cable-g', 'unfaded');
  R.press('out.in', 3500, 168); R.mv(3300, 300); R.mv(3505, 170); R.upAt(3505, 170);
  R.press('fx1.in', 2400, 168); R.mv(2000, 500); R.upAt(2000, 500);
  assert.deepEqual(R.log, ['repatch w4 i3.out fx2.in'], 'back on its own jack, or nowhere: unchanged');
  // a Serum's cable lifted off fx1.in keeps its model source
  R.log.length = 0;
  R.press('fx1.in', 2400, 168); R.mv(2600, 400); R.mv(3500, 170); R.upAt(3500, 170);
  assert.deepEqual(R.log, ['repatch w2 i2.out out.in']);
});

test('createCableDrag (1e): a tap on a jack opens "Connect to…" (compatible jacks, Disconnect items); Enter / right-click too; Escape, a pointercancel and cancel() (the world\'s second finger) abandon a drag', () => {
  const R = patchRig();
  R.press('i3.out', 1000, 1600); R.upAt(1003, 1601);
  assert.deepEqual(menuLabels(R.doc), ['Connect i3.out jack to…', 'fx1.in jack', 'fx2.in jack', 'out.in jack', 'Disconnect out.in jack']);
  const pick = label => { const it = all(R.doc.body).filter(n => n.getAttribute && n.getAttribute('class') === 'wk-cl' && n.textContent === label).at(-1).parentNode; ptr(it, 'pointerdown', 0, 0, { pointerId: 7 }); it.dispatchEvent(new Ev('click', { bubbles: true })); };
  pick('fx2.in jack');
  assert.deepEqual(R.log, ['connect i3.out fx2.in']);
  key(R.J('fx1.in'), 'Enter');
  assert.deepEqual(menuLabels(R.doc), ['Connect fx1.in jack to…', 'i1.out jack', 'i2/fx.out jack', 'i3.out jack', 'Disconnect i1.out jack', 'Disconnect i2/fx.out jack']);
  pick('Disconnect i1.out jack');
  assert.equal(R.log.at(-1), 'disconnect w1');
  fire(R.J('fx2.out'), 'contextmenu', { clientX: 10, clientY: 10 });
  assert.deepEqual(menuLabels(R.doc), ['Connect fx2.out jack to…', 'Nothing to connect to'], 'refused everywhere');
  assert.equal(R.D.menu('i2.out'), null, 'inside a Serum: no menu');
  // abandoned drags: no callback, every trace gone
  R.log.length = 0;
  for (const end of [() => key(R.doc.body, 'Escape'), () => ptr(R.doc.body, 'pointercancel', 0, 0, { pointerId: 1 }), () => R.world.jackCancel()]) {
    R.press('i1.out', 1000, 168); R.mv(1500, 300); R.mv(3500, 170);
    assert.equal(R.D.active(), true);
    end();
    assert.deepEqual([R.D.active(), R.cls('out.in'), R.liveD(), R.el.hasAttribute('data-cv-patching')], [false, '', null, false]);
    R.upAt(3500, 170);
  }
  assert.deepEqual(R.log, [], 'nothing connected');
  // a mouse press past 4 px is a drag; a mouse move with no button is its (swallowed) release
  R.press('i1.out', 1000, 168, { pointerType: 'mouse' }); R.mv(1006, 168, { pointerType: 'mouse', buttons: 1 });
  assert.equal(R.D.active(), true);
  R.mv(3501, 168, { pointerType: 'mouse', buttons: 1 }); R.mv(3501, 168, { pointerType: 'mouse', buttons: 0 });
  assert.deepEqual([R.log, R.D.active()], [['connect i1.out out.in'], false]);
  R.D.destroy();
});

/* ---------------------------------------------------------------- UI fixes (stage 1e review, fixer U) */
test('createCableDrag (U12): a read-only jack (data-ro: inside a Serum) never takes a press — not even one the host maps to a model port (its own FX input stands for the Serum) — nor opens "Connect to…"; it stays a drop target: an output dropped there meets the own-FX refusal (and its fix)', () => {
  const R = patchRig({ port: j => (j === 'i2/fx.in' ? 'i2.in' : C.jackPort(v2(), j)), canConnect: (a, b) => (b === 'i2.in' ? { ok: false, why: 'own FX take only that Serum' } : { ok: true }) });
  R.J('i2/fx.in').setAttribute('data-ro', ''); R.J('i2.out').setAttribute('data-ro', '');
  assert.equal(R.press('i2/fx.in', 1376, 768), false, 'untaken: the press is the canvas\'s');
  assert.equal(R.D.menu('i2/fx.in'), null, 'no "Connect to…"');
  key(R.J('i2/fx.in'), 'Enter');
  assert.equal(all(R.doc.body).filter(n => n.getAttribute && /wk-ctx/.test(n.getAttribute('class') || '')).length, 0, 'Enter on it: no menu');
  R.press('i3.out', 1000, 1600); R.mv(1100, 1500); R.mv(1380, 770);
  assert.equal(R.cls('i2/fx.in'), 'cv-no', 'a target, refused');
  R.upAt(1380, 770);
  assert.deepEqual(R.log, ['refuse i3.out i2.in: own FX take only that Serum'], 'the refusal (main.js: "Make a shared panel")');
});

test('createCables (U13): the press takes no pointer capture (the canvas pans from a cable); a tap selects even when the world captured its lift; a press that moved (a pan) opens no long-press menu', () => {
  const R = layers(), other = R.doc.createElement('div');
  R.doc.body.append(other);
  ptr(R.hit('w1'), 'pointerdown', 500, 300, { pointerId: 3, pointerType: 'touch' });
  assert.equal(R.hit('w1')._cap == null, true, 'no capture on the path');
  ptr(other, 'pointerup', 503, 302, { pointerId: 3, pointerType: 'touch' }); // (retargeted: the viewport holds the capture)
  assert.deepEqual(R.sel, ['w1'], 'a tap: selected');
  R.L.select(null);
  ptr(R.hit('w3'), 'pointerdown', 500, 300, { pointerId: 4, pointerType: 'touch' });
  ptr(other, 'pointermove', 560, 300, { pointerId: 4, pointerType: 'touch' }); // (the pan: to the viewport)
  fire(R.L.under, 'contextmenu', { clientX: 500, clientY: 300 }); // (wk.menuSource's long-press timer, never told of the moves)
  assert.deepEqual([R.L.selected(), menuLabels(R.doc)], [null, []], 'no menu, no selection');
  ptr(other, 'pointerup', 560, 300, { pointerId: 4, pointerType: 'touch' });
  assert.equal(R.L.selected(), null, 'a pan is no tap');
  fire(R.hit('w4'), 'contextmenu', { clientX: 300, clientY: 200 });
  assert.equal(R.L.selected(), 'w4', 'a right-click still opens it');
  R.L.destroy();
});
