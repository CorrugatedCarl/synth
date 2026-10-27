# Stage FR: display-rate visuals (IMPL-FR) — contract, amended after the skeptic's review (§13)

ROADMAP row 23 (docs/canvas/ROADMAP.md:44 [R]). **Scope (the user, 2026-10-26 / 27 — settled, not re-asked)**: "we need all our modules
to run at 240 fps max or capped at the display"; "lets make the default cap 120 and an option to go higher in the settings"; "no 60
should be the minimum fps" (no preset below 60); on the ~35 ms an interpolating glide would add: "can we reduce it?". Every animated
part redraws on one requestAnimationFrame clock at the display's rate up to 240 fps; the shaped motion (LFO / ENV / curve dots, the knob
rings they drive) shows **with ≈ 0 lag against the heard audio**; the big buffers stay at ≈ 29 Hz; frame cost measured at 1440 × 900 and
the iPad sizes, CPU-throttled, before shipping. Map: docs/canvas/map-fps.md (against 9652a15; every file:line below is re-checked at
**f793b47**, §0). Standing: sound bit-identical (every golden), the presets visual only, browser first (no iPad app rebuild; its node
tests stay in the sweep), no per-stage iPad session, "push it live when it's done", the leaner multi-agent shape.

**Two cuts (the lead, 2026-10-27, after the skeptic's review — §13 P1-5)**. **Cut A** (this contract's Part I, fully specified, **no engine
change, deploys on its own**): the frame clock with a test mode, the ⚙ setting and the presets, the loop hygiene (frame(), head meters,
the OUT / master scope and meters at the cap, the graph editors and GR loops as clock clients, every frame-rate-dependent constant written
in time), the Serum CLIP / SEQ playheads from the heard song clock, the heavy displays in a rate class. Visible at once on the Mac: the
master scope 30 → 120 Hz, meters and bars that fall smoothly at the display's rate, a Frame rate setting, Medium / Low saving main-thread
time. **Cut B** (Part II: design notes now, **its own contract round later**): the fast lane posting the *outputs* (not the inputs of a
page-side model), an anchor ring keyed by audio frame and read in **heard** time, and its consumers (the dots and rings at ≈ 0 lag).

**Code references are to `canvas` at f793b47** (HEAD = the MM deploy). Tags as IMPL-MM: **[R]** a fact (file:line), **[R?]** unconfirmed
(the lane pins it), **[C]** a choice made here (a builder may refine a [C] with a reason in §14, never an [R]). **The lead's decisions
taken while the user sleeps are marked "lead, first guess — the user confirms" and listed in §11.**

**Invariants**
- **FR1 Sound untouched; the default post path bit-identical.** Cut A changes no engine file (every golden by construction, and run).
  Cut B's fast lane is opt-in (`{t:'mon', ids, fast: hz}`); without it every Track / MASTER post is byte for byte today's (golden-graph's
  message logs vs the frozen ref-1c engine, tests/golden-graph.test.mjs:244–263 [R]; master-proc:385–393 [R]; engine-track:166 [R]).
  **FR1b (Cut B)**: with `fast` **on**, the audio and **every slow message** are identical to `fast` off (§13 P1-3: the fast lane never
  steals the slow lane's peaks).
- **FR2 One frame clock.** Every decorative animation is a client of **`wk.clock`** (§1): no private rAF loop, no private fps, no fixed-ms
  floor. Exempt by design: the input / camera paths (the world tick cv-world.js:715 [R], the gesture coalescers, the drag auto-scrolls —
  map-fps A2 / A4: latency paths) and the cords' 120 Hz physics (D5; their *draw* is capped on Medium / Low, §3).
- **FR3 Rate-independent motion.** No constant means "per frame": decays, slacks, smoothings and falls are written in time (dt). State
  driven by posts and decays paints the same at any cap (G4 — analyser-sampled meters excepted, §13 P2-7).
- **FR4 (Cut B) ≈ 0 lag against the heard audio.** Posted outputs sit in an anchor ring keyed by `F`; each frame reads the value **at the
  heard frame** `Fh` — interpolated between the bracketing anchors (almost always present: the post-to-heard delay exceeds the fast
  interval), extrapolated ≤ 0.25 s only past the newest; a retrigger, a seek or a stage change shows **when it is heard**. The page still
  draws each dot from shape / phase per frame (the editors' own `evalPts` / ENV formulas).
- **FR5 (Cut B) The fast lane is small, opt-in and allocation-free** (≤ ~400 B, ≤ `FAST_MAX` 120 Hz, reused buffers; the page stores,
  the clock paints).
- **FR6 Never below 60; the iPad does not regress.** The global cap never goes below 60 fps (the display's own rate is the floor when it is
  lower); on a 60 Hz display (the user's iPad Pro in every browser today, §8) every loop keeps today's cadence or betters it, with fewer
  layout reads per frame. Per-client caps (a loop whose data is slower) may stay lower (§13 P2-1).

---------------------------------------------------------------------------------------------------------------------------------

## 0. What exists (facts at f793b47; "→" what they force)

| piece | where [R] | FR |
|---|---|---|
| **`wk.ticker(el, fn, {fps})`**: default 30, **`Math.min(60, fps)`** (:2945); gate `t − last ≥ iv − 4` (a fixed 4 ms slack, :2953 / :2955); `reducedMotion()` (a `matchMedia` per passing frame, :2954; `iv = 100`); **`getClientRects()` per passing frame** (:2957, a layout read); a hidden element re-arms rAF every frame (:2961); `wk.frame(fn)` (:2930: rAF, or a 16 ms timeout in node); `reducedMotion()` :2937 | wk.js:2930–2968 | → **`wk.clock`** (§1); `ticker` keeps its signature as a client; `o.fps` becomes the client's cap |
| **`main.js frame()`**: self-recursing rAF (:5841), started :10629; `clockSample` :5842 (the stall meter: its jitter window is the sampling interval, audioclock.js:94–113 [R]); while playing: `outFrame()` / `AC.heardTick` :5844, `posUI(t)` :5846 (two text writes a frame: :4931 BBT, :4933 `m:ss.mmm`), `roll.setPlayhead` / `arr.setPlayhead` :5847, `replaceSweep` :5848, `cvModPlay` :5849; **per track per frame**: `document.querySelector('.head[data-id=…] .hmeter i')` :5855, `getFloatTimeDomainData` (512, :5857), **`N.peak * 0.88` per frame** :5858, `style.width` + `classList.toggle('clip')` :5860–5861; `drawScope()` :5863 (reads `cv.offsetParent` :5798, `clientWidth / Height` :5801, a full redraw with `shadowBlur 6` :5807); `mout.setLive / draw()` :5864 | main.js:5840–5865; 5795–5837; 4929–4933 | → one clock client `frameTick` (§3 A1); the stall meter on every rAF (a `every` client); time-based decay; cached meter nodes; cached sizes; text on change |
| **`cv-world` tick**: `request()` / `tick()` on demand (camera, glide, anim, edge, cords, minimap), quiesces at rest; time-based; `cordsStep` / `cordsDraw` inside it; `onWake` :755 | cv-world.js:714–740 | untouched but for the cord draw's gate on Medium / Low (§3 A2) |
| **Cords**: `STUDIO.DT = 1/120` fixed steps (:57–58); `advance` :194; `CORD_Q` high full / medium light / **low still** (:65–66); the "High = today, byte for byte" pin (tests/cv-cords.test.mjs:779) | cv-cords.js | physics untouched (D5); the draw's cadence on Medium / Low (§3) |
| **graph.js** editors: `animator(el, fn) = ticker(el, () => fn())` (:511) → `CurveEditor` :657, `EnvEditor` :1343, `PathEditor` :1703; `drawOverlay` :1187 / :1615 / :2055 reads `o.playhead()`, returns early on an unchanged key, each draw `unrendered(root)` (`getClientRects`) + `size()` + `fitCanvas`; the EnvEditor builds a key string and `env()` / `geo()` per draw (:1617, :1624); `observeSize` :542 exists; `boxSize` :519. Providers: sx-host.js:3970 (an LFO's **`this.snap.lfoPh`** — not `kit.snap()`), sx-ui-mod.js:268 (ENV `{stage, t}` via `K.snap()`), :439 (LFO `[lfoOut, lfoY]` via `K.snap()`) | graph.js, sx-host.js, sx-ui-mod.js | Cut A: `animator` → a clock client, sizes cached, no per-draw layout read, the key built from numbers; Cut B: the providers read the view (§II.3) |
| **fx-ui.js**: `grLoop` (:2575–2585, `{fps: 30}` :2582), `drawGrs` :2565, **`drawGr` :2532** (`getBoundingClientRect` + `clientWidth` + a `sig` string + `grPanels()` spread per tick, before its lazy check), **`grSlot(id)` → `core.fxLayout(fx)` per panel per tick** (:2525–2530 → fx-core.js:862–884, a signature string over the rack); `specLoop` :2185–2196 (`{fps: 30}` :2193), `specDraw` :2199 (the FFT per tick); `NO_ANIM` :327; `rendered()` :2574; the rack's RO :927; `setLive(liveOf)` :3131; `host.gr()` = the last `smon.gr` | fx-ui.js; main.js:4007, 6993 | Cut A: clock clients (the GR loop keeps a 30 cap — its data is 29 Hz — until Cut B), `grSlot` cached, no string / rect per tick; Cut B: the fast `gr` |
| **master-ui.js**: `METER_MS = 30, SCOPE_MS = 30, TEXT_MS = 100` (:46); `draw(t)` :430–439 (meters when `dirty`, the scope on a 30 ms floor from `reader` = `mRead` main.js:6980 — AnalyserNodes: continuous —, text 10 Hz); `paintMeters` :290 (`TP_REL` 24 dB/s time-based, evaluated only when a paint happens; `accTp = […]` per paint :294); the row: `BAR_MS = 30` :477, `run()` :559 inside `update()` :568 | master-ui.js | Cut A §6: the scope at the cap, meters when dirty **or falling**, text 10 Hz, the row's bars on the clock while falling |
| **sx-host.js** `setSnapshot(msg)` :2404–2424 (stores `smon` / `snap`, one `raf`, 100 ms under reduced motion :2413), `paintMods(false)` :2451 (an object per modded control), `paintCanvases()` :2529 (`paintCanvas` :2532 redraws iff `cv.key()` changed; the key strings `join('|')`), `updateVoices` :2460 (**dispatches every page's `kit.live` callbacks** :2478–2483: the MIX meters sx-ui-mix.js:271 / :553, the XY dot and filter handles sx-ui-osc.js:2330 / :2505 via `liveN` :755 → `eff`, **and the CLIP recorder's functional work** sx-ui-seq.js:2003–2026), `checkCapture` :2505; `canvas(cls, key, draw, extra)` :1648 / :2522; `this.snap` read at :2036, :2452, :2462, :2476, :2508, :2511, :3970, :4104; the slot host :4233 (its monitor :4298–4320) | sx-host.js, sx-ui-*.js | Cut A: the rate class on `canvas()` (§3 B3), the CLIP / SEQ playhead (§3 B6); Cut B: the view, `kit.frame`, the tick client (§II) |
| **Heavy displays**: the filter display's key reads `D.liveN(F + 'cutoff').toFixed(4)` … (sx-ui-osc.js:3171–3176) and its draw runs `filterImpulse` (a new `SFilter`, 4096 ticks, `Float64Array(4096)` — serum-dsp.js:1525–1542) + two more 4096 arrays + an FFT; the wavetable display keys on `D.livePos(o).toFixed(4)` + `warpSig()` (:1557–1563) and draws `warped(frameAt(…))` or `draw3d` | sx-ui-osc.js | → a per-canvas rate class, **60** for these (§3 B3; lead — the user confirms, §11 Q2) |
| **The CLIP / SEQ playhead**: `playhead: () => seq[5]` from the slow snapshot (sx-ui-seq.js:1668; `seq` F64[16], serum-dsp.js:1664); the sequencer's timebase: playing → the song beat `tickAt(F) / 960`, stopped → a free clock at `proc.bpm` (sx-seq.js:61–67) | sx-ui-seq.js, sx-seq.js | Cut A §3 B6: the sub-step from the heard song beat while playing, the step from the post; Cut B: `seq` in the fast vector |
| **main.js consumers at delivery time**: `mcSnap` :9526–9540, `fxLive` :10139 (:10148 `base + mo[i]`), `cpSnap` :10189 (the transfer per row; `I.modEff()` engine.js:2138–2150 is the persistent array it reads), `drumMonitor` :4520, `ptLampMon` :9301 | main.js | Cut B's consumers (§II.4) |
| **Monitors**: `sub / wanted / sync / deliver` :3047–3092 (`wanted` → `[]` when `document.hidden` :3057; `on` = the ids' join; **`monitors.fx` splits `on` by `','`** :3088); the node's first `{t:'mon'}` :1167; `visibilitychange` → `monitors.sync()` :10570–10573; the port handler does `project.tracks.find` per message :1136–1137 | main.js | Cut B: `fast` requested beside `on` (**a separate `fastOn` map**, §13 P2-3) |
| **The worklet's cadence**: Track :4737, MASTER :5380 (`mm \|\| mx \|\| mcMon`); `watch` :4100–4121 / :5306–5311 (**`watch` sets `monF = 0` and posts a full snapshot at once** :4119–4120 / :5310); `postMon` :4954–5008 / :5315–5325; `this.frames = currentFrame + n` (:4703–4704 Track, :5366–5367 MASTER: context frames); **the slow post resets the Track's channel peaks** (`I.mixPk.fill(0)` :4964 / :4995) and **`Meters.summary` restarts tp / pk** (master-dsp.js:39–41, :300) | engine.js, master-dsp.js | Cut B: fast-only accumulators (`mixPkF`, `Meters.peek()`), FR1b |
| **ModCore monitor fields**: `MC.live` F32[16], `MC.livePh` F32[20], `MC.liveEnv` F32[8], `mread()` while `MC.mon` (mod-core.js:158–183); `fxMon(id)` a persistent copy (:397) | mod-core.js | Cut B reuses them |
| **sx-mod's LFO / ENV laws** (:374–530, :1466–1475 `snap` with the per-LFO kind logic; `evalRow / evalRowX` :201–260; DELAY / RISE :1937–1946, :509–514; `pmEval` :488–492; `envTick` :2036–2095) | sx-mod.js | **Not ported to the page** (§13 P1-5): the outputs are posted; the page evaluates shape from phase only |
| **The audio clock**: `outFrame(perfTs)` main.js:2039 = `AC.outFrame` (audioclock.js:67: the heard frame = `renderTime` − `outDelay`; WebKit's `outDelay` = smoothed `outputLatency` + `RING / sr` + stalls + `C.pipe` + the user offset; Chromium's stamp is the speaker time), `renderTime` :41, `heardTick` :82, `meterSample` :94–113; cv-drum's heard-time queue (cv-drum.js:263 `heardAt`, :355–372 `deliver` by `F ≤ heard`) | main.js, audioclock.js, cv-drum.js | → **a post's `F` is ahead of the heard frame by `outDelay` (10–40 ms; 150+ ms on Bluetooth)**: Cut B reads anchors at `Fh` from a ring, as the drums do (§13 P1-1) |
| **The presets** (IMPL-P): `PERFS`, `PERF_PREF` cv-world.js:133; `perfURL()` :582; `setPerf(id)` :2065–2070 → `facesPerf` + `CD.setPerf`; main.js ⚙ line :6209–6219 (`#cvPerf`, `#cvPerfHint`, `PERF_LABEL / PERF_HINT` :6293–6294), `perfPref` :6295, `perfUI` :6296, `perfPick` :6300–6305, the world built at the pref :6284; pins tests/canvas-P-sim.test.mjs:44–55 (`gp[i]` / `gp[i + 1]`) and **:75 "no worklet message at any switch"** | cv-world.js, main.js | → `FPS_PREF / FPS_OPTS / FPS_Q`, `setFps`, `?fps=`, the line after the Performance hint (§2) |
| **The analysers**: master `an` 8192 / 0.75 (main.js:1048, read by `mRead` at ≈ 30 calls/s today), `anL / anR` 2048 (:1054), per track `a` 512 (:1121), `sc` 8192 / 0.75 (:1122, read at the display rate today) | main.js | → τ scaled per analyser from its **own** base rate (§7.2) |
| **The simulated rAF**: tests/main-sim.mjs:341 `requestAnimationFrame` queues into `sim.rafQ`, **`cancelAnimationFrame` is a no-op**, `raf(rounds)` :384 runs the queue with **`performance.now()`** (rounds microseconds apart); 38 test files call `.raf()` (canvas-2a-sim 111, canvas-8-sim 77, canvas-sim 69, main.test 67, canvas-1e-sim 63, canvas-2b-sim 62, canvas-7a-sim 45, …); tests/wk-dom.mjs:204–218 `raf.flush(n, t0)` advances **40 ms** per round; `matchMedia` stubs without events (main-sim :340) | tests/ | → the clock's **test mode** (§1.6) and a `_reset()` per boot; the sweep after phase 0 (§13 P1-4) |
| **Pins of today's numbers** (move by design, §10.4): tests/wk.test.mjs:2176 / :2930; tests/master-ui.test.mjs:60, :176–192, :597; tests/fx-ui.test.mjs:1301 / :1911 (**kept**: the GR loop keeps its 30 cap in Cut A); tests/canvas-P-sim.test.mjs:25, :75 | tests/ | §10.4 |
| **Harnesses**: tests/ui-bench.html (`?m3=1` → ui-bench-m3.mjs: `__m3in.paints` per canvas by a `clearRect` hook :226–227 — **`fillRect` not counted; SVG knob rings not counted**; `A.mon.n` :277–283; **`selfCheck` :915–937 drops canvases below 0.2 × the reference rate** (:928); `recorder` / `analyse` :940–1002), ui-bench-frame.mjs (`?perf=` into the app frame); CDP CPU throttling 4 / 6 × (IMPL-P §4:271–277); Chrome for Testing from `.claude/test-browser` (tests/ui-layout-fx.mjs:453–464, flags :486) | tests/ | → `tests/ui-bench-fps.mjs` with G7 made measurable (§9, §13 P2-8) |
| **bench.json**: `node` / `jsc` / `ipad` rows + `targets`; tests/bench-scenarios.mjs `scenarios()` :502, `measure` :797 | tests/ | Cut B's rows |
| **MM reserved it** (IMPL-MM §3.2, §7.4, §8): MASTER's `watch` ignores unknown fields; the master's bodies ride `mcSnap`; `master-ui.js` is row 23's | docs/canvas/IMPL-MM.md | Cut A uses none of it; Cut B adds `fast` to both `watch`es |

=================================================================================================================================
# Part I — Cut A (no engine change; deploys on its own)
=================================================================================================================================

## 1. The frame clock — `wk.clock` (phase 0: the lead) [C]

### 1.1 One rAF, clients
`wk.clock` is a module singleton (one per module instance, like `prefs` wk.js:32 [R]): **one `requestAnimationFrame` while any client is
on**, none at rest (the last client's `off` cancels it; a stale callback from before a `_reset()` does nothing — a generation token).
`clock.add(client) → off`, `client = { fn(t, dt), live?(): bool, el?: Element, cap?: hz, essential?: bool, every?: bool, name?,
end?() }`: `fn` runs on the frames the cadence picks while live; `dt` = ms since this client's last painted frame (its first frame:
its period); `cap` a slower per-client ceiling (none by default); `essential` exempts the client from the reduced-motion rule; `every`
runs `fn` on **every** rAF, ungated (the stall meter — §3 A1 (a)); `end()` is called when the clock drops a client whose `el` left the
document. **`wk.ticker(el, fn, o)`** keeps its signature, returns `{ start, stop, running }`, is a client over `el` and **ends itself when
`el` leaves the document** (today's rule, wk.js:2952 [R]); **`o.fps` is the client's `cap`** (default 30, no `min(60)`): phase 0 changes
nothing for today's callers (graph.js's `animator`, fx-ui's two loops stay at 30), lane H-A lifts the caps that should follow the display
(§3).

### 1.2 The display rate: measured, with hysteresis
No `screen.refreshRate` in WebKit: the rate is **measured from the rAF deltas**. A ring of the last **32** deltas (a delta > **250 ms**,
`CLK_LONG`, is not entered: a hide, a stall — the code's fixed bound, adopted at review 1: a "2.5 × the current period" rule would
never let a real sustained drop to ≈ 40 fps be measured); the candidate = **the mean of the inlier deltas within ±25 % of the ring's 25th
percentile** (WebKit's 1 ms timer reads 240 Hz as 4 / 5 ms: the mean of the inliers is 4.17 → 240; 60 Hz reads 16 / 17 → 60), quantised
to the nearest of `DISPLAY_RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240]` within 8 %, else the raw rounded Hz (clamped
10…1000; **the estimate is not capped** — §13 P3-4 — the ceiling is). **60 until the ring is full**; the first full-ring candidate is
adopted at once; afterwards a change needs **1 s of agreement** (hysteresis: a candidate that differs from the estimate must be confirmed
by every re-estimate for 1000 ms before it lands — under load half the frames drop and the median would flap 120 → 60 → 120; a tab switch
no longer clears the ring, the hide's long delta is simply rejected). Re-estimated every 8th frame (a 32-sort is cheap; not needed per
frame). `onChange(fn)` fires when `eff()` changes (an adopted estimate, `setCap`, `config`).

### 1.3 The cadence (lead, first guess — the user confirms, §11 Q1)
With `D` the display rate and `C = min(cap, DISPLAY_MAX = 240)` the ceiling in force (§2: `min(setting, tier)`):
**`k = 1` when `D ≤ 1.25·C`, else the smallest `k` with `D / k ≤ 1.25·C`**; then the **60 floor on the global cap only**: while
`k > 1 && D / k < 60` → `k − 1`; **the effective rate `E = D / k`**. A display within 25 % above the setting draws at the display's rate
(144 at the 120 setting → 144; 72–100 Hz displays on Medium / Low → the display); otherwise a divisor (165 / 120 → 82.5 — "the user can
pick 165"; 240 / 144 → 120; 240 / 165 → 120; 360 / 120 → 120; 120 / 60 → 60; 240 / 60 → 60; 90 / 60 → 90; 60 / 120 → 60; 30 → 30). A
**per-client cap** uses `k_c = max(1, round(E / cap_c))` with **no floor** (a 30 fps GR loop stays 30 on a 60 Hz display: the fx-ui pin
holds); reduced motion (10 fps) is the same rule with `cap_c = min(cap_c, 10)`. **The gate**: a client paints when `t − last ≥ P_c −
slack` with `P_c = k·k_c·(1000 / D)` and `slack = 0.5·min(dtFrame, 1000 / D)` (`dtFrame` = the current rAF delta: half the *actual* frame,
so the cadence is right even while the estimate is still 60 on a 120 Hz display — not a fixed 4 ms, which at 120 Hz is half the interval);
`last` = the client's last paint. A dropped frame does not shift the cadence: the next vsync paints.

### 1.4 Inside a frame
Clients run in registration order over a static list (rebuilt on add / remove: no array copy per frame); each `fn` wrapped (`try … catch`
→ `console.error`, the loop goes on). `document.visibilityState === 'hidden'` → no client runs (clients keep `last`; the first frame back
paints). Reduced motion is read as today: **once per frame, on the first client whose gate passes** (`matchMedia`; if it changed, that
client's gate is re-tested with the 10 fps period — wk.js:2953–2955's two-stage rule [R], kept so the moved pin's logic survives). The
clock keeps **`stats()`** for the harness: `{ display, cap, eff, frames, paints, ms: { med, p95, max } }` — `ms` = the clients' summed self
time per painted frame over the last 2 s (two `performance.now()` reads a frame). The heard frame per frame is the host's business
(main.js computes `outFrame(t)` once per frame and shares it — §13 P3-7; the kit knows no audio clock).

### 1.5 "Live" without layout reads
A client with `el` is live while `el.isConnected` and on screen: **one shared `IntersectionObserver`** (root null, threshold 0; a Map el →
clients) when available — `display: none` (a hidden page, a folded module) is "not intersecting" too — **optimistic at `add`** (live until
the observer answers: the first frame after a show or a pan-in is never skipped), else (node, the test DOM) a `getClientRects` probe **at
most every 500 ms per client** (first at the first frame). A client with `live()` supplies its own test (`cvView.live(key)` — the module
on screen —, a host's `shownPages()`); none → always live. The ticker's per-frame `getClientRects` (wk.js:2957 [R]) and the hidden
element's re-arm (:2961) are gone.

### 1.6 Test mode (§13 P1-4)
`wk.clock.config({ display?, gate? })`: `display > 0` fixes the estimate (no measuring); `gate: false` paints every live client on every
rAF. `wk.clock._reset()` drops every client (calling their `end`), cancels the frame, clears the ring / estimate / cap / stats /
listeners / config. **tests/main-sim.mjs** calls `_reset()` and `config({ display: 60 })` before each boot (the same module instance
serves every boot of a file: `main.js?v=9&sim=N` imports `./wk.js?v=9`) — the cadence deterministic, the gate as today (rounds
microseconds apart skip capped clients exactly as the 30 fps ticker skipped them); a sim that needs every client to paint per round sets
`gate: false` for that test and restores it. tests/wk-dom.mjs's 40 ms rounds measure a raw 25 Hz display: a client cap of 10 (reduced
motion) → `k_c = round(25 / 10) = 3` → every third round — the same count the fixed 96 ms gate gave (the fx-ui:1301 pin holds).

### 1.7 API (fixed here)
```
wk.clock.add(client) → off           client = { fn(t, dt), live?(), el?, cap?, essential?, every?, name?, end?() }
wk.clock.setCap(hz)                  the ceiling (cv-world: min(setting, tier)); Infinity = the display (≤ DISPLAY_MAX)
wk.clock.cap() / display() / eff()   the ceiling; the measured display rate; the effective paint rate D / k
wk.clock.period()                    1000 / eff()
wk.clock.stats() / clients()         §1.4; `clients()` → the names
wk.clock.onChange(fn) → off          eff() changed
wk.clock.config(o) / _reset()        §1.6 (tests, the bench)
wk.ticker(el, fn, o) → { start(), stop(), running() }   a client over el; o.fps = its cap (default 30)
```
Exported constants: `DISPLAY_RATES, DISPLAY_MAX = 240, FLOOR_HZ = 60, RING_N = 32`. `wk.frame(fn)` stays for one-shots. `__synthTest.fps =
{ clock, stats, cap, eff }` (lane H-A).

---------------------------------------------------------------------------------------------------------------------------------

## 2. The setting, the presets (lane K: cv-world.js, main.js) [C]

### 2.1 The ⚙ "Frame rate" line (lead, first guess — the user confirms, §11 Q1)
Pref **`synth.cv.fps`** (cv-world `FPS_PREF`), **`FPS_OPTS = ['120', '144', '165', '240', 'display']`** — "120 fps" (the default),
"144", "165", "240", "Display rate" — a data-driven list; `fpsOf(v)` → the Hz (`'display'` → Infinity). `?fps=120|144|165|240|display|<N>`
overrides for a session (beside `perfURL`, cv-world.js:582 [R]; never stored). The line: `label.field.cv-fps` holding `select#cvFps` +
`p.cv-ghint#cvFpsHint`, appended **after** `#cvPerfHint` (main.js:6219 [R]) so canvas-P-sim's `gp[i] / gp[i + 1]` pins hold. Hint:
"Smoother motion on fast displays. Medium and Low draw at 60 fps where the display allows; the sound never changes." plus, live while the
popover is open (a 1 s interval, cleared on close), "Display 120 Hz · drawing at 120 fps"; **options above the measured display rate are
shown disabled** with the live hint explaining (the iPad: every option draws at 60 — §13 P3-15). `fpsPref()` / `fpsUI()` / `fpsPick(v)`
beside `perfPref / perfUI / perfPick` (:6295–6305); `perfUI()` refreshes both. Stored per device, never in the project or its History,
**no worklet message** (canvas-P-sim:75's pin holds in Cut A).

### 2.2 The tiers
`FPS_Q = { high: Infinity, medium: 60, low: 60 }` (High follows the setting; **Medium and Low cap at 60 — cords too**, §3 A2); the ceiling in
force `C = min(fpsOf(fpsPref()), FPS_Q[perf])`, snapped by the clock (§1.3: on 72–100 Hz displays Medium / Low draw at the display's rate
— the 60 floor — §11 Q7). cv-world: `setFps(v)` beside `setPerf(id)` (:2065), both → `applyCap()` = `wk.clock.setCap(C)` and `emit('fps',
{ cap })`; `W.fps` getter; the world built at the pref (main.js:6284 `perf: perfPref()` [R] gains `fps: fpsPref()`). Cut B adds the data
rate per preset (`FAST_Q`, §II.2) — not here.

### 2.3 What Low / Medium save in Cut A
Today they touch cord physics and face textures only (IMPL-P §11: "Chrome's main thread costs the same at every preset" [R]). Now every
clock client (`frameTick`, the scopes, the meters, the editors, the GR loops) and the cords' draw run at ≤ 60 on a faster display — the
first real main-thread saving on Medium / Low.

---------------------------------------------------------------------------------------------------------------------------------

## 3. Loop by loop (Cut A) [C]

| loop (map) | today | Cut A | owner |
|---|---|---|---|
| **A1 `main.js frame()`** | its own rAF, uncapped; per-frame `querySelector`, `0.88`, layout reads, two strings | (a) the stall meter `clockSample` as an **`every`** client (ungated: its jitter window is the rAF interval, §13 P3-5); (b) **`frameTick`** (`essential`, the global cap): playing → `outFrame(t)` **once per frame** (shared as `host.heardFrame`), `posUI` writes each text **only when it changed** (the ms text changes every frame — the recorded exception), `roll.setPlayhead` / `arr.setPlayhead` / `replaceSweep` / `cvModPlay` as today; head meters: `headMeterEl(tid)` memo (Map tid → el, dropped on `renderNav` / `renderAll` and when `!el.isConnected`), **`N.peak = max(p, N.peak · 0.88^(dt / 16.667))`**, `style.width` only when the rounded % changed, `classList.toggle('clip')` only when the state flips; `drawScope()`; `mout.draw(t)` | H-A |
| **OUT scope** (`drawScope`) | per frame; `offsetParent` + `clientWidth / Height` reads; `shadowBlur 6` full redraw | sizes from a ResizeObserver on `#scope`, shown-ness from `cvView.live(out)` + the view flag; the analyser read + draw at the cap; if G7 measures the glow > 0.5 ms a frame at 240 the glow becomes a second wider low-alpha stroke [C]; `smoothingTimeConstant` scaled (§7.2) | H-A |
| **A2 world tick, cords, minimap** | on demand, uncapped; cords drawn once per tick | the tick stays uncapped (latency); **the cord draw**: on Medium / Low gated to ≤ 60 (`cordsDraw` skipped while `T − lastCordDraw < 1000 / 60 − slack`; the physics steps every tick as today), on High **skipped when no rope stepped and the camera is still** (§13 P3-10) — behind the "High = today, byte for byte" pin (tests/cv-cords.test.mjs:779): if the scripted scene's bytes change, High keeps today's draw and only Medium / Low gate | K (cv-world) |
| **A4 input coalescers** | ≤ 1 per frame on change | untouched | — |
| **B1 `wk.ticker`** | 30 fps default, `min(60)`, 4 ms slack, `getClientRects` per frame | a clock client (§1); `o.fps` = its cap | phase 0 |
| **B1a graph.js editors' playheads** | ticker 30; data per snapshot (29 Hz) | `animator` → `ticker(root, fn)` **without a cap** (the global rate: the dot moves whenever its provider's value moves — Cut A: the ENV / LFO providers still change at 29 Hz, the CLIP / SEQ one every frame, §3 B6); `size()` cached from `observeSize`, `unrendered` out of `drawOverlay`, the EnvEditor's key from numbers (`stage`, `t` rounded), `env()` / `geo()` memoised per `env` identity | H-A (graph.js) |
| **B1b fx-ui GR bars, Ducker playhead** | ticker 30; `drawGr` reads layout, builds a string, `grSlot` → `fxLayout` per tick | a clock client **keeping `cap: 30`** (its data is the 29 Hz `gr` until Cut B — the fx-ui:1301 / :1911 pins hold); `drawGr`: sizes from the rack's RO (`P.grW / grH`), the `sig` → 8 numbers in a `Float64Array(8)` per panel, `grPanels()` cached (rebuilt on `refresh` / add / remove), **`P.grI` cached at `refresh` / a layout-key change** (§13 P2-10) | H-A |
| **B1c Delay spectrum overlay** | ticker 30; FFT per tick | a clock client, `cap: 30`; `E.draw` only when `host.tap()` is a new array | H-A |
| **B2 master OUT / row** | 30 ms floors | §6 | H-A |
| **B3 Serum / Wavecraft hosts** | one paint per snapshot | **unchanged cadence** (29 Hz data) but: `canvas(cls, key, draw, { maxHz })` gains the **rate class** (§13 P1-2): a canvas declares `maxHz` and `paintCanvas` honours it (a key change inside the period waits for the period's end — the work is bounded whatever moves its key); **the filter response, the wavetable / warp 2D + 3D, the spectral filter and the spectra declare `maxHz: 60`** (lead, first guess — §11 Q2); dots, playheads, meter bars declare none. Inert at 29 Hz data; it bounds Cut B | M-A |
| **B4 halos / live dots** | at delivery (29 Hz) | unchanged in Cut A | — |
| **B5 drum / patch lamps** | event-timed on `F` | untouched | — |
| **B6 the Serum CLIP / SEQ playhead** (sx-ui-seq.js:1668 `seq[5]`, 29 Hz steps) | per snapshot | **while the song plays** (the sequencer's timebase is the song beat, sx-seq.js:61 [R]): the provider returns `step_post + frac(heardBeat(t)·spb)` — the step from the last post, **the sub-step from the heard song beat** (`host.heardTick()` / 960 × the clip's steps per beat), the local step advanced when the fraction wraps and corrected at each post (the step index is exact at posts; **swing shifts step edges**: the sub-step is approximate under swing — recorded); the dot through a graph / seq overlay that is a clock client. **Stopped** (the free clock), Hz-rate arps, swing: the posted value (29 Hz) until Cut B's fast `seq` (§II.1) | M-A |
| **C** the non-display 30 Hz numbers | | untouched | — |

---------------------------------------------------------------------------------------------------------------------------------

## 4. (Cut B — see Part II.) Nothing of the page-side motion model is built in Cut A.

## 5. (Cut B — see Part II.) No engine change in Cut A.

## 6. The master's displays (lane H-A: master-ui.js, main.js) [C]
- **The OUT**: `draw(t)` called by `frameTick` at the cap; `METER_MS / SCOPE_MS` → **0** (retired from the exports; `TEXT_MS` 100 stays):
  the **scope** paints every clock frame while live and the signal is not silent (`scopeFrame`'s `idle` / `quiet` / `live` rule :380–399
  [R] unchanged); the **meters canvas** paints when `dirty` (a new `mmon`) **or while a true-peak bar is still falling** (`tpLv[c] >
  max(accTp[c], TP_LO) + 1e-3`; `TP_REL` 24 dB/s is time-based :291–293 [R] — now evaluated every frame); the text 10 Hz; `syncSafe(T)`
  per frame; `accTp` kept as two numbers, not an array per paint (§13 P3-11). The goniometer = analyser data at the cap.
- **The row**: `update()` → `run()` as today, plus a clock client while `live && (a bar is falling || overUntil > T)` (`BAR_MS` → 0;
  `renderBars`' `TP_REL·dt` :544 [R] is time-based); added on the first fall, removed when both bars rest.
- The master rack's GR / Ducker position: unchanged (29 Hz) until Cut B. The limiter's hold: unchanged.

---------------------------------------------------------------------------------------------------------------------------------

## 7. Hygiene — what every Cut A lane does in its own files [C]

### 7.1 Time, not frames
`0.88` per frame → `0.88^(dt / 16.667)`; the ticker's 4 ms → half the actual frame (§1.3); `METER_MS / SCOPE_MS / BAR_MS` → the clock;
`TP_REL` per frame. **G4** is the proof: the fake-DOM scene painted at 60 and at 240 agrees at the common frame times for every
post-and-decay-driven value (meter widths from a stubbed analyser that returns a non-zero window only at the shared 60 Hz frame times
and zero elsewhere — §13 P2-7 —, `tpLv`, the row bars, the overlay keys) within 1e-6.

### 7.2 The analysers' smoothing (lane K)
Chromium and WebKit apply `smoothingTimeConstant` once per `getFloatFrequencyData` call that sees a new render quantum [R? the lane
verifies in Chrome for Testing: the spectrum's settling time at 60 vs 120 calls/s]. The exact law for an unchanged look is
**`τ_f = τ0^(f0 / f)`** with `f0` **each analyser's own base rate today** (§13 P3-3): the master `an` (0.75 at ≈ 30 calls/s through
`mRead` [R]) → `0.75^(30 / f)` (60 → 0.866, 120 → 0.931, 240 → 0.965); the OUT scope's `sc` (0.75 at the display rate, already 120 on a
ProMotion Mac) → `0.75^(60 / f)` with 60 as its reference (120 → 0.866, 240 → 0.931, 30 → 0.5625); set on `wk.clock.onChange`. The 512
head-meter analysers are time-domain (no smoothing).

### 7.3 No allocation, no layout read in a hot loop
- wk.js (lane K after phase 0): `fitCanvas` → `storeDensity` → `inWorld(el)` memoised per element **only while `el.isConnected`** (§13
  P3-6); `haloPainter` reuses its `list` array (an in-place filter + insertion sort over ≤ 8 arcs).
- graph.js (H-A): `size()` cached by `observeSize`; `unrendered` out of `drawOverlay`; the EnvEditor key from numbers; `env()` / `geo()`
  memoised.
- fx-ui.js (H-A): §3 B1b / B1c.
- main.js (H-A): `headMeterEl` memo; `posUI` on change (the ms text: every frame — recorded); `drawScope` sizes from the RO; `outFrame(t)`
  once per frame.
- master-ui.js (H-A): §6; `scopeFrame`'s scans unchanged (≈ 10 µs).
- sx-host.js (M-A): `paintCanvas`'s key — a canvas may return a **number or a small array compared element-wise** instead of a joined
  string (the `canvas()` contract gains `keyN()`; the heavy displays' keys move to it; the string path stays for the rest until Cut B).
- **The gate** (G7): heap growth while idle-animating at 240 fps with 3 live displays ≤ **1 MB/s**; Layout / RecalcStyle deltas < 1 ms/s
  idle-animating; `stats().ms` within §9's budgets.

---------------------------------------------------------------------------------------------------------------------------------

## 8. The iPad / WebKit — Cut A
- **Measured 60 Hz rAF** on the user's iPad Pro in Chrome for iOS = WebKit (bench.json `ui-m3` / `ui-m9`: 17 ms frame medians, map-fps
  §0.3 [R]); WebKit's default keeps page rendering updates near 60 fps even on a 120 Hz panel [R? untested here]; the app's WKWebView rate
  is unmeasured ([R?]; a stage-A spike could try the WebKit switch — browser first, §11 Q3). **120 on the iPad is measured, never promised.**
- **Cut A on a 60 Hz display**: the clock measures 60 → `E = 60` at every setting and preset; the playheads / head meters / OUT scope keep
  their cadence; the master scope 30 → 60; the GR loops stay 30 (their data); **fewer layout reads** (no `getClientRects` per ticker frame,
  no `querySelector` per track per frame, no rect / `fxLayout` per GR tick); the ⚙ options above 60 shown disabled. Low Power Mode (rAF 30):
  the clock follows (FR6: the display is the floor), recorded. **Must not regress** (lead): G7's 6 × row at 60 and the consolidated pass's
  `ui-fps` scenes (burst medians within 5 % of `ui-m3`'s on the same scenes).
- **Background**: rAF stops; `monitors.wanted` → `[]` when hidden (main.js:3057 [R]); on return the estimate is kept (§1.2).

---------------------------------------------------------------------------------------------------------------------------------

## 9. Gates — Cut A

| gate | what | target |
|---|---|---|
| **G1 sound (FR1)** | no engine / DSP file in Cut A's diff (the lead checks `git diff --stat` against the DSP list); every golden file, master-proc, engine-track, canonical-stream, golden-graph, ref-M / ref-MM / ref-SC run in the sweep anyway | exact |
| **G2 the clock** (tests/wk.test.mjs) | the estimate from synthetic rAF streams at 60 / 120 / 144 / 240 with ±1 ms jitter and dropped frames (60 / 120 / 144 / 240; 16 / 17 ms → 60; 4 / 5 ms → 240; a 25 Hz stream → raw 25; 60 until 32 samples; a flap of half-dropped frames for 0.5 s does **not** change the estimate, 1 s does; a hide's long delta rejected); the cadence table of §1.3 (every pair listed); the half-frame slack from the actual delta; per-client `cap` without the floor (30 on a 60 Hz display → every 2nd frame); reduced motion 10 fps except `essential`, re-read on a passing frame; `every`; hidden document; `ticker` as a client (start / stop / running / ends with the element, `end`, a throwing fn logged); **no `getClientRects` per frame** (≤ 3 per second per client without an observer; 0 with a stubbed IO; optimistic until the IO answers); `setCap` live + `onChange`; `dt`; `stats()`; `config` / `_reset` (a stale frame after `_reset` is inert; `gate: false` paints every round) | exact |
| **G3 setting + presets** (tests/canvas-P-sim.test.mjs, tests/cv-world.test.mjs) | the `#cvFps` line after `#cvPerfHint` (the P pins hold), options `['120', '144', '165', '240', 'display']`, default `'120'`, stored `synth.cv.fps` per device, never in the project / History, **no worklet message on a pick or a preset switch** (:75 holds), `?fps=`; `FPS_Q` through `W.setPerf` / `W.setFps` → `wk.clock.cap()`; the disabled options above the measured rate; the hint's live text; the cords' draw gate per preset | exact |
| **G4 rate independence (FR3)** (tests/fps-determinism.test.mjs, new; the fake DOM) | one scripted feed (`mmon` summaries, head-meter analyser stubs non-zero only at the shared 60 Hz frame times, transport) painted with the clock at `config({ display: 60 })` and `config({ display: 240 })`: at the 60 Hz frame times the head-meter widths, `tpLv`, the row bars and the overlay keys agree within 1e-6; the head-meter decay per second equal | exact |
| **G7 frame cost** (reviewer 2 + lane S: `tests/ui-bench-fps.mjs`, Chrome for Testing `--headless=new --use-angle=metal --force-device-scale-factor=2`; frames driven **exactly** at 1000 / cap ms with `--enable-begin-frame-control` (`HeadlessExperimental.beginFrame`) — else `--disable-frame-rate-limit` with the gate counted **per painted frame**; sizes 1440 × 900, 1366 × 1024 touch, 1024 × 1366 touch; CPU 1 × / 4 × / 6 × by CDP) | scenes: (a) **the user's tutorial patch** (ROADMAP 20: a Wavecraft "Saw to Square" oscillator with an LFO on wavetable position **with the 3D view on**, two LFOs on an MG Low 12 cutoff, the Envelope on LEVEL, Reverb → Ducker → two Utilities under LFOs, 128 BPM, playing); (b) a Serum complete with 4 LFOs + 2 ENVs cabled, its FX with a compressor, the OUT scope; (c) the master canvas (compressor + Ducker, 2 LFOs, the OUT); (d) 8 tracks' head meters + the roll playhead; at caps 60 / 120 / 240 (`?fps=`): per painted frame **the clock's `stats().ms` + the `onmessage` handlers' time** (wrapped by the harness) med ≤ 2 ms, p95 ≤ 4 ms at 240 and 1 ×; at 4 × (Medium → 60) med ≤ 8 ms; at 6 × / Low (60) med ≤ 12 ms; CDP `ScriptDuration` / `LayoutDuration` / `RecalcStyleDuration` deltas per second recorded (layout + style < 1 ms/s idle-animating); **an expected-live list per scene** (every canvas and SVG ring the scene must animate — none may stop: the 0.2 × drop of `selfCheck` removed), paints counted by `clearRect` **and `fillRect`** hooks and `.wk-live` `cx` writes by a MutationObserver, each ≥ 0.8 × its expected rate (the heavy displays: 60; the GR loop: 30; the rest: `eff`); heap growth ≤ 1 MB/s; no console error; the iPad sizes' ⚙ line fits; recorded as bench.json `ui-fps-mac` | within targets |
| **G9 the real 120 Hz window** (reviewer 2: **the lid open, the window on the built-in ProMotion display**, not clamshell / external — §13 P3-13; recorded which) | the clock measures 120; the master scope / head meters / OUT scope paint at 120 (the paints counters); the ⚙ hint reads "Display 120 Hz · drawing at 120 fps"; Medium → 60; a 60 Hz external monitor (if available) → 60 | pass / recorded |
| **G10 UI parity** (reviewer 2) | static scenes' screenshots byte-identical to f793b47's (the FX look, a Wavecraft canvas at rest, the master canvas at rest, the Serum complete's FX page: `tests/ui-layout-fx.mjs`); the animated ones at matching frame times visually equal; the ⚙ popover at 1440 × 900 and the iPad sizes | pass |
| **G11 the sweep** | every test file, one at a time, after phase 0 (before the lanes branch) and again at integration; the sim files adjusted by their owners (§10.0) | green |

---------------------------------------------------------------------------------------------------------------------------------

## 10. Lanes (Cut A), interfaces, rules, pins, docs

### 10.0 Phase 0 — the lead: **the clock** — see §14 for the build notes
wk.js `wk.clock` (§1, with the test mode) + `ticker` as a client (`o.fps` = the cap: every caller as today); tests/wk.test.mjs (G2; the
:2176 / :2930 pins moved, §10.4); **tests/main-sim.mjs** (`_reset()` + `config({ display: 60 })` per boot); **every sim file that the
sweep shows affected** (the 38 `.raf()` callers — owners: phase 0 fixes what the clock changed, nothing else); `sw.js` precache. No
engine file touched (the goldens by construction, and run). **The full sweep, one file at a time, before the lanes branch** (G11).

| lane | owns (exclusive) | gates | model |
|---|---|---|---|
| **K** setting + presets + kit hygiene | cv-world.js (`FPS_PREF / FPS_OPTS / FPS_Q`, `fpsOf`, `?fps=`, `setFps`, `applyCap`, the `'fps'` event, **the cord draw's gate** §3 A2), main.js's ⚙ block only (:6209–6219's neighbourhood, `fpsPref / fpsUI / fpsPick`, the disabled options, boot :6284, the analysers' τ on `onChange` §7.2), wk.js (`inWorld` memo, `haloPainter` reuse — §7.3; **not** the clock), tests/canvas-P-sim.test.mjs (+ the line), tests/cv-world.test.mjs, tests/cv-cords.test.mjs (the draw gate; the byte-for-byte pin decides High's skip) | G3, §7.2, §7.3 (wk) | **Sonnet** (mechanical, the API fixed here) |
| **H-A** the host loops | main.js (`frameTick` + the `every` stall-meter client + the memo + decay + `posUI` + `drawScope`'s RO + `host.heardFrame` once per frame + `__synthTest.fps`), master-ui.js (§6), fx-ui.js (§3 B1b / B1c: clock clients at `cap: 30`, `grPanels` / `grI` / sizes cached, numeric sig), graph.js (`animator` without a cap, cached sizes, numeric EnvEditor key, memoised `env` / `geo`), tests/main.test.mjs, tests/master-ui.test.mjs (pins moved), tests/fx-ui.test.mjs (unchanged pins; + the caches), tests/graph*.test.mjs, tests/canvas-M-sim.test.mjs, tests/fps-determinism.test.mjs (G4) | G4, §6, §3 | **Opus 5.5** |
| **M-A** the Serum host's rate class + the CLIP / SEQ playhead | sx-host.js (`canvas(cls, key, draw, { maxHz })` + `keyN`, `paintCanvas`'s per-canvas period; **no tick client, no view in Cut A**), sx-ui-osc.js (the heavy displays declare `maxHz: 60`, their keys as `keyN`), sx-ui-seq.js (the playhead provider §3 B6: the heard beat through `K.host.heardTick`, `spb` from the clip's rate; the overlay as a clock client), sx-ui-mix.js (nothing in Cut A), tests/sx-host.test.mjs, tests/serum-ui.test.mjs (the safe assert wrapper), tests/sx-ui-osc.test.mjs, tests/sx-ui-seq.test.mjs | §3 B3 / B6 | **Opus 5.5** |
| **S** the harness | tests/ui-bench-fps.mjs (+ `?fps=1` in ui-bench.html: the G7 scenes incl. the tutorial patch, the begin-frame / per-painted-frame driver, CPU throttling, the expected-live lists, the `clearRect` + `fillRect` + `.wk-live` counters, the handler timing, the CDP duration deltas, the heap gate, `stats()` JSON), tests/ui-bench-fps.test.mjs (its pure parts), bench.json `ui-fps-mac` (reviewer 2 fills); texts review | G7 (tooling) | **Sonnet** |
| reviewers × 2 | (1) **node + the sweep** (Opus 5.5 — §13 P3-14: Fable only where the real engine is at stake, none in Cut A): FR2 / FR3, G2, G4, the clock's clients audit (`clients()` after every scene: no leak, no double rAF), reduced motion, the sim adjustments; (2) **Chrome for Testing + the built-in 120 Hz screen** (Opus 5.5): G7, G9, G10, the iPad sizes, a power cycle / hidden tab / preset switch mid-animation, the disabled options on a 60 Hz emulation | — | Opus 5.5 × 2 |
| fixers | the finding's files, failing test first | | Sonnet / Opus |

### 10.1 Interfaces (fixed here)
- **wk.js**: §1.7; `DISPLAY_RATES, DISPLAY_MAX, FLOOR_HZ, RING_N`.
- **cv-world**: `FPS_PREF = 'synth.cv.fps'`, `FPS_OPTS`, `FPS_Q`, `fpsOf(v)`, `W.fps`, `W.setFps(v)`, `W.on('fps', { cap })`; `o.fps` at
  build; `?fps=`.
- **Hosts** (main.js → sx-host / master-ui / fx-ui / graph): `heardFrame() → frame` and `heardTick()` (the frame's shared values),
  `fps: () => wk.clock.eff()`.
- **sx-host `canvas()`**: `extra.maxHz`, `keyN` (a number or a small array).
- **Hooks**: `__synthTest.fps = { clock: wk.clock, stats: () => wk.clock.stats(), cap, eff }`.

### 10.2 Rules
`?v=9` on every import; new test files `import './v8-guard.mjs'` first; never fake-DOM nodes in `assert.*`; one test file at a time with
`--max-old-space-size=2048`; **Cut A touches no engine / DSP file** (a lane that needs one stops and says so); browser gates with Chrome for
Testing only (CLAUDE.md), downloads blocked; no iPad app build or install; **no constant means "per frame"** (a reviewer greps for `0.88`,
`- 4`, `_MS = 30`, `fps: 30`); no lane commits `sw.js` (the lead runs `node tools/precache.mjs --write`); builders in worktrees reset to
the phase-0 commit.

### 10.3 Order
Phase 0 (the clock + the sweep) → K, H-A, M-A, S in parallel → integration (the lead) → reviews → fixers → the sweep → `precache --write`
→ deploy → the user tries it (§11's list) → ROADMAP / HANDOVER → **Cut B's contract round** (Part II).

### 10.4 Pins that change by design (Cut A)
tests/wk.test.mjs:2176 (the 4 ms slack → half the actual frame; the test's counts hold at 60 / 120 Hz streams but it now asserts the new
rule and the `fps: 60` option as a cap) and :2930 (no `getClientRects` per frame: ≤ 3 per second, 0 with an IO stub);
tests/master-ui.test.mjs:60 (`METER_MS / SCOPE_MS` retired), :176–192 (with `draw(t)` every 8 ms and summaries every 33 ms the meters
paint ≥ 30 and ≤ 125 a second — the falling rule — and every summary is painted), :597; tests/canvas-P-sim.test.mjs:25 (the comment);
the sim files phase 0 adjusts (listed in §14). **Not changed**: fx-ui.test:1301 / :1911 (the GR loop keeps its 30 cap), canvas-P-sim:75
(no worklet message), master-proc:385, engine-track:166, golden-graph:244–263, every golden, ref-1c / M / MM / SC, canonical-stream,
app.test's module count (18), bench.json's existing rows, cv-cords:779 (High = today — the draw skip is behind it).

### 10.5 Docs (the lead, at the end of Cut A)
ROADMAP row 23 (Cut A done + the user's answers; Cut B next), the feedback table; HANDOVER (§4: `wk.clock`, the test mode, `synth.cv.fps`;
§5: a display rate is measured, never read; a sim's clock is configured, never assumed; a worklet message shape is a frozen contract — add
a message, not a field); map-fps.md (a line: superseded by IMPL-FR); row 18's light-show skin ("tied to ROADMAP 23's frame clock":
`wk.clock` is it).

=================================================================================================================================
# Part II — Cut B (design notes; its own contract round after Cut A ships)
=================================================================================================================================

## II.1 The fast lane posts **outputs** (lane E, engine.js + sx-base.js + serum-dsp.js + sx-mod.js + fx-dsp.js + master-dsp.js) [C]
- Request: `{t:'mon', ids, fast: hz, effIx?: { [part]: Int16Array }}` — `hz` 0 / absent = off (FR1); `effIx` = **the page's requested
  `eff` indices per Serum part** (the panel's modded controls `modEls[].i`, sx-host.js:2445 [R]; ≤ 64) — the fast vector carries the recent
  voice's `eff` **at those indices only** (copied as `snap` does, sx-mod.js:1457–1464 [R]: `mv.eff` / `m.bT` / the FX base + `fxOff`).
- Messages: `{t:'fast', F, i, v, effV?, gr?, mo?}` (Serum part: `v` = `SxBase.FAST`'s layout — `mix`(11), `wtPos`(3), `smpPos`(12),
  `noisePos`, `notes`, `lfoPh / lfoOut / lfoY`(10 each), `env / envStage / envT`(4 each), **`seq`(16, §13 P3-9)** ≈ 86 floats; `effV` the
  requested indices' values; `gr` a **persistent `grF`** sized at layout (§13 P3-2, not a `subarray`); `mo` = `mc.fxMon(c.id)`),
  `{t:'fast', F, c, gr, mo?, modEff?}` (an FX part; a classic Inst's `I.modEff()` persistent array, engine.js:2138–2150 [R]), `{t:'fast',
  F, mc, mcx}`, MASTER `{t:'fast', F, m}` with **`m` from `Meters.peek(out)`** — `m`, `s`, `corr` and **fast-only `tpF / pkF` running maxima
  reset by `peek` alone, never `i` / `lra`, never the slow `summary`'s accumulators** (§13 P1-3) — and the Track's **`mixPkF`** beside
  `mixPk`: two `max` ops per block, no sample changes. `F = this.frames`.
- `SD.fastSnap(I, v)` reads the LFO / ENV fields through **an additive export of sx-mod's `snap` kind logic** (sx-mod.js:1465–1475 [R];
  no copy in serum-dsp), never `SD.snapshot`.
- Gate: `hz > 30` → a subtractive frame accumulator `P = base / hz` (**the exact pattern at 48 kHz / 120 Hz: 4, 3, 3, 3, 3, 3, 3, 3 quanta
  — a 4 every eighth post, mean 3.125** — §13 P3-1; at 44.1 kHz mostly 3 with an occasional 2); `0 < hz ≤ 30` → rides each slow post.
  `FAST_MAX = 120`; `FAST_Q = { high: 120, medium: 60, low: 30 }`; **the iPad (WebKit): capped at 60 and measured in the iOS simulator's
  Safari (the "SYNTH iPad Pro 13" simulator on `localhost:8817`: the same WebKit AudioWorklet) before it ships there** (lead; §13 P2-9,
  §11 Q3).
- **FR1b** (tests/fast-lane.test.mjs): a Track and a MASTER with `fast: 120` on produce the same audio and the **same slow message
  sequence** as with `fast` off; the default-off path identical to today's; the shapes; the cadence pattern; `grF` null without a
  compressor; no allocation per post.
- Cost (G8): node / jsc rows `fast-sx / fast-fx / fast-master` ≤ base + 0.002 (the pack; `noAlloc`); in Chrome the real worklet's
  `stats.load` **interleaved on / off every 5 s for 10 cycles with an A/A control**: Δ ≤ max(0.005, 2 × the A/A spread) (§13 P2-9); the
  iOS simulator run for WebKit.

## II.2 The page: the anchor ring in heard time (lane M-B: motion.js + sx-host.js + sx-ui-mix / osc / seq) [C]
- **Why** (§13 P1-1): a post's `F` is ahead of the heard frame `Fh = outFrame(t)` by `outDelay` (10–40 ms, 150+ ms on Bluetooth); a model
  that advances from the newest post shows unheard audio and steps at the post rate. **The design**: every fast message goes into a
  **ring of 64 anchors keyed by `F`** per part (0.5 s at 120 Hz); each frame the view is read **at `Fh`**: the newest anchor with `F ≤ Fh`
  and the next one (`F > Fh`, almost always already there) → **interpolate** (phase wrap-aware, values linear, stages / steps discrete);
  past the newest anchor **extrapolate by the velocity between the last two exact-`F` anchors, bounded at 0.25 s** (Low's slow cadence, a
  late delivery; **not for an LFO faster than E / 4 Hz** — the unwrap aliases — show the newest value, §13 P3-8); the ring is **flushed on
  a context change** (a power cycle, a sample-rate change restart the `F` axis). Corrections (a retrigger, a seek, a stage change) show
  **when heard**, exactly: nothing to predict, nothing to port from sx-mod (DELAY / RISE / PM points / slew / aux / curves / `randd` /
  velocity are all in the posted outputs).
- **Shape per frame**: the dots are still drawn from the shape at the interpolated phase (the editors' own `evalPts` / ENV formulas,
  graph.js:1187–1201 / :1615–1636 [R]) — the user's "computed from shape / phase" (lead, first guess: the goal is the lag, not the method —
  §11 Q5).
- **The view**: `this.snap` **is** the view (the raw message kept as `this.msg`; the view preserves which fields the slow snapshot
  carried — serum-ui.test sends partial snapshots :1445 / :1565 [R]) so every internal reader (sx-host.js:2036, :2452, :2462, :2476,
  :2508, :2511, :3970, :4104 [R]) and every `kit.snap()` reader sees the live values (§13 P2-5). A **`kit.frame(fn)` hook** (visual-only,
  called by the host's tick) takes the MIX meters' `meterFrame` and the XY / filter-handle `liveN` dots out of `kit.live` (which keeps the
  CLIP recorder's functional work at the snapshot rate — §13 P2-4). The host's tick client: `live = the monitor's live() && the newest
  anchor younger than 0.5 s` (off-screen hosts are not live — §13 P2-6); `paintMods` → `el.wk.setLive(n)` (the dot alone, written when
  moved by > 1/1000; `setMod` for arc changes). The rate class of Cut A bounds the heavy displays.
- The slot hosts (canvas / master modulator bodies): `mcSnap(tid, mc, mcx, F)` → `H.live({…, F})` → the same ring (MM5 holds).

## II.3 The consumers (lane H-B: main.js, fx-ui.js, master-ui.js) [C]
`monitors.sub(…, { fast: true })`; `monitors.sync` sends `fast: H` with a **separate `monitors.fastOn: Map<id, hz>`** (the `on` key's
format is read by `monitors.fx`'s split — §13 P2-3); **`onChange` → a debounced re-sync (≤ once a second, only when `H` changes
bucket)** — each `{t:'mon'}` makes the worklet post a full snapshot at once (§13 P2-2); `deliver` routes `d.t === 'fast'` by `i / c / mc /
m` to the subs that asked; handlers store into the ring. fx-ui's GR / Ducker position from the fast `gr` (the loop's cap lifted to the
global rate then), `fxLive` / `cpLive` from the posted `mo` / `modEff` read at `Fh`, the master OUT's bars from the fast `m`, the master
rack's dots from `mo`. canvas-P-sim:75's pin **moves then** (a preset switch reposts `{t:'mon', fast}` while a display is live).

## II.4 Cut B's gates (to be fixed in its contract round)
G5′ interpolation ≡ the worklet's value at `Fh` (a scripted run: the view at each frame vs the engine's `eff` at the heard frame, exact
within float noise when bracketed; the extrapolation bound measured); G6 display lag ≤ one frame; G8 as II.1; FR1b; the iOS simulator
WebKit run; the heavy displays under the rate class with LFO → cutoff / wtPos in G7's tutorial scene.

---------------------------------------------------------------------------------------------------------------------------------

## 11. Items for the user's morning — "lead, first guess — the user confirms"
- **Q1 Frame-rate options and rounding.** Taken: ⚙ offers **120 (default) · 144 · 165 · 240 · Display**; a display within 25 % above the
  setting draws at the display's rate (144 Hz at 120 → 144), else at display / k (165 Hz at 120 → 82.5 — pick 165 if you want it); 240 is
  the ceiling; options above your display's rate are greyed out. OK?
- **Q2 Heavy displays.** (Lead, after review 1: **at ≥ 60 and < 120 fps** — the display's multiple nearest 60 from above, the user's
  60 minimum — see §14 P3-3.) Taken: the filter response, the wavetable (2D / 3D), the warp preview and the spectra redraw at **≤ 60 fps** even
  when an LFO moves them (≈ 1 ms a display each time); the dots, playheads and knob rings run at the full rate. OK, or everything at
  the full rate on High?
- **Q3 The iPad.** Fact: every browser on the iPad draws at 60 (WebKit's default); Cut A keeps that and gets lighter. Cut B's fast posts
  will run at 60 on the iPad and be measured in the simulator's Safari first. The installed app *might* be allowed 120 Hz by a WebKit
  switch Apple does not document — want a small app spike later (browser first, not now)?
- **Q4 Two deploys.** Taken: Cut A (clock, setting, master scope / meters, hygiene; no engine change) goes live first; Cut B (the fast
  posts, the dots / rings at ≈ 0 lag) follows with its own contract. OK?
- **Q5 "Computed from shape / rate / phase".** Taken as the means, not the goal: the engine posts the moving numbers a little *ahead* of
  what you hear and the page shows them exactly when heard, drawing each dot from the shape at that phase every frame — the same ≈ 0 lag,
  exact for retriggers, S&H, delay / rise and curved rows, and far less new code than a page-side copy of the modulation maths. OK?
- **Q6 Medium / Low on 72–100 Hz displays** draw at the display's rate (the 60 floor), cords included. OK?
- **Q7 The Serum CLIP / SEQ playhead** moves every frame from the song clock while playing (Cut A); **cords** draw at ≤ 60 on Medium / Low
  and, on High, only when something moved. OK?

(Settled by your words, not asked: default 120; Medium / Low at 60; never below 60; Low saves on cords, textures and the data rate; the
camera / pinch / drag paths stay at the display's rate — latency, not decoration; cord physics unchanged.)

## 12. Known limits (recorded)
- **A 60 Hz display caps everything at 60** (the iPad in every browser today; Low Power Mode's 30 Hz draws at 30). 120 on the iPad depends
  on WebKit / the app (Q3).
- **Cut A moves no LFO / ENV dot faster than 29 Hz** and no GR bar faster than 30 (their data); the CLIP / SEQ playhead's sub-step is
  approximate under swing and 29 Hz when stopped / Hz-rate; the time readout (`m:ss.mmm`) is one string per frame.
- **Cords**: the 120 Hz physics are not interpolated (D5); the High draw-skip is behind the byte-for-byte pin.
- **The world tick, gestures, drags** are not capped (latency paths).
- **The analyser smoothing scaling** models the browsers' per-call smoothing [R?] (verified in Chrome; WebKit at the iPad pass).
- **Headless Chrome** measures callback cost per painted frame, not vsync behaviour: the real check is the M4 Max's built-in screen (G9);
  144 / 165 / 240 Hz displays are untested hardware (the cadence rule is unit-tested).
- **Cut B** (recorded now for its round): the per-note sources between anchors are the posted values (≤ 8 ms stale); chaos' smooth path
  ≤ one anchor interval stale; the fast lane's cadence jitters by ≤ 2.7 ms (anchored by `F`, so motion is even); WebKit's clone cost is
  the simulator's number until the iPad pass.
- **The iPad app is not rebuilt** for this stage (browser first); its node tests run in the sweep.

## 13. Review log — the skeptic (2026-10-27, against ef6d332: 5 P1 · 12 P2 · 15 P3) and what the lead did with each
- **P1-1** (the anchor never advances; `F > Fh` by `outDelay`): **adopted** — Cut B reads an anchor ring at `Fh`, interpolating between
  bracketing anchors as cv-drum's heard queue does; flushed on a context change (II.2). The draft's "advance from the newest post" is gone.
- **P1-2** (heavy displays redraw every frame): **adopted** — a per-canvas rate class, the heavy displays at 60 (lead — Q2); the tutorial
  patch in G7's scene (a); the cutoff tick may be a per-frame overlay (Cut B).
- **P1-3** (fast meters stale / peaks stolen): **adopted** — `Meters.peek()` with fast-only `tpF / pkF`, `mixPkF`; master-dsp.js owned by
  lane E in Cut B; **FR1b** added.
- **P1-4** (the gated clock vs the simulated rAF): **adopted** — the test mode `config({ display, gate })` + `_reset()`; main-sim configures
  the clock per boot; phase 0 owns every sim file the sweep shows affected; the full sweep before the lanes branch (G11).
- **P1-5** (the page-side physics is the risk): **adopted** — the matrix / LFO / ENV ports are dropped; Cut B posts the outputs (`effIx`,
  `mo`, `modEff`, the LFO / ENV reads, positions, `seq`, `gr`, fast peaks) and interpolates in heard time; the page evaluates shape from
  phase only; **two cuts** (Cut A no engine change). Q5 for the user.
- **P2-1**: **adopted** — options 120 · 144 · 165 · 240 · Display; the 25 % rule; the G2 table; the hint no longer says Medium / Low draw
  at 60 flat; **the 60 floor on the global cap only**, per-client caps without a floor (the fx-ui pin kept).
- **P2-2**: **adopted** — inlier-mean estimate with 1 s hysteresis; the estimate kept across hides (the long delta rejected); Cut B's fast
  re-sync debounced (≤ 1/s, only on a bucket change).
- **P2-3**: **adopted** — a separate `monitors.fastOn` map (Cut B); `on` keeps its format.
- **P2-4**: **adopted** — `kit.frame(fn)` for the MIX meters and the `liveN` dots (Cut B, lane M-B owns sx-ui-mix / sx-ui-osc lines);
  `kit.live` keeps the recorder at the snapshot rate.
- **P2-5**: **adopted** — `this.snap` is the view, `this.msg` the raw message; partial snapshots preserved (Cut B).
- **P2-6**: **adopted** — live = the monitor's `live()` && data younger than 0.5 s (Cut B); Cut A's clients use the module-on-screen flag.
- **P2-7**: **adopted** — G4 specifies the analyser stub (non-zero only at the shared 60 Hz frame times) and limits the 1e-6 claim to
  post- and decay-driven state.
- **P2-8**: **adopted** — G7 times the handlers, records CDP durations, lists expected-live displays per scene (no 0.2 × drop), counts
  `fillRect` and `.wk-live` `cx` writes, drives exact frames (`--enable-begin-frame-control`) or gates per painted frame.
- **P2-9**: **adopted** — G8 interleaved with an A/A control; WebKit measured in the iOS simulator's Safari before Cut B ships on the iPad.
- **P2-10**: **adopted** — `P.grI` cached (Cut A, H-A).
- **P2-11**: **adopted** — the arrival-time `F` path and the velocity estimator are gone; Cut B always has `F` (the fast message rides the
  slow post on Low); extrapolation only past the newest anchor, bounded.
- **P2-12**: **adopted** — owners named: master-dsp.js and sx-mod.js (lane E, Cut B, additive exports), sx-ui-mix / osc / seq (M-A in Cut A
  for the rate class and the playhead; M-B in Cut B), the sim files (phase 0); wk.js hygiene → lane K after phase 0 (the clock itself phase
  0); canvas-P-sim:75 listed (holds in Cut A, moves in Cut B).
- **P3-1** (the cadence pattern): **adopted** — "4, 3, 3, 3, 3, 3, 3, 3 (mean 3.125)" stated; the test asserts that.
- **P3-2** (`subarray` clones the whole buffer): **adopted** — a persistent `grF`.
- **P3-3** (τ law and per-analyser base): **adopted** — `τ_f = τ0^(f0 / f)`, `f0` 30 for the master `an`, 60 for `sc`.
- **P3-4** (cap the ceiling, not the estimate): **adopted**.
- **P3-5** (the stall meter per rAF): **adopted** — an `every` client.
- **P3-6** (`inWorld` memo only when connected): **adopted** (lane K).
- **P3-7** (one `getOutputTimestamp` per frame): **adopted** — main.js computes `outFrame(t)` once per frame and shares it.
- **P3-8** (fast LFOs alias): **adopted** — no extrapolation above E / 4 Hz (Cut B).
- **P3-9** (the CLIP / SEQ playhead): **adopted** — Cut A from the heard song beat while playing (§3 B6); Cut B's fast `seq`.
- **P3-10** (cords drawn when nothing moved; Medium at 240): **adopted** — Medium / Low gate the draw at ≤ 60; High skips when still,
  behind the byte-for-byte pin (lane K).
- **P3-11** (allocations missed): **adopted** — numeric keys (`keyN`), the EnvEditor key from numbers, `accTp` as numbers, `clip` toggle on
  change; `norm(s)` per fast `m` is Cut B's (a reused object).
- **P3-12** (one IO, optimistic start): **adopted** (§1.5).
- **P3-13** (G9's display): **adopted** — the lid open, the built-in display, recorded.
- **P3-14** (Fable thrice): **adopted** — Cut A uses Opus / Sonnet only; Cut B's lane E (the real engine) is the one Fable lane, the
  lead decides at its round.
- **P3-15** (the ⚙ line on 60 Hz devices): **adopted** — options above the measured rate disabled, the live hint.
- **The skeptic's questions for the user** → §11 Q1–Q7 (his 1 → Q5, 2 → Q2, 3 → Q3, 4 → Q1, 5 → Q6, 6 → Q4, 7 → Q7).

## 14. Notes (the builders fill in)

### Phase 0 — the clock (the lead, 2026-10-27; base f793b47; the contract 6e6932a)
- **Built, wk.js only**: `wk.clock` as §1 (one rAF per module instance while any client is on, none at rest; the ring estimate with the
  inlier mean / 8 % snap / 60-until-full / 1 s hysteresis / long deltas rejected; `k` by the 25 % rule with the 60 floor on the global cap
  only; per-client caps `round(E / cap) ≥ 1`; the gate `t − last ≥ P_c − 0.5·min(dtFrame, P_D)`; reduced motion read once per frame on the
  first passing non-essential client, the old two-stage rule; one shared IntersectionObserver, optimistic, `observe` / `unobserve` per
  element; the 500 ms `getClientRects` probe without one; `every`; hidden document runs nothing; `end()` when an element leaves;
  `stats()` with a 2 s window; `onChange`; `config({ display, gate })` / `_reset()` with a generation token). **`ticker(el, fn, o)`** is a
  client with `o.fps` as its cap (default 30): graph.js's `animator` and fx-ui's two loops behave as before. Beyond §1.7: `clock.k()` and
  `stats().measured / k / clients` (for the harness); the raw estimate clamped 10…1000 Hz. **No engine / DSP file touched.**
- **Tests**: tests/wk.test.mjs +3 (the estimate at 60 / 120 / 144 / 240 incl. WebKit's 1 ms-quantised 4 / 5 and 16 / 17 ms streams, a raw
  25, 60 until the ring is full, half-dropped frames keep 120, a change lands after 1 s of agreement and not before, a 5 s hide delta
  rejected; the §1.3 cadence table — 16 pairs —, per-client caps without the floor, reduced motion 10 fps except `essential`, `every`, `dt`,
  gate off, a hidden document; one rAF for every client and none at rest, `onChange` on `setCap` / `config`, `stats()`, the shared IO
  (optimistic until it answers, one observer, one `observe` for a shared element, `unobserve` with the last client), `_reset` leaving a
  stale frame inert under a no-op `cancelAnimationFrame`, `end()` on an element leaving). The :2930 pin rewritten (matchMedia once per
  painted frame; probes ≤ 3 a second, never per frame; an off-screen element seen within 500 ms then never drawn). **The :2176 pin holds
  unchanged**: with the slack taken from the actual frame its every-2nd / every-4th / 10 fps counts are the same under the new rule.
- **tests/main-sim.mjs**: `wk.clock._reset()` + `config({ display: 60 })` before each boot (the same `./wk.js?v=9` instance serves every
  boot of a file). **No other sim file needed a change**: the sweep was green on its first pass — the gate with real `performance.now()`
  rounds skips capped clients exactly as the 30 fps ticker did.
- **The sweep** (`scratchpad/sweep/`, one file at a time, 2 GB each): **154 files, 4 139 tests, 0 failures, 1 466 s**. Goldens untouched by
  construction and run. `node tools/precache.mjs --write`: sw.js BUILD 9098dc741329 (104 versioned files).
- **Browser** (scratchpad `FR/clock-smoke.mjs`: a static server over the worktree, Chrome for Testing 156 headless `--use-angle=metal`,
  1440 × 900 dpr 2, downloads denied, CDP over node's WebSocket): the app boots, **no console error**; the clock measures **60**; probe
  clients over 2 s: uncapped **59.9 Hz**, `cap: 30` → **30.0**, a `display: none` element → **0** (the IntersectionObserver path), `every`
  → 59.9; `setCap(60)` → `eff` 60; trivial clients' self time ≤ 0.1 ms. With `--disable-frame-rate-limit --disable-gpu-vsync` (G7's mode):
  rAF ≈ 8 kHz → the estimate clamps at 1000, `C = 240` → `k = 4`, `eff` **250** (the uncapped client painted 262 / s, `cap: 30` → 31.5,
  `every` → 8 010 / s), `setCap(60)` → 71.4: the ceiling holds in free-running headless Chrome.
- **For the lanes**: H-A registers `frameTick` with `essential: true` and the stall meter with `every: true`; K calls `wk.clock.setCap(C)`
  at the world's build and on every setting / preset switch (today nothing sets the cap: `Infinity` = the display, so every ticker stays
  at its 30 cap and the app behaves as before); the IO root is the viewport — a client inside the CSS-scaled world is observed by its
  bounding box (fine); `_reset()` is for tests and the bench only.

### Lane K — the setting, the tiers, the cord draw gate, the analysers' τ, the wk hygiene (Sonnet 5.5, 2026-10-27; base 8f35d70)
- **cv-world.js** (no cv-cords.js change): `FPS_OPTS ['120','144','165','240','display']`, `FPS_PREF 'synth.cv.fps'`, `FPS_Q {high ∞, medium 60, low 60}`
  (frozen), `fpsOf(v)` → Hz (`'display'` → ∞; a number 10…1000 as it is — `?fps=60` in the harness —; anything else 120); `o.fps` at build,
  `?fps=120|144|165|240|display|<N>` over it (never stored; an N outside the options runs, the ⚙ select keeps showing the pref); `W.fps`
  (the setting's id, a string), `W.setFps(id)` (unknown → '120'); `applyCap()` = `wk.clock.setCap(min(fpsOf(fps), FPS_Q[perf]))` at the build
  (beside `facesPerf`), on `setFps` and on `setPerf`; `'fps'` event `{ cap, fps, perf }` **once per change of the setting or the ceiling**
  (none at build, none for the same pick); `destroy()` gives the cap back (`Infinity`) only if this world set it last (a module `capOwner`
  token: a stale world's destroy leaves a live one's cap). `glStats()`'s keys unchanged (canvas-1h pin).
- **The cord draw gate** (cv-world's tick): `cordsHeld(T)` — Medium / Low hold the **ropes' draw** until `wk.clock.period()` (the effective
  rate: 60 where the display allows, the display's own below the 60 floor — Q6: 90 Hz on Medium → every tick) less the clock's half-frame
  slack (`0.5·min(last tick-to-tick length, period)`); the owed draw stays owed (`CD.wants()` asks the next frame; no frame after the last draw).
  **Refinement of §3 A2 (a [C], reason)**: a draw owed by a **camera write** (`cdMoved`, the microtask `cordsSoon`, `resize`) is never held — the
  cords must follow the world's transform, which stays at the display's rate (latency path, FR2); holding them would show the jacks swim by
  one display frame against the cords at every other frame of a pan on Medium / Low. The saving is the idle-swaying case (G7's), the physics
  steps every tick as ever. **High's skip is inherent, not added**: the layer owes a draw only when a rope stepped (`ropeSteps`) or an end
  moved (`advance` → `dirty()`), so at a 240 Hz tick the swaying ropes draw at the physics' 120/s, not 240 (real cv-cords through the world,
  asserted: 100–125 draws a second at a 240 Hz and at a 120 Hz tick, Medium at a 120 Hz tick 50–62). cv-cords.js is untouched, so the byte-for-byte pin (cv-cords:779) is
  trivially intact; tests pin the property (cv-cords: owed on every second 240 Hz tick, never asleep / camera-only / between steps).
- **main.js** (⚙ block, boot, the analysers; the loop is H-A's): the line `label.field.cv-fps` > `select#cvFps` + `p.cv-ghint#cvFpsHint` appended
  **after** `#cvPerfHint` (`gp.append(pf, ph, ff, fh)`; canvas-P-sim's `gp[i] / gp[i + 1]` pins hold), labels "120 fps · 144 fps · 165 fps ·
  240 fps · Display rate"; `shell.fpsSel / shell.fpsHint` (beside `perfSel`); `fpsPref()` (a valid option, else '120'; a stored number is
  tolerated), `fpsUI()` (the select shows `W.fps` when it is an option, else the pref; **options above the measured display disabled**, "Display
  rate" never; none greyed while the display is unmeasured), `fpsPick(v)` (store `synth.cv.fps` per device → `W.setFps` → `fpsUI`),
  `fpsLive(on)`: the gear menu's `onOpen` / `onClose` — while ⚙ is open the hint reads `<static hint> Display 120 Hz · drawing at 120 fps`
  (+ ` · faster options need a faster display` when any is greyed; `Measuring the display…` before the clock has measured), refreshed on
  `fpsClock.onChange`, the world's `'fps'` and a 1 s `setInterval` (cleared on close — a display measured under an unchanged ceiling changes
  nothing else), the plain hint again on close. `perfUI()` refreshes both lines (a preset switch changes what is drawn); the world is built
  with `fps: fpsPref()`. **No worklet message, nothing in the project or its History** (canvas-P-sim:75 holds; a new test picks every option
  through every preset). `import { clock as fpsClock } from './wk.js?v=9'` is a **second import line placed in the ⚙ block** (not the
  header's :32), so H-A's edit of that line merges clean — the lead may fold the two.
- **The analysers' τ (§7.2)**, `anTau(f0) = 0.75 ** (f0 / eff)`, `AN_F0 = 30` (the master's `an`), `SC_F0 = 60` (each track's `sc`), set at
  creation (powerOn, makeNode) and on `fpsClock.onChange` (`anSmooth`, one module-level listener). **Verified in Chrome for Testing 156**
  (`scratchpad/FR-K/smooth.mjs`: a gain step into an `AnalyserNode` fftSize 256, τ 0.75, read every 8 / 16 / 32 ms — OfflineAudioContext
  suspended on quantum multiples **and** a live AudioContext polled by timers): the per-read ratio of the remaining distance is **0.7500 at
  every read rate** (0.75000 / 0.75000 / 0.74979 offline; 0.75000 / 0.75001 / 0.74953 live; a per-quantum rule would give 0.909 / 0.953 /
  0.976): smoothing is once per read that sees a new render quantum, so `τ0^(f0/f)` is the law. WebKit [R?]: untested here (the iPad pass).
  Real app (smoke2: power on, `clock.config({ display })`, picks): `an` 0.86603 at 60, 0.93060 at 120, 0.96468 at 240, back to 0.86603 on
  Medium (eff 60 at a 240 Hz display); `sc` 0.75 / 0.86603 / 0.93060 / 0.75 — the formula's values; no console error.
- **wk.js hygiene (§7.3)**: `inWorld(el)` memoised per element **only while `el.isConnected`**, the entry keeping the parent it was found
  under (a moved canvas asks again) and an epoch bumped by `setCanvasScale` / `setLayer` (the camera's zoom end — catches an ancestor that
  moved; between zoom ends such a move is the one case the memo can be stale, nothing in the app does it); `haloPainter` and `modBar`'s
  `paint` reuse one `list` (`arcList`: an in-place filter + a stable insertion sort — the same order as `filter().sort()`, equal kinds in the
  order given, pinned) — no array, no comparator a paint (the test counts `filter` / `sort` over arc lists: 0 across 20 paints).
- **Tests** (tests first; each failed before its code): cv-world +5 (constants / `fpsOf`; the tiers, event, owner; `o.fps` / `?fps=`; the draw
  gate with the recording layer at 120 / 90 / 60 Hz — held, never lost, camera exempt —; the real layer High at 240 Hz / 120 Hz, Medium at 120
  Hz), cv-cords +1 (the layer owes a draw only when …), wk +2 (the memo, the halo list), canvas-P-sim +5 (the line, the picks × presets with no
  worklet message / project / History / settings, the disabled options + the live hint through open / close, the analysers' τ at 60 / 120 /
  240 / Medium / a new track, `?fps=` + the next boot + a stored number / an unknown value + the unmeasured hint). **No pin moved**; canvas-P-sim:75 and
  :44–55 are untouched and hold. Gates green one file at a time: canvas-P-sim 13, cv-world 89, cv-cords 49, wk 107, main 47, canvas-sim 24,
  lint 171, pwa (after `precache --write`); also cv-shell-sim 19, app-shell 19, app-shell-web 6, canvas-1i-sim 20, canvas-M-sim 21, canvas-9-sim
  22, canvas-WC-sim 51. **No engine / DSP file touched; `sw.js` not committed** (the lead's `precache --write`).
- **For integration**: until H-A's `frameTick` is a clock client the clock has no client in the app, so it never measures: the open ⚙ hint
  reads `Measuring the display…` and nothing is greyed (Chrome smoke: the picks drive the cap 240 / 60 / ∞ / 120 correctly; the line renders
  at 1440 × 900 under Performance). After the merge: G9's real 120 Hz window should read `Display 120 Hz · drawing at 120 fps`; the iPad `Display
  60 Hz`, every fixed rate greyed. The analysers' τ already follows `eff()`, which is the rate `frameTick` / `mRead` / `drawScope` read at only
  once H-A moves them to the cap (before that the master `an` is read at ≈ 30 / s and the scope at the display's rate: τ then reads a little
  too smooth on a > 60 Hz display until the merge).

### Notes — lane M-A (2026-10-27; base 8f35d70): the heavy displays' rate class, numeric keys, the CLIP playhead
- **sx-host.js**: `canvas(cls, key, draw, { maxHz, keyN })` (the kit doc's `canvas` line says it). `keyN(out)` writes the key's numbers
  (and the state's own strings) into the canvas' buffer and returns their count; two buffers swapped at each draw, compared element-wise
  (NaN = NaN, a count change differs, a throwing keyN redraws as key()'s `Math.random` did); `key()` is then never called. **The rate
  class**: a change inside `rateMs(maxHz)` waits (`paintLater`: one rAF, re-armed until the period ends, the shown pages only — a hidden
  page's waits for the full paint that shows it); a re-measured canvas (its store cleared) draws at once. The period is the clock's
  per-client cap (`k = round(E / maxHz)` frames of `E` — **`ceil` in the review-1 fixer, then `floor` (lead, the 60 minimum), below**) less min(half a display frame, P / 4) — [C] the P / 4 bound: with no clock
  client run yet (`E = D = 60`, unmeasured) a 60 class still stays ≤ 80 / s on a faster display (after H-A the clock always runs).
  `o.now` (a SerumHost option, tests) is the time base; `performance.now()` else.
- **sx-ui-osc.js**: `HEAVY_HZ = 60` on the wavetable display (2D / 3D), the filter display (its MAG + FFT / PHASE + FFT spectra with it)
  and the spectral filter. Their keys as numbers: `keyN` / `filtKeyN`, live values through `liveQ` / `posQ` (× 10^digits rounded, an
  integer: the string keys' `toFixed` digits), base values quantised the same way, the JSON parts (remap, the spectral curve, the PZ
  corners) memoised per repaint (`perEdit` on `kit.paintSeq`: every edit repaints; a snapshot reads the cached string); `key()` /
  `filtKey()` are keyN's joined string (the tests, the stub kit). **Work cached by key**: the filter's response curve by its inputs
  (`rsp`: a spectrum view redrawn per snapshot computes no impulse; the response's and the spectrum's FFT buffers reused); the 3D view's
  back layers per (table, size, density) as Path2D (`b3`: no 2048-sample slot copied, no frame interpolated per redraw; the front frame
  through `slotView`, no copy). [C] An image cache of the back layers (drawImage) was tried first and dropped: not byte-identical — a GPU
  canvas antialiases the front stroke by what was drawn before it (≈ 250 px off by ≤ 42 / 255); Path2D is, and nearly as cheap.
- **sx-ui-seq.js** (§3 B6), [C] refined: not `step_post + frac(heardBeat·spb)` (wrong near a step edge while the heard beat trails the
  post) but the sequencer's own law (sx-seq `pPosAt`) from the newest post heard by then — `clipHeadAt(p, b, hb, rate, dir, st, len,
  wrap, s, d)`: 4·rate sixteenths per **unswung** beat (`swingInv`: exact under swing, not approximate), Normal / Reverse wrapped into
  [START, LENGTH), Pendulum's direction from consecutive posts, the slice modes clamped (a jump shows when its post is heard), Static as
  posted; RATE from the clip's base (a modulated clip RATE re-anchors at each post). Anchors: a ring of 16 posts (`seq[8]` the post's song
  beat, `seq[5]`); the heard beat before every anchor → the earliest later post as posted (a start, a seek not yet heard); anchors older
  than 0.25 s (posts stopped) → as posted. **Lane H-A: the Serum host (main.js `sxHost`) needs `heardTick()`** — read per call, so it
  may come at integration; without it the playhead is the posted value, as today. The clock client `sx-clip-head` (el = the roll, no
  cap) runs while the page is shown and the newest post has the song playing the selected clip (not Static); it ends itself after 1 s
  without posts; the snapshot's tick is skipped meanwhile. `PianoRoll.tick` redraws the overlay only when the playhead's pixel column
  changes, against the last draw's geometry (`vw`: no `view()` — rows, folds — per frame). Not done (recorded): the ARP pattern
  editor's playhead (`seq[1]`) stays posted (its rate is the arp RATE / TIME, Hz modes: Cut B's fast `seq`); sx-ui-mix's filter display
  (keyed on base values only) untouched.
- **Tests** (failing first): sx-host +3 (the rate class at 120 / 60 Hz and unmeasured, nothing lost / nothing armed at rest, one rAF
  for two changes, a re-measure draws at once; keyN's buffers and element rule; the real WT / filter / spectral-filter canvases declare
  60, the noise / sample displays none, an LFO on cutoff posted at 120 Hz → ≈ 30 redraws in 0.5 s); serum-ui +1 (the bundled panel's
  snapshot paints honour it; a deferred change of a page hidden meanwhile waits for its showing); sx-ui-osc +3 (keyN's numbers, 'off',
  the per-repaint JSON; the 3D cache: no slot copied, the very calls of a fresh view's draw; the response cache: a new tap computes no
  impulse, the same calls as an uncached panel); sx-ui-seq +2 (`clipHeadAt` incl. swing; the ClipPage: heard-time anchors, wrap,
  before / past every anchor, Static, stopped, hidden, the clock client added / dropped / destroyed, an overlay redraw only on a new pixel).
- **Gates**: sx-host 28, serum-ui 63, sx-ui-osc 55, sx-ui-seq 53, canvas-WC-sim 51, canvas-3-sim 25, lint 171, pwa 25 (after
  `precache --write`; sw.js not committed, §10.2) — 0 failures; also rig-ui, sx-ui-mix, canvas-2a / MM-sim, cv-module, m3-fixture,
  accessors, app-shell green. No engine / DSP file touched.
- **Measured** (Chrome for Testing 156 headless, `--use-angle=metal`, 1440 × 900 dpr 2, downloads denied; scratchpad `FR/measure-fr.mjs`:
  a Wavecraft from the rig tile, OSC A "Saw to Square" in 3D, LFO 1 → WT POS, LFOs 2 + 3 → an MG Low 12 cutoff, 128 BPM, a held note;
  8f35d70's three files served beside for the base; a probe clock client stands in for H-A's frameTick; allocations by the sampling heap
  profiler with GC'd objects):

  | scene | base 8f35d70 | M-A |
  |---|---|---|
  | engine posts (29 / s), 60 Hz: WT 3D redraws × cost | 29 / s × 0.81 ms | 29 / s × 0.21 ms |
  | — the filter display | 20 / s × 1.7 ms | 20 / s × 1.9 ms (the impulse: unchanged) |
  | — sx-ui-osc.js allocations | 4.7 MB/s | 1.3 MB/s (1.1 of it filterImpulse's arrays, inlined) |
  | a snapshot per rAF (Cut B's rate), free-running rAF (clock 1000 → E 250) | 304 fps; WT 3D 302 / s, filter 304 / s | 1 700 fps; 63 / s each (the 60 class at E 250: k 4) |
  | — allocations sx-ui-osc / serum-dsp | 56 / 88 MB/s | 5.2 / 18 MB/s |
  | a snapshot per frame, nothing moving (keys only), 60 Hz | 0 draws; sx-ui-osc 49 KB/s (≈ 800 B a frame: strings) | 0 draws; 9 KB/s (≈ 150 B a frame: V8's boxed numbers of the kit's getN) |
  | the CLIP part, a clip playing, 60 Hz | overlay 29 draws / s, a new playhead on 48 % of frames | 60 / s, 100 % (≈ 0.3 KB a frame of boxed numbers) |

  **Pixel parity**: the WT display (3D, 5 WT POS values × densities 1 / 2 / 3) and the filter display (views 0 / 1 / 2 × 2 cutoffs, the
  cached second draw too) byte-identical to 8f35d70's modules drawn in the same page.
- **For the lead** (not this lane's files): (1) **the filter display's impulse allocates ≈ 330 KB a redraw inside serum-dsp.js**
  (`filterImpulse`: a fresh `SFilter` and its tick's boxed numbers, the 4096 output) — ≈ 6.5 MB/s with LFOs on cutoff at today's posts,
  ≤ 20 MB/s at the 60 class with Cut B's data; it needs a DSP-file change (an additive `filterImpulse(…, scratch)` reusing a per-display
  filter and output, bit-identical response) — Cut B's lane E or a fixer, never Cut A. (2) sx-host's snapshot paint allocates ≈ 2.5 KB
  outside the canvases (`paintMods`' `setMod` objects, `updateVoices`' page arrays and text, `checkCapture`) — Cut B's view rework.
  (3) main.js's `drawScope` allocated 1.8 MB/s in the CLIP scene (H-A's row).

### Notes — lane H-A (the host loops; 2026-10-27; base 8f35d70)
- **main.js** (§3 A1): `frame()` is two clock clients — **`stall`** (`every`, essential; added on the module's last line, before
  `boot()`: the page's first client) runs `clockSample` and counts the frame (`frameN`); **`frameTick`** (essential, the global cap;
  added where boot started `frame()`) does the playing work as before, then `headMeters(dt)`, `drawScope()`, `mout.draw(t)`.
  **`heardFrame()`**: one `outFrame()` — one `getOutputTimestamp` — per rAF, shared by frameTick, the modulator lanes (`modLane` called
  `curTick()` per laned body per frame: it reads `heardTickNow()` now) and the hosts; between frames the last frame's value for ≤ 20 ms.
  `sxHost` / `fxHost` / `mfxHost` gain `heardFrame()`, `heardTick()` (the song tick on it), `fps()` (§10.1). **Head meters**: `hmRec`
  (track id → { el, w, clip }) behind `headMeterEl(tid)` — dropped by `renderHeads` (the heads' only builder; `renderAll` calls it;
  `renderNav` builds no head, so it does not drop it), an element with `isConnected === false` looked up again, a miss kept until the
  next `renderHeads`; the fall `0.88^(dt / (1000 / 60))`; the width compared as an integer of 0.1 % and written as before
  (`(w / 10).toFixed(1) + '%'`), `clip` toggled on a flip. **`posUI`** writes each text only when it changed (`posBBT / posTime`; the BBT
  text carries ticks, so both change on nearly every playing frame — recorded). **`drawScope`**: the size from a ResizeObserver on
  `#scope` (0 × 0 = not rendered, in place of `offsetParent`; node: read per frame as before), the spectrum's px → bin table cached per
  width / rate, the labels hoisted; the glow (`shadowBlur 6`) kept — its cost is raster (the GPU process), not the main-thread self time
  `stats().ms` measures (below). `__synthTest.fps = { clock, stats, cap, eff }`.
- **master-ui.js** (§6): `METER_MS / SCOPE_MS / BAR_MS` retired (`TEXT_MS` stays), **`PK_HOLD = 50`** exported. The OUT's `draw(t)`: the
  meters when a summary came (`dirty`) or a true-peak level moved by > 1e-3 dB (`levels(T)`), the scope on every draw while live and
  sounding (the `idle / quiet / live` rule unchanged), the text at 10 Hz; the true peaks as two numbers (`acc0 / acc1`) landed at the
  frame. **[C] refinement — the peak hold**: a peak at or above the level shown holds `PK_HOLD` ms, then falls `TP_REL` dB/s (`fallAt`,
  a pure function of the frame's time — the same at 60 and 240). Without it a steady tone's bar saws 0.8 dB (≈ 2 px at 1×, more zoomed)
  29 times a second between summaries at 120 fps (the falling rule as written repaints every frame and shows exactly that). The row:
  the same ballistics; `run()` on every summary as before, plus a clock client **`master-row`** while live and a bar is above the floor
  or the over glow shows (gone at rest, at `setLive(false)`, at `destroy`). Frame path allocation-free: `tpBar` (zonesFor written out),
  the correlation bar inline, hoisted ticks / labels, `soundIn` at module level, `syncSafe` memoised on (the reading, the switch).
  `state()` gains `tp` (the OUT) / `pk` (the row): the levels at the last frame (G4; the harness).
- **fx-ui.js** (§3 B1b / B1c): the GR and spectrum loops stay `ticker(…, { fps: 30 })` clients (fx-ui :1301 / :1911 hold).
  `grCache()` at every `refresh`: `grList`, `P.grI` (one `fxLayout` of the host state per refresh, none per frame), `P.grW / grH / grT`
  (the only layout / style read). The loop's lazy draws read the caches; an explicit `drawGr` (a band drag, the rack's resize, a zoom end)
  measures again. `P.grSig` is a `Float64Array(10)` — **10 numbers, not §3's 8**: the size (2), MULTIBAND, the 4 slots and the 3 band
  thresholds. The rows are constants (no `forEach`, no arrays per paint). The Ducker's dot: `P.ed.drawOverlay(false, true)` (no layout
  read). The spectrum loop draws only when `host.tap()` is a new array (`specTap`, reset at a toggle).
- **graph.js** (§3 B1a): `animator` → `ticker(el, fn, { fps: Infinity })` (the global rate). `watchSize(ed)`: `observeSize` with a
  cache (`ed.sz`, dropped by the observer's callback, which redraws) and `ed.hid` (a 0 × 0 entry); without an observer the size is read
  per call as before. `drawOverlay(force, live)`: the clock's frames, `draw()` and the rack's GR loop pass `live` (only `isConnected` /
  `hid` checked); an explicit call keeps `unrendered` (the hidden-page test holds). EnvEditor: the key is `phS` (stage) + `phT`
  (round(t · 1e4)); the geometry is the last draw's (`gm` / `geoOf`) — **memoised per draw rather than per `env` identity**: the
  provider builds a new object on every call (sx-ui-mod.js:268), and the dot then sits on the curve as drawn. PathEditor: `phX / phY`.
- **Tests**: master-ui — pins moved by design: :60 (the constants), :176 (the frame-rate rule: ≥ 30, ≤ 125 paints a second at 8 ms
  draws, every summary painted), :597 (a write only when the rounded % moved, after the hold); **also moved, not in §10.4's list**: :155
  "a repaint only for new data" (→ "… or a falling bar"; its feed has silent true peaks), :356 the scope's 30 ms floor (→ once per draw;
  120 paints in a second at 120 fps), :491 the 0 × 0 release (a silent feed: nothing falls); the row's release test reads the 24 dB/s
  after the hold (t 150 for −8.4). New: the hold-then-fall at 60 / 240 fps, a steady tone holds still, the row's clock client. fx-ui
  +2 (the GR tick: no rect / client size / fxLayout / panel list, a numeric signature; the spectrum's new-array rule), graph +2 (the
  playheads at 120 fps with no layout read; the EnvEditor's numeric key and drawn geometry), main +1, **tests/fps-determinism.test.mjs**
  (G4: master-ui + the three overlays on the fake DOM; the head meters and the transport through main-sim with `clock: 'std'`, the
  analysers non-zero only at the shared 60 Hz frames; 60 vs 240 within 1e-6, the fall 0.88^60 a second). **Sim files outside the lane**
  (frameTick is now gated at the display's rate and sim rounds are microseconds apart — §1.6's rule): canvas-sim (the two OUT-scope tests
  ungated), canvas-2a-sim and canvas-R-sim (`frameNow()`: the frames that read the lanes / the roll's heard playhead ungated),
  canvas-1e-sim (U17's fake clock 20 → 13 ms a read: the clock's own two reads a frame pushed the fourth frame past `CV_MOUNT_MAX`; a 12
  ms slice still holds one job).
- **Measured** (scratchpad `ha/measure-ha.mjs`: Chrome for Testing 156 headless, `--use-angle=metal`, 1440 × 900 dpr 2, the engine on, a
  held note; CDP Performance deltas, HeapProfiler sampling; base = 8f35d70). **The traces' allocation**: a double handed to `lineTo`
  is boxed in V8 — the 1 200-point wave was ≈ 29 KB a frame (`drawScope` 1.75 MB/s, master-ui `paintWave` 1.73 MB/s at 60 fps; the
  lead's / M-A's 1.8 MB/s); the wave and spectrum traces of both scopes now go on a **1/16 px grid in integers under `scale(1/16)`**
  (`TRACE_Q`; ≤ 1/32 px off, the line width scaled with it; the grid, the idle line and the labels untouched — the static scenes draw
  as before): a probe in the same Chrome measured 28.9 KB → **0 B** a trace; in the app `drawScope` 1.75 MB/s → 14 KB/s, master-ui
  1.8 MB/s → 77 KB/s. **Per painted frame** (`stats().ms`, the clients' summed self time): the track canvas med **0.1 ms** / p95 0.2 /
  max 0.3 at 60 Hz, the master canvas med 0.2 / p95 0.3 / max 0.4; free-running (`--disable-frame-rate-limit`: the 240 ceiling, `k =
  4`; the page's rAF ≈ 106 / s here) med 0.1 / p95 0.2 / max 0.3 — far inside G7's 2 / 4 ms. Script ms / s at 60 Hz, base → new: track
  18.8 → 13.1, master 19.2 → 17.2 (with the master scope at 60 instead of 30). Net heap flat (+20…40 KB over 4 s). **Left for G7 /
  the lead**: (1) the per-frame **layout** (≈ 55 / s, 4.5–7 ms / s, base and new alike) is the head meters' `width` writes while a
  meter moves — 10 / s with the analysers silenced, 9 / s with no clock client; a `transform: scaleX()` meter (style.css `.hmeter i`,
  outside this lane; the master row already moves by transform) would take it off the layout path. (2) The image mode's 2 048 dots
  (`paintImage`: two doubles each a frame, ≈ 49 KB) keep their exact coordinates (master-ui's image tests pin them to 1e-9). (3)
  wk.js's own `clkTick` / `clkMeasure` allocate ≈ 14 / 8 KB/s (phase 0's file). (4) The scopes' grid lines (≈ 200 B a frame).

### Notes — fixer (review 1; 2026-10-27; base 603c421)
Failing tests first (one commit), then the fixes. Every finding fixed; the reviewer's repros ported into the repo's own test files.
- **P2-1** sx-ui-seq.js `headNow`: nothing heard yet → the earliest later post **by beat** (after a song-loop wrap or a seek back the
  pre-jump anchors' beats lie above the heard beat too: the oldest ring entry, ≈ 0.5 s stale, showed for 1–4 frames). sx-ui-seq +1 (a
  4-beat loop wrap, a seek 40 → 8; the existing "nothing heard yet" pin holds).
- **P3-1** wk.js `clkWatch`: a client added on an element already watched copies its sibling's `vis` (the shared observer never reports an
  unchanged element again — fx-ui's GR ticker restarted on an off-screen rack painted at 30 Hz). wk +1.
- **P3-2** wk.js `clkArm` / `clkTick`: **a token per armed frame** (`CLK.armed`) replaces the generation token — a frame dropped with the
  last client under a no-op cancel (main-sim) is inert: one frame in flight; `clkDrop` and `_reset` clear it. wk +1.
- **P3-3** sx-host.js `rateMs`: `k = ceil(E / maxHz − 1e-9)` — maxHz a ceiling (§11 Q2's "≤ 60"): a 60 class draws 41.25 / s at E 82.5
  (165 Hz at the 120 setting), 36 at 72 (Medium on 144), 48 at 144, 60 at 120, 50 at 100. The clock's per-client caps keep `round` (the
  fx-ui pins). sx-host +1.
  **Lead, after the fixer: `floor`, not `ceil`** — the user's "60 should be the minimum fps" beats Q2's "≤ 60": a 60 class draws at the
  display's multiple nearest 60 from above (82.5 at 82.5 / 165, 72 at 72 / 144, 60 at 120 / 240, every frame at 60–119), never below 60
  a second and never 120 or more (the cost bound: ≤ 2× the 60 flat of Q2, only on 60–119 Hz effective rates). The sx-host test asserts
  gaps in (1/120, 1/60] s. First guess — in the morning list with Q2.
- **P3-4** tests/wk.test.mjs `stream()`: the exact time flushed as `floor(t)` (the old helper differenced rounded integers: a constant
  4 or 17 ms stream); the 240 / 60 cases now see 4 / 5 and 16 / 17 ms deltas. +1 (r1-clock2, asserted): quantised 120 / 144 / 165 / 240
  measured exactly, painted 120 / 144 / 82.5 / 120 a second at the 120 setting (a cap-30 client 30 / 28.8 / 27.5 / 30); a ProMotion
  120 / 60 alternation reads 120 and a 90–120 VRR stream 100, every frame painted.
- **P3-5** main.js `fpsCapBare()`: no world ("Canvas camera unavailable") → main.js sets the clock's ceiling `min(fpsOf(fpsPref()),
  FPS_Q[perfPref()])` in `initWorld` and at each Frame rate / Performance pick (`?fps=` / `?perf=` stay the world's). canvas-P-sim +1 (a
  boot whose toolbar `append` throws).
- **P3-6** wk.js: the self-time ring is `STAT_N = 512` (2 s at 240 = 480 painted frames; 256 held ≈ 1.07 s). wk +1.
- **Docs**: §1.2's long-delta rule reads the code's fixed **250 ms** (`CLK_LONG`); M-A's note marks the `ceil`.
- **The peak hold (lane H-A's `PK_HOLD = 50`), for the release notes**: the master's true-peak bars hold 50 ms before the 24 dB/s fall — a
  visible change; a main-thread stall > 50 ms between summaries dips a steady bar by ≤ ≈ 0.5 dB, then it recovers. Accepted at review 1.
- **Gates** (one file at a time, 2 GB heap): sx-ui-seq 54, wk 111, sx-host 29, sx-ui-osc 55, serum-ui 63, main 48, canvas-sim 24,
  canvas-P-sim 14, cv-world 89, master-ui 48, fx-ui 76, fps-determinism 2, lint 171, pwa 25 (after `precache --write`) — 0 failures;
  also (the frame token under main-sim's no-op cancel, the tickers) graph 53, canvas-1e-sim 24, canvas-2a-sim 26, canvas-R-sim 28,
  cv-cords 49. No engine / DSP file touched (goldens unaffected by construction).

### Notes — lane S: the harness (Sonnet lane, 2026-10-27; base 8f35d70; no app / engine file touched)
- **Built**: `tests/ui-bench-fps.mjs` (the pure part, the page part, the Node driver — one file), `tests/ui-bench-fps.test.mjs` (17 tests, no
  browser: the statistics, the rate classes, `effOf` against the real `wk.clock`, the expect judge incl. the cap from above, the budgets and
  every gate, the CDP delta, the matrix and CLI, the expected-live lists' shape, the summary / bench row / comparison, the hooks installed into
  a fake window, the page wiring), `?fps=1` in `tests/ui-bench.html` (the device page; `run=1` and ui-bench-wc.test's pin untouched),
  `tests/bench.json` **`ui-fps-mac`** (the baseline at 8f35d70, one compact row). lint green; ui-bench-wc / -frame / bench-page tests green.
- **Run it** (Chrome for Testing only — `$CHROME` or `.claude/test-browser` from the repo up —, its own `--user-data-dir` (`--profile <scratchpad>`),
  downloads denied in every context, its own server on a free port, Chrome killed at the end and on Ctrl-C):
  `node --max-old-space-size=2048 tests/ui-bench-fps.mjs --sizes d,l,p --profile <dir> --out cur.json` — the full G7 matrix, **231 cells ≈ 40 min**
  (`--sizes d` ≈ 13 min; one cell ≈ 40 s: `--scenes tutorial --caps 120 --throttle 1 --no-cross`; `--list` counts); `--no-gate` always exits 0
  (the baseline run); `--layout-gate idle|all|none`; **`node tests/ui-bench-fps.mjs --compare bench cur.json`** diffs a later report against
  the `ui-fps-mac` row (cost / layout + style beyond `NOISE`'s margins — see the gaps —, an expected-live display or a gate that passed and now
  fails; exit 1) with no browser. On a device: `tests/ui-bench.html?fps=1` (Run → Copy results; the browser's own frames, caps 60,
  `&caps=120` more; the store's writes off and a fresh project, as ui-bench-m3 / -wc).
- **How the frames are driven** (§9: "exactly … else"): `HeadlessExperimental.*` does not exist under `--headless=new` in CfT 156 (probed:
  "'HeadlessExperimental.beginFrame' wasn't found"), and the §14 phase-0 fallback (`--disable-frame-rate-limit`, gated per painted frame) runs every
  own-rAF loop at 8 kHz (and a page with nothing dirty at 55 Hz), which would make the baseline meaningless. So `installHooks` (injected before the
  page's scripts) **virtualises `requestAnimationFrame`**: a Worker sleeps on `Atomics.wait` and ticks at exactly 1000 / D ms (the server sends
  COOP / COEP: SharedArrayBuffer; tick jitter ±0.45 ms at 240), the page delivers every queued callback stamped with the scheduled vsync, a vsync
  missed because the main thread was busy is dropped as a display drops it. Chrome keeps `--disable-frame-rate-limit --disable-gpu-vsync` so its own
  style / layout / paint follow the page's dirtiness. **The clock measures the virtual display like a real one** (`clock.display()` read 60 / 120 / 240
  in every clock scene), the cap goes in through the app's own path (`W.setFps` when the build has it, else `wk.clock.setCap`: the cell says `via`),
  nothing is faked in wk.js. D = the cap (a display of exactly the cap) plus **two cross cells at 1 ×: a 240 Hz display under the caps 120 and 60**
  (lane K's / H-A's job is that nothing paints above the effective rate; the display = cap cells cannot see a loop that ignores the cap).
- **A cell** (scene × size × throttle × cap; 3.2 s warm so the clock's 1 s hysteresis settles, 4 s measured): per delivered frame **the summed time of
  every rAF callback + the `onmessage` handlers since the previous frame** (`frameCost`: the gate's number — a superset of §9's "clock `stats().ms` +
  handlers", which is also recorded: `clock.ms`, `contract`, `handlers.byType`); frames / s delivered and missed; the clock's `stats()` and client
  names; paints per canvas (`clearRect` / `fillRect` / `drawImage` / `putImageData` hooked, **once per delivered frame**) and `.wk-live` `cx` writes (a
  MutationObserver) judged against the scene's expected-live list; CDP `ScriptDuration` / `LayoutDuration` / `RecalcStyleDuration` / `TaskDuration`
  per second; heap growth after `HeapProfiler.collectGarbage` each side; console errors (page + CDP); the busiest canvases. Each scene runs in a
  **browser context of its own** (a first-run project: the profile's storage persisted the last scene's tracks into the next in a first attempt).
  A cell failing only `frames` (a stalled window — an 800 ms browser task hit the idle scene's last cell twice — or genuine starvation) or
  `layout+style` is measured once more; the second window counts, the first stays as `retry`. The scene's ⚙ popover is opened once per size
  (`gearCheck`: inside the viewport, the Frame rate line — once lane K adds `#cvFps` — inside the popover; its hint text is in the report for the texts
  review), and its clock clients / the fewest rAF callbacks per frame (= the steady loops) are audited across its cells (no leak, no double rAF).
- **Scenes** (all built through the app's own hooks, 128 BPM, playing, a looping chord line; the kick is a TR-808 track that keys the Ducker):
  `idle` (a Minimoog track, engine on) · `play8` (8 tracks, the tray open: 8 head meters + the arrangement playhead + the OUT scope) · `roll8` (the same
  with ROLL open) · **`tutorial`** (a Wavecraft rig: "Saw to Square" under LFO 1 with **the 3D view on**, LFO 2 + 3 on an **MG Low 12** cutoff, ENV 1 on
  LEVEL, Reverb → Ducker (keyed to the kick) → 2 Utilities under LFO 4 / 5) · `serum` (a Serum complete, 4 canvas LFOs + 2 ENVs on its knobs, a
  Compressor in its FX) · `master` (the master canvas: Compressor + Ducker, 2 LFOs, the OUT, a Juno under it) · `busy` (ui-bench-wc's full WC-1 rig +
  6 canvas modulators with 8 rows). **Expected-live lists** (`EXPECT`, data): per scene the canvases / rings that must animate, each with a rate class —
  `eff` (the clock's effective rate: `effOf(display, cap)` = the 25 % rule, tested against the real clock), `snap` (29 Hz: the LFO / ENV playheads, the
  Serum displays, the dots — **unchanged in Cut A**), `gr` (30), `heavy` (= min(60, the data rate): 29 until Cut B, `--` the constant `HZ`) — each
  ≥ 0.8 × its rate (`tol` lowers it for a change-gated writer: the head meters 0.2, the Ducker's GR bar 0.4 — it moves with each kick, 18 Hz); a clock-class
  display on a faster display must also stay ≤ 1.25 × the effective rate (the cross cells). The knob dots are judged by their knob's box (a dot is
  hidden between notes). `busy`'s OUT scope is `min: 0` (the portrait fit leaves it off screen).
- **Gates vs the contract** (deviations stated): frame cost med ≤ 2 / p95 ≤ 4 at 1 × (every cap), med ≤ 8 at 4 × / 60, ≤ 12 at 6 × / 60, **the others
  recorded**; rate / heap / frames gated at 1 × and at the 60 cap; heap ≤ 1 MB / s; no console error; the clock reads the display (±8 %) and its eff
  (±2 %); **layout + style < 1 ms / s is gated on `idle` only** (`--layout-gate all` gates every scene): the playing scenes write the transport text every
  frame (§3 A1's "recorded exception") and sit at 12–19 ms / s, so a gate there could never pass.
- **The baseline at 8f35d70** (`ui-fps-mac`; 231 cells, 0 console errors, 0 aborted, heap ≤ 44 KB / s; 60 cells carry a failed gate — all real):
  frame cost is far inside the budgets (1 × / 240: median ≤ 0.20 ms, p95 ≤ 1.4; 4 × / 60: ≤ 3.4 / 5.1; 6 × / 60: ≤ 7.9 / 9.6, `busy` at the iPad size).
  **What fails is what Cut A is for**: (1) the master OUT scope paints **27–30 Hz at every cap** (`SCOPE_MS` = 30; 21 cells); (2) on a 240 Hz display
  under the caps 120 / 60 the OUT scope paints 240 (tutorial, serum, busy), the arrangement and roll playheads 240, the head meters 100–155 writes / s
  (the own-rAF loops of main.js `frame()` — 24 cross cells); (3) `busy` cannot hold its display under throttle (6 × / 60: d 48 fps, **l 25 fps**; 4 × / 240:
  d 146) — the clock then reads 25–30 Hz; (4) idle layout + style is 0.4–0.9 ms / s at 1440 × 900 but **1.2–2.1 at the iPad sizes** (a 4 Hz text
  update re-lays-out ≈ 0.3 ms each). Playing scenes: layout + style 12–19 ms / s, script 15–46 ms / s (`busy` 46, `tutorial` 40). The ⚙ popover fits at all
  three sizes (383 / 497 / 797 px of room below it; no Frame rate line yet). The clock's clients: 0 (idle / play8 / roll8 — their loops are not on it
  yet), 7 (tutorial), 9 (serum), 3 (master), 11 (busy); rAF callbacks per frame ≥ 1–2.
- **After the lanes merge, expect**: (1) the `master` OUT-scope cells pass (30 → eff) and the cross cells' "above the cap" failures go (every loop on
  the clock: the fewest rAF callbacks per frame also drop — `frame()` and the world's idle loops leave the raw rAF); (2) idle layout + style < 1 at the
  iPad sizes is H-A's target (no `offsetParent` / `clientWidth` per frame; the text writes on change); (3) `play8` / `roll8` get clock clients (the
  clock's eff then enters their cells); (4) the cap-60 / 6 × cells are the Low-preset proof (Medium / Low save main-thread time: compare `busy`'s
  frames); (5) `heavy` stays 29 until Cut B (`HZ.snap`), the Serum CLIP / SEQ playhead (B6) has no scene yet (M-A adds one if it wants a gate).
- **Gaps (stated, not hidden)**: Chrome is not WebKit (the iPad: `?fps=1` on the device, by the user's hand, one pass after the features — CLAUDE.md);
  the virtual display is exact but Chrome's own compositor frames are not locked to it (G9's real 120 Hz window stays reviewer 2's); `gearCheck` finds the
  line by `#cvFps`; no scene exercises a power cycle / hidden tab / preset switch mid-animation (reviewer 2's list) nor the iPad app; the `serum` scene
  uses the complete panel (not the parts); the utilities' knob dots (rows `lfo4 → fx.util.pan`) show no halo in this scene at 8f35d70 (their
  `arcs` stay 0) — they are not in a list. **Noise** (three full runs of 8f35d70): at 1 × a cell's cost median varies by ≤ 0.075 ms (p90; worst 0.23), its p95
  by ≤ 0.4 (0.8), layout + style by ≤ 7.7 ms / s (idle ≤ 1.5, the reason it is retried); **under CPU throttle the median varies ×2–4 between runs** (the
  throttle works in slices: one frame lands in a slice or across it), the p95 ×1.4–2, layout + style up to 80 ms / s — `compareReports` keeps beyond these
  (`NOISE`), the budgets (2 / 4 / 8 / 12 ms) sit far above them; read a throttled cell as a ceiling, not a number. The live verdicts of dots that
  hide between notes were the one flaky family (judged by their knob's box since); the busiest cells (`busy` at 4 × / 6 ×) are borderline on `frames`.
  **Run it with the Mac otherwise quiet**: the same idle cell cost 0.05 ms in the three full runs and 0.21 ms (layout + style 0.4 → 1.5 ms / s) in a
  later single-cell smoke while the user's Activity Monitor was open (GPU / CPU contention reaches the main thread through the canvas flushes) — the
  idle `layout+style` budget (1 ms / s) is within that noise at 1440 × 900 (0.4–0.9 quiet) and over it at the iPad sizes; `--compare` flags such a run
  as a regression, so compare two quiet runs (and a cell that looks wrong once: run it again).

### Notes — fixer (review 2; 2026-10-27; base b9b8912)
Failing tests first (4583b95; then 4fb5f13 and bb80eb1 for what the harness's new clip check found in Chrome), then the fixes. Reviewer 2's repro
(`r2-clip-hold`) ported into tests/sx-ui-seq.test.mjs.
- **P2-1** sx-ui-seq.js — a held clip (RETRIG paused at a seek until its start; a slice at its segment's end): `headSee` marks an anchor a
  **hold** (`hA.h`) when it posts the previous anchor's position at a later beat; `headNow` shows a hold as posted. The reviewer's rule, taken
  at insertion rather than per frame (the predecessor is the true one even after the ring wraps). The first post after a seek cannot
  tell a hold: it is carried for one post interval (≤ 0.3 sixteenth, then one snap back — no sawtooth). sx-ui-seq +1.
- **P3-1** sx-ui-seq.js — **lines** rather than a drop (a drop of the anchors below the jump's beat was the first cut: it fixed the reviewer's
  4.02 but the clip check below found the rest of the family in Chrome). `headSee` marks a **jump posted** — the beat back (a seek back, a
  loop wrap) or forward past 1.5 of the posts' step (a seek on; `st` the last normal step) — a new line from that anchor (`js`; `jo` the old
  line's last audible beat = its last post + a step). `headNow` keeps the **heard line** (`hl`): the heard beat moves to the newest line when it
  jumps too — back below the last frame's, or forward past `jo` — and the search is that line's anchors (the old line until then; nothing
  heard there → the newest line's; nothing at all → every anchor, review 1's rule). So a heard beat on one line never meets the other's
  anchors: not the stale pre-seek one (6.33 → 4.02 → 6.37), not a **short seek's cross-carry** (the target within HEAD_AGE of the heard
  beat, back or on: the old heard beat carried from the new line's first post — 13.81 / 12.00 in Chrome — then snapped back). Two more found
  by the clip check: `headNow` calls `headSee` first (the clock client runs before the snapshot's `live()` in the frame where the heard
  beat jumps: the seek's post was the kit's snapshot but not in the ring yet), and **a heard jump back with no newer line posted holds**
  the playhead where it was until a post comes (the output delay shorter than a post interval: every anchor was the old line's — the oldest
  flashed, 14.05 → 9.59 → 14.06); a heard step back with no jump posted is let go by the next post. Time-free (beats and serials): the sims'
  synthetic ticks work. sx-ui-seq +3 (the P3-1 case, the frame ordering / the late post / a false step back, the short seeks both ways);
  **the B6 case's three ticks moved into time order** (10.1 → 9.9 → 10.925 stepped the heard beat back with no jump: now a heard jump —
  the same three asserts, 9.9 first). Chrome (8 seeks at 120 Hz, phases spread over the 6-beat loop): 0 glitches, each seek's only jump
  the first post's snap back (≤ 0.3 sixteenth, a RETRIG hold the first post cannot tell — reviewer 2's accepted limit).
- **P2-2** main.js `statsText` writes `#cpu` only when its text changed (one write with the "lower oversampling" advice, not two) and the
  figure **holds within 1.5 points** of the one shown (`cpuPct`; a ±1 % jitter across a rounding edge never flips it); cv-module.js `setCpu`
  holds the module bars' figure within 1.5 of its display steps (1 % from 10 % up, 0.1 % below; "<0.1%" counts as 0) — the idle flicker
  "<0.1%" ↔ "0.1%". No CSS containment needed. main +1, cv-module +1. **Idle layout + style** (`tests/ui-bench-fps.mjs --scenes idle --sizes
  d,l,p --throttle 1`, the 1 × cells: caps 60 / 120 / 240 + the two cross cells; ms / s, medians [range]; two runs each, interleaved, same session):

  | size | b9b8912 run 1 | b9b8912 run 2 | review 2 run 1 | review 2 run 2 |
  |---|---|---|---|---|
  | d 1440 × 900 | 1.24 [0.97–1.33] | 1.55 [1.06–1.77] | 0.70 [0.39–0.96] | 0.26 [0.08–0.46] |
  | l 1366 × 1024 | 1.28 [1.26–1.49] | 1.96 [1.18–2.30] | 0.48 [0.12–0.59] | 0.31 [0.17–0.69] |
  | p 1024 × 1366 | 1.84 [1.70–1.95] | 1.62 [1.24–1.72] | 0.30 [0–0.64] | 0.23 [0–0.78] |

  b9b8912: 29 of 30 cells fail the 1 ms / s gate (the 30th failed `frames`); review 2: **30 of 30 pass every gate** (one d cell re-measured, 1.27 →
  0.96). The DOM writes left idle (reviewer 2's mutation probe, 4 s): `.cv-cpu` 0.3 / s and `#cpu` 0.3 / s (were 0.8 / s + `#cpu`'s 4 unchanged
  writes a second), 1–2 layouts per 4 s.
- **P3-2** sx-host.js — a frame's paint is timed by its **rAF timestamp** (`paint(full, ts)` / `paintCanvases(ts)` / `paintCanvas(cv, ts)` from
  the snapshot's, the queue's and `paintLater`'s frames); a synchronous paint (an edit) keeps `o.now` / `performance.now()`. A snapshot per frame
  on a 60 Hz display: 60 draws a second whatever the callback's place in its frame (the test's jitter gave 60 of 120 frames before). sx-host +1.
  **A test's setup moved by design**: the heavy-displays test's clock starts at 1e6 (`flush` stamps frames with the stub DOM's event counter,
  ≈ 1 000 up — two time bases; one, as in a browser).
- **P3-3** main.js — the drum and 900 lamp pumps' `heard` reads the frame's shared `heardFrame()` (a press's `ts`: its own `outFrame(ts)`): one
  `getOutputTimestamp` a frame with the playhead (2 before). canvas-7a-sim +1, canvas-9b-sim +1. **Not made clock clients — for Cut B**: a
  pump gated at the cap would skip frames in every sim boot without an audio clock (rounds microseconds apart, §1.6: canvas-9b / -7b / -1i /
  -R would need the gate off around their lamp checks, as canvas-sim's OUT-scope tests); the change is cv-drum's / cv-patch's `raf` default →
  an essential, element-less client while posts are queued (it then also runs after `stall`, so its heard frame is always the frame's).
- **P3-4** main.js `drawScope` — master-ui's idle rule: silence (no source; every drawn sample within 1e-9; every drawn bin at the −130 dB
  floor) draws the still picture once, then nothing until there is signal or the picture would differ (canvas, size, store, source, mode); the
  scope not live forgets it. The analyser is still read every frame (to see the signal come). canvas-sim +1; **the fix-scope test's `look()`
  moved by design** (its calls cleared before the switch: a silent scope draws its flat line once, at the switch).
- **P3-6 harness**: (a) `evalExpect` judges liveness at min(eff, `ctx.delivered`) — the driver and the device page pass the frames delivered;
  from above still 1.25 × eff. (b) **a `clip` scene** (reviewer 2's `clipSetup`: a Wavecraft rig's CLIP part, a 16-sixteenth clip launched, the
  song looped over 6 beats, 128 BPM) with `EXPECT.clip` = the roll's overlay, `eff` with a new **`max`** field (120 Hz: the overlay moves a pixel
  column ≈ 137 times a second, measured at 240 Hz; the columns are layout px, any viewport), and the driver's **'clip playhead'** check
  (`clipCheck`: `ClipPage.headNow()` sampled every frame for 6 s at a 120 Hz display, a seek back to beat 1 at 2.5 s → the pure `clipJumps`: no
  glitch — a jump and another within 8 frames —, moved on ≥ 50 % of the steps). SCENE_IDS 8 (the default matrix 88 cells a size); +76 / −7 lines.
  Measured (`--scenes clip --sizes d,l,p --throttle 1`, the final code): all 15 cells pass every gate; the overlay paints 60 / 119 / 137 a second
  at 60 / 120 / 240 and 119 / 60 in the cross cells; the check at d / l / p: 721 frames, 4–5 lone jumps (wraps, the seek's snap, the clip's
  restart), **0 glitches**, moved on 77 %. (Before the line fix the same run found 2 glitches at every size — the P3-1 bullet's cases.) (d) a
  comment at `rateOf('heavy')` for Cut B: the 60 class paints E / floor(E / 60) a second once the data outruns it.
- **Found, not fixed (for the lead)**: the clip scene's **'build errors' check fails** — "ResizeObserver loop completed with undelivered
  notifications" as the CLIP part mounts, **also at b9b8912**. Probed (an RO wrapper sizing every observed element around each callback):
  LaneView's first ResizeObserver callback (sx-ui-seq.js:1216 → `refresh()`, which sets the lane canvas / automation box `display` and the tab
  labels) shrinks the CLIP module (`div.cv-mod` 687 → 669 screen px), whose own observer (cv-module.js:697) was delivered in the same round. A
  first `refresh()` at the LaneView's build (or those styles set there) should end it; outside this fix's scope.
- **Left as they are (noted)**: **P3-5** reduced motion keeps the essential OUT scope and meters at the cap (frameTick is `essential` by §3 A1:
  information, not decoration); **P3-7** the ⚙ select shows the stored "120" greyed on a 60 Hz display (the setting kept for a faster display;
  the hint says what is drawn) — both in the morning list's spirit, no change.
- **Gates** (one file at a time, 2 GB heap): sx-ui-seq 58, sx-host 30, sx-ui-osc 55, serum-ui 63, main 49, master-ui 48, canvas-sim 25, canvas-P-sim 14,
  cv-world 89, cv-drum 66, canvas-7a-sim 24, canvas-9b-sim 15, cv-module 80, wk 111, fx-ui 76, ui-bench-fps 19, lint 171, pwa 25 (after `precache
  --write`: sw.js BUILD b712832483e8); also fps-determinism 2, graph 53, canvas-2a-sim 26, canvas-R-sim 28, canvas-1e-sim 24, canvas-1i-sim 20,
  canvas-7b-sim 15, cv-patch 31, safeguard-sim 10, canvas-3-sim 25, canvas-WC-sim 51, sx-ui-mix 17, ui-bench-wc 5, bench-page 2 — 0 failures. No
  engine / DSP file touched (goldens unaffected by construction).

### Notes — lead: G9 on the real 120 Hz screen, the release (2026-10-27)
- **G9 passed** (headed Chrome for Testing on the Mac's built-in 120 Hz XDR panel, the window focused, AC power; probe
  scratchpad `FR-R2/check-hist.mjs`): an idle page's rAF falls 120 → 60 → 30 after ~2 s (macOS / Chrome power saving, not the
  app); any motion brings 120 back within one 0.5 s window; the clock reads 120, 60 while idle, and 120 again ~1.5 s after motion
  resumes (the 1 s hysteresis — k = 1 meanwhile, so every delivered frame still paints: nothing visible is lost).
- **Known, not fixed (predates FR)**: mounting the CLIP part logs "ResizeObserver loop completed with undelivered notifications"
  (LaneView's first RO callback, sx-ui-seq.js ~:1216, `refresh()` shrinks the module 687 → 669 px in the same delivery) — the
  harness's `clip` scene fails its build-errors check on it; a first `refresh()` at LaneView's build is the likely fix (later).
- **Heavy displays: `floor`** (lead, after review 1's P3-3) — §14 P3-3 above; G7's `heavy` class stays min(60, 29) until Cut B.
