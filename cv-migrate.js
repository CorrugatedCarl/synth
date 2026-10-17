// cv-migrate.js — the SYNTH Canvas project format: its schema number, the project uid and the steps between schemas
// (SPEC-canvas §5.1, §5.4, §5.8; stage 1a). Pure ES module: no DOM, no storage (node-tested: tests/cv-migrate.test.mjs).
//
// Schema (§5.8): every project the canvas build saves carries `schema`, an integer; SCHEMA is the highest this build
// understands. Every stage that adds or changes a saved field bumps SCHEMA and appends a STEPS entry from the number
// before (STEPS[n] turns schema n into n + 1; it returns a new object and never mutates its input).
//   0  main's projects and files (synth.domlavin.com), which carry no schema
//   1  stage 1a: `schema` and `uid` (a random id made once per project: it keys device prefs, the camera of §4.4)
//   2  stage 1b: `track.lay`, the canvas module layout (view only; song.js normLay): additive, nothing to convert
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
// Later stages add here: toV2 / toV1 and the file mirror of the primary instrument (1c, §5.4, §5.8).
import { schemaOf } from './appstore.js?v=9';

export { schemaOf };
export const SCHEMA = 2;
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
