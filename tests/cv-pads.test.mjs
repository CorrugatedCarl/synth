import './v8-guard.mjs';
// cv-pads.js (IMPL-8 §1–§10, §15.6; lane U) on tests/wk-dom.mjs with a stub host (main.js's deps faked): the body at 4 × 4 / 8 × 8 /
// 1 × 1 (the grid element = gridOf's box, positions vs pads-core footprint, the cells), playing through the cv-keys bed (two
// pointers on two pads = two hits; one pad two pointers = two hits, one off; velocity by height; a fixed velocity), the
// [data-gesture="music"] zones (each pad, never the container, the footer or the body), Edit mode on [data-pads-edit] (never
// [data-cv-edit]; taps select, play nothing; the bed back on leaving), a mod pad's jack anchor (a child of the pad, never the pad),
// destroy → every off, the keyboard (arrows, Space held, Escape), the inspector (normPads-valid records, one History step per
// gesture, Modulation off with rows → asks, drops them in the same step), Grid… (sizes vs footprint, the outline), lights (≤ 1
// paint a frame: a burst of 50 → one flush; the monitor's bits at the heard time, live input notes, roll playback), the DOM
// budget (D6, the whole module through cv-module), the learn UI hidden without Web MIDI; the host: reference counts per (track,
// note) over pads / pointers / keys / hardware, every D9 path (destroy, release(), release({ hw }) resets the counts, a mapping
// edit while held, a pad / module / track deleted, a hardware note-off, a port gone), latch, the toggle, mod posts (a press's and
// a release's at once, pressure ≤ once a frame), hardware echo bytes, midiIn's swallow rules; cv-module / cv-cables with a Pads
// device entry (its jacks, the hide flag, the pad-coloured mod cable, the note cable to the instrument's edge).
// Never a fake-DOM node into assert (a safe wrapper below refuses one).
// Run alone: node --max-old-space-size=2048 --test tests/cv-pads.test.mjs
import test from 'node:test';
import assertBase from 'node:assert/strict';
import * as C from '../cv-pads.js?v=9';
import * as PC from '../pads-core.js?v=9';
import * as DC from '../drum-core.js?v=9';
import * as M from '../cv-module.js?v=9';
import * as CB from '../cv-cables.js?v=9';
import * as MODS from '../cv-mods.js?v=9';
import * as CD from '../cv-drum.js?v=9';
import * as wk from '../wk.js?v=9';
import { fresh, raf, all, byCls, ptr, fire, key, place, layout, El, Ev } from './wk-dom.mjs';

// the safe assert: a fake-DOM node in an assertion throws at once (AssertionError would walk the cyclic fake DOM)
const assert = new Proxy(assertBase, {
  get(t, k) {
    const f = t[k];
    if (typeof f !== 'function') return f;
    return (...a) => { for (const x of a.slice(0, 2)) if (x instanceof El) throw new Error('a DOM node passed to assert.' + String(k)); return f.apply(t, a); };
  },
});
const range = n => Array.from({ length: n }, (_, i) => i);
const dev = (model, more) => Object.assign({ kind: 'synth', model }, more || {});
// an 808 (trk_1), a Juno (trk_2), a 606 (trk_3)
function tracks() {
  return [
    { id: 'trk_1', name: 'Drums', prim: 'i1', dev: { i1: dev('tr808', { drum: DC.normDrum(undefined) }), out: { kind: 'out' } }, notes: [], mods: [] },
    { id: 'trk_2', name: 'Juno', prim: 'i1', dev: { i1: dev('juno60'), out: { kind: 'out' } }, notes: [], mods: [] },
    { id: 'trk_3', name: 'Six', prim: 'i1', dev: { i1: dev('tr606', { drum: DC.normDrum(undefined, 'tr606') }) }, notes: [], mods: [] },
  ];
}
// pad helpers
const drum = (s, tr = 'trk_1', more) => Object.assign({ t: [{ k: 'drum', tr, s }] }, more || {});
const note = (n, tr = 'trk_2', more) => Object.assign({ t: [{ k: 'note', tr, n }] }, more || {});
const chord = (root, q, tr = 'trk_2', more) => Object.assign({ t: [{ k: 'chord', tr, root, q }] }, more || {});
function mod44(pads, o) { const p = new Array(64).fill(null); for (const [i, x] of Object.entries(pads || {})) p[+i] = x; return Object.assign({ id: 'pd1', rows: 4, cols: 4, pads: p }, o || {}); }

/** The stub host + one body: a log of every dep call. o: { pads (the module list), midi, live, extra deps } */
function setup(o = {}) {
  const d = fresh();
  raf.install();
  const P = { tracks: tracks().concat(o.extra || []), pads: PC.normPads(o.pads || [mod44()]) };
  const log = [], steps = [], changes = [], subs = { lit: new Map(), in: new Map() }, hw = [], notes = [];
  let tick = NaN, learnRes = null, mon = 0;
  const deps = Object.assign({
    project: () => P,
    noteOn: (tr, n, v, ts, src) => log.push(['on', tr, n, Math.round(v * 127), src]),
    noteOff: (tr, n, ts, src) => log.push(['off', tr, n, src]),
    ctl: (tr, k, v) => log.push(['ctl', tr, k, Math.round(v * 100) / 100]),
    modVal: (src, v) => log.push(['mval', src, Math.round(v * 100) / 100]),
    drumRec: (tr, s, v) => log.push(['rec', tr, s, Math.round(v * 127)]),
    drumLit: (tr, fn) => { subs.lit.set(tr, fn); return () => subs.lit.delete(tr); },
    inputSub: (tr, fn) => { subs.in.set(tr, fn); return () => subs.in.delete(tr); },
    monSync: () => { mon++; },
    heardTick: () => tick,
    step: l => steps.push(l), changed: x => changes.push(x),
    hwOut: (port, b) => hw.push([port, ...b]),
    midiOk: () => !!o.midi, inputs: () => ['Pads A'], outputs: () => ['Pads A'],
    learnPad: () => new Promise(r => { learnRes = r; }),
    raf: f => globalThis.requestAnimationFrame(f),
    modelName: m => ({ tr808: 'TR-808', juno60: 'Juno-60', tr606: 'TR-606' })[m] || m,
    notice: t => notes.push(t), confirm: () => o.confirm !== false,
    rowsOf: src => (o.rows && o.rows[src]) || [],
  }, o.deps || {});
  const H = C.padsHost(deps);
  const B = o.noBody ? null : C.padsBody({ host: H, id: 'pd1', doc: d, track: () => o.cur || 'trk_2', raf: f => globalThis.requestAnimationFrame(f) });
  if (B) { d.body.append(B.el); placeGrid(B); raf.flush(1); }
  return { d, P, H, B, log, steps, changes, subs, hw, notes, deps, setTick: t => { tick = t; }, learn: v => learnRes && learnRes(v), mon: () => mon };
}
// the grid at client (100, 100), 1 px per world px (k 1)
function placeGrid(B) { const g = B.grid, w = parseFloat(g.style.width), h = parseFloat(g.style.height); place(g, 100, 100, w, h); }
// client point of slot i (its centre across; f: the height in the pad from its top)
function at(S, i, f = 0.5) { const M0 = S.H.module('pd1'), G = PC.gridOf(M0.rows, M0.cols, M0.size), r = PC.padRect(G, i); return { x: 100 + r.x + r.w / 2, y: 100 + r.y + r.h * f }; }
const cellOf = (S, i) => S.B.grid.children.find(c => c.getAttribute('data-i') === String(i)) || null;
function down(S, i, id = 1, f = 0.5, o = {}) { const p = at(S, i, f); ptr(cellOf(S, i) || S.B.grid, 'pointerdown', p.x, p.y, Object.assign({ pointerId: id, pointerType: 'touch' }, o)); }
function up(S, i, id = 1, o = {}) { const p = at(S, i); ptr(S.B.grid, 'pointerup', p.x, p.y, Object.assign({ pointerId: id, pointerType: 'touch' }, o)); }
const ons = S => S.log.filter(x => x[0] === 'on'), offs = S => S.log.filter(x => x[0] === 'off');
const attr = (el, k) => (el ? el.getAttribute(k) : undefined);

/* ---------------------------------------------------------------- the pure helpers (H's cvDevices entry) */
test('pure helpers: chipText, moduleSize = footprint, moduleJacks (mod pads inline in slot order, hide outside the grid, the notes jack last), srcLabel, orderOf, defaultsOf, parseNotes', () => {
  const [Mx] = PC.normPads([mod44({ 0: drum('bd', 'trk_1', { mod: { m: 'gate' } }), 9: note(48, 'trk_2', { mod: {}, l: 'Wah' }), 40: note(50, 'trk_2', { mod: { m: 'tog' } }) })]);
  assert.equal(C.chipText(Mx), '4\u00a0×\u00a04');
  assert.deepEqual(C.moduleSize(Mx), { fixed: { w: 352, h: 416 } });
  assert.deepEqual([C.moduleSize({ rows: 8, cols: 8, size: 1 }), C.moduleSize({ rows: 8, cols: 8, size: 2 }), C.moduleSize({ rows: 1, cols: 1, size: 0 })].map(x => [x.fixed.w, x.fixed.h]), [[672, 736], [864, 928], [96, 160]]);
  assert.deepEqual(C.moduleJacks(Mx).map(j => [j.id, j.side, j.kind, j.hide, j.label]), [
    ['p0', 'inline', 'mod', false, 'Pads 1 · Kick out'], ['p9', 'inline', 'mod', false, 'Pads 1 · Wah out'], ['p40', 'inline', 'mod', true, 'Pads 1 · D3 out'], ['notes', 'right', 'note', undefined, 'Pads 1 notes']]);
  assert.deepEqual(C.moduleJacks(PC.newModule('pd2')).map(j => j.id), ['notes'], 'no mod pad: the notes jack alone');
  assert.deepEqual([C.srcLabel([Mx], 'pd1.p9'), C.srcLabel([Mx], 'pd1.p0'), C.srcLabel([Mx], 'pd2.p0'), C.srcLabel([Mx], 'x')], ['Pads 1 · Wah', 'Pads 1 · Kick', '', ''], 'one name everywhere (R1-E): the pad\'s label, else its first target\'s');
  assert.deepEqual([C.orderOf('tr808').cols, C.orderOf('tr808').order.length, C.orderOf('tr606').order.length, C.orderOf('tr909').order.length, C.orderOf('sdsv').cols, C.orderOf('juno60'), C.orderOf(null)], [4, 16, 8, 12, 5, null, null]);
  const T = tracks(), D8 = C.defaultsOf(T[0], (t, k) => t.dev[k].drum), DJ = C.defaultsOf(T[1]), D6 = C.defaultsOf(T[2]);
  assert.deepEqual([D8.rows, D8.cols, D8.pads[0].t[0].s, D8.pads[1].t[0].s, DJ.rows, DJ.pads[0].t[0].n, DJ.pads[27].t[0].n, D6.rows, D6.cols], [4, 4, 'bd', 'sd', 4, 48, 63, 2, 4]);
  assert.deepEqual([C.parseNotes('C3 E3 G3'), C.parseNotes('c#4, 60 x 200 Bb2'), C.parseNotes('')], [[48, 52, 55], [46, 60, 61], []]);
  assert.equal(C.PADS_COLOR, PC.COLORS[PC.C_TEAL].lit);
});

/* ---------------------------------------------------------------- the body */
test('the body at 4 × 4 / 8 × 8 / 1 × 1: the grid element is gridOf\'s box at footprint\'s gx / gy (under the bar), one cell per visible pad at its padRect, pad 1 bottom-left, the footer at fy', () => {
  for (const [rows, cols, size] of [[4, 4, 1], [8, 8, 1], [1, 1, 0], [8, 8, 2], [3, 5, 0]]) {
    const S = setup({ pads: [mod44({}, { rows, cols, size })] }), G = PC.gridOf(rows, cols, size), F = PC.footprint(rows, cols, size), g = S.B.grid, wl = g.parentNode;
    assert.equal(wl.classList.contains('pd-well'), true, 'the grid sits in the well');
    assert.deepEqual([parseFloat(wl.style.left) + parseFloat(g.style.left), parseFloat(wl.style.top) + parseFloat(g.style.top) + 40, g.style.width, g.style.height, wl.style.width],
      [F.gx, F.gy, G.w + 'px', G.h + 'px', G.w + 2 * C.WELL_PAD + 'px'], rows + '×' + cols + ': the grid at footprint\'s gx / gy of the module');
    assert.equal(attr(byCls(S.B.el, 'pd-foot')[0], 'data-w'), F.w < 160 ? 'xs' : F.w < 256 ? 's' : null, 'a narrow footer');
    assert.equal(g.children.length, rows * cols);
    const foot = byCls(S.B.el, 'pd-foot')[0];
    assert.equal(foot.style.top, F.fy - 40 + 'px');
    for (const c of g.children) {
      const i = +c.getAttribute('data-i'), r = PC.padRect(G, i);
      assert.deepEqual([c.style.left, c.style.top, c.style.width, c.style.height], [r.x + 'px', r.y + 'px', r.w + 'px', r.h + 'px']);
    }
    const p1 = g.children.find(c => c.getAttribute('data-no') === '1');
    assert.deepEqual([+p1.style.left.slice(0, -2), +p1.style.top.slice(0, -2)], [0, (rows - 1) * (G.P + 8)], 'pad 1 bottom-left');
    S.B.destroy();
  }
});

test('gestures: [data-gesture="music"] on every pad and nowhere else (the gaps, the well, the footer, the body are not music: a pinch there zooms); no cell matches BG_SEL, the body / well / footer do', () => {
  const S = setup();
  const music = all(S.B.el).filter(n => n.getAttribute && n.getAttribute('data-gesture') === 'music');
  assert.deepEqual([music.length, music.every(n => n.classList.contains('pd-pad'))], [16, true]);
  assert.equal(attr(S.B.grid, 'data-gesture'), null);
  const sel = M.BG_SEL.split(',').map(x => x.trim());
  assert.deepEqual(['.pd-body', '.pd-well', '.pd-foot'].map(x => sel.includes(x)), [true, true, true]);
  assert.deepEqual(['.pd-pad', '.pd-jk', '.pd-fb'].map(x => sel.includes(x)), [false, false, false]);
  assert.equal(sel.includes('.pd-grid'), true, 'a gap inside the grid is not a pad: a canvas finger (R2-F11; 1i G1 / G2)');
});

test('play: two pointers on two pads = two hits; one pad, two pointers = two hits and one off (review #2); velocity by height (the front edge loud); the drum REC dep per drum hit', () => {
  const S = setup({ pads: [mod44({ 0: drum('bd'), 1: drum('sd') })] });
  down(S, 0, 1, 0.99); down(S, 1, 2, 0);
  assert.deepEqual(ons(S), [['on', 'trk_1', 36, 127, 'pd1'], ['on', 'trk_1', 38, Math.round(0.3 * 127), 'pd1']], 'front edge 127, back edge 0.30');
  assert.deepEqual(S.log.filter(x => x[0] === 'rec').map(x => x[2]), ['bd', 'sd']);
  down(S, 0, 3, 0.5);
  assert.equal(ons(S).length, 3, 'a second finger on a held pad: a second hit');
  assert.deepEqual(ons(S)[2], ['on', 'trk_1', 36, Math.round(PC.padVel(0.5) * 127), 'pd1']);
  up(S, 0, 1);
  assert.equal(offs(S).length, 0, 'the first finger up: still held');
  up(S, 0, 3);
  assert.deepEqual(offs(S), [['off', 'trk_1', 36, 'pd1']], 'the last finger: one off');
  up(S, 1, 2);
  assert.deepEqual(offs(S).map(x => x[2]), [36, 38]);
  assert.deepEqual(S.H.held(), [], 'no count left');
  // a fixed velocity: the module's rule (fv) and a pad's own v (it wins)
  S.H.edit('fixed', ps => { ps[0].vel = 'fixed'; ps[0].fv = 90; ps[0].pads[1].v = 20; return ps; });
  S.log.length = 0;
  down(S, 0, 4, 0.99); down(S, 1, 5, 0.99); up(S, 0, 4); up(S, 1, 5);
  assert.deepEqual(ons(S).map(x => x[3]), [90, 20]);
  // gaps and empty pads play nothing
  S.log.length = 0;
  const g = at(S, 0); ptr(S.B.grid, 'pointerdown', g.x + 40, g.y, { pointerId: 9, pointerType: 'touch' }); ptr(S.B.grid, 'pointerup', g.x + 40, g.y, { pointerId: 9, pointerType: 'touch' });
  down(S, 9, 10); up(S, 9, 10); // (slot 9: row 1, column 1 — an empty pad)
  assert.deepEqual(S.log, []);
});

test('the host: reference counts per (track, note) — a chord pad and a note pad sharing a note: an on at each press, one off at the last release; two hardware pads on one kick: two hits; keyboard + pointer on one pad', () => {
  const S = setup({ midi: true, pads: [mod44({ 0: chord(60, 'maj'), 1: note(64), 2: drum('bd', 'trk_1', { hw: { port: 'Pads A', ch: 10, n: 36, cc: 0 } }), 3: drum('bd', 'trk_1', { hw: { port: 'Pads A', ch: 10, n: 37, cc: 0 } }) })] });
  down(S, 0, 1); down(S, 1, 2);
  assert.deepEqual(ons(S).map(x => x[2]), [60, 64, 67, 64], 'E4 struck twice');
  up(S, 0, 1);
  assert.deepEqual(offs(S).map(x => x[2]), [60, 67], 'E4 still held by pad 2');
  up(S, 1, 2);
  assert.deepEqual(offs(S).map(x => x[2]), [60, 67, 64]);
  S.log.length = 0;
  assert.equal(S.H.midiIn({ k: 'on', ch: 10, n: 36, v: 1 }, 'Pads A', 0), true);
  assert.equal(S.H.midiIn({ k: 'on', ch: 10, n: 37, v: 0.5 }, 'Pads A', 0), true);
  assert.deepEqual(ons(S).map(x => [x[2], x[3]]), [[36, 127], [36, 64]], 'two hits, velocity as sent');
  S.H.midiIn({ k: 'off', ch: 10, n: 36 }, 'Pads A', 0);
  assert.equal(offs(S).length, 0);
  S.H.midiIn({ k: 'off', ch: 10, n: 37 }, 'Pads A', 0);
  assert.equal(offs(S).length, 1);
  assert.equal(S.H.midiIn({ k: 'on', ch: 10, n: 40, v: 1 }, 'Pads A', 0), false, 'an unbound note: today\'s dispatch');
  assert.equal(S.H.midiIn({ k: 'on', ch: 10, n: 36, v: 1 }, 'Other', 0), false, 'another port: not this binding');
  // a key and a pointer on one pad
  S.log.length = 0;
  const c0 = cellOf(S, 1);
  c0.focus();
  fire(c0, 'focusin');
  key(c0, ' ');
  down(S, 1, 7);
  fire(c0, 'keyup', { key: ' ' });
  assert.deepEqual([ons(S).length, offs(S).length, ons(S)[0][3]], [2, 0, 100], 'a key hit at 100 / 127');
  up(S, 1, 7);
  assert.deepEqual(offs(S).map(x => x[2]), [64]);
});

test('D9: destroy, release(), release({ hw }) (counts reset), an edit of a held pad, a hidden pad, the module / track deleted, a hardware note-off, a port gone — every on gets its off', () => {
  const S = setup({ midi: true, pads: [mod44({ 0: drum('bd'), 1: note(60), 2: note(62, 'trk_2', { hw: { port: 'Pads A', ch: 1, n: 40, cc: 0 } }), 4: note(65) })] });
  // every (track, note) a pad struck ends with an off after its last on (a re-strike's earlier on: main's held retrigger)
  const ended = X => { const last = new Map(); for (const x of X.log) if (x[0] === 'on' || x[0] === 'off') last.set(x[1] + ':' + x[2], x[0]); return [...last.values()].every(v => v === 'off') && X.H.held().length === 0; };
  // destroy
  down(S, 0, 1); down(S, 1, 2); down(S, 1, 3);
  S.B.destroy();
  assert.deepEqual([ons(S).length, offs(S).length, S.H.held().length], [3, 2, 0], 'destroy: one off per held (track, note)');
  ptr(S.B.grid, 'pointerup', 0, 0, { pointerId: 2, pointerType: 'touch' });
  assert.equal(offs(S).length, 2, 'a stale event after destroy posts nothing');
  // release(): canvas + keys end, hardware kept; release({ hw: true }): everything, counts reset
  const S2 = setup({ midi: true, pads: S.P.pads });
  down(S2, 0, 1);
  S2.H.midiIn({ k: 'on', ch: 1, n: 40, v: 1 }, 'Pads A', 0);
  S2.H.release();
  assert.deepEqual(offs(S2).map(x => x[2]), [36], 'a blur keeps the hardware pad');
  S2.H.release({ hw: true });
  assert.deepEqual(offs(S2).map(x => x[2]), [36, 62]);
  assert.deepEqual([S2.H.held(), S2.H.holdKeys()], [[], []]);
  S2.H.midiIn({ k: 'off', ch: 1, n: 40 }, 'Pads A', 0);
  assert.equal(offs(S2).length, 2, 'the late hardware note-off: nothing more');
  down(S2, 1, 5);
  assert.equal(ons(S2).at(-1)[2], 60, 'the next hit of a note sounds after a reset');
  up(S2, 1, 5);
  // a mapping edit while held ends that pad's notes (the pointer's lift then sends nothing)
  S2.log.length = 0;
  down(S2, 1, 6);
  S2.H.edit('Edit pad 2', ps => { ps[0].pads[1].t[0].n = 72; return ps; });
  assert.deepEqual(offs(S2).map(x => x[2]), [60]);
  up(S2, 1, 6);
  assert.equal(offs(S2).length, 1);
  // a colour edit while held keeps it
  down(S2, 1, 7);
  S2.H.edit('Colour', ps => { ps[0].pads[1].c = 3; return ps; });
  assert.equal(offs(S2).length, 1, 'a colour change ends nothing');
  up(S2, 1, 7);
  assert.equal(offs(S2).length, 2);
  // a smaller grid hides a held pad: its notes end
  S2.log.length = 0;
  assert.equal(cellOf(S2, 4), null, 'slot 4 (row 0, column 4) is outside a 4 × 4 grid');
  S2.H.edit('wide', ps => { ps[0].cols = 5; return ps; });
  placeGrid(S2.B);
  down(S2, 4, 8);
  assert.equal(ons(S2).length, 1);
  S2.H.edit('narrow', ps => { ps[0].cols = 4; return ps; });
  assert.deepEqual(offs(S2).map(x => x[2]), [65]);
  ptr(S2.B.grid, 'pointerup', 0, 0, { pointerId: 8, pointerType: 'touch' }); // (its lift: nothing more)
  assert.equal(offs(S2).length, 1);
  // the module deleted, a track deleted, a port gone, a hardware note-off
  S2.log.length = 0;
  placeGrid(S2.B);
  down(S2, 0, 9);
  assert.deepEqual(ons(S2).map(x => x[2]), [36]);
  S2.H.edit('Delete Pads 1', () => []);
  assert.deepEqual(offs(S2).map(x => x[2]), [36], 'the module gone');
  const S3 = setup({ midi: true, pads: [mod44({ 0: { t: [{ k: 'drum', tr: 'trk_1', s: 'bd' }, { k: 'note', tr: 'trk_2', n: 50 }] }, 2: note(62, 'trk_2', { hw: { port: 'Pads A', ch: 1, n: 40, cc: 0 } }) })] });
  down(S3, 0, 1);
  S3.H.endTrack('trk_2');
  assert.deepEqual(offs(S3).map(x => [x[1], x[2]]), [['trk_2', 50]], 'the deleted track\'s notes end, the 808\'s stay');
  up(S3, 0, 1);
  assert.deepEqual(offs(S3).map(x => x[2]), [50, 36]);
  S3.H.midiIn({ k: 'on', ch: 1, n: 40, v: 1 }, 'Pads A', 0);
  S3.H.ports(['Other']);
  assert.deepEqual(offs(S3).map(x => x[2]), [50, 36, 62], 'its port gone: the hold ends');
  S3.H.midiIn({ k: 'on', ch: 1, n: 40, v: 1 }, 'Pads A', 0);
  S3.H.ports(['Pads A']);
  assert.equal(offs(S3).length, 3, 'its port still there: held');
  S3.H.midiIn({ k: 'on', ch: 1, n: 40, v: 0 }, 'Pads A', 0); // (velocity 0: M decodes it as an off; the host's own v 0 = a release too)
  S3.H.midiIn({ k: 'off', ch: 1, n: 40 }, 'Pads A', 0);
  assert.equal(offs(S3).length, 4);
  for (const X of [S2, S3]) X.H.release({ hw: true });
  assert.deepEqual([S, S2, S3].map(ended), [true, true, true], 'every note ended');
});

test('latch (§3.1): a tap holds a note / chord pad, the next tap releases; a drum pad ignores it', () => {
  const S = setup({ pads: [mod44({ 0: chord(48, 'min', 'trk_2', { latch: 1 }), 1: drum('bd', 'trk_1', { latch: 1 }) })] });
  down(S, 0); up(S, 0);
  assert.deepEqual([ons(S).length, offs(S).length], [3, 0], 'held after the lift');
  assert.equal(attr(cellOf(S, 0), 'data-l'), 'idle', 'before the frame');
  raf.flush(1);
  assert.deepEqual([attr(cellOf(S, 0), 'data-l'), attr(cellOf(S, 0), 'aria-pressed')], ['held', 'true']);
  down(S, 0, 2); up(S, 0, 2);
  assert.deepEqual([ons(S).length, offs(S).length], [3, 3], 'the next tap releases (no new hit)');
  down(S, 1, 3); up(S, 1, 3);
  assert.deepEqual([ons(S).length, offs(S).length], [4, 4], 'a drum: one-shot');
});

test('mod pads (§5.2–§5.3): a press\'s and a release\'s values post at once (a hardware on / off in one frame: both); the toggle flips and stays; pressure ≤ once a frame per source; value(src) for compileMods', () => {
  const S = setup({ midi: true, pads: [mod44({ 0: { mod: { m: 'gate', lo: 0.1, hi: 0.9 }, hw: { port: '', ch: 1, n: 1, cc: 0 } }, 1: { mod: { m: 'tog' } }, 2: { mod: { m: 'press', lo: 0, hi: 1 } }, 3: note(60, 'trk_2', { mod: { m: 'vel' } }) })] });
  assert.deepEqual([S.H.value('pd1.p0'), S.H.value('pd1.p1'), S.H.value('pd1.p9')], [0.1, 0, 0], 'at rest: lo');
  S.H.midiIn({ k: 'on', ch: 1, n: 1, v: 1 }, 'Pads A', 0);
  S.H.midiIn({ k: 'off', ch: 1, n: 1 }, 'Pads A', 0);
  assert.deepEqual(S.log.filter(x => x[0] === 'mval'), [['mval', 'pd1.p0', 0.9], ['mval', 'pd1.p0', 0.1]], 'both, before any frame');
  S.log.length = 0;
  down(S, 1); up(S, 1); down(S, 1, 2); up(S, 1, 2); down(S, 1, 3); up(S, 1, 3);
  assert.deepEqual(S.log.filter(x => x[0] === 'mval').map(x => x[2]), [1, 0, 1], 'toggle: flips at each press, a release leaves it');
  assert.equal(S.H.value('pd1.p1'), 1);
  S.log.length = 0;
  down(S, 3, 4, 0.99);
  assert.deepEqual(S.log.filter(x => x[0] !== 'rec'), [['on', 'trk_2', 60, 127, 'pd1'], ['mval', 'pd1.p3', 1]], 'a pad plays and modulates');
  up(S, 3, 4);
  S.log.length = 0;
  down(S, 2, 5, 0.5, { pointerType: 'pen', pressure: 0.15 });
  for (const p of [0.3, 0.5, 0.7, 1]) { const q = at(S, 2); ptr(S.B.grid, 'pointermove', q.x, q.y, { pointerId: 5, pointerType: 'pen', pressure: p }); }
  for (const p of [0.4, 0.6]) S.H.at('pd1', 2, p);
  assert.deepEqual(S.log.filter(x => x[0] === 'mval'), [['mval', 'pd1.p2', 0]], 'the press: lo at once; pressure waits for the frame');
  raf.flush(1);
  assert.equal(S.log.filter(x => x[0] === 'mval').length, 2, 'one post for the frame');
  assert.deepEqual(S.log.filter(x => x[0] === 'mval').at(-1), ['mval', 'pd1.p2', 0.6]);
  up(S, 2, 5, { pointerType: 'pen' });
  assert.deepEqual(S.log.filter(x => x[0] === 'mval').at(-1), ['mval', 'pd1.p2', 0], 'the release: lo at once');
});

test('the Pencil (§2.4): pressure → channel aftertouch to a note / chord pad\'s track only (≤ once a frame, 0 at the lift); a drum pad sends none', () => {
  const S = setup({ pads: [mod44({ 0: chord(60, 'maj'), 1: drum('bd') })] });
  down(S, 0, 1, 0.5, { pointerType: 'pen', pressure: 0.6 });
  raf.flush(2);
  const q = at(S, 0); ptr(S.B.grid, 'pointermove', q.x, q.y, { pointerId: 1, pointerType: 'pen', pressure: 1 });
  raf.flush(2);
  up(S, 0, 1, { pointerType: 'pen' });
  raf.flush(2);
  assert.deepEqual(S.log.filter(x => x[0] === 'ctl'), [['ctl', 'trk_2', 'at', 0.53], ['ctl', 'trk_2', 'at', 1], ['ctl', 'trk_2', 'at', 0]]);
  S.log.length = 0;
  down(S, 1, 2, 0.5, { pointerType: 'pen', pressure: 1 }); raf.flush(2); up(S, 1, 2, { pointerType: 'pen' }); raf.flush(2);
  assert.deepEqual(S.log.filter(x => x[0] === 'ctl'), []);
});

test('Edit mode (§7.1): the body\'s own [data-pads-edit] (never [data-cv-edit]); taps select (Shift / a second finger adds) and play nothing; Escape and ✎ leave; the bed is back after', () => {
  const S = setup({ pads: [mod44({ 0: drum('bd'), 1: drum('sd'), 2: { mod: { m: 'gate' } } })] });
  const editB = byCls(S.B.el, 'pd-edit')[0];
  ptr(editB, 'pointerdown', 0, 0, { pointerType: 'mouse' });
  assert.deepEqual([attr(S.B.el, 'data-pads-edit'), all(S.d.body).some(n => n.getAttribute && n.getAttribute('data-cv-edit') != null), attr(editB, 'aria-pressed')], ['', false, 'true']);
  down(S, 0, 1); up(S, 0, 1);
  assert.deepEqual(S.log, [], 'a tap in Edit mode plays nothing');
  assert.equal(attr(cellOf(S, 0), 'data-sel'), '');
  down(S, 1, 2, 0.5, { shiftKey: true, pointerType: 'mouse' }); up(S, 1, 2, { pointerType: 'mouse' });
  assert.deepEqual([0, 1, 2].map(i => attr(cellOf(S, i), 'data-sel')), ['', '', null], 'Shift adds');
  down(S, 2, 3); down(S, 0, 4); up(S, 0, 4); up(S, 2, 3);
  assert.deepEqual([0, 1, 2].map(i => attr(cellOf(S, i), 'data-sel')), [null, null, ''], 'a second finger toggles into the selection');
  assert.ok(!!S.B.popover(), 'the inspector beside the module');
  const c = cellOf(S, 2);
  c.focus(); fire(c, 'focusin');
  key(c, 'Escape');
  assert.deepEqual([attr(S.B.el, 'data-pads-edit'), S.B.popover() === null], [null, true], 'Escape leaves, the inspector closes');
  down(S, 0, 5); up(S, 0, 5);
  assert.deepEqual(ons(S).length, 1, 'the bed is back');
  // a mod pad's jack: an anchor inside the pad (never the pad), drawn and pressable only in Edit mode (CSS)
  const jk = byCls(cellOf(S, 2), 'pd-jk')[0];
  assert.deepEqual([!!jk, attr(jk, 'data-jack'), jk.parentNode === cellOf(S, 2), attr(cellOf(S, 2), 'data-jack')], [true, 'p2', true, null]);
  const css = S.d.getElementById('cv-pads-css').textContent;
  assert.ok(/\.pd-jk \{[^}]*visibility: hidden[^}]*pointer-events: none/.test(css) && /\[data-pads-edit\] \.pd-jk \{ visibility: visible; pointer-events: auto/.test(css), 'jacks only in Edit mode, never display: none');
  assert.ok(!/\.pd-jk[^{]*\{[^}]*display: none/.test(css));
});

test('Edit mode: a drag onto another pad swaps (Alt / a long press first: copies — a hardware binding stays with its slot); onto an instrument module of this canvas retargets to this track', () => {
  const S = setup({ pads: [mod44({ 0: drum('bd', 'trk_1', { hw: { port: '', ch: 1, n: 5, cc: 0 } }), 1: drum('sd') })] });
  S.B.edit(true);
  const tgt = { el: null };
  S.d.elementFromPoint = () => tgt.el;
  const drag = (i, j, o = {}) => { const a = at(S, i), b = at(S, j); tgt.el = cellOf(S, j); ptr(cellOf(S, i), 'pointerdown', a.x, a.y, Object.assign({ pointerId: 11, pointerType: 'mouse' }, o)); ptr(S.B.grid, 'pointermove', b.x, b.y, Object.assign({ pointerId: 11, pointerType: 'mouse', timeStamp: (o.timeStamp || 0) + (o.hold || 0) }, {})); ptr(S.B.grid, 'pointerup', b.x, b.y, { pointerId: 11, pointerType: 'mouse' }); };
  drag(0, 1);
  const P0 = () => S.H.module('pd1').pads;
  assert.deepEqual([P0()[0].t[0].s, P0()[1].t[0].s, P0()[0].hw.n, P0()[1].hw], ['sd', 'bd', 5, null], 'swapped, the binding stays on slot 0');
  assert.deepEqual(S.steps, ['Swap pads 1 and 2']);
  drag(0, 2, { altKey: true });
  assert.deepEqual([P0()[0].t[0].s, P0()[2].t[0].s, S.steps.at(-1)], ['sd', 'sd', 'Copy pad 1 to pad 3']);
  drag(1, 3, { timeStamp: 1000, hold: 500 });
  assert.deepEqual([P0()[3].t[0].s, S.steps.at(-1)], ['bd', 'Copy pad 2 to pad 4'], 'a long press first: copy');
  // onto an instrument module: this canvas's track (here trk_2 — a Juno); a drum machine's own pad: that sound
  const inst = S.d.createElement('div'), pad = S.d.createElement('div');
  inst.setAttribute('data-cv-mod', 'i1'); inst.setAttribute('data-cv-kind', 'inst'); pad.setAttribute('data-sound', 'cp'); inst.append(pad); S.d.body.append(inst);
  const a = at(S, 1);
  const go = el => { tgt.el = el; ptr(cellOf(S, 1), 'pointerdown', a.x, a.y, { pointerId: 12, pointerType: 'mouse' }); ptr(S.B.grid, 'pointermove', a.x + 300, a.y, { pointerId: 12, pointerType: 'mouse' }); ptr(S.B.grid, 'pointerup', a.x + 300, a.y, { pointerId: 12, pointerType: 'mouse' }); };
  go(inst);
  assert.deepEqual([P0()[1].t[0].k, P0()[1].t[0].tr, S.steps.at(-1)], ['drum', 'trk_2', 'Pad 2 → Juno']);
  go(pad);
  assert.deepEqual(P0()[1].t[0], { k: 'drum', tr: 'trk_2', s: 'cp' });
  assert.equal(S.log.length, 0, 'nothing played');
});

test('the inspector (§7.2): every field → a normPads-valid record, one History step per gesture; several pads: the shared fields; Modulation off with rows asks and drops them in the same step; the learn UI only with Web MIDI', () => {
  const S = setup({ pads: [mod44({ 0: drum('bd'), 1: note(60), 2: note(62) })], rows: { 'pd1.p1': [{ track: 'Juno', label: 'Cutoff' }] } });
  S.B.inspect(1);
  const box = () => S.B.popover();
  const sels = () => all(box()).filter(n => n.localName === 'select');
  const byLabel = l => sels().find(s => s.getAttribute('aria-label') === l) || all(box()).find(n => n.getAttribute && n.getAttribute('aria-label') === l);
  const choose = (l, v) => { const s = byLabel(l); s.value = String(v); fire(s, 'change'); };
  const click = l => { const b = all(box()).find(n => n.localName === 'button' && (n.getAttribute('aria-label') === l || n.textContent === l)); ptr(b, 'pointerdown', 0, 0, { pointerType: 'mouse' }); };
  const pad = () => S.H.module('pd1').pads[1];
  const ok = () => assert.deepEqual(PC.normPads(S.P.pads), S.P.pads, 'normPads-valid');
  assert.equal(attr(box(), 'data-pop'), 'insp');
  click('Note up'); ok();
  assert.deepEqual([pad().t[0].n, S.steps.at(-1)], [61, 'Edit pad 2']);
  choose('Type', 'chord'); ok();
  assert.deepEqual(pad().t[0], { k: 'chord', tr: 'trk_2', root: 61, q: 'maj', inv: 0, oct: 0, spread: 'close' });
  choose('Quality', 'm7'); choose('Inversion', 2); choose('Spread', 'open'); choose('Octave', -1); ok();
  assert.deepEqual([pad().t[0].q, pad().t[0].inv, pad().t[0].spread, pad().t[0].oct], ['m7', 2, 'open', -1]);
  choose('Quality', 'custom'); ok();
  assert.deepEqual([pad().t[0].k, pad().t[0].ns], ['notes', PC.chordNotes({ k: 'chord', root: 61, q: 'm7', inv: 2, spread: 'open', oct: -1 })]);
  const inp = all(box()).find(n => n.localName === 'input' && n.getAttribute('aria-label') === 'Notes (e.g. C3 E3 G3)');
  inp.value = 'C3 G3 C4'; fire(inp, 'change'); ok();
  assert.deepEqual(pad().t[0].ns, [48, 55, 60]);
  choose('Type', 'drum'); ok();
  choose('Track', 'trk_1'); ok();
  choose('Sound', 'cp'); ok();
  assert.deepEqual(pad().t[0], { k: 'drum', tr: 'trk_1', s: 'cp' });
  click('+ Add target'); ok();
  assert.equal(pad().t.length, 2);
  const n0 = S.steps.length;
  choose('Modulation', 'press'); ok();
  assert.deepEqual([pad().mod, S.steps.length], [{ m: 'press', lo: 0, hi: 1 }, n0 + 1]);
  click('High down'); ok();
  assert.equal(pad().mod.hi, 0.95);
  choose('Modulation', ''); ok();
  assert.deepEqual([pad().mod, S.changes.at(-1).drop], [null, ['pd1.p1']], 'its rows go in the same step');
  choose('Velocity', 'fixed'); click('Velocity up'); ok();
  assert.equal(pad().v, 105);
  click('Latch: a tap holds, the next tap releases'); ok();
  assert.equal(pad().latch, 1);
  click('Violet'); ok();
  assert.equal(pad().c, PC.C_VIOLET);
  const lab = all(box()).find(n => n.localName === 'input' && n.getAttribute('aria-label') === 'Label');
  lab.value = 'A very long label here'; fire(lab, 'change'); ok();
  assert.equal(pad().l, 'A very long ');
  assert.equal(all(box()).some(n => /pd-learn/.test(n.getAttribute && n.getAttribute('class') || '')), false, 'no learn UI without Web MIDI');
  // several pads: Track, Velocity, Colour — one step each
  S.B.inspect(0);
  const c2 = cellOf(S, 2), a2 = at(S, 2);
  ptr(c2, 'pointerdown', a2.x, a2.y, { pointerId: 30, pointerType: 'mouse', shiftKey: true }); ptr(S.B.grid, 'pointerup', a2.x, a2.y, { pointerId: 30, pointerType: 'mouse' });
  assert.equal(all(box()).filter(n => n.localName === 'select').length, 2, 'Track and Velocity');
  const k = S.steps.length;
  choose('Track', 'trk_3'); ok();
  assert.deepEqual([S.H.module('pd1').pads[0].t[0].tr, S.H.module('pd1').pads[2].t[0].tr, S.steps.length, S.steps.at(-1)], ['trk_3', 'trk_3', k + 1, 'Edit 2 pads']);
  click('Red'); ok();
  assert.deepEqual([S.H.module('pd1').pads[0].c, S.H.module('pd1').pads[2].c], [0, 0]);
  // the "asks" refusal keeps the mod
  const S2 = setup({ confirm: false, pads: [mod44({ 1: { mod: { m: 'gate' } } })], rows: { 'pd1.p1': [{ track: 'Juno', label: 'Cutoff' }] } });
  S2.B.inspect(1);
  const s2 = all(S2.B.popover()).find(n => n.localName === 'select' && n.getAttribute('aria-label') === 'Modulation');
  s2.value = ''; fire(s2, 'change');
  assert.deepEqual([S2.H.module('pd1').pads[1].mod.m, S2.steps.length], ['gate', 0], 'refused: nothing changed');
  assert.ok(all(S2.B.popover()).some(n => n.localName === 'li' && n.textContent === 'Juno · Cutoff'), 'its rows listed');
});

test('learn (§8.3): the inspector\'s Learn (Mac only) — the next hardware note binds the pad (one step), a binding held elsewhere moves (a notice); the hardware dot; hidden pads swallow their notes', async () => {
  const S = setup({ midi: true, pads: [mod44({ 0: drum('bd', 'trk_1', { hw: { port: 'Pads A', ch: 10, n: 36, cc: 0 } }), 1: note(60), 20: note(70, 'trk_2', { hw: { port: 'Pads A', ch: 10, n: 50, cc: 0 } }) })] });
  const dot = byCls(S.B.el, 'pd-hw')[0];
  assert.deepEqual([dot.hidden, attr(dot, 'data-on')], [false, ''], 'the hardware dot: a learned pad connected');
  S.B.inspect(1);
  const lb = all(S.B.popover()).find(n => n.localName === 'button' && /pd-learn/.test(n.getAttribute('class')));
  ptr(lb, 'pointerdown', 0, 0, { pointerType: 'mouse' });
  raf.flush(1);
  assert.deepEqual([S.H.learning(), attr(cellOf(S, 1), 'data-learn')], [{ id: 'pd1', i: 1 }, ''], 'the pad to learn pulses');
  S.learn({ port: 'Pads A', ch: 10, n: 36, cc: 0 });
  await new Promise(r => setTimeout(r, 0));
  const ps = S.H.module('pd1').pads;
  assert.deepEqual([ps[1].hw, ps[0].hw, S.steps.at(-1), S.notes.length], [{ port: 'Pads A', ch: 10, n: 36, cc: 0 }, null, 'Learn pad 2', 1], 'moved from pad 1');
  S.log.length = 0;
  assert.equal(S.H.midiIn({ k: 'on', ch: 10, n: 50, v: 1 }, 'Pads A', 0), true, 'a hidden pad\'s binding: swallowed');
  assert.deepEqual(S.log, [], 'plays nothing');
  S.H.forget('pd1', 1);
  assert.equal(S.H.module('pd1').pads[1].hw, null);
  // without Web MIDI: no learn row, no dot, the menu item disabled with the reason
  const N = setup({ pads: S.P.pads });
  N.B.inspect(1);
  assert.equal(all(N.B.popover()).some(n => /pd-learn/.test(n.getAttribute && n.getAttribute('class') || '')), false);
  assert.equal(byCls(N.B.el, 'pd-hw')[0].hidden, true);
  const it = N.B.menuItems().find(x => /^Hardware controller/.test(x.label));
  assert.deepEqual([it.disabled, it.label], [true, 'Hardware controller… (needs Web MIDI)']);
  N.B.openHw();
  assert.ok(N.B.popover().textContent.includes('need a browser with Web MIDI'));
});

test('lights (§6): ≤ one paint a frame (a burst of 50 lit changes → one flush); the own hit at once in the frame, held → idle; the monitor\'s bits flash a drum pad; live input notes and roll playback light a note pad; Light: on hit ignores the target', () => {
  const S = setup({ pads: [mod44({ 0: drum('bd'), 1: drum('sd'), 2: note(60), 3: { mod: { m: 'gate', lo: 0, hi: 1 } } })] });
  const p0 = S.H.stats().paints;
  for (let k = 0; k < 25; k++) { S.subs.lit.get('trk_1')(1); S.subs.lit.get('trk_1')(2); }
  assert.equal(S.H.stats().paints, p0, 'nothing before the frame');
  raf.flush(1);
  assert.equal(S.H.stats().paints, p0 + 1, 'one paint for 50 changes');
  raf.flush(3);
  assert.equal(S.H.stats().paints, p0 + 1, 'nothing scheduled while nothing changes');
  assert.ok(['0', '1'].includes(attr(cellOf(S, 0), 'data-hit')) && ['0', '1'].includes(attr(cellOf(S, 1), 'data-hit')), 'the drums flashed');
  assert.equal(S.H.wants('trk_1'), true, 'a shown module lights from the 808: its monitor is wanted');
  assert.equal(S.H.wants('trk_2'), false);
  down(S, 0); raf.flush(1);
  assert.equal(attr(cellOf(S, 0), 'data-l'), 'held');
  up(S, 0); raf.flush(1);
  assert.equal(attr(cellOf(S, 0), 'data-l'), 'idle');
  S.subs.in.get('trk_2')(60, true); raf.flush(1);
  assert.equal(attr(cellOf(S, 2), 'data-l'), 'lit', 'a live input note');
  S.subs.in.get('trk_2')(60, false); raf.flush(1);
  assert.equal(attr(cellOf(S, 2), 'data-l'), 'idle');
  S.P.tracks[1].notes = [{ id: 'n1', t: 960, d: 480, n: 60, v: 100 }];
  S.H.transport(true);
  S.setTick(1000); raf.flush(1);
  assert.equal(attr(cellOf(S, 2), 'data-l'), 'lit', 'roll playback at the heard tick');
  S.setTick(1500); raf.flush(1);
  assert.equal(attr(cellOf(S, 2), 'data-l'), 'idle');
  S.H.transport(false); raf.flush(2);
  const n = S.H.stats().paints; raf.flush(3);
  assert.equal(S.H.stats().paints, n, 'stopped: no frame loop');
  // a mod pad's brightness follows its value
  down(S, 3); raf.flush(1);
  assert.equal(cellOf(S, 3).style.getPropertyValue('--pb'), '1.000');
  up(S, 3); raf.flush(1);
  assert.equal(cellOf(S, 3).style.getPropertyValue('--pb'), '0.220');
  // Light: on hit — no follow, no monitor subscription
  S.H.edit('light', ps => { ps[0].light = 'hit'; return ps; });
  assert.deepEqual([S.H.wants('trk_1'), S.subs.lit.size, S.mon() > 0], [false, 0, true]);
  // the off pad: dark grey
  assert.equal(attr(cellOf(S, 9), 'data-l'), 'off');
});

test('the keyboard (§2.5): one tab stop (roving), arrows move it (up = the row above), Space held = the pad held at 100 / 127, Escape releases; a pointer-focused grid gives the keys back', () => {
  const S = setup({ pads: [mod44({ 0: drum('bd'), 8: drum('sd'), 1: drum('lt') })] });
  const stops = () => S.B.grid.children.filter(c => c.tabIndex === 0).map(c => +c.getAttribute('data-i'));
  assert.deepEqual(stops(), [0], 'pad 1 the tab stop');
  const c0 = cellOf(S, 0);
  c0.focus(); fire(c0, 'focusin');
  key(c0, 'ArrowUp');
  assert.deepEqual([stops(), S.d.activeElement === cellOf(S, 8), attr(S.B.grid, 'data-kb')], [[8], true, '']);
  key(cellOf(S, 8), 'ArrowDown'); key(cellOf(S, 0), 'ArrowRight');
  assert.deepEqual(stops(), [1]);
  key(cellOf(S, 1), ' ');
  key(cellOf(S, 1), ' ', { repeat: true });
  assert.deepEqual(ons(S), [['on', 'trk_1', 41, 100, 'pd1']]);
  key(cellOf(S, 1), 'Escape');
  assert.deepEqual(offs(S).map(x => x[2]), [41], 'Escape releases');
  key(cellOf(S, 1), 'Enter'); fire(cellOf(S, 1), 'keyup', { key: 'Enter' });
  assert.equal(offs(S).length, 2);
  // a pointer press in the grid: the keys go back to the page
  const a = at(S, 1);
  ptr(cellOf(S, 1), 'pointerdown', a.x, a.y, { pointerId: 3, pointerType: 'mouse' }); ptr(S.B.grid, 'pointerup', a.x, a.y, { pointerId: 3, pointerType: 'mouse' });
  const e = key(cellOf(S, 1), ' ');
  assert.deepEqual([e.defaultPrevented, ons(S).length], [false, 3]);
});

test('Grid… (§1.3): rows / columns 1–8 and S / M / L, one step each ("Pads 1: 4 × 5"), the body at its new footprint, the outline; shrinking keeps the mapping; Velocity…, Light, Fill from…, Clear pads, Pad shape, Rename — every one a step', () => {
  const S = setup({ pads: [mod44({ 0: drum('bd'), 3: drum('ch') })] });
  S.B.openGrid();
  const tapL = l => { const b = all(S.B.popover()).find(n => n.localName === 'button' && (n.getAttribute('aria-label') === l || n.textContent === l)); ptr(b, 'pointerdown', 0, 0, { pointerType: 'mouse' }); };
  tapL('Columns up');
  assert.deepEqual([S.steps.at(-1), S.H.module('pd1').cols, S.B.grid.children.length], ['Pads 1: 4 × 5', 5, 20]);
  const outline = byCls(S.B.el, 'pd-outline')[0], F = PC.footprint(4, 5, 1);
  assert.deepEqual([outline.style.width, outline.style.height], [F.w + 'px', F.h + 'px']);
  for (let k = 0; k < 9; k++) tapL('Rows up');
  for (let k = 0; k < 9; k++) tapL('Columns up');
  assert.deepEqual([S.H.module('pd1').rows, S.H.module('pd1').cols, S.B.grid.children.length, S.B.grid.style.width], [8, 8, 64, PC.gridOf(8, 8, 1).w + 'px'], '8 × 8, clamped');
  for (let k = 0; k < 9; k++) { tapL('Rows down'); tapL('Columns down'); }
  assert.deepEqual([S.H.module('pd1').rows, S.H.module('pd1').cols, S.B.grid.children.length, S.B.grid.style.width], [1, 1, 1, '72px'], '1 × 1');
  assert.deepEqual([S.H.module('pd1').pads[3].t[0].s], ['ch'], 'a hidden pad keeps its mapping');
  tapL('L');
  assert.deepEqual([S.H.module('pd1').size, S.steps.at(-1), S.B.grid.style.width], [2, 'Pads 1: pads L', '96px']);
  S.B.closePop();
  assert.equal(byCls(S.B.el, 'pd-outline').length, 0, 'the outline goes with the popover');
  // ⋯ items
  const item = l => S.B.menuItems().find(x => x.label === l);
  item('Light').sub.find(x => x.label === 'On hit').action();
  item('Pad shape').sub.find(x => x.label === 'Hexagon').action();
  assert.deepEqual([S.H.module('pd1').light, S.H.module('pd1').shape, attr(S.B.grid, 'data-shape')], ['hit', 'hex', 'hex']);
  globalThis.prompt = () => 'Finger drums';
  item('Rename…').action();
  delete globalThis.prompt;
  assert.equal(S.H.module('pd1').name, 'Finger drums');
  S.H.edit('grid', ps => { ps[0].rows = 4; ps[0].cols = 4; ps[0].size = 1; return ps; });
  item('Clear pads').action();
  assert.deepEqual([S.H.module('pd1').pads.filter(Boolean).length, S.notes.at(-1)], [0, 'Clear Finger drums — tap to undo']);
  S.B.openFill();
  const fsel = all(S.B.popover()).find(n => n.localName === 'select' && n.getAttribute('aria-label') === 'Track');
  fsel.value = 'trk_1'; fire(fsel, 'change');
  ptr(all(S.B.popover()).find(n => n.localName === 'button' && n.textContent === 'Its drum sounds'), 'pointerdown', 0, 0, { pointerType: 'mouse' });
  assert.deepEqual([S.H.module('pd1').pads[0].t[0].s, S.H.module('pd1').pads[1].t[0].s, /^Fill Finger drums from Drums/.test(S.steps.at(-1))], ['bd', 'sd', true]);
  S.B.openVel();
  ptr(all(S.B.popover()).find(n => n.localName === 'button' && n.textContent === 'Fixed'), 'pointerdown', 0, 0, { pointerType: 'mouse' });
  tapL('Fixed velocity down');
  assert.deepEqual([S.H.module('pd1').vel, S.H.module('pd1').fv], ['fixed', 95]);
  assert.ok(S.steps.length >= 30 && S.steps.every(x => typeof x === 'string' && x));
});

test('a pinch-safe chrome: a finger\'s tap acts at its release within 10 px, a pointercancel (a two-finger pinch) drops it, a mouse acts at the press, Enter / Space through the click', () => {
  const S = setup();
  const b = byCls(S.B.el, 'pd-edit')[0];
  ptr(b, 'pointerdown', 10, 10, { pointerType: 'touch', pointerId: 4 });
  assert.equal(attr(S.B.el, 'data-pads-edit'), null, 'a finger: not at the press');
  fire(b, 'pointercancel', { pointerId: 4, gesture: 'two-finger' });
  ptr(b, 'pointerup', 10, 10, { pointerType: 'touch', pointerId: 4 });
  assert.equal(attr(S.B.el, 'data-pads-edit'), null, 'a pinch starting on it presses nothing');
  ptr(b, 'pointerdown', 10, 10, { pointerType: 'touch', pointerId: 5 }); ptr(b, 'pointerup', 30, 10, { pointerType: 'touch', pointerId: 5 });
  assert.equal(attr(S.B.el, 'data-pads-edit'), null, 'moved 20 px: no tap');
  ptr(b, 'pointerdown', 10, 10, { pointerType: 'touch', pointerId: 6 }); ptr(b, 'pointerup', 14, 12, { pointerType: 'touch', pointerId: 6 });
  assert.equal(attr(S.B.el, 'data-pads-edit'), '');
  fire(b, 'click');
  assert.equal(attr(S.B.el, 'data-pads-edit'), null, 'a keyboard click (no detail)');
});

test('the hardware echo (§8.4): a gen module sends note-on 127 lit / held and 0 idle on the learned channel and note, once per change, per frame; hwDark sends 0 once; a CC pad is never lit; Off sends nothing', () => {
  let clock = 0;
  const S = setup({ midi: true, deps: { now: () => clock }, pads: [mod44({ 0: drum('bd', 'trk_1', { hw: { port: 'Pads A', ch: 10, n: 36, cc: 0 } }), 1: note(60, 'trk_2', { hw: { port: 'Pads A', ch: 10, n: 20, cc: 1 } }) }, { out: { prof: 'gen', port: '' } })] });
  raf.flush(1);
  assert.deepEqual(S.hw, [['Pads A', 0x99, 36, 0]], 'the first paint: idle');
  S.H.midiIn({ k: 'on', ch: 10, n: 36, v: 1 }, 'Pads A', 0); raf.flush(1);
  assert.deepEqual(S.hw.at(-1), ['Pads A', 0x99, 36, 127]);
  raf.flush(1);
  assert.equal(S.hw.length, 2, 'no change: nothing sent');
  S.H.midiIn({ k: 'off', ch: 10, n: 36 }, 'Pads A', 0); raf.flush(1);
  assert.deepEqual(S.hw.at(-1), ['Pads A', 0x99, 36, 127], 'released: the hit\'s flash still lit');
  clock += C.FLASH_MS + 1;
  raf.flush(2);
  assert.deepEqual(S.hw.at(-1), ['Pads A', 0x99, 36, 0]);
  S.H.midiIn({ k: 'cc', ch: 10, cc: 20, val: 100 }, 'Pads A', 0);
  assert.deepEqual(ons(S).at(-1).slice(0, 4), ['on', 'trk_2', 60, 100], 'a CC pad plays');
  S.H.midiIn({ k: 'cc', ch: 10, cc: 20, val: 90 }, 'Pads A', 0);
  assert.equal(ons(S).length, 2, 'a CC stream while pressed: one hit');
  S.H.midiIn({ k: 'cc', ch: 10, cc: 20, val: 0 }, 'Pads A', 0); raf.flush(1);
  assert.equal(S.hw.filter(x => x[2] === 20).length, 0, 'a CC pad is never lit');
  const n = S.hw.length;
  S.H.hwDark('pd1');
  assert.deepEqual([S.hw.length, S.hw.at(-1)], [n + 1, ['Pads A', 0x99, 36, 0]]);
  S.H.edit('off', ps => { ps[0].out.prof = 'off'; return ps; });
  S.H.midiIn({ k: 'on', ch: 10, n: 36, v: 1 }, 'Pads A', 0); raf.flush(2);
  assert.equal(S.hw.length, n + 1, 'Off: nothing');
});

test('the DOM budget (D6): the whole module through cv-module — 4 × 4 ≤ 60, 8 × 8 ≤ 160, + 2 per mod pad; the mod pads\' jacks anchored on their pads, a hidden one\'s dot hidden', () => {
  for (const [rows, cols, nmod, cap] of [[4, 4, 0, 60], [8, 8, 0, 160], [8, 8, 64, 160 + 128], [4, 4, 3, 66]]) {
    const pads = {}; for (let k = 0; k < nmod; k++) pads[k] = { t: [{ k: 'note', tr: 'trk_2', n: 40 + (k % 60) }], mod: { m: 'gate' } };
    const S = setup({ noBody: true, pads: [mod44(pads, { rows, cols })] });
    const T = S.P.tracks[1], root = S.d.createElement('div');
    S.d.body.append(root);
    let body = null;
    const V = M.createTrackView(null, T, { root, doc: S.d, project: () => S.P,
      devices: () => [{ key: 'pd1', kind: 'mod', mod: 'pads', model: null, dev: null, jacks: C.moduleJacks(S.H.module('pd1')), color: C.PADS_COLOR }],
      size: k => (k === 'pd1' ? C.moduleSize(S.H.module('pd1')) : null),
      bodies: { mount: (k, b) => { body = C.padsBody({ host: S.H, id: k, doc: S.d }); b.append(body.el); }, unmount: () => { if (body) body.destroy(); } } });
    const m = V.modules.get('pd1'), n = all(m.el).length;
    assert.ok(n <= cap, rows + '×' + cols + ' with ' + nmod + ' mod pads: ' + n + ' elements ≤ ' + cap);
    assert.deepEqual([m.w, m.fixed.h], [C.moduleSize(S.H.module('pd1')).fixed.w, C.moduleSize(S.H.module('pd1')).fixed.h], 'host-sized');
    if (nmod) {
      V.ports();
      const j0 = m.jack('p0');
      assert.deepEqual([j0.localName, j0.classList.contains('pd-jk'), j0.parentNode.classList.contains('pd-pad'), attr(j0, 'data-cv-jack'), attr(j0.parentNode, 'data-cv-jack')], ['span', true, true, 'pd1.p0', null]);
    }
    V.destroy();
  }
});

test('cv-module + cv-cables with a Pads device entry: jacksOf from the entry, a hidden pad\'s jack (no dot, the bar\'s right end; no rebuild at a Grid… change), the notes jack read-only, the pad-coloured mod cable from its anchor, the note cable to the instrument\'s left edge, Tidy by the footprint', () => {
  const S = setup({ noBody: true, pads: [mod44({ 1: { t: [{ k: 'note', tr: 'trk_2', n: 60 }], mod: { m: 'gate' }, c: PC.C_RED }, 9: { mod: { m: 'tog' }, c: PC.C_LIME }, 40: { mod: { m: 'gate' } } })] });
  const T = S.P.tracks[1];
  T.mods = [{ id: 'r1', src: 'pd1.p1', dst: 'i1:vcf.cut', amt: 0.5 }, { id: 'r2', src: 'pd1.p40', dst: 'i1:vcf.res', amt: 0.25 }];
  const root = S.d.createElement('div'); S.d.body.append(root);
  let body = null, mounts = 0;
  const entry = () => ({ key: 'pd1', kind: 'mod', mod: 'pads', model: null, dev: null, jacks: C.moduleJacks(S.H.module('pd1')), color: C.PADS_COLOR });
  const host = { root, doc: S.d, project: () => S.P, patch: false,
    devices: t => M.devicesOf(t).concat([entry()]),
    size: k => (k === 'pd1' ? C.moduleSize(S.H.module('pd1')) : k === 'i1' ? { fixed: { w: 864, h: 480 } } : null),
    bodies: { mount: (k, b) => { if (k === 'pd1') { mounts++; body = C.padsBody({ host: S.H, id: k, doc: S.d }); b.append(body.el); } }, unmount: k => { if (k === 'pd1' && body) body.destroy(); } } };
  const V = M.createTrackView(null, T, host), pm = V.modules.get('pd1'), im = V.modules.get('i1');
  assert.deepEqual(pm.jackIds(), ['p1', 'p9', 'p40', 'notes']);
  assert.deepEqual([pm.x, pm.x + pm.w <= -M.MOD_GAP, pm.el.style.getPropertyValue('--mc')], [-M.roundW(352 + M.MOD_GAP), true, C.PADS_COLOR], 'Tidy: the modulator column by its own width');
  const P = V.ports();
  // p40 is outside the 4 × 4 grid: no anchor, its dot hidden, its port at the right edge at the bar
  assert.deepEqual([pm.jackDot('p40').hidden, P.get('pd1.p40').x - pm.x, P.get('pd1.p40').y - pm.y], [true, pm.w, 20]);
  assert.deepEqual([pm.jack('notes').hasAttribute('data-ro'), attr(pm.jack('notes'), 'data-kind'), attr(pm.jack('p1'), 'role')], [true, 'note', 'button'], 'the notes jack never patchable; a mod pad\'s is');
  const L = V.cables.list(), r1 = L.find(c => c.id === 'r1'), nc = L.find(c => c.kind === 'note');
  assert.deepEqual([r1.a, r1.color, L.find(c => c.id === 'r2').a], ['pd1.p1', PC.COLORS[PC.C_RED].lit, 'pd1.p40'], 'the pad\'s colour');
  assert.deepEqual([nc.id, nc.a, nc.b, nc.tap, nc.readonly, nc.pads, nc.color], ['n:pd1>i1', 'pd1.notes', 'i1.' + CB.NOTE_END, 'pads', undefined, [1], PC.COLORS[PC.C_RED].lit], 'a tap cable, not read-only under patch: false');
  assert.deepEqual([P.get('i1.' + CB.NOTE_END).x, P.get('i1.' + CB.NOTE_END).y], [im.x, im.y + M.BAR_H + M.JACK_Y], 'the instrument\'s left edge, no jack there');
  assert.equal(im.jackIds().includes(CB.NOTE_END), false);
  im.setFold(true);
  assert.deepEqual([V.ports().get('i1.' + CB.NOTE_END).x, V.ports().get('i1.' + CB.NOTE_END).y], [im.x - M.JACK_OUT, im.y + M.BAR_H / 2], 'folded: outside the bar');
  im.setFold(false);
  // a Grid… change: 8 rows — p40 shown (its anchor), no rebuild
  S.H.edit('rows', ps => { ps[0].rows = 8; return ps; });
  V.sync(T);
  assert.deepEqual([mounts, V.modules.get('pd1') === pm, pm.jackHidden('p40')], [1, true, false], 'same module, the hide flag followed');
  const q = V.ports().get('pd1.p40');
  assert.ok(q.y - pm.y > 40, 'its anchor now');
  // a pad's Modulation switched on: the jack set changes → the module is made again (its body remounted)
  S.H.edit('mod', ps => { ps[0].pads[2] = { t: [], mod: { m: 'vel' } }; return ps; });
  V.sync(T);
  assert.deepEqual([mounts, V.modules.get('pd1').jackIds()], [2, ['p1', 'p2', 'p9', 'p40', 'notes']]);
  // a project without pads: the same cables as before
  const T0 = tracks()[1];
  assert.deepEqual(CB.cablesOf(T0, { project: { tracks: [T0] } }), CB.cablesOf(T0, { project: { tracks: [T0], pads: [] } }));
  V.destroy();
});

test('Edit mode survives a module rebuild (the host keeps the view state: Edit, the selection, the inspector); destroy closes the popover and detaches', async () => {
  const S = setup({ pads: [mod44({ 0: drum('bd') })] });
  S.B.inspect(0);
  assert.equal(S.H.view('pd1').edit, true);
  S.B.destroy();
  assert.equal(all(S.d.body).filter(n => n.getAttribute && /pd-pop/.test(n.getAttribute('class') || '')).length, 0);
  assert.equal(S.H.stats().views, 0);
  const B2 = C.padsBody({ host: S.H, id: 'pd1', doc: S.d });
  S.d.body.append(B2.el);
  await Promise.resolve(); // (the inspector reopens once the body is in its module — R2-F2)
  assert.deepEqual([attr(B2.el, 'data-pads-edit'), !!B2.popover(), attr(B2.grid.children.find(c => c.getAttribute('data-i') === '0'), 'data-sel')], ['', true, '']);
  B2.destroy();
});

/* ================================================================ stage 7d + 8 review fixes (fixer A) */
const kitTrack = () => ({ id: 'trk_4', name: 'Kit', prim: 'i1', dev: { i1: dev('sdsv', { drum: DC.normDrum(undefined, 'sdsv') }) }, notes: [], mods: [] });
// a module root in a world with a top layer (the canvas's shape: wk.layer(root) is the top layer)
function inWorld(S) {
  const world = S.d.createElement('div'), layer = S.d.createElement('div'), root = S.d.createElement('div');
  world.setAttribute('data-cv-world', ''); root.setAttribute('data-cv-mod', 'pd1');
  world.append(root); S.d.body.append(world, layer);
  wk.setLayer(layer);
  return { world, layer, root };
}

test('R1-A a mod pad\'s value follows its edits at once — a range edit under a released gate pad, a toggle left on (its range, another mode), Modulation off and on, a deleted module whose id comes back, a restore (rebuild): value() is the edited pad\'s rest value and the table gets it', () => {
  const S = setup({ noBody: true, pads: [mod44({ 0: { mod: { m: 'gate', lo: 0, hi: 1 } } })] });
  const tap = () => { S.H.press('pd1', 0, 1, 0, 'c1:pd1:0'); S.H.lift('c1:pd1:0'); };
  const mv = () => S.log.filter(x => x[0] === 'mval').map(x => x[2]);
  tap();
  S.log.length = 0;
  S.H.edit('lo', ps => { ps[0].pads[0].mod.lo = 0.4; return ps; });
  assert.deepEqual([S.H.value('pd1.p0'), mv().at(-1)], [0.4, 0.4], 'A1: a gate pad played once, then its lo edited: the new rest value, in the table');
  S.H.edit('tog', ps => { ps[0].pads[0].mod = { m: 'tog', lo: 0, hi: 1 }; return ps; });
  tap();
  assert.equal(S.H.value('pd1.p0'), 1);
  S.H.edit('hi', ps => { ps[0].pads[0].mod.hi = 0.8; return ps; });
  assert.equal(S.H.value('pd1.p0'), 0.8, 'a toggle left on follows its range');
  S.log.length = 0;
  S.H.edit('gate', ps => { ps[0].pads[0].mod = { m: 'gate', lo: 0.1, hi: 1 }; return ps; });
  assert.deepEqual([S.H.value('pd1.p0'), mv().at(-1), S.H.light('pd1', 0).b], [0.1, 0.1, PC.modBright({ lo: 0.1, hi: 1 }, 0.1)], 'A2: a toggle left on, then another mode: rest at lo — the table and the light too');
  // Modulation off, then on again
  S.H.edit('tog', ps => { ps[0].pads[0].mod = { m: 'tog', lo: 0, hi: 1 }; return ps; });
  tap();
  assert.equal(S.H.value('pd1.p0'), 1);
  S.H.edit('off', ps => { ps[0].pads[0].mod = null; return ps; });
  S.H.edit('on', ps => { ps[0].pads[0].mod = { m: 'vel', lo: 0.2, hi: 1 }; return ps; });
  assert.equal(S.H.value('pd1.p0'), 0.2, 'A3: Modulation off and on again: lo, not the old hi');
  // a deleted module: a new one with the same id inherits nothing
  S.H.edit('tog', ps => { ps[0].pads[0].mod = { m: 'tog', lo: 0, hi: 1 }; return ps; });
  tap();
  S.H.edit('Delete Pads 1', () => []);
  S.H.edit('New', () => [mod44({ 0: { mod: { m: 'tog', lo: 0.3, hi: 1 } } })]);
  assert.equal(S.H.value('pd1.p0'), 0.3, 'a new pd1: its own rest value');
  // a restore (Undo / Redo / Open) swaps project.pads under the host: rebuild() puts every source at the restored pad's rest and posts it
  S.H.edit('tog2', ps => { ps[0].pads[0].mod = { m: 'tog', lo: 0.3, hi: 1 }; return ps; });
  tap();
  assert.equal(S.H.value('pd1.p0'), 1);
  S.P.pads = PC.normPads([mod44({ 0: { mod: { m: 'tog', lo: 0.25, hi: 0.5 } } })]);
  S.log.length = 0;
  S.H.rebuild();
  assert.deepEqual([S.H.value('pd1.p0'), mv().at(-1)], [0.25, 0.25], 'a restore: the restored pad\'s rest value, posted (the memo-hit compile posts no vals)');
});

test('R1-B every release ends the pressure at 0: release() / release({ hw }) after a pen\'s pressure (the bed\'s queued 0 is sent, not dropped), a hardware pad\'s note-off and a lost port; a second hardware pad on the track keeps it until the last ends', () => {
  const ats = S => S.log.filter(x => x[0] === 'ctl' && x[2] === 'at').map(x => x[3]);
  for (const hw of [undefined, { hw: true }]) {
    const S = setup({ pads: [mod44({ 0: chord(60, 'maj') })] });
    down(S, 0, 1, 0.5, { pointerType: 'pen', pressure: 0.6 });
    raf.flush(2);
    assert.ok(ats(S).at(-1) > 0, 'the pen\'s pressure reached the Juno');
    S.H.release(hw);
    raf.flush(2);
    assert.equal(ats(S).at(-1), 0, 'a blur / a restore / a panic: the pressure back at 0 ' + JSON.stringify(hw));
    S.B.destroy();
  }
  const hwPad = n => chord(60, 'maj', 'trk_2', { hw: { port: 'Pads A', ch: 10, n, cc: 0 } });
  const S = setup({ midi: true, noBody: true, pads: [mod44({ 0: hwPad(36), 1: hwPad(37) })] });
  S.H.midiIn({ k: 'on', ch: 10, n: 36, v: 0.8 }, 'Pads A', 0);
  S.H.midiIn({ k: 'pat', ch: 10, n: 36, v: 0.6 }, 'Pads A', 1);
  raf.flush(2);
  assert.equal(ats(S).at(-1), 0.6);
  S.H.midiIn({ k: 'off', ch: 10, n: 36 }, 'Pads A', 2);
  raf.flush(2);
  assert.equal(ats(S).at(-1), 0, 'B2: a hardware pad\'s note-off ends its pressure at 0');
  S.H.midiIn({ k: 'on', ch: 10, n: 36, v: 0.8 }, 'Pads A', 3);
  S.H.midiIn({ k: 'on', ch: 10, n: 37, v: 0.8 }, 'Pads A', 3);
  S.H.midiIn({ k: 'pat', ch: 10, n: 37, v: 0.5 }, 'Pads A', 4);
  raf.flush(2);
  S.H.midiIn({ k: 'off', ch: 10, n: 36 }, 'Pads A', 5);
  raf.flush(2);
  assert.equal(ats(S).at(-1), 0.5, 'the other pad still holds the track: its pressure stays');
  S.H.ports(['Other']);
  raf.flush(2);
  assert.equal(ats(S).at(-1), 0, 'a lost port ends the last one');
  const n = ats(S).length;
  S.H.release({ hw: true });
  raf.flush(2);
  assert.equal(ats(S).length, n, 'nothing pressed: no extra zero');
});

test('R2-F11 a pad whose target track is deleted mid-hold stops showing held (its notes ended); one with another track\'s notes still sounding stays held', () => {
  const S = setup({ pads: [mod44({ 0: drum('bd'), 1: { t: [{ k: 'drum', tr: 'trk_1', s: 'sd' }, { k: 'note', tr: 'trk_2', n: 50 }] }, 2: drum('cp', 'trk_1', { mod: { m: 'gate' } }) })] });
  down(S, 0, 1); down(S, 1, 2); down(S, 2, 3);
  raf.flush(1);
  S.H.endTrack('trk_1');
  raf.flush(1);
  assert.deepEqual([S.H.light('pd1', 0).held, attr(cellOf(S, 0), 'data-l'), S.H.light('pd1', 1).held, S.H.light('pd1', 2).held], [false, 'idle', true, true], 'gone: not held; a note on another track, a mod source: still held');
  up(S, 0, 1); up(S, 1, 2); up(S, 2, 3);
  raf.flush(1);
  assert.deepEqual([S.H.held(), S.H.light('pd1', 1).held, S.H.light('pd1', 2).held], [[], false, false], 'every hold ended with its lift');
});

test('R2-F11 Light "Both": a pad\'s own hit flashes once — the monitor\'s echo of it (within the output latency) adds no second flash; another pad of the sound and a later hit still flash', () => {
  let clock = 0;
  const S = setup({ deps: { now: () => clock }, pads: [mod44({ 0: drum('bd'), 1: drum('bd') })] });
  raf.flush(1);
  const f = i => S.H.light('pd1', i).f;
  down(S, 0, 1); up(S, 0, 1);
  assert.deepEqual([f(0), f(1)], [1, 0]);
  clock += 60;
  S.subs.lit.get('trk_1')(1);
  assert.deepEqual([f(0), f(1)], [1, 1], 'the pressed pad flashed at its hit; the other kick pad flashes with the sound');
  clock += 1000;
  S.subs.lit.get('trk_1')(1);
  assert.deepEqual([f(0), f(1)], [2, 2], 'another source\'s kick, later: both flash');
});

test('R2-F11 the inspector\'s Octave stepper shows the octave (not the literal "oct")', () => {
  const S = setup({ pads: [mod44({ 1: note(60) })] });
  S.B.inspect(1);
  const oct = () => all(S.B.popover()).find(n => n.getAttribute && /^Octave: /.test(n.getAttribute('aria-label') || ''));
  assert.deepEqual([oct().getAttribute('aria-label'), byCls(oct(), 'pd-sv')[0].textContent], ['Octave: 4', 'oct 4']);
  ptr(all(oct()).find(n => n.getAttribute && n.getAttribute('aria-label') === 'Octave up'), 'pointerdown', 0, 0, { pointerType: 'mouse' });
  assert.deepEqual([S.H.module('pd1').pads[1].t[0].n, byCls(oct(), 'pd-sv')[0].textContent], [72, 'oct 5']);
});

test('R2-F1 the footer buttons\' touch areas never reach up over the pads: their top edge stays inside the 16 px between the grid and the footer at every zoom (--ik 1 … 4), the bottom row\'s front edge is the pads\'', () => {
  const S = setup({ noBody: true }), css = C.ensureCSS(S.d).textContent;
  const rule = /\n\.pd-fb::before \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the rule');
  const prop = k => { const m = new RegExp('(?:^|[;\\s])' + k + ':\\s*([^;]+);').exec(rule[1]); return m ? m[1].trim() : null; };
  const BH = 24; // (the button's height: world px)
  const len = (e, IK, base) => Function('return ' + e.replace(/var\(--ik,\s*1\)/g, '(' + IK + ')').replace(/(\d+(?:\.\d+)?)%/g, (m, n) => '(' + n + '/100*' + base + ')').replace(/\bcalc\(/g, '(').replace(/\bmin\(/g, 'Math.min(').replace(/\bmax\(/g, 'Math.max(').replace(/(\d)px/g, '$1'))();
  const F = PC.footprint(4, 4, 1), G = PC.gridOf(4, 4, 1), gap = F.fy - (F.gy + G.h) + (PC.FOOTER - BH) / 2; // (grid bottom → the button's top: 20 world px)
  for (const IK of [1, 1.5, 1.76, 2, 2.5, 3, 4]) {
    const h = len(prop('height'), IK, BH), top = prop('top') ? len(prop('top'), IK, BH) : 0, tf = prop('transform') || '', ty = /translate\(\s*-?\d+%,\s*(-?\d+(?:\.\d+)?)%\s*\)/.exec(tf) ? +/translate\(\s*-?\d+%,\s*(-?\d+(?:\.\d+)?)%\s*\)/.exec(tf)[1] / 100 * h : 0;
    const reach = -(top + ty); // (world px above the button's top)
    assert.ok(reach < gap, `--ik ${IK}: the area reaches ${reach} px above the button, the pads' bottom edge is ${gap} px away`);
    assert.ok(h >= BH, `--ik ${IK}: still at least the button`);
  }
  assert.ok(/width:\s*max\(100%,\s*calc\(44px \* var\(--ik, 1\)\)\)/.test(rule[1]), 'sideways it still grows to 44 screen px');
});

test('R2-F2 a rebuilt module reopens its inspector once the body is in its module — in the top layer beside it, never inside the body over the pads', async () => {
  const S = setup({ noBody: true, pads: [mod44({ 3: note(60) })] });
  const { layer, root } = inWorld(S);
  try {
    Object.assign(S.H.view('pd1'), { edit: true, sel: [3], insp: true });
    const B = C.padsBody({ host: S.H, id: 'pd1', doc: S.d, track: () => 'trk_2' });
    assert.equal(B.popover() === null, true, 'not while the body has no module');
    root.append(B.el); // (main appends the body after padsBody returns)
    await Promise.resolve();
    const box = B.popover();
    assert.ok(!!box, 'reopened');
    assert.deepEqual([box.parentNode === layer, B.el.contains(box)], [true, false], 'in the top layer');
    B.destroy();
    assert.equal(all(S.d.body).some(n => n.classList && n.classList.contains('pd-pop')), false);
  } finally { wk.setLayer(null); }
});

test('R2-F3 the Pads popovers stay on screen: beside the module on its right, flipped to its left with no room, clamped into the window at the bottom (and again when it resizes or the content grows)', () => {
  const S = setup({ noBody: true, pads: [mod44({ 3: note(60) })] });
  const { root } = inWorld(S), win = S.d.defaultView; // (1280 × 800)
  try {
    const B = C.padsBody({ host: S.H, id: 'pd1', doc: S.d, track: () => 'trk_2' });
    root.append(B.el);
    const at1 = (l, t) => { place(root, l, t, 352, 416); B.closePop(); B.inspect(3); const box = B.popover(); return [box, () => [parseFloat(box.style.left), parseFloat(box.style.top)]]; };
    let [box, pos] = at1(200, 100);
    assert.deepEqual(pos(), [562, 100], 'room on the right: beside the module');
    [box, pos] = at1(1100, 100);
    assert.deepEqual(pos(), [790, 100], 'no room on the right: on its left, the same gap');
    [box, pos] = at1(100, 700);
    layout(box, 300, 500);
    win.dispatchEvent(new Ev('resize'));
    assert.deepEqual(pos(), [462, 292], 'the bottom: up into the window (8 px margin); a resize places it again');
    [box, pos] = at1(-120, 100);
    assert.deepEqual(pos(), [242, 100], 'a module off the left edge: beside it');
    place(root, 100, 300, 1100, 416); // no room on either side: clamped into the window (at its right edge)
    win.dispatchEvent(new Ev('resize'));
    assert.deepEqual(pos(), [972, 300]);
    // the other popovers share the placement (Grid…, Velocity…, Fill from…, Hardware…)
    place(root, 1100, 100, 352, 416);
    for (const open of [B.openGrid, B.openVel, B.openFill, B.openHw]) { open(); const b2 = B.popover(); assert.ok(parseFloat(b2.style.left) + 300 <= 1280 - 8, 'on screen'); }
    B.destroy();
  } finally { wk.setLayer(null); }
});

test('R1-E one name for a mod pad: srcLabel, the jacks\' labels (+ " out") and cv-mods\' padSrcLabel agree — "Pads 1 · Kick", the SDS-V\'s "Tom 1", a hidden slot "Pad 41" — and cv-module refreshes a jack\'s label at the next sync with no rebuild', () => {
  const S = setup({ noBody: true, extra: [kitTrack()], pads: [mod44({ 0: drum('bd', 'trk_1', { mod: { m: 'gate' } }), 1: drum('ht', 'trk_4', { mod: {} }), 40: { mod: {} } })] });
  const Pj = S.P, M0 = S.H.module('pd1'), J = C.moduleJacks(M0, undefined, Pj);
  assert.deepEqual(J.slice(0, 3).map(j => j.label), ['Pads 1 · Kick out', 'Pads 1 · Tom 1 out', 'Pads 1 · Pad 41 out']);
  for (const [i, src] of [[0, 'pd1.p0'], [1, 'pd1.p1'], [2, 'pd1.p40']]) {
    assert.equal(J[i].label, MODS.padSrcLabel(Pj, src) + ' out', src);
    assert.equal(C.srcLabel(Pj.pads, src, Pj), MODS.padSrcLabel(Pj, src), src);
    assert.equal(MODS.sourcesOf({ dev: {} }, Pj).find(x => x.id === src).label, MODS.padSrcLabel(Pj, src));
  }
  assert.deepEqual(C.moduleJacks(M0).slice(0, 3).map(j => j.label), J.slice(0, 3).map(j => j.label), 'without a project: the host\'s');
  const T = Pj.tracks[1], root = S.d.createElement('div');
  S.d.body.append(root);
  let mounts = 0;
  const entry = () => ({ key: 'pd1', kind: 'mod', mod: 'pads', model: null, dev: null, jacks: C.moduleJacks(S.H.module('pd1'), undefined, Pj), color: C.PADS_COLOR });
  const V = M.createTrackView(null, T, { root, doc: S.d, project: () => Pj, patch: false, devices: t => M.devicesOf(t).concat([entry()]),
    size: k => (k === 'pd1' ? C.moduleSize(S.H.module('pd1')) : null), bodies: { mount: k => { if (k === 'pd1') mounts++; }, unmount() {} } });
  const pm = V.modules.get('pd1');
  assert.equal(pm.jack('p1').getAttribute('aria-label'), 'Pads 1 · Tom 1 out');
  S.H.edit('label', ps => { ps[0].pads[1].l = 'Boom'; return ps; });
  V.sync(T);
  assert.deepEqual([V.modules.get('pd1') === pm, mounts, pm.jack('p1').getAttribute('aria-label'), V.jacks().find(j => j.id === 'pd1.p1').label], [true, 1, 'Pads 1 · Boom out', 'Pads 1 · Boom out'], 'refreshed, not rebuilt');
  V.destroy();
});

test('R1-F a Pads module following an SDS-V track: the sounds\' short names and each pad in its channel\'s kit colour (cv-drum COLORV → the nearest palette entry), by sound id; Fill from… and the inspector\'s Sound pick the same', () => {
  const kit = kitTrack(), want = { bd: 'Bass drum', sd: 'Snare drum', ht: 'Tom 1', mt: 'Tom 2', lt: 'Tom 3' };
  const colOf = s => PC.nearestColor(CD.COLORV[DC.PERS.sdsv.sounds.indexOf(s)]);
  const D = C.defaultsOf(kit, (t, k) => t.dev[k].drum), byS = {};
  for (const p of D.pads) if (p) byS[p.t[0].s] = p;
  assert.deepEqual([D.rows, D.cols, Object.keys(byS).sort()], [1, 5, Object.keys(want).sort()]);
  for (const [s, nm] of Object.entries(want)) assert.deepEqual([PC.padLabel(byS[s], { tracks: [kit] }), byS[s].c], [nm, colOf(s)], s);
  assert.equal(new Set(['lt', 'mt', 'ht'].map(s => byS[s].c)).size, 3, 'three toms, three colours (the family would make them all amber)');
  assert.deepEqual(C.defaultsOf(tracks()[0], (t, k) => t.dev[k].drum).pads.slice(0, 3).map(p => p.c), [PC.C_RED, PC.C_ORANGE, PC.C_GREEN], 'the 808: the family colours as before (bd, sd, cp)');
  // in the body: the cell shows the short name; Fill from… the SDS-V's sounds; the inspector's Sound
  const S = setup({ extra: [kit], pads: [mod44({ 0: drum('bd', 'trk_4'), 1: drum('lt', 'trk_4') }, { rows: 1, cols: 5 })] });
  assert.deepEqual([0, 1].map(i => attr(cellOf(S, i), 'data-name')), ['Bass drum', 'Tom 3']);
  S.B.openFill();
  const fsel = all(S.B.popover()).find(n => n.localName === 'select' && n.getAttribute('aria-label') === 'Track');
  fsel.value = 'trk_4'; fire(fsel, 'change');
  ptr(all(S.B.popover()).find(n => n.localName === 'button' && n.textContent === 'Its drum sounds'), 'pointerdown', 0, 0, { pointerType: 'mouse' });
  const F = S.H.module('pd1').pads.slice(0, 5);
  assert.deepEqual(F.map(p => [p.t[0].s, p.c]).sort(), Object.keys(want).map(s => [s, colOf(s)]).sort(), 'Fill from…: by sound id');
  S.B.closePop();
  S.B.inspect(0);
  const snd = all(S.B.popover()).find(n => n.localName === 'select' && n.getAttribute('aria-label') === 'Sound');
  snd.value = 'ht'; fire(snd, 'change');
  assert.deepEqual([S.H.module('pd1').pads[0].t[0].s, S.H.module('pd1').pads[0].c], ['ht', colOf('ht')], 'the inspector\'s Sound: that sound\'s kit colour');
});
