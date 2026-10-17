import './v8-guard.mjs';
// cv-module.js (stage 1b MODULES lane; docs/canvas/IMPL-1b.md §8.3): isBackground / BG_SEL, fxKey + layOf fallback,
// tidy columns, camGet / camPut LRU (keys: cv-migrate camKey), createModule chrome on tests/wk-dom.mjs (bar 40 px, jacks, fold, setPos,
// view hide vs unmount), top-bar move (world delta = screen / k, 8 px snap, Shift = no snap, two-finger cancel restores),
// createTrackView with a scripted world (bodies, ports, cables, lay callbacks, FX key swap), song.js lay validation (normLay)
// and round-trip. Never pass fake-DOM nodes to assert.*.
// Run alone: node --max-old-space-size=2048 --test tests/cv-module.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../cv-module.js?v=9';
import * as S from '../song.js?v=9';
import * as CM from '../cv-migrate.js?v=9';
import { fresh, all, byCls, one, ptr, fire, key } from './wk-dom.mjs';

/* ---------------------------------------------------------------- helpers */
// a scripted cv-world World: k, a camera, toWorld, items, selection, focus, drag pointer, events
function fakeWorld(k = 1) {
  const L = {};
  const W = {
    k, cam: { tx: 0, ty: 0, k }, el: null, items: new Map(), log: [], pointers: [], selected: null,
    toWorld: (x, y) => ({ x: (x - W.cam.tx) / W.k, y: (y - W.cam.ty) / W.k }),
    add(it) { W.items.set(it.id, it); W.log.push('add ' + it.id); return () => W.remove(it.id); },
    remove(id) { W.items.delete(id); W.log.push('remove ' + id); },
    update(id) { W.log.push('update ' + id); },
    clear() { W.items.clear(); W.log.push('clear'); },
    select(id) { W.selected = id; W.emit('select', { id }); },
    focusItem(id, o) { W.log.push('focus ' + id + ' ' + JSON.stringify(o || {})); },
    dragPointer(p) { W.pointers.push(p ? Math.round(p.x) + ',' + Math.round(p.y) : null); },
    on(t, fn) { (L[t] || (L[t] = [])).push(fn); return () => { L[t] = L[t].filter(f => f !== fn); }; },
    emit(t, d) { for (const f of (L[t] || []).slice()) f(d); },
  };
  return W;
}
const body = log => ({ mount: b => log.push('mount ' + b.getAttribute('class')), unmount: b => log.push('unmount ' + b.getAttribute('class')) });
function mod(o, env) {
  const log = [], moves = [];
  const m = M.createModule(Object.assign({
    id: 'i1', kind: 'inst', title: 'Minimoog', sub: 'Bass 1', x: 16, y: 24, w: 1080, cull: 'hide',
    jacks: [{ id: 'out', side: 'right', kind: 'audio', label: 'Minimoog out' }], body: body(log),
    onMove: (x, y, ph) => moves.push([ph, x, y]),
  }, o), env);
  return { m, log, moves };
}

/* ---------------------------------------------------------------- pure helpers */
test('BG_SEL / isBackground: module chrome and panel backgrounds pan; controls never; outside a module nothing', () => {
  for (const c of ['.cv-body', '.inst', '.plate', '.nameplate', '.secs', '.sec', '.ctls', '.sx-root', '.fxr-root', '.cv-out']) {
    assert.ok(M.BG_SEL.split(',').map(s => s.trim()).includes(c), 'BG_SEL has ' + c);
  }
  for (const bad of ['button', 'input', 'select', '.knob', '.wk-knob', '[data-dest]', '.cv-jack', '.cv-bar', '.cv-ttl', '.cv-title', '.cv-sub', 'canvas,', '.cv-grip']) {
    assert.ok(!M.BG_SEL.split(',').map(s => s.trim()).includes(bad.replace(/,$/, '')), 'BG_SEL leaves out ' + bad);
  }
  // a minimal element: matches() by class against the list, closest('[data-cv-mod]') by a flag
  const el = (cls, inMod) => ({ nodeType: 1, matches: sel => sel.split(',').some(s => s.trim() === '.' + cls), closest: sel => (sel === '[data-cv-mod]' && inMod ? {} : null) });
  assert.equal(M.isBackground(el('secs', true)), true);
  assert.equal(M.isBackground(el('fxr-rack', true)), true);
  // the Serum panel's containers and the TB-303 sequencer's chrome pan (a third of the Serum surface was dead); never its
  // note sliders or buttons
  const more = ['sx-panel', 'sx-pbody', 'sx-krow', 'sx-ptitle', 'sx-tabs', 'sx-colO', 'sx-col', 'sx-rowA', 'sx-row', 'sx-master', 'sx-pages', 'sx-page',
    'steps', 'step', 'seqbar', 'snum', 'seqhint'];
  assert.deepEqual(more.filter(c => !M.isBackground(el(c, true))), [], 'every one a background');
  assert.deepEqual(['snote', 'sled', 'sbtn', 'sx-tab', 'sx-knob'].filter(c => M.isBackground(el(c, true))), [], 'controls stay controls');
  assert.equal(M.isBackground(el('secs', false)), false, 'outside a module');
  assert.equal(M.isBackground(el('wk-knob', true)), false, 'a control');
  assert.equal(M.isBackground(null), false);
  assert.equal(M.isBackground({ nodeType: 3 }), false, 'a text node');
  assert.equal(M.isBackground({ nodeType: 1, matches() { throw new Error('bad selector'); }, closest: () => ({}) }), false);
});

test('fxKey and the stage-1b ids', () => {
  assert.equal(M.fxKey('serum'), 'i1/fx');
  for (const m of ['minimoog', 'tb303', 'dx7', '', undefined]) assert.equal(M.fxKey(m), 'fx1');
  assert.deepEqual({ ...M.ID }, { inst: 'i1', fx: 'fx1', sxFx: 'i1/fx', out: 'out' });
  assert.equal(M.BAR_H, 40);
  assert.deepEqual([M.MIN_W, M.MAX_W, M.W_CLASSIC, M.W_SERUM, M.W_FX, M.W_OUT, M.GAP], [480, 1600, 1080, 1200, 760, 280, 160]);
});

test('tidy: instrument → FX → OUT in one row from (0, 0), GAP apart, tops aligned, columns on the grid', () => {
  assert.deepEqual(M.tidy({ model: 'minimoog' }, {}), { i1: { x: 0, y: 0 }, fx1: { x: 1240, y: 0 }, out: { x: 2160, y: 0 } });
  assert.deepEqual(M.tidy({ model: 'serum' }, null), { i1: { x: 0, y: 0 }, 'i1/fx': { x: 1360, y: 0 }, out: { x: 2280, y: 0 } });
  const t = M.tidy({ model: 'juno60' }, { i1: { w: 1003, h: 500 }, fx1: { w: 700, h: 300 }, out: { w: 280, h: 230 } });
  assert.deepEqual(Object.entries(t).map(([k, v]) => [k, v.x, v.y]), [['i1', 0, 0], ['fx1', 1168, 0], ['out', 2032, 0]]);
  assert.ok(Object.values(t).every(v => v.x % 8 === 0), 'grid columns');
  assert.ok(t.fx1.x >= 1003 + M.GAP && t.out.x >= t.fx1.x + 700 + M.GAP, 'GAP at least');
});

test('layOf: the stored entry (a copy), the other FX key after a model change (place, fold, z; no width), else Tidy', () => {
  const td = M.tidy({ model: 'minimoog' }, {});
  const tr = { model: 'minimoog', lay: { i1: { x: 40, y: 80, w: 900 }, 'i1/fx': { x: 1500, y: -64, w: 999, fold: 1, z: 7 } } };
  const e = M.layOf(tr, 'i1', td);
  assert.deepEqual(e, { x: 40, y: 80, w: 900 });
  e.x = 1; assert.equal(tr.lay.i1.x, 40, 'a copy');
  assert.deepEqual(M.layOf(tr, 'fx1', td), { x: 1500, y: -64, fold: 1, z: 7 }, 'a classic track finds the Serum FX place');
  assert.deepEqual(M.layOf({ model: 'serum', lay: { fx1: { x: 3, y: 4 } } }, 'i1/fx', td), { x: 3, y: 4 }, 'and back');
  assert.deepEqual(M.layOf(tr, 'out', td), { x: 2160, y: 0 }, 'no entry: Tidy');
  assert.deepEqual(M.layOf({ model: 'minimoog' }, 'i1', td), { x: 0, y: 0 });
  assert.deepEqual(M.layOf({ model: 'minimoog', lay: { i1: { x: 'a', y: 2 } } }, 'i1', td), { x: 0, y: 0 }, 'an invalid entry: Tidy');
  assert.deepEqual(M.layOf(null, 'zz', null), { x: 0, y: 0 });
});

test('camGet / camPut: one LRU record under cv-migrate camKey keys, most recent last, at most CAM_MAX, invalid input ignored', () => {
  assert.equal(M.CAM_PREF, 'synth.cam');
  assert.equal(M.CAM_MAX, 200);
  const k1 = CM.camKey('p_aaaaaa', 'trk_1'), k2 = CM.camKey('p_aaaaaa', 'trk_2'), k3 = CM.camKey('p_bbbbbb', 'trk_1');
  let r = M.camPut(null, k1, { tx: 10.123, ty: -5, k: 0.75 });
  assert.deepEqual(r, { v: 1, e: [[k1, 10.12, -5, 0.75]] });
  r = M.camPut(r, k2, { tx: 1, ty: 2, k: 1 });
  const r2 = M.camPut(r, k1, { tx: 3, ty: 4, k: 2 });
  assert.deepEqual(r2.e.map(c => c[0]), [k2, k1], 'recency: a put moves the key to the end');
  assert.deepEqual(r.e.map(c => c[0]), [k1, k2], 'pure: the old record is untouched');
  assert.deepEqual(M.camGet(r2, k1), { tx: 3, ty: 4, k: 2 });
  assert.equal(M.camGet(r2, k3), null, 'another project, same track id');
  for (const bad of [null, 7, 'x', { v: 2, e: [] }, { v: 1, e: 'no' }, { v: 1, e: [[k1, 'a', 0, 1]] }, { v: 1, e: [[k1, 0, 0, 0]] }]) {
    assert.equal(M.camGet(bad, k1), null);
  }
  const mixed = M.camPut({ v: 1, e: [[k2, 1, 1, 1], 'junk', [k3, NaN, 0, 1], [k3, 5, 5, 0.5]] }, k1, { tx: 0, ty: 0, k: 1 });
  assert.deepEqual(mixed.e.map(c => c[0]), [k2, k3, k1], 'invalid entries are dropped');
  assert.deepEqual(M.camPut(r, k1, { tx: NaN, ty: 0, k: 1 }).e.map(c => c[0]), [k2], 'an invalid camera removes the key');
  let big = null;
  for (let i = 0; i < 230; i++) big = M.camPut(big, CM.camKey('p_cccccc', 'trk_' + i), { tx: i, ty: 0, k: 1 });
  assert.equal(big.e.length, 200);
  assert.equal(big.e[0][0], CM.camKey('p_cccccc', 'trk_30'), 'the oldest went');
  assert.equal(M.camGet(big, CM.camKey('p_cccccc', 'trk_229')).tx, 229);
  assert.equal(M.camPut(big, k1, { tx: 0, ty: 0, k: 1 }, 3).e.length, 3, 'max');
  assert.ok(JSON.stringify(big).length < 20000, 'a small record');
});

test('sizeFor: the drop outline of a model (Serum wider)', () => {
  assert.equal(M.sizeFor('serum').w, M.W_SERUM);
  assert.equal(M.sizeFor('minimoog').w, M.W_CLASSIC);
  assert.ok(M.sizeFor('serum').h > M.sizeFor('juno60').h);
});

/* ---------------------------------------------------------------- one module on wk-dom */
test('createModule: chrome, a 40 px bar, jacks on the edges, fold → BAR_H tall, card keeps the body (hide), unmount calls unmount', () => {
  const doc = fresh();
  const { m, log } = mod({}, { doc });
  doc.body.append(m.el);
  assert.equal(m.el.getAttribute('data-cv-mod'), 'i1');
  assert.equal(m.el.getAttribute('data-cv-kind'), 'inst');
  assert.equal(m.el.getAttribute('data-cv-view'), 'body');
  assert.equal(m.bar.hasAttribute('data-cv-bar'), true);
  assert.deepEqual(m.el.childNodes.map(n => n.getAttribute('class')), ['cv-bar', 'cv-body', 'cv-card', 'cv-jack']);
  assert.deepEqual(m.bar.childNodes.map(n => n.getAttribute('class')), ['cv-pow', 'cv-stripe', 'cv-ttl', 'cv-chip', 'cv-cpu', 'cv-btn cv-more', 'cv-btn cv-fold']);
  assert.equal(one(m.bar, 'cv-title').textContent, 'Minimoog');
  assert.equal(one(m.bar, 'cv-sub').textContent, 'Bass 1');
  assert.deepEqual([m.el.style.left, m.el.style.top, m.el.style.width, m.el.style.zIndex], ['16px', '24px', '1080px', '1']);
  assert.deepEqual(log, ['mount cv-body'], 'the body is mounted at once (default view: body)');
  const jack = one(m.el, 'cv-jack');
  assert.deepEqual([jack.getAttribute('data-cv-jack'), jack.getAttribute('data-side'), jack.getAttribute('aria-label')], ['i1.out', 'right', 'Minimoog out']);
  assert.deepEqual(m.port('out'), { x: 1080, y: M.BAR_H + M.JACK_Y });
  assert.equal(jack.style.top, (M.BAR_H + M.JACK_Y) + 'px', 'the dot sits at the port offset');
  m.setFold(true);
  assert.equal(m.rect().h, M.BAR_H);
  assert.deepEqual(m.port('out'), { x: 1080, y: M.BAR_H / 2 }, 'folded: jacks on the bar');
  assert.equal(m.el.hasAttribute('data-cv-fold'), true);
  assert.equal(one(m.bar, 'cv-fold').getAttribute('aria-expanded'), 'false');
  m.setFold(false);
  assert.equal(m.el.hasAttribute('data-cv-fold'), false);
  m.setW(5000); assert.equal(m.w, 5000, 'not resizable: any width');
  // card with cull 'hide': the body node and what it holds stay
  const inner = doc.createElement('div'); m.body.append(inner);
  m.view('card', 'zoom');
  assert.equal(m.el.getAttribute('data-cv-view'), 'card');
  assert.equal(m.el.getAttribute('data-cv-why'), 'zoom');
  assert.equal(inner.parentNode === m.body && m.body.parentNode === m.el, true, 'hide: the body and its content stay');
  assert.deepEqual(log, ['mount cv-body'], 'hide: no unmount');
  m.view('body');
  assert.equal(m.el.getAttribute('data-cv-view'), 'body');
  m.destroy();
  assert.deepEqual(log, ['mount cv-body', 'unmount cv-body']);
  assert.equal(m.el.parentNode === null, true);
  // cull 'unmount': card unmounts, body mounts again
  const u = mod({ id: 'out', kind: 'out', cull: 'unmount', jacks: [{ id: 'in', side: 'left' }], art: () => '<svg/>' }, { doc });
  u.m.view('card');
  u.m.view('body');
  assert.deepEqual(u.log, ['mount cv-body', 'unmount cv-body', 'mount cv-body']);
  assert.deepEqual(u.m.port('in'), { x: 0, y: M.BAR_H + M.JACK_Y });
});

test('createModule: setPos live is a transform (no layout), commit moves left / top; setZ, setTitle, setChip', () => {
  const doc = fresh();
  const { m } = mod({ resizable: { min: 480, max: 1600 } }, { doc });
  m.setPos(116, 74, true);
  assert.equal(m.el.style.transform, 'translate3d(100px, 50px, 0)');
  assert.equal(m.el.style.willChange, 'transform');
  assert.deepEqual([m.el.style.left, m.el.style.top], ['16px', '24px'], 'live: left / top untouched');
  assert.deepEqual(m.rect(), { x: 116, y: 74, w: 1080, h: m.rect().h }, 'the rect follows the live position');
  m.setPos(120, 80);
  assert.deepEqual([m.el.style.left, m.el.style.top, m.el.style.transform, m.el.style.willChange], ['120px', '80px', '', '']);
  m.setZ(12); assert.equal(m.el.style.zIndex, '12');
  m.setW(100); assert.equal(m.w, 480, 'resizable: clamped');
  m.setW(9000); assert.equal(m.w, 1600);
  m.setTitle('Juno-60', '');
  assert.equal(one(m.bar, 'cv-title').textContent, 'Juno-60');
  assert.equal(one(m.bar, 'cv-sub').hidden, true);
  assert.equal(m.el.getAttribute('aria-label'), 'Juno-60 module');
  const sel = doc.createElement('select');
  m.setChip(sel);
  const chip = one(m.bar, 'cv-chip');
  assert.equal(sel.parentNode === chip, true);
  m.setChip(sel); // the same element stays (an open picker keeps its focus)
  assert.equal(chip.childNodes.length, 1);
  m.setChip('Init');
  assert.equal(chip.textContent, 'Init');
  m.setChip(null);
  assert.equal(chip.hidden, true);
  assert.equal(one(m.el, 'cv-grip').getAttribute('aria-label'), 'Module width');
});

test('top-bar move: world delta = screen delta / k, 8 px snap, one start / end pair, edge-pan pointer, re-projection on camera frames', () => {
  const doc = fresh(), W = fakeWorld(2);
  const { m, moves } = mod({ x: 16, y: 24 }, { doc, world: W });
  doc.body.append(m.el);
  ptr(m.bar, 'pointerdown', 500, 300, { pointerId: 1, pointerType: 'mouse' });
  ptr(m.bar, 'pointermove', 502, 301, { pointerId: 1, pointerType: 'mouse' });
  assert.equal(moves.length, 0, 'inside the 4 px slop: no move yet');
  ptr(m.bar, 'pointermove', 541, 311, { pointerId: 1, pointerType: 'mouse' }); // +41, +11 screen = +20.5, +5.5 world → snapped
  assert.deepEqual(moves[0], ['start', 16, 24], 'start at the first real move');
  assert.deepEqual(moves[1], ['move', 40, 32], '(16 + 20.5, 24 + 5.5) snapped to 8');
  assert.equal(W.selected, 'i1', 'a moved module is selected');
  assert.equal(m.el.style.transform, 'translate3d(24px, 8px, 0)');
  assert.deepEqual(W.pointers.at(-1), '541,311');
  // the camera pans under a still pointer (edge pan): the module stays under the finger in screen terms
  W.cam.tx -= 80; W.emit('camera', W.cam);
  assert.deepEqual(moves.at(-1), ['move', 80, 32], 'world under the pointer moved by 80 / 2');
  ptr(m.bar, 'pointerup', 541, 311, { pointerId: 1, pointerType: 'mouse' });
  assert.deepEqual(moves.at(-1), ['end', 80, 32]);
  assert.equal(moves.filter(x => x[0] === 'start').length, 1);
  assert.equal(moves.filter(x => x[0] === 'end').length, 1);
  assert.deepEqual([m.el.style.left, m.el.style.top, m.el.style.transform], ['80px', '32px', '']);
  assert.equal(W.pointers.at(-1), null, 'the drag pointer cleared');
  W.emit('camera', W.cam);
  assert.equal(moves.at(-1)[0], 'end', 'no re-projection after the drop');
});

test('top-bar move: Shift = no snap; a two-finger pointercancel restores the start; Escape cancels', () => {
  const doc = fresh(), W = fakeWorld(1);
  const { m, moves } = mod({ x: 0, y: 0 }, { doc, world: W });
  doc.body.append(m.el);
  ptr(m.bar, 'pointerdown', 100, 100, { pointerId: 3, pointerType: 'mouse', shiftKey: true });
  ptr(m.bar, 'pointermove', 113, 105, { pointerId: 3, pointerType: 'mouse', shiftKey: true });
  assert.deepEqual(moves.at(-1), ['move', 13, 5], 'free with Shift');
  ptr(m.bar, 'pointermove', 140, 150, { pointerId: 3, pointerType: 'mouse', shiftKey: true });
  fire(m.bar, 'pointercancel', { pointerId: 3, gesture: 'two-finger' });
  assert.deepEqual(moves.at(-1), ['cancel', 0, 0], 'rolled back');
  assert.deepEqual([m.el.style.left, m.el.style.top, m.el.style.transform], ['0px', '0px', '']);
  assert.equal(moves.filter(x => x[0] === 'end').length, 0);
  // touch: a drag starts on the first 6 px in any direction (touch-action: none bar); Escape cancels it
  moves.length = 0;
  ptr(m.bar, 'pointerdown', 10, 10, { pointerId: 4, pointerType: 'touch', isPrimary: true });
  ptr(m.bar, 'pointermove', 10, 30, { pointerId: 4, pointerType: 'touch', isPrimary: true });
  assert.deepEqual(moves.map(x => x[0]), ['start', 'move']);
  assert.deepEqual(moves.at(-1), ['move', 0, 24], '+20 snapped');
  key(doc, 'Escape');
  assert.deepEqual(moves.at(-1), ['cancel', 0, 0]);
});

test('top bar: tap selects, a second tap focuses (double-tap), the controls never move or select; ⋯ / right-click open the menu; ▾ folds', () => {
  const doc = fresh(), W = fakeWorld(1), picked = [];
  let folds = [], presses = 0;
  const { m, moves } = mod({ menu: () => [{ label: 'About', action: () => picked.push('about') }, { label: 'Fold', action: () => picked.push('fold') }],
    onSelect: () => picked.push('select'), onDouble: () => picked.push('double'), onFold: f => folds.push(f), onPress: () => presses++ }, { doc, world: W });
  doc.body.append(m.el);
  fire(m.bar, 'click', { clientX: 50, clientY: 20, timeStamp: 1000 });
  fire(m.bar, 'click', { clientX: 52, clientY: 21, timeStamp: 1200 });
  fire(m.bar, 'click', { clientX: 52, clientY: 21, timeStamp: 2000 });
  assert.deepEqual(picked, ['select', 'double', 'select']);
  picked.length = 0;
  ptr(m.bar, 'pointerdown', 50, 20, { pointerId: 5, pointerType: 'mouse' });
  assert.equal(presses, 1, 'a press on the bar (bring to front)');
  ptr(m.bar, 'pointerup', 50, 20, { pointerId: 5, pointerType: 'mouse' });
  const more = one(m.bar, 'cv-more'), fold = one(m.bar, 'cv-fold');
  ptr(more, 'pointerdown', 900, 20, { pointerId: 6, pointerType: 'mouse' });
  ptr(more, 'pointermove', 960, 80, { pointerId: 6, pointerType: 'mouse' });
  assert.equal(moves.length, 0, 'a press on ⋯ never moves the module');
  assert.equal(presses, 1);
  ptr(more, 'pointerup', 960, 80, { pointerId: 6, pointerType: 'mouse' });
  more.click();
  assert.deepEqual(picked, [], 'the ⋯ click is not a tap on the bar');
  const labels = () => byCls(byCls(doc.body, 'wk-ctx').at(-1), 'wk-cl').map(n => n.textContent);
  assert.deepEqual(labels(), ['About', 'Fold']);
  fire(m.bar, 'contextmenu', { clientX: 300, clientY: 20 });
  assert.deepEqual(labels(), ['About', 'Fold'], 'right-click / long-press: the same menu');
  fold.click();
  assert.deepEqual(folds, [true]);
  assert.equal(m.fold, true);
  fold.click();
  assert.deepEqual(folds, [true, false]);
  assert.deepEqual(picked, [], 'fold is not a tap');
});

test('width grip: world delta / k, grid snap, start / end pair; cancel restores', () => {
  const doc = fresh(), W = fakeWorld(0.5), rs = [];
  const { m } = mod({ resizable: { min: 480, max: 1600 }, onResize: (w, ph) => rs.push([ph, w]) }, { doc, world: W });
  const g = one(m.el, 'cv-grip');
  ptr(g, 'pointerdown', 600, 300, { pointerId: 7, pointerType: 'mouse' });
  ptr(g, 'pointermove', 651, 300, { pointerId: 7, pointerType: 'mouse' }); // +51 screen = +102 world → 1182 → 1184
  assert.deepEqual(rs, [['start', 1080], ['move', 1184]]);
  ptr(g, 'pointerup', 651, 300, { pointerId: 7, pointerType: 'mouse' });
  assert.deepEqual(rs.at(-1), ['end', 1184]);
  assert.equal(m.el.style.width, '1184px');
  ptr(g, 'pointerdown', 600, 300, { pointerId: 8, pointerType: 'mouse' });
  ptr(g, 'pointermove', 100, 300, { pointerId: 8, pointerType: 'mouse' });
  assert.equal(m.w, 480, 'clamped to min');
  fire(g, 'pointercancel', { pointerId: 8, gesture: 'two-finger' });
  assert.deepEqual(rs.at(-1), ['cancel', 1184]);
  assert.equal(m.w, 1184);
});

/* ---------------------------------------------------------------- the track view */
function view(track, W, doc) {
  const root = doc.createElement('div'), calls = [], bodies = [];
  doc.body.append(root);
  const host = {
    root, doc,
    bodies: { inst: body(bodies), fx: body(bodies), out: body(bodies) },
    title: kind => (kind === 'inst' ? { title: 'Minimoog', sub: track.name, chip: 'Lead' } : kind === 'fx' ? { title: 'FX Panel', sub: 'empty' } : { title: 'OUT', sub: 'master output' }),
    menu: kind => [{ label: kind }],
    lay: (k, e, ph, what) => {
      calls.push([k, ph, what, e && JSON.stringify(e)]);
      if (ph === 'end') { track.lay = track.lay || {}; track.lay[k] = e; }
    },
    shown: k => calls.push([k, 'shown']),
  };
  const V = M.createTrackView(W, track, host);
  return { V, root, calls, bodies, host };
}

test('createTrackView: three modules from Tidy, added to the world, bodies mounted, cables laid from the ports', () => {
  const doc = fresh(), W = fakeWorld(1), tr = { id: 'trk_1', model: 'minimoog', name: 'Bass 1', color: '#3b82c4' };
  const { V, root, bodies } = view(tr, W, doc);
  assert.deepEqual([...V.modules.keys()], ['i1', 'fx1', 'out']);
  assert.deepEqual(W.log.filter(x => x.startsWith('add')), ['add i1', 'add fx1', 'add out']);
  assert.deepEqual(bodies, ['mount cv-body', 'mount cv-body', 'mount cv-body']);
  assert.deepEqual([...V.modules.values()].map(m => [m.x, m.y, m.w]), [[0, 0, 1080], [1240, 0, 760], [2160, 0, 280]]);
  assert.deepEqual(root.childNodes.map(n => n.getAttribute('class') + ':' + (n.getAttribute('data-cv-mod') || '')),
    ['cv-cables:', 'cv-cable-ends:', 'cv-mod:i1', 'cv-mod:fx1', 'cv-mod:out']);
  const P = V.ports();
  assert.deepEqual([...P.entries()].map(([k, p]) => k + '@' + p.x + ',' + p.y), ['i1.out@1080,68', 'fx1.in@1240,68', 'fx1.out@2000,68', 'out.in@2160,68']);
  const d = all(root).filter(n => n.getAttribute && n.getAttribute('class') === 'cv-cable').map(n => n.getAttribute('d'));
  assert.equal(d.length, 2);
  assert.ok(d[0].startsWith('M 1080 68 C'), 'instrument out → FX in');
  assert.ok(d[1].endsWith('2160 68'), 'FX out → OUT in');
  assert.equal(V.live('i1'), true);
  assert.equal(V.live('nope'), false);
  // selection raises the touching cables
  W.select('out');
  assert.deepEqual(all(root).filter(n => n.getAttribute && /cv-cable-g/.test(n.getAttribute('class') || '')).map(n => n.getAttribute('class')),
    ['cv-cable-g cv-dim', 'cv-cable-g cv-hl']);
  V.destroy();
  assert.deepEqual(W.log.filter(x => x.startsWith('remove')), ['remove i1', 'remove fx1', 'remove out']);
  assert.equal(bodies.filter(x => x.startsWith('unmount')).length, 3, 'the parts go back');
  assert.equal(root.childNodes.length, 0);
});

test('createTrackView: a move = one start / end pair through host.lay; fold and width too; bring-to-front writes z without a start', () => {
  const doc = fresh(), W = fakeWorld(1), tr = { id: 'trk_1', model: 'minimoog', name: 'Bass 1', color: '#3b82c4' };
  const { V, calls } = view(tr, W, doc);
  const fx = V.modules.get('fx1');
  ptr(fx.bar, 'pointerdown', 1300, 20, { pointerId: 1, pointerType: 'mouse' });
  const zcalls = calls.filter(c => c[1] === 'end' && c[2] === 'z');
  assert.equal(zcalls.length, 1, 'a press brings it to front (tie at z 1)');
  assert.deepEqual(JSON.parse(zcalls[0][3]), { x: 1240, y: 0, z: 2 });
  ptr(fx.bar, 'pointermove', 1340, 100, { pointerId: 1, pointerType: 'mouse' });
  ptr(fx.bar, 'pointermove', 1380, 180, { pointerId: 1, pointerType: 'mouse' });
  ptr(fx.bar, 'pointerup', 1380, 180, { pointerId: 1, pointerType: 'mouse' });
  const mv = calls.filter(c => c[2] === 'move');
  assert.deepEqual(mv.map(c => c[1]), ['start', 'end']);
  assert.deepEqual(JSON.parse(mv[1][3]), { x: 1320, y: 160, z: 2 });
  assert.deepEqual(tr.lay.fx1, { x: 1320, y: 160, z: 2 });
  assert.equal(V.ports().get('fx1.in').y, 160 + 68, 'the cables follow');
  ptr(fx.bar, 'pointerdown', 1400, 180, { pointerId: 2, pointerType: 'mouse' });
  assert.equal(calls.filter(c => c[2] === 'z').length, 1, 'already in front: no write');
  ptr(fx.bar, 'pointerup', 1400, 180, { pointerId: 2, pointerType: 'mouse' });
  // the canvas arrow keys (world.key → item.nudge): one step each
  calls.length = 0;
  fx.nudge(-8, 32);
  assert.deepEqual(calls.filter(c => c[2] === 'move').map(c => c[1]), ['start', 'end']);
  assert.deepEqual(tr.lay.fx1, { x: 1312, y: 192, z: 2 });
  // fold from the menu path: one step
  calls.length = 0;
  V.toggleFold('out');
  assert.deepEqual(calls.filter(c => c[2] === 'fold').map(c => c[1]), ['start', 'end']);
  assert.deepEqual(JSON.parse(calls.find(c => c[1] === 'end')[3]), { x: 2160, y: 0, fold: 1 });
  assert.ok(calls.some(c => c[0] === 'out' && c[1] === 'shown'), 'monitors hear about it');
  assert.equal(V.live('out'), false, 'folded: not live');
  // width: grip resize then Reset width
  calls.length = 0;
  const i1 = V.modules.get('i1'), g = one(i1.el, 'cv-grip');
  ptr(g, 'pointerdown', 1080, 300, { pointerId: 3, pointerType: 'mouse' });
  ptr(g, 'pointermove', 1180, 300, { pointerId: 3, pointerType: 'mouse' });
  ptr(g, 'pointerup', 1180, 300, { pointerId: 3, pointerType: 'mouse' });
  assert.deepEqual(calls.filter(c => c[2] === 'resize').map(c => c[1]), ['start', 'end']);
  assert.equal(tr.lay.i1.w, 1184);
  assert.equal(V.ports().get('i1.out').x, 1184);
  V.resetWidth('i1');
  assert.equal(tr.lay.i1.w, undefined, 'reset: no stored width (the model default follows the model)');
  assert.equal(i1.w, 1080);
  V.destroy();
});

test('createTrackView.sync: lay changes (undo) move modules without remounting; a model change swaps the FX key in place', () => {
  const doc = fresh(), W = fakeWorld(1), tr = { id: 'trk_1', model: 'minimoog', name: 'Bass 1', color: '#3b82c4', lay: { fx1: { x: 1400, y: 200, fold: 1 } } };
  const { V, bodies } = view(tr, W, doc);
  assert.deepEqual([V.modules.get('fx1').x, V.modules.get('fx1').y, V.modules.get('fx1').fold], [1400, 200, true]);
  bodies.length = 0;
  const undone = JSON.parse(JSON.stringify(tr)); delete undone.lay; // (History brings a new object)
  V.sync(undone);
  assert.deepEqual([V.modules.get('fx1').x, V.modules.get('fx1').y, V.modules.get('fx1').fold], [1240, 0, false], 'back to Tidy');
  assert.deepEqual(bodies, [], 'no body remounted');
  const sx = Object.assign(JSON.parse(JSON.stringify(tr)), { model: 'serum' });
  W.select('i1');
  V.sync(sx);
  assert.deepEqual(all(doc.body).filter(n => n.getAttribute && /cv-cable-g/.test(n.getAttribute('class') || '')).map(n => n.getAttribute('data-cable') + ' ' + n.getAttribute('class')),
    ['i1.out>i1/fx.in cv-cable-g cv-hl', 'i1/fx.out>out.in cv-cable-g cv-dim'], 'the re-derived cables keep the selection\'s highlight');
  assert.deepEqual([...V.modules.keys()], ['i1', 'out', 'i1/fx']);
  assert.deepEqual([V.modules.get('i1/fx').x, V.modules.get('i1/fx').y], [1400, 200], 'the Serum FX takes the panel\'s place');
  assert.deepEqual(bodies, ['unmount cv-body', 'mount cv-body'], 'the FX body moved to the new module');
  assert.equal(V.modules.get('i1').w, M.W_SERUM, 'the Serum default width');
  assert.ok(V.ports().has('i1/fx.in'));
  assert.ok(W.log.includes('remove fx1') && W.log.includes('add i1/fx'));
  V.destroy();
});

// a host like main.js cvLay: 'end' writes into the track the view shows now (History brings new objects: sync(t) moves
// `cur`), and one FX entry at most (the other FX key goes)
function view2(track, doc) {
  const root = doc.createElement('div'), calls = [], ref = { t: track };
  doc.body.append(root);
  const other = k => (k === M.ID.fx ? M.ID.sxFx : k === M.ID.sxFx ? M.ID.fx : null);
  const host = {
    root, doc,
    title: kind => ({ title: kind }),
    lay: (k, e, ph, what) => {
      calls.push([k, ph, what]);
      if (ph !== 'end' || !e) return;
      const t = ref.t;
      t.lay = t.lay || {}; t.lay[k] = e;
      if (other(k)) delete t.lay[other(k)];
    },
    shown: k => calls.push([k == null ? '-' : k, 'shown']),
  };
  const V = M.createTrackView(fakeWorld(1), track, host);
  return { V, calls, ref, sync: t => { ref.t = t; V.sync(t); } };
}
const clone = x => JSON.parse(JSON.stringify(x));
const xs = V => [...V.modules.entries()].map(([k, m]) => k + ':' + m.x + ',' + m.y + '+' + m.w).join(' ');
const grip = (V, from, to, id) => {
  const g = one(V.modules.get('i1').el, 'cv-grip');
  ptr(g, 'pointerdown', from, 300, { pointerId: id, pointerType: 'mouse' });
  ptr(g, 'pointermove', to, 300, { pointerId: id, pointerType: 'mouse' });
  ptr(g, 'pointerup', to, 300, { pointerId: id, pointerType: 'mouse' });
  return V.modules.get('i1').w;
};

test('createTrackView lay: the first write pins the modules Tidy still places — a resize, a sync, a reload or a Reset width never moves the others; an untouched track keeps no lay; a model change on an untouched track places FX / OUT from the new width once', () => {
  const doc = fresh(), tr = { id: 'trk_1', model: 'minimoog', name: 'Bass 1', color: '#3b82c4' };
  const R = view2(tr, doc);
  const tidyRow = 'i1:0,0+1080 fx1:1240,0+760 out:2160,0+280';
  assert.equal(xs(R.V), tidyRow);
  assert.equal('lay' in tr, false, 'untouched: no lay key');
  assert.equal(grip(R.V, 1080, 1400, 3), 1400);
  assert.equal(xs(R.V), 'i1:0,0+1400 fx1:1240,0+760 out:2160,0+280', 'the others stay where they stand');
  assert.deepEqual(Object.keys(tr.lay).sort(), ['fx1', 'i1', 'out'], 'pinned with the resize');
  assert.deepEqual(R.calls.filter(c => c[2] === 'pin').map(c => c[0] + ' ' + c[1]), ['fx1 end', 'out end'], 'after the resize\'s own end (one undo step)');
  R.sync(clone(R.ref.t));
  assert.equal(xs(R.V), 'i1:0,0+1400 fx1:1240,0+760 out:2160,0+280', 'a sync (an undo / redo restore) moves nothing');
  R.V.destroy();
  const R2 = view2(clone(R.ref.t), doc); // a reload
  assert.equal(xs(R2.V), 'i1:0,0+1400 fx1:1240,0+760 out:2160,0+280', 'a reload neither');
  R2.V.resetWidth('i1');
  R2.V.destroy();
  const R3 = view2(clone(R2.ref.t), doc);
  assert.equal(xs(R3.V), tidyRow, 'Reset width + reload: OUT where it was, never on a moved FX');
  R3.V.destroy();
  // an untouched track switched to Serum: FX / OUT from the Serum width at once, and they stay on the next sync
  const t2 = { id: 'trk_2', model: 'minimoog', name: 'Lead', color: '#c43b3b' }, R4 = view2(t2, doc);
  const sx = Object.assign(clone(t2), { model: 'serum' });
  R4.sync(sx);
  const a = xs(R4.V);
  R4.sync(clone(sx));
  assert.deepEqual([a, xs(R4.V)], ['i1:0,0+1200 out:2280,0+280 i1/fx:1360,0+760', 'i1:0,0+1200 out:2280,0+280 i1/fx:1360,0+760']);
  assert.equal('lay' in R4.ref.t, false, 'still no lay');
  R4.V.destroy();
});

test('createTrackView.sync: a fold that a restore (undo / redo) changes tells host.shown once (main.js monitors.sync: the Serum / FX live displays follow); no fold change, no call', () => {
  const doc = fresh(), tr = { id: 'trk_1', model: 'serum', name: 'Pad', color: '#3b82c4' };
  const R = view2(tr, doc);
  const before = clone(tr);
  R.V.toggleFold('i1');
  const folded = clone(R.ref.t);
  R.calls.length = 0;
  R.sync(clone(before)); // undo
  assert.deepEqual([R.calls.filter(c => c[1] === 'shown').length, R.V.live('i1')], [1, true], 'undo: unfolded, monitors told');
  R.sync(clone(folded)); // redo
  assert.deepEqual([R.calls.filter(c => c[1] === 'shown').length, R.V.live('i1')], [2, false], 'redo: folded, monitors told');
  R.sync(clone(folded));
  assert.equal(R.calls.filter(c => c[1] === 'shown').length, 2, 'nothing changed: no call');
  R.V.destroy();
});

test('createTrackView.sync: the grip\'s width range follows a classic ↔ Serum model change (setRange)', () => {
  const doc = fresh(), tr = { id: 'trk_1', model: 'minimoog', name: 'Bass 1', color: '#3b82c4' };
  const R = view2(tr, doc);
  R.sync(Object.assign(clone(tr), { model: 'serum' }));
  assert.equal(R.V.modules.get('i1').w, M.W_SERUM);
  assert.equal(grip(R.V, 1200, 100, 4), M.MIN_W_SERUM, 'a Serum stops at its narrowest layout');
  assert.equal(R.ref.t.lay.i1.w, M.MIN_W_SERUM, 'and that is what is stored');
  R.sync(Object.assign(clone(R.ref.t), { model: 'minimoog' }));
  assert.equal(grip(R.V, 800, 100, 5), M.MIN_W, 'back to a classic: down to MIN_W');
  R.sync(Object.assign(clone(R.ref.t), { model: 'serum' }));
  assert.equal(R.V.modules.get('i1').w, M.MIN_W_SERUM, 'a stored classic width below the Serum range is clamped');
  R.V.destroy();
});

test('createTrackView.sync: the FX module keeps its place across classic → Serum → classic (the host keeps one FX entry; layOf\'s fallback carries it)', () => {
  const doc = fresh(), tr = { id: 'trk_1', model: 'minimoog', name: 'Bass 1', color: '#3b82c4', lay: { fx1: { x: 1560, y: 0 } } };
  const R = view2(tr, doc);
  R.sync(Object.assign(clone(tr), { model: 'serum' }));
  const f = R.V.modules.get('i1/fx');
  assert.deepEqual([f.x, f.y], [1560, 0], 'the Serum FX takes the panel\'s place');
  f.nudge(-296, 200);
  assert.deepEqual([f.x, f.y, 'fx1' in R.ref.t.lay], [1264, 200, false], 'moved; the stale classic entry is gone');
  R.sync(Object.assign(clone(R.ref.t), { model: 'minimoog' }));
  const g = R.V.modules.get('fx1');
  assert.deepEqual([g.x, g.y], [1264, 200], 'back to a classic: where the user last put it');
  R.V.destroy();
});

/* ---------------------------------------------------------------- song.js lay */
test('song.normLay: valid entries kept (rounded, clamped), invalid ones dropped, empty → undefined', () => {
  assert.equal(S.normLay(undefined), undefined);
  assert.equal(S.normLay([]), undefined);
  assert.equal(S.normLay({}), undefined);
  assert.deepEqual(S.normLay({ i1: { x: 10.4, y: -3.6, w: 900.2, fold: true, z: 3.2 }, 'i1/fx': { x: 1, y: 2 } }),
    { i1: { x: 10, y: -4, w: 900, fold: 1, z: 3 }, 'i1/fx': { x: 1, y: 2 } });
  assert.deepEqual(S.normLay({ out: { x: 5e9, y: -5e9, w: 9, z: 0, fold: 0 } }), { out: { x: 1e6, y: -1e6, w: 120, z: 1 } });
  assert.deepEqual(S.normLay({ out: { x: 1, y: 2, w: 1e9, z: 1e9 } }), { out: { x: 1, y: 2, w: 4000, z: 1e6 } });
  const bad = { I1: { x: 1, y: 1 }, '1a': { x: 1, y: 1 }, 'a/b/c': { x: 1, y: 1 }, abcdefghijklmnopq: { x: 1, y: 1 }, a: { x: '1', y: 1 },
    b: { x: NaN, y: 1 }, c: null, d: [1, 2], e: { x: 1 }, ok: { x: 0, y: 0, w: 'wide' } };
  assert.deepEqual(S.normLay(bad), { ok: { x: 0, y: 0 } });
  assert.equal(S.normLay(JSON.parse('{"__proto__": {"x": 1, "y": 1}}')), undefined);
  const many = {};
  for (let i = 0; i < 80; i++) many['m' + i] = { x: i, y: 0 };
  assert.equal(Object.keys(S.normLay(many)).length, 64);
});

test('song.deserialize: lay round-trips; no lay on an old track (no new key); serialize carries it', () => {
  const p = S.newProject({ model: 'minimoog' });
  const t2 = S.newTrack(p, { model: 'juno60' }); p.tracks.push(t2);
  p.tracks[0].lay = { i1: { x: 40, y: 80, w: 960 }, fx1: { x: 1200, y: 80, fold: 1, z: 2 }, junk: 'no' };
  const q = S.deserialize(S.serialize(p));
  assert.deepEqual(q.tracks[0].lay, { i1: { x: 40, y: 80, w: 960 }, fx1: { x: 1200, y: 80, fold: 1, z: 2 } });
  assert.equal('lay' in q.tracks[1], false, 'an untouched track gets no key');
  assert.deepEqual(Object.keys(q.tracks[1]), Object.keys(S.deserialize(S.serialize(S.newProject({ model: 'juno60' }))).tracks[0]));
  const again = S.deserialize(S.serialize(q));
  assert.equal(S.serialize(again), S.serialize(q), 'stable');
  const h = new S.History(10);
  h.record(q);
  q.tracks[0].lay.i1.x = 400;
  const back = h.undo(q);
  assert.equal(back.tracks[0].lay.i1.x, 40, 'History carries it with the track');
});

test('the cv-module CSS section: last in style.css, counter-scaled hit areas from --ik, strokes from --ik, no paint containment on the root', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const at = css.indexOf('/* ===================================================================== cv-module');
  assert.ok(at > 0 && css.indexOf('/* =====', at + 10) < 0, 'the last section');
  const sec = css.slice(at).replace(/\/\*[\s\S]*?\*\//g, ''); // (rules only)
  assert.match(sec, /\.cv-jack::before \{[^}]*calc\(44px \* var\(--ik(, 1)?\)\)/, 'jack hit circle 44 screen px');
  assert.match(sec, /\.cv-bar::before \{[^}]*calc\(36px \* var\(--ik(, 1)?\) - 40px\)/, 'the bar\'s upward hit extension');
  assert.match(sec, /\.cv-cable \{[^}]*stroke-width: calc\(4px \* var\(--ik(, 1)?\)\)/);
  assert.match(sec, /\.cv-cable-hit \{[^}]*calc\(12px \* var\(--ik(, 1)?\)\)/);
  assert.match(sec, /calc\(24px \* var\(--ik(, 1)?\)\)/, 'touch hit path');
  assert.ok(!/vector-effect/.test(sec), 'never vector-effect');
  assert.match(sec, /\.cv-mod \{[^}]*position: absolute;[^}]*contain: layout style;/);
  assert.ok(!/\.cv-mod \{[^}]*contain:[^;]*paint/.test(sec), 'no paint containment on the root (jacks and the bar extension lie outside)');
  assert.match(sec, /\.cv-body \{[^}]*contain: layout paint style/);
  assert.match(sec, /\.cv-bar \{[^}]*height: 40px;[^}]*touch-action: none/);
  assert.ok(!/min-height:\s*(44|48)px/.test(sec), 'hit areas grow through ::before, never min-height');
});
