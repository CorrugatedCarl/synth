// appstore.js — the app's own storage: settings, preferences, user presets and banks, and the project autosave
// (SPEC-serum2 §12.6 "Storage (B21)", lead sign-off on §0.8 item 7; owner I). Browser ES module, no imports.
// Nothing touches localStorage / indexedDB / BroadcastChannel at module top level (node imports it for the tests).
//
// SYNTH Canvas (SPEC-canvas §5.6, §5.8, stage 1a): its own namespace, so a canvas build on a shared origin (localhost while
// developing; canvas.domlavin.com is an origin of its own anyway) never reads or writes main's `synth-app` database, its
// `synth.*` keys or its `synth-app.*` bookkeeping keys:
//   - the database is DB_NAME 'synth-canvas' (BroadcastChannel of the same name); the asset stores are WT_DB / SMP_DB;
//   - callers keep the app's key names (`synth.settings`, `synth.user.<model>` … : main.js, fx-core, serum-ui, seq-core):
//     every key starting with `synth.` is stored as `synthc.…` (appKey; APP_NS), at the interface of both stores — other
//     keys pass through; info().resynced / conflicts name the stored keys (PROJECT_KEY = 'synthc.project');
//   - the bookkeeping keys are DB_NAME + '.lsat' / '.lsstale' / '.idb' / '.unload'.
// Schema gate (opts.schema = the highest project schema this build understands, cv-migrate.js SCHEMA; no option: no
// gate): a stored project with a higher `schema` (schemaOf) — found at open, before an autosave write (IndexedDB: in the
// write's own transaction; localStorage: when the stored text changed since this store last read or wrote it), or
// announced by another tab — is never overwritten: the store turns read-only for the project (saveProject / saveNow do
// nothing; key/value writes go on) and onError gets { readOnly: true, newer: schema } (at open: info().readOnly / newer
// only). lock() makes the project read-only for the session (main.js: a newer project file was opened). An older
// build's localStorage project or unload copy never replaces a newer stored one.
//
// Two stores with one interface:
//   createLocalStore(opts)   the Phase-1 localStorage store (main.js `store`, moved here verbatim in M1b): JSON values
//                            under `synth.*` keys, the project autosave as the JSON text of the project under
//                            `synth.project`. It is also every fallback of openAppStore.
//   openAppStore(opts)       → Promise<store> (never rejects): the IndexedDB store `synth-app` v1 when IndexedDB works,
//                            else createLocalStore. main.js opens its store with it (§12.6).
//
// Store interface (both modes; get/set/raw/setRaw are synchronous, exactly the Phase-1 semantics):
//   mode                     'ls' | 'idb' (an IDB store degrades to 'ls' for the rest of the session when IDB fails)
//   get(k, d)                parsed JSON value of key k, or d (missing, empty or unparsable)
//   set(k, v)                stores JSON.stringify(v)
//   raw(k) / setRaw(k, s)    the stored text / store a text as is
//   loadProject()            the autosaved project as JSON text, or null
//   saveProject(project)     autosave (a project object, or its JSON text). localStorage: JSON.stringify(project) under
//                            synth.project (= Phase-1 setRaw('synth.project', song.serialize(project))); IndexedDB:
//                            only the changed per-track records and the header are rewritten
//   saveNow(project)         the same for a page that is going away (pagehide / beforeunload / hidden): IndexedDB starts
//                            ONE transaction with every pending key and the project's changed records synchronously, in
//                            the caller's task (not behind queued work), asks it to commit, and keeps a best-effort
//                            emergency copy of a changed project in localStorage (UNLOAD_KEY, not an app key) that the next
//                            run adopts if the transaction never committed. localStorage: = saveProject (synchronous).
//                            saveNow(null): the pending keys only, the project left as stored (main.js: a newer
//                            project from a file is the current one — never written, while the store stays unlocked)
//   flush() → Promise        resolves when every queued IndexedDB write has finished (localStorage: at once)
//   info()                   { mode, reason, migrated, resynced: [keys], conflicts: [keys], stale, restored, readOnly, newer }
//   lock()                   the project read-only for the rest of the session (schema gate)
//   recovered(k)             IndexedDB: the text kept as '#rec:<k>' by this run's re-sync (the losing side of a conflict),
//                            or null; localStorage: null
//   close()
// opts: { ls (Storage; default globalThis.localStorage, resolved per call as Phase 1 did), onError(info) (info =
// { key, error, quota, notice, fallback }: every failed write; notice = QUOTA_NOTICE for quota errors, fallback = true
// when an IDB store has just degraded to localStorage), stamp (localStorage stores: record write times, below),
// schema (the schema gate, above) }.
// openAppStore adds { idb (default globalThis.indexedDB), bc (BroadcastChannel or null; default a channel named
// DB_NAME when available), now () → ms, timeout (open, ms; default 4000) }.
//
// IndexedDB layout (DB_NAME v1; the stored, `synthc.` key names below are written `synth.` as the callers use them)
//   kv      keyPath 'k': { k, v: text, at } for every app key except synth.project (v = the localStorage text);
//           reserved records: '#meta' (migration state, below), '#rec:<key>' (recovery copies, below)
//   tracks  keyPath 'id': '#head' { id, m: project JSON without tracks, keys: [record ids in track order], at } or
//           { id, raw, at } (an unparsable autosave, kept verbatim); one record { id, j: track JSON } per track,
//           id 't:<track id>' ('i:<index>' for a missing or repeated id) — the per-track split song.History uses
//
// Migration (sign-off item 7 conditions)
//   - First run (no verified '#meta'): every localStorage key starting with `synth.` (synth.project, synth.settings,
//     synth.v.*, synth.user.*, synth.seq303, synth.sx.*, synth.fxchains, synth.fxmod.*, synth.tab, synth.kbHidden,
//     synth.devsr, …) is copied in one transaction, then read back in a new transaction and compared (texts exactly;
//     the project structurally, as JSON). Only then is '#meta' marked verified; any failure leaves this session on
//     localStorage (openAppStore resolves to createLocalStore) and the next run retries from scratch.
//   - localStorage app keys are never written or deleted by an IndexedDB store (the copies stay as the read-only fallback;
//     a fallback session keeps working on them exactly as in Phase 1). Project/preset files are not touched here. The
//     bookkeeping keys (not app keys) are: IDB_MARK (a verified database exists: written after the migration and by every
//     later IndexedDB run), STAMP_KEY / STALE_KEY (write times of fallback sessions), UNLOAD_KEY (saveNow's copy).
//   - A fallback session while IDB_MARK is set (IndexedDB unavailable, failed or timed out after the data moved there)
//     runs on the older localStorage copy: onError gets STALE_NOTICE ({notice, fallback: true, stale: true}) at open,
//     and its writes are stamped in STALE_KEY. The next IndexedDB run never lets such a key replace the database's
//     value: the database keeps its value and the fallback session's text is kept as '#rec:<key>' (a conflict; main.js
//     offers a recovered project for download). A first run (no '#meta') while IDB_MARK is set — the database was
//     evicted or deleted — migrates as usual and reports RESTORED_NOTICE (info.restored).
//   - Later runs re-sync per key (three-way, bases = content hashes in '#meta'): a key whose localStorage text changed
//     since the last sync (written by a localStorage-mode session) is copied in when IndexedDB still holds the synced
//     value; when both changed, the newer one wins if the localStorage side carries a write time (STAMP_KEY, written
//     by the fallback stores of this module), else IndexedDB wins; the losing text is kept as '#rec:<key>'. Keys written
//     by a stale fallback session (STALE_KEY, above) never win.
//
// Errors: every quota error (IndexedDB or localStorage) calls onError with notice QUOTA_NOTICE; createLocalStore
// without onError is silent (Phase 1). A non-quota IndexedDB failure (closed connection, version change, …) degrades
// the store to localStorage: the whole cached state is written there (with write times) and reads stay on the cache.
// Other tabs: committed key/value writes are announced on `bc`; the other tabs' stores re-read those keys (Phase 1 read
// localStorage live). The project is read once at start, as in Phase 1.

export const DB_NAME = 'synth-canvas'; // (main: 'synth-app')
export const DB_VER = 1;
export const KV = 'kv';
export const TRACKS = 'tracks';
// the canvas namespace (SPEC-canvas §5.6): `synth.x` as the callers name it → `synthc.x` as stored
export const APP_NS = 'synthc.', LEGACY_NS = 'synth.';
export const appKey = k => (typeof k === 'string' && k.startsWith(LEGACY_NS) ? APP_NS + k.slice(LEGACY_NS.length) : k);
export const PROJECT_KEY = appKey('synth.project');
export const STAMP_KEY = DB_NAME + '.lsat'; // localStorage { key: write time } of fallback sessions (not an app key)
export const STALE_KEY = DB_NAME + '.lsstale'; // localStorage { key: write time } of stale fallback sessions (not an app key)
export const IDB_MARK = DB_NAME + '.idb'; // localStorage: time of the verified migration (a database holds the app's data)
export const UNLOAD_KEY = DB_NAME + '.unload'; // localStorage: saveNow's emergency copy { at, p: project text }
export const WT_DB = DB_NAME + '-wt', SMP_DB = DB_NAME + '-smp'; // the asset stores (wtstore / smpstore opts.name; main: synth-wt / synth-smp)
export const QUOTA_NOTICE = 'Storage full — the project was not saved';
export const STALE_NOTICE = 'Saved data could not be opened — showing an older copy. Changes made now are kept separately and will not replace it.';
export const RESTORED_NOTICE = 'Saved data was missing — an older copy was restored';
const META = '#meta', HEAD = '#head', REC = '#rec:';

export const isAppKey = k => typeof k === 'string' && k.startsWith(APP_NS);

// The `schema` stamp of a stored project (SPEC-canvas §5.8): a project object, its JSON text or its header JSON (the
// project without tracks) → integer ≥ 0; 0 when there is none (main's projects, pre-canvas autosaves) or it is unreadable
export function schemaOf(x) {
  let o = x;
  if (typeof x === 'string') { try { o = JSON.parse(x); } catch { return 0; } }
  const n = o && typeof o === 'object' && !Array.isArray(o) ? o.schema : 0;
  return typeof n === 'number' && n > 0 && n < 1e9 ? Math.floor(n) : 0;
}
// the stored project's text of a '#head' record (header JSON, or the raw autosave), or null
const headText = h => (!h ? null : typeof h.m === 'string' ? h.m : typeof h.raw === 'string' ? h.raw : null);
function tellNewer(onError, n) {
  if (typeof onError !== 'function') return;
  try { onError({ key: PROJECT_KEY, error: null, quota: false, notice: null, fallback: false, readOnly: true, newer: n }); } catch (e) { console.error('appstore: onError', e); }
}

export function isQuotaError(e) {
  if (!e || typeof e !== 'object') return false;
  const n = e.name || '';
  return n === 'QuotaExceededError' || n === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014;
}

// Content hash of a text (two 32-bit FNV-style lanes + length); undefined for a missing value.
export function hashText(s) {
  if (typeof s !== 'string') return undefined;
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995); b ^= b >>> 15;
  }
  return s.length.toString(36) + '.' + (a >>> 0).toString(36) + '.' + (b >>> 0).toString(36);
}

function deepEq(x, y) {
  if (x === y) return true;
  if (!x || !y || typeof x !== 'object' || typeof y !== 'object' || Array.isArray(x) !== Array.isArray(y)) return false;
  if (Array.isArray(x)) {
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!deepEq(x[i], y[i])) return false;
    return true;
  }
  const kx = Object.keys(x);
  if (kx.length !== Object.keys(y).length) return false;
  for (const k of kx) if (!Object.prototype.hasOwnProperty.call(y, k) || !deepEq(x[k], y[k])) return false;
  return true;
}
// Two JSON texts describe the same value (key order ignored); unparsable texts only equal themselves.
export function sameJSON(a, b) {
  if (a === b) return true;
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  try { return deepEq(JSON.parse(a), JSON.parse(b)); } catch { return false; }
}

const jsonOf = x => { const s = JSON.stringify(x); return s === undefined ? 'null' : s; };
// A project (object or JSON text) → { m, keys, t } (t[i] = JSON of track i, record id keys[i]) or { raw } when it is
// not a project object (an unparsable or odd autosave is stored verbatim).
export function splitProject(p) {
  let o = p;
  if (typeof p === 'string') { try { o = JSON.parse(p); } catch { return { raw: p }; } }
  if (!o || typeof o !== 'object' || Array.isArray(o) || !Array.isArray(o.tracks)) return { raw: typeof p === 'string' ? p : jsonOf(p) };
  const { tracks, ...rest } = o, keys = [], t = [], seen = new Set();
  tracks.forEach((tr, i) => {
    let k = tr && typeof tr === 'object' && typeof tr.id === 'string' ? 't:' + tr.id : '';
    if (!k || seen.has(k)) k = 'i:' + i;
    seen.add(k); keys.push(k); t.push(jsonOf(tr));
  });
  return { m: jsonOf(rest), keys, t };
}
// The JSON text of a split project (tracks after the other fields; records that are missing are left out).
export function joinProject(sp) {
  if (!sp) return null;
  if (typeof sp.raw === 'string') return sp.raw;
  const arr = '"tracks":[' + sp.t.filter(s => typeof s === 'string').join(',') + ']';
  return sp.m === '{}' ? '{' + arr + '}' : sp.m.slice(0, -1) + ',' + arr + '}';
}

// Every app key of a Storage → Map(key → text).
export function lsSnapshot(ls) {
  const out = new Map();
  try {
    let keys;
    if (typeof ls.key === 'function' && typeof ls.length === 'number') { keys = []; for (let i = 0; i < ls.length; i++) keys.push(ls.key(i)); }
    else keys = Object.keys(ls);
    for (const k of keys) if (isAppKey(k)) { const v = ls.getItem(k); if (typeof v === 'string') out.set(k, v); }
  } catch { /* storage unavailable */ }
  return out;
}
function readStamps(ls, key = STAMP_KEY) {
  try { const o = JSON.parse(ls.getItem(key) || 'null'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
}
const hasMark = ls => { try { return !!ls && !!ls.getItem(IDB_MARK); } catch { return false; } };
function report(onError, key, error, fallback) {
  if (typeof onError !== 'function') return;
  const quota = isQuotaError(error);
  try { onError({ key, error, quota, notice: quota ? QUOTA_NOTICE : null, fallback: !!fallback }); } catch (e) { console.error('appstore: onError', e); }
}

/* ------------------------------------------------------------- localStorage store (Phase 1) */
export function createLocalStore(opts) {
  const o = opts || {};
  const L = () => o.ls || globalThis.localStorage;
  const now = typeof o.now === 'function' ? o.now : () => Date.now();
  // write times of a fallback session (o.stamp): STAMP_KEY, or STALE_KEY for a session on an older copy (o.stale); a current
  // write (degraded IndexedDB session) clears the key's stale mark
  const stamp = k => {
    if (!o.stamp || !isAppKey(k)) return;
    try {
      const ls = L(), key = o.stale ? STALE_KEY : STAMP_KEY, s = readStamps(ls, key);
      s[k] = now(); ls.setItem(key, JSON.stringify(s));
      if (!o.stale && ls.getItem(STALE_KEY) !== null) { const z = readStamps(ls, STALE_KEY); if (k in z) { delete z[k]; ls.setItem(STALE_KEY, JSON.stringify(z)); } }
    } catch { /* bookkeeping only */ }
  };
  const put = (k, v) => { try { L().setItem(k, v); stamp(k); return true; } catch (e) { report(o.onError, k, e, false); return false; } };
  // schema gate: seen = the project text this store last read or wrote (a stored text that differs was written by
  // another tab or build, and is checked before it is replaced)
  const max = o.schema > 0 ? +o.schema : Infinity;
  let ro = false, newer = 0, seen = null;
  const gate = () => {
    if (ro) return false;
    if (max === Infinity) return true;
    let cur = null;
    try { cur = L().getItem(PROJECT_KEY); } catch { return true; }
    if (cur === null || cur === seen) return true;
    const n = schemaOf(cur);
    if (n > max) { ro = true; newer = n; tellNewer(o.onError, n); return false; }
    return true;
  };
  const store = {
    mode: 'ls',
    get(k, d) { try { const v = L().getItem(appKey(k)); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { let s; try { s = JSON.stringify(v); } catch (e) { report(o.onError, appKey(k), e, false); return; } store.setRaw(k, s); },
    raw(k) { try { return L().getItem(appKey(k)); } catch { return null; } },
    setRaw(k, v) { const K = appKey(k); if (K === PROJECT_KEY) store.saveProject(typeof v === 'string' ? v : String(v)); else put(K, v); },
    loadProject() {
      const t = store.raw(PROJECT_KEY);
      if (max !== Infinity) { seen = t; const n = t === null ? 0 : schemaOf(t); if (n > max) { ro = true; newer = n; } }
      return t;
    },
    saveProject(p) {
      if (!gate()) return;
      const s = typeof p === 'string' ? p : JSON.stringify(p);
      if (put(PROJECT_KEY, s) && max !== Infinity) seen = s;
    },
    saveNow(p) { if (p != null) store.saveProject(p); },
    flush() { return Promise.resolve(); },
    info() { return { mode: 'ls', reason: o.reason || 'local', migrated: false, resynced: [], conflicts: [], stale: !!o.stale, restored: false, readOnly: ro, newer }; },
    lock() { ro = true; },
    recovered() { return null; },
    close() { return Promise.resolve(); },
  };
  return store;
}

/* ------------------------------------------------------------- IndexedDB helpers */
function openDb(idb, ms) {
  return new Promise((res, rej) => {
    let done = false, r;
    const tm = setTimeout(() => { if (!done) { done = true; rej(new Error('IndexedDB open timed out')); } }, ms > 0 ? ms : 4000);
    const end = (ok, v) => {
      if (done) { if (ok && v) try { v.close(); } catch { /* late open after a timeout */ } return; }
      done = true; clearTimeout(tm);
      if (ok) res(v); else rej(v);
    };
    try { r = idb.open(DB_NAME, DB_VER); } catch (e) { end(false, e); return; }
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains(KV)) d.createObjectStore(KV, { keyPath: 'k' });
      if (!d.objectStoreNames.contains(TRACKS)) d.createObjectStore(TRACKS, { keyPath: 'id' });
    };
    r.onsuccess = () => end(true, r.result);
    r.onerror = () => end(false, r.error || new Error('IndexedDB open failed'));
    // onblocked: keep waiting; the timeout decides
  });
}
// One transaction over `names`, created and filled synchronously (the Promise executor runs in the caller's task);
// fn(stores…, out) queues requests; resolves with out on complete. commit: ask for the commit at once (IDBTransaction
// commit(), where available) — for a page that is going away.
function txn(db, names, mode, fn, commit) {
  return new Promise((res, rej) => {
    let t;
    try { t = db.transaction(names, mode); } catch (e) { rej(e); return; }
    const out = {};
    t.oncomplete = () => res(out);
    t.onerror = e => rej((e && e.target && e.target.error) || t.error || new Error('IndexedDB transaction failed'));
    t.onabort = () => rej(t.error || new Error('IndexedDB transaction aborted'));
    try { fn(...names.map(n => t.objectStore(n)), out); } catch (e) { try { t.abort(); } catch { /* already finished */ } rej(e); return; }
    if (commit && typeof t.commit === 'function') try { t.commit(); } catch { /* commits on its own */ }
  });
}
async function readAll(db) {
  const out = await txn(db, [KV, TRACKS], 'readonly', (kv, tr, o) => {
    const a = kv.getAll(), b = tr.getAll();
    a.onsuccess = () => { o.kv = a.result; };
    b.onsuccess = () => { o.tr = b.result; };
  });
  const st = { meta: null, kv: new Map(), head: null, tr: new Map() };
  for (const r of out.kv || []) {
    if (!r || typeof r.k !== 'string') continue;
    if (r.k === META) st.meta = r.v && typeof r.v === 'object' ? r.v : null;
    else st.kv.set(r.k, r);
  }
  for (const r of out.tr || []) {
    if (!r || typeof r.id !== 'string') continue;
    if (r.id === HEAD) st.head = r; else if (typeof r.j === 'string') st.tr.set(r.id, r.j);
  }
  return st;
}
// The stored project as a split (null when none); missing track records stay undefined in t.
function storedSplit(st) {
  const h = st.head;
  if (!h) return null;
  if (typeof h.raw === 'string') return { raw: h.raw };
  if (typeof h.m !== 'string' || h.m[0] !== '{' || !Array.isArray(h.keys)) return null;
  return { m: h.m, keys: h.keys.slice(), t: h.keys.map(k => st.tr.get(k)) };
}
// The `tracks` writes that turn the stored project `prev` (split or null) into `next`: { put: [records], del: [ids] }
// with the header last, or null when nothing changed (only changed track records are rewritten).
function diffProject(prev, next, at) {
  const put = [], del = [];
  if (next.raw != null) {
    if (prev && prev.raw === next.raw) return null;
    if (prev && prev.keys) del.push(...prev.keys);
    put.push({ id: HEAD, raw: next.raw, at });
    return { put, del };
  }
  const old = new Map();
  if (prev && prev.keys) prev.keys.forEach((k, i) => old.set(k, prev.t[i]));
  let any = !prev || prev.raw != null || prev.m !== next.m || prev.keys.length !== next.keys.length || prev.keys.some((k, i) => k !== next.keys[i]);
  next.keys.forEach((k, i) => { if (old.get(k) !== next.t[i]) put.push({ id: k, j: next.t[i] }); old.delete(k); });
  for (const k of old.keys()) del.push(k);
  if (!any && !put.length && !del.length) return null;
  put.push({ id: HEAD, m: next.m, keys: next.keys.slice(), at });
  return { put, del };
}
function applyDiff(tr, d) { if (d) { for (const k of d.del) tr.delete(k); for (const r of d.put) tr.put(r); } }
const projText = st => joinProject(storedSplit(st));
// a localStorage project text and a stored one say the same (raw texts exactly, projects as JSON)
const sameProject = (sp, a, b) => (sp && sp.raw != null ? a === b : sameJSON(a, b));

/* ------------------------------------------------------------- migration and re-sync */
async function migrate(db, snap, now) {
  const at = now(), proj = snap.has(PROJECT_KEY) ? splitProject(snap.get(PROJECT_KEY)) : null;
  await txn(db, [KV, TRACKS], 'readwrite', (kv, tr) => {
    kv.clear(); tr.clear();
    for (const [k, v] of snap) if (k !== PROJECT_KEY) kv.put({ k, v, at });
    if (proj) applyDiff(tr, diffProject(null, proj, at));
    kv.put({ k: META, v: { v: 1, state: 'copied', at } });
  });
  const back = await readAll(db); // read back in a new transaction and compare before trusting the copy
  let n = 0;
  for (const [k, v] of snap) {
    if (k === PROJECT_KEY) {
      if (!sameProject(proj, projText(back), v)) throw new Error('appstore: migrated project differs');
    } else {
      const r = back.kv.get(k);
      if (!r || r.v !== v) throw new Error('appstore: migrated key differs: ' + k);
      n++;
    }
  }
  if ([...back.kv.keys()].filter(isAppKey).length !== n || (!proj && back.head)) throw new Error('appstore: migrated store has extra records');
  const src = {}, dst = {};
  for (const [k, v] of snap) { src[k] = hashText(v); dst[k] = k === PROJECT_KEY ? hashText(projText(back)) : src[k]; }
  const meta = { v: 1, state: 'ok', at, synced: at, src, dst };
  await txn(db, [KV], 'readwrite', kv => { kv.put({ k: META, v: meta }); });
  back.meta = meta;
  return back;
}

async function resync(db, st, snap, stamps, stale, now, info) {
  const meta = st.meta, src = Object.assign({}, meta.src), dst = Object.assign({}, meta.dst);
  const puts = [], recs = [];
  let proj = null, dirty = false;
  for (const [k, lv] of snap) {
    const lh = hashText(lv);
    if (lh === src[k]) continue; // localStorage untouched since the last sync
    dirty = true;
    const isP = k === PROJECT_KEY, rec = isP ? null : st.kv.get(k);
    const iv = isP ? projText(st) : rec ? rec.v : undefined, ih = hashText(iv);
    const iat = isP ? (st.head && st.head.at) || 0 : (rec && rec.at) || 0;
    const lsp = isP ? splitProject(lv) : null, same = iv !== undefined && (isP ? sameProject(lsp, iv, lv) : iv === lv);
    // written by a fallback session that ran on the older copy (STALE_KEY, not overwritten by a current write since)
    const lat = +stamps[k] || 0, zat = +stale[k] || 0, old = zat > 0 && !(lat >= zat);
    // (SPEC-canvas §5.8) a project of a lower schema never replaces a stored one of a higher schema (an older build wrote it)
    const down = isP && !same && iv !== undefined && schemaOf(headText(st.head)) > schemaOf(lv);
    // IndexedDB still holds the synced value: take localStorage's — unless it was written on the older copy
    let take = !same && (iv === undefined || (!old && !down && ih === dst[k]));
    if (!same && !take) { // both sides changed: the newest known writer wins (never a stale one), the other text is kept as '#rec:<key>'
      take = !old && !down && lat > 0 && lat > iat;
      recs.push({ k: REC + k, v: take ? iv : lv, from: take ? 'idb' : old ? 'stale' : down ? 'older' : 'ls', at: take ? iat : old ? zat : lat });
      info.conflicts.push(k);
    }
    if (take) { if (isP) proj = lsp; else puts.push({ k, v: lv }); info.resynced.push(k); }
    src[k] = lh;
    dst[k] = take ? (isP ? null : lh) : ih; // a taken project's base is its stored (joined) text, filled in below
  }
  if (!dirty) return st;
  const at = now();
  await txn(db, [KV, TRACKS], 'readwrite', (kv, tr) => {
    for (const p of puts) kv.put({ k: p.k, v: p.v, at });
    for (const r of recs) kv.put({ k: r.k, v: r.v, from: r.from, at: r.at });
    if (proj) applyDiff(tr, diffProject(storedSplit(st), proj, at));
  });
  const back = await readAll(db);
  for (const p of puts) { const r = back.kv.get(p.k); if (!r || r.v !== p.v) throw new Error('appstore: re-synced key differs: ' + p.k); }
  if (proj && !sameProject(proj, projText(back), snap.get(PROJECT_KEY))) throw new Error('appstore: re-synced project differs');
  if (dst[PROJECT_KEY] === null) dst[PROJECT_KEY] = hashText(projText(back));
  const m2 = Object.assign({}, meta, { synced: at, src, dst });
  await txn(db, [KV], 'readwrite', kv => { kv.put({ k: META, v: m2 }); });
  back.meta = m2;
  return back;
}

// saveNow's emergency copy (UNLOAD_KEY): adopted when the database's project is older than it (the unload transaction
// never committed), dropped otherwise. Schema gate (max): a copy of a schema above max is left for the build that wrote
// it; a copy of a lower schema than the stored project never replaces it
async function adoptUnload(db, st, ls, now, info, max) {
  let u = null;
  try { const t = ls ? ls.getItem(UNLOAD_KEY) : null; if (t === null) return st; u = JSON.parse(t); } catch { u = null; }
  const drop = () => { try { ls.removeItem(UNLOAD_KEY); } catch { /* bookkeeping only */ } };
  if (!u || typeof u !== 'object' || !(u.at > 0) || typeof u.p !== 'string') { drop(); return st; }
  const su = max !== Infinity ? schemaOf(u.p) : 0;
  if (su > max) return st;
  if (st.head && ((+st.head.at || 0) >= u.at || (max !== Infinity && schemaOf(headText(st.head)) > su))) { drop(); return st; }
  const next = splitProject(u.p), at = now();
  await txn(db, [TRACKS], 'readwrite', tr => { applyDiff(tr, diffProject(storedSplit(st), next, at)); });
  const back = await readAll(db);
  if (!sameProject(next, projText(back), u.p)) throw new Error('appstore: unload copy differs');
  back.meta = st.meta;
  info.resynced.push(PROJECT_KEY);
  drop();
  return back;
}

/* ------------------------------------------------------------- IndexedDB store */
function idbStore(db, st, o, info, bc) {
  const now = typeof o.now === 'function' ? o.now : () => Date.now();
  const cache = new Map(), recs = new Map(); // app key → text (synth.project excluded); key → its '#rec:' text
  for (const [k, r] of st.kv) {
    if (isAppKey(k) && k !== PROJECT_KEY && typeof r.v === 'string') cache.set(k, r.v);
    else if (k.startsWith(REC) && r && typeof r.v === 'string') recs.set(k.slice(REC.length), r.v);
  }
  const LS = () => { try { return o.ls || globalThis.localStorage || null; } catch { return null; } };
  let saved = storedSplit(st), latest = saved; // committed project split / the latest one handed to saveProject
  let mode = 'idb', reason = info.reason, local = null, closed = false;
  const pend = new Map(), retry = new Set();
  let chain = Promise.resolve(), kvQueued = false, pjQueued = false;
  // schema gate: a stored project of a higher schema than this build's makes the project read-only
  const max = o.schema > 0 ? +o.schema : Infinity;
  let ro = false, newer = max !== Infinity ? schemaOf(headText(st.head)) : 0;
  if (newer > max) ro = true; else newer = 0;
  const newerFound = n => { if (!ro) { ro = true; newer = n; tellNewer(o.onError, n); } };
  // in a project write's own transaction, before its records: the stored header — when it is not the one this store
  // committed last (another tab or build wrote it) and of a higher schema, the write is aborted; → () → found schema
  const guard = tr => {
    if (max === Infinity) return () => 0;
    const known = saved ? (saved.raw != null ? saved.raw : saved.m) : null, g = tr.get(HEAD);
    let hit = 0;
    g.onsuccess = () => {
      const t = headText(g.result), n = t !== null && t !== known ? schemaOf(t) : 0;
      if (n > max) { hit = n; try { g.transaction.abort(); } catch { /* already finishing */ } }
    };
    return () => hit;
  };

  function degrade(error) { // IndexedDB failed: the rest of the session on localStorage, the cache written there
    if (mode !== 'idb') return;
    mode = 'ls'; reason = 'failed';
    local = createLocalStore({ ls: o.ls, onError: o.onError, stamp: true, now, reason, schema: o.schema });
    if (ro) local.lock();
    report(o.onError, null, error, true);
    for (const [k, v] of cache) local.setRaw(k, v);
    if (latest) local.saveProject(joinProject(latest));
    pend.clear(); retry.clear();
    try { db.close(); } catch { /* already closed */ }
    if (bc) try { bc.close(); } catch { /* already closed */ }
  }
  const failed = (keys, e) => {
    if (!isQuotaError(e)) { degrade(e); return; }
    for (const k of keys) if (k !== PROJECT_KEY) retry.add(k); // (the project is rewritten by the next autosave)
    report(o.onError, keys.length === 1 ? keys[0] : null, e, false);
  };
  async function writeKv() {
    kvQueued = false;
    if (mode !== 'idb') return;
    for (const k of retry) if (!pend.has(k) && cache.has(k)) pend.set(k, cache.get(k));
    retry.clear();
    if (!pend.size) return;
    const batch = [...pend], at = now();
    pend.clear();
    try {
      await txn(db, [KV], 'readwrite', kv => { for (const [k, v] of batch) kv.put({ k, v, at }); });
      if (bc) try { bc.postMessage({ kv: batch.map(b => b[0]) }); } catch { /* channel closed */ }
    } catch (e) { failed(batch.map(b => b[0]), e); }
  }
  async function writeProject() {
    pjQueued = false;
    if (mode !== 'idb' || ro || !latest || latest === saved) return;
    const next = latest, d = diffProject(saved, next, now());
    if (!d) { saved = next; return; }
    let hit = () => 0;
    try {
      await txn(db, [TRACKS], 'readwrite', tr => { hit = guard(tr); applyDiff(tr, d); });
      saved = next;
    } catch (e) { if (hit()) newerFound(hit()); else failed([PROJECT_KEY], e); }
  }
  const kick = () => { if (!kvQueued) { kvQueued = true; chain = chain.then(writeKv); } };
  // the page is going away: every pending key and the project's changed records in one transaction started now (in the
  // caller's task, ahead of nothing: a write already in flight commits first, IndexedDB orders them), plus the emergency
  // copy of a changed project. Schema gate: the guard's read is queued first, the records right after it (all in this
  // task); the transaction is then left to commit by itself (an explicit commit() would come before the guard's answer)
  function writeNow() {
    for (const k of retry) if (!pend.has(k) && cache.has(k)) pend.set(k, cache.get(k));
    retry.clear();
    const at = now(), next = latest, d = !ro && next && next !== saved ? diffProject(saved, next, at) : null, batch = [...pend];
    if (!d && !batch.length) return;
    pend.clear();
    let u = '';
    if (d) {
      u = '{"at":' + at + ',';
      try { const ls = LS(); if (ls) ls.setItem(UNLOAD_KEY, u + '"p":' + JSON.stringify(joinProject(next)) + '}'); } catch { u = ''; /* best effort */ }
    }
    const names = batch.length && d ? [KV, TRACKS] : batch.length ? [KV] : [TRACKS];
    const dropCopy = () => { if (u) try { const ls = LS(), t = ls && ls.getItem(UNLOAD_KEY); if (t && t.startsWith(u)) ls.removeItem(UNLOAD_KEY); } catch { /* bookkeeping only */ } };
    let hit = () => 0;
    txn(db, names, 'readwrite', (...a) => {
      const kv = batch.length ? a[0] : null, tr = d ? a[batch.length ? 1 : 0] : null;
      if (tr) hit = guard(tr);
      if (kv) for (const [k, v] of batch) kv.put({ k, v, at });
      if (tr) applyDiff(tr, d);
    }, !d || max === Infinity).then(() => {
      if (d) saved = next;
      if (bc && batch.length) try { bc.postMessage({ kv: batch.map(b => b[0]) }); } catch { /* channel closed */ }
      dropCopy();
    }, e => {
      if (!hit()) { failed(batch.map(b => b[0]).concat(d ? [PROJECT_KEY] : []), e); return; }
      dropCopy(); newerFound(hit());
      for (const [k, v] of batch) if (!pend.has(k)) pend.set(k, v); // (the keys went down with the aborted transaction)
      kick();
    });
  }

  if (bc) bc.onmessage = ev => { // another tab wrote keys: refresh them (keys with local pending writes win)
    const keys = ev && ev.data && Array.isArray(ev.data.kv) ? ev.data.kv.filter(k => isAppKey(k) && !pend.has(k)) : [];
    if (!keys.length || mode !== 'idb') return;
    txn(db, [KV], 'readonly', (kv, out) => {
      for (const k of keys) { const r = kv.get(k); r.onsuccess = () => { out[k] = r.result; }; }
    }).then(out => { for (const k of keys) if (!pend.has(k) && out[k] && typeof out[k].v === 'string') cache.set(k, out[k].v); }, () => {});
  };
  if (db) db.onversionchange = () => { try { db.close(); } catch { /* closed */ } };

  const store = {
    get mode() { return mode; },
    get(k, d) { const v = store.raw(k); if (!v) return d; try { return JSON.parse(v); } catch { return d; } },
    set(k, v) { let s; try { s = JSON.stringify(v); } catch (e) { report(o.onError, appKey(k), e, false); return; } store.setRaw(k, s); },
    raw(k) {
      const K = appKey(k);
      if (K === PROJECT_KEY) return store.loadProject();
      return cache.has(K) ? cache.get(K) : null;
    },
    setRaw(k, v) {
      const K = appKey(k);
      if (K === PROJECT_KEY) { store.saveProject(String(v)); return; }
      const s = String(v);
      cache.set(K, s);
      if (closed) return;
      if (mode !== 'idb') { local.setRaw(K, s); return; }
      pend.set(K, s); kick();
    },
    loadProject() { return latest ? joinProject(latest) : null; },
    saveProject(p) {
      if (ro) return;
      latest = splitProject(p);
      if (closed) return;
      if (mode !== 'idb') { local.saveProject(joinProject(latest)); return; }
      if (!pjQueued) { pjQueued = true; chain = chain.then(writeProject); }
    },
    saveNow(p) {
      const pj = !ro && p != null; // (read-only, or null: the pending keys only)
      if (pj) latest = splitProject(p);
      if (closed) return;
      if (mode !== 'idb') { if (pj) local.saveProject(joinProject(latest)); return; }
      writeNow();
    },
    flush() { return chain.then(() => {}, () => {}); },
    info() { return { mode, reason, migrated: info.migrated, resynced: info.resynced.slice(), conflicts: info.conflicts.slice(), stale: false, restored: !!info.restored,
      readOnly: ro || (!!local && local.info().readOnly), newer: newer || (local ? local.info().newer : 0) }; },
    lock() { ro = true; if (local) local.lock(); },
    recovered(k) { const K = appKey(k); return recs.has(K) ? recs.get(K) : null; },
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      return chain.then(() => {
        if (mode === 'idb') try { db.close(); } catch { /* closed */ }
        if (bc) try { bc.close(); } catch { /* closed */ }
      });
    },
  };
  return store;
}

export function openAppStore(opts) {
  const o = opts || {};
  const lsOf = () => { try { return o.ls || globalThis.localStorage || null; } catch { return null; } }; // access itself may throw (blocked storage)
  const tell = e => { if (typeof o.onError === 'function') try { o.onError(e); } catch (err) { console.error('appstore: onError', err); } };
  const fallback = (reason, error) => {
    if (error) console.warn('appstore: IndexedDB not used (' + reason + ')', error);
    // the app's data lives in a database this session cannot open: localStorage holds an older copy (§0.8 item 7)
    const stale = hasMark(lsOf());
    const st = createLocalStore(Object.assign({}, o, { stamp: true, reason, stale }));
    if (stale) tell({ key: null, error: error || null, quota: false, notice: STALE_NOTICE, fallback: true, stale: true });
    return st;
  };
  const idb = 'idb' in o ? o.idb : globalThis.indexedDB;
  if (!idb || typeof idb.open !== 'function') return Promise.resolve(fallback('unavailable'));
  const now = typeof o.now === 'function' ? o.now : () => Date.now();
  const info = { reason: 'idb', migrated: false, resynced: [], conflicts: [] };
  let db = null;
  return (async () => {
    db = await openDb(idb, o.timeout);
    const ls = lsOf();
    const snap = ls ? lsSnapshot(ls) : new Map(), mark = hasMark(ls);
    let st = await readAll(db);
    if (!st.meta || st.meta.state !== 'ok' || st.meta.v !== 1) {
      st = await migrate(db, snap, now); info.migrated = true;
      info.restored = mark; // the database was there before (evicted / deleted): this is the older localStorage copy
    } else {
      st = await resync(db, st, snap, ls ? readStamps(ls) : {}, ls ? readStamps(ls, STALE_KEY) : {}, now, info);
      st = await adoptUnload(db, st, ls, now, info, o.schema > 0 ? +o.schema : Infinity);
    }
    if (ls && !mark) try { ls.setItem(IDB_MARK, String(now())); } catch { /* bookkeeping only */ }
    if (info.restored) tell({ key: null, error: null, quota: false, notice: RESTORED_NOTICE, fallback: false, restored: true });
    let bc = null;
    if ('bc' in o) bc = o.bc || null;
    else if (typeof globalThis.BroadcastChannel === 'function') try { bc = new globalThis.BroadcastChannel(DB_NAME); } catch { bc = null; }
    return idbStore(db, st, o, info, bc);
  })().catch(e => {
    if (db) try { db.close(); } catch { /* closed */ }
    return fallback(/timed out/.test(String(e && e.message)) ? 'timeout' : 'failed', e);
  });
}
