// cv-migrate.js tests (SPEC-canvas §5.1, §5.8, §10 stage 1a): the schema gate — a project of a newer schema is opened
// read-only and never modified; older projects (main's, schema 0) are brought to SCHEMA with a project uid; song.js keeps
// working on them; appstore's gate and cv-migrate agree on what "newer" is.
// Run: node --max-old-space-size=2048 --test tests/cv-migrate.test.mjs
import './v8-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../cv-migrate.js?v=9';
import * as A from '../appstore.js?v=9';
import * as S from '../song.js?v=9';
import { fakeStorage, fakeIDB } from './fakes.mjs';

const P1 = readFileSync(new URL('./ref-p1/project-p1.json', import.meta.url), 'utf8'); // a main (schema 0) project file
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };

test('constants: SCHEMA, one step per schema, the read-only notice (§2.13)', () => {
  assert.equal(M.SCHEMA, 2, '1a: uid; 1b: track.lay');
  assert.equal(M.STEPS.length, M.SCHEMA, 'STEPS[n] turns schema n into n + 1');
  assert.equal(M.READ_ONLY_NOTICE, 'Opened read-only: saved by a newer SYNTH Canvas · Reload');
  assert.equal(M.schemaOf, A.schemaOf, 'one definition of a project\'s schema (the store\'s gate uses it)');
});

test('a main project (schema 0) is brought to SCHEMA: uid made, the input untouched, song.js reads it as before', () => {
  const o = deepFreeze(JSON.parse(P1)), copy = JSON.parse(P1);
  const up = M.upgrade(o);
  assert.deepEqual([up.from, up.readOnly, up.p.schema], [0, false, M.SCHEMA]);
  assert.ok(M.isUid(up.p.uid), up.p.uid);
  assert.notEqual(up.p, o);
  assert.deepEqual(o, copy, 'never mutated');
  const p = M.stamp(S.deserialize(up.p), up.p);
  assert.deepEqual([p.uid, p.schema], [up.p.uid, M.SCHEMA]);
  assert.deepEqual(p.tracks.map(t => t.model), S.deserialize(copy).tracks.map(t => t.model));
  // saved, the stamps travel with it (song.serialize keeps every field); main's deserialize ignores them (the file opens there)
  const back = JSON.parse(S.serialize(p));
  assert.deepEqual([back.uid, back.schema], [p.uid, M.SCHEMA]);
  assert.equal(M.upgrade(back).p.uid, p.uid, 'a uid survives save and reopen');
  assert.equal('uid' in S.deserialize(back), false);
});

test('uids: kept when valid, made when missing or invalid; at SCHEMA already: a copy', () => {
  const o = { name: 'x', schema: M.SCHEMA, uid: 'p_abc123xyz0', tracks: [] };
  const up = M.upgrade(o);
  assert.deepEqual([up.from, up.readOnly, up.p.uid], [M.SCHEMA, false, 'p_abc123xyz0']);
  assert.notEqual(up.p, o);
  for (const uid of [undefined, null, 7, '', 'p_', 'P_ABCDEF', 'p_abc-12', 'x_abcdef', 'p_' + 'a'.repeat(30)]) {
    const p = M.upgrade({ tracks: [], uid }).p;
    assert.ok(M.isUid(p.uid) && p.uid !== uid, String(uid));
  }
  const ids = new Set(Array.from({ length: 200 }, () => M.newUid()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^p_[0-9a-z]{10}$/);
  assert.equal(M.camKey('p_abc123xyz0', 'trk_2'), 'synth.cam.p_abc123xyz0.trk_2');
  assert.equal(A.appKey('synth.cam'), 'synthc.cam', 'cameras: one LRU record (cv-module CAM_PREF), its entries keyed by camKey — never a key per track');
});

test('schema gate: a newer project is returned as it is, read-only, never modified', () => {
  for (const n of [M.SCHEMA + 1, M.SCHEMA + 7]) {
    const o = deepFreeze({ name: 'from the future', schema: n, uid: 'p_future0001', tracks: [{ id: 'trk_1', dev: { i1: { kind: 'synth' } } }] });
    const up = M.upgrade(o);
    assert.deepEqual([up.from, up.readOnly], [n, true]);
    assert.equal(up.p, o);
    const p = M.stamp(S.deserialize(o), o); // what the page holds in memory: never saved (autosave off, Save disabled)
    assert.equal(p.uid, 'p_future0001');
  }
  assert.throws(() => M.upgrade(null), /Not a SYNTH project/);
  assert.throws(() => M.upgrade([1]), /Not a SYNTH project/);
});

test('stamp: new projects get a uid and SCHEMA', () => {
  const p = M.stamp(S.newProject({ model: 'minimoog' }));
  assert.ok(M.isUid(p.uid));
  assert.equal(p.schema, M.SCHEMA);
  assert.notEqual(M.stamp(S.newProject({ model: 'minimoog' })).uid, p.uid);
});

test('the store and cv-migrate agree: a database autosave of schema SCHEMA + 1 opens read-only for this build', async () => {
  const idb = fakeIDB(), seed = await A.openAppStore({ idb, ls: fakeStorage({}), bc: null });
  seed.saveProject({ name: 'newer', schema: M.SCHEMA + 1, uid: 'p_newer00001', tracks: [] });
  await seed.flush(); await seed.close();
  const st = await A.openAppStore({ idb, ls: fakeStorage({}), bc: null, schema: M.SCHEMA });
  assert.deepEqual([st.info().readOnly, st.info().newer], [true, M.SCHEMA + 1]);
  assert.equal(M.upgrade(JSON.parse(st.loadProject())).readOnly, true);
  await st.close();
  const ok = await A.openAppStore({ idb, ls: fakeStorage({}), bc: null, schema: M.SCHEMA + 1 });
  assert.equal(ok.info().readOnly, false);
  await ok.close();
});

/* ------------------------------------------------------------ the page (tests/main-sim.mjs) */
test('page: projects get a uid that survives reloads; a newer autosave opens read-only (Save disabled, the notice, nothing written)', async () => {
  const { bootMain } = await import('./main-sim.mjs');
  const idb = fakeIDB(), ls = fakeStorage({});
  const s1 = await bootMain({ idb, ls });
  const uid = s1.api.project().uid;
  assert.ok(M.isUid(uid), String(uid));
  assert.equal(s1.api.project().schema, M.SCHEMA);
  assert.ok(!s1.$('#fSave').disabled);
  s1.api.save(); await s1.api.store.flush();
  const head = () => JSON.parse(idb.data('synth-canvas', 'tracks').get('#head').m);
  assert.deepEqual([head().uid, head().schema], [uid, M.SCHEMA]);
  assert.equal(idb.dbs.has('synth-app'), false, 'main\'s database is never opened');
  const s1b = await bootMain({ idb, ls });
  assert.equal(s1b.api.project().uid, uid, 'the same project after a reload');
  // a newer build saved the autosave (an installed app that has not updated yet)
  const idb2 = fakeIDB(), seed = await A.openAppStore({ idb: idb2, ls: fakeStorage({}), bc: null });
  const newer = Object.assign(S.newProject({ model: 'juno60', name: 'from a newer build' }), { schema: M.SCHEMA + 1, uid: 'p_newerbuild1', futureField: { x: 1 } });
  seed.saveProject(newer); await seed.flush(); await seed.close();
  const before = JSON.stringify([...idb2.data('synth-canvas', 'tracks')]);
  const s2 = await bootMain({ idb: idb2, ls: fakeStorage({}) });
  assert.equal(s2.api.project().name, 'from a newer build');
  assert.equal(s2.api.store.info().readOnly, true);
  assert.equal(s2.$('#fSave').disabled, true, 'Save disabled');
  assert.equal(s2.$('#notice').textContent, M.READ_ONLY_NOTICE);
  s2.api.project().name = 'edited in the older build';
  s2.api.save(); s2.api.save(true); await s2.api.store.flush(); await s2.settle(10);
  assert.equal(JSON.stringify([...idb2.data('synth-canvas', 'tracks')]), before, 'the newer project is never overwritten');
  assert.equal(typeof s2.$('#notice').onclick, 'function', 'the notice applies the update / reloads');
  s2.$('#notice').onclick();
  await s2.settle(20);
  assert.equal(s2.reloads, 1);
  assert.equal(JSON.stringify([...idb2.data('synth-canvas', 'tracks')]), before, 'nor by the save before the reload');
});

test('1 → 2 (stage 1b, track.lay): additive — a schema-1 project keeps its uid and fields, lay survives song.js', () => {
  const o = deepFreeze({ name: 'one', schema: 1, uid: 'p_abc123xyz0', tracks: [{ id: 'trk_1', model: 'juno60', notes: [], lay: { i1: { x: 8, y: 16 } } }] });
  const up = M.upgrade(o);
  assert.deepEqual([up.from, up.readOnly, up.p.schema, up.p.uid], [1, false, 2, 'p_abc123xyz0']);
  assert.deepEqual(up.p.tracks, o.tracks, 'nothing converted');
  assert.deepEqual(S.deserialize(up.p).tracks[0].lay, { i1: { x: 8, y: 16 } });
  assert.deepEqual(M.STEPS[1]({ schema: 1, uid: 'p_abc123xyz0', x: 1 }), { schema: 2, uid: 'p_abc123xyz0', x: 1 });
});
