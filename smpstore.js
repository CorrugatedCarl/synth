// smpstore.js — persistence of user samples, multisamples and impulse responses, and the cache of generated content
// (owner S1; SPEC-serum2 §9.2, §9.7, §14.2). Browser ES module, node-importable: IndexedDB database `synth-smp` v1 with
// the object stores `assets` (keyPath `id`, index `kind`) and `cache` (keyPath `key`); `memoryStore()` offers the same API
// on Maps (the fallback when IndexedDB is unavailable, and the tests). Nothing touches indexedDB at module top level.
// The API mirrors wtstore.js: openStore(), memoryStore(), list({kind}), get, put(obj, {id?, name}), rename, del,
// gc(keepIds), close; plus cacheGet(key), cachePut(key, rec), cacheTrim(maxBytes = 512 MB, keep?), and (IMPL)
// has(id) (existence without reading PCM), ensureRow(id) (re-adds a record's missing menu row), cacheDrop(prefix),
// cacheTouch(key) (marks an entry used), cacheBytes(), flush() (index writes done). Rows (list) are {id, kind, name,
// created, modified} + samples / IRs {seconds, ch} (+ samples {folder}) or multisamples {zones: count, smps: the
// distinct zone sample ids}.
//
// Records (`assets`; PCM as ArrayBuffers of little-endian Float32, like wtstore's noise records)
//   sample  {id, kind: 'smp', name, folder ('' | 'Renders'), rate, ch, len, L, R | null, root, loop: {start, end} | null,
//            odf: ArrayBuffer | null, peak, src: {file, type, bytes} | null, hash, created, modified}
//   multi   {id, kind: 'multi', name, zones: [{lo, hi, vlo, vhi, root, tune, gain, pan, smp, mode, ls, le, off, env, rr, vt}],
//            src: {sfz} | null (≤ 64 KB of text), created, modified}
//   ir      {id, kind: 'ir', name, rate, ch, len, L, R | null, hash, created, modified}
// `put` accepts Float32Arrays / numeric arrays / ArrayBuffers for L, R and odf; `get` returns a copy with ArrayBuffers.
// New ids: 'smp:' / 'msmp:' / 'ir:' + uuid; an explicit {id} is kept, and so is the id of an object carrying one with
// its kind's user prefix (a record read back and stored again).
// Cache entries (`cache`): {key, rec, bytes, lastUse}; keys `gen:<asset id>@<GEN_VER>` (generated factory records, same
// shape as the records above) and `spec:<playback id>@<SPEC_VER>` (spectral analyses {N, hop, frames, mag, ph, trans}).
// Quota errors (IndexedDB QuotaExceededError, or the memory store's `quota` option): the operation rejects with
// Error('Storage full — remove unused samples') carrying `quota: true`; nothing is half-written.
import { uuid } from './wt.js?v=7';

const DB_NAME = 'synth-smp', DB_VER = 1, ASSETS = 'assets', CACHE = 'cache', WEEK = 7 * 86400000;
/** Default IndexedDB cache budget (§9.7; touch devices pass 256 MB, §14.2). */
export const CACHE_MAX = 512 * 1048576;
/** User-asset id prefixes by record kind (§9.1). */
export const PREFIX = Object.freeze({ smp: 'smp:', multi: 'msmp:', ir: 'ir:' });
export const QUOTA_TEXT = 'Storage full — remove unused samples';
const KINDS = ['smp', 'multi', 'ir'], NAMES = { smp: 'Sample', multi: 'Multisample', ir: 'Impulse Response' };
const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

const isBuf = v => v != null && !Array.isArray(v) && (v instanceof ArrayBuffer || ArrayBuffer.isView(v) || (typeof v.byteLength === 'number' && typeof v.slice === 'function'));
function f32Buffer(src) { // numeric sequence / view / ArrayBuffer of Float32 → fresh little-endian ArrayBuffer
  const a = src == null ? new Float32Array(0)
    : ArrayBuffer.isView(src) ? src
    : isBuf(src) ? new Float32Array(src.slice(0, src.byteLength - (src.byteLength & 3)))
    : Float32Array.from(src);
  if (LE) return (a instanceof Float32Array ? a.slice() : Float32Array.from(a)).buffer;
  const out = new ArrayBuffer(a.length * 4), dv = new DataView(out);
  for (let i = 0; i < a.length; i++) dv.setFloat32(i * 4, a[i], true);
  return out;
}
const copyBuf = b => (b == null ? null : ArrayBuffer.isView(b) ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b.slice(0));
const fin = (v, d) => (Number.isFinite(v) ? +v : d);
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
function deepCopy(v, depth) { // plain data with ArrayBuffers / typed arrays copied (cache records, zones)
  if (v == null || typeof v !== 'object') return v;
  if (isBuf(v)) return ArrayBuffer.isView(v) ? v.slice() : v.slice(0);
  if (depth > 6) return null;
  if (Array.isArray(v)) return v.map(x => deepCopy(x, depth + 1));
  const o = {};
  for (const k of Object.keys(v)) o[k] = deepCopy(v[k], depth + 1);
  return o;
}
function byteSize(v, depth = 0) { // Σ byteLength of the buffers in plain data
  if (v == null || typeof v !== 'object' || depth > 6) return 0;
  if (isBuf(v)) return v.byteLength;
  let n = 0;
  for (const k of Object.keys(v)) n += byteSize(v[k], depth + 1);
  return n;
}
function cloneRec(r) {
  const o = Object.assign({}, r);
  for (const k of ['L', 'R', 'odf']) if (k in o) o[k] = copyBuf(o[k]);
  if (Array.isArray(o.zones)) o.zones = o.zones.map(z => deepCopy(z, 0));
  if (o.loop) o.loop = Object.assign({}, o.loop);
  if (o.src) o.src = Object.assign({}, o.src);
  return o;
}
function peakOf(bufs) {
  let p = 0;
  for (const b of bufs) { if (!b) continue; const a = new Float32Array(b); for (let i = 0; i < a.length; i++) { const x = Math.abs(a[i]); if (x > p) p = x; } }
  return p;
}
const ZONE_MODES = ['oneshot', 'loop', 'sustain'];
function zoneOf(z) { // a multisample zone with every field present (sanitised; deep validation is SxBase's, §4.5)
  const i = (v, lo, hi, d) => { v = Math.round(fin(v, d)); return v < lo ? lo : v > hi ? hi : v; };
  const lo = i(z.lo, 0, 127, 0), vlo = i(z.vlo, 0, 127, 0);
  const env = Array.isArray(z.env) && z.env.length === 6 && z.env.every(Number.isFinite) ? z.env.slice() : null;
  let rl = 1, rp = 1;
  if (Array.isArray(z.rr) && z.rr.length === 2) { rl = i(z.rr[0], 1, 1e6, 1); rp = i(z.rr[1], 1, rl, 1); }
  return {
    lo, hi: i(z.hi, lo, 127, 127), vlo, vhi: i(z.vhi, vlo, 127, 127), root: fin(z.root, 60), tune: fin(z.tune, 0), gain: fin(z.gain, 0),
    pan: Math.max(-1, Math.min(1, fin(z.pan, 0))), smp: str(z.smp, 256), mode: ZONE_MODES.includes(z.mode) ? z.mode : 'oneshot',
    ls: Math.max(0, fin(z.ls, 0)), le: Math.max(0, fin(z.le, 0)), off: Math.max(0, fin(z.off, 0)), env, rr: [rl, rp],
    vt: Math.max(0, Math.min(1, fin(z.vt, 1))),
  };
}

// Normalised record (without id/created/modified) from any accepted input.
function toRecord(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('smpstore.put: nothing to store');
  const kind = obj.kind;
  if (!KINDS.includes(kind)) throw new Error('smpstore.put: unknown kind ' + kind);
  if (kind === 'multi') {
    const zones = Array.isArray(obj.zones) ? obj.zones.filter(z => z && typeof z === 'object').slice(0, 512).map(zoneOf) : [];
    const sfz = obj.src && typeof obj.src.sfz === 'string' ? obj.src.sfz.slice(0, 65536) : null;
    return { kind, name: obj.name, zones, src: sfz != null ? { sfz } : null };
  }
  const L = f32Buffer(obj.L), len = L.byteLength >> 2;
  if (!len) throw new Error('smpstore.put: no samples');
  const ch = obj.ch === 2 && obj.R != null ? 2 : 1;
  let R = null;
  if (ch === 2) {
    R = f32Buffer(obj.R);
    if (R.byteLength !== L.byteLength) { const r = new Float32Array(len); r.set(new Float32Array(R).subarray(0, len)); R = r.buffer; }
  }
  const rec = { kind, name: obj.name, rate: obj.rate > 0 ? +obj.rate : 48000, ch, len, L, R, hash: str(obj.hash, 64) };
  if (kind === 'smp') {
    const lp = obj.loop;
    rec.folder = obj.folder === 'Renders' ? 'Renders' : '';
    rec.root = fin(obj.root, 60);
    rec.loop = lp && Number.isFinite(lp.start) && Number.isFinite(lp.end) && lp.start >= 0 && lp.start < lp.end && lp.end <= len ? { start: +lp.start, end: +lp.end } : null;
    rec.odf = obj.odf != null ? f32Buffer(obj.odf) : null;
    rec.peak = Number.isFinite(obj.peak) && obj.peak >= 0 ? +obj.peak : peakOf([L, R]);
    const s = obj.src;
    rec.src = s && typeof s === 'object' ? { file: str(s.file, 256), type: str(s.type, 64), bytes: Math.max(0, fin(s.bytes, 0)) } : null;
  }
  return rec;
}
function row(rec) {
  const r = { id: rec.id, kind: rec.kind, name: rec.name, modified: rec.modified, created: rec.created };
  if (rec.kind === 'multi') { r.zones = rec.zones.length; r.smps = [...new Set(rec.zones.map(z => z.smp).filter(Boolean))]; }
  else { r.seconds = rec.len / (rec.rate || 48000); r.ch = rec.ch; }
  if (rec.kind === 'smp') r.folder = rec.folder || '';
  return r;
}
const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base', numeric: true }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const isQuota = err => !!err && (err.name === 'QuotaExceededError' || err.code === 22 || err.quota === true);
function quotaGuard(p) {
  return p.catch(err => {
    if (!isQuota(err)) throw err;
    const e = new Error(QUOTA_TEXT);
    e.quota = true; e.cause = err;
    throw e;
  });
}

// Store API over an async backend { get(store, key), put(store, rec), del(store, key), all(store, kind?), has(store,
// key), update(store, key, fn) }. Listing and cache budgeting never read PCM: the store keeps two small index records
// next to the data — `#rows` (assets store, kind '#meta', v ROWS_V: the menu row of every record) and `#meta` (cache
// store: [bytes, lastUse] per key). Several tabs (each with its own store instance) share one database, so the
// indexes are never held in memory: every change is applied as a delta inside one read-modify-write transaction of
// the backend (`update`), and list / cacheTrim / cacheBytes read the stored index (one small record). A missing index
// (or one of an older version) is rebuilt by one full scan (a database written by another build, or an index write
// that failed); index writes are chained per instance (flush() resolves once they are stored).
const ROWS = '#rows', META = '#meta', META_KIND = '#meta', ROWS_V = 2;
function makeStore(be, opts) {
  const now = opts && typeof opts.now === 'function' ? opts.now : () => Date.now();
  let chain = Promise.resolve();
  const later = fn => (chain = chain.then(fn).catch(err => { console.warn('smpstore index not written', err); }));
  // the stored rows index → Map (rebuilt by a full scan when missing or of an older version)
  async function rowsIdx() {
    const m = await be.get(ASSETS, ROWS).catch(() => null);
    if (m && m.v === ROWS_V && m.rows && typeof m.rows === 'object') return new Map(Object.entries(m.rows));
    const map = new Map();
    for (const r of await be.all(ASSETS)) if (r && r.kind !== META_KIND && typeof r.id === 'string') map.set(r.id, row(r));
    await be.put(ASSETS, { id: ROWS, kind: META_KIND, v: ROWS_V, rows: Object.fromEntries(map) }).catch(err => console.warn('smpstore rows not written', err));
    return map;
  }
  // one delta on the stored rows index (atomic per backend transaction); a missing index stays missing (the next
  // list() rebuilds it from the records, this change included)
  const rowsDelta = fn => later(() => be.update(ASSETS, ROWS, m => {
    if (!(m && m.v === ROWS_V && m.rows && typeof m.rows === 'object')) return undefined;
    fn(m.rows);
    return m;
  }));
  async function metaIdx() {
    const m = await be.get(CACHE, META).catch(() => null);
    if (m && m.idx && typeof m.idx === 'object') return new Map(Object.entries(m.idx));
    const map = new Map();
    for (const e of await be.all(CACHE)) if (e && e.key !== META) map.set(e.key, [e.bytes || 0, e.lastUse || 0]);
    await be.put(CACHE, { key: META, rec: null, idx: Object.fromEntries(map), bytes: 0, lastUse: 0 }).catch(err => console.warn('smpstore cache index not written', err));
    return map;
  }
  const metaDelta = fn => later(() => be.update(CACHE, META, m => {
    if (!(m && m.idx && typeof m.idx === 'object')) return undefined;
    fn(m.idx);
    return m;
  }));
  const own = id => typeof id === 'string' && id !== '' && id[0] !== '#';
  const keepOf = k => (typeof k === 'function' ? k : k instanceof Set ? x => k.has(x) : Array.isArray(k) ? x => k.includes(x) : () => false);
  const api = {
    async list(o) {
      const kind = o && o.kind;
      return [...(await rowsIdx()).values()].filter(r => !kind || r.kind === kind).map(r => Object.assign({}, r)).sort(byName);
    },
    async get(id) {
      if (!own(String(id))) return null;
      const rec = await be.get(ASSETS, String(id));
      return rec ? cloneRec(rec) : null;
    },
    // whether a record exists (no PCM is read)
    async has(id) { return own(String(id)) && !!(await be.has(ASSETS, String(id))); },
    // adds the menu row of an existing record when the rows index lacks it → whether the record exists
    async ensureRow(id) {
      if (!own(String(id))) return false;
      const rows = await rowsIdx();
      if (rows.has(String(id))) return true;
      const rec = await be.get(ASSETS, String(id));
      if (!rec) return false;
      const r = row(rec);
      await rowsDelta(m => { m[r.id] = r; });
      return true;
    },
    async put(obj, o) {
      const rec = toRecord(obj);
      let id = o && o.id ? String(o.id) : null;
      if (!id && typeof obj.id === 'string' && obj.id.startsWith(PREFIX[rec.kind])) id = obj.id; // a record read back
      if (!id) id = PREFIX[rec.kind] + uuid();
      if (!own(id)) throw new Error('smpstore.put: invalid id ' + id);
      const prev = await be.get(ASSETS, id), t = now();
      rec.id = id;
      rec.name = String((o && o.name) || rec.name || (prev && prev.name) || NAMES[rec.kind]).slice(0, 128);
      rec.created = prev && prev.created ? prev.created : t;
      rec.modified = t;
      await quotaGuard(Promise.resolve().then(() => be.put(ASSETS, rec)));
      await rowsIdx(); // an index exists before the delta (rebuilt once when missing)
      const r = row(rec);
      await rowsDelta(m => { m[id] = r; });
      return id;
    },
    async rename(id, name) {
      if (!own(String(id))) return false;
      const rec = await be.get(ASSETS, String(id));
      if (!rec) return false;
      rec.name = String(name || rec.name).slice(0, 128);
      rec.modified = now();
      await quotaGuard(Promise.resolve().then(() => be.put(ASSETS, rec)));
      const r = row(rec);
      await rowsDelta(m => { m[r.id] = r; });
      return true;
    },
    async del(id) {
      if (!own(String(id))) return false;
      await be.del(ASSETS, String(id));
      await rowsDelta(m => { delete m[String(id)]; });
      return true;
    },
    // deletes the records that no project references (keepIds) and that were not modified for a week (wtstore rule)
    async gc(keepIds) {
      const keep = keepIds instanceof Set ? keepIds : new Set(keepIds || []), limit = now() - WEEK, rows = await rowsIdx(), gone = [];
      for (const r of rows.values()) {
        if (keep.has(r.id) || !(r.modified < limit)) continue;
        await be.del(ASSETS, r.id);
        gone.push(r.id);
      }
      if (gone.length) await rowsDelta(m => { for (const k of gone) delete m[k]; });
      return gone.length;
    },
    async cacheGet(key) {
      const k = String(key);
      if (k === META) return null;
      const e = await be.get(CACHE, k);
      if (!e) return null;
      const t = now();
      metaDelta(m => { m[k] = [m[k] ? m[k][0] : e.bytes || 0, t]; }); // the use time lives in the index (no rewrite of the entry)
      return deepCopy(e.rec, 0);
    },
    // marks a cache entry as used now (a record served from a caller's own memory copy) → whether it is indexed
    async cacheTouch(key) {
      const k = String(key), t = now();
      if (k === META) return false;
      let hit = false;
      await metaDelta(m => { if (m[k]) { m[k] = [m[k][0], t]; hit = true; } });
      return hit;
    },
    async cachePut(key, rec) {
      const k = String(key);
      if (k === META) throw new Error('smpstore.cachePut: reserved key');
      const e = { key: k, rec: deepCopy(rec, 0), bytes: byteSize(rec), lastUse: now() };
      await quotaGuard(Promise.resolve().then(() => be.put(CACHE, e)));
      await metaIdx(); // an index exists before the delta (rebuilt once when missing)
      await metaDelta(m => { m[k] = [e.bytes, e.lastUse]; });
      return e.bytes;
    },
    // removes the cache entries whose key starts with `prefix` → number removed
    async cacheDrop(prefix) {
      const p = String(prefix), gone = [];
      for (const k of (await metaIdx()).keys()) if (k.startsWith(p)) { await be.del(CACHE, k); gone.push(k); }
      if (gone.length) await metaDelta(m => { for (const k of gone) delete m[k]; });
      return gone.length;
    },
    // Σ bytes of the cache entries (from the index)
    async cacheBytes() { let t = 0; for (const [b] of (await metaIdx()).values()) t += b; return t; },
    // least recently used first, until the cache holds at most maxBytes → number of entries removed; `keep` (a Set or
    // array of keys, or a predicate) names entries that are never evicted (IMPL: content the project uses now)
    async cacheTrim(maxBytes = CACHE_MAX, keep) {
      const meta = await metaIdx(), kept = keepOf(keep), all = [...meta.entries()].map(([key, [bytes, lastUse]]) => ({ key, bytes, lastUse }));
      let tot = all.reduce((a, e) => a + e.bytes, 0);
      if (tot <= maxBytes) return 0;
      all.sort((a, b) => a.lastUse - b.lastUse || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const gone = [];
      for (const e of all) {
        if (tot <= maxBytes) break;
        if (kept(e.key)) continue;
        await be.del(CACHE, e.key);
        gone.push(e.key);
        tot -= e.bytes;
      }
      if (gone.length) await metaDelta(m => { for (const k of gone) delete m[k]; });
      return gone.length;
    },
    // resolves once the index writes issued so far are stored
    flush() { return chain; },
    close() { chain.then(() => { if (be.close) be.close(); }); },
  };
  return api;
}

/**
 * The same API on Maps. Options: now() (clock, ms), quota (bytes of buffers the store may hold; a put beyond it
 * rejects as IndexedDB's QuotaExceededError would).
 */
export function memoryStore(opts) {
  const maps = { [ASSETS]: new Map(), [CACHE]: new Map() }, quota = opts && opts.quota > 0 ? +opts.quota : Infinity;
  const keyOf = (s, r) => (s === ASSETS ? r.id : r.key);
  const used = () => { let n = 0; for (const m of Object.values(maps)) for (const r of m.values()) n += byteSize(r); return n; };
  return makeStore({
    get: async (s, k) => (maps[s].has(k) ? cloneRec(deepCopy(maps[s].get(k), 0)) : null),
    put: async (s, r) => {
      const prev = maps[s].get(keyOf(s, r));
      if (used() - (prev ? byteSize(prev) : 0) + byteSize(r) > quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      maps[s].set(keyOf(s, r), deepCopy(r, 0));
    },
    del: async (s, k) => { maps[s].delete(k); },
    all: async s => Array.from(maps[s].values(), r => deepCopy(r, 0)),
    has: async (s, k) => maps[s].has(k),
    update: async (s, k, fn) => { // read-modify-write in one step (fn(copy | null) → record to store, or undefined)
      const v = fn(maps[s].has(k) ? deepCopy(maps[s].get(k), 0) : null);
      if (v !== undefined) maps[s].set(k, deepCopy(v, 0));
    },
  }, opts);
}

const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
function idbBackend(db) {
  const st = (s, mode) => db.transaction(s, mode).objectStore(s);
  const done = (r, v) => new Promise((res, rej) => {
    const tx = r.transaction;
    tx.oncomplete = () => res(v);
    tx.onabort = tx.onerror = () => rej(tx.error || r.error);
  });
  return {
    get: async (s, k) => (await req2p(st(s, 'readonly').get(k))) || null,
    put: (s, rec) => { const r = st(s, 'readwrite').put(rec); return done(r); },
    del: (s, k) => { const r = st(s, 'readwrite').delete(k); return done(r); },
    all: (s, kind) => req2p(kind && s === ASSETS ? st(s, 'readonly').index('kind').getAll(kind) : st(s, 'readonly').getAll()),
    has: async (s, k) => {
      const os = st(s, 'readonly');
      if (typeof os.count === 'function') return (await req2p(os.count(k))) > 0;
      return (await req2p(os.get(k))) != null;
    },
    // read-modify-write inside one readwrite transaction (another tab's change cannot slip in between)
    update: (s, k, fn) => new Promise((res, rej) => {
      let tx;
      try {
        const os = st(s, 'readwrite'), r = os.get(k);
        tx = r.transaction;
        tx.oncomplete = () => res();
        tx.onabort = tx.onerror = () => rej(tx.error || r.error);
        r.onsuccess = () => {
          try { const v = fn(r.result == null ? null : r.result); if (v !== undefined) os.put(v); } catch (err) { try { tx.abort(); } catch { /* done */ } rej(err); }
        };
      } catch (err) { rej(err); }
    }),
    close: () => db.close(),
  };
}

/** Opens (or creates) the database. Rejects when IndexedDB is unavailable; callers then fall back to memoryStore(). */
export function openStore(opts) {
  return new Promise((res, rej) => {
    const idb = globalThis.indexedDB;
    if (!idb || typeof idb.open !== 'function') { rej(new Error('IndexedDB unavailable')); return; }
    let r;
    try { r = idb.open((opts && opts.name) || DB_NAME, DB_VER); } catch (err) { rej(err); return; }
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS, { keyPath: 'id' }).createIndex('kind', 'kind');
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE, { keyPath: 'key' });
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => db.close();
      res(makeStore(idbBackend(db), opts));
    };
    r.onerror = () => rej(r.error || new Error('IndexedDB open failed'));
    r.onblocked = () => rej(new Error('IndexedDB blocked by another tab'));
  });
}
