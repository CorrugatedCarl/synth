import './v8-guard.mjs';
// cv-module.js (stage 1b MODULES lane; docs/canvas/IMPL-1b.md §8.3): isBackground / BG_SEL, fxKey + layOf fallback,
// tidy columns, camGet / camPut LRU (keys: cv-migrate camKey), createModule chrome on tests/wk-dom.mjs (bar 40 px, jacks, fold, setPos,
// the body mounted for the module's life, onScreen → [data-cv-off]), the fixed sizes (nothing is resizable: no grip, ever;
// a Hardware layout's size without measuring, a Simple layout's FLOW_W with the height measured, setFixed), makeRoom, top-bar move (world delta = screen / k, snap to the 32 px dots, Shift = no snap, two-finger
// cancel restores), createTrackView with a scripted world (bodies, ports, cables, lay callbacks, FX key swap, host.size),
// song.js lay validation (normLay, ui: 'flow') and round-trip. Stage 1e: power (⏻, [data-off]), the key-zone pill and its
// popover, the bar badge, zoneLabel, devicesOf, Tidy for any number of devices, the device-driven track view (sync by key,
// bodies by key, Serum-inner jacks read-only, cables from wires) and V.cableDrag. Stage 2a: modulator modules (devicesOf,
// the Tidy column, layOf keys, W_MOD × MOD_H, the mod-out jack, colours, cost), the knob end points (destPort cached per
// module, invalidated by fold / size / sync / refresh / remeasure; host.destPort), read-only audio with editable mod
// cables, the selection's mod cables, the zoom re-cut, a mod drag through V.cableDrag. Never pass fake-DOM nodes to assert.*.
// Run alone: node --max-old-space-size=2048 --test tests/cv-module.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../cv-module.js?v=9';
import * as S from '../song.js?v=9';
import * as CM from '../cv-migrate.js?v=9';
import { fresh, all, byCls, one, ptr, fire, key, Ev, place, layout } from './wk-dom.mjs';
import * as CB from '../cv-cables.js?v=9';
import * as core from '../serum-core.js?v=9';

/* ---------------------------------------------------------------- helpers */
// a scripted cv-world World: k, a camera, toWorld, items, selection, focus, drag pointer, events
function fakeWorld(k = 1) {
  const L = {};
  const W = {
    k, cam: { tx: 0, ty: 0, k }, el: null, items: new Map(), log: [], pointers: [], selected: null,
    toWorld: (x, y) => ({ x: (x - W.cam.tx) / W.k, y: (y - W.cam.ty) / W.k }),
    toClient: (x, y) => ({ x: x * W.k + W.cam.tx, y: y * W.k + W.cam.ty }), hooks: {}, // (1e: the cable drag)
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
    id: 'i1', kind: 'inst', title: 'Minimoog', sub: 'Bass 1', x: 16, y: 24, w: 1080,
    jacks: [{ id: 'out', side: 'right', kind: 'audio', label: 'Minimoog out' }], body: body(log),
    onMove: (x, y, ph) => moves.push([ph, x, y]),
  }, o), env);
  return { m, log, moves };
}

/* ---------------------------------------------------------------- pure helpers */
test('BG_SEL / isBackground: module chrome and panel backgrounds pan; controls never; outside a module nothing', () => {
  for (const c of ['.cv-body', '.inst', '.plate', '.nameplate', '.secs', '.sec', '.ctls', '.sx-root', '.fxr-root', '.cv-out',
    '.inst.hw', '.hw-decor', '.hw-decor *', '.hw-ctls', '.hw-extras', '.hw-xcap']) { // (a hardware panel's art pans; never a .hw-c widget)
    assert.ok(M.BG_SEL.split(',').map(s => s.trim()).includes(c), 'BG_SEL has ' + c);
  }
  for (const bad of ['button', 'input', 'select', '.knob', '.wk-knob', '[data-dest]', '.cv-jack', '.cv-bar', '.cv-ttl', '.cv-title', '.cv-sub', 'canvas,',
    '.hw-c', '.hw-sw', '.hw-btn', '.hw-jk', '.cv-card', '.cv-art']) {
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
  assert.deepEqual([M.W_CLASSIC, M.W_SERUM, M.W_FX, M.W_OUT, M.GAP], [1080, 1200, 760, 280, 160]);
  for (const gone of ['MIN_W', 'MAX_W', 'MIN_W_SERUM', 'widthRange']) assert.equal(gone in M, false, 'nothing is resizable: no ' + gone);
});

test('FLOW_W: one fixed Simple-layout width per classic model, on the dots, wide enough for its content (the TB-303 steps ≥ 608, the DX7 operator rows ≥ 992); defaultW / sizeFor follow it', () => {
  const ids = ['modular', 'minimoog', 'arp2600', 'solina', 'cs80', 'prophet5', 'ms20', 'tb303', 'obxa', 'jupiter8', 'juno60', 'dx7'];
  assert.deepEqual(Object.keys(M.FLOW_W).sort(), ids.slice().sort(), 'every classic model');
  assert.equal(Object.isFrozen(M.FLOW_W), true);
  for (const id of ids) {
    const w = M.FLOW_W[id];
    assert.ok(w % 32 === 0 && w >= 768 && w <= 1216, id + ': ' + w + ' on the 32 px dots, in range');
    assert.equal(M.defaultW(M.ID.inst, id), w, id + ': defaultW');
    assert.equal(M.sizeFor(id).w, w, id + ': the drop outline');
  }
  assert.ok(M.FLOW_W.tb303 >= 608 + 64 && M.FLOW_W.dx7 >= 992, 'room to spare past the measured minimums');
  assert.deepEqual([M.defaultW(M.ID.inst, 'serum'), M.defaultW(M.ID.inst, 'nosuch'), M.defaultW(M.ID.fx, 'tb303'), M.defaultW(M.ID.sxFx, 'serum'), M.defaultW(M.ID.out, 'tb303')],
    [M.W_SERUM, M.W_CLASSIC, M.W_FX, M.W_FX, M.W_OUT]);
});

test('tidy: instrument → FX → OUT in one row from (0, 0), GAP apart, tops aligned, columns on the grid', () => {
  assert.deepEqual(M.tidy({ model: 'minimoog' }, {}), { i1: { x: 0, y: 0 }, fx1: { x: 1344, y: 0 }, out: { x: 2272, y: 0 } }, 'from the Minimoog\'s FLOW_W (1184)');
  assert.deepEqual(M.tidy({ model: 'serum' }, null), { i1: { x: 0, y: 0 }, 'i1/fx': { x: 1376, y: 0 }, out: { x: 2304, y: 0 } });
  const t = M.tidy({ model: 'juno60' }, { i1: { w: 1003, h: 500 }, fx1: { w: 700, h: 300 }, out: { w: 280, h: 230 } });
  assert.deepEqual(Object.entries(t).map(([k, v]) => [k, v.x, v.y]), [['i1', 0, 0], ['fx1', 1184, 0], ['out', 2048, 0]]);
  assert.ok(Object.values(t).every(v => v.x % 8 === 0), 'grid columns');
  assert.ok(t.fx1.x >= 1003 + M.GAP && t.out.x >= t.fx1.x + 700 + M.GAP, 'GAP at least');
});

test('layOf: the stored entry (a copy, never a width), the other FX key after a model change (place, fold, z), else Tidy', () => {
  const td = M.tidy({ model: 'minimoog' }, {});
  const tr = { model: 'minimoog', lay: { i1: { x: 40, y: 80, w: 900 }, 'i1/fx': { x: 1500, y: -64, w: 999, fold: 1, z: 7 } } };
  const e = M.layOf(tr, 'i1', td);
  assert.deepEqual(e, { x: 40, y: 80 }, 'a stored width (from before the no-resizing rule) is ignored');
  e.x = 1; assert.equal(tr.lay.i1.x, 40, 'a copy');
  assert.deepEqual(M.layOf(tr, 'fx1', td), { x: 1500, y: -64, fold: 1, z: 7 }, 'a classic track finds the Serum FX place');
  assert.deepEqual(M.layOf({ model: 'serum', lay: { fx1: { x: 3, y: 4 } } }, 'i1/fx', td), { x: 3, y: 4 }, 'and back');
  assert.deepEqual(M.layOf(tr, 'out', td), { x: 2272, y: 0 }, 'no entry: Tidy');
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

test('sizeFor: the drop outline of a model (its fixed width: Serum wider)', () => {
  assert.equal(M.sizeFor('serum').w, M.W_SERUM);
  assert.equal(M.sizeFor('minimoog').w, M.FLOW_W.minimoog);
  assert.ok(M.sizeFor('serum').h > M.sizeFor('juno60').h);
});

/* ---------------------------------------------------------------- one module on wk-dom */
test('createModule: chrome, a 40 px bar, jacks on the edges, fold → BAR_H tall, the body mounted for the module\'s life (Z1: no card), onScreen marks [data-cv-off] only', () => {
  const doc = fresh();
  const scr = [];
  const { m, log } = mod({ onScreen: on => scr.push(on) }, { doc });
  doc.body.append(m.el);
  assert.equal(m.el.getAttribute('data-cv-mod'), 'i1');
  assert.equal(m.el.getAttribute('data-cv-kind'), 'inst');
  assert.equal(m.el.hasAttribute('data-cv-view'), false, 'no views');
  assert.equal(m.bar.hasAttribute('data-cv-bar'), true);
  assert.deepEqual(m.el.childNodes.map(n => n.getAttribute('class')), ['cv-bar', 'cv-body', 'cv-jack'], 'no card');
  assert.deepEqual(m.bar.childNodes.map(n => n.getAttribute('class')), ['cv-pow', 'cv-stripe', 'cv-ttl', 'cv-chip', 'cv-cpu', 'cv-btn cv-more', 'cv-btn cv-fold']);
  assert.equal(one(m.bar, 'cv-title').textContent, 'Minimoog');
  assert.equal(one(m.bar, 'cv-sub').textContent, 'Bass 1');
  assert.deepEqual([m.el.style.left, m.el.style.top, m.el.style.width, m.el.style.zIndex], ['16px', '24px', '1080px', '1']);
  assert.deepEqual(log, ['mount cv-body'], 'the body is mounted at once');
  const jack = one(m.el, 'cv-jack');
  assert.deepEqual([jack.getAttribute('data-cv-jack'), jack.getAttribute('data-side'), jack.getAttribute('aria-label')], ['i1.out', 'right', 'Minimoog out']);
  assert.deepEqual(m.port('out'), { x: 1080, y: M.BAR_H + M.JACK_Y });
  assert.equal(jack.style.top, (M.BAR_H + M.JACK_Y) + 'px', 'the dot sits at the port offset');
  m.setFold(true);
  assert.equal(m.rect().h, M.BAR_H);
  assert.deepEqual(m.port('out'), { x: 1080 + M.JACK_OUT, y: M.BAR_H / 2 }, 'folded: the jacks at the bar\'s middle, just outside the edge');
  assert.equal(m.el.hasAttribute('data-cv-fold'), true);
  assert.equal(one(m.bar, 'cv-fold').getAttribute('aria-expanded'), 'false');
  m.setFold(false);
  assert.equal(m.el.hasAttribute('data-cv-fold'), false);
  assert.equal(all(m.el).filter(n => n.getAttribute && (/cv-grip/.test(n.getAttribute('class') || '') || n.getAttribute('role') === 'separator')).length, 0, 'no width grip');
  // off screen: [data-cv-off] and the owner's hook — the body and what it holds stay, nothing is hidden or unmounted
  const inner = doc.createElement('div'); m.body.append(inner);
  assert.equal(m.screen, true);
  m.onScreen(false); m.onScreen(false);
  assert.deepEqual([m.screen, m.el.hasAttribute('data-cv-off'), scr], [false, true, [false]], 'once per change');
  assert.equal(inner.parentNode === m.body && m.body.parentNode === m.el, true, 'the body and its content stay');
  assert.equal(m.body.hidden, false);
  m.onScreen(true);
  assert.deepEqual([m.screen, m.el.hasAttribute('data-cv-off'), scr], [true, false, [false, true]]);
  assert.deepEqual(log, ['mount cv-body'], 'never unmounted by the camera');
  m.destroy();
  assert.deepEqual(log, ['mount cv-body', 'unmount cv-body']);
  assert.equal(m.el.parentNode === null, true);
  const u = mod({ id: 'out', kind: 'out', jacks: [{ id: 'in', side: 'left' }] }, { doc });
  assert.deepEqual(u.m.port('in'), { x: 0, y: M.BAR_H + M.JACK_Y });
});

test('createModule: a fixed size — a Hardware layout\'s width and height set once (rect() without measuring), a Simple layout\'s width with the height measured; no grip, ever', () => {
  const doc = fresh();
  const { m } = mod({ fixed: { w: 1408, h: 512 }, w: 1200 }, { doc });
  doc.body.append(m.el);
  let reads = 0;
  Object.defineProperty(m.el, 'offsetHeight', { get() { reads++; return 999; } });
  assert.deepEqual([m.w, m.rect().w, m.rect().h, reads], [1408, 1408, 512, 0], 'the fixed size, no layout read');
  assert.equal(m.el.hasAttribute('data-cv-fixed'), true);
  assert.equal(m.body.style.height, (512 - M.BAR_H) + 'px', 'the body height is set once');
  assert.deepEqual(m.fixed, { w: 1408, h: 512 });
  m.setW(900);
  assert.equal(m.w, 1408, 'setW cannot change a fixed module');
  assert.equal(byCls(m.el, 'cv-grip').length, 0, 'no width grip');
  // a drag at the right edge is no resize (there is nothing to take it)
  ptr(m.el, 'pointerdown', 1400, 100); ptr(m.el, 'pointermove', 1600, 100); ptr(m.el, 'pointerup', 1600, 100);
  assert.equal(m.w, 1408);
  m.setFold(true);
  assert.equal(m.rect().h, M.BAR_H, 'folded: the bar');
  m.setFold(false);
  m.setFixed({ w: M.FLOW_W.tb303 }); // the Simple layout (the ⋯ toggle): its model's fixed width, the height measured
  assert.deepEqual([m.w, m.rect().h, m.el.hasAttribute('data-cv-fixed'), m.body.style.height, m.fixed], [M.FLOW_W.tb303, 999, true, '', { w: M.FLOW_W.tb303, h: 0 }]);
  m.setW(1200);
  assert.equal(m.w, M.FLOW_W.tb303, 'still its fixed width');
  assert.equal(byCls(m.el, 'cv-grip').length, 0);
});

test('makeRoom: the modules right of the instrument that overlap it vertically move right together to GAP past it (on the dots); never left; null when clear', () => {
  const R = (x, y, w, h) => ({ x, y, w, h });
  const base = { i1: R(0, 0, 1408, 512), fx1: R(1248, 0, 760, 400), out: R(2176, 0, 280, 260) };
  assert.deepEqual(M.makeRoom(base, 'i1'), { fx1: { x: 1568, y: 0 }, out: { x: 2496, y: 0 } }, 'the relative layout kept');
  assert.equal(M.makeRoom({ i1: R(0, 0, 1408, 512), fx1: R(1568, 0, 760, 400), out: R(2496, 0, 280, 260) }, 'i1'), null, 'already clear');
  assert.equal(M.makeRoom({ i1: R(0, 0, 1408, 512), fx1: R(1440, 0, 760, 400) }, 'i1'), null, 'a dot or more past it: clear');
  assert.deepEqual(M.makeRoom({ i1: R(0, 0, 1408, 512), fx1: R(1420, 0, 760, 400) }, 'i1'), { fx1: { x: 1568, y: 0 } }, 'less than a dot past it: moved');
  assert.deepEqual(M.makeRoom({ i1: R(64, 96, 1408, 512), fx1: R(1248, 520, 760, 400), out: R(1300, 700, 280, 260) }, 'i1'), { fx1: { x: 1632, y: 520 } }, 'out lies below the instrument: ignored; gup(64 + 1408 + 160) = 1632');
  assert.equal(M.makeRoom({ i1: R(0, 0, 1408, 512), fx1: R(-900, 0, 760, 400), out: R(200, 600, 280, 260) }, 'i1'), null, 'left of it / below it: ignored');
  assert.equal(M.makeRoom({ i1: R(0, 0, 1408, 512) }, 'i1'), null);
  assert.deepEqual(M.makeRoom({ i1: R(0, 0, 1408, 512), fx1: R(1248, 0, 760, 400) }, 'i1', 320), { fx1: { x: 1728, y: 0 } }, 'a gap of 320');
});

test('createModule: setPos live is a transform (no layout), commit moves left / top; setZ, setTitle, setChip', () => {
  const doc = fresh();
  const { m } = mod({}, { doc });
  m.setPos(116, 74, true);
  assert.equal(m.el.style.transform, 'translate3d(100px, 50px, 0)');
  assert.equal(m.el.style.willChange, 'transform');
  assert.deepEqual([m.el.style.left, m.el.style.top], ['16px', '24px'], 'live: left / top untouched');
  assert.deepEqual(m.rect(), { x: 116, y: 74, w: 1080, h: m.rect().h }, 'the rect follows the live position');
  m.setPos(120, 80);
  assert.deepEqual([m.el.style.left, m.el.style.top, m.el.style.transform, m.el.style.willChange], ['120px', '80px', '', '']);
  m.setZ(12); assert.equal(m.el.style.zIndex, '12');
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
});

test('top-bar move: world delta = screen delta / k, snap to the dots (32), one start / end pair, edge-pan pointer, re-projection on camera frames', () => {
  const doc = fresh(), W = fakeWorld(2);
  const { m, moves } = mod({ x: 16, y: 24 }, { doc, world: W });
  doc.body.append(m.el);
  ptr(m.bar, 'pointerdown', 500, 300, { pointerId: 1, pointerType: 'mouse' });
  ptr(m.bar, 'pointermove', 502, 301, { pointerId: 1, pointerType: 'mouse' });
  assert.equal(moves.length, 0, 'inside the 4 px slop: no move yet');
  ptr(m.bar, 'pointermove', 541, 311, { pointerId: 1, pointerType: 'mouse' }); // +41, +11 screen = +20.5, +5.5 world → snapped
  assert.deepEqual(moves[0], ['start', 16, 24], 'start at the first real move');
  assert.deepEqual(moves[1], ['move', 32, 32], '(16 + 20.5, 24 + 5.5) snapped to the dots');
  assert.equal(W.selected, 'i1', 'a moved module is selected');
  assert.equal(m.el.style.transform, 'translate3d(16px, 8px, 0)');
  assert.deepEqual(W.pointers.at(-1), '541,311');
  // the camera pans under a still pointer (edge pan): the module stays under the finger in screen terms
  W.cam.tx -= 80; W.emit('camera', W.cam);
  assert.deepEqual(moves.at(-1), ['move', 64, 32], 'world under the pointer moved by 80 / 2 (76.5 → 64)');
  ptr(m.bar, 'pointerup', 541, 311, { pointerId: 1, pointerType: 'mouse' });
  assert.deepEqual(moves.at(-1), ['end', 64, 32]);
  assert.equal(moves.filter(x => x[0] === 'start').length, 1);
  assert.equal(moves.filter(x => x[0] === 'end').length, 1);
  assert.deepEqual([m.el.style.left, m.el.style.top, m.el.style.transform], ['64px', '32px', '']);
  assert.equal(W.pointers.at(-1), null, 'the drag pointer cleared');
  W.emit('camera', W.cam);
  assert.equal(moves.at(-1)[0], 'end', 'no re-projection after the drop');
});

test('top-bar move: with the canvas Snap toggle off the module follows the pointer freely (no Shift needed)', () => {
  const doc = fresh(), W = fakeWorld(0.5);
  W.snapOn = () => false;
  const { m, moves } = mod({ x: 16, y: 24 }, { doc, world: W });
  ptr(m.bar, 'pointerdown', 500, 300, { pointerId: 1, pointerType: 'mouse' });
  ptr(m.bar, 'pointermove', 541, 311, { pointerId: 1, pointerType: 'mouse' });
  assert.deepEqual(moves[1], ['move', 98, 46], 'unsnapped: 16 + 41 / 0.5, 24 + 11 / 0.5');
  ptr(m.bar, 'pointerup', 541, 311, { pointerId: 1, pointerType: 'mouse' });
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
  assert.deepEqual(moves.at(-1), ['move', 0, 32], '+20 snapped (to the dots)');
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
  assert.deepEqual([...V.modules.values()].map(m => [m.x, m.y, m.w]), [[0, 0, 1184], [1344, 0, 760], [2272, 0, 280]], 'the Minimoog\'s fixed width (no host.size: FLOW_W)');
  assert.deepEqual(root.childNodes.map(n => n.getAttribute('class') + ':' + (n.getAttribute('data-cv-mod') || '')),
    ['cv-cables:', 'cv-cable-ends:', 'cv-mod:i1', 'cv-mod:fx1', 'cv-mod:out']);
  const P = V.ports();
  assert.deepEqual([...P.entries()].map(([k, p]) => k + '@' + p.x + ',' + p.y), ['i1.out@1184,68', 'fx1.in@1344,68', 'fx1.out@2104,68', 'out.in@2272,68']);
  const d = all(root).filter(n => n.getAttribute && n.getAttribute('class') === 'cv-cable').map(n => n.getAttribute('d'));
  assert.equal(d.length, 2);
  assert.ok(d[0].startsWith('M 1184 68 C'), 'instrument out → FX in');
  assert.ok(d[1].endsWith('2272 68'), 'FX out → OUT in');
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

test('createTrackView: a move = one start / end pair through host.lay; fold too; bring-to-front writes z without a start; no width to change', () => {
  const doc = fresh(), W = fakeWorld(1), tr = { id: 'trk_1', model: 'minimoog', name: 'Bass 1', color: '#3b82c4' };
  const { V, calls } = view(tr, W, doc);
  const fx = V.modules.get('fx1');
  ptr(fx.bar, 'pointerdown', 1300, 20, { pointerId: 1, pointerType: 'mouse' });
  const zcalls = calls.filter(c => c[1] === 'end' && c[2] === 'z');
  assert.equal(zcalls.length, 1, 'a press brings it to front (tie at z 1)');
  assert.deepEqual(JSON.parse(zcalls[0][3]), { x: 1344, y: 0, z: 2 });
  ptr(fx.bar, 'pointermove', 1340, 100, { pointerId: 1, pointerType: 'mouse' });
  ptr(fx.bar, 'pointermove', 1380, 180, { pointerId: 1, pointerType: 'mouse' });
  ptr(fx.bar, 'pointerup', 1380, 180, { pointerId: 1, pointerType: 'mouse' });
  const mv = calls.filter(c => c[2] === 'move');
  assert.deepEqual(mv.map(c => c[1]), ['start', 'end']);
  assert.deepEqual(JSON.parse(mv[1][3]), { x: 1440, y: 160, z: 2 }, '1344 + 80 snapped to the dots');
  assert.deepEqual(tr.lay.fx1, { x: 1440, y: 160, z: 2 });
  assert.equal(V.ports().get('fx1.in').y, 160 + 68, 'the cables follow');
  ptr(fx.bar, 'pointerdown', 1400, 180, { pointerId: 2, pointerType: 'mouse' });
  assert.equal(calls.filter(c => c[2] === 'z').length, 1, 'already in front: no write');
  ptr(fx.bar, 'pointerup', 1400, 180, { pointerId: 2, pointerType: 'mouse' });
  // the canvas arrow keys (world.key → item.nudge): one step each
  calls.length = 0;
  fx.nudge(-8, 32);
  assert.deepEqual(calls.filter(c => c[2] === 'move').map(c => c[1]), ['start', 'end']);
  assert.deepEqual(tr.lay.fx1, { x: 1432, y: 192, z: 2 });
  // fold from the menu path: one step
  calls.length = 0;
  V.toggleFold('out');
  assert.deepEqual(calls.filter(c => c[2] === 'fold').map(c => c[1]), ['start', 'end']);
  assert.deepEqual(JSON.parse(calls.find(c => c[1] === 'end')[3]), { x: 2272, y: 0, fold: 1 });
  assert.ok(calls.some(c => c[0] === 'out' && c[1] === 'shown'), 'monitors hear about it');
  assert.equal(V.live('out'), false, 'folded: not live');
  // no width to change: no grip on any module, no Reset width, no width in any entry written
  assert.equal(all(doc.body).filter(n => n.getAttribute && /cv-grip/.test(n.getAttribute('class') || '')).length, 0, 'no grip');
  assert.equal('resetWidth' in V, false);
  assert.ok(Object.values(tr.lay).every(e => !('w' in e)), 'no width stored');
  V.destroy();
});

test('createTrackView.sync: lay changes (undo) move modules without remounting; a model change swaps the FX key in place', () => {
  const doc = fresh(), W = fakeWorld(1), tr = { id: 'trk_1', model: 'minimoog', name: 'Bass 1', color: '#3b82c4', lay: { fx1: { x: 1400, y: 200, fold: 1 } } };
  const { V, bodies } = view(tr, W, doc);
  assert.deepEqual([V.modules.get('fx1').x, V.modules.get('fx1').y, V.modules.get('fx1').fold], [1400, 200, true]);
  bodies.length = 0;
  const undone = JSON.parse(JSON.stringify(tr)); delete undone.lay; // (History brings a new object)
  V.sync(undone);
  assert.deepEqual([V.modules.get('fx1').x, V.modules.get('fx1').y, V.modules.get('fx1').fold], [1344, 0, false], 'back to Tidy');
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

test('createTrackView lay: the first write pins the modules Tidy still places — a move, a sync or a reload never moves the others; an untouched track keeps no lay; a stored width (from before the no-resizing rule) is ignored and dropped by the next write; a model change on an untouched track places FX / OUT from the new width once', () => {
  const doc = fresh(), tr = { id: 'trk_1', model: 'minimoog', name: 'Bass 1', color: '#3b82c4' };
  const R = view2(tr, doc);
  const tidyRow = 'i1:0,0+1184 fx1:1344,0+760 out:2272,0+280';
  assert.equal(xs(R.V), tidyRow);
  assert.equal('lay' in tr, false, 'untouched: no lay key');
  R.V.modules.get('i1').nudge(0, 64);
  assert.equal(xs(R.V), 'i1:0,64+1184 fx1:1344,0+760 out:2272,0+280', 'the others stay where they stand');
  assert.deepEqual(Object.keys(tr.lay).sort(), ['fx1', 'i1', 'out'], 'pinned with the move');
  assert.deepEqual(R.calls.filter(c => c[2] === 'pin').map(c => c[0] + ' ' + c[1]), ['fx1 end', 'out end'], 'after the move\'s own end (one undo step)');
  R.sync(clone(R.ref.t));
  assert.equal(xs(R.V), 'i1:0,64+1184 fx1:1344,0+760 out:2272,0+280', 'a sync (an undo / redo restore) moves nothing');
  R.V.destroy();
  const R2 = view2(clone(R.ref.t), doc); // a reload
  assert.equal(xs(R2.V), 'i1:0,64+1184 fx1:1344,0+760 out:2272,0+280', 'a reload neither');
  R2.V.destroy();
  // a layout saved while modules were resizable: its widths are ignored (each module keeps its own) and the next write drops them
  const old = clone(R2.ref.t);
  old.lay.i1.w = 1600; old.lay.fx1.w = 300;
  const R3 = view2(old, doc);
  assert.equal(xs(R3.V), 'i1:0,64+1184 fx1:1344,0+760 out:2272,0+280', 'stored widths ignored');
  R3.V.modules.get('i1').nudge(32, 0);
  assert.deepEqual(R3.ref.t.lay.i1, { x: 32, y: 64 }, 'the next write: no width');
  R3.V.destroy();
  // an untouched track switched to Serum: FX / OUT from the Serum width at once, and they stay on the next sync
  const t2 = { id: 'trk_2', model: 'minimoog', name: 'Lead', color: '#c43b3b' }, R4 = view2(t2, doc);
  const sx = Object.assign(clone(t2), { model: 'serum' });
  R4.sync(sx);
  const a = xs(R4.V);
  R4.sync(clone(sx));
  assert.deepEqual([a, xs(R4.V)], ['i1:0,0+1200 out:2304,0+280 i1/fx:1376,0+760', 'i1:0,0+1200 out:2304,0+280 i1/fx:1376,0+760']);
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

test('createTrackView.sync: the instrument\'s fixed width follows a model change (classic ↔ Serum, classic → classic); a stored width never wins', () => {
  const doc = fresh(), tr = { id: 'trk_1', model: 'minimoog', name: 'Bass 1', color: '#3b82c4' };
  const R = view2(tr, doc), w = () => R.V.modules.get('i1').w;
  assert.equal(w(), M.FLOW_W.minimoog);
  R.sync(Object.assign(clone(tr), { model: 'serum', lay: { i1: { x: 0, y: 0, w: 800 } } }));
  assert.deepEqual([w(), R.V.modules.get('i1').fixed], [M.W_SERUM, { w: M.W_SERUM, h: 0 }], 'a Serum: its ≥ 1100 layout\'s width, the height measured');
  R.sync(Object.assign(clone(R.ref.t), { model: 'tb303', lay: { i1: { x: 0, y: 0, w: 480, ui: 'flow' } } }));
  assert.equal(w(), M.FLOW_W.tb303, 'the TB-303\'s Simple width (its steps fit), not the stored 480');
  assert.equal(all(doc.body).filter(n => n.getAttribute && /cv-grip/.test(n.getAttribute('class') || '')).length, 0, 'never a grip');
  R.V.destroy();
});

test('createTrackView: host.size drives the instrument — always fixed: a Hardware layout\'s size (Tidy from its width), the Simple layout\'s after a toggle (sync; the height measured); a stored width is ignored and a move drops it; lay.i1.ui survives a move; live() = on screen and not folded', () => {
  const doc = fresh(), tr = { id: 'trk_1', model: 'minimoog', name: 'Bass 1', color: '#3b82c4' };
  let size = { fixed: { w: 1408, h: 512 } };
  const root = doc.createElement('div'), ref = { t: tr }, shown = [];
  doc.body.append(root);
  const host = {
    root, doc, title: kind => ({ title: kind }), size: kind => (kind === 'inst' ? size : null),
    lay: (k, e, ph) => { if (ph === 'end' && e) { ref.t.lay = ref.t.lay || {}; ref.t.lay[k] = e; } },
    shown: k => shown.push(k),
  };
  const V = M.createTrackView(fakeWorld(1), tr, host), I = () => V.modules.get('i1');
  assert.deepEqual([I().fixed, I().el.hasAttribute('data-cv-fixed')], [{ w: 1408, h: 512 }, true]);
  assert.equal(xs(V), 'i1:0,0+1408 fx1:1568,0+760 out:2496,0+280', 'Tidy places the others after the fixed width');
  // the toggle: Simple (the host answers the model's Simple width; lay.i1 carries ui 'flow' and a width stored before the rule)
  size = { fixed: { w: M.FLOW_W.minimoog } };
  ref.t = { id: 'trk_1', model: 'minimoog', lay: { i1: { x: 0, y: 0, w: 1280, ui: 'flow' }, fx1: { x: 1568, y: 0 }, out: { x: 2496, y: 0 } } };
  V.sync(ref.t);
  assert.deepEqual([I().fixed, I().w, I().el.hasAttribute('data-cv-fixed'), I().body.style.height], [{ w: M.FLOW_W.minimoog, h: 0 }, M.FLOW_W.minimoog, true, ''],
    'the Simple width (not the stored one), the height measured');
  // back to Hardware: its fixed size; a move writes no width
  size = { fixed: { w: 1408, h: 512 } };
  const hwLay = { i1: { x: 0, y: 0, w: 1280 }, fx1: { x: 1568, y: 0 }, out: { x: 2496, y: 0 } };
  ref.t = Object.assign(clone(ref.t), { lay: clone(hwLay) });
  V.sync(ref.t);
  assert.deepEqual([I().w, I().fixed && I().fixed.w], [1408, 1408]);
  const b = I().bar;
  ptr(b, 'pointerdown', 100, 20); ptr(b, 'pointermove', 140, 20); ptr(b, 'pointermove', 196, 20); ptr(b, 'pointerup', 196, 20);
  assert.deepEqual([ref.t.lay.i1.x, 'w' in ref.t.lay.i1, 'ui' in ref.t.lay.i1], [96, false, false], 'a move in Hardware: no width written (the stored one dropped)');
  ref.t.lay.i1.ui = 'flow'; size = { fixed: { w: M.FLOW_W.minimoog } }; V.sync(ref.t);
  ptr(b, 'pointerdown', 100, 20); ptr(b, 'pointermove', 140, 20); ptr(b, 'pointermove', 132, 20); ptr(b, 'pointerup', 132, 20);
  assert.deepEqual([ref.t.lay.i1.ui, 'w' in ref.t.lay.i1, I().w], ['flow', false, M.FLOW_W.minimoog], 'a move keeps the layout choice, and the width');
  // live(): on screen and not folded
  assert.equal(V.live('fx1'), true);
  V.modules.get('fx1').onScreen(false);
  assert.deepEqual([V.live('fx1'), shown.at(-1)], [false, 'fx1'], 'off screen: host.shown');
  V.modules.get('fx1').onScreen(true);
  V.toggleFold('fx1');
  assert.equal(V.live('fx1'), false, 'folded');
  V.destroy();
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
    { i1: { x: 10, y: -4, fold: 1, z: 3 }, 'i1/fx': { x: 1, y: 2 } }, 'a stored width (from before the no-resizing rule) is dropped');
  assert.deepEqual(S.normLay({ out: { x: 5e9, y: -5e9, w: 9, z: 0, fold: 0 } }), { out: { x: 1e6, y: -1e6, z: 1 } });
  assert.deepEqual(S.normLay({ out: { x: 1, y: 2, w: 1e9, z: 1e9 } }), { out: { x: 1, y: 2, z: 1e6 } });
  const bad = { I1: { x: 1, y: 1 }, '1a': { x: 1, y: 1 }, 'a/b/c': { x: 1, y: 1 }, abcdefghijklmnopq: { x: 1, y: 1 }, a: { x: '1', y: 1 },
    b: { x: NaN, y: 1 }, c: null, d: [1, 2], e: { x: 1 }, ok: { x: 0, y: 0, w: 'wide' } };
  assert.deepEqual(S.normLay(bad), { ok: { x: 0, y: 0 } });
  assert.equal(S.normLay(JSON.parse('{"__proto__": {"x": 1, "y": 1}}')), undefined);
  const many = {};
  for (let i = 0; i < 300; i++) many['m' + i] = { x: i, y: 0 };
  assert.equal(Object.keys(S.normLay(many)).length, 256, '(milestone 3, schema 7: 256 entries — a Serum in parts is up to 25 modules)');
});

test('song.normLay: an instrument\'s layout choice — ui: \'flow\' (Simple) kept, anything else dropped (absent = Hardware); no schema bump', () => {
  assert.deepEqual(S.normLay({ i1: { x: 0, y: 0, w: 1280, ui: 'flow' } }), { i1: { x: 0, y: 0, ui: 'flow' } });
  assert.deepEqual(S.normLay({ i1: { x: 0, y: 0, ui: 'hw' }, out: { x: 1, y: 1, ui: 1 } }), { i1: { x: 0, y: 0 }, out: { x: 1, y: 1 } });
  const t = S.deserialize(S.serialize({ bpm: 120, tracks: [{ id: 't1', name: 'A', model: 'minimoog', notes: [], lay: { i1: { x: 0, y: 0, ui: 'flow' } } }] }));
  assert.equal(t.tracks[0].lay.i1.ui, 'flow');
});

test('song.deserialize: lay round-trips (an old file\'s widths dropped); no lay on an old track (no new key); serialize carries it', () => {
  const p = S.newProject({ model: 'minimoog' });
  const t2 = S.newTrack(p, { model: 'juno60' }); p.tracks.push(t2);
  p.tracks[0].lay = { i1: { x: 40, y: 80, w: 960 }, fx1: { x: 1200, y: 80, fold: 1, z: 2 }, junk: 'no' };
  const q = S.deserialize(S.serialize(p));
  assert.deepEqual(q.tracks[0].lay, { i1: { x: 40, y: 80 }, fx1: { x: 1200, y: 80, fold: 1, z: 2 } });
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

test('createTrackView (1c): a selection of several moves together — live, one start for the mover, the others written in its step; a cancel puts them back; a nudge carries them', () => {
  const doc = fresh(), W = fakeWorld(1), tr = { id: 'trk_1', model: 'minimoog', name: 'Bass 1', color: '#3b82c4' };
  W.sel = ['fx1', 'out'];
  Object.defineProperty(W, 'selection', { get: () => W.sel.slice() });
  W.select = (id, o) => { if (!(o && o.keep && W.sel.includes(id))) W.sel = id ? [id] : []; W.selected = id; W.emit('select', { id }); };
  const { V, calls } = view(tr, W, doc), fx = V.modules.get('fx1'), out = V.modules.get('out'), i1 = V.modules.get('i1');
  const o0 = [out.x, out.y], f0 = fx.x;
  ptr(fx.bar, 'pointerdown', 1300, 20, { pointerId: 1, pointerType: 'mouse' });
  ptr(fx.bar, 'pointermove', 1340, 100, { pointerId: 1, pointerType: 'mouse' });
  assert.deepEqual(W.sel, ['fx1', 'out'], 'the group kept');
  const d = [fx.x - f0, fx.y];
  assert.deepEqual([out.x, out.y], [o0[0] + d[0], o0[1] + d[1]], 'the other follows, live');
  assert.equal(out.el.style.transform !== '', true, '(a transform while live)');
  ptr(fx.bar, 'pointerup', 1340, 100, { pointerId: 1, pointerType: 'mouse' });
  const mv = calls.filter(c => c[2] === 'move' || c[2] === 'group');
  assert.deepEqual(mv.map(c => c[0] + ' ' + c[1] + ' ' + c[2]), ['fx1 start move', 'fx1 end move', 'out end group'], 'one step: the mover records, the others join it');
  assert.deepEqual([tr.lay.out.x, tr.lay.out.y, i1.x], [o0[0] + d[0], o0[1] + d[1], 0], 'written; the unselected one stays');
  // Escape / a second finger: everything back
  const o1 = [out.x, out.y], f1 = [fx.x, fx.y];
  ptr(fx.bar, 'pointerdown', 1400, 120, { pointerId: 2, pointerType: 'mouse' });
  ptr(fx.bar, 'pointermove', 1500, 220, { pointerId: 2, pointerType: 'mouse' });
  fire(fx.bar, 'pointercancel', { pointerId: 2, pointerType: 'mouse', gesture: 'two-finger' });
  assert.deepEqual([fx.x, fx.y, out.x, out.y], [...f1, ...o1], 'cancelled: back');
  // a nudge (the canvas arrows) carries the group too
  fx.nudge(32, 0);
  assert.deepEqual([out.x, tr.lay.out.x], [o1[0] + 32, o1[0] + 32]);
  W.sel = ['fx1'];
  fx.nudge(32, 0);
  assert.equal(out.x, o1[0] + 32, 'alone: only it');
  V.destroy();
});

test('folded jacks (1c, the iPad report): outside the edges, clear of ⋯ / ▾ / the chip; the bar controls win the hit test; ▾ still folds and unfolds', () => {
  const doc = fresh(), W = fakeWorld(1), tr = { id: 'trk_1', model: 'minimoog', name: 'Bass 1', color: '#3b82c4' };
  const { V } = view(tr, W, doc), i1 = V.modules.get('i1'), fx = V.modules.get('fx1');
  for (const m of [i1, fx]) m.setFold(true);
  // the bar's geometry (style.css): padding-right 4 px, ▾ and ⋯ 32 px wide, 8 px apart; the dot 16 px; the coarse circle 44 px
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.cv-bar \{[^}]*padding: 0 4px 0 12px/); assert.match(css, /\.cv-btn \{[^}]*width: 32px/);
  for (const m of [i1, fx]) {
    const w = m.w, fold = [w - 4 - 32, w - 4], more = [w - 4 - 32 - 8 - 32, w - 4 - 32 - 8];
    const out = m.port('out'), dot = [out.x - 8, out.x + 8];
    assert.ok(dot[0] >= w + 6 && dot[0] > fold[1] && dot[0] > more[1], m.id + ': the out dot clear of ▾ and ⋯ ' + JSON.stringify([dot, fold]));
    if (m.jack('in')) { const p = m.port('in'); assert.ok(p.x + 8 <= -6, m.id + ': the in dot outside the left edge (padding 12 px)'); }
  }
  assert.match(css, /\.cv-mod\[data-cv-fold\] > \.cv-jack\[data-side="right"\] \{ left: calc\(100% \+ 14px\); \}/, 'CSS = port geometry (JACK_OUT)');
  assert.match(css, /\.cv-mod\[data-cv-fold\] > \.cv-jack\[data-side="left"\] \{ left: -14px; \}/);
  assert.equal(M.JACK_OUT, 14);
  assert.match(css, /\.cv-bar > \.cv-btn, \.cv-bar > \.cv-chip, \.cv-bar > \.cv-pow \{ position: relative; z-index: 4; \}/, 'above the jacks (z 3)');
  assert.match(css, /\.cv-jack \{ position: absolute; z-index: 3;/);
  // cables attach where the dots are
  assert.deepEqual(V.ports().get('i1.out'), { x: i1.x + i1.w + M.JACK_OUT, y: i1.y + M.BAR_H / 2 });
  // ▾ toggles (a press there is the button's: its pointerdown never starts a move)
  const foldB = one(i1.bar, 'cv-fold');
  ptr(foldB, 'pointerdown', 1130, 20, { pointerId: 9, pointerType: 'touch' }); fire(foldB, 'click');
  assert.equal(i1.fold, false, 'unfolded');
  fire(foldB, 'click');
  assert.equal(i1.fold, true);
  V.destroy();
});

test('setCpu (1d): the module\'s DSP load on its top bar — its share of the audio deadline (the engine\'s stats per Inst / Chain), empty for none', () => {
  const doc = fresh(), { m } = mod({}, { doc }), c = one(m.bar, 'cv-cpu');
  assert.equal(c.textContent, '', 'nothing until the engine reports');
  m.setCpu(0.0234); assert.equal(c.textContent, '2.3%'); assert.match(c.title, /2\.3% of the audio deadline/);
  m.setCpu(0.42); assert.equal(c.textContent, '42%');
  m.setCpu(0.00002); assert.equal(c.textContent, '<0.1%');
  m.setCpu(null); assert.deepEqual([c.textContent, c.title], ['', '']);
  m.setCpu(NaN); assert.equal(c.textContent, '');
});

test('the CPU slot (1d review): a fixed width with tabular digits, so a changing figure never moves the chip or the title', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8'), r = (css.match(/\.cv-cpu \{[^}]*\}/) || [''])[0];
  assert.match(r, /flex: none/, 'never shrinks'); assert.match(r, /min-width: 5ch/, '"<0.1%" … "100%" in one slot (a monospace font)');
  assert.match(r, /text-align: right/); assert.match(r, /white-space: nowrap/); assert.match(r, /font-variant-numeric: tabular-nums/);
  assert.match(css, /\.cv-cpu:empty \{ display: none; \}/, 'no slot without a figure (OUT, power off)');
});

/* ---------------------------------------------------------------- 1e: power, key zones, badges */
test('createModule (1e): power — a ⏻ button first on the bar (aria-pressed), a tap toggles it at once and tells onToggle; [data-off] dims the module; setPower is the host\'s (no callback); never a move or a select; without o.power the slot stays hidden', () => {
  const doc = fresh(), tog = [], picked = [];
  const { m, moves } = mod({ power: { on: true, onToggle: on => tog.push(on) }, onSelect: () => picked.push(1) }, { doc });
  doc.body.append(m.el);
  assert.deepEqual(m.bar.childNodes.map(n => n.getAttribute('class')), ['cv-pow', 'cv-stripe', 'cv-ttl', 'cv-chip', 'cv-cpu', 'cv-btn cv-more', 'cv-btn cv-fold']);
  const p = one(m.bar, 'cv-pow');
  assert.deepEqual([p.tagName, p.hidden, p.getAttribute('aria-pressed'), m.on, m.el.hasAttribute('data-off')], ['BUTTON', false, 'true', true, false]);
  assert.match(p.getAttribute('aria-label'), /Power: on/);
  ptr(p, 'pointerdown', 20, 20, { pointerId: 2 });
  ptr(p, 'pointermove', 80, 90, { pointerId: 2, buttons: 1 });
  ptr(p, 'pointerup', 80, 90, { pointerId: 2 });
  p.click();
  assert.deepEqual([tog, m.on, p.getAttribute('aria-pressed'), m.el.hasAttribute('data-off'), moves.length, picked.length], [[false], false, 'false', true, 0, 0], 'off: dimmed; no move, no select');
  m.setPower(true);
  assert.deepEqual([tog, m.el.hasAttribute('data-off'), p.getAttribute('aria-pressed')], [[false], false, 'true'], 'the host\'s state: no callback');
  const off = mod({ power: { on: false } }, { doc });
  assert.deepEqual([off.m.on, off.m.el.hasAttribute('data-off'), one(off.m.bar, 'cv-pow').getAttribute('aria-pressed')], [false, true, 'false']);
  const plain = mod({}, { doc });
  assert.deepEqual([one(plain.m.bar, 'cv-pow').tagName, one(plain.m.bar, 'cv-pow').hidden], ['SPAN', true], 'the reserved slot (OUT, panels)');
  plain.m.setPower(false);
  assert.equal(plain.m.el.hasAttribute('data-off'), true, 'setPower dims any module');
});

test('createModule (1e): the bar badge — made on first use after the title, before the chip; null hides it', () => {
  const doc = fresh(), { m } = mod({}, { doc });
  m.setBadge(null);
  assert.equal(byCls(m.bar, 'cv-badge').length, 0, 'no empty slot');
  m.setBadge('not connected – silent');
  assert.deepEqual(m.bar.childNodes.map(n => n.getAttribute('class')).slice(0, 5), ['cv-pow', 'cv-stripe', 'cv-ttl', 'cv-badge', 'cv-chip']);
  assert.deepEqual([one(m.bar, 'cv-badge').textContent, one(m.bar, 'cv-badge').hidden, m.badge], ['not connected – silent', false, 'not connected – silent']);
  m.setBadge('OS 4→2');
  assert.equal(m.badge, 'OS 4→2');
  m.setBadge(null);
  assert.deepEqual([one(m.bar, 'cv-badge').hidden, m.badge], [true, null]);
  const b = mod({ badge: 'OS 4→2' }, { doc });
  assert.equal(b.m.badge, 'OS 4→2', 'o.badge');
});

test('zoneLabel / zoneOf / noteName (1e): "keys: all", "keys: C3–C6 · +12" (C4 = 60), clamped and ordered', () => {
  assert.deepEqual([M.noteName(60), M.noteName(48), M.noteName(84), M.noteName(0), M.noteName(127), M.noteName(61)], ['C4', 'C3', 'C6', 'C-1', 'G9', 'C#4']);
  assert.equal(M.zoneLabel(null), 'keys: all');
  assert.equal(M.zoneLabel({ lo: 0, hi: 127, xp: 0 }), 'keys: all');
  assert.equal(M.zoneLabel({ lo: 48, hi: 84, xp: 12 }), 'keys: C3–C6 · +12');
  assert.equal(M.zoneLabel({ lo: 36, hi: 59, xp: -5 }), 'keys: C2–B3 · −5');
  assert.equal(M.zoneLabel({ xp: 7 }), 'keys: all · +7');
  assert.deepEqual(M.zoneOf({ lo: 90, hi: 30, xp: 99 }), { lo: 30, hi: 90, xp: 48 });
  assert.deepEqual(M.zoneOf({ lo: -5, hi: 300.4, xp: 'x' }), { lo: 0, hi: 127, xp: 0 });
});

test('createModule (1e): the key-zone pill on the left edge — its label; a tap opens low / high / transpose (wk number boxes, "All keys"); a step commits (onChange: one call), the pill follows; Escape / a press outside / the pill close it; setZone is the host\'s', () => {
  const doc = fresh(), got = [];
  const { m, moves } = mod({ zone: { lo: 48, hi: 84, xp: 12, onChange: z => got.push(JSON.stringify(z)) } }, { doc });
  doc.body.append(m.el);
  const pill = one(m.el, 'cv-zone');
  assert.deepEqual([pill.parentNode === m.el, pill.textContent, pill.getAttribute('aria-label'), pill.hasAttribute('data-all')], [true, 'keys: C3–C6 · +12', 'Key zone: C3–C6 · +12', false]);
  assert.deepEqual(m.el.childNodes.map(n => n.getAttribute('class')), ['cv-bar', 'cv-body', 'cv-jack', 'cv-zone']);
  ptr(pill, 'pointerdown', 5, 60, { pointerId: 3 });
  pill.click();
  const pop = one(m.el, 'cv-zpop');
  assert.ok(pop, 'the popover (no top layer here: beside the pill)');
  assert.equal(pill.getAttribute('aria-expanded'), 'true');
  const boxes = byCls(pop, 'wk-nb');
  assert.deepEqual(boxes.map(b => b.getAttribute('aria-label') + ' ' + b.getAttribute('aria-valuetext')), ['Low C3', 'High C6', 'Transpose +12']);
  key(boxes[0], 'ArrowUp');
  assert.deepEqual([got, pill.textContent], [['{"lo":49,"hi":84,"xp":12}'], 'keys: C#3–C6 · +12'], 'one step: one commit');
  key(boxes[2], 'ArrowDown');
  assert.equal(got.at(-1), '{"lo":49,"hi":84,"xp":11}');
  key(boxes[1], 'Home'); // high below low: low follows
  assert.equal(got.at(-1), '{"lo":0,"hi":0,"xp":11}');
  one(pop, 'cv-zall').click();
  assert.deepEqual([got.at(-1), pill.textContent, pill.hasAttribute('data-all'), boxes[0].getAttribute('aria-valuetext')], ['{"lo":0,"hi":127,"xp":0}', 'keys: all', true, 'C-1']);
  key(pop, 'Escape');
  assert.deepEqual([byCls(m.el, 'cv-zpop').length, pill.getAttribute('aria-expanded')], [0, 'false'], 'Escape closes');
  pill.click();
  ptr(doc.body, 'pointerdown', 900, 900, { pointerId: 4 });
  assert.equal(byCls(m.el, 'cv-zpop').length, 0, 'a press outside closes');
  pill.click(); pill.click();
  assert.equal(byCls(m.el, 'cv-zpop').length, 0, 'the pill toggles');
  m.setZone({ lo: 60, hi: 72, xp: 0 });
  assert.deepEqual([pill.textContent, m.zone, got.length], ['keys: C4–C5', { lo: 60, hi: 72, xp: 0 }, 4], 'setZone: no callback');
  assert.equal(moves.length, 0);
  assert.equal(mod({}, { doc }).m.el.childNodes.some(n => n.getAttribute('class') === 'cv-zone'), false, 'no zone: no pill');
  m.zoneOpen(); m.destroy();
  assert.equal(all(doc.body).filter(n => n.getAttribute && n.getAttribute('class') === 'cv-zpop').length, 0, 'destroy closes it');
});

/* ---------------------------------------------------------------- 1e: devices, Tidy, the device-driven view */
// a v2 track: a Juno-60 (i1, primary), a Serum (i2) and a Minimoog (i3, off, zoned) — i1 and i2 into fx1 → OUT, i3 unwired; an
// empty panel fx2
function v2t(o = {}) {
  return Object.assign({
    id: 'trk_1', name: 'Keys', color: '#3b82c4', prim: 'i1', nid: 4,
    dev: { i1: { kind: 'synth', model: 'juno60', vals: {} }, i2: { kind: 'synth', model: 'serum', vals: {} },
      i3: { kind: 'synth', model: 'minimoog', vals: {}, on: false, zone: { lo: 48, hi: 84, xp: 12 } }, fx1: { kind: 'panel' }, fx2: { kind: 'panel' }, out: { kind: 'out' } },
    wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in' }, { id: 'w2', a: 'i2.out', b: 'fx1.in' }, { id: 'w3', a: 'fx1.out', b: 'out.in' }],
  }, o);
}

test('devicesOf (1e): instruments (the primary first, then by number), each Serum\'s own FX, the panels, OUT; a v1 track: the stage-1b three', () => {
  const t = v2t({ prim: 'i3' });
  t.dev.i10 = { kind: 'synth', model: 'tb303' }; t.dev.lfo1 = { kind: 'lfo' }; // ((2b) an LFO under an id that is no 'l<n>': not a module)
  assert.deepEqual(M.devicesOf(t).map(d => d.key + ':' + d.kind + ':' + (d.model || '-') + (d.prim ? ':prim' : '') + (d.own ? ':own ' + d.own : '')),
    ['i3:inst:minimoog:prim', 'i1:inst:juno60', 'i2:inst:serum', 'i10:inst:tb303', 'i2/fx:fx:serum:own i2', 'fx1:fx:-', 'fx2:fx:-', 'out:out:-']);
  assert.equal(M.devicesOf(t)[0].dev === t.dev.i3, true, 'the device itself');
  assert.deepEqual(M.devicesOf({ model: 'serum' }).map(d => d.key + ':' + d.kind), ['i1:inst', 'i1/fx:fx', 'out:out']);
  assert.deepEqual(M.devicesOf({ prim: 'zz', dev: { i2: { kind: 'synth', model: 'dx7' }, out: { kind: 'out' } } }).map(d => d.key + (d.prim ? '*' : '')), ['i2*', 'out'], 'a stale prim: the first instrument');
});

test('tidy (1e): instruments stacked left (primary on top), a Serum\'s own FX beside it, panels in the next column, OUT right — on the dots; one instrument → panel → OUT (or a Serum → its own FX → OUT) exactly as the stage-1b Tidy', () => {
  const xy = L => Object.entries(L).map(([k, v]) => k + '@' + v.x + ',' + v.y).join(' ');
  assert.equal(xy(M.tidy(v2t(), {})), 'i1@0,0 i2@0,640 i2/fx@1376,640 i3@0,1568 fx1@2304,0 fx2@2304,512 out@3232,0');
  // measured sizes count (the widest instrument sets the next column; a row is as tall as its tallest)
  const S = { i1: { w: 1408, h: 512 }, i2: { w: 1200, h: 900 }, 'i2/fx': { w: 760, h: 1000 }, fx1: { w: 760, h: 300 } };
  assert.equal(xy(M.tidy(v2t(), S)), 'i1@0,0 i2@0,576 i2/fx@1568,576 i3@0,1664 fx1@2496,0 fx2@2496,384 out@3424,0');
  for (const L of [M.tidy(v2t(), {}), M.tidy(v2t(), S)]) assert.ok(Object.values(L).every(v => v.x % M.GAP % 32 === 0 && v.y % 32 === 0), 'on the dots');
  // canonical shapes: the stage-1b result
  const cl = { prim: 'i1', dev: { i1: { kind: 'synth', model: 'minimoog' }, fx1: { kind: 'panel' }, out: { kind: 'out' } } };
  const sx = { prim: 'i1', dev: { i1: { kind: 'synth', model: 'serum' }, out: { kind: 'out' } } };
  assert.deepEqual(M.tidy(cl, {}), M.tidy({ model: 'minimoog' }, {}));
  assert.deepEqual(M.tidy(sx, {}), M.tidy({ model: 'serum' }, {}));
  assert.deepEqual(M.tidy(cl, { i1: { w: 1003 } }), M.tidy({ model: 'minimoog' }, { i1: { w: 1003 } }), 'measured widths too');
  // an explicit device list (createTrackView's host.devices)
  assert.equal(xy(M.tidy({}, {}, [{ key: 'i9', kind: 'inst', model: 'tb303' }, { key: 'fx4', kind: 'fx' }, { key: 'out', kind: 'out' }])), 'i9@0,0 fx4@992,0 out@1920,0');
  // makeRoom / layOf for any key
  const rects = { i2: { x: 0, y: 576, w: 1400, h: 600 }, 'i2/fx': { x: 1376, y: 600, w: 760, h: 420 }, fx1: { x: 2496, y: 0, w: 760, h: 300 }, i3: { x: 0, y: 1664, w: 1184, h: 500 } };
  assert.deepEqual(M.makeRoom(rects, 'i2'), { 'i2/fx': { x: 1568, y: 600 } }, 'only what overlaps its rows moves');
  assert.deepEqual(M.layOf({ lay: { 'i2/fx': { x: 9, y: 8, fold: 1 } } }, 'i2/fx', {}), { x: 9, y: 8, fold: 1 });
  assert.deepEqual(M.layOf({ lay: {} }, 'fx2', M.tidy(v2t(), {})), { x: 2304, y: 512 });
});

// a device-driven host (IMPL-1e §4.5's shape): per-key bodies, titles, menus, sizes, power, zones, badges, cables
function dview(track, W, doc, o = {}) {
  const root = doc.createElement('div'), calls = [], bodies = [], pw = [], zn = [], sel = [], acts = [], ref = { t: track };
  doc.body.append(root);
  const host = Object.assign({
    root, doc, devices: t => M.devicesOf(t),
    bodies: { mount: (k, b) => { bodies.push('mount ' + k); b.setAttribute('data-body', k); }, unmount: k => bodies.push('unmount ' + k) },
    title: k => ({ title: k.toUpperCase(), sub: ref.t.name }),
    menu: k => [{ label: 'menu ' + k }],
    size: k => (k === 'i1' ? { fixed: { w: 1408, h: 512 } } : null),
    power: (k, on) => pw.push(k + ' ' + on), zone: (k, z) => zn.push(k + ' ' + JSON.stringify(z)),
    badge: k => (k === 'i3' && !ref.t.wires.some(w => w.a === 'i3.out') ? 'not connected – silent' : null),
    lay: (k, e, ph, what) => { calls.push([k, ph, what]); if (ph === 'end' && e) { ref.t.lay = ref.t.lay || {}; ref.t.lay[k] = e; } },
    cables: { onSelect: id => sel.push(id), onAction: (id, a) => acts.push(id + ' ' + a) },
  }, o);
  const V = M.createTrackView(W, track, host);
  return { V, root, calls, bodies, pw, zn, sel, acts, ref, sync: t => { ref.t = t; V.sync(t); } };
}
const at2 = V => [...V.modules.entries()].map(([k, m]) => k + '@' + m.x + ',' + m.y).join(' ');

test('createTrackView (1e, device-driven): one module per device (keys = device ids), bodies mounted by key, Tidy for 3 instruments + 2 panels + a Serum\'s own FX + OUT; ⏻ / zone pill / badge on instruments; the jacks inside a Serum read-only; the cables from track.wires', () => {
  const doc = fresh(), W = fakeWorld(1), t = v2t();
  const R = dview(t, W, doc);
  assert.deepEqual([...R.V.modules.keys()], ['i1', 'i2', 'i3', 'i2/fx', 'fx1', 'fx2', 'out']);
  assert.deepEqual(W.log.filter(x => x.startsWith('add')), ['add i1', 'add i2', 'add i3', 'add i2/fx', 'add fx1', 'add fx2', 'add out']);
  assert.deepEqual(R.bodies, ['mount i1', 'mount i2', 'mount i3', 'mount i2/fx', 'mount fx1', 'mount fx2', 'mount out']);
  assert.equal(R.V.modules.get('i2/fx').body.getAttribute('data-body'), 'i2/fx', 'host.bodies.mount(key, bodyEl)');
  assert.equal(at2(R.V), 'i1@0,0 i2@0,576 i3@0,1504 i2/fx@1568,576 fx1@2496,0 fx2@2496,512 out@3424,0', 'host.size(i1) (1408 × 512) counts');
  assert.deepEqual([...R.V.modules.values()].map(m => m.w), [1408, M.W_SERUM, M.FLOW_W.minimoog, M.W_FX, M.W_FX, M.W_FX, M.W_OUT]);
  assert.deepEqual([...R.V.modules.values()].map(m => m.kind), ['inst', 'inst', 'inst', 'fx', 'fx', 'fx', 'out']);
  assert.deepEqual([...R.V.modules.values()].map(m => m.cost), [600, 3700, 600, 900, 900, 900, 40]);
  assert.deepEqual(R.V.devices().map(d => d.key), [...R.V.modules.keys()]);
  // titles / menus by key
  assert.equal(R.V.modules.get('fx2').title, 'FX2');
  R.V.modules.get('fx2').openMenu(10, 10);
  assert.deepEqual(byCls(byCls(doc.body, 'wk-ctx').at(-1), 'wk-cl').map(n => n.textContent), ['menu fx2']);
  // power, zones, badge
  const pow = k => one(R.V.modules.get(k).bar, 'cv-pow');
  assert.deepEqual(['i1', 'i2', 'i3'].map(k => pow(k).tagName + ' ' + pow(k).getAttribute('aria-pressed') + ' ' + R.V.modules.get(k).el.hasAttribute('data-off')),
    ['BUTTON true false', 'BUTTON true false', 'BUTTON false true']);
  assert.deepEqual(['i2/fx', 'fx1', 'out'].map(k => pow(k).hidden), [true, true, true], 'no power on panels / OUT');
  assert.deepEqual(['i1', 'i3'].map(k => one(R.V.modules.get(k).el, 'cv-zone').textContent), ['keys: all', 'keys: C3–C6 · +12']);
  assert.equal(one(R.V.modules.get('fx1').el, 'cv-zone'), null);
  assert.deepEqual(['i1', 'i3'].map(k => R.V.modules.get(k).badge), [null, 'not connected – silent']);
  pow('i1').click();
  assert.deepEqual([R.pw, R.V.modules.get('i1').el.hasAttribute('data-off')], [['i1 false'], true], 'host.power(key, on)');
  key(one(R.V.modules.get('i3').el, 'cv-zone'), 'Enter'); one(R.V.modules.get('i3').el, 'cv-zone').click();
  key(byCls(R.V.modules.get('i3').el, 'wk-nb')[2], 'ArrowUp');
  assert.deepEqual(R.zn, ['i3 {"lo":48,"hi":84,"xp":13}'], 'host.zone(key, zone)');
  R.V.modules.get('i3').zoneClose();
  // jacks: patchable buttons; inside the Serum read-only (U12: no button there — no press, no focus, no menu)
  const J = id => { const [k, j] = [id.slice(0, id.lastIndexOf('.')), id.slice(id.lastIndexOf('.') + 1)]; return R.V.modules.get(k).jack(j); };
  assert.deepEqual(['i1.out', 'i2.out', 'i2/fx.in', 'i2/fx.out', 'fx1.in', 'out.in'].map(j => J(j).getAttribute('role') + (J(j).hasAttribute('data-ro') ? ' ro' : '') + ' ' + J(j).tabIndex),
    ['button 0', 'null ro -1', 'null ro -1', 'button 0', 'button 0', 'button 0']);
  assert.deepEqual(R.V.jacks().map(j => j.id), ['i1.out', 'i2.out', 'i3.out', 'i2/fx.in', 'i2/fx.out', 'fx1.in', 'fx1.out', 'fx2.in', 'fx2.out', 'out.in']);
  assert.deepEqual([R.V.port('i2/fx.out'), R.V.port('i2.out'), R.V.port('fx1.in')], ['i2.out', null, 'fx1.in']);
  // cables: the wires (editable) and the Serum's own route
  assert.deepEqual(R.V.cables.list().map(c => c.id + ' ' + c.a + '>' + c.b + (c.readonly ? ' ro' : '')), ['i2.out>i2/fx.in i2.out>i2/fx.in ro', 'w1 i1.out>fx1.in', 'w2 i2/fx.out>fx1.in', 'w3 fx1.out>out.in']);
  const d = all(R.root).filter(n => n.getAttribute && n.getAttribute('data-cable') === 'w2')[0].childNodes[1].getAttribute('d');
  const P = R.V.ports();
  assert.ok(d.startsWith('M ' + P.get('i2/fx.out').x + ' ' + P.get('i2/fx.out').y + ' C'), 'a Serum\'s wire leaves its own FX module');
  // selecting a module clears a selected cable
  R.V.cables.select('w1');
  W.select('fx2');
  assert.deepEqual(R.sel, ['w1', null]);
  R.V.destroy();
  assert.equal(R.bodies.filter(x => x.startsWith('unmount')).length, 7);
});

test('createTrackView.sync (1e, device-driven): diffs by key — a removed device goes (its body unmounted), an added one comes, the others stay mounted; power / cables / badges follow; a model change on the same key keeps the module, the Serum\'s own FX comes', () => {
  const doc = fresh(), W = fakeWorld(1), t = v2t();
  const R = dview(t, W, doc);
  R.bodies.length = 0; W.log.length = 0;
  const t2 = clone(t);
  delete t2.dev.fx2; t2.dev.fx3 = { kind: 'panel' }; t2.dev.i2.on = false;
  t2.wires.push({ id: 'w4', a: 'i3.out', b: 'out.in' });
  R.sync(t2);
  assert.deepEqual([...R.V.modules.keys()], ['i1', 'i2', 'i3', 'i2/fx', 'fx1', 'out', 'fx3']);
  assert.deepEqual(R.bodies, ['unmount fx2', 'mount fx3'], 'only what changed');
  assert.deepEqual(W.log.filter(x => /^(add|remove)/.test(x)), ['remove fx2', 'add fx3']);
  assert.deepEqual([R.V.modules.get('i2').el.hasAttribute('data-off'), one(R.V.modules.get('i2').bar, 'cv-pow').getAttribute('aria-pressed')], [true, 'false']);
  assert.deepEqual(R.V.cables.list().filter(c => c.dim).map(c => c.id), ['i2.out>i2/fx.in', 'w2', 'w4'], 'i2 off: its cables grey (the panel still carries i1); i3 is off too');
  assert.equal(R.V.modules.get('i3').badge, null, 'cabled now: no badge');
  // the primary Juno becomes a Serum (same key): kept, its own FX module comes, its out jack now inside it
  R.bodies.length = 0;
  const t3 = clone(t2);
  t3.dev.i1.model = 'serum';
  R.sync(t3);
  assert.deepEqual(R.bodies, ['mount i1/fx']);
  assert.deepEqual([R.V.modules.get('i1').w, R.V.modules.get('i1').cost, R.V.modules.get('i1').jack('out').hasAttribute('data-ro')], [1408, 3700, true], 'host.size wins; a Serum\'s cost; inside it now');
  assert.ok(R.V.modules.has('i1/fx'));
  // a moved module stays where it was put; Tidy for the rest is stable across syncs (no measured heights)
  R.V.modules.get('fx1').nudge(32, 0);
  const a = at2(R.V);
  R.sync(clone(R.ref.t));
  assert.equal(at2(R.V), a);
  assert.deepEqual(R.ref.t.lay.fx1, { x: R.V.modules.get('fx1').x, y: R.V.modules.get('fx1').y }, 'the move written by key');
  R.V.destroy();
});

test('createTrackView (1e): V.cableDrag — patching on the view\'s own ports, jacks and model ports (a Serum\'s from its own FX)', () => {
  const doc = fresh(), W = fakeWorld(1), t = v2t();
  const R = dview(t, W, doc), log = [];
  const D = R.V.cableDrag({ canConnect: () => ({ ok: true }), onConnect: (a, b) => log.push(a + ' ' + b), onRepatch: (w, a, b) => log.push(w + ' ' + a + ' ' + b) });
  assert.equal(typeof W.hooks.jack, 'function', 'the world\'s jack hook');
  const P = R.V.ports(), J = (k, j) => R.V.modules.get(k).jack(j);
  const go = (k, j, to) => {
    const a = P.get(k + '.' + j), b = P.get(to);
    W.hooks.jack(new Ev('pointerdown', { clientX: a.x, clientY: a.y, pointerId: 1, pointerType: 'mouse' }), J(k, j));
    ptr(doc.body, 'pointermove', a.x + 40, a.y + 40, { pointerId: 1, buttons: 1 });
    ptr(doc.body, 'pointermove', b.x + 5, b.y + 5, { pointerId: 1, buttons: 1 });
    ptr(doc.body, 'pointerup', b.x + 5, b.y + 5, { pointerId: 1 });
  };
  go('i3', 'out', 'fx2.in');
  go('i2/fx', 'out', 'out.in');
  go('fx1', 'in', 'fx2.in'); // (w2, the last cable into fx1, lifts off)
  assert.deepEqual(log, ['i3.out fx2.in', 'i2.out out.in', 'w2 i2.out fx2.in']);
  assert.equal(W.hooks.jack(new Ev('pointerdown', { pointerId: 2 }), J('i2', 'out')), false, 'inside the Serum: not taken');
  D.destroy();
  R.V.destroy();
});

test('createTrackView (1f): host.patch false without host.power / host.zone — no ⏻ (its slot hidden), no zone pill, every jack and every cable read-only (data-ro: no button, no focus, no selection); the badge stays', () => {
  const doc = fresh(), W = fakeWorld(1), t = v2t();
  const R = dview(t, W, doc, { patch: false, power: undefined, zone: undefined, badge: k => (k === 'i1' ? 'OS 4→2' : null) });
  const mods = [...R.V.modules.values()];
  assert.deepEqual(mods.filter(m => m.kind === 'inst').map(m => one(m.bar, 'cv-pow').hidden), [true, true, true], 'no ⏻');
  assert.deepEqual(mods.map(m => one(m.el, 'cv-zone') === null), mods.map(() => true), 'no pill');
  assert.deepEqual(mods.map(m => m.zoneW), mods.map(() => 0));
  assert.deepEqual(R.V.jacks().map(j => (j.el.getAttribute('role') || '-') + (j.el.hasAttribute('data-ro') ? ' ro' : '') + ' ' + j.el.tabIndex), R.V.jacks().map(() => '- ro -1'));
  assert.deepEqual(R.V.cables.list().map(c => !!c.readonly), R.V.cables.list().map(() => true));
  assert.deepEqual(all(R.root).filter(n => n.getAttribute && n.getAttribute('data-cable') != null).map(n => n.hasAttribute('data-ro')), R.V.cables.list().map(() => true));
  R.V.cables.select('w1');
  assert.deepEqual([R.V.cables.selected(), R.sel.length], [null, 0], 'a read-only cable is never selected');
  assert.deepEqual([R.V.modules.get('i1').badge, R.V.modules.get('i2').badge], ['OS 4→2', null]);
  R.sync(clone(t));
  assert.deepEqual(R.V.cables.list().map(c => !!c.readonly), R.V.cables.list().map(() => true), 'after a sync too');
  R.V.destroy();
});

/* ---------------------------------------------------------------- UI fixes (stage 1e review, fixer U) */
test('layOf (U1): the other FX key is no fallback while it is a module of its own (a Serum primary\'s i1/fx beside a shared panel fx1)', () => {
  const td = { 'i1/fx': { x: 1400, y: 0 }, fx1: { x: 2900, y: 0 } };
  const tr = { model: 'serum', lay: { fx1: { x: 3, y: 4 } } };
  assert.deepEqual(M.layOf(tr, 'i1/fx', td, ['i1', 'i2', 'i1/fx', 'fx1', 'out']), { x: 1400, y: 0 }, 'its own Tidy place, not fx1\'s entry');
  assert.deepEqual(M.layOf(tr, 'i1/fx', td, ['i1', 'i1/fx', 'out']), { x: 3, y: 4 }, 'fx1 gone (a model change): its place carried over');
  assert.deepEqual(M.layOf(tr, 'i1/fx', td), { x: 3, y: 4 }, 'no keys: as before');
});

test('⏻ (U5): a zoom-scaled hit area through ::before — 44 screen px at any zoom, growing left and up from the button only (never over the stripe / title, nor down into the panel); folded, it stops at the bar\'s edge (the zone pill beside it)', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const sec = css.slice(css.indexOf('/* ===================================================================== cv-module')).replace(/\/\*[\s\S]*?\*\//g, '');
  const r = /\.cv-bar > button\.cv-pow::before \{([^}]*)\}/.exec(sec);
  assert.ok(r, 'the rule');
  assert.match(r[1], /width: max\(100%, calc\(44px \* var\(--ik, 1\)\)\)/);
  assert.match(r[1], /height: max\(100%, calc\(44px \* var\(--ik, 1\)\)\)/);
  assert.match(r[1], /right: 0;/, 'its right edge the button\'s: never over the stripe');
  assert.match(r[1], /bottom: 0;/, 'its bottom the button\'s: never into the panel');
  assert.match(sec, /\.cv-mod\[data-cv-fold\] > \.cv-bar > button\.cv-pow::before \{[^}]*width: calc\(100% \+ 4px\)/, 'folded: to the bar\'s edge');
});

/* ---------------------------------------------------------------- stage 2a: modulator modules (IMPL-2a §3) */

test('devicesOf / tidy / kindW / layOf (2a): a track\'s Velocity, Aftertouch, Bend after the rest (kind \'mod\'); Tidy stacks the modulators in a column left of the instruments (the host\'s wheel first, then ve, at, bd), nothing else moves', () => {
  const t = v2t();
  t.dev.bd = { kind: 'bend' }; t.dev.ve = { kind: 'velo' }; t.dev.at = { kind: 'at' };
  assert.deepEqual(M.devicesOf(t).slice(-3).map(d => d.key + ':' + d.kind + ':' + d.mod + ':' + (d.dev === t.dev[d.key])), ['ve:mod:velo:true', 'at:mod:at:true', 'bd:mod:bend:true']);
  assert.deepEqual(M.devicesOf(v2t()).map(d => d.kind).includes('mod'), false, 'none without them');
  assert.deepEqual([M.W_MOD, [M.MOD_H.wheel, M.MOD_H.velo, M.MOD_H.at, M.MOD_H.bend], M.MOD_ORDER.slice(0, 4), M.kindW('mod'), ['wheel', 've', 'at', 'bd', 'i1'].map(M.modKind)],
    [240, [224, 192, 128, 128], ['wheel', 'velo', 'at', 'bend'], 240, ['wheel', 'velo', 'at', 'bend', null]]); // ((2b) the other kinds follow: the 2b test)
  const xy = L => Object.entries(L).map(([k, v]) => k + '@' + v.x + ',' + v.y).join(' ');
  const base = xy(M.tidy(v2t(), {}));
  assert.equal(xy(M.tidy(t, {})), base + ' ve@-320,0 at@-320,256 bd@-320,448', 'a column left of the instruments, VGAP apart, on the dots');
  const devs = [{ key: 'wheel', kind: 'mod', mod: 'wheel' }, ...M.devicesOf(t)];
  const L = M.tidy(t, {}, devs.reverse());
  assert.equal(xy(L).split(' ').filter(s => /^(wheel|ve|at|bd)@/.test(s)).join(' '), 'wheel@-320,0 ve@-320,288 at@-320,544 bd@-320,736', 'the wheel first, whatever the list order');
  assert.ok(Object.values(L).every(v => v.x % 32 === 0 && v.y % 32 === 0), 'on the dots');
  assert.equal(xy(M.tidy(t, { ve: { w: 240, h: 300 } }, devs)).split(' ').find(s => s.startsWith('at@')), 'at@-320,672', 'a measured height counts');
  assert.deepEqual([M.layOf({ lay: { wheel: { x: 64, y: -96, fold: 1 } } }, 'wheel', L), M.layOf({ lay: {} }, 'bd', L), M.layOf({}, 've', L), M.layOf({}, 'at', {})],
    [{ x: 64, y: -96, fold: 1 }, { x: -320, y: 736 }, { x: -320, y: 288 }, { x: 0, y: 0 }], 'layOf keys wheel / ve / at / bd');
});

// a 2a host: the project wheel added to the devices, knobs in the Serum's body and its own FX, the project
function mview(o = {}) {
  const doc = fresh(), W = fakeWorld(1), t = v2t();
  t.dev.ve = { kind: 'velo' }; t.dev.bd = { kind: 'bend', color: '#abcdef' };
  t.dev.i2.vals = { s: { matrix: [{ src: 'velo', dst: 'a.pan', amt: 0.3 }] } };
  t.mods = [{ id: 'r1', src: 'wheel', dst: 'i2:a.semi', amt: 0.5 }, { id: 'r2', src: 've.out', dst: 'i2:fx.r1.mix', amt: -0.25, bi: 1 }, { id: 'r3', src: 'bd.out', dst: 'i2:zz.none' }];
  const K = {}, mounted = [];
  const knob = (b, dev, id) => { const p = doc.createElement('div'); p.setAttribute('data-dev', dev); const k = doc.createElement('div'); k.setAttribute('data-dest', id); p.append(k); b.append(p); K[id] = k; return k; };
  const R = dview(t, W, doc, Object.assign({
    devices: tt => [...M.devicesOf(tt), { key: 'wheel', kind: 'mod', mod: 'wheel' }],
    bodies: { mount: (k, b) => { mounted.push('mount ' + k); b.setAttribute('data-body', k); if (k === 'i2') { knob(b, 'i2', 'a.semi'); knob(b, 'i2', 'a.pan'); } if (k === 'i2/fx') knob(b, 'i2', 'fx.r1.mix'); }, unmount() {} },
    project: () => ({ perf: { wheel: { v: 1 } } }), presetRows: true,
  }, o));
  return Object.assign(R, { doc, W, t, K, mounted });
}

test('createTrackView (2a): modulator modules — kind \'mod\', W_MOD × MOD_H, one right mod-out jack (a patchable button), cost 40, the mod colour (else dev.color), placed by Tidy left of the instruments; ports() / jacks() carry them; the mod cables (track.mods + the preset rows) from cablesOf with the host\'s project', () => {
  const R = mview(), V = R.V, m = k => V.modules.get(k);
  assert.deepEqual(['wheel', 've', 'bd'].map(k => [m(k).kind, m(k).el.getAttribute('data-cv-kind'), m(k).w, m(k).rect().h, m(k).cost, m(k).jackIds().join()]),
    [['mod', 'mod', 240, 224, 40], ['mod', 'mod', 240, 192, 40], ['mod', 'mod', 240, 128, 40]].map(a => a.concat('out')));
  assert.deepEqual(['wheel', 've', 'bd'].map(k => m(k).el.style['--mc']), [CB.MOD_COLOR.wheel, CB.MOD_COLOR.velo, '#abcdef']);
  const j = m('wheel').jack('out');
  assert.deepEqual([j.getAttribute('data-kind'), j.getAttribute('data-side'), j.getAttribute('role'), j.tabIndex, j.hasAttribute('data-ro'), j.getAttribute('aria-label')], ['mod', 'right', 'button', 0, false, 'WHEEL out']);
  assert.deepEqual(['wheel', 've', 'bd'].map(k => m(k).x + ',' + m(k).y), ['-320,0', '-320,288', '-320,544'], 'the modulator column');
  assert.deepEqual([m('i1').x, m('i1').y], [0, 0], 'the instruments where they were');
  assert.deepEqual(V.ports().get('wheel.out'), { x: -320 + 240, y: 68 });
  assert.deepEqual(V.jacks().filter(J => J.mod === 'wheel' || J.mod === 'i1').map(J => J.id + ':' + J.dir + ':' + J.kind), ['i1.out:out:audio', 'wheel.out:out:mod']);
  assert.deepEqual(V.cables.list().filter(c => c.kind === 'mod').map(c => c.id + ' ' + c.a + ' ' + c.b + (c.preset ? ' preset' : '')),
    ['r1 wheel.out i2:a.semi', 'r2 ve.out i2:fx.r1.mix', 'r3 bd.out i2:zz.none', 'p:i2:0 ve.out i2:a.pan preset']);
  assert.deepEqual(R.mounted.filter(b => /wheel|ve|bd/.test(b)), ['mount ve', 'mount bd', 'mount wheel'], 'bodies by key (the host\'s cv-mods-ui)');
  // sync: a removed modulator goes, its body unmounted
  const t2 = clone(R.t); delete t2.dev.bd;
  R.sync(t2);
  assert.deepEqual([V.modules.has('bd'), V.modules.has('ve')], [false, true]);
  V.destroy();
});

test('createTrackView (2a): knob end points — destPort from the [data-dest] centre in module px (the module\'s screen rect at any zoom), cached: one rect read until a fold, a size change (ResizeObserver), sync / refresh or remeasure; ports() holds them under \'<dev>:<param>\'; a knob not on the panel: the module\'s bar; host.destPort wins', () => {
  const ROs = [];
  globalThis.ResizeObserver = class { constructor(cb) { ROs.push(cb); } observe() {} disconnect() {} };
  try {
    const R = mview(), V = R.V, sx = V.modules.get('i2'), fx = V.modules.get('i2/fx'), X = sx.x, Y = sx.y;
    // the Serum on screen at half size: 1200 world px → 600 client px from (100, 200); the knob 20 px wide around (250, 280)
    place(sx.el, 100, 200, 600, 400); place(R.K['a.semi'], 240, 270, 20, 20);
    place(fx.el, 800, 200, 380, 300); place(R.K['fx.r1.mix'], 840, 240, 10, 10);
    let reads = 0;
    const gb = R.K['a.semi'].getBoundingClientRect.bind(R.K['a.semi']);
    R.K['a.semi'].getBoundingClientRect = () => { reads++; return gb(); };
    V.remeasure();
    assert.deepEqual([V.destPort('i2', 'a.semi'), reads], [{ x: X + 300, y: Y + 160 }, 1], '(250 − 100) / ½ = 300; (280 − 200) / ½ = 160');
    assert.deepEqual(V.ports().get('i2:a.semi'), { x: X + 300, y: Y + 160 });
    assert.deepEqual(V.ports().get('i2:fx.r1.mix'), { x: fx.x + 90, y: fx.y + 90 }, 'a Serum\'s own FX knob: in its FX module (the same [data-dev])');
    for (let i = 0; i < 5; i++) V.ports();
    sx.setPos(X + 64, Y, true); // (a live move: the offset rides along)
    assert.deepEqual([V.destPort('i2', 'a.semi'), reads], [{ x: X + 364, y: Y + 160 }, 1], 'never measured again per frame');
    sx.setPos(X, Y);
    // a size change (the module's ResizeObserver) → measured again once
    layout(sx.el, 1200, 900);
    ROs.forEach(f => f());
    V.ports(); V.ports();
    assert.equal(reads, 2, 'after a size change');
    // fold: the module's bar (left end); unfold: measured again
    V.toggleFold('i2');
    assert.deepEqual(V.destPort('i2', 'a.semi'), { x: X, y: Y + 20 }, 'folded: its bar');
    V.toggleFold('i2');
    V.destPort('i2', 'a.semi');
    assert.equal(reads, 3);
    R.V.refresh(R.ref.t); V.destPort('i2', 'a.semi');
    R.sync(clone(R.ref.t)); V.destPort('i2', 'a.semi');
    V.remeasure('i2'); V.destPort('i2', 'a.semi');
    V.remeasure('fx1'); V.destPort('i2', 'a.semi');
    assert.equal(reads, 6, 'refresh, sync, remeasure(i2) measure again; another module\'s remeasure does not');
    // a hidden knob (a page not shown: an empty rect) → the bar; one not on the panel → the bar ('fx.' params: the own FX's)
    place(R.K['a.semi'], 0, 0, 0, 0); V.remeasure('i2');
    assert.deepEqual(V.destPort('i2', 'a.semi'), { x: X, y: Y + 20 });
    assert.deepEqual([V.destPort('i2', 'zz.none'), V.destPort('i2', 'fx.r9.x'), V.destPort('nope', 'a.semi')], [{ x: X, y: Y + 20 }, { x: fx.x, y: fx.y + 20 }, null]);
    // a body re-rendered (the knob detached): indexed again
    const k2 = R.doc.createElement('div'); k2.setAttribute('data-dest', 'a.semi'); R.K['a.semi'].parentNode.append(k2); R.K['a.semi'].remove();
    place(k2, 340, 370, 20, 20);
    assert.deepEqual(V.destPort('i2', 'a.semi'), { x: X + 500, y: Y + 360 }, 'the new element');
    V.destroy();
    const R2 = mview({ destPort: (dev, id) => (id === 'a.semi' ? { x: 1, y: 2 } : null) });
    assert.deepEqual([R2.V.destPort('i2', 'a.semi'), R2.V.ports().get('i2:a.semi')], [{ x: 1, y: 2 }, { x: 1, y: 2 }], 'host.destPort first');
    R2.V.destroy();
  } finally { delete globalThis.ResizeObserver; }
});

test('createTrackView (2a): host.patch false keeps the audio read-only but the mod-out jacks and the mod cables editable; a module\'s selection raises the mod cables ending on its knobs (a Serum\'s own FX: its fx. knobs); visibility through V.setModsVisible / host.mods; a zoom\'s end re-cuts the ends; V.cableDrag drags from a mod jack', () => {
  const R = mview({ patch: false, mods: 'select' }), V = R.V;
  assert.deepEqual([V.jacks().filter(J => J.kind === 'mod').map(J => J.el.getAttribute('role') + ' ' + J.el.hasAttribute('data-ro')), V.jacks().find(J => J.id === 'i1.out').el.hasAttribute('data-ro')],
    [['button false', 'button false', 'button false'], true]);
  assert.deepEqual(V.cables.list().map(c => c.kind + ':' + !!c.readonly).filter((x, i, a) => a.indexOf(x) === i), ['audio:true', 'mod:false']);
  assert.equal(V.cables.modsVisible(), 'select', 'host.mods: the starting mode');
  R.W.select('i2');
  const raised = () => V.cables.list().filter(c => c.kind === 'mod').filter(c => all(R.root).some(n => n.getAttribute && n.getAttribute('data-cable') === c.id && n.classList.contains('cv-hl'))).map(c => c.id);
  assert.deepEqual(raised(), ['r1', 'r2', 'r3', 'p:i2:0'], 'the Serum: every knob of it');
  R.W.select('i2/fx');
  assert.deepEqual(raised(), ['r2']);
  R.W.select('wheel');
  assert.deepEqual(raised(), ['r1']);
  assert.equal(V.setModsVisible('never'), 'never');
  assert.equal(V.cables.modsVisible(), 'never');
  // the ends follow a zoom's end (the world's k)
  V.setModsVisible('always');
  const P = V.ports(), endD = () => all(V.cables.over).find(n => n.getAttribute && n.getAttribute('data-cable') === 'r1').childNodes[0].getAttribute('d');
  assert.ok(P.get('i2:a.semi'), 'the knob end');
  const d1 = endD();
  R.W.k = 2; R.W.emit('cameraend', { zoomed: true });
  assert.notEqual(endD(), d1, 'cut again at k 2');
  // a mod drag through the view's cableDrag (its jacks, ports, cables)
  const log = [];
  R.W.el = R.root; // (the world's element holds the modules)
  R.doc.elementFromPoint = () => R.K['a.semi'];
  const D = V.cableDrag({ canConnect: () => ({ ok: true }), onConnect: (a, b) => log.push(a + ' ' + b), onRepatch() {}, markDests: () => [{ dev: 'i2', ids: ['a.semi'] }] });
  const wj = V.modules.get('wheel').jack('out');
  assert.equal(typeof R.W.hooks.jack(new Ev('pointerdown', { clientX: 0, clientY: 0, pointerId: 1, pointerType: 'mouse' }), wj), 'object');
  ptr(R.doc.body, 'pointermove', 50, 50, { pointerId: 1, buttons: 1 });
  assert.equal(R.K['a.semi'].getAttribute('class'), 'cv-ok cv-hot');
  ptr(R.doc.body, 'pointerup', 50, 50, { pointerId: 1 });
  assert.deepEqual(log, ['wheel i2:a.semi']);
  D.destroy();
  V.destroy();
  assert.equal(all(R.root).filter(n => n.getAttribute && /cv-mbadge/.test(n.getAttribute('class') || '')).length, 0, 'the badges go with the view');
});

// UI fixes
test('(U1) a knob with hidden twins (a Serum keeps its other pages in the DOM: 0 × 0): the shown one is the end, whichever comes first; a page switch (remeasure) moves it; an end parked on the bar because none was shown is tried again on the next lookup — never during a live move', () => {
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  try {
    const R = mview(), V = R.V, sx = V.modules.get('i2'), X = sx.x, Y = sx.y, K = R.K['a.semi'];
    place(sx.el, 100, 200, 600, 400); place(K, 240, 270, 20, 20);
    // a hidden page before the knob's own (the old index kept the first it met: the 0 × 0 twin) and one after it
    const twin = before => {
      const pg = R.doc.createElement('div'), tw = R.doc.createElement('div');
      pg.setAttribute('data-dev', 'i2'); tw.setAttribute('data-dest', 'a.semi'); pg.append(tw);
      const host = K.parentNode.parentNode;
      if (before) host.insertBefore(pg, K.parentNode); else host.append(pg);
      place(tw, 0, 0, 0, 0);
      return tw;
    };
    const tw = twin(true), tw2 = twin(false);
    V.remeasure();
    assert.deepEqual(V.destPort('i2', 'a.semi'), { x: X + 300, y: Y + 160 }, 'the shown knob, not a hidden twin');
    // a page switch: the knob's page hidden, a twin's shown → remeasure → the twin
    place(K, 0, 0, 0, 0); place(tw2, 340, 370, 20, 20); V.remeasure('i2');
    assert.deepEqual(V.destPort('i2', 'a.semi'), { x: X + 500, y: Y + 360 });
    place(tw2, 0, 0, 0, 0); place(tw, 140, 170, 20, 20); V.remeasure('i2');
    assert.deepEqual(V.destPort('i2', 'a.semi'), { x: X + 100, y: Y - 40 });
    // every page hidden: the bar; shown again (no remeasure): tried again on the next lookup
    place(tw, 0, 0, 0, 0); V.remeasure('i2');
    assert.deepEqual(V.destPort('i2', 'a.semi'), { x: X, y: Y + 20 }, 'none shown: the bar');
    place(K, 240, 270, 20, 20);
    let reads = 0;
    const gb = K.getBoundingClientRect.bind(K);
    K.getBoundingClientRect = () => { reads++; return gb(); };
    // (a live move of the module by its bar: the cached end, no rect read per frame)
    ptr(sx.bar, 'pointerdown', 500, 300, { pointerId: 1, pointerType: 'mouse' });
    ptr(sx.bar, 'pointermove', 541, 311, { pointerId: 1, pointerType: 'mouse', buttons: 1 });
    ptr(sx.bar, 'pointermove', 581, 321, { pointerId: 1, pointerType: 'mouse', buttons: 1 });
    assert.equal(reads, 0, 'not re-read during the live move');
    ptr(sx.bar, 'pointerup', 581, 321, { pointerId: 1, pointerType: 'mouse' });
    assert.deepEqual(V.destPort('i2', 'a.semi'), { x: sx.x + 300, y: sx.y + 160 }, 'shown again: its centre');
    const n = reads;
    V.destPort('i2', 'a.semi'); V.ports();
    assert.deepEqual([n > 0, reads], [true, n], 'measured once: cached again');
    V.destroy();
  } finally { delete globalThis.ResizeObserver; }
});

test('(U4) a mod cable\'s amount badge (and what it holds) is background: the canvas pans from it (its tap selects: cv-cables); another button is not', () => {
  const R = mview(), V = R.V, b = V.cables.badge('r1');
  assert.ok(b, 'the badge');
  const span = b.childNodes[0], btn = R.doc.createElement('button');
  R.root.append(btn);
  assert.deepEqual([M.isBackground(b), M.isBackground(span), M.isBackground(btn)], [true, true, false]);
  V.destroy();
});

test('(U8) the modulator column stands W_MOD + MOD_GAP (80) left of the instruments: x −320 — a fit with the Sources tray open at 1024 × 1366 keeps the modulators beside the instrument', () => {
  const t = v2t();
  t.dev.ve = { kind: 'velo' };
  assert.deepEqual([M.MOD_GAP, M.tidy(t, {}).ve], [80, { x: -320, y: 0 }]);
  assert.equal((M.W_MOD + M.MOD_GAP) % 32, 0, 'on the dots');
});

/* ---------------------------------------------------------------- stage 2b (IMPL-2b §6.1): every mod kind, the macro's jacks */
test('devicesOf / MOD_KINDS / mkOf / modJacks / modJackY / MOD_H (2b): every kind of MOD_KINDS in Tidy order (the singletons, then lfo…, env…, macro…, cc…, chaos… by number); a macro\'s k1…k8 at its knob rows; Tidy stacks them by MOD_H', () => {
  const t = v2t();
  Object.assign(t.dev, { h1: { kind: 'chaos' }, l2: { kind: 'lfo' }, l10: { kind: 'lfo' }, l1: { kind: 'lfo' }, m1: { kind: 'macro' }, c1: { kind: 'cc' }, e1: { kind: 'env' }, nt: { kind: 'note' }, bd: { kind: 'bend' }, zz: { kind: 'nope' } });
  assert.deepEqual(M.devicesOf(t).filter(d => d.kind === 'mod').map(d => d.key + ':' + d.mod), ['bd:bend', 'nt:note', 'l1:lfo', 'l2:lfo', 'l10:lfo', 'e1:env', 'm1:macro', 'c1:cc', 'h1:chaos'], 'an unknown kind is no module');
  assert.deepEqual([[...M.MOD_KINDS], M.MOD_ORDER, Object.keys(M.MOD_H), ['m3', 'nt', 'x9', 'l', 'wheel', 'i1'].map(M.mkOf)],
    [['velo', 'at', 'bend', 'note', 'lfo', 'env', 'macro', 'cc', 'chaos'], ['wheel', 'velo', 'at', 'bend', 'note', 'lfo', 'env', 'macro', 'cc', 'chaos'],
      ['wheel', 'velo', 'at', 'bend', 'note', 'lfo', 'env', 'macro', 'cc', 'chaos'], ['macro', 'note', null, null, 'wheel', null]]);
  assert.deepEqual([M.MOD_H.lfo, M.MOD_H.env, M.MOD_H.macro, M.MOD_H.cc, M.MOD_H.chaos, M.MOD_H.note, M.MACRO_ROW, M.MACRO_Y0], [256, 224, 288, 160, 224, 160, 28, 52]);
  // (milestone 3) inline: each name tile of the Serum MACROS panel is its jack; the y is the fallback (a 2b body: the right edge)
  assert.deepEqual(M.modJacks('macro', 'Macro').map(j => j.id + '@' + j.y + ':' + j.side + ':' + j.kind + ':' + j.label), ['k1@66', 'k2@94', 'k3@122', 'k4@150', 'k5@178', 'k6@206', 'k7@234', 'k8@262'].map((s, i) => s + ':inline:mod:Macro knob ' + (i + 1)));
  assert.deepEqual([M.modJacks('lfo', 'LFO 1').map(j => j.id + ':' + j.label + ':' + j.y), M.modJackY('macro', 7), M.modJackY('lfo', 0), M.modJackY('env', 3)], [['out:LFO 1 out:undefined'], 262, 68, 68]);
  assert.ok(M.MOD_H.macro >= M.modJackY('macro', 7) + 14, 'the last jack inside the module');
  const xy = L => Object.entries(L).filter(([k]) => /^(bd|nt|l1|l2|l10|e1|m1|c1|h1)$/.test(k)).map(([k, v]) => k + '@' + v.x + ',' + v.y).join(' ');
  // (milestone 3 §2.2) the column grows leftwards: each x = −⌈(MOD_W + MOD_GAP) / 32⌉·32 (LFO / chaos 416, ENV 320, Macro 256)
  assert.equal(xy(M.tidy(t, {})), 'bd@-320,0 nt@-320,192 l1@-512,416 l2@-512,736 l10@-512,1056 e1@-416,1376 m1@-352,1664 c1@-320,2016 h1@-512,2240', 'MOD_H + VGAP, on the dots, by MOD_ORDER then number');
});

test('createTrackView (2b): a macro module carries jacks k1…k8 at its knob rows (ports() and jacks() hold each; a cable from \'m1.k3\' leaves there), folded all at the bar\'s middle outside the edge; an LFO one out jack; the cables coloured by the source kind', () => {
  const doc = fresh(), W = fakeWorld(1), t = v2t();
  t.dev.m1 = { kind: 'macro', v: [0, 0, 0, 0, 0, 0, 0, 0], names: [] }; t.dev.l1 = { kind: 'lfo' }; t.dev.ve = { kind: 'velo' };
  t.mods = [{ id: 'r9', src: 'm1.k3', dst: 'i2:a.semi', amt: 0.5 }, { id: 'r8', src: 'l1.out', dst: 'i2:a.pan', amt: 0.2 }];
  const R = dview(t, W, doc, { bodies: { mount: (k, b) => { if (k === 'i2') { const p = doc.createElement('div'); p.setAttribute('data-dev', 'i2'); const q = doc.createElement('div'); q.setAttribute('data-dest', 'a.semi'); p.append(q); b.append(p); } }, unmount() {} } });
  const V = R.V, m = V.modules.get('m1'), l = V.modules.get('l1');
  // (milestone 3) a Serum-faithful modulator: MOD_W wide (Macro 256, LFO 416), its height its content's (measured)
  layout(m.el, 256, 300); layout(l.el, 416, 330);
  assert.deepEqual([m.kind, m.w, m.rect().h, m.jackIds().join(), l.jackIds().join(), l.rect().h], ['mod', 256, 300, 'k1,k2,k3,k4,k5,k6,k7,k8', 'out', 330]);
  assert.deepEqual([m.port('k1'), m.port('k3'), m.port('k8'), l.port('out')], [{ x: 256, y: 66 }, { x: 256, y: 122 }, { x: 256, y: 262 }, { x: 416, y: 68 }], 'no tiles (a 2b body): the right edge at the knob rows');
  assert.deepEqual([m.jack('k3').style.top, m.jack('k3').getAttribute('data-cv-jack'), m.jack('k3').getAttribute('data-kind'), m.jack('k3').getAttribute('role'), m.jack('k3').getAttribute('aria-label')], ['122px', 'm1.k3', 'mod', 'button', 'M1 knob 3']);
  const P = V.ports();
  assert.deepEqual([P.get('m1.k3'), P.get('m1.k8'), P.get('l1.out')], [{ x: m.x + 256, y: m.y + 122 }, { x: m.x + 256, y: m.y + 262 }, { x: l.x + 416, y: l.y + 68 }]);
  assert.deepEqual(V.jacks().filter(J => J.mod === 'm1').map(J => J.id + ':' + J.dir + ':' + J.kind).slice(0, 3), ['m1.k1:out:mod', 'm1.k2:out:mod', 'm1.k3:out:mod']);
  assert.deepEqual(V.cables.list().filter(c => c.kind === 'mod').map(c => c.id + ' ' + c.a + ' ' + c.b + ' ' + c.color), ['r9 m1.k3 i2:a.semi ' + CB.MOD_COLOR.macro, 'r8 l1.out i2:a.pan ' + CB.MOD_COLOR.lfo]);
  assert.deepEqual([m.el.style['--mc'], l.el.style['--mc']], [CB.MOD_COLOR.macro, CB.MOD_COLOR.lfo]);
  V.toggleFold('m1');
  assert.deepEqual([m.port('k1'), m.port('k8'), m.jack('k8').style.top], [{ x: 256 + M.JACK_OUT, y: 20 }, { x: 256 + M.JACK_OUT, y: 20 }, '20px'], 'folded: the bar\'s middle, outside the edge');
  V.toggleFold('m1');
  assert.deepEqual(m.port('k8'), { x: 256, y: 262 });
  V.destroy();
});

/* ---------------------------------------------------------------- milestone 3 (IMPL-3 §2.1–2.2, §2.5, §2.7): Serum parts */
test('milestone 3: MOD_W by kind (the Serum panels\' widths rounded to the dots), modX (right edges ≤ −MOD_GAP), PART_W_DEF, partJacks / voiceJacks', () => {
  assert.deepEqual([M.MOD_W.lfo, M.MOD_W.env, M.MOD_W.macro, M.MOD_W.chaos, M.MOD_W.velo, M.MOD_W.cc], [416, 320, 256, 416, 240, 240]);
  assert.deepEqual([393, 314, 236, 388, 209, 257].map(M.roundW), [416, 320, 256, 416, 224, 288], 'PART_W (lane B, measured from the 1200 px panel) → the module widths');
  assert.deepEqual([...M.SX_MODS], ['lfo', 'env', 'macro', 'chaos']);
  for (const k of M.MOD_ORDER) {
    const x = M.modX(k);
    assert.ok(x % 32 === 0 && x + M.modW(k) <= -M.MOD_GAP && x + M.modW(k) > -M.MOD_GAP - 32, k + ' at ' + x + ': its right edge just left of −MOD_GAP');
  }
  assert.deepEqual([M.modX('lfo'), M.modX('env'), M.modX('macro'), M.modX('velo'), M.modX('nope')], [-512, -416, -352, -320, -320]);
  const J = p => M.partJacks(p).map(j => j.id + ':' + j.side + ':' + j.kind).join(' ');
  assert.equal(J('oscB'), 'out:right:audio warp:left:warp');
  assert.equal(J('noise'), 'out:right:audio');
  assert.equal(J('filter2'), 'in:left:audio out:right:audio');
  assert.equal(J('lfo7'), 'out:right:mod');
  assert.equal(J('env3'), 'out:right:mod');
  assert.equal(J('macros'), 'k1:inline:mod k2:inline:mod k3:inline:mod k4:inline:mod k5:inline:mod k6:inline:mod k7:inline:mod k8:inline:mod');
  assert.equal(J('arp'), 'out:right:note');
  assert.equal(M.voiceJacks().map(j => j.id + ':' + j.side + ':' + j.kind).join(' '), 'main:left:audio direct:left:audio note:left:note env1:inline:mod out:right:audio');
  assert.equal(M.partJacks('oscA')[0].label, 'OSC A out');
});

test('milestone 3 tidy (§2.7): a Serum in parts view left to right — modulators (growing left) → note tools → sources → filters → VOICE (own ENV / LFO / MACROS stacked above it) → own FX → OUT, on the dots', () => {
  const P = (part) => ({ key: 'i1/' + part, kind: 'part', dev: 'i1', part, model: 'serum' });
  const devs = [{ key: 'i1', kind: 'inst', model: 'serum' }, P('oscB'), P('oscA'), P('filter'), P('lfo1'), P('macros'), P('arp'),
    { key: 'i1/fx', kind: 'fx', model: 'serum', own: 'i1' }, { key: 'out', kind: 'out' }, { key: 'l1', kind: 'mod', mod: 'lfo' }, { key: 've', kind: 'mod', mod: 'velo' }];
  const L = M.tidy({}, {}, devs), xy = k => L[k].x + ',' + L[k].y;
  assert.deepEqual(['i1/arp', 'i1/oscA', 'i1/oscB', 'i1/filter', 'i1', 'i1/macros', 'i1/lfo1', 'i1/fx', 'out', 've', 'l1'].map(xy),
    ['0,0', '640,0', '640,448', '1088,0', '1472,0', '1472,-288', '1472,-672', '2080,0', '3008,0', '-320,0', '-512,256']);
  assert.ok(Object.values(L).every(v => v.x % 32 === 0 && v.y % 32 === 0), 'on the dots');
  // measured sizes count; a Serum with no note tools starts with its sources
  const L2 = M.tidy({}, { 'i1/oscA': { w: 300, h: 500 }, i1: { w: 480, h: 700 } }, devs.filter(d => d.key !== 'i1/arp'));
  assert.deepEqual(['i1/oscA', 'i1/oscB', 'i1/filter', 'i1'].map(k => L2[k].x + ',' + L2[k].y), ['0,0', '0,576', '480,0', '864,0']);
});

// a parts-view host: a Serum i1 shown as parts (lay.i1.ui = 'parts'), its parts from the host's devices, a powerEl per part
function pview(o = {}) {
  const doc = fresh(), W = fakeWorld(1);
  const s = core.normalizeSerum(core.defaultSerum());
  Object.assign(s.p, { 'a.on': 1, 'b.on': 0, 'c.on': 1, 'f.on': 1, 'f.routeC': 0, 'f2.routeC': 0 });
  s.osc[0].route = 0; s.osc[1].route = 1; s.osc[2].route = 0; // (A → Filter 1; B → Main (off: dimmed); C → Filter, lit nowhere: a stub)
  for (const r of s.matrix) Object.assign(r, { src: '', aux: '', dst: '' });
  s.matrix[0] = Object.assign(s.matrix[0], { src: 'lfo1', dst: 'a.wt', amt: 0.5 });
  const t = { id: 'trk_9', name: 'Lead', color: '#3b82c4', prim: 'i1', nid: 3, lay: { i1: { x: 1472, y: 0, ui: 'parts' } },
    dev: { i1: { kind: 'synth', model: 'serum', color: '#ff00aa', vals: { s } }, out: { kind: 'out' }, l1: { kind: 'lfo' } },
    wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }],
    mods: [{ id: 'r1', src: 'l1.out', dst: 'i1:b.level', amt: 0.4 }, { id: 'r2', src: 'i1/lfo1.out', dst: 'i1:a.pan', amt: 0.3 }] };
  const parts = ['oscA', 'oscB', 'oscC', 'filter', 'lfo1', 'macros'];
  const PW = {}, K = {}, tiles = [];
  const R = dview(t, W, doc, Object.assign({
    devices: tt => { const L = M.devicesOf(tt); return tt.lay && tt.lay.i1 && tt.lay.i1.ui === 'parts' ? L.concat(parts.map(p => ({ key: 'i1/' + p, kind: 'part', dev: 'i1', part: p, model: 'serum' }))) : L; },
    title: k => (/\//.test(k) && k !== 'i1/fx' ? {} : { title: k.toUpperCase() }), size: () => null,
    powerEl: k => { if (!PW[k]) { const b = doc.createElement('button'); b.setAttribute('data-dest', ({ 'i1/oscA': 'a.on', 'i1/oscB': 'b.on', 'i1/oscC': 'c.on', 'i1/filter': 'f.on' })[k] || 'x'); b.setAttribute('data-dev', 'i1'); PW[k] = b; } return /osc|filter/.test(k) ? PW[k] : null; },
    bodies: { mount: (k, b) => {
      b.setAttribute('data-body', k);
      const knob = (id, dev) => { const e = doc.createElement('div'); e.setAttribute('data-dest', id); if (dev) e.setAttribute('data-dev', dev); b.append(e); K[k + ':' + id] = e; return e; };
      if (k === 'i1/oscA') { knob('a.wt', 'i1'); knob('a.pan', 'i1'); }
      if (k === 'i1/macros') for (let i = 1; i <= 8; i++) { const e = doc.createElement('div'); e.setAttribute('data-jack', 'k' + i); b.append(e); tiles.push(e); }
      if (k === 'i1') { const tw = knob('m1', 'i1'); tw.setAttribute('data-twin', ''); }
    }, unmount() {} },
  }, o));
  return Object.assign(R, { doc, W, t, PW, K, tiles });
}
const sj = v => JSON.stringify(v);

test('milestone 3 createTrackView: part modules (kind part: PART_W_DEF wide, the Serum\'s colour, chip S1, the title OSC A, dimmed while off, the panel\'s ⏻ in the bar slot as the x.on end), VOICE\'s jacks in parts view (data-dir), the internal jacks patchable (not the warp input, not VOICE → own FX), intPort', () => {
  const R = pview(), V = R.V, m = k => V.modules.get(k);
  assert.deepEqual([...V.modules.keys()], ['i1', 'i1/fx', 'out', 'l1', 'i1/oscA', 'i1/oscB', 'i1/oscC', 'i1/filter', 'i1/lfo1', 'i1/macros']);
  const A = m('i1/oscA');
  assert.equal(sj([A.kind, A.el.getAttribute('data-cv-kind'), A.w, A.title, A.el.style['--mc'], A.el.hasAttribute('data-off')]), sj(['part', 'part', 288, 'OSC A', '#ff00aa', false]));
  assert.equal(sj(['i1/oscB', 'i1/filter', 'i1/lfo1', 'i1/macros', 'i1'].map(k => [m(k).w, m(k).el.hasAttribute('data-off')])), sj([[288, true], [224, false], [416, false], [256, false], [448, false]]), 'OSC B off: dimmed; VOICE 448');
  const chip = A.bar.childNodes.find(n => /cv-chip/.test(n.getAttribute('class') || ''));
  assert.equal(chip.textContent, 'S1');
  // the bar's power slot holds the panel's own toggle: a control of the bar (no move), the x.on cable end
  const pw = A.bar.childNodes[0];
  assert.equal(sj([pw.hidden, pw.childNodes[0] === R.PW['i1/oscA'], /cv-powslot/.test(pw.getAttribute('class'))]), sj([false, true, true]));
  place(A.el, 640, 0, 288, 300); place(R.PW['i1/oscA'], 650, 10, 20, 20);
  assert.equal(sj(V.destPort('i1', 'a.on')), sj({ x: A.x + 20, y: A.y + 20 }), 'the bar ⏻ is OSC A\'s a.on end');
  // jacks: an oscillator's out patchable, its warp input read-only; VOICE in parts view
  assert.equal(sj(['out', 'warp'].map(j => [A.jack(j).hasAttribute('data-ro'), A.jack(j).getAttribute('data-dir'), A.jack(j).getAttribute('data-kind')])), sj([[false, 'out', 'audio'], [true, 'in', 'warp']]));
  assert.equal(m('i1').jackIds().join(), 'main,direct,note,env1,out');
  assert.equal(sj(V.jacks().filter(J => J.mod === 'i1').map(J => J.id + ':' + J.dir + ':' + J.kind + ':' + J.el.hasAttribute('data-ro'))),
    sj(['i1.main:in:audio:false', 'i1.direct:in:audio:false', 'i1.note:in:note:false', 'i1.env1:out:mod:false', 'i1.out:out:audio:true']));
  assert.equal(sj(['i1/oscA.out', 'i1/oscA.warp', 'i1.out', 'i1.main', 'i1/filter.in', 'i1/fx.in', 'out.in', 'i1/lfo1.out'].map(V.intPort)),
    sj(['i1/oscA.out', null, null, 'i1.main', 'i1/filter.in', null, null, null]));
  assert.equal(sj(V.partsOf('i1')), sj(['i1/oscA', 'i1/oscB', 'i1/oscC', 'i1/filter', 'i1/lfo1', 'i1/macros']));
  // a move of VOICE keeps the parts view flag in its lay entry
  m('i1').nudge(32, 0);
  assert.equal(sj(R.ref.t.lay.i1), sj({ x: 1504, y: 0, ui: 'parts' }));
  V.destroy();
});

test('milestone 3 createTrackView: the internal cables (sx-edges views: A → Filter 1, the stub of C, the filter → VOICE), own rows from their module\'s jack, link rows from parts, a hidden destination ends at VOICE\'s bar tagged; a twin is no end; selecting VOICE outlines the members', () => {
  const R = pview(), V = R.V;
  const L = V.cables.list(), ids = L.map(c => c.id);
  for (const id of ['x:i1:oscA.out>filter.in', 'x:i1:oscB.out>voice.main', 'x:i1:oscC.out>', 'x:i1:filter.out>voice.main']) assert.ok(ids.includes(id), id);
  const c = L.find(x => x.id === 'x:i1:oscA.out>filter.in');
  assert.equal(sj([c.a, c.b, c.int, c.kind, !!c.readonly, c.color]), sj(['i1/oscA.out', 'i1/filter.in', 'audio', 'audio', false, '#ff00aa']));
  assert.equal(L.find(x => x.id === 'x:i1:oscC.out>').stub, true);
  const P = V.ports();
  assert.ok(P.get('i1/oscA.out') && P.get('i1/filter.in') && P.get('i1.main'), 'the jacks have ports');
  const g = id => all(V.cables.under).find(n => n.getAttribute && n.getAttribute('data-cable') === id);
  assert.equal(sj([g('x:i1:oscA.out>filter.in').style.display, g('x:i1:oscC.out>').style.display, g('x:i1:oscC.out>').hasAttribute('data-stub'), g('x:i1:oscA.out>filter.in').getAttribute('data-int')]), sj(['', '', true, 'audio']), 'drawn; the stub from its out jack');
  // own rows (s.matrix: LFO 1 → a.wt) and link rows from 'i1/lfo1.out' leave the LFO 1 part's jack
  const own = L.find(x => x.id === 'o:i1:0'), link = L.find(x => x.id === 'r2');
  assert.equal(sj([own.a, own.b, own.own, own.color, link.a, link.b]), sj(['i1/lfo1.out', 'i1:a.wt', true, '#ff00aa', 'i1/lfo1.out', 'i1:a.pan']));
  // r1 → b.level: no mounted view shows it (OSC B's panel has no such knob here) → VOICE's bar, dashed, tagged
  const vo = V.modules.get('i1'), q = V.destPort('i1', 'b.level');
  assert.equal(sj(q), sj({ x: vo.x, y: vo.y + 20, hid: true, tag: 'OSC B · LEVEL · hidden' }));
  V.remeasure();
  const b = V.cables.badge('r1');
  assert.equal(sj([b.classList.contains('cv-hid'), b.childNodes[2].textContent, b.childNodes[2].hidden]), sj([true, 'OSC B · LEVEL · hidden', false]));
  // a knob on a part: its end there, not hidden (OSC A's a.pan)
  place(V.modules.get('i1/oscA').el, 640, 0, 288, 300); place(R.K['i1/oscA:a.pan'], 700, 100, 20, 20); V.remeasure();
  assert.equal(sj(V.destPort('i1', 'a.pan')), sj({ x: V.modules.get('i1/oscA').x + 70, y: V.modules.get('i1/oscA').y + 110 }));
  // a twin (CLIP's MACROS pane) is never an end: m1 resolves hidden at VOICE, not on the twin
  place(V.modules.get('i1').el, 1472, 0, 448, 600); place(R.K['i1:m1'], 1500, 100, 20, 20); V.remeasure();
  assert.equal(V.destPort('i1', 'm1').hid, true);
  // selecting VOICE outlines its members
  R.W.select('i1');
  assert.equal(sj([...V.modules.entries()].filter(([, m]) => m.el.hasAttribute('data-cv-member')).map(([k]) => k)), sj(['i1/fx', 'i1/oscA', 'i1/oscB', 'i1/oscC', 'i1/filter', 'i1/lfo1', 'i1/macros']));
  R.W.select('l1');
  assert.equal([...V.modules.values()].filter(m => m.el.hasAttribute('data-cv-member')).length, 0);
  V.destroy();
});

test('milestone 3 inline jacks: MACROS\' name tiles ([data-jack="k<n>"]) are its jacks — measured module-local once per relayout, the tile itself the jack (data-cv-jack, a patchable mod-out), the dot hidden; re-rendered tiles re-anchored on remeasure; a bundled ↔ parts switch rebuilds VOICE', () => {
  const R = pview(), V = R.V, mm = V.modules.get('i1/macros');
  place(mm.el, 1472, -288, 256, 200);
  R.tiles.forEach((e, i) => place(e, 1472 + 8 + (i % 4) * 60, -288 + 50 + Math.floor(i / 4) * 40, 56, 30));
  V.remeasure('i1/macros');
  assert.equal(sj([mm.port('k1'), mm.port('k6')]), sj([{ x: 36, y: 65 }, { x: 96, y: 105 }]), 'the tiles\' centres (module px)');
  const t3 = R.tiles[2];
  assert.equal(sj([t3.getAttribute('data-cv-jack'), t3.getAttribute('data-kind'), t3.getAttribute('role'), mm.jack('k3') === t3, mm.jackDot('k3').hidden]), sj(['i1/macros.k3', 'mod', 'button', true, true]));
  assert.equal(sj(V.ports().get('i1/macros.k3')), sj({ x: mm.x + 156, y: mm.y + 65 }));
  assert.equal(V.jacks().find(J => J.id === 'i1/macros.k3').el === t3, true, 'the cable drag sees the tile');
  // reads: once per relayout
  let reads = 0;
  const gb = t3.getBoundingClientRect.bind(t3);
  t3.getBoundingClientRect = () => { reads++; return gb(); };
  V.ports(); V.ports(); mm.port('k3');
  assert.equal(reads, 0, 'cached');
  // the body re-rendered: a new tile for k3, the old one cleared on remeasure
  const n3 = R.doc.createElement('div'); n3.setAttribute('data-jack', 'k3'); t3.parentNode.append(n3); t3.removeAttribute('data-jack'); t3.remove();
  place(n3, 1472 + 200, -288 + 150, 40, 20);
  V.remeasure('i1/macros');
  assert.equal(sj([mm.port('k3'), n3.getAttribute('data-cv-jack'), t3.getAttribute('data-cv-jack')]), sj([{ x: 220, y: 160 }, 'i1/macros.k3', null]));
  // the Serum back to the whole panel: VOICE made again with its one out jack, the parts gone
  const t2 = clone(R.ref.t); delete t2.lay.i1.ui;
  R.sync(t2);
  assert.equal(sj([V.modules.get('i1').jackIds(), [...V.modules.keys()].filter(k => /^i1\//.test(k)), V.cables.list().filter(c => c.int).length]), sj([['out'], ['i1/fx'], 0]), 'bundled: no internal cables');
  V.destroy();
});
