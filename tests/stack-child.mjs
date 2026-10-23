// The child of tests/moog-dsp.test.mjs's stack test (IMPL-P review F1): run as `node --stack-size=200 stack-child.mjs`, a payload on
// stdin (JSON, built by the parent through patch-core), graph() of it on a fresh 900 Series machine in a small stack (the audio
// thread's: a worklet thread may have 512 KB where the main thread's V8 has ~1 MB), 512 samples rendered. Prints one JSON line:
// { steps, live, why, errs, finite } or { thrown } — the parent asserts it.
import './v8-guard.mjs';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url), pg = JSON.parse(readFileSync(0, 'utf8'));
for (const f of ['patch-dsp.js', 'moog-dsp.js']) vm.runInThisContext(readFileSync(new URL(f, ROOT), 'utf8'), { filename: f });
const errs = [], inst = { OS: 4, fs: 192000, salt: 1, bend: 0, wheel: 0, at: 0, sustain: 0, ptFail(w) { errs.push(w); } };
let res;
try {
  const m = globalThis.PatchDSP.create(inst, 'moog'), r = m.graph(pg), buf = new Float64Array(512);
  m.render(buf, 512, 0);
  res = { steps: r.steps, live: r.live, why: r.why, errs, finite: buf.every(Number.isFinite) };
} catch (e) { res = { thrown: String(e && e.constructor && e.constructor.name) + ': ' + String(e && e.message).slice(0, 80) }; }
console.log(JSON.stringify(res));
