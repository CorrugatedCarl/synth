// sx-ui-seq.js (SPEC-serum2 §11.14, §13.7–§13.9, §15.12): importable without a DOM, the final exports, the pure helpers
// (foldRows, rollHit, laneValueAt, lenText / lenParse, laneWrite, rateRemap, swingN / swingS) and the M2 pages mounted
// on the stub binding kit (tests/serum-ui-stubs/kit.js) over the wk-dom fake DOM: ARP page (slot parameters with EDIT ALL,
// virtual-destination knobs bound to the selected slot, slots, banks, MIDI OUT, trigger octave, pattern editor), CLIP
// page (settings, slots, SMF export / Copy to Track, piano roll tool bar, lanes, recording, macros pane), keyboard strip
// (transpose, key / scale, swing, piano / ARP / CLIP keys), OSC MAPPING editor and the PianoRoll (gestures, keys,
// commands, clipboard, ruler flags, pattern kind).
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

// imported before any DOM exists: no document / window access at module top level
const seq = await import('../sx-ui-seq.js?v=6');
const core = await import('../serum-core.js?v=6');
const { makeKit, stubOf } = await import('./serum-ui-stubs/kit.js');
const dom = await import('./wk-dom.mjs');
const wk = await import('../wk.js?v=6');

const fresh = () => core.normalizeSerum(core.defaultSerum());
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const note = (t, len, n, vel = 100) => [t, len, n, vel, 0, 0.5, 0.5, 0];
const KEYW = 34, RULER = 18;

function mount(over) {
  const doc = dom.fresh(), s = (over && over.s) || fresh(), log = [], store = new Map();
  const host = Object.assign({
    audition: { on: (n, v) => log.push(['on', n, v]), off: n => log.push(['off', n]) },
    seqCmd: (c, a) => log.push(['seqCmd', c, a]),
    tracks: () => [{ id: 't2', name: 'Bass', model: 'serum' }, { id: 't3', name: 'Lead', model: 'juno' }],
    storage: { get: (k, d) => (store.has(k) ? JSON.parse(store.get(k)) : d), set: (k, v) => { store.set(k, JSON.stringify(v)); } },
    bpm: () => 120,
    download: (name, blob) => log.push(['download', name, blob]),
    clipToTrack: (id, notes) => log.push(['clipToTrack', id, notes]),
  }, over && over.host);
  const kit = makeKit({ doc, s, fx: core.defaultFx(), host });
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  return { doc, s, log, kit, T: stubOf(kit), root, store, host };
}
const lbl = (root, label) => dom.all(root).filter(n => n.getAttribute && n.getAttribute('aria-label') === label);
const byDest = (root, id, cls) => dom.byAttr(root, 'data-dest', id).filter(n => !cls || n.classList.contains(cls));
const menuEl = (root, label) => dom.byCls(root, 'wk-menu').find(m => m.childNodes.some(c => c.classList && c.classList.contains('wk-lab') && c.textContent === label));
const menuText = m => dom.one(m, 'wk-mtxt').textContent;
function pick(doc, m, label) {
  dom.fire(dom.one(m, 'wk-mbtn'), 'click');
  const opt = dom.all(doc.body).find(n => n.getAttribute && n.getAttribute('role') === 'option' && n.textContent === label);
  assert.ok(opt, 'option ' + label);
  dom.fire(opt, 'click');
}
const segBtn = (root, label) => dom.all(root).find(n => n.getAttribute && n.getAttribute('role') === 'radio' && n.textContent === label);
const ctxLabels = doc => dom.byCls(doc.body, 'wk-ci').map(n => dom.one(n, 'wk-cl').textContent);
const item = (items, label) => { const it = items.find(x => x && x.label === label); assert.ok(it, 'item ' + label); return it; };
const snapSeq = (o = {}) => { const q = new Float64Array(16).fill(0); q[0] = -1; q[5] = -1; for (const k of Object.keys(o)) q[+k] = o[k]; return { seq: q }; };
// a controllable performance.now (the recording clock): clock(ms) freezes it there, clock(null) returns to real time
const PERF = globalThis.performance;
let CLK = null;
Object.defineProperty(globalThis, 'performance', { value: { now: () => (CLK === null ? PERF.now() : CLK) }, configurable: true, writable: true });
const clock = t => { CLK = t; };

/* ================================================================ module and pure helpers */

test('imports in node without a DOM; the §11.14 exports and the extra pure helpers', () => {
  for (const k of ['ArpPage', 'ClipPage', 'KeyboardPanel', 'OscMapEditor', 'PianoRoll', 'rollHit', 'laneValueAt', 'foldRows', 'lenText', 'lenParse',
    'laneWrite', 'rateRemap', 'swingN', 'swingS']) {
    assert.equal(typeof seq[k], 'function', k);
  }
  for (const k of ['ArpPage', 'ClipPage', 'KeyboardPanel', 'OscMapEditor', 'PianoRoll']) assert.match(String(seq[k]), /^class /, k + ' is a class');
});

test('foldRows: Off, used notes, scale + used; key off; ignores bad pitches; empty fold shows every row', () => {
  const all = range(0, 127);
  const notes = [note(0, 1, 64), note(1, 1, 60), note(2, 1, 64), note(3, 1, 61), [4, 1, 200], [5, 1, 60.5], null, [6, 1, -1]];
  assert.deepEqual(seq.foldRows(notes, 0, MAJOR, 0), all);
  assert.deepEqual(seq.foldRows(notes, 0, MAJOR, 1), [60, 61, 64]);
  assert.deepEqual(seq.foldRows([], 0, MAJOR, 1), all);
  assert.deepEqual(seq.foldRows(null, -1, 0, 1), all);
  const cMaj = all.filter(n => MAJOR.includes(n % 12));
  assert.deepEqual(seq.foldRows(notes, 0, MAJOR, 2), cMaj.concat([61]).sort((a, b) => a - b));
  const dMaj = seq.foldRows([], 2, MAJOR, 2);
  assert.ok(dMaj.includes(66) && dMaj.includes(61) && !dMaj.includes(65) && !dMaj.includes(60));
  assert.deepEqual(dMaj.map(n => (n - 2 + 12) % 12).filter(p => !MAJOR.includes(p)), []);
  assert.deepEqual(seq.foldRows(notes, -1, MAJOR, 2), [60, 61, 64]);
  assert.deepEqual(seq.foldRows(notes, 0, 999, 2), [60, 61, 64]);
  for (const m of [0, 1, 2]) {
    const r = seq.foldRows(notes, 5, [0, 3, 7], m);
    assert.deepEqual(r, Array.from(new Set(r)).sort((a, b) => a - b));
  }
  assert.deepEqual(seq.foldRows([], 0, 0, 2), all.filter(n => MAJOR.includes(n % 12)));           // 0 Major (SCALES index)
  assert.deepEqual(seq.foldRows([], 0, 17, 2), all);                                              // 17 Chromatic
});

test('rollHit: time / row / note at a point, note parts, overlaps, folded rows, scrolling, narrow notes', () => {
  const rows = [60, 62, 64];
  const view = { t0: 0, pps: 10, rows, rowH: 12, top: 0, edge: 6 };
  const notes = [note(0, 4, 60), note(2, 4, 60), note(8, 2, 64), note(1, 0.2, 62)];
  assert.deepEqual(seq.rollHit(notes, view, 75, 5), { i: -1, part: '', t: 7.5, row: 2, note: 64 });
  assert.deepEqual(seq.rollHit(notes, view, 90, 5), { i: 2, part: 'body', t: 9, row: 2, note: 64 });
  assert.equal(seq.rollHit(notes, view, 81, 5).part, 'start');
  assert.equal(seq.rollHit(notes, view, 99, 5).part, 'end');
  assert.equal(seq.rollHit(notes, view, 100, 5).i, -1);
  assert.equal(seq.rollHit(notes, view, 30, 30).i, 1);
  assert.equal(seq.rollHit(notes, view, 10, 30).i, 0);
  const h = seq.rollHit(notes, view, 14, 18);
  assert.deepEqual([h.note, h.i, h.part], [62, 3, 'end']);
  assert.equal(seq.rollHit(notes, view, 17, 18).i, -1);
  assert.deepEqual(seq.rollHit(notes, view, 10, 36), { i: -1, part: '', t: 1, row: -1, note: -1 });
  assert.equal(seq.rollHit(notes, view, 10, -1).row, -1);
  assert.equal(seq.rollHit([note(0, 4, 61)], view, 10, 18).i, -1);
  const h2 = seq.rollHit(notes, Object.assign({}, view, { top: 12, t0: 8 }), 5, 5);
  assert.deepEqual([h2.note, h2.t], [62, 8.5]);
  const h3 = seq.rollHit(notes, view, NaN, 5);
  assert.equal(h3.i, -1);
  assert.ok(Number.isNaN(h3.t));
});

test('laneValueAt: null lanes are NaN; the curve law of the graph points; x clamped', () => {
  assert.ok(Number.isNaN(seq.laneValueAt(null, 0.5)));
  assert.ok(Number.isNaN(seq.laneValueAt([], 0.5)));
  assert.ok(Number.isNaN(seq.laneValueAt([[0, 0, 0], [1, 1, 0]], NaN)));
  const ramp = [[0, 0, 0], [1, 1, 0]];
  assert.equal(seq.laneValueAt(ramp, 0.25), 0.25);
  assert.equal(seq.laneValueAt(ramp, -3), 0);
  assert.equal(seq.laneValueAt(ramp, 7), 1);
  const bent = [[0, 0.2, 0.5], [0.5, 1, -0.3], [1, 0, 0]];
  for (const x of [0, 0.1, 0.3, 0.5, 0.77, 1]) assert.equal(seq.laneValueAt(bent, x), core.evalPts(bent, x), 'x ' + x);
});

test('lenText / lenParse: bars.beats.16ths both ways, clamped to the maximum', () => {
  assert.equal(seq.lenText(64), '4.0.0');
  assert.equal(seq.lenText(16), '1.0.0');
  assert.equal(seq.lenText(1), '0.0.1');
  assert.equal(seq.lenText(23), '1.1.3');
  assert.equal(seq.lenText(1024), '64.0.0');
  for (const n of [1, 3, 4, 5, 15, 16, 17, 63, 255, 256, 1023, 1024]) assert.equal(seq.lenParse(seq.lenText(n)), n, 'round trip ' + n);
  assert.equal(seq.lenParse('2'), 32);
  assert.equal(seq.lenParse('1.2'), 24);
  assert.equal(seq.lenParse('1:1:1'), 21);
  assert.equal(seq.lenParse(' 0.0.3 '), 3);
  assert.equal(seq.lenParse('100', 256), 256);
  assert.equal(seq.lenParse('0'), null);
  assert.equal(seq.lenParse('x'), null);
  assert.equal(seq.lenParse('1.-1'), null);
});

test('laneWrite: overwrites the span, keeps the ends, creates a flat lane from null', () => {
  assert.deepEqual(seq.laneWrite(null, 0.5, 0.5, 0.3), [[0, 0.3, 0], [0.5, 0.3, 0], [1, 0.3, 0]]);
  const L = [[0, 0, 0], [0.2, 0.5, 0], [0.4, 0.6, 0.3], [0.6, 0.9, 0], [1, 1, 0]];
  // a gesture from 0.3 to 0.65: the points inside are replaced by the new value at 0.65
  assert.deepEqual(seq.laneWrite(L, 0.3, 0.65, 0.25), [[0, 0, 0], [0.2, 0.5, 0], [0.65, 0.25, 0], [1, 1, 0]]);
  // touching the ends sets their values
  assert.deepEqual(seq.laneWrite(L, 0, 0, 0.7)[0], [0, 0.7, 0]);
  const e = seq.laneWrite(L, 0.9, 1, 0.1);
  assert.deepEqual(e[e.length - 1], [1, 0.1, 0]);
  assert.equal(e.filter(p => p[0] > 0.9 && p[0] < 1).length, 0);
  // reversed span and clamped values; never mutates the input
  const before = JSON.stringify(L);
  assert.deepEqual(seq.laneWrite(L, 0.65, 0.3, 2), seq.laneWrite(L, 0.3, 0.65, 1));
  assert.equal(JSON.stringify(L), before);
  // the result is a valid lane (sorted, x 0 … 1)
  for (const out of [seq.laneWrite(L, 0.1, 0.15, 0.5), seq.laneWrite([[0, 1, 0], [1, 0, 0]], 0.5, 0.5, 0.5)]) {
    assert.equal(out[0][0], 0);
    assert.equal(out[out.length - 1][0], 1);
    for (let i = 1; i < out.length; i++) assert.ok(out[i][0] >= out[i - 1][0]);
  }
});

test('rateRemap: the nearest entry of the new ladder (straight entries win ties); swingN / swingS', () => {
  const L0 = core.arpLadder(0, 0), Lt = core.arpLadder(0, 1), Ld = core.arpLadder(1, 0);
  const at = (L, label) => L.findIndex(e => e.label === label) / (L.length - 1);
  assert.equal(seq.rateRemap(at(L0, '1/16'), { dot: 0, trip: 0 }, { dot: 0, trip: 1 }), Math.round(at(Lt, '1/16') * 1e5) / 1e5);
  assert.equal(seq.rateRemap(at(Lt, '1/16T'), { dot: 0, trip: 1 }, { dot: 0, trip: 0 }), at(L0, '1/16'));
  assert.equal(seq.rateRemap(at(Ld, '1/4.'), { dot: 1, trip: 0 }, { dot: 0, trip: 0 }), at(L0, '1/4'));
  const r5 = x => Math.round(x * 1e5) / 1e5;
  assert.equal(seq.rateRemap(at(L0, '4 bar'), {}, { dot: 1, trip: 1 }), r5(at(core.arpLadder(1, 1), '4 bar')));
  assert.equal(seq.rateRemap(at(core.arpLadder(1, 1), '1/8T'), { dot: 1, trip: 1 }, { dot: 1, trip: 0 }), r5(at(Ld, '1/8')));
  assert.equal(seq.swingN(0), 0.5);
  assert.equal(seq.swingS(0.5), 0);
  assert.equal(seq.swingS(seq.swingN(1 / 3)), 0.33333);
  assert.equal(seq.swingS(1), 1);
  assert.equal(seq.swingS(0), -1);
  for (let k = 0; k <= 300; k += 37) assert.equal(seq.swingN(seq.swingS(k / 300)), seq.swingN(seq.swingS(seq.swingN(seq.swingS(k / 300)))));
});

/* ================================================================ pages on the stub kit */

test('ArpPage / ClipPage / KeyboardPanel mount on the kit without touching the state; sections; power buttons; destinations', () => {
  const { s, kit, T, root, doc } = mount();
  const before = JSON.stringify(s);
  const arp = new seq.ArpPage(root, kit), clip = new seq.ClipPage(root, kit), kb = new seq.KeyboardPanel(root, kit);
  assert.deepEqual(root.children, [arp.el, clip.el, kb.el]);
  T.paint();
  T.setSnap(snapSeq());
  T.paint();
  assert.equal(JSON.stringify(s), before, 'building and painting edit nothing');
  assert.deepEqual(T.log, []);
  const secs = el => dom.all(el).map(n => n.getAttribute && n.getAttribute('data-sec')).filter(Boolean);
  assert.deepEqual(secs(arp.el), ['global', 'slots', 'pattern', 'transpose', 'playback', 'retrigger', 'velocity', 'midiout']);
  assert.deepEqual(secs(clip.el), ['global', 'slots', 'settings', 'roll', 'lanes', 'record', 'midiout', 'macros']);
  assert.deepEqual(secs(kb.el), ['transpose', 'key', 'scale', 'swing', 'oscmap', 'keys', 'arpkeys', 'clipkeys']);
  const pa = dom.byAttr(arp.el, 'data-dest', 'arp.on'), pc = dom.byAttr(clip.el, 'data-dest', 'clip.on');
  assert.equal(pa.length, 1);
  assert.equal(pc.length, 1);
  assert.equal(pa[0].getAttribute('data-module'), 'arp');
  assert.equal(pc[0].getAttribute('data-module'), 'clip');
  // every data-dest is a destination; the virtual sequencer destinations and the macros are drop targets
  for (const n of dom.all(root)) { const id = n.getAttribute && n.getAttribute('data-dest'); if (id) assert.ok(core.DEST_INDEX[id] !== undefined, id); }
  for (const id of ['arp.rate', 'arp.shift', 'arp.range', 'arp.offset', 'arp.repeats', 'arp.gate', 'arp.chance', 'arp.rrate', 'arp.vdecay', 'arp.vtarget', 'arp.trans']) {
    assert.ok(byDest(arp.el, id, 'wk-knob').length === 1, id);
  }
  for (const id of ['clip.trans', 'clip.rate', 'clip.offset', 'm1', 'm8']) assert.equal(byDest(clip.el, id, 'wk-knob').length, 1, id);
  assert.ok(doc.getElementById('sx-seq-css'), 'styles injected once');
  assert.equal(dom.all(doc.head).filter(n => n.id === 'sx-seq-css').length, 1);
  // the clip page's piano roll edits the selected clip
  assert.ok(clip.roll instanceof seq.PianoRoll);
  assert.ok(clip.sec.roll.contains(clip.roll.el));
  s.clip.sel = 3;
  clip.roll.o.edit(c => { c.notes.push(note(0, 2, 60)); }, { label: 'Add note' });
  assert.deepEqual(s.clip.clips[3].notes, [note(0, 2, 60)]);
  assert.deepEqual(s.clip.clips[0].notes, []);
  assert.deepEqual(T.log.pop(), ['edit', 'Add note', undefined, false]);
  assert.equal(s.clip.dirty, 1);
  assert.deepEqual(clip.roll.view().rows, range(0, 127));
  assert.ok(clip.roll.command('fold', 1));
  assert.deepEqual(clip.roll.view().rows, [60]);
  // destroy: idempotent, removes the elements
  for (const P of [arp, clip, kb]) { P.destroy(); P.destroy(); assert.equal(P.el.parentNode, null); }
  assert.ok(clip.roll.dead);
  T.paint();
  T.setSnap(snapSeq({ 0: 2 }));
  assert.equal(doc.body.contains(root), true);
});

test('ArpPage: virtual knobs edit the selected slot (BPM: n.rate, HZ: n.hz) with labels, phases and the bank dirty flag', () => {
  const { s, kit, T, root } = mount();
  const arp = new seq.ArpPage(root, kit);
  T.paint();
  s.arp.sel = 2;
  T.paint();
  const rate = byDest(arp.el, 'arp.rate', 'wk-knob')[0];
  assert.equal(rate.getAttribute('aria-valuetext'), '1/16');
  dom.key(rate, 'ArrowUp');                                         // one ladder step faster
  const L = core.arpLadder(0, 0);
  assert.equal(s.arp.slots[2].n.rate, Math.round(0.75 * (L.length - 1) + 1) / (L.length - 1));
  assert.equal(s.arp.slots[0].n.rate, 0.75, 'other slots untouched');
  assert.equal(s.arp.dirty, 1);
  assert.deepEqual(T.log.pop(), ['edit', 'Arp Rate', 'set', false]);
  assert.equal(rate.getAttribute('aria-valuetext'), '1/32');
  // HZ mode: the same knob edits n.hz
  dom.fire(segBtn(arp.sec.pattern, 'HZ'), 'click');
  assert.equal(s.arp.slots[2].bpm, 0);
  T.paint();
  assert.match(rate.getAttribute('aria-valuetext'), /Hz$/);
  dom.key(rate, 'ArrowUp');
  assert.equal(s.arp.slots[2].n.hz, 0.51);
  assert.equal(s.arp.slots[2].n.rate, Math.round(0.75 * (L.length - 1) + 1) / (L.length - 1));
  // stepped destinations snap to their grid (shift: 48 steps)
  const shift = byDest(arp.el, 'arp.shift', 'wk-knob')[0];
  dom.key(shift, 'ArrowDown');
  assert.equal(s.arp.slots[2].n.shift, 35 / 48);
  assert.equal(shift.getAttribute('aria-valuetext'), '+11 st');
  // a slot toggle (LATCH) and SHAPE / RANGE SHAPE menus
  dom.fire(lbl(arp.sec.playback, 'LATCH')[0], 'click');
  assert.equal(s.arp.slots[2].latch, 1);
  pick(root.ownerDocument, menuEl(arp.sec.pattern, 'SHAPE'), 'Converge');
  assert.equal(s.arp.slots[2].shape, 3);
  pick(root.ownerDocument, menuEl(arp.sec.transpose, 'RANGE SHAPE'), 'Pinky Up');
  assert.equal(s.arp.slots[2].rshape, 8);
  // the retrigger RATE value and the velocity knobs are disabled until their switch is on
  T.paint();
  assert.ok(byDest(arp.el, 'arp.rrate', 'wk-knob')[0].classList.contains('wk-dis'));
  dom.fire(lbl(arp.sec.retrigger, 'RATE')[0], 'click');
  T.paint();
  assert.ok(!byDest(arp.el, 'arp.rrate', 'wk-knob')[0].classList.contains('wk-dis'));
  assert.ok(byDest(arp.el, 'arp.vdecay', 'wk-knob')[0].classList.contains('wk-dis'));
  arp.destroy();
});

test('ArpPage: EDIT ALL (toggle or Alt on the gesture) writes every slot; TRIP / DOT keep the rate at the nearest entry', () => {
  const { s, kit, T, root } = mount();
  const arp = new seq.ArpPage(root, kit);
  T.paint();
  const gate = byDest(arp.el, 'arp.gate', 'wk-knob')[0];
  // Alt held on the gesture
  dom.fire(gate, 'pointerdown', { altKey: true, clientX: 0, clientY: 0, pointerType: 'mouse' });
  dom.fire(gate, 'pointerup', { clientX: 0, clientY: 0 });
  dom.key(gate, 'Home', { altKey: true });
  assert.deepEqual(s.arp.slots.map(x => x.n.gate), Array(12).fill(0));
  // EDIT ALL toggle (a UI edit)
  dom.fire(lbl(arp.sec.global, 'EDIT ALL')[0], 'click');
  assert.equal(s.arp.editAll, 1);
  assert.deepEqual(T.log.pop(), ['edit', 'Edit All', undefined, true]);
  const chance = byDest(arp.el, 'arp.chance', 'wk-knob')[0];
  dom.key(chance, 'Home');
  assert.deepEqual(s.arp.slots.map(x => x.n.chance), Array(12).fill(0));
  dom.fire(lbl(arp.sec.global, 'EDIT ALL')[0], 'click');
  dom.key(chance, 'End');
  assert.deepEqual(s.arp.slots.map(x => x.n.chance), [1].concat(Array(11).fill(0)));
  // TRIP: 1/16 → 1/16T (the same position in the triplet ladder), then off again
  const tripL = core.arpLadder(0, 1);
  dom.fire(lbl(arp.sec.pattern, 'TRIP')[0], 'click');
  assert.equal(s.arp.slots[0].trip, 1);
  assert.equal(tripL[Math.round(s.arp.slots[0].n.rate * (tripL.length - 1))].label, '1/16');
  T.paint();
  dom.key(byDest(arp.el, 'arp.rate', 'wk-knob')[0], 'ArrowUp');
  assert.equal(tripL[Math.round(s.arp.slots[0].n.rate * (tripL.length - 1))].label, '1/16T');
  dom.fire(lbl(arp.sec.pattern, 'TRIP')[0], 'click');
  const L = core.arpLadder(0, 0);
  assert.equal(L[Math.round(s.arp.slots[0].n.rate * (L.length - 1))].label, '1/16');
  // TRIP / DOT are disabled in Hz mode
  dom.fire(segBtn(arp.sec.pattern, 'HZ'), 'click');
  T.paint();
  assert.ok(lbl(arp.sec.pattern, 'DOT')[0].classList.contains('wk-dis'));
  arp.destroy();
});

test('ArpPage: slots — select, launch / stop from the snapshot, names, slot menu (rename, copy, paste, erase)', () => {
  const { s, kit, T, root, log } = mount();
  const arp = new seq.ArpPage(root, kit);
  T.paint();
  const S = arp.slots.slots;
  assert.equal(S.length, 12);
  assert.deepEqual(S.map(x => x.el.classList.contains('sx-blk')), [false, true, false, true, false, false, true, false, true, false, true, false]);
  assert.equal(S[0].name.textContent, 'Up (1/16)');
  assert.ok(S[0].el.classList.contains('sx-sel'));
  assert.equal(S[0].name.getAttribute('aria-pressed'), 'true');
  dom.fire(S[4].name, 'click');
  assert.equal(s.arp.sel, 4);
  T.paint();
  assert.ok(S[4].el.classList.contains('sx-sel') && !S[0].el.classList.contains('sx-sel'));
  assert.equal(S[4].name.getAttribute('aria-pressed'), 'true');
  dom.fire(S[5].play, 'click');
  assert.deepEqual(log.pop(), ['seqCmd', 'arpLaunch', 5]);
  T.setSnap(snapSeq({ 0: 5 }));
  assert.ok(S[5].el.classList.contains('sx-play'));
  assert.equal(S[5].play.textContent, '■');
  dom.fire(S[5].play, 'click');
  assert.deepEqual(log.pop(), ['seqCmd', 'arpStop', 5]);
  T.setSnap(snapSeq());
  assert.ok(!S[5].el.classList.contains('sx-play'));
  // slot menu: opened by the context menu event, actions
  dom.fire(S[1].el, 'contextmenu', { clientX: 10, clientY: 10 });
  assert.deepEqual(ctxLabels(root.ownerDocument), ['Rename Pattern…', 'Copy Pattern', 'Paste Pattern', 'Erase Pattern', 'Show Pattern Names']);
  dom.fire(root.ownerDocument.body, 'pointerdown');   // closes it
  s.arp.slots[1].shape = 9;
  item(arp.slotItems(1), 'Copy Pattern').action();
  item(arp.slotItems(7), 'Paste Pattern').action();
  assert.equal(s.arp.slots[7].shape, 9);
  item(arp.slotItems(7), 'Rename Pattern…').action();
  T.prompts.pop().ok('Wobble');
  assert.equal(s.arp.slots[7].name, 'Wobble');
  T.paint();
  assert.equal(S[7].name.textContent, 'Wobble');
  item(arp.slotItems(7), 'Erase Pattern').action();
  assert.deepEqual(s.arp.slots[7], core.defaultArpSlot());
  item(arp.slotItems(0), 'Show Pattern Names').action();
  assert.equal(S[3].name.textContent, 'D#');
  // without the host member, launching notifies
  const m2 = mount({ host: { seqCmd: undefined } });
  const a2 = new seq.ArpPage(m2.root, m2.kit);
  dom.fire(a2.slots.slots[0].play, 'click');
  assert.match(m2.T.log.pop()[1], /not available/);
  arp.destroy();
  a2.destroy();
});

test('ArpPage: banks (factory load, save to the user library, user load, delete), LAUNCH QUANT, MIDI OUT, ⋯ menu', () => {
  const { s, kit, T, root, store } = mount();
  const arp = new seq.ArpPage(root, kit);
  T.paint();
  const bank = dom.one(arp.sec.global, 'sx-bankbtn');
  assert.equal(bank.textContent, 'Init');
  item(item(arp.bankItems(), 'Factory').sub, 'Basics').action();
  assert.equal(s.arp.bank, 'Basics');
  assert.equal(s.arp.slots[1].shape, core.ARP_SHAPES.indexOf('Down'));
  dom.key(byDest(arp.el, 'arp.gate', 'wk-knob')[0], 'Home');
  T.paint();
  assert.equal(bank.textContent, 'Basics *');
  item(arp.bankItems(), 'Save Arp Bank…').action();
  const P = T.prompts.pop();
  assert.equal(P.ok(''), false, 'an empty name keeps the dialog open');
  P.ok('My Arps');
  assert.equal(s.arp.bank, 'My Arps');
  assert.equal(s.arp.dirty, 0);
  const lib = JSON.parse(store.get(core.STORE_KEYS.arpBanks));
  assert.equal(lib.length, 1);
  assert.equal(lib[0].name, 'My Arps');
  assert.equal(lib[0].slots[0].n.gate, 0);
  item(arp.bankItems(), 'Init').action();
  assert.equal(s.arp.slots[0].n.gate, 0.375);
  item(item(arp.bankItems(), 'User').sub, 'My Arps').action();
  assert.equal(s.arp.slots[0].n.gate, 0);
  item(item(arp.bankItems(), 'Delete User Bank').sub, 'My Arps').action();
  assert.deepEqual(JSON.parse(store.get(core.STORE_KEYS.arpBanks)), []);
  // LAUNCH QUANT (not bank content: not dirty)
  pick(root.ownerDocument, menuEl(arp.sec.global, 'LAUNCH QUANT'), '1 bar');
  assert.equal(s.arp.quant, 6);
  // MIDI OUT: mode and target track (host.tracks)
  dom.fire(segBtn(arp.sec.midiout, 'On'), 'click');
  assert.equal(s.arp.midiOut, 2);
  pick(root.ownerDocument, menuEl(arp.sec.midiout, 'TARGET'), 'Lead');
  assert.equal(s.arp.outTrack, 't3');
  s.arp.outTrack = 'gone';
  T.paint();
  assert.equal(menuText(menuEl(arp.sec.midiout, 'TARGET')), 'Missing track');
  // ⋯ menu: Lock Module, trigger octave
  const M = arp.menuItems();
  item(M, 'Lock Module').action();
  assert.deepEqual(s.locks.mod, ['arp']);
  assert.equal(item(arp.menuItems(), 'Lock Module').checked, true);
  const trig = item(arp.menuItems(), 'MIDI Input Trigger Octave');
  assert.equal(trig.sub.length, 12);
  assert.equal(trig.sub[0].label, 'Off');
  assert.equal(trig.sub[1].label, 'C-1 – B-1');
  assert.equal(trig.sub[1].checked, true);
  trig.sub[4].action();
  assert.equal(s.arp.trigOct, 4);
  trig.sub[0].action();
  assert.equal(s.arp.trigOct, 0);
  arp.destroy();
});

test('ArpPage: the pattern editor overlay (SHAPE = Pattern, s.ui.arpEd), its settings, graph, lanes and Escape', () => {
  const { s, kit, T, root, doc } = mount();
  const arp = new seq.ArpPage(root, kit);
  T.paint();
  const btnEd = dom.one(arp.sec.pattern, 'sx-pated');
  assert.equal(btnEd.disabled, true);
  assert.equal(arp.openPattern(), false);
  assert.match(T.log.pop()[1], /Pattern/);
  s.arp.slots[0].shape = 1;
  T.paint();
  assert.equal(btnEd.disabled, false);
  dom.fire(btnEd, 'click');
  assert.equal(s.ui.arpEd, 1);
  const ed = arp.patEd;
  assert.ok(ed);
  assert.equal(ed.el.getAttribute('role'), 'dialog');
  assert.ok(arp.el.contains(ed.el));
  assert.equal(ed.roll.kind, 'pat');
  assert.equal(ed.roll.view().rows.length, 32);
  assert.deepEqual(ed.roll.view().rows.slice(14, 18), [-2, -1, 1, 2]);
  // settings: LENGTH (typed bars.beats.16ths via keys), MODE, STEP MODE, WRAP + PITCH / RANGE, GRID
  const len = lbl(ed.el, 'LENGTH')[0];
  dom.key(len, 'ArrowDown');
  assert.equal(s.arp.slots[0].pat.len, 15);
  assert.equal(dom.one(len, 'wk-nbt').textContent, '0.3.3');
  pick(doc, menuEl(ed.el, 'MODE'), 'Random');
  assert.equal(s.arp.slots[0].pat.mode, 3);
  T.paint();
  assert.equal(menuEl(ed.el, 'TIME').style.display, '');
  pick(doc, menuEl(ed.el, 'STEP MODE'), 'Chord');
  assert.equal(s.arp.slots[0].pat.stepMode, 2);
  pick(doc, menuEl(ed.el, 'GRID'), '1/8');
  assert.equal(s.arp.slots[0].pat.grid, 1);
  assert.equal(ed.roll.step(), 2);
  pick(doc, menuEl(ed.el, 'WRAP'), 'Phantom');
  T.paint();
  assert.ok(byDest(ed.el, 'arp.wtrans', 'wk-knob')[0].classList.contains('wk-dis'));
  pick(doc, menuEl(ed.el, 'WRAP'), 'Wrap');
  T.paint();
  dom.key(byDest(ed.el, 'arp.wtrans', 'wk-knob')[0], 'ArrowUp');
  assert.equal(s.arp.slots[0].n.wtrans, 13 / 24);
  // graph: double-click adds an event at the grid cell (row from the pointer); EDIT ALL does not copy the events
  s.arp.editAll = 1;
  dom.place(ed.roll.el, 0, 0, KEYW + 320, RULER + 32 * 12);
  ed.roll.refresh();
  const v = ed.roll.view();
  const yRow = r => RULER + (v.rows.length - 1 - v.rows.indexOf(r)) * v.rowH - v.top + 6;
  dom.fire(ed.roll.el, 'dblclick', { clientX: KEYW + 2.5 * v.pps, clientY: yRow(3) });
  assert.deepEqual(s.arp.slots[0].pat.ev, [[2, 2, 3, 100, 0]]);
  assert.deepEqual(s.arp.slots[1].pat.ev, []);
  // accent: key 0 toggles the selected event's accent
  dom.key(ed.roll.el, '0');
  assert.equal(s.arp.slots[0].pat.ev[0][4], 1);
  // lanes: NOTE VEL is a per-event lane; ACCENT toggles; STRUM adds entries; automation lanes add / clear
  T.paint();
  const lanes = ed.lanes;
  assert.deepEqual(lanes.tabBtns.map(b => b.textContent), ['NOTE VEL', 'ACCENT', 'STRUM', 'VELOCITY', 'GATE', 'CHANCE', 'EXPR X']);
  dom.place(lanes.cv, 0, 0, KEYW + 320, 72);
  dom.ptr(lanes.cv, 'pointerdown', KEYW + 2 * v.pps + 2, 4);
  dom.ptr(lanes.cv, 'pointerup', KEYW + 2 * v.pps + 2, 4);
  assert.equal(s.arp.slots[0].pat.ev[0][3], 127);
  dom.fire(lanes.tabBtns[2], 'click');
  dom.ptr(lanes.cv, 'pointerdown', KEYW + 8 * v.pps + 1, 36);
  dom.ptr(lanes.cv, 'pointerup', KEYW + 8 * v.pps + 1, 36);
  assert.equal(s.arp.slots[0].pat.strum.length, 1);
  assert.equal(s.arp.slots[0].pat.strum[0][0], 8);
  assert.ok(Math.abs(s.arp.slots[0].pat.strum[0][1] - 0.5) < 0.05);
  dom.fire(lanes.tabBtns[4], 'click');
  assert.equal(lanes.addB.style.display, '');
  dom.fire(lanes.addB, 'click');
  assert.deepEqual(s.arp.slots[0].pat.lanes.gate, [[0, 0.5, 0], [1, 0.5, 0]]);
  assert.ok(lanes.ce, 'curve editor on the lane');
  dom.fire(lanes.clrB, 'click');
  assert.equal(s.arp.slots[0].pat.lanes.gate, null);
  assert.equal(lanes.ce, null);
  // pattern presets: save to the user library, load, Init
  item(ed.nameItems(), 'Save Pattern…').action();
  T.prompts.pop().ok('Pulse');
  assert.equal(s.arp.slots[0].pat.name, 'Pulse');
  item(ed.nameItems(), 'Init').action();
  assert.deepEqual(s.arp.slots[0].pat.ev, []);
  assert.equal(s.arp.slots[0].pat.grid, 1, 'the editor grid is kept');
  item(item(ed.nameItems(), 'User').sub, 'Pulse').action();
  assert.deepEqual(s.arp.slots[0].pat.ev, [[2, 2, 3, 127, 1]]);
  // Escape closes (s.ui.arpEd = 0) and the overlay is removed
  dom.key(ed.el, 'Escape');
  assert.equal(s.ui.arpEd, 0);
  assert.equal(arp.patEd, null);
  assert.equal(ed.el.parentNode, null);
  // reopening follows the state: arpEd = 1 at paint time opens it again; a non-Pattern shape hides it
  s.ui.arpEd = 1;
  T.paint();
  assert.ok(arp.patEd);
  s.arp.slots[0].shape = 7;
  T.paint();
  assert.equal(arp.patEd, null);
  arp.destroy();
});

test('ClipPage: settings (LENGTH, KB SPAN, MODE + TIME, knobs, toggles) with EDIT ALL; trigger mode; bank dirty flag', () => {
  const { s, kit, T, root, doc } = mount();
  const clip = new seq.ClipPage(root, kit);
  T.paint();
  s.clip.sel = 1;
  T.paint();
  const len = lbl(clip.sec.settings, 'LENGTH')[0];
  assert.equal(dom.one(len, 'wk-nbt').textContent, '4.0.0');
  dom.key(len, 'ArrowDown');
  assert.equal(s.clip.clips[1].len, 63);
  assert.equal(s.clip.clips[0].len, 64);
  assert.equal(s.clip.dirty, 1);
  dom.fire(segBtn(clip.sec.settings, 'Poly'), 'click');
  assert.equal(s.clip.clips[1].kb, 2);
  pick(doc, menuEl(clip.sec.settings, 'MODE'), 'Rand.Start');
  assert.equal(s.clip.clips[1].mode, 6);
  T.paint();
  assert.equal(menuEl(clip.sec.settings, 'TIME').style.display, '');
  pick(doc, menuEl(clip.sec.settings, 'MODE'), 'Normal');
  T.paint();
  assert.equal(menuEl(clip.sec.settings, 'TIME').style.display, 'none');
  const trans = byDest(clip.el, 'clip.trans', 'wk-knob')[0];
  dom.key(trans, 'ArrowUp');
  assert.equal(s.clip.clips[1].n.trans, 25 / 48);
  assert.equal(trans.getAttribute('aria-valuetext'), '+1 st');
  const rate = byDest(clip.el, 'clip.rate', 'wk-knob')[0];
  dom.key(rate, 'ArrowUp');
  assert.equal(s.clip.clips[1].n.rate, 0.6);
  assert.equal(rate.getAttribute('aria-valuetext'), '×4/3');
  dom.fire(lbl(clip.sec.settings, 'NOTE GATE')[0], 'click');
  assert.equal(s.clip.clips[1].noteGate, 1);
  pick(doc, menuEl(clip.sec.settings, 'LAUNCH QUANT'), '1/4');
  assert.equal(s.clip.clips[1].quant, 4);
  // EDIT ALL: every clip
  dom.fire(lbl(clip.sec.global, 'EDIT ALL')[0], 'click');
  dom.fire(lbl(clip.sec.settings, 'RETRIG')[0], 'click');
  assert.deepEqual(s.clip.clips.map(c => c.retrig), Array(12).fill(0));
  dom.fire(segBtn(clip.sec.global, 'POLY'), 'click');
  assert.equal(s.clip.trig, 1);
  // shortening the clip keeps start / offset inside it
  dom.fire(lbl(clip.sec.global, 'EDIT ALL')[0], 'click');
  s.clip.clips[1].start = 40; s.clip.clips[1].off = 50;
  T.paint();
  dom.key(len, 'Home');
  assert.deepEqual([s.clip.clips[1].len, s.clip.clips[1].start, s.clip.clips[1].off], [1, 0, 0]);
  clip.destroy();
});

test('ClipPage: slots (play / stop from the mask, rhythm strip), menu: preview clip, Export MIDI File, Copy to Track, copy / paste', async () => {
  const { s, kit, T, root, log } = mount();
  s.clip.clips[2].notes = [note(0, 1, 60), note(4, 2, 62), [8, 1, 64, 90, 1, 0.5, 0.5, 0], note(14, 4, 65)];
  s.clip.clips[2].len = 16;
  const clip = new seq.ClipPage(root, kit);
  T.paint();
  const S = clip.slots.slots;
  assert.equal(S[2].name.textContent, 'Clip 3');
  dom.fire(S[2].play, 'click');
  assert.deepEqual(log.pop(), ['seqCmd', 'clipLaunch', 2]);
  T.setSnap(snapSeq({ 4: (1 << 2) | (1 << 9) }));
  assert.ok(S[2].el.classList.contains('sx-play') && S[9].el.classList.contains('sx-play') && !S[0].el.classList.contains('sx-play'));
  dom.fire(S[2].play, 'click');
  assert.deepEqual(log.pop(), ['seqCmd', 'clipStop', 2]);
  // the rhythm strip draws the unmuted onsets of [start, len)
  const calls = S[2].cv.getContext('2d').calls.filter(c => c[0] === 'fillRect');
  assert.equal(calls.length, 3);
  // slot menu
  const items = clip.slotItems(2);
  assert.deepEqual(items.filter(x => !x.sep).map(x => x.label), ['Rename Clip…', 'Copy Clip', 'Paste Clip', 'Erase Clip', 'Set as Preview Clip', 'Export MIDI File', 'Copy to Track']);
  item(items, 'Set as Preview Clip').action();
  assert.equal(s.clip.preview, 2);
  T.paint();
  assert.match(S[2].name.textContent, /◉$/);
  item(clip.slotItems(2), 'Set as Preview Clip').action();
  assert.equal(s.clip.preview, -1);
  item(clip.slotItems(2), 'Export MIDI File').action();
  const [k, name, blob] = log.pop();
  assert.deepEqual([k, name, blob.type], ['download', 'Clip 3.mid', 'audio/midi']);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual(Array.from(bytes), Array.from(core.clipToSmf(s.clip.clips[2], 120)));
  // Copy to Track: song units relative to the paste point (seq-core clipTrackNotes, §7.5.6 with playhead 0): muted
  // notes skipped, start subtracted once, lengths not cut — the host adds the song playhead
  item(item(clip.slotItems(2), 'Copy to Track').sub, 'Bass').action();
  assert.deepEqual(log.pop(), ['clipToTrack', 't2', [{ t: 0, d: 240, n: 60, v: 100 }, { t: 960, d: 480, n: 62, v: 100 }, { t: 3360, d: 960, n: 65, v: 100 }]]);
  s.clip.clips[2].start = 4;
  item(item(clip.slotItems(2), 'Copy to Track').sub, 'Lead').action();
  assert.deepEqual(log.pop(), ['clipToTrack', 't3', core.clipTrackNotes(s.clip.clips[2], 0)]);
  assert.deepEqual(core.clipTrackNotes(s.clip.clips[2], 0), [{ t: 0, d: 480, n: 62, v: 100 }, { t: 2400, d: 960, n: 65, v: 100 }], 'relative to the clip start');
  s.clip.clips[2].start = 0;
  item(clip.slotItems(2), 'Copy Clip').action();
  item(clip.slotItems(5), 'Paste Clip').action();
  assert.deepEqual(s.clip.clips[5].notes, s.clip.clips[2].notes);
  item(clip.slotItems(5), 'Erase Clip').action();
  assert.deepEqual(s.clip.clips[5], core.defaultClipSlot());
  clip.destroy();
});

test('ClipPage: clip banks and the CLIP field (factory clip, save / load user clip, rename)', () => {
  const { s, kit, T, root, store } = mount();
  const clip = new seq.ClipPage(root, kit);
  T.paint();
  item(item(clip.bankItems(), 'Factory').sub, 'Basslines').action();
  assert.equal(s.clip.bank, 'Basslines');
  assert.ok(s.clip.clips[0].notes.length > 0);
  T.paint();
  assert.equal(dom.one(clip.sec.global, 'sx-bankbtn').textContent, 'Basslines');
  const field = dom.one(clip.sec.settings, 'sx-bankbtn');
  assert.equal(field.textContent, s.clip.clips[0].name);
  item(clip.clipItems(), 'Save Clip…').action();
  T.prompts.pop().ok('Groove');
  assert.equal(JSON.parse(store.get(core.STORE_KEYS.clips))[0].name, 'Groove');
  assert.equal(s.clip.clips[0].name, 'Groove');
  s.clip.sel = 4;
  item(item(clip.clipItems(), 'User').sub, 'Groove').action();
  assert.deepEqual(s.clip.clips[4].notes, s.clip.clips[0].notes);
  item(clip.clipItems(), 'Rename Clip…').action();
  T.prompts.pop().ok('Groove B');
  assert.equal(s.clip.clips[4].name, 'Groove B');
  const fac = item(clip.clipItems(), 'Factory').sub;
  assert.deepEqual(fac.map(x => x.label), ['Basslines', 'Chords', 'Slices', 'Melodies']);
  fac[3].sub[0].action();
  assert.deepEqual(s.clip.clips[4].notes, core.FACTORY_CLIP_BANKS[4].clips[0].notes);
  item(clip.clipItems(), 'Init Clip').action();
  assert.deepEqual(s.clip.clips[4], core.defaultClipSlot());
  item(clip.bankItems(), 'Save Clip Bank…').action();
  T.prompts.pop().ok('Set 1');
  assert.equal(s.clip.bank, 'Set 1');
  assert.equal(JSON.parse(store.get(core.STORE_KEYS.clipBanks))[0].clips.length, 12);
  clip.destroy();
});

test('ClipPage: roll tool bar (grid, zoom, fold incl. Ctrl/⌘-tap, headphones), lanes under the roll, macros pane', () => {
  const { s, kit, T, root, doc, log } = mount();
  s.kbd.key = 0;
  s.clip.clips[0].notes = [note(0, 2, 60), note(4, 2, 64)];
  const clip = new seq.ClipPage(root, kit);
  T.paint();
  const R = clip.roll, bar = dom.one(clip.sec.roll, 'sx-rollbar');
  pick(doc, menuEl(bar, 'GRID'), '1/8');
  assert.equal(R.gridIdx(), 1);
  dom.fire(lbl(bar, 'Zoom in')[0], 'click');
  assert.deepEqual(s.ui.clipZoom, [2, 1]);
  assert.deepEqual(T.log.pop(), ['edit', 'View', undefined, true]);
  const fold = dom.one(bar, 'sx-fold');
  dom.fire(fold, 'click');
  assert.equal(R.foldMode, 1);
  assert.deepEqual(R.view().rows, [60, 64]);
  dom.fire(fold, 'click');
  assert.equal(R.foldMode, 0);
  dom.fire(fold, 'click', { ctrlKey: true, metaKey: true });
  assert.equal(R.foldMode, 2);
  assert.equal(fold.textContent, 'FOLD ♯');
  dom.fire(dom.one(bar, 'sx-ear'), 'click');
  assert.equal(R.listen, 1);
  // headphones: pressing a note auditions it (vel 0–1), release stops it
  dom.place(R.el, 0, 0, KEYW + 320, RULER + 240);
  R.command('fold', 1);
  const v = R.view(), y60 = RULER + (v.rows.length - 1 - 0) * v.rowH - v.top + 5;
  dom.ptr(R.el, 'pointerdown', KEYW + 1 * v.pps, y60);
  dom.ptr(R.el, 'pointerup', KEYW + 1 * v.pps, y60);
  assert.deepEqual(log.slice(-2), [['on', 60, 100 / 127], ['off', 60]]);
  // lanes: velocity of the note under the pointer; macro lanes from the macro names
  s.macros[0].name = 'Cutoff';
  T.paint();
  const lanes = clip.lanes;
  assert.deepEqual(lanes.tabBtns.map(b => b.textContent).slice(0, 6), ['VELOCITY', 'EXPR X', 'EXPR Y', 'EXPR Z', 'Cutoff', 'Macro 2']);
  dom.place(lanes.cv, 0, 0, KEYW + 320, 72);
  dom.ptr(lanes.cv, 'pointerdown', KEYW + 4 * v.pps + 2, 72 - 4);
  dom.ptr(lanes.cv, 'pointermove', KEYW + 4 * v.pps + 2, 36);
  dom.ptr(lanes.cv, 'pointerup', KEYW + 4 * v.pps + 2, 36);
  assert.equal(s.clip.clips[0].notes[1][3], 64);
  assert.deepEqual(T.log.slice(-3).map(e => e[2]), ['start', 'move', 'end']);
  dom.fire(lanes.tabBtns[1], 'click');
  dom.ptr(lanes.cv, 'pointerdown', KEYW + 2, 4);
  dom.ptr(lanes.cv, 'pointerup', KEYW + 2, 4);
  assert.equal(s.clip.clips[0].notes[0][5], 1);
  s.macros[0].v = 0.25;
  dom.fire(lanes.tabBtns[4], 'click');
  dom.fire(lanes.addB, 'click');
  assert.deepEqual(s.clip.clips[0].lanes.m1, [[0, 0.25, 0], [1, 0.25, 0]]);
  // macros pane: hidden until toggled; knobs bind s.macros[k].v and carry their names
  const sec = clip.sec.macros.parentNode;
  assert.ok(sec.classList.contains('sx-hide'));
  dom.fire(dom.one(clip.sec.midiout, 'sx-macbtn'), 'click');
  assert.ok(!sec.classList.contains('sx-hide'));
  const m2 = byDest(clip.el, 'm2', 'wk-knob')[0];
  dom.key(m2, 'ArrowUp');
  assert.equal(s.macros[1].v, 0.01);
  assert.equal(byDest(clip.el, 'm1', 'wk-knob')[0].getAttribute('aria-label'), 'Cutoff');
  clip.destroy();
});

test('ClipPage: recording — OVERDUB wraps, EXTEND grows the clip, commit / undo take / finish, macro lanes while recording', () => {
  let input = null;
  const { s, kit, T, root, log } = mount({ host: { onInput: fn => { input = fn; log.push(['onInput', !!fn]); }, metronome: on => log.push(['metro', on]) } });
  s.clip.clips[0].len = 16;
  clock(10000);
  try {
    const clip = new seq.ClipPage(root, kit);
    T.paint();
    const recB = dom.one(clip.sec.record, 'sx-recbtn');
    dom.fire(recB, 'click');
    assert.ok(clip.rec);
    assert.deepEqual(log.slice(-3), [['seqCmd', 'clipLaunch', 0], ['onInput', true], ['metro', true]]);
    assert.deepEqual(T.log.find(e => e[0] === 'setN'), ['setN', 'clip.on', 1, 'set'], 'CLIP is switched on for the launch');
    T.paint();
    assert.equal(recB.getAttribute('aria-pressed'), 'true');
    assert.equal(clip.rec.wait, true);
    clock(10500);
    T.setSnap(snapSeq({ 4: 1, 5: 0 }));                // the quantised launch happened: the clock is anchored at the clip's playhead
    assert.equal(clip.rec.wait, false);
    const k = 120 / 60000 * 4, at = sx => 10500 + sx / k;   // 120 BPM, RATE ×1: 125 ms per sixteenth
    assert.equal(clip.rec.k, k);
    assert.ok(Math.abs(clip.dspPos(at(3)) - 3) < 1e-9);
    input(true, 60, 100, at(2));
    input({ on: false, n: 60, t: at(4) });
    input(true, 62, 64, at(17));                      // OVERDUB: wraps into the loop
    input(false, 62, 0, at(18.5));
    assert.deepEqual(clip.pending(), [note(2, 2, 60, 100), note(1, 1.5, 62, 64)]);
    clip.undoTake();
    assert.deepEqual(clip.pending(), []);
    input(true, 60, 100, at(2));
    input(true, 60, 0, at(4));                        // a note-on with velocity 0 is a note-off
    assert.ok(clip.commitTake());
    assert.deepEqual(s.clip.clips[0].notes, [note(2, 2, 60, 100)]);
    assert.deepEqual(T.log.pop(), ['edit', 'Record', undefined, false]);
    // EXTEND: a note past the end grows the clip by whole bars
    s.clip.rec.mode = 1;
    input(true, 67, 90, at(14));
    input(false, 67, 0, at(18));
    assert.equal(s.clip.clips[0].len, 32);
    assert.deepEqual(clip.pending(), [note(14, 4, 67, 90)]);
    // macro knob moves while the clip plays are written into its lane at the record position
    T.setSnap(snapSeq({ 4: 1, 5: 0 }));
    dom.fire(dom.one(clip.sec.midiout, 'sx-macbtn'), 'click');
    const m1 = byDest(clip.el, 'm1', 'wk-knob')[0];
    dom.key(m1, 'End');
    assert.equal(s.macros[0].v, 1);
    assert.ok(Array.isArray(s.clip.clips[0].lanes.m1));
    assert.equal(s.clip.clips[0].lanes.m1.some(p => p[1] === 1), true);
    // finish: commits the take, releases onInput, stops the metronome
    dom.fire(dom.all(clip.sec.record).find(n => n.getAttribute && n.getAttribute('aria-label') === 'Finish recording'), 'click');
    assert.equal(clip.rec, null);
    assert.deepEqual(s.clip.clips[0].notes, [note(2, 2, 60, 100), note(14, 4, 67, 90)]);
    assert.deepEqual(log.slice(-2), [['onInput', false], ['metro', false]]);
    // without host.onInput (and no keyboard strip) recording is refused with a notice
    const m2 = mount({ host: { onInput: undefined } });
    const c2 = new seq.ClipPage(m2.root, m2.kit);
    assert.equal(c2.record(true), false);
    assert.match(m2.T.log.pop()[1], /not available/);
    // a stopped clip without host.seqCmd cannot be launched: refused (nothing waits for a launch that never comes)
    const m3 = mount({ host: { onInput: () => {}, seqCmd: undefined } });
    const c3 = new seq.ClipPage(m3.root, m3.kit);
    assert.equal(c3.record(true), false);
    assert.match(m3.T.log.pop()[1], /launching is not available/);
    clip.destroy();
    c2.destroy();
    c3.destroy();
  } finally { clock(null); }
});

test('ClipPage: recording from a stopped clip — input waits for the launch, the downbeat lands on the downbeat, no EXTEND before it, launch timeout', () => {
  for (const mode of [0, 1]) {
    let input = null;
    const { s, kit, T, root } = mount({ host: { onInput: fn => { input = fn; } } });
    const c = s.clip.clips[0];
    c.len = 16; c.quant = 6;                            // a 1-bar clip, LAUNCH QUANT 1 bar
    s.clip.rec.mode = mode;
    clock(10000);
    try {
      const clip = new seq.ClipPage(root, kit);
      T.setSnap(snapSeq({ 4: 0 }));
      assert.ok(clip.record(true));
      // two seconds of snapshots while the launch waits for the bar: nothing grows, nothing is placed
      for (let t = 10033; t < 12000; t += 33) { clock(t); T.setSnap(snapSeq({ 4: 0 })); }
      assert.equal(c.len, 16, 'no EXTEND while waiting');
      assert.equal(T.log.filter(e => e[1] === 'Extend clip').length, 0);
      clock(11990);
      input(true, 64, 80, 11990);                       // 10 ms before the downbeat (pre-roll)
      input(false, 64, 0, 12100);
      clock(12000);
      input(true, 60, 100, 12000);                      // on the downbeat, before any snapshot shows the clip playing
      assert.deepEqual(clip.pending(), []);
      clock(12030);
      T.setSnap(snapSeq({ 4: 1, 5: 0.24 }));            // first snapshot that shows it playing: 30 ms after the launch
      clock(12250);
      input(false, 60, 0, 12250);                       // two sixteenths later
      clip.finishRecord();
      const got = c.notes.map(n => n.slice(0, 3));
      // the downbeat note is [0, 2]; the pre-roll note wraps to the loop end (OVERDUB) or starts at the start (EXTEND)
      assert.deepEqual(got.find(n => n[2] === 60), [0, 2, 60], 'mode ' + mode);
      const pre = got.find(n => n[2] === 64);
      if (mode === 0) assert.ok(pre && Math.abs(pre[0] - 15.92) < 1e-9, 'pre-roll wrapped: ' + JSON.stringify(pre));
      else assert.deepEqual(pre, [0, 0.8, 64]);
      assert.equal(c.len, 16, 'the finished EXTEND recording keeps the bars it reached');
      clip.destroy();
    } finally { clock(null); }
  }
  // the launch never shows (no snapshot of the clip playing): the recording ends with a notice after LAUNCH QUANT + 2.5 s
  let input = null;
  const { s, kit, T, root, log } = mount({ host: { onInput: fn => { input = fn; log.push(['onInput', !!fn]); } } });
  s.clip.clips[0].len = 16;
  s.clip.clips[0].quant = 6;
  s.clip.rec.mode = 1;
  clock(0);
  try {
    const clip = new seq.ClipPage(root, kit);
    assert.ok(clip.record(true));
    input(true, 60, 100, 100);
    for (let t = 33; t <= 4400; t += 33) { clock(t); T.setSnap(snapSeq({ 4: 0 })); }
    assert.ok(clip.rec, 'still waiting at 2 s + 2.4 s');
    clock(4600);
    T.setSnap(snapSeq({ 4: 0 }));
    assert.equal(clip.rec, null);
    assert.deepEqual(T.log.filter(e => e[0] === 'notify').pop(), ['notify', 'The clip did not start: recording stopped']);
    assert.deepEqual(log.pop(), ['onInput', false]);
    assert.equal(s.clip.clips[0].len, 16);
    assert.deepEqual(s.clip.clips[0].notes, []);
    clip.destroy();
  } finally { clock(null); }
});

test('ClipPage: recording clock — EXTEND a beat ahead of the DSP playhead, latency, re-anchoring on late snapshots, the clip stopping', () => {
  let input = null;
  const { s, kit, T, root } = mount({ host: { onInput: fn => { input = fn; }, latency: () => 0.1 } });
  const c = s.clip.clips[0];
  c.len = 16;
  s.clip.rec.mode = 1;
  const k = 120 / 60000 * 4;
  clock(0);
  try {
    const clip = new seq.ClipPage(root, kit);
    T.setSnap(snapSeq({ 4: 1, 5: 0 }));
    assert.ok(clip.record(true));
    assert.equal(clip.rec.wait, false, 'a playing clip anchors at once');
    assert.ok(Math.abs(clip.rec.latK - 100 * k) < 1e-12);
    // snapshots every 33 ms, each delivered 0–20 ms late: the clock keeps the least-delayed one
    let grewAt = null;
    for (let t = 33; t < 2000 && grewAt === null; t += 33) {
      const late = (t * 13) % 21;
      clock(t + late);
      T.setSnap(snapSeq({ 4: 1, 5: (t * k) % 16 }));
      assert.ok(Math.abs(clip.dspPos(t + late) - t * k) <= 20 * k + 1e-9, 'clock within the delivery jitter');
      if (c.len !== 16) grewAt = t * k;
    }
    assert.ok(grewAt !== null && grewAt <= 12.3 && grewAt >= 11.5, 'EXTEND one beat ahead of the DSP playhead: ' + grewAt);
    assert.equal(c.len, 32);
    // the heard position lags the DSP playhead by the output latency
    const t = 1600;
    clock(t);
    input(true, 60, 100, t);
    input(false, 60, 0, t + 125);
    assert.ok(Math.abs(clip.pending()[0][0] - (clip.dspPos(t) - 100 * k)) < 1e-4);
    // a seek / relaunch (a jump of the playhead) restarts the anchor at once
    clock(1700);
    T.setSnap(snapSeq({ 4: 1, 5: 2 }));
    assert.ok(Math.abs(clip.dspPos(1700) - 2) < 1e-9);
    // the clip stops (stop button, One Shot, another clip in MONO): after 150 ms the recording finishes with a notice
    clock(1733);
    T.setSnap(snapSeq({ 4: 0 }));
    assert.ok(clip.rec);
    clock(1900);
    T.setSnap(snapSeq({ 4: 0 }));
    assert.equal(clip.rec, null);
    assert.deepEqual(T.log.filter(e => e[0] === 'notify').pop(), ['notify', 'Recording finished: the clip stopped']);
    assert.deepEqual(c.notes.map(n => n[2]), [60]);
    clip.destroy();
  } finally { clock(null); }
});

test('ClipPage: a recording belongs to its clip; ↶ takes back the bars EXTEND added; finish keeps the bars reached; note room', () => {
  let input = null;
  const { s, kit, T, root } = mount({ host: { onInput: fn => { input = fn; } } });
  const C = s.clip;
  C.clips[0].len = 64; C.clips[1].len = 16; C.clips[1].notes = [note(0, 2, 48)];
  const k = 120 / 60000 * 4;
  clock(0);
  try {
    const clip = new seq.ClipPage(root, kit);
    T.setSnap(snapSeq({ 4: 1, 5: 0 }));
    clip.record(true);
    input(true, 72, 100, 32 / k); input(false, 72, 0, 34 / k);   // sixteenth 32 of clip A
    dom.fire(clip.slots.slots[1].name, 'click');                  // select clip B to look at it
    assert.equal(C.sel, 1);
    assert.equal(clip.roll.o.record(), null, 'the take is not drawn over another clip');
    clip.finishRecord();
    assert.deepEqual(C.clips[0].notes.map(n => n.slice(0, 3)), [[32, 2, 72]]);
    assert.deepEqual(C.clips[1].notes, [note(0, 2, 48)]);
    // EXTEND: ↶ takes back the bars the take added and waits for the DSP to play the shorter clip
    C.sel = 1;
    C.rec.mode = 1;
    clock(10000);
    T.setSnap(snapSeq({ 4: 2, 5: 0 }));
    clip.record(true);
    for (let t = 10033; t <= 12500; t += 33) { clock(t); T.setSnap(snapSeq({ 4: 2, 5: (t - 10000) * k })); }
    assert.equal(C.clips[1].len, 32);
    clip.undoTake();
    assert.equal(C.clips[1].len, 16);
    assert.deepEqual(T.log.pop(), ['edit', 'Undo take', undefined, false]);
    clock(12533);
    T.setSnap(snapSeq({ 4: 2, 5: 20.3 }));                        // stale: the DSP still plays the longer clip
    assert.equal(C.clips[1].len, 16, 'no regrowth from a stale snapshot');
    clock(12566);
    T.setSnap(snapSeq({ 4: 2, 5: 4.5 }));                         // the DSP wrapped at the shorter length
    assert.ok(Math.abs(clip.dspPos(12566) - 4.5) < 1e-9);
    // finish before the bar EXTEND added ahead is reached: back to the bars the recording reached
    for (let t = 12599; t <= 13600; t += 33) { clock(t); T.setSnap(snapSeq({ 4: 2, 5: 4.5 + (t - 12566) * k })); }
    assert.equal(C.clips[1].len, 32, 'grown a bar ahead');
    clip.finishRecord();
    assert.equal(C.clips[1].len, 16, 'nothing reached the second bar: trimmed back');
    // the bank budget: 4096 notes; a take never displaces the clip's notes, what does not fit is dropped with a notice
    for (const c of C.clips.slice(2, 6)) { c.len = 1024; c.notes = Array.from({ length: 1023 }, (_, i) => note(i, 0.5, 60)); }
    C.clips[1].notes = [];
    C.rec.mode = 0;
    assert.equal(clip.noteRoom(1), 4096 - 4 * 1023 - 1);
    clock(20000);
    T.setSnap(snapSeq({ 4: 2, 5: 0 }));
    clip.record(true);
    for (let i = 0; i < 6; i++) { input(true, 60 + i, 100, 20000 + i * 125); input(false, 60 + i, 0, 20000 + i * 125 + 60); }
    clip.finishRecord();
    assert.equal(C.clips[1].notes.length, 3);
    assert.match(T.log.filter(e => e[0] === 'notify').pop()[1], /^At most 4096 notes per clip bank: 3 recorded notes were not kept/);
    clip.destroy();
  } finally { clock(null); }
});

test('ClipPage: the keyboard strip is recorded (not the previews); host input lights the piano keys; velocity units; destroy finishes', () => {
  let input = null;
  const { s, kit, T, root, log } = mount({ host: { onInput: fn => { input = fn; log.push(['onInput', !!fn]); }, metronome: on => log.push(['metro', on]) } });
  s.clip.clips[0].len = 16;
  clock(0);
  try {
    const kb = new seq.KeyboardPanel(root, kit), clip = new seq.ClipPage(root, kit);
    assert.deepEqual(log.filter(e => e[0] === 'onInput'), [['onInput', true]], 'one subscription for the strip and the recorder');
    T.paint();
    // host input notes light up as held keys
    input(true, 64, 1, 0);
    const key64 = dom.byAttr(kb.keys.el, 'data-note', '64')[0];
    assert.ok(key64.classList.contains('wk-held'));
    input(false, 64, 0, 0);
    assert.ok(!key64.classList.contains('wk-held'));
    T.setSnap(snapSeq({ 4: 1, 5: 0 }));
    clip.record(true);
    // a note of the strip (through host.audition) is recorded
    dom.place(kb.keys.el, 0, 0, 300, 72);
    const [lo, hi] = kb.keys.range(), whites = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter(n => ![1, 3, 6, 8, 10].includes(n % 12));
    const x60 = (whites.indexOf(60) + 0.5) * 300 / whites.length;
    clock(250);
    dom.ptr(kb.keys.el, 'pointerdown', x60, 70);
    clock(500);
    dom.ptr(kb.keys.el, 'pointerup', x60, 70);
    // a preview of the piano roll's key column is not
    const R = clip.roll;
    dom.place(R.el, 0, 0, KEYW + 320, RULER + 240);
    const v = R.view();
    clock(600);
    dom.ptr(R.el, 'pointerdown', 4, RULER + 5);
    dom.ptr(R.el, 'pointerup', 4, RULER + 5);
    // velocity 1 stays 1 (MIDI units, no 0–1 guessing)
    input(true, 50, 1, 750); input(false, 50, 0, 875);
    const aOn = log.find(e => e[0] === 'on' && e[1] === 60), vel = Math.round(aOn[2] * 127);
    assert.ok(vel > 1 && vel <= 127);
    assert.deepEqual(clip.pending().map(n => [n[0], n[1], n[2], n[3]]), [[2, 2, 60, vel], [6, 1, 50, 1]]);
    assert.ok(log.some(e => e[0] === 'on' && e[1] === v.rows[v.rows.length - 1 - Math.floor(v.top / v.rowH)]), 'the key column previewed a note');
    // destroy (track switch) finishes the recording: the take is kept, the input and the metronome released
    log.length = 0;
    clip.destroy();
    assert.deepEqual(s.clip.clips[0].notes.map(n => [n[0], n[2]]), [[2, 60], [6, 50]]);
    assert.deepEqual(log, [['metro', false]], 'the strip keeps the input subscription');
    kb.destroy();
    assert.deepEqual(log.pop(), ['onInput', false]);
    // without host.metronome the METRO toggle is disabled
    const m2 = mount({ host: { onInput: () => {} } });
    const c2 = new seq.ClipPage(m2.root, m2.kit);
    m2.T.paint();
    const metro = dom.all(c2.sec.record).find(n => n.textContent === 'METRO' && n.tagName === 'BUTTON');
    assert.ok(metro && (metro.disabled || metro.getAttribute('aria-disabled') === 'true'));
    c2.destroy();
  } finally { clock(null); }
});

test('kit.live(shown): hidden ARP / CLIP / keyboard panels are not painted; a CLIP recording goes on while hidden', () => {
  const { s, kit, T, root } = mount({ host: { onInput: () => {} } });
  s.clip.clips[0].len = 16;
  s.clip.rec.mode = 1;
  const arp = new seq.ArpPage(root, kit), clip = new seq.ClipPage(root, kit), kb = new seq.KeyboardPanel(root, kit);
  T.paint();
  // recording started on the CLIP page (waiting for its quantised launch), then another page is shown
  assert.ok(clip.record(true));
  assert.equal(clip.rec.wait, true);
  T.paint();
  const ov = clip.roll.ov.getContext('2d').calls, cv = clip.roll.cv.getContext('2d').calls, n0 = ov.length, c0 = cv.length;
  const kbUpd = kb.clipKeys.update;
  let kbN = 0;
  kb.clipKeys.update = () => { kbN++; kbUpd(); };
  T.shown = false;
  T.setSnap(snapSeq({ 0: 3, 4: 1 << 2, 5: 6 }));
  assert.equal(arp.slots.slots[3].el.classList.contains('sx-play'), false, 'ARP slots not repainted while hidden');
  assert.equal(clip.slots.slots[2].el.classList.contains('sx-play'), false, 'CLIP slots not repainted while hidden');
  assert.equal(ov.length, n0, 'no playhead drawing while hidden');
  assert.equal(kbN, 0, 'keyboard keys not repainted while hidden');
  // the quantised launch is anchored and EXTEND grows the clip while another page is shown, without painting
  T.setSnap(snapSeq({ 4: 1, 5: 15 }));
  assert.equal(clip.rec.wait, false);
  assert.ok(Math.abs(clip.dspPos(clip.snapAt) - 15) < 1e-9);
  assert.equal(s.clip.clips[0].len, 32, 'EXTEND at the clip end');
  assert.deepEqual([ov.length, cv.length], [n0, c0], 'nothing drawn while hidden');
  // shown again: the play states and the playhead are painted
  T.shown = true;
  T.setSnap(snapSeq({ 0: 3, 4: 1 | (1 << 2), 5: 6 }));
  assert.equal(arp.slots.slots[3].el.classList.contains('sx-play'), true);
  assert.equal(clip.slots.slots[2].el.classList.contains('sx-play'), true);
  assert.ok(ov.length > n0 && cv.length > c0);
  assert.equal(kbN, 1);
  clip.finishRecord();
  arp.destroy();
  clip.destroy();
  kb.destroy();
});

test('KeyboardPanel: collapse, TRANSPOSE (◀ ▶, keys, wheel ±12), KEY / SCALE, SWING with division, OSC MAPPING popover', () => {
  const { s, kit, T, root, doc } = mount();
  const kb = new seq.KeyboardPanel(root, kit);
  T.paint();
  assert.equal(kb.el.classList.contains('sx-collapsed'), false);
  const fold = dom.all(kb.el).find(n => n.getAttribute && n.getAttribute('aria-label') === 'Collapse keyboard');
  dom.fire(fold, 'click');
  assert.equal(s.ui.kbdOpen, 0);
  assert.deepEqual(T.log.pop(), ['edit', 'View', undefined, true]);
  T.paint();
  assert.equal(kb.el.classList.contains('sx-collapsed'), true);
  assert.equal(fold.getAttribute('aria-expanded'), 'false');
  // transpose
  dom.fire(lbl(kb.sec.transpose, 'Transpose up')[0], 'click');
  dom.fire(lbl(kb.sec.transpose, 'Transpose up')[0], 'click');
  assert.equal(s.kbd.trans, 2);
  dom.fire(lbl(kb.sec.transpose, 'Transpose down')[0], 'click');
  assert.equal(s.kbd.trans, 1);
  T.paint();
  const nb = dom.one(kb.sec.transpose, 'wk-nb');
  assert.equal(dom.one(nb, 'wk-nbt').textContent, '+1 st');
  dom.key(nb, 'ArrowUp');
  assert.equal(s.kbd.trans, 2);
  dom.fire(dom.one(kb.sec.transpose, 'sx-trans'), 'wheel', { deltaY: -100, deltaMode: 1 });
  assert.equal(s.kbd.trans, 14);
  dom.fire(nb, 'wheel', { deltaY: -100, deltaMode: 1 });
  assert.equal(s.kbd.trans, 24, 'clamped to +24');
  dom.fire(nb, 'wheel', { deltaY: 100, deltaMode: 1 });
  assert.equal(s.kbd.trans, 12);
  // key / scale
  pick(doc, dom.one(kb.sec.key, 'wk-menu'), 'D');
  assert.equal(s.kbd.key, 2);
  pick(doc, dom.one(kb.sec.scale, 'wk-menu'), 'Dorian');
  assert.equal(s.kbd.scale, 4);
  pick(doc, dom.one(kb.sec.key, 'wk-menu'), '--');
  assert.equal(s.kbd.key, -1);
  // swing: 300 steps (0.25 % in Live's convention); the division appears when not OFF
  const sw = dom.one(kb.sec.swing, 'wk-nb'), div = dom.one(kb.sec.swing, 'wk-menu');
  T.paint();
  assert.equal(dom.one(sw, 'wk-nbt').textContent, 'OFF');
  assert.equal(div.style.display, 'none');
  dom.key(sw, 'ArrowUp');
  assert.equal(s.kbd.swing, 0.00667);
  T.paint();
  assert.equal(dom.one(sw, 'wk-nbt').textContent, '50.3%');
  assert.equal(div.style.display, '');
  dom.key(sw, 'End');
  assert.equal(s.kbd.swing, 1);
  assert.equal(dom.one(sw, 'wk-nbt').textContent, '87.5%');
  pick(doc, div, '1/32');
  assert.equal(s.kbd.div, 2);
  // OSC MAPPING popover (protocol: second press closes)
  const map = dom.one(kb.el, 'sx-oscmapbtn');
  dom.fire(map, 'click');
  assert.equal(T.pops.length, 1);
  const P = T.pops[0], ed = P.ed;
  assert.ok(ed instanceof seq.OscMapEditor);
  assert.equal(P.o, 'oscmap');
  dom.fire(map, 'click');
  assert.equal(ed.dead, true);
  kb.destroy();
});

test('KeyboardPanel: piano keys audition with velocity from the touch height; ARP / CLIP keys launch slots; scale shading', () => {
  const { s, kit, T, root, log } = mount();
  s.kbd.key = 0;
  s.kbd.scale = 0;
  const kb = new seq.KeyboardPanel(root, kit);
  T.paint();
  const pk = kb.keys;
  assert.equal(dom.byAttr(pk.el, 'data-note', '48').length, 1, 'two octaves from C3 at narrow widths');
  assert.equal(dom.byAttr(pk.el, 'data-note', '72').length, 1);
  assert.ok(dom.byAttr(pk.el, 'data-note', '61')[0].classList.contains('wk-out'));
  assert.ok(dom.byAttr(pk.el, 'data-note', '60')[0].classList.contains('wk-root'));
  dom.place(pk.el, 0, 0, 300, 100);
  dom.ptr(pk.el, 'pointerdown', 10, 90, { pointerType: 'touch' });
  dom.ptr(pk.el, 'pointerup', 10, 90, { pointerType: 'touch' });
  assert.deepEqual(log.slice(-2), [['on', 48, Math.round(1 + 126 * 0.9) / 127], ['off', 48]]);
  // a wider strip shows more octaves (wk's fit; in a browser its ResizeObserver calls it — no layout read per paint)
  dom.place(pk.el, 0, 0, 1176, 80);
  T.paint();
  assert.deepEqual(pk.range(), [48, 72], 'a repaint does not re-fit');
  pk.fit();
  assert.deepEqual(pk.range(), [24, 108]);
  assert.equal(dom.byAttr(pk.el, 'data-note', '24').length, 1);
  assert.equal(dom.byAttr(pk.el, 'data-note', '108').length, 1);
  // ARP keys: key j launches arp slot j (relaunch); CLIP keys toggle launch / stop from the playing mask
  dom.place(kb.arpKeys.el, 0, 0, 140, 40);
  dom.ptr(kb.arpKeys.el, 'pointerdown', 30, 35);
  dom.ptr(kb.arpKeys.el, 'pointerup', 30, 35);
  assert.deepEqual(log.pop(), ['seqCmd', 'arpLaunch', 2]);
  dom.place(kb.clipKeys.el, 0, 0, 140, 40);
  dom.ptr(kb.clipKeys.el, 'pointerdown', 20, 10);
  dom.ptr(kb.clipKeys.el, 'pointerup', 20, 10);
  assert.deepEqual(log.pop(), ['seqCmd', 'clipLaunch', 1]);
  T.setSnap(snapSeq({ 0: 2, 4: 2 }));
  assert.ok(dom.byAttr(kb.arpKeys.el, 'data-note', '2')[0].classList.contains('wk-lit'));
  assert.ok(dom.byAttr(kb.clipKeys.el, 'data-note', '1')[0].classList.contains('wk-lit'));
  dom.ptr(kb.clipKeys.el, 'pointerdown', 20, 10);
  dom.ptr(kb.clipKeys.el, 'pointerup', 20, 10);
  assert.deepEqual(log.pop(), ['seqCmd', 'clipStop', 1]);
  kb.destroy();
});

test('OscMapEditor: KEY / VEL range bars per row, FOLD and WARP (no WARP for ARP), edits through the kit', () => {
  const { s, kit, T } = mount();
  const doc = kit.doc, box = doc.createElement('div');
  doc.body.appendChild(box);
  const ed = new seq.OscMapEditor(box, kit);
  assert.deepEqual(dom.all(ed.el).map(n => n.getAttribute && n.getAttribute('data-row')).filter(Boolean), ['a', 'b', 'c', 'noise', 'sub', 'arp']);
  assert.equal(dom.byAttr(ed.el, 'aria-selected', 'true')[0].textContent, 'KEY');
  assert.equal(dom.byAttr(ed.rows.arp, 'data-flag', 'warp').length, 0);
  assert.equal(dom.byAttr(ed.rows.c, 'data-flag', 'warp').length, 1);
  assert.equal(dom.one(ed.rows.a, 'wk-rbv').textContent, 'C-1–G9');
  assert.ok(ed.el.classList.contains('sx-keytab'), 'KEY bars over a keyboard');
  const lo = dom.one(ed.rows.b, 'wk-rblo');
  dom.key(lo, 'ArrowRight', { shiftKey: true });
  assert.deepEqual(s.osc[1].map.k, [12, 127]);
  assert.deepEqual(T.log.pop(), ['edit', 'OSC B key range', 'set', false]);
  ed.refresh();
  assert.equal(dom.one(ed.rows.b, 'wk-rbv').textContent, 'C0–G9');
  dom.fire(dom.byAttr(ed.rows.noise, 'data-flag', 'fold')[0], 'click');
  assert.equal(s.noise.map.fold, 1);
  dom.fire(dom.byAttr(ed.rows.sub, 'data-flag', 'warp')[0], 'click');
  assert.equal(s.sub.map.warp, 1);
  dom.fire(dom.byAttr(ed.rows.arp, 'data-flag', 'fold')[0], 'click');
  assert.equal(s.kbd.arpMap.fold, 1);
  // VEL tab: 1–127 ranges
  dom.fire(dom.byAttr(ed.el, 'data-tab', '1')[0], 'click');
  assert.equal(ed.tab, 1);
  assert.equal(dom.byAttr(ed.el, 'aria-selected', 'true')[0].textContent, 'VEL');
  assert.equal(dom.one(ed.rows.arp, 'wk-rbv').textContent, '1–127');
  assert.ok(!ed.el.classList.contains('sx-keytab'));
  dom.key(dom.one(ed.rows.arp, 'wk-rbhi'), 'ArrowLeft');
  assert.deepEqual(s.kbd.arpMap.v, [1, 126]);
  ed.destroy();
  ed.destroy();
  assert.equal(ed.el.parentNode, null);
});

/* ================================================================ PianoRoll */

function rollOf(over) {
  const doc = dom.fresh(), root = doc.createElement('div');
  doc.body.appendChild(root);
  const clip = Object.assign({ len: 64, start: 0, off: 0, offQ: 2, notes: [], lanes: {} }, over && over.clip);
  const log = [];
  let zoom = (over && over.zoom) || [1, 1];
  const o = Object.assign({ clip: () => clip, edit: (fn, e) => { fn(clip); log.push([e && e.label, e && e.phase]); }, key: () => -1, scale: () => 0, playhead: () => -1,
    zoom: () => zoom, setZoom: z => { zoom = z; }, audition: { on: (n, v) => log.push(['on', n, v]), off: n => log.push(['off', n]) } }, over && over.o);
  const roll = new seq.PianoRoll(root, o);
  dom.place(roll.el, 0, 0, KEYW + 640, RULER + 288);
  roll.top = null;
  roll.refresh();
  const v = () => roll.view();
  const X = t => KEYW + (t - v().t0) * v().pps;
  const Y = p => RULER + (v().rows.length - 1 - v().rows.indexOf(p)) * v().rowH - v().top + v().rowH / 2;
  return { doc, root, clip, log, roll, X, Y, v, zoom: () => zoom };
}

test('PianoRoll: view geometry, view commands, refresh on change only', () => {
  const doc = dom.fresh(), root = doc.createElement('div');
  doc.body.appendChild(root);
  const clip = { len: 64, start: 0, off: 0, offQ: 2, notes: [note(0, 2, 48), note(4, 2, 55)], lanes: {} };
  let zoom = [2, 1];
  const roll = new seq.PianoRoll(root, { clip: () => clip, edit: fn => fn(clip), key: () => 0, scale: () => MAJOR, playhead: () => -1,
    zoom: () => zoom, setZoom: z => { zoom = z; } });
  assert.equal(roll.el.parentNode, root);
  assert.equal(roll.el.getAttribute('aria-label'), 'Piano roll');
  const v = roll.view();
  assert.equal(v.pps, 32);
  assert.equal(v.rowH, 12);
  assert.equal(v.rows.length, 128);
  assert.equal(roll.refresh(), false, 'built with the current view');
  assert.ok(roll.command('fold', 2));
  assert.equal(roll.view().rows.length, range(0, 127).filter(n => MAJOR.includes(n % 12)).length);
  assert.ok(roll.command('fold', 1));
  assert.deepEqual(roll.view().rows, [48, 55]);
  assert.equal(roll.command('fold', 3), false);
  assert.ok(roll.command('zoom', [1000, 0.5]));
  assert.deepEqual(zoom, [64, 0.5]);
  assert.equal(roll.view().pps, 16 * 64);
  assert.ok(roll.command('grid', 4));
  assert.equal(roll.step(), 0.25);
  assert.equal(roll.command('grid', 7), false);
  assert.ok(roll.command('audition', 1));
  assert.equal(roll.refresh(), false);
  clip.notes.push(note(8, 1, 50));
  assert.equal(roll.refresh(), true, 'in-place edits are seen');
  assert.equal(roll.refresh(), false);
  for (const c of ['nonsense', 'c_up']) assert.equal(roll.command(c), false, c);
  // the auto-scroll centres the used notes (rows fit: top 0); geometry agrees with rollHit
  const h = seq.rollHit(clip.notes, roll.view(), 1, 0);
  assert.equal(h.note, 55);
  // the playhead draws on the overlay only
  let ph = -1;
  roll.o.playhead = () => ph;
  const base = roll.cv.getContext('2d').calls.length;
  ph = 4;
  roll.tick();
  assert.equal(roll.cv.getContext('2d').calls.length, base);
  assert.ok(roll.ov.getContext('2d').calls.some(c => c[0] === 'fillRect' && c[1] === 34 + 4 * 16 * 64));
  roll.destroy();
  roll.destroy();
  assert.equal(roll.el.parentNode, null);
  assert.equal(roll.refresh(), false);
  assert.equal(roll.command('fold', 0), false);
});

test('PianoRoll: double-click adds at the grid cell (newest orange) and deletes; drag moves / resizes with phases; Alt = free', () => {
  const { clip, log, roll, X, Y } = rollOf();
  dom.fire(roll.el, 'dblclick', { clientX: X(5.6), clientY: Y(60) });
  assert.deepEqual(clip.notes, [note(5, 1, 60)]);
  assert.deepEqual(log.pop(), ['Add note', 'set']);
  assert.deepEqual(roll.newest, [5, 60]);
  assert.deepEqual(roll.sel, [0]);
  // move: +2 sixteenths, +1 semitone (snapped)
  dom.ptr(roll.el, 'pointerdown', X(5.5), Y(60));
  dom.ptr(roll.el, 'pointermove', X(6.6), Y(60));
  dom.ptr(roll.el, 'pointermove', X(7.4), Y(61));
  dom.ptr(roll.el, 'pointerup', X(7.4), Y(61));
  assert.deepEqual(clip.notes, [note(7, 1, 61)]);
  assert.deepEqual(log.splice(-3).map(e => e[1]), ['start', 'move', 'end']);
  // resize the end to t = 10
  dom.ptr(roll.el, 'pointerdown', X(7.95), Y(61));
  dom.ptr(roll.el, 'pointermove', X(9.9), Y(61));
  dom.ptr(roll.el, 'pointerup', X(9.9), Y(61));
  assert.deepEqual(clip.notes, [note(7, 3, 61)]);
  assert.deepEqual(log.slice(-1), [['Resize notes', 'end']]);
  // resize the start: the end stays
  dom.ptr(roll.el, 'pointerdown', X(7.05), Y(61));
  dom.ptr(roll.el, 'pointermove', X(8.1), Y(61));
  dom.ptr(roll.el, 'pointerup', X(8.1), Y(61));
  assert.deepEqual(clip.notes, [note(8, 2, 61)]);
  // Alt = no snapping
  dom.ptr(roll.el, 'pointerdown', X(8.5), Y(61), { altKey: true });
  dom.ptr(roll.el, 'pointermove', X(8.75), Y(61), { altKey: true });
  dom.ptr(roll.el, 'pointerup', X(8.75), Y(61), { altKey: true });
  assert.equal(clip.notes[0][0], 8.25);
  // double-click on the note deletes it
  dom.fire(roll.el, 'dblclick', { clientX: X(9), clientY: Y(61) });
  assert.deepEqual(clip.notes, []);
  assert.deepEqual(log.pop(), ['Delete note', 'set']);
});

test('PianoRoll: touch — double-tap adds, a second finger cancels a drag (reverted), long-press opens the menu', () => {
  const { doc, clip, log, roll, X, Y } = rollOf({ clip: { notes: [note(0, 2, 60)] } });
  const t = { pointerType: 'touch' };
  dom.ptr(roll.el, 'pointerdown', X(4.5), Y(62), t);
  dom.ptr(roll.el, 'pointerup', X(4.5), Y(62), t);
  dom.advance(100);
  dom.ptr(roll.el, 'pointerdown', X(4.5), Y(62), t);
  dom.ptr(roll.el, 'pointerup', X(4.5), Y(62), t);
  assert.deepEqual(clip.notes, [note(0, 2, 60), note(4, 1, 62)], 'one grid step long');
  // drag a note, then a second finger lands: the edit is reverted and ended
  dom.ptr(roll.el, 'pointerdown', X(1), Y(60), t);
  dom.ptr(roll.el, 'pointermove', X(5), Y(60), t);
  assert.equal(clip.notes.find(n => n[2] === 60)[0], 4);
  dom.ptr(roll.el, 'pointerdown', X(10), Y(60), Object.assign({ pointerId: 2 }, t));
  assert.equal(clip.notes.find(n => n[2] === 60)[0], 0);
  assert.equal(roll.g, null);
  assert.deepEqual(log.pop()[1], 'end');
  // context menu (right-click / long-press) lists every action; a note under it gets selected
  dom.fire(roll.el, 'contextmenu', { clientX: X(4.5), clientY: Y(62) });
  const labels = ctxLabels(doc);
  for (const l of ['Copy', 'Paste', 'Chop', 'Conform to Scale', 'Legato', 'Mute (0)', 'Quantize', 'Reverse', 'Scale Time 50% (/)', 'Double Entire Clip', 'Scale Entire Clip 50%',
    'Grid', 'Fold', 'Note Preview', 'Zoom', 'Wrap Clip to Begin Here']) assert.ok(labels.some(x => x.startsWith(l)), l);
  assert.deepEqual(roll.sel, [1]);
});

test('PianoRoll: marquee and Shift selection, keyboard shortcuts, clipboard (notes and time range)', () => {
  const { clip, roll, X, Y } = rollOf({ clip: { notes: [note(0, 2, 60), note(2, 2, 62), note(4, 2, 64), note(8, 2, 60)] } });
  // marquee over the first three notes
  dom.ptr(roll.el, 'pointerdown', X(0.5) - 4, Y(65));
  dom.ptr(roll.el, 'pointermove', X(5), Y(59));
  dom.ptr(roll.el, 'pointerup', X(5), Y(59));
  assert.deepEqual(roll.sel, [0, 1, 2]);
  // Shift-press toggles a note
  dom.ptr(roll.el, 'pointerdown', X(9), Y(60), { shiftKey: true });
  dom.ptr(roll.el, 'pointerup', X(9), Y(60), { shiftKey: true });
  assert.deepEqual(roll.sel, [0, 1, 2, 3]);
  dom.ptr(roll.el, 'pointerdown', X(1), Y(60), { shiftKey: true });
  dom.ptr(roll.el, 'pointerup', X(1), Y(60), { shiftKey: true });
  assert.deepEqual(roll.sel.map(i => clip.notes[i]), [note(2, 2, 62), note(4, 2, 64), note(8, 2, 60)]);
  // a tap on empty space clears the selection
  dom.ptr(roll.el, 'pointerdown', X(20), Y(70));
  dom.ptr(roll.el, 'pointerup', X(20), Y(70));
  assert.deepEqual(roll.sel, []);
  // keys: ⌘/Ctrl-A, ↑ (semitone), Shift ↓ (octave), → (grid step), Shift → (longer)
  const K = (k, o) => dom.key(roll.el, k, Object.assign({ ctrlKey: false, metaKey: false }, o));
  K('a', { ctrlKey: true, metaKey: true });
  assert.equal(roll.sel.length, 4);
  K('ArrowUp');
  assert.deepEqual(clip.notes.map(n => n[2]), [61, 63, 65, 61]);
  K('ArrowDown', { shiftKey: true });
  assert.deepEqual(clip.notes.map(n => n[2]), [49, 51, 53, 49]);
  K('ArrowRight');
  assert.deepEqual(clip.notes.map(n => n[0]), [1, 3, 5, 9]);
  K('ArrowRight', { shiftKey: true });
  assert.deepEqual(clip.notes.map(n => n[1]), [3, 3, 3, 3]);
  K('ArrowLeft', { shiftKey: true });
  K('ArrowLeft');
  K('ArrowUp', { shiftKey: true });
  K('ArrowDown');
  K('ArrowDown');
  assert.deepEqual(clip.notes, [note(0, 2, 59), note(2, 2, 61), note(4, 2, 63), note(8, 2, 59)]);
  // copy / paste of notes: pasted after the copied span, selected
  roll.setSel([0, 1], clip.notes);
  K('c', { ctrlKey: true, metaKey: true });
  K('v', { ctrlKey: true, metaKey: true });
  assert.equal(clip.notes.length, 6);
  assert.deepEqual(roll.sel.map(i => clip.notes[i]), [note(4, 2, 59), note(6, 2, 61)]);
  // ⌘D duplicates, ⌫ deletes, Escape clears
  K('d', { ctrlKey: true, metaKey: true });
  assert.deepEqual(roll.sel.map(i => clip.notes[i]), [note(8, 2, 59), note(10, 2, 61)]);
  K('Backspace');
  assert.equal(clip.notes.length, 6);
  // 0 mutes / unmutes
  roll.setSel([0], clip.notes);
  K('0');
  assert.equal(clip.notes[0][4], 1);
  K('Escape');
  assert.deepEqual(roll.sel, []);
  // time range (ruler drag), copy, paste overwrites and splits
  clip.notes = [note(0, 8, 60), note(2, 1, 62)];
  roll.refresh();
  dom.ptr(roll.el, 'pointerdown', X(2), 6);
  dom.ptr(roll.el, 'pointermove', X(4), 6);
  dom.ptr(roll.el, 'pointerup', X(4), 6);
  assert.deepEqual(roll.range, [2, 4]);
  assert.ok(roll.command('copy'));
  roll.range = [6, 8];
  assert.ok(roll.command('paste'));
  assert.deepEqual(clip.notes, [note(0, 6, 60), note(2, 1, 62), note(6, 2, 60), note(6, 1, 62)]);
  assert.ok(roll.command('delete'));
  assert.deepEqual(clip.notes, [note(0, 6, 60), note(2, 1, 62)]);
  // a tap in the ruler clears the range and sets the paste cursor
  dom.ptr(roll.el, 'pointerdown', X(12), 6);
  dom.ptr(roll.el, 'pointerup', X(12), 6);
  assert.equal(roll.range, null);
  assert.equal(roll.cursor, 12);
});

test('PianoRoll commands equal the seq-core note operations; whole-clip operations; Wrap Clip to Begin Here', () => {
  const N = [note(0, 2, 60), note(3, 1, 64), note(6, 3, 67)];
  const mk = () => rollOf({ clip: { notes: N.map(n => n.slice()) }, o: { key: () => 0, scale: () => 0 } });
  const all = [0, 1, 2];
  const cases = [
    ['chop', undefined, () => core.noteOps.chop(N, all, 1).list],
    ['legato', undefined, () => core.noteOps.legato(N, all).list],
    ['quantize', 0.5, () => core.noteOps.quantize(N, all, 1, 0.5).list],
    ['reverse', undefined, () => core.noteOps.reverse(N, all).list],
    ['scaleTime', 2, () => core.noteOps.scaleTime(N, all, 2).list],
    ['mute', undefined, () => core.noteOps.mute(N, all).list],
  ];
  for (const [name, arg, ref] of cases) {
    const { clip, roll } = mk();
    assert.ok(roll.command(name, arg), name);
    assert.deepEqual(clip.notes, ref(), name);
  }
  // conform needs a KEY
  let r = mk();
  r.clip.notes = [note(0, 1, 61), note(1, 1, 66)];
  assert.ok(r.roll.command('conform'));
  assert.deepEqual(r.clip.notes.map(n => n[2]), [60, 65]);
  r = rollOf({ clip: { notes: [note(0, 1, 61)] } });
  assert.equal(r.roll.command('conform'), false);
  // moves need a selection; scaleTime only 0.5 / 2
  r = mk();
  assert.equal(r.roll.command('up'), false);
  assert.equal(r.roll.command('scaleTime', 3), false);
  // double entire clip, scale entire clip
  r = rollOf({ clip: { len: 16, notes: [note(0, 2, 60)] } });
  assert.ok(r.roll.command('double'));
  assert.deepEqual([r.clip.len, r.clip.notes], [32, [note(0, 2, 60), note(16, 2, 60)]]);
  assert.ok(r.roll.command('scaleClip', 0.5));
  assert.deepEqual([r.clip.len, r.clip.notes], [16, [note(0, 1, 60), note(8, 1, 60)]]);
  // wrap at the offset marker: off → start
  r = rollOf({ clip: { len: 16, off: 4, notes: [note(0, 2, 60), note(4, 2, 62), note(3, 2, 64)] } });
  assert.ok(r.roll.command('wrapHere'));
  assert.deepEqual(r.clip.notes, core.wrapAt([note(0, 2, 60), note(4, 2, 62), note(3, 2, 64)], 0, 4, 16));
  assert.equal(r.clip.off, 0);
  assert.equal(r.roll.command('wrapHere'), false);
});

test('PianoRoll: ruler flags (length, start, offset with its quantize) and the offset-marker menu', () => {
  const { doc, clip, roll, X } = rollOf({ zoom: [0.5, 1], clip: { len: 64, off: 0, notes: [note(0, 2, 60)] } });
  // length flag: 64 → 48 (snapped to the grid)
  dom.ptr(roll.el, 'pointerdown', X(64), 8);
  dom.ptr(roll.el, 'pointermove', X(47.6), 8);
  dom.ptr(roll.el, 'pointerup', X(47.6), 8);
  assert.equal(clip.len, 48);
  // offset marker (lower half of the ruler; offQ 1/16), then the start flag (upper half) pushes it
  dom.ptr(roll.el, 'pointerdown', X(0) + 1, 14);
  dom.ptr(roll.el, 'pointermove', X(9.2), 14);
  dom.ptr(roll.el, 'pointerup', X(9.2), 14);
  assert.deepEqual([clip.start, clip.off], [0, 9]);
  clip.offQ = 1;   // 1/8 = 2 sixteenths
  dom.ptr(roll.el, 'pointerdown', X(9), 14);
  dom.ptr(roll.el, 'pointermove', X(12.6), 14);
  dom.ptr(roll.el, 'pointerup', X(12.6), 14);
  assert.equal(clip.off, 12);
  dom.ptr(roll.el, 'pointerdown', X(0), 4);
  dom.ptr(roll.el, 'pointermove', X(16), 4);
  dom.ptr(roll.el, 'pointerup', X(16), 4);
  assert.deepEqual([clip.start, clip.off], [16, 16]);
  // with start = off the upper half takes the start flag, the lower half the marker
  dom.ptr(roll.el, 'pointerdown', X(16), 14);
  dom.ptr(roll.el, 'pointermove', X(20), 14);
  dom.ptr(roll.el, 'pointerup', X(20), 14);
  assert.deepEqual([clip.start, clip.off], [16, 20]);
  // offset-marker menu
  clip.start = 0;
  clip.off = 16;
  roll.refresh();
  dom.fire(roll.el, 'contextmenu', { clientX: X(16), clientY: 8 });
  assert.deepEqual(ctxLabels(doc), ['Wrap Clip to Begin Here', 'Quantize']);
  const q = roll.offItems().find(x => x.label === 'Quantize');
  assert.equal(q.sub[1].checked, true);
  q.sub[3].action();
  assert.equal(clip.offQ, 3);
});

test('PianoRoll kind pat: rows ±1…±16 (+ used rows), event operations, accent, length flag trims, record overlay', () => {
  const doc = dom.fresh(), root = doc.createElement('div');
  doc.body.appendChild(root);
  const pat = { len: 16, ev: [[0, 1, 1, 100, 0], [4, 1, -2, 100, 0], [8, 1, 20, 100, 0]], strum: [], lanes: {}, grid: 2 };
  const roll = new seq.PianoRoll(root, { kind: 'pat', clip: () => pat, edit: fn => fn(pat), grid: () => pat.grid, setGrid: g => { pat.grid = g; } });
  assert.equal(roll.el.getAttribute('aria-label'), 'Pattern graph');
  const rows = roll.view().rows;
  assert.equal(rows.length, 33);
  assert.ok(rows.includes(20) && !rows.includes(0));
  assert.ok(roll.command('grid', 1));
  assert.equal(pat.grid, 1);
  assert.equal(roll.command('fold', 1), false, 'no fold for patterns');
  roll.setSel([0, 1], pat.ev);
  assert.ok(roll.command('up'));
  assert.deepEqual(pat.ev.map(e => e[2]), [2, -1, 20]);
  assert.ok(roll.command('up'));
  assert.deepEqual(pat.ev.map(e => e[2]), [3, 1, 20], '−1 → +1 skips row 0');
  assert.ok(roll.command('accent'));
  assert.deepEqual(pat.ev.map(e => e[4]), [1, 1, 0]);
  assert.equal(roll.command('mute'), false);
  // pasted / moved events beyond the pattern are dropped
  roll.setSel([2], pat.ev);
  assert.ok(roll.command('right'));
  assert.ok(roll.command('right'));
  assert.ok(roll.command('right'));
  assert.ok(roll.command('right'));
  assert.equal(pat.ev.length, 2);
  // record overlay notes are drawn (red) by the clip kind; the pattern kind ignores conform / wrap
  assert.equal(roll.command('conform'), false);
  assert.equal(roll.command('wrapHere'), false);
  roll.destroy();
});

test('PianoRoll: pinch zoom / two-finger pan through wk.zoomPan commit the zoom at the end; wheel scrolls rows', () => {
  const { roll, zoom } = rollOf({ clip: { notes: [note(0, 2, 60)] } });
  const v0 = roll.zpView();
  assert.ok(v0.x1 > v0.x0 && v0.y1 > v0.y0);
  roll.zpSet({ x0: 0, x1: (v0.x1 - v0.x0) / 2, y0: v0.y0, y1: v0.y1 }, 'move');
  assert.deepEqual(zoom(), [1, 1], 'not committed while moving');
  assert.equal(roll.view().pps, 32);
  roll.zpSet({ x0: 0, x1: (v0.x1 - v0.x0) / 2, y0: v0.y0, y1: v0.y1 }, 'end');
  assert.equal(zoom()[0], 2);
  const top = roll.view().top;
  dom.fire(roll.el, 'wheel', { deltaY: 48 });
  assert.equal(roll.view().top, top + 48);
});

test('ResizeObserver: the roll and the lanes keep their size between resizes (no layout read per repaint); hidden boxes are not drawn', () => {
  const ros = [];
  const prev = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; this.els = []; ros.push(this); } observe(el) { this.els.push(el); } disconnect() { this.off = true; } };
  try {
    const { s, kit, T, root } = mount();
    s.clip.clips[0].notes = [note(0, 2, 60)];
    const clip = new seq.ClipPage(root, kit), R = clip.roll, L = clip.lanes;
    const roRoll = ros.find(o => o.els.includes(R.el)), roLane = ros.find(o => o.els.includes(L.cv));
    assert.ok(roRoll && roLane);
    dom.place(R.el, 0, 0, 700, 300);
    dom.place(L.cv, 0, 0, 700, 72);
    roRoll.cb([{ contentRect: { width: 700, height: 300 } }]);
    roLane.cb([{ contentRect: { width: 700, height: 72 } }]);
    T.paint();
    assert.equal(R.view().w, 700 - KEYW);
    // a layout change without a resize notification keeps the cached size; the notification re-measures and redraws
    dom.place(R.el, 0, 0, 900, 300);
    assert.equal(R.view().w, 700 - KEYW);
    const n0 = R.cv.getContext('2d').calls.length;
    roRoll.cb([{ contentRect: { width: 900, height: 300 } }]);
    assert.equal(R.view().w, 900 - KEYW);
    assert.ok(R.cv.getContext('2d').calls.length > n0, 'redrawn at the new size');
    // hidden (0 × 0): nothing is drawn until the box has a size again
    const n1 = R.cv.getContext('2d').calls.length;
    dom.place(R.el, 0, 0, 0, 0);
    roRoll.cb([{ contentRect: { width: 0, height: 0 } }]);
    assert.equal(R.cv.getContext('2d').calls.length, n1);
    dom.place(L.cv, 0, 0, 500, 72);
    assert.equal(L.size().w, 700);
    roLane.cb([{ contentRect: { width: 500, height: 72 } }]);
    assert.equal(L.size().w, 500);
    clip.destroy();
    assert.ok(roRoll.off && roLane.off, 'disconnected on destroy');
  } finally {
    if (prev === undefined) delete globalThis.ResizeObserver; else globalThis.ResizeObserver = prev;
  }
});

/* ================================================================ review fixes (round 2) */

test('EDIT ALL by Alt applies to the Alt gesture only: a later plain wheel step or key edits the selected slot / clip', () => {
  const { s, kit, T, root } = mount();
  const arp = new seq.ArpPage(root, kit);
  T.paint();
  const A = s.arp;
  const latch = lbl(arp.sec.playback, 'LATCH')[0];
  dom.ptr(latch, 'pointerdown', 1, 1, { altKey: true });
  dom.ptr(latch, 'pointerup', 1, 1, { altKey: true });
  dom.fire(latch, 'click', { altKey: true });
  assert.deepEqual(A.slots.map(x => x.latch), Array(12).fill(1), 'Alt-click: every slot');
  const gate = byDest(arp.el, 'arp.gate', 'wk-knob')[0], g0 = A.slots.map(x => x.n.gate);
  dom.fire(gate, 'wheel', { deltaY: -100 });
  const changed = A.slots.map((x, j) => (x.n.gate !== g0[j] ? j : -1)).filter(j => j >= 0);
  assert.deepEqual(changed, [0], 'a plain wheel step: the selected slot only');
  // an Alt wheel step edits every slot; the next plain key edit one again
  dom.fire(gate, 'wheel', { deltaY: -100, altKey: true });
  assert.equal(new Set(A.slots.map(x => x.n.gate)).size, 1);
  dom.key(gate, 'Home');
  assert.deepEqual(A.slots.map(x => x.n.gate).filter(g => g === 0).length, 1);
  arp.destroy();
  // CLIP page: an Alt-drag in the roll (free move) or an Alt-click on FOLD does not arm EDIT ALL for a later wheel edit
  const m = mount();
  m.s.clip.clips[0].notes = [note(0, 2, 60)];
  const clip = new seq.ClipPage(m.root, m.kit);
  m.T.paint();
  const fold = dom.one(clip.sec.roll, 'sx-fold');
  dom.ptr(fold, 'pointerdown', 1, 1, { altKey: true });
  dom.fire(fold, 'click', { altKey: true });
  const trans = byDest(clip.el, 'clip.trans', 'wk-knob')[0], t0 = m.s.clip.clips.map(c => c.n.trans);
  dom.fire(trans, 'wheel', { deltaY: -100 });
  assert.deepEqual(m.s.clip.clips.map((c, j) => (c.n.trans !== t0[j] ? j : -1)).filter(j => j >= 0), [0]);
  clip.destroy();
});

test('touch: the slot drag-export is decided per gesture (a touch press never starts an HTML drag); the touch CSS also applies under .wk-touch / .sx-touch', () => {
  const { kit, root, doc } = mount();
  // (wk's touch mode is process-wide: once an earlier test sent a touch pointer, even a mouse press is not a drag)
  const clip = new seq.ClipPage(root, kit), S = clip.slots.slots[0].el, mouseDrag = wk.touchMode() ? 'false' : 'true';
  assert.equal(S.getAttribute('draggable'), mouseDrag);
  dom.ptr(S, 'pointerdown', 1, 1, { pointerType: 'touch' });
  assert.equal(S.getAttribute('draggable'), 'false');
  let dragged = 0;
  const dt = { setData: () => { dragged++; }, effectAllowed: '' };
  const e1 = dom.fire(S, 'dragstart', { dataTransfer: dt });
  assert.ok(e1.defaultPrevented && dragged === 0, 'no drag from a touch long-press');
  dom.ptr(S, 'pointerdown', 1, 1, { pointerType: 'mouse' });
  assert.equal(S.getAttribute('draggable'), mouseDrag);
  const e2 = dom.fire(S, 'dragstart', { dataTransfer: dt });
  assert.equal(e2.defaultPrevented, mouseDrag === 'false');
  const css = dom.all(doc.head || doc.documentElement).find(n => n.id === 'sx-seq-css').textContent;
  for (const sel of ['.wk-touch .sx-seqbtn', '.sx-touch .sx-seqbtn', '.wk-touch .sx-slot', '.sx-touch .sx-roll', '.wk-touch .sx-lanecv']) assert.ok(css.includes(sel), sel);
  clip.destroy();
});

test('PianoRoll: the Keyboard shortcuts preference turns the roll keys off; Quantize is Q (⌘Q quits macOS browsers)', () => {
  let keys = true;
  const { clip, roll } = rollOf({ clip: { notes: [note(0.4, 1, 60), note(4.3, 1, 62)] }, o: { keys: () => keys } });
  roll.command('selectAll');
  keys = false;
  roll.refresh();
  assert.ok(roll.el.classList.contains('sx-nokeys'), 'no focus ring');
  const e = dom.key(roll.el, 'ArrowUp');
  assert.equal(e.defaultPrevented, false);
  assert.deepEqual(clip.notes.map(n => n[2]), [60, 62]);
  dom.key(roll.el, 'a', { metaKey: true, ctrlKey: true });
  keys = true;
  roll.refresh();
  assert.ok(!roll.el.classList.contains('sx-nokeys'));
  dom.key(roll.el, 'q');
  assert.deepEqual(clip.notes.map(n => n[0]), [0, 4]);
  assert.ok(roll.menuItems().some(it => it.label === 'Quantize (Q)'));
  // the CLIP page passes the panel preference
  const m = mount();
  const page = new seq.ClipPage(m.root, m.kit);
  assert.equal(page.roll.keysOn(), true, 'on by default');
  page.destroy();
});

test('Lock Module (⋯) through serum-core setModuleLock; the title module menu gets the extra items; LENGTH fields reset to the schema defaults', () => {
  const { s, kit, T, root } = mount();
  const panels = [];
  const kit2 = Object.freeze(Object.assign({}, kit, { panel: (...a) => { const P = kit.panel(...a); panels.push(P); return P; } }));
  const arp = new seq.ArpPage(root, kit2), clip = new seq.ClipPage(root, kit2);
  assert.deepEqual(panels.map(P => typeof P.items), ['function', 'function']);
  assert.deepEqual(panels[0].items().filter(x => !x.sep).map(x => x.label), ['MIDI Input Trigger Octave', 'Show Pattern Names']);
  assert.deepEqual(panels[1].items().map(x => x.label), ['MIDI Input Trigger Octave']);
  s.locks.unp = ['arp.gate'];
  clip.lockItem('clip').action();
  arp.lockItem('arp').action();
  const ref = core.normalizeSerum(core.defaultSerum());
  core.setModuleLock(ref, 'clip', true);
  core.setModuleLock(ref, 'arp', true);
  assert.deepEqual(s.locks.mod, ref.locks.mod, 'MODULE_NAMES order');
  arp.lockItem('arp').action();
  assert.ok(!s.locks.mod.includes('arp'));
  assert.ok(!s.locks.unp.includes('arp.gate'), 'unlocking drops the per-control unlocks');
  // LENGTH resets: a clip to 4 bars (64), a pattern to 1 bar (16)
  T.paint();
  s.clip.clips[0].len = 8;
  T.paint();
  const lenC = dom.byCls(clip.sec.settings, 'wk-nb').find(n => dom.all(n).some(c => c.textContent === 'LENGTH'));
  dom.key(lenC, 'Delete');
  assert.equal(s.clip.clips[0].len, core.defaultClipSlot().len);
  s.arp.slots[0].shape = 1;
  arp.openPattern();
  s.arp.slots[0].pat.len = 5;
  arp.patEd.refresh();
  const lenP = dom.byCls(arp.patEd.el, 'wk-nb').find(n => dom.all(n).some(c => c.textContent === 'LENGTH'));
  dom.key(lenP, 'Delete');
  assert.equal(s.arp.slots[0].pat.len, 16);
  arp.destroy();
  clip.destroy();
});

test('PianoRoll: a drag keeps the geometry of its start — vertical one-note drag, Select All drag, folded rows, length flag at the right scroll limit', () => {
  // one note, never scrolled: one row up stays one row up
  {
    const { clip, roll, X, Y } = rollOf({ clip: { notes: [note(0, 4, 60)] } });
    const y = Y(60), x = X(1);
    dom.ptr(roll.el, 'pointerdown', x, y);
    const trace = [];
    for (const dy of [3, 6, 9, 12, 13, 12, 13, 12, 13, 12]) { dom.ptr(roll.el, 'pointermove', x, y - dy); trace.push(clip.notes[0][2]); }
    dom.ptr(roll.el, 'pointerup', x, y - 12);
    assert.deepEqual(trace.slice(-6), [61, 61, 61, 61, 61, 61]);
    assert.equal(clip.notes[0][2], 61);
  }
  // Select All, drag one row up
  {
    const { clip, roll, X, Y } = rollOf({ clip: { notes: [note(0, 4, 60), note(8, 4, 64), note(16, 4, 67), note(24, 4, 72)] } });
    roll.command('selectAll');
    const y = Y(60), x = X(1);
    dom.ptr(roll.el, 'pointerdown', x, y);
    for (const dy of [4, 8, 12, 13, 12, 13, 12, 13]) dom.ptr(roll.el, 'pointermove', x, y - dy);
    dom.ptr(roll.el, 'pointerup', x, y - 12);
    assert.deepEqual(clip.notes.map(n => n[2]), [61, 65, 68, 73]);
  }
  // Fold = used notes: drag 64 up one folded row (to 67) and hold — no flipping
  {
    const { clip, roll, X, Y } = rollOf({ clip: { notes: [note(0, 4, 60), note(8, 4, 64), note(16, 4, 67), note(24, 4, 72)] } });
    roll.command('fold', 1);
    const y = Y(64), x = X(9);
    dom.ptr(roll.el, 'pointerdown', x, y);
    const trace = [];
    for (const dy of [4, 8, 12, 13, 12, 13, 12]) { dom.ptr(roll.el, 'pointermove', x, y - dy); trace.push(clip.notes[1][2]); }
    dom.ptr(roll.el, 'pointerup', x, y - 12);
    assert.deepEqual(trace.slice(2), [67, 67, 67, 67, 67]);
  }
  // length flag dragged one sixteenth left while the roll is scrolled to its right end, then held
  {
    const { clip, roll, X } = rollOf({ clip: { len: 64, notes: [note(0, 4, 60)] } });
    roll.t0 = 1e9;
    roll.refresh();
    const x = X(64);
    dom.ptr(roll.el, 'pointerdown', x, 4);
    const trace = [];
    for (const dx of [-6, -10, -16, -17, -16, -17, -16, -17]) { dom.ptr(roll.el, 'pointermove', x + dx, 4); trace.push(clip.len); }
    dom.ptr(roll.el, 'pointerup', x - 16, 4);
    assert.deepEqual(trace.slice(2), [63, 63, 63, 63, 63, 63]);
  }
});

test('PianoRoll: a time range and a note selection exclude each other; Cut cuts what Copy copied; lane edits keep the selection', () => {
  const { clip, roll, X, Y } = rollOf({ clip: { notes: [note(0, 2, 60), note(4, 2, 62), note(8, 2, 64), note(12, 2, 65)] } });
  roll.setSel([0], clip.notes);
  roll.range = [8, 16];
  dom.key(roll.el, 'x', { metaKey: true, ctrlKey: true });
  assert.deepEqual(clip.notes.map(n => n[2]), [60, 62], 'the range was copied and deleted');
  roll.cursor = 32;
  roll.range = null;
  roll.setSel([], clip.notes);
  dom.key(roll.el, 'v', { metaKey: true, ctrlKey: true });
  assert.deepEqual(clip.notes.filter(n => n[0] >= 32).map(n => n[2]), [64, 65]);
  // a ruler drag clears the note selection; pressing a note clears the range
  roll.setSel([0], clip.notes);
  dom.ptr(roll.el, 'pointerdown', X(16), 6);
  dom.ptr(roll.el, 'pointermove', X(24), 6);
  dom.ptr(roll.el, 'pointerup', X(24), 6);
  assert.deepEqual(roll.range, [16, 24]);
  assert.deepEqual(roll.selNow(), []);
  dom.ptr(roll.el, 'pointerdown', X(4.5), Y(62));
  dom.ptr(roll.el, 'pointerup', X(4.5), Y(62));
  assert.equal(roll.range, null);
  assert.deepEqual(roll.selNow(), [1]);
  // velocity / expression changes keep the selection (time, length and pitch key it)
  roll.command('selectAll');
  clip.notes[2][3] = 30;
  clip.notes[1][5] = 0.9;
  roll.refresh();
  assert.deepEqual(roll.selNow(), [0, 1, 2, 3]);
  roll.command('up');
  assert.deepEqual(clip.notes.map(n => n[2]), [61, 63, 65, 66]);
});

test('LaneView: a chord shares one bar — a drag edits the selected notes of it, else all of it', () => {
  const { s, kit, T, root } = mount();
  const c = s.clip.clips[0];
  c.notes = [note(0, 4, 60), note(0, 4, 64), note(0, 4, 67), note(4, 4, 62)];
  const page = new seq.ClipPage(root, kit), R = page.roll, L = page.lanes;
  dom.place(R.el, 0, 0, 800, 300);
  dom.place(L.cv, 0, 400, 800, 72);
  T.paint();
  const v = R.view(), x = KEYW + (0 - v.t0) * v.pps + 2;
  R.setSel([1], c.notes);
  dom.ptr(L.cv, 'pointerdown', x, 420);
  dom.ptr(L.cv, 'pointermove', x, 419);
  dom.ptr(L.cv, 'pointerup', x, 419);
  const vel = Math.round(1 + 126 * (1 - (19 - 4) / 64));
  assert.deepEqual(c.notes.map(n => n[3]), [100, vel, 100, 100]);
  assert.deepEqual(R.selNow(), [1], 'still selected after the lane edit');
  R.setSel([], c.notes);
  dom.ptr(L.cv, 'pointerdown', x, 460);
  dom.ptr(L.cv, 'pointerup', x, 460);
  assert.deepEqual(c.notes.map(n => n[3]).slice(0, 3), [c.notes[0][3], c.notes[0][3], c.notes[0][3]]);
  assert.ok(c.notes[0][3] < 40 && c.notes[3][3] === 100);
  page.destroy();
});

test('note limits: the bank budget refuses additions with a notice; Double / Paste Clip / Load Clip respect the room', () => {
  const { s, kit, T, root } = mount();
  for (const c of s.clip.clips.slice(0, 4)) { c.len = 1024; c.notes = Array.from({ length: 1024 }, (_, i) => note(i, 0.5, 60)); }
  s.clip.sel = 4;
  const page = new seq.ClipPage(root, kit), R = page.roll;
  dom.place(R.el, 0, 0, 1000, 300);
  T.paint();
  const v = R.view(), row = v.rows.indexOf(60), y = RULER + (v.rows.length - 1 - row) * v.rowH - v.top + 3;
  assert.equal(R.dbl({ x: KEYW + 8 * v.pps + 2, y }), false);
  assert.deepEqual(s.clip.clips[4].notes, []);
  assert.deepEqual(T.log.filter(e => e[0] === 'notify').pop(), ['notify', 'At most 4096 notes per clip bank']);
  // Double Entire Clip beyond 1024 notes is refused
  s.clip.clips[3].notes = s.clip.clips[3].notes.slice(0, 600);
  s.clip.clips[3].len = 512;
  s.clip.sel = 3;
  T.paint();
  assert.equal(R.command('double'), false);
  assert.equal(s.clip.clips[3].notes.length, 600);
  assert.equal(s.clip.clips[3].len, 512);
  assert.deepEqual(T.log.filter(e => e[0] === 'notify').pop(), ['notify', 'At most 1024 notes per clip']);
  // Paste Clip into a slot whose room is smaller: cut to the room, with a notice
  item(page.slotItems(0), 'Copy Clip').action();
  item(page.slotItems(5), 'Paste Clip').action();
  assert.equal(s.clip.clips[5].notes.length, 4096 - 3 * 1024 - 600);
  assert.match(T.log.filter(e => e[0] === 'notify').pop()[1], /^At most 4096 notes per clip bank: the clip was cut to 424 notes/);
  const total = s.clip.clips.reduce((a, c) => a + c.notes.length, 0);
  assert.equal(total, 4096);
  assert.equal(core.normalizeClip(s.clip).clips[5].notes.length, 424, 'nothing is lost on reload');
  page.destroy();
});

test('pattern LENGTH: a drag shorter and back keeps the events; a cancelled flag drag puts length, events and strums back', () => {
  const { s, kit, T, root, doc } = mount();
  const sl = s.arp.slots[0];
  sl.shape = 1;
  sl.pat.len = 16;
  sl.pat.ev = [[0, 1, 1, 100, 0], [4, 1, 2, 100, 0], [8, 1, 3, 100, 0], [12, 1, 4, 100, 1]];
  sl.pat.strum = [[8, 0.5]];
  const arp = new seq.ArpPage(root, kit);
  T.paint();
  arp.openPattern();
  const roll = arp.patEd.roll;
  dom.place(roll.el, 0, 0, KEYW + 16 * 16 + 200, 300);
  roll.refresh();
  const v = roll.view(), X = t => KEYW + (t - v.t0) * v.pps;
  dom.ptr(roll.el, 'pointerdown', X(16), 4);
  dom.ptr(roll.el, 'pointermove', X(4), 4);
  assert.deepEqual(sl.pat.ev.map(e => e[0]), [0]);
  dom.ptr(roll.el, 'pointermove', X(16), 4);
  dom.ptr(roll.el, 'pointerup', X(16), 4);
  assert.equal(sl.pat.len, 16);
  assert.deepEqual(sl.pat.ev.map(e => e[0]), [0, 4, 8, 12]);
  assert.deepEqual(sl.pat.strum, [[8, 0.5]]);
  // a second finger cancels the flag drag: everything as at its start
  dom.ptr(roll.el, 'pointerdown', X(16), 4, { pointerId: 5, pointerType: 'touch' });
  dom.ptr(roll.el, 'pointermove', X(8), 4, { pointerId: 5, pointerType: 'touch' });
  assert.equal(sl.pat.len, 8);
  dom.ptr(roll.el, 'pointerdown', 200, 100, { pointerId: 6, pointerType: 'touch' });
  assert.equal(sl.pat.len, 16);
  assert.deepEqual(sl.pat.ev.map(e => e[0]), [0, 4, 8, 12]);
  assert.deepEqual(sl.pat.strum, [[8, 0.5]]);
  // the LENGTH field: a drag down to one beat and back within one gesture keeps the events as well
  const lenP = dom.byCls(arp.patEd.el, 'wk-nb').find(n => dom.all(n).some(c => c.textContent === 'LENGTH'));
  dom.ptr(lenP, 'pointerdown', 10, 100);
  dom.ptr(lenP, 'pointermove', 10, 140);
  assert.equal(sl.pat.len, 4);
  assert.deepEqual(sl.pat.ev.map(e => e[0]), [0]);
  dom.ptr(lenP, 'pointermove', 10, 100);
  dom.ptr(lenP, 'pointerup', 10, 100);
  assert.equal(sl.pat.len, 16);
  assert.deepEqual(sl.pat.ev.map(e => e[0]), [0, 4, 8, 12]);
  assert.deepEqual(sl.pat.strum, [[8, 0.5]]);
  void doc;
  arp.destroy();
});

test('laneWrite: a chain of writes keeps every written point (macro-knob recording); the rhythm strips never read the layout per repaint', () => {
  let lane = null, xp = 0;
  const xs = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50], ys = [0.2, 0.8, 0.2, 0.8, 0.2, 0.8, 0.2, 0.8, 0.5];
  xs.forEach((x, i) => { lane = seq.laneWrite(lane, i ? xp : x, x, ys[i]); xp = x; });
  for (let i = 0; i < xs.length; i++) assert.ok(Math.abs(seq.laneValueAt(lane, xs[i]) - ys[i]) < 1e-6, 'x ' + xs[i]);
  // rewriting over a written stretch replaces it
  const L2 = seq.laneWrite(lane, 0.15, 0.4, 0.6);
  assert.ok(Math.abs(seq.laneValueAt(L2, 0.3) - (0.8 + (0.6 - 0.8) * (0.3 - 0.15) / 0.25)) < 1e-6);
  assert.deepEqual(L2.filter(p => p[0] > 0.15 && p[0] < 0.4), []);
  // rhythm strips: sized by a ResizeObserver, measured once at most
  const prev = globalThis.ResizeObserver, ros = [];
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; this.els = []; ros.push(this); } observe(el) { this.els.push(el); } disconnect() {} };
  try {
    const { s, kit, T, root } = mount();
    s.clip.clips[0].notes = [note(0, 2, 60)];
    const page = new seq.ClipPage(root, kit), S = page.slots.slots;
    const ro = ros.find(o => o.els.includes(S[0].cv));
    assert.ok(ro);
    let reads = 0;
    for (const x of S) { const g = x.cv.getBoundingClientRect.bind(x.cv); x.cv.getBoundingClientRect = () => { reads++; return g(); }; }
    ro.cb([{ contentRect: { width: 50, height: 4 } }]);
    for (let i = 0; i < 10; i++) { s.clip.clips[0].notes[0][0] = i; T.paint(); }
    assert.equal(reads, 0);
    assert.equal(S[0].cv.width, 50);
    page.destroy();
  } finally {
    if (prev === undefined) delete globalThis.ResizeObserver; else globalThis.ResizeObserver = prev;
  }
});

test('Record EXTEND keeps lane automation at its time when the clip grows; a recording that recorded nothing gives the length back', () => {
  const { s, kit, T, root } = mount({ host: { onInput: () => {} } });
  const c = s.clip.clips[0];
  c.len = 16;
  c.lanes.m2 = [[0, 0.2, 0], [0.5, 0.8, 0], [1, 0.4, 0]];
  s.clip.rec.mode = 1;
  const k = 120 / 60000 * 4;
  clock(0);
  try {
    const clip = new seq.ClipPage(root, kit);
    T.setSnap(snapSeq({ 4: 1, 5: 0 }));
    clip.record(true);
    for (let t = 33; t <= 1600; t += 33) { clock(t); T.setSnap(snapSeq({ 4: 1, 5: t * k })); }
    assert.equal(c.len, 32);
    assert.ok(Math.abs(seq.laneValueAt(c.lanes.m2, 4 / 32) - 0.5) < 1e-6, 'sixteenth 4 keeps its value');
    assert.ok(Math.abs(seq.laneValueAt(c.lanes.m2, 8 / 32) - 0.8) < 1e-6);
    assert.ok(Math.abs(seq.laneValueAt(c.lanes.m2, 24 / 32) - 0.4) < 1e-6, 'the new bar holds the end value');
    clip.finishRecord();
    assert.equal(c.len, 16, 'nothing recorded: the length it had');
    assert.deepEqual(c.lanes.m2, [[0, 0.2, 0], [0.5, 0.8, 0], [1, 0.4, 0]]);
    clip.destroy();
  } finally { clock(null); }
});
