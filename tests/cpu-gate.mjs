// The §14.1 node CPU gates, shared (owner I; RULINGS2 "Performance": gates that are flaky under parallel test load are made
// robust with calibrated pairs and retries — never loosened). Every gated row of every test file goes through here:
//  - calibration: row (b) through tests/ref-p1 (golden harness scope, 8 voices, 1 s of audio per call; bench.json calib =
//    t_ref(calib), its median on the reference machine), built once per process;
//  - a measurement is `runs` back-to-back PAIRS (calibration, row) in alternating order; the load is the MEDIAN OF THE
//    PER-PAIR RATIOS × t_ref(calib) / 1000 — a stretch of machine load (the other test files running in parallel, a
//    core change, a GC) slows both members of a pair, so it cancels instead of landing in one side's median;
//  - a load over the gate (limit × target) is measured again, up to `tries` attempts, and the best attempt counts: a
//    real regression exceeds the gate every time, a scheduling burst does not repeat on every attempt.
// Without bench.json (or t_ref(calib) = 0) the row's raw time per second of audio is the load (uncalibrated).
//   const g = await gateLoad(fn, 0.3);          // fn renders 1 s of audio → { load, raw, k, calib, attempt }
//   const t = await stepTimes(run, { tries: 5 }) // per-step minimum over repeated deterministic runs, calibrated (ms)
import { readFileSync, existsSync } from 'node:fs';

const BENCH_URL = new URL('./bench.json', import.meta.url);
export const BENCH = existsSync(BENCH_URL) ? JSON.parse(readFileSync(BENCH_URL, 'utf8')) : null;
export const T_REF_CALIB = BENCH ? (+BENCH.calib > 0 ? +BENCH.calib : BENCH.refMachine && +BENCH.refMachine.calib > 0 ? +BENCH.refMachine.calib : 0) : 0;

const median = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
const time = f => { const t0 = performance.now(); f(); return performance.now() - t0; };

let calibFn = null;
// the calibration row (b): golden-presets' timing row (b) through the frozen Phase-1 code, 8 voices, 1 s per call
export async function calibRowB() {
  if (calibFn) return calibFn;
  const GH = await import('./golden-harness.mjs');
  const [A] = await GH.sides();
  const s = A.core.defaultSerum();
  Object.assign(s.p, { 'a.uni': 1, 'b.uni': 1, 'b.on': 1, 'f.on': 1, 'f.type': 3 / 95, 'f.routeA': 1, 'f.routeB': 1, 'a.det': 0.5, 'b.det': 0.5 });
  s.voicing.poly = 8; s.global.os = 2;
  s.osc[0].wt = s.osc[1].wt = 'factory:Harmonic Sweep';
  Object.assign(s.p, { 'a.warpMode': 4 / 22, 'b.warpMode': 4 / 22, 'a.warp': 0.5, 'b.warp': 0.5, 'l1.rate': Math.pow(2 / 100, 0.25) });
  s.lfo[0].mode = 'off'; s.lfo[0].bpm = 0;
  s.matrix[0] = { src: 'lfo1', amt: 1, dst: 'a.wt', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 };
  s.matrix[1] = { src: 'lfo1', amt: 1, dst: 'b.wt', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 };
  const v1 = A.core.normalizeSerum(s), Sc = GH.scope(A);
  Sc.g.currentFrame = 0; Sc.seed('bench');
  const p = new Sc.Proc({ processorOptions: { os: 2, hostOS: 4 } });
  const st = GH.serumState(A, v1), patch = GH.trackPatch(A, 'serum', { s: st }, GH.fxState(A, A.core.defaultFx(), st));
  GH.postTables(A, p, patch.needs);
  p.msg({ t: 'patch', p: patch });
  for (let i = 0; i < 8; i++) p.msg({ t: 'on', n: 48 + 3 * i, v: 0.8 });
  const out = [[new Float32Array(128), new Float32Array(128)]];
  const fn = () => { for (let k = 0; k < GH.SR / 128; k++) { p.process([], out); Sc.g.currentFrame += 128; } };
  fn();
  if (p.voices.filter(v => v.active).length !== 8) throw new Error('calibration row (b): 8 voices expected');
  calibFn = fn;
  return fn;
}

// The gated load of a row: fn renders 1 s of audio (its load = seconds of CPU per second of audio). Returns the best
// attempt { load, raw (uncalibrated s/s), k (t_ref / t(calib)), calib (ms), attempt }.
export async function gateLoad(fn, target, { limit = 1.5, runs = 7, tries = 5 } = {}) {
  const calib = T_REF_CALIB > 0 ? await calibRowB() : null;
  fn();                                                      // warm
  let best = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const a = [], b = [], q = [];
    for (let k = 0; k < runs; k++) {
      let x = 0, y;
      if (calib && k & 1) { y = time(fn); x = time(calib); } else { if (calib) x = time(calib); y = time(fn); }
      a.push(x); b.push(y); if (calib) q.push(y / x);
    }
    const ta = median(a), tb = median(b);
    const r = calib ? { load: median(q) * T_REF_CALIB / 1000, raw: tb / 1000, k: T_REF_CALIB / ta, calib: ta, attempt }
      : { load: tb / 1000, raw: tb / 1000, k: 1, calib: 0, attempt };
    if (!best || r.load < best.load) best = r;
    if (best.load <= limit * target) break;
  }
  return best;
}

// Per-step CPU times of a deterministic multi-step job (e.g. a lazy warm-up's ticks), robust to scheduling bursts: run()
// performs the whole job once from a fresh state and returns its per-step times (ms); the job runs `tries` times (at
// least `min`, stopping early once ok(times) holds) and each step keeps its MINIMUM over the runs (a burst does not hit
// the same step on every run). With bench.json the times are calibrated: × k, k = t_ref(calib) / t(calib), t(calib) the
// median of calibration runs taken around the job runs. Returns { t: Float64Array per step (sorted ascending), k, runs }.
export async function stepTimes(run, { tries = 5, min = 2, ok = null } = {}) {
  const calib = T_REF_CALIB > 0 ? await calibRowB() : null, cal = [];
  let mins = null, runs = 0;
  for (let r = 0; r < tries; r++) {
    if (calib) cal.push(time(calib));
    const t = run();
    runs++;
    if (!mins) mins = Float64Array.from(t);
    else for (let i = 0; i < mins.length && i < t.length; i++) if (t[i] < mins[i]) mins[i] = t[i];
    if (calib) cal.push(time(calib));
    const k = calib ? T_REF_CALIB / median(cal) : 1;
    if (runs >= min && ok && ok(Float64Array.from(mins).map(x => x * k).sort())) break;
  }
  const k = calib ? T_REF_CALIB / median(cal) : 1;
  return { t: Float64Array.from(mins).map(x => x * k).sort(), k, runs };
}
