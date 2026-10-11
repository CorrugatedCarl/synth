// wk.js (E6) — widget kit tests. Node has no DOM: tests/wk-dom.mjs is a minimal fake DOM implementing exactly the
// surface the E6 modules use (elements, SVG, attributes, classList, style, events with capture/target/bubble
// phases, focus, pointer capture, bounding rects, canvas stubs). Run: node --test tests/
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Imported before any DOM exists: the module must not touch document/window/navigator at top level (§0.1, §10.6).
const wk = await import('../wk.js');
const noDom = { dsp: await wk.loadDSP(), css: wk.injectStyles(), ctx: wk.contextMenu(0, 0, [{ label: 'x' }]) };

/* ------------------------------------------------------------ fake DOM (shared helper) */
import { advance, all, byCls, one, fresh, fire, ptr, key, setPlatform } from './wk-dom.mjs';
const near = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

function mkKnob(extra = {}) {
  const st = { n: 0.5, calls: [], dis: false };
  const k = wk.knob(Object.assign({
    dest: 'f.cutoff', label: 'CUTOFF', get: () => st.n, set: (n, ph) => { st.n = n; st.calls.push([ph, n]); },
    def: 0.25, fmt: n => (n * 100).toFixed(1) + '%', disabled: () => st.dis,
  }, extra));
  document.body.appendChild(k.el);
  return { k, st, el: k.el };
}

/* --------------------------------------------------------------- tests */
test('imports and degrades without a DOM', () => {
  assert.deepEqual(noDom.dsp, { SerumDSP: null, FXDSP: null });
  assert.equal(noDom.css, null);
  assert.equal(typeof noDom.ctx.close, 'function');
  noDom.ctx.close();
});

test('prefs: defaults, merge, copy', () => {
  assert.deepEqual(wk.getPrefs(), { tooltips: 1, dblClick: 'type', wheel: 1 });
  wk.setPrefs({ dblClick: 'reset', wheel: 0 });
  assert.deepEqual(wk.getPrefs(), { tooltips: 1, dblClick: 'reset', wheel: 0 });
  wk.getPrefs().wheel = 1;
  assert.equal(wk.getPrefs().wheel, 0);
  wk.setPrefs({ dblClick: 'bogus', wheel: 1, tooltips: false });
  assert.deepEqual(wk.getPrefs(), { tooltips: 0, dblClick: 'type', wheel: 1 });
  wk.setPrefs({ tooltips: 1 });
});

test('injectStyles: once per document, tokens with fallbacks; widgets inject on demand', () => {
  const d = fresh();
  const s = wk.injectStyles();
  assert.equal(s.id, 'wk-css');
  assert.equal(s.parentNode, d.head);
  assert.equal(wk.injectStyles(d), s);
  assert.match(s.textContent, /\.wk-knob/);
  assert.match(s.textContent, /var\(--sx-accent, #4fb3ff\)/);
  assert.match(s.textContent, /prefers-reduced-motion/);
  const d2 = fresh();
  wk.knob({ label: 'A', get: () => 0, set() {}, def: 0, fmt: String });
  wk.menu({ label: 'M', items: () => [], get: () => 0, set() {} });
  wk.toggle({ label: 'T', get: () => 0, set() {} });
  assert.equal(all(d2.head).filter(n => n.id === 'wk-css').length, 1);
});

test('knob: DOM contract (§8.7.1)', () => {
  const d = fresh();
  const { k, el } = mkKnob();
  assert.equal(el.wk, k);
  assert.ok(el.classList.contains('wk-knob') && el.classList.contains('wk-md'));
  assert.equal(el.getAttribute('data-dest'), 'f.cutoff');
  assert.equal(el.getAttribute('role'), 'slider');
  assert.equal(el.getAttribute('tabindex'), '0');
  assert.equal(el.getAttribute('aria-label'), 'CUTOFF');
  assert.equal(el.getAttribute('aria-valuemin'), '0');
  assert.equal(el.getAttribute('aria-valuemax'), '100');
  assert.equal(el.getAttribute('aria-valuenow'), '50');
  assert.equal(el.getAttribute('aria-valuetext'), '50.0%');
  const svg = el.children[0];
  assert.equal(svg.getAttribute('class'), 'wk-svg');
  assert.equal(svg.getAttribute('viewBox'), '0 0 64 64');
  const order = svg.children.map(n => n.getAttribute('class'));
  assert.equal(order[0], 'wk-halo');
  assert.ok(order.indexOf('wk-track') < order.indexOf('wk-val') && order.indexOf('wk-val') < order.indexOf('wk-ptr'));
  assert.equal(svg.children[order.indexOf('wk-track')].localName, 'circle');
  assert.equal(svg.children[order.indexOf('wk-val')].localName, 'path');
  assert.equal(svg.children[order.indexOf('wk-ptr')].localName, 'line');
  assert.equal(el.children[1].className, 'wk-lab');
  assert.equal(el.children[1].textContent, 'CUTOFF');
  assert.equal(el.children[2].className, 'wk-num');
  assert.equal(el.children[2].textContent, '50.0%');
  assert.ok(d.getElementById('wk-css'));
  // sizes, no dest, dest as a function (MIX ↔ LEVEL rebinding)
  assert.ok(wk.knob({ label: 'S', size: 'sm', get: () => 0, set() {}, def: 0, fmt: String }).el.classList.contains('wk-sm'));
  assert.ok(wk.knob({ label: 'L', size: 'lg', get: () => 0, set() {}, def: 0, fmt: String }).el.classList.contains('wk-lg'));
  const nd = wk.knob({ label: 'N', get: () => 0, set() {}, def: 0, fmt: String });
  assert.equal(nd.el.hasAttribute('data-dest'), false);
  let id = 'fx.dist.mix';
  const fd = wk.knob({ dest: () => id, label: 'MIX', get: () => 0, set() {}, def: 0, fmt: String });
  assert.equal(fd.el.getAttribute('data-dest'), 'fx.dist.mix');
  id = 'fx.dist.level'; fd.update();
  assert.equal(fd.el.getAttribute('data-dest'), 'fx.dist.level');
  // update() re-reads get/fmt
  const { k: k2, st: s2, el: e2 } = mkKnob();
  s2.n = 0.2; k2.update();
  assert.equal(e2.children[2].textContent, '20.0%');
  assert.equal(e2.getAttribute('aria-valuenow'), '20');
  k2.destroy();
  assert.equal(e2.parentNode, null);
  assert.equal(e2.wk, null);
});

test('knob: drag — 200 px full range, horizontal counts, Shift ×0.1, phases, clamp', () => {
  fresh();
  const { st, el } = mkKnob();
  ptr(el, 'pointerdown', 100, 100);
  assert.deepEqual(st.calls, [['start', 0.5]]);
  assert.equal(el._cap, 1);
  assert.equal(document.activeElement, el);
  ptr(el, 'pointermove', 100, 60); // 40 px up
  near(st.n, 0.7);
  ptr(el, 'pointermove', 120, 60); // 20 px right
  near(st.n, 0.8);
  ptr(el, 'pointermove', 120, -40, { shiftKey: true }); // 100 px fine
  near(st.n, 0.85);
  assert.ok(st.calls.slice(1).every(c => c[0] === 'move'));
  ptr(el, 'pointermove', 120, -2000);
  assert.equal(st.n, 1);
  ptr(el, 'pointermove', 120, -1980); // no dead zone past the end
  near(st.n, 0.9);
  ptr(el, 'pointerup', 120, -1980);
  assert.deepEqual(st.calls.at(-1), ['end', st.n]);
  assert.equal(el._cap, null);
  const n = st.calls.length;
  ptr(el, 'pointermove', 0, 0); // after release: nothing
  assert.equal(st.calls.length, n);
  // right button and a mouse move without buttons (swallowed pointerup) end cleanly
  ptr(el, 'pointerdown', 0, 0, { button: 2 });
  assert.equal(st.calls.length, n);
  ptr(el, 'pointerdown', 0, 0);
  ptr(el, 'pointermove', 0, -20, { buttons: 0 });
  assert.deepEqual(st.calls.slice(n).map(c => c[0]), ['start', 'end']);
  // lost capture ends the gesture
  ptr(el, 'pointerdown', 0, 0);
  fire(el, 'lostpointercapture', { pointerId: 1 });
  assert.equal(st.calls.at(-1)[0], 'end');
});

test('knob: stepped — 1 step per 8 px, exact grid values, keys and wheel step', () => {
  fresh();
  const { st, el } = mkKnob({ steps: 48, def: 24 / 48 });
  ptr(el, 'pointerdown', 0, 100);
  ptr(el, 'pointermove', 0, 93); // 7 px: no step yet
  assert.equal(st.calls.length, 1);
  ptr(el, 'pointermove', 0, 92); // 8 px
  assert.equal(st.n, 25 / 48);
  ptr(el, 'pointermove', 0, 108); // back 16 px
  assert.equal(st.n, 23 / 48);
  ptr(el, 'pointermove', 0, 100 - 8 * 30);
  assert.equal(st.n, 1);
  ptr(el, 'pointerup', 0, 100 - 8 * 30);
  for (const c of st.calls) assert.equal(c[1] * 48, Math.round(c[1] * 48));
  el.focus();
  st.n = 24 / 48;
  key(el, 'ArrowRight');
  assert.equal(st.n, 25 / 48);
  key(el, 'ArrowDown', { shiftKey: true });
  assert.equal(st.n, 24 / 48);
  key(el, 'PageUp');
  assert.equal(st.n, 29 / 48); // round(48 / 10) = 5 steps
  const e = fire(el, 'wheel', { deltaY: 1, deltaMode: 1 }); // one notch down
  assert.ok(e.defaultPrevented);
  assert.equal(st.n, 28 / 48);
  fire(el, 'wheel', { deltaY: -25 }); // trackpad: 40 px per step
  assert.equal(st.n, 28 / 48);
  fire(el, 'wheel', { deltaY: -25 });
  assert.equal(st.n, 29 / 48);
});

test('knob: detents snap the drag', () => {
  fresh();
  const { st, el } = mkKnob({ detents: [0.75] });
  ptr(el, 'pointerdown', 0, 100);
  ptr(el, 'pointermove', 0, 51); // raw 0.745
  assert.equal(st.n, 0.75);
  ptr(el, 'pointermove', 0, 47); // raw 0.765 (within 4 px)
  assert.equal(st.n, 0.75);
  ptr(el, 'pointermove', 0, 45); // raw 0.775
  near(st.n, 0.775);
  ptr(el, 'pointerup', 0, 45);
});

test('knob: Cmd/Ctrl-click resets to def; macOS Ctrl-click is left to the context menu', () => {
  fresh();
  const { st, el } = mkKnob();
  ptr(el, 'pointerdown', 0, 0, { metaKey: true });
  assert.deepEqual(st.calls, [['set', 0.25]]);
  st.n = 0.5; st.calls.length = 0;
  setPlatform('MacIntel');
  ptr(el, 'pointerdown', 0, 0, { ctrlKey: true });
  assert.deepEqual(st.calls, []);
  setPlatform('Win32');
  ptr(el, 'pointerdown', 0, 0, { ctrlKey: true });
  assert.deepEqual(st.calls, [['set', 0.25]]);
  // no-op reset is not reported
  ptr(el, 'pointerdown', 0, 0, { ctrlKey: true });
  assert.equal(st.calls.length, 1);
});

test('knob: a capturing ancestor that stops an Alt pointerdown keeps it from the knob (mod layer)', () => {
  const d = fresh();
  const { st, el } = mkKnob();
  d.body.addEventListener('pointerdown', e => { if (e.altKey) e.stopPropagation(); }, true);
  ptr(el, 'pointerdown', 0, 0, { altKey: true });
  assert.deepEqual(st.calls, []);
  ptr(el, 'pointerdown', 0, 0);
  assert.deepEqual(st.calls, [['start', 0.5]]);
});

test('knob: keyboard', () => {
  fresh();
  const { st, el } = mkKnob();
  el.focus();
  let e = key(el, 'ArrowUp');
  assert.ok(e.defaultPrevented);
  near(st.n, 0.51);
  key(el, 'ArrowRight', { shiftKey: true });
  near(st.n, 0.511);
  key(el, 'ArrowLeft');
  near(st.n, 0.501);
  key(el, 'PageDown');
  near(st.n, 0.401);
  key(el, 'Home');
  assert.equal(st.n, 0);
  key(el, 'ArrowDown');
  assert.equal(st.n, 0);
  key(el, 'End');
  assert.equal(st.n, 1);
  key(el, 'Delete');
  assert.equal(st.n, 0.25);
  st.n = 0.9;
  key(el, 'Backspace');
  assert.equal(st.n, 0.25);
  assert.ok(st.calls.every(c => c[0] === 'set'));
  const n = st.calls.length;
  e = key(el, 'a');
  assert.equal(e.defaultPrevented, false);
  assert.equal(st.calls.length, n);
  key(el, 'Enter');
  assert.ok(one(el, 'wk-in'));
});

test('knob/menu/toggle: ContextMenu and Shift+F10 dispatch one contextmenu at the centre', () => {
  const d = fresh();
  const got = [];
  d.body.addEventListener('contextmenu', e => got.push([e.target, e.clientX, e.clientY]));
  const { el } = mkKnob();
  el._rect = { left: 10, top: 20, width: 40, height: 60 };
  key(el, 'ContextMenu');
  assert.deepEqual(got, [[el, 30, 50]]);
  // the browser's own (trusted) duplicate right after is swallowed, a later right-click is not
  const dup = fire(el, 'contextmenu', { isTrusted: true, clientX: 1, clientY: 1 });
  assert.equal(got.length, 1);
  assert.ok(dup.defaultPrevented);
  advance(1000);
  fire(el, 'contextmenu', { isTrusted: true, clientX: 5, clientY: 6 });
  assert.equal(got.length, 2);
  key(el, 'F10', { shiftKey: true });
  assert.equal(got.length, 3);
  key(el, 'F10');
  assert.equal(got.length, 3);
  const m = wk.menu({ dest: 'f.type', label: 'TYPE', items: () => [{ v: 0, label: 'A' }], get: () => 0, set() {} });
  d.body.appendChild(m.el);
  const btn = one(m.el, 'wk-mbtn');
  key(btn, 'ContextMenu');
  assert.equal(got.at(-1)[0], btn);
  assert.ok(m.el.contains(got.at(-1)[0]));
  const t = wk.toggle({ dest: 'a.on', label: 'OSC A', get: () => 1, set() {}, kind: 'power' });
  d.body.appendChild(t.el);
  key(t.el, 'F10', { shiftKey: true });
  assert.equal(got.at(-1)[0], t.el);
});

test('knob: wheel — notch 1 %, trackpad, Shift, hover guard, prefs.wheel', () => {
  fresh();
  const { st, el } = mkKnob();
  fire(el, 'pointerenter', { bubbles: false });
  advance(100);
  let e = fire(el, 'wheel', { deltaY: 100 });
  assert.equal(e.defaultPrevented, false); // pointer only just arrived: the page scrolls
  assert.equal(st.calls.length, 0);
  advance(300);
  e = fire(el, 'wheel', { deltaY: 100 }); // mouse notch down
  assert.ok(e.defaultPrevented);
  near(st.n, 0.49);
  fire(el, 'wheel', { deltaY: -3, deltaMode: 1 }); // line-mode notch up
  near(st.n, 0.5);
  fire(el, 'wheel', { deltaY: -20 }); // trackpad: 40 px = 1 %
  near(st.n, 0.505);
  fire(el, 'wheel', { deltaY: -100, shiftKey: true });
  near(st.n, 0.506);
  assert.ok(st.calls.every(c => c[0] === 'set'));
  wk.setPrefs({ wheel: 0 });
  e = fire(el, 'wheel', { deltaY: -100 });
  assert.equal(e.defaultPrevented, false);
  near(st.n, 0.506);
  wk.setPrefs({ wheel: 1 });
});

test('knob: typed entry (double-click / Enter), parse, Escape, blur, dblClick = reset', t => {
  const d = fresh();
  t.mock.timers.enable({ apis: ['setTimeout'] }); // the invalid-entry flash uses a timer
  const { k, st, el } = mkKnob({ parse: t => t === 'x' ? 0.3 : t === 'big' ? 7 : null });
  fire(el, 'dblclick');
  let inp = one(el, 'wk-in');
  assert.ok(inp);
  assert.equal(inp.value, '50.0%');
  assert.equal(d.activeElement, inp);
  assert.ok(el.classList.contains('wk-editing'));
  inp.value = 'x';
  key(inp, 'Enter');
  assert.deepEqual(st.calls, [['set', 0.3]]);
  assert.equal(one(el, 'wk-in'), null);
  assert.equal(d.activeElement, el);
  k.edit(); inp = one(el, 'wk-in'); inp.value = 'big'; key(inp, 'Enter'); // clamped
  assert.equal(st.n, 1);
  k.edit(); inp = one(el, 'wk-in'); inp.value = 'nonsense'; key(inp, 'Enter');
  assert.equal(st.n, 1);
  assert.ok(el.classList.contains('wk-bad'));
  t.mock.timers.tick(700);
  assert.equal(el.classList.contains('wk-bad'), false);
  k.edit(); inp = one(el, 'wk-in'); inp.value = 'x'; key(inp, 'Escape');
  assert.equal(st.n, 1);
  assert.equal(one(el, 'wk-in'), null);
  k.edit(); inp = one(el, 'wk-in'); inp.value = 'x';
  d.body.focus(); el.blur(); // focus leaves: commit
  inp.blur();
  assert.equal(st.n, 0.3);
  // arrows inside the field do not move the knob
  k.edit(); inp = one(el, 'wk-in');
  const n = st.calls.length;
  key(inp, 'ArrowUp');
  assert.equal(st.calls.length, n);
  key(inp, 'Escape');
  // default parser: percent
  const { k: k2, st: s2, el: e2 } = mkKnob({ fmt: undefined });
  k2.edit(); inp = one(e2, 'wk-in'); assert.equal(inp.value, '50%'); inp.value = '12,5 %'; key(inp, 'Enter');
  assert.equal(s2.n, 0.125);
  // prefs: double-click resets
  wk.setPrefs({ dblClick: 'reset' });
  fire(e2, 'dblclick');
  assert.equal(s2.n, 0.25);
  assert.equal(one(e2, 'wk-in'), null);
  wk.setPrefs({ dblClick: 'type' });
});

test('knob: touch — long-press 500 ms opens the context menu, double-tap types', () => {
  const d = fresh();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const got = [];
    d.body.addEventListener('contextmenu', e => got.push([e.clientX, e.clientY]));
    const { st, el } = mkKnob();
    ptr(el, 'pointerdown', 50, 60, { pointerType: 'touch' });
    mock.timers.tick(499);
    assert.equal(got.length, 0);
    mock.timers.tick(1);
    assert.deepEqual(got, [[50, 60]]);
    assert.deepEqual(st.calls.map(c => c[0]), ['start', 'end']);
    ptr(el, 'pointerup', 50, 60, { pointerType: 'touch' });
    assert.equal(st.calls.length, 2);
    // moving more than 8 px cancels the long-press and drags
    ptr(el, 'pointerdown', 50, 60, { pointerType: 'touch' });
    ptr(el, 'pointermove', 50, 40, { pointerType: 'touch', buttons: 0 });
    near(st.n, 0.6);
    mock.timers.tick(600);
    assert.equal(got.length, 1);
    ptr(el, 'pointerup', 50, 40, { pointerType: 'touch' });
    // double-tap
    for (let i = 0; i < 2; i++) {
      ptr(el, 'pointerdown', 50, 60, { pointerType: 'touch' });
      advance(80);
      ptr(el, 'pointerup', 50, 60, { pointerType: 'touch' });
      advance(150);
    }
    assert.ok(one(el, 'wk-in'));
    key(one(el, 'wk-in'), 'Escape');
    // two taps too far apart in time: no entry
    ptr(el, 'pointerdown', 50, 60, { pointerType: 'touch' }); ptr(el, 'pointerup', 50, 60, { pointerType: 'touch' });
    advance(600);
    ptr(el, 'pointerdown', 50, 60, { pointerType: 'touch' }); ptr(el, 'pointerup', 50, 60, { pointerType: 'touch' });
    assert.equal(one(el, 'wk-in'), null);
    // a native (Android) long-press menu mid-press ends the drag and suppresses ours
    advance(1000);
    ptr(el, 'pointerdown', 10, 10, { pointerType: 'touch' });
    fire(el, 'contextmenu', { isTrusted: true, clientX: 10, clientY: 10 });
    assert.equal(st.calls.at(-1)[0], 'end');
    mock.timers.tick(600);
    assert.equal(got.length, 2); // the native one only
  } finally {
    mock.timers.reset();
  }
});

test('knob: disabled ignores input', () => {
  fresh();
  const { k, st, el } = mkKnob();
  st.dis = true; k.update();
  assert.ok(el.classList.contains('wk-dis'));
  assert.equal(el.getAttribute('aria-disabled'), 'true');
  ptr(el, 'pointerdown', 0, 0); ptr(el, 'pointermove', 0, -50); ptr(el, 'pointerup', 0, -50);
  el.focus(); key(el, 'ArrowUp'); key(el, 'Delete');
  fire(el, 'wheel', { deltaY: -100 });
  fire(el, 'dblclick');
  assert.deepEqual(st.calls, []);
  assert.equal(one(el, 'wk-in'), null);
  st.dis = false; k.update();
  assert.equal(el.classList.contains('wk-dis'), false);
  assert.equal(el.hasAttribute('aria-disabled'), false);
});

test('knob: value arc, bipolar arc, pointer geometry', () => {
  fresh();
  const val = el => byCls(el, 'wk-val')[0].getAttribute('d');
  const { k, st, el } = mkKnob();
  st.n = 0; k.update();
  assert.equal(val(el), '');
  st.n = 1; k.update();
  assert.equal(val(el), 'M15.74 48.26A23 23 0 1 1 48.26 48.26');
  const b = mkKnob({ bipolar: true });
  assert.equal(val(b.el), ''); // centre
  b.st.n = 0.75; b.k.update();
  assert.match(val(b.el), /^M32\.00 9\.00A23 23 0 0 1 /);
  const p = byCls(b.el, 'wk-ptr')[0];
  assert.ok(+p.getAttribute('x2') > 32 && +p.getAttribute('y2') < 32); // pointing up-right
});

test('knob: setMod halo arcs, order, live dot, depth-handle class', () => {
  fresh();
  const { k, st, el } = mkKnob();
  const halo = byCls(el, 'wk-halo')[0];
  k.setMod({ arcs: [{ from: 0.5, to: 0.8, kind: 'sel' }, { from: 0.2, to: 0.5, kind: 'other' }, { from: 0.6, to: 0.4, kind: 'neg' }], live: 0.7 });
  const vis = () => halo.children.filter(n => n.getAttribute('display') !== 'none');
  const arcs = vis().filter(n => n.localName === 'path');
  assert.deepEqual(arcs.map(n => n.getAttribute('class')), ['wk-arc k-other', 'wk-arc k-neg', 'wk-arc k-sel']);
  assert.ok(arcs.every(n => /^M[\d.]+ [\d.]+A29 29 /.test(n.getAttribute('d'))));
  const live = vis().find(n => n.localName === 'circle');
  assert.ok(live && live.getAttribute('class') === 'wk-live');
  assert.equal(halo.children.at(-1), live);
  assert.ok(el.classList.contains('wk-modded'));
  assert.ok(one(el, 'wk-dh'));
  k.setMod({ arcs: [{ from: 0, to: 1, kind: 'sel' }], live: 0.501 }); // live within 0.002 of base: hidden
  assert.equal(vis().length, 1);
  assert.equal(vis()[0].getAttribute('d'), 'M11.49 52.51A29 29 0 1 1 52.51 52.51');
  st.n = 0.3; k.update(); // base moved away from the live value → dot reappears
  assert.equal(vis().length, 2);
  k.setMod({ arcs: [{ from: -1, to: 2, kind: 'weird' }], live: null }); // clamped, unknown kind = other
  assert.equal(vis()[0].getAttribute('class'), 'wk-arc k-other');
  assert.equal(vis()[0].getAttribute('d'), 'M11.49 52.51A29 29 0 1 1 52.51 52.51');
  k.setMod(null);
  assert.equal(vis().length, 0);
  assert.equal(el.classList.contains('wk-modded'), false);
});

test('knob: labelToggle flips MIX ↔ LEVEL without dragging', () => {
  fresh();
  const lt = { v: 0, alt: 'LEVEL', get() { return lt.v; }, set(v) { lt.v = v; } };
  const { st, el } = mkKnob({ label: 'MIX', labelToggle: lt });
  const lab = one(el, 'wk-lab');
  assert.equal(lab.textContent, 'MIX');
  assert.equal(lab.getAttribute('role'), 'button');
  ptr(lab, 'pointerdown', 0, 0);
  fire(lab, 'click');
  assert.equal(lt.v, 1);
  assert.equal(lab.textContent, 'LEVEL');
  assert.equal(el.getAttribute('aria-label'), 'LEVEL');
  assert.deepEqual(st.calls, []);
  key(lab, 'Enter');
  assert.equal(lab.textContent, 'MIX');
});

test('menu: DOM, arrows (wrap, skip disabled), keys, wheel, setMod bar', () => {
  const d = fresh();
  const items = [
    { v: 0, label: 'MG Low 6', group: 'Normal' }, { v: 1, label: 'MG Low 12', group: 'Normal' },
    { v: 2, label: 'Off', group: 'Normal', disabled: true }, { v: 3, label: 'Comb +', group: 'Flanges' },
    { v: 4, label: 'Ring Mod', group: 'Misc' },
  ];
  const st = { v: 1, calls: [] };
  const m = wk.menu({ dest: 'f.type', label: 'TYPE', items: () => items, get: () => st.v, set: (v, ph) => { st.v = v; st.calls.push([ph, v]); } });
  d.body.appendChild(m.el);
  const btn = one(m.el, 'wk-mbtn'), prev = one(m.el, 'wk-prev'), next = one(m.el, 'wk-next');
  assert.equal(m.el.wk, m);
  assert.equal(m.el.getAttribute('data-dest'), 'f.type');
  assert.equal(one(m.el, 'wk-lab').textContent, 'TYPE');
  assert.equal(one(m.el, 'wk-mtxt').textContent, 'MG Low 12');
  assert.equal(btn.getAttribute('aria-haspopup'), 'listbox');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(btn.getAttribute('aria-label'), 'TYPE: MG Low 12');
  assert.equal(prev.tabIndex, -1);
  fire(next, 'click');
  assert.equal(st.v, 3); // skipped the disabled entry
  fire(next, 'click'); fire(next, 'click');
  assert.equal(st.v, 0); // wrapped
  fire(prev, 'click');
  assert.equal(st.v, 4);
  assert.equal(one(m.el, 'wk-mtxt').textContent, 'Ring Mod');
  assert.ok(st.calls.every(c => c[0] === 'set'));
  key(btn, 'ArrowRight');
  assert.equal(st.v, 0);
  key(btn, 'ArrowLeft');
  assert.equal(st.v, 4);
  // wheel: down = next, no wrap
  btn.focus();
  fire(m.el, 'wheel', { deltaY: -100 });
  assert.equal(st.v, 3);
  fire(m.el, 'wheel', { deltaY: 100 }); fire(m.el, 'wheel', { deltaY: 100 });
  assert.equal(st.v, 4);
  // value not in the list
  st.v = 99; m.update();
  assert.equal(one(m.el, 'wk-mtxt').textContent, '—');
  fire(next, 'click');
  assert.equal(st.v, 0);
  // setMod: underline bar
  m.setMod({ arcs: [{ from: 0.2, to: 0.5, kind: 'sel' }, { from: 0.9, to: 0.6, kind: 'neg' }], live: 0.4 });
  const bar = one(m.el, 'wk-modbar');
  const segs = byCls(bar, 'wk-mseg').filter(s => s.style.display !== 'none');
  assert.deepEqual(segs.map(s => [s.className, s.style.left, s.style.width]), [['wk-mseg k-neg', '60.00%', '30.00%'], ['wk-mseg k-sel', '20.00%', '30.00%']]);
  assert.equal(one(bar, 'wk-mlive').style.left, '40.00%');
  assert.ok(m.el.classList.contains('wk-modded'));
  m.setMod(null);
  assert.equal(byCls(bar, 'wk-mseg').filter(s => s.style.display !== 'none').length, 0);
  assert.equal(one(bar, 'wk-mlive').style.display, 'none');
  // arrows: false, wheel: false
  const m2 = wk.menu({ label: 'X', items: () => items, get: () => 0, set: () => { throw new Error('no'); }, arrows: false, wheel: false });
  d.body.appendChild(m2.el);
  assert.equal(one(m2.el, 'wk-arr'), null);
  assert.equal(m2.el.hasAttribute('data-dest'), false);
  one(m2.el, 'wk-mbtn').focus();
  assert.equal(fire(m2.el, 'wheel', { deltaY: 100 }).defaultPrevented, false);
});

test('menu: popup list — groups, keyboard, type-ahead, click, closing rules', () => {
  const d = fresh();
  const items = [
    { v: 0, label: 'MG Low 6', group: 'Normal' }, { v: 1, label: 'MG Low 12', group: 'Normal' },
    { v: 2, label: 'Off', group: 'Normal', disabled: true }, { v: 3, label: 'Comb +', group: 'Flanges' },
    { v: 4, label: 'Ring Mod', group: 'Misc' }, { v: 5, label: 'Ramp', group: 'Misc' },
  ];
  const st = { v: 1, calls: [] };
  const m = wk.menu({ label: 'TYPE', items: () => items, get: () => st.v, set: (v, ph) => { st.v = v; st.calls.push([ph, v]); } });
  d.body.appendChild(m.el);
  const btn = one(m.el, 'wk-mbtn');
  const pop = () => byCls(d.body, 'wk-pop')[0] || null;
  fire(btn, 'click');
  let p = pop();
  assert.ok(p);
  assert.equal(p.getAttribute('role'), 'listbox');
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(btn.getAttribute('aria-controls'), p.id);
  assert.equal(d.activeElement, p);
  const groups = byCls(p, 'wk-grp');
  assert.deepEqual(groups.map(g => [g.getAttribute('role'), g.getAttribute('aria-label')]), [['group', 'Normal'], ['group', 'Flanges'], ['group', 'Misc']]);
  const opts = byCls(p, 'wk-opt');
  assert.equal(opts.length, 6);
  assert.ok(opts.every(o => o.getAttribute('role') === 'option'));
  assert.equal(opts[1].getAttribute('aria-selected'), 'true');
  assert.equal(opts[2].getAttribute('aria-disabled'), 'true');
  assert.equal(p.getAttribute('aria-activedescendant'), opts[1].id);
  key(p, 'ArrowDown'); // skips the disabled entry
  assert.equal(p.getAttribute('aria-activedescendant'), opts[3].id);
  key(p, 'ArrowUp');
  assert.equal(p.getAttribute('aria-activedescendant'), opts[1].id);
  key(p, 'ArrowRight'); key(p, 'ArrowRight'); // next group, next group
  assert.equal(p.getAttribute('aria-activedescendant'), opts[4].id);
  key(p, 'ArrowLeft');
  assert.equal(p.getAttribute('aria-activedescendant'), opts[3].id);
  key(p, 'End');
  assert.equal(p.getAttribute('aria-activedescendant'), opts[5].id);
  key(p, 'Home');
  assert.equal(p.getAttribute('aria-activedescendant'), opts[0].id);
  key(p, 'Enter');
  assert.deepEqual(st.calls, [['set', 0]]);
  assert.equal(pop(), null);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(d.activeElement, btn);
  // type-ahead: 'r' → Ring Mod, 'r' again → Ramp; 'ra' → Ramp
  key(btn, 'ArrowDown'); p = pop();
  key(p, 'r');
  assert.equal(p.getAttribute('aria-activedescendant'), byCls(p, 'wk-opt')[4].id);
  advance(100); key(p, 'r');
  assert.equal(p.getAttribute('aria-activedescendant'), byCls(p, 'wk-opt')[5].id);
  advance(1000); key(p, 'r'); advance(100); key(p, 'a');
  assert.equal(p.getAttribute('aria-activedescendant'), byCls(p, 'wk-opt')[5].id);
  advance(100); key(p, ' '); // space inside a type-ahead word does not select
  assert.ok(pop());
  key(p, 'Escape');
  assert.equal(pop(), null);
  assert.equal(st.calls.length, 1);
  assert.equal(d.activeElement, btn);
  // click an option
  fire(btn, 'click'); p = pop();
  fire(byCls(p, 'wk-opt')[3], 'click');
  assert.equal(st.v, 3);
  assert.equal(pop(), null);
  fire(btn, 'click'); p = pop();
  fire(byCls(p, 'wk-opt')[2], 'click'); // disabled: ignored, stays open
  assert.ok(pop());
  // pointerdown inside keeps it, outside closes it without stealing focus
  ptr(byCls(p, 'wk-opt')[0], 'pointerdown', 0, 0);
  assert.ok(pop());
  ptr(d.body, 'pointerdown', 0, 0);
  assert.equal(pop(), null);
  // clicking the button again toggles it closed
  fire(btn, 'click'); fire(btn, 'click');
  assert.equal(pop(), null);
  // scroll / resize close
  fire(btn, 'click'); fire(d, 'scroll', { bubbles: true });
  assert.equal(pop(), null);
  fire(btn, 'click'); fire(d.defaultView, 'resize');
  assert.equal(pop(), null);
  // scrolling inside the list does not
  fire(btn, 'click'); p = pop(); fire(p, 'scroll', { bubbles: false });
  assert.ok(pop());
  // a context menu replaces it (one popup at a time); listeners are cleaned up
  wk.contextMenu(10, 10, [{ label: 'x' }]);
  assert.equal(pop(), null);
  assert.equal(byCls(d.body, 'wk-ctx').length, 1);
  ptr(d.body, 'pointerdown', 0, 0);
  assert.equal(d.listenerCount('pointerdown'), 1); // only the kit's input-modality tracker remains
  assert.equal(d.defaultView.listenerCount('scroll'), 0);
  // empty list: nothing opens
  const e = wk.menu({ label: 'E', items: () => [], get: () => 0, set() {} });
  d.body.appendChild(e.el);
  fire(one(e.el, 'wk-mbtn'), 'click');
  assert.equal(pop(), null);
  e.destroy();
  assert.equal(e.el.parentNode, null);
});

test('menu: popup placement stays on screen', () => {
  const d = fresh();
  const m = wk.menu({ label: 'T', items: () => [{ v: 0, label: 'A' }], get: () => 0, set() {} });
  d.body.appendChild(m.el);
  const btn = one(m.el, 'wk-mbtn');
  btn._rect = { left: 100, top: 50, width: 120, height: 24 };
  fire(btn, 'click');
  let p = byCls(d.body, 'wk-pop')[0];
  assert.equal(p.style.left, '100px');
  assert.equal(p.style.top, '76px');
  assert.equal(p.style.minWidth, '120px');
  m.close();
  btn._rect = { left: 1270, top: 780, width: 20, height: 18 };
  fire(btn, 'click');
  p = byCls(d.body, 'wk-pop')[0];
  assert.equal(p.style.left, '1236px'); // 1280 − 4 − 40
  assert.equal(p.style.top, '738px'); // flipped above: 780 − 2 − 40
  m.close();
});

test('toggle: kinds, aria-pressed, click, disabled, ring, long-press', () => {
  const d = fresh();
  const st = { v: 0, calls: [], dis: false };
  const mk = kind => {
    const t = wk.toggle({ dest: 'a.on', label: 'OSC A', kind, get: () => st.v, set: (v, ph) => { st.v = v; st.calls.push([ph, v]); }, disabled: () => st.dis });
    d.body.appendChild(t.el);
    return t;
  };
  const led = mk('led'), btn = mk('btn'), pow = mk('power'), def = mk();
  assert.ok(one(led.el, 'wk-dot'));
  assert.equal(one(led.el, 'wk-tl').textContent, 'OSC A');
  assert.equal(one(btn.el, 'wk-dot'), null);
  assert.equal(one(btn.el, 'wk-tl').textContent, 'OSC A');
  assert.ok(one(pow.el, 'wk-pic'));
  assert.ok(def.el.classList.contains('wk-led'));
  for (const t of [led, btn, pow]) {
    assert.equal(t.el.localName, 'button');
    assert.equal(t.el.type, 'button');
    assert.equal(t.el.getAttribute('aria-label'), 'OSC A');
    assert.equal(t.el.getAttribute('aria-pressed'), 'false');
    assert.equal(t.el.getAttribute('data-dest'), 'a.on');
    assert.equal(t.el.wk, t);
  }
  fire(pow.el, 'click');
  assert.deepEqual(st.calls, [['set', 1]]);
  assert.equal(pow.el.getAttribute('aria-pressed'), 'true');
  assert.ok(pow.el.classList.contains('wk-on'));
  led.update();
  assert.equal(led.el.getAttribute('aria-pressed'), 'true');
  fire(led.el, 'click');
  assert.equal(st.v, 0);
  st.v = 0.7; btn.update(); // switch destinations: n ≥ 0.5 is on
  assert.equal(btn.el.getAttribute('aria-pressed'), 'true');
  st.v = 0; st.dis = true; btn.update();
  assert.ok(btn.el.classList.contains('wk-dis'));
  fire(btn.el, 'click');
  assert.equal(st.v, 0);
  st.dis = false; btn.update();
  // ring segment
  pow.setMod({ arcs: [{ from: 0, to: 0.5, kind: 'sel' }], live: 0.25 });
  const ring = one(pow.el, 'wk-ring');
  assert.equal(ring.getAttribute('preserveAspectRatio'), 'none');
  const paths = byCls(ring, 'wk-arc').filter(n => n.getAttribute('display') !== 'none');
  assert.equal(paths.length, 1);
  assert.match(paths[0].getAttribute('d'), /^M7\.27 32\.73A18 18 0 0 1 20\.00 2\.00$/);
  assert.equal(paths[0].getAttribute('vector-effect'), 'non-scaling-stroke');
  assert.ok(pow.el.classList.contains('wk-modded'));
  pow.setMod(null);
  assert.equal(pow.el.classList.contains('wk-modded'), false);
  // touch long-press: contextmenu, and the click that follows is swallowed
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let menus = 0;
    d.body.addEventListener('contextmenu', () => menus++);
    const n = st.calls.length;
    ptr(btn.el, 'pointerdown', 5, 5, { pointerType: 'touch' });
    mock.timers.tick(500);
    assert.equal(menus, 1);
    ptr(btn.el, 'pointerup', 5, 5, { pointerType: 'touch' });
    fire(btn.el, 'click');
    assert.equal(st.calls.length, n);
    ptr(btn.el, 'pointerdown', 5, 5, { pointerType: 'touch' });
    mock.timers.tick(100);
    ptr(btn.el, 'pointerup', 5, 5, { pointerType: 'touch' });
    fire(btn.el, 'click');
    assert.equal(st.calls.length, n + 1);
  } finally {
    mock.timers.reset();
  }
  pow.destroy();
  assert.equal(pow.el.parentNode, null);
});

test('contextMenu: structure, placement, mouse picking', () => {
  const d = fresh();
  const log = [];
  const items = [
    { label: 'Bypass Modulator: LFO 1', checked: false, action: () => log.push('byp') },
    { label: 'Remove All Modulators', action: () => log.push(['rm', byCls(d.body, 'wk-ctx').length]) },
    { sep: true },
    { label: 'Locked', disabled: true, action: () => log.push('dis') },
    { label: 'Mod Source', sub: [{ label: 'Env 1', action: () => log.push('env1') }, { label: 'LFO 1', checked: true, action: () => log.push('lfo1') }] },
  ];
  const m = wk.contextMenu(100, 200, items);
  const menus = () => byCls(d.body, 'wk-ctx');
  assert.equal(menus().length, 1);
  const root = menus()[0];
  assert.equal(m.el, root);
  assert.equal(root.getAttribute('role'), 'menu');
  assert.equal(root.style.left, '100px');
  assert.equal(root.style.top, '200px');
  const rows = root.children;
  assert.deepEqual(rows.map(r => r.getAttribute('role')), ['menuitemcheckbox', 'menuitem', 'separator', 'menuitem', 'menuitem']);
  assert.equal(rows[0].getAttribute('aria-checked'), 'false');
  assert.equal(one(rows[0], 'wk-cl').textContent, 'Bypass Modulator: LFO 1');
  assert.equal(rows[3].getAttribute('aria-disabled'), 'true');
  assert.equal(rows[4].getAttribute('aria-haspopup'), 'menu');
  assert.equal(rows[4].getAttribute('aria-expanded'), 'false');
  // a click without a pointerdown inside the menu (the release of the gesture that opened it) is ignored
  fire(rows[1], 'click');
  assert.deepEqual(log, []);
  ptr(rows[3], 'pointerdown', 0, 0); fire(rows[3], 'click'); // disabled
  assert.deepEqual(log, []);
  assert.equal(menus().length, 1);
  // hover opens the submenu next to the item, hovering elsewhere closes it
  rows[4]._rect = { left: 100, top: 300, width: 180, height: 24 };
  fire(rows[4], 'pointerenter', { bubbles: false });
  assert.equal(menus().length, 2);
  assert.equal(rows[4].getAttribute('aria-expanded'), 'true');
  const sub = menus()[1];
  assert.equal(sub.style.left, '278px');
  assert.equal(sub.style.top, '296px');
  assert.equal(sub.children[1].getAttribute('aria-checked'), 'true');
  assert.equal(one(sub.children[1], 'wk-ck').textContent, '✓');
  fire(rows[0], 'pointerenter', { bubbles: false });
  assert.equal(menus().length, 1);
  fire(rows[4], 'pointerenter', { bubbles: false });
  ptr(menus()[1].children[0], 'pointerdown', 0, 0);
  fire(menus()[1].children[0], 'click');
  assert.deepEqual(log, ['env1']);
  assert.equal(menus().length, 0);
  // the action runs after the menu is gone
  const m2 = wk.contextMenu(100, 200, items);
  ptr(m2.el.children[1], 'pointerdown', 0, 0); fire(m2.el.children[1], 'click');
  assert.deepEqual(log.at(-1), ['rm', 0]);
  // placement near the edges: flip left of the pointer, shift up
  const m3 = wk.contextMenu(1270, 790, items);
  assert.equal(m3.el.style.left, '1230px');
  assert.equal(m3.el.style.top, '750px');
  m3.close(); m3.close();
  assert.equal(menus().length, 0);
});

test('contextMenu: keyboard navigation, submenus, Escape levels, focus return', () => {
  const d = fresh();
  const log = [];
  const anchor = mkKnob().el; // the real flow: a kit widget dispatches contextmenu, the owner opens the menu
  d.body.addEventListener('contextmenu', e => wk.contextMenu(e.clientX, e.clientY, items, { anchor: e.target }));
  const items = [
    { label: 'Reset Control', action: () => log.push('reset') },
    { sep: true },
    { label: 'Hidden', disabled: true },
    { label: 'Mod Source', sub: [{ label: 'Env 1', action: () => log.push('env1') }, { label: 'LFO 1', action: () => log.push('lfo1') }] },
    { label: 'Remove All Modulators', action: () => log.push('rm') },
  ];
  anchor.focus();
  key(anchor, 'ContextMenu');
  const menus = () => byCls(d.body, 'wk-ctx');
  const root = menus()[0];
  assert.equal(d.activeElement, root.children[0]); // keyboard: first item focused
  key(d.activeElement, 'ArrowDown'); // skips separator and disabled
  assert.equal(d.activeElement, root.children[3]);
  key(d.activeElement, 'ArrowUp');
  assert.equal(d.activeElement, root.children[0]);
  key(d.activeElement, 'ArrowUp'); // wraps
  assert.equal(d.activeElement, root.children[4]);
  key(d.activeElement, 'm'); // first-letter jump
  assert.equal(d.activeElement, root.children[3]);
  key(d.activeElement, 'ArrowRight');
  assert.equal(menus().length, 2);
  assert.equal(d.activeElement, menus()[1].children[0]);
  key(d.activeElement, 'End');
  assert.equal(d.activeElement, menus()[1].children[1]);
  key(d.activeElement, 'Escape'); // closes the submenu only
  assert.equal(menus().length, 1);
  assert.equal(d.activeElement, root.children[3]);
  key(d.activeElement, 'Enter'); // Enter on a submenu item opens it
  assert.equal(menus().length, 2);
  key(d.activeElement, 'ArrowLeft');
  assert.equal(menus().length, 1);
  key(d.activeElement, 'ArrowRight'); key(d.activeElement, 'ArrowDown'); key(d.activeElement, ' ');
  assert.deepEqual(log, ['lfo1']);
  assert.equal(menus().length, 0);
  assert.equal(d.activeElement, anchor);
  // Escape at the root closes and returns focus
  key(anchor, 'ContextMenu');
  key(d.activeElement, 'Escape');
  assert.equal(menus().length, 0);
  assert.equal(d.activeElement, anchor);
  // mouse-opened: the menu itself has focus, ArrowDown enters it
  advance(1000); // (a trusted contextmenu within 700 ms of the synthesised one would be swallowed as a duplicate)
  ptr(anchor, 'pointerdown', 0, 0, { button: 2 });
  fire(anchor, 'contextmenu', { isTrusted: true, clientX: 3, clientY: 4 });
  assert.equal(menus().length, 1);
  assert.equal(d.activeElement, menus()[0]);
  key(menus()[0], 'ArrowDown');
  assert.equal(d.activeElement, menus()[0].children[0]);
  key(d.activeElement, 'Tab');
  assert.equal(menus().length, 0);
});

test('contextMenu: closes on outside click, scroll, resize, window blur, and a new menu', () => {
  const d = fresh();
  const count = () => byCls(d.body, 'wk-ctx').length;
  const items = [{ label: 'A', sub: [{ label: 'B' }] }];
  let m = wk.contextMenu(0, 0, items);
  ptr(m.el.children[0], 'pointerdown', 0, 0);
  assert.equal(count(), 1);
  ptr(d.body, 'pointerdown', 0, 0);
  assert.equal(count(), 0);
  m = wk.contextMenu(0, 0, items);
  fire(m.el, 'scroll', { bubbles: false }); // scrolling the menu itself
  assert.equal(count(), 1);
  fire(d, 'scroll', { bubbles: true });
  assert.equal(count(), 0);
  wk.contextMenu(0, 0, items); fire(d.defaultView, 'resize');
  assert.equal(count(), 0);
  wk.contextMenu(0, 0, items); fire(d.defaultView, 'blur');
  assert.equal(count(), 0);
  m = wk.contextMenu(0, 0, items);
  fire(m.el.children[0], 'pointerenter', { bubbles: false });
  assert.equal(count(), 2);
  wk.contextMenu(5, 5, [{ label: 'C' }]);
  assert.equal(count(), 1);
  assert.equal(one(byCls(d.body, 'wk-ctx')[0], 'wk-cl').textContent, 'C');
  // a right-click on the menu does not open the browser's menu
  assert.ok(fire(byCls(d.body, 'wk-ctx')[0], 'contextmenu').defaultPrevented);
  ptr(d.body, 'pointerdown', 0, 0);
  assert.equal(d.defaultView.listenerCount('scroll') + d.defaultView.listenerCount('resize') + d.defaultView.listenerCount('blur'), 0);
});

test('tooltip: hover delay, keyboard focus, prefs, empty text', () => {
  const d = fresh();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const el = d.createElement('div');
    d.body.appendChild(el);
    let text = 'CUTOFF: 425 Hz\nLFO 1 +50% ->';
    const tt = wk.tooltip(el, () => text);
    const tip = () => d.getElementById('wk-tip');
    fire(el, 'pointerenter', { bubbles: false });
    mock.timers.tick(449);
    assert.ok(!tip() || !tip().classList.contains('wk-show'));
    mock.timers.tick(1);
    assert.ok(tip().classList.contains('wk-show'));
    assert.equal(tip().textContent, text);
    assert.equal(tip().getAttribute('role'), 'tooltip');
    assert.equal(el.getAttribute('aria-describedby'), 'wk-tip');
    text = 'CUTOFF: 1 kHz'; tt.update();
    assert.equal(tip().textContent, 'CUTOFF: 1 kHz');
    fire(el, 'pointerleave', { bubbles: false });
    assert.equal(tip().classList.contains('wk-show'), false);
    assert.equal(el.hasAttribute('aria-describedby'), false);
    fire(el, 'pointerenter', { bubbles: false, pointerType: 'touch' });
    mock.timers.tick(1000);
    assert.equal(tip().classList.contains('wk-show'), false);
    // keyboard focus shows at once, blur hides
    el.tabIndex = 0;
    key(d.body, 'Tab');
    el.focus();
    assert.ok(tip().classList.contains('wk-show'));
    el.blur();
    assert.equal(tip().classList.contains('wk-show'), false);
    // prefs off, empty text
    wk.setPrefs({ tooltips: 0 });
    fire(el, 'pointerenter', { bubbles: false }); mock.timers.tick(500);
    assert.equal(tip().classList.contains('wk-show'), false);
    wk.setPrefs({ tooltips: 1 });
    text = '';
    fire(el, 'pointerenter', { bubbles: false }); mock.timers.tick(500);
    assert.equal(tip().classList.contains('wk-show'), false);
    tt.destroy();
    text = 'x';
    fire(el, 'pointerenter', { bubbles: false }); mock.timers.tick(500);
    assert.equal(tip().classList.contains('wk-show'), false);
  } finally {
    mock.timers.reset();
  }
});

test('loadDSP: once per document and path, ordered, never rejects, null for failures', async () => {
  const warn = console.warn;
  const warned = [];
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    delete globalThis.SerumDSP; delete globalThis.FXDSP;
    const d = fresh();
    const p1 = wk.loadDSP(['serum-dsp.js?v=5', 'fx-dsp.js?v=5']);
    assert.equal(d.scripts.length, 2);
    assert.deepEqual(d.scripts.map(s => [s.src, s.async, s.parentNode === d.head]), [['serum-dsp.js?v=5', false, true], ['fx-dsp.js?v=5', false, true]]);
    const p2 = wk.loadDSP(); // same paths without the cache-buster: no new scripts
    const p3 = wk.loadDSP(['./serum-dsp.js?v=9']);
    assert.equal(d.scripts.length, 2);
    const S = Object.freeze({ id: 'S' });
    globalThis.SerumDSP = S;
    fire(d.scripts[0], 'load', { bubbles: false });
    assert.deepEqual(await p3, { SerumDSP: S, FXDSP: null });
    fire(d.scripts[1], 'error', { bubbles: false }); // missing file
    assert.deepEqual(await p1, { SerumDSP: S, FXDSP: null });
    assert.deepEqual(await p2, { SerumDSP: S, FXDSP: null });
    assert.equal(warned.length, 1);
    assert.match(warned[0], /fx-dsp\.js\?v=5/);
    // the document remembers: later calls inject nothing and resolve at once
    assert.deepEqual(await wk.loadDSP(['fx-dsp.js?v=6']), { SerumDSP: S, FXDSP: null });
    assert.equal(d.scripts.length, 2);
    // already-present globals (static <script> tags): no injection
    const d2 = fresh();
    assert.deepEqual(await wk.loadDSP(['serum-dsp.js']), { SerumDSP: S, FXDSP: null });
    assert.equal(d2.scripts.length, 0);
    // a script whose body failed (IIFE sets the global to null) and one that hangs (timeout)
    delete globalThis.SerumDSP;
    const d3 = fresh();
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const p4 = wk.loadDSP();
      globalThis.SerumDSP = null;
      fire(d3.scripts[0], 'load', { bubbles: false });
      mock.timers.tick(19999);
      let done = false;
      p4.then(() => { done = true; });
      await Promise.resolve(); await Promise.resolve();
      assert.equal(done, false);
      mock.timers.tick(1);
      assert.deepEqual(await p4, { SerumDSP: null, FXDSP: null });
    } finally {
      mock.timers.reset();
    }
    // a document whose createElement throws still resolves
    const d4 = fresh();
    d4.createElement = () => { throw new Error('blocked'); };
    delete globalThis.SerumDSP;
    assert.deepEqual(await wk.loadDSP(['serum-dsp.js']), { SerumDSP: null, FXDSP: null });
  } finally {
    console.warn = warn;
    delete globalThis.SerumDSP; delete globalThis.FXDSP;
  }
});

/* ------------------------------------------------------------------ M2 widgets */
function mkNb(extra = {}) {
  const st = { n: 4 / 7, calls: [] };
  const w = wk.numBox(Object.assign({ dest: 'fx.hyper.unison', label: 'UNISON', steps: 7, get: () => st.n,
    set: (n, ph) => { st.n = n; st.calls.push([ph, n]); }, def: 4 / 7, fmt: n => String(Math.round(n * 7)) }, extra));
  document.body.appendChild(w.el);
  return { w, st, el: w.el };
}

test('numBox: DOM, aria, drag 8 px per step, phases, clamp, min/max', () => {
  fresh();
  const { w, st, el } = mkNb();
  assert.equal(el.wk, w);
  assert.equal(el.getAttribute('data-dest'), 'fx.hyper.unison');
  assert.equal(el.getAttribute('role'), 'spinbutton');
  assert.equal(el.getAttribute('aria-label'), 'UNISON');
  assert.deepEqual(['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext'].map(k => el.getAttribute(k)), ['0', '7', '4', '4']);
  assert.equal(one(el, 'wk-nbt').textContent, '4');
  ptr(el, 'pointerdown', 0, 100);
  assert.deepEqual(st.calls, [['start', 4 / 7]]);
  ptr(el, 'pointermove', 0, 93);
  assert.equal(st.calls.length, 1);
  ptr(el, 'pointermove', 0, 92);
  assert.equal(st.n, 5 / 7);
  ptr(el, 'pointermove', 50, 92); // horizontal movement does not count
  assert.equal(st.n, 5 / 7);
  ptr(el, 'pointermove', 0, 0);
  assert.equal(st.n, 1);
  ptr(el, 'pointermove', 0, 8); // no dead zone past the end
  assert.equal(st.n, 6 / 7);
  ptr(el, 'pointerup', 0, 8);
  assert.deepEqual(st.calls.at(-1), ['end', 6 / 7]);
  assert.ok(st.calls.slice(1, -1).every(c => c[0] === 'move'));
  // bounds in n
  const b = mkNb({ min: 2 / 7, max: 5 / 7 });
  b.st.n = 2 / 7; b.w.update();
  assert.deepEqual([b.el.getAttribute('aria-valuemin'), b.el.getAttribute('aria-valuemax')], ['2', '5']);
  b.el.focus();
  key(b.el, 'ArrowDown');
  assert.equal(b.st.n, 2 / 7);
  key(b.el, 'End');
  assert.equal(b.st.n, 5 / 7);
  // large grids: a full sweep is 800 px
  const g = mkNb({ steps: 4800, fmt: n => (n * 48).toFixed(2) });
  g.st.n = 0;
  ptr(g.el, 'pointerdown', 0, 800);
  ptr(g.el, 'pointermove', 0, 0);
  assert.equal(g.st.n, 1);
  ptr(g.el, 'pointerup', 0, 0);
});

test('numBox: keys, wheel, reset, typed entry with the inverse of fmt, disabled, setMod bar', () => {
  fresh();
  const { st, el, w } = mkNb();
  el.focus();
  key(el, 'ArrowUp');
  assert.equal(st.n, 5 / 7);
  key(el, 'PageDown'); // max(1, round(7 / 10)) = 1 step
  assert.equal(st.n, 4 / 7);
  key(el, 'Home');
  assert.equal(st.n, 0);
  key(el, 'Delete');
  assert.equal(st.n, 4 / 7);
  fire(el, 'wheel', { deltaY: -1, deltaMode: 1 });
  assert.equal(st.n, 5 / 7);
  ptr(el, 'pointerdown', 0, 0, { metaKey: true });
  assert.equal(st.n, 4 / 7);
  key(el, 'Enter');
  const inp = one(el, 'wk-in');
  assert.ok(inp);
  assert.equal(inp.value, '4');
  inp.value = '6';
  key(inp, 'Enter');
  assert.equal(st.n, 6 / 7);
  assert.equal(one(el, 'wk-in'), null);
  fire(el, 'dblclick');
  one(el, 'wk-in').value = ' 2 ';
  fire(one(el, 'wk-in'), 'blur');
  assert.equal(st.n, 2 / 7);
  // custom parse
  const p = mkNb({ parse: t => (t === 'max' ? 1 : null) });
  p.el.focus(); key(p.el, 'Enter');
  one(p.el, 'wk-in').value = 'max'; key(one(p.el, 'wk-in'), 'Enter');
  assert.equal(p.st.n, 1);
  // setMod draws the underline bar on the value box
  w.setMod({ arcs: [{ from: 0.2, to: 0.6, kind: 'sel' }], live: 0.4 });
  const seg = byCls(el, 'wk-mseg')[0];
  assert.equal(seg.className, 'wk-mseg k-sel');
  assert.equal(seg.style.left, '20.00%');
  assert.equal(seg.style.width, '40.00%');
  assert.ok(el.classList.contains('wk-modded'));
  w.setMod(null);
  assert.equal(el.classList.contains('wk-modded'), false);
  const d = mkNb({ disabled: () => true });
  const n0 = d.st.calls.length;
  ptr(d.el, 'pointerdown', 0, 0); key(d.el, 'ArrowUp');
  assert.equal(d.st.calls.length, n0);
  assert.equal(d.el.getAttribute('aria-disabled'), 'true');
});

test('seg: radio semantics, roving tabindex, arrows wrap, click, items as a function, setMod', () => {
  const d = fresh();
  const st = { i: 1, calls: [] };
  let labels = ['Normal', 'Ping-Pong', 'Tap->Delay'];
  const s = wk.seg({ dest: 'fx.dly.mode', label: 'MODE', items: () => labels, get: () => st.i, set: (i, ph) => { st.i = i; st.calls.push([ph, i]); } });
  d.body.appendChild(s.el);
  assert.equal(s.el.wk, s);
  assert.equal(s.el.getAttribute('role'), 'radiogroup');
  assert.equal(s.el.getAttribute('data-dest'), 'fx.dly.mode');
  const btns = () => byCls(s.el, 'wk-sb');
  assert.deepEqual(btns().map(b => [b.textContent, b.getAttribute('role'), b.getAttribute('aria-checked'), b.tabIndex]),
    [['Normal', 'radio', 'false', -1], ['Ping-Pong', 'radio', 'true', 0], ['Tap->Delay', 'radio', 'false', -1]]);
  fire(btns()[2], 'click');
  assert.deepEqual(st.calls, [['set', 2]]);
  assert.equal(btns()[2].getAttribute('aria-checked'), 'true');
  key(btns()[2], 'ArrowRight'); // wraps
  assert.equal(st.i, 0);
  assert.equal(d.activeElement, btns()[0]);
  key(btns()[0], 'ArrowLeft');
  assert.equal(st.i, 2);
  key(btns()[2], 'Home');
  assert.equal(st.i, 0);
  fire(btns()[0], 'click'); // same value: no call
  assert.equal(st.calls.length, 4);
  labels = ['A', 'B'];
  s.update();
  assert.deepEqual(btns().map(b => b.textContent), ['A', 'B']);
  s.setMod({ arcs: [{ from: 0, to: 0.5, kind: 'neg' }] });
  assert.equal(byCls(s.el, 'wk-mseg')[0].className, 'wk-mseg k-neg');
  // ContextMenu key on a segment dispatches one contextmenu that bubbles to the group
  let ctx = 0;
  s.el.addEventListener('contextmenu', () => ctx++);
  key(btns()[0], 'ContextMenu');
  assert.equal(ctx, 1);
});

test('slider: horizontal / vertical, grab vs jump, Shift, keys, reset, typed entry, bipolar fill, vertical bar', () => {
  const d = fresh();
  const st = { n: 0.5, calls: [] };
  const s = wk.slider({ dest: 'fx.cmp.mbH', label: 'H', get: () => st.n, set: (n, ph) => { st.n = n; st.calls.push([ph, n]); }, def: 0.5, fmt: n => Math.round(n * 200) + '%' });
  d.body.appendChild(s.el);
  const trk = one(s.el, 'wk-slt');
  trk._rect = { left: 100, top: 0, width: 200, height: 10 };
  assert.equal(s.el.getAttribute('role'), 'slider');
  assert.equal(s.el.getAttribute('aria-orientation'), 'horizontal');
  assert.equal(one(s.el, 'wk-num').textContent, '100%');
  assert.equal(one(s.el, 'wk-slf').style.width, '50.00%');
  ptr(s.el, 'pointerdown', 202, 5); // on the thumb (within 8 px): relative drag, no jump
  assert.deepEqual(st.calls, [['start', 0.5]]);
  ptr(s.el, 'pointermove', 222, 5);
  near(st.n, 0.6);
  ptr(s.el, 'pointermove', 322, 5, { shiftKey: true }); // 100 px fine
  near(st.n, 0.65);
  ptr(s.el, 'pointerup', 322, 5);
  assert.equal(st.calls.at(-1)[0], 'end');
  st.calls.length = 0;
  ptr(s.el, 'pointerdown', 120, 5); // elsewhere: jump to 0.1, then relative
  near(st.n, 0.1);
  assert.deepEqual(st.calls.map(c => c[0]), ['start', 'move']);
  ptr(s.el, 'pointermove', 140, 5);
  near(st.n, 0.2);
  ptr(s.el, 'pointerup', 140, 5);
  s.el.focus();
  key(s.el, 'ArrowRight'); near(st.n, 0.21);
  key(s.el, 'End'); assert.equal(st.n, 1);
  key(s.el, 'Backspace'); assert.equal(st.n, 0.5);
  key(s.el, 'Enter');
  one(s.el, 'wk-in').value = '25';
  key(one(s.el, 'wk-in'), 'Enter');
  assert.equal(st.n, 0.25);
  // bipolar fill from the centre; vertical orientation uses bottom/height
  const vs = { n: 0.25 };
  const v = wk.slider({ orient: 'v', bipolar: true, get: () => vs.n, set: n => { vs.n = n; }, def: 0.5 });
  d.body.appendChild(v.el);
  assert.equal(v.el.getAttribute('aria-orientation'), 'vertical');
  const f = one(v.el, 'wk-slf');
  assert.deepEqual([f.style.bottom, f.style.height], ['25.00%', '25.00%']);
  assert.equal(one(v.el, 'wk-slk').style.bottom, '25.00%');
  one(v.el, 'wk-slt')._rect = { left: 0, top: 0, width: 12, height: 100 };
  ptr(v.el, 'pointerdown', 6, 10); // jump to 0.9 (from the bottom)
  near(vs.n, 0.9);
  ptr(v.el, 'pointermove', 6, 30);
  near(vs.n, 0.7);
  ptr(v.el, 'pointerup', 6, 30);
  v.setMod({ arcs: [{ from: 0.2, to: 0.4, kind: 'other' }], live: 0.3 });
  const ms = one(v.el, 'wk-mseg');
  assert.ok(one(v.el, 'wk-modbar').classList.contains('wk-vbar'));
  assert.deepEqual([ms.style.bottom, ms.style.height], ['20.00%', '20.00%']);
  assert.equal(one(v.el, 'wk-mlive').style.bottom, '30.00%');
});

test('knob: steps / detents / label as functions (BPM-synced rate, reverb labels)', () => {
  fresh();
  let bpm = 0, label = 'SIZE';
  const { st, el, k } = mkKnob({ steps: () => (bpm ? 30 : 0), label: () => label });
  st.n = 0.5; k.update();
  el.focus();
  key(el, 'ArrowUp');
  near(st.n, 0.51);
  bpm = 1;
  key(el, 'ArrowUp');
  assert.equal(st.n, 16 / 30); // snapped to the 31-entry ladder
  label = 'DECAY'; k.update();
  assert.equal(one(el, 'wk-lab').textContent, 'DECAY');
  assert.equal(el.getAttribute('aria-label'), 'DECAY');
  let dets = [0.75];
  const d2 = mkKnob({ detents: () => dets });
  ptr(d2.el, 'pointerdown', 0, 100);
  ptr(d2.el, 'pointermove', 0, 51);
  assert.equal(d2.st.n, 0.75);
  ptr(d2.el, 'pointerup', 0, 51);
  dets = null;
  d2.st.n = 0.5; d2.k.update();
  ptr(d2.el, 'pointerdown', 0, 100);
  ptr(d2.el, 'pointermove', 0, 51);
  near(d2.st.n, 0.745);
  ptr(d2.el, 'pointerup', 0, 51);
});

test('toggle: text-less LED keeps its aria-label', () => {
  fresh();
  const t = wk.toggle({ dest: 'fx.dist.on', label: 'Distortion on', text: '', kind: 'led', get: () => 1, set() {} });
  assert.equal(t.el.getAttribute('aria-label'), 'Distortion on');
  assert.equal(one(t.el, 'wk-tl'), null);
  assert.ok(one(t.el, 'wk-dot'));
  assert.equal(t.el.getAttribute('data-dest'), 'fx.dist.on');
});

test('infrastructure: menuSource, fireContext, theme, fitCanvas, frame, ask, saveFile/pickFile guards', async () => {
  const d = fresh();
  const el = d.createElement('div');
  el.tabIndex = 0;
  d.body.appendChild(el);
  let n = 0;
  el.addEventListener('contextmenu', () => n++);
  const off = wk.menuSource(el);
  key(el, 'F10', { shiftKey: true });
  assert.equal(n, 1);
  wk.fireContext(el, 10, 10);
  assert.equal(n, 2);
  off();
  key(el, 'ContextMenu');
  assert.equal(n, 2);
  const kOff = wk.menuSource(el, { keys: false });
  key(el, 'ContextMenu');
  assert.equal(n, 2);
  kOff();
  // theme falls back to the §9.1 tokens when no computed style is available
  const T = wk.theme(el);
  assert.equal(T.accent, '#4fb3ff');
  assert.equal(T.bg, '#0f1216');
  d.defaultView.getComputedStyle = () => ({ getPropertyValue: k => (k === '--sx-accent' ? ' #123456 ' : '') });
  assert.equal(wk.theme(el).accent, '#123456');
  // canvas sizing at the device pixel ratio
  const cv = d.createElement('canvas');
  d.defaultView.devicePixelRatio = 2;
  const ctx = wk.fitCanvas(cv, 100, 50);
  assert.deepEqual([cv.width, cv.height], [200, 100]);
  assert.deepEqual(ctx.calls.at(-1), ['setTransform', 2, 0, 0, 2, 0, 0]);
  assert.equal(wk.fitCanvas(d.createElement('div'), 10, 10), null);
  // frame(): requestAnimationFrame when present, else an unref'd timeout; cancel works
  let hit = 0;
  const cancel = wk.frame(() => hit++);
  cancel();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(hit, 0);
  wk.frame(() => hit++);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(hit, 1);
  // prompt-based ask(); no prompt → null
  assert.equal(wk.ask('Name?'), null);
  globalThis.prompt = (m, def) => 'x' + def;
  assert.equal(wk.ask('Name?', 'y'), 'xy');
  delete globalThis.prompt;
  assert.equal(typeof wk.reducedMotion(), 'boolean');
  // saveFile without Blob URLs degrades to false; pickFile resolves on cancel
  const oc = URL.createObjectURL;
  URL.createObjectURL = undefined;
  assert.equal(wk.saveFile('a.json', '{}'), false);
  URL.createObjectURL = oc;
  const pf = wk.pickFile('.json');
  const inp = all(d.body).find(x => x.localName === 'input' && x.type === 'file');
  assert.ok(inp);
  fire(inp, 'cancel', { bubbles: false });
  assert.equal(await pf, null);
});

test('injectStyles: rack and editor CSS ship with the kit', () => {
  const d = fresh();
  const css = wk.injectStyles(d).textContent;
  for (const sel of ['.wk-nb', '.wk-seg', '.wk-sl', '.gx-root', '.fxr-root', '.fxr-tile', '.fxr-ins', '.fxr-mod', '.fxr-xpop', '@media (max-width: 700px)']) assert.ok(css.includes(sel), sel);
  assert.match(css, /\.fxr-root \[hidden\] \{ display: none !important; \}/);
});

test('live marker (§9.4): every widget hides it while |live − base| ≤ 0.002; m.base overrides the widget’s own n', () => {
  fresh();
  const arcs = [{ from: 0.4, to: 0.7, kind: 'sel' }];
  const shown = el => { const b = one(el, 'wk-mlive'); return b.style.display !== 'none'; };
  // menu: base n = position of the current item (v = index here, as in fx-ui; serum-ui uses v = k / hi)
  const items = [0, 1, 2, 3, 4].map(v => ({ v, label: 'I' + v }));
  let mv = 2;
  const m = wk.menu({ dest: 'fx.dist.mode', label: 'MODE', items: () => items, get: () => mv, set: v => { mv = v; } });
  document.body.appendChild(m.el);
  m.setMod({ arcs, live: 0.5 });
  assert.equal(shown(m.el), false, 'menu: live = base');
  m.setMod({ arcs, live: 0.75 });
  assert.equal(shown(m.el), true, 'menu: live ≠ base');
  mv = 3; m.update(); // the base moved onto the live value: hidden again on refresh
  assert.equal(shown(m.el), false);
  const m2 = wk.menu({ label: 'X', items: () => items.map(it => ({ v: it.v / 4, label: it.label })), get: () => 0.25, set: () => {} });
  m2.setMod({ arcs, live: 0.25 });
  assert.equal(shown(m2.el), false, 'menu with v = n');
  // numBox / slider: base = num01(get())
  const nb = wk.numBox({ dest: 'fx.hyper.unison', label: 'UNI', steps: 7, get: () => 3 / 7, set: () => {} });
  nb.setMod({ arcs, live: 3 / 7 + 0.001 });
  assert.equal(shown(nb.el), false);
  nb.setMod({ arcs, live: 4 / 7 });
  assert.equal(shown(nb.el), true);
  const sl = wk.slider({ dest: 'fx.cmp.mbH', get: () => 0.6, set: () => {}, def: 0.5 });
  sl.setMod({ arcs, live: 0.6 });
  assert.equal(shown(sl.el), false);
  sl.setMod({ arcs, live: 0.9 });
  assert.equal(shown(sl.el), true);
  // seg: base = index / (count − 1)
  const sg = wk.seg({ dest: 'fx.dly.mode', items: ['A', 'B', 'C'], get: () => 1, set: () => {} });
  sg.setMod({ arcs, live: 0.5 });
  assert.equal(shown(sg.el), false);
  sg.setMod({ arcs, live: 1 });
  assert.equal(shown(sg.el), true);
  // toggle: base = 0 / 1
  let on = 1;
  const tg = wk.toggle({ dest: 'fx.cmp.mb', label: 'MB', get: () => on, set: v => { on = v; } });
  const live = () => byCls(tg.el, 'wk-live')[0];
  tg.setMod({ arcs, live: 1 });
  assert.equal(live().getAttribute('display'), 'none');
  tg.setMod({ arcs, live: 0 });
  assert.equal(live().hasAttribute('display'), false);
  on = 0; tg.update();
  assert.equal(live().getAttribute('display'), 'none');
  // explicit base (host knows better than the widget)
  sl.setMod({ arcs, live: 0.3, base: 0.3 });
  assert.equal(shown(sl.el), false);
  sl.setMod({ arcs, live: 0.6, base: 0.3 });
  assert.equal(shown(sl.el), true);
  // knob honours the same rule (and base)
  const { k } = mkKnob();
  k.setMod({ arcs, live: 0.5 });
  assert.equal(byCls(k.el, 'wk-live')[0].getAttribute('display'), 'none');
  k.setMod({ arcs, live: 0.5, base: 0.2 });
  assert.equal(byCls(k.el, 'wk-live')[0].hasAttribute('display'), false);
});

test('knob detents: windows shrink to 0.4 × the gap to the nearest detent (free travel between close detents)', () => {
  fresh();
  const R = [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 3, 4, 5, 6, 7, 8, 10, 16, 32].map(r => 1 - 1 / r).concat([1]);
  const { st, el } = mkKnob({ detents: R });
  st.n = 0.75; // 4:1
  ptr(el, 'pointerdown', 100, 300);
  const seen = new Set();
  for (let y = 299; y >= 250; y--) { ptr(el, 'pointermove', 100, y); seen.add(st.n); } // 250 px … up to n = 1
  ptr(el, 'pointerup', 100, 250);
  const free = [...seen].filter(n => n >= 0.78 && !R.some(v => Math.abs(v - n) < 1e-12));
  assert.ok(free.length >= 10, 'continuous values remain above 4:1: ' + free.length);
  for (const v of [0.8, 0.875, 0.9, 0.9375, 0.96875, 1]) assert.ok(seen.has(v), 'detent ' + v + ' still snaps');
  // inside a window: snaps; close detents (5:1 = 0.8, 6:1 ≈ 0.8333): window 0.4 × 0.0333 ≈ 0.0133
  st.n = 0.8 + 0.012; // 2.4 px above 5:1: snaps down to it on the next move
  ptr(el, 'pointerdown', 100, 300);
  ptr(el, 'pointermove', 100, 300 - 0.0001);
  assert.equal(st.n, 0.8);
  ptr(el, 'pointerup', 100, 300);
  st.n = 0.8 + 0.0145; // beyond the shrunken window (but inside the generic ±0.02): free
  ptr(el, 'pointerdown', 100, 300);
  ptr(el, 'pointermove', 100, 300 - 0.0001);
  assert.ok(Math.abs(st.n - 0.8145) < 1e-4);
  ptr(el, 'pointerup', 100, 300);
  // far-apart detents keep the generic ±4 px window (Delay OFFSET, §3.10: ±0.02)
  const o = mkKnob({ detents: [0.25, 0.5, 4 / 3 - 0.5, 1] });
  o.st.n = 0.5 + 0.019;
  ptr(o.el, 'pointerdown', 100, 300);
  ptr(o.el, 'pointermove', 100, 300 - 0.0001);
  assert.equal(o.st.n, 0.5);
  ptr(o.el, 'pointerup', 100, 300);
});

test('wheelGate: the widgets’ wheel rules for custom controls', () => {
  const d = fresh();
  const el = d.createElement('div');
  d.body.appendChild(el);
  const take = wk.wheelGate(el);
  fire(el, 'pointerenter', { bubbles: false });
  assert.equal(take(new (globalThis.MouseEvent)('wheel', { deltaY: 100 })), null); // just arrived
  advance(301);
  assert.equal(take(new (globalThis.MouseEvent)('wheel', { deltaY: 100 })), -1); // notch down
  assert.equal(take(new (globalThis.MouseEvent)('wheel', { deltaY: -1, deltaMode: 1 })), 1);
  assert.equal(take(new (globalThis.MouseEvent)('wheel', { deltaY: -25 })), 0); // trackpad: accumulating
  assert.equal(take(new (globalThis.MouseEvent)('wheel', { deltaY: -25 })), 1);
  assert.equal(take(new (globalThis.MouseEvent)('wheel', { deltaY: 0 })), null);
  wk.setPrefs({ wheel: 0 });
  assert.equal(take(new (globalThis.MouseEvent)('wheel', { deltaY: 100 })), null);
  wk.setPrefs({ wheel: 1 });
  take.destroy();
  assert.equal(el.listenerCount('pointerenter'), 0);
});
