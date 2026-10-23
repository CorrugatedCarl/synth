// patch-core.js — patchable modules' pure model (IMPL-9 §1, §2.6, §3.2, §4.5, §7.4; lane K9 — IMPL-9b §1.2–§1.4, §4.4; lane K9b). ES module whose only import is the
// family's table (its one import, registering FAMILIES — a family = its table, D5): no family's name, number or constant here, every type, jack and
// reason word read from FAMILIES[f]; no DOM / timers / storage; node-tested (tests/patch-core.test.mjs).
//
// The record (`dev.patch`, §1.2), normalised by normPatch(rec, f) (exact shapes, every bound, every §1.3 rule — a violating cord
// dropped —, unknown fields dropped; idempotent, never throws; anything else → fresh(f)):
//   { v: 1, f, nid 1…1e6 (≥ 1 + every module's number), mods: { m<n> (1…999999): { t, drv?: m<k>, name? ≤ 24 } } (≤ 512, the lowest
//     numbers kept; a type unknown to the family is KEPT as data — a newer file — and plays silent: payload leaves it out),
//     cid 1…1e6 (≥ 1 + every cord's number), cords: [{ id c<n> (1…999999), a: end (source), b: end (destination), c 0…7 } |
//     { id, a, b, via: 'pin' } (a matrix pin: no colour, outside the one-plug rule) — each + g 0…4 when ≠ 1] (≤ 4096, in order),
//     name? ≤ 40 }   end = '<mid>.<port>' | 'c.<port>' (`c` the controller: never in mods, never deleted)
// Knob values live in the device's vals (§1.2): the controller's flat ids and vals.p = { m<n>: { _t: <type>, <param>: number } };
//   getKnob / setKnob read / write them (`_t` checked: a mismatch reads the defaults, a write starts the entry afresh), pruneVals
//   (load only) drops orphans and mismatches, clamps, drops ids the type lacks.
// canPlug(rec, from, to, f) → { ok, why, a, b } (§1.3; a / b the cord's ends oriented source → destination): same plug kind
//   (1/4" ↔ 1/4", S ↔ S), one cord per jack, out → in; a multiple (`dir: 'any'`) takes the direction its other end implies; two
//   multiples (P-3) only when exactly one group is driven (a group is driven when some connection ends in it), from the driven one;
//   feedback allowed; ≤ 4096 cords. why = the reason the drag shows on a dimmed jack.
// Edits — pure: a new record (and vals) back, the inputs untouched; nothing changed → the SAME rec object (the host records no
//   step). Those that create a module take vals (numbering: nextId(rec, vals) = max(nid, 1 + every m<k> of mods and vals.p) — an
//   orphan's number is never reused while its values live, §1.5); those that write knobs return `back` = { f: [[path, before,
//   after], …] } (path ['<flat id>'] | ['p', mid, id]; null = absent) — the host adds { trackId, dev } and ptBack(vals, back,
//   redo) puts them back (the sxBack rule: only while every field holds the other side, else ok false and a notice).
//   addModule(rec, vals, type) → { rec, mid } (a linked type driven by the first driver with room)
//   removeModule(rec, mid) → { rec, cords: [ids pulled], undriven: [mids] }      duplicateModule(rec, vals, mid) → { rec, vals, mid }
//   plug(rec, from, to, c?) → { rec, id, a, b }      pull(rec, id) → { rec, cord }      repatch(rec, id, which 'a'|'b'|end, to) → { rec, a, b }
//   setColor(rec, id, c) → { rec }      setDriver(rec, mid, drv | null) → { rec }      setName(rec, mid | null (the patch), name) → { rec }
//   loadPreset(rec, vals, name | preset, { ensure?: [types] }) → { rec, vals, back, added, bound }   (the topology replaced, the
//     bound modules' and the controller's knobs written, the rest kept; ensure: add modules until the patch holds that set)
//   loadSet(rec, vals, id?) = a set's starter on its full set (FAMILY.sets[id]; none: the family's set — a set tile on the family's
//     own instrument, §1.4; IMPL-9b §1.2)   setNeeds(rec, id) → the modules it would add   initPatch(rec, vals) → { rec, vals, back }
//   A refusal → { rec (the same), why }. A preset writes every routing switch of the patch (IMPL-9b §1.4: its own panels' as
//   written, the others' lit ones off) and puts them in back.
// Rear terminals (a jack's `rear: 1`, IMPL-9b §1.3) are no cord's end: endOf / canPlug / jacksOf / normPatch treat them as absent.
// Bus rows (a type's `bus`, IMPL-9b §1.4): routing switches' hidden connections, resolved from vals — busRows(rec, f, vals),
//   busInfo(rec, f, vals, mid) (a panel's rows for its tips), isBusKnob(rec, mid, id).
// payload(rec, f, vals?) → { pg, pk } (§3.2): pg = { v: 1, f, mods: [[n, type, drvN | -1]] (0 = the controller), cords: [[aN, aPort,
//   bN, bPort, g]] (port = the jack's index in its type; the cords sorted, then the live bus rows sorted) }; pk = FNV-1a of pg
//   (colours, names, cord ids never in it). vals absent → no bus rows (stage 9's payload).
// live(rec, f, vals?) — the family's sink (the controller's output jack) patched; liveNodes(rec, f, vals?); rackLayout(rec, f, sizes)
// → { mid: { x, y } } relative to the controller's top-left (§4.5; the console row, the wide rack: IMPL-9b §4.4); freeSlot(rec, f,
// mid, placed, sizes); ordinal / title; jacksOf / targets / cordAt (the drag's lists); nextColor (the least-used of PALETTE, ties in
// palette order); familyOf / isPatchModel; fresh.
import * as MG from './moog-core.js?v=9';

/* ---------------------------------------------------------------- bounds and tables */
// IMPL-P §3: safety bounds, not product caps — a person adds racks until their system lags (a corrupt or hostile file, runaway memory
// are what these stop): ≥ an order of magnitude above anything built (the biggest set is 37 modules, 3 cords a module). Ids are never
// reused, so their range is the rack's lifetime: 6 digits each. The evaluator's guards (patch-dsp MAXM / MAXC / MAXN) are ≥ these.
export const MAX_MODS = 512, MAX_CORDS = 4096, MAX_NID = 1e6, MAX_CID = 1e6, MOD_NAME = 24, PATCH_NAME = 40, G_MAX = 4;
export const CTL = 'c';                                                // the controller's module id (reserved)
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
/** The cord colours (cord lab LAB:143, §4.3); a cord stores its index `c`. */
export const PALETTE = deepFreeze([{ name: 'Red', hex: '#d8432f' }, { name: 'Yellow', hex: '#e6b83a' }, { name: 'Blue', hex: '#3f80d8' },
  { name: 'Green', hex: '#41a75c' }, { name: 'Cream', hex: '#e9e5da' }, { name: 'Orange', hex: '#e27c2f' }, { name: 'Violet', hex: '#9060c9' },
  { name: 'Black', hex: '#2f3033' }]);
/** The families by id (registered by their tables' import). */
export const FAMILIES = Object.freeze({ [MG.FAMILY.id]: MG.FAMILY });

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
const famOf = f => (typeof f === 'string' && own(FAMILIES, f) ? FAMILIES[f] : null);
const typeOf = (fam, t) => (typeof t === 'string' && own(fam.types, t) ? fam.types[t] : null);
const MID_RE = /^m([1-9]\d{0,5})$/, CID_RE = /^c([1-9]\d{0,5})$/, PORT_RE = /^[a-z][a-z0-9]{0,7}$/, TYPE_RE = /^[a-z0-9]{1,8}$/;
const midNum = s => { const m = typeof s === 'string' ? MID_RE.exec(s) : null, n = m ? +m[1] : 0; return n < MAX_NID ? n : 0; };
const cidNum = s => { const m = typeof s === 'string' ? CID_RE.exec(s) : null, n = m ? +m[1] : 0; return n < MAX_CID ? n : 0; };
/** A module / cord id the core accepts — 'm<1…999999>' / 'c<1…999999>' (the controller 'c' is neither): the ONE grammar every site uses
 *  (the evaluator's number bound, the view's midOf, the host's event / sequencer binds, makeSet's numbering). */
export const isMid = s => midNum(s) > 0;
export const isCid = s => cidNum(s) > 0;
const num = mid => (mid === CTL ? 0 : midNum(mid));
const byNum = (a, b) => midNum(a) - midNum(b);
// (every id's number parsed once, then a stable sort: the order of Object.keys(M).sort(byNum), without a regex a comparison)
const sortKeys = M => { const d = Object.keys(M).map(k => [midNum(k), k]); d.sort((a, b) => a[0] - b[0]); return d.map(x => x[1]); };
const mids = rec => sortKeys(rec.mods);
const endMid = e => e.slice(0, e.indexOf('.'));
const same = (a, b) => a === b || (a == null && b == null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);
const clampP = (c, x) => (c.t === 's' ? Math.max(0, Math.min(c.opts.length - 1, Math.round(x))) : Math.max(c.min, Math.min(c.max, x)));
const pval = (c, x) => (typeof x === 'number' && isFinite(x) ? clampP(c, x) : c.def);
const JX = new WeakMap();                                              // TYPE → Map(jack id → index)
function jackIx(T) {
  let m = JX.get(T);
  if (!m) { m = new Map(); T.jacks.forEach((j, i) => m.set(j.id, i)); JX.set(T, m); }
  return m;
}
const paramOf = (T, id) => (T ? T.params.find(c => c.id === id) || null : null);

/** The family id of a model (id or MODELS entry): the family whose `model` it is, else null. */
export function familyOf(model) {
  const id = typeof model === 'string' ? model : isObj(model) && typeof model.id === 'string' ? model.id : null;
  if (!id) return null;
  for (const k of Object.keys(FAMILIES)) if (FAMILIES[k].model === id) return k;
  return null;
}
export const isPatchModel = model => familyOf(model) !== null;
/** A record with the controller only. */
export const fresh = f => ({ v: 1, f: famOf(f) ? f : MG.FAMILY.id, nid: 1, mods: {}, cid: 1, cords: [] });

/* ---------------------------------------------------------------- ends */
// '<mid>.<port>' → { end, mid, port, t, T (null: a type the family lacks), j, i } | null (malformed, no such module or jack; a rear
// terminal unless `rear` — IMPL-9b §1.3: never a cord's end, bus rows only)
function endOf(fam, mods, end, rear) {
  if (typeof end !== 'string') return null;
  const k = end.indexOf('.');
  if (k < 1) return null;
  const mid = end.slice(0, k), port = end.slice(k + 1);
  if (!PORT_RE.test(port)) return null;
  let t;
  if (mid === CTL) t = fam.ctl;
  else if (midNum(mid) && own(mods, mid) && isObj(mods[mid])) t = mods[mid].t;
  else return null;
  const T = typeOf(fam, t);
  if (!T) return { end, mid, port, t, T: null, j: null, i: -1 };
  const i = jackIx(T).get(port);
  return i === undefined || (T.jacks[i].rear === 1 && rear !== true) ? null : { end, mid, port, t, T, j: T.jacks[i], i };
}
const occupied = (cords, end) => cords.some(c => !c.via && (c.a === end || c.b === end));
// a multiple group (the `any` jacks of E's section) is driven when some connection ends in it
function driven(cords, E) {
  const g = new Set(E.T.jacks.filter(j => j.dir === 'any' && j.sec === E.j.sec).map(j => E.mid + '.' + j.id));
  return cords.some(c => g.has(c.b));
}

/* ---------------------------------------------------------------- normPatch */
export function normPatch(rec, f) {
  try { return norm(rec, f); } catch (err) { return fresh(famOf(f) ? f : null); }
}
function norm(rec, f) {
  const fid = famOf(f) ? f : isObj(rec) && famOf(rec.f) ? rec.f : MG.FAMILY.id, fam = FAMILIES[fid];
  if (!isObj(rec) || (rec.f !== undefined && rec.f !== fid)) return fresh(fid);
  // modules: valid ids, a type string (not the controller's), the lowest MAX_MODS numbers
  const M = isObj(rec.mods) ? rec.mods : {}, list = [];
  for (const k of Object.keys(M)) {
    const n = midNum(k), o = M[k];
    if (!n || !isObj(o) || typeof o.t !== 'string' || !TYPE_RE.test(o.t) || o.t === fam.ctl) continue;
    list.push([n, k, o]);
  }
  list.sort((a, b) => a[0] - b[0]);
  if (list.length > MAX_MODS) list.length = MAX_MODS;
  const mods = {}, drives = {};
  for (const [, k, o] of list) { const m = { t: o.t }; if (typeof o.name === 'string' && o.name) m.name = o.name.slice(0, MOD_NAME); mods[k] = m; }
  // drivers: a linked type's drv names a module of its link's type with room (number order)
  for (const [, k, o] of list) {
    const L = (typeOf(fam, o.t) || {}).link, d = o.drv;
    if (!L || typeof d !== 'string' || !own(mods, d) || mods[d].t !== L.to || (drives[d] || 0) >= L.max) continue;
    drives[d] = (drives[d] || 0) + 1;
    mods[k] = Object.assign({ t: mods[k].t, drv: d }, mods[k].name ? { name: mods[k].name } : {});
  }
  // connections
  const C = Array.isArray(rec.cords) ? rec.cords : [], cords = [], ids = new Set(), occ = new Set();
  let hiC = 0;
  for (const c of C) {
    if (cords.length >= MAX_CORDS) break;
    if (!isObj(c)) continue;
    const n = cidNum(c.id);
    if (!n || ids.has(c.id)) continue;
    let A = endOf(fam, mods, c.a), B = endOf(fam, mods, c.b);
    if (!A || !B || A.end === B.end) continue;
    const pin = c.via === 'pin';
    if (A.T && B.T) {
      if (A.j.sig !== B.j.sig) continue;
      const src = d => d === 'out' || d === 'any', dst = d => d === 'in' || d === 'any';
      if (!(src(A.j.dir) && dst(B.j.dir))) { if (src(B.j.dir) && dst(A.j.dir)) [A, B] = [B, A]; else continue; }
      if (A.j.dir === 'any' && B.j.dir === 'any' && A.mid === B.mid && A.j.sec === B.j.sec) continue;
    }
    if (!pin && (occ.has(A.end) || occ.has(B.end))) continue;
    const o = { id: c.id, a: A.end, b: B.end };
    if (pin) o.via = 'pin';
    else { o.c = Number.isInteger(c.c) && c.c >= 0 && c.c < PALETTE.length ? c.c : 0; occ.add(A.end); occ.add(B.end); }
    if (typeof c.g === 'number' && isFinite(c.g)) { const g = Math.max(0, Math.min(G_MAX, c.g)); if (g !== 1) o.g = g === 0 ? 0 : g; }
    cords.push(o); ids.add(c.id); hiC = Math.max(hiC, n);
  }
  const hiM = list.length ? list[list.length - 1][0] : 0;
  const int = (x, lo, hi) => (Number.isInteger(x) ? Math.max(lo, Math.min(hi, x)) : lo);
  const out = { v: 1, f: fid, nid: Math.min(MAX_NID, Math.max(int(rec.nid, 1, MAX_NID), hiM + 1)), mods,
    cid: Math.min(MAX_CID, Math.max(int(rec.cid, 1, MAX_CID), hiC + 1)), cords };
  if (typeof rec.name === 'string' && rec.name) out.name = rec.name.slice(0, PATCH_NAME);
  return out;
}

/* ---------------------------------------------------------------- vals */
/** Load-time cleanup (§1.2): vals.p keeps an entry only for a module of the record whose type its `_t` names; inside it, numbers
 *  only — for a known type its params' ids, clamped (switches rounded), the rest dropped. A new vals object (p always present). */
export function pruneVals(vals, rec) {
  const v = isObj(vals) ? vals : {}, p = isObj(v.p) ? v.p : {}, M = isObj(rec) && isObj(rec.mods) ? rec.mods : {};
  const fam = famOf(isObj(rec) ? rec.f : null), np = {};
  for (const k of Object.keys(p)) {
    const e = p[k];
    if (!own(M, k) || !isObj(e) || e._t !== M[k].t) continue;
    const T = fam ? typeOf(fam, M[k].t) : null, ne = { _t: e._t };
    for (const id of Object.keys(e)) {
      if (id === '_t' || typeof e[id] !== 'number' || !isFinite(e[id])) continue;
      if (!T) { ne[id] = e[id]; continue; }
      const c = paramOf(T, id);
      if (c) ne[id] = clampP(c, e[id]);
    }
    np[k] = ne;
  }
  return Object.assign({}, v, { p: np });
}
/** A knob's value (the controller's flat id for mid 'c'): the stored one when its entry's `_t` is the module's type, else the
 *  default; undefined for an id the type lacks. */
export function getKnob(vals, rec, mid, id) {
  const fam = famOf(rec && rec.f);
  if (!fam) return undefined;
  const v = isObj(vals) ? vals : {};
  if (mid === CTL) { const c = paramOf(fam.types[fam.ctl], id); return c ? pval(c, v[id]) : undefined; }
  const m = isObj(rec.mods) && own(rec.mods, mid) ? rec.mods[mid] : null, c = m ? paramOf(typeOf(fam, m.t), id) : null;
  if (!c) return undefined;
  const e = isObj(v.p) && isObj(v.p[mid]) ? v.p[mid] : null;
  return e && e._t === m.t ? pval(c, e[id]) : c.def;
}
/** The knob policy's write (§1.5: no History step): a new vals with the value clamped; an entry of another `_t` starts afresh. */
export function setKnob(vals, rec, mid, id, x) {
  const fam = famOf(rec && rec.f), v = isObj(vals) ? vals : {};
  if (!fam || typeof x !== 'number' || !isFinite(x)) return vals;
  if (mid === CTL) { const c = paramOf(fam.types[fam.ctl], id); return c ? Object.assign({}, v, { [id]: clampP(c, x) }) : vals; }
  const m = isObj(rec.mods) && own(rec.mods, mid) ? rec.mods[mid] : null, c = m ? paramOf(typeOf(fam, m.t), id) : null;
  if (!c) return vals;
  const p = isObj(v.p) ? v.p : {}, e0 = isObj(p[mid]) && p[mid]._t === m.t ? p[mid] : { _t: m.t };
  return Object.assign({}, v, { p: Object.assign({}, p, { [mid]: Object.assign({}, e0, { [id]: clampP(c, x) }) }) });
}
// a field of vals at a back path (null = absent)
function fieldOf(v, path) {
  if (path.length === 1) return own(v, path[0]) && v[path[0]] !== undefined ? v[path[0]] : null;
  const e = isObj(v.p) && isObj(v.p[path[1]]) ? v.p[path[1]] : null;
  return e && own(e, path[2]) && e[path[2]] !== undefined ? e[path[2]] : null;
}
// back.f of a knob-writing edit: the controller's ids and the touched entries' fields that differ
function diffVals(a, b, ids, ms) {
  const f = [];
  for (const id of ids) { const x = fieldOf(a, [id]), y = fieldOf(b, [id]); if (!same(x, y)) f.push([[id], x, y]); }
  for (const mid of ms) {
    const ea = isObj(a.p) && isObj(a.p[mid]) ? a.p[mid] : {}, eb = isObj(b.p) && isObj(b.p[mid]) ? b.p[mid] : {};
    for (const k of new Set([...Object.keys(ea), ...Object.keys(eb)])) {
      const path = ['p', mid, k], x = fieldOf(a, path), y = fieldOf(b, path);
      if (!same(x, y)) f.push([path, x, y]);
    }
  }
  return f;
}
/** Undo (redo false) / redo (true) of a knob-writing step's meta (§1.5): { vals, ok, already } — the other side written only while
 *  every field still holds this side's value (else ok false: "changed since", vals untouched); already: every field holds it. */
export function ptBack(vals, back, redo) {
  const F = isObj(back) && Array.isArray(back.f) ? back.f : [], v = isObj(vals) ? vals : {}, to = redo ? 2 : 1, from = redo ? 1 : 2;
  if (F.every(x => same(fieldOf(v, x[0]), x[to]))) return { vals, ok: true, already: true };
  if (!F.every(x => same(fieldOf(v, x[0]), x[from]))) return { vals, ok: false, already: false };
  const nv = Object.assign({}, v), np = isObj(v.p) ? Object.assign({}, v.p) : {}, cp = new Set();
  let tp = isObj(v.p);
  for (const x of F) {
    const [path] = x, y = x[to];
    if (path.length === 1) { if (y === null) delete nv[path[0]]; else nv[path[0]] = y; continue; }
    tp = true;
    const mid = path[1];
    if (!cp.has(mid)) { np[mid] = isObj(np[mid]) ? Object.assign({}, np[mid]) : {}; cp.add(mid); }
    if (y === null) delete np[mid][path[2]]; else np[mid][path[2]] = y;
  }
  for (const mid of cp) if (!Object.keys(np[mid]).length) delete np[mid];
  if (tp) nv.p = np;
  return { vals: nv, ok: true, already: false };
}

/* ---------------------------------------------------------------- canPlug */
// canPlug's rules on two resolved ends; the cords' lookups injected (occ(end): a plug on it; drv(E): E's multiple group is driven) — canPlug
// asks the cord list (O(cords) a call), targets one set for the whole drag (O(1))
function verdict(fam, cords, A, B, from, to, occ, drv) {
  const no = why => ({ ok: false, why, a: from, b: to });
  if (!A || !B) return no('No such jack');
  if (!A.T || !B.T) return no('This module needs a newer version of the app');
  if (A.end === B.end) return no('Pick another jack');
  if (occ(B.end) || occ(A.end)) return no('This jack has a cord — pull it first');
  if (A.j.sig !== B.j.sig) return no(fam.plugs[B.j.sig] + ' — ' + fam.conv);
  const da = A.j.dir, db = B.j.dir;
  let s, d;
  if (da === 'any' && db === 'any') {
    if (A.mid === B.mid && A.j.sec === B.j.sec) return no('These jacks are one multiple already');
    const ga = drv(A), gb = drv(B);
    if (ga === gb) return no(ga ? 'Both multiples are driven — pull one’s source first' : 'Neither multiple is driven — patch a signal into one first');
    [s, d] = ga ? [A, B] : [B, A];
  } else if (da === db) return no(da === 'out' ? 'Two outputs — connect an output to an input' : 'Two inputs — connect an output to an input');
  else if (da === 'out' || db === 'in') { s = A; d = B; }               // out → in · out → multiple · multiple → in
  else { s = B; d = A; }                                                // in ← out · in ← multiple · multiple ← out
  if (cords.length >= MAX_CORDS) return no(`A patch holds at most ${MAX_CORDS} cords`);
  return { ok: true, why: '', a: s.end, b: d.end };
}
export function canPlug(rec, from, to, f) {
  const fam = famOf(f) || famOf(rec && rec.f);
  if (!fam || !isObj(rec) || !isObj(rec.mods)) return { ok: false, why: 'No patch', a: from, b: to };
  const cords = Array.isArray(rec.cords) ? rec.cords : [];
  return verdict(fam, cords, endOf(fam, rec.mods, from), endOf(fam, rec.mods, to), from, to, end => occupied(cords, end), E => driven(cords, E));
}
/** The cord plugged at a jack: { id, which: 'a' | 'b' } | null (pins are not plugs). */
export function cordAt(rec, end) {
  for (const c of (isObj(rec) && Array.isArray(rec.cords) ? rec.cords : [])) if (!c.via && (c.a === end || c.b === end)) return { id: c.id, which: c.a === end ? 'a' : 'b' };
  return null;
}
/** Every jack of the patch a cord can take (the controller first, then by number; rear terminals left out):
 *  [{ end, mid, port, type, dir, sig, role, label, sec }]. */
export function jacksOf(rec, f) {
  const fam = famOf(f) || famOf(rec && rec.f), out = [];
  if (!fam || !isObj(rec) || !isObj(rec.mods)) return out;
  for (const mid of [CTL, ...mids(rec)]) {
    const t = mid === CTL ? fam.ctl : rec.mods[mid].t, T = typeOf(fam, t);
    if (T) for (const j of T.jacks) if (j.rear !== 1) out.push({ end: mid + '.' + j.id, mid, port: j.id, type: t, dir: j.dir, sig: j.sig, role: j.role, label: j.label, sec: j.sec });
  }
  return out;
}
/** "Connect to…" and the drag's halos (§4.4): every other jack with canPlug's verdict, [{ end, mid, label, ok, why }]. */
export function targets(rec, from, f) {
  const fam = famOf(f) || famOf(rec && rec.f), J = jacksOf(rec, f);
  if (!fam || !J.length) return [];                                    // (jacksOf: no patch → none)
  // canPlug's verdict per jack with the cords read once (IMPL-P §3.2: O(jacks + cords), was O(jacks × cords)): the plugged ends, the ends cords reach
  const cords = Array.isArray(rec.cords) ? rec.cords : [], plugged = new Set(), reached = new Set();
  for (const c of cords) if (c) { if (!c.via) { plugged.add(c.a); plugged.add(c.b); } reached.add(c.b); }
  const A = endOf(fam, rec.mods, from), grp = new Map();               // grp: 'mid:sec' → whether some cord ends in that multiple group
  const drv = E => {
    const k = E.mid + ':' + E.j.sec;
    let v = grp.get(k);
    if (v === undefined) { v = E.T.jacks.some(j => j.dir === 'any' && j.sec === E.j.sec && reached.has(E.mid + '.' + j.id)); grp.set(k, v); }
    return v;
  };
  const out = [];
  for (const j of J) {
    if (j.end === from) continue;
    const k = verdict(fam, cords, A, endOf(fam, rec.mods, j.end), from, j.end, end => plugged.has(end), drv);
    out.push({ end: j.end, mid: j.mid, label: j.label, ok: k.ok, why: k.why });
  }
  return out;
}
/** The colour a new cord takes (Q3): the least used of PALETTE among the patch's cords, ties in palette order. */
export function nextColor(rec) {
  const n = PALETTE.map(() => 0);
  for (const c of (isObj(rec) && Array.isArray(rec.cords) ? rec.cords : [])) if (!c.via && Number.isInteger(c.c) && c.c >= 0 && c.c < n.length) n[c.c]++;
  let best = 0;
  for (let i = 1; i < n.length; i++) if (n[i] < n[best]) best = i;
  return best;
}

/* ---------------------------------------------------------------- edits */
const copyRec = rec => Object.assign({}, rec, { mods: Object.assign({}, rec.mods), cords: rec.cords.slice() });
const famRec = rec => (isObj(rec) && isObj(rec.mods) && Array.isArray(rec.cords) ? famOf(rec.f) : null);
const drivenBy = (rec, d, except) => Object.keys(rec.mods).filter(k => k !== except && rec.mods[k].drv === d).length;
// the first module (by number) of the link's type with room, or null
const freeDriver = (rec, L, except) => mids(rec).find(k => rec.mods[k].t === L.to && drivenBy(rec, k, except) < L.max) || null;
const withDrv = (o, d) => { const m = { t: o.t }; if (d) m.drv = d; if (o.name) m.name = o.name; return m; };

/** The number a new module takes (§1.5): max(nid, 1 + every m<k> of the record and of vals.p); 0 when none is left. */
export function nextId(rec, vals) {
  let n = isObj(rec) && Number.isInteger(rec.nid) && rec.nid > 0 ? rec.nid : 1;
  const hi = o => { if (isObj(o)) for (const k of Object.keys(o)) { const m = midNum(k); if (m >= n) n = m + 1; } };
  hi(isObj(rec) ? rec.mods : null); hi(isObj(vals) ? vals.p : null);
  return n < MAX_NID ? n : 0;
}
export function addModule(rec, vals, type) {
  const fam = famRec(rec);
  if (!fam || type === fam.ctl || !typeOf(fam, type)) return { rec, mid: null, why: 'No such module' };
  if (Object.keys(rec.mods).length >= MAX_MODS) return { rec, mid: null, why: `A patch holds at most ${MAX_MODS} modules` };
  const n = nextId(rec, vals);
  if (!n) return { rec, mid: null, why: 'No module numbers left' };
  const r = copyRec(rec), mid = 'm' + n, L = fam.types[type].link;
  r.mods[mid] = withDrv({ t: type }, L ? freeDriver(rec, L, null) : null);
  r.nid = n + 1;
  return { rec: r, mid };
}
export function removeModule(rec, mid) {
  if (!famRec(rec) || mid === CTL || !own(rec.mods, mid)) return { rec, why: 'No such module', cords: [], undriven: [] };
  const r = copyRec(rec), gone = [], undriven = [];
  delete r.mods[mid];
  r.cords = rec.cords.filter(c => (endMid(c.a) === mid || endMid(c.b) === mid ? (gone.push(c.id), false) : true));
  for (const k of mids(r)) if (r.mods[k].drv === mid) { r.mods[k] = withDrv(r.mods[k], null); undriven.push(k); }
  return { rec: r, cords: gone, undriven };
}
/** Duplicate (§4.5): the same type, its values copied (when its entry is its type's), no cords; a linked module keeps its driver
 *  while that has room. */
export function duplicateModule(rec, vals, mid) {
  const fam = famRec(rec);
  if (!fam || mid === CTL || !own(rec.mods, mid)) return { rec, vals, mid: null, why: 'No such module' };
  const src = rec.mods[mid], x = addModule(rec, vals, src.t);
  if (!x.mid) return { rec, vals, mid: null, why: x.why };
  const L = fam.types[src.t].link, r = x.rec;
  if (L && src.drv && drivenBy(r, src.drv, x.mid) < L.max) r.mods[x.mid] = withDrv(r.mods[x.mid], src.drv);
  const v = isObj(vals) ? vals : {}, e = isObj(v.p) && isObj(v.p[mid]) && v.p[mid]._t === src.t ? v.p[mid] : null;
  return { rec: r, vals: e ? Object.assign({}, v, { p: Object.assign({}, v.p, { [x.mid]: Object.assign({}, e) }) }) : vals, mid: x.mid };
}
export function plug(rec, from, to, c) {
  if (!famRec(rec)) return { rec, why: 'No patch' };
  const k = canPlug(rec, from, to);
  if (!k.ok) return { rec, why: k.why };
  if (!(rec.cid < MAX_CID)) return { rec, why: 'No cord numbers left' };
  const r = copyRec(rec), id = 'c' + rec.cid;
  r.cords.push({ id, a: k.a, b: k.b, c: Number.isInteger(c) && c >= 0 && c < PALETTE.length ? c : nextColor(rec) });
  r.cid = rec.cid + 1;
  return { rec: r, id, a: k.a, b: k.b };
}
export function pull(rec, id) {
  const i = famRec(rec) ? rec.cords.findIndex(c => c.id === id) : -1;
  if (i < 0) return { rec, why: 'No such cord' };
  const r = copyRec(rec), [cord] = r.cords.splice(i, 1);
  return { rec: r, cord };
}
/** Re-patch one end (§4.4): `which` the moving end ('a' / 'b', or its end string) goes to `to`; the cord keeps its id and colour,
 *  re-oriented by canPlug against the patch without it; `to` = where it already is → the same rec. */
export function repatch(rec, id, which, to) {
  const i = famRec(rec) ? rec.cords.findIndex(c => c.id === id && !c.via) : -1;
  if (i < 0) return { rec, why: 'No such cord' };
  const c = rec.cords[i], w = which === 'a' || which === c.a ? 'a' : which === 'b' || which === c.b ? 'b' : null;
  if (!w) return { rec, why: 'No such end' };
  if (to === c[w]) return { rec, a: c.a, b: c.b };
  const k = canPlug(Object.assign({}, rec, { cords: rec.cords.filter((_, j) => j !== i) }), w === 'a' ? c.b : c.a, to);
  if (!k.ok) return { rec, why: k.why };
  const r = copyRec(rec);
  r.cords[i] = Object.assign({}, c, { a: k.a, b: k.b });
  return { rec: r, a: k.a, b: k.b };
}
export function setColor(rec, id, c) {
  const i = famRec(rec) ? rec.cords.findIndex(x => x.id === id && !x.via) : -1;
  if (i < 0 || !Number.isInteger(c) || c < 0 || c >= PALETTE.length) return { rec, why: 'No such cord' };
  if (rec.cords[i].c === c) return { rec };
  const r = copyRec(rec);
  r.cords[i] = Object.assign({}, rec.cords[i], { c });
  return { rec: r };
}
export function setDriver(rec, mid, drv) {
  const fam = famRec(rec), m = fam && mid !== CTL && own(rec.mods, mid) ? rec.mods[mid] : null, T = m ? typeOf(fam, m.t) : null;
  if (!T || !T.link) return { rec, why: 'This module takes no driver' };
  const d = drv == null ? null : drv;
  if ((m.drv || null) === d) return { rec };
  if (d !== null) {
    if (!own(rec.mods, d) || rec.mods[d].t !== T.link.to) return { rec, why: 'No such driver' };
    if (drivenBy(rec, d, mid) >= T.link.max) return { rec, why: `A ${fam.types[T.link.to].short} drives at most ${T.link.max}` };
  }
  const r = copyRec(rec);
  r.mods[mid] = withDrv(m, d);
  return { rec: r };
}
/** A module's name (≤ 24; mid null: the patch's, ≤ 40); '' / null clears it. */
export function setName(rec, mid, name) {
  const s = typeof name === 'string' ? name.slice(0, mid == null ? PATCH_NAME : MOD_NAME) : '';
  if (!famRec(rec)) return { rec, why: 'No patch' };
  if (mid == null) {
    if ((rec.name || '') === s) return { rec };
    const r = copyRec(rec);
    if (s) r.name = s; else delete r.name;
    return { rec: r };
  }
  if (mid === CTL || !own(rec.mods, mid)) return { rec, why: 'No such module' };
  const m = rec.mods[mid];
  if ((m.name || '') === s) return { rec };
  const r = copyRec(rec), o = { t: m.t };
  if (m.drv) o.drv = m.drv;
  if (s) o.name = s;
  r.mods[mid] = o;
  return { rec: r };
}
const ctlIds = fam => fam.types[fam.ctl].params.map(c => c.id);
/** A preset (§2.5) → { rec, vals, back, added, bound } (one History step with "tap to undo"; back = the knobs it wrote). */
export function loadPreset(rec, vals, which, opts) {
  const fam = famRec(rec);
  const P = !fam ? null : typeof which === 'string' ? (fam.PRESETS || []).find(x => x.name === which) || null : isObj(which) ? which : null;
  if (!P || !Array.isArray(P.mods) || !Array.isArray(P.cords)) return { rec, vals, why: 'No such patch' };
  const v0 = isObj(vals) ? vals : {}, added = [], bound = {}, used = new Set();
  let r = copyRec(rec);
  const add = t => { const x = addModule(r, v0, t); if (!x.mid) return null; r = x.rec; added.push(x.mid); return x.mid; };
  const fail = why => ({ rec, vals, why });
  const ens = opts && Array.isArray(opts.ensure) ? opts.ensure : [], seen = {};
  for (const t of ens) {                                               // the k-th occurrence of a type: add while fewer than k
    seen[t] = (seen[t] || 0) + 1;
    if (mids(r).filter(k => r.mods[k].t === t).length < seen[t] && !add(t)) return fail(`A patch holds at most ${MAX_MODS} modules`);
  }
  for (const [role, t] of P.mods) {
    if (!typeOf(fam, t) || t === fam.ctl) return fail('No such module');
    const mid = mids(r).find(k => r.mods[k].t === t && !used.has(k)) || add(t);
    if (!mid) return fail(`A patch holds at most ${MAX_MODS} modules`);
    bound[role] = mid; used.add(mid);
  }
  // drivers: a bound linked module takes the preset's driver or none; a driver past its max sheds unbound ones (highest first)
  const drv = isObj(P.drv) ? P.drv : {};
  for (const [role, t] of P.mods) if (fam.types[t].link) r.mods[bound[role]] = withDrv(r.mods[bound[role]], own(drv, role) && own(bound, drv[role]) ? bound[drv[role]] : null);
  for (const d of mids(r)) {
    const L = Object.values(fam.types).find(T => T.link && T.link.to === r.mods[d].t);
    if (!L) continue;
    const by = mids(r).filter(k => r.mods[k].drv === d), extra = by.filter(k => !used.has(k)).reverse();
    for (let n = by.length; n > L.link.max && extra.length; n--) { const k = extra.shift(); r.mods[k] = withDrv(r.mods[k], null); }
  }
  // the topology: replaced (modules it does not use stay, unpatched)
  r.cords = [];
  const end = e => { const k = String(e).indexOf('.'), role = String(e).slice(0, k); return (role === CTL ? CTL : bound[role]) + String(e).slice(k); };
  for (const [a, b] of P.cords) {
    const k = canPlug(r, end(a), end(b));
    if (!k.ok || !(r.cid < MAX_CID)) continue;
    r.cords.push({ id: 'c' + r.cid, a: k.a, b: k.b, c: nextColor(r) });
    r.cid++;
  }
  if (typeof P.name === 'string' && P.name) r.name = P.name.slice(0, PATCH_NAME); else delete r.name;
  // the knobs: the controller's and every bound module's — the preset's values, else the defaults (a whole sound)
  const nv = Object.assign({}, v0), np = Object.assign({}, isObj(v0.p) ? v0.p : {}), pv = isObj(P.v) ? P.v : {};
  const pc = isObj(pv.c) ? pv.c : {};
  for (const c of fam.types[fam.ctl].params) nv[c.id] = pval(c, pc[c.id]);
  for (const [role, t] of P.mods) {
    const e = { _t: t }, q = isObj(pv[role]) ? pv[role] : {};
    for (const c of fam.types[t].params) e[c.id] = pval(c, q[c.id]);
    np[bound[role]] = e;
  }
  // every routing switch of the patch (IMPL-9b §1.4, skeptic #6): the bound panels' as written above; an unbound panel's lit ones
  // off — no hidden row into the preset's modules (a preset is a whole sound); in back with the rest
  const ms = Object.values(bound), isB = new Set(ms);
  for (const mid of mids(r)) {
    const T = isB.has(mid) ? null : typeOf(fam, r.mods[mid].t);
    if (!T || !Array.isArray(T.bus)) continue;
    const e0 = isObj(np[mid]) && np[mid]._t === T.id ? np[mid] : null, lit = busSw(T).filter(c => (e0 ? pval(c, e0[c.id]) : c.def) !== 0);
    if (!lit.length) continue;
    const e = Object.assign({ _t: T.id }, e0);
    for (const c of lit) e[c.id] = 0;
    np[mid] = e; ms.push(mid);
  }
  nv.p = np;
  return { rec: r, vals: nv, back: { f: diffVals(v0, nv, ctlIds(fam), ms) }, added, bound };
}
// a set by id (IMPL-9b §1.2: FAMILY.sets), absent → the family's own set / starter (stage 9's)
const setOf = (fam, id) => (id == null ? { set: fam.set, starter: fam.starter } : typeof id === 'string' && isObj(fam.sets) && own(fam.sets, id) ? fam.sets[id] : null);
/** A set's starter on the full set (a set tile on the family's own instrument, §1.4; IMPL-9b §1.2): the missing modules added, the
 *  topology replaced, one step. id: a FAMILY.sets key ('m15' = the stage-9 call without one). */
export function loadSet(rec, vals, id) {
  const fam = famRec(rec), S = fam ? setOf(fam, id) : null;
  return S ? loadPreset(rec, vals, S.starter, { ensure: S.set }) : { rec, vals, why: fam ? 'No such set' : 'No patch' };
}
/** How many modules loadSet(rec, ·, id) would add (a set tile greys when the patch cannot hold them: count + this > MAX_MODS);
 *  −1 for no such set / no patch. */
export function setNeeds(rec, id) {
  const fam = famRec(rec), S = fam ? setOf(fam, id) : null;
  if (!S) return -1;
  const have = {}, need = {};
  for (const k of Object.keys(rec.mods)) if (isObj(rec.mods[k])) have[rec.mods[k].t] = (have[rec.mods[k].t] || 0) + 1;
  for (const t of S.set) need[t] = (need[t] || 0) + 1;
  let n = 0;
  for (const t of Object.keys(need)) n += Math.max(0, need[t] - (have[t] || 0));
  return n;
}
/** Init patch: every connection out, the name gone, the controller's and every module's knobs at their defaults (modules and
 *  drivers kept) → { rec, vals, back }. */
export function initPatch(rec, vals) {
  const fam = famRec(rec);
  if (!fam) return { rec, vals, why: 'No patch' };
  const r = copyRec(rec), v0 = isObj(vals) ? vals : {}, nv = Object.assign({}, v0), np = Object.assign({}, isObj(v0.p) ? v0.p : {}), ms = [];
  r.cords = []; delete r.name;
  for (const c of fam.types[fam.ctl].params) nv[c.id] = c.def;
  for (const mid of mids(r)) {
    const T = typeOf(fam, r.mods[mid].t);
    if (!T) continue;
    const e = { _t: T.id };
    for (const c of T.params) e[c.id] = c.def;
    np[mid] = e; ms.push(mid);
  }
  nv.p = np;
  return { rec: r, vals: nv, back: { f: diffVals(v0, nv, ctlIds(fam), ms) } };
}

/* ---------------------------------------------------------------- bus rows (IMPL-9b §1.4) */
// A type's `bus: [{ sw: [switch ids], a, b, g? }]`: a routing switch closing a hidden connection — a switch is a knob (vals, no
// History step), the connection is no cord (no plug, no colour, outside the one-plug rule) and reaches rear terminals. A row is a
// connection while every switch of it reads on (≠ 0) and both ends resolve: 'c.<port>' · '.<port>' (the panel's own jack) ·
// '<t>|<t>…#<k>.<port>' (the k-th module of the listed types — each type's by number, in list order) · '#=' (k = the panel's
// ordinal among its type). Rows are taken by panel number then row, after the cords, up to MAX_CONN connections in all. Two connections
// of one source to one input are one (R2a F5: a duplicated lit panel, a switch closing a cord's own pair): a row whose (source, input)
// is a cord's or an earlier row's is skipped — the first keeps its gain — and the bound counts the merged connections.
export const MAX_CONN = 8192;                                          // the evaluator's connections (cords + rows; was 256, IMPL-P §3.1)
const BUS_RE = /^([a-z0-9]{1,8}(?:\|[a-z0-9]{1,8})*)#([1-9]\d{0,2}|=)\.([a-z][a-z0-9]{0,7})$/;
const BX = new WeakMap();                                              // TYPE → its bus switches (params, unique, table order)
function busSw(T) {
  let L = BX.get(T);
  if (!L) { const ids = new Set(); for (const r of T.bus || []) for (const s of r.sw) ids.add(s); L = T.params.filter(c => ids.has(c.id)); BX.set(T, L); }
  return L;
}
const knob = (fam, T, vals, mid, id) => {                              // getKnob with the family and type in hand
  const c = paramOf(T, id), e = isObj(vals) && isObj(vals.p) && isObj(vals.p[mid]) ? vals.p[mid] : null;
  return c ? (e && e._t === T.id ? pval(c, e[id]) : c.def) : 0;
};
// every row of every routing panel (by number), resolved: { panel, i, sw, on, a, b, g, A, B, why } — a / b the end strings
// (null: unresolved), A / B endOf's (rear allowed), why '' for a connection, else the reason (off: 'Off')
function busScan(fam, rec, vals, only) {
  const out = [];
  if (!isObj(vals) || !isObj(rec) || !isObj(rec.mods) || !Array.isArray(rec.cords)) return out;
  const M = rec.mods, ms = mids(rec), byT = new Map(), ord = new Map();
  for (const k of ms) { const t = M[k].t; if (!byT.has(t)) byT.set(t, []); ord.set(k, byT.get(t).push(k)); }
  let room = MAX_CONN;
  const held = new Map(), pair = (A, B) => A.mid + ':' + A.i + '>' + B.mid + ':' + B.i;   // pair → who holds it (null: a cord)
  for (const c of rec.cords) { const A = isObj(c) ? endOf(fam, M, c.a) : null, B = isObj(c) ? endOf(fam, M, c.b) : null; if (A && B && A.T && B.T) { room--; if (!held.has(pair(A, B))) held.set(pair(A, B), null); } }
  const end = (mid, e) => {
    if (typeof e !== 'string') return [null, 'No such jack'];
    if (e.startsWith(CTL + '.')) return [e, ''];
    if (e[0] === '.') return [mid + e, ''];
    const m = BUS_RE.exec(e);
    if (!m) return [null, 'No such jack'];
    const ts = m[1].split('|'), k = m[2] === '=' ? ord.get(mid) : +m[2], L = [];
    for (const t of ts) for (const x of byT.get(t) || []) L.push(x);
    if (k <= L.length) return [L[k - 1] + '.' + m[3], ''];
    return [null, `No ${ts.map(t => (typeOf(fam, t) || { short: t.toUpperCase() }).short).join(' / ')} ${k} in this patch`];
  };
  for (const mid of ms) {
    const T = typeOf(fam, M[mid].t);
    if (!T || !Array.isArray(T.bus)) continue;
    T.bus.forEach((r, i) => {
      const on = r.sw.every(s => knob(fam, T, vals, mid, s) !== 0), [a, wa] = end(mid, r.a), [b, wb] = end(mid, r.b);
      const A = a ? endOf(fam, M, a, true) : null, B = b ? endOf(fam, M, b, true) : null;
      const g = typeof r.g === 'number' && isFinite(r.g) ? Math.max(0, Math.min(G_MAX, r.g)) : 1;
      let why = !on ? 'Off' : wa || wb || (!A || !B || !A.T || !B.T || A.j.dir !== 'out' || B.j.dir !== 'in' || A.j.sig !== B.j.sig ? 'No such jack' : '');
      if (!why) {
        const k = pair(A, B), by = held.get(k);
        if (by !== undefined) why = by === null ? 'Already patched by a cord' : by === mid ? 'Already routed by another row of this panel' : `Already routed by ${T.short} ${ord.get(by)}`;
        else if (room > 0) { room--; held.set(k, mid); }
        else why = `A patch holds at most ${MAX_CONN} connections`;
      }
      if (only === undefined || only === mid) out.push({ panel: mid, i, sw: r.sw.slice(), on, a, b, g, A, B, why });
    });
  }
  return out;
}
/** The routing panels' live connections (resolved, for the payload, tips and tests): [{ a, b, g, panel, i, sw }] — a the source
 *  end, b the destination ('<mid>.<port>' | 'c.<port>'), i the row's index in its type's `bus`. vals absent → [] (stage 9's callers). */
export function busRows(rec, f, vals) {
  const fam = famOf(f) || famOf(rec && rec.f);
  return fam ? busScan(fam, rec, vals).filter(x => !x.why).map(x => ({ a: x.a, b: x.b, g: x.g, panel: x.panel, i: x.i, sw: x.sw })) : [];
}
/** A routing panel's rows for its switches' tips (IMPL-9b §1.4): [{ i, sw, on, a, b, ok, why }] — ok: a connection now; why: '' |
 *  'Off' | 'No <short> <k> in this patch' (an ordinal past the patch's modules) | the bound's reason. */
export function busInfo(rec, f, vals, mid) {
  const fam = famOf(f) || famOf(rec && rec.f);
  return fam ? busScan(fam, rec, isObj(vals) ? vals : {}, mid).map(x => ({ i: x.i, sw: x.sw, on: x.on, a: x.a, b: x.b, ok: !x.why, why: x.why })) : [];
}
/** Is (mid, id) a routing switch of its module's type (the host reposts the graph at once: a flip changes pk)? */
export function isBusKnob(rec, mid, id) {
  const fam = famOf(rec && rec.f), m = fam && mid !== CTL && isObj(rec.mods) && own(rec.mods, mid) ? rec.mods[mid] : null, T = m ? typeOf(fam, m.t) : null;
  return !!T && busSw(T).some(c => c.id === id);
}

/* ---------------------------------------------------------------- the engine's graph */
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
/** The graph payload (§3.2): modules of a type the family lacks and their connections are left out (they play silent); with vals
 *  (IMPL-9b §1.4) the routing panels' live rows follow the sorted cords as more 5-tuples (sorted alike) — a switch flip changes
 *  pk; vals absent → stage 9's payload byte for byte. */
export function payload(rec, f, vals) {
  const fam = famOf(f) || famOf(rec && rec.f) || MG.FAMILY;
  const M = isObj(rec) && isObj(rec.mods) ? rec.mods : {}, mods = [[0, fam.ctl, -1]];
  for (const mid of sortKeys(M)) {
    const n = midNum(mid), m = M[mid];
    if (!n || !isObj(m) || !typeOf(fam, m.t) || m.t === fam.ctl) continue;
    const d = typeof m.drv === 'string' && own(M, m.drv) && typeOf(fam, M[m.drv].t) ? midNum(m.drv) : 0;
    mods.push([n, m.t, d || -1]);
  }
  const cords = [];
  for (const c of (isObj(rec) && Array.isArray(rec.cords) ? rec.cords : [])) {
    const A = isObj(c) ? endOf(fam, M, c.a) : null, B = isObj(c) ? endOf(fam, M, c.b) : null;
    if (!A || !B || !A.T || !B.T) continue;
    cords.push([num(A.mid), A.i, num(B.mid), B.i, typeof c.g === 'number' && isFinite(c.g) ? Math.max(0, Math.min(G_MAX, c.g)) : 1]);
  }
  const cmp = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3] || x[4] - y[4];
  cords.sort(cmp);
  const rows = [];
  for (const x of busScan(fam, rec, vals)) if (!x.why) rows.push([num(x.A.mid), x.A.i, num(x.B.mid), x.B.i, x.g]);
  if (rows.length) { rows.sort(cmp); for (const x of rows) cords.push(x); }
  const pg = { v: 1, f: fam.id, mods, cords };
  return { pg, pk: fnv(JSON.stringify(pg)) };
}
// The wiring as the evaluator resolves it (the schedule's edges, §3.3): what feeds an input — its cords' sources (a multiple read as
// the outputs driving its group, up a chain of multiples), else its normal — as output nodes 'mid:sec'. A cord of gain 0 carries
// nothing (the evaluator drops it) but still breaks a normal; with vals, the routing panels' live rows are connections too (IMPL-9b
// §1.4: a routed envelope makes its generator live). feeds(mid, T, jack, depth) → [node keys]
function wiring(fam, rec, vals) {
  const M = isObj(rec.mods) ? rec.mods : {}, G = new Map(), IN = new Map();
  const gOf = (mid, sec) => { const k = mid + ':' + sec; let g = G.get(k); if (g === undefined) G.set(k, g = { n: [], up: [] }); return g; };
  for (const c of rec.cords) {
    if (!isObj(c)) continue;
    const A = endOf(fam, M, c.a), B = endOf(fam, M, c.b);
    if (A === null || B === null || A.T === null || B.T === null || A.j.dir === 'in' || B.j.dir === 'out' || A.j.sig !== B.j.sig) continue;
    const zero = typeof c.g === 'number' && c.g <= 0;
    if (B.j.dir === 'in') { const k = B.mid + '.' + B.port; if (!IN.has(k)) IN.set(k, []); if (!zero) IN.get(k).push(A); }
    else if (zero) continue;
    else if (A.j.dir === 'out') gOf(B.mid, B.j.sec).n.push(A.mid + ':' + A.j.sec);
    else gOf(B.mid, B.j.sec).up.push(gOf(A.mid, A.j.sec));              // a multiple driving another (P-3)
  }
  for (const x of busScan(fam, rec, vals)) if (!x.why && x.g > 0) { const k = x.B.mid + '.' + x.B.port; if (!IN.has(k)) IN.set(k, []); IN.get(k).push(x.A); }
  const outs = (g, seen) => { if (seen.has(g)) return []; seen.add(g); const L = g.n.slice(); for (const u of g.up) for (const x of outs(u, seen)) L.push(x); return L; };
  const feeds = (mid, T, j, d) => {
    const l = IN.get(mid + '.' + j.id);
    if (l !== undefined) { const L = []; for (const A of l) for (const x of A.j.dir === 'out' ? [A.mid + ':' + A.j.sec] : outs(gOf(A.mid, A.j.sec), new Set())) L.push(x); return L; }
    const jn = j.norm === undefined || d >= 8 ? null : T.jacks.find(x => x.id === j.norm);
    if (!jn) return [];
    return jn.dir === 'out' ? [mid + ':' + jn.sec] : jn.dir === 'in' ? feeds(mid, T, jn, d + 1) : outs(gOf(mid, jn.sec), new Set());
  };
  return { M, feeds };
}
const sinkEnd = (fam, M) => { const E = endOf(fam, M, CTL + '.' + fam.sink); return E !== null && E.T !== null && E.j.dir === 'in' ? E : null; };
/** The sink patched (§3.6: the patch never goes quiet; the bounce takes it, §6) — as the evaluator reads it: from an output, or
 *  a multiple some output drives (directly or up a chain of multiples); an undriven multiple on the sink is silent (review 1 F4).
 *  vals: the routing panels' rows count (IMPL-9b §1.4); absent → cords only (stage 9's). */
export function live(rec, f, vals) {
  const fam = famOf(f) || famOf(rec && rec.f);
  if (!fam || !isObj(rec) || !Array.isArray(rec.cords)) return false;
  const w = wiring(fam, rec, vals), E = sinkEnd(fam, w.M);
  return E !== null && w.feeds(CTL, E.T, E.j, 0).length > 0;
}
/** The nodes the evaluator runs (§3.3; review 1 F5): the (module, section) pairs the sink is reachable from along cords (a multiple
 *  resolved into its drivers), bus rows (with vals), normals and driver links, and the members of its loop steps (a cycle, or a node into itself) →
 *  { sec: { <mid | 'c'>: [live sections] }, loop } | null while the sink is silent. cv-cost charges these and no others. */
export function liveNodes(rec, f, vals) {
  const fam = famOf(f) || famOf(rec && rec.f);
  if (!fam || !isObj(rec) || !Array.isArray(rec.cords)) return null;
  const w = wiring(fam, rec, vals), M = w.M, E = sinkEnd(fam, M);
  if (E === null || w.feeds(CTL, E.T, E.j, 0).length === 0) return null;
  const inn = new Map(), add = (to, from) => { if (!inn.has(to)) inn.set(to, []); inn.get(to).push(from); };
  for (const mid of [CTL, ...Object.keys(M)]) {
    const m = mid === CTL ? { t: fam.ctl } : M[mid], T = isObj(m) ? typeOf(fam, m.t) : null;
    if (T === null) continue;
    for (const j of T.jacks) if (j.dir === 'in') for (const x of w.feeds(mid, T, j, 0)) add(mid + ':' + j.sec, x);
    if (T.link && typeof m.drv === 'string' && m.drv !== mid && own(M, m.drv) && isObj(M[m.drv]) && M[m.drv].t === T.link.to) add(mid + ':0', m.drv + ':0');
  }
  const sink = CTL + ':' + E.j.sec, lv = new Set([sink]), q = [sink];                  // the sink's ancestors (reverse BFS)
  for (let h = 0; h < q.length; h++) for (const x of inn.get(q[h]) || []) if (!lv.has(x)) { lv.add(x); q.push(x); }
  const out = new Map();                                                                // Tarjan over the live nodes: the components with a cycle
  for (const [to, L] of inn) if (lv.has(to)) for (const x of L) if (lv.has(x)) { if (!out.has(x)) out.set(x, []); out.get(x).push(to); }
  const ix = new Map(), low = new Map(), on = new Set(), st = [];
  let n = 0, loop = 0;
  const strong = v => {
    ix.set(v, n); low.set(v, n++); st.push(v); on.add(v);
    for (const u of out.get(v) || []) {
      if (!ix.has(u)) { strong(u); low.set(v, Math.min(low.get(v), low.get(u))); } else if (on.has(u)) low.set(v, Math.min(low.get(v), ix.get(u)));
    }
    if (low.get(v) === ix.get(v)) {
      const c = []; let u;
      do { u = st.pop(); on.delete(u); c.push(u); } while (u !== v);
      if (c.length > 1 || (out.get(v) || []).includes(v)) loop += c.length;
    }
  };
  for (const v of lv) if (!ix.has(v)) strong(v);
  const sec = {};
  for (const v of lv) { const k = v.indexOf(':'), mid = v.slice(0, k); (sec[mid] || (sec[mid] = [])).push(+v.slice(k + 1)); }
  return { sec, loop };
}

/* ---------------------------------------------------------------- the rack, names */
const sizeFn = (fam, rec, sizes) => mid => {
  const s = typeof sizes === 'function' ? sizes(mid) : isObj(sizes) && own(sizes, mid) ? sizes[mid] : null;
  if (s && s.w > 0 && s.h > 0) return [s.w, s.h];
  const T = typeOf(fam, rec.mods[mid].t);
  return T ? [T.w, T.h] : [128, 512];
};
// the rows Tidy stacks (the cabinet rows, then the console row — IMPL-9b §4.4 — when the family has one: lowest, flush above the
// controller); the rack's width: rackW while the patch holds ≤ rackN modules and no console module, else rackWide
const rowsOf = fam => (Array.isArray(fam.console) && fam.console.length ? [...fam.rows, fam.console] : fam.rows);
const isCon = (fam, t) => Array.isArray(fam.console) && fam.console.includes(t);
function rackWidth(fam, rec) {
  const ks = Object.keys(rec.mods);
  return fam.rackWide > 0 && (ks.length > (fam.rackN > 0 ? fam.rackN : Infinity) || ks.some(k => isObj(rec.mods[k]) && isCon(fam, rec.mods[k].t))) ? fam.rackWide : fam.rackW;
}
/** Tidy (§4.5): the family's rows stacked flush above the controller (the last row lowest: the console row when the family has one,
 *  an empty row taking no height), each row's modules by its type order then number, flush left to right from x 0, a module the
 *  rows lack appended to the shorter cabinet row, a line past the rack's width (rackW, or rackWide for a large or console-holding
 *  patch) wrapping upward. → { mid: { x, y } } relative to the controller's top-left (every module above it: y < 0). */
export function rackLayout(rec, f, sizes) {
  const fam = famOf(f) || famOf(rec && rec.f), out = {};
  if (!fam || !isObj(rec) || !isObj(rec.mods)) return out;
  const R = rowsOf(fam), nc = fam.rows.length, W = rackWidth(fam, rec);
  const sz = sizeFn(fam, rec, sizes), rows = R.map(() => []), extra = [];
  for (const mid of mids(rec)) { const r = R.findIndex(row => row.includes(rec.mods[mid].t)); (r < 0 ? extra : rows[r]).push(mid); }
  rows.forEach((row, r) => row.sort((a, b) => R[r].indexOf(rec.mods[a].t) - R[r].indexOf(rec.mods[b].t) || byNum(a, b)));
  const width = row => row.reduce((w, mid) => w + sz(mid)[0], 0);
  for (const mid of extra) { let s = 0; for (let r = 1; r < nc; r++) if (width(rows[r]) < width(rows[s])) s = r; rows[s].push(mid); }
  let y = 0;
  for (let r = rows.length - 1; r >= 0; r--) {
    const lines = [[]];
    let x = 0;
    for (const mid of rows[r]) { const w = sz(mid)[0]; if (x > 0 && x + w > W) { lines.push([]); x = 0; } lines[lines.length - 1].push(mid); x += w; }
    for (const line of lines) {
      if (!line.length) continue;
      y -= Math.max(...line.map(mid => sz(mid)[1]));
      let lx = 0;
      for (const mid of line) { out[mid] = { x: lx, y }; lx += sz(mid)[0]; }
    }
  }
  return out;
}
// the lines above the rack a tapped tile may take: a line holds ≥ 2 of the widest module (864 at rackWide 2816), so a full patch (MAX_MODS)
// fills ≤ MAX_MODS / 2 of them — one free line always remains (IMPL-P §3.1, skeptic #18; was 64)
const FREE_LINES = 2 + Math.ceil(MAX_MODS / 2);
/** A tapped tile's place (§4.5): the first free slot (32 px steps, within the rack's width) on its row's line, else on a line above
 *  the rack, clear of `placed` ({ mid: { x, y } } relative to the controller, sized by `sizes`). The lines follow Tidy's stacking
 *  (IMPL-9b §4.4, skeptic #13): a console module's flush above the controller, the cabinet rows' above the console row's height
 *  (none while the patch holds no console module: stage 9's lines). */
export function freeSlot(rec, f, mid, placed, sizes) {
  const fam = famOf(f) || famOf(rec && rec.f);
  if (!fam || !isObj(rec) || !own(rec.mods, mid)) return { x: 0, y: 0 };
  const sz = sizeFn(fam, rec, sizes), [w, h] = sz(mid), H = Math.max(...fam.order.filter(t => !isCon(fam, t)).map(t => fam.types[t].h));
  const t = rec.mods[mid].t, r = fam.rows.findIndex(row => row.includes(t)), n = fam.rows.length, W = rackWidth(fam, rec);
  const con = mids(rec).filter(k => isCon(fam, rec.mods[k].t)), hc = con.length ? Math.max(...con.map(k => sz(k)[1])) : 0;
  const rects = Object.keys(isObj(placed) ? placed : {}).filter(k => k !== mid && own(rec.mods, k) && isObj(placed[k]))
    .map(k => { const [kw, kh] = sz(k); return [placed[k].x, placed[k].y, kw, kh]; });
  const free = (x, y) => rects.every(([rx, ry, rw, rh]) => x >= rx + rw || x + w <= rx || y >= ry + rh || y + h <= ry);
  const lines = [isCon(fam, t) ? -hc : r >= 0 ? -hc - (n - r) * H : -hc - n * H];
  for (let k = 1; k <= FREE_LINES; k++) lines.push(-hc - (n + k) * H);
  for (const y of lines) for (let x = 0; x + w <= Math.max(W, w); x += 32) if (free(x, y)) return { x, y };
  return { x: 0, y: -hc - (n + FREE_LINES + 1) * H };
}
/** A module's ordinal among its type, by number (1…); 1 for the controller; 0 when absent. */
export function ordinal(rec, mid) {
  if (mid === CTL) return 1;
  if (!isObj(rec) || !isObj(rec.mods) || !own(rec.mods, mid)) return 0;
  return ordinals(rec.mods).get(mid) || 0;
}
// every module's ordinal from one sorted pass, memoised on the record's mods object (IMPL-P §3.2: a title per module on every sync was
// O(n² log n), 25 ms at 512). Valid because a record is never mutated once handed out — every edit copies `mods` (copyRec) — which the
// tests hold (an edit that changes a module returns a new mods object)
const ORD = new WeakMap();
function ordinals(M) {
  let o = ORD.get(M);
  if (o === undefined) {
    o = new Map();
    const n = new Map();
    for (const k of sortKeys(M)) { const t = M[k].t, c = (n.get(t) || 0) + 1; n.set(t, c); o.set(k, c); }
    ORD.set(M, o);
  }
  return o;
}
/** The bar's title (§4.1): '<short> <ordinal>' (the type's short name); the controller's name; a newer type its id upper-cased. */
export function title(rec, mid, f) {
  const fam = famOf(f) || famOf(rec && rec.f);
  if (!fam) return '';
  if (mid === CTL) return fam.types[fam.ctl].name;
  const n = ordinal(rec, mid);
  if (!n) return '';
  const T = typeOf(fam, rec.mods[mid].t);
  return (T ? T.short : String(rec.mods[mid].t).toUpperCase()) + ' ' + n;
}
/** The family's preset names (Patches…, §2.5). */
export const presetNames = f => { const fam = famOf(f); return fam ? (fam.PRESETS || []).map(p => p.name) : []; };
