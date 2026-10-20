import './v8-guard.mjs';
// classic-panel.js (SPEC-canvas §10 stage 1c): the classic panel as an instance — two instances on two tracks never share
// state (values, updaters, the 303's step lights), destroy() empties the root and a remount shows the track's values, both
// layouts (Hardware: cv-panel; Resizable: today's sections) carry data-ctl = data-dest = the models.js id under a
// [data-dev] root; (2b lane C, IMPL-2b §6.2) haloRanges, setMods / setLive halos (knob rings, slider bars, badges), the
// press-and-hold / right-click mod menu through host.modMenu, data-nomod on the hardware tokens. tests/wk-dom.mjs, a fake
// host; never fake-DOM nodes in assert.*.
// Run alone: node --max-old-space-size=2048 --test tests/classic-panel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { ClassicPanel, SEQ_DEF, fmt } from '../classic-panel.js?v=9';
import * as cvPanel from '../cv-panel.js?v=9';
import { MODELS, DX_ALGS } from '../models.js?v=9';
import { fresh, all, key, fire } from './wk-dom.mjs';
import { readFileSync } from 'node:fs';

const modelOf = id => MODELS.find(m => m.id === id);
const defaults = m => Object.fromEntries(m.controls.map(c => [c.id, c.def]));
const track = (id, model) => ({ id, name: 'T ' + id, prim: 'i1', model, vals: defaults(modelOf(model)), preset: 'Init' });
function host(doc, log) {
  const seqHw = new Map(), running = new Set();
  return {
    doc,
    changed: (t, id) => { log.push(t.id + ':' + id); if (t.preset) t.preset = null; },
    presetTouched: t => log.push(t.id + ':preset'),
    kit: { track() {}, pressOrTap() {}, noMenu() {}, hoverable() {}, wheelIn: () => null, wheelStep: () => 0, tip() {}, untip() {} },
    presets: { list: () => [], cur: () => null, load() {}, step() {}, save() {}, del() {}, init() {}, touch() {} },
    chip: () => log.push('chip'),
    presetNo: () => null,
    seq: { of: t => (t.seq || (t.seq = JSON.parse(JSON.stringify(SEQ_DEF)))), send: t => log.push(t.id + ':seq'), running: t => running.has(t.id),
      toggle: (t, on) => { if (on) running.add(t.id); else running.delete(t.id); }, toRoll() {}, hw: t => seqHw.get(t.id) || (seqHw.set(t.id, { cur: 0, mode: 'pitch' }), seqHw.get(t.id)) },
    dx: () => ({ state: { op: 1, param: 7, eg: 1, mode: 'edit' }, algs: DX_ALGS, layout: () => ({ xs: [], lvl: [] }), presets: 32, load() {}, presetName: () => null }),
  };
}
const ctl = (root, id) => all(root).find(n => n.getAttribute && n.getAttribute('data-ctl') === id) || null;
const widget = (root, id) => { const w = ctl(root, id); return w ? w.childNodes.find(n => n.nodeType === 1 && /\b(knob|slider|num|sel|tog)\b/.test(n.className)) || w.childNodes[0] : null; };
const mount = (doc, t, layout, log) => { const root = doc.createElement('div'); doc.body.append(root); return new ClassicPanel(root, { track: t, model: modelOf(t.model), layout, host: host(doc, log) }); };

for (const ui of ['flow', 'hw']) {
  test(`${ui === 'hw' ? 'Hardware' : 'Resizable'} layout: two instances on two tracks share nothing; destroy empties the root; a remount shows the values`, () => {
    const doc = fresh(), log = [], m = modelOf('minimoog'), L = ui === 'hw' ? cvPanel.usable('minimoog', m) : null;
    if (ui === 'hw') assert.ok(L, 'the Minimoog has its hardware layout');
    const a = track('trk_1', 'minimoog'), b = track('trk_2', 'minimoog');
    const A = mount(doc, a, L, log), B = mount(doc, b, L, log);
    assert.notEqual(A.ui, B.ui);
    const id = 'fc', w = widget(A.root, id), v0 = a.vals[id];
    assert.ok(w, 'the cutoff knob');
    key(w, 'ArrowUp');
    assert.ok(a.vals[id] > v0, 'A moved');
    assert.equal(b.vals[id], v0, 'B untouched');
    assert.deepEqual(log, ['trk_1:fc'], 'the page hears of A\'s track only');
    assert.equal(widget(A.root, id).getAttribute('aria-valuenow'), String(a.vals[id]));
    assert.equal(widget(B.root, id).getAttribute('aria-valuenow'), String(v0));
    assert.equal(a.preset, null, 'A\'s preset became Custom'); assert.equal(b.preset, 'Init');
    // data-ctl = data-dest on every control, the root a [data-dev] (canvas modulation drops)
    for (const c of m.controls) {
      const c1 = ctl(A.root, c.id);
      assert.ok(c1, c.id);
      assert.equal(c1.getAttribute('data-dest'), c.id);
    }
    assert.equal(A.root.getAttribute('data-dev'), 'i1');
    // destroy → empty; a new instance from the track shows its values
    const root = A.root;
    A.destroy();
    assert.deepEqual([root.childNodes.length, A.ui.size, root.getAttribute('data-dev')], [0, 0, null]);
    A.set(id, 1); // (a dead instance writes nothing)
    assert.notEqual(a.vals[id], 1);
    const A2 = new ClassicPanel(root, { track: a, model: m, layout: L, host: host(doc, log) });
    assert.equal(widget(A2.root, id).getAttribute('aria-valuenow'), String(a.vals[id]));
    assert.equal(widget(A2.root, id).getAttribute('aria-valuetext'), fmt(m.controls.find(c => c.id === id), a.vals[id]));
    B.destroy(); A2.destroy();
  });
}

test('TB-303 (both layouts): each instance has its own sequencer parts and step lights', () => {
  const doc = fresh(), log = [], m = modelOf('tb303');
  for (const L of [null, cvPanel.usable('tb303', m)]) {
    const a = track('trk_1', 'tb303'), b = track('trk_2', 'tb303');
    const A = mount(doc, a, L, log), B = mount(doc, b, L, log);
    assert.equal(A.stepEls.length, 16); assert.equal(B.stepEls.length, 16);
    A.seqStep(3);
    assert.deepEqual([A.stepEls[3].classList.contains('now'), B.stepEls[3].classList.contains('now')], [true, false]);
    A.seq.clear.onclick();
    assert.ok(a.seq.pat.every(s => s.n === 0), 'A cleared'); assert.ok(b.seq.pat.some(s => s.n !== 0), 'B kept its pattern');
    assert.ok(log.includes('trk_1:seq') && !log.includes('trk_2:seq'));
    A.destroy(); B.destroy();
    log.length = 0;
  }
});

test('every classic model renders in both layouts with one data-dest per control', () => {
  const doc = fresh(), log = [];
  for (const m of MODELS.filter(x => !x.custom)) {
    for (const L of [null, cvPanel.usable(m.id, m)]) {
      const P = mount(doc, track('trk_1', m.id), L, log);
      const dests = all(P.root).filter(n => n.getAttribute && n.getAttribute('data-dest')).map(n => n.getAttribute('data-dest'));
      if (m.id !== 'dx7' || !L) for (const c of m.controls) assert.ok(dests.includes(c.id), `${m.id} ${L ? 'hw' : 'flow'} ${c.id}`);
      assert.equal(new Set(dests).size, dests.length, `${m.id}: one per control`);
      P.destroy();
    }
  }
});

test('1i (IMPL-1i §6.2): api().perf is the host\'s perf.api(track) on every model (not gated like seq / dx); a host without perf → api().perf null and the Hardware panel builds the same nodes — its bed and controllers drawn, aria-disabled, silent', () => {
  const doc = fresh(), log = [], sig = root => all(root).map(n => [n.localName, n.getAttribute('class'), n.getAttribute('data-ctl'), n.getAttribute('data-note')].join('|'));
  for (const id of ['cs80', 'prophet5', 'jupiter8', 'tb303']) {
    const m = modelOf(id), L = cvPanel.usable(id, m), seen = [], calls = [];
    const P = { on: n => calls.push('on' + n), off: n => calls.push('off' + n), bend: v => calls.push('bend' + v), mod: v => calls.push('mod' + v), at() {},
      value: () => 0, view: () => () => {}, lit: () => () => {}, held: () => [], bed: () => () => {} };
    const mk = perf => {
      const root = doc.createElement('div'), h = host(doc, log);
      doc.body.append(root);
      if (perf) h.perf = { api: tv => { seen.push(tv.id); return P; } };
      return new ClassicPanel(root, { track: track('trk_' + id, id), model: m, layout: L, host: h });
    };
    const A = mk(true), B = mk(false);
    assert.equal(A.api().perf === P, true, id + ': forwarded');
    assert.equal(B.api().perf, null, id + ': none');
    assert.equal(seen[0], 'trk_' + id, id + ': for the panel\'s own track (view)');
    assert.deepEqual(sig(B.root), sig(A.root), id + ': the same nodes');
    const perfs = r => all(r).filter(n => /^perf:/.test(n.getAttribute('data-ctl') || '')).map(n => n.getAttribute('data-ctl') + ':' + n.childNodes[0].getAttribute('aria-disabled'));
    assert.deepEqual([perfs(A.root).length > 0, perfs(B.root).length], [id !== 'tb303', perfs(A.root).length], id + ': ' + perfs(A.root).join());
    assert.equal(perfs(A.root).every(s => s.endsWith(':null')) && perfs(B.root).every(s => s.endsWith(':true')), true, id + ': live / aria-disabled');
    const bedB = all(B.root).find(n => n.getAttribute('data-gesture') === 'music' || (n.getAttribute('class') || '').split(' ').includes('hw-keys'));
    if (bedB) { ptr(bedB, 'pointerdown', 1, 1, { pointerId: 3 }); ptr(bedB, 'pointerup', 1, 1, { pointerId: 3 }); }
    assert.deepEqual(calls, [], id + ': nothing posted without the host\'s perf');
    A.destroy(); B.destroy();
  }
});

/* ---------------------------------------------------------------- stage 2b (IMPL-2b §6.2): halos and the mod menu */
import { haloRanges, dialArc, dialPt } from '../classic-panel.js?v=9';
import { MOD_COLOR } from '../cv-cables.js?v=9';
import { Ev, ptr } from './wk-dom.mjs';

const byCls = (root, c) => all(root).filter(n => n.classList && n.classList.contains(c));
const one = (root, c) => byCls(root, c)[0] || null;
const menus = doc => all(doc.body).filter(n => n.getAttribute && /(^|\s)wk-ctx(\s|$)/.test(n.getAttribute('class') || ''));
const labels = doc => { const m = menus(doc).at(-1); return m ? all(m).filter(n => n.getAttribute && n.getAttribute('class') === 'wk-cl').map(n => n.textContent) : null; };
const pick = (doc, label) => { const it = all(doc.body).filter(n => n.getAttribute && n.getAttribute('class') === 'wk-cl' && n.textContent === label).at(-1).parentNode; ptr(it, 'pointerdown', 0, 0, { pointerId: 7 }); it.dispatchEvent(new Ev('click', { bubbles: true })); };

test('haloRanges (2b, SPEC §7.11): a row\'s reach in the control\'s normalised range — unipolar [base, base + a], bipolar [base ± |a|/2], a bipolar source (bend, chaos) [base ± |a|], a = amt·out, clamped; the kind by the source prefix (or given); zero rows nothing, bypassed ones flagged; selectors and toggles by their option index', () => {
  const c = { id: 'fc', t: 'k', min: 0, max: 10 };
  assert.deepEqual(haloRanges(c, 5, [{ id: 'r1', src: 'l1.out', amt: 0.4 }]), [{ from: 0.5, to: 0.9, kind: 'lfo', id: 'r1', byp: false, neg: false }]);
  assert.deepEqual(haloRanges(c, 5, [{ id: 'r1', src: 'e1.out', amt: -0.4 }]), [{ from: 0.1, to: 0.5, kind: 'env', id: 'r1', byp: false, neg: true }]);
  assert.deepEqual(haloRanges(c, 5, [{ id: 'r1', src: 'm1.k2', amt: 0.4, bi: 1 }]), [{ from: 0.3, to: 0.7, kind: 'macro', id: 'r1', byp: false, neg: false }]);
  assert.deepEqual(haloRanges(c, 5, [{ id: 'r1', src: 'bd.out', amt: 0.4 }, { id: 'r2', src: 'h1.out', amt: 0.2, out: 0.5 }]),
    [{ from: 0.1, to: 0.9, kind: 'bend', id: 'r1', byp: false, neg: false }, { from: 0.4, to: 0.6, kind: 'chaos', id: 'r2', byp: false, neg: false }], 'bipolar sources; out scales');
  assert.deepEqual(haloRanges(c, 9, [{ id: 'r1', src: 'wheel', amt: 0.5, byp: 1 }, { id: 'r2', src: 'c1.out', amt: 0 }, { id: 'r3', src: 'zz', amt: 0.1, kind: 'cc' }, { id: 'r4', src: 'qq.out', amt: 0.1 }, null]),
    [{ from: 0.9, to: 1, kind: 'wheel', id: 'r1', byp: true, neg: false }, { from: 0.9, to: 1, kind: 'cc', id: 'r3', byp: false, neg: false }, { from: 0.9, to: 1, kind: 'other', id: 'r4', byp: false, neg: false }], 'clamped at 1; zero rows skipped; a given kind wins; unknown → other');
  assert.deepEqual(haloRanges({ t: 's', opts: ['a', 'b', 'c', 'd'] }, 3, [{ src: 'l1.out', amt: -0.5 }]).map(a => [a.from, a.to]), [[0.5, 1]], 'a selector: its option index over the last');
  assert.deepEqual(haloRanges({ t: 'b' }, 0, [{ src: 'l1.out', amt: 0.5 }]).map(a => [a.from, a.to]), [[0, 0.5]], 'a toggle: 0 / 1');
  assert.deepEqual([haloRanges(null, 1, []), haloRanges(c, 1, null)], [[], []]);
  assert.deepEqual([dialPt(0, 27, 270).map(v => +v.toFixed(2)), dialPt(0.5, 27, 270).map(v => +v.toFixed(2)), dialArc(0.5, 0.5, 27, 270), dialArc(0.25, 0.75, 27, 270).slice(0, 1), dialArc(0, 1, 27, 270).includes('0 1 1 ')],
    [[12.91, 51.09], [32, 5], '', 'M', true], 'the dial: −135° at 0, the top at ½, the large-arc flag past 180°');
});

test('setMods (2b): a knob gets an arc ring (svg.cp-halo in the knob: path.cp-arc.k-<kind> per row in the source kind\'s colour, bypassed dimmed) and the live dot from eff (hidden within 0.002 of the base); the ring follows the knob\'s value; a slider a range bar and a live mark; a toggle / selector a badge; rows gone → nodes gone; setLive moves the dots alone', () => {
  const doc = fresh(), log = [], m = modelOf('minimoog'), t = track('trk_1', 'minimoog'), P = mount(doc, t, null, log);
  const fc = m.controls.find(c => c.id === 'fc'), knob = widget(P.root, 'fc'), wrap = ctl(P.root, 'fc');
  P.setMods({ fc: [{ id: 'r1', src: 'l1.out', amt: 0.5 }, { id: 'r2', src: 'bd.out', amt: 0.2, byp: 1 }] }, { fc: t.vals.fc });
  const svg = one(knob, 'cp-halo'), arcs = byCls(svg, 'cp-arc'), dot = one(svg, 'cp-live');
  assert.deepEqual([svg.getAttribute('viewBox'), arcs.length, arcs.map(a => a.getAttribute('class')), arcs.map(a => a.getAttribute('stroke')), arcs.every(a => a.getAttribute('d').startsWith('M')), dot.getAttribute('display'), wrap.classList.contains('cp-modded')],
    ['0 0 64 64', 2, ['cp-arc k-lfo', 'cp-arc k-bend cp-byp'], [MOD_COLOR.lfo, MOD_COLOR.bend], true, 'none', true], 'eff at the base: no dot');
  const d0 = arcs[0].getAttribute('d');
  P.setLive({ fc: fc.max });
  assert.deepEqual([dot.hasAttribute('display'), dot.getAttribute('cx'), dot.getAttribute('cy')], [false, dialPt(1, 27, 270)[0].toFixed(2), dialPt(1, 27, 270)[1].toFixed(2)], 'the live dot at the top of the sweep');
  P.setLive(null);
  assert.equal(dot.getAttribute('display'), 'none');
  P.set('fc', fc.min);
  assert.notEqual(arcs[0].getAttribute('d'), d0, 'the ring follows the base');
  assert.deepEqual([byCls(svg, 'cp-arc').length, log.at(-1)], [2, 'trk_1:fc']);
  // fewer rows: the spare path hidden; none: the svg gone, the wrap plain
  P.setMods({ fc: [{ id: 'r1', src: 'l1.out', amt: 0.5 }] }, null);
  assert.deepEqual(byCls(svg, 'cp-arc').map(a => a.getAttribute('display')), [null, 'none']);
  P.setMods({}, null);
  assert.deepEqual([byCls(knob, 'cp-halo').length, wrap.classList.contains('cp-modded')], [0, false]);
  // a toggle and a selector: a badge in the wrap (∿, the count past one), the first source's colour, a title naming them
  const tog = m.controls.find(c => c.t === 'b'), sel = m.controls.find(c => c.t === 's');
  P.setMods({ [tog.id]: [{ id: 'r3', src: 'm1.k1', amt: 1, label: 'Macro 1' }], [sel.id]: [{ id: 'r4', src: 'c1.out', amt: 1 }, { id: 'r5', src: 'h1.out', amt: 0.5 }] }, null);
  const bt = one(ctl(P.root, tog.id), 'cp-mbadge'), bs = one(ctl(P.root, sel.id), 'cp-mbadge');
  assert.deepEqual([bt.textContent, bt.style.background, bt.title, bs.textContent, bs.style.background, bs.title], ['∿', MOD_COLOR.macro, 'Macro 1', '∿2', MOD_COLOR.cc, 'c1.out, h1.out']);
  P.setMods({}, null);
  assert.equal(byCls(P.root, 'cp-mbadge').length, 0);
  P.setMods({ nope: [{ id: 'r9', src: 'l1.out', amt: 1 }] }, null);
  assert.equal(byCls(P.root, 'cp-halo').length + byCls(P.root, 'cp-mbadge').length, 0, 'an unknown control: nothing');
  P.destroy();
  // a slider-themed model: the range bar along the groove (the cap's travel), the live mark
  const sm = MODELS.find(x => !x.custom && x.theme.ctl === 'slider');
  assert.ok(sm, 'a slider model');
  const ts = track('trk_2', sm.id), PS = mount(doc, ts, null, log), kc = sm.controls.find(c => c.t === 'k');
  PS.setMods({ [kc.id]: [{ id: 'r1', src: 'l1.out', amt: 0.5, bi: 1 }] }, { [kc.id]: kc.max });
  const sl = widget(PS.root, kc.id), bar = one(sl, 'cp-range'), mk = one(sl, 'cp-livemk');
  const base = (ts.vals[kc.id] - kc.min) / (kc.max - kc.min), lo = Math.max(0, base - 0.25).toFixed(4);
  assert.deepEqual([sl.classList.contains('slider'), bar.className, bar.style.bottom, bar.style.height, bar.style.background, mk.hidden, mk.style.bottom],
    [true, 'cp-range k-lfo', `calc(${lo} * (100% - var(--cap-h, 14px)) + var(--cap-h, 14px) / 2)`, `calc(${(Math.min(1, base + 0.25) - +lo).toFixed(4)} * (100% - var(--cap-h, 14px)))`, MOD_COLOR.lfo, false,
      'calc(1.0000 * (100% - var(--cap-h, 14px)) + var(--cap-h, 14px) / 2 - 1px)']);
  PS.setMods({}, null);
  assert.equal(byCls(sl, 'cp-range').length + byCls(sl, 'cp-livemk').length, 0);
  PS.destroy();
});

test('the mod menu (2b): a right-click, a 500 ms touch long-press (≤ 8 px: wk.menuSource) or the ContextMenu key on a knob opens a wk menu — the host\'s rows (Bypass / Disconnect each), Connect to…, Reset Control, Enter Value…, the host\'s extra items; the actions reach host.modMenu; without it Connect to… is disabled; the held finger drags no more once the menu opened; hardware tokens carry data-nomod', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = fresh(), log = [], tr = track('trk_1', 'minimoog'), H = host(doc, log);
  let rows = [{ id: 'r1', src: 'l1.out', label: 'LFO 1', byp: 0 }, { id: 'r2', src: 'm1.k3', label: 'Cutoff', byp: 1 }];
  H.modMenu = { rows: (tk, id) => (id === 'fc' ? rows : []), bypass: (tk, id, on) => log.push('bypass ' + id + ' ' + on), disconnect: (tk, id) => log.push('disconnect ' + id),
    connect: (tk, id, el) => log.push('connect ' + id + ' ' + (el && el.className)), extra: (tk, id) => [{ label: 'Host item ' + id, action: () => log.push('extra') }] };
  const root = doc.createElement('div'); doc.body.append(root);
  const P = new ClassicPanel(root, { track: tr, model: modelOf('minimoog'), layout: null, host: H });
  const knob = widget(P.root, 'fc');
  assert.equal(menus(doc).length, 0);
  fire(knob, 'contextmenu', { clientX: 40, clientY: 40, button: 2 });
  assert.deepEqual(labels(doc), ['Bypass LFO 1', 'Bypass Cutoff', 'Disconnect LFO 1', 'Disconnect Cutoff', 'Connect to…', 'Reset Control', 'Enter Value…', 'Host item fc']);
  const items = all(menus(doc).at(-1)).filter(n => n.getAttribute && n.getAttribute('role') === 'menuitemcheckbox');
  assert.deepEqual(items.map(n => n.getAttribute('aria-checked')), ['false', 'true'], 'Bypass checked per row');
  pick(doc, 'Disconnect Cutoff');
  assert.deepEqual([log.at(-1), menus(doc).length], ['disconnect r2', 0]);
  fire(knob, 'contextmenu', { clientX: 40, clientY: 40, button: 2 }); pick(doc, 'Bypass LFO 1');
  assert.equal(log.at(-1), 'bypass r1 true');
  fire(knob, 'contextmenu', { clientX: 40, clientY: 40, button: 2 }); pick(doc, 'Connect to…');
  assert.equal(log.at(-1), 'connect fc knob');
  fire(knob, 'contextmenu', { clientX: 40, clientY: 40, button: 2 }); pick(doc, 'Host item fc');
  assert.equal(log.at(-1), 'extra');
  tr.vals.fc = 1;
  fire(knob, 'contextmenu', { clientX: 40, clientY: 40, button: 2 }); pick(doc, 'Reset Control');
  assert.deepEqual([tr.vals.fc, log.at(-1)], [modelOf('minimoog').controls.find(c => c.id === 'fc').def, 'trk_1:fc']);
  // Enter Value…: a typed number (the prompt stubbed), clamped and stepped
  globalThis.prompt = () => ' 7,5 ';
  try { fire(knob, 'contextmenu', { clientX: 40, clientY: 40, button: 2 }); pick(doc, 'Enter Value…'); } finally { delete globalThis.prompt; }
  assert.equal(tr.vals.fc, 7.5);
  // a control without rows: no row items; a toggle has the menu too; the ContextMenu key
  const togId = modelOf('minimoog').controls.find(c => c.t === 'b').id, tog = widget(P.root, togId);
  fire(tog, 'contextmenu', { clientX: 10, clientY: 10, button: 2 });
  assert.deepEqual(labels(doc), ['Connect to…', 'Reset Control', 'Host item ' + togId], 'no rows, no Enter Value on a toggle');
  key(knob, 'ContextMenu');
  assert.equal(labels(doc)[0], 'Bypass LFO 1', 'the keyboard opens it at the knob');
  menus(doc).at(-1).dispatchEvent(new Ev('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(menus(doc).length, 0);
  // touch: a long-press (500 ms, the finger still) opens it; a move past 8 px first does not; the held finger drags no more
  const v0 = tr.vals.fc;
  ptr(knob, 'pointerdown', 50, 50, { pointerId: 3, pointerType: 'touch' });
  t.mock.timers.tick(499);
  assert.equal(menus(doc).length, 0);
  t.mock.timers.tick(1);
  assert.equal(labels(doc)[0], 'Bypass LFO 1', 'opened at 500 ms');
  ptr(knob, 'pointermove', 50, 10, { pointerId: 3, pointerType: 'touch' });
  assert.equal(tr.vals.fc, v0, 'no drag under the menu');
  ptr(knob, 'pointerup', 50, 10, { pointerId: 3, pointerType: 'touch' });
  menus(doc).at(-1).dispatchEvent(new Ev('keydown', { key: 'Escape', bubbles: true }));
  ptr(knob, 'pointerdown', 50, 50, { pointerId: 4, pointerType: 'touch' }); ptr(knob, 'pointermove', 50, 30, { pointerId: 4, pointerType: 'touch' });
  t.mock.timers.tick(600);
  assert.equal(menus(doc).length, 0, 'moved: no menu');
  ptr(knob, 'pointerup', 50, 30, { pointerId: 4, pointerType: 'touch' });
  // the mouse: no long-press
  ptr(knob, 'pointerdown', 50, 50, { pointerId: 5 }); t.mock.timers.tick(600);
  assert.equal(menus(doc).length, 0);
  ptr(knob, 'pointerup', 50, 50, { pointerId: 5 });
  // without host.modMenu: Connect to… disabled, Reset and Enter Value only
  delete H.modMenu;
  fire(knob, 'contextmenu', { clientX: 40, clientY: 40, button: 2 });
  const M2 = menus(doc).at(-1);
  assert.deepEqual([labels(doc), all(M2).filter(n => n.getAttribute && n.getAttribute('aria-disabled') === 'true').length], [['Connect to…', 'Reset Control', 'Enter Value…'], 1]);
  assert.deepEqual(P.menuItems('fc').map(i => i.kind || (i.sep ? 'sep' : '?')), ['connect', 'sep', 'reset', 'enter']);
  M2.dispatchEvent(new Ev('keydown', { key: 'Escape', bubbles: true }));
  P.destroy();
  // the hardware panel: the same menu on a hardware knob (dragB), seq: / dx: tokens data-nomod and no data-dest
  const m3 = modelOf('tb303'), L = cvPanel.usable('tb303', m3), t3 = track('trk_3', 'tb303'), P3 = mount(doc, t3, L, log);
  const toks = all(P3.root).filter(n => n.getAttribute && /^(seq|dx):/.test(n.getAttribute('data-ctl') || ''));
  assert.ok(toks.length > 0, 'the 303\'s tokens');
  assert.ok(toks.every(n => n.getAttribute('data-nomod') === '1' && n.getAttribute('data-dest') === null));
  fire(widget(P3.root, 'cf'), 'contextmenu', { clientX: 40, clientY: 40, button: 2 });
  assert.deepEqual(labels(doc), ['Connect to…', 'Reset Control', 'Enter Value…']);
  menus(doc).at(-1).dispatchEvent(new Ev('keydown', { key: 'Escape', bubbles: true }));
  P3.destroy();
});

test('(2b fixer C) U2: host.changed(track, id, phase) — a drag\'s moves say \'move\' and its lift \'end\' (once, only after a move); a key, the wheel, a double-click, Reset and Enter Value say nothing; U12: Enter Value… prefills the knob-unit number, not the display text; P7: setLive touches the live dot alone (no arc attribute written); U13: slider range bars are thin bars beside the groove (--cp-i per bar), the cap above them', () => {
  const doc = fresh(), log = [], tr = track('trk_1', 'juno60'), H = host(doc, log), phases = [];
  H.changed = (t, id, ph) => { phases.push(id + ':' + (ph === undefined ? '-' : ph)); };
  H.kit.track = (el, e, move, end) => { // (a kit that follows the pointer on the element)
    const mv = ev => move(ev), up = ev => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); end(ev); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  };
  const root = doc.createElement('div'); doc.body.append(root);
  const P = new ClassicPanel(root, { track: tr, model: modelOf('juno60'), layout: null, host: H });
  const c = modelOf('juno60').controls.find(x => x.id === 'cf'), w = widget(P.root, 'cf');
  assert.ok(c.fmt && /Hz/.test(fmt(c, tr.vals.cf)), 'cf shows a formatted value: ' + fmt(c, tr.vals.cf));
  // a drag: three moves, a lift
  ptr(w, 'pointerdown', 10, 100, { pointerId: 1 });
  for (let i = 1; i <= 3; i++) ptr(w, 'pointermove', 10, 100 - 12 * i, { pointerId: 1 });
  ptr(w, 'pointerup', 10, 64, { pointerId: 1 });
  assert.deepEqual(phases, ['cf:move', 'cf:move', 'cf:move', 'cf:end'], 'moves, then one end');
  phases.length = 0;
  ptr(w, 'pointerdown', 10, 100, { pointerId: 2 }); ptr(w, 'pointerup', 10, 100, { pointerId: 2 }); // (no move: no end)
  key(w, 'ArrowUp');
  fire(w, 'dblclick');
  assert.deepEqual(phases, ['cf:-', 'cf:-'], 'a tap says nothing; a key and a double-click have no phase');
  // Enter Value…: the prompt's default is the knob-unit number
  phases.length = 0;
  let seen = null;
  globalThis.prompt = (msg, def) => { seen = [msg, def]; return '7.5'; };
  try { fire(w, 'contextmenu', { clientX: 40, clientY: 40, button: 2 }); pick(doc, 'Enter Value…'); } finally { delete globalThis.prompt; }
  assert.deepEqual([seen, tr.vals.cf, phases], [['Freq (0…10)', '6'], 7.5, ['cf:-']]);
  // P7: setLive writes the dot alone
  const m = modelOf('minimoog'), tm = track('trk_2', 'minimoog'), Pm = mount(doc, tm, null, log), knob = widget(Pm.root, 'fc'), fc = m.controls.find(x => x.id === 'fc');
  Pm.setMods({ fc: [{ id: 'r1', src: 'l1.out', amt: 0.5 }, { id: 'r2', src: 'e1.out', amt: -0.2 }] }, null);
  const svg = one(knob, 'cp-halo'), arcs = byCls(svg, 'cp-arc'), dot = one(svg, 'cp-live');
  let arcW = 0, dotW = 0;
  for (const a of arcs) { const o = a.setAttribute; a.setAttribute = function (...x) { arcW++; return o.apply(this, x); }; }
  { const o = dot.setAttribute; dot.setAttribute = function (...x) { dotW++; return o.apply(this, x); }; }
  Pm.setLive({ fc: fc.max }); Pm.setLive({ fc: (fc.min + fc.max) / 2 }); Pm.setLive(null);
  assert.deepEqual([arcW, dotW > 0, dot.getAttribute('display')], [0, true, 'none'], 'the arcs untouched, the dot moved and hidden');
  Pm.set('fc', fc.min);
  assert.ok(arcW > 0, 'a base change repaints the arcs');
  Pm.destroy();
  // U13: two bars on a slider, each at its own --cp-i; the CSS puts them beside the groove and the cap above
  P.setMods({ cf: [{ id: 'r1', src: 'l1.out', amt: 0.5 }, { id: 'r2', src: 'm1.k1', amt: 0.3 }] }, null);
  const bars = byCls(w, 'cp-range');
  assert.deepEqual([bars.length, bars.map(b => b.style.getPropertyValue('--cp-i'))], [2, ['0', '1']]);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const rule = (css.match(/\n\.cp-range \{[^}]*\}/) || [''])[0];
  assert.ok(/width: 3px/.test(rule) && /left: calc\(50% \+[^;]*--cp-i/.test(rule) && !/right: 4px/.test(rule), 'a 3 px bar beside the groove, stepped per bar: ' + rule);
  assert.ok(/\.slider \.cap \{[^}]*z-index: 1/.test(css) || /\.slider > \.cap \{[^}]*z-index: 1/.test(css), 'the cap above the bars');
  P.destroy();
});
