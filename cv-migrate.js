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
//   5  stage 2a: performance modulators — track.mods rows (§5.1, cv-mods.js), track.mid (the next row number), the
//      modulator devices ve / at / bd (kind velo / at / bend), project.perf ({ wheel: { v: 1 } | null }, the one Mod
//      Wheel, D9): additive, nothing to convert (a 4 opens as before; a 5 in a 1e / 1f build opens read-only)
//   6  stage 2b: modulation everywhere — the modulator modules lfo / env / macro / cc / chaos / note with their states
//      (song.normModDev), rows from any module port ('m1.k3') and from a Serum's own LFO / ENV ('i1/lfo3.out'), to classic
//      and panel knobs (IMPL-2b §1): additive, nothing to convert (a 5 opens as before; a 6 in a 2a build opens read-only)
//   7  milestone 3: Serum taken apart (IMPL-3 §3) — a Serum's parts are modules ('iN/oscA' lay keys, ui 'parts', up to 256
//      lay entries: song.normLay) and the LFO / ENV / Macro / Chaos modules show Serum's own panels, wider (cv-module
//      MOD_W per kind, frozen here as MOD_W6): STEPS[6] moves stored modulator places only (growMods; content unchanged). A schema-6 build's
//      normLay would drop the part keys and ui 'parts' and autosave the loss: there a 7 opens read-only
//   8  stage 7a: drum machines (IMPL-7a §6) — a 'tr808' instrument device and its `drum` record (pattern memory, panel
//      state, note map, sample slots: song.normDev → drum-core normDrum): additive, nothing to convert (a 7 opens as before;
//      an 8 in a schema-7 build opens read-only — that build would read 'tr808' as a Minimoog, modelById's fallback, drop
//      `drum` and autosave the loss). toV1 (Save as classic project) keeps a drum track's notes and names it in `lost`
//   9  stage 7b: the TR-606 (IMPL-7b §6) — a 'tr606' instrument device and its `drum` record (its own shape, `m: 'tr606'`: song.normDev
//      → normDrum(d, model)): additive, nothing to convert (an 8 opens as before; a 9 in a schema-8 build opens read-only — that build
//      would read 'tr606' as a Minimoog, modelById's fallback, drop `drum` and autosave the loss). toV1 names each drum track's model
//  10  stage 7c: the TR-909 (IMPL-7c §6) — a 'tr909' instrument device and its `drum` record (its own shape, `m: 'tr909'`: song.normDev
//      → normDrum(d, model)): additive, nothing to convert (a 9 opens as before; a 10 in a schema-9 build opens read-only — that build
//      would read 'tr909' as a Minimoog, modelById's fallback, drop `drum` and autosave the loss). toV1 names the TR-909 like the others
//  11  stage 8: the pad controller and the SDS-V (IMPL-8 §10.2) — project.pads (the Pads modules: ≤ 8 × { id 'pd1'…'pd8', grid, 64 pads }, song.js
//      deserialize → pads-core normPads), `t.lay.pd<n>` (an ordinary lay key), mod rows from a pad (src 'pd1.p12'), an 'sdsv' instrument device and
//      its `drum` record (`m: 'sdsv'`, no sequencer): ONE bump for both parts, additive, nothing to convert (a 10 opens as before; an 11 in a
//      schema-10 build opens read-only — that build would drop `project.pads` and read 'sdsv' as a Minimoog, modelById's fallback, and autosave
//      the loss). toV1 drops `pads` with the lost-line "the Pads controllers (N)", and names an SDS-V track like the other drum machines
//  12  stage 9: patchable modules (IMPL-9 §1.6) — an 'm900' instrument device (the 900 Series) and its `patch` record (modules, cords: song.normDev → patch-core
//      normPatch) with its knobs in `vals.p`: additive, nothing to convert (an 11 opens as before; a 12 in a schema-11 build opens read-only — that build would
//      read 'm900' as a Minimoog, modelById's fallback, drop `patch` and autosave the loss). toV1 keeps the track's notes and names the patch in `lost`
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
//   splitTracks(p, {name})  (stage 1f: one instrument per track in the UI) a parsed project at SCHEMA → { p, notices }: each
//                           track holding several instruments, extra panels or a shape that is not today's (power off,
//                           a key zone, a cable level, a Serum into a panel, no cable to OUT, a classic straight into
//                           OUT) becomes one v2 track per instrument, by toV1's per-instrument rule (instRoutes) in v2
//                           form — a classic → its panel (the one it fed: its FX state, a shared one copied for each;
//                           none: an empty one) → OUT, a Serum (its own FX; heard through a panel with none of its own:
//                           the panel's, reshape's rule) → OUT. The first instrument that sounded keeps the track (id,
//                           name, selection, its device ids, the lay of what it keeps); the others are new tracks after
//                           it ('trk_<n>', "<track> · <model name>" via name(modelId), the base cut to fit 100
//                           characters, i1 [→ fx1] → out, no lay), notes and the rest of the track copied; one that did
//                           not sound (off, not cabled to OUT, another one soloed) comes in muted; zones, solo, cable
//                           levels and unconnected panels are dropped. Modulation rows (2a) stay with the instrument
//                           they end on (a new track's: as i1, with the modulator devices they start at); rows to a
//                           device that does not survive (a panel, nothing) or from a missing modulator are dropped and
//                           named. Modulator devices stay on the keeper. notices: one line per track that
//                           held several instruments or lost something audible (what, per instrument). A canonical
//                           one-instrument track (and a project of them: the same object) is returned as it is
//   primV1(t)               a v2 track's primary instrument as v1 fields { model, vals, preset, seq?, fx }
//   mirror(o)               a saved FILE's tracks get primV1 at track level (§5.8: main opens it as each track's primary
//                           instrument with its FX); autosave and History never carry it, the canvas reader ignores it
//   growMods(p, widthOf)    (STEPS[6], milestone 3, IMPL-3 §2.2) every LFO / ENV / Macro / Chaos module with a stored
//                           place keeps its right edge and grows left from 2b's width (MOD_W0) to widthOf(kind) (default
//                           MOD_W6[kind]: cv-module's MOD_W at milestone 3, frozen here); one that then overlaps another
//                           module (an instrument, an FX panel, OUT, another modulator, at its stored place or where Tidy
//                           puts it) moves on left past that module's left edge − MOD_GAP, on the dots — modulators only
//                           move, nothing else, so no hardware face leaves the GL layer. → a new project (changed tracks
//                           copied with a new lay; the input untouched)
// The in-memory track (accessors onto the primary, one adopt point) is cv-model.js.
import { schemaOf } from './appstore.js?v=9';
import { compileTrack, kindOf, port, powered, zoneOf } from './cv-graph.js?v=9';
import { defaultFx2 } from './serum-core.js?v=9';
import { modLabelOf, modDevs } from './cv-mods.js?v=9';
import * as cvModule from './cv-module.js?v=9'; // (STEPS[6]: the module sizes, read-only)
import { usable as hwUsable, sizeOf as hwSizeOf } from './cv-panel.js?v=9';
import { MODELS } from './models.js?v=9';
import { DOT } from './cv-world.js?v=9';
import { isDrum } from './song.js?v=9';
import { normPatch, familyOf, isPatchModel } from './patch-core.js?v=9'; // (stage 9: toV1 counts a 900 Series patch's modules and cords)

export { schemaOf };
export const SCHEMA = 12;
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
  // 4 → 5: performance modulators (stage 2a, IMPL-2a §2.3: track.mods / mid, ve / at / bd, project.perf) — additive
  p => Object.assign({}, p, { schema: 5 }),
  // 5 → 6: modulation everywhere (stage 2b, IMPL-2b §1.4: the modulator modules' states, any source port, classic and
  // panel destinations) — additive
  p => Object.assign({}, p, { schema: 6 }),
  // 6 → 7: Serum taken apart (milestone 3, IMPL-3 §3): lay positions only — the wider modulator modules grow left
  p => Object.assign(growMods(p), { schema: 7 }),
  // 7 → 8: drum machines (stage 7a, IMPL-7a §6: a 'tr808' device and its `drum` record) — additive
  p => Object.assign({}, p, { schema: 8 }),
  // 8 → 9: the TR-606 (stage 7b, IMPL-7b §6: a 'tr606' device and its `drum` record) — additive
  p => Object.assign({}, p, { schema: 9 }),
  // 9 → 10: the TR-909 (stage 7c, IMPL-7c §6: a 'tr909' device and its `drum` record) — additive
  p => Object.assign({}, p, { schema: 10 }),
  // 10 → 11: the pad controller (project.pads) and the SDS-V (a 'sdsv' device and its `drum` record) — additive (stage 8, IMPL-8 §10.2)
  p => Object.assign({}, p, { schema: 11 }),
  // 11 → 12: patchable modules (stage 9, IMPL-9 §1.6: an 'm900' device, its `patch` record and `vals.p`) — additive
  p => Object.assign({}, p, { schema: 12 }),
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
// the instruments of a v2 track, the primary first, each with its v1 fields (instV1: a classic one's FX the panel it feeds,
// a Serum its own) and its route: to — the device its cable reaches {id, g} | null —, via — that panel —, end — what the
// panel feeds (else to). toV1's and splitTracks' one-track-per-instrument rule
function instRoutes(t) {
  const ins = Object.keys(t.dev).filter(k => kindOf(t.dev[k]) === 'inst').sort((a, b) => (a === t.prim ? -1 : b === t.prim ? 1 : 0));
  const W = (Array.isArray(t.wires) ? t.wires : []).filter(isObj);
  const dst = k => { const w = W.find(x => x.a === k + '.out'), b = w && port(w.b); return b && b.dev in t.dev ? { id: b.dev, g: w.g } : null; };
  return ins.map(id => {
    const to = dst(id), via = to && kindOf(t.dev[to.id]) === 'panel' ? to.id : null;
    return { id, d: t.dev[id], v: instV1(t, id), to, via, end: via ? dst(via) : to };
  });
}
const coreOf = t => { const o = {}; for (const k of Object.keys(t)) if (!V2_KEYS.includes(k) && k !== 'mods' && k !== 'mid' && !V1_KEYS.includes(k)) o[k] = t[k]; return o; };
const plainCopy = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
// (9, IMPL-9 §1.6) a 900 Series: main has no patchable modular. The track keeps its notes (and its model id, which main reads as a Minimoog, as a drum machine's);
// v1Of never carries the `patch` record, so only the line is written — the counts are the bounded record's (none stored: a fresh one)
function patchLine(name, d) {
  const r = normPatch(d.patch, familyOf(d.model)), n = Object.keys(r.mods).length, c = r.cords.length, m = MODELS.find(x => x.id === d.model);
  return `“${name}”: the ${m ? m.name : d.model} patch (${n} module${n === 1 ? '' : 's'}, ${c} cord${c === 1 ? '' : 's'}) — the live site has no patchable modular; its piano-roll notes are kept`;
}
export function toV1(p0) {
  const p = plainCopy(p0), lost = [];
  if (!isObj(p) || !Array.isArray(p.tracks)) return { p, lost };
  if (isObj(p.perf) && p.perf.wheel) lost.push('the Mod Wheel');
  if (Array.isArray(p.pads) && p.pads.length) lost.push(`the Pads controllers (${p.pads.length})`); // (stage 8: main has no pad controller; their mod rows are in each track's cable count)
  delete p.schema; delete p.newerSchema; delete p.perf; delete p.pads;
  const out = [], ids = new Set(p.tracks.map(t => isObj(t) && t.id));
  let n = 0;
  const freshId = () => { let id; do id = 'trk_' + (1000 + ++n); while (ids.has(id)); ids.add(id); return id; };
  for (const t of p.tracks) {
    if (!isObj(t) || !isObj(t.dev)) { out.push(t); continue; }
    const c = compileTrack(t), ins = Object.keys(t.dev).filter(k => kindOf(t.dev[k]) === 'inst');
    // (2a, every shape — a canonical track too) its modulation cables and modulator modules
    if (Array.isArray(t.mods) && t.mods.length) lost.push(`“${t.name}”: ${t.mods.length} modulation cable${t.mods.length > 1 ? 's' : ''}`);
    const mods = modDevs(t).map(x => modLabelOf(x.id, x.dev)); // (Tidy order)
    if (mods.length) lost.push(`“${t.name}”: its ${mods.join(', ')} module${mods.length > 1 ? 's' : ''}`);
    if (c.canonical && ins.length === 1) {
      if (isPatchModel(t.dev[ins[0]].model)) lost.push(patchLine(t.name, t.dev[ins[0]]));
      const v = Object.assign({}, c.v1); if (v.seq == null) delete v.seq; out.push(Object.assign(coreOf(t), v)); continue;
    }
    // not today's shape: each instrument its own track (the primary first, keeping the track's id), notes copied
    const W = t.wires.filter(isObj);
    const srcs = pid => W.filter(w => (port(w.b) || {}).dev === pid).map(w => (port(w.a) || {}).dev).filter(k => kindOf(t.dev[k]) === 'inst');
    const on = powered(t), lvl = g => g !== undefined && g !== 1;
    instRoutes(t).forEach(({ id, d, v, to, via, end }, i) => {
      const tr = Object.assign(coreOf(t), v);
      if (i) { tr.id = freshId(); tr.name = (t.name || 'Track') + ' · ' + (d.name || d.model); delete tr.lay; }
      const nm = `“${tr.name}”: `;
      if (isPatchModel(d.model)) lost.push(patchLine(tr.name, d));
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
  }
  // (7a, IMPL-7a §6) a drum machine plays nothing in main (its model falls back to a Minimoog there): its notes are kept
  // (7b: a line per drum model, named by it — the tracks' models in the order they first appear)
  const dr = new Map();
  for (const o of out) if (isObj(o) && isDrum(o.model)) { if (!dr.has(o.model)) dr.set(o.model, []); dr.get(o.model).push(`“${o.name}”`); }
  for (const [id, names] of dr) lost.push(`${(MODELS.find(m => m.id === id) || { name: id }).name} track${names.length > 1 ? 's' : ''} ${names.join(', ')}: the live site has no drum machine — ${names.length > 1 ? 'their' : 'its'} piano-roll notes are kept`);
  p.tracks = out;
  return { p, lost: [...new Set(lost)] };
}
/* ---------------------------------------------------------------- stage 1f: one instrument per track in the UI */
// a canonical one-instrument track (cv-graph §5.5) and nothing beside it but its panel and OUT — a classic one into a
// panel (one straight into OUT is given an empty panel: the same sound, and the Effects tray always finds one): kept as is
function single(t) {
  const ins = Object.keys(t.dev).filter(k => kindOf(t.dev[k]) === 'inst');
  if (ins.length !== 1) return false;
  let c = null;
  try { c = compileTrack(t); } catch { return false; }
  if (!c.canonical) return false;
  const sx = t.dev[ins[0]].model === 'serum', pid = sx ? null : panelOf(t, ins[0]);
  return (sx || !!pid) && Object.keys(t.dev).every(k => k === ins[0] || k === pid || kindOf(t.dev[k]) === 'out' || kindOf(t.dev[k]) === 'mod');
}
// (2a / 2b) the rows of t that end on instrument id and start at the project wheel, any port of a modulator of t or the
// instrument's own LFO / ENV ('<id>/lfo3.out': a Serum linked to itself) — as they go to the track that instrument becomes
// (as: its id there); the modulator devices they need. A row from another instrument's LFO / ENV does not survive.
function rowsTo(t, id, as) {
  const R = [], devs = {};
  for (const r of Array.isArray(t.mods) ? t.mods : []) {
    if (!isObj(r) || typeof r.dst !== 'string' || r.dst.slice(0, r.dst.indexOf(':')) !== id) continue;
    const m = typeof r.src === 'string' ? /^([a-z][a-z0-9]{0,15})(\/(?:lfo\d+|env\d))?\.[a-z][a-z0-9]{0,7}$/.exec(r.src) : null;
    const own = m && m[2] && m[1] === id, mod = m && !m[2] && kindOf(t.dev[m[1]]) === 'mod';
    if (r.src !== 'wheel' && !own && !mod) continue;
    if (mod) devs[m[1]] = plainCopy(t.dev[m[1]]);
    R.push(Object.assign({}, r, { dst: as + r.dst.slice(id.length) }, own ? { src: as + r.src.slice(id.length) } : null));
  }
  return { R, devs };
}
const hasFx = fx => isObj(fx) && Array.isArray(fx.racks) && fx.racks.some(r => isObj(r) && Array.isArray(r.mods) && r.mods.length > 0); // (= cv-model's)
const maxTrk = ids => { let n = 0; for (const id of ids) { const m = /^trk_(\d{1,9})$/.exec(id); if (m) n = Math.max(n, +m[1]); } return n; };
const NAME_MAX = 100; // (song.js: a track name's length)
export function splitTracks(p, o = {}) {
  if (!isObj(p) || !Array.isArray(p.tracks)) return { p, notices: [] };
  const name = typeof o.name === 'function' ? o.name : m => m, notices = [], out = [];
  const ids = new Set(p.tracks.map(t => isObj(t) && t.id)), unseen = id => !ids.has(id);
  let n = maxTrk(ids), changed = false;
  const freshId = () => { let id; do id = 'trk_' + ++n; while (!unseen(id)); ids.add(id); return id; };
  const lvl = g => g !== undefined && g !== 1;
  for (const t0 of p.tracks) {
    if (!isObj(t0) || !isObj(t0.dev) || single(t0)) { out.push(t0); continue; }
    const t = plainCopy(t0), on = powered(t);
    let R = instRoutes(t);
    if (!R.length) { out.push(t0); continue; } // (no instrument: song.js / adopt deal with it)
    changed = true;
    // what sounded: on, cabled (through at most one panel) to OUT, not soloed out
    const outId = Object.keys(t.dev).find(k => kindOf(t.dev[k]) === 'out') || 'out', many = R.length > 1;
    for (const r of R) r.heard = r.d.on !== false && !!r.end && kindOf(t.dev[r.end.id]) === 'out' && on.includes(r.id);
    const k0 = R.findIndex(r => r.heard); // the first sounding instrument keeps the track (else the primary)
    if (k0 > 0) R = [R[k0], ...R.slice(0, k0), ...R.slice(k0 + 1)];
    const used = new Set(R.map(r => r.via).filter(Boolean)), why = [];
    let kept = 0;
    R.forEach(({ id, d, v, to, via, end, heard }, i) => {
      const tr = coreOf(t), dv = Object.assign({}, d), sx = d.model === 'serum', lost = [];
      for (const k of ['on', 'solo', 'zone', 'fx']) delete dv[k];
      if (!heard) {
        tr.mute = true; // (it did not sound: it stays quiet until unmuted)
        lost.push(d.on === false ? 'was switched off (now muted)' : !end || kindOf(t.dev[end.id]) !== 'out' ? 'was not connected (now muted)' : 'was silent, another one soloed (now muted)');
      }
      const z = zoneOf(d);
      if (z.lo !== 0 || z.hi !== 127 || z.xp !== 0) lost.push('its key zone / transpose was dropped');
      if ((to && lvl(to.g)) || (via && end && lvl(end.g))) lost.push('its cable level was dropped');
      if (sx) { // a Serum heard through a panel: with no effects of its own, the panel's become its own (reshape's 'moved': the same sound)
        const pfx = via && isObj(t.dev[via]) ? t.dev[via].fx : undefined;
        if (via && !hasFx(v.fx) && pfx !== undefined) dv.fx = plainCopy(pfx);
        else { dv.fx = plainCopy(v.fx); if (via && hasFx(pfx)) lost.push('the panel after it was not kept'); }
      } else delete dv.fxId;
      if (lost.length) why.push((many ? (d.name || name(d.model)) + ': ' : '') + lost.join('; '));
      const P = { kind: 'panel', fx: plainCopy(v.fx) };
      if (i === 0) { // the keeper: the track's id, name, selection, its device ids, the lay of what it keeps
        let pid = null;
        tr.nid = t.nid;
        if (!sx) {
          pid = via;
          if (!pid) { let k = Math.max(t.nid | 0, 1, ...Object.keys(t.dev).map(x => { const m = /(\d+)$/.exec(x); return m ? +m[1] + 1 : 0; })); while (('fx' + k) in t.dev) k++; pid = 'fx' + k; tr.nid = k + 1; }
          else if (isObj(t.dev[via]) && typeof t.dev[via].name === 'string') P.name = t.dev[via].name;
        }
        tr.prim = id;
        tr.dev = { [id]: dv };
        if (pid) tr.dev[pid] = P;
        tr.dev[outId] = { kind: 'out' };
        for (const k of Object.keys(t.dev)) if (kindOf(t.dev[k]) === 'mod') tr.dev[k] = t.dev[k]; // (2a: the modulators stay)
        tr.wires = pid ? [{ id: 'w1', a: id + '.out', b: pid + '.in' }, { id: 'w2', a: pid + '.out', b: outId + '.in' }] : [{ id: 'w1', a: id + '.out', b: outId + '.in' }];
        if (isObj(t.lay)) { const L = {}; for (const k of [id, id + '/fx', pid, outId, 'wheel', ...Object.keys(t.dev).filter(x => kindOf(t.dev[x]) === 'mod')]) if (k && isObj(t.lay[k])) L[k] = t.lay[k]; if (Object.keys(L).length) tr.lay = L; else delete tr.lay; }
      } else { // a new track: i1 [→ fx1] → out (stage 1d's shape), Tidy; its name cut so " · Model" fits
        delete dv.fxId;
        const sfx = ' · ' + (d.name || name(d.model)), base = (t.name || 'Track').slice(0, Math.max(1, NAME_MAX - sfx.length));
        Object.assign(tr, { id: freshId(), name: (base + sfx).slice(0, NAME_MAX), prim: 'i1', nid: 2, dev: { i1: dv } });
        delete tr.lay;
        if (sx) { tr.dev.out = { kind: 'out' }; tr.wires = [{ id: 'w1', a: 'i1.out', b: 'out.in' }]; }
        else { tr.dev.fx1 = P; tr.dev.out = { kind: 'out' }; tr.wires = [{ id: 'w1', a: 'i1.out', b: 'fx1.in' }, { id: 'w2', a: 'fx1.out', b: 'out.in' }]; }
        tr.notes = plainCopy(t.notes); tr.cc = plainCopy(t.cc);
      }
      const { R: rows, devs } = rowsTo(t, id, i === 0 ? id : 'i1'); // (2a: its mod rows go with it)
      if (rows.length) { kept += rows.length; tr.mods = rows; tr.mid = Math.max(t.mid | 0, 1); if (i) Object.assign(tr.dev, devs); }
      out.push(tr);
    });
    const lostRows = (Array.isArray(t.mods) ? t.mods.length : 0) - kept;
    if (lostRows > 0) why.push(`${lostRows} modulation cable${lostRows > 1 ? 's' : ''} to nothing that survives ${lostRows > 1 ? 'were' : 'was'} dropped`);
    const loose = Object.keys(t.dev).filter(k => kindOf(t.dev[k]) === 'panel' && !used.has(k) && hasFx(t.dev[k].fx)).length;
    if (loose) why.push(`${loose} unconnected FX panel${loose > 1 ? 's' : ''} with effects ${loose > 1 ? 'were' : 'was'} dropped`);
    const head = many ? `Track “${t.name}” held ${R.length} instruments: now ${R.length} tracks` : `Track “${t.name}”`;
    if (many || why.length) notices.push(head + (why.length ? (many ? ' — ' : ': ') + why.join('; ') : ''));
  }
  return changed ? { p: Object.assign({}, p, { tracks: out }), notices } : { p, notices };
}
export function mirror(o) {
  if (!isObj(o) || !Array.isArray(o.tracks)) return o;
  for (const t of o.tracks) {
    const v = isObj(t) && isObj(t.dev) ? primV1(t) : null;
    if (v) for (const k of V1_KEYS) if (v[k] !== undefined) t[k] = v[k];
  }
  return o;
}
/* ---------------------------------------------------------------- milestone 3: the modulator column grows left */
export const MOD_W0 = 240; // (stage 2b's modulator width, every kind: what a stored place was made with)
const GROW = new Set(['lfo', 'env', 'macro', 'chaos']);
const fin = x => typeof x === 'number' && Number.isFinite(x);
const H_FX = 420, H_OUT = 260; // (cv-module's guessed heights of an FX panel and OUT: a migration measures nothing)
// (lane D, §9.4 item 4) the widths STEPS[6] grows to, frozen: cv-module's MOD_W at milestone 3 (a later width change — the
// parity gate's re-measure — never changes what a schema-6 project opens as)
export const MOD_W6 = Object.freeze({ lfo: 416, env: 320, macro: 256, chaos: 416 });
const modW = kind => MOD_W6[kind] || cvModule.W_MOD;
// a module's rect at (x, y) by its device entry (cv-module devicesOf): an instrument its Hardware panel (unless its entry
// says Simple) or its Simple / Serum size, a modulator its kind's, an FX panel and OUT the guesses; folded: its bar
function rectOf(d, e, w) {
  const fold = !!(e && e.fold), H = cvModule.BAR_H;
  let W, h;
  if (d.kind === 'inst') {
    const m = MODELS.find(x => x.id === d.model) || null, L = m && !m.custom && !(e && e.ui === 'flow') ? hwUsable(m.id, m) : null, z = L ? hwSizeOf(L, m) : cvModule.sizeFor(d.model);
    W = z.w; h = z.h;
  } else if (d.kind === 'mod') { W = w; h = cvModule.MOD_H[d.mod || cvModule.modKind(d.key)] || cvModule.MOD_H.at; }
  else if (d.kind === 'out') { W = cvModule.W_OUT; h = H_OUT; } else { W = cvModule.W_FX; h = H_FX; }
  return { x: e.x, y: e.y, w: W, h: fold ? H : h };
}
const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function growTrack(t, wheel, widthOf) {
  if (!isObj(t) || !isObj(t.dev) || !isObj(t.lay)) return t;
  const devs = cvModule.devicesOf(t);
  if (wheel) devs.push({ key: 'wheel', kind: 'mod', mod: 'wheel', model: null, dev: null });
  const tid = cvModule.tidy(t, {}, devs), L = t.lay, R = new Map();
  const okE = e => isObj(e) && fin(e.x) && fin(e.y);
  for (const d of devs) {
    const e = okE(L[d.key]) ? L[d.key] : okE(tid[d.key]) ? tid[d.key] : { x: 0, y: 0 }, k = d.mod || cvModule.modKind(d.key);
    const grow = d.kind === 'mod' && GROW.has(k) && okE(L[d.key]), w = d.kind === 'mod' ? (GROW.has(k) ? widthOf(k) : MOD_W0) : 0; // (a Tidy-placed one: Tidy's column already at its width)
    const r = rectOf(d, e, w);
    if (grow) r.x = e.x + MOD_W0 - w; // (its right edge kept)
    R.set(d.key, { r, grow, w });
  }
  // the leftmost first: of two grown modulators that now overlap, the left one moves on (the column grows left, nothing
  // jumps over its neighbour); each moves left past every module it overlaps until it overlaps none
  const order = [...R].filter(([, q]) => q.grow).sort((a, b) => a[1].r.x - b[1].r.x || (a[0] < b[0] ? -1 : 1));
  for (const [k, q] of order) {
    for (let i = 0; i < 64; i++) {
      let to = null;
      for (const [o, z] of R) if (o !== k && hits(q.r, z.r)) { const x = Math.floor((z.r.x - cvModule.MOD_GAP - q.w) / DOT) * DOT; to = to === null ? x : Math.min(to, x); }
      if (to === null) break;
      q.r.x = to;
    }
  }
  let lay = null;
  for (const [k, q] of R) if (q.grow && q.r.x !== L[k].x) { lay = lay || Object.assign({}, L); lay[k] = Object.assign({}, L[k], { x: q.r.x }); }
  return lay ? Object.assign({}, t, { lay }) : t;
}
export function growMods(p, widthOf = modW) {
  if (!isObj(p) || !Array.isArray(p.tracks)) return Object.assign({}, p);
  const wheel = isObj(p.perf) && isObj(p.perf.wheel);
  return Object.assign({}, p, { tracks: p.tracks.map(t => growTrack(t, wheel, widthOf)) });
}
