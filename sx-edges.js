// sx-edges.js — a Serum's internal cables as views of its state (IMPL-3 §2.5, milestone 3 lane C). Pure ES module: no DOM,
// nothing at module top level but tables (node-tested: tests/jackrules.test.mjs). It replaces cv-cables' pasted STRIPS /
// routeOf; the MIX page (sx-ui-mix routeOf / channelStrips / routeMenuItems) and serum-core (filterFeeds, toggleFilterRoute,
// the normaliser's F1 / F2 loop rule) stay as they are — jackrules proves this module agrees with each of them.
//
// Parts (IMPL-3 §2.1): serum-core MODULE_FIELDS names + 'macros' — oscA oscB oscC sub noise filter filter2 env2 env3 env4
// lfo1 … lfo10 macros arp clip. VOICE is the device key 'iN' itself; the own FX stays 'iN/fx'. An END is '<part>.<port>'
// relative to one Serum (dev-free): sources '<src>.out'; filters '<f>.in' / '<f>.out'; VOICE 'voice.main' / 'voice.direct' /
// 'voice.note' / 'voice.out' / 'voice.env1'; the own FX 'fx.in'; ARP / CLIP '<part>.out' (notes); an oscillator's read-only
// warp / FM / RM / pitch input '<osc>.warp'. jackOf(dev, end) ↔ endOf(dev, jack) map them to canvas jacks ('i1/oscA.out',
// 'i1.main', 'i1/fx.in').
//
//   serumEdges(s, fx)        [{ id, a, b, kind, src?, share?, fork?, stub?, ro?, dim?, env?, field?, what?, label? }] the
//                            Serum's internal cables: kind 'audio' (sources → filters / VOICE, filter → filter / VOICE), 'note'
//                            (ARP / CLIP → VOICE note), 'fx' (VOICE → own FX, read-only, the route label), 'warp' (a source
//                            read by an oscillator's warp slot or ratio pitch: read-only, dotted). A source routed to Filter
//                            that feeds none: a stub (b null, label STUB_LABEL); feeding both: a fork (fork, share each)
//   setEdge(s, fx, a, b)     { edit(s, fx) | null, why, f: [[path, before, after] …] } — the field writes that make the cable
//                            a → b (one output per source: a new cable replaces the old; a second filter cable forks, fbal ½);
//                            edit applies f's after-values in place; null with the refusal (WHY) or 'Already connected'
//   cutEdge(s, fx, a, b)     the same for Disconnect (a fork's branch: the balance all to the other filter; else route None)
//   firstFree(s, kind, skip) the first free slot of a kind (osc / sub / noise / filter: x.on < 0.5, lowest letter; env / lfo: not
//                            in use; macros / arp / clip: themselves) not in `skip`; null when full
//   partKeys(s, lay, dev, used)  the parts that get a module (I1: a power field on; I2: an own ENV 2–4 / LFO slot read by a
//                            matrix row (src or aux; a point-modulation bus's rows are matrix rows), or by `used` — link rows
//                            '<dev>/lfo3.out' or slot names; MACROS when a macro row exists; ARP / CLIP when on; any part
//                            with a lay entry '<dev>/<part>' stays). Shaped slots nothing reads get none
//   slotsUsed(s, used)       Set of the env / lfo slots and 'macros' something reads (matrix rows with a destination)
//   partOn(s, part), powerOf(part), partLabel(part), splitKey(key) → { dev, part } | null, routeLabel(s, fx)
import { WARPS2, lawValue, destBase, filterFeeds } from './serum-core.js?v=9';

/** The parts in module order (IMPL-3 §2.1). */
export const PARTS = Object.freeze(['oscA', 'oscB', 'oscC', 'sub', 'noise', 'filter', 'filter2', 'env2', 'env3', 'env4',
  ...Array.from({ length: 10 }, (_, l) => 'lfo' + (l + 1)), 'macros', 'arp', 'clip']);
/** The audio sources, the filters (in serum-core channel order: A B C, then SUB and NOISE in the tray's order). */
export const SRC_PARTS = Object.freeze(['oscA', 'oscB', 'oscC', 'sub', 'noise']), FILTERS = Object.freeze(['filter', 'filter2']);
/** A part's power destination (the bar ⏻ = the panel's own toggle, `data-dest` = this id); parts without one: none. */
export const POWER = Object.freeze({ oscA: 'a.on', oscB: 'b.on', oscC: 'c.on', sub: 's.on', noise: 'n.on', filter: 'f.on', filter2: 'f2.on', arp: 'arp.on', clip: 'clip.on' });
const LABEL = Object.freeze({ oscA: 'OSC A', oscB: 'OSC B', oscC: 'OSC C', sub: 'SUB', noise: 'NOISE', filter: 'FILTER 1', filter2: 'FILTER 2',
  env2: 'ENV 2', env3: 'ENV 3', env4: 'ENV 4', macros: 'MACROS', arp: 'ARP', clip: 'CLIP', voice: 'VOICE', fx: 'FX' });
/** The filters' input switches S A B C N (`f.route<X>` / `f2.route<X>`): plain switches, shown and edited as cables only —
 * never modulation destinations (cv-mods plainSwitch / destOk). */
export const SWITCHES = Object.freeze(['A', 'B', 'C', 'N', 'S'].flatMap(X => ['f.route' + X, 'f2.route' + X]));
/** The tag of a source routed to Filter that no filter takes. */
export const STUB_LABEL = '→ Filter (off)';
/** The refusals (the cable drag's reasons; the host shows them as the notice). */
export const WHY = Object.freeze({
  voice: 'Serum sources play through their VOICE', ro: 'Set this in the oscillator’s warp menu', fx: 'Edited in VOICE’s outputs',
  self: 'A filter cannot feed itself', dir: 'Connect an output to an input', note: 'Only ARP and CLIP play notes into VOICE',
  notes: 'ARP and CLIP play notes into VOICE', same: 'Already connected', none: 'Not connected', bad: 'Not a cable of this Serum',
});

const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const fin = x => typeof x === 'number' && isFinite(x);
const arr = x => (Array.isArray(x) ? x : []);
// a source part: its serum-core channel letter, s.p prefix, structured path, missing-route default (sx-ui-mix routeOf)
const SRC = Object.freeze({
  oscA: { ch: 'A', p: 'a', path: ['osc', 0], dflt: 0 }, oscB: { ch: 'B', p: 'b', path: ['osc', 1], dflt: 1 }, oscC: { ch: 'C', p: 'c', path: ['osc', 2], dflt: 1 },
  sub: { ch: 'S', p: 's', path: ['sub'], dflt: 1 }, noise: { ch: 'N', p: 'n', path: ['noise'], dflt: 1 },
});
const FK = Object.freeze({ filter: { k: 0, p: 'f', path: ['filter', 0] }, filter2: { k: 1, p: 'f2', path: ['filter', 1] } });
const OSC = ['oscA', 'oscB', 'oscC'], OTHER = [['oscB', 'oscC'], ['oscA', 'oscC'], ['oscA', 'oscB']];
const at = (s, path) => { let o = s; for (const k of path) { if (o == null || typeof o !== 'object') return undefined; o = o[k]; } return o; };
// a source / filter route 0…3 (sources 0 Filter · 1 Main · 2 Direct · 3 None; filters 0 the other filter · …): sx-ui-mix routeOf
const routeOf = (o, dflt) => (isObj(o) && fin(o.route) ? Math.max(0, Math.min(3, Math.round(o.route))) : dflt);
const envOf = o => (isObj(o) && o.env !== undefined ? (o.env ? 1 : 0) : 1);
const base = (s, id) => destBase(s, null, id);
/** A part's power is on (≥ 0.5; a part without a power field: true). */
export function partOn(s, part) { const id = POWER[part]; return !id || (isObj(s) && base(s, id) >= 0.5); }
export const powerOf = part => POWER[part] || null;
/** 'OSC B', 'FILTER 2', 'LFO 3', 'ENV 2', 'MACROS', 'VOICE' … */
export function partLabel(part) { const m = /^lfo(\d+)$/.exec(part || ''); return m ? 'LFO ' + m[1] : LABEL[part] || String(part || ''); }
/** A part module key → { dev, part } ('i2/oscB' → { dev: 'i2', part: 'oscB' }; the own FX 'i2/fx' and anything else: null). */
export function splitKey(key) {
  const m = typeof key === 'string' ? /^([a-z][a-z0-9]{0,15})\/([a-z][a-zA-Z0-9]{0,15})$/.exec(key) : null;
  return m && PARTS.includes(m[2]) ? { dev: m[1], part: m[2] } : null;
}
// filter k's share of source `part` (serum-core shareOf: s1 = (1 − b) / 2, s2 = (1 + b) / 2 of the balance law, base values)
function shareOf(s, part, k) { const b = lawValue(SRC[part].p + '.fbal', base(s, SRC[part].p + '.fbal')); return k ? (1 + b) / 2 : (1 - b) / 2; }
// an END '<part>.<port>' → { part, port } (VOICE 'voice', the own FX 'fx'); null for anything else
const PORTS = { voice: ['main', 'direct', 'note', 'out', 'env1'], fx: ['in'] };
function parse(end) {
  const m = typeof end === 'string' ? /^([a-z][a-zA-Z0-9]*)\.([a-z][a-z0-9]*)$/.exec(end) : null;
  if (!m) return null;
  const [, part, port] = m;
  const ok = PORTS[part] ? PORTS[part].includes(port) : SRC[part] ? port === 'out' || (OSC.includes(part) && port === 'warp')
    : FK[part] ? port === 'in' || port === 'out' : part === 'arp' || part === 'clip' ? port === 'out' : false;
  return ok ? { part, port } : null;
}
/** A canvas jack of Serum `dev` for an END: 'voice.main' → 'i1.main', 'fx.in' → 'i1/fx.in', 'oscA.out' → 'i1/oscA.out'. */
export function jackOf(dev, end) {
  const E = parse(end);
  if (!E || typeof dev !== 'string') return null;
  return E.part === 'voice' ? dev + '.' + E.port : dev + '/' + E.part + '.' + E.port;
}
/** The END of a canvas jack of Serum `dev` (null: not one of its internal ends). */
export function endOf(dev, jack) {
  if (typeof jack !== 'string' || typeof dev !== 'string') return null;
  const e = jack.startsWith(dev + '/') ? jack.slice(dev.length + 1) : jack.startsWith(dev + '.') ? 'voice' + jack.slice(dev.length) : null;
  return e && parse(e) ? e : null;
}

/* ---------------------------------------------------------------- the cables of a state */
const warpIdx = n => (fin(n) ? Math.max(0, Math.min(81, Math.round(81 * n))) : 0);
const isWarpFromOther = n => { const m = Math.round(22 * n); return m >= 18 && m <= 20; };
const s1Of = s => { const g = isObj(s.global) ? s.global : null; return !g || g.s1 === undefined ? true : !!(fin(+g.s1) && +g.s1 >= 0.5); };
const oscType = (s, o) => { const O = arr(s.osc)[o]; return isObj(O) && typeof O.type === 'string' ? O.type : 'wt'; };
// the part a warp mode reads (serum-core WARP_SRC / OTHER_OSC, and the Noise / Sub / Filter sources of FM / PD / AM / RM)
function warpSrc(o, id) {
  const m = /_(o1|o2|noise|sub|f1|f2)$/.exec(id);
  if (!m) return null;
  return m[1] === 'o1' ? OTHER[o][0] : m[1] === 'o2' ? OTHER[o][1] : { noise: 'noise', sub: 'sub', f1: 'filter', f2: 'filter2' }[m[1]];
}
function edge(o) { o.id = o.a + '>' + (o.b || '') + (o.field ? '#' + o.field : ''); return o; }
export function serumEdges(s, fx) {
  if (!isObj(s)) return [];
  const out = [];
  for (const part of SRC_PARTS) {
    const S = SRC[part], X = at(s, S.path), r = routeOf(X, S.dflt), dim = !partOn(s, part), a = part + '.out';
    const mk = o => { if (dim) o.dim = true; out.push(edge(Object.assign({ a, kind: 'audio', src: part }, o))); };
    if (r === 0) {
      const lit = [0, 1].filter(k => filterFeeds(s, k, S.ch));
      if (!lit.length) mk({ b: null, stub: true, label: STUB_LABEL });
      for (const k of lit) mk(Object.assign({ b: FILTERS[k] + '.in', share: shareOf(s, part, k) }, lit.length === 2 ? { fork: true } : null));
    } else if (r === 1 || r === 2) mk({ b: r === 1 ? 'voice.main' : 'voice.direct', env: envOf(X) });
  }
  // filter → filter / VOICE; both 'the other filter' (a state the normaliser never leaves): F1 → F2 and F2 → Main, as the DSP
  const F = arr(s.filter), fr = [routeOf(F[0], 1), routeOf(F[1], 1)];
  if (fr[0] === 0 && fr[1] === 0) fr[1] = 1;
  FILTERS.forEach((part, k) => {
    const r = fr[k], o = { a: part + '.out', kind: 'audio', src: part };
    if (!partOn(s, part)) o.dim = true;
    if (r === 0) out.push(edge(Object.assign(o, { b: FILTERS[1 - k] + '.in' })));
    else if (r === 1 || r === 2) out.push(edge(Object.assign(o, { b: r === 1 ? 'voice.main' : 'voice.direct', env: envOf(F[k]) })));
  });
  for (const part of ['arp', 'clip']) if (partOn(s, part)) out.push(edge({ a: part + '.out', b: 'voice.note', kind: 'note', src: part }));
  const lab = routeLabel(s, fx), fxo = { a: 'voice.out', b: 'fx.in', kind: 'fx', ro: true };
  if (lab) fxo.label = lab;
  out.push(edge(fxo));
  // the read-only warp / FM / RM / PD / AM / pitch sources (dotted; a tap opens the warp or pitch menu, which refuses cycles)
  const P = isObj(s.p) ? s.p : {}, s1 = s1Of(s);
  OSC.forEach((osc, o) => {
    const k = 'abc'.charAt(o), type = oscType(s, o);
    for (let slot = 0; slot < 2; slot++) {
      let src = null, what = '', field = k + '.w' + (slot + 1);
      if (s1 && o < 2 && slot === 0) { // (S1 mode: slot 1 of A / B is the v1 warp, modes 18–20 read the other of A / B)
        if (fin(P[k + '.warpMode']) && isWarpFromOther(P[k + '.warpMode'])) { src = o === 0 ? 'oscB' : 'oscA'; what = 'Warp'; field = k + '.warpMode'; }
      } else {
        const W = WARPS2[warpIdx(P[field])];
        if (W && (W.avail !== 'Sp' || type === 'spec')) { src = warpSrc(o, W.id); what = W.nameO ? W.nameO[o] : W.name; }
      }
      if (src) { const e = { a: src + '.out', b: osc + '.warp', kind: 'warp', ro: true, src, field, what }; if (!partOn(s, src)) e.dim = true; out.push(edge(e)); }
    }
    const O = arr(s.osc)[o], pi = isObj(O) && isObj(O.pitch) ? O.pitch : null, ps = pi && pi.mode === 'ratio' && /^[ABC]$/.test(pi.src) ? 'osc' + pi.src : null;
    if (ps && ps !== osc) { const e = { a: ps + '.out', b: osc + '.warp', kind: 'warp', ro: true, src: ps, field: 'pitch', what: 'Pitch' }; if (!partOn(s, ps)) e.dim = true; out.push(edge(e)); }
  });
  return out;
}

/* ---------------------------------------------------------------- editing */
const no = why => ({ edit: null, why, f: [] });
// the field writes [[path, before, after] …] (the History step's meta, §2.5) and the in-place edit applying the after-values
// (a missing route reads as sx-ui-mix's default: OSC A Filter, the rest Main)
const cur = (s, path) => (path[0] === 'p' ? base(s, path[1]) : path[path.length - 1] === 'route'
  ? routeOf(at(s, path.slice(0, -1)), path[0] === 'osc' && path[1] === 0 ? 0 : 1) : at(s, path));
function writes(s, list) {
  const f = [];
  for (const [path, after] of list) {
    const before = cur(s, path);
    if (before !== after && !f.some(x => x[0].join('.') === path.join('.'))) f.push([path, before, after]);
  }
  if (!f.length) return no(WHY.same);
  const edit = t => {
    if (!isObj(t)) return false;
    for (const [path, , after] of f) {
      let o = t;
      for (let i = 0; i < path.length - 1; i++) { if (o[path[i]] == null || typeof o[path[i]] !== 'object') o[path[i]] = {}; o = o[path[i]]; }
      o[path[path.length - 1]] = after;
    }
    return true;
  };
  return { edit, why: '', f };
}
const sw = (k, ch) => ['p', (k ? 'f2.route' : 'f.route') + ch];
const fbal = part => ['p', SRC[part].p + '.fbal'];
const rte = path => path.concat('route');
// a read-only cable's refusal ('' for an editable pair): the warp sources (the oscillator's menu), VOICE → its own FX (VOICE's
// outputs); anything into the own FX from a source or a filter plays through VOICE, a note tool's notes go to VOICE
function readOnly(A, B) {
  if (A.port === 'warp' || B.port === 'warp') return WHY.ro;
  if (A.part === 'voice') return WHY.fx;
  if (B.part === 'fx') return A.part === 'arp' || A.part === 'clip' ? WHY.notes : WHY.voice;
  return '';
}
/** The writes that make the cable a → b (ENDs of one Serum). @returns {{edit: ((s: object, fx?: object) => boolean) | null, why: string, f: Array}} */
export function setEdge(s, fx, a, b) {
  const A = parse(a), B = parse(b);
  if (!isObj(s)) return no(WHY.bad);
  if (!A) return no(WHY.bad);
  if (!B) return no(SRC[A.part] ? WHY.voice : A.part === 'arp' || A.part === 'clip' ? WHY.notes : WHY.bad);
  const ro = readOnly(A, B);
  if (ro) return no(ro);
  if (A.port !== 'out' || !(B.port === 'in' || (B.part === 'voice' && B.port !== 'out' && B.port !== 'env1'))) return no(WHY.dir);
  if (A.part === 'arp' || A.part === 'clip') return B.part === 'voice' && B.port === 'note' ? writes(s, [[['p', POWER[A.part]], 1]]) : no(WHY.notes);
  if (B.part === 'voice' && B.port === 'note') return no(WHY.note);
  if (SRC[A.part]) {
    const S = SRC[A.part], r = routeOf(at(s, S.path), S.dflt);
    if (B.part === 'voice') return writes(s, [[rte(S.path), B.port === 'main' ? 1 : 2]]);
    if (!FK[B.part]) return no(WHY.voice);
    const k = FK[B.part].k, lit = [0, 1].filter(j => filterFeeds(s, j, S.ch));
    if (r === 0 && lit.includes(k)) return no(WHY.same);
    // feeding the other filter: a fork (balance ½, both switches on); off-route or a stub: to this filter alone
    // (toggleFilterRoute's off-route branch: route Filter, the balance fully at filter k, its switch on)
    if (r === 0 && lit.length) return writes(s, [[fbal(A.part), 0.5], [sw(k, S.ch), 1], [sw(1 - k, S.ch), 1]]);
    return writes(s, [[rte(S.path), 0], [fbal(A.part), k], [sw(k, S.ch), 1]]);
  }
  if (FK[A.part]) {
    const F = FK[A.part];
    if (B.part === 'voice') return writes(s, [[rte(F.path), B.port === 'main' ? 1 : 2]]);
    if (!FK[B.part]) return no(WHY.voice);
    if (B.part === A.part) return no(WHY.self);
    // one direction, the most recent wins: the other filter, if it fed this one, goes to Main (the normaliser's loop rule)
    const O = FK[B.part], fr = arr(s.filter);
    if (routeOf(fr[F.k], 1) === 0 && routeOf(fr[O.k], 1) !== 0) return no(WHY.same);
    const L = [[rte(F.path), 0]];
    if (routeOf(fr[O.k], 1) === 0) L.push([rte(O.path), 1]);
    return writes(s, L);
  }
  return no(WHY.bad);
}
/** The writes of Disconnect on the cable a → b (b null: a source's stub). */
export function cutEdge(s, fx, a, b) {
  if (!isObj(s)) return no(WHY.bad);
  const A = parse(a), B = b == null ? null : parse(b);
  if (!A || (b != null && !B)) return no(WHY.bad);
  if (B) { const ro = readOnly(A, B); if (ro) return no(ro); }
  const has = serumEdges(s, fx).some(e => e.a === a && (b == null ? e.stub : e.b === b));
  if (!has) return no(WHY.none);
  if (A.part === 'arp' || A.part === 'clip') return writes(s, [[['p', POWER[A.part]], 0]]);
  if (SRC[A.part]) {
    const S = SRC[A.part];
    if (B && FK[B.part]) {
      const k = FK[B.part].k, lit = [0, 1].filter(j => filterFeeds(s, j, S.ch));
      if (lit.length === 2) return writes(s, [[fbal(A.part), 1 - k]]); // (a fork's branch: everything to the other filter)
    }
    return writes(s, [[rte(S.path), 3]]);
  }
  if (FK[A.part]) return writes(s, [[rte(FK[A.part].path), 3]]);
  return no(WHY.bad);
}

/* ---------------------------------------------------------------- parts and slots */
const KIND_OF = { osc: OSC, sub: ['sub'], noise: ['noise'], filter: FILTERS, env: ['env2', 'env3', 'env4'],
  lfo: Array.from({ length: 10 }, (_, l) => 'lfo' + (l + 1)), macros: ['macros'], arp: ['arp'], clip: ['clip'] };
/** A part's kind: 'oscB' → 'osc', 'filter2' → 'filter', 'lfo7' → 'lfo', 'env3' → 'env'; null for anything else. */
export function kindOf(part) { for (const k of Object.keys(KIND_OF)) if (KIND_OF[k].includes(part)) return k; return null; }
const SLOT = /(?:^|\/)(lfo(?:10|[1-9])|env[2-4])(?:y)?(?:\.out)?$/;
/** The env / lfo slots (and 'macros') something reads: s.matrix rows' src / aux (bypassed too; 'lfo3y' is LFO 3) — rows with a
 * destination only: one without (Serum's matrix keeps such a row) modulates nothing, so it neither gives a module (I2) nor
 * keeps a slot from being free or removable (review 1 F4; main's Remove counts by the same rule) —, plus `used` — slot names
 * or link-row sources ('i1/lfo3.out'). */
export function slotsUsed(s, used) {
  const U = new Set();
  for (const r of isObj(s) ? arr(s.matrix) : []) {
    if (!isObj(r) || !r.dst) continue;
    for (const x of [r.src, r.aux]) {
      if (typeof x !== 'string' || !x) continue;
      if (/^macro[1-8]$/.test(x)) U.add('macros');
      const m = /^(lfo(?:10|[1-9])|env[2-4])y?$/.exec(x);
      if (m) U.add(m[1]);
    }
  }
  for (const x of used == null ? [] : typeof used === 'string' ? [used] : used) {
    if (x === 'macros') { U.add(x); continue; }
    const m = typeof x === 'string' ? SLOT.exec(x) : null;
    if (m) U.add(m[1]);
  }
  return U;
}
/** The first free slot of `kind` (or of a part's kind) not in `skip`; null when the kind is full. */
export function firstFree(s, kind, skip) {
  const K = KIND_OF[kind] ? kind : kindOf(kind), L = K ? KIND_OF[K] : null;
  if (!L) return null;
  const S = new Set(skip == null ? [] : typeof skip === 'string' ? [skip] : skip);
  const U = K === 'env' || K === 'lfo' ? slotsUsed(s) : null;
  for (const part of L) {
    if (S.has(part)) continue;
    if (POWER[part] && K !== 'arp' && K !== 'clip' ? !partOn(s, part) : U ? !U.has(part) : true) return part;
  }
  return null;
}
const okEntry = e => isObj(e) && fin(e.x) && fin(e.y);
/** The parts of Serum `dev` that get a module (I1 / I2; a laid-out part stays, dimmed when off), in PARTS order. */
export function partKeys(s, lay, dev, used) {
  const U = slotsUsed(s, used), L = isObj(lay) ? lay : {}, out = [];
  for (const part of PARTS) {
    const laid = typeof dev === 'string' && okEntry(L[dev + '/' + part]);
    const want = laid || (POWER[part] ? partOn(s, part) : U.has(part));
    if (want) out.push(part);
  }
  return out;
}

/* ---------------------------------------------------------------- the own-FX route label (moved from cv-cables) */
// sources, then filters: [s.p prefix, the object, the missing-route default] (sx-ui-mix routeOf)
const STRIPS = [['a', s => arr(s.osc)[0], 0], ['b', s => arr(s.osc)[1], 1], ['c', s => arr(s.osc)[2], 1], ['s', s => s.sub, 1], ['n', s => s.noise, 1],
  ['f', s => arr(s.filter)[0], 1], ['f2', s => arr(s.filter)[1], 1]];
/** A Serum's own-FX route label: its non-empty racks and Direct, e.g. 'Main · Bus 1 · Direct' ('' for a classic track).
 * Direct: a powered source or filter routed Direct, or a non-empty bus routed Direct. @returns {string} */
export function routeLabel(s, fx) {
  if (!isObj(s)) return '';
  const racks = isObj(fx) && fx.v >= 2 && Array.isArray(fx.racks) ? fx.racks : [];
  const full = k => isObj(racks[k]) && Array.isArray(racks[k].mods) && racks[k].mods.length > 0;
  let direct = false;
  for (const [P, get, dflt] of STRIPS) if (base(s, P + '.on') >= 0.5 && routeOf(get(s), dflt) === 2) { direct = true; break; }
  for (const k of [1, 2]) if (full(k) && fin(racks[k].route) && Math.round(racks[k].route) === 1) direct = true;
  const out = [];
  ['Main', 'Bus 1', 'Bus 2'].forEach((n, k) => { if (full(k)) out.push(n); });
  if (direct) out.push('Direct');
  return out.join(' · ');
}
