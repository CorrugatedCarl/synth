// tests/ref-SX0/record.mjs — the frozen patch record of stage SX0 (docs/canvas/IMPL-SX0.md §6.2, S1): what the Serum engine is posted
// for every sound Serum complete reached that a Wavecraft now carries, so `serum` can leave MODELS with the rig proven to compile the same.
// Recorded ONCE from the pristine ⟨B⟩ (b82067c: 3db44a8's sources + the glass skin; no SX0 change) as record('serum') by
//   node --max-old-space-size=2048 tests/ref-SX0/record.mjs --write      (writes base.json, prints a summary)
// and frozen as tests/ref-SX0/base.json. Without --write it compares record(RIG.ID) (exit 1 on a difference); tests/sx0-model.test.mjs
// does the same. Never re-recorded (the ref-WC protocol).
// record(id) — each entry the sha256 of the patch's canonical text (keys sorted, typed arrays by kind and value, -0 / NaN told apart):
//   preset:<name>   every factory preset as program change / sxLoad posts it: serum-core applyPreset onto the default state, its FX by
//                   applyPresetFx onto the default rack (none: the default rack) — patchFor(id, …) at the host's live defaults (LIVE)
//   stored:<name>   the same preset's stored state and FX as they are (ref-WC's form: normalizeSerum / normalizeFx) with every option
//                   off its default (ODD: 44.1 kHz, 97 BPM, the quality caps lowered, the app preferences flipped, a re-seed)
//   default · default:odd · default:prefs   defaultSerum at patchFor's plain defaults (48 kHz, 120 BPM) and at ODD; and the default with
//                   the GLOBAL preferences applied (rig-core applyPrefs — serum.defaults(prefs) at ⟨B⟩, checked equal when --write runs
//                   there; PREFS1 turns each on) at LIVE
//   farm:<sample>/<preset>   the three smpgen render-farm loops' patches as the site builds them (smpgen renderPlan → assets.js farmPatch
//                   with the plan note's own model id) — and farmId:<sample>/<preset> the same through `id`
//   cost:e          cv-cost's measure row e (deviceRows) as the site builds it — its own model id
// The `cost:` and `farm:` entries do not take `id`: they pin the site's re-point (smpgen / cv-cost → RIG.ID) against the Serum's bytes.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MODELS, patchFor, isSxId } from '../../models.js?v=9';
import * as C from '../../serum-core.js?v=9';
import { applyPrefs } from '../../rig-core.js?v=9';
import { farmPatch } from '../../assets.js?v=9';
import { FACTORY_SAMPLES, renderPlan } from '../../smpgen.js?v=9';
import { deviceRows } from '../../cv-cost.js?v=9';
import { OPTS, PREFS0 } from '../fixtures/graph-1e.mjs';

const OUT = new URL('./base.json', import.meta.url);
const clone = x => JSON.parse(JSON.stringify(x));
// the canonical text of a patch (what reaches the worklet): keys sorted, typed arrays by kind and value, -0 / NaN / undefined told apart
export function canon(x) {
  if (x === null) return 'null';
  switch (typeof x) {
    case 'undefined': return 'u';
    case 'number': return Object.is(x, -0) ? '-0' : String(x);
    case 'string': return JSON.stringify(x);
    case 'boolean': case 'bigint': return String(x);
    case 'function': return 'f';
    default: break;
  }
  if (ArrayBuffer.isView(x)) { let s = x.constructor.name + '('; for (let i = 0; i < x.length; i++) s += (i ? ',' : '') + canon(x[i]); return s + ')'; }
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  if (x instanceof Map) return 'Map(' + [...x].map(([k, v]) => canon(k) + '=>' + canon(v)).join(',') + ')';
  if (x instanceof Set) return 'Set(' + [...x].map(canon).join(',') + ')';
  return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
}
const H = x => createHash('sha256').update(canon(x)).digest('hex');
// the host's live options (main.js buildInstPatch at its defaults: tests/fixtures/graph-1e OPTS without the safeguard's osCap) and patchFor's plain ones
export const LIVE = Object.freeze({ sr: OPTS.sr, bpm: OPTS.bpm, drift: OPTS.drift, hiss: OPTS.hiss, qr: OPTS.qr, prefs: OPTS.prefs, seed: OPTS.seed });
export const PLAIN = Object.freeze({ sr: 48000, bpm: 120 });
export const ODD = Object.freeze({ sr: 44100, bpm: 97, drift: 0.3, hiss: 0, seed: true, qr: Object.freeze({ uniMax: 4, grainsMax: 64, specHopMul: 2, specStreams: 8, grainsProc: 128, convMax: 2 }),
  prefs: Object.freeze({ smooth: 0.5, silenceTails: 0, ultra: 1, mpeBendX: 1, mpeYBi: 1 }) });
export const PREFS1 = Object.freeze(Object.assign({}, PREFS0, { defOs: 4, author: 'SX0', view3d: 1, mpeDefault: 1 }));
export const presets = () => MODELS.find(m => isSxId(m.id) && Array.isArray(m.presets) && m.presets.length).presets; // (C.FACTORY_PRESETS, through the model as program change reads it)

export function record(id) {
  const R = {}, P = (vals, fx, o) => patchFor(id, vals, fx, o);
  for (const p of presets()) {
    const s = C.applyPreset(C.normalizeSerum(C.defaultSerum()), p), fx = C.applyPresetFx(C.defaultFx2(), p.fx && typeof p.fx === 'object' ? p.fx : C.defaultFx2(), s);
    R['preset:' + p.name] = H(P({ s }, fx, LIVE));
    const s0 = C.normalizeSerum(clone(p.v.s));
    R['stored:' + p.name] = H(P({ s: s0 }, p.fx ? C.normalizeFx(clone(p.fx), s0) : C.defaultFx2(), ODD));
  }
  R.default = H(P({ s: C.normalizeSerum(C.defaultSerum()) }, C.defaultFx2(), PLAIN));
  R['default:odd'] = H(P({ s: C.normalizeSerum(C.defaultSerum()) }, C.defaultFx2(), ODD));
  R['default:prefs'] = H(P({ s: applyPrefs(C.defaultSerum(), PREFS1) }, C.defaultFx2(), LIVE));
  for (const x of FACTORY_SAMPLES) {
    if (x.src !== 'farm' || !isSxId(x.model)) continue;
    const plan = renderPlan(x.id), seen = new Set();
    for (const nt of plan.notes) {
      if (seen.has(nt.preset)) continue;
      seen.add(nt.preset);
      const a = farmPatch(nt.model, nt.preset, plan.bpm || 120), b = farmPatch(id, nt.preset, plan.bpm || 120);
      R['farm:' + x.name + '/' + nt.preset] = H(a);
      R['farmId:' + x.name + '/' + nt.preset] = H(b);
    }
  }
  R['cost:e'] = H(deviceRows().find(r => r.id === 'e').patch);
  return R;
}

if (process.argv[1] && /record\.mjs$/.test(process.argv[1])) {
  const write = process.argv.includes('--write');
  if (write) {
    const sx = MODELS.find(m => m.id === 'serum');
    if (!sx) throw new Error('ref-SX0: --write records the Serum — only from a tree that has it (⟨B⟩)');
    if (canon(sx.defaults(PREFS1)) !== canon({ s: applyPrefs(C.defaultSerum(), PREFS1) })) throw new Error('ref-SX0: serum.defaults(prefs) is not applyPrefs(defaultSerum(), prefs)');
    const now = record('serum');
    writeFileSync(OUT, JSON.stringify({ about: 'IMPL-SX0 §6.2: patchFor(\'serum\', …) hashes, frozen from b82067c — tests/ref-SX0/record.mjs', from: 'b82067c', n: Object.keys(now).length, hashes: now }, null, 0) + '\n');
    console.log(`tests/ref-SX0/base.json written: ${Object.keys(now).length} hashes (${presets().length} presets × 2, 3 defaults, ${Object.keys(now).filter(k => k.startsWith('farm:')).length} farm patches × 2, cost:e)`);
  } else {
    const { RIG } = await import('../../rig-core.js?v=9');
    const was = JSON.parse(readFileSync(OUT, 'utf8')).hashes, now = record(RIG.ID);
    const d = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(k => was[k] !== now[k]);
    if (d.length) { console.log('ref-SX0: ' + d.length + ' difference(s) from base.json:\n  ' + d.slice(0, 60).join('\n  ')); process.exit(1); }
    console.log('ref-SX0: record(\'' + RIG.ID + '\') matches base.json (' + Object.keys(now).length + ' hashes)');
  }
}
