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
- **The user's answers to §10 (2026-10-22, relayed by the lead — settled)**: Q1 **no Auto — every device starts on High** (the stored
  value is high / medium / low, default high; `?perf=` stays as the test override); Q2 **⚙ Settings only** (the Canvas section);
  Q3 **Low never re-sharpens on zoom-in** (no windows on Low); §9's O1–O5: no preference → **none added**. O6 (not a lever) → a
  known limit (§9, §11; the skeptic's call on the lead's delegation).

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
  9dde7e6 (payloads, warm-up, goldens). (The one intended change at a bound: a 9b patch whose cords + lit routing rows pass 256
  has rows skipped today, with a tip, patch-core.js:580; at the new bound they connect — skeptic #17.)

---------------------------------------------------------------------------------------------------------------------------------

## 0. What exists (read at 9dde7e6)

| piece | where | P |
|---|---|---|
| Face textures: base level `L0 = min(dpr, BASE_L_MAX 3)` (≤ 16 M px, ≤ `TEX_MAX_DIM` a side), mipmapped; windows above `WIN_K0` 0.5 at ≤ `dpr·K_MAX`, ≤ `dpr·WIN_HEAD·k`, ≤ √(`WIN_BUDGET_PX` 40e6 / Σarea), only when ≥ `WIN_GAIN` 1.5 × the base; `FACE_BUDGET_BYTES` 384e6 (off-screen windows, then bases evicted; on-screen never) | cv-face.js:19–35, 48–62, 395–406 | the preset caps the density cv-face works at (§1.1) |
| `dprOf(F)` = the live `devicePixelRatio`, read by `run` / `plan` / `stats` | cv-face.js:169, 364, 417 | → the preset's effective ratio |
| A base is made only when missing (`needBase`, plan's `!F.base`); `run` replaces a base **after** the new upload (`free` then assign) | cv-face.js:307–311, 361, 386, 418 | a stale-level base re-rasters (old texture kept until the new lands) |
| No re-raster on a device-ratio change: cv-world's `watchDpr` resizes the grid only | cv-world.js:609–619 | fixed in passing (a stale level is a stale level) |
| `TEX_MAX_DIM = 8192` hard-coded ("the smallest MAX_TEXTURE_SIZE the site meets"); `gl.MAX_TEXTURE_SIZE` never read; `upload` catches exceptions only — a too-big `texImage2D` is a GL error, not a throw | cv-face.js:27, 31, 51, 61; cv-gl.js:196–212 | **[R] web3dsurvey: ≈ 25 % of Android WebGL2 devices report 4096** ([MAX_TEXTURE_SIZE](https://web3dsurvey.com/webgl2/parameters/MAX_TEXTURE_SIZE): Android ≥ 8192 75 %, ≥ 16384 3 %); at dpr 2 **four** bases are wider — the Moog Modular 4352, the CS-80 4864, the Jupiter-8 and Juno-60 4288 (1i's sizes with their keyboards, tests/cv-face.test.mjs:113 `FACES_1I`; the OB-Xa and DX7 exactly 4096; I1h §8's pre-1i table had the Modular at 3456, skeptic #6) → an incomplete texture (samples black, [R?] WebGL's rule) on those devices today. Fixed at every preset (§1.1) |
| The adaptive window cap `synth.cv.winpx` (raw localStorage; halves to 4e6 on a paint > 30 ms; the iPad Pro sits at 4e6: a window paint 79 ms) | cv-face.js:31, 154–162; I1h §8 (iPad verdict) | its start / floor scale with the preset |
| Cords: `STUDIO` N 10 points, SUB 4 (34 drawn points, `PTS`), DT 1/120, PASSES 5, BUDGET 160; `advance` / `step` pure; `motion()` = mode gl / under and not `reduced()`; motion off = the settled parabola (`shown`) on every draw, no ticker; `reduced` is injectable (`o.reduced`) but cv-world passes none (matchMedia) | cv-cords.js:35–36, 101–137, 139, 233, 265–269, 284, 424, 640–645; cv-world.js:680–690 | the preset sets the layer's quality (§1.2) |
| Prefs: `store.get/set('synth.…')` → IndexedDB kv `synthc.…` (appstore.js:97–98); `synth.cv.gl` / `synth.cv.cords` / `synth.cv.winpx` are read raw from localStorage | main.js:100, 109; cv-world.js:527–535, 673–679; cv-face.js:154–162 | the preset goes through `store` (main.js) and setters — no new raw key |
| ⚙ Settings: `#gearPop` (Engine: master, sample rate, **Oversampling**, drift · Recording · Canvas: pinch) + lines appended at init (Load estimates / Measure this device, New Serums open as) | index.html:133–163; main.js:5103–5124 | a **Performance** line in the Canvas section (§2) |
| Device signals today: `touchDev` (coarse pointer or touch points), `isIOS()` (iPadOS-as-Mac included), pwa.js `platform()` (Android by UA); **no** `hardwareConcurrency` / `deviceMemory` use in the app | main.js:807, 886; pwa.js:24–30 | **not used**: no Auto (the user's Q1, §2.2) |
| Heavy notices (touch only, once a session, never blocking): `SX_HEAVY` 1 866, `PT_HEAVY` 2 048 painted elements | main.js:6333, 6345, 6352–6379 | **unchanged at every preset** (§1.4) |
| Module / cord ids parsed outside patch-core: the evaluator drops a module number > 4096 (`'mod'`); makeSet's `m\d{0,3}` < 4096; the view's `midOf` and the host's event / sequencer binds `/^m\d{1,4}$/` | patch-dsp.js:181; moog-core.js:502; cv-patch.js:105; main.js:6784, 6839 | follow the lifted id range (§3.1, skeptic #1) |
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
| windows (above k 0.5, the visible part) | as today | on: level ≤ dE·K_MAX; budget 22.5e6 px (= 40e6 · (1.5/2)²); the window cap `synth.cv.winpx` as today (a device's paint speed in px — the same at every preset; skeptic #20) | **none** (§10 Q3, settled) |
| `FACE_BUDGET` (off-screen faces; an on-screen face is never evicted, cv-face.js:397, 405 — for those it is a soft bound, ≤ the viewport at K_MIN: 1440 × 900 full of faces ≈ 110 MB at dE 1) | 384 MB | 216 MB | 96 MB |
| System 55 at rest (dpr 2) | 69–73 MB [R] | ≈ 39–41 MB (× 0.5625) | ≈ 17–18 MB (× 0.25) |
| 30 s zoom 25–200 % peak, System 55 | 138 MB [R] | ≤ ≈ 80 MB | ≈ 18 MB (no windows) |
| hw5 (five hardware panels) | 171.7 MB [R] | ≈ 97 MB | ≈ 43 MB |
| raster work (paint ms ∝ texels) | s55c 111.6 ms at 6× [R] | ≈ × 0.56 | ≈ × 0.25 (≈ 28 ms) |

(The ratios are exact up to integer rounding: base bytes ∝ L²; `BASE_MAX_PX` binds only above level 2 for the biggest faces, I1h §8.
On a dpr-1.5 tablet High and Medium coincide for bases; Low still saves × 0.44.)

**Also, at every preset (a correctness fix, visual only)**: cv-gl reads `gl.getParameter(gl.MAX_TEXTURE_SIZE)` once (`GL.maxTex`
= min(that, `o.maxTex` — the `?texmax` test switch, read by cv-world from the URL and passed to `createGL`; never a raise);
cv-face's side limit becomes `min(TEX_MAX_DIM, GL.maxTex)`, passed into the pure `baseLevel(d, w, h, max)` / `winLevelOf(…, max)`
(default `TEX_MAX_DIM`: today's calls and tests unchanged) — the level drops to fit, as it does at 8192 today. `upload` checks
`gl.getError()` after `texImage2D` / `generateMipmap` and returns null on an error (→ `fail(F)` → the 1g tier, the path that exists),
with three rules (skeptic #5): **drain** `getError()` before the upload (a pending error from an earlier call must not fail a good
texture); `CONTEXT_LOST_WEBGL` is the loss path, **never** a `fail` (`failed` is sticky until an unmount); every new GL call guarded
(`typeof gl.getError === 'function'`, `getParameter` absent → 8192, no error) — the fakes in tests/cv-gl, tests/cv-face and main-sim's
stub have neither, and G1 needs them untouched. Cost: `getError` is a synchronous round trip to the GPU process (Chrome; WebKit's GPU
process too) — at a rest, one per upload: accepted. On the iPad (16384) and the Mac nothing changes (still 8192).

**Applied live** (`FACES.setPerf(id)`): windows freed or re-planned; the budget lowered (enforce evicts off-screen faces first, as
today); `plan` queues a base job for every mounted face whose `F.base.L` ≠ `baseLevel(dE, w, h)` (a **stale level**), nearest the
viewport centre first, one job a frame, never in a burst; `run` accepts a stale base (today's guards, cv-face.js:361 and the image
load's re-queue at :363, refuse any present base: both change); the old texture is drawn until the new one is uploaded and swapped
(cv-face.js:386 already frees after) — **no SVG flash, no blank face** (I9b fixer R2a's invariant: no `gl` face with a visible SVG).
Three rules the stale path needs (skeptic #2–#4): (a) **the budget credits the base being replaced** — `enforce(need − F.base bytes)`
(today's `bytes` still holds it: a High → Low switch would skip an off-screen face, or evict others, for room its own swap frees);
(b) **a stale re-raster that fails keeps its old base** — no `fail` (the face would drop to the tier / its SVG for good), and the
level is marked tried on the face (`F.lvlTry = L`) so a rest does not re-queue it until the preset or the ratio changes (else a
raster a rest, forever); the cold path (no base) keeps `fail`; (c) a folded, overlapped (`dom`) or failed face gets no job (plan's
`glOk`, :417) and keeps its stale base until it is drawable again — then its first rest re-rasters it. **Peak memory during a
switch** = max(the resident set once the windows go, the new budget) + one face + the 2D scratch (≤ 64 MB at High, cv-face.js:325):
a High → Low switch *starts* at High's on-screen bases and only falls (on-screen faces are never evicted); Low → High rises to the
budget. A device-ratio change takes the same path (a bonus: today a face keeps the ratio it was made at) — reached through cv-world's
`watchDpr` calling `FACES.recheck()`: a ratio-only change writes no camera, so no 'screen' and no plan today (cv-world.js:444–460,
609–619; skeptic #13).

**Visual cost** (the user's choice — written for §10's "things you will notice"): the 1h rule "never below 1:1" (I1h G2, the user's
2026-10-19 line) holds at **High** only. Medium: panels as sharp as High up to 75 % on a Retina-class screen, a little softer closer
in, sharpened at rest by windows. Low: panels at standard (1×) resolution — on a dpr-2 screen at 100 % like a non-Retina screen, softer
still when zoomed in, never re-sharpened. Unchanged at every preset: the 1g tier (`faceTier`, sized to the zoom at the screen's ratio,
cv-panel.js:1386–1491, :1418), the grid, the DOM controls, the cord layer's buffer — so at Medium / Low a module dragged over another
looks **sharper** while they overlap (the tier; its SVG at k ≥ 1) than its neighbours' textures (skeptic #12; accepted, said).

### 1.2 Cord physics (cv-cords) [C]

| | **High** (today) | **Medium** | **Low** |
|---|---|---|---|
| model | Studio: N 10, SUB 4 (34 drawn points), DT 1/120, PASSES 5, BUDGET 160 | **Studio at 6 points**: N 6, SUB 3 (14 drawn points); slack / wobble / weight / stiffness / DT / sleep rules unchanged (the lab's own "Points per cord" trade, docs/canvas/ref/cord-lab.html:105) | **still**: the settled parabola (`shown`), no simulation, no ticker — today's reduced-motion path (cv-cords.js:23, 284, 424) — **drawn at Medium's geometry** (6 points, SUB 3: 14 drawn points, × 0.4 the strip a drag rebuilds; the curve within ≈ 4.5 % of its sag of today's still path — 6 px on a 600 px cord, 14 px on 1 500; scratch `P/skeptic/still6.mjs`; skeptic #7) |
| physics per frame, 40 cords awake (node, M4, `advance` only; scratch `P/cordbench.mjs`) | 0.068 ms | 0.035 ms (× 0.51) | 0 |
| … 128 / 512 awake | 0.107 / 0.42 ms | 0.056 / 0.22 ms | 0 |
| smoothing per frame, 512 cords | 0.021 ms | 0.009 ms | (still: re-pathed only when an end moves — a camera move redraws the same strip, cv-cords.js:470) |
| in the app (40 awake) | iPad Pro step 0.18–0.2 + draw 0.05 ms; Mac 6× step 0.73–0.83, frame ≤ 3.3 ms [R] | ≈ half the step, ≈ 0.4 × the strip build / upload | step 0, no frames asked at rest |

`BUDGET` binds only below `BUDGET / awake` ≥ 1 step a rope (cv-cords.js:119), so past ≈ 80 awake ropes every one still takes a step a
frame — the physics is linear in awake cords, which only a module drag (its own cords) or a sway after it wakes. **But the layer's
cost at size is not the physics** (skeptic #7): `build()` rewrites every placed cord's strip and `upload()` re-sends all of it on any
frame a rope or an end moved (cv-cords.js:317, 419–447, 449–459) — at every preset, still included (a module drag re-paths every
pointer frame). Measured (scratch `P/skeptic/cordbuild.mjs`: node, M4, the real layer on a fake context, one rope swaying): 128 cords
0.14 ms + 233 KB a frame, 512 0.35 ms + 0.9 MB, 2 048 1.3 ms + 3.7 MB, **4 096 2.7 ms + 7.3 MB** — ≈ × 6 on a Low-class CPU, plus the
upload on its GPU. So with no cord cap a big rack's drag is bounded by **all** its cords, not those on the module; Medium and Low's
14-point strip cut it to × 0.4; the per-cord fix is **P-1** (§13). Lane C records the four sizes per preset.

**Applied live** (`cords.setPerf(id)` through `world.setPerf`): every cord's rope rebuilt at the preset's N and **re-seeded asleep from
its parabola** (cv-cords.js:57–67: `seed`, asleep) — so a switch never shows a jump from a stale rope; `PTS` and the strip / plug buffers
become per-layer (`N`, `SUB` from the quality, not module constants: cv-cords.js:51, 233, 334, 429–430, 515, 542–543, `pointAt` 670–671); still
→ `running = false`. Prefers-reduced-motion forces still at every preset (as today). Modes (gl / under / svg) unchanged (the SVG
fallback keeps its 10 / 4 path). What a switch shows: every cord moves from its settled shape to the parabola (the look of a project
just opened, IMPL-9 review #23 — a few px), and Medium's settled cords hang a little differently from High's (6 points, not 10).
`step` already reads the rope's own `n` (cv-cords.js:69–91): the physics needs no edit for N 6.

### 1.3 What the presets do not change (said plainly)

The DOM (painted elements — the stutter driver measured on WebKit, S0 `ui-m3`, I9 §0), the audio (D1, D2), the grid shader, meters,
scopes, lamps, halos, animations, the heavy notices (§1.4). A slow tablet's remaining costs are §11's known limits (§9's levers: not
taken, the user's answer).

**What a preset buys, said plainly (skeptic #11).** Low: face texture memory × 0.25 (the GPU memory an Android tablet loses its
context over); the CPU raster of a face × 0.25 wherever one happens (a cold load, an evicted face coming back, a switch); **no paint at
the rest after a zoom** (a window paint is the one frame-time hitch the textures cause: 79 ms on the iPad Pro at 4e6 px, I1h §8 —
proportionally longer on a slower CPU; Low makes none, Medium × 0.56 of the pixels); half the face overdraw above 100 % (the base is
drawn under its window, cv-face.js:580–581; Low draws one quad); no rope physics and no sway frames after a drag; the strip × 0.4.
**Not** the main-thread cost of the frames *during* a pinch or a pan (the DOM's and the compositor's; G8 equal at every preset) nor
the two 9b long frames (§5). The Mac simulation slows the renderer's main thread only (CDP CPU throttling): the GPU-side wins (memory, overdraw, upload) are
the counter's and the real-device pass's, never a frame gate's. **On the 2D path** (no WebGL2, `?nogl`, three context losses) the
presets change nothing: the 1g tier stays at the screen's ratio and the SVG cords are still already (skeptic #12).

### 1.4 Heavy notices: unchanged at every preset [C; skeptic #9]

`SX_HEAVY` / `PT_HEAVY`, the count, the once-a-session rule, the touch-only rule and the texts are today's at every preset; never a
refusal. (The draft scaled them × 1 / 0.75 / 0.5 per preset; withdrawn: with no Auto the preset says nothing about the device —
every tablet starts on High —, the painted count of a scene is the same at every preset (G8), and the user's line is "only the cord
physics and panel texture". The real-device pass re-decides the lines.)

---------------------------------------------------------------------------------------------------------------------------------

## 2. The preset model

### 2.1 Storage and application [C]
- **Per device**: `store` key `synth.cv.perf` (→ `synthc.cv.perf`) = `'high' | 'medium' | 'low'`; absent or anything else = `'high'`
  (the user's Q1: every device starts on High). Not in the project, no History step, no schema field.
- **Applied live, no reload**: main.js resolves the preset at boot (before the canvas builds: `store.get` is synchronous) and on every
  change → `cvW().setPerf(id)` → `FACES.setPerf(id)` + the cords layer. Nothing is posted to any worklet (D1: a test compares the port
  logs).
- `?perf=high|medium|low` overrides for the session (tests, ui-bench, reviewers; never stored).
- `world.glStats()` gains `perf`, `dE`, `faceBudget` (cv-world's mapping renames FACES.stats()'s keys — bytes / gl today,
  cv-world.js:1863 — so `budget` → `faceBudget` is one more line there); `FACES.stats()` gains `under` / `underMin` (windows and bases
  below the **screen's** 1:1 — Medium / Low by design) beside today's `soft` / `softMin`, which become relative to `dE` (skeptic #22);
  `cords.stats()` gains `quality`.

### 2.2 No Auto (the user's Q1, settled)
Every device starts on **High**; the preset changes only when the person picks one in ⚙. No device detection, no first-run rule, no
"Auto (…)" label. (The draft's `autoPerf` rules are withdrawn with it; nothing in the app reads `deviceMemory`,
`hardwareConcurrency` or a UA for P.)

### 2.3 Settings UI [C; the user's Q2: ⚙ Settings only]
⚙ → Canvas: a `label.field` **Performance** `select#perf` — `High` · `Medium` · `Low` — appended in main.js beside the existing lines
(main.js:5103–5124), with its title / one hint line: "Visual only — the sound never changes. Lower: softer panels up close, simpler
or still cords." Keyboard: the select's own. Not in the top bar.

---------------------------------------------------------------------------------------------------------------------------------

## 3. No artificial caps

### 3.1 The inventory [R: where; C: the new bound]

| cap | where | kind | today | **P** | why the bound |
|---|---|---|---|---|---|
| modules a 900 Series patch | patch-core.js:47 (`MAX_MODS`), enforced :130, :326, :437 / :442; tray greys main.js:6973; set tiles main.js:6974 + cv-tray.js:377–380; `setNeeds` patch-core.js:496 | guard (I9b Q3 "keep 48", superseded) | 48 | **512** | ≈ 14 × a System 55 (37); bounds a hostile file's parse / `graph()` / DOM |
| cords a patch | patch-core.js:47 (`MAX_CORDS`), :144, :276 | guard (cv-cords' buffers grow ×1.5, cv-cords.js:26) | 128 | **4096** | the one-plug rule caps cords at jacks / 2 anyway |
| connections (cords + bus rows) | patch-core.js:535 (`MAX_CONN`), :554, :580 | guard = the evaluator's | 256 | **8192** | = the evaluator's new guard |
| evaluator payload | patch-dsp.js:87 (`MAXM` 64, `MAXC` 256), checked :184, :209 | guard (no buffer sized by them) | 64 / 256 | **1024 / 8192** | ≥ the core's bounds, as today (64 ≥ 49) |
| module / cord numbers | patch-core.js:47 (`MAX_NID` 4096, `MAX_CID` 65535), :61 (`MID_RE` 4 digits, `CID_RE` 5) — never reused (`nextId`, :316–321); **and outside patch-core** (skeptic #1): the evaluator's `e[0] <= 4096` (patch-dsp.js:181 — a module numbered past it is dropped as `'mod'`, its cords as `'cord'`: silent), makeSet's `/^m([1-9]\d{0,3})$/` < 4096 (moog-core.js:502), the view's `midOf` `/^m\d{1,4}$/` (cv-patch.js:105 — an `m10000` is no patch module: no size, title, menu, members), the host's event and sequencer binds `/^m\d{1,4}$/` (main.js:6784, 6839) | guard | 4096 / 65535 | **1e6 / 1e6** (6 digits each): patch-core exports `isMid(s)` / `isCid(s)` (its regexes, its bounds) and **every** site above uses them; the evaluator's bound becomes `≤ 999999` (a third patch-dsp constant, on the audio thread: lane B's D1 gate) | a big rack rebuilt for years never runs out |
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
| a tapped module's free-slot search | patch-core.js:769–771 (64 lines above the rack, then a fixed spot: past it every tapped tile lands on the same place) | placement (no refusal) | 64 lines | **2 + ⌈MAX_MODS / 2⌉ lines** (a line holds ≥ 2 of the widest, 864, at `rackWide` 2 816) | skeptic #18; measured 0.2 ms at 512 modules |
| a Serum's sequencer: 1 024 notes a clip, 4 096 a bank, 512 arp events / strums, lengths 256 / 1 024 | seq-core.js:134–139 = sx-seq.js:118 (`arpEv` sized by them, :405) | real (worklet arrays) | — | unchanged (D1) | the instrument's shapes |
| a drum machine's pattern memory (`MAX_MEAS` 1 793, `MAX_STEPS` 28 688) | drum-core.js:107 | the machines' design | — | unchanged | |
| a project's plain data: arrays ≤ 100 000, strings ≤ 2 000 | song.js:138–141 (`plain`) | memory guard | — | unchanged | runaway memory |

### 3.2 Knock-on effects
- **Warm-up (D6)**: engine.js:3811 and :3863 split the warm graphs by `PD.MAXC` — lifted, the warm-up would merge into one graph and
  change its JIT shapes (I9b lane E9b's choices 1–3). **Pinned**: `const WARM_C = 256` in engine.js, used at both sites; the warm
  payload list stays byte-identical (a hash in engine-track, **computed on the base before B's first edit**; its "every payload within
  MAXC" check, tests/engine-track.test.mjs:2232–2237, pins the literal 256 — `WARM_C` is a script-scope const of the worklet file —
  and gains "every warm payload ≤ 64 modules", the old `MAXM`: true today (the table's types + the controller), so the lifted `MAXM`
  changes no warm analysis either; skeptic #16).
- **Evaluator / engine**: **three** guard constants change in patch-dsp.js — `MAXM`, `MAXC` and the module-number bound at :181
  (skeptic #1); no allocation is sized by them (patch-dsp.js:86–87, 396, 410). `graph()` runs on the audio thread at every plug:
  ≈ 0.05–0.15 ms median, max 0.2–0.9 ms at 38 modules, ≈ 0.28 MB allocated a call (I9b spike a2) — **at least** linear: the
  schedule's topological pick scans and splices the ready list per component (patch-dsp.js:327–333), O(components × ready) —
  quadratic for a wide patch (many parallel voices), near-linear for a deep chain (skeptic #15). Measured at 128 / 256 / 512 (V8, JSC),
  a wide and a deep patch each, and **recorded, not gated**: a plug in a very large patch may click on any device — the user's "until
  their system lags" (§11).
- **Host paths at size** — measured at canvas's head (scratch `P/skeptic/hostpaths.mjs`: node, M4, records built past the old guards;
  37 / 128 / 256 / 512 modules): **every module's title** (cv-patch `devices()` and each body's label, on every sync) 0.16 / 1.7 / 6.1 /
  **25.5 ms** — O(n² log n): `ordinal` sorts the whole record with a regex comparator per call (patch-core.js:66, 774–779);
  **`targets()`** (Connect to…, the drag's halos) 0.36 / 1.9 / 6.1 / **26 ms** at 1 500 cords — O(jacks × cords): `occupied` / `driven`
  scan the cords per jack (:108–113, 264, 270); `payload` 2.5, `liveNodes` 2.7, `rackLayout` 0.3, `freeSlot` 0.2 ms at 512 — linear.
  Under 50 ms on the Mac, yet ≈ 150 ms each at Low-class speed on **every** edit (skeptic #8). **Lane B makes both linear** —
  `ordinal` from one sorted pass per record (a memo), `targets` with one occupied set and the driven groups computed once —
  output-identical (an equality test against the 9dde7e6 functions over generated records up to 512 / 4 096), and times them again.
  cv-face's own paths at size (lane T, node with the fake world, recorded; skeptic #14): `plan()` runs whole after every base landing
  (cv-face.js:390, 408–437 — every face's sync a landing: O(n²) over a cold load or a switch) and `recheck()` is faces × world items
  (:447–460) once a frame of a module drag; History snapshots copy the record. Anything over 16 ms (a frame) at 512 on the Mac is
  reported in §12 for the lead.
- **File format**: **SCHEMA 12 → 13** with an identity step (cv-migrate.js:102, STEPS; the documented rule: a stage that changes what a
  saved field may hold bumps it, cv-migrate.js:4–5) — a stage-9b build then opens a 13 project **read-only** (cv-migrate.js:151)
  instead of truncating a 49-module patch or a 65th device on its next save. Additive: every 12 project reads unchanged.
- **The tray**: no greyed Moog module tile, set tile or Controllers tile below the bound; at the bound the existing texts with the
  new number (main.js:6973–6974, 7289; cv-tray.js:377 `setFull`'s default from `PT.MAX_MODS`).
- **Tidy / camera**: `rackLayout` wraps upward past `rackWide` 2 816 (patch-core.js:724–754) — 512 small modules ≈ 25 lines; the
  top-anchored camera (I9b §4.4) frames the top; Fit stops at K_MIN 0.25 (cv-world.js:67); the minimap reaches the rest. Accepted.
- **DOM / GL at size**: ≈ 40 painted a module → ≈ 20 k at 512 (cv-world's `BUDGET_EL` 9 000 is a console warning only,
  cv-world.js:86, 973–976); faces past the preset's budget are evicted off screen (cv-face.js:395–406) — designed behaviour; an
  on-screen face never is (the budget is soft for them: ≤ the viewport at K_MIN). The cord layer's per-frame rebuild grows with
  every cord (§1.2, P-1).
- **Goldens**: no existing payload, record or message changes (D6) → bit-identical; golden-moog / -b run as part of lane B's gate.

---------------------------------------------------------------------------------------------------------------------------------

## 4. Budgets and gates (UI; the audio rows need none)

**Audio bench rows** (node / jsc / ipad, bench.json `targets`): **unchanged at every preset by construction** (D1) — no new rows, no
per-preset targets. **New record** `"ui-P-mac"` (reviewer 2).

**How Low is simulated** (reviewer 2, headless Chrome 155 by CDP as I9b's `ui-m9b-mac`: `--headless=new --use-angle=metal`,
1440 × 900 and 1366 × 1024 touch): `Emulation.setCPUThrottlingRate` 4 and 6; `--force-device-scale-factor` **2 and 1.5** (common Android
tablet ratios); `&perf=…`; **`&texmax=4096`** (a test switch: cv-gl reports 4096 as `maxTex`, the 25 % Android case); the preset's
`FACE_BUDGET` asserted from `glStats()`; optionally `--force-gpu-mem-available-mb=512` ([R?] a Chromium switch that limits tile memory,
[gpu_switches.cc](https://chromium.googlesource.com/chromium/src/+/47cd4f581fdc93cbca03bc94de084cd418c8c59e/gpu/command_buffer/service/gpu_switches.cc);
[R?] unverified for WebGL texture allocations — no gate relies on it). **What the simulation can and cannot show** (skeptic #11):
CDP's CPU throttling slows the renderer's main thread (the DOM, the JS, the 2D canvas raster of a face); the GPU process — fill rate,
uploads, texture memory — runs at the M4's speed and memory. So the frame gates measure the CPU wins (rest paints, cold rasters, the
cord step and strip); the GPU-memory win is the `faceBytes` counter (by construction) and a **forced context loss**
(`WEBGL_lose_context`) proves the loss path at each preset; whether Low keeps a real Android tablet's context alive is the
real-device pass's question. Scenes: `tests/ui-bench.html?m9=1&s55=1` (`s55`, `s55w`, `s55c`, `m30`, `hw5`) with `&perf=` passed into the app frame.

| gate | High | Medium | Low |
|---|---|---|---|
| G1 today | ui-m9b-mac's verdicts and MB ± 2 %; every cv-face / cv-cords test unchanged | — | — |
| G2 face MB (`faceBytes`) — in every scene started at the preset, and after a switch once its queue drains (a High → Low switch starts at High's on-screen bases and only falls, §1.1; skeptic #2) | ≤ 384 MB | ≤ 216; s55 at rest ≤ 0.6 × High's (dpr 2) | ≤ 96; s55 at rest ≤ 0.27 × High's; 30 s zoom peak ≤ 0.3 × High's |
| G3 `&texmax=4096` | every face a complete texture (the wide four — Modular, CS-80, Jupiter-8, Juno-60 — at a lower level; no `fail`, no black quad: a readPixels probe on each) | same | same |
| G4 frames (frames only, the CDP stamp excluded as in ui-m9b-mac) — a **no-regression** gate: High already passes at 4× and is P at 6× (§0); each scene's verdict names its limiting term (burst / first / settle — skeptic #10) | no worse than ui-m9b-mac | s55 / s55w / m30 P+ at 4× | P+ at 4×, ≥ P at 6×, and no worse than High in the same run |
| G9 the rest after a zoom (the win Low is for; skeptic #10): s55 and hw5, every base present, a zoom 60 → 150 → 60 % with a rest at each end, 4× / 6× | windows painted as today | window px painted ≤ 0.6 × High's in the same run | **0 paints** across the cycle (`stats().paints` unchanged); the settle frame max ≤ High's in the same run |
| G5 cords (s55w, all 40 plucked) | as today | `stepMs` ≤ 0.6 × High's in the same run | 0 rope-steps; no rAF requested at rest after a module drag; a dragged module's cords follow its plugs |
| G6 cold s55c | as today | — | `paintMs` ≤ 0.35 × High's in the same run |
| G7 live switch on a System 55 (High → Low → Medium → High), once at rest and once with a pinch started mid-queue; then a forced context loss + restore at Low and at Medium | at no frame a `gl` face with a visible SVG; every face at the new level within its queue; no worklet message (port log equal); no History step; the autosave not dirtied; the glue probe ≤ 1 device px right after a cord switch; after the restore every base at the preset's level and the cords at its quality | | |
| G8 painted elements | equal at every preset (the DOM is the same) | | |

---------------------------------------------------------------------------------------------------------------------------------

## 5. What stage 9b's reviews left (ROADMAP row 14)

| item | where it goes |
|---|---|
| 1 × faces on Android (the System 55 72.6 MB at 2 ×) | **Low**: `R` 1 (≈ 18 MB), picked by the person in ⚙ (every device starts on High: the user's Q1); the `maxTex` clamp at every preset (§1.1) |
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
| **T** textures | 1 | `cv-face.js` (`setPerf`, `dE`, the per-preset table `TEX_Q`, windows off at Low, budgets, the stale-level re-raster with §1.1's rules (a)–(c), the `maxTex` side limit through `baseLevel` / `winLevelOf`'s `max`, `stats()` `under`, the at-size timings of `plan` / `recheck`), `cv-gl.js` (`maxTex` = min(gl's, `o.maxTex`), `getError` after upload with the drain / lost / guard rules), `tests/cv-face.test.mjs`, `tests/cv-gl.test.mjs` | §7 | standard |
| **C** cords + world | 1 | `cv-cords.js` (per-layer N / SUB / PTS, `CORD_Q` — still drawn at 6 / 3 —, `setPerf` with the asleep re-seed, the rebuild timings at 128…4 096 cords; P-1 if taken), `cv-world.js` (`setPerf` → FACES + cords, `o.perf` at build, `?texmax` read beside `?nogl` and passed to `createGL` as `o.maxTex`, `watchDpr` → `FACES.recheck()`, `glStats` fields), `tests/cv-cords.test.mjs`, `tests/cv-world.test.mjs` | §7 | standard |
| **B** bounds | 1 | `patch-core.js` (+ `isMid` / `isCid`, `ordinal` / `targets` linear, `freeSlot`'s lines), `patch-dsp.js` (three constants + header comment only), `engine.js` (`WARM_C` only), `moog-core.js` (makeSet's id pattern → `isMid`, :502 only), `cv-patch.js` (`midOf` → `isMid`, :105 only), `song.js`, `pads-core.js`, `cv-cables.js`, `cv-mods.js` (the `pd` patterns), `cv-model.js` (the device-add refusal), `cv-migrate.js` (13), `cv-tray.js` (`setFull` default), their tests + the pins of §7 | §7 | cheaper (mechanical) — **D1 gate after any engine.js / patch-dsp.js commit**: every golden; the 9b frozen-record pin after the moog-core edit |
| **H** host | 2 (after T / C's interfaces) | `main.js` (the pref, `?perf`, the Settings line, live apply, bound texts from the constants, the device-add notice, the two `/^m\d{1,4}$/` sites → `PT.isMid`, main.js:6784, 6839), `style.css` (the hint line), `tests/canvas-P-sim.test.mjs` (new, accessor-free), `tests/main.test.mjs`, `tests/ui-bench.html` + `tests/ui-bench-m9.mjs` (`&perf=` / `&texmax=` into the app frame; G9's zoom cycle) | §7 | standard |
| reviewers × 2 | 3 | (1) **real engine**: D1 (every golden; canonical-stream and the host sims' port logs at each preset), D6 (warm payloads hashed; a 9b project byte-identical through every reader), generated 128 / 256 / 512-module patches, wide and deep (payload with no `why`, 1 s rendered finite, `graph()` V8 + JSC timings, host paths timed), a module numbered past 4 096 and one past 9 999 heard and editable end to end, schema 13 against stage 9b's gate; (2) **headless Chrome**: §4's gates per preset at 4× / 6×, dpr 2 / 1.5, `&texmax=4096`, the live switch, the forced context loss, no console error | — | standard |
| fixers | after | the finding's files, failing test first | | cheaper |

Interfaces (each lane stubs the other side): `FACES.setPerf('high'|'medium'|'low')` — on the `FACES` object **and** as a named export
(cv-world imports the namespace, cv-face.js:608–610); `FACES.stats()` + `perf`, `dE`, `budget`, `under`; `createGL(viewport, { …,
maxTex })`, `GL.maxTex`; `createCords(…, { perf })` + `cords.setPerf(id)`, `cords.stats().quality`; `world.setPerf(id)`,
`world.glStats()` + `perf`, `dE`, `faceBudget`; `PT.isMid(s)` / `PT.isCid(s)`; patch-core's constants read by name everywhere
(`PT.MAX_MODS` …), never re-typed. Rules: `?v=9` on every import; new test files `import './v8-guard.mjs'` first; never fake-DOM nodes in `assert.*`; one test
file at a time with `--max-old-space-size=2048`; no lane commits `sw.js` (the lead runs `node tools/precache.mjs --write`).

## 7. Tests

- **T** (cv-face / cv-gl): `dE` per preset at dpr 1 / 1.5 / 2 / 3; base sizes × (dE / dpr)²; Low: no window at any k; Medium windows
  ≤ dE·K_MAX and within 22.5e6 px; budgets per preset with eviction; a switch re-rasters stale bases one a frame, the old texture drawn
  until the swap, **no `gl` face with a visible SVG at any step** (also with a folded, an overlapped and a failing face in the set),
  a burst defers it; the replaced base credited (a High → Low switch over off-screen faces evicts none it would shrink); a stale
  upload that fails keeps the old base, no `fail`, and is not re-queued at the next rest; **every real face** (tests/cv-face.test.mjs
  `FACES_1I` and `FACES_9`, the authored layouts) through `baseLevel(dE, w, h, 4096)` at each preset × dpr 1 / 1.5 / 2 / 3: every side
  ≤ 4096 (and through a fake gl reporting 4096: the uploaded sizes); a fake `texImage2D` error → null → `fail` → the tier; a stale
  `getError` drained; `CONTEXT_LOST_WEBGL` → no `fail`; a fake gl without `getError` / `getParameter` works as today; High = today
  (every existing test untouched); `plan` / `recheck` timed at 512 faces (recorded).
- **C** (cv-cords / cv-world): `full` = the LAB pins unchanged; `light` N 6 / SUB 3 / 14 points; `still` never steps, `wants()` false at
  rest, a moved end re-paths, its path the 6 / 3 parabola; a switch mid-sway re-seeds asleep (the drawn path = the parabola on the next
  frame); reduced motion = still at every preset; `setPerf` reaches both layers; a ratio-only change re-plans the faces; `?texmax`
  reaches `createGL`; the rebuild at 128 / 512 / 2 048 / 4 096 cords timed per preset (recorded).
- **B**: patch-core at 512 modules / 4096 cords / 8192 connections / 6-digit ids (refusals at the bound with the new numbers); a
  6-digit module through `payload` → the evaluator's `analyse` (no `'mod'`), `midOf`, makeSet and the host's event post; a source grep
  test: no `\d{1,4}` / `\d{0,3}` module-id pattern and no `4096` id bound left outside `isMid`; `ordinal` / `targets` equal to the
  9dde7e6 functions over generated records (≤ 512 modules / 4 096 cords) and timed; `freeSlot` past 64 lines; patch-dsp: a
  1 024-module payload analyses, 1 025 is `'limit'`; engine-track: the warm payload list's hash (computed on the base) unchanged,
  every warm payload ≤ 256 connections (the literal) and ≤ 64 modules; song: normDev 1 024 / 4 096, normLay 4 096, normMods 4 096, a
  9b project byte-identical; cv-model: the 65th device kept through a save, a load and an undo (the failing test first), the 1 025th
  refused with its reason; pads-core / cv-cables / cv-mods: `pd64` valid, `pd65` not; cv-migrate: 13, its step the identity, a 13 file
  through a 12 gate read-only; cv-tray `setFull` at the bound.
- **H** (`canvas-P-sim`, accessor-free): the line and its three options (High selected on a fresh device); stored per device, never in
  the project; a change applies live and posts **no** worklet message; `?perf` overrides without storing; the heavy notices' lines
  equal at every preset; a System 55 + 30 modules: no greyed tile; the device-add refusal notice; a 960 numbered `m10000`: its event
  buttons post.
- **Pins that change (none weakened; each moved to the new truth)**: tests/canvas-9-sim.test.mjs:501–509 ("48 modules" → the bound),
  tests/cv-tray.test.mjs:1232, tests/patch-core.test.mjs:284, 457, 886 (the texts), tests/engine-track.test.mjs:2232–2237 (`WARM_C`),
  tests/cv-migrate.test.mjs:1515 ("≤ 48 modules, ≤ 128 cords"), the Pads tests' "8 Pads" / `pd9` (cv-model:203, canvas-8-sim:157–159,
  pads-core:42, 126, 380, cv-cables:1155–1156, cv-mods:362, cv-tray) — skeptic #19.

## 8. Docs to update (the lead, at the end)

ROADMAP row 14 (done: visual only, no caps — the user's lines) and the feedback table (the four lines quoted above); HANDOVER §3 (row),
§4 (the preset model, `synth.cv.perf`, the bounds), §5 (lessons); SUMMARY.md; this file's §12 / §13.

---------------------------------------------------------------------------------------------------------------------------------

## 9. Optional proposals (visual only; **not** in the default plan — the user approves any)

**Answered (the user, 2026-10-22): no preference → none of O1–O5 is added.** Kept as a record. **O6** is a fix at every preset, not a
lever; the skeptic's call (the lead delegated it): **not in P** — the two 9b long frames stay a known limit (§11), re-measured by the
real-device pass before anyone spreads mounts over frames; the part of the cord drop's host work that the lifted bounds would make
quadratic (titles, `targets`) is fixed in lane B (§3.2), output-identical.

| # | lever | evidence | expected |
|---|---|---|---|
| O1 | Meters and the OUT scope at 30 Hz on Low | main.js:4767–4787 reads every track's 512-sample analyser and writes a style **every display frame**; `drawScope` redraws the whole canvas with `shadowBlur` 6 (main.js:4723–4764) | small; unmeasured |
| O2 | Lamp / LED glows as solid fills on Low (the reduced-motion style exists) | style.css:1405–1409 | small |
| O3 | Backdrop blurs off on Low (trays, rails, popovers over the moving canvas) | style.css:54, 268, 278, 839, 862 (10–16 px) | mobile GPUs pay per frame under a blur |
| O4 | The cord layer at 1 device px per CSS px on Low (13.4 → 3.4 MB at 1440 × 900), or `under` mode (no second canvas) | cv-cords.js:397–403; cv-world.js:673–683 | GPU memory; softer cord edges |
| O5 | A one-time hint "Zooming looks slow — ⚙ → Performance" when pinch frames stay long at High / Medium on a non-Apple device | the world's frame times | discoverability |
| O6 | Not a preset (every preset): spread a set tile's 38 module mounts over frames, batch a cord drop's restyles | §5 | the two 9b long frames |

## 10. Questions for the user (answered 2026-10-22)

**Answered by the user, 2026-10-22 (relayed by the lead) — settled; the build follows these:**

1. **Should SYNTH pick a preset for each device the first time it runs?** → **No.** Every device starts on **High**; the person
   picks Medium or Low in ⚙ (no detection, no "Auto" label — §2.2).
2. **Where should the setting live?** → **⚙ Settings only**, in the Canvas section, as one menu (§2.3).
3. **On Low, should panels re-sharpen when you zoom in?** → **No** — Low draws every panel at standard resolution and never paints a
   sharper copy (§1.1); Medium keeps the sharpening; High is unchanged.
4. **The optional visual levers O1–O5 (§9)?** → no preference, so **none is added**.

**Things you will notice (no decision needed)**: a **Performance** line in ⚙ Settings (High · Medium · Low, High to start); on High
nothing changes. Medium and Low only change how things look, never how they sound — your Oversampling setting stays exactly as it is
and bounces are unchanged. On Medium the cords swing a little more simply; on Low they hang still (like the reduced-motion setting) and
panels look softer up close, like an older screen — that is the point where your "never below 1 : 1" rule is relaxed, on the lower
presets only (and a module dragged over another looks sharp for as long as they overlap). **No more limits on what you build**: a
patch can hold 512 modules (was 48) and 4 096 cords (was 128), a project 64 Pads modules (was 8), a track 1 024 modules (was 64, and
a 65th could be lost silently on reload — fixed); the "may stutter" notices still appear once, as hints, the same at every preset.
Very large patches may click when you plug a cord, and the whole app slows as you build — that is your device's limit, not ours (and
when the sound engine stays overloaded, today's safeguard still lowers the Oversampling setting and says so, as it does now). A
project saved by this build opens read-only in an older, not-yet-updated copy of the app (so nothing gets cut off).

## 11. Known limits (recorded, not work in this stage)

- **Audio at Low-class speed** (out of scope, D1 / D2): ▶ on a System 55 costs 5–7 × a quantum (≈ 2–2.4 ms of 2.67 ms at × 7);
  `graph()` × 7 (median 0.35–1 ms, max to 6 ms, a JSC GC ≈ 17 ms), and ≈ × 13 again at 512 modules — a plug in a very large patch
  can click on any device; m9s fits a slow tablet only at a lower oversampling (the user's control) — the levers measured in I9b spike
  (a2) decision 5 (OS 1, module cuts, longer evaluator chunks with their own frozen refs, the `graph()` fast path) stay available
  to a later engine stage.
  `graph()`'s schedule is quadratic for a wide patch (§3.2): reviewer 1's numbers decide whether that later stage needs it sooner.
- **The DSP-load safeguard** (D2, unchanged): when the load stays above 85 %, `lowerOS` halves the ⚙ Oversampling and **persists** it
  (main.js:1313–1316, with a notice). With no module cap a big patch is its likeliest trigger — said in §10 so it is no surprise.
- **The DOM** remains the main stutter driver on WebKit (S0); the presets do not reduce it; the notices (§1.4) guide.
- **9b's two long frames** (§5): O6 not taken (§9) — the System 55 tile's one long frame and a cord drop's host work at 4× / 6× stay
  as they are, re-measured by the real-device pass.
- **The cord layer at size** (§1.2): one swaying cord rebuilds and re-uploads every cord's strip — 2.7 ms + 7.3 MB a frame at 4 096
  cords on the M4 — unless P-1 is taken.
- **The 2D path** (no WebGL2, `?nogl`, three context losses): the presets change nothing there (§1.3).
- **ModCore's fixed banks** (10 LFO, 4 ENV, … per track) and the FX rack's 48: real engine shapes, unchanged.
- **(Reviews.)** The presets do not speed up Chrome's main thread: a cold face load and Medium's rest paints cost High's ms (review 2 F4);
  their wins are face memory, Low's zero rest paints and cord work; whether they keep a real Android tablet's GL context alive is the
  real-device pass's question. System 55 frame times, cold loads, big-rack pinch (DOM-bound) are the same at every preset.
- **Feedback-heavy racks** cost more than lane B's 1.3–1.5 × at 512 modules: 2.9 × (298 nodes in loops) to 9.4 × the deadline (3 563
  cords, 834 nodes in loops), `graph()` 5.8–8.8 ms (review 1 F3) — the device's limit, as the user wants.
- **Opening a 511-module rack** is still O(n²) in Tidy (≈ 350 ms of a 540 ms open in node); edits are O(n) after fixer B.
- **The evaluator's `expand`** still recurses: two chained-994 cases (511 multiples) throw at a 200 KB stack (fine at 384 KB in JSC); the
  throw now reports `ptErr 'graph'` and the notice, the last good patch keeps playing.
- **The Sources pull tab** at the left edge can meet iPadOS's back-swipe in a browser (review 2 F7) — the standalone app (ROADMAP 12).

## 12. Notes (the builders fill in)

### Lane T

**Built** (cv-face.js, cv-gl.js, tests/cv-face.test.mjs, tests/cv-gl.test.mjs; nothing else touched, no audio file, no sw.js):
`TEX_Q` (high: R ∞, windows, 40e6 px, 384 MB · medium: R 1.5, windows, 22.5e6 px, 216 MB · low: R 1, no windows, 96 MB), `perfId`,
`dEOf`; `FACES.setPerf(id)` (+ the named export `setPerf`, the getter `FACES.perf`): the policy at `dE = min(dpr, R)` (base, windows,
plan's 1:1 checks, `soft`); live: every window freed, `plan()` (in a burst: the rest's) queues every mounted drawable face at a stale
level, one a frame, nearest first; `run` re-rasters a stale base with the old one drawn until the swap (mode stays gl: the R2a
invariant); a stale job that fails (2D context, upload) keeps its base and sets `F.lvlTry` (no re-queue until the level changes:
a preset, the ratio, the side limit); `side()` = min(TEX_MAX_DIM, `GL.maxTex`) into `baseLevel(d, w, h, max)` /
`winLevelOf(d, k, sum, w, h, cap, max, budget)` (old calls unchanged); `stats()` + `perf`, `dE`, `budget`, `texSide`, `under`,
`underMin`. cv-gl: `GL.maxTex` = `getParameter(MAX_TEXTURE_SIZE)` read once (absent / throw / garbage → `MAX_TEX_DEFAULT` 8192), lowered
by `o.maxTex`; `upload` drains the flags, checks once after texImage2D / texParameteri / generateMipmap (an error → the texture
deleted, null), `CONTEXT_LOST_WEBGL` or `isContextLost()` → null and `ready` false (the event follows); cv-face reads a null with
`GL.ready === false` as the loss path (no `fail`). Every new GL call guarded: the fakes run as today.

**[C] refinements (reasons)**: (1) **High's R is ∞, not 3** — D3 at any ratio: at dpr > 3 an R of 3 would cap today's windows
(d·K_MAX); the base still stops at BASE_L_MAX 3. (2) **Rule (a) is a projection, not the job's own credit**: the budget counts
every stale, drawable, untried base at its new level (`projB`, `enforce`'s D). The literal `enforce(need − F.base bytes)` still evicts
a face its swap would shrink while the *others* still count at the old level (a on + b off, 4000 × 2000 at dpr 2: 170.7 MB; a's
job: 170.7 − 42.7 = 128 > 96 → b evicted, though both shrunk are 85.3) — the §7 test pins the case; a High set too big for Low ends
as a cold Low load (the nearest off-screen kept, the farther evicted at the first job, never re-made); Low → High counts the growth.
At High with no stale base D = 0: today's arithmetic. (3) **A switch frees every window** (Low: for good; else the rest re-plans at
the new level): the simplest way to put the new window policy in force — a moment of the base under 1:1 above 100 % after a switch,
never an SVG. (4) **Two getError round trips an upload** (the drain's one NO_ERROR + one check), not one: the drain is rule (5), one
check after the last call covers all three (a flag left behind is cleared by the next drain). (5) `lvlTry` also clears when a base
is freed (unmount, eviction, loss, detach). (6) `under` = a base at L < dpr · min(k, 1) (its 1:1 promise holds to 100 %), a window at
L < dpr · k; at High it counts only the recorded exemptions (the 16 M px ceiling above dpr 2.5, a `maxTex`-capped face).

**High = today, proven**: a scripted scene (real face sizes, a wood case, an off-screen face, 30 → 200 % zooms and pans, a loss /
restore, five 4000 × 2000 faces over the budget) traced — every upload's size / mips / source rect, the frees, the stats, the modes —
and hashed **on the base's cv-face (4cc0936) at dpr 1 / 1.5 / 2 / 2.5 / 3 / 4**, committed first; the same hashes after the change
(test "P High = today"). Every older cv-face / cv-gl test untouched.

**Gates** (one file at a time, `--max-old-space-size=2048`): cv-face 40/40 · cv-gl 10/10 · cv-panel 108/108 · classic-panel 14/14 ·
canvas-1i-sim 20/20 (peak RSS 0.94 GB) · canvas-9b-sim 14/14 (0.61 GB) · lint 161/161. **Expected reds, not T's files**:
tests/cv-world.test.mjs:446 pins `glStats()`'s key list — lane C adds `perf`, `dE`, `faceBudget` (FACES' `budget` renamed),
`texSide`, `under`, `underMin`; tests/pwa.test.mjs's precache hash (the lead's `node tools/precache.mjs --write`).

**At size (node, M4, the fake world; recorded)**: 512 faces (128 × 472, two rows on screen; 297 bases fit High's 384 MB): a cold load
through the queue 110 ms over 1 024 frames (0.21 ms a landing: `plan()` whole after each — O(n) each, O(n²) in all); `recheck()` 4.2 ms
(faces × world items: **once a frame of a module drag** — ≈ 25 ms at a Low-class × 6, i.e. over a frame there: for the lead);
`FACES.recheck()` 4.5 ms; a High → Low switch drained in 512 frames at 0.16 ms a frame. Nothing over 16 ms on the Mac.

**Headless Chrome** (Chrome 155, `--headless=new --use-angle=metal --force-device-scale-factor=2`, 1440 × 900; tests/ui-bench.html
?m9=1&s55=1 driven by CDP, `__m9.fn.build`; a scratch copy served on its own port with a **stand-in for lane C's wiring** — `?perf=` →
`FACES.setPerf` before the attach, `?texmax=` → `createGL`'s `maxTex`, `watchDpr` → `FACES.recheck()`, `?gltest` from the parent URL
— never committed; MB = 10⁶ bytes, MiB in brackets):

| | High | Medium | Low |
|---|---|---|---|
| s55 at rest (fit, 25 %): faceBytes | 72.6 MB (69.3 MiB) | 40.9 (× 0.563) | 18.2 (× 0.251) |
| s55 at 150 % | 108.8 | 61.2 | 18.2 (no window) |
| s55 zoom 60 → 150 → 60 %, at the rests: paints · window MB | 12 · 36.2 (20.5 ms) | 12 · 20.3 (× 0.56; 18.2 ms) | **0 · 0** |
| hw5 at rest | 180.1 MB (171.7 MiB) | 101.3 (× 0.5625) | 45.0 (× 0.25) |
| hw5 at 150 % · paints in the cycle | 195.8 · 1 | 110.1 · 1 | 45.0 · **0** |
| G3 `&texmax=4096` (hw5): the largest upload side · faces gl · probe | 4096 (OB-Xa 4096 × 1776, Jupiter-8 4096 × 1696, CS-80 4096 × 1657) · 5/5 · lit | 4096 · 5/5 · lit | 2432 · 5/5 · lit |

The live switch on s55 at 120 % (High: 135.3 MB, 38 bases + 15 windows): → Low 18.2 MB (38 rasters, no window, the peak the start),
→ Medium 76.1 (38 + 15, peak 76.1), → High 135.3; again with a 40-frame pinch started 3 frames after each switch: the same end
states, the same raster counts (no thrash); **0 frames with a gl face's SVG showing** (≈ 1 000 frames watched); a forced context loss
+ restore at Low → 18.2 MB, at Medium → 76.1, every face gl; no console error anywhere. The G3 probe: each face framed in turn, 9 × 9
GL pixels (the preserved buffer) — 77–81 of 81 lit on every face (the rest dark art), none black. Screenshots (scratchpad
`P/t/`): s55-{high,medium,low}.png, s55-150-{high,medium,low}.png (Low visibly softer at 150 %), hw5-{…}.png, g3-hw5-{…}.png,
switch-low-120.png; the JSON results beside them.

**Interfaces for C / H**: `import * as FACES from './cv-face.js?v=9'` → `FACES.setPerf(id)` (the named export; returns changed;
detached: kept for the next attach — so cv-world may call it before its `attach`), `FACES.FACES.perf`; `FACES.stats()` keys + `perf`,
`dE`, `budget` (→ glStats `faceBudget`), `texSide`, `under`, `underMin`; `FACES.recheck()` re-plans after a device-ratio change (a
stale base re-rasters at the rest). `createGL(viewport, { …, maxTex })` (positive whole px; garbage ignored; never raises), `GL.maxTex`
(read once); `GL.ready` false after an upload saw the context lost. Pure: `TEX_Q`, `perfId`, `dEOf(dpr, id)`,
`baseLevel(d, w, h, max)`. H: no FACES call besides `world.setPerf` (C's) is needed.
### Lane C
(cords + world; base 4cc0936; `cv-cords.js`, `cv-world.js`, `tests/cv-cords.test.mjs`, `tests/cv-world.test.mjs`; scratch `P/c/`)
Commits 78d37bd (the cords), 45576ff (the world), these notes.
- **`cv-cords.js`** — `CORD_Q` [C names]: `high` { q 'full', N 10, SUB 4 } = STUDIO (34 drawn points), `medium` { 'light', 6, 3 }
  (14), `low` { 'still', 6, 3 } — still = today's reduced-motion path (`motion()` false: no ticker, no step, pluck a no-op, the
  parabola from the ends) at 6 / 3; `perfOf(id)` (anything else, `'toString'` too, → 'high'). `o.perf` at creation, `setPerf(id)`
  live: every rope made again at the quality's N and **re-seeded asleep from its parabola** (no stale rope, no jump: A0 = the ends,
  so the next advance wakes nothing; the live rope re-seeded awake as `live()` does), `running` false, the strip rebuilt whole,
  one draw asked for; the same id: nothing. Per-layer `PTS`; `place` / `live` make ropes at the quality's N; `pointAt` / `pluck` read
  it. The SVG fallback keeps STUDIO's 10 / 4 (§1.2). Prefers-reduced-motion still at every preset, at that preset's geometry (High
  10 / 4 as today). `stats()` + `perf`, `quality`, `pts`, `fulls` (whole builds), `writes` (cords written), `runs` (bufferSubData
  calls), `buildMs` / `buildMax`; `get perf`.
- **P-1 (c), the fixed vertex ranges**: cord j of the drawn list (the cords' Map order, the live rope last — the one strip's
  order) owns vertices from `off(j) = j·(2·PTS + 2) − 1` (0 for j 0): its lead join (j > 0: its first vertex twice), its 2·PTS, its
  trail join (not the last: its last vertex again) — concatenated, **the same vertex sequence the whole build always wrote** (the
  previous cord's last vertex, then this one's first twice); plugs at instances 2j, 2j + 1, the probe after them. A frame rewrites
  only the queued cords (`DQ`): advance flags a rope it stepped or whose ends moved (`r.mv`, a flag only — the physics untouched);
  a recolour, a selection change queue theirs; an `anchors` / `grab` / `live` / `set` change no advance has read yet is found by a
  scan of the placed cords' ends against those written (`scanOwed`, once a build). **Whole** (as before) when the layout changes:
  a cord added / removed / placed / its ends coming or going, the live rope coming, going or taken, the quality, motion (reduced
  flipping) or the probe's presence, a growth, a context restore (`upFull`), a build never uploaded. The upload: the dirty ranges
  sorted, neighbours within `RUN_GAP` 4 merged, past `RUN_MAX` 16 runs a buffer the gap doubled — a sway of every cord is one
  call a buffer. `o.full` (diagnostics) = the pre-P-1 path, every build and upload whole (the equality twin, the bench's
  "before"). [C, beyond P-1's text] **the awake-only advance**: while no end can have moved since advance last read every rope
  (no `changed()` / relist / pluck), an asleep rope's advance is a no-op (same ends: no wake, no step, no flag), so the step
  advances only the awake ropes (two arrays in turn, no allocation a frame) — a sway costs its awake ropes, not every cord. Both
  proven bit for bit by the hash below.
- **Tests (cv-cords 24 → 34)**: CORD_Q / perfOf; medium's rope = LAB's Cord at "Points per cord" 6 bit for bit (1 / 30 / 240
  steps, difference 0); the layer at each preset (perf / quality / pts / the strip's vertex count); low = still (no step, no frames,
  a moved end re-paths **only its range**, a live rope never stepped); setPerf with every cord swinging (each switch → asleep, the
  next draw every cord's parabola at the new N / SUB within 1e-3 px, no rope moves after it, no frames; same id: no build; a live
  rope re-seeded awake and taken over); reduced motion still at every preset. **High = today, byte for byte**: a scripted scene
  (24 cords: a sway with the camera moving, a module drag, selection, a recolour, a cord removed and one added, the probe on a
  dragged module, a live rope taken over, a pulled plug, a context loss / restore, an end unknown and back, alloc off / on, then
  reduced motion and 'under') on a fake WebGL2 context that models its buffers (bufferData / bufferSubData into byte arrays; every
  draw call hashes the bytes it reads + its uniforms): its hash **computed on the base 4cc0936** (scratch `P/c/scene.mjs` against
  `git show 4cc0936:cv-cords.js`) = `26d33782…ab2b`, and the lane's code gives it (17.7 → 10.6 MB uploaded in the scene); the
  `o.full` twin too. **Every preset = its whole-rebuild twin**: the scene at medium, at low, with live switches high → medium →
  high → low → medium ('under' → low) — hashes equal. **4 096 cords**: one rope swaying uploads one range a frame — High 70
  vertices + 2 plugs = **2 000 B** (before 7.8 MB), medium **880 B** (3.4 MB), 2 calls; a module drag of 8 cords 8 ranges a frame
  (High and low); runs ≤ RUN_MAX (all 512 dirty: 1 call a buffer; 40 scattered: ≤ 32). Recorded (node, M4, `--no-sparkplug`, ms a
  frame, before → now, KB a frame):

  | one rope swaying | 128 | 512 | 2 048 | 4 096 |
  |---|---|---|---|---|
  | high | 0.153 → 0.009 (250 → 2) | 0.423 → 0.010 | 1.61 → 0.018 | **3.23 → 0.034** (8 000 → 2) |
  | medium | 0.055 → 0.005 (110 → 0.9) | 0.234 → 0.007 | 0.885 → 0.016 | 1.71 → 0.027 (3 520 → 0.9) |
  | **a module drag (8 cords)** | | | | |
  | high | 0.139 → 0.053 | 0.48 → 0.124 | 1.87 → 0.415 | 4.05 → 0.789 (8 000 → 15.6) |
  | medium | 0.086 → 0.059 | 0.297 → 0.108 | 1.22 → 0.398 | 2.43 → 0.716 (3 520 → 6.8) |
  | low | 0.054 → 0.014 | 0.208 → 0.038 | 0.836 → 0.140 | 1.75 → 0.308 (3 520 → 6.8) |

  A drag's remaining cost is reading every cord's ends once a frame (advance at high / medium, the scan at low): the host relays
  the **whole** ports map at each relay (cv-module `ports()` rebuilds it, itself O(jacks)), so which cords moved is only known by
  looking — O(changed) needs a hint from the host (the module that moved): **for the lead**, outside lane C.
- **`cv-world.js`**: `PERFS`, `PERF_PREF` ('synth.cv.perf'), `perfOf` (cv-cords') exported; `o.perf` at build, **`?perf=high|medium|low`
  over it** (the lead's brief: read beside `?nogl`; never stored — the world writes no pref); `world.perf`; `world.setPerf(id)` →
  `FACES.setPerf` (guarded while cv-face has none) + the cords' `setPerf`; `FACES.setPerf(perf)` also at build, before the GL layer
  attaches the faces (the registry is global: every world sets its own); `cords()` built with `perf`; `glStats()` + `perf` (the
  world's), FACES' `budget` → `faceBudget` (its `dE`, `under`… pass through). `?texmax=N` (1–6 digits, > 0) → `createGL(…, { maxTex })`
  (absent otherwise: the fakes' options unchanged). The device-ratio watch: `resize(); watchDpr(); facesRe()` — `facesRe` calls
  **`FACES.FACES.recheck()`** (the registry object's rest-time recheck: offsets, the overlap rule, then its `plan` — where T finds a
  base made at the old ratio), not the namespace's `recheck` (the overlap rule only); never in a burst (its end plans them).
- **Tests (cv-world 71 → 75)**: the preset (o.perf, unknown → high, ?perf= over it in six URL forms, nothing stored, cords() built
  with it, setPerf to the layer; with T's cv-face the FACES half: `FACES.stats().perf` follows, `faceBudget` in glStats — a
  diagnostic until the merge); ?texmax (seven URL forms); a device-ratio change (a fake matchMedia's 'change', no camera written):
  a registered face's offset read again, the GL buffer and the cords at 2×, the watch moved to the new ratio, nothing in a burst,
  destroy removes it (failing without the call: checked); the real cv-cords through the world at medium / low (low: a module drag
  is no rope-step and no frame left owed, the cord's end on its plug; setPerf mid-sway: asleep at once, one draw, no frames). The
  glStats key pin moved to the new truth (today's keys + `perf` + FACES' own renamed — exact, not loosened).
- **Gates** (one file at a time, 2048 MB): `cv-cords` 24 → **34** · `cv-world` 71 → **75** · `cv-patch` 28 · `canvas-9-sim` 22 ·
  `canvas-9b-sim` 14 · `canvas-1e-sim` 24 · `gesture` 53 · `lint` 161; also `cv-face` 28, `main` 46, `canvas-1i-sim` 20, `canvas-sim`
  24. With lane T's `cv-face.js` / `cv-gl.js` (its worktree, scratch merge `P/c/mergeT/`): `cv-world` 75 / 75, the FACES half run.
- **Headless Chrome** (155, `--headless=new --use-angle=metal`, dpr 2; the worktree copied to `P/c/site/`, `pc.html` = index.html with
  `window.__synthTest = {}`, served on 8971 no-store, CDP 9471, the service worker bypassed; `P/c/run.mjs`, `big.mjs`): the **System
  55** tile (37 modules, 24 cords) at `?perf=high / medium / low` → `world.perf`, `glStats().perf`, the layer's quality / pts (1 678
  vs 718 strip vertices). **Every cord plucked** (1× / 4× / 6×): frame intervals 16.7 / 16.7 / 16.8 ms, no frame > 33 ms, one cord
  draw a frame (0 doubles); uploads a frame with all 24 awake **46.8 KB** (high) / **20.6 KB** (medium), 2 calls, 0 whole builds.
  The physics in this renderer (advance, 40 ropes awake): full 0.094 / 0.343 / 0.528 ms, light 0.044 / 0.183 / 0.280 (× 0.47 / 0.53
  / 0.53 — G5's ≤ 0.6); the layer's whole `step()` in node (high-res clock), 24 / 40 awake: 44 / 74 µs vs 23 / 39 µs (× 0.53). (The
  in-app means — 0.066 / 0.133 / 0.21 ms high, 0.047 / 0.102 / 0.168 medium — are read on Chrome's 0.1 ms `performance.now()`: ×
  0.7–0.8; reviewer 2's G5 should read a longer window or the physics.) **A module drag** (the 904A, 4 cords, 24 mouse moves): high
  11.7 KB, medium / low 5.1 KB a frame; low **0 rope-steps**, 17 draws (the relays); the dragged cords' ends on their plugs (0 px);
  **at rest after it, every preset and rate: 0 world ticks, 0 rAF requests** (but main.js's own `frame` loop, every frame, not the
  canvas's), 0 cord steps / draws, `wants()` false. **Glue** (a cyan ring in #world at an empty jack, the layer's magenta probe disc,
  one screenshot): mid-pinch with every cord swinging ≤ **0.411** device px (1440 × 900), ≤ **0.474** (1366 × 1024); **the live
  switch** High → Low → Medium → High with every cord swinging: right after each, awake 0, running / wants false, no step or draw
  in the next 0.8 s, the glue ≤ 0.348 / 0.271 device px. **4 096 cords on a second real layer** (one rope swaying; low: a drag of 8),
  JS a frame before → now: high 2.65 → **0.051 ms** at 1×, **14.5 → 0.079 ms at 6×** (13 frames > 33 ms → 1); medium 6× 10.3 → 0.085;
  low (drag) 6× 9.43 → 2.36 (the ends scan above). No console error or exception in any run. Screenshots `P/c/shots/`:
  `P-s55-{high,medium,low}-rest.png`, `-dragged.png`, `-glue-pinch.png` (high at 1366 × 1024, the others 1440 × 900),
  `P-s55-switch-to-{low,medium,high}.png`.
- **For lane H**: pass `createWorld(…, { perf: store.get(W.PERF_PREF, 'high') })` and do **not** call `setPerf` at boot (it would
  override `?perf=`); show `world.perf` in the select (the URL's value is never stored: store only the person's change, then
  `world.setPerf(v)`). `W.PERFS` / `W.perfOf` for the options and the guard. ui-bench: `&perf=` / `&texmax=` must reach the app
  frame's own `location.search` (cv-world reads it). **Note**: ui-bench-m9's s55 / s55w scenes draw their cords with the bench's
  own prototype layer (`createCords(S, …)` in tests/ui-bench-m9.mjs, spike (c)), not cv-cords — G5 read there sees no preset; it
  should read the app's `cords().stats()` (perf, quality, steps, stepMs, uploadBytes / uploads, fulls).
### Lane B

Commits on the lane-B worktree branch from 4cc0936: **76b942a** (the warm payload list pinned on the base), **101ea7c** (the bounds, `isMid` / `isCid`, the linear host paths, the evaluator's guards, `WARM_C`), **6228684** (song.js, the device refusal, schema 13, the Pads bound, `setFull`, the moved pins), then the notes commit (+ the guards line in patch-dsp's header). No `sw.js` (the lead runs `node tools/precache.mjs --write`; `tests/pwa.test.mjs` is red until then).

**What changed** (the contract's §3, row B; every [C] kept):
- patch-core: `MAX_MODS` 512, `MAX_CORDS` 4096, `MAX_CONN` 8192, `MAX_NID` / `MAX_CID` 1e6 (ids m1…m999999, c1…c999999); `isMid(s)` / `isCid(s)` (the one grammar: `midNum > 0`); `canPlug`'s rules split into `verdict(…)` with the cord lookups injected, `targets()` reads the cords once (a plugged-ends set, the driven groups memoised per multiple: output-identical, linear); `ordinal` from one sorted pass per record, memoised on the record's `mods` object (a record is never mutated once handed out — every edit copies `mods`: the invariant is a test); every module id parsed once per sort (`sortKeys`, also under `payload`); `freeSlot` searches `FREE_LINES = 2 + ⌈MAX_MODS / 2⌉` lines (258).
- patch-dsp: `MAXM` 1024, `MAXC` 8192, a third guard `MAXN` 999999 in place of `e[0] <= 4096` (also in the frozen `PatchDSP` object); nothing is sized by them. engine: `const WARM_C = 256` used at both warm sites; the warm payload list is byte-identical (119 payloads, sha256 pinned in engine-track **before** the first edit, 76b942a).
- moog-core: makeSet's numbering uses a leaf mirror `midN` of `isMid` — **the table cannot import patch-core (a cycle: patch-core imports it)**; a test holds the two equal over a table of ids. **A site the skeptic missed**: `pvOf` (moog-core.js:534) filtered the values to `/^m\d{1,4}$/` — a module numbered ≥ 10000 would have played on its defaults; fixed with the same mirror and tested end to end (a Classic bass numbered m4096 … m999999 renders bit for bit as numbered m1…12, `tests/moog-dsp.test.mjs`).
- cv-patch: `midOf` → `PT.isMid`.
- song.js: `DEV_MAX` 1024, `WIRE_MAX` / `MODROW_MAX` / `LAY_MAX` 4096 (exported). cv-model: `devFull(t)` ('A track holds at most 1024 devices' | ''), `DEV_MAX`; `addModDev` / `addPanel` / `addInst` return null at the bound, `setModel` Serum → classic (it unfolds a panel: one more device) returns `{ ok: false, why }` before touching anything; `addModDev`'s per-key `new RegExp` hoisted. cv-migrate: `SCHEMA` 13, `STEPS[12]` the identity. pads-core: `MAX_MODS` 64, `PAD_ID` / `padOfSrc` built from one `PAD_NO` (pd1…pd64); cv-cables (`keyKind`, `modSrcPort` through `padOfSrc`) and cv-mods (`padMods`) use them. cv-tray: `setFull`'s default is `MAX_MODS`.

**The 65th device, proved first** (scratch `P/b/dev65.mjs` on the 9dde7e6 tree): 80 `addModDev` calls → 83 live devices → **64 after `deserialize(serialize())`** (the loss is in `normDev` at a load: autosave reload, file open); **the History / undo path is unaffected** — `History._load` is `JSON.parse` and `applyRestore` runs no `normDev` (83 after undo): the contract's "or undo" does not hold. The failing test is in `tests/cv-migrate.test.mjs` (`P song.normDev …`) and `tests/cv-model.test.mjs` (`P devices …`).

**Tests** (each pin moved to the new truth, none weakened): patch-core (bounds at 512 / 4096 / 8192 with the new texts; 6-digit ids; the id grammar table against moog-core's mirror; **`tests/ref-P/`** = patch-core / moog-core verbatim at 9dde7e6 + MANIFEST sha256: `ordinal`, `targets`, `title`, `freeSlot`, `payload` (± vals), `normPatch`, `canPlug`, `rackLayout`, `live` / `liveNodes`, the sets and the 13 presets equal to it over 120 generated records inside the old bounds (D6), and to their old definitions at 128 / 256 / 512 modules / up to 4096 cords; the memo-staleness invariant; the host paths timed with a loose guard; freeSlot past 64 lines; the grep test); patch-dsp (1024 modules and 8192 connections exactly, one more is 'limit'; numbers to 999999, 1000000 and non-integers 'mod'); moog-dsp (the renumbered patch); engine-track (warm hash, ≤ 256 connections and ≤ 64 modules a warm payload); cv-migrate (schema 13 against a schema-12 store gate; the 9b project through `deserialize` byte for byte — sha256 pinned on 9dde7e6, `P/b/pin9b.mjs`; devices / wires / rows / layout bounds; History); cv-model (devices); pads-core / cv-cables / cv-mods (pd64 valid, pd65 not); cv-tray (`setFull`); cv-patch (`midOf`). Sims: canvas-9-sim / canvas-9b-sim fill a patch to the bound by **opening it as a project** (`applyRestore(cv.loadProject(…))`), not 500 taps (a 474-tap loop and its undos were 70 s a test), keeping one real tap to the bound and one refused tap with its notice; canvas-7c / -8 / -9 / -9b: schema 13 / 14 pins; canvas-8: 64 Pads modules.

**Timings** (M4 Max, node 24 / V8 and the macOS `jsc` shell; one process each, scratch `P/b/`; recorded, not gated). *The evaluator's `graph()`* — a plug flip (A ↔ B: one cord pulled), median (max) ms, back to back, V8 | JSC; *wide* = 3-module voices into MAIN OUT (fan-in), *deep* = one chain:

| modules | wide V8 | wide JSC | deep V8 | deep JSC | a 128-frame quantum at OS 4, wide / deep, V8 (deadline 2.667 ms) |
|---|---|---|---|---|---|
| 128 | 0.48 (1.70) | 0.52 (1.84) | 0.31 (0.79) | 0.41 (0.54) | 0.91 / 1.04 |
| 256 | 0.68 (1.56) | 0.86 (1.74) | 0.49 (0.87) | 0.60 (0.74) | 1.81 / 2.06 |
| 512 | 1.21 (2.52) | 1.89 (2.72) | 0.96 (1.47) | 1.06 (1.77) | **3.61 / 4.14** |

(JSC quanta 0.98 / 0.98, 1.66 / 2.00, 3.38 / 3.99.) The first `graph()` of a fresh machine at 128 wide is 3.6 / 5.0 ms (cold JIT), ≤ 1.7 ms beyond. So `graph()` is near-linear in practice (the schedule's quadratic pick does not show at 512; the contract's "≈ × 13 again at 512" fear does not materialise: 1 – 1.9 ms median at 512, 0.3 – 0.7 at 128 – 256), but the render is the limit: **a 512-live-module rack costs 1.3 – 1.5 × the quantum's deadline at OS 4 on an M4 Max, so it does not render in real time** (256 modules: 0.7 – 0.8 of it) — the user's "until their system lags", with the DSP-load safeguard lowering the Oversampling as it does today (§11).
*Host paths of patch-core* (node, ms; records of 37 / 128 / 256 / 512 modules with 41 / 168 / 338 / 667 cords): every module's title 0.045 / 0.11 / 0.19 / **0.37** (9dde7e6: 0.16 / 1.8 / 6.9 / **26.9**); `targets()` 0.14 / 0.28 / 0.51 / **0.93** (0.22 / 1.4 / 4.3 / **14.4**); `payload` 0.18 / 0.50 / 0.92 / 1.7; `liveNodes` 0.13 / 0.56 / 0.88 / 1.7; `live` 0.12 / 0.38 / 0.71 / 1.4; `rackLayout` 0.03 / 0.08 / 0.16 / 0.32; `freeSlot` 0.06 / 0.21 / 0.24 / 0.61; `jacksOf` 0.03 / 0.03 / 0.06 / 0.14; `normPatch` (a load) 0.07 / 0.23 / 0.42 / 0.71. Nothing is over a frame at 512 on the Mac (the largest, `payload` / `liveNodes`, 1.7 ms: ≈ 12 ms at × 7). At 512 modules and 4096 cords (the test's generated record): titles 1.0–1.2 ms cold, `targets()` 0.8–0.9 ms.

**For lane H**: (1) the two host `/^m\d{1,4}$/` sites (main.js:6784 `sq`, 6839 `pm` event post) → `PT.isMid`; then **delete `LEFT = { 'main.js': 2 }`** in `tests/patch-core.test.mjs`'s grep test (it allows exactly those two). (2) The device-add notice: `CMOD.devFull(t)` returns the reason ('' when there is room) — check it in `modAdd` before `hist.record` (main.js:7307ff.; `CMOD.addModDev` returns null at the bound, which today reads as "already there"), and show `why` from `CMOD.setModel`'s `{ ok: false, why }`; `addPanel` / `addInst` return null (their callers must say why — `devFull`). (3) The bound texts come from constants already (`PT.MAX_MODS`, `PC.MAX_MODS`); comments at main.js:2084 / 5336 still say 8 / 48. (4) `CMOD.DEV_MAX`, `PT.MAX_CONN`, `PT.isCid`, `S.DEV_MAX / WIRE_MAX / MODROW_MAX / LAY_MAX`, `PC.PAD_ID` are the exported names. (5) A sim that needs a full patch should open it as a project (`api.applyRestore(cv.loadProject(json))`), not tap it up. (6) Schema is 13 (`CM.SCHEMA`); tests that pin `[…, 12]` moved. (7) `tests/pwa.test.mjs` fails until `node tools/precache.mjs --write`. (8) The Pads tile / notice text reads `PC.MAX_MODS` ("64 Pads modules in this project").
### Lane H

(host; base 6dc86f3 = T + C + B + canvas's tray / tabs change; `main.js`, `index.html`, `style.css`, `tests/canvas-P-sim.test.mjs`
(new), `tests/main.test.mjs`, `tests/patch-core.test.mjs` (the `LEFT` line only); scratch `P/h/`.) Commits d856bf9 (the sim, failing
first: the device-add notice, m10000's binds), 56aae26 (the host), 8c3029b (main.test's Panic, D2), 6306f70 (a refused Replace from
the tray), 3ff1a5e (the top row's widths), these notes. No `sw.js`.
- **The preset** (`main.js`, beside `initWorld`): `perfPref()` = `W.perfOf(store.get(W.PERF_PREF, 'high'))` — anything stored
  but high / medium / low is High; `createWorld(…, { …, perf: perfPref() })`, never `setPerf` at boot (`?perf=` is the world's,
  over it). ⚙ → Canvas, first under Pinch on canvas: `label.field.cv-perf` "Performance" + **`select#cvPerf`** ([C]: `#perf` is
  the keyboard tray's id since 1b) High · Medium · Low from `W.PERFS`, then `p#cvPerfHint.cv-ghint` (the select's
  `aria-describedby`): "Lower settings draw panels and cords more simply, for slower tablets. Sound is unaffected." (the lead's
  line; the title says the rest — Medium / Low softer up close, cords simpler / still, visual only, Oversampling never changes).
  `perfUI()` shows the world's `perf` (so `?perf=` shows; `cvW()`: a sim's scripted world too), else the pref — after `initWorld`
  and at every ⚙ open; `perfPick(v)`: `store.set(PERF_PREF, perfOf(v))`, then `cvW().setPerf` — the person's own pick only is
  stored. Nothing else: no project field, no History, no worklet message, `settings` (Oversampling) untouched.
- **The top bar's Panic** (the user's decision): `button#tPanic.tb.cv-panic` in `#transport` after the ▶ ● group, outside the ⋯
  fold, `aria-label` "Panic (stop all sound)", title "Panic: stop all sound (Esc)", an octagon-and-"!" icon in the row's `.tb`
  style (the coarse-pointer hit area of every `.tb`; pressed: the record button's red); `onclick = panic` — the keyboard bar's
  Panic (kept) and Esc are the same function. **[C] Room for it**: the row stays one row at every width (601–1440 measured), but
  the 40 px came out of the track chip, which fell under its finger's 44 px and slid under CANVAS │ ROLL at 741–770 and 601–620
  (chip room 15 px at 744, 25 at 601). So the position readout (display only) now folds from **800 px** (was 740: iPad mini
  portrait 744 and 768 lose it; the chip there 95–115 px, was 53–73) and at **≤ 640 px** the row's gaps close to 3 / 2 px (chip
  ≥ 45 px down to 601; below 600 the row scrolls, Panic near its start). `P/h/chip2.mjs` / `widths.mjs`.
- **The bounds through the host** (B's hand-off): `modAdd` — `CMOD.devFull(t)` said before `hist.record` (the wheel is the
  project's: not asked); `cvAddInstrument` — the same, and a null `addInst` prunes its step; `setTrackModel` — a Serum → classic
  Replace on a full track asks setModel's rule first (`iv.model === 'serum' && id !== 'serum'` → `devFull`), says it, returns it; if
  setModel refuses after all its `why` is said, the name put back, the step pruned; `cvDropInstrument` (the tray's Replace) sees
  the model unchanged and shows no "Replaced …" notice. The event / sequencer binds (`ptEdit`'s `sq`, `ptEv`) read `PT.isMid`;
  `LEFT` deleted from patch-core's grep test; the stale comments (2084 "8 Pads", 5336 "48", the Controllers tile's "8th") name the
  constants. `addPanel` has no host caller.
- **Tests** — `canvas-P-sim` (7, accessor-free, the real cv-world on the stub DOM — its cords on the SVG path, `glStats()` null in
  node): the line, its options, its hint, High on a fresh device, nothing stored; a pick live in the world, `FACES.FACES.perf`
  and the cords' quality, stored per device, the project and History untouched, **no worklet message at any switch** (a control
  interval first), settings / Oversampling untouched, an unknown value → High; the heavy notices' lines equal at every preset; a
  System 55 + 30 modules (opened as a project): no module or set tile greyed, a tap adds one more; a full track (1024 devices):
  a modulator by tap and by drop, an instrument, a Serum → classic Replace (setTrackModel and the tray's) refused with
  "A track holds at most 1024 devices", no step; room again → added; a 960 numbered **m10000** (nid 10000, by the tap): SET 1
  posts `pe [10000, 3]`, Step bass binds it → `['pg', 'pe 10000,0']`; `?perf=low` over a stored Medium (shown, Medium kept), a pick
  after it stored, a reload reads Medium, a stored "turbo" → High. Failing first (d856bf9 on the base): the notice ('' — a silent
  null) and `ptEv(…'m10000'…)` false. `main.test` + 1: `#tPanic`'s markup, place and CSS (no rule hides it), `= panic`, a held key
  on a Minimoog with the keyboard folded: sounding (0.26), `{t: panic}`, silent 0.4 s on (< 1e-5: the 5 ms fade, then the output
  stage's DC-blocker settling ≈ × 0.08 every 100 ms); Esc posts the same.
- **Gates** (one file at a time, `--max-old-space-size=2048`, peak RSS): canvas-P-sim 7/7 (0.40 GB) · main 47/47 (1.62) · patch-core
  46/46 · canvas-sim 24 · canvas-1e-sim 24 · -1i 20 (0.94) · -2a 26 · -2b 23 · -3 27 (1.40) · -7a 23 · -7b 15 · -7c 13 · -8 17 · -9 22 ·
  -9b 14 · cv-shell-sim 17 · cv-fixes-sim 5 · keyboard 14 · cv-tray 40 · integration 44 (1.72) · lint 161 · pwa 22 (after
  `node tools/precache.mjs --write`, then `git checkout sw.js`); every golden as a guard, all green: golden-classic 8, -fx 3, -presets 8,
  -random 1, -graph 6 (2.33 GB), canonical-stream 1, golden-drums 5, -606 11, -909 9, -sdsv 5, golden-moog 6, golden-moog-b 6.
- **Headless Chrome** (155, `--headless=new --use-angle=metal --force-device-scale-factor=2`, CDP 9473; the worktree copied to
  `P/h/site/`, served no-store on 8973, `pc.html` = index.html with `window.__synthTest = {}`, the service worker bypassed;
  `P/h/run.mjs`, results `run.json`): a fresh device's System 55 (1440 × 900) **High**: faces 72.6 MB (38 gl, dE 2), cords full / 34
  points. ⚙ open: Canvas → Pinch on canvas · **Performance** · its hint · Load estimates · New Serums open as. Each switch made
  with **every cord swinging** (24 awake, running) through the select's change: → **Medium** 40.9 MB (dE 1.5, budget 216 MB),
  light / 14 points; → **Low** 18.2 MB (dE 1, 96 MB), still / 14; → **High** 72.6 MB again (Low's cords are still: nothing to
  pluck before it) — right after each, awake 0, running false; **0 frames with a gl face's SVG showing** (≈ 76 frames watched a
  switch). Medium picked → a reload: Medium (40.9 MB, light); `?perf=low` → Low shown, 18.2 MB, the store still Medium; no
  parameter → Medium. 1366 × 1024 touch, a fresh Minimoog: ⏻ by a click, the keyboard folded (its bar's Panic off screen), a
  held computer key (`a`) — RMS 0.154 at an analyser on the track's node, `held` 1 — **a touch tap on the top bar's Panic**: RMS 0,
  `held` 0. Plain `index.html?perf=low` (no hook): ⚙ shows Low. **No console error or exception** in any step. Screenshots `P/h/shots/`:
  `h-1440-s55-high.png`, `h-1440-gear.png`, `h-1440-s55-{medium,low,high}-after-switch.png`, `h-1440-s55-medium-reloaded.png`,
  `h-1440-s55-url-low.png`, `h-1366-panic-held-folded.png`, `h-1366-panic-after.png`, `h-1366-gear.png`, `h-1440-index-low.png`,
  the row at `h-row-{1024,834,744,375}.png`.
- **Not in this lane's brief, for the lead / reviewer 2**: §6's row H also lists `tests/ui-bench.html` + `tests/ui-bench-m9.mjs`
  (`&perf=` / `&texmax=` into the app frame's own `location.search`, G9's zoom cycle, G5 read from the app's `cords().stats()` —
  lane C's note); the brief left them out, so they are untouched.
### Reviews and fixes
Two reviewers against 4f1fde1 (findings files in the lead's scratchpad: `P/review-1.md`, `P/review-2.md`).
- **Review 1 (real engine + data)**: 1 major · 2 nits. **D1 / D2 / D6 hold**: every frozen golden, canonical-stream, the ref-9-core
  pin, ref-P (byte-identical to 9dde7e6), the warm list (119 payloads, the same hash recomputed on 9dde7e6); a preset switch during
  playback posts nothing (the message stream equals a run without switches); 128 / 256 / 512-module patches (wide, deep, random, up to
  3 563 cords) normalise, round-trip and render finite; refusals at every bound with their reasons; six-digit ids end to end; 87
  devices round-trip (the 65th-device load bug fixed), 1 024 kept; 64 Pads; a schema-13 file opens read-only in the 9dde7e6 build,
  byte-identical after its autosave window. **F1 (major)**: the evaluator's Tarjan recursed one frame per node on the audio thread — a
  legal 512-module 961 / CP35 chain threw RangeError at a 512 KB stack (JSC), escaping the Track's handler silently → **fixed**
  (fixer 71e1fb5): `strong` iterative (same visiting order; 2 000 random patches × 2 densities: schedules, graphs, monitors and rendered
  samples identical; a sabotaged copy caught), both `pm.graph` sites caught → `ptFail('graph')`; the failing test runs the chain in a
  child `node --stack-size=200`. **F2 (nit)**: `makeSet` past m999999 → returns null (patchNew falls back to the controller alone).
  **F3 (note)**: feedback-heavy racks cost more than lane B's figure (§11).
- **Review 2 (headless Chrome, 1× / 4× / 6×, dpr 2 / 1.5, `?texmax=4096`)**: 2 major · 4 minor · 2 nits. **Fine**: a fresh device on
  High, the pick stored per device, `?perf=` not stored; 0 worklet posts and no History step per switch; G2 (System 55 at rest, dpr 2:
  72.6 / 40.9 / 18.2 MB; at 150 %: 116.4 / 65.5 / 18.2); G3 (16 panels × 3 presets at texmax 4096: all GL, every side ≤ 4096, 81 / 81
  probes lit); G7 (≈ 4 900 watched frames, 0 with a GL face showing its SVG — cords swinging, 8 switches a frame apart, a pinch mid-queue,
  a cold load, the ROLL tab); a forced context loss at each preset; G9 (Low: 0 paints across a zoom cycle at 1× / 4× / 6×); the pull
  tabs, Panic (no overlap 1440 → 600 px; legible at dpr 1 / 1.5 / 2), the "+" menu's estimates, no right-hand tray, no console error.
  **Fixed**: **F1 (major)** a rack past the face budget never idled (two off-screen faces rastered / uploaded / evicted ≈ 7 times a
  second) → fixer A (125cb56): the budget is decided before anything is freed (`pool` / `roomFor`), a base that cannot fit is left out
  (`F.blk`) and re-asked only on a rest / screen / preset / landing / free; 200- and 511-face repros settle to 0 paints. **F2 (major)**
  every edit on a big rack was O(n³) (`V.sync` → `world.update(k)` per module → `FACES.recheck()` each; 3.1–3.3 s at 511 modules) →
  fixer B (2f86d36): `world.update(ids)` batched, one update per sync, Tidy once per sync while its inputs hold (node: 511 modules 1 719 →
  7 ms a sync). **F3 (minor)** two synchronous `getError` per upload → one, after it, a retry telling a stale flag from ours (fixer A).
  **F5 (minor)** 4096-texture devices lost the High window from ≈ 100 to 190 % → `winFit` shrinks the margin to fit the side, `under`
  counts a side-limited face (fixer A; 76 face / viewport cases all windowed). **F6 (minor)** ui-bench could not run per preset →
  a real-URL frame when `&perf=` / `&texmax=` / `&nogl` is given, the app's own cord layer behind the m9 scene, the preset recorded in
  the results (fixer C, 7511c71). And the host now **shows** `ptErr 'graph'` ("This patch is too complex to run — the last working
  version stays in use", once per burst). **Recorded, not fixed**: **F4** — G6 is not met in Chrome: a cold face costs the same
  main-thread ms at every preset (the SVG paint record dominates; the pixel work is the GPU process's, which CPU throttling cannot slow)
  and Medium's rest paints cost High's ms — the presets' proven wins are memory (G2), Low's zero rest paints (G9) and the cord work;
  §1.3's "CPU raster × 0.25" does not hold for Chrome (§11). **F7 (nit)** the Sources tab starts at x 0: in a browser a pull there can
  start iPadOS's back-swipe — not moved (the user: never move layout for browser chrome; the standalone app owns the edge). **F8 (nit)**
  the track chip is 45–65 px at 601–641 px wide (≥ 44, no overlap).
### Acceptance
- Holding branch `wt-P` (lanes T 099f351, C 062f717, B 6c7781a, H b5ca720; fixers 71e1fb5, 2f86d36, 7511c71, 125cb56), canvas merged;
  `node tools/precache.mjs --write`; the sweep: every test file, one at a time (§12 record in the commit). No new frozen refs (visual
  only); `tests/bench.json` gains `"ui-P-mac"` (review 2's record at 4f1fde1, before the fixes). Squashed onto `canvas` as "P" and
  deployed 2026-10-22.

## 13. Review log

### The skeptic review (2026-10-22, against c202c21)

Every claim about existing code was read at c202c21 (its code = 9dde7e6's: the contract commit and the two ROADMAP commits add docs
only). Three scratch measurements (not committed; the session scratchpad's `P/skeptic/`): `hostpaths.mjs` (patch-core's host paths on
records built past the old guards, 37–512 modules), `cordbuild.mjs` (the real cv-cords layer on a fake WebGL2 context: one rope swaying
among 128–4 096 cords), `still6.mjs` (Low's still path at 6 / 3 against today's 10 / 4); node 24, M4 Max, one at a time,
`--max-old-space-size=2048`; no test was run. **Settled before or during the review** (not reopened, written into §10 / §2 / §9): the
user's answers — no Auto, every device starts on High; ⚙ Settings only; Low never re-sharpens; O1–O5 not added — and the standing
decisions (only cord physics and face textures change; nothing audible; ⚙ Oversampling untouched; no artificial caps; notices are
hints; the floor simulated). O6 was delegated to this review: not in P (§9). Severity as I9 §13: P1 a contract contradiction or an
impossible gate, P2 a gap a builder would trip on, P3 a correction.

**The author's three risks.** (1) **What the presets buy** — honest in its "do not change" list (§1.3, §5), not in its gates: High
already passes G4 at 4× and is P at 6×, so "Low no worse than High" cannot fail, while the one frame-time win the textures give — no
window paint at the rest after a zoom — was never measured (#10, now G9). The rest of Low's win is GPU-side (memory × 0.25, half the
overdraw above 100 %), which CPU throttling cannot see (#11); and the cord layer's cost at the new bound is its full-strip rebuild on
every moving frame, not the physics (#7, P-1). Said plainly in §1.3. (2) **The live switch** holds the R2a invariant by construction
(the stale path keeps mode `gl` and swaps after the upload; overlapped / folded faces get no job), thrashes nowhere today's cold path
does not — but the peak was misstated (#2), the budget charges a face for the base it is about to free (#3), a failed stale upload
would drop a good face to its SVG for good and re-queue every rest (#4), the new `getError` would fail good textures and every fake
gl (#5), and the device-ratio path it promises is not reached (#13). On-screen faces are never evicted under Low's 96 MB (confirmed,
cv-face.js:397, 405). (3) **The bounds**: D6, the warm-up pin and the frozen goldens hold (#16, #25) — but the evaluator and three
host sites still bound module ids at 4 digits / 4 096 (#1: a module numbered past 4 096 would play silent, past 9 999 vanish from
the view), and two host paths are quadratic (#8: 26 ms each at 512 on the M4, ≈ 150 ms at Low-class speed on every edit). The
`normDev` 65th-device claim reads true (no bound in `addModDev`, a silent `break` at 64 in a reader undo uses); B proves it first.

| # | point | evidence (file:line) | fix |
|---|---|---|---|
| 1 · P1 | **Module numbers past 4 096 break outside patch-core.** "Only two guard constants change in patch-dsp.js" — the evaluator also drops a module numbered > 4096 as `'mod'` and its cords as `'cord'` (silent, on the audio thread); makeSet counts only `m\d{0,3}` < 4096; the view's `midOf` and the host's event / sequencer binds accept `m\d{1,4}` only — an `m10000` is no patch module (no size, title, menu) and its 960 buttons post nothing. Ids are never reused, so a long-lived rack reaches them | patch-dsp.js:181; moog-core.js:502; cv-patch.js:105; main.js:6784, 6839; patch-core.js:61–63, 316–321 | **fixed in §0, §3.1, §3.2, §6, §7**: patch-core exports `isMid` / `isCid`; every site uses them (B: patch-dsp's third constant — D1 gate —, moog-core :502, cv-patch :105; H: main.js's two); a 6-digit module end to end and a source grep test |
| 2 · P2 | **The switch's peak and G2's "always"**: the budget is enforced only when a paint needs room and on-screen faces are never evicted, so a High → Low switch *starts* at High's on-screen bases (after the windows go) and falls job by job — "peak = the new budget + one face" is wrong, and "≤ 96 always" fails mid-switch on any scene whose High bases pass 96 MB (hw5) | cv-face.js:395–406 (enforce: `on` exempt), :386 (free after upload), :325 (the scratch) | **fixed in §1.1, §1.1 table, §4 G2**: peak = max(resident after the windows, new budget) + one face + the scratch; G2 holds per scene started at a preset and after the queue drains; the on-screen soft bound said |
| 3 · P2 | **The stale re-raster pays for the base it replaces**: `run` calls `enforce(need)` while `bytes` still holds `F.base` — on a High → Low switch an off-screen stale face is skipped, or evicts farther faces, for room its own swap would free | cv-face.js:371, 396–405 | **fixed in §1.1 (a), §7 T**: `enforce(need − F.base bytes)` on a stale job |
| 4 · P2 | **A failed stale upload is fatal and re-tried forever**: `fail(F)` sets the sticky `failed` (the face drops to the tier / its SVG until an unmount, though its old base was fine), and if it were not, the stale level would be re-queued at every rest | cv-face.js:353–357, 385, 417–418 | **fixed in §1.1 (b), §7 T**: a stale job that fails keeps the old base, no `fail`; `F.lvlTry` stops the re-queue until the preset / ratio changes; the cold path keeps `fail` |
| 5 · P2 | **`getError` as drafted**: an error left by an earlier call fails a good upload; `CONTEXT_LOST_WEBGL` would mark faces `failed` (sticky) instead of taking the loss path; the fake gls in tests/cv-gl, tests/cv-face and main-sim's stub have no `getError` / `getParameter` (the call would throw → null → `fail` → every existing test red, against G1); and it is a synchronous GPU-process round trip | cv-gl.js:192–212; cv-face.js:353–357, 382; tests/cv-face.test.mjs (fake gl) | **fixed in §1.1**: drain first, lost ≠ fail, every new call guarded with today's defaults, the cost said (at a rest, one per upload) |
| 6 · P3 | **The wide faces are four, at 1i's sizes**: the Moog Modular is 4352 at dpr 2 with its keyboard (I1h's pre-1i table: 3456), beside the CS-80 4864 and the Jupiter-8 / Juno-60 4288; the OB-Xa and DX7 exactly 4096 | tests/cv-face.test.mjs:113 (`FACES_1I`), 136–138 (`FACES_9`) | **fixed in §0, §1.1, §4 G3, §7 T**: the four named; `baseLevel` / `winLevelOf` take the side limit; T runs every real face at each preset × dpr with 4096 |
| 7 · P2 | **The cord layer's cost at size is the rebuild, not the physics**: any moving frame rewrites and re-uploads every cord's strip — 0.14 ms + 233 KB at 128 cords, 0.35 ms + 0.9 MB at 512, 1.3 ms + 3.7 MB at 2 048, 2.7 ms + 7.3 MB at 4 096 (M4, one rope swaying) — at every preset, still included (a drag re-paths every pointer frame); §1.2's "a big rack's drag stays bounded by the cords on that module" is wrong once 4 096 cords are legal | cv-cords.js:317, 419–447, 449–459; scratch `cordbuild.mjs` | **fixed in §1.2, §3.2, §11**: corrected and measured per preset by C; **Low's still path drawn at Medium's 6 / 3** (× 0.4 the strip; within ≈ 4.5 % of the sag, `still6.mjs`); the per-cord fix → **P-1** |
| 8 · P2 | **Two host paths go quadratic at the new bounds**: every module's title (cv-patch `devices()` and each body's label, on every sync) — `ordinal` sorts the record with a regex comparator per call: 25.5 ms at 512 (0.16 at 37); `targets()` (Connect to…, the drag's halos) scans the cords per jack: 26 ms at 512 / 1 500 cords. §3.2's "O(n)" and "O(jacks)" understate; both pass the 50 ms report line and cost ≈ 150 ms on every edit at Low-class speed | patch-core.js:66, 108–113, 264, 270, 296–298, 774–779; cv-patch.js:165, 651–686, 888, 929; scratch `hostpaths.mjs` | **fixed in §3.2, §6 B, §7 B**: both made linear in lane B, output-identical (equality against 9dde7e6's functions); the report line at a frame (16 ms) |
| 9 · P2 | **§1.4's per-preset notice factors** cross the user's line ("only the cord physics and panel texture") and lost their premise with Q1: the preset says nothing about the device (every tablet starts on High) and the painted count of a scene is equal at every preset (G8) | main.js:6333–6379; §1.4 (as written) | **fixed in §1.3, §1.4, §6 H, §7 H**: the notices unchanged at every preset |
| 10 · P2 | **G4 cannot fail and Low's win is not gated**: High is already P+ at 4× / P at 6× (§0), so "≥ P at 6× and no worse than High" passes by definition; the zoom-end window paint (the iPad's 79 ms at 4e6 px) — the frame-time hitch Low removes — is in no gate | cv-face.js:378–384, 427–433; I1h §8; tests/ui-bench-m9.mjs:1424–1428 (the verdict's settle term) | **fixed in §4**: G4 a no-regression gate naming each verdict's limiting term; **G9** the rest after a zoom: Low 0 paints, Medium ≤ 0.6 × High's window px, Low's settle max ≤ High's |
| 11 · P3 | **What the simulation can see**: CDP throttling slows the renderer's main thread only — face memory, overdraw and uploads run at the M4's GPU; `--force-gpu-mem-available-mb` is unverified for WebGL allocations. The GPU-side claims are the counter's and the real-device pass's | §4 (as written) | **fixed in §1.3, §4**: what each preset buys and what the Mac cannot measure, said; a forced context loss per preset in G7 |
| 12 · P3 | **The 2D path and the tier**: with no WebGL2 / `?nogl` / three losses the presets change nothing (the 1g tier rasters at the screen's ratio, the SVG cords are still already); and an overlapped face at Medium / Low (the tier) is sharper than its neighbours | cv-panel.js:1418; cv-cords.js:493–504 | **fixed in §1.1, §1.3, §10, §11**: said; the tier's ratio → **P-2** |
| 13 · P2 | **The device-ratio re-raster is not reached**: a ratio-only change makes `resize()` write no camera (no 'screen', no plan), and `watchDpr` lives in cv-world (lane C) while the stale logic is T's; likewise `?texmax` is a URL switch read where `?nogl` is (cv-world) but honoured in cv-gl | cv-world.js:444–460, 527–535, 541, 609–619 | **fixed in §1.1, §6 (C, T, interfaces), §7 C**: `watchDpr` → `FACES.recheck()`; `createGL(…, { maxTex })` from cv-world |
| 14 · P3 | cv-face's own at-size paths: `plan()` runs whole after every base landing (every face's sync — O(n²) over a cold load or a switch of a 512-module rack) and `recheck()` is faces × world items once a frame of a module drag | cv-face.js:390, 408–437, 447–460 | **fixed in §3.2, §7 T**: timed at 512 by T, recorded, reported past a frame |
| 15 · P3 | `graph()` "≈ linear, ≈ 13 ×": the schedule's topological pick scans and splices the ready list per component — quadratic for a wide patch | patch-dsp.js:325–333 | **fixed in §3.2, §6 reviewer 1, §11**: a wide and a deep patch timed; recorded |
| 16 · P3 | Warm-up: "every payload ≤ WARM_C" checks connections only — the lifted `MAXM` changes nothing only while every warm payload stays ≤ 64 modules (true: the table's types + the controller); `WARM_C` is a script-scope const of the worklet file (the test pins the literal); "the hash equals 9dde7e6's" needs the hash computed on the base | engine.js:1636–1655, 3811, 3863; tests/engine-track.test.mjs:2232–2237 | **fixed in §3.2, §7 B** |
| 17 · P3 | D6 at the bound: a 9b patch whose cords + lit rows pass 256 has rows skipped today (a tip); at 8 192 they connect — the one intended change | patch-core.js:554, 579–580 | **fixed in D6** |
| 18 · P3 | Inventory gaps: `freeSlot` searches 64 lines and then drops every further tile on one spot (a placement cap); the Serum sequencer's sizes (worklet arrays), the drum machines' pattern memory and song.js's `plain` guards were unlisted | patch-core.js:769–771; seq-core.js:134–139 = sx-seq.js:118, 405; drum-core.js:107; song.js:138–141 | **fixed in §3.1**: `freeSlot` to 2 + ⌈MAX_MODS / 2⌉ lines; the rest listed unchanged with the why |
| 19 · P3 | §7's pins missed seven sites | tests/cv-migrate.test.mjs:1515; tests/cv-cables.test.mjs:1155–1156; tests/cv-mods.test.mjs:362; tests/pads-core.test.mjs:42, 126, 380 | **fixed in §7** |
| 20 · P3 | Over-built: the window cap's per-preset start / floor — `synth.cv.winpx` is the device's paint speed in px, the same at every preset; scaling it only makes Medium's windows soft sooner and adds a clamp at every switch | cv-face.js:31, 154–162 | **fixed in §1.1 table**: one cap as today |
| 21 · P3 | The switch moves settled cords to the parabola (a project-open look) and Medium's settled cords hang a little differently (6 points) — unsaid | cv-cords.js:57–67, 69–91 | **fixed in §1.2** |
| 22 · P3 | `stats().soft` silently changes meaning at Medium / Low (relative to dE); `glStats` maps FACES keys by name (bytes / gl only), so `budget` would not arrive as `faceBudget`; `FACES.setPerf` must be a named export too (cv-world imports the namespace) | cv-face.js:588–602, 608–610; cv-world.js:62, 1857–1864 | **fixed in §2.1, §6 interfaces** |
| 23 · P3 | The DSP-load safeguard persists a halved ⚙ Oversampling — unchanged (D2), but with no module cap a big patch is its likeliest trigger | main.js:1301–1333 (1313–1316) | **fixed in §10, §11**: said |
| 24 · P3 | §2.2 Auto: moot by Q1 (for the record: Chrome buckets `deviceMemory` and caps it at 8, so "≥ 8" was the top bucket; nothing needed UA-CH) | §2.2 (as written) | **fixed in §2, §5, §6, §7**: withdrawn everywhere (C's `autoPerf`, H's boot rule, reviewer 2's spoofing, the tests) |
| 25 · fine | Checked and fine: **D1 by construction** (no preset reaches a worklet; `MAXM` / `MAXC` are guards, nothing allocated by them, patch-dsp.js:396, 410); **the warm-up under `WARM_C`** (`big` and the parts are byte-identical: engine.js:1636–1655 slices by the argument); **golden-moog / -b** (frozen side A with `MAXM` 64 / the 4 096 bound: every case ≤ 64 modules, numbers < 4 096); **the 9b frozen-record pin** (`model15({})`, `makeSet('m15', {})`, the presets' payloads — none reads a changed bound or a 5-digit id); `normPatch` byte-identical inside today's bounds (the `nid` / `cid` clamps keep their values); **the R2a invariant** on the stale path (mode stays `gl`, swap after upload, cv-face.js:250, 386, 388; no job for folded / overlapped faces, :417); the burst rule (`movestart` clears the queue, :541; `plan` returns in a burst, :409); on-screen faces never evicted (:397, 405); High = today on the iPad / Mac (16 384 ≥ 8 192); `seed()` re-seeds asleep and `step` reads the rope's `n` (cv-cords.js:57–91); the `normDev` 65th-device loss by reading (song.js:558, 574; cv-model.js:391–402); schema 13 additive (cv-migrate.js upgrade: `from > SCHEMA` → read-only); `freeSlot`, `payload`, `liveNodes`, `rackLayout` linear (0.2–2.7 ms at 512) | as cited | — |
| P-1 · proposal | **The cord layer's rebuild at size** (#7). (a) Record it (§11): a swaying cord costs 2.7 ms + 7.3 MB a frame at 4 096 cords on the M4, ≈ × 6 on a slow tablet, at every preset. (b) As fixed now: Medium and Low at 14 points (× 0.4). (c) Also give each cord a fixed vertex range in the strip and rewrite + `bufferSubData` only the cords whose rope or ends moved (the degenerate joins between ranges kept; the same triangles in the same order, so High's pixels and the glue probe are unchanged; a test: the strip after every frame equals a full rebuild's) — lane C, every preset. The review recommends **(c)**: this stage is what makes 4 096 cords legal; (c) makes a drag cost its own cords, as §1.2 meant; contained in cv-cords, testable bit for bit | cv-cords.js:317, 419–459 | **for the lead** |
| P-2 · proposal | **The 1g tier's ratio at Medium / Low** (#12). (a) As written: the tier (overlaps; the whole 2D path) stays at the screen's ratio — a device without WebGL2 gets nothing from the presets, an overlapped face looks sharper than its neighbours. (b) The tier at `dE · k` (cv-panel.js:1418, one line + a test; owner H or T): the 2D path gets Low's raster saving at every zoom end, overlaps match. The review recommends **(a)**: the 2D path is the rare fallback, an overlap is momentary, and cv-panel stays out of P (lean) — (b) is one line if the real-device pass meets a device without WebGL2 | cv-panel.js:1386–1471 | **for the lead** |

**Counts**: 1 P1 · 9 P2 · 14 P3 · 1 fine · 2 proposals. Every P1–P3 is fixed in the text above; the proposals wait for the lead.

**The lead's decisions on the skeptic's proposals (2026-10-22):** P-1 — **(c)**: each cord gets a fixed vertex range and only the
cords that moved are rewritten / uploaded (High's pixels identical, tested against a full rebuild; lane C) — this stage makes 4096
cords legal. P-2 — **(a)**: the 1g bitmap tier stays at the screen's ratio (a rare no-WebGL2 fallback; (b) stays a one-line option if the
real-device pass meets such a device). O6 is a known limit, except lane B's two linearised host paths. Lanes T ∥ C ∥ B start now on the
holding branch `wt-P`; lane H starts after the separate Effects-tray / pull-tab fix lands on `canvas` (it shares main.js and the shell).
