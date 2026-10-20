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
import { fresh, all, ptr, fire, key, Ev, place } from './wk-dom.mjs';
import { readFileSync } from 'node:fs';

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
  const R = modLayers(), b = R.badge('r1'), seen = [], knob = R.doc.createElement('div'), cap = R.doc.createElement('span');
  knob.setAttribute('data-dest', 'a.pan'); knob.append(cap); R.W.append(knob);
  const other = R.doc.createElement('div'); R.doc.body.append(other);
  R.W.addEventListener('pointerdown', e => seen.push('world ' + (e.target === b ? 'badge' : e.target === cap ? 'cap' : '?')));
  const kn = [];
  knob.addEventListener('pointerdown', e => kn.push(e.pointerId + '@' + e.clientX + ',' + e.clientY + (e.target === cap ? ' cap' : '')));
  R.doc.elementsFromPoint = () => [b.childNodes[0], b, cap, knob, R.W];
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
  const R = modLayers(), b = R.badge('r1'), knob = R.doc.createElement('div'), cap = R.doc.createElement('span'), got = [];
  knob.setAttribute('data-dest', 'a.pan'); knob.append(cap); R.W.append(knob);
  knob.addEventListener('contextmenu', e => { got.push((e.isTrusted ? 'trusted' : 'synthetic') + '@' + e.clientX + ',' + e.clientY + (e.target === cap ? ' cap' : '')); if (e.preventDefault) e.preventDefault(); });
  wk.menuSource(knob, { keys: false }); // (a classic / Serum knob is a menu source of its own)
  const other = R.doc.createElement('div'); R.doc.body.append(other);
  // a right-click: the pointerdown (button 2) is nobody's; the contextmenu lands on the badge and goes to the control beneath
  R.doc.elementsFromPoint = () => [b.childNodes[0], b, cap, knob, R.W];
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
