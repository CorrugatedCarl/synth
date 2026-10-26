// tests/ref-WC/record.mjs — the base record of stage WC (docs/canvas/IMPL-WC.md G1 / G12 / W7): what the predicate sweep and the
// cords renderer must leave exactly as they were on every canvas that is not a Wavecraft.
// Recorded ONCE from the pristine tree at c950b49 (the contract commit: dee3010's sources, no WC change) by
//   node --max-old-space-size=2048 tests/ref-WC/record.mjs --write      (rewrites base.json and prints a summary)
// and frozen as tests/ref-WC/base.json. Against a changed tree the same script compares:
//   node --max-old-space-size=2048 tests/ref-WC/record.mjs              (prints every key whose value differs; exit 1 on one)
// Lane S runs it after the sweep, lane C / H after theirs, reviewer 1 at the end (G1 exact); a test may import record() too.
//   G1  per fixture track — every factory Serum preset as a canonical Serum track (its own FX), every classic model at its
//       defaults (i1 → fx1 → out), every drum machine, the Model 15 (a 900 Series), the stage-1e / 2a / 2b fixture tracks
//       (several instruments, panels, modulators, rows) — the sha256 of the stable JSON (keys sorted, typed arrays as arrays)
//       of: cv-graph compileTrack / compileGraph / compileMods (with a project: BPM, the wheel, no Pads), cv-cables cablesOf
//       (the project, presetRows), the host's messages (tests/fixtures/graph-1e messages(): the graph, a patch per Inst through
//       instPatch / patchFor, a chain per panel) and cv-mods destOk over every control id of each device's model plus a few
//       Serum ids, a dynamic FX id and a bogus one (panels and modulator modules probed too). Parts-view fixtures are left out
//       by design (IMPL-WC G1: their cablesOf changes with Wavecraft).
//   G12 per canvas session — a Juno with modulators, a Serum complete with mod cables (its own-FX cable, a native row, a link
//       row from a part that is hidden while whole, preset rows, a hidden knob end), a Serum under 26 rows (the 24+ fade and its
//       hint), an 808 with a Pads module's note lines, a 900 Series — the markup of the world element that holds cv-cables' two
//       SVG layers, the badges, the BAL badge and the ×, after each scripted step (set / layout, select, highlight, the ∿ modes,
//       a zoom, the live cable, a removal, a port move, a bypass), serialised from tests/wk-dom.mjs (tag, attributes in insertion
//       order, the style keys set, children) — the full markup when it fits 64 KB, else its sha256. No master session: the
//       master canvas draws no cables (its rack feeds OUT inside master-ui; cv-cables is not mounted there).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MODELS, classicOf } from '../../models.js?v=9';
import * as C from '../../serum-core.js?v=9';
import * as G from '../../cv-graph.js?v=9';
import * as CB from '../../cv-cables.js?v=9';
import { destOk } from '../../cv-mods.js?v=9';
import { normDrum } from '../../drum-core.js?v=9';
import { newModule } from '../../pads-core.js?v=9';
import * as MG from '../../moog-core.js?v=9';
import { messages, tracks as tracks1e } from '../fixtures/graph-1e.mjs';
import { tracks as tracks2a } from '../fixtures/mods-2a.mjs';
import { tracks as tracks2b } from '../fixtures/mods-2b.mjs';
import { normModDev } from '../../song.js?v=9';
import { fresh } from '../wk-dom.mjs';

const OUT = new URL('./base.json', import.meta.url);
const sha = s => createHash('sha256').update(s).digest('hex');
const clone = x => JSON.parse(JSON.stringify(x));
// stable JSON: keys sorted, typed arrays / Maps / Sets written out, functions skipped, NaN / ±Infinity as words
function stable(x) {
  if (x === undefined) return null;
  if (x === null || typeof x !== 'object') return typeof x === 'number' && !Number.isFinite(x) ? String(x) : typeof x === 'function' ? undefined : x;
  if (ArrayBuffer.isView(x)) return { $ta: x.constructor.name, v: Array.from(x, stable) };
  if (Array.isArray(x)) return x.map(stable);
  if (x instanceof Map) return { $map: [...x].map(([k, v]) => [stable(k), stable(v)]) };
  if (x instanceof Set) return { $set: [...x].map(stable) };
  const o = {};
  for (const k of Object.keys(x).sort()) { const v = stable(x[k]); if (v !== undefined) o[k] = v; }
  return o;
}
const H = x => sha(JSON.stringify(stable(x)));

/* ---------------------------------------------------------------- G1: the fixtures */
const vals = id => Object.fromEntries(MODELS.find(m => m.id === id).controls.map(c => [c.id, c.def]));
const base = (id, name) => ({ id, name, color: '#e8a23a', ch: 0, mute: false, solo: false, arm: false, vol: 0.8, pan: 0, notes: [], cc: [] });
const classicTrack = (model, dev) => Object.assign(base('trk_' + model, model), { prim: 'i1', nid: 2,
  dev: { i1: Object.assign({ kind: 'synth', model, vals: vals(model), preset: null }, dev || {}), fx1: { kind: 'panel', fx: C.defaultFx2() }, out: { kind: 'out' } },
  wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in' }, { id: 'w2', a: 'fx1.out', b: 'out.in' }] });
const serumTrack = (name, s, fx) => Object.assign(base('trk_sx', name), { prim: 'i1', nid: 2,
  dev: { i1: { kind: 'synth', model: 'serum', vals: { s }, preset: name, fx }, out: { kind: 'out' } }, wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }] });
export function fixtures() {
  const F = {};
  for (const p of C.FACTORY_PRESETS) {
    const s = C.normalizeSerum(clone(p.v.s));
    F['serum:' + p.name] = serumTrack(p.name, s, p.fx ? C.normalizeFx(clone(p.fx), s) : C.defaultFx2());
  }
  for (const m of MODELS) {
    if (classicOf(m)) F['classic:' + m.id] = classicTrack(m.id);
    else if (m.family === 'drums') F['drum:' + m.id] = classicTrack(m.id, { drum: normDrum({}, m.id) });
    else if (m.family === 'patch') { const x = MG.model15(); F['patch:' + m.id] = classicTrack(m.id, { vals: x.vals, patch: x.rec }); }
  }
  const T1 = tracks1e();
  for (const k of Object.keys(T1)) F['1e:' + k] = T1[k];
  tracks2a().forEach((t, i) => { F['2a:' + i] = t; });
  tracks2b().forEach((t, i) => { F['2b:' + i] = t; });
  return F;
}
const PROJECT = t => ({ bpm: 120, perf: { wheel: { v: 1 } }, tracks: [t] });
const PROBES = ['a.level', 'f.cutoff', 'g.amp', 'f.routeA', 'a.fbal', 'e1.att', 'fx.rev.mix', 'bus1', 'g.master', 'nope'];
function probes(t) {
  const out = [];
  for (const k of Object.keys(t.dev)) {
    const d = t.dev[k], m = d.kind === 'synth' ? MODELS.find(x => x.id === d.model) : null;
    const ids = m ? m.controls.map(c => c.id).concat(m.custom ? PROBES : ['nope']) : PROBES.slice(-4);
    for (const id of ids) { const r = destOk(d, id); out.push([k, id, r.ok, r.why, r.stage]); if (!r.ok) { const q = destOk(d, id, true); out.push([k, id, 'keep', q.ok, q.why]); } }
  }
  return out;
}
export function g1() {
  const F = fixtures(), R = {};
  for (const key of Object.keys(F)) {
    const t = F[key], P = PROJECT(t);
    R[key] = {
      track: H(G.compileTrack(t)), graph: H(G.compileGraph(t)), mods: H(G.compileMods(t, P, {})),
      cables: H(CB.cablesOf(t, { project: P, presetRows: true })), messages: H(messages(clone(t))), destOk: H(probes(t)),
    };
  }
  return R;
}

/* ---------------------------------------------------------------- G12: the canvas sessions on wk-dom */
function html(n) {
  if (n.nodeType === 3) return n.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let s = '<' + n.localName;
  for (const [k, v] of n._a) s += ' ' + k + '="' + String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"';
  const st = Object.keys(n.style).filter(k => typeof n.style[k] !== 'function' && n.style[k] !== undefined);
  if (st.length) s += ' style="' + st.map(k => k + ':' + n.style[k]).join(';') + '"';
  s += '>';
  for (const c of n.childNodes) s += html(c);
  return s + '</' + n.localName + '>';
}
// deterministic world positions for the canvas's jacks and knob ends: the mounted devices' jacks ('i1.out', 'fx1.in', 'i1/fx.in',
// 'l1.out', 'm1.k3', 'pd1.notes', 'wheel.out') and the rows' knob ends ('i1:f.cutoff'); a part's jack ('i1/lfo1.out') has no port
// while the Serum is whole (nothing mounted: the host's ports() lists none) — the row stays hidden, as on the page
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
function portsOf(t, records, o = {}) {
  const P = new Map();
  for (const r of records) for (const j of [r.a, r.b]) {
    if (typeof j !== 'string' || P.has(j)) continue;
    if (/^[a-z][a-z0-9]*\/(?!fx\.)[a-zA-Z0-9]+\./.test(j)) continue; // (a part's jack: unmounted)
    const h = hash(j), p = { x: 96 + (h % 13) * 112, y: 64 + ((h >>> 8) % 9) * 88 };
    if (o.hid && o.hid.has(j)) Object.assign(p, { hid: true, tag: o.hid.get(j) });
    P.set(j, p);
  }
  return P;
}
const ROW = { amt: 0.4, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 };
const row = (id, src, dst, o) => Object.assign({ id, src, dst }, ROW, o);
const mod = (kind, o) => normModDev(Object.assign({ kind }, o));
function junoSession() {
  const t = classicTrack('juno60');
  Object.assign(t.dev, { l1: mod('lfo', { lfo: { mono: 1 } }), e1: mod('env', { att: 0.3 }), m1: mod('macro', { v: [0.5, 0, 0, 0, 0, 0, 0, 0] }), ve: { kind: 'velo' }, nt: { kind: 'note' } });
  t.nid = 2; t.mid = 7;
  t.mods = [row('r1', 'l1.out', 'i1:cf'), row('r2', 'e1.out', 'i1:a', { amt: 0.25 }), row('r3', 'm1.k1', 'fx1:fx.rev.mix', { amt: -0.3 }), row('r4', 've.out', 'i1:lv', { bi: 1 }),
    row('r5', 'nt.out', 'i1:rs', { byp: 1 }), row('r6', 'wheel', 'i1:cf', { amt: 0.2 })];
  C.newInstance(t.dev.fx1.fx, 'rev', { rack: 0 });
  return { t, opts: { project: { perf: { wheel: { v: 1 } }, tracks: [t] }, presetRows: true, dashed: r => r.id === 'r2' } };
}
function serumSession() {
  const [, t2] = tracks2b(), t = t2; // Serum i1 + Juno i2 + fx1: every row kind, a native own row, the Serum's own-FX cable
  t.dev.i1.vals.s.matrix[0] = C.normRow({ src: 'wheel', amt: 0.3, dst: 'f.res' }); // (a preset wheel row: the "preset" tag)
  t.dev.i1.vals.s.matrix[1] = C.normRow({ src: 'velo', amt: 0.2, dst: 'a.level' });
  t.dev.ve = { kind: 'velo' };
  t.mods.push(row('r12', 'l1.out', 'i1:c.fine', { amt: 0.1 })); // (a hidden knob end: the tagged badge at VOICE's corner)
  return { t, opts: { project: { perf: { wheel: { v: 1 } }, tracks: [t] }, presetRows: true, dashed: r => r.id === 'r2' }, hid: new Map([['i1:c.fine', 'OSC C · FINE · hidden']]) };
}
function fadeSession() {
  const t = serumTrack('fade', C.normalizeSerum(C.defaultSerum()), C.defaultFx2());
  t.dev.l1 = mod('lfo', { lfo: { mono: 1 } }); t.dev.l2 = mod('lfo', { lfo: { mono: 1 } });
  const ids = ['a.level', 'a.pan', 'a.wt', 'a.fine', 'a.semi', 'a.oct', 'a.uni', 'a.det', 'a.blend', 'a.phase', 'a.rand', 'a.w1', 'a.w2'];
  t.mods = ids.flatMap((id, i) => [row('r' + (2 * i + 1), 'l1.out', 'i1:' + id, { amt: 0.1 * (i % 5) + 0.05 }), row('r' + (2 * i + 2), 'l2.out', 'i1:' + id, { amt: -0.2 })]);
  t.mid = t.mods.length + 1;
  return { t, opts: { project: { perf: { wheel: null }, tracks: [t] }, presetRows: true } };
}
function drumSession() {
  const t = classicTrack('tr808', { drum: normDrum({}, 'tr808') });
  t.id = 'trk_d';
  const pads = new Array(64).fill(null);
  pads[0] = { t: [{ tr: 'trk_d', k: 'drum', s: 'bd' }], c: 0 }; pads[1] = { t: [{ tr: 'trk_d', k: 'drum', s: 'sd' }], c: 1 };
  pads[8] = { t: [{ tr: 'trk_d', k: 'note', n: 36 }], c: 11 }; pads[9] = { t: [{ tr: 'trk_d', k: 'drum', s: 'ch' }], c: 7 };
  const M = newModule('pd1', { rows: 2, cols: 2, pads });
  t.dev.l1 = mod('lfo', { lfo: { mono: 1 } });
  t.mods = [row('r1', 'l1.out', 'i1:bdd'), row('r2', 'pd1.p0', 'i1:bdl', { amt: 0.3 })];
  t.mid = 3;
  return { t, opts: { project: { perf: { wheel: null }, pads: [M], tracks: [t] }, presetRows: true } };
}
function moogSession() {
  const x = MG.model15(), t = classicTrack('m900', { vals: x.vals, patch: x.rec });
  return { t, opts: { project: { perf: { wheel: null }, tracks: [t] }, presetRows: true } };
}
export const SESSIONS = { juno: junoSession, serum: serumSession, fade: fadeSession, drums: drumSession, moog: moogSession };
const BIG = 64 * 1024;
function session(make) {
  const { t, opts, hid } = make(), doc = fresh(), W = doc.createElement('div');
  doc.body.append(W);
  let K = 1;
  const hints = [], L = CB.createCables(W, { doc, k: () => K, onHint: h => hints.push(h), onSelect() {}, onAction() {}, menu: () => [] });
  const recs = CB.cablesOf(t, opts), ports = portsOf(t, recs, { hid }), steps = [];
  const snap = step => { const s = html(W); steps.push(s.length > BIG ? { step, sha: sha(s), bytes: s.length } : { step, html: s }); };
  const ed = recs.filter(c => !c.readonly && c.kind !== 'note' && !c.tap).map(c => c.id), mods = recs.filter(c => c.kind === 'mod').map(c => c.id);
  L.set(recs); L.layout(ports); snap('set');
  if (ed.length) { L.select(ed[0]); snap('select'); }
  L.highlight(ed.slice(0, 2)); snap('highlight');
  L.setModsVisible('select'); snap('mods-select');
  L.setModsVisible('never'); snap('mods-never');
  L.setModsVisible('always'); L.highlight(null); L.select(null); snap('mods-always');
  K = 0.5; L.rezoom(); snap('zoom-0.5');
  K = 2; L.rezoom(); snap('zoom-2');
  K = 1; L.rezoom(); snap('zoom-1');
  L.live({ x1: 100, y1: 100, x2: 500, y2: 300, mod: true, snap: true, color: '#ff7f5a' }); snap('live');
  L.live(null); snap('live-off');
  if (mods.length) { L.set(recs.filter(c => c.id !== mods[0])); snap('remove-mod'); }
  if (ed.length) { L.set(recs.filter(c => c.id !== ed[0])); snap('remove-first'); }
  L.set(recs); snap('restore');
  if (mods.length) { L.set(recs.map(c => (c.id === mods[0] ? Object.assign({}, c, { byp: true }) : c))); snap('bypass'); L.set(recs); }
  const moved = new Map(ports); const k0 = [...moved.keys()][0]; const p0 = moved.get(k0); moved.set(k0, Object.assign({}, p0, { x: p0.x + 300, y: p0.y + 40 }));
  L.layout(moved); snap('move');
  L.layout(ports); snap('move-back');
  const out = { records: recs.map(c => c.id), ports: [...ports].map(([k, p]) => [k, p.x, p.y, p.hid ? p.tag : null]), hints, steps, list: H(L.list()), box: L.box() };
  L.destroy();
  return out;
}
export function g12() { const R = {}; for (const k of Object.keys(SESSIONS)) R[k] = session(SESSIONS[k]); return R; }

/* ---------------------------------------------------------------- the record */
export function record() { return { about: 'IMPL-WC G1 / G12 base record — tests/ref-WC/record.mjs', g1: g1(), g12: g12() }; }
// every leaf path whose value differs (base vs now)
export function diff(a, b, path = '', out = []) {
  if (a === b) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], path ? path + '.' + k : k, out);
    return out;
  }
  out.push(path);
  return out;
}
if (process.argv[1] && /record\.mjs$/.test(process.argv[1])) {
  const now = record(), write = process.argv.includes('--write');
  if (write) {
    writeFileSync(OUT, JSON.stringify(now, null, 0) + '\n');
    const n1 = Object.keys(now.g1).length, n12 = Object.values(now.g12).reduce((a, s) => a + s.steps.length, 0);
    console.log(`tests/ref-WC/base.json written: ${n1} G1 fixtures × 6 hashes, ${Object.keys(now.g12).length} G12 sessions / ${n12} steps`);
  } else {
    const was = JSON.parse(readFileSync(OUT, 'utf8')), d = diff(was, now).filter(p => p !== 'about');
    if (d.length) { console.log('ref-WC: ' + d.length + ' difference(s) from base.json:\n  ' + d.slice(0, 60).join('\n  ') + (d.length > 60 ? '\n  …' : '')); process.exit(1); }
    console.log('ref-WC: the record matches base.json (' + Object.keys(now.g1).length + ' fixtures, ' + Object.keys(now.g12).length + ' sessions)');
  }
}
