import './v8-guard.mjs';
// master-ui.js's safety-limiter controls on tests/wk-dom.mjs: the master OUT's "Safety limiter" button (the switch — on by default, a
// tap toggles and calls onSafe(on), setSafe is silent) and the Master row's indicator (no switch: the row has no room for a fourth
// button at 44 px touch targets — it takes the short-term LUFS number's place while the limiter acts, "−2.5 LIM", so the row's width
// never changes). setLimit(gr) (the limiter's {t: 'safe', gr}: dB of gain reduction) shows "limiting" with its reduction (the OUT:
// "Limiting −2.5 dB") for LIM_MS after the last report, never while off; clear() (the engine went off) drops it; nothing is written
// while the row is not live. The A/B / Mono / meters untouched.
// Never passes fake-DOM nodes to assert.* (strings, numbers and booleans only).
// Run alone: node --max-old-space-size=2048 --test tests/safe-ui.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, all } from './wk-dom.mjs';
import * as U from '../master-ui.js?v=9';

const MINUS = '−';
const cls = (root, c) => all(root).find(n => n.classList && n.classList.contains(c)) || null;
function rig(kind, o = {}) {
  const d = fresh(), clock = { t: 0 }, ev = [];
  const opts = Object.assign({ doc: d, now: () => clock.t, onSafe: v => ev.push('safe:' + v), onBypass: v => ev.push('ab:' + v), onMono: v => ev.push('mono:' + v) }, o);
  const m = (kind === 'out' ? U.createMasterOut : U.createMasterRow)(d.body, opts);
  return { d, m, clock, ev, root: m.el };
}
const SUM = { m: -14.2, s: -14.8, i: -14.5, lra: 6.2, tp: [-3, -4], tpMax: -2.5, pk: [-6, -7], corr: 0.8, lat: 0 };

test('the constants: LIM_MS (how long "limiting" stays after the last report) and the words', () => {
  assert.equal(U.LIM_MS, 1000);
  assert.deepEqual([U.limShort(2.46), U.limShort(0.04), U.limFull(2.46), U.limFull(12)], [MINUS + '2.5', MINUS + '0.0', 'Limiting ' + MINUS + '2.5 dB', 'Limiting ' + MINUS + '12.0 dB']);
});

// the row's indicator: shown (and the LUFS number hidden — the row limiting) or not, its value, unit and title
const ind = r => { const e = cls(r.root, 'mr-lim'); return [e.hidden, r.root.classList.contains('limiting'), cls(e, 'mr-limv').textContent]; };

test('row: no switch — the indicator sits in the LUFS number\'s place, hidden at rest (the row as before: Master, meter, LUFS, A/B, Mono, chevron); "Safety limiter" its hidden name, LIM its unit', () => {
  const r = rig('row'), e = cls(r.root, 'mr-lim');
  assert.deepEqual(r.root.children.map(n => n.className.split(' ').pop()), ['mr-name', 'mr-meter', 'mr-lufs', 'mr-lim', 'mr-ab', 'mr-mono', 'mr-open']);
  assert.equal(cls(r.root, 'mr-safe'), null, 'no switch on the row');
  assert.deepEqual([e.tagName, e.children[0].textContent, e.children[0].classList.contains('cv-sr'), cls(e, 'mr-limu').textContent, cls(e, 'mr-limu').getAttribute('aria-hidden')], ['SPAN', 'Safety limiter, limiting', true, 'LIM', 'true']);
  assert.deepEqual(ind(r), [true, false, ''], 'at rest: hidden');
  assert.deepEqual([r.m.state().safe, rig('row', { safe: false }).m.state().safe], [true, false], 'o.safe: on unless false');
  cls(r.root, 'mr-ab').click(); cls(r.root, 'mr-mono').click();
  assert.equal(r.ev.join(), 'ab:true,mono:true');
});

test('row: setLimit(gr) shows the reduction in the LUFS number\'s place ("−2.5 LIM", the row limiting; its title says why) for LIM_MS after the last report; the latest report shows; never while off; clear() drops it', () => {
  const r = rig('row'), e = cls(r.root, 'mr-lim');
  r.clock.t = 0; r.m.setLimit(2.46);
  assert.deepEqual([...ind(r), r.m.state().limiting, r.m.state().gr], [false, true, MINUS + '2.5', true, 2.46]);
  assert.match(e.title, /^Safety limiter: limiting 2\.5 dB — the mix is too loud; pull some faders down/);
  r.clock.t = 400; r.m.setLimit(1.04);
  assert.equal(ind(r)[2], MINUS + '1.0', 'the latest report');
  r.clock.t = 1399; r.m.update(SUM);
  assert.equal(ind(r)[1], true, 'held');
  r.clock.t = 1400; r.m.update(SUM);
  assert.deepEqual([...ind(r), r.m.state().limiting], [true, false, MINUS + '1.0', false], 'gone a second after the last report (the LUFS number back)');
  r.m.setLimit(3); r.m.clear();
  assert.deepEqual(ind(r).slice(0, 2), [true, false], 'clear(): the engine went off');
  r.m.setSafe(false); r.clock.t = 2000; r.m.setLimit(3);
  assert.deepEqual([...ind(r).slice(0, 2), r.m.state().limiting], [true, false, false], 'off: nothing to show');
  r.m.setSafe(true); r.m.setLimit(-1); r.m.setLimit(NaN); r.m.setLimit('x'); r.m.setLimit(0);
  assert.equal(ind(r)[1], false, 'junk is not a reduction');
  r.m.setLimit(2); r.m.setSafe(false);
  assert.deepEqual(ind(r).slice(0, 2), [true, false], 'turned off while limiting: gone at once');
  assert.equal(r.ev.length, 0, 'the row calls nothing back');
});

test('row: while not live nothing is written; going live shows a reduction still within its hold, not an old one', () => {
  const r = rig('row');
  r.m.setLive(false);
  r.clock.t = 0; r.m.setLimit(2);
  assert.deepEqual(ind(r).slice(0, 2), [true, false]);
  r.clock.t = 500; r.m.setLive(true);
  assert.deepEqual(ind(r), [false, true, MINUS + '2.0']);
  r.m.setLive(false); r.clock.t = 3000; r.m.setLive(true);
  assert.deepEqual(ind(r).slice(0, 2), [true, false]);
});

test('OUT: "Safety limiter" — a real button on the A/B row (its own place), on by default; a tap toggles and calls onSafe; setLimit shows "Limiting −2.5 dB" for LIM_MS (drawn on its frames while live); off and clear() as the row', () => {
  const r = rig('out'), b = cls(r.root, 'mo-safe');
  assert.deepEqual([b.tagName, b.type, b.textContent, b.getAttribute('aria-pressed'), b.classList.contains('mo-btn')], ['BUTTON', 'button', 'Safety limiter', 'true', true]);
  assert.deepEqual([b.style.left, b.style.top, b.style.width, b.style.height], ['296px', '198px', '114px', '28px']);
  b.click();
  assert.deepEqual([r.ev.join(), b.getAttribute('aria-pressed'), r.m.state().safe], ['safe:false', 'false', false]);
  r.m.setSafe(true);
  assert.equal(r.ev.length, 1);
  r.m.setLive(true);
  r.clock.t = 0; r.m.setLimit(2.46);
  assert.deepEqual([b.textContent, b.classList.contains('act'), r.m.state().limiting], ['Limiting ' + MINUS + '2.5 dB', true, true]);
  r.clock.t = 999; r.m.draw(r.clock.t);
  assert.equal(b.classList.contains('act'), true);
  r.clock.t = 1000; r.m.draw(r.clock.t);
  assert.deepEqual([b.textContent, b.classList.contains('act')], ['Safety limiter', false]);
  r.m.setLimit(4); r.m.clear();
  assert.equal(b.textContent, 'Safety limiter');
  r.m.setSafe(false); r.m.setLimit(4);
  assert.equal(b.classList.contains('act'), false);
  const q = rig('out', { safe: false });
  assert.equal(cls(q.root, 'mo-safe').getAttribute('aria-pressed'), 'false');
});
