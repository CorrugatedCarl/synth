import './v8-guard.mjs';
// Stage 1i (docs/canvas/IMPL-1i.md §6, §9 "Host / sims", lane H): the hardware keyboards in the page simulation — the real
// main.js (a guard build: __synthTest is set, a track's v1 fields throw), canvas-sim's scripted world, the real cv-panel /
// cv-keys widgets on the stub DOM. A bed press → noteOn → {t: 'on', n, v} at the press depth's velocity on the selected
// track's node, recorded on an armed track; MIDI-in and the computer keys light the bed; the CS-80 ribbon → bend and the
// tray's wheel follows; the tray's wheels and a MIDI bend that reaches the selected track move the Prophet-5's wheels (one
// on another channel does not); tray + bed on one note; panic / power off / a hidden page / the Simple switch / a track
// switch leave nothing held or lit; a stale panel plays nothing; makeRoom for the modular and the ARP; the TB-303's keys
// sound seqToRoll's notes (the one SEQ_ROOT); noteOn(NaN); the sleeping-keys hint. Review 1: Undo / Redo / a load / a track switch /
// a track delete with a key or a wheel held end them on the track they were on; a blur keeps a MIDI note lit; a press-focused
// controller leaves Space / Home to the page. Accessor-free (lane A's hook and
// ratchet pass over it): devices through cv-model instOf / __synthTest.cv, never t.model / t.vals / fxOf(t). One boot;
// strings, numbers and plain data into assert — never a stub DOM node.
// Run alone: node --max-old-space-size=2048 --test tests/canvas-1i-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import { MODELS } from '../models.js?v=9';
import * as cvPanel from '../cv-panel.js?v=9';
import * as cvModule from '../cv-module.js?v=9';
import * as cvWorld from '../cv-world.js?v=9';
import * as CMOD from '../cv-model.js?v=9';
import * as KY from '../cv-keys.js?v=9';

/* ---------------------------------------------------------------- a scripted world (canvas-sim's) */
const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1520, bottom: 700 };
function scriptedWorld(root) {
  // the tray's wheels (built after the world at boot): stable .slot / .thumb nodes — the stub's querySelector makes a new
  // node per call — so a test drives and reads them
  for (const id of ['#bend', '#modw']) { const w = document.querySelector(id), kids = {}; w.querySelector = sel => kids[sel] || (kids[sel] = document.createElement('div')); }
  const L = {};
  const W = {
    el: root, k: 1, cam: { tx: 0, ty: 0, k: 1 }, items: new Map(), log: [], selected: null,
    setCamera(c) { W.cam = { tx: c.tx, ty: c.ty, k: c.k }; W.k = c.k; W.emit('cameraend', { cam: W.cam, zoomed: true }); },
    band: () => Object.assign({}, BAND),
    toClient: (wx, wy) => ({ x: VP.left + wx * W.k + W.cam.tx, y: VP.top + wy * W.k + W.cam.ty }),
    toWorld: (x, y) => ({ x: (x - VP.left - W.cam.tx) / W.k, y: (y - VP.top - W.cam.ty) / W.k }),
    add(it) { W.items.set(it.id, it); return () => W.remove(it.id); },
    remove(id) { W.items.delete(id); },
    update() {}, clear() { W.items.clear(); },
    select(id) { W.selected = id; W.emit('select', { id }); },
    focusItem() {}, dragPointer() {},
    on(t, fn) { (L[t] || (L[t] = [])).push(fn); return () => { L[t] = L[t].filter(f => f !== fn); }; },
    emit(t, d) { for (const f of (L[t] || []).slice()) f(d); },
  };
  return W;
}

// the Chromium clock (performance.now() = sim.ms, moved by sim.run): a press's timeStamp is the recording's clock
const sim = await bootMain({ ls: fakeStorage({}), hash: '#cs80', clock: 'std', synthTest: { cvWorld: root => scriptedWorld(root) } });
const api = sim.api, cv = globalThis.__synthTest.cv, acc = globalThis.__synthTest.acc, W = cv.world();
await sim.power(); sim.raf(); await sim.settle(5); sim.raf();
const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack);
const I = t => CMOD.instOf(t); // (a track's primary instrument device: never the track's v1 fields)
const MOD = id => MODELS.find(m => m.id === id);
const hsteps = () => cv.hist.u.length;
const fresh = id => { const t = api.addTrack(MOD(id)); sim.raf(); cv.renderViews(); sim.raf(); return t; }; // (selected; its view mounted)

/* ---------------------------------------------------------------- the stub DOM: find, events, the panel's parts */
const find = (n, f) => { if (f(n)) return n; for (const c of n.children || []) { const r = find(c, f); if (r) return r; } return null; };
const findAll = (n, f, out = []) => { if (f(n)) out.push(n); for (const c of n.children || []) findAll(c, f, out); return out; };
const body = () => cv.bodyEl(cv.cur());
const wrapOf = id => find(body(), x => !!x.attrs && x.attrs['data-ctl'] === id); // a .hw-c
const widget = id => { const w = wrapOf(id); return w ? w.children[0] : null; };
let pid = 500;
const pev = (el, type, x, y, o) => el.dispatchEvent(Object.assign({ type, target: el, currentTarget: el, button: 0, buttons: /^(pointerup|pointercancel|lostpointercapture)$/.test(type) ? 0 : 1,
  pointerId: pid, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, timeStamp: performance.now(), pressure: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
  preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }, o || {}));
const rect = (el, w, h) => { el.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0 }); };
const geoOf = id => { const m = MOD(id); return cvPanel.geometry(cvPanel.usable(id, m), m); };
const ctlOf = (id, tok) => cvPanel.usable(id, MOD(id)).controls.find(c => c.id === tok);
// the selected track's bed at 2 px / mm (its rect read per event: the camera's scale): B the cv-keys layout (clamped front)
function bedOf(id) {
  const el = widget('perf:keys'), B = geoOf(id).controls.find(o => o.id === 'perf:keys').bed.mm;
  assert.ok(el && el.className === 'hw-keys', id + ': a bed');
  rect(el, B.w * 2, (B.h + B.front) * 2);
  return { el, B };
}
// a press on note n at depth f of its key (0 back … 1 front; > 1: into the front band): the hit and velocity cv-keys gives
function press(bd, n, f, id = ++pid, o) {
  const k = bd.B.keys[n - bd.B.lo], x = k.x + k.w / 2, y = f * k.h, hit = KY.keyAt(bd.B, x, y, 2);
  pev(bd.el, 'pointerdown', x * 2, y * 2, Object.assign({ pointerId: id }, o));
  return Object.assign({ id, x, y }, hit);
}
const lift = (bd, p) => pev(bd.el, 'pointerup', p.x * 2, p.y * 2, { pointerId: p.id });
const shades = () => findAll(widget('perf:keys') || { children: [] }, x => x.className === 'hw-kd' && !('hidden' in x.attrs)).map(x => +x.attrs['data-note']);
const node = t => sim.nodeOf((t || T()).id);
const msgs = (t, ...ks) => node(t).posted.filter(x => ks.includes(x.m.t)).map(x => x.m);
const clear = (...ts) => { for (const t of ts.length ? ts : [T()]) node(t).posted.length = 0; };
const heldNotes = () => [...api.held.keys()].sort();
const tray = id => ({ slot: sim.$('#' + id).querySelector('.slot'), thumb: sim.$('#' + id).querySelector('.thumb') });
const thumbAt = id => tray(id).thumb.style.top; // calc((1 − v) …): the tray wheel's view
const last = (t, k) => { const a = msgs(t, k); return a.length ? a[a.length - 1].v : null; };
const rms = (out, n) => { const o = out.get(n); let s = 0; for (const x of o.L) s += x * x; return Math.sqrt(s / o.L.length); };
const step = () => { cv.hist.record(P(), 'Rename'); T().name += '*'; }; // (a History step that keeps the selection: something for Undo to undo)

test('a CS-80 key: {t: on, n, v} on the selected track\'s node, v from where the key is touched (back soft, front loud, the front band full); its lift {t: off}; the pressed key\'s shade', () => {
  const t = T(), bd = bedOf('cs80');
  assert.equal(I(t).model, 'cs80');
  assert.deepEqual([bd.B.lo, bd.B.hi], [36, 96]);
  clear();
  const p = press(bd, 60, 0.1);
  assert.deepEqual(msgs(t, 'on', 'off'), [{ t: 'on', n: 60, v: p.v }]);
  assert.equal(p.v, KY.velOf(bd.B, 60, 0.1 * bd.B.len));
  assert.ok(Math.abs(p.v - 0.375) < 1e-9, 'the back of the key: soft ' + p.v);
  assert.deepEqual([shades(), heldNotes()], [[60], ['0:60']]);
  lift(bd, p);
  assert.deepEqual([msgs(t, 'on', 'off').at(-1), shades(), heldNotes()], [{ t: 'off', n: 60 }, [], []]);
  clear();
  const q = press(bd, 61, 0.9), r = press(bd, 64, 1 + 3 / bd.B.len); // (a black key near its front; E pressed 3 mm into the band)
  assert.deepEqual(msgs(t, 'on'), [{ t: 'on', n: 61, v: q.v }, { t: 'on', n: 64, v: 1 }]);
  assert.ok(q.v > 0.9, 'a black key by its own length: ' + q.v);
  assert.deepEqual(shades().sort(), [61, 64]);
  lift(bd, q); lift(bd, r);
  assert.deepEqual([heldNotes(), shades()], [[], []]);
});

test('recording: an armed track records the bed\'s note (noteOn → recStart, the lift → recEnd) at the press\'s velocity', async () => {
  const t = T(), proj = P(), TR = api.transport(), bd = bedOf('cs80');
  t.arm = true;
  proj.metronome.countIn = 0; proj.metronome.on = false;
  sim.$('#tPlay').click(); await sim.settle(2);
  sim.run(48000 * 0.5); sim.raf();
  sim.$('#tRec').click();
  assert.equal(TR.rec, true);
  const p = press(bd, 67, 0.5);
  sim.run(48000 * 0.5); sim.raf();
  lift(bd, p);
  sim.$('#tRec').click(); sim.$('#tPlay').click();
  const rec = t.notes.filter(n => n.take === TR.take);
  assert.equal(rec.length, 1, 'one note');
  assert.deepEqual([rec[0].n, rec[0].v], [67, Math.round(p.v * 127)]);
  assert.ok(rec[0].d > 600 && rec[0].d < 1300, 'about half a second long: ' + rec[0].d);
  t.arm = false; t.notes.length = 0;
});

test('MIDI-in and the computer keys light the bed (keyVis → PERF.lit, every source); the lift darkens it; a bed mounts lit', () => {
  const bd = bedOf('cs80');
  api.midi.message([0x90, 64, 100], performance.now());
  assert.deepEqual(shades(), [64], 'MIDI note-on');
  sim.key('KeyA', true);
  const kn = +heldNotes().find(k => k.startsWith('0:')).slice(2);
  assert.deepEqual(shades().sort((a, b) => a - b), [kn, 64].sort((a, b) => a - b), 'the computer key too');
  cv.setLayout('flow'); sim.raf(); cv.setLayout('hw'); sim.raf(); // (a re-render while both are held: the new bed mounts lit)
  bedOf('cs80');
  assert.deepEqual(shades().sort((a, b) => a - b), [kn, 64].sort((a, b) => a - b), 'mounted lit (perf.held)');
  api.midi.message([0x80, 64, 0], performance.now());
  sim.key('KeyA', false);
  assert.deepEqual([shades(), heldNotes()], [[], []]);
  void bd;
});

test('the CS-80 ribbon posts bend relative to the first touch (the original\'s octave over 490 mm: 41 mm a semitone, ±2 st), the tray\'s bend wheel follows (no echo); a touch that does not move posts nothing; it springs to 0 at the lift', () => {
  const t = T(), c = ctlOf('cs80', 'perf:bend'), el = widget('perf:bend');
  assert.equal(c.kind, 'ribbon');
  rect(el, c.w * 2, c.h * 2);
  clear();
  ++pid;
  pev(el, 'pointerdown', 400, 10); sim.raf();
  pev(el, 'pointerup', 400, 10); sim.raf();
  assert.deepEqual(msgs(t, 'bend'), [], 'a touch without moving does nothing');
  ++pid;
  pev(el, 'pointerdown', 400, 10);
  pev(el, 'pointermove', 400 + 82, 10); sim.raf(); // (41 mm to the right: + 1 semitone = 0.5 of ±2 st)
  const v = KY.dragValue(c, 'bend', 0, 41, 0);
  assert.ok(Math.abs(v - 41 * 12 / (490 * 2)) < 1e-9);
  assert.deepEqual(msgs(t, 'bend'), [{ t: 'bend', v }]);
  assert.equal(thumbAt('bend'), `calc(${(1 - (v + 1) / 2).toFixed(4)} * (100% - 26px))`, 'the tray wheel follows');
  assert.equal(api.perfValue('bend', t), v);
  pev(el, 'pointerup', 482, 10); sim.raf();
  assert.deepEqual(msgs(t, 'bend').at(-1), { t: 'bend', v: 0 }, 'springs home at once');
  assert.equal(thumbAt('bend'), 'calc(0.5000 * (100% - 26px))');
});

test('the tray\'s wheels move the Prophet-5\'s hardware wheels (a ctl that reached the selected track); a MIDI bend on a channel the selected track does not take leaves them still, one it takes moves them', () => {
  const a = fresh('prophet5'), b = api.addTrack(MOD('juno60')); sim.raf();
  api.selectTrack(a.id); sim.raf();
  const wb = () => widget('perf:bend'), wm = () => widget('perf:mod');
  assert.deepEqual([wb().className, wm().className, wb().attrs['aria-valuenow'], wm().attrs['aria-valuenow']], ['hw-wheel', 'hw-wheel', '0', '0']);
  // the tray's bend wheel: a press at its top quarter (the stub slot's rect: 100 px, 13 px of thumb each end)
  const tb = tray('bend').slot, tm = tray('modw').slot;
  ++pid; pev(tb, 'pointerdown', 10, 13 + 74 * 0.25, { pointerType: 'mouse' });
  assert.equal(wb().attrs['aria-valuenow'], '0.5', 'the hardware pitch wheel follows the tray (¾ up: +0.5)');
  pev(tb, 'pointerup', 10, 13 + 74 * 0.25, { pointerType: 'mouse' });
  assert.equal(wb().attrs['aria-valuenow'], '0', 'both spring home');
  ++pid; pev(tm, 'pointerdown', 10, 13 + 74 * 0.6, { pointerType: 'mouse' }); pev(tm, 'pointerup', 10, 13 + 74 * 0.6, { pointerType: 'mouse' });
  assert.equal(wm().attrs['aria-valuenow'], '0.4', 'the mod wheel follows and stays');
  assert.equal(wm().attrs['aria-valuetext'], '40 %');
  // MIDI: the selected track on channel 1, the Juno on channel 2
  a.ch = 1; b.ch = 2;
  clear(a, b);
  api.midi.message([0xe1, 0, 0x60], performance.now()); // (channel 2: +0.5)
  assert.deepEqual([msgs(b, 'bend').length, msgs(a, 'bend').length, wb().attrs['aria-valuenow']], [1, 0, '0'], 'another channel: the hardware wheel stays');
  api.midi.message([0xe0, 0, 0x60], performance.now()); // (channel 1)
  assert.deepEqual([msgs(a, 'bend').length, wb().attrs['aria-valuenow']], [1, '0.5'], 'its own channel: it follows');
  api.midi.message([0xb1, 1, 127], performance.now()); // (CC 1 on channel 2: the Juno's wheel)
  assert.equal(wm().attrs['aria-valuenow'], '0.4', 'a mod wheel that reached another track only');
  api.midi.message([0xe0, 0, 0x40], performance.now()); // (back to centre)
  a.ch = 0; b.ch = 0;
  assert.equal(wb().attrs['aria-valuenow'], '0');
});

test('the tray and the bed on one note: the second press retriggers (one held key), the bed\'s lift ends the tray\'s note too', () => {
  const t = T(), bd = bedOf('prophet5');
  clear();
  sim.key('KeyA', true);
  const kn = +heldNotes()[0].slice(2);
  const p = press(bd, kn, 0.5);
  assert.deepEqual(msgs(t, 'on', 'off').map(m => m.t + m.n), ['on' + kn, 'off' + kn, 'on' + kn], 'retriggered');
  assert.deepEqual(heldNotes(), ['0:' + kn]);
  lift(bd, p);
  assert.deepEqual([msgs(t, 'off').length, heldNotes(), shades()], [2, [], []], 'the bed\'s lift ended it');
  sim.key('KeyA', false);
  assert.equal(msgs(t, 'off').length, 2, 'the tray\'s lift: nothing more');
});

test('panic, power off, a hidden page, a window blur, the Simple switch and a track switch leave no held note and no lit key; the finger still down plays nothing more, its next press plays', async () => {
  const other = P().tracks.find(x => x.id !== T().id);
  const cases = [
    ['panic', () => sim.$('#panic').onclick()],
    ['power off', async () => { sim.$('#power').onclick(); await sim.settle(5); await sim.power(); sim.raf(); await sim.settle(5); }],
    ['hidden page', () => { document.hidden = true; for (const f of sim.dom.docL.visibilitychange || []) f({ type: 'visibilitychange' }); document.hidden = false; for (const f of sim.dom.docL.visibilitychange || []) f({ type: 'visibilitychange' }); }],
    ['window blur', () => sim.win('blur')],
    ['Simple switch', () => { cv.setLayout('flow'); sim.raf(); cv.setLayout('hw'); sim.raf(); }],
    ['track switch', () => { const id = T().id; api.selectTrack(other.id); sim.raf(); api.selectTrack(id); sim.raf(); }],
  ];
  for (const [name, fn] of cases) {
    let bd = bedOf('prophet5');
    const p = press(bd, 72, 0.5), q = press(bd, 48, 0.5);
    assert.deepEqual([heldNotes().length, shades().length], [2, 2], name + ': two held');
    await fn();
    bd = bedOf('prophet5');
    assert.deepEqual([heldNotes(), shades()], [[], []], name + ': nothing held, nothing lit');
    clear();
    lift(bd, p); lift(bd, q);
    assert.deepEqual(msgs(T(), 'on', 'off'), [], name + ': the stale lifts post nothing');
    const r = press(bd, 72, 0.5);
    assert.deepEqual(msgs(T(), 'on').map(m => m.n), [72], name + ': a new press plays');
    lift(bd, r);
    assert.deepEqual(heldNotes(), [], name);
  }
});

test('a press on a stale panel (its track no longer the selected one, the view not yet rebuilt) posts nothing; perf.on drops a note that is no integer 0–127', () => {
  const t = T(), other = P().tracks.find(x => x.id !== t.id), bd = bedOf('prophet5');
  clear(t, other);
  P().selTrack = other.id; // (mid-switch: the selection moved, this panel still mounted)
  try {
    const p = press(bd, 60, 0.5);
    lift(bd, p);
    assert.deepEqual([msgs(t, 'on', 'off'), msgs(other, 'on', 'off'), heldNotes()], [[], [], []]);
  } finally { P().selTrack = t.id; }
  const A = cv.perf.api(cv.panel().track);
  clear(t);
  for (const n of [NaN, 60.5, -1, 128, '60']) A.on(n, 1);
  assert.deepEqual([msgs(t, 'on'), heldNotes()], [[], []]);
});

test('noteOn(NaN) posts, holds, lights and records nothing (the guard was n < 0 || n > 127)', () => {
  const t = T();
  clear(t);
  api.noteOn(NaN, 1, 0);
  api.noteOn(undefined, 1, 0);
  assert.deepEqual([msgs(t, 'on'), heldNotes(), shades()], [[], [], []]);
});

test('makeRoom: the modular and the ARP 2600 (wider with their keyboard cases) push FX / OUT right once on a load — together, no History step; an already clear layout stays', () => {
  for (const [id, oldW] of [['modular', 1728], ['arp2600', 1568]]) {
    const t = fresh(id), m = () => cv.view().modules.get('i1'), sz = cvPanel.sizeOf(cvPanel.usable(id, MOD(id)), MOD(id));
    assert.deepEqual(sz, id === 'modular' ? { w: 2176, h: 1280 } : { w: 1856, h: 1344 }, id + ': the 1i size');
    // a layout saved before 1i: the FX panel 160 px right of the old width, OUT after it
    const fx0 = oldW + 160, out0 = fx0 + 928;
    t.lay = { i1: { x: 0, y: 0 }, fx1: { x: fx0, y: 0 }, out: { x: out0, y: 0 } };
    const other = P().tracks.find(x => x.id !== t.id);
    api.selectTrack(other.id); sim.raf();
    const n0 = hsteps(), can = cv.hist.canUndoFrom(P());
    api.selectTrack(t.id); sim.raf();
    const fx = t.lay.fx1.x, out = t.lay.out.x;
    assert.deepEqual([m().w, m().fixed.h], [sz.w, sz.h]);
    assert.ok(fx >= m().x + m().w + cvModule.GAP - 1 && fx > fx0, id + ': FX cleared the wider instrument (' + fx + ')');
    assert.deepEqual([out - fx, t.lay.fx1.y], [out0 - fx0, 0], id + ': OUT moved with it (horizontally)');
    assert.deepEqual([cv.view().modules.get('fx1').x, cv.view().modules.get('out').x], [fx, out]);
    assert.deepEqual([hsteps(), cv.hist.canUndoFrom(P())], [n0, can], id + ': no History step');
    api.selectTrack(other.id); sim.raf(); api.selectTrack(t.id); sim.raf();
    assert.deepEqual([t.lay.fx1.x, t.lay.out.x], [fx, out], id + ': once');
  }
});

// review 2 P2-1: the default camera of a newly shown instrument with hardware keys fits its height into the band too (never below
// READ_K) and, when it still does not fit, slides the least that puts the whole bed in the band (the keys are what one plays).
// The bands are what the app measured in headless Chrome (the viewport less the toolbar / minimap box at its foot), client px
const VIEWS = { '1366x1024': { top: 161, band: [44, 161, 1322, 593] }, '1440x900': { top: 161, band: [44, 161, 1396, 469] }, '1024x1366': { top: 161, band: [44, 161, 980, 935] } };
const KEYED = ['modular', 'minimoog', 'arp2600', 'solina', 'cs80', 'prophet5', 'ms20', 'obxa', 'jupiter8', 'juno60', 'dx7'];
test('review 2 P2-1: a new instrument with hardware keys opens with its whole bed in the band — the height fits down to READ_K, below it the camera slides to the bed; the instrument that fits keeps the top-left anchor; a model without keys, and a saved camera, are untouched', () => {
  const was = { vp: Object.assign({}, VP), band: Object.assign({}, BAND) }, P24 = 24, bad = [], seen = { slid: 0, fitted: 0 };
  try {
    for (const [name, v] of Object.entries(VIEWS)) {
      Object.assign(VP, { left: 0, top: v.top });
      Object.assign(BAND, { left: v.band[0], top: v.band[1], right: v.band[2], bottom: v.band[3] });
      const bw = BAND.right - BAND.left - 2 * P24, bh = BAND.bottom - BAND.top - 2 * P24;
      for (const id of KEYED) {
        fresh(id);
        const m = cv.view().modules.get('i1'), c = W.cam, k = c.k, box = geoOf(id).controls.find(o => o.bed).bed.box, tag = `${name} ${id} (k ${k.toFixed(3)})`;
        const kk = Math.max(cvWorld.READ_K, Math.min(1, bw / m.w, bh / m.fixed.h));
        if (Math.abs(k - kk) > 1e-9) bad.push(`${tag}: k ≠ ${kk.toFixed(3)}`);
        const L = VP.left + (m.x + box.x) * k + c.tx, T = VP.top + (m.y + cvModule.BAR_H + box.y) * k + c.ty, R = L + box.w * k, Bt = T + box.h * k;
        if (L < BAND.left - 1e-6 || T < BAND.top - 1e-6 || R > BAND.right + 1e-6 || Bt > BAND.bottom + 1e-6) bad.push(`${tag}: the bed [${[L, T, R, Bt].map(Math.round)}] outside the band [${v.band}]`);
        const fits = m.fixed.h * k <= bh + 1e-6 && m.w * k <= bw + 1e-6, top = [BAND.left - VP.left + P24 - Math.round(m.x * k), BAND.top - VP.top + P24 - Math.round(m.y * k)];
        if (fits) { seen.fitted++; if (c.tx !== top[0] || c.ty !== top[1]) bad.push(`${tag}: fits, but not at the top-left (${c.tx}, ${c.ty} vs ${top})`); }
        else { seen.slid++; if (c.tx > top[0] || c.ty > top[1]) bad.push(`${tag}: slid the wrong way`); }
      }
    }
    assert.deepEqual(bad, []);
    assert.ok(seen.slid >= 20 && seen.fitted >= 4, JSON.stringify(seen)); // (27 slid, 6 fitted today: both paths are exercised)
    // no hardware bed (the TB-303): today's width-only fit, anchored at the top
    Object.assign(VP, { left: 0, top: 161 }); Object.assign(BAND, { left: 44, top: 161, right: 1396, bottom: 469 });
    fresh('tb303');
    const m = cv.view().modules.get('i1'), k = Math.max(cvWorld.READ_K, Math.min(1, (BAND.right - BAND.left - 2 * P24) / m.w));
    assert.deepEqual([W.cam.k, W.cam.tx, W.cam.ty], [k, BAND.left - VP.left + P24 - Math.round(m.x * k), BAND.top - VP.top + P24 - Math.round(m.y * k)], 'the TB-303: no keys, no height fit');
    // a camera the user moved is theirs: restored as saved, never re-derived
    const t = fresh('arp2600'), moved = { tx: W.cam.tx - 300, ty: W.cam.ty - 40, k: 0.8 };
    W.setCamera(moved); cv.camFlush();
    const other = P().tracks.find(x => x.id !== t.id);
    api.selectTrack(other.id); sim.raf(3); api.selectTrack(t.id); sim.raf(3);
    assert.deepEqual([W.cam.tx, W.cam.ty, W.cam.k], [moved.tx, moved.ty, moved.k], 'the saved camera');
  } finally { Object.assign(VP, was.vp); Object.assign(BAND, was.band); }
});

test('the TB-303: in PITCH mode a key cell sounds seqNote(the cursor step) while held — for every cell and octave the note seqToRoll writes — at the accent\'s velocity, and writes the step; TIME mode is silent; the seq payload\'s root is SEQ_ROOT (48)', () => {
  const t = fresh('tb303'), view = cv.panel().track, st = acc.seqHw.get(view.id), q = api.seqOf(t);
  assert.equal(I(t).model, 'tb303');
  const KEYS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B', 'C′'];
  const cell = i => find(body(), x => !!x.attrs && x.attrs['aria-label'] === 'Key ' + KEYS[i]);
  st.mode = 'pitch'; st.cur = 15;
  for (const o of [-1, 0, 1]) {
    const heard = [];
    for (let i = 0; i < 13; i++) {
      q.pat[15].o = o; q.pat[15].a = i % 2;
      clear(t);
      ++pid;
      pev(cell(i), 'pointerdown', 5, 5, { pointerType: 'mouse' });
      const on = msgs(t, 'on');
      assert.equal(on.length, 1, `cell ${i} octave ${o}: one note while held`);
      assert.deepEqual([on[0].n, on[0].v, q.pat[15].n, q.pat[15].g], [KY.SEQ_ROOT + i + 12 * o, i % 2 ? 1 : 0.62, i, 1], `cell ${i} octave ${o}: its note, the accent, the write`);
      heard.push(on[0].n);
      pev(cell(i), 'pointerup', 5, 5, { pointerType: 'mouse' });
      assert.deepEqual(msgs(t, 'off').map(m => m.n), [on[0].n], 'off at the release');
    }
    // the same steps written into the piano roll (→ Piano roll: seqToRoll)
    for (let i = 0; i < 16; i++) Object.assign(q.pat[i], i < 13 ? { n: i, o, g: 1, a: 0, s: 0 } : { g: 0 });
    t.notes.length = 0;
    cv.panel().seq.toRoll.onclick();
    assert.deepEqual(t.notes.map(n => n.n), heard, 'octave ' + o + ': the audition = seqToRoll');
  }
  st.mode = 'time';
  clear(t);
  ++pid; pev(cell(4), 'pointerdown', 5, 5, { pointerType: 'mouse' }); pev(cell(4), 'pointerup', 5, 5, { pointerType: 'mouse' });
  assert.deepEqual(msgs(t, 'on'), [], 'TIME mode: silent');
  st.mode = 'pitch';
  clear(t);
  api.seqSend(t);
  const s = msgs(t, 'seq');
  assert.deepEqual([s.length, s[0].s.root, KY.SEQ_ROOT], [1, 48, 48], 'the payload\'s root');
  t.notes.length = 0;
});

/* ---------------------------------------------------------------- review 1: a hand on a bed or a controller when the track goes away */
test('review 1 F1: Undo with a bed key held (the pre-undo panel\'s track is the old object, the restored one the same id): the note ends — off posted, nothing held, nothing lit, silent; the finger\'s lift on the dead bed posts nothing', () => {
  const t0 = fresh('cs80');
  step();
  const bd = bedOf('cs80');
  clear();
  const p = press(bd, 60, 0.5);
  assert.deepEqual([msgs(t0, 'on').map(m => m.n), heldNotes()], [[60], ['0:60']], 'the key sounds');
  cv.undo(); sim.raf();
  const t1 = T();
  assert.equal(t1.id, t0.id, 'the same track (id)');
  assert.deepEqual([msgs(t1, 'off').map(m => m.n), heldNotes(), shades()], [[60], [], []], 'Undo ends the bed\'s note');
  lift(bd, p);
  assert.equal(msgs(t1, 'off').length, 1, 'the stale lift: nothing more');
  sim.run(48000 * 2);
  const level = rms(sim.run(48000 * 0.5), node(t1));
  assert.ok(level < 1e-4, 'silent 2 s after the undo: rms ' + level);
});

test('review 1 F1: the same through Redo, the Undo of a model Replace and a project load (applyRestore): the act ends the held note (nothing held, nothing lit), a new press plays', () => {
  const rows = [];
  const run = (name, prep, act) => {
    prep();
    const bd = bedOf(I(T()).model);
    clear();
    const p = press(bd, 62, 0.5);
    act(); sim.raf(); sim.raf();
    rows.push([name, heldNotes(), widget('perf:keys') ? shades() : []]);
    lift(bd, p);
    const bd2 = bedOf(I(T()).model), q = press(bd2, 62, 0.5);
    rows.push([name + ' (then a new press)', heldNotes(), shades(), msgs(T(), 'on').map(x => x.n).slice(-1)]);
    lift(bd2, q);
    sim.$('#panic').onclick(); sim.raf();
  };
  fresh('cs80');
  run('redo', () => { step(); cv.undo(); sim.raf(); }, () => cv.redo());
  run('undo of Replace', () => { api.setTrackModel(T(), 'prophet5'); sim.raf(); }, () => cv.undo());
  run('project load', () => {}, () => api.applyRestore(acc.loadProject(JSON.stringify(P()))));
  assert.deepEqual(rows.map(r => r.slice(0, 3)), rows.map((r, i) => (i % 2 ? [r[0], ['0:62'], [62]] : [r[0], [], []])), 'the act ends the note; a new press is the only one held and lit');
  assert.deepEqual(rows.filter((r, i) => i % 2).map(r => r[3]), [[62], [62], [62]], 'and it plays');
});

test('review 1 F1b: Undo with the pitch wheel held up (a hardware wheel; the Pencil\'s aftertouch on the CS-80): the spring\'s rest value reaches the track — bend 0, aftertouch 0, the new wheel mounts at rest', () => {
  const t0 = fresh('prophet5');
  step();
  const c = ctlOf('prophet5', 'perf:bend'), el = widget('perf:bend');
  rect(el, c.w * 2, c.h * 2);
  clear();
  ++pid; pev(el, 'pointerdown', 20, 60); pev(el, 'pointermove', 20, 60 - c.h * 0.5); sim.raf(); // (half the window up: +0.5)
  assert.equal(last(t0, 'bend'), 0.5, 'bent');
  cv.undo(); sim.raf();
  assert.deepEqual([last(T(), 'bend'), api.perfValue('bend', T()), widget('perf:bend').attrs['aria-valuenow']], [0, 0, '0'], 'the wheel springs home on the track it bent');
  const cs = fresh('cs80');
  step();
  const bd = bedOf('cs80');
  clear();
  press(bd, 60, 0.5, undefined, { pointerType: 'pen', pressure: 0.85 }); sim.raf();
  assert.ok(last(cs, 'at') > 0.5, 'under aftertouch: ' + last(cs, 'at'));
  cv.undo(); sim.raf();
  assert.deepEqual([last(T(), 'at'), heldNotes()], [0, []], 'the Pencil\'s aftertouch returns to 0');
});

test('review 1 F2: a hardware pitch wheel / a Pencil held across a track switch posts its rest value to the track it bent (bend 0, aftertouch 0); the other track is never bent', () => {
  const a = fresh('prophet5'), b = fresh('juno60'), cs = fresh('cs80');
  api.selectTrack(a.id); sim.raf();
  const c = ctlOf('prophet5', 'perf:bend'), el = widget('perf:bend');
  rect(el, c.w * 2, c.h * 2);
  clear(a, b, cs);
  ++pid; pev(el, 'pointerdown', 20, 60); pev(el, 'pointermove', 20, 60 - c.h * 0.5); sim.raf();
  assert.equal(last(a, 'bend'), 0.5);
  api.selectTrack(b.id); sim.raf(); sim.raf();
  assert.deepEqual([last(a, 'bend'), msgs(b, 'bend').map(m => m.v)], [0, []], 'A springs home; B is not bent');
  api.selectTrack(a.id); sim.raf();
  assert.equal(widget('perf:bend').attrs['aria-valuenow'], '0', 'A\'s wheel mounts at rest');
  api.selectTrack(cs.id); sim.raf();
  const bd = bedOf('cs80');
  press(bd, 60, 0.5, undefined, { pointerType: 'pen', pressure: 0.85 }); sim.raf();
  assert.ok(last(cs, 'at') > 0.5, 'the Pencil\'s aftertouch');
  api.selectTrack(a.id); sim.raf(); sim.raf();
  assert.deepEqual([last(cs, 'at'), heldNotes(), msgs(a, 'at')], [0, [], []], 'back to 0 on the CS-80; the key ended');
});

test('review 1 F3: deleting the selected track with a bed key held ends the note (nothing held, nothing lit on the track the selection moves to); deleting another track leaves the held key alone', () => {
  const t = fresh('juno60'), bd = bedOf('juno60');
  press(bd, 64, 0.5);
  assert.deepEqual(heldNotes(), ['0:64']);
  api.deleteTrack(t); sim.raf(); sim.raf();
  assert.deepEqual([heldNotes(), widget('perf:keys') ? shades() : []], [[], []], 'nothing held, nothing lit');
  const t2 = fresh('prophet5'), other = P().tracks.find(x => x.id !== t2.id), bd2 = bedOf('prophet5');
  press(bd2, 66, 0.5);
  api.deleteTrack(other); sim.raf(); sim.raf();
  assert.deepEqual(heldNotes(), ['0:66'], 'another track\'s deletion: the key goes on');
  sim.$('#panic').onclick(); sim.raf();
});

test('review 1 F4: a window blur / a hidden page ends the computer keys and the beds\' own notes but a MIDI note still sounds: the bed stays lit for it', () => {
  fresh('prophet5');
  const hide = () => { document.hidden = true; for (const f of sim.dom.docL.visibilitychange || []) f({ type: 'visibilitychange' }); document.hidden = false; for (const f of sim.dom.docL.visibilitychange || []) f({ type: 'visibilitychange' }); };
  for (const [name, fn] of [['blur', () => sim.win('blur')], ['hidden page', hide]]) {
    const bd = bedOf('prophet5');
    api.midi.message([0x90, 62, 100], performance.now());
    sim.key('KeyA', true);
    const kn = +heldNotes().find(k => k.startsWith('0:')).slice(2), p = press(bd, 72, 0.5);
    assert.deepEqual(shades().sort((a, b) => a - b), [kn, 62, 72].sort((a, b) => a - b), name + ': three lit');
    fn();
    assert.deepEqual([heldNotes(), shades()], [['1:62'], [62]], name + ': only the MIDI note still held and lit');
    lift(bd, p); sim.key('KeyA', false);
    api.midi.message([0x80, 62, 0], performance.now());
    assert.deepEqual([heldNotes(), shades()], [[], []], name + ': its off darkens it');
  }
});

test('review 1 F6: a controller a pointer focused leaves Space and Home to the page (the Mod Wheel keeps its value, the transport starts, Home is no bend); one nobody pressed (a Tab focus) keeps its arrows', async () => {
  const key = (target, type, k, code) => { const e = { type, key: k, code, target, repeat: false, timeStamp: performance.now(), defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
    target.dispatchEvent(e); if (!e.stopped) for (const f of sim.dom.winL[type] || []) f(e); return e; }; // (at the focused element, then its bubble to window)
  const t = fresh('jupiter8'), c = ctlOf('jupiter8', 'perf:mod'), el = widget('perf:mod');
  assert.equal(c.kind, 'pad');
  rect(el, c.w * 2, c.h * 2);
  api.ctl('wheel', 0.6, 0); // (the project's Mod Wheel, set by the tray)
  ++pid; pev(el, 'pointerdown', 10, 10, { pointerType: 'mouse' }); pev(el, 'pointerup', 10, 10, { pointerType: 'mouse' }); // (a click: focused by the pointer)
  clear(t);
  const play0 = api.transport().playing;
  key(el, 'keydown', ' ', 'Space'); await sim.settle(3); sim.raf(); key(el, 'keyup', ' ', 'Space');
  const wheel = msgs(t, 'wheel').map(m => Math.round(m.v * 100) / 100), play1 = api.transport().playing;
  if (play1) { sim.$('#tPlay').click(); await sim.settle(3); }
  assert.deepEqual([play1 !== play0, wheel], [true, []], 'Space plays / stops; the Mod Wheel stays at 0.6');
  const p5 = fresh('prophet5'), cb = ctlOf('prophet5', 'perf:bend'), wb = widget('perf:bend');
  rect(wb, cb.w * 2, cb.h * 2);
  clear(p5);
  key(wb, 'keydown', 'ArrowUp', 'ArrowUp'); key(wb, 'keyup', 'ArrowUp', 'ArrowUp');
  assert.deepEqual(msgs(p5, 'bend').map(m => m.v), [0.1, 0], 'never pressed: the arrows are its own (a Tab focus)');
  clear(p5);
  ++pid; pev(wb, 'pointerdown', 10, 10, { pointerType: 'mouse' }); pev(wb, 'pointerup', 10, 10, { pointerType: 'mouse' });
  const home = key(wb, 'keydown', 'Home', 'Home'); key(wb, 'keyup', 'Home', 'Home');
  assert.deepEqual([home.stopped, msgs(p5, 'bend').map(m => m.v)], [false, []], 'a clicked wheel: Home reaches the page, no bend');
});

test('a tap on sleeping keys (the world\'s sleeptap): the hint once per session', () => {
  api.notice('', 0);
  W.emit('sleeptap', { id: 'i1' });
  assert.equal(sim.$('#notice').textContent, 'Zoom in, or double-tap the synth, to play it');
  api.notice('', 0);
  W.emit('sleeptap', { id: 'i1' });
  assert.equal(sim.$('#notice').textContent, '', 'once');
});
