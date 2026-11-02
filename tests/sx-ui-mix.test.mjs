// sx-ui-mix.js (U3; SPEC-serum2 §13.4, §11.14, §15.12) — the output strips on the stub binding kit (tests/serum-ui-stubs/kit.js) and
// the wk-dom fake DOM: importable without a DOM, the pure helpers channelStrips / routeMenuItems, every strip bound to its
// destinations, bus routes (incl. loop resolution), faders with snapshot meters, bus FX bypass, a v1 FX state converted in place.
// (SX0, lane K) The MIX page's own build and its source / filter strips left with the bundled panel: the cases that drove them through
// the MIX page drive OutputsPanel (the Amplifier face's outputs) where the strips are its own, and go where they were the MIX page's
// (IMPL-SX0 §14, K's table).
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
const OUTS = ['bus1', 'bus2', 'main', 'direct'];
// the output strips (OutputsPanel) on the stub kit
function mount(over) {
  const O = over || {}, doc = dom.fresh(), s = O.s || fresh(), fx = O.fx === undefined ? core.defaultFx2() : O.fx;
  const kit = makeKit({ doc, s, fx, host: O.host });
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const page = new mix.OutputsPanel(root, kit);
  const T = stubOf(kit);
  T.paint();
  return { doc, s, fx, kit, T, root, page, strip: k => page.strips.find(x => x.T.key === k) };
}
const optionLabels = d => byAttr(d.body, 'role', 'option').map(n => n.textContent);
function choose(doc, menuEl, label) {
  fire(one(menuEl, 'wk-mbtn'), 'click');
  const o = byAttr(doc.body, 'role', 'option').find(n => n.textContent === label);
  assert.ok(o, 'option ' + label + ' in ' + JSON.stringify(optionLabels(doc)));
  fire(o, 'click');
}

test('imports in node without a DOM; exports (§11.14)', () => {
  assert.deepEqual(Object.keys(mix).sort(), ['MixerPage', 'OutputsPanel', 'channelStrips', 'routeMenuItems']);
  for (const k of Object.keys(mix)) assert.equal(typeof mix[k], 'function', k);
});

test('(milestone 3) OutputsPanel: VOICE\'s outputs — the MIX page\'s BUS 1 / BUS 2 / MAIN / DIRECT strips alone, their faders, routes, FX bypass and meters', () => {
  const doc = dom.fresh(), s = fresh(), fx = core.defaultFx2(), kit = makeKit({ doc, s, fx });
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const O = new mix.OutputsPanel(root, kit), T = stubOf(kit);
  T.paint();
  assert.ok(O instanceof mix.MixerPage && O.el.parentNode === root);
  assert.deepEqual(O.strips.map(x => x.T.key), ['bus1', 'bus2', 'main', 'direct']);
  assert.deepEqual(byCls(O.el, 'wk-fader').map(f => f.getAttribute('data-dest')), ['g.bus1v', 'g.bus2v', 'g.master', 'g.direct']);
  assert.equal(byCls(O.el, 'sxm-route').length, 2);                               // the two bus routes
  assert.equal(byCls(O.el, 'sxm-byp').length, 3);                                 // BUS 1, BUS 2, MAIN
  fire(one(O.strips[0].el, 'sxm-byp'), 'click');
  assert.equal(fx.racks[1].byp, 1);
  assert.deepEqual(T.log.at(-1), ['editFx', 'BUS 1 FX bypass', undefined, false]);
  T.setSnap({ mix: Float32Array.from([-6, -12, -60, -3, -20, -1, -9, -24, -30, -2, -50]) });
  assert.deepEqual(O.strips.map(x => one(one(x.el, 'wk-fader'), 'wk-meter').wk.levels()[0]), [-24, -30, -2, -50]);
  O.destroy();
  assert.equal(O.el.parentNode, null);
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

test('the output strips in order, every strip control bound to its destination, channel colours; no strip name (no module behind an output)', () => {
  const { root, page, strip } = mount();
  assert.equal(page.el.parentNode, root);
  assert.deepEqual(byAttr(root, 'data-strip', 'bus1').length, 1);
  assert.deepEqual(all(root).filter(n => n.getAttribute && n.getAttribute('data-strip')).map(n => n.getAttribute('data-strip')), OUTS);
  const want = ['g.bus1v', 'g.bus2v', 'g.master', 'g.direct'];
  const seen = destsIn(root);
  assert.deepEqual(want.filter(id => !seen.has(id)), []);
  for (const id of seen) assert.ok(core.DEST_INDEX[id] !== undefined, id);
  assert.equal(strip('bus2').el.style['--sxm-c'], 'var(--sx-bus2)');
  assert.equal(strip('main').el.style['--sxm-c'], 'var(--sx-accent)');
  assert.deepEqual(OUTS.map(k => strip(k).name), [null, null, null, null]);
});

test('bus route menus edit the FX state\'s route (editFx); both buses into each other → the other one to Main', () => {
  const { doc, fx, T, strip } = mount();
  const route = k => one(strip(k).el, 'sxm-route');
  choose(doc, route('bus1'), 'Bus 2');
  assert.equal(fx.racks[1].route, 2);
  assert.deepEqual(T.log.at(-1), ['editFx', 'BUS 1 route', undefined, false]);
  choose(doc, route('bus2'), 'Bus 1');
  assert.deepEqual([fx.racks[1].route, fx.racks[2].route], [0, 2]);
  choose(doc, route('bus2'), 'Direct');
  assert.equal(fx.racks[2].route, 1);
});

test('faders bind the level destinations; meters follow the snapshot `mix` by channel', () => {
  const { s, T, strip } = mount();
  const fader = k => one(strip(k).el, 'wk-fader');
  assert.equal(fader('bus1').getAttribute('data-dest'), 'g.bus1v');
  assert.equal(fader('main').getAttribute('data-dest'), 'g.master');
  assert.equal(fader('direct').getAttribute('data-dest'), 'g.direct');
  assert.equal(one(fader('bus1'), 'wk-num').textContent, '0.0 dB');
  const f = fader('direct');
  f.focus();
  dom.key(f, 'ArrowUp');
  assert.equal(s.p['g.direct'], 0.51);
  assert.deepEqual(T.log.at(-1), ['setN', 'g.direct', 0.51, 'set']);
  // snapshot mix: A B C N S F1 F2 Bus1 Bus2 Main Direct (dBFS)
  T.setSnap({ mix: Float32Array.from([-6, -12, -60, -3, -20, -1, -Infinity, -24, -30, -2, -50]) });
  const lv = k => fader(k).wk.meter && one(fader(k), 'wk-meter').wk.levels()[0];
  assert.deepEqual(OUTS.map(lv), [-24, -30, -2, -50]);
  T.setSnap(null);
  assert.equal(lv('bus1'), -Infinity);
  // hidden strips paint nothing (kit.live(fn) gets shown = false); the next frame on screen catches up
  T.shown = false;
  T.setSnap({ mix: Float32Array.from([-9, -9, -9, -9, -9, -9, -9, -9, -9, -9, -9]) });
  assert.equal(lv('bus1'), -Infinity);
  T.shown = true;
  T.paint();
  assert.equal(lv('bus1'), -9);
});

test('bus / main FX bypass (red) edits racks[k].byp; Alt-click switches every module of that rack; no FX state disables it', () => {
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
  assert.equal(byp('bus1').title, 'FX bypass: the BUS 1 rack passes its input (Alt-click: every module of the rack on / off)');
  fire(byp('main'), 'click');
  assert.equal(fx.racks[0].byp, 1);
  assert.equal(one(strip('direct').el, 'sxm-byp'), null);
  // Alt-click: every module of BUS 1 (top level and branches) off, then on again
  fire(byp('bus1'), 'click', { altKey: true });
  assert.deepEqual([eq.p.on, sp.p.on, sp.br[0][0].p.on, fx.racks[1].byp], [0, 0, 0, 1]);
  fire(byp('bus1'), 'click', { altKey: true });
  assert.deepEqual([eq.p.on, sp.p.on, sp.br[0][0].p.on], [1, 1, 1]);
  // (SX0) no FX state at all: the bypass buttons are disabled and the bus routes inert (a v1 state converts: the next case)
  const v = mount({ fx: null });
  v.T.paint();
  assert.ok(one(v.strip('bus1').el, 'sxm-byp').classList.contains('wk-dis'));
  fire(one(v.strip('bus1').el, 'sxm-byp'), 'click');
  fire(one(v.strip('bus1').el, 'sxm-byp'), 'click', { altKey: true });
  assert.equal(v.T.log.some(e => e[0] === 'editFx'), false);
  assert.ok(one(v.strip('bus1').el, 'sxm-route').classList.contains('wk-dis'));
});

test('two-finger rollback (gesture.js\'s pointercancel flagged e.gesture === "two-finger"): a fader\'s jump comes back; a plain cancel keeps', () => {
  const { T, kit, strip } = mount();
  const TW = { pointerType: 'touch', pointerId: 6 }, TWO = { pointerType: 'touch', pointerId: 6, gesture: 'two-finger' };
  // a fader (wk sliderCore): the press jumps it — the value from before comes back through the kit
  const fd = one(strip('direct').el, 'wk-fader'), id = fd.getAttribute('data-dest'), n0 = kit.getN(id);
  place(one(fd, 'wk-slt'), 0, 0, 10, 100);
  ptr(fd, 'pointerdown', 5, 95, TW);
  assert.notEqual(kit.getN(id), n0);
  ptr(fd, 'pointercancel', 5, 95, TWO);
  assert.deepEqual([kit.getN(id), T.held.size], [n0, 0]);
  ptr(fd, 'pointerdown', 5, 95, TW);
  ptr(fd, 'pointercancel', 5, 95, TW);
  assert.notEqual(kit.getN(id), n0, 'plain cancel keeps');
});

test('destroy removes the strips; idempotent', () => {
  const { root, page } = mount();
  page.destroy();
  page.destroy();
  assert.equal(page.el.parentNode, null);
  assert.equal(root.children.length, 0);
});

/* ------------------------------------------------------------------ review fixes */

test('a v1 FX state — MAIN / bus controls convert it in place (every host keeps v2 states: SX0, the "no v2" gate and its words went); Alt-click switches the v1 Main modules in the v1 state', () => {
  const v1 = () => { const f = core.defaultFxV1(); f.p['fx.dly.on'] = 1; f.p['fx.dly.feed'] = 0.7; f.p['fx.rev.size'] = 0.9; return f; };
  // Alt-click on MAIN switches the v1 modules in the v1 state (no conversion needed)
  const a = mount({ fx: v1() });
  a.T.paint();
  const byp = (m, k) => one(m.strip(k).el, 'sxm-byp');
  assert.ok(!byp(a, 'main').classList.contains('wk-dis'));
  assert.equal(byp(a, 'main').title, 'FX bypass: the Main rack passes its input (Alt-click: every module of the rack on / off)');
  fire(byp(a, 'main'), 'click', { altKey: true });
  assert.deepEqual([a.fx.v, a.fx.p['fx.dly.on'], a.fx.p['fx.rev.on']], [1, 0, 0]);        // the Main modules (Delay, Reverb) off
  assert.deepEqual(a.T.log.at(-1), ['editFx', 'Disable all MAIN modules', undefined, false]);
  fire(byp(a, 'main'), 'click', { altKey: true });
  assert.deepEqual([a.fx.v, a.fx.p['fx.dly.on'], a.fx.p['fx.rev.on']], [1, 1, 1]);
  // the first bypass / route edit converts the state in place (migrateFx1 with the state as refs) — with the host's flag or without
  const s = fresh();
  s.matrix[0] = Object.assign({}, s.matrix[0], { src: 'lfo1', dst: 'fx.cmp.thr', amt: 0.5 });
  for (const host of [{ v2Fx: () => true }, undefined]) {
    const b = mount({ s, fx: v1(), host });
    b.T.paint();
    assert.ok(!byp(b, 'main').classList.contains('wk-dis'));
    const obj = b.fx;
    fire(byp(b, 'main'), 'click');
    assert.equal(b.fx, obj);
    assert.equal(b.fx.v, 2);
    assert.equal(b.fx.racks[0].byp, 1);
    assert.deepEqual(b.fx.racks[0].mods.map(I => I.id), ['dly', 'cmp', 'rev']);          // the referenced compressor stays
    assert.deepEqual(b.T.log.at(-1), ['editFx', 'Main FX bypass', undefined, false]);
  }
  for (const host of [{ v2Fx: true }, undefined]) {
    const c = mount({ fx: v1(), host });
    choose(c.doc, one(c.strip('bus2').el, 'sxm-route'), 'Direct');
    assert.deepEqual([c.fx.v, c.fx.racks[2].route], [2, 1]);
  }
});

test('IMPL-FR-B §4.3: the meters are a kit.frame client (every painted frame of the host\'s tick while the fast lane is live, every slow paint otherwise) — a kit without frame() keeps kit.live', () => {
  const { T, page } = mount();
  assert.deepEqual([T.frames.length, T.lives.length], [1, 0], 'its meters on kit.frame');
  const lv = () => page.meters[0].w.meter && page.meters[0].last;
  T.fast = true;
  T.snap = { mix: Float32Array.from([-7, -7, -7, -7, -7, -7, -7, -7, -7, -7, -7]) };
  T.frames[0](true, true);
  assert.equal(lv(), -7, 'a frame reads the view');
  T.frames[0](false, true);
  T.snap = { mix: Float32Array.from([-9, -9, -9, -9, -9, -9, -9, -9, -9, -9, -9]) };
  T.frames[0](false, true);
  assert.equal(lv(), -7, 'hidden: nothing painted');
  // a kit without frame(): kit.live as before
  const doc = dom.fresh(), lives = [];
  const k0 = Object.assign({}, makeKit({ doc, s: fresh(), fx: core.defaultFx2() }));
  delete k0.frame;
  k0.live = fn => { lives.push(fn); return fn; };
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  new mix.OutputsPanel(root, k0);
  assert.equal(lives.length, 1);
});

test('touch rules under (pointer: coarse) and .wk-touch', () => {
  const { doc } = mount();
  const css = doc.getElementById('sxm-css').textContent;
  assert.match(css, /@media \(pointer: coarse\) \{\n  \.sxm-strip \{ flex-basis: 88px; \}/);
  assert.match(css, /\.wk-touch \.sxm-strip \{ flex-basis: 88px; \}/);
  assert.match(css, /\.wk-touch \.sxm-env, \.wk-touch \.sxm-byp \{ min-height: 34px; \}/);
});
