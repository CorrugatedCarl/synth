// fx-ui.js (E6) — pure helpers (§8.7.2, §10.6: moveModule, ladderLabel, moduleTitle, modulePresetPayload,
// applyModulePreset, display maths) and headless FXRackUI checks on the fake DOM of tests/wk-dom.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Imported before any DOM exists (§0.1, §10.6).
const F = await import('../fx-ui.js');
const wk = await import('../wk.js?v=5'); // the instance fx-ui.js imports (versioned specifier)
const core = await import('../serum-core.js?v=5'); // FACTORY_CHAINS (the instance fx-ui.js imports)
const { FXRackUI, moveModule, ladderLabel, moduleTitle, modulePresetPayload, applyModulePreset, svfDb, impulseDb } = F;
import { all, byCls, one, fresh, fire, ptr, key, place, raf, advance } from './wk-dom.mjs';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/dests.json', import.meta.url), 'utf8'));
const MODS = ['hyper', 'dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil'];
const FX_IDS = FIX.DESTS.slice(FIX.NS).map(d => d.id).filter(id => id !== 'g.master' && id !== 'g.bypass');
const DEF = Object.fromEntries(FIX.DESTS.map(d => [d.id, d.def]));
// defaultFx() written out from §2.5 and the fixture defaults
function defFx() {
  const p = {};
  for (const id of FX_IDS) p[id] = DEF[id];
  return {
    v: 1, order: MODS.slice(), byp: Object.fromEntries(MODS.map(m => [m, 0])), p,
    dist: { xa: [[0, 0, 0], [1, 1, 0]], xb: [[0, 0, 0], [1, 1, 0]] }, cho: { mono: 0 }, rev: { type: 1 }, phase: [0, 0, 0, 0], lock: 0,
    ui: { lvl: { hyper: 0, dim: 0, dist: 0, flg: 0, phs: 0, cho: 0, dly: 0, cmp: 0, rev: 0, fil: 0 }, sel: '' },
  };
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` ${a} != ${b}`);

/* ------------------------------------------------------------------ pure helpers */
test('moveModule: final index semantics, clamps, unknown id, no mutation', () => {
  const o = MODS.slice();
  assert.deepEqual(moveModule(o, 'hyper', 2), ['dist', 'flg', 'hyper', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil']);
  assert.deepEqual(moveModule(o, 'fil', 0), ['fil', 'hyper', 'dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq']);
  assert.deepEqual(moveModule(o, 'eq', 99).slice(-2), ['fil', 'eq']);
  assert.deepEqual(moveModule(o, 'dist', -5)[0], 'dist');
  assert.deepEqual(moveModule(o, 'cho', 4), o);
  assert.deepEqual(moveModule(o, 'nope', 0), o);
  assert.notEqual(moveModule(o, 'nope', 0), o);
  assert.deepEqual(o, MODS);
  assert.deepEqual(moveModule(null, 'x', 0), []);
});

test('ladderLabel: MODFX (31) and DLY (12) ladders', () => {
  assert.equal(ladderLabel('modfx', 0), 'Off');
  assert.equal(ladderLabel('modfx', 21 / 30), '1/4');
  assert.equal(ladderLabel('modfx', 1), '1/32');
  assert.equal(ladderLabel('modfx', 2 / 30), '32 bar T');
  assert.equal(ladderLabel('modfx', 1.7), '1/32');
  assert.equal(ladderLabel('dly', 0.625), '1/4');
  assert.equal(ladderLabel('dly', 6 / 11), '1/8');
  assert.equal(ladderLabel('dly', 0), 'fast');
  assert.equal(ladderLabel('dly', 1), '4 bar');
  assert.equal(ladderLabel('dly', NaN), 'fast');
});

test('moduleTitle', () => {
  assert.deepEqual(MODS.map(moduleTitle), ['Hyper/Dimension', 'Distortion', 'Flanger', 'Phaser', 'Chorus', 'Delay', 'Compressor', 'Reverb', 'EQ', 'Filter']);
  assert.equal(moduleTitle('zzz'), 'zzz');
});

test('modulePresetPayload: module ids (Hyper + Dimension), no enable, structured sub-state deep-copied', () => {
  const fx = defFx();
  fx.p['fx.hyper.rate'] = 0.9; fx.p['fx.dim.size'] = 0.1; fx.p['fx.hyper.on'] = 1;
  const h = modulePresetPayload(fx, 'hyper', 'Wide');
  assert.equal(h.name, 'Wide');
  assert.equal(h.m, 'hyper');
  assert.deepEqual(Object.keys(h.p).sort(), ['fx.dim.level', 'fx.dim.mix', 'fx.dim.size', 'fx.hyper.detune', 'fx.hyper.level', 'fx.hyper.mix', 'fx.hyper.rate', 'fx.hyper.retrig', 'fx.hyper.unison']);
  assert.equal(h.p['fx.hyper.rate'], 0.9);
  assert.equal(h.p['fx.dim.size'], 0.1);
  assert.equal('sub' in h, false);
  fx.dist.xa = [[0, 0, 0], [0.5, 0.9, 0.3], [1, 1, 0]];
  const d = modulePresetPayload(fx, 'dist', 'Fold');
  assert.deepEqual(Object.keys(d.p).sort(), ['fx.dist.drive', 'fx.dist.filt', 'fx.dist.freq', 'fx.dist.lbh', 'fx.dist.level', 'fx.dist.mix', 'fx.dist.mode', 'fx.dist.q']);
  assert.deepEqual(d.sub, { xa: fx.dist.xa, xb: fx.dist.xb });
  assert.notEqual(d.sub.xa, fx.dist.xa);
  assert.deepEqual(modulePresetPayload(fx, 'cho', 'c').sub, { mono: 0 });
  assert.deepEqual(modulePresetPayload(fx, 'rev', 'r').sub, { type: 1 });
  assert.equal('sub' in modulePresetPayload(fx, 'eq', 'e'), false);
  assert.ok(JSON.parse(JSON.stringify(d)));
  delete fx.p['fx.dly.feed'];
  assert.equal(modulePresetPayload(fx, 'dly', 'x').p['fx.dly.feed'], DEF['fx.dly.feed']); // missing → default
});

test('applyModulePreset: values + sub-state applied; enable, bypass, order, other modules and locked ids kept', () => {
  const src = defFx();
  src.p['fx.dist.drive'] = 0.9; src.p['fx.dist.mode'] = 11 / 15; src.p['fx.dist.mix'] = 0.4;
  src.dist.xb = [[0, 0, 0], [0.5, 1, -0.5], [1, 0.5, 0]];
  const payload = modulePresetPayload(src, 'dist', 'Shaped');
  const fx = defFx();
  fx.order = moveModule(fx.order, 'dist', 7);
  fx.byp.dist = 1;
  fx.p['fx.dist.on'] = 1;
  fx.p['fx.eq.gainL'] = 0.75;
  fx.p['fx.dist.mix'] = 0.66;
  const before = JSON.stringify(fx);
  const out = applyModulePreset(fx, payload, ['fx.dist.mix']);
  assert.equal(JSON.stringify(fx), before); // input untouched
  assert.equal(out.p['fx.dist.drive'], 0.9);
  assert.equal(out.p['fx.dist.mode'], 11 / 15);
  assert.equal(out.p['fx.dist.mix'], 0.66); // locked
  assert.deepEqual(out.dist.xb, [[0, 0, 0], [0.5, 1, -0.5], [1, 0.5, 0]]); // X-Shaper curves included
  assert.equal(out.p['fx.dist.on'], 1);
  assert.equal(out.byp.dist, 1);
  assert.deepEqual(out.order, fx.order);
  assert.equal(out.p['fx.eq.gainL'], 0.75);
  // Hyper presets carry Dimension; the module can be inferred from the ids; lock lists may be a Set or a function
  const hy = { name: 'old', p: { 'fx.dim.size': 0.2, 'fx.hyper.unison': 7 / 7, 'fx.hyper.on': 1 } };
  const o2 = applyModulePreset(defFx(), hy, new Set(['fx.hyper.unison']));
  assert.equal(o2.p['fx.dim.size'], 0.2);
  assert.equal(o2.p['fx.hyper.unison'], DEF['fx.hyper.unison']);
  assert.equal(o2.p['fx.hyper.on'], 0); // never the enable
  const o3 = applyModulePreset(defFx(), { m: 'fil', p: { 'fx.fil.type': 0.5, 'fx.fil.res': 7 } }, id => id === 'fx.fil.cutoff');
  assert.equal(o3.p['fx.fil.type'], 48 / 95); // snapped to the enum grid
  assert.equal(o3.p['fx.fil.res'], 1); // clamped
  const o4 = applyModulePreset(defFx(), { m: 'rev', p: {}, sub: { type: 0 } });
  assert.equal(o4.rev.type, 0);
  assert.deepEqual(applyModulePreset(defFx(), null), defFx());
  assert.deepEqual(applyModulePreset(defFx(), { p: { 'zz.q': 1 } }), defFx());
});

test('display maths: svfDb (LP/BP/HP morph) and impulseDb', () => {
  const fs = 48000;
  near(svfDb(1000, 0.7071, 0, 20, fs), 0, 0.01, 'LP pass');
  near(svfDb(1000, 4, 0, 1000, fs), 20 * Math.log10(4), 0.01, 'LP peak = Q');
  near(svfDb(1000, 2, 1, 20000, fs), 0, 0.5, 'HP pass');
  near(svfDb(1000, 2, 0.5, 1000, fs), 0, 1e-9, 'BP unity peak');
  assert.ok(svfDb(1000, 0.7071, 0, 10000, fs) < -35);
  const fr = [20, 1000, 12000];
  for (const v of impulseDb([1], fs, fr)) near(v, 0, 1e-9);
  const two = impulseDb([1, 1], fs, [0.0001, 23999.9]);
  near(two[0], 20 * Math.log10(2), 1e-6);
  assert.ok(two[1] < -60);
});

/* ------------------------------------------------------------------ FXRackUI */
function fakeDsp() {
  const calls = [];
  return {
    calls,
    distCurve: (mode, drive, a, b, n = 257) => { calls.push(['distCurve', mode, drive, a.length, b.length]); return Float64Array.from({ length: n }, (_, i) => -1 + 2 * i / (n - 1)); },
    eqResponse: (fxp, eff, freqs, fs) => { calls.push(['eqResponse', fxp.NF, eff.length, fs]); return new Float64Array(freqs.length); },
    delayFilterResponse: (F, bw, freqs, fs) => { calls.push(['delayFilterResponse', F, bw, fs]); return new Float64Array(freqs.length).fill(-3); },
    filterImpulse: (type, fc, res, drive, vr, fs, len) => { calls.push(['filterImpulse', type, fc, res, drive, vr, fs, len]); const r = new Float64Array(len); r[0] = 1; return r; },
  };
}
function mkRack(o = {}) {
  const d = fresh();
  const st = { fx: o.fx || defFx(), edits: [], notes: [], store: new Map(), gr: null, locked: [] };
  const host = {
    fx: () => st.fx,
    editFx: (fn, opts) => { fn(st.fx); st.edits.push(opts); },
    bpm: () => 120,
    gr: () => st.gr,
    locked: id => st.locked.includes(id),
    storage: { get: (k, def) => (st.store.has(k) ? JSON.parse(st.store.get(k)) : def), set: (k, v) => st.store.set(k, JSON.stringify(v)) },
    notify: t => st.notes.push(t),
  };
  if (o.tip) host.tip = o.tip;
  const parent = d.createElement('div');
  d.body.appendChild(parent);
  const dsp = o.dsp === undefined ? fakeDsp() : o.dsp;
  const rack = new FXRackUI(parent, host, { embedded: !!o.embedded, dsp });
  return { d, st, rack, host, dsp, root: rack.el };
}
const panel = (rack, m) => rack.panels[m].el;
const tileOf = (rack, m) => rack.tiles[m].el;
const menuLabels = d => byCls(byCls(d.body, 'wk-ctx').at(-1), 'wk-cl').map(n => n.textContent);
function pick(d, label, level = -1) {
  const m = byCls(d.body, 'wk-ctx').at(level), it = byCls(m, 'wk-ci').find(n => one(n, 'wk-cl').textContent === label);
  assert.ok(it, 'menu item ' + label);
  if (it.getAttribute('aria-haspopup')) { fire(it, 'pointerenter', { bubbles: false }); return; }
  fire(it, 'pointerdown'); fire(it, 'click');
}

test('FXRackUI: every FX destination has a DEST-bound widget with data-dest; DOM structure', () => {
  const { rack, root } = mkRack();
  assert.ok(root.classList.contains('fxr-root'));
  assert.equal(byCls(root, 'fxr-tile').length, 10);
  assert.equal(byCls(root, 'fxr-mod').length, 10);
  for (const id of FX_IDS) {
    const w = rack.knobs.get(id);
    assert.ok(w, 'widget for ' + id);
    assert.ok(w.el && w.el.wk, 'instance for ' + id);
    assert.equal(typeof w.setMod, 'function');
    if (!/\.level$/.test(id)) assert.equal(w.el.getAttribute('data-dest'), id, 'data-dest ' + id);
  }
  assert.equal(rack.knobs.size, FX_IDS.length);
  // widget kinds per §9.6
  const kind = id => rack.knobs.get(id).el.className.split(' ')[0];
  assert.equal(kind('fx.hyper.unison'), 'wk-nb');
  assert.equal(kind('fx.dist.mode'), 'wk-menu');
  assert.equal(kind('fx.fil.type'), 'wk-menu');
  assert.equal(kind('fx.dist.filt'), 'wk-seg');
  assert.equal(kind('fx.dly.mode'), 'wk-seg');
  assert.equal(kind('fx.eq.typeL'), 'wk-seg');
  assert.equal(kind('fx.dist.lbh'), 'wk-sl');
  assert.equal(kind('fx.cmp.mbH'), 'wk-sl');
  assert.equal(kind('fx.flg.bpm'), 'wk-tog');
  assert.equal(kind('fx.cmp.ratio'), 'wk-knob');
  for (const m of MODS) assert.equal(rack.knobs.get('fx.' + m + '.on').el.getAttribute('data-dest'), 'fx.' + m + '.on');
  // every module is off by default: panels hidden, the empty notice shown
  for (const m of MODS) assert.equal(panel(rack, m).hidden, true);
  assert.equal(one(root, 'fxr-empty').hidden, false);
  rack.destroy();
  assert.equal(root.parentNode, null);
});

test('FXRackUI: LED enables a module (panel appears), knobs edit fx.p with phases, power = bypass', () => {
  const { rack, st, root } = mkRack();
  fire(rack.knobs.get('fx.dist.on').el, 'click');
  assert.equal(st.fx.p['fx.dist.on'], 1);
  assert.deepEqual(st.edits.at(-1), { label: 'Distortion Enable', phase: 'set' });
  rack.refresh();
  assert.equal(panel(rack, 'dist').hidden, false);
  assert.equal(one(root, 'fxr-empty').hidden, true);
  assert.ok(tileOf(rack, 'dist').classList.contains('fxr-on'));
  const dr = rack.knobs.get('fx.dist.drive').el;
  dr.focus();
  key(dr, 'ArrowUp');
  near(st.fx.p['fx.dist.drive'], 0.26, 1e-12);
  assert.deepEqual(st.edits.at(-1), { label: 'Dist Drive', phase: 'set' });
  assert.equal(one(dr, 'wk-num').textContent, '26%');
  ptr(dr, 'pointerdown', 0, 100);
  ptr(dr, 'pointermove', 0, 80);
  ptr(dr, 'pointerup', 0, 80);
  assert.deepEqual(st.edits.slice(-3).map(e => e.phase), ['start', 'move', 'end']);
  // power button = temporary bypass (not a DEST)
  const pw = one(panel(rack, 'dist'), 'fxr-pw');
  assert.equal(pw.hasAttribute('data-dest'), false);
  assert.equal(pw.getAttribute('aria-pressed'), 'true');
  fire(pw, 'click');
  assert.equal(st.fx.byp.dist, 1);
  rack.refresh();
  assert.ok(panel(rack, 'dist').classList.contains('fxr-byp'));
  assert.equal(pw.getAttribute('aria-pressed'), 'false');
  // typed entry through the dest parser
  key(dr, 'Enter');
  one(dr, 'wk-in').value = '75%';
  key(one(dr, 'wk-in'), 'Enter');
  near(st.fx.p['fx.dist.drive'], 0.75, 1e-12);
  rack.destroy();
});

test('FXRackUI: MIX ↔ LEVEL flip rebinds the knob (ui edit) and keeps each id’s halo', () => {
  const { rack, st } = mkRack();
  const mixW = rack.knobs.get('fx.dly.mix'), lvlW = rack.knobs.get('fx.dly.level');
  assert.equal(mixW.el, lvlW.el);
  const el = mixW.el;
  assert.equal(el.getAttribute('data-dest'), 'fx.dly.mix');
  mixW.setMod({ arcs: [{ from: 0.3, to: 0.5, kind: 'sel' }] });
  lvlW.setMod({ arcs: [{ from: 0.1, to: 0.2, kind: 'neg' }] }); // stored, not drawn while MIX is bound
  const arcs = () => byCls(el, 'wk-arc').filter(n => n.getAttribute('display') !== 'none').map(n => n.getAttribute('class'));
  assert.deepEqual(arcs(), ['wk-arc k-sel']);
  fire(one(el, 'wk-lab'), 'click');
  assert.equal(st.fx.ui.lvl.dly, 1);
  assert.deepEqual(st.edits.at(-1), { label: 'Mix / Level', phase: 'set', ui: true });
  assert.equal(el.getAttribute('data-dest'), 'fx.dly.level');
  assert.equal(one(el, 'wk-lab').textContent, 'LEVEL');
  assert.equal(one(el, 'wk-num').textContent, '0.0 dB');
  assert.deepEqual(arcs(), ['wk-arc k-neg']);
  el.focus(); key(el, 'End');
  assert.equal(st.fx.p['fx.dly.level'], 1);
  assert.equal(st.fx.p['fx.dly.mix'], DEF['fx.dly.mix']);
  rack.destroy();
});

test('FXRackUI: dependent states — BPM ladders, LINK, VAR label, reverb labels, X-Shaper buttons, multiband bars', () => {
  const { rack, st } = mkRack();
  const fx = st.fx;
  for (const m of MODS) fx.p['fx.' + m + '.on'] = 1;
  rack.refresh();
  const txt = id => one(rack.knobs.get(id).el, 'wk-num').textContent;
  // Flanger rate: Hz, then the MODFX ladder with BPM on (keys step one ladder entry)
  assert.equal(txt('fx.flg.rate'), '0.08 Hz');
  fire(rack.knobs.get('fx.flg.bpm').el, 'click');
  rack.refresh();
  assert.equal(txt('fx.flg.rate'), ladderLabel('modfx', 0.25));
  const fr = rack.knobs.get('fx.flg.rate').el;
  fr.focus(); key(fr, 'ArrowUp');
  assert.equal(fx.p['fx.flg.rate'], 9 / 30);
  // Delay: BPM on by default (ladder label), LINK disables the right side
  assert.equal(txt('fx.dly.timeL'), '1/4');
  assert.equal(rack.knobs.get('fx.dly.timeR').el.classList.contains('wk-dis'), false);
  fire(rack.knobs.get('fx.dly.link').el, 'click');
  rack.refresh();
  assert.ok(rack.knobs.get('fx.dly.timeR').el.classList.contains('wk-dis'));
  assert.ok(rack.knobs.get('fx.dly.offR').el.classList.contains('wk-dis'));
  // FX filter VAR label follows the type; '' disables it
  const varEl = rack.knobs.get('fx.fil.var').el;
  assert.equal(one(varEl, 'wk-lab').textContent, 'FAT');
  fx.p['fx.fil.type'] = 5 / 95; rack.refresh(); // MG Low 6..24 = FAT, then the next types
  const lab5 = one(varEl, 'wk-lab').textContent;
  assert.ok(lab5.length > 0);
  // Reverb slot labels follow Plate / Hall
  assert.equal(one(rack.knobs.get('fx.rev.t').el, 'wk-lab').textContent, 'DECAY');
  const revSeg = byCls(panel(rack, 'rev'), 'wk-sb');
  fire(revSeg[0], 'click');
  assert.equal(fx.rev.type, 0);
  rack.refresh();
  assert.equal(one(rack.knobs.get('fx.rev.t').el, 'wk-lab').textContent, 'PRE DELAY');
  assert.equal(one(rack.knobs.get('fx.rev.c').el, 'wk-lab').textContent, 'DAMP');
  assert.equal(txt('fx.rev.t'), '24 ms');
  // X-Shaper edit buttons only in X-Shaper modes
  const xs = byCls(panel(rack, 'dist'), 'fxr-xs');
  assert.ok(xs.every(b => b.disabled));
  fx.p['fx.dist.mode'] = 12 / 15; rack.refresh();
  assert.ok(xs.every(b => !b.disabled));
  // Multiband bars only with MULTIBAND on
  const mb = one(panel(rack, 'cmp'), 'fxr-mb');
  assert.equal(mb.hidden, true);
  fire(rack.knobs.get('fx.cmp.mb').el, 'click');
  rack.refresh();
  assert.equal(mb.hidden, false);
  // RATIO snaps to its detents; ATTACK shows look-ahead in Limit
  fx.p['fx.cmp.ratio'] = 1; rack.refresh();
  assert.equal(txt('fx.cmp.ratio'), 'Limit');
  assert.equal(txt('fx.cmp.att'), '0.90 ms');
  // EQ gain disabled for pass types
  fx.p['fx.eq.typeL'] = 1; rack.refresh();
  assert.ok(rack.knobs.get('fx.eq.gainL').el.classList.contains('wk-dis'));
  rack.destroy();
});

test('FXRackUI: reorder by Alt+arrows and by dragging the ≡ handle (yellow insertion line); DOM follows fx.order', () => {
  const { rack, st, root, d } = mkRack();
  for (const m of MODS) st.fx.p['fx.' + m + '.on'] = 1;
  rack.refresh();
  const name = rack.tiles.dist.name;
  name.focus();
  key(name, 'ArrowDown', { altKey: true });
  assert.deepEqual(st.fx.order.slice(0, 3), ['hyper', 'flg', 'dist']);
  assert.deepEqual(st.edits.at(-1), { label: 'Move FX Module', phase: 'set' });
  assert.equal(d.activeElement, name); // focus stays on the moved tile
  const tiles = () => byCls(root, 'fxr-tile');
  assert.equal(tiles()[2], rack.tiles.dist.el);
  assert.equal(byCls(root, 'fxr-mod')[2], panel(rack, 'dist'));
  key(name, 'ArrowUp', { altKey: true });
  key(name, 'ArrowUp', { altKey: true });
  key(name, 'ArrowUp', { altKey: true }); // already first: no edit
  assert.deepEqual(st.fx.order.slice(0, 2), ['dist', 'hyper']);
  // drag: tiles 30 px tall, stacked from y = 0
  st.fx.order.forEach((m, i) => place(rack.tiles[m].el, 0, i * 30, 170, 28));
  place(rack.list, 0, 0, 170, 300);
  const grip = rack.tiles.hyper.grip; // index 1
  ptr(grip, 'pointerdown', 160, 45);
  ptr(grip, 'pointermove', 160, 200); // below the midpoints of tiles 0–6 → gap 7
  const ins = one(root, 'fxr-ins');
  assert.equal(ins.hidden, false);
  assert.equal(ins.style.top, '209px');
  ptr(grip, 'pointerup', 160, 200);
  assert.equal(ins.hidden, true);
  assert.equal(st.fx.order.indexOf('hyper'), 6);
  rack.destroy();
});

test('FXRackUI: module preset menu — save, apply with seed, locks kept, Init Module, delete', () => {
  const { rack, st, d } = mkRack();
  st.fx.p['fx.cho.on'] = 1;
  st.fx.p['fx.cho.depth'] = 0.2; st.fx.cho.mono = 1;
  rack.refresh();
  globalThis.prompt = () => 'Thin';
  try {
    fire(one(panel(rack, 'cho'), 'fxr-pre'), 'click');
    assert.deepEqual(menuLabels(d), ['Save Effect Settings…', 'Init Module']);
    pick(d, 'Save Effect Settings…');
    const saved = JSON.parse(st.store.get('synth.fxmod.cho'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, 'Thin');
    assert.equal(saved[0].p['fx.cho.depth'], 0.2);
    assert.deepEqual(saved[0].sub, { mono: 1 });
    // change, lock one value, load the preset back
    st.fx.p['fx.cho.depth'] = 0.9; st.fx.p['fx.cho.feed'] = 0.5; st.fx.cho.mono = 0;
    st.locked = ['fx.cho.feed'];
    const feedBefore = st.fx.p['fx.cho.feed'];
    fire(one(panel(rack, 'cho'), 'fxr-pre'), 'click');
    assert.deepEqual(menuLabels(d), ['Save Effect Settings…', 'Thin', 'Delete Settings', 'Init Module']);
    pick(d, 'Thin');
    assert.equal(st.fx.p['fx.cho.depth'], 0.2);
    assert.equal(st.fx.p['fx.cho.feed'], feedBefore);
    assert.equal(st.fx.cho.mono, 1);
    assert.equal(st.fx.p['fx.cho.on'], 1);
    assert.deepEqual(st.edits.at(-1), { label: 'Load Chorus Settings', phase: 'set', seed: true });
    // Init Module
    st.locked = [];
    fire(one(panel(rack, 'cho'), 'fxr-pre'), 'click');
    pick(d, 'Init Module');
    assert.equal(st.fx.p['fx.cho.depth'], DEF['fx.cho.depth']);
    assert.equal(st.fx.cho.mono, 0);
    assert.equal(st.fx.p['fx.cho.on'], 1);
    assert.equal(st.edits.at(-1).seed, true);
    // delete
    fire(one(panel(rack, 'cho'), 'fxr-pre'), 'click');
    pick(d, 'Delete Settings');
    pick(d, 'Thin');
    assert.deepEqual(JSON.parse(st.store.get('synth.fxmod.cho')), []);
  } finally { delete globalThis.prompt; }
  rack.destroy();
});

test('FXRackUI: rack menu — lock, save / load / delete chains (no ui / lock, seed), reset keeps only ui', () => {
  const { rack, st, d, root } = mkRack();
  st.fx.p['fx.rev.on'] = 1; st.fx.p['fx.rev.size'] = 0.9; st.fx.ui.lvl.rev = 1; st.fx.order = moveModule(st.fx.order, 'rev', 0);
  rack.refresh();
  const more = one(root, 'fxr-more');
  fire(more, 'click');
  assert.deepEqual(menuLabels(d), ['Lock FX Rack', 'Load Effect Chain…', 'Save Effect Chain…', 'Export Effect Chain…', 'Reset Rack']);
  pick(d, 'Lock FX Rack');
  assert.equal(st.fx.lock, 1);
  assert.deepEqual(st.edits.at(-1), { label: 'Lock FX Rack', phase: 'set' }); // real state: not a ui-only edit
  globalThis.prompt = () => 'Big Room';
  try {
    fire(more, 'click');
    pick(d, 'Save Effect Chain…');
  } finally { delete globalThis.prompt; }
  const chains = JSON.parse(st.store.get('synth.fxchains'));
  assert.equal(chains.length, 1);
  assert.equal(chains[0].name, 'Big Room');
  assert.equal('ui' in chains[0].fx, false);
  assert.equal('lock' in chains[0].fx, false);
  assert.equal(chains[0].fx.order[0], 'rev');
  // Reset Rack (§9.6): defaultFx() keeping only ui — the rack lock resets too
  st.fx.extra = 1;
  fire(more, 'click');
  pick(d, 'Reset Rack');
  assert.equal(st.fx.p['fx.rev.on'], 0);
  assert.equal(st.fx.order[0], 'hyper');
  assert.equal(st.fx.ui.lvl.rev, 1);
  assert.equal(st.fx.lock, 0);
  assert.equal('extra' in st.fx, false);
  assert.deepEqual(Object.keys(st.fx).sort(), Object.keys(defFx()).sort());
  assert.equal(st.edits.at(-1).seed, true);
  // Load the chain back — works while the rack is locked, keeps ui / lock and the values of locked parameters
  // (the same result as SerumUI's main-menu Load Effect Chain, module presets and preset loads)
  st.fx.lock = 1;
  st.locked = ['fx.rev.size'];
  st.fx.p['fx.rev.size'] = 0.1;
  fire(more, 'click');
  pick(d, 'Load Effect Chain…');
  assert.deepEqual(menuLabels(d), ['Factory', 'Big Room', 'Import from File…', 'Export All to File…']);
  pick(d, 'Big Room');
  assert.equal(st.fx.p['fx.rev.on'], 1);
  assert.equal(st.fx.order[0], 'rev');
  assert.equal(st.fx.p['fx.rev.size'], 0.1);                                 // locked: kept
  assert.equal(st.fx.lock, 1);
  assert.equal(st.fx.ui.lvl.rev, 1);
  assert.deepEqual(st.edits.at(-1), { label: 'Load Effect Chain', phase: 'set', seed: true });
  assert.match(st.notes.at(-1), /Big Room/);
  // tile right-click opens the same rack menu; the LED's right-click does not
  const e1 = fire(rack.tiles.eq.name, 'contextmenu', { clientX: 5, clientY: 5 });
  assert.ok(e1.defaultPrevented);
  assert.ok(menuLabels(d).includes('Delete Effect Chain'));
  pick(d, 'Delete Effect Chain');
  pick(d, 'Big Room');
  assert.deepEqual(JSON.parse(st.store.get('synth.fxchains')), []);
  rack.destroy();
});

test('FXRackUI: Load Effect Chain ▸ Factory lists serum-core FACTORY_CHAINS and loads them like stored chains', () => {
  const { rack, st, d, root } = mkRack();
  st.fx.ui.lvl.dly = 1; st.fx.lock = 0;
  const more = one(root, 'fxr-more');
  fire(more, 'click');
  pick(d, 'Load Effect Chain…');
  assert.deepEqual(menuLabels(d), ['Factory', 'Import from File…']);         // nothing stored yet
  pick(d, 'Factory');
  assert.deepEqual(menuLabels(d), core.FACTORY_CHAINS.chains.map(c => c.name));
  pick(d, 'Dub Delay');
  const want = core.FACTORY_CHAINS.chains.find(c => c.name === 'Dub Delay').fx;
  assert.deepEqual(st.fx.p, want.p);
  assert.deepEqual(st.fx.order, want.order);
  assert.equal(st.fx.ui.lvl.dly, 1);                                           // ui kept
  assert.deepEqual(st.edits.at(-1), { label: 'Load Effect Chain', phase: 'set', seed: true });
  assert.match(st.notes.at(-1), /Dub Delay/);
  assert.equal(st.store.get('synth.fxchains'), undefined, 'factory chains are never written to the library');
  st.fx.p['fx.dly.feed'] = 0.1;
  assert.notEqual(want.p['fx.dly.feed'], 0.1, 'the frozen factory chain is not shared with the rack state');
  rack.destroy();
});

test('FXRackUI: chain files — one library format (SerumUI-compatible), import always merges, never loads', () => {
  const { rack, st, d, root } = mkRack();
  st.fx.p['fx.flg.on'] = 1; st.fx.order = moveModule(st.fx.order, 'flg', 0); st.fx.lock = 1;
  rack.refresh();
  // Export Effect Chain… = the current rack as a one-element library file
  const saved = [];
  const prevURL = globalThis.URL, prevBlob = globalThis.Blob;
  globalThis.Blob = class { constructor(parts) { this.text = parts.join(''); } };
  globalThis.URL = { createObjectURL: b => { saved.push(b.text); return 'blob:x'; }, revokeObjectURL: () => {} };
  globalThis.prompt = () => 'Jet';
  try {
    fire(one(root, 'fxr-more'), 'click');
    pick(d, 'Export Effect Chain…');
  } finally { delete globalThis.prompt; globalThis.URL = prevURL; globalThis.Blob = prevBlob; }
  assert.equal(saved.length, 1, 'one file written');
  const file = JSON.parse(saved[0]);
  assert.equal(file.type, 'synth.fxchains');
  assert.equal(file.v, 1);
  assert.equal(file.chains.length, 1);
  assert.equal(file.chains[0].name, 'Jet');
  assert.equal(file.chains[0].fx.order[0], 'flg');
  assert.equal('ui' in file.chains[0].fx || 'lock' in file.chains[0].fx, false);
  // SerumUI's importChains reads exactly this shape: o.chains = [{ name, fx: object }]
  assert.ok(Array.isArray(file.chains) && file.chains.every(c => typeof c.name === 'string' && c.fx && typeof c.fx === 'object'));
  // importing the exported file merges it into the library and leaves the rack alone
  st.fx.p['fx.flg.on'] = 0; const nEdits = st.edits.length;
  assert.equal(rack.importText(saved[0], 'Jet.fxchains.json'), 1);
  assert.equal(st.fx.p['fx.flg.on'], 0);
  assert.equal(st.edits.length, nEdits);
  assert.deepEqual(JSON.parse(st.store.get('synth.fxchains')).map(c => c.name), ['Jet']);
  assert.match(st.notes.at(-1), /Jet/);
  // old single-chain files and bare fx states are still accepted (merged, named by the file when nameless)
  const one1 = defFx(); one1.p['fx.phs.on'] = 1;
  assert.equal(rack.importText(JSON.stringify({ type: 'synth.fxchain', v: 1, name: 'Old', fx: one1 }), 'x.json'), 1);
  const bare = defFx(); bare.p['fx.eq.on'] = 1;
  assert.equal(rack.importText(JSON.stringify(bare), 'Bare.fxchain.json'), 1);
  assert.equal(st.fx.p['fx.phs.on'], 0);
  assert.equal(st.fx.p['fx.eq.on'], 0);
  // a SerumUI "Export All to File…" library merges by name
  const lib = { type: 'synth.fxchains', v: 1, chains: [{ name: 'B', fx: defFx() }, { name: 'A', fx: Object.assign(defFx(), { ui: { sel: 'eq' }, lock: 1 }) }, { name: 'bad' }] };
  assert.equal(rack.importText(JSON.stringify(lib)), 2);
  const lst = JSON.parse(st.store.get('synth.fxchains'));
  assert.deepEqual(lst.map(c => c.name), ['A', 'B', 'Bare', 'Jet', 'Old']);
  assert.equal(lst[0].fx.p['fx.phs.on'], 0);
  assert.equal(lst.find(c => c.name === 'Old').fx.p['fx.phs.on'], 1);
  assert.equal('ui' in lst[0].fx || 'lock' in lst[0].fx, false);
  assert.throws(() => rack.importText('{"nope":1}'));
  assert.throws(() => rack.importText('{"chains":[]}'));
  // Export All to File… writes the whole library in the same format
  globalThis.Blob = class { constructor(parts) { this.text = parts.join(''); } };
  globalThis.URL = { createObjectURL: b => { saved.push(b.text); return 'blob:x'; }, revokeObjectURL: () => {} };
  try {
    fire(one(root, 'fxr-more'), 'click');
    pick(d, 'Load Effect Chain…');
    pick(d, 'Export All to File…');
  } finally { globalThis.URL = prevURL; globalThis.Blob = prevBlob; }
  const all5 = JSON.parse(saved.at(-1));
  assert.equal(all5.type, 'synth.fxchains');
  assert.deepEqual(all5.chains.map(c => c.name), ['A', 'B', 'Bare', 'Jet', 'Old']);
  // loading stays the Load menu's job
  fire(one(root, 'fxr-more'), 'click');
  pick(d, 'Load Effect Chain…');
  pick(d, 'Old');
  assert.equal(st.fx.p['fx.phs.on'], 1);
  assert.equal(st.fx.lock, 1);
  rack.destroy();
});

test('FXRackUI: control context menu only when not embedded (Serum’s mod layer owns it when embedded)', () => {
  const a = mkRack();
  a.st.fx.p['fx.eq.on'] = 1; a.rack.refresh();
  const g = a.rack.knobs.get('fx.eq.gainL').el;
  a.st.fx.p['fx.eq.gainL'] = 0.9;
  const e = fire(g, 'contextmenu', { clientX: 3, clientY: 3 });
  assert.ok(e.defaultPrevented);
  assert.deepEqual(menuLabels(a.d), ['Reset Control', 'Enter Value…']);
  pick(a.d, 'Reset Control');
  assert.equal(a.st.fx.p['fx.eq.gainL'], 0.5);
  const led = a.rack.knobs.get('fx.eq.on').el;
  fire(led, 'contextmenu', { clientX: 3, clientY: 3 });
  assert.deepEqual(menuLabels(a.d), ['Reset Control']);
  a.rack.destroy();
  const b = mkRack({ embedded: true });
  assert.ok(b.root.classList.contains('fxr-embedded'));
  const e2 = fire(b.rack.knobs.get('fx.eq.gainL').el, 'contextmenu', { clientX: 3, clientY: 3 });
  assert.equal(e2.defaultPrevented, false);
  const e3 = fire(b.rack.knobs.get('fx.eq.on').el, 'contextmenu', { clientX: 3, clientY: 3 });
  assert.equal(e3.defaultPrevented, false);
  b.rack.destroy();
});

test('FXRackUI: displays use the DSP helpers; display drags edit two parameters; X-Shaper popover', () => {
  const { rack, st, dsp, d } = mkRack();
  for (const m of ['dist', 'dly', 'eq', 'fil']) st.fx.p['fx.' + m + '.on'] = 1;
  st.fx.p['fx.dist.mode'] = 11 / 15;
  rack.refresh();
  const names = dsp.calls.map(c => c[0]);
  for (const n of ['distCurve', 'eqResponse', 'delayFilterResponse', 'filterImpulse']) assert.ok(names.includes(n), n);
  assert.deepEqual(dsp.calls.find(c => c[0] === 'distCurve').slice(1), [11, 0.25, 1025, 1025]);
  const fi = dsp.calls.find(c => c[0] === 'filterImpulse');
  assert.equal(fi[1], 0); near(fi[2], 424.6, 0.5); assert.equal(fi[6], 48000);
  const n0 = dsp.calls.length;
  rack.refresh(); // unchanged parameters: no redraw
  assert.equal(dsp.calls.length, n0);
  // delay filter display: relative drags like a knob — x moves F along the log axis (display width = 20 Hz–20 kHz),
  // y moves Q (plot height = full range); nothing is edited before 3 px of movement, so a plain click is harmless
  const dd = one(panel(rack, 'dly'), 'fxr-dlyf');
  place(dd, 0, 0, 212, 74);
  const q0 = st.fx.p['fx.dly.q'], f0n = st.fx.p['fx.dly.freq'], ne = st.edits.length;
  ptr(dd, 'pointerdown', 106, 30);
  ptr(dd, 'pointerup', 106, 30);
  assert.equal(st.edits.length, ne, 'a plain click edits nothing');
  assert.deepEqual([st.fx.p['fx.dly.q'], st.fx.p['fx.dly.freq']], [q0, f0n]);
  ptr(dd, 'pointerdown', 106, 30);
  ptr(dd, 'pointermove', 107, 31);
  assert.equal(st.edits.length, ne, 'under the 3 px threshold');
  ptr(dd, 'pointermove', 156, 14.5);
  ptr(dd, 'pointerup', 156, 14.5);
  near(st.fx.p['fx.dly.q'], Math.min(1, q0 + 15.5 / 62), 1e-9);
  const fHz = 40 * Math.pow(18000 / 40, f0n) * Math.pow(1000, 50 / 200);
  near(st.fx.p['fx.dly.freq'], Math.log(fHz / 40) / Math.log(18000 / 40), 1e-9);
  assert.deepEqual(st.edits.slice(ne).map(e => e.phase), ['start', 'move', 'end']);
  assert.deepEqual(st.edits[ne].label, 'Delay Filter');
  // Shift = fine (×0.1)
  const q1 = st.fx.p['fx.dly.q'];
  ptr(dd, 'pointerdown', 100, 40);
  ptr(dd, 'pointermove', 100, 9, { shiftKey: true });
  ptr(dd, 'pointerup', 100, 9, { shiftKey: true });
  near(st.fx.p['fx.dly.q'], Math.min(1, q1 + 3.1 / 62), 1e-9);
  // the FX Filter display: a click leaves cutoff and resonance alone
  const fd = one(panel(rack, 'fil'), 'fxr-fild');
  place(fd, 0, 0, 212, 96);
  const c0 = [st.fx.p['fx.fil.cutoff'], st.fx.p['fx.fil.res']], ne2 = st.edits.length;
  ptr(fd, 'pointerdown', 180, 90);
  ptr(fd, 'pointerup', 180, 90);
  assert.deepEqual([st.fx.p['fx.fil.cutoff'], st.fx.p['fx.fil.res']], c0);
  assert.equal(st.edits.length, ne2);
  // EQ: grab the low-band handle, drag it to +12 dB
  const eq = one(panel(rack, 'eq'), 'fxr-eqd');
  place(eq, 0, 0, 216, 110);
  const xL = 8 + Math.log(209.6 / 20) / Math.log(1000) * 200, y0 = 8 + 24 / 48 * 94;
  ptr(eq, 'pointerdown', xL, y0);
  ptr(eq, 'pointermove', xL, 8 + 12 / 48 * 94);
  ptr(eq, 'pointerup', xL, 8 + 12 / 48 * 94);
  near(st.fx.p['fx.eq.gainL'], 0.75, 1e-9);
  near(st.fx.p['fx.eq.freqL'], 0.333, 2e-3);
  // X-Shaper A popover edits dist.xa; Escape closes it
  fire(byCls(panel(rack, 'dist'), 'fxr-xs')[0], 'click');
  const pop = one(panel(rack, 'dist'), 'fxr-xpop');
  assert.ok(pop);
  assert.equal(pop.getAttribute('aria-label'), 'X-Shaper A');
  const ed = one(pop, 'gx-xshape');
  assert.equal(d.activeElement, ed);
  place(ed, 0, 0, 214, 180);
  fire(ed, 'dblclick', { clientX: 7 + 0.5 * 200, clientY: 7 + 0.25 * 166 });
  assert.deepEqual(st.fx.dist.xa.map(q => q.slice(0, 2)), [[0, 0], [0.5, 0.75], [1, 1]]);
  assert.deepEqual(st.edits.at(-1), { label: 'X-Shaper A', phase: 'set' });
  key(ed, 'Escape'); // no selection to clear → reaches the popover
  assert.equal(one(panel(rack, 'dist'), 'fxr-xpop'), null);
  fire(byCls(panel(rack, 'dist'), 'fxr-xs')[1], 'click'); // B; a press outside closes it, a press inside does not
  assert.equal(one(panel(rack, 'dist'), 'fxr-xpop').getAttribute('aria-label'), 'X-Shaper B');
  ptr(one(panel(rack, 'dist'), 'gx-xshape'), 'pointerdown', 1, 1);
  ptr(one(panel(rack, 'dist'), 'gx-xshape'), 'pointerup', 1, 1);
  assert.ok(one(panel(rack, 'dist'), 'fxr-xpop'));
  ptr(d.body, 'pointerdown', 900, 700);
  assert.equal(one(panel(rack, 'dist'), 'fxr-xpop'), null);
  rack.destroy();
});

test('FXRackUI: without a DSP the displays degrade and loadDSP is requested; GR meter polls host.gr', async () => {
  delete globalThis.FXDSP; delete globalThis.SerumDSP;
  const { rack, st, d } = mkRack({ dsp: null });
  assert.equal(d.scripts.length, 2); // wk.loadDSP injected serum-dsp.js and fx-dsp.js
  st.fx.p['fx.eq.on'] = 1; rack.refresh();
  const FX = fakeDsp();
  globalThis.FXDSP = FX;
  for (const s of d.scripts) fire(s, 'load', { bubbles: false });
  await new Promise(r => setTimeout(r, 0));
  assert.ok(FX.calls.some(c => c[0] === 'eqResponse'));
  delete globalThis.FXDSP;
  rack.destroy();
  raf.install();
  try {
    const g = mkRack();
    g.st.fx.p['fx.cmp.on'] = 1;
    g.st.gr = Float32Array.from([6, 0, 0, 0]);
    g.rack.refresh();
    const ctx = one(g.root, 'fxr-gr').getContext('2d');
    ctx.calls.length = 0;
    raf.flush(1, 100);
    assert.ok(ctx.calls.some(c => c[0] === 'fillRect'));
    assert.ok(ctx.calls.some(c => c[0] === 'fillText' && c[1] === '-6.0'));
    g.st.fx.p['fx.cmp.on'] = 0; g.rack.refresh();
    raf.flush(2, 200);
    assert.equal(raf.pending, 0); // the meter stops with the module
    g.rack.destroy();
  } finally { raf.uninstall(); }
});

test('FXRackUI: tile name scrolls / selects (ui edit); refresh restores order from external state', () => {
  const { rack, st, root } = mkRack();
  st.fx.p['fx.phs.on'] = 1; rack.refresh();
  fire(rack.tiles.phs.name, 'click');
  assert.equal(st.fx.ui.sel, 'phs');
  assert.deepEqual(st.edits.at(-1), { label: 'Select FX Module', phase: 'set', ui: true });
  rack.refresh();
  assert.ok(rack.tiles.phs.el.classList.contains('fxr-sel'));
  st.fx.order = MODS.slice().reverse(); // e.g. undo / preset load
  rack.refresh();
  assert.deepEqual(byCls(root, 'fxr-tile').map(t => t === rack.tiles.fil.el), [true, false, false, false, false, false, false, false, false, false]);
  assert.equal(byCls(root, 'fxr-mod')[0], panel(rack, 'fil'));
  assert.ok(all(root).length > 100);
  rack.destroy();
});

test('FXRackUI: EQ display wheel follows the widgets’ rules (hover rest, trackpad accumulation) and lets the rack scroll', () => {
  const { rack, st } = mkRack();
  st.fx.p['fx.eq.on'] = 1; rack.refresh();
  const eq = one(panel(rack, 'eq'), 'fxr-eqd');
  place(eq, 0, 0, 216, 110);
  const xL = 8 + Math.log(209.6 / 20) / Math.log(1000) * 200, q0 = st.fx.p['fx.eq.qL'], n0 = st.edits.length;
  // the pointer has just arrived (the rack is scrolling past): 15 gentle trackpad events are not taken
  fire(eq, 'pointerenter', { bubbles: false });
  let taken = 0;
  for (let i = 0; i < 15; i++) if (fire(eq, 'wheel', { clientX: xL, clientY: 50, deltaY: 3 }).defaultPrevented) taken++;
  assert.equal(taken, 0);
  assert.equal(st.edits.length, n0);
  assert.equal(st.fx.p['fx.eq.qL'], q0);
  // after resting 300 ms: taken; 45 px of trackpad travel = one 0.02 step (40 px per step), one edit
  advance(400);
  for (let i = 0; i < 15; i++) if (fire(eq, 'wheel', { clientX: xL, clientY: 50, deltaY: 3 }).defaultPrevented) taken++;
  assert.equal(taken, 15);
  assert.equal(st.edits.length, n0 + 1);
  near(st.fx.p['fx.eq.qL'], q0 - 0.02, 1e-12);
  // a mouse notch up = +0.02 on the nearest band (the high band near its handle)
  const xH = 8 + Math.log(4000 / 20) / Math.log(1000) * 200, qH = st.fx.p['fx.eq.qH'];
  fire(eq, 'wheel', { clientX: 200, clientY: 50, deltaY: -1, deltaMode: 1 });
  assert.ok(xH > 0);
  near(st.fx.p['fx.eq.qH'], Math.min(1, qH + 0.02), 1e-12);
  // prefs.wheel off: never taken
  wk.setPrefs({ wheel: 0 });
  try { assert.equal(fire(eq, 'wheel', { clientX: xL, clientY: 50, deltaY: 100 }).defaultPrevented, false); } finally { wk.setPrefs({ wheel: 1 }); }
  rack.destroy();
});

test('FXRackUI: tooltips use host.tip (Serum mod lines) when given, else <Label>: <value>', () => {
  const a = mkRack({ tip: id => (id === 'fx.eq.gainL' ? 'EQ Gain L: +3.0 dB\nLFO 1 +50% ->' : null) });
  a.st.fx.p['fx.eq.on'] = 1; a.rack.refresh();
  key(a.d.body, 'Shift'); // keyboard modality: focus shows the tooltip at once
  a.rack.knobs.get('fx.eq.gainL').el.focus();
  assert.equal(a.d.getElementById('wk-tip').textContent, 'EQ Gain L: +3.0 dB\nLFO 1 +50% ->');
  a.rack.knobs.get('fx.eq.qL').el.focus(); // host.tip → null: the rack's own text
  assert.match(a.d.getElementById('wk-tip').textContent, /^.+: .+$/);
  assert.ok(!a.d.getElementById('wk-tip').textContent.includes('\n'));
  a.rack.destroy();
  const b = mkRack({ tip: () => { throw new Error('host broke'); } });
  b.st.fx.p['fx.eq.on'] = 1; b.rack.refresh();
  key(b.d.body, 'Shift');
  b.rack.knobs.get('fx.eq.qL').el.focus();
  assert.match(b.d.getElementById('wk-tip').textContent, /: /);
  b.rack.destroy();
});

test('FXRackUI: displays redraw on resize (ResizeObserver on the rack) and size bitmaps from the padding box', () => {
  const obs = [];
  globalThis.ResizeObserver = class { constructor(fn) { this.fn = fn; this.els = []; this.off = false; obs.push(this); } observe(el) { this.els.push(el); } disconnect() { this.off = true; } };
  try {
    const { rack, st, dsp } = mkRack();
    assert.equal(obs.length, 1);
    assert.deepEqual(obs[0].els, [rack.rack]);
    st.fx.p['fx.dly.on'] = 1; st.fx.p['fx.cmp.on'] = 1; rack.refresh();
    const dd = one(panel(rack, 'dly'), 'fxr-dlyf');
    // a 1 px border: border box 212 × 74, padding box 210 × 72
    place(dd, 0, 0, 212, 74);
    Object.defineProperty(dd, 'clientWidth', { value: 210, configurable: true });
    Object.defineProperty(dd, 'clientHeight', { value: 72, configurable: true });
    const n0 = dsp.calls.length;
    obs[0].fn([]); // the layout changed width
    assert.ok(dsp.calls.length > n0, 'redrawn after the resize');
    const cv = dd.childNodes.find(n => n.localName === 'canvas');
    assert.deepEqual([cv.width, cv.height], [210, 72]);
    const n1 = dsp.calls.length;
    obs[0].fn([]); // same size: nothing to repaint
    assert.equal(dsp.calls.length, n1);
    // the GR meter canvas has its own border: drawn into its padding box
    const gr = one(panel(rack, 'cmp'), 'fxr-gr');
    place(gr, 0, 0, 142, 64);
    Object.defineProperty(gr, 'clientWidth', { value: 140, configurable: true });
    Object.defineProperty(gr, 'clientHeight', { value: 62, configurable: true });
    obs[0].fn([]);
    assert.deepEqual([gr.width, gr.height], [140, 62]);
    rack.destroy();
    assert.equal(obs[0].off, true);
  } finally { delete globalThis.ResizeObserver; }
});

test('FXRackUI: tile selection class is stable when fx.ui is missing', () => {
  const fx = defFx();
  delete fx.ui;
  const { rack } = mkRack({ fx });
  const seen = [];
  for (let i = 0; i < 4; i++) { rack.refresh(); seen.push(rack.tiles.eq.el.classList.contains('fxr-sel')); }
  assert.deepEqual(seen, [false, false, false, false]);
  rack.destroy();
});
