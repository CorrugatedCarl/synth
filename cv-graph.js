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
//   instPatch(dev, opts, rows, ext, track)  one Inst's patch ({t: 'patch', i, p}): patchFor of the instrument with its own
//                          FX (a Serum) or an empty rack, a classic one without fxr / fxrT (its sound goes to the shared
//                          chains); a Serum with its track's mod rows (modRowsFor) injected (2a; 2b: ext and slot rows
//                          with the track's compileMods ext list and the track — opts.ext set for patchFor only then)
//   chainPatch(fx, opts)   one shared chain ({t: 'chain', c, fxr, fxrT}): patchFor's rack compile for a classic track (no
//                          Serum gains), so a canonical classic track's chain is its legacy patch's rack (2b: unchanged —
//                          a cabled chain takes its vector from ModCore at run time, IMPL-2b §4)
// Stage 2a (IMPL-2a §2.1, SPEC §7.7 items 1–2, D11): the canvas mod cables of a track (track.mods rows, cv-mods.js) compile
// into each Serum's own matrix at compile time — vals.s is never mutated, so a preset load keeps every cable:
//   modRowsFor(track, devId)  the rows whose dst names device devId ('<devId>:<param>'), in track.mods order
//   nativeRow(row, src)       the Serum row a canvas row compiles to (src wheel / velo / at / bend / note, dst the param id,
//                             the other fields through serum-core normRow), or null (an unknown source, a refused field);
//                             src: the Serum source id to write instead (2b: 'lfo3', 'ext2' — an ext id passes normRow's
//                             source check by proxy)
//   injectMods(dev, rows, ext, track)  { s, placed: [{ id, slot, src }], left: [ids], why: { id: reason }, dashed: [ids],
//                             inj: [{ id, kind, k }] }: no rows (or none placed) → dev.vals.s itself (the compile is
//                             byte-identical); else a shallow copy of s whose matrix (a copied 64-slot array) holds each
//                             row, in order, in the first free slot (src '': serum-core freeSlot's rule) — so buildSerumT
//                             keys its custom curve 'crv<slot>' and mSlot / slew / mOut work per slot as today. left: the
//                             rows that found no free slot (not compiled: "mod rows are full (64/64)") or, 2b, no ext slot
//                             (why 'full' / 'ext' / 'slots'). A row keeps the slot it last took while that slot is free
//                             (per device: its vals object, which undo / redo and preset loads keep; review H5) — removing
//                             an earlier row or a native row in another's slot moves no other row (per-slot slew / mOut
//                             state stays put). 2b (IMPL-2b §3.1 / §3.3): ext = the track's ext list (compileMods'
//                             payload.ext: [{ k, src, id }], id the canvas source) and track its devices — a row from a
//                             GLOBAL ModCore source becomes { src: 'ext<k>' }; a row from a PER NOTE source (a PER NOTE
//                             LFO, an ENV, a linked POLY Serum LFO / ENV of another Serum) is injected into a free LFO /
//                             ENV slot of the copy (s.lfo[k] / s.env[k] and the slot's p knobs receive the module's
//                             state, the row reads 'lfo<k>' / 'env<k>'; a slot is free while it is the default state and
//                             no row of the Serum reads it; the slot hint map keeps it stable), else falls back to its ext
//                             entry (dashed: "follows the most recent note"); a Serum's own LFO / ENV cabled to its own
//                             knob is a native row ('lfo3'). Without ext / track (2a callers): non-native sources are
//                             neither placed nor left, as before
//   modBudget(track, dev, project)  { preset, canvas, left, why, max: 64, slots }: the slots the Serum's own rows hold,
//                             the canvas rows placed, the ids left out (dev: a device id or object) — "23/64" = preset +
//                             canvas; slots (2b): the track's ModCore budgets { lfo: [n, 10], env: [n, 4], chaos: [n, 2],
//                             macro: [n, 8], vals: [n, 16], ext: [n, 16] } (a classic / panel device: its rows'
//                             left / why from the same compile, preset 0)
// Stage 2b (IMPL-2b §3.1, §3.3, §4; SPEC §7.6–7.9): everything a track's cables need beyond a Serum's own matrix is ONE
// message per track, {t: 'mods'}, built here from the track alone:
//   compileMods(track, project, opts) → payload | null   null with no modulator module and no row (N1: nothing posted;
//                             a track whose modules were all deleted posts { t: 'mods', off: true } — the host's
//                             buildMods makes that of null when a payload was posted before). opts { smooth, qr, ultra,
//                             xferOf } (the compile context of the synthetic Serum; xferOf: cv-mods' transfer, lane A2 —
//                             a test stub, or the identity { a: 0, b: 1 } while it is absent). The payload:
//                             { t: 'mods', i: trackId, key, cp, ct, rows, xfer, ext, vals, keep, left, dashed, n }
//     cp / ct               the SYNTHETIC Serum: normalizeSerum of a default (voice section off: a.on 0, poly 1) whose
//                           slots hold the track's modules — LFO modules and linked Serum LFOs in lfo1…10 (a GLOBAL one
//                           mono 1; the knobs on p l<k>.*; unused slots PARKED free + mono: not evaluated, spike §9.0),
//                           ENV modules / linked ENVs in env2…4 then env1 (sustain n²; Start / End none), chaos in
//                           chaos1…2, the first macro module's knobs in macros 1…8 (value table 0–7), further macro knobs
//                           and CC modules as the synthetic CP's ext1…16 sources (value table 8–23: ModCore writes them
//                           into the shim's g rows 62 + j before SxMod.begin; the compile passes ctx.ext when one is
//                           used) — compiled with compileSerum(sy, { bpm, smooth, fx: null, qr, ultra }) → cp = patch.serum,
//                           ct = patch.serumT. Its matrix: the SYNTHETIC ROWS (one per row to a classic / panel
//                           destination: src → its own scratch V-scope destination SCRATCH[i], the cable's amt / bi /
//                           curve / crv / aux / inv / rise / fall / out, evaluated by the pseudo-voice's matrix() and read
//                           back from V.mod.off[vi]), then a KEEP-ALIVE row (amt 1 → the shared scratch KEEP_ID) per
//                           evaluated LFO / ENV / chaos source no LIVE synthetic row reads (bypassed / amt-0 / out-0 rows
//                           read nothing: serum-core rowActive; SxMod skips unreferenced sources) and per ext-listed one
//                           regardless (review C1: a bypassed classic cable never starves a Serum's ext feed)
//     rows                  [{ id, src, dst: { kind: 'cls', inst, slot } | { kind: 'set', inst, field } | { kind: 'fx',
//                           chain, fx, key }, amt, bi, curve, crv, aux, inv, rise, fall, byp, out, perNote, vi, slot }] —
//                           src: the synthetic CP's source index (serum-core SRC_INDEX; a value source ext j is 62 + j − 1,
//                           serum-core's S_EXT0 of §3.2); aux / inv always 0 (review C7: an aux names a Serum source — on a
//                           canvas row it would name the synthetic CP's slot); vi: the scratch destination's voice-vector index
//                           (serum-core vi()); slot: the synthetic matrix slot (its 'crv<slot>' CT part); dst.slot: the
//                           engine's smTargets S_* index (cv-mods SM_SLOT), dst.field the patch field ('lfo.rate'),
//                           dst.fx the chain's fx-core flat parameter index with the layout key
//     xfer                  per row (aligned; null for fx rows) the knob → slot / field transfer (cv-mods xferOf, §5.3)
//     ext                   [{ k: 1…16, src, id }] the ext slots: ModCore source → ext k, shared by every Serum of the
//                           track (id: the canvas source id the injected rows name 'ext<k>' for)
//     vals                  [{ k: 0…23, src, v, id }] the value table: macros 0–7 (the first macro module's knobs),
//                           8–23 further macro knobs and CC modules (initial values; MC.ctl(k, v) later)
//     keep                  [src] the keep-alive sources;  left [{ id, why: 'slots' | 'ext' | 'full' }] the rows not
//                           compiled;  dashed [ids] the rows drawn dashed (§1.3);  n { lfo, env, chaos, macro, vals,
//                           ext, rows } the budgets used (rows: distinct cables — a knob that moves two things counts
//                           once, review C6);  slots { <moduleId | '<serum>/lfo<k>'>: { kind: 'lfo' | 'env' | 'chaos', i } }
//                           each evaluated source's ModCore slot in the live-meter order (lfo 1…10 → 0…9, env 2 3 4 1 →
//                           10…13, chaos 1 2 → 14 15);  key: a content key (the payload without cp / ct, cpKey, ct key; vals
//                           by k / src / id without v: an instrument knob turn or a macro gesture never changes it, a
//                           cabled classic knob's own transfer does)
//                           ModCore slots go, in module id order, to the sources that need ModCore evaluation only (a
//                           PER NOTE LFO injected into every Serum it feeds takes none); over capacity (10 LFO incl.
//                           linked, 4 ENV, 2 chaos, 8 macros, 16 value sources, 16 ext, SCRATCH synthetic rows) the row
//                           is left with its reason. Memoised per track by a hash of what the compile reads (sigOf
//                           below): an uncabled knob of a cabled instrument is a hit; a macro / CC value is a hit whose
//                           vals are refreshed
//   SCRATCH / KEEP_ID       the scratch destinations: V-scope rows of silent modules (oscillator / sub / noise / filter
//                           knobs), never a note-on, LFO, ENV, chaos, porta or voice-control destination
import * as CM from './cv-mods.js?v=9';
import { classOf, MOD_SRC, srcDev, perNoteOf, classicTarget, modDevs, rackDescs } from './cv-mods.js?v=9';
import { defaultFx2, compileFx, compileFxT, normRow, N_MATRIX, N_LFO, N_ENV, N_MACRO, normalizeSerum, defaultSerum, compileSerum, SRC_INDEX, vi, DESTS, DEST_INDEX,
  NOTE_ON_DESTS, normLfo, lfoUsed, extIndex } from './serum-core.js?v=9';
import { fxLayout, fxDest } from './fx-core.js?v=9';
import { patchFor } from './models.js?v=9';

export const LIMITS = Object.freeze({ inst: 8, panels: 16, fxPerPanel: 48 });
export const MOD_KINDS = new Set(['lfo', 'env', 'velo', 'at', 'bend', 'note', 'macro', 'cc', 'chaos']);
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
export function instPatch(d, opts, rows, ext, t) {
  const sx = d.model === 'serum', inj = sx && Array.isArray(rows) && rows.length ? injectMods(d, rows, ext, t) : null;
  const vals = inj && inj.s !== d.vals.s ? Object.assign({}, d.vals, { s: inj.s }) : d.vals;
  const o = inj && inj.placed.some(x => extIndex(x.src) > 0) ? Object.assign({}, opts, { ext: true }) : opts; // (ext rows: the compile accepts them, §3.2)
  const p = patchFor(d.model, vals, sx && d.fx ? d.fx : defaultFx2(), o);
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

/* ------------------------------------------------------------- mod rows into a Serum's matrix (stage 2a, IMPL-2a §2.1; 2b §3.3) */
export function modRowsFor(t, devId) {
  const pre = devId + ':';
  return isObj(t) && Array.isArray(t.mods) ? t.mods.filter(r => isObj(r) && typeof r.dst === 'string' && r.dst.length > pre.length && r.dst.startsWith(pre)) : [];
}
export function nativeRow(r, src) {
  const sid = src !== undefined ? src : isObj(r) && typeof r.src === 'string' ? MOD_SRC[r.src] : undefined, i = sid && typeof r.dst === 'string' ? r.dst.indexOf(':') : -1;
  if (i < 1) return null;
  const ext = extIndex(sid) > 0, n = normRow(Object.assign({}, r, { src: ext ? 'wheel' : sid, dst: r.dst.slice(i + 1) })); // (serum-core's ext ids, §3.2)
  if (!n.src || !n.dst) return null; // (normRow empties a row with an unknown source / aux / destination)
  if (ext) n.src = sid;
  return n;
}
const isFree = r => !isObj(r) || r.src === '' || r.src === undefined;
const splitDst = dst => { const i = typeof dst === 'string' ? dst.indexOf(':') : -1; return i > 0 ? { dev: dst.slice(0, i), param: dst.slice(i + 1) } : null; };
const LFO_KNOBS = ['rate', 'rise', 'delay', 'smooth', 'phase'], ENV_KNOBS = ['att', 'hold', 'dec', 'sus', 'rel', 'start', 'end'], ENV_CRV = ['ca', 'cd', 'cr'];
const ENV_ALL = ENV_KNOBS.concat(ENV_CRV);
const DEF_LFO = JSON.stringify(normLfo({}));
const knobDef = id => DESTS[DEST_INDEX[id]].def;
const sameJ = (a, b) => JSON.stringify(a) === b;
// a Serum's LFO slot k (0-based) is free while its state is the default (shape, mode, knobs) and no row reads it
function lfoFree(s, k) {
  if (!isObj(s) || !Array.isArray(s.lfo) || !isObj(s.lfo[k]) || lfoUsed(s, k)) return false;
  const p = isObj(s.p) ? s.p : {};
  return sameJ(s.lfo[k], DEF_LFO) && LFO_KNOBS.every(x => { const id = 'l' + (k + 1) + '.' + x, v = p[id]; return v === undefined || v === knobDef(id); });
}
// ENV slot k (0-based, 1…3 = ENV 2–4): default knobs and flags, no row reads it (ENV 1 is the amp envelope: never)
function envFree(s, k) {
  if (k < 1 || k >= N_ENV || !isObj(s) || !Array.isArray(s.env) || !isObj(s.env[k])) return false;
  const id = 'env' + (k + 1), M = Array.isArray(s.matrix) ? s.matrix : [], p = isObj(s.p) ? s.p : {}, E = s.env[k];
  if (M.some(r => isObj(r) && (r.src === id || r.aux === id))) return false;
  if (E.bpm || E.legInv || E.stealRe) return false;
  return ENV_ALL.every(x => { const q = 'e' + (k + 1) + '.' + x, v = p[q]; return v === undefined || v === knobDef(q); });
}
// the module state a source carries into a Serum / ModCore slot: { kind: 'lfo' | 'env', state } in the module's device
// shape (song.normModDev: { lfo, rate, … } / { env, att, …, crv }) — a module's own device, or a linked Serum's slot read
// back into that shape; null for anything else
function slotState(t, src) {
  const S = srcDev(t, src);
  if (!S) return null;
  if (S.kind === 'lfo' || S.kind === 'env') return { kind: S.kind, state: S.dev };
  if (S.kind === 'link') {
    const s = isObj(S.dev.vals) ? S.dev.vals.s : null, p = isObj(s) && isObj(s.p) ? s.p : {}, m = /^(lfo|env)(\d+)$/.exec(S.q.link), k = +m[2];
    if (m[1] === 'lfo') { const st = { lfo: isObj(s) && Array.isArray(s.lfo) ? s.lfo[k - 1] : null }; for (const x of LFO_KNOBS) st[x] = p['l' + k + '.' + x]; return { kind: 'lfo', state: st }; }
    const st = { env: isObj(s) && Array.isArray(s.env) ? s.env[k - 1] : null };
    for (const x of ENV_KNOBS) { const q = 'e' + k + '.' + x; st[x] = DEST_INDEX[q] !== undefined ? p[q] : knobDef('e2.' + x); }
    st.crv = ENV_CRV.map(x => p['e' + k + '.' + x]);
    if (k === 1 && typeof st.sus === 'number') st.sus = st.sus * st.sus; // (ENV 1's sustain law n² → the fraction)
    return { kind: 'env', state: st };
  }
  return null;
}
// the LFO / ENV slot's state written into a copy of Serum state s (k 0-based): s.lfo[k] / s.env[k] and the p knobs
function writeSlot(s, kind, k, state) {
  if (kind === 'lfo') { s.lfo[k] = normLfo(state.lfo); for (const x of LFO_KNOBS) if (typeof state[x] === 'number') s.p['l' + (k + 1) + '.' + x] = state[x]; return; }
  const E = isObj(state.env) ? state.env : {};
  s.env[k] = { bpm: E.bpm ? 1 : 0, legInv: E.legInv ? 1 : 0, stealRe: E.stealRe ? 1 : 0 };
  for (const x of ENV_KNOBS) { const q = 'e' + (k + 1) + '.' + x; if (DEST_INDEX[q] !== undefined && typeof state[x] === 'number') s.p[q] = k === 0 && x === 'sus' ? Math.sqrt(state[x]) : state[x]; }
  const c = Array.isArray(state.crv) ? state.crv : [];
  ENV_CRV.forEach((x, i) => { if (typeof c[i] === 'number') s.p['e' + (k + 1) + '.' + x] = c[i]; });
}
// how each row of a Serum compiles: { r, src: the Serum source id | null, inj: { kind, k } | null, dashed, why, extId }
// — native sources as they are; the Serum's own LFO / ENV as 'lfo<k>' / 'env<k>'; a PER NOTE module into a free slot of
// the Serum (one per source, the hint map first); the rest (or a fallback) through the ext list (extId: the canvas
// source; no ext entry → why 'ext'); unknown sources: neither (src null, why null)
const lastSlots = new WeakMap(); // a Serum's vals → Map(row id → the matrix slot injectMods last gave it)
const lastInj = new WeakMap(); // a Serum's vals → Map(canvas source id → the LFO / ENV slot it was injected into)
// the Serum LFO / ENV slots (0-based) a module must not be injected into although their state is the default and no preset
// row reads them: the ones a CANVAS row reads (the Serum's own LFO / ENV as a linked source, or as a row's aux) and the ones
// any row — canvas or preset — aims at through their parameters (l<k>.* / e<k>.*: a module written into LFO 1 to modulate
// "LFO 1 Rate" would modulate itself, and replace what LFO 1 drives)
function busySlots(t, devId, s, rows) {
  const L = new Set(), E = new Set();
  const read = id => { const m = typeof id === 'string' ? /^(lfo|env)(\d+)y?$/.exec(id) : null; if (m) (m[1] === 'lfo' ? L : E).add(+m[2] - 1); };
  const aim = id => { const m = typeof id === 'string' ? /^(l|e)(\d+)\./.exec(id) : null; if (m) (m[1] === 'l' ? L : E).add(+m[2] - 1); };
  for (const r of rows) {
    if (!isObj(r)) continue;
    read(r.aux);
    const D = splitDst(r.dst), S = typeof r.src === 'string' ? srcDev(t, r.src) : null;
    if (D) aim(D.param);
    if (S && S.kind === 'link' && S.q.dev === devId) read(S.q.link);
  }
  for (const r of isObj(s) && Array.isArray(s.matrix) ? s.matrix : []) if (isObj(r)) aim(r.dst);
  return { L, E };
}
function planSerum(t, dev, rows, ext) {
  const s = isObj(dev) && isObj(dev.vals) ? dev.vals.s : null, devId = isObj(t) && isObj(t.dev) ? Object.keys(t.dev).find(k => t.dev[k] === dev) : undefined;
  const E = new Map(Array.isArray(ext) ? ext.map(e => [e.id, e.k]) : []), hint = isObj(dev) && isObj(dev.vals) ? lastInj.get(dev.vals) : null;
  const freeL = [], freeE = [], busy = t ? busySlots(t, devId, s, rows) : null;
  if (t) for (let k = 0; k < N_LFO; k++) if (lfoFree(s, k) && !busy.L.has(k)) freeL.push(k);
  if (t) for (let k = 1; k < N_ENV; k++) if (envFree(s, k) && !busy.E.has(k)) freeE.push(k);
  const taken = new Map(), out = [];
  const slotFor = (id, kind) => {
    if (taken.has(id)) return taken.get(id);
    const free = kind === 'lfo' ? freeL : freeE, h = hint ? hint.get(id) : undefined;
    let k = free.includes(h) ? h : free.length ? free[0] : -1;
    if (k >= 0) free.splice(free.indexOf(k), 1);
    taken.set(id, k);
    return k;
  };
  for (const r of rows) {
    const o = { r, src: null, inj: null, dashed: false, why: null, extId: null };
    out.push(o);
    if (!isObj(r) || typeof r.src !== 'string') continue;
    if (MOD_SRC[r.src] !== undefined) { o.src = MOD_SRC[r.src]; continue; }
    if (!t) continue; // (2a caller: nothing else compiles)
    const S = srcDev(t, r.src);
    if (!S) continue;
    if (S.kind === 'link' && S.q.dev === devId) { o.src = S.q.link; continue; } // (its own LFO / ENV)
    const pn = perNoteOf(t, r.src), st = pn ? slotState(t, r.src) : null;
    if (st) {
      const k = slotFor(r.src, st.kind);
      if (k >= 0) { o.src = (st.kind === 'lfo' ? 'lfo' : 'env') + (k + 1); o.inj = { kind: st.kind, k, state: st.state }; continue; }
      o.dashed = true; // (no free slot: the ext fallback follows the most recent note)
    } else if (pn) o.dashed = true; // (a poly chaos: always ModCore's; dashed)
    o.extId = r.src;
    const k = E.get(r.src);
    if (k !== undefined) o.src = 'ext' + k; else o.why = 'ext';
  }
  return out;
}
// the slots rows take in s: a row its last slot (hint: row id → slot) while free, then the rest in order the free slots
// left, one per valid row (invalid rows: neither placed nor left); placed in rows order
function place(s, rows, hint, plan) {
  const M = isObj(s) && Array.isArray(s.matrix) ? s.matrix : [], free = new Set(), V = [], at = new Map(), placed = [], left = [], why = {}, N = [];
  for (let k = 0; k < N_MATRIX; k++) if (isFree(M[k])) free.add(k);
  const used = N_MATRIX - free.size;
  for (const o of plan) {
    if (o.why) { left.push(o.r.id); why[o.r.id] = o.why; continue; }
    const n = o.src ? nativeRow(o.r, o.src) : null;
    if (n) V.push([o, n]);
  }
  if (hint) for (const [o] of V) { const k = hint.get(o.r.id); if (free.has(k)) { at.set(o, k); free.delete(k); } }
  const rest = [...free];
  for (const [o, n] of V) {
    const k = at.has(o) ? at.get(o) : rest.length ? rest.shift() : -1;
    if (k >= 0) { placed.push({ id: o.r.id, slot: k, src: n.src }); N.push([n, o]); } else { left.push(o.r.id); why[o.r.id] = 'full'; }
  }
  return { placed, left, why, N, used };
}
export function injectMods(dev, rows, ext, t) {
  const s = isObj(dev) && isObj(dev.vals) ? dev.vals.s : undefined, M0 = isObj(s) && Array.isArray(s.matrix) ? s.matrix : [];
  const none = { s, placed: [], left: [], why: {}, dashed: [], inj: [], used: Math.min(N_MATRIX, M0.length) - M0.slice(0, N_MATRIX).filter(isFree).length };
  if (!Array.isArray(rows) || !rows.length || !isObj(s)) return none;
  const plan = planSerum(isObj(t) ? t : null, dev, rows, ext), P = place(s, rows, lastSlots.get(dev.vals), plan);
  lastSlots.set(dev.vals, new Map(P.placed.map(x => [x.id, x.slot])));
  const injs = P.N.filter(([, o]) => o.inj), dashed = P.N.filter(([, o]) => o.dashed).map(([, o]) => o.r.id);
  lastInj.set(dev.vals, new Map(injs.map(([, o]) => [o.r.src, o.inj.k])));
  if (!P.placed.length) return Object.assign(none, { left: P.left, why: P.why, used: P.used });
  const M = Array.isArray(s.matrix) ? s.matrix : [], m = Array.from({ length: N_MATRIX }, (_, k) => (k < M.length ? M[k] : normRow(null)));
  P.N.forEach(([n], i) => { m[P.placed[i].slot] = n; });
  const out = Object.assign({}, s, { matrix: m }), inj = [];
  if (injs.length) { // (the slots: copies of the arrays and p, the module states written in)
    out.lfo = Array.isArray(s.lfo) ? s.lfo.slice() : []; out.env = Array.isArray(s.env) ? s.env.slice() : []; out.p = Object.assign({}, s.p);
    const done = new Set();
    for (const [, o] of injs) { const key = o.inj.kind + o.inj.k; if (done.has(key)) continue; done.add(key); writeSlot(out, o.inj.kind, o.inj.k, o.inj.state); inj.push({ id: o.r.id, kind: o.inj.kind, k: o.inj.k, src: o.r.src }); }
  }
  return { s: out, placed: P.placed, left: P.left, why: P.why, dashed, inj, used: P.used };
}

/* ------------------------------------------------------------- the track's {t: 'mods'} payload (stage 2b, IMPL-2b §3.1) */
export const EXT_N = 16, VAL_N = 16, S_EXT0 = 62; // ext slots per track; value sources beyond the macros; ext1's source index
const NOTE_ON = new Set(NOTE_ON_DESTS);
export const SCRATCH = Object.freeze((() => {
  const out = [], want = [/^[abc]\.(pan|fine|crs|det|blend|wt|warp|uniw|uniwarp|uniwt|level|oct|semi)$/, /^s\.(level|pan|oct|crs)$/, /^n\.(level|pan|pitch|fine)$/, /^f2?\.(cutoff|res|drive|var|pan|mix|level)$/];
  for (const re of want) for (const d of DESTS) if (re.test(d.id) && d.scope === 'V' && vi(d.id) >= 0 && !NOTE_ON.has(d.id)) out.push(d.id);
  return out;
})());
export const KEEP_ID = SCRATCH[SCRATCH.length - 1], SYN_MAX = N_MATRIX - N_LFO - N_ENV - 2; // (48 synthetic rows: the keep-alives always fit)
const SRC_IDX = id => { const k = extIndex(id); return k ? S_EXT0 + k - 1 : SRC_INDEX[id]; };
const fnv = (h, str) => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h; };
const MEMO = new WeakMap(); // track → { sig, pay } (a knob turn elsewhere on the track recompiles nothing)
const lfoSlot = k => 'lfo' + (k + 1), envSlot = k => 'env' + (k + 1);
const ENV_ORDER = [1, 2, 3, 0]; // (ENV 2–4, then ENV 1)
// every row of the track that can compile: its parts and class (a classic knob's target is the compile's: its transfer
// says when the knob is inert — a switched-off oscillator's level keeps its cable with b 0, review C3)
function validRows(t) {
  const out = [];
  for (const r of Array.isArray(t.mods) ? t.mods : []) {
    if (!isObj(r) || typeof r.id !== 'string' || typeof r.src !== 'string') continue;
    const D = splitDst(r.dst), d = D ? t.dev[D.dev] : null, S = srcDev(t, r.src);
    if (!isObj(d) || !S) continue;
    const K = kindOf(d);
    if (K === 'inst' && d.model === 'serum') { out.push({ r, D, d, S, kind: 'serum' }); continue; }
    if (K === 'inst') {
      const c = classOf(d.model, D.param);
      if (c === 'sm' || c === 'apply' || c === 'proc') out.push({ r, D, d, S, kind: c === 'sm' ? 'cls' : 'set' });
      continue;
    }
    if (K === 'panel') {
      const fx = isObj(d.fx) ? d.fx : null, desc = rackDescs(fx || d.rack).find(x => x.id === D.param);
      if (!desc || desc.nomod || !fx) continue;
      let fd = null, key = '';
      try { fd = fxDest(D.param, fx); key = fxLayout(fx).key; } catch { fd = null; }
      if (!fd || fd.nomod) continue;
      out.push({ r, D, d, S, kind: 'fx', fx: 8 + fd.flat, key }); // (the FX-context index: 8 globals + the parameter's flat index, as serum-core's own FX rows; lane D's fixture check)
    }
  }
  return out;
}
/* the memo signature (review C2 / C3 / C5 / C9, P1): a 64-bit hash of everything the compile reads, walked without
   stringifying — the rows (every field), the module states bar the macro / CC VALUES (the value table travels by
   {t: 'mval'}; the payload's vals are refreshed on a hit), bpm and the compile options, and per destination: a classic
   instrument's model and the values of the controls each cabled knob's transfer DEPENDS on (cv-mods depsOf: the knob and
   its measured neighbours — so an uncabled knob of a cabled instrument is a HIT), a Serum's slot states / slot knobs /
   matrix sources and fill (the free picture and 'full'), a panel's layout key, a linked slot's state. Numbers go in by
   their bits, strings by their chars; two independent FNV streams make a false hit a 2⁻⁶⁴ event. */
const F64 = new Float64Array(1), U32 = new Uint32Array(F64.buffer);
let H1 = 0, H2 = 0;
const mixU = u => { H1 = Math.imul(H1 ^ u, 16777619); H2 = Math.imul(H2 ^ u, 0x5bd1e995) + 0x27d4eb2f | 0; };
const mixN = x => { F64[0] = x; mixU(U32[0]); mixU(U32[1]); };
const mixS = s => { mixU(0x2c); for (let i = 0; i < s.length; i++) mixU(s.charCodeAt(i)); };
function hv(v) {
  if (typeof v === 'number') mixN(v);
  else if (typeof v === 'string') mixS(v);
  else if (v === true) mixU(0x54); else if (v === false) mixU(0x46); else if (v == null) mixU(0x4e);
  else if (Array.isArray(v)) { mixU(0x5b); for (let i = 0; i < v.length; i++) hv(v[i]); mixU(0x5d); }
  else if (typeof v === 'object') { mixU(0x7b); for (const k in v) { const x = v[k]; if (x !== undefined && typeof x !== 'function') { mixS(k); hv(x); } } mixU(0x7d); }
}
const FN_ID = new WeakMap(); let fnN = 0; // (a stubbed transfer in opts: its identity)
const fnId = f => { if (typeof f !== 'function') return 0; let k = FN_ID.get(f); if (!k) FN_ID.set(f, (k = ++fnN)); return k; };
function serumSig(d) {
  const s = isObj(d.vals) ? d.vals.s : null;
  if (!isObj(s)) { mixU(0x78); return; }
  hv(s.lfo); hv(s.env);
  const p = isObj(s.p) ? s.p : {};
  for (let k = 1; k <= N_LFO; k++) for (const x of LFO_KNOBS) hv(p['l' + k + '.' + x]);
  for (let k = 2; k <= N_ENV; k++) for (const x of ENV_ALL) hv(p['e' + k + '.' + x]);
  const M = Array.isArray(s.matrix) ? s.matrix : [];
  let n = 0;
  for (let k = 0; k < N_MATRIX && k < M.length; k++) { const r = M[k]; if (isFree(r)) continue; n++; mixS(r.src); mixS(typeof r.aux === 'string' ? r.aux : ''); mixS(typeof r.dst === 'string' ? r.dst : ''); } // (dst: a preset row aimed at a slot's parameter keeps the slot out of the free picture)
  mixN(n);
}
function sigOf(t, project, o) {
  H1 = 0x811c9dc5; H2 = 0x9747b28c;
  mixN(isObj(project) && project.bpm > 0 ? +project.bpm : 120); mixN(o.smooth > 0 ? +o.smooth : 1); mixN(o.ultra ? 1 : 0); mixS(o.qr ? JSON.stringify(o.qr) : '');
  mixN(fnId(o.xferOf)); mixN(fnId(o.targetsOf));
  for (const { id, dev, kind } of modDevs(t)) { mixS(id); if (kind === 'macro') hv(dev.names); else if (kind === 'cc') { hv(dev.cc); hv(dev.ch); } else hv(dev); }
  const seen = new Set();
  for (const r of Array.isArray(t.mods) ? t.mods : []) {
    if (!isObj(r)) continue;
    mixU(0x7c); hv(r);
    const D = splitDst(r.dst), d = D ? t.dev[D.dev] : null;
    if (!isObj(d)) continue;
    const K = kindOf(d);
    if (K === 'inst' && d.model === 'serum') { if (!seen.has(D.dev)) { seen.add(D.dev); serumSig(d); } }
    else if (K === 'inst') {
      mixS(typeof d.model === 'string' ? d.model : '');
      const v = isObj(d.vals) ? d.vals : {}, T = CM.targetsOf(d.model, D.param);
      for (const x of T) for (const id of CM.depsOf(d.model, D.param, x)) { mixS(id); hv(v[id]); }
    } else if (K === 'panel') { if (!seen.has(D.dev)) { seen.add(D.dev); const fx = isObj(d.fx) ? d.fx : null; let key = ''; try { key = fx ? fxLayout(fx).key : ''; } catch { key = '?'; } mixS(key); } }
    if (typeof r.src === 'string' && r.src.indexOf('/') > 0) hv(slotState(t, r.src));
  }
  return (H1 >>> 0).toString(16) + (H2 >>> 0).toString(16);
}
// the value table's initial values follow the modules on a memo hit too (a repost then carries the latest, not the
// values of the compile; k / src / id are the content — review C5)
function refreshVals(t, pay) {
  if (!pay) return;
  for (const e of pay.vals) {
    const S = srcDev(t, e.id), v = S && S.kind === 'macro' ? (Array.isArray(S.dev.v) ? S.dev.v[+/\.k(\d)$/.exec(e.id)[1] - 1] : 0) : S && S.kind === 'cc' ? S.dev.v : e.v;
    e.v = typeof v === 'number' ? v : 0;
  }
}
export function compileMods(t, project, opts) {
  if (!isObj(t) || !isObj(t.dev)) return null;
  const o = isObj(opts) ? opts : {}, sig = sigOf(t, project, o), memo = MEMO.get(t);
  if (memo && memo.sig === sig) { refreshVals(t, memo.pay); return memo.pay; }
  const V = validRows(t), devs = modDevs(t);
  if (!devs.length && !V.length) { MEMO.set(t, { sig, pay: null }); return null; }
  const pay = buildMods(t, project, o, V, devs);
  MEMO.set(t, { sig, pay });
  return pay;
}
function buildMods(t, project, o, V, devs) {
  const left = [], why = new Map(), dashed = new Set();
  // 1. the sources ModCore must evaluate: every non-Serum row's, and every Serum row's that needs an ext slot (a plan
  //    without the ext list says which: GLOBAL sources, per-note sources with no free slot)
  const need = new Set(), extNeed = [];
  const serums = new Set(V.filter(x => x.kind === 'serum').map(x => x.D.dev));
  for (const id of serums) {
    for (const p of planSerum(t, t.dev[id], modRowsFor(t, id), [])) if (p.extId) { need.add(p.extId); if (!extNeed.includes(p.extId)) extNeed.push(p.extId); }
  }
  for (const x of V) if (x.kind !== 'serum') need.add(x.r.src);
  // 2. ModCore slots in module id order (links after the modules, by their id): lfo1…10, env2…4 then env1, chaos1…2,
  //    the first macro module's knobs → macros 1…8 (value table 0–7), further macro knobs and CCs → value sources 8…23
  //    (the synthetic CP's ext1…16); the performance sources are the shim's own
  const alloc = new Map(), n = { lfo: 0, env: 0, chaos: 0, macro: 0, vals: 0, ext: 0, rows: 0 }, vals = [];
  let macroDev = null, valN = 0;
  const take = (id, kind, perNote) => {
    if (!need.has(id) || alloc.has(id)) return;
    let sid = null, k = -1;
    if (kind === 'lfo') { if (n.lfo < N_LFO) sid = lfoSlot(n.lfo++); } else if (kind === 'env') { if (n.env < N_ENV) sid = envSlot(ENV_ORDER[n.env++]); } else if (kind === 'chaos') { if (n.chaos < 2) sid = 'chaos' + ++n.chaos; } else if (kind === 'val') { if (valN < VAL_N) { k = N_MACRO + valN++; sid = 'ext' + (k - N_MACRO + 1); n.vals++; } } else if (kind === 'macro') { sid = 'macro' + k0(id); k = k0(id) - 1; n.macro++; } else sid = kind;
    alloc.set(id, sid ? { sid, k, perNote: !!perNote } : null);
  };
  const k0 = id => +/\.k(\d)$/.exec(id)[1];
  for (const { id, dev, kind } of devs) {
    if (kind === 'macro') {
      if (macroDev === null && [...need].some(x => x.startsWith(id + '.k'))) macroDev = id;
      for (let k = 1; k <= 8; k++) take(id + '.k' + k, macroDev === id ? 'macro' : 'val');
      continue;
    }
    const src = id + '.out';
    if (kind === 'lfo') take(src, 'lfo', !dev.lfo.mono);
    else if (kind === 'env') take(src, 'env', true);
    else if (kind === 'chaos') take(src, 'chaos', !dev.chaos.mono);
    else if (kind === 'cc') take(src, 'val');
    else take(src, MOD_SRC[src], kind === 'velo' || kind === 'note');
  }
  take('wheel', 'wheel');
  for (const id of [...need].filter(x => /\//.test(x)).sort()) { const S = srcDev(t, id); if (S && S.kind === 'link') take(id, /^lfo/.test(S.q.link) ? 'lfo' : 'env', !!perNoteOf(t, id)); }
  for (const id of need) if (!alloc.has(id) || alloc.get(id) === null) { alloc.set(id, null); }
  // the value table: macros (the first macro module) and the value sources, initial values from the modules
  for (const [id, a] of alloc) {
    if (!a || a.k < 0) continue;
    const S = srcDev(t, id), v = S.kind === 'macro' ? (Array.isArray(S.dev.v) ? S.dev.v[k0(id) - 1] : 0) : S.kind === 'cc' ? S.dev.v : 0;
    vals.push({ k: a.k, src: SRC_IDX(a.sid), v: typeof v === 'number' ? v : 0, id });
  }
  vals.sort((a, b) => a.k - b.k);
  // 3. ext slots, in the order the Serums need them
  const ext = [];
  for (const id of extNeed) { const a = alloc.get(id); if (a && ext.length < EXT_N) ext.push({ k: ext.length + 1, src: SRC_IDX(a.sid), id }); }
  n.ext = ext.length;
  // 4. the Serum rows: placed / left per Serum with the ext list (the plan decides dashed and the fallback)
  for (const id of serums) {
    const inj = injectMods(t.dev[id], modRowsFor(t, id), ext, t);
    for (const rid of inj.left) { const r = V.find(x => x.r.id === rid); const w = inj.why[rid] === 'ext' && r && alloc.get(r.r.src) === null ? 'slots' : inj.why[rid]; left.push({ id: rid, why: w }); }
    for (const rid of inj.dashed) dashed.add(rid);
  }
  // 5. the synthetic rows (classic / panel destinations) and their ModCore rows
  // (lane A2's transfer maths, by name: targetsOf(model, ctl) → [{ kind: 'slot', slot } | { kind: 'field', field }] (several
  // for a knob that moves several things: master tune → three TU slots, Juno Env A → fenv.a + aenv.a) and xferOf(model,
  // vals, ctl, target) → { a, b, x0 } | { tab, x0 }; a test stubs them through opts; absent: one target from
  // classicTarget and the identity transfer)
  const rows = [], xfer = [], syn = [], xf = typeof o.xferOf === 'function' ? o.xferOf : CM.xferOf, tgs = typeof o.targetsOf === 'function' ? o.targetsOf : CM.targetsOf;
  const targetsOf = x => { // (the targets from the sweep; a stub that names none: the live patch's single target — an inert knob (a switched-off oscillator's level) then has none and its row is skipped, as before)
    const T = tgs(x.d.model, x.D.param);
    if (Array.isArray(T) && T.length) return T;
    const tg = classicTarget(x.d.model, x.d.vals, x.D.param);
    if (!tg || !tg.on || (x.kind === 'cls' ? tg.slot < 0 : tg.field === null)) return [];
    return [x.kind === 'cls' ? { kind: 'slot', slot: tg.slot } : { kind: 'field', field: tg.field }];
  };
  const used = new Set(), live = r => !r.byp && r.amt !== 0 && r.out !== 0; // (serum-core rowActive: a bypassed / silent row reads nothing — review C1)
  for (const x of V) {
    if (x.kind === 'serum') continue;
    const a = alloc.get(x.r.src);
    if (!a) { left.push({ id: x.r.id, why: 'slots' }); continue; }
    const T = x.kind === 'fx' ? null : targetsOf(x);
    if (T && !T.length) continue;
    if (syn.length >= SYN_MAX) { left.push({ id: x.r.id, why: 'full' }); continue; }
    const slot = syn.length, dstId = SCRATCH[slot], n0 = normRow(Object.assign({}, x.r, { src: extIndex(a.sid) ? 'wheel' : a.sid, dst: dstId, aux: '', inv: 0 })); // (no aux on a canvas row: it would name the synthetic CP's slot — review C7)
    if (!n0.src) { left.push({ id: x.r.id, why: 'nomod' }); continue; }
    n0.src = a.sid;
    syn.push(n0);
    if (live(n0)) used.add(a.sid);
    if (a.perNote) dashed.add(x.r.id);
    const base = { id: x.r.id, src: SRC_IDX(a.sid), dst: null, amt: n0.amt, bi: n0.bi, curve: n0.curve, crv: n0.crv, aux: 0, inv: 0, rise: n0.rise, fall: n0.fall, byp: n0.byp, out: n0.out,
      perNote: a.perNote, vi: vi(dstId), slot, tgt: 0 };
    if (x.kind === 'fx') { rows.push(Object.assign(base, { dst: { kind: 'fx', chain: x.D.dev, fx: x.fx, key: x.key } })); xfer.push(null); continue; }
    T.forEach((tg, j) => { // one payload row per target of the knob (the same synthetic row: the same vi), its own transfer
      const dst = tg.kind === 'slot' ? { kind: 'cls', inst: x.D.dev, slot: tg.slot } : { kind: 'set', inst: x.D.dev, field: tg.field };
      rows.push(Object.assign({}, base, { dst, tgt: j }));
      xfer.push(xf(x.d.model, x.d.vals, x.D.param, tg));
    });
  }
  n.rows = new Set(rows.map(r => r.id)).size; // (cables, not payload rows: a knob that moves two things counts once — review C6)
  // 6. the synthetic Serum: the slots filled, unused LFO slots parked, keep-alive rows for the LFO / ENV / chaos sources
  //    no live synthetic row reads and for every ext-listed one regardless (the Serums' ext feed never depends on a
  //    classic row's bypass: review C1); slots: each evaluated module's ModCore slot in the live-meter order (lfo 0…9,
  //    env2 env3 env4 env1 → 10…13, chaos 14…15)
  const sy = normalizeSerum(defaultSerum());
  sy.p['a.on'] = 0; sy.voicing.poly = 1;
  for (let k = 0; k < N_LFO; k++) Object.assign(sy.lfo[k], { mode: 'free', mono: 1 });
  const keep = [], extIds = new Set(ext.map(e => e.id)), slots = {}, keepOf = (id, a) => !used.has(a.sid) || extIds.has(id);
  let anyExt = false;
  for (const [id, a] of alloc) {
    if (!a) continue;
    const S = srcDev(t, id), m = /^(lfo|env|chaos|macro|ext)(\d+)$/.exec(a.sid);
    if (!m) continue;
    const k = +m[2] - 1;
    if (m[1] === 'lfo' || m[1] === 'env') { const st = slotState(t, id); if (st) writeSlot(sy, st.kind, k, st.state); }
    else if (m[1] === 'chaos') { const c = isObj(S.dev.chaos) ? S.dev.chaos : {}; sy.chaos[k] = { mono: c.mono ? 1 : 0, sh: c.sh ? 1 : 0 }; if (typeof S.dev.rate === 'number') sy.p['c' + (k + 1) + '.rate'] = S.dev.rate; sy.p['c' + (k + 1) + '.bpm'] = S.dev.bpm ? 1 : 0; }
    else if (m[1] === 'macro') { const nm = Array.isArray(S.dev.names) ? S.dev.names[k] : ''; sy.macros[k] = { name: (typeof nm === 'string' && nm) || 'Macro ' + (k + 1), v: typeof S.dev.v[k] === 'number' ? S.dev.v[k] : 0 }; }
    else anyExt = true;
    if (m[1] === 'lfo' || m[1] === 'env' || m[1] === 'chaos') {
      slots[id.replace(/\.out$/, '')] = { kind: m[1], i: m[1] === 'lfo' ? k : m[1] === 'env' ? (k === 0 ? 13 : 9 + k) : 14 + k };
      if (keepOf(id, a)) keep.push(SRC_IDX(a.sid));
    }
  }
  syn.forEach((r, k) => { sy.matrix[k] = r; });
  let slot = syn.length;
  for (const [id, a] of alloc) if (a && /^(lfo|env|chaos)/.test(a.sid) && keepOf(id, a) && slot < N_MATRIX) sy.matrix[slot++] = normRow({ src: a.sid, amt: 1, dst: KEEP_ID });
  const bpm = isObj(project) && project.bpm > 0 ? +project.bpm : 120;
  const P = compileSerum(sy, { bpm, smooth: o.smooth > 0 ? +o.smooth : 1, fx: null, qr: o.qr || null, ultra: o.ultra ? 1 : 0, ext: anyExt || undefined });
  const ord = new Map(V.map((x, i) => [x.r.id, i]));
  left.sort((a, b) => ord.get(a.id) - ord.get(b.id)); // (in track.mods order)
  const pay = { t: 'mods', i: t.id, key: '', cp: P.serum, ct: P.serumT, rows, xfer, ext, vals, keep, left, dashed: [...dashed], n, slots };
  let h = fnv(0x811c9dc5, JSON.stringify([rows, xfer, ext, vals.map(v => [v.k, v.src, v.id]), keep, left, pay.dashed, n, slots])); // (vals without v: a macro gesture reposts nothing — review C5)
  h = fnv(h, P.serum.cpKey + P.serumT.key);
  pay.key = (h >>> 0).toString(16).padStart(8, '0');
  return pay;
}
export function modBudget(t, dev, project) {
  const D = isObj(t) && isObj(t.dev) ? t.dev : {}, id = typeof dev === 'string' ? dev : Object.keys(D).find(k => D[k] === dev);
  const d = id !== undefined ? D[id] : null, pay = isObj(d) ? compileMods(t, project) : null, rows = id !== undefined ? modRowsFor(t, id) : [];
  const slots = { lfo: [0, N_LFO], env: [0, N_ENV], chaos: [0, 2], macro: [0, N_MACRO], vals: [0, VAL_N], ext: [0, EXT_N] };
  if (pay) for (const k of Object.keys(slots)) slots[k][0] = pay.n[k];
  if (isObj(d) && d.kind === 'synth' && d.model === 'serum') {
    const inj = injectMods(d, rows, pay ? pay.ext : [], t), left = inj.left.slice(), why = Object.assign({}, inj.why);
    if (pay) for (const x of pay.left) if (rows.some(r => r.id === x.id)) { if (!left.includes(x.id)) left.push(x.id); why[x.id] = x.why; } // (the compile's reason wins: 'slots' over the injection's 'ext' — review U4)
    return { preset: inj.used, canvas: inj.placed.length, left, why, max: N_MATRIX, slots };
  }
  const mine = new Set(rows.map(r => r.id)), L = pay ? pay.left.filter(x => mine.has(x.id)) : [];
  return { preset: 0, canvas: pay ? new Set(pay.rows.filter(r => mine.has(r.id)).map(r => r.id)).size : 0, left: L.map(x => x.id), why: Object.fromEntries(L.map(x => [x.id, x.why])), max: N_MATRIX, slots }; // (canvas: cables — review C6 / U9)
}

