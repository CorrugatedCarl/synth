import './v8-guard.mjs';
// cv-panel.js (ENGINE lane; docs/canvas/IMPL-panels.md §9.1): the layout format (a fixture layout + one mutation per
// rule), every authored panels/<model>.js (valid, every models.js id exactly once, the §10 extras, sizes on the dots, hit
// boxes ≥ 28 px and disjoint, original artwork), the renderer on tests/wk-dom.mjs with a fake api (one .hw-c per live
// control in section order, ui registration, redraws, null positions skipped, level rockers, combos, the two-finger
// rollback, no renderer widget classed as a plain knob / slider) and determinism (the hardware layout always comes back
// exactly). Models whose layout is still null are skipped, each by name. Never pass fake-DOM nodes to assert.*.
// Run alone: node --max-old-space-size=2048 --test tests/cv-panel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../cv-panel.js?v=9';
import { MODELS } from '../models.js?v=9';
import { BAR_H } from '../cv-module.js?v=9';
import { DOT } from '../cv-world.js?v=9';
import { fresh, all, ptr, fire, key } from './wk-dom.mjs';
import { TB_FX, DX_FX } from './fixtures/panels.mjs';
import * as wk from '../wk.js?v=9';

const modelOf = id => MODELS.find(m => m.id === id);
const clone = x => JSON.parse(JSON.stringify(x));
const authored = P.HW_IDS.filter(id => P.layoutOf(id));
const missing = P.HW_IDS.filter(id => !P.layoutOf(id));
// §10: the extras of every model; the module sizes (pinned from the authors' hand-back notes; else the target ± a dot)
const EXTRAS = {
  modular: ['kb'], minimoog: [], arp2600: ['sy', 'kb', 'lw', 'src', 'gl'], solina: ['tn'], cs80: [], prophet5: ['li', 'rev', 'ud'], ms20: [],
  tb303: ['al', 'seq:sync', 'seq:swing', 'seq:random', 'seq:demo', 'seq:toRoll', 'seq:grid'], obxa: ['lc', 'ud'], jupiter8: ['pw'], juno60: ['hs'], dx7: ['dac'],
};
const TARGET = { modular: [1728, 960], minimoog: [1408, 512], arp2600: [1568, 928], solina: [1984, 256], cs80: [2432, 768], prophet5: [1920, 512],
  ms20: [1120, 416], tb303: [608, 608], obxa: [2048, 576], jupiter8: [2144, 608], juno60: [2144, 416], dx7: [2048, 480] };
const PINNED = { minimoog: [1408, 512] };
// §10 section order where it is pinned (the reference layout)
const SECTIONS = { minimoog: ['controllers', 'oscbank', 'mixer', 'modifiers', 'output', 'power', 'lefthand'] };

/* ---------------------------------------------------------------- a fixture model + layout (every widget kind) */
const FX_MODEL = {
  id: 'fixture', name: 'Fixture', theme: { knob: 'std' },
  controls: [
    { t: 'k', id: 'cut', label: 'Cutoff', min: 0, max: 10, def: 5 },
    { t: 's', id: 'rng', label: 'Range', opts: ['A', 'B', 'C', 'D'], def: 1 },
    { t: 'b', id: 'on', label: 'On', def: 0 },
    { t: 'k', id: 'saw', label: 'Saw', min: 0, max: 1, def: 0 },
    { t: 's', id: 'cho', label: 'Chorus', opts: ['Off', 'I', 'II', 'I+II'], def: 0 },
    { t: 's', id: 'wav', label: 'Wave', opts: ['Tri', 'Saw', 'Sq'], def: 0 },
    { t: 'k', id: 'vol', label: 'Volume', min: 0, max: 10, def: 8 },
    { t: 's', id: 'nz', label: 'Noise', opts: ['White', 'Pink'], def: 0 },
    { t: 'k', id: 'trk', label: 'Track', min: 0, max: 1, def: 0, step: 0.5 },
    { t: 'k', id: 'mod', label: 'Mod amount', min: 0, max: 10, def: 0 },
    { t: 'b', id: 'xtra', label: 'Extra', def: 0 },
  ],
};
const FX_LAYOUT = {
  v: 1, id: 'fixture', hw: 'fixture', case: '#202020',
  scheme: { panel: '#111111', legend: '#eeeeee', knob: { skirt: '#111', cap: '#999', ptr: '#fff', ptrStyle: 'line', capR: 0.6 }, rocker: { blue: '#4585b5' } },
  areas: [{ id: 'main', src: [0, 0, 300, 100], at: [0, 0] }, { id: 'aux', src: [0, 0, 60, 30], at: [0, 108] }],
  sections: [
    { id: 'a', label: 'ONE', x: 0, y: 0, w: 150, h: 100, frame: 'box', title: 'top' },
    { id: 'b', label: 'TWO', x: 150, y: 0, w: 150, h: 100, frame: 'header', title: 'header' },
    { id: 'c', label: 'AUX', a: 'aux', x: 0, y: 0, w: 60, h: 30, frame: 'none', title: 'none' },
  ],
  controls: [
    { id: 'cut', kind: 'knob', x: 30, y: 30, d: 24, sweep: 300, label: 'CUTOFF', scale: { n: 11, labels: ['0', '', '', '', '', '5', '', '', '', '', '10'] } },
    { id: 'rng', kind: 'rotary', x: 80, y: 30, d: 20, sweep: 150, legends: ['A', 'B', 'X', 'C', 'D'], map: [0, 1, null, 2, 3], label: 'RANGE' },
    { id: 'on', kind: 'switch', style: 'rocker', orient: 'h', x: 120, y: 30, w: 20, h: 10, color: 'blue', label: 'ON' },
    { id: 'saw', kind: 'switch', style: 'rocker', orient: 'v', level: true, x: 30, y: 75, w: 10, h: 20, label: 'SAW' },
    { id: 'cho', kind: 'buttons', x: 80, y: 75, w: 14, h: 10, at: [{ v: 0, x: 65, y: 75, label: 'OFF' }, { v: 1, x: 82, y: 75, label: 'I' }, { v: 2, x: 99, y: 75, label: 'II' }], combo: { 3: [1, 2] }, label: 'CHORUS' },
    { id: 'wav', kind: 'jacks', x: 180, y: 30, d: 8, at: [{ v: 0, x: 170, y: 30, label: 'TRI' }, { v: 1, x: 188, y: 30, label: 'SAW' }, { v: 2, x: 206, y: 30, label: 'SQ' }] },
    { id: 'vol', kind: 'slider', orient: 'h', x: 200, y: 75, len: 40, cap: [10, 6], label: 'VOLUME' },
    { id: 'nz', kind: 'slider', x: 260, y: 60, len: 30, cap: [10, 6], legends: ['WHITE', 'PINK'], label: 'NOISE' },
    { id: 'trk', kind: 'button', x: 260, y: 20, w: 14, h: 10, cycle: [0, 0.5, 1], ledLevels: ['off', 'dim', 'on'], led: 'cap', label: 'TRACK' },
    { id: 'mod', kind: 'knob', a: 'aux', x: 20, y: 15, d: 16, label: 'MOD' },
    { kind: 'led', of: 'on', when: ['ne', 0], x: 135, y: 30, d: 3 },
    { kind: 'knob', x: 130, y: 75, d: 20, inert: true, label: 'TUNE' },
    { kind: 'jack', x: 290, y: 90, d: 7, inert: true, label: 'OUT' },
  ],
  decor: [
    { t: 'line', x1: 150, y1: 0, x2: 150, y2: 100, sw: 0.5 },
    { t: 'text', x: 150, y: 96, s: 'Fixture', size: 3, anchor: 'middle' },
    { t: 'glyph', g: 'wave:saw', x: 40, y: 92, size: 4 },
    { t: 'path', d: 'M10 10L20 20', stroke: '#ffffff' },
  ],
  extras: { ids: ['xtra'] },
};

/* ---------------------------------------------------------------- the format */
test('format: PX_PER_MM = 2 and the contract constants; the fixture layout validates', () => {
  assert.deepEqual([P.FORMAT, P.PX_PER_MM, P.HIT_MIN_MM, P.HIT_DEF_MM, P.SEAM_MM, P.BAND_MAX_MM, P.XROW, P.XCAP], [1, 2, 14, 15, 8, 24, 64, 16]);
  assert.deepEqual([P.XCELL.k, P.XCELL.b, P.XCELL.s(2), P.XCELL.s(4), P.SEQ_GRID.w, P.SEQ_GRID.h], [72, 72, 120, 224, 576, 192]);
  // a selector cell grows with long option names (Prophet-5 FILTER: two ~87 px pills in a row overlapped UNI DETUNE in 120)
  assert.deepEqual([P.selCellW(['Off', 'On']), P.selCellW(['Sine', 'Tri', 'Square', 'S&H'])], [120, 224]);
  assert.ok(P.selCellW(['Rev 2 · SSM', 'Rev 3 · CEM']) >= 16 + 2 * 87 + 3);
  assert.deepEqual(P.validate(FX_LAYOUT, FX_MODEL), []);
  assert.deepEqual(P.HW_IDS, ['modular', 'minimoog', 'arp2600', 'solina', 'cs80', 'prophet5', 'ms20', 'tb303', 'obxa', 'jupiter8', 'juno60', 'dx7']);
  if (missing.length) console.log('# cv-panel: not drawn yet (skipped, Resizable only): ' + missing.join(', '));
});

test('validate: each broken rule is reported (one mutation per rule), naming the field', () => {
  const bad = (f, re, m) => {
    const L = clone(FX_LAYOUT);
    f(L);
    const p = P.validate(L, FX_MODEL);
    assert.ok(p.some(x => re.test(x)), (m || re) + ' → ' + JSON.stringify(p));
  };
  bad(L => { L.v = 2; }, /^v: /);
  bad(L => { L.id = 'other'; }, /^id: /);
  bad(L => { L.areas[0].id = 'face'; }, /areas\[0\]: its id must be "main"/);
  bad(L => { L.areas[1].src = [0, 0, -1, 4]; }, /areas\[1\]: src/);
  bad(L => { L.sections[0].x = 200; }, /sections\[0\]: outside its area/);
  bad(L => { L.sections.push({ id: 'a', label: 'X', x: 0, y: 0, w: 1, h: 1 }); }, /a unique id/);
  bad(L => { L.controls[0].x = 299; }, /controls\[0\] \(cut\): outside its area/);
  bad(L => { L.controls[0].id = 'nope'; }, /"nope" is not a control of the model/);
  bad(L => { L.controls.push({ id: 'cut', kind: 'knob', x: 260, y: 90, d: 10 }); }, /cut: placed 2 times/, 'exactly once');
  bad(L => { L.extras.ids = []; }, /xtra: not placed/, 'every id somewhere');
  bad(L => { L.controls[2].kind = 'knob'; L.controls[2].d = 10; }, /a knob cannot carry a "b" control/, 'kind per type');
  bad(L => { L.controls[1].map = [0, 1, null, 2, 9]; }, /9 is not a value of rng/, 'map values');
  bad(L => { L.controls[1].legends = ['A', 'B']; }, /2 legends for 5 positions/);
  bad(L => { L.controls[0].hit = [10, 20]; }, /hit box 10 × 20 mm < 14 mm/);
  bad(L => { L.controls[2].x = 92; }, /hit boxes overlap/, 'disjoint hit boxes');
  bad(L => { L.controls[0].label = 'Moog CUTOFF'; }, /a maker name/, 'no maker name');
  bad(L => { L.decor.push({ t: 'text', x: 1, y: 1, s: 'by Roland' }); }, /a maker name/);
  bad(L => { L.decor.push({ t: 'path', d: 'M0 0 url(#x)' }); }, /path data/);
  bad(L => { L.decor.push({ t: 'glyph', g: 'wave:bogus', x: 5, y: 5, size: 3 }); }, /unknown glyph/);
  bad(L => { L.controls[4].combo = { 3: [1, 7] }; }, /combo 3/);
  bad(L => { L.controls.push({ kind: 'knob', x: 260, y: 90, d: 6, id: 'vol', inert: true }); }, /an inert control has no id/);
  bad(L => { L.controls[3].level = false; }, /a "k" switch needs map or level/);
  bad(L => { L.areas[0].src[2] = 2100; L.sections[1].w = 1950; }, /content: 2100 × 138 mm > 2000 × 1000/);
  bad(L => { L.decor = Array.from({ length: 3001 }, () => ({ t: 'line', x1: 0, y1: 0, x2: 1, y2: 1 })); }, /decor: 3001 items > 3000/);
  bad(L => { L.controls[9].x = 40; L.controls[9].hit = [14, 14]; L.controls[9].a = 'aux'; L.sections[2].w = 20; }, /not inside a section/);
  bad(L => { L.extras.at = [0, 0, 40, 20]; }, /extras.at: overlaps area "main"/);
  assert.ok(P.validate(Object.assign(clone(FX_LAYOUT), { controls: [] }), FX_MODEL).length > 5, 'nothing placed');
  assert.deepEqual(P.validate(null, FX_MODEL), ['layout: not an object']);
});

test('geometry: mm → body px at 2 px/mm, content centred, W / H on the dots, the bar in H; hit boxes grow to 15 mm; the Tab order is sections, then rows, then x', () => {
  const g = P.geometry(FX_LAYOUT, FX_MODEL), s = P.sizeOf(FX_LAYOUT, FX_MODEL);
  // content 300 × 138 mm → 600 × 276 px; W = 608 (centred: 4 px each side); the extras strip 16 + 64 + 8 → H = ceil32(40 + 276 + 88) = 416
  assert.deepEqual([g.W, g.content.x, g.content.w, g.content.h], [608, 4, 600, 276]);
  assert.deepEqual(s, { w: 608, h: 416 });
  assert.equal(s.w % DOT + s.h % DOT, 0);
  assert.deepEqual(g.extras && [g.extras.x, g.extras.y, g.extras.w, g.extras.h, g.extras.cells.map(c => [c.id, c.x, c.y, c.w, c.h])], [0, 276, 608, 88, [['xtra', 8, 292, 72, 64]]]);
  const cut = g.controls[0];
  assert.deepEqual([cut.box.w, cut.own.w, cut.hit.w, cut.box.x, cut.box.y], [61.5, 48, 48, 33.5, 29.5], 'the knob box draws its skirt at d (61.44 → half px)');
  const on = g.controls[2];
  assert.deepEqual([on.hit.w, on.hit.h], [40, 30], 'a 20 × 10 mm rocker: hit 20 × 15 mm');
  assert.deepEqual(g.controls[9].cx === 20 && g.controls[9].cy === 123, true, 'an aux area maps its frame onto the content');
  assert.deepEqual(g.order.map(i => FX_LAYOUT.controls[i].id || FX_LAYOUT.controls[i].kind), ['cut', 'rng', 'on', 'led', 'saw', 'cho', 'trk', 'wav', 'nz', 'vol', 'mod']);
  const hb = P.hitBoxes(FX_LAYOUT, FX_MODEL);
  assert.equal(hb.filter(h => h.id === 'cho').length, 3, 'a buttons control: one hit box per button');
});

/* ---------------------------------------------------------------- every authored model */
for (const id of P.HW_IDS) {
  const L = P.layoutOf(id), model = modelOf(id);
  if (!L) { test(`panels/${id}.js: not drawn yet (null) — skipped`, { skip: 'null layout: the model offers its Resizable panel only' }, () => {}); continue; }
  test(`panels/${id}.js: valid; every models.js id exactly once; the §10 extras; every live control in a section`, () => {
    assert.deepEqual(P.validate(L, model), []);
    assert.equal(L.id, id);
    assert.deepEqual([...L.extras.ids].sort(), [...EXTRAS[id]].sort(), 'extras (§10)');
    const live = new Map();
    for (const c of L.controls) if (!c.inert && typeof c.id === 'string') live.set(c.id, (live.get(c.id) || 0) + 1);
    for (const c of model.controls) {
      const n = (live.get(c.id) || 0) + (L.extras.ids.includes(c.id) ? 1 : 0);
      if (id === 'dx7' && live.has('dx:btn') && c.id !== 'vol' && c.id !== 'dac') continue; // (addressed by the DATA ENTRY buttons, §6.3)
      assert.equal(n, 1, c.id + ' placed once');
    }
    if (SECTIONS[id]) assert.deepEqual(L.sections.map(s => s.id), SECTIONS[id], 'sections in the §10 order');
    const g = P.geometry(L, model);
    for (const o of g.controls) if (o.live) assert.ok(o.sec >= 0, `${o.id} inside a section`);
    const shown = g.controls.filter(o => o.live || o.show).map(o => o.i), num = (a, b) => a - b;
    assert.deepEqual([...g.order].sort(num), shown.sort(num), 'every live control (and live display) in the Tab order, once');
    if (id === 'dx7') { // 43 widgets by design: every other id is the one some button addresses (EDIT: each OP, each EG step; FUNCTION 17)
      const reach = new Set(['vol', ...L.extras.ids]), ns = L.controls.filter(c => c.id === 'dx:btn').map(c => c.n);
      for (let op = 1; op <= 6; op++) for (let eg = 1; eg <= 4; eg++) for (const n of ns) { const a = P.dxAddr(n, { mode: 'edit', op, eg }); if (a) reach.add(a); }
      for (const n of ns) { const a = P.dxAddr(n, { mode: 'function', op: 1, eg: 1 }); if (a) reach.add(a); }
      for (const c of model.controls) assert.ok(reach.has(c.id), c.id + ' reached through a DX7 button');
    } else assert.ok(g.order.length >= model.controls.length - L.extras.ids.length, 'every live control in the Tab order');
  });
  test(`panels/${id}.js: the module size on the dots (bar included), ${PINNED[id] ? 'pinned' : 'the §10 target ± a dot'}; hit boxes ≥ 28 px, disjoint, inside the body`, () => {
    const s = P.sizeOf(L, model), g = P.geometry(L, model);
    assert.equal(s.w % DOT, 0); assert.equal(s.h % DOT, 0);
    assert.equal(s.h, g.body.h + BAR_H);
    if (PINNED[id]) assert.deepEqual([s.w, s.h], PINNED[id]);
    else {
      const [tw, th] = TARGET[id];
      assert.ok(Math.abs(s.w - tw) <= DOT || (id === 'ms20' && Math.abs(s.w - 1152) <= DOT), `width ${s.w} vs ${tw}`);
      assert.ok(Math.abs(s.h - th) <= DOT, `height ${s.h} vs ${th}`);
    }
    const hb = P.hitBoxes(L, model);
    for (const h of hb) {
      assert.ok(h.w >= 28 && h.h >= 28, `${h.id}: ${h.w} × ${h.h} px`);
      assert.ok(h.x >= 0 && h.y >= 0 && h.x + h.w <= g.body.w && h.y + h.h <= g.body.h, `${h.id} inside the body`);
    }
    for (let i = 0; i < hb.length; i++) for (let j = i + 1; j < hb.length; j++) {
      const a = hb[i], b = hb[j];
      assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${a.id} × ${b.id} overlap`);
    }
  });
  test(`panels/${id}.js: original artwork — no image / href / xlink / foreignObject / script, no maker name, the model name only as plain text`, () => {
    const svg = P.decorSvg(L, model);
    for (const bad of ['<image', 'href', 'xlink', '<foreignObject', '<script', 'javascript:']) assert.equal(svg.includes(bad), false, bad);
    const urls = [...svg.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1]);
    for (const u of urls) assert.ok(svg.includes(`id="${u}"`), 'url(#' + u + ') is a gradient the SVG defines itself');
    const texts = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1].replace(/<[^>]+>/g, ' '));
    for (const t of texts) assert.doesNotMatch(t, new RegExp('\\b(' + P.MAKERS.join('|') + ')\\b'), 'maker name in: ' + t);
    assert.doesNotMatch(svg.replace(/<text[\s\S]*?<\/text>/g, '').replace(/<title>[\s\S]*?<\/title>/g, '').replace(/data-tip="[^"]*"/g, ''), new RegExp('\\b' + model.name + '\\b'), 'the model name only in <text>');
    assert.ok(svg.startsWith('<svg') && svg.includes('aria-hidden="true"'));
    for (const [, tip] of svg.matchAll(/<title>([^<]*)<\/title>/g)) assert.match(tip, / — not emulated$/, 'inert controls titled');
  });
}

/* ---------------------------------------------------------------- render on the fake DOM */
// a fake main.js api: today's widgets in miniature (class knob / slider / sel / tog, ui registration) and a dragB with
// the tap and the two-finger rollback (value and preset name back)
function fakeApi(model, doc) {
  const vals = {}, ui = new Map(), log = [];
  for (const c of model.controls) vals[c.id] = c.def;
  const state = { preset: 'Init', tips: [] };
  const set = (id, v) => { vals[id] = v; state.preset = null; const u = ui.get(id); if (u) u(); log.push(id + '=' + v); };
  const mk = (tag, cls) => { const e = doc.createElement(tag); if (cls) e.className = cls; return e; };
  const widget = cls => c => { const el = mk('div', cls); el.setAttribute('aria-label', c.label); const upd = () => el.setAttribute('aria-valuenow', String(vals[c.id])); ui.set(c.id, upd); upd(); return el; };
  const api = {
    doc, model, vals, ui, log, state,
    get: id => vals[id], set,
    watch: (id, fn) => { const p = ui.get(id); ui.set(id, p ? () => { p(); fn(); } : fn); },
    bind: c => ({ id: c.id, label: c.label, min: c.min, max: c.max, step: c.step, def: c.def, get: () => vals[c.id], set: v => set(c.id, v), fmt: v => String(v),
      snap: () => ({ v0: vals[c.id], pre0: state.preset }), restore: k => { if (vals[c.id] !== k.v0) set(c.id, k.v0); state.preset = k.pre0; } }),
    knob: c => { const el = widget('knob')(c); el.setAttribute('data-sweep', String(c.sweep)); return el; },
    slider: c => { const el = widget('slider')(c); el.setAttribute('data-orient', c.orient || 'v'); return el; },
    selector: widget('sel'), toggle: widget('tog'),
    dragB(el, b, o = {}) {
      let st = null;
      el.addEventListener('pointerdown', e => { st = { y: e.clientY, x: e.clientX, k: b.snap(), v0: b.get(), p: (b.get() - b.min) / ((b.max - b.min) || 1), moved: false }; });
      el.addEventListener('pointermove', e => {
        if (!st) return;
        const d = b.axis === 'x' ? e.clientX - st.x : st.y - e.clientY;
        st.moved = st.moved || Math.abs(d) > 4;
        const p = Math.max(0, Math.min(1, st.p + d / 40)), v = b.min + p * (b.max - b.min);
        b.set(b.step ? Math.round(v / b.step) * b.step : v);
      });
      el.addEventListener('pointerup', () => { if (st && !st.moved && b.get() === st.v0 && o.tap) o.tap(); st = null; });
      el.addEventListener('pointercancel', e => { if (st && e.gesture === 'two-finger') b.restore(st.k); st = null; });
      el.addEventListener('keydown', e => { const d = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0; if (d) b.set(Math.max(b.min, Math.min(b.max, b.get() + d * (b.step || 1)))); });
    },
    tap: (el, fn) => el.addEventListener('pointerup', fn),
    tip: (el, t) => state.tips.push(t), untip: () => {},
    fmt: (c, v) => String(v), presetNo: () => 3,
  };
  return api;
}
const cls = n => n.getAttribute('class') || '';
const byCtl = (root, id) => all(root).find(n => n.getAttribute && n.getAttribute('data-ctl') === id) || null;
const widgetOf = (root, id) => { const w = byCtl(root, id); return w ? w.childNodes[0] : null; };

test('render (fixture): one .hw-c[data-ctl] per live control in the Tab order, sized from the geometry; ui registered for every id; the art, the extras strip, the caption', () => {
  const doc = fresh(), root = doc.createElement('div'), api = fakeApi(FX_MODEL, doc);
  doc.body.append(root);
  const r = P.render(root, FX_LAYOUT, FX_MODEL, api);
  assert.deepEqual([r.w, r.h], [608, 416]);
  assert.match(cls(root), /^inst hw knob-std m-fixture$/);
  assert.deepEqual([root.style.width, root.style.height, root.getAttribute('data-hw')], ['608px', '376px', 'fixture']);
  assert.deepEqual(root.childNodes.map(cls), ['hw-decor', 'hw-ctls', 'hw-extras']);
  assert.ok(String(root.childNodes[0].innerHTML).startsWith('<svg'), 'the decor SVG');
  const ctls = root.childNodes[1];
  assert.deepEqual([ctls.getAttribute('role'), ctls.getAttribute('aria-label')], ['group', 'Fixture front panel']);
  assert.deepEqual(ctls.childNodes.map(n => n.getAttribute('data-ctl') || cls(n)), ['cut', 'rng', 'on', 'hw-led hw-show', 'saw', 'cho', 'trk', 'wav', 'nz', 'vol', 'mod']);
  for (const id of ['cut', 'rng', 'on', 'saw', 'cho', 'wav', 'vol', 'nz', 'trk', 'mod', 'xtra']) assert.ok(api.ui.has(id), 'ui ' + id);
  const g = P.geometry(FX_LAYOUT, FX_MODEL), cut = byCtl(root, 'cut');
  assert.deepEqual([cut.style.left, cut.style.width, cut.getAttribute('data-kind')], [g.controls[0].box.x + 'px', g.controls[0].box.w + 'px', 'knob']);
  assert.equal(widgetOf(root, 'cut').style['--hit-w'], '48px', 'the hit area (::before) from the geometry');
  assert.equal(widgetOf(root, 'cut').getAttribute('data-sweep'), '300', 'today\'s knob, with the printed sweep');
  assert.equal(widgetOf(root, 'vol').getAttribute('data-orient'), 'h');
  // no renderer widget is classed as a plain knob / slider (tests find today's continuous widgets by class)
  for (const id of ['rng', 'nz']) assert.ok(!['knob', 'slider'].includes(cls(widgetOf(root, id))), id + ': ' + cls(widgetOf(root, id)));
  assert.deepEqual([cls(widgetOf(root, 'rng')), cls(widgetOf(root, 'nz'))], ['knob hw-rot', 'slider hw-det']);
  const xs = root.childNodes[2];
  assert.deepEqual([xs.childNodes[0].textContent, xs.childNodes[1].getAttribute('data-ctl'), cls(xs.childNodes[1].childNodes[0])], ['EXTRAS · not on the original · Dimmed controls are not emulated', 'xtra', 'tog']);
  // a tap on a dimmed control: "not emulated"
  const svgG = doc.createElement('g'); svgG.setAttribute('data-tip', 'TUNE — not emulated'); root.childNodes[0].append(svgG);
  fire(svgG, 'click');
  assert.deepEqual(api.state.tips, ['TUNE — not emulated']);
});

test('render (fixture): a set redraws its widget; null positions are skipped by taps, drags and keys; a level rocker toggles 0 ↔ its last level; a combo lights two; a two-finger cancel restores value and preset name', () => {
  const doc = fresh(), root = doc.createElement('div'), api = fakeApi(FX_MODEL, doc);
  doc.body.append(root);
  P.render(root, FX_LAYOUT, FX_MODEL, api);
  // rotary with map [0, 1, null, 2, 3]: positions 0 1 _ 3 4
  const rng = widgetOf(root, 'rng');
  assert.deepEqual([rng.getAttribute('aria-valuenow'), rng.getAttribute('aria-valuetext')], ['1', 'B']);
  ptr(rng, 'pointerdown', 10, 100); ptr(rng, 'pointerup', 10, 100);
  assert.deepEqual([api.vals.rng, rng.getAttribute('aria-valuenow'), rng.getAttribute('aria-valuetext')], [2, '3', 'C'], 'a tap skips the null position');
  ptr(rng, 'pointerdown', 10, 100); ptr(rng, 'pointerup', 10, 100); ptr(rng, 'pointerdown', 10, 100); ptr(rng, 'pointerup', 10, 100);
  assert.equal(api.vals.rng, 0, 'wraps');
  key(rng, 'ArrowUp'); key(rng, 'ArrowUp');
  assert.equal(api.vals.rng, 2, 'keys step over the valid positions');
  api.set('rng', 1);
  assert.equal(rng.getAttribute('aria-valuenow'), '1', 'set → redrawn');
  // two-finger rollback on the rotary: value and preset name back
  api.state.preset = 'Fat';
  ptr(rng, 'pointerdown', 10, 100); ptr(rng, 'pointermove', 10, 40);
  assert.notEqual(api.vals.rng, 1);
  fire(rng, 'pointercancel', { gesture: 'two-finger' });
  assert.deepEqual([api.vals.rng, api.state.preset, rng.getAttribute('aria-valuenow')], [1, 'Fat', '1'], 'rolled back');
  // a 2-position rocker: aria-pressed, data-pos
  const on = widgetOf(root, 'on');
  assert.deepEqual([on.localName, cls(on), on.getAttribute('aria-pressed'), on.getAttribute('data-pos')], ['button', 'hw-sw', 'false', '0']);
  ptr(on, 'pointerdown', 0, 0); ptr(on, 'pointerup', 0, 0);
  assert.deepEqual([api.vals.on, on.getAttribute('aria-pressed'), on.getAttribute('data-pos')], [1, 'true', '1']);
  // the LED follows `on`
  const led = root.childNodes[1].childNodes.find(n => cls(n) === 'hw-led hw-show');
  assert.equal(led.getAttribute('data-lit'), 'on');
  // a level rocker: a tap toggles 0 ↔ the last level; a drag sets the level
  const saw = widgetOf(root, 'saw');
  ptr(saw, 'pointerdown', 0, 100); ptr(saw, 'pointerup', 0, 100);
  assert.equal(api.vals.saw, 1, '0 → max (no level yet)');
  api.set('saw', 0.4);
  ptr(saw, 'pointerdown', 0, 100); ptr(saw, 'pointerup', 0, 100);
  assert.equal(api.vals.saw, 0);
  ptr(saw, 'pointerdown', 0, 100); ptr(saw, 'pointerup', 0, 100);
  assert.equal(api.vals.saw, 0.4, 'back to the last level');
  assert.equal(saw.childNodes.find(n => cls(n) === 'hw-sw-fill').style.height, '40%');
  // buttons with a combo: I then II = I+II (two lit); the lit one of two releases it to the other
  const grp = widgetOf(root, 'cho'), btn = v => grp.childNodes.find(n => n.getAttribute('data-v') === String(v));
  const lit = () => grp.childNodes.filter(n => n.getAttribute('aria-checked') === 'true').map(n => +n.getAttribute('data-v'));
  assert.deepEqual([grp.getAttribute('role'), btn(0).getAttribute('role'), lit()], ['radiogroup', 'radio', [0]]);
  ptr(btn(1), 'pointerup', 0, 0);
  assert.deepEqual([api.vals.cho, lit()], [1, [1]]);
  ptr(btn(2), 'pointerup', 0, 0);
  assert.deepEqual([api.vals.cho, lit()], [3, [1, 2]], 'I+II');
  ptr(btn(1), 'pointerup', 0, 0);
  assert.deepEqual([api.vals.cho, lit()], [2, [2]], 'the lit I released: II');
  ptr(btn(0), 'pointerup', 0, 0);
  assert.deepEqual(lit(), [0]);
  // jacks: the selected one lit (a cord stub)
  const jk = widgetOf(root, 'wav');
  ptr(jk.childNodes[2], 'pointerup', 0, 0);
  assert.deepEqual([api.vals.wav, jk.childNodes.map(n => n.getAttribute('data-lit'))], [2, ['off', 'off', 'on']]);
  // a cycling button with LED levels
  const trk = widgetOf(root, 'trk');
  const step = () => { ptr(trk, 'pointerup', 0, 0); return [api.vals.trk, trk.getAttribute('data-lit'), trk.getAttribute('aria-pressed')]; };
  assert.deepEqual([step(), step(), step()], [[0.5, 'dim', 'true'], [1, 'on', 'true'], [0, 'off', 'false']]);
  // a detented slider (an "s" control with legends)
  const nz = widgetOf(root, 'nz');
  ptr(nz, 'pointerdown', 0, 100); ptr(nz, 'pointerup', 0, 100);
  assert.deepEqual([api.vals.nz, nz.getAttribute('aria-valuetext')], [1, 'PINK']);
});

test('render: deterministic — the same layout renders the same DOM (tags, classes, data-ctl, inline geometry), so the Hardware layout always comes back exactly', () => {
  const ser = n => n.localName + '.' + cls(n) + '[' + (n.getAttribute('data-ctl') || '') + ']' + JSON.stringify(n.style) + '(' + n.childNodes.filter(c => c.nodeType === 1).map(ser).join(',') + ')';
  const once = (L, model) => { const doc = fresh(), root = doc.createElement('div'); doc.body.append(root); P.render(root, L, model, fakeApi(model, doc)); return ser(root); };
  assert.equal(once(FX_LAYOUT, FX_MODEL), once(FX_LAYOUT, FX_MODEL));
  for (const id of authored) assert.equal(once(P.layoutOf(id), modelOf(id)), once(P.layoutOf(id), modelOf(id)), id);
});

test('render (every authored model): every live models.js id has one .hw-c (or an extras cell) and a ui entry; controls in the section order', () => {
  for (const id of authored) {
    const L = P.layoutOf(id), model = modelOf(id), doc = fresh(), root = doc.createElement('div'), api = fakeApi(model, doc);
    doc.body.append(root);
    P.render(root, L, model, api);
    const ctl = all(root).filter(n => n.getAttribute && n.getAttribute('data-ctl')).map(n => n.getAttribute('data-ctl'));
    for (const c of model.controls) {
      if (id === 'dx7' && c.id !== 'vol' && c.id !== 'dac') continue;
      assert.equal(ctl.filter(x => x === c.id).length, 1, `${id}: ${c.id} once`);
      assert.ok(api.ui.has(c.id), `${id}: ui ${c.id}`);
    }
    const g = P.geometry(L, model), secs = g.order.map(i => g.controls[i].sec);
    assert.deepEqual(secs, [...secs].sort((a, b) => a - b), id + ': section order');
  }
});

test('usable(): a valid layout, else null (the model keeps its Resizable panel); a token this build cannot draw makes it unusable', () => {
  for (const id of authored) assert.equal(P.usable(id, modelOf(id)), P.layoutOf(id), id);
  for (const id of missing) assert.equal(P.usable(id, modelOf(id)), null, id);
  assert.equal(P.usable('serum', modelOf('serum')), null);
  assert.equal(P.usable('nope', null), null);
});

/* ---------------------------------------------------------------- TB-303 and DX7 special areas (§6.2, §6.3) */
function fakeSeq(doc, api) {
  const st = (n, g = 1) => ({ n, o: 0, a: 0, s: 0, g });
  const fns = new Set(), log = [];
  const node = cls => { const e = doc.createElement('div'); e.className = cls; return e; };
  let run = false;
  const S = {
    q: { bpm: 128, swing: 0, sync: false, pat: Array.from({ length: 16 }, () => st(0)) },
    state: { cur: 0, mode: 'pitch' }, log,
    send: () => log.push('send'), redraw: () => log.push('redraw'), changed: () => { for (const f of fns) f(); }, onChange: fn => fns.add(fn),
    toggle: on => { run = on; log.push('run ' + on); const u = api.ui.get('@seqrun'); if (u) u(); }, running: () => run,
    doClear: () => { S.q.pat = S.q.pat.map(() => st(0)); log.push('clear'); S.changed(); },
    sync: node('seqbtn'), swing: node('seqnum'), rnd: node('seqbtn'), demo: node('seqbtn'), toRoll: node('seqbtn'), steps: node('steps'),
  };
  return S;
}
const algStub = () => ({ xs: [0, 0, 1, 2, 0, 1, 2], lvl: [0, 0, 0, 0, 1, 1, 1], maxL: 1, cols: 3 });

test('TB-303 fixture: validates; RUN / TEMPO / CLEAR, the 13 keys and the step buttons on the face, today\'s parts and grid in the extras', () => {
  assert.deepEqual(P.validate(TB_FX, modelOf('tb303')), []);
  const doc = fresh(), root = doc.createElement('div'), api = fakeApi(modelOf('tb303'), doc);
  api.seq = fakeSeq(doc, api);
  doc.body.append(root);
  P.render(root, TB_FX, modelOf('tb303'), api);
  const ids = all(root).filter(n => n.getAttribute && n.getAttribute('data-ctl')).map(n => n.getAttribute('data-ctl'));
  for (const id of ['seq:tempo', 'seq:run', 'seq:clear', 'seq:pitch', 'seq:time', 'seq:down', 'seq:up', 'seq:accent', 'seq:slide', 'seq:back', 'seq:next', 'seq:sync', 'seq:swing', 'seq:random', 'seq:demo', 'seq:toRoll', 'seq:grid', 'al'])
    assert.ok(ids.includes(id), id);
  assert.equal(ids.filter(x => x === 'seq:key').length, 13);
  const run = widgetOf(root, 'seq:run');
  assert.deepEqual([run.id, run.getAttribute('aria-pressed'), run.childNodes.at(-1).textContent], ['seqrun', 'false', 'Run'], 'id seqrun; its last child is the state text');
  const tempo = widgetOf(root, 'seq:tempo');
  assert.deepEqual([tempo.getAttribute('role'), tempo.getAttribute('aria-label'), cls(tempo), tempo.getAttribute('aria-valuenow')], ['slider', 'Tempo', 'knob hw-tempo', '128']);
  const grid = byCtl(root, 'seq:grid');
  assert.equal(cls(grid.childNodes[0]), 'steps', 'today\'s grid (its classes unchanged) in the extras');
  ptr(run, 'pointerup', 0, 0);
  const led = root.childNodes[1].childNodes.find(n => cls(n) === 'hw-led hw-show');
  assert.deepEqual([api.seq.log.at(-1), run.getAttribute('aria-pressed'), led.getAttribute('data-lit')], ['run true', 'true', 'on'], 'RUN: the sequencer and its LED');
  // TEMPO: a drag changes the pattern's bpm; a two-finger cancel puts it back
  ptr(tempo, 'pointerdown', 0, 200); ptr(tempo, 'pointermove', 0, 160);
  assert.ok(api.seq.q.bpm > 128);
  fire(tempo, 'pointercancel', { gesture: 'two-finger' });
  assert.equal(api.seq.q.bpm, 128);
});

test('TB-303 step entry: PITCH mode (keys set the note, DOWN / UP the octave, ACCENT / SLIDE toggle), TIME mode (DOWN a note, ACCENT a rest, both advance), BACK / NEXT wrap; the LEDs mirror the cursor step', () => {
  const doc = fresh(), root = doc.createElement('div'), api = fakeApi(modelOf('tb303'), doc), S = api.seq = fakeSeq(doc, api);
  doc.body.append(root);
  P.render(root, TB_FX, modelOf('tb303'), api);
  const keys = all(root).filter(n => n.getAttribute && n.getAttribute('data-ctl') === 'seq:key').map(w => w.childNodes[0]);
  const btn = id => widgetOf(root, id), tap = el => ptr(el, 'pointerup', 0, 0), on = el => el.getAttribute('data-lit');
  assert.equal(on(btn('seq:pitch')), 'on', 'PITCH mode lit');
  tap(keys[4]);
  assert.deepEqual([S.q.pat[0].n, S.q.pat[0].g, on(keys[4]), on(keys[0])], [4, 1, 'on', 'off'], 'a key sets the cursor step\'s note');
  tap(btn('seq:down'));
  assert.deepEqual([S.q.pat[0].o, on(btn('seq:down'))], [-1, 'on']);
  tap(btn('seq:down'));
  assert.equal(S.q.pat[0].o, 0, 'the lit one again: back to 0');
  tap(btn('seq:up')); tap(btn('seq:accent')); tap(btn('seq:slide'));
  assert.deepEqual([S.q.pat[0].o, S.q.pat[0].a, S.q.pat[0].s, on(btn('seq:accent')), on(btn('seq:slide'))], [1, 1, 1, 'on', 'on']);
  tap(btn('seq:next'));
  assert.deepEqual([S.state.cur, on(keys[4]), on(btn('seq:accent'))], [1, 'off', 'off'], 'NEXT: step 2, its LEDs');
  tap(btn('seq:back')); tap(btn('seq:back'));
  assert.equal(S.state.cur, 15, 'BACK wraps');
  // TIME mode
  tap(btn('seq:time'));
  assert.deepEqual([S.state.mode, on(btn('seq:time')), on(btn('seq:pitch'))], ['time', 'on', 'off']);
  S.state.cur = 3; S.q.pat[3].g = 0; S.q.pat[4].g = 1;
  tap(btn('seq:down'));
  assert.deepEqual([S.q.pat[3].g, S.state.cur], [1, 4], 'DOWN: a note, next step');
  tap(btn('seq:accent'));
  assert.deepEqual([S.q.pat[4].g, S.state.cur], [0, 5], 'ACCENT: a rest, next step');
  const n5 = JSON.stringify(S.q.pat[5]);
  tap(btn('seq:up')); tap(keys[7]);
  assert.deepEqual([JSON.stringify(S.q.pat[5]), S.state.cur], [n5, 5], 'UP (a tie) and the keys do nothing in TIME mode');
  tap(btn('seq:clear'));
  assert.equal(S.log.includes('clear'), true, 'PATTERN CLEAR');
});

test('DX7 fixture: validates (the 89 other ids addressed through the buttons); button 7 selects ALGORITHM; OPERATOR SELECT and EG stepping rebind data-ctl; DATA ENTRY follows the selection; NO / YES; FUNCTION and MEMORY SELECT modes; the LCD and the chart', () => {
  const model = modelOf('dx7');
  assert.deepEqual(P.validate(DX_FX, model), []);
  const doc = fresh(), root = doc.createElement('div'), api = fakeApi(model, doc), loads = [];
  api.dx = { state: { op: 1, param: 7, eg: 1, mode: 'edit' }, algs: (model.presets && null) || Array.from({ length: 32 }, () => [[[2, 1]], [1], [6, 6]]), layout: algStub, presets: 5, load: n => loads.push(n), presetName: () => 'BRASS 1' };
  doc.body.append(root);
  P.render(root, DX_FX, model, api);
  const st = api.dx.state, B = n => all(root).find(x => x.getAttribute && x.getAttribute('data-n') === String(n)), W = n => B(n).parentNode;
  const tap = el => ptr(el, 'pointerup', 0, 0), lcd = () => all(root).find(x => cls(x) === 'hw-lcd').childNodes.map(l => l.textContent.trimEnd());
  assert.deepEqual([W(7).getAttribute('data-ctl'), B(7).hasAttribute('data-sel'), W(18).getAttribute('data-ctl'), W(1).getAttribute('data-ctl'), B(1).hasAttribute('data-off')], ['alg', true, 'r1', 'dx:btn', true]);
  api.set('alg', 12);
  assert.deepEqual(lcd(), ['ALG12     111111', 'ALGORITHM=12'], 'edit mode: ALG nn + the operators, the parameter and its value');
  const chart = all(root).find(x => cls(x) === 'hw-chart'), lit = () => all(chart).filter(x => x.hasAttribute && x.hasAttribute('data-on')).length;
  assert.equal(lit(), 1, 'the chart lights the current algorithm');
  tap(B(18));
  assert.deepEqual([st.param, B(18).hasAttribute('data-sel'), lcd()[1]], [18, true, 'OP1 COARSE=' + api.vals.r1]);
  tap(widgetOf(root, 'dx:opsel')); tap(widgetOf(root, 'dx:opsel'));
  assert.deepEqual([st.op, W(18).getAttribute('data-ctl'), W(27).getAttribute('data-ctl'), lcd()[1]], [3, 'r3', 'l3', 'OP3 COARSE=' + api.vals.r3], 'OPERATOR SELECT rebinds');
  tap(B(21));
  assert.equal(W(21).getAttribute('data-ctl'), 'R1_3');
  tap(B(21)); tap(B(21));
  assert.deepEqual([st.eg, W(21).getAttribute('data-ctl'), W(22).getAttribute('data-ctl'), lcd()[1]], [3, 'R3_3', 'L3_3', 'OP3 RATE3=' + api.vals.R3_3], 'pressing 21 again steps the EG');
  // DATA ENTRY: the selected parameter (R3_3), the two-finger rollback; NO / YES step it
  const data = widgetOf(root, 'dx:data'), v0 = api.vals.R3_3;
  ptr(data, 'pointerdown', 0, 200); ptr(data, 'pointermove', 0, 180);
  assert.notEqual(api.vals.R3_3, v0);
  fire(data, 'pointercancel', { gesture: 'two-finger' });
  assert.equal(api.vals.R3_3, v0, 'rolled back');
  api.set('R3_3', 50);
  tap(widgetOf(root, 'dx:yes')); tap(widgetOf(root, 'dx:yes')); tap(widgetOf(root, 'dx:no'));
  assert.equal(api.vals.R3_3, 51, 'YES +1 ×2, NO −1');
  assert.equal(data.getAttribute('aria-valuetext'), 'R3 51');
  // a dead button in edit mode: "not emulated"
  tap(B(2));
  assert.deepEqual(api.state.tips.at(-1), 'B2 — not emulated');
  // FUNCTION: only 17 (wheel range → pmd)
  tap(widgetOf(root, 'dx:function'));
  assert.deepEqual([st.mode, W(17).getAttribute('data-ctl'), B(17).hasAttribute('data-off'), W(18).getAttribute('data-ctl'), lcd()], ['function', 'pmd', false, 'dx:btn', ['FUNCTION CONTROL', 'WHEEL RANGE=' + api.vals.pmd]]);
  // MEMORY SELECT INTERNAL: buttons 1–5 load the factory presets
  tap(widgetOf(root, 'dx:memInt'));
  assert.deepEqual([st.mode, B(3).hasAttribute('data-off'), B(9).hasAttribute('data-off')], ['play', false, true]);
  tap(B(3)); tap(B(9));
  assert.deepEqual(loads, [3], 'button 3: factory preset 3; 9: nothing');
  assert.deepEqual(lcd(), ['INTERNAL 03', 'BRASS 1'], 'play mode: the number and the name (presetNo: 3 in the fake)');
  tap(widgetOf(root, 'dx:edit'));
  assert.deepEqual([st.mode, W(18).getAttribute('data-ctl')], ['edit', 'r3']);
});

/* ---------------------------------------------------------------- (1g) the face's bitmap tier */
// stubs: an Image whose load the test lands (or fails) by hand, Blob, URL (object URLs counted), a manual rAF queue, the
// camera's k; the canvases are wk-dom's (recording 2D contexts). Only strings / numbers / booleans go into assert.
const eq1 = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
function tierRig(o = {}) {
  const d = fresh(), win = d.defaultView;
  win.devicePixelRatio = o.dpr || 2;
  const world = d.createElement('div'), root = d.createElement('div'), deco = d.createElement('div'), svg = d.createElementNS('http://www.w3.org/2000/svg', 'svg');
  world.setAttribute('data-cv-world', ''); deco.className = 'hw-decor';
  deco.append(svg); root.append(deco); world.append(root); d.body.append(world);
  const R = { k: o.k == null ? 1 : o.k, imgs: [], urls: new Set(), made: 0, rq: [] };
  class Img { constructor() { this.onload = null; this.onerror = null; R.imgs.push(this); } set src(u) { this._src = u; } get src() { return this._src; } }
  class Bl { constructor(parts, opt) { this.text = parts.join(''); this.type = opt && opt.type; } }
  const URLs = { createObjectURL: b => { const u = 'blob:' + (++R.made); R.urls.add(u); R.blob = b; return u; }, revokeObjectURL: u => R.urls.delete(u) };
  const env = { win, doc: d, scale: () => R.k, raf: f => R.rq.push(f), Image: o.noImage ? null : Img, Blob: Bl, URL: URLs };
  if (o.noImage) win.Image = null;
  const T = P.faceTier(deco, svg, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"></svg>', 400, 200, env);
  const frame = () => { const q = R.rq.splice(0); for (const f of q) f(); };
  const land = (good = true) => { const i = R.imgs.at(-1); if (good) i.onload(); else i.onerror(); };
  const bm = () => deco.childNodes.filter(n => n.localName === 'canvas');
  const st = () => ({ svg: svg.style.visibility || 'visible', n: bm().length, w: T.canvas ? T.canvas.width : 0, h: T.canvas ? T.canvas.height : 0, shown: T.shown });
  return { d, win, deco, svg, root, world, R, T, frame, land, bm, st };
}
const NONE = { svg: 'visible', n: 0, w: 0, h: 0, shown: false };
test('1g faceTier: k < 1 at a zoom end → the face drawn on a canvas at w·dpr·k device px (filtered down from a finer vector raster), the SVG hidden; the old picture stays until the load lands; k ≥ 1 → the SVG again, the canvas gone', () => {
  const g = tierRig({ k: 0.5 });
  eq1(g.st(), NONE, 'nothing until the next frame');
  g.frame();
  eq1([g.R.imgs.length, g.R.blob.type, g.R.blob.text.startsWith('<svg'), g.R.urls.size], [1, 'image/svg+xml', true, 1], 'the markup loads as an image from a Blob URL');
  eq1(g.st().svg, 'visible', 'the SVG shows while it loads');
  g.land();
  eq1(g.st(), { svg: 'hidden', n: 1, w: 400, h: 200, shown: true }, 'dpr 2 × k 0.5 × 400 × 200: the canvas shows, the SVG hidden');
  const cv = g.T.canvas, ctx = cv.getContext('2d');
  eq1([cv.className, cv.style.width, cv.style.height, cv.getAttribute('aria-hidden'), g.R.urls.size, g.T.k], ['hw-bm', '400px', '200px', 'true', 0, 1], 'the same box (CSS w × h), the URL revoked');
  eq1([ctx.imageSmoothingEnabled, ctx.imageSmoothingQuality], [true, 'high']);
  const di = ctx.calls.filter(c => c[0] === 'drawImage');
  eq1([di.length, di[0][1].localName, di[0][1].width, di[0][1].height, di[0].slice(2)], [1, 'canvas', 0, 0, [0, 0, 400, 200]], 'drawn from a finer raster (released after) scaled down to the device size');
  const fine = di[0][1].getContext('2d').calls.filter(c => c[0] === 'drawImage');
  eq1([fine.length, fine[0][1] === g.R.imgs[0], fine[0].slice(2)], [1, true, [0, 0, 800, 400]], 'the vector raster at 2 × the target (= native at dpr 2)');
  g.T.refresh(); eq1(g.R.imgs.length, 1, 'the same zoom again: nothing to do');
  // a zoom end at 25 %: the 50 % picture stays until the new one lands
  g.R.k = 0.25; g.T.refresh();
  eq1([g.R.imgs.length, g.st().svg, g.st().w], [2, 'hidden', 400], 'the previous bitmap stays meanwhile');
  g.land();
  eq1([g.st().w, g.st().h, g.bm().length, g.T.canvas === cv], [200, 100, 1, true], 'redrawn in place at 25 %');
  // two zoom ends before a load lands: only the last one paints
  g.R.k = 0.8; g.T.refresh(); g.R.k = 0.6; g.T.refresh();
  g.R.imgs.at(-2).onload(); eq1(g.st().w, 200, 'a superseded load paints nothing');
  g.land(); eq1([g.st().w, g.st().h], [480, 240], 'the last one');
  // back to 100 %: the SVG, no canvas (its store released)
  g.R.k = 1; g.T.refresh();
  eq1(g.st(), NONE, 'k ≥ 1: the vector face again');
  eq1([cv.width, cv.height], [0, 0], 'released');
  // a load still in flight when k ≥ 1 arrives: discarded
  g.R.k = 0.5; g.T.refresh(); g.R.k = 1.5; g.T.refresh(); g.land();
  eq1(g.st().n, 0, 'k 1.5: the late load is dropped');
  // dpr 1 at 75 %: a finer raster at native (dpr 1 · 1), drawn down to 300 × 150
  const h = tierRig({ k: 0.75, dpr: 1 }); h.frame(); h.land();
  const d2 = h.T.canvas.getContext('2d').calls.filter(c => c[0] === 'drawImage');
  eq1([h.st().w, h.st().h, d2[0][1].localName], [300, 150, 'canvas']);
  // at 90 % (dpr 2): a finer raster would be < 1.25 × the target: the vector drawn straight at the device size
  const q = tierRig({ k: 0.9 }); q.frame(); q.land();
  const d3 = q.T.canvas.getContext('2d').calls.filter(c => c[0] === 'drawImage');
  eq1([q.st().w, q.st().h, d3[0][1] === q.R.imgs[0]], [720, 360, true]);
});
test('1g faceTier: a zoom end reaches it through wk.onRescale (no main.js change); a release (an unmounted body) shows the SVG and re-tries next frame while mounted; not while hidden at home; destroy; a failed decode keeps the SVG for good', () => {
  const g = tierRig({ k: 0.5 });
  g.frame(); g.land();
  eq1(g.st().shown, true);
  g.R.k = 0.25; wk.rescaleCanvases(g.world);
  eq1(g.R.imgs.length, 2, 'the zoom end (wk.rescaleCanvases of the world) refreshed it');
  g.land(); eq1(g.st().w, 200);
  wk.releaseCanvases(g.T.canvas);
  eq1(g.st(), NONE, 'released: the SVG');
  g.frame(); g.land();
  eq1([g.st().shown, g.st().w], [true, 200], 'still mounted: re-made next frame');
  g.root.setAttribute('hidden', ''); wk.releaseCanvases(g.T.canvas); g.frame();
  eq1([g.st().shown, g.R.imgs.length], [false, 3], 'at home (a hidden ancestor): nothing made');
  g.root.removeAttribute('hidden');
  g.root.remove(); g.T.refresh(); eq1(g.R.imgs.length, 3, 'detached: nothing');
  g.world.append(g.root);
  g.T.refresh(); g.land(); eq1(g.st().shown, true);
  const cv = g.T.canvas;
  g.T.destroy();
  eq1([cv.width, g.st().n, g.st().svg], [0, 0, 'visible'], 'destroy: released, the SVG');
  g.R.k = 0.5; wk.rescaleCanvases(g.world); eq1(g.R.imgs.length, 4, 'its rescale hook off');
  const warn = console.warn; let warned = 0; console.warn = () => warned++;
  try {
    const f = tierRig({ k: 0.5 });
    f.frame(); f.land(false);
    eq1([f.st(), f.T.failed, warned], [NONE, true, 1], 'decode failed: the SVG kept, one warning');
    f.R.k = 0.25; f.T.refresh(); eq1(f.R.imgs.length, 1, 'never re-tried');
    const n = tierRig({ k: 0.5, noImage: true }); n.frame();
    eq1([n.T.failed, n.st().svg, warned], [true, 'visible', 2], 'no Image (a stub DOM): the SVG kept');
    const z = tierRig({ k: 1 }); z.frame(); eq1([z.R.imgs.length, z.st().svg], [0, 'visible'], 'at 100 %: nothing loads');
  } finally { console.warn = warn; }
});
test('1h: render() registers a parsed face with cv-face (the Face stands as `tier`: mode, shown; api.tier as the env; false → none): on the 2D path the 1g tier under it, data-cv-face on the module, moduleOf / offset (a stub DOM: 0, BAR_H), the data-tip tap under a shown face, destroy', () => {
  const doc = fresh(), win = doc.defaultView, model = modelOf('tb303');
  const mkEl = doc.createElement.bind(doc);
  doc.createElement = tag => { // (the stub DOM parses no innerHTML: a .hw-decor gets its SVG root from the markup string)
    const el = mkEl(tag);
    if (tag === 'div') Object.defineProperty(el, 'innerHTML', { set(v) { if (/^<svg/.test(String(v))) { el.textContent = ''; el.append(doc.createElementNS('http://www.w3.org/2000/svg', 'svg')); } }, get() { return ''; }, configurable: true });
    return el;
  };
  const world = mkEl('div'), mod = mkEl('div'), body = mkEl('div'), root = mkEl('div');
  world.setAttribute('data-cv-world', ''); mod.setAttribute('data-cv-mod', 'i1'); body.className = 'cv-body';
  body.append(root); mod.append(body); world.append(mod); doc.body.append(world);
  const R = { k: 1, imgs: [], rq: [] };
  class Img { constructor() { this.onload = null; this.onerror = null; R.imgs.push(this); } set src(u) { this._src = u; } get src() { return this._src; } }
  class Bl { constructor(parts, opt) { this.text = parts.join(''); this.type = opt && opt.type; } }
  const env = { win, doc, scale: () => R.k, raf: f => R.rq.push(f), Image: Img, Blob: Bl, URL: { createObjectURL: () => 'blob:1', revokeObjectURL: () => {} } };
  const api = Object.assign(fakeApi(model, doc), { tier: env });
  const r = P.render(root, TB_FX, model, api), F = r.tier;
  assert.ok(F && typeof F.refresh === 'function' && typeof F.destroy === 'function', 'a Face');
  eq1([F.mode, F.shown, !!F.tier, mod.getAttribute('data-cv-face')], ['dom', false, true, 'dom'], 'the 2D path at 100 %: the tier under it shows the SVG (shown false); mode = data-cv-face = dom');
  const deco = root.childNodes.find(n => n.className === 'hw-decor');
  assert.ok(deco.childNodes.some(n => n.localName === 'canvas' && n.className === 'hw-rel'), 'the unmount sentinel in the deco');
  // 50 %: the tier's bitmap → shown; a tap on the deco hit-tests the SVG for that point (elementFromPoint) and tips
  R.k = 0.5; wk.rescaleCanvases(world); R.imgs.at(-1).onload();
  eq1([F.mode, F.shown, deco.childNodes.filter(n => n.className === 'hw-bm').length], ['dom', true, 1]);
  const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g'); g.setAttribute('data-tip', 'CUTOFF — not emulated'); deco.childNodes[0].append(g);
  doc.elementFromPoint = () => g;
  const seen = [];
  deco.addEventListener('click', e => seen.push(e.target === deco), true);
  fire(deco, 'click', { clientX: 10, clientY: 10 });
  eq1([seen.length, api.state.tips.at(-1), deco.childNodes[0].style.visibility], [1, 'CUTOFF — not emulated', 'hidden'], 'the tip through the hidden SVG, the SVG hidden again after');
  r.destroy();
  eq1([mod.getAttribute('data-cv-face'), deco.childNodes.filter(n => n.localName === 'canvas').length, deco.childNodes[0].style.visibility || 'visible'], [null, 0, 'visible'], 'destroy: the attribute, the bitmap and the sentinel gone');
  // api.tier === false: no registration
  const r2 = P.render(mkEl('div'), TB_FX, model, Object.assign(fakeApi(model, doc), { tier: false }));
  eq1(r2.tier, null);
});
test('1g: the face SVG is self-contained (every fill / stroke / font / text-rendering an attribute: it draws the same as an image); render() without a parsed face (a stub DOM) has no tier', () => {
  for (const id of authored) {
    const s = P.decorSvg(P.layoutOf(id), modelOf(id));
    assert.ok(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="hw-svg" [^>]*font-family="[^"]+" text-rendering="geometricPrecision">/.test(s), id + ': the root carries its font and text rendering');
    assert.ok(!/currentColor|var\(--|<style|<image|<foreignObject/.test(s), id + ': nothing from CSS, nothing external');
    assert.ok(!/<text(?![^>]*\sfill=)[^>]*>/.test(s), id + ': every text has its fill');
  }
});
