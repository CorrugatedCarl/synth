// cv-model.js — the in-memory v2 track of SYNTH Canvas (SPEC-canvas §5.1, §5.4; stage 1c). Pure ES module: no DOM, no
// storage (node-tested: tests/cv-migrate.test.mjs).
//
// adopt(project) is the ONE point every track passes on its way into the project: main.js loadProject, freshProject,
// applyRestore (undo / redo / New / Open / MIDI import), addTrack, duplicateTrack. A v1 track (model / vals / preset / seq /
// fx as own fields: song.js newTrack, an old record) is converted in place (cv-migrate trackToV2: the same object, so
// references held elsewhere stay good); every track then gets the transition accessors (§5.4, stages 1c–1e):
//   track.model, vals, preset, seq   → dev[prim].<same>
//   track.fx                         → a Serum primary's own FX (dev[prim].fx), else the panel the primary feeds (its fx)
// They are non-enumerable, so JSON (autosave, History snapshots, files) carries only the v2 form, and the ~120 main.js
// sites that read t.model / t.vals / fxOf(t) keep working until they move to instOf(t, id) (the accessors go at the end of
// 1e). Assigning track.model across classic ↔ Serum reshapes the canonical graph and keeps the FX state, as today (§2.5:
// a track's rack is kept when its model changes): classic → Serum moves the panel's state into the Serum (its own FX) and
// wires i1 → out; Serum → classic moves it back into a panel (fx1) between them.
//   adopt(p) → p   isAdopted(t)   instOf(t, id = prim)   primId(t)   fxDevOf(t) → { id, dev, own } | null
import { trackToV2, panelOf, V1_KEYS } from './cv-migrate.js?v=9';

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
const devNum = id => { const m = /(\d+)$/.exec(id); return m ? +m[1] : 0; };
function nextId(t, pre) { // a fresh device id (track.nid: never reused)
  let n = Math.max(t.nid | 0, 1, ...Object.keys(t.dev).map(devNum).map(x => x + 1));
  while ((pre + n) in t.dev) n++;
  t.nid = n + 1;
  return pre + n;
}
function wireId(t) { let n = 1; const ids = new Set(t.wires.map(w => isObj(w) && w.id)); while (ids.has('w' + n)) n++; return 'w' + n; }
const touches = (w, id) => isObj(w) && ((typeof w.a === 'string' && w.a.split('.')[0] === id) || (typeof w.b === 'string' && w.b.split('.')[0] === id));
// classic ↔ Serum: the FX state moves with the instrument's kind (canonical shapes only: 1c–1e)
function reshape(t, id, toSerum) {
  const d = t.dev[id], out = outId(t) || (t.dev.out = { kind: 'out' }, 'out');
  if (toSerum) {
    const pid = panelOf(t, id);
    if (pid) { if (t.dev[pid].fx !== undefined) d.fx = t.dev[pid].fx; delete t.dev[pid]; t.wires = t.wires.filter(w => !touches(w, pid)); }
    t.wires = t.wires.filter(w => !(isObj(w) && typeof w.a === 'string' && w.a === id + '.out'));
    t.wires.push({ id: wireId(t), a: id + '.out', b: out + '.in' });
    return;
  }
  const fx = d.fx;
  delete d.fx;
  const pid = 'fx1' in t.dev ? nextId(t, 'fx') : 'fx1', P = { kind: 'panel' };
  if (fx !== undefined) P.fx = fx;
  t.dev[pid] = P;
  t.wires = t.wires.filter(w => !(isObj(w) && w.a === id + '.out'));
  t.wires.push({ id: wireId(t), a: id + '.out', b: pid + '.in' });
  t.wires.push({ id: wireId(t), a: pid + '.out', b: out + '.in' });
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
