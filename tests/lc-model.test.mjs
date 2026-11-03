import './v8-guard.mjs';
// Stage LC phase 0 (docs/canvas/IMPL-LC.md §2, §4.1–4.2's refusals, §8.1's tile; G8's model half, G9's tray words): the Combiner's data —
// the kind 'comb' under the id prefix x (x1, x2 …: "Combiner n"), last in MOD_ORDER, 6 columns (416 px); song.normModDev's record { kind,
// mode 'add' | 'mul', win 0.5 | 1 | 2 | 4, mark null | { t, n } } (Off by default: Q3), the master takes it; cv-graph kindOf 'mod'; cv-mods
// destOk (the one modulator destination: '<id>:in'), cmbSrcOk (LFOs only, each once), inputsOf (the IN's rows in t.mods order), srcDev /
// perNoteOf (GLOBAL); cv-cables keyKind / MOD_COLOR; cv-tray's tile after Macros, the master's, MASTER_NOTE; cv-model addModDev's seed,
// addMod's IN row (+100 %, no knob rules), its refusals and budgets (10 ModCore LFOs, 16 value sources: the pad precedent), the rows going
// with the device. Pure tables and models, no DOM, no sim.
// Run alone: node --max-old-space-size=2048 --test tests/lc-model.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../cv-mods.js?v=9';
import * as G from '../cv-graph.js?v=9';
import * as CB from '../cv-cables.js?v=9';
import * as T from '../cv-tray.js?v=9';
import * as MO from '../cv-model.js?v=9';
import * as S from '../song.js?v=9';
import * as C from '../serum-core.js?v=9';
import { RIG } from '../rig-core.js?v=9';
import { faceW } from '../rig-grid.js?v=9';

const jclone = x => JSON.parse(JSON.stringify(x));
const OLD = ['wheel', 'velo', 'at', 'bend', 'note', 'lfo', 'env', 'macro', 'cc', 'chaos'];
const COMB = { kind: 'comb', mode: 'add', win: 1, mark: null };
// a Juno track (i1) with a <NAME> (i2: its LFO 1 GLOBAL, LFO 2 per voice), two track LFOs (l1 GLOBAL, l3 PER NOTE), every other
// kind, two combiners and a device of the wrong prefix each way (no module)
function track() {
  const s = C.normalizeSerum(C.defaultSerum());
  s.lfo[0].mono = 1;
  const dev = { i1: { kind: 'synth', model: 'juno60', vals: {} }, i2: { kind: 'synth', model: RIG.ID, vals: { s } }, l1: S.normModDev({ kind: 'lfo', lfo: { mono: 1 } }),
    l3: S.normModDev({ kind: 'lfo', lfo: { mono: 0 } }), e1: S.normModDev({ kind: 'env' }), m1: S.normModDev({ kind: 'macro' }), c1: S.normModDev({ kind: 'cc' }),
    h1: S.normModDev({ kind: 'chaos', chaos: { mono: 1 } }), nt: { kind: 'note' }, ve: { kind: 'velo' }, at: { kind: 'at' }, bd: { kind: 'bend' },
    x1: S.normModDev({ kind: 'comb' }), x2: S.normModDev({ kind: 'comb', mode: 'mul' }), x9: { kind: 'lfo', lfo: {} }, l9: { kind: 'comb' } };
  return { id: 'trk_1', dev, mods: [], mid: 1 };
}
const row = (id, src, dst, amt = 1, byp = 0) => ({ id, src, dst, amt, bi: 0, curve: 0, aux: '', inv: 0, byp, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 });

test('LC §2.1 the registries: kind comb, prefix x (numbered: MOD_MULTI), label "Combiner" ("Combiner n"), last in MOD_ORDER (no kind moves), 6 columns (faceW 416, a sub-label); the ids x1 … only; every other kind as it was', () => {
  assert.equal(V.MOD_LABEL.comb, 'Combiner');
  assert.deepEqual([V.MOD_PREFIX.comb, V.MOD_MULTI.includes('comb'), V.MOD_ORDER.at(-1), V.MOD_ORDER.slice(0, -1), V.MOD_COLS.comb, faceW(V.MOD_COLS.comb), V.modBarSub('comb')],
    ['x', true, 'comb', OLD, 6, 416, true]);
  assert.deepEqual(Object.keys(V.MOD_LABEL).filter(k => k !== 'comb').sort(), [...OLD].sort(), 'one kind more, none renamed');
  assert.ok([V.MOD_LABEL, V.MOD_PREFIX, V.MOD_MULTI, V.MOD_ORDER, V.MOD_COLS].every(Object.isFrozen));
  assert.deepEqual(['x1', 'x2', 'x12', 'x999999', 'x', 'x0', 'x01', 'xx1', 'X1', 'x1/lfo1', 'l1', 'h2'].map(V.kindOfId), ['comb', 'comb', 'comb', 'comb', null, null, null, null, null, null, 'lfo', 'chaos']);
  assert.deepEqual([V.modLabelOf('x1'), V.modLabelOf('x3', { kind: 'comb' }), V.modLabelOf('x2', { kind: 'comb', name: 'Pump' })], ['Combiner 1', 'Combiner 3', 'Combiner 2'], 'titles from the number (MOD1\'s rule)');
  const t = track();
  assert.deepEqual(V.modDevs(t).map(x => x.id), ['ve', 'at', 'bd', 'nt', 'l1', 'l3', 'e1', 'm1', 'c1', 'h1', 'x1', 'x2'], 'Tidy order, the combiners last; x9 (an LFO) and l9 (a combiner) are no modules');
  assert.deepEqual([V.numsOf(t, 'comb'), V.numsOf(t, 'lfo')], [[1, 2], [1, 3]]);
});

test('LC §2.1 cv-graph MOD_KINDS (phase 0: cv-model kindOf / setModState / removeModDev read it) and cv-cables\' data lines (MOD_PREFIX, keyKind [lemchx], a colour of its own)', () => {
  assert.deepEqual([G.MOD_KINDS.has('comb'), G.kindOf({ kind: 'comb' }), G.kindOf({ kind: 'combo' })], [true, 'mod', null]);
  assert.deepEqual([CB.MOD_PREFIX.comb, CB.keyKind('x1'), CB.keyKind('x10'), CB.keyKind('x'), CB.keyKind('x0'), CB.keyKind('x01'), CB.srcKind('x1.out'), CB.modSrcKey('x2.out')], ['x', 'comb', 'comb', null, null, null, 'comb', 'x2']);
  const cols = Object.values(CB.MOD_COLOR);
  assert.deepEqual([typeof CB.MOD_COLOR.comb, /^#[0-9a-f]{6}$/.test(CB.MOD_COLOR.comb), new Set(cols).size, cols.length], ['string', true, 11, 11], 'eleven distinct colours');
  const { wheel, ...pre } = CB.MOD_PREFIX;
  assert.deepEqual([wheel, pre], ['wheel', Object.assign({}, V.MOD_PREFIX)], 'one prefix table in both (the wheel cv-cables\' own key)');
});

test('LC §2.1 song.normModDev: { kind, mode add | mul (add), win 0.5 | 1 | 2 | 4 bars (1), mark null (Off: Q3) | { t: a track id or \'\', n: −1 every note | 0…127 } } — anything else the defaults; a name kept; extra keys dropped', () => {
  assert.deepEqual(S.normModDev({ kind: 'comb' }), COMB);
  assert.deepEqual(S.normModDev({ kind: 'comb', mode: 'mul', win: 0.5, mark: { t: 'trk_2', n: 36 }, name: 'Pump', lfo: { mono: 1 }, v: [1], foo: 3 }),
    { kind: 'comb', mode: 'mul', win: 0.5, mark: { t: 'trk_2', n: 36 }, name: 'Pump' });
  assert.deepEqual([2, 4, 1, 0.5, 3, 8, 0, -1, '2', null, NaN, 0.25].map(win => S.normModDev({ kind: 'comb', win }).win), [2, 4, 1, 0.5, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(['mul', 'add', 'MUL', 'min', 1, null].map(mode => S.normModDev({ kind: 'comb', mode }).mode), ['mul', 'add', 'add', 'add', 'add', 'add']);
  const mk = mark => S.normModDev({ kind: 'comb', mark }).mark;
  assert.deepEqual([mk({ t: 'trk_2' }), mk({ t: '', n: 127 }), mk({ t: 'trk_3', n: 0 }), mk({ t: 'trk_3', n: -1 }), mk({ t: 'trk_3', n: 128 }), mk({ t: 'trk_3', n: 12.5 }), mk({ t: 'trk_3', n: '36' }), mk({ t: 'trk_4', n: 40, x: 1 })],
    [{ t: 'trk_2', n: -1 }, { t: '', n: 127 }, { t: 'trk_3', n: 0 }, { t: 'trk_3', n: -1 }, { t: 'trk_3', n: -1 }, { t: 'trk_3', n: -1 }, { t: 'trk_3', n: -1 }, { t: 'trk_4', n: 40 }]);
  assert.deepEqual([mk(null), mk(undefined), mk('trk_2'), mk({ t: 5 }), mk({ t: 'a b' }), mk({ t: '__proto__' }), mk({ n: 3 }), mk([1])], [null, null, null, null, null, null, null, null], 'no track: Off');
  const o = S.normModDev({ kind: 'comb', mode: 'mul', win: 4, mark: { t: 'trk_9', n: 3 } });
  assert.deepEqual([S.normModDev(o), S.normModDev(jclone(o))], [o, o], 'idempotent, JSON-clean');
  assert.deepEqual(S.normModDev({ kind: 'combx', mode: 'mul' }), { kind: 'combx', mode: 'mul' }, 'an unknown kind stays plain data, as before');
});

test('LC §2.1 a track\'s comb device and its rows through normDev (the load path: kept, bounded); the master takes it (MASTER_MOD_KINDS + comb, ids x1 …), a combiner under another prefix or an LFO under x dropped', () => {
  const r = S.normDev({ dev: { i1: { kind: 'synth', model: 'juno60', vals: {} }, l1: { kind: 'lfo', lfo: { mono: 1 } }, x1: { kind: 'comb', win: 2, mark: { t: 'trk_1', n: 36 } }, out: { kind: 'out' } },
    wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }], mods: [row('r1', 'l1.out', 'x1:in', -0.5), row('r2', 'x1.out', 'i1:cf', 0.3)] });
  assert.deepEqual([r.dev.x1, r.mods.map(x => x.id + ':' + x.src + '>' + x.dst + ':' + x.amt).join(' ')], [{ kind: 'comb', mode: 'add', win: 2, mark: { t: 'trk_1', n: 36 } }, 'r1:l1.out>x1:in:-0.5 r2:x1.out>i1:cf:0.3']);
  assert.deepEqual(S.MASTER_MOD_KINDS.slice(), ['lfo', 'macro', 'cc', 'chaos', 'comb']);
  assert.ok(Object.isFrozen(S.MASTER_MOD_KINDS));
  const m = S.normMaster({ mdev: { l1: { kind: 'lfo' }, x1: { kind: 'comb', mode: 'mul' }, x12: { kind: 'comb' }, l5: { kind: 'comb' }, x2: { kind: 'lfo' }, x0: { kind: 'comb' } },
    mods: [row('r1', 'l1.out', 'x1:in'), row('r2', 'x1.out', 'mfx:fx.dly.mix', 0.4)] });
  assert.deepEqual([Object.keys(m.mdev), m.mdev.x1, m.mdev.x12, m.mods.length, m.mid], [['l1', 'x1', 'x12'], { kind: 'comb', mode: 'mul', win: 1, mark: null }, COMB, 2, 3]);
});

test('LC §2.1 srcDev / perNoteOf / sourcesOf: a combiner\'s OUT \'x1.out\' is a source (kind comb, GLOBAL: false), listed after the Chaos ("Combiner 1"); its IN or another port is none', () => {
  const t = track();
  assert.deepEqual(V.srcDev(t, 'x1.out'), { q: { dev: 'x1', port: 'out', link: '' }, dev: t.dev.x1, kind: 'comb' });
  assert.deepEqual([V.srcDev(t, 'x1.in'), V.srcDev(t, 'x1.k1'), V.srcDev(t, 'x7.out'), V.srcDev(t, 'l9.out'), V.srcDev(t, 'x9.out')], [null, null, null, null, null]);
  assert.deepEqual([V.perNoteOf(t, 'x1.out'), V.perNoteOf(t, 'x2.out'), V.perNoteOf(t, 'x7.out')], [false, false, null]);
  const L = V.sourcesOf(t, {});
  assert.deepEqual(L.slice(-3).map(x => [x.id, x.label, x.kind, x.perNote]), [['h1.out', 'Chaos 1', 'chaos', false], ['x1.out', 'Combiner 1', 'comb', false], ['x2.out', 'Combiner 2', 'comb', false]]);
});

test('LC §2.2 destOk: a combiner\'s \'in\' is the one modulator destination (kept rows too); its every other id, and an \'in\' on any other modulator kind, NOMOD_MOD as before', () => {
  for (const keep of [false, true]) {
    assert.deepEqual(V.destOk({ kind: 'comb' }, 'in', keep), { ok: true, why: '', stage: null });
    for (const id of ['out', 'mode', 'win', 'x', 'in2', 'In', 'l1.rate']) assert.deepEqual(V.destOk({ kind: 'comb' }, id, keep), { ok: false, why: V.NOMOD_MOD, stage: null }, id);
    for (const kind of OLD) assert.deepEqual(V.destOk({ kind, lfo: {}, env: {} }, 'in', keep), { ok: false, why: V.NOMOD_MOD, stage: null }, kind);
  }
  assert.equal(V.destOk({ kind: 'comb' }, '').ok, false);
});

test('LC §2.2 cmbSrcOk(t, src, id): a track LFO (GLOBAL or PER NOTE) and a <NAME>\'s LFO link are inputs; everything else "A combiner takes LFOs" (no cycles); the same LFO twice into one combiner "That LFO is already plugged in" — into another combiner fine', () => {
  const t = track(), ok = { ok: true, why: '' }, lfos = { ok: false, why: 'A combiner takes LFOs' };
  assert.deepEqual(['l1.out', 'l3.out', 'i2/lfo1.out', 'i2/lfo2.out'].map(s => V.cmbSrcOk(t, s, 'x1')), [ok, ok, ok, ok]);
  for (const s of ['e1.out', 'm1.k1', 'c1.out', 'h1.out', 'wheel', 've.out', 'at.out', 'bd.out', 'nt.out', 'pd1.p0', 'x2.out', 'x1.out', 'i2/env1.out', 'i2/env2.out', 'i1/lfo1.out', 'x9.out', 'l7.out', 'l1.k1', '', null])
    assert.deepEqual(V.cmbSrcOk(t, s, 'x1'), lfos, String(s));
  t.mods.push(row('r1', 'l1.out', 'x1:in'), row('r2', 'i2/lfo1.out', 'x1:in', 0.5, 1));
  assert.deepEqual([V.cmbSrcOk(t, 'l1.out', 'x1'), V.cmbSrcOk(t, 'i2/lfo1.out', 'x1'), V.cmbSrcOk(t, 'l1.out', 'x2'), V.cmbSrcOk(t, 'l3.out', 'x1')],
    [{ ok: false, why: 'That LFO is already plugged in' }, { ok: false, why: 'That LFO is already plugged in' }, ok, ok], 'a muted input is plugged in too');
  assert.deepEqual([V.cmbSrcOk(t, 'l1.out', 'x7'), V.cmbSrcOk(t, 'l1.out', 'l9'), V.cmbSrcOk(t, 'l1.out', 'l1'), V.cmbSrcOk(null, 'l1.out', 'x1')].map(r => r.ok), [false, false, false, false], 'no such combiner');
  assert.deepEqual([V.CMB_LFOS, V.CMB_TWICE], ['A combiner takes LFOs', 'That LFO is already plugged in']);
});

test('LC §2.2 inputsOf(t, id): the rows into \'<id>:in\' in t.mods order (the face\'s list, the payload\'s) — the row objects; a row from no LFO, or the same LFO again, is no input; [] for no combiner', () => {
  const t = track();
  t.mods.push(row('r1', 'l3.out', 'x1:in', -0.5), row('r2', 'l1.out', 'i1:cf', 0.25), row('r3', 'i2/lfo2.out', 'x1:in', 0.3, 1), row('r4', 'l1.out', 'x2:in'), row('r5', 'e1.out', 'x1:in'),
    row('r6', 'l1.out', 'x1:in'), row('r7', 'l3.out', 'x1:in'), row('r8', 'x1.out', 'i1:cf'), row('r9', 'l7.out', 'x1:in'));
  const I = V.inputsOf(t, 'x1');
  assert.deepEqual(I.map(r => r.id), ['r1', 'r3', 'r6']);
  assert.ok(I[0] === t.mods[0] && I[1] === t.mods[2], 'the rows themselves (edits go through them)');
  assert.deepEqual([V.inputsOf(t, 'x2').map(r => r.id), V.inputsOf(t, 'x7'), V.inputsOf(t, 'l1'), V.inputsOf(t, 'l9'), V.inputsOf({ dev: { x1: COMB } }, 'x1'), V.inputsOf(null, 'x1')], [['r4'], [], [], [], [], []]);
});

test('LC §2.1 cv-model addModDev(t, \'comb\'): x1, x2 … (the highest + 1), the default record; kindOf mod; setModState bounds mode / win / mark (one level merged; null = Off); removeModDev drops its rows in and out (and its place)', () => {
  const t = MO.adopt({ tracks: [S.newTrack(null, { model: 'juno60' })] }).tracks[0];
  assert.deepEqual(['comb', 'comb', 'lfo', 'comb'].map(k => MO.addModDev(t, k)), ['x1', 'x2', 'l1', 'x3']);
  assert.deepEqual([t.dev.x1, G.kindOf(t.dev.x2)], [COMB, 'mod']);
  const d = t.dev.x1;
  assert.deepEqual(MO.setModState(t, 'x1', { mode: 'mul', win: 4, mark: { t: 'trk_2', n: 36 } }), { ok: true, why: '' });
  assert.deepEqual([t.dev.x1 === d, d], [true, { kind: 'comb', mode: 'mul', win: 4, mark: { t: 'trk_2', n: 36 } }]);
  MO.setModState(t, 'x1', { mark: { n: 38 }, kind: 'lfo' });
  assert.deepEqual(d, { kind: 'comb', mode: 'mul', win: 4, mark: { t: 'trk_2', n: 38 } }, 'merged one level; the kind stays');
  MO.setModState(t, 'x1', { win: 3, mode: 'max', mark: null });
  assert.deepEqual(d, COMB, 'bounded: the defaults; mark null = Off');
  const i1 = Object.keys(t.dev).find(k => t.dev[k].kind === 'synth');
  t.mods = [row('r1', 'l1.out', 'x1:in'), row('r2', 'x1.out', i1 + ':cf'), row('r3', 'l1.out', 'x2:in'), row('r4', 'l1.out', i1 + ':rs')];
  t.lay = Object.assign(t.lay || {}, { x1: { x: -448, y: 0 } });
  assert.deepEqual(MO.removeModDev(t, 'x1'), { ok: true, why: '', rows: ['r1', 'r2'] });
  assert.deepEqual([t.mods.map(r => r.id), 'x1' in t.dev, 'x1' in t.lay], [['r3', 'r4'], false, false]);
  assert.deepEqual(MO.removeModDev(t, 'l1'), { ok: true, why: '', rows: ['r3', 'r4'] }, 'an input LFO deleted: its input row goes');
  assert.equal(MO.addModDev(t, 'comb'), 'x4', 'a removed number comes round again only past the highest');
});

test('LC §2.2 addMod(t, lfo, \'<id>:in\'): a row of normRow\'s fields at +100 % (not the knob rules: bi 0, no curve, out 1), o.amt (−1…1) and o.byp kept; refusals with §2.2\'s words, the track untouched', () => {
  const t = track(), ids = () => t.mods.map(r => r.id).join() + '|' + t.mid;
  const a = MO.addMod(t, 'l1.out', 'x1:in');
  assert.deepEqual([a.ok, a.code, a.row], [true, null, row('r1', 'l1.out', 'x1:in')]);
  assert.deepEqual([MO.addMod(t, 'l3.out', 'x1:in', { amt: -0.5 }).row.amt, MO.addMod(t, 'i2/lfo1.out', 'x1:in', { amt: 3, byp: 1, bi: 1, curve: 0.5, rise: 0.2 }).row], [-0.5, row('r3', 'i2/lfo1.out', 'x1:in', 1, 1)]);
  assert.deepEqual(V.inputsOf(t, 'x1').map(r => r.src), ['l1.out', 'l3.out', 'i2/lfo1.out']);
  const was = ids(), no = (src, dst) => { const r = MO.addMod(t, src, dst); return [r.ok, r.code, r.why, r.row]; };
  assert.deepEqual(no('l1.out', 'x1:in'), [false, 'src', 'That LFO is already plugged in', null]);
  for (const s of ['e1.out', 'm1.k2', 'c1.out', 'h1.out', 've.out', 'nt.out', 'x2.out', 'i2/env2.out']) assert.deepEqual(no(s, 'x1:in'), [false, 'src', 'A combiner takes LFOs', null], s);
  assert.deepEqual([no('l7.out', 'x1:in')[1], no('l1.out', 'x1:mode'), no('l1.out', 'x7:in')[1], no('l1.out', 'l9:in')[1], no('l1.out', 'l1:in')], [
    'src', [false, 'nomod', V.NOMOD_MOD, null], 'end', 'end', [false, 'nomod', V.NOMOD_MOD, null]]);
  assert.equal(ids(), was, 'no row, no id spent');
  assert.equal(MO.addMod(t, 'l1.out', 'x2:in').ok, true, 'the same LFO into another combiner');
});

test('LC §4.2 the input budget (the pad precedent): an input that needs a ModCore LFO slot of its own while the track runs 10 is refused at the drop — "That LFO can’t join: this track runs 10 LFOs", code slots, no row; a GLOBAL LFO already evaluated takes none; a PER NOTE one a GLOBAL twin', () => {
  const t = MO.adopt({ tracks: [S.newTrack(null, { model: 'juno60' })] }).tracks[0], i1 = Object.keys(t.dev).find(k => t.dev[k].kind === 'synth');
  for (let k = 1; k <= 11; k++) MO.addModDev(t, 'lfo');
  MO.addModDev(t, 'comb');
  MO.setModState(t, 'l4', { lfo: { mono: 0 } }); // (PER NOTE)
  for (let k = 1; k <= 10; k++) assert.ok(MO.addMod(t, 'l' + k + '.out', i1 + ':cf').ok, 'l' + k);
  assert.deepEqual([G.compileMods(t).n.lfo, G.compileMods(t).left], [10, []], 'ten slots, every cable placed');
  const was = JSON.stringify(t), r = MO.addMod(t, 'l11.out', 'x1:in');
  assert.deepEqual([r.ok, r.code, r.why, r.row, JSON.stringify(t) === was], [false, 'slots', 'That LFO can’t join: this track runs 10 LFOs', null, true]);
  assert.equal(MO.CMB_FULL, 'That LFO can’t join: this track runs 10 LFOs');
  const p = MO.addMod(t, 'l4.out', 'x1:in');
  assert.deepEqual([p.ok, p.code, p.why], [false, 'slots', MO.CMB_FULL], 'PER NOTE: its GLOBAL twin is an eleventh slot');
  assert.equal(MO.addMod(t, 'l2.out', 'x1:in').ok, true, 'a GLOBAL LFO already evaluated (its direct cable) shares its slot');
  assert.deepEqual([G.compileMods(t).left, G.compileMods(t).n.lfo], [[], 10], 'every existing cable keeps its slot');
  MO.removeMod(t, t.mods.find(x => x.src === 'l10.out').id);
  assert.equal(MO.addMod(t, 'l11.out', 'x1:in').ok, true, 'a slot free: it joins');
});

test('LC §4.1 the OUT\'s budget (the pad precedent): the combiner\'s first OUT cord while the track\'s 16 value sources are taken is refused — "This track’s value sources are full (16/16)", code slots, no row; under 16 it is a knob cable by the knob\'s rules', () => {
  const t = MO.adopt({ tracks: [S.newTrack(null, { model: 'juno60' })] }).tracks[0], i1 = Object.keys(t.dev).find(k => t.dev[k].kind === 'synth');
  MO.addModDev(t, 'comb');
  for (let k = 1; k <= 16; k++) { MO.addModDev(t, 'cc'); assert.ok(MO.addMod(t, 'c' + k + '.out', i1 + ':cf').ok, 'c' + k); }
  assert.equal(G.compileMods(t).n.vals, 16);
  const was = JSON.stringify(t), r = MO.addMod(t, 'x1.out', i1 + ':rs');
  assert.deepEqual([r.ok, r.code, r.why, r.row, JSON.stringify(t) === was], [false, 'slots', 'This track’s value sources are full (16/16)', null, true]);
  MO.removeMod(t, t.mods.find(x => x.src === 'c16.out').id);
  const k = MO.addMod(t, 'x1.out', i1 + ':rs');
  assert.deepEqual([k.ok, k.row.src, k.row.dst, k.row.amt], [true, 'x1.out', i1 + ':rs', 0.25], 'a classic knob\'s 0.25');
});

test('(review 1 R1-6) the first INPUT into a combiner that holds no value slot yet, the 16 value sources taken: refused at the drop with the value table\'s words (it would take the 17th: VALS_FULL, code slots), no row; one that holds a slot takes more inputs', () => {
  const t = MO.adopt({ tracks: [S.newTrack(null, { model: 'juno60' })] }).tracks[0], i1 = Object.keys(t.dev).find(k => t.dev[k].kind === 'synth');
  MO.addModDev(t, 'comb'); MO.addModDev(t, 'lfo'); MO.addModDev(t, 'lfo');
  for (let k = 1; k <= 16; k++) { MO.addModDev(t, 'cc'); assert.ok(MO.addMod(t, 'c' + k + '.out', i1 + ':cf').ok, 'c' + k); }
  assert.equal(G.compileMods(t).n.vals, 16);
  const was = JSON.stringify(t), r = MO.addMod(t, 'l1.out', 'x1:in');
  assert.deepEqual([r.ok, r.code, r.why, r.row, JSON.stringify(t) === was], [false, 'slots', 'This track’s value sources are full (16/16)', null, true]);
  MO.removeMod(t, t.mods.find(x => x.src === 'c16.out').id);
  assert.equal(MO.addMod(t, 'l1.out', 'x1:in').ok, true, 'a slot free: it joins (the combiner takes the 16th)');
  assert.equal(G.compileMods(t).n.vals, 16, 'the 16 full again (the combiner\'s)');
  assert.equal(MO.addMod(t, 'l2.out', 'x1:in').ok, true, 'it holds its slot: another input joins');
  assert.deepEqual([G.compileMods(t).left, G.compileMods(t).n.vals], [[], 16]);
});

test('LC §8.1 / G9 the tray\'s data: a Combiner tile after Macros (multi, track-scoped, MOD_LABEL\'s word); the master takes it (MASTER_MODS + comb, its order MOD_TILES\'); MASTER_NOTE names it; no maker word', () => {
  assert.deepEqual(T.MOD_TILES.map(m => m.id), ['lfo', 'env', 'macro', 'comb', 'wheel', 'velo', 'at', 'bend', 'note', 'cc', 'chaos']);
  const c = T.MOD_TILES.find(m => m.id === 'comb');
  assert.deepEqual([c, Object.isFrozen(c)], [{ id: 'comb', name: 'Combiner', scope: 'track', multi: true }, true]);
  assert.deepEqual([...T.MASTER_MODS], ['lfo', 'macro', 'cc', 'chaos', 'comb']);
  assert.deepEqual([...T.MASTER_MODS], S.MASTER_MOD_KINDS.slice(), 'the tray\'s default = the data model\'s');
  assert.equal(T.MASTER_NOTE, 'The master has no notes: its modulators are LFOs, Macros, Combiners, CC and Chaos. Drop one on the canvas and cable its OUT to any knob of the master rack.');
  assert.ok(![c.name, T.MASTER_NOTE, V.MOD_LABEL.comb, V.CMB_LFOS, V.CMB_TWICE, MO.CMB_FULL].some(s => /Serum|Xfer|Wavecraft/i.test(s)), 'G9');
});
