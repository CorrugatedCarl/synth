// cv-migrate.js tests (SPEC-canvas §5.1, §5.8, §10 stage 1a): the schema gate — a project of a newer schema is opened
// read-only and never modified; older projects (main's, schema 0) are brought to SCHEMA with a project uid; song.js keeps
// working on them; appstore's gate and cv-migrate agree on what "newer" is.
// Stage 1e: schema 4 (additive), song.normDev's instrument fields, cv-model's editing API (IMPL-1e §3.2).
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
  assert.equal(M.SCHEMA, 4, '1a: uid; 1b: track.lay; 1c: project v2 tracks; 1e: several instruments per track');
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

/* ------------------------------------------------------------------ stage 1e: schema 4, the editing API (IMPL-1e §3.2) */
const jclone = x => JSON.parse(JSON.stringify(x));
// an adopted one-Juno track (i1 → fx1 → out), as addTrack makes it
const juno = () => MO.adopt({ tracks: [Object.assign(S.newTrack(null, { model: 'juno60' }), { fx: C.defaultFx2() })] }).tracks[0];
const wires = t => t.wires.map(w => w.a + '>' + w.b + (w.g !== undefined ? '@' + w.g : ''));

test('1e schema 4: additive (a 3 opens as before); song.normDev keeps on, solo, zone, name and the cable level', () => {
  const p3 = Object.assign(M.toV2(mainProject()), { schema: 3, uid: 'p_abc123xyz0' }), up = M.upgrade(deepFreeze(jclone(p3)));
  assert.deepEqual([up.from, up.readOnly, up.p.schema], [3, false, 4]);
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
  assert.deepEqual([MO.instIds(t), MO.isGraphShape(t), G.validate(t).ok, MO.destOf(t, 'i2'), t.model], [['i1', 'i2'], true, true, 'fx1', 'juno60']);
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
  assert.deepEqual(MO.removeInst(t, 'i2'), { ok: true, why: '' });
  assert.deepEqual([Object.keys(t.dev), wires(t), t.mods.map(r => r.id), Object.keys(t.lay)], [['i1', 'fx1', 'out', 'i3'], ['i1.out>fx1.in', 'fx1.out>out.in', 'i3.out>fx1.in'], ['r2'], ['i1']]);
  assert.deepEqual(MO.removeInst(t, 'i1'), { ok: true, why: '' });
  assert.deepEqual([t.prim, t.model, MO.instIds(t)], ['i3', 'dx7', ['i3']], 'the lowest remaining instrument is the primary');
  assert.deepEqual(MO.removeInst(t, 'i3'), { ok: false, why: 'A track keeps at least one instrument' });
  assert.equal(MO.removeInst(t, 'fx1').ok, false);
  MO.addInst(t, 'juno60');
  assert.deepEqual(MO.removePanel(t, 'fx1'), { ok: true, why: '' });
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
  assert.deepEqual([t.prim, t.model, MO.instIds(t), G.compileGraph(t).graph.insts.map(x => x.salt)], ['i2', 'minimoog', ['i2', 'i1'], [0, 0x9E3779B9]]);
});

test('1e cv-model: setModel keeps the FX by the rules (classic ↔ Serum), sharedPanelFix', () => {
  // classic → Serum, the only source of a panel into OUT: the panel's state becomes its own FX (1c's reshape)
  const a = juno(), fxa = a.dev.fx1.fx; MO.addInst(a, 'minimoog');
  MO.removeInst(a, 'i1');
  assert.deepEqual(MO.setModel(a, 'i2', 'serum', { vals: { s: 1 } }), { ok: true, why: '' });
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
  // the primary accessor (setTrackModel) takes the same rules
  const c = juno(); c.model = 'serum';
  assert.deepEqual([Object.keys(c.dev).sort(), G.compileTrack(c).shape], [['i1', 'out'], 'serum']);
  // sharedPanelFix: a Serum into OUT gets a panel after it, the refused source joins; a Serum feeding a panel: joins that
  const d = juno(); d.model = 'serum'; MO.addInst(d, 'juno60');
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
test('H4: t.fx of a classic primary cabled straight to OUT (its panel deleted) reads undefined and a write inserts nothing', () => {
  const p = MO.adopt({ tracks: [S.newTrack(null, { model: 'juno60' })] }), t = p.tracks[0];
  assert.equal(MO.removePanel(t, 'fx1').ok, true);
  const shape = () => Object.keys(t.dev).sort().join(',') + ' | ' + t.wires.map(w => w.a + '>' + w.b).join(' ');
  assert.deepEqual([shape(), t.fx, MO.fxDevOf(t)], ['i1,out | i1.out>out.in', undefined, null]);
  t.fx = C.defaultFx2();
  assert.equal(shape(), 'i1,out | i1.out>out.in', 'no panel re-inserted (no History step would hold it)');
  t.model = 'serum'; t.fx = C.defaultFx2(); // (a Serum primary: its own FX, written)
  assert.deepEqual([shape(), MO.fxDevOf(t).own], ['i1,out | i1.out>out.in', true]);
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
  const mk = () => MO.adopt({ tracks: [S.newTrack(null, { model: 'juno60' })] }).tracks[0];
  const ids = t => Object.keys(t.dev).sort().join(',');
  // the canonical round trip classic → Serum → classic: fx1 again, its state; the id saved through song.js
  const t = mk(), cho = C.defaultFx2(); C.newInstance(cho, 'cho', { rack: 0 }); t.fx = cho;
  t.model = 'serum';
  assert.deepEqual([ids(t), t.dev.i1.fxId, t.dev.i1.fx === cho], ['i1,out', 'fx1', true]);
  const back = S.normDev(JSON.parse(JSON.stringify(t)));
  assert.equal(back.dev.i1.fxId, 'fx1', 'song.normDev keeps it');
  assert.equal(S.normDev({ dev: { i1: { kind: 'synth', model: 'serum', fxId: 'x<1' } } }).dev.i1.fxId, undefined, '(only an fx id)');
  t.model = 'dx7';
  assert.deepEqual([ids(t), t.dev.fx1.fx === cho, 'fxId' in t.dev.i1, MO.destOf(t, 'i1')], ['fx1,i1,out', true, false, 'fx1']);
  MO.setModel(t, 'i1', 'serum'); MO.setModel(t, 'i1', 'juno60'); // (setModel: the same rule)
  assert.deepEqual([ids(t), t.dev.fx1.fx === cho], ['fx1,i1,out', true]);
  // fx1 deleted, then classic → Serum → classic: a new panel fx2 (an undo past the delete keeps fx1 — the chorus — apart
  // from it: the device ids per track are never one another's)
  const u = mk(); u.fx = cho;
  const before = JSON.parse(JSON.stringify(u));
  MO.removePanel(u, 'fx1');
  u.model = 'serum';
  assert.deepEqual([ids(u), 'fxId' in u.dev.i1], ['i1,out', false]);
  u.model = 'juno60';
  assert.deepEqual([ids(u), MO.destOf(u, 'i1')], ['fx2,i1,out', 'fx2']);
  assert.deepEqual([Object.keys(before.dev).filter(k => k in u.dev && before.dev[k].kind === 'panel'), before.dev.fx1.fx.racks[0].mods.map(m => m.type)], [[], ['cho']], 'no shared panel id: keepDevs keeps the snapshot\'s chorus');
});
