import './v8-guard.mjs';
// Stage MM phase 0 (docs/canvas/IMPL-MM.md §5, §9.0 — the lead's model commit): the master's data model. Schema 17 is an identity step
// (STEPS[16] changes nothing stored; a 16 opens as 17 with its master byte for byte; an 18 opens read-only); song.normMaster reads
// project.master.mdev (the master's modulator modules — lfo / macro / cc / chaos under their id prefixes, normModDev's record with
// lfo.mono / chaos.mono forced to 1; any other key or kind dropped), .mods (normMods) and .mid (a track's rule) beside fx and lay, and
// returns undefined when nothing is valid (absent = an empty master: no key); deserialize keeps them; toV1 names the modulators and
// their cables in `lost`. Pure: no sim, no engine.
// Run: node --max-old-space-size=2048 --test tests/master-mods-model.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../cv-migrate.js?v=9';
import * as S from '../song.js?v=9';
import { defaultFx2, newInstance } from '../fx-core.js?v=9';

const jclone = x => JSON.parse(JSON.stringify(x));
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
const ROW = { id: 'r1', src: 'l1.out', dst: 'mfx:fx.rev.mix', amt: 0.4, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 };
const fxOne = () => { const fx = defaultFx2(); newInstance(fx, 'rev', { rack: 0 }); return fx; };
const MDEV = () => ({ l1: S.normModDev({ kind: 'lfo', lfo: { mono: 1 } }), m1: S.normModDev({ kind: 'macro' }) });

test('schema 17: STEPS[16] is the identity (a copy with the number, the input untouched); a 16 with a master holding modulators opens as 17 byte for byte; older ones go through every step; an 18 is read-only here', () => {
  assert.deepEqual([M.SCHEMA, M.STEPS.length], [17, 17]);
  const p16 = deepFreeze({ name: 'MM', schema: 16, uid: 'p_abc123xyz0', perf: { wheel: null }, tracks: [], master: { fx: fxOne(), lay: { mfx: { x: 0, y: 0 }, l1: { x: -512, y: 0 } }, mdev: MDEV(), mods: [ROW], mid: 2 } });
  assert.deepEqual(M.STEPS[16](p16, []), Object.assign(jclone(p16), { schema: 17 }), 'nothing converted');
  const up = M.upgrade(p16);
  assert.deepEqual([up.from, up.readOnly, up.p.schema, up.p.uid, up.notes], [16, false, 17, 'p_abc123xyz0', []]);
  assert.deepEqual(up.p.master, jclone(p16.master), 'the master as it was');
  assert.deepEqual([0, 14, 16, 17, 18].map(n => M.upgrade({ schema: n, tracks: [] }).readOnly), [false, false, false, false, true]);
  assert.deepEqual([M.upgrade({ schema: 14, tracks: [] }).p.schema, M.upgrade({ schema: 0, tracks: [] }).p.schema], [17, 17]);
});

test('normMaster: mdev — lfo / macro / cc / chaos under their prefixes (lfo.mono and chaos.mono forced to 1: the master has no notes), env / note / a wrong prefix / mfx / out dropped; mods normalised (normMods); mid as a track\'s; fx and lay as before; nothing valid → undefined', () => {
  const lfo2 = S.normModDev({ kind: 'lfo' }); lfo2.lfo.mono = 1;
  const inp = { fx: fxOne(), lay: { mfx: { x: 32, y: 0 } },
    mdev: { l1: { kind: 'lfo', lfo: { mono: 0 } }, l2: { kind: 'lfo' }, m1: { kind: 'macro', v: [0.5], names: ['Air'] }, c1: { kind: 'cc', cc: 74, ch: 2, v: 0.3 }, h1: { kind: 'chaos', chaos: { mono: 0, sh: 1 } },
      e1: { kind: 'env' }, nt: { kind: 'note' }, x9: { kind: 'lfo' }, l3: { kind: 'macro' }, mfx: { kind: 'panel', fx: {} }, out: { kind: 'out' }, __proto__: { kind: 'lfo' }, zz: 4 },
    mods: [ROW, { id: 'bad' }, { id: 'r2', src: 'm1.k3', dst: 'mfx:fx.rev.size', amt: -0.2 }], mid: 1 };
  const o = S.normMaster(inp);
  assert.deepEqual(Object.keys(o).sort(), ['fx', 'lay', 'mdev', 'mid', 'mods']);
  assert.equal(o.fx, inp.fx, 'the rack as before (the host validates it)');
  assert.deepEqual(Object.keys(o.mdev), ['l1', 'l2', 'm1', 'c1', 'h1']);
  assert.deepEqual([o.mdev.l1.lfo.mono, o.mdev.l2.lfo.mono, o.mdev.h1.chaos.mono, o.mdev.h1.chaos.sh, o.mdev.c1, o.mdev.m1.names[0], o.mdev.m1.v[0], o.mdev.m1.v[7]], [1, 1, 1, 1, { kind: 'cc', cc: 74, ch: 2, v: 0.3 }, 'Air', 0.5, 0]);
  assert.deepEqual(o.mdev.l2, lfo2, 'normModDev\'s record, mono forced');
  assert.deepEqual([o.mods.length, o.mods[0].id, o.mods[0].amt, o.mods[1].id, o.mods[1].amt, o.mods[1].src, o.mods[1].dst], [2, 'r1', 0.4, 'r2', -0.2, 'm1.k3', 'mfx:fx.rev.size']);
  assert.equal(o.mid, 3, 'max(mid, every row id + 1)');
  assert.deepEqual(S.normMaster({ mid: 5 }), { mid: 5 }, 'a mid alone is kept (ids stay fresh, a track\'s rule)');
  assert.deepEqual(S.normMaster({ mdev: { l1: { kind: 'lfo' } } }).mdev.l1.lfo.mono, 1);
  assert.deepEqual([S.normMaster({ mdev: { e1: { kind: 'env' } } }), S.normMaster({ mdev: { mfx: { kind: 'panel', fx: {} } }, mods: [{ id: 'bad' }] }), S.normMaster({ fx: 3, lay: { mfx: { x: 'a' } } }), S.normMaster(null), S.normMaster({ mdev: 4 })], [undefined, undefined, undefined, undefined, undefined], 'nothing valid: no key');
  assert.equal(S.MASTER_MOD_KINDS.join(), 'lfo,macro,cc,chaos');
});

test('deserialize keeps project.master with mdev / mods / mid (the whitelist); a master with nothing valid writes no key', () => {
  const p = S.deserialize({ name: 'x', tracks: [], master: { mdev: MDEV(), mods: [ROW], mid: 2, lay: { l1: { x: -512, y: 0 } } } });
  assert.deepEqual([Object.keys(p.master).sort(), Object.keys(p.master.mdev), p.master.mods.length, p.master.mid, p.master.lay.l1.x, 'fx' in p.master], [['lay', 'mdev', 'mid', 'mods'], ['l1', 'm1'], 1, 2, -512, false]);
  assert.equal('master' in S.deserialize({ name: 'x', tracks: [], master: { mdev: { q: 1 }, mods: 'no' } }), false);
  assert.equal('master' in S.deserialize({ name: 'x', tracks: [] }), false);
});

test('toV1 (Save as classic project): the lost lines name the master effects and the master modulators (modules, cables); project.master goes', () => {
  const r = M.toV1({ schema: 17, uid: 'p_abc123xyz0', tracks: [], master: { fx: fxOne(), mdev: MDEV(), mods: [ROW] } });
  assert.deepEqual([r.lost.includes('the master effects (1)'), r.lost.includes('the master modulators (2 modules, 1 cable)'), 'master' in r.p], [true, true, false]);
  const r2 = M.toV1({ schema: 17, uid: 'p_abc123xyz0', tracks: [], master: { mdev: { l1: MDEV().l1 } } });
  assert.deepEqual([r2.lost, 'master' in r2.p], [['the master modulators (1 module, 0 cables)'], false]);
  assert.deepEqual(M.toV1({ schema: 17, uid: 'p_abc123xyz0', tracks: [], master: { lay: { mfx: { x: 0, y: 0 } } } }).lost, [], 'an empty master says nothing');
});
