// tests/ui-bench-fps.mjs — stage FR's frame-rate harness (docs/canvas/IMPL-FR.md §9 G7, §13 P2-8; lane S).
// Measures what display-rate visuals cost and whether every animated display keeps animating, per scene × frame-rate cap × CPU throttle
// × viewport size, in Chrome for Testing (CDP) — and, as `ui-bench.html?fps=1`, on a device (iPad / Safari: native frames, no CDP).
//   node --max-old-space-size=2048 tests/ui-bench-fps.mjs [--scenes idle,play8,…] [--sizes d,l,p] [--caps 60,120,240] [--throttle 1,4,6]
//        [--display N] [--warm ms] [--measure ms] [--out report.json] [--bench-row row.json] [--profile dir] [--layout-gate idle|all|none]
//        [--no-cross] [--no-gate] [--list] [--quiet] [--skin charcoal|ivory|glass] [--behind]
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
export const SCENE_IDS = Object.freeze(['idle', 'play8', 'roll8', 'tutorial', 'mods', 'master', 'busy', 'clip', 'comb', 'kit', 'auto8', 'auto8r']); // ((AUTO G7) auto8: 16 curves playing (2 rigs, 5 classics, an FX knob), auto8r: the roll open on them; ((MOD1 G6) mods: a Juno's modulators; (LC G6) comb: two Combiners' faces; (DM G9) kit: a kit track, the Starter's 8 voices and the fixture groove, playing; (SX0) the serum scene left with Serum complete (ROADMAP 28) — bench.json's */serum/* cells stay as history
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
 * 'heavy' | 'curve' | Hz), [min (elements needed on screen, default 1)], [any (it is enough that `min` of them paint)], [tol (default 0.8)], [max (Hz: the display's own ceiling — the CLIP roll moves a pixel column at most so often)],
 * [fast (FR Cut B: asked only while the fast lane is live — an element that exists only then)] }.
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
    { name: 'filter display', kind: 'canvas', sel: '[data-cv-mod*="filter"] canvas.sx-disp', rate: 'curve', tol: 0.4 }, // ((Cut B, the user's QB) its curve: ≤ 60 / s on High, 30 on Medium / Low — judged from above too
    { name: 'filter cutoff marker', kind: 'canvas', sel: '[data-cv-mod*="filter"] canvas.sxo-fmark', rate: 'snap', tol: 0.4, fast: true }, // ((Cut B §4.3) the marker overlay at the view's cutoff: every frame under fast — it exists only then (fast: not asked with the lane off)
    { name: 'wavetable position dot', kind: 'attr', attr: 'cx', sel: '[data-dest="a.wt"] .wk-live', box: '[data-dest]', rate: 'snap', any: true },
    { name: 'Ducker GR bar', kind: 'canvas', sel: 'canvas.fxr-gr', rate: 'gr', tol: 0.4 }, // keyed to the kick: it moves with each hit (≈ 18 Hz at 128 BPM), not every post
  ]),
  // (MOD1 G6) a Juno's modulators — one face each, every LFO and Envelope cabled and moving: the six LFO / Envelope faces' playheads (the donors'
  // overlays keep their classes; the LFO's carries the smooth probe's arc hook). The camera frames the modulators and the Juno (the OUT is
  // off screen at every size: no scope asked for)
  mods: Object.freeze([
    { name: 'LFO / ENV playheads', kind: 'canvas', sel: '.gx-lfo canvas.gx-ov, .gx-env canvas.gx-ov', rate: 'snap', min: 6 },
  ]),
  master: Object.freeze([
    { name: 'OUT scope', kind: 'canvas', sel: 'canvas.mo-sc', rate: 'eff' },
    { name: 'OUT meters', kind: 'canvas', sel: 'canvas.mo-mt', rate: 'snap', tol: 0.4 }, // ((Cut B §5.6) change-gated: a frame whose bars did not move paints nothing
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
  // (LC G6) two Combiners' faces (cv-mods-ui combBody): the overlay (lc-view paintOverlay — the playhead at heardTickNow, the live dot) on its
  // `lc` clock client, a new x every painted frame while playing (≥ ¼ px a frame at 128 BPM over 2 bars at 240 Hz): the clock's rate. The
  // curves (canvas.rig-ccv) repaint only on a change (§6.6): not asked here — combProbe counts them. The LFO faces are off screen
  comb: Object.freeze([
    { name: 'Combiner overlays', kind: 'canvas', sel: '[data-rig-kind="comb"] canvas.rig-cov', rate: 'eff', min: 2 },
  ]),
  // (AUTO G7, IMPL-AUTO §4.2) 7 tracks playing — 2 rigs on f.cutoff, 5 classics on their cutoffs, the first rig's Reverb size — 16 curves set through
  // cv.auto.set, each a triangle that moves on every automation tick (lane H1 plays them at the render tick). The shown track is the Minimoog: its cutoff
  // knob follows its curve (P.follow at the display rate, a model-unit write a frame: aria-valuenow), absolute Hz — the follow is not a clock class.
  // The patch stream: every automated track posts a {t: 'patch'} on its ticks; more than 4 tracks with curves are staggered over two ticks (§4.1), so a
  // track posts every 2nd tick of the 60 Hz budget: 30 a second each, 7 ports (kind 'post': one rate per port). The rigs' and the Reverb's faces:
  // autoFaces (a driver check: they are mounted only while their track is shown). auto8r: the roll open on the Minimoog's cutoff lane (the heard value's dot
  // rides the playhead overlay: canvas.proll at the clock's rate; playback does not re-render the roll — only a recorded edit does, autoChanged)
  auto8: Object.freeze([
    { name: 'arrangement playhead', kind: 'canvas', sel: 'canvas.arrange', rate: 'eff' },
    { name: 'head meters', kind: 'attr', attr: 'style', sel: '.head .hmeter i', rate: 'eff', min: 7, tol: 0.2 },
    { name: 'classic cutoff knob follows its curve', kind: 'attr', attr: 'aria-valuenow', sel: '[data-dest="fc"] [aria-valuenow]', rate: 60 },
    { name: 'patch posts per automated track', kind: 'post', t: 'patch', rate: 30, min: 7 },
  ]),
  auto8r: Object.freeze([
    { name: 'arrangement playhead', kind: 'canvas', sel: 'canvas.arrange', rate: 'eff' },
    { name: 'roll playhead', kind: 'canvas', sel: 'canvas.proll', rate: 'eff' },
    { name: 'head meters', kind: 'attr', attr: 'style', sel: '.head .hmeter i', rate: 'eff', min: 7, tol: 0.2 },
    { name: 'patch posts per automated track', kind: 'post', t: 'patch', rate: 30, min: 7 },
  ]),
  // (DM G9) a kit track (kit-ui: the Sequencer + the Starter's 8 voices, the fixture groove playing at 128 BPM). The faces ride the drum host's heard
  // queue, NOT the clock: nothing paints per display frame, only per heard step — a 16th at 128 BPM is 8.53 a second, whatever the cap: so the
  // rates are absolute Hz (the playhead's one transform per step; each lamp / HIT pad a flip per hit of its lane: the groove's hits a bar of 1.875 s)
  kit: Object.freeze([
    { name: 'Sequencer playhead (a transform a heard step)', kind: 'attr', attr: 'style', sel: '.kit-ph', rate: 8.5 },
    { name: 'kick lamp', kind: 'attr', attr: 'data-hit', sel: '.kit-lamp[data-slot="0"]', rate: 2.1, tol: 0.6 },
    { name: 'clap lamp', kind: 'attr', attr: 'data-hit', sel: '.kit-lamp[data-slot="2"]', rate: 1.05, tol: 0.6 },
    { name: 'closed hat lamp', kind: 'attr', attr: 'data-hit', sel: '.kit-lamp[data-slot="3"]', rate: 3.7, tol: 0.6 },
    { name: 'open hat lamp', kind: 'attr', attr: 'data-hit', sel: '.kit-lamp[data-slot="4"]', rate: 0.5, tol: 0.6 },
    { name: 'rim lamp', kind: 'attr', attr: 'data-hit', sel: '.kit-lamp[data-slot="7"]', rate: 0.5, tol: 0.6 },
    { name: 'HIT pads', kind: 'attr', attr: 'data-hit', sel: '.kit-hit', rate: 0.5, tol: 0.6, min: 5, any: true },
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
 * GR / Ducker loops' 30; 'heavy' min(60, the data's rate, eff); 'curve' (the filter display's curve) as 'snap'; a number an absolute Hz.
 * `o.snap` overrides the data rate. (FR Cut B §5.6) `o.fast` (the fast lane live: every view is read at the heard frame, every frame):
 * 'snap' and 'gr' → eff; 'heavy' → min(o.snap ?? eff, E / max(1, floor(E / 60))) (its rate class's own cadence, sx-host rateMs);
 * 'curve' → min(eff, 60) on High (`o.perf`, default High), min(eff, 30) on Medium / Low (the user's QB). Never above `eff`. (Review 2, P1-1)
 * `o.drop`, the frame clock's drop level: 'heavy' / 'curve' halved per level (≥ 15 a second), on Medium / Low 'heavy' ≤ 30 too; under fast
 * from level 2 'snap' / 'gr' at half the cadence, at 30 a second from level 3 (the shed motion's floor). Pure. */
export const CURVE_HZ = Object.freeze({ high: 60, medium: 30, low: 30 });
/** (FR Cut B review 2, P1-1) the heavy displays' own cadence (sx-host heavyMs): k = floor(E / hz) frames (the class) or ceil(E / hz) (a
 * ceiling: the filter curve, every heavy display on Medium / Low — HEAVY_LOW), doubled per drop level (wk.clock.drop()), never below
 * HEAVY_MIN a second → E / k. Pure. */
export const HEAVY_LOW = 30, HEAVY_MIN = 15, SHED_MIN = 30; // (SHED_MIN: wk.js's — the fast lane's motion clients at every other frame from drop level 2, ≥ 30 a second)
export function heavyRate(E, hz, ceil, drop = 0) {
  let k = Math.max(1, ceil ? Math.ceil(E / hz - 1e-9) : Math.floor(E / hz + 1e-9));
  if (drop > 0) k = Math.max(k, Math.min(k * Math.pow(2, drop | 0), Math.floor(E / HEAVY_MIN + 1e-9)));
  return E / k;
}
export function rateOf(cls, eff, o = {}) {
  const snap = o.snap > 0 ? +o.snap : HZ.snap, E = o.eff > 0 ? +o.eff : eff, low = o.perf === 'medium' || o.perf === 'low', L = o.drop > 0 ? o.drop | 0 : 0; // (k from the clock's E — o.eff, evalExpect's ctx — never the frames delivered)
  // (review 2, P1-1) heavy: the 60 class on High, the 30 ceiling on Medium / Low; curve: the preset's ceiling; both halved per drop level
  const heavy = () => heavyRate(E, low ? HEAVY_LOW : HZ.heavyMax, low, L), curve = () => heavyRate(E, CURVE_HZ[o.perf] || CURVE_HZ.high, true, L);
  let hz;
  if (o.fast) {
    if (cls === 'snap' || cls === 'gr') hz = Math.min(eff, E / (L >= 2 ? Math.max(1, L >= 3 ? Math.floor(E / SHED_MIN + 1e-9) : Math.min(2, Math.floor(E / SHED_MIN + 1e-9))) : 1)); // ((review 2) the motion sheds: ½ at level 2, the floor at 3
    else if (cls === 'heavy') hz = Math.min(o.snap > 0 ? +o.snap : eff, heavy());
    else if (cls === 'curve') hz = curve();
    else hz = cls === 'eff' || cls == null ? eff : +cls;
    return r1(Math.min(hz, eff));
  }
  if (cls === 'eff' || cls == null) hz = eff;
  else if (cls === 'snap') hz = snap;
  else if (cls === 'curve') hz = Math.min(snap, curve());
  else if (cls === 'gr') hz = HZ.gr;
  // (review 2, P3-6d — for Cut B) the heavy class paints every k = floor(E / 60) ≥ 1 frames (sx-host rateMs, the lead's 60 minimum):
  // E / floor(E / 60) a second — 82.5 at E 165, 72 at 144, 60 at 120 / 240, E itself at 60–119. Once the data outruns it (the fast lane)
  // the expectation is min(snap, E / floor(E / 60)), not min(60, snap): HZ.heavyMax is the 60-class's floor, not its rate. Fast off the
  // data's 29 is below it (a drop level may take it lower)
  else if (cls === 'heavy') hz = Math.min(snap, heavy());
  else hz = +cls;
  return r1(Math.min(hz, eff));
}
/** One expect entry judged: `got` = { found: n elements matched on screen, rates: [paints per second each] }. Passes when ≥ `min` elements
 * were found and every one (or, with `any`, at least `min` of them) painted ≥ tol × the expected rate — the class's rate at min(eff, the
 * frames delivered: ctx.delivered, / s): a display cannot paint on a frame that never came (review 2, P3-6a; a starved window is the
 * `frames` gate's to judge). From above (a clock-class display on a faster display) against eff itself. (FR Cut B review 2, P1-1) The
 * frame clock's drop levels over the window: from below at its highest (ctx.drop), from above at its lowest (ctx.dropLo). Pure. */
export function evalExpect(entry, got, ctx) {
  const eff = ctx && ctx.eff > 0 ? ctx.eff : 60, del = ctx && ctx.delivered > 0 ? Math.min(eff, ctx.delivered) : eff;
  if (entry.fast && !(ctx && ctx.fast)) return { name: entry.name, rate: entry.rate, expected: 0, limit: 0, found: got ? got.found | 0 : 0, min: 0, med: 0, max: 0, over: 0, pass: true, skipped: true, why: 'the fast lane off: not asked' }; // ((Cut B) an entry that exists only with the fast lane
  const exp = r1(Math.min(rateOf(entry.rate, del, ctx || {}), entry.max > 0 ? entry.max : Infinity)), tol = entry.tol > 0 ? entry.tol : BUDGET.rate; // (max: the display's own ceiling, Hz)
  const rates = ((got && got.rates) || []).map(Number), found = got ? got.found | 0 : 0, need = entry.min >= 0 ? entry.min : 1, lim = r1(exp * tol); // (min 0: "if it is on screen it must paint" — the OUT scope the camera may have left)
  const ok = rates.filter(x => x >= lim);
  const lo = rates.length ? Math.min(...rates) : 0, med = rates.length ? rates.slice().sort((a, b) => a - b)[rates.length >> 1] : 0;
  let pass = found >= need, why = '';
  if (found < need) why = 'found ' + found + ' on screen, need ' + need;
  else if (entry.any ? ok.length < need : ok.length < rates.length) { pass = false; why = (entry.any ? ok.length + ' of ' + rates.length : rates.length - ok.length + ' of ' + rates.length + ' below') + ' at ≥ ' + lim + ' Hz (min ' + r1(lo) + ', med ' + r1(med) + ')'; }
  // the cap holds from above too: on a display faster than the cap (a 240 Hz screen at 120 / 60) a clock-class display paints at the effective rate, never the display's
  // (FR2: no private loop at the display's rate; Medium / Low save main-thread time by this)
  // (FR Cut B §5.6) under fast the filter curve too: it redraws at most 60 / 30 a second whatever the display (the user's QB)
  const hi = r1(rateOf(entry.rate, eff, Object.assign({}, ctx || {}, { drop: ctx && ctx.dropLo > 0 ? ctx.dropLo : 0 })) * 1.25), over = (entry.rate === 'eff' && ctx && ctx.display > 1.05 * eff) || (entry.rate === 'curve' && ctx && ctx.fast) ? rates.filter(x => x > hi).length : 0;
  if (over) { pass = false; why = (why ? why + '; ' : '') + over + ' of ' + rates.length + ' above the cap: > ' + hi + ' Hz' + (ctx.display ? ' on a ' + ctx.display + ' Hz display' : '') + ' (max ' + r1(Math.max(...rates)) + ')'; }
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
/** (FR Cut B §7 G7) the smooth probe's verdict: `xs` = the LFO 1 overlay's drawn x per painted frame (NaN: nothing drawn yet) → { n,
 * moved (the share of frames whose x differs from the previous one), cv (the coefficient of variation of |Δx| over the steps in the
 * probe's own direction — the median step's sign: a backward LFO's too —, the wraps the other way excluded), wraps, pass: moved ≥ 0.9 and
 * cv ≤ 0.3 }. At c515abf a 29 Hz probe on a 240 Hz display moves on ≈ 29 / 240 of the frames: that is "240 visibly smoother than 120". Pure. */
export function smoothOf(xs) {
  const a = Array.from(xs || [], Number), n = a.length, d = [];
  let moved = 0;
  for (let i = 1; i < n; i++) { const p = a[i - 1], c = a[i]; if (!(p === p && c === c)) continue; if (c !== p) moved++; d.push(c - p); }
  const nz = d.filter(x => x !== 0).sort((x, y) => x - y), dir = nz.length ? Math.sign(nz[nz.length >> 1]) : 1;
  const fw = d.filter(x => !(Math.sign(x) === -dir)).map(Math.abs), wraps = d.length - fw.length;
  const mean = fw.length ? fw.reduce((x, y) => x + y, 0) / fw.length : 0;
  const sd = fw.length ? Math.sqrt(fw.reduce((x, y) => x + (y - mean) * (y - mean), 0) / fw.length) : 0;
  const mv = n > 1 ? moved / (n - 1) : 0, cv = mean > 0 ? sd / mean : Infinity;
  return { n, moved: r3(mv), cv: cv === Infinity ? cv : r3(cv), wraps, pass: n > 1 && mv >= 0.9 && cv <= 0.3 };
}
/** (FR Cut B §7 G8, §5.6 --load) the load protocol: `cycles` pairs, each [fast on `ms`, fast off `ms`] (the A/B) then the A/A [off, off] —
 * interleaved, so a drift of the machine lands on both arms. Pure. */
export function loadPlan(cycles = 10, ms = 5000) {
  const out = [];
  for (let k = 0; k < cycles; k++) out.push({ arm: 'ab', fast: true, ms, pair: k }, { arm: 'ab', fast: false, ms, pair: k }, { arm: 'aa', fast: false, ms, pair: k }, { arm: 'aa', fast: false, ms, pair: k });
  return out;
}
const median = L => { const s = L.filter(x => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
/** The load protocol's results ([{ arm, fast, pair, load }], each phase's mean DSP load of every node) → { delta (the paired median of
 * on − off), spread (the paired median of |A/A₁ − A/A₂|: the noise), limit = max(0.005, 2 × spread), pass: delta ≤ limit, pairs }. Pure. */
export function loadVerdict(res) {
  const by = new Map();
  for (const r of res || []) { if (!r || !(r.load >= 0)) continue; const P = by.get(r.pair) || by.set(r.pair, { on: [], off: [], aa: [] }).get(r.pair); (r.arm === 'aa' ? P.aa : r.fast ? P.on : P.off).push(+r.load); }
  const d = [], a = [];
  for (const P of by.values()) {
    if (P.on.length && P.off.length) d.push(median(P.on) - median(P.off));
    if (P.aa.length >= 2) a.push(Math.abs(P.aa[0] - P.aa[1]));
  }
  const delta = median(d), spread = a.length ? median(a) : 0, limit = Math.max(0.005, 2 * spread);
  return { delta, spread, limit, pairs: d.length, pass: d.length > 0 && delta <= limit };
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
const PREVIEW_PORT = 8800 + 17; // (.claude/launch.json's preview server: never port 8817 for the harness)
/** argv → options (unknown flags ignored; lists comma-separated; numbers checked). Pure. */
export function parseArgs(argv) {
  const o = { sizes: ['d'], scenes: SCENE_IDS.slice(), caps: CAPS.slice(), throttles: THROTTLES.slice(), display: 0, cross: true, warm: 3200, measure: 4000, out: null, benchRow: null, profile: null, list: false, quiet: false, gate: true, layoutGate: 'idle', compare: null, skin: null, behind: false,
    fast: true, load: false, serve: false, port: 0, perf: null, errors: [] }; // ((FR Cut B §5.6) --fast on|off: the fast lane through __synthTest.fr.force; --load: G8's protocol; --serve --port: a device's result; (review 2) --perf: the preset of every cell
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
    else if (a === '--skin') { if (/^[a-z]+$/.test(v || '')) o.skin = v; else o.errors.push('--skin: ' + v); i++; } // ((WC-2) the scenes in a skin (the ⚙ line's own path)
    else if (a === '--behind') o.behind = true; // ((WC-2) "Cables behind modules" on (the toolbar toggle's own path)
    else if (a === '--compare') { if (v && argv[i + 2]) o.compare = [v, argv[i + 2]]; else o.errors.push('--compare needs two report files'); i += 2; }
    else if (a === '--fast') { if (v === 'on' || v === 'off') o.fast = v === 'on'; else o.errors.push('--fast: ' + v); i++; }
    else if (a === '--load') o.load = true;
    else if (a === '--perf') { if (['high', 'medium', 'low'].includes(v)) o.perf = v; else o.errors.push('--perf: ' + v); i++; } // ((review 2, P1-1) the app's preset — ⚙'s own select — for every cell
    else if (a === '--serve') o.serve = true;
    else if (a === '--port') { const n = num('port', v, 1024, 65535); if (n != null && n === PREVIEW_PORT) o.errors.push('--port: the preview server\'s'); else if (n != null) o.port = n; i++; }
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
      'heap ' + (c.heapBytesPerS != null ? Math.round(c.heapBytesPerS / 1024) + ' KB/s' : '–'), ...(c.clock && c.clock.drop && c.clock.drop.hi > 0 ? ['drop ' + c.clock.drop.lo + '–' + c.clock.drop.hi] : []), // ((review 2) the frame clock's drop levels, when any
      c.pass ? 'ok' : 'FAIL ' + c.gates.filter(x => x.gated && !x.pass).length].join('  '));
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

/** (AUTO G7) The posts of a window → { perS (every message), patchPerS (the {t: 'patch'} ones), byT (per second per message type), ports: [{ perS, eng }] (the patch
 * stream per port — one port is one track's node —, fastest first) }. `posts` = { n, byT, ports: [{ n, eng }] } as installHooks' end() returns it, `secs` the window. Pure. */
export function postsOf(posts, secs) {
  const P = posts || { n: 0, byT: {}, ports: [] }, k = secs > 0 ? secs : 1;
  const byT = Object.fromEntries(Object.entries(P.byT || {}).map(([t, n]) => [t, r1(n / k)]));
  const ports = (P.ports || []).map(p => ({ perS: r1(p.n / k), eng: p.eng || '' })).sort((a, b) => b.perS - a.perS);
  return { perS: r1((P.n || 0) / k), patchPerS: r1((P.byT && P.byT.patch || 0) / k), byT, ports };
}
/** (AUTO G7, IMPL-AUTO §4.2 "a 120 Hz display posts no more than a 60 Hz one") the patch stream of a scene's cells at 1 ×, judged against the 60 Hz cap's cell: every other cell
 * (cap 120 on a 120 or 240 Hz display, cap 60 on a 240 Hz one — and a 240 cap when it was run) posts no more patches a second than the 60 cap's (+ 10 % and 2 a second:
 * the window's edges), and no port posts more than its 60 Hz peer (rank for rank). `cells` = the report's cells of one size and scene. → { pass, rows: [{ key, patchPerS, limit, ports, pass }], note }. Pure. */
export function autoCapCheck(cells, o = {}) {
  const at1 = (cells || []).filter(c => c.throttle === 1 && c.posts), base = at1.find(c => c.cap === 60 && c.display === 60), slack = o.slack != null ? o.slack : 0.1, add = o.add != null ? o.add : 2;
  if (!base) return { pass: false, rows: [], note: 'no 1 × cell at cap 60 on a 60 Hz display to compare with' };
  const lim = base.posts.patchPerS * (1 + slack) + add, rows = at1.filter(c => c !== base).map(c => {
    const pp = c.posts.ports.map(p => p.perS), peers = base.posts.ports.map(p => p.perS);
    const portsOk = pp.every((v, i) => v <= (peers[i] != null ? peers[i] : Math.max(0, ...peers)) * (1 + slack) + add);
    return { key: 'cap ' + c.cap + (c.display !== c.cap ? '@' + c.display : ''), patchPerS: c.posts.patchPerS, limit: r1(lim), ports: pp, pass: c.posts.patchPerS <= lim && portsOk };
  });
  return { pass: base.posts.patchPerS > 0 && rows.every(r => r.pass), rows, note: 'cap 60: ' + base.posts.patchPerS + ' patches/s over ' + base.posts.ports.length + ' ports (' + base.posts.ports.map(p => p.perS).join(' ') + '); ' + rows.map(r => r.key + ': ' + r.patchPerS + (r.pass ? '' : ' (> ' + r.limit + ')')).join(' · ') + (base.posts.patchPerS > 0 ? '' : ' — NO PATCHES POSTED: the automation is not live') };
}

/** (AUTO G7) The faces' follow (autoFaces): every control that follows its curve moves on ≥ 0.8 × the 60 Hz tick (a write a frame at the display's rate: never fewer than the tick),
 * and the frame cost of the shown track's faces within the 1 × budget (med ≤ 2, p95 ≤ 4 ms). `r` = { per: [{ name, found, rates: [Hz per element], cost: q }] } → [[name, value, limit]] with
 * the value ≤ its limit passing (a rate as its negative). Pure. */
export const AUTO_FACE_HZ = 48;
export function autoFaceGates(r) {
  const G = [], b = costBudget(1, 60), n = x => (typeof x === 'number' && isFinite(x) ? x : Infinity);
  for (const p of (r && r.per) || []) {
    G.push([p.name + ': found on screen', p.found >= 1 ? 0 : 1, 0], [p.name + ': slowest element ≥ ' + AUTO_FACE_HZ + ' Hz', p.rates && p.rates.length ? -Math.min(...p.rates) : Infinity, -AUTO_FACE_HZ]);
    if (p.cost) G.push([p.name + ': frame cost med ≤ ' + b.med + ' ms', n(p.cost.med), b.med], [p.name + ': frame cost p95 ≤ ' + b.p95 + ' ms', n(p.cost.p95), b.p95]);
  }
  return G;
}
/** (DM G9) The kit probe's gates at a CPU throttle → [[name, value, limit]] (a value ≤ its limit passes; "≥ x" as −value ≤ −x). Pure. */
export function KIT_GATES(th, r) {
  const P = (r && r.per) || {}, n = x => (typeof x === 'number' && isFinite(x) ? x : Infinity), W = P.writes || {}, G = [];
  if (th === 1) G.push(['seq frame med ≤ 0.1 ms', n(P.seq && P.seq.med), 0.1], ['playhead writes a callback ≤ 1', n(W.maxPh), 1], ['flips a callback ≤ 16', n(W.maxFlip), 16], ['other writes a callback 0', n(W.maxOther), 0], ['Sequencer frames that wrote nothing 0', n(W.quietSeq), 0], ['layout-forcing reads 0', n(P.layoutReads), 0],
    ['playhead behind the heard step ≤ 2 frames', n(P.lag), 2], ['heard steps the playhead skipped 0', n(P.skipped), 0], ['grid repaints while playing 0', n(P.gridPaints), 0], ['no kit clock client', (r.kitClients || []).length, 0]);
  G.push(['a tap repaints the grid once', Math.abs(n(r.tap && r.tap.gridPerEdit) - 1), 0], ['a pattern switch repaints the grid once', Math.abs(n(r.pat && r.pat.gridPerEdit) - 1), 0]);
  if (th === 4) G.push(['tap: grid repaint frame med ≤ 2 ms', n(r.tap && r.tap.seq.med), 2], ['pattern switch: repaint frame med ≤ 2 ms', n(r.pat && r.pat.seq.med), 2]);
  return G;
}
/** The kit probe's numbers as a line. Pure. */
export function kitNote(r) {
  const P = (r && r.per) || {}, f = (k, L) => (L ? k + ' ' + L.call.med + '/' + L.call.max + ' + frame ' + L.seq.med + '/' + L.seq.max + (L.voices.med ? ' + voices ' + L.voices.med : '') + ' worst rAF ' + L.rafMax.max + ' gap ' + L.gapMax.max : k + ' –');
  return 'seq frame ' + (P.seq ? P.seq.med + '/' + P.seq.p95 + '/' + P.seq.max : '–') + ' voice ' + (P.voice ? P.voice.med : '–') + ' (' + P.seqCallbacks + ' + ' + P.voiceCallbacks + ' calls), ' + P.stepsPerS + ' steps/s, playhead lag ' + P.lag + ' frames (on the heard step ' + P.tracks + '), skipped ' + P.skipped + ', moved on ' + P.seqFramesMoved + ' of ' + P.seqFrames + ' Sequencer frames, ' + (P.writes ? P.writes.quietSeq + ' / ' + P.writes.quietVoice : '–') + ' Sequencer / voice frames wrote nothing' + ', writes ' + JSON.stringify(P.writes && { ph: P.writes.ph, flips: P.writes.flips, other: P.writes.other, maxPh: P.writes.maxPh, maxFlip: P.writes.maxFlip }) + ', reads ' + P.layoutReads
    + ' | ' + [f('tap', r.tap), f('pattern', r.pat), f('add', r.add), f('remove', r.remove)].join(' | ');
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
  // (AUTO G7) the page's posts: every MessagePort.postMessage while recording (a node's port is a MessagePort) counted per message type {t}, and the
  // {t: 'patch'} ones per port with the engine of the last (one port = one track's node): the automation tick's patch stream (IMPL-AUTO §4.1)
  let postN = 0, postT = {}, postP = new Map();
  const PM = MP && MP.postMessage;
  if (typeof PM === 'function') MP.postMessage = function (m) {
    if (F.on && m && typeof m === 'object') {
      const k = typeof m.t === 'string' ? m.t : '?';
      postN++; postT[k] = (postT[k] || 0) + 1;
      if (k === 'patch') { let e = postP.get(this); if (!e) postP.set(this, (e = { n: 0, eng: '' })); e.n++; if (m.p && typeof m.p.engine === 'string') e.eng = m.p.engine; }
    }
    return PM.apply(this, arguments);
  };
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
    si = 0; msgAcc = 0; msgN = 0; msgMs = 0; byType = {}; postN = 0; postT = {}; postP = new Map(); t0 = now(); f0 = F.frame; miss0 = F.missed; del0 = F.delivered; epoch++;
    for (const w of seen) { const c = w.deref(), d = c && cvData.get(c); if (d) { d.n = 0; d.ops = 0; d.last = -1; } }
    F.on = true;
  };
  F.end = () => {
    F.on = false;
    const ms = now() - t0;
    return { ms, frames: F.frame - f0, delivered: F.delivered - del0, missed: F.missed - miss0, raf: Array.from(sRaf.subarray(0, si)), msg: Array.from(sMsg.subarray(0, si)), dt: Array.from(sDt.subarray(0, si)),
      cbs: Array.from(sN.subarray(0, si)), msgN, msgMs, byType, posts: { n: postN, byT: Object.assign({}, postT), ports: Array.from(postP.values()).map(e => ({ n: e.n, eng: e.eng })) } };
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
  async mods(A) { // (MOD1 G6) a Juno with 4 LFOs, 2 Envelopes, 1 Macros, a CC, a Chaos and the wheel — each a face; every LFO and Envelope cabled on a Juno knob, playing
    await prelude(A, 0);
    A.shell.srcPick('juno60', 'track'); await mounted(A);
    const t = A.trk(), dev = t.prim, made = {}, L = [['l1', 'lfo'], ['l2', 'lfo'], ['l3', 'lfo'], ['l4', 'lfo'], ['e1', 'env'], ['e2', 'env'], ['m1', 'macro'], ['c1', 'cc'], ['h1', 'chaos'], ['wheel', 'wheel']];
    // dropped as two rows of five left of the Juno (Tidy's one column is taller than any viewport at the canvas's least zoom): each where it lands
    L.forEach(([w, k], i) => { try { made[w] = A.cv.mod.add(k, { x: -2048 + (i % 5) * 384, y: Math.floor(i / 5) * 576 }); if (!made[w]) A.notes.push('mod ' + k + ' refused'); } catch (e) { A.notes.push('mod ' + k + ': ' + e.message); } });
    await mounted(A);
    for (const [w, pid] of [['l1', 'cf'], ['l2', 'rs'], ['l3', 'hp'], ['l4', 'lv'], ['e1', 'ep'], ['e2', 'nz'], ['m1', 'sb']]) {
      const src = made[w] ? made[w] + (w === 'm1' ? '.k1' : '.out') : null;
      try { if (!src || !A.cv.mod.connect(src, dev + ':' + pid)) A.notes.push('row ' + w + ' → ' + pid + ' refused'); } catch (e) { A.notes.push('row ' + w + ': ' + e.message); }
    }
    await mounted(A);
    A.cv.world().fit({ ids: Object.values(made).filter(Boolean).concat(dev), animate: false }); await sleep(500); // (the modulators and the Juno framed)
    A.cv.setProjectBpm(128);
    await audioOn(A);
    A.api.clipToTrack(t.id, chordNotes(2 * PPQ));
    await sleep(300); await startPlay(A);
  },
  async comb(A) { // (LC G6) a Juno with 8 track LFOs (GLOBAL, FREE: BPM-anchored and Hz, one SMOOTHed) into 2 Combiners × 4 (Add 1 bar, Multiply 2 bars), each OUT on a Juno knob, playing
    const CORE = await A.imp('serum-core.js'), hzN = hz => Math.pow(hz / 100, 0.25), lad = l => CORE.LFO_LADDER.findIndex(x => x.label === l) / (CORE.LFO_LADDER.length - 1);
    await prelude(A, 0);
    A.shell.srcPick('juno60', 'track'); await mounted(A);
    const t = A.trk(), dev = t.prim, L = [], X = [], lf = (bpm, anchor, extra) => Object.assign({ lfo: Object.assign({ mode: 'free', mono: 1, bpm, anchor }, extra && extra.lfo) }, extra && extra.k);
    const ST = [lf(1, 1, { k: { rate: lad('1/4') } }), lf(0, 0, { k: { rate: hzN(0.7) } }), lf(1, 1, { k: { rate: lad('1/2') } }), lf(0, 0, { lfo: { type: 'path' }, k: { rate: hzN(1.3), smooth: 0.3 } }),
      lf(1, 1, { k: { rate: lad('1/8') } }), lf(0, 0, { k: { rate: hzN(0.4) } }), lf(1, 1, { k: { rate: lad('1 bar') } }), lf(0, 0, { k: { rate: hzN(2.1) } })];
    // the LFOs two rows of four far left (off screen: the camera frames the combiners and the Juno), the combiners between them and the Juno
    ST.forEach((s, i) => { try { const k = A.cv.mod.add('lfo', { x: -3600 + (i % 4) * 384, y: Math.floor(i / 4) * 576 }); if (!k) { A.notes.push('lfo ' + i + ' refused'); return; } L.push(k); if (!A.cv.mod.comb(k).edit(s)) A.notes.push('lfo ' + k + ' state refused'); } catch (e) { A.notes.push('lfo ' + i + ': ' + e.message); } }); // (o.edit = modEditState(key): an LFO's own step)
    for (let j = 0; j < 2; j++) { try { const k = A.cv.mod.add('comb', { x: -1100, y: j * 560 }); if (k) X.push(k); else A.notes.push('comb ' + j + ' refused'); } catch (e) { A.notes.push('comb ' + j + ': ' + e.message); } }
    await mounted(A);
    const AMT = [[0.5, -0.3, 0.4, 0.25], [0.6, 0.5, 0.7, 0.4]];
    X.forEach((x, j) => {
      for (let k = 0; k < 4; k++) {
        const l = L[j * 4 + k];
        try { const row = l && A.cv.mod.connect(l + '.out', x + ':in'); if (!row) A.notes.push('row ' + l + ' → ' + x + ' refused'); else A.cv.mod.comb(x).setAmt(row, AMT[j][k], 'set'); } catch (e) { A.notes.push('row ' + l + ': ' + e.message); }
      }
      try { if (!A.cv.mod.connect(x + '.out', dev + ':' + (j ? 'rs' : 'cf'))) A.notes.push('row ' + x + ' → Juno refused'); } catch (e) { A.notes.push('row ' + x + '.out: ' + e.message); }
    });
    try { if (X[1] && !A.cv.mod.comb(X[1]).edit({ mode: 'mul', win: 2 })) A.notes.push('comb 2: mode / window refused'); } catch (e) { A.notes.push('comb 2 edit: ' + e.message); }
    await mounted(A);
    A.cv.world().fit({ ids: X.concat(dev), animate: false }); await sleep(500); // (the combiners and the Juno framed)
    A.cv.setProjectBpm(128);
    await audioOn(A);
    A.api.clipToTrack(t.id, chordNotes(2 * PPQ));
    await sleep(300); await startPlay(A);
  },
  async kit(A) { // (DM G9) a kit track (the kit tile's action on a new track: the Starter's 8 voices), the fixture groove painted cell by cell through cv.kit, framed whole, 128 BPM, playing
    const KF = await A.win.Function('u', 'return import(u)')(new URL('tests/kit-fixtures.mjs', A.doc.baseURI).href), wk = await wkOf(A);
    await prelude(A, 0);
    A.win.__kitBase = wk.clock.clients(); // (the clock's clients before the kit: it must add none)
    const id = A.cv.kit.add(null);
    if (!id) { A.notes.push('cv.kit.add refused'); return; }
    A.win.__kitId = id;
    await mounted(A);
    for (const c of KF.GROOVE.cells) if (!A.cv.kit.cell(id, c.l, c.s, c.v)) A.notes.push('cell ' + c.l + '/' + c.s + ' refused');
    await fitCanvas(A); // (Tidy: the voices in rows of four under the Sequencer; then the camera on the lot)
    A.cv.setProjectBpm(128);
    await audioOn(A);
    await sleep(300); await startPlay(A);
    if (A.cv.kit.state(id).voices.length !== 8) A.notes.push('the kit has ' + A.cv.kit.state(id).voices.length + ' voices, not the Starter\'s 8');
  },
  // (AUTO G7, §4.2) the project's classic + 4 more (5 classics), 2 rigs (a Reverb in the first's effects), each track an 8th-note line, 128 BPM;
  // 16 curves over the 4 bars (a triangle a bar, each its own phase): the 5 classics' cutoff + pan, the rigs' f.cutoff + volume, the Reverb's
  // size and the second rig's resonance — through cv.auto.set (no recording; lane H1 plays them). Phase 0: the stubs — the scene runs today
  // with the curves inert
  async auto8(A) {
    await prelude(A, 700);
    for (const m of ['juno60', 'prophet5', 'obxa', 'jupiter8']) { A.shell.srcPick(m, 'track'); await mounted(A); }
    const rigs = [];
    for (let i = 0; i < 2; i++) { A.shell.srcPick('rig', 'track'); await mounted(A); rigs.push(A.trk().id); }
    A.api.selectTrack(rigs[0]); await mounted(A);
    A.cv.fx.addEffect(A.trk().prim + '/fx', 'rev'); await mounted(A);
    A.cv.setProjectBpm(128);
    await audioOn(A);
    const P = A.api.project(), au = A.cv.auto, curves = [];
    P.tracks.forEach((t, i) => A.api.clipToTrack(t.id, arpNotes(i, (i % 3) * 12 - 12)));
    const tri = (lo, hi, ph) => Array.from({ length: 9 }, (_, k) => [k * 2 * PPQ, (k + ph) % 2 ? hi : lo]); // (a corner every half bar: up a half, down a half)
    const curve = (tid, key, ph) => { const g = au && au.range(tid, key); if (!g) { A.notes.push('no automation range: ' + key); return; } const lo = g.lo + (g.hi - g.lo) * 0.2, hi = g.lo + (g.hi - g.lo) * 0.8; if (au.set(tid, key, tri(lo, hi, ph))) curves.push(key); else A.notes.push('curve refused: ' + key); };
    if (!au) A.notes.push('no cv.auto (before AUTO phase 0)');
    else P.tracks.forEach((t, i) => {
      const dev = t.prim, rig = rigs.includes(t.id);
      if (rig) { curve(t.id, dev + ':f.cutoff', i); curve(t.id, 'mix:vol', i + 1); if (t.id === rigs[0]) curve(t.id, dev + ':fx.rev.size', i); else curve(t.id, dev + ':f.res', i + 1); return; }
      const cut = ['cf', 'fc'].map(id => dev + ':' + id).find(k => au.ok(t.id, k)); // (the classics' cutoffs: cf on four of them, fc on the Minimoog)
      if (cut) curve(t.id, cut, i); else A.notes.push(t.name + ': no cutoff to automate');
      curve(t.id, 'mix:pan', i + 1);
    });
    if (curves.length !== 16) A.notes.push(curves.length + ' curves, not 16');
    A.api.selectTrack(P.tracks[0].id); await mounted(A); // (the shown track: the project's Minimoog — its cutoff knob is the classic face that follows its curve; the rigs' and the Reverb's are checked by autoFaces)
    A.shell.topSet(700, 'end'); await sleep(500);
    await startPlay(A);
  },
  async auto8r(A) { // (the same, the roll open on the shown track's automated lane — its cutoff curve: the curve, the heard value's dot on the playhead — §5.2)
    await BUILD.auto8(A);
    A.shell.openTab('roll'); await sleep(600);
    try {
      const R = A.api.roll(), t = A.trk(), L = (A.cv.auto.lanes(t.id) || []).find(x => !x.inert);
      if (!R || !L) A.notes.push('no automated lane to show on ' + t.name);
      else { R.host.setAutoLane(t, L.key); if (A.cv.auto.lane(t.id) !== L.key) A.notes.push('the roll is not on the lane ' + L.key); }
    } catch (e) { A.notes.push('roll lane: ' + e.message); }
    await sleep(600);
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
export async function buildScene(win, id, o = {}) {
  if (!BUILD[id]) throw new Error('no scene ' + id);
  const A = appOf(win), t0 = win.performance.now();
  if (A.F) A.F.setHz(60); // a 60 Hz display while building (the clock measures it; a free-running rAF would leave it a stale 1000); the browser's own frames without a virtual display
  if (o.skin) { const ks = A.shell.shell && A.shell.shell.skinSel; if (ks) { ks.value = o.skin; ks.onchange(); } else A.notes.push('no skin line (⚙ → <NAME> skin): the default skin'); } // ((WC-2) the person's own path
  if (o.behind) { try { A.cv.world().setBehind(true); } catch (e) { A.notes.push('setBehind: ' + e.message); } }
  await BUILD[id](A);
  await sleep(1200);
  const V = A.cv.view(), P = A.api.project(), canv = Array.from(A.doc.querySelectorAll('canvas')), vw = win.innerWidth, vh = win.innerHeight;
  const on = el => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh; };
  const info = { tracks: P.tracks.length, modules: V && V.modules ? V.modules.size : 0, canvases: canv.length, canvasesOnScreen: canv.filter(on).length, dots: A.doc.querySelectorAll('.wk-live').length,
    bpm: P.bpm, playing: !!A.api.transport().playing, audio: A.api.ctx() ? A.api.ctx().state : 'none', buildMs: Math.round(win.performance.now() - t0), viewport: [vw, vh, win.devicePixelRatio], coarse: !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches) };
  { const W = A.cv.world(), L = W && W.cords ? W.cords() : null, sg = L && L.stats ? L.stats().glass : null; // ((WC-2) the skin and the cables-behind state measured
    Object.assign(info, { skin: A.doc.querySelector('#world') ? A.doc.querySelector('#world').getAttribute('data-cv-skin') : null, behind: !!(W && W.behindOn && W.behindOn()), glass: sg || null }); }
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
  // (FR Cut B §5.6) --fast on | off through the app's own override (__synthTest.fr.force: null = the preset's rate, 0 = off); a build
  // before Cut B has no fast lane: its classes are judged as before (out.fast false)
  const fr = A.T.fr;
  if (cfg.perf) { // ((FR Cut B review 2, P1-1) --perf: the app's own path — ⚙'s preset select (stored, applied live, the fast lane re-synced)
    const ps = A.shell.shell && A.shell.shell.perfSel;
    if (ps && typeof ps.onchange === 'function') { ps.value = cfg.perf; ps.onchange({ type: 'change', target: ps }); } else out.notes.push('no preset select: the app\'s own preset');
  }
  if (wk.clock.dropReset) wk.clock.dropReset(); // ((review 2) each cell its own condition: no drop level carried over from the previous cell's throttle
  out.fast = false; out.perf = (W && W.perf) || 'high';
  if (fr && typeof fr.force === 'function') { try { fr.force(cfg.fast === false ? 0 : typeof cfg.fast === 'number' ? cfg.fast : null); out.fast = cfg.fast !== false && fr.hz() > 0; } catch (e) { out.notes.push('fr.force: ' + e.message); } } // ((review 2) a number: that rate forced — WebKit ships the lane off
  F.errs.length = 0;
  await sleep(cfg.warm);
  const s = wk.clock.stats();
  out.clock = { display: s.display, measured: s.measured, eff: s.eff, cap: s.cap, k: s.k };
  return out;
}
/** (FR Cut B §7 G7) the smooth probe: LFO 1's overlay (the first `.gx-lfo canvas.gx-ov` on screen — the tutorial's; (MOD1 G6) the mods scene's
 * track LFO face) has its context's
 * 'arc' hooked (its playhead dot) and the x drawn is recorded once per delivered frame for `ms` → smoothOf of the series (+ the first 600). */
export async function smoothProbe(win, ms = 2000) {
  const A = appOf(win), F = A.F, c = Array.from(A.doc.querySelectorAll('.gx-lfo canvas.gx-ov')).find(el => onScreen(win, el));
  if (!c) return { ok: false, why: 'no LFO overlay on screen', n: 0, moved: 0, cv: Infinity, wraps: 0, pass: false, xs: [] };
  const g = c.getContext('2d'), orig = g.arc, xs = [];
  let lastX = NaN, lastF = -1;
  g.arc = function (x) { lastX = x; return orig.apply(this, arguments); };
  const t0 = win.performance.now();
  try {
    await new Promise(res => {
      const loop = () => { if (win.performance.now() - t0 >= ms) { res(); return; } if (F.frame !== lastF) { lastF = F.frame; xs.push(lastX); } win.requestAnimationFrame(loop); };
      win.requestAnimationFrame(loop);
    });
  } finally { delete g.arc; if (g.arc !== orig) g.arc = orig; }
  return Object.assign({ ok: true, frames: xs.length }, smoothOf(xs), { xs: xs.slice(0, 600).map(x => (x === x ? r1(x) : null)) });
}
/** (FR Cut B §7 G8, --load) the load protocol in the page: per phase of `plan` (loadPlan) the fast lane on or off (fr.force), 600 ms to
 * settle, then the summed DSP load of every node (the tracks' and MASTER's stats.load, read every 250 ms) averaged → loadVerdict. */
export async function loadRun(win, plan, on = null) { // (on: the on arm's rate — null the preset's; review 2: a number for WebKit, where that is 0)
  const A = appOf(win), fr = A.T.fr, out = [];
  if (!fr || typeof fr.force !== 'function') return { ok: false, why: 'no __synthTest.fr (a build before Cut B)', res: [], verdict: loadVerdict([]) };
  const now = () => { let x = 0; for (const N of A.api.nodes.values()) if (N && N.load >= 0) x += N.load; const M = A.master && A.master.rec ? A.master.rec() : null; if (M && M.load >= 0) x += M.load; return x; };
  try {
    for (const ph of plan) {
      fr.force(ph.fast ? on : 0);
      await sleep(600);
      const L = [], t0 = win.performance.now();
      while (win.performance.now() - t0 < Math.max(250, ph.ms - 600)) { await sleep(250); L.push(now()); }
      out.push({ arm: ph.arm, fast: ph.fast, pair: ph.pair, load: L.length ? L.reduce((a, b) => a + b, 0) / L.length : NaN });
    }
  } finally { fr.force(null); }
  return { ok: true, res: out, verdict: loadVerdict(out) };
}
/** Starts recording. */
export function begin(win) { win.__fps.begin(); if (CUR && CUR.wk && CUR.wk.clock.dropSpan) CUR.wk.clock.dropSpan(true); return true; } // ((review 2) the drop levels from here
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
    if (e.kind === 'post') { // (AUTO G7) posts to the worklets: one rate per port that sent any {t: e.t} (one port = one track's node), a second long window's average
      const rs = d.posts.ports.filter(p => e.t === 'patch').map(p => +(p.n / secs).toFixed(1)).sort((a, b) => b - a);
      expectRaw.push({ name: e.name, found: rs.length, rates: rs });
      continue;
    }
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
    posts: postsOf(d.posts, secs), // ((AUTO G7) what the page posted to the worklets: the patch stream per port)
    clock: { display: st.display, measured: st.measured, eff: st.eff, cap: st.cap, k: st.k, paints: st.paints, frames: st.frames, ms: { med: r3(st.ms.med), p95: r3(st.ms.p95), max: r3(st.ms.max) }, clients: names,
      drop: wk.clock.dropSpan ? wk.clock.dropSpan() : { lvl: 0, lo: 0, hi: 0 } }, // ((FR Cut B review 2, P1-1) the drop levels over the window
    expectRaw, canvases: cvs, dots: { n: dots.length, painting: dots.filter(x => x > 1).length, med: q(dots).med }, errors: F.errs.slice(0, 10) };
}

/** (AUTO G7) The faces that follow their curve, by family: for each probe the track is shown (a canvas shows one track's faces), the window recorded as a cell's (F.begin / F.end: the
 * frame cost with those faces drawing) and the writes to `aria-valuenow` counted per element on screen — a classic knob and slider (hw-c), a Wavecraft rig's cutoff knob and its Reverb's size knob
 * (wk-knob). Leaves the first track shown. The fixed ids of the auto8 scene: tracks 0 (Minimoog: fc), 1 (Juno: cf), 5 (the first rig: f.cutoff, fx.rev.size). → { ok, per: [{ name, found, rates, cost }] }. */
export async function autoFaces(win, o = {}) {
  const A = appOf(win), F = A.F, ms = o.ms || 2000, P = A.api.project(), out = { ok: true, per: [], notes: [] };
  const probes = [[0, 'Minimoog cutoff knob (classic)', '[data-dest="fc"] [aria-valuenow]'], [1, 'Juno-60 cutoff slider (classic)', '[data-dest="cf"] [aria-valuenow]'],
    [5, 'Wavecraft cutoff knob (rig)', '[data-dest="f.cutoff"][aria-valuenow], [data-dest="f.cutoff"] [aria-valuenow]'], [5, 'Reverb size knob (rig effect)', '[data-dest="fx.rev.size"][aria-valuenow], [data-dest="fx.rev.size"] [aria-valuenow]']];
  if (P.tracks.length < 7) return { ok: false, why: 'not the auto8 project (' + P.tracks.length + ' tracks)', per: [] };
  F.observe(['aria-valuenow']);
  let shown = -1, secs = 1, cost = null;
  for (const [ti, name, sel] of probes) {
    if (ti !== shown) {
      A.api.selectTrack(P.tracks[ti].id); await mounted(A); await sleep(700);
      F.errs.length = 0; F.begin(); await sleep(ms);
      const d = F.end(); secs = d.ms / 1000; cost = q(d.raf.map((x, i) => x + (d.msg[i] || 0))); shown = ti;
      out.errors = (out.errors || []).concat(F.errs.slice(0, 5));
    }
    const els = Array.from(A.doc.querySelectorAll(sel)).filter(el => onScreen(win, el, 0.2, true));
    out.per.push({ name, track: P.tracks[ti].id, found: els.length, rates: els.map(el => +(F.at(el, 'aria-valuenow') / secs).toFixed(1)), cost });
  }
  A.api.selectTrack(P.tracks[0].id); await mounted(A);
  return out;
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

/** (LC G6) The comb scene's Combiner faces (cv.mod.bodies of kind 'comb', their lc-view V): playing, for `ms` — each view's frame() timed
 * (the face's per-frame work under its `lc` client: the client's callback is shownNow + V.frame()), the overlay's playhead x per delivered
 * frame (its moveTo at y 0 → `moved`, the share of frames with a new x), the curves' paints a second (§6.6: on a change only — the window's
 * turn); then a curve recompute — V.dirty(2) + V.frame() (the keys' path), `reps` times, and the host's own: o.edit({ win }) there and back
 * (the frame after it, by the same wrapper) —, and an amount move's re-combine as the face's drag runs it (o.setAmt(row, v, 'move') +
 * V.dirty(1) + V.frame(): recombine()) `reps` times, then 'cancel' (no step). `o.stop`: only the stopped check — ■ (the button) and,
 * `settle` ms on, `ms` of frames: the curves never repainted, the overlay only when the level mark moved (the FREE GLOBAL inputs run on
 * while stopped: the knob moves, §6.4 — its client stays by design); then ⏻ off (the button): no `lc` client, no frame(), no paint.
 * → the numbers, ms (wall: the CPU throttle included). */
export async function combProbe(win, o = {}) {
  const A = appOf(win), F = A.F, ms = o.ms || 2000, reps = o.reps || 15, now = () => win.performance.now();
  const Bs = Array.from(A.cv.mod.bodies).filter(([, B]) => B && B.kind === 'comb' && typeof B.view === 'function' && B.view() && B.el)
    .map(([k, B]) => ({ k, B, V: B.view(), H: A.cv.mod.comb(k), ov: B.el.querySelector('canvas.rig-cov'), cc: B.el.querySelector('canvas.rig-ccv'), T: [], on: false, x: NaN, cp: 0, cpF: -1 }));
  if (!Bs.length || Bs.some(b => !b.ov || !b.cc)) return { ok: false, why: 'no Combiner face with its view and canvases' };
  const wk = await wkOf(A), undo = [], st = b => b.V.state(), lcN = () => wk.clock.clients().filter(n => n === 'lc').length;
  for (const b of Bs) {
    const f0 = b.V.frame, g = b.ov.getContext('2d'), mt = g.moveTo, gc = b.cc.getContext('2d'), fr = gc.fillRect;
    b.V.frame = function () { const a = now(); try { return f0.apply(this, arguments); } finally { if (b.on) b.T.push(now() - a); } };
    g.moveTo = function (x, y) { if (y === 0) b.x = x; return mt.apply(this, arguments); }; // (the playhead's line: moveTo(x, 0))
    gc.fillRect = function () { if (b.cpF !== F.frame) { b.cpF = F.frame; b.cp++; } return fr.apply(this, arguments); };
    undo.push(() => { b.V.frame = f0; delete g.moveTo; delete gc.fillRect; });
  }
  const frames = n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : win.requestAnimationFrame(f)); win.requestAnimationFrame(f); });
  const res = { ok: true, faces: Bs.length, playing: !!A.api.transport().playing, per: [] };
  try {
    if (o.stop) { // ■ (the engine on: the FREE GLOBAL inputs run on — the dot, a level mark, follows the knob; the curves hold), then ⏻ off: nothing per frame
      const win1 = async () => {
        await sleep(o.settle || 1500);
        for (const b of Bs) { b.T.length = 0; b.on = true; b.cp = 0; b.lv = []; }
        F.begin(); await sleep(ms); const d = F.end();
        const r = { playing: !!A.api.transport().playing, audio: A.api.ctx() ? A.api.ctx().state : 'none', lc: lcN(), frames: d.delivered, rafMed: q(d.raf).med, per: [] };
        for (const b of Bs) { let same = 0; for (let i = 1; i < b.lv.length; i++) if (b.lv[i] === b.lv[i - 1]) same++; r.per.push({ k: b.k, frames: b.T.length, overlayPaints: F.cv(b.ov).n, samePaints: same, curvePaints: b.cp, live: b.V.live() }); b.on = false; }
        return r;
      };
      for (const b of Bs) { const g = b.ov.getContext('2d'), fr = g.fillRect; g.fillRect = function (x, y, w) { if (b.on && x === 0 && w === 8) b.lv.push(y); return fr.apply(this, arguments); }; undo.push(() => { delete g.fillRect; }); } // (the level mark: fillRect(0, y − 1.5, 8, 3))
      if (A.api.transport().playing) A.doc.querySelector('#tPlay').click();
      res.stopped = await win1();
      const pw = A.doc.querySelector('#power');
      if (pw && A.api.ctx()) pw.click();
      res.off = await win1();
      const S = res.stopped, Z = res.off;
      res.pass = !S.playing && S.per.every(p => !p.curvePaints && !p.samePaints) && Z.audio === 'none' && Z.lc === 0 && Z.per.every(p => !p.frames && !p.overlayPaints && !p.curvePaints && !p.live);
      return res;
    }
    // playing: the per-frame work and the overlay's x per delivered frame
    for (const b of Bs) { b.T.length = 0; b.on = true; b.cp = 0; b.xs = []; }
    let lastF = -1;
    const t0 = now();
    await new Promise(r => { const loop = () => { if (now() - t0 >= ms) { r(); return; } if (F.frame !== lastF) { lastF = F.frame; for (const b of Bs) b.xs.push(b.x); } win.requestAnimationFrame(loop); }; win.requestAnimationFrame(loop); });
    const secs = (now() - t0) / 1000;
    res.lc = lcN();
    for (const b of Bs) {
      const xs = b.xs; let pairs = 0, mv = 0;
      for (let i = 1; i < xs.length; i++) { if (!(xs[i] === xs[i] && xs[i - 1] === xs[i - 1])) continue; pairs++; if (xs[i] !== xs[i - 1]) mv++; }
      res.per.push({ k: b.k, frame: q(b.T), moved: pairs ? r3(mv / pairs) : 0, steps: pairs, curvesPerS: r1(b.cp / secs), mode: st(b).mode, W: st(b).W, n: st(b).n });
      b.on = false;
    }
    // a curve recompute: the keys' path (dirty 2), timed alone
    for (const [j, b] of Bs.entries()) {
      const P = res.per[j], R = [], r0 = st(b).recomputes;
      for (let i = 0; i < reps; i++) { await frames(1); const a = now(); b.V.dirty(2); b.V.frame(); R.push(now() - a); }
      P.recompute = q(R); P.recomputed = st(b).recomputes - r0;
      // the host's own: the window there and back (one step each; the frame after it by the wrapper)
      const back = (b.H.get() || {}).win || 1, there = back === 1 ? 2 : 1, wr = [];
      for (const w of [there, back]) {
        b.T.length = 0; b.on = true;
        const c0 = st(b).recomputes;
        b.H.edit({ win: w }); await frames(4);
        b.on = false;
        wr.push({ win: w, ms: r3(b.T.length ? Math.max(...b.T) : NaN), recomputes: st(b).recomputes - c0, beats: r3(st(b).W) });
      }
      P.winEdit = wr;
      // an amount move's re-combine, as the face's drag: setAmt 'move' then recombine (dirty 1 + frame); 'cancel' after (no step)
      const I = b.H.inputs(), row = I.length ? I[0].row : null;
      if (row) {
        const a0 = +I[0].amt, M = [], Mh = [], Mv = [], c0 = st(b).recomputes, k0 = st(b).combines;
        b.H.setAmt(row, a0, 'start');
        for (let i = 0; i < reps; i++) { await frames(1); const v = Math.max(-1, Math.min(1, a0 + (i % 2 ? -1 : 1) * 0.02 * (1 + (i >> 1)))), a = now(); b.H.setAmt(row, v, 'move'); const m = now(); b.V.dirty(1); b.V.frame(); const e = now(); M.push(e - a); Mh.push(m - a); Mv.push(e - m); }
        b.H.setAmt(row, a0, 'cancel');
        P.amtMove = q(M); P.amtHost = q(Mh); P.amtView = q(Mv); P.amtRecomputes = st(b).recomputes - c0; P.amtCombines = st(b).combines - k0; // (host: setMod + the held repost; view: the combine + the curves' repaint + the overlay)
        await frames(2);
      }
      // the combine alone (lc-view sumCurve over the cached value arrays: §6.6's "only the combine"), no paint
      const S = st(b), MC = win.ModCore, LV = await A.imp('lc-view.js');
      if (MC && S.n && S.N) {
        const am = Float64Array.from(S.amts), va = Float64Array.from(S.vals), sm = new Float64Array(S.N), C = [];
        for (let i = 0; i < reps; i++) { const a = now(); LV.sumCurve(MC, S.mode, S.n, am, va, S.N, sm); C.push(now() - a); }
        P.combine = q(C); P.N = S.N;
      }
    }
    res.errors = F.errs.slice(0, 5);
    return res;
  } finally { for (const f of undo) f(); }
}

/** (DM G9) The kit scene's faces (cv.kit.faces(): the Sequencer's View and the voices'; kit-ui's frames ride the drum host's heard queue
 * and one wk.frame each — the harness finds them in requestAnimationFrame by their source, `kitStats.paints++`, and times each: the
 * face's per-heard-step work), playing for `ms`: per delivered frame (sampled after every callback, in a microtask) the playhead's
 * step against the heard one (cv.kit.state), the frames the Sequencer painted; per kit callback the DOM writes (a MutationObserver
 * drained before and after: playhead style, lamp / HIT data-hit flips, anything else) and the layout-forcing reads
 * (getBoundingClientRect, getComputedStyle); who writes the DOM at all (diagnostic); then a cell tap (cv.kit.cell, `reps`, alternately
 * on / off in an empty lane), a pattern switch (press pat B / A) and a voice added and removed — each: the host call, the face frames
 * that follow (the grid repaint: kitStats.grid), the worst rAF cost and frame gap (F.begin / F.end) over the next frames. `o.stop`:
 * only the stopped check — ■ (cv.kit.stop), `settle` ms on, `ms` of frames: no kit callback, no paint, no grid, no canvas painted,
 * no DOM write under the kit's modules, no kit clock client. → the numbers, ms (wall: the CPU throttle included). */
export async function kitProbe(win, o = {}) {
  const A = appOf(win), F = A.F, ms = o.ms || 2500, reps = o.reps || 12, now = () => win.performance.now(), id = win.__kitId, K = A.cv.kit;
  const KU = await A.imp('kit-ui.js'), kS = KU.kitStats, wk = await wkOf(A), fc = id ? K.faces() : null, seq = fc ? Array.from(fc.seqs.values())[0] : null, vox = fc ? Array.from(fc.voices.values()) : [];
  if (!id || !seq || !seq.el || !vox.length || vox.some(v => !v.V || !v.V.el)) return { ok: false, why: 'no kit faces (track ' + id + ')' };
  const ph = seq.el.querySelector('.kit-ph'), cvE = seq.el.querySelector('canvas.kit-cv');
  if (!ph || !cvE) return { ok: false, why: 'no playhead / grid canvas on the Sequencer' };
  const c0 = K.cellRect(id, 0, 0), c1 = K.cellRect(id, 0, 1), COL = c0 && c1 ? c1.x - c0.x : 64, kitEls = [seq.el].concat(vox.map(v => v.V && v.V.el).filter(Boolean)); // (kitSeqs: key → { el, V }; kitVox: key → { V, tid })
  const inKit = n => kitEls.some(e => e.contains(n));
  const W = { on: false, s: [], v: [], reads: 0, nS: 0, nV: 0, wr: [] }, mo = new win.MutationObserver(() => {}), wr = new Map();
  const mo2 = new win.MutationObserver(recs => { for (const r of recs) { const t = r.target, k = (t.nodeType === 1 ? t.tagName.toLowerCase() + (t.classList && t.classList[0] ? '.' + t.classList[0] : '') : '#text') + (r.type === 'attributes' ? '[' + r.attributeName + ']' : ':' + r.type); wr.set(k, (wr.get(k) || 0) + 1); } });
  mo.observe(A.doc.body, { subtree: true, attributes: true, childList: true, characterData: true });
  const tag = new WeakMap(), rafO = win.requestAnimationFrame, gcs = win.getComputedStyle, gbr = win.Element.prototype.getBoundingClientRect, ST = { ph: 0, flip: 0, other: 0, maxPh: 0, maxFlip: 0, maxOther: 0, quietS: 0, quietV: 0, kinds: {} };
  let inK = false;
  const run = (fn, t, kind) => {
    if (!W.on) return fn(t);
    mo.takeRecords();
    inK = true;
    const a = now();
    try { return fn(t); } finally {
      const e = now() - a;
      inK = false;
      (kind === 's' ? W.s : W.v).push(e); if (kind === 's') W.nS++; else W.nV++;
      let p = 0, f = 0, x = 0;
      for (const r of mo.takeRecords()) {
        if (r.type === 'attributes' && r.attributeName === 'style' && r.target === ph) p++;
        else if (r.type === 'attributes' && (r.attributeName === 'data-hit' || (r.attributeName === 'data-on' && r.target === ph))) f++;
        else { x++; const k = (r.target.className && r.target.className.baseVal == null ? String(r.target.className) : r.target.nodeName) + (r.attributeName ? '[' + r.attributeName + ']' : ':' + r.type); ST.kinds[k] = (ST.kinds[k] || 0) + 1; }
      }
      if (!(p + f + x)) { if (kind === 's') ST.quietS++; else ST.quietV++; } // (a frame asked for, nothing written)
      ST.ph += p; ST.flip += f; ST.other += x; ST.maxPh = Math.max(ST.maxPh, p); ST.maxFlip = Math.max(ST.maxFlip, f); ST.maxOther = Math.max(ST.maxOther, x);
    }
  };
  win.requestAnimationFrame = function (fn) {
    let k = tag.get(fn);
    if (k === undefined) { const src = typeof fn === 'function' ? Function.prototype.toString.call(fn) : ''; k = /kitStats\.paints\+\+/.test(src) ? (/paintGrid\(\)/.test(src) ? 's' : 'v') : ''; tag.set(fn, k); }
    return rafO.call(this, k ? t => run(fn, t, k) : fn);
  };
  win.getComputedStyle = function () { if (inK) W.reads++; return gcs.apply(this, arguments); };
  win.Element.prototype.getBoundingClientRect = function () { if (inK) W.reads++; return gbr.apply(this, arguments); };
  const phStep = () => { if (!ph.hasAttribute('data-on')) return -1; const m = /translateX\(([-\d.]+)px/.exec(ph.style.transform); return m ? Math.round(+m[1] / COL) : -2; };
  const frames = n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : win.requestAnimationFrame(f)); win.requestAnimationFrame(f); });
  const clientNames = () => wk.clock.clients().filter(n => /kit|seq|drum|lamp|pad|step/i.test(n));
  const base = Array.isArray(win.__kitBase) ? win.__kitBase : [], extra = wk.clock.clients().filter(n => base.indexOf(n) < 0);
  const res = { ok: true, playing: !!A.api.transport().playing, COL, clients: wk.clock.clients(), kitClients: clientNames(), per: {} };
  try {
    if (o.stop) { // ■: the engine stays on; the kit paints nothing
      K.stop();
      await sleep(o.settle || 1500);
      const body0 = kS.paints, g0 = kS.grid;
      W.on = true; let mut = 0;
      const mo3 = new win.MutationObserver(recs => { for (const r of recs) if (inKit(r.target)) mut++; });
      mo3.observe(A.doc.body, { subtree: true, attributes: true, childList: true, characterData: true });
      F.begin(); await sleep(ms); const d = F.end();
      mut += mo3.takeRecords().filter(r => inKit(r.target)).length; mo3.disconnect();
      W.on = false;
      res.stopped = { playing: !!A.api.transport().playing, audio: A.api.ctx() ? A.api.ctx().state : 'none', frames: d.delivered, rafMed: q(d.raf).med, kitCallbacks: W.nS + W.nV, paints: kS.paints - body0, grid: kS.grid - g0, canvasPaints: F.cv(cvE).n, kitWrites: mut, phOn: ph.hasAttribute('data-on'), clients: clientNames(), clock: wk.clock.clients() };
      res.pass = !res.stopped.playing && res.stopped.kitCallbacks === 0 && res.stopped.paints === 0 && res.stopped.grid === 0 && res.stopped.canvasPaints === 0 && res.stopped.kitWrites === 0 && !res.stopped.phOn && !res.stopped.clients.length;
      return res;
    }
    // playing: the heard step against the playhead, per delivered frame; the writes and reads per kit callback
    mo2.observe(A.doc.body, { subtree: true, attributes: true, childList: true, characterData: true });
    const rec = [], sp0 = kS.paints, g0 = kS.grid, t0 = now();
    W.on = true;
    const sample = () => { const st = K.state(id); rec.push([phStep(), st ? st.step : -2, W.nS]); };
    await new Promise(r => { const loop = () => { if (now() - t0 >= ms) { r(); return; } queueMicrotask(sample); win.requestAnimationFrame(loop); }; win.requestAnimationFrame(loop); });
    W.on = false;
    const secs = (now() - t0) / 1000;
    // the playhead against the heard step: `lag` the longest run of frames showing another step than the heard one (the playhead is drawn in the frame after
    // the heard queue's post: one frame behind kitState's step), `skipped` the heard steps the playhead never showed within 3 frames, `moved` the Sequencer's
    // painted frames in which the playhead moved (a frame it painted for another reason — an edit, a record change — moves nothing)
    let same = 0, hc = 0, pc = 0, sPaint = 0, sMoved = 0, run = 0, lag = 0, skipped = 0;
    for (let i = 0; i < rec.length; i++) {
      if (rec[i][0] === rec[i][1]) { same++; run = 0; } else lag = Math.max(lag, ++run);
      if (i) {
        const hd = rec[i][1] !== rec[i - 1][1] && rec[i][1] >= 0, pd = rec[i][0] !== rec[i - 1][0] && rec[i][0] >= 0;
        if (hd) { hc++; if (i + 3 < rec.length && !rec.slice(i, i + 4).some(r => r[0] === rec[i][1])) skipped++; }
        if (pd) pc++;
        if (rec[i][2] !== rec[i - 1][2]) { sPaint++; if (pd) sMoved++; }
      }
    }
    res.per = { frames: rec.length, tracks: r3(rec.length ? same / rec.length : 0), lag, skipped, heardSteps: hc, shownSteps: pc, stepsPerS: r1(hc / secs), seqFrames: sPaint, seqFramesMoved: sMoved, seqCallbacks: W.nS, voiceCallbacks: W.nV, seq: q(W.s), voice: q(W.v), paintsPerS: r1((kS.paints - sp0) / secs), gridPaints: kS.grid - g0,
      writes: { ph: ST.ph, flips: ST.flip, other: ST.other, maxPh: ST.maxPh, maxFlip: ST.maxFlip, maxOther: ST.maxOther, quietSeq: ST.quietS, quietVoice: ST.quietV, kinds: Object.assign({}, ST.kinds) }, layoutReads: W.reads };
    mo2.takeRecords(); mo2.disconnect();
    res.per.writers = Array.from(wr.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => k + ' ' + r1(n / secs) + '/s');
    // an edit: the host's call (the history step, the press, the sends, the sync), the face frames after it, the worst frame
    const edit = async (label, fn, n, nth = 4) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        await frames(2);
        W.s.length = 0; W.v.length = 0;
        const g = kS.grid, p = kS.paints;
        F.begin();
        const a = now(), r = fn(i), call = now() - a;
        await frames(nth);
        const d = F.end();
        out.push({ call, grid: kS.grid - g, paints: kS.paints - p, seq: W.s.length ? Math.max(...W.s) : 0, voices: W.v.reduce((x, y) => x + y, 0), nVoices: W.v.length, rafMax: Math.max(...d.raf), gapMax: Math.max(...d.dt), r });
      }
      return out;
    };
    const sum = L => ({ call: q(L.map(x => x.call)), seq: q(L.map(x => x.seq)), voices: q(L.map(x => x.voices)), rafMax: q(L.map(x => x.rafMax)), gapMax: q(L.map(x => x.gapMax)), gridPerEdit: L.length ? r3(L.reduce((x, y) => x + y.grid, 0) / L.length) : 0, ok: L.every(x => x.r !== false) });
    W.on = true;
    res.tap = sum(await edit('tap', i => K.cell(id, 1, 2, i % 2 ? 0 : 100), reps));
    if (reps % 2) K.cell(id, 1, 2, 0);
    res.pat = sum(await edit('pat', i => K.press(id, { k: 'pat', p: i % 2 ? 0 : 1 }, 'Pattern'), reps));
    const addL = [], remL = [];
    for (let i = 0; i < Math.max(2, reps >> 1); i++) {
      const before = new Set(K.state(id).voices.map(v => v.slot));
      addL.push(...await edit('add', () => K.voice(id, 'add', 1), 1, 5));
      const slot = K.state(id).voices.map(v => v.slot).find(s => !before.has(s));
      remL.push(...await edit('remove', () => (slot == null ? false : K.voice(id, 'remove', slot)), 1, 5));
    }
    res.add = sum(addL); res.remove = sum(remL);
    W.on = false;
    res.errors = F.errs.slice(0, 5);
    res.voices = K.state(id).voices.length; res.pattern = K.state(id).pattern;
    return res;
  } finally { win.requestAnimationFrame = rafO; win.getComputedStyle = gcs; win.Element.prototype.getBoundingClientRect = gbr; mo.disconnect(); mo2.disconnect(); }
}

/* ================================================================================================ on a device: index.html?fpsdev=1 */
// No CDP, no virtual display (the page has no SharedArrayBuffer there): the browser's own frames — the iPad's 60, a ProMotion screen's 120 —,
// every scene, caps 60 (and &caps=120 more). (FR Cut B review 2, the lead's P2-3) The protocol runs in the app's OWN top-level page, never in a
// srcdoc or an iframe (WebKit's AudioWorklet in a frame is not the app's: G8i could not run there): main.js, under ?fpsdev=1, installs the hooks
// before the app starts (devBoot) and the protocol runs once it is up (devRun) — one scene a page load (a fresh app per scene, as the frame
// was), the report carried in sessionStorage from load to load, the next scene by location.replace; where the audio context waits for a
// gesture (WebKit) a Continue button asks for one (the iOS Simulator control tool taps it). The store's writes are off from the moment the
// app's store is there (the user's project stays as it was), the project a fresh one (#fNew). One JSON → Copy results (tests/bench.json
// "ui-fps-ipad" by hand). Query: &scenes=a,b, &caps=120, &load=1 (after the tutorial's and the master's cells the load protocol, loadRun,
// &cycles=N, default 10), &post=1 (the report POSTed to /result: the harness's --serve), &fast=off | on | a rate forced (G8i: &fast=60 — WebKit
// ships the lane off, its preset rate 0), &auto=1 (window.__fpsBench: state, result),
// &i the scene's index (the protocol's own). tests/ui-bench.html?fps=1 is the launcher (main: Run → here)
export const DEV_KEY = 'synth.fpsdev';
const DEV_Q = Object.freeze(['scenes', 'caps', 'load', 'post', 'fast', 'cycles', 'auto']);
/** &fast of a device run: 'off' → false, a rate (> 0) → that rate forced (G8i: &fast=60 — WebKit ships the lane off, so its preset rate is
 * 0), anything else → true (the preset's rate). Pure. */
export function devFast(v) { if (v === 'off') return false; const n = +v; return n > 0 ? n : true; }
/** The app page of a device run's step `i`: `base` (the app's index.html URL), the launcher's query `search` (only DEV_Q kept), fpsdev=1, i. Pure. */
export function devUrl(base, search, i) {
  const u = new URL(base), q = new URLSearchParams(search || '');
  u.search = '';
  u.searchParams.set('fpsdev', '1');
  for (const k of DEV_Q) if (q.has(k)) u.searchParams.set(k, q.get(k));
  u.searchParams.set('i', String(Math.max(0, i | 0)));
  return u.href;
}
/** Called by main.js under ?fpsdev=1, before its store opens: the hooks (no virtual display), the store's writes off once the app has
 * one, then devRun once the app is up. */
export function devBoot(win) {
  installHooks(win, {});
  const T = win.__synthTest;
  (async () => {
    let off = false;
    for (let k = 0; k < 1200; k++) {
      await sleep(50);
      const st = T.api && T.api.store;
      if (st && !off) { off = true; for (const m of ['set', 'setRaw', 'saveProject', 'saveNow']) if (typeof st[m] === 'function') st[m] = () => {}; } // (nothing the bench does is stored)
      if (off && T.cv && T.shell && win.document.querySelector('#world') && T.cv.world()) { await sleep(300); return devRun(win); }
    }
    throw new Error('the app did not start');
  })().catch(e => { const W = win.__fpsBench = win.__fpsBench || {}; W.state = 'error'; W.error = String(e && e.message || e); win.console.error('[fps] ' + W.error); });
}
// the protocol's overlay in the app page (fixed, bottom left: it changes no layout) → { say, button(label) → Promise (the tap), done(rep, text) }
function devUI(win) {
  const d = win.document, box = d.createElement('div');
  box.id = 'fpsdev';
  box.setAttribute('style', 'position:fixed;left:8px;bottom:8px;z-index:2147483647;max-width:min(560px,90vw);max-height:60vh;overflow:auto;background:#111c;color:#eee;font:12px/1.4 -apple-system,Helvetica,Arial,sans-serif;padding:8px 10px;border:1px solid #444;border-radius:8px');
  const st = d.createElement('div'), res = d.createElement('pre');
  res.setAttribute('style', 'margin:6px 0 0;white-space:pre-wrap;font:11px/1.3 monospace');
  box.append(st, res);
  d.body.appendChild(box);
  const button = label => new Promise(r => {
    const b = d.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.setAttribute('style', 'font:inherit;font-size:16px;padding:10px 18px;margin:6px 0;border-radius:8px');
    b.addEventListener('click', () => { b.remove(); r(); }, { once: true });
    box.insertBefore(b, res);
  });
  return {
    say: t => { st.textContent = t; },
    button,
    done(rep, text) {
      res.textContent = text;
      const out = d.createElement('textarea'), cp = d.createElement('button');
      out.readOnly = true; out.value = JSON.stringify(rep, null, 1); out.setAttribute('style', 'width:100%;height:140px;font:11px monospace');
      cp.type = 'button'; cp.textContent = 'Copy results';
      cp.addEventListener('click', async () => { try { await win.navigator.clipboard.writeText(out.value); st.textContent = 'copied'; } catch (e) { out.select(); st.textContent = 'select the text and copy it'; } });
      box.append(cp, out);
    },
  };
}
// the audio running (a tap where the browser wants a gesture: WebKit) → true once the context runs
async function devAudio(win, ui, say, i, n) {
  const T = win.__synthTest, running = () => { const c = T.api.ctx(); return !!(c && c.state === 'running'); };
  try { await T.api.powerOn(); } catch (e) { /* asked again after the tap */ }
  for (let k = 0; k < 30 && !running(); k++) await sleep(100);
  if (running()) return true;
  say('scene ' + (i + 1) + ' of ' + n + ': the audio waits for a tap');
  await ui.button('Continue (scene ' + (i + 1) + ' of ' + n + ')');
  try { const c = T.api.ctx(); if (c && c.resume) await c.resume(); await T.api.powerOn(); } catch (e) { /* as it is */ }
  for (let k = 0; k < 40 && !running(); k++) await sleep(100);
  return running();
}
// one scene of the device protocol into `rep`: a fresh project, the scene built, its cells (caps 60 + &caps), the fast lane's trace, the load protocol
async function deviceScene(win, scene, rep, Q, say) {
  const T = win.__synthTest, LOAD = Q.get('load') === '1', FAST = devFast(Q.get('fast'));
  win.confirm = () => true; win.alert = () => {};
  try { win.document.querySelector('#fNew').click(); await sleep(600); } catch (e) { /* the project as it is */ }
  say(scene + ': building');
  const b = await buildScene(win, scene);
  rep.scenes[scene] = { info: b.info, notes: b.notes };
  await sleep(1500);
  for (const cap of [60].concat(Q.get('caps') ? Q.get('caps').split(',').map(Number) : [])) {
    say(scene + ': measuring at cap ' + cap);
    const cfg = { scene, cap, display: 0, warm: 2500, throttle: 1, fast: FAST };
    const pre = await prepare(win, cfg);
    begin(win); await sleep(4000);
    const raw = finish(win), D = raw.clock.measured ? raw.clock.display : 60, eff = effOf(D, cap);
    const cell = { size: 'device', scene, cap, display: D, throttle: 1, via: pre.via, notes: pre.notes, frames: { delivered: raw.delivered, missed: 0, ms: Math.round(raw.ms), display: D }, frameCost: raw.cost, raf: raw.raf, msg: raw.msg, dt: raw.dt, callbacks: raw.callbacks,
      handlers: raw.handlers, clock: Object.assign({ expectEff: eff }, raw.clock), cdp: null, heapBytesPerS: null, expect: raw.expectRaw.map((r, k) => evalExpect(EXPECT[scene][k], r, { eff, display: D, delivered: raw.delivered, fast: pre.fast, perf: pre.perf, drop: raw.clock.drop.hi, dropLo: raw.clock.drop.lo })), canvases: raw.canvases, dots: raw.dots, errors: raw.errors, fast: pre.fast };
    const v = evalCell(cell); cell.pass = v.pass; cell.gates = v.gates;
    rep.cells.push(cell);
  }
  const fr = T.fr;
  if (fr && typeof fr.trace === 'function') { // (G8i: the rate asked, the view moving on every painted frame)
    const tr = await fr.trace(120), ph = tr.map(x => (x.probe ? x.probe.ph : NaN)), mv = ph.filter((x, k) => k && x === x && x !== ph[k - 1]).length;
    rep.scenes[scene].fast = { hz: fr.hz(), frames: tr.length, moved: tr.length > 1 ? r3(mv / (tr.length - 1)) : 0, rings: fr.rings().length };
  }
  if (LOAD && (scene === 'tutorial' || scene === 'master')) {
    say(scene + ': the load protocol');
    (rep.load = rep.load || {})[scene] = await loadRun(win, loadPlan(+Q.get('cycles') > 0 ? +Q.get('cycles') : 10), typeof FAST === 'number' ? FAST : null);
  }
}
/** The device protocol's step in the app's page (devBoot calls it once the app is up): scene `i` into the carried report, then the next
 * page; after the last one, the results (and the POST). */
export async function devRun(win) {
  const Q = new URLSearchParams(win.location.search), AUTO = Q.get('auto') === '1', POST = Q.get('post') === '1';
  const scenes = (Q.get('scenes') ? Q.get('scenes').split(',') : SCENE_IDS.slice()).filter(x => SCENE_IDS.includes(x)), i = Math.max(0, Q.get('i') | 0);
  const W = win.__fpsBench = { state: 'running', result: null, scene: scenes[i] || null, i, n: scenes.length };
  const ui = devUI(win), say = t => { ui.say(t); if (AUTO) win.console.log('[fps] ' + t); };
  let rep = null;
  try { rep = i > 0 ? JSON.parse(win.sessionStorage.getItem(DEV_KEY) || 'null') : null; } catch (e) { rep = null; }
  if (!rep) rep = { kind: 'ui-fps-device', v: VERSION, when: new Date().toISOString(), ua: win.navigator.userAgent, dpr: win.devicePixelRatio, viewport: [win.innerWidth, win.innerHeight], pace: 'the browser\'s own frames', page: 'the app (top level)', cells: [], scenes: {}, aborted: [] };
  if (i < scenes.length) {
    const scene = scenes[i];
    try {
      say('scene ' + (i + 1) + ' of ' + scenes.length + ': ' + scene);
      if (!(await devAudio(win, ui, say, i, scenes.length))) throw new Error('the audio context did not start');
      await deviceScene(win, scene, rep, Q, say);
    } catch (e) { rep.aborted.push(scene + ': ' + String(e && e.message || e).slice(0, 200)); }
    try { win.sessionStorage.setItem(DEV_KEY, JSON.stringify(rep)); } catch (e) { say('sessionStorage: ' + e.message); W.state = 'error'; return; }
    say(scene + ': done — the next scene');
    win.location.replace(devUrl(win.location.href, win.location.search, i + 1));
    return;
  }
  W.result = rep; W.state = 'done';
  try { win.sessionStorage.removeItem(DEV_KEY); } catch (e) { /* kept */ }
  ui.done(rep, summarize(rep).join('\n'));
  if (POST) { try { const r = await win.fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rep) }); say('posted: ' + r.status); } catch (e) { say('post failed: ' + e.message); } }
  else say('done — Copy results');
}
/** tests/ui-bench.html?fps=1: the launcher — Run (or &auto=1 at once) opens the app's own page at the protocol's first step (devUrl). */
export async function main() {
  const Q = new URLSearchParams(location.search), $ = s => document.querySelector(s);
  document.title = 'SYNTH — frame rate (ui-bench ?fps=1)';
  document.body.innerHTML = '<h1>Frame rate: cost and liveness per scene (IMPL-FR G7)</h1><p>Opens the app itself (its own page, not a frame), builds each scene with its own hooks, plays it and measures a few seconds of the browser\'s own frames: what every frame costs, whether every animated display keeps animating. One page load a scene; leave it alone while it runs (≈ 20 s a scene) — where the browser wants a tap to start the audio, a Continue button asks for one. The results show in the app page at the end (Copy results).</p>'
    + '<p><button id="run" type="button">Run</button> <span id="status"></span></p>';
  const go = () => { try { sessionStorage.removeItem(DEV_KEY); } catch (e) { /* none */ } location.href = devUrl(new URL('../index.html', location.href).href, location.search, 0); };
  $('#run').addEventListener('click', go);
  if (Q.get('auto') === '1') go();
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
  if (o.serve) { await serve(o); return; }
  const rep = await drive(o);
  const lines = summarize(rep);
  if (!o.quiet) console.log('\n' + lines.join('\n'));
  const failed = rep.cells.filter(c => !c.pass).length, checks = rep.checks.filter(c => !c.pass).length;
  console.log('\nui-bench-fps: ' + rep.cells.length + ' cells, ' + failed + ' with a failed gate, ' + checks + ' of ' + rep.checks.length + ' checks failed' + (rep.aborted.length ? ', ' + rep.aborted.length + ' scene(s) aborted: ' + rep.aborted.join('; ') : ''));
  process.exit(o.gate && (failed || checks || rep.aborted.length) ? 1 : 0);
}
/** The app's server (the driver's and --serve's): the repo's files, cross-origin isolated (COOP / COEP: SharedArrayBuffer for the virtual
 * display's worker), no cache, never port 8817; POST /result (≤ 1 MB, JSON) → onResult(text) — a device page's report (?post=1). */
async function appServer({ http, fs, path, ROOT, port, host, onResult }) {
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
  const MAX = 1048576;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST' && u.pathname === '/result') {
      let n = 0, over = false; const parts = [];
      req.on('data', b => { n += b.length; if (n > MAX) { over = true; req.destroy(); } else parts.push(b); });
      req.on('end', () => {
        if (over) return;
        const txt = Buffer.concat(parts).toString('utf8');
        let ok = true;
        try { JSON.parse(txt); } catch (e) { ok = false; }
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
        res.end(ok ? 'ok' : 'not JSON');
        if (ok && onResult) onResult(txt);
      });
      req.on('close', () => { if (over && !res.headersSent) { try { res.writeHead(413); res.end(); } catch (e) { /* gone */ } } });
      return;
    }
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p), rel = path.relative(ROOT, f);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some(x => x.startsWith('.'))) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (e, data) => {
      if (e) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
      res.end(data);
    });
  });
  await new Promise(r => srv.listen(port || 0, host || '127.0.0.1', r));
  return srv;
}
/** (FR Cut B §5.6, G8i) --serve [--port N] [--out f]: the app for a device or the iOS Simulator's Safari (no browser of its own) — open
 * tests/ui-bench.html?fps=1&load=1&post=1&fast=60 there (review 2: the rate forced — WebKit ships the lane off), tap Run (and Continue where the
 * audio waits for a tap); the app page POSTs its report to /result, written to --out; then it exits. */
export async function serve(o) {
  const [http, fs, path, os, url] = await Promise.all(['node:http', 'node:fs', 'node:path', 'node:os', 'node:url'].map(m => import(m)));
  const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..'), out = o.out || path.join(os.tmpdir(), 'ui-fps-device-' + Date.now() + '.json');
  let done = null;
  const got = new Promise(r => { done = r; });
  const srv = await appServer({ http, fs, path, ROOT, port: o.port || 0, host: 'localhost', onResult: txt => { fs.writeFileSync(out, txt); done(); } });
  console.log('serving ' + ROOT + '\n  open http://localhost:' + srv.address().port + '/tests/ui-bench.html?fps=1&load=1&post=1&fast=60 on the device (Run), the report → ' + out);
  await got;
  console.log('report written: ' + out);
  srv.close();
  return out;
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
  const srv = await appServer({ http, fs, path, ROOT, port: 0 });
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
    config: { sizes: o.sizes, scenes: o.scenes, caps: o.caps, throttles: o.throttles, display: o.display || 'cap', warmMs: o.warm, measureMs: o.measure, layoutGate: o.layoutGate, skin: o.skin || 'charcoal', behind: !!o.behind, fast: o.fast, load: o.load }, scenes: {}, cells: [], checks: [], aborted: [] };
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
          const b = await ev('__fpsPage.buildScene(window, ' + JSON.stringify(scene) + ', ' + JSON.stringify({ skin: o.skin, behind: o.behind }) + ')', 240000);
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
            const cfg = { scene, cap: c.cap, display: c.display, warm: o.warm, throttle: c.throttle, fast: o.fast, perf: o.perf };
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
                frames: { delivered: raw.delivered, missed: raw.missed, ms: Math.round(raw.ms), display: c.display, stallMs: raw.dt.max }, frameCost: raw.cost, raf: raw.raf, msg: raw.msg, dt: raw.dt, callbacks: raw.callbacks, handlers: raw.handlers, posts: raw.posts,
                clock: Object.assign({ expectEff: eff }, raw.clock), contract: { med: r3(raw.clock.ms.med + raw.msg.med), p95: r3(raw.clock.ms.p95 + raw.msg.p95) }, cdp: metricsDelta(m0, m1), heap: { before: h0, after: h1 }, heapBytesPerS: h0 != null && h1 != null ? (h1 - h0) / (raw.ms / 1000) : null,
                expect: raw.expectRaw.map((r, i) => evalExpect(list[i], r, { eff, display: c.display, delivered: raw.delivered, fast: pre.fast, perf: pre.perf, drop: raw.clock.drop.hi, dropLo: raw.clock.drop.lo })), canvases: raw.canvases, dots: raw.dots, errors: raw.errors.concat(L.slice(0, 10)), fast: pre.fast };
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
          if (scene === 'auto8' || scene === 'auto8r') { // ((AUTO G7, §4.2) the patch stream against the 60 Hz cap's: a 120 Hz cap (and a 240 Hz display under the caps 120 / 60) posts no more than a 60 Hz one
            const cc = autoCapCheck(rep.cells.filter(x => x.size === sk && x.scene === scene));
            rep.checks.push({ id: 'auto patch posts', size: sk, scene, pass: cc.pass, value: cc.rows, note: cc.note });
            say('   auto patch posts: ' + (cc.pass ? 'ok' : 'FAIL') + ' — ' + cc.note);
          }
          if (scene === 'auto8') { // the faces that follow, by family (the shown track's only): classic knob / slider, a rig's knob, an effect's knob — rate and the frame cost with them drawing
            await s('Emulation.setCPUThrottlingRate', { rate: 1 }); lastTh = 1;
            for (const cap of [60, 120]) {
              await ev('__fpsPage.prepare(window, ' + JSON.stringify({ scene, cap, display: cap, warm: 1500, throttle: 1, fast: o.fast, perf: o.perf }) + ')', 120000);
              const r = await ev('__fpsPage.autoFaces(window, { ms: 2500 })', 120000), G = r.ok ? autoFaceGates(r) : [];
              const pass = !!r.ok && r.per.length === 4 && G.every(([, v, lim]) => v <= lim) && !(r.errors && r.errors.length);
              rep.checks.push({ id: 'auto faces ' + cap, size: sk, scene, pass, value: r, note: !r.ok ? r.why : r.per.map(p => p.name + ' ' + p.found + ' on screen, ' + p.rates.join('/') + ' Hz, cost ' + p.cost.med + '/' + p.cost.p95 + ' ms').join(' · ') });
              say('   auto faces @' + cap + ': ' + (pass ? 'ok' : 'FAIL') + ' — ' + rep.checks.at(-1).note);
            }
          }
          if (scene === 'tutorial' || scene === 'mods') { // ((FR Cut B §7 G7) the smooth probe at 120 and 240, 1 ×: LFO 1's overlay x on ≥ 0.9 of the frames, cv(|Δx|) ≤ 0.3; (MOD1 G6) a track LFO's face too
            await s('Emulation.setCPUThrottlingRate', { rate: 1 }); lastTh = 1;
            for (const cap of [120, 240]) {
              const pre = await ev('__fpsPage.prepare(window, ' + JSON.stringify({ scene, cap, display: cap, warm: 1500, throttle: 1, fast: o.fast, perf: o.perf }) + ')', 120000);
              const r = await ev('__fpsPage.smoothProbe(window, 2000)', 60000);
              // ((review 2) judged by the cell's own lane: the touch sizes read as iPadOS — WebKit, where the lane ships off — recorded there)
              rep.checks.push({ id: 'smooth probe ' + cap, size: sk, scene, pass: !pre.fast || !!r.pass, value: r, note: (r.ok ? r.frames + ' frames, moved ' + r.moved + ', cv ' + r.cv + ', ' + r.wraps + ' wrap(s)' : r.why) + (pre.fast ? '' : ' (the lane off' + (o.fast ? ' here — WebKit' : '') + ': recorded, the before)') });
              say('   smooth probe @' + cap + ': ' + (rep.checks.at(-1).pass ? 'ok' : 'FAIL') + ' — ' + rep.checks.at(-1).note);
            }
          }
          if (scene === 'comb') { // ((LC G6) the faces' own numbers at 1 × and 6 × (cap 120): per-frame work ≤ 0.1 ms and the overlay moving every painted frame at 1 ×; a curve recompute ≤ 4 ms, an amount move's re-combine ≤ 0.5 ms at 6 ×; then ■: nothing per frame
            for (const th of [1, 6]) {
              await s('Emulation.setCPUThrottlingRate', { rate: th }); lastTh = th;
              await ev('__fpsPage.prepare(window, ' + JSON.stringify({ scene, cap: 120, display: 120, warm: 1500, throttle: th, fast: o.fast, perf: o.perf }) + ')', 120000);
              const r = await ev('__fpsPage.combProbe(window, { ms: 2500, reps: 15 })', 120000), P = r.per || [], mx = f => (P.length ? Math.max(...P.map(f)) : NaN);
              const G = th === 1 ? [['frame med ≤ 0.1 ms', mx(p => p.frame.med), 0.1], ['overlay moved ≥ 0.98 of the frames', -Math.min(...P.map(p => p.moved)), -0.98]]
                : [['recompute med ≤ 4 ms', mx(p => p.recompute.med), 4], ['window edit ≤ 4 ms', mx(p => Math.max(...p.winEdit.map(w => w.ms))), 4], ['amount move re-combine med ≤ 0.5 ms', mx(p => p.amtView ? p.amtView.med : NaN), 0.5]];
              const pass = !!r.ok && r.playing && P.length === 2 && G.every(([, v, lim]) => v <= lim) && !(r.errors && r.errors.length);
              rep.checks.push({ id: 'comb probe ' + th + 'x', size: sk, scene, pass, value: r, note: !r.ok ? r.why : G.map(([n, v]) => n + ': ' + r3(Math.abs(v))).join(' · ') + ' · ' + P.map(p => p.k + ' frame ' + p.frame.med + '/' + p.frame.p95 + ' recompute ' + p.recompute.med + '/' + p.recompute.max + ' move ' + (p.amtMove ? p.amtMove.med + '/' + p.amtMove.max + ' (host ' + p.amtHost.med + ', view ' + p.amtView.med + ', the combine alone ' + (p.combine ? p.combine.med : '–') + ')' : '–') + ' curves ' + p.curvesPerS + '/s').join(' · ') });
              say('   comb probe @' + th + '×: ' + (pass ? 'ok' : 'FAIL') + ' — ' + rep.checks.at(-1).note);
            }
            await s('Emulation.setCPUThrottlingRate', { rate: 1 }); lastTh = 1;
            await ev('__fpsPage.prepare(window, ' + JSON.stringify({ scene, cap: 120, display: 120, warm: 500, throttle: 1, fast: o.fast, perf: o.perf }) + ')', 120000);
            const r = await ev('__fpsPage.combProbe(window, { stop: true, ms: 2500, settle: 1500 })', 120000);
            const wd = (t, w) => t + ': lc ' + w.lc + ', ' + w.per.map(p => p.k + ' frame() ' + p.frames + ' overlay ' + p.overlayPaints + ' (unmoved ' + p.samePaints + ') curves ' + p.curvePaints + (p.live ? ' live' : '')).join(' · ') + ' (rAF med ' + w.rafMed + ' ms, ' + w.frames + ' frames)';
            rep.checks.push({ id: 'comb stopped', size: sk, scene, pass: !!r.pass, value: r, note: !r.ok ? r.why : wd('■', r.stopped) + ' | ' + wd('⏻ off', r.off) });
            say('   comb stopped: ' + (r.pass ? 'ok' : 'FAIL') + ' — ' + rep.checks.at(-1).note);
          }
          if (scene === 'kit') { // ((DM G9) the faces' own numbers at 1 ×, 4 × and 6 × (cap 120): the per-heard-step work, the writes, the playhead on the heard step; a tap / a pattern switch / a voice added and removed; then ■: nothing at all
            for (const th of [1, 4, 6]) {
              await s('Emulation.setCPUThrottlingRate', { rate: th }); lastTh = th;
              await ev('__fpsPage.prepare(window, ' + JSON.stringify({ scene, cap: 120, display: 120, warm: 1500, throttle: th, fast: o.fast, perf: o.perf }) + ')', 120000);
              const r = await ev('__fpsPage.kitProbe(window, { ms: 2500, reps: 12 })', 240000);
              const G = KIT_GATES(th, r);
              const pass = !!r.ok && !!r.playing && G.every(([, v, lim]) => v <= lim) && !(r.errors && r.errors.length);
              rep.checks.push({ id: 'kit probe ' + th + 'x', size: sk, scene, pass, value: r, note: !r.ok ? r.why : G.map(([n, v]) => n + ': ' + r3(Math.abs(v))).join(' · ') + ' · ' + kitNote(r) });
              say('   kit probe @' + th + '×: ' + (pass ? 'ok' : 'FAIL') + ' — ' + rep.checks.at(-1).note);
            }
            await s('Emulation.setCPUThrottlingRate', { rate: 1 }); lastTh = 1;
            await ev('__fpsPage.prepare(window, ' + JSON.stringify({ scene, cap: 120, display: 120, warm: 500, throttle: 1, fast: o.fast, perf: o.perf }) + ')', 120000);
            const r = await ev('__fpsPage.kitProbe(window, { stop: true, ms: 2000, settle: 1500 })', 120000), S = r.stopped || {};
            rep.checks.push({ id: 'kit stopped', size: sk, scene, pass: !!r.pass, value: r, note: !r.ok ? r.why : '■ ' + S.frames + ' frames in 2 s: kit callbacks ' + S.kitCallbacks + ', face paints ' + S.paints + ', grid repaints ' + S.grid + ', canvas paints ' + S.canvasPaints + ', DOM writes under the kit ' + S.kitWrites + ', playhead ' + (S.phOn ? 'ON' : 'hidden') + ', kit clock clients ' + JSON.stringify(S.clients) + ' (rAF med ' + S.rafMed + ' ms)' });
            say('   kit stopped: ' + (r.pass ? 'ok' : 'FAIL') + ' — ' + rep.checks.at(-1).note);
          }
          if (o.load && (scene === 'tutorial' || scene === 'master') && sk === o.sizes[0]) { // ((FR Cut B §7 G8) Δ load (on − off) ≤ max(0.005, 2 × the A/A spread)
            await s('Emulation.setCPUThrottlingRate', { rate: 1 }); lastTh = 1;
            await ev('__fpsPage.prepare(window, ' + JSON.stringify({ scene, cap: 120, display: 120, warm: 1500, throttle: 1, fast: true }) + ')', 120000);
            const plan = loadPlan(), r = await ev('__fpsPage.loadRun(window, ' + JSON.stringify(plan) + ')', plan.reduce((a, x) => a + x.ms, 0) + 120000);
            const v = r.verdict || {};
            rep.checks.push({ id: 'load', size: sk, scene, pass: !!r.ok && !!v.pass, value: r, note: r.ok ? 'Δ load ' + r3(v.delta) + ' (A/A spread ' + r3(v.spread) + ', limit ' + r3(v.limit) + ', ' + v.pairs + ' pairs)' : r.why });
            say('   load: ' + (rep.checks.at(-1).pass ? 'ok' : 'FAIL') + ' — ' + rep.checks.at(-1).note);
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
