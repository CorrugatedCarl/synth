// wtstore.js — persistence of user wavetables and user noise samples (SPEC-serum §7.10, §8.3).
// IndexedDB database `synth-wt` v1, object store `tables` (keyPath `id`, index `kind`). `memoryStore()` offers the same
// API on a Map (fallback when IndexedDB is unavailable, and the tests). Nothing touches indexedDB at module top level.
//
// Records
//   { id, kind: 'wt', name, frames: R, morph, data: ArrayBuffer (Float32 R·2048, little-endian), created, modified }
//   { id, kind: 'noise', name, rate, ch, len, loopStart, loopEnd, root, L: ArrayBuffer, R: ArrayBuffer | null, created, modified,
//     loopWhole?: 0 | 1,     (optional: 1 = loops over the whole file by construction, e.g. a frameToNoise cycle; 0 = not;
//                            absent = unknown — wt.noiseEntry decides how to decimate, §7.9)
//     oneshot?: 0 | 1 }      (optional: the source's default play mode, §9.3 — a WAV without a loop plays once; absent = loop)
// `get` returns a Table for wavetables (frames sliced from the buffer) and the record itself for noise (level 0;
// wt.noiseEntry builds the playable entry). `put` accepts a Table, a noise record, a noise entry (level 0 is stored),
// a frameToNoise result or a stored/decoded record.
import { FRAME, uuid } from './wt.js?v=8';

const DB_NAME = 'synth-wt', DB_VER = 1, STORE = 'tables', WEEK = 7 * 86400000;
const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

const isBuf = v => v != null && (ArrayBuffer.isView(v) || (typeof v.byteLength === 'number' && typeof v.slice === 'function' && !Array.isArray(v)));
function f32Buffer(src) { // any numeric sequence / view / ArrayBuffer of Float32 → fresh little-endian ArrayBuffer
  const a = src == null ? new Float32Array(0)
    : ArrayBuffer.isView(src) ? src
    : isBuf(src) ? new Float32Array(src.slice(0))
    : Float32Array.from(src);
  if (LE) return (a instanceof Float32Array ? a.slice() : Float32Array.from(a)).buffer;
  const out = new ArrayBuffer(a.length * 4), dv = new DataView(out);
  for (let i = 0; i < a.length; i++) dv.setFloat32(i * 4, a[i], true);
  return out;
}
function f32View(buf) { // little-endian ArrayBuffer → Float32Array (fresh)
  if (LE) return new Float32Array(buf.slice(0));
  const dv = new DataView(buf), n = buf.byteLength >> 2, a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = dv.getFloat32(i * 4, true);
  return a;
}
const copyBuf = b => (b == null ? null : ArrayBuffer.isView(b) ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b.slice(0));
function cloneRec(r) {
  const o = Object.assign({}, r);
  for (const k of ['data', 'L', 'R']) if (k in o) o[k] = copyBuf(o[k]);
  return o;
}

const kindOf = obj => (obj && (obj.kind === 'noise' || (obj.L != null && !Array.isArray(obj.frames)) || (Array.isArray(obj.levels) && obj.levels[0] && obj.levels[0].L)) ? 'noise' : 'wt');
const PREFIX = { wt: 'user:', noise: 'nzuser:' };

// Normalised record (without id/created/modified) from any accepted input.
function toRecord(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('wtstore.put: nothing to store');
  const kind = kindOf(obj);
  if (kind === 'wt') {
    if (Array.isArray(obj.frames)) {
      const R = obj.frames.length;
      if (!R) throw new Error('wtstore.put: table has no frames');
      const data = new Float32Array(R * FRAME);
      obj.frames.forEach((f, i) => data.set(f.length === FRAME ? f : Float32Array.from(f).subarray(0, FRAME), i * FRAME));
      return { kind, name: obj.name, frames: R, morph: obj.morph | 0, data: f32Buffer(data) };
    }
    if (isBuf(obj.data)) {
      const bytes = ArrayBuffer.isView(obj.data) ? obj.data.byteLength : obj.data.byteLength;
      const R = Math.floor(bytes / (4 * FRAME));
      if (!R) throw new Error('wtstore.put: record has no frames');
      return { kind, name: obj.name, frames: R, morph: obj.morph | 0, data: copyBuf(obj.data).slice(0, R * FRAME * 4) };
    }
    throw new Error('wtstore.put: not a wavetable');
  }
  const lv = Array.isArray(obj.levels) && obj.levels[0] ? obj.levels[0] : obj;
  const L = f32Buffer(lv.L), len = L.byteLength >> 2;
  if (!len) throw new Error('wtstore.put: noise has no samples');
  const ch = obj.ch === 2 && lv.R != null ? 2 : 1;
  const R = ch === 2 ? f32Buffer(lv.R) : null;
  let ls = Math.round(+lv.loopStart || +obj.loopStart || 0), le = Math.round(+lv.loopEnd || +obj.loopEnd || len);
  ls = Math.min(Math.max(0, ls), len - 1); le = Math.min(len, Math.max(ls + 1, le));
  const rec = {
    kind, name: obj.name, rate: obj.rate > 0 ? +obj.rate : 48000, ch, len, loopStart: ls, loopEnd: le,
    root: Number.isFinite(obj.root) ? obj.root : 60, L, R,
  };
  const lw = obj.loopWhole;
  if (lw === 0 || lw === 1 || typeof lw === 'boolean') rec.loopWhole = lw ? 1 : 0;
  const os = obj.oneshot;
  if (os === 0 || os === 1 || typeof os === 'boolean') rec.oneshot = os ? 1 : 0;
  return rec;
}

function toTable(rec) {
  const all = f32View(rec.data), frames = [];
  for (let f = 0; f < rec.frames; f++) frames.push(all.slice(f * FRAME, (f + 1) * FRAME));
  return { id: rec.id, name: rec.name, frames, morph: rec.morph | 0, factory: 0 };
}
function row(rec) {
  const r = { id: rec.id, kind: rec.kind, name: rec.name, modified: rec.modified };
  if (rec.kind === 'wt') r.frames = rec.frames;
  else { r.seconds = rec.len / (rec.rate || 48000); r.oneshot = rec.oneshot ? 1 : 0; }
  return r;
}
const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base', numeric: true }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Store API over an async backend { get(id), put(rec), del(id), all(kind?) }.
function makeStore(be, opts) {
  const now = opts && typeof opts.now === 'function' ? opts.now : () => Date.now();
  return {
    async list(o) {
      const kind = o && o.kind;
      return (await be.all(kind)).filter(r => !kind || r.kind === kind).map(row).sort(byName);
    },
    async get(id) {
      const rec = await be.get(String(id));
      if (!rec) return null;
      return rec.kind === 'wt' ? toTable(rec) : cloneRec(rec);
    },
    async put(obj, o) {
      const rec = toRecord(obj);
      const recordForm = !Array.isArray(obj.frames) && !Array.isArray(obj.levels);
      let id = o && o.id ? String(o.id) : null;
      if (!id && recordForm && typeof obj.id === 'string' && obj.id.startsWith(PREFIX[rec.kind])) id = obj.id;
      if (!id) id = PREFIX[rec.kind] + uuid();
      const prev = await be.get(id), t = now();
      rec.id = id;
      rec.name = String((o && o.name) || rec.name || (prev && prev.name) || (rec.kind === 'wt' ? 'Wavetable' : 'Noise')).slice(0, 128);
      rec.created = prev && prev.created ? prev.created : t;
      rec.modified = t;
      await be.put(rec);
      return id;
    },
    async rename(id, name) {
      const rec = await be.get(String(id));
      if (!rec) return false;
      rec.name = String(name || rec.name).slice(0, 128);
      rec.modified = now();
      await be.put(rec);
      return true;
    },
    async del(id) { await be.del(String(id)); return true; },
    async gc(keepIds) {
      const keep = keepIds instanceof Set ? keepIds : new Set(keepIds || []), limit = now() - WEEK;
      let n = 0;
      for (const r of await be.all()) {
        if (keep.has(r.id) || !(r.modified < limit)) continue;
        await be.del(r.id);
        n++;
      }
      return n;
    },
    close() { if (be.close) be.close(); },
  };
}

export function memoryStore(opts) {
  const m = new Map();
  return makeStore({
    get: async id => (m.has(id) ? cloneRec(m.get(id)) : null),
    put: async rec => { m.set(rec.id, cloneRec(rec)); },
    del: async id => { m.delete(id); },
    all: async () => Array.from(m.values(), cloneRec),
  }, opts);
}

const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
function idbBackend(db) {
  const st = mode => db.transaction(STORE, mode).objectStore(STORE);
  const done = (r, v) => new Promise((res, rej) => {
    const tx = r.transaction;
    tx.oncomplete = () => res(v);
    tx.onabort = tx.onerror = () => rej(tx.error || r.error);
  });
  return {
    get: async id => (await req2p(st('readonly').get(id))) || null,
    put: rec => { const r = st('readwrite').put(rec); return done(r); },
    del: id => { const r = st('readwrite').delete(id); return done(r); },
    all: kind => req2p(kind ? st('readonly').index('kind').getAll(kind) : st('readonly').getAll()),
    close: () => db.close(),
  };
}

// Opens (or creates) the database. Rejects when IndexedDB is unavailable; callers then fall back to memoryStore().
export function openStore(opts) {
  return new Promise((res, rej) => {
    const idb = globalThis.indexedDB;
    if (!idb || typeof idb.open !== 'function') { rej(new Error('IndexedDB unavailable')); return; }
    let r;
    try { r = idb.open((opts && opts.name) || DB_NAME, DB_VER); } catch (err) { rej(err); return; }
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('kind', 'kind');
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
