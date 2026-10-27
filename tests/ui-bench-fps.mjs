// tests/ui-bench-fps.mjs — stage FR's frame-rate harness (docs/canvas/IMPL-FR.md §9 G7, §13 P2-8; lane S).
// Measures what display-rate visuals cost and whether every animated display keeps animating, per scene × frame-rate cap × CPU throttle
// × viewport size, in Chrome for Testing (CDP) — and, as `ui-bench.html?fps=1`, on a device (iPad / Safari: native frames, no CDP).
//   node --max-old-space-size=2048 tests/ui-bench-fps.mjs [--scenes idle,play8,…] [--sizes d,l,p] [--caps 60,120,240] [--throttle 1,4,6]
//        [--display N] [--warm ms] [--measure ms] [--out report.json] [--bench-row row.json] [--profile dir] [--layout-gate idle|all|none]
//        [--no-cross] [--no-gate] [--list] [--quiet]
//   node tests/ui-bench-fps.mjs --compare bench cur.json         two reports side by side (no browser; `bench` = tests/bench.json's "ui-fps-mac" row, the
//     baseline's, or a saved report): regressions, improvements; exit 1 on a regression
//     the matrix = sizes × scenes × throttles × caps (the virtual display = the cap) + at 1 × two cells of a 240 Hz display under the caps 120 and 60
//     (CROSS: the cells that catch a loop ignoring the cap; --no-cross or --display N leaves them out)
//     sizes: d 1440 × 900 (mouse) · l 1366 × 1024 and p 1024 × 1366 (touch) — dpr 2. Chrome: $CHROME, else the repo's Chrome for Testing
//     (.claude/test-browser, looked for from the repo up — a worktree sits inside it); its own --user-data-dir (--profile / $FPS_PROFILE,
//     default the OS temp dir), downloads denied, killed at the end; the app is served by a server of its own on a free port (never 8817).
//     Exit 1 when a gated check fails; `--no-gate` always exits 0 (the baseline run).
// How the frames are driven (§9 G7: "exactly" when it can): headless=new has no HeadlessExperimental.beginFrame (probed: CfT 156), so the
//   page's requestAnimationFrame is VIRTUALISED (installHooks): a Worker sleeps on an Atomics.wait (the server sends COOP / COEP so
//   SharedArrayBuffer exists) and posts a tick at exactly 1000 / D ms; the page delivers every queued rAF callback on a tick, stamped
//   with the scheduled vsync time (a missed vsync — the main thread busy — is dropped, as a display drops it). D = the cap by default (a
//   display of exactly the cap: 60 / 120 / 240) or --display. Chrome runs --disable-frame-rate-limit --disable-gpu-vsync so its own
//   frames (style / layout / paint) follow the page's dirtiness at once. The clock measures the virtual display like a real one
//   (wk.clock.display() ← the rAF deltas); the cap goes in through the app's own path (cv-world setFps when the build has it) else
//   wk.clock.setCap. CPU throttle 1 / 4 / 6 by CDP (the page's main thread only).
// Per cell (a scene at a cap and a throttle): per delivered frame the time of every rAF callback + the onmessage handlers since the
//   previous frame (the harness wraps both), the clock's own stats().ms, paints per canvas (clearRect / fillRect / drawImage /
//   putImageData hooks, once per frame), `.wk-live` cx writes (a MutationObserver), CDP ScriptDuration / LayoutDuration /
//   RecalcStyleDuration deltas per second, heap growth after a forced GC each side, console errors, the clock's clients; each scene's
//   expected-live list (EXPECT: every canvas / ring the scene must animate, with its rate class) judged ≥ 0.8 × the expected rate.
//   Every scene runs in a browser context of its own (a first-run project, in memory); a cell whose only failures are a stalled window
//   (`frames`: a browser task, a GC) or one slow layout (`layout+style`) is measured once more — the second window counts, the first stays as `retry`.
// Node imports the pure part (q, budgets, rates, the gates, the matrix, the bench row, the comparison): nothing here touches node or the DOM
// at the top level (tests/ui-bench-fps.test.mjs). The page side is `installHooks` (stringified into the page before its scripts) and the
// exported `buildScene` / `prepare` / `begin` / `finish` / `gearCheck` / `main` (the scenes, the cell recorder, the device page); the driver
// is `drive` (and `cli`), run when this file is the main module. This file is served to the page: do not edit it while a run is going.

/* ================================================================================================ the pure part */
export const VERSION = 1;
/** Frame-rate caps of G7 (fps) and CPU throttles (CDP rates). */
export const CAPS = Object.freeze([60, 120, 240]);
export const THROTTLES = Object.freeze([1, 4, 6]);
/** The viewports of G7: d = the Mac's window, l / p = the iPad Pro 13" (touch). */
export const SIZES = Object.freeze({
  d: Object.freeze({ id: 'd', w: 1440, h: 900, dpr: 2, touch: false, name: '1440x900' }),
  l: Object.freeze({ id: 'l', w: 1366, h: 1024, dpr: 2, touch: true, name: '1366x1024-touch' }),
  p: Object.freeze({ id: 'p', w: 1024, h: 1366, dpr: 2, touch: true, name: '1024x1366-touch' }),
});
/** Data rates (Hz) the expected-live classes stand on: the worklets' snapshot post (≈ 29 Hz: "the big buffers stay at ≈ 29 Hz"), the
 * GR / Ducker loops' cap (30), the heavy displays' rate class (60, only reachable once the data is faster — Cut B). */
export const HZ = Object.freeze({ snap: 29, gr: 30, heavyMax: 60 });
/** G7's budgets: frame cost (ms per delivered frame: every rAF callback + the message handlers since the previous frame), by CPU throttle
 * and cap (`cap: null` = every cap); layout + style ms per second idle-animating at 1×; heap growth bytes / s; the rate tolerance. */
export const BUDGET = Object.freeze({
  cost: Object.freeze([
    Object.freeze({ throttle: 1, cap: null, med: 2, p95: 4 }), // "med ≤ 2 ms, p95 ≤ 4 ms at 240 and 1 ×" (the cost of a frame does not fall with the cap: gated at every cap)
    Object.freeze({ throttle: 4, cap: 60, med: 8, p95: null }), // "at 4 × (Medium → 60) med ≤ 8 ms"
    Object.freeze({ throttle: 6, cap: 60, med: 12, p95: null }), // "at 6 × / Low (60) med ≤ 12 ms"
  ]),
  layoutStyleMsPerS: 1,
  heapBytesPerS: 1048576,
  rate: 0.8,
  delivered: 0.8, // frames delivered ≥ 0.8 × the virtual display's (a starved main thread says so)
});
export const SCENE_IDS = Object.freeze(['idle', 'play8', 'roll8', 'tutorial', 'serum', 'master', 'busy', 'clip']);
/** The scenes whose layout + style budget (< 1 ms / s, "idle-animating") is gated: the engine on, nothing playing. The others are recorded — a
 * playing project writes the transport's text every frame (IMPL-FR §3 A1: "the recorded exception"). `--layout-gate all` gates every scene. */
export const LAYOUT_SCENES = Object.freeze(['idle']);
/** The clock's effective rate for a display and a cap (wk.js clkK / clkEff: the 25 % rule, the 60 floor on the global cap): what an
 * 'eff'-class display must reach. Pure — the harness checks the clock measured the same (`clock.eff`). */
export function effOf(display, cap) {
  const D = display > 0 ? display : 60, C = Math.min(cap > 0 ? cap : Infinity, 240);
  let k = 1;
  if (D > 1.25 * C) { k = Math.ceil(D / (1.25 * C) - 1e-9); if (D / k > 1.25 * C) k++; }
  while (k > 1 && D / k < 60) k--;
  return D / k;
}
/** The expected-live lists (IMPL-FR §9 G7, P2-8): per scene, every canvas / SVG ring the scene must animate — each { name, kind: 'canvas' |
 * 'attr', sel (CSS, matched among the elements on screen), [box (CSS: an ancestor whose box says "on screen" and whose element may be hidden at the moment —
 * a knob's dot between notes)], [attr (kind 'attr': the attribute whose writes count)], rate (class: 'eff' | 'snap' | 'gr' |
 * 'heavy' | Hz), [min (elements needed on screen, default 1)], [any (it is enough that `min` of them paint)], [tol (default 0.8)], [max (Hz: the display's own ceiling — the CLIP roll moves a pixel column at most so often)] }.
 * Calibrated on 8f35d70 (the clock only; Cut A not built): the rate classes are what the CONTRACT expects after Cut A — the baseline fails
 * the ones Cut A lifts (the master scope 30 → eff, the head meters / playheads 'eff' already hold because they own an rAF loop). `snap`
 * = the worklets' ≈ 29 Hz snapshot (the LFO / ENV playheads, the Serum displays: unchanged in Cut A), `heavy` = 60 once the data is faster
 * (Cut B), `gr` = the 30 fps GR / Ducker loops. A change-gated writer (the head meters write only when the width text changes) carries a
 * lower `tol`. Kept as data so the node test can check the lists' shape. */
export const EXPECT = Object.freeze({
  idle: Object.freeze([]),
  play8: Object.freeze([
    { name: 'arrangement playhead', kind: 'canvas', sel: 'canvas.arrange', rate: 'eff' },
    { name: 'head meters', kind: 'attr', attr: 'style', sel: '.head .hmeter i', rate: 'eff', min: 8, tol: 0.2 },
  ]),
  roll8: Object.freeze([
    { name: 'arrangement playhead', kind: 'canvas', sel: 'canvas.arrange', rate: 'eff' },
    { name: 'roll playhead', kind: 'canvas', sel: 'canvas.proll', rate: 'eff' },
    { name: 'head meters', kind: 'attr', attr: 'style', sel: '.head .hmeter i', rate: 'eff', min: 8, tol: 0.2 },
  ]),
  tutorial: Object.freeze([
    { name: 'OUT scope', kind: 'canvas', sel: 'canvas#scope', rate: 'eff' },
    { name: 'LFO playheads', kind: 'canvas', sel: '.gx-lfo canvas.gx-ov', rate: 'snap', min: 5 },
    { name: 'ENV playhead', kind: 'canvas', sel: '.gx-env canvas.gx-ov', rate: 'snap' },
    { name: 'wavetable display (3D)', kind: 'canvas', sel: '[data-cv-mod*="oscA"] canvas.sx-disp', rate: 'heavy' },
    { name: 'filter display', kind: 'canvas', sel: '[data-cv-mod*="filter"] canvas.sx-disp', rate: 'snap', tol: 0.4 },
    { name: 'wavetable position dot', kind: 'attr', attr: 'cx', sel: '[data-dest="a.wt"] .wk-live', box: '[data-dest]', rate: 'snap', any: true },
    { name: 'Ducker GR bar', kind: 'canvas', sel: 'canvas.fxr-gr', rate: 'gr', tol: 0.4 }, // keyed to the kick: it moves with each hit (≈ 18 Hz at 128 BPM), not every post
  ]),
  serum: Object.freeze([
    { name: 'OUT scope', kind: 'canvas', sel: 'canvas#scope', rate: 'eff' },
    { name: 'LFO / ENV playheads', kind: 'canvas', sel: '.gx-lfo canvas.gx-ov, .gx-env canvas.gx-ov', rate: 'snap', min: 6 },
    { name: 'wavetable display', kind: 'canvas', sel: 'canvas.sx-disp', rate: 'heavy', any: true },
    { name: 'compressor GR', kind: 'canvas', sel: 'canvas.fxr-gr', rate: 'gr', any: true },
    { name: 'LFO-driven knob dots', kind: 'attr', attr: 'cx', sel: '[data-dest="a.wt"] .wk-live, [data-dest="f.res"] .wk-live, [data-dest="a.level"] .wk-live', box: '[data-dest]', rate: 'snap', any: true, min: 2 },
  ]),
  master: Object.freeze([
    { name: 'OUT scope', kind: 'canvas', sel: 'canvas.mo-sc', rate: 'eff' },
    { name: 'OUT meters', kind: 'canvas', sel: 'canvas.mo-mt', rate: 'snap' },
    { name: 'LFO playheads', kind: 'canvas', sel: '.gx-lfo canvas.gx-ov', rate: 'snap', min: 2 },
    { name: 'compressor GR', kind: 'canvas', sel: 'canvas.fxr-gr', rate: 'gr', any: true },
    { name: 'rack GR bars + Ducker position', kind: 'canvas', sel: '[data-cv-mod="mfx"] canvas.fxr-gr, [data-cv-mod="mfx"] canvas.gx-ov', rate: 'gr', tol: 0.4, min: 3 }, // the Ducker is keyed to the kick: it moves with each hit
    { name: 'threshold dot', kind: 'attr', attr: 'cx', sel: '[data-dest="fx.cmp.thr"] .wk-live', box: '[data-dest]', rate: 'snap', any: true },
  ]),
  busy: Object.freeze([
    { name: 'OUT scope', kind: 'canvas', sel: 'canvas#scope', rate: 'eff', min: 0 },
    { name: 'LFO / ENV playheads', kind: 'canvas', sel: '.gx-lfo canvas.gx-ov, .gx-env canvas.gx-ov', rate: 'snap', any: true, min: 3 },
    { name: 'wavetable displays', kind: 'canvas', sel: 'canvas.sx-disp', rate: 'heavy', any: true },
  ]),
  // (review 2, P3-6b) the CLIP part's roll: its overlay is redrawn when the playhead reaches another pixel column (IMPL-FR §3 B6) — at 128 BPM
  // ×1 ≈ 8.5 sixteenths a second, so a 240 Hz display repaints it on most frames, not all (`max`); the driver's 'clip playhead' check
  // samples the playhead itself through a seek back
  clip: Object.freeze([ // (max: the overlay moves a pixel column ≈ 137 times a second here — measured at 240 Hz, the default view, any viewport: layout px)
    { name: 'CLIP roll playhead', kind: 'canvas', sel: '.sx-roll canvas.sx-rollov', rate: 'eff', max: 120 },
  ]),
});

const r3 = x => Math.round(x * 1000) / 1000, r1 = x => Math.round(x * 10) / 10;
/** Statistics of a list (array / typed array): { n, min, med, p95, max, mean } (medians as ui-bench-wc's q: the element at p·n). Pure. */
export function q(a) {
  const s = Array.from(a || []).filter(x => typeof x === 'number' && isFinite(x)).sort((x, y) => x - y), n = s.length;
  const at = p => (n ? s[Math.min(n - 1, Math.floor(n * p))] : 0);
  return { n, min: r3(n ? s[0] : 0), med: r3(at(0.5)), p95: r3(at(0.95)), max: r3(n ? s[n - 1] : 0), mean: r3(n ? s.reduce((x, y) => x + y, 0) / n : 0) };
}
/** The gates a stalled window or one slow layout can fail alone: a cell failing only these is measured once more (the second window counts, the first
 * stays beside it as `retry`). A real cost / liveness / heap failure is never re-rolled. */
export const SOFT_GATES = Object.freeze(['frames', 'layout+style']);
/** The expected paint rate (Hz) of a class at the clock's effective rate `eff`: 'eff' the clock's; 'snap' the worklet snapshot rate; 'gr' the
 * GR / Ducker loops' 30; 'heavy' min(60, the data's rate, eff); a number an absolute Hz. `o.snap` overrides the data rate (Cut B: the
 * fast lane's). Never above `eff`. Pure. */
export function rateOf(cls, eff, o = {}) {
  const snap = o.snap > 0 ? +o.snap : HZ.snap;
  let hz;
  if (cls === 'eff' || cls == null) hz = eff;
  else if (cls === 'snap') hz = snap;
  else if (cls === 'gr') hz = HZ.gr;
  // (review 2, P3-6d — for Cut B) the heavy class paints every k = floor(E / 60) ≥ 1 frames (sx-host rateMs, the lead's 60 minimum):
  // E / floor(E / 60) a second — 82.5 at E 165, 72 at 144, 60 at 120 / 240, E itself at 60–119. Once the data outruns it (the fast lane)
  // the expectation is min(snap, E / floor(E / 60)), not min(60, snap): HZ.heavyMax is the 60-class's floor, not its rate
  else if (cls === 'heavy') hz = Math.min(HZ.heavyMax, snap);
  else hz = +cls;
  return r1(Math.min(hz, eff));
}
/** One expect entry judged: `got` = { found: n elements matched on screen, rates: [paints per second each] }. Passes when ≥ `min` elements
 * were found and every one (or, with `any`, at least `min` of them) painted ≥ tol × the expected rate — the class's rate at min(eff, the
 * frames delivered: ctx.delivered, / s): a display cannot paint on a frame that never came (review 2, P3-6a; a starved window is the
 * `frames` gate's to judge). From above (a clock-class display on a faster display) against eff itself. Pure. */
export function evalExpect(entry, got, ctx) {
  const eff = ctx && ctx.eff > 0 ? ctx.eff : 60, del = ctx && ctx.delivered > 0 ? Math.min(eff, ctx.delivered) : eff;
  const exp = r1(Math.min(rateOf(entry.rate, del, ctx || {}), entry.max > 0 ? entry.max : Infinity)), tol = entry.tol > 0 ? entry.tol : BUDGET.rate; // (max: the display's own ceiling, Hz)
  const rates = ((got && got.rates) || []).map(Number), found = got ? got.found | 0 : 0, need = entry.min >= 0 ? entry.min : 1, lim = r1(exp * tol); // (min 0: "if it is on screen it must paint" — the OUT scope the camera may have left)
  const ok = rates.filter(x => x >= lim);
  const lo = rates.length ? Math.min(...rates) : 0, med = rates.length ? rates.slice().sort((a, b) => a - b)[rates.length >> 1] : 0;
  let pass = found >= need, why = '';
  if (found < need) why = 'found ' + found + ' on screen, need ' + need;
  else if (entry.any ? ok.length < need : ok.length < rates.length) { pass = false; why = (entry.any ? ok.length + ' of ' + rates.length : rates.length - ok.length + ' of ' + rates.length + ' below') + ' at ≥ ' + lim + ' Hz (min ' + r1(lo) + ', med ' + r1(med) + ')'; }
  // the cap holds from above too: on a display faster than the cap (a 240 Hz screen at 120 / 60) a clock-class display paints at the effective rate, never the display's
  // (FR2: no private loop at the display's rate; Medium / Low save main-thread time by this)
  const hi = r1(rateOf(entry.rate, eff, ctx || {}) * 1.25), over = entry.rate === 'eff' && ctx && ctx.display > 1.05 * eff ? rates.filter(x => x > hi).length : 0;
  if (over) { pass = false; why = (why ? why + '; ' : '') + over + ' of ' + rates.length + ' above the cap: > ' + hi + ' Hz on a ' + ctx.display + ' Hz display (max ' + r1(Math.max(...rates)) + ')'; }
  return { name: entry.name, rate: entry.rate, expected: exp, limit: lim, found, min: r1(lo), med: r1(med), max: r1(rates.length ? Math.max(...rates) : 0), over, pass, why };
}
/** (review 2, P3-6b) A CLIP playhead sampled every frame, [[t ms, sixteenths (−1: not playing)], …]: `jumps` (a frame-to-frame step outside
 * [−0.01, 0.6] — 0.6 sixteenth is ≫ a frame's move at 128 BPM ×1: 0.14 at 60 Hz), `glitches` (a jump and another within 8 frames: a stale
 * anchor shown, a sawtooth — reviewer 2's shapes; a lone jump is a wrap or a seek), `moved` (% of the other steps that moved). Pure. */
export function clipJumps(rec) {
  const jumps = [], glitches = [];
  let steps = 0, moved = 0;
  for (let i = 1; i < rec.length; i++) {
    const a = rec[i - 1][1], b = rec[i][1], d = b - a;
    if (!(a >= 0 && b >= 0)) continue;
    if (d < -0.01 || d > 0.6) jumps.push({ i, t: r1(rec[i][0]), from: r3(a), to: r3(b) });
    else { steps++; if (d > 0) moved++; }
  }
  for (let k = 0; k + 1 < jumps.length; k++) if (jumps[k + 1].i - jumps[k].i <= 8) glitches.push([jumps[k], jumps[k + 1]]);
  return { jumps, glitches, moved: steps ? r1(moved / steps * 100) : 0 };
}
/** The cost budget in force for a cell, or null (ungated): the first entry matching the throttle and (cap or any cap). Pure. */
export function costBudget(throttle, cap) {
  for (const b of BUDGET.cost) if (b.throttle === throttle && (b.cap == null || b.cap === cap)) return b;
  return null;
}
/** Whether a cell's rate / frame / heap gates apply: at 1 × always, under throttle at the 60 cap (Medium / Low); the others are recorded only. Pure. */
export const gatedCell = (throttle, cap) => throttle === 1 || cap === 60;
/** CDP Performance.getMetrics before / after → per second: { scriptMs, layoutMs, styleMs, taskMs, layouts, styles } (the metrics list is
 * [{name, value}], the durations in seconds, Timestamp in seconds). Pure. */
export function metricsDelta(m0, m1) {
  const g = (m, k) => { const e = (m || []).find(x => x.name === k); return e ? +e.value : 0; };
  const dt = g(m1, 'Timestamp') - g(m0, 'Timestamp');
  if (!(dt > 0)) return { s: 0, scriptMs: 0, layoutMs: 0, styleMs: 0, taskMs: 0, layouts: 0, styles: 0 };
  const ms = k => r3((g(m1, k) - g(m0, k)) * 1000 / dt), n = k => r1((g(m1, k) - g(m0, k)) / dt);
  return { s: r3(dt), scriptMs: ms('ScriptDuration'), layoutMs: ms('LayoutDuration'), styleMs: ms('RecalcStyleDuration'), taskMs: ms('TaskDuration'), layouts: n('LayoutCount'), styles: n('RecalcStyleCount') };
}
/** The gates of one measured cell → [{ id, gated, pass, value, limit, note }] and the verdict. `c` = { throttle, cap, display, frames: {…},
 * frameCost: q, cdp: metricsDelta, heapBytesPerS (null: not measured), errors: [], expect: [evalExpect…] }. Pure. */
export function evalCell(c) {
  const g = [], gated = gatedCell(c.throttle, c.cap), cb = costBudget(c.throttle, c.cap), fc = c.frameCost || q([]);
  if (cb) {
    g.push({ id: 'cost.med', gated: true, pass: fc.med <= cb.med, value: fc.med, limit: cb.med, note: 'ms per frame, median' });
    if (cb.p95 != null) g.push({ id: 'cost.p95', gated: true, pass: fc.p95 <= cb.p95, value: fc.p95, limit: cb.p95, note: 'ms per frame, p95' });
  } else g.push({ id: 'cost.med', gated: false, pass: true, value: fc.med, limit: null, note: 'recorded (no budget at ' + c.throttle + ' × / ' + c.cap + ')' });
  const ls = c.cdp ? r3((c.cdp.layoutMs || 0) + (c.cdp.styleMs || 0)) : null, lsGate = c.throttle === 1 && (c.layoutGate != null ? !!c.layoutGate : LAYOUT_SCENES.includes(c.scene));
  if (ls != null) g.push({ id: 'layout+style', gated: lsGate, pass: !lsGate || ls < BUDGET.layoutStyleMsPerS, value: ls, limit: BUDGET.layoutStyleMsPerS, note: 'ms / s Layout + RecalcStyle (CDP)' + (lsGate ? '' : ' — recorded, not gated: a playing project writes the transport text every frame (§3 A1)') });
  if (c.heapBytesPerS != null) g.push({ id: 'heap', gated, pass: !gated || c.heapBytesPerS <= BUDGET.heapBytesPerS, value: Math.round(c.heapBytesPerS), limit: BUDGET.heapBytesPerS, note: 'bytes / s retained after a GC each side' });
  const fr = c.frames || {}, want = c.display > 0 ? c.display : 0, ck = c.clock || {};
  if (want && fr.delivered != null) g.push({ id: 'frames', gated, pass: !gated || fr.delivered >= BUDGET.delivered * want, value: r1(fr.delivered), limit: r1(BUDGET.delivered * want), note: 'frames / s delivered (the virtual display ' + want + ' Hz)' });
  if (want && ck.measured) { // the clock must read the display it is given, and settle on the cadence the cap asks (a scene with no clock client leaves it unmeasured: nothing to judge)
    g.push({ id: 'clock.display', gated, pass: !gated || Math.abs(ck.display - want) <= 0.08 * want, value: ck.display, limit: want, note: 'the display rate the clock measured (±8 %)' });
    if (ck.expectEff > 0) g.push({ id: 'clock.eff', gated, pass: !gated || Math.abs(ck.eff - ck.expectEff) <= 0.02 * ck.expectEff, value: r1(ck.eff), limit: r1(ck.expectEff), note: 'the clock\'s effective rate (the 25 % rule on display and cap)' });
  }
  for (const e of c.expect || []) g.push({ id: 'live: ' + e.name, gated, pass: !gated || e.pass, value: e.found ? e.min : 0, limit: e.limit, note: e.pass ? 'expected ' + e.expected + ' Hz' : e.why });
  g.push({ id: 'errors', gated: true, pass: !(c.errors && c.errors.length), value: (c.errors || []).length, limit: 0, note: (c.errors || []).slice(0, 3).join(' | ') });
  return { pass: g.every(x => x.pass || !x.gated), gates: g };
}
/** The cells of the "cap" proper: a 240 Hz display at the caps 120 and 60 (what a fast monitor does at the default setting and under Medium / Low):
 * each of them at 1 × only. A display is never faster than the loop that follows it: these are the cells that catch a loop which ignores the cap. */
export const CROSS = Object.freeze([Object.freeze({ display: 240, cap: 120 }), Object.freeze({ display: 240, cap: 60 })]);
/** The cells to run: sizes × scenes × throttles × caps (throttle outer: fewest CDP switches), each with its virtual display (`display` or
 * the cap) — and, with 1 × in the throttles and no `display` forced, the CROSS cells of each (unless `cross: false`). Pure. */
export function matrix(o = {}) {
  const sizes = o.sizes || ['d'], scenes = o.scenes || SCENE_IDS, caps = o.caps || CAPS, th = o.throttles || THROTTLES, out = [], cross = o.cross !== false && !(o.display > 0);
  for (const size of sizes) for (const scene of scenes) for (const throttle of th) {
    for (const cap of caps) out.push({ size, scene, throttle, cap, display: o.display > 0 ? +o.display : cap });
    if (throttle === 1 && cross) for (const x of CROSS) out.push({ size, scene, throttle, cap: x.cap, display: x.display });
  }
  return out;
}
/** argv → options (unknown flags ignored; lists comma-separated; numbers checked). Pure. */
export function parseArgs(argv) {
  const o = { sizes: ['d'], scenes: SCENE_IDS.slice(), caps: CAPS.slice(), throttles: THROTTLES.slice(), display: 0, cross: true, warm: 3200, measure: 4000, out: null, benchRow: null, profile: null, list: false, quiet: false, gate: true, layoutGate: 'idle', compare: null, errors: [] };
  const list = (k, v, ok) => { const a = String(v || '').split(',').map(x => x.trim()).filter(Boolean); if (!a.length || !a.every(ok)) { o.errors.push('--' + k + ': ' + v); return null; } return a; };
  const num = (k, v, lo, hi) => { const n = +v; if (!(n >= lo && n <= hi)) { o.errors.push('--' + k + ': ' + v); return null; } return n; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--scenes') { const l = list('scenes', v, x => SCENE_IDS.includes(x)); if (l) o.scenes = l; i++; }
    else if (a === '--sizes') { const l = list('sizes', v, x => x in SIZES); if (l) o.sizes = l; i++; }
    else if (a === '--caps') { const l = list('caps', v, x => +x >= 10 && +x <= 1000); if (l) o.caps = l.map(Number); i++; }
    else if (a === '--throttle') { const l = list('throttle', v, x => +x >= 1 && +x <= 20); if (l) o.throttles = l.map(Number); i++; }
    else if (a === '--display') { const n = num('display', v, 10, 1000); if (n != null) o.display = n; i++; }
    else if (a === '--warm') { const n = num('warm', v, 500, 60000); if (n != null) o.warm = n; i++; }
    else if (a === '--measure') { const n = num('measure', v, 500, 120000); if (n != null) o.measure = n; i++; }
    else if (a === '--out') { o.out = v; i++; }
    else if (a === '--bench-row') { o.benchRow = v; i++; }
    else if (a === '--profile') { o.profile = v; i++; }
    else if (a === '--layout-gate') { if (['idle', 'all', 'none'].includes(v)) o.layoutGate = v; else o.errors.push('--layout-gate: ' + v); i++; }
    else if (a === '--list') o.list = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--no-gate') o.gate = false;
    else if (a === '--no-cross') o.cross = false;
    else if (a === '--compare') { if (v && argv[i + 2]) o.compare = [v, argv[i + 2]]; else o.errors.push('--compare needs two report files'); i += 2; }
  }
  return o;
}
/** A report → text lines (one per cell, then the failed gates). Pure. */
export function summarize(rep) {
  const L = [];
  for (const c of rep.cells || []) {
    const fc = c.frameCost || {}, cd = c.cdp || {};
    L.push([c.size, c.scene.padEnd(8), c.throttle + '×', String(c.cap).padStart(3), 'disp ' + String(c.display).padStart(3), 'eff ' + String(c.clock && c.clock.measured ? r1(c.clock.eff) : '–').padStart(5),
      'fps ' + String(c.frames ? r1(c.frames.delivered) : '?').padStart(6), 'cost med ' + fc.med + ' p95 ' + fc.p95 + ' max ' + fc.max + (c.contract ? ' (clock+handlers ' + c.contract.med + ' / ' + c.contract.p95 + ')' : ''), 'L+S ' + (cd.layoutMs != null ? r3(cd.layoutMs + cd.styleMs) : '–') + ' ms/s',
      'heap ' + (c.heapBytesPerS != null ? Math.round(c.heapBytesPerS / 1024) + ' KB/s' : '–'), c.pass ? 'ok' : 'FAIL ' + c.gates.filter(x => x.gated && !x.pass).length].join('  '));
  }
  const bad = [];
  for (const c of rep.cells || []) for (const x of c.gates || []) if (x.gated && !x.pass) bad.push('  ✗ ' + c.size + ' ' + c.scene + ' ' + c.throttle + '× cap ' + c.cap + ' · ' + x.id + ' · ' + x.value + (x.limit != null ? ' (limit ' + x.limit + ')' : '') + (x.note ? ' — ' + x.note : ''));
  for (const k of rep.checks || []) if (!k.pass) bad.push('  ✗ check ' + k.id + ' · ' + (k.size || '') + ' ' + (k.scene || '') + ' — ' + (k.note || ''));
  if (bad.length) L.push('', 'failed gates (' + bad.length + '):', ...bad);
  for (const a of rep.aborted || []) L.push('  ABORTED ' + a);
  return L;
}
/** The clock-clients audit of a scene (IMPL-FR reviewer 1: "no leak, no double rAF"): over its cells the clock's client count never grows past the
 * first cell's, and the rAF callbacks per frame (the median) stay within 1 of each other. `sc` = { clients: [n per cell], callbacks: [median per cell] }. Pure. */
export function auditScene(sc) {
  const c = (sc && sc.clients) || [], k = (sc && sc.callbacks) || [];
  const grew = c.length > 1 && Math.max(...c) > c[0], dbl = k.length > 1 && Math.max(...k) - Math.min(...k) > 1;
  return { pass: !grew && !dbl, clients: c, callbacks: k, note: 'clock clients ' + (c.length ? c.join(' ') : '–') + (grew ? ' (GREW)' : '') + ' · rAF callbacks per frame (the fewest: the steady loops) ' + (k.length ? k.join(' ') : '–') + (dbl ? ' (UNSTABLE)' : '') };
}
/** What a cell varies between runs of the SAME build (three full runs at 8f35d70, 2026-10-27): at 1 × the cost median by ≤ 0.075 ms (p90; the largest 0.23), its
 * p95 by ≤ 0.4 (0.8), layout + style by ≤ 7.7 ms / s (idle ≤ 1.5); under CPU throttle the median by ×2–4 (the throttle works in slices: a frame lands in one or
 * across it), the p95 by ×1.4–2, layout + style by ≤ 80 ms / s. `compareReports` keeps beyond these: [relative, absolute] per metric. The budgets (2 / 4 / 8 / 12 ms)
 * are unaffected: they sit far above the noise. */
export const NOISE = Object.freeze({
  one: Object.freeze({ med: [0.25, 0.1], p95: [0.25, 0.5], ls: [0.25, 8], lsIdle: [0.25, 1.5] }),
  thr: Object.freeze({ med: [1.5, 1], p95: [1, 1.5], ls: [1.5, 50], lsIdle: [1.5, 50] }),
});
/** Two reports — full ones or bench rows (`benchRow`; tests/bench.json "ui-fps-mac" is the baseline's) — side by side, cell by cell (size / scene / throttle / cap
 * [@display]): what got worse — the cost median or p95 or layout + style beyond NOISE's margins, an expected display newly below its rate (or above the cap), a
 * gate newly failing — and what got better (the same margins; a live failure fixed, a gate fixed). Pure.
 * `node tests/ui-bench-fps.mjs --compare base.json cur.json` (`bench` for tests/bench.json's row); exit 1 when something got worse. */
export function compareReports(base, cur, o = {}) {
  const A = base && base.cols ? base : benchRow(base || {}), B = cur && cur.cols ? cur : benchRow(cur || {}), k = o.noise || 1;
  const I = { med: A.cols.indexOf('costMed'), p95: A.cols.indexOf('costP95'), ls: A.cols.indexOf('layoutStyleMsPerS'), fps: A.cols.indexOf('fps'), g: A.cols.indexOf('gatesFailed') };
  const rows = [], worse = [], better = [], missing = [];
  const names = (R, id) => new Set((R.liveFailed || {})[id] || []), ids = v => new Set(String(v || '').split(',').filter(Boolean));
  for (const cell of Object.keys(B.cells)) for (const ck of Object.keys(B.cells[cell])) {
    const id = cell + '/' + ck, a = (A.cells[cell] || {})[ck], b = B.cells[cell][ck];
    if (!a) { missing.push(id + ': not in the baseline'); continue; }
    const N = /\/(\d+)x$/.exec(cell) && +/\/(\d+)x$/.exec(cell)[1] > 1 ? NOISE.thr : NOISE.one, idle = /\/idle\//.test(cell);
    const up = (x, y, [rel, abs]) => y > x * (1 + rel * k) + abs * k, down = (x, y, [rel, abs]) => y < x / (1 + rel * k) - abs * k;
    const bad = [], good = [], la = names(A, id), lb = names(B, id), ga = ids(a[I.g]), gb = ids(b[I.g]), lsN = idle ? N.lsIdle : N.ls;
    const has = i => a[i] != null && b[i] != null;
    if (has(I.med) && up(a[I.med], b[I.med], N.med)) bad.push('cost med ' + a[I.med] + ' → ' + b[I.med] + ' ms');
    if (has(I.p95) && up(a[I.p95], b[I.p95], N.p95)) bad.push('cost p95 ' + a[I.p95] + ' → ' + b[I.p95] + ' ms');
    if (has(I.ls) && up(a[I.ls], b[I.ls], lsN)) bad.push('layout+style ' + a[I.ls] + ' → ' + b[I.ls] + ' ms/s');
    for (const n of lb) if (!la.has(n)) bad.push('live: ' + n + ' no longer as expected');
    for (const g of gb) if (!ga.has(g) && g !== 'live') bad.push('gate ' + g + ' now fails');
    if (has(I.med) && down(a[I.med], b[I.med], N.med)) good.push('cost med ' + a[I.med] + ' → ' + b[I.med] + ' ms');
    if (has(I.p95) && down(a[I.p95], b[I.p95], N.p95)) good.push('cost p95 ' + a[I.p95] + ' → ' + b[I.p95] + ' ms');
    if (has(I.ls) && down(a[I.ls], b[I.ls], lsN)) good.push('layout+style ' + a[I.ls] + ' → ' + b[I.ls] + ' ms/s');
    for (const n of la) if (!lb.has(n)) good.push('live: ' + n + ' now as expected');
    for (const g of ga) if (!gb.has(g) && g !== 'live') good.push('gate ' + g + ' now passes');
    rows.push({ key: id, cost: [a[I.med], b[I.med]], p95: [a[I.p95], b[I.p95]], ls: [a[I.ls], b[I.ls]], fps: [a[I.fps], b[I.fps]], worse: bad, better: good });
    for (const t of bad) worse.push(id + ' · ' + t);
    for (const t of good) better.push(id + ' · ' + t);
  }
  for (const cell of Object.keys(A.cells)) for (const ck of Object.keys(A.cells[cell])) if (!(B.cells[cell] || {})[ck]) missing.push(cell + '/' + ck + ': not in the new report');
  return { rows, worse, better, missing, pass: !worse.length };
}

/** The compact bench.json `ui-fps-mac` row of a report: per size / scene / throttle the cap's cell (`cap`, or `cap@display` for a cap on a faster display) =
 * [frame cost median ms, p95 ms, CDP layout + style ms / s, heap KB / s, frames / s delivered, expected-live entries failing, the clock's effective rate,
 * the gated checks that failed ("live" for every expected-live one)]; `liveFailed` names the entries. Pure. */
export function benchRow(rep, meta = {}) {
  const row = { date: meta.date || (rep.when || '').slice(0, 10), machine: meta.machine || rep.machine || '', about: meta.about || '', build: rep.build || '', cols: ['costMed', 'costP95', 'layoutStyleMsPerS', 'heapKBperS', 'fps', 'liveFails', 'eff', 'gatesFailed'], cells: {} };
  for (const c of rep.cells || []) {
    const k = c.size + '/' + c.scene + '/' + c.throttle + 'x', ck = c.cap + (c.display !== c.cap ? '@' + c.display : ''), fc = c.frameCost || {}, cd = c.cdp || {}; // (a cap on a faster display: "120@240")
    const live = (c.expect || []).filter(e => !e.pass).map(e => e.name), gf = Array.from(new Set((c.gates || []).filter(g => g.gated && !g.pass).map(g => (g.id.startsWith('live: ') ? 'live' : g.id)))).join(',');
    ((row.cells[k] = row.cells[k] || {})[ck] = [fc.med, fc.p95, cd.layoutMs != null ? r3(cd.layoutMs + cd.styleMs) : null, c.heapBytesPerS != null ? Math.round(c.heapBytesPerS / 1024) : null, c.frames ? r1(c.frames.delivered) : null, live.length, c.clock && c.clock.measured ? r1(c.clock.eff) : null, gf]);
    if (live.length) (row.liveFailed = row.liveFailed || {})[k + '/' + ck] = live;
  }
  return row;
}

/* ================================================================================================ the page's hooks */
/**
 * Installed into the page BEFORE its scripts (CDP Page.addScriptToEvaluateOnNewDocument; in the iframe mode: an inline script in the app
 * document) — self-contained: it is stringified. Everything the measurements need that the app does not expose:
 *  · a virtual display: window.requestAnimationFrame / cancelAnimationFrame replaced; F.setHz(hz) delivers the callbacks at exactly hz
 *    from a Worker's Atomics.wait ticks (needs SharedArrayBuffer: the server's COOP / COEP), F.setHz(0) the browser's own frames;
 *    per delivered frame the summed callback time (sRaf), the message-handler time since the previous frame (sMsg), the interval (sDt);
 *  · MessagePort.onmessage wrapped: handler time and count, per message type ({t});
 *  · CanvasRenderingContext2D clearRect / fillRect / drawImage / putImageData counted per canvas, once per delivered frame;
 *  · a MutationObserver counting attribute writes per element, once per frame (cx of the `.wk-live` dots, …; F.observe(attrs));
 *  · console.error / error / unhandledrejection collected in F.errs.
 * F.begin() zeroes the counters and starts recording; F.end() stops and returns the raw series.
 */
export function installHooks(win, o) {
  if (win.__fps) return win.__fps;
  const now = () => win.performance.now(), N = 16384;
  const F = win.__fps = { v: 1, on: false, frame: 0, hz: 0, vsOk: typeof win.SharedArrayBuffer === 'function' && typeof win.Worker === 'function', missed: 0, delivered: 0, errs: [], opt: o || {} };
  const realRaf = win.requestAnimationFrame.bind(win);
  let nextId = 1, cbs = new Map(), cur = null, armed = false, lastT = 0;
  let si = 0, sRaf = new Float64Array(N), sMsg = new Float64Array(N), sDt = new Float64Array(N), sN = new Uint16Array(N);
  let msgAcc = 0, msgN = 0, msgMs = 0, byType = {}, t0 = 0, f0 = 0, miss0 = 0, del0 = 0;
  const deliver = t => {
    const list = Array.from(cbs); cbs.clear();
    cur = new Set(list.map(x => x[0]));
    let acc = 0;
    F.frame++; F.delivered++;
    for (const [id, fn] of list) {
      if (!cur.has(id)) continue;
      const a = now();
      try { fn(t); } catch (e) { F.errs.push('rAF callback: ' + String(e && (e.stack || e.message) || e).slice(0, 300)); }
      acc += now() - a;
    }
    cur = null;
    if (F.on && si < N) { sRaf[si] = acc; sMsg[si] = msgAcc; sDt[si] = lastT ? t - lastT : 0; sN[si] = list.length; si++; }
    msgAcc = 0; lastT = t;
  };
  const arm = () => { if (F.hz === 0 && !armed && cbs.size) { armed = true; realRaf(t => { armed = false; deliver(t); arm(); }); } };
  win.requestAnimationFrame = fn => { const id = nextId++; cbs.set(id, fn); arm(); return id; };
  win.cancelAnimationFrame = id => { cbs.delete(id); if (cur) cur.delete(id); };
  // the virtual display: a worker sleeping on Atomics.wait posts the vsync times (performance.timeOrigin-based) at 1000 / hz ms
  let sab = null, f64 = null, worker = null;
  const WORKER = 'onmessage = e => { const f = new Float64Array(e.data), i = new Int32Array(e.data, 32, 4); let next = performance.now() + performance.timeOrigin, P = 0; ' +
    'for (;;) { const p = f[0]; if (!p) { P = 0; Atomics.wait(i, 0, 0, 20); next = performance.now() + performance.timeOrigin; continue; } P = p; next += P; ' +
    'const w = next - (performance.now() + performance.timeOrigin); if (w > 0.6) Atomics.wait(i, 1, 0, w - 0.4); while (performance.now() + performance.timeOrigin < next) {} ' +
    'if (performance.now() + performance.timeOrigin - next > 6 * P) next = performance.now() + performance.timeOrigin; postMessage(next); } };';
  const vtick = e => {
    if (!F.hz) return;
    const P = 1000 / F.hz, sched = e.data - win.performance.timeOrigin, late = now() - sched;
    if (late > 0.99 * P) { F.missed++; return; }
    deliver(sched);
  };
  F.setHz = hz => {
    hz = +hz > 0 ? +hz : 0;
    if (hz && !F.vsOk) return false;
    if (hz && !worker) {
      sab = new win.SharedArrayBuffer(64); f64 = new win.Float64Array(sab);
      worker = new win.Worker(win.URL.createObjectURL(new win.Blob([WORKER], { type: 'text/javascript' })));
      worker.onmessage = vtick; worker.postMessage(sab);
    }
    F.hz = hz;
    if (f64) { f64[0] = hz ? 1000 / hz : 0; if (hz) win.Atomics.notify(new win.Int32Array(sab, 32, 4), 0); }
    lastT = 0;
    if (!hz) arm();
    return true;
  };
  // message handlers
  const MP = win.MessagePort && win.MessagePort.prototype, d0 = MP && Object.getOwnPropertyDescriptor(MP, 'onmessage');
  if (d0 && d0.get && d0.set) {
    const wrapped = new WeakMap();
    Object.defineProperty(MP, 'onmessage', { configurable: true, enumerable: d0.enumerable, get() { const f = d0.get.call(this); return f && f.__orig ? f.__orig : f; }, set(fn) {
      if (typeof fn !== 'function') return d0.set.call(this, fn);
      let w = wrapped.get(fn);
      if (!w) {
        w = function (e) {
          const a = now();
          try { return fn.call(this, e); } finally {
            const dt = now() - a;
            if (F.on) { msgN++; msgMs += dt; const k = e && e.data && typeof e.data.t === 'string' ? e.data.t : '?', b = byType[k] || (byType[k] = { n: 0, ms: 0, max: 0 }); b.n++; b.ms += dt; if (dt > b.max) b.max = dt; }
            msgAcc += dt;
          }
        };
        w.__orig = fn; wrapped.set(fn, w);
      }
      return d0.set.call(this, w);
    } });
  }
  // canvases: paints per canvas, once per delivered frame
  const cvData = new WeakMap(), seen = [], CP = win.CanvasRenderingContext2D && win.CanvasRenderingContext2D.prototype;
  const note = (c, op) => {
    if (!c) return;
    let d = cvData.get(c);
    if (!d) { d = { n: 0, ops: 0, last: -1 }; cvData.set(c, d); seen.push(new WeakRef(c)); }
    if (!F.on) return;
    d.ops++;
    if (d.last !== F.frame) { d.last = F.frame; d.n++; }
  };
  if (CP) {
    for (const op of ['clearRect', 'fillRect', 'drawImage', 'putImageData']) {
      const orig = CP[op];
      if (typeof orig !== 'function') continue;
      CP[op] = op === 'drawImage' || op === 'putImageData' ? function () { note(this.canvas, op); return orig.apply(this, arguments); } : function (a, b, c, d) { note(this.canvas, op); return orig.call(this, a, b, c, d); };
    }
  }
  F.cv = c => { const d = cvData.get(c); return d ? { n: d.n, ops: d.ops } : { n: 0, ops: 0 }; };
  F.canvases = () => { const out = []; for (const w of seen) { const c = w.deref(); if (c && c.isConnected) out.push(c); } return out; };
  // attribute writes per element (the dots' cx), once per frame
  const atData = new WeakMap(), attrs = new Set();
  let mo = null, epoch = 0; // (a count belongs to the recording that made it: begin() starts a new epoch)
  F.observe = list => {
    let more = false;
    for (const a of list) if (!attrs.has(a)) { attrs.add(a); more = true; }
    if (!more) return;
    if (!mo) mo = new win.MutationObserver(recs => {
      if (!F.on) return;
      for (const r of recs) {
        const el = r.target; let d = atData.get(el);
        if (!d) atData.set(el, (d = {}));
        const k = r.attributeName, e = d[k] || (d[k] = { n: 0, last: -1, ep: epoch });
        if (e.ep !== epoch) { e.ep = epoch; e.n = 0; e.last = -1; }
        if (e.last !== F.frame) { e.last = F.frame; e.n++; }
      }
    });
    mo.disconnect();
    mo.observe(win.document, { subtree: true, attributes: true, attributeFilter: Array.from(attrs) });
  };
  F.at = (el, a) => { const d = atData.get(el), e = d && d[a]; return e && e.ep === epoch ? e.n : 0; };
  // errors
  const ce = win.console.error;
  win.console.error = function () { try { F.errs.push('console.error: ' + Array.prototype.map.call(arguments, a => (a && a.stack ? String(a.stack).split('\n').slice(0, 2).join(' ') : String(a))).join(' ').slice(0, 300)); } catch (x) { /* */ } return ce.apply(this, arguments); };
  win.addEventListener('error', e => { F.errs.push('error: ' + String(e.message || e.error).slice(0, 300)); });
  win.addEventListener('unhandledrejection', e => { F.errs.push('unhandled: ' + String(e.reason && e.reason.message || e.reason).slice(0, 300)); });
  // recording
  F.begin = () => {
    si = 0; msgAcc = 0; msgN = 0; msgMs = 0; byType = {}; t0 = now(); f0 = F.frame; miss0 = F.missed; del0 = F.delivered; epoch++;
    for (const w of seen) { const c = w.deref(), d = c && cvData.get(c); if (d) { d.n = 0; d.ops = 0; d.last = -1; } }
    F.on = true;
  };
  F.end = () => {
    F.on = false;
    const ms = now() - t0;
    return { ms, frames: F.frame - f0, delivered: F.delivered - del0, missed: F.missed - miss0, raf: Array.from(sRaf.subarray(0, si)), msg: Array.from(sMsg.subarray(0, si)), dt: Array.from(sDt.subarray(0, si)),
      cbs: Array.from(sN.subarray(0, si)), msgN, msgMs, byType };
  };
  return F;
}
/** The hooks as a script to inject (before the app's own): `window.__synthTest = {}` too — the test hooks the benches use. */
export const hooksScript = (o = {}) => 'window.__synthTest = window.__synthTest || {};\n(' + installHooks.toString() + ')(window, ' + JSON.stringify(o) + ');';

/* ================================================================================================ the page: scenes */
// Every scene is made the way the user makes it, through the app's own hooks (__synthTest: shell.srcPick, cv.rig / cv.mod / cv.fx, master,
// api.sxHost, api.clipToTrack, the ▶ button) in a page running its own frames (F.setHz(0)); then the cells run on the virtual display.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PPQ = 960, CHORDS = Object.freeze([[45, 57, 60, 64], [43, 55, 59, 62], [41, 53, 57, 60], [43, 55, 59, 62]]);
/** The app of a page for the builders. */
export function appOf(win) {
  const T = win.__synthTest, src = Array.from(win.document.scripts).map(s => s.src).find(s => /main\.js/.test(s)) || '', ver = (/[?&]v=(\d+)/.exec(src) || [])[1] || '9';
  return { win, T, doc: win.document, api: T.api, cv: T.cv, shell: T.shell, master: T.master, F: win.__fps, ver, sleep,
    raf: () => new Promise(r => win.requestAnimationFrame(r)), imp: u => win.Function('u', 'return import(u)')(new URL(u + '?v=' + ver, win.document.baseURI).href),
    trk: () => { const P = T.api.project(); return P.tracks.find(t => t.id === P.selTrack); }, notes: [] };
}
const mounted = async A => { await sleep(250); for (let i = 0; i < 80 && A.cv.mount(); i++) await A.raf(); await sleep(400); };
async function prelude(A, top) { // one layout on every device: the keys folded, the top tray at `top` px (0: its row), no lock
  try { const kr = A.doc.querySelector('#kbrow'), kh = A.doc.querySelector('#kbHide'); if (kr && !kr.hidden && kh) kh.click(); } catch (e) { A.notes.push('kbHide: ' + e.message); }
  try { A.shell.topSet(top || 0, 'end'); } catch (e) { A.notes.push('topSet: ' + e.message); }
  try { const W = A.cv.world(); if (W.lockOn && W.lockOn()) W.setLock(false); } catch (e) { /* an older world */ }
  await sleep(300);
}
async function audioOn(A) {
  try { await A.api.powerOn(); } catch (e) { A.notes.push('powerOn: ' + e.message); return false; }
  for (let i = 0; i < 40; i++) { const c = A.api.ctx(); if (c && c.state === 'running') return true; await sleep(100); }
  A.notes.push('the audio context is not running'); return false;
}
async function startPlay(A) {
  if (!A.api.transport().playing) A.doc.querySelector('#tPlay').click();
  for (let i = 0; i < 30 && !A.api.transport().playing; i++) await sleep(100);
  await sleep(500);
  if (!A.api.transport().playing) A.notes.push('the transport did not start');
  return !!A.api.transport().playing;
}
const chordNotes = (len, off = 0, shift = 0) => { // 4 bars of half-bar chords: held (the LFOs and ENVs run), `len` ticks long
  const out = [];
  for (let bar = 0; bar < 4; bar++) for (const half of [0, 2]) for (const k of CHORDS[bar]) out.push({ t: (bar * 4 + half) * PPQ + off, d: len - 30, n: k + shift, v: 96 });
  return out;
};
const arpNotes = (ti, shift) => { // an 8th-note line per track: every head meter moves
  const out = [];
  for (let bar = 0; bar < 4; bar++) for (let s = 0; s < 8; s++) out.push({ t: bar * 4 * PPQ + s * PPQ / 2, d: PPQ / 2 - 30, n: CHORDS[bar][(s + ti) % 4] + shift, v: 90 });
  return out;
};
const kickNotes = () => { const out = []; for (let b = 0; b < 16; b++) out.push({ t: b * PPQ, d: PPQ / 2, n: 36, v: 110 }); return out; };
async function kickTrack(A) { // a TR-808 track with a four-on-the-floor kick; the track selected before is selected again
  const was = A.trk().id;
  A.shell.srcPick('tr808', 'track'); await mounted(A);
  const id = A.trk().id;
  A.api.clipToTrack(id, kickNotes());
  A.api.selectTrack(was); await mounted(A);
  return id;
}
async function fitCanvas(A) { try { A.cv.tidy(); } catch (e) { A.notes.push('tidy: ' + e.message); } await mounted(A); A.cv.world().fit({ animate: false }); await sleep(500); }

const BUILD = {
  async idle(A) { // one classic synth, the engine on, nothing playing
    await prelude(A, 0); await audioOn(A); await sleep(800);
  },
  async play8(A) { // 8 tracks playing (7 + the project's own): the tray open — their head meters, the arrangement playhead —, the canvas tab
    await prelude(A, 700);
    for (const m of ['juno60', 'minimoog', 'prophet5', 'obxa', 'jupiter8', 'cs80', 'ms20']) { A.shell.srcPick(m, 'track'); await mounted(A); }
    A.cv.setProjectBpm(128);
    await audioOn(A);
    A.api.project().tracks.forEach((t, i) => A.api.clipToTrack(t.id, arpNotes(i, (i % 3) * 12 - 12)));
    A.shell.topSet(700, 'end'); await sleep(500);
    await startPlay(A);
  },
  async roll8(A) { await BUILD.play8(A); A.shell.openTab('roll'); await sleep(600); }, // the same 8 tracks, the roll open (its playhead)
  async tutorial(A) { // ROADMAP 20's patch: Wavecraft, "Saw to Square" under an LFO with the 3D view on, two LFOs on the MG Low 12's cutoff, ENV on LEVEL, Reverb → Ducker → 2 Utilities under LFOs
    const CORE = await A.imp('serum-core.js');
    await prelude(A, 0);
    A.shell.srcPick('rig', 'track'); await mounted(A);
    const t = A.trk(), dev = t.prim;
    for (let i = 1; i <= 5; i++) A.cv.rig.add(dev, 'lfo', 'lfo' + i);
    await mounted(A);
    for (const ty of ['rev', 'duck', 'util', 'util']) { A.cv.fx.addEffect(dev + '/fx', ty); await sleep(120); }
    await mounted(A);
    const H = A.api.sxHost(t, dev);
    H.edit(s => {
      s.osc[0].wt = 'factory:Saw to Square'; s.ui.view3d[0] = 1;
      s.p['f.type2'] = CORE.FILTERS.findIndex(f => f.name === 'MG Low 12');
      CORE.addMod(s, H.fx(), 'lfo1', 'a.wt', { amt: 0.6 }); CORE.addMod(s, H.fx(), 'lfo2', 'f.cutoff', { amt: 0.5 }); CORE.addMod(s, H.fx(), 'lfo3', 'f.cutoff', { amt: 0.4 });
      CORE.addMod(s, H.fx(), 'lfo4', 'fx.util.pan', { amt: 0.5 }); CORE.addMod(s, H.fx(), 'lfo5', 'fx.util2.width', { amt: 0.5 });
    }, { label: 'ui-bench-fps' });
    const kick = await kickTrack(A);
    H.editFx(fx => { for (const rk of fx.racks) for (const m of rk.mods) if (m.type === 'duck' && m.sub) m.sub.src = kick; }, { label: 'ui-bench-fps' });
    await fitCanvas(A);
    A.cv.setProjectBpm(128);
    await audioOn(A);
    A.api.clipToTrack(t.id, chordNotes(2 * PPQ));
    await sleep(300); await startPlay(A);
  },
  async serum(A) { // a Serum (complete) with 4 canvas LFOs + 2 canvas ENVs cabled on its knobs, a compressor in its FX
    await prelude(A, 0);
    A.shell.srcPick('serum', 'track'); await mounted(A);
    const t = A.trk(), dev = t.prim, made = {};
    for (const [w, k] of [['l1', 'lfo'], ['l2', 'lfo'], ['l3', 'lfo'], ['l4', 'lfo'], ['e1', 'env'], ['e2', 'env']]) { try { made[w] = A.cv.mod.add(k, null); } catch (e) { A.notes.push('mod ' + k + ': ' + e.message); } }
    await mounted(A);
    for (const [w, pid] of [['l1', 'f.cutoff'], ['l2', 'a.wt'], ['l3', 'f.res'], ['l4', 'a.level'], ['e1', 'f.cutoff'], ['e2', 'f.drive']]) {
      try { if (!A.cv.mod.connect(made[w] + '.out', dev + ':' + pid)) A.notes.push('row ' + w + ' → ' + pid + ' refused'); } catch (e) { A.notes.push('row ' + w + ': ' + e.message); }
    }
    try { if (!A.cv.fx.addEffect(dev + '/fx', 'cmp')) A.notes.push('the compressor was refused'); } catch (e) { A.notes.push('cmp: ' + e.message); }
    await fitCanvas(A);
    A.cv.setProjectBpm(128);
    await audioOn(A);
    A.api.clipToTrack(t.id, chordNotes(2 * PPQ));
    await sleep(300); await startPlay(A);
  },
  async master(A) { // the master canvas: a Compressor and a Ducker in its rack, two LFOs cabled on them, the OUT; a Juno playing under it
    await prelude(A, 0);
    A.shell.srcPick('juno60', 'track'); await mounted(A);
    const src = A.trk().id;
    const kick = await kickTrack(A);
    A.master.open(); await mounted(A);
    if (!A.master.on()) A.notes.push('the master canvas did not open');
    A.cv.fx.addEffect('mfx', 'cmp'); await sleep(200); A.cv.fx.addEffect('mfx', 'duck'); await sleep(200);
    try { A.master.edit(fx => { for (const rk of fx.racks) for (const m of rk.mods) if (m.type === 'duck' && m.sub) m.sub.src = kick; }, { label: 'ui-bench-fps' }); } catch (e) { A.notes.push('duck key: ' + e.message); }
    const made = {};
    for (const w of ['l1', 'l2']) { try { made[w] = A.cv.mod.add('lfo', null); } catch (e) { A.notes.push('mod lfo: ' + e.message); } }
    await mounted(A);
    for (const [w, dst] of [['l1', 'mfx:fx.cmp.thr'], ['l2', 'mfx:fx.cmp.mix'], ['l1', 'mfx:fx.duck.depth']]) { try { if (!A.cv.mod.connect(made[w] + '.out', dst)) A.notes.push('row ' + w + ' → ' + dst + ' refused'); } catch (e) { A.notes.push('row ' + dst + ': ' + e.message); } }
    await fitCanvas(A);
    A.cv.setProjectBpm(128);
    await audioOn(A);
    A.api.clipToTrack(src, chordNotes(2 * PPQ));
    await sleep(300); await startPlay(A);
  },
  async busy(A) { // the busiest Wavecraft canvas: ui-bench-wc's full WC-1 rig (3 oscillators … 4 effects) + 6 canvas modulators with 8 rows
    const WC = await A.win.Function('u', 'return import(u)')(new URL('tests/ui-bench-wc.mjs', A.win.document.baseURI).href), { RIGX } = WC, CORE = await A.imp('serum-core.js');
    await prelude(A, 0);
    A.shell.srcPick('rig', 'track'); await mounted(A);
    const t = A.trk(), dev = t.prim;
    for (const [kind, part] of RIGX.add) { try { if (!A.cv.rig.add(dev, kind, part)) A.notes.push('add ' + part + ' refused'); } catch (e) { A.notes.push('add ' + part + ': ' + e.message); } }
    await mounted(A);
    for (const [a, b] of RIGX.cords) { try { if (A.cv.rig.plug(dev, a, b) === false) A.notes.push('plug ' + a + ' → ' + b + ' refused'); } catch (e) { A.notes.push('plug ' + a + ': ' + e.message); } }
    try { const H = A.api.sxHost(A.trk(), dev); H.edit(s => { for (const [src, dst] of RIGX.own) CORE.addMod(s, H.fx(), src, dst, { amt: 0.4 }); }, { label: 'ui-bench-fps' }); } catch (e) { A.notes.push('own rows: ' + e.message); }
    const made = {};
    for (const [want, kind] of RIGX.canvas) { try { const k = A.cv.mod.add(kind, null); if (k) made[want] = k; } catch (e) { A.notes.push('mod ' + kind + ': ' + e.message); } }
    for (const [w, pid] of RIGX.rows) {
      const src = made[w] ? (/^m/.test(w) ? made[w] + '.k1' : made[w] + '.out') : null;
      if (!src) { A.notes.push('row ' + w + ': no module'); continue; }
      try { if (!A.cv.mod.connect(src, dev + ':' + pid)) A.notes.push('row ' + src + ' → ' + pid + ' refused'); } catch (e) { A.notes.push('row ' + pid + ': ' + e.message); }
    }
    try { for (const x of (A.cv.fx.items || []).filter(y => y.group === 'Effects').slice(0, RIGX.effects)) A.cv.fx.addEffect(dev + '/fx', x.type); } catch (e) { A.notes.push('effects: ' + e.message); }
    await fitCanvas(A);
    A.cv.setProjectBpm(128);
    await audioOn(A);
    A.api.clipToTrack(t.id, chordNotes(2 * PPQ));
    await sleep(300); await startPlay(A);
  },
  async clip(A) { // (review 2, P3-6b; reviewer 2's clipSetup) a Wavecraft rig's CLIP part: a 16-sixteenth clip launched, the song looped over 6 beats (≠ the clip's 4: the wrap lands mid-clip), playing
    await prelude(A, 0);
    A.shell.srcPick('rig', 'track'); await mounted(A);
    const t = A.trk(), dev = t.prim;
    try { if (!A.cv.parts.add(dev, 'clip', null, undefined, { step: false })) A.notes.push('no CLIP part'); } catch (e) { A.notes.push('clip part: ' + e.message); }
    await mounted(A);
    await fitCanvas(A);
    A.cv.setProjectBpm(128);
    await audioOn(A);
    const H = A.api.sxHost(t, dev);
    H.edit(s => { const C = s.clip.clips[0]; C.len = 16; C.start = 0; C.notes = [0, 4, 8, 12].map(x => [x, 2, 60, 100, 0, 0.5, 0.5, 0]); s.clip.sel = 0; s.p['clip.on'] = 1; }, { label: 'ui-bench-fps' });
    await sleep(300);
    H.seqCmd('clipLaunch', 0);
    A.api.arr().host.setLoop(0, 6 * PPQ);
    await sleep(200); await startPlay(A);
  },
};
/** Builds a scene in the page (its own frames, F.setHz(0)); → { id, info, notes, expect } for the driver. */
export async function buildScene(win, id) {
  if (!BUILD[id]) throw new Error('no scene ' + id);
  const A = appOf(win), t0 = win.performance.now();
  if (A.F) A.F.setHz(60); // a 60 Hz display while building (the clock measures it; a free-running rAF would leave it a stale 1000); the browser's own frames without a virtual display
  await BUILD[id](A);
  await sleep(1200);
  const V = A.cv.view(), P = A.api.project(), canv = Array.from(A.doc.querySelectorAll('canvas')), vw = win.innerWidth, vh = win.innerHeight;
  const on = el => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh; };
  const info = { tracks: P.tracks.length, modules: V && V.modules ? V.modules.size : 0, canvases: canv.length, canvasesOnScreen: canv.filter(on).length, dots: A.doc.querySelectorAll('.wk-live').length,
    bpm: P.bpm, playing: !!A.api.transport().playing, audio: A.api.ctx() ? A.api.ctx().state : 'none', buildMs: Math.round(win.performance.now() - t0), viewport: [vw, vh, win.devicePixelRatio], coarse: !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches) };
  return { id, info, notes: A.notes.slice(), errors: A.F ? A.F.errs.slice(0, 10) : [], expect: EXPECT[id] || [] }; // (errors: the console errors of the app's start and the build — the cells count their own)
}

/* ================================================================================================ the page: cells */
let CUR = null; // the cell being run: { A, id, cfg, attrs }
async function wkOf(A) { return A.imp('wk.js'); }
/** Sets the display and the cap, waits `warm` ms, and starts nothing yet; → what the app said (how the cap went in, the clock's view). */
export async function prepare(win, cfg) {
  const A = appOf(win), F = A.F, wk = await wkOf(A), W = A.cv.world(), out = { via: '', notes: [] };
  CUR = { A, wk, cfg };
  if (!F.setHz(cfg.display > 0 ? cfg.display : 0)) out.notes.push('no virtual display (SharedArrayBuffer): the browser\'s own frames');
  if (W && typeof W.setFps === 'function') { try { W.setFps(String(cfg.cap)); out.via = 'world.setFps'; } catch (e) { out.notes.push('world.setFps: ' + e.message); } }
  if (wk.clock.cap() !== cfg.cap) { wk.clock.setCap(cfg.cap); out.via += (out.via ? ' + ' : '') + 'clock.setCap'; }
  F.observe(['cx'].concat(Array.from(new Set((EXPECT[cfg.scene] || []).filter(e => e.kind === 'attr').map(e => e.attr)))));
  F.errs.length = 0;
  await sleep(cfg.warm);
  const s = wk.clock.stats();
  out.clock = { display: s.display, measured: s.measured, eff: s.eff, cap: s.cap, k: s.k };
  return out;
}
/** Starts recording. */
export function begin(win) { win.__fps.begin(); return true; }
// on screen: its box (≥ min px a side: a canvas 1, a knob's dot — 2 px at a 40 % camera — 0.2) meets the viewport
// (a head meter's bar is 0 px wide in silence: an attribute-kind element needs only one side)
const onScreen = (win, el, min = 1, either = false) => { const r = el.getBoundingClientRect(); return (either ? r.width > min || r.height > min : r.width > min && r.height > min) && r.right >= 0 && r.left < win.innerWidth && r.bottom > 0 && r.top < win.innerHeight; };
const labelOf = c => { const m = c.closest && c.closest('[data-cv-mod]'), cl = c.className && c.className.baseVal != null ? c.className.baseVal : c.className; return (m ? m.getAttribute('data-cv-mod') : '-') + ' | ' + (c.id ? '#' + c.id : '') + (cl ? ' .' + String(cl).trim().split(/\s+/).join('.') : '') + ' ' + c.width + 'x' + c.height; };
/** Stops recording; → the raw cell data (series reduced to statistics, the expected-live entries' per-element rates, the busiest canvases). */
export function finish(win) {
  const { A, wk, cfg } = CUR, F = A.F, d = F.end(), secs = d.ms / 1000;
  const cost = d.raf.map((x, i) => x + (d.msg[i] || 0));
  const st = wk.clock.stats(), names = {};
  for (const n of wk.clock.clients()) names[n] = (names[n] || 0) + 1;
  const expectRaw = [];
  for (const e of EXPECT[cfg.scene] || []) {
    let els = [];
    try {
      els = Array.from(A.doc.querySelectorAll(e.sel)).filter(el => {
        const b = e.box ? el.closest(e.box) : el; // (a knob's dot is hidden between notes: its knob says whether it is on screen)
        if (!b || (!e.box && el.getAttribute && el.getAttribute('display') === 'none')) return false;
        return e.kind === 'attr' ? onScreen(win, b, 0.2, true) : onScreen(win, b);
      });
    } catch (err) { expectRaw.push({ name: e.name, found: 0, rates: [], error: String(err.message) }); continue; }
    expectRaw.push({ name: e.name, found: els.length, rates: els.map(el => +((e.kind === 'attr' ? F.at(el, e.attr) : F.cv(el).n) / secs).toFixed(1)) });
  }
  const cvs = F.canvases().map(c => ({ l: labelOf(c), hz: +(F.cv(c).n / secs).toFixed(1), on: onScreen(win, c) })).filter(x => x.hz > 0 && x.on).sort((a, b) => b.hz - a.hz).slice(0, 24);
  const dots = Array.from(A.doc.querySelectorAll('.wk-live')).filter(el => onScreen(win, el.closest('[data-dest]') || el, 0.2, true)).map(el => F.at(el, 'cx') / secs).filter(x => x > 0);
  return { ms: d.ms, delivered: +(d.delivered / secs).toFixed(2), frames: d.frames, missed: d.missed, cost: q(cost), raf: q(d.raf), msg: q(d.msg), dt: q(d.dt), callbacks: q(d.cbs),
    handlers: { n: d.msgN, perS: +(d.msgN / secs).toFixed(1), msPerS: +(d.msgMs / secs).toFixed(3), byType: Object.fromEntries(Object.entries(d.byType).map(([k, v]) => [k, { n: v.n, ms: r3(v.ms), max: r3(v.max) }])) },
    clock: { display: st.display, measured: st.measured, eff: st.eff, cap: st.cap, k: st.k, paints: st.paints, frames: st.frames, ms: { med: r3(st.ms.med), p95: r3(st.ms.p95), max: r3(st.ms.max) }, clients: names },
    expectRaw, canvases: cvs, dots: { n: dots.length, painting: dots.filter(x => x > 1).length, med: q(dots).med }, errors: F.errs.slice(0, 10) };
}

/** The ⚙ Settings popover at this viewport (G7: "the iPad sizes' ⚙ line fits"): opened, measured, closed. `fits` = the popover inside the
 * viewport and — once lane K has added it — the Frame rate line (#cvFps) inside the popover without scrolling. */
export async function gearCheck(win) {
  const A = appOf(win), btn = A.doc.querySelector('#gearBtn'), pop = A.doc.querySelector('#gearPop');
  if (!btn || !pop) return { ok: false, fits: false, why: 'no #gearBtn / #gearPop' };
  const was = !pop.hidden;
  if (!was) btn.click();
  await sleep(500);
  const r = pop.getBoundingClientRect(), vw = win.innerWidth, vh = win.innerHeight, line = pop.querySelector('#cvFps'), hint = pop.querySelector('#cvFpsHint');
  const lab = line ? line.closest('label') || line : null, lr = lab ? lab.getBoundingClientRect() : null;
  const out = { ok: true, open: !pop.hidden, rect: [r.left, r.top, r.right, r.bottom].map(Math.round), viewport: [vw, vh], room: Math.round(vh - r.bottom), scrolls: pop.scrollHeight > pop.clientHeight + 1, overflowY: win.getComputedStyle(pop).overflowY,
    fpsLine: !!line, hint: hint ? hint.textContent.slice(0, 120) : null, lineInside: lr ? lr.top >= r.top - 0.5 && lr.bottom <= r.bottom + 0.5 && lr.left >= r.left - 0.5 && lr.right <= r.right + 0.5 : null };
  out.fits = out.open && r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5 && (lr ? out.lineInside : true);
  if (!was) btn.click();
  await sleep(200);
  return out;
}

/** (review 2, P3-6b; reviewer 2's clipRun) The CLIP scene's playhead: ClipPage.headNow() — what the roll draws — sampled every frame for `ms`, a
 * seek back to beat 1 at `seekAt` ms (a RETRIG clip holds where it was until its next start) → clipJumps of the series and the frames. */
export async function clipCheck(win, ms = 6000, seekAt = 2500) {
  const A = appOf(win), t = A.trk(), rec = A.T.acc && A.T.acc.sxRecOf ? A.T.acc.sxRecOf(t.id, t.prim) : null;
  const V = rec && rec.ui && rec.ui.views ? rec.ui.views.find(v => v.kind === 'clip') : null, CP = V && V.panel && V.panel.panel;
  if (!CP || typeof CP.headNow !== 'function') return { ok: false, why: 'no ClipPage', jumps: [], glitches: [], moved: 0 };
  const out = [], t0 = win.performance.now();
  let live = true, sought = false;
  const loop = ts => {
    if (!live) return;
    out.push([ts - t0, CP.headNow()]);
    if (!sought && ts - t0 > seekAt) { sought = true; A.api.arr().host.setPlayhead(PPQ); }
    win.requestAnimationFrame(loop);
  };
  win.requestAnimationFrame(loop);
  await sleep(ms); live = false;
  return Object.assign({ ok: true, heard: CP.heard(), frames: out.length, fps: r1(out.length / (ms / 1000)) }, clipJumps(out));
}

/* ================================================================================================ on a device: ui-bench.html?fps=1 */
// No CDP, no virtual display (the page has no SharedArrayBuffer there): the app in an iframe on the browser's own frames — the iPad's 60, a
// ProMotion screen's 120 —, every scene, caps 60 (and 120 when the display is that fast). The store's writes are switched off and the project
// is a fresh one (the user's own is read-only here, as in ui-bench-m3 / -wc). One JSON → Copy results (tests/bench.json "ui-fps-ipad" by hand).
export async function main() {
  const Q = new URLSearchParams(location.search), AUTO = Q.get('auto') === '1', $ = s => document.querySelector(s);
  const scenes = (Q.get('scenes') ? Q.get('scenes').split(',') : SCENE_IDS.slice()).filter(x => SCENE_IDS.includes(x));
  document.title = 'SYNTH — frame rate (ui-bench ?fps=1)';
  document.body.innerHTML = '<h1>Frame rate: cost and liveness per scene (IMPL-FR G7)</h1><p>Builds each scene with the app\'s own hooks in a frame below, plays it, and measures a few seconds of the browser\'s own frames: what every frame costs, whether every animated display keeps animating. Leave the page alone while it runs (≈ 20 s a scene).</p>'
    + '<p><button id="run" type="button">Run</button> <button id="copy" type="button" disabled>Copy results</button> <span id="status"></span></p><iframe id="frame" title="SYNTH Canvas" style="width:100%;height:70vh;border:1px solid #333"></iframe><pre id="res"></pre><textarea id="out" readonly style="width:100%;height:200px"></textarea>';
  const W = window.__fpsBench = { state: 'ready', result: null };
  const say = t => { const e = $('#status'); if (e) e.textContent = t; if (AUTO) console.log('[fps] ' + t); };
  const run = async () => {
    W.state = 'running'; $('#run').disabled = true;
    const rep = { kind: 'ui-fps-device', v: VERSION, when: new Date().toISOString(), ua: navigator.userAgent, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight], pace: 'the browser\'s own frames', cells: [], scenes: {}, aborted: [] };
    try {
      const FR = await import('./ui-bench-frame.mjs?t=' + Date.now());
      const html = await (await fetch('../index.html', { cache: 'no-store' })).text();
      for (const scene of scenes) {
        try {
          say(scene + ': starting the app');
          const f = $('#frame'), doc = html.replace(/<head>/i, '<head><base href="' + new URL('../', location.href).href + '"><script>' + hooksScript({}) + '<\/script>');
          await FR.mountFrame(f, doc, FR.frameQuery(location.search), location.href);
          let win = null;
          for (let i = 0; i < 600 && !win; i++) { await sleep(100); const w = f.contentWindow; if (w && w.__fps && w.__synthTest && w.__synthTest.cv && w.__synthTest.api && w.__synthTest.shell && w.document.querySelector('#world') && w.__synthTest.cv.world()) win = w; }
          if (!win) throw new Error('the app did not start in the frame');
          const T = win.__synthTest, st = T.api.store;
          for (const m of ['set', 'setRaw', 'saveProject', 'saveNow']) if (st && typeof st[m] === 'function') st[m] = () => {}; // nothing the bench does is stored
          win.confirm = () => true; win.alert = () => {};
          try { win.document.querySelector('#fNew').click(); await sleep(600); } catch (e) { /* the project as it is */ }
          say(scene + ': building');
          const b = await buildScene(win, scene);
          rep.scenes[scene] = { info: b.info, notes: b.notes };
          const caps = [60];
          await sleep(1500);
          for (const cap of caps.concat(Q.get('caps') ? Q.get('caps').split(',').map(Number) : [])) {
            say(scene + ': measuring at cap ' + cap);
            const cfg = { scene, cap, display: 0, warm: 2500, throttle: 1 };
            const pre = await prepare(win, cfg);
            begin(win); await sleep(4000);
            const raw = finish(win), D = raw.clock.measured ? raw.clock.display : 60, eff = effOf(D, cap);
            const cell = { size: 'device', scene, cap, display: D, throttle: 1, via: pre.via, notes: pre.notes, frames: { delivered: raw.delivered, missed: 0, ms: Math.round(raw.ms), display: D }, frameCost: raw.cost, raf: raw.raf, msg: raw.msg, dt: raw.dt, callbacks: raw.callbacks,
              handlers: raw.handlers, clock: Object.assign({ expectEff: eff }, raw.clock), cdp: null, heapBytesPerS: null, expect: raw.expectRaw.map((r, i) => evalExpect(EXPECT[scene][i], r, { eff, display: D, delivered: raw.delivered })), canvases: raw.canvases, dots: raw.dots, errors: raw.errors };
            const v = evalCell(cell); cell.pass = v.pass; cell.gates = v.gates;
            rep.cells.push(cell);
            $('#res').textContent = summarize(rep).join('\n');
          }
        } catch (e) { rep.aborted.push(scene + ': ' + String(e && e.message || e).slice(0, 200)); }
        const f = $('#frame'); f.removeAttribute('src'); f.srcdoc = '';
        await sleep(500);
      }
      W.result = rep; W.state = 'done';
      $('#out').value = JSON.stringify(rep, null, 1); $('#copy').disabled = false;
      $('#res').textContent = summarize(rep).join('\n');
      say('done — Copy results');
    } catch (e) { W.state = 'error'; W.error = String(e && e.message || e); say('error: ' + W.error); }
    $('#run').disabled = false;
  };
  $('#run').addEventListener('click', run);
  $('#copy').addEventListener('click', async () => { const t = $('#out'); try { await navigator.clipboard.writeText(t.value); say('copied'); } catch (e) { t.select(); say('select the text and copy it'); } });
  if (AUTO) run();
}

/* ================================================================================================ the driver (node) */
const isMain = typeof process !== 'undefined' && process.versions && process.versions.node && process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) await cli();
async function cli() {
  const o = parseArgs(process.argv.slice(2));
  if (o.errors.length) { console.error('bad arguments: ' + o.errors.join(' · ')); process.exit(2); }
  if (o.compare) { // two reports, no browser
    const fs = await import('node:fs'), path = await import('node:path'), url = await import('node:url');
    const load = f => (f === 'bench' ? JSON.parse(fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'bench.json'), 'utf8'))['ui-fps-mac'] : JSON.parse(fs.readFileSync(f, 'utf8')));
    const [a, b] = o.compare.map(load), r = compareReports(a, b);
    console.log('compare ' + o.compare[0] + ' (' + (a.build || '?') + ') → ' + o.compare[1] + ' (' + (b.build || '?') + '): ' + r.rows.length + ' cells in common');
    if (r.worse.length) console.log('\nWORSE (' + r.worse.length + '):\n  ' + r.worse.join('\n  '));
    if (r.better.length) console.log('\nBETTER (' + r.better.length + '):\n  ' + r.better.join('\n  '));
    if (r.missing.length) console.log('\nNOT COMPARED (' + r.missing.length + '):\n  ' + r.missing.join('\n  '));
    console.log('\n' + (r.worse.length ? r.worse.length + ' regression(s)' : 'no regression') + ', ' + r.better.length + ' improvement(s)');
    process.exit(o.gate && r.worse.length ? 1 : 0);
  }
  if (o.list) {
    const cells = matrix({ sizes: o.sizes, scenes: o.scenes, caps: o.caps, throttles: o.throttles, display: o.display, cross: o.cross });
    console.log('scenes: ' + SCENE_IDS.join(', ') + '\ncells: ' + cells.length + ' (' + o.sizes.length + ' size × ' + o.scenes.length + ' scenes × ' + o.throttles.length + ' throttles × ' + o.caps.length + ' caps) ≈ ' + Math.round(cells.length * (o.warm + o.measure + 1500) / 60000) + ' min + builds');
    return;
  }
  const rep = await drive(o);
  const lines = summarize(rep);
  if (!o.quiet) console.log('\n' + lines.join('\n'));
  const failed = rep.cells.filter(c => !c.pass).length, checks = rep.checks.filter(c => !c.pass).length;
  console.log('\nui-bench-fps: ' + rep.cells.length + ' cells, ' + failed + ' with a failed gate, ' + checks + ' of ' + rep.checks.length + ' checks failed' + (rep.aborted.length ? ', ' + rep.aborted.length + ' scene(s) aborted: ' + rep.aborted.join('; ') : ''));
  process.exit(o.gate && (failed || checks || rep.aborted.length) ? 1 : 0);
}
/** Runs the matrix in Chrome for Testing; → the report { kind: 'ui-fps', cells: [...], aborted: [...] , … }. */
export async function drive(o) {
  const [http, fs, path, os, url, cp] = await Promise.all(['node:http', 'node:fs', 'node:path', 'node:os', 'node:url', 'node:child_process'].map(m => import(m)));
  const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
  const say = t => { if (!o.quiet) console.log(t); };
  const findChrome = () => { // $CHROME, else Chrome for Testing in the repo's .claude/test-browser (looked for from the repo up: a worktree sits inside it)
    if (process.env.CHROME) return process.env.CHROME;
    for (let dir = ROOT, i = 0; i < 5; i++, dir = path.dirname(dir)) {
      const tb = path.join(dir, '.claude', 'test-browser');
      if (!fs.existsSync(tb)) continue;
      for (const v of fs.readdirSync(tb).sort().reverse()) {
        const exe = path.join(tb, v, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
        if (fs.existsSync(exe)) return exe;
      }
    }
    throw new Error('no Chrome for Testing: set $CHROME');
  };
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
  // the app, as the repo has it (never port 8817), cross-origin isolated (SharedArrayBuffer for the virtual display's worker), no cache
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p), rel = path.relative(ROOT, f);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some(x => x.startsWith('.'))) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (e, data) => {
      if (e) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
      res.end(data);
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port, base = 'http://127.0.0.1:' + port;
  const prof = fs.mkdtempSync(path.join(o.profile || process.env.FPS_PROFILE || os.tmpdir(), 'fps-chrome-'));
  const flags = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + prof, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb',
    '--use-angle=metal', '--force-device-scale-factor=2', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-frame-rate-limit', '--disable-gpu-vsync',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'];
  const ch = cp.spawn(findChrome(), flags, { stdio: ['ignore', 'ignore', 'pipe'] });
  const bye = () => { try { ch.kill(); } catch (e) { /* gone */ } }; // Chrome never outlives the harness (a Ctrl-C included)
  process.once('exit', bye); process.once('SIGINT', () => { bye(); process.exit(130); }); process.once('SIGTERM', () => { bye(); process.exit(143); });
  const git = (...a) => { try { return cp.spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim(); } catch (e) { return ''; } };
  const rep = { kind: 'ui-fps', v: VERSION, when: new Date().toISOString(), build: git('rev-parse', '--short', 'HEAD') + (git('status', '--porcelain', '--', '*.js', 'index.html', 'style.css') ? '+dirty' : ''),
    machine: os.cpus()[0].model + ', ' + os.arch() + ', node ' + process.version, chrome: '', ua: '', pace: 'virtual display (Worker Atomics.wait ticks), --disable-frame-rate-limit --disable-gpu-vsync',
    config: { sizes: o.sizes, scenes: o.scenes, caps: o.caps, throttles: o.throttles, display: o.display || 'cap', warmMs: o.warm, measureMs: o.measure, layoutGate: o.layoutGate }, scenes: {}, cells: [], checks: [], aborted: [] };
  let ws = null;
  const cleanup = async () => { try { if (ws) ws.close(); } catch (e) { /* closed */ } ch.kill(); srv.close(); await new Promise(r => setTimeout(r, 700)); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* busy */ } };
  try {
    const wsUrl = await new Promise((res, rej) => { let b = ''; const t = setTimeout(() => rej(new Error('Chrome did not start')), 30000); ch.stderr.on('data', x => { b += x; const m = /DevTools listening on (ws:\/\/\S+)/.exec(b); if (m) { clearTimeout(t); res(m[1]); } }); ch.on('exit', () => rej(new Error('Chrome exited'))); });
    ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('devtools socket')); });
    let id = 0; const pend = new Map(), logs = new Map(); // sessionId → [console errors / exceptions]
    ws.onmessage = m => {
      const x = JSON.parse(m.data);
      if (x.id && pend.has(x.id)) { const { r, j } = pend.get(x.id); pend.delete(x.id); x.error ? j(new Error(x.error.message || JSON.stringify(x.error))) : r(x.result); return; }
      const L = logs.get(x.sessionId);
      if (!L) return;
      if (x.method === 'Runtime.exceptionThrown') L.push('exception: ' + ((x.params.exceptionDetails.exception || {}).description || x.params.exceptionDetails.text).slice(0, 300));
      else if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') L.push('console.error: ' + x.params.args.map(a => (a.value != null ? a.value : a.description)).join(' ').slice(0, 300));
    };
    ws.onclose = () => { for (const { j } of pend.values()) j(new Error('Chrome closed')); pend.clear(); };
    const send = (method, params = {}, sessionId) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); ws.send(JSON.stringify(Object.assign({ id: i, method, params }, sessionId ? { sessionId } : {}))); });
    const timed = (p, ms, what) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error('timeout (' + ms + ' ms): ' + what)), ms))]);
    await send('Browser.setDownloadBehavior', { behavior: 'deny' }); // never a file in the user's folders
    const ver = await send('Browser.getVersion'); rep.chrome = ver.product; rep.ua = ver.userAgent;
    for (const sk of o.sizes) {
      const SZ = SIZES[sk];
      for (const scene of o.scenes) {
        const cells = matrix({ sizes: [sk], scenes: [scene], caps: o.caps, throttles: o.throttles, display: o.display, cross: o.cross });
        say('\n== ' + SZ.name + ' · ' + scene + ' (' + cells.length + ' cells)');
        // a browser context of its own per scene (in memory): the app starts from its first-run project, never the last scene's; downloads denied in it too
        const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true });
        await send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId });
        const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        const L = []; logs.set(sessionId, L);
        const s = (m, p) => send(m, p, sessionId);
        const ev = async (expr, ms = 60000) => {
          const v = await timed(s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), ms, expr.slice(0, 80));
          if (v.exceptionDetails) throw new Error(((v.exceptionDetails.exception || {}).description || v.exceptionDetails.text || 'exception').slice(0, 400));
          return v.result.value;
        };
        try {
          for (const d of ['Runtime', 'Page', 'Performance', 'HeapProfiler', 'Network']) await s(d + '.enable');
          await s('Network.setBypassServiceWorker', { bypass: true });
          await s('Emulation.setDeviceMetricsOverride', { width: SZ.w, height: SZ.h, deviceScaleFactor: SZ.dpr, mobile: SZ.touch });
          if (SZ.touch) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
          await s('Page.addScriptToEvaluateOnNewDocument', { source: "try { Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: () => undefined, configurable: true }); } catch (e) { /* kept */ }\n" + hooksScript({}) });
          await s('Page.navigate', { url: base + '/index.html?fps=' + o.caps[0] });
          let ok = false;
          for (let i = 0; i < 600 && !ok; i++) { await new Promise(r => setTimeout(r, 100)); try { ok = await ev('!!(window.__fps && window.__synthTest && __synthTest.cv && __synthTest.api && __synthTest.shell && document.querySelector("#world") && __synthTest.cv.world())', 5000); } catch (e) { /* not yet */ } }
          if (!ok) throw new Error('the app did not start');
          await ev("import('/tests/ui-bench-fps.mjs?t=" + Date.now() + "').then(m => { window.__fpsPage = m; return true; })");
          const b = await ev('__fpsPage.buildScene(window, ' + JSON.stringify(scene) + ')', 240000);
          const SC = rep.scenes[sk + '/' + scene] = { info: b.info, notes: b.notes, errors: b.errors.concat(L.slice(0, 10)), callbacks: [], clients: [] };
          rep.checks.push({ id: 'build errors', size: sk, scene, pass: !SC.errors.length && !b.notes.length, value: SC.errors, note: SC.errors.length ? 'console errors while the app started and the scene was built: ' + SC.errors.slice(0, 3).join(' | ') : b.notes.length ? 'the scene did not build as asked: ' + b.notes.join(' | ') : 'none' });
          say('   built in ' + b.info.buildMs + ' ms: ' + JSON.stringify(b.info) + (b.notes.length ? '\n   notes: ' + b.notes.join(' | ') : ''));
          if (!rep.checks.some(x => x.id === 'gear fits' && x.size === sk)) { // the ⚙ line at this viewport, once per size (on the first scene built)
            const g = await ev('__fpsPage.gearCheck(window)');
            rep.checks.push({ id: 'gear fits', size: sk, pass: !!g.fits, value: g, note: g.fpsLine ? 'the Frame rate line is inside the popover' + (g.lineInside ? '' : ' — NOT: it is clipped') : 'no Frame rate line yet (before lane K): the popover is ' + (g.fits ? 'inside' : 'NOT inside') + ' the viewport, ' + g.room + ' px of room below it' });
            say('   ⚙ popover: ' + JSON.stringify(g));
          }
          let lastTh = 0;
          for (const c of cells) {
            if (c.throttle !== lastTh) { await s('Emulation.setCPUThrottlingRate', { rate: c.throttle }); lastTh = c.throttle; }
            L.length = 0;
            const cfg = { scene, cap: c.cap, display: c.display, warm: o.warm, throttle: c.throttle };
            const pre = await ev('__fpsPage.prepare(window, ' + JSON.stringify(cfg) + ')', o.warm + 120000);
            const metrics = async () => (await s('Performance.getMetrics')).metrics;
            const eff = effOf(c.display, c.cap), list = EXPECT[scene] || [];
            // one measured window: GC, metrics, record, metrics, finish, GC → the cell with its gates
            const attempt = async () => {
              await s('HeapProfiler.collectGarbage');
              const m0 = await metrics(), h0 = (m0.find(x => x.name === 'JSHeapUsedSize') || {}).value;
              L.length = 0;
              await ev('__fpsPage.begin(window)');
              await new Promise(r => setTimeout(r, o.measure));
              const m1 = await metrics();
              const raw = await ev('__fpsPage.finish(window)');
              await s('HeapProfiler.collectGarbage');
              const m2 = await metrics(), h1 = (m2.find(x => x.name === 'JSHeapUsedSize') || {}).value;
              const x = { size: sk, sizeName: SZ.name, scene, cap: c.cap, display: c.display, throttle: c.throttle, via: pre.via, notes: pre.notes, clockAtWarm: pre.clock,
                layoutGate: o.layoutGate === 'all' || (o.layoutGate === 'idle' && LAYOUT_SCENES.includes(scene)),
                frames: { delivered: raw.delivered, missed: raw.missed, ms: Math.round(raw.ms), display: c.display, stallMs: raw.dt.max }, frameCost: raw.cost, raf: raw.raf, msg: raw.msg, dt: raw.dt, callbacks: raw.callbacks, handlers: raw.handlers,
                clock: Object.assign({ expectEff: eff }, raw.clock), contract: { med: r3(raw.clock.ms.med + raw.msg.med), p95: r3(raw.clock.ms.p95 + raw.msg.p95) }, cdp: metricsDelta(m0, m1), heap: { before: h0, after: h1 }, heapBytesPerS: h0 != null && h1 != null ? (h1 - h0) / (raw.ms / 1000) : null,
                expect: raw.expectRaw.map((r, i) => evalExpect(list[i], r, { eff, display: c.display, delivered: raw.delivered })), canvases: raw.canvases, dots: raw.dots, errors: raw.errors.concat(L.slice(0, 10)) };
              const v = evalCell(x);
              x.pass = v.pass; x.gates = v.gates;
              return x;
            };
            let cell = await attempt();
            const soft = x => x.gates.filter(g => g.gated && !g.pass && SOFT_GATES.includes(g.id)).map(g => g.id + ' ' + g.value);
            if (soft(cell).length) { // a stalled window (a browser task, a GC: one frame of 800 ms) or one slow layout: measured once more, the second window is the cell's, the first kept beside it
              const first = { soft: soft(cell), stallMs: cell.frames.stallMs, delivered: cell.frames.delivered, layoutStyle: cell.cdp ? r3(cell.cdp.layoutMs + cell.cdp.styleMs) : null };
              await new Promise(r => setTimeout(r, 500));
              const again = await attempt();
              again.retry = first;
              if (soft(again).length <= soft(cell).length) cell = again;
              else cell.retry = Object.assign(first, { worse: true });
            }
            const raw = { delivered: cell.frames.delivered, missed: cell.frames.missed, cost: cell.frameCost, clock: cell.clock, callbacks: cell.callbacks };
            const v = { pass: cell.pass, gates: cell.gates };
            rep.cells.push(cell);
            SC.callbacks.push(raw.callbacks.min); SC.clients.push(Object.values(raw.clock.clients).reduce((a, b) => a + b, 0)); // (the audit: no leak, no double rAF)
            say('   ' + c.throttle + '× cap ' + String(c.cap).padStart(3) + ' disp ' + String(c.display).padStart(3) + '  fps ' + String(raw.delivered).padStart(6) + (raw.missed ? ' (missed ' + raw.missed + ')' : '') + '  cost med ' + raw.cost.med + ' p95 ' + raw.cost.p95 + ' max ' + raw.cost.max +
              '  clock ' + (raw.clock.measured ? raw.clock.eff + '/' + raw.clock.display : '–') + ' ms ' + raw.clock.ms.med + '  L+S ' + r3(cell.cdp.layoutMs + cell.cdp.styleMs) + ' ms/s  heap ' + (cell.heapBytesPerS != null ? Math.round(cell.heapBytesPerS / 1024) + ' KB/s' : '–') +
              '  live ' + cell.expect.filter(x => x.pass).length + '/' + cell.expect.length + (cell.retry ? '  (re-measured: ' + cell.retry.soft.join(', ') + ')' : '') + '  ' + (v.pass ? 'ok' : 'FAIL ' + v.gates.filter(x => x.gated && !x.pass).map(x => x.id).join(', ')));
          }
          const au = auditScene(SC);
          rep.checks.push({ id: 'clients audit', size: sk, scene, pass: au.pass, value: au, note: au.note });
          say('   clients audit: ' + (au.pass ? 'ok' : 'FAIL') + ' — ' + au.note);
          if (scene === 'clip') { // (review 2, P3-6b) the playhead itself through a seek back, a 120 Hz display at 1 ×: no stale anchor, no sawtooth
            await s('Emulation.setCPUThrottlingRate', { rate: 1 }); lastTh = 1;
            await ev('__fpsPage.prepare(window, ' + JSON.stringify({ scene, cap: 120, display: 120, warm: 1500, throttle: 1 }) + ')', 120000);
            const r = await ev('__fpsPage.clipCheck(window)', 60000), pass = !!r.ok && !r.glitches.length && r.moved >= 50;
            rep.checks.push({ id: 'clip playhead', size: sk, scene, pass, value: r, note: !r.ok ? r.why : r.frames + ' frames, ' + r.jumps.length + ' jump(s) (a wrap, the seek), ' + r.glitches.length + ' glitch(es), moved on ' + r.moved + ' % of the steps' + (r.glitches.length ? ': ' + JSON.stringify(r.glitches[0]) : '') });
            say('   clip playhead: ' + (pass ? 'ok' : 'FAIL') + ' — ' + rep.checks.at(-1).note);
          }
        } catch (e) {
          rep.aborted.push(sk + '/' + scene + ': ' + String(e.message || e).slice(0, 200));
          say('   ABORTED: ' + (e.stack || e));
        }
        try { await s('Emulation.setCPUThrottlingRate', { rate: 1 }); } catch (e) { /* gone */ }
        try { await send('Target.closeTarget', { targetId }); } catch (e) { /* gone */ }
        try { await send('Target.disposeBrowserContext', { browserContextId }); } catch (e) { /* gone */ }
        logs.delete(sessionId);
      }
    }
  } finally { await cleanup(); }
  if (o.out) { const fsx = await import('node:fs'); fsx.writeFileSync(o.out, JSON.stringify(rep, null, 1)); }
  if (o.benchRow) { const fsx = await import('node:fs'); fsx.writeFileSync(o.benchRow, JSON.stringify(benchRow(rep), null, 1)); }
  return rep;
}
