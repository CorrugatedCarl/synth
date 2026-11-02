import './v8-guard.mjs';
// sx-host.js + sx-ui-mod.js (SYNTH Canvas milestone 3 lane B, docs/canvas/IMPL-3.md §2.2–2.3, §1.4): the host and its
// views — mount alone and twice (one state, unique ids), the view registry ('arp' / 'clip' since SX0) and the paint gating of
// shown views (H4), the label-drag host guard, bare panels (the canvas bar's chrome gone, every own head control kept,
// View.power), the slot host (device ⇄ slot round trip for LFO / ENV / chaos / macro, data-nomod, the o.live / o.edit /
// o.cancel / o.set phases, each kit option), the ENV curve values, H1 / H3 lazy builds, CLIP's twins, the element / canvas
// budget of one modulator, the part CSS. (SX0, lane K) The stage-3 part views left with the parts machinery: the cases mount
// the DONOR panels — the classes a rig face (rig-ui) or a slot face builds on — through host.mount(builder) (donor / slotDonor
// below). graph.js / fx-ui.js / wtedit.js / wt.js are the serum-ui stubs (no canvases drawn), the sub-panel modules real.
// Never passes fake-DOM nodes to assert (safeAssert: nodes become tags).
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
const OSC = await import('../sx-ui-osc.js?v=9');
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
// (SX0, lane K) a part's donor panel on host X, bare, as a view of X (host.mount with a builder): the panel class a rig face builds
// on (rig-ui buildFace: the shell's ⏻ / module handed to the View, the module menu or the panel's own ⋯); 'arp' / 'clip' are still
// sx-ui-mod's views (mountPart, Q1)
const DONOR = {
  osc: (r, K, k) => new OSC.OscPanel(r, K, k), sub: (r, K) => new OSC.SubPanel(r, K), noise: (r, K) => new OSC.NoisePanel(r, K),
  filter: (r, K, k) => new OSC.FilterPanel(r, K, k), env: (r, K, k) => new M.EnvPanel(r, K, k), lfo: (r, K, k) => new M.LfoPanel(r, K, k),
  macros: (r, K) => new M.MacrosPanel(r, K), voicing: (r, K) => new M.VoicingPanel(r, K), chaos: (r, K, k) => new M.ChaosRow(r, K, k, {}),
};
const OWN_MENU = new Set(['env', 'lfo', 'chaos']);   // (their ⋯ is the panel's own menuItems(); the others' the shell's module menu)
const donorOf = part => {
  const p = String(part), o = /^osc([ABC])$/.exec(p), e = /^env([1-4])$/.exec(p), l = /^lfo(\d+)$/.exec(p);
  return o ? ['osc', 'ABC'.indexOf(o[1])] : e ? ['env', +e[1] - 1] : l ? ['lfo', +l[1] - 1] : p === 'filter2' ? ['filter', 1] : [p, 0];
};
function donorView(X, kind, k, root, args) {
  return X.mount((r, K) => {
    const P = DONOR[kind](r, K, k), sh = P.shell || {};
    return { el: P.el, panel: P, power: sh.power || null, module: sh.module || null,
      menuItems: () => (OWN_MENU.has(kind) ? P.menuItems() : sh.menuItems ? sh.menuItems() : []), destroy: () => P.destroy() };
  }, root, Object.assign({ k, bare: true, kind }, args));
}
function donor(X, part, root, args) {
  if (part === 'arp' || part === 'clip') return M.mountPart(X, part, root, args);
  const [kind, k] = donorOf(part);
  return donorView(X, kind, k, root, args);
}
// a slot host's donor (what cv-mods-ui's body mounted before MOD1's slot faces): LfoPanel 0 / EnvPanel 1 / ChaosRow 0 / MacrosPanel
const SLOT_KIND = { lfo: 'lfo', env: 'env', chaos: 'chaos', macro: 'macros' };
const slotDonor = (X, root) => donorView(X, SLOT_KIND[X.kind], X.slot, root, { dev: X.dev });
// a slot host for a canvas modulator of `kind` (the device in `dev.r`), its calls logged
function slot(kind, rec, more) {
  const doc = D.fresh(), box = doc.createElement('div'), calls = [], dev = { r: song.normModDev(Object.assign({ kind }, rec)) };
  doc.body.appendChild(box);
  const o = Object.assign({ doc, get: () => dev.r, bpm: () => 120,
    live: f => calls.push(['live', f]), edit: f => { calls.push(['edit', f]); dev.r = song.normModDev(Object.assign({}, dev.r, JSON.parse(JSON.stringify(f)))); },
    cancel: () => calls.push(['cancel']), set: (k, v) => calls.push(['set', k, v]) }, more);
  const X = H.slotHost(kind, o), V = slotDonor(X, box);
  return { doc, box, X, V, calls, dev, o };
}
const knobDrag = (el, dy, o) => {   // a wk knob's vertical drag: start → two moves → end (dy px up)
  ptr(el, 'pointerdown', 10, 100, o); ptr(el, 'pointermove', 10, 100 - dy / 2, o); ptr(el, 'pointermove', 10, 100 - dy, o); ptr(el, 'pointerup', 10, 100 - dy, o);
};

/* ================================================================ exports, view kinds */
test('exports: SerumHost, createHost, slotHost, the view registry, the slot helpers; sx-ui-mod\'s panels (the donors) and mountPart; (SX0) the registry holds the Arpeggiator and the Clip sequencer alone, mountPart nothing else; the parts machinery and the main menu gone', () => {
  for (const k of ['SerumHost', 'createHost', 'slotHost', 'defineView', 'viewKinds', 'overlaySlot', 'readSlot', 'storeDensity', 'makeKit', 'PresetBrowser']) assert.equal(typeof H[k], 'function', k);
  assert.deepEqual(H.SLOT, { lfo: 0, env: 1, chaos: 0, macro: 0 });
  assert.equal(H.HOST_OPTS.undo, true);
  for (const k of ['MacrosPanel', 'EnvPanel', 'LfoPanel', 'CurvePanel', 'VoicingPanel', 'ChaosRow', 'OutputsPanel', 'QualityPanel', 'TuningPanel', 'VcPanel', 'PrefsPanel', 'InfoPanel', 'panelDialog', 'mountPart']) assert.equal(typeof M[k], 'function', k);
  for (const k of ['VoiceHeader', 'MpePanel', 'VoicePanel', 'partView', 'mountSlot', 'PART_W', 'PART_PH']) assert.equal(k in M, false, k + ' gone (SX0)');
  for (const k of ['logo', 'MPE_XYZ_LABEL', 'DEFAULT_KEY']) assert.equal(k in H, false, k + ' gone with the main menu (SX0)');
  for (const k of ['mainMenu', 'about', 'initPreset', 'loadPresetFile', 'revertPreset', 'saveDefault', 'resample', 'renderOscWarp', 'veloAmp', 'vibrato', 'chainMenu', 'saveChainDialog', 'loadChain', 'chains'])
    assert.equal(k in H.SerumHost.prototype, false, 'SerumHost.' + k + ' gone with the main menu (SX0)');
  assert.deepEqual(H.viewKinds().sort(), ['arp', 'clip']);
  const { box, X } = parts({ tracks: () => [], seqCmd() {} });
  for (const p of ['oscA', 'filter', 'voice', 'macros', 'nope']) assert.equal(M.mountPart(X, p, box), null, p + ': no view');
  const A = M.mountPart(X, 'arp', box);
  assert.deepEqual([A.kind, A.root.className, A.root.getAttribute('data-col'), A.root.style.width, X.views.length, box.contains(A.root)], ['arp', 'sx-root sx-part', 'P', '1184px', 1, true]);
  X.destroy();
  assert.throws(() => H.slotHost('wheel', {}), /no slot/);
});

/* ================================================================ mount, views, paint gating (H4) */
test('mount: a part root per view (div.sx-root.sx-part, data-dev, data-col, its width), the panel built on the view\'s own page; twice = two views of one state with unique ids; unmount removes it', async () => {
  const { doc, box, X, s } = parts();
  const a = donor(X, 'lfo3', box, { col: 'C', width: 395.453125 }), b = donor(X, 'lfo3', box, { col: 'C', width: 395.453125 });   // (a face passes its own width: rig-ui)
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
  const V = donor(X, 'voicing', box, { shown: () => on }), W = donor(X, 'noise', box);
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
  const a = donor(one.X, 'oscA', one.box), b = donor(one.X, 'oscB', one.box), c = donor(Y, 'oscA', box2);
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

// (the user, on Windows: a "Swap · OSC A" ghost stuck on a Wavecraft canvas — reproduced in Chrome for Testing: a click on Oscillator 1's
// bar title, then the mouse moved over it with no button down)
test('no orphaned drag ghost: a press on a canvas bar title whose release goes to the bar (cv-module\'s grab) leaves nothing armed — a later hover over the title, no button down, makes no "Swap · OSC A" ghost; a label drag\'s ghost goes when its title goes mid-drag and on the window\'s blur; the Alt depth drag\'s goes when its view root goes (lostpointercapture at the document) and on the blur', async () => {
  const { doc, box, host, X, s } = parts();
  const Va = donor(X, 'oscA', box), Vb = donor(X, 'oscB', box);
  await flush(doc);
  const bar = doc.createElement('div'), ta = doc.createElement('span'), barB = doc.createElement('div'), tb = doc.createElement('span');
  bar.append(ta); barB.append(tb); doc.body.append(bar, barB);
  bar.addEventListener('pointerdown', e => bar.setPointerCapture(e.pointerId)); // (cv-module's bar: the press's events go to it)
  Va.labelDrag(ta); Vb.labelDrag(tb);
  const ghosts = () => doc.body.querySelectorAll('.sx-ghost').map(g => g.textContent).join('|');
  const hover = x => fire(ta, 'pointermove', { clientX: x, clientY: 10, buttons: 0 });
  ptr(ta, 'pointerdown', 10, 10); ptr(bar, 'pointerup', 10, 10);
  hover(30); hover(60);
  assert.equal(ghosts(), '', 'a click on the title, then a hover');
  ptr(ta, 'pointerdown', 10, 10); ptr(bar, 'pointermove', 60, 40); ptr(doc.body, 'pointerup', 60, 40);
  hover(30);
  assert.equal(ghosts(), '', 'the bar\'s own drag (the module moved), then a hover');
  // a live label drag (OSC B's title, no grab): its title re-rendered away mid-drag
  ptr(tb, 'pointerdown', 10, 10); ptr(tb, 'pointermove', 40, 10);
  assert.equal(ghosts(), 'Swap · OSC B');
  tb.remove(); fire(doc, 'lostpointercapture', { pointerId: 1, cancelable: false });
  assert.equal(ghosts(), '', 'title removed');
  barB.append(tb);
  ptr(tb, 'pointerdown', 10, 10); ptr(tb, 'pointermove', 40, 10); fire(doc.defaultView, 'blur', { bubbles: false, cancelable: false });
  assert.equal(ghosts(), '', 'blur');
  ptr(tb, 'pointerup', 40, 10);
  // the Alt depth drag on a knob of OSC A's face
  core.addMod(s(), host.st.fx, 'lfo2', 'a.pan', { amt: 0.3 });
  const knob = byDest(Va.root, 'a.pan');
  ptr(knob, 'pointerdown', 100, 100, { altKey: true, pointerId: 3 });
  assert.match(ghosts(), /^LFO 2/);
  const root = Va.root, par = root.parentNode;
  root.remove(); fire(doc, 'lostpointercapture', { pointerId: 3, cancelable: false });
  assert.equal(ghosts(), '', 'the view root removed mid-drag');
  assert.equal(host.log.filter(x => x[1] === 'Mod depth').at(-1)[2], 'end');
  par.appendChild(root);
  ptr(knob, 'pointerdown', 100, 100, { altKey: true, pointerId: 4 });
  assert.match(ghosts(), /^LFO 2/);
  fire(doc.defaultView, 'blur', { bubbles: false, cancelable: false });
  assert.equal(ghosts(), '', 'blur mid depth drag');
  assert.equal(host.log.filter(x => x[1] === 'Mod depth').at(-1)[2], 'end');
  ptr(root, 'pointerup', 100, 50, { pointerId: 4 });
  X.destroy();
});

/* ================================================================ bare panels */
test('bare: the canvas bar\'s chrome goes (power → View.power, no name / lock mark / chevron / ENV tabs), every own head control stays in the head row; the bar ⏻ keeps its menu and halo', async () => {
  const { doc, box, X, s } = parts();
  const V = {};
  for (const p of ['oscA', 'sub', 'noise', 'filter', 'env2', 'lfo1', 'macros']) V[p] = donor(X, p, box);
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
  // ((SX0) the registered osc view's bundled look and press-to-select (sx-opan / data-o, s.ui.osc) went with the view registrations)
  X.destroy();
});

test('H1 / H3: an oscillator part builds its active type view only (others at their first switch); an LFO builds its PATH editor at the first Path type, then keeps it', async () => {
  const { doc, box, X, s } = parts();
  const O = donor(X, 'oscA', box);
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
  const n0 = made(), L = donor(X, 'lfo2', box);
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
  assert.deepEqual([V.root.className, V.root.getAttribute('data-nomod'), X.opts.undo, X.opts.nomod], ['sx-root sx-part', '1', false, true]);   // ((SX0) its PART_W width went)
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

test('slot host chaos: one chaos row (RATE, BPM, MONO, S&H) with its label as the bundled GLOBAL page draws it ("CHAOS 1"); the toggles edit the chaos object whole, BPM the bpm field', async () => {
  const { doc, V, calls } = slot('chaos', { chaos: { mono: 1, sh: 0 }, rate: 0.3 });
  await flush(doc);
  assert.equal((V.root.querySelector('.sx-txt') || {}).textContent, 'CHAOS 1');
  // ((SX0) review 2's "CHAOS <n>" by the module id was the registered chaos view's: a slot face titles its bar so — rig-ui.test, slot faces)
  assert.ok(byDest(V.root, 'c1.rate') && byDest(V.root, 'c1.bpm'));
  const tog = t => V.root.querySelectorAll('.wk-tog').find(b => b.textContent.trim() === t);
  fire(tog('S&H'), 'click');
  fire(tog('BPM'), 'click');
  assert.deepEqual(calls.map(c => c[1]), [{ chaos: { mono: 1, sh: 1 } }, { bpm: 1 }]);
});

/* ================================================================ (MM, IMPL-MM §7.2; lane U) the MONO lock: the master has no notes */
// The slot-host option lock: { mono: 1 } (cv-mods-ui slotBody passes it): an LFO's and a Chaos row's MONO switch (GLOBAL / PER NOTE) reads
// GLOBAL, is disabled and ignores a tap — the master's pseudo-voice never runs, a per-note LFO there would go dead. Presentation only (the host
// forces the field back too); a Serum's own panel and a canvas module without the option are unchanged node for node.
const monoOf = root => root.querySelectorAll('.wk-tog').find(b => b.textContent.trim() === 'MONO');
// a panel as one string: tags, attributes, text (the host's unique ids numbered away)
const shapeOf = n => '<' + n.localName + [...n._a].filter(([k]) => k !== 'style').map(([k, v]) => ' ' + k + '=' + String(v).replace(/sx\d+/g, 'sxN')).sort().join('') + '>'
  + (n.children.length ? n.children.map(shapeOf).join('') : n.textContent) + '</>';

test('(MM) the MONO lock — lock: { mono: 1 }: an LFO\'s and a Chaos row\'s MONO switch reads GLOBAL (pressed) whatever the device says, is disabled (aria-disabled, wk-dis) with the lock tip, and a tap changes nothing — no live, no edit; the other switches still edit; an outside change (sync) keeps it locked', async () => {
  assert.equal(M.MONO_LOCK_TIP, 'The master’s modulators are global (it has no notes)');
  for (const [kind, rec, field] of [['lfo', { lfo: { mono: 0 }, rate: 0.5 }, 'lfo'], ['chaos', { chaos: { mono: 0, sh: 0 }, rate: 0.3 }, 'chaos']]) {
    const R = slot(kind, rec, { lock: { mono: 1 } });
    await flush(R.doc);
    const m = monoOf(R.V.root);
    assert.deepEqual([m.getAttribute('aria-pressed'), m.getAttribute('aria-disabled'), m.classList.contains('wk-dis'), m.classList.contains('wk-on'), m.title, R.dev.r[field].mono],
      ['true', 'true', true, true, M.MONO_LOCK_TIP, 0], kind + ': GLOBAL, disabled, the tip; the device itself untouched');
    fire(m, 'click'); fire(m, 'click');
    ptr(m, 'pointerdown', 5, 5); ptr(m, 'pointerup', 5, 5);
    assert.deepEqual([R.calls, R.dev.r[field].mono], [[], 0], kind + ': a tap changes nothing (no live, no edit)');
    // every other switch of the panel works as before
    const other = R.V.root.querySelectorAll('.wk-tog').find(b => b.textContent.trim() === 'BPM');
    assert.equal(other.getAttribute('aria-disabled'), null, kind + ': BPM not disabled');
    fire(other, 'click');
    assert.deepEqual(R.calls.map(c => c[0]), ['edit'], kind + ': BPM = one edit');
    // an outside change (undo / redo / a load) writing a mono 0 back: still shown GLOBAL and locked
    R.dev.r = song.normModDev(Object.assign({ kind }, rec));
    R.X.sync();
    assert.deepEqual([monoOf(R.V.root).getAttribute('aria-pressed'), monoOf(R.V.root).getAttribute('aria-disabled')], ['true', 'true'], kind + ': after sync');
    R.X.destroy();
  }
});

test('(MM UI fixer, review MM-2 P3-2) a tap on a locked MONO says why — one notice (the host\'s notify) with MONO_LOCK_TIP per tap, still no live / edit; an unlocked MONO notifies nothing', async () => {
  for (const [kind, rec] of [['lfo', { lfo: { mono: 0 } }], ['chaos', { chaos: { mono: 0, sh: 0 } }]]) {
    const said = [], R = slot(kind, rec, { lock: { mono: 1 }, notify: t => said.push(t) });
    await flush(R.doc);
    fire(monoOf(R.V.root), 'click');
    assert.deepEqual([said, R.calls], [[M.MONO_LOCK_TIP], []], kind + ': the notice, nothing written');
    fire(monoOf(R.V.root), 'click');
    assert.equal(said.length, 2, kind + ': each tap');
    R.X.destroy();
    const said2 = [], U = slot(kind, rec, { notify: t => said2.push(t) });
    await flush(U.doc);
    fire(monoOf(U.V.root), 'click');
    assert.deepEqual([said2, U.calls.map(c => c[0])], [[], ['edit']], kind + ': unlocked — an edit, no notice');
    U.X.destroy();
  }
});

test('(MM) the MONO lock is the option\'s alone — no lock, lock: {} / { mono: 0 } / null: the LFO\'s and the Chaos row\'s panel node for node as before (MONO enabled, its old tip, one edit on a tap); the lock changes the MONO switch alone; an ENV or a Macro panel ignores it', async () => {
  for (const kind of ['lfo', 'chaos']) {
    const rec = { chaos: { mono: 1, sh: 0 }, lfo: { mono: 1 } };
    const base = slot(kind, rec);
    await flush(base.doc);
    const want = shapeOf(base.V.root);
    for (const lock of [undefined, null, {}, { mono: 0 }, { other: 1 }]) {
      const R = slot(kind, rec, { lock });
      await flush(R.doc);
      assert.equal(shapeOf(R.V.root), want, kind + ' lock ' + JSON.stringify(lock) + ': unchanged');
      R.X.destroy();
    }
    const m = monoOf(base.V.root);
    assert.deepEqual([m.getAttribute('aria-disabled'), m.classList.contains('wk-dis'), m.title], [null, false, kind === 'lfo' ? 'MONO: one LFO for every voice' : '']);
    fire(m, 'click');
    assert.deepEqual([base.calls.length, base.calls[0][0]], [1, 'edit'], kind + ': a tap edits as always');
    // locked vs unlocked: the MONO switch alone differs
    const L = slot(kind, rec, { lock: { mono: 1 } }), U = slot(kind, rec);
    await flush(L.doc); await flush(U.doc);
    const rest = R => R.V.root.querySelectorAll('.wk-tog').filter(b => b.textContent.trim() !== 'MONO').map(shapeOf).join('');
    assert.equal(rest(L), rest(U), kind + ': the other switches unchanged');
    assert.ok(shapeOf(monoOf(L.V.root)) !== shapeOf(monoOf(U.V.root)), kind + ': the MONO switch differs');
    base.X.destroy(); L.X.destroy(); U.X.destroy();
  }
  for (const kind of ['env', 'macro']) {
    const a = slot(kind, {}), b = slot(kind, {}, { lock: { mono: 1 } });
    await flush(a.doc); await flush(b.doc);
    assert.equal(shapeOf(b.V.root), shapeOf(a.V.root), kind + ': no MONO there: the option is ignored');
    a.X.destroy(); b.X.destroy();
  }
  assert.equal(H.HOST_OPTS.monoLock, undefined, 'HOST_OPTS (a Serum\'s own host) unchanged: the lock is a slot host\'s option');
});

/* ================================================================ IMPL-FR Cut A: the rate class, numeric keys (§3 B3, §7.3) */
// the frames of a display at T (ms): the rAF callbacks queued before it, then the frame's own work
const frameAt = (doc, T) => { for (const f of doc.defaultView.raf.splice(0)) f(T); };
test('IMPL-FR §3 B3: canvas(cls, key, draw, { maxHz }) — a key change inside the period waits for its end (one rAF, re-armed until due, then drawn with the newest key: nothing lost, nothing armed at rest); without maxHz every change draws; a 60 class is inert on a 60 Hz display; a re-measured canvas draws at once', () => {
  let T = 1000;
  const doc = D.fresh(), X = H.createHost(mkHost(), { doc, now: () => T });
  WK.clock._reset(); WK.clock.config({ display: 120 });
  try {
    let a = 0, b = 0;
    const ta = [], va = [], tb = [];
    const heavy = X.canvas('t-heavy', () => a, () => { ta.push(T); va.push(a); }, { maxHz: 60 });
    const light = X.canvas('t-light', () => b, () => { tb.push(T); });
    assert.deepEqual([heavy.maxHz, light.maxHz || 0], [60, 0]);
    frameAt(doc, T);
    X.paintCanvases();
    assert.deepEqual([va, tb.length], [[0], 1]);
    // 120 Hz frames with a key change in each: the 60 class every second frame (the change of the frame between waits one
    // rAF and is drawn with the newer key), the plain canvas every frame
    for (let f = 1; f <= 24; f++) { T += 1000 / 120; frameAt(doc, T); a = b = f; X.paintCanvases(); }
    assert.equal(tb.length, 25);
    assert.equal(ta.length, 13);
    for (let i = 1; i < ta.length; i++) assert.ok(ta[i] - ta[i - 1] >= 1000 / 60 - 1e-6, 'drawn ' + (ta[i] - ta[i - 1]) + ' ms apart');
    assert.ok(va.every((v, i) => !i || v > va[i - 1]), 'each draw has a newer key');
    // the changes stop: the last one is drawn at the period's end, then nothing stays armed
    T += 1000 / 120; frameAt(doc, T);
    T += 1000 / 120; frameAt(doc, T);
    assert.equal(va.at(-1), 24);
    assert.equal(doc.defaultView.raf.length, 0, 'no rAF at rest');
    // a second change inside one period arms one rAF only
    T += 1; a = 25; X.paintCanvases(); a = 26; X.paintCanvases();
    assert.equal(doc.defaultView.raf.length, 1);
    // re-measured (a resize: its store was cleared) → drawn at once, whatever the period
    T += 1000 / 120; frameAt(doc, T);
    const n0 = ta.length;
    T += 1; a = 27; heavy.sized = false; X.paintCanvases();
    assert.deepEqual([ta.length, va.at(-1)], [n0 + 1, 27]);
    // a 60 Hz display: a 60 class draws every frame (inert)
    WK.clock.config({ display: 60 });
    frameAt(doc, T += 50);
    const n1 = ta.length;
    for (let f = 1; f <= 6; f++) { T += 1000 / 60; frameAt(doc, T); a = 100 + f; X.paintCanvases(); }
    assert.equal(ta.length, n1 + 6);
    // the clock not measured yet (no client ran: its 60 default) on a 120 Hz display: still every second frame
    WK.clock._reset();
    frameAt(doc, T += 50);
    const n2 = ta.length;
    for (let f = 1; f <= 24; f++) { T += 1000 / 120; frameAt(doc, T); a = 200 + f; X.paintCanvases(); }
    assert.equal(ta.length - n2, 12);
  } finally { WK.clock._reset(); X.destroy(); }
});

test('IMPL-FR §3 B3 (review 1, P3-3; lead: the 60 minimum): a 60 class draws at the display\'s multiple nearest 60 from above — never below 60 a second (82.5: a 165 Hz display at the 120 setting; 72: Medium on a 144 Hz one; 144 → 72; 240 → 60), never every frame of a fast one', () => {
  for (const [Dd, cap, E, want] of [[165, 120, 82.5, 82.5], [144, 60, 72, 72], [144, 120, 144, 72], [120, 120, 120, 60], [100, Infinity, 100, 100], [240, Infinity, 240, 60], [165, Infinity, 165, 82.5]]) {
    let T = 1000;
    const doc = D.fresh(), X = H.createHost(mkHost(), { doc, now: () => T });
    WK.clock._reset(); WK.clock.config({ display: Dd }); WK.clock.setCap(cap);
    try {
      assert.equal(WK.clock.eff(), E, 'the effective rate');
      let a = 0;
      const ta = [];
      X.canvas('t-heavy', () => a, () => { ta.push(T); }, { maxHz: 60 });
      frameAt(doc, T); X.paintCanvases();
      // the display's frames for 2 s, a key change on each (posts faster than any display): drawn at ≥ 60 / s, < 120 / s
      for (let f = 1; f <= 2 * Dd; f++) { T += 1000 / Dd; frameAt(doc, T); a = f; X.paintCanvases(); }
      const gaps = ta.slice(1).map((t, i) => t - ta[i]), rate = (ta.length - 1) / ((ta.at(-1) - ta[0]) / 1000);
      assert.ok(gaps.every(g => g <= 1000 / 60 + 1e-6 && g > 1000 / 120 + 1e-6), `D ${Dd} cap ${cap}: drawn ${Math.min(...gaps).toFixed(2)}–${Math.max(...gaps).toFixed(2)} ms apart`);
      assert.ok(Math.abs(rate - want) < 1e-6, `D ${Dd} cap ${cap}: ${rate} a second, want ${want}`);
    } finally { WK.clock._reset(); X.destroy(); }
  }
});

test('IMPL-FR §3 B3 (review 2, P3-2): the rate class is timed by the frame\'s rAF timestamp, not performance.now() — a snapshot per frame on a 60 Hz display holds 60 draws a second (54 when the paint read the clock wherever in its frame it ran)', () => {
  let T = 1000, k = 0;
  const JIT = [0, 7, 1, 6, 0, 8, 2, 5], doc = D.fresh(), X = H.createHost(mkHost(), { doc, now: () => T + JIT[k++ % JIT.length] }); // (performance.now: the frame's start + where its callback ran)
  WK.clock._reset(); WK.clock.config({ display: 60 });
  try {
    let a = 0;
    const ta = [], tl = [];
    X.canvas('t-heavy', () => a, () => { ta.push(T); }, { maxHz: 60 });
    X.canvas('t-light', () => a, () => { tl.push(T); });
    frameAt(doc, T); X.paintCanvases();
    // a snapshot each frame (Cut B's rate; the harness's per-frame feed): painted in the snapshot's rAF
    for (let f = 1; f <= 120; f++) { a = f; X.setSnapshot({ s: { notes: 0 } }); T += 1000 / 60; frameAt(doc, T); }
    assert.equal(tl.length - 1, 120, 'the plain canvas: every frame');
    assert.equal(ta.length - 1, 120, 'the 60 class on a 60 Hz display: every frame, whatever the jitter inside it (' + (ta.length - 1) + ' of 120)');
    // a 120 Hz display: every second frame, exactly
    WK.clock.config({ display: 120 });
    frameAt(doc, T += 50);
    const n0 = ta.length;
    for (let f = 1; f <= 120; f++) { a = 1000 + f; X.setSnapshot({ s: { notes: 0 } }); T += 1000 / 120; frameAt(doc, T); }
    assert.equal(ta.length - n0, 60, 'a 120 Hz display: 60 of 120 frames');
  } finally { WK.clock._reset(); X.destroy(); }
});

test('FR Cut B review 2 (P1-1): the heavy displays on Medium / Low (host.heavyHz() 30) redraw at ≤ 30 a second — a ceiling over the 60 class and a capHz curve —, and the frame clock\'s drop level halves every heavy display\'s rate per level (the class, the ceiling, the curve), never below 15 a second; a plain canvas (a marker, a dot, a playhead) every frame whatever the level', () => {
  // [display, host.heavyHz (0: none — High), the canvas (maxHz 60 | capHz n), the drop level, the rate a second]
  const rows = [[120, 0, 'm', 0, 60], [120, 30, 'm', 0, 30], [60, 30, 'm', 0, 30], [240, 30, 'm', 0, 30], [144, 30, 'm', 0, 28.8],
    [120, 0, 'm', 1, 30], [120, 0, 'm', 2, 15], [120, 0, 'm', 3, 15], [240, 0, 'm', 1, 30], [60, 0, 'm', 1, 30], [60, 0, 'm', 2, 15], [60, 0, 'm', 3, 15],
    [120, 30, 'm', 1, 15], [120, 30, 'm', 3, 15], [165, 0, 'm', 3, 15],
    [120, 0, 60, 0, 60], [120, 30, 60, 0, 30], [120, 0, 60, 1, 30], [120, 0, 30, 1, 15], [120, 0, 60, 3, 15], [240, 0, 60, 2, 15]];
  for (const [Dd, hv, kind, drop, want] of rows) {
    let T = 1000;
    const doc = D.fresh(), X = H.createHost(mkHost(hv ? { heavyHz: () => hv } : {}), { doc, now: () => T });
    WK.clock._reset(); WK.clock.config({ display: Dd, drop });
    try {
      let a = 0;
      const ta = [], tl = [];
      X.canvas('t-heavy', () => a, () => { ta.push(T); }, kind === 'm' ? { maxHz: 60 } : { capHz: kind });
      X.canvas('t-light', () => a, () => { tl.push(T); });
      frameAt(doc, T); X.paintCanvases();
      for (let f = 1; f <= 2 * Dd; f++) { T += 1000 / Dd; frameAt(doc, T); a = f; X.paintCanvases(); }
      const rate = (ta.length - 1) / ((ta.at(-1) - ta[0]) / 1000), tag = `D ${Dd} heavyHz ${hv} ${kind === 'm' ? 'maxHz 60' : 'capHz ' + kind} drop ${drop}`;
      assert.ok(Math.abs(rate - want) < 1e-6, `${tag}: ${rate} a second, want ${want}`);
      assert.equal(tl.length - 1, 2 * Dd, tag + ': the plain canvas every frame');
    } finally { WK.clock._reset(); X.destroy(); }
  }
});

test('IMPL-FR §7.3: keyN(out) — the key as numbers into the canvas\' own buffer (two, swapped: no array per paint), compared element-wise (NaN equals NaN; a count change differs); key() is never called; a throwing keyN redraws', () => {
  const doc = D.fresh(), X = H.createHost(mkHost(), { doc });
  const kk = [1, 'a', NaN];
  let nk = 0, keys = 0;
  const num = X.canvas('t-num', () => { keys++; return 'x'; }, () => { nk++; }, { keyN: k => { for (let i = 0; i < kk.length; i++) k[i] = kk[i]; return kk.length; } });
  X.paintCanvases();
  X.paintCanvases();
  assert.equal(nk, 1);
  const bufs = new Set([num.kb, num.kp]);
  assert.equal(bufs.size, 2);
  kk[1] = 'b'; X.paintCanvases();
  kk.push(3); X.paintCanvases();
  kk.pop(); X.paintCanvases();
  kk[0] = 1; X.paintCanvases();
  assert.equal(nk, 4);
  for (let i = 0; i < 5; i++) X.paintCanvases();
  assert.equal(nk, 4);
  assert.ok(bufs.has(num.kb) && bufs.has(num.kp), 'the same two buffers');
  assert.equal(keys, 0);
  let bad = 0;
  X.canvas('t-bad', () => 'k', () => { bad++; }, { keyN: () => { throw new Error('no key'); } });
  X.paintCanvases(); X.paintCanvases();
  assert.equal(bad, 2);
  X.destroy();
});

test('IMPL-FR §3 B3 (§13 P1-2): the heavy displays declare maxHz 60 and a keyN — the wavetable display, the filter response (its spectrum views too), the spectral filter; playheads and overviews none — and an LFO on cutoff posted at 120 Hz redraws the filter display at ≤ 60 / s', async () => {
  let T = 1e6; // (review 2, P3-2: a frame's paint is timed by its rAF stamp — the mount's flush stamps frames with the stub DOM's
  // event counter (≈ 1 000 up), so this clock starts above it: one time base for the frames, as a browser's)
  const { doc, box, X, s } = parts();
  X.tNow = () => T;
  WK.clock._reset(); WK.clock.config({ display: 120 });
  try {
    const A = donor(X, 'oscA', box), F = donor(X, 'filter', box), N = donor(X, 'noise', box);
    await flush(doc);
    const cvOf = (V, re) => V.page.canvases.find(cv => re.test(cv.el.getAttribute('aria-label') || ''));
    const rate = cv => [cv.maxHz || 0, typeof cv.keyN === 'function'];
    assert.deepEqual(rate(cvOf(A, /^OSC A wavetable display/)), [60, true]);
    // (IMPL-FR-B §4.3, the user's QB: the filter display's curve moved to a ceiling — capHz, host.curveHz() or 60 — from the 60 class)
    assert.deepEqual([...rate(cvOf(F, /^FILTER 1 display/)), typeof cvOf(F, /^FILTER 1 display/).capHz], [0, true, 'function']);
    assert.deepEqual(rate(cvOf(N, /^Noise overview/)), [0, false]);
    s().osc[0].type = 'spec';
    X.refresh();
    await flush(doc);
    assert.deepEqual(rate(cvOf(A, /^OSC A spectral filter/)), [60, true]);
    const spg = A.page.canvases.filter(cv => cv.el.getAttribute('data-oscdisp') === '0' && !cv.maxHz);
    assert.ok(spg.length >= 1, 'the sample / spectrogram displays (a playhead) keep every change');
    // an LFO on FILTER 1 cutoff, posted at 120 Hz while a note sounds: the display redraws at ≤ 60 / s
    const disp = cvOf(F, /^FILTER 1 display/), g = disp.el.getContext('2d'), clears = () => g.calls.filter(c => c[0] === 'clearRect').length;
    const eff = new Float32Array(core.NSV + 64), vi = core.vi('f.cutoff');
    frameAt(doc, T);
    const c0 = clears();
    for (let f = 1; f <= 60; f++) {
      T += 1000 / 120;
      eff[vi] = 0.3 + 0.4 * Math.sin(f / 5);
      X.setSnapshot({ s: { notes: 1, eff } });
      frameAt(doc, T);
    }
    const n = clears() - c0;
    assert.ok(n >= 28 && n <= 31, n + ' redraws in 0.5 s of 120 Hz posts');
  } finally { WK.clock._reset(); X.destroy(); }
});

/* ================================================================ budgets, CLIP twins */
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

// ((SX0) VOICE — VoicePanel / VoiceHeader and the host's touch status line it carried — left with the parts machinery: the Amplifier
// face holds VOICING, the outputs and the dialogs (rig-ui.test "the Amplifier"; Preferences… / Info… sx-helpers.test))
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
    const V = donor(X, p, box), t = doc.createElement('span');
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
  const V = donor(X, 'oscA', box), t = doc.createElement('span');
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
  const Vm = donor(X, 'macros', box, { shown: () => on, opts: { tiles: 'jack' } }), Vf = donor(X, 'filter', box, { shown: () => on });
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

// ((SX0) review 2's PART_W / PART_PH parity left with them: no view passes a width table or a phase now)
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

test('part CSS: a part root (a face\'s, the Arpeggiator / Clip view\'s) is container sxp without a frame, keeps its width in a flex body (flex: none); an empty bare title row hides; the O column\'s 30 px knobs restated for parts', () => {
  const src = readFileSync(new URL('../sx-host.js', import.meta.url), 'utf8'), a = src.indexOf('const CSS = `');
  const css = src.slice(a + 13, src.indexOf('`;', a)).replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = sel => { const i = css.indexOf(sel + ' {'); return i < 0 ? null : css.slice(i + sel.length + 2, css.indexOf('}', i)); };
  const part = rule('.sx-root.sx-part');
  assert.ok(part !== null);
  for (const re of [/container:\s*sxp \/ inline-size/, /flex:\s*none/, /margin:\s*0 auto/, /background:\s*none/, /box-shadow:\s*none/]) assert.match(part, re);
  assert.match(rule('.sx-panel.sx-bare > .sx-ptitle.sx-bare:empty'), /display:\s*none/);
  assert.match(rule('.sx-part[data-col="O"] .wk-md, .sx-part[data-col="O"] .wk-lg'), /--wk-d:\s*30px/);
});

/* ================================================================ (WC-2 displays) the display palette */
// The kit's displays follow the skin: a canvas' palette (sx-ui-osc dispPalette: the --sxd-* tokens, today's colours their defaults) is
// resolved when the canvas is measured and only when its skin (the nearest data-cv-skin) is not the one it was resolved for — never per
// frame, not again at a zoom end; a skin pick (main.js: wk.rescaleCanvases over the world) re-measures every canvas, so it reads it again
test('(WC-2 displays) a display canvas\' palette: resolved at its sizing once per skin (no getComputedStyle per frame, none at a zoom end), handed to its draw as the fifth argument; a skin change reads it again; .sx-disp\'s ground is --sxd-bg (#0a0d10 its default)', async () => {
  const src = readFileSync(new URL('../sx-host.js', import.meta.url), 'utf8'), a = src.indexOf('const CSS = `');
  const css = src.slice(a + 13, src.indexOf('`;', a)).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.sx-disp \{ display: block; width: 100%; height: 120px; background: var\(--sxd-bg, #0a0d10\);/, 'the screen\'s ground: the token, today\'s colour its default');
  const OSC = await import('../sx-ui-osc.js?v=9');
  assert.equal(typeof OSC.dispPalette, 'function');
  let T = 1e6, reads = 0;
  const { doc, box, X } = parts();
  X.tNow = () => T;
  const IV = { '--sxd-bg': '#f3efe4', '--sxd-mute': '#5d574c' };
  const skinOf = el => { const w = el && el.closest ? el.closest('[data-cv-skin]') : null; return w ? w.getAttribute('data-cv-skin') : ''; };
  doc.defaultView.getComputedStyle = el => ({ getPropertyValue: k => { if (k === '--sxd-bg') reads++; return skinOf(el) === 'ivory' && IV[k] ? ' ' + IV[k] : ''; } });
  box.setAttribute('data-cv-skin', 'charcoal');
  WK.clock._reset(); WK.clock.config({ display: 120 });
  try {
    const A = donor(X, 'oscA', box), F = donor(X, 'filter', box), N = donor(X, 'noise', box);
    const cvs = [A, F, N].flatMap(V => V.page.canvases), got = new Map();
    for (const cv of cvs) { const d = cv.draw; cv.draw = (g, w, h, dpr, p) => { got.set(cv, p); return d(g, w, h, dpr, p); }; }
    await flush(doc);
    const drawn = () => cvs.filter(cv => got.has(cv));
    assert.ok(drawn().length >= 3, drawn().length + ' displays drawn');
    assert.equal(reads, drawn().length, 'one read per canvas measured');
    const P0 = OSC.dispPalette();
    assert.ok(drawn().every(cv => got.get(cv) === P0), 'charcoal: the defaults (one interned palette)');
    // frames: an LFO on cutoff, a note — the displays redraw, the palette is not read again
    const eff = new Float32Array(core.NSV + 64), vi = core.vi('f.cutoff'), n0 = reads;
    got.clear();
    for (let f = 1; f <= 40; f++) { T += 1000 / 120; eff[vi] = 0.3 + 0.4 * Math.sin(f / 5); X.setSnapshot({ s: { notes: 1, eff } }); frameAt(doc, T); }
    assert.ok(got.size >= 1, 'redrawn');
    assert.equal(reads, n0, 'no palette read per frame');
    // a zoom end: every canvas re-measured, the skin the same — no read
    WK.rescaleCanvases(box);
    got.clear();
    for (let f = 1; f <= 3; f++) { T += 1000 / 120; frameAt(doc, T); }
    await flush(doc);
    assert.ok(got.size >= 1, 'drawn again after the zoom end');
    assert.equal(reads, n0, 'no read at a zoom end');
    // a skin pick: the attribute, then the world's re-measure → one read per canvas, the draws in the new palette
    box.setAttribute('data-cv-skin', 'ivory');
    WK.rescaleCanvases(box);
    got.clear();
    await flush(doc);
    const P1 = drawn().map(cv => got.get(cv));
    assert.ok(P1.length >= 3 && P1.every(p => p && p.bg === '#f3efe4' && p.mute === '#5d574c' && p.grid === P0.grid), 'Ivory\'s palette, the tokens it does not set at their defaults');
    assert.ok(P1.every(p => p === P1[0]), 'one interned palette');
    assert.equal(reads - n0, drawn().length, 'one read per canvas, once');
    for (let f = 1; f <= 20; f++) { T += 1000 / 120; eff[vi] = 0.5 + 0.3 * Math.sin(f / 3); X.setSnapshot({ s: { notes: 1, eff } }); frameAt(doc, T); }
    assert.equal(reads - n0, P1.length, 'and not per frame');
  } finally { WK.clock._reset(); X.destroy(); }
});

/* ================================================================ FR Cut B (IMPL-FR-B §4): the view in heard time, the rings, the tick */
const MO = await import('../motion.js?v=9');
const FH = { v: 0 };
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, a + ' != ' + b);
// a parts host told the heard frame (FH.v) and the rate (the fast lane's host members as main.js gives them)
const fparts = over => parts(Object.assign({ heardFrame: () => FH.v, sampleRate: () => 48000 }, over));
// a Serum part's fast message at F (IMPL-FR-B §2.2): the fixed 70 (motion SXF) from o's fields, then the requested eff values
function fmsg(F, o, eff) {
  const L = MO.SXF, v = new Float32Array(L.N + (eff ? eff.length : 0));
  for (const k of ['mix', 'wtPos', 'smpPos', 'lfoPh', 'lfoOut', 'lfoY', 'env', 'envStage', 'envT']) if (o && o[k]) v.set(o[k], L[k]);
  if (o && o.notes !== undefined) v[L.notes] = o.notes;
  if (eff) v.set(eff, L.N);
  return Object.assign({ t: 'fast', F, i: 'i2', k: 1, v }, o && o.q ? { q: o.q } : null, o && o.gr ? { gr: o.gr } : null);
}
const slowSnap = o => Object.assign({ eff: new Float32Array(core.NSV + 64), lfoPh: new Float32Array(10), lfoOut: new Float32Array(10), lfoY: new Float32Array(10),
  env: new Float32Array(4), envStage: new Uint8Array(4), envT: new Float32Array(4), wtPos: new Float32Array(3), smpPos: new Float32Array(12),
  mix: new Float32Array(11).fill(-120), notes: 1, noisePos: 0, oscVoices: 2, maxVoices: 8, memNow: new Float32Array(48), seq: new Float64Array(16) }, o);
const mrow = o => Object.assign({ src: '', amt: 0, dst: '', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 }, o);
// the frame clock driven by hand (wk.clock's frames through globalThis.requestAnimationFrame): run(T) runs the queued frame at T
function manualClock(display) {
  const q = [], rAF = globalThis.requestAnimationFrame, cAF = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = f => { q.push(f); return q.length; };
  globalThis.cancelAnimationFrame = () => {};
  WK.clock._reset(); WK.clock.config({ display, gate: false });
  return {
    run: T => { for (const f of q.splice(0)) f(T); },
    done: () => {
      WK.clock._reset();
      if (rAF === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = rAF;
      if (cAF === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = cAF;
    },
  };
}

test('IMPL-FR-B §4.1: the view — kit.snap() is one persistent object holding exactly the slow message\'s fields (its own arrays, the values copied), kit.msg() / host.raw the message\'s s itself (FR7); partial snapshots stay partial; null clears both', async () => {
  const { doc, X } = fparts();
  await flush(doc);
  const s1 = slowSnap(), vi = core.vi('f.cutoff');
  s1.eff[vi] = 0.25; s1.lfoPh[0] = 0.5;
  X.setSnapshot({ s: s1 });
  const V = X.kit.snap();
  assert.ok(V !== s1 && X.kit.msg() === s1 && X.raw === s1, 'the view its own object, msg() the raw s');
  assert.ok(V.eff !== s1.eff && V.eff[vi] === s1.eff[vi] && V.lfoPh[0] === s1.lfoPh[0] && V.oscVoices === 2 && V.eff.length === s1.eff.length);
  const s2 = slowSnap({ oscVoices: 5 });
  s2.eff[vi] = 0.75;
  X.setSnapshot({ s: s2 });
  assert.ok(X.kit.snap() === V && V.eff[vi] === s2.eff[vi] && V.oscVoices === 5 && X.kit.msg() === s2, 'the same view, the new values');
  X.setSnapshot({ s: { notes: 0 } });
  assert.deepEqual(Object.keys(X.kit.snap()), ['notes'], 'a partial snapshot stays partial');
  X.setSnapshot(null);
  assert.deepEqual([X.kit.snap(), X.kit.msg()], [null, null]);
  X.destroy();
});

test('IMPL-FR-B §4.1 / §3: setFast — the fixed 70 and the requested eff values read at the heard frame (LIN / PH / HOLD / TIME bracketed), the slow values back before the first anchor and once the posts stop (stale), kit.msg() never moved; an ix of another count rebuilds the eff ring and keeps the fixed ring\'s anchors (§13 P2-9 d); fastReset flushes', async () => {
  const { doc, X } = fparts();
  await flush(doc);
  const s1 = slowSnap(), vi = core.vi('f.cutoff'), ix = Int16Array.of(vi);
  s1.eff[vi] = 0.9; s1.lfoPh[0] = 0.9; s1.lfoOut[0] = 0.9; s1.envStage[0] = 3; s1.envT[0] = 1;
  X.setSnapshot({ s: s1 });
  const slow = () => [s1.lfoPh[0], s1.lfoOut[0], s1.eff[vi], 3, s1.envT[0]], now = () => { const V = X.kit.snap(); return [V.lfoPh[0], V.lfoOut[0], V.eff[vi], V.envStage[0], V.envT[0]]; };
  FH.v = 900;
  X.setFast(fmsg(1000, { lfoPh: [0.2], lfoOut: [0.4], envStage: [1], envT: [0.01], notes: 1 }, [0.3]), ix);
  X.setFast(fmsg(1400, { lfoPh: [0.3], lfoOut: [0.6], envStage: [1], envT: [0.01 + 400 / 48000], notes: 1 }, [0.5]), ix);
  assert.deepEqual(now(), slow(), 'before the first anchor (BEFORE): the slow values');
  FH.v = 1200;
  const v = now();
  near(v[0], 0.25, 1e-6); near(v[1], 0.5, 1e-6); near(v[2], 0.4, 1e-6); near(v[4], 0.01 + 200 / 48000, 1e-6);
  assert.equal(v[3], 1);
  assert.equal(X.fastLive(), true);
  assert.ok(X.kit.msg() === s1 && s1.eff[vi] === Math.fround(0.9) && s1.lfoPh[0] === Math.fround(0.9), 'the raw message untouched');
  FH.v = 900;
  assert.deepEqual(now(), slow(), 'the heard frame back before the anchors: the slow values again');
  FH.v = 1400 + 0.6 * 48000;
  assert.deepEqual([...now(), X.fastLive()], [...slow(), false], 'no post for STALE_S: the slow values, not live');
  // (§13 P2-9 d) an ix of another count: the eff ring rebuilt (flushed), the fixed ring keeps its anchors
  X.setFast(fmsg(FH.v + 100, { lfoPh: [0.4] }, [0.5]), ix);
  const fr = X.fr, n0 = fr.size;
  X.setFast(fmsg(FH.v + 500, { lfoPh: [0.5] }, [0.6, 0.7]), Int16Array.of(vi, core.vi('f.res')));
  assert.deepEqual([X.fr === fr, fr.size, X.fe.w, X.fe.size], [true, n0 + 1, 2, 1]);
  X.fastReset();
  assert.deepEqual([X.fr ? X.fr.size : 0, X.fastLive()], [0, false]);
  assert.deepEqual(now(), slow(), 'after fastReset: the slow values');
  X.destroy();
});

test('IMPL-FR-B §4.3 (§13 P1-1): while the fast data is live a slow message schedules no paint of its own — slowDue, and the tick (wk.clock client sx-fast) runs the slow work once: every page\'s kit.live (the CLIP recorder anchors its clock), the phase capture from the raw message (FR7); kit.frame(fn) every tick frame with fast = true; the client goes once the posts stop', async () => {
  const C0 = manualClock(120);
  try {
    let T = 1e6;
    const { doc, box, X, s } = fparts({ tracks: () => [], seqCmd() {}, onInput: () => {}, metronome() {} });
    X.tNow = () => T;
    const Cv = M.mountPart(X, 'clip', box);
    await flush(doc);
    const clip = Cv.panel.panel;
    let lives = 0;
    const fr = [];
    X.kit.under(Cv.page, () => { X.kit.live(() => { lives++; }); X.kit.frame((on, fast) => { fr.push(!!fast); }); });
    const q0 = new Float64Array(16); q0[0] = -1; q0[5] = -1;
    X.setSnapshot({ s: slowSnap({ seq: q0 }) });
    await flush(doc);
    assert.ok(fr.length >= 1 && fr.every(f => f === false), 'kit.frame on the slow paint while fast is not live: fast = false');
    assert.equal(clip.record(true), true);
    assert.equal(clip.rec.wait, true, 'waiting for the launch');
    // the fast lane goes live
    FH.v = 1200;
    X.setFast(fmsg(1000, { notes: 1 }), null);
    X.setFast(fmsg(1400, { notes: 1 }), null);
    assert.ok(WK.clock.clients().includes('sx-fast'), 'the tick client added at the first fast push');
    const l0 = lives, raf0 = doc.defaultView.raf.length;
    const q1 = new Float64Array(16); q1[0] = -1; q1[4] = 1; q1[5] = 0;   // the launch happened (the clip plays at 0)
    X.setSnapshot({ s: slowSnap({ seq: q1 }) });
    assert.deepEqual([doc.defaultView.raf.length, X.slowDue, lives, clip.rec.wait], [raf0, true, l0, true], 'no paint of its own: slowDue');
    fr.length = 0;
    T += 1000 / 120; C0.run(T);
    assert.deepEqual([lives - l0, X.slowDue, clip.rec.wait], [1, false, false], 'the tick ran the slow work once: the recorder anchored');
    T += 1000 / 120; C0.run(T);
    assert.equal(lives - l0, 1, 'once per slow message, not per frame');
    assert.ok(fr.length === 2 && fr.every(f => f === true), 'kit.frame every tick frame, fast = true');
    // the phase capture reads the raw message: notes sound (raw) though the heard view says none yet
    s().osc[2].phMem = 'all';
    X.refresh();
    X.setFast(fmsg(1800, { notes: 0 }), null);
    X.setSnapshot({ s: slowSnap({ notes: 1, memNow: new Float32Array(48).fill(0.25), seq: q1 }) });
    FH.v = 1800;
    assert.equal(X.kit.snap().notes, 0, 'the view: no notes heard');
    X.kit.edit(st => { st.osc[2].phMem = 'voice'; }, 'Phase memory');
    await flush(doc);
    assert.deepEqual(s().osc[2].memSet, new Array(16).fill(0.25), 'captured from the raw message');
    // the posts stop: past STALE_S the client removes itself and the view is the slow one
    FH.v = 1800 + 0.6 * 48000;
    T += 1000 / 120; C0.run(T);
    T += 1000 / 120; C0.run(T);
    assert.deepEqual([WK.clock.clients().includes('sx-fast'), X.fastLive(), X.kit.snap().notes], [false, false, 1]);
    clip.record(false);
    X.destroy();
  } finally { C0.done(); }
});

test('IMPL-FR-B §4.2 (§13 P2-3): fastIx() — the modded controls with halo arcs (not every control scanMods lists) and the heavy displays\' liveIds, over the shown views, sorted, unique, ≤ 64; the same array while unchanged; a full paint that changes it tells host.fastIx()', async () => {
  let told = 0, on = true;
  const { doc, box, X } = fparts({ fastIx: () => { told++; } });
  const A = donor(X, 'oscA', box), F = donor(X, 'filter', box, { shown: () => on });
  X.edit(st => { st.matrix[0] = mrow({ src: 'lfo1', amt: 0.3, dst: 'a.level' }); }, { label: 'Row' });
  await flush(doc);
  const heavy = V => V.page.canvases.filter(cv => typeof cv.liveIds === 'function').flatMap(cv => cv.liveIds().map(id => core.vi(id)));
  const want = L => [...new Set(L.filter(i => i >= 0))].sort((a, b) => a - b);
  assert.ok(heavy(A).includes(core.vi('a.wt')), 'the wavetable display declares its WT POS');
  assert.ok(['f.cutoff', 'f.res', 'f.drive', 'f.var', 'f.x', 'f.y'].every(id => heavy(F).includes(core.vi(id))), 'the filter display declares cutoff, res, drive, var, x, y');
  const ix0 = X.fastIx();
  assert.ok(ix0 instanceof Int16Array);
  assert.deepEqual([...ix0], want([core.vi('a.level'), ...heavy(A), ...heavy(F)]));
  assert.ok(!ix0.includes(core.vi('a.pan')), 'a shown control with no arcs: not requested');
  const t0 = told;
  X.paint(true);
  assert.deepEqual([X.fastIx() === ix0, told], [true, t0], 'unchanged: the same array, nothing told');
  X.edit(st => { st.matrix[1] = mrow({ src: 'lfo2', amt: 0.2, dst: 'a.pan' }); }, { label: 'Row' });
  await flush(doc);
  const ix1 = X.fastIx();
  assert.ok(ix1 !== ix0 && ix1.includes(core.vi('a.pan')) && told === t0 + 1, 'a new modded control: a new array, host.fastIx() told');
  on = false;
  X.paint(true);
  assert.ok(!X.fastIx().includes(core.vi('f.res')), 'a hidden view\'s displays drop out');
  // ≤ 64: the rest stay slow (64 rows on 64 shown controls, and the displays' ids)
  const B = donor(X, 'oscB', box), Cc = donor(X, 'oscC', box);
  on = true;
  await flush(doc);
  const dests = [...new Set([A, B, Cc].flatMap(V => V.root.querySelectorAll('[data-dest]').map(n => n.getAttribute('data-dest'))))].filter(id => core.vi(id) >= 0);
  assert.ok(dests.length >= 64, dests.length + ' destinations shown');
  X.edit(st => { dests.slice(0, 64).forEach((id, k) => { st.matrix[k] = mrow({ src: 'lfo1', amt: 0.1, dst: id }); }); }, { label: 'Rows' });
  await flush(doc);
  assert.equal(X.fastIx().length, 64);
  assert.ok([...X.fastIx()].every((v, i, a) => !i || v > a[i - 1]), 'sorted, unique');
  X.destroy();
});

test('IMPL-FR-B §4.3 (the user\'s QB, §13 P1-3): the filter display\'s curve redraws at ≤ 60 / s on High (host.curveHz 60) and ≤ 30 / s on Medium / Low (30) — capHz, a ceiling — while its cutoff marker, an overlay while the fast lane is live, moves every frame; fast off: the marker in the curve, no overlay', async () => {
  const C0 = manualClock(120), HZ = { v: 60 };
  try {
    let T = 1e6;
    const { doc, box, X } = fparts({ curveHz: () => HZ.v });
    X.tNow = () => T;
    const F = donor(X, 'filter', box);
    await flush(doc);
    const disp = F.page.canvases.find(cv => /^FILTER 1 display/.test(cv.el.getAttribute('aria-label') || ''));
    assert.deepEqual([disp.maxHz || 0, typeof disp.capHz, typeof disp.keyN], [0, 'function', 'function']);
    assert.equal(F.root.querySelectorAll('canvas.sxo-fmark').length, 0, 'fast off: no overlay');
    X.setSnapshot({ s: slowSnap() });
    await flush(doc);
    const g = disp.el.getContext('2d'), clears = () => g.calls.filter(c => c[0] === 'clearRect').length;
    const vi = core.vi('f.cutoff');
    let Fp = 10000;
    const run = n => {
      let marks = 0, mk0 = null;
      const c0 = clears();
      for (let f = 0; f < n; f++) {
        Fp += 400;
        const ix = X.fastIx(), e = Array.from(ix, i => (i === vi ? 0.3 + 0.4 * Math.sin(Fp / 4000) : 0.5));
        X.setFast(fmsg(Fp, { notes: 1 }, e), ix);
        FH.v = Fp - 1200;
        T += 1000 / 120;
        frameAt(doc, T); C0.run(T);
        const ov = F.root.querySelectorAll('canvas.sxo-fmark')[0];
        if (ov) { const k = ov.getContext('2d').calls.filter(c => c[0] === 'fillRect').length; if (mk0 !== null && k > mk0) marks++; mk0 = k; }
      }
      return { curve: clears() - c0, marks };
    };
    run(12);                                   // (the fast lane starting: the overlay comes in)
    const hi = run(120);
    assert.equal(F.root.querySelectorAll('canvas.sxo-fmark').length, 1, 'one overlay');
    assert.ok(hi.curve >= 55 && hi.curve <= 60, 'High: ' + hi.curve + ' curve redraws in 1 s');
    assert.ok(hi.marks >= 115, 'the marker every frame: ' + hi.marks + ' of 120');
    HZ.v = 30;
    run(12);
    const lo = run(120);
    assert.ok(lo.curve >= 27 && lo.curve <= 30, 'Medium / Low: ' + lo.curve + ' curve redraws in 1 s');
    assert.ok(lo.marks >= 115, 'the marker still every frame: ' + lo.marks);
    X.destroy();
  } finally { C0.done(); }
});

test('IMPL-FR-B §7 G6 (the host): a retrigger, an ENV stage change, a GR step and a peak posted at F show on the first frame whose heard frame reaches F — and never before it (HOLD / PEAK; a PH jump > a quarter holds); a frame\'s view is computed from that frame\'s heard frame', async () => {
  const { doc, X } = fparts();
  await flush(doc);
  X.setSnapshot({ s: slowSnap() });
  const step = 4000;                                 // anchors every 400 frames (120 Hz); the events at F = 4000
  for (let F = 0; F <= 8000; F += 400) {
    const after = F >= step;
    X.setFast(fmsg(F, { lfoPh: [after ? 0.05 + (F - step) / 48000 : 0.6 + F / 48000], envStage: [after ? 2 : 1], mix: [after ? -3 : -40], notes: 1,
      gr: Float32Array.of(after ? 6 : 0, 0, 0, 0) }), null);
  }
  const seen = [];
  for (let Fh = 2000; Fh <= 6000; Fh += 200) {       // a 240 Hz display's frames (200 frames apart)
    FH.v = Fh;
    const V = X.kit.snap(), gr = X.grNow();
    seen.push({ Fh, ph: V.lfoPh[0], st: V.envStage[0], pk: V.mix[0], gr: gr ? gr[0] : NaN });
  }
  for (const o of seen) {
    if (o.Fh >= step) assert.deepEqual([o.st, o.gr], [2, 6], 'shown at ' + o.Fh);
    else { assert.equal(o.st, 1, 'not before: ' + o.Fh); assert.ok(o.ph >= 0.6 && o.pk === -40, 'the old phase line and peak until F: ' + o.Fh); }
  }
  assert.equal(seen.find(o => o.Fh === step).pk, -3, 'the peak drained at the frame that reaches it');
  assert.ok(seen.filter(o => o.Fh > step).every(o => o.ph < 0.2), 'the new phase after F');
  X.destroy();
});

test('IMPL-FR-B §4.4: a slot host given o.heardFrame — H.live({…, F}) pushes into its ring and paints nothing; the view at the heard frame (an LFO\'s phase / output / Y, an ENV\'s stage and stage time); without F today\'s path', async () => {
  const L = slot('lfo', {}, { heardFrame: () => FH.v, sampleRate: () => 48000 });
  await flush(L.doc);
  const r0 = L.doc.defaultView.raf.length;
  L.X.live({ v: 0.1, ph: 0.2, y: 0.3, out: 0.4, F: 1000 });
  L.X.live({ v: 0.3, ph: 0.4, y: 0.5, out: 0.6, F: 1400 });
  assert.equal(L.doc.defaultView.raf.length, r0, 'no paint queued');
  FH.v = 1200;
  const V = L.X.kit.snap();
  near(V.lfoPh[0], 0.3, 1e-6); near(V.lfoOut[0], 0.5, 1e-6); near(V.lfoY[0], 0.4, 1e-6);
  L.X.live({ v: 0.5, ph: 0.7 });                     // (no F: the slow path — the raw message)
  assert.equal(L.X.kit.msg().lfoPh[0], Math.fround(0.7));
  near(L.X.kit.snap().lfoPh[0], 0.3, 1e-6);          // (the ring still live: the view at the heard frame)
  L.X.destroy();
  const E = slot('env', {}, { heardFrame: () => FH.v, sampleRate: () => 48000 });
  await flush(E.doc);
  E.X.live({ v: 0.5, stage: 1, t: 0.1, F: 1000 });
  E.X.live({ v: 0.7, stage: 1, t: 0.1 + 400 / 48000, F: 1400 });
  E.X.live({ v: 0.8, stage: 2, t: 0, F: 1800 });
  FH.v = 1200;
  near(E.X.kit.snap().envT[1], 0.1 + 200 / 48000, 1e-6);
  assert.equal(E.X.kit.snap().envStage[1], 1);
  FH.v = 1600;
  assert.deepEqual([E.X.kit.snap().envStage[1], E.X.kit.snap().envT[1] >= 0.1], [1, true], 'a stage change holds until its anchor');
  FH.v = 1800;
  assert.equal(E.X.kit.snap().envStage[1], 2);
  E.X.destroy();
});

test('(review 1, R1-B) a part\'s posts resuming after a gap > EXTRA_S (it left the fast ids while another display kept the lane on: no hz 0, no fastReset) start the host\'s rings afresh — before the resumed anchor is heard the view shows the slow values, never the stale anchor blended into the new one; the slot host\'s ring likewise', async () => {
  const { doc, X } = fparts();
  await flush(doc);
  const s1 = slowSnap(), vi = core.vi('f.cutoff'), ix = Int16Array.of(vi);
  s1.lfoOut[0] = 0.5; s1.eff[vi] = 0.5;
  X.setSnapshot({ s: s1 });
  FH.v = 900;
  X.setFast(fmsg(1000, { lfoOut: [0.1], notes: 1 }, [0.1]), ix); X.setFast(fmsg(1400, { lfoOut: [0.1], notes: 1 }, [0.1]), ix);
  const F3 = 1400 + 48000; // (a 1 s gap)
  X.setFast(fmsg(F3, { lfoOut: [0.9], notes: 1 }, [0.9]), ix); X.setFast(fmsg(F3 + 400, { lfoOut: [0.9], notes: 1 }, [0.9]), ix);
  const at = Fh => { FH.v = Fh; const V = X.kit.snap(); return [+V.lfoOut[0].toFixed(4), +V.eff[vi].toFixed(4)]; };
  assert.deepEqual([at(F3 - 2000), at(F3 - 100)], [[0.5, 0.5], [0.5, 0.5]], 'before the resumed anchor is heard: the slow values (no blend of 0.1 into 0.9)');
  assert.deepEqual(at(F3 + 200), [0.9, 0.9], 'heard: the new anchors');
  X.destroy();
  const L = slot('lfo', {}, { heardFrame: () => FH.v, sampleRate: () => 48000 });
  await flush(L.doc);
  L.X.live({ v: 0.5, ph: 0.5, y: 0.5, out: 0.5 });   // (the slow value)
  for (const F of [1000, 1400]) L.X.live({ v: 0.1, ph: 0.1, y: 0.1, out: 0.1, F });
  for (const F of [F3, F3 + 400]) L.X.live({ v: 0.9, ph: 0.2, y: 0.9, out: 0.9, F });
  FH.v = F3 - 2000;
  assert.deepEqual([+L.X.kit.snap().lfoOut[0].toFixed(4), +L.X.kit.snap().lfoY[0].toFixed(4)], [0.5, 0.5], 'the slot host: the slow values before the resumed anchor is heard');
  FH.v = F3 + 200;
  assert.equal(+L.X.kit.snap().lfoOut[0].toFixed(4), 0.9);
  L.X.destroy();
});

test('IMPL-FR-B §4.4: cv-mods-ui slotBody forwards o.heardFrame and o.sampleRate to its slot host; update(v) with F takes the ring path', async () => {
  const U = await import('../cv-mods-ui.js?v=9');
  await U.ready();
  const doc = D.fresh(), hf = () => FH.v, sr = () => 44100;
  const B = U.slotBody('lfo', { doc, get: () => song.normModDev({ kind: 'lfo' }), heardFrame: hf, sampleRate: sr });
  doc.body.appendChild(B.el);
  await flush(doc);
  const H = B.host();
  assert.ok(H && H.host.heardFrame === hf && H.host.sampleRate === sr);
  B.update({ v: 0.1, ph: 0.2, F: 1000 }); B.update({ v: 0.2, ph: 0.4, F: 1882 });
  FH.v = 1441;
  near(H.kit.snap().lfoPh[0], 0.3, 1e-6);
  B.destroy();
});
