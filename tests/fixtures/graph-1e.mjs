// Stage 1e protocol fixtures (IMPL-1e §5): hand-built v2 tracks of shapes today's single-instrument path cannot play, and
// the exact messages the host (main.js sendPatch, graph path) posts for each on a graphed node, built by the same pure
// compile (cv-graph compileTrack / compileGraph, instPatch, chainPatch) with the host's default live options (a desktop:
// no touch, every Serum preference default, CPU safeguard off, sxCap 8). Lane A's engine tests replay these; lane B's
// cv-graph / graph-host tests assert them.
//   (a)  Juno-60 + Minimoog → fx1 (chorus) → out
//   (b)  Serum (its own FX: a reverb) + Prophet-5 → fx1 (delay) → out, the Serum soloed in the track (the Prophet silent:
//        on false in the graph)
//   (c)  two Juno-60 → separate panels (fx1: EQ, fx2: delay) → out, the second at level 0.5
//   (a2) a single Juno-60 → fx1 (chorus) → out, canonical, through the graph form (compileGraph: a graphed node)
// tracks() → { a, b, c, a2 } fresh copies (project track records after cv-model adopt minus the accessors);
// messages(track, o = OPTS) → [{t: 'graph', insts, chains, edges, out, key}, {t: 'patch', i, p} per Inst (graph.insts
// order), {t: 'chain', c, fxr, fxrT} per panel (graph.chains order)]; MSGS = { a, b, c, a2 } at OPTS.
// The graph messages (ids, salts, edges) by hand: GRAPH.
import * as G from '../../cv-graph.js?v=9';
import { MODELS } from '../../models.js?v=9';
import * as C from '../../serum-core.js?v=9';

const clone = x => JSON.parse(JSON.stringify(x));
const vals = id => Object.fromEntries(MODELS.find(m => m.id === id).controls.map(c => [c.id, c.def])); // (main.js defaults(m))
const fxWith = type => { const fx = C.defaultFx2(); if (type) C.newInstance(fx, type, { rack: 0 }); return fx; };
const syn = (model, o) => Object.assign({ kind: 'synth', model, vals: vals(model), preset: null }, o || {});
const base = (id, name) => ({ id, name, color: '#e8a23a', ch: 0, mute: false, solo: false, arm: false, vol: 0.8, pan: 0, notes: [], cc: [] });
const sxDev = () => { const s = C.normalizeSerum(C.defaultSerum()); return { kind: 'synth', model: 'serum', vals: { s }, preset: null, fx: C.normalizeFx(fxWith('rev'), s) }; };

const A = Object.assign(base('trk_a', 'Juno + Moog'), { prim: 'i1', nid: 3,
  dev: { i1: syn('juno60'), fx1: { kind: 'panel', fx: fxWith('cho') }, out: { kind: 'out' }, i2: syn('minimoog') },
  wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in' }, { id: 'w2', a: 'fx1.out', b: 'out.in' }, { id: 'w3', a: 'i2.out', b: 'fx1.in' }] });
const B = Object.assign(base('trk_b', 'Serum + Prophet'), { prim: 'i1', nid: 3,
  dev: { i1: Object.assign(sxDev(), { solo: true }), out: { kind: 'out' }, i2: syn('prophet5'), fx1: { kind: 'panel', fx: fxWith('dly') } },
  wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in' }, { id: 'w2', a: 'i2.out', b: 'fx1.in' }, { id: 'w3', a: 'fx1.out', b: 'out.in' }] });
const Cc = Object.assign(base('trk_c', 'Two Junos'), { prim: 'i1', nid: 3,
  dev: { i1: syn('juno60'), fx1: { kind: 'panel', fx: fxWith('eq') }, out: { kind: 'out' }, i2: syn('juno60'), fx2: { kind: 'panel', fx: fxWith('dly') } },
  wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in' }, { id: 'w2', a: 'fx1.out', b: 'out.in' }, { id: 'w3', a: 'i2.out', b: 'fx2.in' }, { id: 'w4', a: 'fx2.out', b: 'out.in', g: 0.5 }] });
const A2 = Object.assign(base('trk_a2', 'Juno'), { prim: 'i1', nid: 2,
  dev: { i1: syn('juno60'), fx1: { kind: 'panel', fx: fxWith('cho') }, out: { kind: 'out' } },
  wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in' }, { id: 'w2', a: 'fx1.out', b: 'out.in' }] });
const TRACKS = { a: A, b: B, c: Cc, a2: A2 };
export const tracks = () => clone(TRACKS);

// the host's live patch options at defaults (main.js buildInstPatch: drift 5 / 10, hiss, qrOf(0) on a desktop, the Serum
// preferences' defaults; seed only on a node's first patch after a load)
export const QR0 = Object.freeze({ uniMax: 16, grainsMax: 256, specHopMul: 1, specStreams: 32, grainsProc: 512, convMax: 10 });
export const PREFS0 = Object.freeze({ tooltips: 1, dblClick: 'type', wheel: 1, view3d: 0, wheelWt: 0, limitDrop: 1, silenceTails: 1, defOs: 2, author: '', askPreset: 0, smooth: 1,
  mpeDefault: 0, mpeBendX: 0, mpeYBi: 0, midiFromPreset: 1, ultra: 0 });
export const OPTS = Object.freeze({ sr: 48000, bpm: 120, drift: 0.5, hiss: 1, qr: QR0, prefs: PREFS0, seed: false, osCap: 8 });

export function messages(t, o = OPTS) {
  const g = G.compileGraph(t), out = [Object.assign({ t: 'graph' }, g.graph)];
  for (const { id } of g.graph.insts) {
    const p = G.instPatch(t.dev[id], o);
    if (t.dev[id].model === 'serum') p.osCap = o.osCap; // (live: the safeguard's Serum cap; capQ4 a no-op at step 0)
    out.push({ t: 'patch', i: id, p });
  }
  for (const { id } of g.graph.chains) out.push(Object.assign({ t: 'chain', c: id }, G.chainPatch(g.chains[id], o)));
  return out;
}
export const MSGS = Object.fromEntries(Object.entries(TRACKS).map(([k, t]) => [k, messages(clone(t))]));

// the graph messages written out (salt of iN = (N * 0x9E3779B9) >>> 0; the primary 0)
const Z = { lo: 0, hi: 127, xp: 0 }, S2 = (2 * 0x9E3779B9) >>> 0;
export const GRAPH = {
  a: { insts: [{ id: 'i1', on: true, zone: Z, salt: 0 }, { id: 'i2', on: true, zone: Z, salt: S2 }], chains: [{ id: 'fx1' }],
    edges: [['i1', 'fx1', 1], ['fx1', 'out', 1], ['i2', 'fx1', 1]], out: 'out' },
  b: { insts: [{ id: 'i1', on: true, zone: Z, salt: 0 }, { id: 'i2', on: false, zone: Z, salt: S2 }], chains: [{ id: 'fx1' }],
    edges: [['i1', 'fx1', 1], ['i2', 'fx1', 1], ['fx1', 'out', 1]], out: 'out' },
  c: { insts: [{ id: 'i1', on: true, zone: Z, salt: 0 }, { id: 'i2', on: true, zone: Z, salt: S2 }], chains: [{ id: 'fx1' }, { id: 'fx2' }],
    edges: [['i1', 'fx1', 1], ['fx1', 'out', 1], ['i2', 'fx2', 1], ['fx2', 'out', 0.5]], out: 'out' },
  a2: { insts: [{ id: 'i1', on: true, zone: Z, salt: 0 }], chains: [{ id: 'fx1' }], edges: [['i1', 'fx1', 1], ['fx1', 'out', 1]], out: 'out' },
};
