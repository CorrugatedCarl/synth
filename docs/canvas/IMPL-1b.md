# Stage 1b implementation contract (IMPL-1b)

| | |
|---|---|
| Stage | **1b Canvas shell** (SPEC-canvas §10 1b): the canvas, top tray, keyboard tray, Sources tray with drawings; today's instrument and its FX as movable modules; read-only cables; pinch/pan |
| Authority | [SPEC-canvas.md](SPEC-canvas.md) wins on *what*; this file fixes *how*, *who* and *where* so three lanes can build in parallel. Its final "User decisions (2026-10-17)" section overrides everything. A conflict between this file and the spec is a question for the lead, not a choice for a lane |
| Lanes | **SHELL** (trays, DOM, CSS, drawings) · **WORLD** (camera, gestures, transform safety) · **MODULES** (modules, cables, layout persistence) |
| Branch | `canvas`. Never switch branches, commit, push or touch `main`; the lead commits and deploys |
| Already in the tree | Stubs `cv-world.js`, `cv-module.js`, `cv-cables.js`, `cv-tray.js`, `cv-art.js` (API + JSDoc, bodies throw); empty test files (§8); `main.js` imports of the five modules, the stage-1b region with every cross-lane entry point as a no-op stub, the `initShell(); initWorld(); initModules();` boot line, the Escape / canvas-key / wheel-veto hook lines; the two owned section markers at the end of `style.css`; `sw.js` regenerated |
| Running beside 1b | Stage 1a (another lane): `appstore.js` namespace (`synth.*` names stored as `synthc.*`, database `synth-canvas`), `cv-migrate.js` (`SCHEMA = 1`, `upgrade`, `stamp`, `camKey`, read-only gate), `cv-graph.js`, `cv-mods.js`, the platform message. 1b builds on its `project.uid`, `CM.SCHEMA` and `CM.camKey` (§4.9) |

---

## 0. Ground rules (every lane)

1. **No DSP or compile file changes.** `git diff main -- engine.js serum-dsp.js fx-dsp.js fx-mods2.js sx-base.js sx-filt2.js sx-warp.js sx-mod.js sx-sample.js sx-gran.js sx-spec.js sx-seq.js serum-core.js fx-core.js models.js laws.js tuning.js` must stay empty. Importing (reading) them is fine.
2. **User decisions applied here**: pinch on the canvas zooms the canvas (a transform of `#world`, nothing reflows); native page zoom stays over the trays, and while the page is natively zoomed the canvas hands every gesture back; the viewport meta is never rewritten and there is no app-owned page zoom; FX panel = pedalboard (today's `FXRackUI`); start fresh (no library import/export); mouse drag on empty canvas pans (Shift-drag box-select is 1c); mod cables always shown (none exist before 2a); knob undo keeps today's policy; `gesture.js` two-finger false-press protection stays and is extended, not replaced.
3. **Parallel editing.** Edit only the files and regions §2 gives your lane. Re-Read the exact region right before each Edit; anchor edits on symbol names, never on line numbers; never rewrite `main.js`, `index.html`, `style.css` or a test file wholesale; never revert or reformat someone else's lines (the 1a lane edits `main.js`, `appstore.js`, `cv-migrate.js` at the same time). Match the house style: dense code, terse `//` comments that say why.
4. **Memory safety** (the Mac crashed twice). Never run the full suite or a glob. One file at a time: `node --max-old-space-size=2048 --test tests/<file>.test.mjs`. New tests import `'./v8-guard.mjs'` first, import site modules with `?v=9`, and never hand fake-DOM nodes to `assert.*` (compare ids, strings, numbers; `tests/serum-ui.test.mjs` has a safe `assert` proxy to copy). File search only inside the project and the scratchpad; never disk-wide.
5. **Node-safe modules.** `cv-*.js` are plain ES modules with no DOM, `window` or storage access at module top level (node imports them). Every runtime path must also survive `tests/main-sim.mjs`'s DOM stub: no `ResizeObserver`, `visualViewport`, `getComputedStyle`, `PointerEvent` or `CSS`; `document.querySelectorAll()` returns `[]`; an element's `querySelector()` returns a **fresh inert node**, `closest()` returns null. So: guard every optional browser API, keep references to the nodes you create (never query them back), and never let a missing API throw out of `boot()`.
6. **Imports carry `?v=9`.** After any change to a site file run `node tools/precache.mjs --write` (sw.js BUILD; `tests/pwa.test.mjs` and `tests/lint.test.mjs` check it). Every `.js` in the root must stay reachable from `main.js` (the pwa crawl).
7. **Usable at every checkpoint.** Each lane's work must leave the app working with the other lanes' stubs (§6 says how). Desktop and iPad must both work; every feature of today's app stays reachable (§7).
8. **Done** for a lane = its tests green (§8), the gate set green (§8.4), the preview checked at 1440×900, 1366×1024 and 1024×1366 with no console errors (viewport emulation reset afterwards), and a short hand-back note to the lead: files touched, tests run, anything left for another lane.

---

## 1. What 1b delivers

The page becomes one fixed, full-screen view: the **top tray** (one compact row; a grip reveals the arrangement toolbar, ruler and track rows), the **canvas** between the trays, the **keyboard tray** as the footer, and two **side trays** opened by a tap on their 44 px rails (Sources left with procedural drawings, Effects right). On the canvas the selected track shows three movable **modules**: its **instrument** (today's `#inst`: the classic `renderPanel` panel or the whole `SerumUI`), its **FX module** (today's `FXRackUI`: a classic track's rack as "FX Panel", a Serum's three racks as "Serum FX (own)") and **OUT** (today's scope), joined by **derived, read-only cables**. The camera pans, pinches, zooms with the wheel/trackpad and remembers itself per project and track on this device. Module positions, widths and folds persist in `track.lay` with one undo step per move. `CANVAS │ ROLL` replaces the Instrument/Piano Roll/FX tabs.

---

## 2. Ownership

### 2.1 Files

| File | Owner | Scope in 1b |
|---|---|---|
| `index.html` | SHELL | the whole shell structure (§3.1); WORLD and MODULES never edit it (ask the lead) |
| `style.css` | SHELL, except the two sections at the end | SHELL rewrites the layout above the markers. WORLD owns the text between `/* ===… cv-world` and `/* ===… cv-module`; MODULES owns everything after `/* ===… cv-module` (it stays the last section) |
| `cv-tray.js`, `cv-art.js` | SHELL | §4.6, §4.7 |
| `cv-world.js` | WORLD | §4.1 |
| `gesture.js` | WORLD | §4.2 |
| `wk.js` | WORLD | the additions of §4.3 only |
| `graph.js`, `fx-ui.js`, `wtedit.js`, `sx-ui-osc.js`, `sx-ui-seq.js`, `serum-ui.js` | WORLD | transform-safety edits only (§5.2.6): `localPoint` sites, canvas sizing from layout px, `onRescale` registration, the LFO-editor overlay into the top layer, Serum popover position maths, viewport `@media` audit. No feature change |
| `cv-module.js`, `cv-cables.js` | MODULES | §4.4, §4.5 |
| `song.js` | MODULES | the `lay` whitelist (`normLay`) in `deserialize` only (1a owns `uid`/`schema`, via `cv-migrate.js`) |
| `cv-migrate.js` | 1a lane | MODULES makes only the 1b schema bump (§4.9), after 1a has landed; or the lead does it at integration |
| `pwa.js` | SHELL | only if the ≡ menu needs it (the ids `#install`, `#fullscreen`, `#installSheet`, `#update` are kept) |
| `sw.js` | generated | `node tools/precache.mjs --write`, by any lane after its changes (deterministic from the tree) |
| `tests/main-sim.mjs` | MODULES | SHELL and WORLD may add helpers **additively** at the end of the `Object.assign(sim, {…})` block (re-read first) |
| `tests/keyboard.test.mjs`, `tests/pwa.test.mjs` (and `tests/main.test.mjs` only if a shell change breaks it) | SHELL | adapted to the shell, keeping their intent |
| `tests/gesture.test.mjs`, `tests/wk.test.mjs`, `tests/wk-dom.mjs` | WORLD | additions; `wk-dom.mjs` gains `offsetWidth/Height` and whatever the transform tests need |
| `roll.js`, `arrange.js`, `midi.js`, `assets.js`, `appstore.js`, DSP/compile files | nobody | not edited in 1b |

### 2.2 Shared-file rules

- **CSS cascade between sections**: SHELL's rules come first; the cv-world section can override them by order (same specificity); the cv-module section last. SHELL sets only the **geometry** of the CANVAS view's children (`#viewport`, `#overlay`, `#cvToolbar`, side trays: position, inset, z-index) and, until WORLD lands, may give `#viewport` `overflow: auto` so the interim stacked panels scroll; WORLD's section then sets `#viewport { overflow: clip; touch-action: none; … }` and wins by order.
- `tests/pwa.test.mjs` forbids the substring `touch-action: pan-x pan-y` in style.css (the old app zoom): the native hand-over writes `touch-action: manipulation` (= pan-x pan-y pinch-zoom), page-zoom mode writes `touch-action: pinch-zoom`.
- No inline `<script>` in index.html, one static viewport meta (pwa.test).

### 2.3 `main.js`

The stage-1b region sits just above `/* ---…--- boot */`. Each lane replaces only the bodies of **its** stubs there, adds its own helpers inside its sub-region, and edits only the existing functions listed for it below. Calling another lane's functions (and any other main.js function) is allowed; editing them is not.

| Lane | New / stub functions (stage-1b region) | Existing functions it may edit |
|---|---|---|
| SHELL | `initShell()`, `cvShellEscape()`, `cvOpenSources(mode)` + its helpers | `renderNav`, `instPicker`, `openTab`, `tabTrackUI`, `renderHeads`, `initTransport` (only the `#aAdd` binding and new button bindings), `initKbView`, `applyKbHeight`, `setKbHeight`, `setKbHidden`, `kbMaxH`, `kbChrome`, `kbDefH`, `rangeUI` (the `Bars ▾` fold), `boot` (the `openTab(store.get('synth.tab', …))` line and `relayout()` only) |
| WORLD | `let world`, `initWorld()`, `cvWorldEscape()`, `cvWorldKey(e)`, `cvWheelVeto()` + helpers | `boot`'s first statement only: `installGestures(window, hooks)` (§4.2) |
| MODULES | `initModules()`, `cvRender()`, `cvDropInstrument(modelId, at)`, `cvReveal(trackId, key)`, `cvModuleSize(modelId)`, `cvTidy()` + helpers (`cvLive`, `peerRefresh`, camera save/restore) | `renderViews`, `renderPanel`, `renderCustom`, `sxPanel`, `fxTab`, `dropFxTab`, `renderFxTab`, `monitors`, `sxHost` (its `edit`/`editFx` lines), `fxHost` (its `editFx`/`edit` lines), `duplicateTrack` (one line: copy `lay`) |
| (architect, done) | imports of the five cv modules; the stub region; `initShell(); initWorld(); initModules();` in `boot` after `initTransport()`; in `initKeys` the Escape line `if (cvShellEscape() \|\| cvWorldEscape()) return;` and `if (cvWorldKey(e)) return;` before `const mod = …`; `cvWheelVeto()` in `wheelIn` | – |

Not edited by any lane in 1b: `selectTrack`, `setTrackModel`, `addTrack`, `deleteTrack`, `applyRestore`, `loadProject`, `freshProject`, `edit`, `changed`, `drawScope`, `frame` (beyond what §5 names), the audio/transport/recording code.

---

## 3. Shell DOM, attributes, coordinates

### 3.1 The tree (SHELL builds it in index.html; ids are the contract)

```
<body>
  <svg defs …>                              (main.js boot prepends it, unchanged)
  #app.cv-app                               position: fixed; inset: 0; height: 100dvh; overflow: clip;
                                            display: grid; grid-template-rows: auto 1fr auto; z-index: 0
    header#topTray.top.cv-top [data-wk-inset=top]                 z 30, safe-area top padding
      .cv-row#topRow                        the collapsed row, 48 px
        button#appMenuBtn (≡)  + div#appMenu.cv-pop[hidden][role=menu]:
            #fNew #fOpen #fFile(input, hidden) #fSave #fMidi #fBounce #install #fullscreen #helpBtn
        div#transport.transport.cv-transport:
            #tStart #tPlay #tRec · .tpos(#tBBT #tTime) · #tBpm · #tSigN #tSigD · #tLoop #tMetro #tCount · #tUndo #tRedo
        div.cv-trk: button#trkChip.cv-tchip (colour, name, ▾ switcher) + div#trkPop (the track list) · span#trkDots · span#tabTrack
        nav.tabs.cv-tabs: button[data-tab=canvas] "CANVAS" · button[data-tab=roll] "ROLL"
        div.engine.cv-engine: #power · label(#master) · .meter(#rate #cpu .latf(#latL #lat #latPop…)) ·
            button#gearBtn (⚙) + div#gearPop.cv-pop[hidden]: #masterG (≤ 1099 px, mirrors #master) #sr #os #drift #tRecMode #tInQ select#pinchMode
      div.arrbar#arrbar                     32 px: #aAdd #aMulti #aRange #aCopy #aPaste #aDup #aClear #aDel #aIns #aLoopSel, label(#tBars)
      section#studio.studio > div#arrwrap.arrwrap > div#heads.heads + div#lanes.lanes
      div#topGrip.cv-tgrip [role=slider]    the top tray's grip (bottom edge; `.cv-grip` is the module width grip's class)
    main#stage.cv-stage                     position: relative; min-height: 0; z 0
      div#tab-inst.cv-view                  the CANVAS view (today's Instrument-tab id kept: hidden ⇔ ROLL shows, so
                                            monitors.wanted, openTab and main.test keep working unchanged); inset 0
        div#viewport.cv-viewport [tabindex=0][aria-label="Track canvas"]   position: absolute; inset: 0
          div#world.cv-world [data-cv-world]  0×0, transform-origin 0 0
            div#cvParts.cv-parts            NOT hidden: today's parts, stacked at the world origin until MODULES takes
                                            them (§6; SHELL gives it an interim layout: absolute at 24, 24, width
                                            1200 px, a column with gaps — a 0×0 parent would squeeze it). Children, ids unchanged:
              section#inst.inst [aria-label="Instrument panel"] (with #boot, noscript)
              section#fxrack.fxtab [aria-label="Effects rack"]
              div.scope (canvas#scope, .scope-ctl buttons data-mode wave|fft)
              div.about (h2#about-title, p#about, div#algo[hidden])
        div#overlay.cv-overlay              untransformed, pointer-events: none; z 5 (ghosts, drop outlines, snap guides)
        div#cvToolbar.cv-toolbar            bottom-left floating toolbar (WORLD fills it); z 10
        aside#srcTray.cv-side.cv-left [data-wk-inset=left]     rail (44) + panel (240) + grip#srcGrip; z 20
        aside#fxTray.cv-side.cv-right [data-wk-inset=right]    same, right edge; z 20
      div#tab-roll.tab[hidden]              #rolltools, #rollwrap[data-gesture=own], p.rollhelp — sized by #stage
    section#perf.perf [data-wk-inset=bottom][data-gesture=perf]   z 25; contents unchanged (#kbGrip, #notice, .kbctl, #kbrow[data-gesture=music] …)
  div#helpParts[hidden]                     p.help (today's play/studio/app help) + the footer text (.foot) — the ≡ → Help sheet
  div#ov.cv-ov                              the top layer: position: fixed; inset: 0; pointer-events: none (children auto); z 55
  #modal  #installSheet  #update  #tip      unchanged, at body level
```

- `#models` (model nav), `nav.tabs` with `inst/roll/fx`, `#tab-fx`, `.fxbar`/`#fxtitle`, `.console` and `footer.foot` disappear as such; their contents move as §3.2 says. **Removing an element whose id another lane's function reads breaks boot**: SHELL removes `#models` only together with its new `renderNav`/`instPicker`; `#tab-fx` and `#fxtitle` are only read null-safely or behind `#tab-fx` (`renderViews`, `openTab`) until MODULES rewrites `renderViews`/`renderFxTab`; `#tab-inst` stays (above).
- The side trays belong to the CANVAS view (in ROLL their rails would cover the roll's keys); `cvOpenSources()` from ROLL first opens CANVAS.
- z-index scale: inside `#app` (its own stacking context): `#stage` 0, `#perf` 25, `#topTray` 30 (its popovers `≡`, `⚙`, `#latPop` overlay the stage). Inside `#tab-inst`: `#viewport` auto, `#overlay` 5, `#cvToolbar` 10, side trays 20. Inside `#world`: `svg.cv-cables` 0, `.cv-mod` 1…9999 (`lay.z`; bring-to-front renormalises past 9999), `svg.cv-cable-ends` 10000. Body level: `#ov` 55, `.tip` 50, `.modal` 60, `.toast` 70, `.wk-pop`/`.wk-ctx` 1000, `.wk-tip` 1002, `.sx-ghost` 1100 (unchanged).

### 3.2 Where today's elements go

| Today | 1b | Who |
|---|---|---|
| `header.top`: brand, `#power`, `#sr`, `#os`, `#drift`, `#master`, meter (`#rate`, `#cpu`, `#lat`, `#latPop`), `#install`, `#fullscreen` | brand → the `≡` glyph; `#power`, `#master`, meter, `#lat` → top row (engine group); `#sr`, `#os`, `#drift` → `⚙`; `#install`, `#fullscreen` → `≡` | SHELL |
| `#transport` children | top row; `#tRecMode`, `#tInQ` → `⚙`; `#tBars` → arrangement toolbar; file buttons → `≡` | SHELL |
| `.arrbar` | `#arrbar` row (expanded tray); below 1000 px the edit buttons fold into `Bars ▾`, `#aRange` stays | SHELL |
| `#arrwrap` (`#heads`, `#lanes`) | top tray rows (height from the grip; replaces `.arrwrap { max-height: 340px }`) | SHELL |
| `nav.tabs`, `#tabTrack` | `CANVAS │ ROLL` + `#tabTrack` in the top row | SHELL |
| `#tab-inst` (Instrument tab) | the CANVAS view container (same id) | SHELL |
| `#models` | Sources tray (tap = replace, drag = replace / new track) | SHELL (tray), MODULES (replace) |
| `#inst` | instrument module body | MODULES |
| `#fxrack` (FX tab) | FX module body, always mounted | MODULES |
| `#scope` + `.scope-ctl` | OUT module body | MODULES |
| `#about-title`, `#about`, `#algo` | instrument `⋯ → About` sheet (in `#ov`) | MODULES (SHELL's `sheet()` helper) |
| `.help`, `footer.foot` | `≡ → Help & about` sheet | SHELL |
| `#tab-roll` | ROLL view, sized by `#stage` (no more `clamp(300px, 100vh − 400px, 640px)`) | SHELL |
| `#perf` | footer row of `#app` (no longer `position: sticky`); grip on `cvTray.trayGrip` | SHELL |

### 3.3 Attributes, classes, variables

| Name | On | Set by | Meaning |
|---|---|---|---|
| `[data-cv-world]` | `#world` | SHELL (html) | the transformed world; `gesture.js` and `wk.layer()` look for it |
| `--ik` | `#world` | WORLD | `1/k`, updated at zoom end only; hit areas and cable strokes use it |
| `[data-cv-busy]` | `#viewport` | WORLD | a gesture or camera animation runs (`#world` gets `will-change: transform` only then) |
| `[data-cv-native]` | `#viewport` | WORLD | `visualViewport.scale > 1`: hand-over, `touch-action: manipulation` on viewport, module backgrounds and bars |
| `[data-cv-lod="body\|card"]` | `#viewport` | WORLD | the current level of detail |
| `.cv-mod[data-cv-mod="<id>"][data-cv-kind="inst\|fx\|out"]` | module root | MODULES | a world item; `gesture.js` zone rule |
| `[data-cv-sel]`, `[data-cv-edit]` | module root | WORLD | selected; in edit state (selected and k ≥ 0.9, or after a bar double-tap until tap outside / Escape / k < 0.9) |
| `[data-cv-view="body\|card"]`, `[data-cv-fold]` | module root | MODULES | what the module shows |
| `.cv-bar[data-cv-bar]` | top bar | MODULES | 40 world px, `touch-action: none` |
| `.cv-body` | body wrapper | MODULES | a background (pans) |
| `.cv-jack[data-cv-jack="<mod>.<jack>"]` | jack | MODULES | hit circle `calc(44px * var(--ik))` |
| `svg.cv-cables`, `svg.cv-cable-ends` | in `#world` | MODULES | cable layers |
| `[data-wk-inset=left\|right]` | side trays | SHELL (html) | edge-pan bands exclude them (`wk.visibleBand`) |

### 3.4 Coordinates and the camera

- **client px**: `e.clientX/Y` (layout viewport; native page zoom does not change them).
- **local px**: client − `#viewport`'s rect origin (cached; refreshed on resize / ResizeObserver, never per frame).
- **world px**: canvas units before zoom. Camera `{ tx, ty, k }`: `local = world · k + t`, `world = (local − t) / k`. `#world` style: `transform: translate(${tx}px, ${ty}px) scale(${k})`.
- Zoom about local point c: `k' = clampK(k · f)`, `t' = c − (c − t) · k' / k` (the content under c stays).
- `panCam(cam, dx, dy)` takes a **finger** delta (content follows the finger: `t += d`). `gesture.js` hooks pass **scroll-convention** deltas (`sx = −Δmidpoint`), so the world applies `panCam(cam, −sx, −sy)`.
- Module geometry: a module's `lay` entry is its top-left in world px (bar included); `rect()` adds the measured width/height (folded: `BAR_H`).
- **Layout px inside an element** (any editor under the transform): `wk.localPoint(el, e) = ((e.clientX − r.left) · el.offsetWidth / r.width, (e.clientY − r.top) · el.offsetHeight / r.height)` with `r = el.getBoundingClientRect()` (border-box origin; subtract `clientLeft/Top` for the padding box). Exactly `1/k` on the canvas, 1 elsewhere, also right under native page zoom; a zero-size rect gives scale 1. HTML elements only (for SVG use the nearest HTML ancestor). Sizes for drawing come from `clientWidth`/`offsetWidth` (layout), never from `getBoundingClientRect().width` (screen). Screen-space quantities stay screen-space on purpose: knob drag sensitivity, touch slop, hit radii in screen px, `contextMenu(x, y)` and tooltips (they live outside the world).
- Pieces outside the world (`#overlay`, `#ov`, `.wk-pop`, `#tip`, ghosts) work in client px; the world converts with `toWorld`/`toClient`.

---

## 4. Public APIs

The stubs in the root carry these signatures with JSDoc; a lane may add exports, never change or remove one listed here without the lead.

### 4.1 `cv-world.js` (WORLD)

Constants: `K_MIN = 0.25`, `K_MAX = 2`, `CARD_K = 0.5`, `EDIT_K = 0.9`, `GRID = 8` (snap; the visible dot grid uses 4·GRID), `CULL_MARGIN = 256` (screen px), `SLICE_MS = 12`, `MOMENTUM_GUARD_MS = 120`, `WHEEL_VETO_MS = 300`, `BUDGET_EL = 9000`.

Pure (node-tested): `clampK(k)`, `toWorld(cam, lx, ly)`, `toLocal(cam, wx, wy)`, `zoomAbout(cam, f, lx, ly)`, `panCam(cam, dx, dy)`, `fitCam(rects, vw, vh, {pad = 48, kMax = 1})`, `visibleRect(cam, vw, vh, margin)`, `intersects(a, b)`, `gridBg(cam, g)`, `snap(v, g = GRID)`, `lodOf(k, prev, pinching)`, `planMount(items, cam, vw, vh, {margin, budget, lod}) → {body: ids (mount order: nearest the centre first), card: ids, why: {id: 'zoom'|'cull'|'budget'}}`.

`createWorld(viewport, o) → World`, `o = { world, overlay, toolbar?, layer?, isBackground?, onTidy?, store?, env? }` (`layer`: `#ov`, passed to `wk.setLayer`; `isBackground`: `cvModule.isBackground`; `store`: appstore for the pinch-mode pref; `env`: `{win, doc, raf, caf, now}` for tests). It must succeed in main-sim's DOM stub.

**World** (also typed in the stub):

| Member | Contract |
|---|---|
| `cam`, `k`, `native`, `movedAt`, `selected`, `edit`, `pinchMode` | read-only state (`cam` is a copy) |
| `setCamera(cam, {animate})`, `panBy(dx, dy)` (local px, finger convention), `zoomAt(f, clientX, clientY, {animate})` | camera changes; every applied frame emits `camera`, the first of a burst `movestart` (+ `wk.closeTransient()`), the end of a burst (gesture end / animation end / 150 ms after the last wheel) `cameraend {cam, zoomed}`; `zoomed` → `--ik` updated, `wk.setCanvasScale(k)` + `wk.rescaleCanvases(el)`, LOD re-planned. Animations ≈ 200 ms, none under `prefers-reduced-motion` |
| `fit({ids, animate, kMax = 1})` | all (or `ids`) items inside `band()` with 48 px padding |
| `focusItem(id, {k, animate, edit = true})` | centre the item at `o.k` (default 1; fit instead when the item is larger than the band at that k — but a fit that would land below `CARD_K` frames the item's width at ≤ k, never below `CARD_K`, top aligned, left aligned when still wider: §10.9); selects it and, with `edit`, puts it in edit state (the bar double-tap) |
| `reveal(elOrRect)` | minimal pan so the client rect lies inside `band()` minus 16 px (also used by the focusin handler) |
| `toWorld(clientX, clientY)`, `toClient(wx, wy)` | conversions with the cached viewport origin |
| `band()` | the canvas's visible client rect: `#viewport` rect ∩ `wk.visibleBand(doc)` (visual viewport minus `[data-wk-inset]` trays/rails, minus the software keyboard) |
| `add(item) → remove`, `remove(id)`, `update(id?)`, `clear()`, `ids()` | world items (§4.4 Module implements Item). `update` after a size change re-plans culling |
| `select(id \| null)` | `[data-cv-sel]`; emits `select`; edit state follows (`edit`) |
| `dragPointer(p \| null)` | `p = {x, y, pointerType}` client px of a live drag. While set: edge auto-pan with `wk.edgePan2` against `band()` (a pointer over a tray = past the edge, full speed); each panned frame emits `camera` so the drag re-projects |
| `ghost(g \| null) → Rect \| null` | the true-size drop outline in `#overlay`: `g = {x, y (pointer client px), w, h (world px), dx?, dy? (box top-left offset from the pointer, world px; default centred), snap = true, label?}`; re-projected every camera frame so it stays under a still pointer; returns the (snapped) world rect |
| `setActive(on)` | CANVAS view shown / hidden (stops loops, momentum, re-measures on show) |
| `setPinchMode('canvas' \| 'page')` | user decision default `'canvas'`; stored as `synth.cv.pinch` |
| `resize()` | re-measure (also from its own ResizeObserver / `resize` listener) |
| `hooks.pan(sx, sy, at)`, `hooks.zoom(f, cx, cy, at)` | for `installGestures` (§4.2): claim (true) only when `at` lies in `band()`, not `native`, and `pinchMode === 'canvas'` (both hooks: in 'Zoom page' two fingers are the browser's, SPEC §4.3); else false |
| `wheelVeto()` | `movedAt > now − WHEEL_VETO_MS` |
| `escape()`, `key(e)` | Escape chain (drag → edit → selection; true if consumed); canvas shortcuts while `document.activeElement` is inside `#viewport`: `0` fit, `1` 100 % (about the centre), arrows nudge the selected module one GRID (Shift: 4) as one undo step through the item's `onMove`, `⌘/Ctrl-A` selects all (single selection in 1b: no-op allowed). Never Space or a play key (A–; W E T Y U O P Z X C V) |
| `on(type, fn) → off` | `camera` (cam), `movestart`, `cameraend` ({cam, zoomed}), `lod` ({lod}), `native` ({on}), `select` ({id}), `edit` ({id}) |
| `destroy()` | removes every listener and loop |

Item (implemented by cv-module's Module): `{ id, el, rect() → {x, y, w, h} (world), cull: 'hide' \| 'unmount', cost?, view(v: 'body' \| 'card', why?) }`. The world never touches an item's body; it calls `view()` sliced (≤ `SLICE_MS` per frame, nearest the centre first), never during a pinch that crossed `CARD_K` (deferred to its end), and cards first on `clear()` + re-add (track switch).

### 4.2 `gesture.js` (WORLD)

`installGestures(win, { pan?, zoom?, now, event, setTimeout, clearTimeout })` (API header updated):

1. **`pan(sx, sy, at) → boolean | void`**: a nav session's script pan (scroll convention: `sx = −Δmidpoint x`, CSS px; `at = {cx, cy}` the session base midpoint, client px). `=== false` falls through to today's scroller chain and page pan (fixes `panBy`, which today returns whenever `o.pan` exists). Anything else = consumed (the existing tests' recorder returns a number).
2. **`zoom(f, cx, cy, at) → boolean | void`**: `frame()` tracks the finger spread as well as the midpoint; zoom engages once the spread changed by `PINCH_PX = 6` (physical px, divided by `visualViewport.scale` like the other distances) and rebases then (f starts at 1: no jump). Per frame: `pan` first, then `zoom` with `f = spread now / spread at the last applied frame` and the current midpoint. `false` → ignored. Export `PINCH_PX`.
3. **A camera pan is never rolled back**: nothing to change in `gesture.js` (the world registers no `claim()`); on the synthetic `pointercancel` (`e.gesture === 'two-finger'`) the world ends its one-finger pan **keeping** the camera and momentum off; the session's hooks continue it. Observable rule: no jump back of more than 1 px when a pan becomes a pinch.
4. **Editor-zone rule in `zoneOf`**: an `own` zone whose element lies inside a `[data-cv-mod]` that lacks `[data-cv-edit]` is skipped (the walk continues upward), so a pinch on a module's LFO graph, sample display or clip editor moves the camera unless the module is in edit state. A `music` zone (Serum's keyboard, the ARP/CLIP slot keys) never sleeps: its chords play as today (fix lane 2: nothing puts a module in edit state from a key press, so every first chord was cancelled; a camera pinch starts off the keys).
5. Unchanged: no non-passive `touchmove` on the window; `installGestures` stays the first statement of `boot`; no `data-gesture` on `#viewport`.

`main.js` boot line (WORLD): `installGestures(window, { pan: (sx, sy, at) => (world ? world.hooks.pan(sx, sy, at) : false), zoom: (f, cx, cy, at) => (world ? world.hooks.zoom(f, cx, cy, at) : false) });` (false keeps today's behaviour wherever there is no world).

### 4.3 `wk.js` additions (WORLD)

| Export | Contract |
|---|---|
| `localPoint(el, e) → {x, y}`, `localScale(el) → number` | §3.4 |
| `closeTransient()` | closes the open kit popup / context menu (`active`) and hides the kit tooltip |
| `setWheelVeto(fn \| null)` | the kit's `wheelIn` (knobs, numBoxes, menus, `wheelGate`) takes nothing while `fn()` is true |
| `visibleBand(doc) → {left, top, right, bottom}` | `asBand` generalised: `[data-wk-inset=left\|right]` too (top/bottom behaviour unchanged for `dragSource`) |
| `edgePan2(band, p, st) → {vx, vy}` | px/s per axis with today's 1-D law (`asEdge`: quadratic in `AS_EDGE` zones — mouse 0, touch/pen 72 — `AS_MAX` 1200, past the edge full speed), ramp-in `AS_RAMP`, arming `AS_ARM`; `p = {x, y, pointerType, t}`; `st` = a caller-owned object per drag (start point, arming, ramp start) |
| `setLayer(el \| null)`, `layer(fallback) → el` | the top layer (`#ov`); `layer(x)` returns it when `x` lies inside `[data-cv-world]`, else `x` |
| `setCanvasScale(k)` | `fitCanvas` sizes backing stores at `clamp(dpr · k, 0.5, 2)` (dpr capped at 2 as today) and caps each at 16e6 px |
| `onRescale(el, fn) → off`, `rescaleCanvases(root?)` | static canvas owners register a repaint; `rescaleCanvases` calls those inside `root` (animated ones repaint on their next tick by themselves) |
| `releaseCanvases(root)` | sets every canvas under root to 0×0 (for `cull: 'unmount'` bodies) |

### 4.4 `cv-module.js` (MODULES)

Constants: `BAR_H = 40`; `MIN_W = 480`, `MAX_W = 1600`; defaults `W_CLASSIC = 1080`, `W_SERUM = 1200` (the Serum panel's ≥ 1100 container layout; resizable 768–1600), `W_FX = 760`, `W_OUT = 280`; `GAP = 160`; `ID = { inst: 'i1', fx: 'fx1', sxFx: 'i1/fx', out: 'out' }` (these are the lay keys **and** the device ids 1c's `toV2` gives: SPEC §5.1, §5.4); `CAM_PREF = 'synth.cam'`, `CAM_MAX = 200`; `BG_SEL` (initial list `.cv-body, .inst, .plate, .nameplate, .secs, .sec, .ctls, .sx-root, .fxr-root, .cv-out`; MODULES tunes it, the press target itself must match).

Functions: `isBackground(el)`, `fxKey(model)` (`'i1/fx'` for serum, else `'fx1'`), `tidy(track, sizes) → lay` (instrument → FX → OUT in one row from (0, 0), `GAP` apart, tops aligned), `layOf(track, key, tidied)` (falls back to the other FX key after a classic ↔ Serum model change, then to Tidy), `camGet(rec, key)`, `camPut(rec, key, cam, max)` (pure LRU; keys from `CM.camKey`), `createModule(o, env) → Module`, `sizeFor(modelId) → {w, h}`, `createTrackView(world, track, host)`.

**Module** (`createModule`): chrome = top bar (power slot reserved, colour stripe `--mc`, title + sub, chip, `⋯`, `▾`), body, jacks (audio in left edge, out right edge). Implements the world Item. `setPos(x, y, live)` (live: `translate3d` + temporary `will-change` during a drag; commit sets `left/top`), `setW`, `setFold`, `setZ`, `setTitle`, `setChip`, `port(jackId) → {x, y}` (cached module-local offsets, refreshed by a per-module ResizeObserver when present; never measured per frame), `view(v, why)`, `destroy()`. Bar gestures: drag = move (immediate on touch, `wk.dragSource` `{scrollAxis: 'none', autoScroll: false}`, world delta = screen delta / k, 8 px snap with alignment to nothing else in 1b, Shift or the Fine latch = no snap, `world.dragPointer` edge pan, a two-finger cancel restores the start), tap = `world.select`, double-tap = `world.focusItem`, long-press / right-click = `⋯` menu (`wk.menuSource`), bring-to-front by `z` only (never re-append: pointer capture). Card view (`view('card')`): the drawing (`cvArt.art` for the instrument, `glyph('fx' | 'out')`), title, jacks; the card keeps the module's last body footprint so nothing moves. `cull: 'hide'` → body `display: none` (instance kept); `'unmount'` → `body.unmount` + `wk.releaseCanvases`.

**TrackView** (`createTrackView(world, track, host)`): builds the three modules from `layOf`, adds them to the world, creates the cables (`cv-cables`) and keeps them laid out from the ports; `sync(track)` applies lay/title/model changes without remounting bodies; `ports()`; `destroy()` (removes items, cables; parts go back to `#cvParts`). `host = { bodies: {inst, fx, out}: {mount(bodyEl), unmount(bodyEl)}, title(kind), menu(kind), lay(key, entry, phase), doc? }` — main.js supplies it (§5.3).

### 4.5 `cv-cables.js` (MODULES)

`TANGENT_MIN = 40`; `cablePath(x1, y1, x2, y2)` (cubic, horizontal tangents `d = max(40, |x2 − x1| / 2)`); `deriveCables(track) → Cable[]` (classic `i1.out → fx1.in`, `fx1.out → out.in`; Serum `i1.out → i1/fx.in` labelled with `routeLabel`, `i1/fx.out → out.in`; all `readonly`); `routeLabel(s, fx)` (the Serum's non-empty racks and Direct, e.g. `Main · Bus 1 · Direct`; reads state only); `createCables(worldEl, {doc}) → {under, over, set(cables), layout(ports), highlight(ids), destroy()}`. Each cable = a visible path + a transparent hit path; widths in the cv-module CSS section from `--ik` (audio `calc(4px * var(--ik))`, hit `calc(24px * var(--ik))` touch / `calc(12px * var(--ik))` mouse). The SVGs are positioned at the cables' bounding box (with a margin) and `overflow: visible`; `pointer-events` on hit paths only. No glow or animation in 1b.

### 4.6 `cv-tray.js` (SHELL)

Constants: `TOP_ROW = 48`, `ARR_BAR = 32`, `RULER = 24`, `ROW_H = 56`, `CANVAS_MIN = 240`, `RAIL_W = 44`, `SIDE_W = 240`, `EDGE_INSET = 24`, `TRAY_PREF = 'synth.cv.trays'`.

`topSnaps(n)`; `budget({vh, top, bottom, active, topMin, bottomMin, min}) → {top, bottom, canvas}` (pure; replaces `kbMaxH`'s 60 % rule: the canvas keeps ≥ 240 px, the dragged tray wins and pushes the other toward its fold); `trayGrip(grip, {edge, label, get, set, min, max, snaps, step, onDouble, doc}) → {sync, destroy}` (the mechanics of today's `initKbView`: pointer capture through the same `track`-style helper, two-finger rollback unsaved, arrows/PageUp/PageDown/Home/End, Enter/Delete/Backspace reset, double-click/double-tap = collapsed ↔ last height for the top tray and reset for the keyboard, ARIA slider); `sideTray(el, {side, store, onChange, doc}) → {open, close, toggle, isOpen, width, destroy}`; `sourcesTray(el, {models, pick, drag, doc}) → {setCurrent, setMode, destroy}`; `menuPop(btn, pop, o) → {open, close, isOpen, destroy}`; `sheet({title, body, layer, onClose, doc}) → {el, close}`.

### 4.7 `cv-art.js` (SHELL)

`TILE = {w: 96, h: 56}`, `CHIP = {w: 28, h: 18}`, `SIL` (silhouette descriptor per model id: `{body: 'keyboard'|'desktop'|'cabinet'|'box', keys, cheeks, tilt, screen, steps}`), `art(id, {w, h})` (cached SVG string from `models.js` theme/sections + `SIL`; SPEC §3 table), `chip(id)`, `glyph(kind)` (`osc`, `filter`, `sub`, `noise`, `voice`, `lfo`, `env`, `wheel`, `velo`, `macro`, `fx`, `out`), `tileMeta(id) → {id, name, year, maker, label}` (`label` "Serum (complete)" for serum). No `<text>`, `<image>`, external `href`, logos, wordmarks or maker typefaces; names are plain text next to the drawing.

### 4.8 `main.js` entry points and the call graph

| Function (owner) | Called by | Contract |
|---|---|---|
| `initShell()` (SHELL) | boot, after `initTransport()` | trays, grips, menus, Sources tray, chips, portrait rules; restores `TRAY_PREF` |
| `initWorld()` (WORLD) | boot | `world = cvWorld.createWorld($('#viewport'), {world: $('#world'), overlay: $('#overlay'), toolbar: $('#cvToolbar'), layer: $('#ov'), isBackground: cvModule.isBackground, onTidy: () => cvTidy(), store})` in a try/catch (failure: `world = null`, a console warning, the app keeps working); `world.on('movestart', () => hideTip())`; `kitPrefs` is untouched |
| `initModules()` (MODULES) | boot | takes `#inst`, `#fxrack`, `.scope`, `.about` out of `#cvParts` (kept by reference) and hides `#cvParts`; wires `cameraend` → camera save (debounced 500 ms) |
| `cvRender()` (MODULES) | `renderViews()` (last statement) | builds / syncs the selected track's TrackView; on a track change saves the old camera, `world.clear()`, builds, restores the new camera (or the default, §5.3) |
| `cvOpenSources(mode)` (SHELL) | `#aAdd` (`'track'`), the instrument's `⋯ → Replace with…` and `instPicker` (`'replace'`) | opens the Sources tray in that mode |
| `cvDropInstrument(modelId, at)` (MODULES) | the Sources tray (tap in `'replace'` mode with `at = null`; drop on the canvas with the ghost's world rect) | replaces `trk()`'s instrument in place (`setTrackModel`, one History step) and shows `Replaced <old> with <new> · tap to undo` (notice action → `undo()`); same model → no-op; returns true when it acted |
| `cvReveal(trackId, key = 'i1')` (MODULES) | the track-row chip tap (SHELL) | `selectTrack`, `openTab('canvas')` if ROLL shows, `world.focusItem(key, {k: world.k < CARD_K ? 1 : world.k, edit: false})` |
| `cvModuleSize(modelId)` (MODULES) | the tray drag over the canvas (SHELL) | world size of the drop outline (`cvModule.sizeFor`, or the current instrument's measured size) |
| `cvTidy()` (MODULES) | the world toolbar | one History step; `track.lay = tidy(…)` from measured sizes; persist; `view.sync` |
| `cvShellEscape()` (SHELL), `cvWorldEscape()` (WORLD), `cvWorldKey(e)` (WORLD), `cvWheelVeto()` (WORLD) | `initKeys`, `wheelIn` (pre-wired) | §4.1 / §5 |

SHELL's `openTab(name)`: `'roll'` or else `'canvas'` (a saved `'inst'`/`'fx'` opens CANVAS); toggles `#tab-inst.hidden` and `#tab-roll.hidden`, the `.tabs` buttons; `roll.resize(); roll.render()` on ROLL; `world && world.setActive(name === 'canvas')`; `monitors.sync()`; `store.set('synth.tab', name)`. It **never** calls `renderFxTab`/`dropFxTab` any more (the FX module is always mounted). The CANVAS view is shown ⇔ `$('#tab-inst').hidden === false`.

### 4.9 Data, schema, prefs

- **`track.lay`** (SPEC §5.1, view only): `{ [key]: { x, y, w?, fold?: 1, z? } }`, keys from `cvModule.ID` (1b: `i1`, `fx1` or `i1/fx`, `out`). `song.js` gets `export function normLay(lay)`: keys `/^[a-z][a-z0-9]{0,15}(\/[a-z][a-z0-9]{0,15})?$/`, at most 64 entries; `x`, `y` finite → rounded, clamped to ±1e6; `w` finite → rounded, clamped 120…4000; `fold` truthy → `1`, else absent; `z` integer 1…1e6; invalid entries dropped; empty → `undefined`. `deserialize` copies `lay: normLay(r.lay)` only when the result is defined (absent `lay` = Tidy; no new key on old tracks, so History snapshots of untouched tracks are unchanged). `newTrack` adds none. `serialize` and History carry it as part of the track. `duplicateTrack` copies it (MODULES, one line). `applyRestore` needs nothing (undo brings the old `lay`; `renderAll → renderViews → cvRender → sync`).
- **Schema**: 1a ships `CM.SCHEMA = 1` (`uid`). 1b adds `track.lay`, so after 1a has landed MODULES (or the lead) sets `SCHEMA = 2` in `cv-migrate.js` and appends `STEPS[1] = p => Object.assign({}, p, { schema: 2 })` (lay is additive: nothing to convert), updating `tests/cv-migrate.test.mjs` where it pins the number. A 1b build then opens 1a-or-older data normally, and an older installed build opens 1b data read-only (1a's gate).
- **uid**: `project.uid` from 1a (`CM.stamp`/`CM.upgrade`, always present after load/new).
- **Prefs** (appstore keys; callers write `synth.*`, the 1a store maps them to `synthc.*`):

| Key | Owner | Value |
|---|---|---|
| `synth.cam` | MODULES | `{ v: 1, e: [[CM.camKey(uid, trackId), tx, ty, k], …] }` LRU ≤ 200, most recent last. One record (appstore has no delete, so 200 separate keys could never be pruned). Never in the project or History |
| `synth.cv.trays` | SHELL | `{ top: px \| 0 (collapsed), topLast, src: {open, w}, fx: {open, w} }` |
| `synth.cv.pinch` | WORLD | `'canvas' \| 'page'` (default `'canvas'`) |
| `synth.tab` | SHELL | `'canvas' \| 'roll'` (old `'inst'`/`'fx'` read as `'canvas'`) |
| `synth.kbSize`, `synth.kbHidden` | SHELL | unchanged |

---

## 5. Lane specs

### 5.1 SHELL

1. **index.html** per §3.1: every listed id present (move elements, keep ids, attributes, titles and help text; the help paragraph keeps "installed app keeps its own projects"). `#cvParts` inside `#world`, not hidden, with its interim column layout. `#tab-inst` is the CANVAS view.
2. **style.css** (above the markers): the `#app` grid; the 48 px top row (compact transport: no wrapping at 1366 px; at portrait width the transport overflows into a `⋯` popover); the expanded tray (arrbar 32 + ruler 24 + 56/row; `#arrwrap` scrolls inside the tray height); `#stage`, `#tab-inst` and the CANVAS view's children geometry (`main#stage` must lose today's `main { max-width; padding }`); side trays (rail 44, panel 240, grip on the inner edge ≥ 24 px from the screen edge); `#perf` as the footer row (keeps `padding: 12px 12px calc(12px + env(safe-area-inset-bottom))`); `#tab-roll` filling the stage (`#rollwrap` flex 1); `#ov`, `.cv-pop`, sheet styles; safe-area insets on `#topTray`; drop the old `.console`, `.models`, `main` width rules, `.top { position: sticky }`, the ≤ 900 px header-scrolls-away rules (the header no longer scrolls), `body { min-height: 100vh }` (body gets `overflow: hidden`). No `touch-action` on html/body.
3. **Top tray** (`cvTray.trayGrip` on `#topGrip`): snaps `topSnaps(n)`, collapsed ↔ last on double-tap, height from `budget()`, persisted in `synth.cv.trays`; collapsed hides `#arrbar` and `#studio` (and `arr.resize()` on expand). **Keyboard tray** rebuilt on the same helper: keep `#kbGrip`'s ARIA, keys, two-finger rollback, `kbSize` persistence and `api.kbMaxH(chrome)` (now budget-limited, so the canvas keeps 240 px; `keyboard.test.mjs` adapted). One `budget()` serves both grips; window resize re-applies it.
4. **Menus**: `≡` (`#appMenu`) holds New, Open/Import, Save, Export MIDI, Bounce WAV, Install app, Full screen, Help & about; `⚙` (`#gearPop`) holds sample rate, oversampling, analog drift, recording mode, input quantise, "Pinch on canvas" (`#pinchMode` → `world.setPinchMode`). `cvTray.menuPop` for both; `cvShellEscape()` closes them, the side trays and SHELL sheets.
5. **Track rows** (`renderHeads`): name, M/S/R, meter (`.hmeter i` kept: `frame()` reads it), **instrument chip** (`cvArt.chip` + model name; its label element is registered in `voiceOpt` with `.value = model id` so `voiceSeen` keeps updating the voice label), MIDI channel, vol, pan, duplicate, delete; tap row selects, double-click opens ROLL (as today). Chip tap → `cvReveal(t.id)`; chip long-press / right-click → menu: Change instrument ▸ (every model → `selectTrack` + `cvDropInstrument`), Show on canvas, Open piano roll. The head's preset `<select>` moves to the instrument module's chip (MODULES). Incremental re-render is welcome, not required.
6. **Top row**: track chip `#trkChip` (colour, name, ▾ = track list) and `#trkDots` (one dot per track, tap selects), `#tabTrack` text unchanged (`main.test.mjs` reads it), `CANVAS │ ROLL`.
7. **Sources tray** (`#srcTray`, `cvTray.sourcesTray` + `cvArt`): one tile per model (drawing, name, `year · maker`), the current model marked (`renderNav` → `setCurrent`). Tap: mode `'replace'` → `cvDropInstrument(id, null)`; mode `'track'` → `addTrack(modelById(id))` and close. Drag: tray closes as soon as the drag leaves it; over the canvas (CANVAS view) the illustration ghost hides and `world.ghost({x, y, ...cvModuleSize(id)})` + `world.dragPointer(p)` show the true-size outline with edge pan; over `#heads`/`#lanes`/`#studio` a "new track" hint; drop on the canvas → `cvDropInstrument(id, rect)`; drop on the track list → `addTrack(modelById(id))`; anywhere else cancels; always `world.ghost(null); world.dragPointer(null)` at the end. `#aAdd` → `cvOpenSources('track')`. `instPicker(tr)` → `selectTrack(tr.id); openTab('canvas'); cvOpenSources('replace')`.
8. **Effects tray** (`#fxTray`): rail + panel that says effects are added with the FX panel's own add button for now (effect tiles arrive in 1e). It exists so the right inset and the tap-to-open rule are exercised.
9. **Portrait / small windows** (SPEC §2.14): the side tray not in use collapses to its rail; the arrbar folds into `Bars ▾` below 1100 px (`#aBars`/`#aEdit`; at the spec's 1000 px the row did not fit); the transport's time signature, loop, click and count-in overflow into `⋯` below 1280 px (`#tMore`/`#tMorePop`); below 1100 px the master level folds out of the top row into `⚙` (`#masterG`); the top tray's minimum stays one row.
10. **Help & about sheet** (`cvTray.sheet` into `#ov`): `.help` and the footer text from `#helpParts`.

### 5.2 WORLD

1. **Camera** per §3.4/§4.1: transform on `#world` applied once per rAF; `will-change: transform` only while `[data-cv-busy]`; grid as a CSS background of `#viewport` (`gridBg`, 32 world-px dots); `--ik` and canvas rescale at zoom end only; ≤ 6 ms main-thread per gesture frame (no layout reads, no mounting).
2. **Pointer input on `#viewport`** (bubble phase unless stated): one finger / left mouse on the viewport itself, `#world`, or a target with `isBackground(target)` → pan (touch: momentum, decaying, off under reduced motion); middle button anywhere in the viewport → pan; Shift-drag → pan too in 1b (marquee is 1c). Controls keep their own `pointerdown` (only the press target is tested). **Momentum guard**: a capture-phase `pointerdown` on `#viewport`: while gliding or within `MOMENTUM_GUARD_MS` after, `stopImmediatePropagation` (+ `preventDefault`), stop the glide, start a pan with that touch. **Late finger**: while the world's one-finger pan is live, the same capture listener takes any new touch inside the viewport (`stopImmediatePropagation`) and turns the pan into a pinch with the same rebase maths (no knob sees it). Tap on empty canvas deselects; double-tap / double-click on empty canvas = fit.
3. **Wheel / trackpad** (non-passive `wheel` on `#viewport`): skip if `e.defaultPrevented` (a knob or editor took it); Ctrl/⌘-wheel (trackpad pinch) zooms at the pointer (`f = exp(−deltaY · 0.002)`, line/page modes scaled as `wk.zoomPan` does) — except over a hovered `own` editor zone in a module (SPEC §4.1: as today when hovered), unless the camera's wheel veto runs (a camera zoom in progress keeps it; `wk.zoomPan` never vetoes its own Ctrl-wheel, so no notch falls through to the browser's page zoom); otherwise pans, unless an overflow scroller between the target and the viewport can still scroll that way. `gesturestart/gesturechange/gestureend` on `#viewport` (non-passive, element-level) zoom by `e.scale` ratios and are `preventDefault`-ed; ignored while touch pointers are down. `wk.setWheelVeto(() => world.wheelVeto())`; `cvWheelVeto()` returns the same for the classic knobs.
4. **Native hand-over** (SPEC §4.3): on `visualViewport` `resize`/`scroll`, `scale > 1.001` → `native = true`, `[data-cv-native]` on `#viewport`, hooks return false, pan/momentum stop, toolbar chip "page zoomed · 1:1" (a hint, no reset); back at 1 → camera again. CSS: `#viewport[data-cv-native]`, its module backgrounds and bars get `touch-action: manipulation`; controls keep `none`. Page mode (`pinchMode 'page'`): `#viewport` `touch-action: pinch-zoom`, both hooks false (one finger pans the canvas, two are the browser's), a late finger during a one-finger pan stops it (no canvas pinch), the toolbar/wheel/double-tap still zoom the camera.
5. **Culling, cards, edit state, focus**: `planMount` on every `cameraend`, `update` and `resize`; `view()` calls sliced ≤ 12 ms per frame, nearest the centre first, cards first after `clear()`; pinch crossing `CARD_K` defers LOD until the gesture ends; DOM budget → `'budget'` cards ("zoom in to edit"); edit state per §3.3; `focusin` inside `#world` → `reveal(target)` (the band excludes the software keyboard via `visualViewport`); `movestart` → `wk.closeTransient()`; `overflow: clip` on `#viewport`.
6. **Transform safety** (UI files; one site at a time, each with a test where the fake DOM allows): `graph.js` (`boxOrigin`/`pos`/the `zoomPan` `rect` of every editor, sizes from layout px; `lfoEditorLarge` renders into `wk.layer(container)`), `fx-ui.js` (display `pos` handlers at ≈ l. 1359 and 1640, `box` mixing screen and layout px; the `@media (max-width: 699px)` list rule inside the world), `wtedit.js` (strip `thumbAt`/`gapAt`, wave/FFT pointer maths, canvas sizing; its 760 px media rule), `sx-ui-osc.js` (audit the rect sites ≈ l. 1714, 1789, 2098, 2492, 3042: keep ratio-based and consistent-screen-px maths, fix any that mixes screen offsets with layout sizes), `sx-ui-seq.js` (`rsz` canvas sizing from the rect ≈ l. 750 and 2397, the `local(e)` helpers, `.sx-seqov`'s `position: fixed` below 1099 px must not apply inside `[data-cv-world]`), `serum-ui.js` (`popover` left/top in layout px via `localScale`, its `< 1100` width test on `offsetWidth`; `gx.lfoEditorLarge(wk.layer(this.el), o)`). Static canvases register `wk.onRescale`. Rule of thumb: ratios `(x − r.left) / r.width` are safe; `x − r.left` compared with `clientWidth`-based geometry is not.
7. **Toolbar** in `#cvToolbar`: `⊖ 62% ⊕` (the % resets to 100), fit, tidy (`onTidy`), a disabled `∿` placeholder ("modulation cables arrive in a later stage"), the native-zoom chip; folds into one `⊕` button at portrait width.
8. **Keys**: `cvWorldEscape()` / `cvWorldKey(e)` → `world.escape()` / `world.key(e)` (null-safe).
9. **Cable stroke check**: test in Safari (macOS) whether `vector-effect: non-scaling-stroke` honours a CSS `scale()` on an HTML ancestor; record the result in the hand-back note (the cables use `--ik` regardless; it may only be used for live pinch frames if it works).

### 5.3 MODULES

1. **Parts**: `initModules()` takes `#inst`, `#fxrack`, `.scope`, `.about` by reference out of `#cvParts` and hides `#cvParts`; bodies mount them (move the node in) and unmount them (move back), so ids, `$()` lookups and main-sim keep working.
2. **Modules of the selected track** (`cvRender` → `cvModule.createTrackView`): instrument `i1` (title: model name, sub: track name; colour: the track's; chip: a classic preset `<select>` bound as today's head select / the Serum preset name; width resizable 480–1600 classic, 768–1600 Serum; `cost` ≈ 600 classic, 3700 Serum), FX `fx1` "FX Panel" or `i1/fx` "Serum FX (own)" (sub: `routeLabel`), OUT `out` (scope: today's master `#scope` with its Scope/Spectrum buttons, sub "master output"; may add the track meter and vol/pan mirrors). All three `cull: 'hide'` in 1b (the SerumUI instance holds its panel undo, page and editor state; destroying it on pan would lose them; 1c switches bodies to `'unmount'` with ClassicPanel/SerumHost). Jacks: instrument out; FX in/out; OUT in. `⋯` menus: instrument — About (sheet with `.about`, `drawAlgo()` kept), Replace with… (`cvOpenSources('replace')`), Reset width, Fold, Bring to front, Tidy; FX — Fold, Bring to front, Tidy; OUT — Fold.
3. **Rendering flow**: `renderViews()` = `renderPanel(); renderFxTab(); cvRender();` — the FX rack is always mounted (`renderFxTab` no longer depends on a tab; `#fxtitle` text goes to the module title). `renderPanel`/`renderCustom` keep filling `#inst` exactly as today (the Serum panel is rebuilt only when the track or its state container changes). A model change re-titles the instrument module and swaps the FX key (`layOf` fallback) without moving anything.
4. **Monitors**: `monitors.wanted(id)` = `(this.sx.has(id) && sxPanel.trackId === id && cvLive('i1')) || (fxTab.trackId === id && !!fxTab.ui && cvLive(fxKey))`, each also `!document.hidden`, where `cvLive(key)` = CANVAS view shown (`!$('#tab-inst').hidden`) and that module's view is `'body'`. Call `monitors.sync()` from every view change (world `lod`, culling, `openTab`). SPEC §9.3: `smon` only for shown modules.
5. **Peer refresh**: both UIs edit the same `t.fx` (and Serum state): `sxHost.edit/editFx` → refresh the FX module's `FXRackUI`, `fxHost.editFx/edit` → refresh the Serum panel, rAF-coalesced, never the UI that made the edit.
6. **Move / fold / resize persistence**: on a module's first real move (`onMove` phase `'start'`) `hist.record(project, 'Move ' + title); updateUndoUI();`; on `'end'` write `t.lay[key] = {…}` and `persist()`; `'cancel'` changes nothing. Fold and width: the same pattern. Camera changes never call `hist.record`. Bring-to-front writes `z` (no History step).
7. **Camera prefs**: `cameraend` → debounced 500 ms `store.set(CAM_PREF, camPut(store.get(CAM_PREF, null), CM.camKey(project.uid, t.id), cam))`; track switch / load → `camGet` → `world.setCamera`, else the **default**: k = 1, the instrument's top-left 24 px inside `world.band()`'s top-left (never a fit that would land below `CARD_K`).
8. **Replace** (`cvDropInstrument`): as §4.8; the instrument keeps its position (until 1e a synth dropped anywhere replaces in place, SPEC §2.7).
9. **Cables**: `deriveCables(trk())` → `createCables` layers in `#world`; relaid from `ports()` on module move/resize/fold and model change.
10. **song.js `normLay`** and the `duplicateTrack` line; the schema bump (§4.9) last, after 1a.
11. **CSS** (cv-module section): `.cv-mod { position: absolute; contain: layout paint style; }`, bar 40 px with the upward hit extension (`::before`, `height: max(0px, calc(36px * var(--ik) - 40px))` above the bar), jacks `calc(44px * var(--ik))`, cable strokes from `--ik`, card, fold, resize grip, selection outline; inside a module touch hit areas grow only through `::before`, never `min-height` (same geometry on every device).

---

## 6. Integration order

| Step | Who | Lands | App state after it |
|---|---|---|---|
| 0 | architect | stubs, region, hooks, markers (done) | today's app, unchanged |
| A1 | WORLD | `createWorld` minimal: camera maths, transform, `add/remove/update/clear`, `view('body')` for all, `toWorld/toClient`, `band`, `on`; `gesture.js` hooks + zone rule; the boot hook line | today's app; nothing in a world yet |
| A2 | SHELL | index.html + shell CSS with every §3.1 id, `#cvParts` inside `#world`, `openTab` canvas/roll, menus | the shell; today's panel, rack and scope stacked at the world origin (scrolls via the interim `overflow: auto`, or pans once A1 is in) |
| A3 | MODULES | `createModule`/`createTrackView`, parts into bodies, `cvRender`, lay + undo, cables | modules on the canvas |
| B | all, in parallel | WORLD: culling/cards, momentum + guard, late finger, native hand-over, wheel/veto, edge pan, ghost, toolbar, transform-safety sites. SHELL: trays + budget + grips, Sources tray + art, chips, portrait. MODULES: drop/replace + toast, camera prefs, monitors, peer refresh, OUT, tidy, CSS hit areas | feature-complete 1b |
| C | lead | integration run (§8.5), preview at three sizes, iPad checklist hand-off, schema bump if not done | deployable |

A lane that needs another lane's piece before it lands uses the stub's documented contract and a local fake in its tests; it never edits the other lane's file to unblock itself. WORLD's A1 should land first (MODULES needs `world.add`). Known interim gap: between A2 and A3 the FX rack is not rendered (today `renderFxTab` runs only behind the FX tab; MODULES' `renderViews` makes it permanent) — acceptable inside the parallel window, never at a lead checkpoint.

---

## 7. Today-feature checklist (nothing may be lost)

| # | Feature | 1b location | Owner |
|---|---|---|---|
| 1 | Engine power `#power`, master `#master`, CPU/rate meter `#rate`/`#cpu` | top row, engine group | SHELL |
| 2 | Sample rate `#sr`, oversampling `#os`, analog drift `#drift` | `⚙` | SHELL |
| 3 | Output latency `#lat` + `#latPop` (presets, ±, slider, info) | top row meter group | SHELL |
| 4 | Install app `#install`, Full screen `#fullscreen`, install sheet, update toast | `≡`; sheet/toast unchanged | SHELL |
| 5 | Transport: start, play/stop, record, BBT/time, tempo, time signature, loop, click, count-in, undo, redo | top row | SHELL |
| 6 | Recording mode `#tRecMode`, input quantise `#tInQ` | `⚙` | SHELL |
| 7 | Song length `#tBars` | arrangement toolbar | SHELL |
| 8 | New, Open/Import (`#fFile`), Save, Export MIDI, Bounce WAV (+ `#modal`) | `≡` | SHELL |
| 9 | Arrangement toolbar: + Track, Assign MIDI channels, range info, Copy, Paste, Duplicate, Clear, Delete bars, Insert bars, Loop selection | expanded top tray (`Bars ▾` below 1000 px); + Track opens Sources in "new track" mode | SHELL |
| 10 | Arrangement lanes (select bars, loop ruler, playhead, double-tap → roll, own pinch) | expanded top tray | SHELL |
| 11 | Track rows: name, mute, solo, arm, meter, MIDI channel, vol, pan, duplicate, delete, select, double-click → roll | expanded top tray | SHELL |
| 12 | Track's instrument choice (head `<select>`, model nav, `#hash`) | chip menu "Change instrument ▸", Sources tray tap/drag, `hashchange` unchanged | SHELL + MODULES |
| 13 | Track preset select (classic) / Serum preset name | instrument module chip; classic panel's own preset UI unchanged | MODULES |
| 14 | Voice-mode labels (R6) in the instrument menu and `#tabTrack` | chip label via `voiceOpt`; `#tabTrack` | SHELL |
| 15 | Instrument panel: classic controls, presets, TB-303 sequencer, DX7 rows | instrument module body | MODULES |
| 16 | Serum panel (all pages, browser, matrix, popovers, WT editor, seq overlay, its own FX page, panel undo) | instrument module body (popovers stay in-panel; the large LFO editor opens in `#ov`) | MODULES + WORLD |
| 17 | FX tab rack (classic 1 rack, Serum 3 racks, presets, chains, IR embed, Delay overlay tap) | FX module body, always mounted | MODULES |
| 18 | Scope / Spectrum | OUT module | MODULES |
| 19 | About text, DX7 algorithm diagram | instrument `⋯ → About` | MODULES |
| 20 | Play/studio/app help, footer text | `≡ → Help & about` | SHELL |
| 21 | Piano roll + tools + help | ROLL view | SHELL |
| 22 | Keyboard: grip, notice line, octave, velocity, key size, playing, MIDI, hold, panic, hide keys, bend and mod wheels, keys | keyboard tray (unchanged content) | SHELL |
| 23 | Keyboard shortcuts (play keys, Space, R, M, Q, Home, Esc chain, ⌘Z/Y/S, roll and arrangement shortcuts) | unchanged + canvas keys | WORLD (canvas keys) |
| 24 | Two-finger protection, edge auto-scroll in drags, knob press-and-hold mod menu | kept; canvas camera on top | WORLD |
| 25 | Chord notice "open its instrument" | `instPicker` → CANVAS + Sources tray | SHELL |
| 26 | Notices with actions, storage notices, read-only notice (1a) | `#notice` in the keyboard tray | – |
| 27 | MIDI in/learn/program change, Bluetooth latency, PWA offline/update | unchanged | – |

---

## 8. Test plan

Run each file alone (`node --max-old-space-size=2048 --test tests/<file>.test.mjs`). New files exist already with the v8-guard import and a header comment.

### 8.1 SHELL
- `tests/cv-tray.test.mjs`: `topSnaps`; `budget` (canvas ≥ 240 at 834/1024/1194/1366/900 px heights; the active tray wins and pushes the other; both at minimum clamps the active one; collapsed stays 48); `trayGrip` on `tests/wk-dom.mjs` (drag sets height and snaps, two-finger `pointercancel` restores unsaved, plain cancel keeps, arrows/PageUp/Home/End/Enter, double-tap toggles collapsed ↔ last, ARIA values); `sideTray` (rail tap opens, grip ≥ 24 px from the edge, Escape and drag-leave close); `sourcesTray` (outward move drags at once, along-tray move abandons as a scroll, 250 ms hold drags any way, tap → `pick` in the current mode, drop routing canvas/tracks/none); `menuPop`; `sheet`.
- `tests/cv-art.test.mjs`: `art()` for every `MODELS` id returns `<svg …>` with the requested viewBox; cached (same string twice); no `<text`, `<image`, `href`, `xlink`, nor any `maker` string inside; `chip`/`glyph` sizes; `tileMeta` matches `models.js` (Serum → "Serum (complete)").
- `tests/cv-shell-sim.test.mjs` (main-sim): every id of §3.1/§7 rows 1–11 exists and keeps its handler (`onclick`/`onchange` set); `openTab` canvas/roll and saved `'inst'`/`'fx'` → canvas; `#aAdd` opens Sources in track mode; Sources pick in replace mode → `setTrackModel` (one History step); drop on the track list → `addTrack` (one History step); `kbMaxH` keeps the canvas ≥ 240.
- Adapt: `tests/keyboard.test.mjs` (height clamp from `budget`), `tests/pwa.test.mjs` (the shell's safe-area rules on `#topTray`/`#perf`, no app zoom, static viewport meta; the `≤ 900 px` header rules replaced). `tests/main.test.mjs`'s chord-notice test keeps passing because `#tab-inst` is the CANVAS view; change it only if it fails.

### 8.2 WORLD
- `tests/cv-world.test.mjs`: maths (`toWorld`∘`toLocal` = identity; `zoomAbout` keeps the pivot for random pivots and k ∈ [0.25, 2] incl. clamped steps; `panCam`; `fitCam` contains every rect, k ≤ kMax, centred; `gridBg`; `snap`); `lodOf` + pinch-defer across 0.5; `planMount` (margin culling, nearest-centre order, budget cut); `createWorld` on wk-dom with fake items: the transform string, `--ik` only at zoom end, `view()` slices ≤ 12 ms with a fake clock, cards below 0.5, `clear()` + re-add shows cards first; native hand-over (fake `visualViewport.scale` 1.5 → hooks false + `[data-cv-native]`, back to 1); momentum guard (a touch ≤ 120 ms after a glide never reaches a child control); late finger (second touch during a live pan → pinch, child sees nothing); wheel (Ctrl zooms at the pointer, plain pans, `defaultPrevented` ignored, scrollable inner element keeps it); `wheelVeto` window; mouse drag on empty/background pans, on a control not, middle button anywhere; `escape()` order; `[data-cv-edit]` iff selected and k ≥ 0.9; `dragPointer` edge pan direction/speed vs `wk.edgePan2`; `ghost` stays under a still pointer while the camera pans; `localPoint` inside a module at k = 0.5/1/2.
- `tests/gesture.test.mjs` (add, SPEC §11.3): second finger rolls back a knob and a module drag but continues a camera pan (no jump back); pinch engages only after 6 px; `zoom` gets per-frame ratios with the content under the midpoint fixed; hooks returning false fall through to tray scrollers / page; editor zones (`own` on a graph/sample display/clip editor) inside `[data-cv-mod]` without `[data-cv-edit]` give a nav session (camera), with it the own session; `music` on `wk.pianoKeys` always a chord; `gesture*` ignored while touches are down (world side); the guard's consumed touch still pairs in `installGestures`.
- `tests/wk.test.mjs` (add): `localPoint`/`localScale` (k = 0.5/1/2, zero rect), `closeTransient`, `setWheelVeto` blocks a knob wheel in the window, `edgePan2` (zones, past-edge speed, ramp, arming, mouse only past the edge), `visibleBand` left/right insets, `setCanvasScale` sizes in `fitCanvas` (+ 16e6 cap), `onRescale`/`rescaleCanvases`, `releaseCanvases`, `layer()`.
- Existing UI tests touched by the transform fixes stay green: `graph`, `fx-ui`, `wtedit`, `sx-ui-osc`, `sx-ui-seq`, `serum-ui` (one at a time; `serum-ui` is heavy, run it last and alone).

### 8.3 MODULES
- `tests/cv-module.test.mjs`: `isBackground`/`BG_SEL`; `fxKey`, `layOf` fallback on a model change; `tidy` columns; `camGet`/`camPut` (LRU of 200, recency, invalid records); `createModule` on wk-dom (bar 40, jacks, fold → `rect().h === BAR_H`, `setPos` live vs commit, `view('card')` with `'hide'` keeps the body node and instance, with `'unmount'` calls `unmount`); top-bar move (world delta = screen/k, 8 px snap, Shift no snap, two-finger cancel restores the start, one `onMove` start/end pair); `song.normLay` (valid kept, invalid dropped, clamps) and `deserialize` round-trip; the CSS section contains `calc(44px * var(--ik))`.
- `tests/cv-cables.test.mjs`: `cablePath` tangents (`max(40, |dx|/2)`); `deriveCables` classic and Serum; `routeLabel` from Serum + FX states; `createCables` on wk-dom (two paths per cable, `layout` follows port moves, bounds).
- `tests/canvas-sim.test.mjs` (main-sim): boot → three modules for the selected track with `#inst`, `#fxrack`, `.scope` in their bodies; no `lay` → Tidy; a bar move → `track.lay` written, exactly one History step, undo restores the position and keeps knob values; camera moves never change History (`hist.canUndoFrom` unchanged); camera saved under `CM.camKey(uid, trackId)` and restored after a track switch and a reload; track switch rebuilds the view; `smon` posts follow `cvLive` (ROLL → off, back → on); a Serum edit refreshes the FX module and vice versa (counted); `cvDropInstrument` replaces in place, the notice action undoes; `lay` survives serialize/deserialize and `duplicateTrack`.

### 8.4 Gate set (every lane, before hand-back)
`tests/lint.test.mjs`, `tests/pwa.test.mjs` (after `node tools/precache.mjs --write`), the DSP diff of §0.1 (empty), the lane's own files above, and the page-sim files its edits can reach (`tests/main.test.mjs`, `tests/keyboard.test.mjs`, `tests/app.test.mjs`, `tests/app-ios.test.mjs`, `tests/roll.test.mjs`), one at a time. Goldens are not needed for UI-only edits; the lead runs `golden-classic` and `golden-fx` once at integration.

### 8.5 Lead integration run
All files of §8.1–8.4 one at a time, `golden-classic`, `golden-fx`, `tests/cv-migrate.test.mjs` after the schema bump, then the preview checks of §9.

---

## 9. Visual and iPad verification

- Preview (`.claude/launch.json` "synth", port 8817, the built-in browser tools) at **1440×900**, **1366×1024**, **1024×1366**: the top row on one line at 1366; trays and grips; canvas ≥ 240 px; modules readable at k = 1 with the default camera; pan/zoom/fit; a move, undo, redo; ROLL ↔ CANVAS; Serum and a classic model; no console errors. Reset viewport emulation afterwards.
- iPad checklist items in scope for 1b (SPEC §11.4): 1, 2, 3, 5, 6, 7, 10 — handed to the user by the lead after integration.

---

## 10. Decisions taken in this contract (for the lead)

1. **1b bodies cull by hiding** (`cull: 'hide'`), not unmounting: the bundled `SerumUI` keeps its panel undo, page and editor state per instance (`serum-ui.js` `this.undo`), so destroying it on a pan would lose user-visible state that today survives tab switches. The world's unmount path is built and tested with fake items; 1c switches bodies to `'unmount'` with ClassicPanel/SerumHost. Monitors still stop for hidden bodies.
2. **Serum popovers and overlays stay inside the panel in 1b** (absolute in `.sx-root`, they move and scale with the module; their position maths become transform-safe). Only `position: fixed` pieces (the large LFO editor `.gx-overlay`; `.sx-seqov` below 1099 px) leave the world for `#ov` or are neutralised. Moving every Serum overlay to `#ov` as sheets is 1c's SerumUI work (SPEC §10 1c); iPad item 6 is met by "nothing stranded", and bar double-tap gives 100 % for comfortable editing. Flag if the user wants sheets in 1b.
3. **Default camera** for a track without a saved one: k = 1 at the instrument's top-left, not "fit" (fit of three modules on an iPad lands below `CARD_K` and would show cards).
4. **Camera prefs in one LRU record** (`synth.cam`) keyed by 1a's `CM.camKey`, because appstore cannot delete keys.
5. **OUT shows the master scope** (today's `#scope` reads the master analyser); a per-track scope would change today's feature. Labelled "master output".
6. **Instrument replace keeps the module's position** (SPEC §2.7 "replaces … the same way" until 1e).
7. **wk.js becomes a startup dependency** (the cv modules import it statically for `dragSource`, `edgePan2`, `localPoint`); it was lazy-loaded with the Serum panel. It touches nothing at module top level, so this only moves its download earlier.
8. **Effects tray** in 1b is a rail and an explanatory panel; effect tiles come with 1e.

### Integration (lead, stage 1b)

9. **Double-tap / reveal of a module taller than the canvas** (a Serum of 1300–1540 px): SPEC §2.6's "fit if larger" would land near 30 % on an iPad and show only the card, which defeats the double-tap's edit state. `focusItem` keeps the fit when it stays at or above `CARD_K`; otherwise it frames the module's width at the requested k (never below `CARD_K`), top aligned 48 px inside the band (left aligned when it is still wider). Tested in `tests/cv-world.test.mjs` (focusItem).
10. **Master level at narrow widths**: the top row hides `#master` below 1100 px; `⚙` shows a mirror (`#masterG`, synced on open, driving `#master`'s own handler), so checklist row 1 stays reachable in portrait.
11. **`synth-ui.scale`**: the canvas build never touches main's storage (§5.6, 1a), so boot no longer drops build 8's key; `tests/app-ios.test.mjs` asserts it is left alone (same origin on localhost).
12. **Preset chip**: `renderHeads` calls `cvChipSync()`, so the instrument module's chip follows a knob tweak ("Custom") and a Serum preset load at once.
13. **Lane deviations accepted as the contract**: SHELL's renamed classes (`.cv-tgrip`, `.cv-tchip`, `.cv-ovf`) and extra ids (§3.1), the fold widths (§5.1.9); WORLD's additive exports (`PINCH_PX`, `ZOOM_STEPS`, `PINCH_PREF`, `viewOf`, `lod`, `busy`, `wk.canvasScale`), the large LFO editor moved into `#ov` inside `graph.js`, the bubbling `wk-reveal` event for Serum popovers; MODULES' `contain: paint` on `.cv-body` (not `.cv-mod`), `nudge(dx, dy)`, host additions (`root`, `shown`, `art`, the 4th `lay` argument) and exports (`MIN_W_SERUM = 768`, `JACK_Y`, `defaultW`, `widthRange`, `cardArt`, `PAD`), the schema bump (`SCHEMA = 2`).

