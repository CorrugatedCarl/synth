import './v8-guard.mjs';
// cv-tray.js (stage 1b SHELL lane; docs/canvas/IMPL-1b.md §8.1): budget(), topSnaps(), trayGrip (drag, two-finger
// rollback, keys, ARIA), sideTray (grip inset, stays open on a press outside, never closes itself), sourcesTray
// drag verdicts (out / along / hold) and drop routing, menuPop, sheet; (2026-10-22) the Effects tray gone (no effectsTray,
// no markup, no styles), the pull tabs (pullSnap / pullSpeed; a tap toggles, a pull drags the tray and snaps it, a
// two-finger cancel puts it back; the Sources tray's tab, the grips' taps, flicks and the keyboard's fold); (2a) the Modulators section
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
import * as PT from '../patch-core.js?v=9';
import * as cvArt from '../cv-art.js?v=9';
import { MODULE_LAYOUTS } from '../panels/index.js?v=9';
import { RIG, MODULES, SKINS, SKIN_DEFAULT } from '../rig-core.js?v=9';
// (WC, IMPL-WC §7) the rig view's note (the srcNote line) and its tiles' tip, from the display constant
const RIG_NOTE = `Drop a module onto the canvas: on a ${RIG.NAME} it adds itself and plugs in; on any other instrument it starts a ${RIG.NAME} with it.`;
// (integration fixer L, review WC-int P3-8: our own words through RIG.NAME — the old "Arrive with the next cut." was the plan's jargon)
const RIG_SOON = `The ${RIG.NAME}’s Arpeggiator and Clip sequencer arrive in a later update.`;
const RIG_TIP = n => `${n} — tap to add it to this track's ${RIG.NAME} (or start one with it), or drag it onto the canvas`;

const wait = ms => new Promise(r => setTimeout(r, ms));
let TS = 5000; // event timestamps (dragSource / double-tap timing)
const at = (o = {}) => Object.assign({ timeStamp: (TS += 40), isPrimary: true, pointerId: 1 }, o);
const mkEl = (d, tag = 'div', id) => { const e = d.createElement(tag); if (id) e.id = id; d.body.appendChild(e); return e; };

test('topSnaps(): the collapsed row, then the arrangement toolbar + ruler + whole track rows; nearestSnap()', () => {
  assert.deepEqual(T.topSnaps(0), [48]);
  assert.deepEqual(T.topSnaps(1), [48, 160]);
  assert.deepEqual(T.topSnaps(3), [48, 160, 216, 272]);
  assert.deepEqual([T.TOP_ROW, T.ARR_BAR, T.RULER, T.ROW_H, T.CANVAS_MIN, T.SIDE_W, T.EDGE_INSET], [48, 32, 24, 56, 240, 240, 24]);
  assert.equal(T.RAIL_W, undefined, '(2026-10-22) no rail: a closed side tray is its pull tab');
  assert.deepEqual([T.PULL_SLOP, T.FLICK_V, T.SNAP_MS], [6, 500, 220]);
  assert.equal(T.TRAY_PREF, 'synth.cv.trays');
  const S = T.topSnaps(4);
  assert.equal(T.nearestSnap(S, 110), 160);
  assert.equal(T.nearestSnap(S, 100), 48);
  assert.equal(T.nearestSnap(S, 90), 48);
  assert.equal(T.nearestSnap(S, 250), 272);
  assert.equal(T.nearestSnap(S, 400, 230), 216, 'only stops that fit');
  assert.equal(T.nearestSnap(S, 400, 20), 48, 'none fits: the lowest');
  // (stage M, IMPL-M §5.1) the footer (the Master row) under the rows: on every stop but the collapsed one
  assert.equal(T.FOOT_H, 44);
  assert.deepEqual(T.topSnaps(3, T.FOOT_H), [48, 204, 260, 316]);
  assert.deepEqual(T.topSnaps(0, 44), [48], 'no rows: the collapsed stop alone');
  assert.deepEqual(T.topSnaps(2, -5), T.topSnaps(2), 'a negative foot: none');
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

// (WC pre-deploy [toast]) the boxes Chrome for Testing measured with a Wavecraft open (iPad portrait / landscape at dpr 2 with touch, the
// desktop with a mouse), the Sources tray open and shut: the stage, the toolbar's row (its fold button to its ∿), its minimap, the
// keyboard's grip, the tray, its tab — and every toolbar button's centre. The notice's one-line sizes: "Replaced Minimoog with Wavecraft ·
// tap to undo" 296.8 × 30.8, "Added Envelope 2 · tap to undo" 200.2 × 30.8, a long one (the piano-roll write) 640 × 30.8
const BX = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b });
const NOTICE_GEO = {
  'p open': { stage: BX(0, 205, 1024, 1127), bar: BX(296, 1063, 667, 1115), map: BX(296, 943, 472, 1055), grip: BX(468, 1096, 556, 1140), tray: BX(0, 205, 240, 1127), tab: BX(240, 622, 284, 710), btn: [[322, 391, 457, 503, 549, 595, 641], 1089] },
  'p shut': { stage: BX(0, 205, 1024, 1127), bar: BX(56, 1063, 427, 1115), map: BX(56, 943, 232, 1055), grip: BX(468, 1096, 556, 1140), tray: null, tab: BX(0, 622, 44, 710), btn: [[82, 151, 217, 263, 309, 355, 401], 1089] },
  'l open': { stage: BX(0, 205, 1366, 785), bar: BX(296, 721, 667, 773), map: BX(296, 601, 472, 713), grip: BX(639, 754, 727, 798), tray: BX(0, 205, 240, 785), tab: BX(240, 451, 284, 539), btn: [[322, 391, 457, 503, 549, 595, 641], 747] },
  'l shut': { stage: BX(0, 205, 1366, 785), bar: BX(56, 721, 427, 773), map: BX(56, 601, 232, 713), grip: BX(639, 754, 727, 798), tray: null, tab: BX(0, 451, 44, 539), btn: [[82, 151, 217, 263, 309, 355, 401], 747] },
  'd open': { stage: BX(0, 205, 1440, 670), bar: BX(296, 616, 599, 658), map: BX(296, 496, 472, 608), grip: BX(676, 651, 764, 683), tray: BX(0, 205, 240, 670), tab: BX(240, 393.5, 272, 481.5), btn: [[317, 377, 434, 470, 506, 542, 578], 637] },
  'd shut': { stage: BX(0, 205, 1440, 670), bar: BX(56, 616, 359, 658), map: BX(56, 496, 232, 608), grip: BX(676, 651, 764, 683), tray: null, tab: BX(0, 393.5, 32, 481.5), btn: [[77, 137, 194, 230, 266, 302, 338], 637] },
};
const crosses = (a, b) => !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const spotBox = (q, w, h) => { const ww = Math.min(w, q.maxW), lines = Math.ceil(w / q.maxW - 1e-9); return BX(q.x, q.bottom - h * lines, q.x + ww, q.bottom); };
test('(WC pre-deploy [toast]) noticeSpot: the notice never lies over the canvas toolbar, its minimap, the keyboard\'s grip, the Sources tray or its tab — beside the toolbar on its row where the line fits (lifted clear of the grip), else above the row right of the minimap, else above both; no toolbar: centred over the stage, clear of the grip', () => {
  assert.equal(typeof T.noticeSpot, 'function');
  for (const [at, g] of Object.entries(NOTICE_GEO)) {
    for (const [w, h] of [[296.8, 30.8], [200.2, 30.8], [640, 30.8]]) {
      const q = T.noticeSpot(Object.assign({ w, h }, g)), r = spotBox(q, w, h), tag = `${at} ${w}`;
      for (const k of ['bar', 'map', 'grip', 'tray', 'tab']) assert.ok(!crosses(r, g[k]), `${tag}: clear of the ${k} (${[r.left, r.top, r.right, r.bottom].map(Math.round)})`);
      for (const x of g.btn[0]) assert.ok(!(x >= r.left && x <= r.right && g.btn[1] >= r.top && g.btn[1] <= r.bottom), `${tag}: the button at ${x} answers its own tap`);
      assert.ok(r.left >= g.stage.left && r.right <= g.stage.right && r.top >= g.stage.top && r.bottom <= g.stage.bottom, `${tag}: inside the stage`);
      if (w < 600) {
        assert.ok(q.maxW >= w, `${tag}: one line`);
        assert.equal(q.x, g.bar.right + T.NOTICE_GAP, `${tag}: beside the toolbar`);
        assert.ok(r.bottom <= g.bar.bottom && r.top >= g.bar.top - 3, `${tag}: on its row`);
      }
    }
  }
  // portrait, tray open, the long line: no room beside (333 px) → above the row, right of the minimap, one line
  const g = NOTICE_GEO['p open'], q = T.noticeSpot(Object.assign({ w: 520, h: 30.8 }, g));
  assert.deepEqual([q.x, q.bottom, q.maxW >= 520], [g.map.right + T.NOTICE_GAP, g.bar.top - 8, true], 'above the row, past the minimap');
  // longer than any room in the foot: two lines beside the row (growing upward from its foot) before one line above the minimap (the canvas)
  const ql = T.noticeSpot(Object.assign({ w: 640, h: 30.8 }, g));
  assert.deepEqual([ql.x, ql.bottom, ql.maxW], [g.bar.right + T.NOTICE_GAP, g.bar.bottom, 1012 - 679], 'beside, wrapped');
  // the page-zoomed chip widens the toolbar: the same rule
  const z = Object.assign({}, g, { bar: BX(296, 1063, 805, 1115), w: 296.8, h: 30.8 }), qz = T.noticeSpot(z);
  assert.deepEqual([qz.x, qz.bottom], [g.map.right + T.NOTICE_GAP, 1055], 'the chip: above the row');
  assert.ok(!crosses(spotBox(qz, 296.8, 30.8), z.bar) && !crosses(spotBox(qz, 296.8, 30.8), z.map));
  // no minimap (hidden / a folded toolbar keeps only its button): above the row starts at the toolbar's left
  const nm = Object.assign({}, g, { map: null, bar: BX(296, 1063, 805, 1115), w: 296.8, h: 30.8 });
  assert.deepEqual([T.noticeSpot(nm).x, T.noticeSpot(nm).bottom], [296, 1055]);
  // a phone (390 px, the toolbar wider than the screen): above the minimap, centred past the screen's edges
  const ph = { stage: BX(0, 100, 390, 600), bar: BX(56, 536, 427, 588), map: BX(56, 416, 232, 528), grip: BX(151, 569, 239, 613), tray: null, tab: BX(0, 306, 44, 394), w: 296.8, h: 30.8 };
  const qp = T.noticeSpot(ph), rp = spotBox(qp, 296.8, 30.8);
  assert.deepEqual([qp.bottom, Math.round(rp.left + rp.right)], [408, 390], 'above both, centred');
  for (const k of ['bar', 'map', 'grip', 'tab']) assert.ok(!crosses(rp, ph[k]), 'phone: clear of the ' + k);
  // no toolbar (the roll): centred over the stage 24 px above its foot — lifted clear of the grip's box
  const roll = T.noticeSpot({ stage: g.stage, bar: null, map: null, grip: g.grip, tray: null, tab: null, w: 296.8, h: 30.8 }), rr = spotBox(roll, 296.8, 30.8);
  assert.deepEqual([Math.round(rr.left + rr.right), roll.bottom], [1024, g.grip.top - 4], 'centred, over the grip');
  const roll2 = T.noticeSpot({ stage: g.stage, grip: BX(0, 0, 0, 0), w: 296.8, h: 30.8 });
  assert.equal(roll2.bottom, g.stage.bottom - 24, 'no grip there: the stylesheet\'s 24 px');
  assert.equal(T.noticeSpot({ stage: null, w: 10, h: 10 }), null, 'nothing measured: the stylesheet\'s spot');
});

// (WC pre-deploy [toast], round 2 — the skeptic) a narrow window with the Sources tray open left none of those rooms clear: the line fell back to
// the stylesheet's spot, over the tray, the toolbar's fold button and the grips (375 Slide Over / a 1/3 split, a 390 phone, a 639 2/3 split with
// the tray pulled to 440), or lay on the tray's tab (a 678 1/2 split, the tray at 440, the keyboard pulled taller: a tap on the tab undid). The
// boxes Chrome for Testing measured there (touch, dpr 2), the top grip with them; the toolbar runs past the window's edge (its far buttons off it)
const NARROW_GEO = {
  '375 open': { stage: BX(0, 205, 375, 791), bar: BX(296, 727, 667, 779), map: BX(296, 607, 472, 719), grip: BX(144, 760, 232, 804), tray: BX(0, 205, 240, 791), tab: BX(240, 454, 284, 542), top: BX(144, 192, 232, 236), btn: [[322, 391, 457, 503, 549, 595, 641], 753] },
  '390 open': { stage: BX(0, 205, 390, 611), bar: BX(296, 547, 667, 599), map: BX(296, 427, 472, 539), grip: BX(151, 580, 239, 624), tray: BX(0, 205, 240, 611), tab: BX(240, 364, 284, 452), top: BX(151, 192, 239, 236), btn: [[322, 391, 457, 503, 549, 595, 641], 573] },
  '639 wide': { stage: BX(0, 205, 639, 789), bar: BX(496, 725, 867, 777), map: BX(496, 605, 672, 717), grip: BX(276, 758, 364, 802), tray: BX(0, 205, 440, 789), tab: BX(440, 453, 484, 541), top: BX(276, 192, 364, 236), btn: [[522, 591, 657, 703, 749, 795, 841], 751] },
  '678 wide kb': { stage: BX(0, 205, 678, 679), bar: BX(496, 615, 867, 667), map: BX(496, 495, 672, 607), grip: BX(295, 648, 383, 692), tray: BX(0, 205, 440, 679), tab: BX(440, 398, 484, 486), top: BX(295, 192, 383, 236), btn: [[522, 591, 657, 703, 749, 795, 841], 641] },
};
const clearOf = (r, g, tag) => {
  for (const k of ['bar', 'map', 'grip', 'tray', 'tab', 'top']) assert.ok(!crosses(r, g[k]), `${tag}: clear of the ${k} (${[r.left, r.top, r.right, r.bottom].map(Math.round)})`);
  for (const x of g.btn[0]) assert.ok(!(x >= r.left && x <= r.right && g.btn[1] >= r.top && g.btn[1] <= r.bottom), `${tag}: the button at ${x} answers its own tap`);
  assert.ok(r.left >= g.stage.left && r.right <= g.stage.right && r.top >= g.stage.top && r.bottom <= g.stage.bottom, `${tag}: inside the stage (${[r.left, r.top, r.right, r.bottom].map(Math.round)})`);
};
test('(WC pre-deploy [toast], round 2) noticeSpot in a narrow window with the Sources tray open (375, a 390 phone, 639 and 678 with the tray at 440): never over the toolbar, the minimap, a grip, the tray or its tab — a free column of the stage right of the tray, at least NOTICE_FLOOR px wide, wrapped; a measured wrap taller than the estimate (o.fit) is placed by its own height; no column at all: the minimap given up, nothing else', () => {
  assert.equal(T.NOTICE_FLOOR, 96);
  for (const [at, g] of Object.entries(NARROW_GEO)) {
    for (const [w, h] of [[296.8, 30.8], [200.2, 30.8]]) {
      const q = T.noticeSpot(Object.assign({ w, h }, g)), tag = `${at} ${w}`;
      assert.ok(q && isFinite(q.x) && isFinite(q.bottom), `${tag}: a spot`);
      clearOf(spotBox(q, w, h), g, tag);
      assert.ok(q.maxW >= T.NOTICE_FLOOR, `${tag}: a readable column (${Math.round(q.maxW)} px)`);
    }
  }
  // 639, the tray at 440: right of the tray over the tab (175 px, two lines) — not squeezed beside the tab under it (131 px, three)
  const g = NARROW_GEO['639 wide'], q = T.noticeSpot(Object.assign({ w: 296.8, h: 30.8 }, g));
  assert.deepEqual([q.x, q.bottom, q.maxW], [452, g.tab.top - 8, 639 - 12 - 452], 'over the tab, the column right of the tray');
  // a measured wrap (a word carried to the next line each time: more lines than need / width; 16.8 px a line) — the box by its own height,
  // still clear; the long line too (the piano-roll write for a Prophet-5, 572 px on one line: Chrome wrapped it to 7 lines at 126 px, as
  // this model does), a readable column
  for (const W of [296.8, 572]) {
    const fit = mw => { const lines = Math.max(1, Math.ceil(W / (mw - 40) - 1e-9)); return { w: Math.min(W, mw), h: 30.8 + (lines - 1) * 16.8, lines }; };
    for (const [at, G] of Object.entries(NARROW_GEO)) {
      const qf = T.noticeSpot(Object.assign({ w: W, h: 30.8, fit }, G)), z = fit(Math.floor(qf.maxW)), tag = `${at} ${W} measured`;
      clearOf(BX(qf.x, qf.bottom - z.h, qf.x + z.w, qf.bottom), G, tag);
      assert.ok(qf.maxW >= T.NOTICE_FLOOR, `${tag}: a readable column (${Math.round(qf.maxW)} px)`);
    }
  }
  // no column at all (a 700 × 500 window, the tray pulled to 440, the track list's rows over the stage's top: main.js gives the stage from
  // 124): the toolbar, the minimap and the tab fill the canvas's 260 px — the line gives up the minimap only (the chrome least tapped right
  // after a swap): clear of the toolbar, the tray, its tab and the grips, inside the stage
  const Z = { stage: BX(0, 124, 700, 305), bar: BX(496, 241, 867, 293), map: BX(496, 121, 672, 233), grip: BX(306, 274, 394, 318), tray: BX(0, 124, 440, 305), tab: BX(440, 142, 484, 230), top: BX(306, 53, 394, 97), btn: [[522, 591, 657, 703, 749, 795, 841], 267] };
  const qz = T.noticeSpot(Object.assign({ w: 296.8, h: 30.8 }, Z)), rz = spotBox(qz, 296.8, 30.8);
  clearOf(rz, Object.assign({}, Z, { map: null }), 'no column');
  assert.ok(crosses(rz, Z.map) && qz.maxW >= T.NOTICE_FLOOR, 'the minimap given up, a readable column');
  // the iPad and desktop rooms keep their spots with a measured one-line size (the fit agrees with the estimate)
  const one = mw => ({ w: Math.min(296.8, mw), h: 30.8 * Math.ceil(296.8 / mw - 1e-9), lines: Math.ceil(296.8 / mw - 1e-9) });
  for (const [at, G] of Object.entries(NOTICE_GEO)) {
    const a = T.noticeSpot(Object.assign({ w: 296.8, h: 30.8 }, G)), b = T.noticeSpot(Object.assign({ w: 296.8, h: 30.8, fit: one }, G));
    assert.deepEqual([b.x, b.bottom, b.maxW], [a.x, a.bottom, a.maxW], at + ': the same spot measured');
  }
});

function gripRig(o = {}) {
  const d = fresh(), g = mkEl(d, 'div', 'grip'), log = [];
  let h = o.h0 != null ? o.h0 : 160, starts = 0;
  const G = T.trayGrip(g, Object.assign({
    edge: 'top', label: 'Track list height', get: () => h, set: (px, ph) => { log.push(ph + ' ' + px); if (ph !== 'reset') h = px; },
    min: () => 48, max: () => 400, start: () => { starts++; },
  }, o.opts || {}));
  return { d, g, G, log, get h() { return h; }, set h(v) { h = v; }, get starts() { return starts; } };
}

test('trayGrip: a drag sets the height (a top tray grows downward, a bottom one upward), clamped, snapped to whole rows on release; ARIA slider values', () => {
  const R = gripRig({ opts: { snaps: () => T.topSnaps(5), text: v => v + ' px tall' } });
  const g = R.g;
  assert.deepEqual([g.getAttribute('role'), g.getAttribute('aria-orientation'), g.getAttribute('aria-label'), g.getAttribute('tabindex')], ['slider', 'vertical', 'Track list height', '0']);
  assert.deepEqual([g.getAttribute('aria-valuenow'), g.getAttribute('aria-valuemin'), g.getAttribute('aria-valuemax'), g.getAttribute('aria-valuetext')], ['160', '48', '400', '160 px tall']);
  ptr(g, 'pointerdown', 300, 200, at({ pointerType: 'touch' }));
  assert.equal(R.starts, 1);
  ptr(g, 'pointermove', 300, 202, at({ pointerType: 'touch' }));
  assert.deepEqual(R.log, [], 'under PULL_SLOP (6 px): still a tap');
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

test('pullSnap (the user, 2026-10-22: "pull it out like a physical tray"): a flick (|v| ≥ FLICK_V px/s) goes its way however far it was pulled; slower, past half the travel opens; pullSpeed: the travel over the last ≤ 100 ms (a finger that rested before lifting: 0)', () => {
  assert.deepEqual([T.pullSnap(0, 240), T.pullSnap(119, 240), T.pullSnap(120, 240), T.pullSnap(240, 240)], [false, false, true, true], 'slow: past half opens');
  assert.deepEqual([T.pullSnap(10, 240, 500), T.pullSnap(10, 240, 499), T.pullSnap(230, 240, -500), T.pullSnap(230, 240, -499)], [true, false, false, true], 'a flick goes its way');
  assert.deepEqual([T.pullSnap(0, 0), T.pullSnap(3, 0)], [false, true], 'no travel: any pull opens');
  assert.equal(T.pullSpeed([]), 0);
  assert.equal(T.pullSpeed([{ t: 0, p: 0 }]), 0);
  assert.equal(T.pullSpeed([{ t: 0, p: 0 }, { t: 40, p: 20 }, { t: 80, p: 60 }]), 750, '60 px in 80 ms');
  assert.equal(T.pullSpeed([{ t: 0, p: 0 }, { t: 100, p: 10 }, { t: 160, p: 70 }, { t: 200, p: 90 }]), 800, 'the window: the last ≤ 100 ms (from t 100)');
  assert.equal(T.pullSpeed([{ t: 0, p: 0 }, { t: 40, p: 120 }, { t: 400, p: 120 }]), 0, 'rested 360 ms, then lifted: no flick');
  assert.equal(T.pullSpeed([{ t: 0, p: 100 }, { t: 40, p: 60 }, { t: 80, p: 20 }]), -1000, 'inward: negative');
});

test('trayGrip (2026-10-22): a tap — a press of any pointer travelling < PULL_SLOP px, however long — and Enter / Space call onTap (no double-tap any more); a drag, a two-finger cancel or a mouse press that loses its pointerup do not', () => {
  let taps = 0;
  const R = gripRig({ opts: { snaps: () => T.topSnaps(5), onTap: () => { taps++; } } });
  const tap = (x, y, o) => { ptr(R.g, 'pointerdown', x, y, at(o)); ptr(R.g, 'pointermove', x + 3, y + 5, at(o)); ptr(R.g, 'pointerup', x + 3, y + 5, at(o)); };
  tap(300, 10, { pointerType: 'touch' });
  assert.deepEqual([taps, R.log], [1, []], 'a touch tap (5 px of travel): onTap, no height set');
  tap(300, 10, { pointerType: 'mouse' }); tap(300, 10, { pointerType: 'pen' });
  assert.equal(taps, 3, 'a mouse click and a pen tap too');
  ptr(R.g, 'pointerdown', 300, 10, at({ pointerType: 'touch' })); TS += 900; ptr(R.g, 'pointerup', 300, 10, at({ pointerType: 'touch' }));
  assert.equal(taps, 4, 'a long press that never moved is a tap');
  ptr(R.g, 'pointerdown', 300, 100, at({ pointerType: 'touch' })); ptr(R.g, 'pointermove', 300, 106, at({ pointerType: 'touch' })); ptr(R.g, 'pointerup', 300, 106, at({ pointerType: 'touch' }));
  assert.equal(taps, 4, 'PULL_SLOP (6 px) of travel: a drag, no tap');
  ptr(R.g, 'pointerdown', 300, 100, at({ pointerType: 'touch', pointerId: 7 })); ptr(R.g, 'pointercancel', 300, 100, at({ pointerType: 'touch', pointerId: 7, gesture: 'two-finger' }));
  assert.equal(taps, 4, 'a second finger: the pinch, no tap');
  ptr(R.g, 'pointerdown', 300, 100, at({ pointerId: 8 })); ptr(R.g, 'pointermove', 300, 101, at({ pointerId: 8, buttons: 0 }));
  assert.equal(taps, 4, 'a mouse whose pointerup was swallowed: no tap');
  for (const k of ['Enter', ' ']) { const e = key(R.g, k); assert.deepEqual([e.defaultPrevented, taps], [true, k === 'Enter' ? 5 : 6], JSON.stringify(k)); }
  const n = R.log.length;
  key(R.g, 'Delete');
  assert.equal(R.log.length, n + 1, 'Delete still resets');
  assert.equal(R.log.at(-1), 'reset 0');
  fire(R.g, 'dblclick');
  assert.equal(taps, 6, 'a dblclick is nothing of its own');
  R.G.destroy();
});

test('trayGrip (2026-10-22): a release flicked inward folds the tray to its least, one flicked outward from its fold opens it to o.open(); slower the snaps decide (the first stop past half its travel)', () => {
  const R = gripRig({ h0: 272, opts: { snaps: () => T.topSnaps(5), open: () => 328 } });
  const tp = { pointerType: 'touch' };
  // flicked up (inward for a top tray): 60 px in 40 ms (the lift 40 ms later: 750 px/s over the last 80 ms)
  ptr(R.g, 'pointerdown', 300, 300, at(tp)); ptr(R.g, 'pointermove', 300, 290, at(tp)); ptr(R.g, 'pointermove', 300, 230, at(tp)); ptr(R.g, 'pointerup', 300, 230, at(tp));
  assert.deepEqual([R.h, R.log.at(-1)], [48, 'end 48'], 'flicked in from three rows: folded');
  // flicked down out of the fold: to o.open()
  ptr(R.g, 'pointerdown', 300, 40, at(tp)); ptr(R.g, 'pointermove', 300, 50, at(tp)); ptr(R.g, 'pointermove', 300, 110, at(tp)); ptr(R.g, 'pointerup', 300, 110, at(tp));
  assert.deepEqual([R.h, R.log.at(-1)], [328, 'end 328'], 'flicked out: the last height');
  // slow (the finger rests before lifting): the nearest stop
  R.h = 48;
  ptr(R.g, 'pointerdown', 300, 40, at(tp)); ptr(R.g, 'pointermove', 300, 100, at(tp)); TS += 300; ptr(R.g, 'pointermove', 300, 91, at(tp)); TS += 300; ptr(R.g, 'pointerup', 300, 91, at(tp));
  assert.deepEqual([R.h, R.log.at(-1)], [48, 'end 48'], '51 px of the 112 to the first stop: under half — folded again');
  ptr(R.g, 'pointerdown', 300, 40, at(tp)); ptr(R.g, 'pointermove', 300, 100, at(tp)); TS += 300; ptr(R.g, 'pointermove', 300, 97, at(tp)); TS += 300; ptr(R.g, 'pointerup', 300, 97, at(tp));
  assert.deepEqual([R.h, R.log.at(-1)], [160, 'end 160'], '57 px: past half — the first stop');
  R.G.destroy();
});

// a bottom tray that folds away past its least (the keyboard): o.fold's calls in a log
function foldRig(o = {}) {
  const F = { shut: !!o.shut, L: [] };
  const R = gripRig({ h0: o.h0 || 170, opts: Object.assign({ edge: 'bottom', label: 'Keyboard height', min: () => 70, max: () => 360, onTap: () => { F.L.push('tap'); F.shut = !F.shut; },
    fold: { label: 'Keyboard (folded away): show it', closed: () => F.shut, begin: () => { F.L.push('begin'); return 134; }, pull: out => F.L.push('pull ' + out),
      done: (open, how) => { F.L.push('done ' + open + ' ' + how); F.shut = !open; } } }, o.opts || {}) });
  R.F = F;
  return R;
}

test('trayGrip fold (2026-10-22, the keyboard): folded, the tab is a button (aria-expanded false, its label, no values); a pull drags the drawer out (begin → its travel, pull per move) and its release snaps it — past half opens, a flick goes its way, a two-finger cancel shuts it again; open, the slider again', () => {
  const R = foldRig({ shut: true }), g = R.g, tp = { pointerType: 'touch' };
  assert.deepEqual([g.getAttribute('role'), g.getAttribute('aria-expanded'), g.getAttribute('aria-label'), g.hasAttribute('aria-valuenow'), g.hasAttribute('aria-orientation')],
    ['button', 'false', 'Keyboard (folded away): show it', false, false]);
  // a slow pull up to 50 of 134 px: back shut
  ptr(g, 'pointerdown', 500, 900, at(tp)); ptr(g, 'pointermove', 500, 896, at(tp));
  assert.deepEqual(R.F.L, [], 'under PULL_SLOP: nothing yet');
  ptr(g, 'pointermove', 500, 870, at(tp)); ptr(g, 'pointermove', 500, 850, at(tp)); TS += 300; ptr(g, 'pointermove', 500, 850, at(tp)); TS += 300; ptr(g, 'pointerup', 500, 850, at(tp));
  assert.deepEqual(R.F.L, ['begin', 'pull 30', 'pull 50', 'pull 50', 'done false end'], 'begin once, the drawer follows, under half: shut');
  assert.deepEqual(R.log, [], 'the height untouched');
  // past half: open — then the slider again
  R.F.L.length = 0;
  ptr(g, 'pointerdown', 500, 900, at(tp)); ptr(g, 'pointermove', 500, 820, at(tp)); ptr(g, 'pointermove', 500, 600, at(tp)); TS += 300; ptr(g, 'pointerup', 500, 600, at(tp));
  assert.deepEqual(R.F.L, ['begin', 'pull 80', 'pull 134', 'done true end'], 'clamped to its travel; past half: open');
  assert.deepEqual([g.getAttribute('role'), g.hasAttribute('aria-expanded'), g.getAttribute('aria-label'), g.getAttribute('aria-valuenow')], ['slider', false, 'Keyboard height', '170']);
  // a quick flick from shut: 50 px (under half) in 40 ms opens
  R.F.shut = true; R.F.L.length = 0;
  ptr(g, 'pointerdown', 500, 900, at(tp)); ptr(g, 'pointermove', 500, 850, at(tp)); ptr(g, 'pointerup', 500, 850, at(tp));
  assert.deepEqual(R.F.L, ['begin', 'pull 50', 'done true end'], 'a flick out opens');
  // a second finger: shut again, nothing saved
  R.F.shut = true; R.F.L.length = 0;
  ptr(g, 'pointerdown', 500, 900, at(tp)); ptr(g, 'pointermove', 500, 800, at(tp)); ptr(g, 'pointercancel', 500, 800, at(Object.assign({ gesture: 'two-finger' }, tp)));
  assert.deepEqual(R.F.L, ['begin', 'pull 100', 'done false cancel'], 'the pinch: shut');
  // folded, the keys do not size it; Enter / Space and a tap open it
  R.F.L.length = 0;
  assert.equal(key(g, 'ArrowUp').defaultPrevented, false, 'folded: arrows are the page\'s');
  key(g, 'Enter');
  assert.deepEqual([R.F.L, R.F.shut], [['tap'], false]);
  R.G.destroy();
});

test('trayGrip fold (2026-10-22): open, a drag below the least goes on as the drawer closing (the height held at min, fold.pull per move; back above: pull(null)); its release snaps — under half: folded away with the height as it was; past half: open at min; a flick inward from anywhere folds it away; a two-finger cancel puts all back', () => {
  const R = foldRig({ h0: 170 }), g = R.g, tp = { pointerType: 'touch' };
  // down 150 px: 100 to the least (70), then 50 of the drawer's 134
  ptr(g, 'pointerdown', 500, 400, at(tp)); ptr(g, 'pointermove', 500, 460, at(tp));
  assert.deepEqual([R.h, R.F.L], [110, []], 'sizing first');
  ptr(g, 'pointermove', 500, 550, at(tp));
  assert.deepEqual([R.h, R.F.L], [70, ['begin', 'pull 84']], 'past the least: held there, the drawer 50 px in');
  ptr(g, 'pointermove', 500, 480, at(tp));
  assert.deepEqual([R.h, R.F.L.at(-1)], [90, 'pull null'], 'back above it: the tray in place, sizing again');
  ptr(g, 'pointermove', 500, 600, at(tp)); TS += 300; ptr(g, 'pointerup', 500, 600, at(tp));
  assert.deepEqual(R.F.L.slice(-3), ['begin', 'pull 34', 'done false end'], '100 of 134 in: under half out — folded away');
  assert.deepEqual([R.h, R.log.at(-1)], [170, 'cancel 170'], 'its height as it was (the keys open at it again)');
  // past half out: open at the least
  R.F.shut = false; R.F.L.length = 0; R.h = 170;
  ptr(g, 'pointerdown', 500, 400, at(tp)); ptr(g, 'pointermove', 500, 520, at(tp)); TS += 300; ptr(g, 'pointerup', 500, 520, at(tp));
  assert.deepEqual([R.F.L, R.h, R.log.at(-1)], [['begin', 'pull 114', 'done true end'], 70, 'end 70']);
  // a flick down while sizing: folded away
  R.F.L.length = 0; R.h = 200;
  ptr(g, 'pointerdown', 500, 400, at(tp)); ptr(g, 'pointermove', 500, 410, at(tp)); ptr(g, 'pointermove', 500, 470, at(tp)); ptr(g, 'pointerup', 500, 470, at(tp));
  assert.deepEqual([R.F.L, R.h], [['done false end'], 200], 'a flick in: folded away, its height kept');
  // a two-finger cancel in the drawer: all back
  R.F.shut = false; R.F.L.length = 0; R.h = 170;
  ptr(g, 'pointerdown', 500, 400, at(tp)); ptr(g, 'pointermove', 500, 560, at(tp)); ptr(g, 'pointercancel', 500, 560, at(Object.assign({ gesture: 'two-finger' }, tp)));
  assert.deepEqual([R.F.L, R.h, R.log.at(-1)], [['begin', 'pull 74', 'done true cancel'], 170, 'cancel 170']);
  R.G.destroy();
});

function sideRig(o = {}) {
  const d = fresh(), el = mkEl(d, 'aside', 'srcTray'), tab = d.createElement('button'), panel = d.createElement('div'), grip = d.createElement('div');
  panel.id = 'srcPanel';
  el.append(panel, grip, tab);
  const outside = mkEl(d, 'div', 'canvas'), keep = mkEl(d, 'div', 'perf');
  const mem = new Map(Object.entries(o.pref || {}));
  const store = { get: (k, def) => (mem.has(k) ? JSON.parse(mem.get(k)) : def), set: (k, v) => mem.set(k, JSON.stringify(v)) };
  const changes = [];
  const S = T.sideTray(el, Object.assign({ side: 'left', store, tab, panel, grip, label: 'Sources', onChange: on => changes.push(on) }, o.opts || {}));
  return { d, el, tab, panel, grip, outside, keep, store, mem, changes, S };
}

test('sideTray (2026-10-22: no rail): a tap on its pull tab opens and closes it (a button: aria-expanded, aria-controls, its label; the tray\'s `open` class — closed is the stylesheet\'s, never `hidden`); a press outside (the canvas) leaves it open — the user\'s call; close() says whether it was open; state persisted', () => {
  const R = sideRig();
  assert.deepEqual([R.S.isOpen(), R.el.classList.contains('open'), R.panel.hidden, R.tab.getAttribute('type'), R.tab.getAttribute('aria-expanded'), R.tab.getAttribute('aria-controls'), R.tab.getAttribute('aria-label')],
    [false, false, false, 'button', 'false', 'srcPanel', 'Sources']);
  R.tab.click();
  assert.deepEqual([R.S.isOpen(), R.panel.hidden, R.tab.getAttribute('aria-expanded'), R.el.classList.contains('open')], [true, false, 'true', true]);
  assert.deepEqual(R.changes, [true]);
  assert.deepEqual(JSON.parse(R.mem.get(T.TRAY_PREF)), { src: { open: true, w: 240 } });
  ptr(R.panel, 'pointerdown', 50, 50);
  assert.equal(R.S.isOpen(), true, 'a press inside keeps it');
  ptr(R.keep, 'pointerdown', 50, 50);
  assert.equal(R.S.isOpen(), true, 'the keyboard keeps it (playing while browsing)');
  ptr(R.outside, 'pointerdown', 500, 50);
  assert.deepEqual([R.S.isOpen(), R.el.classList.contains('open')], [true, true], 'a press on the canvas leaves it open');
  assert.equal(R.S.close(), true, 'close() closes it');
  assert.equal(R.S.close(), false, 'closed already');
  R.S.open();
  assert.equal(R.S.close(), true);
  R.tab.click(); R.tab.click();
  assert.equal(R.S.isOpen(), false);
  assert.deepEqual(R.changes, [true, false, true, false, true, false]);
  // restored open from the prefs (onChange told, nothing written)
  const R2 = sideRig({ pref: { [T.TRAY_PREF]: JSON.stringify({ src: { open: true, w: 300 }, top: 160 }) } });
  assert.deepEqual([R2.S.isOpen(), R2.S.width(), R2.el.classList.contains('open'), R2.changes], [true, 300, true, [true]]);
  R2.S.close();
  assert.deepEqual(JSON.parse(R2.mem.get(T.TRAY_PREF)), { src: { open: false, w: 300 }, top: 160 }, 'the other prefs kept');
  // an old Effects tray record is ignored (kept as it was, read by nobody)
  const R3 = sideRig({ pref: { [T.TRAY_PREF]: JSON.stringify({ fx: { open: true, w: 300 } }) } });
  assert.deepEqual([R3.S.isOpen(), R3.S.width()], [false, 240]);
});

test('sideTray pull (2026-10-22, the user: "tap the tab as well as pull it out like a physical tray"): past PULL_SLOP the tray follows the finger (class pull, a translateX — no layout); its release snaps it (past half opens, a flick goes its way) and the click it ends with is no tap; dragged back from open it closes the same way; a two-finger cancel puts it back as it was', () => {
  const R = sideRig(), tp = { pointerType: 'touch' }, tf = () => R.el.style.transform;
  const pull = (x0, xs, o = {}) => { ptr(R.tab, 'pointerdown', x0, 300, at(Object.assign({}, tp, o))); for (const x of xs) { if (x === 'rest') { TS += 300; continue; } ptr(R.tab, 'pointermove', x, 300, at(Object.assign({}, tp, o))); } };
  const lift = (x, o = {}) => { ptr(R.tab, 'pointerup', x, 300, at(Object.assign({}, tp, o))); R.tab.click(); }; // (the browser's click after a pointerup)
  pull(10, [14]);
  assert.deepEqual([R.el.classList.contains('pull'), tf() || ''], [false, ''], 'under PULL_SLOP: nothing moves');
  ptr(R.tab, 'pointermove', 70, 300, at(tp));
  assert.deepEqual([R.el.classList.contains('pull'), tf(), R.S.pulling()], [true, 'translateX(-180px)', true], '60 of 240 px out');
  pull(0, [], {}); // (a second pointerdown mid-pull is ignored)
  ptr(R.tab, 'pointermove', 100, 300, at(tp)); TS += 300; ptr(R.tab, 'pointermove', 100, 300, at(tp));
  lift(100);
  assert.deepEqual([R.S.isOpen(), R.el.classList.contains('pull'), tf(), R.changes], [false, false, '', []], '90 of 240 slowly: back shut (the click eaten)');
  pull(10, [80, 150, 'rest', 150]); lift(150);
  assert.deepEqual([R.S.isOpen(), R.tab.getAttribute('aria-expanded'), R.changes, JSON.parse(R.mem.get(T.TRAY_PREF)).src.open], [true, 'true', [true], true], 'past half: open (persisted)');
  pull(250, [200, 120]); // (from open: dragged back 130 px quickly)
  assert.equal(tf(), 'translateX(-130px)');
  lift(120);
  assert.deepEqual([R.S.isOpen(), R.changes], [false, [true, false]], 'flicked back: shut');
  pull(10, [20, 80]); lift(80);
  assert.deepEqual([R.S.isOpen(), R.changes.at(-1)], [true, true], 'a quick flick out (70 px, under half): open');
  R.tab.click();
  assert.equal(R.S.isOpen(), false, 'the next click is a tap again');
  // a second finger: as it was
  pull(10, [200], { pointerId: 9 });
  ptr(R.tab, 'pointercancel', 200, 300, at({ pointerType: 'touch', pointerId: 9, gesture: 'two-finger' }));
  assert.deepEqual([R.S.isOpen(), R.el.classList.contains('pull'), tf()], [false, false, ''], 'the pinch: shut again');
  // pulled past its width: clamped (a mouse, buttons held)
  ptr(R.tab, 'pointerdown', 10, 300, at()); ptr(R.tab, 'pointermove', 900, 300, at());
  assert.equal(tf(), 'translateX(0px)', 'clamped at open');
  ptr(R.tab, 'pointermove', 900, 300, at({ buttons: 0 }));
  assert.deepEqual([R.S.isOpen(), R.S.pulling()], [true, false], 'a swallowed pointerup ends it where it is');
  // a right tray pulls leftward
  const L = sideRig({ opts: { side: 'right', key: 'fx' } });
  ptr(L.tab, 'pointerdown', 1000, 300, at(tp)); ptr(L.tab, 'pointermove', 940, 300, at(tp));
  assert.equal(L.el.style.transform, 'translateX(180px)');
  R.S.destroy(); L.S.destroy();
});

test('sideTray: the width grip sits on the inner edge ≥ 24 px from the screen edge; a drag resizes (a two-finger cancel puts it back), arrows ±16, clamped', () => {
  const R = sideRig();
  R.S.open();
  assert.ok(R.S.width() - 12 >= T.EDGE_INSET, 'the grip\'s left edge clears the system edge-gesture band');
  assert.ok(T.SIDE_MIN - 12 >= T.EDGE_INSET, '… at the narrowest too');
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
  assert.equal(R.S.width(), 440, 'at most SIDE_MAX (half the window may be more)');
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

test('sideTray + sourcesTray as main.js wires them (the user\'s rule): a tile\'s tap, a drag out of the tray onto the canvas and its drop never close the tray — only its tab, its ✕ or Escape', () => {
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
    ['menu', true, [['menuitemradio', 'hw', 'Hardware', 'false'], ['menuitemradio', 'flow', 'Simple', 'true'], ['menuitemradio', 'serum', 'Serum', 'false'], ['menuitemradio', 'rig', RIG.NAME, 'false'], ['menuitemradio', 'drums', 'Drums', 'false'], ['menuitemradio', 'ctl', 'Controllers', 'false'], ['menuitemradio', 'moog', 'Moog modules', 'false']]]);
  assert.deepEqual([S.view(), S.layout(), S.views(), list.getAttribute('data-layout'), list.getAttribute('data-view')], ['flow', 'flow', ['hw', 'flow', 'serum', 'rig', 'drums', 'ctl', 'moog'], 'flow', 'flow']);
  assert.deepEqual(shown(), classic, 'Simple: the twelve classics, no Serum');
  assert.ok(classic.length === 12 && !classic.includes('serum') && !classic.includes('tr808') && !classic.includes('tr606') && !classic.includes('rig'));
  assert.deepEqual([secs(), note.textContent], [['rigmods:hidden', 'rignotes:hidden'], 'Serum and its modulators: the Serum view (the menu above).'], '((WC, IMPL-WC §6, §7) no Serum parts / Note tools sections any more; the rig view\'s two (placeholders here: no o.parts) hidden');
  // a tap opens; the Serum item picks (one call), closes it; the classics hide, the Serum tile and the placeholders show
  btn.click();
  assert.deepEqual([menu.hidden, btn.getAttribute('aria-expanded'), S.viewOpen()], [false, 'true', true]);
  items[2].click();
  assert.deepEqual([S.view(), got, menu.hidden, btn.getAttribute('aria-expanded'), btn.children[0].textContent, items.map(b => b.getAttribute('aria-checked')).join()],
    ['serum', ['serum'], true, 'false', 'Serum', 'false,false,true,false,false,false,false']);
  assert.deepEqual([shown(), secs(), list.getAttribute('data-layout'), S.layout()],
    [['serum'], ['rigmods:hidden', 'rignotes:hidden'], 'flow', 'flow'], 'Serum: its tile alone ((WC) no placeholders of its own; the rig view\'s hidden); the classics\' layout kept');
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
  assert.deepEqual([S.view(), S.layout(), got, S.viewOpen(), d.activeElement === btn, shown(), secs()], ['hw', 'hw', ['serum', 'hw'], false, true, classic, ['rigmods:hidden', 'rignotes:hidden']]);
  // restores: no call
  S.setLayout('flow');
  assert.deepEqual([S.view(), list.getAttribute('data-layout'), btn.children[0].textContent, got.length], ['flow', 'flow', 'Simple', 2], 'setLayout (a restore) does not call back');
  S.setView('serum'); S.setView('nope');
  assert.deepEqual([S.view(), S.layout(), got.length], ['hw', 'hw', 2], 'an unknown view: the first');
  assert.deepEqual([S.closeView(), (btn.click(), S.closeView()), S.viewOpen()], [false, true, false]);
  // (WC, IMPL-WC §7) the rig view: its tile alone, its two sections (placeholders without o.parts) — the module tiles, Note tools —, its note; the classics' layout kept
  S.setView(RIG.VIEW);
  assert.deepEqual([S.view(), shown(), secs(), note.textContent, S.layout(), btn.children[0].textContent, list.getAttribute('data-view')], ['rig', ['rig'], ['rigmods', 'rignotes'], RIG_NOTE, 'hw', RIG.NAME, 'rig']);
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
  assert.deepEqual([menu.children.map(b => b.getAttribute('data-view')), btn.children.map(c => c.className), menu.getAttribute('role'), btn.children[0].textContent], [['hw', 'flow', 'serum', 'rig', 'drums', 'ctl', 'moog', 'later'], ['cv-vlab', 'cv-vcaret'], 'menu', 'Simple']);
  btn.click(); menu.children[7].click();
  assert.deepEqual([S.view(), S.layout(), got, S.tiles().filter(b => !b.hidden).length, sec.children.map(s => s.getAttribute('data-sec') + (s.hidden ? ':hidden' : ''))],
    ['later', 'flow', ['later'], 0, ['rigmods:hidden', 'rignotes:hidden', 'kits']]);
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
  assert.deepEqual(menu.children.map(b => b.children[0].textContent), ['Hardware', 'Simple', 'Serum', RIG.NAME, 'Drums', 'Controllers', 'Moog modules']);
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
  btn.click(); menu.children[4].click();
  assert.deepEqual([S.view(), S.layout(), got, shown()], ['drums', 'hw', ['drums'], ['tr808', 'tr606', 'tr909', 'sdsv']], 'picked: layout hw (a drum machine has no Simple layout)');
  tile.click(); tile6.click(); tile9.click(); tileV.click();
  assert.deepEqual(picks, [['tr808', 'replace'], ['tr606', 'replace'], ['tr909', 'replace'], ['sdsv', 'replace']], 'a tap picks any of them as any instrument');
  S.destroy();
});

/* ---------------------------------------------------------------- the Effects tray (1e): gone (2026-10-22) */
test('the Effects tray is gone (the user, 2026-10-22: "remove it and move the estimates"): no effectsTray / FX_PANEL in cv-tray, no #fxTray (rail, panel, grip, list) in index.html, none of its styles; style.css keeps the canvas styles of 1e (⏻, [data-off], the zone pill, the badge, cv-ok / cv-no, cv-off, the cable selection and its ×) and the tile cost the Sources tray shows', () => {
  assert.deepEqual([typeof T.effectsTray, typeof T.FX_PANEL], ['undefined', 'undefined']);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['fxTray', 'fxRail', 'fxPanel', 'fxClose', 'fxGrip', 'fxList', 'fxMode']) assert.ok(!html.includes('id="' + id + '"'), id);
  assert.ok(!/cv-right|cv-ftiles|data-wk-inset="right"/.test(html), 'no right side tray');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  for (const sel of ['.cv-right', '.cv-ftiles', '.cv-fglyph', '.cv-fghost', '.cv-rail', '.cv-railico', '.cv-raillab']) assert.ok(!css.includes(sel), sel + ' gone');
  for (const sel of ['.cv-tgrp', '.cv-tcost', 'button.cv-pow', '.cv-mod[data-off] > .cv-body', '.cv-badge', '.cv-zone', '.cv-zpop', '.cv-jack.cv-ok',
    '#world[data-cv-patching] .cv-jack.cv-no', '.cv-cable-g.cv-off .cv-cable', '.cv-cable-g.cv-sel .cv-cable', '.cv-cable-x']) assert.ok(css.includes(sel + ' '), sel);
  assert.match(css, /\.cv-cable-x \{[^}]*width: calc\(30px \* var\(--ik, 1\)\)/, 'the × keeps its screen size');
  assert.match(css, /\.cv-zone::before \{[^}]*calc\(44px \* var\(--ik, 1\)\)/, 'the pill\'s hit area via ::before');
});

test('index.html / style.css (2026-10-22): the Sources tray\'s pull tab (#srcTab, a button with its label, after the panel and the grip) in place of the rail; the tray slides by a transform (hidden when closed, .pull without a glide, reduced motion: none); the tab is the keyboard\'s turned on its side (15 px, the ≡ mark), 32 px to touch, 44 on a coarse pointer; the keyboard\'s and the track list\'s tabs 44 px on a coarse pointer; the keyboard folds away out of the grid', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('id="srcRail"'), 'no rail');
  assert.match(html, /<div id="srcGrip" class="cv-sgrip"><\/div>\s*<button id="srcTab" class="cv-stab" type="button" aria-label="Sources" title="[^"]+"><\/button>\s*<\/aside>/);
  assert.doesNotMatch(/<div id="srcPanel"[^>]*>/.exec(html)[0], /hidden/, 'the panel is never `hidden` (it would cut the glide)');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const rule = sel => { const i = css.indexOf('\n' + sel + ' {'); assert.ok(i >= 0, sel); return css.slice(i, css.indexOf('}', i)); };
  assert.match(rule('.cv-side'), /width: var\(--cv-side-w\);[^]*transform: translateX\(-100%\); visibility: hidden; transition: transform 0\.22s/);
  assert.match(rule('.cv-side.open'), /transform: none; visibility: visible/);
  assert.match(rule('.cv-side.pull'), /visibility: visible; transition: none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.cv-side, \.cv-side\.open \{ transition: none; \} \}/);
  assert.match(rule('.cv-stab'), /visibility: visible; pointer-events: auto; position: absolute; left: 100%; top: 50%;[^]*width: 32px; height: 88px;[^]*touch-action: none/);
  assert.match(rule('.cv-stab::before'), /width: 15px;[^]*border-radius: 0 9px 9px 0/);
  assert.match(rule('.cv-stab::after'), /height: 26px;[^]*border-left: 2px solid #55575e; border-right: 2px solid #55575e/);
  assert.match(css, /@media \(pointer: coarse\) \{ \.cv-stab \{ width: 44px; \} \}/);
  assert.match(css, /\.kbgrip \{ top: -32px; height: 44px; \}/);
  assert.match(css, /\.cv-tgrip \{ bottom: -32px; height: 44px; \}/);
  assert.match(rule('.perf.gone, .perf.pull, .perf.glide'), /position: absolute; left: 0; right: 0; bottom: 0/);
  assert.match(rule('.perf.gone'), /transform: translateY\(100%\)/);
  assert.match(css, /\.perf\.gone:not\(\.glide\) > :not\(\.kbgrip\):not\(\.notice\) \{ visibility: hidden; \}/, 'folded: only the tab and a notice show');
  assert.match(css, /\.perf\.gone \.kbgrip \{ top: calc\(-20px - env\(safe-area-inset-bottom\)\); \}/, 'the tab clear of the home indicator');
  assert.ok(!css.includes('.perf.min'), 'no slim bar any more');
});

/* ---------------------------------------------------------------- UI fixes (stage 1e review, fixer U) */
test('U15: an open side tray tells its stage (the parent: class cv-left-open / cv-right-open, --cv-left-w / --cv-right-w) — the canvas toolbar moves right of the open Sources tray (style.css)', () => {
  const R = sideRig(), host = R.el.parentNode;
  assert.deepEqual([host.classList.contains('cv-left-open'), host.style['--cv-left-w']], [false, '240px'], 'closed: its width known, no class');
  R.tab.click();
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
  for (const id of ['srcTray', 'srcTab', 'srcPanel', 'srcClose', 'srcMode', 'srcLayout', 'srcList', 'srcGrip', 'srcScroll', 'srcModSec', 'srcMods', 'srcView', 'srcViewMenu', 'srcNote']) assert.match(html, new RegExp('id="' + id + '"'), id);
  // (2026-10-19) the view dropdown in #srcLayout: its button (the view, ▾) and its menu (the tray fills it)
  assert.match(html, /<div id="srcLayout" class="cv-srclay"><button id="srcView" class="cv-vbtn" type="button" aria-haspopup="menu"><span class="cv-vlab">Hardware<\/span><span class="cv-vcaret" aria-hidden="true">▾<\/span><\/button><div id="srcViewMenu" class="cv-pop cv-menupop cv-vmenu" role="menu" aria-label="Sources view" hidden><\/div><\/div>/);
  assert.match(html, /<div id="srcScroll" class="cv-tscroll">\s*<div id="srcList" class="cv-tiles"><\/div>[\s\S]*?<section id="srcModSec" class="cv-tsec" aria-label="Modulators" hidden>\s*<h3 class="cv-tgrp">Modulators<\/h3>\s*<div id="srcMods" class="cv-tiles cv-mtiles" data-tray="mods"><\/div>/); // ((WC) the rig view's two sections between: the milestone-3 / WC test below)
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

test('(WC, fixer K; review P3-14) the Sources tray scrolls as one under the mouse wheel over ANY of its tile grids — the module tiles (#srcParts) and the Modulators (#srcMods) sit in sections, not directly in #srcScroll: every .cv-tiles inside it is no scroller of its own (overflow visible) and never holds the wheel back (overscroll-behavior auto: a contained grid that cannot scroll swallowed it)', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8'), html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<div id="srcScroll" class="cv-tscroll">[\s\S]*?<section id="srcPartSec"[^>]*>[\s\S]*?<div id="srcParts" class="cv-tiles/, 'the module tiles: a grid inside a section of the scroller');
  assert.match(css, /\n\.cv-tscroll \.cv-tiles \{ overflow: visible; overscroll-behavior: auto; \}/, 'every grid inside the scroller');
  assert.ok(!/\n\.cv-tscroll > \.cv-tiles \{/.test(css), 'not only its direct children');
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
  assert.deepEqual([serum.note, serum.sections.map(s => s.id)], ['Drop a modulator on the canvas and cable its jack to any knob.', ['serum', 'mods']], '((WC) the Serum view: its tile and the modulators — the part tiles are the rig view\'s, lane U)');
});

/* ---------------------------------------------------------------- (WC, IMPL-WC §7; lane U) the rig view: its tile, its module tiles, Note tools */
// (milestone 3's Serum parts / Note tools tiles became the rig's: RIG_TILES — nine kinds, two of them (ARP, CLIP) the next cut's, so WC-1's Note tools
// section is a placeholder — in the rig view only; the machinery (o.parts, partTiles / partTile / setPartPlaced / partPlaced) is milestone 3's)
test('sourcesTray (WC): the rig view — SRC_VIEWS\'s fourth (after Serum: RIG.NAME, its tip, note and sections); the rig tile alone in it (its own art, "2026 · modular synth", no maker word, no SIMPLE badge), hidden elsewhere; a stored "rig" view opens it', () => {
  const V = T.SRC_VIEWS.find(v => v.id === RIG.VIEW);
  assert.deepEqual(T.SRC_VIEWS.map(v => v.id), ['hw', 'flow', 'serum', 'rig', 'drums', 'ctl', 'moog']);
  assert.deepEqual([V.label, V.tip, V.note, V.layout, V.sections.map(s => s.id + (s.head ? ':' + s.head : '') + (s.note ? ':' + s.note : ''))],
    [RIG.NAME, 'Our own modular synth, patched with cords', RIG_NOTE, undefined, ['rig', 'rigmods:' + RIG.NAME + ' modules', 'rignotes:Note tools:' + RIG_SOON, 'mods']]);
  assert.deepEqual([MODELS.filter(V.sections[0].models).map(m => m.id), T.SRC_VIEWS.filter(v => v.sections.some(s => s.models && s.models(MODELS.find(m => m.id === 'rig')))).map(v => v.id)], [['rig'], ['rig']], 'the rig tile: in its view only');
  const d = fresh(), host = mkEl(d), list = mkEl(d), sec = mkEl(d), note = mkEl(d, 'p'), picks = [];
  const S = T.sourcesTray(list, { models: MODELS, pick: (id, m) => picks.push(id + ':' + m), drag: {}, layoutEl: host, secEl: sec, noteEl: note, view: 'rig' });
  const shown = () => S.tiles().filter(b => !b.hidden).map(b => b.getAttribute('data-model')), tile = S.tiles().find(b => b.getAttribute('data-model') === 'rig');
  assert.deepEqual([S.view(), shown(), host.children[0].children[0].textContent, note.textContent], ['rig', ['rig'], RIG.NAME, RIG_NOTE], 'a stored "rig" view opens it');
  assert.deepEqual([tile.children.map(c => c.className), tile.children[1].textContent, tile.children[2].textContent, tile.getAttribute('aria-description')],
    [['cv-tart', 'cv-tname', 'cv-tmeta'], RIG.NAME, '2026 · modular synth', null], 'no SIMPLE badge (no hardware panel), no maker');
  assert.equal(tile.title, `${RIG.NAME} (2026) — our modular synth: modules patched with cords, a small starter rig that plays — tap to use it, or drag it onto the canvas or the track list`);
  assert.ok(!/undefined|serum|xfer/i.test(tile.title + tile.textContent), tile.title);
  assert.equal(tile.children[0].innerHTML, cvArt.art('rig', cvArt.TILE));
  for (const v of ['hw', 'flow', 'serum', 'drums', 'ctl', 'moog']) { S.setView(v); assert.equal(tile.hidden, true, v); }
  S.setView('rig'); tile.click();
  assert.deepEqual([tile.hidden, picks], [false, ['rig:replace']]);
  S.destroy();
});

test('sourcesTray (WC): o.parts — RIG_TILES (Oscillator, Sub oscillator, Noise, Filter, Envelope, LFO, Macros; Arpeggiator and Clip sequencer the next cut\'s) in the host\'s sections, headed from RIG.NAME, shown in the rig view only; Note tools a placeholder; a tap → partPick, a drag → partDrag (info.part, the world point); setPartPlaced greys one with rigFull\'s text', () => {
  assert.deepEqual(T.RIG_TILES.map(p => [p.id, p.name, p.group, p.cut]), [['osc', 'Oscillator', 'rigmods', 1], ['sub', 'Sub oscillator', 'rigmods', 1], ['noise', 'Noise', 'rigmods', 1],
    ['filter', 'Filter', 'rigmods', 1], ['env', 'Envelope', 'rigmods', 1], ['lfo', 'LFO', 'rigmods', 1], ['macros', 'Macros', 'rigmods', 1], ['arp', 'Arpeggiator', 'rignotes', 2], ['clip', 'Clip sequencer', 'rignotes', 2]]);
  assert.ok(T.RIG_TILES.every(p => p.name === MODULES[p.id].label && p.cut === MODULES[p.id].cut && Object.isFrozen(p)) && Object.isFrozen(T.RIG_TILES), 'names and cuts: rig-core MODULES');
  assert.equal(T.RIG_CUT, 1, 'WC-1: the tiles of cut 1 are live');
  assert.equal(T.PART_TILES, undefined, 'PART_TILES became RIG_TILES');
  const d0 = fresh(), pe = d0.createElement('div'), ps = d0.createElement('section'), ne = d0.createElement('div'), ns = d0.createElement('section');
  ps.append(pe); ns.append(ne);
  const picks = [], log = [];
  const R = modRig({ view: 'rig', parts: T.RIG_TILES, partsEl: pe, partsSec: ps, notesEl: ne, notesSec: ns, partPick: (id, mode) => picks.push('part ' + id + ':' + mode),
    partDrag: { begin: (id, i) => log.push('begin ' + id + (i.part ? ' part' : '')), move() {}, drop: (id, i) => { log.push('drop ' + id + ' ' + i.over + (i.part ? ' part' : '') + ' @' + i.at.x + ',' + i.at.y); return true; }, cancel: id => log.push('cancel ' + id) } });
  assert.deepEqual([pe.children.map(b => b.getAttribute('data-part')), ne.children.length, R.S.partTiles().length, R.S.partTile('arp')], [['osc', 'sub', 'noise', 'filter', 'env', 'lfo', 'macros'], 0, 7, null], 'seven live tiles; ARP / CLIP not yet');
  // the host's sections, headed by the tray (index.html holds no name): the modules' heading from RIG.NAME; Note tools a placeholder (cv-tsoon: its heading, the note)
  const kids = s => s.children.map(c => c.tagName + (c.className ? '.' + c.className.replace(/ /g, '.') : '') + (c.tagName === 'H3' || c.tagName === 'P' ? ':' + c.textContent : ''));
  assert.deepEqual([kids(ps), ps.getAttribute('aria-label'), ps.className], [['H3.cv-tgrp:' + RIG.NAME + ' modules', 'DIV'], RIG.NAME + ' modules', '']);
  assert.deepEqual([kids(ns), ns.getAttribute('aria-label'), ns.classList.contains('cv-tsoon'), ne.hidden], [['H3.cv-tgrp:Note tools', 'DIV', 'P.cv-tnote:' + RIG_SOON], 'Note tools', true, true]);
  assert.deepEqual([ps.hidden, ns.hidden], [false, false], 'the rig view');
  for (const v of ['hw', 'flow', 'serum', 'drums', 'ctl', 'moog']) { R.S.setView(v); assert.deepEqual([ps.hidden, ns.hidden], [true, true], v + ': none'); }
  R.S.setView('rig');
  const osc = R.S.partTile('osc');
  assert.deepEqual([osc.className, osc.getAttribute('data-group'), osc.children.map(c => c.className), osc.children[1].textContent, osc.title],
    ['cv-tile cv-ptile', 'rigmods', ['cv-mglyph', 'cv-tname', 'cv-treason'], 'Oscillator', RIG_TIP('Oscillator')]);
  // glyphs: one original each; the Envelope's and the LFO's are not the Modulators' ENV / LFO (both rows show in this view)
  const G = Object.fromEntries(R.S.partTiles().map(b => [b.getAttribute('data-part'), b.children[0].innerHTML]));
  assert.equal(new Set(Object.values(G)).size, 7, 'one original glyph each');
  assert.ok(Object.values(G).every(g => /<svg /.test(g) && !/<text|<image|href/.test(g)));
  assert.match(G.env, /<path d="M4 24.5h32"\/>/, 'the Envelope: an ADSR trace on a baseline');
  assert.equal((G.env.match(/<rect /g) || []).length + (G.lfo.match(/<rect /g) || []).length, 3 + 3, 'with the editor\'s handles (three each)');
  osc.click(); R.S.setMode('track'); R.S.partTile('lfo').click();
  assert.deepEqual([picks, R.picks], [['part osc:replace', 'part lfo:track'], []], 'partPick, not the synth pick');
  // a drag onto the canvas: info.part, the world point
  const f = R.S.partTile('filter'), tp = { pointerType: 'touch' };
  ptr(f, 'pointerdown', 100, 300, at(tp)); ptr(f, 'pointermove', 112, 302, at(tp)); ptr(f, 'pointermove', 400, 300, at(tp));
  assert.equal(R.layer.children[0].children[1].textContent, '+ Add Filter');
  TS += 150;
  ptr(f, 'pointermove', 402, 301, at(tp)); ptr(f, 'pointerup', 402, 301, at(tp));
  assert.deepEqual(log, ['begin filter part', 'drop filter canvas part @804,201']);
  // (integration fixer L, review WC-int B4) onto the track list: "+ New track", the drop's info.over 'tracks' (the host makes a new track with it)
  log.length = 0;
  ptr(f, 'pointerdown', 100, 300, at(tp)); ptr(f, 'pointermove', 120, 300, at(tp)); ptr(f, 'pointermove', 200, 50, at(tp));
  assert.equal(R.layer.children[0].children[1].textContent, '+ New track');
  TS += 150;
  ptr(f, 'pointermove', 201, 50, at(tp)); ptr(f, 'pointerup', 201, 50, at(tp));
  assert.deepEqual(log, ['begin filter part', 'drop filter tracks part @402,-50'], 'the track list: a new track (the host\'s)');
  // setPartPlaced: greyed with the host's reason (rigFull's texts), no pick; ARP / CLIP: no tile, nothing to grey
  assert.deepEqual(['osc', 'sub', 'noise', 'filter', 'env', 'lfo', 'macros', 'arp', 'clip', 'nope'].map(T.rigFull), [`This ${RIG.NAME} already has 3 oscillators`, 'Sub oscillator is on the canvas',
    'Noise is on the canvas', `This ${RIG.NAME} already has 2 filters`, `This ${RIG.NAME} already has 4 envelopes`, `This ${RIG.NAME} already has 10 LFOs`, 'Macros is on the canvas', 'Arpeggiator is on', 'Clip sequencer is on', null]);
  R.S.setPartPlaced('osc', T.rigFull('osc')); R.S.setPartPlaced('arp', T.rigFull('arp'));
  osc.click();
  assert.deepEqual([osc.classList.contains('cv-placed'), osc.getAttribute('aria-disabled'), osc.children[2].textContent, R.S.partPlaced('osc'), osc.title, picks.length, R.S.partPlaced('arp')],
    [true, 'true', T.rigFull('osc'), T.rigFull('osc'), 'Oscillator — ' + T.rigFull('osc'), 2, null]);
  R.S.setPartPlaced('osc', null);
  assert.deepEqual([osc.classList.contains('cv-placed'), R.S.partPlaced('osc'), osc.title], [false, null, RIG_TIP('Oscillator')]);
  R.S.destroy();
  assert.deepEqual([pe.children.length + ne.children.length, kids(ps), kids(ns), ns.classList.contains('cv-tsoon'), ne.hidden], [0, ['DIV'], ['DIV'], false, false], 'destroy takes the tiles and what it put in the host\'s sections');
  // the Envelope's and the LFO's glyphs are not the Modulators' ENV / LFO (both rows show in this view)
  const M2 = modRig({ mods: T.MOD_TILES, view: 'rig' });
  assert.ok(G.env !== M2.S.modTile('env').children[0].innerHTML && G.lfo !== M2.S.modTile('lfo').children[0].innerHTML, 'not the Modulators\' glyphs');
  M2.S.destroy();
  // in o.secEl when the host gives no elements: the modules' section with its seven tiles, Note tools a placeholder; without o.parts: both placeholders
  const d = fresh(), list = d.createElement('div'), sec = d.createElement('div');
  const S2 = T.sourcesTray(list, { models: MODELS.slice(0, 1), pick() {}, drag: {}, secEl: sec, parts: true, view: 'rig' });
  assert.deepEqual(sec.children.map(s => s.getAttribute('data-sec') + ':' + s.className + ':' + s.children.map(c => (c.tagName === 'DIV' ? c.children.length : c.textContent)).join('/')),
    ['rigmods:cv-tsec cv-psec:' + RIG.NAME + ' modules/7', 'rignotes:cv-tsec cv-tsoon:Note tools/' + RIG_SOON]);
  S2.setView('flow');
  assert.deepEqual(sec.children.map(s => s.hidden), [true, true]);
  S2.destroy();
  const sec3 = d.createElement('div'), S3 = T.sourcesTray(d.createElement('div'), { models: MODELS.slice(0, 1), pick() {}, drag: {}, secEl: sec3, view: 'rig' });
  assert.deepEqual(sec3.children.map(s => s.getAttribute('data-sec') + ':' + s.className), ['rigmods:cv-tsec cv-tsoon', 'rignotes:cv-tsec cv-tsoon'], 'the placeholders');
  assert.equal(S3.partTiles().length, 0);
  S3.destroy();
});

test('index.html / style.css (WC, milestone 3): the rig view\'s module and Note tools sections right after the synths (hidden until a view lists them; no heading or name in the markup: the tray writes them from RIG.NAME); the CSS of the part modules, the internal cables, stubs, forks, hidden ends, inline jacks, the H6 hook', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<div id="srcList" class="cv-tiles"><\/div>\s*<!--[^>]*-->\s*<section id="srcPartSec" class="cv-tsec cv-psec" hidden>\s*<div id="srcParts" class="cv-tiles cv-ptiles" data-tray="parts"><\/div>\s*<\/section>\s*<section id="srcNoteSec" class="cv-tsec cv-psec" hidden>\s*<div id="srcNotes" class="cv-tiles cv-ptiles" data-tray="notes"><\/div>\s*<\/section>\s*<section id="srcModSec"/);
  for (const id of ['srcPartSec', 'srcParts', 'srcNoteSec', 'srcNotes']) assert.equal((html.match(new RegExp('\\sid="' + id + '"', 'g')) || []).length, 1, id);
  assert.ok(!/Serum parts/.test(html), 'the Serum parts heading went');
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
  assert.deepEqual(V, ['hw', 'flow', 'serum', 'rig', 'drums', 'ctl', 'moog']); // ((9) the Moog modules view after it; (WC) the rig view after Serum)
  const ctl = T.SRC_VIEWS[5];
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

test('sourcesTray (9, 9b): the Moog modules view — SRC_VIEWS\'s seventh ((WC) the rig view before it; tip, note, layout hw); the Model 15 tile (the m900 model tile: no maker word, no SIMPLE badge) first; then a row of its own in secEl: (9b) five groups (Sources · Modifiers · Control · Sequencing · Console & routing), (9c) a sixth, 1960s, the 35 module tiles in the family\'s order, each an original glyph (a panel outline, a dot per knob, a ring per jack — rear terminals never —, 9b: a cap per event button, a disc per lamp; no text), its name, its load; shown only there; Hardware / Simple: the twelve classics (classicOf); a tap picks in the tray\'s mode (moogPick, else pick); the view remembered', () => {
  const V = T.SRC_VIEWS.find(v => v.id === 'moog');
  assert.deepEqual([T.SRC_VIEWS.map(v => v.id).indexOf('moog'), V.label, V.tip, V.layout, V.sections.map(s => s.id), V.note],
    [6, 'Moog modules', 'The 900-series modules, patched with cords', 'hw', ['m15', 'moog'],
      'Model 15, System 35, System 55 and System IIIc bring a whole set, patched. Drop a module onto a 900 Series track to add it. The Moog Modular (a fixed patch) stays in Hardware.']);
  assert.deepEqual(MODELS.filter(m => V.sections[0].models(m)).map(m => m.id), ['m900'], 'the m15 section: the 900 Series model tile only');
  assert.deepEqual(T.MOOG_TILES.map(t => [t.id, t.name, t.group]), [['921', '921 Oscillator', 'src'], ['921a', '921A Driver', 'src'], ['921b', '921B Oscillator', 'src'],
    ['923', '923 Noise', 'src'], ['903a', '903A Random signal', 'src'], ['904a', '904A Low-pass', 'mod'], ['904b', '904B High-pass', 'mod'], ['907a', '907A Filter bank', 'mod'],
    ['914', '914 Filter bank', 'mod'], ['902', '902 Amplifier', 'mod'], ['911', '911 Envelope', 'ctl'], ['911a', '911A Trigger delay', 'ctl'], ['995', '995 Attenuators', 'ctl'],
    ['994', '994 Multiples', 'ctl'], ['960', '960 Sequencer', 'seq'], ['961', '961 Interface', 'seq'], ['962', '962 Switch', 'seq'], ['clk', 'Song clock', 'seq'],
    ['cp2', 'CP2 Filters', 'cp'], ['cp3a', 'CP3A Mixer', 'cp'], ['cp4a', 'CP4A Routing', 'cp'], ['cp35', 'CP35 Attenuators', 'cp'], ['cp8a', 'CP8A Power', 'cp'],
    ['992', '992 Control voltages', 'cp'], ['993', '993 Trigger routing', 'cp'],
    // (9c, IMPL-9c §1.8) the 1960s: the ten, in §1.0's order
    ['901', '901 Oscillator', 's60'], ['901a', '901A Controller', 's60'], ['901b', '901B Oscillator', 's60'], ['901c', '901C Output stage', 's60'], ['904c', '904C Coupler', 's60'],
    ['905', '905 Reverb', 's60'], ['912', '912 Follower', 's60'], ['984', '984 Matrix mixer', 's60'], ['991', '991 Filter', 's60'], ['cp3', 'CP3 Mixer', 's60']]);
  assert.deepEqual([T.MOOG_TILES.length, Object.values(T.MOOG_GROUPS)], [35, ['Sources', 'Modifiers', 'Control', 'Sequencing', 'Console & routing', '1960s']]);
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
    '#Sequencing', '960', '961', '962', 'clk', '#Console & routing', 'cp2', 'cp3a', 'cp4a', 'cp35', 'cp8a', '992', '993',
    '#1960s', '901', '901a', '901b', '901c', '904c', '905', '912', '984', '991', 'cp3'];
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
  assert.deepEqual(l.children.map(n => n.hidden), [false, ...Array(ROW.length).fill(true)], 'Hardware: the row hidden');
  S3.setView('moog');
  assert.deepEqual(l.children.map(n => n.hidden), [true, ...Array(ROW.length).fill(false)]);
  S3.destroy();
  const l4 = d.createElement('div'), S4 = T.sourcesTray(l4, { models: MODELS, pick() {}, drag: {}, view: 'moog' });
  assert.deepEqual([S4.view(), S4.moogTiles().length, S4.tiles().filter(b => !b.hidden).map(b => b.getAttribute('data-model'))], ['moog', 0, ['m900']], 'a stored "moog" opens it; no row without o.moog');
  S4.destroy();
});

test('sourcesTray (9c fix, review 2 F1): each 1960s glyph is its face in miniature — the knobs (k) and jacks (j) in reading order (rows within 2 % of the panel\'s height, then by x) as panels/m900c.js lays them out', () => {
  // the face's controls (a jack / socket = j, anything else live = k; inert trunks skipped) and the glyph's marks, each placed in its
  // panel's own outline (so a console-height panel reads like a tall one), rows clustered on the first mark's y
  const seq = pts => {
    const rows = [];
    for (const p of pts.slice().sort((a, b) => a.y - b.y)) { const r = rows.find(q => Math.abs(q.y - p.y) <= 0.02); if (r) r.p.push(p); else rows.push({ y: p.y, p: [p] }); }
    return rows.map(r => r.p.sort((a, b) => a.x - b.x).map(p => p.k).join('')).join('|');
  };
  const num = (s, n) => { const q = new RegExp(' ' + n + '="([-\\d.]+)"').exec(s); return q ? +q[1] : 0; };
  const bad = [];
  for (const ty of ['901', '901a', '901b', '901c', '904c', '905', '912', '984', '991', 'cp3']) {
    const lay = MODULE_LAYOUTS[ty], g = T.MOOG_GLYPH[ty], [, , W, H] = lay.areas[0].src;
    const face = lay.controls.filter(c => c.kind && c.x != null && !c.inert).map(c => ({ x: c.x / W, y: c.y / H, k: /jack|strig/.test(c.kind) ? 'j' : 'k' }));
    const o = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="1.5"\/>/.exec(g).slice(1).map(Number);
    const marks = [];
    for (const m of g.matchAll(/<(circle|rect)[^>]*class="(k|j)"[^>]*>/g)) {
      const x = m[1] === 'circle' ? num(m[0], 'cx') : num(m[0], 'x') + num(m[0], 'width') / 2, y = m[1] === 'circle' ? num(m[0], 'cy') : num(m[0], 'y') + num(m[0], 'height') / 2;
      marks.push({ x: (x - o[0]) / o[2], y: (y - o[1]) / o[3], k: m[2] });
    }
    if (seq(marks) !== seq(face)) bad.push(ty + ': face ' + seq(face) + ' / glyph ' + seq(marks));
    if (!marks.every(p => p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1)) bad.push(ty + ': a mark outside the outline');
  }
  assert.deepEqual(bad, [], 'every glyph reads like its face');
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
  const R4 = moogRig({ moogCost: () => cost }), p = R4.S.moogTile('902'), why = `A patch holds at most ${PT.MAX_MODS} modules`;
  R4.S.setMoogPlaced(why);
  assert.deepEqual(R4.S.moogTiles().map(b => b.classList.contains('cv-placed') && b.getAttribute('aria-disabled')), Array(T.MOOG_TILES.length).fill('true'));
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
  assert.deepEqual(T.SET_TILES.map(x => [x.id, x.name, x.modules, x.starter]), [['s35', 'System 35', 22, 'Swept band'], ['s55', 'System 55', 37, 'Sequence'], ['s3c', 'System IIIc', 36, 'Drift choir']]);
  assert.ok(Object.isFrozen(T.SET_TILES) && T.SET_TILES.every(Object.isFrozen));
  assert.deepEqual(T.SET_TILES.map(x => cvArt.SET_ART[x.id].modules), [22, 37, 36], 'the art\'s count is the set\'s');
  const MX = PT.MAX_MODS;                                                  // (IMPL-P: the default is the patch's bound, 512 — was 48)
  assert.equal(MX, 512);
  assert.deepEqual([T.setFull(MX - 37, 27), T.setFull(MX - 27, 27), T.setFull(MX - 26, 27), T.setFull(MX - 8, 27), T.setFull(MX, 0), T.setFull(30, -1)],
    [null, null, 'This set needs 1 more module than the patch can hold', 'This set needs 19 more modules than the patch can hold', null, null]);
  const sp = [], sd = [];
  let cost = { s35: '~3 %', s55: '~6 %' };
  const R = moogRig({ sets: T.SET_TILES, setPick: (id, m) => sp.push(id + ':' + m), setCanvasGhost: () => false, canvasGhost: () => false, setCost: id => cost[id] || '',
    setDrag: { begin: (id, i) => sd.push('begin ' + id + (i.set ? ' set' : '')), move: (id, i) => sd.push('move ' + i.over), drop: (id, i) => { sd.push('drop ' + id + ' ' + i.over + (i.set ? ' set' : '') + ' @' + i.at.x + ',' + i.at.y); return true; }, cancel: id => sd.push('cancel ' + id) } });
  const ids = R.list.children.map(n => n.getAttribute('data-model') || n.getAttribute('data-set'));
  assert.deepEqual(ids.slice(ids.indexOf('m900'), ids.indexOf('m900') + 4), ['m900', 's35', 's55', 's3c'], 'beside the Model 15 tile'); // ((WC) the rig tile follows: no longer the list's end
  assert.deepEqual([R.S.tiles().length, R.S.tiles().some(b => b.getAttribute('data-set')), R.S.setTiles().length], [MODELS.length, false, 3], 'not model tiles');
  const b = R.S.setTile('s35'), b5 = R.S.setTile('s55'), b3 = R.S.setTile('s3c');
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
  // (9c) the System IIIc: its art, "System IIIc" over "36 modules", the starter in its title, no maker word
  assert.deepEqual([b3.tagName, b3.className, b3.children[0].innerHTML === cvArt.setArt('s3c', cvArt.TILE), b3.children[1].textContent, b3.children[2].textContent, b3.getAttribute('aria-label'), b3.children[3].textContent],
    ['BUTTON', 'cv-tile cv-stile', true, 'System IIIc', '36 modules', 'System IIIc · 36 modules', '']);
  assert.ok(/the whole set, patched as Drift choir/.test(b3.title) && !/moog|R\.A\./i.test(b3.title + b3.textContent), b3.title);
  assert.ok(/the whole set, patched as Sequence/.test(b5.title) && !/moog|R\.A\./i.test(b5.title + b5.textContent + b.title), b5.title);
  // only in the Moog view
  const vis = () => [b.hidden, b5.hidden, b3.hidden].join();
  assert.equal(vis(), 'false,false,false');
  for (const v of ['hw', 'flow', 'serum', 'drums', 'ctl']) { R.S.setView(v); assert.equal(vis(), 'true,true,true', v); }
  R.S.setView('moog');
  // a tap: setPick in the tray's mode, never the model pick
  b.click(); R.S.setMode('track'); b5.click(); R.S.setMode('replace'); b3.click();
  assert.deepEqual([sp, R.picks], [['s35:replace', 's55:track', 's3c:replace'], []]);
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
  const why = T.setFull(PT.MAX_MODS - 8, MG.S55.length - 12);
  R.S.setSetPlaced('s55', why);
  assert.deepEqual([b5.classList.contains('cv-placed'), b5.getAttribute('aria-disabled'), b5.children[4].hidden, b5.children[4].textContent, b5.title, b5.getAttribute('aria-label'), R.S.setPlacedOf('s55'), R.S.setPlacedOf('s35')],
    [true, 'true', false, why, 'System 55 · 37 modules — ' + why, 'System 55 · 37 modules — ' + why, why, null]);
  const n0 = sd.length;
  b5.click();
  ptr(b5, 'pointerdown', 100, 300, at(tp)); ptr(b5, 'pointermove', 112, 302, at(tp)); ptr(b5, 'pointermove', 400, 300, at(tp));
  TS += 150;
  ptr(b5, 'pointermove', 402, 301, at(tp)); ptr(b5, 'pointerup', 402, 301, at(tp));
  assert.deepEqual([sp.length, sd.length - n0, R.layer.children.length], [3, 0, 0], 'no pick, no drag');
  R.S.setSetPlaced('s55', null);
  b5.click();
  assert.deepEqual([b5.classList.contains('cv-placed'), b5.hasAttribute('aria-disabled'), b5.children[4].hidden, b5.getAttribute('aria-label'), sp.at(-1)], [false, false, true, 'System 55 · 37 modules', 's55:replace']);
  R.S.destroy();
  assert.equal(R.list.children.some(n => n.getAttribute('data-set')), false, 'destroy takes them');
  // o.sets: true, in their own box (o.setsEl); without o.sets none; no setPick: a tap does nothing
  const d = fresh(), l = d.createElement('div'), box = d.createElement('div');
  const S2 = T.sourcesTray(l, { models: MODELS, sets: true, setsEl: box, pick: id => { throw new Error('model pick ' + id); }, drag: {}, view: 'moog' });
  assert.deepEqual([box.children.map(n => n.getAttribute('data-set')), l.children.some(n => n.getAttribute('data-set'))], [['s35', 's55', 's3c'], false]);
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

/* ---------------------------------------------------------------- (WC, IMPL-WC §3.2, §5; lane U) the rig's chrome and skins in style.css */
// WCAG relative luminance and contrast of two #rrggbb colours
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// a skin block's custom properties (IMPL-WC §5.1: the kit's --sx-* tokens, the module chrome's --text / --mute, the faces' own --rig-*); nothing else
const SKIN_VARS = ['--sx-bg', '--sx-panel', '--sx-panel2', '--sx-line', '--sx-graph', '--sx-ink', '--sx-mute', '--sx-accent', '--sx-neg', '--text', '--mute',
  '--rig-case', '--rig-face', '--rig-bar', '--rig-title', '--rig-line', '--rig-font', '--rig-screen', '--rig-jack-ring', '--rig-jack-nut', '--rig-jack-hole', '--rig-screw', '--rig-screw-lo'];
test('style.css (WC, IMPL-WC §5): the rig chrome — case, bar, the title in the face font, the face, the kit labels\' font, four corner screws in one pseudo-element, the jack look — colours only through custom properties; lane C\'s marked place; the skins last: one block per SKINS id, colour and font custom properties only, charcoal the cord lab\'s, contrast ≥ 4.5 : 1', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8'), plain = css.replace(/\/\*[\s\S]*?\*\//g, c => ' '.repeat(c.length)); // (comments blanked, offsets kept)
  const rules = [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim(), at: m.index }));
  const decls = body => body.split(/;(?![^(]*\))/).map(s => s.trim()).filter(Boolean).map(s => [s.slice(0, s.indexOf(':')).trim(), s.slice(s.indexOf(':') + 1).trim()]);
  // the skins: one block per SKINS id, the three scopes (the module — its bar inherits —, .sx-root where the kit declares its tokens, .rig-face), last in the file
  const skins = rules.filter(r => r.sel.includes('[data-cv-skin='));
  // ((the FX look, 2026-10-26: moved by design) every FX module and its rack's root — where the kit declares its tokens — wear the skin too)
  assert.deepEqual(skins.map(r => r.sel), SKINS.map(S => [' .cv-mod[data-cv-rig]', ' .cv-mod[data-cv-rig] .sx-root', ' .cv-mod[data-cv-rig] .rig-face', ' .cv-mod[data-cv-fx]', ' .cv-mod[data-cv-fx] .fxr-root'].map(x => `#world[data-cv-skin="${S.id}"]` + x).concat(`.rig-drawer[data-cv-skin="${S.id}"]`, `.cv-jn[data-cv-skin="${S.id}"]`, `.wk-ctx[data-cv-skin="${S.id}"]`, `.wk-pop[data-cv-skin="${S.id}"]`).join(', ')), '(WC, lane F → H) the ⚙ drawer in the top layer carries the skin itself; (the user, 2026-10-26) a stacked jack\'s count in the cord layer\'s top too');
  assert.equal(SKIN_DEFAULT, 'charcoal');
  assert.ok(skins.every(r => rules.every(q => q === r || skins.includes(q) || q.at < r.at)), 'the skin blocks are the last rules of the file');
  const V = {};
  for (const [i, r] of skins.entries()) {
    const D = decls(r.body), S = SKINS[i], v = Object.fromEntries(D);
    assert.deepEqual(D.map(d => d[0]), SKIN_VARS, S.id + ': every skin variable, in order, and nothing else (no number, no other property: a switch changes no box)');
    for (const [k, x] of D) assert.ok(k === '--rig-font' || /^#[0-9a-f]{6}$/.test(x), S.id + ' ' + k + ': a colour (' + x + ')');
    assert.equal(v['--rig-font'], S.font === 'narrow' ? '\'Archivo Narrow\', Inter, var(--ui)' : 'Inter, var(--ui)', S.id + ': the face font (Inter its fallback)');
    // contrast (G11): text on its ground ≥ 4.5 : 1 (labels and values on the face, the title and the bar's text on the bar, menu text on a button), UI parts ≥ 3 : 1
    for (const [fg, bg] of [['--sx-ink', '--rig-face'], ['--sx-mute', '--rig-face'], ['--sx-ink', '--sx-bg'], ['--sx-mute', '--sx-panel'], ['--rig-title', '--rig-bar'], ['--text', '--rig-bar'], ['--mute', '--rig-bar'], ['--sx-ink', '--sx-panel2'], ['--sx-accent', '--rig-face']])
      assert.ok(contrast(v[fg], v[bg]) >= 4.5, `${S.id}: ${fg} on ${bg} ${contrast(v[fg], v[bg]).toFixed(2)} : 1`);
    for (const [fg, bg] of [['--rig-jack-ring', '--rig-face'], ['--sx-graph', '--sx-line'], ['--sx-ink', '--sx-panel2'], ['--sx-neg', '--rig-face'], ['--rig-screw', '--rig-face'], ['--rig-line', '--rig-case']])
      assert.ok(contrast(v[fg], v[bg]) >= (fg === '--rig-screw' || fg === '--rig-line' ? 1.2 : 3), `${S.id}: ${fg} against ${bg} ${contrast(v[fg], v[bg]).toFixed(2)} : 1`);
    V[S.id] = v;
  }
  // charcoal = the cord lab's colours (docs/canvas/ref/cord-lab.html :root), the contract's knob, jack, screw and screen values (§5.2)
  const lab = Object.fromEntries([...readFileSync(new URL('../docs/canvas/ref/cord-lab.html', import.meta.url), 'utf8').matchAll(/(--[a-z-]+): (#[0-9a-f]{6});/g)].map(m => [m[1], m[2]]));
  const C = V.charcoal;
  assert.deepEqual([C['--rig-face'], C['--sx-bg'], C['--sx-panel'], C['--rig-bar'], C['--rig-case'], C['--rig-line'], C['--sx-line'], C['--sx-ink'], C['--rig-title'], C['--text'], C['--sx-mute'], C['--mute'], C['--sx-accent']],
    [lab['--panel'], lab['--panel'], lab['--panel'], lab['--panel'], lab['--rack'], lab['--line'], lab['--line'], lab['--ink'], lab['--ink'], lab['--ink'], lab['--muted'], lab['--muted'], lab['--accent']]);
  assert.deepEqual([lab['--panel'], lab['--rack'], lab['--line'], lab['--ink'], lab['--muted'], lab['--accent']], ['#1f2023', '#17181a', '#2c2e32', '#ebe6d8', '#9c978a', '#e8a33d']);
  assert.deepEqual([C['--sx-panel2'], C['--sx-graph'], C['--rig-screen'], C['--rig-jack-ring'], C['--rig-jack-nut'], C['--rig-jack-hole'], C['--rig-screw'], C['--rig-screw-lo'], C['--sx-neg']],
    ['#141518', '#ebe6d8', '#141518', '#ebe6d8', '#7d7a72', '#0b0b0c', '#9c978a', '#55524a', '#ec6a4c'], 'black knob caps with cream pointers and arcs; cream-ringed jacks; warm grey screws');
  // the chrome: every [data-cv-rig] rule outside the skins, colours only through custom properties (a #hex only as a var() fallback: the plain module's
  // look without a skin), declaring no skin variable (only its own gradient helpers, --rig-*-g)
  const chrome = rules.filter(r => r.sel.includes('[data-cv-rig]') && !skins.includes(r));
  assert.deepEqual(chrome.map(r => r.sel), ['.cv-mod[data-cv-rig]', '.cv-mod[data-cv-rig] > .cv-bar', '.cv-mod[data-cv-rig][data-cv-fold] > .cv-bar', '.cv-mod[data-cv-rig] .cv-title', '.cv-mod[data-cv-rig] > .cv-body',
    '.cv-mod[data-cv-rig] .rig-face', '.cv-mod[data-cv-rig] .rig-face .wk-knob, .cv-mod[data-cv-rig] .rig-face .wk-menu > .wk-lab', '.cv-mod[data-cv-rig] .rig-face .wk-knob .wk-lab', '.cv-mod[data-cv-rig] > .cv-body::after, .cv-mod[data-cv-fx] .fxr-face::after',
    '.cv-mod[data-cv-rig] .cv-fjack', '#world[data-cv-patching] .cv-mod[data-cv-rig] .cv-fjack.cv-no']);
  for (const r of chrome) {
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(r.body.replace(/var\(--[a-z0-9-]+, #[0-9a-f]{6}\)/g, '')), r.sel + ': colours through the skin\'s variables');
    assert.ok(decls(r.body).every(([k]) => !k.startsWith('--') || /^--rig-[a-z]+-g$/.test(k)), r.sel + ': no skin variable set here');
  }
  const body = s => chrome.find(r => r.sel === s).body;
  assert.match(body('.cv-mod[data-cv-rig] .cv-title'), /^color: var\(--rig-title, var\(--text\)\); font: 600 13px\/1\.2 var\(--rig-font, var\(--ui\)\); letter-spacing: 0\.06em;?$/, 'the bar title: the face font, 600, 0.06 em (uppercase: the bar\'s own), 13 px (§3.8\'s least)');
  assert.match(body('.cv-mod[data-cv-rig] .rig-face .wk-knob, .cv-mod[data-cv-rig] .rig-face .wk-menu > .wk-lab'), /^font-family: var\(--rig-font, var\(--ui\)\);?$/, 'the knob and menu labels in the face font (values keep the mono)');
  // the screws: one pseudo-element (no DOM), never a press — its four images (head and slot in one SVG each) are the next test's pins
  // ((the FX look, 2026-10-26; moved by design) one rule for a rig module's body and every effect's face: their screws cannot drift)
  const sc = body('.cv-mod[data-cv-rig] > .cv-body::after, .cv-mod[data-cv-fx] .fxr-face::after');
  assert.match(sc, /content: ''; position: absolute; inset: 0; z-index: 2; pointer-events: none;/);
  // the jack: a cream ring round a nut and its hole inside the 28 px jack (≤ 14 px radius); dimmed, not blacked out, while a cord cannot take it
  const jk = body('.cv-mod[data-cv-rig] .cv-fjack');
  assert.match(jk, /--rig-jack-g: radial-gradient\(circle, var\(--rig-jack-hole, #[0-9a-f]{6}\) 0 5\.5px, var\(--rig-jack-nut, #[0-9a-f]{6}\) 6px 8\.75px, var\(--rig-jack-ring, #[0-9a-f]{6}\) 9\.25px 13\.25px, transparent 13\.75px\); background: var\(--rig-jack-g\);?$/);
  assert.match(body('#world[data-cv-patching] .cv-mod[data-cv-rig] .cv-fjack.cv-no'), /^background: var\(--rig-jack-g\); opacity: 0\.4;?$/);
  // lane C's marked place, between the chrome and the skins
  const C0 = css.indexOf('(WC, lane C)'), K0 = css.indexOf('#world[data-cv-skin="charcoal"]');
  assert.ok(C0 > chrome[chrome.length - 1].at && C0 < K0, 'lane C\'s block goes between the chrome and the skins');
  assert.ok(!css.includes(RIG.NAME), 'the name is the constant\'s (G4)');
  // (the FX look, 2026-10-26) the FX modules' chrome: the case, the bar, the title in the face font, the body and its rack's ground, every
  // effect's face with the rig's four screws — colours only through the skin's variables, no skin variable set, before the skins
  const fxc = rules.filter(r => r.sel.includes('[data-cv-fx]') && !skins.includes(r));
  assert.deepEqual(fxc.map(r => r.sel), ['.cv-mod[data-cv-rig] > .cv-body::after, .cv-mod[data-cv-fx] .fxr-face::after', '.cv-mod[data-cv-fx]', '.cv-mod[data-cv-fx] > .cv-bar', '.cv-mod[data-cv-fx][data-cv-fold] > .cv-bar', '.cv-mod[data-cv-fx] .cv-title',
    '.cv-mod[data-cv-fx] > .cv-body, .cv-mod[data-cv-fx] .cv-body > .fxtab']);
  for (const r of fxc) {
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(r.body.replace(/var\(--[a-z0-9-]+, #[0-9a-f]{6}\)/g, '')), r.sel + ': colours through the skin\'s variables');
    assert.ok(decls(r.body).every(([k]) => !k.startsWith('--') || /^--rig-[a-z]+-g$/.test(k)), r.sel + ': no skin variable set here');
    assert.ok(r.at < K0, r.sel + ': before the skins');
  }
  assert.equal(body('.cv-mod[data-cv-rig] .cv-title'), fxc.find(r => r.sel === '.cv-mod[data-cv-fx] .cv-title').body, 'the FX module\'s title as a rig module\'s');
  // an effect's face: the rig's screws — the very rule (the SVG screw of ffb64fd, its slot centred at every display scale), never a copy
  assert.equal(fxc[0], chrome.find(r => r.sel.startsWith('.cv-mod[data-cv-rig] > .cv-body::after')), 'an effect\'s face: the rig\'s screws, the same rule');
  assert.equal(rules.filter(r => r.sel.includes('fxr-face') && r.sel.includes('::after')).length, 1, 'no other rule draws a face\'s screws');
});

// (WC, the user 2026-10-26: "the slot in the center is off center" on Windows) Blink rounds each background layer to whole layout px on its
// own, and a radial and a linear gradient differently: the old radial head (8 px at 5 px) and linear slot (5 px at 6.5 px) parted by up to
// 0.5 layout px at a DPR of 1, 1.5 or 1.75 (2.6 device px under the camera's 3× zoom; DPR 2 hid it). A screw is now ONE SVG — head and slot
// in one coordinate space, so a tile's rounding moves both — the old look drawn in it: the head's stops, the slot's hexagon, the skin's colours.
test('style.css (WC, the user 2026-10-26): each corner screw is one SVG image — head and slot in one coordinate space, the slot point-symmetric about the head\'s centre; four 8 px tiles at 5 px, whole CSS px; no layered slot gradient; the image\'s colours are every skin\'s --rig-screw / --rig-screw-lo / --rig-jack-hole', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8'), plain = css.replace(/\/\*[\s\S]*?\*\//g, c => ' '.repeat(c.length));
  const rules = [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim() }));
  const decls = body => body.split(/;(?![^(]*\))/).map(s => s.trim()).filter(Boolean).map(s => [s.slice(0, s.indexOf(':')).trim(), s.slice(s.indexOf(':') + 1).trim()]);
  const sc = rules.filter(r => r.sel.split(',').map(x => x.trim()).includes('.cv-mod[data-cv-rig] > .cv-body::after'));
  assert.equal(sc.length, 1, 'one rule, one pseudo-element');
  // ((the FX look, 2026-10-26; moved by design) every effect's face shares this rule: the FX faces get the same SVG screws)
  assert.deepEqual(sc[0].sel.split(',').map(x => x.trim()), ['.cv-mod[data-cv-rig] > .cv-body::after', '.cv-mod[data-cv-fx] .fxr-face::after']);
  const D = Object.fromEntries(decls(sc[0].body));
  assert.deepEqual(Object.keys(D), ['content', 'position', 'inset', 'z-index', 'pointer-events', '--rig-screw-g', 'background'], 'one image helper, nothing else declared');
  // four layers, one per corner: the same image in an 8 px tile at 5 px from that corner (whole CSS px — no half-px offset to round)
  const layers = D.background.split(/,(?![^(]*\))/).map(s => s.trim());
  assert.deepEqual(layers, ['left', 'right'].flatMap(x => ['top', 'bottom'].map(y => `var(--rig-screw-g) ${x} 5px ${y} 5px / 8px 8px no-repeat`)));
  // no layered slot: no gradient in the rule, no slot helper left anywhere in the file
  assert.ok(!/gradient\(/.test(sc[0].body), 'no CSS gradient layer in the screws\' rule');
  assert.ok(!css.includes('--rig-slot-g'), 'no slot layer helper');
  // the image: one data-URI SVG, its user unit the tile's CSS px (viewBox 0 0 8 8 in an 8 px tile)
  const m = /^url\("data:image\/svg\+xml,([^"]*)"\)$/.exec(D['--rig-screw-g']);
  assert.ok(m, 'the helper is one SVG data URI');
  assert.ok(!/[#<>"]/.test(m[1]), 'a portable data URI: < > # escaped');
  const svg = decodeURIComponent(m[1]);
  assert.match(svg, /^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg' viewBox='0 0 8 8'>[\s\S]*<\/svg>$/);
  assert.deepEqual([...svg.matchAll(/<([a-zA-Z]+)/g)].map(x => x[1]), ['svg', 'radialGradient', 'stop', 'stop', 'stop', 'stop', 'circle', 'path'], 'a head and a slot, nothing else');
  assert.ok(!/href|https?:\/\/(?!www\.w3\.org\/2000\/svg')/.test(svg), 'no external reference');
  const attrs = tag => Object.fromEntries([...(new RegExp(`<${tag}([^>]*)>`).exec(svg) || ['', ''])[1].matchAll(/([a-zA-Z-]+)='([^']*)'/g)].map(x => [x[1], x[2]]));
  // the head: a disc of radius 4 at (4, 4), its radial gradient centred there — the old stops (offset × 4 px): the screw colour to 1.5 px,
  // screw-lo at 3.3 px, black at 0.55 at 3.6 px, clear at 4 px
  assert.deepEqual(attrs('circle'), { cx: '4', cy: '4', r: '4', fill: 'url(#h)' });
  assert.deepEqual(attrs('radialGradient'), { id: 'h', cx: '4', cy: '4', r: '4', gradientUnits: 'userSpaceOnUse' });
  const stops = [...svg.matchAll(/<stop([^>]*)\/>/g)].map(x => Object.fromEntries([...x[1].matchAll(/([a-zA-Z-]+)='([^']*)'/g)].map(y => [y[1], y[2]])));
  assert.deepEqual(stops.map(s => +s.offset * 4), [1.5, 3.3, 3.6, 4]);
  assert.deepEqual(stops.map(s => [s['stop-color'] || 'black', s['stop-opacity'] || '1']), [[stops[0]['stop-color'], '1'], [stops[1]['stop-color'], '1'], ['black', '.55'], ['black', '0']]);
  // the slot: the old one's shape — the 45° band |x − y| ≤ 1.2 (24 % of the 5 px square's gradient line) cut by that square [1.5, 6.5]²,
  // a hexagon — and point-symmetric about (4, 4): its centre IS the head's centre, whatever a tile rounds to
  const P = attrs('path'), pts = [];
  let cur = [0, 0];
  for (const [, c, a] of P.d.matchAll(/([MLHVZ])([^MLHVZ]*)/g)) {
    const n = a.trim() ? a.trim().split(/[\s,]+/).map(Number) : [];
    if (c === 'Z') break;
    cur = c === 'H' ? [n[0], cur[1]] : c === 'V' ? [cur[0], n[0]] : [n[0], n[1]];
    pts.push(cur);
  }
  assert.deepEqual(pts, [[1.5, 1.5], [2.7, 1.5], [6.5, 5.3], [6.5, 6.5], [5.3, 6.5], [1.5, 2.7]]);
  const key = p => p.map(v => v.toFixed(6)).join(',');
  assert.deepEqual(pts.map(p => key([8 - p[0], 8 - p[1]])).sort(), pts.map(key).sort(), 'the slot is point-symmetric about the head\'s centre (4, 4)');
  for (const [x, y] of pts) assert.ok(x >= 1.5 && x <= 6.5 && y >= 1.5 && y <= 6.5 && Math.abs(x - y) <= 1.2 + 1e-9, `(${x}, ${y}) on the old slot`);
  // the colours: every skin's screw, screw-lo and jack hole (an image cannot read a custom property — a skin with other screws needs its own image)
  for (const S of SKINS) {
    const blk = rules.find(r => r.sel.startsWith(`#world[data-cv-skin="${S.id}"] `));
    assert.ok(blk, S.id + ': its block');
    const v = Object.fromEntries(decls(blk.body));
    assert.deepEqual([stops[0]['stop-color'], stops[1]['stop-color'], P.fill], [v['--rig-screw'], v['--rig-screw-lo'], v['--rig-jack-hole']], S.id + ': the screw image in the skin\'s colours');
  }
});

/* ---------------------------------------------------------------- (MM, IMPL-MM §7.3; lane U) the Sources tray on the master canvas */
// The master has no notes: its tray shows the Modulators section with the four tiles it takes (LFO, Macro, CC, Chaos) and a short note.
// setMaster(on) is the host's call (main.js srcModeUI: cvMaster && mode !== 'track'); the view the user chose is kept underneath.
const MASTER_NOTE_TXT = 'The master has no notes: its modulators are LFOs, Macros, CC and Chaos. Drop one on the canvas and cable its jack to any knob of the master rack.';
// the tray as main.js builds it (index.html's boxes: the view host, the sections of #srcScroll, #srcNote), every tile row on
function mastRig(o = {}) {
  const d = fresh();
  raf.install();
  const tray = mkEl(d, 'aside', 'srcTray'), host = d.createElement('div'), list = d.createElement('div'), scroll = d.createElement('div'), note = d.createElement('p'), layer = mkEl(d, 'div', 'ov');
  const sec = id => { const s = d.createElement('section'), b = d.createElement('div'); s.hidden = true; s.append(b); scroll.append(s); return { s, b, id }; };
  scroll.append(list);
  const parts = sec('parts'), notes = sec('notes'), mods = sec('mods'), ctls = sec('ctls');
  tray.append(host, scroll, note);
  place(tray, 0, 100, 284, 600);
  const log = [], picks = [];
  const S = T.sourcesTray(list, Object.assign({
    models: MODELS, tray, layer, pick: (id, mode) => picks.push(id + ':' + mode), layoutEl: host, secEl: scroll, noteEl: note, view: 'serum',
    mods: T.MOD_TILES, modsEl: mods.b, modsSec: mods.s, modPick: (id, mode) => picks.push('mod ' + id + ':' + mode),
    ctls: T.CTL_TILES, ctlsEl: ctls.b, ctlsSec: ctls.s, ctlPick: (id, mode) => picks.push('ctl ' + id + ':' + mode),
    parts: true, partsEl: parts.b, partsSec: parts.s, notesEl: notes.b, notesSec: notes.s, moog: T.MOOG_TILES, sets: T.SET_TILES,
    overOf: (t, x, y) => (y < 100 ? 'tracks' : x > 300 ? 'canvas' : null), canvasGhost: () => true, toWorld: (x, y) => ({ x: x * 2, y: y - 100 }),
    drag: {}, modDrag: {
      begin: (id, i) => log.push('begin ' + id + (i.mod ? ' mod' : '')), move() {},
      drop: (id, i) => { log.push('drop ' + id + ' ' + i.over + (i.mod ? ' mod' : '') + (i.at ? ' @' + i.at.x + ',' + i.at.y : '')); return !!i.over; }, cancel: id => log.push('cancel ' + id) },
  }, o));
  return { d, tray, host, list, scroll, note, layer, mods, ctls, parts, notes, S, log, picks };
}
const mnoteOf = R => R.mods.s.children.find(c => c.className === 'cv-tnote cv-mnote') || null;
// everything the tray shows, as one comparable value: the hidden flags of every tile row, section and heading, the view host and the note lines
function trayShape(R) {
  const S = R.S, h = bs => bs.map(b => (b.hidden ? 0 : 1)).join(''), mn = mnoteOf(R);
  return { models: h(S.tiles()), sets: h(S.setTiles()), moog: h(S.moogTiles()), mods: h(S.modTiles()), ctls: h(S.ctlTiles()), parts: h(S.partTiles()),
    secs: R.scroll.children.map(c => (c.hidden ? 0 : 1)).join(''), host: R.host.hidden ? 0 : 1, note: R.note.textContent, mnote: mn ? (mn.hidden ? 0 : 1) : -1 };
}
const modIds = S => S.modTiles().filter(b => !b.hidden).map(b => b.getAttribute('data-mod'));
const noneShown = s => !/1/.test(s);

test('sourcesTray (MM): the constants — MASTER_MODS (LFO, Macro, CC, Chaos: no envelope, no notes on the master), MASTER_NOTE, MASTER_SRC; every master tile is a multi tile of MOD_TILES', () => {
  assert.deepEqual([...T.MASTER_MODS], ['lfo', 'macro', 'cc', 'chaos']);
  assert.ok(Object.isFrozen(T.MASTER_MODS));
  assert.equal(T.MASTER_NOTE, MASTER_NOTE_TXT);
  assert.equal(T.MASTER_SRC, 'The master takes effects (the rack’s +) and modulators (Sources ▸ Modulators)');
  assert.ok(T.MASTER_MODS.every(id => { const m = T.MOD_TILES.find(x => x.id === id); return m && m.multi; }), 'multi tiles of the Modulators list');
});

test('sourcesTray (MM): setMaster(true) — the view menu is hidden, every model tile / section and the Controllers row are hidden, the Modulators section shows only LFO, Macro, CC, Chaos with the master\'s note; from every view; master() says so', () => {
  for (const view of ['hw', 'flow', 'serum', 'rig', 'drums', 'ctl', 'moog']) {
    const R = mastRig({ view });
    assert.deepEqual([R.S.master(), R.list.hasAttribute('data-master'), R.tray.classList.contains('cv-mside')], [false, false, false], view + ': off at the start');
    R.S.setMaster(true);
    const sh = trayShape(R);
    assert.deepEqual([R.S.master(), R.list.getAttribute('data-master'), R.tray.classList.contains('cv-mside'), R.S.view()], [true, '1', true, view], view + ': on; the chosen view kept underneath');
    assert.deepEqual([sh.models, sh.sets].map(noneShown), [true, true], view + ': no model or set tile shown (the rows in sections: the sections below)');
    assert.deepEqual([R.mods.s.hidden, R.ctls.s.hidden, R.parts.s.hidden, R.notes.s.hidden, R.host.hidden], [false, true, true, true, true], view + ': the Modulators section alone; the view menu\'s host hidden');
    assert.deepEqual(modIds(R.S), ['lfo', 'macro', 'cc', 'chaos'], view + ': four tiles, in the Modulators\' order');
    assert.deepEqual(R.scroll.children.filter(c => c !== R.list && c !== R.mods.s).map(c => c.hidden), R.scroll.children.filter(c => c !== R.list && c !== R.mods.s).map(() => true), view + ': every other section of the scroller hidden (Moog, placeholders, parts, Controllers)');
    assert.deepEqual([sh.mnote, R.note.textContent], [1, ''], view + ': the master\'s note shown, the view\'s own note cleared');
    const mn = mnoteOf(R);
    assert.deepEqual([mn.tagName, mn.textContent, R.mods.s.children.indexOf(mn) > R.mods.s.children.indexOf(R.mods.b)], ['P', MASTER_NOTE_TXT, true], view + ': the note under the tiles, in the section');
    R.S.destroy();
  }
});

test('sourcesTray (MM): setMaster(false) gives every view back exactly as it was (the hidden flags of tiles, sections, the view menu, the view\'s note); the Modulators\' other tiles are back in the Serum view; calling it twice changes nothing', () => {
  for (const view of ['hw', 'flow', 'serum', 'rig', 'drums', 'ctl', 'moog']) {
    const R = mastRig({ view }), before = trayShape(R);
    assert.equal(before.mnote, -1, view + ': no master note in the other canvases\' tray before the first visit (node for node as it was)');
    R.S.setMaster(true); R.S.setMaster(true);
    R.S.setMaster(false);
    assert.deepEqual(trayShape(R), Object.assign({}, before, { mnote: 0 }), view + ': as it was (the master\'s note made at the first visit, hidden now)');
    assert.deepEqual([R.S.master(), R.list.hasAttribute('data-master'), R.tray.classList.contains('cv-mside'), R.S.view(), R.list.getAttribute('data-view')], [false, false, false, view, view]);
    R.S.setMaster(false);
    assert.deepEqual(trayShape(R), Object.assign({}, before, { mnote: 0 }), view + ': off twice');
    R.S.destroy();
  }
  const R = mastRig({ view: 'serum' });
  assert.equal(modIds(R.S).length, 10, 'the Serum view: all ten tiles (their section shows)');
  R.S.setMaster(true);
  assert.equal(modIds(R.S).length, 4);
  R.S.setMaster(false);
  assert.deepEqual([modIds(R.S).length, R.mods.s.hidden], [10, false], 'ENV, Velocity, Aftertouch, Bend, Note, Mod Wheel are back');
  R.S.setView('hw');
  assert.equal(R.mods.s.hidden, true, 'Hardware: no Modulators (as before)');
  R.S.destroy();
});

test('sourcesTray (MM): while the master canvas shows, a view restore (setView — the stored pref, a menu pick) keeps the master state; leaving it shows the view that was set meanwhile', () => {
  const R = mastRig({ view: 'serum' });
  R.S.setMaster(true);
  R.S.setView('hw');
  const sh = trayShape(R);
  assert.deepEqual([R.S.view(), R.list.getAttribute('data-view'), noneShown(sh.models), modIds(R.S), R.mods.s.hidden, sh.mnote, R.host.hidden], ['hw', 'hw', true, ['lfo', 'macro', 'cc', 'chaos'], false, 1, true]);
  R.S.setView('ctl');
  assert.deepEqual([R.S.view(), R.ctls.s.hidden, R.mods.s.hidden, modIds(R.S).length], ['ctl', true, false, 4], 'the Controllers view underneath: its row stays hidden');
  R.S.setMaster(false);
  assert.deepEqual([R.S.view(), R.ctls.s.hidden, R.mods.s.hidden, R.host.hidden], ['ctl', false, true, false], 'the Controllers row is back, the Modulators gone');
  R.S.destroy();
});

test('sourcesTray (MM): the master\'s tiles work as the Modulators\' — a tap → modPick(id, mode); a drag onto the canvas → modDrag (info.mod, the world point, "+ Add Macro"); the other tiles stay hidden (no envelope, no performance source, no note source)', () => {
  const R = mastRig(), tp = { pointerType: 'touch' };
  R.S.setMaster(true);
  R.S.modTile('lfo').click();
  R.S.setMode('track');
  R.S.modTile('chaos').click();
  assert.deepEqual(R.picks, ['mod lfo:replace', 'mod chaos:track']);
  const t = R.S.modTile('macro');
  ptr(t, 'pointerdown', 100, 300, at(tp)); ptr(t, 'pointermove', 112, 302, at(tp)); ptr(t, 'pointermove', 400, 300, at(tp));
  assert.equal(R.layer.children[0].children[1].textContent, '+ Add Macro');
  TS += 150;
  ptr(t, 'pointermove', 402, 301, at(tp)); ptr(t, 'pointerup', 402, 301, at(tp));
  assert.deepEqual(R.log, ['begin macro mod', 'drop macro canvas mod @804,201']);
  assert.deepEqual(['env', 'wheel', 'velo', 'at', 'bend', 'note'].map(id => R.S.modTile(id).hidden), [true, true, true, true, true, true]);
  R.S.destroy();
});

test('sourcesTray (MM): o.masterMods / o.masterNote — a host list narrows the tiles (an unknown id is ignored; the Modulators\' order wins), its note replaces the default; an empty list hides the section and the note; no list / an empty note: the defaults', () => {
  const R = mastRig({ masterMods: ['chaos', 'lfo', 'nope'], masterNote: 'Only these.' });
  R.S.setMaster(true);
  const mn = mnoteOf(R);
  assert.deepEqual([modIds(R.S), mn.textContent, mn.hidden, R.mods.s.hidden], [['lfo', 'chaos'], 'Only these.', false, false]);
  R.S.destroy();
  const E = mastRig({ masterMods: [] });
  E.S.setMaster(true);
  assert.deepEqual([modIds(E.S), E.mods.s.hidden, (mnoteOf(E) || { hidden: true }).hidden], [[], true, true], 'nothing to offer: the section hidden, no note shown');
  E.S.destroy();
  const D2 = mastRig({ masterMods: undefined, masterNote: '' });
  D2.S.setMaster(true);
  assert.deepEqual([modIds(D2.S), mnoteOf(D2).textContent], [['lfo', 'macro', 'cc', 'chaos'], MASTER_NOTE_TXT]);
  D2.S.destroy();
});

test('sourcesTray (MM): an open view menu closes when the master canvas comes up; no o.mods (no Modulators in this tray): setMaster hides everything and throws nothing; destroy gives back what it changed (the view host shown, the tray\'s class, the data attribute, the note)', () => {
  const R = mastRig({ view: 'hw' }), btn = R.host.children[0];
  btn.click();
  assert.equal(R.S.viewOpen(), true);
  R.S.setMaster(true);
  assert.deepEqual([R.S.viewOpen(), R.host.hidden], [false, true], 'closed, then hidden');
  R.S.destroy();
  assert.deepEqual([R.host.hidden, R.tray.classList.contains('cv-mside'), R.list.hasAttribute('data-master'), R.mods.s.children.filter(c => c.className === 'cv-tnote cv-mnote').length], [false, false, false, 0], 'destroy: as it found it');
  const d = fresh(), list = d.createElement('div'), S2 = T.sourcesTray(list, { models: MODELS.slice(0, 3), pick() {}, drag: {} });
  S2.setMaster(true);
  assert.deepEqual([S2.master(), S2.tiles().filter(b => !b.hidden).length, list.children.length], [true, 0, 3], 'no Modulators: the synths hidden, nothing added');
  S2.setMaster(false);
  assert.equal(S2.tiles().filter(b => !b.hidden).length, 3);
  S2.destroy();
});

test('sourcesTray (MM): without a section element (a flat list) the heading "Modulators" and the four tiles show, the note follows the tiles, the rest is hidden; leaving restores the view\'s rule; the note goes with destroy', () => {
  const d = fresh(), list = d.createElement('div');
  d.body.append(list);
  const S = T.sourcesTray(list, { models: MODELS.slice(0, 2), mods: T.MOD_TILES, ctls: T.CTL_TILES, pick() {}, drag: {}, view: 'serum' });
  const names = () => list.children.map(n => (n.tagName === 'H3' ? '#' + n.textContent : n.tagName === 'P' ? 'p' : n.getAttribute('data-model') || n.getAttribute('data-mod') || n.getAttribute('data-ctl')) + (n.hidden ? '!' : ''));
  assert.equal(list.children.length, 2 + 1 + 10 + 1 + 1, 'before the first visit: the synths, the Modulators\' heading and ten tiles, the Controllers\' heading and tile — no note');
  S.setMaster(true);
  assert.deepEqual(names(), [MODELS[0].id + '!', MODELS[1].id + '!', '#Modulators', 'wheel!', 'velo!', 'at!', 'bend!', 'note!', 'lfo', 'env!', 'macro', 'cc', 'chaos', 'p', '#Controllers!', 'pads!']);
  S.setMaster(false);
  assert.deepEqual(names(), [MODELS[0].id + '!', MODELS[1].id + '!', '#Modulators', 'wheel', 'velo', 'at', 'bend', 'note', 'lfo', 'env', 'macro', 'cc', 'chaos', 'p!', '#Controllers!', 'pads!']);
  S.destroy();
  assert.equal(list.children.filter(n => n.tagName === 'P').length, 0, 'the note goes with the tray');
});

test('index.html / style.css (MM, IMPL-MM §7.3): the .cv-mside rule is narrowed in place — it hides #srcLayout and #srcNote only, never #srcScroll (the Modulators section is the master\'s tray); the master note has its rule; the skins stay the last rules of the file', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\n#srcTray\.cv-mside #srcLayout, #srcTray\.cv-mside #srcNote \{ display: none; \}\n/, 'the rule, in place, two selectors');
  assert.ok(!/#srcTray\.cv-mside #srcScroll/.test(css), 'no #srcScroll in it');
  assert.equal(css.split('\n').filter(l => l.includes('cv-mside')).length, 1, 'one line of the file mentions cv-mside: that rule');
  assert.match(css, /\n\.cv-mnote \{[^}]*font-size: 11px[^}]*color: var\(--mute\)/, 'the note\'s look: the placeholder notes\'');
  assert.match(css, /\n\.cv-mnote\[hidden\] \{ display: none; \}/);
  assert.ok(css.indexOf('\n.cv-mnote {') > css.indexOf('#srcTray.cv-mside #srcLayout') && css.indexOf('\n.cv-mnote {') < css.indexOf('the rig\'s modules (stage WC'), 'next to the rule, before the rig\'s block');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<section id="srcModSec" class="cv-tsec" aria-label="Modulators" hidden>\s*<h3 class="cv-tgrp">Modulators<\/h3>/, 'the section\'s heading is the HTML\'s: "Modulators" on the master too');
});
