import './v8-guard.mjs';
// cv-cables.js (stage 1b MODULES lane; docs/canvas/IMPL-1b.md §8.3): cablePath tangents, deriveCables (classic and
// Serum), routeLabel, createCables on tests/wk-dom.mjs (visible + hit path per cable, layout on port moves, bounds).
// Stage 1e: jackPort / portJack, cablesOf (wires, a Serum's own route, colour, grey when silent, levels), editable cables
// (tap select, the floating ×, menu, Escape / Delete, a tap elsewhere), createCableDrag (glow / dim with the reason, snap,
// a module body, refuse, backwards from an input, re-patch, "Connect to…", cancels).
// Stage 2a: modSrcKey / modSrcOf / amtText / perfRows, cablesOf's mod cables (track.mods rows, preset rows with their module,
// colours, the badge text, dashed), the mod layers (the body under, the last 24 screen px over, the badge in the world;
// rezoom), the badge's tap / menu / keys, visibility Always / On select / Never, the 24+ fade and its hint, the mod drag
// (knobs through elementFromPoint → [data-dest] → [data-dev], glow / dim, refusals, bar drop, jack tap, no audio ↔ mod
// cross targets, cancels).
// Never passes fake-DOM nodes to assert.* (ids, strings and numbers only).
// Run alone: node --max-old-space-size=2048 --test tests/cv-cables.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../cv-cables.js?v=9';
import * as core from '../serum-core.js?v=9';
import * as wk from '../wk.js?v=9';
import { fresh, all, ptr, fire, key, Ev, place, layout } from './wk-dom.mjs';
import { readFileSync } from 'node:fs';
import * as PCX from '../pads-core.js?v=9';
import * as DCX from '../drum-core.js?v=9';

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

/* ---------------------------------------------------------------- stage 2a: modulation cables (IMPL-2a §3) */
// a v2 track with modulators (ve: Velocity; no Aftertouch), canvas rows and a Serum (i2) whose own matrix holds performance rows
function v2m(o = {}) {
  const t = v2();
  t.dev.ve = { kind: 'velo' };
  t.dev.i2.vals.s.matrix[3] = Object.assign({}, t.dev.i2.vals.s.matrix[3], { src: 'wheel', dst: 'a.level', amt: 0.5 });
  t.dev.i2.vals.s.matrix[7] = Object.assign({}, t.dev.i2.vals.s.matrix[7], { src: 'velo', dst: 'fx.r1.mix', amt: -0.2, bi: 1 });
  t.dev.i2.vals.s.matrix[9] = Object.assign({}, t.dev.i2.vals.s.matrix[9], { src: 'at', dst: 'a.pan', amt: 1 });
  t.dev.i2.vals.s.matrix[11] = Object.assign({}, t.dev.i2.vals.s.matrix[11], { src: 'lfo1', dst: 'a.pan', amt: 1 }); // (not a performance source)
  t.mods = [{ id: 'r1', src: 'wheel', dst: 'i2:a.semi', amt: 0.5, bi: 0, byp: 0 }, { id: 'r2', src: 've.out', dst: 'i2:fx.r1.mix', amt: -0.25, bi: 1, byp: 1 },
    { id: 'r3', src: 'zz', dst: 'i2:a.pan' }, { src: 'wheel', dst: 'i2:a.pan' }, { id: 'r4', src: 'wheel', dst: 'nocolon' }, { id: 'r5', src: 'bd.out', dst: 'i2:a.fine', amt: 1 }];
  return Object.assign(t, o);
}

test('modSrcKey / modSrcOf / amtText / perfRows (2a): row src ↔ module key ↔ jack; the badge text; a Serum\'s performance rows', () => {
  assert.deepEqual(['wheel', 've.out', 'at.out', 'bd.out', 'i1.out', 'lfo1', 'x.y.out', '', null, 'm1.k3'].map(C.modSrcKey), ['wheel', 've', 'at', 'bd', 'i1', null, null, null, null, 'm1']);
  assert.deepEqual(['wheel.out', 've.out', 'at.out'].map(C.modSrcOf), ['wheel', 've.out', 'at.out']);
  assert.deepEqual([C.amtText(0.5), C.amtText(-0.254), C.amtText(0.5, 1), C.amtText(0), C.amtText(3), C.amtText(NaN), C.amtText(-1, true)], ['+50%', '−25%', '±50%', '+0%', '+100%', '+0%', '∓100%']);
  assert.deepEqual(C.perfRows(v2m().dev.i2).map(r => [r.slot, r.src, r.dst, r.amt]), [[3, 'wheel', 'a.level', 0.5], [7, 'velo', 'fx.r1.mix', -0.2], [9, 'at', 'a.pan', 1]]);
  assert.deepEqual([C.perfRows(null), C.perfRows({ vals: {} })], [[], []]);
  assert.deepEqual([C.END_PX, C.MOD_FADE_N, C.MOD_MODES, C.MOD_HINT, C.MOD_KEY], [24, 24, ['always', 'select', 'never'], '24+ mod cables, tap ∿ to filter', { wheel: 'wheel', velo: 've', at: 'at', bend: 'bd' }]);
});

test('cablesOf (2a): one mod cable per valid track.mods row after the audio ones (a: the source module\'s out, b: \'<dev>:<param>\', amt / bi / byp, the badge, the source\'s colour); preset rows only with presetRows and only when their module exists', () => {
  const t = v2m(), base = C.cablesOf(v2());
  const L = C.cablesOf(t);
  assert.deepEqual(L.slice(0, base.length), base, 'the audio cables unchanged, first');
  const M = L.slice(base.length);
  assert.deepEqual(M.map(c => [c.id, c.kind, c.a, c.b, c.amt, c.bi, c.byp, c.preset, c.dashed, c.badge, c.color, c.src]), [
    ['r1', 'mod', 'wheel.out', 'i2:a.semi', 0.5, false, false, false, false, '+50%', C.MOD_COLOR.wheel, 'wheel'],
    ['r2', 'mod', 've.out', 'i2:fx.r1.mix', -0.25, true, true, false, false, '∓25%', C.MOD_COLOR.velo, 've.out'],
    ['r5', 'mod', 'bd.out', 'i2:a.fine', 1, false, false, false, false, '+100%', '#3b82c4', 'bd.out']], 'invalid rows dropped; a source module that is not there: the track colour (the cable hides: no port)');
  assert.ok(M.every(c => !c.readonly && !c.label), 'editable, no midpoint label (the badge)');
  t.dev.ve.color = '#123456';
  assert.equal(C.cablesOf(t).find(c => c.id === 'r2').color, '#123456', 'the module\'s own colour');
  // preset rows: the wheel's needs project.perf.wheel; Velocity's the ve device; Aftertouch's none here
  const P = C.cablesOf(t, { presetRows: true, project: { perf: { wheel: { v: 1 } } } }).filter(c => c.preset);
  assert.deepEqual(P.map(c => [c.id, c.a, c.b, c.dev, c.slot, c.badge, c.src]), [['p:i2:3', 'wheel.out', 'i2:a.level', 'i2', 3, '+50%', 'wheel'], ['p:i2:7', 've.out', 'i2:fx.r1.mix', 'i2', 7, '∓20%', 'velo']]);
  assert.deepEqual(C.cablesOf(t, { presetRows: true, project: { perf: { wheel: null } } }).filter(c => c.preset).map(c => c.id), ['p:i2:7'], 'no wheel in the project');
  assert.deepEqual(C.cablesOf(t, { project: { perf: { wheel: { v: 1 } } } }).filter(c => c.preset), [], 'without presetRows: none');
  const seen = [];
  const F = C.cablesOf(t, { presetRows: (id, dev) => { seen.push(id + ':' + dev.model); return [{ slot: 1, src: 'velo', dst: 'a.oct', amt: 0.1 }, { slot: 2, src: 'nope', dst: 'a.oct' }]; } }).filter(c => c.preset);
  assert.deepEqual([seen, F.map(c => c.id + ' ' + c.b)], [['i2:serum'], ['p:i2:1 i2:a.oct']], 'a host function per Serum');
  assert.deepEqual(C.cablesOf(t, { dashed: r => r.id === 'r1' }).filter(c => c.dashed).map(c => c.id), ['r1'], 'the dashed flag (a per-note source on a last-note target)');
  assert.deepEqual(C.cablesOf({ model: 'serum', mods: [{ id: 'r1', src: 'wheel', dst: 'i1:a.semi' }] }).map(c => c.kind), ['audio', 'audio'], 'a v1 track: no mod cables');
});

// layers with mod cables: ports for the jacks and the knob ends; k from a variable
function modLayers(o = {}) {
  const doc = fresh(), W = doc.createElement('div');
  doc.body.append(W);
  const sel = [], acts = [], hints = [], z = { k: 1 };
  const L = C.createCables(W, Object.assign({ doc, onSelect: id => sel.push(id), onAction: (id, a) => acts.push(id + ' ' + a), menu: id => [{ label: 'Inspect ' + id }],
    onHint: t => hints.push(t), k: () => z.k }, o));
  const t = v2m();
  const P = new Map([['i1.out', { x: 1000, y: 68 }], ['i2.out', { x: 1200, y: 668 }], ['i2/fx.in', { x: 1376, y: 668 }], ['i2/fx.out', { x: 2136, y: 668 }], ['i3.out', { x: 1000, y: 1500 }],
    ['fx1.in', { x: 2400, y: 68 }], ['fx1.out', { x: 3160, y: 68 }], ['out.in', { x: 3500, y: 68 }], ['wheel.out', { x: -176, y: 68 }], ['ve.out', { x: -176, y: 356 }],
    ['i2:a.semi', { x: 300, y: 800 }], ['i2:fx.r1.mix', { x: 1600, y: 900 }], ['i2:a.level', { x: 260, y: 760 }]]);
  L.set(C.cablesOf(t, { presetRows: true, project: { perf: { wheel: { v: 1 } } } }));
  L.layout(P);
  const g = id => all(L.under).find(n => n.getAttribute && n.getAttribute('data-cable') === id) || null;
  const og = id => all(L.over).find(n => n.getAttribute && n.getAttribute('data-cable') === id) || null;
  const badge = id => all(W).find(n => n.getAttribute && n.getAttribute('class') && /cv-mbadge/.test(n.getAttribute('class')) && n.getAttribute('data-cable') === id) || null;
  const cl = n => n.getAttribute('class');
  return { doc, W, L, t, P, z, sel, acts, hints, g, og, badge, cl };
}
// the arc length of a cubic path 'M x y C …' (sampled)
function arcLen(d) {
  const v = nums(d), at = s => { const u = 1 - s; return [0, 1].map(i => u * u * u * v[i] + 3 * u * u * s * v[2 + i] + 3 * u * s * s * v[4 + i] + s * s * s * v[6 + i]); };
  let L = 0, p = at(0);
  for (let i = 1; i <= 200; i++) { const q = at(i / 200); L += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q; }
  return L;
}

test('createCables (2a): a mod cable — its body under the modules (g[data-kind="mod"], no hit: CSS), its last 24 screen px in the over layer, its amount badge (a button in the world) at their start; preset: thin + the "preset" tag; bypassed: cv-off everywhere; dashed; a zoom re-cuts the end', () => {
  const R = modLayers();
  assert.deepEqual(R.L.list().filter(c => c.kind === 'mod').map(c => c.id), ['r1', 'r2', 'r5', 'p:i2:3', 'p:i2:7']);
  const g1 = R.g('r1'), o1 = R.og('r1'), b1 = R.badge('r1');
  assert.deepEqual([g1.getAttribute('data-kind'), g1.childNodes.map(R.cl), o1.getAttribute('data-kind'), o1.childNodes.map(R.cl)], ['mod', ['cv-cable-hit', 'cv-cable'], 'mod', ['cv-cable cv-mend']]);
  assert.equal(g1.childNodes[1].getAttribute('d'), C.cablePath(-176, 68, 300, 800), 'the body: the whole cable');
  const end = o1.childNodes[0].getAttribute('d'), e = nums(end);
  assert.deepEqual(e.slice(-2), [300, 800], 'the end lands on the knob');
  assert.ok(Math.abs(arcLen(end) - 24) < 0.5, 'its last 24 px at k 1: ' + arcLen(end));
  assert.deepEqual([b1.tagName, b1.parentNode === R.W, b1.style.left, b1.style.top, b1.hidden], ['BUTTON', true, e[0] + 'px', e[1] + 'px', false], 'the badge at the end\'s start (world px)');
  assert.deepEqual([b1.textContent, b1.getAttribute('aria-label'), g1.style['--cc'], o1.style['--cc'], b1.style['--cc']], ['+50%', 'Modulation +50% — tap to edit', C.MOD_COLOR.wheel, C.MOD_COLOR.wheel, C.MOD_COLOR.wheel]);
  assert.deepEqual(['r2', 'p:i2:3'].map(id => [R.cl(R.g(id)), R.cl(R.og(id)), R.cl(R.badge(id))]), [
    ['cv-cable-g cv-off', 'cv-cable-g cv-off', 'cv-mbadge cv-off'], ['cv-cable-g cv-preset', 'cv-cable-g cv-preset', 'cv-mbadge cv-preset']], 'bypassed grey; a preset row thin');
  assert.deepEqual([R.badge('p:i2:3').textContent, R.badge('p:i2:3').childNodes[1].hidden, R.badge('r1').childNodes[1].hidden, R.badge('r2').getAttribute('aria-label')],
    ['+50%preset', false, true, 'Modulation ∓25%, bypassed — tap to edit'], 'the "preset" tag');
  assert.deepEqual([R.g('r5').style.display, R.og('r5').style.display, R.badge('r5').hidden], ['none', 'none', true], 'no source module (bd): hidden, badge too');
  // a zoom: the end is 24 screen px again (12 world px at k 2); nothing else changes
  R.z.k = 2;
  assert.equal(R.L.rezoom(), true);
  assert.ok(Math.abs(arcLen(R.og('r1').childNodes[0].getAttribute('d')) - 12) < 0.5, '12 world px at k 2');
  assert.equal(R.g('r1').childNodes[1].getAttribute('d'), C.cablePath(-176, 68, 300, 800));
  assert.equal(R.L.rezoom(), false, 'the same zoom: nothing');
  // dashed; a cable turning from mod to audio under the same id is made again
  R.L.set(C.cablesOf(R.t, { dashed: r => r.id === 'r1' }));
  assert.equal(R.cl(R.g('r1')), 'cv-cable-g cv-dash');
  R.L.set([{ id: 'r1', a: 'i1.out', b: 'fx1.in', kind: 'audio' }]);
  assert.deepEqual([R.g('r1').getAttribute('data-kind'), R.og('r1'), R.badge('r1')], ['audio', null, null]);
  R.L.destroy();
  assert.equal(all(R.W).filter(n => n.getAttribute && /cv-mbadge/.test(n.getAttribute('class') || '')).length, 0, 'the badges go with the layers');
});

test('createCables (2a): the badge is the handle — a tap selects (onSelect; again: onSelect again — the inspector), no ×; its press is the canvas\'s (U4: a pan may start there); long-press / right-click → the menu; Escape clears, Delete disconnects', () => {
  const R = modLayers(), b = R.badge('r1');
  const p = ptr(b, 'pointerdown', 10, 10, { pointerId: 3 });
  assert.equal(p._stop, false, '(U4) the world\'s press too');
  ptr(b, 'pointerup', 10, 10, { pointerId: 3 });
  assert.deepEqual([R.sel, R.L.selected(), R.cl(R.g('r1')), R.cl(R.og('r1')), R.cl(b)], [['r1'], 'r1', 'cv-cable-g cv-sel', 'cv-cable-g cv-sel', 'cv-mbadge cv-sel']);
  const xb = all(R.W).find(n => n.getAttribute && n.getAttribute('class') === 'cv-cable-x');
  assert.equal(!xb || xb.hidden, true, 'no floating × on a mod cable');
  b.click();
  assert.deepEqual(R.sel, ['r1', 'r1'], 'a tap on the selected one: the inspector again');
  key(R.doc.body, 'Escape');
  assert.deepEqual([R.L.selected(), R.cl(b)], [null, 'cv-mbadge']);
  fire(R.badge('p:i2:7'), 'contextmenu', { clientX: 50, clientY: 60 });
  assert.deepEqual([R.L.selected(), menuLabels(R.doc)], ['p:i2:7', ['Disconnect', 'Inspect p:i2:7']]);
  key(R.doc.body, 'Escape');
  R.L.select('r2');
  key(R.doc.body, 'Delete');
  assert.equal(R.acts.at(-1), 'r2 disconnect');
  // an audio cable's selection still shows its ×
  R.L.select('w1');
  assert.equal(all(R.W).find(n => n.getAttribute && n.getAttribute('class') === 'cv-cable-x').hidden, false);
  R.L.destroy();
});

test('createCables (2a): visibility — Never hides every mod cable (badges too; a selected one is let go), On select shows those touching the selection (highlight, the selected cable), Always all; audio cables always', () => {
  const R = modLayers({ mods: 'select' });
  const shown = () => R.L.list().filter(c => c.kind === 'mod').filter(c => !R.g(c.id).classList.contains('cv-hide') && !R.badge(c.id).hidden).map(c => c.id);
  assert.deepEqual([R.L.modsVisible(), shown()], ['select', []], 'On select, nothing selected: none');
  R.L.highlight(['r1', 'p:i2:3', 'w2']);
  assert.deepEqual([shown(), R.og('r1').classList.contains('cv-hide'), R.og('r2').classList.contains('cv-hide')], [['r1', 'p:i2:3'], false, true]);
  R.L.select('r2');
  assert.deepEqual(shown(), ['r1', 'r2', 'p:i2:3'], 'the selected cable shows');
  assert.equal(R.L.setModsVisible('never'), 'never');
  assert.deepEqual([shown(), R.L.selected(), R.g('w2').classList.contains('cv-hide')], [[], null, false], 'Never: none, the selection let go; audio stays');
  assert.equal(R.L.setModsVisible('bogus'), 'never', 'unknown: unchanged');
  R.L.setModsVisible('always');
  R.L.highlight(null);
  assert.deepEqual(shown(), ['r1', 'r2', 'p:i2:3', 'p:i2:7'], 'Always: every laid-out one (r5 has no source module)');
  assert.deepEqual([R.hints, R.L.list().some(c => R.g(c.id).classList.contains('cv-fade'))], [[], false], '≤ 24: no fade, no hint');
  R.L.destroy();
});

test('createCables (2a): Always with more than 24 visible mod cables — those not touching the selection fade to 30 % (cv-fade), the hint once; under the limit again: no fade', () => {
  const R = modLayers();
  const many = Array.from({ length: 26 }, (_, i) => ({ id: 'm' + i, kind: 'mod', a: 'wheel.out', b: 'i2:a.semi', amt: 0.1 }));
  R.L.set(many);
  const faded = (L = many) => L.filter(c => R.g(c.id).classList.contains('cv-fade')).length;
  assert.deepEqual([faded(), R.hints], [26, ['24+ mod cables, tap ∿ to filter']], 'nothing selected: all fade');
  assert.deepEqual([R.og('m0').classList.contains('cv-fade'), R.badge('m0').classList.contains('cv-fade')], [true, true]);
  R.L.highlight(['m1', 'm2']);
  R.L.select('m3');
  assert.deepEqual([faded(), R.g('m1').classList.contains('cv-fade'), R.g('m3').classList.contains('cv-fade')], [23, false, false], 'the ones touching the selection stay');
  R.L.layout(R.P); R.L.set(many.slice());
  assert.equal(R.hints.length, 1, 'the hint once');
  R.L.set(many.slice(0, 24));
  assert.equal(faded(many.slice(0, 24)), 0, '24: no fade');
  R.L.destroy();
});

// the mod-drag rig: a scripted world, a wheel module (its mod jack), Velocity, a Serum (knobs under [data-dev], a top
// bar), a classic module (refused knobs: stage 2b), audio jacks; elementFromPoint from a table of client rects
function modRig(o = {}) {
  const doc = fresh(), el = doc.createElement('div');
  doc.body.append(el);
  const subs = {}, ptrs = [];
  const world = {
    el, k: 1, hooks: {}, jack: null, jackCancel: null,
    toClient: (x, y) => ({ x, y: y + 100 }), toWorld: (x, y) => ({ x, y: y - 100 }),
    dragPointer: p => ptrs.push(p ? p.x + ',' + p.y : null),
    on: (t, f) => { (subs[t] || (subs[t] = [])).push(f); return () => { subs[t] = subs[t].filter(g => g !== f); }; },
    setJackHook(f, c) { world.jack = f; world.jackCancel = c; return () => { world.jack = null; }; },
  };
  const mk = (tag, attrs, parent) => { const n = doc.createElement(tag); for (const k in attrs) n.setAttribute(k, attrs[k]); (parent || el).append(n); return n; };
  const modEl = (key, color) => { const m = mk('div', { 'data-cv-mod': key, class: 'cv-mod' }); if (color) m.style.setProperty('--mc', color); return m; };
  const wheel = modEl('wheel', '#4fb3d9'), ve = modEl('ve', '#e8a33d'), sx = modEl('i2'), cl = modEl('i1'), fx = modEl('fx1');
  const J = {
    'wheel.out': mk('span', { 'data-cv-jack': 'wheel.out', 'data-kind': 'mod', 'aria-label': 'Mod Wheel out', title: 'Mod Wheel out', role: 'button' }, wheel),
    've.out': mk('span', { 'data-cv-jack': 've.out', 'data-kind': 'mod', 'aria-label': 'Velocity out', title: 'Velocity out' }, ve),
    'i1.out': mk('span', { 'data-cv-jack': 'i1.out', 'data-kind': 'audio', title: 'i1 out' }, cl),
    'fx1.in': mk('span', { 'data-cv-jack': 'fx1.in', 'data-kind': 'audio', title: 'fx1 in' }, fx),
  };
  const bar = mk('div', { 'data-cv-bar': '', class: 'cv-bar' }, sx), wbar = mk('div', { 'data-cv-bar': '', class: 'cv-bar' }, wheel);
  const panel = mk('div', { 'data-dev': 'i2', class: 'sx-root' }, sx), ownFx = mk('div', { 'data-dev': 'i2', class: 'fxr-root' }, sx);
  const K = {
    semi: mk('div', { 'data-dest': 'a.semi', class: 'knob' }, panel), pan: mk('div', { 'data-dest': 'a.pan', class: 'knob' }, panel),
    ir: mk('div', { 'data-dest': 'fx.r1.ir', 'data-nomod': '1', class: 'knob' }, ownFx), mix: mk('div', { 'data-dest': 'fx.r1.mix', class: 'knob' }, ownFx),
    cut: mk('div', { 'data-dest': 'cutoff', class: 'knob' }, mk('div', { 'data-dev': 'i1' }, cl)),
  };
  const knobInner = mk('span', { class: 'cap' }, K.semi);
  place(K.semi, 290, 890, 20, 20); // client rects (the world's client = world + (0, 100))
  // what lies under a client point
  const zones = [[K.semi, 280, 880, 40, 40], [K.pan, 400, 880, 40, 40], [K.ir, 600, 880, 40, 40], [K.mix, 700, 880, 40, 40], [K.cut, 1000, 880, 40, 40],
    [bar, 200, 600, 400, 40], [wbar, -400, 100, 240, 40], [J['fx1.in'], 2390, 160, 20, 20]];
  doc.elementFromPoint = (x, y) => { if (x === 285 && y === 885) return knobInner; for (const [n, l, t, w, h] of zones) if (x >= l && x < l + w && y >= t && y < t + h) return n; return el; };
  const P = new Map([['wheel.out', { x: -176, y: 68 }], ['ve.out', { x: -176, y: 356 }], ['i1.out', { x: 1000, y: 68 }], ['fx1.in', { x: 2400, y: 68 }]]);
  const cables = C.createCables(el, { doc });
  const log = [], asked = [];
  const D = C.createCableDrag(world, Object.assign({
    ports: () => P, cables, doc, port: j => (j === 'wheel.out' ? null : j),
    jacks: () => Object.keys(J).map(id => ({ id, el: J[id] })),
    canConnect: (a, b) => ({ ok: true }),
    canMod: (src, dst) => { asked.push(src + ' ' + dst); return dst.startsWith('i1:') ? { ok: false, why: 'Classic knobs: from stage 2b' } : dst === 'i2:a.pan' ? { ok: false } : { ok: true }; },
    markDests: src => [{ dev: 'i2', ids: ['a.semi', 'fx.r1.mix'] }],
    onConnect: (a, b) => log.push('connect ' + a + ' ' + b), onRepatch: () => log.push('repatch'),
    onMod: (src, dst) => log.push('mod ' + src + ' ' + dst), onRefuse: (a, b, why) => log.push('refuse ' + a + ' ' + b + ': ' + why),
    onBarDrop: (src, k) => log.push('bar ' + src + ' ' + k), onJackTap: (src, je) => log.push('tap ' + src + ' ' + je.getAttribute('data-cv-jack')),
  }, o));
  const press = (id, x, y, o2 = {}) => world.jack(new Ev('pointerdown', Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', button: 0 }, o2)), J[id]);
  const mv = (x, y, o2 = {}) => ptr(doc.body, 'pointermove', x, y, Object.assign({ pointerId: 1, pointerType: 'touch' }, o2));
  const upAt = (x, y, o2 = {}) => ptr(doc.body, 'pointerup', x, y, Object.assign({ pointerId: 1, pointerType: 'touch' }, o2));
  const live = () => all(cables.over).find(n => n.getAttribute && /cv-cable-live/.test(n.getAttribute('class') || '')) || null;
  const cls = n => n.getAttribute('class') || '';
  return { doc, el, world, J, K, bar, wbar, mods: { wheel, ve, sx, cl, fx }, P, cables, D, log, asked, ptrs, press, mv, upAt, live, cls };
}

test('createCableDrag (2a): a mod drag from the wheel — #world[data-cv-patching="mod"], the knobs markDests names glow (cv-ok), the modules without one dim (cv-nodest), every jack cv-no; over an accepted knob it lights (cv-hot) and the live cable (the mod look, the module\'s colour) ends on it; release → onMod(src, \'<dev>:<param>\'); every trace cleared', () => {
  const R = modRig();
  const h = R.press('wheel.out', -176, 168);
  assert.equal(typeof h.cancel, 'function', 'taken (a mod jack: whatever o.port says)');
  R.mv(-170, 170);
  assert.equal(R.el.hasAttribute('data-cv-patching'), false, 'within the tap slop: nothing yet');
  R.mv(100, 500);
  assert.equal(R.el.getAttribute('data-cv-patching'), 'mod');
  assert.deepEqual(Object.entries(R.K).map(([k, n]) => k + ':' + R.cls(n)), ['semi:knob cv-ok', 'pan:knob', 'ir:knob', 'mix:knob cv-ok', 'cut:knob'], 'the named knobs glow ([data-nomod] never)');
  assert.deepEqual(Object.entries(R.mods).map(([k, n]) => k + ':' + R.cls(n)), ['wheel:cv-mod', 've:cv-mod cv-nodest', 'sx:cv-mod', 'cl:cv-mod cv-nodest', 'fx:cv-mod cv-nodest'], 'modules without a target dim (not the source)');
  assert.deepEqual(Object.keys(R.J).map(id => R.cls(R.J[id])), ['cv-from', 'cv-no', 'cv-no', 'cv-no'], 'no jack is a target');
  assert.deepEqual([R.J['i1.out'].title, R.J['ve.out'].title], ['Drag a modulation cable onto a knob', 'Drag a modulation cable onto a knob']);
  assert.deepEqual([R.cls(R.live()), R.live().style['--cc'], R.live().getAttribute('d')], ['cv-cable cv-cable-live cv-mlive', '#4fb3d9', C.cablePath(-176, 68, 100, 400)], 'the mod look, to the pointer');
  assert.equal(R.ptrs.at(-1), '100,500', 'edge auto-pan follows');
  R.mv(285, 885); // on the knob's cap: closest [data-dest]
  assert.deepEqual([R.cls(R.K.semi), R.cls(R.live())], ['knob cv-ok cv-hot', 'cv-cable cv-cable-live cv-mlive cv-snap']);
  assert.equal(R.live().getAttribute('d'), C.cablePath(-176, 68, 300, 800), 'snapped to the knob\'s centre (world px)');
  R.upAt(285, 885);
  assert.deepEqual(R.log, ['mod wheel i2:a.semi']);
  assert.deepEqual([...Object.values(R.K), ...Object.values(R.mods), ...Object.values(R.J)].map(R.cls).filter(c => /cv-(ok|no|hot|from|nodest)/.test(c)), [], 'every mark gone');
  assert.deepEqual([R.J['i1.out'].title, R.el.hasAttribute('data-cv-patching'), R.live(), R.ptrs.at(-1)], ['i1 out', false, null, null]);
  // Velocity: its src is 've.out'; a Serum's own FX knob under the same [data-dev]
  R.press('ve.out', -176, 456); R.mv(300, 600); R.mv(705, 885); R.upAt(705, 885);
  assert.equal(R.log.at(-1), 'mod ve.out i2:fx.r1.mix');
  R.D.destroy();
});

test('createCableDrag (2a): refusals — a knob the host refuses (onRefuse with its reason: "…from stage 2b"), one it refuses without a reason, a [data-nomod] one (never asked); the knob shows cv-no while hovered; a module\'s top bar → onBarDrop (not the source\'s own); nothing / an audio jack → nothing', () => {
  const R = modRig();
  const drag = (x, y) => { R.press('wheel.out', -176, 168); R.mv(0, 400); R.mv(x, y); };
  drag(1010, 890);
  assert.equal(R.cls(R.K.cut), 'knob cv-no', 'refused: marked while hovered');
  R.upAt(1010, 890);
  drag(410, 890); R.upAt(410, 890);
  drag(610, 890);
  R.mv(611, 891);
  R.upAt(611, 891);
  assert.deepEqual(R.log, ['refuse wheel i1:cutoff: Classic knobs: from stage 2b', 'refuse wheel i2:a.pan: This knob can’t be modulated', 'refuse wheel i2:fx.r1.ir: This knob can’t be modulated']);
  assert.deepEqual(R.asked, ['wheel i1:cutoff', 'wheel i2:a.pan'], 'the nomod knob is refused without asking; one ask per knob per drag');
  assert.equal(R.cls(R.K.cut), 'knob', 'cleared');
  R.log.length = 0;
  drag(300, 610);
  assert.equal(R.cls(R.bar), 'cv-bar cv-hot', 'a module\'s top bar lights');
  R.upAt(300, 610);
  drag(-300, 110); R.upAt(-300, 110); // the wheel's own bar
  drag(2400, 170); R.upAt(2400, 170); // an audio jack: never a mod target
  drag(5000, 5000); R.upAt(5000, 5000); // the canvas
  assert.deepEqual([R.log, R.cls(R.bar)], [['bar wheel i2'], 'cv-bar']);
  R.D.destroy();
});

test('createCableDrag (2a): a tap on a mod jack, Enter / Space or a right-click → onJackTap(src) (the host\'s "Connect to…"); Escape, a pointercancel and cancel() (two fingers) abandon a mod drag; markDests as a predicate or \'<dev>:<param>\' strings; without it no knob is marked', () => {
  const R = modRig();
  R.press('wheel.out', -176, 168); R.upAt(-174, 169);
  key(R.J['ve.out'], 'Enter');
  fire(R.J['wheel.out'], 'contextmenu', { clientX: 1, clientY: 1 });
  assert.deepEqual(R.log, ['tap wheel wheel.out', 'tap ve.out ve.out', 'tap wheel wheel.out']);
  assert.equal(menuLabels(R.doc).length, 0, 'no "Connect to…" menu of its own');
  R.log.length = 0;
  for (const end of [() => key(R.doc.body, 'Escape'), () => ptr(R.doc.body, 'pointercancel', 0, 0, { pointerId: 1 }), () => R.world.jackCancel()]) {
    R.press('wheel.out', -176, 168); R.mv(0, 400); R.mv(285, 885);
    assert.equal(R.D.active(), true);
    end();
    assert.deepEqual([R.D.active(), R.cls(R.K.semi), R.cls(R.mods.ve), R.el.hasAttribute('data-cv-patching'), R.live()], [false, 'knob', 'cv-mod', false, null]);
    R.upAt(285, 885);
  }
  assert.deepEqual(R.log, [], 'nothing connected');
  R.D.destroy();
  const R2 = modRig({ markDests: () => (dev, id) => dev === 'i2' && id === 'a.pan' });
  R2.press('wheel.out', -176, 168); R2.mv(0, 400);
  assert.deepEqual(Object.values(R2.K).map(R2.cls), ['knob', 'knob cv-ok', 'knob', 'knob', 'knob'], 'a predicate');
  R2.D.cancel();
  R2.D.destroy();
  const R3 = modRig({ markDests: () => ['i2:fx.r1.mix', 'i1:cutoff'] });
  R3.press('wheel.out', -176, 168); R3.mv(0, 400);
  assert.deepEqual(Object.values(R3.K).map(R3.cls), ['knob', 'knob', 'knob', 'knob cv-ok', 'knob cv-ok'], 'strings');
  R3.D.cancel();
  R3.D.destroy();
  const R4 = modRig({ markDests: undefined, onMod: undefined });
  R4.press('wheel.out', -176, 168); R4.mv(0, 400);
  assert.deepEqual(Object.values(R4.K).map(R4.cls), ['knob', 'knob', 'knob', 'knob', 'knob'], 'no markDests: none marked');
  R4.mv(285, 885); R4.upAt(285, 885);
  assert.equal(R4.log.at(-1), 'connect wheel i2:a.semi', 'no onMod: onConnect');
  R4.D.destroy();
});

test('createCableDrag (2a): an audio drag never targets a mod jack (cv-no with the reason; no snap, no "near" refusal) and "Connect to…" never lists one', () => {
  const R = modRig({ canConnect: () => ({ ok: true }) });
  R.press('fx1.in', 2400, 168); R.mv(1000, 300); // backwards from an input: outputs are its targets
  assert.deepEqual([R.cls(R.J['wheel.out']), R.J['wheel.out'].title, R.cls(R.J['i1.out'])], ['cv-no', 'A modulation output: drag it onto a knob', 'cv-ok']);
  R.mv(-176, 168); R.upAt(-176, 168);
  assert.deepEqual(R.log, [], 'released on the mod jack: nothing');
  fire(R.J['fx1.in'], 'contextmenu', { clientX: 1, clientY: 1 });
  assert.deepEqual(menuLabels(R.doc), ['Connect fx1 in to…', 'i1 out']);
  R.D.destroy();
});

// (9, IMPL-9 §4.4, D9) a patch cord's jack is the host's (cv-patch): its press to o.cordPress, never marked by an audio / mod drag,
// its keys and right-click not this drag's
test('createCableDrag (9): a cord jack ([data-kind="cord"], even [data-ro] — host.patch false) hands its press to o.cordPress and its answer is taken (without one: not taken; a right button: not taken); an audio drag never marks it; Enter / right-click on it open no "Connect to…"', () => {
  const got = [];
  const R = patchRig({ jacks: undefined, cordPress: (e, el) => { got.push(el.getAttribute('data-cv-jack') + ' #' + e.pointerId); return { cancel: () => got.push('cancel') }; } });
  const cj = R.doc.createElement('span');
  for (const [k, v] of [['data-cv-jack', 'i1/m3.j-out'], ['data-kind', 'cord'], ['data-dir', 'out'], ['data-ro', ''], ['aria-label', '904A 1 · SIGNAL OUTPUT']]) cj.setAttribute(k, v);
  R.el.append(cj);
  const ev = o => new Ev('pointerdown', Object.assign({ bubbles: true, cancelable: true, clientX: 5, clientY: 5, pointerId: 4, pointerType: 'touch', button: 0 }, o));
  const h = R.world.jack(ev(), cj);
  assert.deepEqual([typeof h.cancel, got], ['function', ['i1/m3.j-out #4']]);
  h.cancel();
  assert.deepEqual(got, ['i1/m3.j-out #4', 'cancel'], 'the two-finger cancel reaches the host\'s');
  assert.equal(R.world.jack(ev({ button: 2 }), cj), false, 'a right button');
  // an audio drag (the jacks walked from the world here): the cord jack untouched; the audio ones as ever
  R.press('i1.out', 1000, 168); R.mv(1500, 300);
  assert.deepEqual([cj.getAttribute('class'), cj.getAttribute('title'), R.cls('fx1.in'), R.cls('fx1.out')], [null, null, 'cv-ok', 'cv-no']);
  R.upAt(1500, 300);
  key(cj, 'Enter'); fire(cj, 'contextmenu', { clientX: 1, clientY: 1 });
  assert.equal(all(R.doc.body).filter(n => n.getAttribute && /wk-ctx/.test(n.getAttribute('class') || '')).length, 0, 'no "Connect to…" for a cord jack');
  assert.equal(got.length, 2, 'nor any press from a key');
  R.D.destroy();
  const R2 = patchRig(), c2 = R2.doc.createElement('span');
  c2.setAttribute('data-cv-jack', 'i1/m3.j-out'); c2.setAttribute('data-kind', 'cord'); R2.el.append(c2);
  assert.equal(R2.world.jack(ev(), c2), false, 'no cordPress: not taken');
  R2.D.destroy();
});

// UI fixes
const hasCls = (n, c) => !!n && typeof n.getAttribute === 'function' && (' ' + (n.getAttribute('class') || '') + ' ').includes(' ' + c + ' ');
test('(U2) a mod drag looks through the amount badges: a badge over a knob is skipped (the knob under it lights and takes the release); style.css: no badge takes a press while patching, its hit area never wider than the badge', () => {
  const R = modRig(), badge = R.doc.createElement('button'), amt = R.doc.createElement('span');
  badge.setAttribute('class', 'cv-mbadge'); amt.setAttribute('class', 'cv-mamt'); badge.append(amt); R.el.append(badge);
  const ef = R.doc.elementFromPoint;
  R.doc.elementFromPoint = (x, y) => (x === 150 && y === 150 ? amt : ef(x, y));
  R.doc.elementsFromPoint = (x, y) => (x === 150 && y === 150 ? [amt, badge, R.K.semi, R.el] : [ef(x, y)]);
  R.press('wheel.out', -176, 168); R.mv(0, 400); R.mv(150, 150);
  assert.deepEqual([R.cls(R.K.semi), R.cls(badge)], ['knob cv-ok cv-hot', 'cv-mbadge'], 'the knob beneath the badge');
  R.upAt(150, 150);
  assert.deepEqual(R.log, ['mod wheel i2:a.semi']);
  delete R.doc.elementsFromPoint; // (no elementsFromPoint: a badge is no target)
  R.press('wheel.out', -176, 168); R.mv(0, 400); R.mv(150, 150); R.upAt(150, 150);
  assert.equal(R.log.length, 1, 'nothing under the badge known: nothing');
  R.D.destroy();
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /#world\[data-cv-patching\] \.cv-mbadge \{[^}]*pointer-events: none/);
  const hit = (css.match(/\.cv-mbadge::before \{[^}]*\}/) || [''])[0];
  assert.ok(hit && /width: 100%/.test(hit) && !/max\(100%/.test(hit), 'the badge\'s hit area: only taller, never wider (toward the knobs): ' + hit);
});

test('(U2, U4) a press on a badge: a knob beneath it wins (the press handed to the knob: the world never sees the badge\'s); else the canvas pans from it (no stopPropagation) and a tap — its lift wherever the world captured it — selects (again: the inspector); a pan selects nothing and opens no menu; keyboard clicks still select', () => {
  const R = modLayers(), b = R.badge('r1'), seen = [], knob = R.doc.createElement('div'), cap = R.doc.createElement('span'), pnl = R.doc.createElement('div');
  // ((MM UI fixer, P1-1) the knob beneath is the cable's own destination — r1's b end 'i2:a.semi': a [data-dest] inside its [data-dev])
  pnl.setAttribute('data-dev', 'i2'); knob.setAttribute('data-dest', 'a.semi'); knob.append(cap); pnl.append(knob); R.W.append(pnl);
  const other = R.doc.createElement('div'); R.doc.body.append(other);
  R.W.addEventListener('pointerdown', e => seen.push('world ' + (e.target === b ? 'badge' : e.target === cap ? 'cap' : '?')));
  const kn = [];
  knob.addEventListener('pointerdown', e => kn.push(e.pointerId + '@' + e.clientX + ',' + e.clientY + (e.target === cap ? ' cap' : '')));
  R.doc.elementsFromPoint = () => [b.childNodes[0], b, cap, knob, pnl, R.W];
  const p = ptr(b, 'pointerdown', 40, 50, { pointerId: 5, pointerType: 'touch' });
  assert.deepEqual([kn, seen, p._stop], [['5@40,50 cap'], ['world cap'], true], 'the knob\'s press (its cap), the badge\'s own never the world\'s');
  ptr(other, 'pointerup', 40, 50, { pointerId: 5, pointerType: 'touch' });
  assert.deepEqual([R.sel, R.L.selected()], [[], null], 'no selection');
  // nothing beneath: the canvas's press; a tap selects
  R.doc.elementsFromPoint = () => [b.childNodes[0], b, R.W];
  seen.length = 0;
  const p2 = ptr(b, 'pointerdown', 40, 50, { pointerId: 6, pointerType: 'touch' });
  assert.deepEqual([seen, p2._stop], [['world badge'], false], 'the world\'s press: a pan may start');
  ptr(other, 'pointerup', 43, 52, { pointerId: 6, pointerType: 'touch' });
  fire(b, 'click', { detail: 1 }); // (a pointer's click: the tap already did it)
  assert.deepEqual([R.sel, R.L.selected()], [['r1'], 'r1']);
  ptr(b, 'pointerdown', 40, 50, { pointerId: 7, pointerType: 'touch' }); ptr(other, 'pointerup', 40, 50, { pointerId: 7, pointerType: 'touch' });
  assert.deepEqual(R.sel, ['r1', 'r1'], 'a tap on the selected one: the inspector again');
  // a pan from a badge: no selection, no long-press menu
  R.L.select(null); R.sel.length = 0;
  ptr(R.badge('r2'), 'pointerdown', 40, 50, { pointerId: 8, pointerType: 'touch' });
  ptr(other, 'pointermove', 90, 50, { pointerId: 8, pointerType: 'touch' });
  fire(R.badge('r2'), 'contextmenu', { clientX: 40, clientY: 50 });
  ptr(other, 'pointerup', 90, 50, { pointerId: 8, pointerType: 'touch' });
  assert.deepEqual([R.sel, R.L.selected(), menuLabels(R.doc)], [[], null, []], 'a pan is no tap');
  b.click(); // (Enter / Space / VoiceOver: detail 0)
  assert.deepEqual(R.sel, ['r1'], 'a keyboard click selects');
  R.L.destroy();
});

test('(2b fixer C, U1) a long-press / right-click on a badge over a [data-dest] control opens the CONTROL\'s menu, never the cable\'s: a right-click\'s contextmenu is handed to the control beneath (a synthetic one, its own listeners decide); a touch press handed to the control arms the control\'s long-press alone (the badge\'s never), and the browser\'s late trusted contextmenu on the badge is dropped; with nothing beneath the cable menu as before', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const R = modLayers(), b = R.badge('r1'), knob = R.doc.createElement('div'), cap = R.doc.createElement('span'), got = [], pnl = R.doc.createElement('div');
  pnl.setAttribute('data-dev', 'i2'); knob.setAttribute('data-dest', 'a.semi'); knob.append(cap); pnl.append(knob); R.W.append(pnl); // ((MM UI fixer, P1-1) the cable's own knob)
  knob.addEventListener('contextmenu', e => { got.push((e.isTrusted ? 'trusted' : 'synthetic') + '@' + e.clientX + ',' + e.clientY + (e.target === cap ? ' cap' : '')); if (e.preventDefault) e.preventDefault(); });
  wk.menuSource(knob, { keys: false }); // (a classic / Serum knob is a menu source of its own)
  const other = R.doc.createElement('div'); R.doc.body.append(other);
  // a right-click: the pointerdown (button 2) is nobody's; the contextmenu lands on the badge and goes to the control beneath
  R.doc.elementsFromPoint = () => [b.childNodes[0], b, cap, knob, pnl, R.W];
  ptr(b, 'pointerdown', 40, 50, { pointerId: 3, button: 2, buttons: 2 });
  const e1 = fire(b, 'contextmenu', { clientX: 40, clientY: 50, button: 2, isTrusted: true });
  assert.deepEqual([got, menuLabels(R.doc), e1.defaultPrevented, R.L.selected()], [['synthetic@40,50 cap'], [], true, null], 'the control\'s menu path, no cable menu, no selection');
  ptr(other, 'pointerup', 40, 50, { pointerId: 3, button: 2, buttons: 0 });
  // a touch press: handed to the control (U2), whose own long-press fires once at 500 ms; the badge arms none
  got.length = 0;
  ptr(b, 'pointerdown', 40, 50, { pointerId: 4, pointerType: 'touch', isPrimary: true });
  t.mock.timers.tick(520);
  assert.deepEqual([got.length, got[0] && got[0].startsWith('synthetic@'), menuLabels(R.doc)], [1, true, []], 'one contextmenu, the control\'s long-press');
  fire(b, 'contextmenu', { clientX: 40, clientY: 50, button: 2, isTrusted: true }); // (Android: the browser's own, late)
  assert.deepEqual([got.length, menuLabels(R.doc)], [1, []], 'the trusted duplicate on the badge is dropped');
  ptr(other, 'pointerup', 40, 50, { pointerId: 4, pointerType: 'touch' });
  // nothing beneath: the cable's menu as before
  R.doc.elementsFromPoint = () => [b.childNodes[0], b, R.W];
  fire(b, 'contextmenu', { clientX: 40, clientY: 50, button: 2, isTrusted: true });
  assert.deepEqual([got.length, menuLabels(R.doc)[0], R.L.selected()], [1, 'Disconnect', 'r1']);
  R.L.destroy();
});

test('(MM UI fixer, review MM-2 P1-1) a badge lying over ANOTHER control keeps its press: only the cable\'s own destination beneath (its [data-dest] under the [data-dev] — else the module\'s data-cv-mod device — of its b end) takes the press and the menu; over a neighbour (an FX-look rack\'s next knob, the same parameter of another device) a tap selects (again: the inspector), a right-click and a touch long-press open the CABLE\'s menu, and the neighbour hears none of it', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const R = modLayers(), b = R.badge('r1'), other = R.doc.createElement('div'), got = [];
  R.doc.body.append(other);
  const knobIn = (dev, dest, attr = 'data-dev') => {
    const pnl = R.doc.createElement('div'), k = R.doc.createElement('div'), cap = R.doc.createElement('span');
    pnl.setAttribute(attr, dev); k.setAttribute('data-dest', dest); k.append(cap); pnl.append(k); R.W.append(pnl);
    const tag = attr + ' ' + dev + ':' + dest;
    k.addEventListener('pointerdown', () => got.push('down ' + tag));
    k.addEventListener('contextmenu', e => { got.push('ctx ' + tag); if (e.preventDefault) e.preventDefault(); });
    return { pnl, k, cap };
  };
  const under = K => { R.doc.elementsFromPoint = () => [b.childNodes[0], b, K.cap, K.k, K.pnl, R.W]; };
  const seen = [];
  let ts = 5000; // (event times 1 s apart, past wk-dom's NOW: a native contextmenu is no duplicate of a synthetic one, a later long-press arms — as in a browser)
  R.W.addEventListener('pointerdown', e => seen.push(e.target === b ? 'badge' : 'other'));
  for (const K of [knobIn('i2', 'a.pan'), knobIn('i3', 'a.semi'), knobIn('i2/oscA', 'a.pan', 'data-cv-mod')]) {
    under(K);
    got.length = 0; seen.length = 0; R.sel.length = 0; R.L.select(null); R.sel.length = 0;
    // a tap: the badge's (the canvas's press, a tap selects), the neighbour never pressed
    const p = ptr(b, 'pointerdown', 40, 50, { pointerId: 5, pointerType: 'touch' });
    ptr(other, 'pointerup', 41, 51, { pointerId: 5, pointerType: 'touch' });
    assert.deepEqual([got, seen, p._stop, R.sel, R.L.selected()], [[], ['badge'], false, ['r1'], 'r1'], 'a tap selects the cable: ' + K.k.getAttribute('data-dest'));
    // a right-click: the cable's menu, never the neighbour's
    R.L.select(null); R.sel.length = 0;
    ptr(b, 'pointerdown', 40, 50, { pointerId: 6, button: 2, buttons: 2, timeStamp: ts += 1000 });
    fire(b, 'contextmenu', { clientX: 40, clientY: 50, button: 2, isTrusted: true, timeStamp: ts += 1000 });
    ptr(other, 'pointerup', 40, 50, { pointerId: 6, button: 2, buttons: 0, timeStamp: ts += 1000 });
    assert.deepEqual([got, menuLabels(R.doc)[0], R.L.selected()], [[], 'Disconnect', 'r1'], 'a right-click: the cable\'s menu');
    for (const m of all(R.doc.body).filter(n => n.getAttribute && /wk-ctx/.test(n.getAttribute('class') || ''))) m.remove();
    // a touch long-press: the badge's own (its menuSource), the cable's menu
    R.L.select(null); R.sel.length = 0;
    ptr(b, 'pointerdown', 40, 50, { pointerId: 7, pointerType: 'touch', isPrimary: true, timeStamp: ts += 1000 }); // (after the right-click's native contextmenu: wk's ctxGuard)
    t.mock.timers.tick(520);
    assert.deepEqual([got, menuLabels(R.doc)[0], R.L.selected()], [[], 'Disconnect', 'r1'], 'a long-press: the cable\'s menu');
    ptr(other, 'pointerup', 40, 50, { pointerId: 7, pointerType: 'touch' });
    for (const m of all(R.doc.body).filter(n => n.getAttribute && /wk-ctx/.test(n.getAttribute('class') || ''))) m.remove();
    K.pnl.remove();
  }
  // its own knob beneath — by data-dev or by its module's data-cv-mod device —: handed over as before (2b U1)
  for (const own of [knobIn('i2', 'a.semi'), knobIn('i2/oscA', 'a.semi', 'data-cv-mod')]) {
    under(own); got.length = 0; seen.length = 0;
    const p = ptr(b, 'pointerdown', 40, 50, { pointerId: 8, pointerType: 'touch' });
    ptr(other, 'pointerup', 40, 50, { pointerId: 8, pointerType: 'touch' });
    fire(b, 'contextmenu', { clientX: 40, clientY: 50, button: 2 });
    const tag = (own.pnl.getAttribute('data-dev') ? 'data-dev i2' : 'data-cv-mod i2/oscA') + ':a.semi';
    assert.deepEqual([got, seen, p._stop], [['down ' + tag, 'ctx ' + tag], ['other'], true], 'its own knob: the press and the menu handed to it');
    own.pnl.remove();
  }
  R.L.destroy();
});

test('(U5, U6) with a mod cable selected, the inspector (.cv-ml-pop / a dialog / the host\'s ignore) is not "elsewhere": a tap there keeps it; Delete / Backspace / Escape typed there are the inspector\'s (no disconnect, Escape not taken); outside, as before', () => {
  const R = modLayers(), pop = R.doc.createElement('div'), sl = R.doc.createElement('div'), dlg = R.doc.createElement('div'), mine = R.doc.createElement('div');
  pop.setAttribute('class', 'cv-ml-pop'); sl.setAttribute('class', 'wk-sl'); pop.append(sl); dlg.setAttribute('role', 'dialog');
  R.doc.body.append(pop, dlg, mine);
  R.L.select('r1');
  for (const t of [sl, dlg]) { ptr(t, 'pointerdown', 5, 5, { pointerId: 2 }); ptr(t, 'pointerup', 5, 5, { pointerId: 2 }); }
  assert.equal(R.L.selected(), 'r1', 'a tap in the inspector keeps the cable it edits');
  for (const k of ['Delete', 'Backspace']) key(sl, k);
  const e = key(sl, 'Escape');
  assert.deepEqual([R.acts, R.L.selected(), e._stop], [[], 'r1', false], 'its keys: no disconnect, Escape left to it');
  ptr(mine, 'pointerdown', 5, 5, { pointerId: 2 }); ptr(mine, 'pointerup', 5, 5, { pointerId: 2 });
  assert.equal(R.L.selected(), null, 'elsewhere: cleared');
  R.L.destroy();
  let zone = null;
  const R2 = modLayers({ ignore: t => t === zone });
  zone = R2.doc.createElement('div'); R2.doc.body.append(zone);
  R2.L.select('r1');
  ptr(zone, 'pointerdown', 5, 5, { pointerId: 2 }); ptr(zone, 'pointerup', 5, 5, { pointerId: 2 }); key(zone, 'Delete');
  assert.deepEqual([R2.L.selected(), R2.acts], ['r1', []], 'o.ignore(t)');
  key(R2.doc.body, 'Delete');
  assert.deepEqual(R2.acts, ['r1 disconnect']);
  R2.L.destroy();
});

test('(U11) amtText — one amount format for the badge, the Mod list and the inspector: a bipolar amount keeps its sign (± / ∓)', () => {
  assert.deepEqual([C.amtText(0.5, 1), C.amtText(-0.5, 1), C.amtText(-0.004, 1), C.amtText(-0.25), C.amtText(0.25, 0)], ['±50%', '∓50%', '±0%', '−25%', '+25%']);
});

/* ---------------------------------------------------------------- stage 2b (IMPL-2b §6.1): source ports, kinds by prefix */
test('modSrcPort / modSrcKey / keyKind / srcKind / MOD_PREFIX / MOD_COLOR (2b): a row src → its module key and jack port (a macro\'s k1…k8); the mod kind of any module key by prefix; colours for every kind', () => {
  assert.deepEqual(['wheel', 'l1.out', 'm1.k3', 'm1.k8', 'm1.k9', 'm1.k0', 'a.b.out', 've.out', '', null, 'l1'].map(C.modSrcPort),
    [{ key: 'wheel', port: 'out' }, { key: 'l1', port: 'out' }, { key: 'm1', port: 'k3' }, { key: 'm1', port: 'k8' }, null, null, null, { key: 've', port: 'out' }, null, null, null]);
  assert.deepEqual(['m1.k3', 'h2.out', 'wheel', 'x'].map(C.modSrcKey), ['m1', 'h2', 'wheel', null]);
  assert.deepEqual(['wheel', 've', 'at', 'bd', 'nt', 'l1', 'l10', 'e2', 'm1', 'c3', 'h1', 'l', 'lfo1', 'x1', 'i1', 'l01', 'e0', '', null].map(C.keyKind),
    ['wheel', 'velo', 'at', 'bend', 'note', 'lfo', 'lfo', 'env', 'macro', 'cc', 'chaos', null, null, null, null, null, null, null, null]);
  assert.deepEqual(['m1.k3', 'l2.out', 'wheel', 'zz', 'i1.out'].map(C.srcKind), ['macro', 'lfo', 'wheel', null, null]);
  assert.deepEqual([C.MOD_PREFIX, Object.keys(C.MOD_COLOR), C.MACRO_PORTS],
    [{ wheel: 'wheel', velo: 've', at: 'at', bend: 'bd', note: 'nt', lfo: 'l', env: 'e', macro: 'm', cc: 'c', chaos: 'h' }, ['wheel', 'velo', 'at', 'bend', 'lfo', 'env', 'macro', 'cc', 'chaos', 'note'], ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']]);
  assert.equal(new Set(Object.values(C.MOD_COLOR)).size, 10, 'ten distinct colours');
});

test('cablesOf (2b): rows from the new kinds — a: \'<dev>.out\', a macro\'s \'<dev>.k<n>\'; the colour by the source kind (the device\'s own colour first); dashed from opts.dashed; a missing source module keeps the track colour', () => {
  const t = v2m();
  t.dev.l1 = { kind: 'lfo' }; t.dev.m1 = { kind: 'macro', color: '#111111' }; t.dev.c1 = { kind: 'cc' }; t.dev.nt = { kind: 'note' }; t.dev.e9 = { kind: 'chaos' }; // (e9: a chaos under an env id — no module of its key's kind)
  t.mods.push({ id: 'r6', src: 'l1.out', dst: 'i2:a.semi', amt: 0.3 }, { id: 'r7', src: 'm1.k3', dst: 'i2:a.pan', amt: -0.5, bi: 1 }, { id: 'r8', src: 'c1.out', dst: 'i2:a.fine', amt: 1 },
    { id: 'r9', src: 'h1.out', dst: 'i2:a.fine', amt: 1 }, { id: 'r10', src: 'nt.out', dst: 'i2:a.fine', amt: 0.1 }, { id: 'r11', src: 'e9.out', dst: 'i2:a.fine', amt: 0.1 }, { id: 'r12', src: 'm1.k9', dst: 'i2:a.fine', amt: 0.1 });
  const M = C.cablesOf(t, { dashed: r => r.src.startsWith('l1') }).filter(c => c.kind === 'mod' && /^r(6|7|8|9|10|11|12)$/.test(c.id));
  assert.deepEqual(M.map(c => [c.id, c.a, c.b, c.badge, c.color, c.dashed]), [
    ['r6', 'l1.out', 'i2:a.semi', '+30%', C.MOD_COLOR.lfo, true],
    ['r7', 'm1.k3', 'i2:a.pan', '∓50%', '#111111', false],
    ['r8', 'c1.out', 'i2:a.fine', '+100%', C.MOD_COLOR.cc, false],
    ['r9', 'h1.out', 'i2:a.fine', '+100%', '#3b82c4', false],
    ['r10', 'nt.out', 'i2:a.fine', '+10%', C.MOD_COLOR.note, false],
    ['r11', 'e9.out', 'i2:a.fine', '+10%', '#3b82c4', false]], 'r12 (a k9 port) dropped; r9 / r11: no module of that key and kind → the track colour');
});

/* ---------------------------------------------------------------- milestone 3 (IMPL-3 §2.4–2.5): a Serum shown as parts */
const sj = v => JSON.stringify(v); // (fake-DOM nodes never reach assert: primitives / JSON only)
test('milestone 3 modSrcPort / modSrcJack / hiddenTag: part keys accepted ([a-z][a-z0-9]*(/[a-z][a-zA-Z0-9]*)?), resolved as the parts view lays them out (ENV 1 at VOICE); a hidden knob\'s tag', () => {
  assert.deepEqual(['i1/lfo3.out', 'i2/env1.out', 'i2/env3.out', 'i1/macros.k2', 'i1/lfo3.k9', 'i1/x/y.out', 'I1/lfo3.out', 'l1.out', 'wheel'].map(C.modSrcPort),
    [{ key: 'i1/lfo3', port: 'out' }, { key: 'i2/env1', port: 'out' }, { key: 'i2/env3', port: 'out' }, { key: 'i1/macros', port: 'k2' }, null, null, null, { key: 'l1', port: 'out' }, { key: 'wheel', port: 'out' }]);
  assert.deepEqual(['i1/lfo3.out', 'i2/env1.out', 'i2/env3.out', 'i1/macros.k2', 'm1.k3', 'wheel', 'nope'].map(C.modSrcJack),
    ['i1/lfo3.out', 'i2.env1', 'i2/env3.out', 'i1/macros.k2', 'm1.k3', 'wheel.out', null]);
  assert.deepEqual(['b.level', 'f2.cutoff', 'l3.rate', 'e2.att', 'g.master', 'zz'].map(C.hiddenTag),
    ['OSC B · LEVEL · hidden', 'FILTER 2 · CUTOFF · hidden', 'LFO 3 · RATE · hidden', 'ENV 2 · ATTACK · hidden', 'MASTER VOLUME · hidden', 'zz · hidden']);
});

// a track with a Serum i1 shown as parts: A → Filter 1, B → Filter 1 and 2 (a fork), C routed to Filter with no switch (a stub),
// noise off, a warp (B's FM from A), LFO 1 → a.wt in its own matrix, a link row from its LFO 3
function partsTrack() {
  const s = core.normalizeSerum(core.defaultSerum());
  Object.assign(s.p, { 'a.on': 1, 'b.on': 1, 'c.on': 1, 'n.on': 0, 's.on': 0, 'f.on': 1, 'f2.on': 1, 'f.routeC': 0, 'f2.routeC': 0, 'b.fbal': 0.5, 'f.routeB': 1, 'f2.routeB': 1 });
  s.global.s1 = 0;
  s.p['b.w1'] = core.WARPS2.findIndex(w => w.id === 'fm_o1') / 81;
  s.osc[0].route = 0; s.osc[1].route = 0; s.osc[2].route = 0; s.noise.route = 3; s.sub.route = 3; s.filter[0].route = 1; s.filter[1].route = 2;
  for (const r of s.matrix) Object.assign(r, { src: '', aux: '', dst: '' });
  s.matrix[0] = Object.assign(s.matrix[0], { src: 'lfo1', dst: 'a.wt', amt: 0.5 });
  s.matrix[1] = Object.assign(s.matrix[1], { src: 'velo', dst: 'a.pan', amt: 0.5 }); // (no module: the Mod list's)
  s.matrix[2] = Object.assign(s.matrix[2], { src: 'macro2', dst: 'f.cutoff', amt: 0.25 });
  s.matrix[3] = Object.assign(s.matrix[3], { src: 'lfo2', dst: 'bus3', amt: 0.25 }); // (a point-modulation bus: no knob)
  return { id: 'trk_1', color: '#3b82c4', prim: 'i1', lay: { i1: { x: 0, y: 0, ui: 'parts' } },
    dev: { i1: { kind: 'synth', model: 'serum', vals: { s }, fx: core.defaultFx2(), color: '#ff00aa' }, out: { kind: 'out' } },
    wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }], mods: [{ id: 'r1', src: 'i1/lfo3.out', dst: 'i1:a.semi', amt: 0.2 }] };
}

test('milestone 3 cablesOf: a Serum in parts view draws its internal cables (sx-edges: sources → filters / VOICE, the fork, the stub, filters → VOICE, the read-only warp as a tap cable) and its own LFO / ENV / macro rows from their modules\' jacks; bundled (or opts.parts false): none', () => {
  const t = partsTrack(), L = C.cablesOf(t), I = L.filter(c => c.int);
  assert.deepEqual(I.map(c => [c.id, c.a, c.b, c.int, !!c.fork, !!c.stub, c.tap || '']), [
    ['x:i1:oscA.out>filter.in', 'i1/oscA.out', 'i1/filter.in', 'audio', false, false, ''],
    ['x:i1:oscB.out>filter.in', 'i1/oscB.out', 'i1/filter.in', 'audio', true, false, ''],
    ['x:i1:oscB.out>filter2.in', 'i1/oscB.out', 'i1/filter2.in', 'audio', true, false, ''],
    ['x:i1:oscC.out>', 'i1/oscC.out', null, 'audio', false, true, ''],
    ['x:i1:filter.out>voice.main', 'i1/filter.out', 'i1.main', 'audio', false, false, ''],
    ['x:i1:filter2.out>voice.direct', 'i1/filter2.out', 'i1.direct', 'audio', false, false, ''],
    ['x:i1:oscA.out>oscB.warp#b.w1', 'i1/oscA.out', 'i1/oscB.warp', 'warp', false, false, 'open']]);
  assert.ok(I.every(c => c.kind === 'audio' && !c.readonly && c.color === '#ff00aa' && c.dev === 'i1'));
  assert.equal(I.find(c => c.stub).label, '→ Filter (off)');
  assert.deepEqual(I.filter(c => c.fork).map(c => c.share), [0.5, 0.5]);
  assert.deepEqual(I[0].edge, { a: 'oscA.out', b: 'filter.in' }, 'its sx-edges ENDs (lane D cuts / sets through them)');
  assert.equal(L.filter(c => c.id === 'i1.out>i1/fx.in').length, 1, 'VOICE → own FX: the read-only cable as before (no duplicate)');
  const own = L.filter(c => c.own);
  assert.deepEqual(own.map(c => [c.id, c.a, c.b, c.color, c.preset]), [['o:i1:0', 'i1/lfo1.out', 'i1:a.wt', '#ff00aa', false], ['o:i1:2', 'i1/macros.k2', 'i1:f.cutoff', '#ff00aa', false]], 'velo (no module) and a bus row: the Mod list\'s');
  assert.deepEqual(L.filter(c => c.id === 'r1').map(c => [c.a, c.color]), [['i1/lfo3.out', '#ff00aa']], 'a link row from the Serum\'s LFO 3 part');
  const b = JSON.parse(JSON.stringify(t)); delete b.lay.i1.ui;
  assert.deepEqual([C.cablesOf(b).filter(c => c.int || c.own).length, C.cablesOf(t, { parts: false }).filter(c => c.int || c.own).length, C.cablesOf(t, { parts: id => id === 'i1', ownRows: false }).filter(c => c.own).length], [0, 0, 0]);
  assert.deepEqual([C.partsView(t, 'i1'), C.partsView(b, 'i1'), C.partsView(t, 'i1', { parts: () => false })], [true, false, false]);
  // a powered-off source: its cables grey
  t.dev.i1.vals.s.p['a.on'] = 0;
  assert.equal(C.cablesOf(t).find(c => c.id === 'x:i1:oscA.out>filter.in').dim, true);
});

test('milestone 3 createCables: a stub drawn STUB_PX from its jack; one BALANCE badge per fork (→ onAction balance); a warp cable taps (→ onAction tap, never selected, its menu without Disconnect); a hidden knob end dashes its cable and tags the badge', () => {
  const doc = fresh(), W = doc.createElement('div');
  doc.body.append(W);
  const sel = [], acts = [];
  const L = C.createCables(W, { doc, onSelect: id => sel.push(id), onAction: (id, a) => acts.push(id + ' ' + a), menu: () => [] });
  const t = partsTrack();
  L.set(C.cablesOf(t));
  const P = new Map([['i1/oscA.out', { x: 288, y: 68 }], ['i1/oscB.out', { x: 288, y: 516 }], ['i1/oscC.out', { x: 288, y: 900 }], ['i1/filter.in', { x: 640, y: 68 }],
    ['i1/filter2.in', { x: 640, y: 468 }], ['i1/filter.out', { x: 864, y: 68 }], ['i1/filter2.out', { x: 864, y: 468 }], ['i1.main', { x: 1088, y: 68 }], ['i1.direct', { x: 1088, y: 108 }],
    ['i1/oscB.warp', { x: 0, y: 516 }], ['i1.out', { x: 1536, y: 108 }], ['i1/fx.in', { x: 1700, y: 68 }], ['i1/lfo1.out', { x: 1500, y: -400 }],
    ['i1:a.wt', { x: 1088, y: 20, hid: true, tag: 'OSC A · WT POS · hidden' }], ['i1/macros.k2', { x: 1300, y: -100 }], ['i1:f.cutoff', { x: 700, y: 200 }]]);
  L.layout(P);
  const g = id => all(L.under).find(n => n.getAttribute && n.getAttribute('data-cable') === id);
  const st = g('x:i1:oscC.out>');
  assert.deepEqual([st.style.display, st.hasAttribute('data-stub'), st.childNodes[1].getAttribute('d')], ['', true, C.cablePath(288, 900, 288 + C.STUB_PX, 900)]);
  assert.equal(all(st).find(n => n.getAttribute && n.getAttribute('class') === 'cv-cable-lab').textContent, '→ Filter (off)');
  const forks = all(W).filter(n => n.getAttribute && n.getAttribute('class') === 'cv-fork');
  assert.deepEqual(forks.map(f => [f.getAttribute('data-cable'), f.style.left, f.style.top, f.textContent]), [['x:i1:oscB.out>filter.in', '310px', '516px', 'BAL']]);
  assert.equal(L.forkBadge('i1/oscB.out') === forks[0], true);
  fire(forks[0], 'click');
  assert.deepEqual(acts, ['x:i1:oscB.out>filter.in balance']);
  // the warp cable: a tap opens the oscillator's menu (the host's), never a selection
  const wg = g('x:i1:oscA.out>oscB.warp#b.w1'), hit = wg.childNodes.find(n => n.getAttribute('class') === 'cv-cable-hit');
  assert.equal(sj([wg.getAttribute('data-int'), wg.getAttribute('data-tap'), wg.hasAttribute('data-ro')]), sj(['warp', 'open', false]));
  ptr(hit, 'pointerdown', 100, 100, { pointerId: 3, pointerType: 'mouse' }); ptr(doc.body, 'pointerup', 100, 100, { pointerId: 3, pointerType: 'mouse' });
  assert.deepEqual([acts.at(-1), L.selected(), sel.length], ['x:i1:oscA.out>oscB.warp#b.w1 tap', null, 0]);
  L.select('x:i1:oscA.out>oscB.warp#b.w1');
  assert.equal(L.selected(), null, 'never selected');
  L.openMenu('x:i1:oscA.out>oscB.warp#b.w1', 0, 0);
  assert.deepEqual(menuLabels(doc), ['Open…'], 'read-only: no Disconnect');
  // an editable internal cable selects as a wire does (× = Disconnect: lane D cuts through sx-edges)
  const ah = g('x:i1:oscA.out>filter.in').childNodes.find(n => n.getAttribute('class') === 'cv-cable-hit');
  ptr(ah, 'pointerdown', 10, 10, { pointerId: 4, pointerType: 'mouse' }); ptr(doc.body, 'pointerup', 10, 10, { pointerId: 4, pointerType: 'mouse' });
  assert.equal(L.selected(), 'x:i1:oscA.out>filter.in');
  L.select(null);
  // the own row into a hidden knob: dashed, tagged
  const b0 = L.badge('o:i1:0'), b2 = L.badge('o:i1:2');
  assert.deepEqual([b0.classList.contains('cv-hid'), b0.childNodes[2].textContent, b0.childNodes[2].hidden, b2.classList.contains('cv-hid'), b2.childNodes[2].hidden], [true, 'OSC A · WT POS · hidden', false, false, true]);
  L.destroy();
  assert.equal(all(W).filter(n => n.getAttribute && n.getAttribute('class') === 'cv-fork').length, 0, 'the badges go with the layer');
});

test('milestone 3 createCableDrag: a twin control ([data-twin]: CLIP\'s MACROS pane) is never a mod drag\'s target nor marked; a jack\'s data-dir (VOICE\'s main / direct / note are inputs) drives the press', () => {
  const R = modRig();
  const tw = R.doc.createElement('div'); tw.setAttribute('data-dest', 'a.pan'); tw.setAttribute('data-twin', ''); tw.className = 'knob';
  R.mods.sx.append(tw);
  R.press('wheel.out', -176, 168); R.mv(100, 500);
  assert.equal(R.cls(tw), 'knob', 'not marked');
  R.D.cancel();
  // a press on an input named without '.in' (VOICE's main): taken as an input through its data-dir
  const vm = R.doc.createElement('span'); vm.setAttribute('data-cv-jack', 'i2.main'); vm.setAttribute('data-dir', 'in'); vm.setAttribute('data-kind', 'audio');
  R.mods.sx.append(vm);
  const h = R.world.jack(new Ev('pointerdown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, pointerId: 2, pointerType: 'mouse', button: 0 }), vm);
  assert.equal(typeof h, 'object', 'taken (an input: a new cable from it)');
  R.D.cancel();
  R.D.destroy();
});

test('review 2 P1-1: a touch tap selects a cable and its × appears under the finger — the same tap\'s compatibility click on the × never disconnects; a new press then a click does; a mouse tap as before', () => {
  const R = layers();
  const other = R.doc.createElement('div'); R.doc.body.append(other);
  ptr(R.hit('w1'), 'pointerdown', 500, 300, { pointerId: 3, pointerType: 'touch' }); ptr(other, 'pointerup', 501, 300, { pointerId: 3, pointerType: 'touch' });
  assert.deepEqual([R.L.selected(), R.xb().hidden], ['w1', false], 'selected, the × shown');
  R.xb().dispatchEvent(new Ev('click', { bubbles: true, cancelable: true })); // (the touch's click lands on the × now under the finger)
  assert.deepEqual([R.acts, R.L.selected()], [[], 'w1'], 'the selecting tap never disconnects');
  ptr(R.xb(), 'pointerdown', 1200, 484, { pointerId: 4, pointerType: 'touch' }); ptr(R.xb(), 'pointerup', 1200, 484, { pointerId: 4, pointerType: 'touch' });
  R.xb().dispatchEvent(new Ev('click', { bubbles: true, cancelable: true }));
  assert.deepEqual(R.acts, ['w1 disconnect'], 'a second tap on the × does');
  // a mouse tap: its click targets the common ancestor; a click on the × after it disconnects as before
  R.acts.length = 0; R.L.select(null);
  ptr(R.hit('w4'), 'pointerdown', 500, 300, { pointerId: 5 }); ptr(R.hit('w4'), 'pointerup', 500, 300, { pointerId: 5 });
  assert.equal(R.L.selected(), 'w4');
  R.xb().click();
  assert.deepEqual(R.acts, ['w4 disconnect']);
  R.L.destroy();
});

test('review 2 P1-6 (the lead\'s decision): a source routed into a filter that is off and has no module is drawn as a dimmed stub "→ Filter 1 (off)" (its id and edge kept: the tap, Disconnect, the routing as a stub\'s); the filter on, or off with a module (a lay entry): the cable to it as before', () => {
  const t = partsTrack(), s = t.dev.i1.vals.s;
  s.p['f.on'] = 0;
  const I = C.cablesOf(t).filter(c => c.int), a = I.find(c => c.id === 'x:i1:oscA.out>filter.in');
  assert.deepEqual([a.a, a.b, !!a.stub, a.off, a.label, !!a.dim, JSON.stringify(a.edge)], ['i1/oscA.out', null, true, 'filter', '→ Filter 1 (off)', true, JSON.stringify({ a: 'oscA.out', b: 'filter.in' })]);
  const f = I.filter(c => c.id === 'x:i1:oscB.out>filter.in' || c.id === 'x:i1:oscB.out>filter2.in').map(c => [c.id, c.b, !!c.stub, c.label || '']);
  assert.deepEqual(f, [['x:i1:oscB.out>filter.in', null, true, '→ Filter 1 (off)'], ['x:i1:oscB.out>filter2.in', 'i1/filter2.in', false, '']], 'a fork\'s branch into the off filter too');
  s.p['f2.on'] = 0;
  assert.equal(C.cablesOf(t).find(c => c.id === 'x:i1:oscB.out>filter2.in').label, '→ Filter 2 (off)');
  t.lay['i1/filter'] = { x: 640, y: 0 }; // (off, with its module: dimmed there, the cable to it)
  const a2 = C.cablesOf(t).find(c => c.id === 'x:i1:oscA.out>filter.in');
  assert.deepEqual([a2.b, !!a2.stub, a2.off || null], ['i1/filter.in', false, null]);
  // drawn as a stub, its label the cable's
  const doc = fresh(), W = doc.createElement('div'); doc.body.append(W);
  const L = C.createCables(W, { doc, onSelect() {}, onAction() {}, menu: () => [] });
  delete t.lay['i1/filter'];
  L.set(C.cablesOf(t));
  L.layout(new Map([['i1/oscA.out', { x: 288, y: 68 }]]));
  const g = all(L.under).find(n => n.getAttribute && n.getAttribute('data-cable') === 'x:i1:oscA.out>filter.in');
  assert.deepEqual([g.style.display, g.hasAttribute('data-stub'), /\bcv-off\b/.test(g.getAttribute('class')), g.childNodes[1].getAttribute('d')], ['', true, true, C.cablePath(288, 68, 288 + C.STUB_PX, 68)]);
  assert.equal(all(g).find(n => n.getAttribute && n.getAttribute('class') === 'cv-cable-lab').textContent, '→ Filter 1 (off)');
  L.destroy();
});

test('review 2 P1-7: a hidden knob end\'s badge (its tag) sits at the end, right of it and above (.cv-hid: CSS left-aligned, its bottom at the end) — never left of the end, where Tidy puts FILTER 1\'s bar; a shown end\'s badge as before (right edge at the end piece\'s start); several hidden badges at one end stack upwards', () => {
  const doc = fresh(), W = doc.createElement('div');
  doc.body.append(W);
  const L = C.createCables(W, { doc, onSelect() {}, onAction() {}, menu: () => [] });
  const t = partsTrack();
  t.mods.push({ id: 'r2', src: 'i1/lfo3.out', dst: 'i1:c.level', amt: 0.25 });
  L.set(C.cablesOf(t));
  const P = new Map([['i1/lfo3.out', { x: -100, y: -300 }], ['i1/lfo1.out', { x: 1500, y: -400 }], ['i1:a.semi', { x: 1088, y: 0, hid: true, tag: 'OSC A · SEMI · hidden' }],
    ['i1:c.level', { x: 1088, y: 0, hid: true, tag: 'OSC C · LEVEL · hidden' }], ['i1:a.wt', { x: 1300, y: 300 }]]);
  L.layout(P);
  const b1 = L.badge('r1'), b2 = L.badge('r2'), b0 = L.badge('o:i1:0');
  assert.deepEqual([b1.classList.contains('cv-hid'), b1.style.left, b1.style.top], [true, '1088px', '0px'], 'at the end itself');
  assert.deepEqual([b2.classList.contains('cv-hid'), b2.style.left, parseFloat(b2.style.top) < 0], [true, '1088px', true], 'the second one above the first');
  assert.equal(b0.classList.contains('cv-hid'), false);
  assert.equal(parseFloat(b0.style.left) < 1300, true, 'a shown end: left of the knob as before');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.cv-mbadge\.cv-hid\s*\{[^}]*transform:\s*translate\(0,\s*-100%\)/, 'CSS: left-aligned at the end, its bottom there');
  L.destroy();
});

test('review 2 P1-5: a stub stays reachable at low zoom — STUB_PX screen px out of its out jack (whose touch circle is 22 screen px) up to STUB_MAX world px; a zoom re-lays it; a pointer tap tells onSelect its pointer type (the host opens the routing popover after the tap\'s click), a programmatic select tells none', () => {
  let k = 0.4;
  const doc = fresh(), W = doc.createElement('div');
  doc.body.append(W);
  const sel = [];
  const L = C.createCables(W, { doc, k: () => k, onSelect: (id, by) => sel.push(id + ' ' + by), onAction() {}, menu: () => [] });
  L.set(C.cablesOf(partsTrack()));
  L.layout(new Map([['i1/oscC.out', { x: 288, y: 900 }]]));
  const id = 'x:i1:oscC.out>', g = () => all(L.under).find(n => n.getAttribute && n.getAttribute('data-cable') === id);
  const d = () => g().childNodes[1].getAttribute('d');
  assert.equal(C.STUB_MAX >= C.STUB_PX, true);
  assert.equal(d(), C.cablePath(288, 900, 288 + Math.min(C.STUB_MAX, C.STUB_PX / 0.4), 900), 'k 0.4: longer than the jack\'s circle');
  assert.equal(Math.min(C.STUB_MAX, C.STUB_PX / 0.4) * 0.4 > 22 + 8, true, 'at least 8 screen px clear of the jack\'s touch circle');
  k = 0.5; L.rezoom();
  assert.equal(d(), C.cablePath(288, 900, 288 + C.STUB_PX / 0.5, 900), 'a zoom re-lays it');
  k = 2; L.rezoom();
  assert.equal(d(), C.cablePath(288, 900, 288 + C.STUB_PX, 900), 'k ≥ 1: STUB_PX world px');
  const hit = g().childNodes.find(n => n.getAttribute('class') === 'cv-cable-hit');
  ptr(hit, 'pointerdown', 10, 10, { pointerId: 3, pointerType: 'touch' }); ptr(doc.body, 'pointerup', 10, 10, { pointerId: 3, pointerType: 'touch' });
  L.select(null); L.select(id);
  assert.deepEqual(sel, [id + ' touch', 'null undefined', id + ' undefined']);
  L.destroy();
});

/* ---------------------------------------------------------------- stage 7d + 8 (IMPL-8 §5.4, §9; lane U): the Pads module */
// a Juno (i1, keys C3–C5) and an 808 (i2) on one track; a second track; a Pads module with note / chord / drum / mod pads
function padsFix() {
  const t = { id: 'trk_1', name: 'Mix', color: '#3b82c4', prim: 'i1', dev: { i1: { kind: 'synth', model: 'juno60', zone: { lo: 48, hi: 72 } }, i2: { kind: 'synth', model: 'tr808', drum: DCX.normDrum(undefined) }, out: { kind: 'out' } },
    wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }, { id: 'w2', a: 'i2.out', b: 'out.in' }], mods: [] };
  const p = new Array(64).fill(null);
  p[0] = { t: [{ k: 'note', tr: 'trk_1', n: 40 }], c: 3 }; // (below the Juno's zone: plays nothing there)
  p[1] = { t: [{ k: 'chord', tr: 'trk_1', root: 60, q: 'maj' }], c: PCX.C_MAGENTA };
  p[2] = { t: [{ k: 'drum', tr: 'trk_1', s: 'bd' }], c: PCX.C_RED };
  p[3] = { t: [{ k: 'note', tr: 'trk_2', n: 60 }] }; // (another track)
  p[8] = { mod: { m: 'gate' }, c: 4 };
  p[60] = { t: [{ k: 'note', tr: 'trk_1', n: 60 }], mod: { m: 'tog' }, c: 8 }; // (hidden at 4 × 4)
  const project = { tracks: [t, { id: 'trk_2', name: 'B', dev: {} }], pads: PCX.normPads([{ id: 'pd1', rows: 4, cols: 4, pads: p }, { id: 'pd2', rows: 1, cols: 1 }]) };
  return { t, project };
}

test('(8) keyKind / modSrcPort / srcKind of the Pads module: pd1…pd64 → \'pads\' (IMPL-P: was pd1…pd8), a row src pd<n>.p0…p63 → its slot\'s jack; anything else unchanged', () => {
  assert.deepEqual(['pd1', 'pd8', 'pd9', 'pd10', 'pd64', 'pd65', 'pd0', 'pd', 'pd1x', 'pd100', 'pd01'].map(C.keyKind), ['pads', 'pads', 'pads', 'pads', 'pads', null, null, null, null, null, null]);
  assert.deepEqual(['pd1.p0', 'pd64.p63', 'pd1.p64', 'pd1.p01', 'pd65.p1', 'pd1.out', 'pd1.k1', 'pd1'].map(C.modSrcPort),
    [{ key: 'pd1', port: 'p0' }, { key: 'pd64', port: 'p63' }, null, null, null, { key: 'pd1', port: 'out' }, { key: 'pd1', port: 'k1' }, null]);
  assert.deepEqual(['pd1.p12', 'pd3.p0'].map(C.srcKind), ['pads', 'pads']);
  assert.deepEqual([C.modSrcJack('pd1.p12'), C.modSrcKey('pd2.p5'), C.modSrcOf('pd1.p12')], ['pd1.p12', 'pd2', 'pd1.p12']);
});

test('(8) cablesOf: a mod pad\'s row leaves from its inline jack in the pad\'s colour (a missing pad: the track\'s); note cables per (module, instrument of this track a visible pad plays) — key zones, a drum target\'s machine, other tracks and hidden pads left out; none without pads', () => {
  const { t, project } = padsFix();
  t.mods = [{ id: 'r1', src: 'pd1.p8', dst: 'i1:vcf.cut', amt: 0.5 }, { id: 'r2', src: 'pd1.p60', dst: 'i1:vcf.res', amt: 0.2 }, { id: 'r3', src: 'pd3.p1', dst: 'i1:vcf.res', amt: 0.2 }];
  const L = C.cablesOf(t, { project }), byId = id => L.find(c => c.id === id);
  assert.deepEqual(['r1', 'r2', 'r3'].map(id => [byId(id).a, byId(id).kind, byId(id).color]),
    [['pd1.p8', 'mod', PCX.COLORS[4].lit], ['pd1.p60', 'mod', PCX.COLORS[8].lit], ['pd3.p1', 'mod', '#3b82c4']]);
  const N = L.filter(c => c.kind === 'note');
  assert.deepEqual(N.map(c => [c.id, c.a, c.b, c.tap, c.pads, c.color, c.readonly]), [
    ['n:pd1>i1', 'pd1.notes', 'i1.' + C.NOTE_END, 'pads', [1], PCX.COLORS[PCX.C_MAGENTA].lit, undefined],
    ['n:pd1>i2', 'pd1.notes', 'i2.' + C.NOTE_END, 'pads', [0, 1, 2], PCX.COLORS[3].lit, undefined]],
  'the Juno: the chord (pad 1 below its zone); the 808: its kick, E2 (its map\'s second snare note) and the chord\'s E4 (its low conga) — notes by its map; pad 4 another track, slot 60 hidden: none');
  t.dev.i2.drum = Object.assign({}, t.dev.i2.drum, { map: Object.assign({}, t.dev.i2.drum.map, { sd: [38], lc: [] }) });
  assert.deepEqual(C.cablesOf(t, { project }).filter(c => c.kind === 'note').map(c => c.pads), [[1], [2]], 'a note the machine maps to nothing: no cable');
  t.dev.i1.zone = { lo: 0, hi: 127 };
  assert.deepEqual(C.cablesOf(t, { project }).filter(c => c.kind === 'note').map(c => c.pads), [[0, 1], [2]], 'all keys: the low note too');
  assert.equal(C.cablesOf(t, { project }).find(c => c.id === 'n:pd1>i1').color, PCX.COLORS[3].lit, 'the first such pad\'s colour');
  const t2 = JSON.parse(JSON.stringify(t)), plain = C.cablesOf(t2, { project: { tracks: [t2] } });
  assert.deepEqual(plain.filter(c => c.kind === 'note'), []);
  assert.deepEqual(C.cablesOf(t2, { project: { tracks: [t2], pads: [] } }), plain, 'a project without pads: today\'s cables');
  assert.deepEqual(C.cablesOf(t2), C.cablesOf(t2, { project: { tracks: [t2], pads: 'x' } }));
});

test('(8) a note cable in the layers: a tap cable — a tap is onAction(id, \'tap\') (the host lists its pads), never selected, no Disconnect; data-kind="note"', () => {
  const doc = fresh(), W = doc.createElement('div');
  doc.body.append(W);
  const sel = [], acts = [];
  const L = C.createCables(W, { doc, onSelect: id => sel.push(id), onAction: (id, a) => acts.push(id + ' ' + a) });
  const { t, project } = padsFix();
  L.set(C.cablesOf(t, { project }));
  L.layout(new Map([['pd1.notes', { x: -100, y: 68 }], ['i1.' + C.NOTE_END, { x: 0, y: 68 }], ['i2.' + C.NOTE_END, { x: 0, y: 668 }], ['i1.out', { x: 900, y: 68 }], ['i2.out', { x: 900, y: 668 }], ['out.in', { x: 1300, y: 68 }]]));
  const g = all(L.under).find(n => n.getAttribute && n.getAttribute('data-cable') === 'n:pd1>i1'), hit = g.childNodes.find(n => n.getAttribute('class') === 'cv-cable-hit');
  assert.equal(sj([g.getAttribute('data-kind'), g.getAttribute('data-tap'), g.hasAttribute('data-ro'), g.style.display, g.childNodes[1].getAttribute('d')]),
    sj(['note', 'pads', false, '', C.cablePath(-100, 68, 0, 68)]));
  ptr(hit, 'pointerdown', 50, 68, { pointerId: 3, pointerType: 'mouse' }); ptr(doc.body, 'pointerup', 50, 68, { pointerId: 3, pointerType: 'mouse' });
  assert.deepEqual([acts, L.selected(), sel.length], [['n:pd1>i1 tap'], null, 0]);
  L.select('n:pd1>i1');
  assert.equal(L.selected(), null, 'never selected');
  L.destroy();
});

/* ---------------------------------------------------------------- stage WC (IMPL-WC §4.1, §4.4, G8; lane C): cords mode */
test('(WC, §4.1) cablesOf(track, { edges }): a Serum-engine device shown as its modules takes its internal records from opts.edges(id, dev) when it answers an array (the host: rig-core\'s edges()), else sx-edges\' as before (null, a throw, no hook); the rest unchanged', () => {
  const t = { id: 'trk', color: '#3b82c4', prim: 'i1', lay: {}, dev: { i1: { kind: 'synth', model: 'rig', vals: { s: core.defaultSerum() }, fx: core.defaultFx2() }, out: { kind: 'out' } }, wires: [] };
  const mine = { id: 'x:i1:oscA.out>voice.main', kind: 'audio', int: 'audio', dev: 'i1', edge: { a: 'oscA.out', b: 'voice.main' }, a: 'i1/oscA.out', b: 'i1.main', c: 2, o: 1, s: 0 };
  const asked = [], ids = L => L.map(c => c.id);
  const L = C.cablesOf(t, { parts: () => true, edges: (id, dev) => { asked.push(id + ' ' + dev.model); return [mine, null, { no: 'id' }]; } });
  assert.deepEqual([ids(L), asked], [['i1.out>i1/fx.in', 'x:i1:oscA.out>voice.main'], ['i1 rig']], 'its records (the invalid ones dropped)');
  assert.equal(L[1], mine, 'as given');
  const base = ids(C.cablesOf(t, { parts: () => true }));
  assert.ok(base.includes('x:i1:oscA.out>filter.in'), 'no hook: sx-edges\' (a default state: OSC A → Filter 1)');
  assert.deepEqual([ids(C.cablesOf(t, { parts: () => true, edges: () => null })), ids(C.cablesOf(t, { parts: () => true, edges: () => { throw new Error('x'); } }))], [base, base], 'null or a throw: sx-edges\'');
  assert.deepEqual(ids(C.cablesOf(t, { parts: () => false, edges: () => [mine] })), ['i1.out>i1/fx.in'], 'not shown as its modules: none (the hook not asked)');
});

// tests/ref-WC/record.mjs's serialiser: tag, attributes in order, the style keys set, children
function html(n) {
  if (n.nodeType === 3) return n.textContent;
  let s = '<' + n.localName;
  for (const [k, v] of n._a) s += ' ' + k + '="' + String(v) + '"';
  const st = Object.keys(n.style).filter(k => typeof n.style[k] !== 'function' && n.style[k] !== undefined);
  if (st.length) s += ' style="' + st.map(k => k + ':' + n.style[k]).join(';') + '"';
  s += '>';
  for (const c of n.childNodes) s += html(c);
  return s + '</' + n.localName + '>';
}
// a rig's records (cv-cables' shapes, as lane K's edges() gives them): its internal cords (one a dry source's: "dry"), a warp tap
// cable, a stub, its own LFO row onto its filter (per note: dashed); the derived Amplifier → FX line and a canvas LFO's row
const rigRecs = () => [
  { id: 'i1.out>i1/fx.in', kind: 'audio', a: 'i1.out', b: 'i1/fx.in', readonly: true, src: ['i1'] },
  { id: 'x:i1:oscA.out>filter.in', kind: 'audio', int: 'audio', dev: 'i1', edge: { a: 'oscA.out', b: 'filter.in' }, a: 'i1/oscA.out', b: 'i1/filter.in', src: ['i1'] },
  { id: 'x:i1:oscB.out>filter.in', kind: 'audio', int: 'audio', dev: 'i1', edge: { a: 'oscB.out', b: 'filter.in' }, a: 'i1/oscB.out', b: 'i1/filter.in', label: 'dry', src: ['i1'] },
  { id: 'x:i1:filter.out>voice.main', kind: 'audio', int: 'audio', dev: 'i1', edge: { a: 'filter.out', b: 'voice.main' }, a: 'i1/filter.out', b: 'i1.main', src: ['i1'] },
  { id: 'x:i1:oscA.out>oscB.warp', kind: 'audio', int: 'warp', dev: 'i1', edge: { a: 'oscA.out', b: 'oscB.warp' }, a: 'i1/oscA.out', b: 'i1/oscB.warp', tap: 'open', label: 'FM' },
  { id: 'x:i1:oscC.out>', kind: 'audio', int: 'audio', dev: 'i1', edge: { a: 'oscC.out', b: null }, a: 'i1/oscC.out', b: null, stub: true, label: '→ Filter (off)' },
  { id: 'o:i1:3', kind: 'mod', a: 'i1/lfo1.out', b: 'i1:f.cutoff', amt: 0.5, bi: false, byp: false, preset: false, dashed: true, own: true, dev: 'i1', slot: 3, src: 'lfo1', color: '#e27c2f' },
  { id: 'r1', kind: 'mod', a: 'l1.out', b: 'i1:a.level', amt: -0.25, bi: false, byp: false, preset: false, dashed: false, src: 'l1.out' },
];
const CLAIMED = ['x:i1:oscA.out>filter.in', 'x:i1:oscB.out>filter.in', 'x:i1:filter.out>voice.main', 'x:i1:oscA.out>oscB.warp', 'o:i1:3'];
const RIG_P = () => new Map([['i1.out', { x: 600, y: 300 }], ['i1/fx.in', { x: 700, y: 300 }], ['i1/oscA.out', { x: 100, y: 100 }], ['i1/oscB.out', { x: 100, y: 200 }],
  ['i1/oscC.out', { x: 100, y: 300 }], ['i1/filter.in', { x: 300, y: 150 }], ['i1/filter.out', { x: 400, y: 150 }], ['i1.main', { x: 500, y: 250 }], ['i1.level', { x: 520, y: 260 }],
  ['i1/oscB.warp', { x: 60, y: 200 }], ['i1/lfo1.out', { x: 100, y: 500 }], ['i1/env1.out', { x: 100, y: 600 }], ['i1:f.cutoff', { x: 400, y: 500, r: 20 }], ['l1.out', { x: -200, y: 500 }],
  ['i1:a.level', { x: 150, y: 120 }]]);
const claimRig = c => !!c.int || !!c.own; // (the host's §4.1 table in miniature: the rig's own connections)
const KZ = { k: 1 }; // ((fixer B2) a zoom the tests move
function cordLayers(o = {}) {
  const doc = fresh(), W = doc.createElement('div'), TOP = o.withTop ? doc.createElement('div') : null; // ((fixer B2) the layer above the cords)
  doc.body.append(W);
  if (TOP) doc.body.append(TOP);
  const sel = [], acts = [], recs = [], csel = [];
  const L = C.createCables(W, Object.assign({ doc, onSelect: (id, by) => sel.push(String(id) + (by ? '/' + by : '')), onAction: (id, a) => acts.push(id + ' ' + a),
    menu: id => [{ label: 'Bypass ' + id, action() {} }], cords: claimRig, onRecords: (L2, p) => recs.push([L2.map(c => c.id + (c.fade ? '~' : '')), p ? p.size : null]),
    cordSel: id => csel.push(id), cordPoint: () => ({ x: 250.5, y: 333.25 }) }, TOP ? { top: () => TOP } : null, o));
  L.set(rigRecs());
  const g = id => all(W).find(n => n.localName === 'g' && n.getAttribute('data-cable') === id) || null;
  const xb = () => all(doc.body).find(n => n.getAttribute && n.getAttribute('class') === 'cv-cable-x') || null;
  return { doc, W, L, sel, acts, recs, csel, g, xb, TOP };
}

test('(WC) cords mode: a claimed record gets NO path (its group in the over layer, its label a tag above its b plug), keeps its badge (a per-note row\'s "∿ last note", END_PX past the knob\'s rim toward its source); the unclaimed draw as today on the same canvas; a stub is never claimed', () => {
  const R = cordLayers(), P = RIG_P();
  R.L.layout(P);
  const under = all(R.L.under).filter(n => n.getAttribute && n.getAttribute('data-cable'));
  assert.deepEqual(under.map(n => n.getAttribute('data-cable')), ['i1.out>i1/fx.in', 'x:i1:oscC.out>', 'r1'], 'the lines: Amplifier → FX, the stub, the canvas LFO\'s row');
  assert.ok(under.every(n => n.childNodes.filter(q => q.localName === 'path').length === 2), 'each its visible + hit path');
  assert.deepEqual(CLAIMED.map(id => all(R.W).filter(n => n.localName === 'path' && n.parentNode && n.parentNode.getAttribute('data-cable') === id).length), [0, 0, 0, 0, 0], 'no path, no tail twin');
  assert.deepEqual(all(R.L.over).filter(n => n.getAttribute && n.getAttribute('data-cord') != null).map(n => n.getAttribute('data-cable')), CLAIMED, 'their groups: the over layer, data-cord');
  assert.deepEqual(R.L.cordList().map(c => c.id), CLAIMED, 'cordList');
  assert.deepEqual([R.L.claimed('o:i1:3'), R.L.claimed('r1'), R.L.claimed('x:i1:oscC.out>')], [true, false, false]);
  const lab = id => { const t = R.g(id).childNodes.find(n => n.localName === 'text'); return [t.textContent, t.getAttribute('x'), t.getAttribute('y')]; };
  assert.deepEqual([lab('x:i1:oscB.out>filter.in'), lab('x:i1:oscA.out>oscB.warp')], [['dry', '300', String(150 - C.CORD_TAG_DY)], ['FM', '60', String(200 - C.CORD_TAG_DY)]], 'the tag above its b plug');
  const b = R.L.badge('o:i1:3'), nt = b.childNodes.find(n => n.getAttribute('class') === 'cv-ntag');
  assert.deepEqual([b.hasAttribute('data-cord'), nt.hidden, nt.textContent, /∿ last note/.test(b.getAttribute('aria-label'))], [true, false, C.NOTE_TAG, true], 'a per-note row: the badge says it');
  assert.deepEqual([b.style.left, b.style.top, b.getAttribute('data-to')], [(400 - 20 - C.END_PX) + 'px', '500px', 'l'], 'END_PX screen px past the rim (r 20), toward the source');
  const b1 = R.L.badge('r1');
  assert.deepEqual([b1.hasAttribute('data-cord'), b1.childNodes.some(n => n.getAttribute('class') === 'cv-ntag'), b1.getAttribute('data-to')], [false, false, null], 'a line\'s badge as today');
  // the zoom: END_PX screen px again; a source to the right: data-to r
  const Z = cordLayers({ k: () => 2 });
  Z.L.layout(P);
  assert.equal(Z.L.badge('o:i1:3').style.left, (400 - 20 - C.END_PX / 2) + 'px');
  P.set('i1/lfo1.out', { x: 900, y: 500 }); R.L.layout(P);
  assert.deepEqual([b.style.left, b.getAttribute('data-to')], [(400 + 20 + C.END_PX) + 'px', 'r']);
  R.L.destroy(); Z.L.destroy();
});

test('(WC, fixer B2; the user 2026-10-26 "directly to the back of the knob"; review 2 P2-3 / P3-7) o.onRecords(records, ports, k) may answer { badges, forks }: a claimed mod row\'s badge at the host\'s place (world px, centred: data-at — the host keeps it on the cord just outside the knob\'s rim, off every control and every other badge), a claimed fork\'s BAL at its place; a record it leaves out: the rim rule as before; a zoom (rezoom, its k) asks again; o.cordEnd is gone', () => {
  const asked = [], at = { 'o:i1:3': { x: 333.333, y: 444 } };
  const R = cordLayers({ onRecords: (L, p, k) => { asked.push([L.length, p ? p.size : null, k]); return { badges: new Map(Object.entries(at)) }; }, k: () => KZ.k }), P = RIG_P();
  R.L.layout(P);
  assert.deepEqual(asked.at(-1), [5, P.size, 1], 'asked with the records, the ports and the zoom');
  const b = R.L.badge('o:i1:3');
  assert.deepEqual([b.style.left, b.style.top, b.getAttribute('data-at'), b.getAttribute('data-to')], ['333.33px', '444px', 'c', null], 'the host\'s place, centred');
  delete at['o:i1:3']; R.L.layout(P);
  assert.deepEqual([b.style.left, b.style.top, b.getAttribute('data-at'), b.getAttribute('data-to')], [(400 - 20 - C.END_PX) + 'px', '500px', null, 'l'], 'left out: the rim rule');
  at['o:i1:3'] = { x: 10, y: 20 }; KZ.k = 2;
  assert.equal(R.L.rezoom(), true);
  assert.deepEqual([asked.at(-1)[2], b.style.left, b.style.top], [2, '10px', '20px'], 'a zoom: asked again at the new k');
  KZ.k = 1;
  const F = cordLayers({ onRecords: () => ({ forks: new Map([['i1/oscA.out', { x: 150.5, y: 100 }]]) }) });
  F.L.set(rigRecs().concat([{ id: 'x:i1:oscA.out>filter2.in', kind: 'audio', int: 'audio', dev: 'i1', edge: { a: 'oscA.out', b: 'filter2.in' }, a: 'i1/oscA.out', b: 'i1/filter2.in', fork: true, src: ['i1'] }]));
  P.set('i1/filter2.in', { x: 300, y: 250 }); F.L.layout(P);
  const fb = F.L.forkBadge('i1/oscA.out');
  assert.deepEqual([!!fb, fb && fb.style.left, fb && fb.style.top], [true, '150.5px', '100px'], 'a claimed fork\'s BAL at the host\'s place (right of its fanned plugs)');
  R.L.destroy(); F.L.destroy();
});

test('(WC) onRecords fires after set (no ports yet: null) and after layout (the ports) with the claimed records; the visibility filters them (Never: no mod cords, On select: those touching, Always past MOD_FADE_N: fade: true copies — the host\'s 0.3 alpha); records never mutated', () => {
  const R = cordLayers(), P = RIG_P();
  assert.deepEqual(R.recs, [[CLAIMED, null]], 'after set: no ports yet');
  R.L.layout(P);
  assert.deepEqual(R.recs.at(-1), [CLAIMED, P.size], 'after layout: the ports');
  R.L.layout(P);
  assert.equal(R.recs.length, 3, 'every layout (the anchors may have moved)');
  R.L.setModsVisible('never');
  assert.deepEqual(R.recs.at(-1)[0], CLAIMED.slice(0, 4), 'Never: no mod cord');
  const n = R.recs.length;
  R.L.setModsVisible('select');
  assert.equal(R.recs.length, n, 'the same set: no call');
  R.L.select('o:i1:3');
  assert.deepEqual(R.recs.at(-1)[0], CLAIMED, 'On select: the selected one');
  R.L.select(null); R.L.highlight(['o:i1:3']);
  assert.deepEqual(R.recs.at(-1)[0], CLAIMED, 'a highlight touches it too');
  R.L.highlight(null); R.L.setModsVisible('always');
  const many = rigRecs().concat(Array.from({ length: 25 }, (_, i) => ({ id: 'o:i1:' + (10 + i), kind: 'mod', a: 'i1/lfo1.out', b: 'i1:f.cutoff', amt: 0.1, own: true, dev: 'i1', slot: 10 + i, src: 'lfo1' })));
  R.L.set(many); R.L.layout(P);
  const last = R.recs.at(-1)[0];
  assert.deepEqual([last.filter(x => x.endsWith('~')).length, last.includes('x:i1:oscA.out>filter.in')], [26, true], 'past 24: every mod cord not touching the selection faded, the audio ones never');
  R.L.select('o:i1:20');
  assert.ok(R.recs.at(-1)[0].includes('o:i1:20') && !R.recs.at(-1)[0].includes('o:i1:20~'), 'the selected one unfaded');
  assert.equal(many.some(c => 'fade' in c), false, 'a copy: the records untouched');
  R.L.destroy();
});

test('(WC) a claimed cord\'s selection: tap(id, p, by) — the world\'s tap on its body — selects it (onSelect with the pointer, cordSel mirrors it to the layer, the × at the tap point; a new tap moves it; its ends moving drop the point); a keyboard select puts the × on its rope (cordPoint); Delete / Escape / the menu as a line\'s; a mod row: no ×, a second tap the inspector; a warp cord taps; an unclaimed id is not the cords\'', () => {
  const R = cordLayers(), P = RIG_P();
  R.L.layout(P);
  assert.equal(R.L.tap('x:i1:oscA.out>filter.in', { x: 210.444, y: 140.6 }, 'touch'), true);
  assert.deepEqual([R.sel.at(-1), R.csel.at(-1), R.L.selected(), R.g('x:i1:oscA.out>filter.in').getAttribute('class')], ['x:i1:oscA.out>filter.in/touch', 'x:i1:oscA.out>filter.in', 'x:i1:oscA.out>filter.in', 'cv-cable-g cv-sel']);
  const x = R.xb();
  assert.deepEqual([x.hidden, x.style.left, x.style.top], [false, '210.44px', '140.6px'], 'the × at the tap point');
  x.click();
  assert.deepEqual(R.acts, [], 'the touch tap\'s own click on the × under the finger never disconnects (review 2 P1-1)');
  R.L.tap('x:i1:oscA.out>filter.in', { x: 260, y: 170 }, 'mouse');
  assert.deepEqual([x.style.left, x.style.top, R.L.selected()], ['260px', '170px', 'x:i1:oscA.out>filter.in'], 'again: the × follows the new tap');
  P.set('i1/filter.in', { x: 320, y: 150 }); R.L.layout(P);
  assert.deepEqual([x.style.left, x.style.top], ['250.5px', '333.25px'], 'its end moved: the × on the rope (cordPoint)');
  key(R.doc.body, 'Delete');
  assert.deepEqual(R.acts, ['x:i1:oscA.out>filter.in disconnect'], 'Delete disconnects');
  key(R.doc.body, 'Escape');
  assert.deepEqual([R.L.selected(), R.csel.at(-1)], [null, null], 'Escape clears it — the layer too');
  R.L.select('x:i1:filter.out>voice.main');
  assert.deepEqual([x.style.left, x.style.top, R.csel.at(-1)], ['250.5px', '333.25px', 'x:i1:filter.out>voice.main'], 'a keyboard select: the × on the rope');
  R.L.openMenu('x:i1:filter.out>voice.main', 5, 5);
  assert.deepEqual(menuLabels(R.doc), ['Disconnect', 'Bypass x:i1:filter.out>voice.main'], 'its menu as a line\'s');
  R.L.tap('o:i1:3', { x: 300, y: 500 }, 'mouse');
  assert.deepEqual([R.L.selected(), x.hidden, R.csel.at(-1), R.sel.at(-1)], ['o:i1:3', true, 'o:i1:3', 'o:i1:3/mouse'], 'a mod row: selected, no ×');
  const n = R.sel.length;
  R.L.tap('o:i1:3', { x: 300, y: 500 }, 'mouse');
  assert.deepEqual([R.sel.length, R.sel.at(-1)], [n + 1, 'o:i1:3/mouse'], 'tapped again: onSelect again (the host\'s inspector)');
  R.L.tap('x:i1:oscA.out>oscB.warp', { x: 80, y: 150 });
  assert.deepEqual([R.acts.at(-1), R.L.selected()], ['x:i1:oscA.out>oscB.warp tap', 'o:i1:3'], 'a warp cord: its tap (the oscillator\'s menu), never selected');
  assert.deepEqual([R.L.tap('r1', { x: 0, y: 0 }), R.L.tap('nope', null)], [false, false], 'not claimed: not the cords\'');
  fire(R.L.badge('o:i1:3'), 'contextmenu', { clientX: 9, clientY: 9 });
  assert.deepEqual(menuLabels(R.doc), ['Disconnect', 'Bypass o:i1:3'], 'its badge\'s menu');
  R.L.destroy();
});

test('(WC) a record whose claim changes is made again (a cord ↔ a line: its paths, its twin, its badge); o.cords absent, null or claiming nothing: the markup is today\'s byte for byte', () => {
  let on = true;
  const R = cordLayers({ cords: c => on && claimRig(c) }), P = RIG_P();
  R.L.layout(P); R.L.select('x:i1:filter.out>voice.main');
  on = false; R.L.set(rigRecs());
  assert.deepEqual([all(R.L.under).filter(n => n.getAttribute && n.getAttribute('data-cable')).length, R.L.claimed('o:i1:3'), R.L.badge('o:i1:3').hasAttribute('data-cord')], [8, false, false], 'every one a line again');
  assert.equal(R.g('x:i1:filter.out>voice.main').getAttribute('class'), 'cv-cable-g cv-sel', 'still selected: its class on the new group');
  assert.equal(R.csel.at(-1), null, 'the layer: no cord selected');
  on = true; R.L.set(rigRecs());
  assert.deepEqual([R.L.claimed('o:i1:3'), R.csel.at(-1)], [true, 'x:i1:filter.out>voice.main'], 'a cord again, the layer\'s selection back');
  R.L.destroy();
  // the same script with no predicate, a null one and one that claims nothing: the same markup
  const script = o => {
    const doc = fresh(), W = doc.createElement('div');
    doc.body.append(W);
    const L = C.createCables(W, Object.assign({ doc, k: () => 1 }, o));
    const out = [];
    L.set(rigRecs()); out.push(html(W));
    L.layout(RIG_P()); out.push(html(W));
    L.select('x:i1:filter.out>voice.main'); out.push(html(W));
    L.highlight(['r1']); L.setModsVisible('select'); out.push(html(W));
    L.setModsVisible('always'); L.highlight(null); L.select('o:i1:3'); out.push(html(W));
    L.set(rigRecs().slice(2)); L.layout(RIG_P()); out.push(html(W));
    L.destroy();
    return out;
  };
  const base = script({});
  assert.deepEqual(script({ cords: null }), base, 'cords: null');
  assert.deepEqual(script({ cords: () => false, onRecords() {}, cordSel() {}, cordPoint: () => ({ x: 1, y: 1 }) }), base, 'claiming nothing');
});

// the cords-mode rig: a scripted world (k 1, the viewport at client (0, 100), an overlay, the cord hook), a rig's modules with their
// cord jacks (data-kind cord + data-cord role + data-dir), its filter's knobs, a line jack (its own FX in), a fake cord layer
function cordRig(o = {}) {
  const doc = fresh(), el = doc.createElement('div'), ov = doc.createElement('div');
  doc.body.append(el, ov);
  const subs = {}, ptrs = [], hooks = {}, log = [], timers = [];
  const world = {
    el, overlay: ov, k: 1, jack: null, jackCancel: null,
    toClient: (x, y) => ({ x, y: y + 100 }), toWorld: (x, y) => ({ x, y: y - 100 }),
    dragPointer: p => ptrs.push(p ? p.x + ',' + p.y : null),
    on: (t, f) => { (subs[t] || (subs[t] = [])).push(f); return () => { subs[t] = subs[t].filter(g => g !== f); }; },
    setJackHook(f, c) { world.jack = f; world.jackCancel = c; return () => { world.jack = null; }; },
    setCordHook(h, t) { hooks.hit = h; hooks.tap = t; return () => { hooks.hit = hooks.tap = null; }; },
  };
  const mk = (tag, attrs, parent) => { const n = doc.createElement(tag); for (const k in attrs) n.setAttribute(k, attrs[k]); (parent || el).append(n); return n; };
  const mod = key => mk('div', { 'data-cv-mod': key, class: 'cv-mod' });
  const M = { oscA: mod('i1/oscA'), oscB: mod('i1/oscB'), oscC: mod('i1/oscC'), filter: mod('i1/filter'), amp: mod('i1'), lfo: mod('i1/lfo1'), env: mod('i1/env1'), fx: mod('i1/fx') };
  const LAB = { 'i1/oscA.out': 'Oscillator 1 out', 'i1/oscB.out': 'Oscillator 2 out', 'i1/oscC.out': 'Oscillator 3 out', 'i1/oscB.warp': 'Oscillator 2 warp', 'i1/filter.in': 'Filter 1 in',
    'i1/filter.out': 'Filter 1 out', 'i1.main': 'Amplifier in', 'i1.level': 'Amplifier level', 'i1/lfo1.out': 'LFO 1 out', 'i1/env1.out': 'Envelope 1 out' };
  const cj = (id, role, dir, parent) => mk('span', o.lines ? { 'data-cv-jack': id, 'data-kind': role === 'mod' ? 'mod' : 'audio', 'data-dir': dir, role: 'button', 'aria-label': LAB[id], title: LAB[id] } // ((fixer B2) lines mode: stage 3's kinds
    : { 'data-cv-jack': id, 'data-kind': 'cord', 'data-cord': role, 'data-dir': dir, 'data-cv-awake': '', role: 'button', 'aria-label': LAB[id], title: LAB[id] }, parent);
  const J = { 'i1/oscA.out': cj('i1/oscA.out', 'audio', 'out', M.oscA), 'i1/oscB.out': cj('i1/oscB.out', 'audio', 'out', M.oscB), 'i1/oscC.out': cj('i1/oscC.out', 'audio', 'out', M.oscC),
    'i1/oscB.warp': cj('i1/oscB.warp', 'warp', 'in', M.oscB), 'i1/filter.in': cj('i1/filter.in', 'audio', 'in', M.filter), 'i1/filter.out': cj('i1/filter.out', 'audio', 'out', M.filter),
    'i1.main': cj('i1.main', 'audio', 'in', M.amp), 'i1.level': cj('i1.level', 'audio', 'in', M.amp), 'i1/lfo1.out': cj('i1/lfo1.out', 'mod', 'out', M.lfo), 'i1/env1.out': cj('i1/env1.out', 'mod', 'out', M.env),
    'i1/fx.in': mk('span', { 'data-cv-jack': 'i1/fx.in', 'data-kind': 'audio', 'data-ro': '', title: 'FX in' }, M.fx) };
  const kp = mk('div', { 'data-dev': 'i1' }, M.filter);
  const K = { cut: mk('div', { 'data-dest': 'f.cutoff', class: 'knob', 'aria-label': 'Cutoff' }, kp), res: mk('div', { 'data-dest': 'f.res', class: 'knob', 'aria-label': 'Resonance' }, kp) };
  place(K.cut, 380, 580, 40, 40); place(K.res, 440, 580, 40, 40); // (client rects: the world + (0, 100))
  const zones = [[K.cut, 380, 580, 40, 40], [K.res, 440, 580, 40, 40]];
  doc.elementFromPoint = (x, y) => { for (const [n, l, t, w, h] of zones) if (x >= l && x < l + w && y >= t && y < t + h) return n; return el; };
  const P = RIG_P();
  const cables = C.createCables(el, { doc, cords: o.lines ? null : claimRig, onSelect: id => log.push('select ' + id), onAction: (id, a) => log.push('act ' + id + ' ' + a), menu: id => [{ label: 'Bypass ' + id, action() {} }] });
  cables.set(rigRecs()); cables.layout(P);
  const layer = { live: x => log.push('live ' + (x ? [x.a.x, x.a.y, x.b.x, x.b.y, x.c, x.s].join(',') : 'null')), grab: (id, end, p) => log.push('grab ' + id + ' ' + end + ' ' + p.x + ',' + p.y),
    move: p => log.push('move ' + p.x + ',' + p.y), drop: () => log.push('drop') };
  const canConnect = (a, b) => (b === 'i1.level' ? (a === 'i1/env1.out' ? { ok: true } : { ok: false, why: 'An Envelope only' })
    : b === 'i1/oscB.warp' ? { ok: false, why: 'Set in the oscillator’s warp menu' }
    : /^i1\/osc[ABC]\.out$/.test(a) && (b === 'i1/filter.in' || b === 'i1.main') ? { ok: true } : a === 'i1/filter.out' && b === 'i1.main' ? { ok: true } : { ok: false, why: 'An oscillator feeds a Filter or the Amplifier' });
  const D = C.createCableDrag(world, Object.assign({
    ports: () => P, cables, doc, port: j => (j === 'i1/fx.in' ? null : j), jacks: () => Object.keys(J).map(id => ({ id, el: J[id] })), rects: () => ({ i1: { x: 450, y: 200, w: 200, h: 200 } }),
    canConnect, canMod: (src, dst) => (dst === 'i1:f.res' || dst === 'i1:f.cutoff' ? { ok: true } : { ok: false, why: 'Not this one' }), markDests: () => [{ dev: 'i1', ids: ['f.cutoff', 'f.res'] }],
    onConnect: (a, b) => log.push('connect ' + a + ' ' + b), onRepatch: (id, a, b) => log.push('repatch ' + id + ' ' + a + ' ' + b), onPull: id => log.push('pull ' + id),
    onRefuse: (a, b, why) => log.push('refuse ' + a + ' ' + b + ': ' + why), onMod: (s, d) => log.push('mod ' + s + ' ' + d), onRepatchMod: (id, d) => log.push('remod ' + id + ' ' + d),
    onJackTap: (src, je) => log.push('jacktap ' + src), onBarDrop: (s, k) => log.push('bar ' + s + ' ' + k),
    live: layer.live, grab: layer, cordLook: j => ({ c: j === 'i1/oscB.out' ? 3 : 2 }),
    later: (f, ms) => { timers.push({ f, ms }); return timers.length; }, unlater: id => { timers[id - 1] = null; },
    cordHit: (p, r, ok) => { log.push('hit ' + p.x + ',' + p.y + ' ' + r); const id = p.y < 200 ? 'x:i1:oscA.out>filter.in' : p.y < 400 ? 'pc1' : null; return id && ok(id) ? id : null; },
  }, o));
  const press = (id, x, y, o2 = {}) => world.jack(new Ev('pointerdown', Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', button: 0 }, o2)), J[id]);
  const mv = (x, y, o2 = {}) => ptr(doc.body, 'pointermove', x, y, Object.assign({ pointerId: 1, pointerType: 'touch' }, o2));
  const upAt = (x, y, o2 = {}) => ptr(doc.body, 'pointerup', x, y, Object.assign({ pointerId: 1, pointerType: 'touch' }, o2));
  const cls = id => J[id].getAttribute('class') || '';
  const chip = () => { const c = all(ov).find(n => n.getAttribute && n.getAttribute('class') === 'cv-plugchip'); return c ? [c.hidden, c.textContent, c.hasAttribute('data-no')] : null; };
  const fireT = () => { for (const t of timers.splice(0)) if (t) t.f(); };
  return { doc, el, ov, world, J, K, M, P, cables, D, log, ptrs, hooks, timers, press, mv, upAt, cls, chip, fireT };
}

test('(WC) cords-mode drag, an OUTPUT: always a new cord — the rope from the jack to the finger (o.live, o.cordLook\'s colour), compatible inputs cv-ok, the rest cv-no with the reason, #world[data-cv-patching="cord"]; the jack under the finger decides first (a refused one: its reason in the chip, no target), else the nearest compatible within SNAP_PX (the chip names it); release → o.onConnect, then the rope goes', () => {
  const R = cordRig();
  assert.equal(typeof R.press('i1/oscC.out', 100, 400).cancel, 'function', 'taken (o.cordPress absent)');
  R.mv(104, 402);
  assert.deepEqual(R.log, [], 'within the slop: nothing');
  R.mv(200, 300);
  assert.deepEqual(['i1/oscC.out', 'i1/filter.in', 'i1.main', 'i1.level', 'i1/oscB.warp', 'i1/oscA.out', 'i1/fx.in'].map(R.cls), ['cv-from', 'cv-ok', 'cv-ok', 'cv-no', 'cv-no', 'cv-no', 'cv-no']);
  assert.deepEqual([R.J['i1.level'].title, R.J['i1/oscA.out'].title, R.J['i1/fx.in'].title], ['An Envelope only', 'Connect an output to an input', 'Inside its instrument: not patchable']);
  assert.deepEqual([R.el.getAttribute('data-cv-patching'), R.log.at(-1)], ['cord', 'live 100,300,200,200,2,0'], 'the rope: the jack → the finger (world px)');
  R.mv(310, 244); // (10 px from Filter 1 in: client (300, 250))
  assert.deepEqual([R.cls('i1/filter.in'), R.log.at(-1), R.chip()], ['cv-ok cv-hot', 'live 100,300,300,150,2,0', [false, 'Filter 1 in', false]], 'snapped, named');
  R.mv(521, 361); // (on LEVEL — refused — with the Amplifier's IN 23 px away: the one under the finger decides)
  assert.deepEqual([R.cls('i1.main'), R.chip()], ['cv-ok', [false, 'Amplifier level — An Envelope only', true]], 'no target: the reason');
  R.upAt(521, 361);
  assert.deepEqual(R.log.slice(-2), ['refuse i1/oscC.out i1.level: An Envelope only', 'live null']);
  assert.deepEqual([R.el.hasAttribute('data-cv-patching'), R.cls('i1.level'), R.J['i1.level'].title, R.chip()[0]], [false, '', 'Amplifier level', true], 'every trace cleared');
  R.log.length = 0;
  R.press('i1/oscA.out', 100, 200); R.mv(200, 250); R.mv(301, 251); R.upAt(301, 251);
  assert.deepEqual(R.log.filter(x => !/^live 100,100,/.test(x)), ['connect i1/oscA.out i1/filter.in', 'live null'], 'an output that has cords: a new one still (never a grab)');
  R.log.length = 0;
  R.press('i1/oscC.out', 100, 400); R.mv(300, 600); R.upAt(300, 600);
  assert.deepEqual(R.log.slice(-1), ['live null'], 'released on nothing: nothing');
  R.D.destroy();
});

test('(WC) cords-mode drag, an INPUT holding cords: its most recent one grabbed (o.grab — its b end in the finger); on another compatible input → o.onRepatch(id, out, in); on its own jack or its source → nothing; away from any jack → o.onPull(id); near a refused one → o.onRefuse; Escape / a second finger → it springs back (drop, nothing written); a free input: a new cord backwards', () => {
  const R = cordRig();
  R.press('i1/filter.in', 300, 250); R.mv(320, 300);
  assert.deepEqual(R.log, ['grab x:i1:oscB.out>filter.in b 320,200', 'move 320,200'], 'the last at Filter 1 IN: Oscillator 2\'s');
  assert.deepEqual(['i1/oscB.out', 'i1/filter.in', 'i1.main', 'i1.level'].map(R.cls), ['cv-from', 'cv-ok', 'cv-ok', 'cv-no'], 'its source fixed; its own jack and the Amplifier\'s IN take it');
  R.mv(500, 351); R.upAt(500, 351);
  assert.deepEqual(R.log.slice(-3), ['move 500,250', 'repatch x:i1:oscB.out>filter.in i1/oscB.out i1.main', 'drop'], 're-patched, then let go (it springs to its new anchor)');
  const run = (pts, tag) => { R.log.length = 0; R.press('i1/filter.in', 300, 250); for (const [x, y] of pts) R.mv(x, y); const [x, y] = pts.at(-1); R.upAt(x, y); return R.log.filter(s => !/^(grab|move)/.test(s)); };
  assert.deepEqual(run([[340, 330], [301, 250]]), ['drop'], 'back on its own jack: nothing');
  assert.deepEqual(run([[200, 300], [101, 301]]), ['drop'], 'on its own source: nothing');
  assert.deepEqual(run([[500, 700], [800, 800]]), ['pull x:i1:oscB.out>filter.in', 'drop'], 'let go away from any jack: pulled');
  assert.deepEqual(run([[400, 330], [521, 361]]), ['refuse i1/oscB.out i1.level: An Envelope only', 'drop'], 'near a refused one: the reason, nothing pulled');
  R.log.length = 0;
  R.press('i1/filter.in', 300, 250); R.mv(500, 500); key(R.doc.body, 'Escape'); R.upAt(800, 800);
  assert.deepEqual(R.log.filter(s => !/^(grab|move)/.test(s)), ['drop'], 'Escape: it springs back');
  R.log.length = 0;
  R.press('i1/filter.in', 300, 250); R.mv(500, 500); R.world.jackCancel(); R.upAt(800, 800);
  assert.deepEqual(R.log.filter(s => !/^(grab|move)/.test(s)), ['drop'], 'a second finger: the same');
  // a free input: a new cord backwards (an Envelope's mod output is a source of LEVEL)
  R.log.length = 0;
  R.press('i1.level', 520, 360); R.mv(400, 500);
  assert.deepEqual(['i1/env1.out', 'i1/lfo1.out', 'i1/oscA.out', 'i1.level'].map(R.cls), ['cv-ok', 'cv-no', 'cv-no', 'cv-from']);
  assert.equal(R.log.at(-1), 'live 520,260,400,400,2,0', 'the rope from LEVEL to the finger');
  R.mv(101, 701); R.upAt(101, 701);
  assert.deepEqual(R.log.slice(-2), ['connect i1/env1.out i1.level', 'live null']);
  R.D.destroy();
});

test('(WC) "Which cord?": a touch long-press (WHICH_MS) on an input holding several — its cords by source, the most recent first; a pick selects it and opens its menu; a mouse press arms none; a drag past the slop disarms it; a right-click on such an input too', () => {
  const R = cordRig();
  R.press('i1/filter.in', 300, 250);
  assert.deepEqual([R.timers.length, R.timers[0].ms], [1, C.WHICH_MS]);
  R.fireT();
  assert.deepEqual(menuLabels(R.doc), ['Which cord?', 'Oscillator 2 out', 'Oscillator 1 out']);
  assert.equal(R.D.active(), false, 'the press is over');
  R.upAt(300, 250);
  assert.deepEqual(R.log, [], 'its lift: nothing');
  const pick = label => { const it = all(R.doc.body).filter(n => n.getAttribute && n.getAttribute('class') === 'wk-cl' && n.textContent === label).at(-1).parentNode; ptr(it, 'pointerdown', 0, 0, { pointerId: 7 }); it.dispatchEvent(new Ev('click', { bubbles: true })); };
  pick('Oscillator 1 out');
  assert.deepEqual([R.cables.selected(), menuLabels(R.doc)], ['x:i1:oscA.out>filter.in', ['Disconnect', 'Bypass x:i1:oscA.out>filter.in']], 'selected, its menu');
  R.press('i1/filter.in', 300, 250, { pointerType: 'mouse' }); R.upAt(300, 250, { pointerType: 'mouse' });
  assert.equal(R.timers.length, 0, 'a mouse press: none');
  R.press('i1/filter.in', 300, 250); R.mv(400, 400);
  assert.deepEqual(R.timers.map(t => t === null), [true], 'the drag began: disarmed');
  R.upAt(800, 800); R.timers.length = 0;
  R.press('i1.main', 500, 350);
  assert.equal(R.timers.length, 0, 'one cord: no "Which cord?"');
  R.upAt(500, 350);
  fire(R.J['i1/filter.in'], 'contextmenu', { clientX: 300, clientY: 250 });
  assert.deepEqual(menuLabels(R.doc)[0], 'Which cord?', 'a right-click');
  R.D.destroy();
});

test('(WC) a tap / Enter on a cord jack: o.jackMenu(jack, el, x, y) first (the host\'s plug menu), else "Connect to…" over the cord jacks (an Envelope for LEVEL) with Pull items; a mod output\'s tap: o.onJackTap; a WARP jack: a target only — its tap the warp cord\'s (onAction tap), no drag from it', () => {
  const asked = [];
  const R = cordRig({ jackMenu: (j, el, x, y) => { asked.push(j + ' ' + x + ',' + y); return j === 'i1.main' ? {} : null; } });
  R.press('i1.main', 500, 350); R.upAt(502, 351);
  assert.deepEqual([asked, menuLabels(R.doc)], [['i1.main 502,351'], []], 'the host\'s menu took it');
  R.press('i1/filter.in', 300, 250); R.upAt(300, 250);
  assert.deepEqual(menuLabels(R.doc), ['Connect Filter 1 in to…', 'Oscillator 1 out', 'Oscillator 2 out', 'Oscillator 3 out', 'Pull Oscillator 1 out', 'Pull Oscillator 2 out'], 'declined: Connect to… with its Pull items');
  const pick = label => { const it = all(R.doc.body).filter(n => n.getAttribute && n.getAttribute('class') === 'wk-cl' && n.textContent === label).at(-1).parentNode; ptr(it, 'pointerdown', 0, 0, { pointerId: 7 }); it.dispatchEvent(new Ev('click', { bubbles: true })); };
  pick('Pull Oscillator 1 out');
  assert.equal(R.log.at(-1), 'pull x:i1:oscA.out>filter.in');
  key(R.J['i1.level'], 'Enter');
  assert.deepEqual(menuLabels(R.doc), ['Connect Amplifier level to…', 'Envelope 1 out'], 'Enter: LEVEL lists the Envelope');
  pick('Envelope 1 out');
  assert.equal(R.log.at(-1), 'connect i1/env1.out i1.level');
  R.press('i1/lfo1.out', 100, 600); R.upAt(100, 600);
  assert.equal(R.log.at(-1), 'jacktap i1/lfo1.out', 'a mod output: the host\'s knob list');
  R.press('i1/oscB.warp', 60, 300); R.mv(200, 400); R.mv(300, 500); R.upAt(300, 500);
  assert.equal(R.log.filter(s => /^(live|grab)/.test(s)).length, 0, 'no drag from a warp jack');
  R.press('i1/oscB.warp', 60, 300); R.upAt(60, 300);
  assert.equal(R.log.at(-1), 'act x:i1:oscA.out>oscB.warp tap', 'its tap: the warp cord\'s (the oscillator\'s menu)');
  R.D.destroy();
});

test('(WC) a mod output\'s cord: onto a knob (markDests glow, the rope\'s tip on its centre, o.onMod), onto a cord input that takes it (an Envelope → LEVEL: o.onConnect), a refused input (o.onRefuse); the rope has the tip (s 2)', () => {
  const R = cordRig();
  R.press('i1/lfo1.out', 100, 600); R.mv(200, 650);
  assert.deepEqual([R.el.getAttribute('data-cv-patching'), R.K.res.getAttribute('class'), R.log.at(-1)], ['mod', 'knob cv-ok', 'live 100,500,200,550,2,2'], 'the knobs glow; a tip in the finger');
  R.mv(455, 595);
  assert.deepEqual([R.K.res.getAttribute('class'), R.log.at(-1), R.chip()], ['knob cv-ok cv-hot', 'live 100,500,460,500,2,2', [false, 'Resonance', false]], 'on the knob: its centre');
  R.upAt(455, 595);
  assert.deepEqual(R.log.slice(-2), ['mod i1/lfo1.out i1:f.res', 'live null']);
  R.press('i1/env1.out', 100, 700); R.mv(300, 500); R.mv(521, 361);
  assert.deepEqual([R.cls('i1.level'), R.log.at(-1)], ['cv-ok cv-hot', 'live 100,600,520,260,2,2'], 'LEVEL takes an Envelope');
  R.upAt(521, 361);
  assert.deepEqual(R.log.slice(-2), ['connect i1/env1.out i1.level', 'live null']);
  R.press('i1/lfo1.out', 100, 600); R.mv(300, 500); R.mv(521, 361);
  assert.deepEqual([R.cls('i1.level'), R.chip()], ['cv-no', [false, 'Amplifier level — An Envelope only', true]], 'an LFO: refused (fixer B2: the host\'s reason for a cord input)');
  R.upAt(521, 361);
  assert.deepEqual(R.log.slice(-2), ['refuse i1/lfo1.out i1.level: An Envelope only', 'live null']);
  R.D.destroy();
});

test('(WC, integration fixer L — review WC-int P3-18, tightened after its checks) a mod cord onto a knob aims at its disc by the kit\'s ONE measure (wk.discBox: the control\'s .wk-svg child inside the control\'s box) — the disc over its label: the disc\'s centre; a disc spilling out of the control: the control\'s centre (the same "no disc" as cv-module\'s knob end and main\'s ring); no disc: the control\'s centre', () => {
  const R = cordRig(), sv = R.doc.createElement('div');
  sv.setAttribute('class', 'wk-svg'); R.K.res.append(sv);
  place(R.K.res, 440, 572, 40, 56); place(sv, 444, 574, 32, 32); // (the control: its disc over a label; client = world + (0, 100))
  R.press('i1/lfo1.out', 100, 600); R.mv(300, 650); R.mv(455, 595);
  assert.deepEqual([R.K.res.getAttribute('class'), R.log.at(-1)], ['knob cv-ok cv-hot', 'live 100,500,460,490,2,2'], 'on the knob: its disc\'s centre (wk.discBox)');
  place(sv, 420, 574, 32, 32); R.mv(300, 650); R.mv(456, 596);
  assert.deepEqual(R.log.at(-1), 'live 100,500,460,500,2,2', 'a disc spilling out of the control: the control\'s centre');
  sv.remove(); R.mv(300, 650); R.mv(455, 595);
  assert.deepEqual(R.log.at(-1), 'live 100,500,460,500,2,2', 'no disc: the control\'s centre');
  R.upAt(455, 595);
  assert.deepEqual(R.log.slice(-2), ['mod i1/lfo1.out i1:f.res', 'live null']);
  assert.ok(/wk\.discBox\(/.test(readFileSync(new URL('../cv-cables.js', import.meta.url), 'utf8')), 'cv-cables measures through wk.discBox');
  R.D.destroy();
});

test('(WC) a claimed mod row\'s BADGE dragged: its knob-end tip in the finger (o.grab), never the canvas\'s pan; onto another accepted knob → o.onRepatchMod(id, dst), onto its own → nothing, away from any knob → o.onPull(id); a tap on it still selects', () => {
  const R = cordRig(), b = R.cables.badge('o:i1:3');
  let pans = 0;
  R.el.addEventListener('pointerdown', () => pans++);
  const drag = (pts, pid) => { R.log.length = 0; ptr(b, 'pointerdown', 356, 600, { pointerId: pid, pointerType: 'touch' }); for (const [x, y] of pts) ptr(R.doc.body, 'pointermove', x, y, { pointerId: pid, pointerType: 'touch' }); const [x, y] = pts.at(-1); ptr(R.doc.body, 'pointerup', x, y, { pointerId: pid, pointerType: 'touch' }); return R.log.filter(s => !/^move/.test(s)); };
  assert.deepEqual(drag([[380, 610], [455, 595]], 5), ['grab o:i1:3 b 380,510', 'remod o:i1:3 i1:f.res', 'drop'], 'onto Resonance: re-targeted');
  assert.equal(pans, 0, 'the press never reached the canvas');
  assert.deepEqual(drag([[380, 610], [395, 595]], 6), ['grab o:i1:3 b 380,510', 'drop'], 'onto its own knob: nothing');
  assert.deepEqual(drag([[380, 610], [900, 900]], 7), ['grab o:i1:3 b 380,510', 'pull o:i1:3', 'drop'], 'away: pulled');
  R.log.length = 0;
  ptr(b, 'pointerdown', 356, 600, { pointerId: 8, pointerType: 'mouse' }); ptr(R.doc.body, 'pointerup', 357, 600, { pointerId: 8, pointerType: 'mouse' });
  assert.deepEqual([R.log, R.cables.selected()], [['select o:i1:3'], 'o:i1:3'], 'a tap: selected');
  R.D.destroy();
  // without the cords mode (no o.live): the badge pans as today
  const N = cordRig({ live: undefined });
  let p2 = 0;
  N.el.addEventListener('pointerdown', () => p2++);
  ptr(N.cables.badge('o:i1:3'), 'pointerdown', 356, 600, { pointerId: 9, pointerType: 'touch' });
  assert.equal(p2, 1, 'no badge drag registered: the canvas\'s press');
  N.D.destroy();
});

// (WC pre-deploy [badge-hold]) a claimed badge held before it was dragged opened its menu (the 500 ms long-press) AND the drag still ran —
// landscape: the cord pulled under the open menu; portrait: re-targeted with the menu left open; a slow drag (the badge's own long-press
// never told of the moves) opened the menu mid-drag. Never both: the menu first ends the gesture (no drag after it, as the jack's "Which
// cord?"); a drag first (past TAP_PX) takes the press and its late long-press opens nothing
test('(WC pre-deploy [badge-hold]) a claimed badge: a long-press opens its menu and the drag never runs after it; a drag that started first is never interrupted by the late long-press; a hold and release opens the menu alone', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const R = cordRig(), b = R.cables.badge('o:i1:3'), T0 = { pointerType: 'touch', isPrimary: true };
  const moves = pid => { for (const [x, y] of [[380, 610], [420, 600], [455, 595]]) ptr(R.doc.body, 'pointermove', x, y, Object.assign({ pointerId: pid }, T0)); };
  const acts = () => R.log.filter(s => /^(grab|remod|pull|drop|select)/.test(s));
  // press, hold (the menu opens at 500 ms), then drag onto Resonance and lift: the menu stays, nothing patched
  R.log.length = 0;
  ptr(b, 'pointerdown', 356, 600, Object.assign({ pointerId: 11 }, T0));
  t.mock.timers.tick(520);
  assert.equal(menuLabels(R.doc)[0], 'Disconnect', 'the long-press opened the badge\'s menu');
  moves(11); ptr(R.doc.body, 'pointerup', 455, 595, Object.assign({ pointerId: 11 }, T0));
  assert.deepEqual([acts(), menuLabels(R.doc)[0]], [['select o:i1:3'], 'Disconnect'], 'no grab, no re-patch, no pull after the menu; the menu stays open');
  wk.closeTransient();
  // press and drag at once (past TAP_PX), the finger still down past 500 ms: the drag runs to its end, no menu
  R.log.length = 0;
  ptr(b, 'pointerdown', 356, 600, Object.assign({ pointerId: 12 }, T0));
  ptr(R.doc.body, 'pointermove', 380, 610, Object.assign({ pointerId: 12 }, T0));
  t.mock.timers.tick(700);
  assert.deepEqual([menuLabels(R.doc), acts()], [[], ['grab o:i1:3 b 380,510']], 'the late long-press opens nothing (and selects nothing)');
  ptr(R.doc.body, 'pointermove', 455, 595, Object.assign({ pointerId: 12 }, T0)); ptr(R.doc.body, 'pointerup', 455, 595, Object.assign({ pointerId: 12 }, T0));
  assert.deepEqual([acts(), menuLabels(R.doc)], [['grab o:i1:3 b 380,510', 'remod o:i1:3 i1:f.res', 'drop'], []], 're-targeted, no menu');
  // a later press of the same badge: its long-press opens the menu again (the drag's mark went with its lift)
  R.cables.select(null); R.log.length = 0;
  ptr(b, 'pointerdown', 356, 600, Object.assign({ pointerId: 13 }, T0));
  t.mock.timers.tick(520);
  ptr(b, 'pointerup', 356, 600, Object.assign({ pointerId: 13 }, T0));
  assert.deepEqual([acts(), menuLabels(R.doc)[0]], [['select o:i1:3'], 'Disconnect'], 'hold and release: the menu alone (no tap, no drag)');
  wk.closeTransient();
  R.D.destroy();
});

test('(WC) the cord hook: o.cordHit installs the world\'s setCordHook — hit(p, r) asks it with a filter of the claimed ids (a patch cord never answers), its tap is the cables\' tap(id, p) (the × at p); with a cord selected a press on its body is no "elsewhere" (the cables ask cordHit at HIT_PX / k)', () => {
  const R = cordRig();
  assert.deepEqual([typeof R.hooks.hit, typeof R.hooks.tap], ['function', 'function']);
  assert.deepEqual([R.hooks.hit({ x: 200, y: 120 }, 12), R.hooks.hit({ x: 200, y: 300 }, 12), R.hooks.hit({ x: 200, y: 600 }, 12)], ['x:i1:oscA.out>filter.in', null, null], 'a claimed one; \'pc1\' (not the cables\') filtered; none');
  R.hooks.tap('x:i1:oscA.out>filter.in', { pointerType: 'touch' }, { x: 200, y: 120 });
  const x = all(R.el).find(n => n.getAttribute && n.getAttribute('class') === 'cv-cable-x');
  assert.deepEqual([R.cables.selected(), x.style.left, x.style.top], ['x:i1:oscA.out>filter.in', '200px', '120px']);
  R.log.length = 0;
  ptr(R.el, 'pointerdown', 200, 220, { pointerId: 3 }); ptr(R.el, 'pointerup', 200, 220, { pointerId: 3 });
  assert.deepEqual([R.cables.selected(), R.log], ['x:i1:oscA.out>filter.in', ['hit 200,120 ' + C.HIT_PX]], 'a press on its body (client y 220 = world 120): kept');
  ptr(R.el, 'pointerdown', 200, 800, { pointerId: 4 }); ptr(R.el, 'pointerup', 200, 800, { pointerId: 4 });
  assert.equal(R.cables.selected(), null, 'elsewhere: cleared');
  R.D.destroy();
  assert.deepEqual([R.hooks.hit, R.hooks.tap], [null, null], 'destroy removes it');
  // without o.live a rig's cord jack is not this drag's (o.cordPress may answer it)
  const N = cordRig({ live: undefined, cordHit: undefined });
  assert.deepEqual([N.press('i1/oscA.out', 100, 200), typeof N.hooks.hit], [false, 'undefined'], 'not taken; no hook');
  key(N.J['i1/filter.in'], 'Enter');
  assert.deepEqual(menuLabels(N.doc), [], 'its keys: none here');
  N.D.destroy();
});

/* ------------------------------------------------------------------ (WC) fixer B2 (review 2; the user, 2026-10-26) */
test('(WC, fixer B2; review 2 P1-2) an Envelope\'s OUT dragged onto the Amplifier\'s LEVEL lands though the host\'s port() answers null for a mod output (the app\'s intPort): a rig cord input is asked through o.canConnect with the jacks themselves — cv-ok, the chip names it, o.onConnect(jack, port); a refused one shows the host\'s reason (an LFO: "An Envelope only"), never "Drag a modulation cable onto a knob"', () => {
  const R = cordRig({ port: j => (j === 'i1/fx.in' || /\/(env|lfo)\d+\.out$/.test(j) ? null : j) });
  R.press('i1/env1.out', 100, 700); R.mv(300, 500); R.mv(521, 361);
  assert.deepEqual([R.cls('i1.level'), R.chip(), R.log.at(-1)], ['cv-ok cv-hot', [false, 'Amplifier level', false], 'live 100,600,520,260,2,2'], 'LEVEL takes the Envelope');
  R.upAt(521, 361);
  assert.deepEqual(R.log.slice(-2), ['connect i1/env1.out i1.level', 'live null'], 'plugged');
  R.press('i1/lfo1.out', 100, 600); R.mv(300, 500); R.mv(521, 361);
  assert.deepEqual([R.cls('i1.level'), R.J['i1.level'].title, R.chip()], ['cv-no', 'An Envelope only', [false, 'Amplifier level — An Envelope only', true]], 'an LFO: the host\'s reason');
  R.upAt(521, 361);
  assert.deepEqual(R.log.slice(-2), ['refuse i1/lfo1.out i1.level: An Envelope only', 'live null']);
  R.D.destroy();
});

test('(WC, fixer B2; review 2 P3-3) an output dropped on another output: the jack under the finger refuses with the host\'s reason in the chip ("Two outputs — connect an output to an input"; never a silent spring-back) and the release says it (o.onRefuse); a grabbed cord let go on an output is refused there, never pulled', () => {
  const two = 'Two outputs — connect an output to an input';
  const R = cordRig({ canConnect: (a, b) => (/\.out$/.test(b) ? { ok: false, why: two } : b === 'i1.main' || b === 'i1/filter.in' ? { ok: true } : { ok: false, why: 'An Envelope only' }) });
  R.press('i1/oscC.out', 100, 400); R.mv(150, 300); R.mv(101, 201);
  assert.deepEqual([R.cls('i1/oscA.out'), R.chip()], ['cv-no', [false, 'Oscillator 1 out — ' + two, true]], 'over Oscillator 1\'s OUT: the reason');
  R.upAt(101, 201);
  assert.deepEqual(R.log.slice(-2), ['refuse i1/oscC.out i1/oscA.out: ' + two, 'live null'], 'released there: said');
  R.log.length = 0;
  R.press('i1/filter.in', 300, 250); R.mv(250, 380); R.mv(101, 401);
  assert.deepEqual(R.chip(), [false, 'Oscillator 3 out — ' + two, true], 'a grabbed cord over an output');
  R.upAt(101, 401);
  assert.deepEqual(R.log.filter(s => !/^(grab|move)/.test(s)), ['refuse i1/oscB.out i1/oscC.out: ' + two, 'drop'], 'refused, not pulled');
  R.D.destroy();
});

test('(WC, fixer B2; review 2 P2-3) o.top: a claimed mod row\'s badge, a claimed cord\'s × and a claimed fork\'s BAL go to the layer above the cords (never under a rope), its --ik the world\'s (copied at each layout / zoom); a line\'s badge and ×, and everything without o.top, stay in the world as today', () => {
  const R = cordLayers({ withTop: true }), P = RIG_P(), T = R.TOP;
  R.W.style.setProperty('--ik', '0.5');
  R.L.layout(P);
  const inT = n => !!n && n.parentNode === T, inW = n => !!n && n.parentNode === R.W;
  assert.deepEqual([inT(R.L.badge('o:i1:3')), inW(R.L.badge('r1'))], [true, true], 'the claimed badge above the cords; a line\'s in the world');
  assert.equal(T.style.getPropertyValue('--ik'), '0.5', 'the world\'s --ik');
  R.L.tap('x:i1:oscA.out>filter.in', { x: 200, y: 120 }, 'mouse');
  assert.deepEqual([inT(R.xb()), R.xb().hidden, R.xb().style.left], [true, false, '200px'], 'a cord\'s ×: above the cords, at the tap');
  R.L.select('x:i1:oscC.out>');
  assert.deepEqual([inW(R.xb()), R.xb().hidden], [true, false], 'a line\'s ×: back in the world');
  R.W.style.setProperty('--ik', '0.25'); R.L.rezoom();
  assert.equal(T.style.getPropertyValue('--ik'), '0.25', 'a zoom: copied again');
  R.L.set(rigRecs().concat([{ id: 'x:i1:oscA.out>filter2.in', kind: 'audio', int: 'audio', dev: 'i1', edge: { a: 'oscA.out', b: 'filter2.in' }, a: 'i1/oscA.out', b: 'i1/filter2.in', fork: true, src: ['i1'] }]));
  assert.equal(inT(R.L.forkBadge('i1/oscA.out')), true, 'a claimed fork\'s BAL above the cords');
  R.L.destroy();
  assert.equal(T.childNodes.length, 0, 'destroy: nothing left above');
  const N = cordLayers();
  N.L.layout(P);
  assert.equal(N.L.badge('o:i1:3').parentNode === N.W, true, 'without o.top: the world');
  N.L.destroy();
});

test('(the user, 2026-10-26: "on a socket with multiple outs lets just put a discreet number of how many outs on the socket") o.onRecords may answer counts: Map jack → {x, y, n, to} — a span.cv-jn per stacked jack in the layer above the cords (its number, aria-hidden, data-to, the world\'s skin), moved / renumbered in place, removed when the answer leaves it out (or says one cord) or gives none; without o.top: none; destroy: none left', () => {
  let N = new Map([['i1/filter.in', { x: 309.9, y: 140.1, n: 2, to: 'r' }], ['i1/lfo1.out', { x: 90.1, y: 490.1, n: 3, to: 'l' }]]);
  const R = cordLayers({ withTop: true, onRecords: () => (N ? { counts: N } : null) }), P = RIG_P(), T = R.TOP;
  R.W.setAttribute('data-cv-skin', 'charcoal');
  R.L.layout(P);
  const seen = () => T.childNodes.filter(n => n.getAttribute && n.getAttribute('class') === 'cv-jn').map(n => [n.getAttribute('data-of'), n.textContent, n.style.left, n.style.top, n.getAttribute('data-to'), n.getAttribute('aria-hidden'), n.getAttribute('data-cv-skin')]);
  assert.deepEqual(seen(), [['i1/filter.in', '2', '309.9px', '140.1px', 'r', 'true', 'charcoal'], ['i1/lfo1.out', '3', '90.1px', '490.1px', 'l', 'true', 'charcoal']], 'one count a stacked jack, above the cords');
  const e = R.L.count('i1/filter.in');
  N = new Map([['i1/filter.in', { x: 320, y: 150, n: 3 }], ['i1.main', { x: 1, y: 2, n: 1 }]]); R.L.layout(P);
  assert.deepEqual(seen(), [['i1/filter.in', '3', '320px', '150px', 'r', 'true', 'charcoal']], 'moved and renumbered; left out, or one cord: gone');
  assert.equal(R.L.count('i1/filter.in') === e, true, 'the same element');
  N = null; R.L.layout(P);
  assert.deepEqual([seen().length, R.L.count('i1/filter.in')], [0, null], 'no answer (lines mode, another canvas): none');
  N = new Map([['i1/filter.in', { x: 1, y: 2, n: 2 }]]); R.L.layout(P);
  assert.equal(seen().length, 1);
  R.L.destroy();
  assert.equal(T.childNodes.length, 0, 'destroy: nothing left above');
  const W = cordLayers({ onRecords: () => ({ counts: new Map([['i1/filter.in', { x: 1, y: 2, n: 2 }]]) }) });
  W.L.layout(P);
  assert.equal(all(W.doc.body).some(n => n.getAttribute && n.getAttribute('class') === 'cv-jn'), false, 'without o.top: none (a count never lies under a rope)');
  W.L.destroy();
});

test('(WC, fixer B2; review 2 P2-4: the regret path) lines mode — a press on a rig input a line arrives at grabs that line\'s end (the most recent: re-patch by drag, parity with cords): its source fixed, the inputs that take it lit, dropped on one → o.onRepatch(id, out, in); let go elsewhere → nothing (a line\'s rule: its × removes it); an input with no line: a new cable backwards as today', () => {
  const R = cordRig({ lines: true, live: undefined, grab: undefined, cordHit: undefined });
  R.press('i1/filter.in', 300, 250); R.mv(340, 300);
  assert.deepEqual(['i1/oscB.out', 'i1/filter.in', 'i1.main', 'i1.level'].map(R.cls), ['cv-from', 'cv-ok', 'cv-ok', 'cv-no'], 'Oscillator 2\'s line (the most recent) lifted: its source fixed');
  assert.equal(all(R.el).find(n => n.localName === 'g' && n.getAttribute('data-cable') === 'x:i1:oscB.out>filter.in').getAttribute('class'), 'cv-cable-g cv-lift', 'the line lifted');
  R.mv(500, 351); R.upAt(500, 351);
  assert.deepEqual(R.log.filter(s => !/^live/.test(s)), ['repatch x:i1:oscB.out>filter.in i1/oscB.out i1.main'], 're-patched to the Amplifier\'s IN');
  R.log.length = 0;
  R.press('i1/filter.in', 300, 250); R.mv(500, 700); R.upAt(800, 800);
  assert.deepEqual(R.log, [], 'let go elsewhere: nothing');
  R.press('i1.level', 520, 360); R.mv(400, 500);
  assert.equal(R.cls('i1.level'), 'cv-from', 'LEVEL (no line): a new cable backwards, as today');
  R.upAt(800, 800);
  R.D.destroy();
});

/* ---- (WC, integration fixer K; the go / no-go review's B5, P2-3, P3-7, P3-9) */
test('(WC, fixer K; review B5 / P2-3) a cords-mode press resolves through o.jackAt(el, p, k) → { el, rec } | null (the host: the nearest jack centre or fanned plug to the press, world px): a press on a fanned plug grabs THAT plug\'s cord, not the most recent; a press the host gives to another jack (at Fit zoom the nearest centre) is that jack\'s — an output\'s new cord; null: the jack pressed, its most recent cord as before', () => {
  const asked = [], H = {};
  const R = cordRig({ jackAt: (el, p, k) => H.f(el, p, k) });
  H.f = (el, p, k) => { asked.push([el.getAttribute('data-cv-jack'), p.x, p.y, k].join(' ')); return p.x < 295 ? { el: R.J['i1/filter.in'], rec: 'x:i1:oscA.out>filter.in' } : p.x > 600 ? { el: R.J['i1/oscC.out'], rec: null } : null; };
  R.press('i1/filter.in', 290, 250); R.mv(320, 300);
  assert.deepEqual([asked, R.log.slice(0, 1)], [['i1/filter.in 290 150 1'], ['grab x:i1:oscA.out>filter.in b 320,200']], 'Oscillator 1\'s plug pressed: its cord grabbed (the most recent is Oscillator 2\'s)');
  R.upAt(800, 800); R.log.length = 0;
  R.press('i1/filter.in', 700, 250); R.mv(720, 300);
  assert.deepEqual([R.cls('i1/oscC.out'), R.log.at(-1)], ['cv-from', 'live 100,300,720,200,2,0'], 'the host gave the press to Oscillator 3\'s OUT: a new cord from there');
  R.upAt(900, 900); R.log.length = 0;
  R.press('i1/filter.in', 300, 250); R.mv(320, 300);
  assert.deepEqual(R.log.slice(0, 1), ['grab x:i1:oscB.out>filter.in b 320,200'], 'null: the jack pressed, its most recent cord');
  R.upAt(800, 800);
  R.D.destroy();
});

test('(WC, fixer K; review P3-7) a long-press on an input holding several cords — and a right-click there — opens what a tap opens: o.jackMenu(jack, el, x, y), the host\'s plug menu ("Which cord?" ▸ each cord: Pull · Re-patch to ▸ · Colour ▸); cv-cables\' own list only without a host menu', () => {
  const asked = [];
  const R = cordRig({ jackMenu: (j, el, x, y) => { asked.push(j + ' ' + x + ',' + y); return {}; } });
  R.press('i1/filter.in', 300, 250);
  assert.equal(R.timers.length, 1, 'armed');
  R.fireT();
  assert.deepEqual([asked, menuLabels(R.doc)], [['i1/filter.in 300,250'], []], 'the host\'s menu, as a tap');
  R.upAt(300, 250);
  fire(R.J['i1/filter.in'], 'contextmenu', { clientX: 310, clientY: 255 });
  assert.equal(asked.at(-1), 'i1/filter.in 310,255', 'a right-click: the same');
  assert.deepEqual(R.log, [], 'nothing written');
  R.D.destroy();
});

test('(WC, fixer K; review P3-9 and its skeptics) the target chip never cuts its words: it wraps (data-wrap; style.css: white-space normal, up to 360 px or the screen less 16, no balance — the box hugs its lines) and stands CHIP_UP px over the finger by its own height (read once per text and overlay width — a wrapped refusal\'s two lines — else estimated): its top never above the overlay\'s 4 px: where there is no room above (near the canvas top) it flips below the finger, CHIP_UP px under it, its bottom inside the overlay too — a mouse\'s below and right of the cursor, a finger\'s or a pen\'s below and LEFT of it, CHIP_CLEAR px clear (round 1: below-right is where a right hand rests), right of it only where the left has no room; kept on screen sideways by its width (left of the finger near the right edge, right of it near the left); the drop outline\'s label: whole lines (cv-world\'s test)', () => {
  const R = cordRig({ canConnect: (a, b) => ({ ok: false, why: 'Envelope 1 already shapes the level — pull it first' }) });
  let ov = { left: 0, top: 0, width: 1024, height: 1366 };
  R.ov.getBoundingClientRect = () => ov;
  const pos = c => { const m = /^translate\((-?[\d.]+)px, (-?[\d.]+)px\)$/.exec(c.style.transform); return m ? [+m[1], +m[2]] : null; };
  R.press('i1/oscC.out', 100, 400); R.mv(200, 300); R.mv(521, 361);
  const c = all(R.ov).find(n => n.getAttribute && n.getAttribute('class') === 'cv-plugchip');
  assert.deepEqual([c.hasAttribute('data-wrap'), c.textContent], [true, 'Amplifier level — Envelope 1 already shapes the level — pull it first']);
  const p0 = pos(c);
  assert.ok(p0 && p0[1] === 361 - 27 - 46, 'unmeasured: two estimated lines (46 px) standing 27 px over the finger: ' + c.style.transform);
  layout(c, 330, 58); // (the browser's box: three lines, say)
  R.mv(500, 350);
  const p1 = pos(c);
  assert.ok(/^Amplifier in — /.test(c.textContent) && p1 && p1[1] === 350 - 27 - 58, 'a new text: its own height read, its bottom 27 px over the finger: ' + c.style.transform);
  R.mv(1000, 361);
  const p2 = pos(c);
  assert.ok(p2 && p2[0] + 330 <= 1024 && p2[0] < 1000, 'near the right edge: to the finger\'s left, on screen (its read width): ' + c.style.transform);
  R.upAt(1000, 361);
  R.D.destroy();
  // every edge of the canvas (the overlay's rect moved round the finger, beside Amplifier LEVEL at client (520, 360)): the chip whole
  // inside it, never over the finger's own row; near the top (no room above: under the top bar) it flips below the finger
  const edge = (r, x, y, measured, pt = 'touch') => {
    const Q = cordRig({ canConnect: (a, b) => ({ ok: false, why: 'Envelope 1 already shapes the level — pull it first' }) });
    ov = r;
    Q.ov.getBoundingClientRect = () => ov;
    const P = { pointerType: pt }, M = pt === 'mouse' ? { pointerType: pt, buttons: 1 } : P;
    Q.press('i1/oscC.out', 100, 400, P); Q.mv(200, 380, M); Q.mv(x - 1, y, M);
    const c2 = all(Q.ov).find(n => n.getAttribute && n.getAttribute('class') === 'cv-plugchip');
    if (measured) layout(c2, 330, 58);
    Q.mv(x, y, M);
    const p = c2 && !c2.hidden ? pos(c2) : null, w = measured ? 330 : null, h = measured ? 58 : 46;
    Q.upAt(x, y, P); Q.D.destroy();
    const fx = x - r.left, fy = y - r.top, whole = !!p && p[0] >= 4 && p[1] >= 4 && (w == null || p[0] + w <= r.width - 4) && p[1] + h <= r.height - 4;
    return { p, fx, fy, whole, txt: c2 ? c2.style.transform : '' };
  };
  const full = { left: 0, top: 0, width: 1024, height: 1366 };
  let e = edge(Object.assign({}, full, { top: 340, height: 1026 }), 521, 361, false);
  assert.ok(e.whole && e.p[0] === e.fx - 44 - 360 && e.p[1] === e.fy + 27, 'a finger near the top (21 px under it), unmeasured (46 px, 360 wide): flipped below the finger, its top 27 px under it, LEFT of it 44 px clear (never under a right hand): ' + e.txt);
  e = edge(Object.assign({}, full, { top: 340, height: 1026 }), 521, 361, false, 'mouse');
  assert.ok(e.whole && e.p[0] === e.fx + 26 && e.p[1] === e.fy + 27, 'a mouse near the top: below the cursor, right of it (clear of the arrow): ' + e.txt);
  e = edge(Object.assign({}, full, { top: 340, height: 1026 }), 521, 361, true, 'pen');
  assert.ok(e.whole && e.p[0] === e.fx - 44 - 330 && e.p[1] === e.fy + 27, 'a pen near the top: as a finger (its hand below and right): ' + e.txt);
  e = edge({ left: 0, top: 349, width: 530, height: 1017 }, 521, 361, true);
  assert.ok(e.whole && e.p[1] === e.fy + 27 && e.p[0] === e.fx - 44 - 330, 'the top-right corner (12 px under the top, 9 from the right): below and left of the finger: ' + e.txt);
  e = edge({ left: 0, top: 349, width: 530, height: 1017 }, 521, 361, true, 'mouse');
  assert.ok(e.whole && e.p[1] === e.fy + 27 && e.p[0] === e.fx - 26 - 330, 'the top-right corner by mouse: below and left of the cursor: ' + e.txt);
  e = edge({ left: 0, top: 0, width: 1024, height: 371 }, 521, 361, true);
  assert.ok(e.whole && e.p[1] === e.fy - 27 - 58 && e.p[0] === e.fx + 26, 'near the bottom (10 px over it): above the finger as ever: ' + e.txt);
  e = edge({ left: 0, top: 0, width: 530, height: 371 }, 521, 361, true);
  assert.ok(e.whole && e.p[1] === e.fy - 27 - 58 && e.p[0] === e.fx - 26 - 330, 'the bottom-right corner: above and left of the finger: ' + e.txt);
  e = edge({ left: 515, top: 0, width: 509, height: 1366 }, 521, 361, true);
  assert.ok(e.whole && e.p[0] === e.fx + 26 && e.p[1] === e.fy - 27 - 58, 'near the left edge (6 px in): right of the finger, above it: ' + e.txt);
  e = edge({ left: 515, top: 349, width: 509, height: 1017 }, 521, 361, true);
  assert.ok(e.whole && e.p[0] === e.fx + 44 && e.p[1] === e.fy + 27, 'the top-left corner (no room on the left): below and right of the finger, 44 px clear: ' + e.txt);
  e = edge({ left: 515, top: 349, width: 509, height: 1017 }, 521, 361, true, 'mouse');
  assert.ok(e.whole && e.p[0] === e.fx + 26 && e.p[1] === e.fy + 27, 'the top-left corner by mouse: below and right of the cursor: ' + e.txt);
  e = edge({ left: 0, top: 0, width: 1024, height: 1366 }, 521, 361, true);
  assert.ok(e.whole && e.p[0] === e.fx + 26 && e.p[1] === e.fy - 27 - 58, 'mid-screen, a finger: above and right of it as ever: ' + e.txt);
  e = edge({ left: 0, top: 320, width: 1024, height: 100 }, 521, 361, true);
  assert.ok(e.whole, 'a canvas too short for either (100 px): whole inside it: ' + e.txt);
  // ((round 2, the skeptic) an overlay narrower than ~816 px — the iPad mini in portrait (744), Split View / Stage Manager (694) — with
  // a finger or a pen mid-top: neither side holds the chip 44 px clear, so it goes as far LEFT as the overlay lets it (never pinned to
  // the right edge, under a resting right hand); a mouse keeps its own rule (right of the cursor where it fits)
  for (const [wd, pt, m] of [[744, 'touch', true], [694, 'touch', true], [744, 'pen', true], [694, 'pen', true], [744, 'touch', false], [694, 'touch', false]]) {
    e = edge({ left: 521 - wd / 2, top: 349, width: wd, height: 1017 }, 521, 361, m, pt);
    assert.ok(e.whole && e.p[1] === e.fy + 27 && e.p[0] === 4, 'a ' + wd + ' px overlay, a ' + pt + (m ? '' : ' (unmeasured, 360 wide)') + ' mid-top (x ' + e.fx + '): below the finger, as far left as it goes (x 4), never pinned right: ' + e.txt);
  }
  e = edge({ left: 521 - 372, top: 349, width: 744, height: 1017 }, 521, 361, true, 'mouse');
  assert.ok(e.whole && e.p[1] === e.fy + 27 && e.p[0] === e.fx + 26, 'a 744 px overlay by mouse mid-top: below and right of the cursor (it fits): ' + e.txt);
  e = edge({ left: 521 - 347, top: 349, width: 694, height: 1017 }, 521, 361, true, 'mouse');
  assert.ok(e.whole && e.p[1] === e.fy + 27 && e.p[0] === 4, 'a 694 px overlay by mouse mid-top: neither side fits, as far left as it goes: ' + e.txt);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const chipRule = css.match(/#overlay \.cv-plugchip\[data-wrap\] \{[^}]*\}/)[0], lab = css.match(/#overlay \.cv-ghost-label \{[^}]*\}/)[0];
  assert.match(chipRule, /white-space: normal;[^}]*max-width: min\(360px, calc\(100vw - 16px\)\)/, 'the wrapping chip');
  assert.doesNotMatch(chipRule, /text-wrap: balance/, 'its box hugs its lines (a balanced wrap left a third of it empty)');
  assert.doesNotMatch(lab, /overflow-wrap: (break-word|anywhere)|word-break: break-all/, 'the drop outline\'s label: at words only, never mid-word');
  assert.match(lab, /overflow: hidden;[^}]*text-overflow: ellipsis;/, 'never past its outline; a word too wide for it ends in …');
  assert.doesNotMatch(lab, /max-height/, 'never a height cut through its letters (round 1: whole lines — cv-world\'s test)');
  // ((round 1) the chip's box read again once the overlay's width changed — Slide Over narrowing the screen between two drags
  const R2 = cordRig({ canConnect: (a, b) => ({ ok: false, why: 'Envelope 1 already shapes the level — pull it first' }) });
  ov = { left: 0, top: 0, width: 1024, height: 1366 };
  R2.ov.getBoundingClientRect = () => ov;
  R2.press('i1/oscC.out', 100, 400); R2.mv(200, 380); R2.mv(520, 361);
  const c3 = all(R2.ov).find(n => n.getAttribute && n.getAttribute('class') === 'cv-plugchip');
  layout(c3, 330, 58); R2.mv(521, 361);
  const q1 = pos(c3);
  R2.upAt(521, 361);
  ov = { left: 0, top: 0, width: 600, height: 1366 };
  layout(c3, 300, 75); // (the browser's box at the narrower screen: three lines)
  R2.press('i1/oscC.out', 100, 400); R2.mv(200, 380); R2.mv(520, 361); R2.mv(521, 361);
  const q2 = pos(c3);
  R2.upAt(521, 361); R2.D.destroy();
  assert.deepEqual([q1 && q1[1], q2 && q2[1]], [361 - 27 - 58, 361 - 27 - 75], 'the same text, a narrower overlay: its height read again (75, not the 58 cached at 1024)');
});
