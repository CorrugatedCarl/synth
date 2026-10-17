// sx-ui-mix.js (U3; SPEC-serum2 §13.4, §11.14, §15.12) — the MIX page on the stub binding kit
// (tests/serum-ui-stubs/kit.js) and the wk-dom fake DOM: importable without a DOM, the pure helpers channelStrips /
// routeMenuItems, every strip bound to its destinations, collapsed strips, routing (incl. loop resolution), ENV toggles,
// faders with snapshot meters, bus FX bypass, module labels (the kit's drag handles), the filter mini display.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { redirect } from './serum-ui.hooks.mjs';

if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({ resolve: (spec, ctx, next) => redirect(spec, ctx.parentURL) || next(spec, ctx) });
} else nodeModule.register('./serum-ui.hooks.mjs', import.meta.url);

// imported before any DOM exists: no document / window access at module top level
const mix = await import('../sx-ui-mix.js?v=9');
const core = await import('../serum-core.js?v=9');
const { makeKit, stubOf } = await import('./serum-ui-stubs/kit.js');
const dom = await import('./wk-dom.mjs');
const { all, byCls, one, byAttr, fire, ptr, place } = dom;

const fresh = () => core.normalizeSerum(core.defaultSerum());
const destsIn = root => new Set(all(root).map(n => n.getAttribute && n.getAttribute('data-dest')).filter(Boolean));
const KEYS = ['a', 'b', 'c', 'sub', 'noise', 'f1', 'f2', 'bus1', 'bus2', 'main', 'direct'];
function mount(over) {
  const O = over || {}, doc = dom.fresh(), s = O.s || fresh(), fx = O.fx === undefined ? core.defaultFx2() : O.fx;
  const kit = makeKit({ doc, s, fx, host: O.host });
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const page = new mix.MixerPage(root, kit);
  const T = stubOf(kit);
  T.paint();
  return { doc, s, fx, kit, T, root, page, strip: k => page.strips.find(x => x.T.key === k) };
}
const menuLabels = d => byCls(byCls(d.body, 'wk-ctx').at(-1), 'wk-cl').map(n => n.textContent);
const optionLabels = d => byAttr(d.body, 'role', 'option').map(n => n.textContent);
function choose(doc, menuEl, label) {
  fire(one(menuEl, 'wk-mbtn'), 'click');
  const o = byAttr(doc.body, 'role', 'option').find(n => n.textContent === label);
  assert.ok(o, 'option ' + label + ' in ' + JSON.stringify(optionLabels(doc)));
  fire(o, 'click');
}

test('imports in node without a DOM; exports (§11.14)', () => {
  assert.deepEqual(Object.keys(mix).sort(), ['MixerPage', 'channelStrips', 'routeMenuItems']);
  for (const k of Object.keys(mix)) assert.equal(typeof mix[k], 'function', k);
});

test('channelStrips: order, destinations, routing rules, S1 filter type, bus routes and bypass', () => {
  const s = fresh(), fx = core.defaultFx2();
  let S = mix.channelStrips(s, fx);
  assert.deepEqual(S.map(x => x.key), KEYS);
  assert.deepEqual(S.map(x => x.meter), [0, 1, 2, 4, 3, 5, 6, 7, 8, 9, 10]);               // snapshot `mix` order A B C N S F1 F2 …
  const A = S[0];
  assert.deepEqual([A.power, A.level, A.pan, A.fbal, A.bus, A.module], ['a.on', 'a.level', 'a.pan', 'a.fbal', ['a.bus1', 'a.bus2'], 'oscA']);
  // defaults: A → Filter (balance shown), B / C / SUB / NOISE / filters → Main (ENV shown)
  assert.deepEqual(S.slice(0, 7).map(x => [x.route, x.routeLabel, x.showBal, x.showEnv]), [[0, 'Filter', true, false], [1, 'Main', false, true],
    [1, 'Main', false, true], [1, 'Main', false, true], [1, 'Main', false, true], [1, 'Main', false, true], [1, 'Main', false, true]]);
  assert.deepEqual(S.slice(0, 7).map(x => x.collapsed), [false, true, true, true, true, true, true]);
  const F1 = S[5], F2 = S[6];
  assert.deepEqual([F1.type, F1.mix, F1.cutoff, F1.res, F1.level, F2.type, F2.module], ['f.type2', 'f.mix', 'f.cutoff', 'f.res', 'f.level', 'f2.type', 'filter2']);
  assert.deepEqual(S.slice(7).map(x => [x.level, x.rack, x.byp]), [['g.bus1v', 1, 0], ['g.bus2v', 2, 0], ['g.master', 0, 0], ['g.direct', -1, 0]]);
  // routes, ENV, S1 mode, bus routes and rack bypass
  s.osc[1].route = 2; s.osc[1].env = 0; s.noise.route = 3; s.filter[0].route = 0; s.global.s1 = 1; s.p['b.on'] = 1;
  fx.racks[1].route = 2; fx.racks[2].byp = 1; fx.racks[0].byp = 1;
  S = mix.channelStrips(s, fx);
  assert.deepEqual([S[1].routeLabel, S[1].env, S[1].showEnv, S[1].collapsed], ['Direct', 0, true, false]);
  assert.deepEqual([S[4].routeLabel, S[4].showEnv, S[4].showBal], ['None', false, false]);
  assert.deepEqual([S[5].routeLabel, S[5].type, S[5].showEnv], ['Filter 2', 'f.type', false]);
  assert.deepEqual([S[7].route, S[7].routeLabel, S[8].byp, S[9].byp], [2, 'Bus 2', 1, 1]);
  // a v1 FX state: no buses
  const V = mix.channelStrips(s, { v: 1, p: {} });
  assert.deepEqual([V[7].route, V[7].fxV2, V[9].byp], [0, false, 0]);
});

test('routeMenuItems: sources, filters (the other filter), buses (the other bus), none for MAIN / DIRECT', () => {
  const s = fresh(), fx = core.defaultFx2();
  assert.deepEqual(mix.routeMenuItems(s, 'a'), [{ v: 0, label: 'Filter', checked: true }, { v: 1, label: 'Main', checked: false },
    { v: 2, label: 'Direct', checked: false }, { v: 3, label: 'None', checked: false }]);
  assert.deepEqual(mix.routeMenuItems(s, 'f1').map(x => x.label), ['Filter 2', 'Main', 'Direct', 'None']);
  assert.deepEqual(mix.routeMenuItems(s, 'f2').map(x => x.label), ['Filter 1', 'Main', 'Direct', 'None']);
  assert.deepEqual(mix.routeMenuItems(s, 'f2').find(x => x.checked).label, 'Main');
  fx.racks[2].route = 1;
  assert.deepEqual(mix.routeMenuItems(s, 'bus2', fx), [{ v: 0, label: 'Main', checked: false }, { v: 1, label: 'Direct', checked: true },
    { v: 2, label: 'Bus 1', checked: false }]);
  assert.deepEqual(mix.routeMenuItems(s, 'bus1', fx).map(x => x.label), ['Main', 'Direct', 'Bus 2']);
  assert.deepEqual(mix.routeMenuItems(s, 'main'), []);
  assert.deepEqual(mix.routeMenuItems(s, 'direct'), []);
  assert.deepEqual(mix.routeMenuItems(s, 'zzz'), []);
});

test('MixerPage: strips in order, every strip control bound to its destination, channel colours', () => {
  const { root, page, strip } = mount();
  assert.equal(page.el.parentNode, root);
  assert.deepEqual(byAttr(root, 'data-strip', 'a').length, 1);
  assert.deepEqual(all(root).filter(n => n.getAttribute && n.getAttribute('data-strip')).map(n => n.getAttribute('data-strip')), KEYS);
  const want = [];
  for (const p of ['a', 'b', 'c', 's', 'n']) for (const x of ['on', 'level', 'pan', 'fbal', 'bus1', 'bus2']) want.push(p + '.' + x);
  for (const p of ['f', 'f2']) for (const x of ['on', 'level', 'pan', 'mix', 'bus1', 'bus2', 'cutoff']) want.push(p + '.' + x);
  want.push('f.type', 'f.type2', 'f2.type', 'g.bus1v', 'g.bus2v', 'g.master', 'g.direct');
  const seen = destsIn(root);
  assert.deepEqual(want.filter(id => !seen.has(id)), []);
  for (const id of seen) assert.ok(core.DEST_INDEX[id] !== undefined, id);
  assert.equal(strip('a').el.style['--sxm-c'], 'var(--sx-osc-a)');
  assert.equal(strip('bus2').el.style['--sxm-c'], 'var(--sx-bus2)');
  // module power buttons carry the module (lock / copy menus of the panel shell)
  assert.equal(byAttr(strip('c').el, 'data-dest', 'c.on')[0].getAttribute('data-module'), 'oscC');
  assert.equal(byAttr(strip('f2').el, 'data-dest', 'f2.on')[0].getAttribute('data-module'), 'filter2');
});

test('MixerPage: switched-off modules collapse; a tap on the strip switches the module on everywhere', () => {
  const { s, T, strip } = mount();
  assert.ok(strip('c').el.classList.contains('sxm-off'));
  assert.ok(!strip('a').el.classList.contains('sxm-off'));
  fire(strip('c').name, 'click');
  assert.equal(s.p['c.on'], 1);
  assert.deepEqual(T.log.at(-1), ['setN', 'c.on', 1, 'set']);
  T.paint();
  assert.ok(!strip('c').el.classList.contains('sxm-off'));
  // a tap on an open strip changes nothing
  const n = T.log.length;
  fire(strip('c').name, 'click');
  assert.equal(T.log.length, n);
});

test('MixerPage: route menus edit route; balance vs ENV follow the route; filter and bus loops resolve to Main', () => {
  const { doc, s, fx, T, strip } = mount();
  const route = k => one(strip(k).el, 'sxm-route');
  const hidden = (k, id) => byAttr(strip(k).el, 'data-dest', id)[0].classList.contains('sxm-hide');
  assert.ok(!hidden('a', 'a.fbal'));
  choose(doc, route('a'), 'Direct');
  assert.equal(s.osc[0].route, 2);
  assert.deepEqual(T.log.at(-1), ['edit', 'OSC A route', undefined, false]);
  T.paint();
  assert.ok(hidden('a', 'a.fbal'));
  assert.ok(!one(strip('a').el, 'sxm-env').classList.contains('sxm-hide'));
  // ENV toggle
  fire(one(strip('a').el, 'sxm-env'), 'click');
  assert.equal(s.osc[0].env, 0);
  assert.deepEqual(T.log.at(-1), ['edit', 'OSC A ENV 1', undefined, false]);
  choose(doc, route('noise'), 'None');
  assert.equal(s.noise.route, 3);
  // F1 → Filter 2 while F2 → Filter 1: the other one goes to Main
  choose(doc, route('f2'), 'Filter 1');
  assert.deepEqual(s.filter.map(f => f.route), [1, 0]);
  choose(doc, route('f1'), 'Filter 2');
  assert.deepEqual(s.filter.map(f => f.route), [0, 1]);
  // buses: FX-state routes (editFx); both into each other → the other goes to Main
  choose(doc, route('bus1'), 'Bus 2');
  assert.equal(fx.racks[1].route, 2);
  assert.deepEqual(T.log.at(-1), ['editFx', 'BUS 1 route', undefined, false]);
  choose(doc, route('bus2'), 'Bus 1');
  assert.deepEqual([fx.racks[1].route, fx.racks[2].route], [0, 2]);
  choose(doc, route('bus2'), 'Direct');
  assert.equal(fx.racks[2].route, 1);
});

test('MixerPage: faders bind the level destinations; meters follow the snapshot `mix` by channel', () => {
  const { s, T, strip } = mount();
  const fader = k => one(strip(k).el, 'wk-fader');
  assert.equal(fader('a').getAttribute('data-dest'), 'a.level');
  assert.equal(fader('sub').getAttribute('data-dest'), 's.level');
  assert.equal(fader('main').getAttribute('data-dest'), 'g.master');
  assert.equal(fader('direct').getAttribute('data-dest'), 'g.direct');
  assert.equal(one(fader('bus1'), 'wk-num').textContent, '0.0 dB');
  assert.equal(one(fader('a'), 'wk-num').textContent, '75%');
  const f = fader('direct');
  f.focus();
  dom.key(f, 'ArrowUp');
  assert.equal(s.p['g.direct'], 0.51);
  assert.deepEqual(T.log.at(-1), ['setN', 'g.direct', 0.51, 'set']);
  // snapshot mix: A B C N S F1 F2 Bus1 Bus2 Main Direct (dBFS)
  T.setSnap({ mix: Float32Array.from([-6, -12, -60, -3, -20, -1, -Infinity, -24, -30, -2, -50]) });
  const lv = k => fader(k).wk.meter && one(fader(k), 'wk-meter').wk.levels()[0];
  assert.deepEqual(['a', 'b', 'noise', 'sub', 'f1', 'bus1', 'main', 'direct'].map(lv), [-6, -12, -3, -20, -1, -24, -2, -50]);
  T.setSnap(null);
  assert.equal(lv('a'), -Infinity);
  // a hidden MIX page paints nothing (kit.live(fn) gets shown = false); the next frame on screen catches up
  T.shown = false;
  T.setSnap({ mix: Float32Array.from([-9, -9, -9, -9, -9, -9, -9, -9, -9, -9, -9]) });
  assert.equal(lv('a'), -Infinity);
  T.shown = true;
  T.paint();
  assert.equal(lv('a'), -9);
});

test('MixerPage: bus / main FX bypass (red) edits racks[k].byp; Alt-click switches every module of that rack; v1 FX disables it', () => {
  const fx = core.defaultFx2();
  const eq = { id: 'eq', type: 'eq', v: 2, byp: 0, p: { on: 1 }, sub: {}, ph: 0, ui: { lvl: 0, lvl2: 0 } };
  const sp = { id: 'split2', type: 'split2', v: 2, byp: 0, p: { on: 1 }, sub: {}, ph: 0, ui: { lvl: 0, lvl2: 0 },
    br: [[{ id: 'dly', type: 'dly', v: 2, byp: 0, p: { on: 1 }, sub: {}, ph: 0, ui: { lvl: 0, lvl2: 0 } }], []], bb: [0, 0] };
  fx.racks[1].mods = [eq, sp];
  const { T, strip } = mount({ fx });
  const byp = k => one(strip(k).el, 'sxm-byp');
  fire(byp('bus1'), 'click');
  assert.equal(fx.racks[1].byp, 1);
  assert.deepEqual(T.log.at(-1), ['editFx', 'BUS 1 FX bypass', undefined, false]);
  T.paint();
  assert.equal(byp('bus1').getAttribute('aria-pressed'), 'true');
  fire(byp('main'), 'click');
  assert.equal(fx.racks[0].byp, 1);
  assert.equal(one(strip('direct').el, 'sxm-byp'), null);
  // Alt-click: every module of BUS 1 (top level and branches) off, then on again
  fire(byp('bus1'), 'click', { altKey: true });
  assert.deepEqual([eq.p.on, sp.p.on, sp.br[0][0].p.on, fx.racks[1].byp], [0, 0, 0, 1]);
  fire(byp('bus1'), 'click', { altKey: true });
  assert.deepEqual([eq.p.on, sp.p.on, sp.br[0][0].p.on], [1, 1, 1]);
  // a v1 FX state: the bypass buttons are disabled and the bus routes inert
  const v = mount({ fx: { v: 1, p: {} } });
  v.T.paint();
  assert.ok(one(v.strip('bus1').el, 'sxm-byp').classList.contains('wk-dis'));
  fire(one(v.strip('bus1').el, 'sxm-byp'), 'click');
  assert.equal(v.T.log.some(e => e[0] === 'editFx'), false);
  fire(one(v.strip('bus1').el, 'sxm-byp'), 'click', { altKey: true });                   // Alt-click: a notice, no edit
  assert.equal(v.T.log.some(e => e[0] === 'editFx'), false);
  assert.match(v.T.log.at(-1)[1], /Serum 2 FX rack/);
  assert.ok(one(v.strip('bus1').el, 'sxm-route').classList.contains('wk-dis'));
});

test('MixerPage: module labels are the kit\'s drag handles (data-modlabel); the mixer adds no drag of its own (no double swap)', () => {
  const s = fresh();
  s.p['a.level'] = 0.3; s.p['b.level'] = 0.9; s.p['b.on'] = 1;
  const { T, strip } = mount({ s });
  // kit.panel makes the name the module menu and the swap / copy drag handle (serum-ui moduleDrag, §13.3, §13.4)
  assert.deepEqual(['a', 'b', 'c', 'sub', 'noise', 'f1', 'f2'].map(k => strip(k).name.getAttribute('data-modlabel')),
    ['oscA', 'oscB', 'oscC', 'sub', 'noise', 'filter', 'filter2']);
  assert.deepEqual(['bus1', 'bus2', 'main', 'direct'].map(k => strip(k).name), [null, null, null, null]);
  // a label dragged onto another strip: nothing from the mixer itself (the stub kit's panel has no drag; the real one
  // swaps once)
  KEYS.forEach((k, i) => place(strip(k).el, i * 80, 0, 76, 300));
  const n = strip('a').name, r = strip('b').el.getBoundingClientRect(), before = T.log.length;
  ptr(n, 'pointerdown', 5, 10);
  ptr(n, 'pointermove', r.left + 30, 20);
  ptr(n, 'pointerup', r.left + 30, 20);
  assert.equal(T.log.length, before);
  assert.deepEqual([s.p['a.level'], s.p['b.level']], [0.3, 0.9]);
});

test('MixerPage: filter strips — S1 / S2 type menus, the mini display draws through SerumDSP and its drag sets cutoff / res', () => {
  const s = fresh();
  s.p['f.on'] = 1;
  const calls = [];
  globalThis.SerumDSP = { filterImpulse: (t, fc, res, dr, v, fs, len) => { calls.push([t, fc, fs, len]); const r = new Float64Array(len); r[0] = 1; return r; } };
  try {
    const { T, strip } = mount({ s });
    const F1 = strip('f1').el, menus = byCls(F1, 'sxm-type');
    assert.deepEqual(menus.map(m => m.getAttribute('data-dest')), ['f.type', 'f.type2']);
    assert.deepEqual(menus.map(m => m.classList.contains('sxm-hide')), [true, false]);   // S2 mode: f.type2 (108 types)
    s.global.s1 = 1;
    T.paint();
    assert.deepEqual(menus.map(m => m.classList.contains('sxm-hide')), [false, true]);
    assert.ok(calls.length >= 1);
    assert.equal(calls[0][2], 48000);
    // relative drag (no jump on the press): x along the display's 20 Hz–20 kHz log axis, y = resonance over the height
    const cv = one(F1, 'sxm-fdisp');
    place(cv, 0, 0, 60, 44);
    const hz0 = core.lawValue('f.cutoff', s.p['f.cutoff']), res0 = s.p['f.res'];
    ptr(cv, 'pointerdown', 10, 40);
    ptr(cv, 'pointermove', 11, 40);                                                      // < 3 px: nothing yet
    assert.equal(T.log.some(e => e[1] === 'FILTER 1 cutoff / res'), false);
    ptr(cv, 'pointermove', 30, 11);
    ptr(cv, 'pointerup', 30, 11);
    const hz = 20 * Math.pow(1000, Math.log(hz0 / 20) / Math.log(1000) + 20 / 60);
    assert.ok(Math.abs(core.lawValue('f.cutoff', s.p['f.cutoff']) - hz) < 1e-6 * hz, 'cutoff ' + core.lawValue('f.cutoff', s.p['f.cutoff']) + ' ≠ ' + hz);
    assert.ok(Math.abs(s.p['f.res'] - (res0 + 29 / 44)) < 1e-9);
    assert.deepEqual(T.log.slice(-3).map(e => [e[1], e[2]]), [['FILTER 1 cutoff / res', 'start'], ['FILTER 1 cutoff / res', 'move'], ['FILTER 1 cutoff / res', 'end']]);
    assert.equal(cv.getAttribute('data-dest'), 'f.cutoff');
  } finally { delete globalThis.SerumDSP; }
});

test('MixerPage, two-finger rollback (gesture.js\'s pointercancel flagged e.gesture === "two-finger"): the filter display drag and a fader (its jump too) come back; a plain cancel keeps', () => {
  const s = fresh();
  s.p['f.on'] = 1;
  const { T, kit, strip } = mount({ s });
  const TW = { pointerType: 'touch', pointerId: 6 }, TWO = { pointerType: 'touch', pointerId: 6, gesture: 'two-finger' };
  const cv = one(strip('f1').el, 'sxm-fdisp');
  place(cv, 0, 0, 60, 44);
  const c0 = kit.getN('f.cutoff'), r0 = kit.getN('f.res');
  ptr(cv, 'pointerdown', 10, 40, TW); ptr(cv, 'pointermove', 30, 11, TW);
  assert.notEqual(kit.getN('f.res'), r0);
  ptr(cv, 'pointercancel', 30, 11, TWO);
  assert.deepEqual([kit.getN('f.cutoff'), kit.getN('f.res')], [c0, r0]);
  assert.deepEqual(T.log.at(-1).slice(1, 3), ['FILTER 1 cutoff / res', 'end']);
  ptr(cv, 'pointerdown', 10, 40, TW); ptr(cv, 'pointermove', 30, 11, TW); ptr(cv, 'pointercancel', 30, 11, TW);
  assert.notEqual(kit.getN('f.res'), r0, 'plain cancel keeps');
  // a fader (wk sliderCore): the press jumps it — the value from before comes back through the kit
  const fd = one(strip('a').el, 'wk-fader'), id = fd.getAttribute('data-dest'), n0 = kit.getN(id);
  place(one(fd, 'wk-slt'), 0, 0, 10, 100);
  ptr(fd, 'pointerdown', 5, 95, TW);
  assert.notEqual(kit.getN(id), n0);
  ptr(fd, 'pointercancel', 5, 95, TWO);
  assert.deepEqual([kit.getN(id), T.held.size], [n0, 0]);
});

test('MixerPage: destroy removes the page; idempotent', () => {
  const { root, page } = mount();
  page.destroy();
  page.destroy();
  assert.equal(page.el.parentNode, null);
  assert.equal(root.children.length, 0);
});

/* ------------------------------------------------------------------ review fixes */

test('MixerPage: the SUB fader scale follows the mode — S2 n² (−6 dB at n 0.708), S1 n (−6 dB at n 0.501)', () => {
  const { s, T, strip } = mount();
  const faders = byCls(strip('sub').el, 'wk-fader');
  assert.equal(faders.length, 2);
  assert.deepEqual(faders.map(f => f.getAttribute('data-dest')), ['s.level', 's.level']);
  const shown = () => faders.filter(f => !f.classList.contains('sxm-hide'));
  const tick = (f, label) => parseFloat(byCls(f, 'wk-ftk').find(t => t.textContent === label).style.bottom) / 100;
  assert.equal(s.global.s1 ? 1 : 0, 0);                                                // new states: S2 mode
  assert.equal(shown().length, 1);
  const f2 = shown()[0];
  assert.ok(Math.abs(tick(f2, '-6') - Math.pow(10, -6 / 40)) < 1e-4, String(tick(f2, '-6')));
  assert.ok(Math.abs(tick(f2, '-24') - Math.pow(10, -24 / 40)) < 1e-4);
  s.global.s1 = 1;
  T.paint();
  assert.equal(shown().length, 1);
  assert.notEqual(shown()[0], f2);
  assert.ok(Math.abs(tick(shown()[0], '-6') - Math.pow(10, -6 / 20)) < 1e-4);
  // the other faders keep their laws (k.level pow2: −6 dB at n 0.708; the S1 flag changes nothing there)
  assert.equal(byCls(strip('a').el, 'wk-fader').length, 1);
  assert.ok(Math.abs(tick(one(strip('a').el, 'wk-fader'), '-6') - Math.pow(10, -6 / 40)) < 1e-4);
});

test('MixerPage: a v1 FX state — MAIN / bus controls convert it in place when the host keeps v2 states (host.v2Fx); otherwise disabled, and Alt-click switches the v1 Main modules', () => {
  const v1 = () => { const f = core.defaultFxV1(); f.p['fx.dly.on'] = 1; f.p['fx.dly.feed'] = 0.7; f.p['fx.rev.size'] = 0.9; return f; };
  // without the flag: disabled with their own notices; Alt-click on MAIN switches the v1 modules in the v1 state
  const a = mount({ fx: v1() });
  a.T.paint();
  const byp = (m, k) => one(m.strip(k).el, 'sxm-byp');
  assert.ok(byp(a, 'main').classList.contains('wk-dis'));
  assert.match(byp(a, 'main').title, /Main FX bypass needs the Serum 2 FX rack/);
  assert.match(byp(a, 'bus1').title, /FX buses need the Serum 2 FX rack/);
  fire(byp(a, 'main'), 'click', { altKey: true });
  assert.deepEqual([a.fx.v, a.fx.p['fx.dly.on'], a.fx.p['fx.rev.on']], [1, 0, 0]);        // the Main modules (Delay, Reverb) off
  assert.deepEqual(a.T.log.at(-1), ['editFx', 'Disable all MAIN modules', undefined, false]);
  fire(byp(a, 'main'), 'click', { altKey: true });
  assert.deepEqual([a.fx.v, a.fx.p['fx.dly.on'], a.fx.p['fx.rev.on']], [1, 1, 1]);
  // with the flag: the first bypass / route edit converts the state in place (migrateFx1 with the Serum state as refs)
  const s = fresh();
  s.matrix[0] = Object.assign({}, s.matrix[0], { src: 'lfo1', dst: 'fx.cmp.thr', amt: 0.5 });
  const b = mount({ s, fx: v1(), host: { v2Fx: () => true } });
  b.T.paint();
  assert.ok(!byp(b, 'main').classList.contains('wk-dis'));
  const obj = b.fx;
  fire(byp(b, 'main'), 'click');
  assert.equal(b.fx, obj);
  assert.equal(b.fx.v, 2);
  assert.equal(b.fx.racks[0].byp, 1);
  assert.deepEqual(b.fx.racks[0].mods.map(I => I.id), ['dly', 'cmp', 'rev']);          // the referenced compressor stays
  assert.deepEqual(b.T.log.at(-1), ['editFx', 'Main FX bypass', undefined, false]);
  const c = mount({ fx: v1(), host: { v2Fx: true } });
  choose(c.doc, one(c.strip('bus2').el, 'sxm-route'), 'Direct');
  assert.deepEqual([c.fx.v, c.fx.racks[2].route], [2, 1]);
});

test('MixerPage: the filter mini display draws 4096 taps, passes X / Y / PZ corners for the new types, and its drag never moves the cutoff without horizontal travel', () => {
  const s = fresh();
  s.p['f.on'] = 1;
  const calls = [];
  globalThis.SerumDSP = { filterImpulse: (...a) => { calls.push(a); const r = new Float64Array(a[6]); r[0] = 1; return r; } };
  try {
    const pzSvf = core.FILTERS.findIndex(f => f.name === 'PZ SVF');
    assert.ok(pzSvf >= 96);
    s.p['f.type2'] = pzSvf / 107; s.p['f.x'] = 0.25; s.p['f.y'] = 0.75;
    const { T, strip } = mount({ s });
    let a = calls.find(x => x[0] === pzSvf);                                            // FILTER 1 (FILTER 2 draws its own type)
    assert.ok(a);
    assert.deepEqual([a[5], a[6], a[7], a[8]], [48000, 4096, 0.25, 0.75]);
    assert.deepEqual(a[9], [].concat(...s.filter[0].pz));
    // a corner edit redraws
    const n = calls.length;
    s.filter[0].pz[1][0] = 0.5;
    T.paint();
    assert.equal(calls.length, n + 1);
    assert.equal(calls.at(-1)[9][3], 0.5);
    // S1 mode (Phase-1 types): no X / Y / corners
    s.global.s1 = 1;
    T.paint();
    a = calls.at(-1);
    assert.deepEqual([a[6], a[7], a[8], a[9]], [4096, 0, 0, null]);
    // vertical-only drag at the cutoff law's ends: the cutoff stays exactly (the display axis ends at 20 Hz / 20 kHz)
    for (const c0 of [1, 0]) {
      s.p['f.cutoff'] = c0;
      const cv = one(strip('f1').el, 'sxm-fdisp');
      place(cv, 0, 0, 60, 44);
      ptr(cv, 'pointerdown', 30, 40); ptr(cv, 'pointermove', 30, 30); ptr(cv, 'pointermove', 30, 20); ptr(cv, 'pointerup', 30, 20);
      assert.equal(s.p['f.cutoff'], c0);
    }
  } finally { delete globalThis.SerumDSP; }
});

test('MixerPage: touch rules under (pointer: coarse) and .wk-touch', () => {
  const { doc } = mount();
  const css = doc.getElementById('sxm-css').textContent;
  assert.match(css, /@media \(pointer: coarse\) \{\n  \.sxm-strip \{ flex-basis: 88px; \}/);
  assert.match(css, /\.wk-touch \.sxm-strip \{ flex-basis: 88px; \}/);
  assert.match(css, /\.wk-touch \.sxm-env, \.wk-touch \.sxm-byp \{ min-height: 34px; \}/);
});
