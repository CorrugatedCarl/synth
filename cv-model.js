// cv-model.js — the in-memory v2 track of SYNTH Canvas and its editing API (SPEC-canvas §5.1, §5.4, §6.6, §6.7; stages
// 1c, 1e). Pure ES module: no DOM, no storage (node-tested: tests/cv-migrate.test.mjs).
//
// adopt(project) is the ONE point every track passes on its way into the project: main.js loadProject, freshProject,
// applyRestore (undo / redo / New / Open / MIDI import), addTrack, duplicateTrack. A v1 track (model / vals / preset / seq /
// fx as own fields: song.js newTrack, an old record) is converted in place (cv-migrate trackToV2: the same object, so
// references held elsewhere stay good); every track then gets the transition accessors (§5.4, stages 1c–1e):
//   track.model, vals, preset, seq   → dev[prim].<same>
//   track.fx                         → a Serum primary's own FX (dev[prim].fx), else the panel the primary feeds (its fx)
// They are non-enumerable, so JSON (autosave, History snapshots, files) carries only the v2 form, and the ~120 main.js
// sites that read t.model / t.vals / fxOf(t) keep working until they move to instOf(t, id) (the accessors go in 2a).
// Assigning track.model across classic ↔ Serum reshapes the graph by the kept-FX rules of setModel (§2.5: a track's rack
// is kept when its model changes; on a canonical track exactly stage 1c's reshape).
//   adopt(p) → p   isAdopted(t)   instOf(t, id = prim)   primId(t)   fxDevOf(t) → { id, dev, own } | null
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
//        an empty own rack (`fx` when given). Serum → classic: its own FX become a new panel between it and what it fed;
//        when it fed a shared panel (panel → panel: stage 4) it keeps feeding that panel and its own FX, when they hold any
//        effect, are kept as an unconnected panel
//   sharedPanelFix(t, serumId, srcId) → panelId   "Make a shared panel" (the own-fx refusal): a panel after the Serum,
//        Serum and srcId into it, the panel into what the Serum fed (a Serum already feeding a panel: srcId joins it)
//   instIds(t) → [ids] (primary first)   isGraphShape(t) (not canonical)   destOf(t, id) → the device id it feeds | null
import { trackToV2, panelOf, V1_KEYS } from './cv-migrate.js?v=9';
import { validate, compileTrack, kindOf, port, devNum, zoneOf, LIMITS } from './cv-graph.js?v=9';
import { defaultFx2 } from './serum-core.js?v=9';

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
const dropLay = (t, id) => { if (isObj(t.lay)) { delete t.lay[id]; delete t.lay[id + '/fx']; } };
// classic ↔ Serum: the FX state moves with the instrument's kind (setModel's kept-FX rules)
function reshape(t, id, toSerum) {
  const d = t.dev[id], out = outId(t) || (t.dev.out = { kind: 'out' }, 'out'), w = outWire(t, id), dst = w && port(w.b);
  const pid = dst && kindOf(t.dev[dst.dev]) === 'panel' ? dst.dev : null;
  if (toSerum) {
    if (!pid) { if (!w) wire(t, id + '.out', out + '.in'); return 'none'; } // (straight into OUT, or silent: nothing to move)
    const pw = outWire(t, pid);
    if (inWires(t, pid).length === 1 && pw && pw.b === out + '.in') { // its own panel: the state comes inside the Serum
      if (t.dev[pid].fx !== undefined) d.fx = t.dev[pid].fx;
      delete t.dev[pid]; // (its layout entry stays: the view puts the Serum FX where the panel was, cv-module layOf)
      t.wires = t.wires.filter(x => !touches(x, pid) && x !== w);
      wire(t, id + '.out', out + '.in', pw.g);
      return 'moved';
    }
    if (d.fx === undefined) d.fx = defaultFx2(); // a shared panel: the Serum keeps feeding it, its own rack empty
    return 'kept';
  }
  const fx = d.fx;
  delete d.fx;
  if (pid) { // fed a shared panel: still does (panel → panel is stage 4); its own effects kept as a panel of their own
    if (hasFx(fx)) t.dev[nextId(t, 'fx')] = { kind: 'panel', fx };
    return 'kept';
  }
  const np = 'fx1' in t.dev ? nextId(t, 'fx') : 'fx1', P = { kind: 'panel' };
  if (fx !== undefined) P.fx = fx;
  t.dev[np] = P;
  t.wires = t.wires.filter(x => x !== w);
  wire(t, id + '.out', np + '.in');
  if (w) wire(t, np + '.out', w.b, w.g);
  return 'moved';
}
const prim = t => {
  const d = instOf(t);
  if (!d) throw new Error('cv-model: a track without an instrument');
  return d;
};
const ACC = {
  model: {
    get() { return prim(this).model; },
    set(v) {
      const d = prim(this), was = d.model;
      if (v === was) return;
      d.model = v;
      if ((v === 'serum') !== (was === 'serum')) reshape(this, primId(this), v === 'serum');
    },
  },
  vals: { get() { return prim(this).vals; }, set(v) { prim(this).vals = v; } },
  preset: { get() { return prim(this).preset; }, set(v) { prim(this).preset = v; } },
  seq: { get() { return prim(this).seq; }, set(v) { const d = prim(this); if (v === undefined) delete d.seq; else d.seq = v; } },
  fx: {
    get() { const f = fxDevOf(this); return f ? f.dev.fx : undefined; },
    set(v) {
      let f = fxDevOf(this);
      if (!f) { reshape(this, primId(this), false); f = fxDevOf(this); } // (a classic primary straight into OUT: a panel for it)
      if (v === undefined) delete f.dev.fx; else f.dev.fx = v;
    },
  },
};
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
export function adopt(p) {
  if (!isObj(p) || !Array.isArray(p.tracks)) return p;
  for (const t of p.tracks) {
    if (!isObj(t) || done.has(t)) continue;
    if (!isObj(t.dev)) { // a v1 track: the same object becomes its v2 form (key order: the v2 fields last)
      const v2 = trackToV2(t);
      for (const k of V1_KEYS) delete t[k];
      for (const k of ['prim', 'nid', 'dev', 'wires']) { delete t[k]; t[k] = v2[k]; }
    } else for (const k of V1_KEYS) if (Object.prototype.hasOwnProperty.call(t, k)) delete t[k]; // (a mirror: the devices win)
    repair(t);
    for (const k of V1_KEYS) Object.defineProperty(t, k, { get: ACC[k].get, set: ACC[k].set, enumerable: false, configurable: true });
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
  if (Array.isArray(t.mods)) t.mods = t.mods.filter(r => !(isObj(r) && [r.src, r.dst].some(x => typeof x === 'string' && x.split(/[.:]/)[0] === id)));
  dropLay(t, id);
  if (t.prim === id) t.prim = synths(t).sort(byNum)[0];
  return OK;
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
  dropLay(t, id);
  return OK;
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
  return OK;
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
