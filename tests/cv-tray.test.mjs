import './v8-guard.mjs';
// cv-tray.js (stage 1b SHELL lane; docs/canvas/IMPL-1b.md §8.1): budget(), topSnaps(), trayGrip (drag, two-finger
// rollback, keys, double-tap, ARIA), sideTray (tap opens, grip inset, stays open on a press outside, never closes itself), sourcesTray
// drag verdicts (out / along / hold) and drop routing, menuPop, sheet; (1e) effectsTray (tiles, groups, costs, drops into
// a panel / onto the canvas, never closing the tray), the Effects tray markup and the 1e styles; (2a) the Modulators section
// (tiles, picks, drags onto the canvas, setPlaced), its markup and the 2a styles; (7a) the Drums view; (8) the SDS-V tile and the Controllers view. Fake DOM: tests/wk-dom.mjs; never pass fake-DOM
// nodes to assert.* (ids, strings and numbers only).
// Run alone: node --max-old-space-size=2048 --test tests/cv-tray.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fresh, raf, ptr, fire, key, place, advance } from './wk-dom.mjs';
import * as T from '../cv-tray.js?v=9';
import { MODELS, classicOf } from '../models.js?v=9';
import * as MG from '../moog-core.js?v=9';
import * as cvArt from '../cv-art.js?v=9';

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

// (2026-10-19, the user's request: "make the hardware/simple switch … into a dropdown menu that includes a new section called
// serum … to keep them separate") — was the 1c "Hardware | Simple" segmented pair (aria-pressed buttons): now a dropdown
test('sourcesTray (views): the dropdown — a button showing the view (aria-haspopup menu, aria-expanded), a menu of menuitemradio views; Hardware / Simple show the classic synths only, Serum the Serum tile, the Modulators and the placeholder sections; onView on a change only; setView / setLayout restore without a call; the note follows', () => {
  const d = fresh(), host = mkEl(d), list = mkEl(d), sec = mkEl(d), note = mkEl(d, 'p'), out = mkEl(d), got = [];
  const S = T.sourcesTray(list, { models: MODELS, pick() {}, drag: {}, layoutEl: host, secEl: sec, noteEl: note, layout: 'flow', onLayout: l => got.push(l) });
  const [btn, menu] = host.children, items = menu.children, shown = () => S.tiles().filter(b => !b.hidden).map(b => b.getAttribute('data-model'));
  const secs = () => sec.children.map(s => s.getAttribute('data-sec') + (s.hidden ? ':hidden' : ''));
  const classic = MODELS.filter(classicOf).map(m => m.id); // ((7a) the drum machines: the Drums view; (9) models.js classicOf — the 900 Series: the Moog modules view)
  assert.deepEqual([btn.tagName, btn.className, btn.type, btn.getAttribute('aria-haspopup'), btn.getAttribute('aria-expanded'), btn.children[0].textContent, btn.getAttribute('aria-label')],
    ['BUTTON', 'cv-vbtn', 'button', 'menu', 'false', 'Simple', 'Sources view: Simple']);
  assert.deepEqual([menu.getAttribute('role'), menu.hidden, items.map(b => [b.getAttribute('role'), b.getAttribute('data-view'), b.children[0].textContent, b.getAttribute('aria-checked')])],
    ['menu', true, [['menuitemradio', 'hw', 'Hardware', 'false'], ['menuitemradio', 'flow', 'Simple', 'true'], ['menuitemradio', 'serum', 'Serum', 'false'], ['menuitemradio', 'drums', 'Drums', 'false'], ['menuitemradio', 'ctl', 'Controllers', 'false'], ['menuitemradio', 'moog', 'Moog modules', 'false']]]);
  assert.deepEqual([S.view(), S.layout(), S.views(), list.getAttribute('data-layout'), list.getAttribute('data-view')], ['flow', 'flow', ['hw', 'flow', 'serum', 'drums', 'ctl', 'moog'], 'flow', 'flow']);
  assert.deepEqual(shown(), classic, 'Simple: the twelve classics, no Serum');
  assert.ok(classic.length === 12 && !classic.includes('serum') && !classic.includes('tr808') && !classic.includes('tr606'));
  assert.deepEqual([secs(), note.textContent], [['parts:hidden', 'notes:hidden'], 'Serum and its modulators: the Serum view (the menu above).']);
  // a tap opens; the Serum item picks (one call), closes it; the classics hide, the Serum tile and the placeholders show
  btn.click();
  assert.deepEqual([menu.hidden, btn.getAttribute('aria-expanded'), S.viewOpen()], [false, 'true', true]);
  items[2].click();
  assert.deepEqual([S.view(), got, menu.hidden, btn.getAttribute('aria-expanded'), btn.children[0].textContent, items.map(b => b.getAttribute('aria-checked')).join()],
    ['serum', ['serum'], true, 'false', 'Serum', 'false,false,true,false,false,false']);
  assert.deepEqual([shown(), secs(), sec.children[0].children.map(c => c.textContent), sec.children[1].children[1].textContent, list.getAttribute('data-layout'), S.layout()],
    [['serum'], ['parts', 'notes'], ['Serum parts', 'Arrive in milestone 3.'], 'Note tools: later.', 'flow', 'flow'], 'Serum: its tile, the placeholders; the classics\' layout kept');
  assert.equal(note.textContent, 'Drop a modulator on the canvas and cable its jack to any knob.');
  // the same view again: no call; a press outside closes it (nothing picked); the button again closes it
  btn.click(); items[2].click();
  assert.deepEqual([got, S.viewOpen()], [['serum'], false], 'no change: no call');
  btn.click(); ptr(out, 'pointerdown', 5, 5);
  assert.deepEqual([S.viewOpen(), S.view()], [false, 'serum'], 'outside');
  btn.click(); btn.click();
  assert.equal(S.viewOpen(), false, 'the button again');
  // keys: ↓ on the button opens it on the current view; Escape (on the button or in the menu) closes it, focus on the button
  let e = key(btn, 'ArrowDown');
  assert.deepEqual([S.viewOpen(), e.defaultPrevented, d.activeElement === items[2]], [true, true, true]);
  e = key(items[2], 'Escape');
  assert.deepEqual([S.viewOpen(), e.defaultPrevented, d.activeElement === btn], [false, true, true]);
  key(btn, 'ArrowUp'); e = key(btn, 'Escape');
  assert.deepEqual([S.viewOpen(), e.defaultPrevented], [false, true], 'Escape on the button: consumed (the tray stays open)');
  assert.equal(key(btn, 'Escape').defaultPrevented, false, 'closed: the page\'s Escape');
  // Enter / Space (a click without a pointer, detail 0): opens on the current view; a pick from the keys puts focus back
  fire(btn, 'click', { detail: 0 });
  assert.deepEqual([S.viewOpen(), d.activeElement === items[2]], [true, true]);
  fire(items[0], 'click', { detail: 0 });
  assert.deepEqual([S.view(), S.layout(), got, S.viewOpen(), d.activeElement === btn, shown(), secs()], ['hw', 'hw', ['serum', 'hw'], false, true, classic, ['parts:hidden', 'notes:hidden']]);
  // restores: no call
  S.setLayout('flow');
  assert.deepEqual([S.view(), list.getAttribute('data-layout'), btn.children[0].textContent, got.length], ['flow', 'flow', 'Simple', 2], 'setLayout (a restore) does not call back');
  S.setView('serum'); S.setView('nope');
  assert.deepEqual([S.view(), S.layout(), got.length], ['hw', 'hw', 2], 'an unknown view: the first');
  assert.deepEqual([S.closeView(), (btn.click(), S.closeView()), S.viewOpen()], [false, true, false]);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.cv-tiles\[data-layout="flow"\] \.cv-tbadge \{ display: block; \}/);
  assert.match(css, /@media \(pointer: coarse\) \{ \.cv-vbtn \{ min-height: 44px;/, '44 px on a touch screen');
  for (const sel of ['.cv-vbtn', '.cv-vmenu', '.cv-menupop > button.cv-vitem', '.cv-vitem[aria-checked="true"] .cv-vname', '.cv-tsoon > .cv-tnote', '.cv-srclay']) assert.ok(css.includes(sel + ' '), sel);
  assert.match(css, /\.cv-tile\[hidden\] \{ display: none; \}/, 'a hidden tile goes (its display: flex would win over [hidden])');
  S.destroy();
  assert.deepEqual([host.children.length, sec.children.length], [0, 0], 'destroy takes what it made');
});

test('sourcesTray (views): data-driven — o.views lists the views in order (a later family is one more entry); the given button / menu are used; a view with no layout keeps the classics\'', () => {
  const d = fresh(), list = mkEl(d), sec = mkEl(d), btn = mkEl(d, 'button'), menu = mkEl(d), got = [];
  // ((7a) Drums, (8) Controllers, (9) Moog modules are entries of SRC_VIEWS now: the later family here is a fictional one, appended after the six)
  const views = [...T.SRC_VIEWS, { id: 'later', label: 'Later', tip: 'A later family', sections: [{ id: 'kits', head: 'A later family', note: 'Arrive later.' }] }];
  const S = T.sourcesTray(list, { models: MODELS, pick() {}, drag: {}, viewBtn: btn, viewMenu: menu, secEl: sec, views, view: 'flow', onView: v => got.push(v) });
  assert.deepEqual([menu.children.map(b => b.getAttribute('data-view')), btn.children.map(c => c.className), menu.getAttribute('role'), btn.children[0].textContent], [['hw', 'flow', 'serum', 'drums', 'ctl', 'moog', 'later'], ['cv-vlab', 'cv-vcaret'], 'menu', 'Simple']);
  btn.click(); menu.children[6].click();
  assert.deepEqual([S.view(), S.layout(), got, S.tiles().filter(b => !b.hidden).length, sec.children.map(s => s.getAttribute('data-sec') + (s.hidden ? ':hidden' : ''))],
    ['later', 'flow', ['later'], 0, ['parts:hidden', 'notes:hidden', 'kits']]);
  S.destroy();
  assert.deepEqual([btn.children.length, menu.children.length, sec.children.length], [2, 0, 0], 'the given button stays; the items go');
});

// (7a, IMPL-7a §8 item 1) the Drums view: the drum machines only, with their real front panel ('hw'); Hardware / Simple list
// the twelve classic synths; a drum tile has no SIMPLE badge, no simple / hardware aria text and names no maker (D4); a
// stored view 'drums' opens Drums; the dropdown reads Hardware · Simple · Serum · Drums
test('sourcesTray (7a, 7b, 7c, 8): the Drums view — the TR-808, the TR-606, the TR-909 and the SDS-V, layout hw; no SIMPLE badge, no maker on their tiles; Hardware / Simple without them; a stored "drums" view opens it', () => {
  const d = fresh(), host = mkEl(d), list = mkEl(d), sec = mkEl(d), note = mkEl(d, 'p'), got = [], picks = [];
  const S = T.sourcesTray(list, { models: MODELS, pick: (id, m) => picks.push([id, m]), drag: {}, layoutEl: host, secEl: sec, noteEl: note, view: 'drums', onView: v => got.push(v) });
  const [btn, menu] = host.children, shown = () => S.tiles().filter(b => !b.hidden).map(b => b.getAttribute('data-model'));
  const drums = MODELS.filter(m => m.family === 'drums').map(m => m.id), tile = S.tiles().find(b => b.getAttribute('data-model') === 'tr808'), tile6 = S.tiles().find(b => b.getAttribute('data-model') === 'tr606'), tile9 = S.tiles().find(b => b.getAttribute('data-model') === 'tr909'), tileV = S.tiles().find(b => b.getAttribute('data-model') === 'sdsv');
  assert.deepEqual(drums, ['tr808', 'tr606', 'tr909', 'sdsv']);
  assert.deepEqual([S.view(), S.layout(), shown(), list.getAttribute('data-view'), list.getAttribute('data-layout'), btn.children[0].textContent],
    ['drums', 'hw', ['tr808', 'tr606', 'tr909', 'sdsv'], 'drums', 'hw', 'Drums'], 'a stored view "drums" opens Drums (layout hw)');
  assert.equal(note.textContent, 'More machines later.');
  assert.deepEqual(menu.children.map(b => b.children[0].textContent), ['Hardware', 'Simple', 'Serum', 'Drums', 'Controllers', 'Moog modules']);
  assert.deepEqual(T.SRC_VIEWS.find(V => V.id === 'drums').tip, 'Drum machines with their real front panel');
  // the tile: no SIMPLE badge, no aria-description in any view, no maker word (D4), "our model of its circuits"
  assert.deepEqual([tile.children.map(c => c.className), tile.children[2].textContent, tile.getAttribute('aria-description')],
    [['cv-tart', 'cv-tname', 'cv-tmeta'], '1980 · drum machine', null]);
  assert.ok(!/roland/i.test(tile.title + tile.textContent) && /our model of its circuits, not recordings/.test(tile.title), tile.title);
  // (7b) the 606's tile: the same shape — its own art, "1981 · drum machine", no SIMPLE badge, no aria text, no maker word
  assert.deepEqual([tile6.children.map(c => c.className), tile6.children[1].textContent, tile6.children[2].textContent, tile6.getAttribute('aria-description')],
    [['cv-tart', 'cv-tname', 'cv-tmeta'], 'TR-606', '1981 · drum machine', null]);
  assert.ok(!/roland|drumatix/i.test(tile6.title + tile6.textContent) && /our model of its circuits, not recordings/.test(tile6.title), tile6.title);
  assert.match(tile6.children[0].innerHTML, /data-art="tr606"/);
  // (7c) the 909's tile: the same shape — its own art, "1983 · drum machine", no SIMPLE badge, no aria text, no maker word; its tip says which sounds are ours (D4)
  assert.deepEqual([tile9.children.map(c => c.className), tile9.children[1].textContent, tile9.children[2].textContent, tile9.getAttribute('aria-description')],
    [['cv-tart', 'cv-tname', 'cv-tmeta'], 'TR-909', '1983 · drum machine', null]);
  assert.ok(!/roland/i.test(tile9.title + tile9.textContent), tile9.title);
  assert.equal(tile9.title, 'TR-909 (1983) — our model of its analog circuits; its hi-hats and cymbals are our own sounds through its playback circuit, not recordings — tap to use it, or drag it onto the canvas or the track list');
  assert.match(tile9.children[0].innerHTML, /data-art="tr909"/);
  // (8) the SDS-V's tile: the same shape — its own art, "1981 · drum synth" (it is no machine with a sequencer), no SIMPLE badge, no aria text, no maker word
  // (Simmons stays in models.js as a label only, D4); its tip says its sounds are ours and that it has no sequencer
  assert.deepEqual([tileV.children.map(c => c.className), tileV.children[1].textContent, tileV.children[2].textContent, tileV.getAttribute('aria-description')],
    [['cv-tart', 'cv-tname', 'cv-tmeta'], 'SDS-V', '1981 · drum synth', null]);
  assert.ok(!/simmons/i.test(tileV.title + tileV.textContent + tileV.children[0].innerHTML), tileV.title);
  assert.equal(tileV.title, 'SDS-V (1981) — our model of its analog circuits, with our own factory sounds, not recordings; no sequencer — play it from its pads, a Pads module, the keyboard or MIDI — tap to use it, or drag it onto the canvas or the track list');
  assert.match(tileV.children[0].innerHTML, /data-art="sdsv"/);
  const jun = S.tiles().find(b => b.getAttribute('data-model') === 'juno60');
  assert.deepEqual([jun.children[3].className, jun.getAttribute('aria-description')], ['cv-tbadge', 'hardware panel'], 'a classic keeps its badge and aria text');
  // Hardware / Simple: the twelve classics (the four drum machines hidden); back to Drums
  for (const v of ['hw', 'flow']) {
    S.setView(v);
    assert.deepEqual([shown().length, shown().includes('tr808'), shown().includes('tr606'), shown().includes('tr909'), shown().includes('sdsv'), tile.hidden, tile6.hidden, tile9.hidden, tileV.hidden, tile9.getAttribute('aria-description')],
      [12, false, false, false, false, true, true, true, true, null], v);
  }
  S.setView('serum'); assert.deepEqual(shown(), ['serum']);
  btn.click(); menu.children[3].click();
  assert.deepEqual([S.view(), S.layout(), got, shown()], ['drums', 'hw', ['drums'], ['tr808', 'tr606', 'tr909', 'sdsv']], 'picked: layout hw (a drum machine has no Simple layout)');
  tile.click(); tile6.click(); tile9.click(); tileV.click();
  assert.deepEqual(picks, [['tr808', 'replace'], ['tr606', 'replace'], ['tr909', 'replace'], ['sdsv', 'replace']], 'a tap picks any of them as any instrument');
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
    models: MODELS, tray, layer, pick: (id, mode) => picks.push(id + ':' + mode), mods: MODS, modsEl: box, modsSec: sec, view: 'serum', // (2026-10-19: the Serum view's)
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
  R.S.setView('hw');
  assert.equal(R.sec.hidden, true, '(2026-10-19) Hardware / Simple: no Modulators (the Serum view\'s)');
  R.S.setView('serum');
  assert.equal(R.sec.hidden, false);
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
  assert.deepEqual(list.children.map(n => n.hidden), [false, false, true, true, true], '(2026-10-19) Hardware: the heading and the modulators hidden');
  S2.setView('serum');
  assert.deepEqual(list.children.map(n => n.hidden), [true, true, false, false, false], 'Serum: the modulators, no classic');
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
  for (const id of ['srcTray', 'srcRail', 'srcPanel', 'srcClose', 'srcMode', 'srcLayout', 'srcList', 'srcGrip', 'srcScroll', 'srcModSec', 'srcMods', 'srcView', 'srcViewMenu', 'srcNote']) assert.match(html, new RegExp('id="' + id + '"'), id);
  // (2026-10-19) the view dropdown in #srcLayout: its button (the view, ▾) and its menu (the tray fills it)
  assert.match(html, /<div id="srcLayout" class="cv-srclay"><button id="srcView" class="cv-vbtn" type="button" aria-haspopup="menu"><span class="cv-vlab">Hardware<\/span><span class="cv-vcaret" aria-hidden="true">▾<\/span><\/button><div id="srcViewMenu" class="cv-pop cv-menupop cv-vmenu" role="menu" aria-label="Sources view" hidden><\/div><\/div>/);
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

/* ---------------------------------------------------------------- stage 2b (IMPL-2b §6.1): the six new tiles */
test('sourcesTray (2b): MOD_TILES lists every kind in MOD_ORDER (the wheel project-scoped; LFO / ENV / Macro / CC / Chaos multi); the tiles carry original glyphs (one each) and data-multi; a multi tile never greys out (setPlaced ignored); the Serum view\'s note and the Note tools placeholder re-worded', () => {
  assert.deepEqual(T.MOD_TILES.map(m => m.id + ':' + m.scope + (m.multi ? ':multi' : '')), ['wheel:project', 'velo:track', 'at:track', 'bend:track', 'note:track', 'lfo:track:multi', 'env:track:multi', 'macro:track:multi', 'cc:track:multi', 'chaos:track:multi']);
  const R = modRig({ mods: T.MOD_TILES });
  assert.deepEqual([R.S.modTiles().length, new Set(R.S.modTiles().map(b => b.children[0].innerHTML)).size], [10, 10], 'ten tiles, ten glyphs');
  assert.ok(R.S.modTiles().every(b => /<svg /.test(b.children[0].innerHTML) && !/<text|<image|href/.test(b.children[0].innerHTML)), 'inline strokes, no text / images / links');
  const lfo = mtile(R, 'lfo'), velo = mtile(R, 'velo');
  assert.deepEqual([lfo.hasAttribute('data-multi'), velo.hasAttribute('data-multi'), lfo.title, mtile(R, 'wheel').title],
    [true, false, 'LFO — tap to add one, or drag it onto the canvas', 'Mod Wheel — tap to add it (one for the whole project), or drag it onto the canvas']);
  R.S.setPlaced('lfo', 'already on this track'); R.S.setPlaced('velo', 'already on this track');
  assert.deepEqual([lfo.classList.contains('cv-placed'), lfo.hasAttribute('aria-disabled'), R.S.placed('lfo'), velo.classList.contains('cv-placed'), R.S.placed('velo')], [false, false, null, true, 'already on this track']);
  lfo.click(); lfo.click();
  assert.deepEqual(R.picks, ['lfo:replace', 'lfo:replace'], 'picks again and again');
  R.S.destroy();
  const serum = T.SRC_VIEWS.find(v => v.id === 'serum');
  assert.deepEqual([serum.note, serum.sections.find(s => s.id === 'notes').note], ['Drop a modulator on the canvas and cable its jack to any knob.', 'Note tools: later.']);
});

/* ---------------------------------------------------------------- milestone 3 (IMPL-3 §2.6): Serum parts and note tools */
test('sourcesTray (milestone 3): o.parts — the Serum view\'s "Serum parts" (OSC, SUB, NOISE, FILTER, MACROS) and "Note tools" (ARP, CLIP) tiles with original glyphs in the host\'s sections (shown in the Serum view only); a tap → partPick in the tray\'s mode; a drag → partDrag with info.part and the world point; setPartPlaced greys one; without o.parts the placeholders stay', () => {
  assert.deepEqual(T.PART_TILES.map(p => p.id + ':' + p.group), ['osc:parts', 'sub:parts', 'noise:parts', 'filter:parts', 'macros:parts', 'arp:notes', 'clip:notes']);
  const d0 = fresh(), pe = d0.createElement('div'), ps = d0.createElement('section'), ne = d0.createElement('div'), ns = d0.createElement('section');
  const picks = [], log = [];
  const R = modRig({ parts: T.PART_TILES, partsEl: pe, partsSec: ps, notesEl: ne, notesSec: ns, partPick: (id, mode) => picks.push('part ' + id + ':' + mode),
    partDrag: { begin: (id, i) => log.push('begin ' + id + (i.part ? ' part' : '')), move() {}, drop: (id, i) => { log.push('drop ' + id + ' ' + i.over + (i.part ? ' part' : '') + ' @' + i.at.x + ',' + i.at.y); return true; }, cancel: id => log.push('cancel ' + id) } });
  assert.deepEqual([pe.children.map(b => b.getAttribute('data-part')), ne.children.map(b => b.getAttribute('data-part')), R.S.partTiles().length], [['osc', 'sub', 'noise', 'filter', 'macros'], ['arp', 'clip'], 7]);
  assert.deepEqual([ps.hidden, ns.hidden], [false, false], 'the Serum view');
  R.S.setView('hw');
  assert.deepEqual([ps.hidden, ns.hidden], [true, true], 'Hardware: none');
  R.S.setView('serum');
  const osc = R.S.partTile('osc');
  assert.deepEqual([osc.className, osc.getAttribute('data-group'), osc.children.map(c => c.className), osc.children[1].textContent, osc.title],
    ['cv-tile cv-ptile', 'parts', ['cv-mglyph', 'cv-tname', 'cv-treason'], 'OSC', 'OSC — tap to add it to this track\'s Serum, or drag it onto the canvas']);
  assert.equal(new Set(R.S.partTiles().map(b => b.children[0].innerHTML)).size, 7, 'one original glyph each');
  assert.ok(R.S.partTiles().every(b => /<svg /.test(b.children[0].innerHTML) && !/<text|<image|href/.test(b.children[0].innerHTML)));
  osc.click(); R.S.setMode('track'); R.S.partTile('arp').click();
  assert.deepEqual([picks, R.picks], [['part osc:replace', 'part arp:track'], []], 'partPick, not the synth pick');
  // a drag onto the canvas: info.part, the world point
  const f = R.S.partTile('filter'), tp = { pointerType: 'touch' };
  ptr(f, 'pointerdown', 100, 300, at(tp)); ptr(f, 'pointermove', 112, 302, at(tp)); ptr(f, 'pointermove', 400, 300, at(tp));
  assert.equal(R.layer.children[0].children[1].textContent, '+ Add FILTER');
  TS += 150;
  ptr(f, 'pointermove', 402, 301, at(tp)); ptr(f, 'pointerup', 402, 301, at(tp));
  assert.deepEqual(log, ['begin filter part', 'drop filter canvas part @804,201']);
  // setPartPlaced: greyed with the host's reason, no pick
  R.S.setPartPlaced('osc', 'This Serum already has 3 oscillators');
  osc.click();
  assert.deepEqual([osc.classList.contains('cv-placed'), osc.getAttribute('aria-disabled'), osc.children[2].textContent, R.S.partPlaced('osc'), picks.length], [true, 'true', 'This Serum already has 3 oscillators', 'This Serum already has 3 oscillators', 2]);
  R.S.setPartPlaced('osc', null);
  assert.deepEqual([osc.classList.contains('cv-placed'), R.S.partPlaced('osc')], [false, null]);
  R.S.destroy();
  assert.equal(pe.children.length + ne.children.length, 0, 'destroy takes the tiles');
  // in o.secEl when the host gives no elements (in place of the placeholders); without o.parts: the placeholders
  const d = fresh(), list = d.createElement('div'), sec = d.createElement('div');
  const S2 = T.sourcesTray(list, { models: MODELS.slice(0, 1), pick() {}, drag: {}, secEl: sec, parts: true, view: 'serum' });
  assert.deepEqual(sec.children.map(s => s.getAttribute('data-sec') + ':' + s.className + ':' + s.children[0].textContent + ':' + s.children[1].children.length), ['parts:cv-tsec cv-psec:Serum parts:5', 'notes:cv-tsec cv-psec:Note tools:2']);
  S2.setView('flow');
  assert.deepEqual(sec.children.map(s => s.hidden), [true, true]);
  S2.destroy();
  const sec3 = d.createElement('div'), S3 = T.sourcesTray(d.createElement('div'), { models: MODELS.slice(0, 1), pick() {}, drag: {}, secEl: sec3, view: 'serum' });
  assert.deepEqual(sec3.children.map(s => s.getAttribute('data-sec') + ':' + s.className), ['parts:cv-tsec cv-tsoon', 'notes:cv-tsec cv-tsoon'], 'the placeholders');
  assert.equal(S3.partTiles().length, 0);
  S3.destroy();
});

test('index.html / style.css (milestone 3): the Serum parts and note tools sections (hidden until the tray fills them) after the Modulators; the CSS of the part modules, the internal cables, stubs, forks, hidden ends, inline jacks, the H6 hook', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<section id="srcModSec"[\s\S]*?<\/section>\s*<!--[^>]*-->\s*<section id="srcPartSec" class="cv-tsec cv-psec" aria-label="Serum parts" hidden>\s*<h3 class="cv-tgrp">Serum parts<\/h3>\s*<div id="srcParts" class="cv-tiles cv-ptiles" data-tray="parts"><\/div>\s*<\/section>\s*<section id="srcNoteSec" class="cv-tsec cv-psec" aria-label="Note tools" hidden>\s*<h3 class="cv-tgrp">Note tools<\/h3>\s*<div id="srcNotes" class="cv-tiles cv-ptiles" data-tray="notes"><\/div>/);
  for (const id of ['srcPartSec', 'srcParts', 'srcNoteSec', 'srcNotes']) assert.equal((html.match(new RegExp('\\sid="' + id + '"', 'g')) || []).length, 1, id);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  for (const sel of ['.cv-mod[data-cv-kind="part"]', '.cv-mod[data-cv-member]', '.cv-bar > .cv-pow.cv-powslot', '.cv-jack-in', '.cv-jack[data-kind="note"]', '.cv-jack[data-kind="warp"]',
    '.cv-cable-g[data-int] .cv-cable', '.cv-cable-g[data-int="note"] .cv-cable', '.cv-cable-g[data-int="warp"] .cv-cable', '.cv-cable-g[data-stub] .cv-cable', '.cv-fork', '.cv-fork::before',
    '.cv-cable-g.cv-hid .cv-cable', '.cv-htag', '#world[data-cv-h6="contain"] .cv-mod:not([data-cv-face]) > .cv-body', '.cv-ptiles']) assert.ok(css.includes(sel + ' '), sel);
  assert.match(css, /\.cv-cable-g\[data-int\] \.cv-cable \{ stroke-width: calc\(3px \* var\(--ik, 1\)\)/, 'per-voice audio 3 px on screen (SPEC §2.9)');
  assert.match(css, /\.cv-fork::before \{[^}]*calc\(44px \* var\(--ik, 1\)\)/, 'the badge\'s 44 px hit area');
});

/* ---------------------------------------------------------------- stage 8: the Controllers view (IMPL-8 §1.2, lane X) */
// a rig as modRig's: the Controllers row (o.ctls) in its own box and section, the view 'ctl', every drag callback logged (info.ctl, the world point)
function ctlRig(o = {}) {
  const d = fresh();
  raf.install();
  const tray = mkEl(d, 'aside', 'srcTray'), list = d.createElement('div'), sec = d.createElement('section'), box = d.createElement('div'), layer = mkEl(d, 'div', 'ov');
  sec.hidden = true; sec.append(box);
  tray.append(list, sec);
  place(tray, 0, 100, 284, 600);
  const log = [], picks = [];
  let leaves = 0;
  const S = T.sourcesTray(list, Object.assign({
    models: MODELS, tray, layer, pick: (id, mode) => picks.push(id + ':' + mode), ctls: T.CTL_TILES, ctlsEl: box, ctlsSec: sec, view: 'ctl',
    overOf: (t, x, y) => (y < 100 ? 'tracks' : x > 300 ? 'canvas' : null), canvasGhost: () => true, onLeave: () => { leaves++; },
    toWorld: (x, y) => ({ x: x * 2, y: y - 100 }),
    drag: {
      begin: (id, i) => log.push('begin ' + id + ' ' + i.over + (i.ctl ? ' ctl' : '') + (i.mod ? ' mod' : '')),
      move: (id, i) => log.push('move ' + i.over),
      drop: (id, i) => { log.push('drop ' + id + ' ' + i.over + (i.ctl ? ' ctl' : '') + (i.at ? ' @' + i.at.x + ',' + i.at.y : '')); return !!i.over; },
      cancel: id => log.push('cancel ' + id),
    },
  }, o));
  return { d, tray, list, sec, box, layer, S, log, picks, get leaves() { return leaves; } };
}

test('sourcesTray (8): the Controllers view — SRC_VIEWS lists it after Drums (its tip and note); one Pads tile in a row of its own (an original 3 × 3 glyph, one lit; the name, a hidden reason) in its own section, shown only in this view; tiles() stays the synths\' (all hidden here); a tap picks in the tray\'s mode (ctlPick, else modPick, else pick); the view is remembered (a stored "ctl"), an unknown one opens Hardware', () => {
  const V = T.SRC_VIEWS.map(v => v.id);
  assert.deepEqual(V, ['hw', 'flow', 'serum', 'drums', 'ctl', 'moog']); // ((9) the Moog modules view after it)
  const ctl = T.SRC_VIEWS[4];
  assert.deepEqual([ctl.label, ctl.tip, ctl.note, ctl.sections, ctl.layout], ['Controllers', 'Pad grids that play and modulate any track',
    'A Pads module plays any track (drum hits, notes, chords) and its pads can modulate any knob. More controllers later.', [{ id: 'ctls' }], undefined], 'no layout of its own: the classics\' is kept');
  assert.deepEqual(T.CTL_TILES.map(t => [t.id, t.name]), [['pads', 'Pads']]);
  assert.ok(Object.isFrozen(T.CTL_TILES) && Object.isFrozen(T.CTL_TILES[0]));
  const R = ctlRig();
  assert.deepEqual([R.sec.hidden, R.S.view(), R.S.ctlTiles().map(b => b.getAttribute('data-ctl')), R.box.children.length, R.S.tiles().filter(b => !b.hidden).length], [false, 'ctl', ['pads'], 1, 0], 'the section shown, no synth tile');
  const p = R.S.ctlTile('pads');
  assert.deepEqual([p.tagName, p.className, p.type, p.children.map(c => c.className), p.children[1].textContent, p.children[2].hidden, R.S.ctlTile('nope'), R.S.modTiles().length],
    ['BUTTON', 'cv-tile cv-mtile', 'button', ['cv-mglyph', 'cv-tname', 'cv-treason'], 'Pads', true, null, 0]);
  const g = p.children[0].innerHTML;
  assert.deepEqual([p.children[0].getAttribute('aria-hidden'), (g.match(/<rect /g) || []).length, (g.match(/fill="currentColor"/g) || []).length, /<(text|image)|href|url\(/.test(g)], ['true', 9, 1, false], 'a 3 × 3 of rounded squares, one lit; monochrome');
  assert.equal(p.title, 'Pads — tap to add a Pads module (it plays any track), or drag it onto the canvas');
  for (const v of ['hw', 'flow', 'serum', 'drums']) { R.S.setView(v); assert.equal(R.sec.hidden, true, v + ': no Controllers row'); }
  R.S.setView('ctl');
  assert.deepEqual([R.sec.hidden, R.S.layout()], [false, 'hw'], 'back; the layout kept (no layout of its own)');
  p.click();
  R.S.setMode('track');
  p.click();
  assert.deepEqual(R.picks, ['pads:replace', 'pads:track']);
  R.S.destroy();
  assert.equal(R.box.children.length, 0, 'destroy takes the tile');
  // the picks' fallbacks: ctlPick wins, then modPick, then pick; without ctlsEl a heading "Controllers" and the tile follow the synths (hidden outside the view)
  const d = fresh(), list = d.createElement('div'), mp = [];
  d.body.append(list);
  const S2 = T.sourcesTray(list, { models: MODELS.slice(0, 2), ctls: T.CTL_TILES, pick: () => mp.push('pick'), modPick: id => mp.push('modPick ' + id), ctlPick: id => mp.push('ctlPick ' + id), drag: {} });
  assert.deepEqual(list.children.map(n => (n.tagName === 'H3' ? '#' + n.textContent : n.getAttribute('data-model') || n.getAttribute('data-ctl'))), [MODELS[0].id, MODELS[1].id, '#Controllers', 'pads']);
  assert.deepEqual(list.children.map(n => n.hidden), [false, false, true, true], 'Hardware: the heading and the tile hidden');
  S2.setView('ctl');
  assert.deepEqual(list.children.map(n => n.hidden), [true, true, false, false], 'Controllers: the tile, no classic');
  S2.ctlTile('pads').click();
  assert.deepEqual(mp, ['ctlPick pads']);
  S2.destroy();
  for (const [opt, want] of [[{ modPick: id => mp.push('modPick ' + id) }, 'modPick pads'], [{}, 'pick']]) {
    mp.length = 0;
    const l = d.createElement('div'), S = T.sourcesTray(l, Object.assign({ models: MODELS.slice(0, 1), ctls: T.CTL_TILES, pick: () => mp.push('pick'), drag: {}, view: 'ctl' }, opt));
    S.ctlTile('pads').click();
    assert.deepEqual(mp, [want], 'the fallback');
    S.destroy();
  }
  // no o.ctls: the 1e / 2a tray as it was
  const l3 = d.createElement('div'), S3 = T.sourcesTray(l3, { models: MODELS.slice(0, 2), pick() {}, drag: {} });
  assert.deepEqual([l3.children.length, S3.ctlTiles().length, S3.ctlTile('pads')], [2, 0, null]);
  S3.setView('ctl');
  assert.deepEqual([S3.view(), l3.getAttribute('data-view'), S3.tiles().filter(b => !b.hidden).length], ['ctl', 'ctl', 0], 'a view with no row: nothing listed');
  S3.destroy();
  // the remembered view: a stored "ctl" opens Controllers; an id this build does not know (an older build's reading of a newer id) opens the first (Hardware)
  const l4 = d.createElement('div'), S4 = T.sourcesTray(l4, { models: MODELS, pick() {}, drag: {}, view: 'ctl' }), l5 = d.createElement('div'), S5 = T.sourcesTray(l5, { models: MODELS, pick() {}, drag: {}, view: 'pads2' });
  assert.deepEqual([S4.view(), S5.view()], ['ctl', 'hw']);
  S4.destroy(); S5.destroy();
});

test('sourcesTray (8): the Pads tile drags out as a modulator tile — over the canvas only (never \'tracks\'), info.ctl, info.at in world px (toWorld); the ghost (the outline when ctlCanvasGhost / modCanvasGhost says the world draws one); ctlDrag wins over modDrag; the tray stays open', () => {
  const R = ctlRig(), t = R.S.ctlTile('pads'), tp = { pointerType: 'touch' };
  ptr(t, 'pointerdown', 100, 300, at(tp)); ptr(t, 'pointermove', 112, 302, at(tp));
  assert.deepEqual([R.log, R.layer.children[0].className], [['begin pads null ctl', 'move null'], 'cv-tghost touch cv-mghost']);
  ptr(t, 'pointermove', 400, 300, at(tp));
  assert.deepEqual([R.leaves, R.log.at(-1), R.layer.children[0].classList.contains('off'), R.layer.children[0].children[1].textContent], [1, 'move canvas', false, '+ Add Pads']);
  TS += 150;
  ptr(t, 'pointermove', 402, 301, at(tp)); ptr(t, 'pointerup', 402, 301, at(tp));
  assert.equal(R.log.at(-1), 'drop pads canvas ctl @804,201');
  assert.equal(R.layer.children.length, 0, 'the ghost gone');
  // over the track list: no target (a controller is no new track); a flick: a cancel
  R.log.length = 0;
  ptr(t, 'pointerdown', 100, 300, at(tp)); ptr(t, 'pointermove', 120, 300, at(tp)); ptr(t, 'pointermove', 200, 50, at(tp));
  TS += 200;
  ptr(t, 'pointerup', 200, 50, at(tp));
  assert.deepEqual(R.log.slice(-2), ['move null', 'cancel pads']);
  R.log.length = 0;
  ptr(t, 'pointerdown', 100, 300, at(tp)); ptr(t, 'pointermove', 120, 300, at(tp)); ptr(t, 'pointermove', 500, 300, at(tp)); ptr(t, 'pointerup', 500, 300, at(tp));
  assert.deepEqual(R.log.slice(-1), ['cancel pads'], 'flicked');
  R.S.destroy();
  // ctlCanvasGhost, else modCanvasGhost: the world draws the outline, the tray's ghost hides over the canvas
  for (const opt of [{ ctlCanvasGhost: () => true, canvasGhost: () => false }, { modCanvasGhost: () => true, canvasGhost: () => false }]) {
    const R2 = ctlRig(opt), t2 = R2.S.ctlTile('pads');
    ptr(t2, 'pointerdown', 100, 300, at(tp)); ptr(t2, 'pointermove', 112, 302, at(tp)); ptr(t2, 'pointermove', 400, 300, at(tp));
    assert.equal(R2.layer.children[0].classList.contains('off'), true);
    ptr(t2, 'pointercancel', 400, 300, at(tp));
    R2.S.destroy();
  }
  // ctlDrag wins over modDrag (and the tile's drag reaches whichever the host gave)
  const own = [], R3 = ctlRig({ ctlDrag: { begin: (id, i) => own.push('ctl begin ' + id + (i.ctl ? ' ctl' : '')), move() {}, drop: () => true, cancel() {} }, modDrag: { begin: () => own.push('mod begin'), move() {}, drop: () => true, cancel() {} } });
  ptr(R3.S.ctlTile('pads'), 'pointerdown', 100, 300, at(tp)); ptr(R3.S.ctlTile('pads'), 'pointermove', 112, 302, at(tp));
  assert.deepEqual(own, ['ctl begin pads ctl']);
  ptr(R3.S.ctlTile('pads'), 'pointercancel', 112, 302, at(tp));
  R3.S.destroy();
});

test('sourcesTray (8): setPlaced greys the Pads tile with its reason ("8 Pads modules in this project": aria-disabled, cv-placed, the reason shown, the title) — then it neither picks nor drags; null makes it available again; the tile is not multi (the host greys it only at the 8th Pads module)', () => {
  const R = ctlRig(), p = R.S.ctlTile('pads'), tp = { pointerType: 'touch' };
  assert.equal(p.hasAttribute('data-multi'), false, 'not multi: setPlaced is honoured');
  R.S.setPlaced('pads', '8 Pads modules in this project');
  assert.deepEqual([p.classList.contains('cv-placed'), p.getAttribute('aria-disabled'), p.children[2].hidden, p.children[2].textContent, p.title, R.S.placed('pads')],
    [true, 'true', false, '8 Pads modules in this project', 'Pads — 8 Pads modules in this project', '8 Pads modules in this project']);
  p.click();
  ptr(p, 'pointerdown', 100, 300, at(tp)); ptr(p, 'pointermove', 112, 302, at(tp)); ptr(p, 'pointermove', 400, 300, at(tp));
  TS += 150;
  ptr(p, 'pointermove', 402, 301, at(tp)); ptr(p, 'pointerup', 402, 301, at(tp));
  assert.deepEqual([R.picks, R.log, R.layer.children.length], [[], [], 0], 'no pick, no drag, no ghost');
  R.S.setPlaced('pads', null);
  assert.deepEqual([p.classList.contains('cv-placed'), p.hasAttribute('aria-disabled'), p.children[2].hidden, p.title, R.S.placed('pads')],
    [false, false, true, 'Pads — tap to add a Pads module (it plays any track), or drag it onto the canvas', null]);
  p.click();
  assert.deepEqual(R.picks, ['pads:replace']);
  R.S.setPlaced('nope', 'x');
  R.S.destroy();
});

/* ---------------------------------------------------------------- the Moog modules view (9, IMPL-9 §4.6, §8.6) */
function moogRig(o = {}) {
  const d = fresh();
  raf.install();
  const tray = mkEl(d, 'aside', 'srcTray'), list = d.createElement('div'), scroll = d.createElement('div'), layer = mkEl(d, 'div', 'ov');
  tray.append(list, scroll);
  place(tray, 0, 100, 284, 600);
  const log = [], picks = [];
  const S = T.sourcesTray(list, Object.assign({
    models: MODELS, tray, layer, pick: (id, mode) => picks.push(id + ':' + mode), moog: T.MOOG_TILES, secEl: scroll, view: 'moog',
    overOf: (t, x, y) => (y < 100 ? 'tracks' : x > 300 ? 'canvas' : null), canvasGhost: () => true,
    toWorld: (x, y) => ({ x: x * 2, y: y - 100 }), moogCost: id => (id === '907a' ? '~2 %' : '~1 %'),
    drag: {
      begin: (id, i) => log.push('begin ' + id + ' ' + i.over + (i.moog ? ' moog' : '')),
      move: (id, i) => log.push('move ' + i.over),
      drop: (id, i) => { log.push('drop ' + id + ' ' + i.over + (i.moog ? ' moog' : '') + (i.at ? ' @' + i.at.x + ',' + i.at.y : '')); return !!i.over; },
      cancel: id => log.push('cancel ' + id),
    },
  }, o));
  return { d, tray, list, scroll, layer, S, log, picks, sec: () => scroll.children.find(c => c.getAttribute('data-sec') === 'moog') || null };
}

test('sourcesTray (9, 9b): the Moog modules view — SRC_VIEWS\'s sixth (tip, note, layout hw); the Model 15 tile (the m900 model tile: no maker word, no SIMPLE badge) first; then a row of its own in secEl: (9b) five groups (Sources · Modifiers · Control · Sequencing · Console & routing), the 25 module tiles in the family\'s order, each an original glyph (a panel outline, a dot per knob, a ring per jack — rear terminals never —, 9b: a cap per event button, a disc per lamp; no text), its name, its load; shown only there; Hardware / Simple: the twelve classics (classicOf); a tap picks in the tray\'s mode (moogPick, else pick); the view remembered', () => {
  const V = T.SRC_VIEWS.find(v => v.id === 'moog');
  assert.deepEqual([T.SRC_VIEWS.map(v => v.id).indexOf('moog'), V.label, V.tip, V.layout, V.sections.map(s => s.id), V.note],
    [5, 'Moog modules', 'The 900-series modules, patched with cords', 'hw', ['m15', 'moog'],
      'Model 15, System 35 and System 55 bring a whole set, patched. Drop a module onto a 900 Series track to add it. The Moog Modular (a fixed patch) stays in Hardware.']);
  assert.deepEqual(MODELS.filter(m => V.sections[0].models(m)).map(m => m.id), ['m900'], 'the m15 section: the 900 Series model tile only');
  assert.deepEqual(T.MOOG_TILES.map(t => [t.id, t.name, t.group]), [['921', '921 Oscillator', 'src'], ['921a', '921A Driver', 'src'], ['921b', '921B Oscillator', 'src'],
    ['923', '923 Noise', 'src'], ['903a', '903A Random signal', 'src'], ['904a', '904A Low-pass', 'mod'], ['904b', '904B High-pass', 'mod'], ['907a', '907A Filter bank', 'mod'],
    ['914', '914 Filter bank', 'mod'], ['902', '902 Amplifier', 'mod'], ['911', '911 Envelope', 'ctl'], ['911a', '911A Trigger delay', 'ctl'], ['995', '995 Attenuators', 'ctl'],
    ['994', '994 Multiples', 'ctl'], ['960', '960 Sequencer', 'seq'], ['961', '961 Interface', 'seq'], ['962', '962 Switch', 'seq'], ['clk', 'Song clock', 'seq'],
    ['cp2', 'CP2 Filters', 'cp'], ['cp3a', 'CP3A Mixer', 'cp'], ['cp4a', 'CP4A Routing', 'cp'], ['cp35', 'CP35 Attenuators', 'cp'], ['cp8a', 'CP8A Power', 'cp'],
    ['992', '992 Control voltages', 'cp'], ['993', '993 Trigger routing', 'cp']]);
  assert.deepEqual([T.MOOG_TILES.length, Object.values(T.MOOG_GROUPS)], [25, ['Sources', 'Modifiers', 'Control', 'Sequencing', 'Console & routing']]);
  assert.ok(Object.isFrozen(T.MOOG_TILES) && T.MOOG_TILES.every(Object.isFrozen));
  const R = moogRig(), shown = () => R.S.tiles().filter(b => !b.hidden).map(b => b.getAttribute('data-model')), sec = R.sec();
  assert.deepEqual([R.S.view(), R.S.layout(), shown(), sec.hidden, sec.className, sec.getAttribute('aria-label')], ['moog', 'hw', ['m900'], false, 'cv-tsec cv-gsec', 'Moog modules']);
  // the Model 15 tile: its art, "Model 15", "1973 · modular system" — no maker word (D4), no SIMPLE badge, no hardware / simple aria text
  const m15 = R.S.tiles().find(b => b.getAttribute('data-model') === 'm900');
  assert.deepEqual([m15.children.map(c => c.className), m15.children[1].textContent, m15.children[2].textContent, m15.getAttribute('aria-description')],
    [['cv-tart', 'cv-tname', 'cv-tmeta'], 'Model 15', '1973 · modular system', null]);
  assert.ok(!/moog|R\.A\./i.test(m15.title + m15.textContent) && /the whole set of modules, patched/.test(m15.title), m15.title);
  // the row: a grid of five headed groups, the tiles in order
  const box = sec.children[0], ROW = ['#Sources', '921', '921a', '921b', '923', '903a', '#Modifiers', '904a', '904b', '907a', '914', '902', '#Control', '911', '911a', '995', '994',
    '#Sequencing', '960', '961', '962', 'clk', '#Console & routing', 'cp2', 'cp3a', 'cp4a', 'cp35', 'cp8a', '992', '993'];
  assert.deepEqual([box.className, box.children.map(n => (n.tagName === 'H3' ? '#' + n.textContent : n.getAttribute('data-moog')))], ['cv-tiles cv-gtiles', ROW]);
  const t = R.S.moogTile('921b');
  assert.deepEqual([t.tagName, t.className, t.type, t.getAttribute('data-group'), t.children.map(c => c.className), t.children[1].textContent, t.children[2].textContent, t.children[2].hidden, t.children[3].hidden, R.S.moogTile('nope')],
    ['BUTTON', 'cv-tile cv-gtile', 'button', 'src', ['cv-gglyph', 'cv-tname', 'cv-tcost', 'cv-treason'], '921B Oscillator', '~1 %', false, true, null]);
  assert.equal(t.title, '921B Oscillator — tap to add it to this track\'s 900 Series (on another track: a 900 Series with it), or drag it onto the canvas');
  assert.equal(R.S.moogTile('907a').children[2].textContent, '~2 %');
  // each glyph: our own drawing — a panel outline, one dot per knob / switch and one ring per jack of its type, no text or image;
  // (9b) the rear terminals never drawn (no face shows them), a cap per event button, a disc per lamp; the outline by the face: a
  // 5U module 42 tall (the 960 at its face's aspect), a console-height panel 27; 1 / 2 / 3 / 4 / 8 MU 12 / 20 / 34 / 38 / 38 wide
  const W_MU = { 1: 12, 2: 20, 3: 34, 4: 38, 8: 38 };
  for (const ty of MG.ORDER) {
    const g = R.S.moogTile(ty).children[0].innerHTML, T2 = MG.TYPES[ty], n = re => (g.match(re) || []).length;
    const o = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="1.5"\/>/.exec(g), h = T2.face === 'console' ? 27 : ty === '960' ? 20.8 : 42;
    assert.equal(g, T.MOOG_GLYPH[ty], ty);
    assert.deepEqual([n(/class="k"/g), n(/class="j"/g), n(/class="e"/g), n(/class="l"/g), n(/rx="1.5"/g), /<(text|image)|href|url\(/.test(g)],
      [T2.params.length, T2.jacks.filter(j => !j.rear).length, (T2.ev || []).length, (T2.lamps || []).length, 1, false], ty + ': its knobs, jacks, buttons and lamps');
    assert.deepEqual([+o[3], +o[4], +o[1] + +o[3] / 2, +o[2] + +o[4] / 2], [W_MU[T2.mu], h, 20, 22], ty + ': its outline, centred');
  }
  assert.ok(/width="34"/.test(T.MOOG_GLYPH['907a']) && /width="20"/.test(T.MOOG_GLYPH['921']) && /width="12"/.test(T.MOOG_GLYPH['911']), 'the 907A wide, the 921 2 MU, the rest 1 MU');
  // only in this view; Hardware / Simple: the twelve classics (classicOf: the 900 Series is not one); back
  for (const v of ['hw', 'flow', 'serum', 'drums', 'ctl']) { R.S.setView(v); assert.equal(sec.hidden, true, v); }
  R.S.setView('flow');
  assert.deepEqual(shown(), MODELS.filter(classicOf).map(m => m.id));
  assert.equal(shown().length, 12);
  assert.ok(!m15.children.some(c => c.className === 'cv-tbadge'), 'no SIMPLE badge on the Model 15 tile');
  R.S.setView('moog');
  assert.deepEqual([sec.hidden, shown(), R.S.layout()], [false, ['m900'], 'hw']);
  // a tap picks in the tray's mode (moogPick wins over pick); the model tile is an ordinary one
  t.click(); R.S.setMode('track'); t.click(); m15.click();
  assert.deepEqual(R.picks, ['921b:replace', '921b:track', 'm900:track']);
  R.S.destroy();
  assert.equal(R.scroll.children.length, 0, 'destroy takes the section');
  const mp = [], R2 = moogRig({ moogPick: (id, m) => mp.push(id + ' ' + m) });
  R2.S.moogTile('995').click();
  assert.deepEqual([mp, R2.picks], [['995 replace'], []]);
  R2.S.destroy();
  // o.moog: true is MOOG_TILES; without secEl a heading per group and the tiles follow the synths (hidden outside the view); without o.moog no row
  const d = fresh(), l = d.createElement('div'), S3 = T.sourcesTray(l, { models: MODELS.slice(0, 1), moog: true, pick() {}, drag: {} });
  assert.deepEqual(l.children.map(n => (n.tagName === 'H3' ? '#' + n.textContent : n.getAttribute('data-model') || n.getAttribute('data-moog'))), [MODELS[0].id, ...ROW]);
  assert.deepEqual(l.children.map(n => n.hidden), [false, ...Array(30).fill(true)], 'Hardware: the row hidden');
  S3.setView('moog');
  assert.deepEqual(l.children.map(n => n.hidden), [true, ...Array(30).fill(false)]);
  S3.destroy();
  const l4 = d.createElement('div'), S4 = T.sourcesTray(l4, { models: MODELS, pick() {}, drag: {}, view: 'moog' });
  assert.deepEqual([S4.view(), S4.moogTiles().length, S4.tiles().filter(b => !b.hidden).map(b => b.getAttribute('data-model'))], ['moog', 0, ['m900']], 'a stored "moog" opens it; no row without o.moog');
  S4.destroy();
});

test('sourcesTray (9): a Moog module tile drags out as a module — info.moog, over the canvas or the track list, info.at in world px; the ghost (its glyph; hidden over the canvas while moogCanvasGhost says the world draws the outline); moogDrag wins over drag; setPlaced / setMoogPlaced grey the tiles (no pick, no drag), null makes them available; refreshMoog re-reads the loads', () => {
  const R = moogRig(), t = R.S.moogTile('904a'), tp = { pointerType: 'touch' };
  ptr(t, 'pointerdown', 100, 300, at(tp)); ptr(t, 'pointermove', 112, 302, at(tp));
  assert.deepEqual([R.log, R.layer.children[0].className, R.layer.children[0].children[0].className], [['begin 904a null moog', 'move null'], 'cv-tghost touch cv-gghost', 'cv-gglyph']);
  ptr(t, 'pointermove', 400, 300, at(tp));
  assert.deepEqual([R.log.at(-1), R.layer.children[0].classList.contains('off'), R.layer.children[0].children[1].textContent], ['move canvas', false, '+ Add 904A Low-pass']);
  TS += 150;
  ptr(t, 'pointermove', 402, 301, at(tp)); ptr(t, 'pointerup', 402, 301, at(tp));
  assert.deepEqual([R.log.at(-1), R.layer.children.length], ['drop 904a canvas moog @804,201', 0]);
  R.log.length = 0;
  ptr(t, 'pointerdown', 100, 300, at(tp)); ptr(t, 'pointermove', 120, 300, at(tp)); ptr(t, 'pointermove', 200, 50, at(tp));
  assert.equal(R.layer.children[0].children[1].textContent, '+ New track');
  TS += 150;
  ptr(t, 'pointermove', 201, 50, at(tp)); ptr(t, 'pointerup', 201, 50, at(tp));
  assert.equal(R.log.at(-1), 'drop 904a tracks moog @402,-50', 'the track list: a new track (the host\'s)');
  R.S.destroy();
  const R2 = moogRig({ moogCanvasGhost: () => true, canvasGhost: () => false }), t2 = R2.S.moogTile('911');
  ptr(t2, 'pointerdown', 100, 300, at(tp)); ptr(t2, 'pointermove', 112, 302, at(tp)); ptr(t2, 'pointermove', 400, 300, at(tp));
  assert.equal(R2.layer.children[0].classList.contains('off'), true, 'the world draws the outline');
  ptr(t2, 'pointercancel', 400, 300, at(tp));
  R2.S.destroy();
  const own = [], R3 = moogRig({ moogDrag: { begin: (id, i) => own.push('moog begin ' + id + (i.moog ? ' moog' : '')), move() {}, drop: () => true, cancel() {} } });
  ptr(R3.S.moogTile('995'), 'pointerdown', 100, 300, at(tp)); ptr(R3.S.moogTile('995'), 'pointermove', 112, 302, at(tp));
  assert.deepEqual([own, R3.log], [['moog begin 995 moog'], []]);
  ptr(R3.S.moogTile('995'), 'pointercancel', 112, 302, at(tp));
  R3.S.destroy();
  // greyed: a full patch
  let cost = '~1 %';
  const R4 = moogRig({ moogCost: () => cost }), p = R4.S.moogTile('902'), why = 'A patch holds at most 48 modules';
  R4.S.setMoogPlaced(why);
  assert.deepEqual(R4.S.moogTiles().map(b => b.classList.contains('cv-placed') && b.getAttribute('aria-disabled')), Array(25).fill('true'));
  assert.deepEqual([p.children[3].hidden, p.children[3].textContent, p.title, R4.S.placed('902')], [false, why, '902 Amplifier — ' + why, why]);
  p.click();
  ptr(p, 'pointerdown', 100, 300, at(tp)); ptr(p, 'pointermove', 112, 302, at(tp)); ptr(p, 'pointermove', 400, 300, at(tp));
  TS += 150;
  ptr(p, 'pointermove', 402, 301, at(tp)); ptr(p, 'pointerup', 402, 301, at(tp));
  assert.deepEqual([R4.picks, R4.log, R4.layer.children.length], [[], [], 0], 'no pick, no drag');
  R4.S.setPlaced('902', null);
  p.click();
  assert.deepEqual([p.classList.contains('cv-placed'), R4.S.placed('902'), R4.S.placed('921'), R4.picks], [false, null, why, ['902:replace']]);
  cost = '~3 %'; R4.S.refreshMoog();
  assert.deepEqual([p.children[2].textContent, p.children[2].title], ['~3 %', 'Estimated DSP load on this device: ~3 %']);
  cost = ''; R4.S.refreshMoog();
  assert.equal(p.children[2].hidden, true, 'no load: hidden');
  R4.S.destroy();
});

test('sourcesTray (9b, IMPL-9b §4.3): the set tiles System 35 / System 55 — SET_TILES (moog-core SETS: name, modules 22 / 37 = cv-art SET_ART\'s, the starter); right after the Model 15 tile (its own art, "System 35" over "22 modules", aria "System 35 · 22 modules", no maker word), not model tiles (tiles() the synths\'); shown only in the Moog view; a tap → setPick in the tray\'s mode (never o.pick); a drag → setDrag with info.set, over the canvas ("+ System 55") or the track list, info.at the world point, the ghost its art (hidden while setCanvasGhost); setSetPlaced greys one with setFull\'s reason (no pick, no drag), null makes it available; o.sets: true, o.setsEl; none without o.sets', () => {
  assert.deepEqual(T.SET_TILES.map(x => [x.id, x.name, x.modules, x.starter]), [['s35', 'System 35', 22, 'Swept band'], ['s55', 'System 55', 37, 'Sequence']]);
  assert.ok(Object.isFrozen(T.SET_TILES) && T.SET_TILES.every(Object.isFrozen));
  assert.deepEqual(T.SET_TILES.map(x => cvArt.SET_ART[x.id].modules), [22, 37], 'the art\'s count is the set\'s');
  assert.deepEqual([T.setFull(11, 27), T.setFull(21, 27), T.setFull(22, 27), T.setFull(40, 27), T.setFull(48, 0), T.setFull(30, -1)],
    [null, null, 'This set needs 1 more module than the patch can hold', 'This set needs 19 more modules than the patch can hold', null, null]);
  const sp = [], sd = [];
  let cost = { s35: '~3 %', s55: '~6 %' };
  const R = moogRig({ sets: T.SET_TILES, setPick: (id, m) => sp.push(id + ':' + m), setCanvasGhost: () => false, canvasGhost: () => false, setCost: id => cost[id] || '',
    setDrag: { begin: (id, i) => sd.push('begin ' + id + (i.set ? ' set' : '')), move: (id, i) => sd.push('move ' + i.over), drop: (id, i) => { sd.push('drop ' + id + ' ' + i.over + (i.set ? ' set' : '') + ' @' + i.at.x + ',' + i.at.y); return true; }, cancel: id => sd.push('cancel ' + id) } });
  const ids = R.list.children.map(n => n.getAttribute('data-model') || n.getAttribute('data-set'));
  assert.deepEqual(ids.slice(-3), ['m900', 's35', 's55'], 'beside the Model 15 tile');
  assert.deepEqual([R.S.tiles().length, R.S.tiles().some(b => b.getAttribute('data-set')), R.S.setTiles().length], [MODELS.length, false, 2], 'not model tiles');
  const b = R.S.setTile('s35'), b5 = R.S.setTile('s55');
  assert.deepEqual([b.tagName, b.className, b.type, b.children.map(c => c.className), b.children[1].textContent, b.children[2].textContent, b.children[4].hidden, b.getAttribute('aria-label'), b5.getAttribute('aria-label'), R.S.setTile('nope')],
    ['BUTTON', 'cv-tile cv-stile', 'button', ['cv-tart', 'cv-tname', 'cv-tmeta', 'cv-tcost', 'cv-treason'], 'System 35', '22 modules', true, 'System 35 · 22 modules', 'System 55 · 37 modules', null]);
  // (review 2 N3) the load estimate the Model 15 tile shows: o.setCost(id) in the tile's .cv-tcost (hidden while it says none), read again by refreshMoog (the device measured)
  const cs = x => x.children[3];
  assert.deepEqual([cs(b).textContent, cs(b).hidden, cs(b).title, cs(b5).textContent, cs(b5).hidden], ['~3 %', false, 'Estimated DSP load on this device: ~3 %', '~6 %', false], 'the set tiles\' load');
  cost = { s35: '~9 %' }; R.S.refreshMoog();
  assert.deepEqual([cs(b).textContent, cs(b5).textContent, cs(b5).hidden, cs(b5).title], ['~9 %', '', true, ''], 'refreshed; none: hidden');
  cost = { s35: '~3 %', s55: '~6 %' }; R.S.refreshMoog();
  assert.equal(b.children[0].innerHTML, cvArt.setArt('s35', cvArt.TILE));
  assert.ok(/data-art="s55"/.test(b5.children[0].innerHTML));
  assert.ok(/the whole set, patched as Sequence/.test(b5.title) && !/moog|R\.A\./i.test(b5.title + b5.textContent + b.title), b5.title);
  // only in the Moog view
  const vis = () => [b.hidden, b5.hidden].join();
  assert.equal(vis(), 'false,false');
  for (const v of ['hw', 'flow', 'serum', 'drums', 'ctl']) { R.S.setView(v); assert.equal(vis(), 'true,true', v); }
  R.S.setView('moog');
  // a tap: setPick in the tray's mode, never the model pick
  b.click(); R.S.setMode('track'); b5.click(); R.S.setMode('replace');
  assert.deepEqual([sp, R.picks], [['s35:replace', 's55:track'], []]);
  // a drag: info.set, the canvas ("+ System 55", the ghost its art), the track list
  const tp = { pointerType: 'touch' };
  ptr(b5, 'pointerdown', 100, 300, at(tp)); ptr(b5, 'pointermove', 112, 302, at(tp));
  const gh = R.layer.children[0];
  assert.deepEqual([sd, gh.className, gh.children[0].className, /data-art="s55"/.test(gh.children[0].innerHTML)], [['begin s55 set', 'move null'], 'cv-tghost touch', 'cv-tart', true]);
  ptr(b5, 'pointermove', 400, 300, at(tp));
  assert.deepEqual([sd.at(-1), gh.children[1].textContent, gh.classList.contains('off')], ['move canvas', '+ System 55', false]);
  TS += 150;
  ptr(b5, 'pointermove', 402, 301, at(tp)); ptr(b5, 'pointerup', 402, 301, at(tp));
  assert.deepEqual([sd.at(-1), R.layer.children.length, R.log], ['drop s55 canvas set @804,201', 0, []], 'its own drag, not the model drag');
  ptr(b, 'pointerdown', 100, 300, at(tp)); ptr(b, 'pointermove', 120, 300, at(tp)); ptr(b, 'pointermove', 200, 50, at(tp));
  assert.equal(R.layer.children[0].children[1].textContent, '+ New track');
  TS += 150;
  ptr(b, 'pointermove', 201, 50, at(tp)); ptr(b, 'pointerup', 201, 50, at(tp));
  assert.equal(sd.at(-1), 'drop s35 tracks set @402,-50');
  // greyed at the cap: its reason; no pick, no drag; null: available again
  const why = T.setFull(40, MG.S55.length - 12);
  R.S.setSetPlaced('s55', why);
  assert.deepEqual([b5.classList.contains('cv-placed'), b5.getAttribute('aria-disabled'), b5.children[4].hidden, b5.children[4].textContent, b5.title, b5.getAttribute('aria-label'), R.S.setPlacedOf('s55'), R.S.setPlacedOf('s35')],
    [true, 'true', false, why, 'System 55 · 37 modules — ' + why, 'System 55 · 37 modules — ' + why, why, null]);
  const n0 = sd.length;
  b5.click();
  ptr(b5, 'pointerdown', 100, 300, at(tp)); ptr(b5, 'pointermove', 112, 302, at(tp)); ptr(b5, 'pointermove', 400, 300, at(tp));
  TS += 150;
  ptr(b5, 'pointermove', 402, 301, at(tp)); ptr(b5, 'pointerup', 402, 301, at(tp));
  assert.deepEqual([sp.length, sd.length - n0, R.layer.children.length], [2, 0, 0], 'no pick, no drag');
  R.S.setSetPlaced('s55', null);
  b5.click();
  assert.deepEqual([b5.classList.contains('cv-placed'), b5.hasAttribute('aria-disabled'), b5.children[4].hidden, b5.getAttribute('aria-label'), sp.at(-1)], [false, false, true, 'System 55 · 37 modules', 's55:replace']);
  R.S.destroy();
  assert.equal(R.list.children.some(n => n.getAttribute('data-set')), false, 'destroy takes them');
  // o.sets: true, in their own box (o.setsEl); without o.sets none; no setPick: a tap does nothing
  const d = fresh(), l = d.createElement('div'), box = d.createElement('div');
  const S2 = T.sourcesTray(l, { models: MODELS, sets: true, setsEl: box, pick: id => { throw new Error('model pick ' + id); }, drag: {}, view: 'moog' });
  assert.deepEqual([box.children.map(n => n.getAttribute('data-set')), l.children.some(n => n.getAttribute('data-set'))], [['s35', 's55'], false]);
  S2.setTile('s35').click();
  S2.destroy();
  const S3 = T.sourcesTray(l, { models: MODELS, pick() {}, drag: {}, view: 'moog' });
  assert.deepEqual([S3.setTiles().length, S3.setTile('s35')], [0, null]);
  S3.destroy();
});

test('style.css (9): the Moog tiles\' glyph box, the target chip in #overlay, the cord menu\'s swatches (44 px); the face jacks — the hit clamp, asleep below READ_K, and their rings while patching / focused (restated after the face jack\'s own box-shadow: none, which would win)', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.cv-jack\.cv-fjack::before \{ width: clamp\(28px, calc\(44px \* var\(--ik, 1\)\), var\(--jp, 36px\)\);/);
  assert.match(css, /#world\[data-cv-cordsleep\] \.cv-mod:not\(\[data-cv-edit\]\) > \.cv-jack\.cv-fjack \{ pointer-events: none; \}/);
  const base = css.indexOf('.cv-jack.cv-fjack { '), at = s => css.indexOf(s);
  assert.ok(base > 0);
  for (const sel of ['.cv-jack.cv-fjack:focus-visible {', '.cv-jack.cv-fjack.cv-ok {', '.cv-jack.cv-fjack.cv-from, .cv-jack.cv-fjack.cv-hot {', '#world[data-cv-patching] .cv-jack.cv-fjack.cv-no {']) assert.ok(at(sel) > base, sel + ' after the base rule');
  assert.match(css, /\.cv-jack\.cv-fjack\.cv-ok \{ box-shadow: [^}]*rgba\(111, 227, 161/, 'a green ring');
  for (const sel of ['.cv-gtiles', '.cv-gglyph', '.cv-gglyph svg', '.cv-gglyph svg .k', '#overlay .cv-plugchip', '#overlay .cv-plugchip[data-no]', '.cv-cmenu', '.cv-cm-c', '.cv-cm-x']) assert.ok(css.includes(sel + ' {'), sel);
  assert.match(css, /\.cv-cm-c \{ width: 44px; height: 44px;/, 'a swatch: a finger\'s target');
  assert.match(css, /#overlay \.cv-plugchip \{[^}]*pointer-events: none;/, 'the chip never takes a press');
});
