import './v8-guard.mjs';
// The Tab key (2026-10-23, the user: "tab should swap to canvas and back") in the page simulation: Tab (no modifier) toggles the
// view, CANVAS → ROLL and ROLL → CANVAS — the tab buttons' state and which view is hidden follow; the canvas that was showing (a
// track's or the master's) is the canvas that comes back. Shift / ⌘ / Ctrl / Alt each leave Tab alone (the browser's focus move,
// the system's shortcuts), as do a text field / textarea / select / contenteditable (a knob's typed value is an input), an open
// dialog (the bounce), the ≡ / ⚙ menus, the track list, the Sources tray, a Help sheet; a held key's repeat does not toggle again
// (and takes the key, so the focus does not jump); the key never reaches the note keyboard or the transport. Accessor-free like
// the other canvas sims (a guard build); one boot; strings, numbers and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-tab-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';

for (const g of ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrSeq', 'ModCore', 'PatchDSP', 'PatchMoog', 'MASTERDSP']) globalThis[g] = null;
const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1500, bottom: 1300 };
function scriptedWorld(root) {
  const L = {};
  const W = {
    el: root, k: 1, cam: { tx: 0, ty: 0, k: 1 }, items: new Map(), selected: null, mode: 'always', active: true,
    setCamera(c) { W.cam = { tx: c.tx, ty: c.ty, k: c.k }; W.k = c.k; W.emit('cameraend', { cam: W.cam, zoomed: true }); },
    band: () => Object.assign({}, BAND),
    toClient: (wx, wy) => ({ x: VP.left + wx * W.k + W.cam.tx, y: VP.top + wy * W.k + W.cam.ty }),
    toWorld: (x, y) => ({ x: (x - VP.left - W.cam.tx) / W.k, y: (y - VP.top - W.cam.ty) / W.k }),
    add(it) { W.items.set(it.id, it); return () => W.remove(it.id); },
    remove(id) { W.items.delete(id); },
    update() {}, clear() { W.items.clear(); },
    select(id) { W.selected = id; W.emit('select', { id }); },
    setActive(on) { W.active = !!on; },
    focusItem() {}, dragPointer() {}, ghost: g => (g ? { x: 0, y: 0, w: g.w, h: g.h } : null), setDragging() {},
    modsMode: () => W.mode, setModsMode(m) { W.mode = m; W.emit('mods', m); },
    on(t, fn) { (L[t] || (L[t] = [])).push(fn); return () => { L[t] = L[t].filter(f => f !== fn); }; },
    emit(t, d) { for (const f of (L[t] || []).slice()) f(d); },
  };
  return W;
}

const sim = await bootMain({ ls: fakeStorage({}), hash: '#minimoog', clock: 'std', synthTest: { cvWorld: root => scriptedWorld(root) } });
const api = sim.api, cv = globalThis.__synthTest.cv, M = globalThis.__synthTest.master, sh = globalThis.__synthTest.shell;
await sim.power(); sim.raf(); await sim.settle(10); sim.raf();
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };

// (the stub document has no .tabs buttons: two stand-ins, as the page's CANVAS / ROLL buttons — openTab walks them)
const D = sim.dom.document;
const mkBtn = tab => { const b = D.createElement('button'); b.dataset.tab = tab; b.setAttribute('aria-pressed', tab === 'canvas' ? 'true' : 'false'); b.classList.toggle('on', tab === 'canvas'); return b; };
const btns = { canvas: mkBtn('canvas'), roll: mkBtn('roll') };
const qsa = D.querySelectorAll;
D.querySelectorAll = s => (s === '.tabs button' ? [btns.canvas, btns.roll] : qsa.call(D, s));

// the view: which one shows, the buttons and the hidden flags agreeing
const view = () => {
  const c = !sim.$('#tab-inst').hidden, r = !sim.$('#tab-roll').hidden;
  const bc = btns.canvas.classList.contains('on'), br = btns.roll.classList.contains('on');
  const pc = btns.canvas.getAttribute('aria-pressed'), pr = btns.roll.getAttribute('aria-pressed');
  if (c && !r && bc && !br && pc === 'true' && pr === 'false') return 'canvas';
  if (!c && r && !bc && br && pc === 'false' && pr === 'true') return 'roll';
  return `mixed(${c},${r},${bc},${br},${pc},${pr})`;
};
// a key press on the page (main.js's window keydown): whether the handler called preventDefault
function press(key, o = {}) {
  const e = { prevented: false };
  sim.key(o.code || key, true, Object.assign({ key, preventDefault() { e.prevented = true; } }, o));
  sim.key(o.code || key, false, { key });
  return e.prevented;
}
const tab = o => press('Tab', Object.assign({ code: 'Tab' }, o));
const notesHeld = () => [...api.held.keys()].join(',');
const playing = () => !!api.transport().playing;

test('the harness: CANVAS shows, ROLL hidden, nothing held, the transport stopped', () => {
  cv.openTab('canvas');
  assert.equal(view(), 'canvas');
  assert.deepEqual([notesHeld(), playing(), M.on()], ['', false, false]);
});

test('Tab: CANVAS -> ROLL -> CANVAS -> ROLL (the buttons, the hidden view), the key taken (no focus jump), no note, no transport', async () => {
  assert.equal(tab(), true, 'preventDefault: the browser\'s focus move stays out');
  await settle();
  assert.equal(view(), 'roll');
  assert.equal(tab(), true);
  await settle();
  assert.equal(view(), 'canvas');
  assert.equal(tab(), true);
  await settle();
  assert.equal(view(), 'roll');
  assert.equal(tab(), true);
  await settle();
  assert.equal(view(), 'canvas');
  assert.deepEqual([notesHeld(), playing()], ['', false], 'never a note, never the transport');
  // the tab buttons and Tab agree: ROLL by its button, Tab brings CANVAS back
  cv.openTab('roll'); await settle();
  assert.equal(view(), 'roll');
  tab(); await settle();
  assert.equal(view(), 'canvas');
});

test('Shift+Tab, ⌘Tab, Ctrl+Tab, Alt+Tab do nothing (not taken: the browser and the system keep them), from either view', async () => {
  for (const start of ['canvas', 'roll']) {
    cv.openTab(start); await settle();
    for (const o of [{ shiftKey: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true, altKey: true }, { metaKey: true, shiftKey: true }]) {
      assert.equal(tab(o), false, start + ' ' + JSON.stringify(o) + ': not taken');
      await settle();
      assert.equal(view(), start, start + ' ' + JSON.stringify(o));
    }
  }
  cv.openTab('canvas'); await settle();
  assert.equal(view(), 'canvas');
});

test('a text field / textarea / select / contenteditable / a knob\'s typed value keeps its Tab (no toggle, not taken)', async () => {
  const mk = (tag, set = {}) => Object.assign(D.createElement(tag), set);
  const targets = {
    'text input': mk('input', { type: 'text' }), 'number input (a knob\'s typed value)': mk('input', { type: 'number' }), 'search input': mk('input', { type: 'search' }),
    textarea: mk('textarea'), select: mk('select'), contenteditable: mk('div', { isContentEditable: true }),
  };
  for (const start of ['canvas', 'roll']) {
    cv.openTab(start); await settle();
    for (const [name, target] of Object.entries(targets)) {
      assert.equal(tab({ target }), false, start + ' ' + name + ': not taken');
      await settle();
      assert.equal(view(), start, start + ' ' + name);
    }
  }
  cv.openTab('canvas'); await settle();
  // and a button / slider (not text entry) still lets Tab swap the view
  assert.equal(tab({ target: D.createElement('button') }), true);
  await settle();
  assert.equal(view(), 'roll');
  assert.equal(tab({ target: Object.assign(D.createElement('input'), { type: 'range' }) }), true);
  await settle();
  assert.equal(view(), 'canvas');
});

test('with a dialog, sheet, popover or menu open Tab does nothing: the bounce dialog, ≡, ⚙, the track list, the Sources tray, the Help sheet', async () => {
  for (const start of ['canvas', 'roll']) {
    cv.openTab(start); await settle();
    // the bounce dialog (#modal)
    sim.$('#fBounce').click();
    assert.equal(sim.$('#modal').hidden, false);
    assert.equal(tab(), false, start + ' bounce dialog: not taken');
    await settle();
    assert.equal(view(), start, start + ' bounce dialog');
    sim.$('#bCancel').click();
    assert.equal(sim.$('#modal').hidden, true);
    // the shell's menus: ≡, ⚙, the transport's ⋯, the bars ▾, the track list, the engine fold
    for (let i = 0; i < sh.shell.menus.length; i++) {
      const menu = sh.shell.menus[i];
      sh.shell.menus.forEach((m, j) => { if (j !== i) m.close(); });
      menu.open();
      assert.equal(menu.isOpen(), true, 'menu ' + i);
      assert.equal(tab(), false, start + ' menu ' + i + ': not taken');
      await settle();
      assert.equal(view(), start, start + ' menu ' + i);
      menu.close();
    }
    sh.shell.menus.forEach(m => m.close());
    assert.equal(sh.shell.menus.some(m => m.isOpen()), false);
    // the Sources tray (the picker for Replace with…), canvas only: ROLL closes it
    if (start === 'canvas') {
      sh.shell.src.open();
      assert.equal(sh.shell.src.isOpen(), true);
      assert.equal(tab(), false, 'Sources tray: not taken');
      await settle();
      assert.equal(view(), 'canvas', 'Sources tray');
      sh.shell.src.close();
      assert.equal(sh.shell.src.isOpen(), false);
    }
    // the Help sheet
    sim.$('#helpBtn').onclick();
    assert.equal(!!sh.shell.sheet, true, 'the Help sheet opens');
    assert.equal(tab(), false, start + ' Help sheet: not taken');
    await settle();
    assert.equal(view(), start, start + ' Help sheet');
    sh.shell.sheet.close();
    assert.equal(!!sh.shell.sheet, false);
    // and with everything closed it works again
    assert.equal(tab(), true, start + ': works again');
    await settle();
    assert.equal(view(), start === 'canvas' ? 'roll' : 'canvas');
  }
  cv.openTab('canvas'); await settle();
  assert.equal(view(), 'canvas');
});

test('a held Tab\'s auto-repeat toggles once (the repeats take the key, so the focus does not jump)', async () => {
  cv.openTab('canvas'); await settle();
  assert.equal(tab(), true);
  await settle();
  assert.equal(view(), 'roll');
  for (let i = 0; i < 5; i++) {
    assert.equal(tab({ repeat: true }), true, 'a repeat is taken');
    await settle();
    assert.equal(view(), 'roll', 'repeat ' + i);
  }
  // released, pressed again: back
  assert.equal(tab(), true);
  await settle();
  assert.equal(view(), 'canvas');
  // a repeat alone (its first keydown lost to a focus change) toggles nothing either, from CANVAS
  assert.equal(tab({ repeat: true }), true);
  await settle();
  assert.equal(view(), 'canvas');
});

test('the master canvas comes back after ROLL -> Tab (and a track canvas stays that track\'s)', async () => {
  cv.openTab('canvas'); await settle();
  const sel = api.project().selTrack;
  M.open(); await settle(3);
  assert.deepEqual([M.on(), view(), cv.view().trackId], [true, 'canvas', 'master']);
  tab(); await settle(2);
  assert.equal(view(), 'roll');
  assert.equal(M.on(), true, 'the master flag stays under ROLL');
  tab(); await settle(3);
  assert.deepEqual([view(), M.on(), cv.view().trackId], ['canvas', true, 'master']);
  tab(); tab(); await settle(3);
  assert.deepEqual([view(), M.on(), cv.view().trackId], ['canvas', true, 'master'], 'twice: the same');
  M.off(); await settle(3);
  assert.deepEqual([M.on(), view(), cv.view().trackId], [false, 'canvas', sel]);
  tab(); await settle(2);
  tab(); await settle(3);
  assert.deepEqual([view(), M.on(), cv.view().trackId], ['canvas', false, sel], 'the track\'s canvas as it was');
});

test('Tab never reaches the note keyboard or the transport: nothing held or playing after any press, either view', async () => {
  for (const start of ['canvas', 'roll']) {
    cv.openTab(start); await settle();
    tab(); tab({ repeat: true }); tab({ shiftKey: true }); tab(); await settle();
    assert.deepEqual([notesHeld(), playing()], ['', false], start);
  }
  cv.openTab('canvas'); await settle();
});
