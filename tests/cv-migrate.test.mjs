// cv-migrate.js tests (SPEC-canvas §5.1, §5.8, §10 stage 1a): the schema gate — a project of a newer schema is opened
// read-only and never modified; older projects (main's, schema 0) are brought to SCHEMA with a project uid; song.js keeps
// working on them; appstore's gate and cv-migrate agree on what "newer" is.
// Stage 1e: schema 4 (additive), song.normDev's instrument fields, cv-model's editing API (IMPL-1e §3.2).
// Stage 1f: splitTracks (one instrument per track in the UI: a several-instrument track opens as one track each).
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
const G1 = { guard: true }; // (milestone 3 R7: node tests adopt with the guard — a stray track.model / vals / fx throws)

test('constants: SCHEMA, one step per schema, the read-only notice (§2.13)', () => {
  assert.equal(M.SCHEMA, 7, '1a: uid; 1b: track.lay; 1c: project v2 tracks; 1e: several instruments per track; 2a: performance modulators; 2b: modulation everywhere; 3: Serum parts (lay)');
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
  const p = MO.adopt(M.stamp(S.deserialize(up.p), up.p), G1);
  assert.deepEqual([p.uid, p.schema], [up.p.uid, M.SCHEMA]);
  assert.deepEqual(p.tracks.map(t => MO.instOf(t).model), S.deserialize(copy).tracks.map(t => t.model));
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

test('adopt: v1 tracks become v2 in place — the primary and its FX are devices (instOf / fxDevOf: no v1 field, no accessor since milestone 3 R7); JSON carries only the v2 form; the guard throws on a stray read or write', () => {
  const p = mainProject(), tr = p.tracks[0], model = tr.model, vals = tr.vals, fx = tr.fx; // (a v1 record: its own fields)
  assert.equal(MO.adopt(p), p);
  assert.equal(p.tracks[0], tr, 'the same object');
  const D = () => MO.instOf(tr), F = () => MO.fxDevOf(tr).dev.fx;
  assert.deepEqual([D().model, D().vals, F(), MO.isAdopted(tr)], [model, vals, fx, true]);
  assert.deepEqual(M.V1_KEYS.map(k => k in tr), M.V1_KEYS.map(() => false), 'production adopt: no v1 field and no accessor (\'model\' in t === false)');
  const j = JSON.parse(JSON.stringify(tr));
  for (const k of M.V1_KEYS) assert.equal(k in j, false, k);
  assert.deepEqual(Object.keys(j).slice(-4), ['prim', 'nid', 'dev', 'wires']);
  D().vals = { x: 1 }; D().preset = 'Y';
  assert.deepEqual([tr.dev.i1.vals, tr.dev.i1.preset], [{ x: 1 }, 'Y']);
  const nf = C.defaultFx2(); MO.fxDevOf(tr).dev.fx = nf;
  MO.adopt(p); // twice: nothing changes
  assert.equal(F(), nf);
  // History snapshots are plain JSON: adopted again after undo
  const H = new S.History(10);
  H.record(p); D().vals = { x: 2 };
  const u = H.undo(p);
  assert.equal(MO.isAdopted(u.tracks[0]), false);
  MO.adopt(u, G1);
  assert.deepEqual([MO.instOf(u.tracks[0]).vals, MO.instOf(u.tracks[0]).model, MO.fxDevOf(u.tracks[0]).dev.fx.v], [{ x: 1 }, model, 2]);
  // the guard (the sims, dev builds, node tests — for one stage): every V1 key a throwing, non-enumerable accessor, told to the recorder
  const g = u.tracks[0], told = [];
  globalThis.__synthAccess = (k, op) => told.push(k + ':' + op);
  try {
    for (const k of M.V1_KEYS) {
      assert.throws(() => g[k], /has no v1 fields/, k);
      assert.throws(() => { g[k] = 1; }, /has no v1 fields/, k + ' =');
      const ds = Object.getOwnPropertyDescriptor(g, k);
      assert.deepEqual([typeof ds.get, ds.enumerable], ['function', false], k);
    }
  } finally { delete globalThis.__synthAccess; }
  assert.deepEqual([told.length, Object.keys(g).filter(k => M.V1_KEYS.includes(k)), 'model' in JSON.parse(JSON.stringify(g))], [10, [], false]);
});

test('setModel: a model change across classic ↔ Serum keeps the FX state (moved between the panel and the Serum) — R7: the primary as any instrument', () => {
  const p = MO.adopt({ tracks: [S.newTrack(null, { model: 'juno60' })] }, G1), t = p.tracks[0], fx = C.defaultFx2(), F = () => MO.fxDevOf(t).dev.fx;
  MO.fxDevOf(t).dev.fx = fx;
  const to = id => MO.setModel(t, 'i1', id, { vals: MO.instOf(t).vals });
  to('serum');
  assert.deepEqual([Object.keys(t.dev).sort(), t.dev.i1.fx === fx, F() === fx, G.compileTrack(t).shape], [['i1', 'out'], true, true, 'serum']);
  to('dx7');
  assert.deepEqual([Object.keys(t.dev).sort(), t.dev.fx1.fx === fx, 'fx' in t.dev.i1, F() === fx, G.compileTrack(t).shape], [['fx1', 'i1', 'out'], true, false, true, 'classic']);
  assert.equal(G.validate(t).ok, true);
  to('juno60'); // classic → classic: nothing reshaped
  assert.equal(t.dev.fx1.fx, fx);
});

test('song.js keeps v2 tracks (dev, wires, prim, nid) and ignores a file\'s mirror; main reads the mirror', () => {
  const p = MO.adopt(mainProject(), G1), file = M.mirror(JSON.parse(S.serialize(p)));
  for (const t of file.tracks) assert.equal(t.model, MO.instOf(p.tracks.find(x => x.id === t.id)).model, 'mirror: the primary at track level');
  const back = S.deserialize(file);
  for (const t of back.tracks) {
    assert.equal('model' in t, false, 'the devices win');
    const o = p.tracks.find(x => x.id === t.id);
    assert.deepEqual([t.prim, t.nid, Object.keys(t.dev), t.wires], [o.prim, o.nid, Object.keys(o.dev), o.wires]);
    assert.deepEqual(t.dev.i1.vals, JSON.parse(JSON.stringify(MO.instOf(o).vals)));
  }
  // main's song.js knows no `dev`: what it reads is the mirror — each track's primary instrument and its FX (§5.8)
  const onMain = S.deserialize(Object.assign({}, file, { tracks: file.tracks.map(t => { const c = Object.assign({}, t); delete c.dev; return c; }) }));
  for (const t of onMain.tracks) assert.equal(t.model, MO.instOf(p.tracks.find(x => x.id === t.id)).model);
  const raw = file.tracks.find(t => t.model === 'serum') || file.tracks[0];
  assert.deepEqual(raw.fx, JSON.parse(JSON.stringify(MO.fxDevOf(p.tracks.find(x => x.id === raw.id)).dev.fx)), 'and its FX (loadProject reads the record\'s fx)');
  // damaged records: no instrument → read as v1; a bad primary → the first instrument; bad wires dropped
  assert.equal(S.normDev({ dev: { out: { kind: 'out' } } }), null);
  const d = S.normDev({ prim: 'zz', nid: 0, dev: { i3: { kind: 'synth', model: 'x y' }, out: { kind: 'out' }, 'B!': { kind: 'synth' } }, wires: [{ a: 'i3.out', b: 'out.in' }, { a: 'x', b: 'y' }] });
  assert.deepEqual(d, { prim: 'i3', nid: 4, dev: { i3: { kind: 'synth', model: 'minimoog', vals: {}, preset: null }, out: { kind: 'out' } }, wires: [{ id: 'w1', a: 'i3.out', b: 'out.in' }] });
});

/* ------------------------------------------------------------------ stage 1e: schema 4, the editing API (IMPL-1e §3.2) */
const jclone = x => JSON.parse(JSON.stringify(x));
// an adopted one-Juno track (i1 → fx1 → out), as addTrack makes it
const juno = () => MO.adopt({ tracks: [Object.assign(S.newTrack(null, { model: 'juno60' }), { fx: C.defaultFx2() })] }, G1).tracks[0];
const wires = t => t.wires.map(w => w.a + '>' + w.b + (w.g !== undefined ? '@' + w.g : ''));

test('1e schema 4: additive (a 3 opens as before); song.normDev keeps on, solo, zone, name and the cable level', () => {
  const p3 = Object.assign(M.toV2(mainProject()), { schema: 3, uid: 'p_abc123xyz0' }), up = M.upgrade(deepFreeze(jclone(p3)));
  assert.deepEqual([up.from, up.readOnly, up.p.schema], [3, false, M.SCHEMA]);
  assert.deepEqual(Object.assign({}, up.p, { schema: 3 }), p3, 'nothing converted');
  assert.deepEqual(M.STEPS[3]({ schema: 3, tracks: [1] }), { schema: 4, tracks: [1] });
  const d = S.normDev({ prim: 'i2', dev: {
    i1: { kind: 'synth', model: 'juno60', on: false, solo: true, zone: { lo: 48.4, hi: 300, xp: -60 }, name: 'Pad' },
    i2: { kind: 'synth', model: 'dx7', solo: 1, on: 0, zone: { lo: 72, hi: 12 } },
    i3: { kind: 'synth', model: 'dx7', zone: { lo: 0, hi: 127, xp: 0 } },
    fx1: { kind: 'panel', name: 'Bus' }, out: { kind: 'out' },
  }, wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in', g: 0.5 }, { id: 'w2', a: 'i2.out', b: 'fx1.in', g: 9 }, { id: 'w3', a: 'fx1.out', b: 'out.in', g: 1 }, { id: 'w4', a: 'i3.out', b: 'out.in', g: -2 }] });
  assert.deepEqual(d.dev.i1, { kind: 'synth', model: 'juno60', vals: {}, preset: null, on: false, solo: true, zone: { lo: 48, hi: 127, xp: -48 }, name: 'Pad' });
  assert.deepEqual(d.dev.i2, { kind: 'synth', model: 'dx7', vals: {}, preset: null, zone: { lo: 12, hi: 72, xp: 0 } }, 'flags are booleans; a reversed zone swapped');
  assert.deepEqual(d.dev.i3, { kind: 'synth', model: 'dx7', vals: {}, preset: null }, 'the default zone is no field');
  assert.deepEqual([d.prim, d.dev.fx1.name, d.wires.map(w => w.g)], ['i2', 'Bus', [0.5, 4, undefined, 0]]);
  assert.equal(G.validate(Object.assign({}, d)).ok, true);
  // through a save / load (song.js serialize → deserialize)
  const t = juno(); MO.addInst(t, 'minimoog', { vals: {} }); MO.setZone(t, 'i2', { lo: 60, hi: 127, xp: 12 }); MO.setSolo(t, 'i2', true); MO.setPower(t, 'i1', false);
  t.wires[2].g = 0.7;
  const back = S.deserialize(S.serialize({ tracks: [t] })).tracks[0];
  assert.deepEqual([back.dev.i2.zone, back.dev.i2.solo, back.dev.i1.on, back.wires[2].g], [{ lo: 60, hi: 127, xp: 12 }, true, false, 0.7]);
});

test('1e cv-model: addInst auto-patches (the panel most instruments share, else OUT), limits, ids, a Serum with its own FX', () => {
  const t = juno();
  assert.deepEqual([MO.instIds(t), MO.isGraphShape(t)], [['i1'], false]);
  const i2 = MO.addInst(t, 'minimoog', { vals: { a: 1 }, name: 'Lead', ui: 'flow' });
  assert.deepEqual([i2, t.dev.i2, t.lay.i2, wires(t)], ['i2', { kind: 'synth', model: 'minimoog', vals: { a: 1 }, preset: null, name: 'Lead' }, { x: 0, y: 0, ui: 'flow' },
    ['i1.out>fx1.in', 'fx1.out>out.in', 'i2.out>fx1.in']]);
  assert.deepEqual([MO.instIds(t), MO.isGraphShape(t), G.validate(t).ok, MO.destOf(t, 'i2'), MO.instOf(t).model], [['i1', 'i2'], true, true, 'fx1', 'juno60']);
  // a second panel with one source: the new instrument still joins fx1 (two sources); a tie goes to the lowest id
  const fx2 = MO.addPanel(t, { name: 'B' });
  assert.deepEqual([fx2, t.dev[fx2].name, Object.keys(t.dev[fx2].fx).includes('racks')], ['fx3', 'B', true], 'ids from nid: never reused');
  MO.connect(t, 'fx3.out', 'out.in');
  const sx = MO.addInst(t, 'serum', { vals: { s: {} } });
  assert.deepEqual([MO.destOf(t, sx), 'fx' in t.dev[sx]], ['fx1', true]);
  MO.connect(t, 'i2.out', 'fx3.in'); MO.connect(t, sx + '.out', 'fx3.in');
  assert.equal(MO.destOf(t, MO.addInst(t, 'dx7')), 'fx3', 'fx3 now has the most sources');
  const solo = juno(); solo.wires = solo.wires.filter(w => w.a !== 'i1.out'); delete solo.dev.fx1; solo.wires = [];
  assert.equal(MO.destOf(solo, MO.addInst(solo, 'dx7')), 'out', 'no panel with an instrument: OUT');
  const full = juno();
  for (let i = 0; i < 7; i++) assert.ok(MO.addInst(full, 'juno60'));
  assert.equal(MO.addInst(full, 'juno60'), null, '8 instruments at most');
  for (let i = 0; i < 15; i++) assert.ok(MO.addPanel(full));
  assert.equal(MO.addPanel(full), null, '16 panels at most');
});

test('1e cv-model: removeInst / removePanel re-cable; connect / disconnect validate on a trial copy', () => {
  const t = juno(); MO.addInst(t, 'minimoog'); MO.addInst(t, 'dx7');
  t.mods = [{ id: 'r1', src: 'l1.out', dst: 'i2:fc' }, { id: 'r2', src: 'l1.out', dst: 'i1:fc' }];
  t.lay = { i2: { x: 1, y: 2 }, i1: { x: 0, y: 0 } };
  assert.deepEqual(MO.removeInst(t, 'i2'), { rows: ['r1'], ok: true, why: '' }, '(2a) the rows it removed');
  assert.deepEqual([Object.keys(t.dev), wires(t), t.mods.map(r => r.id), Object.keys(t.lay)], [['i1', 'fx1', 'out', 'i3'], ['i1.out>fx1.in', 'fx1.out>out.in', 'i3.out>fx1.in'], ['r2'], ['i1']]);
  assert.deepEqual(MO.removeInst(t, 'i1'), { rows: ['r2'], ok: true, why: '' });
  assert.deepEqual([t.prim, MO.instOf(t).model, MO.instIds(t)], ['i3', 'dx7', ['i3']], 'the lowest remaining instrument is the primary');
  assert.deepEqual(MO.removeInst(t, 'i3'), { ok: false, why: 'A track keeps at least one instrument' });
  assert.equal(MO.removeInst(t, 'fx1').ok, false);
  MO.addInst(t, 'juno60');
  assert.deepEqual(MO.removePanel(t, 'fx1'), { ok: true, why: '', rows: [] }); // (2b: the rows to its knobs, as removeInst's)
  assert.deepEqual([Object.keys(t.dev).includes('fx1'), wires(t)], [false, ['i3.out>out.in', 'i4.out>out.in']], 'its sources into OUT (fan-in)');
  assert.equal(G.validate(t).ok, true);
  const p = MO.addPanel(t);
  MO.connect(t, 'i3.out', p + '.in');
  MO.removePanel(t, p);
  assert.deepEqual(wires(t), ['i4.out>out.in'], 'a panel that fed nothing: its sources are cut');
  // connect: a's cable replaced (its id kept), the level, either order
  const c = juno(); MO.addInst(c, 'minimoog');
  const f2 = MO.addPanel(c); MO.connect(c, f2 + '.out', 'out.in');
  const w3 = c.wires.find(w => w.a === 'i2.out').id;
  const r = MO.connect(c, 'i2.out', f2 + '.in', 0.5);
  assert.deepEqual([r.ok, r.wire.id, r.wire.g, wires(c)], [true, w3, 0.5, ['i1.out>fx1.in', 'fx1.out>out.in', 'i2.out>fx3.in@0.5', 'fx3.out>out.in']]);
  assert.deepEqual([MO.connect(c, f2 + '.in', 'i2.out').ok, wires(c)[2]], [true, 'i2.out>fx3.in'], 'dragged from the input; level 1 = no g');
  for (const [a, b, code] of [['fx1.out', f2 + '.in', 'chain'], ['i1.out', 'i2.in', 'end'], ['fx1.out', 'fx1.in', 'chain'], ['i1.out', 'nope.in', 'end'], ['i1.out', 'out.out', 'end']]) {
    const before = jclone(c.wires), x = MO.connect(c, a, b);
    assert.deepEqual([x.ok, x.code, x.wire, typeof x.why === 'string' && x.why.length > 0], [false, code, null, true], a + '>' + b);
    assert.deepEqual(c.wires, before, 'a refusal leaves the track untouched');
  }
  assert.deepEqual(MO.connect(c, 'x', 'y'), { ok: false, why: 'No such jack', code: 'end', fix: null, wire: null });
  assert.deepEqual(MO.disconnect(c, w3), { ok: true, why: '' });
  assert.deepEqual([wires(c), MO.disconnect(c, w3).ok], [['i1.out>fx1.in', 'fx1.out>out.in', 'fx3.out>out.in'], false]);
});

test('1e cv-model: power, solo, zone, primary — what the compile and the accessors see', () => {
  const t = juno(); MO.addInst(t, 'minimoog');
  MO.setPower(t, 'i2', false);
  assert.deepEqual([t.dev.i2.on, G.compileTrack(t).canonical], [false, true], 'a powered-off second instrument: today\'s shape');
  MO.setPower(t, 'i2', true);
  assert.equal('on' in t.dev.i2, false);
  MO.setSolo(t, 'i2', true);
  assert.deepEqual([t.dev.i2.solo, G.powered(t)], [true, ['i2']]);
  MO.setSolo(t, 'i2', false);
  assert.equal('solo' in t.dev.i2, false);
  assert.deepEqual(MO.setZone(t, 'i2', { lo: 72, hi: 60, xp: 7.6 }), { zone: { lo: 60, hi: 72, xp: 8 }, ok: true, why: '' });
  assert.deepEqual(t.dev.i2.zone, { lo: 60, hi: 72, xp: 8 });
  MO.setZone(t, 'i2', { lo: 0, hi: 127, xp: 0 });
  assert.equal('zone' in t.dev.i2, false, 'the default zone is no field');
  assert.deepEqual([MO.setPower(t, 'fx1', false).ok, MO.setZone(t, 'zz', {}).ok, MO.makePrimary(t, 'out').ok], [false, false, false]);
  assert.deepEqual(MO.makePrimary(t, 'i2'), { ok: true, why: '' });
  assert.deepEqual([t.prim, MO.instOf(t).model, MO.instIds(t), G.compileGraph(t).graph.insts.map(x => x.salt)], ['i2', 'minimoog', ['i2', 'i1'], [0, 0x9E3779B9]]);
});

test('1e cv-model: setModel keeps the FX by the rules (classic ↔ Serum), sharedPanelFix', () => {
  // classic → Serum, the only source of a panel into OUT: the panel's state becomes its own FX (1c's reshape)
  const a = juno(), fxa = a.dev.fx1.fx; MO.addInst(a, 'minimoog');
  MO.removeInst(a, 'i1');
  assert.deepEqual(MO.setModel(a, 'i2', 'serum', { vals: { s: 1 } }), { rows: [], notice: '', ok: true, why: '' });
  assert.deepEqual([Object.keys(a.dev).sort(), a.dev.i2.fx === fxa, wires(a), a.dev.i2.vals, a.dev.i2.preset], [['i2', 'out'], true, ['i2.out>out.in'], { s: 1 }, null]);
  // Serum → classic: its own FX become a new panel between it and what it fed
  MO.setModel(a, 'i2', 'dx7', { vals: {} });
  const np = Object.keys(a.dev).find(k => a.dev[k].kind === 'panel');
  assert.deepEqual([a.dev[np].fx === fxa, 'fx' in a.dev.i2, wires(a)], [true, false, ['i2.out>' + np + '.in', np + '.out>out.in']]);
  // classic → Serum feeding a shared panel (another source): it keeps feeding it with an empty (or the given) own rack
  const b = juno(); MO.addInst(b, 'minimoog');
  const own = C.defaultFx2(); C.newInstance(own, 'rev', { rack: 0 });
  MO.setModel(b, 'i2', 'serum', { vals: { s: 1 }, fx: own });
  assert.deepEqual([wires(b), b.dev.i2.fx === own, 'fx1' in b.dev], [['i1.out>fx1.in', 'fx1.out>out.in', 'i2.out>fx1.in'], true, true]);
  assert.deepEqual([G.validate(b).ok, G.compileTrack(b).why], [true, 'several']);
  // Serum → classic feeding a shared panel: still feeds it; its own effects kept as a panel of their own (not cabled)
  MO.setModel(b, 'i2', 'juno60', { vals: {} });
  const kept = Object.keys(b.dev).filter(k => b.dev[k].kind === 'panel' && k !== 'fx1');
  assert.deepEqual([wires(b), kept.length, b.dev[kept[0]].fx === own, 'fx' in b.dev.i2], [['i1.out>fx1.in', 'fx1.out>out.in', 'i2.out>fx1.in'], 1, true, false]);
  MO.setModel(b, 'i1', 'serum', { vals: { s: 1 } }); MO.setModel(b, 'i1', 'juno60', { vals: {} });
  assert.equal(Object.keys(b.dev).filter(k => b.dev[k].kind === 'panel').length, 2, 'an empty own rack leaves no panel');
  // the primary takes the same rules (main.js setTrackModel: setModel for every instrument since R5)
  const c = juno(); MO.setModel(c, 'i1', 'serum', { vals: {} });
  assert.deepEqual([Object.keys(c.dev).sort(), G.compileTrack(c).shape], [['i1', 'out'], 'serum']);
  // sharedPanelFix: a Serum into OUT gets a panel after it, the refused source joins; a Serum feeding a panel: joins that
  const d = juno(); MO.setModel(d, 'i1', 'serum', { vals: {} }); MO.addInst(d, 'juno60');
  const no = MO.connect(d, 'i2.out', 'i1.in');
  assert.deepEqual([no.ok, no.code, no.fix], [false, 'own-fx', 'panel']);
  const pid = MO.sharedPanelFix(d, 'i1', 'i2');
  assert.deepEqual([wires(d), G.validate(d).ok], [['i2.out>' + pid + '.in', 'i1.out>' + pid + '.in', pid + '.out>out.in'], true]); // (i2's cable re-pointed in place)
  const i4 = MO.addInst(d, 'dx7');
  assert.deepEqual([i4, MO.connect(d, i4 + '.out', 'out.in').ok, MO.destOf(d, i4)], ['i4', true, 'out'], '(ids never reused: fx3 took 3)');
  assert.deepEqual([MO.sharedPanelFix(d, 'i1', i4), MO.destOf(d, i4)], [pid, pid]);
  assert.equal(MO.setModel(d, 'zz', 'dx7').ok, false);
});

/* host fixes (the stage-1e review round) */
test('H4: a classic primary cabled straight to OUT (its panel deleted) has no FX device; a Serum there has its own (R7: no track.fx to read or write)', () => {
  const p = MO.adopt({ tracks: [S.newTrack(null, { model: 'juno60' })] }, G1), t = p.tracks[0];
  assert.equal(MO.removePanel(t, 'fx1').ok, true);
  const shape = () => Object.keys(t.dev).sort().join(',') + ' | ' + t.wires.map(w => w.a + '>' + w.b).join(' ');
  assert.deepEqual([shape(), MO.fxDevOf(t)], ['i1,out | i1.out>out.in', null]);
  MO.setModel(t, 'i1', 'serum', { vals: {}, fx: C.defaultFx2() }); // (a Serum primary: its own FX)
  assert.deepEqual([shape(), MO.fxDevOf(t).own, !!t.dev.i1.fx], ['i1,out | i1.out>out.in', true, true]);
});

test('H8: Save as classic project lists key zones, cable levels, solo, a Serum\'s shared panel and silent instruments that sound in main', () => {
  const t = { id: 'trk_1', name: 'T', color: '#f00', notes: [], prim: 'i1', nid: 4,
    dev: { i1: { kind: 'synth', model: 'serum', vals: { s: C.defaultSerum() }, preset: null, fx: C.defaultFx2() },
      i2: { kind: 'synth', model: 'juno60', vals: {}, preset: null, zone: { lo: 48, hi: 72, xp: 12 }, solo: true },
      i3: { kind: 'synth', model: 'minimoog', vals: {}, preset: null },
      fx1: { kind: 'panel', fx: C.defaultFx2() }, out: { kind: 'out' } },
    wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in' }, { id: 'w2', a: 'i2.out', b: 'fx1.in', g: 0.5 }, { id: 'w3', a: 'fx1.out', b: 'out.in' }] };
  const r = M.toV1({ schema: 4, tracks: [t] }), L = r.lost.join('\n');
  assert.deepEqual(r.p.tracks.map(x => x.model), ['serum', 'juno60', 'minimoog']);
  for (const [re, what] of [[/T · juno60”: its key zone/, 'the zone'], [/T · juno60”: its cable level/, 'the level'], [/“T”: solo/, 'solo'],
    [/“T”: the panel fx1 after the Serum/, 'a Serum into a shared panel: its effects not copied'],
    [/T · minimoog”: was not connected/, 'an unconnected instrument sounds in main'], [/“T”: was silent/, 'the soloed-out primary sounds in main']]) assert.match(L, re, what + '\n' + L);
  assert.doesNotMatch(L, /copied for each instrument/, 'one classic source of fx1: nothing copied');
  // a one-instrument track with a zone (a graph shape now): its own track, the zone listed
  const z = M.trackToV2({ id: 'trk_2', name: 'Z', model: 'juno60', vals: {}, preset: null, fx: C.defaultFx2(), notes: [] });
  z.dev.i1.zone = { lo: 60, hi: 127, xp: 0 };
  const rz = M.toV1({ tracks: [z] });
  assert.deepEqual([rz.p.tracks.length, rz.lost.length, /“Z”: its key zone/.test(rz.lost.join())], [1, 1, true]);
});

test('H4 ids: a Serum unfolds the panel it folded in under that id (dev.fxId, saved); a deleted panel\'s id never comes back', () => {
  const mk = () => MO.adopt({ tracks: [S.newTrack(null, { model: 'juno60' })] }, G1).tracks[0];
  const to = (t, id) => MO.setModel(t, 'i1', id, { vals: MO.instOf(t).vals }); // (R7: the primary's model through setModel)
  const ids = t => Object.keys(t.dev).sort().join(',');
  // the canonical round trip classic → Serum → classic: fx1 again, its state; the id saved through song.js
  const t = mk(), cho = C.defaultFx2(); C.newInstance(cho, 'cho', { rack: 0 }); MO.fxDevOf(t).dev.fx = cho;
  to(t, 'serum');
  assert.deepEqual([ids(t), t.dev.i1.fxId, t.dev.i1.fx === cho], ['i1,out', 'fx1', true]);
  const back = S.normDev(JSON.parse(JSON.stringify(t)));
  assert.equal(back.dev.i1.fxId, 'fx1', 'song.normDev keeps it');
  assert.equal(S.normDev({ dev: { i1: { kind: 'synth', model: 'serum', fxId: 'x<1' } } }).dev.i1.fxId, undefined, '(only an fx id)');
  to(t, 'dx7');
  assert.deepEqual([ids(t), t.dev.fx1.fx === cho, 'fxId' in t.dev.i1, MO.destOf(t, 'i1')], ['fx1,i1,out', true, false, 'fx1']);
  MO.setModel(t, 'i1', 'serum'); MO.setModel(t, 'i1', 'juno60'); // (setModel: the same rule)
  assert.deepEqual([ids(t), t.dev.fx1.fx === cho], ['fx1,i1,out', true]);
  // fx1 deleted, then classic → Serum → classic: a new panel fx2 (an undo past the delete keeps fx1 — the chorus — apart
  // from it: the device ids per track are never one another's)
  const u = mk(); MO.fxDevOf(u).dev.fx = cho;
  const before = JSON.parse(JSON.stringify(u));
  MO.removePanel(u, 'fx1');
  to(u, 'serum');
  assert.deepEqual([ids(u), 'fxId' in u.dev.i1], ['i1,out', false]);
  to(u, 'juno60');
  assert.deepEqual([ids(u), MO.destOf(u, 'i1')], ['fx2,i1,out', 'fx2']);
  assert.deepEqual([Object.keys(before.dev).filter(k => k in u.dev && before.dev[k].kind === 'panel'), before.dev.fx1.fx.racks[0].mods.map(m => m.type)], [[], ['cho']], 'no shared panel id: keepDevs keeps the snapshot\'s chorus');
});

// stage 1f: one instrument per track in the UI — splitTracks (pure; main.js loadProject calls it on autosave and files)
const v2 = (o, extra) => Object.assign(M.trackToV2(Object.assign({ name: 'T', color: '#e8a23a', ch: 1, mute: false, solo: false, arm: false, vol: 0.8, pan: 0, cc: [{ t: 0, c: 1, v: 9 }],
  vals: {}, preset: null, fx: C.defaultFx2(), notes: [{ t: 0, d: 10, n: 60, v: 100 }, { t: 20, d: 10, n: 64, v: 90 }] }, o)), extra || {});
const fxW = type => { const fx = C.defaultFx2(); C.newInstance(fx, type, { rack: 0 }); return fx; };
const shape = t => Object.keys(t.dev).sort().join(',') + ' | ' + t.wires.map(w => w.a + '>' + w.b + (w.g !== undefined ? '@' + w.g : '')).sort().join(' ');
const NAME = { juno60: 'Juno-60', minimoog: 'Minimoog', serum: 'Serum', dx7: 'DX7' };
const split = p => M.splitTracks(p, { name: id => NAME[id] || id });
const fxMods = fx => fx.racks.flatMap(r => r.mods.map(m => m.type));

test('1f splitTracks: a single-instrument project (canonical tracks) comes back as it is — the same objects, no notice; a classic straight into OUT (a 1e project) gets an empty panel of its own (the same sound: an empty rack), silently', () => {
  const p = { schema: M.SCHEMA, tracks: [v2({ id: 'trk_1', model: 'juno60' }), v2({ id: 'trk_2', model: 'serum' })] };
  p.tracks[0].lay = { i1: { x: 0, y: 0 } };
  const r = split(p);
  assert.equal(r.p, p, 'the project itself');
  assert.deepEqual(r.notices, []);
  // project-p1 (main's file, through the steps): untouched
  const up = M.upgrade(JSON.parse(P1)).p;
  assert.equal(split(up).p, up);
  assert.deepEqual([split(null).p, split({}).notices], [null, []]);
  // a DX7 whose panel was deleted in 1e: i1 → out — a panel of its own (fx<nid>), no notice
  const q = { tracks: [v2({ id: 'trk_1', model: 'dx7' })] };
  delete q.tracks[0].dev.fx1; q.tracks[0].wires = [{ id: 'w1', a: 'i1.out', b: 'out.in' }]; q.tracks[0].nid = 2; q.tracks[0].lay = { i1: { x: 0, y: 0 }, out: { x: 900, y: 0 } };
  const rq = split(q), a = rq.p.tracks[0];
  assert.deepEqual([shape(a), a.nid, fxMods(a.dev.fx2.fx), Object.keys(a.lay).sort().join(','), rq.notices], ['fx2,i1,out | fx2.out>out.in i1.out>fx2.in', 3, [], 'i1,out', []]);
  assert.equal(G.compileTrack(a).canonical, true);
  assert.equal(split(rq.p).p, rq.p, 'stable: split again, nothing changes');
});

test('1f splitTracks: two classics into one panel → two tracks — the first sounding instrument keeps the track (id, name, lay, device ids), the other a new one "<track> · <model>" with the panel\'s FX copied (its name not) and the notes; one notice', () => {
  const t = v2({ id: 'trk_3', name: 'Pad', model: 'juno60', fx: fxW('cho') });
  t.dev.fx1.name = 'Shared';
  t.dev.i2 = { kind: 'synth', model: 'minimoog', vals: { cutoff: 3 }, preset: 'Bass' };
  t.wires.push({ id: 'w3', a: 'i2.out', b: 'fx1.in' });
  t.nid = 3;
  t.lay = { i1: { x: 0, y: 0 }, i2: { x: 0, y: 600 }, fx1: { x: 1400, y: 0 }, out: { x: 2300, y: 0 } };
  const p = { schema: M.SCHEMA, selTrack: 'trk_3', tracks: [v2({ id: 'trk_1', model: 'dx7' }), t, v2({ id: 'trk_9', model: 'serum' })] };
  const before = JSON.stringify(p), r = split(p);
  assert.equal(JSON.stringify(p), before, 'the input untouched');
  assert.deepEqual(r.p.tracks.map(x => x.id), ['trk_1', 'trk_3', 'trk_10', 'trk_9'], 'the new track right after its source, a fresh id');
  assert.equal(r.p.tracks[0], p.tracks[0], 'the other tracks: the same objects');
  const [a, b] = [r.p.tracks[1], r.p.tracks[2]];
  assert.deepEqual([a.name, a.prim, a.nid, shape(a), a.dev.i1.model, Object.keys(a.lay).sort().join(','), a.dev.fx1.name], ['Pad', 'i1', 3, 'fx1,i1,out | fx1.out>out.in i1.out>fx1.in', 'juno60', 'fx1,i1,out', 'Shared'], 'its lay without i2');
  assert.deepEqual([b.name, b.prim, b.nid, shape(b), b.dev.i1.model, b.dev.i1.vals, b.dev.i1.preset, 'lay' in b, 'name' in b.dev.fx1], ['Pad · Minimoog', 'i1', 2, 'fx1,i1,out | fx1.out>out.in i1.out>fx1.in', 'minimoog', { cutoff: 3 }, 'Bass', false, false]);
  assert.deepEqual([fxMods(a.dev.fx1.fx), fxMods(b.dev.fx1.fx)], [['cho'], ['cho']], 'the shared panel copied for each');
  assert.equal(a.dev.fx1.fx === b.dev.fx1.fx, false, 'not the same object');
  assert.deepEqual([b.notes, b.cc, b.color, b.ch, b.vol, b.mute], [t.notes, t.cc, t.color, t.ch, t.vol, false], 'the notes and the rest of the track copied');
  assert.equal(b.notes === a.notes, false);
  for (const k of M.V1_KEYS) assert.equal(k in b, false, k);
  assert.deepEqual(r.notices, ['Track “Pad” held 2 instruments: now 2 tracks']);
  assert.deepEqual(r.p.tracks.map(x => G.compileTrack(x).canonical), [true, true, true, true], 'every track canonical');
  assert.equal(r.p.selTrack, 'trk_3');
  assert.equal(split(r.p).p, r.p, 'stable');
  // song.js reads them; adopt accepts them
  const s = S.deserialize(JSON.stringify(r.p));
  assert.deepEqual(s.tracks.map(x => x.dev && Object.keys(x.dev).sort().join(',')), ['fx1,i1,out', 'fx1,i1,out', 'fx1,i1,out', 'i1,out']);
  MO.adopt(s, G1);
  assert.deepEqual(s.tracks.map(x => MO.instOf(x).model), ['dx7', 'juno60', 'minimoog', 'serum']);
});

test('1f splitTracks (review 1): a Serum heard through a panel — its own FX empty: the panel\'s FX become its own (the same sound, reshape\'s rule, no notice line); its own FX holding effects: kept, and the notice says the panel after it was not kept', () => {
  // 1e: a Serum added to a Minimoog track (auto-patched into the shared panel fx1: a reverb)
  const t = v2({ id: 'trk_a', name: 'Lead', model: 'minimoog', fx: fxW('rev') });
  t.dev.i2 = { kind: 'synth', model: 'serum', vals: {}, preset: null, fx: C.defaultFx2() };
  t.wires.push({ id: 'w3', a: 'i2.out', b: 'fx1.in' }); t.nid = 3;
  const r = split({ tracks: [t] }), [a, b] = r.p.tracks;
  assert.deepEqual([shape(a), fxMods(a.dev.fx1.fx), b.name, shape(b), fxMods(b.dev.i1.fx)], ['fx1,i1,out | fx1.out>out.in i1.out>fx1.in', ['rev'], 'Lead · Serum', 'i1,out | i1.out>out.in', ['rev']], 'the Serum keeps the reverb it was heard through');
  assert.deepEqual(r.notices, ['Track “Lead” held 2 instruments: now 2 tracks']);
  // its own FX hold a delay: kept; the panel after it (the chorus) is not
  const u = v2({ id: 'trk_b', name: 'Mix', model: 'minimoog', fx: fxW('cho') });
  u.dev.i2 = { kind: 'synth', model: 'serum', vals: {}, preset: null, fx: fxW('dly') };
  u.wires.push({ id: 'w3', a: 'i2.out', b: 'fx1.in' }); u.nid = 3;
  const r2 = split({ tracks: [u] });
  assert.deepEqual(fxMods(r2.p.tracks[1].dev.i1.fx), ['dly']);
  assert.deepEqual(r2.notices, ['Track “Mix” held 2 instruments: now 2 tracks — Serum: the panel after it was not kept']);
  // one Serum → a panel → OUT alone (1e: replace with Serum on a shared track, then the other deleted): the moved rule too
  const w = v2({ id: 'trk_c', name: 'Solo', model: 'serum', fx: C.defaultFx2() });
  w.dev.fx2 = { kind: 'panel', fx: fxW('dly') };
  w.wires = [{ id: 'w1', a: 'i1.out', b: 'fx2.in' }, { id: 'w2', a: 'fx2.out', b: 'out.in' }]; w.nid = 3;
  const r3 = split({ tracks: [w] }), c = r3.p.tracks[0];
  assert.deepEqual([shape(c), fxMods(c.dev.i1.fx), r3.notices, G.compileTrack(c).canonical], ['i1,out | i1.out>out.in', ['dly'], [], true]);
});

test('1f splitTracks (review 2): what does not survive is in the notice — one line per affected track, single-instrument tracks too: off / not connected / soloed out (muted), a key zone, a cable level, unconnected panels with effects', () => {
  const t = v2({ id: 'trk_a', name: 'Mix', model: 'serum', fx: fxW('rev') });
  t.dev.i1.solo = true;
  t.dev.fx2 = { kind: 'panel', fx: fxW('dly') };
  t.dev.i3 = { kind: 'synth', model: 'juno60', vals: {}, preset: null, zone: { lo: 48, hi: 72, xp: 12 } };
  t.wires = [{ id: 'w1', a: 'i1.out', b: 'out.in' }, { id: 'w2', a: 'i3.out', b: 'fx2.in', g: 0.5 }, { id: 'w3', a: 'fx2.out', b: 'out.in' }];
  t.nid = 4;
  t.lay = { i1: { x: 0, y: 0 }, 'i1/fx': { x: 1300, y: 0 }, fx2: { x: 2200, y: 0 } };
  const r = split({ tracks: [t] }), [a, b] = r.p.tracks;
  assert.deepEqual([a.id, a.prim, shape(a), fxMods(a.dev.i1.fx), 'solo' in a.dev.i1, Object.keys(a.lay).sort().join(','), a.mute], ['trk_a', 'i1', 'i1,out | i1.out>out.in', ['rev'], false, 'i1,i1/fx', false]);
  assert.deepEqual([b.name, shape(b), fxMods(b.dev.fx1.fx), 'zone' in b.dev.i1, b.mute], ['Mix · Juno-60', 'fx1,i1,out | fx1.out>out.in i1.out>fx1.in', ['dly'], false, true], 'the Juno-60 was silent (the Serum soloed): muted');
  assert.deepEqual(r.notices, ['Track “Mix” held 2 instruments: now 2 tracks — Juno-60: was silent, another one soloed (now muted); its key zone / transpose was dropped; its cable level was dropped']);
  // single-instrument tracks: an unconnected panel with effects (1e: the own FX a Serum → classic replace kept); one switched off
  const u = v2({ id: 'trk_1', name: 'Keys', model: 'juno60', fx: fxW('eq') });
  u.dev.fx4 = { kind: 'panel', fx: fxW('rev') }; u.dev.fx5 = { kind: 'panel', fx: C.defaultFx2() }; u.nid = 6;
  const v = v2({ id: 'trk_2', name: 'Off', model: 'juno60' });
  v.dev.i1.on = false;
  const r2 = split({ tracks: [u, v] });
  assert.deepEqual(r2.p.tracks.map(x => shape(x)), ['fx1,i1,out | fx1.out>out.in i1.out>fx1.in', 'fx1,i1,out | fx1.out>out.in i1.out>fx1.in'], 'the unconnected panels dropped');
  assert.deepEqual([fxMods(r2.p.tracks[0].dev.fx1.fx), 'on' in r2.p.tracks[1].dev.i1, r2.p.tracks[1].mute], [['eq'], false, true], 'powered, the track muted');
  assert.deepEqual(r2.notices, ['Track “Keys”: 1 unconnected FX panel with effects was dropped', 'Track “Off”: was switched off (now muted)']);
});

test('1f splitTracks (review 5, nits): the first sounding instrument keeps the track — an off primary moves out (muted); a long track name is cut so " · Model" fits; a primary cabled to nothing gets a panel of its own', () => {
  // the primary off, the second on
  const t = v2({ id: 'trk_2', name: 'W', model: 'dx7', fx: fxW('eq') });
  t.dev.i1.on = false;
  t.dev.i2 = { kind: 'synth', model: 'juno60', vals: {}, preset: null };
  t.wires.push({ id: 'w3', a: 'i2.out', b: 'fx1.in' }); t.nid = 3;
  t.lay = { i1: { x: 0, y: 0 }, i2: { x: 0, y: 700 }, fx1: { x: 1400, y: 0 } };
  const r = split({ selTrack: 'trk_2', tracks: [t] }), [a, b] = r.p.tracks;
  assert.deepEqual([a.id, a.name, a.prim, a.dev[a.prim].model, a.mute, Object.keys(a.lay).sort().join(','), shape(a)], ['trk_2', 'W', 'i2', 'juno60', false, 'fx1,i2', 'fx1,i2,out | fx1.out>out.in i2.out>fx1.in'], 'the Juno-60 sounded: it keeps the track (its ids, its place)');
  assert.deepEqual([b.name, b.dev.i1.model, b.mute, fxMods(b.dev.fx1.fx)], ['W · DX7', 'dx7', true, ['eq']]);
  assert.deepEqual([r.p.selTrack, r.notices], ['trk_2', ['Track “W” held 2 instruments: now 2 tracks — DX7: was switched off (now muted)']]);
  // 100 characters of name: the base is cut, the suffix kept
  const long = 'L'.repeat(100), u = v2({ id: 'trk_5', name: long, model: 'juno60' });
  u.dev.i2 = { kind: 'synth', model: 'minimoog', vals: {}, preset: null }; u.wires.push({ id: 'w3', a: 'i2.out', b: 'fx1.in' }); u.nid = 3;
  const n = split({ tracks: [u] }).p.tracks[1].name;
  assert.deepEqual([n.length <= 100, n.endsWith(' · Minimoog'), n.startsWith('LLL')], [true, true, true], n);
  // two instruments, the primary (a classic) cabled to nothing: muted, a new panel of its own; the other keeps the track
  const w = v2({ id: 'trk_1', name: 'W', model: 'dx7' });
  w.dev.i2 = { kind: 'synth', model: 'juno60', vals: {}, preset: null };
  w.wires = [{ id: 'w2', a: 'fx1.out', b: 'out.in' }, { id: 'w3', a: 'i2.out', b: 'fx1.in' }];
  w.nid = 3;
  const r3 = split({ tracks: [w] }), [c, d] = r3.p.tracks;
  assert.deepEqual([c.id, c.prim, shape(c), c.mute, d.name, shape(d), d.mute], ['trk_1', 'i2', 'fx1,i2,out | fx1.out>out.in i2.out>fx1.in', false, 'W · DX7', 'fx1,i1,out | fx1.out>out.in i1.out>fx1.in', true]);
  assert.deepEqual(r3.notices, ['Track “W” held 2 instruments: now 2 tracks — DX7: was not connected (now muted)']);
});

test('1f page: an autosave whose track holds two instruments opens as two tracks with the notice (loadProject at boot); the split is saved', async () => {
  const { bootMain } = await import('./main-sim.mjs');
  const idb = fakeIDB(), seed = await A.openAppStore({ idb, ls: fakeStorage({}), bc: null });
  const p = Object.assign(S.newProject({ model: 'juno60', name: 'duo', trackName: 'Duo' }), { schema: M.SCHEMA, uid: 'p_duoduo1234' });
  const t = M.trackToV2(p.tracks[0]);
  t.dev.i2 = { kind: 'synth', model: 'minimoog', vals: {}, preset: null };
  t.wires.push({ id: 'w3', a: 'i2.out', b: 'fx1.in' });
  t.nid = 3; t.notes = [{ id: 1, t: 0, d: 480, n: 60, v: 100 }];
  p.tracks[0] = t;
  seed.saveProject(p); await seed.flush(); await seed.close();
  const css = globalThis.CSS;
  globalThis.CSS = { supports: () => false }; // (an old browser: the platform notice at boot too — review 6: both shown, joined)
  let s1;
  try { s1 = await bootMain({ idb, ls: fakeStorage({}) }); } finally { if (css === undefined) delete globalThis.CSS; else globalThis.CSS = css; }
  const tr = s1.api.project().tracks;
  assert.deepEqual(tr.map(x => x.name + ':' + MO.instOf(x).model + ':' + Object.keys(x.dev).sort().join('/') + ':' + x.notes.length), ['Duo:juno60:fx1/i1/out:1', 'Duo · Minimoog:minimoog:fx1/i1/out:1']);
  const nt = s1.$('#notice').textContent;
  assert.ok(nt.startsWith('Track “Duo” held 2 instruments: now 2 tracks · ') && /some parts may not work in this browser$/.test(nt), nt);
  // (review 2b) the autosave as it was before the split, kept once under synth.project.pre1f (recoverable by hand)
  const pre = () => JSON.parse(s1.api.store.raw('synth.project.pre1f') || 'null');
  assert.deepEqual([pre() && pre().tracks.length, pre() && Object.keys(pre().tracks[0].dev).sort().join(',')], [1, 'fx1,i1,i2,out']);
  s1.api.save(); await s1.api.store.flush();
  const s2 = await bootMain({ idb, ls: fakeStorage({}) });
  assert.deepEqual([s2.api.project().tracks.length, s2.$('#notice').textContent.includes('held')], [2, false], 'saved split: no notice the next time');
  const pre2 = JSON.parse(s2.api.store.raw('synth.project.pre1f') || 'null');
  assert.deepEqual([pre2 && pre2.tracks.length, pre2 && Object.keys(pre2.tracks[0].dev).length], [1, 4], 'never overwritten');
});

/* ------------------------------------------------------------------ stage 2a: performance modulators (IMPL-2a §2.2, §2.3) */
const sxTrack = id => { const t = MO.adopt({ tracks: [Object.assign(S.newTrack(null, { model: 'serum' }), { vals: { s: C.normalizeSerum(C.defaultSerum()) }, fx: C.defaultFx2() })] }, G1).tracks[0]; if (id) t.id = id; return t; };
const mrow = o => Object.assign({ id: 'r1', src: 'wheel', dst: 'i1:f.cutoff', amt: 0.5, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 }, o);
const OPT2 = { sr: 48000, bpm: 120 };

test('2a schema 5: additive (a 4 opens as before); song.normDev keeps mod rows by normRow\'s rules and mid, drops invalid ones; perf', () => {
  const p4 = Object.assign(M.toV2(mainProject()), { schema: 4, uid: 'p_abc123xyz0' }), up = M.upgrade(deepFreeze(jclone(p4)));
  assert.deepEqual([up.from, up.readOnly, up.p.schema], [4, false, M.SCHEMA]);
  assert.deepEqual(Object.assign({}, up.p, { schema: 4 }), p4, 'nothing converted');
  assert.deepEqual(M.STEPS[4]({ schema: 4, tracks: [1] }), { schema: 5, tracks: [1] });
  const raw2 = { id: 'r2', src: 've.out', dst: 'i1:a.level', amt: 3, bi: true, curve: -9, aux: 'lfo2', inv: 1, byp: 0.7, out: 2, acurve: 0.5, crv: [[0.5, 2, 9], 'x', [0, 0]], rise: 0.3, fall: 0.9, slink: 1, extra: 1 };
  const d = S.normDev({ dev: { i1: { kind: 'synth', model: 'serum' }, ve: { kind: 'velo' }, out: { kind: 'out' } }, wires: [], mid: 7, mods: [
    { id: 'r1', src: 'wheel', dst: 'i1:f.cutoff', amt: 0.5 }, raw2,
    { id: 'r1', src: 'wheel', dst: 'i1:f.res' },                   // a second r1
    { id: 'x3', src: 'wheel', dst: 'i1:f.res' },                   // not an 'r<n>' id
    { id: 'r4', src: 'WHEEL', dst: 'i1:f.res' },                   // not a source
    { id: 'r5', src: 'wheel', dst: 'f.res' },                      // no device
    { id: 'r6', src: 'wheel', dst: 'i1:f.res', aux: 'Bad aux!' },
    { id: 'r7', src: 'i2/lfo3.out', dst: 'i1:f.res' },             // (a later stage's source: the shape is kept)
    'junk', null] });
  assert.deepEqual(d.mods.map(r => r.id), ['r1', 'r2', 'r7']);
  assert.deepEqual(d.mods[0], mrow({}));
  const n = C.normRow(Object.assign({}, raw2, { src: 'velo', dst: 'a.level' }));
  assert.deepEqual(d.mods[1], Object.assign({ id: 'r2', src: 've.out', dst: 'i1:a.level' }, n, { src: 've.out', dst: 'i1:a.level' }), 'normRow\'s field rules');
  assert.deepEqual(Object.keys(d.mods[1]), ['id', 'src', 'dst', 'amt', 'bi', 'curve', 'aux', 'inv', 'byp', 'out', 'acurve', 'crv', 'rise', 'fall', 'slink']);
  assert.deepEqual(d.mods[1].crv, [[0, 0, 0], [1, 1, 1]]);
  assert.equal(d.mid, 8, 'past every row id');
  assert.deepEqual(d.dev.ve, { kind: 'velo' });
  const none = S.normDev({ dev: { i1: { kind: 'synth', model: 'juno60' } }, wires: [], mods: [] });
  assert.deepEqual(['mods' in none, 'mid' in none], [false, false], 'no rows: no keys (an old track reads byte-identically)');
  assert.equal(S.normDev({ dev: { i1: { kind: 'synth', model: 'juno60' } }, mid: 4 }).mid, 4, 'a counter without rows is kept (ids never reused)');
  const many = S.normDev({ dev: { i1: { kind: 'synth', model: 'serum' } }, mods: Array.from({ length: 300 }, (_, k) => ({ id: 'r' + (k + 1), src: 'wheel', dst: 'i1:f.cutoff' })) });
  assert.deepEqual([many.mods.length, many.mid], [256, 257]);
  // perf: kept through serialize / deserialize; anything else is null; absent → no key
  const t = sxTrack();
  MO.addModDev(t, 'velo');
  const p = { name: 'P', perf: { wheel: { v: 1 }, junk: 1 }, tracks: [t] };
  MO.addMod(t, 've.out', 'i1:a.level', { amt: 0.4 });
  const back = S.deserialize(S.serialize(p));
  assert.deepEqual(back.perf, { wheel: { v: 1 } });
  assert.deepEqual([back.tracks[0].mods, back.tracks[0].mid, back.tracks[0].dev.ve], [t.mods, t.mid, { kind: 'velo' }]);
  assert.deepEqual(S.deserialize({ tracks: [], perf: { wheel: 'x' } }).perf, { wheel: null });
  assert.equal('perf' in S.deserialize({ tracks: [] }), false);
  assert.equal('perf' in S.deserialize({ tracks: [], perf: 5 }), false);
  assert.deepEqual([S.normPerf(null), S.normPerf({ wheel: {} })], [{ wheel: null }, { wheel: { v: 1 } }]);
  // History snapshots carry both
  const H = new S.History(), q = { perf: { wheel: { v: 1 } }, tracks: [jclone(t)] };
  H.record(q);
  q.perf = { wheel: null }; q.tracks[0].mods = [];
  const u = H.undo(q);
  assert.deepEqual([u.perf, u.tracks[0].mods], [{ wheel: { v: 1 } }, t.mods]);
});

test('2a cv-model: the modulator singletons and the project Mod Wheel (place, list its cables everywhere, remove)', () => {
  const t = sxTrack('trk_1'), t2 = sxTrack('trk_2'), p = { tracks: [t, t2] };
  assert.deepEqual([MO.addModDev(t, 'velo'), MO.addModDev(t, 'velo'), MO.addModDev(t, 'at'), MO.addModDev(t, 'bend'), MO.addModDev(t, 'x'), MO.addModDev(null, 'at')], ['ve', null, 'at', 'bd', null, null]);
  assert.deepEqual([t.dev.ve, t.dev.at, t.dev.bd], [{ kind: 'velo' }, { kind: 'at' }, { kind: 'bend' }]);
  assert.equal(G.compileTrack(t).canonical, true);
  assert.deepEqual(MO.sourcesOf(t, p).map(x => x.id), ['ve.out', 'at.out', 'bd.out']);
  assert.equal(MO.hasWheel(p), false);
  assert.equal(MO.addMod(t, 'wheel', 'i1:f.cutoff', { project: p }).code, 'src', 'no wheel placed');
  assert.deepEqual(MO.placeWheel(p), { ok: true, byTrack: [] });
  assert.deepEqual([MO.placeWheel(p).ok, p.perf, MO.hasWheel(p)], [false, { wheel: { v: 1 } }, true]);
  assert.ok(MO.addMod(t, 'wheel', 'i1:f.cutoff', { project: p }).ok);
  assert.ok(MO.addMod(t, 've.out', 'i1:a.level').ok);
  assert.ok(MO.addMod(t2, 'wheel', 'i1:f.res', { project: p }).ok);
  assert.deepEqual(MO.wheelTracks(p), [t, t2]);
  t.lay = { ve: { x: 0, y: 0 }, wheel: { x: 5, y: 5 }, i1: { x: 300, y: 0 } };
  assert.deepEqual(MO.removeModDev(t, 've'), { ok: true, why: '', rows: ['r2'] });
  assert.deepEqual([t.mods.map(r => r.id), 've' in t.dev, Object.keys(t.lay)], [['r1'], false, ['wheel', 'i1']]);
  assert.equal(MO.removeModDev(t, 'i1').ok, false, 'not a modulator');
  assert.deepEqual(MO.wheelRows(p).byTrack, [{ trackId: 'trk_1', rows: ['r1'] }, { trackId: 'trk_2', rows: ['r1'] }]);
  const r = MO.removeWheel(p);
  assert.deepEqual(r, { ok: true, byTrack: [{ trackId: 'trk_1', rows: ['r1'] }, { trackId: 'trk_2', rows: ['r1'] }] });
  assert.deepEqual([p.perf, t.mods, t2.mods, Object.keys(t.lay)], [{ wheel: null }, [], [], ['i1']]);
  assert.deepEqual(MO.wheelTracks(p), []);
});

test('2a cv-model addMod: serum-core addMod\'s drop rules, overrides through normRow, ids from track.mid; every refusal leaves the track as it was', () => {
  const t = sxTrack(), d = t.dev.i1, s = d.vals.s, fx = d.fx, rev = C.newInstance(fx, 'rev', { rack: 0 }), cv = C.newInstance(fx, 'conv', { rack: 0 });
  MO.addModDev(t, 'velo');
  s.p['f.cutoff'] = 0.8; // (unipolar limit: max(0.05, min(0.5, 1 − base)))
  for (const [src, n, dst] of [['wheel', 'wheel', 'f.cutoff'], ['ve.out', 'velo', 'a.pan'], ['wheel', 'wheel', 'a.on'], ['ve.out', 'velo', `fx.${rev}.mix`]]) {
    const r = MO.addMod(t, src, 'i1:' + dst), o = jclone(s), k = C.addMod(o, fx, n, dst, {});
    assert.equal(r.ok, true, dst);
    assert.deepEqual(G.nativeRow(r.row), o.matrix[k], dst + ': the Serum\'s own drop defaults');
  }
  assert.deepEqual(t.mods.map(r => [r.id, r.amt, r.bi]), [['r1', 1 - 0.8, 0], ['r2', 0.5, 1], ['r3', -1, 0], ['r4', 0.5, 0]], 'a.on is on: a bool destination drops at −1');
  assert.equal(t.mid, 5);
  const o = MO.addMod(t, 'wheel', 'i1:f.res', { amt: -0.25, bi: 1, curve: 0.5, crv: [[0, 0], [1, 1]], rise: 0.2, fall: 0.9, slink: 1, aux: 'lfo1', limit: false });
  assert.deepEqual(o.row, { id: 'r5', src: 'wheel', dst: 'i1:f.res', amt: -0.25, bi: 1, curve: 0.5, aux: 'lfo1', inv: 0, byp: 0, out: 1, acurve: 0, crv: [[0, 0, 0], [1, 1, 0]], rise: 0.2, fall: 0.2, slink: 1 });
  assert.deepEqual(MO.removeMod(t, 'r5'), { ok: true, why: '' });
  assert.equal(MO.addMod(t, 'wheel', 'i1:f.res').row.id, 'r6', 'a removed id is never reused');
  // setMod: fields through normRow's rules, never the ends
  assert.equal(MO.setMod(t, 'r1', { amt: 2, bi: 1, src: 'x', dst: 'y', id: 'z', rise: 0.5, slink: 1 }).ok, true);
  assert.deepEqual([t.mods[0].id, t.mods[0].src, t.mods[0].dst, t.mods[0].amt, t.mods[0].bi, t.mods[0].fall], ['r1', 'wheel', 'i1:f.cutoff', 1, 1, 0.5]);
  const before = jclone(t.mods);
  assert.deepEqual(MO.setMod(t, 'r1', { aux: 'nope' }), { ok: false, why: 'Unknown aux source' });
  assert.equal(MO.setMod(t, 'r99', { amt: 0 }).ok, false);
  assert.equal(MO.removeMod(t, 'r99').ok, false);
  // refusals
  const J = jclone(t), j = juno();
  const nomodId = C.FXP_TAB.conv && (C.FXP_TAB.conv['2'] || C.FXP_TAB.conv['1']).find(r => r.nomod);
  const cases = [
    [t, 'lfo1', 'i1:f.cutoff', {}, 'src'], [t, 'at.out', 'i1:f.cutoff', {}, 'src'], [t, 'wheel', 'i1:f.cutoff', { project: { tracks: [t] } }, 'src'],
    [t, 'wheel', 'i9:f.cutoff', {}, 'end'], [t, 'wheel', 'nope', {}, 'end'],
    [t, 'wheel', 'i1:nope', {}, 'nomod'], [t, 'wheel', `i1:fx.${cv}.${nomodId.pid}`, {}, 'nomod'],
    [t, 'wheel', 'i1:f.cutoff', { aux: 'nope' }, 'aux'],
    [j, 'wheel', 'i1:pwm', {}, 'stage'], [j, 'wheel', 'fx1:fx.x.mix', {}, 'nomod'], [j, 'wheel', 'i1:nope', {}, 'nomod'], // (2b: a chunk knob is stage 5; a knob that is not there)
  ];
  for (const [tr, src, dst, opt, code] of cases) {
    const was = JSON.stringify(tr), r = MO.addMod(tr, src, dst, opt);
    assert.deepEqual([r.ok, r.code, r.row], [false, code, null], src + ' → ' + dst);
    assert.equal(JSON.stringify(tr), was, 'untouched');
  }
  assert.equal(MO.addMod(j, 'wheel', 'i1:pwm').why, 'This knob takes modulation from stage 5');
  assert.deepEqual(t.mods, before);
  assert.deepEqual(jclone(t), J);
  // the 64-row budget: the Serum's own rows count
  for (let k = 0; k < 64 - t.mods.length; k++) s.matrix[k] = C.normRow({ src: 'lfo2', amt: 0.1, dst: 'a.wt' });
  assert.deepEqual([G.modBudget(t, 'i1').preset, G.modBudget(t, 'i1').canvas, G.modBudget(t, 'i1').left], [64 - t.mods.length, t.mods.length, []]);
  const f = MO.addMod(t, 'wheel', 'i1:f.cutoff', { name: 'Serum 1' });
  assert.deepEqual([f.ok, f.code, f.why], [false, 'full', 'Serum 1’s mod rows are full (64/64)']);
  assert.equal(MO.addMod(t, 'wheel', 'i1:f.cutoff').why, 'Serum’s mod rows are full (64/64)');
});

test('2a cv-model: preset rows, Save with preset (toPreset) and Keep on canvas (fromPreset) — the compiled patch unchanged both ways', () => {
  const t = sxTrack(), d = t.dev.i1, s = d.vals.s, p = { perf: { wheel: { v: 1 } }, tracks: [t] };
  MO.addModDev(t, 'velo');
  s.matrix[0] = C.normRow({ src: 'lfo1', amt: 0.2, dst: 'a.wt' });
  s.matrix[1] = C.normRow({ src: 'wheel', amt: 0.3, dst: 'f.res' });
  s.matrix[3] = C.normRow({ src: 'velo', amt: 0.4, dst: 'a.level' });
  assert.deepEqual(MO.presetRows(d).map(r => [r.slot, r.from, r.src, r.dst, r.amt]), [[1, 'wheel', 'wheel', 'f.res', 0.3], [3, 've.out', 'velo', 'a.level', 0.4]]);
  assert.deepEqual([MO.presetRows(null), MO.presetRows({ kind: 'synth', model: 'juno60', vals: {} })], [[], []]);
  MO.addMod(t, 'wheel', 'i1:f.cutoff', { amt: 0.3, curve: 0.2 });
  MO.addMod(t, 've.out', 'i1:a.pan', { amt: -0.5, rise: 0.1, fall: 0.3 });
  const pat = () => G.instPatch(d, OPT2, G.modRowsFor(t, 'i1')), P0 = pat();
  assert.deepEqual(G.injectMods(d, t.mods).placed, [{ id: 'r1', slot: 2, src: 'wheel' }, { id: 'r2', slot: 4, src: 'velo' }]);
  // canvas → preset: r2 goes into the slot it compiles to (the caller applies the matrix through sxEdit)
  const r2 = jclone(t.mods[1]), a = MO.toPreset(t, 'r2', s);
  assert.deepEqual([a.ok, a.slot, t.mods.map(r => r.id)], [true, 4, ['r1']]);
  assert.deepEqual(a.row, G.nativeRow(r2));
  assert.equal(s.matrix[4].src, '', 'the live state untouched until the caller applies it');
  s.matrix = a.matrix;
  assert.deepEqual(pat(), P0, 'Save with preset: the same compile');
  // preset → canvas: the row back on the canvas (a new id), compiled where it was
  const b = MO.fromPreset(t, 'i1', 4, { project: p });
  assert.deepEqual([b.ok, b.slot, b.row.id, t.mods.map(r => r.id)], [true, 4, 'r3', ['r1', 'r3']]);
  assert.deepEqual(Object.assign({}, b.row, { id: 'r2' }), r2, 'the same row');
  s.matrix = b.matrix;
  assert.deepEqual(pat(), P0, 'Keep on canvas: the same compile');
  // a preset row in front of the canvas rows: it goes before them in track.mods (it takes its slot again)
  const c = MO.fromPreset(t, d, 1, { project: p });
  assert.deepEqual([c.ok, t.mods.map(r => r.id)], [true, ['r4', 'r1', 'r3']]);
  s.matrix = c.matrix;
  assert.deepEqual(pat(), P0);
  const e = MO.toPreset(t, 'r4', s);
  assert.deepEqual([e.ok, e.slot], [true, 1]);
  s.matrix = e.matrix;
  assert.deepEqual(pat(), P0, 'and back into the preset');
  // refusals
  assert.equal(MO.fromPreset(t, 'i1', 0, { project: p }).ok, false, 'an LFO row is the Serum\'s own');
  assert.equal(MO.fromPreset(t, 'i1', 2, { project: p }).ok, false, 'an empty slot');
  assert.deepEqual(MO.fromPreset(t, 'i1', 1, { project: { tracks: [t] } }), { ok: false, why: 'Add the Mod Wheel module first' });
  assert.equal(MO.toPreset(t, 'r99', s).ok, false);
  for (let k = 0; k < 64; k++) if (!s.matrix[k].src) s.matrix[k] = C.normRow({ src: 'lfo2', amt: 0.1, dst: 'a.wt' });
  assert.deepEqual(MO.toPreset(t, 'r1', s), { ok: false, why: 'Serum’s mod rows are full (64/64)' }, 'not compiled: no slot to take');
});

test('2a cv-model: removeInst and setModel (Serum → classic; the primary too) drop the rows to that instrument and say so', () => {
  const t = sxTrack(), i2 = MO.addInst(t, 'serum', { vals: { s: C.normalizeSerum(C.defaultSerum()) } });
  MO.addModDev(t, 'velo');
  MO.addMod(t, 'wheel', 'i1:f.cutoff'); MO.addMod(t, 've.out', i2 + ':a.level'); MO.addMod(t, 'wheel', i2 + ':f.res');
  const r = MO.setModel(t, i2, 'minimoog', { vals: {} });
  assert.deepEqual([r.ok, r.rows, r.notice], [true, ['r2', 'r3'], '2 modulation cables to the Serum removed: the new model has no such knobs']);
  assert.deepEqual(t.mods.map(x => x.id), ['r1']);
  assert.deepEqual(MO.setModel(t, i2, 'serum', { vals: { s: C.normalizeSerum(C.defaultSerum()) } }).rows, [], 'classic → Serum: nothing to drop');
  MO.addMod(t, 'wheel', i2 + ':f.res');
  assert.deepEqual(MO.removeInst(t, i2), { rows: ['r4'], ok: true, why: '' });
  assert.deepEqual(t.mods.map(x => x.id), ['r1']);
  MO.setModel(t, 'i1', 'juno60', { vals: {} }); // (the primary: setTrackModel's setModel, R5)
  assert.deepEqual([t.mods, t.dev.ve], [[], { kind: 'velo' }], 'the rows go, the modulator stays');
});

test('2a splitTracks: rows follow the instrument they end on (a new track\'s as i1, with the modulators they start at); rows to nothing that survives are dropped and named', () => {
  const a = v2({ id: 'trk_1', model: 'serum', vals: { s: C.normalizeSerum(C.defaultSerum()) } });
  a.dev.ve = { kind: 'velo' }; a.mods = [mrow({ src: 've.out', dst: 'i1:a.level' })]; a.mid = 2;
  const p1 = { schema: M.SCHEMA, tracks: [a] };
  assert.equal(split(p1).p, p1, 'a canonical Serum with a modulator and a row: as it is');
  const t = v2({ id: 'trk_3', name: 'Duo', model: 'serum', vals: { s: C.normalizeSerum(C.defaultSerum()) } });
  t.dev.i2 = { kind: 'synth', model: 'serum', vals: { s: C.normalizeSerum(C.defaultSerum()) }, preset: null, fx: C.defaultFx2() };
  t.wires.push({ id: 'w2', a: 'i2.out', b: 'out.in' });
  t.dev.ve = { kind: 'velo' }; t.dev.at = { kind: 'at' }; t.dev.fx5 = { kind: 'panel', fx: C.defaultFx2() }; t.nid = 6;
  t.mods = [mrow({ id: 'r1' }), mrow({ id: 'r2', src: 've.out', dst: 'i2:a.level' }), mrow({ id: 'r3', src: 'at.out', dst: 'i2:f.res' }),
    mrow({ id: 'r4', dst: 'fx5:fx.x.mix' }), mrow({ id: 'r5', src: 'bd.out', dst: 'i1:f.res' })];
  t.mid = 6;
  t.lay = { i1: { x: 0, y: 0 }, ve: { x: -300, y: 0 }, wheel: { x: -300, y: 300 }, i2: { x: 0, y: 900 } };
  const r = split({ schema: M.SCHEMA, tracks: [t] }), [A, B] = r.p.tracks;
  assert.deepEqual([A.mods.map(x => x.id), A.mid, Object.keys(A.dev).sort(), Object.keys(A.lay).sort()], [['r1'], 6, ['at', 'i1', 'out', 've'], ['i1', 've', 'wheel']]);
  assert.deepEqual([B.mods.map(x => [x.id, x.src, x.dst]), B.mid, Object.keys(B.dev).sort()], [[['r2', 've.out', 'i1:a.level'], ['r3', 'at.out', 'i1:f.res']], 6, ['at', 'i1', 'out', 've']]);
  assert.deepEqual(B.mods[0], mrow({ id: 'r2', src: 've.out', dst: 'i1:a.level' }));
  assert.match(r.notices[0], /2 modulation cables to nothing that survives were dropped/);
  assert.deepEqual(r.p.tracks.map(x => G.compileTrack(x).canonical), [true, true]);
  assert.deepEqual([G.modBudget(A, 'i1').canvas, G.modBudget(B, 'i1').canvas], [1, 2]);
  assert.equal(split(r.p).p, r.p, 'stable');
  const back = S.deserialize(JSON.stringify(r.p));
  assert.deepEqual(back.tracks.map(x => x.mods.map(y => y.id)), [['r1'], ['r2', 'r3']], 'song.js reads them');
  assert.equal('mid' in M.toV1(r.p).p.tracks[0], false, 'toV1: no v2 field');
});

// host fixes (2a review H3)
test('2a review H3: Save as classic project names the modulation cables, modulators and the Mod Wheel of canonical one-instrument tracks', async () => {
  const F = await import('./fixtures/mods-2a.mjs');
  const T = F.tracks();
  assert.deepEqual(T.map(t => G.compileTrack(t).canonical), [true, true, true], '(each one canonical Serum)');
  const r = M.toV1({ schema: 5, perf: { wheel: { v: 1 } }, tracks: T });
  assert.deepEqual(r.lost, ['the Mod Wheel', '“Mods 1”: 2 modulation cables', '“Mods 1”: its Velocity module', '“Mods 2”: 1 modulation cable',
    '“Mods 2”: its Aftertouch module', '“Mods 3”: 1 modulation cable']);
  assert.deepEqual([r.p.tracks.length, 'perf' in r.p, r.p.tracks.some(t => 'mods' in t || 'mid' in t || 'dev' in t)], [3, false, false]);
  assert.deepEqual(M.toV1({ schema: 5, perf: { wheel: null }, tracks: [Object.assign(F.tracks()[2], { mods: [] })] }).lost, [], 'nothing of 2a: nothing named');
});

/* ------------------------------------------------------------------ stage 2b: schema 6, every module's state, any port (IMPL-2b §1.4) */
test('2b schema 6: additive (a 5 opens as before); song.normDev bounds every module kind\'s state through serum-core\'s normalisers; round trips', () => {
  const p5 = Object.assign(M.toV2(mainProject()), { schema: 5, uid: 'p_abc123xyz0' }), up = M.upgrade(deepFreeze(jclone(p5)));
  assert.deepEqual([up.from, up.readOnly, up.p.schema], [5, false, M.SCHEMA]);
  assert.deepEqual(Object.assign({}, up.p, { schema: 5 }), p5, 'nothing converted (no stored modulator places: STEPS[6] moves none)');
  assert.deepEqual(M.STEPS[5]({ schema: 5, tracks: [1] }), { schema: 6, tracks: [1] });
  assert.equal(M.STEPS.length, M.SCHEMA);
  const raw = { dev: { i1: { kind: 'synth', model: 'serum' }, out: { kind: 'out' },
    l1: { kind: 'lfo', lfo: { mono: 1, mode: 'env', pts: [[0, 0, 0], [1, 1, 0]], junk: 1 }, rate: 2, rise: -1, name: 'Wobble', junk: 2 },
    e1: { kind: 'env', env: { legInv: true, junk: 1 }, att: 0.3, sus: 7, crv: [0.2, 'x'] },
    h1: { kind: 'chaos', chaos: { mono: 0, sh: 1 }, rate: 0.4, bpm: 1, smooth: 0.5 },
    m1: { kind: 'macro', v: [0.5, 2, -1, 'x'], names: ['A very long macro name indeed', 7, 'B'] },
    c1: { kind: 'cc', cc: 300, ch: 17, v: 0.5 }, c2: { kind: 'cc' }, nt: { kind: 'note', junk: 1 }, ve: { kind: 'velo' }, zz: { kind: 'later', any: [1, 2] } }, wires: [],
    mods: [{ id: 'r1', src: 'm1.k3', dst: 'i1:f.cutoff' }, { id: 'r2', src: 'i1/lfo3.out', dst: 'i1:a.wt' }, { id: 'r3', src: 'l1.out', dst: 'i2:cf' }, { id: 'r4', src: 'm1.k9', dst: 'i1:f.res' }] };
  const d = S.normDev(raw);
  assert.deepEqual(d.dev.l1, { kind: 'lfo', lfo: C.normLfo({ mode: 'env', mono: 1, pts: [[0, 0, 0], [1, 1, 0]] }), rate: 1, rise: 0, delay: 0, smooth: 0, phase: 0, name: 'Wobble' });
  assert.deepEqual(Object.assign({ kind: 'lfo' }, C.normLfoMod(raw.dev.l1), { name: 'Wobble' }), d.dev.l1);
  assert.deepEqual(d.dev.e1, { kind: 'env', env: { bpm: 0, legInv: 1, stealRe: 0 }, att: 0.3, hold: 0, dec: 0.5, sus: 1, rel: 0.215, start: 0, end: 0, crv: [0.2, 0.666, 0.666] });
  assert.deepEqual(d.dev.h1, { kind: 'chaos', chaos: { mono: 0, sh: 1 }, rate: 0.4, bpm: 1, smooth: 0.5 });
  assert.deepEqual(d.dev.m1, { kind: 'macro', v: [0.5, 1, 0, 0, 0, 0, 0, 0], names: ['A very long macr', 'Macro 2', 'B', 'Macro 4', 'Macro 5', 'Macro 6', 'Macro 7', 'Macro 8'] }, '(U8: unnamed knobs take the default)');
  assert.deepEqual([d.dev.c1, d.dev.c2, d.dev.nt, d.dev.ve, d.dev.zz], [{ kind: 'cc', cc: 127, ch: 16, v: 0.5 }, { kind: 'cc', cc: 1, ch: 0, v: 0 }, { kind: 'note' }, { kind: 'velo' }, { kind: 'later', any: [1, 2] }]);
  assert.deepEqual(d.mods.map(r => r.src), ['m1.k3', 'i1/lfo3.out', 'l1.out', 'm1.k9'], 'any port: the shape is kept (the page checks what exists)');
  assert.deepEqual(S.normModDev({ kind: 'lfo' }), Object.assign({ kind: 'lfo' }, C.normLfoMod({})));
  assert.deepEqual([S.normModDev(null), S.normModDev({ kind: 'env' }).sus, S.normModDev({ kind: 'chaos' }).chaos.mono, C.normChaosMod({}).rate], [null, 1, 1, 0.2512]);
  // the full round trip: a track with every kind, serialised, History
  const t = sxTrack(), p = { name: 'P', tracks: [t], perf: { wheel: { v: 1 } } };
  for (const k of ['lfo', 'env', 'macro', 'cc', 'chaos', 'note', 'velo']) MO.addModDev(t, k);
  MO.setModState(t, 'l1', { lfo: { mono: 0 }, rate: 0.7 });
  MO.setModState(t, 'm1', { v: [0.3], names: ['Cut'] });
  MO.addMod(t, 'm1.k1', 'i1:f.cutoff'); MO.addMod(t, 'l1.out', 'i1:a.wt'); MO.addMod(t, 'i1/lfo2.out', 'i1:a.pan');
  const back = S.deserialize(S.serialize(p)), u = back.tracks[0];
  assert.deepEqual([u.dev, u.mods, u.mid], [jclone(t.dev), jclone(t.mods), t.mid]);
  assert.deepEqual(u.dev.l1.lfo.mono, 0);
  const H = new S.History(), q = { perf: { wheel: { v: 1 } }, tracks: [jclone(t)] };
  H.record(q);
  q.tracks[0].dev.l1.rate = 0.1; q.tracks[0].mods = [];
  assert.deepEqual(H.undo(q).tracks[0], jclone(t));
});

test('2b splitTracks: rows from any port (a macro knob), the instrument\'s own LFO (renamed with it); another instrument\'s LFO does not survive; toV1 names every module', () => {
  const t = v2({ id: 'trk_3', name: 'Duo', model: 'serum', vals: { s: C.normalizeSerum(C.defaultSerum()) } });
  t.dev.i2 = { kind: 'synth', model: 'serum', vals: { s: C.normalizeSerum(C.defaultSerum()) }, preset: null, fx: C.defaultFx2() };
  t.wires.push({ id: 'w2', a: 'i2.out', b: 'out.in' });
  t.dev.m1 = S.normModDev({ kind: 'macro' }); t.dev.l1 = S.normModDev({ kind: 'lfo' }); t.dev.h2 = S.normModDev({ kind: 'chaos' }); t.nid = 3;
  t.mods = [mrow({ id: 'r1', src: 'm1.k3' }), mrow({ id: 'r2', src: 'm1.k4', dst: 'i2:a.level' }), mrow({ id: 'r3', src: 'i2/lfo3.out', dst: 'i2:f.res' }), mrow({ id: 'r4', src: 'i1/env2.out', dst: 'i2:a.wt' }),
    mrow({ id: 'r5', src: 'l1.out', dst: 'i2:a.pan' }), mrow({ id: 'r6', src: 'i1/lfo1.out', dst: 'i1:a.pan' })];
  t.mid = 7;
  const r = split({ schema: M.SCHEMA, tracks: [t] }), [A, B] = r.p.tracks;
  assert.deepEqual([A.mods.map(x => x.id + ':' + x.src), Object.keys(A.dev).sort()], [['r1:m1.k3', 'r6:i1/lfo1.out'], ['h2', 'i1', 'l1', 'm1', 'out']]);
  assert.deepEqual([B.mods.map(x => x.id + ':' + x.src + '>' + x.dst), Object.keys(B.dev).sort()], [['r2:m1.k4>i1:a.level', 'r3:i1/lfo3.out>i1:f.res', 'r5:l1.out>i1:a.pan'], ['i1', 'l1', 'm1', 'out']], 'its own LFO renamed with it; the modules it reads copied');
  assert.match(r.notices[0], /1 modulation cable to nothing that survives was dropped/);
  assert.deepEqual(r.p.tracks.map(x => G.compileTrack(x).canonical), [true, true]);
  assert.deepEqual(S.deserialize(JSON.stringify(r.p)).tracks.map(x => x.mods.map(y => y.id)), [['r1', 'r6'], ['r2', 'r3', 'r5']]);
  const v = M.toV1({ schema: M.SCHEMA, perf: { wheel: null }, tracks: [A] });
  assert.deepEqual(v.lost, ['“Duo”: 2 modulation cables', '“Duo”: its LFO 1, Macro 1, Chaos 2 modules']);
});

/* ------------------------------------------------------------ milestone 3 (IMPL-3 §3): schema 7 */
import * as MB from './fixtures/mods-2b.mjs?v=9';
import * as CVM from '../cv-module.js?v=9';
import * as CP from '../cv-panel.js?v=9';
import { MODELS } from '../models.js?v=9';
const W3 = k => ({ lfo: 416, env: 320, macro: 256, chaos: 256 })[k]; // (IMPL-3 §2.2's module widths, until cv-module's MOD_W holds them)
// a module's rect as the canvas lays it (Tidy for an entry not stored): an instrument its hardware / Simple / Serum size
function rects(t, widthOf, wheel) {
  const devs = CVM.devicesOf(t);
  if (wheel) devs.push({ key: 'wheel', kind: 'mod', mod: 'wheel' });
  const td = CVM.tidy(t, {}, devs), out = {};
  for (const d of devs) {
    const e = (t.lay && t.lay[d.key]) || td[d.key], k = d.mod || CVM.modKind(d.key);
    let w, h;
    if (d.kind === 'inst') { const m = MODELS.find(x => x.id === d.model), L = m.custom || (e && e.ui === 'flow') ? null : CP.usable(m.id, m), z = L ? CP.sizeOf(L, m) : CVM.sizeFor(d.model); w = z.w; h = z.h; }
    else if (d.kind === 'mod') { w = ['lfo', 'env', 'macro', 'chaos'].includes(k) ? widthOf(k) : M.MOD_W0; h = CVM.MOD_H[k]; }
    else { w = d.kind === 'out' ? CVM.W_OUT : CVM.W_FX; h = d.kind === 'out' ? 260 : 420; }
    out[d.key] = { x: e.x, y: e.y, w, h: e.fold ? CVM.BAR_H : h, kind: d.kind };
  }
  return out;
}
const over = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
test('3 schema 7: STEPS[6] moves stored modulator places only — the content and every other entry unchanged; a 6 opens as 7, a 7 as itself', () => {
  const t = MB.tracks()[1], p6 = { name: 'M3', schema: 6, uid: 'p_abc123xyz0', perf: { wheel: { v: 1 } }, tracks: [t] };
  t.lay = { i1: { x: 0, y: 0 }, l1: { x: -320, y: 0, fold: 1 }, l2: { x: -320, y: 320 }, e1: { x: -320, y: 640 }, m1: { x: -320, y: 960, z: 3 }, c1: { x: -320, y: 1344 },
    nt: { x: -320, y: 1600 }, h1: { x: 200, y: 100 }, wheel: { x: -320, y: -320 } };
  const frozen = deepFreeze(jclone(p6)), up = M.upgrade(frozen);
  assert.deepEqual([up.from, up.readOnly, up.p.schema], [6, false, 7]);
  const L = up.p.tracks[0].lay;
  // (cv-module's widths today: every kind W_MOD — no growth; the chaos module laid over the Serum moves left past it)
  assert.deepEqual(Object.assign({}, L, { h1: null }), Object.assign({}, t.lay, { h1: null }), 'every other entry as it was (folds, z kept)');
  // (off the Serum: past its left edge − MOD_GAP (−320, on the dots), where it meets LFO 2 (y 320…): past that one too)
  assert.deepEqual(L.h1, { x: Math.floor((Math.floor((0 - CVM.MOD_GAP - CVM.W_MOD) / 32) * 32 - CVM.MOD_GAP - CVM.W_MOD) / 32) * 32, y: 100 }, 'off the Serum, then off LFO 2');
  assert.deepEqual(Object.assign({}, up.p.tracks[0], { lay: null }), Object.assign(jclone(t), { lay: null }), 'content unchanged');
  assert.deepEqual(frozen, jclone(p6), 'the input untouched');
  assert.equal(M.upgrade(up.p).p.tracks[0].lay.h1.x, L.h1.x, 'at 7: nothing moves again');
  const p7 = deepFreeze({ name: 'x', schema: 7, uid: 'p_abc123xyz0', tracks: [] });
  assert.deepEqual([M.upgrade(p7).readOnly, M.upgrade(p7).from], [false, 7]);
});

test('3 growMods (IMPL-3 §2.2): with Serum\'s widths each LFO / ENV / Macro / Chaos keeps its right edge and grows left; overlaps move on left; other kinds and Tidy-placed ones stay', () => {
  const t = MB.tracks()[1];
  t.lay = { l1: { x: -320, y: 0 }, l2: { x: -320, y: 320 }, e1: { x: -320, y: 640 }, m1: { x: -320, y: 960 }, h1: { x: -640, y: 0 }, c1: { x: -320, y: 1344 }, nt: { x: 1600, y: 1600 } };
  const g = M.growMods({ tracks: [t] }, W3).tracks[0], L = g.lay;
  assert.deepEqual([L.l2.x, L.e1.x, L.m1.x], [-80 - 416, -80 - 320, -80 - 256], 'right edges kept at −MOD_GAP');
  assert.deepEqual([L.c1, L.nt], [t.lay.c1, t.lay.nt], 'a CC / Note module: as it was');
  // h1 (−640…−384) overlaps l1 grown (−496…−80) at y 0: past l1's left edge − 80
  assert.equal(L.l1.x, -496);
  assert.equal(L.h1.x, Math.floor((-496 - 80 - 256) / 32) * 32);
  const R = rects(g, W3, false), mods = Object.keys(R).filter(k => R[k].kind === 'mod');
  for (const a of mods) for (const b of Object.keys(R)) if (a !== b && (R[b].kind !== 'mod' || ['l1', 'l2', 'e1', 'm1', 'h1'].includes(a))) assert.equal(over(R[a], R[b]), false, a + ' × ' + b);
  assert.equal(M.growMods({ tracks: [MB.tracks()[0]] }, W3).tracks[0].lay, undefined, 'no stored places: nothing to move');
});

test('3 gate: after STEPS[6] no modulator rect intersects an instrument in the fixtures — every stored place over the instruments, hardware and Simple, a folded one, the wheel', () => {
  for (const [i, t] of MB.tracks().entries()) {
    const keys = CVM.devicesOf(t).filter(d => d.kind === 'mod').map(d => d.key);
    t.lay = { i2: { x: 0, y: 900, ui: i % 2 ? 'flow' : undefined } };
    keys.forEach((k, j) => { t.lay[k] = { x: 64 * j, y: 48 * j }; if (j === 1) t.lay[k].fold = 1; });
    t.lay.wheel = { x: 300, y: 950 };
    const g = M.growMods({ perf: { wheel: { v: 1 } }, tracks: [jclone(t)] }, W3).tracks[0], R = rects(g, W3, true);
    for (const k of keys.filter(k => ['lfo', 'env', 'macro', 'chaos'].includes(CVM.modKind(k)))) {
      for (const o of Object.keys(R)) if (R[o].kind === 'inst') assert.equal(over(R[k], R[o]), false, t.id + ': ' + k + ' × ' + o);
    }
  }
});

test('3 song.normLay keeps Serum part keys (iN/oscA, iN/filter2), ui \'parts\' and up to 256 entries; cv-model dropLay removes id and id/*; partOf', () => {
  const lay = { i1: { x: 0, y: 0, ui: 'parts' }, 'i1/oscA': { x: 10, y: 20 }, 'i1/filter2': { x: 30, y: 40, fold: 1 }, 'i1/fx': { x: 1, y: 2 }, fx1: { x: 5, y: 5, ui: 'flow' },
    'i1/Osc': { x: 0, y: 0 }, 'I1/oscA': { x: 0, y: 0 }, 'i1/oscA/x': { x: 0, y: 0 }, i2: { x: 0, y: 0, ui: 'other' } };
  const n = S.normLay(lay);
  assert.deepEqual(Object.keys(n), ['i1', 'i1/oscA', 'i1/filter2', 'i1/fx', 'fx1', 'i2']);
  assert.deepEqual([n.i1.ui, n.fx1.ui, n.i2.ui, n['i1/filter2'].fold], ['parts', 'flow', undefined, 1]);
  const big = {};
  for (let k = 0; k < 300; k++) big['m' + k] = { x: k, y: 0 };
  assert.equal(Object.keys(S.normLay(big)).length, 256, 'the cap: 256 entries (a Serum in parts is up to 25 modules)');
  const t = { lay: { i1: { x: 0, y: 0 }, 'i1/oscA': { x: 1, y: 1 }, 'i1/fx': { x: 2, y: 2 }, i10: { x: 3, y: 3 }, 'i10/oscA': { x: 4, y: 4 }, fx1: { x: 5, y: 5 } } };
  MO.dropLay(t, 'i1');
  assert.deepEqual(Object.keys(t.lay), ['i10', 'i10/oscA', 'fx1']);
  assert.deepEqual([MO.partOf('i1/oscA'), MO.partOf('i2/lfo10'), MO.partOf('i1/macros'), MO.partOf('i1/fx'), MO.partOf('i1/env1'), MO.partOf('i1'), MO.partOf('i1/lfo11'), MO.partOf(7)],
    [{ dev: 'i1', part: 'oscA' }, { dev: 'i2', part: 'lfo10' }, { dev: 'i1', part: 'macros' }, null, null, null, null, null]);
  assert.equal(MO.PARTS.length, 25 - 2, 'OSC A–C, SUB, NOISE, FILTER 1–2, ENV 2–4, LFO 1–10, MACROS, ARP, CLIP (VOICE is the device, its FX iN/fx)');
  // a whole track: removeInst / removeModDev drop the parts' entries with the device
  const u = MB.tracks()[0];
  u.lay = { i2: { x: 0, y: 0 }, 'i2/oscA': { x: 0, y: 0 }, l1: { x: -320, y: 0 }, 'l1/x': { x: 0, y: 0 } };
  MO.removeInst(u, 'i2'); MO.removeModDev(u, 'l1');
  assert.deepEqual(u.lay, {});
});

test('3: a schema-7 project opens read-only in a schema-6 build (the store\'s gate) and loads at 7 here', async () => {
  const idb = fakeIDB(), seed = await A.openAppStore({ idb, ls: fakeStorage({}), bc: null });
  seed.saveProject({ name: 'parts', schema: 7, uid: 'p_parts00001', tracks: [{ id: 'trk_1', lay: { i1: { x: 0, y: 0, ui: 'parts' }, 'i1/oscA': { x: 0, y: 0 } } }] });
  await seed.flush(); await seed.close();
  const old = await A.openAppStore({ idb, ls: fakeStorage({}), bc: null, schema: 6 });
  assert.deepEqual([old.info().readOnly, old.info().newer], [true, 7], 'a schema-6 build: read-only (its normLay would drop the part keys)');
  await old.close();
  const now = await A.openAppStore({ idb, ls: fakeStorage({}), bc: null, schema: M.SCHEMA });
  assert.equal(now.info().readOnly, false);
  const p = S.deserialize(M.upgrade(JSON.parse(now.loadProject())).p);
  assert.deepEqual(p.tracks[0].lay, { i1: { x: 0, y: 0, ui: 'parts' }, 'i1/oscA': { x: 0, y: 0 } });
  await now.close();
});
