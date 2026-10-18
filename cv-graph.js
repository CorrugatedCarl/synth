// cv-graph.js — a track's device graph in SYNTH Canvas (SPEC-canvas §5.1, §5.5, §6.7; stage 1a skeleton). Pure ES module:
// no DOM, no engine (node-tested: tests/cv-graph.test.mjs).
//
// A v1 track (today's: model / vals / preset / seq / fx) is one canonical shape by definition. A v2 track (stage 1c on,
// §5.1: dev / wires / mods / prim) is validated and ordered here, and its canonical shapes (§5.5) are presented as a v1
// view that main.js compiles through today's buildPatch / sendPatch path, so the node receives today's message stream:
//   - one powered classic instrument → at most one shared panel → OUT (no panel: today's empty rack);
//   - one powered Serum (its own FX inside it, dev.fx) → OUT.
// Device shapes (stage 1c, cv-migrate toV2): a shared panel holds today's v2 FX state whole, { kind: 'panel', fx } (a
// classic track's rack: its Main rack shows and compiles as before); the §5.1 single-rack form { rack: { mods, byp, lock,
// ui } } is read too (1e). Other shapes compile to the graph protocol of §6.8 from stage 1e; until then compileTrack
// reports them as not canonical (main.js then compiles the primary alone).
//
//   LIMITS                 ≤ 8 instruments, ≤ 16 shared panels, ≤ 48 effects per panel (§6.7, §9.2)
//   kindOf(dev)            'inst' | 'panel' | 'out' | 'mod' | null
//   port('i1.out')         { dev: 'i1', port: 'out' } | null (Serum parts: 'i2/oscA.out', stage 3)
//   isV2(track)
//   powered(track)         the instruments that sound: on, and soloed when any instrument of the track is (§2.7)
//   validate(track)        { ok, errors: [{ code, msg, at }] } — codes: out (not exactly one OUT), end (unknown device or
//                          port), dir (not an out → in cable), dup, own-fx (into an instrument: a Serum's own FX take only
//                          that Serum), cycle, fan-out / chain (one output into several inputs, panel → panel: stage 4),
//                          inst / panels / fx (limits), prim (not an instrument), nomod (a mod row to a knob that cannot
//                          be modulated: classic struct / none, cv-mods.js)
//   order(track)           device ids, sources before what they feed (stable: dev key order), or null on a cycle
//   compileTrack(track)    { canonical: true, shape: 'classic' | 'serum', inst, v1: { model, vals, preset, seq, fx } } |
//                          { canonical: false, why, errors, order, powered }
import { classOf } from './cv-mods.js?v=9';
import { defaultFx2 } from './serum-core.js?v=9';

export const LIMITS = Object.freeze({ inst: 8, panels: 16, fxPerPanel: 48 });
const MOD_KINDS = new Set(['lfo', 'env', 'velo', 'at', 'bend', 'note', 'macro', 'cc']);
const PORTS = { inst: ['out'], panel: ['in', 'out'], out: ['in'] };
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);

export function kindOf(d) {
  if (!isObj(d)) return null;
  return d.kind === 'synth' ? 'inst' : d.kind === 'panel' ? 'panel' : d.kind === 'out' ? 'out' : MOD_KINDS.has(d.kind) ? 'mod' : null;
}
export function port(s) {
  const m = typeof s === 'string' ? /^([A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)?)\.([a-z0-9]+)$/.exec(s) : null;
  return m ? { dev: m[1], port: m[2] } : null;
}
export const isV2 = t => isObj(t) && isObj(t.dev);
// the effects of a rack, splitter branches included
export function effectCount(rack) {
  let n = 0;
  const walk = L => { for (const I of Array.isArray(L) ? L : []) if (isObj(I)) { n++; if (Array.isArray(I.br)) for (const b of I.br) walk(b); } };
  walk(isObj(rack) ? rack.mods : null);
  return n;
}
export function powered(t) {
  if (!isV2(t)) return [];
  const ins = Object.keys(t.dev).filter(id => kindOf(t.dev[id]) === 'inst' && t.dev[id].on !== false);
  return ins.some(id => t.dev[id].solo) ? ins.filter(id => t.dev[id].solo) : ins;
}
const wiresOf = t => (Array.isArray(t.wires) ? t.wires.filter(isObj) : []);

export function order(t) {
  if (!isV2(t)) return null;
  const ids = Object.keys(t.dev), indeg = new Map(ids.map(id => [id, 0])), next = new Map(ids.map(id => [id, []]));
  for (const w of wiresOf(t)) {
    const a = port(w.a), b = port(w.b);
    if (!a || !b || !indeg.has(a.dev) || !indeg.has(b.dev) || a.dev === b.dev && a.port === b.port) continue;
    if (a.dev === b.dev) return null; // a device into itself
    next.get(a.dev).push(b.dev); indeg.set(b.dev, indeg.get(b.dev) + 1);
  }
  const out = [], ready = ids.filter(id => indeg.get(id) === 0);
  while (ready.length) {
    const id = ready.shift();
    out.push(id);
    for (const n of next.get(id)) { indeg.set(n, indeg.get(n) - 1); if (indeg.get(n) === 0) ready.push(n); }
  }
  return out.length === ids.length ? out : null;
}

export function validate(t) {
  const errors = [], err = (code, msg, at) => errors.push({ code, msg, at: at === undefined ? null : at });
  if (!isV2(t)) return { ok: true, errors }; // a v1 track: today's shape
  const dev = t.dev, ids = Object.keys(dev), K = id => kindOf(dev[id]);
  const outs = ids.filter(id => K(id) === 'out');
  if (outs.length !== 1) err('out', outs.length ? 'A track has exactly one OUT' : 'This track has no OUT');
  const ins = ids.filter(id => K(id) === 'inst'), panels = ids.filter(id => K(id) === 'panel');
  if (ins.length > LIMITS.inst) err('inst', `At most ${LIMITS.inst} instruments per track`);
  if (panels.length > LIMITS.panels) err('panels', `At most ${LIMITS.panels} FX panels per track`);
  for (const id of panels) if (effectCount(rackOf(dev[id])) > LIMITS.fxPerPanel) err('fx', `At most ${LIMITS.fxPerPanel} effects per panel`, id);
  if (t.prim != null && K(t.prim) !== 'inst') err('prim', 'The primary instrument is not an instrument of this track', t.prim);
  const seen = new Set(), from = new Map();
  for (const w of wiresOf(t)) {
    const a = port(w.a), b = port(w.b), at = w.id || null;
    if (!a || !b || !(a.dev in dev) || !(b.dev in dev)) { err('end', 'A cable ends on nothing', at); continue; }
    const ka = K(a.dev), kb = K(b.dev);
    if (kb === 'inst') {
      if (dev[b.dev].model === 'serum') err('own-fx', 'A Serum’s own FX take only that Serum · Make a shared panel', at);
      else err('end', 'An instrument has no audio input', at);
      continue;
    }
    if (!PORTS[ka] || !PORTS[kb] || !PORTS[ka].includes(a.port) || !PORTS[kb].includes(b.port)) { err('end', 'No such jack', at); continue; }
    if (a.port !== 'out' || b.port !== 'in') { err('dir', 'A cable goes from an output to an input', at); continue; }
    const key = w.a + '>' + w.b;
    if (seen.has(key)) { err('dup', 'These two jacks are already connected', at); continue; }
    seen.add(key);
    if (from.has(a.dev)) err('fan-out', 'One output feeds one input (several: a later stage)', at); else from.set(a.dev, b.dev);
    if (ka === 'panel' && kb === 'panel') err('chain', 'Panel → panel chains come in a later stage', at);
  }
  if (!order(t)) err('cycle', 'That would make a loop');
  for (const r of Array.isArray(t.mods) ? t.mods.filter(isObj) : []) {
    const i = typeof r.dst === 'string' ? r.dst.indexOf(':') : -1, d = i > 0 ? dev[r.dst.slice(0, i)] : null;
    if (!d) { err('end', 'A modulation cable ends on nothing', r.id); continue; }
    if (K(r.dst.slice(0, i)) === 'inst' && d.model !== 'serum') {
      const c = classOf(d.model, r.dst.slice(i + 1));
      if (c === 'struct' || c === 'none') err('nomod', 'This knob can’t be modulated', r.id);
    }
  }
  return { ok: !errors.length, errors };
}

// the effects of a panel as one list (its FX state's racks, or the single-rack form)
const rackOf = p => (isObj(p.fx) && Array.isArray(p.fx.racks) ? { mods: p.fx.racks.flatMap(r => (isObj(r) && Array.isArray(r.mods) ? r.mods : [])) } : p.rack);
// a shared panel as the v1 FX state of a classic track: the FX state it holds (the same object: edits and the compile
// see one state), or its single rack as the Main rack (the bus racks empty, as on a classic track)
function fxOfPanel(p) {
  if (p && isObj(p.fx)) return p.fx;
  const fx = defaultFx2(), r = p && isObj(p.rack) ? p.rack : null;
  if (r) {
    fx.racks[0] = Object.assign(fx.racks[0], { mods: Array.isArray(r.mods) ? r.mods : [], byp: r.byp || 0, lock: r.lock || 0 });
    if (isObj(r.ui)) fx.ui = r.ui;
  }
  return fx;
}
const unity = w => w.g === undefined || w.g === 1;

export function compileTrack(t) {
  if (!isObj(t)) throw new Error('compileTrack: not a track');
  if (!isV2(t)) {
    return { canonical: true, shape: t.model === 'serum' ? 'serum' : 'classic', inst: null,
      v1: { model: t.model, vals: t.vals, preset: t.preset, seq: t.seq, fx: t.fx } };
  }
  const v = validate(t), ord = order(t), on = powered(t);
  const no = why => ({ canonical: false, why, errors: v.errors, order: ord, powered: on });
  if (!v.ok) return no('invalid');
  if (on.length !== 1) return no(on.length ? 'several' : 'none');
  const id = on[0], d = t.dev[id], out = Object.keys(t.dev).find(k => kindOf(t.dev[k]) === 'out');
  const W = wiresOf(t), into = k => W.filter(w => { const b = port(w.b); return b && b.dev === k; });
  const sounding = k => { const a = port(k.a); return a && (kindOf(t.dev[a.dev]) !== 'inst' || on.includes(a.dev)); };
  const last = into(out).filter(sounding);
  if (last.length !== 1 || !unity(last[0])) return no('shape');
  const src = port(last[0].a).dev;
  const v1 = { model: d.model, vals: d.vals, preset: d.preset, seq: d.seq };
  if (d.model === 'serum') { // Serum → its own FX (inside the device) → OUT
    if (src !== id) return no('shape');
    return { canonical: true, shape: 'serum', inst: id, v1: Object.assign(v1, { fx: d.fx }) };
  }
  if (src === id) return { canonical: true, shape: 'classic', inst: id, v1: Object.assign(v1, { fx: fxOfPanel(null) }) };
  if (kindOf(t.dev[src]) !== 'panel') return no('shape');
  const feed = into(src).filter(sounding);
  if (feed.length !== 1 || port(feed[0].a).dev !== id || !unity(feed[0])) return no('shape');
  return { canonical: true, shape: 'classic', inst: id, v1: Object.assign(v1, { fx: fxOfPanel(t.dev[src]) }) };
}
