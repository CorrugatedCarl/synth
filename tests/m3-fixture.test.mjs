import './v8-guard.mjs';
// Milestone 3's fixture check (docs/canvas/IMPL-3.md §6 "Order", run by the lead after the A → E → C → B merges): one Serum-engine
// state taken apart — a host (sx-host createHost) with a face per part I1 / I2 give (sx-edges partKeys) and the Amplifier (VOICE),
// mounted as main.js sxViews mounts a rig's (rig-ui faces; the Arpeggiator / Clip sequencer their sx-ui-mod view) — against the REAL
// compile (models.js patchFor through the golden harness's trackPatch, the function main.js's buildPatch uses; cv-graph compileMods /
// instPatch for the canvas modulators) and the golden harness's worklet (engine.js Track, the current DSP scripts). The host object
// here stands in for main.js sxHost (state / edit / fx / editFx; an edit mutates the live state, the compile reads it), and a canvas
// cable edit is applied as §2.5 says D applies it — sx-edges setEdge / cutEdge on the live state, its edit through the host
// (SerumHost.edit → host.edit, main's sxEdit).
//   1. Routing: each internal cable edit renders the bytes of the same fields set through the modules' own controls on their faces
//      where a face has one (an oscillator's BALANCE in its drawer, the filters' input switches, the Amplifier's bus routes and FX
//      bypass in its drawer; a route is a cord on a rig — no ROUTE control) and through a direct state write: OSC B → FILTER 2, a
//      fork (BALANCE, also re-balanced), cuts (a fork's branch, a source, a filter), NOISE → FILTER 2, SUB → DIRECT / FILTER 1,
//      FILTER → FILTER (and the loop rule), FX in / out (VOICE → own FX read-only, a source to DIRECT, the Amplifier's outputs).
//      States compared without s.ui (a page shown is a view edit), patches canonically (keys sorted, typed arrays by value), renders
//      bit for bit (Float32 words), each against the unedited render too (the edit is audible).
//      (SX0, lane K) The legs on the bundled panel (its MIX page, its OSC page's switches) and on the stage-3 part views left with them;
//      where a face holds the same control (the donors re-parented: rig-ui) the leg drives it; the MIX page's route menus and the
//      parts' ROUTE popovers have none on a rig (the cord is the route: the canvas leg) — those legs went (IMPL-SX0 §14).
//   2. Panels: a canvas LFO / Envelope / Macros / Chaos module edited through its body (cv-mods-ui slotBody: sx-host slotHost +
//      (MOD1 §4.1, G1's parity half) rig-ui's slot face over the donors LfoPanel / EnvPanel / MacrosPanel / ChaosRow — every
//      control found on the .rig-face) compiles (compileMods payload + the Serum's instPatch) and renders as the same fields
//      written into the device record directly: the same gesture, the same record. Faces mounted, painted, their drawers opened and
//      unmounted, twice, leave vals.s, fx and the compiled patch byte-identical (N2; (SX0) its bundled rounds left with serum-ui.js).
// Accessor-free: tracks are read through their devices (t.dev.i1), never through v1 fields. Fake-DOM nodes never reach
// assert (D.safeAssert; only strings, numbers and plain data are compared).
// Run alone: node --max-old-space-size=2048 --test tests/m3-fixture.test.mjs
import test from 'node:test';
import assertBase from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { readFileSync } from 'node:fs';
import * as H from './golden-harness.mjs';
import { redirect } from './serum-ui.hooks.mjs';
import * as core from '../serum-core.js?v=9';
import * as E from '../sx-edges.js?v=9';
import * as G from '../cv-graph.js?v=9';
import * as CMOD from '../cv-model.js?v=9';

// the golden harness's side B first: its wt.js is the real one (the UI stubs' hook below would redirect it)
const [, B] = await H.sides();
const HS = H.scope(B);
// the Serum panels with tests/serum-ui-stubs' graph.js / fx-ui.js / wtedit.js / wt.js (no canvases drawn), as sx-host.test
if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({ resolve: (spec, ctx, next) => redirect(spec, ctx.parentURL) || next(spec, ctx) });
} else nodeModule.register('./serum-ui.hooks.mjs', import.meta.url);
// every DSP global wk.loadDSP waits for defined (null): it resolves at once, no script injected into the fake DOM — a
// pending load holds each host's continuation (and the host) for its 20 s give-up timer
for (const g of ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrKit', 'DrSeq', 'ModCore', 'PatchDSP', 'PatchMoog', 'MASTERDSP']) globalThis[g] = null;
const SX = await import('../sx-host.js?v=9');
const SM = await import('../sx-ui-mod.js?v=9');
const RU = await import('../rig-ui.js?v=9');
const CMU = await import('../cv-mods-ui.js?v=9');
await CMU.ready();
const D = await import('./serum-ui-stubs/dom.js');
const STUBS = await Promise.all(['../graph.js?v=9', '../fx-ui.js?v=9', '../wtedit.js?v=9'].map(u => import(u)));   // (the stubs: their `made` records)
const assert = D.safeAssert(assertBase);
// (SX0) the stage-3 part views' data-dest ids on this file's base state, frozen from ⟨B⟩ (tests/ref-SX0/dests.mjs, state 'm3')
const DESTS3 = JSON.parse(readFileSync(new URL('./fixtures/sx0-dests.json', import.meta.url), 'utf8'));

const SR = H.SR, SEC = 1.2;
const EVENTS = H.script(SR, { song: false }).filter(([f]) => f < SEC * SR);
const clone = x => JSON.parse(JSON.stringify(x));
const n = (id, v) => core.lawNorm(id, v);
// canonical text: keys sorted, typed arrays by value, -0 and NaN told apart
function canon(x) {
  if (x === null) return 'null';
  switch (typeof x) {
    case 'undefined': return 'u';
    case 'number': return Object.is(x, -0) ? '-0' : String(x);
    case 'string': return JSON.stringify(x);
    case 'boolean': case 'bigint': return String(x);
    case 'function': return 'fn';
    default: break;
  }
  if (ArrayBuffer.isView(x)) { let s = x.constructor.name + '('; for (let i = 0; i < x.length; i++) s += (i ? ',' : '') + canon(x[i]); return s + ')'; }
  if (Array.isArray(x)) { let s = '['; for (let i = 0; i < x.length; i++) s += (i ? ',' : '') + (i in x ? canon(x[i]) : '_'); return s + ']'; }
  return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
}
const noUi = s => { const o = Object.assign({}, s); delete o.ui; return o; };
// the paths where two canonical states differ (first 6), for the failure message
function diff(a, b, at = '', out = []) {
  if (out.length >= 6) return out;
  if (canon(a) === canon(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object' && !ArrayBuffer.isView(a)) {
    for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) diff(a[k], b[k], at + '.' + k, out);
  } else out.push(at + ': ' + canon(a).slice(0, 60) + ' vs ' + canon(b).slice(0, 60));
  return out;
}
// bit for bit: the first 32-bit word where two Float32 renders differ ('' none; golden-graph's)
function bits(a, b) {
  for (const c of ['L', 'R']) {
    const x = new Uint32Array(a[c].buffer, a[c].byteOffset, a[c].length), y = new Uint32Array(b[c].buffer, b[c].byteOffset, b[c].length);
    if (x.length !== y.length) return c + ': length';
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `${c}[${i}] = ${(i / SR).toFixed(4)} s: ${a[c][i]} vs ${b[c][i]}`;
  }
  return '';
}
// the real compile (models.js patchFor, as main.js buildPatch) and the golden harness's Track (the event script's first 1.2 s)
const compile = st => H.trackPatch(B, 'serum', { s: st.s }, st.fx);
function render(id, patch, mods) {
  return H.render(HS, { id, seconds: SEC, events: EVENTS, po: { os: 2, hostOS: 4 },
    setup(p) { H.postTables(B, p, patch.needs); p.msg({ t: 'patch', p: patch }); if (mods) p.msg(mods); } });
}

/* ------------------------------------------------------------------ the Serum-engine state under test */
// OSC A → FILTER 1 (Low 24, 700 Hz); OSC B an octave up at Main with a BUS 1 send; SUB and NOISE at Main; FILTER 2 a
// High 24 at 2 kHz (S2 mode: f.type2 / f2.type); FILTER 2's A B N S switches off (so a cable into it has a switch to
// turn on); Main FX a reverb, BUS 1 a delay
function base() {
  const s = core.normalizeSerum(core.defaultSerum());
  Object.assign(s.p, {
    'b.on': 1, 'b.oct': n('b.oct', 1), 'b.level': 0.7, 'b.bus1': 0.5, 's.on': 1, 's.level': 0.5, 'n.on': 1, 'n.level': 0.25,
    'f.on': 1, 'f.type2': 7 / 107, 'f.cutoff': n('f.cutoff', 700), 'f.res': 0.35,
    'f2.on': 1, 'f2.type': 11 / 107, 'f2.cutoff': n('f2.cutoff', 2000), 'f2.res': 0.2,
    'f2.routeA': 0, 'f2.routeB': 0, 'f2.routeN': 0, 'f2.routeS': 0,
  });
  const fx = core.defaultFx2();
  assert.equal(core.newInstance(fx, 'rev', { rack: 0 }), 'rev');
  assert.equal(core.newInstance(fx, 'dly', { rack: 1 }), 'dly');
  return { s, fx };
}
const S0 = base();
const st0 = () => ({ s: clone(S0.s), fx: clone(S0.fx) });
// a stand-in for main.js sxHost (§2.3: the parts host's host object): the live state; an edit mutates it in place
function hostOf(st, log) {
  const store = new Map();
  return { dev: 'i1', v2Fx: true, bpm: () => 120, state: () => st.s, fx: () => st.fx,
    edit: (fn, o) => { fn(st.s); log.push((o && o.label) || 'edit'); },
    editFx: (fn, o) => { fn(st.fx); log.push((o && o.label) || 'editFx'); },
    storage: { get: (k, d) => (store.has(k) ? store.get(k) : d), set: (k, v) => store.set(k, clone(v)) },
    notify: t => log.push('notice: ' + t), tracks: () => [], seqCmd() {} };
}
// the canvas: the state's modules as faces — a host, the face of each part I1 / I2 give (sx-edges partKeys; the Arpeggiator / Clip
// their sx-ui-mod view, Q1) and the Amplifier (VOICE), as main.js sxViews mounts a rig's
async function facesOf(st) {
  const doc = D.fresh(), box = doc.createElement('div'), log = [];
  doc.body.appendChild(box);
  const X = SX.createHost(hostOf(st, log), { doc }), rh = RU.rigHost({ doc }), views = {};
  const mount = part => { const kind = part === 'voice' ? 'amp' : E.kindOf(part); return RU.FACE[kind] ? rh.face(kind, box, { host: X, part, dev: 'i1' }) : SM.mountPart(X, part, box, { dev: 'i1' }); };
  for (const p of E.partKeys(st.s, {}, 'i1')) views[p] = mount(p);
  views.voice = mount('voice');
  await D.flush(doc);
  return { doc, X, views, log };
}
// a canvas cable edit (§2.5): sx-edges on the live state, its writes through the host as one labelled edit; its History
// meta f = [[path, before, after] …] written back gives the state before (undo) and again the state after (redo)
const writeF = (s, f, k) => { for (const x of f) { let o = s; for (const q of x[0].slice(0, -1)) o = o[q]; o[x[0][x[0].length - 1]] = x[k]; } return s; };
function cable(P, st, op, a, b) {
  const pre = clone(st.s), r = (op === 'cut' ? E.cutEdge : E.setEdge)(st.s, st.fx, a, b), label = (op === 'cut' ? 'Disconnect ' : 'Connect ') + a + ' → ' + b;
  if (!r.edit) return r;
  P.X.edit(s => r.edit(s, st.fx), { label });
  assert.equal(P.log.at(-1), label, 'one edit through the host');
  const now = canon(st.s);
  assert.equal(canon(writeF(clone(st.s), r.f, 1)), canon(pre), label + ': the meta\'s before-values give the state before');
  assert.equal(canon(writeF(clone(pre), r.f, 2)), now, label + ': its after-values the state after');
  return r;
}
// a wk.menu pick: its button, then the option by label (the popup list on the document's body)
function choose(doc, menuEl, label) {
  D.fire(menuEl.querySelector('.wk-mbtn'), 'click');
  const opts = doc.body.querySelectorAll('[role="option"]'), o = opts.find(x => x.textContent === label);
  assert.ok(o, 'option ' + label + ' in ' + JSON.stringify(opts.map(x => x.textContent)));
  D.fire(o, 'click');
}
// a knob's typed entry (Enter, the text, Enter: the knob's own parser, wk put 'set')
function typeIn(knob, text) {
  assert.ok(knob, 'a knob for ' + text);
  D.fire(knob, 'keydown', { key: 'Enter' });
  const inp = knob.querySelector('input');
  assert.ok(inp, 'the typed-entry field');
  inp.value = text;
  D.fire(inp, 'keydown', { key: 'Enter' });
}
const byDest = (root, id) => root.querySelectorAll('[data-dest="' + id + '"]')[0] || null;
// the faces' own controls (the donors' widgets on the face and in its drawer): a source's BALANCE knob (live while it routes to
// Filter), a filter's input switch (S A B C N: data-pdest f.route<X> / f2.route<X>) — a tap; each painted after
const faceOf = (F, part) => { const V = F.views[part]; assert.ok(V && V.el, 'the face of ' + part); return V.el; };
const FBAL = { oscA: 'a.fbal', oscB: 'b.fbal', oscC: 'c.fbal', sub: 's.fbal', noise: 'n.fbal' };
const balance = (F, part, text) => { typeIn(byDest(faceOf(F, part), FBAL[part]), text); F.X.paint(true); };
function filterSwitch(F, part, id) {
  const el = faceOf(F, part).querySelectorAll('[data-pdest="' + id + '"]')[0];
  assert.ok(el, part + ': switch ' + id);
  D.fire(el, 'click');
  F.X.paint(true);
}
// destroy hosts; the stubs' records of the editors they built go with them (memory stays flat)
const done = (...hosts) => { for (const h of hosts) if (h && h.X) h.X.destroy(); for (const m of STUBS) if (m.__stub) m.made.length = 0; };

// one routing comparison: every path's state (without s.ui) and patch canonical and equal to the first's (the canvas); the
// first and the path marked `render` rendered bit for bit equal, and unlike `from` (the unedited state; changes:
// false for an edit nothing hears)
function same(name, paths, { from = st0(), changes = true } = {}) {
  const [ref, ...rest] = paths, c0 = canon(noUi(ref.st.s)), f0 = canon(ref.st.fx), p0 = compile(ref.st), pc0 = canon(p0);
  for (const P of rest) {
    assert.deepEqual(diff(noUi(P.st.s), noUi(ref.st.s)), [], `${name}: the state of ${P.name} = ${ref.name}`);
    assert.equal(canon(noUi(P.st.s)), c0, `${name}: ${P.name} state`);
    assert.equal(canon(P.st.fx), f0, `${name}: ${P.name} FX state`);
    assert.equal(canon(compile(P.st)), pc0, `${name}: ${P.name} compiled patch`);
  }
  const id = 'm3fx:' + name, A = render(id, p0), mixP = paths.find(P => P.render) || rest[0];
  const Bm = render(id, compile(mixP.st));
  assert.equal(bits(A, Bm), '', `${name}: ${ref.name} vs ${mixP.name} rendered bit for bit`);
  assert.ok(H.peak(A) > 1e-3, name + ': audible');
  if (changes) assert.notEqual(bits(A, render(id, compile(from))), '', name + ': the edit changes the render');
}
const edgeIds = st => E.serumEdges(st.s, st.fx).filter(e => e.kind === 'audio').map(e => e.a + '>' + (e.b || 'stub') + (e.fork ? '(fork ' + e.share + ')' : '') + (e.dim ? '(off)' : '')).sort();

/* ================================================================ 0. the rig */
test('the rig: the host mounts the faces of the parts I1 / I2 give plus the Amplifier (VOICE), each ⊇ its stage-3 panel\'s frozen data-dest ids; the compile is deterministic; the base state is audible and its routing is what the cases start from', async () => {
  const st = st0(), P = await facesOf(st);
  assert.deepEqual(Object.keys(P.views), ['oscA', 'oscB', 'sub', 'noise', 'filter', 'filter2', 'voice']);
  assert.ok(P.views.filter2.el.querySelectorAll('[data-pdest="f2.routeB"]').length === 1, 'FILTER 2 shows its switches');
  for (const [part, V] of Object.entries(P.views)) {
    const mine = new Set(V.dests()), ref = DESTS3.parts.m3[part].filter(x => !(part === 'voice' && /^e\d\./.test(x)));   // (ENV 1 is Envelope 1's module now)
    assert.ok(ref.length > 0, part + ': the frozen set');
    assert.deepEqual(ref.filter(x => !mine.has(x)), [], part + ': every stage-3 data-dest id on the face');
  }
  assert.equal(canon(compile(st)), canon(compile(st0())), 'one state, one patch');
  assert.deepEqual(edgeIds(st), ['filter.out>voice.main', 'filter2.out>voice.main', 'noise.out>voice.main', 'oscA.out>filter.in', 'oscB.out>voice.main', 'oscC.out>voice.main(off)', 'sub.out>voice.main']);
  assert.ok(H.peak(render('m3fx:rig', compile(st))) > 0.01);
  done(P);
});

/* ================================================================ 1. routing: sx-edges = the faces' controls = the state */
test('OSC B → FILTER 2 (from Main): setEdge through the host = FILTER 2\'s B switch on its face (it routes OSC B to Filter, the balance at FILTER 2) = the direct write; renders bit for bit', async () => {
  const cv = st0(), P = await facesOf(cv);
  const r = cable(P, cv, 'set', 'oscB.out', 'filter2.in');
  assert.equal(r.why, '');
  assert.deepEqual(r.f.map(([p, a, b]) => p.join('.') + ':' + a + '→' + b), ['osc.1.route:1→0', 'p.b.fbal:0→1', 'p.f2.routeB:0→1']);
  assert.deepEqual(edgeIds(cv).filter(e => e.startsWith('oscB')), ['oscB.out>filter2.in']);
  const sw = st0(), W = await facesOf(sw);
  filterSwitch(W, 'filter2', 'f2.routeB');   // (off-route: toggleFilterRoute routes it to Filter with the balance at FILTER 2)
  const dw = st0();
  dw.s.osc[1].route = 0; dw.s.p['b.fbal'] = 1; dw.s.p['f2.routeB'] = 1;
  same('oscB-filter2', [{ name: 'canvas', st: cv }, { name: 'FILTER 2 switch', st: sw, render: true }, { name: 'direct', st: dw }]);
  done(P, W);
});

test('a fork: OSC A (at FILTER 1) cabled into FILTER 2 too = OSC A\'s BALANCE typed 50 / 50 + FILTER 2\'s A switch on the faces = the direct write (fbal ½, both switches on; the edges fork ½ / ½); then BALANCE re-balanced on the canvas\'s face = on the other faces', async () => {
  const cv = st0(), P = await facesOf(cv);
  const r = cable(P, cv, 'set', 'oscA.out', 'filter2.in');
  assert.deepEqual(r.f.map(([p, a, b]) => p.join('.') + ':' + a + '→' + b), ['p.a.fbal:0→0.5', 'p.f2.routeA:0→1']);
  assert.deepEqual(edgeIds(cv).filter(e => e.startsWith('oscA')), ['oscA.out>filter.in(fork 0.5)', 'oscA.out>filter2.in(fork 0.5)']);
  const fc = st0(), F = await facesOf(fc);
  balance(F, 'oscA', 'F1 50 / F2 50');
  filterSwitch(F, 'filter2', 'f2.routeA');
  const dw = st0();
  dw.s.p['a.fbal'] = 0.5; dw.s.p['f2.routeA'] = 1;
  same('fork', [{ name: 'canvas', st: cv }, { name: 'faces', st: fc, render: true }, { name: 'direct', st: dw }]);
  // BALANCE at the fork: the canvas's OSC A face and the other faces, F1 25 / F2 75
  balance(P, 'oscA', 'F1 25 / F2 75');
  balance(F, 'oscA', 'F1 25 / F2 75');
  dw.s.p['a.fbal'] = 0.75;
  assert.deepEqual(edgeIds(cv).filter(e => e.startsWith('oscA')), ['oscA.out>filter.in(fork 0.25)', 'oscA.out>filter2.in(fork 0.75)']);
  const from = clone(dw); from.s.p['a.fbal'] = 0.5;
  same('fork-balance', [{ name: 'canvas face', st: cv }, { name: 'faces', st: fc, render: true }, { name: 'direct', st: dw }], { from });
  done(P, F);
});

test('cuts: a fork\'s branch (cutEdge OSC A → FILTER 1: the balance all to FILTER 2) = OSC A\'s BALANCE F2 on its face; a source (OSC B → MAIN: None); a filter (FILTER 2 → MAIN: None) — each = the direct write, rendered', async () => {
  const forked = () => { const st = st0(); st.s.p['a.fbal'] = 0.5; st.s.p['f2.routeA'] = 1; return st; };
  // the fork's branch
  const cv = forked(), P = await facesOf(cv);
  const r = cable(P, cv, 'cut', 'oscA.out', 'filter.in');
  assert.deepEqual(r.f.map(([p, a, b]) => p.join('.') + ':' + a + '→' + b), ['p.a.fbal:0.5→1']);
  assert.deepEqual(edgeIds(cv).filter(e => e.startsWith('oscA')), ['oscA.out>filter2.in']);
  const fc = forked(), F = await facesOf(fc);
  balance(F, 'oscA', 'F2');
  const dw = forked(); dw.s.p['a.fbal'] = 1;
  same('cut-fork', [{ name: 'canvas', st: cv }, { name: 'faces', st: fc, render: true }, { name: 'direct', st: dw }], { from: forked() });
  done(P, F);
  // a source's cable; a filter's (FILTER 2 fed by OSC B, so its output is heard)
  const fed = () => { const st = st0(); st.s.osc[1].route = 0; st.s.p['b.fbal'] = 1; st.s.p['f2.routeB'] = 1; return st; };
  for (const [a, b, path, mk] of [['oscB.out', 'voice.main', ['osc', 1], st0], ['filter2.out', 'voice.main', ['filter', 1], fed]]) {
    const c = mk(), Pc = await facesOf(c), rc = cable(Pc, c, 'cut', a, b);
    assert.deepEqual(rc.f.map(([p, x, y]) => p.join('.') + ':' + x + '→' + y), [path.join('.') + '.route:1→3']);
    assert.equal(edgeIds(c).some(e => e.startsWith(a + '>')), false, a + ' has no cable');
    const d = mk(); (path[0] === 'osc' ? d.s.osc[1] : d.s.filter[1]).route = 3;
    same('cut-' + a, [{ name: 'canvas', st: c }, { name: 'direct', st: d }], { from: mk() });
    done(Pc);
  }
});

test('NOISE → FILTER 2 (from Main: route Filter, BALANCE F2, FILTER 2\'s N switch) = FILTER 2\'s N switch on its face; SUB → DIRECT / SUB → FILTER 1 through sx-edges — each = the direct write, rendered', async () => {
  const cv = st0(), P = await facesOf(cv);
  const r = cable(P, cv, 'set', 'noise.out', 'filter2.in');
  assert.deepEqual(r.f.map(([p, a, b]) => p.join('.') + ':' + a + '→' + b), ['noise.route:1→0', 'p.n.fbal:0→1', 'p.f2.routeN:0→1']);
  const fc = st0(), F = await facesOf(fc);
  filterSwitch(F, 'filter2', 'f2.routeN');   // (off-route: NOISE to Filter, the balance at FILTER 2)
  const dw = st0(); dw.s.noise.route = 0; dw.s.p['n.fbal'] = 1; dw.s.p['f2.routeN'] = 1;
  same('noise-filter2', [{ name: 'canvas', st: cv }, { name: 'FILTER 2 switch', st: fc, render: true }, { name: 'direct', st: dw }]);
  done(P, F);
  for (const [b, rt] of [['voice.direct', 2], ['filter.in', 0]]) {
    const c = st0(), Pc = await facesOf(c), rc = cable(Pc, c, 'set', 'sub.out', b);
    assert.deepEqual(rc.f.map(([p, x, y]) => p.join('.') + ':' + x + '→' + y), ['sub.route:1→' + rt], 'f.routeS is on and s.fbal at FILTER 1 already');
    assert.deepEqual(edgeIds(c).filter(e => e.startsWith('sub')), ['sub.out>' + b]);
    const d = st0(); d.s.sub.route = rt;
    same('sub-' + b, [{ name: 'canvas', st: c }, { name: 'direct', st: d }]);
    done(Pc);
  }
});

test('a stub (OSC A routed to Filter, FILTER 1\'s A switch off: "→ Filter (off)"): cabled into FILTER 1 = FILTER 1\'s A switch tap on its face = the direct write; the stub cut (route None) = the direct write', async () => {
  const stub = () => { const st = st0(); st.s.p['f.routeA'] = 0; return st; };
  const s0 = stub(), sE = E.serumEdges(s0.s, s0.fx).filter(e => e.a === 'oscA.out');
  assert.deepEqual(sE.map(e => [e.b, !!e.stub, e.label]), [[null, true, E.STUB_LABEL]]);
  const cv = stub(), P = await facesOf(cv), r = cable(P, cv, 'set', 'oscA.out', 'filter.in');
  assert.deepEqual(r.f.map(([p, a, b]) => p.join('.') + ':' + a + '→' + b), ['p.f.routeA:0→1']);
  const sw = stub(), W = await facesOf(sw);
  filterSwitch(W, 'filter', 'f.routeA');
  const dw = stub(); dw.s.p['f.routeA'] = 1;
  same('stub-set', [{ name: 'canvas', st: cv }, { name: 'FILTER 1 switch', st: sw, render: true }, { name: 'direct', st: dw }], { from: stub() });
  done(P, W);
  const cc = stub(), Pc = await facesOf(cc), rc = cable(Pc, cc, 'cut', 'oscA.out', null);
  assert.deepEqual(rc.f.map(([p, a, b]) => p.join('.') + ':' + a + '→' + b), ['osc.0.route:0→3']);
  const d2 = stub(); d2.s.osc[0].route = 3;
  same('stub-cut', [{ name: 'canvas', st: cc }, { name: 'direct', st: d2 }], { changes: false }); // (a stub feeds nothing)
  done(Pc);
});

test('FILTER 1 → FILTER 2; then FILTER 2 → FILTER 1 (the most recent wins: FILTER 1 back to Main) = the direct write', async () => {
  const cv = st0(), P = await facesOf(cv), dw = st0();
  const r = cable(P, cv, 'set', 'filter.out', 'filter2.in');
  assert.deepEqual(r.f.map(([p, a, b]) => p.join('.') + ':' + a + '→' + b), ['filter.0.route:1→0']);
  dw.s.filter[0].route = 0;
  same('f1-f2', [{ name: 'canvas', st: cv }, { name: 'direct', st: dw }]);
  const from = clone(dw);
  const r2 = cable(P, cv, 'set', 'filter2.out', 'filter.in');
  assert.deepEqual(r2.f.map(([p, a, b]) => p.join('.') + ':' + a + '→' + b), ['filter.1.route:1→0', 'filter.0.route:0→1']);
  assert.deepEqual(edgeIds(cv).filter(e => e.startsWith('filter')), ['filter.out>voice.main', 'filter2.out>filter.in']);
  dw.s.filter[1].route = 0; dw.s.filter[0].route = 1;
  same('f2-f1', [{ name: 'canvas', st: cv }, { name: 'direct', st: dw }], { from });
  done(P);
});

test('FX in / out: VOICE → own FX is read-only on the canvas (setEdge refuses, nothing written); OSC B → VOICE DIRECT (past the FX) = the direct write; the Amplifier\'s outputs (BUS 1 → Direct, MAIN FX bypass, in its drawer) = the direct FX write; the FX cable\'s label follows', async () => {
  const st = st0(), before = canon(st.s) + canon(st.fx);
  for (const [a, b, why] of [['voice.out', 'fx.in', E.WHY.fx], ['oscB.out', 'fx.in', E.WHY.voice], ['filter.out', 'fx.in', E.WHY.voice]]) {
    const r = E.setEdge(st.s, st.fx, a, b);
    assert.deepEqual([r.edit, r.why, r.f.length], [null, why, 0], a + ' → ' + b);
  }
  assert.equal(canon(st.s) + canon(st.fx), before, 'nothing written');
  assert.equal(E.serumEdges(st.s, st.fx).find(e => e.kind === 'fx').label, 'Main · Bus 1');
  // a source past the FX
  const cv = st0(), P = await facesOf(cv);
  cable(P, cv, 'set', 'oscB.out', 'voice.direct');
  const dw = st0(); dw.s.osc[1].route = 2;
  same('oscB-direct', [{ name: 'canvas', st: cv }, { name: 'direct', st: dw }]);
  assert.equal(E.serumEdges(cv.s, cv.fx).find(e => e.kind === 'fx').label, 'Main · Bus 1 · Direct');
  done(P);
  // the Amplifier's outputs (its drawer: the OutputsPanel's bus routes and FX bypass boxes): BUS 1 → Direct, MAIN FX bypass on
  const po = st0(), R = await facesOf(po), amp = faceOf(R, 'voice');
  const routes = amp.querySelectorAll('.sxm-route'), byps = amp.querySelectorAll('.sxm-bypbox');
  assert.deepEqual([routes.length, byps.length], [2, 3], 'BUS 1 / BUS 2 routes, BUS 1 / BUS 2 / MAIN bypass');
  choose(R.doc, routes[0], 'Direct');
  D.fire(byps[2].querySelector('.sxm-byp'), 'click');
  R.X.paint(true);
  const d2 = st0(); d2.fx.racks[1].route = 1; d2.fx.racks[0].byp = 1;
  same('outputs', [{ name: 'the Amplifier\'s outputs', st: po, render: true }, { name: 'direct', st: d2 }]);
  assert.equal(E.serumEdges(po.s, po.fx).find(e => e.kind === 'fx').label, 'Main · Bus 1 · Direct');
  done(R);
});

/* ================================================================ 2. panels: the canvas modulators; the faces leave the state as it is */
const PJ = { bpm: 120, perf: { wheel: null }, tracks: [] };
const PO = { sr: SR, bpm: 120, prefs: { smooth: 1, silenceTails: 1 } };
// a Serum-engine track ((SX0) a rig: OSC A through FILTER 1 at 500 Hz) whose cutoff a canvas modulator of `kind` moves (one row, amt 0.6)
function modTrack(kind, rec) {
  const s = core.normalizeSerum(core.defaultSerum());
  Object.assign(s.p, { 'f.on': 1, 'f.type2': 7 / 107, 'f.cutoff': n('f.cutoff', 500), 'f.res': 0.5 });
  const t = { id: 'trk_m3', name: 'M3', notes: [], cc: [], prim: 'i1', nid: 4, mods: [],
    dev: { i1: { kind: 'synth', model: 'rig', vals: { s }, preset: null, fx: core.defaultFx2() }, out: { kind: 'out' } }, // ((SX0 D1) the Serum-engine device is a rig: 'serum' left MODELS — the same compile)
    wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }] };
  const id = CMOD.addModDev(t, kind);
  assert.ok(id, kind);
  if (rec) assert.ok(CMOD.setModState(t, id, rec).ok);
  const r = CMOD.addMod(t, id + (kind === 'macro' ? '.k1' : '.out'), 'i1:f.cutoff', { project: PJ });
  assert.ok(r.ok, r.why);
  CMOD.setMod(t, r.row.id, { amt: 0.6 });
  return { t, id };
}
// what the page posts for the track: the {t: 'mods'} payload (main.js buildMods: compileMods, off when empty) and the
// Serum's patch with the track's rows (cv-graph instPatch: ext rows / injected slots)
function posts(t) {
  const pay = G.compileMods(t, PJ, { smooth: 1, qr: null, ultra: 0 });
  const live = pay && (pay.rows.length || pay.ext.length || pay.vals.length) ? pay : null;
  return { pay: live, patch: G.instPatch(t.dev.i1, PO, G.modRowsFor(t, 'i1'), live ? live.ext : [], t) };
}
// a module body (cv-mods-ui slotBody → sx-host slotHost + (MOD1) rig-ui's slot face) wired as §2.3 / main.js modMount: live
// writes the record per move, edit at the end (one History step), cancel restores the start, set = a macro move's mval;
// root: the face (.rig-face[data-rig-kind]) — every control below is found there
const FACE_KIND = { lfo: 'lfo', env: 'env', macro: 'macros', chaos: 'chaos' };
function bodyOf(t, key, kind) {
  const doc = D.fresh(), log = [];
  let start = null;
  const o = { doc, get: () => t.dev[key], bpm: () => 120, devKey: key,
    live: f => { if (!start) start = clone(t.dev[key]); log.push(['live', Object.keys(f).join()]); assert.ok(CMOD.setModState(t, key, f).ok); },
    edit: f => { start = null; log.push(['edit', clone(f)]); assert.ok(CMOD.setModState(t, key, f).ok); },
    cancel: () => { if (start) Object.assign(t.dev[key], start); start = null; log.push(['cancel']); },
    set: (k, v) => log.push(['set', k, v]) };
  const body = CMU.slotBody(kind, o);
  doc.body.appendChild(body.el);
  const B = { doc, body, log, get root() { return body.el.querySelector('.rig-face[data-rig-kind="' + FACE_KIND[kind] + '"]'); } };
  return B;
}
const knobDrag = (el, dy) => { D.ptr(el, 'pointerdown', 10, 100); D.ptr(el, 'pointermove', 10, 100 - dy / 2); D.ptr(el, 'pointermove', 10, 100 - dy); D.ptr(el, 'pointerup', 10, 100 - dy); };
const lastEdit = (log, k) => { const e = log.filter(x => x[0] === 'edit' && k in x[1]).pop(); assert.ok(e, 'an edit of ' + k + ': ' + JSON.stringify(log)); return e[1][k]; };
// the panel-edited track vs the directly written one: device records, payload, patch, and the render (with the payload)
function samePosts(name, tp, td, t0) {
  assert.deepEqual(diff(tp.dev, td.dev), [], name + ': the device records');
  const A = posts(tp), Bd = posts(td), Z = posts(t0);
  assert.equal(canon(A.pay), canon(Bd.pay), name + ': the {t: \'mods\'} payload');
  assert.equal(canon(A.patch), canon(Bd.patch), name + ': the Serum patch');
  assert.notEqual(canon(A.pay) + canon(A.patch), canon(Z.pay) + canon(Z.patch), name + ': the edit reaches the compile');
  const id = 'm3fx:mod:' + name, RA = render(id, A.patch, A.pay), RB = render(id, Bd.patch, Bd.pay), R0 = render(id, Z.patch, Z.pay);
  assert.equal(bits(RA, RB), '', name + ': rendered bit for bit');
  assert.ok(H.peak(RA) > 1e-3, name + ': audible');
  assert.notEqual(bits(RA, R0), '', name + ': the edit changes the render');
  return A;
}

test('a canvas LFO edited through its face (MOD1 §4.1: the LfoPanel donor\'s RATE drag, RISE End, mode ENV) posts the payload and renders the bytes of the same fields written into the device directly', async () => {
  const rec = { lfo: { mono: 1, mode: 'free', bpm: 0, anchor: 0 }, rate: n('l1.rate', 3) };
  const { t, id } = modTrack('lfo', rec), t0 = clone(t), td = clone(t);
  const Bo = bodyOf(t, id, 'lfo');
  await D.flush(Bo.doc);
  assert.ok(Bo.root, 'the LFO face');
  knobDrag(byDest(Bo.root, 'l1.rate'), 40);
  D.fire(byDest(Bo.root, 'l1.rise'), 'keydown', { key: 'End' });
  const mode = Bo.root.querySelectorAll('[aria-label="LFO mode"]')[0];
  D.fire(mode.querySelectorAll('button').find(b => b.textContent === 'ENV'), 'click');
  assert.deepEqual(Bo.log.map(x => x[0]).filter((k, i, a) => k !== a[i - 1]), ['live', 'edit'], 'live moves, then one edit per gesture / pick');
  const rate = lastEdit(Bo.log, 'rate');
  assert.ok(rate > rec.rate, 'the drag raised RATE');
  td.dev[id].rate = rate; td.dev[id].rise = 1; td.dev[id].lfo.mode = 'env';
  const A = samePosts('lfo', t, td, t0);
  assert.equal(A.pay.ext.length, 1, 'GLOBAL: an ext slot');
  Bo.body.destroy();
});

test('a canvas Envelope edited through its face (the EnvPanel donor\'s ATTACK drag, A CURVE Home, Legato Inverted from its ⋯) = the same fields written directly (a PER NOTE source: injected into the Serum\'s ENV slot)', async () => {
  const { t, id } = modTrack('env', { att: 0.3, dec: 0.4, sus: 0.2 }), t0 = clone(t), td = clone(t);
  const Bo = bodyOf(t, id, 'env');
  await D.flush(Bo.doc);
  assert.ok(Bo.root, 'the Envelope face');
  knobDrag(byDest(Bo.root, 'e2.att'), -30);
  D.fire(byDest(Bo.root, 'e2.ca'), 'keydown', { key: 'Home' });
  const it = Bo.body.menuItems().find(x => x.label === 'Legato Inverted');
  assert.ok(it, 'the ENV menu');
  it.action();
  const att = lastEdit(Bo.log, 'att');
  assert.ok(att < 0.3, 'the drag lowered ATTACK');
  td.dev[id].att = att; td.dev[id].crv[0] = 0; td.dev[id].env.legInv = 1;
  const A = samePosts('env', t, td, t0);
  assert.equal(A.pay, null, 'nothing for ModCore: the ENV is injected');
  Bo.body.destroy();
});

test('a canvas Macros edited through its face (the MacrosPanel donor\'s MACRO 1 drag: set per move, one {v} edit; rename MACRO 2 in its cell) = the same values written directly; the payload\'s value table carries it', async () => {
  const { t, id } = modTrack('macro', { v: [0.2, 0, 0, 0, 0, 0, 0, 0] }), t0 = clone(t), td = clone(t);
  const Bo = bodyOf(t, id, 'macro');
  await D.flush(Bo.doc);
  assert.ok(Bo.root, 'the Macros face');
  knobDrag(byDest(Bo.root, 'm1'), 60);
  const v = lastEdit(Bo.log, 'v');
  assert.ok(Bo.log.some(x => x[0] === 'set' && x[1] === 0) && !Bo.log.some(x => x[0] === 'live'), 'macro moves through set, no live');
  const tiles = Bo.root.querySelectorAll('.sx-tile');
  D.fire(tiles[1], 'dblclick');
  const inp = Bo.root.querySelector('input');
  inp.value = 'Bright';
  D.fire(inp, 'keydown', { key: 'Enter' });
  td.dev[id].v[0] = v[0]; td.dev[id].names[1] = 'Bright';
  assert.ok(v[0] > 0.2);
  const A = samePosts('macro', t, td, t0);
  assert.deepEqual(A.pay.vals.map(x => [x.k, x.v]), [[0, v[0]]]);
  Bo.body.destroy();
});

test('a canvas Chaos edited through its face (the ChaosRow donor\'s S&H on the scope, RATE PageUp) = the same fields written directly', async () => {
  const { t, id } = modTrack('chaos', { rate: 0.4 }), t0 = clone(t), td = clone(t);
  const Bo = bodyOf(t, id, 'chaos');
  await D.flush(Bo.doc);
  assert.ok(Bo.root, 'the Chaos face');
  D.fire(Bo.root.querySelectorAll('.wk-tog').find(b => b.textContent.trim() === 'S&H'), 'click');
  D.fire(byDest(Bo.root, 'c1.rate'), 'keydown', { key: 'PageUp' });
  const rate = lastEdit(Bo.log, 'rate');
  td.dev[id].chaos.sh = 1; td.dev[id].rate = rate;
  assert.ok(rate > 0.4);
  samePosts('chaos', t, td, t0);
  Bo.body.destroy();
});

// N2 for one state: the faces of every part I1 / I2 give and the Amplifier mounted, painted, each drawer opened and closed, unmounted —
// twice: vals.s and fx byte-identical (JSON, s.ui included), the compiled patch the same ((SX0) the bundled rounds and the stage-3 views
// left with serum-ui.js and the parts machinery: the faces are the views now)
async function n2(st, name) {
  const j0 = JSON.stringify(st.s), f0 = JSON.stringify(st.fx), c0 = canon(compile(st)), parts = E.partKeys(st.s, {}, 'i1');
  for (let round = 0; round < 2; round++) {
    const P = await facesOf(st);
    assert.deepEqual(Object.keys(P.views), parts.concat('voice'));
    let drawers = 0;
    for (const V of Object.values(P.views)) if (V.drawer && V.drawer.el) { V.drawer.open(); P.X.paint(true); V.drawer.close(); drawers++; }
    assert.ok(drawers >= Object.keys(P.views).length - 3, name + ': the drawers opened (' + drawers + ')');
    P.X.paint(true);
    await D.flush(P.doc);
    done(P);
    assert.deepEqual(diff(JSON.parse(JSON.stringify(st.s)), JSON.parse(j0)), [], name + ': faces, round ' + round);
  }
  assert.equal(JSON.stringify(st.s), j0, name + ': vals.s byte-identical');
  assert.equal(JSON.stringify(st.fx), f0, name + ': fx byte-identical');
  assert.equal(canon(compile(st)), c0, name + ': the compiled patch');
  return parts;
}

test('N2: the faces mounted, painted, their drawers opened and unmounted leave vals.s, fx and the compiled patch byte-identical — the state under test with an LFO 3 and a macro row and the ARP on; the six factory presets with the most parts', async () => {
  const st = st0();
  st.s.matrix[0] = core.normRow({ src: 'lfo3', dst: 'b.level', amt: 0.4 });
  st.s.matrix[1] = core.normRow({ src: 'macro2', dst: 'f2.cutoff', amt: 0.3 });
  st.s.p['arp.on'] = 1;
  assert.deepEqual(await n2(st, 'base'), ['oscA', 'oscB', 'sub', 'noise', 'filter', 'filter2', 'lfo3', 'macros', 'arp']);
  // (every one of the 86 was checked once this way when the fixture check was written; a sample stays: ~2 s each)
  const fxm = B.fxm, sx = pr => { const s = core.applyPreset(core.defaultSerum(), pr); return { s, fx: pr.fx ? fxm.applyPresetFx(fxm.defaultFx2(), pr.fx, s) : fxm.defaultFx2() }; };
  const rich = core.FACTORY_PRESETS.map(pr => [pr, E.partKeys(sx(pr).s, {}, 'i1').length]).sort((a, b) => b[1] - a[1] || (a[0].name < b[0].name ? -1 : 1)).slice(0, 6);
  for (const [pr] of rich) await n2(sx(pr), pr.name);
});
