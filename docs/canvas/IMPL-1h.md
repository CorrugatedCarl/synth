# Stage 1h: GPU faces and grid — every frame exact, nothing re-renders at rest (IMPL-1h) — contract

The user, 2026-10-19, after hotfix 2: "zooming feels better but i do not like how the resolution only renders in when i let go
of zoom. this causes an awful inconsistent feeling in the grid and on the modules themselves", "the dot grid should be treated
like a tool of measurement it should be precise", "it is important to me that no low resolution renderings of the devices in
this app be seen. they should always be rendered at at least 1:1 ratio with respect to their scale in the view".

Both snaps have the same cause: a raster made at the rest zoom (the grid canvas, a hardware face's bitmap tier) is scaled by the
compositor during the pinch and replaced by a fresh raster at rest. Stage 1h draws both on the GPU every frame from sources that
do not change at rest: the **grid as a procedural shader** (exact dot positions, every frame, no store, no transform) and every
**hardware face as a texture** held at **≥ 1 device px per on-screen px** (a mipmapped base texture for k ≤ 1 and a finer
**window** of the visible part for k > 1), composited by one WebGL2 canvas under `#world`. Nothing of a face or the grid is
rasterised at a zoom end; a zoom end only *adds* finer windows where the next zoom-in would need them. Sections 1–5 are the
contract, §6 the lanes, §7 the gates, §8 the builders' notes.

## 1. Invariants (the gates test these)

- **G1 Consistency**: with the same camera, the GL canvas's pixels mid-gesture and at rest are **identical** (readPixels in test
  mode) for the grid and for every face whose window (if k > 1) already covered the visible part. Nothing of the grid or a face
  is redrawn from a new raster at a burst's end; a window that lands later is the only change, and it only *sharpens* a region
  that was shown from the base texture at k > 1.
- **G2 ≥ 1:1**: a face is never sampled below 1 device px per on-screen px while k ≤ 1 (the base texture is d × its world size,
  d = devicePixelRatio ≤ 3) and, above 1, wherever a window covers the fragment (the window's level ≥ d·k, §3.3). Where no window
  covers (k > 1 right after a pan revealed a new region, or beyond the window's headroom, §3.3), the base texture shows until
  the window lands at rest — documented, measured, minimised (§3.4).
- **G3 Precision**: a grid dot's centre is at the exact screen position of its world multiple (sub-pixel; anti-aliased edge of
  one device px), every frame. Dot sizes stay what `gridSizes(d)` says (device px), the minor fade is `gridBg(cam).minor.a`,
  the visibility floors are `GRID_MIN_DPX` — the same maths as the 2D path, which stays as the fallback.
- **G4 Fallback**: without WebGL2 (or after an unrecoverable context loss) the hotfix-2 2D grid and the 1g bitmap tier run as
  today, unchanged in behaviour; tests of both keep passing. A context loss during use restores onto the GL path when the
  browser restores the context (textures rebuilt lazily), else falls back live.
- **G5 Nothing else changes**: the DSP, the project format, the module layout, hit-testing, the panels' controls (DOM) and the
  Serum / FX / simple modules are untouched. The hardware face SVG stays in the DOM, `visibility: hidden` while a GL or 2D face
  shows (the one-point hit-test for `data-tip` keeps working as in 1g).
- **G6 Memory**: textures live under a budget (§3.4) reported by `world.glStats()`; every face's textures are freed on unmount
  (`wk.releaseCanvases` path), on context loss, and on `destroy()`. No per-frame allocation on the GL path.

## 2. The GL layer (`cv-gl.js`, new — lane G)

```
createGL(viewport, o) → null | GL           // null: no WebGL2 (or o.disabled); the world then keeps the 2D grid
  o: { doc, win, test (preserveDrawingBuffer for readPixels), onLost(), onRestored() }
GL.canvas                                   // <canvas class="cv-gl"> inserted where the 2D grid canvas sits (under #world)
GL.resize(vw, vh, d)                        // drawing buffer = round(vw·d) × round(vh·d) (no overscan, no transform)
GL.upload(src, o) → Tex | null              // src: HTMLCanvasElement | ImageBitmap | ImageData; o: { mips: boolean }
                                            // Tex: { w, h (px), bytes (incl. mips ×4/3), mips } — RGBA8, premultiplied, LINEAR
                                            //   (mips: LINEAR_MIPMAP_LINEAR; NPOT is fine in WebGL2), CLAMP_TO_EDGE
GL.free(tex)                                // idempotent
GL.draw(cam, vw, vh, d, quads)              // one frame: clear (transparent), the grid, then the quads in order
GL.stats() → { frames, ms (total draw time on the main thread), max, bytes (textures live), texes, lost }
GL.destroy()
Quad: { tex, x, y, w, h,                    // the texture's world rect (world px: tex.w = w·level, level = device px per world px)
        clip: { x, y, w, h, r: [tl, tr, br, bl] } | null,   // a rounded world rect the quad is cut to (the module body)
        alpha: 1 }
```

- **The grid shader**: a full-canvas triangle; uniforms `tx, ty, k, d, vw·d, vh·d`, dot sizes (`gridSizes(d)`), `minorA`
  (`gridBg(cam).minor.a`), the floors. In the fragment shader the world point of the pixel centre is
  `w = ((p + 0.5)/d − t)/k` per axis; the nearest multiples of `DOT` and `MAJOR` give the distance to the dot centre in device
  px (`|frac·DOT·k·d|` folded); a **minor** dot is a square of side `side` (coverage = clamp of the box distance, one px
  anti-aliasing ramp), a **major** dot a disc of radius `r` (coverage = `smoothstep(r + 0.5, r − 0.5, dist)`); colours and
  alphas exactly as `gridDraw` (minor `rgba(233,231,226, 0.15·a)`, major `rgba(233,231,226, 0.24)`), premultiplied blend
  `ONE, ONE_MINUS_SRC_ALPHA`. Minor dots only when `a > 0 && DOT·k·d ≥ GRID_MIN_DPX`; major when `MAJOR·k·d ≥ GRID_MIN_DPX`.
  `GRID_MAX_DOTS` does not apply (the shader's cost is per pixel). Pure helper `gridUniforms(cam, vw, vh, d)` (exported, node
  tested) returns the uniform values the shader gets.
- **The face shader**: a textured quad per `Quad` (unit quad × model matrix from the camera; `texture()` with the mip filter),
  cut by the rounded-rect SDF of `clip` in world space (one px anti-aliasing at the edge), × `alpha`. Draw order = the array's.
- **Context loss**: `webglcontextlost` (preventDefault) → every Tex is dead (`GL.free` is a no-op on them), `onLost()`;
  `webglcontextrestored` → programs rebuilt, `onRestored()` (owners re-upload). Three losses within a minute → `GL.destroy()`
  and the world falls back (G4).
- **Performance**: no allocation per frame; one `uniform*` set + 1 draw for the grid, 1 draw per quad; `draw` is only called
  by the world (per written frame, at rest, on resize, on `faces.onChange`) — never from a ticker of its own.
- **cv-world.js (lane G owns the integration)**: `buildGrid()` tries `createGL` first (a `?nogl` URL flag or a pref
  `synth.cv.gl = 'off'` forces the 2D path; tests/ui-bench use the flag to compare); on the GL path the 2D grid canvas is not
  created, `gridAt()`/`gridPlace()` are not called, and `write()`, `endBurst()`, resize and the dpr watch call
  `GL.draw(cam, vp.width, vp.height, dpr(), FACES.quads(rectOf, cam))` instead; `gridStats()` reports the GL draws
  (`n`, `ms`, `max`, `moves: 0`, `gl: true`). `world.glStats()` (null on the 2D path) = `GL.stats()` + `FACES.stats()`.
  The world exposes `rectOf(id)` (the cached rect, null unknown) and keeps emitting `'camera'` / `'cameraend'` / `'screen'`.
  The world calls `FACES.attach({ gl: GL, world })` once the GL exists and `FACES.detach()` on destroy / fallback.
  `#viewport > .cv-gl` gets the `.cv-grid` CSS (absolute, 0 0, pointer-events none; **no** `will-change`, no transform).

## 3. Faces (`cv-face.js`, new; `cv-panel.js`, `wk.js`, `style.css` — lane F)

### 3.1 Registry

`cv-panel.js` registers each hardware face instead of (and falling back to) `faceTier`:
```
FACES.register(deco, { markup, w, h, img, moduleOf, offset, tip }) → Face     // from renderPanel (1g's faceTier site)
Face: { refresh(), drop(), destroy(), readonly mode: 'gl' | 'dom' | 'svg', readonly tier (the 1g tier when mode is 'dom') }
```
- `moduleOf()` → the `.cv-mod` ancestor's `data-cv-mod` id (null while unmounted). `offset()` → `{ x, y }` of the deco's top-left
  inside the module (world px; measured once at mount and after `setW` / a relayout via `offsetLeft/offsetTop` up the positioned
  ancestors to `.cv-mod` — a layout read outside bursts only, cached). The face's world rect = `world.rectOf(id)` + offset.
- `mode`: `'gl'` when the GL layer is attached, the module is mounted and not folded, and the module **overlaps no other
  mounted hardware module** (§3.5); `'dom'` = the 1g bitmap tier (`faceTier`, unchanged) for the other mounted cases on the
  GL path and for the whole 2D fallback; `'svg'` = the SVG shows (k ≥ 1 on the 2D path only, as today). In `'gl'` mode the
  SVG is `visibility: hidden` and no `.hw-bm` canvas exists.
- `FACES.quads(rectOf, cam) → Quad[]`: for every registered face in `'gl'` mode with textures: its base quad, then (if k > 1
  and it has a window) its window quad on top; ordered by the modules' z (`el.style.zIndex`, then registration order). Pure
  over the registry: no DOM read.
- `FACES.onChange(fn)`: fired when a quad list would differ (a texture landed, a mode changed, a window changed) — the world
  redraws. `FACES.stats()` → `{ faces, gl, dom, bytes, base, windows, paints, paintMs, paintMax }`.

### 3.2 The base texture (k ≤ 1)

The markup as an Image (Blob URL, as 1g) rastered at **level `L0 = min(d, 3)` device px per world px** onto a scratch 2D canvas
(`w·L0 × h·L0`, reused, released after upload), uploaded with mips. Made once per mount (next frame after mount, like 1g),
rebuilt after a context restore, freed on unmount / destroy. Until it lands the SVG shows (`'svg'`; a one-frame state on
mount, exactly as 1g's "until the load lands"). If the face SVG is not opaque over its box (check all twelve: `L.case`,
`S.panel`), the scratch canvas is first filled with the `.inst`'s computed background colour so the GL face matches the DOM.
Memory at d = 2: 7–28 MB per panel (+ ⅓ mips), all twelve 246 MB — the budget (§3.4) caps it.

### 3.3 Windows (k > 1)

At a zoom end (`'cameraend'`) with `cam.k > WIN_K0 = 0.5`, for every face in `'gl'` mode that is on screen, the **window** is the
visible part of the face grown by `WIN_MARGIN = 0.25` of the viewport on each side (in world px, clipped to the face), rastered
at **level `Lw = min(d·K_MAX, d·WIN_HEAD·cam.k, budget level)`** (`WIN_HEAD = 2`: a 2× zoom-in from rest stays ≥ 1:1; the
budget level = `sqrt(WIN_BUDGET_PX / Σ visible world area)` so all windows together stay ≤ `WIN_BUDGET_PX = 40e6` device px
≈ 160 MB) with `drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh)` from the same Image (the browsers paint the SVG with a clip: the
cost is the elements', not the whole panel's pixels — **measure it**, §7), uploaded **without** mips (it is only sampled at
`d·k ≤ Lw`, ≤ 2× minification; below `d·k < L0` the base quad alone shows: the window quad is not emitted when `k ≤ 1`).
- A window is **kept** while it still covers the face's visible part and its level ≥ `d·k` (zooming out never rebuilds; panning
  inside the margin never rebuilds). It is **rebuilt** when the visible part leaves it or `d·cam.k > Lw` at a rest; **freed**
  when the face leaves the screen (plus `CULL_MARGIN`), when k ≤ `WIN_K0` at a rest, on unmount, on context loss.
- Scheduling: never in a burst; at a rest, one window per animation frame (`raf`), the faces nearest the viewport centre first,
  each paint + upload measured (`paints`, `paintMs`, `paintMax`). A new burst cancels the rest of the queue (the base shows).
- While a window is missing or stale at k > 1, the base quad shows under it (soft above 1:1 — G2's documented residual); when
  the window lands, `onChange` → one redraw: the region sharpens. It is the only visible change at rest, and only at k > 1.

### 3.4 Budget

`FACE_BUDGET_BYTES = 384e6` for base + window textures together (`FACES.stats().bytes`). Over it: windows of off-screen faces
go first, then bases of off-screen faces farthest from the viewport (they rebuild when they come within `CULL_MARGIN`, from the
retained Image: a paint of ≤ 30 ms each, one per frame, at rest). A face whose base is missing on screen shows `'svg'`
(visibility) until it lands — never the 2D tier (no re-raster at rest). The numbers are constants at the top of cv-face.js
(the user's iPad decides them; §8 records what was measured).

### 3.5 Overlap

A GL face is drawn under all DOM, so a module lying over a GL-faced module would let the lower module's DOM (bar, controls) show
through its own face. Rule: a mounted hardware module whose rect intersects another mounted hardware module's rect uses
`'dom'` (the 1g tier) for its face while they intersect; it returns to `'gl'` when they part. Evaluated by `FACES` on the
world's `'screen'` event and on `update`/`recache` (cached rects via `rectOf`; never per frame of a camera burst — rects are
world-space). At the moment of a switch the two pictures are the same scale (a module drag never zooms), so the change is
not a resolution change.

### 3.6 CSS

`.cv-mod[data-cv-face="gl"] .inst.hw { background: transparent; }` (the inset highlight and the outer shadow stay); the wood
cheeks (`::before/::after`) stay DOM. `.inst.hw > .hw-decor > svg` stays as today. `cv-panel` sets `data-cv-face` on the
module element (`gl` / `dom` / `svg`) through `Face.mode` changes.

## 4. What moves to the GL path and what does not

| | mid-gesture | at rest | stage 1h |
|---|---|---|---|
| dot grid | transformed store | redrawn | shader every frame, exact (G1, G3) |
| hardware face, k ≤ 1 | scaled bitmap | re-rastered | base texture, mipmapped, every frame (G1, G2) |
| hardware face, 1 < k ≤ 2 | SVG layer scaled by the compositor | SVG re-rastered | window texture ≥ d·k where it covers; base elsewhere until the window lands (G2 residual) |
| hardware controls, module chrome, Simple / Serum / FX modules, mod modules | compositor-scaled | re-rastered by the browser | unchanged (DOM; the browser's own pinch behaviour) — noted in §8 for the user |

## 5. Files and ownership

| lane | owns | must not touch |
|---|---|---|
| G | `cv-gl.js` (new), `cv-world.js`, `style.css` (grid / `.cv-gl` rules only), `tests/cv-world.test.mjs`, `tests/cv-gl.test.mjs` (new), `tests/ui-bench.html` | `cv-panel.js`, `cv-face.js` |
| F | `cv-face.js` (new), `cv-panel.js`, `wk.js` (only if a hook is missing), `style.css` (face rules only), `tests/cv-face.test.mjs` (new), `tests/cv-panel.test.mjs` | `cv-world.js`, `cv-gl.js` |

Both: `index.html`/`main.js` only to import a new module so it is precached (`node tools/precache.mjs --write`; one of them, the
integrator resolves). Each lane writes to the other's interface **exactly as written here** (§2 `GL`, §3.1 `FACES`); a stub of the
other side lives in the lane's tests. The integrator (the lead) merges G then F, runs the fixture check (a page sim mounting one
hardware panel on the GL path with a fake WebGL2 context) and the affected test files one at a time.

Base: canvas `a632dbf`. Every builder: `git reset --hard a632dbf` first (harness worktrees start from `main`), `?v=9` on every
import, `import './v8-guard.mjs'` first in new test files, no fake-DOM nodes in `assert.*`, one test file at a time with
`node --max-old-space-size=2048 --test tests/<file>.test.mjs`, dense comments in the existing voice.

## 6. Lanes, order

1. G and F in parallel (worktrees). 2. Integration + fixture check (lead). 3. Review: a rendering reviewer reproduces G1–G3 in
Chrome through the preview (`?nogl` vs GL, readPixels mid-burst vs rest, a face at k = 0.4 / 1 / 1.6, a pan at 1.6 revealing a
new region, the overlap rule, context loss via `WEBGL_lose_context`), a memory/perf reviewer measures §7, a code reviewer
reads for leaks and the fallbacks. 4. Fixers (failing test first). 5. Docs, deploy, the user's iPad verdict.

## 7. Gates

- Tests: cv-world, cv-gl, cv-face, cv-panel, classic-panel, canvas-sim, cv-shell-sim, cv-fixes-sim, canvas-1e-sim, canvas-2a-sim,
  gesture, lint, pwa green, one file at a time; goldens untouched (no DSP change).
- G1: readPixels equal (mid-burst vs rest, same camera) in Chrome for the grid alone and with two faces at k = 0.4 and k = 1.6
  (window already landed) — scripted in ui-bench ("consistency" row: `equalPx: true`).
- G3: a scripted check of 20 random cameras: every major dot's centre in the readPixels buffer within 0.5 device px of
  `(i·MAJOR·k + tx)·d`.
- ui-bench (Mac, 1440 × 900, dpr 2, five panels): no frame over 33 ms in pan / zoom / deep; `glStats`: draw mean ≤ 1 ms;
  window paints ≤ 30 ms each, ≤ 1 per frame; `bytes` ≤ the budget.
- Memory: `glStats().bytes` with five hardware panels at k = 1 on the iPad-sized viewport ≤ 384 MB; freed to 0 after `clear()`.
- The user's iPad: the pinch past 60 % and up to 200 % with 5 panels — no snap on the grid or the faces, no hitch.

## 8. Notes (the builders fill in)

### Lane F (cv-face.js, cv-panel.js, style.css, tests/cv-face.test.mjs, tests/cv-panel.test.mjs)

**Interface, as built.** `FACES.register(deco, { markup, w, h, img?, moduleOf, offset, tip?, tier, env })` — `tier` is the 1g
`faceTier` factory passed in by cv-panel (cv-face imports nothing from cv-panel: cv-world → cv-face → cv-panel → cv-world
would be a cycle), `env` the tier's / the image loader's test env (cv-panel passes `api.tier` when it is an object, as 1g).
`FACES.attach({ gl, world })`, `detach()`, `lost()`, `restored()`, `attachment()` (the object attach was given, null detached),
`quads(rectOf, cam)`, `onChange(fn)`, `stats()` (`+ queued`), `recheck()` (the overlap rule and the offsets re-read — for a
re-mount main.js makes without a camera move, see the open points). A second `attach` after a `detach` is a restore from
nothing (bases next frame, one per frame, nearest first; windows at that rest), as lane G calls it. `Face.mode` is
`'gl' | 'dom' | 'svg'` where `'dom'` means the 1g tier is active and showing its bitmap and `'svg'` the SVG shows (no tier,
or the tier at k ≥ 1); `Face.shown` (the SVG is replaced) drives cv-panel's one-point data-tip hit-test; `Face.tier` the
1g object. `data-cv-face` on the module is written by FACES at every mode change (`gl` / `dom` (a tier exists) / `svg`).
- The quads follow a **module drag live**: the world's cached rect only updates at the drag's end, so FACES watches the
  module element's `style` with a MutationObserver (the `translate3d` of a live drag, `zIndex`, `left/top` at the drop →
  the overlap recheck next frame) and `data-cv-fold` / `data-off` (`[data-off]` → quad alpha 0.45 = `.cv-body`'s opacity;
  the grayscale(0.7) of a powered-off body is not reproduced on the GL face). Without a MutationObserver (node) a
  `refresh()` reads them. The quad list and its quad objects are reused between frames (no per-frame allocation).
- The unmount hook is a hidden 0 × 0 `canvas.hw-rel` inside the deco (`wk.onRelease`; cv-module's `releaseCanvases(body)`
  finds it) — `.inst.hw > .hw-decor > .hw-rel { display: none }`. `wk.onRescale(deco)` is hooked too (a zoom end re-syncs a
  face re-homed into a module since).
- **Background fill:** every one of the twelve face SVGs leaves parts of its box open (the horizontal centring strip
  `offX` 4–15 px each side, the extras strip 16–280 px tall, gaps between areas): modular 12.5 % of the box uncovered,
  minimoog 25.2, arp2600 10.8, solina 47.2, cs80 19.7, prophet5 18.7, ms20 11.7, tb303 50.3, obxa 15.1, jupiter8 21.6,
  juno60 20.7, dx7 22.3. So every base and window raster is first filled: the `.inst.hw`'s computed `background-color`
  (fallback: the inline `--hw-case` / `--hw-panel`), and for the four wood cases (modular, minimoog, solina, prophet5: a
  gradient background, computed colour transparent) the stripes of `.inst.hw.hw-wood` are painted from `--hw-wood`
  (color-mix as maths, a 14 px period pattern rotated 3° through `CanvasPattern.setTransform`, then the 90° sheen).
- **CSS:** `.cv-mod[data-cv-face="gl"] { background: transparent }` is needed as well as the `.inst.hw` rule — `.cv-mod`
  paints `#101216` under its body, which would hide the GL face. The bar's own gradient, the ring box-shadow and the
  selection ring stay.
- **Raster ceilings (added):** `WIN_MAX_PX = 16e6` px per window (the iOS 2D canvas ceiling — a whole CS-80 width at level
  4 would be 8200 × 2912 = 24 M px) and `TEX_MAX_DIM = 8192` a side (base and window): the level drops to fit
  (`winLevelOf`). The budget level uses Σ of the *window* areas (the visible parts grown by the margin — what is rastered),
  the conservative reading of §3.3 that keeps Σ ≤ WIN_BUDGET_PX true. A window is also planned when a base lands at a
  rest (a face mounted while zoomed in) and at a rest at `k = 1` (level 4: the next 2× zoom-in stays ≥ 1:1).
- **Budget order:** off-screen windows (farthest first), then off-screen bases farthest from the viewport centre; an
  off-screen face only evicts faces farther out than itself (no thrash) and is skipped (its SVG) when it still would not
  fit; an on-screen face is always painted.

**Measured (node, d = 2).** Base rasters: modular 3456 × 1840 (25.4 MB, 33.9 with mips), minimoog 2816 × 944 (10.6 / 14.2),
arp2600 3136 × 1776 (22.3 / 29.7), solina 3968 × 432 (6.9 / 9.1), cs80 4864 × 1456 (28.3 / 37.8), prophet5 3840 × 944
(14.5 / 19.3), ms20 2240 × 816 (7.3 / 9.7), tb303 1216 × 1136 (5.5 / 7.4), obxa 4096 × 1072 (17.6 / 23.4), jupiter8
4288 × 1136 (19.5 / 26.0), juno60 4288 × 752 (12.9 / 17.2), dx7 4096 × 880 (14.4 / 19.2) — all twelve 247 MB with mips.
Windows, iPad 1366 × 1024 at d = 2, one face centred (window = the visible part + the 0.25-viewport margin, clipped to the
face): at k = 0.6 the whole face at level 2.4 (cs80 5837 × 1747 = 40.8 MB, modular 36.6, arp2600 32.1, jupiter8 28.1, obxa
25.3, prophet5 20.9, dx7 20.8, juno60 18.6, minimoog 15.3, ms20 10.5, solina 9.9, tb303 8.0); at k = 1 level 4 capped by the
16 M px ceiling for the big ones (cs80 2050 × 728 → 6712 × 2384 = 64 MB at level 3.27, modular 3.17, arp2600 3.39, obxa 3.82,
jupiter8 3.71; the rest level 4: 22–58 MB); at k = 1.6 the 1282-wide visible strip at level 4 (cs80 5128 × 2912 = 59.7 MB,
modular / arp2600 at 3.68 / 3.75 = 64 MB, the rest 18–47 MB). Five CS-80s tiled in view: k = 0.6 → Σ 35 M px = 140 MB (the
budget level 2.57 does not bind below the 2.4 head), k = 1 → 38.8 M px = 155 MB (the budget level 4.06 just above the 4
cap), k = 1.6 → 2 visible, 57 MB.

**Measured (Chrome 152, Mac M4 Max, dpr 2; drawImage of the CS-80 face from a Blob-URL Image onto a 2D canvas, warm /
cold, read back with getImageData).** The cost follows the *output* pixels, not the panel: base level 2 (4864 × 1456)
2.8–3.7 ms warm (13.5 / 21.9 ms the first two: the SVG's own layout), the whole panel at the 16 M px cap (7953 × 2381)
7.1–8.3 ms (34 cold), the 1282 × 728 window at level 4 (5128 × 2912) 3.9 ms by source rect and 3.9 ms by clip + whole-panel
scale (identical: the browser clips the SVG paint), the 2050 × 728 window at 3.27 (6712 × 2384) 4.5 ms (23.6 cold), a 640 × 360
region at 4 (2560 × 1440) 1.4 ms. So one window per frame at ≤ 8 ms on the Mac; the GL upload is lane G's number. The
iPad's numbers are the user's run (§7).

**Open points for the integrator.**
- A re-mount main.js makes without a camera move (`cvKeep` / a view rebuild re-homing the same `.inst`) reaches FACES only
  at the next zoom end (`wk.rescaleCanvases`) or `'screen'` change: `cvMountBody` could call `FACES.recheck()` after the
  mount (or the world could emit `'screen'` on `add`).
- The viewport size for the windows is read from `world.viewport.clientWidth/Height` at a rest; a `world.size()` getter
  would be cleaner. The camera comes from the `'cameraend'` payload and `world.cam`.
- On the GL path the 'dom' faces (an overlapping / folded module) still rely on `wk.setCanvasScale` + `rescaleCanvases`
  at zoom ends for their 1g bitmap — keep those calls on the GL path.
- The patching dim (`#world[data-cv-patching="mod"] .cv-mod.cv-nodest > .cv-body { opacity: .35 }`) does not reach a GL
  face (only `[data-off]` is mirrored as alpha).
