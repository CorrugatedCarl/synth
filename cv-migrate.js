// cv-migrate.js — the SYNTH Canvas project format: its schema number, the project uid and the steps between schemas
// (SPEC-canvas §5.1, §5.4, §5.8; stage 1a). Pure ES module: no DOM, no storage (node-tested: tests/cv-migrate.test.mjs).
//
// Schema (§5.8): every project the canvas build saves carries `schema`, an integer; SCHEMA is the highest this build
// understands. Every stage that adds or changes a saved field bumps SCHEMA and appends a STEPS entry from the number
// before (STEPS[n] turns schema n into n + 1; it returns a new object and never mutates its input).
//   0  main's projects and files (synth.domlavin.com), which carry no schema
//   1  stage 1a: `schema` and `uid` (a random id made once per project: it keys device prefs, the camera of §4.4)
//   2  stage 1b: `track.lay`, the canvas module layout (view only; song.js normLay): additive, nothing to convert
//   3  stage 1c: project v2 tracks (§5.1, §5.4): the instrument becomes device i1 of track.dev with track.prim = 'i1';
//      a classic track's FX state becomes the shared panel fx1 (i1.out → fx1.in → out.in), a Serum's its own (i1.fx;
//      i1.out → out.in). A panel holds today's v2 FX state whole (`fx`; a classic panel compiles and shows its Main rack
//      as before), so every sound compiles bit-identically (cv-graph compileTrack, tests/canonical-stream.test.mjs)
//   4  stage 1e: several instruments per track — an instrument's on / solo / zone / name, a cable's level g, any number
//      of instruments and panels (cv-model's editing API): additive, nothing to convert (a 3 opens as before; a 4 in a
//      stage-1c build opens read-only, as it should: that build would drop the fields)
// A project whose schema is above SCHEMA comes from a newer build (an installed app lags a deploy until it updates): it is
// opened read-only — autosave off for the session, Save disabled, READ_ONLY_NOTICE — and never overwritten (appstore.js
// schema gate, given SCHEMA). This rule ships before any v2 field exists, so every later build is protected by the one
// before it.
//   upgrade(o)              a parsed project (autosave or file) → { p, from, readOnly }: p is o brought to SCHEMA by STEPS
//                           (o itself untouched), or o as it is when it is newer (readOnly)
//   stamp(p, src)           a project p made by song.js (newProject / deserialize, which keep only the fields they know)
//                           gets src's uid (when valid; else a new one) and schema = SCHEMA → p
//   schemaOf(x)             (appstore.js) the schema of a project object or JSON text; 0 for none
//   newUid() / isUid(s)     'p_' + 10 base-36 characters
//   camKey(uid, trackId)    a track's camera entry key, 'synth.cam.<uid>.<trackId>': an entry inside the ONE device-pref
//                           LRU record cv-module CAM_PREF ('synth.cam', stored as synthc.cam; §4.4, IMPL-1b), never a
//                           storage key of its own (appstore has no delete: one record, capped, instead of a key each)
//   trackToV2(t) / toV2(p)  a v1 track (model / vals / preset / seq / fx) → its v2 form (a new object; a v2 track: a copy
//                           without a file's mirror fields); toV2 = STEPS[2] on a whole project
//   toV1(p)                 "Save as classic project" (§5.4): { p: a project main opens (no schema; canonical tracks
//                           exactly, else one track per instrument), lost: [what main cannot hold] }
//   primV1(t)               a v2 track's primary instrument as v1 fields { model, vals, preset, seq?, fx }
//   mirror(o)               a saved FILE's tracks get primV1 at track level (§5.8: main opens it as each track's primary
//                           instrument with its FX); autosave and History never carry it, the canvas reader ignores it
// The in-memory track (accessors onto the primary, one adopt point) is cv-model.js.
import { schemaOf } from './appstore.js?v=9';
import { compileTrack, kindOf, port, powered, zoneOf } from './cv-graph.js?v=9';
import { defaultFx2 } from './serum-core.js?v=9';

export { schemaOf };
export const SCHEMA = 4;
/** The v1 instrument fields: on a v2 track they live on dev[prim] (cv-model accessors); a saved file mirrors them. */
export const V1_KEYS = Object.freeze(['model', 'vals', 'preset', 'seq', 'fx']);
/** The v2 fields of a track (song.js deserialize whitelists them). */
export const V2_KEYS = Object.freeze(['prim', 'nid', 'dev', 'wires']);
export const READ_ONLY_NOTICE = 'Opened read-only: saved by a newer SYNTH Canvas · Reload';

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export const isUid = s => typeof s === 'string' && /^p_[0-9a-z]{6,24}$/.test(s);
export function newUid() {
  const c = globalThis.crypto, b = new Uint8Array(10);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b); else for (let i = 0; i < b.length; i++) b[i] = Math.random() * 256;
  let s = 'p_';
  for (const x of b) s += (x % 36).toString(36);
  return s;
}
export const camKey = (uid, trackId) => 'synth.cam.' + uid + '.' + trackId;

export const STEPS = Object.freeze([
  // 0 → 1: the project uid (§5.1)
  p => Object.assign({}, p, { schema: 1, uid: isUid(p.uid) ? p.uid : newUid() }),
  // 1 → 2: track.lay (stage 1b, IMPL-1b §4.9) is additive — absent = Tidy
  p => Object.assign({}, p, { schema: 2 }),
  // 2 → 3: project v2 tracks (stage 1c, §5.4)
  p => Object.assign(toV2(p), { schema: 3 }),
  // 3 → 4: several instruments per track (stage 1e, IMPL-1e §3.2) — additive
  p => Object.assign({}, p, { schema: 4 }),
]);

export function upgrade(o) {
  if (!isObj(o)) throw new Error('Not a SYNTH project');
  const from = schemaOf(o);
  if (from > SCHEMA) return { p: o, from, readOnly: true };
  let p = o;
  for (let n = from; n < SCHEMA; n++) p = STEPS[n](p);
  if (p === o) p = Object.assign({}, o); // (already at SCHEMA: still a copy)
  if (!isUid(p.uid)) p.uid = newUid();
  p.schema = SCHEMA;
  return { p, from, readOnly: false };
}

export function stamp(p, src) {
  p.uid = isObj(src) && isUid(src.uid) ? src.uid : newUid();
  p.schema = SCHEMA;
  return p;
}

/* ---------------------------------------------------------------- project v2 (stage 1c, §5.1, §5.4) */
// the v2 form of a track: i1 (+ fx1 for a classic one) + out, wired as today's signal path. Ids: device numbers come from
// track.nid (never reused in a track); the migration's i1 / fx1 take number 1
export function trackToV2(t) {
  if (!isObj(t)) return t;
  const o = {};
  for (const k of Object.keys(t)) if (!V1_KEYS.includes(k)) o[k] = t[k];
  if (isObj(t.dev)) return o; // (already v2: a file's mirror is dropped)
  const sx = t.model === 'serum';
  const i1 = { kind: 'synth', model: typeof t.model === 'string' ? t.model : 'minimoog', vals: isObj(t.vals) ? t.vals : {}, preset: t.preset === undefined ? null : t.preset };
  if (t.seq != null) i1.seq = t.seq;
  if (sx) {
    if (t.fx != null) i1.fx = t.fx;
    return Object.assign(o, { prim: 'i1', nid: 2, dev: { i1, out: { kind: 'out' } }, wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }] });
  }
  const fx1 = { kind: 'panel' };
  if (t.fx != null) fx1.fx = t.fx;
  return Object.assign(o, { prim: 'i1', nid: 2, dev: { i1, fx1, out: { kind: 'out' } },
    wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in' }, { id: 'w2', a: 'fx1.out', b: 'out.in' }] });
}
export function toV2(p) {
  if (!isObj(p) || !Array.isArray(p.tracks)) return Object.assign({}, p);
  return Object.assign({}, p, { tracks: p.tracks.map(trackToV2) });
}
// the panel the instrument `id` feeds (its out → a panel's in), or null
export function panelOf(t, id) {
  if (!isObj(t) || !isObj(t.dev) || !Array.isArray(t.wires)) return null;
  for (const w of t.wires) {
    const a = isObj(w) ? port(w.a) : null, b = a && a.dev === id && a.port === 'out' ? port(w.b) : null;
    if (b && kindOf(t.dev[b.dev]) === 'panel') return b.dev;
  }
  return null;
}
const v1Of = (d, fx) => { const o = { model: d.model, vals: d.vals, preset: d.preset === undefined ? null : d.preset }; if (d.seq != null) o.seq = d.seq; o.fx = fx; return o; };
// an instrument device's v1 fields: a Serum its own FX, a classic one the panel it feeds (else an empty rack)
function instV1(t, id) {
  const d = t.dev[id], pid = d.model === 'serum' ? null : panelOf(t, id);
  return v1Of(d, d.model === 'serum' ? (d.fx != null ? d.fx : defaultFx2()) : pid && t.dev[pid].fx != null ? t.dev[pid].fx : defaultFx2());
}
export function primV1(t) {
  if (!isObj(t) || !isObj(t.dev)) return null;
  const id = isObj(t.dev[t.prim]) && t.dev[t.prim].kind === 'synth' ? t.prim : Object.keys(t.dev).find(k => isObj(t.dev[k]) && t.dev[k].kind === 'synth');
  return id ? instV1(t, id) : null;
}
const coreOf = t => { const o = {}; for (const k of Object.keys(t)) if (!V2_KEYS.includes(k) && k !== 'mods' && !V1_KEYS.includes(k)) o[k] = t[k]; return o; };
const plainCopy = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
export function toV1(p0) {
  const p = plainCopy(p0), lost = [];
  if (!isObj(p) || !Array.isArray(p.tracks)) return { p, lost };
  delete p.schema; delete p.newerSchema; delete p.perf;
  const out = [], ids = new Set(p.tracks.map(t => isObj(t) && t.id));
  let n = 0;
  const freshId = () => { let id; do id = 'trk_' + (1000 + ++n); while (ids.has(id)); ids.add(id); return id; };
  for (const t of p.tracks) {
    if (!isObj(t) || !isObj(t.dev)) { out.push(t); continue; }
    const c = compileTrack(t), ins = Object.keys(t.dev).filter(k => kindOf(t.dev[k]) === 'inst');
    if (c.canonical && ins.length === 1) { const v = Object.assign({}, c.v1); if (v.seq == null) delete v.seq; out.push(Object.assign(coreOf(t), v)); continue; }
    // not today's shape: each instrument its own track (the primary first, keeping the track's id), notes copied
    ins.sort((a, b) => (a === t.prim ? -1 : b === t.prim ? 1 : 0));
    const W = t.wires.filter(isObj), dst = k => { const w = W.find(x => x.a === k + '.out'), b = w && port(w.b); return b && b.dev in t.dev ? { id: b.dev, g: w.g } : null; };
    const srcs = pid => W.filter(w => (port(w.b) || {}).dev === pid).map(w => (port(w.a) || {}).dev).filter(k => kindOf(t.dev[k]) === 'inst');
    const on = powered(t), lvl = g => g !== undefined && g !== 1;
    ins.forEach((id, i) => {
      const d = t.dev[id], v = instV1(t, id), to = dst(id), via = to && kindOf(t.dev[to.id]) === 'panel' ? to.id : null, end = via ? dst(via) : to;
      const tr = Object.assign(coreOf(t), v);
      if (i) { tr.id = freshId(); tr.name = (t.name || 'Track') + ' · ' + (d.name || d.model); delete tr.lay; }
      const nm = `“${tr.name}”: `;
      if (via && d.model === 'serum') lost.push(`“${t.name}”: the panel ${via} after the Serum (its effects are not in the Serum’s track)`);
      else if (via && srcs(via).filter(k => t.dev[k].model !== 'serum').length > 1) lost.push(`“${t.name}”: the shared panel ${via} (copied for each instrument)`);
      // (each becomes a track of its own that sounds: say so of one that did not)
      if (d.on === false) lost.push(nm + 'was switched off');
      else if (!end || kindOf(t.dev[end.id]) !== 'out') lost.push(nm + 'was not connected (it sounds now)');
      else if (!on.includes(id)) lost.push(nm + 'was silent (another instrument soloed; it sounds now)');
      const z = zoneOf(d);
      if (z.lo !== 0 || z.hi !== 127 || z.xp !== 0) lost.push(nm + 'its key zone / transpose (it plays every key)');
      if ((to && lvl(to.g)) || (via && end && lvl(end.g))) lost.push(nm + 'its cable level');
      out.push(tr);
    });
    if (ins.some(k => t.dev[k].solo)) lost.push(`“${t.name}”: solo in track`);
    if (Array.isArray(t.mods) && t.mods.length) lost.push(`“${t.name}”: ${t.mods.length} modulation cable${t.mods.length > 1 ? 's' : ''}`);
  }
  p.tracks = out;
  return { p, lost: [...new Set(lost)] };
}
export function mirror(o) {
  if (!isObj(o) || !Array.isArray(o.tracks)) return o;
  for (const t of o.tracks) {
    const v = isObj(t) && isObj(t.dev) ? primV1(t) : null;
    if (v) for (const k of V1_KEYS) if (v[k] !== undefined) t[k] = v[k];
  }
  return o;
}
