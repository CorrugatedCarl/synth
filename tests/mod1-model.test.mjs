import './v8-guard.mjs';
// Stage MOD1 phase 0 (docs/canvas/IMPL-MOD1.md §2.2, §2.3, §5; G3's model half): one LFO, one Envelope, one Macros — the words
// (cv-mods MOD_LABEL / modLabelOf: "Envelope n", "Macros n"; the macro knobs keep "Macro 1" … "Macro 8"), MOD_COLS (each modulator
// face's RIG-grid columns, rig-grid faceW), numsOf (a track's own device numbers of a kind), rig-core's "Macros n" titles and
// nextOrdinal's `taken` (a new rig module numbers around the track's devices: one numbering per canvas), the tray's data (LFO /
// Envelope / Macros first in MOD_TILES; RIG_TILES without them; MASTER_MODS unchanged). Pure tables, no DOM.
// Run alone: node --max-old-space-size=2048 --test tests/mod1-model.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../cv-mods.js?v=9';
import * as R from '../rig-core.js?v=9';
import * as T from '../cv-tray.js?v=9';
import { faceW } from '../rig-grid.js?v=9';

// a track holding every numbered kind (gaps, two macros, an id of the wrong kind: no module) and the singletons
const TRACK = () => ({ dev: { i1: { kind: 'synth', model: 'juno60', vals: {} }, l1: { kind: 'lfo', lfo: {} }, l3: { kind: 'lfo', lfo: {} }, e1: { kind: 'env', env: {} },
  e4: { kind: 'env', env: {} }, m1: { kind: 'macro', v: [], names: ['Cut', '', 'Mix'] }, m2: { kind: 'macro', v: [], names: [] }, c2: { kind: 'cc' }, h1: { kind: 'chaos', chaos: {} },
  ve: { kind: 'velo' }, nt: { kind: 'note' }, l2: { kind: 'env', env: {} }, x9: { kind: 'lfo', lfo: {} } } });

test('MOD1 §2.2 the words: MOD_LABEL env "Envelope", macro "Macros" (every other kind as it was); modLabelOf numbers them; no module is named "ENV" or "Macro"', () => {
  assert.deepEqual(V.MOD_LABEL, { wheel: 'Mod Wheel', velo: 'Velocity', at: 'Aftertouch', bend: 'Bend', note: 'Note', lfo: 'LFO', env: 'Envelope', macro: 'Macros', cc: 'CC', chaos: 'Chaos' });
  assert.ok(Object.isFrozen(V.MOD_LABEL));
  assert.deepEqual([V.modLabelOf('e2'), V.modLabelOf('e1', { kind: 'env' }), V.modLabelOf('m1'), V.modLabelOf('m3', { kind: 'macro' }), V.modLabelOf('l3'), V.modLabelOf('c4'), V.modLabelOf('h2', { kind: 'chaos' })],
    ['Envelope 2', 'Envelope 1', 'Macros 1', 'Macros 3', 'LFO 3', 'CC 4', 'Chaos 2']);
  assert.deepEqual([V.modLabelOf('ve'), V.modLabelOf('at'), V.modLabelOf('bd'), V.modLabelOf('nt'), V.modLabelOf('wheel', { kind: 'wheel' }), V.modLabelOf('i1')], ['Velocity', 'Aftertouch', 'Bend', 'Note', 'Mod Wheel', 'i1']);
  assert.ok(Object.values(V.MOD_LABEL).every(L => L !== 'ENV' && L !== 'Macro'), 'the old words are gone');
});

test('MOD1 §2.2 the sources read the words: a track Envelope "Envelope 1", an unnamed macro knob "Macros 1 · 2" (a named one its name); the knobs\' default names stay "Macro 1" … "Macro 8" (a rig\'s Macros jacks)', () => {
  const t = TRACK(), S = V.sourcesOf(t, {});
  const lab = id => (S.find(x => x.id === id) || {}).label;
  assert.deepEqual([lab('e1.out'), lab('e4.out'), lab('l3.out'), lab('c2.out'), lab('h1.out'), lab('ve.out'), lab('nt.out')], ['Envelope 1', 'Envelope 4', 'LFO 3', 'CC 2', 'Chaos 1', 'Velocity', 'Note']);
  assert.deepEqual(['m1.k1', 'm1.k2', 'm1.k3', 'm2.k8'].map(lab), ['Cut', 'Macros 1 · 2', 'Mix', 'Macros 2 · 8']);
  assert.deepEqual(R.MODULES.macros.jacks.out.map(j => j.label), ['Macro 1', 'Macro 2', 'Macro 3', 'Macro 4', 'Macro 5', 'Macro 6', 'Macro 7', 'Macro 8'], 'they name knobs');
});

test('MOD1 §2.3 MOD_COLS: every modulator kind\'s face columns on the RIG grid (frozen data; widths 64·cols + 32) — (reviewer 2) none under 3: a 2-column bar held no "AFTERTOUCH" / "MOD WHEEL"', () => {
  assert.deepEqual(V.MOD_COLS, { lfo: 5, env: 5, macro: 4, chaos: 3, wheel: 3, velo: 3, at: 3, bend: 3, note: 3, cc: 3 });
  assert.ok(Object.isFrozen(V.MOD_COLS));
  assert.deepEqual(Object.keys(V.MOD_COLS).sort(), Object.keys(V.MOD_LABEL).sort(), 'one per modulator kind');
  assert.deepEqual([...V.MOD_ORDER].sort(), Object.keys(V.MOD_COLS).sort(), 'and MOD_ORDER\'s kinds');
  assert.deepEqual(['lfo', 'env', 'macro', 'chaos', 'wheel', 'velo', 'at', 'bend', 'note', 'cc'].map(k => faceW(V.MOD_COLS[k])), [352, 352, 288, 224, 224, 224, 224, 224, 224, 224]);
  assert.deepEqual([V.MOD_COLS.lfo, V.MOD_COLS.env, V.MOD_COLS.macro], [R.MODULES.lfo.cols, R.MODULES.env.cols, R.MODULES.macros.cols], 'a rig\'s LFO / Envelope / Macros: the same face width');
});

test('(reviewer 2) modBarSub(kind): a modulator\'s bar shows its sub-label (the track\'s name) on a face of 4 or more columns only — a 3-column bar holds its title alone', () => {
  assert.deepEqual(V.MOD_ORDER.filter(k => V.modBarSub(k)), ['lfo', 'env', 'macro']);
  assert.deepEqual([V.modBarSub('nope'), V.modBarSub(undefined)], [false, false]);
});

test('(reviewer 1 P2) linkSources on a <NAME>: its LFOs / Envelopes only where a module of them stands on its canvas (rig-core partKeys: laid, a slot a matrix row or a track row reads, ENV 1 unless the gate), titled by dev.rig.n; a title a track module shows already is told apart (" · <name>"); a Serum keeps all fourteen', () => {
  const s = R.rigBlank();
  s.matrix = [{ src: 'lfo4', dst: 'a.level', amt: 0.5 }];
  const t = { dev: { i1: { kind: 'synth', model: R.RIG.ID, vals: { s }, rig: { v: 1, cc: {}, n: { lfo1: 2 } } }, l2: { kind: 'lfo', lfo: {} } },
    lay: { i1: { x: 0, y: 0 }, 'i1/lfo1': { x: -400, y: 0 } }, mods: [{ id: 'r1', src: 'i1/env3.out', dst: 'i1:f.cutoff' }] };
  const L = () => V.linkSources(t).map(x => x.link + '=' + x.label + (x.used ? '*' : '')).join(' ');
  assert.equal(L(), `lfo1=LFO 2 · ${R.RIG.NAME} lfo4=LFO 4* env3=Envelope 3`, 'LFO 1 laid (its number 2: a track LFO 2 too), LFO 4 a matrix row\'s, Envelope 3 a track row\'s; ENV 1 the gate, unread');
  delete t.dev.l2;
  t.dev.i1.rig.n = {};
  t.dev.i1.vals.s = Object.assign(R.rigStarter({}).s, { matrix: [] }); // (the starter: Envelope 1 on LEVEL, not the gate)
  assert.equal(L(), 'lfo1=LFO 1 env1=Envelope 1* env3=Envelope 3');
  // ((SX0) "a Serum: every LFO and ENV slot" is removed with the bundled model: no device but a rig runs the engine on canvas)
});

test('MOD1 §2.2 numsOf(track, kind): the numbers a track\'s own devices of a kind show, ascending; "macros" (a rig\'s kind) reads the macro devices; [] for a singleton, an unknown kind, no track', () => {
  const t = TRACK();
  assert.deepEqual(['lfo', 'env', 'macro', 'macros', 'cc', 'chaos'].map(k => V.numsOf(t, k)), [[1, 3], [1, 4], [1, 2], [1, 2], [2], [1]], 'l2 (an env) and x9 are no modules');
  assert.deepEqual(['wheel', 'velo', 'at', 'bend', 'note', 'osc', 'bogus', undefined].map(k => V.numsOf(t, k)), [[], [], [], [], [], [], [], []]);
  assert.deepEqual([V.numsOf(null, 'lfo'), V.numsOf({}, 'lfo'), V.numsOf({ dev: null }, 'env'), V.numsOf({ dev: { l7: { kind: 'lfo' }, l2: { kind: 'lfo' } } }, 'lfo')], [[], [], [], [2, 7]]);
});

test('MOD1 §2.2 rig-core: MODULES.macros numbered ("Macros n"; its generic label stays "Macros"); labelOf / barOf / nameOf read the ordinal (dev.rig.n.macros, else 1)', () => {
  const M = R.MODULES.macros;
  assert.deepEqual([M.label, typeof M.labelN, M.labelN(1), M.labelN(3)], ['Macros', 'function', 'Macros 1', 'Macros 3']);
  assert.deepEqual([R.labelOf('macros', null), R.labelOf('macros', { n: { macros: 2 } }), R.barOf('macros', null), R.nameOf({ n: { macros: 4 } }, 'i1/macros'), R.ordinalOf(null, 'macros')],
    ['Macros 1', 'Macros 2', 'Macros 1', 'Macros 4', 1]);
  assert.deepEqual(R.normRig({ n: { macros: 2, lfo3: 5 } }).n, { macros: 2, lfo3: 5 }, 'dev.rig.n holds any kind\'s ordinal');
  assert.equal(T.rigFull('macros'), 'Macros is on the canvas', 'a one-off\'s text keeps the generic label');
});

test('MOD1 §2.2 nextOrdinal(rig, kind, parts, taken): the lowest 1…99 that no rig module of the kind shows and no track device of the kind holds — one numbering on the canvas; without `taken` as before', () => {
  const t = TRACK(), rig = { v: 1, cc: {}, n: { env2: 5 } };
  assert.deepEqual([R.nextOrdinal(null, 'lfo', ['lfo1'], [2, 3]), R.nextOrdinal(null, 'lfo', ['lfo1'], V.numsOf(t, 'lfo')), R.nextOrdinal(null, 'lfo', [], V.numsOf(t, 'lfo'))], [4, 2, 2]);
  assert.deepEqual([R.nextOrdinal(null, 'env', [], [1]), R.nextOrdinal(rig, 'env', ['env2'], [1]), R.nextOrdinal(rig, 'env', ['env2'], V.numsOf(t, 'env')), R.nextOrdinal(rig, 'env', ['env1', 'env2'], [2, 3])],
    [2, 2, 2, 4], 'a starter\'s amp Envelope beside a track "Envelope 1" reads "Envelope 2"');
  assert.deepEqual([R.nextOrdinal(null, 'macros', [], V.numsOf(t, 'macros')), R.nextOrdinal(null, 'macros', [], []), R.nextOrdinal(null, 'macros', [], V.numsOf({ dev: {} }, 'macros'))], [3, 1, 1], 'macros ↔ the track\'s macro devices');
  assert.deepEqual([R.nextOrdinal(null, 'lfo', ['env1', 'lfo2'], [1]), R.nextOrdinal(null, 'lfo', ['lfo1'], new Set([2])), R.nextOrdinal(null, 'lfo', [], [0, -1, 2.5, '1', null, 100])], [3, 3, 1], 'other kinds\' parts never count; a Set works; garbage ignored');
  assert.deepEqual([R.nextOrdinal(rig, 'env', ['env2']), R.nextOrdinal(rig, 'env', ['env2'], undefined), R.nextOrdinal(rig, 'env', ['env2'], null), R.nextOrdinal(null, 'lfo', ['lfo1', 'lfo2', 'lfo5'], [])], [1, 1, 1, 3], 'no `taken`: the rig alone (WC\'s rule)');
  assert.equal(R.nextOrdinal(null, 'lfo', [], Array.from({ length: 99 }, (_, i) => i + 1)), 99, 'all taken: 99, as the rig\'s own bound');
});

test('MOD1 §5 the tray\'s data: MOD_TILES — LFO · Envelope · Macros first, then Mod Wheel, Velocity, Aftertouch, Bend, Note, CC, Chaos (names = MOD_LABEL); RIG_TILES without env / lfo / macros (Oscillator, Sub oscillator, Noise, Filter; Note tools as before); MASTER_MODS unchanged', () => {
  assert.deepEqual(T.MOD_TILES.map(m => [m.id, m.name, m.scope, !!m.multi]), [['lfo', 'LFO', 'track', true], ['env', 'Envelope', 'track', true], ['macro', 'Macros', 'track', true],
    ['wheel', 'Mod Wheel', 'project', false], ['velo', 'Velocity', 'track', false], ['at', 'Aftertouch', 'track', false], ['bend', 'Bend', 'track', false], ['note', 'Note', 'track', false],
    ['cc', 'CC', 'track', true], ['chaos', 'Chaos', 'track', true]]);
  assert.ok(T.MOD_TILES.every(m => m.name === V.MOD_LABEL[m.id] && Object.isFrozen(m)) && Object.isFrozen(T.MOD_TILES), 'one wording: MOD_LABEL');
  assert.deepEqual(T.MOD_TILES.filter(m => m.multi).map(m => m.id).sort(), [...V.MOD_MULTI].sort(), 'multi = MOD_MULTI');
  assert.deepEqual(T.RIG_TILES.map(p => [p.id, p.name, p.group, p.cut]), [['osc', 'Oscillator', 'rigmods', 1], ['sub', 'Sub oscillator', 'rigmods', 1], ['noise', 'Noise', 'rigmods', 1],
    ['filter', 'Filter', 'rigmods', 1], ['arp', 'Arpeggiator', 'rignotes', 2], ['clip', 'Clip sequencer', 'rignotes', 2]]);
  assert.ok(T.RIG_TILES.every(p => !['env', 'lfo', 'macros'].includes(p.id)), 'one tile per type: the modulators are the Modulators\' tiles');
  assert.ok(T.RIG_TILES.every(p => p.name === R.MODULES[p.id].label && Object.isFrozen(p)) && Object.isFrozen(T.RIG_TILES));
  assert.deepEqual([...T.MASTER_MODS], ['lfo', 'macro', 'cc', 'chaos']);
  assert.ok(T.MASTER_MODS.every(id => T.MOD_TILES.some(m => m.id === id && m.multi)));
});
