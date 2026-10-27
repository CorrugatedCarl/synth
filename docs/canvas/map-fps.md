# ROADMAP 23 — display-rate visuals: map of what exists (canvas @ 9652a15, read-only)

All `file:line` refs are the working tree at **9652a15** (the tree moved from 4c78019 while this was written: the safety-limiter commit 8cd6dc3 shifted main.js ≈ +40/+52 lines, wk.js +28 after :2400, master-ui.js +5…; I re-checked every ref in the changed files against HEAD). "Snapshot rate" = the worklet's monitor post, ≈ 29 Hz (§2).

## 0. The findings that shape the work

1. **Lifting the throttles alone gains nothing visible.** Every visual throttled to 30 fps (graph.js overlays, fx-ui GR bars / Ducker playhead / spectrum overlay, the Serum host's paints, knob mod halos, modulator-module meters) is *data-limited* to the worklet's ~29 Hz `smon` posts, and each already skips a redraw when its data key is unchanged. A 120 / 240 fps ticker would redraw the same pixels. The work is on the **data side** (page-side interpolation of the 29 Hz samples, or a faster opt-in post), not on `wk.ticker`.
2. **Several things already run at the display rate, uncapped**: `main.js frame()` (playheads, track head meters, the OUT scope, position readouts), the world tick (camera, cords, minimap, GL grid). On Low / Medium they are *not* reduced today (the presets touch only cord physics and face-texture density; IMPL-P §11: "Chrome's main thread costs the same at every preset"). A tier must cap these too — that is the first real CPU / battery saving on Low.
3. **The user's iPad Pro is measured at 60 Hz rAF**: every iPad row in `tests/bench.json` (`ui-m3`, `ui-m9`; Chrome for iOS = WebKit, iPadOS 26.6 / 27.0.1) has a frame median of 17 ms. So 120 / 240 matter only on the Mac (M4 Max ProMotion, external monitors). The display rate cannot be read (no `screen.refreshRate` in WebKit): **measure it from rAF deltas**. The native app's WKWebView rate is unmeasured.
4. **Frame-rate-dependent constants misbehave above 60 fps**: `N.peak * 0.88` per frame (track head meters, main.js:5841); `wk.ticker`'s fixed 4 ms slack (wk.js:2953, :2955 — at a 120 fps cap the interval is 8.3 ms, so the gate all but disappears) and its hard `Math.min(60, fps)` (wk.js:2945); the cords' fixed 1/120 s physics step with no render interpolation (cv-cords.js:57 `DT`, :194 `advance`); AnalyserNode smoothing (`smoothingTimeConstant` 0.75 on the 8192 analysers, main.js:1036 and :1110 — applied per `getFloatFrequencyData` call that sees new audio, so a faster call rate shortens the spectrum's smoothing time; verify in a browser).
5. **A faster worklet post must be opt-in.** `tests/golden-graph.test.mjs` compares every posted message with the frozen `tests/ref-1c/engine.js` (monitor scenarios :244–263); `tests/master-proc.test.mjs:385` pins "mmon every ≥ 33 ms"; `tests/engine-track.test.mjs:166` pins the 12.4-quanta cadence. A new rate must default to today's 0.033 s so every golden / frozen ref stays bit-identical.

---

## 1. Every animation / redraw loop in the page code

### A. Already at the display rate (no cap anywhere)

| # | file:line | what it draws | cap / how |
|---|---|---|---|
| A1 | `main.js:5823–5848` `frame()`; self-recurses :5824; started `main.js:10510` | (a) `clockSample` stall meter :5825. (b) while playing (:5826–5834): `roll.setPlayhead(t, true, …)` :5830 → roll.js:345 → `_frame` roll.js:1100 (composites the cached `back` canvas + `_overlay`); `arr.setPlayhead(t, true)` → arrange.js:71 → `draw` arrange.js:333 (cached `buf` + playhead); `posUI` main.js:4912 (two `textContent` writes a frame, :4914 BBT and :4916 `m:ss.mmm`, with `toFixed` / `padStart` strings); `replaceSweep`; `cvModPlay` main.js:9486 (Wheel / Aftertouch / Bend module lanes). (c) :5835–5845 every track's head meter `.head[data-id=…] .hmeter i`: `document.querySelector` per track per frame (:5837), `N.an.getFloatTimeDomainData` (512-sample analyser, main.js:1108–1109), `style.width` (:5843) + `classList.toggle`; **peak decay `N.peak*0.88` per frame** :5841. (d) `drawScope()` :5846 → main.js:5778 (OUT module's wave / spectrum scope: full-canvas redraw with `shadowBlur` 6, only while OUT is live; reads `cv.offsetParent` :5781 and `clientWidth/Height` :5784 every frame). (e) `mout.setLive/draw` :5847 (master OUT, see B2) | none: the rAF rate (60 on the iPad, 120 on a ProMotion Mac, 240 on a fast monitor). Runs idle too (meters and scope with nothing playing) |
| A2 | `cv-world.js:714–740` `request()` / `tick()` | camera write :690 (CSS transform, pct label, 'camera' emit), GL grid / faces `gridAt` :663, cords step :728 + draw :736, minimap `drawMap` :738 / :1787 (only when `mapDirty`), glide / anim / edge stepping | rAF on demand: requested by a camera write, a glide, an anim or `CD.wants()` (an awake rope; cv-cords `onWake` cv-world.js:755); quiesces at rest. Uncapped; time-based (GLIDE_TAU, ANIM_MS) so rate-independent |
| A3 | `cv-cords.js:194` `advance`, `cv-cords.js:57` STUDIO | rope physics: **fixed 1/120 s steps** from an accumulator (≤ MAX_STEPS 8, DT_MAX 0.05, budget 160 rope-steps a frame); drawn once per world tick while any rope is awake | at > 120 fps frames alternate step / no-step: the same positions twice, no render interpolation |
| A4 | input coalescers (not animations): `gesture.js:259–262` (pinch / pan), `cv-face.js:214–311`, `cv-panel.js:1390–1412`, `cv-keys.js:104,269`, `cv-pads.js:149,269`, `cv-drum.js:523` (paint on change), `cv-patch.js:793–811` `lampPump`, `wk.js:2425–2456` (drag auto-scroll `asTick` :2432), `roll.js:724,843–851` (auto-scroll), `wtedit.js:1525`; main.js one-shots :645 :1985 :3150 :3708 :5605 :7167 :10255 :10297 | — | each at most once per frame when something changed. Leave alone |

### B. Throttled (today's caps)

| # | file:line | what it draws | cap / how it is implemented |
|---|---|---|---|
| B1 | `wk.js:2944–2968` `ticker(el, fn, {fps})` | the shared display loop. Default 30; **`Math.min(60, fps)` wk.js:2945**; gate `t - last >= iv - 4` (4 ms slack wk.js:2953, :2955); 10 fps under reduced motion (`iv = 100` :2954); a hidden / unrendered element is *probed every frame* (`getClientRects` :2957, a layout read; re-armed every frame :2961) | users below |
| B1a | `graph.js:510–511` `animator` → `graph.js:657` CurveEditor, `:1343` EnvEditor, `:1703` PathEditor (started only if `o.playhead` is set); `drawOverlay` `graph.js:1187` / `:1615` / `:2055` | the dot / line on LFO, ENV and PATH editors. Playhead providers: `sx-host.js:3969` (LFO phase), `sx-ui-mod.js:261` (ENV stage + t), `sx-ui-mod.js:429` (LFO out + Y) — all read `snap` | ticker 30 fps; **the value only changes per snapshot (~29 Hz)** and `drawOverlay` returns early on an unchanged key. Each draw also does `boxSize` (graph.js:519, `getBoundingClientRect`) + `unrendered` (graph.js:537, `getClientRects`) + `fitCanvas` |
| B1b | `fx-ui.js:2209–2219` `grLoop` (`{fps:30}` :2216), `drawGrs` :2199, `drawGr` :2166 | compressor / Ducker GR bars; the Ducker curve's playhead (`P.ed.drawOverlay`; its own animator replaced by `NO_ANIM` fx-ui.js:1321: "one loop per rack") | ticker 30. Data = `host.gr()` = last `smon.gr` (29 Hz). `drawGr` does `getBoundingClientRect` + builds a `sig` string + `grPanels()` spread array **before** its lazy check — every tick |
| B1c | `fx-ui.js:1820–1831` `specLoop` (`{fps:30}` :1828), `specDraw` :1834 | Delay's realtime spectrum overlay (1024-pt FFT of `ftap`) | ticker 30; data = `smon.ftap` (29 Hz); the FFT reruns every tick even on unchanged data |
| B2 | `master-ui.js:46` `METER_MS=30, SCOPE_MS=30, TEXT_MS=100`; `draw(t)` master-ui.js:430–439; `BAR_MS=30` :477; driven from A1(e) | master OUT: meters canvas (`paintMeters` :290, repainted only when a new `mmon` arrived: `dirty` is set by `update` :409), the scope (`scopeFrame` :380 pulls `mRead` main.js:6914 → AnalyserNodes: *continuous* data, throttled only by the 30 ms floor), DOM numbers (10 Hz). Master row (`createMasterRow` :484): `run()` :559 only inside `update()` :568. New with 8cd6dc3: `syncSafe(T)` (:245 / :522) lets the safety-limiter "Limiting −x dB" hold (LIM_MS 1000, :53) run out on a frame | time floors (≈ 30 Hz at 60 / 120 Hz rAF). The true-peak fall (TP_REL 24 dB/s) is time-based but only evaluated when a paint happens, i.e. at post times |
| B3 | `sx-host.js:2403–2423` `setSnapshot` → one `raf` :2415 → `paintMods` :2450, `paintCanvases` :2528 (`paintCanvas` :2531: redraw iff `cv.key()` changed), `updateVoices` :2459, `checkCapture` :2504; full `paint` :2364 | the whole Serum panel and every Wavecraft part (SerumHost): knob mod halos + live dots (`wk.js` knob `setMod` :334 → `haloPainter` :129), LFO / ENV / wavetable-position / sample-position / unison-phase / filter-tap displays, voice counter, output meter (`mix[9]`, :2474), seq playhead (`sx-ui-seq.js:1668`) | **no timer of its own**: one paint per snapshot, `ticking` flag (≤ 1 per rAF); reduced motion 100 ms (:2412). Effective ≈ 29 Hz. `paintMods` allocates an object per modded control per call; `haloPainter` `.filter().sort()` arrays |
| B4 | other snapshot-driven halos: FX racks `main.js:4007` → `fxLive` main.js:10027 → `fx-ui.js:2763 setLive`; classic panels `main.js:10066` `cpMonitor` → `cpSnap` :10077 → `P.setLive` (does `.find` ×2 and `modTargetsOf` per row per delivery); canvas modulator modules `main.js:9426` `mcMonitor` → `mcSnap` :9437 → `cv-mods-ui` bodies (LFO phase dot, ENV playhead, chaos / macro meters) | knob halos' live dot; modulator bodies | delivery-time work at the smon rate (≈ 29 Hz) |
| B5 | drum lights `main.js:4503` `drumMonitor` → `DRUM.mon` (`cv-drum.js:382`, heard-time queue pumped on rAF cv-drum.js:362); patch lamps `main.js:9217` `ptLampMon` → `PATCH.lamps` (`cv-patch.js:780`) | pad / step LEDs, 900-Series lamps | event-timed to the audio's heard frame `F`; the 29 Hz post only sets *when*, not how smooth. No cap to lift |

### C. Thirty-Hz-looking numbers that are **not** display throttles (keep)

`wtedit.js:10` (host.wt.update ≤ 30 Hz, an edit post), `MODS_MIN_MS=66` main.js:475 and `PT_KNOB_MS=66` main.js:9173 (knob → worklet payload), `stats` every 0.25 s (engine.js:4741 / :5279; cpu / voices readouts), `latRead` 250 ms main.js:2164, metronome 25 ms main.js:2178, stall meter 5 ms main.js:989.

### D. Compositor-only (no JS work): `recpulse` style.css:86/:90, `cv-mblink` :1305/:1307, `tapfa/fb` :111–114, `dr-flash` (cv-drum CSS).

---

## 2. Display-data posts from the worklet (`engine.js`)

Cadence gate (Track): `this.mon && (this.monF += n) >= this.base * 0.033` engine.js:4737 (Master: :5271); `base` = context rate (:1795 / :3558 / :5060). n = 128 → at 48 kHz every **13 quanta = 34.7 ms = 28.8 Hz** (44.1 k: 12 quanta, 28.7 Hz; 96 k: 25 quanta, 30 Hz). Only for parts the page subscribed (`{t:'mon', ids}` / legacy `{t:'smon', on}`: engine.js:4009–4010; page side `monitors` main.js:3030–3076, `wanted()` :3038 returns `[]` when `document.hidden` and gates each sub on `cvLive` = module on screen, unfolded).

| message | produced | rate | payload (approx.) | consumer |
|---|---|---|---|---|
| `smon` Serum Inst `{s, gr, fxph, ftap, i?}` | `Track.postMon` engine.js:4954 (legacy :4956–4971, graphed :4975–4990); `SerumDSP.snapshot` serum-dsp.js:1985 (shape `makeSnap` :1656) | 28.8 Hz per subscribed Serum part | `s` ≈ **15.4 KB**: `eff` F32[1589] 6.4 KB, `filtTap` F32[2048] 8.2 KB, `memNow` F32[48], `mOut` F32[64], `seq` F64[16], `lfoPh/lfoOut/lfoY` F32[10] each, `env/envT` F32[4], `envStage` U8[4], `wtPos` F32[3], `smpPos` F32[12], `mix` F32[11], …; + `gr` F32[192] 768 B, `fxph` F64[48] 384 B, `ftap` F32[1024] 4 KB (only with the Delay overlay open) → ≈ 16.5 KB (20.5 KB) ≈ 0.5–0.6 MB/s per part, structured-cloned *on the audio thread* | main.js:1137 → `monitors.deliver` :3063 → `sxMonitor` :3079/:3085 (`ui.setSnapshot`, `zoneWarm`, `sxInjSnap`); classic `cpSnap`; `drumMonitor`; `ptLampMon` |
| `smon` FX part `{c, gr, fxph, ftap, mo?}` (panel, chain, Serum's own FX) | engine.js:4993, :4997–5001 | 28.8 Hz | ≈ 1.15 KB (+ 4 KB tap, + `mo` F32) | `rec.gr` / `rec.ftap` main.js:4007, `fxLive` main.js:10027, `N.fxph` main.js:1137 |
| `smon` `{mc, mcx}` modulator meters | engine.js:4972, :5007 (only with a `'mods'` sub) | 28.8 Hz | `mc` F32[16] + `mcx{ph F32[20], env F32[8]}` ≈ 170 B | `mcMonitor` main.js:9426 → `mcSnap` :9437 |
| `smon … dr:{lit, act, F}` | engine.js:4967, :4986; `drMon` :2581 | 28.8 Hz | tiny (+ `act` slice) | `drumMonitor` main.js:4503 → `DRUM.mon` |
| `smon … pt:{F, l:[n,bits…]}` | engine.js:4969, :4988; patch-dsp.js:484 | 28.8 Hz while a lamp module is live | tiny | `ptLampMon` main.js:9217 → `PATCH.lamps` |
| `mmon` (Master meters) | `Master.postMon` engine.js:5211 → `Meters.summary` master-dsp.js:285 | 28.8 Hz while `'meters'` subscribed (row or OUT) | `{m,s,i,lra,tp[2],tpMax,pk[2],pkMax,corr,lat}` ≈ 150 B (peaks held since the last post: gap-free) | `masterMsg` main.js:1417 (:1421) → `mout.update` master-ui.js:409 / `mrow.update` master-ui.js:568 |
| `smon c:'mfx'` (master rack) | engine.js:5213 | 28.8 Hz while subscribed | gr / fxph / ftap | main.js:6947 |
| `safe` **(new, 8cd6dc3)** `{gr}` | `Safe.process` engine.js:5412 (`synth-safe`, registered :5419) | every ≥ 0.1 s of audio (≤ 10 Hz), only while it is reducing gain | one number | `safeMsg` main.js:1559 → `mrow.setLimit` / `mout.setLimit` (a 1 s "Limiting −x dB" hold; no animation) |
| `stats` | engine.js:4935 / :4946 (Track), :5352 (Master) | every 0.25 s (4 Hz) | load, voices, snd, os, `per[]` | main.js:1126 `statsText` :1676, `cvCpu` :1170, `masterCpu` :1434 |
| `step` | engine.js:3215 | per sequencer step (event) | `{s}` | `seqStepTo` main.js:4117 (303 lights; handler :1128) |
| `ab`, `mfinal`, `mlat`, `ready`, `fxph`, `*Err`, `fxover` | engine.js:5232/:5268, :5275, :5096, :3631/:5099, :4093–4096, … | events | small | main.js:1127–1148, :1419–1425 |

**Not posted at all:** scope / waveform / spectrum data (page-side `AnalyserNode`s: master `an` main.js:1036 fft 8192, `anL/anR` :1042 fft 2048, per-track `a` fft 512 + `sc` fft 8192 :1108–1110, read every frame), and playheads (page-side from the audio clock, `outFrame()` / `AC.heardTick`, main.js:5827 — continuous; since 8cd6dc3 the clock also adds the limiter's look-ahead `CLK.pipe`, main.js:1557 `safePipe`).

---

## 3. Performance presets today (ROADMAP 14) and where a frame-rate tier plugs in

Wiring (everything visual-only; nothing reaches a worklet):
- Pref `synth.cv.perf` = high | medium | low (`cv-world.js:133` `PERFS`, `PERF_PREF`; `perfOf` cv-cords.js:409). ⚙ → Canvas "Performance" select `#cvPerf`: `main.js:6189–6199` (id :6192; hint :6273, labels :6272); read `perfPref` :6274; pick `perfPick` :6279 stores then `W.setPerf` live; world built at the pref `main.js:6263` (`perf: perfPref()`); `?perf=high|medium|low` overrides for a session (`cv-world.js:582`, read at :481).
- `cv-world.js:2065 setPerf(id)` fans out to **cv-face** (`FACES.setPerf` cv-face.js:748, policy `TEX_Q`: texture density / budget) and **cv-cords** (`CD.setPerf` cv-cords.js:1173, `CORD_Q` cv-cords.js:65: High = 10 pts / SUB 4 full physics, Medium = 6 pts / SUB 3, Low = still, no ticker).
- Nothing else knows a preset: `wk.js`, `graph.js`, `fx-ui.js`, `master-ui.js`, `sx-host.js`, `main.js frame()` and the engine are preset-blind. ROADMAP 14's scope text ("ONLY cords + textures … no other UI change") is superseded by row 23 for frame rate.
- Tests of this wiring: `tests/canvas-P-sim.test.mjs` (the `#cvPerf` select, hint, setPerf), `tests/cv-cords.test.mjs:779` (`(P-1 (c)) High = today, byte for byte`), `tests/cv-world.test.mjs`, `tests/ui-bench-frame.test.mjs` (the `?perf=` bench frame).

Plug points for a tier:
1. A third table beside `CORD_Q` / `TEX_Q`, e.g. `FPS_Q = {high: Infinity (uses the user's cap), medium: 60, low: 30}` (cv-world.js next to `PERFS`, :133), and a second pref (e.g. `synth.cv.fps`: 120 default, up to 240) with a select under the Performance one (`main.js:6189` block). Effective cap = `min(userCap, tier, measuredDisplayHz)`.
2. `cv-world.js:2065 setPerf`, `main.js:6279 perfPick` and boot `main.js:6263` call one new kit function `wk.setFrameCap(hz)` — wk.js is imported by main.js, cv-world.js, graph.js, fx-ui.js, master-ui.js, cv-mods-ui.js, sx-host (all `./wk.js?v=9`, one instance) and already has `setPrefs` (wk.js:109, fed by main.js `kitPrefs` :2945) as the precedent.
3. Worklet rate (optional, §5 D4): `{t:'mon', ids, hz}` from `monitors.sync` main.js:3052 (post at :3059), `postTo` :1387 / `postAll` :1399, honoured at engine.js:4009–4010 / Master `watch` :5206.

---

## 4. Risks

**Per-frame allocation / DOM work that is fine at 30 Hz and not at 120–240** (fix before raising any rate):
- main.js `frame()`: per track per frame a template-literal selector + `querySelector` over the whole DOM (:5837; thousands of nodes on a busy canvas), `toFixed` string, `classList.toggle`, analyser read; `posUI` two strings + two text writes (:4914–4916); `drawScope` clears + redraws the whole canvas with `shadowBlur` (main.js:5778–5822).
- wk.js `haloPainter` :129 (`.filter().sort()` arrays and `arc()` strings per call); sx-host.js `paintMods` :2450 (a `{arcs, live}` object per modded control); main.js `cpSnap` :10077 (`.find` ×2 + `modTargetsOf` per row per delivery), `fxLive` :10027 (closure per call), `mcSnap` :9437.
- graph.js `drawOverlay` (arrays `[a,b]` / key strings per call, `boxSize` :519, `unrendered` :537); fx-ui.js `drawGr` :2166 (`sig` string, rect read, `grPanels()` array); `wk.ticker`'s `getClientRects` probe (wk.js:2957) and `matchMedia` (reducedMotion, :2954) per fired frame; a *hidden* editor still re-arms rAF every frame (wk.js:2961).
- master-ui.js `scopeFrame` :380: `loud()` / `above()` scan 8192 / 4096 / 2×2048 floats per draw.

**Layout reads / forced layout**: `drawScope` reads `cv.offsetParent` (main.js:5781) and `clientWidth/Height` (:5784) *after* the same frame wrote the head meters' `style.width` (:5843) → a forced layout each frame; graph.js `boxSize` / `unrendered`; fx-ui.js `drawGr` :2169 / `rendered()` :2205; `wk.ticker` :2957; `storeDensity` → `inWorld(el)` ancestor walk when the world scale ≠ 1 (wk.js:2781). graph.js already has `observeSize` (graph.js:542): cache sizes there instead of reading per draw.

**Worklet / audio thread**: `postMon` runs on the realtime thread: `SD.snapshot` (loops over voices and grains, `sx.M.snap`, 2×1024 tap copies) + structured-clone allocation (≈ 16.5 KB). × 4 (120 Hz) or × 8 (240 Hz) per subscribed Serum part is real GC / CPU pressure on the audio thread — no DSP bench row covers monitors (`tests/bench-scenarios.mjs` has none). Page side, a high post rate means N message tasks per frame: handlers must only store (latest wins) and paint in the clock.

**iPad / WebKit**: rAF measured at 60 Hz on the user's iPad (17 ms medians); Low Power Mode caps WebKit's rAF further (known behaviour, not verified here); `performance.now()` ~1 ms quantization (CLAUDE.md; the bench's "worst" column) makes ms-level frame timing at 240 fps (4.17 ms) meaningless on the iPad — count paints / rAF callbacks instead; background pages stop rAF (the app's "Sound in background" keeps audio, the UI idles; `monitors.wanted` already returns `[]` when hidden); the native WKWebView app's rate is unknown. A cap that is not a divisor of the display rate (120 on a 144 Hz screen) gives an uneven 1–2 frame cadence — snap to `display / k`.

**Frame-rate-dependent behaviour**: §0.4, plus reduced motion must stay 10 fps (ticker wk.js:2954, sx-host.js:2412, cords: no ticker); the `cv-cords` "High = byte for byte" test (cv-cords.test.mjs:779) constrains any render interpolation to a separate, opt-in path.

**Existing frame-cost harnesses and gates** (all measure pan / pinch / settle at **60 Hz** — headless Chrome frames are 16.7 ms in every Mac row; none measure idle / playing display cost):
- `tests/ui-bench.html` (+ `ui-bench-m3.mjs`, `ui-bench-m9.mjs`, `ui-bench-1i.mjs`, `ui-bench-wc.mjs`, `ui-bench-frame.mjs/.html` for `?perf=`); `recorder()` (m3:942 / m9:1425 / wc:189) logs rAF intervals, `analyse()` (m3:962) gives med / p95 / max / frames > 33 ms per burst / first / settle; CDP CPU throttle 4× / 6× rows (`ui-m9b-mac`: `throttle4/6`).
- `ui-bench-m3.mjs:915 selfCheck`: counts each live canvas's `clearRect`s (`__m3in.paints`, instrumented at m3:226) over 2.5 s with audio running and requires every live display to repaint at ≥ 0.8 × the snapshot rate — the existing "displays repaint at the data rate" gate; the natural place for "≥ 0.8 × min(cap, display rate)".
- `tests/bench.json`: `ui-m3`, `ui-m3-mac`, `ui-m3b-mac`, `ui-m9`, `ui-m9-mac`, `ui-m9b-mac`, `ui-P-mac` (UI frames; cords: iPad 40 awake = step 0.18–0.2 ms + draw 0.05 ms; Mac at 6× CPU: step 0.73–0.83 ms, cord frame 1.1–3.3 ms — cords alone are 25–80 % of a 240 fps (4.17 ms) budget at 6×, which is why Low must be 30). DSP rows `node` / `jsc` / `ipad*` have no monitor-post row.
- Unit tests that pin today's numbers and will need honest updates (not loosening): `wk.test.mjs:2176,2930` (ticker ≤ 30, 4 ms slack, gate order), `master-ui.test.mjs:60,176,188–192,597` (METER_MS / SCOPE_MS / TEXT_MS and "every 33 ms summary is painted"), `fx-ui.test.mjs:1301,1911` (grLoop via ticker), `master-proc.test.mjs:385`, `engine-track.test.mjs:166`, `golden-graph.test.mjs:244–263`, `canvas-M-sim.test.mjs`, `canvas-P-sim.test.mjs` (also notes graph editors animate through `wk.ticker`), `serum-ui.test.mjs` (drives `setSnapshot`; no test pins sx-host's 100 ms reduced-motion rule), and the new `safe-ui.test.mjs` (the LIM hold in master-ui). Goldens / frozen refs (`tests/ref-1c`, `ref-M`, `ref-P`, …) hold as long as the default monitor cadence is unchanged.
- To exercise 120 / 240 in headless Chrome: `--disable-frame-rate-limit` (+ `--disable-gpu-vsync`) so rAF is uncapped, then measure the *callback cost* per frame (self time inside the rAF callbacks via `performance.now()` deltas, or CDP `Performance.getMetrics` ScriptDuration / LayoutDuration / RecalcStyleDuration deltas); a real 120 Hz window on the M4 Max for the end-to-end check. Memory rule applies (one test file at a time).

---

## 5. Proposed central design

**D1 — one frame clock in `wk.js`** (the kit all UI modules already share): a single rAF that dispatches registered clients; `wk.ticker(el, fn, o)` keeps its signature but becomes a client of it. Exports: `setFrameCap(hz)`, `frameCap()`, `displayHz()` (measured: median of ~30 rAF deltas after boot, re-measured on visibilitychange / resize / `matchMedia('(resolution)')`, quantised to {30, 48, 50, 60, 72, 90, 100, 120, 144, 165, 240}), `frameDt()`. Cadence = `display / k` with `k = max(1, round(display / cap))`; slack = 0.4 × the display's frame period (not a fixed 4 ms); the hard `min(60)` removed; reduced motion 10 fps kept; one visibility / live gate per client (a `live()` callback — the world's `cvView.live(key)` / the ancestor module's on-screen flag — instead of `getClientRects` per frame, and no re-arming for hidden clients). Touches: wk.js (ticker/frame at :2930–2968, setPrefs neighbourhood :109), tests/wk.test.mjs.

**D2 — tier + setting**: `FPS_Q` and the ⚙ "frame cap" select (default 120, up to 240; Medium ≤ 60, Low ≤ 30, never above the measured display rate) in cv-world.js (:133 neighbourhood, `setPerf` :2065) and main.js (:6189–6199 UI, :6263 boot, :6274–6284 pref / pick). Decorative animation uses the cap; **camera / gesture / drag paths stay uncapped** (touch latency; they run only while moving). Touches: cv-world.js, main.js, style/hint text, tests/canvas-P-sim.test.mjs, tests/cv-world.test.mjs.

**D3 — move the display-rate loops onto the clock**: `main.js frame()` becomes a clock client (playheads, head meters, OUT scope, master OUT) so Low / Medium actually save CPU; master-ui `METER_MS` / `SCOPE_MS` become "draw when the clock says so" (the meters canvas also redraws while a peak is still falling, not only on a new `mmon`); fx-ui `grLoop` / `specLoop` and graph.js `animator` pass no private fps. Hygiene first (§4): cache meter elements by track id and replace `0.88` per frame with `Math.pow(0.88, dt * 60)`; cache sizes via `observeSize`; hoist `haloPainter` / `paintMods` / `drawGr` allocations; run `specDraw`'s FFT only on a new tap; scale analyser `smoothingTimeConstant` to the call rate.

**D4 — make the data deserve the rate** (three options, cheapest first; recommended order a → b → c):
- (a) *Already continuous, just let the clock drive them*: playheads, analyser scopes, track / master meter ballistics, bars that fall by time.
- (b) *Page-side interpolation of the 29 Hz samples*, in one place: sx-host keeps `prev` / `cur` snapshots with their arrival times and `kit.snap()` (sx-host.js:1633) returns a reused, per-frame **interpolated view** (lerp for `eff`, `lfoOut`, `lfoY`, `env`, `envT`, `wtPos`, `mix`; wrap-aware for `lfoPh`; hold for `envStage`, `notes`, `zone`, `filtTap`, `memNow`, `seq`); the Serum host's paint moves from "per snapshot" (sx-host.js:2403) to "per clock tick while any shown page has live displays". The same idea in a small `live` helper for the other consumers (GR bars with a ~15 ms one-pole, Ducker position, `fxLive`, `cpSnap`, `mcSnap`, master `tp`): do the heavy per-delivery mapping once at 29 Hz and interpolate only the final scalar in the painter. Costs ≈ one post interval (35 ms) of display latency with lerp (or extrapolate phases / env times, which advance linearly). No worklet change; goldens untouched.
- (c) *Faster posts, opt-in*: `{t:'mon', ids, hz}` default 30 → the engine.js gates (:4737 / :5271) use `this.monP` instead of `base*0.033`; a small **fast-lane** message (lfo / env / wtPos / mix / mc / mcx / gr / master summary ≈ 0.4–0.5 KB) at up to 60–120 Hz, the heavy arrays (`eff`, `filtTap`, `memNow`) staying at 30 Hz. Needs: contract + skeptic review, a DSP bench row for `postMon`, the golden-graph default-path proof, an iPad run. Only if (b)'s latency or fidelity is judged too coarse (S&H and retriggers look like ramps under lerp).
- Rejected for now: a SharedArrayBuffer blackboard (needs cross-origin isolation: no header control on GitHub Pages; only the app's `synth://` handler could add COOP / COEP).

**D5 — cords**: leave the 120 Hz physics as is (already drawn at the display rate); render interpolation between steps would be a new opt-in path (the High byte-for-byte test pins today's output): lowest value / highest cost.

### Lift cost, loop by loop

| loop | gain from lifting the cap alone | work needed for a real gain | size | files |
|---|---|---|---|---|
| A1 head meters / playheads / pos / OUT scope | none (already per frame) | put on the clock for Low / Medium; dt-based decay; cache meter nodes; no forced layout; text-on-change | S–M | main.js, tests/main.test.mjs |
| master OUT scope (B2) | **yes** (continuous analyser data, 30 ms floor) | make `SCOPE_MS` follow the cap | S | master-ui.js, tests/master-ui.test.mjs |
| master OUT meters / row bars (B2) | small | redraw while a peak falls; derive floors from the cap | S | master-ui.js |
| track-head meters (A1c) | none | decay fix only | S | main.js |
| world tick / cords / minimap (A2, A3) | none | stays uncapped; 120 Hz physics stays | — | — |
| GR bars, Ducker playhead (B1b) | none (29 Hz data) | one-pole / lerp in `drawGr`, remove the rect read | M | fx-ui.js, wk.js |
| Delay spectrum overlay (B1c) | none | leave at the data rate (FFT on a new tap only) | S | fx-ui.js |
| LFO / ENV / PATH editor playheads (B1a) | none | providers read the interpolated snapshot; ticker unchanged | M | sx-host.js, sx-ui-mod.js, graph.js |
| Serum / Wavecraft panel displays (B3) | none | interpolated snapshot view + clock-driven paint | L | sx-host.js (sx-ui-osc / mix / seq readers unchanged if they use `kit.snap()`) |
| knob mod halos, FX / classic / canvas-module live dots (B3, B4) | none | per-frame painter interpolation; hoist `cpSnap` / `paintMods` / `haloPainter` allocations | M–L | wk.js, sx-host.js, main.js, fx-ui.js, cv-mods-ui.js |
| drum / patch lamps (B5) | none | none (event-timed) | — | — |
| worklet cadence (§2) | — | D4(c) only if needed | L | engine.js, main.js, goldens, bench |

### Proposed order
1. D1 clock + D2 tier / setting (the ticker as a client, no behaviour change at 30 for existing clients), with the measurement harness extension (an idle / playing "live displays" scene recording per-frame callback cost at caps 30 / 60 / 120 / 240, 1× / 4× / 6× throttle; `selfCheck` generalised to "≥ 0.8 × min(cap, display)").
2. D3 hygiene + the cheap lifts (master scopes / meters, head-meter decay, `frame()` on the clock).
3. D4(b) interpolation for the Serum host, then GR / halos.
4. Decide D4(c) from the iPad numbers.

Open questions for the user / lead: should Low cap the main `frame()` (head meters / playheads at 30) — it is the only way Low saves battery; should the ⚙ cap apply on every preset or only High (the user's words: "presets may lower it"); is ~35 ms of extra display latency on knob halos / LFO dots acceptable under lerp, or should phases be extrapolated; should the native app's WKWebView rAF rate be measured before promising 120.
