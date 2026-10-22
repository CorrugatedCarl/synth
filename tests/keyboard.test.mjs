// The on-screen keyboard's view in the page simulation (main.js, tests/main-sim.mjs): Hide keyboard and the tab (2026-10-22,
// the user: the whole tray folds away to its tab — a tap, Enter / Space or a pull brings it back; it plays on folded), the
// height grip on the panel's top edge and the Key size slider — the key-count ↔ width math, the height clamp (70 px … the
// canvas shell's one height budget, cv-tray budget: the canvas keeps 240 px), no stuck notes when the keys are rebuilt (or
// folded away) under a finger, and the preferences persisting (synth.kbSize, synth.kbHidden) into the next session.
// Run: node --test tests/keyboard.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';

const isBlack = n => [1, 3, 6, 8, 10].includes(n % 12);
const whites = (lo, hi) => { let c = 0; for (let n = lo; n <= hi; n++) if (!isBlack(n)) c++; return c; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

const ls = fakeStorage({});
let sim = null;
async function page() {
  if (!sim) { sim = await bootMain({ ls }); await sim.power(); await sim.settle(30); sim.raf(); }
  return sim;
}
let T = 1000;
const ptr = (type, id, x, y, o) => Object.assign({ type, pointerId: id, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1,
  pointerType: 'touch', timeStamp: (T += 50), preventDefault() {}, stopPropagation() {} }, o || {});
const fire = (el, e) => el.dispatchEvent(e);
const slide = (s, v) => { const k = s.$('#kbw'); k.value = String(v); fire(k, { type: 'input', target: k }); fire(k, { type: 'change', target: k }); };
const resize = async (s, w, h) => { if (w) globalThis.innerWidth = w; if (h) globalThis.innerHeight = h; for (const f of s.dom.winL.resize || []) f({ type: 'resize' }); await s.settle(160); };
const keydown = (el, k, o) => { const e = Object.assign({ type: 'keydown', key: k, shiftKey: false, defaultPrevented: false, stopped: false,
  preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } }, o); fire(el, e); return e; };
const keyEl = (s, n) => s.$('#keys').children.find(k => +k.dataset.n === n);
const spans = (s, cls) => s.$('#keys').children.filter(k => k.children.some(c => c.className === cls)).map(k => +k.dataset.n);

test('key range math: auto (Key size untouched) is the Phase-1 layout — 2 to 5 whole octaves by width, around the computer keys\' octave', async () => {
  const { api } = await page();
  for (let W = 120; W <= 2400; W += 7) for (let oct = -3; oct <= 3; oct++) {
    const octs = W < 430 ? 2 : W < 700 ? 3 : W < 1050 ? 4 : 5; // (main.js before the Key size slider)
    const lo = clamp(60 + 12 * oct - 12 * Math.floor((octs - 1) / 2), 0, 108), hi = lo + octs * 12;
    const R = api.kbRange(W, 0, oct), at = `W ${W}, octave ${oct}`;
    if (hi <= 127) assert.deepEqual([R.lo, R.hi, R.nW], [lo, hi, octs * 7 + 1], at);
    else assert.deepEqual([R.hi, R.nW, whites(R.lo, R.hi)], [127, octs * 7 + 1, octs * 7 + 1], at + ': past G9 the keys keep their width (filled downwards)');
  }
});

test('key range math: a key width shows as many whole white keys as fit (≥ one octave, ≤ the 75 of MIDI 0–127) and keeps the computer keys\' octave in view', async () => {
  const { api } = await page();
  for (let W = 150; W <= 2600; W += 23) for (let kw = 16; kw <= 96; kw += 5) for (let oct = -3; oct <= 3; oct++) {
    const R = api.kbRange(W, kw, oct), at = `W ${W}, kw ${kw}, octave ${oct}`, comp = 60 + 12 * oct;
    assert.equal(R.nW, clamp(Math.floor(W / kw), 8, 75), at + ': white keys');
    assert.equal(whites(R.lo, R.hi), R.nW, at + ': the range holds them');
    assert.ok(R.lo >= 0 && R.hi <= 127 && !isBlack(R.lo) && !isBlack(R.hi), at + ': ends on white keys inside MIDI');
    assert.ok(R.hi - R.lo >= 12, at + ': at least an octave');
    if (R.nW > 8) assert.ok(W / R.nW >= kw && W / (R.nW + 1) < kw || R.nW === 75, at + ': whole keys of at least kw, no room for one more');
    assert.ok(R.lo <= comp && comp + 12 <= R.hi, at + ': the computer keys\' octave is shown');
  }
  assert.deepEqual(api.kbRange(1000, 40, 0), { lo: 48, hi: 89, nW: 25 }, '25 keys of 40 px: C3 to F6');
  assert.deepEqual(api.kbRange(300, 96, 0), { lo: 60, hi: 72, nW: 8 }, 'too wide for an octave: one octave, C4–C5');
  assert.deepEqual(api.kbRange(2000, 16, 0), { lo: 0, hi: 127, nW: 75 }, 'the whole MIDI range');
});

test('Key size slider: rebuilds the keys at the chosen width, hides labels on narrow keys, octave −/+ shifts the range, double-click fits the screen again', async () => {
  const s = await page(), { api } = s;
  s.$('#keys').clientWidth = 1000;
  slide(s, 40);
  let K = api.kb();
  assert.deepEqual([K.kw, K.lo, K.hi, K.w, K.px], [40, 48, 89, 1000, 40]);
  assert.equal(K.notes.length, 89 - 48 + 1, 'every key of the range built');
  assert.equal(s.$('#keys').children.length, K.notes.length);
  assert.deepEqual(spans(s, 'nm'), [48, 60, 72, 84], 'C labels');
  assert.equal(spans(s, 'kb').length, 18, 'computer-key labels on the 18 keys A … \'');
  assert.equal(JSON.parse(ls.m.get('synthc.kbSize')).kw, 40, 'persisted');
  assert.equal(s.$('#kbw').value, '40');
  s.$('#octup').onclick();
  K = api.kb();
  assert.deepEqual([K.lo, K.hi], [60, 101], 'octave + shifts it an octave');
  s.$('#octdn').onclick();
  slide(s, 16);
  K = api.kb();
  assert.equal(K.hi - K.lo + 1, K.notes.length);
  assert.equal(whites(K.lo, K.hi), 62, '1000 / 16 → 62 white keys');
  assert.deepEqual([spans(s, 'nm').length, spans(s, 'kb').length], [0, 0], 'no labels on 16 px keys');
  slide(s, 96);
  assert.equal(whites(api.kb().lo, api.kb().hi), 10, '1000 / 96 → 10 white keys');
  fire(s.$('#kbw'), { type: 'dblclick' });
  K = api.kb();
  assert.deepEqual([K.kw, K.lo, K.hi], [0, 48, 96], 'double-click: four octaves fitted to 1000 px again');
  assert.equal(s.$('#kbw').value, String(Math.round(1000 / 29)), 'the slider shows the fitted width');
  assert.equal(JSON.parse(ls.m.get('synthc.kbSize')).kw, 0);
  // a window resize reflows a chosen width
  slide(s, 50);
  s.$('#keys').clientWidth = 600;
  await resize(s);
  assert.equal(whites(api.kb().lo, api.kb().hi), 12, '600 / 50 → 12 white keys');
  s.$('#keys').clientWidth = 1000;
  fire(s.$('#kbw'), { type: 'dblclick' });
});

test('height grip: drag up / down sets the key height within 70 px … the height budget (the canvas keeps 240 px, the top tray folds to its row); keys, Delete / Backspace reset to the screen\'s default', async () => {
  const s = await page(), { api } = s, g = s.$('#kbGrip');
  assert.equal(api.kb().h, 170, 'desktop default');
  assert.equal(g.getAttribute('aria-valuenow'), '170');
  fire(g, ptr('pointerdown', 7, 500, 600, { pointerType: 'mouse' }));
  fire(g, ptr('pointermove', 7, 500, 499, { pointerType: 'mouse' }));
  assert.equal(api.kb().h, 271, 'dragged up 101 px');
  assert.equal(g.getAttribute('aria-valuenow'), '271');
  assert.equal(ls.m.has('synthc.kbSize') && JSON.parse(ls.m.get('synthc.kbSize')).h, 0, 'not written while dragging');
  fire(g, ptr('pointermove', 7, 500, -2000, { pointerType: 'mouse' }));
  assert.equal(api.kb().h, 360, 'at most 360 px (a 900 px window allows 476)');
  fire(g, ptr('pointermove', 7, 500, 2000, { pointerType: 'mouse' }));
  assert.equal(api.kb().h, 70, 'at least 70 px');
  assert.ok(s.$('#perf').classList.contains('short'), 'short keys: the wheels drop their labels');
  fire(g, ptr('pointermove', 7, 500, 480, { pointerType: 'mouse' }));
  fire(g, ptr('pointerup', 7, 500, 480, { pointerType: 'mouse' }));
  assert.equal(api.kb().h, 290);
  assert.ok(!s.$('#perf').classList.contains('short'));
  assert.equal(JSON.parse(ls.m.get('synthc.kbSize')).h, 290, 'written at the end of the drag');
  fire(g, ptr('pointermove', 7, 500, 100, { pointerType: 'mouse' }));
  assert.equal(api.kb().h, 290, 'the drag has ended');
  // the height budget (cv-tray budget): a short window lowers the keys in use, the chosen height is kept for a taller one
  await resize(s, 0, 500);
  assert.deepEqual([api.kb().h, api.kb().hSet], [148, 290], '500 − 240 (the canvas) − 48 (the top tray folded to its row) − 64 px of toolbar');
  assert.equal(g.getAttribute('aria-valuemax'), '148');
  await resize(s, 0, 160);
  assert.equal(api.kb().h, 70, 'never below 70 px');
  await resize(s, 0, 900);
  assert.equal(api.kb().h, 290);
  // keyboard: arrows ±10 (Shift ±1), Page Up / Down ±40, Home / End — and the page does not get them
  const key = (k, o) => keydown(g, k, o);
  // … and a height chosen for a taller window stays remembered while the keys are at a short window's limit: asking for
  // more (arrows, End, a drag up — also one that went down first) keeps it, asking for less replaces it
  await resize(s, 0, 500);
  key('ArrowUp'); key('PageUp'); key('End');
  assert.deepEqual([api.kb().h, api.kb().hSet], [148, 290], 'more than the limit: the remembered 290 px stays');
  fire(g, ptr('pointerdown', 6, 500, 600, { pointerType: 'mouse' }));
  fire(g, ptr('pointermove', 6, 500, 640, { pointerType: 'mouse' }));
  assert.deepEqual([api.kb().h, api.kb().hSet], [108, 108], 'dragged down 40 px');
  fire(g, ptr('pointermove', 6, 500, 580, { pointerType: 'mouse' }));
  fire(g, ptr('pointerup', 6, 500, 580, { pointerType: 'mouse' }));
  assert.deepEqual([api.kb().h, api.kb().hSet], [148, 290], '… and back up past the limit: the height from before the drag');
  assert.equal(JSON.parse(ls.m.get('synthc.kbSize')).h, 290);
  key('ArrowDown');
  assert.deepEqual([api.kb().h, api.kb().hSet], [138, 138], 'less: chosen');
  await resize(s, 0, 900);
  key('End'); key('Home'); key('PageUp'); key('PageUp'); key('PageUp'); key('PageUp'); key('PageUp');
  assert.deepEqual([api.kb().h, api.kb().hSet], [270, 270]);
  key('ArrowUp', { shiftKey: true }); key('ArrowUp', { shiftKey: true }); key('ArrowDown', { shiftKey: true }); key('ArrowDown', { shiftKey: true }); key('ArrowUp'); key('ArrowUp');
  assert.equal(api.kb().h, 290);
  assert.ok(key('ArrowUp').defaultPrevented);
  assert.equal(api.kb().h, 300);
  key('ArrowDown', { shiftKey: true }); assert.equal(api.kb().h, 299);
  key('PageDown'); assert.equal(api.kb().h, 259);
  key('Home'); assert.equal(api.kb().h, 70);
  key('End'); assert.equal(api.kb().h, 360);
  assert.equal(key('KeyA').defaultPrevented, false, 'other keys stay the page\'s (notes)');
  assert.equal(JSON.parse(ls.m.get('synthc.kbSize')).h, 360);
  for (const k of ['Delete', 'Backspace']) {
    key('End');
    const e = key(k);
    assert.deepEqual([api.kb().h, api.kb().hSet, e.defaultPrevented, e.stopped], [170, 0, true, true], k + ': the default (and not the page\'s Delete)');
    assert.equal(JSON.parse(ls.m.get('synthc.kbSize')).h, 0);
  }
  // (2026-10-22) Enter / Space and a tap are the tab's open / fold, no reset: the height kept through a fold and back
  key('End');
  key('Enter');
  assert.equal(globalThis.__synthTest.shell.kbGone(), true, 'Enter: folded away');
  key(' ');
  assert.deepEqual([globalThis.__synthTest.shell.kbGone(), api.kb().h, api.kb().hSet], [false, 360, 360], 'Space: back, its height kept');
  for (let i = 0; i < 2; i++) { fire(g, ptr('pointerdown', 8 + i, 300, 10)); fire(g, ptr('pointerup', 8 + i, 301, 10)); }
  assert.deepEqual([globalThis.__synthTest.shell.kbGone(), api.kb().h, api.kb().hSet], [false, 360, 360], 'two taps: away and back — no double-tap reset any more');
  key('Delete');
  await s.settle(300);
  // a phone / portrait tablet width: its own default (style.css .keys 128 px)
  await resize(s, 800);
  assert.equal(api.kb().h, 128);
  // a window too small for the budget (a phone in landscape): the keys keep their least (70 px), the default stays chosen
  await resize(s, 0, 300);
  assert.deepEqual([api.kb().h, api.kb().hSet, g.getAttribute('aria-valuemax')], [70, 0, '70'], 'the budget: the keys at their least');
  key('ArrowUp'); key('End');
  fire(g, ptr('pointerdown', 5, 500, 600, { pointerType: 'mouse' }));
  fire(g, ptr('pointermove', 5, 500, 500, { pointerType: 'mouse' }));
  fire(g, ptr('pointerup', 5, 500, 500, { pointerType: 'mouse' }));
  assert.deepEqual([api.kb().h, api.kb().hSet], [70, 0], 'at the limit already: asking for more changes nothing (the default is kept)');
  key('ArrowDown');
  assert.deepEqual([api.kb().h, api.kb().hSet], [70, 0], 'nor less: the least');
  await resize(s, 1400, 900);
  assert.equal(api.kb().h, 170);
});

test('rebuilding the keys under held fingers (key size, octave, resize) leaves no stuck notes; glissando, multi-touch and velocity-by-position keep working', async () => {
  const s = await page(), { api } = s, keys = s.$('#keys');
  const t = api.project().tracks.find(x => x.id === api.project().selTrack), node = s.nodeOf(t.id);
  assert.ok(node, 'the selected track has a node');
  globalThis.document.elementFromPoint = x => ({ closest: () => ({ dataset: { n: String(60 + Math.floor(x / 10)) } }) }); // 10 px per note
  node.posted.length = 0;
  fire(keys, ptr('pointerdown', 1, 0, 50));
  fire(keys, ptr('pointerdown', 2, 40, 80));
  assert.deepEqual([...api.held.keys()].sort(), ['0:60', '0:64']);
  const on = node.posted.filter(m => m.m.t === 'on');
  assert.deepEqual(on.map(m => m.m.n), [60, 64]);
  assert.ok(Math.abs(on[0].m.v - 0.675) < 1e-9 && Math.abs(on[1].m.v - 0.9) < 1e-9, 'velocity by position (lower = louder)');
  slide(s, 30);
  assert.ok(keyEl(s, 60).classList.contains('down') && keyEl(s, 64).classList.contains('down'), 'held keys stay lit after a rebuild');
  s.$('#octup').onclick();
  s.$('#keys').clientWidth = 700;
  await resize(s);
  fire(keys, ptr('pointermove', 1, 20, 50)); // glissando to 62 on the rebuilt keys
  assert.deepEqual([...api.held.keys()].sort(), ['0:62', '0:64']);
  fire(keys, ptr('pointermove', 2, 20, 50)); // the second finger onto the same key: 64 ends, 62 stays held by both
  assert.deepEqual([...api.held.keys()], ['0:62']);
  fire(keys, ptr('pointerup', 1, 20, 50));
  assert.deepEqual([...api.held.keys()], ['0:62'], 'still held by the other finger');
  s.$('#octdn').onclick();
  fire(keys, ptr('pointerup', 2, 20, 50));
  assert.equal(api.held.size, 0, 'no stuck notes');
  assert.equal(api.kb().ptrs.size, 0);
  const count = type => { const c = {}; for (const m of node.posted) if (m.m.t === type) c[m.m.n] = (c[m.m.n] || 0) + 1; return c; };
  assert.deepEqual(count('off'), count('on'), 'every note-on has its note-off');
  assert.ok(api.kb().notes.every(n => !keyEl(s, n).classList.contains('down')), 'no key left lit');
  // a lost capture (or cancel) after a rebuild ends the note too
  fire(keys, ptr('pointerdown', 3, 0, 50));
  slide(s, 60);
  fire(keys, ptr('lostpointercapture', 3, 0, 50));
  assert.equal(api.held.size, 0);
  // a computer key held across an octave change releases the note it started
  s.key('KeyA', true);
  s.key('KeyX', true); s.key('KeyX', false);
  s.key('KeyA', false);
  assert.equal(api.held.size, 0);
  s.key('KeyZ', true); s.key('KeyZ', false);
  fire(s.$('#kbw'), { type: 'dblclick' });
  s.$('#keys').clientWidth = 1000;
  delete globalThis.document.elementFromPoint;
});

test('Hide keyboard (2026-10-22, the user: "collapse down to just the tab"): the whole tray — keys and controls — folds away (out of the grid, below the screen edge: .gone, gliding), fingers on the keys released; its tab is a button then; a tap on the tab (or Enter / Space) brings it back laid out for its width', async () => {
  const s = await page(), { api } = s, keys = s.$('#keys'), b = s.$('#kbHide'), g = s.$('#kbGrip'), p = s.$('#perf'), sh = globalThis.__synthTest.shell;
  globalThis.document.elementFromPoint = x => ({ closest: () => ({ dataset: { n: String(60 + Math.floor(x / 10)) } }) });
  fire(keys, ptr('pointerdown', 4, 30, 50));
  assert.deepEqual([...api.held.keys()], ['0:63']);
  b.onclick();
  assert.deepEqual([sh.kbGone(), p.classList.contains('gone'), p.classList.contains('glide'), s.$('#kbrow').hidden, b.getAttribute('aria-expanded')], [true, true, true, false, 'false'],
    'folded away (gliding down; the keys stay laid out, the stylesheet hides them)');
  assert.equal(p.classList.contains('min'), false, 'no slim bar');
  assert.equal(api.held.size, 0, 'the finger\'s note ended with the keys');
  fire(keys, ptr('pointerup', 4, 30, 50));
  assert.equal(api.held.size, 0);
  assert.equal(ls.m.get('synthc.kbHidden'), 'true');
  assert.deepEqual([g.getAttribute('role'), g.getAttribute('aria-expanded'), g.getAttribute('aria-label'), g.hasAttribute('aria-valuenow')], ['button', 'false', 'Keyboard (folded away): show it', false], 'the tab: a button');
  await s.settle(300);
  assert.deepEqual([p.classList.contains('glide'), p.classList.contains('gone')], [false, true], 'the glide over');
  s.$('#octup').onclick(); // (the octave keys still work)
  s.$('#keys').clientWidth = 1300;
  fire(g, ptr('pointerdown', 5, 500, 896)); fire(g, ptr('pointermove', 5, 500, 893)); fire(g, ptr('pointerup', 5, 500, 893)); // (a tap: 3 px of travel)
  assert.deepEqual([sh.kbGone(), p.classList.contains('gone'), p.classList.contains('glide'), b.getAttribute('aria-expanded'), g.getAttribute('role'), g.getAttribute('aria-label')],
    [false, false, true, 'true', 'slider', 'Keyboard height'], 'a tap on the tab: back (gliding up, out of the grid until it lands)');
  assert.deepEqual([api.kb().w, api.kb().lo, api.kb().hi], [1300, 48, 108], 'five octaves for 1300 px, an octave up');
  assert.equal(ls.m.get('synthc.kbHidden'), 'false');
  await s.settle(300);
  assert.equal(p.classList.contains('glide'), false, 'in the grid again');
  for (const [k, gone] of [['Enter', true], [' ', false]]) { const e = keydown(g, k); assert.deepEqual([sh.kbGone(), e.defaultPrevented, e.stopped], [gone, true, true], JSON.stringify(k)); }
  s.$('#octdn').onclick();
  await s.settle(300);
  delete globalThis.document.elementFromPoint;
});

test('the keyboard\'s tab pulled (2026-10-22, the user: "pull it out like a physical tray"): from folded the tray follows the finger out of the grid (.pull, a translateY of what is left of its travel), its release snaps it — past half open, under half shut again, a second finger shut again (the pinch); open, dragged below its 70 px keys the drawer closes the same way, its height kept as it was', async () => {
  const s = await page(), { api } = s, g = s.$('#kbGrip'), p = s.$('#perf'), sh = globalThis.__synthTest.shell, tf = () => p.style.transform || '';
  sh.setKbHidden(true); await s.settle(300);
  const h0 = api.kb().h, full = 64 + h0; // (the stub's chrome: 64 px)
  fire(g, ptr('pointerdown', 6, 500, 900)); fire(g, ptr('pointermove', 6, 500, 850));
  assert.deepEqual([p.classList.contains('pull'), p.classList.contains('gone'), tf()], [true, false, `translateY(${full - 50}px)`], '50 px out');
  fire(g, ptr('pointermove', 6, 500, 820)); T += 400; fire(g, ptr('pointermove', 6, 500, 820)); T += 400; fire(g, ptr('pointerup', 6, 500, 820));
  assert.deepEqual([sh.kbGone(), p.classList.contains('pull'), p.classList.contains('gone'), tf()], [true, false, true, ''], '80 of ' + full + ' px slowly: shut again');
  fire(g, ptr('pointerdown', 7, 500, 900)); fire(g, ptr('pointermove', 7, 500, 700)); fire(g, ptr('pointercancel', 7, 500, 700, { gesture: 'two-finger' }));
  assert.deepEqual([sh.kbGone(), p.classList.contains('gone'), ls.m.get('synthc.kbHidden')], [true, true, 'true'], 'a second finger: shut, nothing saved');
  fire(g, ptr('pointerdown', 8, 500, 900)); fire(g, ptr('pointermove', 8, 500, 760)); T += 400; fire(g, ptr('pointermove', 8, 500, 760)); T += 400; fire(g, ptr('pointerup', 8, 500, 760));
  assert.deepEqual([sh.kbGone(), p.classList.contains('glide'), tf(), ls.m.get('synthc.kbHidden'), api.kb().h], [false, true, '', 'false', h0], '140 px: past half — open at its height');
  await s.settle(300);
  // open: dragged down past the 70 px keys, the drawer closes under the finger
  fire(g, ptr('pointerdown', 9, 500, 600)); fire(g, ptr('pointermove', 9, 500, 600 + (h0 - 70)));
  assert.deepEqual([api.kb().h, p.classList.contains('pull')], [70, false], 'sized down to the least');
  fire(g, ptr('pointermove', 9, 500, 600 + (h0 - 70) + 100));
  assert.deepEqual([api.kb().h, p.classList.contains('pull'), tf()], [70, true, 'translateY(100px)'], 'then the drawer: 100 px in');
  T += 400; fire(g, ptr('pointermove', 9, 500, 600 + (h0 - 70) + 100)); T += 400; fire(g, ptr('pointerup', 9, 500, 600 + (h0 - 70) + 100));
  assert.deepEqual([sh.kbGone(), p.classList.contains('gone'), api.kb().hSet, ls.m.get('synthc.kbHidden')], [true, true, 0, 'true'], '100 of 134 px in: folded away, the height as it was');
  sh.setKbHidden(false); await s.settle(300);
  assert.equal(api.kb().h, h0, 'it opens at its height');
});

test('folded away, the keyboard plays on (2026-10-22): the computer keys and MIDI in, Hold (sustain kept), Escape is still Panic — the Panic button folded away with the tray (the tab brings it back)', async () => {
  const s = await page(), { api } = s, sh = globalThis.__synthTest.shell, hold = s.$('#hold'), doc = globalThis.document;
  hold.onclick();
  assert.equal(hold.getAttribute('aria-pressed'), 'true');
  sh.setKbHidden(true);
  assert.equal(hold.getAttribute('aria-pressed'), 'true', 'Hold stays on');
  const n0 = api.held.size;
  s.key('KeyA', true);
  assert.equal(api.held.size, n0 + 1, 'a computer key plays');
  s.key('KeyA', false);
  api.midi.message([0x90, 64, 100], performance.now());
  assert.ok([...api.held.keys()].some(k => k.endsWith(':64')), 'MIDI in plays');
  api.midi.message([0x80, 64, 0], performance.now());
  const esc = { type: 'keydown', key: 'Escape', code: 'Escape', keyCode: 27, target: doc.body, defaultPrevented: false, isComposing: false,
    metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault() {}, stopPropagation() {} };
  doc.activeElement = null;
  for (const f of s.dom.winL.keydown || []) f(esc);
  assert.deepEqual([hold.getAttribute('aria-pressed'), api.held.size], ['false', 0], 'Escape: Panic (sustain off, every note ended)');
  sh.setKbHidden(false); await s.settle(300);
});

test('the grip\'s taps (2026-10-22): a tap — touch, pen or mouse — folds the keyboard away and the next brings it back (no double-tap reset any more: Delete / Backspace reset the height); nudges of 6 px are drags; double tap on the Key size slider resets only after two taps in place that changed nothing; the mouse uses its own dblclick; Delete / Backspace reset the Key size slider', async () => {
  const s = await page(), { api } = s, g = s.$('#kbGrip'), kw = s.$('#kbw'), sh = globalThis.__synthTest.shell, at = (el, x, y, o) => { fire(el, ptr('pointerdown', 20, x, y, o)); };
  const up = (el, x, y, o) => fire(el, ptr('pointerup', 20, x, y, o));
  const tap = (el, x, y, o) => { at(el, x, y, o); up(el, x, y, o); };
  s.$('#keys').clientWidth = 1000;
  keydown(g, 'End'); // a chosen height (360 px)
  // the grip: two nudges of 6 px (a drag: the height moves) fold nothing
  for (let i = 0; i < 2; i++) { at(g, 300, 300); fire(g, ptr('pointermove', 20, 300, 306)); T += 400; up(g, 300, 306); }
  assert.deepEqual([api.kb().h, api.kb().hSet, sh.kbGone()], [348, 348, false], 'two nudges: moved, still open');
  for (const pt of ['touch', 'pen', 'mouse']) {
    tap(g, 300, 300, { pointerType: pt });
    assert.equal(sh.kbGone(), true, pt + ': a tap folds it away');
    tap(g, 300, 300, { pointerType: pt });
    assert.deepEqual([sh.kbGone(), api.kb().hSet], [false, 348], pt + ': the next brings it back, its height kept');
  }
  fire(g, { type: 'dblclick' });
  assert.deepEqual([sh.kbGone(), api.kb().hSet], [false, 348], 'a dblclick is nothing of its own');
  keydown(g, 'Delete');
  assert.equal(api.kb().hSet, 0, 'Delete: the default height');
  await s.settle(300);
  // the slider: a press that moved the thumb (Chrome's tap on the track, a nudge) is not a tap
  slide(s, 40);
  for (const v of [50, 51]) { at(kw, 40, 10); kw.value = String(v); fire(kw, { type: 'input', target: kw }); fire(kw, { type: 'change', target: kw }); up(kw, 41, 10); }
  assert.equal(api.kb().kw, 51, 'two nudges: no reset');
  tap(kw, 40, 10); tap(kw, 41, 11);
  assert.equal(api.kb().kw, 0, 'two taps that left it alone: fitted to the screen again');
  slide(s, 40);
  tap(kw, 40, 10, { pointerType: 'mouse' }); tap(kw, 40, 10, { pointerType: 'mouse' });
  assert.equal(api.kb().kw, 40);
  fire(kw, { type: 'dblclick' });
  assert.equal(api.kb().kw, 0, 'mouse: dblclick');
  // the keyboard: Delete / Backspace fit the keys to the screen again (and are not the page's Delete); the arrows are the slider's
  for (const k of ['Delete', 'Backspace']) {
    slide(s, 40);
    const e = keydown(kw, k);
    assert.deepEqual([api.kb().kw, e.defaultPrevented, e.stopped], [0, true, true], k);
    assert.equal(JSON.parse(ls.m.get('synthc.kbSize')).kw, 0, 'saved');
  }
  const e = keydown(kw, 'ArrowLeft');
  assert.deepEqual([e.defaultPrevented, e.stopped], [false, false]);
  keydown(g, 'Delete');
});

test('Key size slider range: from the widest key that still shows all 75 keys to the narrowest that shows one octave, at the keys\' width; a saved width outside it is kept', async () => {
  const s = await page(), { api } = s, kw = s.$('#kbw'), keys = s.$('#keys');
  const shown = W => [Math.max(16, ...[...Array(97).keys()].filter(k => k >= 16 && api.kbRange(W, k, 0).nW === 75)), Math.min(96, ...[...Array(97).keys()].filter(k => k >= 16 && api.kbRange(W, k, 0).nW === 8))];
  for (const W of [150, 236, 290, 600, 1000, 1200, 1500, 1560]) {
    keys.clientWidth = W; await resize(s);
    const [lo, hi] = [+kw.min, +kw.max];
    assert.ok(lo >= 16 && hi <= 96 && hi - lo >= 8, `W ${W}: ${lo}–${hi}`);
    const [a, b] = shown(W);
    assert.equal(lo, a, `W ${W}: the widest key that shows all 75 (or 16 px)`);
    if (W > 9 * 24) assert.equal(hi, b, `W ${W}: the narrowest key that shows one octave (or 96 px)`);
    if (lo > 16) assert.ok(api.kbRange(W, lo + 1, 0).nW < 75, `W ${W}: one step in from the left end shows fewer`);
    if (hi > 24 && hi < 96) assert.equal(api.kbRange(W, hi - 1, 0).nW, 9, `W ${W}: one step in from the right end shows more`);
  }
  keys.clientWidth = 290; await resize(s);
  assert.deepEqual([kw.min, kw.max], ['16', '33'], 'a phone: 16–33 (was 16–96, 37–96 all one octave)');
  keys.clientWidth = 1000; await resize(s);
  slide(s, 60);
  keys.clientWidth = 290; await resize(s);
  assert.equal(api.kb().kw, 60, 'the saved width is kept');
  assert.equal(whites(api.kb().lo, api.kb().hi), 8);
  keys.clientWidth = 1000; await resize(s);
  assert.equal(whites(api.kb().lo, api.kb().hi), 16, '1000 / 60 → 16 white keys again');
  // C labels: under 17 px a chosen width drops them; the fitted keys keep them (the Phase-1 look on a 320 px phone)
  keys.clientWidth = 236; await resize(s);
  slide(s, 16);
  assert.deepEqual([api.kb().px < 17, spans(s, 'nm').length], [true, 0]);
  fire(kw, { type: 'dblclick' });
  assert.ok(api.kb().px < 17);
  assert.deepEqual(spans(s, 'nm'), [60, 72, 84], 'fitted: C4 C5 C6');
  keys.clientWidth = 1000; await resize(s);
});

test('index.html: the Key size slider is named by its label (no aria-label of its own); Hide keyboard keeps its text for screen readers', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const lab = /<label class="grp kbsize"[^>]*>(.*?)<\/label>/s.exec(html);
  assert.ok(lab, 'the Key size label');
  assert.match(lab[1], /<span class="lbl">Key size<\/span>\s*<input type="range" id="kbw"/);
  assert.doesNotMatch(lab[1], /aria-label/);
  assert.match(html, /<button id="kbHide"[^>]*>.*<span>Hide keyboard<\/span><\/button>/);
});

// the two-finger layer (gesture.js, tests/gesture.test.mjs): installed first in boot(), so its window listeners come
// before pressStart, wake and the keys'; the zones of index.html. (main-sim's window has no capture phase and runs every
// listener: only the order and the layer's own answer are seen here.)
test('gesture.js: the two-finger layer\'s window pointerdown / click listeners come first; #kbrow is "music", #rollwrap "own", #perf "perf"', async () => {
  const s = await page(), L = s.dom.winL, body = s.dom.document.body;
  const ev = (type, o) => Object.assign({ type, target: body, cancelable: true, prevented: false, imm: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.imm = true; }, stopPropagation() {} }, o);
  const t = (type, id, x, primary) => ev(type, { pointerType: 'touch', pointerId: id, isPrimary: primary, clientX: x, clientY: 300 });
  L.pointerdown[0](t('pointerdown', 901, 300, true));
  const second = t('pointerdown', 902, 400, false);
  L.pointerdown[0](second);
  // (main-sim has no getComputedStyle: every touch may pinch-zoom → a native session, swallowed only — never
  // preventDefault-ed, the browser's pinch as without the layer; ruling Z1)
  assert.deepEqual([second.prevented, second.imm], [false, true], 'a second finger 100 px away at once: a two-finger gesture, its press swallowed');
  const c = ev('click', { detail: 1 });
  L.click[0](c);
  assert.equal(c.imm, true, 'its click swallowed first');
  for (const id of [901, 902]) L.pointerup[0](t('pointerup', id, 300, id === 901));
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const [id, kind] of [['kbrow', 'music'], ['rollwrap', 'own'], ['perf', 'perf']]) assert.match(html, new RegExp(`<\\w+ [^>]*id="${id}"[^>]*data-gesture="${kind}"`), id);
});

// a two-finger gesture that starts with a finger on the grip (gesture.js's pointercancel flagged e.gesture ===
// 'two-finger', main.js track()'s abort): the height as it was, nothing saved; a plain pointercancel keeps it, as before
test('height grip: a two-finger gesture (flagged pointercancel) puts the height back unsaved; a plain pointercancel keeps and saves it', async () => {
  const s = await page(), { api } = s, g = s.$('#kbGrip');
  const h0 = api.kb().h, hs0 = api.kb().hSet, saved0 = ls.m.get('synthc.kbSize') || null;
  fire(g, ptr('pointerdown', 31, 500, 600));
  fire(g, ptr('pointermove', 31, 500, 560));
  assert.equal(api.kb().h, h0 + 40, 'dragged up 40 px');
  fire(g, ptr('pointercancel', 31, 500, 560, { gesture: 'two-finger' }));
  assert.deepEqual([api.kb().h, api.kb().hSet, g.getAttribute('aria-valuenow')], [h0, hs0, String(h0)], 'back as it was');
  assert.equal(ls.m.get('synthc.kbSize') || null, saved0, 'nothing saved');
  fire(g, ptr('pointermove', 31, 500, 500));
  assert.equal(api.kb().h, h0, 'the drag has ended');
  fire(g, ptr('pointerdown', 32, 500, 600));
  fire(g, ptr('pointermove', 32, 500, 560));
  fire(g, ptr('pointercancel', 32, 500, 560));
  assert.equal(api.kb().h, h0 + 40, 'a plain cancel keeps it');
  assert.equal(JSON.parse(ls.m.get('synthc.kbSize')).h, h0 + 40, 'and saves it');
  keydown(g, 'Delete'); // (the default again, for the tests after)
  assert.equal(api.kb().hSet, 0);
});

// (boots its own page: after the tests that share page())
test('the keyboard view persists: key height, key width and Hide keyboard (folded away) come back in the next session — without a glide; bad stored values are ignored', async () => {
  const s = await page(), g = s.$('#kbGrip');
  slide(s, 44);
  fire(g, ptr('pointerdown', 9, 500, 600, { pointerType: 'mouse' }));
  fire(g, ptr('pointermove', 9, 500, 550, { pointerType: 'mouse' }));
  fire(g, ptr('pointerup', 9, 500, 550, { pointerType: 'mouse' }));
  s.$('#kbHide').onclick();
  assert.deepEqual(JSON.parse(ls.m.get('synthc.kbSize')), { h: 220, kw: 44 });
  const s2 = await bootMain({ ls });
  const K = s2.api.kb();
  assert.deepEqual([K.h, K.hSet, K.kw], [220, 220, 44], 'restored');
  assert.equal(s2.$('#kbw').value, '44');
  assert.equal(globalThis.__synthTest.shell.kbGone(), true);
  assert.deepEqual([s2.$('#perf').classList.contains('gone'), s2.$('#perf').classList.contains('glide'), s2.$('#kbrow').hidden], [true, false, false], 'still folded away (no glide at boot)');
  assert.equal(s2.$('#kbHide').getAttribute('aria-expanded'), 'false');
  assert.equal(s2.$('#kbGrip').getAttribute('role'), 'button');
  const s3 = await bootMain({ ls: fakeStorage({ 'synthc.kbSize': JSON.stringify({ h: 'tall', kw: 4000 }), 'synthc.kbHidden': 'false' }) });
  const K3 = s3.api.kb();
  assert.deepEqual([K3.h, K3.hSet, K3.kw], [170, 0, 96], 'a non-number is the default, a width beyond the range is clamped');
  assert.equal(s3.$('#perf').classList.contains('gone'), false);
});
