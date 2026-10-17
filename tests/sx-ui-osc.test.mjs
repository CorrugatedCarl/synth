// sx-ui-osc.js (SPEC-serum2 §11.14, §13.3, §15.12) — the oscillator-area panels on the stub binding kit
// (tests/serum-ui-stubs/kit.js) and the wk-dom fake DOM. M2: OSC A / B / C with the five type views (Wavetable,
// Multisample, Sample, Granular, Spectral), the dual warp slots, the pitch modes, the per-oscillator unison panel and
// routing popover, SUB / NOISE deltas, FILTER 1 / FILTER 2; the shared table / sample data (oscData) and the pure helpers
// (markerLayout, zoneMapLayout, sliceAt, xyToN, layers3d, warpMenuItems, filterLit, autoSlices — checked against
// smp.slicesFromOdf in a child process —, smpCoords, specRect). Two tests run the displays and Render OSC Warp through the
// real DSP scripts (SerumDSP, SxWarp, SxFilt2) and the real wt.js (wt.js?real, never redirected).
// graph.js resolves to its stub (tests/serum-ui.hooks.mjs); wt.js arrives through the kit (kit.wt = the wt stub);
// serum-core.js and wk.js are the real modules.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { redirect } from './serum-ui.hooks.mjs';

if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({ resolve: (spec, ctx, next) => redirect(spec, ctx.parentURL) || next(spec, ctx) });
} else nodeModule.register('./serum-ui.hooks.mjs', import.meta.url);

// imported before any DOM exists: no document / window access at module top level
const osc = await import('../sx-ui-osc.js?v=8');
const core = await import('../serum-core.js?v=8');
const { makeKit, stubOf } = await import('./serum-ui-stubs/kit.js');
const gxStub = await import('../graph.js');
const wtStub = await import('./serum-ui-stubs/wt.js');
const dom = await import('./wk-dom.mjs');

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 4) => { for (let i = 0; i < n; i++) await tick(); };
const fresh = () => core.normalizeSerum(core.defaultSerum());
const destsIn = root => new Set(dom.all(root).map(n => n.getAttribute && n.getAttribute('data-dest')).filter(Boolean));
const byDest = (root, id) => dom.byAttr(root, 'data-dest', id)[0];
const byLabel = (root, l) => dom.all(root).find(n => n.getAttribute && n.getAttribute('aria-label') === l);
const hidden = el => el.classList.contains('sx-hidden');
const shown = el => el.style.display !== 'none';
const disabled = el => el.getAttribute('aria-disabled') === 'true';
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, a + ' != ' + b);
const labelsOf = items => items.filter(it => !it.sep).map(it => it.label);
const item = (items, label) => items.find(it => it && it.label === label);
const saw = new Float32Array(2048).map((_, i) => 1 - 2 * i / 2048);
// a 100 Hz sine (upward zero crossings at multiples of 480 frames) as the PCM of every user sample
const SINE = new Float32Array(48000).map((_, i) => Math.sin(2 * Math.PI * (i + 0.5) / 480));

function mount(over) {
  const doc = dom.fresh(), s = fresh(), log = [], store = new Map();
  const recs = {
    'smp:1': { name: 'Mine', len: 48000, rate: 48000, root: 60, loop: null },
    'smp:nopcm': { name: 'No PCM', len: 48000, rate: 48000, root: 60, loop: null },
    'fsmp:Drums/Kick': { name: 'Kick', len: 24000, rate: 48000, root: 60 },
    'msmp:1': { name: 'My Multi', zones: [{ lo: 0, hi: 63, vlo: 1, vhi: 127, smp: 'smp:z0' }, { lo: 64, hi: 127, vlo: 1, vhi: 127, smp: 'smp:z1' }] },
  };
  // onset function with peaks at hops 50 and 100 (frames 12800, 25600 at hop 256)
  const odf = new Float32Array(180);
  odf[50] = 0.9; odf[100] = 0.8; odf[101] = 0.3;
  const host = {
    bpm: () => 120,
    storage: { get: (k, d) => (store.has(k) ? store.get(k) : d), set: (k, v) => { store.set(k, v); } },
    wt: {
      list: () => [{ id: 'factory:Default', name: 'Default', cat: 'Basic', user: false }, { id: 'factory:Default Shapes', name: 'Default Shapes', cat: 'Basic', user: false },
        { id: 'user:1', name: 'Mine', cat: '', user: true }],
      get: id => Promise.resolve(id === 'factory:Default' ? { name: 'Default', frames: [saw], morph: 0 } : id === 'factory:Default Shapes' ? { name: 'Default Shapes', frames: [saw, saw, saw, saw, saw, saw, saw, saw, saw], morph: 0 }
        : id === 'user:1' ? { name: 'Mine', frames: [saw, saw, saw], morph: 1 } : null),
      saveNew: (t, name) => { log.push(['saveNew', name, t.frames.length]); return Promise.resolve('user:new'); },
      noises: () => [{ id: 'noise:Analog/Hiss', name: 'Hiss', cat: 'Analog', user: false, oneshot: 1 }, { id: 'noise:Analog/Hum', name: 'Hum', cat: 'Analog', user: false, oneshot: 0 },
        { id: 'nzuser:1', name: 'My Noise', user: true }],
      saveNoise: (e, name) => { log.push(['saveNoise', name]); return Promise.resolve('nzuser:new'); },
    },
    smp: {
      list: kind => (kind === 'multi'
        ? [{ id: 'fmsmp:Keys/EP', name: 'EP', cat: 'Keys' }, { id: 'fmsmp:Keys/Organ', name: 'Organ', cat: 'Keys' }, { id: 'msmp:1', name: 'My Multi', user: true }]
        : [{ id: 'fsmp:Drums/Kick', name: 'Kick', cat: 'Drums' }, { id: 'fsmp:Drums/Snare', name: 'Snare', cat: 'Drums' }, { id: 'fsmp:Pads/Air', name: 'Air', cat: 'Pads' },
          { id: 'factory:Default', name: 'Default', cat: 'Wavetables/Basic' }, { id: 'smp:1', name: 'Mine', user: true }, { id: 'smp:r1', name: 'Render 1', user: true, folder: 'Renders' }]),
      import: (files, o) => { log.push(['import', files.length, o.kind, o.osc]); return Promise.resolve(o.kind === 'multi' ? 'msmp:new' : 'smp:new'); },
      overview: (id, n) => { log.push(['overview', id, n]); return Promise.resolve(new Float32Array(2 * n).map((_, i) => (i & 1 ? 0.5 : -0.5))); },
      spectrogram: (id, w, h) => { log.push(['spectrogram', id, w, h]); return Promise.resolve({ w, h, data: new Uint8ClampedArray(w * h) }); },
      odf: id => { log.push(['odf', id]); return Promise.resolve(odf); },
      record: id => Promise.resolve(recs[id] || null),
      pcm: id => Promise.resolve(id === 'smp:1' ? { rate: 48000, ch: 1, L: SINE, R: null } : null),
      rename: (id, name) => { log.push(['rename', id, name]); return Promise.resolve(); },
      del: id => { log.push(['del', id]); return Promise.resolve(true); },
      users: () => ['Track 1'],
      saveFrom: (o, kind) => { log.push(['saveFrom', o, kind]); return Promise.resolve('smp:zone'); },
    },
  };
  const kit = makeKit(Object.assign({ doc, s, fx: core.defaultFx(), host, wt: wtStub }, over));
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  return { doc, s, host, log, kit, T: stubOf(kit), root, store };
}
// the stub kit's popover: open through the button with aria-label `label`, → the popover box
function openPop(T, root, label) {
  dom.fire(byLabel(root, label), 'click');
  const P = T.pop;
  assert.ok(P, 'popover for ' + label);
  return P;
}
const popBox = (doc, P) => dom.all(doc.body).find(n => n.getAttribute && n.getAttribute('aria-label') === P.title && n.parentNode === doc.body);
// right-click el (its own items first: extraMenu) → the context menu's item labels; pick(label) runs one
function ctx(doc, el) {
  dom.fire(el, 'contextmenu', { clientX: 5, clientY: 5 });
  const menus = dom.byCls(doc.body, 'wk-ctx'), m = menus[menus.length - 1];
  const items = m ? dom.byCls(m, 'wk-ci') : [];
  return {
    labels: items.map(n => dom.one(n, 'wk-cl').textContent),
    checked: l => { const n = items.find(x => dom.one(x, 'wk-cl').textContent === l); return n ? n.getAttribute('aria-checked') === 'true' : null; },
    pick: l => { const n = items.find(x => dom.one(x, 'wk-cl').textContent === l); assert.ok(n, 'menu item ' + l); dom.fire(n, 'pointerdown'); dom.fire(n, 'click'); },
  };
}
// open a wk.menu (destination menus included) → its option elements
function menuOpts(doc, el) {
  dom.fire(dom.one(el, 'wk-mbtn'), 'click');
  const opts = dom.byCls(doc.body, 'wk-opt');
  return opts;
}
// an outside press closes the open list / context menu (wk's document-level listener)
const closeMenus = doc => { dom.fire(doc.body, 'pointerdown'); };

const EXPORTS = ['OscPanel', 'FilterPanel', 'SubPanel', 'NoisePanel', 'WTView', 'MultiView', 'SampleView', 'GranView', 'SpecView',
  'markerLayout', 'zoneMapLayout', 'sliceAt', 'xyToN', 'oscData', 'layers3d', 'warpMenuItems', 'filterLit', 'autoSlices', 'smpCoords', 'specRect'];

/* ================================================================ module, destinations, structure */

test('imports in node without a DOM; exports (§11.14)', () => {
  for (const k of EXPORTS) assert.equal(typeof osc[k], 'function', k);
  assert.deepEqual(Object.keys(osc).sort(), EXPORTS.slice().sort());
  assert.equal(gxStub.__stub, true);
  // one view class per oscillator type (static type = OSC_TYPES id); Granular shares the Sample view's display
  assert.deepEqual([osc.WTView, osc.MultiView, osc.SampleView, osc.GranView, osc.SpecView].map(V => V.type), core.OSC_TYPES.map(t => t.id));
  assert.ok(osc.GranView.prototype instanceof osc.SampleView);
});

test('OSC A: every destination of the panel, its views and popovers is bound (data-dest); drop-layer markers', () => {
  const { doc, kit, T, root } = mount();
  const P = new osc.OscPanel(root, kit, 0);
  T.paint();
  const seen = destsIn(P.el);
  const body = ['on', 'level', 'pan', 'oct', 'semi', 'ratio', 'fine', 'crs', 'uni', 'det', 'blend', 'wt', 'phase', 'rand',
    'w1', 'w2', 'warpMode', 'warp', 'warp2', 'wvar1', 'wvar2', 'rwarp', 'rwarp2', 'mvel', 'mrand', 'timbre',
    'sstart', 'send', 'lstart', 'lend', 'xfade', 'slice', 'scan', 'lenrate', 'pos', 'gy', 'dens', 'glen', 'roff', 'rdir', 'rpitch', 'rlen',
    'rpan', 'rlvl', 'cut', 'smix', 'flo', 'fhi'].map(x => 'a.' + x);
  assert.deepEqual(body.filter(id => !seen.has(id)), []);
  for (const id of seen) assert.ok(core.DEST_INDEX[id] !== undefined && /^a\./.test(id), id);
  // popovers built with the panel: routing, Hz, unison gear, multisample envelope, grain window
  const pops = { 'OSC A routing': ['a.fbal', 'a.bus1', 'a.bus2'], 'More pitch controls (OSC A)': ['a.hz'],
    'Unison settings (OSC A)': ['a.stack', 'a.uniw', 'a.uniwt', 'a.uniwarp', 'a.uniwarp2', 'a.ustart', 'a.uspan'],
    'Multisample envelope (OSC A)': ['a.mdly', 'a.matt', 'a.mhold', 'a.mdec', 'a.msus', 'a.mrel'] };
  for (const [label, ids] of Object.entries(pops)) {
    const box = popBox(doc, openPop(T, root, label));
    const d = destsIn(box);
    assert.deepEqual(ids.filter(id => !d.has(id)), [], label);
  }
  const win = popBox(doc, openPop(T, root, 'Grain window (OSC A); Alt-drag: amount (x) / skew (y)'));
  assert.deepEqual(['a.wamt', 'a.wskew', 'a.rwamt', 'a.rwskew'].filter(id => !destsIn(win).has(id)), []);
  // every type view's display is an LFO → wavetable drop target (§13.3); the X|Y dot and the Hi / Lo handles
  assert.equal(dom.byAttr(P.el, 'data-oscdisp', '0').length, 5);
  assert.equal(byDest(P.el, 'a.on').getAttribute('data-module'), 'oscA');
  const dots = dom.byAttr(P.el, 'data-xy', '1');
  assert.equal(dots.length, 2);                                   // Granular and Spectral
  for (const d of dots) assert.deepEqual([d.getAttribute('data-dest'), d.getAttribute('data-dest-x'), d.getAttribute('data-dest-y')], ['a.pos', 'a.pos', 'a.gy']);
  // the module menu items go to the shell (kit.panel o.items = menuItems)
  assert.equal(typeof P.shell.items, 'function');
  assert.deepEqual(labelsOf(P.shell.items()), labelsOf(P.menuItems()));
});

test('OSC B / C: b.* / c.* bindings, modules oscB / oscC, display markers; OSC C has no Phase-1 warp slot', () => {
  const { kit, T, root } = mount();
  const B = new osc.OscPanel(root, kit, 1), Cp = new osc.OscPanel(root, kit, 2);
  T.paint();
  for (const [P, k, m] of [[B, 'b', 'oscB'], [Cp, 'c', 'oscC']]) {
    const seen = destsIn(P.el);
    for (const x of ['on', 'level', 'pan', 'oct', 'semi', 'fine', 'crs', 'uni', 'det', 'blend', 'phase', 'rand', 'wt', 'warp', 'w1', 'w2', 'warp2', 'sstart', 'dens', 'cut', 'timbre'])
      assert.ok(seen.has(k + '.' + x), k + '.' + x);
    for (const id of seen) assert.ok(id.startsWith(k + '.') && core.DEST_INDEX[id] !== undefined, id);
    assert.equal(byDest(P.el, k + '.on').getAttribute('data-module'), m);
    assert.equal(dom.byAttr(P.el, 'data-oscdisp', String(P.o)).length, 5);
  }
  assert.ok(destsIn(B.el).has('b.warpMode'));
  assert.equal(destsIn(Cp.el).has('c.warpMode'), false);
  assert.equal(Cp.el.getAttribute('aria-label'), 'OSC C');
});

test('OscPanel: type menu, one view per type (the current one shown, its head in the title row), view() and keys', async () => {
  const { doc, s, kit, T, root, host } = mount();
  host.wt.rename = () => Promise.resolve();                       // Rename offered for user tables
  const P = new osc.OscPanel(root, kit, 0);
  T.paint();
  assert.deepEqual(Object.keys(P.views), ['wt', 'multi', 'sample', 'gran', 'spec']);
  const body = dom.byCls(P.el, 'sx-pbody')[0], head = dom.byCls(P.el, 'sx-ptitle')[0];
  assert.deepEqual(body.children.slice(0, 5), Object.values(P.views).map(v => v.el));
  for (const [t, v] of Object.entries(P.views)) {
    assert.deepEqual([v.type, v.o, v.el.getAttribute('data-otype'), shown(v.el), v.active()], [t, 0, t, t === 'wt', t === 'wt']);
    for (const h of v.head) assert.equal(h.parentNode, head);
    if (t !== 'wt') assert.equal(v.key(), 'off');
  }
  assert.equal(P.view(), P.views.wt);
  const [, ren, del] = P.views.wt.head;
  assert.ok(hidden(ren) && hidden(del));                         // factory table
  // the type menu (§13.3 header): Wavetable · Multisample · Sample · Granular · Spectral
  const type = dom.all(head).find(n => n.classList.contains('sxo-type'));
  const opts = menuOpts(doc, type);
  assert.deepEqual(opts.map(o => o.textContent), core.OSC_TYPES.map(t => t.name));
  dom.fire(opts[3], 'click');
  assert.equal(s.osc[0].type, 'gran');
  assert.deepEqual(T.log.filter(x => x[0] === 'edit').at(-1), ['edit', 'OSC A type', undefined, false]);
  T.paint();
  assert.equal(P.view(), P.views.gran);
  assert.deepEqual(Object.values(P.views).filter(v => shown(v.el)).map(v => v.type), ['gran']);
  assert.ok(P.views.wt.head.every(h => !shown(h)) && P.views.gran.head.every(shown));
  assert.equal(P.views.wt.key(), 'off');
  assert.notEqual(P.views.gran.key(), 'off');
  // back to Wavetable with a user table: the head shows again, Rename / Delete follow their own rule
  s.osc[0].type = 'wt';
  s.osc[0].wt = 'user:1';
  T.paint();
  assert.ok(P.views.wt.head.every(shown));
  assert.equal(hidden(ren), false);
  assert.equal(hidden(del), true);                                // the host stub has no del
  // a view built for an oscillator whose type differs starts hidden; standalone views take any root
  const box = kit.doc.createElement('div');
  const sv = new osc.SampleView(box, kit, 1);
  assert.deepEqual([box.children[0], shown(sv.el), sv.o, sv.type], [sv.el, false, 1, 'sample']);
  s.osc[1].type = 'sample';
  assert.equal(sv.active(), true);
  sv.show(true);
  assert.equal(shown(sv.el), true);
});

/* ================================================================ OSC header: routing, module menu */

test('OSC routing popover: route seg, balance (Filter only), ENV (Main / Direct only), buses; the button names the route', () => {
  const { doc, s, kit, T, root } = mount();
  const A = new osc.OscPanel(root, kit, 0);
  T.paint();
  const b = byLabel(A.el, 'OSC A routing');
  assert.deepEqual([b.textContent, b.getAttribute('data-route')], ['F1', '0']);
  s.p['a.fbal'] = 1; T.paint();
  assert.equal(b.textContent, 'F2');
  s.p['a.fbal'] = 0.5; T.paint();
  assert.equal(b.textContent, 'F1+F2');
  const box = popBox(doc, openPop(T, root, 'OSC A routing'));
  const segBtns = dom.byCls(box, 'wk-sb');
  assert.deepEqual(segBtns.map(x => x.textContent), ['Filter', 'Main', 'Direct', 'None']);
  T.paint();
  const bal = byDest(box, 'a.fbal'), env = dom.all(box).find(n => n.classList.contains('wk-tog') && n.textContent === 'ENV');
  assert.deepEqual([disabled(bal), disabled(env)], [false, true]);
  dom.fire(segBtns[2], 'click');
  assert.equal(s.osc[0].route, 2);
  T.paint();
  assert.deepEqual([b.textContent, b.getAttribute('data-route'), disabled(bal), disabled(env)], ['DIRECT', '2', true, false]);
  dom.fire(env, 'click');
  assert.equal(s.osc[0].env, 0);
  dom.fire(segBtns[3], 'click'); T.paint();
  assert.equal(b.textContent, 'NONE');
  dom.fire(segBtns[1], 'click'); T.paint();
  assert.equal(b.textContent, 'MAIN');
  assert.ok(T.log.some(x => x[1] === 'OSC A routing') && T.log.some(x => x[1] === 'OSC A ENV'));
});

test('OSC module menu: pitch tracking, Pitch Bend Tracking (sample types, tracking off), note ranges, swap, view items', () => {
  const { doc, s, kit, T, root } = mount();
  const A = new osc.OscPanel(root, kit, 0);
  T.paint();
  let M = A.menuItems();
  // (Swap with ▸ is the shell's module-menu item: serum-ui moduleMenuItems, with its housekeeping — not repeated here)
  assert.deepEqual(labelsOf(M), ['Enable Pitch Tracking', 'Edit Note Ranges…', 'Swap Warps', 'Smooth Interpolation', 'Phase Memory']);
  assert.equal(item(M, 'Enable Pitch Tracking').checked, true);
  assert.deepEqual(labelsOf(item(M, 'Phase Memory').sub), ['All Voices', 'Contiguous', 'Per Voice', 'Phase Legato', 'New MemTrig phase set']);
  item(M, 'Smooth Interpolation').action();
  assert.equal(s.osc[0].smoothWT, 1);
  item(M, 'Enable Pitch Tracking').action();
  assert.equal(s.p['a.track'], 0);
  // tracking off: a Sample-type oscillator offers Pitch Bend Tracking; the view's own items follow
  s.osc[0].type = 'sample';
  M = A.menuItems();
  assert.deepEqual(labelsOf(M), ['Enable Pitch Tracking', 'Pitch Bend Tracking', 'Edit Note Ranges…', 'Swap Warps', 'Sample Display', 'Switch to Wavetable']);
  item(M, 'Pitch Bend Tracking').action();
  assert.equal(s.osc[0].bendTrack, 0);
  s.osc[0].type = 'multi';
  assert.deepEqual(labelsOf(A.menuItems()).slice(-2), ['Switch to Single Sample', 'Switch to Wavetable']);
  assert.ok(!labelsOf(A.menuItems()).includes('Pitch Bend Tracking'));     // Multisample: bend always applies (§6.3.2)
  s.osc[0].type = 'spec';
  assert.deepEqual(labelsOf(A.menuItems()).slice(-3), ['Spectrogram', 'Spectral Filter', 'Switch to Wavetable']);
  assert.deepEqual(labelsOf(item(A.menuItems(), 'Switch to Wavetable').sub).slice(0, 1), ['Auto']);
  s.osc[0].type = 'wt';
  assert.equal(item(A.menuItems(), 'Swap with'), undefined);
  // Edit Note Ranges…: the OSC MAPPING pane (KEY / VEL range bars, FOLD, WARP) in a popover
  item(A.menuItems(), 'Edit Note Ranges…').action();
  const box = popBox(doc, T.pop);
  assert.equal(dom.byCls(box, 'wk-rb').length, 2);
  T.paint();
  const fold = dom.all(box).find(n => n.classList.contains('wk-tog') && n.textContent === 'FOLD');
  dom.fire(fold, 'click');
  assert.equal(s.osc[0].map.fold, 1);
  // Swap Warps (core.swapWarps)
  s.p['a.w1'] = 2 / 81; s.p['a.w2'] = 9 / 81;
  item(A.menuItems(), 'Swap Warps').action();
  assert.deepEqual([s.p['a.w1'] * 81, s.p['a.w2'] * 81].map(Math.round), [9, 2]);
});

/* ================================================================ pitch row, unison */

test('pitch row: SEM menu (Semitones · Harmonics · Ratio · Step), HARM / STEP labels, Ratio = SRC + RATIO, Hz pane', () => {
  const { doc, s, kit, T, root } = mount();
  const A = new osc.OscPanel(root, kit, 0), B = new osc.OscPanel(root, kit, 1);
  T.paint();
  const sem = byDest(A.el, 'a.semi'), oct = byDest(A.el, 'a.oct'), ratio = byDest(A.el, 'a.ratio');
  const src = dom.all(A.el).find(n => n.classList.contains('wk-menu') && dom.one(n, 'wk-lab') && dom.one(n, 'wk-lab').textContent === 'SRC');
  assert.deepEqual([hidden(oct), hidden(sem), hidden(src), hidden(ratio)], [false, false, true, true]);
  const lab = el => dom.one(el, 'wk-lab').textContent;
  assert.equal(lab(sem), 'SEM');
  // right-click SEM: the pitch modes, Step disabled without a .scl tuning, then the standard knob menu entry
  const m = ctx(doc, sem);
  assert.deepEqual(m.labels, ['Semitones', 'Harmonics', 'Ratio', 'Step (load a .scl tuning)', 'Modulation, MIDI, Lock…']);
  assert.equal(m.checked('Semitones'), true);
  m.pick('Harmonics');
  assert.equal(s.osc[0].pitch.mode, 'harm');
  T.paint();
  assert.equal(lab(sem), 'HARM');
  s.p['a.semi'] = core.lawNorm('a.semi', 2);
  T.paint();
  assert.equal(dom.one(sem, 'wk-num').textContent, '×3');         // format semiH (§3.2)
  s.global.tun.kind = 'scl';
  const st = item(A.pitchItems(), 'Step');
  assert.equal(st.disabled, false);
  st.action();
  T.paint();
  assert.equal(lab(sem), 'STEP');
  // Ratio: OCT / SEM replaced by SRC (Note / other oscillators) + RATIO (typed 3:2)
  item(A.pitchItems(), 'Ratio').action();
  T.paint();
  assert.deepEqual([hidden(oct), hidden(sem), hidden(src), hidden(ratio)], [true, true, false, false]);
  assert.deepEqual(menuOpts(doc, src).map(o => o.textContent), ['Note', 'B', 'C']);
  closeMenus(doc);
  near(core.lawValue('a.ratio', core.parseParam('a.ratio', '3:2', { s })), 1.5, 1e-9);
  // ratio-source rules (§2.2.5): never self; an A ↔ B chain makes the later oscillator fall back to Note
  item(A.pitchItems(), 'Ratio').action();
  s.osc[0].pitch.src = 'B';
  item(B.pitchItems(), 'Ratio').action();
  assert.equal(s.osc[1].pitch.src, 'note');
  s.osc[1].pitch.src = 'A';                                       // as if chosen before A's choice
  s.osc[0].pitch.src = 'note';
  const srcA = dom.all(A.el).find(n => n.classList.contains('wk-menu') && dom.one(n, 'wk-lab') && dom.one(n, 'wk-lab').textContent === 'SRC');
  const o = menuOpts(doc, srcA);
  dom.fire(o.find(x => x.textContent === 'B'), 'click');
  assert.deepEqual([s.osc[0].pitch.src, s.osc[1].pitch.src], ['B', 'note']);
  // HZ (Hz Offset) in the ⋯ pane
  const box = popBox(doc, openPop(T, root, 'More pitch controls (OSC A)'));
  assert.ok(byDest(box, 'a.hz'));
});

test('unison: UNISON field + gear pane (MODE, STACK, RANGE, WIDTH, WT POS / START / SPAN / SPAWN per type); > 128 voices amber', () => {
  const { doc, s, kit, T, root } = mount();
  const A = new osc.OscPanel(root, kit, 0);
  T.paint();
  const box = popBox(doc, openPop(T, root, 'Unison settings (OSC A)'));
  T.paint();
  const vis = id => !hidden(byDest(box, id));
  assert.deepEqual([vis('a.uniwt'), vis('a.ustart'), vis('a.uspan')], [true, false, false]);
  const segs = dom.byCls(box, 'wk-seg');
  const spawn = segs.find(x => dom.one(x, 'wk-lab').textContent === 'SPAWN PATTERN'), mode = segs.find(x => dom.one(x, 'wk-lab').textContent === 'MODE');
  assert.equal(hidden(spawn), true);
  assert.deepEqual(dom.byCls(mode, 'wk-sb').map(x => x.textContent), core.UNI_MODES.slice());
  dom.fire(dom.byCls(mode, 'wk-sb')[1], 'click');
  assert.equal(s.osc[0].uni.mode, 1);
  s.osc[0].type = 'gran';
  T.paint();
  assert.deepEqual([vis('a.uniwt'), vis('a.ustart'), vis('a.uspan'), hidden(spawn)], [false, true, true, false]);
  dom.fire(dom.byCls(spawn, 'wk-sb')[3], 'click');
  assert.equal(s.osc[0].uni.spawn, 3);
  s.osc[0].type = 'multi';
  T.paint();
  assert.deepEqual([vis('a.uniwt'), vis('a.ustart'), hidden(spawn)], [false, false, true]);
  // RANGE: 0–48 st in 0.01 steps (osc.uni.range)
  const range = dom.byCls(box, 'wk-nb').find(x => dom.one(x, 'wk-lab').textContent === 'RANGE');
  assert.equal(dom.one(range, 'wk-nbt').textContent, '2.00 st');
  dom.key(range, 'ArrowUp');
  assert.equal(s.osc[0].uni.range, 2.01);
  // the UNISON box turns amber above 128 oscillator voices (kit.live, every snapshot)
  const uni = byDest(A.el, 'a.uni');
  T.setSnap({ notes: 0, oscVoices: 200 });
  assert.ok(uni.classList.contains('sx-amber'));
  T.setSnap({ notes: 0, oscVoices: 2 });
  assert.equal(uni.classList.contains('sx-amber'), false);
});

/* ================================================================ warp slots */

test('warpMenuItems: every WARPS2 mode, o1 / o2 named per oscillator, grouped by category, spectral modes greyed off Spectral', () => {
  const s = fresh();
  const A = osc.warpMenuItems(s, 0), C = osc.warpMenuItems(s, 2);
  assert.equal(A.length, 82);
  assert.deepEqual(A.map(x => x.v), core.WARPS2.map((_, i) => i / 81));
  assert.deepEqual([A[33].label, C[33].label, C[34].label, A[39].label], ['FM (B)', 'FM (A)', 'FM (B)', 'PD (B)']);
  assert.deepEqual([A[0].group, A[1].group, A[2].group, A[17].group, A[19].group, A[33].group, A[39].group, A[46].group, A[52].group],
    ['', 'Sync', 'Alt Warp', 'Filter', 'Distortion', 'FM', 'PD', 'AM', 'RM']);
  assert.ok(A.slice(58).every(x => x.disabled && /Spectral/.test(x.group)));
  assert.ok(A.slice(0, 58).every(x => !x.disabled));
  s.osc[0].type = 'spec';
  assert.ok(osc.warpMenuItems(s, 0).every(x => !x.disabled));
  assert.ok(osc.warpMenuItems(s, 1).slice(58).every(x => x.disabled));
});

test('WARP 1 / WARP 2 rows: mode menus (warpChoice2, cycle notice), Var for Sync, FM type, remap pen, granular RAND, S1 slot', () => {
  const { doc, s, kit, T, root } = mount();
  const A = new osc.OscPanel(root, kit, 0), B = new osc.OscPanel(root, kit, 1);
  T.paint();
  const w1 = byDest(A.el, 'a.w1'), w2 = byDest(A.el, 'a.w2'), wm = byDest(A.el, 'a.warpMode');
  assert.deepEqual([hidden(w1), hidden(w2), hidden(wm)], [false, false, true]);
  const rowOf = el => el.parentNode;
  const varSl = r => dom.byCls(r, 'sxo-var')[0], fmSeg = r => dom.byCls(r, 'sxo-fm')[0];
  const pen = r => dom.all(r).find(n => /^Edit remap curve/.test(n.getAttribute && n.getAttribute('aria-label') || ''));
  const r1 = rowOf(w1), r2 = rowOf(w2);
  assert.deepEqual([hidden(varSl(r1)), hidden(fmSeg(r1)), hidden(pen(r1)), hidden(byDest(r1, 'a.rwarp'))], [true, true, true, true]);
  // the opened list (§13.3): the 82 grouped modes (the spectral ones aria-disabled), the slot's FM types as radio items
  // in the FM category, Swap Warps
  const opts = menuOpts(doc, w1);
  assert.equal(opts.length, 86);
  assert.deepEqual(opts.slice(33, 42).map(o => o.textContent), ['FM (B)', 'FM (C)', 'FM (Noise)', 'FM (Sub)', 'FM (Filter 1)', 'FM (Filter 2)',
    '● Thru-Zero', '○ Exp', '○ Linear']);
  assert.equal(opts[85].textContent, 'Swap Warps');
  assert.ok(opts.slice(61, 85).every(disabled) && !opts.slice(0, 61).some(disabled) && !disabled(opts[85]));
  dom.fire(opts[1], 'click');                                     // Sync
  assert.equal(s.p['a.w1'], 1 / 81);
  T.paint();
  assert.equal(hidden(varSl(r1)), false);
  assert.ok(destsIn(varSl(r1)).has('a.wvar1'));                   // the Var fader (k.wvar1) under a Sync slot
  // ◀ ▶ step through the modes only (from Twist, the last one, ▶ wraps to Off — never onto an action item)
  s.p['a.w1'] = 1;
  dom.fire(dom.one(w1, 'wk-next'), 'click');
  assert.equal(s.p['a.w1'], 0);
  dom.fire(dom.one(w1, 'wk-prev'), 'click');
  assert.equal(s.p['a.w1'], 57 / 81);                               // the spectral modes (greyed) are skipped
  s.p['a.w1'] = 1 / 81;
  // FM (B) on slot 2: the TZ / EXP / LIN seg edits osc.fm[1]; Remap 2 on slot 1 shows the pen
  closeMenus(doc);
  const o2 = menuOpts(doc, w2);
  dom.fire(o2[33], 'click');
  T.paint();
  assert.equal(hidden(fmSeg(r2)), false);
  dom.fire(dom.byCls(fmSeg(r2), 'wk-sb')[1], 'click');
  assert.deepEqual(s.osc[0].fm, [0, 1]);
  // the slot's own right-click items: FM types (radio), Swap Warps
  const m = ctx(doc, w2);
  assert.deepEqual(m.labels, ['Thru-Zero', 'Exp', 'Linear', 'Swap Warps', 'Modulation, MIDI, Lock…']);
  assert.equal(m.checked('Exp'), true);
  m.pick('Linear');
  assert.deepEqual(s.osc[0].fm, [0, 2]);
  // … and in the opened list: the radio items, Swap Warps
  closeMenus(doc);
  let o3 = menuOpts(doc, w2);
  assert.deepEqual(o3.slice(39, 42).map(o => o.textContent), ['○ Thru-Zero', '○ Exp', '● Linear']);
  dom.fire(o3[39], 'click');
  assert.deepEqual(s.osc[0].fm, [0, 0]);
  assert.equal(Math.round(s.p['a.w2'] * 81), 33);                  // the mode stays
  o3 = menuOpts(doc, w2);
  dom.fire(o3[85], 'click');                                       // Swap Warps
  assert.deepEqual([Math.round(s.p['a.w1'] * 81), Math.round(s.p['a.w2'] * 81)], [33, 1]);
  assert.equal(T.log.filter(x => x[0] === 'edit').at(-1)[1], 'Swap Warps');
  s.p['a.w1'] = 1 / 81; s.p['a.w2'] = 33 / 81; s.osc[0].fm = [0, 2];
  closeMenus(doc);
  s.p['a.w1'] = 12 / 81;
  T.paint();
  assert.equal(hidden(pen(r1)), false);
  // a warp cycle (A slot 2 ← B, then B slot 1 ← A): the earlier slot goes Off with a notice
  closeMenus(doc);
  const ob = menuOpts(doc, byDest(B.el, 'b.w1'));
  dom.fire(ob[33], 'click');                                      // FM (A) on OSC B
  assert.equal(Math.round(s.p['b.w1'] * 81), 33);
  assert.equal(s.p['a.w2'], 0);
  assert.deepEqual(T.log.filter(x => x[0] === 'notify').at(-1), ['notify', 'Warp cycle: OSC A WARP 2 set Off']);
  // Granular: RAND (k.rwarp / k.rwarp2) per slot
  s.osc[0].type = 'gran';
  T.paint();
  assert.deepEqual([hidden(byDest(r1, 'a.rwarp')), hidden(byDest(r2, 'a.rwarp2'))], [false, false]);
  // S1 mode: OSC A / B slot 1 is the Phase-1 slot (a.warpMode, 23 modes); OSC C keeps WARPS2
  s.global.s1 = 1;
  T.paint();
  assert.deepEqual([hidden(w1), hidden(wm)], [true, false]);
  const ol = menuOpts(doc, wm);
  assert.equal(ol.length, 24);                                     // + Swap Warps
  assert.equal(ol[23].textContent, 'Swap Warps');
  dom.fire(ol[14], 'click');                                      // a Phase-1 remap mode
  assert.equal(Math.round(s.p['a.warpMode'] * 22), 14);
  T.paint();
  assert.equal(hidden(pen(r1)), false);
});

test('remap popover through kit.popover (toggles per oscillator); conversions and Render OSC Warp guard', async () => {
  const { s, kit, T, root, log } = mount();
  const P = new osc.OscPanel(root, kit, 1), D = osc.oscData(kit);
  s.p['b.w1'] = 11 / 81;                                          // Remap 1
  T.paint();
  const pen = byLabel(P.el, 'Edit remap curve (OSC B, WARP 1)');
  assert.equal(hidden(pen), false);
  dom.fire(pen, 'click');
  assert.equal(T.pops.length, 1);
  const ed = gxStub.made[gxStub.made.length - 1];
  assert.equal(ed.o.kind, 'remap');
  ed.o.set([[0, 0, 0], [1, 0.5, 0]], 'end');
  assert.deepEqual(s.osc[1].remap, [[0, 0, 0], [1, 0.5, 0]]);
  assert.equal(T.pops[0].sig(), JSON.stringify([s.osc[1].remap, s.lfoGrid]));
  dom.fire(pen, 'click');                                         // same key: closes
  assert.equal(T.pop, null);
  assert.equal(ed.dead, true);
  // LFO → wavetable / noise, Wavetable to LFO Shape
  await D.lfoToWavetable(0, 1);
  assert.equal(s.osc[1].wt, 'user:new');
  await D.lfoToNoise(1);
  assert.deepEqual([s.noise.src, s.noise.oneshot, s.noise.keytrack, s.p['n.on']], ['nzuser:new', 0, 1, 1]);
  s.osc[0].wt = 'user:1';
  assert.equal(D.lfoShape(0), null);                              // table not loaded yet → notice
  assert.ok(T.log.some(x => x[0] === 'notify' && x[1] === 'Wavetable not loaded yet'));
  await settle();
  assert.deepEqual(D.lfoShape(0), [[0, 0.5, 0], [0.5, 1, 0], [1, 0.5, 0]]);
  // Render OSC Warp: offered only for a wavetable oscillator with a warp slot on; no DSP in node → notice, no change
  s.p['a.w1'] = 0; s.p['a.w2'] = 0;
  assert.equal(D.canRenderWarp(0), false);
  s.p['a.w2'] = 2 / 81;
  assert.equal(D.canRenderWarp(0), true);
  s.osc[0].type = 'sample';
  assert.equal(D.canRenderWarp(0), false);
  s.osc[0].type = 'wt';
  await D.renderOscWarp(0);
  assert.deepEqual(T.log.at(-1), ['notify', 'Render OSC Warp is not available']);
  assert.ok(log.some(x => x[0] === 'saveNew'));
});

/* ================================================================ Wavetable view */

test('Wavetable view: table menu and loading, 2D / 3D flip, WT POS / PHASE menus, MEM, phase drag line, editor, live values', async () => {
  const imp = [];
  const wt = Object.assign({}, wtStub, { tableFromWav: (wav, o) => { imp.push(o); return { frames: [saw, saw], morph: 1 }; } });
  const { doc, s, kit, T, root } = mount({ wt });
  const P = new osc.OscPanel(root, kit, 0), D = osc.oscData(kit), V = P.views.wt;
  assert.equal(osc.oscData(kit), D);                              // one data object per kit
  T.paint();
  assert.deepEqual(D.wtItems(0).map(x => x.label), ['Default', 'Default Shapes', 'Mine']);
  s.osc[0].wt = 'factory:Gone';
  assert.deepEqual(D.wtItems(0).map(x => x.group), ['Basic', 'Basic', 'User', 'Current']);
  s.osc[0].wt = 'user:1';
  assert.equal(D.tableEntry('user:1').state, 'loading');
  await settle();
  assert.equal(D.tableEntry('user:1').state, 'ok');
  assert.deepEqual([D.tinfo(0).F, D.tinfo(0).interp, D.tinfo(0).R], [256, 1, 3]);   // morph: 256 display slots
  assert.ok(T.queued > 0);
  assert.equal(D.frameAt(D.tinfo(0), 0.5).length, 2048);
  T.paint();
  const cv = dom.byAttr(V.el, 'data-oscdisp', '0')[0];
  dom.fire(cv, 'click');
  assert.deepEqual(s.ui.view3d, [1, 0, 0]);
  assert.equal(T.log.at(-1)[3], true);                            // a UI-only edit
  T.paint();
  // WT POS ✓ Smooth Interpolation; PHASE: phase memory, Phase Legato, New MemTrig phase set
  const pos = ctx(doc, byDest(V.el, 'a.wt'));
  assert.deepEqual(pos.labels, ['Smooth Interpolation', 'Modulation, MIDI, Lock…']);
  pos.pick('Smooth Interpolation');
  assert.equal(s.osc[0].smoothWT, 1);
  const ph = ctx(doc, byDest(V.el, 'a.phase'));
  assert.deepEqual(ph.labels, ['All Voices', 'Contiguous', 'Per Voice', 'Phase Legato', 'New MemTrig phase set', 'Modulation, MIDI, Lock…']);
  ph.pick('Contiguous');
  assert.equal(s.osc[0].phMem, 'contig');
  ctx(doc, byDest(V.el, 'a.phase')).pick('Phase Legato');
  assert.equal(s.osc[0].phLegato, 1);
  const set0 = s.osc[0].memSet.slice();
  ctx(doc, byDest(V.el, 'a.phase')).pick('New MemTrig phase set');
  assert.equal(s.osc[0].memSet.length, 16);
  assert.notDeepEqual(s.osc[0].memSet, set0);
  assert.ok(s.osc[0].memSet.every(x => x >= 0 && x < 1));
  // MEM menu; S1 mode: OSC A / B use the knob ends (the menu is disabled with a notice)
  const mem = dom.all(V.el).find(n => n.classList.contains('wk-menu') && n.title === 'Phase memory');
  dom.fire(menuOpts(doc, mem)[2], 'click');
  assert.equal(s.osc[0].phMem, 'voice');
  s.global.s1 = 1;
  T.paint();
  assert.ok(mem.classList.contains('wk-dis'));
  V.setPhMem('all');
  assert.equal(s.osc[0].phMem, 'voice');
  assert.match(T.log.at(-1)[1], /^S1 mode/);
  s.global.s1 = 0;
  // the display key follows a PHASE drag (the playhead line)
  const k0 = V.key();
  kit.setN('a.phase', 0.3, 'start');
  assert.equal(kit.dragging('a.phase'), true);
  assert.notEqual(V.key(), k0);
  kit.setN('a.phase', 0.3, 'end');
  // the zoom button opens serum-ui's WT editor through the kit
  dom.fire(byLabel(P.el, 'Open wavetable editor (OSC A)'), 'click');
  assert.deepEqual(T.log.filter(x => x[0] === 'openWtEditor'), [['openWtEditor', 0]]);
  // live values: eff by vi while notes sound, else the base
  s.p['a.warp'] = 0.2;
  const eff = new Float32Array(core.NSV + 8);
  eff[core.vi('a.warp')] = 0.6;
  T.setSnap({ notes: 1, eff, wtPos: new Float32Array([0.7, 0, 0]) });
  assert.equal(D.liveN('a.warp'), eff[core.vi('a.warp')]);
  near(D.livePos(0), 0.7, 1e-6);
  T.setSnap({ notes: 0, eff });
  assert.equal(D.liveN('a.warp'), 0.2);
  // a WAV dropped on the display imports a table into this oscillator
  const file = { name: 'Growl.wav', type: 'audio/wav', arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)) };
  dom.fire(cv, 'drop', { dataTransfer: { types: ['Files'], files: [file] } });
  await settle();
  assert.equal(s.osc[0].wt, 'user:new');
  assert.equal(T.log.filter(x => x[0] === 'edit').at(-1)[1], 'Import wavetable');
  assert.deepEqual(imp, [{ mode: 'auto', name: 'Growl', channel: 0 }]);
});

/* ================================================================ Multisample view */

test('Multisample view: instrument menu (◀ ▶ within the folder), zone map with the recent zone, zone waveform, envelope pane', async () => {
  const { doc, s, kit, T, root, log } = mount();
  const P = new osc.OscPanel(root, kit, 0), V = P.views.multi, D = osc.oscData(kit);
  s.osc[0].type = 'multi';
  s.osc[0].multi = 'fmsmp:Keys/EP';
  T.paint();
  const im = V.head[0];
  assert.deepEqual(D.smpItems('multi', s.osc[0].multi).map(x => x.group), ['Keys', 'Keys', 'User']);
  dom.fire(dom.one(im, 'wk-next'), 'click');
  assert.equal(s.osc[0].multi, 'fmsmp:Keys/Organ');
  dom.fire(dom.one(im, 'wk-next'), 'click');                      // wraps inside the Keys folder
  assert.equal(s.osc[0].multi, 'fmsmp:Keys/EP');
  // user instruments: Rename / Delete / EMBED
  const [, , ren, del, emb] = V.head;
  assert.ok(hidden(ren) && hidden(del) && hidden(emb));
  s.osc[0].multi = 'msmp:1';
  T.paint();
  assert.ok(!hidden(ren) && !hidden(del) && !hidden(emb));
  await settle();
  assert.equal(V.zones().length, 2);
  // the zone map: before any note a tap shows the zone under the finger, again the map
  const cv = dom.byAttr(V.el, 'data-oscdisp', '0')[0];
  dom.place(cv, 0, 0, 256, 127);
  dom.fire(cv, 'click', { clientX: 10, clientY: 60 });
  assert.equal(V.sel, 0);
  T.paint();
  await settle();
  assert.ok(log.some(x => x[0] === 'overview' && x[1] === 'smp:z0'));
  dom.fire(cv, 'click', { clientX: 10, clientY: 60 });
  assert.equal(V.sel, -1);
  // the recent voice's zone highlighted from snapshot.zone — and kept after the release: a tap anywhere shows the
  // last-played zone (inv B5)
  T.setSnap({ notes: 1, zone: new Int16Array([1, -1, -1]) });
  assert.equal(V.hot(), 1);
  T.setSnap({ notes: 0, zone: new Int16Array([-1, -1, -1]) });
  assert.equal(V.hot(), 1);
  dom.fire(cv, 'click', { clientX: 10, clientY: 60 });
  assert.equal(V.sel, 1);
  dom.fire(cv, 'click', { clientX: 10, clientY: 60 });
  assert.equal(V.sel, -1);
  // envelope pane: OVERRIDE, DELAY (✓ BPM Sync), A H D S R, the draggable graph
  const box = popBox(doc, openPop(T, root, 'Multisample envelope (OSC A)'));
  T.paint();
  const ov = dom.all(box).find(n => n.classList.contains('wk-tog') && n.textContent === 'OVERRIDE');
  dom.fire(ov, 'click');
  assert.equal(s.osc[0].msmo.override, 1);
  // BPM Sync converts the delay to the nearest ladder entry (serum-core setMsDelayBpm): 0.5 s at 120 BPM = 1 beat
  s.p['a.mdly'] = core.lawNorm('a.mdly', 0.5);
  const want = core.normalizeSerum(JSON.parse(JSON.stringify(s)));
  core.setMsDelayBpm(want, 0, 1, 120);
  ctx(doc, byDest(box, 'a.mdly')).pick('BPM Sync');
  assert.equal(s.osc[0].msmo.dlyBpm, 1);
  assert.equal(s.p['a.mdly'], want.p['a.mdly']);
  assert.notEqual(s.p['a.mdly'], core.lawNorm('a.mdly', 0.5));
  const ecv = dom.byCls(box, 'sxo-mini')[0];
  dom.place(ecv, 0, 0, 260, 44);
  const G = V.envGeo(260, 44), [ax, ay] = G.pts[2];
  dom.ptr(ecv, 'pointerdown', ax, ay); dom.ptr(ecv, 'pointermove', ax + 20, ay); dom.ptr(ecv, 'pointerup', ax + 20, ay);
  assert.deepEqual(T.log.filter(x => x[0] === 'setN' && x[1] === 'a.matt').map(x => x[3]), ['move', 'end']);
  assert.ok(core.lawValue('a.matt', s.p['a.matt']) > core.lawValue('a.matt', core.DESTS[core.DEST_INDEX['a.matt']].def));
  // VEL TRACK / RAND numBoxes, TIMBRE knob
  for (const id of ['a.mvel', 'a.mrand']) assert.ok(byDest(V.el, id).classList.contains('wk-nb'), id);
  assert.ok(byDest(V.el, 'a.timbre').classList.contains('wk-knob'));
  // Switch to Single Sample: the recent zone sample (host.smp.saveFrom) becomes a Sample oscillator, one edit
  await item(V.menuItems(), 'Switch to Single Sample').action();
  assert.deepEqual([s.osc[0].type, s.osc[0].smp], ['sample', 'smp:zone']);
  assert.deepEqual(log.filter(x => x[0] === 'saveFrom').at(-1), ['saveFrom', 0, 'sample']);
});

/* ================================================================ Sample view */

test('Sample view: sample menu folders (Wavetables ▸, User, Renders), load / drop, markers drag, loop band, X-fade, zoom / pan', async () => {
  const { doc, s, kit, T, root, log } = mount();
  const P = new osc.OscPanel(root, kit, 0), V = P.views.sample, D = osc.oscData(kit);
  s.osc[0].type = 'sample';
  T.paint();
  const items = D.smpItems('sample', '');
  assert.deepEqual(items.map(x => x.group), ['Drums', 'Drums', 'Pads', 'Wavetables/Basic', 'User', 'Renders']);
  // choosing a sample resets the non-destructive operations
  s.osc[0].smpo.ops.norm = 1;
  dom.fire(dom.one(V.head[0], 'wk-next'), 'click');
  assert.equal(s.osc[0].smp, 'fsmp:Drums/Kick');
  assert.deepEqual(s.osc[0].smpo.ops, { fade: 0, norm: 0, rev: 0, trim: null });
  dom.fire(dom.one(V.head[0], 'wk-next'), 'click');
  assert.equal(s.osc[0].smp, 'fsmp:Drums/Snare');
  dom.fire(dom.one(V.head[0], 'wk-next'), 'click');               // wraps inside Drums
  assert.equal(s.osc[0].smp, 'fsmp:Drums/Kick');
  // a dropped file → host.smp.import → the new id on this oscillator
  const cv = dom.byAttr(V.el, 'data-oscdisp', '0')[0];
  dom.fire(cv, 'drop', { dataTransfer: { types: ['Files'], files: [{ name: 'a.wav' }] } });
  await settle();
  assert.deepEqual(log.filter(x => x[0] === 'import').at(-1), ['import', 1, 'sample', 0]);
  assert.equal(s.osc[0].smp, 'smp:new');
  s.osc[0].smp = 'smp:1';
  T.paint();
  await settle();
  T.paint();
  // the S marker: drag = one gesture (start / move / end)
  dom.place(cv, 0, 0, 1000, 100);
  dom.ptr(cv, 'pointerdown', 2, 50); dom.ptr(cv, 'pointermove', 200, 50); dom.ptr(cv, 'pointermove', 300, 50); dom.ptr(cv, 'pointerup', 300, 50);
  assert.equal(s.p['a.sstart'], 0.3);
  assert.deepEqual(T.log.filter(x => x[0] === 'setN' && x[1] === 'a.sstart').map(x => x[3]), ['start', 'move', 'end']);
  // loop: LS / LE numBoxes disabled for One-shot; Fwd loop: drag between the loop markers (top quarter) moves both
  const lsBox = byDest(V.el, 'a.lstart');
  assert.ok(lsBox.classList.contains('wk-dis'));
  s.osc[0].smpo.loop = 1;
  s.p['a.lstart'] = 0.4; s.p['a.lend'] = 0.6;
  T.paint();
  assert.equal(lsBox.classList.contains('wk-dis'), false);
  dom.ptr(cv, 'pointerdown', 500, 10); dom.ptr(cv, 'pointermove', 550, 10); dom.ptr(cv, 'pointerup', 550, 10);
  near(s.p['a.lstart'], 0.45); near(s.p['a.lend'], 0.65);
  assert.deepEqual(T.log.filter(x => x[1] === 'Move loop').map(x => x[2]), ['start', 'end']);
  // X-fade handle at the wrap point (LE): drag up = more crossfade
  const L = osc.markerLayout(V.mm(), V.viewR(), 1000), xf = L.markers.find(m => m.id === 'XF');
  const y0 = V.xfY(xf.y, 100);
  dom.ptr(cv, 'pointerdown', xf.x, y0); dom.ptr(cv, 'pointermove', xf.x, y0 - 42); dom.ptr(cv, 'pointerup', xf.x, y0 - 42);
  near(s.p['a.xfade'], 0.5, 1e-9);
  // zoom: drag up in empty space zooms in around the press point; then pan
  dom.ptr(cv, 'pointerdown', 250, 90); dom.ptr(cv, 'pointermove', 250, 0); dom.ptr(cv, 'pointerup', 250, 0);
  assert.ok(V.zv.b - V.zv.a < 0.5);
  assert.ok(V.zv.a <= 0.25 && V.zv.b >= 0.25);
  const a0 = V.zv.a;
  dom.ptr(cv, 'pointerdown', 500, 90); dom.ptr(cv, 'pointermove', 400, 90); dom.ptr(cv, 'pointerup', 400, 90);
  assert.ok(V.zv.a > a0);
  // Zoom to Start and End (smpo.zoomSE) overrides the view; a zoom gesture switches it off
  item(V.dispItems(), 'Zoom to Start and End').action();
  assert.deepEqual(V.viewR(), { a: 0.3, b: 1 });
  // the loop menu
  const lm = labelsOf(V.loopItems());
  assert.deepEqual(lm, core.LOOP_MODES.concat(['Relative Loop', 'Link Loop Length', 'Exit Loop on Release']));
  item(V.loopItems(), 'Exit Loop on Release').action();
  assert.equal(s.osc[0].smpo.exitRel, 1);
  item(V.loopItems(), core.LOOP_MODES[4]).action();
  assert.equal(s.osc[0].smpo.loop, 4);
});

test('Sample view: marker snapping to zero crossings, beats and whole loop periods (§13.3.2)', async () => {
  const { s, kit, T, root } = mount();
  const P = new osc.OscPanel(root, kit, 0), V = P.views.sample, D = osc.oscData(kit);
  s.osc[0].type = 'sample';
  s.osc[0].smp = 'smp:1';
  D.smpInfo('smp:1'); D.pcm('smp:1');
  await settle();
  T.paint();
  const cv = dom.byAttr(V.el, 'data-oscdisp', '0')[0];
  dom.place(cv, 0, 0, 1000, 100);
  const drag = (x0, x1) => { dom.ptr(cv, 'pointerdown', x0, 50); dom.ptr(cv, 'pointermove', x1, 50); dom.ptr(cv, 'pointerup', x1, 50); };
  s.osc[0].smpo.snap = 1;                                         // Zero: upward crossings every 480 frames
  drag(2, 302);                                                   // 0.302 · 48000 = 14496 → 14400
  near(s.p['a.sstart'], 0.3, 1e-9);
  s.osc[0].smpo.snap = 2;                                         // Beats: 1/16 at 120 BPM = 6000 frames from S
  drag(998, 640);                                                 // E: 0.64 · 48000 = 30720 → S + 3 · 6000 = 32400
  near(s.p['a.send'], 32400 / 48000, 1e-9);
  // Loop: LE − LS a whole number of root periods (no PCM: the plain grid)
  s.osc[0].smp = 'smp:nopcm';
  D.smpInfo('smp:nopcm');
  await settle();
  s.osc[0].smpo.loop = 1; s.osc[0].smpo.snap = 3;
  s.p['a.lstart'] = 0.4; s.p['a.lend'] = 0.9;
  T.paint();
  drag(900, 777);
  const T0 = 48000 / (440 * Math.pow(2, (60 - 69) / 12)), k = (s.p['a.lend'] - 0.4) * 48000 / T0;
  near(k, Math.round(k), 1e-6);
  near(s.p['a.lend'], 0.777, 0.005);
  // snapping off: the raw position
  s.osc[0].smpo.snap = 0;
  drag(777 + 0.5, 812);
  near(s.p['a.lend'], 0.812, 1e-9);
});

test('Sample view: display menu — operations (trim / untrim, fade, normalize, reverse, reload), slicing Auto / Manual, clips', async () => {
  const { doc, s, kit, T, root } = mount();
  const P = new osc.OscPanel(root, kit, 0), V = P.views.sample, D = osc.oscData(kit);
  s.osc[0].type = 'sample';
  s.osc[0].smp = 'smp:1';
  D.smpInfo('smp:1');
  await settle();
  T.paint();
  const M = () => V.dispItems();
  assert.deepEqual(labelsOf(M()), ['Show Marker Animation', 'Zoom to Start and End', 'Snap', 'Fade Edges', 'Normalize', 'Reverse', 'Trim',
    'Reload Sample', 'Slicing Off', 'Slicing Auto', 'Slicing Manual']);
  assert.deepEqual(labelsOf(item(M(), 'Snap').sub), ['Snap Off', 'Snap to Zero', 'Snap to Beats', 'Snap to Loop']);
  assert.deepEqual(labelsOf(item(M(), 'Fade Edges').sub), ['None'].concat(core.FADE_MS.slice(1).map(ms => ms + ' ms')));
  // display options are view edits (no undo step); Show Marker Animation draws the snapshot's playhead and markers
  item(M(), 'Show Marker Animation').action();
  item(item(M(), 'Snap').sub, 'Snap to Beats').action();
  assert.deepEqual([s.osc[0].smpo.anim, s.osc[0].smpo.snap], [1, 2]);
  assert.deepEqual(T.log.slice(-2), [['edit', 'View', undefined, true], ['edit', 'View', undefined, true]]);
  T.setSnap({ notes: 1, smpPos: Float32Array.from([0.5, 0.1, 0.2, 0.3, 0, 0, 0, 0, 0, 0, 0, 0]) });
  assert.deepEqual([V.mm().play, V.mm().S, V.mm().LS, V.mm().LE].map(x => Math.round(x * 10) / 10), [0.5, 0.1, 0.2, 0.3]);
  T.setSnap(null);
  assert.equal(V.mm().play, null);
  item(item(M(), 'Fade Edges').sub, '8 ms').action();
  item(M(), 'Normalize').action();
  item(M(), 'Reverse').action();
  assert.deepEqual(s.osc[0].smpo.ops, { fade: 4, norm: 1, rev: 1, trim: null });
  // Trim (serum-core trimSample) maps the markers onto S…E; with Reverse on, the region S…E of the reversed sample is
  // the record's [1 − E, 1 − S]; Untrim maps the markers back onto the same audio
  Object.assign(s.p, { 'a.sstart': 0.2, 'a.send': 0.6, 'a.lstart': 0.3, 'a.lend': 0.5 });
  assert.equal(item(M(), 'Untrim'), undefined);
  item(M(), 'Trim').action();
  assert.deepEqual(s.osc[0].smpo.ops.trim, [0.4, 0.8]);
  for (const [id, v] of [['a.sstart', 0], ['a.send', 1], ['a.lstart', 0.25], ['a.lend', 0.75]]) near(s.p[id], v, 1e-9);
  assert.equal(item(M(), 'Trim').disabled, true);                  // the region is the whole (trimmed) sample
  item(M(), 'Untrim').action();
  assert.equal(s.osc[0].smpo.ops.trim, null);
  for (const [id, v] of [['a.sstart', 0.2], ['a.send', 0.6], ['a.lstart', 0.3], ['a.lend', 0.5]]) near(s.p[id], v, 1e-9);
  // Reload Sample (serum-core clearSampleOps): the operations cleared, the markers carried to the record's coordinates
  item(M(), 'Reload Sample').action();
  assert.deepEqual(s.osc[0].smpo.ops, { fade: 0, norm: 0, rev: 0, trim: null });
  for (const [id, v] of [['a.sstart', 0.8], ['a.send', 0.4], ['a.lstart', 0.7], ['a.lend', 0.5]]) near(s.p[id], v, 1e-9);
  item(item(M(), 'Snap').sub, 'Snap Off').action();
  // Slicing Auto: the marks from the onset function (peaks at frames 12800 and 25600, ≥ 50 ms apart)
  item(M(), 'Slicing Auto').action();
  await settle(6);
  assert.deepEqual(s.osc[0].smpo.slice.marks, [0.26667, 0.53333]);
  assert.deepEqual(labelsOf(M()).slice(-5), ['Play Slice to End', 'Play Single Slice', 'Root Note', 'Send to Selected Clip (1)', 'Auto-Sync to Clip']);
  assert.equal(item(M(), 'Root Note').sub.length, 10);
  item(item(M(), 'Root Note').sub, 'C3').action();
  assert.equal(s.osc[0].smpo.slice.root, 48);
  // Play Single Slice shows SLICE (k.slice); Play Slice to End and Play Single Slice exclude each other
  item(M(), 'Play Single Slice').action();
  T.paint();
  assert.equal(hidden(byDest(V.el, 'a.slice')), false);
  item(M(), 'Play Slice to End').action();
  assert.deepEqual([s.osc[0].smpo.slice.toEnd, s.osc[0].smpo.slice.single], [1, 0]);
  // Send to Selected Clip: one note per slice from the slice root (seq-core slicesToNotes); the bank is modified
  assert.equal(s.clip.dirty, 0);
  item(M(), 'Send to Selected Clip (1)').action();
  const want = core.slicesToNotes([0.26667, 0.53333], 1, 120, 48);
  assert.deepEqual([s.clip.clips[0].notes, s.clip.clips[0].len, s.clip.dirty], [want.notes, want.len16, 1]);
  // Auto → Manual keeps the marks; Alt-click adds a mark, Alt-click on a mark removes it
  item(M(), 'Slicing Manual').action();
  assert.deepEqual(s.osc[0].smpo.slice.marks, [0.26667, 0.53333]);
  const cv = dom.byAttr(V.el, 'data-oscdisp', '0')[0];
  dom.place(cv, 0, 0, 1000, 100);
  dom.ptr(cv, 'pointerdown', 750, 50, { altKey: true });
  assert.deepEqual(s.osc[0].smpo.slice.marks, [0.26667, 0.53333, 0.75]);
  dom.ptr(cv, 'pointerdown', 268, 50, { altKey: true });
  assert.deepEqual(s.osc[0].smpo.slice.marks, [0.53333, 0.75]);
  // ✓ Auto-Sync to Clip: every slicing edit re-sends the clip in the same step
  item(M(), 'Auto-Sync to Clip').action();
  dom.ptr(cv, 'pointerdown', 900, 50, { altKey: true });
  assert.deepEqual(s.clip.clips[0].notes, core.slicesToNotes([0.53333, 0.75, 0.9], 1, 120, 48).notes);
  // manual marks snap (§13.3.2): to Zero (the 100 Hz sine's upward crossings every 480 frames = 0.01)
  item(item(M(), 'Snap').sub, 'Snap to Zero').action();
  D.pcm('smp:1');
  await settle();
  dom.ptr(cv, 'pointerdown', 304, 50, { altKey: true });
  assert.deepEqual(s.osc[0].smpo.slice.marks, [0.3, 0.53333, 0.75, 0.9]);
  item(item(M(), 'Snap').sub, 'Snap Off').action();
  // SCAN (Sample): Range, Reverse, Lock Scan Rate, Sample Length to BPM → the knob shows RATE (k.lenrate)
  const scan = byDest(V.el, 'a.scan'), rate = byDest(V.el, 'a.lenrate');
  assert.deepEqual([hidden(scan), hidden(rate)], [false, true]);
  const sm = ctx(doc, scan);
  assert.deepEqual(sm.labels, ['Range', 'Reverse', 'Lock Scan Rate', 'Sample Length to BPM', 'Modulation, MIDI, Lock…']);
  sm.pick('Reverse');
  assert.equal(s.p['a.scanrev'], 1);
  ctx(doc, scan).pick('Sample Length to BPM');
  T.paint();
  assert.deepEqual([hidden(scan), hidden(rate)], [true, false]);
  assert.equal(dom.one(rate, 'wk-lab').textContent, 'RATE');
  assert.equal(dom.one(rate, 'wk-num').textContent, '1 bar');
});

/* ================================================================ Granular view */

test('Granular view: X|Y Manual (X knob, dot, Y menus, slicing off), window popover and Alt-drag, DENS / LENGTH / DIR menus', async () => {
  const { doc, s, kit, T, root } = mount();
  const P = new osc.OscPanel(root, kit, 0), V = P.views.gran;
  s.osc[0].type = 'gran';
  s.osc[0].smp = 'smp:1';
  T.paint();
  // loop menu: + Loop Grains, Manual (X|Y), Y Axis ▸, Y Modulation ▸
  assert.deepEqual(labelsOf(V.loopItems()).slice(-4), ['Loop Grains', 'Manual (X|Y)', 'Y Axis', 'Y Modulation']);
  assert.ok(item(V.loopItems(), 'Y Axis').disabled);
  item(V.loopItems(), 'Loop Grains').action();
  assert.equal(s.osc[0].smpo.loopGrains, 1);
  item(V.loopItems(), 'Manual (X|Y)').action();
  assert.equal(s.osc[0].xy.on, 1);
  assert.deepEqual(labelsOf(item(V.loopItems(), 'Y Axis').sub), core.XY_Y_GRAN.slice());
  item(item(V.loopItems(), 'Y Axis').sub, 'Density').action();
  item(item(V.loopItems(), 'Y Modulation').sub, 'Replace').action();
  assert.deepEqual(s.osc[0].xy, { on: 1, y: 4, yMode: 1 });
  T.paint();
  // SCAN relabelled X (k.pos); Y numBox shown; slicing items disabled; the dot follows X / Y
  const scan = byDest(V.el, 'a.scan'), xk = dom.byAttr(V.el, 'data-dest', 'a.pos').find(n => n.classList.contains('wk-knob'));
  assert.deepEqual([hidden(scan), hidden(xk), dom.one(xk, 'wk-lab').textContent, hidden(byDest(V.el, 'a.gy'))], [true, false, 'X', false]);
  assert.ok(V.dispItems().filter(x => /^Slicing/.test(x.label || '')).every(x => x.disabled));
  const lb = dom.all(V.el).find(n => n.getAttribute && n.getAttribute('aria-label') === 'Loop mode (OSC A)');
  assert.equal(lb.textContent, 'ONE-SHOT · X|Y ▾');
  const cv = dom.byAttr(V.el, 'data-oscdisp', '0')[0], dot = dom.byAttr(V.el, 'data-xy', '1')[0];
  dom.place(cv, 0, 0, 1000, 100);
  dom.ptr(dot, 'pointerdown', 250, 25); dom.ptr(dot, 'pointerup', 250, 25);
  assert.deepEqual([s.p['a.pos'], s.p['a.gy']], [0.25, 0.75]);
  T.paint();
  assert.deepEqual([dot.style.display, dot.style.left, dot.style.top], ['', '25.00%', '25.00%']);
  // a tap on the display places the dot as well
  dom.ptr(cv, 'pointerdown', 600, 50); dom.ptr(cv, 'pointerup', 600, 50);
  assert.deepEqual([s.p['a.pos'], s.p['a.gy']], [0.6, 0.5]);
  item(V.loopItems(), 'Manual (X|Y)').action();
  T.paint();
  assert.equal(dot.style.display, 'none');
  assert.deepEqual([hidden(scan), hidden(xk)], [false, true]);
  // SCAN menu adds Key Track
  assert.deepEqual(labelsOf(V.scanItems()).slice(-1), ['Key Track']);
  item(V.scanItems(), 'Key Track').action();
  assert.equal(s.osc[0].smpo.scanKey, 1);
  // the window popover: AMOUNT / SKEW + RAND numBoxes, SHAPE (10 icons)
  const wl = 'Grain window (OSC A); Alt-drag: amount (x) / skew (y)';
  const box = popBox(doc, openPop(T, root, wl));
  T.paint();
  const shapes = dom.byCls(box, 'wk-isb');
  assert.deepEqual(shapes.map(b => b.getAttribute('aria-label')), core.GRAIN_WINDOWS.map(w => w.name));
  dom.fire(shapes[3], 'click');
  assert.equal(s.osc[0].smpo.win, 3);
  T.pop.close();
  // Alt-drag on the window button: x = amount, y = skew (one gesture each)
  s.p['a.wamt'] = 0.5;
  const wb = byLabel(V.el, wl);
  dom.ptr(wb, 'pointerdown', 100, 100, { altKey: true }); dom.ptr(wb, 'pointermove', 130, 85); dom.ptr(wb, 'pointerup', 130, 85);
  near(s.p['a.wamt'], 0.7); near(s.p['a.wskew'], 0.6);
  assert.deepEqual(T.log.filter(x => x[0] === 'setN' && x[1] === 'a.wamt').map(x => x[3]), ['start', 'move', 'end']);
  // DENS: Free · BPM Sync (Triplet / Dotted) · Grains, Jump Start, Max Grains…; Grains excludes LENGTH Percent
  const dl = labelsOf(V.densItems());
  assert.deepEqual(dl, core.DENS_MODES.concat(['Triplet', 'Dotted', 'Jump Start', 'Max Grains… (256)']));
  assert.ok(item(V.densItems(), 'Triplet').disabled);
  item(V.glenItems(), core.GLEN_MODES[2]).action();
  assert.equal(s.osc[0].smpo.glen.mode, 2);
  item(V.densItems(), core.DENS_MODES[2]).action();
  assert.deepEqual([s.osc[0].smpo.dens.mode, s.osc[0].smpo.glen.mode], [2, 0]);
  assert.equal(item(V.glenItems(), core.GLEN_MODES[2]).disabled, true);
  item(V.densItems(), core.DENS_MODES[1]).action();
  item(V.densItems(), 'Triplet').action();
  item(V.densItems(), 'Dotted').action();
  assert.deepEqual([s.osc[0].smpo.dens.trip, s.osc[0].smpo.dens.dot], [0, 1]);
  item(V.densItems(), 'Jump Start').action();
  assert.equal(s.osc[0].smpo.dens.jump, 0);
  item(V.densItems(), 'Max Grains… (256)').action();
  const pr = T.prompts.at(-1);
  assert.equal(pr.ok('999'), false);
  assert.equal(pr.ok('64'), true);
  assert.equal(s.osc[0].smpo.dens.max, 64);
  // DIR (right-click ✓ Reverse Grains = k.grev)
  ctx(doc, byDest(V.el, 'a.rdir')).pick('Reverse Grains');
  assert.equal(s.p['a.grev'], 1);
  assert.equal(ctx(doc, byDest(V.el, 'a.rdir')).checked('Reverse Grains'), true);
  closeMenus(doc);
});

/* ================================================================ Spectral view */

test('Spectral view: spectrogram, Hi / Lo handles, display menu, SCAN extras, the spectral FILTER (curve, presets, wavetable)', async () => {
  const { doc, s, kit, T, root, log, store } = mount();
  const P = new osc.OscPanel(root, kit, 0), V = P.views.spec, D = osc.oscData(kit);
  s.osc[0].type = 'spec';
  s.osc[0].smp = 'smp:1';
  T.paint();
  await settle();
  T.paint();
  assert.ok(log.some(x => x[0] === 'spectrogram' && x[1] === 'smp:1'));
  assert.ok(D.spectrogram('smp:1'));
  // Hi / Lo handles on the log-frequency axis (20 Hz … 20 kHz), drop targets of k.fhi / k.flo
  const [hi, lo] = V.hl;
  assert.deepEqual([hi.id, lo.id, hi.h.getAttribute('data-dest'), lo.h.getAttribute('data-dest')], ['a.fhi', 'a.flo', 'a.fhi', 'a.flo']);
  assert.deepEqual([hi.h.style.top, lo.h.style.top], ['0.00%', '100.00%']);
  const cv = dom.byAttr(V.el, 'data-oscdisp', '0')[0];
  dom.place(cv, 0, 0, 1000, 100);
  dom.ptr(hi.h, 'pointerdown', 990, 50); dom.ptr(hi.h, 'pointerup', 990, 50);
  near(core.lawValue('a.fhi', s.p['a.fhi']), 20 * Math.sqrt(1000), 1e-6);
  T.paint();
  assert.equal(hi.h.style.top, '50.00%');
  // display menu: Show Waveform Display, Smooth, Post Warp, then the sample operations and slicing
  assert.deepEqual(labelsOf(V.dispItems()).slice(0, 4), ['Show Waveform Display', 'Smooth', 'Post Warp', 'Show Marker Animation']);
  item(V.dispItems(), 'Smooth').action();
  item(V.dispItems(), 'Post Warp').action();
  item(V.dispItems(), 'Show Waveform Display').action();
  assert.deepEqual([s.osc[0].spec.smooth, s.osc[0].spec.postWarp, s.osc[0].smpo.wave], [1, 1, 1]);
  assert.deepEqual(T.log.at(-1), ['edit', 'View', undefined, true]);
  // SCAN: + Key Track, Phase Lock, Transients; loop menu: Manual X|Y with the spectral Y list
  assert.deepEqual(labelsOf(V.scanItems()).slice(-3), ['Key Track', 'Phase Lock', 'Transients']);
  item(V.scanItems(), 'Phase Lock').action();
  item(V.scanItems(), 'Transients').action();
  assert.deepEqual([s.osc[0].smpo.phaseLock, s.osc[0].smpo.transients], [1, 1]);
  item(V.loopItems(), 'Manual (X|Y)').action();
  assert.deepEqual(labelsOf(item(V.loopItems(), 'Y Axis').sub), core.XY_Y_SPEC.slice());
  // CUT / MIX knobs; the FILTER preview opens the curve editor (kind spec, GRID field) in a popover
  assert.ok(byDest(V.el, 'a.cut') && byDest(V.el, 'a.smix'));
  const fcv = byLabel(V.el, 'OSC A spectral filter: click to edit');
  dom.fire(fcv, 'click');
  const ed = gxStub.made.at(-1);
  assert.equal(ed.o.kind, 'spec');
  ed.o.set([[0, 1, 0], [0.5, 0.2, 0], [1, 0, 0]], 'end');
  assert.deepEqual(s.osc[0].spec.filt.pts, [[0, 1, 0], [0.5, 0.2, 0], [1, 0, 0]]);
  ed.o.gridField.set(99, 'set');
  assert.equal(s.osc[0].spec.filt.grid, 64);
  T.pop.close();
  // presets: Factory ▸, User ▸, Save…, Default; Use Wavetable as Filter ▸ / Curve Filter
  const F = () => V.filtPresets();
  assert.deepEqual(labelsOf(F()), ['Factory', 'User', 'Save…', 'Default', 'Use Wavetable as Filter', 'Curve Filter']);
  assert.deepEqual(labelsOf(item(F(), 'Factory').sub), core.FACTORY_SPEC_FILTERS.map(p => p.name));
  assert.equal(item(F(), 'User').disabled, true);
  item(F(), 'Save…').action();
  assert.equal(T.prompts.at(-1).ok('Mine'), true);
  assert.deepEqual(store.get('synth.sx.specfilt'), [{ name: 'Mine', pts: [[0, 1, 0], [0.5, 0.2, 0], [1, 0, 0]] }]);
  item(F(), 'Default').action();
  assert.deepEqual(s.osc[0].spec.filt.pts, [[0, 1, 0], [1, 1, 0]]);
  item(item(F(), 'User').sub, 'Mine').action();
  assert.deepEqual(s.osc[0].spec.filt.pts, [[0, 1, 0], [0.5, 0.2, 0], [1, 0, 0]]);
  // ▸ Use Wavetable as Filter (§6.10.6): once the table is loaded, one edit stores kind, table and the points of its
  // frame 0 (frameToPoints, 128 points) — the curve compileSerum builds the DSP's filter from
  const ct = st => JSON.stringify(core.compileSerum(st, {}).serumT.parts.spec0);
  const before = ct(s);
  wtStub.calls.length = 0;
  assert.equal(await item(item(F(), 'Use Wavetable as Filter').sub, 'Mine').action(), true);
  assert.deepEqual([s.osc[0].spec.filt.kind, s.osc[0].spec.filt.wt, s.osc[0].spec.filt.pts], ['wt', 'user:1', [[0, 0.5, 0], [0.5, 1, 0], [1, 0.5, 0]]]);
  assert.deepEqual(wtStub.calls.filter(c => c[0] === 'frameToPoints'), [['frameToPoints', 128]]);
  assert.notEqual(ct(s), before);
  assert.equal(T.log.filter(x => x[0] === 'edit').at(-1)[1], 'Wavetable as filter');
  assert.equal(item(F(), 'Save…').disabled, true);
  T.paint();                                                      // the stored points drawn as the filter
  const fc = byLabel(V.el, 'OSC A spectral filter: click to edit');
  assert.ok(fc.getContext('2d').calls.some(c => c[0] === 'fillText' && c[1] === 'WT FILTER · 1'));
  // a table that is not there: a notice, no edit
  const n0 = T.log.filter(x => x[0] === 'edit').length;
  assert.equal(await V.useWtFilter('user:gone'), false);
  assert.equal(T.log.filter(x => x[0] === 'edit').length, n0);
  item(F(), 'Curve Filter').action();
  assert.equal(s.osc[0].spec.filt.kind, 'curve');
  assert.deepEqual(labelsOf(V.menuItems()), ['Spectrogram', 'Spectral Filter', 'Switch to Wavetable']);
});

/* ================================================================ SUB, NOISE */

test('SUB: S2 / S1 shape menus, OCTAVE, CRS (S2), PHASE ✓ Contiguous, routing, module menu', () => {
  const { doc, s, kit, T, root } = mount();
  const P = new osc.SubPanel(root, kit);
  T.paint();
  const seen = destsIn(P.el);
  for (const id of ['s.on', 's.shp', 's.shape', 's.oct', 's.crs', 's.phase', 's.pan', 's.level']) assert.ok(seen.has(id), id);
  const shp = byDest(P.el, 's.shp'), shape = byDest(P.el, 's.shape'), crs = byDest(P.el, 's.crs');
  assert.deepEqual([hidden(shp), hidden(shape), disabled(crs)], [false, true, false]);
  const o = menuOpts(doc, shp);
  assert.deepEqual(o.map(x => x.textContent), core.SUB_SHAPES2.map(x => x.name));
  dom.fire(o[2], 'click');
  assert.equal(s.p['s.shp'], 2 / 5);
  s.global.s1 = 1;
  T.paint();
  assert.deepEqual([hidden(shp), hidden(shape), disabled(crs)], [true, false, true]);
  assert.equal(menuOpts(doc, shape).length, 5);
  closeMenus(doc);
  ctx(doc, byDest(P.el, 's.phase')).pick('Contiguous');
  assert.equal(s.sub.contig, 1);
  const M = P.menuItems();
  assert.deepEqual(labelsOf(M), ['Enable Pitch Tracking', 'Edit Note Ranges…']);
  item(M, 'Enable Pitch Tracking').action();
  assert.equal(s.p['s.track'], 0);
  assert.equal(byLabel(P.el, 'SUB routing').textContent, 'MAIN');
  const box = popBox(doc, openPop(T, root, 'SUB routing'));
  assert.ok(['s.fbal', 's.bus1', 's.bus2'].every(id => byDest(box, id)));
  item(P.menuItems(), 'Edit Note Ranges…').action();
  assert.equal(dom.byCls(popBox(doc, T.pop), 'wk-rb').length, 2);
});

test('NOISE: source menu (Color ▸ first, folders, User), colour controls, ONE SHOT, Pitch Track, import, drop marker', async () => {
  const { doc, s, kit, T, root, log } = mount();
  const P = new osc.NoisePanel(root, kit), D = osc.oscData(kit);
  T.paint();
  assert.equal(P.el.getAttribute('data-noisepanel'), '1');
  const seen = destsIn(P.el);
  for (const id of ['n.on', 'n.phase', 'n.rand', 'n.stereo', 'n.color', 'n.pitch', 'n.fine', 'n.pan', 'n.level']) assert.ok(seen.has(id), id);
  const items = D.noiseItems();
  assert.deepEqual(items.map(x => x.group), ['Color', 'Color', 'Color', 'Color', 'Analog', 'Analog', 'User', 'Current']);   // noise:White unlisted
  assert.deepEqual(items.slice(0, 4).map(x => x.v), core.COLOR_NOISES.map(c => c.id));
  // choosing a listed source takes its one-shot default; ◀ ▶ step inside the folder
  const nm = dom.all(P.el).find(n => n.classList.contains('wk-menu') && dom.one(n, 'wk-mbtn') && /Noise source/.test(dom.one(n, 'wk-mbtn').getAttribute('aria-label') || ''));
  const opts = menuOpts(doc, nm);
  dom.fire(opts.find(x => x.textContent === 'Hiss'), 'click');
  assert.deepEqual([s.noise.src, s.noise.oneshot], ['noise:Analog/Hiss', 1]);
  dom.fire(dom.one(nm, 'wk-next'), 'click');
  assert.deepEqual([s.noise.src, s.noise.oneshot], ['noise:Analog/Hum', 0]);
  // sample noise: STEREO / FILTER hidden, START / ONE SHOT enabled; colour noise: the reverse
  T.paint();
  const stereo = byDest(P.el, 'n.stereo'), filt = byDest(P.el, 'n.color'), start = byDest(P.el, 'n.phase');
  const one = dom.all(P.el).find(n => n.classList.contains('wk-tog') && n.textContent === 'ONE SHOT');
  assert.deepEqual([hidden(stereo), hidden(filt), disabled(start), disabled(one)], [true, true, false, false]);
  s.noise.src = 'color:Pink';
  T.paint();
  assert.deepEqual([hidden(stereo), hidden(filt), disabled(start), disabled(one), disabled(byDest(P.el, 'n.pitch'))], [false, false, true, true, true]);
  s.noise.src = 'color:Geiger';
  T.paint();
  assert.equal(disabled(byDest(P.el, 'n.pitch')), false);       // Geiger: PITCH sets the click rate
  // module menu: ✓ Pitch Track (noise.keytrack), Edit Note Ranges…
  item(P.menuItems(), 'Pitch Track').action();
  assert.equal(s.noise.keytrack, 1);
  assert.equal(item(P.menuItems(), 'Pitch Track').checked, true);
  // a WAV file: a looping noise when it has a smpl loop (the wt stub: an 8-byte buffer), else one-shot
  await D.importNoiseFiles([{ name: 'Rain.wav', arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }]);
  assert.deepEqual([s.noise.src, s.noise.oneshot, s.p['n.on']], ['nzuser:new', 0, 1]);
  assert.ok(log.some(x => x[0] === 'saveNoise' && x[1] === 'Rain'));
  // the overview: colour noises generated deterministically, factory noises through wt.generateNoise when idle
  s.noise.src = 'color:Brown';
  assert.ok(D.noiseOverview('color:Brown') instanceof Float32Array);
  s.noise.src = 'noise:Analog/Hiss';
  assert.equal(D.noiseOverview('noise:Analog/Hiss'), null);
  await new Promise(r => setTimeout(r, 150));
  assert.ok(D.noiseOverview('noise:Analog/Hiss') instanceof Float32Array);
});

/* ================================================================ FILTER 1 / FILTER 2 */

test('FILTER 1: type menus (S2 108 grouped / S1 96), display views and drag, routing switches S A B C N, KEY, menus, VAR / MIX', () => {
  const { doc, s, kit, T, root } = mount();
  const fl = new osc.FilterPanel(root, kit, 0);
  T.paint();
  const seen = destsIn(fl.el);
  for (const x of ['on', 'type', 'type2', 'cutoff', 'res', 'drive', 'var', 'mix', 'pan', 'level', 'routeA', 'routeB', 'routeC', 'routeN', 'routeS']) assert.ok(seen.has('f.' + x), 'f.' + x);
  assert.equal(byDest(fl.el, 'f.on').getAttribute('data-module'), 'filter');
  const t2 = byDest(fl.el, 'f.type2'), t1 = byDest(fl.el, 'f.type');
  assert.deepEqual([hidden(t2), hidden(t1)], [false, true]);
  let opts = menuOpts(doc, t2);
  assert.equal(opts.length, 108);
  assert.deepEqual(dom.byCls(doc.body, 'wk-gh').map(n => n.textContent), core.FILTER_CATS.slice());
  dom.fire(opts.find(o => o.textContent === core.FILTERS[100].name), 'click');
  assert.equal(s.p['f.type2'], 100 / 107);
  s.global.s1 = 1;
  T.paint();
  assert.deepEqual([hidden(t2), hidden(t1)], [true, false]);
  opts = menuOpts(doc, t1);
  assert.equal(opts.length, 96);
  closeMenus(doc);
  s.global.s1 = 0;
  // display: click cycles 0 → 2 → 1 → 0 (UI-only edits); right-click lists the views; drag = cutoff / res
  const disp = dom.byCls(fl.el, 'sx-disp')[0];
  const seq = [];
  for (let i = 0; i < 3; i++) { dom.ptr(disp, 'pointerdown', 5, 5); dom.ptr(disp, 'pointerup', 5, 5); seq.push(s.ui.filtView[0]); }
  assert.deepEqual(seq, [2, 1, 0]);
  assert.ok(T.log.filter(x => x[0] === 'edit' && x[1] === 'View').every(x => x[3] === true));
  const cm = ctx(doc, disp);
  assert.deepEqual(cm.labels, ['Frequency Response', 'Frequency Response & FFT', 'Phase Response & FFT']);
  cm.pick('Phase Response & FFT');
  assert.deepEqual(s.ui.filtView, [2, 0]);
  dom.place(disp, 10, 20, 200, 100);
  dom.ptr(disp, 'pointerdown', 20, 30); dom.ptr(disp, 'pointermove', 60, 45); dom.ptr(disp, 'pointerup', 60, 45);
  assert.deepEqual([s.p['f.cutoff'], s.p['f.res']], [0.25, 0.75]);
  assert.deepEqual(T.log.filter(x => x[1] === 'Filter cutoff / res').map(x => x[2]), ['start', 'move', 'end']);
  // routing switches: lit = the source reaches this filter (route Filter, share > 0, switch on)
  const sw = X => dom.all(fl.el).find(n => n.classList.contains('wk-tog') && n.getAttribute('data-dest') === 'f.route' + X);
  const lit = () => 'SABCN'.split('').filter(X => osc.filterLit(s, 0)[X]).join('');
  assert.equal(lit(), 'A');                                       // A → Filter (F1), the others Main
  dom.fire(sw('B'), 'click');                                     // B was on Main: routed to Filter with its balance at F1
  assert.deepEqual([s.osc[1].route, s.p['b.fbal'], lit()], [0, 0, 'AB']);
  dom.fire(sw('A'), 'click');                                     // lit: the switch goes off
  assert.deepEqual([s.p['f.routeA'], lit()], [0, 'B']);
  // KEY toggle and the CUTOFF / DRIVE menus (structured filter[0] fields)
  const key = dom.all(fl.el).find(n => n.classList.contains('wk-tog') && n.textContent === 'KEY');
  dom.fire(key, 'click');
  assert.deepEqual([s.filter[0].keytrack, s.filter[1].keytrack], [1, 0]);
  assert.equal(ctx(doc, byDest(fl.el, 'f.cutoff')).checked('Key Track'), true);
  ctx(doc, byDest(fl.el, 'f.drive')).pick('Clean Mode');
  assert.equal(s.filter[0].clean, 1);
  closeMenus(doc);
  // VAR: per-type label, disabled without one; MIX disabled for Combs; PZ SVF: the PZ button (X / Y pane fallback)
  const vr = byDest(fl.el, 'f.var'), mix = byDest(fl.el, 'f.mix'), pz = byLabel(fl.el, 'PZ SVF corners and X / Y (FILTER 1)');
  for (const t of [0, 97, 98, 103]) {
    s.p['f.type2'] = t / 107;
    T.paint();
    assert.equal(dom.one(vr, 'wk-lab').textContent, core.varLabel(t) || 'VAR', 'type ' + t);
    assert.equal(disabled(vr), !core.varLabel(t));
    assert.equal(hidden(pz), t !== 103);
  }
  dom.fire(pz, 'click');
  const box = popBox(doc, T.pop);
  assert.ok(byDest(box, 'f.x') && byDest(box, 'f.y'));
  s.p['f.type2'] = 80 / 107;
  T.paint();
  assert.equal(disabled(mix), true);
  // the routing popover: Filter 2 / Main / Direct / None, ENV, buses; F1 → F2 while F2 → F1 sends F2 to Main
  s.filter[1].route = 0;
  const rb = popBox(doc, openPop(T, root, 'FILTER 1 routing'));
  const segs = dom.byCls(rb, 'wk-sb');
  assert.deepEqual(segs.map(x => x.textContent), ['Filter 2', 'Main', 'Direct', 'None']);
  assert.ok(byDest(rb, 'f.bus1') && byDest(rb, 'f.bus2'));
  dom.fire(segs[0], 'click');
  assert.deepEqual([s.filter[0].route, s.filter[1].route], [0, 1]);
  T.paint();
  assert.equal(byLabel(fl.el, 'FILTER 1 routing').textContent, '→ F2');
});

test('FILTER 2: f2.* bindings, the 108-type menu, its routing switches and display view', () => {
  const { doc, s, kit, T, root } = mount();
  const f2 = new osc.FilterPanel(root, kit, 1);
  T.paint();
  const seen = destsIn(f2.el);
  for (const x of ['on', 'type', 'cutoff', 'res', 'drive', 'var', 'mix', 'pan', 'level', 'routeA', 'routeB', 'routeC', 'routeN', 'routeS']) assert.ok(seen.has('f2.' + x), 'f2.' + x);
  for (const id of seen) assert.ok(/^f2\./.test(id), id);
  assert.equal(byDest(f2.el, 'f2.on').getAttribute('data-module'), 'filter2');
  assert.equal(menuOpts(doc, byDest(f2.el, 'f2.type')).length, 108);
  closeMenus(doc);
  assert.deepEqual(osc.filterLit(s, 1), { S: false, A: false, B: false, C: false, N: false });
  const sw = X => dom.all(f2.el).find(n => n.classList.contains('wk-tog') && n.getAttribute('data-dest') === 'f2.route' + X);
  // A is routed to Filter, all at F1: a tap toggles F2's switch only (serum-core toggleFilterRoute) — the balance never
  // moves, so A keeps feeding Filter 1 and a second tap restores the state
  const sw0 = s.p['f2.routeA'];
  dom.fire(sw('A'), 'click');
  assert.deepEqual([s.osc[0].route, s.p['a.fbal'], s.p['f2.routeA'], osc.filterLit(s, 1).A, osc.filterLit(s, 0).A], [0, 0, sw0 ? 0 : 1, false, true]);
  dom.fire(sw('A'), 'click');
  assert.deepEqual([s.p['a.fbal'], s.p['f2.routeA'], osc.filterLit(s, 0).A], [0, sw0, true]);
  // an off-route source comes to Filter with its balance at this filter
  dom.fire(sw('N'), 'click');
  assert.deepEqual([s.noise.route, s.p['n.fbal'], osc.filterLit(s, 1).N, osc.filterLit(s, 0).N], [0, 1, true, false]);
  const disp = dom.byCls(f2.el, 'sx-disp')[0];
  dom.ptr(disp, 'pointerdown', 5, 5); dom.ptr(disp, 'pointerup', 5, 5);
  assert.deepEqual(s.ui.filtView, [0, 2]);
  assert.equal(byLabel(f2.el, 'FILTER 2 routing').textContent, 'MAIN');
});

/* ================================================================ review fixes: sample operations, slicing, snapping */

// a Sample oscillator on smp:1 (48000 frames at 48 kHz, the 100 Hz sine PCM, onsets at frames 12800 / 25600)
async function sampleOsc(over) {
  const M = mount(over);
  const P = new osc.OscPanel(M.root, M.kit, 0), V = P.views.sample, D = osc.oscData(M.kit);
  M.s.osc[0].type = 'sample';
  M.s.osc[0].smp = 'smp:1';
  D.smpInfo('smp:1');
  D.odf('smp:1');
  await settle();
  M.T.paint();
  return Object.assign(M, { P, V, D });
}
const edits = T => T.log.filter(x => x[0] === 'edit');

test('smpCoords: processed-sample fractions ↔ record fractions through trim and reverse', () => {
  const c0 = osc.smpCoords(null);
  assert.deepEqual([c0.t0, c0.t1, c0.w, c0.rev, c0.toRec(0.3), c0.fromRec(0.3)], [0, 1, 1, false, 0.3, 0.3]);
  const c1 = osc.smpCoords({ trim: [0.25, 0.75], rev: 1 });
  near(c1.toRec(0), 0.75); near(c1.toRec(1), 0.25); near(c1.toRec(0.5), 0.5);
  for (const u of [0, 0.1, 0.5, 0.9]) near(c1.fromRec(c1.toRec(u)), u, 1e-12);
  const c2 = osc.smpCoords({ trim: [0.2, 0.6], rev: 0 });
  near(c2.toRec(0.5), 0.4); near(c2.fromRec(0.3), 0.25);
  assert.equal(osc.smpCoords({ trim: [0.6, 0.2] }).w, 1);           // a malformed trim = none
});

test('Trim with Reverse cuts the played region (serum-core trimSample): markers, slice marks and k.pos follow; Untrim / Reload carry them back', async () => {
  const { s, V, T } = await sampleOsc();
  s.osc[0].smpo.ops = { fade: 0, norm: 0, rev: 1, trim: null };
  Object.assign(s.p, { 'a.sstart': 0, 'a.send': 0.3, 'a.lstart': 0.1, 'a.lend': 0.2, 'a.pos': 0.15 });
  s.osc[0].smpo.slice = { mode: 2, thr: 0.5, marks: [0.1, 0.2, 0.5], toEnd: 0, single: 0, root: 36, sync: 0 };
  const want = JSON.parse(JSON.stringify(s));
  core.trimSample(want, 0);
  V.trim();
  assert.deepEqual(s.osc[0].smpo.ops.trim, [0.7, 1]);             // the end of the record: what the reversed region plays
  assert.deepEqual(s.osc[0].smpo, want.osc[0].smpo);
  for (const id of ['a.sstart', 'a.send', 'a.lstart', 'a.lend', 'a.pos']) assert.equal(s.p[id], want.p[id], id);
  assert.deepEqual(s.osc[0].smpo.slice.marks, [0.33333, 0.66667]);  // 0.5 lay outside the region
  assert.deepEqual(edits(T).at(-1).slice(0, 2), ['edit', 'Trim']);
  // Untrim: the whole (still reversed) record, every marker on the same audio again
  V.untrim();
  assert.equal(s.osc[0].smpo.ops.trim, null);
  assert.equal(s.osc[0].smpo.ops.rev, 1);
  for (const [id, v] of [['a.sstart', 0], ['a.send', 0.3], ['a.lstart', 0.1], ['a.lend', 0.2], ['a.pos', 0.15]]) near(s.p[id], v, 1e-9);
  assert.deepEqual(s.osc[0].smpo.slice.marks, [0.1, 0.2]);
  // Reload Sample (serum-core clearSampleOps): trim [0.25, 0.75] reversed, S 0 … E 1 → the record's 0.75 … 0.25
  s.osc[0].smpo.ops = { fade: 2, norm: 1, rev: 1, trim: [0.25, 0.75] };
  Object.assign(s.p, { 'a.sstart': 0, 'a.send': 1 });
  s.osc[0].smpo.slice.marks = [0.5];
  const want2 = JSON.parse(JSON.stringify(s));
  core.clearSampleOps(want2, 0);
  item(V.dispItems(), 'Reload Sample').action();
  assert.deepEqual(s.osc[0].smpo, want2.osc[0].smpo);
  assert.deepEqual([s.p['a.sstart'], s.p['a.send'], s.osc[0].smpo.slice.marks], [0.75, 0.25, [0.5]]);
});

test('Auto slicing in processed coordinates, recomputed with the sample, its operations and the threshold (one step)', async () => {
  const { s, V, D, T, host, kit } = await sampleOsc();
  const rec0 = host.smp.record;
  host.smp.record = id => (id === 'smp:new' ? Promise.resolve({ name: 'New', len: 96000, rate: 48000, root: 60 }) : rec0(id));
  V.setSliceMode(1);
  assert.deepEqual(s.osc[0].smpo.slice.marks, [0.26667, 0.53333]);   // the data at hand: in the same edit
  assert.deepEqual(edits(T).at(-1).slice(0, 2), ['edit', 'Slicing Auto']);
  // Reverse: the processed sample turns, the onsets are mirrored in the same step
  item(V.dispItems(), 'Reverse').action();
  assert.deepEqual(s.osc[0].smpo.slice.marks, [0.46667, 0.73333]);
  assert.deepEqual(edits(T).at(-1).slice(0, 2), ['edit', 'Reverse']);
  item(V.dispItems(), 'Reverse').action();
  // Trim to [0.25, 1]: onsets inside, in the trimmed sample (12800 is 800 frames = 17 ms after the new start: < 50 ms)
  Object.assign(s.p, { 'a.sstart': 0.25, 'a.send': 1 });
  V.trim();
  assert.deepEqual([s.osc[0].smpo.ops.trim, s.osc[0].smpo.slice.marks], [[0.25, 1], [0.37778]]);
  V.untrim();
  assert.deepEqual(s.osc[0].smpo.slice.marks, [0.26667, 0.53333]);
  // the threshold line: one 'Slice threshold' step with the new marks (0.85 keeps the 0.9 peak only)
  const cv = dom.byAttr(V.el, 'data-oscdisp', '0')[0];
  dom.place(cv, 0, 0, 1000, 100);
  T.paint();
  dom.ptr(cv, 'pointerdown', 500, 50); dom.ptr(cv, 'pointermove', 500, 15); dom.ptr(cv, 'pointerup', 500, 15);
  assert.deepEqual([s.osc[0].smpo.slice.thr, s.osc[0].smpo.slice.marks], [0.85, [0.26667]]);
  assert.deepEqual(edits(T).at(-1).slice(0, 2), ['edit', 'Slice threshold']);
  s.osc[0].smpo.slice.thr = 0.5;
  V.sliceEdit(x => { x.thr = 0.5; }, 'thr');
  // a dropped file while Auto slicing is on: the new sample never plays the old marks — cleared in the 'Load sample'
  // step, its own marks under the same label once its data arrives (serum-ui coalesces the two into one undo step)
  const n0 = edits(T).length;
  dom.fire(cv, 'drop', { dataTransfer: { types: ['Files'], files: [{ name: 'b.wav' }] } });
  await settle(8);
  const E = edits(T).slice(n0);
  assert.deepEqual(E.map(x => x[1]), ['Load sample', 'Load sample']);
  assert.deepEqual([s.osc[0].smp, s.osc[0].smpo.slice.marks], ['smp:new', [0.13333, 0.26667]]);
  // a wavetable played as a sample (§9.4.8): the frame boundaries, once the table is there
  V.setSample('user:1');
  assert.deepEqual(s.osc[0].smpo.slice.marks, []);
  await settle(8);
  assert.deepEqual(s.osc[0].smpo.slice.marks, [0.33333, 0.66667]);
  assert.deepEqual(edits(T).slice(-2).map(x => x[1]), ['Sample', 'Sample']);
  // Switch to Single Sample (Multisample menu) in Auto mode: the zone sample's marks, never the previous ones
  s.osc[0].type = 'multi';
  await D.switchToSample(0);
  await settle(8);
  assert.deepEqual([s.osc[0].type, s.osc[0].smp, s.osc[0].smpo.slice.marks], ['sample', 'smp:zone', []]);   // no record: no onsets
  // an undo back to an earlier sample while the new one's marks are pending: nothing is written for the abandoned one
  host.smp.record = id => (id === 'smp:late' ? Promise.resolve({ name: 'Late', len: 48000, rate: 48000, root: 60 }) : rec0(id));
  V.setSample('smp:1');
  await settle(8);
  const n1 = edits(T).length;
  V.setSample('smp:late');
  assert.deepEqual(s.osc[0].smpo.slice.marks, []);
  kit.edit(st => { st.osc[0].smp = 'smp:1'; st.osc[0].smpo.slice.marks = [0.26667, 0.53333]; }, { label: 'Undo' });
  await settle(8);
  assert.deepEqual(edits(T).slice(n1).map(x => x[1]), ['Sample', 'Undo']);
  assert.deepEqual([s.osc[0].smp, s.osc[0].smpo.slice.marks], ['smp:1', [0.26667, 0.53333]]);
});

test('Send to Selected Clip and Auto-Sync: the processed (trimmed) length, the clip bank marked modified', async () => {
  const { s, V } = await sampleOsc();
  s.osc[0].smpo.slice = { mode: 2, thr: 0.5, marks: [0.25, 0.5], toEnd: 0, single: 0, root: 48, sync: 0 };
  s.osc[0].smpo.ops = { fade: 0, norm: 0, rev: 0, trim: [0, 0.5] };   // 0.5 s of the 1 s record
  V.sendToClip();
  const want = core.slicesToNotes([0.25, 0.5], 0.5, 120, 48);
  assert.deepEqual([s.clip.clips[0].notes, s.clip.clips[0].len, s.clip.dirty], [want.notes, want.len16, 1]);
  // Auto-Sync re-sends after a Trim in the same step (the marks and the length both changed)
  s.clip.dirty = 0;
  s.osc[0].smpo.slice.sync = 1;
  Object.assign(s.p, { 'a.sstart': 0, 'a.send': 0.5 });
  V.trim();
  const w2 = core.slicesToNotes([0.5], 0.25, 120, 48);
  assert.deepEqual([s.osc[0].smpo.slice.marks, s.clip.clips[0].notes, s.clip.dirty], [[0.5], w2.notes, 1]);
});

test('Marker snapping through trim and reverse (§13.3.2, §6.7.7); one PCM held, read in place', async () => {
  const { s, V, D, host } = await sampleOsc();
  D.pcm('smp:1');
  await settle();
  const pc = D.pcm('smp:1');
  assert.equal(pc.L, SINE);                                         // the host's PCM as it came: no mono copy, no tables
  assert.deepEqual(Object.keys(pc).sort(), ['L', 'R', 'len', 'rate']);
  s.osc[0].smpo.snap = 1;
  // the stored frame a processed frame p reads (§6.7.7: reversed, frame p of the entry [a, b) is stored b − 1 − p)
  const stored = (p, ops) => { const c = osc.smpCoords(ops); return c.rev ? Math.round(c.t1 * 48000) - 1 - p : Math.round(c.t0 * 48000) + p; };
  for (const ops of [{ rev: 0, trim: [0.2013, 0.7013] }, { rev: 1, trim: null }, { rev: 1, trim: [0.1, 0.65] }]) {
    s.osc[0].smpo.ops = Object.assign({ fade: 0, norm: 0 }, ops);
    const PL = osc.smpCoords(ops).w * 48000;
    for (const u of [0.13, 0.41, 0.77]) {
      const v = V.snapU('sstart', u), p = Math.round(v * PL);
      assert.ok(Math.abs(v - u) * PL <= 240 + 1e-6, 'within ±5 ms');
      const y0 = SINE[stored(p - 1, ops)], y1 = SINE[stored(p, ops)];
      assert.ok(y0 < 0 && y1 >= 0, JSON.stringify(ops) + ' u ' + u + ': an upward crossing of the processed signal');
    }
  }
  // Beats over the processed length: trim [0, 0.5] = 24000 frames, 1/16 at 120 BPM = 6000 = 0.25
  s.osc[0].smpo.ops = { fade: 0, norm: 0, rev: 0, trim: [0, 0.5] };
  s.osc[0].smpo.snap = 2;
  s.p['a.sstart'] = 0;
  near(V.snapU('send', 0.6), 0.5);
  near(V.snapU('send', 0.7), 0.75);
  // a second sample replaces the held PCM; forget() releases it
  host.smp.pcm = id => Promise.resolve({ rate: 48000, ch: 1, L: new Float32Array(10), R: null });
  D.pcm('smp:other');
  assert.equal(D.pcmE.id, 'smp:other');
  D.forget();
  assert.equal(D.pcmE, null);
});

/* ================================================================ review fixes: pitch, warps, routing, assets */

test('ratio sources: a cycle of any length is broken with the most recent choice (pitchChoice), with a notice; no normalisation left', () => {
  const { doc, s, kit, T, root } = mount();
  const P = [0, 1, 2].map(o => new osc.OscPanel(root, kit, o));
  T.paint();
  for (const o of [0, 1, 2]) item(P[o].pitchItems(), 'Ratio').action();
  P[0].pitchEdit(undefined, 'B', 'Ratio source');                   // A ← B
  P[1].pitchEdit(undefined, 'C', 'Ratio source');                   // B ← C
  T.paint();
  const srcC = dom.all(P[2].el).find(n => n.classList.contains('wk-menu') && dom.one(n, 'wk-lab') && dom.one(n, 'wk-lab').textContent === 'SRC');
  dom.fire(menuOpts(doc, srcC).find(x => x.textContent === 'A'), 'click');   // C ← A closes A → B → C → A
  closeMenus(doc);
  assert.deepEqual(s.osc.map(O => O.pitch.src), ['B', 'note', 'A']);   // B read C (the most recent choice): Note
  assert.deepEqual(T.log.filter(x => x[0] === 'notify').at(-1), ['notify', 'Ratio source cycle: OSC B set to Note']);
  const n = core.normalizeSerum(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(n.osc.map(O => O.pitch), s.osc.map(O => O.pitch));
  // B ← C again closes B → C → A → B: now A (it read B, the most recent chooser) falls back
  P[1].pitchEdit(undefined, 'C', 'Ratio source');
  assert.deepEqual(s.osc.map(O => O.pitch.src), ['note', 'C', 'A']);
  assert.deepEqual(T.log.filter(x => x[0] === 'notify').at(-1), ['notify', 'Ratio source cycle: OSC A set to Note']);
});

test('warp choices that break a cycle and Swap Warps keep the S1 pairs in sync (§2.6.4)', () => {
  const { doc, s, kit, T, root } = mount();
  const A = new osc.OscPanel(root, kit, 0), B = new osc.OscPanel(root, kit, 1);
  T.paint();
  const pairsOff = () => core.syncS1(JSON.parse(JSON.stringify(s)), '');
  const pick = (el, l) => { const o = menuOpts(doc, el); dom.fire(typeof l === 'number' ? o[l] : o.find(x => x.textContent === l), 'click'); closeMenus(doc); };
  // S2 mode: WARP 1 = Sync, WARP 2 = Bend+, then Swap Warps: a.warpMode follows a.w1 (Bend+)
  pick(byDest(A.el, 'a.w1'), 1);
  pick(byDest(A.el, 'a.w2'), 2);
  assert.deepEqual(pairsOff(), []);
  item(A.menuItems(), 'Swap Warps').action();
  assert.deepEqual([Math.round(s.p['a.w1'] * 81), Math.round(s.p['a.w2'] * 81), Math.round(s.p['a.warpMode'] * 22)], [2, 1, 4]);
  assert.deepEqual(pairsOff(), []);
  // A PD (B) on WARP 1, then B PD (A) on WARP 1: A's slot goes Off — and so does its v1 field
  pick(byDest(A.el, 'a.w1'), 'PD (B)');
  assert.equal(Math.round(s.p['a.warpMode'] * 22), 18);             // PD (o1) = the v1 FM (B)
  pick(byDest(B.el, 'b.w1'), 'PD (A)');
  assert.deepEqual([s.p['a.w1'], s.p['a.warpMode']], [0, 0]);
  assert.deepEqual(pairsOff(), []);
  // S1 mode: B's v1 slot FM (A) against A's v1 FM (B): A's v1 slot goes Off, its S2 counterpart too
  s.global.s1 = 1;
  T.paint();
  s.p['a.warpMode'] = 18 / 22; core.syncS1(s, 'a.warpMode');
  s.p['b.warpMode'] = 0; core.syncS1(s, 'b.warpMode');
  pick(byDest(B.el, 'b.warpMode'), 18);
  assert.deepEqual([s.p['a.warpMode'], s.p['a.w1'], Math.round(s.p['b.warpMode'] * 22)], [0, 0, 18]);
  assert.deepEqual(pairsOff(), []);
});

test('FILTER routing switch tap (serum-core toggleFilterRoute): an on-route source toggles the switch only; two taps restore', () => {
  const { s, kit, T, root } = mount();
  const F1 = new osc.FilterPanel(root, kit, 0);
  T.paint();
  const sw = X => dom.all(F1.el).find(n => n.classList.contains('wk-tog') && n.getAttribute('data-dest') === 'f.route' + X);
  s.p['a.fbal'] = 1;                                                // OSC A on Filter, balance fully at F2
  const before = JSON.stringify(s);
  dom.fire(sw('A'), 'click');
  assert.equal(s.p['a.fbal'], 1);                                    // A does not leave Filter 2
  assert.equal(osc.filterLit(s, 1).A, true);
  dom.fire(sw('A'), 'click');
  assert.equal(JSON.stringify(s), before);
});

test('Missing sample badge and relink (§9.9): Sample and Multisample views, deleted zone samples', async () => {
  const { doc, s, kit, T, root, host } = mount();
  const imports = [];
  host.smp.import = (files, o) => { imports.push(Object.assign({ n: files.length }, o)); return Promise.resolve(o.kind === 'multi' ? o.replace || 'msmp:new' : 'smp:new'); };
  const rec0 = host.smp.record;
  host.smp.record = id => (id === 'msmp:2' ? Promise.resolve({ name: 'Two', zones: [{ lo: 0, hi: 63, vlo: 1, vhi: 127, smp: 'smp:z0' }, { lo: 64, hi: 127, vlo: 1, vhi: 127, smp: 'smp:z1' }], missing: ['smp:z1'] })
    : id === 'smp:new' ? Promise.resolve({ name: 'New', len: 1000, rate: 48000, root: 60 }) : rec0(id));
  const P = new osc.OscPanel(root, kit, 0), V = P.views.sample, MV = P.views.multi, D = osc.oscData(kit);
  s.osc[0].type = 'sample';
  s.osc[0].smp = 'smp:gone';                                        // a user sample deleted from the store
  s.osc[0].smpo.ops = { fade: 0, norm: 0, rev: 1, trim: null };
  T.paint();
  await settle();
  T.paint();
  const badge = v => v.head.find(n => n.classList && n.classList.contains('sxo-miss'));
  assert.equal(hidden(badge(V)), false);
  assert.equal(badge(V).textContent, 'Missing sample');
  const cv = dom.byAttr(V.el, 'data-oscdisp', '0')[0];
  assert.ok(cv.getContext('2d').calls.some(c => c[0] === 'fillText' && /^Missing sample: /.test(c[1])));
  // a drop on the badge relinks: host.smp.import {replace}; this host does not relink itself → the oscillator takes the
  // new id, its operations and markers kept
  dom.fire(badge(V), 'drop', { dataTransfer: { types: ['Files'], files: [{ name: 'x.wav' }] } });
  await settle(6);
  assert.deepEqual(imports.at(-1), { n: 1, kind: 'sample', osc: 0, replace: 'smp:gone' });
  assert.deepEqual([s.osc[0].smp, s.osc[0].smpo.ops.rev], ['smp:new', 1]);
  assert.equal(T.log.filter(x => x[0] === 'edit').at(-1)[1], 'Relink sample');
  T.paint();
  assert.equal(hidden(badge(V)), true);
  // a present sample: drops import as usual (no replace)
  dom.fire(cv, 'drop', { dataTransfer: { types: ['Files'], files: [{ name: 'y.wav' }] } });
  await settle(6);
  assert.equal(imports.at(-1).replace, undefined);
  // Multisample: the deleted instrument itself → relinked under its id
  s.osc[0].type = 'multi';
  s.osc[0].multi = 'msmp:gone';
  T.paint();
  await settle();
  T.paint();
  assert.equal(hidden(badge(MV)), false);
  const mcv = dom.byAttr(MV.el, 'data-oscdisp', '0')[0];
  dom.fire(mcv, 'drop', { dataTransfer: { types: ['Files'], files: [{ name: 'a.sfz' }, { name: 'a.wav' }] } });
  await settle(6);
  assert.deepEqual(imports.at(-1), { n: 2, kind: 'multi', osc: 0, replace: 'msmp:gone' });
  // deleted zone samples of a user multisample: badge with the count, the zones marked, a drop relinks the shown zone's
  s.osc[0].multi = 'msmp:2';
  T.paint();
  await settle();
  T.paint();
  assert.deepEqual(MV.missingZones(), ['smp:z1']);
  assert.equal(hidden(badge(MV)), false);
  assert.deepEqual(MV.relinkTarget(), { id: 'smp:z1', kind: 'sample' });
  assert.ok(mcv.getContext('2d').calls.some(c => c[0] === 'fillText' && /1 missing$/.test(c[1])));
  dom.fire(mcv, 'drop', { dataTransfer: { types: ['Files'], files: [{ name: 'z1.wav' }] } });
  await settle(6);
  assert.deepEqual(imports.at(-1), { n: 1, kind: 'sample', osc: 0, replace: 'smp:z1' });
  assert.equal(s.osc[0].multi, 'msmp:2');
  void D;
});

test('stale sample caches: a missing factory record is asked again (re-selection at once, else after a while); forget() drops what may be stale', async () => {
  const { s, kit, T, root, host } = mount();
  const ready = { 'fmsmp:Keys/EP': false, 'fmsmp:Keys/Organ': false };
  const zones = [{ lo: 0, hi: 127, vlo: 1, vhi: 127, smp: 'fmsmp:EP#60.100' }];
  host.smp.record = id => Promise.resolve(ready[id] ? { name: id, zones } : null);
  const P = new osc.OscPanel(root, kit, 0), V = P.views.multi, D = osc.oscData(kit);
  s.osc[0].type = 'multi';
  s.osc[0].multi = 'fmsmp:Keys/EP';
  T.paint();
  await settle();
  assert.equal(V.zones().length, 0);
  // forget() (preset load, undo …): the missing record is asked again
  D.forget();
  assert.equal(D.recs.has('fmsmp:Keys/EP'), false);
  T.paint();
  await settle();
  assert.equal(V.zones().length, 0);
  ready['fmsmp:Keys/EP'] = true;                                    // host.smp.retry: generated
  dom.fire(dom.one(V.head[0], 'wk-next'), 'click');                 // Organ (not generated yet) …
  T.paint();
  await settle();
  assert.equal(V.zones().length, 0);
  dom.fire(dom.one(V.head[0], 'wk-prev'), 'click');                 // … and EP again: asked at once
  T.paint();
  await settle();
  assert.equal(V.zones().length, 1);
  // a present record survives forget() (no reload of every display on an undo)
  D.forget();
  assert.equal(D.recs.get('fmsmp:Keys/EP').state, 'ok');
  // without a re-selection: the missing entry expires (MISS_MS) and the next repaint asks again
  s.osc[0].multi = 'fmsmp:Keys/Organ';
  T.paint();
  await settle();
  assert.equal(V.zones().length, 0);
  ready['fmsmp:Keys/Organ'] = true;
  T.paint();
  await settle();
  assert.equal(V.zones().length, 0);                                // not yet: no request storm
  D.recs.get('fmsmp:Keys/Organ').t -= 10000;
  T.paint();
  await settle();
  assert.equal(V.zones().length, 1);
});

/* ================================================================ review fixes: displays and gestures */

test('Spectral view: the spectrogram and its waveform overlay through Trim / Reverse; rows on the 20 Hz … 20 kHz axis (specRect)', async () => {
  // specRect: 48 kHz record (rows to 24 kHz) → the top rows above 20 kHz cut; 32 kHz (rows to 16 kHz) → the lower part
  const r48 = osc.specRect(256, 96, 0.5, 1, 48000, 100), s48 = Math.log(1000) / Math.log(24000 / 20);
  assert.deepEqual([r48.sx, r48.sw, r48.dy, r48.dh], [128, 128, 0, 100]);
  near(r48.sh, 96 * s48, 1e-9); near(r48.sy, 96 * (1 - s48), 1e-9);
  const r32 = osc.specRect(256, 96, 0, 1, 32000, 100), s32 = Math.log(1000) / Math.log(16000 / 20);
  assert.deepEqual([r32.sx, r32.sw, r32.sy, r32.sh], [0, 256, 0, 96]);
  near(r32.dh, 100 / s32, 1e-9); near(r32.dy, 100 - 100 / s32, 1e-9);
  // a handle at 1 kHz (yOfHz) sits over the image row of 1 kHz: row fraction from the bottom = log(50)/log(fHi/20)
  const y1k = 1 - Math.log(50) / Math.log(1000), row = r48.sy + y1k * r48.sh;
  near(1 - row / 96, Math.log(50) / Math.log(24000 / 20), 1e-9);
  const { s, kit, T, root } = mount();
  const P = new osc.OscPanel(root, kit, 0), V = P.views.spec, D = osc.oscData(kit);
  s.osc[0].type = 'spec';
  s.osc[0].smp = 'smp:1';
  D.smpInfo('smp:1'); D.spectrogram('smp:1'); D.overview('smp:1');
  await settle();
  D.specs.get('smp:1').img = { fake: 1 };                            // skip the offscreen image (no canvas in node)
  s.osc[0].smpo.wave = 1;
  const drawn = ops => {
    s.osc[0].smpo.ops = Object.assign({ fade: 0, norm: 0 }, ops);
    const g = dom.fresh().createElement('canvas').getContext('2d');
    V.drawBg(g, 256, 96, 1, { a: 0, b: 1 });
    return g.calls;
  };
  let c = drawn({ rev: 0, trim: [0.5, 1] });
  const di = c.find(x => x[0] === 'drawImage');
  assert.deepEqual([di[2], di[4]], [128, 128]);                       // the source columns of the trimmed region
  assert.ok(!c.some(x => x[0] === 'scale'));
  c = drawn({ rev: 1, trim: null });
  assert.ok(c.some(x => x[0] === 'scale' && x[1] === -1 && x[2] === 1));   // mirrored, as the waveform
  const di2 = c.find(x => x[0] === 'drawImage');
  assert.deepEqual([di2[2], di2[4]], [0, 256]);
});

test('markerLayout: the Rev Loop crossfade lies after LS (where sx-sample fades), limited by the room after LE', () => {
  const L = osc.markerLayout({ S: 0, E: 1, LS: 0.4, LE: 0.8, X: 0.5, loop: 2 }, null, 1000);
  near(L.xfade.u0, 0.4); near(L.xfade.u1, 0.5); near(L.xfade.wrap, 0.4); near(L.xfade.len, 0.1);
  const xf = L.markers.find(m => m.id === 'XF');
  near(xf.x, 400);
  near(osc.markerLayout({ S: 0, E: 1, LS: 0.4, LE: 0.95, X: 1, loop: 2 }, null, 1).xfade.len, 0.05);   // 5 % after LE
  const Lb = osc.markerLayout({ S: 0, E: 1, LS: 0.8, LE: 0.4, X: 0.5, loop: 2 }, null, 1);   // backward-ordered
  near(Lb.xfade.u0, 0.7); near(Lb.xfade.u1, 0.8); near(Lb.xfade.wrap, 0.8);
});

test('sample display gestures: a pinch never fires the long-press; a lost capture or a button-less hover ends a drag; a new press replaces a stale one', async () => {
  const { s, kit, T, root, doc } = mount();
  const P = new osc.OscPanel(root, kit, 0), V = P.views.sample, c = V.cv.el;
  s.osc[0].type = 'sample'; s.osc[0].smp = 'smp:1';
  s.osc[0].smpo.slice.mode = 2;                                      // Manual: a long-press would add a mark
  dom.place(c, 0, 0, 400, 100);
  T.paint();
  const t = id => ({ pointerType: 'touch', pointerId: id });
  dom.ptr(c, 'pointerdown', 150, 50, t(11));
  dom.ptr(c, 'pointerdown', 250, 50, t(12));
  for (let k = 1; k <= 10; k++) { dom.ptr(c, 'pointermove', 150 - 6 * k, 50, t(11)); dom.ptr(c, 'pointermove', 250 + 6 * k, 50, t(12)); }
  await new Promise(r => setTimeout(r, 600));
  assert.ok(V.zv.b - V.zv.a < 0.9);                                  // the pinch zoomed (wk.zoomPan)
  assert.deepEqual(s.osc[0].smpo.slice.marks, []);
  assert.equal(dom.byCls(doc.body, 'wk-ctx').length, 0);
  dom.ptr(c, 'pointerup', 90, 50, t(11)); dom.ptr(c, 'pointerup', 310, 50, t(12));
  assert.equal(V.g, null);
  // a one-finger long-press still works
  dom.ptr(c, 'pointerdown', 200, 50, t(21));
  await new Promise(r => setTimeout(r, 560));
  assert.equal(s.osc[0].smpo.slice.marks.length, 1);
  dom.ptr(c, 'pointerup', 200, 50, t(21));
  // the S marker dragged, then the capture lost: the gesture ends; a later hover edits nothing
  V.zv = { a: 0, b: 1 };
  s.p['a.sstart'] = 0.3;
  T.paint();
  dom.ptr(c, 'pointerdown', 120, 50); dom.ptr(c, 'pointermove', 140, 50);
  dom.fire(c, 'lostpointercapture', { pointerId: 1 });
  assert.equal(V.g, null);
  const s0 = s.p['a.sstart'];
  assert.deepEqual(T.log.filter(x => x[0] === 'setN' && x[1] === 'a.sstart').map(x => x[3]).slice(-2), ['start', 'end']);
  dom.fire(c, 'pointermove', { pointerId: 1, clientX: 300, clientY: 50, buttons: 0 });
  assert.equal(s.p['a.sstart'], s0);
  // a pointerup that never arrived: a button-less mouse move ends the drag (no edit), a new press starts afresh
  dom.ptr(c, 'pointerdown', 140, 50); dom.ptr(c, 'pointermove', 180, 50);
  const s1 = s.p['a.sstart'];
  dom.fire(c, 'pointermove', { pointerId: 1, clientX: 300, clientY: 50, buttons: 0 });
  assert.equal(s.p['a.sstart'], s1);
  assert.equal(V.g, null);
  dom.ptr(c, 'pointerdown', 380, 90); dom.ptr(c, 'pointermove', 380, 10); dom.ptr(c, 'pointerup', 380, 10);
  assert.equal(s.p['a.sstart'], s1);                                 // a zoom, not a marker move
  assert.ok(V.zv.b - V.zv.a < 0.5);
  assert.deepEqual(T.log.filter(x => x[0] === 'setN' && x[1] === 'a.sstart').at(-1)[3], 'end');
});

test('FILTER display: a finger drags relatively after an 8 px slop (a tap with jitter cycles the views); lost capture ends a drag', () => {
  const { s, kit, T, root } = mount();
  const fl = new osc.FilterPanel(root, kit, 0);
  T.paint();
  const disp = dom.byCls(fl.el, 'sx-disp')[0];
  dom.place(disp, 0, 0, 200, 100);
  s.p['f.cutoff'] = 0.5; s.p['f.res'] = 0.2;
  const t = { pointerType: 'touch', pointerId: 5 };
  dom.ptr(disp, 'pointerdown', 20, 80, t); dom.ptr(disp, 'pointermove', 26, 76, t); dom.ptr(disp, 'pointerup', 26, 76, t);
  assert.deepEqual([s.p['f.cutoff'], s.p['f.res'], s.ui.filtView[0]], [0.5, 0.2, 2]);   // a tap: the view cycles
  dom.ptr(disp, 'pointerdown', 20, 80, t); dom.ptr(disp, 'pointermove', 60, 60, t); dom.ptr(disp, 'pointerup', 60, 60, t);
  near(s.p['f.cutoff'], 0.7); near(s.p['f.res'], 0.4);              // from the values at the press, not the finger
  // a mouse puts the point under the pointer; a lost capture ends the drag where it was
  dom.ptr(disp, 'pointerdown', 20, 30); dom.ptr(disp, 'pointermove', 50, 25);
  assert.deepEqual([s.p['f.cutoff'], s.p['f.res']], [0.25, 0.75]);
  dom.fire(disp, 'lostpointercapture', { pointerId: 1 });
  dom.fire(disp, 'pointermove', { pointerId: 1, clientX: 150, clientY: 90, buttons: 0 });
  assert.deepEqual([s.p['f.cutoff'], s.p['f.res']], [0.25, 0.75]);
  assert.deepEqual(T.log.filter(x => x[1] === 'Filter cutoff / res').at(-1)[2], 'end');
});

// gesture.js's two-finger layer cancels the first finger with a synthetic pointercancel flagged e.gesture === 'two-finger':
// what the drag set goes back to its value at the press; a plain pointercancel keeps it (as before)
const TW = { pointerType: 'touch', pointerId: 9 }, TWO = { pointerType: 'touch', pointerId: 9, gesture: 'two-finger' };
test('two-finger rollback: the sample display — S marker, loop band, X-fade and the view drag come back; a plain cancel keeps', async () => {
  const { s, kit, T, root } = mount();
  const P = new osc.OscPanel(root, kit, 0), V = P.views.sample;
  s.osc[0].type = 'sample'; s.osc[0].smp = 'smp:1';
  T.paint(); await settle(); T.paint();
  const cv = dom.byAttr(V.el, 'data-oscdisp', '0')[0];
  dom.place(cv, 0, 0, 1000, 100);
  const S0 = kit.getN('a.sstart');
  dom.ptr(cv, 'pointerdown', 2, 50, TW); dom.ptr(cv, 'pointermove', 200, 50, TW); dom.ptr(cv, 'pointermove', 300, 50, TW);
  near(kit.getN('a.sstart'), 0.3);
  dom.ptr(cv, 'pointercancel', 300, 50, TWO);
  assert.equal(kit.getN('a.sstart'), S0);
  assert.deepEqual(T.log.filter(x => x[0] === 'setN' && x[1] === 'a.sstart').map(x => x[3]), ['start', 'move', 'move', 'end']);
  assert.equal(V.g, null);
  dom.ptr(cv, 'pointerdown', 2, 50, TW); dom.ptr(cv, 'pointermove', 300, 50, TW); dom.ptr(cv, 'pointercancel', 300, 50, TW);
  near(kit.getN('a.sstart'), 0.3);                                  // plain: kept
  // the loop band (one edit at the end puts both markers back)
  s.osc[0].smpo.loop = 1; s.p['a.lstart'] = 0.4; s.p['a.lend'] = 0.6;
  T.paint();
  dom.ptr(cv, 'pointerdown', 500, 10, TW); dom.ptr(cv, 'pointermove', 550, 10, TW);
  near(s.p['a.lstart'], 0.45);
  dom.ptr(cv, 'pointercancel', 550, 10, TWO);
  assert.deepEqual([s.p['a.lstart'], s.p['a.lend']], [0.4, 0.6]);
  assert.deepEqual(T.log.filter(x => x[1] === 'Move loop').map(x => x[2]), ['start', 'end']);
  // the X-fade handle
  const L = osc.markerLayout(V.mm(), V.viewR(), 1000), xf = L.markers.find(m => m.id === 'XF'), y0 = V.xfY(xf.y, 100), X0 = kit.getN('a.xfade');
  dom.ptr(cv, 'pointerdown', xf.x, y0, TW); dom.ptr(cv, 'pointermove', xf.x, y0 - 42, TW);
  assert.notEqual(kit.getN('a.xfade'), X0);
  dom.ptr(cv, 'pointercancel', xf.x, y0 - 42, TWO);
  assert.equal(kit.getN('a.xfade'), X0);
  // a zoom drag on the empty display: the view as it was
  const v0 = JSON.stringify(V.viewR());
  dom.ptr(cv, 'pointerdown', 250, 90, TW); dom.ptr(cv, 'pointermove', 250, 0, TW);
  assert.notEqual(JSON.stringify(V.viewR()), v0);
  dom.ptr(cv, 'pointercancel', 250, 0, TWO);
  assert.equal(JSON.stringify(V.viewR()), v0);
});

test('two-finger rollback: a pinch on the sample display itself (an own element: no gesture.js cancel) rolls the first finger\'s S marker back; a view drag keeps its view (the pinch starts from it)', async () => {
  const { s, kit, T, root } = mount();
  const P = new osc.OscPanel(root, kit, 0), V = P.views.sample;
  s.osc[0].type = 'sample'; s.osc[0].smp = 'smp:1';
  T.paint(); await settle(); T.paint();
  const cv = dom.byAttr(V.el, 'data-oscdisp', '0')[0];
  dom.place(cv, 0, 0, 1000, 100);
  const t = id => ({ pointerType: 'touch', pointerId: id }), log = () => T.log.filter(x => x[0] === 'setN' && x[1] === 'a.sstart').map(x => x[3] + ':' + x[2]);
  const S0 = kit.getN('a.sstart');
  dom.ptr(cv, 'pointerdown', 2, 50, t(31)); dom.ptr(cv, 'pointermove', 300, 50, t(31));
  near(kit.getN('a.sstart'), 0.3);
  dom.ptr(cv, 'pointerdown', 600, 50, t(32));                       // the second finger on the same display
  assert.equal(kit.getN('a.sstart'), S0);
  assert.deepEqual(log().slice(-2), ['move:' + S0, 'end:' + S0]);
  assert.equal(V.g, null);
  for (let k = 1; k <= 5; k++) { dom.ptr(cv, 'pointermove', 300 - 10 * k, 50, t(31)); dom.ptr(cv, 'pointermove', 600 + 10 * k, 50, t(32)); }
  assert.ok(V.zv && V.zv.b - V.zv.a < 0.95);                        // the pinch zoomed
  assert.equal(kit.getN('a.sstart'), S0);                           // the first finger edits nothing more
  dom.ptr(cv, 'pointerup', 250, 50, t(31)); dom.ptr(cv, 'pointerup', 650, 50, t(32));
  // a one-finger zoom drag on the empty display, then a second finger: the view stays as dragged (no jump back)
  V.zv = { a: 0, b: 1 };
  dom.ptr(cv, 'pointerdown', 450, 90, t(33)); dom.ptr(cv, 'pointermove', 450, 20, t(33));
  const dragged = JSON.stringify(V.viewR());
  assert.notEqual(dragged, JSON.stringify({ a: 0, b: 1 }));
  dom.ptr(cv, 'pointerdown', 700, 50, t(34));
  assert.equal(JSON.stringify(V.viewR()), dragged);
  dom.ptr(cv, 'pointerup', 450, 20, t(33)); dom.ptr(cv, 'pointerup', 700, 50, t(34));
});

test('two-finger rollback: the X|Y dot (and its jump), Spectral Hi / Lo handles, the multisample envelope graph, the FILTER display and the grain window Alt-drag', async () => {
  // X|Y dot (Granular, Manual X|Y): the press jumps the dot — both axes come back
  {
    const { s, kit, root, T } = mount();
    const P = new osc.OscPanel(root, kit, 0), V = P.views.gran;
    s.osc[0].type = 'gran'; s.osc[0].smp = 'smp:1';
    T.paint();
    item(V.loopItems(), 'Manual (X|Y)').action();
    T.paint();
    const cv = dom.byAttr(V.el, 'data-oscdisp', '0')[0], dot = dom.byAttr(V.el, 'data-xy', '1')[0];
    dom.place(cv, 0, 0, 1000, 100);
    const x0 = kit.getN('a.pos'), y0 = kit.getN('a.gy');
    dom.ptr(dot, 'pointerdown', 250, 25, TW); dom.ptr(dot, 'pointermove', 300, 30, TW);
    assert.notEqual(kit.getN('a.pos'), x0);
    dom.ptr(dot, 'pointercancel', 300, 30, TWO);
    assert.deepEqual([kit.getN('a.pos'), kit.getN('a.gy'), T.held.size], [x0, y0, 0]);
    dom.ptr(dot, 'pointerdown', 250, 25, TW); dom.ptr(dot, 'pointercancel', 250, 25, TW);
    assert.deepEqual([s.p['a.pos'], s.p['a.gy']], [0.25, 0.75]);   // plain: kept
    // the grain window's Alt-drag (amount x / skew y)
    const wb = byLabel(V.el, 'Grain window (OSC A); Alt-drag: amount (x) / skew (y)');
    const a0 = kit.getN('a.wamt'), k0 = kit.getN('a.wskew');
    dom.ptr(wb, 'pointerdown', 100, 100, Object.assign({ altKey: true }, TW)); dom.ptr(wb, 'pointermove', 70, 115, TW);
    assert.notEqual(kit.getN('a.wamt'), a0);
    dom.ptr(wb, 'pointercancel', 70, 115, TWO);
    assert.deepEqual([kit.getN('a.wamt'), kit.getN('a.wskew'), T.held.size], [a0, k0, 0]);
  }
  // Spectral Hi handle: the press puts it at the finger — the frequency from before comes back
  {
    const { s, kit, root, T } = mount();
    const P = new osc.OscPanel(root, kit, 0), V = P.views.spec;
    s.osc[0].type = 'spec'; s.osc[0].smp = 'smp:1';
    T.paint();
    const [hi] = V.hl, cv = dom.byAttr(V.el, 'data-oscdisp', '0')[0];
    dom.place(cv, 0, 0, 1000, 100);
    const h0 = kit.getN('a.fhi');
    dom.ptr(hi.h, 'pointerdown', 990, 50, TW);
    assert.notEqual(kit.getN('a.fhi'), h0);
    dom.ptr(hi.h, 'pointercancel', 990, 50, TWO);
    assert.equal(kit.getN('a.fhi'), h0);
    assert.deepEqual(T.log.filter(x => x[0] === 'setN' && x[1] === 'a.fhi').map(x => x[3]), ['start', 'move', 'end']);
  }
  // the multisample envelope graph (attack corner)
  {
    const { doc, s, kit, root, T } = mount();
    const P = new osc.OscPanel(root, kit, 0), V = P.views.multi;
    s.osc[0].type = 'multi'; s.osc[0].multi = 'fmsmp:Keys/EP';
    T.paint();
    const box = popBox(doc, openPop(T, root, 'Multisample envelope (OSC A)'));
    T.paint();
    const ecv = dom.byCls(box, 'sxo-mini')[0];
    dom.place(ecv, 0, 0, 260, 44);
    const G = V.envGeo(260, 44), [ax, ay] = G.pts[2], m0 = kit.getN('a.matt');
    dom.ptr(ecv, 'pointerdown', ax, ay, TW); dom.ptr(ecv, 'pointermove', ax + 20, ay, TW);
    assert.notEqual(kit.getN('a.matt'), m0);
    dom.ptr(ecv, 'pointercancel', ax + 20, ay, TWO);
    assert.deepEqual([kit.getN('a.matt'), T.held.size], [m0, 0]);
    dom.ptr(ecv, 'pointerdown', ax, ay, TW); dom.ptr(ecv, 'pointermove', ax + 20, ay, TW); dom.ptr(ecv, 'pointercancel', ax + 20, ay, TW);
    assert.notEqual(kit.getN('a.matt'), m0);                       // plain: kept
  }
  // the FILTER display (a finger drags relatively after the slop)
  {
    const { s, kit, root, T } = mount();
    const fl = new osc.FilterPanel(root, kit, 0);
    T.paint();
    const disp = dom.byCls(fl.el, 'sx-disp')[0];
    dom.place(disp, 0, 0, 200, 100);
    s.p['f.cutoff'] = 0.5; s.p['f.res'] = 0.2;
    dom.ptr(disp, 'pointerdown', 20, 80, TW); dom.ptr(disp, 'pointermove', 60, 60, TW);
    near(s.p['f.cutoff'], 0.7);
    dom.ptr(disp, 'pointercancel', 60, 60, TWO);
    assert.deepEqual([s.p['f.cutoff'], s.p['f.res'], s.ui.filtView[0] | 0], [0.5, 0.2, 0]);   // (no view cycle either)
    assert.equal(T.log.filter(x => x[1] === 'Filter cutoff / res').at(-1)[2], 'end');
  }
});

test('display keys follow unison (stalks) and every slice mark; the grain window button takes touch drags', () => {
  const { doc, s, kit, T, root } = mount();
  const P = new osc.OscPanel(root, kit, 0), V = P.views.sample;
  s.osc[0].type = 'sample'; s.osc[0].smp = 'smp:1';
  s.osc[0].smpo.slice = { mode: 2, thr: 0.5, marks: [0.2, 0.4, 0.8], toEnd: 0, single: 0, root: 36, sync: 0 };
  const k0 = V.key();
  s.osc[0].smpo.slice.marks = [0.2, 0.6, 0.8];
  const k1 = V.key();
  assert.notEqual(k1, k0);
  s.p['a.uni'] = core.lawNorm('a.uni', 7);
  assert.notEqual(V.key(), k1);
  const css = dom.all(doc.head).find(n => n.id === 'sxo-css');
  assert.match(css.textContent, /\.sxo-win \{ touch-action: none; \}/);
});

test('real DSP: Render OSC Warp in the voice order (S1 legacy slot as its S2 rendition), per-slot modulators, spectral slots acting Off', async t => {
  const vm = await import('node:vm'), fs = await import('node:fs');
  const wtReal = await import('../wt.js?real');
  const ctx = vm.createContext({ console });
  for (const f of ['sx-base.js', 'sx-filt2.js', 'sx-warp.js', 'serum-dsp.js']) vm.runInContext(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), ctx, { filename: f });
  const G = ['SerumDSP', 'SxWarp', 'SxFilt2'];
  for (const k of G) globalThis[k] = ctx[k];
  t.after(() => { for (const k of G) delete globalThis[k]; });
  const X = ctx.SxWarp, DSP = ctx.SerumDSP;
  const saw = wtReal.bandlimit(Float32Array.from({ length: 2048 }, (_, i) => 1 - 2 * i / 2048), 1);
  const sine = Float32Array.from({ length: 2048 }, (_, i) => Math.sin(2 * Math.PI * i / 2048));
  const relDb = (a, b) => { let e = 0, r = 0; for (let i = 0; i < b.length; i++) { e += (a[i] - b[i]) ** 2; r += b[i] ** 2; } return 10 * Math.log10(Math.max(1e-30, e / r)); };
  const setup = fn => {
    const M = mount({ wt: wtReal });
    const saved = [];
    M.host.wt.get = id => Promise.resolve(id === 'factory:Sine' ? { name: 'Sine', frames: [sine], morph: 0 } : { name: 'Saw', frames: [saw], morph: 0 });
    M.host.wt.saveNew = tb => { saved.push(tb); return Promise.resolve('user:r' + saved.length); };
    M.s.osc[0].wt = 'factory:Saw'; M.s.osc[1].wt = 'factory:Sine';
    fn(M.s);
    const D = osc.oscData(M.kit);
    D.tinfo(0); D.tinfo(1);
    return Object.assign(M, { D, saved });
  };
  // S1 mode, legacy Bend+ (v1 4) swept with WARP 2 PWM at 60 %: frame f = renderWarp2([Bend+ at f/255, PWM]) — the
  // order the voice plays them in (legacy phase stage first, slot 2's on its output), over 4, band-limited
  const A = setup(s => { s.global.s1 = 1; s.p['a.warpMode'] = 4 / 22; s.p['a.w2'] = 5 / 81; s.p['a.warp2'] = 0.6; });
  await settle();
  assert.equal(A.D.canRenderWarp(0), true);
  await A.D.renderOscWarp(0);
  assert.equal(A.saved.length, 1);
  for (const f of [0, 64, 255]) {
    const ref = wtReal.bandlimit(X.renderWarp2(saw, [{ mode: 2, w: f / 255, v: 0, fm: 0 }, { mode: 5, w: 0.6, v: 0, fm: 0 }], { over: 4 }), 4);
    assert.ok(relDb(A.saved[0].frames[f], ref) < -120, 'frame ' + f);
  }
  assert.deepEqual([A.s.p['a.warpMode'], A.s.p['a.w1'], Math.round(A.s.p['a.w2'] * 81)], [0, 0, 5]);   // the swept v1 slot Off, synced
  // legacy Bend+ alone equals the Phase-1 renderer at over 4
  const A1 = setup(s => { s.global.s1 = 1; s.p['a.warpMode'] = 4 / 22; });
  await settle();
  await A1.D.renderOscWarp(0);
  assert.ok(relDb(A1.saved[0].frames[200], wtReal.bandlimit(DSP.renderWarp(saw, 4, 200 / 255, { over: 4 }), 4)) < -120);
  // Sync 1/2 Win. (no exact S2 rendition) with an output-domain slot 2: the Phase-1 slot, then slot 2 on its result
  const A2 = setup(s => { s.global.s1 = 1; s.p['a.warpMode'] = 2 / 22; s.p['a.w2'] = 19 / 81; s.p['a.warp2'] = 0.5; });
  await settle();
  await A2.D.renderOscWarp(0);
  const st1 = wtReal.bandlimit(DSP.renderWarp(saw, 2, 1, { over: 4 }), 4);
  assert.ok(relDb(A2.saved[0].frames[255], wtReal.bandlimit(X.renderWarp2(st1, [null, { mode: 19, w: 0.5, v: 0, fm: 0 }], { over: 4 }), 4)) < -120);
  // the 2D preview takes the same order (S1, Bend+ 80 % + PWM 60 %), at over 1
  const Pv = new osc.OscPanel(A1.root, A1.kit, 0);
  A1.s.p['a.warpMode'] = 4 / 22; A1.s.p['a.warp'] = 0.8; A1.s.p['a.w2'] = 5 / 81; A1.s.p['a.warp2'] = 0.6;
  const pv = Pv.views.wt.warped(saw);
  assert.ok(relDb(pv, X.renderWarp2(saw, [{ mode: 2, w: 0.8, v: 0, fm: 0 }, { mode: 5, w: 0.6, v: 0, fm: 0 }], { over: 1 })) < -120);
  // two modulators: WARP 1 FM (B) swept, WARP 2 AM (Noise) — AM (output domain) runs on the band-limited FM result with
  // its own (noise) modulator
  const B = setup(s => { s.p['a.w1'] = 33 / 81; s.p['a.warp'] = 0.5; s.p['a.w2'] = 48 / 81; s.p['a.warp2'] = 1; });
  await settle();
  await B.D.renderOscWarp(0);
  const noise = B.D.modCycle(0, 'noise');
  const fm1 = wtReal.bandlimit(X.renderWarp2(saw, [{ mode: 33, w: 1, v: 0, fm: 0 }, null], { over: 4, mod: sine }), 4);
  const want = wtReal.bandlimit(X.renderWarp2(fm1, [null, { mode: 48, w: 1, v: 0, fm: 0 }], { over: 4, mod: noise }), 4);
  assert.ok(relDb(B.saved[0].frames[255], want) < -120);
  const oneMod = wtReal.bandlimit(X.renderWarp2(saw, [{ mode: 33, w: 1, v: 0, fm: 0 }, { mode: 48, w: 1, v: 0, fm: 0 }], { over: 4, mod: sine }), 4);
  assert.ok(relDb(oneMod, want) > -20);                               // (one shared modulator is a different sound)
  // a spectral mode on a Wavetable oscillator acts as Off (§3.4.2): WARP 2 is swept; both inert ⇒ nothing to render
  const C = setup(s => { s.p['a.w1'] = 63 / 81; s.p['a.w2'] = 2 / 81; });
  await settle();
  assert.equal(C.D.canRenderWarp(0), true);
  await C.D.renderOscWarp(0);
  const fr = C.saved[0].frames;
  assert.ok(relDb(fr[0], fr[255]) > -20);                             // a sweep, not 256 equal frames
  assert.deepEqual([Math.round(C.s.p['a.w1'] * 81), C.s.p['a.w2']], [63, 0]);
  C.s.p['a.w2'] = 70 / 81;                                            // Shepard (spectral) too
  assert.equal(C.D.canRenderWarp(0), false);
});

/* ================================================================ pure helpers */

test('filterLit: route, balance share and switch per filter', () => {
  const s = fresh();
  assert.deepEqual(osc.filterLit(s, 0), { S: false, A: true, B: false, C: false, N: false });
  s.sub.route = 0; s.noise.route = 0; s.p['n.fbal'] = 0.5;
  assert.deepEqual([osc.filterLit(s, 0).S, osc.filterLit(s, 0).N, osc.filterLit(s, 1).N, osc.filterLit(s, 1).S], [true, true, true, false]);
  s.p['f2.routeN'] = 0;
  assert.equal(osc.filterLit(s, 1).N, false);
  assert.deepEqual(osc.filterLit(null, 0), { S: false, A: false, B: false, C: false, N: false });
});

test('autoSlices: onset peaks above the threshold, ≥ 50 ms apart (stronger wins), ≤ 256, sorted fractions', () => {
  const odf = new Float32Array(100);
  odf[10] = 0.9; odf[11] = 0.95; odf[30] = 0.7; odf[60] = 0.4;
  // hop 256 at 48 kHz: 50 ms = 2400 frames ≈ 9.4 hops; peaks 11 (2816) and 30 (7680)
  assert.deepEqual(osc.autoSlices(odf, 0.5, 48000, 25600, 256), [0.11, 0.3]);
  assert.deepEqual(osc.autoSlices(odf, 0.3, 48000, 25600, 256), [0.11, 0.3, 0.6]);
  const close = new Float32Array(20);
  close[14] = 0.8; close[16] = 0.9;                               // 512 frames apart: the stronger (16) stays
  assert.deepEqual(osc.autoSlices(close, 0.5, 48000, 8192, 256), [0.5]);
  const early = new Float32Array(20);
  early[4] = 0.9;                                                 // 1024 frames = 21 ms: closer than 50 ms to the start
  assert.deepEqual(osc.autoSlices(early, 0.5, 48000, 4096, 256), []);
  const flat = new Float32Array(40);
  flat[20] = 0.8; flat[21] = 0.8;                                 // a plateau: its first frame (> left, ≥ right)
  assert.deepEqual(osc.autoSlices(flat, 0.5, 48000, 10240, 256), [0.5]);
  assert.deepEqual(osc.autoSlices(null, 0.5, 48000, 1000), []);
  assert.deepEqual(osc.autoSlices(odf, 0.5, 48000, 0), []);
  const many = new Float32Array(4000).map((_, i) => (i % 12 === 6 ? 1 : 0));
  assert.equal(osc.autoSlices(many, 0.5, 48000, 4000 * 256, 256).length, 256);
});

test('autoSlices = smp.slicesFromOdf (the §9.4.5 helper of S1, run in a child process: its wt.js import is stubbed here) on random onset functions', async () => {
  const { execFileSync } = await import('node:child_process');
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const cases = [];
  for (let c = 0; c < 60; c++) {
    const n = 40 + Math.floor(rnd() * 700), q = 0.05 + 0.2 * rnd();
    const d = Array.from({ length: n }, () => (rnd() < q ? Math.round(rnd() * 64) / 64 : rnd() * 0.15));   // plateaus and ties included
    cases.push({ d, thr: [0.2, 0.5, 0.8][c % 3], rate: [44100, 48000, 96000][c % 3], len: n * 256 - Math.floor(rnd() * 256) });
  }
  const code = "let b = ''; process.stdin.on('data', x => { b += x; }).on('end', () => import(" + JSON.stringify(new URL('../smp.js', import.meta.url).href) +
    ").then(m => process.stdout.write(JSON.stringify(JSON.parse(b).map(c => m.slicesFromOdf(Float32Array.from(c.d), c.thr, c.rate, c.len))))));";
  const ref = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { input: JSON.stringify(cases), encoding: 'utf8' }));
  let marks = 0;
  cases.forEach((c, i) => {
    const want = ref[i].map(u => Math.round(u * 1e5) / 1e5);
    assert.deepEqual(osc.autoSlices(Float32Array.from(c.d), c.thr, c.rate, c.len, 256), want, 'case ' + i);
    marks += want.length;
  });
  assert.ok(marks > 100);
});

test('xyToN: box fraction, y up, clamped; x through the zoom view', () => {
  const r = { left: 10, top: 20, width: 200, height: 100 };
  assert.deepEqual(osc.xyToN(110, 45, r), { x: 0.5, y: 0.75 });
  assert.deepEqual(osc.xyToN(-50, 500, r), { x: 0, y: 0 });
  assert.deepEqual(osc.xyToN(900, -9, r), { x: 1, y: 1 });
  assert.deepEqual(osc.xyToN(110, 45, r, { a: 0.25, b: 0.75 }), { x: 0.5, y: 0.75 });
  const z = osc.xyToN(60, 45, r, { a: 0.2, b: 0.6 });
  assert.ok(Math.abs(z.x - 0.3) < 1e-12 && z.y === 0.75);
  assert.deepEqual(osc.xyToN(110, 45, r, { a: 0.5, b: 0.5 }), { x: 0.5, y: 0.75 });   // degenerate view = whole
  assert.deepEqual(osc.xyToN(3, 4, { left: 0, top: 0, width: 0, height: 0 }), { x: 1, y: 0 });   // zero box: 1 px
  assert.deepEqual(osc.xyToN(NaN, 4, null), { x: 0, y: 0 });
});

test('sliceAt: slice index and bounds over [0, marks…, 1]; the mark within tol', () => {
  const marks = [0.2, 0.5, 0.8];
  assert.deepEqual(osc.sliceAt(marks, 0.1), { j: 0, a: 0, b: 0.2, mark: -1 });
  assert.deepEqual(osc.sliceAt(marks, 0.2), { j: 1, a: 0.2, b: 0.5, mark: 0 });    // a mark starts its slice
  assert.deepEqual(osc.sliceAt(marks, 0.6), { j: 2, a: 0.5, b: 0.8, mark: -1 });
  assert.deepEqual(osc.sliceAt(marks, 1), { j: 3, a: 0.8, b: 1, mark: -1 });
  assert.deepEqual(osc.sliceAt(marks, 7), { j: 3, a: 0.8, b: 1, mark: -1 });
  assert.deepEqual(osc.sliceAt(marks, -1), { j: 0, a: 0, b: 0.2, mark: -1 });
  assert.equal(osc.sliceAt(marks, 0.52, 0.03).mark, 1);
  assert.equal(osc.sliceAt(marks, 0.47, 0.02).mark, -1);
  assert.equal(osc.sliceAt([0.5, 0.52], 0.515, 0.02).mark, 1);   // nearest of two
  assert.deepEqual(osc.sliceAt([0.8, 0.2, 0.5], 0.6), { j: 2, a: 0.5, b: 0.8, mark: -1 });   // order-free
  assert.deepEqual(osc.sliceAt([], 0.4), { j: 0, a: 0, b: 1, mark: -1 });
  assert.deepEqual(osc.sliceAt(null, 0.4), { j: 0, a: 0, b: 1, mark: -1 });
});

test('markerLayout: S / E, loop band and crossfade per loop mode, slices, playhead, zoom', () => {
  const ids = L => L.markers.map(m => m.id);
  // defaults: whole sample, One-shot: only S / E, no loop, no crossfade
  const L0 = osc.markerLayout({}, null, 400);
  assert.deepEqual(ids(L0), ['S', 'E']);
  assert.deepEqual([L0.a, L0.b, L0.markers[0].x, L0.markers[1].x, L0.loop, L0.xfade, L0.play], [0, 1, 0, 400, null, null, null]);
  assert.deepEqual(L0.markers.map(m => m.key), ['sstart', 'send']);
  // Fwd loop: LS / LE, band clamped into the region, crossfade before the wrap point (X·0.5·|LE − LS|)
  const m = { S: 0.1, E: 0.9, LS: 0.4, LE: 0.8, X: 0.5, loop: 1 };
  const L1 = osc.markerLayout(m, null, 1000);
  assert.deepEqual(ids(L1), ['S', 'E', 'LS', 'LE', 'XF']);
  assert.deepEqual(L1.markers.slice(2, 4).map(x => x.key), ['lstart', 'lend']);
  near(L1.loop.u0, 0.4); near(L1.loop.u1, 0.8); near(L1.loop.x0, 400); near(L1.loop.x1, 800);
  near(L1.xfade.len, 0.1); near(L1.xfade.u0, 0.7); near(L1.xfade.u1, 0.8);
  const xf = L1.markers[4];
  assert.equal(xf.key, 'xfade'); near(xf.x, 800); assert.equal(xf.y, 0.5);
  // the crossfade is limited by half the loop and by the room before LS
  near(osc.markerLayout(Object.assign({}, m, { X: 1 }), null, 1).xfade.len, 0.2);
  near(osc.markerLayout({ S: 0, E: 1, LS: 0.05, LE: 0.6, X: 1, loop: 1 }, null, 1).xfade.len, 0.05);
  // loop markers outside the region: the band is clamped, the markers keep their stored values
  const L2 = osc.markerLayout({ S: 0.3, E: 0.7, LS: 0.1, LE: 0.9, loop: 2 }, null, 100);
  near(L2.loop.u0, 0.3); near(L2.loop.u1, 0.7); near(L2.markers[2].u, 0.1);
  // backward loop (LE < LS): the crossfade zone lies after LE
  const Lb = osc.markerLayout({ S: 0, E: 1, LS: 0.8, LE: 0.4, X: 0.5, loop: 1 }, null, 1);
  near(Lb.xfade.u0, 0.4); near(Lb.xfade.u1, 0.5); near(Lb.xfade.wrap, 0.4);
  // ping-pong: no crossfade; Tailed: the tail (S + E)/2 … E loops, no LS / LE
  assert.equal(osc.markerLayout(Object.assign({}, m, { loop: 3 }), null, 1).xfade, null);
  assert.deepEqual(ids(osc.markerLayout(Object.assign({}, m, { loop: 3 }), null, 1)), ['S', 'E', 'LS', 'LE']);
  const Lt = osc.markerLayout(Object.assign({}, m, { loop: 4 }), null, 1);
  assert.deepEqual(ids(Lt), ['S', 'E', 'XF']);
  near(Lt.loop.u0, 0.5); near(Lt.loop.u1, 0.9);
  // slices only with slicing on; playhead
  const ms = { marks: [0.25, 0.5], play: 0.3 };
  assert.deepEqual(osc.markerLayout(ms, null, 100).slices, []);
  const Ls = osc.markerLayout(Object.assign({ slicing: 1 }, ms), null, 100);
  assert.deepEqual(Ls.slices, [{ j: 0, u: 0.25, x: 25, vis: true }, { j: 1, u: 0.5, x: 50, vis: true }]);
  assert.deepEqual(Ls.play, { u: 0.3, x: 30, vis: true });
  // zoom: x through the view, off-screen markers flagged
  const Lz = osc.markerLayout(Object.assign({ slicing: 2, S: 0.3, E: 0.9 }, ms), { a: 0.2, b: 0.4 }, 200);
  assert.deepEqual([Lz.a, Lz.b], [0.2, 0.4]);
  near(Lz.markers[0].x, 100); assert.equal(Lz.markers[0].vis, true);
  near(Lz.markers[1].x, 700); assert.equal(Lz.markers[1].vis, false);
  near(Lz.slices[0].x, 50); assert.equal(Lz.slices[1].vis, false);
  near(Lz.play.x, 100);
  // garbage in: clamped / defaulted
  const Lg = osc.markerLayout({ S: -3, E: 'x', loop: 9, X: 4 }, { a: 2, b: 1 }, -5);
  assert.deepEqual([Lg.markers[0].u, Lg.markers[1].u, Lg.a, Lg.b], [0, 1, 0, 1]);
  assert.deepEqual(ids(Lg), ['S', 'E', 'XF']);                      // loop 9 → Tailed (4)
});

test('zoneMapLayout: key × velocity rectangles, round-robin lanes, highlight, normalisation', () => {
  const zones = [
    { lo: 0, hi: 63, vlo: 1, vhi: 127, rr: [1, 1] },
    { lo: 64, hi: 127, vlo: 1, vhi: 63, rr: [2, 2] },
    { lo: 64, hi: 127, vlo: 1, vhi: 63, rr: [2, 1] },
    { lo: 64, hi: 127, vlo: 64, vhi: 127 },
    null,
    { lo: 70, hi: 60, vlo: 100, vhi: 90 },
  ];
  const R = osc.zoneMapLayout(zones, 256, 127, 3);
  assert.deepEqual(R.map(r => r.i), [0, 1, 2, 3, 5]);
  assert.deepEqual([R[0].x, R[0].y, R[0].w, R[0].h, R[0].lanes], [0, 0, 128, 127, 1]);
  // velocity 1–63 = the bottom 63 rows, split into two lanes ordered by rr position
  assert.deepEqual([R[2].lane, R[2].y, R[2].h], [0, 64, 31.5]);
  assert.deepEqual([R[1].lane, R[1].y, R[1].h, R[1].lanes], [1, 95.5, 31.5, 2]);
  assert.deepEqual([R[3].x, R[3].y, R[3].w, R[3].h], [128, 0, 128, 64]);
  assert.deepEqual(R.map(r => r.hot), [false, false, false, true, false]);
  assert.deepEqual([R[4].lo, R[4].hi, R[4].vlo, R[4].vhi], [60, 70, 90, 100]);   // swapped ranges
  assert.deepEqual(osc.zoneMapLayout(zones, 256, 127, [0, 5]).map(r => r.hot), [true, false, false, false, true]);
  assert.deepEqual(osc.zoneMapLayout(zones, 256, 127, new Set([1])).map(r => r.hot), [false, true, false, false, false]);
  const d = osc.zoneMapLayout([{}], 128, 127);
  assert.deepEqual([d[0].lo, d[0].hi, d[0].vlo, d[0].vhi, d[0].x, d[0].w, d[0].y, d[0].h], [0, 127, 1, 127, 0, 128, 0, 127]);
  assert.deepEqual(osc.zoneMapLayout(null, 10, 10), []);
});

test('layers3d: real frames first-class, back to front', () => {
  const l5 = osc.layers3d(256, 5);
  assert.deepEqual(l5.filter(x => x.real).map(x => x.slot).sort((a, b) => a - b), [0, 64, 128, 191, 255]);
  for (let i = 1; i < l5.length; i++) assert.ok(l5[i - 1].z >= l5[i].z);
  assert.deepEqual(osc.layers3d(1, 1), [{ z: 0, slot: 0, frame: 0, real: true }]);
  const raw = osc.layers3d(8, 8);
  assert.equal(raw.length, 8);
  assert.ok(raw.every(x => x.real && x.frame === x.slot));
});

/* ================================================================ through the real DSP scripts */

test('real DSP: filter displays (types < 96 and ≥ 96), the 2D warp preview (renderWarp2) and Render OSC Warp v2 / S1', async t => {
  // the classic scripts in their own vm context (§0.3 order; this test file redirects wt.js, so not through dsp-scope)
  const vm = await import('node:vm'), fs = await import('node:fs');
  const ctx = vm.createContext({ console });
  for (const f of ['sx-base.js', 'sx-filt2.js', 'sx-warp.js', 'serum-dsp.js']) vm.runInContext(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), ctx, { filename: f });
  const G = ['SerumDSP', 'SxWarp', 'SxFilt2'];
  for (const k of G) assert.ok(ctx[k], k);
  for (const k of G) globalThis[k] = ctx[k];
  t.after(() => { for (const k of G) delete globalThis[k]; });
  const { s, kit, T, root, log } = mount();
  const F1 = new osc.FilterPanel(root, kit, 0), A = new osc.OscPanel(root, kit, 0), D = osc.oscData(kit);
  const texts = cv => cv.getContext('2d').calls.filter(c => c[0] === 'fillText').map(c => c[1]);
  const disp = dom.byCls(F1.el, 'sx-disp')[0];
  for (const ty of [0, 103]) {
    s.p['f.type2'] = ty / 107;
    T.paint();
    assert.ok(!texts(disp).includes('Filter display needs the DSP scripts'), 'type ' + ty);
    const ir = F1.impulse(ty, 1000, 0.3, 0, 0);
    assert.equal(ir.length, 4096);
    assert.ok(ir.some(x => x !== 0) && ir.every(Number.isFinite));
  }
  // the 2D preview: Sync through renderWarp2 changes the drawn cycle
  await settle();
  const V = A.views.wt, info = D.tinfo(0), fr = D.frameAt(info, 0).slice();
  s.p['a.w1'] = 1 / 81; s.p['a.warp'] = 0.5;
  const w = V.warped(fr);
  assert.equal(w.length, 2048);
  assert.ok(w.some((x, i) => Math.abs(x - fr[i]) > 1e-3));
  // Render OSC Warp v2: 256 band-limited frames saved as "<name> warp", loaded, the swept slot set Off (one edit)
  s.p['a.w2'] = 16 / 81;
  assert.equal(D.canRenderWarp(0), true);
  await D.renderOscWarp(0);
  assert.deepEqual(log.filter(x => x[0] === 'saveNew').at(-1), ['saveNew', 'Default Shapes warp', 256]);
  assert.deepEqual([s.osc[0].wt, s.p['a.w1'], Math.round(s.p['a.w2'] * 81)], ['user:new', 0, 16]);
  assert.equal(T.log.filter(x => x[0] === 'edit').at(-1)[1], 'Render OSC Warp');
  // WARP 1 Off: WARP 2 is swept and set Off
  s.osc[0].wt = 'factory:Default';
  D.tinfo(0);
  await settle();
  await D.renderOscWarp(0);
  assert.equal(s.p['a.w2'], 0);
  // S1 mode, OSC B: the Phase-1 slot (b.warpMode) through SerumDSP.renderWarp
  s.global.s1 = 1;
  s.osc[1].wt = 'factory:Default';
  D.tinfo(1);
  await settle();
  s.p['b.warpMode'] = 2 / 22;
  assert.equal(D.canRenderWarp(1), true);
  await D.renderOscWarp(1);
  assert.equal(s.p['b.warpMode'], 0);
  assert.equal(log.filter(x => x[0] === 'saveNew').length, 3);
});
