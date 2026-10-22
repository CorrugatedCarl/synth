# Stage P: performance presets Low / Medium / High, and no artificial caps (IMPL-P) — contract

ROADMAP row 14. **Scope (the user's decisions, 2026-10-22, relayed by the lead — settled, not re-asked)**:
- "we want this app to be viable on less powerful tablets so my ipad pro shouldnt be considered the floor"; three presets in Settings,
  **High** = today (designed on the iPad Pro), **Low** for slower Android tablets, **Medium** between.
- "**performance settings should only affect the cord physics and panel texture**"; "**the only performance settings we should be
  changing should be visual**" — a preset changes (1) the patch cords' physics and (2) the GL panel faces' texture resolution, and
  nothing else. Other purely visual levers may be *proposed* (§9), never in the default plan.
- "**the user should be able to change the oversampling just like we have now — so don't change that**": the ⚙ Oversampling select
  and everything audible stay exactly as they are, at every preset.
- "**users should be able to add racks until their system lags**" / "thats up to them": no artificial caps on user-built content —
  only safety bounds against corrupt / hostile files and runaway memory (§3). The heavy-scene notices stay, as hints only.
- Standing: no slower test device — the floor is simulated (headless Chrome, CPU throttling 4–6×, a texture budget, a forced
  `MAX_TEXTURE_SIZE`) until one real-device pass after the features (no per-stage iPad sessions); native pinch only; never move layout
  for browser chrome; canvas only (synth.domlavin.com obsolete).

Cited as I9b §n ([IMPL-9b.md](IMPL-9b.md)), I9 §n ([IMPL-9.md](IMPL-9.md)), I1h §n ([IMPL-1h.md](IMPL-1h.md)). **Code references
are to `canvas` at 9dde7e6** (stage 9b's squashed commit). Tags: **[R]** a fact (file:line, a bench record, a cited page), **[R?]**
secondary / unconfirmed (the lane pins it), **[C]** a choice made here (a builder may refine a [C] with a reason in §12, never an [R]).

**Invariants**
- **D1 Visual only.** A preset never reaches the audio thread: no worklet message, payload or processor option depends on it. The
  posted message stream is identical at every preset (`canonical-stream` and the host sims run per preset); **every frozen golden**
  (golden-classic / -fx / -presets / -random / -graph, canonical-stream, golden-drums / -606 / -909 / -sdsv, golden-moog, golden-moog-b)
  **is untouched by construction**; no new frozen refs; no export / bounce question (a bounce is what it is today).
- **D2 Audio quality is the user's.** The ⚙ Oversampling select (index.html:149–154; `settings.os`, main.js:109; its handler
  main.js:8044–8049) and the DSP-load safeguard (`statsText` → `lowerOS`, main.js:1240–1257, 1301–1333 — which today also persists a
  halved `settings.os`, main.js:1315) are **unchanged** — not touched, not re-labelled, not tied to a preset.
- **D3 High = today**, step for step and texel for texel: cv-cords' Studio physics = the cord lab's (cv-cords.js:28–36), cv-face's
  policy at the device's own ratio (cv-face.js:19–62); every existing cv-cords / cv-face / ui-bench expectation holds at High.
- **D4 No artificial caps** (§3): user-built content is bounded only by safety bounds ≥ an order of magnitude above anything built
  today; below them nothing is refused or greyed; the heavy notices never block.
- **D5 Per device.** The preset lives in the device's prefs, never in a project or its History.
- **D6 Lifting a bound changes no existing project**: a project inside today's bounds reads, posts and renders byte for byte as at
  9dde7e6 (payloads, warm-up, goldens).

---------------------------------------------------------------------------------------------------------------------------------

## 0. What exists (read at 9dde7e6)

| piece | where | P |
|---|---|---|
| Face textures: base level `L0 = min(dpr, BASE_L_MAX 3)` (≤ 16 M px, ≤ `TEX_MAX_DIM` a side), mipmapped; windows above `WIN_K0` 0.5 at ≤ `dpr·K_MAX`, ≤ `dpr·WIN_HEAD·k`, ≤ √(`WIN_BUDGET_PX` 40e6 / Σarea), only when ≥ `WIN_GAIN` 1.5 × the base; `FACE_BUDGET_BYTES` 384e6 (off-screen windows, then bases evicted; on-screen never) | cv-face.js:19–35, 48–62, 395–406 | the preset caps the density cv-face works at (§1.1) |
| `dprOf(F)` = the live `devicePixelRatio`, read by `run` / `plan` / `stats` | cv-face.js:169, 364, 417 | → the preset's effective ratio |
| A base is made only when missing (`needBase`, plan's `!F.base`); `run` replaces a base **after** the new upload (`free` then assign) | cv-face.js:307–311, 361, 386, 418 | a stale-level base re-rasters (old texture kept until the new lands) |
| No re-raster on a device-ratio change: cv-world's `watchDpr` resizes the grid only | cv-world.js:609–619 | fixed in passing (a stale level is a stale level) |
| `TEX_MAX_DIM = 8192` hard-coded ("the smallest MAX_TEXTURE_SIZE the site meets"); `gl.MAX_TEXTURE_SIZE` never read; `upload` catches exceptions only — a too-big `texImage2D` is a GL error, not a throw | cv-face.js:27, 31, 51, 61; cv-gl.js:196–212 | **[R] web3dsurvey: ≈ 25 % of Android WebGL2 devices report 4096** ([MAX_TEXTURE_SIZE](https://web3dsurvey.com/webgl2/parameters/MAX_TEXTURE_SIZE): Android ≥ 8192 75 %, ≥ 16384 3 %); at dpr 2 the CS-80 (4864), Jupiter-8 (4288) and Juno-60 (4288) bases are wider (I1h §8 "Measured") → an incomplete texture (samples black, [R?] WebGL's rule) on those devices today. Fixed at every preset (§1.1) |
| The adaptive window cap `synth.cv.winpx` (raw localStorage; halves to 4e6 on a paint > 30 ms; the iPad Pro sits at 4e6: a window paint 79 ms) | cv-face.js:31, 154–162; I1h §8 (iPad verdict) | its start / floor scale with the preset |
| Cords: `STUDIO` N 10 points, SUB 4 (34 drawn points, `PTS`), DT 1/120, PASSES 5, BUDGET 160; `advance` / `step` pure; `motion()` = mode gl / under and not `reduced()`; motion off = the settled parabola (`shown`) on every draw, no ticker; `reduced` is injectable (`o.reduced`) but cv-world passes none (matchMedia) | cv-cords.js:35–36, 101–137, 139, 233, 265–269, 284, 424, 640–645; cv-world.js:680–690 | the preset sets the layer's quality (§1.2) |
| Prefs: `store.get/set('synth.…')` → IndexedDB kv `synthc.…` (appstore.js:97–98); `synth.cv.gl` / `synth.cv.cords` / `synth.cv.winpx` are read raw from localStorage | main.js:100, 109; cv-world.js:527–535, 673–679; cv-face.js:154–162 | the preset goes through `store` (main.js) and setters — no new raw key |
| ⚙ Settings: `#gearPop` (Engine: master, sample rate, **Oversampling**, drift · Recording · Canvas: pinch) + lines appended at init (Load estimates / Measure this device, New Serums open as) | index.html:133–163; main.js:5103–5124 | a **Performance** line in the Canvas section (§2) |
| Device signals today: `touchDev` (coarse pointer or touch points), `isIOS()` (iPadOS-as-Mac included), pwa.js `platform()` (Android by UA); **no** `hardwareConcurrency` / `deviceMemory` use in the app | main.js:807, 886; pwa.js:24–30 | Auto (§2.2) |
| Heavy notices (touch only, once a session, never blocking): `SX_HEAVY` 1 866, `PT_HEAVY` 2 048 painted elements | main.js:6333, 6345, 6352–6379 | thresholds per preset (§1.4) |
| Measured UI costs (dpr 2): System 55 faces 69.3–72.6 MB, Model 15 20.4, m30 47.7, hw5 171.7; peak in a 30 s zoom run 138.2 (s55) / 92.1 (m30); cords awake 40: iPad Pro step 0.18–0.2 ms + draw 0.05 ms a frame; Mac at 6× CPU: step 0.73–0.83, cord frame med 1.1–1.2 / max 2.1–3.3 ms; s55 / s55w at 4× P+, at 6× P; s55c cold (38 faces through the raster queue) 1 280 / 1 406 / 1 532 ms, paints 19.2 / 80.6 / 111.6 ms (1× / 4× / 6×) | bench.json `ui-m9` (iPad), `ui-m9-mac`, `ui-m9b-mac` (incl. `throttle4` / `throttle6`); I9b §12 lane P9b | the baselines of §4 |

---------------------------------------------------------------------------------------------------------------------------------

## 1. The presets

### 1.1 Panel textures (cv-face) [C; the brief's "dpr cap 2 / 1.5 / 1"]

One number per preset, the **texture ratio cap** `R`: cv-face runs its whole policy (base, windows, the 1:1 checks of `plan`, `stats`)
at the **effective ratio `dE = min(dpr, R)`** instead of the screen's (`dprOf`). The rest follows from today's rules.

| | **High** (today) | **Medium** | **Low** |
|---|---|---|---|
| `R` (dE at dpr 2 / 1.5 / 1) | 3 (2 / 1.5 / 1) | 1.5 (1.5 / 1.5 / 1) | 1 (1 / 1 / 1) |
| base ≥ 1:1 to zoom (dpr 2) | 100 % | 75 % | 50 % |
| windows (above k 0.5, the visible part) | as today | on: level ≤ dE·K_MAX; budget 22.5e6 px (= 40e6 · (1.5/2)²); start cap 9e6, floor 2.25e6 | **none** (§10 Q3) |
| `FACE_BUDGET` | 384 MB | 216 MB | 96 MB |
| System 55 at rest (dpr 2) | 69–73 MB [R] | ≈ 39–41 MB (× 0.5625) | ≈ 17–18 MB (× 0.25) |
| 30 s zoom 25–200 % peak, System 55 | 138 MB [R] | ≤ ≈ 80 MB | ≈ 18 MB (no windows) |
| hw5 (five hardware panels) | 171.7 MB [R] | ≈ 97 MB | ≈ 43 MB |
| raster work (paint ms ∝ texels) | s55c 111.6 ms at 6× [R] | ≈ × 0.56 | ≈ × 0.25 (≈ 28 ms) |

(The ratios are exact up to integer rounding: base bytes ∝ L²; `BASE_MAX_PX` binds only above level 2 for the biggest faces, I1h §8.
On a dpr-1.5 tablet High and Medium coincide for bases; Low still saves × 0.44.)

**Also, at every preset (a correctness fix, visual only)**: cv-gl reads `gl.getParameter(gl.MAX_TEXTURE_SIZE)` once (`GL.maxTex`);
cv-face's side limit becomes `min(TEX_MAX_DIM, GL.maxTex)` (the level drops to fit, as it does at 8192 today); `upload` checks
`gl.getError()` after `texImage2D` / `generateMipmap` and returns null on an error (→ `fail(F)` → the 1g tier, the path that exists).
On the iPad (16384) and the Mac nothing changes (still 8192).

**Applied live** (`FACES.setPerf(id)`): windows freed or re-planned; the budget lowered (enforce evicts off-screen faces first, as
today); `plan` queues a base job for every mounted face whose `F.base.L` ≠ `baseLevel(dE, w, h)` (a **stale level**), nearest the
viewport centre first, one job a frame, never in a burst; `run` accepts a stale base (today's guard, cv-face.js:361, refuses any
present base); the old texture is drawn until the new one is uploaded and swapped (cv-face.js:386 already frees after) — **no SVG
flash, no blank face** (I9b fixer R2a's invariant: no `gl` face with a visible SVG). Peak memory during a switch = the new budget +
one face. A device-ratio change takes the same path (a bonus: today a face keeps the ratio it was made at).

**Visual cost** (the user's choice — written for §10's "things you will notice"): the 1h rule "never below 1:1" (I1h G2, the user's
2026-10-19 line) holds at **High** only. Medium: panels as sharp as High up to 75 % on a Retina-class screen, a little softer closer
in, sharpened at rest by windows. Low: panels at standard (1×) resolution — on a dpr-2 screen at 100 % like a non-Retina screen, softer
still when zoomed in, never re-sharpened. Unchanged at every preset: the 1g tier (`faceTier`, sized to the zoom, cv-panel.js:1386–1491),
the grid, the DOM controls, the cord layer's buffer.

### 1.2 Cord physics (cv-cords) [C]

| | **High** (today) | **Medium** | **Low** |
|---|---|---|---|
| model | Studio: N 10, SUB 4 (34 drawn points), DT 1/120, PASSES 5, BUDGET 160 | **Studio at 6 points**: N 6, SUB 3 (14 drawn points); slack / wobble / weight / stiffness / DT / sleep rules unchanged (the lab's own "Points per cord" trade, docs/canvas/ref/cord-lab.html:105) | **still**: the settled parabola (`shown`), no simulation, no ticker — today's reduced-motion path (cv-cords.js:23, 284, 424) |
| physics per frame, 40 cords awake (node, M4, `advance` only; scratch `P/cordbench.mjs`) | 0.068 ms | 0.035 ms (× 0.51) | 0 |
| … 128 / 512 awake | 0.107 / 0.42 ms | 0.056 / 0.22 ms | 0 |
| smoothing per frame, 512 cords | 0.021 ms | 0.009 ms | (still: re-pathed only when ends or camera move) |
| in the app (40 awake) | iPad Pro step 0.18–0.2 + draw 0.05 ms; Mac 6× step 0.73–0.83, frame ≤ 3.3 ms [R] | ≈ half the step, ≈ 0.4 × the strip build / upload | step 0, no frames asked at rest |

`BUDGET` binds only below `BUDGET / awake` ≥ 1 step a rope (cv-cords.js:119), so past ≈ 80 awake ropes every one still takes a step a
frame — the cost is linear in awake cords, which only a module drag (its own cords) or a sway after it wakes. With no cord cap (§3) a
big rack's drag stays bounded by the cords on that module.

**Applied live** (`cords.setPerf(id)` through `world.setPerf`): every cord's rope rebuilt at the preset's N and **re-seeded asleep from
its parabola** (cv-cords.js:57–67: `seed`, asleep) — so a switch never shows a jump from a stale rope; `PTS` and the strip / plug buffers
become per-layer (`N`, `SUB` from the quality, not module constants: cv-cords.js:51, 233, 334, 429–430, 515, 542–543, `pointAt` 670–671); still
→ `running = false`. Prefers-reduced-motion forces still at every preset (as today). Modes (gl / under / svg) unchanged.

### 1.3 What the presets do not change (said plainly)

The DOM (painted elements — the stutter driver measured on WebKit, S0 `ui-m3`, I9 §0), the audio (D1, D2), the grid shader, meters,
scopes, lamps, halos, animations. A slow tablet's remaining costs are §9's optional proposals and §11's known limits.

### 1.4 Heavy notices per preset (hints only) [C, provisional until the real-device pass]

`SX_HEAVY` / `PT_HEAVY` × **1 / 0.75 / 0.5** (High / Medium / Low): a slower device stutters at fewer painted elements and the hint
should come earlier; the count, the once-a-session rule, the touch-only rule and the texts are unchanged; never a refusal.

---------------------------------------------------------------------------------------------------------------------------------

## 2. The preset model

### 2.1 Storage and application [C]
- **Per device**: `store` key `synth.cv.perf` (→ `synthc.cv.perf`) = `'auto' | 'high' | 'medium' | 'low'`; absent = `'auto'`. Not in
  the project, no History step, no schema field.
- **Applied live, no reload**: main.js resolves the preset at boot (before the canvas builds: `store.get` is synchronous) and on every
  change → `cvW().setPerf(id)` → `FACES.setPerf(id)` + the cords layer. Nothing is posted to any worklet (D1: a test compares the port
  logs).
- `?perf=high|medium|low` overrides for the session (tests, ui-bench, reviewers; never stored).
- `world.glStats()` gains `perf`, `dE`, `faceBudget`; `cords.stats()` gains `quality`.

### 2.2 Auto (the first-run suggestion) [C; §10 Q1]
Pure function `autoPerf({ ua, platform, maxTouchPoints, coarse, deviceMemory, cores, maxTex })` (exported from cv-world.js so node
tests it), resolved **at each start** (the label shows the pick: "Auto (Low)"). Signals cost nothing (no benchmark):

| class | rule |
|---|---|
| Apple (iPadOS incl. its Mac UA, macOS) — `isIOS()` / pwa `platform()` | **High** |
| Android | **Medium** when `deviceMemory ≥ 8` and `cores ≥ 8`, else **Low** |
| other touch device with `deviceMemory` | ≥ 8 High · 4 Medium · ≤ 2 Low |
| desktop (fine pointer), or no signal | **High** (touch without signal: Medium) |
| then | one step lower (floor Low) when `maxTex < 8192` or `cores ≤ 4` |

Why no micro-benchmark: the presets are visual; "Measure this device" (cv-cost.js:440–455) times DSP (the wrong thing), and a first-run
GPU probe is dominated by shader compiles, cold JIT and thermal state. Reliability [R]: `navigator.deviceMemory` is Chromium-only,
secure-context, a power of two clamped by the browser ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory));
Safari / iPadOS report none (the Apple row decides there). Android errs low on purpose: GPU memory is what fails hardest there (a lost
context → cv-world's 2D fallback, cv-world.js:554–568) and a preset is one tap to raise.

### 2.3 Settings UI [C; §10 Q2]
⚙ → Canvas: a `label.field` **Performance** `select#perf` — `Auto (Low)` · `High` · `Medium` · `Low` — appended in main.js beside the
existing lines (main.js:5103–5124), with its title / one hint line: "Visual only — the sound never changes. Lower: softer panels up
close, cords hang still." Keyboard: the select's own. Not in the top bar.

---------------------------------------------------------------------------------------------------------------------------------

## 3. No artificial caps

### 3.1 The inventory [R: where; C: the new bound]

| cap | where | kind | today | **P** | why the bound |
|---|---|---|---|---|---|
| modules a 900 Series patch | patch-core.js:47 (`MAX_MODS`), enforced :130, :326, :437 / :442; tray greys main.js:6973; set tiles main.js:6974 + cv-tray.js:377–380; `setNeeds` patch-core.js:496 | guard (I9b Q3 "keep 48", superseded) | 48 | **512** | ≈ 14 × a System 55 (37); bounds a hostile file's parse / `graph()` / DOM |
| cords a patch | patch-core.js:47 (`MAX_CORDS`), :144, :276 | guard (cv-cords' buffers grow ×1.5, cv-cords.js:26) | 128 | **4096** | the one-plug rule caps cords at jacks / 2 anyway |
| connections (cords + bus rows) | patch-core.js:535 (`MAX_CONN`), :554, :580 | guard = the evaluator's | 256 | **8192** | = the evaluator's new guard |
| evaluator payload | patch-dsp.js:87 (`MAXM` 64, `MAXC` 256), checked :184, :209 | guard (no buffer sized by them) | 64 / 256 | **1024 / 8192** | ≥ the core's bounds, as today (64 ≥ 49) |
| module / cord numbers | patch-core.js:47 (`MAX_NID` 4096, `MAX_CID` 65535), :61 (`MID_RE` 4 digits, `CID_RE` 5) — never reused (`nextId`, :316–321) | guard | 4096 / 65535 | **1e6 / 1e6** (6 digits each) | a big rack rebuilt for years never runs out |
| devices a track (instrument, panel, OUT, every modulator module) | song.js:558 (`normDev`) — **no add path checks it** (cv-model.js:391–402 `addModDev`): a 65th device is dropped **silently at the next load or undo** (normDev reads History snapshots too, song.js:574) [R?: lane B proves it with the failing test first] | guard, and a latent data-loss bug | 64 | **1024**, and every add refused at the bound with a message (never a silent drop) | |
| wires / mod rows a track | song.js:588 / :651 | guard | 256 / 256 | **4096 / 4096** | |
| layout entries a track (a patch's modules are `<dev>/<mid>` keys) | song.js:521 (`LAY_MAX`) | guard | 256 | **4096** | ≥ 512 modules + 1024 devices + Serum parts |
| Pads modules a project | pads-core.js:26 (`MAX_MODS` 8), :57 (`PAD_ID` `pd[1-8]`), :349–375; cv-model.js:468–469; main.js:7225, 7289–7293; `pd[1-8]` also cv-cables.js:82, 117, pads-core.js:382, cv-mods.js:503 | guard | 8 | **64** (`pd1…pd64`) | a mod pad past the value table's 24 is "left" with its reason (real, below) |
| instruments / panels a track | engine.js:3472 (`MAX_I` 8, `MAX_C` 16: sized arrays), cv-graph.js:144 | real; **unreachable** (one instrument per track since 1f) | 8 / 16 | unchanged | |
| effects a rack | fx-core.js:554–555 (48, 16 top, 8 a branch); sx-mod.js:122 `MAXFX = 8 + 48·24` (the shared Serum modulation engine's arrays) | real (audio-thread shapes) | 48 | unchanged (D1: no audio code) | already ≫ a typical rack |
| ModCore per track: 10 LFO, 4 ENV, 2 chaos, 8 macros, 16 values, 16 ext, 64 rows; a Serum's matrix 64 | cv-graph.js:128–129; sx-mod.js:122–123; cv-modlayer.js:31 | real (Serum's shapes, shared) | — | unchanged; extra modules exist and say "left" | a second bank = audio work (§11) |
| Serum: 3 OSC / SUB / NOISE / 2 FILTER, POLY ≤ 32, unison ≤ 16 | main.js:6383–6386 (`sxFullWhy`); serum-core.js | the instrument's design | — | unchanged | not content caps |
| drum samples 32 / 64 MiB a machine; asset / undo budgets | main.js:3670; assets.js:141–152; sx-host.js:179 | memory guards (iOS worklet kills) | — | unchanged | runaway memory |
| tracks; bars | none; song.js:26 (9 999) | — | — | unchanged | |
| touch soft caps (4th instrument, 2nd heavy Serum) | cv-cost.js:245–260 | hooks only since 1f (main.js:5828–5836, `__synthTest.cv.add`) | — | unchanged (unreachable) | |

### 3.2 Knock-on effects
- **Warm-up (D6)**: engine.js:3811 and :3863 split the warm graphs by `PD.MAXC` — lifted, the warm-up would merge into one graph and
  change its JIT shapes (I9b lane E9b's choices 1–3). **Pinned**: `const WARM_C = 256` in engine.js, used at both sites; the warm
  payload list stays byte-identical (a hash in engine-track; its "every payload within MAXC" check, tests/engine-track.test.mjs:2232–2237,
  reads `WARM_C`).
- **Evaluator / engine**: only two guard constants change in patch-dsp.js; no allocation is sized by them (patch-dsp.js:86–87, 396,
  410). `graph()` runs on the audio thread at every plug: ≈ 0.05–0.15 ms median, max 0.2–0.9 ms at 38 modules, ≈ 0.28 MB allocated a
  call (I9b spike a2) — expect ≈ linear: ≈ 13 × at 512 modules. Measured at 128 / 256 / 512 (V8, JSC) and **recorded, not gated**:
  a plug in a very large patch may click on any device — the user's "until their system lags" (§11).
- **Host paths at size** (recorded, not gated): `freeSlot` scans ≤ 64 lines × W / 32 × modules (patch-core.js:759–772; ≈ 3 M rect tests
  at 512), `ordinal` per title is O(n) (:774–779), the drag's jack marking O(jacks), History snapshots copy the record. Lane B
  times each at 512; anything over 50 ms on the Mac is reported in §12 for the lead.
- **File format**: **SCHEMA 12 → 13** with an identity step (cv-migrate.js:102, STEPS; the documented rule: a stage that changes what a
  saved field may hold bumps it, cv-migrate.js:4–5) — a stage-9b build then opens a 13 project **read-only** (cv-migrate.js:151)
  instead of truncating a 49-module patch or a 65th device on its next save. Additive: every 12 project reads unchanged.
- **The tray**: no greyed Moog module tile, set tile or Controllers tile below the bound; at the bound the existing texts with the
  new number (main.js:6973–6974, 7289; cv-tray.js:377 `setFull`'s default from `PT.MAX_MODS`).
- **Tidy / camera**: `rackLayout` wraps upward past `rackWide` 2 816 (patch-core.js:724–754) — 512 small modules ≈ 25 lines; the
  top-anchored camera (I9b §4.4) frames the top; Fit stops at K_MIN 0.25 (cv-world.js:67); the minimap reaches the rest. Accepted.
- **DOM / GL at size**: ≈ 40 painted a module → ≈ 20 k at 512 (cv-world's `BUDGET_EL` 9 000 is a console warning only,
  cv-world.js:86, 973–976); faces past the preset's budget are evicted off screen (cv-face.js:395–406) — designed behaviour.
- **Goldens**: no existing payload, record or message changes (D6) → bit-identical; golden-moog / -b run as part of lane B's gate.

---------------------------------------------------------------------------------------------------------------------------------

## 4. Budgets and gates (UI; the audio rows need none)

**Audio bench rows** (node / jsc / ipad, bench.json `targets`): **unchanged at every preset by construction** (D1) — no new rows, no
per-preset targets. **New record** `"ui-P-mac"` (reviewer 2).

**How Low is simulated** (reviewer 2, headless Chrome 155 by CDP as I9b's `ui-m9b-mac`: `--headless=new --use-angle=metal`,
1440 × 900 and 1366 × 1024 touch): `Emulation.setCPUThrottlingRate` 4 and 6; `--force-device-scale-factor` **2 and 1.5** (common Android
tablet ratios); `&perf=…`; **`&texmax=4096`** (a test switch: cv-gl reports 4096 as `maxTex`, the 25 % Android case); the preset's
`FACE_BUDGET` asserted from `glStats()`; optionally `--force-gpu-mem-available-mb=512` ([R?] a Chromium switch that limits tile memory,
[gpu_switches.cc](https://chromium.googlesource.com/chromium/src/+/47cd4f581fdc93cbca03bc94de084cd418c8c59e/gpu/command_buffer/service/gpu_switches.cc)).
Scenes: `tests/ui-bench.html?m9=1&s55=1` (`s55`, `s55w`, `s55c`, `m30`, `hw5`) with `&perf=` passed into the app frame.

| gate | High | Medium | Low |
|---|---|---|---|
| G1 today | ui-m9b-mac's verdicts and MB ± 2 %; every cv-face / cv-cords test unchanged | — | — |
| G2 face MB (`faceBytes`) | ≤ 384 MB always | ≤ 216 always; s55 at rest ≤ 0.6 × High's (dpr 2) | ≤ 96 always; s55 at rest ≤ 0.27 × High's; 30 s zoom peak ≤ 0.3 × High's |
| G3 `&texmax=4096` | every face a complete texture (the wide four at a lower level) | same | same |
| G4 frames (frames only, the CDP stamp excluded as in ui-m9b-mac) | no worse than ui-m9b-mac | s55 / s55w / m30 P+ at 4× | P+ at 4×, ≥ P at 6×, and no worse than High in the same run |
| G5 cords (s55w, all 40 plucked) | as today | `stepMs` ≤ 0.6 × High's in the same run | 0 rope-steps; no rAF requested at rest after a module drag; a dragged module's cords follow its plugs |
| G6 cold s55c | as today | — | `paintMs` ≤ 0.35 × High's in the same run |
| G7 live switch on a System 55 (High → Low → Medium → High) | at no frame a `gl` face with a visible SVG; every face at the new level within its queue; no worklet message (port log equal); no History step; the autosave not dirtied; the glue probe ≤ 1 device px right after a cord switch | | |
| G8 painted elements | equal at every preset (the DOM is the same) | | |

---------------------------------------------------------------------------------------------------------------------------------

## 5. What stage 9b's reviews left (ROADMAP row 14)

| item | where it goes |
|---|---|
| 1 × faces on Android (the System 55 72.6 MB at 2 ×) | **Low**: `R` 1 (≈ 18 MB); Auto picks Low / Medium on Android; the `maxTex` clamp (§1.1) |
| the System 55 tile's long frame 283 / 433 ms at 4 × / 6 × CPU | **not the textures**: the s55c cold run's paints are 80–112 ms *summed* over 38 frames (paintMax 5.8 / 7.7 ms) while its worst frame is 166 / 300 ms — the DOM mount of 38 modules and the host's work in one task. Low shortens the raster tail only. Known limit + proposal O6 (§9) |
| a cord drop 67–117 ms at 6 × | **not the physics** (a drop steps one rope); the drop's host work (commit, payload, re-labels, jack restyle). Known limit + O6 |
| ▶ on a System 55 5–7 × a quantum (≈ 2–2.4 ms of a 2.67 ms deadline at Low-class speed) | **out of scope** (audio; D1, D2) — §11 |
| `graph()` at × 7 (median 0.35–1 ms, max to 6 ms; a JSC GC ≈ 17 ms) → the fast path; m9s at Low only at OS 1 / module cuts / longer chunks | **out of scope** (audio) — §11; lifting the module cap makes the fast path more valuable (§3.2) |

---------------------------------------------------------------------------------------------------------------------------------

## 6. Lanes, schedule, interfaces

Leaner shape: this contract → skeptic review → builders in worktrees **reset to the base** (`git reset --hard <base>`, check
`git log -1`) with exclusive files → two reviewers → failing-test-first fixers → one sweep → one squashed commit "P" → deploy. **No new
frozen refs** (no sound path changes).

| lane | phase | owns (exclusive) | tests | model |
|---|---|---|---|---|
| **T** textures | 1 | `cv-face.js` (`setPerf`, `dE`, the per-preset table `TEX_Q`, windows off at Low, budgets, the stale-level re-raster, the `maxTex` side limit), `cv-gl.js` (`maxTex`, `getError` after upload, `?texmax` honoured through an option), `tests/cv-face.test.mjs`, `tests/cv-gl.test.mjs` | §7 | standard |
| **C** cords + world | 1 | `cv-cords.js` (per-layer N / SUB / PTS, `CORD_Q`, `setPerf` with the asleep re-seed), `cv-world.js` (`setPerf` → FACES + cords, `o.perf` at build, `autoPerf` pure, `glStats` fields), `tests/cv-cords.test.mjs`, `tests/cv-world.test.mjs` | §7 | standard |
| **B** bounds | 1 | `patch-core.js`, `patch-dsp.js` (two constants + header comment only), `engine.js` (`WARM_C` only), `song.js`, `pads-core.js`, `cv-cables.js`, `cv-mods.js` (the `pd` patterns), `cv-model.js` (the device-add refusal), `cv-migrate.js` (13), `cv-tray.js` (`setFull` default), their tests + `tests/canvas-9-sim.test.mjs` / `tests/canvas-8-sim.test.mjs` pins | §7 | cheaper (mechanical) — **D1 gate after any engine.js / patch-dsp.js commit**: every golden |
| **H** host | 2 (after T / C's interfaces) | `main.js` (the pref, Auto at boot, `?perf`, the Settings line, live apply, heavy factors, bound texts from the constants, the device-add notice), `style.css` (the hint line), `tests/canvas-P-sim.test.mjs` (new, accessor-free), `tests/main.test.mjs`, `tests/ui-bench.html` + `tests/ui-bench-m9.mjs` (`&perf=` / `&texmax=` into the app frame) | §7 | standard |
| reviewers × 2 | 3 | (1) **real engine**: D1 (every golden; canonical-stream and the host sims' port logs at each preset), D6 (warm payloads hashed; a 9b project byte-identical through every reader), generated 128 / 256 / 512-module patches (payload with no `why`, 1 s rendered finite, `graph()` V8 + JSC timings, host paths timed), schema 13 against stage 9b's gate; (2) **headless Chrome**: §4's gates per preset at 4× / 6×, dpr 2 / 1.5, `&texmax=4096`, the live switch, Auto with spoofed UA / `deviceMemory` / cores (CDP overrides), no console error | — | standard |
| fixers | after | the finding's files, failing test first | | cheaper |

Interfaces (each lane stubs the other side): `FACES.setPerf('high'|'medium'|'low')`; `FACES.stats()` + `perf`, `dE`, `budget`;
`GL.maxTex`; `createCords(…, { perf })` + `cords.setPerf(id)`, `cords.stats().quality`; `world.setPerf(id)`, `world.glStats()` + `perf`;
`autoPerf(signals) → 'high'|'medium'|'low'` (cv-world.js); patch-core's constants read by name everywhere (`PT.MAX_MODS` …), never
re-typed. Rules: `?v=9` on every import; new test files `import './v8-guard.mjs'` first; never fake-DOM nodes in `assert.*`; one test
file at a time with `--max-old-space-size=2048`; no lane commits `sw.js` (the lead runs `node tools/precache.mjs --write`).

## 7. Tests

- **T** (cv-face / cv-gl): `dE` per preset at dpr 1 / 1.5 / 2 / 3; base sizes × (dE / dpr)²; Low: no window at any k; Medium windows
  ≤ dE·K_MAX and within 22.5e6 px; budgets per preset with eviction; a switch re-rasters stale bases one a frame, the old texture drawn
  until the swap, **no `gl` face with a visible SVG at any step**, a burst defers it; a fake gl with `MAX_TEXTURE_SIZE` 4096 → every
  face's side ≤ 4096; a fake `texImage2D` error → null → `fail` → the tier; High = today (every existing test untouched).
- **C** (cv-cords / cv-world): `full` = the LAB pins unchanged; `light` N 6 / SUB 3 / 14 points; `still` never steps, `wants()` false at
  rest, a moved end re-paths; a switch mid-sway re-seeds asleep (the drawn path = the parabola on the next frame); reduced motion =
  still at every preset; `autoPerf`'s table (every row and the one-step rule, the floor); `setPerf` reaches both layers.
- **B**: patch-core at 512 modules / 4096 cords / 8192 connections / 6-digit ids (refusals at the bound with the new numbers);
  patch-dsp: a 1 024-module payload analyses, 1 025 is `'limit'`; engine-track: the warm payload list's hash equals 9dde7e6's and every
  warm payload ≤ `WARM_C`; song: normDev 1 024 / 4 096, normLay 4 096, normMods 4 096, a 9b project byte-identical; cv-model: the
  1 025th device refused with its reason; pads-core / cv-cables / cv-mods: `pd64` valid, `pd65` not; cv-migrate: 13, its step the
  identity, a 13 file through a 12 gate read-only; cv-tray `setFull` at the bound.
- **H** (`canvas-P-sim`, accessor-free): the line and its four options ("Auto (Low)" from a spoofed environment); stored per device,
  never in the project; a change applies live and posts **no** worklet message; `?perf` overrides without storing; heavy thresholds per
  preset; a System 55 + 30 modules: no greyed tile; the device-add refusal notice.
- **Pins that change (none weakened; each moved to the new truth)**: tests/canvas-9-sim.test.mjs:501–509 ("48 modules" → the bound),
  tests/cv-tray.test.mjs:1232, tests/patch-core.test.mjs:284, 457, 886 (the texts), tests/engine-track.test.mjs:2232–2237 (`WARM_C`),
  the Pads tests' "8 Pads" (cv-model / canvas-8-sim / pads-core / cv-tray).

## 8. Docs to update (the lead, at the end)

ROADMAP row 14 (done: visual only, no caps — the user's lines) and the feedback table (the four lines quoted above); HANDOVER §3 (row),
§4 (the preset model, `synth.cv.perf`, the bounds), §5 (lessons); SUMMARY.md; this file's §12 / §13.

---------------------------------------------------------------------------------------------------------------------------------

## 9. Optional proposals (visual only; **not** in the default plan — the user approves any)

| # | lever | evidence | expected |
|---|---|---|---|
| O1 | Meters and the OUT scope at 30 Hz on Low | main.js:4767–4787 reads every track's 512-sample analyser and writes a style **every display frame**; `drawScope` redraws the whole canvas with `shadowBlur` 6 (main.js:4723–4764) | small; unmeasured |
| O2 | Lamp / LED glows as solid fills on Low (the reduced-motion style exists) | style.css:1405–1409 | small |
| O3 | Backdrop blurs off on Low (trays, rails, popovers over the moving canvas) | style.css:54, 268, 278, 839, 862 (10–16 px) | mobile GPUs pay per frame under a blur |
| O4 | The cord layer at 1 device px per CSS px on Low (13.4 → 3.4 MB at 1440 × 900), or `under` mode (no second canvas) | cv-cords.js:397–403; cv-world.js:673–683 | GPU memory; softer cord edges |
| O5 | A one-time hint "Zooming looks slow — ⚙ → Performance" when pinch frames stay long at High / Medium on a non-Apple device | the world's frame times | discoverability |
| O6 | Not a preset (every preset): spread a set tile's 38 module mounts over frames, batch a cord drop's restyles | §5 | the two 9b long frames |

## 10. Questions for the user

Each has the answer the build uses until you say otherwise.

1. **Should SYNTH pick a preset for each device the first time it runs?** *Recommended:* yes — **Auto**: an iPad or a Mac starts on
   High, an Android tablet on Low (Medium if it is a high-end one); Settings shows "Auto (Low)" and you can change it at any time.
   *Alternative:* always start on High — the iPad is unaffected, but a slower tablet's first impression is its slowest one, and the
   person has to find the setting themselves.
2. **Where should the setting live?** *Recommended:* ⚙ Settings only, in the Canvas section, as one menu. *Alternative:* also a button
   in the top bar — quicker to reach, but it takes room on small screens for something set once per device.
3. **On Low, should panels re-sharpen when you zoom in?** *Recommended:* no — Low draws every panel at standard resolution and never
   paints a sharper copy, so a slow tablet never pauses after a zoom (on your iPad Pro a sharper copy already takes ~80 ms to paint;
   a slower tablet could take a few tenths of a second). *Alternative:* keep the sharpening on Low with a small size limit — crisper
   up close, with a short freeze after each zoom-in on slow devices. (Medium keeps it; High is unchanged.)

**Things you will notice (no decision needed)**: a **Performance** line in ⚙ Settings; on High nothing changes. Medium and Low only
change how things look, never how they sound — your Oversampling setting stays exactly as it is and bounces are unchanged. On Medium the
cords swing a little more simply; on Low they hang still (like the reduced-motion setting) and panels look softer up close, like an
older screen — that is the point where your "never below 1 : 1" rule is relaxed, on the lower presets only. **No more limits on what
you build**: a patch can hold 512 modules (was 48) and 4 096 cords (was 128), a project 64 Pads modules (was 8), a track 1 024
modules (was 64, and a 65th could be lost silently on reload — fixed); the "may stutter" notices still appear once, as hints. Very
large patches may click when you plug a cord, and the whole app slows as you build — that is your device's limit, not ours. A project
saved by this build opens read-only in an older, not-yet-updated copy of the app (so nothing gets cut off).

## 11. Known limits (recorded, not work in this stage)

- **Audio at Low-class speed** (out of scope, D1 / D2): ▶ on a System 55 costs 5–7 × a quantum (≈ 2–2.4 ms of 2.67 ms at × 7);
  `graph()` × 7 (median 0.35–1 ms, max to 6 ms, a JSC GC ≈ 17 ms), and ≈ × 13 again at 512 modules — a plug in a very large patch
  can click on any device; m9s fits a slow tablet only at a lower oversampling (the user's control) — the levers measured in I9b spike
  (a2) decision 5 (OS 1, module cuts, longer evaluator chunks with their own frozen refs, the `graph()` fast path) stay available
  to a later engine stage.
- **The DOM** remains the main stutter driver on WebKit (S0); the presets do not reduce it; the notices (§1.4) guide.
- **9b's two long frames** (§5) — O6.
- **ModCore's fixed banks** (10 LFO, 4 ENV, … per track) and the FX rack's 48: real engine shapes, unchanged.

## 12. Notes (the builders fill in)

### Lane T
### Lane C
### Lane B
### Lane H
### Reviews and fixes
### Acceptance

## 13. Review log

### The skeptic review
