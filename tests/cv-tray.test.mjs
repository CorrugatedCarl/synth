import './v8-guard.mjs';
// cv-tray.js (stage 1b SHELL lane; docs/canvas/IMPL-1b.md §8.1): budget(), topSnaps(), trayGrip (drag, two-finger
// rollback, keys, double-tap, ARIA), sideTray (tap opens, grip inset, stays open on a press outside, never closes itself), sourcesTray
// drag verdicts (out / along / hold) and drop routing, menuPop, sheet; (1e) effectsTray (tiles, groups, costs, drops into
// a panel / onto the canvas, never closing the tray), the Effects tray markup and the 1e styles; (2a) the Modulators section
// (tiles, picks, drags onto the canvas, setPlaced), its markup and the 2a styles. Fake DOM: tests/wk-dom.mjs; never pass fake-DOM
// nodes to assert.* (ids, strings and numbers only).
// Run alone: node --max-old-space-size=2048 --test tests/cv-tray.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fresh, raf, ptr, fire, key, place, advance } from './wk-dom.mjs';
import * as T from '../cv-tray.js?v=9';
import { MODELS } from '../models.js?v=9';

const wait = ms => new Promise(r => setTimeout(r, ms));
let TS = 5000; // event timestamps (dragSource / double-tap timing)
const at = (o = {}) => Object.assign({ timeStamp: (TS += 40), isPrimary: true, pointerId: 1 }, o);
const mkEl = (d, tag = 'div', id) => { const e = d.createElement(tag); if (id) e.id = id; d.body.appendChild(e); return e; };

test('topSnaps(): the collapsed row, then the arrangement toolbar + ruler + whole track rows; nearestSnap()', () => {
  assert.deepEqual(T.topSnaps(0), [48]);
  assert.deepEqual(T.topSnaps(1), [48, 160]);
  assert.deepEqual(T.topSnaps(3), [48, 160, 216, 272]);
  assert.deepEqual([T.TOP_ROW, T.ARR_BAR, T.RULER, T.ROW_H, T.CANVAS_MIN, T.RAIL_W, T.SIDE_W, T.EDGE_INSET], [48, 32, 24, 56, 240, 44, 240, 24]);
  assert.equal(T.TRAY_PREF, 'synth.cv.trays');
  const S = T.topSnaps(4);
  assert.equal(T.nearestSnap(S, 110), 160);
  assert.equal(T.nearestSnap(S, 100), 48);
  assert.equal(T.nearestSnap(S, 90), 48);
  assert.equal(T.nearestSnap(S, 250), 272);
  assert.equal(T.nearestSnap(S, 400, 230), 216, 'only stops that fit');
  assert.equal(T.nearestSnap(S, 400, 20), 48, 'none fits: the lowest');
});

test('budget(): the canvas keeps ≥ 240 px at iPad and desktop heights; the dragged tray wins and pushes the other toward its fold; both at their least clamp the active one; collapsed stays 48', () => {
  const bot = 64 + 170, bMin = 64 + 70;
  for (const vh of [834, 1024, 1194, 1366, 900, 760, 620]) {
    for (const top of [48, 160, 272, 600]) for (const active of ['top', 'bottom']) {
      const r = T.budget({ vh, top, bottom: bot, active, topMin: 48, bottomMin: bMin }), at = `vh ${vh} top ${top} ${active}`;
      assert.equal(r.top + r.bottom + r.canvas, vh, at);
      if (vh - 240 >= 48 + bMin) assert.ok(r.canvas >= 240, at + ': canvas ' + r.canvas);
      assert.ok(r.top >= 48 && r.bottom >= bMin, at + ': never below a tray\'s least');
      if (active === 'top') assert.equal(r.top, Math.min(top, vh - 240 - bMin), at + ': the top tray gets its request (up to the keys at their least)');
      else assert.equal(r.bottom, Math.min(bot, vh - 240 - 48), at + ': the keys get theirs');
      if (r.top + bot + 240 <= vh && active === 'top') assert.equal(r.bottom, bot, at + ': room enough: the other untouched');
    }
  }
  // the dragged tray pushes the other toward its fold
  let r = T.budget({ vh: 834, top: 300, bottom: 400, active: 'bottom', topMin: 48, bottomMin: bMin });
  assert.deepEqual([r.top, r.bottom, r.canvas], [194, 400, 240]);
  r = T.budget({ vh: 834, top: 300, bottom: 400, active: 'top', topMin: 48, bottomMin: bMin });
  assert.deepEqual([r.top, r.bottom, r.canvas], [300, 294, 240]);
  // both at their least (a window too small for the rule): the active one is clamped too, the canvas gets what is left
  r = T.budget({ vh: 300, top: 160, bottom: bot, active: 'top', topMin: 48, bottomMin: bMin });
  assert.deepEqual([r.top, r.bottom, r.canvas], [48, 134, 118]);
  r = T.budget({ vh: 300, top: 160, bottom: bot, active: 'bottom', topMin: 48, bottomMin: bMin });
  assert.deepEqual([r.top, r.bottom, r.canvas], [48, 134, 118]);
  // collapsed stays 48; the defaults (topMin 48, min 240)
  r = T.budget({ vh: 834, top: 48, bottom: 2000 });
  assert.deepEqual([r.top, r.bottom, r.canvas], [48, 546, 240]);
  r = T.budget({ vh: 834, top: 0, bottom: 0 });
  assert.deepEqual([r.top, r.bottom, r.canvas], [48, 0, 786]);
});

function gripRig(o = {}) {
  const d = fresh(), g = mkEl(d, 'div', 'grip'), log = [];
  let h = o.h0 != null ? o.h0 : 160, dbl = 0, starts = 0;
  const G = T.trayGrip(g, Object.assign({
    edge: 'top', label: 'Track list height', get: () => h, set: (px, ph) => { log.push(ph + ' ' + px); if (ph !== 'reset') h = px; },
    min: () => 48, max: () => 400, onDouble: () => { dbl++; }, start: () => { starts++; },
  }, o.opts || {}));
  return { d, g, G, log, get h() { return h; }, set h(v) { h = v; }, get dbl() { return dbl; }, get starts() { return starts; } };
}

test('trayGrip: a drag sets the height (a top tray grows downward, a bottom one upward), clamped, snapped to whole rows on release; ARIA slider values', () => {
  const R = gripRig({ opts: { snaps: () => T.topSnaps(5), text: v => v + ' px tall' } });
  const g = R.g;
  assert.deepEqual([g.getAttribute('role'), g.getAttribute('aria-orientation'), g.getAttribute('aria-label'), g.getAttribute('tabindex')], ['slider', 'vertical', 'Track list height', '0']);
  assert.deepEqual([g.getAttribute('aria-valuenow'), g.getAttribute('aria-valuemin'), g.getAttribute('aria-valuemax'), g.getAttribute('aria-valuetext')], ['160', '48', '400', '160 px tall']);
  ptr(g, 'pointerdown', 300, 200, at({ pointerType: 'touch' }));
  assert.equal(R.starts, 1);
  ptr(g, 'pointermove', 300, 202, at({ pointerType: 'touch' }));
  assert.deepEqual(R.log, [], 'under 3 px: still a tap');
  ptr(g, 'pointermove', 300, 245, at({ pointerType: 'touch' }));
  assert.deepEqual([R.h, R.log.at(-1)], [205, 'move 205'], 'down 45 px: taller');
  assert.ok(g.classList.contains('drag'));
  ptr(g, 'pointermove', 300, 900, at({ pointerType: 'touch' }));
  assert.equal(R.h, 400, 'at most max()');
  ptr(g, 'pointermove', 300, -900, at({ pointerType: 'touch' }));
  assert.equal(R.h, 48, 'at least min()');
  ptr(g, 'pointermove', 300, 265, at({ pointerType: 'touch' }));
  ptr(g, 'pointerup', 300, 265, at({ pointerType: 'touch' }));
  assert.deepEqual([R.h, R.log.at(-1)], [216, 'end 216'], '225 snaps to two rows (216)');
  assert.equal(g.getAttribute('aria-valuenow'), '216');
  assert.ok(!g.classList.contains('drag'));
  ptr(g, 'pointermove', 300, 400, at({ pointerType: 'touch' }));
  assert.equal(R.h, 216, 'the drag has ended');
  // a bottom tray (the keyboard): up = taller, no snaps
  const B = gripRig({ h0: 170, opts: { edge: 'bottom', min: () => 70, max: () => 360 } });
  ptr(B.g, 'pointerdown', 500, 600, at());
  ptr(B.g, 'pointermove', 500, 499, at({ buttons: 1 }));
  assert.equal(B.h, 271, 'dragged up 101 px');
  ptr(B.g, 'pointerup', 500, 499, at());
  assert.deepEqual(B.log.slice(-1), ['end 271'], 'released where it is');
});

test('trayGrip: a two-finger pointercancel puts the height back unsaved; a plain cancel keeps it (end); a mouse move with no button ends the drag', () => {
  const R = gripRig({ opts: { snaps: () => T.topSnaps(5) } });
  ptr(R.g, 'pointerdown', 10, 100, at({ pointerType: 'touch', pointerId: 4 }));
  ptr(R.g, 'pointermove', 10, 160, at({ pointerType: 'touch', pointerId: 4 }));
  assert.equal(R.h, 220);
  ptr(R.g, 'pointercancel', 10, 160, at({ pointerType: 'touch', pointerId: 4, gesture: 'two-finger' }));
  assert.deepEqual([R.h, R.log.at(-1)], [160, 'cancel 160'], 'as it was');
  ptr(R.g, 'pointerdown', 10, 100, at({ pointerType: 'touch', pointerId: 5 }));
  ptr(R.g, 'pointermove', 10, 160, at({ pointerType: 'touch', pointerId: 5 }));
  ptr(R.g, 'pointercancel', 10, 160, at({ pointerType: 'touch', pointerId: 5 }));
  assert.deepEqual([R.h, R.log.at(-1)], [216, 'end 216'], 'kept (snapped)');
  ptr(R.g, 'pointerdown', 10, 100, at({ pointerId: 6 }));
  ptr(R.g, 'pointermove', 10, 150, at({ pointerId: 6, buttons: 1 }));
  ptr(R.g, 'pointermove', 10, 170, at({ pointerId: 6, buttons: 0 }));
  assert.equal(R.log.at(-1), 'end 272', 'the pointerup was swallowed: ended where it was');
  assert.ok(!R.G.dragging());
});

test('trayGrip: keys — snaps step from stop to stop, Home / End, Enter / Delete / Backspace reset; without snaps arrows ±step (Shift ±1), Page ±4·step; other keys stay the page\'s', () => {
  const R = gripRig({ opts: { snaps: () => T.topSnaps(4) } });
  const k = (name, o) => key(R.g, name, o);
  let e = k('ArrowUp');
  assert.deepEqual([R.h, e.defaultPrevented], [216, true], 'the next stop up');
  k('PageUp'); assert.equal(R.h, 272);
  k('ArrowDown'); k('ArrowLeft'); assert.equal(R.h, 160);
  k('ArrowDown'); assert.equal(R.h, 48);
  k('ArrowDown'); assert.equal(R.h, 48, 'the lowest stays');
  k('End'); assert.equal(R.h, 400, 'End: max()');
  k('Home'); assert.equal(R.h, 48);
  for (const n of ['Enter', 'Delete', 'Backspace']) { e = k(n); assert.deepEqual([R.log.at(-1), e.defaultPrevented], ['reset 0', true], n); }
  assert.equal(k('KeyA').defaultPrevented, false);
  const B = gripRig({ h0: 170, opts: { edge: 'bottom', min: () => 70, max: () => 360 } });
  key(B.g, 'ArrowUp'); assert.equal(B.h, 180);
  key(B.g, 'ArrowUp', { shiftKey: true }); assert.equal(B.h, 181);
  key(B.g, 'PageDown'); assert.equal(B.h, 141);
  key(B.g, 'End'); assert.equal(B.h, 360);
  key(B.g, 'ArrowUp'); assert.equal(B.h, 360, 'clamped');
  key(B.g, 'Home'); assert.equal(B.h, 70);
  assert.equal(B.g.getAttribute('aria-valuenow'), '70', 'ARIA follows');
});

test('trayGrip: double-tap (touch, pen) and the mouse\'s own dblclick call onDouble; drags, long or far taps and a touch browser\'s dblclick do not', () => {
  const R = gripRig();
  const tap = (x, y, o) => { ptr(R.g, 'pointerdown', x, y, at(Object.assign({ pointerType: 'touch' }, o))); ptr(R.g, 'pointerup', x, y, at(Object.assign({ pointerType: 'touch' }, o))); };
  tap(300, 10); tap(302, 11);
  assert.equal(R.dbl, 1, 'two taps in place');
  tap(300, 10); tap(330, 10);
  assert.equal(R.dbl, 1, '30 px apart: no');
  for (let i = 0; i < 2; i++) { ptr(R.g, 'pointerdown', 300, 300, at({ pointerType: 'touch' })); ptr(R.g, 'pointermove', 300, 306, at({ pointerType: 'touch' })); ptr(R.g, 'pointerup', 300, 302, at({ pointerType: 'touch' })); }
  assert.equal(R.dbl, 1, 'two nudges (drags): no');
  ptr(R.g, 'pointerdown', 300, 10, at({ pointerType: 'pen' })); TS += 400; ptr(R.g, 'pointerup', 300, 10, at({ pointerType: 'pen' }));
  ptr(R.g, 'pointerdown', 300, 10, at({ pointerType: 'pen' })); ptr(R.g, 'pointerup', 300, 10, at({ pointerType: 'pen' }));
  assert.equal(R.dbl, 1, 'a long press is no tap');
  tap(300, 10, { pointerType: 'pen' }); tap(300, 10, { pointerType: 'pen' });
  assert.equal(R.dbl, 2, 'pen');
  tap(300, 10, { pointerType: 'mouse' }); tap(300, 10, { pointerType: 'mouse' });
  assert.equal(R.dbl, 2, 'mouse presses: no');
  fire(R.g, 'dblclick');
  assert.equal(R.dbl, 3, 'the mouse\'s dblclick');
  tap(300, 10); fire(R.g, 'dblclick');
  assert.equal(R.dbl, 3, 'a dblclick after a touch press is not ours');
  R.G.destroy();
  fire(R.g, 'dblclick');
  assert.equal(R.dbl, 3, 'destroyed');
});

function sideRig(o = {}) {
  const d = fresh(), el = mkEl(d, 'aside', 'srcTray'), rail = d.createElement('button'), panel = d.createElement('div'), grip = d.createElement('div');
  panel.id = 'srcPanel';
  el.append(rail, panel, grip);
  const outside = mkEl(d, 'div', 'canvas'), keep = mkEl(d, 'div', 'perf');
  const mem = new Map(Object.entries(o.pref || {}));
  const store = { get: (k, def) => (mem.has(k) ? JSON.parse(mem.get(k)) : def), set: (k, v) => mem.set(k, JSON.stringify(v)) };
  const changes = [];
  const S = T.sideTray(el, Object.assign({ side: 'left', store, rail, panel, grip, label: 'Sources', onChange: on => changes.push(on), keepOpen: t => t === keep }, o.opts || {}));
  return { d, el, rail, panel, grip, outside, keep, store, mem, changes, S };
}

test('sideTray: a tap on the rail opens and closes it (aria-expanded, the panel shown); a press outside (the canvas) leaves it open — the user\'s call; close() says whether it was open; state persisted', () => {
  const R = sideRig();
  assert.deepEqual([R.S.isOpen(), R.panel.hidden, R.rail.getAttribute('aria-expanded'), R.rail.getAttribute('aria-controls')], [false, true, 'false', 'srcPanel']);
  R.rail.click();
  assert.deepEqual([R.S.isOpen(), R.panel.hidden, R.rail.getAttribute('aria-expanded'), R.el.classList.contains('open')], [true, false, 'true', true]);
  assert.deepEqual(R.changes, [true]);
  assert.deepEqual(JSON.parse(R.mem.get(T.TRAY_PREF)), { src: { open: true, w: 240 } });
  ptr(R.panel, 'pointerdown', 50, 50);
  assert.equal(R.S.isOpen(), true, 'a press inside keeps it');
  ptr(R.keep, 'pointerdown', 50, 50);
  assert.equal(R.S.isOpen(), true, 'the keyboard keeps it (playing while browsing)');
  ptr(R.outside, 'pointerdown', 500, 50);
  assert.deepEqual([R.S.isOpen(), R.panel.hidden], [true, false], 'a press on the canvas leaves it open');
  assert.equal(R.S.close(), true, 'close() closes it');
  assert.equal(R.S.close(), false, 'closed already');
  R.S.open();
  assert.equal(R.S.close(), true);
  R.rail.click(); R.rail.click();
  assert.equal(R.S.isOpen(), false);
  assert.deepEqual(R.changes, [true, false, true, false, true, false]);
  // restored open from the prefs (onChange told, nothing written)
  const R2 = sideRig({ pref: { [T.TRAY_PREF]: JSON.stringify({ src: { open: true, w: 300 }, top: 160 }) } });
  assert.deepEqual([R2.S.isOpen(), R2.S.width(), R2.panel.hidden, R2.changes], [true, 300, false, [true]]);
  R2.S.close();
  assert.deepEqual(JSON.parse(R2.mem.get(T.TRAY_PREF)), { src: { open: false, w: 300 }, top: 160 }, 'the other prefs kept');
});

test('sideTray: the width grip sits on the inner edge ≥ 24 px from the screen edge; a drag resizes (a two-finger cancel puts it back), arrows ±16, clamped', () => {
  const R = sideRig();
  R.S.open();
  assert.ok(T.RAIL_W + R.S.width() - 12 >= T.EDGE_INSET, 'the grip\'s left edge clears the system edge-gesture band');
  assert.ok(T.RAIL_W + T.SIDE_MIN - 12 >= T.EDGE_INSET, '… at the narrowest too');
  assert.equal(R.el.style['--cv-side-w'], '240px');
  assert.deepEqual([R.grip.getAttribute('role'), R.grip.getAttribute('aria-orientation'), R.grip.getAttribute('aria-label')], ['separator', 'vertical', 'Sources width']);
  ptr(R.grip, 'pointerdown', 284, 300, at({ pointerType: 'touch' }));
  ptr(R.grip, 'pointermove', 344, 300, at({ pointerType: 'touch' }));
  assert.deepEqual([R.S.width(), R.el.style['--cv-side-w']], [300, '300px']);
  ptr(R.grip, 'pointercancel', 344, 300, at({ pointerType: 'touch', gesture: 'two-finger' }));
  assert.equal(R.S.width(), 240, 'two fingers: back');
  ptr(R.grip, 'pointerdown', 284, 300, at());
  ptr(R.grip, 'pointermove', 2000, 300, at({ buttons: 1 }));
  ptr(R.grip, 'pointerup', 2000, 300, at());
  assert.equal(R.S.width(), 440, 'at most SIDE_MAX (a 1280 px window allows 596)');
  assert.equal(JSON.parse(R.mem.get(T.TRAY_PREF)).src.w, 440, 'saved');
  key(R.grip, 'ArrowLeft');
  assert.equal(R.S.width(), 424);
  R.S.setWidth(10);
  assert.equal(R.S.width(), T.SIDE_MIN);
  // a right tray grows leftward
  const L = sideRig({ opts: { side: 'right', key: 'fx' } });
  L.S.open();
  ptr(L.grip, 'pointerdown', 1000, 300, at());
  ptr(L.grip, 'pointermove', 960, 300, at({ buttons: 1 }));
  ptr(L.grip, 'pointerup', 960, 300, at());
  assert.equal(L.S.width(), 280);
  assert.deepEqual(Object.keys(JSON.parse(L.mem.get(T.TRAY_PREF))), ['fx']);
});

test('sideTray + sourcesTray as main.js wires them (the user\'s rule): a tile\'s tap, a drag out of the tray onto the canvas and its drop never close the tray — only its rail, its ✕ or Escape', () => {
  const R = sideRig(), list = R.d.createElement('div'), layer = mkEl(R.d, 'div', 'ov');
  raf.install();
  R.panel.append(list);
  place(R.el, 0, 100, 284, 600);
  R.S.open();
  const picks = [], drops = [];
  let left = 0;
  const S = T.sourcesTray(list, { models: MODELS, tray: R.el, layer, pick: (id, mode) => picks.push(id + ':' + mode),
    overOf: (t, x) => (x > 300 ? 'canvas' : null), onLeave: () => { left++; },
    drag: { drop: (id, i) => { drops.push(id + ' ' + i.over); return true; } } });
  const tile = S.tiles().find(t => t.getAttribute('data-model') === 'juno60'), tp = { pointerType: 'touch' };
  tile.click();
  assert.deepEqual([picks, R.S.isOpen()], [['juno60:replace'], true], 'a tap: picked, still open');
  ptr(tile, 'pointerdown', 100, 300, at(tp)); ptr(tile, 'pointermove', 112, 302, at(tp)); ptr(tile, 'pointermove', 400, 300, at(tp));
  assert.deepEqual([left, R.S.isOpen()], [1, true], 'dragged out of the tray: still open');
  TS += 150;
  ptr(tile, 'pointermove', 402, 301, at(tp)); ptr(tile, 'pointerup', 402, 301, at(tp));
  assert.deepEqual([drops, R.S.isOpen()], [['juno60 canvas'], true], 'dropped on the canvas: still open');
  assert.equal(R.S.close(), true, 'close() (the ✕ / Escape) closes it');
  S.destroy();
});

function srcRig(over) {
  const d = fresh();
  raf.install();
  const tray = mkEl(d, 'aside', 'srcTray'), list = d.createElement('div'), layer = mkEl(d, 'div', 'ov');
  tray.appendChild(list);
  place(tray, 0, 100, 284, 600);
  const log = [], picks = [], lefts = [];
  let leaves = 0;
  const S = T.sourcesTray(list, {
    models: MODELS, tray, layer, pick: (id, mode) => picks.push(id + ':' + mode),
    overOf: (t, x, y) => over(x, y), canvasGhost: () => true, onLeave: () => { leaves++; },
    drag: {
      begin: (id, i) => log.push('begin ' + id + ' ' + i.over),
      move: (id, i) => { log.push('move ' + i.over); lefts.push(i.left); },
      drop: (id, i) => { log.push('drop ' + id + ' ' + i.over); return !!i.over; },
      cancel: (id, i) => log.push('cancel ' + id),
    },
  });
  return { d, tray, list, layer, S, log, picks, lefts, get leaves() { return leaves; } };
}
const zone = (x, y) => (y < 100 ? 'tracks' : x > 300 ? 'canvas' : null);
const tileOf = (R, id) => R.S.tiles().find(t => t.getAttribute('data-model') === id);

test('sourcesTray: one tile per model (its drawing, name, year · maker), the current one marked; a tap picks in the tray\'s mode', () => {
  const R = srcRig(zone);
  const tiles = R.S.tiles();
  assert.deepEqual(tiles.map(t => t.getAttribute('data-model')), MODELS.map(m => m.id));
  const t0 = tileOf(R, 'minimoog');
  assert.deepEqual(t0.children.map(c => c.className), ['cv-tart', 'cv-tname', 'cv-tmeta', 'cv-tbadge']);
  assert.deepEqual(tileOf(R, 'serum').children.map(c => c.className), ['cv-tart', 'cv-tname', 'cv-tmeta'], 'Serum: no SIMPLE badge (no hardware panel)');
  assert.equal(t0.children[1].textContent, 'Minimoog');
  assert.equal(t0.children[2].textContent, '1970 · Moog Music');
  assert.equal(tileOf(R, 'serum').children[1].textContent, 'Serum (complete)');
  assert.equal(t0.children[0].getAttribute('aria-hidden'), 'true');
  R.S.setCurrent('juno60');
  assert.deepEqual(tiles.filter(t => t.classList.contains('on')).map(t => t.getAttribute('data-model')), ['juno60']);
  assert.equal(tileOf(R, 'juno60').getAttribute('aria-current'), 'true');
  assert.equal(R.S.current(), 'juno60');
  tileOf(R, 'dx7').click();
  assert.deepEqual(R.picks, ['dx7:replace']);
  R.S.setMode('track');
  assert.equal(R.S.mode(), 'track');
  tileOf(R, 'tb303').click();
  assert.deepEqual(R.picks, ['dx7:replace', 'tb303:track']);
  R.S.setMode('bogus');
  assert.equal(R.S.mode(), 'replace');
});

test('sourcesTray: a touch moving out of the tray drags at once (ghost in the layer, the tray told it was left); along the tray it is a scroll; the drop routes to canvas / tracks / nothing', async () => {
  const R = srcRig(zone), t = tileOf(R, 'prophet5'), tp = { pointerType: 'touch' };
  // outward (across the tray's scroll axis): a drag at once
  ptr(t, 'pointerdown', 100, 300, at(tp));
  ptr(t, 'pointermove', 112, 302, at(tp));
  assert.deepEqual(R.log, ['begin prophet5 null', 'move null'], 'begun (and moved)');
  assert.equal(R.layer.children.length, 1, 'the ghost');
  assert.equal(R.layer.children[0].className, 'cv-tghost touch');
  ptr(t, 'pointermove', 400, 300, at(tp));
  assert.equal(R.leaves, 1, 'left the tray');
  assert.deepEqual(R.lefts, [false, true], 'info.left: from the move that left the tray on (the canvas may edge-pan then)');
  assert.equal(R.log.at(-1), 'move canvas');
  assert.ok(R.layer.children[0].classList.contains('off'), 'over the canvas the world draws the outline: the ghost hides');
  TS += 150;
  ptr(t, 'pointermove', 402, 301, at(tp));
  ptr(t, 'pointerup', 402, 301, at(tp));
  assert.equal(R.log.at(-1), 'drop prophet5 canvas');
  assert.equal(R.layer.children.length, 0, 'the ghost gone');
  assert.equal(R.leaves, 1);
  // along the tray (vertical): the browser's scroll — no drag
  R.log.length = 0;
  ptr(t, 'pointerdown', 100, 300, at(tp));
  ptr(t, 'pointermove', 101, 320, at(tp));
  ptr(t, 'pointermove', 101, 380, at(tp));
  ptr(t, 'pointerup', 101, 380, at(tp));
  assert.deepEqual(R.log, [], 'a scroll');
  // a quick flick that ends on a zone it did not rest on is a cancel
  ptr(t, 'pointerdown', 100, 300, at(tp));
  ptr(t, 'pointermove', 120, 300, at(tp));
  ptr(t, 'pointermove', 500, 300, at(tp));
  ptr(t, 'pointerup', 500, 300, at(tp));
  assert.deepEqual(R.log.slice(-2), ['move canvas', 'cancel prophet5'], 'flicked: a cancel (no drop)');
  // onto the track list (rested on it)
  R.log.length = 0;
  ptr(t, 'pointerdown', 100, 300, at(tp));
  ptr(t, 'pointermove', 120, 300, at(tp));
  ptr(t, 'pointermove', 200, 50, at(tp));
  TS += 200;
  ptr(t, 'pointerup', 200, 50, at(tp));
  assert.deepEqual(R.log.slice(-2), ['move tracks', 'drop prophet5 tracks']);
  // nowhere (still in the tray area)
  R.log.length = 0;
  ptr(t, 'pointerdown', 100, 300, at(tp));
  ptr(t, 'pointermove', 140, 300, at(tp));
  TS += 300;
  ptr(t, 'pointerup', 140, 300, at(tp));
  assert.deepEqual(R.log.slice(-2), ['move null', 'cancel prophet5'], 'over nothing: a cancel');
});

test('sourcesTray: a 250 ms hold then drags in any direction (also along the tray); a mouse drags after 4 px; Escape cancels', async () => {
  const R = srcRig(zone), t = tileOf(R, 'cs80'), tp = { pointerType: 'touch' };
  ptr(t, 'pointerdown', 100, 300, at(tp));
  await wait(290);
  assert.ok(t.classList.contains('wk-armed'), 'armed');
  ptr(t, 'pointermove', 100, 320, at(tp));
  assert.deepEqual(R.log, ['begin cs80 null', 'move null'], 'a hold: along the tray drags too');
  ptr(t, 'pointercancel', 100, 320, at(tp));
  assert.deepEqual(R.log.slice(-1), ['cancel cs80']);
  assert.equal(R.layer.children.length, 0);
  R.log.length = 0;
  ptr(t, 'pointerdown', 100, 300, at());
  ptr(t, 'pointermove', 102, 301, at({ buttons: 1 }));
  assert.deepEqual(R.log, [], 'a mouse: under 4 px');
  ptr(t, 'pointermove', 140, 330, at({ buttons: 1 }));
  assert.equal(R.log[0], 'begin cs80 null');
  assert.equal(R.layer.children[0].className, 'cv-tghost', 'a mouse ghost (beside the pointer)');
  key(R.d, 'Escape');
  assert.equal(R.log.at(-1), 'cancel cs80');
  ptr(t, 'pointerup', 140, 330, at());
  assert.equal(R.log.at(-1), 'cancel cs80', 'nothing after the cancel');
  R.S.destroy();
  void advance;
});

test('menuPop: the button toggles the popover (aria-expanded); a press outside closes it, one inside does not; a picked item closes it (unless pick: false); Escape returns focus; attr mode', () => {
  const d = fresh(), btn = mkEl(d, 'button', 'appMenuBtn'), pop = mkEl(d, 'div', 'appMenu'), item = d.createElement('button'), out = mkEl(d, 'div');
  pop.appendChild(item);
  const ev = [];
  const M = T.menuPop(btn, pop, { onOpen: () => ev.push('open'), onClose: () => ev.push('close') });
  assert.deepEqual([pop.hidden, btn.getAttribute('aria-expanded'), btn.getAttribute('aria-controls')], [true, 'false', 'appMenu']);
  btn.click();
  assert.deepEqual([pop.hidden, btn.getAttribute('aria-expanded'), M.isOpen()], [false, 'true', true]);
  ptr(pop, 'pointerdown', 5, 5);
  assert.equal(M.isOpen(), true, 'inside');
  ptr(out, 'pointerdown', 5, 5);
  assert.deepEqual([M.isOpen(), pop.hidden], [false, true], 'outside');
  btn.click(); item.click();
  assert.equal(M.isOpen(), false, 'an item picked');
  btn.click(); btn.click();
  assert.equal(M.isOpen(), false, 'the button again');
  btn.click();
  item.focus();
  const e = key(item, 'Escape');
  assert.deepEqual([M.isOpen(), e.defaultPrevented, d.activeElement === btn], [false, true, true], 'Escape: closed, focus back on the button');
  assert.equal(M.close(), false);
  M.open();
  assert.equal(M.close(), true);
  assert.deepEqual(ev.slice(0, 4), ['open', 'close', 'open', 'close']);
  // pick: false (settings) and attr mode (a group shown in place on wide screens)
  const pop2 = mkEl(d, 'div', 'tMorePop'), b2 = mkEl(d, 'button'), sel = d.createElement('button');
  pop2.appendChild(sel);
  const M2 = T.menuPop(b2, pop2, { attr: 'data-open', pick: false });
  assert.equal(pop2.hidden, false, 'attr mode never hides it');
  b2.click();
  assert.equal(pop2.hasAttribute('data-open'), true);
  sel.click();
  assert.equal(M2.isOpen(), true, 'pick: false keeps it open');
  assert.equal(M2.close(), true);
  assert.equal(pop2.hasAttribute('data-open'), false);
  M.destroy(); M2.destroy();
  btn.click();
  assert.equal(pop.hidden, true, 'destroyed');
});

test('menuPop keepIn: a popover the stylesheet makes fixed (the ≤ 600 px top row scrolls sideways) goes under its button, inside the viewport; else it only shifts left', () => {
  const d = fresh(), win = d.defaultView, btn = mkEl(d, 'button'), pop = mkEl(d, 'div', 'gearPop');
  let pos = 'fixed';
  win.innerWidth = 375;
  win.getComputedStyle = el => ({ position: el === pop ? pos : 'static' });
  place(btn, 300, 7, 34, 34); place(pop, 0, 900, 300, 200);
  const M = T.menuPop(btn, pop, { pick: false });
  M.open();
  assert.deepEqual([pop.style.top, pop.style.left, pop.style.translate], ['49px', '67px', ''], 'under the button, its right edge 8 px inside');
  M.close();
  place(btn, 20, 7, 34, 34);
  M.open();
  assert.deepEqual([pop.style.top, pop.style.left], ['49px', '20px'], 'at the button\'s left edge when it fits');
  M.close();
  pos = 'absolute'; place(pop, 200, 49, 300, 200);
  M.open();
  assert.deepEqual([pop.style.top, pop.style.left, pop.style.translate], ['', '', '-133px 0'], 'in the row (absolute): no placement left over, shifted into the viewport');
  M.destroy();
});

test('sheet: a dialog in the layer (title, ✕, labelled), focus on ✕ and back after; ✕ / Escape / the backdrop (mouse: press; touch: tap) close it once, onClose runs', () => {
  const d = fresh(), layer = mkEl(d, 'div', 'ov'), opener = mkEl(d, 'button'), body = d.createElement('p');
  body.textContent = 'Help text';
  opener.focus();
  let closed = 0;
  const S = T.sheet({ title: 'Help & about', body, layer, onClose: () => { closed++; } });
  const bd = layer.children[0];
  assert.equal(bd.className, 'cv-sheet-bd');
  assert.deepEqual([S.el.getAttribute('role'), S.el.getAttribute('aria-modal')], ['dialog', 'true']);
  const h2 = S.el.children[0].children[0], x = S.el.children[0].children[1];
  assert.equal(S.el.getAttribute('aria-labelledby'), h2.id);
  assert.equal(h2.textContent, 'Help & about');
  assert.equal(S.body.children[0].textContent, 'Help text');
  assert.equal(d.activeElement === x, true, 'focus on ✕');
  x.click();
  assert.deepEqual([closed, layer.children.length, S.isOpen(), d.activeElement === opener], [1, 0, false, true]);
  S.close();
  assert.equal(closed, 1, 'once');
  const S2 = T.sheet({ title: 'A', body: d.createElement('div'), layer, onClose: () => { closed++; } });
  key(S2.el, 'Escape');
  assert.deepEqual([closed, layer.children.length], [2, 0]);
  const S3 = T.sheet({ title: 'B', body: d.createElement('div'), layer, onClose: () => { closed++; } });
  ptr(S3.el, 'pointerdown', 5, 5);
  assert.equal(closed, 2, 'a press inside the dialog');
  ptr(layer.children[0], 'pointerdown', 5, 5, { pointerType: 'touch' });
  assert.equal(closed, 2, 'a finger: not at the press');
  ptr(layer.children[0], 'pointerup', 30, 5, { pointerType: 'touch' });
  assert.equal(closed, 2, 'a slide is no tap');
  ptr(layer.children[0], 'pointerdown', 5, 5, { pointerType: 'touch' });
  ptr(layer.children[0], 'pointerup', 7, 6, { pointerType: 'touch' });
  assert.equal(closed, 3, 'a tap on the backdrop');
  T.sheet({ title: 'C', body: d.createElement('div'), layer, onClose: () => { closed++; } });
  ptr(layer.children[0], 'pointerdown', 5, 5);
  assert.deepEqual([closed, layer.children.length], [4, 0], 'a mouse press on the backdrop');
});

test('sourcesTray (1c): the "Hardware | Simple" switch — two aria-pressed buttons, onLayout on a change, the list marked (SIMPLE badges via CSS)', () => {
  const d = fresh(), list = d.createElement('div'), host = d.createElement('div'), got = [];
  d.body.append(host, list);
  const S = T.sourcesTray(list, { models: MODELS, pick() {}, drag: {}, layoutEl: host, layout: 'flow', onLayout: l => got.push(l) });
  const bs = host.children[0].children;
  assert.deepEqual(bs.map(b => [b.textContent, b.getAttribute('aria-pressed')]), [['Hardware', 'false'], ['Simple', 'true']]);
  assert.deepEqual([S.layout(), list.getAttribute('data-layout'), host.children[0].getAttribute('role')], ['flow', 'flow', 'group']);
  bs[0].click();
  assert.deepEqual([S.layout(), list.getAttribute('data-layout'), bs[0].getAttribute('aria-pressed'), got], ['hw', 'hw', 'true', ['hw']]);
  bs[0].click();
  assert.deepEqual(got, ['hw'], 'no change: no call');
  S.setLayout('flow');
  assert.deepEqual([bs[1].getAttribute('aria-pressed'), got], ['true', ['hw']], 'setLayout (a restore) does not call back');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.cv-tiles\[data-layout="flow"\] \.cv-tbadge \{ display: block; \}/);
  assert.match(css, /@media \(pointer: coarse\) \{ \.cv-segb \{ min-height: 44px;/, '44 px on a touch screen');
  S.destroy();
});

/* ---------------------------------------------------------------- the Effects tray (1e) */
// the rack's add menu (fx-ui addMenuItems shape: type, label, group; a disabled one skipped)
const FXI = [{ type: 'eq', label: 'EQ', group: 'Effects' }, { type: 'cho', label: 'Chorus', group: 'Effects' }, { type: 'rev', label: 'Hall Reverb', group: 'Effects' },
  { type: 'dly', label: 'Delay', group: 'Effects', disabled: true }, { type: 'split2', label: 'Splitter 2', group: 'Splitters' }];
function fxRig(o = {}) {
  const R = sideRig({ opts: { side: 'right', key: 'fx' } }), list = R.d.createElement('div'), layer = mkEl(R.d, 'div', 'ov');
  raf.install();
  R.panel.append(list);
  place(R.el, 1000, 100, 284, 600);
  R.S.open();
  const log = [], picks = [];
  let leaves = 0;
  // the canvas left of the tray; a panel module 'fx1' at x 400…700, y 200…500 (client px)
  const over = (t, x, y) => (x >= 1000 ? null : x >= 400 && x <= 700 && y >= 200 && y <= 500 ? { over: 'panel', key: 'fx1' } : 'canvas');
  const F = T.effectsTray(list, Object.assign({
    items: FXI, tray: R.el, layer, pick: id => picks.push(id), overOf: over, onLeave: () => { leaves++; },
    cost: id => (id === 'rev' ? '~3 %' : id === 'panel' ? '' : '~1 %'), toWorld: (x, y) => ({ x: (x - 100) * 2, y: (y - 50) * 2 }),
    drag: {
      begin: (id, i) => log.push('begin ' + id + ' ' + i.over),
      move: (id, i) => log.push('move ' + i.over + (i.key ? ':' + i.key : '')),
      drop: (id, i) => { log.push('drop ' + id + ' ' + i.over + ' ' + (i.key || '-') + ' @' + i.at.x + ',' + i.at.y); return true; },
      cancel: id => log.push('cancel ' + id),
    },
  }, o));
  R.list = list; R.layer = layer; R.F = F; R.log = log; R.picks = picks;
  Object.defineProperty(R, 'leaves', { get: () => leaves });
  return R;
}
const fxTile = (R, id) => R.F.tiles().find(t => t.getAttribute('data-fx') === id);

test('effectsTray (1e): the empty FX Panel tile first, then one tile per effect grouped as the rack\'s add menu (a heading per group), its cost on this device; a tap picks', () => {
  const R = fxRig();
  assert.deepEqual(R.F.tiles().map(t => t.getAttribute('data-fx')), ['panel', 'eq', 'cho', 'rev', 'split2'], 'a disabled item has no tile');
  assert.deepEqual(R.list.children.map(n => n.tagName === 'H3' ? '#' + n.textContent : n.getAttribute('data-fx')), ['#Panel', 'panel', '#Effects', 'eq', 'cho', 'rev', '#Splitters', 'split2']);
  assert.ok(R.F.tiles().every(t => t.tagName === 'BUTTON' && t.className === 'cv-tile cv-ftile' && t.getAttribute('type') === 'button'));
  const rev = fxTile(R, 'rev'), pan = fxTile(R, 'panel');
  assert.deepEqual(rev.children.map(c => c.className), ['cv-fglyph', 'cv-tname', 'cv-tcost']);
  assert.deepEqual([rev.children[0].textContent, rev.children[1].textContent, rev.children[2].textContent, rev.children[2].hidden], ['HR', 'Hall Reverb', '~3 %', false]);
  assert.deepEqual([pan.children[0].className, pan.children[1].textContent, pan.children[2].hidden], ['cv-fglyph cv-fpanel', 'Empty FX Panel', true], 'no cost: hidden');
  assert.equal(pan.children[0].getAttribute('aria-hidden'), 'true');
  assert.equal(fxTile(R, 'eq').children[0].textContent, 'EQ');
  rev.click(); pan.click();
  assert.deepEqual(R.picks, ['rev', 'panel']);
  assert.equal(R.S.isOpen(), true, 'a tap leaves it open');
  // costs re-read (a measured device factor)
  R.F.destroy();
  let k = 1;
  const F2 = T.effectsTray(R.list, { items: FXI, pick() {}, drag: {}, cost: () => '~' + k + ' %' });
  k = 7; F2.refresh();
  assert.equal(F2.tile('eq').children[2].textContent, '~7 %');
  assert.equal(F2.tile('nope'), null);
  assert.equal(R.list.children.filter(n => n.tagName === 'H3').length, 3, 'the first tray\'s headings went with it');
  F2.destroy();
});

test('effectsTray (1f): panel: false — no Empty FX Panel tile (nor a \'panel\' item), the effects only; their titles say they go into the track\'s effects', () => {
  const R = fxRig({ panel: false, items: [{ id: 'panel' }, ...FXI] });
  assert.deepEqual(R.F.tiles().map(t => t.getAttribute('data-fx')), ['eq', 'cho', 'rev', 'split2']);
  assert.deepEqual(R.list.children.map(n => n.tagName === 'H3' ? '#' + n.textContent : n.getAttribute('data-fx')), ['#Effects', 'eq', 'cho', 'rev', '#Splitters', 'split2']);
  assert.match(fxTile(R, 'rev').getAttribute('title'), /goes into the track’s effects$/);
  fxTile(R, 'rev').click();
  assert.deepEqual(R.picks, ['rev']);
  R.F.destroy();
});

test('effectsTray (1e): a tile drags out like a Sources tile — over a panel module (info.over \'panel\', info.key), over the canvas (\'canvas\'), info.at from toWorld; the tray never closes by itself (leaving it, dropping)', () => {
  const R = fxRig(), t = fxTile(R, 'rev'), tp = { pointerType: 'touch' };
  ptr(t, 'pointerdown', 1100, 300, at(tp));
  ptr(t, 'pointermove', 1088, 302, at(tp)); // (outward: across the tray's scroll axis)
  assert.deepEqual(R.log, ['begin rev null', 'move null']);
  assert.equal(R.layer.children[0].className, 'cv-tghost touch cv-fghost', 'the ghost in the layer');
  ptr(t, 'pointermove', 800, 300, at(tp));
  assert.deepEqual([R.leaves, R.S.isOpen(), R.log.at(-1)], [1, true, 'move canvas'], 'left the tray: still open');
  assert.equal(R.layer.children[0].children[1].textContent, '+ New panel with it');
  ptr(t, 'pointermove', 500, 300, at(tp));
  assert.equal(R.log.at(-1), 'move panel:fx1');
  assert.equal(R.layer.children[0].children[1].textContent, '+ Add to the panel');
  TS += 150;
  ptr(t, 'pointermove', 501, 301, at(tp)); ptr(t, 'pointerup', 501, 301, at(tp));
  assert.equal(R.log.at(-1), 'drop rev panel fx1 @802,502', 'dropped into the panel (world point)');
  assert.deepEqual([R.S.isOpen(), R.layer.children.length], [true, 0], 'still open; the ghost gone');
  // the empty panel tile over a panel module: a new panel there (never into a panel)
  R.log.length = 0;
  const p = fxTile(R, 'panel');
  ptr(p, 'pointerdown', 1100, 300, at(tp)); ptr(p, 'pointermove', 1088, 300, at(tp)); ptr(p, 'pointermove', 500, 300, at(tp));
  TS += 150;
  ptr(p, 'pointerup', 500, 300, at(tp));
  assert.deepEqual(R.log.slice(-2), ['move canvas', 'drop panel canvas - @800,500']);
  // a flick is a cancel; still open
  ptr(t, 'pointerdown', 1100, 300, at(tp)); ptr(t, 'pointermove', 1080, 300, at(tp)); ptr(t, 'pointermove', 300, 300, at(tp)); ptr(t, 'pointerup', 300, 300, at(tp));
  assert.deepEqual([R.log.at(-1), R.S.isOpen()], ['cancel rev', true]);
  // without toWorld: the client point
  R.F.destroy();
  const L2 = [];
  const F2 = T.effectsTray(R.list, { items: FXI, tray: R.el, layer: R.layer, pick() {}, overOf: () => 'canvas', drag: { drop: (id, i) => { L2.push(i.at.x + ',' + i.at.y + ' ' + i.over); return true; } } });
  const t2 = F2.tile('eq');
  ptr(t2, 'pointerdown', 1100, 300, at(tp)); ptr(t2, 'pointermove', 1088, 300, at(tp)); ptr(t2, 'pointermove', 600, 320, at(tp));
  TS += 150;
  ptr(t2, 'pointerup', 600, 320, at(tp));
  assert.deepEqual(L2, ['600,320 canvas']);
  assert.equal(R.S.isOpen(), true);
  F2.destroy();
});

test('index.html (1e): the Effects tray holds its list (#fxList, the tiles\' grid) — every id main.js binds kept; style.css: the tiles, ⏻, [data-off], the zone pill, the badge, cv-ok / cv-no, cv-off, the cable selection and its ×', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['fxTray', 'fxRail', 'fxPanel', 'fxClose', 'fxGrip', 'fxList']) assert.match(html, new RegExp('id="' + id + '"'), id);
  assert.match(html, /<div id="fxList" class="cv-tiles cv-ftiles"/);
  assert.ok(!html.includes('Effect tiles you can drag onto the canvas or into a panel arrive'), 'the placeholder went');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  for (const sel of ['.cv-tgrp', '.cv-fglyph', '.cv-tcost', 'button.cv-pow', '.cv-mod[data-off] > .cv-body', '.cv-badge', '.cv-zone', '.cv-zpop', '.cv-jack.cv-ok',
    '#world[data-cv-patching] .cv-jack.cv-no', '.cv-cable-g.cv-off .cv-cable', '.cv-cable-g.cv-sel .cv-cable', '.cv-cable-x']) assert.ok(css.includes(sel + ' '), sel);
  assert.match(css, /\.cv-cable-x \{[^}]*width: calc\(30px \* var\(--ik, 1\)\)/, 'the × keeps its screen size');
  assert.match(css, /\.cv-zone::before \{[^}]*calc\(44px \* var\(--ik, 1\)\)/, 'the pill\'s hit area via ::before');
});

/* ---------------------------------------------------------------- UI fixes (stage 1e review, fixer U) */
test('U15: an open side tray tells its stage (the parent: class cv-left-open / cv-right-open, --cv-left-w / --cv-right-w) — the canvas toolbar moves right of the open Sources tray (style.css)', () => {
  const R = sideRig(), host = R.el.parentNode;
  assert.deepEqual([host.classList.contains('cv-left-open'), host.style['--cv-left-w']], [false, '240px'], 'closed: its width known, no class');
  R.rail.click();
  assert.deepEqual([host.classList.contains('cv-left-open'), host.style['--cv-left-w']], [true, '240px']);
  R.S.setWidth(300);
  assert.equal(host.style['--cv-left-w'], '300px', 'a resize follows');
  R.S.close();
  assert.equal(host.classList.contains('cv-left-open'), false);
  const L = sideRig({ opts: { side: 'right', key: 'fx' } });
  L.S.open();
  assert.deepEqual([L.el.parentNode.classList.contains('cv-right-open'), L.el.parentNode.style['--cv-right-w']], [true, '240px']);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.cv-left-open > \.cv-toolbar \{[^}]*left: calc\(56px \+ var\(--cv-left-w, 240px\)\)/, 'the toolbar past the open Sources tray');
});

test('effectsTray (U11): over an instrument module (overOf → {over: \'inst\', key}) an effect goes into its FX (\'+ Add to its effects\'); the panel tile over a module is a canvas drop beside it (info.near: that module)', () => {
  const L = [];
  // the canvas left of the tray: a panel module 'fx1' at x 400…700, y 200…500, an instrument 'i2' at x 400…700, y 520…700
  const over = (t, x, y) => (x >= 1000 ? null : x >= 400 && x <= 700 && y >= 200 && y <= 500 ? { over: 'panel', key: 'fx1' } : x >= 400 && x <= 700 && y >= 520 ? { over: 'inst', key: 'i2' } : 'canvas');
  const R = fxRig({ overOf: over, drag: { move: (id, i) => L.push('move ' + i.over + ':' + (i.key || '-') + ':' + (i.near || '-')), drop: (id, i) => { L.push('drop ' + id + ' ' + i.over + ':' + (i.key || '-') + ':' + (i.near || '-')); return true; } } });
  const tp = { pointerType: 'touch' }, go = (id, x, y) => {
    const t = fxTile(R, id);
    ptr(t, 'pointerdown', 1100, 300, at(tp)); ptr(t, 'pointermove', 1088, 302, at(tp)); ptr(t, 'pointermove', x, y, at(tp));
    const lab = R.layer.children[0] ? R.layer.children[0].children[1].textContent : '';
    TS += 150;
    ptr(t, 'pointerup', x, y, at(tp));
    return lab;
  };
  assert.equal(go('rev', 500, 600), '+ Add to its effects');
  assert.deepEqual(L.slice(-2), ['move inst:i2:-', 'drop rev inst:i2:-']);
  assert.equal(go('panel', 500, 600), '+ New FX panel');
  assert.deepEqual(L.slice(-2), ['move canvas:-:i2', 'drop panel canvas:-:i2'], 'beside the instrument');
  go('panel', 500, 300);
  assert.equal(L.at(-1), 'drop panel canvas:-:fx1', 'beside the panel (never into it)');
  go('rev', 200, 300);
  assert.equal(L.at(-1), 'drop rev canvas:-:-', 'empty canvas: no module near');
  assert.equal(R.S.isOpen(), true);
});

/* ---------------------------------------------------------------- stage 2a: the Modulators section (IMPL-2a §3) */
const MODS = [{ id: 'wheel', name: 'Mod Wheel', scope: 'project' }, { id: 'velo', name: 'Velocity', scope: 'track' }, { id: 'at', name: 'Aftertouch', scope: 'track' }, { id: 'bend', name: 'Bend', scope: 'track' }];
function modRig(o = {}) {
  const d = fresh();
  raf.install();
  const tray = mkEl(d, 'aside', 'srcTray'), list = d.createElement('div'), sec = d.createElement('section'), box = d.createElement('div'), layer = mkEl(d, 'div', 'ov');
  sec.hidden = true; sec.append(box);
  tray.append(list, sec);
  place(tray, 0, 100, 284, 600);
  const log = [], picks = [];
  let leaves = 0;
  const S = T.sourcesTray(list, Object.assign({
    models: MODELS, tray, layer, pick: (id, mode) => picks.push(id + ':' + mode), mods: MODS, modsEl: box, modsSec: sec,
    overOf: (t, x, y) => (y < 100 ? 'tracks' : x > 300 ? 'canvas' : null), canvasGhost: () => true, onLeave: () => { leaves++; },
    toWorld: (x, y) => ({ x: x * 2, y: y - 100 }),
    drag: {
      begin: (id, i) => log.push('begin ' + id + ' ' + i.over + (i.mod ? ' mod' : '')),
      move: (id, i) => log.push('move ' + i.over),
      drop: (id, i) => { log.push('drop ' + id + ' ' + i.over + (i.mod ? ' mod' : '') + (i.at ? ' @' + i.at.x + ',' + i.at.y : '')); return !!i.over; },
      cancel: id => log.push('cancel ' + id),
    },
  }, o));
  return { d, tray, list, sec, box, layer, S, log, picks, get leaves() { return leaves; } };
}
const mtile = (R, id) => R.S.modTile(id);

test('sourcesTray (2a): the Modulators section — one tile per modulator (an original glyph, its name, a hidden reason) in its own box, the section shown; tiles() stays the synths\'; a tap picks in the tray\'s mode; without modsEl a heading and the tiles follow the synths; without o.mods nothing changes', () => {
  const R = modRig();
  assert.deepEqual([R.sec.hidden, R.S.modTiles().map(b => b.getAttribute('data-mod')), R.box.children.length], [false, ['wheel', 'velo', 'at', 'bend'], 4]);
  assert.equal(R.S.tiles().length, MODELS.length, 'tiles(): the synths only');
  const w = mtile(R, 'wheel');
  assert.deepEqual([w.tagName, w.className, w.type, w.getAttribute('data-scope'), w.children.map(c => c.className), w.children[1].textContent, w.children[2].hidden],
    ['BUTTON', 'cv-tile cv-mtile', 'button', 'project', ['cv-mglyph', 'cv-tname', 'cv-treason'], 'Mod Wheel', true]);
  assert.ok(/<svg /.test(w.children[0].innerHTML) && w.children[0].getAttribute('aria-hidden') === 'true', 'a glyph (inline SVG, monochrome: currentColor in CSS)');
  assert.equal(new Set(R.S.modTiles().map(b => b.children[0].innerHTML)).size, 4, 'one glyph each');
  assert.equal(w.title, 'Mod Wheel — tap to add it (one for the whole project), or drag it onto the canvas');
  mtile(R, 'velo').click();
  R.S.setMode('track');
  mtile(R, 'at').click();
  assert.deepEqual(R.picks, ['velo:replace', 'at:track']);
  R.S.destroy();
  assert.equal(R.box.children.length, 0, 'destroy takes the tiles');
  // modPick / modDrag win; no modsEl: a heading after the synths in the list
  const d = fresh(), list = d.createElement('div'), mp = [];
  d.body.append(list);
  const S2 = T.sourcesTray(list, { models: MODELS.slice(0, 2), mods: MODS.slice(0, 2), pick: () => mp.push('synth pick'), modPick: id => mp.push('mod ' + id), drag: {} });
  assert.deepEqual(list.children.map(n => (n.tagName === 'H3' ? '#' + n.textContent : n.getAttribute('data-model') || n.getAttribute('data-mod'))), [MODELS[0].id, MODELS[1].id, '#Modulators', 'wheel', 'velo']);
  S2.modTile('wheel').click();
  assert.deepEqual(mp, ['mod wheel']);
  S2.destroy();
  const list3 = d.createElement('div');
  const S3 = T.sourcesTray(list3, { models: MODELS.slice(0, 2), pick() {}, drag: {} });
  assert.deepEqual([list3.children.length, S3.modTiles().length, S3.modTile('wheel')], [2, 0, null], 'no o.mods: the 1e tray');
  S3.destroy();
});

test('sourcesTray (2a): a modulator tile drags out as a synth tile — over the canvas only (never \'tracks\'), info.mod, info.at in world px (toWorld); the ghost stays (no canvas outline for it unless modCanvasGhost); the tray stays open', () => {
  const R = modRig(), t = mtile(R, 'velo'), tp = { pointerType: 'touch' };
  ptr(t, 'pointerdown', 100, 300, at(tp)); ptr(t, 'pointermove', 112, 302, at(tp));
  assert.deepEqual([R.log, R.layer.children[0].className], [['begin velo null mod', 'move null'], 'cv-tghost touch cv-mghost']);
  ptr(t, 'pointermove', 400, 300, at(tp));
  assert.deepEqual([R.leaves, R.log.at(-1), R.layer.children[0].classList.contains('off'), R.layer.children[0].children[1].textContent], [1, 'move canvas', false, '+ Add Velocity']);
  TS += 150;
  ptr(t, 'pointermove', 402, 301, at(tp)); ptr(t, 'pointerup', 402, 301, at(tp));
  assert.equal(R.log.at(-1), 'drop velo canvas mod @804,201');
  assert.equal(R.layer.children.length, 0, 'the ghost gone');
  // over the track list: no target (a modulator is no new track); a flick: a cancel
  R.log.length = 0;
  ptr(t, 'pointerdown', 100, 300, at(tp)); ptr(t, 'pointermove', 120, 300, at(tp)); ptr(t, 'pointermove', 200, 50, at(tp));
  TS += 200;
  ptr(t, 'pointerup', 200, 50, at(tp));
  assert.deepEqual(R.log.slice(-2), ['move null', 'cancel velo']);
  R.log.length = 0;
  ptr(t, 'pointerdown', 100, 300, at(tp)); ptr(t, 'pointermove', 120, 300, at(tp)); ptr(t, 'pointermove', 500, 300, at(tp)); ptr(t, 'pointerup', 500, 300, at(tp));
  assert.deepEqual(R.log.slice(-1), ['cancel velo'], 'flicked');
  R.S.destroy();
  // modCanvasGhost: the world draws it
  const R2 = modRig({ modCanvasGhost: () => true }), t2 = mtile(R2, 'at');
  ptr(t2, 'pointerdown', 100, 300, at(tp)); ptr(t2, 'pointermove', 112, 302, at(tp)); ptr(t2, 'pointermove', 400, 300, at(tp));
  assert.equal(R2.layer.children[0].classList.contains('off'), true);
  ptr(t2, 'pointercancel', 400, 300, at(tp));
  R2.S.destroy();
});

test('sourcesTray (2a): setPlaced greys a tile with its reason (aria-disabled, cv-placed, the reason shown, the title) — then it neither picks nor drags; null makes it available again', () => {
  const R = modRig(), w = mtile(R, 'wheel'), tp = { pointerType: 'touch' };
  R.S.setPlaced('wheel', 'already in this project');
  assert.deepEqual([w.classList.contains('cv-placed'), w.getAttribute('aria-disabled'), w.children[2].hidden, w.children[2].textContent, w.title, R.S.placed('wheel')],
    [true, 'true', false, 'already in this project', 'Mod Wheel — already in this project', 'already in this project']);
  w.click();
  ptr(w, 'pointerdown', 100, 300, at(tp)); ptr(w, 'pointermove', 112, 302, at(tp)); ptr(w, 'pointermove', 400, 300, at(tp));
  TS += 150;
  ptr(w, 'pointermove', 402, 301, at(tp)); ptr(w, 'pointerup', 402, 301, at(tp));
  assert.deepEqual([R.picks, R.log, R.layer.children.length], [[], [], 0], 'no pick, no drag, no ghost');
  R.S.setPlaced('velo', 'already on this track');
  R.S.setPlaced('wheel', null);
  assert.deepEqual([w.classList.contains('cv-placed'), w.hasAttribute('aria-disabled'), w.children[2].hidden, w.title, R.S.placed('wheel'), R.S.placed('velo')],
    [false, false, true, 'Mod Wheel — tap to add it (one for the whole project), or drag it onto the canvas', null, 'already on this track']);
  w.click();
  assert.deepEqual(R.picks, ['wheel:replace']);
  R.S.setPlaced('nope', 'x');
  R.S.destroy();
});

test('index.html (2a): the Sources tray scrolls as one (#srcScroll) holding #srcList and the Modulators section (#srcModSec hidden until the tray fills it, #srcMods) — every id main.js binds kept; style.css: the section, the tiles, the placed state, the ∿ modes, the mod jack, mod cables, the badge, the patching states, the bodies', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['srcTray', 'srcRail', 'srcPanel', 'srcClose', 'srcMode', 'srcLayout', 'srcList', 'srcGrip', 'srcScroll', 'srcModSec', 'srcMods']) assert.match(html, new RegExp('id="' + id + '"'), id);
  assert.match(html, /<div id="srcScroll" class="cv-tscroll">\s*<div id="srcList" class="cv-tiles"><\/div>\s*<section id="srcModSec" class="cv-tsec" aria-label="Modulators" hidden>\s*<h3 class="cv-tgrp">Modulators<\/h3>\s*<div id="srcMods" class="cv-tiles cv-mtiles" data-tray="mods"><\/div>/);
  assert.ok(!/modulators arrive here in later stages/.test(html), 'the old note went');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  for (const sel of ['.cv-tscroll', '.cv-tsec[hidden]', '.cv-mglyph', '.cv-treason', '.cv-tile.cv-placed', '.cv-tb-btn[data-cv-tb="mods"][data-mode="never"]', '.cv-jack[data-kind="mod"]',
    '.cv-cable-g[data-kind="mod"] .cv-cable', '.cv-cable-g[data-kind="mod"] .cv-cable-hit', '.cv-cable-g[data-kind="mod"].cv-preset .cv-cable', '.cv-cable-g.cv-hide', '.cv-mbadge', '.cv-mbadge::before', '.cv-ptag',
    '#world[data-cv-patching="mod"] [data-dest]:not(.cv-ok)', '#world[data-cv-patching="mod"] .cv-mod.cv-nodest > .cv-body', '#world[data-cv-patching="mod"] [data-dest].cv-ok', '.cv-mw', '.cv-mw-slot', '.cv-mothers', '.cv-mbar']) assert.ok(css.includes(sel + ' '), sel);
  assert.match(css, /\.cv-cable-g\[data-kind="mod"\] \.cv-cable \{ stroke-width: calc\(2px \* var\(--ik, 1\)\)/, 'mod cables 2 px on screen');
  assert.match(css, /\.cv-mbadge::before \{[^}]*calc\(44px \* var\(--ik, 1\)\)/, 'the badge\'s 44 px hit area');
  assert.match(css, /\.cv-mw \{[^}]*touch-action: none/, 'the wheel takes the finger');
  assert.match(css, /\.cv-tscroll \{[^}]*overflow-y: auto/);
});
