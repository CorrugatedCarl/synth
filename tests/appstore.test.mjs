// appstore.js tests (owner I; SPEC-serum2 §12.6 storage B21, §15.13, lead sign-off on §0.8 item 7).
// Run: node --test tests/appstore.test.mjs
//  - createLocalStore is the Phase-1 main.js store (behaviour compared with a verbatim copy of the Phase-1 object);
//  - openAppStore over a fake IndexedDB: first-run migration of a realistic Phase-1 localStorage snapshot (copied,
//    read back and verified; localStorage never written or deleted), fallback to localStorage whenever IndexedDB is
//    unavailable or fails, per-track autosave (only changed track records rewritten), quota notices, re-sync of keys
//    written by a localStorage-mode session, cross-tab refresh.
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
    'synth.project': S.serialize(proj),
    'synth.settings': JSON.stringify({ sr: 0, os: 4, drift: 5, master: 0.8, model: 'serum', vel: 100 }),
    'synth.v.minimoog': JSON.stringify(proj.tracks[2].vals),
    'synth.v.juno60': JSON.stringify(proj.tracks[4].vals),
    'synth.v.dx7': '{"broken', // an unparsable value is copied verbatim (get() keeps returning the default)
    'synth.user.minimoog': JSON.stringify([{ name: 'Fat bass', v: proj.tracks[2].vals }, { name: 'Lead “β”', v: {} }]),
    'synth.user.serum': JSON.stringify(sx.map((p, i) => ({ name: 'Mine ' + i, cat: 'User', v: { s: p.v.s }, fx: P1.defaultFx() }))),
    'synth.seq303': JSON.stringify(proj.tracks[3].seq || { pat: [] }),
    'synth.sx.prefs': JSON.stringify({ tooltips: 1, dblClick: 'type', wheel: 1, view3d: 1, defOs: 4, author: 'Ü' }),
    'synth.sx.browser': JSON.stringify({ cat: 'Bass', sort: 'name', fav: ['f:Init'] }),
    'synth.sx.shapes': JSON.stringify([{ name: 'tri', pts: [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]] }]),
    'synth.sx.wte': JSON.stringify({ split: 2048 }),
    'synth.sx.formulas': JSON.stringify(['sin(x*pi)']),
    'synth.fxchains': JSON.stringify(P1.FACTORY_CHAINS.chains.slice(0, 2)),
    'synth.fxmod.rev': JSON.stringify([{ name: 'Big', p: { size: 0.9 } }]),
    'synth.tab': JSON.stringify('roll'),
    'synth.kbHidden': 'true',
    'synth.devsr': '48000',
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
  assert.equal(A.DB_NAME, 'synth-app');
  assert.equal(A.DB_VER, 1);
  assert.equal(A.QUOTA_NOTICE, 'Storage full — the project was not saved');
  assert.equal(A.PROJECT_KEY, 'synth.project');
  assert.ok(A.isAppKey('synth.v.dx7') && A.isAppKey('synth.project') && !A.isAppKey(A.STAMP_KEY) && !A.isAppKey('#meta') && !A.isAppKey(null));
  const src = readFileSync(new URL('../appstore.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m, 'appstore.js imports nothing');
});

test('createLocalStore ≡ the Phase-1 main.js store (same results, same localStorage contents)', () => {
  const circ = {}; circ.self = circ;
  const proj = p1Project();
  const ops = [
    ['get', 'synth.none', 7], ['set', 'synth.a', { x: [1, 2, 'é'] }], ['get', 'synth.a', null], ['raw', 'synth.a'],
    ['setRaw', 'synth.b', ''], ['get', 'synth.b', 'dflt'], ['setRaw', 'synth.c', '{bad'], ['get', 'synth.c', 'dflt'],
    ['set', 'synth.d', undefined], ['raw', 'synth.d'], ['get', 'synth.d', 3], ['set', 'synth.e', circ], ['raw', 'synth.e'],
    ['set', 'synth.f', 0], ['get', 'synth.f', 9], ['set', 'synth.g', false], ['get', 'synth.g', true], ['setRaw', 'synth.h', 12],
    ['raw', 'synth.h'], ['raw', 'synth.none'], ['project', proj], ['load'],
  ];
  const runOn = (st, ls) => {
    const out = [];
    for (const [op, k, v] of ops) {
      if (op === 'project') { st === P1_STORE ? st.setRaw('synth.project', S.serialize(k)) : st.saveProject(k); out.push(null); }
      else if (op === 'load') out.push(st === P1_STORE ? st.raw('synth.project') : st.loadProject());
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
    assert.equal(ls2.m.get('synth.project'), S.serialize(proj));
    assert.equal(mine.mode, 'ls');
    assert.equal(ls2.m.has(A.STAMP_KEY), false, 'no bookkeeping key without the stamp option');
    // unavailable / full storage: defaults, null, silence (no onError given)
    ls1.broken = true; ls2.broken = true;
    globalThis.localStorage = ls1;
    const a = [P1_STORE.get('synth.a', 5), P1_STORE.raw('synth.a'), P1_STORE.set('synth.z', 1), P1_STORE.setRaw('synth.z', 'x')];
    globalThis.localStorage = ls2;
    assert.deepEqual([mine.get('synth.a', 5), mine.raw('synth.a'), mine.set('synth.z', 1), mine.setRaw('synth.z', 'x')], a);
    assert.equal(mine.loadProject(), null);
    delete globalThis.localStorage;
    assert.equal(mine.get('synth.a', 5), 5); // no localStorage at all
    assert.doesNotThrow(() => mine.set('synth.a', 1));
  } finally { delete globalThis.localStorage; }
});

test('createLocalStore: quota errors call onError with the notice; stamp option records write times', async () => {
  const errs = [], ls = fakeStorage({}, { quota: 200 });
  let t = 1000;
  const st = A.createLocalStore({ ls, onError: e => errs.push(e), stamp: true, now: () => t });
  st.set('synth.small', 1);
  t = 2000;
  st.saveProject({ tracks: [{ id: 'trk_1', notes: 'x'.repeat(400) }] });
  assert.equal(errs.length, 1);
  assert.deepEqual([errs[0].key, errs[0].quota, errs[0].notice, errs[0].fallback], ['synth.project', true, A.QUOTA_NOTICE, false]);
  assert.equal(st.loadProject(), null);
  assert.deepEqual(JSON.parse(ls.m.get(A.STAMP_KEY)), { 'synth.small': 1000 });
  ls.broken = true;
  st.set('synth.small', 2);
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
    assert.equal(st.loadProject(), snap['synth.project']);
    assert.deepEqual(st.get('synth.sx.prefs', null), JSON.parse(snap['synth.sx.prefs']));
    assert.deepEqual(lsObj(ls), snap, 'nothing written while opening');
    st.set('synth.tab', 'fx');
    assert.equal(ls.m.get('synth.tab'), '"fx"'); // works on localStorage exactly as in Phase 1 (plus the write time)
    assert.ok('synth.tab' in JSON.parse(ls.m.get(A.STAMP_KEY)));
  }
});

test('first run: a realistic Phase-1 localStorage is migrated, read back, verified; localStorage untouched', async () => {
  const snap = p1Snapshot(), ls = fakeStorage(snap), idb = fakeIDB();
  const st = await A.openAppStore({ idb, ls, bc: null, now: () => 5000 });
  assert.equal(st.mode, 'idb');
  assert.deepEqual(st.info(), { mode: 'idb', reason: 'idb', migrated: true, resynced: [], conflicts: [], stale: false, restored: false });
  // every app key reads back exactly; the other app's key is not copied
  for (const k of appKeys(snap)) {
    if (k === 'synth.project') continue;
    assert.equal(st.raw(k), snap[k], k);
    assert.deepEqual(st.get(k, 'dflt'), (() => { try { return JSON.parse(snap[k]); } catch { return 'dflt'; } })(), k);
  }
  assert.equal(st.raw('other.site.key'), null);
  assert.ok(A.sameJSON(st.loadProject(), snap['synth.project']));
  assert.ok(A.sameJSON(st.raw('synth.project'), snap['synth.project']));
  assert.deepEqual(JSON.parse(st.loadProject()), JSON.parse(snap['synth.project']));
  assert.equal(S.deserialize(st.loadProject()).tracks.length, 7); // song.deserialize (main.js loadProject) accepts it
  // localStorage: no app key written, nothing deleted (the read-only fallback); only the marker of a verified database
  assert.deepEqual(ls.writes, [A.IDB_MARK]);
  assert.deepEqual(noMark(lsObj(ls)), snap);
  assert.equal(ls.m.get(A.IDB_MARK), '5000');
  // database layout
  const kv = idb.data('synth-app', 'kv'), tr = idb.data('synth-app', 'tracks');
  assert.deepEqual([...kv.keys()].filter(A.isAppKey).sort(), appKeys(snap).filter(k => k !== 'synth.project').sort());
  assert.equal(kv.get('#meta').v.state, 'ok');
  assert.deepEqual(kv.get('synth.devsr'), { k: 'synth.devsr', v: '48000', at: 5000 });
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
  assert.ok(A.sameJSON(st2.loadProject(), snap['synth.project']));
  assert.equal(st2.raw('synth.user.serum'), snap['synth.user.serum']);
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
  idb.corrupt = (store, v) => (store === 'kv' && v.k === 'synth.user.serum' ? Object.assign(v, { v: v.v.slice(0, -1) }) : v);
  const [st, why] = await quiet();
  assert.equal(st.mode, 'ls');
  assert.match(why, /migrated key differs: synth\.user\.serum/);
  assert.equal(st.raw('synth.user.serum'), snap['synth.user.serum']);
  assert.notEqual(idb.data('synth-app', 'kv').get('#meta').v.state, 'ok');
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
  assert.equal(st3.raw('synth.user.serum'), snap['synth.user.serum']);
  assert.ok(A.sameJSON(st3.loadProject(), snap['synth.project']));
  await st3.close();
});

test('an empty localStorage (new user) migrates to an empty database', async () => {
  const ls = fakeStorage({ 'other.key': '1' }), idb = fakeIDB();
  const st = await A.openAppStore({ idb, ls, bc: null });
  assert.equal(st.mode, 'idb');
  assert.equal(st.loadProject(), null);
  assert.equal(st.get('synth.settings', 'd'), 'd');
  st.saveProject(S.newProject({ model: 'minimoog' }));
  st.set('synth.settings', { os: 2 });
  await st.flush();
  assert.deepEqual(noMark(lsObj(ls)), { 'other.key': '1' });
  assert.equal(idb.data('synth-app', 'tracks').size, 2);
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
  assert.equal(JSON.parse(idb.data('synth-app', 'tracks').get('t:trk_3').j).notes.length, p.tracks[2].notes.length);

  idb.resetStats();
  p.bpm = 128; st.saveProject(p); await st.flush(); // project fields only
  assert.equal(tracksPut(), 1);

  idb.resetStats();
  p.tracks.push(S.newTrack(p, { model: 'dx7' })); st.saveProject(p); await st.flush(); // add a track
  assert.equal(tracksPut(), 2);

  idb.resetStats();
  const gone = p.tracks.splice(1, 1)[0]; st.saveProject(p); await st.flush(); // delete one
  assert.deepEqual([tracksPut(), tracksDel()], [1, 1]);
  assert.equal(idb.data('synth-app', 'tracks').has('t:' + gone.id), false);

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
  st.set('synth.tab', 'fx'); st.set('synth.kbHidden', false); st.setRaw('synth.devsr', '96000');
  assert.equal(st.get('synth.tab'), 'fx');
  assert.equal(st.get('synth.kbHidden', true), false);
  assert.equal(st.raw('synth.devsr'), '96000');
  const o = st.get('synth.sx.prefs'); o.author = 'changed'; // returned values are copies
  assert.equal(st.get('synth.sx.prefs').author, 'Ü');
  await st.flush();
  assert.equal(idb.stats.tx, 1);
  assert.equal(idb.data('synth-app', 'kv').get('synth.tab').v, '"fx"');
  assert.deepEqual(noMark(lsObj(ls)), snap);
  st.setRaw('synth.project', S.serialize(S.newProject({ model: 'juno60' }))); // the project key maps to the autosave
  await st.flush();
  assert.equal(S.deserialize(st.raw('synth.project')).tracks[0].model, 'juno60');
  await st.close();
});

test('quota errors raise the notice and keep the store on IndexedDB; failed writes are retried', async () => {
  const snap = p1Snapshot(), idb = fakeIDB(), errs = [];
  const st = await A.openAppStore({ idb, ls: fakeStorage(snap), bc: null, onError: e => errs.push(e) });
  idb.budget = idb.bytes('synth-app') + 500;
  st.set('synth.user.minimoog', [{ name: 'huge', v: { pad: 'x'.repeat(5000) } }]);
  await st.flush();
  assert.equal(errs.length, 1);
  assert.deepEqual([errs[0].quota, errs[0].notice, errs[0].fallback, errs[0].key], [true, A.QUOTA_NOTICE, false, 'synth.user.minimoog']);
  assert.equal(st.mode, 'idb');
  assert.equal(st.get('synth.user.minimoog')[0].name, 'huge'); // the session keeps the value
  const p = JSON.parse(snap['synth.project']); p.tracks[0].notes = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, t: i * 10, d: 5, n: 60, v: 90 }));
  st.saveProject(p);
  await st.flush();
  assert.equal(errs.length, 2);
  assert.deepEqual([errs[1].notice, errs[1].key], [A.QUOTA_NOTICE, 'synth.project']);
  // space again: the next write also stores the failed key; the project is retried by the next autosave
  idb.budget = Infinity;
  st.set('synth.tab', 'roll');
  st.saveProject(p);
  await st.flush();
  assert.equal(errs.length, 2);
  assert.equal(JSON.parse(idb.data('synth-app', 'kv').get('synth.user.minimoog').v)[0].name, 'huge');
  assert.equal(JSON.parse(idb.data('synth-app', 'tracks').get('t:trk_1').j).notes.length, 300);
  await st.close();
});

test('IndexedDB failing during a session: the store degrades to localStorage with the whole state', async () => {
  const snap = p1Snapshot(), ls = fakeStorage(snap), idb = fakeIDB(), errs = [];
  let t = 10;
  const st = await A.openAppStore({ idb, ls, bc: null, onError: e => errs.push(e), now: () => t });
  st.set('synth.tab', 'fx');
  await st.flush();
  t = 20;
  idb.failTx = () => true; // e.g. Safari "connection to the database server lost"
  st.set('synth.settings', { os: 8 });
  await st.flush();
  assert.equal(st.mode, 'ls');
  assert.deepEqual([errs.length, errs[0].fallback, errs[0].notice], [1, true, null]);
  assert.equal(ls.m.get('synth.tab'), '"fx"'); // the cached state went to localStorage
  assert.equal(ls.m.get('synth.settings'), '{"os":8}');
  assert.ok(A.sameJSON(ls.m.get('synth.project'), snap['synth.project']));
  const stamps = JSON.parse(ls.m.get(A.STAMP_KEY));
  assert.equal(stamps['synth.tab'], 20);
  assert.ok(ls.writes.every(w => !w.startsWith('-')), 'nothing deleted from localStorage');
  st.set('synth.kbHidden', true); // later writes: localStorage
  assert.equal(ls.m.get('synth.kbHidden'), 'true');
  assert.equal(st.get('synth.kbHidden'), true);
  assert.equal(st.get('synth.user.serum').length, 3);
  await st.close();
});

test('later runs re-sync keys written by a localStorage-mode session (three-way, recovery copies)', async () => {
  const snap = p1Snapshot(), idb = fakeIDB();
  let t = 1000;
  const now = () => t;
  // session 1 (IndexedDB): migrates, then edits synth.v.juno60 and synth.sx.browser
  const s1 = await A.openAppStore({ idb, ls: fakeStorage(snap), bc: null, now });
  t = 2000;
  s1.set('synth.v.juno60', { idb: 1 }); s1.set('synth.sx.browser', { idb: 1 });
  await s1.close();
  // session 2 (IndexedDB unavailable): works on the old localStorage copies
  const ls = fakeStorage(snap);
  const s2 = await A.openAppStore({ idb: null, ls, bc: null, now });
  t = 3000;
  s2.set('synth.tab', 'fx');                   // only localStorage changed → copied in
  s2.set('synth.v.juno60', { ls: 1 });         // both changed, localStorage newer (stamped) → localStorage wins
  const p = JSON.parse(snap['synth.project']); p.name = 'Edited offline';
  s2.saveProject(p);                           // the project too
  s2.set('synth.new.key', [1]);                // a new key → copied in
  ls.m.set('synth.sx.browser', '{"old":1}');   // both changed, no write time (e.g. an old Phase-1 tab) → IndexedDB wins
  // session 3 (IndexedDB again)
  t = 4000;
  const s3 = await A.openAppStore({ idb, ls, bc: null, now });
  const info = s3.info();
  assert.equal(info.migrated, false);
  assert.deepEqual(info.resynced.sort(), ['synth.new.key', 'synth.project', 'synth.tab', 'synth.v.juno60']);
  assert.deepEqual(info.conflicts.sort(), ['synth.sx.browser', 'synth.v.juno60']);
  assert.equal(s3.get('synth.tab'), 'fx');
  assert.deepEqual(s3.get('synth.v.juno60'), { ls: 1 });
  assert.deepEqual(s3.get('synth.sx.browser'), { idb: 1 });
  assert.deepEqual(s3.get('synth.new.key'), [1]);
  assert.equal(S.deserialize(s3.loadProject()).name, 'Edited offline');
  const kv = idb.data('synth-app', 'kv');
  assert.deepEqual([kv.get('#rec:synth.v.juno60').v, kv.get('#rec:synth.v.juno60').from], ['{"idb":1}', 'idb']);
  assert.deepEqual([kv.get('#rec:synth.sx.browser').v, kv.get('#rec:synth.sx.browser').from], ['{"old":1}', 'ls']);
  assert.equal(s3.raw('#rec:synth.sx.browser'), null); // recovery copies are not app keys
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
  a.set('synth.user.minimoog', [{ name: 'from A', v: {} }]);
  await a.flush();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(b.get('synth.user.minimoog')[0].name, 'from A');
  await a.close(); await b.close();
  assert.ok(chans.every(c => c.closed));
});

test('IndexedDB → a session that cannot open it → IndexedDB: the fallback runs on the older copy with a notice, and its edits never replace the database (kept as recovery copies)', async () => {
  const proj = name => JSON.stringify({ name, bpm: 120, tracks: [{ id: 't1', model: 'minimoog', notes: [] }] });
  const ls = fakeStorage({ 'synth.project': proj('phase-1 project'), 'synth.settings': '{"os":4}', 'synth.tab': '"roll"' }), idb = fakeIDB(), errs = [];
  let t = 1000;
  const now = () => (t += 1000), warn = console.warn;
  // session 1 (IndexedDB): migrates, then the user works
  let s = await A.openAppStore({ ls, idb, bc: null, now, onError: e => errs.push(e) });
  assert.ok(ls.m.get(A.IDB_MARK), 'a verified database is marked in localStorage');
  s.saveProject(proj('weeks of work in IndexedDB')); s.set('synth.settings', { os: 2 });
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
  s.saveProject(proj('phase-1 project + one edit')); s.set('synth.tab', 'fx'); s.set('synth.new', 1);
  assert.ok('synth.project' in JSON.parse(ls.m.get(A.STALE_KEY)), 'stale write times');
  assert.equal(ls.m.get(A.STAMP_KEY), undefined);
  // session 3 (IndexedDB again): the database keeps its values; the fallback session's texts are recovery copies
  errs.length = 0;
  s = await A.openAppStore({ ls, idb, bc: null, now, onError: e => errs.push(e) });
  const info = s.info();
  assert.equal(JSON.parse(s.loadProject()).name, 'weeks of work in IndexedDB');
  assert.deepEqual(s.get('synth.settings'), { os: 2 });
  assert.equal(s.get('synth.tab'), 'roll', 'a key only the stale session changed does not replace the database value either');
  assert.equal(s.get('synth.new'), 1, 'a key the database does not have is taken');
  assert.deepEqual(info.conflicts.sort(), ['synth.project', 'synth.tab']);
  assert.equal(JSON.parse(s.recovered('synth.project')).name, 'phase-1 project + one edit');
  assert.equal(s.recovered('synth.tab'), '"fx"');
  assert.equal(idb.data('synth-app', 'kv').get('#rec:synth.project').from, 'stale');
  assert.equal(errs.length, 0);
  await s.close();
  // a degraded IndexedDB session (current data) writes plain stamps and clears the stale marks of what it writes
  const ls2 = fakeStorage(lsObj(ls)), idb3 = fakeIDB();
  const st = await A.openAppStore({ ls: ls2, idb: idb3, bc: null, now, onError: () => {} });
  idb3.failTx = () => true;
  st.set('synth.tab', 'arp');
  await st.flush();
  assert.equal(st.mode, 'ls');
  assert.equal('synth.tab' in JSON.parse(ls2.m.get(A.STALE_KEY)), false);
  assert.ok('synth.tab' in JSON.parse(ls2.m.get(A.STAMP_KEY)));
  await st.close();
  // the database gone (evicted / deleted) while localStorage keeps the marker: migrated again, with a notice
  errs.length = 0;
  s = await A.openAppStore({ ls, idb: fakeIDB(), bc: null, now, onError: e => errs.push(e) });
  assert.deepEqual([s.info().migrated, s.info().restored, errs.length, errs[0] && errs[0].notice], [true, true, 1, A.RESTORED_NOTICE]);
  await s.close();
});

test('saveNow (pagehide / beforeunload / hidden): the project and pending keys go into one transaction created in the caller\'s task; an emergency copy covers a transaction that never commits', async () => {
  const ls = fakeStorage({ 'synth.settings': '{"os":4}' }), idb = fakeIDB(), errs = [];
  let t = 100;
  const now = () => (t += 10);
  const s = await A.openAppStore({ ls, idb, bc: null, now, onError: e => errs.push(e) });
  s.saveProject({ name: 'p', tracks: [{ id: 't1', n: 1 }, { id: 't2', n: 1 }] });
  await s.flush();
  idb.resetStats();
  // the unload handler: synchronous, then the page may be gone (no later task)
  s.set('synth.settings', { os: 2 });
  s.saveNow({ name: 'p', tracks: [{ id: 't1', n: 2 }, { id: 't2', n: 1 }] });
  assert.equal(idb.stats.tx, 1, 'one transaction, created synchronously');
  assert.deepEqual(idb.stats.put, { kv: 1, tracks: 2 }, 'the changed track record + header and the pending key, queued synchronously');
  assert.match(ls.m.get(A.UNLOAD_KEY), /^\{"at":\d+,"p":/, 'emergency copy');
  await s.flush(); await new Promise(r => setTimeout(r, 10));
  assert.equal(JSON.parse(idb.data('synth-app', 'tracks').get('t:t1').j).n, 2);
  assert.equal(ls.m.get(A.UNLOAD_KEY), undefined, 'removed once the transaction committed');
  s.saveNow({ name: 'p', tracks: [{ id: 't1', n: 2 }, { id: 't2', n: 1 }] });
  assert.equal(idb.stats.tx, 1, 'nothing changed: no transaction');
  // a transaction that never commits (here: aborted) — the next run adopts the emergency copy
  idb.budget = idb.bytes('synth-app') + 20;
  s.saveNow({ name: 'p', tracks: [{ id: 't1', n: 3, pad: 'x'.repeat(200) }, { id: 't2', n: 1 }] });
  await new Promise(r => setTimeout(r, 20));
  assert.ok(ls.m.get(A.UNLOAD_KEY), 'the copy stays');
  idb.budget = Infinity;
  await s.close();
  const s2 = await A.openAppStore({ ls, idb, bc: null, now });
  assert.equal(JSON.parse(s2.loadProject()).tracks[0].n, 3, 'adopted');
  assert.ok(s2.info().resynced.includes('synth.project'));
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
