// tests/ref-SX0/dests.mjs — the frozen data-dest sets of stage SX0 (docs/canvas/IMPL-SX0.md §4, §6.2, §15 P3-2): the stage-3 part views
// (sx-ui-mod mountPart on a sx-host createHost) and the slot hosts' old panels (slotHost(kind).mount) — the reference every Wavecraft face
// is checked against (rig-ui.test both(), tests/ui-layout-wc.mjs G5, m3-fixture's panel half) once lane K deletes those views.
// Recorded ONCE from the pristine ⟨B⟩ (b82067c: 3db44a8's sources + the glass skin; no SX0 change) by
//   node --max-old-space-size=2048 tests/ref-SX0/dests.mjs --write      (writes tests/fixtures/sx0-dests.json)
// and frozen. Without --write it compares (exit 1 on a difference) — which runs only while the stage-3 views exist (until K): after K the
// JSON is the reference and this script has nothing left to mount. Never re-recorded.
// The states are each consumer's: 'rig' rig-ui.test's rig() (the blank, every WC-1 part on), 'sample' the same with Oscillator 1 a
// sample (rig-ui.test's type switch), 'wc' ui-layout-wc's page (Oscillator 2 a sample, 3 a granular, Envelope 1 a real envelope; its host
// carries sampleRate / wt), 'm3' m3-fixture's base Serum (v2Fx, its host's tracks / seqCmd). Per state, every part a view kind takes
// (sx-ui-mod partView), each on a fresh host: the sorted data-dest ids after the mount (D.flush) — and after a paint(true) when that
// differs ({ mount, paint }). Slots: the canvas LFO / Envelope / Macros / Chaos old panels (ui-layout-wc's mount), normModDev defaults.
// The fake DOM (tests/serum-ui-stubs/dom.js; graph.js / fx-ui.js / wtedit.js / wt.js the stubs, as rig-ui.test); no node reaches JSON.
import { readFileSync, writeFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { redirect } from '../serum-ui.hooks.mjs';

if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({ resolve: (spec, ctx, next) => redirect(spec, ctx.parentURL) || next(spec, ctx) });
} else nodeModule.register('../serum-ui.hooks.mjs', import.meta.url);
for (const g of ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrSeq', 'ModCore', 'PatchDSP', 'PatchMoog', 'MASTERDSP']) globalThis[g] = null;

const OUT = new URL('../fixtures/sx0-dests.json', import.meta.url);
const clone = x => JSON.parse(JSON.stringify(x));

export const PARTS = ['oscA', 'oscB', 'oscC', 'sub', 'noise', 'filter', 'filter2', 'env1', 'env2', 'env3', 'env4', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'lfo5', 'lfo6', 'lfo7',
  'lfo8', 'lfo9', 'lfo10', 'macros', 'voicing', 'chaos1', 'chaos2', 'velo', 'note', 'voice', 'arp', 'clip'];
export const SLOTS = [['lfo', 'lfo', 'l1'], ['env', 'env', 'e1'], ['macro', 'macros', 'm1'], ['chaos', 'chaos', 'h1']];

export async function record() {
  const v = '?v=9';
  const [core, RC, wt, SXH, SM, song] = await Promise.all(['../../serum-core.js', '../../rig-core.js', '../../wt.js', '../../sx-host.js', '../../sx-ui-mod.js', '../../song.js'].map(p => import(p + v)));
  const D = await import('../serum-ui-stubs/dom.js');
  const n = (id, x) => core.lawNorm(id, x);
  const rigOn = edit => { const s = RC.rigBlank(); for (const id of ['a.on', 'b.on', 'c.on', 's.on', 'n.on', 'f.on', 'f2.on']) s.p[id] = 1; if (edit) edit(s); return s; };
  const store = () => { const m = new Map(); return { get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, x) => m.set(k, clone(x)) }; };
  // the consumers' host objects (rig-ui.test both()'s second host; ui-layout-wc mkHost; m3-fixture hostOf)
  const HOSTS = {
    rig: st => ({ state: () => st.s, fx: () => st.fx, edit: fn => fn(st.s), editFx: fn => fn(st.fx), bpm: () => 120, dev: 'i9', storage: store(), notify() {} }),
    wc: st => ({ state: () => st.s, fx: () => st.fx, edit: fn => fn(st.s), editFx: fn => fn(st.fx), bpm: () => 120, dev: 'i9', sampleRate: () => 48000, storage: store(), notify: () => {},
      wt: { list: () => wt.FACTORY_TABLES, noises: () => wt.NOISES, get: id => wt.factoryTable(id) } }),
    m3: st => ({ dev: 'i1', v2Fx: true, bpm: () => 120, state: () => st.s, fx: () => st.fx, edit: fn => fn(st.s), editFx: fn => fn(st.fx), storage: store(), notify() {}, tracks: () => [], seqCmd() {} }),
  };
  const m3 = () => {
    const s = core.normalizeSerum(core.defaultSerum());
    Object.assign(s.p, { 'b.on': 1, 'b.oct': n('b.oct', 1), 'b.level': 0.7, 'b.bus1': 0.5, 's.on': 1, 's.level': 0.5, 'n.on': 1, 'n.level': 0.25,
      'f.on': 1, 'f.type2': 7 / 107, 'f.cutoff': n('f.cutoff', 700), 'f.res': 0.35, 'f2.on': 1, 'f2.type': 11 / 107, 'f2.cutoff': n('f2.cutoff', 2000), 'f2.res': 0.2,
      'f2.routeA': 0, 'f2.routeB': 0, 'f2.routeN': 0, 'f2.routeS': 0 });
    const fx = core.defaultFx2(); core.newInstance(fx, 'rev', { rack: 0 }); core.newInstance(fx, 'dly', { rack: 1 });
    return { s, fx };
  };
  const STATES = {
    rig: ['rig', () => ({ s: rigOn(), fx: core.defaultFx2() })],
    sample: ['rig', () => ({ s: rigOn(s => { s.osc[0].type = 'sample'; }), fx: core.defaultFx2() })],
    wc: ['wc', () => ({ s: rigOn(s => { s.osc[1].type = 'sample'; s.osc[2].type = 'gran'; for (const id of ['e1.att', 'e1.dec', 'e1.sus', 'e1.rel']) s.p[id] = core.DESTS[core.DEST_INDEX[id]].def; }), fx: core.defaultFx2() })],
    m3: ['m3', m3],
  };
  const ids = el => [...new Set(el.querySelectorAll('[data-dest]').map(e => e.getAttribute('data-dest')))].sort();
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const parts = {};
  for (const [name, [hk, make]] of Object.entries(STATES)) {
    const R = parts[name] = {};
    for (const part of PARTS) {
      const doc = D.fresh(), box = doc.createElement('div');
      doc.body.appendChild(box);
      const X = SXH.createHost(HOSTS[hk](make()), { doc });
      SM.mountPart(X, part, box);
      await D.flush(doc);
      const a = ids(box);
      X.paint(true); await D.flush(doc);
      const b = ids(box);
      R[part] = same(a, b) ? a : { mount: a, paint: b };
      X.destroy();
    }
  }
  const slots = {};
  const rows0 = { count: () => 1, bypassed: () => false, bypass() {}, remove() {} };
  for (const [kind, view, dk] of SLOTS) {
    const doc = D.fresh(), b3 = doc.createElement('div');
    doc.body.appendChild(b3);
    const dev = song.normModDev({ kind });
    const H3 = SXH.slotHost(kind, { doc, get: () => dev, edit() {}, live() {}, cancel() {}, devKey: dk, rows: rows0 });
    H3.mount(view, b3, { k: H3.slot, bare: true, dev: dk });
    H3.paint(true); await D.flush(doc);
    slots[kind] = ids(b3);
    H3.destroy();
  }
  return { parts, slots };
}

if (process.argv[1] && /dests\.mjs$/.test(process.argv[1])) {
  const now = await record(), write = process.argv.includes('--write');
  if (write) {
    writeFileSync(OUT, JSON.stringify(Object.assign({ about: 'IMPL-SX0 §4 / §6.2: the stage-3 views\' data-dest sets, frozen from b82067c — tests/ref-SX0/dests.mjs' }, now)) + '\n');
    const n = Object.values(now.parts).reduce((a, R) => a + Object.keys(R).length, 0);
    console.log(`tests/fixtures/sx0-dests.json written: ${Object.keys(now.parts).length} states × ${PARTS.length} parts (${n} views), ${Object.keys(now.slots).length} slot panels`);
  } else {
    const was = JSON.parse(readFileSync(OUT, 'utf8')), d = [];
    for (const k of ['parts', 'slots']) if (JSON.stringify(was[k]) !== JSON.stringify(now[k])) d.push(k);
    if (d.length) { console.log('sx0-dests: differs from the frozen record in ' + d.join(', ')); process.exit(1); }
    console.log('sx0-dests: the views match tests/fixtures/sx0-dests.json');
  }
}
