# Milestone 3 mapper: extracting Serum's UI into canvas modules

Read-only map of branch `canvas` @ 959ab78 (2026-10-19). Every count below was **measured**, not estimated, unless it says "est.":
the REAL `serum-ui.js` / `sx-ui-*.js` / `fx-ui.js` / `cv-mods-ui.js` were built with a hand-made host in Chrome (M4 Max, dpr 2) through the
dev server of `.claude/launch.json` (script: `scratchpad/m3/measure-dom.js`; coupling scan: `scratchpad/m3/deps.mjs`). Element = DOM element
(`getElementsByTagName('*')` + root); "vis" = has a layout box (not `display:none`). Line numbers are `serum-ui.js` unless a file is named.

## 0. The answers in brief

1. **Most of the Serum UI already mounts alone.** `OscPanel / SubPanel / NoisePanel / FilterPanel`, `ArpPage / ClipPage / KeyboardPanel`,
   `MixerPage` and `FXRackUI` take `(root, kit)` and were mounted into separate empty boxes against one existing kit **with no code
   change** (0.3–3.5 ms each, no error). The hard part is not the panels, it is the object behind the kit: `SerumUI` is shell + host in one
   class (3475 lines), and the ENV / LFO / MACROS / VOICING / GLOBAL / header panels are *methods of it*.
2. **Only two panels fail alone, for one reason:** `envPanel()` and `lfoPanel()` dereference `this.bp` (the "page being built" registry,
   null outside `showPage`) — measured: `Cannot read properties of null (reading 'editors' / 'lfoBox')`. With `ui.bp` set they build fine
   (ENV 145 el / 2 canvases, LFO 145 el / 6 canvases). Everything else they reach is `this.edSel / lfoTool / big / srcUsed / selectSrc /
   edSig …` (§4).
3. **The canvas modulator state is already a Serum slot.** `normLfoMod / normEnvMod / normChaosMod` store `{lfo: normLfo, rate, rise, delay,
   smooth, phase}`, `{env, att…rel, start, end, crv:[ca,cd,cr]}`, `{chaos, rate, bpm, smooth}`; `cv-graph.writeSlot` copies them into
   `s.lfo[k] / s.env[k] / s.p['l<k>.*' | 'e<k>.*']` of a synthetic Serum that **the real engine already plays in full** (type, dir, pts, path,
   loop, start, anchor, x10 …). So "Serum's own panels on the canvas modulators" is a UI job with **no DSP change**: run the extracted
   `LfoPanel / EnvPanel / MacrosPanel / ChaosRow` over a *slot host* (a `SerumHost` over a memoised synthetic state: 29 KB, 0.35 ms) whose
   `edit()` writes the slot back through the existing `o.edit(fields)` (one History step per gesture end).
4. **DOM today (bundled Serum):** 3701 el / 29 canvases after construction (OSC page only); **12 526 el / 63 canvases / 17.3 MB of canvas
   stores** once every page was visited (pages are built lazily, then kept). The MATRIX page alone is 5231 el; MIX 1394; the OSC, MIX, FX and
   MATRIX pages each carry the tile strip (76) and the OSC, MIX and FX pages each repeat the ENV·LFO·MACROS·VOICING row (496). An OSC panel is
   811 el of which **421 are the four hidden oscillator-type views** built eagerly. Parts view needs none of MIX / MATRIX / the duplicates: a
   "Serum (complete)" (VOICE core + OSC A + FILTER 1 + S1 FX) is ≈ 1.4 k el / ≈ 10 canvases / 4 modules; 3 OSC + SUB + NOISE + 2 filters + ENV 2–4
   + 4 LFO + MACROS + VOICE core + S1 FX with 4 effects ≈ 4.9 k el / ≈ 55 canvases / 17 modules, + ARP + CLIP ≈ 5.5 k (est. from the measured
   parts, §5; ≈ 1.4 k less with lazy OSC type views).
5. **Rendering facts for the contract (§9):** every Serum control is DOM + inline SVG (knob 11 el), every display is a 2D canvas whose store is
   `clamp(dpr/ls, 0.5, 2)` and is redrawn at zoom end (`wk.onRescale`) — the exact "renders in at rest" behaviour the user rejected for
   faces; above k = 1 at dpr 2 the canvases are *below* 1:1 (cap 2). Building is cheap (bundled ctor 14–22 ms, a page 1–7 ms, `paint(true)` ≈ 1 ms
   on the Mac); the cost is DOM size, style/layout, canvas stores and compositor scaling, not construction.
6. **Two real bugs found while mapping** (both verified, §8.7, §12): the deployed canvas **ENV module's curve boxes disagree with the engine**
   (`crv` is 0…1 in the state/engine, the body treats it as −1…1: default shows "A curve +50", writing "0" stores an extreme curve), and
   `moduleDrag` lets a module label of **another** Serum's panel become the swap target (latent today: one Serum per canvas).
7. **Not available to the canvas modules without new data:** the LFO phase dot / ENV playhead of Serum's editors. `mcSnap` hands bodies a
   scalar (`B.update(mc[e.i])`), `ModCore.live` is `Float32Array(16)` of values only (§8.6). An engine message change (neutral-gated) or a
   level-only fallback — a contract decision.

---

## 1. Method and numbers

Standalone build harness (`measure-dom.js`): `new SerumUI(box, host)` with `host = {state, fx, edit, editFx, bpm, storage, notify, monitor, dev,
seqCmd, tracks}` over `normalizeSerum(defaultSerum())` with every module powered on, then `new OscPanel(root, ui.kit, 0)` etc. into extra
`div.sx-root[data-dev]` roots (420 px wide unless stated, `ui.bp` set to a throw-away page record for ENV / LFO), `ui.paint(true)`, count.
Cross-checked against the live canvas app (`#serum`): the in-app OSC page = 3701 el, identical to the headless build; the `i1` module after
visiting all pages = 12 544 el (module chrome included). Times are Mac / Chrome, hidden box; an iPad is ≥ 1.5–3× (no iPad figure exists for
any of this: the touch path and closer zooms were never measured, HANDOVER §3).

---

## 2. Anatomy of `serum-ui.js` (5562 lines)

| Region | Lines | What | Kind |
|---|---|---|---|
| pure helpers | 140–745 | `haloArcs`, `knobMenuItems`, `dropRow`, `linkPoints`, `undoStack`, preset-browser list helpers, `virtGet/virtSet` | stateless, reusable as is |
| CSS | 750–1080 | `.sx-root { container: sx / inline-size }`, `--sx-*` tokens, the `@container sx` layouts | needs a per-part root |
| widget helpers | 1081–1487 | `numField`, `segField`, `hSlider`, `longPress`, `ghostAt` | stateless |
| `makeKit(ui)` | 1544–1580 | the binding kit §11.14: `host s fx snap knob menu toggle seg dropTarget edit editFx notify prefs doc num bind custom canvas panel live getN setN dragging queue dead paintSeq snapSeq prompt popover shapes openWtEditor wt` | the extraction seam |
| `SerumUI` core | 1582–2270 | ctor, state/`setN`/`edit`/`editFx`, panel undo (`markUndo/flushUndo/syncOutside/undoRedo`), touch tips, widget factories (`dKnob dToggle dMenu dNum dSeg`), `paint / setSnapshot / scanMods / paintMods / updateVoices / checkCapture`, canvases | **host** |
| shell | 2273–2425 | `buildHead` (66 el), `setPage/showPage`, `buildFoot` (KeyboardPanel) | **shell** |
| preset UI | 2426–2620 | load/save/step/revert/author dialog/hybridize/render-last, `PresetBrowser` (5078–5562) | VOICE hub material |
| overlays | 2644–2802 | `layerEl` (twin root in `#ov`), `popover`, `overlayOpen`, `dialog`, `promptText`, `enterValue` | **host** |
| mod layer | 2804–3092 | `onCtx/destMenu/knobMenu`, `menuActions`, module lock/paste/swap, `addModUI`, `midiLearn`, depth drag (Alt) | **host** |
| tiles + DnD | 3094–3345 | `makeTile`, `tileDrag`, `dragBegin/Move/Done`, `hitTest`, `doDrop`, `linkNew` | host, needs views |
| main menu, chains | 3347–3569 | `mainMenu`, init/load preset file, FX chains, tuning | VOICE material |
| OSC page | 3580–3636 | `buildOsc`: SUB/NOISE col, OSC col (tabs, selection), FILTER col; `panelTabs 3638`, `rowC 3678` | shell |
| panel shell | 3687–3791 | `panel()` (power, title menu, lock mark), `foldable`, `moduleDrag` | host (used via `kit.panel`) |
| tile strip | 3853–3870 | ENV 1–4, LFO 1–10, VELO, NOTE, WHEEL, MACRO 1–8 tiles (76 el) | bundled only |
| MACROS | 3876–3925 | `macrosPanel / macroMenu / renameMacro` | panel |
| ENV | 3928–4059 | `envPanel` + `envMenu/envSec/envVals/envN/setEnv/setEnvBpm/envLadderSec` | panel |
| LFO / VELO / NOTE | 4063–4294 | `lfoPanel` + `lfoEditorOpts/setLfoTool/openLfoEditor/lfoFolderMenu/shapeLib` | panel |
| VOICING | 4297–4337 | MONO/LEGATO/POLY, PORTA, CURVE, ALWAYS, SCALED, BEND ↑↓, voice count | panel |
| MIX / FX / ARP·CLIP | 4340–4400 | thin builders: `MixerPage` (loaded on demand), `FXRackUI`, `ArpPage/ClipPage` | pages |
| MATRIX | 4404–4740 | 64 rows × ~80 el, row drag, curve cells, canvas-row read-only list | replaced by the Mod list |
| GLOBAL | 4741–5029 | QUALITY, TUNING, MPE, VOICE CONTROL, UNISON A/B/C, CHAOS (S1), PREFERENCES, INFO | panels |
| `destroy` | 5032–5056 | | |

---

## 3. What mounts alone today (measured, `ui.kit` of one SerumUI)

| Mounted into an empty root | built el | vis | svg | canvases | `[data-dest]` | ms | result |
|---|---|---|---|---|---|---|---|
| `OscPanel(root, kit, 0)` | 811 | 290 | 55 | 6 | 68 | 3.5 | ok |
| `SubPanel` | 92 | 75 | 9 | 0 | 8 | 0.3 | ok |
| `NoisePanel` | 129 | 107 | 14 | 1 | 9 | 0.6 | ok |
| `FilterPanel(…, 0 / 1)` | 142 / 132 | 115 / 107 | 16 | 1 | 10 / 9 | 0.5 | ok |
| `ArpPage` | 306 | 259 | 26 | 0 | 13 | 0.8 | ok |
| `ClipPage` | 351 | 309 | 19 | 15 | 12 | 1.2 | ok |
| `KeyboardPanel` | 127 | 117 | 1 | 0 | 0 | 0.3 | ok |
| `MixerPage` (11 strips) | 821 | 673 | 59 | 2 | 52 | 2.3 | ok |
| `ui.macrosPanel()` | 129 | 94 | 9 | 0 | 8 | 0.3 | ok |
| `ui.voicingPanel()` | 80 | 65 | 7 | 0 | 6 | 0.3 | ok |
| `ui.envPanel()` | 145 | 102–120 | 14 | 2 | 10 | 0.6 | **fails without `ui.bp`**; ok with it |
| `ui.lfoPanel()` | 145 | 109–124 | 14 | 6 | 5 | 0.4 | **fails without `ui.bp`**; ok with it |
| `vcPanel / qualityPanel / tuningPanel / mpePanel / chaosPanel / unisonPanel(0) / prefsPanel / infoPanel` | 211 / 35 / 26 / 25 / 60 / 78 / 110 / 15 | 191 / 29 / 21 / 21 / 47 / 65 / 94 / 12 | | 0 | 6 / 0 / 0 / 0 / 4 / 5 / 0 / 0 | ≤ 0.6 | ok |
| `ui.tileStrip()` | 77 | 52 | 0 | 0 | 0 | 0.3 | ok |
| bundled header (`buildHead`) | 66 | 59 | | 0 | 1 | | part of ctor |
| `FXRackUI` (3 racks) | 125 empty (in app); + ≈ 100 per effect (1 effect 155, 4 → 442, 8 → 864) | | | 1 per display effect | `fx.<inst>.<pid>` | 2–11 | already a canvas module (`iN/fx`) |

Natural sizes with binds painted (layout px, the module's world px at k = 1): ENV 316×307, LFO 395×417, MACROS 237×212, VOICING 211×232,
OSC 257×631 (360×590), SUB 240×130, NOISE 240×262, FILTER 300×346, ARP 1100×542, CLIP 1100×1317, KEYBOARD 1100×205, VOICE CONTROL 400×418.
(In the bundled layout at 1200 px the OSC panels are 257×635 and the ENV·LFO·MACROS·VOICING row is stretched to 417.)

wk widget sizes: knob 11 el (1 svg: halo, track, face, value, pointer), power toggle 6, led 5, btn 4, numBox 6, seg(3) 8, slider 8, rangeBar 9,
meter 4, stepGrid 103 (VOICE CONTROL), menu 8–10.

---

## 4. Coupling inventory

### 4.1 What each region reaches in `this` (beyond `s fx d kit bind custom panel edit uiEdit getN setN notify bpm host`; `deps.mjs`)

| Region | Other `this.` members | Grade |
|---|---|---|
| `OscPanel / Sub / Noise / Filter` | none (kit only; `K.panel`, `oscData(kit)`, `K.popover`, `K.openWtEditor`, `K.canvas`, `K.live`) | **A** |
| `ArpPage / ClipPage / KeyboardPanel` | none (kit + `kit.host` members: `seqCmd tracks onInput clipToTrack metronome latency audition storage notify`); per-kit hub `HUBS` | **A** |
| `MixerPage` | none (kit; `kit.host.v2Fx`), strips are private methods (`outStrip 495`) | A (strips not separable) |
| `macrosPanel` | `renameMacro macroMenu makeTile recentSlot promptText menuActions` | A− (tile = drag source) |
| `voicingPanel` | `vcText` only | **A** |
| `envPanel + helpers` | `bp.editors, edSig, snap (envStage/envT), srcUsed×4, envVals×3, selectSrc, srcMenu, touchMenu, setEnv, setEnvBpm, envMenu, envLadderSec, lockModuleUI`; slot chosen by `s.ui.env` | **B** |
| `lfoPanel + helpers` | `bp (lfoBox, lfoEd, editors), edSel×6, lastLfo, lfoTool×3, lfoSnap, edDirty×3, edSig×3, big×3, lfoGest×6, snap, shapeLib, moduleMenu, srcDestItems, lfoFolderMenu, openLfoEditor, linkNew, wtToLfo (OscData.lfoShape), allPages, queue`; slot chosen by `edSel`; the same panel is the VELO / NOTE editor | **C** |
| `qualityPanel` … `infoPanel` | `prefLine chooseQuality osText setS1 loadTuning clearTuning store vcMenu vcPresets confirmDlg need replaceState edDirty setPref prefs` | B |
| `buildHead` | **~25**: `undo undoPend undoRedo dirty nameOverride browser currentPreset stepPresetUI savePresetUI authorDialog mainMenu renderLast lastRender waveDragT noteGroup editSeq tabBtns setPage vcEl meter mkeys headPage touch uid` | **C** |
| tile DnD (`makeTile tileDrag dragBegin dragMove hitTest doDrop`) | `drag tileEat settled hitName lfoPointAt pages[page].lfoBox edSel el` and `this.el.contains(t)` (264) | **C** (assumes one root) |
| `paint / scanMods / setSnapshot` | `shownPages (head + pages[page] + foot) pop big rack rackDirty edSig edKey modEls effMemo peeks` | **C** (page-shaped) |
| `popover / overlayOpen` | `el×9 pop overlay edSig bp popPage layerEl` | B (root = `this.el`) |

### 4.2 Eleven jobs `this.el` does (45 sites) — each needs a per-view or per-host answer
(a) root of 4 capture listeners (`contextmenu`, `pointerdown`, `click`, `keydown`: `installModLayer 2818`); (b) containment guards `this.el.contains`
(1922, 2850, 3030, 3082, **3264 `hitTest`**); (c) `touch` class + pointer/touch tips (1906–1915); (d) `data-dev` carrier (1651) — `a.level` exists in every
Serum; (e) the twin root `div.sx-root.sx-layer[data-dev]` in `#ov` for popovers/overlays (`layerEl 2652`, class copied from `this.el`); (f) full-screen
overlay container (`fullScreenOverlay` 2716, 2741); (g) `sx-dragging / sx-candrop` classes (3205, 3220, 3256); (h) `wk.onRescale(this.el)` (1658);
(i) `PresetBrowser(this.el, …)` (1668); (j) the large LFO editor host `gx.lfoEditorLarge(this.el, o)` (4231); (k) `applyHelp` (1951).

### 4.3 The page registry
`mkPage()` = `{el, binds, canvases, editors, lives}` (1495). `bind / custom / canvas / K.live / bp.editors.push` register into `this.bp || this.headPage`;
`showPage` sets `bp` while building. `paint` runs `binds` of `[headPage, pages[page], footPage]` only (hidden pages are never painted); canvases and
`lives(shown)` likewise (`updateVoices 2186`). **This registry is the unit a part view must own** (one per mounted view, gated by "module on screen").

### 4.4 Module-level singletons (benign)
`CLIP` module clipboard (1486, shared across Serums: copy/paste module between Serums already works), `UID`, `DEST_MOD`, `sx-ui-seq SLOT_CB`,
`NOISE_OV`; per-kit WeakMaps `DATA` (OscData: table/sample caches, tinfo for all 3 oscillators) and `HUBS` (live-input hub). One kit per Serum, shared by
all of its parts, is the right granularity. `wk.js` (3515 lines) holds only host-agnostic singletons the canvas already drives: `setLayer` (`#ov`), `setCanvasScale` (k at zoom end, read by `fitCanvas` / `canvasScale`),
the `onRescale` registry (zoom-end repaints; pruned when > 256 detached owners), `addTransient / closeTransient` (popups closed on a camera move), `setWheelVeto`, `setEdgeHook` (drag edge auto-scroll into the camera),
`modifierBar` latches, `releaseCanvases` (canvas → 0×0 on unmount); nothing there assumes one Serum. `graph.js` editors (`CurveEditor 608`, `EnvEditor 1297`, `PathEditor 1659`, `PZEditor`, `lfoEditorLarge 2152`,
`shapeLib 462`) and `wtedit.js` take option callbacks / a host, never a SerumUI: they mount anywhere (their own canvases + `observeSize`).

---

## 5. Per target module

Legend: **code** = what renders it today; **coupling** A (alone today) / B (`bp` + few members) / C (deep); **change** = what mounting alone needs; **size**
= built el (vis) / canvases / natural px.

### 5.1 Table

| Target | Code today | Cpl | Change to mount alone | Size |
|---|---|---|---|---|
| **VOICE hub** (new) | `buildHead` (preset ◀ name ▶ save, info, undo/redo, Menu, MASTER knob + meter, voice count, render-last, touch modifier bar) + `voicingPanel` + `envPanel` fixed k = 0 (ENV 1) + fold-outs from GLOBAL (QUALITY 35, TUNING 26, MPE 25, VOICE CONTROL 211, CHAOS (S1) 60, VELO/NOTE curves (11 el each, in `lfoPanel`), `s.kbd` KeyboardPanel 127) + the outputs (BUS 1 / BUS 2 / MAIN / DIRECT strips of `MixerPage`) | **C** | header becomes a `VoiceHeader(root, host)` view; preset UI, undo, browser, render-last are host features already (`host.presets`, `PresetBrowser(container, host, {layer})`); PREFERENCES (110) and INFO (15) are app / dialog level, not per-Serum parts; UNISON A/B/C (3 × 78) duplicate the OSC gear popover: drop in parts; outputs need `MixerPage` strips extracted | est. 66 + 80 + 145 ≈ 290 core (+ 211 VC + 127 kbd + 126 outputs: bus1 37, bus2 37, main 28, direct 24, measured in `MixerPage`) |
| **OSC A / B / C** | `OscPanel` (`sx-ui-osc.js 2645–2858`), selection handlers in `buildOsc 3593–3610`, tabs `panelTabs` | **A** | (1) lazy-build the type views: 421 of 811 el are the type views (wt 44, multi 29, sample 64, gran 176, spec 108; head 137; shared rows 250), 4 of the 5 are inactive → ≈ 350 el and 1 live canvas instead of 6; (2) `K.panel` bare mode (no power / title / collapse: the module bar has them; `o.collapse` would fold twice); (3) move "pressing selects `s.ui.osc` (Render OSC Warp / Resample target)" from `buildOsc` into the part; (4) pitch SRC / warp-source menus list the other oscillators whether or not their parts exist: dim absent ones; (5) `data-noisepanel` / `data-oscdisp` drop contracts (LFO → wavetable / noise) keep working via `hitTest` over all views | 811 (202–290) / 6 / 257×631–360×590 |
| **SUB / NOISE** | `SubPanel`, `NoisePanel` | **A** | bare shell; NOISE keeps `data-noisepanel` | 92 (64–75) / 0; 129 (78–107) / 1 |
| **FILTER 1 / 2** | `FilterPanel(root, kit, k)` | **A** | bare shell; the S A B C N switches (`routeTap → core.toggleFilterRoute`) are the same operation as a cable and stay (§7); display reads `D.liveN` (snapshot `eff`) and `filtTap` (FFT, only in view ≥ 1) | 142 / 132 (103–115) / 1; 300×346 |
| **ENV 2–4 (+ ENV 1 in VOICE)** | `envPanel` (tabs 1–4 by `s.ui.env`, BPM, LOCK, zoom, ⋯, `gx.EnvEditor`, 5 ADSR knobs, 3 curve knobs, START/END for 2–4) | **B** | `EnvPanel(root, kit, k)`: fixed slot (`E()` → k; no tabs), `bp` → the view's page, add kit members `editor(ed, sig)`, `snap`, `bpm`, `srcUsed`, `selectSrc`, `srcMenu`; `s.ui.envLock / envZoom / envGrid` are **one set per Serum**, shared by the 4 ENVs (keep: lossless round trip) | 145 (102–120) / 2 / 316×307 |
| **LFO 1–10** | `lfoPanel` (TYPE, MODE, MONO, DIRECTION, BPM/DOT/TRIP/HOST, grid, drawing tools, shape folder, large editor, `gx.CurveEditor` 160 px with loop/start/point links, `gx.PathEditor`, RATE/RISE/DELAY/SMOOTH/PHASE) | **C** | `LfoPanel(root, kit, k)`: fixed slot (`L()`), move `lfoTool / lfoSnap / big / lfoGest / lastLfo` onto the host (view state, shared by all LFO views), no VELO/NOTE area (own `CurvePanel('velo'\|'note')` in VOICE; 11 el, 2 canvases) | 145 (109–124) / 6 (2 path, 2 velo/note hidden) / 395×417 |
| **MACROS** | `macrosPanel` (4×2 grid, 8 `m<k>` knobs, 8 tiles = drag sources, rename, MIDI learn target) | **A−** | `MacrosPanel(root, kit)`; the tile is the cable source (jack) in parts view | 129 (94) / 0 / 237×212 |
| **CHAOS** | `chaosPanel` (2 rows CHAOS 1/2: RATE, BPM, MONO, S&H; Convert to Chaos LFOs; hidden unless S1 mode or a row reads chaos) | B | one-row `ChaosRow(root, kit, c)`; Serum 2's own chaos is LFO **TYPE** Lorenz / Rossler (in the LFO panel) — fate of a separate canvas Chaos module is a contract decision | 60 (47) / 0 |
| **ARP / CLIP** | `ArpPage / ClipPage` (+ `PatternEditor`, `LaneView`, `PianoRoll`, `SlotStrip`) | **A** | modules need `host.seqCmd / tracks / onInput / clipToTrack / metronome / latency`; ARP page adds a MACROS pane + toggle (`buildSeq 4389`) unless its page brings its own (CLIP does): omit in parts (MACROS is a module); `s.ui.arpEd` (pattern overlay) is state, so a second view of the same Serum would open it too | 306 (259) / 0 / 1100×542; 351 (309) / 15 / 1100×1317 |
| **KEYBOARD (key/scale/transpose/swing/OSC MAPPING)** | `KeyboardPanel` | **A** | place in VOICE fold-out or with the note tools (`s.kbd`); needs `host.audition` | 127 (117) / 0 |
| **Serum FX** | `FXRackUI` via `fxHost` (`main.js 2789`), module `iN/fx` already exists; the bundled FX page is a second embedded rack (125 el) | **A** | nothing to extract; hide the FX page in parts; BUS 1 / BUS 2 / MAIN / DIRECT strips (route, FX bypass `fx.racks[k].byp / route`, levels `g.bus1v / bus2v / master / direct`) must come out of `MixerPage` (`outStrip`, `bypassBtn`) into an outputs view for VOICE / S1 FX | 125 + ≈ 100 per effect |
| MIX page, MATRIX page, GLOBAL page | `MixerPage` (1394 with tiles + rowC), matrix 5231, GLOBAL 708 | – | **not needed in parts view** (cables / outputs view / Mod list replace them); stay in bundled | – |

### 5.2 What the bundled panel duplicates (for the budget)
tile strip 76 × 4 pages (OSC, MIX, FX, MATRIX) = 304; `rowC` (MACROS 128 + ENV 144 + LFO 144 + VOICING 79 = 496) × 3 pages (OSC, MIX, FX) = 1488;
MACROS again in the ARP page (128); UNISON A/B/C (231) duplicate the OSC gear popovers; an FX rack (125) again in the FX page next to the `iN/fx`
module; `[data-dest]` twins for every knob in rowC (U1 of 2a: cv-module takes the first element with a box).

---

## 6. Mounting alone — and twice (bundled + parts of one state)

### 6.1 Shape that fits the code
**`SerumHost`** = today's `SerumUI` minus shell: state/edit/undo/dirty, the kit, `snap`, paint scheduler, mod layer, tile/cable DnD, popover/overlay
layer, shape library, `OscData`, prefs, monitor subscription. **View** = `{id, kind, root, page: mkPage(), shown(): bool}`; `host.mount(kind, root,
args) → view` builds under `host.bp = view.page`. `SerumUI` = host + shell views (head, 7 pages, foot): its ctor / `showPage` become `mount` calls, so
the bundled panel stays byte-compatible and its 59 tests keep their shape. A part module = one view (VOICE = header + voicing + ENV 1 + fold-outs).

Changes in this order (all UI; goldens untouched):
1. `paint / scanMods / paintMods / paintCanvases / updateVoices / checkCapture / setSnapshot`: iterate `views.filter(shown)`; `scanMods` walks each view root
   (+ the popover box); halos only for views whose module is on screen (the world's on-screen plan).
2. Replace the 11 jobs of `this.el` (§4.2): listeners per view root (`onCtx / onCapDown / onCapClick / onKey` use `host.viewOf(target)` instead of
   `this.el.contains`); `hitTest` guard = "target inside any view root **of this host**"; classes (`sx-touch`, `sx-dragging`, `sx-candrop`) on every view
   root; per-host `layerEl` twin copies the class of the first view; `fullScreenOverlay` → `#ov` only (already the canvas path); `PresetBrowser` and the large
   LFO editor attach to the layer, not a root; unique `uid` per view for `aria-controls / -pb<N>` ids.
3. `bp` as a public `kit.page` (set by `mount`, restored after popovers); add kit members `editor(ed, sig)` (register + `edSig`), `bpm()`, `uiState`
   (`lfoTool lfoSnap lastLfo big lfoGest`), `srcUsed`, `selectSrc`, `srcMenu`, `moduleMenu`, `lockModule` — and mirror them in `tests/serum-ui-stubs/kit.js`
   (the export / member parity test, `serum-ui.test.mjs`).
4. Panel shell `K.panel(…, {bare: true})`: no `.sx-ptitle` row (the canvas bar has power ⏻ = `*.on`, title, ⋯ = `moduleMenu` items, fold ▾); `o.collapse` off.
5. Extract `EnvPanel / LfoPanel / CurvePanel / MacrosPanel / VoicingPanel / ChaosRow / Global panels / VoiceHeader / OutputsPanel` into `sx-ui-mod.js` (name
   from SPEC §8.6) with `(root, kit, args)` + `destroy()`: ≈ 1200 lines move out of `SerumUI` (env 190, lfo+shapeLib 340, macros 50, voicing 40, global 290,
   header + preset UI ≈ 300).
6. CSS: each part root is `div.sx-root.sx-part` (container `sx`, tokens, `data-dev`), fixed width per module; the `@container` layouts that arrange A·B·C / rowC
   side by side are irrelevant to a single panel (parts use the single-column / natural layout measured in §3).

### 6.2 Both views of one state at once
Works if the host is shared: one `s`, one panel-undo stack (snapshots exclude `s.ui`, so a switch is no undo step), one kit (one `OscData`, one live-input
hub), one `held / gest` set, one popover at a time. Per-view: page registry, DOM ids, halo scans, canvas stores. `data-dest` twins are already resolved by cv-module
("first element with a box"). **Hazards**: (a) `s.ui.*` flags are view state *inside the Serum state*: `arpEd` (pattern overlay), `kbdOpen`, `clipZoom`, `envLock / envZoom / envGrid`,
`oscTab / filtTab / osc / page / mod` couple the two views — fine for bundled XOR parts, visible if "Open as sheet" shows a bundled panel beside the parts;
(b) the same Serum mounted twice doubles DOM (bundled 3.7 k + parts ≈ 1.4 k); (c) switching destroys one view set and builds the other (cheap: 14–22 ms) but loses
host-only view state unless it lives on the host (`peeks`, `lfoTool`, `lfoSnap`, `macPane`, `mxExp`, `tabSeen`) — keep the host alive across the switch.

### 6.3 Events, overlays, dialogs
Popovers / overlays already go to `#ov` on the canvas (`layerEl`), closed by `wk.addTransient` on a camera move: unchanged. WT editor (`wtedit.js`: host
= `{state, edit, wt, smp, storage, notify, sampleRate, editorOpen}`) is one overlay per host (`editorOsc`). Two-finger rollback (`twoF`) is per widget: unchanged.
Press-and-hold mod menu (`wk` long-press + `touchMenu`) is per widget: unchanged, as long as `onCtx` is installed on every part root.

### 6.4 Source tiles / cables
In parts view the tile strip is not mounted; the module jack (cv-cables mod drag) replaces `makeTile → tileDrag`. A drop of a Serum-part source on a knob **of the
same Serum** must write `s.matrix` (`core.addMod(s, fx, 'lfo3', 'a.level', {limit})` = `host.addModUI`), not a `track.mods` row; on a knob outside it, the
existing `link` source path (`cv-mods.sourcesOf` already lists every Serum's `<dev>/lfo1…10.out` and `<dev>/env1…4.out`, kind `link`; `cv-graph.slotState / planSerum` compile them). The cable is then *derived* from the row (as 2a derives
"preset" cables). Selection of a source (`applySel` → `s.ui.mod / env / edSel`) becomes the canvas selection of the module / cable. `s.matrix` rows are edited
in the cable inspector via the existing preset-row path (`modEdit / modRemove`, `main.js 5720–5740`: `sxEdit` on `s.matrix[key.slot]` with `key = {preset: dev, slot}`), which already works slot-keyed.

### 6.5 Snapshots / monitors
`host.monitor(on)` (called by ctor / destroy, `sxMonitor main.js 2081`) is per (track, dev); the engine posts **one** snapshot per Inst at ≈ 30 Hz with every field
(`eff, mix[11], lfoPh/lfoOut/lfoY, envStage/envT, noisePos, wtPos, smpPos, oscVoices/maxVoices, filtTap(2×1024), memNow, zone, seq`); consumers per file: serum-ui
(lfo*, env*, tapRate, notes, eff, voices, mix, memNow), sx-ui-osc (notes, smpPos, noisePos, zone, wtPos, eff, tapRate, filtTap), sx-ui-seq (seq), sx-ui-mix (mix).
`live: () => cvLive(dev)` must become "any part module of this Serum is on screen" (`cvView.live(partKey)`); `setSnapshot` fans out to mounted views only. Parts
cannot subscribe to fields: the message is all-or-nothing per Serum.

### 6.6 Undo / dirty / preset
Panel undo (`undoStack(100)`, 600 ms coalescing, 4 MB on touch), `dirty` ("*" on the preset name), `nameOverride`, `confirmChange` are host-level and live with the VOICE
header; Cmd/Ctrl-Z must be handled on every part root (`onKey`). A preset load goes through `host.presets.load` as today and re-injects canvas rows (D11).

---

## 7. Internal cables ↔ state fields (verified in code; refines SPEC §8.3)

| Cable | State it is a view of | Helper |
|---|---|---|
| source (A B C SUB NOISE) → FILTER 1 and/or 2 | `osc[o]/sub/noise.route = 0`; balance `p['<x>.fbal']` (n 0 = F1 … 1 = F2, share (1∓b)/2); **plus one bool per source per filter**: `p['f.route<X>']`, `p['f2.route<X>']`, X ∈ S A B C N (10 bools — not in SPEC §8.3). Fed ⇔ `route===0 ∧ share>0 ∧ switch on` | `core.filterFeeds(s,k,X)` (read), `core.toggleFilterRoute(s,k,X)` (write; an off-route source is routed to Filter with the balance fully at k), `filterLit` |
| source → VOICE MAIN / DIRECT / nothing | `route` 1 / 2 / 3; `env` bool = AMP ENV gate (only meaningful on Main / Direct) | routing popover `routeControls 1409` |
| bus sends | `p['<x>.bus1' / '.bus2']` knobs | |
| FILTER 1 ↔ FILTER 2 | `filter[k].route = 0`; setting it while the other feeds back sends the other to Main (most recent wins) | `routeControls` set |
| FILTER → MAIN / DIRECT / none | `filter[k].route` 1 / 2 / 3, `filter[k].env` | |
| OSC → OSC warp / FM / RM / pitch ratio source | `p['<x>.w1' / '.w2']` (WARPS2 index/81), legacy `<x>.warpMode`, `osc[o].fm[slot]`, `osc[o].pitch.src` ('note' \| 'A' \| 'B' \| 'C'); cycles are resolved at edit time (`warpChoice2`, `pitchChoice` return the oscillators reset) | `warpMenuItems`, `warpSrc` |
| VOICE → own FX | `fx.racks[1 / 2].route` (0 Main, 1 Direct, 2 other bus), `fx.racks[k].byp`, `g.bus1v / g.bus2v / g.master / g.direct` | `MixerPage.outStrip`, `busRoute` |
| modulator → knob (same Serum) | `s.matrix[slot] = {src, dst, amt, bi, curve, aux, inv, byp, out, acurve, crv, rise, fall, slink}` | `core.addMod`, `dropRow` |
| macro → knob | row `src: 'macro<k>'`; the knob itself is virtual dest `m<k>` (base `macros[k].v`) | `virtGet / virtSet` |
| LFO point → modulation | `lfo[l].pts[i][3|4]` bus index + row `src → bus<k>` | `linkPoints`, `core.linkedBuses` |

Part registry: `MODULE_FIELDS` (serum-core 835) = `oscA/B/C, sub, noise, filter, filter2, env1–4, lfo1–10, velo, note, arp, clip, vc, matrix`; slot counts are array lengths
(`osc[3] filter[2] env[4] lfo[10] macros[8] chaos[2] matrix[64]`). Moving a part to another Serum = `core.copyModule(dst, src, m, from, {mods:true})` (osc ↔ osc, filter ↔
filter2, env ↔ env, lfo ↔ lfo; **sub / noise only onto themselves**: a second SUB / NOISE can only mean a new Serum) then power the source off. **There is no "first free slot of
that kind" helper** (only `freeSlot(s)` for matrix rows); free = `*.on` off and default state — to be written. `swapModules` / `initModule` / `clipModule / pasteModule` exist.

---

## 8. Canvas modulators vs Serum's own panels

### 8.1 The four bodies today (`cv-mods-ui.js`, interface `bodyFor(kind, o) → {el, update, sync, destroy}`, `o = {doc, get, edit(fields), bpm?, set?, learn?}`)

| Canvas body | Lines | el (module chrome ≈ +15) | World px (`W_MOD 240` × `MOD_H`) | Serum's panel | el / canvases / natural px |
|---|---|---|---|---|---|
| `lfoBody` | 276–404 | 50 | 240×256 | `lfoPanel` | 145 / 6 / 395×417 |
| `envBody` | 414–452 | 81 | 240×224 | `envPanel` | 145 / 2 / 316×307 |
| `macroBody` | 461–504 | 113 | 240×288 | `macrosPanel` | 129 / 0 / 237×212 |
| `chaosBody` | 551–580 | 23 | 240×224 | `chaosPanel` (one row) | 60 (2 rows) / 0 |

### 8.2 State shapes (serum-core 1692–1706; `song.normModDev`; engine side `cv-graph.writeSlot 407`)

| Device kind | Device record | Serum slot it is | Engine support |
|---|---|---|---|
| `lfo` | `{lfo: normLfo{mode mono type dir bpm dot trip anchor x10 swing pts path loop start}, rate rise delay smooth phase}` (knobs = `l<k>.*` n) | `s.lfo[k]` + `p['l<k>.rate/rise/delay/smooth/phase']` | **whole LFO model** (ModCore reuses `SerumDSP.attach`); GLOBAL = `lfo.mono: 1` |
| `env` | `{env: {bpm legInv stealRe}, att hold dec sus rel start end, crv:[ca,cd,cr]}` (0…1) | `s.env[k]` + `p['e<k>.*']` (ENV 2–4; `sus`² only for ENV 1) | whole ENV |
| `chaos` | `{chaos: {mono sh}, rate, bpm, smooth}` | `s.chaos[c]`, `p['c<c>.rate' / '.bpm']`; **`smooth` has no Serum param** (module-only, engine-optional) | Serum chaos |
| `macro` | `{v:[8], names:[8 ≤ 16]}` | `s.macros[k] = {name ≤ 24, v}` (virtual dest `m<k>`) | 8 macro sources (first module) / value table |

### 8.3 What the canvas bodies lack (identical look and editing means all of it)

| | Canvas body | Serum panel |
|---|---|---|
| LFO | badge GLOBAL / PER NOTE, mode (RETRIG ENV FREE), rate numBox + BPM · T, shape *menu* of 11 presets, 190×72 SVG point editor (tap adds, drag, bend), live bar | TYPE (Normal, Path, Chaos: Lorenz, Chaos: Rossler, S&H), MODE (FREE RETRIG ENV), MONO, DIRECTION, BPM DOT TRIP HOST, GRID x,y, drawing tools (Point Flat Ramp Up Ramp Down), shape library (load / save / import / export, Wavetable → LFO), large editor, `CurveEditor` canvas 160 px with loop / start markers, snap, point links, PATH editor, RATE RISE DELAY SMOOTH PHASE knobs (swing / 10x in the RATE menu), phase dot |
| ENV | 5 vertical sliders, 3 curve numBoxes, 190×56 AHDSR drawing | `EnvEditor` (draggable corners and curve handles, ghosts of other used ENVs, beat grid, BPM-unit time steps, LOCK / zoom, playhead), 5 + 3 knobs, START / END (2–4), menu (Legato Inverted, Voice Steal Retrigger, Grid, Lock) |
| Macro | 8 rows: 24 px knob + name box + value; jacks `k1…k8` on the right edge at the rows (`modJackY`) | 4×2 grid: 30 px knob + name tile (the drag source), rename, MIDI-learn target, knob menu |
| Chaos | rate numBox, BPM, **smooth**, 64-sample scope | RATE knob, BPM, MONO, S&H per chaos source |
| Chrome | one `out` jack at the top right (macro: 8); bar badge GLOBAL / PER NOTE for LFO | no jacks (tiles); the LFO panel's title is a module menu (Lock, Init, Copy, Copy w/mods, Paste, Swap with ▸ + the source's Bypass / Remove All Destinations); ENV has a ⋯ menu (Legato Inverted, Grid, Voice Steal Retrigger, Lock Module); MACROS none (knob menu: Rename…, MIDI learn) |

### 8.4 How to render Serum's own panels in the canvas modules
Recommended: **slot host** — a `SerumHost` (§6) built over a synthetic state, memoised per module: `s = normalizeSerum(defaultSerum())` with the device's slot overlaid exactly as
`writeSlot` does (0.35 ms, 29 KB, never serialised); `fx() = null`; `edit(fn, o)`: `fn(s)`, then for phase `'end' | 'set'` read the slot back into device fields and call `o.edit(fields)` (a nested
`lfo` / `env` / `chaos` object whole — the 2b `editor()` contract: one History step per gesture end; start / move stay local); panel undo **off** by a host option (`undoStack` has no "off": `maxBytes: 0` means the 16 MB default,
and every gesture end would `JSON.stringify` the 29 KB state); `fx()` = a shared empty default FX state (menus and `fctx` read it); `sync()` after an
outside edit rebuilds the overlay. The panels are the very same `LfoPanel(root, kit, 0)` / `EnvPanel(root, kit, 1)` / `MacrosPanel` / `ChaosRow` that a Serum's parts use (one code path; the same code
mounts for a Serum's own LFO k through the Serum's host). Differences to handle:
- **`data-nomod`** on every control of a modulator module (cv-cables already refuses `[data-nomod]`; otherwise `l1.rate` would look like a drop target: `destOk` must also refuse modulator kinds).
- **LFO point links** (`pointMenu`, "Modulate point", "Remove Point Modulations") need `s.matrix` buses: hide them in a slot host (`pts` keep their `mx / my` indices, harmless).
- **ENV ghosts** (other used ENVs behind the curve) need sibling data: none for a canvas ENV, or ENV 1 of the track's Serum as in the bundled panel (decision).
- **Chaos `smooth`** (module-only) and the scope stay extras next to the Serum rows, or are dropped (no engine support for `smooth`).
- **Names**: macro names ≤ 16 (device) vs ≤ 24 (Serum).
- **GLOBAL / PER NOTE**: the same bit as Serum's MONO (`lfo.mono`, chaos `mono`); keep Serum's MONO button inside the panel and show the badge on the module bar bound to the same field.
  ENV is always per note (no badge); macros / CC have none.
- **Panel title bar** hidden (`bare`); canvas bar menu = `moduleMenu` items (copy / paste between modules of one kind uses the shared `CLIP`).
- Module geometry: `W_MOD 240 / MOD_H` (cv-module 47–48) and the Tidy modulator column (`x −320`, `MOD_GAP`) change to the natural sizes of §3 (+ 40 bar): LFO ≈ 395×457, ENV 316×347, MACROS 237×252.
- **Macro jacks**: eight right-edge jacks at 28 px rows cannot align with a 4×2 grid. Either jacks sit under / on each name tile (new inline jack placement; cv-module jacks are `left | right` + y only) or the module keeps a one-column macro layout — contract decision.

### 8.5 Velocity / Note / CC
Serum's VELO and NOTE are curve editors (`s.velo.pts`, `s.note.pts`, `porta`) inside `lfoPanel`'s hidden `curveArea`; the canvas Velocity module (2a) shows only the default diagonal. "Where possible" (ROADMAP row)
would give Velocity / Note modules a `CurvePanel` and a state field ModCore evaluates (`sy.velo.pts`); CC has no Serum counterpart.

### 8.6 Live values
`mcSnap` calls `B.update(mc[e.i])` with a scalar; `lfoBody.update` already accepts `{v, ph}` but nothing sends `ph`. Serum's LFO editor needs `lfoPh / lfoOut / lfoY`, the ENV editor `envStage / envT`. `ModCore.live` = `Float32Array(16)`
(lfo 0–9, env 10–13, chaos 14–15, values only; mod-core.js 56). Matching the Serum look needs a neutral-gated addition to `{t:'smon', mc}` (3 floats per source) or a level-only fallback.

### 8.7 Bugs found in the deployed canvas bodies (verified)
- **ENV curves (cv-mods-ui.js 421, 430–431 vs serum-core 1697–1702, graph.js 1376).** State / engine: `crv = [ca, cd, cr]` in 0…1, `ca = 0.5` is linear (`EnvEditor`: `k = ENV_K·(2·ca − 1)`; defaults 0.5 / 0.666 / 0.666).
  `envBody` reads `crv` as −1…1: the default module shows **"A curve +50 / D curve +67 / R curve +67"** and draws `bend(t, 10·0.5)` while the engine plays a linear attack; a user "0" is written as `crv: 0` → clamped by `normEnvMod`
  to 0 → the engine's extreme curve (k = −10); negatives clamp to 0. Fix by construction: the Serum `EnvPanel`.
- **Live phase never reaches the LFO shape** (8.6): the dot code exists, the host never feeds it.

---

## 9. Facts for the contract's first question (many modules, DOM, no visible re-render)

1. **What is vector, what is raster.** Controls are DOM + inline SVG (knob 11 el, re-rastered by the browser at rest, compositor-scaled in a pinch, as 1h §4 recorded for Serum / FX / Simple
   modules). Displays are 2D canvases: OSC 6 each (the display of each of the 5 type views + a spectral mini; only the active type's is painted: 1 live of 6), FILTER 1, NOISE 1, ENV 2 (`gx-cv` + `gx-ov`),
   LFO 6 (the lfo, the velo / note curve and the path editors, each `gx-cv` + `gx-ov`; 4 of 6 hidden for an LFO), CLIP 15, FX ≈ 1 per display effect, MIX 2.
   Store = `clamp(dpr / localScale, 0.5, 2) × layout size` (`paintCanvas 2239`, ≤ 16e6 px each), redrawn on `wk.onRescale` (zoom end) and by `ResizeObserver`: at dpr 2 the store is 1:1 only for k ≤ 1,
   **0.5 store px per device px at k = 2**, and every zoom end redraws: the "renders in" the user rejected (1h). Bundled Serum, all pages visited: 63 canvases = 17.3 MB at k = 1.
2. **Nothing unmounts any more** (cv-module header: bodies mount once and live as long as the module; no cards / culling since 2026-10-17). Parts view with N modules = N permanently mounted DOM trees; only off-screen
   live displays pause (`[data-cv-off]`, `host.shown`, `monitors`).
3. **DOM budget (est. from §3 / §5):** Serum (complete) default ≈ 1.4 k el / ≈ 10 canvases / 4 modules (VOICE core 290 + OSC A 811 + FILTER 1 142 + S1 FX 125); 3 OSC + SUB + NOISE + 2 filters + ENV 2–4 + 4 LFO + MACROS + VOICE (core only) +
   S1 FX with 4 effects ≈ 4.9 k el / ≈ 55 canvases / 17 modules; + ARP + CLIP ≈ +660 el / +15 canvases. Lazy OSC type views (−460 el per OSC) and not building duplicates (§5.2) are free wins; bundled today is 3.7 k (OSC page) to 12.5 k.
4. **Build cost is not the issue** (Mac): bundled ctor 14–22 ms, any page 1–7 ms (matrix 6.6), single panel 0.3–3.5 ms, `paint(true)` ≈ 1 ms. A whole-module restyle (the old `.cv-mod[data-cv-off] *` rule) cost ≈ 1.5 ms per
   toggle for a 3.7 k-node panel on the Mac (IMPL-1e §8.5 hotfix 2): per-module style work scales with DOM size, which is why the §5.2 duplicates matter more than build time.
5. **Measuring on the iPad** needs a Serum fixture: `tests/ui-bench.html` drives the app in an iframe with the `__synthTest.cv.add` hooks and a pinch / pan script over hardware panels; it has no Serum-parts set. Its two candidate switches (per-module
   compositing layers while moving, off-screen bodies not rendered) exist already.
6. What the GL path (1h) can and cannot take: faces are static SVG → textures; Serum parts are live interactive DOM + animated canvases (no DOM-to-texture in WebKit). Options for the contract are therefore (A) DOM as today plus the free
   reductions above, (B) canvases drawn at ≥ 1:1 for the current k with GPU-scaled in-between (needs the 2-cap lifted and a redraw policy that does not swap visibly), (C) rebuild controls as GL sprites (1h §4's "next stage"). This map takes no position.

---

## 10. `main.js`: where Serum UI is primary-only (what parts need generalised)

`sxPanel` (the primary's record, 9 sites) vs `serumPanels` (key `trackId/dev`, 9): `sxRecOf 2836` (primary → `sxPanel`), `sxRecs 2819`, `sxDrop 2820`, `renderCustom 2838` (builds one `SerumUI` into `cvBodyEl`), `sxMonitor 2081`
(`deliver → r.ui.setSnapshot`, `zoneWarm` only `if (r === sxPanel)`), `zoneOf 2103` (**reads `sxPanel.ui.snap`**: the multisample zone of the primary), `sxRefresh 2151` (`r.ui.refresh()` for every record), `peerRefresh 4878`,
line 2381 (`sxPanel.ui.confirmChange()` on a program change: primary only), `fxTab / fxRecOf` (the primary's FX; `fxHost(t0, rec = fxTab)`), `cvHomeKeys / cvBodyEl 4487` (`#inst`, `#fxrack` moved **by reference** into the primary's modules),
`wtEdit` (already device-aware). The 1e accessors (main.js has 90 `.model` and 54 `.vals` references; HANDOVER counts ≈ 180 accessor sites) are the contract's separate task. A part view needs: records keyed `trackId/dev/part` (or one host record per Serum with a view map),
`kindOfKey` learning `'part'` keys (`iN/oscA`, `iN/env2`, `iN/lfo3`, `iN/arp` …, view-only `lay` entries + a `hid` flag for removed parts), `cvMountBody` building views through the host, `sxMonitor.live` = any part on screen,
`sxHost` unchanged (already `(track, dev)`), `zoneOf / confirmChange` per device.

---

## 11. Tests touched / new
Existing (one file at a time): `serum-ui` 59 tests (own fake DOM; stubs for siblings in `tests/serum-ui-stubs/*`; kit parity test), `sx-ui-osc` 52, `sx-ui-seq` 51, `sx-ui-mix` 16, `cv-mods-ui` 14, `cv-module` 52, `cv-modlayer` 12,
`graph` 50, `wk` 99, `fx-ui` 55, `canvas-2a/2b-sim` 26 / 22 (2a imports `dropRow`). `tests/serum-ui-stubs/kit.js` is a ready "kit over a plain state" — the template for the slot host's unit tests. New: view registry / paint gating,
`mount` of each extracted panel alone and twice (state identical, ids unique), bundled → parts → bundled leaves `vals.s` byte-identical, slot host round trip (device ⇄ synthetic slot) for LFO / ENV / chaos / macro,
`data-nomod` refusal, cross-host `moduleDrag` guard, internal cable ↔ field mapping (`filterFeeds`, `toggleFilterRoute`, `copyModule`), "first free slot" helper. Never pass fake-DOM nodes to `assert`.

---

## 12. Findings and open decisions

Findings (each verified by running or reading the code):
1. Canvas **ENV curve boxes / drawing disagree with the engine** (§8.7). Deployed since 2b; the user's "envelope module does not look like serums" may include it.
2. `moduleDrag.find` (3761) matches `[data-modlabel]` anywhere in the document with only a same-kind test; `moduleDrop → swapModuleUI / copyModule` acts on **this** host's state. Dropping OSC A's label of one Serum on another Serum's OSC B swaps inside the first. Latent now (one instrument per track), certain once several Serums share a canvas.
3. `envPanel` / `lfoPanel` throw without `this.bp` (measured). One-line cause, but it shows the panels were never mounted outside `showPage`.
4. `OscPanel` builds all five type views eagerly (421 of 811 el hidden): cheap win independent of parts.
5. The SPEC §8.3 table omits the ten per-filter route bools (`f.route<X>`, `f2.route<X>`); 2b already made them non-modulatable; the S A B C N switches in `FilterPanel` are the cable UI in miniature (`toggleFilterRoute`).
6. Panel-shell `collapse` and the module fold ▾ would fold twice; panel power ⏻ and the bar ⏻ would duplicate.
7. `s.ui.*` view flags live in the saved Serum state and couple simultaneous views (arpEd overlay, kbdOpen, envLock / envZoom / envGrid).
8. `ModCore.live` / `mcSnap` carry values only: no LFO phase, no ENV stage (§8.6).

Open decisions for the contract (no position taken here): macro jack geometry (§8.4); the fate of a separate canvas Chaos module vs LFO TYPE Chaos; where KEYBOARD (`s.kbd`), VELO / NOTE curves, VOICE CONTROL and the outputs strips live (VOICE fold-out vs own
modules); per-Serum vs per-module ENV view state (zoom / lock / grid); ENV ghosts in a canvas ENV; bundled XOR parts policy and whether "Open as sheet" may show both; the rendering option of §9.6; lazy building (a module's body built when it first enters the on-screen band,
never destroyed) vs always-eager; live phase / stage data for the canvas modulators; the "first free slot" rule for moving parts between Serums.

---

## Appendix: reproduce
`scratchpad/m3/measure-dom.js` (paste into the browser pane at `http://localhost:8817/`; the dev server: `preview_start synth`), `scratchpad/m3/deps.mjs` (`node deps.mjs`: the `this.` members per SerumUI region).
Numbers in §3 / §5 come from that script's all-on state; in-app (OSC A only on, collapsed headers) the OSC panel shows 201 vis, MACROS 93, ENV 101, LFO 108, VOICING 54, SUB 63, NOISE 77, FILTER 102.
