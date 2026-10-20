// wk.js (E6) — widget kit tests. Node has no DOM: tests/wk-dom.mjs is a minimal fake DOM implementing exactly the
// surface the E6 modules use (elements, SVG, attributes, classList, style, events with capture/target/bubble
// phases, focus, pointer capture, bounding rects, canvas stubs). Run: node --test tests/
import './v8-guard.mjs';
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
// loadDSP resolves every global of the SPEC-serum2 §0.3 list; most checks look at the Phase-1 pair
const DSP_GLOBAL_NAMES = ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrSeq', 'ModCore'];
const two = r => ({ SerumDSP: r.SerumDSP, FXDSP: r.FXDSP });

test('imports and degrades without a DOM', () => {
  assert.deepEqual(noDom.dsp, Object.fromEntries(DSP_GLOBAL_NAMES.map(k => [k, null])));
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
    // touch has no hover: tooltip.textOf gives a status line the text of the touched element or its nearest ancestor
    const inner = d.createElement('span');
    el.appendChild(inner);
    assert.equal(wk.tooltip.textOf(inner), 'CUTOFF: 1 kHz');
    assert.equal(wk.tooltip.textOf(el), 'CUTOFF: 1 kHz');
    assert.equal(wk.tooltip.textOf(d.body), '');
    assert.equal(wk.tooltip.textOf(null), '');
    const bad = d.createElement('i');
    wk.tooltip(bad, () => { throw new Error('no'); });
    assert.equal(wk.tooltip.textOf(bad), '');
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
    const p1 = wk.loadDSP(['serum-dsp.js?v=9', 'fx-dsp.js?v=9']);
    assert.equal(d.scripts.length, 2);
    assert.deepEqual(d.scripts.map(s => [s.src, s.async, s.parentNode === d.head]), [['serum-dsp.js?v=9', false, true], ['fx-dsp.js?v=9', false, true]]);
    const p2 = wk.loadDSP(['serum-dsp.js', 'fx-dsp.js']); // same paths without the cache-buster: no new scripts
    const p3 = wk.loadDSP(['./serum-dsp.js?v=9']);
    assert.equal(d.scripts.length, 2);
    const S = Object.freeze({ id: 'S' });
    globalThis.SerumDSP = S;
    fire(d.scripts[0], 'load', { bubbles: false });
    assert.deepEqual(two(await p3), { SerumDSP: S, FXDSP: null });
    fire(d.scripts[1], 'error', { bubbles: false }); // missing file
    assert.deepEqual(two(await p1), { SerumDSP: S, FXDSP: null });
    assert.deepEqual(two(await p2), { SerumDSP: S, FXDSP: null });
    assert.equal(warned.length, 1);
    assert.match(warned[0], /fx-dsp\.js\?v=9/);
    // the document remembers: later calls inject nothing and resolve at once
    assert.deepEqual(two(await wk.loadDSP(['fx-dsp.js?v=9'])), { SerumDSP: S, FXDSP: null });
    assert.equal(d.scripts.length, 2);
    // already-present globals (static <script> tags): no injection
    const d2 = fresh();
    assert.deepEqual(two(await wk.loadDSP(['serum-dsp.js'])), { SerumDSP: S, FXDSP: null });
    assert.equal(d2.scripts.length, 0);
    // a script whose body failed (IIFE sets the global to null) and one that hangs (timeout)
    delete globalThis.SerumDSP;
    const d3 = fresh();
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const p4 = wk.loadDSP(['serum-dsp.js']);
      globalThis.SerumDSP = null;
      fire(d3.scripts[0], 'load', { bubbles: false });
      mock.timers.tick(19999);
      let done = false;
      p4.then(() => { done = true; });
      await Promise.resolve(); await Promise.resolve();
      assert.equal(done, false);
      mock.timers.tick(1);
      assert.deepEqual(two(await p4), { SerumDSP: null, FXDSP: null });
    } finally {
      mock.timers.reset();
    }
    // a document whose createElement throws still resolves
    const d4 = fresh();
    d4.createElement = () => { throw new Error('blocked'); };
    delete globalThis.SerumDSP;
    assert.deepEqual(two(await wk.loadDSP(['serum-dsp.js'])), { SerumDSP: null, FXDSP: null });
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

/* ------------------------------------------------- Phase-2 widgets (SPEC-serum2 §11.14, §13.1, §15.12) */
import { place } from './wk-dom.mjs';

test('§11.14 exports: the Phase-2 widgets and their pure maths', () => {
  for (const f of ['fader', 'meter', 'xyPad', 'rangeBar', 'pianoKeys', 'stepGrid', 'iconSeg', 'modifierBar', 'dragSource', 'longPress', 'zoomPan']) {
    assert.equal(typeof wk[f], 'function', f);
  }
  for (const [w, fs] of [['meter', ['pos']], ['fader', ['nAt']], ['rangeBar', ['norm', 'drag', 'parse']], ['pianoKeys', ['layout', 'hit', 'velocity', 'noteName']],
    ['stepGrid', ['valueAt']], ['zoomPan', ['zoom', 'pan']], ['modifierBar', ['mods', 'consume']], ['dragSource', ['edge']]]) {
    for (const f of fs) assert.equal(typeof wk[w][f], 'function', w + '.' + f);
  }
  // no DOM needed for the pure parts
  assert.equal(wk.longPress(null, { pointerType: 'mouse' }), null);
});

test('meter: dB scale, cover / peak hold / clip, stereo, reset', () => {
  const { pos } = wk.meter;
  assert.equal(pos(-60, -60, 6), 0);
  assert.equal(pos(-Infinity, -60, 6), 0);
  assert.equal(pos(NaN, -60, 6), 0);
  assert.equal(pos(6, -60, 6), 1);
  assert.equal(pos(12, -60, 6), 1);
  near(pos(0, -60, 6), 60 / 66);
  near(pos(-27, -60, 6), 0.5);
  const d = fresh();
  const m = wk.meter({ ch: 2, label: 'Main', hold: 1000 });
  d.body.appendChild(m.el);
  assert.equal(m.el.getAttribute('role'), 'meter');
  assert.equal(m.el.getAttribute('aria-label'), 'Main');
  const ch = byCls(m.el, 'wk-mch'), cov = byCls(m.el, 'wk-mcov'), pk = byCls(m.el, 'wk-mpk');
  assert.equal(ch.length, 2);
  assert.deepEqual(cov.map(c => c.style.height), ['100.00%', '100.00%']);
  assert.equal(m.el.style['--wk-m0'], (60 / 66 * 100).toFixed(2) + '%');
  m.set(-27, -60, 0);
  assert.deepEqual(cov.map(c => c.style.height), ['50.00%', '100.00%']);
  assert.equal(pk[0].style.bottom, '50.00%');
  assert.equal(pk[1].style.display, 'none');
  m.set(-60, null, 500); // a lower level: the peak holds (mono value feeds both channels)
  assert.equal(cov[0].style.height, '100.00%');
  assert.equal(pk[0].style.bottom, '50.00%');
  m.set(-60, -60, 1001); // hold expired
  assert.equal(pk[0].style.display, 'none');
  m.set(3, undefined, 1100);
  assert.ok(ch[0].classList.contains('wk-clip') && ch[1].classList.contains('wk-clip'));
  assert.deepEqual(m.levels(), [3, 3]);
  assert.equal(m.el.getAttribute('aria-valuenow'), '3');
  m.reset();
  assert.ok(!ch[0].classList.contains('wk-clip'));
  assert.deepEqual(m.levels(), [-Infinity, -Infinity]);
  const h = wk.meter({ orient: 'h' });
  d.body.appendChild(h.el);
  h.set(-27, null, 0);
  assert.ok(h.el.classList.contains('wk-mh'));
  assert.equal(one(h.el, 'wk-mcov').style.width, '50.00%');
  m.destroy();
  assert.equal(m.el.parentNode, null);
});

test('fader: dB mapping (fader.nAt), scale ticks, default text, meter, drag and data-dest', () => {
  // the Serum master law (pow3 of n, 0 dB at n = 1) and a linear-in-dB law
  const pow3 = n => (n <= 0 ? -Infinity : 60 * Math.log10(n));
  near(wk.fader.nAt(pow3, 0), 1, 1e-12);
  near(wk.fader.nAt(pow3, -6), Math.pow(10, -6 / 60), 1e-12);
  near(wk.fader.nAt(pow3, -24), Math.pow(10, -24 / 60), 1e-12);
  assert.equal(wk.fader.nAt(pow3, -Infinity), 0);
  assert.equal(wk.fader.nAt(pow3, 6), 1);
  const lin = n => -60 + 72 * n;
  near(wk.fader.nAt(lin, 0), 60 / 72, 1e-12);
  assert.equal(wk.fader.nAt(null, 0), 0);
  const d = fresh();
  const st = { n: 1, calls: [] };
  const f = wk.fader({ dest: 'g.master', label: 'MAIN', get: () => st.n, set: (n, ph) => { st.n = n; st.calls.push([ph, n]); }, def: 0.7, db: pow3, meter: true });
  d.body.appendChild(f.el);
  assert.equal(f.el.getAttribute('data-dest'), 'g.master');
  assert.equal(f.el.getAttribute('aria-orientation'), 'vertical');
  assert.ok(f.el.classList.contains('wk-fader'));
  assert.equal(one(f.el, 'wk-num').textContent, '0.0 dB');
  const ticks = byCls(f.el, 'wk-ftk');
  assert.deepEqual(ticks.map(t => t.textContent), ['0', '-6', '-12', '-24', '-48']); // +6 is outside the law's range
  assert.equal(ticks[1].style.bottom, (Math.pow(10, -6 / 60) * 100).toFixed(2) + '%');
  // the track sits in the row between the scale and the meter
  const row = one(f.el, 'wk-frow');
  assert.deepEqual(row.children.map(c => c.className.split(' ')[0]), ['wk-fsc', 'wk-slt', 'wk-meter']);
  f.meter(-27);
  assert.equal(one(f.el, 'wk-mcov').style.height, '50.00%');
  // a vertical slider underneath: jump + relative drag, phases
  place(one(f.el, 'wk-slt'), 0, 0, 8, 100);
  ptr(f.el, 'pointerdown', 4, 50);
  near(st.n, 0.5);
  ptr(f.el, 'pointermove', 4, 40);
  near(st.n, 0.6);
  ptr(f.el, 'pointerup', 4, 40);
  assert.deepEqual(st.calls.map(c => c[0]), ['start', 'move', 'move', 'end']);
  assert.equal(one(f.el, 'wk-num').textContent, (60 * Math.log10(0.6)).toFixed(1) + ' dB');
  st.n = 0;
  f.update();
  assert.equal(one(f.el, 'wk-num').textContent, '-inf dB');
  // without a law: no ticks, no meter call errors
  const g = wk.fader({ get: () => 0.5, set() {}, def: 0.5 });
  d.body.appendChild(g.el);
  assert.equal(byCls(g.el, 'wk-ftk').length, 0);
  g.meter(-6);
  assert.equal(one(g.el, 'wk-num').textContent, '50%');
  f.destroy();
  assert.equal(f.el.parentNode, null);
});

test('xyPad: rails carry the destinations, dot jumps and drags, Fine, keys, yDown, reset, setMod', () => {
  const d = fresh();
  setPlatform('Win32');                                           // Ctrl-click = reset (macOS: the context menu)
  const st = { x: 0.5, y: 0.5, calls: [] };
  const mkAx = k => ({ dest: 'a.' + k, label: k.toUpperCase(), get: () => st[k], set: (n, ph) => { st[k] = n; st.calls.push([k, ph, n]); }, def: 0.5, fmt: n => Math.round(n * 100) + '%' });
  const p = wk.xyPad({ label: 'X|Y', x: mkAx('x'), y: mkAx('y') });
  d.body.appendChild(p.el);
  const pad = one(p.el, 'wk-xyp'), dot = one(p.el, 'wk-xyd');
  place(pad, 100, 100, 100, 100);
  assert.equal(one(p.el, 'wk-xyrx').getAttribute('data-dest'), 'a.x');
  assert.equal(one(p.el, 'wk-xyry').getAttribute('data-dest'), 'a.y');
  assert.deepEqual([dot.getAttribute('data-xy'), dot.getAttribute('data-dest-x'), dot.getAttribute('data-dest-y')], ['1', 'a.x', 'a.y']);
  assert.equal(p.el.getAttribute('data-dest'), null);
  assert.equal(dot.getAttribute('aria-valuetext'), 'X 50%, Y 50%');
  assert.deepEqual([dot.style.left, dot.style.top], ['50.00%', '50.00%']);
  // press: jump (Y up), then relative drag
  ptr(pad, 'pointerdown', 120, 130);
  near(st.x, 0.2); near(st.y, 0.7);
  ptr(pad, 'pointermove', 130, 120);
  near(st.x, 0.3); near(st.y, 0.8);
  ptr(pad, 'pointerup', 130, 120);
  assert.deepEqual(st.calls.filter(c => c[0] === 'x').map(c => c[1]), ['start', 'move', 'move', 'end']);
  assert.deepEqual([dot.style.left, dot.style.top], ['30.00%', '20.00%']);
  // Shift: no jump, ×0.1
  st.calls.length = 0;
  ptr(pad, 'pointerdown', 190, 190, { shiftKey: true });
  near(st.x, 0.3);
  ptr(pad, 'pointermove', 200, 190, { shiftKey: true });
  near(st.x, 0.31);
  ptr(pad, 'pointerup', 200, 190);
  // keys on the dot
  key(dot, 'ArrowRight'); near(st.x, 0.32);
  key(dot, 'ArrowUp', { shiftKey: true }); near(st.y, 0.801);
  key(dot, 'PageDown'); near(st.y, 0.701);
  key(dot, 'Home'); assert.equal(st.x, 0);
  key(dot, 'Delete'); assert.deepEqual([st.x, st.y], [0.5, 0.5]);
  // Cmd/Ctrl-click resets too
  st.x = 0.1;
  ptr(pad, 'pointerdown', 150, 150, { ctrlKey: true });
  assert.equal(st.x, 0.5);
  // setMod: one bar per axis
  p.setMod({ x: { arcs: [{ from: 0.4, to: 0.6, kind: 'sel' }] }, y: null });
  assert.ok(p.el.classList.contains('wk-modded'));
  assert.equal(one(one(p.el, 'wk-xyrx'), 'wk-mseg').style.left, '40.00%');
  assert.equal(one(one(p.el, 'wk-xyry'), 'wk-mseg'), null);
  p.setMod(null);
  assert.ok(!p.el.classList.contains('wk-modded'));
  // each rail is a [data-dest] element with its own wk.setMod (panels paint halos by scanning data-dest)
  const rx = one(p.el, 'wk-xyrx'), ry = one(p.el, 'wk-xyry');
  assert.equal(typeof rx.wk.setMod, 'function');
  assert.equal(rx.wk.pad, p);
  ry.wk.setMod({ arcs: [{ from: 0.5, to: 0.9, kind: 'other' }], live: 0.8 });
  rx.wk.setMod({ arcs: [{ from: 0.2, to: 0.5, kind: 'sel' }] });
  assert.equal(one(ry, 'wk-mseg').style.bottom, '50.00%');      // the Y rail keeps its arcs when X is set
  assert.equal(one(ry, 'wk-mlive').style.bottom, '80.00%');
  assert.equal(one(rx, 'wk-mseg').style.left, '20.00%');
  rx.wk.setMod(null);
  assert.equal(one(rx, 'wk-mseg').style.display, 'none');
  assert.ok(p.el.classList.contains('wk-modded'));
  ry.wk.setMod(null);
  assert.ok(!p.el.classList.contains('wk-modded'));
  // yDown: Y = 0 at the top (PZ corners)
  const q = { x: 0, y: 0 };
  const p2 = wk.xyPad({ yDown: true, x: { get: () => q.x, set: n => { q.x = n; } }, y: { get: () => q.y, set: n => { q.y = n; } } });
  d.body.appendChild(p2.el);
  place(one(p2.el, 'wk-xyp'), 0, 0, 100, 100);
  ptr(one(p2.el, 'wk-xyp'), 'pointerdown', 25, 10);
  near(q.y, 0.1);
  assert.equal(one(p2.el, 'wk-xyd').style.top, '10.00%');
  ptr(one(p2.el, 'wk-xyp'), 'pointerup', 25, 10);
  key(one(p2.el, 'wk-xyd'), 'ArrowUp'); near(q.y, 0.09);
  // disabled ignores input
  const p3 = wk.xyPad({ disabled: () => true, x: { get: () => 0.5, set: () => assert.fail('set') }, y: { get: () => 0.5, set: () => assert.fail('set') } });
  d.body.appendChild(p3.el);
  ptr(one(p3.el, 'wk-xyp'), 'pointerdown', 10, 10);
  key(one(p3.el, 'wk-xyd'), 'ArrowLeft');
  assert.ok(p3.el.classList.contains('wk-dis'));
});

test('rangeBar: pure clamping (norm / drag) and typed parsing', () => {
  const { norm, drag, parse } = wk.rangeBar;
  assert.deepEqual(norm([10, 20], 0, 127), [10, 20]);
  assert.deepEqual(norm([20, 10], 0, 127), [10, 20]); // swapped (§2.2.5)
  assert.deepEqual(norm([-5, 300], 0, 127), [0, 127]);
  assert.deepEqual(norm([0, 64.6], 1, 127), [1, 65]);
  assert.deepEqual(norm(null, 1, 127), [1, 127]);
  assert.deepEqual(norm([NaN, 5], 0, 127), [0, 5]);
  assert.deepEqual(drag([10, 20], 'lo', 5, 0, 127), [15, 20]);
  assert.deepEqual(drag([10, 20], 'lo', 50, 0, 127), [20, 20]); // never past the other edge
  assert.deepEqual(drag([10, 20], 'lo', -50, 0, 127), [0, 20]);
  assert.deepEqual(drag([10, 20], 'hi', -50, 0, 127), [10, 10]);
  assert.deepEqual(drag([10, 20], 'hi', 500, 0, 127), [10, 127]);
  assert.deepEqual(drag([10, 20], 'body', 7.4, 0, 127), [17, 27]);
  assert.deepEqual(drag([10, 20], 'body', 500, 0, 127), [117, 127]); // width kept at the end of the domain
  assert.deepEqual(drag([10, 20], 'body', -500, 0, 127), [0, 10]);
  assert.deepEqual(drag([0, 127], 'body', 5, 0, 127), [0, 127]);
  for (let i = 0; i < 300; i++) { // fuzz: always integers inside the domain, lo ≤ hi
    const a = Math.round(Math.random() * 200 - 40), b = Math.round(Math.random() * 200 - 40), dv = Math.random() * 300 - 150;
    const r = drag([a, b], ['lo', 'hi', 'body'][i % 3], dv, 1, 127);
    assert.ok(Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 1 && r[1] <= 127 && r[0] <= r[1], JSON.stringify(r));
  }
  const nm = n => wk.pianoKeys.noteName(n);
  assert.deepEqual(parse('1–127', 1, 127), [1, 127]);
  assert.deepEqual(parse('40-20', 1, 127), [20, 40]);
  assert.deepEqual(parse('64', 1, 127), [64, 64]);
  assert.deepEqual(parse('0 200', 1, 127), [1, 127]);
  assert.deepEqual(parse('C1–G7', 0, 127, nm), [24, 103]);
  assert.deepEqual(parse('c-1-g7', 0, 127, nm), [0, 103]);
  assert.deepEqual(parse('C−1 to C8', 0, 127, nm), [0, 108]);
  assert.deepEqual(parse('C4', 0, 127, nm), [60, 60]);
  assert.equal(parse('', 0, 127), null);
  assert.equal(parse('lots', 0, 127), null);
  assert.equal(parse('1–2–3', 0, 127), null);
});

test('rangeBar: DOM, handles, body and outside presses, keys, typed entry', () => {
  const d = fresh();
  const st = { r: [10, 20], calls: [] };
  const rb = wk.rangeBar({ label: 'KEY', min: 0, max: 127, get: () => st.r, set: (r, ph) => { st.r = r; st.calls.push([ph, r.slice()]); }, fmt: n => wk.pianoKeys.noteName(n) });
  d.body.appendChild(rb.el);
  const trk = one(rb.el, 'wk-rbt'), body = one(rb.el, 'wk-rbb'), [hLo, hHi] = byCls(rb.el, 'wk-rbh');
  place(trk, 0, 0, 128, 20); // one px per cell
  assert.equal(one(rb.el, 'wk-rbv').textContent, 'A#-1–G#0');
  assert.deepEqual([body.style.left, body.style.width], [(10 / 128 * 100).toFixed(3) + '%', (11 / 128 * 100).toFixed(3) + '%']);
  assert.deepEqual([hLo.getAttribute('aria-valuenow'), hHi.getAttribute('aria-valuenow'), hHi.getAttribute('aria-valuemin')], ['10', '20', '10']);
  assert.equal(hLo.getAttribute('aria-label'), 'KEY start');
  // the lo edge (x = 10)
  ptr(trk, 'pointerdown', 10, 10);
  ptr(trk, 'pointermove', 15, 10);
  assert.deepEqual(st.r, [15, 20]);
  ptr(trk, 'pointermove', 40, 10);
  assert.deepEqual(st.r, [20, 20]);
  ptr(trk, 'pointerup', 40, 10);
  assert.deepEqual(st.calls.map(c => c[0]), ['start', 'move', 'move', 'end']);
  // the hi edge (x = 21 = right edge of cell 20)
  st.r = [10, 20]; rb.update();
  ptr(trk, 'pointerdown', 21, 10);
  ptr(trk, 'pointermove', 31, 10);
  ptr(trk, 'pointerup', 31, 10);
  assert.deepEqual(st.r, [10, 30]);
  // the body moves both
  ptr(trk, 'pointerdown', 20, 10);
  ptr(trk, 'pointermove', 15, 10);
  ptr(trk, 'pointerup', 15, 10);
  assert.deepEqual(st.r, [5, 25]);
  // a press outside moves the nearer edge there, then drags it
  st.calls.length = 0;
  ptr(trk, 'pointerdown', 100.5, 10);
  assert.deepEqual(st.r, [5, 100]);
  ptr(trk, 'pointermove', 110.5, 10);
  ptr(trk, 'pointerup', 110.5, 10);
  assert.deepEqual(st.r, [5, 110]);
  assert.deepEqual(st.calls.map(c => c[0]), ['start', 'move', 'move', 'end']);
  // keys on the handles: ±1, Shift ±12, Alt moves the body, Home / End
  key(hLo, 'ArrowRight'); assert.deepEqual(st.r, [6, 110]);
  key(hHi, 'ArrowLeft', { shiftKey: true }); assert.deepEqual(st.r, [6, 98]);
  key(hHi, 'ArrowRight', { altKey: true }); assert.deepEqual(st.r, [7, 99]);
  key(hLo, 'Home'); assert.deepEqual(st.r, [0, 99]);
  key(hHi, 'End'); assert.deepEqual(st.r, [0, 127]);
  // typed entry (Enter) with note names
  hLo.focus();
  key(hLo, 'Enter');
  const inp = one(rb.el, 'wk-in');
  assert.equal(inp.value, 'C-1–G9');
  inp.value = 'C1–G7';
  key(inp, 'Enter');
  assert.deepEqual(st.r, [24, 103]);
  key(hLo, 'Enter');
  one(rb.el, 'wk-in').value = 'nonsense';
  key(one(rb.el, 'wk-in'), 'Enter');
  assert.deepEqual(st.r, [24, 103]);
  assert.ok(hLo.classList.contains('wk-bad'));
  rb.setMod({ arcs: [{ from: 0.25, to: 0.5, kind: 'other' }] });
  assert.ok(rb.el.classList.contains('wk-modded'));
  assert.equal(one(rb.el, 'wk-mseg').style.left, '25.00%');
  rb.setMod(null);
  assert.ok(!rb.el.classList.contains('wk-modded'));
  // double-click types too; velocity rows (1–127) clamp
  const vs = { r: [1, 127] };
  const vb = wk.rangeBar({ min: 1, max: 127, get: () => vs.r, set: r => { vs.r = r; } });
  d.body.appendChild(vb.el);
  fire(one(vb.el, 'wk-rbt'), 'dblclick');
  one(vb.el, 'wk-in').value = '0-90';
  key(one(vb.el, 'wk-in'), 'Enter');
  assert.deepEqual(vs.r, [1, 90]);
});

test('pianoKeys: layout, hit and velocity maths', () => {
  const { layout, hit, velocity, noteName } = wk.pianoKeys;
  const L = layout(60, 71);
  assert.deepEqual([L.lo, L.hi, L.white, L.keys.length], [60, 71, 7, 12]);
  assert.deepEqual(L.keys.filter(k => k.black).map(k => k.note), [61, 63, 66, 68, 70]);
  assert.deepEqual(L.keys.find(k => k.note === 61), { note: 61, black: true, x: 0.7, w: 0.6 });
  const W = layout(61, 70); // widened to white keys
  assert.deepEqual([W.lo, W.hi], [60, 71]);
  assert.deepEqual([layout(0, 127).white, layout(0, 127).lo, layout(0, 127).hi], [75, 0, 127]);
  assert.equal(hit(L, 0.5, 0.9), 60);
  assert.equal(hit(L, 0.9, 0.3), 61); // black key on top
  assert.equal(hit(L, 0.9, 0.8), 60); // below the black key: the white one
  assert.equal(hit(L, 6.5, 0.1), 71);
  assert.equal(hit(L, 7, 0.5), -1);
  assert.equal(hit(L, -0.1, 0.5), -1);
  assert.equal(velocity(0, 100), 1);
  assert.equal(velocity(100, 100), 127);
  assert.equal(velocity(50, 100), 64);
  assert.equal(velocity(-10, 100), 1);
  assert.equal(velocity(500, 100), 127);
  assert.deepEqual([noteName(60), noteName(0), noteName(61), noteName(127)], ['C4', 'C-1', 'C#4', 'G9']);
});

test('pianoKeys: multi-touch notes, glissando, release, highlights and scale shading', () => {
  const d = fresh();
  const ev = [], held = new Set([64]), lit = new Set([67]);
  let sc = { key: 0, steps: [0, 2, 4, 5, 7, 9, 11] };
  const pk = wk.pianoKeys({ lo: 60, hi: 71, on: (n, v) => ev.push(['on', n, v]), off: n => ev.push(['off', n]), held: () => held, lit: () => lit, scale: () => sc, labels: true, color: '#b07cff' });
  d.body.appendChild(pk.el);
  place(pk.el, 0, 0, 70, 100); // 10 px per white key
  const keyEl = n => all(pk.el).find(e => e.getAttribute && e.getAttribute('data-note') === String(n));
  assert.equal(byCls(pk.el, 'wk-pk').length, 12);
  assert.equal(keyEl(61).style.left, (0.7 / 7 * 100).toFixed(3) + '%');
  assert.equal(one(pk.el, 'wk-pl').textContent, 'C4');
  assert.equal(pk.el.style['--wk-pc'], '#b07cff');
  assert.ok(keyEl(64).classList.contains('wk-held') && keyEl(67).classList.contains('wk-lit'));
  assert.ok(keyEl(61).classList.contains('wk-out') && !keyEl(62).classList.contains('wk-out') && keyEl(60).classList.contains('wk-root'));
  // two fingers
  ptr(pk.el, 'pointerdown', 5, 50, { pointerType: 'touch', pointerId: 1 });
  ptr(pk.el, 'pointerdown', 9, 31, { pointerType: 'touch', pointerId: 2 }); // black key C#, 50 % down it
  assert.deepEqual(ev, [['on', 60, 64], ['on', 61, 64]]);
  assert.deepEqual(pk.notes().sort(), [60, 61]);
  assert.ok(keyEl(60).classList.contains('wk-held'));
  // glissando: finger 1 slides to D
  ptr(pk.el, 'pointermove', 15, 100, { pointerType: 'touch', pointerId: 1 });
  assert.deepEqual(ev.slice(2), [['off', 60], ['on', 62, 127]]);
  ptr(pk.el, 'pointermove', 16, 90, { pointerType: 'touch', pointerId: 1 }); // same key: nothing
  assert.equal(ev.length, 4);
  ptr(pk.el, 'pointerup', 16, 90, { pointerType: 'touch', pointerId: 1 });
  assert.deepEqual(ev.at(-1), ['off', 62]);
  pk.release(); // e.g. on blur
  assert.deepEqual(ev.at(-1), ['off', 61]);
  assert.deepEqual(pk.notes(), []);
  // fixed velocity; a cancelled pointer releases; mouse with no button releases
  const ev2 = [];
  const p2 = wk.pianoKeys({ lo: 60, hi: 71, vel: 100, on: (n, v) => ev2.push(['on', n, v]), off: n => ev2.push(['off', n]) });
  d.body.appendChild(p2.el);
  place(p2.el, 0, 0, 70, 100);
  ptr(p2.el, 'pointerdown', 35, 90);
  ptr(p2.el, 'pointercancel', 35, 90);
  ptr(p2.el, 'pointerdown', 45, 90);
  ptr(p2.el, 'pointermove', 46, 90, { buttons: 0 });
  assert.deepEqual(ev2, [['on', 65, 100], ['off', 65], ['on', 67, 100], ['off', 67]]);
  // scale off, range change
  sc = null;
  pk.setRange(48, 59);
  assert.equal(byCls(pk.el, 'wk-out').length, 0);
  assert.equal(keyEl(48).getAttribute('data-note'), '48');
  assert.match(pk.el.getAttribute('aria-label'), /C3–B3/);
  // disabled: no notes
  const p3 = wk.pianoKeys({ disabled: () => true, on: () => assert.fail('on') });
  d.body.appendChild(p3.el);
  place(p3.el, 0, 0, 100, 100);
  ptr(p3.el, 'pointerdown', 5, 50);
  pk.destroy();
  assert.equal(pk.el.parentNode, null);
});

test('stepGrid: valueAt, press / paint across a row, phases, len dimming, keys, typed entry', () => {
  assert.equal(wk.stepGrid.valueAt(0, 40), 1);
  assert.equal(wk.stepGrid.valueAt(40, 40), -1);
  assert.equal(wk.stepGrid.valueAt(20, 40), 0);
  assert.equal(wk.stepGrid.valueAt(10, 40), 0.5);
  assert.equal(wk.stepGrid.valueAt(-5, 40), 1);
  assert.ok(!Object.is(wk.stepGrid.valueAt(20, 40), -0));
  const d = fresh();
  const rows = ['Pan', 'Detune'], v = rows.map(() => new Array(8).fill(0)), calls = [];
  let len = 4;
  const sg = wk.stepGrid({ rows, steps: 8, len: () => len, get: (r, j) => v[r][j], set: (r, j, x, ph) => { v[r][j] = x; calls.push([r, j, ph, x]); } });
  d.body.appendChild(sg.el);
  const cells = byCls(sg.el, 'wk-sgc');
  assert.equal(cells.length, 16);
  assert.equal(sg.el.style['--wk-sgn'], '8');
  cells.forEach((c, i) => place(c, 20 * (i % 8), 40 * Math.floor(i / 8), 20, 40));
  assert.deepEqual(byCls(sg.el, 'wk-sgl').map(l => l.textContent), rows);
  assert.ok(cells[4].classList.contains('wk-off') && !cells[3].classList.contains('wk-off'));
  assert.equal(cells[0].tabIndex, 0);
  assert.equal(cells[1].tabIndex, -1);
  assert.equal(cells[0].getAttribute('aria-label'), 'Pan step 1');
  // press row 0 cell 1 at a quarter height (+0.5), paint across to cell 3 at the bottom (−1)
  ptr(cells[1], 'pointerdown', 25, 10);
  assert.equal(v[0][1], 0.5);
  ptr(sg.el, 'pointermove', 45, 30);
  ptr(sg.el, 'pointermove', 65, 40);
  ptr(sg.el, 'pointerup', 65, 40);
  assert.deepEqual([v[0][1], v[0][2], v[0][3]], [0.5, -0.5, -1]);
  assert.deepEqual(calls.filter(c => c[2] === 'start').map(c => c[1]), [1, 2, 3]);
  assert.deepEqual(calls.filter(c => c[2] === 'end').map(c => [c[1], c[3]]), [[1, 0.5], [2, -0.5], [3, -1]]);
  assert.equal(v[1][1], 0); // other rows untouched
  const f = one(cells[1], 'wk-sgf');
  assert.deepEqual([f.style.top, f.style.height], ['25.00%', '25.00%']);
  assert.ok(cells[3].classList.contains('wk-neg'));
  assert.equal(cells[3].getAttribute('aria-valuenow'), '-100');
  // the active cell follows; keys
  assert.equal(cells[3].tabIndex, 0);
  key(cells[3], 'ArrowUp'); assert.equal(v[0][3], -0.95);
  key(cells[3], 'ArrowUp', { shiftKey: true }); assert.equal(v[0][3], -0.94);
  key(cells[3], 'Delete'); assert.equal(v[0][3], 0);
  key(cells[3], 'PageDown'); assert.equal(cells[11].tabIndex, 0);
  key(cells[11], 'End'); assert.equal(cells[15].tabIndex, 0);
  key(cells[15], 'Enter');
  const inp = one(sg.el, 'wk-in');
  assert.equal(inp.value, '0');
  inp.value = '-50';
  key(inp, 'Enter');
  assert.equal(v[1][7], -0.5);
  // Shift: relative fine drag (no jump)
  ptr(cells[0], 'pointerdown', 10, 39, { shiftKey: true });
  assert.equal(v[0][0], 0);
  ptr(sg.el, 'pointermove', 10, 19, { shiftKey: true });
  assert.equal(v[0][0], 0.1);
  ptr(sg.el, 'pointerup', 10, 19);
  len = 8; sg.update();
  assert.equal(byCls(sg.el, 'wk-off').length, 0);
  sg.destroy();
});

test('iconSeg: icon buttons (SVG path or glyph), labels and tooltips, seg behaviour', () => {
  const d = fresh();
  let i = 0;
  const w = wk.iconSeg({ label: 'SHAPE', dest: 's.shp', items: [{ icon: 'M2 8 L8 2 L14 8', label: 'Triangle' }, { icon: '∿', label: 'Sine' }, { icon: 'M2 12 V4 H8 V12 H14', label: 'Square' }],
    get: () => i, set: v => { i = v; } });
  d.body.appendChild(w.el);
  const btns = byCls(w.el, 'wk-sb');
  assert.ok(w.el.classList.contains('wk-iseg'));
  assert.equal(w.el.getAttribute('role'), 'radiogroup');
  assert.equal(w.el.getAttribute('data-dest'), 's.shp');
  assert.deepEqual(btns.map(b => b.getAttribute('aria-label')), ['Triangle', 'Sine', 'Square']);
  assert.equal(one(btns[0], 'wk-ico').localName, 'svg');
  assert.equal(one(btns[1], 'wk-iglyph').textContent, '∿');
  assert.equal(btns[0].getAttribute('aria-checked'), 'true');
  btns[2].click();
  assert.equal(i, 2);
  key(btns[2], 'ArrowRight');
  assert.equal(i, 0);
  assert.equal(btns[0].tabIndex, 0);
  // plain seg is unchanged
  const s = wk.seg({ items: ['A', 'B'], get: () => 0, set() {} });
  assert.ok(!s.el.classList.contains('wk-iseg'));
  assert.equal(byCls(s.el, 'wk-sb')[1].textContent, 'B');
  w.destroy();
});

test('modifierBar: latch / lock / release, page-wide state, mods(e), consumed by the next gesture', () => {
  const d = fresh();
  const changes = [];
  const bar = wk.modifierBar({ onChange: s => changes.push(s) });
  const bar2 = wk.modifierBar({ keys: ['alt'] });
  d.body.append(bar.el, bar2.el);
  const btn = k => all(bar.el).find(e => e.getAttribute && e.getAttribute('data-mod') === k);
  assert.deepEqual(byCls(bar.el, 'wk-mk').map(b => b.textContent), ['Fine', 'Alt', 'Shift']);
  assert.equal(byCls(bar2.el, 'wk-mk').length, 1);
  assert.deepEqual(wk.modifierBar.mods({}), { fine: false, alt: false, shift: false });
  assert.deepEqual(wk.modifierBar.mods({ shiftKey: true, altKey: true }), { fine: true, alt: true, shift: true });
  // tap: latched
  btn('alt').click();
  assert.deepEqual(bar.state(), { fine: 0, alt: 1, shift: 0 });
  assert.ok(btn('alt').classList.contains('wk-on') && one(bar2.el, 'wk-mk').classList.contains('wk-on'));
  assert.equal(btn('alt').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(wk.modifierBar.mods({}), { fine: false, alt: true, shift: false });
  wk.modifierBar.consume();
  assert.deepEqual(bar.state(), { fine: 0, alt: 0, shift: 0 });
  assert.ok(!btn('alt').classList.contains('wk-on'));
  // double-tap: locked, survives gestures, a tap releases
  btn('shift').click(); advance(100); btn('shift').click();
  assert.equal(bar.state().shift, 2);
  assert.ok(btn('shift').classList.contains('wk-lock'));
  wk.modifierBar.consume();
  assert.equal(bar.state().shift, 2);
  advance(500); btn('shift').click();
  assert.equal(bar.state().shift, 0);
  // two taps far apart: on, off
  btn('fine').click(); advance(500); btn('fine').click();
  assert.equal(bar.state().fine, 0);
  assert.ok(changes.length >= 6);
  // the Fine latch makes the next knob drag fine (×0.1) and is consumed by it
  btn('fine').click();
  const { st, el } = mkKnob();
  st.n = 0.5;
  ptr(el, 'pointerdown', 100, 100);
  ptr(el, 'pointermove', 100, 80);
  near(st.n, 0.51);
  ptr(el, 'pointerup', 100, 80);
  assert.equal(bar.state().fine, 0);
  ptr(el, 'pointerdown', 100, 100);
  ptr(el, 'pointermove', 100, 80);
  near(st.n, 0.61);
  ptr(el, 'pointerup', 100, 80);
  bar.clear();
  bar2.destroy();
  bar.destroy();
  assert.equal(bar.el.parentNode, null);
});

test('dragSource: mouse slop, begin / move / drop, swallowed click, Escape, latches; touch hold, scroll, menu', () => {
  const d = fresh();
  const tile = d.createElement('button'), target = d.createElement('div');
  d.body.append(tile, target);
  d.elementFromPoint = () => target;
  const log = [];
  let clicks = 0;
  tile.addEventListener('click', () => clicks++);
  const src = wk.dragSource(tile, {
    data: () => 'lfo1',
    begin: i => log.push(['begin', i.data, i.alt, i.pointerType]),
    move: i => log.push(['move', i.x, i.y, i.target === target]),
    drop: i => log.push(['drop', i.x, i.y, i.target === target, i.alt]),
    cancel: i => log.push(['cancel', i.x]),
  });
  // a plain click: no drag, the click goes through
  ptr(tile, 'pointerdown', 10, 10); ptr(tile, 'pointermove', 12, 11); ptr(tile, 'pointerup', 12, 11); tile.click();
  assert.deepEqual(log, []);
  assert.equal(clicks, 1);
  // a drag past 4 px
  ptr(tile, 'pointerdown', 10, 10, { altKey: true });
  ptr(tile, 'pointermove', 20, 10);
  assert.ok(src.active());
  assert.ok(tile.classList.contains('wk-dragging'));
  ptr(tile, 'pointermove', 30, 40);
  ptr(tile, 'pointerup', 30, 40);
  tile.click(); // the click that ends a drag is swallowed
  assert.equal(clicks, 1);
  assert.deepEqual(log, [['begin', 'lfo1', true, 'mouse'], ['move', 20, 10, true], ['move', 30, 40, true], ['drop', 30, 40, true, true]]);
  assert.ok(!src.active() && !tile.classList.contains('wk-dragging'));
  tile.click();
  assert.equal(clicks, 2);
  // Escape cancels; the Alt latch is read at the press and consumed at the end
  log.length = 0;
  const bar = wk.modifierBar();
  d.body.appendChild(bar.el);
  all(bar.el).find(e => e.getAttribute && e.getAttribute('data-mod') === 'alt').click();
  ptr(tile, 'pointerdown', 10, 10);
  ptr(tile, 'pointermove', 30, 10);
  key(d.body, 'Escape');
  assert.deepEqual(log, [['begin', 'lfo1', true, 'mouse'], ['move', 30, 10, true], ['cancel', 30]]);
  assert.equal(bar.state().alt, 0);
  ptr(tile, 'pointerup', 30, 10);
  assert.equal(log.length, 3);
  // touch: moving before the 250 ms hold is a scroll (abandoned); a hold arms, the next move starts
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    log.length = 0;
    ptr(tile, 'pointerdown', 10, 10, { pointerType: 'touch' });
    ptr(tile, 'pointermove', 10, 40, { pointerType: 'touch' });
    mock.timers.tick(300);
    ptr(tile, 'pointermove', 10, 60, { pointerType: 'touch' });
    ptr(tile, 'pointerup', 10, 60, { pointerType: 'touch' });
    assert.deepEqual(log, []);
    assert.ok(!tile.classList.contains('wk-armed'));
    ptr(tile, 'pointerdown', 10, 10, { pointerType: 'touch' });
    mock.timers.tick(249);
    assert.ok(!tile.classList.contains('wk-armed'));
    mock.timers.tick(1);
    assert.ok(tile.classList.contains('wk-armed'));
    const tm = fire(tile, 'touchmove');
    assert.ok(tm.defaultPrevented); // armed: no page scroll
    ptr(tile, 'pointermove', 11, 12, { pointerType: 'touch' }); // jitter (≤ 6 px from the armed point) starts nothing
    assert.deepEqual(log, []);
    ptr(tile, 'pointermove', 11, 19, { pointerType: 'touch' });
    assert.deepEqual(log[0], ['begin', 'lfo1', false, 'touch']);
    ptr(tile, 'pointerup', 50, 50, { pointerType: 'touch' });
    assert.deepEqual(log.at(-1), ['drop', 50, 50, true, false]);
    // a still hold until the long-press menu: no drag
    log.length = 0;
    ptr(tile, 'pointerdown', 10, 10, { pointerType: 'touch' });
    mock.timers.tick(500);
    fire(tile, 'contextmenu');
    ptr(tile, 'pointermove', 40, 40, { pointerType: 'touch' });
    ptr(tile, 'pointerup', 40, 40, { pointerType: 'touch' });
    assert.deepEqual(log, []);
    assert.ok(!fire(tile, 'touchmove').defaultPrevented);
  } finally {
    mock.timers.reset();
  }
  // pointercancel mid-drag cancels; destroy detaches
  log.length = 0;
  ptr(tile, 'pointerdown', 10, 10);
  ptr(tile, 'pointermove', 30, 10);
  ptr(tile, 'pointercancel', 30, 10);
  assert.deepEqual(log.map(l => l[0]), ['begin', 'move', 'cancel']);
  src.destroy();
  ptr(tile, 'pointerdown', 10, 10); ptr(tile, 'pointermove', 40, 10);
  assert.equal(log.length, 3);
  bar.destroy();
});

test('zoomPan: pure zoom / pan maths', () => {
  const { zoom, pan } = wk.zoomPan;
  const v0 = { x0: 0, x1: 1, y0: 0, y1: 1 };
  assert.deepEqual(zoom(v0, 2, 0.5, 0.5), { x0: 0.25, x1: 0.75, y0: 0, y1: 1 }); // axis x by default
  assert.deepEqual(zoom(v0, 2, 0, 0), { x0: 0, x1: 0.5, y0: 0, y1: 1 });
  assert.deepEqual(zoom(v0, 4, 1, 0, { axis: 'xy' }), { x0: 0.75, x1: 1, y0: 0, y1: 0.25 });
  assert.deepEqual(zoom(v0, 2, 0.5, 0.5, { axis: 'y' }), { x0: 0, x1: 1, y0: 0.25, y1: 0.75 });
  // the content under the anchor stays put
  const v1 = { x0: 0.2, x1: 0.6 }, z = zoom(v1, 1.6, 0.3, 0);
  near(z.x0 + 0.3 * (z.x1 - z.x0), 0.2 + 0.3 * 0.4, 1e-12);
  near(z.x1 - z.x0, 0.25, 1e-12);
  // limits: min span, max span, inside the content
  assert.deepEqual(zoom(v0, 1e6, 0.5, 0.5, { min: 0.01 }).x1 - zoom(v0, 1e6, 0.5, 0.5, { min: 0.01 }).x0 > 0.0099, true);
  assert.deepEqual(zoom({ x0: 0.4, x1: 0.6 }, 0.01, 0.5, 0.5), { x0: 0, x1: 1, y0: 0, y1: 1 });
  assert.deepEqual(zoom({ x0: 0.4, x1: 0.6 }, 0.1, 0.5, 0.5, { max: 0.5 }), { x0: 0.25, x1: 0.75, y0: 0, y1: 1 });
  assert.deepEqual(zoom(v0, 0, 0.5, 0.5), v0);
  assert.deepEqual(pan({ x0: 0.2, x1: 0.4 }, 0.5, 0), { x0: 0.30000000000000004, x1: 0.5, y0: 0, y1: 1 });
  assert.deepEqual(pan({ x0: 0.2, x1: 0.4 }, 10, 0), { x0: 0.8, x1: 1, y0: 0, y1: 1 });
  assert.deepEqual(pan({ x0: 0.2, x1: 0.4 }, -10, 0), { x0: 0, x1: 0.2, y0: 0, y1: 1 });
  assert.deepEqual(pan({ x0: 0, x1: 1, y0: 0.5, y1: 0.75 }, 0, -1, { axis: 'y' }), { x0: 0, x1: 1, y0: 0.25, y1: 0.5 });
  assert.deepEqual(zoom(null, 1, 0, 0), v0);
  assert.deepEqual(zoom({ x0: 0.8, x1: 0.2 }, 1, 0, 0), v0); // invalid → full
});

test('zoomPan: two-finger pinch / pan in the capture phase, inner gestures stand down, Ctrl-wheel zoom, Shift-wheel pan', () => {
  const d = fresh();
  const el = d.createElement('div'), inner = d.createElement('canvas');
  el.appendChild(inner);
  d.body.appendChild(el);
  place(el, 0, 0, 200, 100);
  let view = { x0: 0, x1: 1, y0: 0, y1: 1 };
  const sets = [], innerMoves = [];
  inner.addEventListener('pointermove', e => innerMoves.push(e.pointerId));
  const zp = wk.zoomPan(el, { get: () => view, set: (v, ph) => { view = v; sets.push(ph); } });
  const T = (type, id, x, y) => ptr(inner, type, x, y, { pointerType: 'touch', pointerId: id });
  T('pointerdown', 1, 80, 50);
  T('pointermove', 1, 82, 50); // one finger: the canvas's own gesture
  assert.deepEqual(innerMoves, [1]);
  assert.equal(zp.active(), false);
  T('pointerdown', 2, 122, 50);
  assert.equal(zp.active(), true);
  assert.deepEqual(sets, ['start']);
  T('pointermove', 2, 162, 50); // spread 40 → 80 px → 2× zoom; the midpoint moves from 102 to 122 px
  assert.deepEqual(innerMoves, [1]); // consumed
  assert.equal(sets.at(-1), 'move');
  near(view.x1 - view.x0, 0.5, 1e-9);
  // the content under the start midpoint (102 / 200 = 0.51) is now under the new midpoint (122 / 200 = 0.61)
  near(view.x0 + 0.61 * (view.x1 - view.x0), 0.51, 1e-9);
  T('pointerup', 2, 162, 50);
  assert.equal(sets.at(-1), 'end');
  assert.equal(zp.active(), false);
  T('pointerup', 1, 82, 50);
  // mouse wheel: Ctrl = zoom at the pointer, Shift = pan; plain wheel untouched
  view = { x0: 0, x1: 1, y0: 0, y1: 1 };
  const w1 = fire(el, 'wheel', { ctrlKey: true, deltaY: -100 * Math.log(2) / 0.2, clientX: 50, clientY: 50 });
  assert.ok(w1.defaultPrevented);
  near(view.x1 - view.x0, 0.5, 1e-9);
  near(view.x0, 0.125, 1e-9);
  const w2 = fire(el, 'wheel', { shiftKey: true, deltaY: 50, clientX: 50, clientY: 50 });
  assert.ok(w2.defaultPrevented);
  near(view.x0, 0.125 + 0.25 * 0.5, 1e-9);
  const w3 = fire(el, 'wheel', { deltaY: 50 });
  assert.ok(!w3.defaultPrevented);
  zp.destroy();
  T('pointerdown', 1, 80, 50); T('pointerdown', 2, 120, 50);
  assert.equal(zp.active(), false);
});

test('longPress (exported): touch only, 500 ms, cancelled by travel or release', () => {
  const d = fresh();
  const el = d.createElement('div');
  d.body.appendChild(el);
  const got = [];
  el.addEventListener('contextmenu', e => got.push([e.clientX, e.clientY]));
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let fired = 0;
    assert.equal(wk.longPress(el, new (globalThis.MouseEvent)('pointerdown', { pointerType: 'mouse' })), null);
    const lp = wk.longPress(el, new (globalThis.MouseEvent)('pointerdown', { pointerType: 'touch', clientX: 5, clientY: 6 }), () => fired++);
    mock.timers.tick(500);
    assert.deepEqual([fired, got], [1, [[5, 6]]]);
    const lp2 = wk.longPress(el, new (globalThis.MouseEvent)('pointerdown', { pointerType: 'touch', clientX: 5, clientY: 6 }));
    lp2.move({ clientX: 20, clientY: 6 });
    mock.timers.tick(600);
    const lp3 = wk.longPress(el, new (globalThis.MouseEvent)('pointerdown', { pointerType: 'touch', clientX: 5, clientY: 6 }));
    lp3.cancel();
    mock.timers.tick(600);
    assert.equal(got.length, 1);
    lp.cancel();
  } finally {
    mock.timers.reset();
  }
});

/* ------------------------------------------------------------ M2: touch-first infrastructure (§13.1) */
import { raf } from './wk-dom.mjs';

test('typed entry: inputmode decimal for unsigned numeric displays, text otherwise; o.inputMode wins; enterkeyhint', () => {
  const d = fresh();
  const mode = w => { const i = one(w.el, 'wk-in'); assert.ok(i, 'input open'); const m = i.getAttribute('inputmode'); assert.equal(i.getAttribute('enterkeyhint'), 'done'); i.blur(); return m; };
  const k1 = wk.knob({ label: 'A', get: () => 0.5, set() {}, def: 0, fmt: n => (n * 100).toFixed(1) + '%' });
  const k2 = wk.knob({ label: 'B', get: () => 0.5, set() {}, def: 0, fmt: n => (n * 24 - 12).toFixed(1) + ' st' });
  const k3 = wk.knob({ label: 'C', get: () => 0.5, set() {}, def: 0, fmt: n => (n < 0.5 ? 'L' : 'R') + Math.round(Math.abs(n - 0.5) * 100) });
  const k4 = wk.knob({ label: 'D', get: () => 0.5, set() {}, def: 0, fmt: n => (n * 24 - 12).toFixed(1), inputMode: 'numeric' });
  const nb = wk.numBox({ label: 'N', get: () => 0.5, set() {}, def: 0, steps: 10 });
  const sl = wk.slider({ label: 'S', get: () => 0.5, set() {}, def: 0 });
  const fd = wk.fader({ label: 'F', get: () => 0.5, set() {}, def: 0, db: n => n > 0 ? 40 * Math.log10(n) : -Infinity });
  const rb = wk.rangeBar({ label: 'R', get: () => [10, 20], set() {} });
  const sg = wk.stepGrid({ rows: ['Pan'], steps: 2, get: () => 0, set() {} });
  for (const w of [k1, k2, k3, k4, nb, sl, fd, rb, sg]) d.body.appendChild(w.el);
  for (const [w, m] of [[k1, 'decimal'], [k2, 'text'], [k3, 'text'], [k4, 'numeric'], [nb, 'decimal'], [sl, 'decimal'], [fd, 'text'], [rb, 'text']]) {
    w.edit();
    assert.equal(mode(w), m);
  }
  key(byCls(sg.el, 'wk-sgc')[0], 'Enter');
  assert.equal(mode(sg), 'text');
});

test('touch mode: the first touch marks <html> wk-touch; the touch CSS ships twice (coarse pointer and .wk-touch)', () => {
  const d = fresh();
  const css = wk.injectStyles(d).textContent;
  for (const rule of ['.wk-knob { min-width: 44px; }', '.wk-sb::before', '.wk-mk { min-width: 44px; min-height: 44px; }', '.wk-opt, .wk-ci { min-height: 44px;']) {
    assert.ok(css.includes('  ' + rule), 'coarse: ' + rule);
  }
  assert.ok(css.includes('.wk-touch .wk-knob { min-width: 44px; }'));
  assert.ok(css.includes('.wk-touch .wk-sb::before, .wk-touch .wk-nbv::before'));
  assert.ok(css.includes('.wk-touch .wk-opt, .wk-touch .wk-ci { min-height: 44px;'));
  assert.match(css, /calc\(50% - 22px\)/);
  assert.match(css, /touch-action: manipulation/);
  assert.equal((css.match(/@media \(pointer: coarse\)/g) || []).length, 1);
  assert.equal(typeof wk.touchMode(), 'boolean');
  fire(d.body, 'pointerdown', { pointerType: 'mouse' });
  if (!wk.touchMode()) assert.ok(!d.documentElement.classList.contains('wk-touch'));
  fire(d.body, 'pointerdown', { pointerType: 'touch' });
  assert.ok(d.documentElement.classList.contains('wk-touch'));
  assert.equal(wk.touchMode(), true);
  const d2 = fresh(); // later documents of the page start in touch mode
  wk.injectStyles(d2);
  assert.ok(d2.documentElement.classList.contains('wk-touch'));
});

test('modifier latches: a click outside the bars releases latched keys after its listeners; locked keys stay', async () => {
  const d = fresh();
  const bar = wk.modifierBar();
  const b = d.createElement('button');
  d.body.append(bar.el, b);
  const seen = [];
  b.addEventListener('click', e => seen.push(wk.modifierBar.mods(e).alt));
  const mk = k => all(bar.el).find(e => e.getAttribute && e.getAttribute('data-mod') === k);
  mk('alt').click();
  await null;
  assert.equal(bar.state().alt, 1); // a click inside the bar does not consume
  b.click();
  assert.deepEqual(seen, [true]);
  await null;
  assert.equal(bar.state().alt, 0);
  mk('shift').click(); advance(100); mk('shift').click();
  b.click();
  await null;
  assert.equal(bar.state().shift, 2);
  bar.clear();
  bar.destroy();
});

test('fitCanvas: device-pixel ratio capped at 2 (§13.1)', () => {
  const d = fresh();
  const cv = d.createElement('canvas');
  d.defaultView.devicePixelRatio = 3;
  const ctx = wk.fitCanvas(cv, 100, 50);
  assert.deepEqual([cv.width, cv.height], [200, 100]);
  assert.deepEqual(ctx.calls.at(-1), ['setTransform', 2, 0, 0, 2, 0, 0]);
});

test('ticker: ≤ 30 fps (4 ms slack), 10 fps with reduced motion, skips hidden pages, ends with the element, stop / start', () => {
  const d = fresh();
  raf.install();
  const mm = globalThis.matchMedia;
  let reduce = false;
  globalThis.matchMedia = q => ({ matches: reduce && /reduce/.test(q) });
  try {
    const el = d.createElement('div');
    d.body.appendChild(el);
    const ts = [];
    const tk = wk.ticker(el, t => ts.push(t));
    assert.equal(tk.running(), false);
    tk.start(); tk.start();
    assert.equal(raf.pending, 1);
    raf.flush(1, 0); raf.flush(1, 16.7); raf.flush(1, 33.4); raf.flush(1, 50); raf.flush(1, 66.8);
    assert.deepEqual(ts, [0, 33.4, 66.8]); // every 2nd frame of a 60 Hz display
    ts.length = 0;
    for (let i = 1; i <= 8; i++) raf.flush(1, 66.8 + i * 8.35); // 120 Hz: every 4th frame
    assert.equal(ts.length, 2);
    ts.length = 0;
    reduce = true;
    for (let i = 1; i <= 12; i++) raf.flush(1, 200 + i * 16.7);
    assert.equal(ts.length, 2); // 10 fps
    reduce = false;
    ts.length = 0;
    d.visibilityState = 'hidden';
    raf.flush(3, 1000);
    assert.equal(ts.length, 0);
    assert.equal(tk.running(), true);
    d.visibilityState = 'visible';
    tk.stop();
    assert.equal(raf.pending, 0);
    assert.equal(tk.running(), false);
    tk.start();
    el.remove();
    raf.flush(2, 2000);
    assert.equal(raf.pending, 0);
    assert.equal(tk.running(), false);
    assert.deepEqual(ts, []);
    // a throwing frame is logged and the loop goes on; o.fps
    d.body.appendChild(el);
    let n = 0;
    const err = console.error;
    console.error = () => {};
    try {
      const t2 = wk.ticker(el, () => { n++; throw new Error('x'); }, { fps: 60 });
      t2.start();
      raf.flush(1, 3000); raf.flush(1, 3016.7);
      assert.equal(n, 2);
      t2.stop();
    } finally { console.error = err; }
  } finally {
    if (mm === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = mm;
    raf.uninstall();
  }
});

test('loadDSP.URLS: files 1–14 of the §0.3 table, in table order (the drum machine\'s two before mod-core.js, last: IMPL-2b, IMPL-7a §10.2)', () => {
  assert.deepEqual([...wk.loadDSP.URLS], ['sx-base.js', 'sx-filt2.js', 'sx-warp.js', 'sx-mod.js', 'sx-sample.js', 'sx-gran.js', 'sx-spec.js',
    'sx-seq.js', 'serum-dsp.js', 'fx-mods2.js', 'fx-dsp.js', 'dr-808.js', 'dr-seq.js', 'mod-core.js']);
  assert.ok(Object.isFrozen(wk.loadDSP.URLS));
});

test('loadDSP(): the default list is files 1–14 in table order (§0.3 + mod-core.js, IMPL-2b); defined globals are skipped; the timer never holds node', async () => {
  const G = DSP_GLOBAL_NAMES, saved = G.map(k => [k, Object.prototype.hasOwnProperty.call(globalThis, k), globalThis[k]]);
  const st = globalThis.setTimeout, timers = [], warn = console.warn, warned = [];
  globalThis.setTimeout = (fn, ms) => { const t = st(fn, ms); timers.push(t); return t; };
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    for (const k of G) delete globalThis[k];
    globalThis.SxSeq = null;                                      // already evaluated (a failed script): not injected
    const d = fresh();
    const p = wk.loadDSP();
    assert.deepEqual(d.scripts.map(s => s.src), [...wk.loadDSP.URLS].filter(u => u !== 'sx-seq.js'));
    assert.ok(d.scripts.every(s => s.async === false && s.parentNode === d.head));
    assert.equal(timers.length, d.scripts.length);
    assert.ok(timers.every(t => typeof t.hasRef !== 'function' || t.hasRef() === false), 'unref: a pending load keeps no node process alive');
    // a panel's default call after main.js loaded DSP_URLS (versioned paths): nothing new
    const again = wk.loadDSP(wk.loadDSP.URLS.map(u => u + '?v=9'));
    assert.equal(d.scripts.length, 13);
    const vals = {};
    d.scripts.forEach((s, i) => { const g = G[wk.loadDSP.URLS.indexOf(s.src)]; vals[g] = Object.freeze({ id: g }); globalThis[g] = vals[g]; fire(s, i % 2 ? 'load' : 'error', { bubbles: false }); });
    const r = await p;
    assert.deepEqual(Object.keys(r), G);
    for (const g of G) assert.equal(r[g], g === 'SxSeq' ? null : vals[g]);
    assert.deepEqual(await again, r);
    assert.equal(warned.length, 7);                               // the seven scripts that fired 'error' (every other one of 13)
  } finally {
    globalThis.setTimeout = st;
    console.warn = warn;
    for (const t of timers) clearTimeout(t);
    for (const [k, own, v] of saved) { if (own) globalThis[k] = v; else delete globalThis[k]; }
  }
});

test('pianoKeys: fitRange (2–7 octaves by width, whole octaves around the centre) and the fit option', () => {
  const F = wk.pianoKeys.fitRange;
  assert.deepEqual(F(0), [48, 72]);
  assert.deepEqual(F(7 * 24 * 2), [48, 72]);
  assert.deepEqual(F(7 * 24 * 3), [48, 84]);
  assert.deepEqual(F(7 * 24 * 4), [36, 84]);
  assert.deepEqual(F(7 * 24 * 7), [24, 108]);
  assert.deepEqual(F(1e5), [24, 108]);
  assert.deepEqual(F(7 * 24 * 2, { center: 72 }), [60, 84]);
  assert.deepEqual(F(7 * 24 * 2, { center: () => 0 }), [0, 24]);
  assert.deepEqual(F(7 * 30 * 3, { keyW: 30, min: 1, max: 10 }), [48, 84]);
  assert.deepEqual(F(1e5, { max: 10 }), [0, 120]);
  const d = fresh();
  const RO = globalThis.ResizeObserver, obs = [];
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; obs.push(this); } observe(el) { this.el = el; } disconnect() { this.dead = true; } };
  try {
    const pk = wk.pianoKeys({ fit: { center: 60 } });
    d.body.appendChild(pk.el);
    assert.equal(obs.length, 1);
    place(pk.el, 0, 0, 7 * 24 * 4, 72);
    obs[0].cb();
    assert.deepEqual(pk.range(), [36, 84]);
    assert.equal(byCls(pk.el, 'wk-pw').length, 29);
    place(pk.el, 0, 0, 7 * 24 * 2 + 5, 72);
    pk.fit();
    assert.deepEqual(pk.range(), [48, 72]);
    pk.destroy();
    assert.ok(obs[0].dead);
    const fixed = wk.pianoKeys({ lo: 60, hi: 71 });
    assert.equal(obs.length, 1); // no observer without fit
    fixed.fit();
    assert.deepEqual(fixed.range(), [60, 71]);
  } finally {
    if (RO === undefined) delete globalThis.ResizeObserver; else globalThis.ResizeObserver = RO;
  }
});

/* ------------------------------------------------------------ review fixes (U5, round 2) */
test('xyPad: both destinations’ knob menus reach touch and keyboard (chooser on the dot / pad; rails are menu sources)', () => {
  const d = fresh();
  setPlatform('Win32');
  const st = { x: 0.5, y: 0.5 };
  const ax = (k, dest, label) => ({ dest, label, get: () => st[k], set: n => { st[k] = n; } });
  const p = wk.xyPad({ x: ax('x', 'f.x', 'Freq'), y: ax('y', 'f.y', 'Y') });
  d.body.appendChild(p.el);
  const pad = one(p.el, 'wk-xyp'), dot = one(p.el, 'wk-xyd'), rx = one(p.el, 'wk-xyrx'), ry = one(p.el, 'wk-xyry');
  place(pad, 0, 0, 100, 100); place(rx, 0, 103, 100, 6); place(ry, -9, 0, 6, 100);
  const got = []; // what the panel's knob-menu listener sees: [data-dest of the target, x, y]
  d.body.addEventListener('contextmenu', e => got.push([e.target.getAttribute('data-dest'), e.clientX, e.clientY]));
  // keyboard: Shift+F10 on the dot opens a chooser (the dot's own event stops at the pad), first item focused
  dot.focus();
  key(dot, 'F10', { shiftKey: true });
  let menu = one(d.body, 'wk-ctx');
  assert.ok(menu);
  assert.deepEqual(byCls(menu, 'wk-cl').map(n => n.textContent), ['Freq (X)', 'Y axis']);
  assert.deepEqual(got, []);
  key(d.activeElement, 'ArrowDown');
  key(d.activeElement, 'Enter');
  assert.equal(one(d.body, 'wk-ctx'), null);
  assert.deepEqual(got, [['f.y', -6, 50]]); // the Y rail, keyboard origin (its centre)
  // touch: a long-press on the pad opens the chooser at the finger; picking X sends the knob-menu event to the X rail
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    ptr(pad, 'pointerdown', 30, 40, { pointerType: 'touch' });
    mock.timers.tick(500);
    menu = one(d.body, 'wk-ctx');
    assert.ok(menu);
    ptr(pad, 'pointerup', 30, 40, { pointerType: 'touch' });
    const it = byCls(menu, 'wk-ci')[0];
    ptr(it, 'pointerdown', 0, 0);
    it.click();
    assert.deepEqual(got.at(-1), ['f.x', 30, 40]);
    // the rails themselves: long-press (menuSource) dispatches on the rail
    ptr(rx, 'pointerdown', 50, 106, { pointerType: 'touch' });
    mock.timers.tick(500);
    ptr(rx, 'pointerup', 50, 106, { pointerType: 'touch' });
    assert.deepEqual(got.at(-1), ['f.x', 50, 106]);
    assert.equal(one(d.body, 'wk-ctx'), null);
  } finally { mock.timers.reset(); }
  // a right-click on the dot (desktop) opens the chooser too
  ptr(dot, 'pointerdown', 50, 50, { button: 2, buttons: 2 });
  fire(dot, 'contextmenu', { clientX: 50, clientY: 50 });
  assert.ok(one(d.body, 'wk-ctx'));
  key(one(d.body, 'wk-ctx'), 'Escape');
  // focusing a rail (a closing knob menu returns focus there) lands on the dot
  rx.focus();
  assert.equal(d.activeElement, dot);
  // one destination: straight to its rail; none: the event is left alone
  const n0 = got.length;
  const q = wk.xyPad({ x: { dest: 'g.a', get: () => 0, set() {} }, y: { get: () => 0, set() {} } });
  d.body.appendChild(q.el);
  ptr(one(q.el, 'wk-xyd'), 'pointerdown', 5, 6, { button: 2, buttons: 2 }); // a right-click
  fire(one(q.el, 'wk-xyd'), 'contextmenu', { clientX: 5, clientY: 6 });
  assert.deepEqual(got.slice(n0), [['g.a', 5, 6]]);
  assert.equal(one(d.body, 'wk-ctx'), null);
  const z = wk.xyPad({ x: { get: () => 0, set() {} }, y: { get: () => 0, set() {} } });
  d.body.appendChild(z.el);
  const ev = fire(one(z.el, 'wk-xyd'), 'contextmenu', { clientX: 7, clientY: 8 });
  assert.ok(!ev.defaultPrevented);
  assert.deepEqual(got.at(-1), [null, 7, 8]);
  p.destroy();
  assert.equal(rx.listenerCount('pointerdown') + rx.listenerCount('keydown'), 0);
});

test('rangeBar: a narrow range keeps a body to drag; Alt drags the body; touch edges reach 22 px', () => {
  const d = fresh();
  const st = { r: [60, 63] };
  const rb = wk.rangeBar({ min: 0, max: 127, get: () => st.r, set: r => { st.r = r.slice(); } });
  d.body.appendChild(rb.el);
  const trk = one(rb.el, 'wk-rbt'), cell = 300 / 128;
  place(trk, 0, 0, 300, 18);
  const drag = (x0, dx, o = {}) => { ptr(trk, 'pointerdown', x0, 9, o); ptr(trk, 'pointermove', x0 + dx, 9, o); ptr(trk, 'pointerup', x0 + dx, 9, o); };
  drag(62 * cell, 10 * cell); // the middle of 60–63 (9.4 px): body (it used to move the high edge)
  assert.deepEqual(st.r, [70, 73]);
  st.r = [60, 71];
  drag(66 * cell, 10 * cell, { pointerType: 'touch' }); // 28 px wide on touch
  assert.deepEqual(st.r, [70, 81]);
  st.r = [60, 60];
  drag(60.5 * cell, 10 * cell); // a single cell
  assert.deepEqual(st.r, [70, 70]);
  drag(71 * cell + 3, 5 * cell); // just outside the high edge: that edge, no jump
  assert.deepEqual(st.r, [70, 75]);
  st.r = [20, 100];
  drag(20 * cell + 1, 5 * cell, { altKey: true }); // Alt: the body, even on an edge
  assert.deepEqual(st.r, [25, 105]);
  st.r = [20, 100];
  drag(20 * cell - 18, 4 * cell, { pointerType: 'touch' }); // 18 px outside the low edge: grabbed, not jumped
  assert.deepEqual(st.r, [24, 100]);
  drag(20 * cell - 18, 4 * cell); // the mouse reaches 6 px: the low edge jumps to the press (cell 12), then drags
  assert.deepEqual(st.r, [16, 100]);
});

test('pianoKeys: notes are reference-counted over pointers; glide: false; litColor / color set the lit colour', () => {
  const d = fresh();
  const ev = [];
  const pk = wk.pianoKeys({ lo: 48, hi: 59, vel: 100, on: n => ev.push('on' + n), off: n => ev.push('off' + n) });
  d.body.appendChild(pk.el);
  place(pk.el, 0, 0, 280, 100); // 7 white keys × 40 px
  const T = (type, id, x, y = 90) => ptr(pk.el, type, x, y, { pointerType: 'touch', pointerId: id });
  T('pointerdown', 1, 10); T('pointerdown', 2, 30); // two fingers on C3 (48)
  T('pointerup', 1, 10);
  assert.deepEqual(ev, ['on48']); // the key still sounds under finger 2
  assert.deepEqual(pk.notes(), [48]);
  T('pointerup', 2, 30);
  assert.deepEqual(ev, ['on48', 'off48']);
  ev.length = 0;
  T('pointerdown', 1, 90); // E (52) held
  T('pointerdown', 2, 50); // D (50) slides over E to F
  T('pointermove', 2, 95); T('pointermove', 2, 130);
  assert.deepEqual(ev, ['on52', 'on50', 'off50', 'on53']); // E is neither retriggered nor released
  T('pointerup', 2, 130);
  T('pointerup', 1, 90);
  assert.deepEqual(ev.slice(-2), ['off53', 'off52']);
  ev.length = 0;
  T('pointerdown', 1, 10); T('pointerdown', 2, 30); // release() with two fingers on one key: one off
  pk.release();
  assert.deepEqual(ev, ['on48', 'off48']);
  // glide: false — a pointer keeps the key it pressed (slot keyboards)
  const ev2 = [];
  const slots = wk.pianoKeys({ lo: 0, hi: 11, vel: 100, glide: false, color: '#3ddc84', on: n => ev2.push('on' + n), off: n => ev2.push('off' + n) });
  d.body.appendChild(slots.el);
  place(slots.el, 0, 0, 280, 100);
  ptr(slots.el, 'pointerdown', 10, 90, { pointerType: 'touch', pointerId: 9 });
  ptr(slots.el, 'pointermove', 130, 90, { pointerType: 'touch', pointerId: 9 });
  ptr(slots.el, 'pointerup', 130, 90, { pointerType: 'touch', pointerId: 9 });
  assert.deepEqual(ev2, ['on0', 'off0']);
  // the lit colour: litColor, else color (the slot keyboards' channel colour), else the --sx-arp token (CSS)
  assert.equal(slots.el.style['--wk-pc2'], '#3ddc84');
  assert.equal(wk.pianoKeys({ color: '#b07cff', litColor: '#123456' }).el.style['--wk-pc2'], '#123456');
  assert.equal(pk.el.style['--wk-pc2'], undefined);
  assert.match(one(d.head, 'wk-css') ? '' : d.getElementById('wk-css').textContent, /\.wk-pk\.wk-lit \{ background: var\(--wk-pc2, var\(--sx-arp, #b07cff\)\); \}/);
});

test('stepGrid: a fast swipe paints every cell it passed (pointer height interpolated across the jump)', () => {
  const d = fresh();
  const V = [Array(8).fill(0)], calls = [];
  const sg = wk.stepGrid({ rows: ['Pan'], steps: 8, get: (r, j) => V[r][j], set: (r, j, v, ph) => { V[r][j] = v; calls.push([j, ph]); } });
  d.body.appendChild(sg.el);
  const cells = byCls(sg.el, 'wk-sgc');
  cells.forEach((c, j) => place(c, 40 + j * 30, 0, 28, 40));
  ptr(cells[0], 'pointerdown', 50, 0); // cell 0 at the top: +1
  ptr(sg.el, 'pointermove', 50 + 30 * 5, 40); // one event later: cell 5 at the bottom
  assert.deepEqual(V[0], [1, 0.6, 0.2, -0.2, -0.6, -1, 0, 0]);
  ptr(sg.el, 'pointermove', 50 + 30 * 2, 20); // and back to cell 2 in one event: 4 and 3 again
  ptr(sg.el, 'pointerup', 50 + 30 * 2, 20);
  assert.deepEqual(V[0].slice(2, 6), [0, -0.33, -0.67, -1]);
  assert.deepEqual(calls.filter(c => c[1] === 'start').map(c => c[0]), [0, 1, 2, 3, 4, 5]); // one start per cell
  assert.deepEqual(calls.filter(c => c[1] === 'end').map(c => c[0]), [0, 1, 2, 3, 4, 5]);
  // Fine (Shift): the cells passed take the dragged value
  V[0].fill(0);
  ptr(cells[0], 'pointerdown', 50, 20, { shiftKey: true });
  ptr(sg.el, 'pointermove', 50 + 30 * 3, 10, { shiftKey: true });
  ptr(sg.el, 'pointerup', 50 + 30 * 3, 10);
  assert.deepEqual(V[0].slice(0, 5), [0, 0, 0, 0.05, 0]);
});

test('meter: the peak hold and the clip state expire by themselves when set() is not called again', () => {
  const d = fresh();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const m = wk.meter({ ch: 2, hold: 1000 });
    d.body.appendChild(m.el);
    const ch = byCls(m.el, 'wk-mch'), pk = byCls(m.el, 'wk-mpk');
    m.set(1.5, -6, 0);
    m.set(-120, -120, 33); // the callers skip repeated values: silence is set once
    assert.ok(ch[0].classList.contains('wk-clip'));
    mock.timers.tick(999);
    assert.ok(ch[0].classList.contains('wk-clip'));
    mock.timers.tick(10);
    assert.ok(!ch[0].classList.contains('wk-clip'));
    assert.deepEqual(pk.map(p => p.style.display), ['none', 'none']);
    // a newer peak restarts the hold
    m.set(-3, -3, 2000); m.set(-40, -40, 2033);
    mock.timers.tick(600);
    m.set(-2, -2, 2600); m.set(-40, -40, 2633);
    mock.timers.tick(600);
    assert.equal(pk[0].style.bottom, (wk.meter.pos(-2, -60, 6) * 100).toFixed(2) + '%');
    mock.timers.tick(500);
    assert.equal(pk[0].style.bottom, (wk.meter.pos(-40, -60, 6) * 100).toFixed(2) + '%');
    // reset / destroy stop the timer
    m.set(3, 3, 5000); m.set(-50, -50, 5033);
    m.destroy();
    mock.timers.tick(2000);
    assert.ok(ch[0].classList.contains('wk-clip'));
  } finally { mock.timers.reset(); }
});

test('dragSource: a lostpointercapture bubbling from a child (the implicit touch capture of a tile label) does not cancel the drag', () => {
  const d = fresh();
  const b = d.createElement('button'), lab = d.createElement('span');
  b.append(lab); d.body.append(b);
  const log = [];
  wk.dragSource(b, { data: 'lfo1', begin: () => log.push('begin'), move: () => log.push('move'), drop: () => log.push('drop'), cancel: () => log.push('cancel') });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const T = (tgt, type, x, y) => fire(tgt, type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, button: 0, cancelable: type !== 'lostpointercapture' });
    T(lab, 'pointerdown', 10, 10);
    mock.timers.tick(300);
    T(lab, 'pointermove', 30, 10); // start(): b takes the capture from the span
    T(lab, 'lostpointercapture', 30, 10); // the browser's event at the span, bubbling to b
    T(b, 'pointermove', 200, 50);
    T(b, 'pointerup', 200, 50);
    assert.deepEqual(log, ['begin', 'move', 'move', 'drop']);
    // b's own capture lost mid-drag still cancels
    log.length = 0;
    T(lab, 'pointerdown', 10, 10);
    mock.timers.tick(300);
    T(lab, 'pointermove', 30, 10);
    T(b, 'lostpointercapture', 30, 10);
    assert.deepEqual(log, ['begin', 'move', 'cancel']);
  } finally { mock.timers.reset(); }
});

// iPad Safari event order for one finger: pointerdown, touchstart, then per move pointermove + touchmove; when Safari
// starts a native pan it sends pointercancel (and no longer lets a touchmove be cancelled).
function touchRig(o = {}) {
  const d = fresh();
  const strip = d.createElement('div'), tile = d.createElement('button'), lab = d.createElement('span'), target = d.createElement('div');
  tile.append(lab); strip.append(tile); d.body.append(strip, target);
  d.elementFromPoint = () => target;
  const log = [];
  let menus = 0;
  const src = wk.dragSource(tile, Object.assign({
    data: 'lfo2',
    begin: i => log.push(['begin', i.pointerType, i.x, i.y]),
    move: i => log.push(['move', i.x, i.y, i.target === target]),
    drop: i => log.push(['drop', i.x, i.y, i.target === target]),
    cancel: () => log.push(['cancel']),
  }, o));
  tile.addEventListener('contextmenu', () => menus++); // the tile's own menu listener (added after the drag source)
  const P = (type, x, y, x2 = {}) => ptr(lab, type, x, y, Object.assign({ pointerType: 'touch', pointerId: 9 }, x2));
  // a touchmove at the touched node (the label span), one finger unless `n` says otherwise
  const TM = (x, y, n = 1) => fire(lab, 'touchmove', { touches: Array.from({ length: n }, (_, k) => ({ clientX: x + k * 40, clientY: y })) });
  const move = (x, y) => { P('pointermove', x, y); return TM(x, y); }; // Safari: the pointermove, then its touchmove
  return { d, tile, lab, target, log, src, P, TM, move, menus: () => menus };
}

test('dragSource scrollAxis x (iPad tile strip): an up / down finger drags at once, a sideways one is left to the native scroll', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { tile, log, src, P, TM, move } = touchRig({ scrollAxis: 'x' });
    // mainly vertical past 6 px: the drag starts at once (no hold), every touchmove from then on is cancelled
    P('pointerdown', 100, 100); fire(tile, 'touchstart');
    assert.equal(move(101, 104).defaultPrevented, false); // undecided (≤ 6 px): the browser may still scroll
    assert.deepEqual(log, []);
    assert.equal(move(103, 110).defaultPrevented, true);
    assert.deepEqual(log, [['begin', 'touch', 103, 110], ['move', 103, 110, true]]);
    assert.ok(src.active() && tile.classList.contains('wk-dragging') && !tile.classList.contains('wk-armed'));
    assert.equal(tile._cap, 9); // el holds the pointer capture (moves outside the tile still come here)
    assert.equal(move(400, 30).defaultPrevented, true); // any direction once dragging: no page / strip scroll
    P('pointerup', 400, 30);
    assert.deepEqual(log.slice(2), [['move', 400, 30, true], ['drop', 400, 30, true]]);
    let clicks = 0;
    tile.addEventListener('click', () => clicks++);
    tile.click(); // the click that ends the drag is swallowed
    assert.equal(clicks, 0);
    mock.timers.tick(1000); // the hold timer went with the start
    assert.ok(!tile.classList.contains('wk-armed') && !src.active());
    assert.equal(TM(400, 30).defaultPrevented, false);
    // mainly sideways: the strip's own scroll — abandoned, nothing cancelled; Safari's pointercancel when it pans is no cancel
    log.length = 0;
    P('pointerdown', 100, 100);
    assert.equal(move(109, 103).defaultPrevented, false);
    P('pointercancel', 109, 103);
    mock.timers.tick(300);
    assert.ok(!tile.classList.contains('wk-armed'));
    assert.equal(move(109, 180).defaultPrevented, false);
    assert.deepEqual(log, []);
    // a pointercancel from a system gesture mid-drag still cancels it
    P('pointerdown', 100, 100);
    move(100, 108);
    P('pointercancel', 100, 108);
    assert.deepEqual(log.map(l => l[0]), ['begin', 'move', 'cancel']);
    assert.ok(!src.active() && !tile.classList.contains('wk-dragging'));
    // a touchmove ahead of its pointermove decides too (it is cancelled; the pointermove starts the drag)
    log.length = 0;
    P('pointerdown', 100, 100);
    assert.equal(TM(102, 109).defaultPrevented, true);
    assert.deepEqual(log, []);
    P('pointermove', 102, 109);
    assert.equal(log[0][0], 'begin');
    P('pointerup', 102, 109);
    // a sideways touchmove ahead of its pointermove is not cancelled; two fingers decide nothing
    P('pointerdown', 100, 100);
    assert.equal(TM(110, 101).defaultPrevented, false);
    assert.equal(TM(100, 120, 2).defaultPrevented, false);
    P('pointerup', 100, 100);
    // mouse and pen: unchanged — 4 px of travel in any direction
    log.length = 0;
    ptr(tile, 'pointerdown', 100, 100);
    ptr(tile, 'pointermove', 103, 100);
    assert.deepEqual(log, []);
    ptr(tile, 'pointermove', 105, 100);
    assert.deepEqual(log[0], ['begin', 'mouse', 105, 100]);
    ptr(tile, 'pointerup', 105, 100);
    ptr(tile, 'pointerdown', 100, 100, { pointerType: 'pen' });
    ptr(tile, 'pointermove', 100, 95, { pointerType: 'pen' });
    assert.deepEqual(log.at(-2), ['begin', 'pen', 100, 95]);
    ptr(tile, 'pointerup', 100, 95, { pointerType: 'pen' });
    src.destroy();
    assert.equal(tile.listenerCount('touchmove'), 0);
  } finally { mock.timers.reset(); }
});

test('dragSource touch: a hold then any direction drags; a still hold (jitter) opens the long-press menu; a menu during the drag is swallowed', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { tile, log, src, P, move, menus } = touchRig({ scrollAxis: 'x' });
    // hold 250 ms (still), then sideways — along the strip's scroll axis — still drags
    P('pointerdown', 100, 100);
    mock.timers.tick(250);
    assert.ok(tile.classList.contains('wk-armed'));
    assert.equal(move(103, 101).defaultPrevented, true); // armed: no scroll from here on
    assert.deepEqual(log, []); // ≤ 6 px from where it was armed: jitter
    move(115, 101);
    assert.deepEqual(log[0], ['begin', 'touch', 115, 101]);
    P('pointerup', 115, 101);
    assert.deepEqual(log.at(-1), ['drop', 115, 101, true]);
    // a still hold with jitter until the 500 ms long-press: no drag, the menu opens, later moves do nothing
    log.length = 0;
    P('pointerdown', 100, 100);
    mock.timers.tick(250);
    move(102, 101); move(101, 103);
    mock.timers.tick(250);
    const cm = fire(tile, 'contextmenu', { clientX: 101, clientY: 103 }); // the long-press (serum-ui touchMenu)
    assert.equal(cm.defaultPrevented, false);
    assert.equal(menus(), 1);
    assert.ok(!tile.classList.contains('wk-armed'));
    assert.equal(move(100, 200).defaultPrevented, false);
    P('pointerup', 100, 200);
    assert.deepEqual(log, []);
    // a drag started within the long-press's 8 px: its late contextmenu is swallowed, the drag goes on
    P('pointerdown', 100, 100);
    move(100, 107);
    assert.ok(src.active());
    const late = fire(tile, 'contextmenu', { clientX: 100, clientY: 107 });
    assert.ok(late.defaultPrevented);
    assert.equal(menus(), 1);
    move(100, 300);
    P('pointerup', 100, 300);
    assert.deepEqual(log.map(l => l[0]), ['begin', 'move', 'move', 'drop']);
    src.destroy();
  } finally { mock.timers.reset(); }
});

test('dragSource scrollAxis: y (a vertical page) drags sideways at once, none drags any way, a function is read at each press; touchSlop; no axis = hold', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let ax = 'y';
    const { log, src, P, move } = touchRig({ scrollAxis: () => ax });
    P('pointerdown', 100, 100);
    assert.equal(move(102, 108).defaultPrevented, false); // vertical: the page scrolls
    P('pointercancel', 102, 108);
    P('pointerdown', 100, 100);
    assert.equal(move(108, 102).defaultPrevented, true); // sideways: ours
    P('pointerup', 108, 102);
    assert.deepEqual(log.map(l => l[0]), ['begin', 'move', 'drop']);
    ax = 'none';
    for (const [x, y] of [[100, 93], [93, 100], [105, 105]]) {
      log.length = 0;
      P('pointerdown', 100, 100);
      move(x, y);
      P('pointerup', x, y);
      assert.deepEqual(log.map(l => l[0]), ['begin', 'move', 'drop'], x + ',' + y);
    }
    // an unknown value, or a function that throws: the hold-only gesture (> 8 px before the hold = a scroll)
    for (const bad of ['z', () => { throw new Error('x'); }]) {
      ax = bad;
      const { log: L, P: P2, move: m2 } = touchRig({ scrollAxis: typeof bad === 'function' ? bad : () => ax });
      P2('pointerdown', 100, 100);
      assert.equal(m2(100, 107).defaultPrevented, false);
      m2(100, 110);
      mock.timers.tick(300);
      m2(100, 140);
      P2('pointerup', 100, 140);
      assert.deepEqual(L, []);
    }
    src.destroy();
    // touchSlop widens the decision distance
    const r = touchRig({ scrollAxis: 'x', touchSlop: 12 });
    r.P('pointerdown', 100, 100);
    r.move(100, 110);
    assert.deepEqual(r.log, []);
    r.move(100, 113);
    assert.equal(r.log[0][0], 'begin');
    r.P('pointerup', 100, 113);
  } finally { mock.timers.reset(); }
});

test('dragSource touch: one finger — a non-primary touch starts nothing; a second pointer down or a two-touch touchmove abandons a pending gesture (hold or axis); a started drag goes on', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { d, tile, log, src, P, TM, move } = touchRig({ scrollAxis: 'x' });
    const other = d.createElement('div');
    d.body.append(other);
    const P2 = (type, n, x, y) => ptr(n, type, x, y, { pointerType: 'touch', pointerId: 10, isPrimary: false });
    // a second finger elsewhere, then the first moves down: no drag, its moves are left to the browser (a pinch / scroll)
    P('pointerdown', 100, 100, { isPrimary: true });
    assert.equal(d.listenerCount('pointerdown'), 1); // watched while pending
    P2('pointerdown', other, 300, 100);
    assert.equal(d.listenerCount('pointerdown'), 0);
    assert.equal(move(100, 112).defaultPrevented, false);
    assert.equal(TM(100, 130, 2).defaultPrevented, false);
    mock.timers.tick(300);
    assert.ok(!tile.classList.contains('wk-armed'));
    P2('pointerup', other, 300, 100);
    P('pointerup', 100, 130);
    assert.deepEqual(log, []);
    // a non-primary touch on el itself starts nothing
    P('pointerdown', 100, 100, { pointerId: 11, isPrimary: false });
    move(100, 120);
    P('pointermove', 100, 120, { pointerId: 11 });
    P('pointerup', 100, 120, { pointerId: 11 });
    assert.deepEqual(log, []);
    assert.equal(d.listenerCount('pointerdown'), 0);
    // armed by the hold, then a two-touch touchmove (a second finger landed off the page's view of el): abandoned
    P('pointerdown', 100, 100, { isPrimary: true });
    mock.timers.tick(260);
    assert.ok(tile.classList.contains('wk-armed'));
    assert.equal(TM(100, 104, 2).defaultPrevented, false);
    assert.ok(!tile.classList.contains('wk-armed'));
    assert.equal(move(100, 140).defaultPrevented, false);
    P('pointerup', 100, 140);
    assert.deepEqual(log, []);
    assert.equal(d.listenerCount('pointerdown'), 0);
    // a started drag ignores a second finger and still drops
    P('pointerdown', 100, 100, { isPrimary: true });
    move(100, 110);
    assert.ok(src.active());
    assert.equal(d.listenerCount('pointerdown'), 0); // no longer watched once started
    P2('pointerdown', other, 300, 100);
    assert.equal(TM(100, 130, 2).defaultPrevented, true);
    move(100, 140);
    P2('pointerup', other, 300, 100);
    P('pointerup', 100, 140);
    assert.deepEqual(log.map(l => l[0]), ['begin', 'move', 'move', 'drop']);
    // mouse: no document watch, a touch elsewhere does not end a mouse drag
    log.length = 0;
    ptr(tile, 'pointerdown', 100, 100);
    assert.equal(d.listenerCount('pointerdown'), 0);
    ptr(tile, 'pointermove', 110, 100);
    P2('pointerdown', other, 300, 100);
    ptr(tile, 'pointerup', 110, 100);
    assert.deepEqual(log.map(l => l[0]), ['begin', 'move', 'drop']);
    src.destroy();
  } finally { mock.timers.reset(); }
});

test('dragSource info: quick (a touch drag started without the hold) and t (the event time)', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const seen = [];
    const rec = k => i => seen.push([k, i.pointerType, i.quick, i.t]);
    const { P, move } = touchRig({ scrollAxis: 'x', begin: rec('begin'), move: rec('move'), drop: rec('drop'), cancel: rec('cancel') });
    P('pointerdown', 100, 100, { timeStamp: 5000 });
    P('pointermove', 100, 110, { timeStamp: 5016 });
    P('pointerup', 100, 110, { timeStamp: 5200 });
    assert.deepEqual(seen, [['begin', 'touch', true, 5016], ['move', 'touch', true, 5016], ['drop', 'touch', true, 5200]]);
    seen.length = 0;
    P('pointerdown', 100, 100, { timeStamp: 6000 });
    mock.timers.tick(260);
    move(100, 110);
    P('pointercancel', 100, 110, { timeStamp: 6400 });
    assert.deepEqual(seen.map(s => s.slice(0, 3)), [['begin', 'touch', false], ['move', 'touch', false], ['cancel', 'touch', false]]);
    assert.equal(seen[2][3], 6400);
    seen.length = 0;
    const r = touchRig({ begin: rec('begin') });
    ptr(r.tile, 'pointerdown', 100, 100);
    ptr(r.tile, 'pointermove', 110, 100, { timeStamp: 0 }); // no event time: performance.now()
    assert.equal(seen[0][2], false);
    assert.ok(seen[0][3] > 0);
    ptr(r.tile, 'pointerup', 110, 100);
  } finally { mock.timers.reset(); }
});

test('zoomPan: touches are followed through the document (a finger lifted outside is forgotten), a primary touch drops stale ones, o.rect anchors', () => {
  const d = fresh();
  const el = d.createElement('div');
  d.body.appendChild(el);
  place(el, 0, 0, 200, 100);
  let view = { x0: 0, x1: 1, y0: 0, y1: 1 };
  const zp = wk.zoomPan(el, { get: () => view, set: v => { view = v; } });
  const T = (tgt, type, id, x, y, o = {}) => ptr(tgt, type, x, y, Object.assign({ pointerType: 'touch', pointerId: id }, o));
  T(el, 'pointerdown', 1, 80, 50); T(el, 'pointerdown', 2, 120, 50);
  assert.ok(zp.active());
  T(d.body, 'pointermove', 1, -20, 50); // finger 1 outside el: still part of the pinch
  near(view.x1 - view.x0, 40 / 140, 1e-9);
  T(d.body, 'pointerup', 1, -30, 50); // lifted outside el
  assert.ok(!zp.active());
  T(el, 'pointerup', 2, 120, 50);
  T(el, 'pointerdown', 3, 100, 50);
  assert.ok(!zp.active()); // one finger is one finger
  T(el, 'pointerup', 3, 100, 50);
  // a pointerup that never arrives anywhere: the next primary touch drops it
  T(el, 'pointerdown', 4, 100, 50);
  T(el, 'pointerdown', 5, 60, 50, { isPrimary: true });
  assert.ok(!zp.active());
  T(el, 'pointerup', 5, 60, 50);
  assert.equal(d.listenerCount('pointermove'), 0); // the document listeners go with the last touch
  zp.destroy();
  // o.rect: the plot the view is drawn into (here inset 10 px left and right) anchors the pinch
  view = { x0: 0, x1: 1, y0: 0, y1: 1 };
  const z2 = wk.zoomPan(el, { get: () => view, set: v => { view = v; }, rect: () => ({ left: 10, top: 0, width: 180, height: 100 }) });
  T(el, 'pointerdown', 6, 40, 50); T(el, 'pointerdown', 7, 80, 50);
  T(el, 'pointermove', 6, 20, 50); T(el, 'pointermove', 7, 100, 50); // ×2 around x = 60 px = 50 / 180 of the plot
  near(view.x1 - view.x0, 0.5, 1e-9);
  near(view.x0 + (50 / 180) * 0.5, 50 / 180, 1e-9);
  T(el, 'pointerup', 6, 20, 50); T(el, 'pointerup', 7, 100, 50);
  z2.destroy();
});

test('menuSource: a second touch cancels the long-press and arms none; a primary touch forgets lost pointers', () => {
  const d = fresh();
  const el = d.createElement('div');
  d.body.appendChild(el);
  const got = [];
  el.addEventListener('contextmenu', () => got.push(1));
  const off = wk.menuSource(el);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const T = (type, id, o = {}) => ptr(el, type, 10, 10, Object.assign({ pointerType: 'touch', pointerId: id }, o));
    T('pointerdown', 1); T('pointerdown', 2); // a pinch (its moves never reach el)
    mock.timers.tick(800);
    assert.equal(got.length, 0);
    T('pointerup', 2); T('pointerup', 1);
    T('pointerdown', 3, { isPrimary: false }); // a non-primary touch arms nothing either
    mock.timers.tick(800);
    assert.equal(got.length, 0);
    T('pointerdown', 4, { isPrimary: true }); // finger 3's pointerup went elsewhere: forgotten
    mock.timers.tick(500);
    assert.equal(got.length, 1);
    T('pointerup', 4);
  } finally { mock.timers.reset(); }
  off();
});

test('ticker: the frame-rate gate comes first (matchMedia / getClientRects only on frames that may draw)', () => {
  const d = fresh();
  raf.install();
  const mm = globalThis.matchMedia;
  let calls = 0, rects = 0, draws = 0;
  globalThis.matchMedia = () => { calls++; return { matches: false }; };
  try {
    const el = d.createElement('canvas');
    d.body.appendChild(el);
    el.getClientRects = () => { rects++; return [1]; };
    const tk = wk.ticker(el, () => { draws++; });
    tk.start();
    for (let i = 0; i < 120; i++) raf.flush(1, i * 1000 / 120); // 1 s at 120 Hz
    assert.deepEqual([draws, calls, rects], [30, 30, 30]);
    el.getClientRects = () => { rects++; return []; }; // hidden: probed at the frame rate, never drawn
    rects = 0;
    for (let i = 120; i < 240; i++) raf.flush(1, i * 1000 / 120);
    assert.deepEqual([draws, rects], [30, 30]);
    tk.stop();
  } finally {
    if (mm === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = mm;
    raf.uninstall();
  }
});

/* ------------------------------------- dragSource edge auto-scroll (iPad: reach a control scrolled out of view) */
// No assert on fake-DOM nodes here (an AssertionError would walk the cyclic fake DOM): ids, numbers and booleans only.
test('dragSource.edge: 0 mid-band, ±max past an edge (any zone), quadratic depth, zone ≤ a quarter of the band', () => {
  const E = wk.dragSource.edge;
  assert.equal(typeof E, 'function');
  assert.equal(E(300, 73, 569, 72, 1500), 0);
  assert.equal(E(73, 73, 569, 72, 1500), -1500);
  assert.equal(E(10, 73, 569, 72, 1500), -1500);   // over the sticky header: past the edge
  assert.equal(E(569, 73, 569, 72, 1500), 1500);
  assert.equal(E(700, 73, 569, 72, 1500), 1500);   // over the keyboard panel
  near(E(73 + 36, 73, 569, 72, 1500), -375, 1e-9); // half way in: a quarter of the speed
  near(E(569 - 18, 73, 569, 72, 1500), 1500 * 0.75 * 0.75, 1e-9);
  near(E(110, 100, 200, 72, 1000), -360, 1e-9);    // a 100 px band: 25 px zones
  assert.equal(E(150, 100, 100, 72, 1000), 0);
  assert.equal(E(NaN, 0, 800, 72, 1000), 0);
  // no zone (a mouse): nothing inside the band, full speed past either edge
  assert.equal(E(10, 0, 800, 0, 1000), 0);
  assert.equal(E(0, 0, 800, 0, 1000), 0);
  assert.equal(E(-5, 0, 800, 0, 1000), -1000);
  assert.equal(E(801, 0, 800, 0, 1000), 1000);
});

// A 3000 px page in an 800 px window: a sticky header (73 px, data-wk-inset=top) and the keyboard panel (231 px,
// data-wk-inset=bottom) leave the band 73…569; a control every 100 px of page (elementFromPoint follows the scroll).
// scroller(): scrollTop clamps and rounds like Chrome's; ios = true stores whatever is set (iOS reads an out-of-range
// script scroll back as set, WebKit bug 179735) and logs every value written.
function scroller(n, top, h, ios = false) {
  let st = top;
  n.wrote = [];
  Object.defineProperty(n, 'scrollTop', { configurable: true, get: () => st, set: v => { n.wrote.push(v); st = ios ? v : Math.max(0, Math.min(Math.round(v), h - n.clientHeight)); } });
  n.scrollHeight = h;
  return n;
}
function scrollRig(o = {}) {
  const d = fresh();
  raf.install();
  const html = d.documentElement;
  place(html, 0, 0, 1280, 800);
  scroller(html, o.top != null ? o.top : 1000, 3000, !!o.ios);
  const hdr = d.createElement('header'), perf = d.createElement('section'), tile = d.createElement('button');
  hdr.setAttribute('data-wk-inset', 'top'); perf.setAttribute('data-wk-inset', 'bottom');
  hdr.id = 'hdr'; perf.id = 'perf';
  place(hdr, 0, 0, 1280, 73); place(perf, 0, 569, 1280, 231);
  const knobs = Array.from({ length: 30 }, (_, k) => { const n = d.createElement('div'); n.id = 'k' + k; return n; });
  d.body.append(hdr, tile, ...knobs, perf);
  d.querySelectorAll = sel => (sel === '[data-wk-inset]' ? [hdr, perf] : []);
  d.defaultView.getComputedStyle = n => n._cs || { overflowY: 'visible', scrollPaddingTop: 'auto', scrollPaddingBottom: 'auto' };
  const page = (x, y) => (y < 73 ? hdr : y >= 569 ? perf : knobs[Math.floor((y + html.scrollTop) / 100)] || d.body);
  d.elementFromPoint = (x, y) => (o.at && o.at(x, y)) || page(x, y);
  const log = [];
  const src = wk.dragSource(tile, Object.assign({
    data: 'lfo1', scrollAxis: 'none',
    begin: () => log.push(['begin']),
    move: i => log.push(['move', i.x, i.y, i.target ? i.target.id : null, i.t, i.scrolled]),
    drop: i => log.push(['drop', i.x, i.y, i.target ? i.target.id : null, i.t, i.scrolled]),
    cancel: () => log.push(['cancel']),
  }, o.payload));
  const type = o.type || 'touch';
  const T = (kind, x, y, t, x2 = {}) => ptr(tile, kind, x, y, Object.assign({ pointerType: type, pointerId: 3, isPrimary: true, timeStamp: t }, x2));
  const frames = (n, t0) => { for (let k = 0; k < n; k++) raf.flush(1, t0 + k * 40); };
  return { d, html, hdr, perf, tile, knobs, log, src, T, frames };
}

test('dragSource auto-scroll: a finger in the top band scrolls the page up — ramping in, faster deeper, re-hit-testing every frame — and stops at the top', () => {
  try {
    const { html, log, src, T, frames } = scrollRig({ top: 300 });
    T('pointerdown', 600, 400, 5000);
    T('pointermove', 600, 390, 5016);                 // a quick drag (scrollAxis none) mid-band: no frames
    assert.deepEqual(log.map(l => l[0]), ['begin', 'move']);
    assert.equal(log[1][5], Infinity);                // not scrolled
    assert.equal(raf.pending, 0);
    T('pointermove', 600, 80, 5100);                  // 65 px into the 72 px zone under the header
    assert.equal(raf.pending, 1);
    frames(1, 0);                                     // the episode's first frame: no time has passed
    assert.equal(html.scrollTop, 300);
    frames(1, 40);                                    // 40 ms at 1/6 of the ramp: 1200 · 0.815 · 40/240 · 0.04 ≈ 6.5 px
    assert.equal(html.scrollTop, 294);
    const m = log.at(-1);
    assert.deepEqual(m.slice(0, 4), ['move', 600, 80, 'k3']); // same point, the control now under it ((80 + 294) / 100)
    assert.equal(m[4], 5140);                         // t: the last event's time + the frames since
    assert.equal(m[5], 0);
    let prev = 294, steps = [];
    for (let k = 2; k < 40 && raf.pending; k++) { frames(1, k * 40); steps.push(prev - html.scrollTop); prev = html.scrollTop; }
    assert.equal(html.scrollTop, 0);                  // the top: the frames stop
    assert.equal(raf.pending, 0);
    assert.ok(steps[1] > steps[0] && steps[4] > steps[1]); // ramping in
    assert.ok(Math.max(...steps) <= Math.ceil(1200 * 0.82 * 0.04)); // never past the depth's speed
    const ids = log.filter(l => l[0] === 'move' && l[2] === 80).map(l => l[3]);
    assert.deepEqual([...new Set(ids)], ['k3', 'k2', 'k1', 'k0']); // targets came under the still finger
    const ts = log.filter(l => l[0] === 'move').map(l => l[4]);
    assert.ok(ts.every((t, k) => !k || t >= ts[k - 1]));
    T('pointerup', 600, 80, 6400);
    assert.deepEqual(log.at(-1).slice(0, 4), ['drop', 600, 80, 'k0']);
    assert.ok(log.at(-1)[5] > 0 && log.at(-1)[5] < Infinity); // ms since the last scroll step
    src.destroy();
  } finally { raf.uninstall(); }
});

test('dragSource auto-scroll: a drag that starts in an edge band does not scroll that way until it left the band or moved 12 px toward the edge', () => {
  try {
    const { html, log, T, frames } = scrollRig({ top: 1000 });
    // the tile strip just above the keyboard panel: the drag starts in the bottom band and goes up
    T('pointerdown', 600, 540, 5000);
    T('pointermove', 600, 532, 5016);
    T('pointermove', 600, 520, 5032);
    assert.equal(log[0][0], 'begin');
    assert.equal(raf.pending, 0);
    T('pointermove', 600, 543, 5048);                 // 11 px down from the start: not yet
    assert.equal(raf.pending, 0);
    T('pointermove', 600, 545, 5064);                 // 13 px: the user means it
    assert.equal(raf.pending, 1);
    frames(8, 0);
    assert.ok(html.scrollTop > 1000);
    T('pointerup', 600, 545, 5500);
    assert.equal(raf.pending, 0);
    // left the band, then came back: scrolls
    T('pointerdown', 600, 540, 6000);
    T('pointermove', 600, 532, 6016);
    T('pointermove', 600, 400, 6032);
    assert.equal(raf.pending, 0);
    T('pointermove', 600, 560, 6048);
    assert.equal(raf.pending, 1);
    T('pointerup', 600, 560, 6100);
    // the top band from a start in the bottom one: armed at once
    T('pointerdown', 600, 540, 7000);
    T('pointermove', 600, 532, 7016);
    T('pointermove', 600, 90, 7032);
    assert.equal(raf.pending, 1);
    T('pointercancel', 600, 90, 7040);
    assert.equal(raf.pending, 0);
  } finally { raf.uninstall(); }
});

test('dragSource auto-scroll: drop, cancel, Escape, destroy and a hidden page stop it — nothing scrolls or moves after the gesture', () => {
  try {
    const { d, html, log, src, T, frames } = scrollRig({ top: 1500 });
    const go = t => { T('pointerdown', 600, 400, t); T('pointermove', 600, 390, t + 16); T('pointermove', 600, 560, t + 32); frames(4, t); };
    for (const [how, end] of [['drop', () => T('pointerup', 600, 560, 9000)], ['cancel', () => T('pointercancel', 600, 560, 9000)],
      ['cancel', () => key(d.body, 'Escape')], [null, () => src.cancel()]]) {
      log.length = 0;
      go(8000);
      const top = html.scrollTop;
      assert.ok(top > 1500, String(how));
      end();
      assert.equal(raf.pending, 0, String(how));
      const n = log.length;
      frames(5, 9000);
      assert.equal(html.scrollTop, top);
      assert.equal(log.length, n);
      if (how) assert.equal(log.at(-1)[0], how);
      T('pointerup', 600, 560, 9100);
      html.scrollTop = 1500;
    }
    // hidden mid-drag: the frames stop, the drag goes on; the next move starts them again (the ramp anew)
    go(10000);
    d.visibilityState = 'hidden';
    fire(d, 'visibilitychange');
    assert.equal(raf.pending, 0);
    d.visibilityState = 'visible';
    assert.ok(src.active());
    T('pointermove', 600, 561, 10200);
    assert.equal(raf.pending, 1);
    const top = html.scrollTop;
    frames(1, 20000);
    assert.equal(html.scrollTop, top);               // first frame of the new episode: no time yet
    src.destroy();
    assert.equal(raf.pending, 0);
    assert.equal(d.listenerCount('visibilitychange'), 0);
    // a move callback that ends the drag from a scrolled frame (the consumer cancels): no frame after it
    let stop = false;
    const r2 = scrollRig({ top: 1500, payload: { move: () => { if (stop) r2.src.cancel(); } } });
    r2.T('pointerdown', 600, 400, 5000); r2.T('pointermove', 600, 390, 5016); r2.T('pointermove', 600, 560, 5032);
    r2.frames(2, 0);
    stop = true;
    r2.frames(1, 80);
    assert.ok(!r2.src.active());
    assert.equal(raf.pending, 0);
  } finally { raf.uninstall(); }
});

test('dragSource auto-scroll: the innermost scrolling container under the pointer goes first (overflow hidden never), then the page; vertical only', () => {
  try {
    let list, row, wrap;
    const { d, html, src, T, frames } = scrollRig({ top: 1000, at: (x, y) => (list && y >= 200 && y < 500 && x < 600 ? row : null) });
    // the MATRIX list: 300 px tall at y 200, scrolled 30 px, in an overflow: hidden wrapper that must not scroll
    wrap = d.createElement('div'); list = d.createElement('div'); row = d.createElement('div');
    wrap._cs = { overflowX: 'hidden', overflowY: 'hidden' };
    list._cs = { overflowX: 'auto', overflowY: 'auto' };
    place(wrap, 0, 150, 600, 400); scroller(wrap, 0, 2000);
    place(list, 0, 200, 600, 300); scroller(list, 30, 1000);
    list.append(row); wrap.append(list); d.body.append(wrap);
    T('pointerdown', 300, 350, 5000);
    T('pointermove', 300, 340, 5016);
    T('pointermove', 300, 210, 5032);               // in the list's top zone (200…272), far below the page's (73…145)
    frames(12, 0);
    assert.equal(list.scrollTop, 0);
    assert.equal(html.scrollTop, 1000);
    assert.equal(wrap.scrollTop, 0);
    assert.equal(wrap.wrote.length, 0);
    assert.equal(raf.pending, 0);                   // the list is at its top, the page band does not ask
    T('pointermove', 300, 100, 5200);               // over the list's top edge, in the page's band: the page scrolls
    frames(6, 1000);
    assert.ok(html.scrollTop < 1000);
    T('pointerup', 300, 100, 6000);
    // near the list's right end (a sideways scroller too): nothing scrolls sideways or at all mid-height
    const top = html.scrollTop, n = list.wrote.length;
    T('pointerdown', 300, 350, 7000);
    T('pointermove', 300, 340, 7016);
    T('pointermove', 595, 350, 7032);
    assert.equal(raf.pending, 0);
    T('pointerup', 595, 350, 7100);
    assert.equal(html.scrollTop, top);
    assert.equal(list.wrote.length, n);
    src.destroy();
  } finally { raf.uninstall(); }
});

test('dragSource auto-scroll: steps clamp to the scroll range in JS — an unclamped iOS-style scroller never goes out of range and the loop stops at the limit', () => {
  try {
    // top: 30 px left, a finger over the header (full speed, 48 px a frame after the ramp)
    let r = scrollRig({ top: 30, ios: true });
    r.T('pointerdown', 600, 400, 5000); r.T('pointermove', 600, 390, 5016); r.T('pointermove', 600, 40, 5032);
    r.frames(20, 0);
    assert.equal(r.html.scrollTop, 0);
    assert.ok(r.html.wrote.length > 0 && r.html.wrote.every(v => v >= 0 && v <= 2200), JSON.stringify(r.html.wrote));
    assert.equal(raf.pending, 0);                   // at the limit: no frame scheduled
    r.T('pointerup', 600, 40, 6000);
    r.src.destroy(); raf.uninstall();
    // bottom: the page's visible height is the larger of clientHeight and innerHeight (700 vs 800: limit 3000 − 800)
    r = scrollRig({ top: 2190, ios: true });
    place(r.html, 0, 0, 1280, 700);
    r.T('pointerdown', 600, 400, 5000); r.T('pointermove', 600, 410, 5016); r.T('pointermove', 600, 700, 5032);
    r.frames(20, 0);
    assert.equal(r.html.scrollTop, 2200);
    assert.ok(r.html.wrote.length > 0 && r.html.wrote.every(v => v >= 0 && v <= 2200), JSON.stringify(r.html.wrote));
    assert.equal(raf.pending, 0);
    r.T('pointerup', 600, 700, 6000);
    r.src.destroy();
  } finally { raf.uninstall(); }
});

test('dragSource in the canvas world (setEdgeHook): what no DOM scroller takes goes to the camera hook (from the press point; null at drop / cancel / a hidden page / while a scroller scrolls); a camera step re-fires move at the same x, y with scrolled 0; autoScroll false and drags outside the world never call it', () => {
  const sj = v => JSON.stringify(v); // (primitives / JSON only)
  const pans = [], cams = new Set();
  const hook = { pan: p => pans.push(p ? [p.x, p.y, p.pointerType] : null), onCamera: cb => { cams.add(cb); return () => cams.delete(cb); } };
  const step = () => { for (const f of [...cams]) f({ tx: 0, ty: -10, k: 1 }); };
  wk.setEdgeHook(hook);
  try {
    const r = scrollRig({ top: 0 });
    r.html.scrollHeight = 0; // the canvas app: the page never scrolls (#app fixed, #viewport clips)
    const W = r.d.createElement('div'); W.setAttribute('data-cv-world', ''); r.d.body.appendChild(W); W.appendChild(r.tile);
    r.T('pointerdown', 600, 400, 5000); r.T('pointermove', 600, 390, 5016);
    assert.equal(sj([pans[0], cams.size]), sj([[600, 390, 'touch'], 1]), 'begin: the start point (arms the directions it does not ask for)');
    r.T('pointermove', 600, 560, 5032); // in the bottom zone: no DOM scroller can go down
    assert.equal(sj([pans.at(-1), raf.pending]), sj([[600, 560, 'touch'], 0]), 'the camera, not a DOM scroll');
    const n = r.log.length;
    step();
    assert.equal(sj(r.log.at(-1).slice(0, 3).concat(r.log.at(-1)[5], r.log.length - n)), sj(['move', 600, 560, 0, 1]), 'a camera step: move again at the same point, scrolled 0');
    r.T('pointerup', 600, 560, 5400);
    assert.equal(sj([r.log.at(-1)[0], pans.at(-1), cams.size]), sj(['drop', null, 0]), 'drop: the camera stops first, unsubscribed');
    step();
    assert.equal(r.log.at(-1)[0], 'drop', 'no move after the drop');
    // Escape and a hidden page stop it too
    for (const end of [() => key(r.d.body, 'Escape'), () => { r.d.visibilityState = 'hidden'; fire(r.d, 'visibilitychange'); r.d.visibilityState = 'visible'; r.T('pointerup', 600, 100, 6200); }]) {
      pans.length = 0;
      r.T('pointerdown', 600, 400, 6000); r.T('pointermove', 600, 390, 6016); r.T('pointermove', 600, 100, 6032);
      assert.equal(sj(pans.at(-1)), sj([600, 100, 'touch']));
      end();
      assert.equal(sj([pans.at(-1), cams.size]), sj([null, 0]));
    }
    // a DOM scroller inside the world that can still scroll keeps priority: the camera gets null meanwhile
    const list = r.d.createElement('div'), row = r.d.createElement('div');
    list._cs = { overflowX: 'auto', overflowY: 'auto' }; place(list, 0, 200, 600, 300); scroller(list, 300, 1000);
    list.append(row); W.append(list);
    r.d.elementFromPoint = (x, y) => (y >= 200 && y < 500 && x < 600 ? row : r.d.body);
    pans.length = 0;
    r.T('pointerdown', 300, 350, 7000); r.T('pointermove', 300, 340, 7016); r.T('pointermove', 300, 490, 7032);
    assert.equal(sj([pans.at(-1), raf.pending]), sj([null, 1]), 'the list scrolls; the camera waits');
    r.T('pointerup', 300, 490, 7100);
    r.src.destroy();
    // autoScroll: false (module bars, the Sources tray drive dragPointer themselves) and a tile outside the world: never
    for (const [inW, payload] of [[true, { autoScroll: false }], [false, {}]]) {
      raf.uninstall();
      const r2 = scrollRig({ top: 0, payload });
      r2.html.scrollHeight = 0;
      if (inW) { const W2 = r2.d.createElement('div'); W2.setAttribute('data-cv-world', ''); r2.d.body.appendChild(W2); W2.appendChild(r2.tile); }
      pans.length = 0;
      r2.T('pointerdown', 600, 400, 5000); r2.T('pointermove', 600, 390, 5016); r2.T('pointermove', 600, 560, 5032); r2.T('pointerup', 600, 560, 5100);
      assert.equal(sj([pans.length, cams.size, r2.log.at(-1)[0]]), sj([0, 0, 'drop']), inW ? 'autoScroll false' : 'outside the world');
      r2.src.destroy();
    }
  } finally { wk.setEdgeHook(null); raf.uninstall(); }
});

test('dragSource auto-scroll: a mouse has no zone — nothing inside the band, full speed over the header, the keyboard or outside the window', () => {
  try {
    const r = scrollRig({ top: 1000, type: 'mouse' });
    r.T('pointerdown', 600, 400, 5000); r.T('pointermove', 600, 390, 5016);
    r.T('pointermove', 600, 74, 5032);              // just under the header (a finger's zone): still
    assert.equal(raf.pending, 0);
    r.T('pointermove', 600, 568, 5040);             // just above the keyboard panel: still
    assert.equal(raf.pending, 0);
    r.T('pointermove', 600, 50, 5048);              // over the header: up at 1200 px/s
    r.frames(10, 0);                                // ramp done after 240 ms: then 48 px a 40 ms frame
    let a = r.html.scrollTop;
    r.frames(1, 400);
    assert.equal(a - r.html.scrollTop, 48);
    r.T('pointermove', 600, 300, 5600);             // back in the band: stops
    r.frames(1, 440);
    assert.equal(raf.pending, 0);
    r.T('pointermove', 600, 700, 5700);             // over the keyboard panel: down
    r.frames(10, 1000);
    a = r.html.scrollTop;
    r.frames(1, 1400);
    assert.equal(r.html.scrollTop - a, 48);
    r.T('pointermove', 600, -20, 5800);             // above the window (pointer capture): up again
    r.frames(10, 2000);
    a = r.html.scrollTop;
    r.frames(1, 2400);
    assert.equal(a - r.html.scrollTop, 48);
    r.T('pointerup', 600, -20, 6000);
    r.src.destroy();
  } finally { raf.uninstall(); }
});

test('dragSource auto-scroll: the root scroll-padding narrows the band (the PWA status-bar strip); sub-pixel speeds carry over; visual viewport; autoScroll: false', () => {
  try {
    // header scrolled away (11" portrait: static below 900 px), scroll-padding-top 24 px: the band starts at 24
    let r = scrollRig({ top: 1000, type: 'mouse' });
    r.hdr.remove();
    r.html._cs = { overflowY: 'visible', scrollPaddingTop: '24px', scrollPaddingBottom: '0px' };
    r.T('pointerdown', 600, 400, 5000); r.T('pointermove', 600, 390, 5016);
    r.T('pointermove', 600, 30, 5032);              // inside the band: a mouse stays
    assert.equal(raf.pending, 0);
    r.T('pointermove', 600, 20, 5048);              // in the strip: past the band's top
    assert.equal(raf.pending, 1);
    r.T('pointerup', 600, 20, 5100);
    r.src.destroy(); raf.uninstall();
    // the same for a finger: its 72 px zone starts at 24 (24…96); without the padding 95 would be mid-band
    for (const [pad, want] of [['24px', 1], ['auto', 0], ['10%', 0]]) {
      r = scrollRig({ top: 1000 });
      r.hdr.remove();
      r.html._cs = { overflowY: 'visible', scrollPaddingTop: pad, scrollPaddingBottom: 'auto' };
      r.T('pointerdown', 600, 400, 5000); r.T('pointermove', 600, 390, 5016);
      r.T('pointermove', 600, 95, 5032);
      assert.equal(raf.pending, want, pad);
      r.T('pointerup', 600, 95, 5100);
      r.src.destroy(); raf.uninstall();
    }
    // scroll-padding-bottom: with the keyboard panel gone, the band ends 30 px above the window's bottom
    r = scrollRig({ top: 1000, type: 'mouse' });
    r.perf.remove();
    r.html._cs = { overflowY: 'visible', scrollPaddingTop: '0px', scrollPaddingBottom: '30px' };
    r.T('pointerdown', 600, 400, 5000); r.T('pointermove', 600, 390, 5016);
    r.T('pointermove', 600, 765, 5032);
    assert.equal(raf.pending, 0);
    r.T('pointermove', 600, 775, 5048);
    assert.equal(raf.pending, 1);
    r.T('pointerup', 600, 775, 5100);
    r.src.destroy(); raf.uninstall();
    // a shallow finger: 12 px/s → under a pixel per frame, yet the page creeps
    r = scrollRig({ top: 1000 });
    r.T('pointerdown', 600, 400, 5000); r.T('pointermove', 600, 390, 5016);
    r.T('pointermove', 600, 145 - 7.2, 5032);
    r.frames(31, 0);                                // 1.2 s
    assert.ok(r.html.scrollTop <= 1000 - 10 && r.html.scrollTop >= 1000 - 16, String(r.html.scrollTop));
    r.T('pointerup', 600, 138, 7000);
    r.src.destroy(); raf.uninstall();
    // pinch-zoomed: the visual viewport is the band (the bars outside it do not count)
    r = scrollRig({ top: 1000 });
    r.d.defaultView.visualViewport = { offsetLeft: 0, offsetTop: 200, width: 640, height: 300 };
    r.T('pointerdown', 300, 350, 5000); r.T('pointermove', 300, 340, 5016);
    r.T('pointermove', 300, 490, 5032);             // 10 px above the visual bottom (500)
    assert.equal(raf.pending, 1);
    r.T('pointermove', 300, 350, 5048);
    r.frames(1, 0);
    assert.equal(raf.pending, 0);                   // back mid-band: the frames stop
    r.T('pointerup', 300, 350, 6000);
    r.src.destroy(); raf.uninstall();
    // autoScroll: false
    r = scrollRig({ top: 1000, payload: { autoScroll: false } });
    r.T('pointerdown', 600, 400, 5000); r.T('pointermove', 600, 390, 5016); r.T('pointermove', 600, 80, 5032);
    assert.equal(raf.pending, 0);
    r.T('pointerup', 600, 80, 6000);
    assert.equal(r.html.scrollTop, 1000);
    r.src.destroy();
  } finally { raf.uninstall(); }
});

test('dragSource auto-scroll (iOS, WebKit bug 181954): just after a page step, a far jump of the finger is dropped (never two moves in a row); the lift uses the last good point', () => {
  try {
    const { log, T, frames } = scrollRig({ top: 1500 });
    T('pointerdown', 600, 400, 5000); T('pointermove', 600, 390, 5016);
    T('pointermove', 600, 80, 5032);
    frames(6, 0);                                     // the page scrolled at t ≈ 5032 + 200
    const n = log.length;
    T('pointermove', 600, 300, 5250);                 // 220 px in one move: dropped
    assert.equal(log.length, n);
    T('pointermove', 600, 83, 5260);                  // the finger is still up there
    assert.deepEqual(log.at(-1).slice(0, 3), ['move', 600, 83]);
    T('pointermove', 600, 300, 5270);
    T('pointermove', 600, 320, 5280);                 // the next is taken: a real fast move
    assert.deepEqual(log.at(-1).slice(0, 3), ['move', 600, 320]);
    T('pointermove', 600, 84, 5285);                  // far: dropped …
    T('pointermove', 600, 500, 5287);                 // … but never two in a row (sparse moves of a busy page are real)
    assert.deepEqual(log.at(-1).slice(0, 3), ['move', 600, 500]);
    T('pointermove', 600, 320, 5288);
    T('pointermove', 600, 320, 5289);
    T('pointermove', 600, 84, 5290);                  // (far again, within 250 ms of a page scroll: held)
    T('pointerup', 600, 84, 5300);                    // the lift is far from the last good point (320): that point
    assert.deepEqual(log.at(-1).slice(0, 3), ['drop', 600, 320]);
    // an Apple Pencil (pen) too; a mouse never
    for (const [type, want] of [['pen', 'move 600 50'], ['mouse', 'move 600 300']]) {
      const r = scrollRig({ top: 1500, type });
      r.T('pointerdown', 600, 400, 5000); r.T('pointermove', 600, 390, 5016); r.T('pointermove', 600, 50, 5032);
      r.frames(6, 0);
      assert.ok(r.html.scrollTop < 1500, type);
      r.T('pointermove', 600, 300, 5250);
      assert.equal(r.log.at(-1).slice(0, 3).join(' '), want, type);
      r.T('pointerup', 600, 300, 5300);
      r.src.destroy(); raf.uninstall();
    }
  } finally { raf.uninstall(); }
});

/* ------------------------------------------------ two-finger rollback (the gesture.js contract, G2) */
// The two-finger layer asks the first finger's owner to roll back with a synthetic pointercancel flagged
// e.gesture === 'two-finger': each widget restores the value from before the press ('move' then 'end' with it) and
// leaves the modifier latches for the next gesture; a plain pointercancel keeps the moved value, as before.
const TWO = { gesture: 'two-finger' };
const tch = (o = {}) => Object.assign({ pointerType: 'touch' }, o);

test('two-finger rollback: knob and numBox restore the value from before the press, keep the latches; a plain cancel commits', () => {
  const d = fresh();
  const bar = wk.modifierBar({});
  d.body.appendChild(bar.el);
  const fineBtn = all(bar.el).find(e => e.getAttribute && e.getAttribute('data-mod') === 'fine');
  const { st, el } = mkKnob();
  fineBtn.click();
  assert.equal(bar.state().fine, 1);
  ptr(el, 'pointerdown', 100, 100, tch());
  ptr(el, 'pointermove', 100, -100, tch()); // Fine: 200 px → 0.1
  near(st.n, 0.6);
  ptr(el, 'pointercancel', 100, -100, tch(TWO));
  assert.deepEqual(st.calls.slice(-2), [['move', 0.5], ['end', 0.5]]);
  assert.deepEqual([st.n, el._cap, el.classList.contains('wk-drag')], [0.5, null, false]);
  assert.equal(bar.state().fine, 1);                     // the latch waits for a real gesture
  ptr(el, 'pointerdown', 100, 100);
  ptr(el, 'pointermove', 100, 80);
  ptr(el, 'pointerup', 100, 80);
  near(st.n, 0.51);
  assert.equal(bar.state().fine, 0);
  // a plain cancel (a system interruption) keeps the moved value
  st.n = 0.5; st.calls.length = 0;
  ptr(el, 'pointerdown', 100, 100);
  ptr(el, 'pointermove', 100, 60);
  ptr(el, 'pointercancel', 100, 60);
  assert.deepEqual(st.calls.map(c => c[0]), ['start', 'move', 'end']);
  near(st.calls.at(-1)[1], 0.7);
  // a flagged cancel for another pointer is not this gesture's
  st.calls.length = 0;
  const n0 = st.n;
  ptr(el, 'pointerdown', 100, 100);
  ptr(el, 'pointermove', 100, 80);
  ptr(el, 'pointercancel', 100, 80, Object.assign({ pointerId: 9 }, TWO));
  assert.ok(el.classList.contains('wk-drag'));
  ptr(el, 'pointercancel', 100, 80, TWO);
  assert.deepEqual(st.calls.slice(-2), [['move', n0], ['end', n0]]); // back to the value at the press
  // numBox: an off-grid value comes back exactly (not the nearest step)
  const nb = mkNb();
  nb.st.n = 0.3; nb.w.update(); nb.st.calls.length = 0;
  ptr(nb.el, 'pointerdown', 0, 100, tch());
  ptr(nb.el, 'pointermove', 0, 76, tch());
  assert.equal(nb.st.calls.at(-1)[0], 'move');
  ptr(nb.el, 'pointercancel', 0, 76, tch(TWO));
  assert.deepEqual(nb.st.calls.slice(-2), [['move', 0.3], ['end', 0.3]]);
  assert.equal(nb.el._cap, null);
  nb.st.calls.length = 0;
  ptr(nb.el, 'pointerdown', 0, 100);
  ptr(nb.el, 'pointermove', 0, 76);
  ptr(nb.el, 'pointercancel', 0, 76);
  assert.deepEqual(nb.st.calls.map(c => c[0]), ['start', 'move', 'end']);
  assert.notEqual(nb.st.calls.at(-1)[1], 0.3);
  bar.clear(); bar.destroy();
});

test('two-finger rollback: slider and fader undo the jump of the press; xyPad both axes; rangeBar an edge moved by the press', () => {
  const d = fresh();
  const st = { n: 0.5, calls: [] };
  const s = wk.slider({ label: 'H', get: () => st.n, set: (n, ph) => { st.n = n; st.calls.push([ph, n]); }, def: 0.5 });
  d.body.appendChild(s.el);
  place(one(s.el, 'wk-slt'), 100, 0, 200, 10);
  ptr(s.el, 'pointerdown', 120, 5, tch());                // jumps to 0.1
  near(st.n, 0.1);
  ptr(s.el, 'pointercancel', 120, 5, tch(TWO));
  assert.deepEqual(st.calls.map(c => c[0]), ['start', 'move', 'move', 'end']);
  assert.deepEqual(st.calls.slice(-2), [['move', 0.5], ['end', 0.5]]);
  st.calls.length = 0;
  ptr(s.el, 'pointerdown', 120, 5);
  ptr(s.el, 'pointercancel', 120, 5);                     // plain: the jump stays
  near(st.n, 0.1);
  assert.equal(st.calls.at(-1)[0], 'end');
  const fs = { n: 1, calls: [] };
  const f = wk.fader({ label: 'MAIN', get: () => fs.n, set: (n, ph) => { fs.n = n; fs.calls.push([ph, n]); }, def: 0.7 });
  d.body.appendChild(f.el);
  place(one(f.el, 'wk-slt'), 0, 0, 10, 100);
  ptr(f.el, 'pointerdown', 5, 80, tch());
  near(fs.n, 0.2);
  ptr(f.el, 'pointermove', 5, 70, tch());
  ptr(f.el, 'pointercancel', 5, 70, tch(TWO));
  assert.deepEqual(fs.calls.slice(-2), [['move', 1], ['end', 1]]);
  // xyPad: the jump and the drag of both axes come back
  const xy = { x: 0.5, y: 0.5, calls: [] };
  const mkAx = k => ({ label: k, get: () => xy[k], set: (n, ph) => { xy[k] = n; xy.calls.push([k, ph, n]); } });
  const p = wk.xyPad({ x: mkAx('x'), y: mkAx('y') });
  d.body.appendChild(p.el);
  const pad = one(p.el, 'wk-xyp');
  place(pad, 100, 100, 100, 100);
  ptr(pad, 'pointerdown', 120, 130, tch());
  ptr(pad, 'pointermove', 130, 120, tch());
  near(xy.x, 0.3);
  ptr(pad, 'pointercancel', 130, 120, tch(TWO));
  assert.deepEqual(xy.calls.slice(-4), [['x', 'move', 0.5], ['y', 'move', 0.5], ['x', 'end', 0.5], ['y', 'end', 0.5]]);
  assert.equal(pad._cap, null);
  xy.calls.length = 0;
  ptr(pad, 'pointerdown', 120, 130);
  ptr(pad, 'pointercancel', 120, 130);
  assert.deepEqual(xy.calls.slice(-2).map(c => c[1]), ['end', 'end']);
  near(xy.x, 0.2);
  // rangeBar: a press outside the range moved the hi edge at once
  const rs = { r: [10, 20], calls: [] };
  const rb = wk.rangeBar({ min: 0, max: 127, get: () => rs.r, set: (r, ph) => { rs.r = r; rs.calls.push([ph, r.slice()]); } });
  d.body.appendChild(rb.el);
  const trk = one(rb.el, 'wk-rbt');
  place(trk, 0, 0, 128, 20);
  ptr(trk, 'pointerdown', 100.5, 10, tch());
  assert.deepEqual(rs.r, [10, 100]);
  ptr(trk, 'pointermove', 110.5, 10, tch());
  ptr(trk, 'pointercancel', 110.5, 10, tch(TWO));
  assert.deepEqual(rs.calls.slice(-2), [['move', [10, 20]], ['end', [10, 20]]]);
  ptr(trk, 'pointerdown', 100.5, 10);
  ptr(trk, 'pointercancel', 100.5, 10);
  assert.deepEqual(rs.r, [10, 100]);
});

test('two-finger rollback: stepGrid restores every painted cell’s ORIGINAL value (not the painted ones)', () => {
  const d = fresh();
  const v = [[0.1, -0.2, 0.3, 0.4, 0, 0, 0, 0]], calls = [];
  const sg = wk.stepGrid({ rows: ['Pan'], steps: 8, get: (r, j) => v[r][j], set: (r, j, x, ph) => { v[r][j] = x; calls.push([j, ph, x]); } });
  d.body.appendChild(sg.el);
  const cells = byCls(sg.el, 'wk-sgc');
  cells.forEach((c, i) => place(c, 20 * i, 0, 20, 40));
  ptr(cells[1], 'pointerdown', 25, 10, tch());            // +0.5 at once
  ptr(sg.el, 'pointermove', 45, 30, tch());
  ptr(sg.el, 'pointermove', 65, 40, tch());               // painted cells 1–3
  assert.deepEqual(v[0].slice(0, 4), [0.1, 0.5, -0.5, -1]);
  calls.length = 0;
  ptr(sg.el, 'pointercancel', 65, 40, tch(TWO));
  assert.deepEqual(v[0].slice(0, 5), [0.1, -0.2, 0.3, 0.4, 0]);
  assert.deepEqual(calls, [[1, 'move', -0.2], [1, 'end', -0.2], [2, 'move', 0.3], [2, 'end', 0.3], [3, 'move', 0.4], [3, 'end', 0.4]]);
  assert.equal(sg.el._cap, null);
  // plain cancel: the painted values stay
  ptr(cells[1], 'pointerdown', 25, 10);
  ptr(sg.el, 'pointermove', 45, 30);
  ptr(sg.el, 'pointercancel', 45, 30);
  assert.deepEqual(v[0].slice(1, 3), [0.5, -0.5]);
});

test('two-finger rollback: dragSource — the flagged cancel abandons a pending touch and cancels a live drag; its edge auto-scroll stops', () => {
  try {
    const { html, log, src, tile, T, frames } = scrollRig({ top: 1500 });
    // pending (a hold not yet started): abandoned, nothing called
    T('pointerdown', 600, 400, 5000);
    ptr(tile, 'pointercancel', 600, 400, { pointerType: 'touch', pointerId: 3, timeStamp: 5050, gesture: 'two-finger' });
    assert.deepEqual(log, []);
    assert.ok(!src.active());
    T('pointermove', 600, 380, 5060);                     // the finger goes on: no drag
    assert.deepEqual(log, []);
    T('pointerup', 600, 380, 5070);
    // live and auto-scrolling (a drag in the bottom band): cancelled, the frames stop
    T('pointerdown', 600, 400, 6000); T('pointermove', 600, 390, 6016); T('pointermove', 600, 560, 6032);
    frames(4, 6000);
    const top = html.scrollTop;
    assert.ok(top > 1500);
    ptr(tile, 'pointercancel', 600, 560, { pointerType: 'touch', pointerId: 3, timeStamp: 6200, gesture: 'two-finger' });
    assert.equal(log.at(-1)[0], 'cancel');
    assert.ok(!src.active());
    assert.equal(raf.pending, 0);
    const n = log.length;
    frames(5, 7000);
    assert.equal(html.scrollTop, top);
    T('pointermove', 600, 300, 7300); T('pointerup', 600, 300, 7310);
    assert.equal(log.length, n);                          // nothing after the gesture (no move, no drop)
    src.destroy();
  } finally { raf.uninstall(); }
});

test('two-finger rollback: dragSource keeps the modifier latches on the flagged cancel (like every widget); a plain cancel and a drop spend them', () => {
  const d = fresh();
  const bar = wk.modifierBar({});
  d.body.appendChild(bar.el);
  const altBtn = all(bar.el).find(e => e.getAttribute && e.getAttribute('data-mod') === 'alt');
  const tile = d.createElement('button'); d.body.appendChild(tile);
  d.elementFromPoint = () => tile;
  const log = [];
  const src = wk.dragSource(tile, { data: 'lfo1', scrollAxis: 'x', autoScroll: false,
    begin: i => log.push('begin ' + i.alt), move: () => {}, drop: i => log.push('drop ' + i.alt), cancel: i => log.push('cancel ' + i.alt) });
  const T = (k, x, y, t, o = {}) => ptr(tile, k, x, y, Object.assign({ pointerType: 'touch', pointerId: 3, isPrimary: true, timeStamp: t }, o));
  altBtn.click();
  assert.equal(bar.state().alt, 1);
  T('pointerdown', 100, 100, 1000); T('pointermove', 100, 120, 1050);  // across scrollAxis x: a quick drag at once
  T('pointercancel', 100, 120, 1100, TWO);
  assert.deepEqual(log, ['begin true', 'cancel true']);
  assert.equal(bar.state().alt, 1);                       // kept for the next gesture
  T('pointerdown', 100, 100, 3000); T('pointermove', 100, 120, 3050);
  assert.equal(log.at(-1), 'begin true');
  T('pointerup', 100, 120, 3100);
  assert.deepEqual([log.at(-1), bar.state().alt], ['drop true', 0]); // the drop spends it
  altBtn.click();
  T('pointerdown', 100, 100, 5000); T('pointermove', 100, 120, 5050); T('pointercancel', 100, 120, 5100);
  assert.deepEqual([log.at(-1), bar.state().alt], ['cancel true', 0]); // a plain (system) cancel too
  src.destroy(); bar.clear(); bar.destroy();
});

test('two-finger zones: pianoKeys is "music", zoomPan marks its element "own" (an existing marker wins; destroy removes its own)', () => {
  const d = fresh();
  const pk = wk.pianoKeys({ lo: 60, hi: 71 });
  d.body.appendChild(pk.el);
  assert.equal(pk.el.getAttribute('data-gesture'), 'music');
  const el = d.createElement('canvas'), el2 = d.createElement('div');
  d.body.append(el, el2);
  el2.setAttribute('data-gesture', 'music');
  const zp = wk.zoomPan(el, { get: () => null, set() {} }), zp2 = wk.zoomPan(el2, {});
  assert.deepEqual([el.getAttribute('data-gesture'), el2.getAttribute('data-gesture')], ['own', 'music']);
  zp.destroy(); zp2.destroy();
  assert.deepEqual([el.hasAttribute('data-gesture'), el2.getAttribute('data-gesture')], [false, 'music']);
  pk.destroy();
});

/* ------------------------------------------- the canvas world support (SPEC-canvas §4.4–4.7; IMPL-1b §4.3, §8.2) */
import { place as placeEl, layout as layoutEl } from './wk-dom.mjs';
const sj = v => JSON.stringify(v); // (fake-DOM nodes never reach assert: primitives / JSON only)

test('localPoint / localScale: the pointer in layout px under a scaled ancestor (k = 0.5, 1, 2); a zero-size box or no offsetWidth counts as scale 1', () => {
  const d = fresh();
  const el = d.createElement('div'); d.body.appendChild(el);
  for (const k of [0.5, 1, 2]) {
    placeEl(el, 100, 50, 300 * k, 120 * k); layoutEl(el, 300, 120);
    const p = wk.localPoint(el, { clientX: 100 + 30 * k, clientY: 50 + 60 * k });
    assert.equal(sj([Math.round(p.x * 1e9) / 1e9, Math.round(p.y * 1e9) / 1e9, wk.localScale(el)]), sj([30, 60, 1 / k]), 'k ' + k);
  }
  placeEl(el, 100, 50, 0, 0); layoutEl(el, 300, 120);
  assert.equal(sj([wk.localScale(el), wk.localPoint(el, { clientX: 110, clientY: 55 })]), sj([1, { x: 10, y: 5 }]), 'zero rect');
  const svg = d.createElementNS('http://www.w3.org/2000/svg', 'svg'); // (no offsetWidth in browsers: the caller passes an HTML ancestor)
  Object.defineProperty(svg, 'offsetWidth', { value: undefined });
  placeEl(svg, 0, 0, 40, 40);
  assert.equal(wk.localScale(svg), 1);
});

test('closeTransient: closes the open context menu / popup list and hides the kit tooltip', () => {
  const d = fresh();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    wk.contextMenu(10, 10, [{ label: 'x' }]);
    assert.equal(byCls(d.body, 'wk-ctx').length, 1);
    const el = d.createElement('div'); d.body.appendChild(el);
    wk.tooltip(el, () => 'TIP');
    fire(el, 'pointerenter', { bubbles: false }); mock.timers.tick(450);
    assert.equal(d.getElementById('wk-tip').classList.contains('wk-show'), true);
    wk.closeTransient();
    assert.equal(sj([byCls(d.body, 'wk-ctx').length, d.getElementById('wk-tip').classList.contains('wk-show')]), sj([0, false]));
    wk.closeTransient(); // nothing open: harmless
  } finally { mock.timers.reset(); }
});

test('setWheelVeto: while it answers true no kit control takes the wheel (knob, numBox, wheelGate, zoomPan); null lifts it', () => {
  const d = fresh();
  const { el, st } = mkKnob();
  const gateEl = d.createElement('div'); d.body.appendChild(gateEl);
  const take = wk.wheelGate(gateEl);
  let zp = 0; const cv = d.createElement('canvas'); d.body.appendChild(cv); placeEl(cv, 0, 0, 100, 50);
  const z = wk.zoomPan(cv, { get: () => ({ x0: 0, x1: 1, y0: 0, y1: 1 }), set: () => { zp++; } });
  let veto = true;
  wk.setWheelVeto(() => veto);
  try {
    el.focus();
    const e1 = fire(el, 'wheel', { deltaY: -100, timeStamp: 1e6 });
    fire(gateEl, 'pointerenter', { bubbles: false, timeStamp: 0 });
    const g1 = take(new (class { constructor() { this.deltaY = -100; this.deltaX = 0; this.deltaMode = 0; this.timeStamp = 1e6; } })());
    const pz = fire(cv, 'wheel', { deltaY: -100, shiftKey: true, clientX: 50, clientY: 25 });
    assert.equal(sj([st.n, e1.defaultPrevented, g1, zp, pz.defaultPrevented]), sj([0.5, false, null, 0, false]), 'vetoed: the page (the camera) keeps the wheel');
    // an explicit zoom (Ctrl / ⌘-wheel, a trackpad pinch) is never vetoed: left alone it would zoom the browser's page
    const cz = fire(cv, 'wheel', { deltaY: -100, ctrlKey: true, clientX: 50, clientY: 25 });
    assert.equal(sj([zp, cz.defaultPrevented]), sj([1, true]), 'Ctrl-wheel: the editor zooms even under the veto');
    veto = false;
    fire(el, 'wheel', { deltaY: -100, timeStamp: 2e6 });
    fire(cv, 'wheel', { deltaY: -100, shiftKey: true, clientX: 50, clientY: 25 });
    assert.ok(st.n > 0.5 && zp === 2, 'lifted');
    wk.setWheelVeto(() => { throw new Error('gone'); });
    fire(el, 'wheel', { deltaY: -100, timeStamp: 3e6 });
    assert.ok(st.n > 0.51, 'a throwing veto counts as none');
  } finally { wk.setWheelVeto(null); z.destroy(); take.destroy(); }
});

test('visibleBand: the visual viewport less top / bottom bars (as before) and left / right side trays and rails; hidden ones ignored', () => {
  const d = fresh(), win = d.defaultView;
  d.querySelectorAll = sel => (sel === '[data-wk-inset]' ? all(d.documentElement).filter(n => n.hasAttribute && n.hasAttribute('data-wk-inset')) : []);
  const inset = (side, l, t, w, h) => { const n = d.createElement('div'); n.setAttribute('data-wk-inset', side); d.body.appendChild(n); placeEl(n, l, t, w, h); return n; };
  assert.equal(sj(wk.visibleBand(d)), sj({ left: 0, top: 0, right: 1280, bottom: 800 }));
  inset('top', 0, 0, 1280, 120); inset('bottom', 0, 640, 1280, 160);
  assert.equal(sj(wk.visibleBand(d)), sj({ left: 0, top: 120, right: 1280, bottom: 640 }));
  inset('left', 0, 120, 284, 520); const rt = inset('right', 1236, 120, 44, 520);
  assert.equal(sj(wk.visibleBand(d)), sj({ left: 284, top: 120, right: 1236, bottom: 640 }));
  placeEl(rt, 0, 0, 0, 0); // a hidden rail (ROLL shown): no box
  assert.equal(wk.visibleBand(d).right, 1280);
  win.visualViewport = { offsetLeft: 100, offsetTop: 50, width: 600, height: 400 }; // the browser's pinch-zoom (and the keyboard)
  assert.equal(sj(wk.visibleBand(d)), sj({ left: 284, top: 120, right: 700, bottom: 450 }));
  delete win.visualViewport;
});

test('edgePan2: dragSource\'s law per axis — touch zones of 72 px (quadratic), full speed past the edge, mouse only past it; ramp-in over 240 ms; a direction arms once the pointer was outside its zone or moved 12 px that way', () => {
  const B = { left: 100, top: 100, right: 900, bottom: 700 };
  const at = (x, y, type, t, st) => wk.edgePan2(B, { x, y, pointerType: type, t }, st);
  let st = {};
  assert.equal(sj(at(500, 400, 'touch', 0, st)), sj({ vx: 0, vy: 0 }), 'the middle (arms every direction)');
  at(136, 400, 'touch', 10, st); // half way into the left zone: the ramp starts
  const v = at(136, 400, 'touch', 250, st); // ramped in
  assert.equal(sj([Math.round(v.vx), v.vy]), sj([-300, 0]), '(0.5)² × 1200, toward the left');
  assert.equal(sj(at(50, 750, 'touch', 600, st)), sj({ vx: -1200, vy: 1200 }), 'past two edges: both axes at full speed');
  st = {};
  at(500, 400, 'mouse', 0, st);
  assert.equal(sj(at(130, 400, 'mouse', 10, st)), sj({ vx: 0, vy: 0 }), 'a mouse has no zone');
  at(90, 400, 'mouse', 20, st);
  assert.equal(at(90, 400, 'mouse', 300, st).vx, -1200, 'past the edge');
  st = {};
  assert.equal(at(120, 400, 'touch', 0, st).vx, 0, 'starting in a zone: not armed');
  assert.equal(at(115, 400, 'touch', 300, st).vx, 0, '5 px that way: still not');
  const a = at(105, 400, 'touch', 600, st);
  assert.ok(a.vx === 0, 'armed now (15 px), the ramp starts at 0');
  assert.ok(at(105, 400, 'touch', 900, st).vx < -800, 'and runs');
  const r = {};
  at(500, 400, 'touch', 0, r); at(40, 400, 'touch', 1000, r);
  assert.equal(Math.round(at(40, 400, 'touch', 1120, r).vx), -600, 'half the ramp (120 of 240 ms)');
});

test('setCanvasScale / canvasScale: fitCanvas sizes in-world stores at max(dpr · k, 0.5) (milestone 3 H5: the cap of 2 lifted), outside the world at the dpr; every store ≤ 16e6 px', () => {
  const d = fresh();
  d.defaultView.devicePixelRatio = 2;
  const w = d.createElement('div'); w.setAttribute('data-cv-world', ''); d.body.appendChild(w);
  const inCv = d.createElement('canvas'), outCv = d.createElement('canvas');
  w.appendChild(inCv); d.body.appendChild(outCv);
  try {
    wk.setCanvasScale(0.5);
    wk.fitCanvas(inCv, 100, 50); wk.fitCanvas(outCv, 100, 50);
    assert.equal(sj([inCv.width, inCv.height, outCv.width, outCv.height, wk.canvasScale(inCv), wk.canvasScale(outCv)]), sj([100, 50, 200, 100, 0.5, 1]));
    wk.setCanvasScale(2);
    const ctx = wk.fitCanvas(inCv, 100, 50);
    assert.equal(sj([inCv.width, ctx.calls.at(-1)]), sj([400, ['setTransform', 4, 0, 0, 4, 0, 0]]), 'dpr · k: 1:1 on screen at 200 % (H5)');
    wk.setCanvasScale(0.1);
    wk.fitCanvas(inCv, 100, 50);
    assert.equal(inCv.width, 50, 'at least 0.5');
    wk.setCanvasScale(1);
    wk.fitCanvas(outCv, 4000, 3000);
    assert.ok(outCv.width * outCv.height <= 16e6 + 8000, 'the 16e6 px cap: ' + outCv.width + ' × ' + outCv.height);
  } finally { wk.setCanvasScale(1); }
});

test('storeDensity (milestone 3 H5): one rule — dpr · k in the world (≥ 1:1 at every zoom, ≥ 0.5), the dpr capped at 2 outside; the budget\'s caps; the 16e6 px cap given a size; the density handed out is remembered', () => {
  const d = fresh();
  const w = d.createElement('div'); w.setAttribute('data-cv-world', ''); d.body.appendChild(w);
  const inCv = d.createElement('canvas'), outCv = d.createElement('canvas'), other = d.createElement('canvas');
  w.appendChild(inCv); w.appendChild(other); d.body.appendChild(outCv);
  try {
    d.defaultView.devicePixelRatio = 2;
    const R = [];
    for (const k of [0.25, 0.5, 1, 1.5, 2]) { wk.setCanvasScale(k); R.push([wk.storeDensity(inCv), wk.storeDensity(outCv)]); }
    assert.equal(sj(R), sj([[0.5, 2], [1, 2], [2, 2], [3, 2], [4, 2]]), 'R3: store px per on-screen device px = 1 for k ≥ 0.25 at dpr 2');
    for (const k of [0.25, 0.5, 1, 1.5, 2]) { wk.setCanvasScale(k); assert.ok(wk.storeDensity(inCv) / (2 * k) >= 1 - 1e-12, 'k ' + k); }
    d.defaultView.devicePixelRatio = 3;
    wk.setCanvasScale(1);
    assert.equal(sj([wk.storeDensity(inCv), wk.storeDensity(outCv), wk.deviceRatio()]), sj([3, 2, 3]), 'dpr 3: the world uncapped, the page still 2 (§13.1)');
    d.defaultView.devicePixelRatio = 2;
    wk.setCanvasScale(2);
    // the budget's caps: a capped canvas takes min(rule, cap); a change is reported once
    assert.equal(wk.setStoreCaps(new Map([[inCv, 2]])), true);
    assert.equal(wk.setStoreCaps(new Map([[inCv, 2]])), false, 'the same caps: no change');
    assert.equal(sj([wk.storeDensity(inCv), wk.storeDensity(other), wk.storeCap(inCv), wk.storeCap(other) === undefined]), sj([2, 4, 2, true]));
    wk.fitCanvas(inCv, 100, 50);
    assert.equal(sj([inCv.width, inCv.height, wk.storedDensity(inCv)]), sj([200, 100, 2]));
    assert.equal(wk.setStoreCaps(null), true, 'cleared');
    assert.equal(wk.storeDensity(inCv), 4);
    assert.equal(wk.storedDensity(inCv), 4);
    // a cap above the rule changes nothing; the per-canvas px cap given a layout size
    wk.setStoreCaps(new Map([[inCv, 9]]));
    assert.equal(wk.storeDensity(inCv), 4);
    wk.setStoreCaps(null);
    const s = wk.storeDensity(inCv, 2000, 1500);
    assert.ok(2000 * 1500 * s * s <= wk.CANVAS_MAX_PX + 1 && s < 4, 'the 16e6 px cap: ' + s);
    assert.equal(wk.CANVAS_BUDGET, 64 * 1024 * 1024);
    assert.equal(wk.storedDensity(null), undefined);
  } finally { wk.setCanvasScale(1); wk.setStoreCaps(null); d.defaultView.devicePixelRatio = 1; }
});

test('onRescale / rescaleCanvases: repaints of the static canvases inside the root (all without one; detached ones skipped); off() unregisters; releaseCanvases empties every canvas under a root', () => {
  const d = fresh();
  const w = d.createElement('div'), a = d.createElement('div'), b = d.createElement('div'), gone = d.createElement('div');
  w.appendChild(a); d.body.append(w, b);
  const log = [];
  const offA = wk.onRescale(a, () => log.push('a'));
  wk.onRescale(b, () => log.push('b'));
  wk.onRescale(gone, () => log.push('gone'));
  wk.onRescale(a, () => { throw new Error('a painter failed'); });
  const err = console.error; console.error = () => {};
  try {
    wk.rescaleCanvases(w);
    assert.equal(log.join(), 'a', 'only inside the root; a failing one does not stop the rest');
    wk.rescaleCanvases();
    assert.equal(log.join(), 'a,a,b', 'all (the detached one skipped)');
    offA();
    wk.rescaleCanvases(w);
    assert.equal(log.join(), 'a,a,b');
  } finally { console.error = err; }
  const c1 = d.createElement('canvas'), c2 = d.createElement('canvas');
  c1.width = 300; c1.height = 100; c2.width = 40; c2.height = 40;
  a.appendChild(c1); b.appendChild(c2);
  a.querySelectorAll = sel => (sel === 'canvas' ? all(a).filter(n => n.localName === 'canvas') : []);
  wk.releaseCanvases(a);
  assert.equal(sj([c1.width, c1.height, c2.width]), sj([0, 0, 40]));
  wk.releaseCanvases(null);
});

test('setLayer / layer: an element inside [data-cv-world] gets the top layer, anything else itself', () => {
  const d = fresh();
  const w = d.createElement('div'), inner = d.createElement('div'), outer = d.createElement('div'), ov = d.createElement('div');
  w.setAttribute('data-cv-world', ''); w.appendChild(inner); d.body.append(w, outer, ov);
  assert.ok(wk.layer(inner) === inner, 'no layer set: itself');
  wk.setLayer(ov);
  try {
    assert.equal(sj([wk.layer(inner) === ov, wk.layer(w) === ov, wk.layer(outer) === outer, wk.layer(null)]), sj([true, true, true, null]));
  } finally { wk.setLayer(null); }
});
