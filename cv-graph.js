// cv-graph.js — a track's device graph in SYNTH Canvas (SPEC-canvas §5.1, §5.5, §6.7, §6.8; stages 1a, 1e). Pure ES module:
// no DOM, no engine (node-tested: tests/cv-graph.test.mjs).
//
// A v1 track (today's: model / vals / preset / seq / fx) is one canonical shape by definition. A v2 track (stage 1c on,
// §5.1: dev / wires / mods / prim) is validated and ordered here, and its canonical shapes (§5.5) are presented as a v1
// view that main.js compiles through today's buildPatch / sendPatch path, so the node receives today's message stream:
//   - one powered classic instrument → at most one shared panel → OUT (no panel: today's empty rack);
//   - one powered Serum (its own FX inside it, dev.fx) → OUT;
//   (the sounding instrument over every key, untransposed: a key zone / transpose is a graph shape, 1e review H3).
// Device shapes (stage 1c, cv-migrate toV2): a shared panel holds today's v2 FX state whole, { kind: 'panel', fx } (a
// classic track's rack: its Main rack shows and compiles as before); the §5.1 single-rack form { rack: { mods, byp, lock,
// ui } } is read too (1e). Every other shape (stage 1e: several instruments, fan-in, levels, a Serum into a panel) compiles
// to the graph protocol of §6.8 / IMPL-1e §2.5: one Inst per instrument (render order, the primary first, salt 0), one
// shared chain per panel, edges [src, dst, g] (src an instrument or panel id, dst a panel id or 'out').
//
//   LIMITS                 ≤ 8 instruments, ≤ 16 shared panels, ≤ 48 effects per panel (§6.7, §9.2)
//   kindOf(dev)            'inst' | 'panel' | 'out' | 'mod' | null
//   port('i1.out')         { dev: 'i1', port: 'out' } | null (Serum parts: 'i2/oscA.out', stage 3)
//   isV2(track)
//   powered(track)         the instruments that sound: on, and soloed when any instrument of the track is (§2.7)
//   validate(track)        { ok, errors: [{ code, msg, at }] } — codes: out (not exactly one OUT), end (unknown device or
//                          port), dir (not an out → in cable), dup, own-fx (into an instrument: a Serum's own FX take only
//                          that Serum), cycle, fan-out / chain (one output into several inputs, panel → panel: stage 4;
//                          fan-in — several outputs into one input — is allowed), g (a level not a finite number ≥ 0),
//                          zone (lo / hi ints 0…127, lo ≤ hi, xp an int −48…48), flag (on / solo not booleans), inst /
//                          panels / fx (limits), prim (not an instrument), nomod (a mod row to a knob that cannot be
//                          modulated: classic struct / none, cv-mods.js)
//   order(track)           device ids, sources before what they feed (stable: dev key order), or null on a cycle
//   compileTrack(track)    { canonical: true, shape: 'classic' | 'serum', inst, v1: { model, vals, preset, seq, fx } } |
//                          { canonical: false, why, errors, graph, patches, chains, order, powered } (why: several |
//                          none | shape | invalid; an invalid track still compiles the cables that are usable)
//   compileGraph(track)    the graph form of any track (a canonical one too: graphed nodes, IMPL-1e §3.3) →
//                          { canonical, why, errors, graph, patches, chains, order, powered }:
//                            graph   { insts: [{ id, on, zone: { lo, hi, xp }, salt }], chains: [{ id }], edges: [[a, b, g]],
//                                      out: 'out', key } — insts primary first then in order, chains in order, every
//                                      usable cable with its level (unpowered instruments' too: they do not sound); key: the
//                                      structure as a string (change detection: ids, order, edges, on, zones, salts)
//                            patches { id: { model, vals, preset, seq, fx } } (fx: a Serum's own; undefined: a classic)
//                            chains  { id: FX state } (a panel's state, or its single rack as a Main rack: fxOfPanel)
//   saltOf(id, prim)       an Inst's seed salt: 0 for the primary, else (devNum(id) * 0x9E3779B9) >>> 0 (§6.2.1)
//   zoneOf(dev)            { lo, hi, xp } (absent: 0…127, 0)          devNum('fx12') → 12
//   instPatch(dev, opts, rows)  one Inst's patch ({t: 'patch', i, p}): patchFor of the instrument with its own FX (a Serum)
//                          or an empty rack, a classic one without fxr / fxrT (its sound goes to the shared chains); a
//                          Serum with its track's mod rows (modRowsFor) injected (stage 2a)
// Stage 2a (IMPL-2a §2.1, SPEC §7.7 items 1–2, D11): the canvas mod cables of a track (track.mods rows, cv-mods.js) compile
// into each Serum's own matrix at compile time — vals.s is never mutated, so a preset load keeps every cable:
//   modRowsFor(track, devId)  the rows whose dst names device devId ('<devId>:<param>'), in track.mods order
//   nativeRow(row)            the Serum row a canvas row compiles to (src wheel / velo / at / bend, dst the param id, the
//                             other fields through serum-core normRow), or null (an unknown source, a refused field)
//   injectMods(dev, rows)     { s, placed: [{ id, slot }], left: [ids] }: no rows (or none placed) → dev.vals.s itself (the
//                             compile is byte-identical); else a shallow copy of s whose matrix (a copied 64-slot array)
//                             holds each row, in order, in the first free slot (src '': serum-core freeSlot's rule) — so
//                             buildSerumT keys its custom curve 'crv<slot>' and mSlot / slew / mOut work per slot as
//                             today. left: the rows that found no free slot (not compiled: "mod rows are full (64/64)")
//   modBudget(track, dev)     { preset, canvas, left, max: 64 }: the slots the Serum's own rows hold, the canvas rows
//                             placed, the ids left out (dev: a device id or object) — "23/64" = preset + canvas
//   chainPatch(fx, opts)   one shared chain ({t: 'chain', c, fxr, fxrT}): patchFor's rack compile for a classic track (no
//                          Serum gains), so a canonical classic track's chain is its legacy patch's rack
import { classOf, MOD_SRC } from './cv-mods.js?v=9';
import { defaultFx2, compileFx, compileFxT, normRow, N_MATRIX } from './serum-core.js?v=9';
import { patchFor } from './models.js?v=9';

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
const isInt = (x, a, b) => Number.isInteger(x) && x >= a && x <= b;
const zoneOk = z => isObj(z) && isInt(z.lo, 0, 127) && isInt(z.hi, 0, 127) && z.lo <= z.hi && (z.xp === undefined || isInt(z.xp, -48, 48));
const gOk = g => typeof g === 'number' && Number.isFinite(g) && g >= 0;
export function zoneOf(d) {
  const z = isObj(d) && isObj(d.zone) ? d.zone : null, n = (x, a, b, def) => (Number.isFinite(x) ? Math.min(b, Math.max(a, Math.round(x))) : def);
  if (!z) return { lo: 0, hi: 127, xp: 0 };
  const lo = n(z.lo, 0, 127, 0), hi = n(z.hi, 0, 127, 127);
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi), xp: n(z.xp, -48, 48, 0) };
}
export const devNum = id => { const m = /(\d+)$/.exec(id); return m ? +m[1] : 0; };
export const saltOf = (id, prim) => (id === prim ? 0 : (devNum(id) * 0x9E3779B9) >>> 0);

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
  for (const id of ins) {
    const d = dev[id];
    if ((d.on !== undefined && typeof d.on !== 'boolean') || (d.solo !== undefined && typeof d.solo !== 'boolean')) err('flag', 'Power and solo are on or off', id);
    if (d.zone !== undefined && !zoneOk(d.zone)) err('zone', 'A key zone is two notes 0…127 (low ≤ high) and a transpose −48…48', id);
  }
  const seen = new Set(), from = new Map();
  for (const w of wiresOf(t)) {
    const a = port(w.a), b = port(w.b), at = w.id || null;
    if (!a || !b || !(a.dev in dev) || !(b.dev in dev)) { err('end', 'A cable ends on nothing', at); continue; }
    if (w.g !== undefined && !gOk(w.g)) err('g', 'A cable level is a number ≥ 0', at);
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
    // (fan-in, several outputs into one input, is a mix: allowed from stage 1e)
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
  const no = why => Object.assign({ canonical: false, why, errors: v.errors }, graphOf(t, ord, on));
  if (!v.ok) return no('invalid');
  if (on.length !== 1) return no(on.length ? 'several' : 'none');
  const id = on[0], d = t.dev[id], out = Object.keys(t.dev).find(k => kindOf(t.dev[k]) === 'out'), z = zoneOf(d);
  if (z.lo !== 0 || z.hi !== 127 || z.xp !== 0) return no('shape'); // (a key zone / transpose: the graph's Inst carries it)
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

/* ------------------------------------------------------------- the graph form (stage 1e, IMPL-1e §2.5, §3.1) */
// the cables the engine can play: out → in, an instrument or panel into a panel or OUT, one per output (the first), no
// panel → panel (a later stage) — what validate refuses is left out, so an invalid track still compiles (cycle-free:
// instruments have no input, OUT no output, panels feed no panel)
function edgesOf(t) {
  const dev = t.dev, E = [], from = new Set();
  for (const w of wiresOf(t)) {
    const a = port(w.a), b = port(w.b);
    if (!a || !b || !(a.dev in dev) || !(b.dev in dev) || a.port !== 'out' || b.port !== 'in' || from.has(a.dev)) continue;
    const ka = kindOf(dev[a.dev]), kb = kindOf(dev[b.dev]);
    if ((ka !== 'inst' && ka !== 'panel') || (kb !== 'panel' && kb !== 'out') || (ka === 'panel' && kb === 'panel')) continue;
    from.add(a.dev);
    E.push([a.dev, kb === 'out' ? 'out' : b.dev, gOk(w.g) ? w.g : 1]);
  }
  return E;
}
function graphOf(t, ord, on) {
  const dev = t.dev, ids = ord || Object.keys(dev), ins = ids.filter(id => kindOf(dev[id]) === 'inst');
  const prim = kindOf(dev[t.prim]) === 'inst' ? t.prim : ins[0];
  const order1 = prim ? [prim, ...ins.filter(id => id !== prim)] : [], panels = ids.filter(id => kindOf(dev[id]) === 'panel');
  const graph = {
    insts: order1.map(id => ({ id, on: on.includes(id), zone: zoneOf(dev[id]), salt: saltOf(id, prim) })),
    chains: panels.map(id => ({ id })), edges: edgesOf(t), out: 'out', key: '',
  };
  graph.key = JSON.stringify([graph.insts, graph.chains, graph.edges]);
  const patches = {}, chains = {};
  for (const id of order1) { const d = dev[id]; patches[id] = { model: d.model, vals: d.vals, preset: d.preset, seq: d.seq, fx: d.model === 'serum' ? d.fx : undefined }; }
  for (const id of panels) chains[id] = fxOfPanel(dev[id]);
  return { graph, patches, chains, order: ord, powered: on };
}
// a v1 track as the devices stage 1c gives it (i1 → fx1 → out; a Serum i1 → out), its objects shared
function v2View(t) {
  const i1 = { kind: 'synth', model: t.model, vals: t.vals, preset: t.preset, seq: t.seq };
  if (t.model === 'serum') return { prim: 'i1', dev: { i1: Object.assign(i1, { fx: t.fx }), out: { kind: 'out' } }, wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }] };
  return { prim: 'i1', dev: { i1, fx1: { kind: 'panel', fx: t.fx }, out: { kind: 'out' } }, wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in' }, { id: 'w2', a: 'fx1.out', b: 'out.in' }] };
}
export function compileGraph(t) {
  if (!isObj(t)) throw new Error('compileGraph: not a track');
  const T = isV2(t) ? t : v2View(t), c = compileTrack(T);
  if (!c.canonical) return c;
  return Object.assign({ canonical: true, why: null, errors: [] }, graphOf(T, order(T), powered(T)));
}
// the patch of one Inst (a classic one: no rack of its own on a graph node, IMPL-1e §2.1 sharedRack); a Serum's mod rows
// injected: { s: merged } reaches both compileSerum and fxModded2 (patchFor)
export function instPatch(d, opts, rows) {
  const sx = d.model === 'serum', inj = sx && Array.isArray(rows) && rows.length ? injectMods(d, rows) : null;
  const vals = inj && inj.s !== d.vals.s ? Object.assign({}, d.vals, { s: inj.s }) : d.vals;
  const p = patchFor(d.model, vals, sx && d.fx ? d.fx : defaultFx2(), opts);
  if (!sx) {
    const fn = p.fxr && Array.isArray(p.fxr.needs) ? p.fxr.needs : [];
    delete p.fxr; delete p.fxrT;
    if (fn.length && p.needs) { p.needs = p.needs.filter(x => !fn.includes(x)); if (!p.needs.length) delete p.needs; }
  }
  return p;
}
// one shared chain's rack: patchFor's compileFx call for a classic model (no Serum master / bypass / bus levels)
export function chainPatch(fx, opts) {
  const o = opts || {}, pr = o.prefs || {}, sr = o.sr > 0 ? +o.sr : 48000, bpm = o.bpm > 0 ? +o.bpm : 120, smooth = pr.smooth > 0 ? +pr.smooth : 1;
  const fxr = compileFx(fx, {
    bpm, rate: sr, master: undefined, bypass: undefined, direct: undefined, bus1v: undefined, bus2v: undefined, modded: null,
    seed: !!o.seed, smooth, silence: pr.silenceTails === undefined ? 1 : pr.silenceTails ? 1 : 0, qr: o.qr || null,
  });
  return { fxr, fxrT: compileFxT(fx) };
}

/* ------------------------------------------------------------- mod rows into a Serum's matrix (stage 2a, IMPL-2a §2.1) */
export function modRowsFor(t, devId) {
  const pre = devId + ':';
  return isObj(t) && Array.isArray(t.mods) ? t.mods.filter(r => isObj(r) && typeof r.dst === 'string' && r.dst.length > pre.length && r.dst.startsWith(pre)) : [];
}
export function nativeRow(r) {
  const src = isObj(r) && typeof r.src === 'string' ? MOD_SRC[r.src] : undefined, i = src && typeof r.dst === 'string' ? r.dst.indexOf(':') : -1;
  if (i < 1) return null;
  const n = normRow(Object.assign({}, r, { src, dst: r.dst.slice(i + 1) }));
  return n.src && n.dst ? n : null; // (normRow empties a row with an unknown aux / destination)
}
const isFree = r => !isObj(r) || r.src === '' || r.src === undefined;
// the slots rows take in s: its free slots in order, one per valid row in order (invalid rows: neither placed nor left)
function place(s, rows) {
  const M = isObj(s) && Array.isArray(s.matrix) ? s.matrix : [], free = [], placed = [], left = [], N = [];
  for (let k = 0; k < N_MATRIX; k++) if (isFree(M[k])) free.push(k);
  for (const r of rows) {
    const n = nativeRow(r);
    if (!n) continue;
    if (placed.length < free.length) { placed.push({ id: r.id, slot: free[placed.length] }); N.push(n); } else left.push(r.id);
  }
  return { placed, left, N, used: N_MATRIX - free.length };
}
export function injectMods(dev, rows) {
  const s = isObj(dev) && isObj(dev.vals) ? dev.vals.s : undefined;
  if (!Array.isArray(rows) || !rows.length || !isObj(s)) return { s, placed: [], left: [] };
  const P = place(s, rows);
  if (!P.placed.length) return { s, placed: [], left: P.left };
  const M = Array.isArray(s.matrix) ? s.matrix : [], m = Array.from({ length: N_MATRIX }, (_, k) => (k < M.length ? M[k] : normRow(null)));
  P.placed.forEach((x, i) => { m[x.slot] = P.N[i]; });
  return { s: Object.assign({}, s, { matrix: m }), placed: P.placed, left: P.left };
}
export function modBudget(t, dev) {
  const D = isObj(t) && isObj(t.dev) ? t.dev : {}, id = typeof dev === 'string' ? dev : Object.keys(D).find(k => D[k] === dev);
  const d = id !== undefined ? D[id] : null, P = place(isObj(d) && isObj(d.vals) ? d.vals.s : null, id !== undefined ? modRowsFor(t, id) : []);
  return { preset: P.used, canvas: P.placed.length, left: P.left, max: N_MATRIX };
}
