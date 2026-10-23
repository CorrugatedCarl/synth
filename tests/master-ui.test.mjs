import './v8-guard.mjs';
// master-ui.js (stage M lane U; docs/canvas/IMPL-M.md §3, §5.1, §5.3, §9 O1 / O3): the master OUT and the Master row on
// tests/wk-dom.mjs — the pure helpers (formats, scales, thresholds, the image mapping), the OUT's DOM and accessibility, the
// drawing budget (a repaint only for new data, never while not live, ≤ 30 Hz canvases, ≤ 10 Hz text, no shadowBlur, no
// layout read), the A/B / Mono / reset / target-menu / scope-mode controls and their callbacks, the image mode's point cap,
// −Infinity / NaN as "—", the red thresholds, dpr and the zoom-end repaint, destroy; then the row.
// Never passes fake-DOM nodes to assert.* (strings, numbers and booleans only).
// Run alone: node --max-old-space-size=2048 --test tests/master-ui.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, all, byAttr, ptr, key, El } from './wk-dom.mjs';
import * as wk from '../wk.js?v=9';
import * as U from '../master-ui.js?v=9';

const MINUS = '−', DASH = '—';
const cls = (root, c) => all(root).find(n => n.classList && n.classList.contains(c)) || null;
const clsAll = (root, c) => all(root).filter(n => n.classList && n.classList.contains(c));
// a readout's value by its hidden full name
const val = (root, name) => {
  const n = all(root).find(e => e.classList && e.classList.contains('mo-n') && e.children[0] && e.children[0].textContent === name);
  return n ? cls(n, 'mo-nv').textContent : null;
};
const readout = (root, name) => all(root).find(e => e.classList && e.classList.contains('mo-n') && e.children[0] && e.children[0].textContent === name) || null;

// a recording 2D context: method calls and property writes, in order
function recCtx() {
  const log = [];
  return new Proxy({}, {
    get(t, k) { if (k === '__log') return log; if (typeof k === 'symbol') return undefined; if (k in t) return t[k]; return (...a) => { log.push([k, ...a]); }; },
    set(t, k, v) { t[k] = v; log.push(['=' + k, v]); return true; },
  });
}
// a document whose canvases record, a manual clock, the module mounted in body
function rig(o = {}, kind = 'out') {
  const d = fresh(), orig = d.createElement.bind(d);
  d.createElement = t => { const e = orig(t); if (t === 'canvas') e._ctx = recCtx(); return e; };
  const clock = { t: 0, now() { return this.t; } };
  const ev = [];
  const opts = Object.assign({ doc: d, now: () => clock.t }, o);
  if (kind === 'out') {
    opts.onReset = () => ev.push('reset'); opts.onBypass = v => ev.push('ab:' + v); opts.onMono = v => ev.push('mono:' + v);
    opts.onTarget = v => ev.push('target:' + v); opts.onMode = v => ev.push('mode:' + v);
  } else { opts.onBypass = v => ev.push('ab:' + v); opts.onMono = v => ev.push('mono:' + v); opts.open = () => ev.push('open'); }
  Object.assign(opts, o);
  const m = (kind === 'out' ? U.createMasterOut : U.createMasterRow)(d.body, opts);
  const out = { d, m, clock, ev, root: m.el };
  if (kind === 'out') { out.mt = cls(m.el, 'mo-mt'); out.sc = cls(m.el, 'mo-sc'); out.mlog = () => out.mt._ctx.__log; out.slog = () => out.sc._ctx.__log; }
  return out;
}
const n = (log, name) => log.filter(e => e[0] === name).length;
// a normal summary
const SUM = Object.assign({ m: -14.2, s: -14.8, i: -14.5, lra: 6.2, tp: [-3, -4], tpMax: -2.5, pk: [-6, -7], corr: 0.8, lat: 0 });
const sum = o => Object.assign({}, SUM, o);

/* ================================================================ the pure helpers */
test('imports in node without a DOM; the API and the constants', () => {
  for (const k of ['createMasterOut', 'createMasterRow', 'fmtDb', 'fmtGain', 'fmtCorr', 'lufsFrac', 'tpFrac', 'pkFrac', 'isOver', 'zonesFor', 'corrBar', 'imageXY', 'norm']) assert.equal(typeof U[k], 'function', k);
  assert.deepEqual([...U.MODES], ['wave', 'spectrum', 'image']);
  assert.deepEqual([...U.TARGETS], [-9, -14, -16, -23, null]);
  assert.deepEqual([U.MAX_POINTS, U.METER_MS, U.SCOPE_MS, U.TEXT_MS, U.TP_RED], [2048, 30, 30, 100, -1]);
  assert.ok(U.OUT_W > 0 && U.OUT_H > 0);
});

test('formats: true minus, one decimal, "—" for silence / NaN / junk, no "−0.0"', () => {
  assert.deepEqual([U.fmtDb(-14.23), U.fmtDb(0), U.fmtDb(3.04), U.fmtDb(-0.04), U.fmtDb(-0.06)], [MINUS + '14.2', '0.0', '3.0', '0.0', MINUS + '0.1']);
  assert.deepEqual([U.fmtDb(-Infinity), U.fmtDb(Infinity), U.fmtDb(NaN), U.fmtDb(undefined), U.fmtDb('x'), U.fmtDb(null)], [DASH, DASH, DASH, DASH, DASH, DASH]);
  assert.equal(U.fmtDb(-14, 0), MINUS + '14');
  assert.deepEqual([U.fmtGain(-3.24), U.fmtGain(1.5), U.fmtGain(0), U.fmtGain(-0.04), U.fmtGain(NaN)], [MINUS + '3.2', '+1.5', '0.0', '0.0', DASH]);
  assert.deepEqual([U.fmtCorr(0.824), U.fmtCorr(-1), U.fmtCorr(0), U.fmtCorr(1), U.fmtCorr(-0.004), U.fmtCorr(NaN), U.fmtCorr(-Infinity)], ['+0.82', MINUS + '1.00', '0.00', '+1.00', '0.00', DASH, DASH]);
});

test('loudness under the absolute gate reads "—" (a stop posts tiny finite M / S values, not −Infinity)', () => {
  assert.equal(typeof U.fmtLufs, 'function');
  assert.deepEqual([U.fmtLufs(-173.2), U.fmtLufs(-70), U.fmtLufs(-69.95), U.fmtLufs(-14.04), U.fmtLufs(-Infinity), U.fmtLufs(NaN)],
    [DASH, DASH, MINUS + '70.0', MINUS + '14.0', DASH, DASH]);
});
test('scales: the bars map level to 0…1 and silence to 0; the target tick sits where its LUFS is', () => {
  assert.deepEqual([U.lufsFrac(-40), U.lufsFrac(0), U.lufsFrac(-20), U.lufsFrac(-14), U.lufsFrac(-Infinity), U.lufsFrac(NaN), U.lufsFrac(5), U.lufsFrac(-99)], [0, 1, 0.5, 0.65, 0, 0, 1, 0]);
  assert.deepEqual([U.tpFrac(-48), U.tpFrac(3), U.tpFrac(-Infinity), U.tpFrac(NaN)], [0, 1, 0, 0]);
  assert.ok(U.tpFrac(-1) > U.tpFrac(-1.5) && U.tpFrac(-1) < U.tpFrac(0));
  assert.deepEqual([U.pkFrac(-60), U.pkFrac(0), U.pkFrac(-30), U.pkFrac(-Infinity), U.pkFrac(4)], [0, 1, 0.5, 0, 1]);
});

test('red thresholds: a true peak is over from −1 dBTP up (not −1.001, not silence, not NaN); the bar\'s red zone starts there', () => {
  assert.deepEqual([U.isOver(-1), U.isOver(-0.5), U.isOver(3), U.isOver(-1.001), U.isOver(-20), U.isOver(-Infinity), U.isOver(NaN), U.isOver(undefined)], [true, true, true, false, false, false, false, false]);
  const red = db => U.zonesFor(db).filter(z => z.color === U.RED);
  assert.equal(red(-1.5).length, 0, 'below −1: no red segment');
  assert.equal(red(-1).length, 0, 'at −1 exactly: zero length');
  assert.deepEqual(red(-0.5).map(z => [z.lo, z.hi]), [[-1, -0.5]]);
  assert.deepEqual(red(9).map(z => [z.lo, z.hi]), [[-1, 3]], 'clipped to the scale');
  assert.deepEqual([U.zonesFor(-Infinity).length, U.zonesFor(NaN).length, U.zonesFor(-48).length], [0, 0, 0]);
  const z = U.zonesFor(-10);
  assert.deepEqual(z.map(s => [s.lo, s.hi]), [[-48, -18], [-18, -10]], 'zones run from the left and stop at the level');
});

test('the correlation bar runs from the centre: red below 0, green from 0 up, nothing for NaN', () => {
  assert.deepEqual(U.corrBar(0.5), { from: 0, to: 0.5, bad: false });
  assert.deepEqual(U.corrBar(-0.25), { from: -0.25, to: 0, bad: true });
  assert.equal(U.corrBar(0).bad, false, '0 is not below 0');
  assert.equal(U.corrBar(-1e-9).bad, true);
  assert.deepEqual([U.corrBar(7).to, U.corrBar(-7).from], [1, -1], 'clamped');
  assert.deepEqual([U.corrBar(NaN), U.corrBar(undefined), U.corrBar(Infinity)], [null, null, null]);
});

test('the image mapping: mono is a vertical line, anti-phase a horizontal one, L leans up-left, R up-right', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-12;
  const m = U.imageXY(0.5, 0.5), a = U.imageXY(-0.5, 0.5), a2 = U.imageXY(0.5, -0.5), l = U.imageXY(0.5, 0), r = U.imageXY(0, 0.5);
  assert.ok(near(m[0], 0) && m[1] > 0, 'mono: x 0, up');
  assert.ok(a[0] > 0 && near(a[1], 0) && a2[0] < 0 && near(a2[1], 0), 'anti-phase: level with the centre, to one side or the other');
  assert.ok(l[0] < 0 && l[1] > 0 && near(-l[0], l[1]), 'L: up-left at 45°');
  assert.ok(r[0] > 0 && r[1] > 0 && near(r[0], r[1]), 'R: up-right at 45°');
});

test('norm: numbers only whatever it is given; NaN and junk are silence; arrays and scalars; corr clamped or NaN', () => {
  for (const bad of [null, undefined, 5, 'x', [], {}, { m: 'a', tp: 'b', pk: {}, corr: 'c' }, { m: NaN, s: null, i: undefined, tp: [NaN], pk: [1] }]) {
    const x = U.norm(bad);
    assert.deepEqual([typeof x.m, typeof x.s, typeof x.i, typeof x.lra, typeof x.tpMax, typeof x.corr, x.tp.length, x.pk.length], ['number', 'number', 'number', 'number', 'number', 'number', 2, 2]);
    assert.deepEqual([x.m, x.corr !== x.corr], [-Infinity, true]);
  }
  const x = U.norm({ m: -10, tp: [-1, -2], tpMax: [-3, -0.5], pk: -6, corr: 2 });
  assert.deepEqual([x.m, x.tp, x.tpMax, x.pk, x.corr], [-10, [-1, -2], -0.5, [-6, -6], 1]);
});

/* ================================================================ the OUT: DOM and accessibility */
test('OUT: mounts into the host, fixed size; buttons with aria-pressed and labels; every number is DOM text with a hidden full name', () => {
  const r = rig();
  assert.equal(r.root.parentNode === r.d.body, true);
  assert.deepEqual([r.root.style.width, r.root.style.height, r.root.getAttribute('role')], [U.OUT_W + 'px', U.OUT_H + 'px', 'group']);
  const ab = cls(r.root, 'mo-ab'), mono = cls(r.root, 'mo-mono'), tg = cls(r.root, 'mo-target');
  assert.deepEqual([ab.textContent, ab.getAttribute('aria-pressed'), mono.textContent, mono.getAttribute('aria-pressed'), ab.type, mono.type], ['A/B', 'false', 'Mono', 'false', 'button', 'button']);
  assert.deepEqual([tg.textContent, tg.getAttribute('aria-haspopup'), tg.getAttribute('aria-expanded')], ['Target ' + MINUS + '14 LUFS', 'menu', 'false']);
  for (const nm of ['Momentary loudness', 'Short-term loudness', 'Integrated loudness (tap to reset)', 'Loudness range', 'True peak max hold (tap to reset)', 'Phase correlation']) assert.equal(val(r.root, nm), DASH, nm);
  const modes = clsAll(r.root, 'mo-mode');
  assert.deepEqual(modes.map(b => b.getAttribute('data-mode') + ':' + b.getAttribute('aria-pressed')), ['wave:true', 'spectrum:false', 'image:false']);
  assert.equal(clsAll(r.root, 'mo-mt')[0].getAttribute('aria-hidden'), 'true', 'canvases are decoration');
  assert.equal(r.mt.getAttribute('aria-hidden') + r.sc.getAttribute('aria-hidden'), 'truetrue');
  // the readout names are in the DOM text (a screen reader reads name, value, unit)
  const ro = readout(r.root, 'Short-term loudness');
  assert.deepEqual([ro.children[0].classList.contains('cv-sr'), cls(ro, 'mo-nu').textContent], [true, 'LUFS']);
  assert.equal(cls(readout(r.root, 'Loudness range'), 'mo-nu').textContent, 'LU');
});

test('OUT: update() before live paints nothing and writes no text; the first draw after setLive(true) shows the last summary at once', () => {
  const r = rig();
  r.m.update(sum({}));
  assert.equal(r.m.draw(100), false, 'not live: nothing');
  assert.deepEqual([r.mlog().length, r.slog().length, val(r.root, 'Short-term loudness')], [0, 0, DASH]);
  r.m.setLive(true);
  assert.equal(r.m.draw(200), true);
  assert.deepEqual([val(r.root, 'Momentary loudness'), val(r.root, 'Short-term loudness'), val(r.root, 'Integrated loudness (tap to reset)'), val(r.root, 'Loudness range'), val(r.root, 'True peak max hold (tap to reset)'), val(r.root, 'Phase correlation')],
    [MINUS + '14.2', MINUS + '14.8', MINUS + '14.5', '6.2', MINUS + '2.5', '+0.80']);
  assert.ok(n(r.mlog(), 'clearRect') === 1 && n(r.mlog(), 'fillRect') > 5, 'one meters repaint');
});

test('OUT: a repaint only for new data — draws with no new summary paint nothing; nothing at all while not live (including after setLive(false))', () => {
  const r = rig();
  r.m.setLive(true);
  r.m.update(sum({}));
  r.m.draw(0);
  const a = r.mlog().length, b = r.slog().length;
  for (let t = 40; t <= 400; t += 40) r.m.draw(t);
  assert.deepEqual([r.mlog().length, r.slog().length], [a, b], 'no new data, no new paint (the scope has no source: one idle frame only)');
  r.m.update(sum({ s: -10 }));
  r.m.draw(440);
  assert.equal(n(r.mlog(), 'clearRect'), 2, 'a new summary repaints once');
  r.m.setLive(false);
  const c = r.mlog().length, e = r.slog().length;
  r.m.update(sum({ s: -9 }));
  assert.equal(r.m.draw(500), false);
  assert.deepEqual([r.mlog().length, r.slog().length, val(r.root, 'Short-term loudness')], [c, e, MINUS + '10.0'], 'not live: no paint, no text');
  r.m.setLive(true);
  r.m.draw(600);
  assert.deepEqual([n(r.mlog(), 'clearRect'), val(r.root, 'Short-term loudness')], [3, MINUS + '9.0'], 'live again: the latest is shown at once');
});

test('OUT: the meters canvas repaints at most every 30 ms (30 Hz) and the numbers change at most every 100 ms (10 Hz)', () => {
  const r = rig();
  r.m.setLive(true);
  const seen = [];
  for (let t = 0; t <= 1000; t += 8) {
    r.m.update(sum({ s: -30 + t / 50, m: -30 + t / 50 }));
    r.m.draw(t);
    seen.push(val(r.root, 'Short-term loudness'));
  }
  const paints = n(r.mlog(), 'clearRect'), changes = seen.filter((s, i) => i && s !== seen[i - 1]).length;
  assert.ok(paints >= 20 && paints <= 34, 'meters repaints in a second: ' + paints);
  assert.ok(changes >= 5 && changes <= 11, 'text changes in a second: ' + changes);
  // summaries arriving every 33 ms (the processor's rate) all get painted
  const q = rig();
  q.m.setLive(true);
  for (let t = 0; t < 990; t += 33) { q.m.update(sum({ s: -20 - (t % 7) })); q.m.draw(t); }
  assert.equal(n(q.mlog(), 'clearRect'), 30, 'every 33 ms summary is painted');
});

test('OUT: -Infinity, NaN and junk read as "—" (and the bars as empty); the summary may be anything', () => {
  const r = rig();
  r.m.setLive(true);
  r.m.update({ m: -Infinity, s: NaN, i: undefined, lra: null, tp: [-Infinity, NaN], tpMax: -Infinity, pk: [-Infinity, -Infinity], corr: NaN, lat: 0 });
  r.m.draw(0);
  for (const nm of ['Momentary loudness', 'Short-term loudness', 'Integrated loudness (tap to reset)', 'Loudness range', 'True peak max hold (tap to reset)', 'Phase correlation']) assert.equal(val(r.root, nm), DASH, nm);
  assert.equal(clsAll(r.root, 'mo-over').length + clsAll(r.root, 'mo-bad').length, 0, 'silence is not red');
  for (const junk of [null, undefined, 3, 'x', [], { tp: 'x', pk: [1] }]) { r.m.update(junk); r.m.draw(100 + (r.clock.t += 100)); }
  assert.equal(val(r.root, 'Short-term loudness'), DASH);
});

test('OUT: red from −1 dBTP (the max-hold number and the bar), correlation red below 0 (the number and the bar)', () => {
  const r = rig();
  r.m.setLive(true);
  const hold = cls(r.root, 'mo-hold'), cn = cls(r.root, 'mo-corr');
  r.m.update(sum({ tp: [-3, -4], tpMax: -1.01, corr: 0.5 })); r.m.draw(0);
  assert.deepEqual([hold.classList.contains('mo-over'), cn.classList.contains('mo-bad')], [false, false]);
  assert.equal(r.mlog().filter(e => e[0] === '=fillStyle' && e[1] === U.RED).length, 0, 'no red anywhere on the canvas');
  r.m.update(sum({ tp: [-3, -4], tpMax: -1, corr: 0 })); r.m.draw(200);
  assert.deepEqual([hold.classList.contains('mo-over'), cn.classList.contains('mo-bad')], [true, false], '−1 is over, 0 correlation is not bad');
  r.m.update(sum({ tp: [-3, -4], tpMax: -3, corr: -0.2 })); r.m.draw(400);
  assert.deepEqual([hold.classList.contains('mo-over'), cn.classList.contains('mo-bad')], [false, true]);
  assert.equal(val(r.root, 'Phase correlation'), MINUS + '0.20');
  const redBefore = r.mlog().filter(e => e[0] === '=fillStyle' && e[1] === U.RED).length;
  assert.ok(redBefore >= 1, 'the correlation bar is red');
  // the true-peak bar goes red at −0.5 dBTP, its readout with it
  r.m.update(sum({ tp: [-0.5, -4], tpMax: -0.5, corr: 0.9 })); r.m.draw(600);
  assert.ok(r.mlog().filter(e => e[0] === '=fillStyle' && e[1] === U.RED).length > redBefore, 'the true-peak bar paints a red segment');
  assert.equal(hold.classList.contains('mo-over'), true);
  // a quiet correlation bar with a quiet true peak adds no red
  const k = r.mlog().filter(e => e[0] === '=fillStyle' && e[1] === U.RED).length;
  r.m.update(sum({ tp: [-Infinity, -Infinity], tpMax: -Infinity, corr: 0.9 })); r.m.draw(2000);
  assert.equal(r.mlog().filter(e => e[0] === '=fillStyle' && e[1] === U.RED).length - k, 0, 'the held bar has fallen out of the red zone: no more red');
});

test('OUT: a true-peak bar falls at TP_REL dB/s, and a peak between two paints is not lost', () => {
  const r = rig();
  r.m.setLive(true);
  r.m.update(sum({ tp: [-0.5, -30] })); r.m.update(sum({ tp: [-40, -30] })); // two summaries, one paint: the max of both is shown
  r.m.draw(0);
  const reds = () => r.mlog().filter(e => e[0] === '=fillStyle' && e[1] === U.RED).length;
  assert.ok(reds() >= 1, 'the -0.5 of the first summary is painted');
  const k = reds();
  r.m.update(sum({ tp: [-Infinity, -Infinity] })); r.m.draw(100); // 0.1 s later: it has fallen 2.4 dB: still -2.9, no longer red
  assert.equal(reds(), k, 'fallen below the red zone');
});

/* ================================================================ A/B, Mono, reset, target, scope mode */
test('A/B: a tap lights it and calls onBypass(on); setBypass(on, gain) shows the match gain; off clears it; setBypass never calls back', () => {
  const r = rig();
  const ab = cls(r.root, 'mo-ab');
  ab.click();
  assert.deepEqual([r.ev.join(), ab.getAttribute('aria-pressed'), ab.classList.contains('on'), ab.textContent], ['ab:true', 'true', true, 'A/B']);
  r.m.setBypass(true, -3.24);
  assert.equal(ab.textContent, 'A/B ' + MINUS + '3.2 dB');
  r.m.setBypass(true, 1.5);
  assert.equal(ab.textContent, 'A/B +1.5 dB');
  r.m.setBypass(true);
  assert.equal(ab.textContent, 'A/B +1.5 dB', 'no gain given: the last one stays');
  r.m.setBypass(true, 0);
  assert.equal(ab.textContent, 'A/B 0.0 dB');
  r.m.setBypass(true, NaN);
  assert.equal(ab.textContent, 'A/B');
  r.m.setBypass(true, -2);
  ab.click();
  assert.deepEqual([r.ev.join(), ab.getAttribute('aria-pressed'), ab.classList.contains('on'), ab.textContent], ['ab:true,ab:false', 'false', false, 'A/B']);
  r.m.setBypass(true, -1); r.m.setBypass(false);
  assert.deepEqual([r.ev.join(), ab.textContent, r.m.state().bypass], ['ab:true,ab:false', 'A/B', false], 'the host\'s setBypass is silent');
});

test('Mono: a tap toggles and calls onMono(on); setMono is silent; lit while on', () => {
  const r = rig();
  const mo = cls(r.root, 'mo-mono');
  mo.click(); mo.click(); mo.click();
  assert.deepEqual([r.ev.join(), mo.getAttribute('aria-pressed'), mo.classList.contains('on')], ['mono:true,mono:false,mono:true', 'true', true]);
  r.m.setMono(false);
  assert.deepEqual([mo.getAttribute('aria-pressed'), r.ev.length, r.m.state().mono], ['false', 3, false]);
  r.m.setMono(1);
  assert.equal(r.m.state().mono, true);
});

test('reset: a tap on the max-hold number or on I calls onReset and shows "—" for I, the range and the hold at once; the next summary brings the new values', () => {
  const r = rig();
  r.m.setLive(true);
  r.m.update(sum({})); r.m.draw(0);
  assert.equal(val(r.root, 'True peak max hold (tap to reset)'), MINUS + '2.5');
  cls(r.root, 'mo-hold').click();
  r.m.draw(30);
  assert.deepEqual([r.ev.join(), val(r.root, 'True peak max hold (tap to reset)'), val(r.root, 'Integrated loudness (tap to reset)'), val(r.root, 'Loudness range'), val(r.root, 'Short-term loudness')], ['reset', DASH, DASH, DASH, MINUS + '14.8'], 'only I, LRA and the hold are cleared');
  r.m.update(sum({ i: -20, tpMax: -9, lra: 1 })); r.m.draw(200);
  assert.deepEqual([val(r.root, 'True peak max hold (tap to reset)'), val(r.root, 'Integrated loudness (tap to reset)')], [MINUS + '9.0', MINUS + '20.0']);
  cls(r.root, 'mo-reset').click();
  assert.equal(r.ev.join(), 'reset,reset');
  assert.deepEqual([cls(r.root, 'mo-hold').type, cls(r.root, 'mo-reset').type], ['button', 'button']);
});

test('target menu: the tick\'s default is −14; a tap opens a menu of −9 / −14 / −16 / −23 / off; a pick calls onTarget and closes; setTarget is silent', () => {
  const r = rig();
  const tg = cls(r.root, 'mo-target'), menu = cls(r.root, 'mo-menu');
  assert.deepEqual([r.m.target(), menu.hidden, menu.getAttribute('role')], [-14, true, 'menu']);
  tg.click();
  assert.deepEqual([menu.hidden, tg.getAttribute('aria-expanded'), r.m.state().menu], [false, 'true', true]);
  const items = clsAll(menu, 'mo-mi');
  assert.deepEqual(items.map(b => b.textContent), [MINUS + '9 LUFS', MINUS + '14 LUFS', MINUS + '16 LUFS', MINUS + '23 LUFS', 'Off']);
  assert.deepEqual(items.map(b => b.getAttribute('aria-checked')), ['false', 'true', 'false', 'false', 'false']);
  assert.equal(items.every(b => b.getAttribute('role') === 'menuitemradio'), true);
  items[3].click();
  assert.deepEqual([r.ev.join(), r.m.target(), tg.textContent, menu.hidden, tg.getAttribute('aria-expanded')], ['target:-23', -23, 'Target ' + MINUS + '23 LUFS', true, 'false']);
  tg.click(); clsAll(menu, 'mo-mi')[4].click();
  assert.deepEqual([r.ev.join(), r.m.target(), tg.textContent], ['target:-23,target:null', null, 'Target off']);
  tg.click(); clsAll(menu, 'mo-mi')[4].click();
  assert.equal(r.ev.length, 2, 'picking the current target is no change');
  r.m.setTarget(-16);
  assert.deepEqual([r.ev.length, r.m.target(), tg.textContent], [2, -16, 'Target ' + MINUS + '16 LUFS']);
  r.m.setTarget('x');
  assert.equal(r.m.target(), -16, 'junk ignored');
});

test('target menu: closes on Escape (focus back on the button), on a press outside, when the module goes off screen, and on a camera move (wk.closeTransient); a press inside does not', () => {
  const r = rig();
  const tg = cls(r.root, 'mo-target'), menu = cls(r.root, 'mo-menu');
  tg.click();
  assert.equal(r.d.activeElement === clsAll(menu, 'mo-mi')[1], true, 'focus on the current item');
  ptr(menu, 'pointerdown', 1, 1);
  assert.equal(menu.hidden, false, 'a press inside keeps it');
  key(r.d.activeElement, 'ArrowDown');
  assert.equal(r.d.activeElement === clsAll(menu, 'mo-mi')[2], true, 'arrows move');
  key(r.d.activeElement, 'Escape');
  assert.deepEqual([menu.hidden, r.d.activeElement === tg], [true, true]);
  tg.click(); ptr(r.d.body, 'pointerdown', 5, 5);
  assert.equal(menu.hidden, true, 'outside press');
  tg.click(); r.m.setLive(true); r.m.setLive(false);
  assert.equal(menu.hidden, true, 'off screen');
  tg.click(); wk.closeTransient();
  assert.equal(menu.hidden, true, 'camera move');
  assert.equal(r.ev.length, 0, 'closing without a pick is no change');
});

test('scope modes: wave / spectrum / image buttons call onMode and light up; setMode is silent; junk and the same mode are refused', () => {
  const r = rig();
  const [w, s, im] = clsAll(r.root, 'mo-mode');
  im.click();
  assert.deepEqual([r.ev.join(), r.m.mode(), im.getAttribute('aria-pressed'), w.getAttribute('aria-pressed')], ['mode:image', 'image', 'true', 'false']);
  im.click();
  assert.equal(r.ev.length, 1, 'the same mode again: no call');
  s.click();
  assert.deepEqual([r.ev.join(), r.m.mode()], ['mode:image,mode:spectrum', 'spectrum']);
  assert.deepEqual([r.m.setMode('wave'), r.m.setMode('bogus'), r.m.setMode('wave'), r.m.mode(), r.ev.length], [true, false, false, 'wave', 2]);
  const o = rig({ mode: 'image' });
  assert.equal(o.m.mode(), 'image', 'the option sets the start mode');
});

/* ================================================================ the scope: pulled data */
const feed = (calls, sr = 48000, amp = 0.5) => (mode, b) => {
  calls.push(mode);
  if (mode === 'wave') for (let i = 0; i < b.td.length; i++) b.td[i] = Math.sin(i * 0.05) * amp;
  else if (mode === 'spectrum') b.fd.fill(-60);
  else for (let i = 0; i < b.L.length; i++) { b.L[i] = Math.sin(i * 0.3) * amp; b.R[i] = Math.sin(i * 0.3 + 0.5) * amp; }
  return sr;
};

test('scope: the host is read only from draw() while live, once per frame at most every 30 ms, for the mode shown only', () => {
  const calls = [];
  const r = rig({ read: feed(calls) });
  r.m.update(sum({}));
  r.m.draw(0); r.m.draw(100);
  assert.equal(calls.length, 0, 'not live: the host is not read');
  r.m.setLive(true);
  r.m.draw(200);
  assert.deepEqual(calls, ['wave']);
  r.m.draw(210); r.m.draw(220);
  assert.equal(calls.length, 1, 'inside 30 ms: not read again');
  r.m.draw(231);
  assert.equal(calls.length, 2);
  r.m.setMode('image'); r.m.draw(300);
  r.m.setMode('spectrum'); r.m.draw(400);
  assert.deepEqual(calls, ['wave', 'wave', 'image', 'spectrum']);
  // a second of 120 Hz frames: at most 34 scope paints
  const q = rig({ read: feed([]) });
  q.m.setLive(true);
  for (let t = 0; t < 1000; t += 8.33) q.m.draw(t);
  assert.ok(n(q.slog(), 'clearRect') + n(q.slog(), 'fillRect') > 0);
  const frames = q.slog().filter(e => e[0] === 'fillRect' && e[3] === U.SCOPE_W && e[4] === U.SCOPE_H).length; // the background fill, one per frame
  assert.ok(frames >= 25 && frames <= 34, 'scope frames in a second: ' + frames);
});

test('scope: wave and spectrum are drawn from the pulled arrays, flat line without a source (a falsy rate), a failing host is survived', () => {
  const r = rig({ read: feed([]) });
  r.m.setLive(true); r.m.draw(0);
  assert.ok(n(r.slog(), 'lineTo') >= 100, 'a waveform: many segments');
  r.m.setMode('spectrum'); r.m.draw(100);
  const labels = r.slog().filter(e => e[0] === 'fillText').map(e => e[1]);
  assert.ok(labels.includes('1k') && labels.includes('-60 dB'), 'spectrum labels: ' + labels.join());
  const idle = rig({ read: () => 0 });
  idle.m.setLive(true); idle.m.draw(0);
  const flat = n(idle.slog(), 'lineTo');
  assert.ok(flat > 0 && flat < 20, 'the grid and one flat line: ' + flat);
  const bad = rig({ read: () => { throw new Error('no analyser'); } });
  const err = console.error; console.error = () => {};
  try { bad.m.setLive(true); bad.m.draw(0); bad.m.draw(100); } finally { console.error = err; }
  assert.ok(n(bad.slog(), 'lineTo') >= 1, 'drawn as idle');
  const none = rig();
  none.m.setLive(true); none.m.draw(0); none.m.draw(100); none.m.draw(200);
  assert.equal(n(none.slog(), 'lineTo'), flat, 'no read option: the idle frame once');
});

test('image mode: at most 2048 points however long the arrays; one dot each; the cloud follows the rotated M/S mapping', () => {
  const r = rig();
  r.m.setLive(true);
  const L = new Float32Array(5000).fill(0.5), R = new Float32Array(5000).fill(0.5);
  assert.equal(r.m.drawImage(L, R), true);
  const dots = () => r.slog().filter(e => e[0] === 'fillRect' && e[3] === 1.3 && e[4] === 1.3);
  assert.equal(dots().length, U.MAX_POINTS, '5000 samples: 2048 dots');
  assert.equal(r.m.drawImage(new Float32Array(100), new Float32Array(300)), true);
  assert.equal(dots().length, U.MAX_POINTS + 100, 'the shorter array rules');
  // mono L = R: every dot on the vertical axis (x = centre), above the centre; anti-phase: on the horizontal axis
  const cx = U.SCOPE_W / 2, cy = U.SCOPE_H / 2;
  const mono = dots().slice(0, 50);
  assert.ok(mono.every(e => Math.abs(e[1] + 0.65 - cx) < 1e-9 && e[2] + 0.65 < cy), 'mono: vertical');
  const r2 = rig(); r2.m.setLive(true);
  r2.m.drawImage(new Float32Array(10).fill(-0.5), new Float32Array(10).fill(0.5));
  const anti = r2.slog().filter(e => e[0] === 'fillRect' && e[3] === 1.3);
  assert.ok(anti.length === 10 && anti.every(e => Math.abs(e[2] + 0.65 - cy) < 1e-9 && e[1] + 0.65 > cx), 'anti-phase: horizontal');
  // NaN samples are skipped, not drawn at NaN
  const r3 = rig(); r3.m.setLive(true);
  r3.m.drawImage(new Float32Array([NaN, 0.1, 0.2]), new Float32Array([0.1, NaN, 0.2]));
  assert.equal(r3.slog().filter(e => e[0] === 'fillRect' && e[3] === 1.3).length, 1);
  // not live / destroyed: nothing
  const r4 = rig();
  assert.equal(r4.m.drawImage(L, R), false);
  assert.equal(r4.slog().length, 0);
});

test('image mode through the host\'s read(): the dots come from bufs.L / bufs.R, capped; the correlation bar and its number stay below the scope', () => {
  const calls = [];
  const r = rig({ read: feed(calls), mode: 'image' });
  r.m.setLive(true);
  r.m.update(sum({ corr: -0.4 }));
  r.m.draw(0);
  assert.deepEqual(calls, ['image']);
  const dots = r.slog().filter(e => e[0] === 'fillRect' && e[3] === 1.3 && e[4] === 1.3).length;
  assert.ok(dots > 0 && dots <= U.MAX_POINTS, 'dots: ' + dots);
  assert.equal(val(r.root, 'Phase correlation'), MINUS + '0.40');
  const cb = cls(r.root, 'mo-corr'), lab = cls(r.root, 'mo-lab');
  assert.equal(parseFloat(cb.style.top) >= parseFloat(cls(r.root, 'mo-scope').style.top) + parseFloat(cls(r.root, 'mo-scope').style.height), true, 'the correlation row sits under the scope');
  assert.equal(lab.textContent, 'CORR');
});

test('no shadowBlur anywhere (any mode, meters or scope), and nothing is drawn through a layout read', () => {
  const r = rig({ read: feed([]) });
  r.m.setLive(true);
  for (const m of U.MODES) { r.m.setMode(m); r.m.update(sum({ tp: [-0.5, -2] })); r.m.draw(r.clock.t += 100); }
  r.m.drawImage(new Float32Array(64), new Float32Array(64));
  const bad = [...r.mlog(), ...r.slog()].filter(e => /shadow/i.test(String(e[0])));
  assert.deepEqual(bad.map(e => e[0]), []);
});

test('scope: silence is painted once and then left alone; sound resumes painting; a forced repaint (mode change) always paints', () => {
  let amp = 0;
  const r = rig({ read: feed([], 48000, 0) });
  r.m.setLive(true);
  const bg = () => r.slog().filter(e => e[0] === 'fillRect' && e[3] === U.SCOPE_W && e[4] === U.SCOPE_H).length;
  r.m.draw(0);
  assert.equal(bg(), 1);
  for (let t = 40; t <= 400; t += 40) r.m.draw(t);
  assert.equal(bg(), 1, 'silent frames: not repainted');
  r.m.setMode('image'); r.m.draw(500);
  assert.equal(bg(), 2, 'mode change: painted');
  for (let t = 540; t <= 900; t += 40) r.m.draw(t);
  assert.equal(bg(), 2);
  const s = rig({ read: (m, b) => { amp = 0.4; return feed([], 48000, amp)(m, b); } });
  s.m.setLive(true);
  for (let t = 0; t <= 200; t += 40) s.m.draw(t);
  assert.equal(s.slog().filter(e => e[0] === 'fillRect' && e[3] === U.SCOPE_W && e[4] === U.SCOPE_H).length, 6, 'sound: every due frame');
});

/* ================================================================ density, zoom, layout, lifecycle */
test('dpr-aware: the stores follow the device ratio; a zoom end (wk.rescaleCanvases) repaints a live module at the new density and leaves a hidden one alone', () => {
  const r = rig();
  r.d.defaultView.devicePixelRatio = 2;
  r.m.setLive(true); r.m.update(sum({})); r.m.draw(0);
  assert.deepEqual([r.mt.width, r.mt.height, r.sc.width, r.sc.height], [U.OUT_W * 2, U.OUT_H * 2, U.SCOPE_W * 2, U.SCOPE_H * 2]);
  r.d.defaultView.devicePixelRatio = 3;
  wk.rescaleCanvases();
  assert.deepEqual([r.mt.width, r.sc.width], [U.OUT_W * 2, U.SCOPE_W * 2], 'the density is capped at 2 outside the canvas world');
  const calls = n(r.mlog(), 'clearRect');
  wk.rescaleCanvases();
  assert.equal(n(r.mlog(), 'clearRect'), calls + 1, 'a zoom end repaints the meters (live)');
  r.m.setLive(false);
  wk.rescaleCanvases();
  assert.equal(n(r.mlog(), 'clearRect'), calls + 1, 'not live: left alone');
  r.m.destroy();
  wk.rescaleCanvases();
  assert.equal(n(r.mlog(), 'clearRect'), calls + 1, 'destroyed: unregistered');
});

test('a store released at 0 × 0 (wk.releaseCanvases: a body unmounted, then mounted again) is painted again at the next frame, meters and a silent scope included', () => {
  const r = rig({ read: feed([], 48000, 0) });
  r.m.setLive(true); r.m.update(sum({})); r.m.draw(0);
  const m0 = n(r.mlog(), 'clearRect'), bg = () => r.slog().filter(e => e[0] === 'fillRect' && e[3] === U.SCOPE_W && e[4] === U.SCOPE_H).length;
  r.m.draw(100);
  assert.deepEqual([n(r.mlog(), 'clearRect'), bg()], [m0, 1], 'at rest: nothing');
  r.mt.width = 0; r.mt.height = 0; r.sc.width = 0; r.sc.height = 0;
  r.m.draw(200);
  assert.deepEqual([n(r.mlog(), 'clearRect'), bg(), r.mt.width > 0, r.sc.width > 0], [m0 + 1, 2, true, true]);
  r.m.draw(300);
  assert.deepEqual([n(r.mlog(), 'clearRect'), bg()], [m0 + 1, 2], 'and then at rest again');
});

test('no layout read in the update / draw path: getBoundingClientRect, offset / client sizes are never touched', () => {
  let reads = 0;
  const proto = El.prototype, saved = {};
  for (const k of ['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight']) {
    saved[k] = Object.getOwnPropertyDescriptor(proto, k);
    Object.defineProperty(proto, k, { configurable: true, get() { reads++; return saved[k].get.call(this); } });
  }
  const rect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (...a) { reads++; return rect.apply(this, a); };
  try {
    const calls = [];
    const o = rig({ read: feed(calls) }), w = rig({}, 'row');
    o.m.setLive(true);
    for (let t = 0; t < 600; t += 16) { o.m.update(sum({ s: -20 + (t % 9) })); o.m.draw(t); w.m.update(sum({ s: -20 + (t % 9) })); w.clock.t = t; }
    o.m.setMode('image'); o.m.draw(700); o.m.setMode('spectrum'); o.m.draw(800); o.m.drawImage(new Float32Array(9), new Float32Array(9));
    cls(o.root, 'mo-ab').click(); cls(o.root, 'mo-target').click();
    assert.ok(calls.length > 5, 'the draw path ran');
    assert.equal(reads, 0);
  } finally {
    for (const k of Object.keys(saved)) Object.defineProperty(proto, k, saved[k]);
    proto.getBoundingClientRect = rect;
  }
});

test('destroy: removes the module, drops its listeners and the zoom hook, every call after it is a no-op, twice is fine', () => {
  const r = rig({ read: feed([]) });
  r.m.setLive(true); r.m.update(sum({})); r.m.draw(0);
  cls(r.root, 'mo-target').click();
  r.m.destroy();
  assert.equal(r.root.parentNode, null, 'removed');
  assert.equal(r.d.body.children.length, 0);
  const a = r.mlog().length, b = r.slog().length;
  r.m.update(sum({})); r.m.setBypass(true, -1); r.m.setMono(true); r.m.setLive(true); r.m.setMode('image'); r.m.setTarget(-9);
  assert.equal(r.m.draw(1000), false);
  assert.equal(r.m.drawImage(new Float32Array(4), new Float32Array(4)), false);
  assert.deepEqual([r.mlog().length, r.slog().length, r.m.state().bypass, r.m.state().mono, r.m.mode(), r.m.target()], [a, b, false, false, 'wave', -14]);
  r.m.destroy();
  cls(r.root, 'mo-ab').click();
  assert.equal(r.ev.length, 0, 'a click on the removed button reaches nobody');
  ptr(r.d.body, 'pointerdown', 1, 1);
});

test('callbacks that throw are survived; a missing callback is fine; a host without options still works', () => {
  const r = rig({ onReset() { throw new Error('x'); }, onBypass() { throw new Error('y'); }, onMono: null, onTarget: undefined });
  const err = console.error; console.error = () => {};
  try {
    cls(r.root, 'mo-hold').click(); cls(r.root, 'mo-ab').click(); cls(r.root, 'mo-mono').click();
  } finally { console.error = err; }
  assert.equal(cls(r.root, 'mo-ab').getAttribute('aria-pressed'), 'true');
  const d = fresh();
  const m = U.createMasterOut(d.body);
  m.setLive(true); m.update(SUM); assert.equal(m.draw(0), true);
  const w = U.createMasterOut(null, { doc: d });
  assert.equal(w.el.parentNode, null);
  w.destroy(); m.destroy();
});

/* ================================================================ the Master row */
test('row: "Master", a stereo peak meter (role=meter), the short-term LUFS number, A/B, Mono and the open chevron — real buttons with labels', () => {
  const r = rig({}, 'row');
  assert.deepEqual([r.root.className, r.root.getAttribute('role'), r.root.getAttribute('aria-label')], ['cv-mastrow', 'group', 'Master']);
  const name = cls(r.root, 'mr-name'), open = cls(r.root, 'mr-open'), ab = cls(r.root, 'mr-ab'), mo = cls(r.root, 'mr-mono');
  assert.deepEqual([name.textContent, name.type, name.getAttribute('aria-label'), open.getAttribute('aria-label'), open.getAttribute('aria-expanded'), ab.textContent, mo.textContent], ['Master', 'button', 'Open the master canvas', 'Open the master canvas', 'false', 'A/B', 'Mono']);
  const bars = clsAll(r.root, 'mr-bar');
  assert.deepEqual(bars.map(b => [b.getAttribute('role'), b.getAttribute('aria-label'), b.getAttribute('aria-valuemin'), b.getAttribute('aria-valuemax')]), [['meter', 'Master left peak level', '-60', '0'], ['meter', 'Master right peak level', '-60', '0']]);
  assert.deepEqual([cls(r.root, 'mr-lv').textContent, cls(r.root, 'mr-lu').textContent, cls(r.root, 'mr-lufs').children[0].textContent], [DASH, 'LUFS', 'Short-term loudness']);
  assert.deepEqual([ab.getAttribute('aria-pressed'), mo.getAttribute('aria-pressed')], ['false', 'false']);
});

test('row: the name and the chevron call open; A/B and Mono toggle and call back; setBypass / setMono / setActive are silent', () => {
  const r = rig({}, 'row');
  cls(r.root, 'mr-name').click(); cls(r.root, 'mr-open').click();
  assert.equal(r.ev.join(), 'open,open');
  cls(r.root, 'mr-ab').click(); cls(r.root, 'mr-mono').click();
  assert.deepEqual([r.ev.slice(2).join(), cls(r.root, 'mr-ab').getAttribute('aria-pressed'), cls(r.root, 'mr-mono').getAttribute('aria-pressed'), cls(r.root, 'mr-ab').classList.contains('on')], ['ab:true,mono:true', 'true', 'true', true]);
  r.m.setBypass(false, -3); r.m.setMono(false);
  assert.deepEqual([r.ev.length, cls(r.root, 'mr-ab').getAttribute('aria-pressed'), cls(r.root, 'mr-mono').getAttribute('aria-pressed'), cls(r.root, 'mr-ab').textContent], [4, 'false', 'false', 'A/B']);
  r.m.setActive(true);
  assert.deepEqual([r.root.classList.contains('on'), cls(r.root, 'mr-open').getAttribute('aria-expanded'), cls(r.root, 'mr-name').getAttribute('aria-current'), r.m.state().active], [true, 'true', 'true', true]);
  r.m.setActive(false);
  assert.deepEqual([r.root.classList.contains('on'), cls(r.root, 'mr-open').getAttribute('aria-expanded'), cls(r.root, 'mr-name').getAttribute('aria-current')], [false, 'false', null]);
});

test('row: the short-term LUFS number and the peak bars follow the summary; silence is "—" and an empty bar; the text changes at most 10 times a second', () => {
  const r = rig({}, 'row');
  const lv = () => cls(r.root, 'mr-lv').textContent, bars = clsAll(r.root, 'mr-bar'), cov = bars.map(b => b.children[0]);
  r.clock.t = 0; r.m.update(sum({ s: -14.23, pk: [-6, -12] }));
  assert.deepEqual([lv(), cov[0].style.transform, cov[1].style.transform, bars[0].getAttribute('aria-valuenow'), bars[0].getAttribute('aria-valuetext'), bars[1].getAttribute('aria-valuetext')],
    [MINUS + '14.2', 'translateX(90%)', 'translateX(80%)', '-6', MINUS + '6.0 dB', MINUS + '12.0 dB']);
  r.clock.t = 40; r.m.update(sum({ s: -Infinity, pk: [-Infinity, -Infinity] }));
  assert.equal(lv(), MINUS + '14.2', 'the text waits for its 100 ms');
  r.clock.t = 140; r.m.update(sum({ s: -Infinity, pk: [-Infinity, -Infinity] }));
  assert.equal(lv(), DASH);
  // a second of 33 ms summaries
  const q = rig({}, 'row'), seen = [];
  for (let t = 0; t <= 1000; t += 33) { q.clock.t = t; q.m.update(sum({ s: -30 + t / 40 })); seen.push(cls(q.root, 'mr-lv').textContent); }
  const changes = seen.filter((s, i) => i && s !== seen[i - 1]).length;
  assert.ok(changes >= 5 && changes <= 11, 'row text changes in a second: ' + changes);
});

test('row: the peak meter rises at once and falls at TP_REL dB/s; a peak between two refreshes is held; bars write only when their level moved', () => {
  const r = rig({}, 'row');
  const cov = clsAll(r.root, 'mr-bar').map(b => b.children[0]);
  const writes = []; // every transform write, counted through a setter
  for (const c of cov) { let v = ''; Object.defineProperty(c.style, 'transform', { get: () => v, set: x => { v = x; writes.push(x); } }); }
  r.clock.t = 0; r.m.update(sum({ pk: [-6, -30] }));
  assert.equal(cov[0].style.transform, 'translateX(90%)');
  r.clock.t = 100; r.m.update(sum({ pk: [-Infinity, -Infinity] })); // 0.1 s: −6 → −8.4
  assert.equal(cov[0].style.transform, 'translateX(86%)', '24 dB/s release');
  const k = writes.length;
  r.clock.t = 110; r.m.update(sum({ pk: [-Infinity, -Infinity] })); // inside 30 ms: nothing
  assert.equal(writes.length, k, 'no write inside the 30 ms window');
  // two summaries between refreshes: the louder one is shown
  const q = rig({}, 'row'), qc = clsAll(q.root, 'mr-bar').map(b => b.children[0]);
  q.clock.t = 0; q.m.update(sum({ pk: [-40, -40] }));
  q.clock.t = 10; q.m.update(sum({ pk: [-3, -40] }));
  q.clock.t = 20; q.m.update(sum({ pk: [-50, -40] }));
  q.clock.t = 40; q.m.update(sum({ pk: [-50, -40] }));
  assert.equal(qc[0].style.transform, 'translateX(95%)', 'the −3 dB peak that fell inside the throttle is not lost');
  // unchanged level: the same string is not written again
  const w2 = rig({}, 'row'), c2 = clsAll(w2.root, 'mr-bar').map(b => b.children[0]); let n2 = 0;
  for (const c of c2) { let v = ''; Object.defineProperty(c.style, 'transform', { get: () => v, set: x => { v = x; n2++; } }); }
  for (let t = 0; t < 600; t += 33) { w2.clock.t = t; w2.m.update(sum({ pk: [-Infinity, -Infinity] })); }
  assert.ok(n2 <= 4, 'a silent meter at rest writes nothing more: ' + n2);
});

test('row: red (an over) from −1 dBTP, shown for a moment after the last over; not before', () => {
  const r = rig({}, 'row');
  const bars = clsAll(r.root, 'mr-bar'), over = () => bars.map(b => b.classList.contains('over')).join();
  r.clock.t = 0; r.m.update(sum({ tp: [-1.01, -3] }));
  assert.equal(over(), 'false,false');
  r.clock.t = 40; r.m.update(sum({ tp: [-3, -0.9] }));
  assert.equal(over(), 'true,true');
  r.clock.t = 500; r.m.update(sum({ tp: [-30, -30] }));
  assert.equal(over(), 'true,true', 'held for a moment');
  r.clock.t = 1000; r.m.update(sum({ tp: [-30, -30] }));
  assert.equal(over(), 'false,false');
});

test('row: nothing is written while not live; going live shows the latest at once', () => {
  const r = rig({}, 'row');
  const lv = () => cls(r.root, 'mr-lv').textContent, cov = clsAll(r.root, 'mr-bar').map(b => b.children[0]);
  r.clock.t = 0; r.m.update(sum({ s: -20, pk: [-10, -10] }));
  r.m.setLive(false);
  r.clock.t = 500; r.m.update(sum({ s: -9, pk: [-1, -1] }));
  assert.deepEqual([lv(), cov[0].style.transform, r.m.state().live], [MINUS + '20.0', 'translateX(83%)', false]);
  r.clock.t = 900; r.m.setLive(true);
  assert.deepEqual([lv(), cov[0].style.transform], [MINUS + '9.0', 'translateX(98%)']);
});

test('row: garbage summaries do not throw; destroy removes it and silences every call', () => {
  const r = rig({}, 'row');
  for (const junk of [null, undefined, 0, 'x', [], { s: 'a', pk: 'b', tp: {} }]) { r.clock.t += 200; r.m.update(junk); }
  assert.equal(cls(r.root, 'mr-lv').textContent, DASH);
  r.m.destroy();
  assert.equal(r.root.parentNode, null);
  r.m.update(sum({})); r.m.setBypass(true); r.m.setMono(true); r.m.setActive(true); r.m.setLive(true);
  assert.deepEqual([r.m.state().bypass, r.m.state().mono, r.m.state().active, cls(r.root, 'mr-lv').textContent], [false, false, false, DASH]);
  cls(r.root, 'mr-open').click();
  assert.equal(r.ev.length, 0);
  r.m.destroy();
});

/* ================================================================ review fixes (IMPL-M §12 "Reviews and fixes") */
test('A/B on the OUT, the {t: ab} shape: g null is pending "A/B …"; a number shows the match; lim adds "(peak-limited)"; off and NaN read plain (R1-4 / F1 / F2)', () => {
  const r = rig(), ab = cls(r.root, 'mo-ab');
  r.m.setBypass(true, null);
  assert.deepEqual([ab.textContent, r.m.state().gain, r.m.state().limited, ab.getAttribute('aria-pressed')], ['A/B …', null, false, 'true'], 'pending');
  r.m.setBypass(true, 2.14, true);
  assert.deepEqual([ab.textContent, r.m.state().gain, r.m.state().limited], ['A/B +2.1 dB (peak-limited)', 2.14, true]);
  r.m.setBypass(true, 2.14, false);
  assert.deepEqual([ab.textContent, r.m.state().limited], ['A/B +2.1 dB', false]);
  r.m.setBypass(true, -3.24, true);
  assert.equal(ab.textContent, 'A/B ' + MINUS + '3.2 dB (peak-limited)');
  r.m.setBypass(true);
  assert.equal(ab.textContent, 'A/B ' + MINUS + '3.2 dB (peak-limited)', 'no gain given: the last one stays');
  r.m.setBypass(true, null, true);
  assert.deepEqual([ab.textContent, r.m.state().limited], ['A/B …', false], 'pending again: no cap to speak of');
  r.m.setBypass(true, NaN, true);
  assert.deepEqual([ab.textContent, r.m.state().limited], ['A/B', false], 'junk reads plain');
  r.m.setBypass(true, 0.04, true);
  assert.equal(ab.textContent, 'A/B 0.0 dB (peak-limited)', 'never a +0.0 or a −0.0');
  r.m.setBypass(false, 5, true);
  assert.deepEqual([ab.textContent, ab.getAttribute('aria-pressed'), r.m.state().limited], ['A/B', 'false', false], 'off clears it all');
  assert.equal(r.ev.length, 0, 'setBypass is silent');
  // a tap on a pending button turns it off as before
  r.m.setBypass(true, null); ab.click();
  assert.deepEqual([r.ev.join(), ab.textContent], ['ab:false', 'A/B']);
});

test('A/B on the row shows the match like the OUT\'s: "A/B −3.2" (abbreviated, "*" when peak-limited, "…" pending) with the full words in the title and the label (F8)', () => {
  const r = rig({}, 'row'), ab = cls(r.root, 'mr-ab');
  assert.deepEqual([ab.textContent, ab.getAttribute('aria-label')], ['A/B', null]);
  r.m.setBypass(true, -3.24);
  assert.deepEqual([ab.textContent, ab.title.includes(MINUS + '3.2 dB'), (ab.getAttribute('aria-label') || '').includes(MINUS + '3.2 dB'), ab.getAttribute('aria-pressed')], ['A/B ' + MINUS + '3.2', true, true, 'true']);
  r.m.setBypass(true, 2.14, true);
  assert.deepEqual([ab.textContent, ab.title.includes('+2.1 dB'), ab.title.includes('peak-limited'), (ab.getAttribute('aria-label') || '').includes('peak-limited')], ['A/B +2.1*', true, true, true]);
  r.m.setBypass(true, 2.14, false);
  assert.deepEqual([ab.textContent, ab.title.includes('peak-limited')], ['A/B +2.1', false]);
  r.m.setBypass(true, null);
  assert.deepEqual([ab.textContent, r.m.state().gain, r.m.state().limited], ['A/B …', null, false]);
  r.m.setBypass(true);
  assert.equal(ab.textContent, 'A/B …', 'no gain given: unchanged');
  r.m.setBypass(true, 0.04);
  assert.equal(ab.textContent, 'A/B 0.0');
  r.m.setBypass(true, NaN);
  assert.equal(ab.textContent, 'A/B');
  r.m.setBypass(true, -1, true); r.m.setBypass(false);
  assert.deepEqual([ab.textContent, ab.getAttribute('aria-label'), ab.title.includes(MINUS + '1'), r.m.state().bypass, r.ev.length], ['A/B', null, false, false, 0], 'off: plain, silent');
  ab.click();
  assert.deepEqual([r.ev.join(), ab.getAttribute('aria-pressed')], ['ab:true', 'true']);
});

test('LRA reads "—" when nothing was measured (the 0 posted at boot / after a reset with no integrated value), "0.0" only for a real flat programme (F7)', () => {
  const r = rig(); r.m.setLive(true);
  const lra = () => val(r.root, 'Loudness range');
  r.m.update(sum({ i: -Infinity, lra: 0, m: -Infinity, s: -Infinity })); r.m.draw(0);
  assert.equal(lra(), DASH, 'boot: lra 0, nothing integrated');
  r.m.update(sum({ i: -Infinity, lra: -Infinity })); r.m.draw(200);
  assert.equal(lra(), DASH, 'the engine\'s own -Infinity');
  r.m.update(sum({ i: -14.5, lra: 0 })); r.m.draw(400);
  assert.equal(lra(), '0.0', 'a measured flat programme');
  r.m.update(sum({ i: -14.5, lra: 6.24 })); r.m.draw(600);
  assert.equal(lra(), '6.2');
  r.m.update(sum({ i: -Infinity, lra: 0 })); r.m.draw(800);
  assert.equal(lra(), DASH, 'back to nothing');
});

test('OUT clear(): silence at once — every readout "—", the true-peak bars and the correlation empty, no fall to wait for; the buttons keep their state (F5)', () => {
  const r = rig(); r.m.setLive(true);
  r.m.setBypass(true, 1.5); r.m.setMono(true);
  r.m.update(sum({ tp: [-3, -3], tpMax: -2, corr: 0.8 })); r.m.draw(0);
  assert.notEqual(val(r.root, 'Short-term loudness'), DASH);
  const k = r.mlog().length;
  r.m.clear();
  r.m.draw(1000); // a second later: an unaided bar would still stand at −27 dBTP
  for (const nm of ['Momentary loudness', 'Short-term loudness', 'Integrated loudness (tap to reset)', 'Loudness range', 'True peak max hold (tap to reset)', 'Phase correlation']) assert.equal(val(r.root, nm), DASH, nm);
  const fills = r.mlog().slice(k).filter(e => e[0] === '=fillStyle').map(e => e[1]);
  assert.equal(fills.length > 0, true, 'the meters repainted');
  assert.deepEqual([U.TP_ZONES.some(z => fills.includes(z[2])), fills.includes('#7cffb5')], [false, false], 'no bar filled');
  assert.deepEqual([r.m.state().bypass, r.m.state().mono, cls(r.root, 'mo-ab').textContent], [true, true, 'A/B +1.5 dB'], 'the controls are not touched');
  assert.equal(r.ev.length, 0, 'clear is silent');
  // not live: nothing is written, and going live shows silence
  const q = rig();
  q.m.setLive(true); q.m.update(sum({})); q.m.draw(0); q.m.setLive(false);
  q.m.clear(); q.m.setLive(true); q.m.draw(500);
  assert.equal(val(q.root, 'Short-term loudness'), DASH);
  q.m.destroy(); q.m.clear();
});

test('row clear(): the LUFS number "—", both peak bars empty and "silent", the over glow gone — at once, whatever the fall rate (F5)', () => {
  const r = rig({}, 'row');
  const lv = () => cls(r.root, 'mr-lv').textContent, bars = clsAll(r.root, 'mr-bar'), cov = bars.map(b => b.children[0]);
  r.clock.t = 0; r.m.update(sum({ s: -14.2, pk: [-6, -12], tp: [-0.5, -3] }));
  assert.deepEqual([lv(), cov[0].style.transform, bars[0].classList.contains('over')], [MINUS + '14.2', 'translateX(90%)', true]);
  r.clock.t = 10; r.m.clear();
  assert.deepEqual([lv(), cov[0].style.transform, cov[1].style.transform, bars[0].getAttribute('aria-valuetext'), bars[1].getAttribute('aria-valuetext'), bars[0].classList.contains('over'), bars[1].classList.contains('over')],
    [DASH, 'translateX(0%)', 'translateX(0%)', 'silent', 'silent', false, false]);
  r.clock.t = 400; r.m.update(sum({ s: -20, pk: [-10, -10] }));
  assert.equal(lv(), MINUS + '20.0', 'and it measures again');
  // not live: untouched until it is
  const q = rig({}, 'row');
  q.clock.t = 0; q.m.update(sum({ s: -9, pk: [-3, -3] })); q.m.setLive(false);
  q.clock.t = 100; q.m.clear();
  assert.equal(cls(q.root, 'mr-lv').textContent, MINUS + '9.0', 'not live: no write');
  q.clock.t = 200; q.m.setLive(true);
  assert.deepEqual([cls(q.root, 'mr-lv').textContent, clsAll(q.root, 'mr-bar')[0].children[0].style.transform], [DASH, 'translateX(0%)']);
  q.m.destroy(); q.m.clear();
});
