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
import * as MO from '../cv-model.js?v=9';
import * as G from '../cv-graph.js?v=9';
import * as C from '../serum-core.js?v=9';
import { fakeStorage, fakeIDB } from './fakes.mjs';

const P1 = readFileSync(new URL('./ref-p1/project-p1.json', import.meta.url), 'utf8'); // a main (schema 0) project file
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };

test('constants: SCHEMA, one step per schema, the read-only notice (§2.13)', () => {
  assert.equal(M.SCHEMA, 3, '1a: uid; 1b: track.lay; 1c: project v2 tracks');
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
  const p = MO.adopt(M.stamp(S.deserialize(up.p), up.p));
  assert.deepEqual([p.uid, p.schema], [up.p.uid, M.SCHEMA]);
  assert.deepEqual(p.tracks.map(t => t.model), S.deserialize(copy).tracks.map(t => t.model));
  assert.deepEqual(p.tracks.map(t => t.prim), p.tracks.map(() => 'i1'), 'v2 tracks (stage 1c): the instrument is device i1, the primary');
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
  assert.deepEqual([up.from, up.readOnly, up.p.schema, up.p.uid], [1, false, M.SCHEMA, 'p_abc123xyz0']);
  assert.deepEqual(M.STEPS[1](o).tracks, o.tracks, 'nothing converted by 1 → 2');
  assert.deepEqual(S.deserialize(up.p).tracks[0].lay, { i1: { x: 8, y: 16 } });
  assert.deepEqual(M.STEPS[1]({ schema: 1, uid: 'p_abc123xyz0', x: 1 }), { schema: 2, uid: 'p_abc123xyz0', x: 1 });
});

/* ------------------------------------------------------------ project v2 (stage 1c, §5.1, §5.4, §5.8) */
const P1J = () => JSON.parse(P1);
// a main project as the page holds it before stage 1c: song.js v1 tracks with their rack (main.js loadProject)
function mainProject() {
  const o = P1J(), p = S.deserialize(o), raw = new Map(o.tracks.map(t => [t.id, t]));
  for (const t of p.tracks) {
    const r = raw.get(t.id);
    if (r.seq && Array.isArray(r.seq.pat)) t.seq = r.seq;
    if (t.model === 'serum') t.vals = { s: C.normalizeSerum(t.vals.s) };
    t.fx = r.fx ? C.normalizeFx(r.fx, t.model === 'serum' ? t.vals.s : undefined) : C.defaultFx2();
  }
  return p;
}

test('toV2: classic → i1 → fx1 (the whole FX state) → out; Serum (its own FX) → out; v2 input kept, the mirror dropped', () => {
  const v = M.trackToV2({ id: 'trk_1', name: 'A', model: 'juno60', vals: { a: 1 }, preset: 'P', seq: null, fx: { v: 2, racks: [] }, notes: [], lay: { i1: { x: 0, y: 0 } } });
  assert.deepEqual(v, { id: 'trk_1', name: 'A', notes: [], lay: { i1: { x: 0, y: 0 } }, prim: 'i1', nid: 2,
    dev: { i1: { kind: 'synth', model: 'juno60', vals: { a: 1 }, preset: 'P' }, fx1: { kind: 'panel', fx: { v: 2, racks: [] } }, out: { kind: 'out' } },
    wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in' }, { id: 'w2', a: 'fx1.out', b: 'out.in' }] });
  const sx = M.trackToV2({ id: 'trk_2', model: 'serum', vals: { s: 1 }, preset: null, fx: { v: 2 } });
  assert.deepEqual([sx.dev.i1.fx, Object.keys(sx.dev), sx.wires], [{ v: 2 }, ['i1', 'out'], [{ id: 'w1', a: 'i1.out', b: 'out.in' }]]);
  assert.equal(G.validate(v).ok && G.validate(sx).ok, true);
  const file = Object.assign({}, v, { model: 'dx7', vals: { x: 1 }, fx: 3 });
  assert.deepEqual(M.trackToV2(file), v, 'a file\'s mirror is never read back');
});

test('toV2 → toV1 round-trips exactly (project-p1 and every model); the compile of the v2 form is the v1 one', () => {
  const p = mainProject(), v1 = JSON.parse(JSON.stringify(p));
  const v2 = M.toV2(p), back = M.toV1(v2);
  assert.deepEqual(back.lost, []);
  assert.deepEqual(back.p, v1, 'main\'s project, field for field');
  for (const t of v2.tracks) {
    const c = G.compileTrack(t), o = v1.tracks.find(x => x.id === t.id);
    assert.equal(c.canonical, true, t.name);
    assert.deepEqual([c.v1.model, c.v1.vals, c.v1.fx], [o.model, o.vals, o.fx], t.name);
  }
  assert.equal('schema' in M.toV1(Object.assign({ schema: 3 }, v2)).p, false, 'main\'s files carry no schema');
});

test('toV1 of a shape main cannot hold: one track per instrument, notes copied, what is lost listed', () => {
  const t = M.trackToV2({ id: 'trk_1', name: 'Split', model: 'juno60', vals: {}, preset: null, fx: C.defaultFx2(), notes: [{ t: 0, d: 10, n: 60, v: 100 }] });
  t.dev.i2 = { kind: 'synth', model: 'minimoog', vals: {}, preset: null, on: false };
  t.wires.push({ id: 'w3', a: 'i2.out', b: 'fx1.in' });
  t.mods = [{ id: 'r1', src: 'l1.out', dst: 'i1:fc' }];
  const r = M.toV1({ tracks: [t] });
  assert.deepEqual(r.p.tracks.map(x => [x.id, x.name, x.model, x.notes.length]), [['trk_1', 'Split', 'juno60', 1], [r.p.tracks[1].id, 'Split · minimoog', 'minimoog', 1]]);
  assert.notEqual(r.p.tracks[1].id, 'trk_1');
  assert.deepEqual(r.p.tracks.map(x => x.fx === r.p.tracks[0].fx || JSON.stringify(x.fx) === JSON.stringify(r.p.tracks[0].fx)), [true, true], 'each takes the panel it fed');
  assert.equal(r.lost.length, 3, r.lost.join(' | ')); // the shared panel, the switched-off instrument, the modulation cable
});

test('adopt: v1 tracks become v2 in place; the accessors read and write the primary; JSON carries only the v2 form', () => {
  const p = mainProject(), tr = p.tracks[0], model = tr.model, vals = tr.vals, fx = tr.fx;
  assert.equal(MO.adopt(p), p);
  assert.equal(p.tracks[0], tr, 'the same object');
  assert.deepEqual([tr.model, tr.vals, tr.fx, MO.isAdopted(tr)], [model, vals, fx, true]);
  const j = JSON.parse(JSON.stringify(tr));
  for (const k of M.V1_KEYS) assert.equal(k in j, false, k);
  assert.deepEqual(Object.keys(j).slice(-4), ['prim', 'nid', 'dev', 'wires']);
  tr.vals = { x: 1 }; tr.preset = 'Y';
  assert.deepEqual([tr.dev.i1.vals, tr.dev.i1.preset], [{ x: 1 }, 'Y']);
  const nf = C.defaultFx2(); tr.fx = nf;
  assert.equal(MO.fxDevOf(tr).dev.fx, nf);
  MO.adopt(p); // twice: nothing changes
  assert.equal(tr.fx, nf);
  // History snapshots are plain JSON: adopted again after undo
  const H = new S.History(10);
  H.record(p); tr.vals = { x: 2 };
  const u = H.undo(p);
  assert.equal(MO.isAdopted(u.tracks[0]), false);
  MO.adopt(u);
  assert.deepEqual([u.tracks[0].vals, u.tracks[0].model, u.tracks[0].fx.v], [{ x: 1 }, model, 2]);
});

test('adopt: a model change across classic ↔ Serum keeps the FX state (moved between the panel and the Serum)', () => {
  const p = MO.adopt({ tracks: [S.newTrack(null, { model: 'juno60' })] }), t = p.tracks[0], fx = C.defaultFx2();
  t.fx = fx;
  t.model = 'serum';
  assert.deepEqual([Object.keys(t.dev).sort(), t.dev.i1.fx === fx, t.fx === fx, G.compileTrack(t).shape], [['i1', 'out'], true, true, 'serum']);
  t.model = 'dx7';
  assert.deepEqual([Object.keys(t.dev).sort(), t.dev.fx1.fx === fx, 'fx' in t.dev.i1, t.fx === fx, G.compileTrack(t).shape], [['fx1', 'i1', 'out'], true, false, true, 'classic']);
  assert.equal(G.validate(t).ok, true);
  t.model = 'juno60'; // classic → classic: nothing reshaped
  assert.equal(t.dev.fx1.fx, fx);
  t.seq = { pat: [] }; t.seq = undefined;
  assert.equal('seq' in t.dev.i1, false);
});

test('song.js keeps v2 tracks (dev, wires, prim, nid) and ignores a file\'s mirror; main reads the mirror', () => {
  const p = MO.adopt(mainProject()), file = M.mirror(JSON.parse(S.serialize(p)));
  for (const t of file.tracks) assert.equal(t.model, p.tracks.find(x => x.id === t.id).model, 'mirror: the primary at track level');
  const back = S.deserialize(file);
  for (const t of back.tracks) {
    assert.equal('model' in t, false, 'the devices win');
    const o = p.tracks.find(x => x.id === t.id);
    assert.deepEqual([t.prim, t.nid, Object.keys(t.dev), t.wires], [o.prim, o.nid, Object.keys(o.dev), o.wires]);
    assert.deepEqual(t.dev.i1.vals, JSON.parse(JSON.stringify(o.vals)));
  }
  // main's song.js knows no `dev`: what it reads is the mirror — each track's primary instrument and its FX (§5.8)
  const onMain = S.deserialize(Object.assign({}, file, { tracks: file.tracks.map(t => { const c = Object.assign({}, t); delete c.dev; return c; }) }));
  for (const t of onMain.tracks) assert.equal(t.model, p.tracks.find(x => x.id === t.id).model);
  const raw = file.tracks.find(t => t.model === 'serum') || file.tracks[0];
  assert.deepEqual(raw.fx, JSON.parse(JSON.stringify(p.tracks.find(x => x.id === raw.id).fx)), 'and its FX (loadProject reads the record\'s fx)');
  // damaged records: no instrument → read as v1; a bad primary → the first instrument; bad wires dropped
  assert.equal(S.normDev({ dev: { out: { kind: 'out' } } }), null);
  const d = S.normDev({ prim: 'zz', nid: 0, dev: { i3: { kind: 'synth', model: 'x y' }, out: { kind: 'out' }, 'B!': { kind: 'synth' } }, wires: [{ a: 'i3.out', b: 'out.in' }, { a: 'x', b: 'y' }] });
  assert.deepEqual(d, { prim: 'i3', nid: 4, dev: { i3: { kind: 'synth', model: 'minimoog', vals: {}, preset: null }, out: { kind: 'out' } }, wires: [{ id: 'w1', a: 'i3.out', b: 'out.in' }] });
});
