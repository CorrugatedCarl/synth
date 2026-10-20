import './v8-guard.mjs';
// sx-host.js + sx-ui-mod.js (SYNTH Canvas milestone 3 lane B, docs/canvas/IMPL-3.md §2.2–2.3, §1.4): the Serum host and
// its views — mount alone and twice (one state, unique ids), the view registry and the paint gating of shown views (H4),
// the label-drag host guard, bare panels (the canvas bar's chrome gone, every own head control kept, View.power), the slot
// host (device ⇄ slot round trip for LFO / ENV / chaos / macro, data-nomod, the o.live / o.edit / o.cancel / o.set phases,
// each kit option), the ENV curve values, H1 / H3 lazy builds, CLIP's twins, VOICE and its fold-outs, the part widths and
// the element / canvas budget of one modulator, the part CSS. graph.js / fx-ui.js / wtedit.js / wt.js are the serum-ui stubs (no
// canvases drawn), the sub-panel modules real. Never passes fake-DOM nodes to assert (safeAssert: nodes become tags).
// Run alone: node --max-old-space-size=2048 --test tests/sx-host.test.mjs
import test from 'node:test';
import assertBase from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { readFileSync } from 'node:fs';
import { redirect } from './serum-ui.hooks.mjs';

if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({ resolve: (spec, ctx, next) => redirect(spec, ctx.parentURL) || next(spec, ctx) });
} else nodeModule.register('./serum-ui.hooks.mjs', import.meta.url);
globalThis.SerumDSP = null;   // (wk.loadDSP resolves at once: no script injection into the fake DOM)
globalThis.FXDSP = null;

// imported before any DOM exists: nothing touches document / window at top level
const H = await import('../sx-host.js?v=9');
const M = await import('../sx-ui-mod.js?v=9');
const core = await import('../serum-core.js?v=9');
const song = await import('../song.js?v=9');
const gx = await import('../graph.js?v=9');
const D = await import('./serum-ui-stubs/dom.js');
const WK = await import('../wk.js?v=9');   // (the same instance sx-host imports)
const assert = D.safeAssert(assertBase);
const { fire, ptr, flush } = D;

const fresh = () => core.normalizeSerum(core.defaultSerum());
const byDest = (root, id) => root.querySelectorAll('[data-dest="' + id + '"]')[0] || null;
const count = root => { let n = 0; const walk = e => { n++; for (const c of e.children) walk(c); }; walk(root); return n; };   // the element and its descendants
const labels = doc => { const ms = D.ctxMenus(doc); return ms.length ? D.menuLabels(ms[ms.length - 1]) : []; };
const closeMenus = doc => { for (const m of D.ctxMenus(doc)) m.remove(); };
function mkHost(over) {
  const st = { s: fresh(), fx: core.defaultFx2() }, log = [], store = new Map();
  const host = {
    st, log, state: () => st.s, fx: () => st.fx,
    edit: (fn, o) => { fn(st.s); log.push(['edit', o && o.label, o && o.phase, !!(o && o.ui)]); },
    editFx: (fn, o) => { fn(st.fx); log.push(['editFx', o && o.label]); },
    bpm: () => 120, dev: 'i2',
    storage: { get: (k, d) => (store.has(k) ? store.get(k) : d), set: (k, v) => store.set(k, JSON.parse(JSON.stringify(v))) },
    notify: t => log.push(['notify', t]),
    midiLearn: id => { log.push(['learn', id]); return Promise.resolve(null); },
  };
  return Object.assign(host, over || {});
}
// a parts host over a fresh Serum state, in a fresh document
function parts(over) {
  const doc = D.fresh(), host = mkHost(over), box = doc.createElement('div');
  doc.body.appendChild(box);
  const X = H.createHost(host, { doc });
  return { doc, host, box, X, s: () => host.st.s };
}
// a slot host for a canvas modulator of `kind` (the device in `dev.r`), its calls logged
function slot(kind, rec, more) {
  const doc = D.fresh(), box = doc.createElement('div'), calls = [], dev = { r: song.normModDev(Object.assign({ kind }, rec)) };
  doc.body.appendChild(box);
  const o = Object.assign({ doc, get: () => dev.r, bpm: () => 120,
    live: f => calls.push(['live', f]), edit: f => { calls.push(['edit', f]); dev.r = song.normModDev(Object.assign({}, dev.r, JSON.parse(JSON.stringify(f)))); },
    cancel: () => calls.push(['cancel']), set: (k, v) => calls.push(['set', k, v]) }, more);
  const X = H.slotHost(kind, o), V = M.mountSlot(X, box);
  return { doc, box, X, V, calls, dev, o };
}
const knobDrag = (el, dy, o) => {   // a wk knob's vertical drag: start → two moves → end (dy px up)
  ptr(el, 'pointerdown', 10, 100, o); ptr(el, 'pointermove', 10, 100 - dy / 2, o); ptr(el, 'pointermove', 10, 100 - dy, o); ptr(el, 'pointerup', 10, 100 - dy, o);
};

/* ================================================================ exports, view kinds */
test('exports: SerumHost, createHost, slotHost, the view registry, the slot helpers; sx-ui-mod\'s panels, PART_W, partView / mountPart / mountSlot; every part kind registered', () => {
  for (const k of ['SerumHost', 'createHost', 'slotHost', 'defineView', 'viewKinds', 'overlaySlot', 'readSlot', 'storeDensity', 'makeKit', 'PresetBrowser']) assert.equal(typeof H[k], 'function', k);
  assert.deepEqual(H.SLOT, { lfo: 0, env: 1, chaos: 0, macro: 0 });
  assert.equal(H.HOST_OPTS.undo, true);
  for (const k of ['MacrosPanel', 'EnvPanel', 'LfoPanel', 'CurvePanel', 'VoicingPanel', 'ChaosRow', 'VoiceHeader', 'OutputsPanel', 'QualityPanel', 'TuningPanel', 'MpePanel', 'VcPanel', 'VoicePanel', 'partView', 'mountPart', 'mountSlot']) assert.equal(typeof M[k], 'function', k);
  assert.deepEqual(H.viewKinds().sort(), ['arp', 'chaos', 'clip', 'curve', 'env', 'filter', 'header', 'lfo', 'macros', 'mpe', 'noise', 'osc', 'outputs', 'quality', 'sub', 'tuning', 'vc', 'voice', 'voicing'].sort());
  // the parts (serum-core MODULE_FIELDS names + macros, voice) → view kind and slot
  const P = p => { const v = M.partView(p); return v ? v.kind + ':' + v.k : null; };
  assert.deepEqual(['oscA', 'oscC', 'sub', 'noise', 'filter', 'filter2', 'env1', 'env4', 'lfo1', 'lfo10', 'macros', 'arp', 'clip', 'voice', 'velo', 'nope'].map(P),
    ['osc:0', 'osc:2', 'sub:0', 'noise:0', 'filter:0', 'filter:1', 'env:0', 'env:3', 'lfo:0', 'lfo:9', 'macros:0', 'arp:0', 'clip:0', 'voice:0', 'curve:velo', null]);
  // the widths of the 1200 px bundled panel (measured to the layout unit, review 2; cv-module rounds them up to the grid), VOICE = VOICING + 8 + ENV
  assert.deepEqual([M.PART_W.osc, M.PART_W.sub, M.PART_W.filter, M.PART_W.macros, M.PART_W.env, M.PART_W.lfo, M.PART_W.voicing], [256.65625, 163.734375, 218.328125, 237.265625, 316.375, 395.453125, 210.90625]);
  assert.equal(M.PART_W.voicing + 8 + M.PART_W.env, M.PART_W.voice);
  assert.throws(() => H.slotHost('wheel', {}), /no slot/);
});

/* ================================================================ mount, views, paint gating (H4) */
test('mount: a part root per view (div.sx-root.sx-part, data-dev, data-col, its width), the panel built on the view\'s own page; twice = two views of one state with unique ids; unmount removes it', async () => {
  const { doc, box, X, s } = parts();
  const a = M.mountPart(X, 'lfo3', box), b = M.mountPart(X, 'lfo3', box);
  await flush(doc);
  assert.equal(X.views.length, 2);
  assert.ok(a.id !== b.id && a.root.id !== b.root.id);
  for (const V of [a, b]) {
    assert.deepEqual([V.root.className, V.root.getAttribute('data-dev'), V.root.getAttribute('data-col'), V.root.style.width, V.kind], ['sx-root sx-part', 'i2', 'C', '395.453125px', 'lfo']);
    assert.ok(V.page.binds.length > 10 && V.page.el === V.root);
    assert.equal(V.root.querySelectorAll('.sx-etabs').length, 0);
  }
  // the same LFO in both: a knob drag on one shows on the other after a repaint
  const ka = byDest(a.root, 'l3.rise'), kb = byDest(b.root, 'l3.rise');
  knobDrag(ka, 60);
  await flush(doc);
  assert.ok(s().p['l3.rise'] > 0);
  assert.equal(kb.getAttribute('aria-valuenow'), ka.getAttribute('aria-valuenow'));
  assert.ok(X.owns(ka) && X.owns(kb) && X.viewOf(ka) === a && X.viewOf(kb) === b);
  // ids stay unique across the views (aria-controls / -pb<N> ids)
  const ids = box.querySelectorAll('[id]').map(n => n.id);
  assert.equal(new Set(ids).size, ids.length);
  b.destroy();
  assert.deepEqual([X.views.length, b.root.parentNode === null, X.roots.length], [1, true, 1]);
  assert.throws(() => X.mount('nope', box), /no view kind/);
  X.destroy();
  assert.equal(a.root.parentNode, null);
});

test('H4: one paint loop over the SHOWN views only — a hidden view\'s binds are not updated, its live callbacks are told shown = false, its canvases not measured; showing it again repaints; anyShown', async () => {
  const { doc, box, X, s } = parts();
  let on = false;
  const V = X.mount('voicing', box, { shown: () => on }), W = M.mountPart(X, 'noise', box);
  const lives = [];
  X.under(V.page, () => X.kit.live(sh => lives.push(sh)));
  await flush(doc);
  assert.equal(X.anyShown(), true);
  const porta = byDest(V.root, 'g.porta');
  const before = porta.getAttribute('aria-valuenow');
  s().p['g.porta'] = 0.8;
  X.paint(true);
  assert.equal(porta.getAttribute('aria-valuenow'), before, 'hidden: not repainted');
  assert.equal(lives.at(-1), false);
  assert.equal(X.shownPages().includes(V.page), false);
  assert.ok(W.page.canvases.length >= 1 && W.page.canvases.every(cv => cv.sized));   // (the shown NOISE display measured)
  on = true;
  X.paint(true);
  assert.notEqual(porta.getAttribute('aria-valuenow'), before);
  assert.equal(lives.at(-1), true);
  on = false; W.destroy();
  assert.equal(X.anyShown(), false);
  X.destroy();
});

test('the label-drag host guard: only this host\'s module labels are swap / copy targets (XM finding 2); View.labelDrag makes the canvas bar title the label', async () => {
  const one = parts(), doc = one.doc, box2 = doc.createElement('div');
  doc.body.appendChild(box2);
  const host2 = mkHost(), Y = H.createHost(host2, { doc });
  const a = M.mountPart(one.X, 'oscA', one.box), b = M.mountPart(one.X, 'oscB', one.box), c = M.mountPart(Y, 'oscA', box2);
  const ta = doc.createElement('span'), tb = doc.createElement('span'), tc = doc.createElement('span');
  doc.body.append(ta, tb, tc);
  a.labelDrag(ta); b.labelDrag(tb); c.labelDrag(tc);
  assert.deepEqual([ta.getAttribute('data-modlabel'), tb.getAttribute('data-modlabel'), tc.getAttribute('data-modlabel')], ['oscA', 'oscB', 'oscA']);
  assert.deepEqual([one.X.owns(tb), one.X.owns(tc), Y.owns(tc)], [true, false, true]);
  one.s().p['a.pan'] = 0.1; one.s().p['b.pan'] = 0.9; host2.st.s.p['a.pan'] = 0.3;
  // dropped on the other host's OSC A title: nothing in either Serum
  doc.pointAt = () => tc;
  ptr(ta, 'pointerdown', 10, 10); ptr(ta, 'pointermove', 40, 10); ptr(ta, 'pointerup', 40, 10);
  assert.deepEqual([one.s().p['a.pan'], one.s().p['b.pan'], host2.st.s.p['a.pan']], [0.1, 0.9, 0.3]);
  // on this host's OSC B title: the swap
  doc.pointAt = () => tb;
  ptr(ta, 'pointerdown', 10, 10); ptr(ta, 'pointermove', 40, 10); ptr(ta, 'pointerup', 40, 10);
  assert.deepEqual([one.s().p['a.pan'], one.s().p['b.pan']], [0.9, 0.1]);
  one.X.destroy(); Y.destroy();
});

/* ================================================================ bare panels */
test('bare: the canvas bar\'s chrome goes (power → View.power, no name / lock mark / chevron / ENV tabs), every own head control stays in the head row; the bar ⏻ keeps its menu and halo', async () => {
  const { doc, box, X, s } = parts();
  const V = {};
  for (const p of ['oscA', 'sub', 'noise', 'filter', 'env2', 'lfo1', 'macros']) V[p] = M.mountPart(X, p, box);
  await flush(doc);
  for (const [p, v] of Object.entries(V)) {
    const r = v.root, panel = r.querySelector('.sx-panel');
    assert.ok(panel.classList.contains('sx-bare'), p);
    assert.equal(r.querySelectorAll('.sx-tname').length + r.querySelectorAll('.sx-lockmark').length + r.querySelectorAll('.sx-peek').length + r.querySelectorAll('.sx-etabs').length, 0, p);
    assert.equal(panel.querySelector('.sx-ptitle').className, 'sx-ptitle sx-bare', p);
  }
  const head = p => V[p].root.querySelector('.sx-ptitle.sx-bare');
  // OSC: the type menu, the type view's head (wavetable menu, ren / del / edit), the route button
  assert.ok(head('oscA').querySelector('.sxo-type') && head('oscA').querySelector('.sxo-src') && head('oscA').querySelector('.sxo-rbtn'));
  assert.ok(head('oscA').querySelectorAll('button').some(b => /Open wavetable editor/.test(b.getAttribute('aria-label') || '')));
  assert.ok(head('sub').querySelectorAll('.wk-menu').length >= 2 && head('sub').querySelector('.sxo-rbtn'));   // shapes S2 / S1, route
  assert.ok(head('noise').querySelector('.sxo-src') && head('noise').querySelector('.sxo-badge') && head('noise').querySelector('.sxo-rbtn'));
  assert.ok(head('filter').querySelectorAll('.wk-menu').length >= 2 && head('filter').querySelector('.sxo-rbtn'));
  const env = head('env2');
  assert.deepEqual(env.querySelectorAll('.wk-tog').map(b => b.textContent.trim()), ['BPM', 'LOCK']);
  assert.ok(env.querySelector('input.sx-zoom') && env.querySelectorAll('button').some(b => b.getAttribute('aria-label') === 'Envelope menu'));
  assert.equal(head('lfo1').children.length + head('macros').children.length, 0);   // (nothing of their own: the row is empty → none)
  // View.power: the module's own toggle, outside the root (the bar's slot), still the x.on destination
  const pw = V.oscA.power;
  assert.ok(pw && !V.oscA.root.contains(pw));
  assert.deepEqual([pw.getAttribute('data-dest'), pw.getAttribute('data-module'), pw.classList.contains('wk-power')], ['a.on', 'oscA', true]);
  assert.equal(V.env2.power, null);
  const bar = doc.createElement('div');
  doc.body.appendChild(bar);
  bar.appendChild(pw);
  assert.ok(X.owns(pw));
  fire(pw, 'contextmenu', { clientX: 5, clientY: 5, button: 2 });
  assert.deepEqual(labels(doc).slice(0, 5), ['Lock Module', 'Init Module', 'Copy', 'Copy (w/mods)', 'Swap with']);   // (the knob menu of the power: its module first)
  assert.ok(labels(doc).includes('Mod Source'));
  closeMenus(doc);
  fire(pw.querySelector('button') || pw, 'click');
  await flush(doc);
  assert.equal(s().p['a.on'], 0);
  assert.ok(V.oscA.root.querySelector('.sx-panel').classList.contains('sx-off'));   // dimmed while off
  // the bar ⋯: the module menu (+ the panel's own items)
  assert.deepEqual(V.oscA.menuItems().slice(0, 5).map(i => i.label), ['Lock Module', 'Init Module', 'Copy', 'Copy (w/mods)', 'Swap with']);
  assert.ok(V.oscA.menuItems().some(i => i.label === 'Enable Pitch Tracking'));
  assert.deepEqual(V.env2.menuItems().filter(i => i.label).map(i => i.label), ['Legato Inverted', 'Grid', 'Voice Steal Retrigger', 'Lock Module', 'Bypass All Destinations', 'Remove All Destinations']);
  // the oscillator part: the bundled look (sx-opan / data-o: its colour) and a press selects it (s.ui.osc)
  const b = M.mountPart(X, 'oscB', box);
  assert.deepEqual([b.root.querySelector('.sx-panel').getAttribute('data-o'), b.root.querySelector('.sx-panel').classList.contains('sx-opan')], ['1', true]);
  fire(b.root.querySelector('.sx-panel'), 'pointerdown');
  assert.equal(s().ui.osc, 1);
  X.destroy();
});

test('H1 / H3: an oscillator part builds its active type view only (others at their first switch); an LFO builds its PATH editor at the first Path type, then keeps it', async () => {
  const { doc, box, X, s } = parts();
  const O = M.mountPart(X, 'oscA', box);
  await flush(doc);
  assert.deepEqual(Object.keys(O.panel.panel.built), ['wt']);
  assert.equal(O.root.querySelectorAll('[data-otype]').length, 1);
  s().osc[0].type = 'gran';
  X.paint(true);
  assert.deepEqual(Object.keys(O.panel.panel.built).sort(), ['gran', 'wt']);
  assert.equal(O.root.querySelectorAll('[data-otype]').map(n => n.getAttribute('data-otype') + ':' + (n.style.display === 'none' ? 'off' : 'on')).join(), 'wt:off,gran:on');
  // the gran view registered on the part's own page (its binds paint with it)
  assert.ok(O.page.binds.length > 0 && O.page.canvases.length >= 2);
  const made = () => gx.made.filter(e => e.constructor === gx.PathEditor).length;
  const n0 = made(), L = M.mountPart(X, 'lfo2', box);
  await flush(doc);
  assert.equal(made(), n0, 'no PATH editor yet');
  s().lfo[1].type = 'path';
  X.paint(true);
  assert.equal(made(), n0 + 1);
  assert.ok(L.page.editors.some(e => e.constructor === gx.PathEditor));
  s().lfo[1].type = 'normal'; X.paint(true); s().lfo[1].type = 'path'; X.paint(true);
  assert.equal(made(), n0 + 1, 'kept');
  X.destroy();
});

/* ================================================================ slot hosts: the canvas modulators */
test('slot host: device ⇄ slot round trip for LFO, ENV, chaos and macro (overlaySlot / readSlot are inverse on normalised records; chaos smooth never written)', () => {
  const recs = {
    lfo: { lfo: { mono: 1, type: 'path', mode: 'env', bpm: 0, dot: 1, x10: 1, pts: [[0, 0.2, 0], [0.3, 0.9, -0.5], [1, 0.2, 0]], loop: 1, start: 0 }, rate: 0.31, rise: 0.2, delay: 0.1, smooth: 0.4, phase: 0.25 },
    env: { env: { bpm: 1, legInv: 1, stealRe: 0 }, att: 0.2, hold: 0.1, dec: 0.4, sus: 0.6, rel: 0.3, start: 0.1, end: 0.7, crv: [0.2, 0.9, 0.5] },
    chaos: { chaos: { mono: 0, sh: 1 }, rate: 0.42, bpm: 1, smooth: 0.8 },
    macro: { v: [0.1, 0.2, 0, 0, 0, 0, 0, 1], names: ['Cut', 'Res', '', '', '', '', '', 'Wide'] },
  };
  for (const [kind, r] of Object.entries(recs)) {
    const dev = song.normModDev(Object.assign({ kind }, r)), s = H.overlaySlot(fresh(), kind, dev), back = H.readSlot(s, kind);
    for (const k of Object.keys(back)) assert.deepEqual(back[k], dev[k], kind + '.' + k);
    if (kind === 'chaos') assert.equal('smooth' in back, false);
  }
  // where the slot lives: LFO 1, ENV 2, chaos 1, macros 1–8
  const s = H.overlaySlot(fresh(), 'env', song.normModDev(Object.assign({ kind: 'env' }, recs.env)));
  assert.deepEqual([s.p['e2.att'], s.p['e2.ca'], s.env[1].legInv, s.p['e1.att'] === fresh().p['e1.att']], [0.2, 0.2, 1, true]);
});

test('slot host LFO: Serum\'s LFO panel, bare, every destination data-nomod (no cable end, no drop, no Mod Source); a knob gesture = live per move (before any edit) then ONE edit; a rollback = cancel; a toggle = one edit; a view edit (grid) none', async () => {
  const { doc, box, X, V, calls, dev } = slot('lfo', { lfo: { mono: 1 } });
  await flush(doc);
  assert.deepEqual([V.root.className, V.root.getAttribute('data-nomod'), V.root.style.width, X.opts.undo, X.opts.nomod], ['sx-root sx-part', '1', '395.453125px', false, true]);
  const dests = V.root.querySelectorAll('[data-dest]');
  assert.ok(dests.length >= 5 && dests.every(n => n.getAttribute('data-nomod') === '1'));
  assert.equal(V.root.querySelector('.sx-tname'), null);
  // the MONO button shows the device's GLOBAL (mono 1)
  const tog = t => V.root.querySelectorAll('.wk-tog').find(b => b.textContent.trim() === t);
  assert.equal(tog('MONO').getAttribute('aria-pressed'), 'true');
  // RATE drag: start (no change) nothing; moves → live; end → one edit with the final rate
  const rate = byDest(V.root, 'l1.rate');
  knobDrag(rate, 80);
  const kinds = calls.map(c => c[0]);
  assert.equal(kinds[0], 'live');
  assert.equal(kinds.filter(k => k === 'edit').length, 1);
  assert.equal(kinds.at(-1), 'edit');
  assert.deepEqual(Object.keys(calls.at(-1)[1]), ['rate']);
  assert.equal(dev.r.rate, calls.at(-1)[1].rate);
  // a two-finger rollback (move back to the start, then the end): cancel, no edit
  calls.length = 0;
  const r0 = dev.r.rate;
  ptr(rate, 'pointerdown', 10, 100); ptr(rate, 'pointermove', 10, 60); ptr(rate, 'pointercancel', 10, 60, { gesture: 'two-finger' });
  assert.deepEqual(calls.map(c => c[0]), ['live', 'cancel']);
  assert.equal(X.s().p['l1.rate'], r0);
  // MONO off: one edit, the lfo object whole
  calls.length = 0;
  fire(tog('MONO'), 'click');
  assert.deepEqual([calls.length, calls[0][0], calls[0][1].lfo.mono, Object.keys(calls[0][1])], [1, 'edit', 0, ['lfo']]);
  // the LFO grid (Serum-global, no device field) and the drawing tool: view edits, no call
  calls.length = 0;
  const grid = V.root.querySelector('input.sx-grid');
  grid.value = '8'; fire(grid, 'change');
  assert.deepEqual([calls.length, X.s().lfoGrid.x], [0, 8]);
  // the knob menu: Reset / Enter Value (+ RATE's 10x / Swing) — no Mod Source, MIDI learn or lock
  fire(byDest(V.root, 'l1.rise'), 'contextmenu', { clientX: 5, clientY: 5, button: 2 });
  assert.deepEqual(labels(doc), ['Reset Control', 'Enter Value…']);
  closeMenus(doc);
  // a source tile dropped on a modulator's knob finds no target (hitTest)
  doc.pointAt = () => rate;
  assert.equal(X.hitTest(1, 1, 'lfo2', false), null);
  // the bar ⋯: Init / Copy / Paste (no Lock, Copy (w/mods), Swap) and the rows' Bypass / Remove All Destinations
  assert.deepEqual(V.menuItems().filter(i => i.label).map(i => i.label), ['Init Module', 'Copy', 'Bypass All Destinations', 'Remove All Destinations']);
  // after an outside change (undo / redo): sync re-overlays the device
  dev.r = song.normModDev({ kind: 'lfo', lfo: { mono: 0, mode: 'free' }, rate: 0.2 });
  X.sync();
  assert.deepEqual([X.s().lfo[0].mode, X.s().p['l1.rate'], tog('MONO').getAttribute('aria-pressed')], ['free', 0.2, 'false']);
  // the monitor: the phase dot (lfoPh) of its slot
  X.live({ v: 0.4, ph: 0.25 });
  assert.equal(X.snap.lfoPh[0], 0.25);
  X.destroy();
  assert.equal(V.root.parentNode, null);
});

test('slot host options: links off (no point menus), wt2lfo off, ghosts off, learn / lock off, undo off (no panel undo, Cmd-Z left to the app), osc off (no OscData), srcItems through o.rows', async () => {
  const rows = { n: 2, byp: false, calls: [] };
  const { doc, X, V } = slot('lfo', {}, { rows: { count: () => rows.n, bypassed: () => rows.byp, bypass: on => rows.calls.push(['bypass', on]), remove: () => rows.calls.push(['remove']) } });
  const opts = X.lfoEditorOpts(() => 0, 160);
  assert.deepEqual([opts.pointMenu, opts.removePointMods, opts.fromWavetable, opts.links], [undefined, undefined, undefined, false]);
  const ed = gx.made.filter(e => e.constructor === gx.CurveEditor).at(-1);
  assert.equal(ed.o.links, false);
  assert.equal(X.oscd.canRenderWarp(0), false);
  assert.equal(X.undo.size(), 0);
  const e = fire(V.root.querySelector('.sx-panel'), 'keydown', { key: 'z', metaKey: true });
  assert.equal(e.defaultPrevented, false);
  const it = V.menuItems().find(i => i.label === 'Bypass All Destinations');
  it.action();
  V.menuItems().find(i => i.label === 'Remove All Destinations').action();
  assert.deepEqual(rows.calls, [['bypass', true], ['remove']]);
  rows.n = 0;
  assert.equal(V.menuItems().find(i => i.label === 'Bypass All Destinations').disabled, true);
  X.destroy();
  // ENV: no ghosts of other ENVs; Serum's default curves (0.5 / 0.666 / 0.666) shown as Serum shows them (XM §8.7 fixed)
  const E = slot('env', {});
  await flush(E.doc);
  const envEd = gx.made.filter(x => x.constructor === gx.EnvEditor).at(-1);
  assert.deepEqual(envEd.o.ghosts(), []);
  const pct = id => byDest(E.V.root, id).getAttribute('aria-valuetext');
  assert.deepEqual(['e2.ca', 'e2.cd', 'e2.cr'].map(pct), ['50%', '67%', '67%']);
  assert.equal(byDest(E.V.root, 'e2.start') !== null && byDest(E.V.root, 'e2.end') !== null, true);   // ENV 2's layout: START / END
  assert.deepEqual(E.V.menuItems().filter(i => i.label).map(i => i.label), ['Legato Inverted', 'Grid', 'Voice Steal Retrigger', 'Bypass All Destinations', 'Remove All Destinations']);
  // LOCK / zoom are view edits: no device edit
  fire(E.V.root.querySelectorAll('.wk-tog').find(b => b.textContent.trim() === 'LOCK'), 'click');
  assert.equal(E.calls.length, 0);
  E.X.destroy();
});

test('slot host macro: Serum\'s 4 × 2 MACROS; each name tile is its jack (data-jack k1…k8, no Serum drag); a knob drag posts set(k, v) per move and ONE edit {v} at its end; rename ≤ 16 (one edit {names}); no MIDI learn', async () => {
  const { doc, V, calls, dev } = slot('macro', { v: [0.2, 0, 0, 0, 0, 0, 0, 0.9], names: ['Cutoff', 'Macro 2', 'Macro 3', 'Macro 4', 'Macro 5', 'Macro 6', 'Macro 7', 'Wide'] });
  await flush(doc);
  const tiles = V.root.querySelectorAll('.sx-tile');
  assert.deepEqual(tiles.map(t => t.getAttribute('data-jack')), ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']);
  assert.deepEqual([tiles.every(t => !t.hasAttribute('data-src')), tiles[0].textContent, tiles[7].textContent], [true, 'Cutoff', 'Wide']);
  const k1 = byDest(V.root, 'm1');
  knobDrag(k1, 40);
  const sets = calls.filter(c => c[0] === 'set'), edits = calls.filter(c => c[0] === 'edit');
  assert.ok(sets.length >= 1 && sets.every(c => c[1] === 0));
  assert.deepEqual([edits.length, Object.keys(edits[0][1]), calls.some(c => c[0] === 'live')], [1, ['v'], false]);
  assert.equal(dev.r.v[0], sets.at(-1)[2]);
  // rename: the tile's double-click input, ≤ 16
  calls.length = 0;
  fire(tiles[1], 'dblclick');
  const inp = V.root.querySelector('input');
  assert.equal(inp.maxLength, 16);
  inp.value = 'A very long macro name';
  fire(inp, 'keydown', { key: 'Enter' });
  assert.deepEqual(calls.map(c => [c[0], Object.keys(c[1])]), [['edit', ['names']]]);
  assert.equal(dev.r.names[1], 'A very long macr');
  // the knob menu: Rename…, Reset, Enter Value (no MIDI learn, no lock)
  fire(k1, 'contextmenu', { clientX: 5, clientY: 5, button: 2 });
  assert.deepEqual(labels(doc).filter(Boolean), ['Rename…', 'Reset Control', 'Enter Value…']);
  closeMenus(doc);
});

test('slot host chaos: one chaos row (RATE, BPM, MONO, S&H) with its label as the bundled GLOBAL page draws it ("CHAOS 1"; review 2: the module\'s number); the toggles edit the chaos object whole, BPM the bpm field', async () => {
  const { doc, V, calls } = slot('chaos', { chaos: { mono: 1, sh: 0 }, rate: 0.3 });
  await flush(doc);
  assert.equal((V.root.querySelector('.sx-txt') || {}).textContent, 'CHAOS 1');
  const doc2 = D.fresh(), box2 = doc2.createElement('div'); doc2.body.appendChild(box2);
  const X2 = H.slotHost('chaos', { doc: doc2, get: () => song.normModDev({ kind: 'chaos' }), devKey: 'h2', live() {}, edit() {}, cancel() {} }), V2 = M.mountSlot(X2, box2);
  await flush(doc2);
  assert.equal((V2.root.querySelector('.sx-txt') || {}).textContent, 'CHAOS 2', 'Chaos 2\'s row');
  V2.destroy(); X2.destroy();
  assert.ok(byDest(V.root, 'c1.rate') && byDest(V.root, 'c1.bpm'));
  const tog = t => V.root.querySelectorAll('.wk-tog').find(b => b.textContent.trim() === t);
  fire(tog('S&H'), 'click');
  fire(tog('BPM'), 'click');
  assert.deepEqual(calls.map(c => c[1]), [{ chaos: { mono: 1, sh: 1 } }, { bpm: 1 }]);
});

/* ================================================================ budgets, VOICE, CLIP twins */
test('budgets (IMPL-3 §1.4): one Serum-faithful modulator ≤ 160 elements and ≤ 2 canvases', async () => {
  for (const kind of ['lfo', 'env', 'macro', 'chaos']) {
    const { doc, V, X } = slot(kind, {});
    await flush(doc);
    const el = count(V.root), cv = V.root.querySelectorAll('canvas').length;
    assert.ok(el <= 160, kind + ' ' + el + ' elements');
    assert.ok(cv <= 2, kind + ' ' + cv + ' canvases');
    X.destroy();
  }
});

test('VOICE: the header (preset, undo / redo, menu, MASTER), VOICING beside ENV 1 (fixed, titled, no tabs), the outputs, the fold-outs built at their first opening (host view state)', async () => {
  const { doc, box, X } = parts({ presets: { list: () => [{ key: 'f:0', name: 'Init', cat: 'Init' }], current: () => 'f:0', load() {} } });
  const V = M.mountPart(X, 'voice', box);
  await flush(doc);
  const r = V.root;
  assert.deepEqual([r.style.width, r.getAttribute('data-col')], ['535.28125px', 'C']);
  assert.ok(r.querySelector('.sx-head').querySelector('.sx-pname') && r.querySelector('.sx-undo') && byDest(r, 'g.master') && r.querySelector('.sx-status'));
  assert.ok(X.browser, 'the preset browser (a host service)');
  const env = r.querySelectorAll('.sx-panel').find(p => p.getAttribute('aria-label') === 'ENV 1');
  assert.ok(env && env.querySelector('.sx-tname').textContent === 'ENV 1' && !env.querySelector('.sx-etabs'));
  assert.ok(byDest(r, 'e1.att') && !byDest(r, 'e1.start'));
  assert.ok(r.querySelectorAll('.sx-panel').some(p => p.getAttribute('aria-label') === 'VOICING'));
  assert.ok(byDest(r, 'g.bus1v') && byDest(r, 'g.direct'));
  const folds = r.querySelectorAll('.sx-foldbtn');
  assert.deepEqual(folds.map(b => b.textContent), ['▸ QUALITY', '▸ TUNING', '▸ MPE', '▸ VOICE CONTROL', '▸ VELO', '▸ NOTE', '▸ KEYS', '▸ CHAOS 1 / 2']);
  const n0 = count(r);
  assert.equal(byDest(r, 'vc.pan'), null);
  fire(folds[3], 'click');
  await flush(doc);
  assert.ok(count(r) > n0 + 50 && byDest(r, 'vc.pan'));
  assert.equal(folds[3].getAttribute('aria-expanded'), 'true');
  assert.ok(X.uiState.folds.has('vc'));
  fire(folds[3], 'click');
  assert.equal(folds[3].parentNode.querySelector('.sx-foldbody').classList.contains('sx-hidden'), true);
  // CHAOS 1 / 2 only in S1 mode
  assert.equal(folds[7].parentNode.classList.contains('sx-hidden'), true);
  // VOICE's ⋯ items: PREFERENCES / INFO as dialog sheets (a view of the host while open)
  assert.deepEqual(V.menuItems().map(i => i.label), ['Preferences…', 'Info…']);
  const nv = X.views.length;
  V.menuItems()[0].action();
  const dlg = doc.body.querySelectorAll('.sx-dlg').find(b => b.querySelector('.sx-panel'));
  assert.ok(dlg && dlg.querySelector('.sx-panel').getAttribute('aria-label') === 'PREFERENCES');
  assert.equal(X.views.length, nv + 1);
  fire(dlg.querySelectorAll('button').find(b => b.textContent === 'Close'), 'click');
  assert.equal(X.views.length, nv);
  X.destroy();
});

test('CLIP as a part: its MACROS pane\'s knobs are twins (data-twin: no cable end, no drop on the canvas); ARP alone (no MACROS pane); the part power in the bar', async () => {
  const { doc, box, X } = parts({ tracks: () => [], seqCmd() {} });
  const C = M.mountPart(X, 'clip', box), A = M.mountPart(X, 'arp', box);
  await flush(doc);
  const tw = C.root.querySelectorAll('[data-twin]');
  assert.deepEqual(tw.map(n => n.getAttribute('data-dest')), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
  assert.equal(A.root.querySelectorAll('[data-twin]').length, 0);
  assert.equal(A.root.querySelectorAll('.sx-macros').length, 0);
  assert.deepEqual([C.power && C.power.getAttribute('data-dest'), A.power && A.power.getAttribute('data-dest')], ['clip.on', 'arp.on']);
  X.destroy();
});

test('review 1 F1: a view\'s own disposers and satellites go with it — mounting and destroying bare parts (the ⏻ adopted, the bar titles\' label drags, MACROS\' tile drags) leaves the host\'s offs / sats where they were', async () => {
  const { doc, box, X } = parts();
  const set = () => ['oscA', 'filter', 'macros', 'lfo1'].map(p => {
    const V = M.mountPart(X, p, box), t = doc.createElement('span');
    doc.body.appendChild(t);
    V.labelDrag(t);
    return V;
  });
  for (const V of set()) V.destroy();
  await flush(doc);
  const o0 = X.offs.length, s0 = X.sats ? X.sats.size : 0;
  for (let i = 0; i < 3; i++) { const L = set(); await flush(doc); for (const V of L) V.destroy(); }
  assert.deepEqual([X.views.length, X.offs.length, X.sats ? X.sats.size : 0], [0, o0, s0]);
  // while mounted, its satellites are the host's (owns: the bar ⏻ and the title)
  const V = M.mountPart(X, 'oscA', box), t = doc.createElement('span');
  doc.body.appendChild(t);
  V.labelDrag(t);
  assert.deepEqual([X.owns(V.power), X.owns(t)], [true, true]);
  V.destroy();
  assert.deepEqual([X.owns(t), X.offs.length, X.sats ? X.sats.size : 0], [false, o0, s0]);
  X.destroy();
});

test('review 2 P1-2: a view mounted while hidden is painted fully the first time it shows (reshow — the canvas\' on-screen change — queues one full paint): MACROS\' names, the filter\'s type rows; a view a paint skipped is stale until shown again; nothing stale → no paint', async () => {
  const { doc, box, X, s } = parts();
  let on = false;
  const Vm = M.mountPart(X, 'macros', box, { shown: () => on, opts: { tiles: 'jack' } }), Vf = M.mountPart(X, 'filter', box, { shown: () => on });
  await flush(doc);
  const names = () => Array.from(Vm.root.querySelectorAll('.sx-tile')).map(e => e.textContent).join('|');
  const want = Array.from({ length: 8 }, (_, i) => 'Macro ' + (i + 1)).join('|');
  assert.notEqual(names(), want, 'hidden at mount: not painted (H4)');
  assert.equal(X.reshow(), false, 'still hidden: nothing to paint');
  on = true;
  assert.equal(X.reshow(), true, 'shown: one full paint queued');
  await flush(doc);
  assert.equal(names(), want);
  assert.equal(X.reshow(), false, 'painted: nothing stale');
  // hidden while an edit is painted: stale; shown again → the edit shows
  on = false;
  X.host.edit(st => { st.macros[0].name = 'Bright'; }, { label: 'name' }); X.paint(true);
  assert.equal(names().split('|')[0], 'Macro 1', 'hidden: skipped');
  on = true;
  assert.equal(X.reshow(), true);
  await flush(doc);
  assert.equal(names().split('|')[0], 'Bright');
  // a non-full paint that finds a stale shown view paints it fully (its editors too)
  on = false; X.host.edit(st => { st.macros[1].name = 'Wide'; }, { label: 'name' }); X.paint(true);
  on = true; X.paint(false);
  assert.deepEqual([names().split('|')[1], X.reshow()], ['Wide', false]);
  Vm.destroy(); Vf.destroy();
  X.destroy();
});

test('review 2 P2 parity: PART_W are the 1200 px panel\'s widths to the layout unit (1/64 px) and a part root takes its width exactly; a part / slot panel moves (< 1 px, relative) so its body lands on the bundled panel\'s phase in world px (PART_PH) — text then rasters as in the whole panel', async () => {
  assert.deepEqual([M.PART_W.osc, M.PART_W.sub, M.PART_W.noise, M.PART_W.filter, M.PART_W.macros, M.PART_W.env, M.PART_W.lfo, M.PART_W.voicing, M.PART_W.chaos],
    [256.65625, 163.734375, 163.734375, 218.328125, 237.265625, 316.375, 395.453125, 210.90625, 389.34375]);
  assert.equal(M.PART_W.voice, M.PART_W.voicing + 8 + M.PART_W.env);
  assert.deepEqual([M.PART_PH.oscA, M.PART_PH.oscB, M.PART_PH.oscC, M.PART_PH.lfo], [[0.734375, 0], [0.390625, 0], [0.03125, 0], [0.640625, 0.765625]]);
  const { doc, box, X } = parts();
  const W = doc.createElement('div'); W.setAttribute('data-cv-world', ''); doc.body.appendChild(W); W.appendChild(box);
  W._rect = { left: 100.3, top: 50.7, width: 4000, height: 4000 };
  const V = M.mountPart(X, 'oscB', box);
  assert.equal(V.root.style.width, '256.65625px', 'exact');
  const body = [...V.panel.el.childNodes].find(c => c.classList && c.classList.contains('sx-pbody'));
  body._rect = { left: 100.3 + 24.703125, top: 50.7 + 105, width: 256, height: 600 };
  await flush(doc);
  assert.deepEqual([V.panel.el.style.position, V.panel.el.style.left, V.panel.el.style.top || ''], ['relative', '0.6875px', ''], 'x .703125 → .390625 (OSC B\'s), y 0 kept');
  // a slot host's LFO: its kind's phase
  const S = slot('lfo', {});
  S.doc.body.appendChild(S.box);
  const W2 = S.doc.createElement('div'); W2.setAttribute('data-cv-world', ''); S.doc.body.appendChild(W2); W2.appendChild(S.box);
  W2._rect = { left: 0, top: 0, width: 4000, height: 4000 };
  const b2 = [...S.V.panel.el.childNodes].find(c => c.classList && c.classList.contains('sx-pbody'));
  b2._rect = { left: -501.75, top: 59, width: 395, height: 380 };
  for (const v of S.X.views) v.stale = true; // (shown again: its next full paint aligns it)
  S.X.paint(true);
  assert.deepEqual([S.V.panel.el.style.left, S.V.panel.el.style.top], ['0.390625px', '0.765625px'], 'x .25 → .640625, y 0 → .765625');
  V.destroy(); X.destroy(); S.V.destroy(); S.X.destroy();
});

test('H5: the store density is wk.storeDensity\'s (lane C, merged on wt-m3), whatever the local scale; CANVAS_MAX_PX 16e6', () => {
  // (lane B's pre-H5 fallback — dpr ≤ 2 over the local scale, 0.5…2 — stays in sx-host for a non-positive answer; with C merged
  //  wk.storeDensity always exists, so the delegation is what ships)
  const doc = D.fresh(), el = doc.createElement('canvas');
  doc.defaultView.devicePixelRatio = 2;
  assert.equal(H.CANVAS_MAX_PX, 16e6);
  assert.equal(typeof WK.storeDensity, 'function');
  const q = +WK.storeDensity(el);
  assert.ok(q > 0 && isFinite(q));
  assert.deepEqual([H.storeDensity(doc, el, 1), H.storeDensity(doc, el, 0.5), H.storeDensity(doc, el, 4), H.storeDensity(doc, el, 2)], [q, q, q, q]);
});

test('part CSS: a part root is container sxp without a frame, keeps its PART_W width in a flex body (flex: none); an empty bare title row hides; the O column\'s 30 px knobs restated for parts', () => {
  const src = readFileSync(new URL('../sx-host.js', import.meta.url), 'utf8'), a = src.indexOf('const CSS = `');
  const css = src.slice(a + 13, src.indexOf('`;', a)).replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = sel => { const i = css.indexOf(sel + ' {'); return i < 0 ? null : css.slice(i + sel.length + 2, css.indexOf('}', i)); };
  const part = rule('.sx-root.sx-part');
  assert.ok(part !== null);
  for (const re of [/container:\s*sxp \/ inline-size/, /flex:\s*none/, /margin:\s*0 auto/, /background:\s*none/, /box-shadow:\s*none/]) assert.match(part, re);
  assert.match(rule('.sx-panel.sx-bare > .sx-ptitle.sx-bare:empty'), /display:\s*none/);
  assert.match(rule('.sx-part[data-col="O"] .wk-md, .sx-part[data-col="O"] .wk-lg'), /--wk-d:\s*30px/);
});
