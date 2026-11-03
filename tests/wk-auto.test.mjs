import './v8-guard.mjs';
// IMPL-AUTO §6 / G6, lane W (widgets): W.follow(v | null) on knob / slider / numBox draws at v without set / History / event, a drag
// that starts on a followed control starts from the followed value, W.setAuto('on' | 'off' | null) sets / clears data-auto on the
// [data-dest] root. DOM-stub level (tests/wk-dom.mjs); numbers / strings only in assert.*.
// Run alone: node --max-old-space-size=2048 --test tests/wk-auto.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, one, ptr, key, fire } from './wk-dom.mjs';
const wk = await import('../wk.js?v=9');
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

function mk(kind) {
  fresh();
  const st = { n: 0.2, calls: [] };
  const o = { dest: 'f.cutoff', label: 'CUT', get: () => st.n, set: (n, ph) => { st.n = n; st.calls.push([ph, n]); }, def: 0.25, fmt: n => Math.round(n * 100) + '%' };
  let w;
  if (kind === 'knob') w = wk.knob(o);
  else if (kind === 'slider') w = wk.slider(o);
  else w = wk.numBox(Object.assign(o, { steps: 100 }));
  document.body.appendChild(w.el);
  if (kind === 'slider') one(w.el, 'wk-slt')._rect = { left: 100, top: 0, width: 200, height: 10 };
  const shown = () => kind === 'knob' ? w.el.getAttribute('aria-valuetext') : kind === 'slider' ? one(w.el, 'wk-num').textContent : one(w.el, 'wk-nbt').textContent;
  return { w, st, el: w.el, shown };
}

for (const kind of ['knob', 'slider', 'numBox']) {
  test(`${kind}: follow draws at v without set, update() keeps it until follow(null)`, () => {
    const { w, st, el, shown } = mk(kind);
    assert.equal(shown(), '20%');
    let events = 0;
    for (const t of ['change', 'input', 'pointerdown']) el.addEventListener(t, () => events++);
    w.follow(0.6);
    assert.equal(shown(), '60%');
    assert.equal(el.getAttribute('aria-valuenow'), kind === 'numBox' ? '60' : '60');
    assert.equal(st.calls.length, 0, 'follow never calls set');
    assert.equal(st.n, 0.2, 'the base is untouched');
    assert.equal(events, 0);
    w.update();
    assert.equal(shown(), '60%', 'update keeps the followed value');
    st.n = 0.3; w.update();
    assert.equal(shown(), '60%', 'a base change does not move the drawing');
    w.follow(0.7);
    assert.equal(shown(), '70%');
    w.follow(null);
    assert.equal(shown(), '30%', 'null: the base shows');
    assert.equal(st.calls.length, 0);
    w.follow(0.5); w.follow(undefined);
    assert.equal(shown(), '30%', 'undefined clears too');
  });

  test(`${kind}: a drag that starts while followed starts from the followed value`, () => {
    const { w, st, el, shown } = mk(kind);
    w.follow(0.6);
    if (kind === 'slider') ptr(el, 'pointerdown', 220, 5); // on the followed thumb (60% of 200 + 100 = 220)
    else ptr(el, 'pointerdown', 100, 100);
    assert.deepEqual(st.calls, [['start', 0.6]], 'start carries the followed value, not the base');
    if (kind === 'slider') ptr(el, 'pointermove', 240, 5); else ptr(el, 'pointermove', 100, kind === 'knob' ? 80 : 92);
    near(st.n, kind === 'slider' ? 0.7 : kind === 'knob' ? 0.7 : 0.61);
    assert.equal(shown(), Math.round(st.n * 100) + '%', 'the drawing tracks the drag while followed');
    ptr(el, 'pointerup', 240, 5);
    assert.equal(st.calls.at(-1)[0], 'end');
  });

  test(`${kind}: keys / dblclick-reset still act on the base`, () => {
    const { w, st, el } = mk(kind);
    w.follow(0.6);
    el.focus();
    key(el, 'ArrowUp');
    near(st.n, 0.21);
    key(el, 'Backspace');
    near(st.n, 0.25);
    assert.ok(st.calls.every(c => c[0] === 'set'));
  });

  test(`${kind}: setAuto sets / clears data-auto on the data-dest root`, () => {
    const { w, el } = mk(kind);
    assert.equal(el.hasAttribute('data-auto'), false);
    w.setAuto('on');
    assert.equal(el.getAttribute('data-auto'), 'on');
    assert.equal(el.getAttribute('data-dest'), 'f.cutoff');
    w.setAuto('off');
    assert.equal(el.getAttribute('data-auto'), 'off');
    w.update();
    assert.equal(el.getAttribute('data-auto'), 'off', 'update keeps it');
    w.setAuto(null);
    assert.equal(el.hasAttribute('data-auto'), false);
    w.setAuto('on'); w.setAuto('bogus');
    assert.equal(el.hasAttribute('data-auto'), false);
  });
}

test('setAuto adds no child element (the knob keeps its four children)', () => {
  const { w, el } = mk('knob');
  const n = el.children.length;
  w.setAuto('on'); w.follow(0.4);
  assert.equal(el.children.length, n);
});

test('menu / toggle / seg / fader carry setAuto and the fader follows through the slider core', () => {
  fresh();
  const st = { n: 0.5 };
  const f = wk.fader({ dest: 'mix.t1', get: () => st.n, set: () => {}, def: 0.5 });
  document.body.appendChild(f.el);
  f.follow(0.9); f.setAuto('on');
  assert.equal(one(f.el, 'wk-num').textContent, '90%');
  assert.equal(f.el.getAttribute('data-auto'), 'on');
  const tg = wk.toggle({ dest: 'x.on', label: 'ON', get: () => 0, set: () => {} });
  tg.setAuto('off');
  assert.equal(tg.el.getAttribute('data-auto'), 'off');
});

test('style.css: the dot is a 6 px ::after on [data-auto] (a hollow ring in the tint for off), the ringed rig knob keeps its own ::after', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const rule = sel => { const i = css.indexOf(sel); return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1); };
  const on = rule('[data-auto]:not([data-rig-ring])::after');
  assert.ok(on, 'the on rule');
  assert.match(on, /width: 6px; height: 6px/);
  assert.match(on, /var\(--mc, var\(--tc,/, "the track's tint");
  assert.match(on, /pointer-events: none/);
  const off = rule('[data-auto="off"]:not([data-rig-ring])::after');
  assert.match(off, /background: transparent/, 'off: hollow (fix round, R2 P2-1: a shape, never a colour — --hot is track 1\'s tint)');
  assert.match(off, /inset 0 0 0 1\.5px var\(--mc, var\(--tc,/, 'off: a 1.5 px ring in the track\'s tint');
  assert.doesNotMatch(off, /--hot/, 'off: no colour of its own');
  assert.match(css, /\.ctl\[data-auto\] \{ position: relative; \}/);
  assert.match(css, /\.wk-knob\[data-auto\]\[data-rig-ring\]::before/);
});
