# Milestone 3 — the many-modules rendering question (mapper's report, 2026-10-19)

Scope: which pixels the canvas draws on the GPU today and which the browser draws from the DOM, why the DOM part "renders in" at a zoom end,
what 8–12 Serum part modules + modulators + FX would cost, four candidate approaches (plus two variants found on the way), and how to
measure them on the iPad before committing. Read-only on the repo (branch `canvas`, 959ab78, untouched).

Sources: CLAUDE.md, HANDOVER, ROADMAP (all feedback rows), SPEC §0/§2/§8/§9/§10, IMPL-1e §8.3/§8.5, IMPL-1h (all), IMPL-2a §8.1, IMPL-2b §6/§9, the
memory note on the multi-synth withdrawal, `tests/ui-bench.html`, `cv-gl.js`, `cv-face.js`, `cv-world.js`, `cv-panel.js`, `wk.js`, `serum-ui.js`,
`style.css`. Measurements: my own scratch harness (headless Chrome 155, `--use-angle=metal`, dpr 2, M4 Max, the app served read-only from the
tree, throw-away profile) in `scratchpad/m3/rend/` (`lib.mjs harness.mjs scenes.mjs bench.mjs trace.mjs layers.mjs restdiff.mjs counts-*.mjs proxy.mjs`).
**Chrome on the Mac cannot show the WebKit behaviour** (every scene below, up to 11.3 k nodes, ran every phase at 16.7 ms): it supplies DOM
inventories, layer counts and a method for "render-in"; every WebKit / iPad statement is labelled *recorded* (a number from the repo's docs),
*inferred* or *to measure*.

---------------------------------------------------------------------------------------------------------------------------------------

## 0. The answer in twelve lines

1. Today the GPU draws **two things**: the dot grid (a shader) and the twelve **hardware faces** (textures), in one WebGL2 canvas under `#world`.
   **Everything else is DOM**: module chrome, the hardware controls, Simple panels, Serum, FX, OUT, the modulator modules, cables, badges.
2. A Serum is **not art, it is controls**: one bundled Serum (OSC page) is 3 719 elements, 153 knobs, 75 number boxes, 40 menus, 32 toggles, 25 buttons,
   29 canvases; the hardware panels the 1h work fixed were 30–70 % *art* (a 100–1 300 element SVG face) with 120–660 control elements. So the 1h
   recipe ("rasterise the static art, keep live controls as DOM") removes only ~25–35 % of a Serum part's DOM and none of what the user sees
   change at rest (text, knobs, values).
3. DOM "renders in" at a zoom end because `#world` is a compositor layer only while a burst runs (`will-change` while `[data-cv-busy]`), the
   browser re-rasters it when the burst ends, and the app itself then changes three more things at that moment: `--ik` (cable strokes, badges,
   hit areas), the canvases' backing stores (`rescaleCanvases`), the face windows. Measured with a held-pinch screenshot diff (Chrome, 1.0→0.4):
   GL face 0.00 % of pixels change, Serum DOM 2.96 % change by > 16/255 (the method is the proposed rule-1 gate, §6.4).
4. Serum's own display canvases are **below 1:1 above 100 %** today (measured density 1.00 / 0.67 / 0.50 at k = 1 / 1.5 / 2, dpr 2) and are
   re-fitted at rest: they violate rules 1 and 3 already.
5. The target scene (two Serums as parts, 4–6 Serum-faithful modulators, one FX, OUT) is **≈ 8–11 k painted DOM elements** (hardware five-set on the
   iPad: 2.8 k painted + 3.9 k hidden) at **5× the DOM density per world px**, 30–45 canvases per Serum parts set (each a compositor layer in Chrome). Texture cost if it
   were GPU-drawn: **≈ 100 MB** (the iPad holds 116 MB for the five hardware faces).
6. No approach built on the DOM can meet rules 1 and 3 on WebKit (the compositor scales a stale bitmap mid-pinch and re-rasters at rest). Only
   GPU-resident pixels can, and **WebKit has no supported DOM→texture path**: the pixels must come from our own painter (canvas 2D / SVG built
   from data), not from the DOM.
7. **Recommendation: (b) — the module on the GPU, the DOM kept as an invisible hit/focus/accessibility layer — reached in measured steps**, with (c)'s cheap
   hygiene first and the displays-to-GL step (a variant of (a)) as its first deliverable; (a) as stated and (d) are rejected; (c) alone is the
   fallback if the iPad probes say DOM paint is not the cost *and* the user accepts DOM render-in for Serum text.
8. Commit point: after §6 probes P1–P4 and runs M0–M2 on the iPad (≈ 2 days of agent work + one 20-minute user session).

---------------------------------------------------------------------------------------------------------------------------------------

## 1. What the user asked for, in measurable form

| Rule (ROADMAP 2026-10-19) | Measurable form | Today |
|---|---|---|
| R1 "i do not like how the resolution only renders in when i let go of zoom" | The pixels of a module / the grid mid-gesture equal the pixels at rest for the same camera (G1 `equalPx`, held-pinch screenshot diff per module) | grid ✓, hardware face ✓, **all DOM ✗** (§2.2) |
| R2 "the dot grid should be treated like a tool of measurement" | every dot centre within 0.5 device px every frame (G3) | ✓ (0.064 px on the iPad) |
| R3 "no low resolution renderings of the devices … at least 1:1 with respect to their scale in the view" | density = texel / backing px per on-screen device px ≥ 1.0 for every pixel source of a module, at every k the user can reach | face ✓ to k = 1 (iPad: base only above; accepted 1h), **canvases ✗ above 100 %**, DOM ✓ only at rest |
| Z1 (2026-10-17) "modules render identically at every zoom" | no cards / LOD / unmount / resize with k | ✓ (so SPEC §2.11 cards and §9.3's "9 k mounted elements, the rest cards" are **void**; the milestone needs a measured budget instead) |
| Lag (1f) "with 5 panels in view it lags mostly when pinch zooming" | touch-driven pinch 50–200 %, 60 Hz: median ≤ 17.5 ms, p95 ≤ 25, no frame > 50 ms except the first move / settle (≤ 100) | hardware five-set *recorded* (1h iPad): median 17, 1 × 50–80 ms at first move and at settle per phase; **Serum sets never measured** |

---------------------------------------------------------------------------------------------------------------------------------------

## 2. Facts

### 2.1 What is GPU-drawn and what is DOM today

| Thing | Where | Note |
|---|---|---|
| Dot grid | GPU: `cv-gl.js` procedural shader on the one `.cv-gl` WebGL2 canvas under `#world`, redrawn at every written camera frame and at rest | exact dot centres (G3) |
| Hardware faces (12 models) | GPU: `cv-face.js` — mipmapped base texture at L0 = min(dpr, 3) (k ≤ 1) + budgeted windows above 1 (iPad: window cap bottomed at 4 Mpx, a window paint is 79 ms → base only above 100 %, accepted) | art comes from `panels/*.js` as an SVG string → `Image` → 2D canvas → `texImage2D`. One draw per quad, rounded-rect SDF clip, alpha / gray for power-off and patching |
| Overlapping hardware modules, 2D fallback | DOM: the 1g bitmap tier (`faceTier`) | overlap rule §3.5 of IMPL-1h: GL is *under* all DOM |
| Module chrome (bar, title, preset chip, CPU, ⋯, fold, jacks), selection ring, ghost | DOM in `#world` | `--ik`-sized parts snap at rest |
| Hardware **controls** (`.hw-ctls`, extras strip, wood cheeks) + the hidden face SVG + a 0×0 sentinel canvas | DOM; the SVG stays in the DOM, `visibility: hidden` in gl mode | per panel 120–657 control elements and 98–1 295 face elements (§2.4) |
| Simple / flow panels (`classic-panel.js`), Serum (`serum-ui.js`, bundled), FX racks (`fx-ui.js`), OUT + scope, modulator modules (`cv-mods-ui.js`) | DOM + 2D canvases; canvases re-fitted at zoom end by `wk.rescaleCanvases` (density clamp(dpr·k, 0.5, 2)) | |
| Cables (two SVG layers in `#world`), badges, jack hit circles | DOM SVG / HTML, strokes `calc(Npx * var(--ik))`, `--ik` written **at zoom end only** | cable thickness and badge size snap at rest |
| Minimap, toolbar, trays, popovers (`#ov`) | DOM outside the world | not affected by zoom |

### 2.2 Why DOM "renders in" at a zoom end, and what else changes then

`cv-world.js` writes `#world.style.transform = translate(tx,ty) scale(k)` once per frame; `#viewport[data-cv-busy] > #world { will-change: transform }`
only while a burst runs (style.css:810). At `endBurst()` (cv-world.js:608) the app, in order: rounds the translation to device px; removes
`data-cv-busy` (the layer demotes → the browser re-rasters at the new scale); if k changed writes `--ik` on `#world` and calls
`wk.setCanvasScale(k)` + `wk.rescaleCanvases(#world)` (every Serum / FX / OUT display re-fitted to clamp(dpr·k, 0.5, 2) and redrawn); emits `cameraend`
(FACES plans windows); `computeEdit()`, `recache()` (layout reads). Each of those is a visible pop for DOM content:

| Source of "render-in" | What the user sees | Meets R1 / R3? |
|---|---|---|
| The world layer's own raster (text, SVG knobs, borders, radii) | text / lines soft while pinching in, aliased while pinching out ("competing pixels"), crisp at rest | ✗ / ✗ mid-gesture |
| Canvases (Serum displays, LFO / ENV graphs, scope) | redrawn at a new density at rest; **0.67 / 0.50 of 1:1 above k = 1** | ✗ / ✗ |
| `--ik` | cable stroke widths, mod badges (font-size `calc(10.5px*--ik)`), jack hit areas snap | ✗ (small) |
| FACES windows (hardware) | only *sharpen* a region shown from the base texture at k > 1 | by design (accepted) |

*Recorded* (IMPL-1e §8.5, IMPL-1h §9.4): WebKit re-rasters at each pinch step in the pre-1g app; after 1h the five-hardware-panel set's remaining DOM
(≈ 2.8 k controls) pinches at median 17 ms on the iPad with one 50–80 ms frame at the first move and one at the settle of each phase.
*Inferred*: those two spikes are the layer promotion (first move) and demotion (settle) rasters; if so they scale with **painted** DOM, not with
world area. Whether WebKit also re-rasters per pinch *step* while `will-change` is set is exactly what I could not establish without the device —
probe M2 (`noWC` vs `permWC`) answers it.

Chrome (this machine) cannot show it: all phases 16.7 ms median **and max** for 1.2 k, 3.8 k, 6.7 k, 7.9 k and 11.3 k nodes. What Chrome does show:
the "render-in" *method* and a compositor cost that scales with layers (below).

**Held-pinch diff (Chrome, mix scene, per-pixel mean |Δ| of RGB and % of pixels changing by > 16/255, mid-burst vs at rest; at-rest vs at-rest noise
floor 0.00):**

| Region | zoom | mean | % > 16 |
|---|---|---|---|
| Serum module (DOM) | 1.0 → 0.4 | 1.81 | 2.96 |
| Serum module (DOM) | 0.5 → 1.5 | 0.42 | 1.00 |
| OB-Xa module (GL face + its DOM controls and chrome) | 0.5 → 1.5 | 1.07 | 1.73 (the face is identical by G1; the change is the DOM on top) |
| OB-Xa module (controls tiny at 0.4) | 1.0 → 0.4 | 0.01 | 0.00 |

### 2.3 DOM inventory (measured, Chrome, `#world` descendants of one module)

Hardware (hardware layout, GL face): total / controls / hidden face SVG elements, module world size:
minimoog 955 / 521 / 434 (1408×512) · modular 1 858 / 563 / 1 295 (1728×960) · arp2600 1 572 / 549 / 1 023 · solina 218 / 120 / 98 · cs80 1 812 / 657 / 1 155
(2432×768) · prophet5 1 135 / 625 / 510 · ms20 1 367 / 465 / 902 · tb303 648 / 397 / 251 · obxa 766 / 506 / 260 · jupiter8 1 557 / 515 / 1 042 · juno60 919 / 342 / 577 ·
dx7 707 / 494 / 213. The user's five-set (OB-Xa, Jupiter-8, MS-20, CS-80, Prophet-5): 6 637 / **2 768 controls** / 3 869 hidden face, 5.84 Mpx of world.

Serum, bundled (module 1200×1310; one Serum = 1.57 Mpx):

| Part | elements | knobs | canvases | SVGs | note |
|---|---|---|---|---|---|
| whole module, OSC page | **3 719** | 153 | 29 (6 visible) | 273 | 338 buttons, 833 text-bearing elements |
| …after visiting all 7 pages | **12 433** | | | | pages are never destroyed: matrix 5 231, mix 1 394, global 708, fx 588, arp 441, clip 352 |
| OSC A / B / C | 810 / 810 / 800 | 35 each | 6 each | 55 each | ~245 elements per OSC are hidden type views; B and C are 40 px wide (folded) **but fully built** |
| SUB · NOISE | 91 · 128 | 4 · 7 | 0 · 1 | | |
| FILTER 1 · 2 | 141 · 131 | 6 · 6 | 1 · 1 | | |
| MACROS · ENV (1–4) · LFO 1 · VOICING | 128 · 144 · 144 · 79 | 8 · 10 · 5 · 2 | 0 · 2 · 6 · 0 | | what the canvas modulators must now be |
| ARP · CLIP · tile strip · head · foot | 305 · 350 · 76 · 66 · 127 | 11 · 11 | 0 · 15 | | |

Widget vocabulary on the OSC page (this decides how big a GPU painter is): **knob 153** (each = a `<div>` + SVG of 6 shapes + 3 spans + mod bar), number box 75, menu 40,
toggle 32, button 25, seg 6, display canvas 21, tile 33. CSS paint features are cheap per element (14 box-shadows, 3 gradients, 0 filters, 33 opacity < 1)
— cost is **count**, not effects. Fonts: Inter + JetBrains Mono, Google web fonts (they are *not* available inside an SVG-as-`Image`).

Others: FX module 31 elements empty, **581** with four effects (37 knobs, 760×1174); OUT 20; today's simplified modulator modules LFO 65, ENV 96, Macro 135,
Chaos 38, CC 38, Note 149 — the Serum-faithful ones are 2–3× heavier (LFO 144 + 6 canvases, ENV 144, Macro 128, Chaos ~100).

DOM density: hardware controls **474 elements per world Mpx**, a Serum **2 370 per Mpx — 5×** — and zooming out (fit) makes everything visible at once, so a
zoomed-out Serum-parts scene is the worst case for anything proportional to visible elements.

Compositor (Chrome proxy; WebKit layer behaviour *to measure*): composited layers at rest / mid-burst: hw 1 panel 25 / 26; hw five 25 / 36; Serum ×1 39 / 40;
mix (1 Serum + 3 hw) 35 / 48; **Serum ×3 43 / 67 (88 canvases)**. Main-thread `Layerize` per camera frame during a pinch (36 frames): 0.4 / 0.85 / 0.8 / 0.9 /
**4.2 ms** (max 4.6) — the 3-Serum scene alone costs 25 % of a 60 Hz frame in Chrome for a transform change, from canvas/layer count.

### 2.4 The target scene, costed

"One Serum as parts" ≈ VOICE (voicing 79 + ENV 1 144) + OSC ×3 (2 420) + SUB + NOISE (219) + FILTER ×2 (272) + LFO ×2 + ENV ×2 + MACROS + CHAOS (~700) + FX 31–581 +
14 module bars (~30 each) ≈ **4.4–5.6 k elements, ~170 knobs, 30–45 canvases**. A prototype fixture (11 real panels cloned into `.cv-mod` shells, `rend/proxy.mjs`) is 3 582 elements and renders
as expected.

| Scene | painted DOM elements | canvases | world area | GPU textures if GPU-drawn (d = 2, base + mips) |
|---|---|---|---|---|
| iPad's accepted five hardware faces (control) | 2.8 k (+3.9 k hidden) | 6 | 5.8 Mpx | **116 MB recorded** |
| 1 Serum bundled, OSC page | 3.7 k | 29 | 1.6 Mpx | ~33 MB |
| 1 Serum as parts (typical, B/C folded; estimate) | ~2.5–3.5 k | ~15–25 | ~1.5 Mpx | ~32 MB |
| **T2: 2 Serum parts + 6 modulators + FX(4) + OUT** | **8–11 k** | 70–100 | 4.75 Mpx | **~100 MB** (21 MB per world Mpx, as the faces) |
| 3 Serums bundled (the old SPEC fixture) | 11.3 k | 88 | 4.7 Mpx | ~100 MB |

If paint cost at the first move / settle scales with painted elements (*inferred*), T2 is **≈ 3.5–4× the hardware five-set's controls**: 50–80 ms → roughly
**175–320 ms** at every gesture start and settle on the iPad; one Serum ≈ 1.2× (60–100 ms). Element count is a coarse proxy (Serum elements are text-heavy with radii and
borders); this is an extrapolation to be checked by M1/M2, not a measurement.

Canvas density audit (Chrome, one Serum, dpr 2): backing stores 4.7 MB (k 0.25) → 10.6 MB (k ≥ 1); density 1.00 up to k = 1, **0.67 at 1.5, 0.50 at 2.0** (the clamp `min(2, dpr·k)` in
`wk.fitCanvas` / `serum-ui paintCanvas`). Same class as the face windows the iPad could not afford; for canvases the fix is cheap (§4, a2).

### 2.5 Constraints that shape every option

* **No DOM→texture on WebKit.** `drawElementImage` / html-in-canvas is Chromium-only; SVG `<foreignObject>` images taint the canvas in Safari (long-standing; **probe P1** re-checks on iPadOS 26). The hardware recipe worked because the art was *already* an SVG string from code. Serum art is
  CSS-styled DOM. Anything GPU-resident must be drawn by our own painter: canvas 2D (uses the page's loaded web fonts) or an SVG from data (cannot use Inter without embedding it).
* **Hit-testing, focus, accessibility, IME stay DOM**; the GL canvas is *under* `#world`, so GPU pixels need transparent module backgrounds (the 1h `[data-cv-face="gl"]` rule) and DOM that draws on top of GL (cables, rings, halos) is always above it.
* **Overlap rule**: GL art is below all DOM, so a module overlapping another falls back to DOM (hardware: the 1g tier). For *fully GPU* modules with invisible DOM the overlap problem disappears (explicit z in the quad list); it remains only against still-visible DOM modules.
* **Cables sit above GL art** (today also above hardware faces); audio cables "under the modules" (SPEC §2.9) would need GL cables.
* **iPad GPU/raster budget**: window paints (SVG→2D canvas) were 79 ms for 4 Mpx on the main thread → "above 100 % the base shows". A canvas-2D painter (not SVG-as-Image) can run in a Worker with `OffscreenCanvas` + `FontFace` (*to measure*, probe P2): the way past that ceiling.
* Memory: textures ≤ the 1h budget (recommended 256 MB, constant 384 MB); canvases ≤ 64 MB (SPEC §9.3); GL context loss already handled by 1h.

---------------------------------------------------------------------------------------------------------------------------------------

## 3. Candidate approaches

Notation: ✓ meets by construction · ◐ partly · ✗ does not. Sizes as SPEC: S < M < L < XL (L ≈ stage 1h).

### (a) Extend 1h: static art of each Serum part to a GL texture, live controls stay DOM

* How: generalise `FACES.register` to an *art provider* (SVG string today; a painter for Serum), one base texture (mips) + windows per part module; module body transparent; controls DOM on top.
* Gain on a Serum part: labels (282 spans), panel/section backgrounds, knob tracks → ~25–35 % of elements; **knobs' arcs and pointers, 161 value texts, menus, toggles, buttons, mod bars (≈ 65–75 % of the pixels the user reads) stay DOM and keep rendering in.** Because the static art needs a painter anyway (no DOM→texture) its cost is most of (b)'s painter for a fraction of the benefit.
* Rules: R1 ◐ (art ✓, controls ✗: a crisp label next to a knob that re-rasters is *worse* consistency than today), R2 ✓, R3 ◐ (art ✓ to k = 1, controls ✗).
* Effort L (provider refactor S–M; a painter per part type incl. OSC type views). Risk M–H (fonts, per-part recipes drift from the DOM).
* Measure: P3 (painter fidelity) only; M1/M2 with `opacity0` bounds the best-case DOM saving.

### (a2) Variant: **canvases to GL sprites** (the displays)

* How: the 21–30 display canvases per Serum (wavetable / filter / env / LFO views, LFO and ENV graph editors) draw into a texture at L0 = dpr **independent of k**; the DOM canvas becomes a 0×0 placeholder / hit target. Same art-provider refactor as (a), but the source is *already a bitmap* — no fidelity risk.
* Gain: R1 ✓ and R3 ✓ to k = 1 for the most device-like pixels; removes 30 compositor layers per Serum (Chrome: Layerize 4.2 ms per frame at 88 canvases); no redraw at rest. R3 above 100 %: base only, as faces.
* Effort M. Risk L–M (upload cost of ≈ 10 live displays at 30 fps ≈ 5 Mpx/s of uploads: M4 probe).
* The controls around the displays still render in, so on its own it is a step, not an answer.

### (b) Whole module on the GPU; DOM only as the invisible hit / focus / accessibility layer (+ transient overlays)

* How: new `cv-scene` painter. Each module = one retained texture (base L0 = d, mips; windows later or a 1.5×d base for text) built by a painter that *knows the Serum kit's seven widgets* (knob, number box, menu, toggle/button, seg, tile, display) and the panel geometry (read from the DOM layout once at mount / re-layout, a rest-time layout read as FACES already does). The widgets' existing `update()` is the dirty signal: a changed knob re-paints its own rect into the module texture (`texSubImage2D`, ~80 KB at 2×). The DOM keeps every listener and accessibility role and is made `opacity: 0` (if P4 confirms WebKit does not paint it, raster cost ≈ 0 whatever the element count). Menus, popovers, text entry, tooltips remain DOM overlays (`#ov`, 1:1, transient).
  Painter text: canvas 2D `fillText` with the element's computed `font` (so a missing web font falls back identically), cached per string × style as small mipmapped textures (≈ 830 strings per Serum page ≈ 11 MB).
* Rules: R1 ✓ (a module's pixels never depend on k; only the camera matrix changes — G1 extends from the grid + faces to every module), R2 ✓, R3 ✓ to k = 1 on the iPad (base L0 = d; 1.5×d base buys k = 1.5 for 2.25× memory ≈ 230 MB at T2 — inside the recommended 256 MB; windows or a worker-painted window above).
  Residuals: DOM-above-GL overlays (halos, rings, cables) unless cables/halos also go to GL (§5 step 3R-4).
* Lag: the camera path becomes N quads (≤ 1 ms) + the existing GL draw; first-move / settle rasters vanish for painted modules (opacity 0) — *if* P4 confirms WebKit does not paint opacity-0 subtrees.
* Effort **XL** (painter core L; the seven widgets M; every part's geometry/variants and parity tests L; cables-to-GL S–M). Risk H: text parity (canvas 2D lacks `font-variant-numeric: tabular-nums`; `letterSpacing` support on iPadOS to verify, P3), states not driven by DOM mutations (`:hover`, `:active`, transitions, animations), a second renderer to keep in step with the DOM look, texture memory on iPad, upload cost while dragging with linked displays. Mitigations: pixel-parity test per part against the DOM render (headless Chrome screenshots, a checked-in tolerance), DOM-visible fallback per module (flag `synth.cv.gpumods = off`, GL loss, any painter error), `transition: none` on mirrored widgets.
* Strategic: stages 7 (drum machines) and 8 (pad grid that lights up) are more big interactive modules; the GPU scene is what they will need.

### (c) DOM only, with compositing tweaks

* Variants to measure (ui-bench `MODES`, three exist and have **never been recorded**): `layers` (per-module `will-change` while moving), `skip` (`content-visibility: auto` on bodies; off-screen only — at fit everything is visible), `both`; plus **`noWC`** (no `will-change` at all: the browser re-rasters at every frame — crisp every frame, *the only DOM-only way to meet R1/R3*, at main-thread/GPU-process cost per frame ∝ painted elements), `permWC` (never demote: no render-in, but stale-scale bitmap forever).
* Hygiene that helps any variant and is milestone-3 work anyway: build parts lazily (folded/off parts, hidden OSC type views −30 %, no matrix page 5.2 k, no tile strip 76 × parts); remove the hidden face SVGs from the DOM in gl mode (−3.9 k of 6.6 k in the five-set; the data-tip hit test makes one on demand); slow or pause live displays below k 0.5 and off screen (off-screen pause exists); cap simultaneously ticking displays.
* Rules: R1 ✗ (✓ only under `noWC` and only while it holds frame rate), R2 ✓, R3 ✗ (✓ under `noWC` likewise; canvases still 0.5 at k = 2 unless (a2)).
* Effort S–M. Risk: the 1f outcome repeats at T2 scale (inferred 175–320 ms hitches; render-in on all Serum text) and the user withdraws the feature a second time (memory: "do not re-propose … unless the rendering cost is solved and measured on the iPad").

### (d) Hybrid by zoom (GPU / bitmap snapshot below a threshold, DOM above)

* Controls already sleep below k 0.5 (READ_K) and a module enters edit state at ≥ 0.9, so a threshold exists. But a swap between two renderers of the same module is a visible change at the crossing (text hinting, edge softness) = R1 ✗ and Z1 ✗, unless pixel-identical, which no painter can promise; and it needs (b)'s painter *plus* the swap. Same for a swap by state (GPU idle / DOM when hot).
* Effort L + (b). **Rejected.**

### Summary

| | R1 no render-in | R2 | R3 ≥ 1:1 | camera cost at T2 | effort | risk |
|---|---|---|---|---|---|---|
| (a) static art only | ◐ | ✓ | ◐ | −25–35 % DOM | L | M–H |
| (a2) displays to GL | ◐ (displays ✓) | ✓ | ◐ (displays ✓ to k 1) | −30 layers / Serum | M | L–M |
| **(b) module on GPU** | **✓** | ✓ | **✓ to k 1** (1.5 with a bigger base) | N quads, DOM unpainted | **XL** | **H** |
| (c) DOM + tweaks | ✗ | ✓ | ✗ | unknown, inferred 175–320 ms spikes | S–M | M (user rejection) |
| (c) `noWC` | ✓ if fps holds | ✓ | ✓ if fps holds | per-frame raster ∝ elements | S | H (fps) |
| (d) hybrid by zoom | ✗ at the swap | ✓ | ◐ | | L + (b) | H |

---------------------------------------------------------------------------------------------------------------------------------------

## 4. Recommendation

**(b), decided in stages, with the commitment point after the iPad probes.** Reasons: it is the only option that meets R1 and R3 for the content that makes up milestone 3 (text and knobs, not art); it
makes the camera cost independent of the number of parts (what "8–12 modules × N Serums" needs); it reuses the 1h machinery (`cv-gl`, the budget, the window planner, context-loss handling, the
`data-cv-face` / transparent-body convention); it is what stages 7/8 need; and every step has a DOM fallback, so the user can always try milestone 3's *function* while it lands.

Staging ("3R", independent of the functional lanes of milestone 3 except 3R-1):

| Step | What | Size | Gate to continue |
|---|---|---|---|
| **3R-0 measure** | ui-bench-m3 (§6): scenes, hand test, policy matrix, rest test, audit; probes P1–P4 | S | numbers in `tests/bench.json` `"ui-m3"`; decision table §6.6 |
| **3R-1 DOM hygiene** (inside the parts work) | lazy part DOM, no hidden type views / matrix / tile strips in parts view, drop hidden face SVGs in gl mode, live-display policy at low k, the `will-change` policy the matrix picks, a measured DOM budget replacing SPEC §9.3 | S–M | M1 scenes sx1 / proxy11 within §6.6 on the iPad |
| **3R-2 art provider + displays to GL** (a2) | `FACES.register` takes `{ art }` providers (SVG / canvas / painter); every `wk.fitCanvas` display and the OUT scope draw into textures at L0 = d independent of k; DOM canvas 0×0 | M | user's iPad verdict: displays never re-render, no layer growth |
| **3R-3 module painter** (b) | `cv-scene.js` + kit hook; painter order by visual weight: panel + section art and labels → knobs → number boxes / text → menus, toggles, seg, tiles; Serum-faithful LFO / ENV / Macro / Chaos use the same painter (they are the same kit); DOM invisible per module when its painter is healthy | XL (2 lanes after the core) | per part: parity test + iPad hand test + rest test |
| **3R-4 cables, badges, halos to GL** | strokes in screen px every frame (also fixes the `--ik` snap and cables-over-art z-order), amount badges as sprites | S–M | R1 for the remaining DOM |

Fallback if the probes say otherwise: (P4 shows WebKit still paints opacity-0 DOM, or P3 shows text cannot be made acceptable) → stay at 3R-1 + 3R-2 and take the
`noWC` / `layers` winner from M2 with the residual documented to the user (DOM Serum text renders in at rest, as hardware controls do today); say so before building.

What the milestone-3 contract must state: the invariants R-G1 (a GPU module's pixels equal mid-gesture and at rest: `equalPx` per module), R-G2 (density audit ≥ 1.0 for k ≤ 1 on every
pixel source; the list of sources below 1:1 above), R-G3 (a GPU module's DOM is unpainted and fully interactive; focus rings and halos are overlay DOM), R-G4 (any painter failure, a lost context, a
module the painter does not know → the module shows its DOM, nothing else changes), R-G5 budgets (textures ≤ 256 MB on touch, canvases ≤ 64 MB, painter ≤ 12 ms per frame, one job per frame), the DOM budget replacing
§9.3, and the hooks to add to the 2b host map (`SerumHost` part views register/unregister with the scene at mount / unmount).

Decisions that are the user's: (1) is DOM render-in of Serum text acceptable *during* 3R-1…3R-3 (the user tries function first) — recommended yes, said plainly; (2) the 1h limit (≥ 1:1 to 100 % on the iPad,
base texture above) accepted for module art too, or pay 2.25× texture memory for k = 1.5; (3) several synths per track: the scenes in §6.2 include hardware + Serum mixes so that question is answered by the same run.

---------------------------------------------------------------------------------------------------------------------------------------

## 5. (kept for the contract author) what retiring the transition accessors means for rendering

Nothing in this report blocks it: part views mount through `instView(t, dev)`; the GPU scene keys textures by module id, so several part modules of one Serum, or several instruments per
track, need no new rendering concept. The only coupling is `SerumHost` part views calling `scene.register(moduleEl, painter)` / `unregister` at mount / unmount like `wk.onRelease` does for faces today.

---------------------------------------------------------------------------------------------------------------------------------------

## 6. How to measure on the iPad before committing

Everything is additions to `tests/ui-bench.html` (it already boots the app in an iframe with the test hooks, drives the camera through `world.panBy / zoomAt`, records frame intervals, reads
`world.glStats()` and runs the G1 / G3 probes). The user opens `canvas.domlavin.com/tests/ui-bench.html?m3=1` in Chrome for iOS (as for 1h) with the iPad plugged in, other apps closed, and taps buttons;
the Mac side needs no tools. Result JSON → `tests/bench.json` `"ui-m3"`.

### 6.1 Why the existing bench is not enough
It drives the camera by code at fit zoom (touch path and closer zooms never measured), has no Serum scene, and has **no number for re-render at rest**. Three candidate switches (`layers`, `skip`, `both`) exist and
have never been recorded.

### 6.2 Scenes (built by script; the user only pinches)

| id | content | painted elements |
|---|---|---|
| `hw5` | the 1h five-set (control; recorded 17 ms median, 50–80 ms spikes) | 2.8 k |
| `sx1` | one bundled Serum | 3.7 k |
| `sx3` | three bundled Serums | 11.3 k |
| `p11` | the **proxy fixture**: the 11 panels of one OSC page cloned (`cloneNode`) into `.cv-mod` shells inside `#world` (prototype `rend/proxy.mjs`: 3 582 elements; shell classes copied from `ui.el` so the CSS variables resolve; real bar clones) | 3.6 k |
| `t2` | 2 × `p11` + 6 modulator shells cloned from the Serum LFO / ENV / MACROS panels + a real FX with four effects + OUT | 8–11 k |
| `mixed` | `p11` + three hardware panels | ~6 k |

### 6.3 Runs

**M0 — scripted** (existing phases idle / pan / zoom / settle / deep / deepSettle) for each scene × GL on/off; adds per phase `firstMove` (max frame in the first 100 ms after `movestart`) and `settleMax` (max frame in 800 ms
after `cameraend`) — the two numbers the iPad's 50–80 ms spikes live in.

**M1 — hand test** (`?hand=1`: the iframe fills the screen, bar at the bottom: Start / Stop / Copy). The user performs a fixed 45 s protocol per scene: 3 × (pinch 100 % → 25 % → 100 %) slow ≈ 1.5 s / medium 0.7 s / fast 0.3 s;
2 × pinch 100 % → 200 % → 100 %; 3 two-finger pans; 3 one-finger pans; one knob drag at 100 % (50 % for `t2`). Recorded inside the iframe: rAF intervals attributed by `world.on('movestart' | 'camera' | 'cameraend')` to
burst / firstMove / settle / rest; **input-to-frame latency** (capture-phase `pointermove` `event.timeStamp` → next rAF time, median / p95); the k range actually reached (the protocol is verified, not assumed);
`visualViewport.scale` (no native zoom). WebKit has no Long Tasks API: rAF gaps are the signal.

**M2 — policy matrix** on `sx1`, `p11`, `t2` (each repeats M0 + M1 for three trials): `base` (today), **`noWC`** (`#viewport[data-cv-busy] > #world { will-change: auto }`), **`permWC`** (`#world { will-change: transform }` always),
`layers`, `skip`, `both`, and **`opacity0`** (`.cv-body { opacity: 0 }` for non-hardware modules: the *floor* — the camera with the DOM unpainted; this is (b)'s upper bound before any painter exists). Questions answered: does WebKit re-raster
per step while `will-change` is on (`base` vs `noWC` vs `permWC` slopes against element count), whether DOM paint is the cost at all (`opacity0` vs `base`), whether `noWC` holds 60 Hz at 3.6 k / 8–11 k elements.

**M3 — rest test (rule R1, objective)** (`?hold=1`). The page pinches to k = 0.5 or 1.5 about the centre and *holds the burst open* (a `panBy(0.002, 0)` every 70 ms) for 8 s: the user takes an iPad screenshot (A); the page releases and
after 2 s shows "take screenshot B now"; a third after 1 s (C). On the Mac: per module rect (and the viewport) mean |Δ| and % of pixels changing by > 16/255 for A↔B (render-in) and B↔C (noise floor must be 0). The decoder + diff I used is in
`rend/restdiff.mjs` (decode in a scratch tab with `createImageBitmap` — no image libraries needed). Pass: GPU-drawn regions 0.00; DOM regions reported (Chrome: 2.96 % for a Serum zooming out).

**M4 — density audit (rule R3)**, static, per scene at k ∈ {0.25, 0.5, 1, 1.5, 2}: for every canvas `canvas.width / (rect.width · dpr)`, for every face `level / (dpr · k)` (`FACES.stats().soft / softMin` already), for GPU modules (later) the same; output the minimum per k
and the offender list. Chrome result today: canvases 1.00 / 0.67 / 0.50 at 1 / 1.5 / 2.

**M5 — memory and survival**: `glStats().bytes`, Σ canvas backing bytes, DOM nodes, composited-layer proxy (count of `canvas` + `will-change` elements), a 60 s k-sweep with a heartbeat in `localStorage` so a tab the OS killed is reported on next load.

### 6.4 Probes (30 minutes each, a button on the same page; they decide whether (a)/(b) are feasible)

| P | Question | Expect | If different |
|---|---|---|---|
| P1 | SVG `<foreignObject>` (inline CSS) → `Image` → `drawImage` → `texImage2D` on iPadOS 26 WebKit | SecurityError / tainted | a generic DOM snapshot route opens: (a)/(b) get much cheaper — re-plan |
| P2 | `OffscreenCanvas` 2D + `FontFace` from an ArrayBuffer inside a Worker; 4 Mpx text-heavy paint time; `transferToImageBitmap` → `texImage2D` | works (Safari 16.4+/17) | windows above 100 % stay main-thread-bound (base only) |
| P3 | Painter fidelity: a 150-line DOM→canvas-2D painter for one OSC panel vs the DOM render (headless Chrome screenshots for the diff; on the iPad: paint ms, `ctx.letterSpacing`, `fontKerning`, `fontVariantNumeric`, `textRendering`) | usable text, ≤ 15 ms for 810 elements | scope (b) to the kit widgets (not a generic CSS painter) — already the recommended shape |
| P4 | Is an `opacity: 0` subtree painted / rastered by WebKit? (M2's `opacity0` run vs a `display: none` run) | no (≈ floor) | (b) loses its camera-cost argument; keep for R1/R3 only |

### 6.5 Spike set for (b) after the probes (iPad, one page each, no app changes)

S-B1 composite: 22–40 textured quads (T2 sizes at L0 = 2, mips) in the existing GL layer, pinch 25–200 % by hand: frames, `glStats`, memory. S-B2 dirty updates: a knob drag at 60 Hz = one `texSubImage2D` of 128×160 px plus 2 display uploads (400×150 at 30 fps): frame cost.
S-B3 text: 800 strings as mipmapped textures: build time, sampling quality at k 0.25–1, memory. Fed by P2/P3.

### 6.6 Decision table

| Result on the iPad | Decision |
|---|---|
| `opacity0` floor smooth (no frame > 50 ms but first/settle ≤ 40 ms) **and** `base` at `p11` / `t2` hitches (first/settle > 100 ms or p95 > 25 ms) | DOM paint is the cost → proceed to 3R-2/3R-3 (b) |
| `opacity0` floor also hitches | the cost is not DOM paint (layers, JS, GL): stop, profile before any renderer work |
| `noWC` holds median ≤ 17.5 ms, p95 ≤ 25 at `t2` | (c2) satisfies R1/R3 with no new renderer: take it, record the residual (fps on bigger scenes) |
| `noWC` holds only at `p11` | (c2) for ≤ 1 Serum, (b) for larger scenes — switch by painted-element count measured at mount (adaptive, like `winPx`) |
| `base` is smooth everywhere (all scenes within the hw5 envelope: median 17, first/settle ≤ 80) | lag is not the problem; R1/R3 only: (a2) + (b) for the text, or an informed user decision to keep DOM text |
| M3 DOM regions > 0 and the user dislikes it on `p11` (a 2-minute look) | (b) is justified by R1 alone |

Pass criteria for any shipped approach: median ≤ 17.5 ms and p95 ≤ 25 ms in bursts (hand test), no frame > 50 ms except firstMove / settle ≤ 100 ms, input-to-frame p95 ≤ 40 ms, M3 GPU regions bit-equal, M4 min density ≥ 1.0 for k ≤ 1, textures ≤ 256 MB, canvases ≤ 64 MB, no tab loss in M5.

---------------------------------------------------------------------------------------------------------------------------------------

## 7. Caveats (what I did not verify)

* No WebKit measurement exists in this report; Chrome's `will-change` / raster-scale policy differs from WebKit's, so the Chrome render-in numbers show the method and the DOM-vs-GL contrast, not the iPad magnitude.
* The 175–320 ms extrapolation assumes first-move / settle cost ∝ painted elements from one recorded data point.
* Element counts are of the app as served on 2026-10-19 (default Serum preset; OSC B/C folded; the matrix page 5.2 k only after it is opened).
* The WebKit statements in §2.5 (foreignObject taint, opacity-0 painting, worker fonts, canvas `letterSpacing`) are from memory of WebKit behaviour, hence probes P1–P4.
* The proxy fixture clones DOM only (canvases are blank, handlers absent): valid for paint / layer cost, not for interaction cost.
* Scripts and raw outputs: `scratchpad/m3/rend/` (`bench-*.json`, `trace-*.json`, `layers.json`, `repaint.json` (noisy, not used), `hw-counts.json`, `serum-counts.json`, `parts-counts.json`, `other-counts.json`).
