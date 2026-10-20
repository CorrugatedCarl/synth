// cv-model.js — the in-memory v2 track of SYNTH Canvas and its editing API (SPEC-canvas §5.1, §5.4, §6.6, §6.7; stages
// 1c, 1e). Pure ES module: no DOM, no storage (node-tested: tests/cv-migrate.test.mjs).
//
// adopt(project) is the ONE point every track passes on its way into the project: main.js loadProject, freshProject,
// applyRestore (undo / redo / New / Open / MIDI import), addTrack, duplicateTrack. A v1 track (model / vals / preset / seq /
// fx as own fields: song.js newTrack, an old record) is converted in place (cv-migrate trackToV2: the same object, so
// references held elsewhere stay good; a v2 record's file mirror is dropped) and a track without a primary repaired. A
// track has no v1 fields after it: its instruments are read as devices — instOf(t, id), fxDevOf(t) — and changed through
// the editing API (setModel …). (Milestone 3, R7: the 1c–1e transition accessors are gone; 'model' in t === false.)
//   adopt(p, { guard }) → p   guard (for one stage: the sims, dev builds ?dev=1, node tests): every adopted track gets
//        throwing non-enumerable V1-key accessors (track.model / vals / preset / seq / fx: a stray read or `t.model = …`
//        throws instead of reading undefined or creating an enumerable field autosave and History would serialise);
//        each call is told to the accessor recorder first (tests/accessor-hook.mjs)
//   isAdopted(t)   instOf(t, id = prim)   primId(t)   fxDevOf(t) → { id, dev, own } | null
//   (milestone 3) dropLay(t, id): the layout entries of device id and of every 'id/…' module; PARTS, partOf(key) →
//   { dev, part } | null: a Serum part's module key 'iN/oscA' (IMPL-3 §2.1, §3)
//
// The editing API (stage 1e, IMPL-1e §3.2): every call edits the live track in place (History is the caller's: one
// snapshot around the call); a refusal leaves it untouched.
//   addInst(t, modelId, {vals, preset, fx, ui, name}) → id | null (over LIMITS.inst)   zone 0…127 / 0, on; auto-patch: its out
//        to the shared panel with the most instrument sources (≥ 1; ties: the lowest id), else to OUT (a Serum the same: its
//        own FX — `fx`, else an empty rack — are inside it). ui 'flow' → t.lay[id].ui (the caller places it)
//   removeInst(t, id) → {ok, why}       refused for the last instrument; its cables and mod rows go; a removed primary →
//        the lowest remaining instrument id is the primary
//   addPanel(t, {fx, name}) → id | null (over LIMITS.panels)   no cables
//   removePanel(t, id) → {ok, why}      every source of the panel is re-cabled to what the panel fed (OUT; nothing: cut)
//   connect(t, a, b, g = 1) → {ok, why, code, fix, wire}   ports 'i1.out' / 'fx1.in' (either order); a's existing cable is
//        replaced (re-patch, its id kept); refused with validate's message when the result has an error the track had
//        not (code: its code; own-fx: fix 'panel' = sharedPanelFix)
//   disconnect(t, wireId) → {ok}
//   setPower(t, id, on)  setSolo(t, id, solo)  setZone(t, id, {lo, hi, xp}) → {ok, zone}  makePrimary(t, id) → {ok, why}
//   setModel(t, id, modelId, {vals, preset, fx}) → {ok, why}   classic → Serum: the only source of a panel that feeds OUT
//        takes the panel's state as its own FX and the panel goes (1c's reshape); otherwise it keeps feeding the panel with
//        an empty own rack (`fx` when given); the folded panel's id is kept on the Serum (dev.fxId, saved). Serum →
//        classic: its own FX become a panel between it and what it fed (id: dev.fxId when free, else a new one);
//        when it fed a shared panel (panel → panel: stage 4) it keeps feeding that panel and its own FX, when they hold any
//        effect, are kept as an unconnected panel
//   sharedPanelFix(t, serumId, srcId) → panelId   "Make a shared panel" (the own-fx refusal): a panel after the Serum,
//        Serum and srcId into it, the panel into what the Serum fed (a Serum already feeding a panel: srcId joins it)
//   instIds(t) → [ids] (primary first)   isGraphShape(t) (not canonical)   destOf(t, id) → the device id it feeds | null
//
// Stage 2a, performance modulators (IMPL-2a §2.2; rows: cv-mods.js, the compile: cv-graph injectMods); stage 2b, every
// modulator (IMPL-2b §1.1, §3). Pure, in place, History the caller's; a refusal leaves the track untouched.
//   addModDev(t, kind) → id | null      kind 'velo' | 'at' | 'bend' | 'note' → the singleton 've' | 'at' | 'bd' | 'nt' (null:
//        there already); 'lfo' | 'env' | 'macro' | 'cc' | 'chaos' → '<prefix><n>' (l / e / m / c / h; n = the highest of
//        that prefix + 1 — a removed module's number comes round again, its rows went with it) with the module's default
//        state (song.normModDev of nothing: an LFO = Serum's default LFO as GLOBAL (mono 1), an ENV = Serum's ENV 2
//        defaults, a macro 8 knobs at 0 with empty names, a CC { cc: 1, ch: 0, v: 0 }, a chaos GLOBAL (mono 1, as a canvas
//        LFO: the lead, review 2 — a per-note chaos on a classic knob would restart at every note) at Serum's rate, S&H off)
//   removeModDev(t, id) → { ok, rows }   the device and every row from it (any port); rows: the ids removed
//   setModState(t, id, fields) → { ok, why }   the module's state fields merged in and bounded (song.normModDev: the
//        device-level keys — rate, att…rel, crv, v, names, cc… — and the slot objects lfo / env / chaos, each replaced
//        whole as the bodies pass them; a partial one is merged over the old) — the device object stays the same object
//   placeWheel(p) → { ok, byTrack: [] }  project.perf.wheel = { v: 1 } (ok false: placed already)
//   removeWheel(p) / wheelRows(p) → { ok, byTrack: [{ trackId, rows }] }   every 'wheel' row of every track (removeWheel
//        deletes them, the wheel's lay entries and the wheel; wheelRows only lists them: the confirm's counts)
//   hasWheel(p)
//   addMod(t, src, dst, o) → { ok, row, why, code }   src 'wheel' (o.project given: its wheel must be placed), any port of
//        a modulator of t ('l1.out', 'm1.k3') or a Serum's own LFO / ENV ('i1/lfo3.out'); dst '<dev>:<param>' — a Serum's
//        DESTS id / own FX id, a classic sm / apply / proc knob or a panel's effect knob (cv-mods destOk; chunk knobs:
//        code 'stage', stage '5'). A Serum: the matrix not full (budget incl. the Serum's own rows) and serum-core
//        addMod's drop rules on its live state (bi = the destination's ctr flag; bool dest ±1, bipolar 0.5, unipolar
//        o.limit ≠ false ? max(0.05, min(0.5, 1 − base)) : 0.5; aux ''). A classic / panel knob (2b): bi = the knob's ctr
//        (a centred −x…x knob), amount 0.25 (bipolar on a centred knob; a bool / toggle: ±1 by its live value); no limit.
//        o.amt / o.bi / curve / crv / aux / inv / byp / out / acurve / rise / fall / slink override, through normRow's
//        rules. codes: end (no such device), src (unknown source), nomod, stage, full ("<name>’s mod rows are full
//        (64/64)", o.name: the module's title), aux (refused by normRow)
//        Row: { id: 'r<n>', src, dst, amt, bi, curve, aux, inv, byp, out, acurve, crv, rise, fall, slink } (normRow's
//        fields and order after the ends); ids from the counter track.mid (saved; also past every 'r<n>' present): never reused
//   setMod(t, rowId, fields) → { ok, why }   the row's fields (not id / src / dst) through normRow's rules (a non-native
//        source or destination: the same rules by proxy — the source check is the row's own, done at addMod)
//   removeMod(t, rowId) → { ok, why }
//   presetRows(dev) → [{ slot, from, …row }]   a Serum's s.matrix rows with a performance source (wheel / velo / at / bend,
//        with a destination); from: the canvas source ('wheel', 've.out', …)
//   toPreset(t, rowId, s) → { ok, why, slot, row, matrix }   the row leaves track.mods and goes into a copy of s.matrix
//        (matrix) at the slot it compiles to now (the compile is unchanged); refused when it is not placed (matrix full)
//   fromPreset(t, dev, slot, o) → { ok, why, row, slot, matrix }   the preset row becomes a track.mods row (placed where
//        it lands in the slot it left whenever the canvas rows before it allow) and a copy of s.matrix without it. The
//        caller applies matrix through sxEdit (the panel's undo, queuePatch). o.project as addMod's
//   removeInst / setModel drop the rows to an instrument that is gone or whose knob is not on the new model (the same
//        param id, modulatable there — else dropped): removeInst → rows, setModel → rows and notice
//        (a line for the caller; '' when none)
import { trackToV2, panelOf, V1_KEYS } from './cv-migrate.js?v=9';
import { validate, compileTrack, kindOf, port, devNum, zoneOf, LIMITS, modRowsFor, nativeRow, injectMods, modBudget } from './cv-graph.js?v=9';
import { MOD_SRC, SRC_MOD, MOD_DEV, MOD_LABEL, MOD_PREFIX, MOD_MULTI, destOk, srcDev, descs, modLabelOf } from './cv-mods.js?v=9';
// (the host's one namespace for the rows: cv-mods' tables and checks, re-exported)
export { MOD_SRC, SRC_MOD, MOD_DEV, MOD_LABEL, MOD_PREFIX, MOD_MULTI, MOD_ORDER, destOk, plainSwitch, sourcesOf, linkSources, wheelTracks, kindOfId, modLabelOf, modDevs, srcOf, perNoteOf } from './cv-mods.js?v=9';
import { normModDev } from './song.js?v=9';
import { defaultFx2, addMod as sxAddMod, normRow, N_MATRIX } from './serum-core.js?v=9';
import { fxDest } from './fx-core.js?v=9';

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const done = new WeakSet();
export const isAdopted = t => done.has(t);
const synths = t => Object.keys(t.dev).filter(k => isObj(t.dev[k]) && t.dev[k].kind === 'synth');
export function primId(t) {
  if (!isObj(t) || !isObj(t.dev)) return null;
  const d = t.dev[t.prim];
  return isObj(d) && d.kind === 'synth' ? t.prim : synths(t)[0] || null;
}
export const instOf = (t, id) => { const k = id == null ? primId(t) : id, d = k && t.dev[k]; return isObj(d) && d.kind === 'synth' ? d : null; };
const outId = t => Object.keys(t.dev).find(k => isObj(t.dev[k]) && t.dev[k].kind === 'out') || null;
// the device holding the primary's FX: a Serum itself (own: true), a classic primary's panel
export function fxDevOf(t) {
  const id = primId(t), d = id && t.dev[id];
  if (!d) return null;
  if (d.model === 'serum') return { id, dev: d, own: true };
  const pid = panelOf(t, id);
  return pid ? { id: pid, dev: t.dev[pid], own: false } : null;
}
function nextId(t, pre) { // a fresh device id (track.nid: never reused)
  let n = Math.max(t.nid | 0, 1, ...Object.keys(t.dev).map(devNum).map(x => x + 1));
  while ((pre + n) in t.dev) n++;
  t.nid = n + 1;
  return pre + n;
}
function wireId(t) { let n = 1; const ids = new Set(t.wires.map(w => isObj(w) && w.id)); while (ids.has('w' + n)) n++; return 'w' + n; }
const touches = (w, id) => isObj(w) && ((typeof w.a === 'string' && w.a.split('.')[0] === id) || (typeof w.b === 'string' && w.b.split('.')[0] === id));
const byNum = (a, b) => devNum(a) - devNum(b) || (a < b ? -1 : a > b ? 1 : 0);
// the cable leaving device id's output (one per output, validate fan-out), the cables into its input
const outWire = (t, id) => t.wires.find(w => isObj(w) && w.a === id + '.out') || null;
const inWires = (t, id) => t.wires.filter(w => isObj(w) && typeof w.b === 'string' && w.b === id + '.in');
export function destOf(t, id) { const w = isObj(t) && Array.isArray(t.wires) ? outWire(t, id) : null, b = w && port(w.b); return b && b.dev in t.dev ? b.dev : null; }
const wire = (t, a, b, g) => { const w = { id: wireId(t), a, b }; if (g !== undefined && g !== 1) w.g = g; t.wires.push(w); return w; };
const hasFx = fx => isObj(fx) && Array.isArray(fx.racks) && fx.racks.some(r => isObj(r) && Array.isArray(r.mods) && r.mods.length > 0);
// (milestone 3, schema 7) a device's layout entries: its own and every 'id/…' module of it (a Serum's own FX 'iN/fx', its
// parts 'iN/oscA' …); the track's lay object itself is edited (History is the caller's)
export function dropLay(t, id) {
  if (!isObj(t) || !isObj(t.lay) || typeof id !== 'string' || !id) return;
  for (const k of Object.keys(t.lay)) if (k === id || k.startsWith(id + '/')) delete t.lay[k];
}
// (milestone 3, IMPL-3 §2.1) the parts of a Serum that are modules in its parts view, keyed 'iN/<part>' (serum-core module
// names; MACROS new): VOICE is the device key iN itself, its own FX stays 'iN/fx' (not a part)
export const PARTS = Object.freeze(['oscA', 'oscB', 'oscC', 'sub', 'noise', 'filter', 'filter2', 'env2', 'env3', 'env4',
  ...Array.from({ length: 10 }, (_, i) => 'lfo' + (i + 1)), 'macros', 'arp', 'clip']);
/** a module key 'iN/<part>' → { dev, part } | null (a device, its own FX, anything else) */
export function partOf(key) {
  const m = typeof key === 'string' ? /^([a-z][a-z0-9]{0,15})\/([a-z][a-zA-Z0-9]{0,15})$/.exec(key) : null;
  return m && PARTS.includes(m[2]) ? { dev: m[1], part: m[2] } : null;
}
// classic ↔ Serum: the FX state moves with the instrument's kind (setModel's kept-FX rules)
function reshape(t, id, toSerum) {
  const d = t.dev[id], out = outId(t) || (t.dev.out = { kind: 'out' }, 'out'), w = outWire(t, id), dst = w && port(w.b);
  const pid = dst && kindOf(t.dev[dst.dev]) === 'panel' ? dst.dev : null;
  if (toSerum) {
    if (!pid) { if (!w) wire(t, id + '.out', out + '.in'); return 'none'; } // (straight into OUT, or silent: nothing to move)
    const pw = outWire(t, pid);
    if (inWires(t, pid).length === 1 && pw && pw.b === out + '.in') { // its own panel: the state comes inside the Serum
      if (t.dev[pid].fx !== undefined) d.fx = t.dev[pid].fx;
      d.fxId = pid; // (the panel's id, saved: a change back to classic unfolds it under the same id — its layout entry)
      delete t.dev[pid]; // (its layout entry stays: the view puts the Serum FX where the panel was, cv-module layOf)
      t.wires = t.wires.filter(x => !touches(x, pid) && x !== w);
      wire(t, id + '.out', out + '.in', pw.g);
      return 'moved';
    }
    if (d.fx === undefined) d.fx = defaultFx2(); // a shared panel: the Serum keeps feeding it, its own rack empty
    return 'kept';
  }
  const fx = d.fx, was = typeof d.fxId === 'string' && /^fx\d+$/.test(d.fxId) && !(d.fxId in t.dev) ? d.fxId : null;
  delete d.fx; delete d.fxId;
  if (pid) { // fed a shared panel: still does (panel → panel is stage 4); its own effects kept as a panel of their own
    if (hasFx(fx)) t.dev[nextId(t, 'fx')] = { kind: 'panel', fx };
    return 'kept';
  }
  // the panel it folded in, under that id (free: nothing else ever takes it); else a new id — never another reused one
  const np = was || nextId(t, 'fx'), P = { kind: 'panel' };
  if (fx !== undefined) P.fx = fx;
  t.dev[np] = P;
  t.wires = t.wires.filter(x => x !== w);
  wire(t, id + '.out', np + '.in');
  if (w) wire(t, np + '.out', w.b, w.g);
  return 'moved';
}
// (milestone 3, R0 / R7) the dynamic accessor recorder (tests/accessor-hook.mjs sets globalThis.__synthAccess): every call
// of a guard accessor is told (key, 'get' | 'set') before it throws; nothing else reads it
const told = (k, op) => { const f = globalThis.__synthAccess; if (typeof f === 'function') f(k, op); };
const GUARD = k => ({
  get() { told(k, 'get'); throw new Error(`cv-model: track.${k} read — a track has no v1 fields (read its device: instOf(t, dev), fxDevOf(t))`); },
  set() { told(k, 'set'); throw new Error(`cv-model: track.${k} written — a track has no v1 fields (write its device, or setModel)`); },
  enumerable: false, configurable: true,
});
// a v2 track whose primary is missing gets one (a hand-made or damaged record: a Minimoog, as song.js defaults one)
function repair(t) {
  if (!Array.isArray(t.wires)) t.wires = [];
  const id = primId(t);
  if (id) { t.prim = id; return; }
  const i = nextId(t, 'i');
  t.dev[i] = { kind: 'synth', model: 'minimoog', vals: {}, preset: null };
  t.prim = i;
  wire(t, i + '.out', (outId(t) || (t.dev.out = { kind: 'out' }, 'out')) + '.in');
  reshape(t, i, false);
}
export function adopt(p, o = {}) {
  if (!isObj(p) || !Array.isArray(p.tracks)) return p;
  const guard = !!(o && o.guard);
  for (const t of p.tracks) {
    if (!isObj(t) || done.has(t)) continue;
    if (!isObj(t.dev)) { // a v1 track: the same object becomes its v2 form (key order: the v2 fields last)
      const v2 = trackToV2(t);
      for (const k of V1_KEYS) delete t[k];
      for (const k of ['prim', 'nid', 'dev', 'wires']) { delete t[k]; t[k] = v2[k]; }
    } else for (const k of V1_KEYS) if (Object.prototype.hasOwnProperty.call(t, k)) delete t[k]; // (a mirror: the devices win)
    repair(t);
    if (guard) for (const k of V1_KEYS) Object.defineProperty(t, k, GUARD(k));
    done.add(t);
  }
  return p;
}

/* ------------------------------------------------------------------ the editing API (stage 1e, IMPL-1e §3.2) */
const NO = why => ({ ok: false, why });
const OK = { ok: true, why: '' };
export const instIds = t => { const p = primId(t); return p ? [p, ...synths(t).filter(k => k !== p)] : []; };
export const isGraphShape = t => isObj(t) && isObj(t.dev) && !compileTrack(t).canonical;
const panels = t => Object.keys(t.dev).filter(k => kindOf(t.dev[k]) === 'panel');
export function addInst(t, modelId, o = {}) {
  if (synths(t).length >= LIMITS.inst) return null;
  const id = nextId(t, 'i'), d = { kind: 'synth', model: modelId, vals: isObj(o.vals) ? o.vals : {}, preset: o.preset === undefined ? null : o.preset };
  if (modelId === 'serum') d.fx = isObj(o.fx) ? o.fx : defaultFx2();
  if (typeof o.name === 'string' && o.name) d.name = o.name;
  t.dev[id] = d;
  // auto-patch: the panel most instruments share, else OUT
  let best = null, most = 0;
  for (const pid of panels(t).sort(byNum)) {
    const n = inWires(t, pid).filter(w => kindOf(t.dev[(port(w.a) || {}).dev]) === 'inst').length;
    if (n > most) { most = n; best = pid; }
  }
  const out = best || outId(t) || (t.dev.out = { kind: 'out' }, 'out');
  wire(t, id + '.out', out + '.in');
  if (o.ui === 'flow') { if (!isObj(t.lay)) t.lay = {}; t.lay[id] = Object.assign({ x: 0, y: 0 }, t.lay[id], { ui: 'flow' }); }
  return id;
}
export function removeInst(t, id) {
  if (!instOf(t, id)) return NO('No such instrument');
  if (synths(t).length <= 1) return NO('A track keeps at least one instrument');
  delete t.dev[id];
  t.wires = t.wires.filter(w => !touches(w, id));
  const rows = dropRows(t, id, true);
  dropLay(t, id);
  if (t.prim === id) t.prim = synths(t).sort(byNum)[0];
  return Object.assign({ rows }, OK);
}
export function addPanel(t, o = {}) {
  if (panels(t).length >= LIMITS.panels) return null;
  const id = nextId(t, 'fx'), P = { kind: 'panel', fx: isObj(o.fx) ? o.fx : defaultFx2() };
  if (typeof o.name === 'string' && o.name) P.name = o.name;
  t.dev[id] = P;
  return id;
}
export function removePanel(t, id) {
  if (kindOf(t.dev[id]) !== 'panel') return NO('No such panel');
  const pw = outWire(t, id);
  if (pw) for (const w of inWires(t, id)) w.b = pw.b; // (its sources into what it fed: OUT; it fed nothing: cut)
  delete t.dev[id];
  t.wires = t.wires.filter(w => !touches(w, id));
  const rows = dropRows(t, id); // (the cables to its knobs go with it, as removeInst's — review C8)
  dropLay(t, id);
  return Object.assign({ rows }, OK);
}
export function connect(t, a, b, g = 1) {
  let A = port(a), B = port(b);
  if (!A || !B) return Object.assign(NO('No such jack'), { code: 'end', fix: null, wire: null });
  if (A.port !== 'out' && B.port === 'out') { [a, b] = [b, a]; [A, B] = [B, A]; } // (dragged from an input)
  const old = t.wires.find(w => isObj(w) && w.a === a) || null;
  const w = { id: old ? old.id : wireId(t), a, b };
  if (g !== 1) w.g = g;
  const trial = Object.assign({}, t, { wires: t.wires.filter(x => x !== old).concat([w]) });
  const sig = e => e.code + '|' + e.at, before = new Set(validate(t).errors.filter(e => !old || e.at !== old.id).map(sig));
  const bad = validate(trial).errors.filter(e => !before.has(sig(e)));
  if (bad.length) return { ok: false, why: bad[0].msg, code: bad[0].code, fix: bad[0].code === 'own-fx' ? 'panel' : null, wire: null };
  if (old) { Object.assign(old, w); if (w.g === undefined) delete old.g; } else t.wires.push(w);
  return { ok: true, why: '', code: null, fix: null, wire: old || w };
}
export function disconnect(t, wireId) {
  const n = t.wires.length;
  t.wires = t.wires.filter(w => !(isObj(w) && w.id === wireId));
  return t.wires.length < n ? OK : NO('No such cable');
}
export function setPower(t, id, on) {
  const d = instOf(t, id);
  if (!d) return NO('No such instrument');
  if (on) delete d.on; else d.on = false;
  return OK;
}
export function setSolo(t, id, solo) {
  const d = instOf(t, id);
  if (!d) return NO('No such instrument');
  if (solo) d.solo = true; else delete d.solo;
  return OK;
}
export function setZone(t, id, z) {
  const d = instOf(t, id);
  if (!d) return NO('No such instrument');
  const zone = zoneOf({ zone: isObj(z) ? z : null });
  if (zone.lo === 0 && zone.hi === 127 && zone.xp === 0) delete d.zone; else d.zone = zone;
  return Object.assign({ zone }, OK);
}
export function makePrimary(t, id) {
  if (!instOf(t, id)) return NO('No such instrument');
  t.prim = id;
  return OK;
}
export function setModel(t, id, modelId, o = {}) {
  const d = instOf(t, id);
  if (!d) return NO('No such instrument');
  const was = d.model;
  d.model = modelId;
  if (o.vals !== undefined) d.vals = o.vals;
  d.preset = o.preset === undefined ? null : o.preset;
  if ((modelId === 'serum') !== (was === 'serum') && reshape(t, id, modelId === 'serum') !== 'moved' && modelId === 'serum' && isObj(o.fx)) d.fx = o.fx; // (no panel state moved in: the caller's rack)
  const rows = dropGone(t, id);
  const notice = rows.length ? `${rows.length} modulation cable${rows.length > 1 ? 's' : ''} to ${d.name || (was === 'serum' ? 'the Serum' : 'the instrument')} removed: the new model has no such knob${rows.length > 1 ? 's' : ''}` : '';
  return Object.assign({ rows, notice }, OK);
}
export function sharedPanelFix(t, serumId, srcId) {
  const w = outWire(t, serumId), dst = w && port(w.b), src = kindOf(t.dev[srcId]) === 'inst' ? srcId : null;
  const join = pid => {
    const old = src && outWire(t, src);
    if (old) { old.b = pid + '.in'; delete old.g; } else if (src) wire(t, src + '.out', pid + '.in');
    return pid;
  };
  if (dst && kindOf(t.dev[dst.dev]) === 'panel') return join(dst.dev);
  const pid = addPanel(t, {});
  if (!pid) return null;
  t.wires = t.wires.filter(x => x !== w);
  wire(t, serumId + '.out', pid + '.in');
  if (w) wire(t, pid + '.out', w.b, w.g);
  return join(pid);
}

/* ------------------------------------------------------------------ performance modulators (stage 2a, IMPL-2a §2.2) */
const NOMOD = 'This knob can’t be modulated';
// the rows that end on device id (any: or start at it) leave t.mods; their ids
function dropRows(t, id, any) {
  if (!Array.isArray(t.mods)) return [];
  const hit = r => isObj(r) && (any ? [r.src, r.dst] : [r.dst]).some(x => typeof x === 'string' && x.split(/[.:/]/)[0] === id);
  const gone = t.mods.filter(hit).map(r => r.id);
  if (gone.length) t.mods = t.mods.filter(r => !hit(r));
  return gone;
}
// (2b) the rows ending on device id whose knob the device no longer has (a model change: the same param id must be
// modulatable on the new model, else the row goes; a panel: an effect instance removed — the host calls pruneRows(t,
// panelId) after a rack edit and tells, review C8); their ids
function dropGone(t, id) {
  const d = isObj(t) && isObj(t.dev) ? t.dev[id] : null;
  if (!isObj(d) || !Array.isArray(t.mods)) return [];
  const hit = r => isObj(r) && typeof r.dst === 'string' && r.dst.split(':')[0] === id && !destOk(d, r.dst.slice(id.length + 1), true).ok; // (keep: an existing row to a plain switch survives)
  const gone = t.mods.filter(hit).map(r => r.id);
  if (gone.length) t.mods = t.mods.filter(r => !hit(r));
  return gone;
}
export const pruneRows = dropGone;
const mods = t => (Array.isArray(t.mods) ? t.mods : (t.mods = []));
const ROW_F = ['amt', 'bi', 'curve', 'aux', 'inv', 'byp', 'out', 'acurve', 'crv', 'rise', 'fall', 'slink'];
const rowOf = (id, src, dst, n) => { const r = { id, src, dst }; for (const k of ROW_F) r[k] = n[k]; return r; };
function rowId(t) { // track.mid: the next row number (saved), past every 'r<n>' present
  let n = Math.max(t.mid | 0, 1);
  for (const r of mods(t)) { const m = isObj(r) && typeof r.id === 'string' ? /^r(\d{1,6})$/.exec(r.id) : null; if (m) n = Math.max(n, +m[1] + 1); }
  t.mid = n + 1;
  return 'r' + n;
}
const devKey = (t, dev) => (typeof dev === 'string' ? dev : Object.keys(t.dev).find(k => t.dev[k] === dev));
const splitDst = dst => { const i = typeof dst === 'string' ? dst.indexOf(':') : -1; return i > 0 ? { dev: dst.slice(0, i), param: dst.slice(i + 1) } : null; };
export const hasWheel = p => isObj(p) && isObj(p.perf) && isObj(p.perf.wheel);
function srcOk(t, src, p) {
  if (src === 'wheel') return p === undefined || hasWheel(p);
  return srcDev(t, src) !== null;
}
const fullWhy = (o, d) => `${(o && o.name) || d.name || 'Serum'}’s mod rows are full (64/64)`;
export function addModDev(t, kind) {
  const pre = MOD_PREFIX[kind];
  if (!pre || !isObj(t) || !isObj(t.dev)) return null;
  let id = pre;
  if (MOD_MULTI.includes(kind)) {
    let n = 0;
    for (const k of Object.keys(t.dev)) { const m = new RegExp('^' + pre + '([1-9]\\d{0,5})$').exec(k); if (m) n = Math.max(n, +m[1]); }
    id = pre + (n + 1);
  } else if (id in t.dev) return null;
  t.dev[id] = normModDev(kind === 'lfo' ? { kind, lfo: { mono: 1 } } : kind === 'chaos' ? { kind, chaos: { mono: 1, sh: 0 } } : { kind }); // (an LFO / a chaos module GLOBAL)
  return id;
}
export function setModState(t, id, fields) {
  const d = isObj(t) && isObj(t.dev) ? t.dev[id] : null;
  if (!isObj(d) || kindOf(d) !== 'mod' || !isObj(fields)) return NO('No such modulator');
  const merged = Object.assign({}, d);
  for (const k of Object.keys(fields)) { // (a nested object merges one level; an array element-wise — { crv: [0.9] } keeps the other two, review C12)
    if (k === 'kind') continue;
    const f = fields[k], o = d[k];
    merged[k] = isObj(f) && isObj(o) ? Object.assign({}, o, f) : Array.isArray(f) && Array.isArray(o) ? o.map((x, i) => (i < f.length && f[i] !== undefined ? f[i] : x)).concat(f.slice(o.length)) : f;
  }
  const n = normModDev(merged);
  for (const k of Object.keys(d)) if (!(k in n)) delete d[k];
  Object.assign(d, n);
  return OK;
}
export function removeModDev(t, id) {
  if (!isObj(t) || !isObj(t.dev) || kindOf(t.dev[id]) !== 'mod') return { ok: false, why: 'No such modulator', rows: [] };
  delete t.dev[id];
  const rows = dropRows(t, id, true);
  dropLay(t, id);
  return { ok: true, why: '', rows };
}
export function placeWheel(p) {
  if (!isObj(p) || hasWheel(p)) return { ok: false, byTrack: [] };
  p.perf = { wheel: { v: 1 } };
  return { ok: true, byTrack: [] };
}
export function wheelRows(p) {
  const byTrack = [];
  for (const t of isObj(p) && Array.isArray(p.tracks) ? p.tracks : []) {
    const rows = isObj(t) && Array.isArray(t.mods) ? t.mods.filter(r => isObj(r) && r.src === 'wheel').map(r => r.id) : [];
    if (rows.length) byTrack.push({ trackId: t.id, rows });
  }
  return { ok: true, byTrack };
}
export function removeWheel(p) {
  if (!isObj(p)) return { ok: false, byTrack: [] };
  const w = wheelRows(p), on = hasWheel(p);
  for (const t of Array.isArray(p.tracks) ? p.tracks : []) {
    if (!isObj(t)) continue;
    if (Array.isArray(t.mods) && t.mods.some(r => isObj(r) && r.src === 'wheel')) t.mods = t.mods.filter(r => !(isObj(r) && r.src === 'wheel'));
    if (isObj(t.lay)) delete t.lay.wheel;
  }
  p.perf = { wheel: null };
  return { ok: on || w.byTrack.length > 0, byTrack: w.byTrack };
}
export function addMod(t, src, dst, o = {}) {
  const no = (why, code) => ({ ok: false, row: null, why, code });
  if (!isObj(t) || !isObj(t.dev)) return no('No such track', 'end');
  if (!srcOk(t, src, o.project)) return no('That modulator is not on this track', 'src');
  const D = splitDst(dst), d = D && t.dev[D.dev];
  if (!isObj(d)) return no('A modulation cable ends on nothing', 'end');
  const k = destOk(d, D.param);
  if (!k.ok) return no(k.why, k.stage ? 'stage' : 'nomod');
  const sx = d.kind === 'synth' && d.model === 'serum', f = {};
  if (sx) {
    const b = modBudget(t, D.dev, o.project);
    if (b.preset + b.canvas >= N_MATRIX || Object.values(b.why).includes('full')) return no(fullWhy(o, d), 'full');
    // the drop defaults (serum-core addMod, §5.8) against the Serum's live bases, on a one-slot scratch copy (the source: a
    // native stand-in — the defaults read the destination alone)
    const s = isObj(d.vals) && isObj(d.vals.s) ? d.vals.s : {}, tmp = Object.assign({}, s, { matrix: [{ src: '' }] });
    if (sxAddMod(tmp, d.fx, MOD_SRC[src] || 'wheel', D.param, { amt: o.amt, bi: o.bi, limit: o.limit }) !== 0) return no(NOMOD, 'nomod');
    Object.assign(f, tmp.matrix[0]);
  } else { // a classic / panel knob (2b): by the descriptor's law — 0.25 of the range, bipolar on a centred knob, ±1 on a toggle
    const desc = descs(d).find(x => x.id === D.param);
    if (!desc) return no(NOMOD, 'nomod');
    const bi = o.bi === undefined || o.bi === null ? desc.ctr : o.bi ? 1 : 0;
    let amt = 0.25;
    if (typeof o.amt === 'number') amt = o.amt;
    else if (desc.law === 'bool') {
      let base = desc.def;
      if (d.kind === 'synth') base = isObj(d.vals) && d.vals[D.param] !== undefined ? d.vals[D.param] : desc.def;
      else { const q = fxDest(D.param, isObj(d.fx) ? d.fx : d.rack); const v = q && isObj(q.inst) && isObj(q.inst.p) ? q.inst.p[q.pid] : undefined; if (v !== undefined) base = v; }
      amt = base ? -1 : 1;
    }
    Object.assign(f, { src: 'wheel', amt, dst: 'f.cutoff', bi });
  }
  for (const x of ROW_F) if (x !== 'amt' && x !== 'bi' && o[x] !== undefined) f[x] = o[x];
  if (!sx) { f.aux = ''; f.inv = 0; } // (an aux names a Serum source; on a classic / panel row it would name the synthetic CP's slot — none, review C7)
  const n = normRow(f);
  if (!n.src) return no('Unknown aux source', 'aux');
  const row = rowOf(rowId(t), src, dst, n);
  mods(t).push(row);
  return { ok: true, row, why: '', code: null };
}
const findRow = (t, id) => (isObj(t) && Array.isArray(t.mods) ? t.mods.find(r => isObj(r) && r.id === id) : null) || null;
export function setMod(t, rowId, fields) {
  const r = findRow(t, rowId);
  if (!r) return NO('No such cable');
  const f = {};
  for (const k of ROW_F) if (isObj(fields) && fields[k] !== undefined) f[k] = fields[k];
  // (normRow's rules by proxy: a native source / a Serum destination as they are, anything else as a wheel → cutoff row)
  const D = splitDst(r.dst), d = D && t.dev[D.dev], sx = isObj(d) && d.kind === 'synth' && d.model === 'serum';
  if (!sx) { f.aux = ''; f.inv = 0; } // (C7: no aux on a canvas row)
  const n = nativeRow(Object.assign({}, r, f, sx ? null : { dst: D.dev + ':f.cutoff' }), MOD_SRC[r.src] || 'wheel');
  if (!n) return NO('Unknown aux source');
  for (const k of ROW_F) r[k] = n[k];
  return OK;
}
export function removeMod(t, rowId) {
  const r = findRow(t, rowId);
  if (!r) return NO('No such cable');
  t.mods = t.mods.filter(x => x !== r);
  return OK;
}
export function presetRows(dev) {
  const s = isObj(dev) && dev.model === 'serum' && isObj(dev.vals) ? dev.vals.s : null, M = isObj(s) && Array.isArray(s.matrix) ? s.matrix : [], out = [];
  for (let slot = 0; slot < M.length && slot < N_MATRIX; slot++) {
    const r = M[slot];
    if (isObj(r) && SRC_MOD[r.src] && typeof r.dst === 'string' && r.dst) out.push(Object.assign({ slot, from: SRC_MOD[r.src] }, r));
  }
  return out;
}
const copyM = M => Array.from({ length: N_MATRIX }, (_, k) => (k < M.length ? M[k] : normRow(null)));
export function toPreset(t, rowId, s) {
  const r = findRow(t, rowId), D = r && splitDst(r.dst), d = D && t.dev[D.dev];
  if (!r || !isObj(d) || !isObj(s) || !Array.isArray(s.matrix)) return NO('No such cable');
  const x = injectMods({ vals: { s } }, modRowsFor(t, D.dev)).placed.find(q => q.id === rowId), n = nativeRow(r);
  if (!x || !n) return NO(fullWhy(null, d));
  const matrix = copyM(s.matrix);
  matrix[x.slot] = n;
  t.mods = t.mods.filter(y => y !== r);
  return { ok: true, why: '', slot: x.slot, row: n, matrix };
}
export function fromPreset(t, dev, slot, o = {}) {
  const id = isObj(t) && isObj(t.dev) ? devKey(t, dev) : undefined, d = id !== undefined ? t.dev[id] : null;
  const M = isObj(d) && isObj(d.vals) && isObj(d.vals.s) && Array.isArray(d.vals.s.matrix) ? d.vals.s.matrix : null;
  const r = M && Number.isInteger(slot) && slot >= 0 && slot < Math.min(M.length, N_MATRIX) ? M[slot] : null, src = isObj(r) ? SRC_MOD[r.src] : undefined;
  if (!src || typeof r.dst !== 'string' || !r.dst) return NO('No performance row in that slot');
  if (!srcOk(t, src, o.project)) return NO('Add the ' + MOD_LABEL[r.src] + ' module first');
  const k = destOk(d, r.dst, true); // (a preset row moving to the canvas exists already)
  if (!k.ok) return NO(k.why);
  // where it goes in track.mods: after the canvas rows (of this Serum) that take the free slots before `slot`, so the
  // next compile puts it back into `slot` and every other row keeps its slot (exact while there are that many)
  let j = 0;
  for (let q = 0; q < slot; q++) if (!isObj(M[q]) || M[q].src === '' || M[q].src === undefined) j++;
  const mine = modRowsFor(t, id).filter(x => nativeRow(x)), L = mods(t), row = rowOf(rowId(t), src, id + ':' + r.dst, normRow(r));
  const at = j < mine.length ? L.indexOf(mine[j]) : mine.length ? L.indexOf(mine[mine.length - 1]) + 1 : L.length;
  L.splice(at, 0, row);
  const matrix = copyM(M);
  matrix[slot] = normRow(null);
  return { ok: true, why: '', row, slot, matrix };
}
