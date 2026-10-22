// cv-model.js stage 2b tests (IMPL-2b §1.1, §3; the model API for every modulator kind): addModDev / removeModDev /
// setModState for lfo, env, macro, cc, chaos, note; addMod from every source port to Serum, classic and panel knobs with
// the drop defaults by law; setMod on non-native rows; rows dropped with a model change, a removed module or instrument.
// (The 2a API — singletons, the wheel, preset rows — stays under test in tests/cv-migrate.test.mjs.)
// Run: node --max-old-space-size=2048 --test tests/cv-model.test.mjs
import './v8-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as MO from '../cv-model.js?v=9';
import * as G from '../cv-graph.js?v=9';
import * as S from '../song.js?v=9';
import * as C from '../serum-core.js?v=9';

const jclone = x => JSON.parse(JSON.stringify(x));
// an adopted Serum track with a Juno beside it feeding a panel (a reverb), as the fixture of cv-graph's 2b tests
function duo() {
  const t = MO.adopt({ tracks: [Object.assign(S.newTrack(null, { model: 'serum' }), { vals: { s: C.normalizeSerum(C.defaultSerum()) }, fx: C.defaultFx2() })] }, { guard: true }).tracks[0]; // (R7: the guard)
  const i2 = MO.addInst(t, 'juno60', { vals: {} }), fx = MO.addPanel(t, {});
  C.newInstance(t.dev[fx].fx, 'rev', { rack: 0 });
  MO.connect(t, i2 + '.out', fx + '.in');
  return { t, i2, fx, pid: fx };
}
const ROW_KEYS = ['id', 'src', 'dst', 'amt', 'bi', 'curve', 'aux', 'inv', 'byp', 'out', 'acurve', 'crv', 'rise', 'fall', 'slink'];

test('2b addModDev / removeModDev for every kind: numbered ids per prefix (a removed number comes round again), the singletons once, the default states', () => {
  const { t } = duo();
  assert.deepEqual(['lfo', 'lfo', 'env', 'macro', 'macro', 'cc', 'chaos', 'note', 'note', 'velo', 'at', 'bend', 'wheel', 'x'].map(k => MO.addModDev(t, k)), ['l1', 'l2', 'e1', 'm1', 'm2', 'c1', 'h1', 'nt', null, 've', 'at', 'bd', null, null]);
  assert.deepEqual(t.dev.l1, { kind: 'lfo', lfo: Object.assign(C.normLfo({}), { mono: 1 }), rate: 0.5, rise: 0, delay: 0, smooth: 0, phase: 0 }, 'an LFO: Serum\'s default LFO, GLOBAL, the slot knobs at device level');
  assert.deepEqual(t.dev.e1, Object.assign({ kind: 'env' }, C.normEnvMod({})));
  assert.deepEqual(t.dev.e1, { kind: 'env', env: { bpm: 0, legInv: 0, stealRe: 0 }, att: 0.11, hold: 0, dec: 0.5, sus: 1, rel: 0.215, start: 0, end: 0, crv: [0.5, 0.666, 0.666] }, 'Serum\'s ENV 2 defaults');
  assert.deepEqual(t.dev.m1, { kind: 'macro', v: [0, 0, 0, 0, 0, 0, 0, 0], names: ['Macro 1', 'Macro 2', 'Macro 3', 'Macro 4', 'Macro 5', 'Macro 6', 'Macro 7', 'Macro 8'] }, '(U8: the default names)');
  assert.deepEqual([t.dev.c1, t.dev.h1, t.dev.nt], [{ kind: 'cc', cc: 1, ch: 0, v: 0 }, { kind: 'chaos', chaos: { mono: 1, sh: 0 }, rate: 0.2512, bpm: 0, smooth: 0 }, { kind: 'note' }], '(a chaos module GLOBAL, as a canvas LFO)');
  for (const id of ['l1', 'l2', 'e1', 'm1', 'c1', 'h1', 'nt']) assert.equal(G.kindOf(t.dev[id]), 'mod', id);
  assert.equal(G.compileTrack(t).canonical, false, '(two instruments: the graph form; modules change no shape)');
  MO.addMod(t, 'l2.out', 'i1:f.cutoff'); MO.addMod(t, 'm1.k3', 'i1:a.wt'); MO.addMod(t, 'm1.k4', 'i1:a.pan'); MO.addMod(t, 'l1.out', 'i1:f.res');
  assert.deepEqual(MO.removeModDev(t, 'l2'), { ok: true, why: '', rows: ['r1'] });
  assert.deepEqual(MO.removeModDev(t, 'm1'), { ok: true, why: '', rows: ['r2', 'r3'] }, 'every port\'s rows');
  assert.deepEqual([t.mods.map(r => r.id), 'l2' in t.dev, 'm1' in t.dev], [['r4'], false, false]);
  assert.deepEqual([MO.addModDev(t, 'lfo'), MO.addModDev(t, 'macro'), MO.addModDev(t, 'lfo')], ['l2', 'm3', 'l3'], 'the highest of the prefix + 1');
  assert.equal(MO.removeModDev(t, 'i1').ok, false);
  assert.equal(MO.removeModDev(t, 'zz').ok, false);
});

test('2b setModState: fields merged and bounded by song.normModDev (nested one level), the device object kept; refusals', () => {
  const { t } = duo();
  MO.addModDev(t, 'lfo'); MO.addModDev(t, 'env'); MO.addModDev(t, 'macro'); MO.addModDev(t, 'cc'); MO.addModDev(t, 'chaos');
  const L = t.dev.l1;
  assert.deepEqual(MO.setModState(t, 'l1', { lfo: Object.assign(C.normLfo({}), { mono: 0, mode: 'free', pts: [[0, 1, 0], [1, 0, 0]] }), rate: 2, name: 'Wob', junk: 1 }), { ok: true, why: '' });
  assert.equal(t.dev.l1, L, 'the same object');
  assert.deepEqual([L.lfo.mono, L.rate, L.lfo.mode, L.lfo.pts, L.lfo.bpm, L.name, 'junk' in L], [0, 1, 'free', [[0, 1, 0], [1, 0, 0]], 1, 'Wob', false]);
  MO.setModState(t, 'l1', { lfo: { bpm: 0 } });
  assert.deepEqual([L.lfo.bpm, L.lfo.mode, L.rate], [0, 'free', 1], 'a partial slot object: merged over the old');
  assert.ok(MO.setModState(t, 'e1', { att: 0.5, sus: 3, env: { legInv: 1 }, crv: [0.1, 0.2] }).ok);
  assert.deepEqual([t.dev.e1.att, t.dev.e1.sus, t.dev.e1.env.legInv, t.dev.e1.dec, t.dev.e1.crv], [0.5, 1, 1, 0.5, [0.1, 0.2, 0.666]]);
  assert.ok(MO.setModState(t, 'e1', { crv: [0.9] }).ok);
  assert.deepEqual(t.dev.e1.crv, [0.9, 0.2, 0.666], 'C12: a partial array merges element-wise (the rest kept, not reset)');
  assert.ok(MO.setModState(t, 'e1', { crv: [undefined, 0.3] }).ok);
  assert.deepEqual(t.dev.e1.crv, [0.9, 0.3, 0.666]);
  assert.ok(MO.setModState(t, 'm1', { v: [0.2, 5], names: ['Cutoff', 'a name that is far too long'] }).ok);
  assert.deepEqual([t.dev.m1.v, t.dev.m1.names.slice(0, 2)], [[0.2, 1, 0, 0, 0, 0, 0, 0], ['Cutoff', 'a name that is f']]);
  assert.ok(MO.setModState(t, 'c1', { cc: 74, ch: 3, v: 0.4 }).ok && MO.setModState(t, 'h1', { chaos: { mono: 0 }, rate: 0.9, smooth: 2 }).ok);
  assert.deepEqual([t.dev.c1, t.dev.h1], [{ kind: 'cc', cc: 74, ch: 3, v: 0.4 }, { kind: 'chaos', chaos: { mono: 0, sh: 0 }, rate: 0.9, bpm: 0, smooth: 1 }]);
  assert.ok(MO.setModState(t, 'l1', { kind: 'env' }).ok);
  assert.equal(t.dev.l1.kind, 'lfo', 'the kind never changes');
  assert.deepEqual([MO.setModState(t, 'i1', { x: 1 }).ok, MO.setModState(t, 'nope', {}).ok, MO.setModState(t, 'l1', null).ok], [false, false, false]);
  assert.deepEqual(S.normDev(jclone(t)).dev.l1, jclone(L), 'song.normDev agrees');
});

test('2b addMod from every source to every destination: Serum (the Serum\'s drop rules), classic (0.25 by law, bipolar when centred, ±1 on a toggle), panel; refusals', () => {
  const { t, i2, pid } = duo(), p = { tracks: [t], perf: { wheel: { v: 1 } } };
  for (const k of ['lfo', 'env', 'macro', 'cc', 'chaos', 'note', 'velo']) MO.addModDev(t, k);
  t.dev.i1.vals.s.p['f.cutoff'] = 0.8;
  const add = (src, dst, o) => MO.addMod(t, src, dst, Object.assign({ project: p }, o));
  const ok = [['l1.out', 'i1:f.cutoff'], ['e1.out', 'i1:a.wt'], ['m1.k8', 'i1:fx.' + C.fxLayout(t.dev.i1.fx).inst.length + '.x'], ['c1.out', 'i1:a.pan'], ['h1.out', 'i1:g.master'], ['nt.out', 'i1:a.level'], ['i1/lfo3.out', 'i1:f.res'], ['i1/env2.out', 'i2:cf'], ['wheel', 'i2:cf'],
    ['l1.out', i2 + ':cf'], ['l1.out', i2 + ':a'], ['m1.k1', i2 + ':lr'], ['ve.out', i2 + ':hp'], ['l1.out', i2 + ':ch'], ['c1.out', i2 + ':vm'], ['l1.out', pid + ':fx.rev.mix'], ['h1.out', pid + ':fx.rev.on']];
  const R = ok.map(([s, d]) => add(s, d));
  assert.deepEqual(R.map(r => r.ok ? r.row.id : r.code + ':' + r.why), ['r1', 'r2', 'nomod:This knob can’t be modulated', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15', 'r16'], '(an FX id that is not there: nomod)');
  const row = id => t.mods.find(r => r.id === id);
  assert.deepEqual([Math.round(row('r1').amt * 1e6) / 1e6, row('r1').bi, row('r3').amt, row('r3').bi, row('r5').amt], [0.2, 0, 0.5, 1, 0.25], 'Serum: 1 − base (limit: the cutoff at 0.8, the level at 0.75), a centred knob bipolar 0.5');
  assert.deepEqual([row('r9').amt, row('r9').bi, row('r10').amt, row('r11').amt, row('r12').amt, row('r13').amt, row('r14').amt, row('r14').bi], [0.25, 0, 0.25, 0.25, 0.25, 0.25, 0.25, 0], 'classic: 0.25 by law (the Juno\'s VCA mode is a selector)');
  assert.deepEqual([row('r15').amt, row('r15').bi, row('r16').amt], [0.25, 0, -1], 'panel: 0.25; the reverb is on → −1');
  const mm = MO.addInst(t, 'minimoog', { vals: { m2: 0 } }); // (oscillator 2's mixer switch off)
  assert.deepEqual([add('l1.out', mm + ':tune').row.bi, add('l1.out', mm + ':tune').row.amt, add('l1.out', mm + ':v1').row.bi], [1, 0.25, 0], 'a centred classic knob drops bipolar');
  for (const r of t.mods) assert.deepEqual(Object.keys(r), ROW_KEYS, r.id);
  const o = add('l1.out', i2 + ':rs', { amt: -0.4, bi: 1, curve: 0.3, aux: 'lfo2', rise: 0.2, slink: 1, crv: [[0, 0], [1, 1]] }).row;
  assert.deepEqual([o.amt, o.bi, o.curve, o.aux, o.rise, o.fall, o.slink, o.crv], [-0.4, 1, 0.3, '', 0.2, 0.2, 1, [[0, 0, 0], [1, 1, 0]]], 'overrides through normRow; C7: no aux on a classic / panel row (it would name the synthetic CP\'s slot)');
  assert.equal(add('l1.out', 'i1:f.res', { aux: 'lfo2' }).row.aux, 'lfo2', 'a Serum row keeps its aux');
  // refusals
  const was = JSON.stringify(t), cases = [
    ['l9.out', 'i1:f.cutoff', 'src'], ['m1.k9', 'i1:f.cutoff', 'src'], ['m1.out', 'i1:f.cutoff', 'src'], ['l1.k1', 'i1:f.cutoff', 'src'], ['i2/lfo1.out', 'i1:f.cutoff', 'src'], ['i1/lfo11.out', 'i1:f.cutoff', 'src'], ['i9/lfo1.out', 'i1:f.cutoff', 'src'],
    ['l1.out', 'i9:f.cutoff', 'end'], ['l1.out', i2 + ':pwm', 'stage'], ['l1.out', i2 + ':nope', 'nomod'], ['l1.out', mm + ':mm', 'nomod'], ['l1.out', mm + ':v2', 'nomod'], ['l1.out', pid + ':fx.rev.nope', 'nomod'], ['l1.out', 'out:x', 'nomod'], ['l1.out', 'l1:x', 'nomod'],
    ['l1.out', 'i1:f.cutoff', 'aux', { aux: 'nope' }]];
  for (const [src, dst, code, o] of cases) { const r = add(src, dst, o); assert.deepEqual([r.ok, r.code, r.row], [false, code, null], src + ' → ' + dst); }
  assert.equal(JSON.stringify(t), was, 'untouched');
  assert.equal(add('l1.out', mm + ':v2').why, 'Switch the oscillator on to modulate its level');
  assert.equal(add('l1.out', i2 + ':pwm').why, 'This knob takes modulation from stage 5');
  // the Serum's 64-row budget still counts canvas rows to it: rows left for other reasons do not fill it
  const s = t.dev.i1.vals.s;
  for (let k = 0; k < 64; k++) if (!s.matrix[k].src) s.matrix[k] = C.normRow({ src: 'lfo2', amt: 0.1, dst: 'a.wt' });
  assert.deepEqual([add('l1.out', 'i1:f.cutoff').code, add('l1.out', i2 + ':cf').ok], ['full', true], 'full for the Serum, not for the Juno');
});

test('2b setMod on non-native rows (normRow\'s rules by proxy): fields, never the ends; refusals leave the row', () => {
  const { t, i2, pid } = duo();
  MO.addModDev(t, 'lfo'); MO.addModDev(t, 'macro');
  MO.addMod(t, 'l1.out', 'i1:f.cutoff'); MO.addMod(t, 'l1.out', i2 + ':cf'); MO.addMod(t, 'm1.k2', pid + ':fx.rev.mix'); MO.addMod(t, 'i1/env2.out', i2 + ':a');
  for (const id of ['r1', 'r2', 'r3', 'r4']) {
    const sx = id === 'r1'; // (C7: an aux names a Serum source — on a classic / panel row it would name the synthetic CP's slot: cleared)
    assert.equal(MO.setMod(t, id, { amt: 2, bi: 1, src: 'x', dst: 'y', id: 'z', rise: 0.5, slink: 1, aux: 'lfo3', curve: -3, crv: [[0.5, 0.5]] }).ok, true, id);
    const r = t.mods.find(x => x.id === id);
    assert.deepEqual([r.id, r.amt, r.bi, r.rise, r.fall, r.slink, r.aux, r.curve, r.crv], [id, 1, 1, 0.5, 0.5, 1, sx ? 'lfo3' : '', -1, [[0, 0.5, 0], [1, 0.5, 0]]], id);
    assert.ok(r.src !== 'x' && r.dst !== 'y');
    const before = jclone(r);
    if (sx) { assert.deepEqual(MO.setMod(t, id, { aux: 'nope' }), { ok: false, why: 'Unknown aux source' }); assert.deepEqual(r, before); }
    else { assert.deepEqual(MO.setMod(t, id, { aux: 'nope', inv: 1 }), { ok: true, why: '' }); assert.deepEqual([r.aux, r.inv], ['', 0], id + ': aux and its invert stay off'); }
  }
  assert.equal(MO.setMod(t, 'r9', { amt: 0 }).ok, false);
  assert.deepEqual(MO.removeMod(t, 'r4'), { ok: true, why: '' });
  assert.deepEqual(t.mods.map(r => r.id), ['r1', 'r2', 'r3']);
});

test('2b rows go with what they end on or start at: a model change keeps the rows whose knob the new model has, removeInst drops its linked rows, the primary\'s setModel too', () => {
  const { t, i2 } = duo();
  MO.addModDev(t, 'lfo'); MO.addModDev(t, 'note');
  MO.addMod(t, 'l1.out', i2 + ':cf'); MO.addMod(t, 'l1.out', i2 + ':lr'); MO.addMod(t, 'nt.out', i2 + ':hp'); MO.addMod(t, 'l1.out', i2 + ':ch');
  MO.addMod(t, 'i1/lfo2.out', i2 + ':rs'); MO.addMod(t, 'l1.out', 'i1:f.cutoff'); MO.addMod(t, 'i1/lfo1.out', 'i1:a.pan');
  // Juno → OB-Xa: cf (cutoff), lr (LFO rate) and 'rs' (resonance) exist there; hp / ch do not
  const r = MO.setModel(t, i2, 'obxa', { vals: {} });
  assert.deepEqual([r.ok, r.rows, r.notice], [true, ['r3', 'r4'], '2 modulation cables to the instrument removed: the new model has no such knobs']);
  assert.deepEqual(t.mods.map(x => x.id), ['r1', 'r2', 'r5', 'r6', 'r7']);
  // → a Serum: the classic ids are not Serum knobs
  const q = MO.setModel(t, i2, 'serum', { vals: { s: C.normalizeSerum(C.defaultSerum()) } });
  assert.deepEqual([q.rows, t.mods.map(x => x.id)], [['r1', 'r2', 'r5'], ['r6', 'r7']]);
  MO.addMod(t, 'i1/lfo2.out', i2 + ':f.cutoff'); MO.addMod(t, 'i1/env2.out', i2 + ':a.wt');
  assert.deepEqual(MO.removeInst(t, 'i1').rows, ['r6', 'r7', 'r8', 'r9'], 'the Serum\'s own rows and the rows linked from it');
  assert.deepEqual(t.mods, []);
  const u = duo().t;
  MO.addModDev(u, 'lfo');
  MO.addMod(u, 'l1.out', 'i1:f.cutoff'); MO.addMod(u, 'i1/lfo2.out', 'i1:a.wt');
  MO.setModel(u, 'i1', 'juno60', { vals: {} }); // (the primary: setTrackModel's setModel, R5)
  assert.deepEqual([u.mods, 'l1' in u.dev], [[], true], 'no Serum knob survives; the module stays');
  assert.equal(MO.setModel(u, 'i1', 'minimoog', { vals: {} }).notice, '');
});

test('C8: removePanel drops the rows to the panel\'s knobs (their ids returned); pruneRows drops the rows whose knob went (an effect instance removed)', () => {
  const { t, i2, pid } = duo(), p = { tracks: [t], perf: { wheel: { v: 1 } } };
  MO.addModDev(t, 'lfo');
  MO.addMod(t, 'l1.out', pid + ':fx.rev.mix', { project: p }); MO.addMod(t, 'l1.out', i2 + ':cf', { project: p }); MO.addMod(t, 'l1.out', pid + ':fx.rev.on', { project: p });
  const id2 = C.newInstance(t.dev[pid].fx, 'rev', { rack: 0 });
  MO.addMod(t, 'l1.out', pid + ':fx.' + id2 + '.mix', { project: p });
  assert.deepEqual(t.mods.map(r => r.id), ['r1', 'r2', 'r3', 'r4']);
  const rack = t.dev[pid].fx.racks[0];
  rack.mods = rack.mods.filter(x => x.id !== id2); // (the effect instance removed, as the rack UI does)
  assert.deepEqual(MO.pruneRows(t, pid), ['r4'], 'the removed effect\'s row');
  assert.deepEqual(MO.pruneRows(t, pid), [], 'nothing twice');
  assert.deepEqual(MO.pruneRows(t, i2), []);
  assert.deepEqual(G.validate(t).ok, true);
  assert.deepEqual(MO.removePanel(t, pid), { ok: true, why: '', rows: ['r1', 'r3'] });
  assert.deepEqual([t.mods.map(r => r.id), G.validate(t).ok], [['r2'], true], 'no row ends on nothing');
  assert.equal(MO.removePanel(t, pid).ok, false);
});

test('U8: a macro module is born with its knobs named "Macro 1"…"Macro 8"; an emptied name comes back as the default', () => {
  const { t } = duo();
  MO.addModDev(t, 'macro');
  assert.deepEqual(t.dev.m1.names, Array.from({ length: 8 }, (_, k) => 'Macro ' + (k + 1)));
  MO.setModState(t, 'm1', { names: ['Cut', ''] });
  assert.deepEqual(t.dev.m1.names.slice(0, 3), ['Cut', 'Macro 2', 'Macro 3']);
  assert.deepEqual(S.normModDev({ kind: 'macro', names: [7, '  ', 'x'] }).names.slice(0, 3), ['Macro 1', 'Macro 2', 'x']);
});

test('(canvas 2b) the Serum filter\'s routing switches take no NEW cable (addMod: nomod) while the balance destinations do; a row that already points there keeps validating, editing and compiling; pruneRows leaves it', () => {
  const { t } = duo(), p = { tracks: [t], perf: { wheel: { v: 1 } } };
  MO.addModDev(t, 'lfo');
  for (const id of ['f.routeS', 'f.routeA', 'f2.routeN', 'f2.routeC']) { const r = MO.addMod(t, 'l1.out', 'i1:' + id, { project: p }); assert.deepEqual([r.ok, r.code], [false, 'nomod'], id); }
  assert.deepEqual(t.mods || [], [], 'no row, no step');
  for (const id of ['a.fbal', 's.fbal', 'n.fbal']) assert.equal(MO.addMod(t, 'l1.out', 'i1:' + id, { project: p }).ok, true, id);
  // an existing row (a project saved before): kept, editable, compiled, never pruned
  t.mods.push({ id: 'r9', src: 'l1.out', dst: 'i1:f.routeS', amt: -1, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 });
  assert.deepEqual(MO.setMod(t, 'r9', { amt: -0.5 }).ok, true);
  assert.deepEqual(MO.pruneRows(t, 'i1'), []);
  assert.deepEqual(MO.setModel(t, 'i1', 'serum', {}).rows, [], 'the same model: nothing dropped');
  assert.equal(t.mods.some(r => r.id === 'r9' && r.amt === -0.5), true);
  assert.equal(G.compileMods(t, p) !== undefined, true);
});

/* ------------------------------------------------------------------ IMPL-8 §1.4, §5, §10.3 (lane Q): the Pads modules' data and their rows */
import * as PC from '../pads-core.js?v=9';
const modOn = (p, id, slots, m = {}) => { const M = p.pads.find(x => x.id === id); for (const i of slots) M.pads[i] = PC.normPad(Object.assign({}, M.pads[i], { mod: m })); };
const twoTracks = () => { const a = duo(), b = duo(); a.t.id = 'trk_1'; b.t.id = 'trk_2'; return { a, b, p: { tracks: [a.t, b.t], perf: { wheel: null } } }; };

test('IMPL-8 addPads: the lowest free id pd1…pd8, the module normalised (pads-core newModule: "Pads n", 4 × 4 M; o\'s fields over it); the 9th refused with the tray\'s reason; one History step', () => {
  const p = { tracks: [] }, H = new S.History();
  H.record(p, 'Add Pads');
  assert.deepEqual(MO.addPads(p), { ok: true, id: 'pd1', why: '' });
  assert.deepEqual(p.pads, [PC.newModule('pd1')]);
  assert.deepEqual(H.undo(p).pads, undefined, 'the step undoes it (the project snapshot holds p.pads)');
  const o = { rows: 1, cols: 5, name: 'Kit', pads: [{ t: [{ k: 'drum', tr: 'trk_1', s: 'bd' }] }], junk: 1 };
  assert.deepEqual(MO.addPads(p, o), { ok: true, id: 'pd2', why: '' });
  assert.deepEqual([p.pads[1].name, p.pads[1].rows, p.pads[1].cols, p.pads[1].pads[0].t, 'junk' in p.pads[1], p.pads[1].id], ['Kit', 1, 5, [{ k: 'drum', tr: 'trk_1', s: 'bd' }], false, 'pd2'], 'o\'s id never wins');
  assert.equal(MO.addPads(p, { id: 'pd7' }).id, 'pd3');
  for (let k = 4; k <= 8; k++) assert.equal(MO.addPads(p).id, 'pd' + k);
  assert.deepEqual([MO.addPads(p), p.pads.length], [{ ok: false, id: null, why: '8 Pads modules in this project' }, 8]);
  assert.deepEqual(PC.normPads(jclone(p.pads)), p.pads, 'normalised');
  MO.removePads(p, 'pd3');
  assert.deepEqual([MO.addPads(p).id, p.pads.map(M => M.id)], ['pd3', ['pd1', 'pd2', 'pd4', 'pd5', 'pd6', 'pd7', 'pd8', 'pd3']], 'a deleted id comes round again (its rows went with it)');
  assert.deepEqual([MO.addPads(null).ok, MO.addPads({ pads: 'x' }).id], [false, 'pd1'], '(a non-list: a fresh list)');
});

test('IMPL-8 srcOk / addMod from a mod pad to a classic, a Serum and an FX knob (the project required: the module there, the slot\'s mod on — a hidden slot too); refusals leave the track', () => {
  const { t, i2, pid } = duo(), p = { tracks: [t], perf: { wheel: { v: 1 } } };
  MO.addPads(p); modOn(p, 'pd1', [3, 63]);
  p.pads[0].pads[5] = PC.normPad({ t: [{ k: 'note', tr: t.id, n: 60 }] });
  t.dev.i1.vals.s.p['f.cutoff'] = 0.8;
  const add = (src, dst, o) => MO.addMod(t, src, dst, Object.assign({ project: p }, o));
  assert.deepEqual([MO.srcOk(t, 'pd1.p3', p), MO.srcOk(t, 'pd1.p63', p), MO.srcOk(t, 'pd1.p5', p), MO.srcOk(t, 'pd2.p3', p), MO.srcOk(t, 'pd1.p3'), MO.srcOk(t, 'pd1.p3', {})], [true, true, false, false, false, false]);
  assert.deepEqual([MO.srcOk(t, 'wheel'), MO.srcOk(t, 'wheel', p), MO.srcOk(t, 'wheel', {}), MO.srcOk(t, 'l1.out', p)], [true, true, false, false], 'the others as before');
  const was = JSON.stringify(t);
  for (const [src, dst, code, o] of [['pd1.p5', i2 + ':cf', 'src'], ['pd2.p3', i2 + ':cf', 'src'], ['pd1.p64', i2 + ':cf', 'src'], ['pd1.p03', i2 + ':cf', 'src'], ['pd1.p3', i2 + ':pwm', 'stage'], ['pd1.p3', 'pd1:x', 'end'], ['pd1.p3', i2 + ':cf', 'src', { project: undefined }]]) {
    const r = add(src, dst, o); assert.deepEqual([r.ok, r.code, r.row], [false, code, null], src + ' → ' + dst);
  }
  assert.equal(JSON.stringify(t), was, 'untouched');
  const R = [add('pd1.p3', i2 + ':cf'), add('pd1.p3', 'i1:f.cutoff'), add('pd1.p63', pid + ':fx.rev.mix'), add('wheel', 'i1:f.res')];
  assert.deepEqual(R.map(r => r.ok && [r.row.id, r.row.src, r.row.dst, r.row.amt, r.row.bi]), [['r1', 'pd1.p3', i2 + ':cf', 0.25, 0], ['r2', 'pd1.p3', 'i1:f.cutoff', R[1].row.amt, 0], ['r3', 'pd1.p63', pid + ':fx.rev.mix', 0.25, 0], ['r4', 'wheel', 'i1:f.res', R[3].row.amt, 0]]);
  assert.equal(Math.round(R[1].row.amt * 1e6) / 1e6, 0.2, 'a Serum knob: the Serum\'s drop rules (the wheel\'s stand-in source; 1 − base)');
  for (const r of t.mods) assert.deepEqual(Object.keys(r), ROW_KEYS, r.id);
  const pay = G.compileMods(t, p);
  assert.deepEqual([pay.vals.map(v => v.id), pay.ext.map(e => e.id), pay.left], [['pd1.p3', 'pd1.p63'], ['pd1.p3'], []], 'compiled: value slots, the Serum\'s ext');
  assert.deepEqual(MO.padTracks(p, 'pd1.p3'), [t]);
  assert.equal(MO.setMod(t, 'r1', { amt: -0.5, aux: 'lfo1' }).ok, true);
  assert.deepEqual([t.mods[0].amt, t.mods[0].aux], [-0.5, ''], 'setMod by proxy; no aux on a classic row');
});

test('IMPL-8 addMod refuses a pad that would be the track\'s 17th value source (code slots, "This track’s value sources are full (16/16)"); another row from a pad already in a slot is fine; CC / macro rows as before', () => {
  const { t, i2 } = duo(), p = { tracks: [t] };
  MO.addPads(p); modOn(p, 'pd1', [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const add = (src, dst) => MO.addMod(t, src, dst, { project: p });
  for (let k = 1; k <= 8; k++) { MO.addModDev(t, 'cc'); assert.ok(add('c' + k + '.out', i2 + ':cf').ok); }
  for (let i = 0; i < 8; i++) assert.ok(add('pd1.p' + i, i2 + ':rs').ok, 'pd1.p' + i);
  const was = JSON.stringify(t), r = add('pd1.p8', i2 + ':cf');
  assert.deepEqual([r.ok, r.code, r.why, r.row, JSON.stringify(t) === was], [false, 'slots', 'This track’s value sources are full (16/16)', null, true]);
  assert.equal(add('pd1.p0', 'i1:f.cutoff').ok, true, 'pd1.p0 holds a slot already (its Serum row: an ext slot)');
  assert.deepEqual([G.compileMods(t, p).n.vals, G.compileMods(t, p).left], [16, []]);
  MO.addModDev(t, 'cc');
  assert.equal(add('c9.out', i2 + ':cf').ok, true, 'a CC row: no addMod budget (2b: the host\'s modLeftWhy tells), as before');
});

test('IMPL-8 removePads (§1.4 Delete): the module, every pd<n>.* row and lay entry on every track (byTrack: the confirm\'s counts), other rows kept — one History step; padRows lists, dropPadRows by module or source (§7.2: a pad\'s Modulation off)', () => {
  const { a, b, p } = twoTracks(), H = new S.History();
  MO.addPads(p); MO.addPads(p); modOn(p, 'pd1', [0, 1]); modOn(p, 'pd2', [0]);
  MO.addModDev(a.t, 'lfo');
  const add = (t, src, dst) => assert.ok(MO.addMod(t, src, dst, { project: p }).ok, src);
  add(a.t, 'pd1.p0', a.i2 + ':cf'); add(a.t, 'pd2.p0', a.i2 + ':rs'); add(a.t, 'l1.out', a.i2 + ':cf'); add(b.t, 'pd1.p1', 'i1:f.cutoff'); add(b.t, 'pd1.p0', 'i1:f.res');
  a.t.lay = { pd1: { x: 0, y: 0 }, pd2: { x: 0, y: 400 }, i1: { x: 400, y: 0 } }; b.t.lay = { pd1: { x: -400, y: 0 } };
  assert.deepEqual(MO.padRows(p, 'pd1'), { ok: true, byTrack: [{ trackId: 'trk_1', rows: ['r1'] }, { trackId: 'trk_2', rows: ['r1', 'r2'] }] });
  assert.deepEqual([MO.padRows(p, 'pd1.p1').byTrack, MO.padRows(p, 'pd3').byTrack, MO.padRows(p, 'x').ok], [[{ trackId: 'trk_2', rows: ['r1'] }], [], false]);
  assert.deepEqual(MO.padTracks(p, 'pd1.p0'), [a.t, b.t]);
  const snap = JSON.stringify(p);
  H.record(p, 'Delete Pads 1');
  assert.deepEqual(MO.removePads(p, 'pd1'), { ok: true, byTrack: [{ trackId: 'trk_1', rows: ['r1'] }, { trackId: 'trk_2', rows: ['r1', 'r2'] }] });
  assert.deepEqual([p.pads.map(M => M.id), a.t.mods.map(r => r.id), b.t.mods, Object.keys(a.t.lay), Object.keys(b.t.lay)], [['pd2'], ['r2', 'r3'], [], ['pd2', 'i1'], []]);
  assert.deepEqual([G.compileMods(a.t, p).vals.map(v => v.id), G.compileMods(b.t, p)], [['pd2.p0'], null], 'compiled without them (b: nothing left — the host posts {off})');
  assert.deepEqual(jclone(H.undo(p)), JSON.parse(snap), 'one step restores the module, its rows and lays on every track');
  assert.deepEqual([MO.removePads(p, 'pd1'), MO.removePads(p, 'x'), MO.removePads(null, 'pd1')], [{ ok: false, byTrack: [] }, { ok: false, byTrack: [] }, { ok: false, byTrack: [] }]);
  assert.deepEqual(MO.dropPadRows(p, 'pd2.p0'), { ok: true, byTrack: [{ trackId: 'trk_1', rows: ['r2'] }] });
  assert.deepEqual([a.t.mods.map(r => r.id), p.pads.map(M => M.id), MO.dropPadRows(p, 'pd2.p0').ok], [['r3'], ['pd2'], false], 'the module stays (a pad\'s Modulation switched off: its rows only)');
});

test('IMPL-8 prunePads (H at load after normPads, review #28; after any p.pads edit): rows whose module is missing or whose slot\'s mod is off go, lay entries of missing modules go; idempotent', () => {
  const { a, b, p } = twoTracks();
  MO.addPads(p); modOn(p, 'pd1', [0, 1]);
  const R0 = MO.addMod(a.t, 'wheel', 'i1:f.cutoff').row, row = (id, src, dst) => Object.assign({}, R0, { id, src, dst }); // (rows as a file has them)
  p.perf = { wheel: { v: 1 } };
  a.t.mods = [row('r1', 'pd1.p0', a.i2 + ':cf'), row('r2', 'pd1.p2', a.i2 + ':cf'), row('r3', 'pd5.p0', 'i1:f.res'), row('r4', 'wheel', 'i1:f.res'), row('r5', 'pd1.p1', 'i1:f.cutoff')];
  b.t.mods = [row('r1', 'pd2.p9', 'i1:f.cutoff')];
  a.t.lay = { pd1: { x: 0, y: 0 }, pd5: { x: 0, y: 0 }, i1: { x: 1, y: 1 } }; b.t.lay = { pd2: { x: 0, y: 0 } };
  assert.deepEqual(MO.prunePads(p), { ok: true, byTrack: [{ trackId: 'trk_1', rows: ['r2', 'r3'] }, { trackId: 'trk_2', rows: ['r1'] }] });
  assert.deepEqual([a.t.mods.map(r => r.id), b.t.mods, Object.keys(a.t.lay), Object.keys(b.t.lay)], [['r1', 'r4', 'r5'], [], ['pd1', 'i1'], []]);
  assert.deepEqual(MO.prunePads(p), { ok: false, byTrack: [] }, 'idempotent');
  delete p.pads;
  assert.deepEqual([MO.prunePads(p).byTrack, a.t.mods.map(r => r.id), Object.keys(a.t.lay)], [[{ trackId: 'trk_1', rows: ['r1', 'r5'] }], ['r4'], ['i1']], 'no p.pads: every pad row and lay entry');
  assert.deepEqual([MO.prunePads(null), MO.prunePads({})], [{ ok: false, byTrack: [] }, { ok: false, byTrack: [] }]);
});
