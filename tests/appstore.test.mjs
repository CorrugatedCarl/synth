// appstore.js tests (owner I; SPEC-serum2 §12.6 storage B21, §15.13, lead sign-off on §0.8 item 7).
// Run: node --test tests/appstore.test.mjs
//  - createLocalStore is the Phase-1 main.js store (behaviour compared with a verbatim copy of the Phase-1 object);
//  - openAppStore over a fake IndexedDB: first-run migration of a realistic Phase-1 localStorage snapshot (copied,
//    read back and verified; localStorage never written or deleted), fallback to localStorage whenever IndexedDB is
//    unavailable or fails, per-track autosave (only changed track records rewritten), quota notices, re-sync of keys
//    written by a localStorage-mode session, cross-tab refresh.
//  - SYNTH Canvas (SPEC-canvas §5.6, §5.8, stage 1a): the store's own namespace (database `synth-canvas`, `synthc.` keys,
//    its own bookkeeping keys) — main's `synth-app` database and `synth.*` keys are never read or written; the schema
//    gate (a newer project is opened read-only and never overwritten). The tests below store under the `synthc.` names
//    (what the keys are in localStorage and the database); callers' `synth.` names map to them (appKey).
import './v8-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as A from '../appstore.js';
import * as S from '../song.js';
import * as P1 from './ref-p1/serum-core.js';

/* ------------------------------------------------------------ fakes (tests/fakes.mjs) */
import { fakeStorage, fakeIDB } from './fakes.mjs';
const lsObj = st => Object.fromEntries(st.m);
// localStorage without the store's bookkeeping marker (A.IDB_MARK: "a verified database exists", written once per browser)
const noMark = o => { const c = Object.assign({}, o); delete c[A.IDB_MARK]; return c; };

/* ------------------------------------------------------------ a realistic Phase-1 localStorage */
const PROJ_FILE = JSON.parse(readFileSync(new URL('./ref-p1/project-p1.json', import.meta.url), 'utf8'));
function p1Project() { // the autosave form of the Phase-1 project file: no embedded tables, with the UI extras
  const { wts, ...p } = JSON.parse(JSON.stringify(PROJ_FILE));
  return Object.assign(p, { drawLen: 240, follow: true, ghosts: false });
}
function p1Snapshot() {
  const proj = p1Project(), sx = P1.FACTORY_PRESETS.slice(0, 3);
  return {
    'synthc.project': S.serialize(proj),
    'synthc.settings': JSON.stringify({ sr: 0, os: 4, drift: 5, master: 0.8, model: 'serum', vel: 100 }),
    'synthc.v.minimoog': JSON.stringify(proj.tracks[2].vals),
    'synthc.v.juno60': JSON.stringify(proj.tracks[4].vals),
    'synthc.v.dx7': '{"broken', // an unparsable value is copied verbatim (get() keeps returning the default)
    'synthc.user.minimoog': JSON.stringify([{ name: 'Fat bass', v: proj.tracks[2].vals }, { name: 'Lead “β”', v: {} }]),
    'synthc.user.serum': JSON.stringify(sx.map((p, i) => ({ name: 'Mine ' + i, cat: 'User', v: { s: p.v.s }, fx: P1.defaultFx() }))),
    'synthc.seq303': JSON.stringify(proj.tracks[3].seq || { pat: [] }),
    'synthc.sx.prefs': JSON.stringify({ tooltips: 1, dblClick: 'type', wheel: 1, view3d: 1, defOs: 4, author: 'Ü' }),
    'synthc.sx.browser': JSON.stringify({ cat: 'Bass', sort: 'name', fav: ['f:Init'] }),
    'synthc.sx.shapes': JSON.stringify([{ name: 'tri', pts: [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]] }]),
    'synthc.sx.wte': JSON.stringify({ split: 2048 }),
    'synthc.sx.formulas': JSON.stringify(['sin(x*pi)']),
    'synthc.fxchains': JSON.stringify(P1.FACTORY_CHAINS.chains.slice(0, 2)),
    'synthc.fxmod.rev': JSON.stringify([{ name: 'Big', p: { size: 0.9 } }]),
    'synthc.tab': JSON.stringify('roll'),
    'synthc.kbHidden': 'true',
    'synthc.devsr': '48000',
    'other.site.key': 'not ours', // keys of other apps on the origin are left alone
  };
}
const appKeys = snap => Object.keys(snap).filter(A.isAppKey);

/* ------------------------------------------------------------ Phase-1 equivalence */
// The Phase-1 main.js store, verbatim (it reads the global localStorage on every call)
const P1_STORE = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  raw(k) { try { return localStorage.getItem(k); } catch { return null; } },
  setRaw(k, v) { try { localStorage.setItem(k, v); } catch { /* storage full or unavailable */ } },
};

test('module import touches no browser globals; constants', () => {
  assert.equal(globalThis.indexedDB, undefined);
  assert.equal(globalThis.localStorage, undefined);
  assert.equal(A.DB_NAME, 'synth-canvas');
  assert.equal(A.DB_VER, 1);
  assert.equal(A.QUOTA_NOTICE, 'Storage full — the project was not saved');
  assert.equal(A.PROJECT_KEY, 'synthc.project');
  assert.ok(A.isAppKey('synthc.v.dx7') && A.isAppKey('synthc.project') && !A.isAppKey(A.STAMP_KEY) && !A.isAppKey('#meta') && !A.isAppKey(null));
  // main's keys are not the canvas build's: neither its app keys nor its bookkeeping keys, nor its databases
  assert.ok(!A.isAppKey('synth.v.dx7') && !A.isAppKey('synth.project'));
  assert.deepEqual([A.STAMP_KEY, A.STALE_KEY, A.IDB_MARK, A.UNLOAD_KEY], ['synth-canvas.lsat', 'synth-canvas.lsstale', 'synth-canvas.idb', 'synth-canvas.unload']);
  assert.deepEqual([A.WT_DB, A.SMP_DB], ['synth-canvas-wt', 'synth-canvas-smp']);
  assert.deepEqual(['synth.settings', 'synth.user.serum', 'synthc.tab', 'synth-app.idb', 'other', 'synth', null].map(A.appKey),
    ['synthc.settings', 'synthc.user.serum', 'synthc.tab', 'synth-app.idb', 'other', 'synth', null]);
  const src = readFileSync(new URL('../appstore.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m, 'appstore.js imports nothing');
});

test('createLocalStore ≡ the Phase-1 main.js store (same results, same localStorage contents)', () => {
  const circ = {}; circ.self = circ;
  const proj = p1Project();
  const ops = [
    ['get', 'synthc.none', 7], ['set', 'synthc.a', { x: [1, 2, 'é'] }], ['get', 'synthc.a', null], ['raw', 'synthc.a'],
    ['setRaw', 'synthc.b', ''], ['get', 'synthc.b', 'dflt'], ['setRaw', 'synthc.c', '{bad'], ['get', 'synthc.c', 'dflt'],
    ['set', 'synthc.d', undefined], ['raw', 'synthc.d'], ['get', 'synthc.d', 3], ['set', 'synthc.e', circ], ['raw', 'synthc.e'],
    ['set', 'synthc.f', 0], ['get', 'synthc.f', 9], ['set', 'synthc.g', false], ['get', 'synthc.g', true], ['setRaw', 'synthc.h', 12],
    ['raw', 'synthc.h'], ['raw', 'synthc.none'], ['project', proj], ['load'],
  ];
  const runOn = (st, ls) => {
    const out = [];
    for (const [op, k, v] of ops) {
      if (op === 'project') { st === P1_STORE ? st.setRaw('synthc.project', S.serialize(k)) : st.saveProject(k); out.push(null); }
      else if (op === 'load') out.push(st === P1_STORE ? st.raw('synthc.project') : st.loadProject());
      else out.push(op === 'get' ? st.get(k, v) : op === 'raw' ? st.raw(k) : st[op](k, v));
    }
    return [out, lsObj(ls)];
  };
  const ls1 = fakeStorage(), ls2 = fakeStorage();
  try {
    globalThis.localStorage = ls1;
    const ref = runOn(P1_STORE, ls1);
    const mine = A.createLocalStore(); // resolves globalThis.localStorage per call, as Phase 1 did
    globalThis.localStorage = ls2;
    assert.deepEqual(runOn(mine, ls2), ref);
    assert.equal(ls2.m.get('synthc.project'), S.serialize(proj));
    assert.equal(mine.mode, 'ls');
    assert.equal(ls2.m.has(A.STAMP_KEY), false, 'no bookkeeping key without the stamp option');
    // unavailable / full storage: defaults, null, silence (no onError given)
    ls1.broken = true; ls2.broken = true;
    globalThis.localStorage = ls1;
    const a = [P1_STORE.get('synthc.a', 5), P1_STORE.raw('synthc.a'), P1_STORE.set('synthc.z', 1), P1_STORE.setRaw('synthc.z', 'x')];
    globalThis.localStorage = ls2;
    assert.deepEqual([mine.get('synthc.a', 5), mine.raw('synthc.a'), mine.set('synthc.z', 1), mine.setRaw('synthc.z', 'x')], a);
    assert.equal(mine.loadProject(), null);
    delete globalThis.localStorage;
    assert.equal(mine.get('synthc.a', 5), 5); // no localStorage at all
    assert.doesNotThrow(() => mine.set('synthc.a', 1));
  } finally { delete globalThis.localStorage; }
});

test('createLocalStore: quota errors call onError with the notice; stamp option records write times', async () => {
  const errs = [], ls = fakeStorage({}, { quota: 200 });
  let t = 1000;
  const st = A.createLocalStore({ ls, onError: e => errs.push(e), stamp: true, now: () => t });
  st.set('synthc.small', 1);
  t = 2000;
  st.saveProject({ tracks: [{ id: 'trk_1', notes: 'x'.repeat(400) }] });
  assert.equal(errs.length, 1);
  assert.deepEqual([errs[0].key, errs[0].quota, errs[0].notice, errs[0].fallback], ['synthc.project', true, A.QUOTA_NOTICE, false]);
  assert.equal(st.loadProject(), null);
  assert.deepEqual(JSON.parse(ls.m.get(A.STAMP_KEY)), { 'synthc.small': 1000 });
  ls.broken = true;
  st.set('synthc.small', 2);
  assert.deepEqual([errs[1].quota, errs[1].notice], [false, null]); // other failures are reported without the notice
  assert.equal(st.info().mode, 'ls');
  await st.flush();
});

/* ------------------------------------------------------------ pure helpers */
test('splitProject / joinProject: the History per-track split, round trip, odd inputs', () => {
  const p = p1Project(), sp = A.splitProject(p), snap = new S.History(4)._snap(p);
  assert.equal(sp.m, snap.m);
  assert.deepEqual(sp.t, snap.t);
  assert.deepEqual(sp.keys, p.tracks.map(t => 't:' + t.id));
  assert.ok(A.sameJSON(A.joinProject(sp), S.serialize(p)));
  assert.deepEqual(A.splitProject(S.serialize(p)), sp); // text input
  assert.deepEqual(JSON.parse(A.joinProject(sp)), JSON.parse(S.serialize(p)));
  assert.deepEqual(S.deserialize(A.joinProject(sp)).tracks.map(t => t.notes.length), p.tracks.map(t => t.notes.length));
  assert.equal(A.joinProject(A.splitProject({ tracks: [] })), '{"tracks":[]}');
  // repeated / missing ids get positional record ids
  assert.deepEqual(A.splitProject({ tracks: [{ id: 'a' }, { id: 'a' }, {}, null] }).keys, ['t:a', 'i:1', 'i:2', 'i:3']);
  // not a project: stored verbatim
  for (const raw of ['{bad', 'null', '5', '[1]', '{"tracks":{}}']) assert.deepEqual(A.splitProject(raw), { raw });
  assert.deepEqual(A.splitProject({ x: 1 }), { raw: '{"x":1}' });
  assert.equal(A.joinProject({ raw: '{bad' }), '{bad');
  assert.equal(A.joinProject(null), null);
});

test('sameJSON, hashText', () => {
  assert.ok(A.sameJSON('{"a":1,"b":[1,{"c":2}]}', '{"b":[1,{"c":2}],"a":1}'));
  assert.ok(!A.sameJSON('{"a":1}', '{"a":1,"b":null}'));
  assert.ok(!A.sameJSON('[1,2]', '[2,1]'));
  assert.ok(!A.sameJSON('{"a":[]}', '{"a":{}}'));
  assert.ok(A.sameJSON('{bad', '{bad') && !A.sameJSON('{bad', '{bad '));
  assert.equal(A.hashText('abc'), A.hashText('ab' + 'c'));
  assert.notEqual(A.hashText('abc'), A.hashText('acb'));
  assert.notEqual(A.hashText(''), A.hashText(' '));
  assert.equal(A.hashText(undefined), undefined);
  assert.ok(A.isQuotaError(new DOMException('x', 'QuotaExceededError')) && A.isQuotaError({ code: 1014 }) && !A.isQuotaError(new Error('x')));
});

/* ------------------------------------------------------------ openAppStore */
test('openAppStore without IndexedDB, or when it fails to open: the Phase-1 localStorage store', async () => {
  const snap = p1Snapshot();
  for (const [idb, reason] of [[null, 'unavailable'], [{}, 'unavailable'], [fakeIDB({ open: 'throw' }), 'failed'], [fakeIDB({ open: 'error' }), 'failed'], [fakeIDB({ open: 'hang' }), 'timeout']]) {
    const ls = fakeStorage(snap), warn = console.warn;
    console.warn = () => {};
    let st;
    try { st = await A.openAppStore({ idb, ls, bc: null, timeout: 30 }); } finally { console.warn = warn; }
    assert.equal(st.mode, 'ls', reason);
    assert.equal(st.info().reason, reason);
    assert.equal(st.loadProject(), snap['synthc.project']);
    assert.deepEqual(st.get('synthc.sx.prefs', null), JSON.parse(snap['synthc.sx.prefs']));
    assert.deepEqual(lsObj(ls), snap, 'nothing written while opening');
    st.set('synthc.tab', 'fx');
    assert.equal(ls.m.get('synthc.tab'), '"fx"'); // works on localStorage exactly as in Phase 1 (plus the write time)
    assert.ok('synthc.tab' in JSON.parse(ls.m.get(A.STAMP_KEY)));
  }
});

test('first run: a realistic Phase-1 localStorage is migrated, read back, verified; localStorage untouched', async () => {
  const snap = p1Snapshot(), ls = fakeStorage(snap), idb = fakeIDB();
  const st = await A.openAppStore({ idb, ls, bc: null, now: () => 5000 });
  assert.equal(st.mode, 'idb');
  assert.deepEqual(st.info(), { mode: 'idb', reason: 'idb', migrated: true, resynced: [], conflicts: [], stale: false, restored: false, readOnly: false, newer: 0 });
  // every app key reads back exactly; the other app's key is not copied
  for (const k of appKeys(snap)) {
    if (k === 'synthc.project') continue;
    assert.equal(st.raw(k), snap[k], k);
    assert.deepEqual(st.get(k, 'dflt'), (() => { try { return JSON.parse(snap[k]); } catch { return 'dflt'; } })(), k);
  }
  assert.equal(st.raw('other.site.key'), null);
  assert.ok(A.sameJSON(st.loadProject(), snap['synthc.project']));
  assert.ok(A.sameJSON(st.raw('synthc.project'), snap['synthc.project']));
  assert.deepEqual(JSON.parse(st.loadProject()), JSON.parse(snap['synthc.project']));
  assert.equal(S.deserialize(st.loadProject()).tracks.length, 7); // song.deserialize (main.js loadProject) accepts it
  // localStorage: no app key written, nothing deleted (the read-only fallback); only the marker of a verified database
  assert.deepEqual(ls.writes, [A.IDB_MARK]);
  assert.deepEqual(noMark(lsObj(ls)), snap);
  assert.equal(ls.m.get(A.IDB_MARK), '5000');
  // database layout
  const kv = idb.data(A.DB_NAME, 'kv'), tr = idb.data(A.DB_NAME, 'tracks');
  assert.deepEqual([...kv.keys()].filter(A.isAppKey).sort(), appKeys(snap).filter(k => k !== 'synthc.project').sort());
  assert.equal(kv.get('#meta').v.state, 'ok');
  assert.deepEqual(kv.get('synthc.devsr'), { k: 'synthc.devsr', v: '48000', at: 5000 });
  const proj = p1Project();
  assert.deepEqual(tr.get('#head').keys, proj.tracks.map(t => 't:' + t.id));
  assert.equal(tr.size, proj.tracks.length + 1);
  assert.equal(tr.get('t:trk_1').j, JSON.stringify(proj.tracks[0]));
  await st.close();

  // the next run reads the database: no migration, no writes
  idb.resetStats();
  const ls2 = fakeStorage(lsObj(ls));
  const st2 = await A.openAppStore({ idb, ls: ls2, bc: null });
  assert.equal(st2.info().migrated, false);
  assert.deepEqual(idb.stats.put, {});
  assert.ok(A.sameJSON(st2.loadProject(), snap['synthc.project']));
  assert.equal(st2.raw('synthc.user.serum'), snap['synthc.user.serum']);
  assert.deepEqual(ls2.writes, []);
  await st2.close();
});

test('first run: a copy that does not read back equal is not trusted (localStorage session; retried next run)', async () => {
  const snap = p1Snapshot(), ls = fakeStorage(snap), idb = fakeIDB(), warn = console.warn;
  const quiet = async () => { // open with console.warn captured: [store, the reason logged]
    let why = '';
    console.warn = (m, e) => { why = String(e && (e.name === 'QuotaExceededError' ? e.name : e.message)); };
    try { return [await A.openAppStore({ idb, ls, bc: null }), why]; } finally { console.warn = warn; }
  };
  idb.corrupt = (store, v) => (store === 'kv' && v.k === 'synthc.user.serum' ? Object.assign(v, { v: v.v.slice(0, -1) }) : v);
  const [st, why] = await quiet();
  assert.equal(st.mode, 'ls');
  assert.match(why, /migrated key differs: synthc\.user\.serum/);
  assert.equal(st.raw('synthc.user.serum'), snap['synthc.user.serum']);
  assert.notEqual(idb.data(A.DB_NAME, 'kv').get('#meta').v.state, 'ok');
  assert.deepEqual(lsObj(ls), snap);
  // a corrupted project copy is caught too
  idb.corrupt = (store, v) => (store === 'tracks' && v.id === 't:trk_3' ? Object.assign(v, { j: v.j.replace('"minimoog"', '"juno60"') }) : v);
  const [st1, why1] = await quiet();
  assert.equal(st1.mode, 'ls');
  assert.match(why1, /migrated project differs/);
  // a quota error during the copy: the same
  idb.corrupt = null; idb.budget = 1000;
  const [st2, why2] = await quiet();
  assert.equal(st2.mode, 'ls');
  assert.equal(why2, 'QuotaExceededError');
  assert.deepEqual(lsObj(ls), snap);
  assert.deepEqual(ls.writes, []);
  // next run with a working database: migrated from scratch
  idb.budget = Infinity;
  const st3 = await A.openAppStore({ idb, ls, bc: null });
  assert.equal(st3.mode, 'idb');
  assert.equal(st3.info().migrated, true);
  assert.equal(st3.raw('synthc.user.serum'), snap['synthc.user.serum']);
  assert.ok(A.sameJSON(st3.loadProject(), snap['synthc.project']));
  await st3.close();
});

test('an empty localStorage (new user) migrates to an empty database', async () => {
  const ls = fakeStorage({ 'other.key': '1' }), idb = fakeIDB();
  const st = await A.openAppStore({ idb, ls, bc: null });
  assert.equal(st.mode, 'idb');
  assert.equal(st.loadProject(), null);
  assert.equal(st.get('synthc.settings', 'd'), 'd');
  st.saveProject(S.newProject({ model: 'minimoog' }));
  st.set('synthc.settings', { os: 2 });
  await st.flush();
  assert.deepEqual(noMark(lsObj(ls)), { 'other.key': '1' });
  assert.equal(idb.data(A.DB_NAME, 'tracks').size, 2);
  await st.close();
});

test('autosave rewrites only the changed track records (and the header)', async () => {
  const snap = p1Snapshot(), idb = fakeIDB();
  const st = await A.openAppStore({ idb, ls: fakeStorage(snap), bc: null });
  const p = JSON.parse(st.loadProject());
  const tracksPut = () => idb.stats.put.tracks || 0, tracksDel = () => idb.stats.del.tracks || 0;

  idb.resetStats();
  st.saveProject(p); await st.flush(); // the stored content (key order aside): nothing to write
  assert.equal(tracksPut(), 0);

  p.tracks[2].notes.push({ id: 999, t: 0, d: 240, n: 60, v: 100 }); // edit one track
  idb.resetStats();
  st.saveProject(p); await st.flush();
  assert.equal(tracksPut(), 2, 'one track + header');
  assert.equal(idb.stats.tx, 1);
  assert.equal(JSON.parse(idb.data(A.DB_NAME, 'tracks').get('t:trk_3').j).notes.length, p.tracks[2].notes.length);

  idb.resetStats();
  p.bpm = 128; st.saveProject(p); await st.flush(); // project fields only
  assert.equal(tracksPut(), 1);

  idb.resetStats();
  p.tracks.push(S.newTrack(p, { model: 'dx7' })); st.saveProject(p); await st.flush(); // add a track
  assert.equal(tracksPut(), 2);

  idb.resetStats();
  const gone = p.tracks.splice(1, 1)[0]; st.saveProject(p); await st.flush(); // delete one
  assert.deepEqual([tracksPut(), tracksDel()], [1, 1]);
  assert.equal(idb.data(A.DB_NAME, 'tracks').has('t:' + gone.id), false);

  idb.resetStats();
  p.tracks.reverse(); st.saveProject(p); await st.flush(); // reorder: header only
  assert.deepEqual([tracksPut(), tracksDel()], [1, 0]);

  // rapid saves coalesce into the latest state
  idb.resetStats();
  for (let i = 0; i < 5; i++) { p.name = 'Song ' + i; st.saveProject(p); }
  await st.flush();
  assert.ok(idb.stats.tx <= 2);
  assert.ok(A.sameJSON(st.loadProject(), S.serialize(p)));
  await st.close();
  const again = await A.openAppStore({ idb, ls: fakeStorage(snap), bc: null });
  assert.ok(A.sameJSON(again.loadProject(), S.serialize(p)));
  assert.equal(S.deserialize(again.loadProject()).name, 'Song 4');
  await again.close();
});

test('key/value writes: synchronous reads, batched writes, localStorage never written', async () => {
  const snap = p1Snapshot(), ls = fakeStorage(snap), idb = fakeIDB();
  const st = await A.openAppStore({ idb, ls, bc: null });
  idb.resetStats();
  st.set('synthc.tab', 'fx'); st.set('synthc.kbHidden', false); st.setRaw('synthc.devsr', '96000');
  assert.equal(st.get('synthc.tab'), 'fx');
  assert.equal(st.get('synthc.kbHidden', true), false);
  assert.equal(st.raw('synthc.devsr'), '96000');
  const o = st.get('synthc.sx.prefs'); o.author = 'changed'; // returned values are copies
  assert.equal(st.get('synthc.sx.prefs').author, 'Ü');
  await st.flush();
  assert.equal(idb.stats.tx, 1);
  assert.equal(idb.data(A.DB_NAME, 'kv').get('synthc.tab').v, '"fx"');
  assert.deepEqual(noMark(lsObj(ls)), snap);
  st.setRaw('synthc.project', S.serialize(S.newProject({ model: 'juno60' }))); // the project key maps to the autosave
  await st.flush();
  assert.equal(S.deserialize(st.raw('synthc.project')).tracks[0].model, 'juno60');
  await st.close();
});

test('quota errors raise the notice and keep the store on IndexedDB; failed writes are retried', async () => {
  const snap = p1Snapshot(), idb = fakeIDB(), errs = [];
  const st = await A.openAppStore({ idb, ls: fakeStorage(snap), bc: null, onError: e => errs.push(e) });
  idb.budget = idb.bytes(A.DB_NAME) + 500;
  st.set('synthc.user.minimoog', [{ name: 'huge', v: { pad: 'x'.repeat(5000) } }]);
  await st.flush();
  assert.equal(errs.length, 1);
  assert.deepEqual([errs[0].quota, errs[0].notice, errs[0].fallback, errs[0].key], [true, A.QUOTA_NOTICE, false, 'synthc.user.minimoog']);
  assert.equal(st.mode, 'idb');
  assert.equal(st.get('synthc.user.minimoog')[0].name, 'huge'); // the session keeps the value
  const p = JSON.parse(snap['synthc.project']); p.tracks[0].notes = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, t: i * 10, d: 5, n: 60, v: 90 }));
  st.saveProject(p);
  await st.flush();
  assert.equal(errs.length, 2);
  assert.deepEqual([errs[1].notice, errs[1].key], [A.QUOTA_NOTICE, 'synthc.project']);
  // space again: the next write also stores the failed key; the project is retried by the next autosave
  idb.budget = Infinity;
  st.set('synthc.tab', 'roll');
  st.saveProject(p);
  await st.flush();
  assert.equal(errs.length, 2);
  assert.equal(JSON.parse(idb.data(A.DB_NAME, 'kv').get('synthc.user.minimoog').v)[0].name, 'huge');
  assert.equal(JSON.parse(idb.data(A.DB_NAME, 'tracks').get('t:trk_1').j).notes.length, 300);
  await st.close();
});

test('IndexedDB failing during a session: the store degrades to localStorage with the whole state', async () => {
  const snap = p1Snapshot(), ls = fakeStorage(snap), idb = fakeIDB(), errs = [];
  let t = 10;
  const st = await A.openAppStore({ idb, ls, bc: null, onError: e => errs.push(e), now: () => t });
  st.set('synthc.tab', 'fx');
  await st.flush();
  t = 20;
  idb.failTx = () => true; // e.g. Safari "connection to the database server lost"
  st.set('synthc.settings', { os: 8 });
  await st.flush();
  assert.equal(st.mode, 'ls');
  assert.deepEqual([errs.length, errs[0].fallback, errs[0].notice], [1, true, null]);
  assert.equal(ls.m.get('synthc.tab'), '"fx"'); // the cached state went to localStorage
  assert.equal(ls.m.get('synthc.settings'), '{"os":8}');
  assert.ok(A.sameJSON(ls.m.get('synthc.project'), snap['synthc.project']));
  const stamps = JSON.parse(ls.m.get(A.STAMP_KEY));
  assert.equal(stamps['synthc.tab'], 20);
  assert.ok(ls.writes.every(w => !w.startsWith('-')), 'nothing deleted from localStorage');
  st.set('synthc.kbHidden', true); // later writes: localStorage
  assert.equal(ls.m.get('synthc.kbHidden'), 'true');
  assert.equal(st.get('synthc.kbHidden'), true);
  assert.equal(st.get('synthc.user.serum').length, 3);
  await st.close();
});

test('later runs re-sync keys written by a localStorage-mode session (three-way, recovery copies)', async () => {
  const snap = p1Snapshot(), idb = fakeIDB();
  let t = 1000;
  const now = () => t;
  // session 1 (IndexedDB): migrates, then edits synth.v.juno60 and synth.sx.browser
  const s1 = await A.openAppStore({ idb, ls: fakeStorage(snap), bc: null, now });
  t = 2000;
  s1.set('synthc.v.juno60', { idb: 1 }); s1.set('synthc.sx.browser', { idb: 1 });
  await s1.close();
  // session 2 (IndexedDB unavailable): works on the old localStorage copies
  const ls = fakeStorage(snap);
  const s2 = await A.openAppStore({ idb: null, ls, bc: null, now });
  t = 3000;
  s2.set('synthc.tab', 'fx');                   // only localStorage changed → copied in
  s2.set('synthc.v.juno60', { ls: 1 });         // both changed, localStorage newer (stamped) → localStorage wins
  const p = JSON.parse(snap['synthc.project']); p.name = 'Edited offline';
  s2.saveProject(p);                           // the project too
  s2.set('synthc.new.key', [1]);                // a new key → copied in
  ls.m.set('synthc.sx.browser', '{"old":1}');   // both changed, no write time (e.g. an old Phase-1 tab) → IndexedDB wins
  // session 3 (IndexedDB again)
  t = 4000;
  const s3 = await A.openAppStore({ idb, ls, bc: null, now });
  const info = s3.info();
  assert.equal(info.migrated, false);
  assert.deepEqual(info.resynced.sort(), ['synthc.new.key', 'synthc.project', 'synthc.tab', 'synthc.v.juno60']);
  assert.deepEqual(info.conflicts.sort(), ['synthc.sx.browser', 'synthc.v.juno60']);
  assert.equal(s3.get('synthc.tab'), 'fx');
  assert.deepEqual(s3.get('synthc.v.juno60'), { ls: 1 });
  assert.deepEqual(s3.get('synthc.sx.browser'), { idb: 1 });
  assert.deepEqual(s3.get('synthc.new.key'), [1]);
  assert.equal(S.deserialize(s3.loadProject()).name, 'Edited offline');
  const kv = idb.data(A.DB_NAME, 'kv');
  assert.deepEqual([kv.get('#rec:synthc.v.juno60').v, kv.get('#rec:synthc.v.juno60').from], ['{"idb":1}', 'idb']);
  assert.deepEqual([kv.get('#rec:synthc.sx.browser').v, kv.get('#rec:synthc.sx.browser').from], ['{"old":1}', 'ls']);
  assert.equal(s3.raw('#rec:synthc.sx.browser'), null); // recovery copies are not app keys
  await s3.close();
  // session 4: nothing changed on either side → no writes
  idb.resetStats();
  const s4 = await A.openAppStore({ idb, ls, bc: null, now });
  assert.deepEqual([s4.info().resynced, s4.info().conflicts, idb.stats.put], [[], [], {}]);
  // an IndexedDB-side project edit survives an unchanged localStorage
  const q = S.deserialize(s4.loadProject()); q.name = 'Online';
  s4.saveProject(q); await s4.close();
  const s5 = await A.openAppStore({ idb, ls, bc: null, now });
  assert.equal(S.deserialize(s5.loadProject()).name, 'Online');
  assert.deepEqual(s5.info().resynced, []);
  await s5.close();
});

test('another tab\'s writes refresh the cache (BroadcastChannel)', async () => {
  const chans = [];
  const chan = () => { const c = { onmessage: null, closed: false, postMessage(m) { for (const o of chans) if (o !== c && !o.closed && o.onmessage) setTimeout(() => o.onmessage({ data: structuredClone(m) }), 0); }, close() { this.closed = true; } }; chans.push(c); return c; };
  const snap = p1Snapshot(), idb = fakeIDB();
  const a = await A.openAppStore({ idb, ls: fakeStorage(snap), bc: chan() });
  const b = await A.openAppStore({ idb, ls: fakeStorage(snap), bc: chan() });
  a.set('synthc.user.minimoog', [{ name: 'from A', v: {} }]);
  await a.flush();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(b.get('synthc.user.minimoog')[0].name, 'from A');
  await a.close(); await b.close();
  assert.ok(chans.every(c => c.closed));
});

test('IndexedDB → a session that cannot open it → IndexedDB: the fallback runs on the older copy with a notice, and its edits never replace the database (kept as recovery copies)', async () => {
  const proj = name => JSON.stringify({ name, bpm: 120, tracks: [{ id: 't1', model: 'minimoog', notes: [] }] });
  const ls = fakeStorage({ 'synthc.project': proj('phase-1 project'), 'synthc.settings': '{"os":4}', 'synthc.tab': '"roll"' }), idb = fakeIDB(), errs = [];
  let t = 1000;
  const now = () => (t += 1000), warn = console.warn;
  // session 1 (IndexedDB): migrates, then the user works
  let s = await A.openAppStore({ ls, idb, bc: null, now, onError: e => errs.push(e) });
  assert.ok(ls.m.get(A.IDB_MARK), 'a verified database is marked in localStorage');
  s.saveProject(proj('weeks of work in IndexedDB')); s.set('synthc.settings', { os: 2 });
  await s.close();
  // session 2: IndexedDB does not open (unavailable / failed / timed out) — the older localStorage copy, with a notice
  for (const idb2 of [null, fakeIDB({ open: 'error' })]) {
    errs.length = 0;
    console.warn = () => {};
    try { s = await A.openAppStore({ ls, idb: idb2, bc: null, now, onError: e => errs.push(e), timeout: 30 }); } finally { console.warn = warn; }
    assert.equal(s.mode, 'ls');
    assert.equal(s.info().stale, true);
    assert.equal(errs.length, 1);
    assert.deepEqual([errs[0].notice, errs[0].fallback, errs[0].stale], [A.STALE_NOTICE, true, true]);
    assert.equal(JSON.parse(s.loadProject()).name, 'phase-1 project');
  }
  s.saveProject(proj('phase-1 project + one edit')); s.set('synthc.tab', 'fx'); s.set('synthc.new', 1);
  assert.ok('synthc.project' in JSON.parse(ls.m.get(A.STALE_KEY)), 'stale write times');
  assert.equal(ls.m.get(A.STAMP_KEY), undefined);
  // session 3 (IndexedDB again): the database keeps its values; the fallback session's texts are recovery copies
  errs.length = 0;
  s = await A.openAppStore({ ls, idb, bc: null, now, onError: e => errs.push(e) });
  const info = s.info();
  assert.equal(JSON.parse(s.loadProject()).name, 'weeks of work in IndexedDB');
  assert.deepEqual(s.get('synthc.settings'), { os: 2 });
  assert.equal(s.get('synthc.tab'), 'roll', 'a key only the stale session changed does not replace the database value either');
  assert.equal(s.get('synthc.new'), 1, 'a key the database does not have is taken');
  assert.deepEqual(info.conflicts.sort(), ['synthc.project', 'synthc.tab']);
  assert.equal(JSON.parse(s.recovered('synthc.project')).name, 'phase-1 project + one edit');
  assert.equal(s.recovered('synthc.tab'), '"fx"');
  assert.equal(idb.data(A.DB_NAME, 'kv').get('#rec:synthc.project').from, 'stale');
  assert.equal(errs.length, 0);
  await s.close();
  // a degraded IndexedDB session (current data) writes plain stamps and clears the stale marks of what it writes
  const ls2 = fakeStorage(lsObj(ls)), idb3 = fakeIDB();
  const st = await A.openAppStore({ ls: ls2, idb: idb3, bc: null, now, onError: () => {} });
  idb3.failTx = () => true;
  st.set('synthc.tab', 'arp');
  await st.flush();
  assert.equal(st.mode, 'ls');
  assert.equal('synthc.tab' in JSON.parse(ls2.m.get(A.STALE_KEY)), false);
  assert.ok('synthc.tab' in JSON.parse(ls2.m.get(A.STAMP_KEY)));
  await st.close();
  // the database gone (evicted / deleted) while localStorage keeps the marker: migrated again, with a notice
  errs.length = 0;
  s = await A.openAppStore({ ls, idb: fakeIDB(), bc: null, now, onError: e => errs.push(e) });
  assert.deepEqual([s.info().migrated, s.info().restored, errs.length, errs[0] && errs[0].notice], [true, true, 1, A.RESTORED_NOTICE]);
  await s.close();
});

test('saveNow (pagehide / beforeunload / hidden): the project and pending keys go into one transaction created in the caller\'s task; an emergency copy covers a transaction that never commits', async () => {
  const ls = fakeStorage({ 'synthc.settings': '{"os":4}' }), idb = fakeIDB(), errs = [];
  let t = 100;
  const now = () => (t += 10);
  const s = await A.openAppStore({ ls, idb, bc: null, now, onError: e => errs.push(e) });
  s.saveProject({ name: 'p', tracks: [{ id: 't1', n: 1 }, { id: 't2', n: 1 }] });
  await s.flush();
  idb.resetStats();
  // the unload handler: synchronous, then the page may be gone (no later task)
  s.set('synthc.settings', { os: 2 });
  s.saveNow({ name: 'p', tracks: [{ id: 't1', n: 2 }, { id: 't2', n: 1 }] });
  assert.equal(idb.stats.tx, 1, 'one transaction, created synchronously');
  assert.deepEqual(idb.stats.put, { kv: 1, tracks: 2 }, 'the changed track record + header and the pending key, queued synchronously');
  assert.match(ls.m.get(A.UNLOAD_KEY), /^\{"at":\d+,"p":/, 'emergency copy');
  await s.flush(); await new Promise(r => setTimeout(r, 10));
  assert.equal(JSON.parse(idb.data(A.DB_NAME, 'tracks').get('t:t1').j).n, 2);
  assert.equal(ls.m.get(A.UNLOAD_KEY), undefined, 'removed once the transaction committed');
  s.saveNow({ name: 'p', tracks: [{ id: 't1', n: 2 }, { id: 't2', n: 1 }] });
  assert.equal(idb.stats.tx, 1, 'nothing changed: no transaction');
  // a transaction that never commits (here: aborted) — the next run adopts the emergency copy
  idb.budget = idb.bytes(A.DB_NAME) + 20;
  s.saveNow({ name: 'p', tracks: [{ id: 't1', n: 3, pad: 'x'.repeat(200) }, { id: 't2', n: 1 }] });
  await new Promise(r => setTimeout(r, 20));
  assert.ok(ls.m.get(A.UNLOAD_KEY), 'the copy stays');
  idb.budget = Infinity;
  await s.close();
  const s2 = await A.openAppStore({ ls, idb, bc: null, now });
  assert.equal(JSON.parse(s2.loadProject()).tracks[0].n, 3, 'adopted');
  assert.ok(s2.info().resynced.includes('synthc.project'));
  assert.equal(ls.m.get(A.UNLOAD_KEY), undefined);
  // a copy older than the database's project (its transaction committed, or later autosaves did) is dropped
  ls.setItem(A.UNLOAD_KEY, JSON.stringify({ at: 1, p: JSON.stringify({ name: 'old', tracks: [] }) }));
  await s2.close();
  const s3 = await A.openAppStore({ ls, idb, bc: null, now });
  assert.equal(JSON.parse(s3.loadProject()).tracks[0].n, 3);
  assert.equal(ls.m.get(A.UNLOAD_KEY), undefined);
  await s3.close();
  // localStorage stores: saveNow = saveProject (synchronous, as Phase 1)
  const l = A.createLocalStore({ ls: fakeStorage({}) });
  l.saveNow({ name: 'x', tracks: [] });
  assert.equal(JSON.parse(l.loadProject()).name, 'x');
});

/* ------------------------------------------------------------ SYNTH Canvas: namespace (SPEC-canvas §5.6) */
// main's data on the same origin (localhost while developing): its Phase-1 keys, its bookkeeping keys and its database
function mainOrigin() {
  const ls = fakeStorage({
    'synth.project': JSON.stringify({ name: 'main project', bpm: 99, tracks: [{ id: 't1', model: 'juno60', notes: [] }] }),
    'synth.settings': '{"os":8}', 'synth.tab': '"fx"', 'synth.user.minimoog': '[{"name":"main preset","v":{}}]',
    'synth-app.idb': '123', 'synth-app.lsat': '{"synth.tab":1}', 'synth-app.unload': '{"at":9e15,"p":"{\\"tracks\\":[]}"}',
  });
  const idb = fakeIDB();
  return { ls, idb, lsBefore: lsObj(ls) };
}
async function seedMainDb(idb) { // main's `synth-app` database with one key and a project header
  await new Promise(res => {
    const r = idb.open('synth-app', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv', { keyPath: 'k' }); r.result.createObjectStore('tracks', { keyPath: 'id' }); };
    r.onsuccess = () => {
      const t = r.result.transaction(['kv', 'tracks'], 'readwrite');
      t.objectStore('kv').put({ k: 'synth.settings', v: '{"os":2}', at: 1 });
      t.objectStore('tracks').put({ id: '#head', m: '{"name":"main db"}', keys: [], at: 1 });
      t.oncomplete = () => res();
    };
  });
  return JSON.stringify([...idb.dbs.get('synth-app').stores].map(([n, s]) => [n, [...s.data]]));
}

test('namespace: an IndexedDB canvas store never reads or writes main\'s synth-app database or synth.* / synth-app.* keys', async () => {
  const { ls, idb, lsBefore } = mainOrigin(), mainDb = await seedMainDb(idb);
  const st = await A.openAppStore({ idb, ls, bc: null, schema: 1 });
  assert.equal(st.mode, 'idb');
  assert.deepEqual([st.info().migrated, st.info().restored], [true, false], 'a first run: main\'s marker is not the canvas build\'s');
  // main's values are not seen under the callers' names …
  assert.equal(st.loadProject(), null);
  assert.equal(st.get('synth.settings', 'none'), 'none');
  assert.equal(st.get('synth.user.minimoog', null), null);
  // … and the canvas build's writes land in its own database under synthc.* names
  st.set('synth.settings', { os: 2 }); st.set('synth.tab', 'roll');
  st.saveProject({ name: 'canvas', schema: 1, tracks: [{ id: 'trk_1', notes: [] }] });
  await st.flush();
  st.saveNow({ name: 'canvas 2', schema: 1, tracks: [{ id: 'trk_1', notes: [1] }] });
  await st.flush(); await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(st.get('synth.settings'), { os: 2 });
  assert.equal(st.raw('synthc.tab'), '"roll"', 'the stored name reads the same value');
  const kv = idb.data('synth-canvas', 'kv');
  assert.deepEqual([...kv.keys()].filter(k => !k.startsWith('#')).sort(), ['synthc.settings', 'synthc.tab']);
  assert.equal(JSON.parse(idb.data('synth-canvas', 'tracks').get('#head').m).name, 'canvas 2');
  // main's database and localStorage keys untouched; the only localStorage write is the canvas marker
  assert.equal(JSON.stringify([...idb.dbs.get('synth-app').stores].map(([n, s]) => [n, [...s.data]])), mainDb);
  assert.deepEqual(ls.writes.filter(k => k !== A.IDB_MARK && !k.endsWith(A.UNLOAD_KEY)), []);
  assert.deepEqual(noMark(Object.fromEntries([...ls.m].filter(([k]) => k !== A.UNLOAD_KEY))), lsBefore);
  await st.close();
});

test('namespace: a localStorage canvas store (no IndexedDB) works on synthc.* keys only', async () => {
  const { ls, lsBefore } = mainOrigin();
  const st = await A.openAppStore({ idb: null, ls, bc: null, schema: 1 });
  assert.equal(st.mode, 'ls');
  assert.equal(st.info().stale, false, 'main\'s verified-database marker is not the canvas build\'s');
  assert.equal(st.loadProject(), null);
  assert.equal(st.get('synth.settings', 'none'), 'none');
  st.set('synth.settings', { os: 2 }); st.setRaw('synth.devsr', '44100'); st.saveProject({ name: 'canvas', schema: 1, tracks: [] }); st.saveNow({ name: 'canvas', schema: 1, tracks: [] });
  assert.deepEqual([ls.m.get('synthc.settings'), ls.m.get('synthc.devsr'), JSON.parse(ls.m.get('synthc.project')).name], ['{"os":2}', '44100', 'canvas']);
  assert.ok(ls.writes.every(k => k.startsWith('synthc.') || k.startsWith('synth-canvas.')), ls.writes.join());
  for (const [k, v] of Object.entries(lsBefore)) assert.equal(ls.m.get(k), v, k);
  assert.ok('synthc.settings' in JSON.parse(ls.m.get(A.STAMP_KEY)));
  // the Phase-1 store semantics hold under the callers' names
  const l = A.createLocalStore({ ls: fakeStorage({ 'synth.a': '1' }) });
  assert.equal(l.get('synth.a', 'd'), 'd');
  l.set('synth.a', 2);
  assert.deepEqual([l.get('synth.a'), l.raw('synth.a'), l.raw('synthc.a')], [2, '2', '2']);
});

/* ------------------------------------------------------------ SYNTH Canvas: schema gate (SPEC-canvas §5.8) */
const proj = (schema, name, n = 1) => ({ name, schema, tracks: Array.from({ length: n }, (_, i) => ({ id: 'trk_' + (i + 1), notes: [] })) });
async function seeded(p) { // a database whose autosave is project p (written by any build: no gate)
  const idb = fakeIDB(), s = await A.openAppStore({ idb, ls: fakeStorage({}), bc: null });
  s.saveProject(p); await s.flush(); await s.close();
  return idb;
}
const headOf = idb => JSON.parse(idb.data('synth-canvas', 'tracks').get('#head').m);

test('schemaOf: objects, texts, headers; odd values are 0', () => {
  assert.deepEqual([A.schemaOf({ schema: 3 }), A.schemaOf('{"name":"x","schema":2}'), A.schemaOf('{"schema":4.9}'), A.schemaOf({})], [3, 2, 4, 0]);
  for (const x of [null, undefined, 7, '7', '{bad', '[1]', '{"schema":"3"}', '{"schema":-2}', '{"schema":1e99}', { schema: NaN }, []]) assert.equal(A.schemaOf(x), 0, String(x));
});

test('schema gate: a newer autosave opens read-only and is never overwritten (IndexedDB)', async () => {
  const idb = await seeded(proj(3, 'from a newer build')), errs = [];
  const st = await A.openAppStore({ idb, ls: fakeStorage({}), bc: null, schema: 1, onError: e => errs.push(e) });
  assert.deepEqual([st.info().readOnly, st.info().newer], [true, 3]);
  assert.equal(JSON.parse(st.loadProject()).name, 'from a newer build');
  idb.resetStats();
  st.saveProject(proj(1, 'older build edit')); await st.flush();
  st.saveNow(proj(1, 'older build edit 2')); await st.flush();
  assert.deepEqual(idb.stats.put, {}, 'no project record written');
  assert.equal(headOf(idb).name, 'from a newer build');
  st.set('synth.settings', { os: 2 }); await st.flush(); // key/value writes go on
  assert.equal(idb.data('synth-canvas', 'kv').get('synthc.settings').v, '{"os":2}');
  assert.equal(errs.length, 0, 'found at open: info() only (the page reads it)');
  await st.close();
  // the same build and newer ones write it as usual; a store without the option has no gate (main's behaviour)
  for (const schema of [3, 4, undefined]) {
    const s = await A.openAppStore({ idb, ls: fakeStorage({}), bc: null, schema });
    assert.equal(s.info().readOnly, false);
    s.saveProject(proj(schema || 3, 'same or newer ' + schema)); await s.flush(); await s.close();
    assert.equal(headOf(idb).name, 'same or newer ' + schema);
  }
});

test('schema gate: a newer build writing while an older one is open — the older build\'s next autosave (or unload save) is refused', async () => {
  for (const how of ['saveProject', 'saveNow']) {
    const idb = await seeded(proj(1, 'v1')), errs = [];
    const ls = fakeStorage({});
    const old = await A.openAppStore({ idb, ls, bc: null, schema: 1, onError: e => errs.push(e) });
    old.saveProject(proj(1, 'old edit 1')); await old.flush(); // its own writes never trip the gate
    old.saveProject(proj(1, 'old edit 2')); await old.flush();
    assert.equal(old.info().readOnly, false);
    const same = await A.openAppStore({ idb, ls: fakeStorage({}), bc: null, schema: 1 }); // another tab of the same build: no gate
    same.saveProject(proj(1, 'same build tab')); await same.flush(); await same.close();
    old.saveProject(proj(1, 'old edit 3')); await old.flush();
    assert.equal(headOf(idb).name, 'old edit 3', 'an equal schema is overwritten as before');
    const nu = await A.openAppStore({ idb, ls: fakeStorage({}), bc: null, schema: 2 });
    nu.saveProject(proj(2, 'newer build', 2)); await nu.flush(); await nu.close();
    old.set('synth.tab', 'roll');
    old[how](proj(1, 'old edit 4')); await old.flush(); await new Promise(r => setTimeout(r, 20)); await old.flush();
    assert.equal(headOf(idb).name, 'newer build', how);
    assert.equal(idb.data('synth-canvas', 'tracks').size, 3, 'the newer project\'s records stay');
    assert.deepEqual([old.info().readOnly, old.info().newer, errs.length, errs[0] && errs[0].readOnly, errs[0] && errs[0].newer], [true, 2, 1, true, 2], how);
    assert.equal(idb.data('synth-canvas', 'kv').get('synthc.tab').v, '"roll"', 'the pending keys are still written');
    assert.equal(ls.m.get(A.UNLOAD_KEY), undefined, 'no emergency copy left behind');
    assert.equal(old.mode, 'idb', 'not a storage failure');
    old.saveProject(proj(1, 'old edit 5')); await old.flush();
    assert.equal(headOf(idb).name, 'newer build');
    await old.close();
  }
});

test('schema gate: localStorage stores — a newer stored project is read-only; another writer\'s newer text is never replaced; lock()', async () => {
  const errs = [], ls = fakeStorage({ 'synthc.project': JSON.stringify(proj(3, 'newer')) });
  const st = A.createLocalStore({ ls, schema: 1, onError: e => errs.push(e) });
  assert.equal(JSON.parse(st.loadProject()).name, 'newer');
  assert.deepEqual([st.info().readOnly, st.info().newer], [true, 3]);
  st.saveProject(proj(1, 'x')); st.saveNow(proj(1, 'x')); st.setRaw('synth.project', JSON.stringify(proj(1, 'x')));
  assert.equal(JSON.parse(ls.m.get('synthc.project')).name, 'newer');
  // opened on an older or equal schema: writes as usual, until another writer stores a newer project
  const ls2 = fakeStorage({ 'synthc.project': JSON.stringify(proj(1, 'mine')) });
  const s2 = A.createLocalStore({ ls: ls2, schema: 1, onError: e => errs.push(e) });
  s2.loadProject();
  s2.saveProject(proj(1, 'mine 2'));
  ls2.setItem('synthc.project', JSON.stringify(proj(1, 'same build elsewhere')));
  s2.saveProject(proj(1, 'mine 3'));
  assert.equal(JSON.parse(ls2.m.get('synthc.project')).name, 'mine 3');
  ls2.setItem('synthc.project', JSON.stringify(proj(2, 'newer elsewhere')));
  s2.saveProject(proj(1, 'mine 4'));
  assert.equal(JSON.parse(ls2.m.get('synthc.project')).name, 'newer elsewhere');
  assert.deepEqual([errs.length, errs[0].readOnly, errs[0].newer, s2.info().readOnly], [1, true, 2, true]);
  s2.set('synth.tab', 'fx');
  assert.equal(ls2.m.get('synthc.tab'), '"fx"', 'key/value writes go on');
  // lock(): a newer project file was opened — the project is not written for the rest of the session
  const s3 = A.createLocalStore({ ls: fakeStorage({}), schema: 1 });
  s3.saveProject(proj(1, 'a')); s3.lock(); s3.saveProject(proj(1, 'b'));
  assert.equal(JSON.parse(s3.loadProject()).name, 'a');
  assert.equal(s3.info().readOnly, true);
  const idb = await seeded(proj(1, 'a')), s4 = await A.openAppStore({ idb, ls: fakeStorage({}), bc: null, schema: 1 });
  s4.lock(); s4.saveProject(proj(1, 'b')); s4.saveNow(proj(1, 'c')); await s4.flush();
  assert.equal(headOf(idb).name, 'a');
  assert.equal(s4.info().readOnly, true);
  await s4.close();
});

test('saveNow(null): the pending keys only, the project left as stored and the store not locked (main.js: a newer file\'s project is the current one)', async () => {
  const idb = await seeded(proj(1, 'mine')), ls = fakeStorage({});
  const st = await A.openAppStore({ idb, ls, bc: null, schema: 1 });
  st.set('synth.tab', 'roll');
  st.saveNow(null); await st.flush(); await new Promise(r => setTimeout(r, 20)); await st.flush(); // (its own transaction, off the chain)
  assert.equal(headOf(idb).name, 'mine', 'the project untouched');
  assert.equal(idb.data('synth-canvas', 'kv').get('synthc.tab').v, '"roll"', 'the pending key written');
  assert.equal(ls.m.get(A.UNLOAD_KEY), undefined, 'no emergency copy');
  assert.equal(st.info().readOnly, false);
  st.saveProject(proj(1, 'mine 2')); await st.flush();
  assert.equal(headOf(idb).name, 'mine 2', 'the next autosave writes as usual');
  await st.close();
  const ls2 = fakeStorage({}), s2 = A.createLocalStore({ ls: ls2, schema: 1 });
  s2.saveProject(proj(1, 'a')); s2.saveNow(null); s2.set('synth.tab', 'fx');
  assert.deepEqual([JSON.parse(s2.loadProject()).name, ls2.m.get('synthc.tab'), s2.info().readOnly], ['a', '"fx"', false]);
});

test('schema gate: an older build\'s localStorage project or unload copy never replaces a newer stored project', async () => {
  // re-sync: a fallback session (no IndexedDB) of an older build saved a schema-1 project; the database holds schema 2
  const idb = fakeIDB(), ls = fakeStorage({});
  let t = 1000;
  const now = () => (t += 1000);
  const s1 = await A.openAppStore({ idb, ls, bc: null, now, schema: 2 });
  s1.saveProject(proj(2, 'newer')); await s1.close();
  // (written by a current, not a stale, fallback session — stamped later than the database: it would win on time alone)
  ls.setItem('synthc.project', JSON.stringify(proj(1, 'older fallback edit')));
  ls.setItem(A.STAMP_KEY, JSON.stringify({ 'synthc.project': 9e15 }));
  const s2 = await A.openAppStore({ idb, ls, bc: null, now, schema: 2 });
  assert.equal(JSON.parse(s2.loadProject()).name, 'newer');
  assert.deepEqual(s2.info().conflicts, ['synthc.project']);
  assert.equal(JSON.parse(s2.recovered('synth.project')).name, 'older fallback edit', 'kept as a recovery copy');
  assert.equal(idb.data('synth-canvas', 'kv').get('#rec:synthc.project').from, 'older');
  await s2.close();
  // unload copies: a schema-1 copy newer in time than a schema-2 database project is dropped, not adopted …
  ls.setItem(A.UNLOAD_KEY, JSON.stringify({ at: 9e15, p: JSON.stringify(proj(1, 'old unload')) }));
  const s3 = await A.openAppStore({ idb, ls, bc: null, now, schema: 2 });
  assert.equal(JSON.parse(s3.loadProject()).name, 'newer');
  assert.equal(ls.m.get(A.UNLOAD_KEY), undefined);
  await s3.close();
  // … and a schema-3 copy is left for the build that wrote it (this schema-2 build neither adopts nor drops it)
  ls.setItem(A.UNLOAD_KEY, JSON.stringify({ at: 9e15, p: JSON.stringify(proj(3, 'newest unload')) }));
  const s4 = await A.openAppStore({ idb, ls, bc: null, now, schema: 2 });
  assert.equal(JSON.parse(s4.loadProject()).name, 'newer');
  assert.ok(ls.m.get(A.UNLOAD_KEY));
  await s4.close();
  const s5 = await A.openAppStore({ idb, ls, bc: null, now, schema: 3 });
  assert.equal(JSON.parse(s5.loadProject()).name, 'newest unload', 'adopted by a build that understands it');
  await s5.close();
});
