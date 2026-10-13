// wtstore.js unit tests (spec §10.3 item 13, §10.6 import check). Run: node --test tests/wtstore.test.mjs
// The IndexedDB backend is exercised against a minimal in-file fake (node has no IndexedDB).
import './v8-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, openStore } from '../wtstore.js';
import { FRAME, factoryTable, frameToNoise, makeNoise, noiseEntry, encodeEmbedded, decodeEmbedded } from '../wt.js';

const DAY = 86400000;

async function suite(store, clock) {
  const table = factoryTable('factory:Basic Shapes');
  const id1 = await store.put(table, { name: 'Shapes copy' });
  assert.match(id1, /^user:[0-9a-f-]{36}$/);
  const got = await store.get(id1);
  assert.equal(got.name, 'Shapes copy');
  assert.equal(got.morph, 1);
  assert.equal(got.factory, 0);
  assert.equal(got.frames.length, 6);
  got.frames.forEach((f, i) => { assert.ok(f instanceof Float32Array); assert.equal(f.length, FRAME); assert.deepEqual(f, table.frames[i]); });
  got.frames[0][0] = 99; // returned objects are copies
  assert.notEqual((await store.get(id1)).frames[0][0], 99);

  // noise: a frameToNoise result, a stereo record with ArrayBuffers, an entry (level 0 stored)
  clock.t += 1000;
  const id2 = await store.put(frameToNoise(table.frames[2], 'Saw cycle'), {});
  assert.match(id2, /^nzuser:/);
  const n2 = await store.get(id2);
  assert.deepEqual([n2.kind, n2.name, n2.ch, n2.len, n2.loopStart, n2.loopEnd, n2.root, n2.R], ['noise', 'Saw cycle', 1, 2048, 0, 2048, 60, null]);
  assert.ok(n2.L instanceof ArrayBuffer);
  assert.deepEqual(new Float32Array(n2.L), table.frames[2]);
  assert.ok(Math.abs(n2.rate - 2048 * 261.6255653) < 1e-3);
  const entry = noiseEntry(n2);
  assert.equal(entry.kind, 'noise'); assert.equal(entry.levels.length, 6);

  clock.t += 1000;
  const vinyl = makeNoise('noise:Vinyl Crackle');
  const id3 = await store.put(vinyl, { name: 'Crackle' });
  const n3 = await store.get(id3);
  assert.deepEqual([n3.ch, n3.len, n3.rate], [2, vinyl.len, 48000]);
  assert.deepEqual(new Float32Array(n3.R), vinyl.levels[0].R);

  // list: sorted by name, kind filter, seconds/frames
  clock.t += 1000;
  const id4 = await store.put({ name: 'alpha', frames: [new Float32Array(FRAME).fill(0.5)], morph: 0, factory: 0 }, {});
  const all = await store.list();
  assert.deepEqual(all.map(r => r.name), ['alpha', 'Crackle', 'Saw cycle', 'Shapes copy']);
  const wts = await store.list({ kind: 'wt' });
  assert.deepEqual(wts.map(r => r.id), [id4, id1]);
  assert.deepEqual(wts.map(r => r.frames), [1, 6]);
  const nz = await store.list({ kind: 'noise' });
  assert.deepEqual(nz.map(r => r.id), [id3, id2]);
  assert.ok(Math.abs(nz[1].seconds - 2048 / (2048 * 261.6255653)) < 1e-9);
  assert.ok(all.every(r => typeof r.modified === 'number'));

  // put with an explicit id overwrites (created kept, modified updated); a Table never reuses its own id
  clock.t += 1000;
  const before = await store.get(id1);
  assert.equal(await store.put(Object.assign({}, before, { frames: before.frames.slice(0, 2) }), { id: id1 }), id1);
  assert.equal((await store.get(id1)).frames.length, 2);
  const fresh = await store.put(before, { name: 'Again' });
  assert.notEqual(fresh, id1);
  await store.del(fresh);

  // embedded records (project import) keep their id
  const rec = { id: 'user:embedded-1', kind: 'wt', name: 'Emb', frames: 1, morph: 0, data: new Float32Array(FRAME).fill(0.25).buffer, created: 5, modified: 6 };
  const dec = decodeEmbedded(JSON.parse(JSON.stringify(encodeEmbedded(rec))));
  assert.equal(await store.put(dec, {}), 'user:embedded-1');
  assert.equal((await store.get('user:embedded-1')).frames[0][100], 0.25);
  await store.del('user:embedded-1');

  // rename, del
  assert.equal(await store.rename(id4, 'zeta'), true);
  assert.equal((await store.get(id4)).name, 'zeta');
  assert.equal(await store.rename('user:none', 'x'), false);
  assert.equal((await store.list()).at(-1).name, 'zeta');
  await store.del(id4);
  assert.equal(await store.get(id4), null);
  assert.equal((await store.list()).length, 3);

  // gc: keeps listed ids and anything newer than 7 days
  clock.t += 8 * DAY;
  const young = await store.put(table, { name: 'young' });
  const n = await store.gc([id1]);
  assert.equal(n, 2);
  assert.deepEqual((await store.list()).map(r => r.id).sort(), [id1, young].sort());
  assert.equal(await store.gc(new Set()), 1);
  assert.deepEqual((await store.list()).map(r => r.id), [young]);

  await assert.rejects(store.put(null, {}));
  await assert.rejects(store.put({ name: 'empty', frames: [] }, {}));
}

test('13 memoryStore: put / get / list / rename / del / gc', async () => {
  const clock = { t: Date.UTC(2026, 0, 1) };
  await suite(memoryStore({ now: () => clock.t }), clock);
  const s = memoryStore();
  const id = await s.put(factoryTable('factory:Sine'), { name: 'n' });
  const r = (await s.list())[0];
  assert.ok(Math.abs(r.modified - Date.now()) < 5000 && r.id === id);
});

test('openStore rejects without IndexedDB (node) and module import touches no browser globals', async () => {
  assert.equal(globalThis.indexedDB, undefined);
  await assert.rejects(openStore(), /IndexedDB unavailable/);
});

/* ------------------------------------------------------------ minimal fake IndexedDB */
function fakeIDB() {
  const dbs = new Map(); // name → { version, stores: Map(name → { keyPath, indexes: Map(name → keyPath), data: Map }) }
  const later = fn => setTimeout(fn, 0);
  class Req { constructor(tx) { this.transaction = tx; this.result = undefined; this.error = null; } }
  function makeTx(db, names) {
    const tx = { error: null, pending: 0, oncomplete: null, onerror: null, onabort: null };
    const settle = () => { if (--tx.pending === 0) later(() => tx.oncomplete && tx.oncomplete()); };
    const run = fn => { const r = new Req(tx); tx.pending++; later(() => { try { r.result = fn(); r.onsuccess && r.onsuccess(); } catch (e) { r.error = e; r.onerror && r.onerror(); } settle(); }); return r; };
    tx.objectStore = name => {
      if (!names.includes(name)) throw new Error('NotFoundError');
      const st = db.stores.get(name);
      return {
        get: k => run(() => (st.data.has(k) ? structuredClone(st.data.get(k)) : undefined)),
        put: v => run(() => { st.data.set(v[st.keyPath], structuredClone(v)); return v[st.keyPath]; }),
        delete: k => run(() => { st.data.delete(k); }),
        getAll: () => run(() => Array.from(st.data.values(), v => structuredClone(v))),
        index: n => ({ getAll: q => run(() => Array.from(st.data.values()).filter(v => v[st.indexes.get(n)] === q).map(v => structuredClone(v))) }),
      };
    };
    return tx;
  }
  return {
    dbs,
    open(name, version) {
      const r = new Req(null);
      later(() => {
        let d = dbs.get(name);
        const upgrade = !d || d.version < version;
        if (!d) { d = { version, stores: new Map() }; dbs.set(name, d); }
        const db = {
          objectStoreNames: { contains: n => d.stores.has(n) },
          createObjectStore(n, o) {
            const st = { keyPath: o.keyPath, indexes: new Map(), data: new Map() };
            d.stores.set(n, st);
            return { createIndex: (iname, kp) => { st.indexes.set(iname, kp); } };
          },
          transaction: (names, mode) => makeTx(d, [].concat(names), mode),
          close() { this.closed = true; },
          stores: d.stores,
        };
        r.result = db;
        if (upgrade) { d.version = version; r.onupgradeneeded && r.onupgradeneeded(); }
        r.onsuccess && r.onsuccess();
      });
      return r;
    },
  };
}

test('openStore over IndexedDB: schema (synth-wt v1, store tables, index kind) and the same API', async () => {
  const idb = fakeIDB();
  globalThis.indexedDB = idb;
  try {
    const clock = { t: Date.UTC(2026, 0, 1) };
    const store = await openStore({ now: () => clock.t });
    const d = idb.dbs.get('synth-wt');
    assert.equal(d.version, 1);
    assert.ok(d.stores.has('tables'));
    assert.equal(d.stores.get('tables').keyPath, 'id');
    assert.equal(d.stores.get('tables').indexes.get('kind'), 'kind');
    await suite(store, clock);
    // stored record layout (§7.10)
    const recs = Array.from(d.stores.get('tables').data.values());
    const r = recs[0];
    assert.deepEqual(Object.keys(r).sort(), ['created', 'data', 'frames', 'id', 'kind', 'modified', 'morph', 'name']);
    assert.ok(r.data instanceof ArrayBuffer && r.data.byteLength === r.frames * FRAME * 4);
    const NZ_KEYS = ['L', 'R', 'ch', 'created', 'id', 'kind', 'len', 'loopEnd', 'loopStart', 'modified', 'name', 'rate', 'root'];
    const id = await store.put(frameToNoise(new Float32Array(FRAME).fill(0.1), 'nz'), {});
    const nr = d.stores.get('tables').data.get(id);
    // a frameToNoise cycle keeps its optional loopWhole flag (1 = loops over the whole file, §7.9 decimation)
    assert.deepEqual(Object.keys(nr).sort(), NZ_KEYS.concat('loopWhole').sort());
    assert.equal(nr.loopWhole, 1);
    // a record without loop information stores exactly the §7.10 fields
    const id5 = await store.put({ kind: 'noise', name: 'hit', rate: 44100, ch: 1, len: 100, loopStart: 0, loopEnd: 100, L: new Float32Array(100) }, {});
    assert.deepEqual(Object.keys(d.stores.get('tables').data.get(id5)).sort(), NZ_KEYS);
    const id6 = await store.put({ kind: 'noise', name: 'loop', len: 100, loopWhole: false, L: new Float32Array(100) }, {});
    assert.equal(d.stores.get('tables').data.get(id6).loopWhole, 0);
    store.close();
    // reopening keeps the data
    const again = await openStore();
    assert.ok((await again.list()).some(x => x.id === id));
  } finally {
    delete globalThis.indexedDB;
  }
});
