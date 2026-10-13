// Shared fakes of the browser storage APIs for the integrator's tests (owner I): a localStorage-like Storage with a quota,
// and a minimal IndexedDB (atomic multi-store transactions, async requests, quota at commit, write counters, fault
// hooks). Used by tests/appstore.test.mjs and the main.js simulation (tests/main-sim.mjs).
export function fakeStorage(init, o = {}) {
  const m = new Map(Object.entries(init || {}));
  const st = {
    m, writes: [], quota: o.quota || Infinity, broken: false,
    get length() { return m.size; },
    key: i => [...m.keys()][i] ?? null,
    getItem(k) { if (st.broken) throw new DOMException('blocked', 'SecurityError'); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) {
      if (st.broken) throw new DOMException('blocked', 'SecurityError');
      v = String(v);
      let size = 0; for (const [a, b] of m) if (a !== k) size += a.length + b.length;
      if (size + k.length + v.length > st.quota) throw new DOMException('full', 'QuotaExceededError');
      m.set(k, v); st.writes.push(k);
    },
    removeItem(k) { m.delete(k); st.writes.push('-' + k); },
  };
  return st;
}

// Minimal IndexedDB: atomic multi-store transactions (staged, committed at the end), async requests, quota budget at
// commit, write counters, and fault hooks (transaction() throwing, puts corrupted, open failures).
export function fakeIDB(o = {}) {
  const dbs = new Map();
  const later = fn => setTimeout(fn, 0);
  const f = {
    dbs, budget: o.budget || Infinity, stats: { tx: 0, put: {}, del: {}, clear: {} }, failTx: null, corrupt: null,
    bytes(name) { const d = dbs.get(name); let n = 0; if (d) for (const s of d.stores.values()) for (const v of s.data.values()) n += JSON.stringify(v).length; return n; },
    data(name, store) { return dbs.get(name).stores.get(store).data; },
    resetStats() { f.stats = { tx: 0, put: {}, del: {}, clear: {} }; },
  };
  const bump = (k, s) => { f.stats[k][s] = (f.stats[k][s] || 0) + 1; };
  function makeTx(d, names, mode) {
    if (f.failTx && f.failTx(names, mode)) throw new DOMException('The database connection is closing.', 'InvalidStateError');
    f.stats.tx++;
    const work = new Map(); // store → staged Map
    const view = n => { if (!work.has(n)) work.set(n, new Map(d.stores.get(n).data)); return work.get(n); };
    const tx = { error: null, oncomplete: null, onerror: null, onabort: null, pending: 0, done: false };
    const finish = () => {
      if (tx.done || tx.pending) return;
      tx.done = true;
      later(() => {
        if (mode === 'readwrite') {
          let n = 0;
          for (const [name, s] of d.stores) for (const v of (work.get(name) || s.data).values()) n += JSON.stringify(v).length;
          if (n > f.budget) { tx.error = new DOMException('quota', 'QuotaExceededError'); tx.onabort && tx.onabort(); return; }
          for (const [n2, m] of work) d.stores.get(n2).data = m;
        }
        tx.oncomplete && tx.oncomplete();
      });
    };
    const run = fn => {
      const r = { transaction: tx, result: undefined, error: null };
      tx.pending++;
      later(() => {
        try { r.result = fn(); r.onsuccess && r.onsuccess(); } catch (e) { r.error = e; tx.error = e; r.onerror && r.onerror(); tx.onerror && tx.onerror({ target: r }); tx.done = true; tx.onabort && tx.onabort(); return; }
        tx.pending--; finish();
      });
      return r;
    };
    tx.abort = () => { tx.done = true; later(() => tx.onabort && tx.onabort()); };
    tx.objectStore = name => {
      if (!names.includes(name)) throw new DOMException('no store', 'NotFoundError');
      const kp = d.stores.get(name).keyPath, rw = () => { if (mode !== 'readwrite') throw new DOMException('read only', 'ReadOnlyError'); };
      return {
        get: k => run(() => (view(name).has(k) ? structuredClone(view(name).get(k)) : undefined)),
        getAll: () => run(() => [...view(name).values()].map(v => structuredClone(v))),
        put: v => { rw(); bump('put', name); return run(() => { let w = structuredClone(v); if (f.corrupt) w = f.corrupt(name, w) || w; view(name).set(v[kp], w); return v[kp]; }); },
        delete: k => { rw(); bump('del', name); return run(() => { view(name).delete(k); }); },
        clear: () => { rw(); bump('clear', name); return run(() => { view(name).clear(); }); },
        count: k => run(() => (k === undefined ? view(name).size : view(name).has(k) ? 1 : 0)),
        index: ix => {
          const kp2 = d.stores.get(name).idx[ix];
          if (!kp2) throw new DOMException('no index', 'NotFoundError');
          return { getAll: k => run(() => [...view(name).values()].filter(v => k === undefined || v[kp2] === k).map(v => structuredClone(v))) };
        },
      };
    };
    later(finish); // a transaction without requests completes too
    return tx;
  }
  f.open = function (name, version) {
    const r = { result: null, error: null };
    if (f.openMode === 'throw') throw new DOMException('denied', 'SecurityError');
    later(() => {
      if (f.openMode === 'error') { r.error = new DOMException('broken', 'UnknownError'); r.onerror && r.onerror(); return; }
      if (f.openMode === 'hang') return;
      let d = dbs.get(name);
      const up = !d || d.version < version;
      if (!d) { d = { version, stores: new Map() }; dbs.set(name, d); }
      const db = {
        closed: false,
        objectStoreNames: { contains: n => d.stores.has(n) },
        createObjectStore(n, opt) {
          const st = { keyPath: opt.keyPath, data: new Map(), idx: {} };
          d.stores.set(n, st);
          return { createIndex(name, kp) { st.idx[name] = kp; return {}; } };
        },
        transaction(ns, mode) { if (this.closed) throw new DOMException('closed', 'InvalidStateError'); return makeTx(d, [].concat(ns), mode || 'readonly'); },
        close() { this.closed = true; },
      };
      r.result = db;
      if (up) { d.version = version; r.onupgradeneeded && r.onupgradeneeded(); }
      r.onsuccess && r.onsuccess();
    });
    return r;
  };
  f.openMode = o.open || 'ok';
  return f;
}
