import './v8-guard.mjs';
// cv-tray.js (stage 1b SHELL lane; docs/canvas/IMPL-1b.md §8.1): budget(), topSnaps(), trayGrip (drag, two-finger
// rollback, keys, double-tap, ARIA), sideTray (tap opens, grip inset, close on a press outside / drag leave), sourcesTray
// drag verdicts (out / along / hold) and drop routing, menuPop, sheet. Fake DOM: tests/wk-dom.mjs; never pass fake-DOM
// nodes to assert.* (ids, strings and numbers only).
// Run alone: node --max-old-space-size=2048 --test tests/cv-tray.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
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

test('sideTray: a tap on the rail opens and closes it (aria-expanded, the panel shown); a press outside closes it (not on the kept areas); close() says whether it was open; state persisted', () => {
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
  assert.deepEqual([R.S.isOpen(), R.panel.hidden], [false, true], 'a press outside closes it');
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
  assert.deepEqual(t0.children.map(c => c.className), ['cv-tart', 'cv-tname', 'cv-tmeta']);
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
