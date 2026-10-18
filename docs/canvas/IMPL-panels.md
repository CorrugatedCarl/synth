# Hardware panels, the layout toggle and zoom consistency (IMPL-panels)

| | |
|---|---|
| Stage | **1b+ Hardware panels** (ROADMAP.md): fixed, hardware-accurate front panels for the 12 classic synths; a Hardware / Resizable layout toggle in each instrument module's `⋯` menu; zooming never changes how a module looks |
| Authority | The user's feedback and the lead's rulings P1 and Z1 (§1). [SPEC-canvas.md](SPEC-canvas.md) and [IMPL-1b.md](IMPL-1b.md) still apply wherever this file does not change them. This file wins over IMPL-1b §4.1 (cards, LOD, culling), §4.4 (`cull`, card view, the instrument's width range), §5.2.5, §5.3.2 (instrument width, `cull: 'hide'`) and §10.1, and over SPEC §2.11 and §9.3 (cards, "zoom in to edit"). A conflict between this file and the user's words is a question for the lead, not a choice for a lane |
| Lanes | **ENGINE** (one lane: renderer, sizing, toggle, zoom; all code) · **AUTHORS** (one data file per model: `panels/<model>.js`; one agent may take several models, §2.4) |
| Branch | `canvas`. Never switch branches, commit, push or touch `main`; the lead commits and deploys |
| Already in the tree | `panels/index.js` (model id → layout; `LAYOUTS`, `HW_IDS`, `layoutOf`) and the twelve stubs `panels/<model>.js` (`export default null`). They are not imported by the site yet, so every test stays green until ENGINE wires them (§2.3) |
| Research | Verified per-model measurements (two adversarial fact-check passes each): `/private/tmp/claude-501/-Users-dom-Documents-Claude---Synth-Synth/1970ec50-fa17-41f8-a8ba-68d2b52fc7be/scratchpad/canvas/panels/research/<model>.json` (+ `<model>.md` notes for 9 of them; crops and photos beside them). Positions there are mm, control centres, ±1.5–5 mm |

---

## 0. Ground rules (every lane)

1. **No DSP or compile file changes.** `git diff main -- engine.js serum-dsp.js fx-dsp.js fx-mods2.js sx-base.js sx-filt2.js sx-warp.js sx-mod.js sx-sample.js sx-gran.js sx-spec.js sx-seq.js serum-core.js fx-core.js models.js laws.js tuning.js` stays empty beyond today's baseline: `main` has moved to `?v=10`, so the diff already shows the import suffixes (`?v=9` vs `?v=10`) in `serum-core.js`, `fx-core.js` and `models.js` (11 lines, suffixes only) — nothing else may appear. All panel data lives in `panels/`, never in `models.js`. Importing (reading) `models.js` is fine.
2. **Every control keeps its identity.** A classic control is identified by its `models.js` id: one live widget per id in either layout, registered in `main.js`'s `ui` map under that id, its `aria-label` = the `models.js` label, and (new, both layouts) `data-ctl="<id>"` on its wrapper. Presets, undo, the preset chip's "Custom", `refreshAll`, and stage 2b's classic mod menus address controls through these. (Classic controls have no MIDI learn or press-and-hold menu today; nothing here may make adding them in 2b harder: same id, same element contract in both layouts.) Serum and FX widgets (`data-dest`) are untouched.
3. **Parallel editing.** Edit only your files (§2). Re-Read the exact region right before each Edit; anchor on symbol names, never line numbers; never rewrite `main.js`, `style.css`, `index.html` or a test file wholesale; match the house style (dense code, terse `//` comments that say why).
4. **Memory safety.** Never the full suite or a glob. One file at a time: `node --max-old-space-size=2048 --test tests/<file>.test.mjs`. New tests import `'./v8-guard.mjs'` first, import site modules with `?v=9`, and never hand fake-DOM nodes to `assert.*` (compare ids, strings, numbers). File search only inside the project and the scratchpad; never disk-wide.
5. **Node-safe modules.** `cv-panel.js` and `panels/*.js` are plain ES modules with no DOM, `window` or storage access at module top level, and every runtime path survives `tests/main-sim.mjs`'s DOM stub (IMPL-1b §0.5: no `ResizeObserver`, `getComputedStyle`, `visualViewport`; `querySelector()` returns a fresh inert node; keep references to the nodes you create).
6. **Imports carry `?v=9`.** After any site-file change run `node tools/precache.mjs --write` (`tests/pwa.test.mjs`, `tests/lint.test.mjs`). New files under `panels/` must be precached (§2.3).
7. **Original artwork only.** Functional labels, legends and layout are facts and are fine. No logos, wordmarks, maker names or badge art in any panel; the model name in plain type is fine (as today's nameplate). No `<image>`, no external `href`, no copied trade dress (a photo-like rendering of a maker's emblem, lettering style or badge).
8. **Usable at every checkpoint.** A model whose layout is `null` (or fails validation at run time) shows its Resizable layout only, so ENGINE can land before AUTHORS and AUTHORS can land one model at a time.
9. **Done** for a lane = its tests green (§9), the gate set green (§9.4), the preview checked (§9.5) with no console errors and viewport emulation reset, and a short hand-back note to the lead (files touched, tests run, anything left for another lane).

---

## 1. What this delivers

The user's feedback on stage 1b, verbatim:

> "i shouldnt be able to resize synths that have a physical counterpart. our synths layout should be the same as their real life counterparts and shouldnt be rearrangeable
> also i do not like how when zoomed out the modules load out and some even change size. why cant we just keep rendering the modules when zoomed out so it is visually consistent?"

and, after the research: "can we keep the resizable synths as an option in the little ellipsis dropdown meny".

The lead's rulings, binding here:

- **P1.** Every classic synth (all of `models.js` `MODELS` but Serum: modular, minimoog, arp2600, solina, cs80, prophet5, ms20, tb303, obxa, jupiter8, juno60, dx7) gets one fixed-size module whose front panel is laid out like the real instrument: the same sections in the same places and order, the same control types (rotary knob, slide pot, rotary switch, toggle, rocker, push button, LED, display), the same relative proportions. No resize grip, no Reset width, nothing reflows. One physical scale for all (bigger hardware = bigger module) with every control operable at 100 % zoom. The panel body shows the hardware controls only; presets live in the module bar's chip; our controls the hardware lacks go to a separate **extras strip** at the panel edge; hardware controls we don't emulate are omitted, or drawn as inert, dimmed decoration labelled "not emulated" when the layout needs them to be recognisable. The keyboard is not drawn. Serum and FX panels are not physical and stay resizable.
- **The toggle.** Each classic instrument module's `⋯` menu switches between **Hardware layout** (default) and **Resizable layout** (today's flowing panel with its width grip and Reset width). Per module, in `track.lay`, one undo step, survives reload and duplicate; switching keeps every value; the hardware layout always comes back exactly.
- **Z1.** Zooming never changes how a module looks: no cards, no level-of-detail swap, no hiding or unmounting of modules in or near view, no size changes; modules simply scale with the camera. Off-screen live displays (scopes, meters, animations) may pause, invisibly. Pan and zoom stay transform-only on iPad.
- **Kept:** the world-fixed dot grid (fine dots every 32 world px, major every 128) and snap-to-dots with the toolbar Snap toggle (`cv-world` `DOT`, `MAJOR`, `SNAP_PREF`, `snapOn`; `cv-module` `gsnap`). Hardware modules are whole multiples of 32 world px so their edges sit on the dots.

---

## 2. Ownership

### 2.1 Files

| File | Owner | Scope |
|---|---|---|
| `panels/<model>.js` (12 files) | **AUTHORS**, one file per model | the layout object of §3, data only |
| `panels/index.js` | ENGINE | as created; AUTHORS never edit it (every model is already imported) |
| `cv-panel.js` (new, root) | ENGINE | §4, §5: format constants, `validate`, `geometry`, `sizeOf`, `hitBoxes`, `decorSvg`, `render`, the hardware widgets and special areas |
| `cv-world.js` | ENGINE | §8 (Z1) |
| `cv-module.js` | ENGINE | §7 (fixed size, `makeRoom`, BG_SEL) and §8 (no cards) |
| `main.js` | ENGINE | §6, §7, §8: the functions listed in §2.2 |
| `song.js` | ENGINE | `normLay` keeps `ui: 'flow'` (§7.1) |
| `style.css` | ENGINE | a new `/* ===== cv-panel (ENGINE lane, IMPL-panels)` section placed **between** the cv-world and cv-module sections (cv-module stays last: its test checks that), plus card / grip / off-screen edits inside the cv-module and cv-world sections |
| `tools/precache.mjs` | ENGINE | directory-relative import specifiers (§2.3) |
| `tools/panel-check.mjs` (new) | ENGINE | §4.6: the AUTHORS' checker |
| `sw.js` | generated | `node tools/precache.mjs --write` |
| tests | ENGINE | new `tests/cv-panel.test.mjs`; adapted `cv-world`, `cv-module`, `canvas-sim`, `cv-fixes-sim`, `main`, `pwa`, `lint` (§9). AUTHORS edit no test: the per-model checks in `cv-panel.test.mjs` loop over every non-null layout, and the lead (or ENGINE) pins each model's row of its size table (§9.1) from the AUTHOR's hand-back note |
| everything else (`index.html`, `cv-tray.js`, `cv-art.js`, `gesture.js`, `wk.js`, Serum and FX UI files, DSP/compile files) | nobody | not edited in this stage |

### 2.2 `main.js` (ENGINE)

| Area | Functions |
|---|---|
| Panel | `renderPanel` (the hardware branch, §6.1), `control` (adds `data-ctl`), `knob` (`c.sweep`), `slider` (`c.orient`, `c.invert`, cap size from CSS vars), `drag` → generalised as `dragB(el, binding, o)` with `drag(el, c) = dragB(el, bindingOf(c))` (§5.4), `presetUI` (its Save / Delete / Init / ◀ ▶ become shared functions, §7.4), `seqUI` (split into `seqParts`, §6.2), `drawAlgo` (unchanged; the DX7 chart reuses `algoLayout`), new `instUi(t)`, `hwApi()` |
| Canvas region (formerly MODULES) | `initModules` (`screen` instead of `lod`), `cvLive`, `cvRender` (+ `makeRoom`, §7.3), `cvHost` (`size`, no `art`), `cvMenu` (§7.2), `cvLay` (`what: 'layout'`), new `cvSetLayout(ui)`, `cvChip` / `cvChipFill` (◀ ▶), `cvModuleSize`, `cvReveal` and `cvCamRestore` (`READ_K`), `cvTidy` (fixed sizes) |
| Not edited | `selectTrack`, `setTrackModel`, `addTrack`, `deleteTrack`, `applyRestore`, `loadProject`, `edit`, `changed`, audio/transport/recording code, `duplicateTrack` (it already copies `lay`) |

### 2.3 Precache and the `panels/` folder (ENGINE, step E1)

`cv-panel.js` imports `./panels/index.js?v=9`, which imports `./<model>.js?v=9` relative to `panels/`. Today `tools/precache.mjs` resolves every specifier against the root, `tests/pwa.test.mjs` compares the crawl with `readdirSync(ROOT)`, and `tests/lint.test.mjs` lints root files only. ENGINE changes, in one step with the first import of `panels/index.js`:

- `tools/precache.mjs` `appRequests`: resolve `./x` and `../x` against the importing file's directory (`new URL(spec, 'file:///' + from).pathname.slice(1)`), so the crawl lists `panels/index.js`, `panels/minimoog.js`, … with `?v=9`; the build hash covers them.
- `tests/pwa.test.mjs`: the expected script list is the root `.js` files (minus `sw.js`) plus `panels/*.js`.
- `tests/lint.test.mjs`: `SITE` includes `panels/*.js` (every relative import carries `?v=9`; the `panels/<model>.js` files import nothing).
- The service worker serves `panels/<model>.js?v=9` from the precache like any other script (check the offline test in `pwa.test.mjs`).

### 2.4 Suggested AUTHOR split

Four author agents, three models each, so related hardware shares an author: **A1** minimoog, modular, arp2600 · **A2** ms20, tb303, dx7 · **A3** prophet5, obxa, jupiter8 · **A4** juno60, cs80, solina. The split is the lead's call; the contract does not depend on it.

---

## 3. The layout data format (`panels/<model>.js`)

### 3.1 Units and the common physical scale

- **Panel units are millimetres of the real instrument.** Coordinates are copied from the research JSON in its own frame (mm, x right, y towards the player; a control's `x, y` is its centre; a rectangle's `x, y` is its top-left).
- **One scale for every model: `PX_PER_MM = 2`** (world px per mm, `cv-panel.js`). At 100 % zoom a 27 mm Minimoog knob is 54 px; the tightest live pitch of any model (Juno-60 slide pots and buttons, 15.3 mm; Jupiter-8 slide pots, 15.4 mm) is 30.6 px, so every control gets a ≥ 28 px hit area without overlapping its neighbour. 1.6 px/mm (the research's first proposal) would put Juno and Jupiter at 24.5 px; anything above 2 only makes the big keyboards bigger. The CS-80 is the largest module (≈ 2432 px wide), the TB-303 the smallest (≈ 608 px); the canvas zoom handles the rest ("bigger hardware = bigger module").
- **Hit areas:** every live control's hit box is at least `HIT_MIN_MM = 14` mm (28 px) in both directions; by default the renderer grows a control's own box to `HIT_DEF_MM = 15` mm around its centre; `hit: [w, h]` overrides it. Live hit boxes never overlap each other (tested, §9.1). Hit areas are fixed world px: they never use `--ik` (no style recalculation at a zoom end).

### 3.2 What is drawn (the cropping rules)

- **R1.** Draw every hardware surface that carries one of our live controls (the main face and any **aux plate**), with everything between its controls, at true scale.
- **R2.** Bands without controls (vent and lid bands, name strips, badge strips, the rear band) are cropped to at most `BAND_MAX_MM = 24` mm each, or removed. A cropped band may carry the model name in plain type. Exceptions: the DX7 graphics panel stays whole (it carries the live algorithm chart); the Solina lid keeps only a ≤ 16 mm front edge.
- **R3.** The keyboard and the wheels/levers are never drawn. A plate beside the keys that carries a live control (Minimoog left-hand controller: DECAY; CS-80 left cheek panel: PORTAMENTO; Juno-60 bender panel: OCTAVE TRANSPOSE; Jupiter-8 PERFORMANCE panel: PORTAMENTO; Solina panel right of the keys: ENSEMBLE; Moog 951 keyboard plate: PORTAMENTO) is an **aux area**: drawn directly below the main face at its real x, the keybed gap collapsed to an `SEAM_MM = 8` mm seam of case colour, trimmed to the rows that hold live controls (its other controls inert or omitted).
- **R4.** The **extras strip** (our controls with no hardware counterpart, §3.7) is either a full-width band below everything (default), or placed with `extras.at` in an empty band of the module (a badge strip, a rail, the space right of an aux plate). It always looks like ours, never like the hardware: the app's dark UI surface, a 1 px top rule, the caption `EXTRAS · not on the original`, our standard widgets with their labels.
- **R5.** Module size (world px, the 40 px top bar included): `W = ceil32(contentW · 2)`, `H = ceil32(40 + contentH · 2 + extrasH)`, where content is the union of the areas (§3.3) and `extrasH` is 0 when `extras.at` is set. The content is centred horizontally in `W`; the vertical slack lies below it. Slack is filled with `case` colour. Never scaled, never stretched. With Snap on (the default) the module's top-left lands on a dot, so all four edges do.

### 3.3 The layout object

```js
// panels/minimoog.js (excerpt; values illustrative, take them from the research JSON)
export default {
  v: 1,                                   // format version
  id: 'minimoog',                         // = models.js id
  hw: 'Minimoog Model D (1970–81 panel)', // what this face reproduces (doc only)
  case: '#3a2416',                        // module background around the content (slack, seams)
  scheme: {                               // → CSS custom properties --hw-<key> on the panel root (§3.6)
    panel: '#141414', legend: '#f2efe6', rule: '#f2efe6', accent: '#e8321a', font: 'sans',
    knob: { skirt: '#111', cap: '#b9b9b6', ptr: '#fff', ptrStyle: 'line', knurl: false, capR: 0.56 },
    rocker: { blue: '#4585b5', orange: '#e8321a' },
  },
  areas: [                                // [0] is 'main'; src: rectangle in the research frame; at: its top-left in content mm
    { id: 'main', src: [0, 0, 689, 176.2], at: [0, 0] },
    { id: 'lefthand', src: [0, 0, 98.7, 40], at: [0, 184.2], fill: '#101010', frame: 'wood' },
  ],
  sections: [                             // the hardware's own sections, left → right, top → bottom
    { id: 'controllers', label: 'CONTROLLERS', x: 0, y: 0, w: 98.7, h: 176.2, frame: 'rule', title: 'bottom' },
    { id: 'oscbank', label: 'OSCILLATOR BANK', x: 98.7, y: 0, w: 149.8, h: 176.2, frame: 'rule', title: 'bottom' },
    // …
  ],
  controls: [
    { id: 'tune', kind: 'knob', x: 51.6, y: 60.5, d: 27, sweep: 300, label: 'TUNE', scale: { n: 11, labels: ['-2', '', '', '', '', '0', '', '', '', '', '+2'] } },
    { id: 'r1', kind: 'rotary', x: 137.1, y: 37.5, d: 27, sweep: 150, legends: ['LO', "32'", "16'", "8'", "4'", "2'"], label: 'RANGE' },
    { id: 'w1', kind: 'rotary', x: 226.2, y: 37.2, d: 27, sweep: 150, legends: ['wave:tri', 'wave:trisaw', 'wave:saw', 'wave:sq', 'wave:rect', 'wave:narrow'] },
    { id: 'om', kind: 'switch', style: 'rocker', orient: 'h', x: 99, y: 62, w: 24, h: 11, color: 'orange', label: 'OSCILLATOR MODULATION' },
    { id: 'dk', kind: 'switch', style: 'rocker', a: 'lefthand', x: 60, y: 30, w: 20, h: 9, color: '#e9e1c8', label: 'DECAY' },
    { kind: 'switch', style: 'rocker', a: 'lefthand', x: 60, y: 14, w: 20, h: 9, inert: true, label: 'GLIDE' },
    { kind: 'jack', x: 640, y: 120, d: 9, inert: true, label: 'PHONES' },
    // …
  ],
  decor: [
    { t: 'text', x: 49.9, y: 156.3, s: 'CONTROLLERS', size: 5.2, weight: 700, anchor: 'middle' },
    { t: 'line', x1: 423.4, y1: 99.8, x2: 572.1, y2: 99.8 },
    { t: 'text', x: 672, y: 166, s: 'Minimoog', size: 4, anchor: 'middle' },     // plain type, no wordmark
  ],
  extras: { ids: [] },                    // none on the Minimoog (§10)
};
```

| Field | Type | Rule |
|---|---|---|
| `v` | `1` | required |
| `id` | string | required; the `models.js` id and the file name |
| `hw` | string | the hardware and revision this face reproduces (doc only, shown nowhere) |
| `case` | colour | module background behind the content and in the slack; default `scheme.panel` |
| `scheme` | object | §3.6 |
| `areas` | `Area[]` | ≥ 1; `areas[0].id === 'main'`. `{ id, src: [x, y, w, h], at: [x, y], fill?, frame?: 'none'\|'wood'\|'metal'\|'line', r? }`. A control or decor item belongs to area `a` (default `'main'`), is given in that area's research frame, and lands at `(x − src.x + at.x, y − src.y + at.y)` in content mm. Items must lie inside their area's `src` (a control's box entirely, a decor item's bounding box) |
| `sections` | `Section[]` | the hardware sections in research order: `{ id, label, x, y, w, h, a?, frame: 'box'\|'outline'\|'header'\|'rule'\|'none', title: 'top'\|'bottom'\|'break'\|'header'\|'none', fill?, headerFill? }`. Drawn by the renderer (`'outline'` = rounded white outline with the title breaking its top line, Prophet-5; `'header'` = a coloured header band, Jupiter-8 / Juno-60; `'rule'` = vertical rules only, Minimoog). Every live control lies inside one section (tested) |
| `controls` | `Control[]` | §3.4 |
| `decor` | `Decor[]` | §3.5 |
| `extras` | `{ ids: string[], at?: [x, y, w, h], caption? }` | §3.7; `at` in content mm, overlapping no area (a badge strip or rail that hosts the extras is left out of the areas: it is drawn as `case`) |
| `notes` | string[] | free notes for reviewers (decisions taken, deviations from the research) |

**Validation (`cv-panel.validate(L, model) → string[]`, empty = valid; the renderer refuses a layout with problems and the model falls back to Resizable):** the shapes above; finite numbers; mm inside their area; every `models.js` id of the model appears **exactly once** as a live control (`id` set, not `inert`) or in `extras.ids`; no other ids except the special tokens of §3.4.3; each kind is allowed for the control's `models.js` type (§3.4.1); `map`/`at` values are valid values of that control; live hit boxes ≥ 14 mm and pairwise disjoint; content ≤ 2000 × 1000 mm; no maker name (whole words, case-sensitive: `Moog`, `ARP`, `Eminent`, `Yamaha`, `Sequential`, `Korg`, `Roland`, `Oberheim`; "ARPEGGIO" and "Minimoog" pass) in any `label`, `legends`, `decor` text or `caption`; `decor` path data matches `/^[MmLlHhVvCcSsQqTtAaZz0-9 .,eE+-]*$/`; at most 3000 decor items.

### 3.4 Controls

Every entry: `{ id?, kind, x, y, a?, label?, lab?, labSize?, hit?, inert?, tip?, note? }` plus its kind's fields. `label` is the **printed** legend (drawn by the renderer at `lab`: `'n'` above (default), `'s'`, `'e'`, `'w'` or `'none'`; size `labSize` mm, default 2.6); the widget's `aria-label` always stays the `models.js` label. `inert: true` = not emulated: drawn in the decor SVG only (§5.5); an inert entry has no `id` (or an `id` only in its `tip` text).

#### 3.4.1 Kinds

| `kind` | Hardware | Our types | Fields | Widget (§5.4) |
|---|---|---|---|---|
| `knob` | rotary pot | `k` | `d` (skirt Ø mm), `sweep` (deg, default 270; the widget turns exactly as the printed dial), `scale` (printed dial, §3.5), `skin` (overrides `scheme.knob`) | `main.js` `knob(c')` — class `knob`, identical behaviour to today |
| `slider` | slide pot | `k`; `s` with detents | `len` (travel mm), `cap: [w, h]` mm, `orient: 'v'\|'h'`, `invert` (minimum at top / right: CS-80 front strip), `scale`, `legends` (an `s` control's detent names; the cap snaps to them) and `map` (§3.4.2; e.g. the ARP 2600 NOISE colour slider's WHITE / PINK / LOW FREQ marks with `map: [0, 1, null]`) | `main.js` `slider(c', si)` for `k`; `hwSlider` (renderer, class `slider hw-det`) for `s` |
| `rotary` | rotary switch / selector | `s`; `k` with `map` | `d`, `sweep` (spread of the detents, default 270), `legends` (one per hardware position; text or a glyph token, §3.5), `map` (§3.4.2) | `hwRotary` (renderer, class `knob hw-rot`: the knob skins apply; never class `knob` alone) |
| `switch` | rocker, bat toggle, slide switch, lever | `b`; `s` (2–4 positions); `k` with `map`; `k` with `level` | `style: 'rocker'\|'bat'\|'slide'\|'lever'\|'paddle'`, `orient: 'v'\|'h'`, `w, h` (mm), `positions` (default 2), `map`, `legends`, `color`, `level: true` (CS-80 Saw / Square rockers: tap toggles 0 ↔ last non-zero (default max), a drag along `orient` sets the level, a fill shows it) | `hwSwitch` (renderer, `<button class="hw-sw">`) |
| `button` | latching push button | `b`; `s`/`k` with `cycle` | `w, h`, `led: 'cap'\|'above'\|'below'\|'none'`, `color`, `onCap` (text on the cap), `cycle` (values a tap steps through, default `[0, 1]`), `ledLevels` (`'off'\|'dim'\|'on'` per cycle entry: OB-Xa TRACK, Prophet-5 KEYBOARD) | `hwButton` (renderer, `<button class="hw-btn">`, `aria-pressed`) |
| `buttons` | a group of buttons, one lit | `s`; `k` with values | `at: [{ v, x, y, label?, onCap?, color? }]` (positions in the area frame; `v` = the value that button sets), `w, h`, `led`, `color`, `combo: { [value]: [v1, v2] }` (a value shown as two lit buttons: Juno-60 CHORUS I+II = 3; pressing the lit one of two releases it to the other) | `hwButtons` (renderer: one `<button>` per entry, `role="radio"` in a `role="radiogroup"` wrapper) |
| `jacks` | output jacks used as a selector (ARP 2600 VCO waveform outputs, Moog 903A WHITE / PINK) | `s` | `at: [{ v, x, y, label }]`, `d` | `hwButtons` with `style: 'jack'`: the selected jack shows a short cord stub and a lit ring; a tap on another jack moves it |
| `led` | indicator lamp | — (display) | `of` (a `models.js` id), `when: ['ne', 0]\|['eq', v]\|['ge', v]\|['in', [..]]`, `d`, `color` | a `<span class="hw-led">` updated through `api.watch(of)` |
| `display` | numeric display | — | `show: 'preset'` (the track's factory-preset number, `--` for Custom / a saved sound), `w, h`, `digits`, `color` | `<span class="hw-dsp">` (read-only, `aria-live="off"`) |
| `jack`, `lamp`, `screw`, `fuse`, `strig`, `slot` | patch points and hardware details | — | `d` or `w, h` | inert only (decor) |
| special tokens | §3.4.3 | — | — | §6 |

A `k` control may only be `knob`, `slider`, `switch` (`map` or `level`), `rotary` (`map`) or `button` (`cycle`); an `s` control `rotary`, `slider` (`legends`), `switch`, `buttons`, `jacks` or `button` (`cycle`); a `b` control `switch` or `button`.

#### 3.4.2 Value maps

- `map: (value | null)[]`, one entry per hardware position: the value that position writes; `null` = a position the hardware has and we don't emulate (drawn, skipped by taps, drags, keys and the wheel). Default: identity over the options (`s`: option index; `b`: `[0, 1]`). The control shows the position whose value is nearest the stored value (a `k` control's preset value between detents shows the nearest detent and is only rewritten when the user moves the control).
- Examples: Moog 921 AUX OUT WAVEFORM (6 detents, our 4 options) `map: [0, 1, 2, null, 3, null]`; Jupiter-8 VCA LFO MOD (`vlf`, a `k` control on a 4-position switch) `map: [0, 3.33, 6.67, 10]`; Jupiter-8 PWM source toggle (`pws`, LFO / MANUAL / ENV-1) `map: [<LFO value>, null, <ENV-1 value>]`; Jupiter-8 VCO-1 RANGE (hardware 16′–2′, ours 64′–2′) = two extra counter-clockwise detents with our legends; MS-20 VCO 2 SCALE = the hardware knob with our values in its legends (the panel must say what you hear).
- Hardware legends that disagree with our range (Minimoog CUTOFF printed −5…+5 against our 0…10; CS-80 PW) are printed as the hardware prints them, as long as the scale is linear in the widget's travel; otherwise print ours.

#### 3.4.3 Special tokens (only for their model)

| Model | Tokens (as `id`) | Bound to |
|---|---|---|
| tb303 | `seq:tempo` (knob), `seq:run` (button, keeps the id `#seqrun`), `seq:runLed` (led), `seq:clear` (button), `seq:key` (13 entries with `note: 0…12`, kind `button`, `hit` = the printed key cell), `seq:pitch`, `seq:time`, `seq:down`, `seq:up`, `seq:accent`, `seq:slide`, `seq:back`, `seq:next` (buttons); in `extras.ids`: `seq:sync`, `seq:swing`, `seq:random`, `seq:demo`, `seq:toRoll`, `seq:grid` | the track's 303 pattern (`tr.seq`, `seqRun`) through `api.seq` (§6.2) |
| dx7 | `dx:data` (slider, DATA ENTRY), `dx:no`, `dx:yes`, `dx:btn` (32 entries with `n: 1…32`), `dx:opsel`, `dx:edit`, `dx:function`, `dx:memInt` (buttons), `dx:led` (2-digit display), `dx:lcd` (`w, h`), `dx:chart` (`x, y, w, h` of the algorithm chart). VOLUME is the ordinary `vol` slider | the selection state of §6.3 and `api.dx` |

Special tokens are not `models.js` ids; each may appear only once (except `seq:key`, `dx:btn`). For the DX7, the ids that the live `dx:btn` buttons address (§6.3: `alg fb ls tr pmd` and the 84 operator ids) count as placed for the "exactly once" rule; `vol` is an ordinary control and `dac` the extra.

### 3.5 Decor (static art, drawn in one SVG under the controls)

All in the area's research frame (mm); `a` picks the area (default `'main'`); colours default to `scheme.legend` / `scheme.rule`; stroke widths in mm (default 0.3).

| `t` | Fields | Use |
|---|---|---|
| `rect` | `x, y, w, h, fill?, stroke?, sw?, r?` | boxes, header bars, wood cheeks (`fill: 'wood'` = the shared walnut gradient) |
| `line` | `x1, y1, x2, y2, stroke?, sw?, dash?` | rules, signal-flow lines |
| `path` | `d, fill?, stroke?, sw?` | arrows, brackets, the MS-20 patch diagram (path data in mm) |
| `text` | `x, y, s, size?, weight?, anchor?: 'start'\|'middle'\|'end', fill?, font?, rot?, ls?, caps?` | legends, section names, the plain-type model name (`size` = font size in mm) |
| `glyph` | `g, x, y, size` | waveform and arrow pictograms from the renderer's set: `wave:sine`, `wave:tri`, `wave:saw`, `wave:rsaw`, `wave:trisaw`, `wave:sq`, `wave:rect`, `wave:narrow`, `wave:pulse`, `wave:noise`, `arrow:up`, `arrow:down`, `arrow:right` (ENGINE may add tokens on request) |
| `scale` | `x, y, d, sweep, n, labels?, side?` | a printed dial (11 ticks by default) around a knob or rotary at its centre; for a slider: `{ t: 'ladder', x, y, len, n, side: 'l'\|'r'\|'both', labels? }` |
| `grille` | `x, y, w, h, hole, pitch` | ARP 2600 speaker grilles |
| `stripes` | `x, y, w, h, pitch, sw, stroke` | OB-Xa blue pinstripes |
| `louvres` | `x, y, w, h, pitch` | Jupiter-8 / Juno-60 vents (cropped band) |
| `screws` | `pts: [[x, y], …], d` | Moog cabinet screws |

A control's `scale` field is shorthand for a `scale` decor item at its centre with its `sweep`.

### 3.6 Scheme and skins (the per-theme styling hooks)

`scheme` becomes CSS custom properties on the panel root (`--hw-panel`, `--hw-legend`, `--hw-rule`, `--hw-accent`, `--hw-case`, and per skin `--hw-knob-skirt`, `--hw-knob-cap`, `--hw-knob-ptr`, `--hw-sl-cap`, `--hw-sl-line`, `--hw-btn-cap`, `--hw-led`, …) and a few attributes (`data-ptr`, `data-knurl`) that the cv-panel CSS section reads. AUTHORS choose from this vocabulary; they never write CSS. A look the vocabulary can't express is a request to ENGINE through the lead.

| Key | Fields | Notes |
|---|---|---|
| `panel`, `legend`, `rule`, `accent`, `wood` | colours | `wood` tints the shared walnut gradient |
| `font` | `'sans'` (Helvetica / Arial), `'condensed'` (Arial Narrow fallback), `'rounded'` (system rounded sans) | system fonts only |
| `knob` | `skirt, cap, ptr, ptrStyle: 'line'\|'triangle'\|'notch'\|'dot'\|'fin'\|'bar', knurl, capR` (cap radius / skirt radius) | the renderer adds the `fin` / `bar` / `triangle` pointer shapes inside the knob's `.rot` group; the knob's own tick ring is hidden (the dial is printed decor) |
| `slider` | `cap, line, groove, capShape: 'flat'\|'ridged'` | cap size per control (`cap: [w, h]`) |
| `button` | `cap, led, ledOff, text` | per control `color` overrides `cap` |
| `rocker`, `switch` | named colours (`blue`, `orange`, …) used by a control's `color` | |
| `jack` | `nut, hole` | |

### 3.7 Extras

- `extras.ids` = our controls with no hardware counterpart, exactly the list of §10 for that model. Each is drawn as our standard widget with its `models.js` label: `k` as a knob, `s` as a selector, `b` as a toggle (`main.js` `knob` / `selector` / `toggle` inside the usual `.ctl` wrapper, theme classes of the model), so the extras look like today's panel, not like the hardware.
- Layout is deterministic, no measuring: cells in `extras.ids` order, widths `XCELL.k = 72`, `XCELL.b = 72`, `XCELL.s = max(72, 16 + 52 · opts)` px, a selector wider when its option names are long (`selCellW`: 16 + Σ(26 + 5.8 · chars) + 3 px gaps, from the names, never measured) (ENGINE may tune the constants once, before AUTHORS pin sizes), one row of `XROW = 64` px under a `XCAP = 16` px caption, wrapping to more rows only at the default full width; TB-303's `seq:grid` is a fixed `SEQ_GRID = 16 × 36` by `192` px block.
- With `extras.at`, the cells must fit the rectangle (validated).

---

## 4. `cv-panel.js` (ENGINE)

### 4.1 Constants

`PX_PER_MM = 2`, `HIT_MIN_MM = 14`, `HIT_DEF_MM = 15`, `SEAM_MM = 8`, `BAND_MAX_MM = 24`, `XROW = 64`, `XCAP = 16`, `XCELL`, `SEQ_GRID`, `KINDS` (the table of §3.4.1), `GLYPHS`, `FORMAT = 1`. It imports `DOT` from `cv-world.js` and `BAR_H` from `cv-module.js` (both node-safe) and `layoutOf`, `HW_IDS` from `./panels/index.js?v=9`.

### 4.2 Pure functions (node-tested; cached per layout object)

| Function | Contract |
|---|---|
| `layoutOf(id)`, `HW_IDS` | re-exported from `panels/index.js` |
| `validate(L, model) → string[]` | §3.3; empty = valid. Problems name the field (`controls[12] (fc): hit box 12 × 30 mm < 14 mm`) |
| `usable(id, model) → layout \| null` | `layoutOf(id)` when it validates (once per session; a problem is `console.warn`-ed once), else null |
| `geometry(L, model) → Geo` | `{ W, H, body: {w, h}, content: {x, y, w, h}, areas: [{id, x, y, w, h}], sections: [...], controls: [{ i, id, kind, live, box, hit, … }], extras: {x, y, w, h, cells: [{id, x, y, w, h}]} \| null }`, all in **module-body px** (origin = the body's top-left, under the bar). Pure maths from the layout and `PX_PER_MM` |
| `sizeOf(L, model) → {w, h}` | the module's outer size: `{ w: W, h: H }` (H includes `BAR_H`); both multiples of `DOT` |
| `hitBoxes(L, model) → [{id, x, y, w, h}]` | live hit boxes in body px (tests, the checker) |
| `decorSvg(L, model) → string` | the static SVG markup (viewBox in content mm, `width`/`height` in px): area fills and frames, section frames and titles, rules, printed labels and scales, decor items, inert controls (each `<g class="hw-inert"><title>LABEL — not emulated</title>…</g>`), `aria-hidden="true"`. No `<image>`, `href`, `xlink`, `<foreignObject>`, `<script>`, no `url(` except the shared gradient ids it defines itself; text is escaped |

### 4.3 `render(root, L, model, api) → { w, h, destroy() }`

Fills `root` (`#inst`) with the hardware panel and registers every control in `main.js`'s `ui` map through `api`. Synchronous; builds each widget once; keeps references (no `querySelector` of its own nodes); survives main-sim. DOM:

```
#inst.inst.hw.knob-<theme.knob>[data-hw="<id>"]       style: width W px; height (H − 40) px; --hw-* vars; background --hw-case
  div.hw-decor  (absolute, inset 0; innerHTML = decorSvg(L) — cached string)
  div.hw-ctls   (absolute, inset 0; pointer-events only on its children)
    div.hw-c[data-ctl="<id>"][data-kind="<kind>"]  style: left/top/width/height px, --hit-w/--hit-h px   (one per live control)
      the widget (§5.4)
    span.hw-led / span.hw-dsp / div.hw-lcd …        (live displays)
  div.hw-extras (absolute at geo.extras)  > span.hw-xcap "EXTRAS · not on the original" + div.ctl[data-ctl] cells
  (TB-303) div.hw-seqgrid inside .hw-extras = seqParts().steps (today's .steps / .step / .sled / .snote / .sbtn, unchanged classes)
```

- Order of live controls in the DOM = sections in layout order, then top-to-bottom, left-to-right inside each: the Tab order reads like the panel.
- `#inst` keeps `aria-label="Instrument panel"`; `.hw-ctls` gets `role="group"` and `aria-label="<model name> front panel"`.
- `render` clears `root` first; `destroy()` removes listeners it added outside its own nodes (none expected).

### 4.4 The `api` object (built by `main.js` `hwApi()`)

```js
{
  doc, model,                         // models.js model of the track
  get: id => vals[id], set: (id, v) => setVal(id, v),
  watch: (id, fn) => …,               // chains fn onto ui[id] (setVal, refreshAll, presets, undo all call it); today's widgets
                                      // ui.set their own updater, so build a control's widget before adding watchers of its id
  bind: c => Binding,                 // bindingOf(c): §5.4
  knob: c => el, slider: (c, si) => el, selector: c => el, toggle: c => el,   // today's widgets (c may be a shallow copy with sweep / orient / invert)
  dragB: (el, b, o) => void,          // the generalised drag (§5.4)
  tap: (el, fn) => void,              // pressOrTap: a mouse acts at the press, a finger on its tap's release (≤ 10 px)
  noMenu, hoverable, wheelIn, wheelStep, track,
  tip: (el, text) => void, untip: ms => void,   // #tip with free text (showTip / hideTip)
  fmt: (c, v) => string,
  seq: null | SeqApi,                 // tb303 (§6.2)
  dx: null | DxApi,                   // dx7 (§6.3)
}
```

### 4.5 Run-time fallback

`render` is only called with a layout that `usable()` returned. A null or invalid layout means the model's ⋯ menu shows the item disabled as "Hardware layout (not drawn yet)" (§7.2), and `instUi()` answers `'flow'`.

### 4.6 `tools/panel-check.mjs` (ENGINE; for AUTHORS)

`node tools/panel-check.mjs <model> [out-dir]` prints `validate()` problems, the module size, the live / inert / extras counts, the smallest hit box and any overlap, and the per-section control list; with `out-dir` (use the scratchpad) it writes `<model>.svg`: the decor SVG with every live control drawn as an outline of its kind and its hit box dashed, for a quick visual check against the research photos without starting the app.

---

## 5. Rendering rules (ENGINE)

### 5.1 Placement

`box` = the control's own size at `PX_PER_MM`, centred on its mapped centre (knob: `d · 1.28` square, because today's knob SVG's skirt is 50 of its 64 viewBox units, so the drawn skirt is exactly `d`; slider: `cap.w` × (`len` + `cap.h`) along `orient`; others `w × h`). Positions are rounded to 0.5 px. The wrapper `.hw-c` is the box; the hit area is a `::before` on the **widget element itself** (so a press on it is a press on the widget), sized from `--hit-w` / `--hit-h`. Never `min-height` / `min-width` for touch (same geometry on every device, IMPL-1b §5.3.11).

### 5.2 Printed labels and dials

Labels, dial scales, legends and section titles are SVG text in `.hw-decor`, so the live layer holds only widgets. A rotary's legends sit on its detent angles; a knob's dial uses its `sweep` so the pointer lines up with the printed numbers.

### 5.3 Theme and look

The `.inst.hw` root drops today's `.inst` padding, nameplate, preset plate and `.wood` side cheeks (`.cv-body > .inst.wood` margins must not apply). The cv-panel CSS section styles `.hw-*` from the `--hw-*` variables and scopes the widget restyling under `.inst.hw` (knob skirt/cap/pointer, slider cap size from `--cap-w/--cap-h`, hidden tick rings and `.sticks`). No rule in that section uses `--ik`.

### 5.4 Widgets

- **`Binding`** `{ id?, label, get(), set(v), min, max, step?, def, fmt(v), sweep?, axis: 'x'|'y', invert?, snap() → token, restore(token) }`. `bindingOf(c)` (main.js) for a `models.js` control: `get = vals[c.id]`, `set = setVal(c.id, ·)`, `snap` = `{ tr, v0, pre0 }` and `restore` = what today's two-finger abort does (value and preset name back). `dragB(el, b, o)` is today's `drag` (relative vertical — or `axis` — travel accumulated per move, Shift = fine, tip with `b.fmt`, double-click = `b.def`, wheel through `wheelIn`/`wheelStep` with the canvas wheel veto, arrow / Page / Home / End keys, two-finger `pointercancel` → `restore`). `drag(el, c)` becomes `dragB(el, bindingOf(c))` with **no behaviour change** (main.test G2 is the guard).
- **Continuous `k` controls** use today's widgets: `knob(c')` and `slider(c', si)`, where `c' = Object.assign({}, c, { sweep, orient, invert })`. They keep the exact classes `knob` / `slider` (tests look for `className === 'knob'`). `knob` reads `c.sweep` (default 270); `slider` reads `c.orient` (`'h'` positions the cap with `left`) and `c.invert`, and sizes its cap from `--cap-h` instead of the literal 14 px.
- **Renderer widgets** (`hwRotary`, `hwSlider` for detented `s`, `hwSwitch`, `hwButton`, `hwButtons`, jacks, level rocker, the seq and DX7 widgets) are built in `cv-panel.js` on `api.bind` / `dragB` / `tap` / `watch`, and register through `api.watch` (so `refreshAll`, presets and undo redraw them). Their classes never equal `knob` or `slider` alone. Behaviour: a tap (`api.tap`) steps to the next valid position (wrapping) or toggles; a drag along the control's axis moves through the positions (`dragB` over position indices, writing `map[pos]`); arrows / Home / End step; double-click = default; the two-finger rollback restores value and preset name; `role` and `aria-*` as a slider (rotary, multi-position switch) or `aria-pressed` (button, two-position switch), `aria-valuetext` = the legend.
- **Live displays** (`led`, `display`, the 303 LEDs, the DX7 LCD and LED) are DOM nodes updated by `api.watch`; nothing animates on a timer (an LED that blinks at a rate is out of scope here; a CSS animation, if ever added, pauses under `[data-cv-off]`, §8.4).

### 5.5 Inert decoration

Inert controls are drawn in the decor SVG with the model's skin (a knob at `p` 0…1 of its sweep, default 0.5; a slider cap at `p`; a button cap, `lit` = its LED on, for fixed routing like the OB-Xa's; a jack with its nut), at `opacity: 0.55`, each with `<title>LABEL — not emulated</title>`. A tap on one (no movement: the world's pan from a background ends without moving, so the `click` reaches it) shows `#tip` "LABEL — not emulated" for 1.2 s. The extras caption row ends with "Dimmed controls are not emulated" on every model with inert items.

### 5.6 Backgrounds, gestures, focus

- `cvModule.BG_SEL` gains `.inst.hw, .hw-decor, .hw-decor *, .hw-ctls, .hw-extras, .hw-xcap`: a press on the panel's art pans the camera (one finger / mouse), as on today's panel backgrounds. `.hw-c` and widgets are never backgrounds.
- The hardware panel has no `own` gesture zones; a two-finger pinch over it moves the camera; a knob drag is rolled back when a second finger lands (gesture.js, unchanged).
- Focus reveal (`world.reveal` on `focusin`) and the tooltip (`showTip` reads `getBoundingClientRect`, screen px) work unchanged under the transform.

### 5.7 Performance

A hardware panel is ≤ 1 SVG (decor, cached markup per model) plus ≈ 15 DOM nodes per live control: Minimoog ≈ 600, DX7 ≈ 700, ARP 2600 ≈ 600 elements. `render` ≤ 30 ms on the Mac preview and ≤ 60 ms on the iPad bench for the largest (CS-80). Nothing in it measures layout.

---

## 6. Special areas

### 6.1 `renderPanel()` (main.js)

```
renderPanel():
  ui.clear()
  Serum → renderCustom (unchanged)
  set the theme variables on #inst (both layouts: the extras strip and the flow panel use them)
  instUi(trk()) === 'hw' → cvPanel.render($('#inst'), L, model, hwApi()); syncPresetSel = () => cvChipSync()
  else                   → today's flowing panel, unchanged (nameplate, presetUI, sections, seqUI for the 303)
  #about-title / #about / drawAlgo() / cvPanelDone() as today
```

`instUi(t)`: `'flow'` for Serum, for a model without a usable layout, or when `t.lay?.i1?.ui === 'flow'`; else `'hw'`.

### 6.2 TB-303 (`api.seq`; layout tokens `seq:*`)

`seqUI(tr)` is split into `seqParts(tr) → { run, sync, tempo, swing, rnd, demo, clear, toRoll, hint, steps, redraw(), q, send(), toggle(on), running(), cursor }` and `seqUI(tr)` composes them exactly as today for the Resizable layout (same DOM, ids and classes). The hardware layout uses:

- **Face:** knobs `tu cf rs em dc ac vol` (models.js); `wf` as a 2-way slide switch under the "▲ WAVEFORM" legend at the top edge (the real switch is on the rear, behind that legend); `seq:tempo` = TEMPO knob over `q.bpm` (40–220, step 1, default 128; `aria-label="Tempo"`, `role="slider"`, two-finger rollback); `seq:run` = RUN/STOP (`id="seqrun"` moves here so `seqToggle` keeps updating it) with `seq:runLed`; `seq:clear` = PATTERN CLEAR (today's Clear).
- **Key area** (UI only, no pattern-format change): a step **cursor** (0–15, per track, session state) and a mode (`pitch` default / `time`, session state). PITCH MODE: the 13 keys set the cursor step's note `n` and make it a note (`g = 1`); DOWN / UP set the octave `o` (−1 / +1, pressing the lit one again returns to 0); ACCENT / SLIDE toggle `a` / `s`. TIME MODE: DOWN = note (`g = 1`), ACCENT = rest (`g = 0`); UP (tie) is inert. BACK / WRITE-NEXT move the cursor (wrapping). The key LEDs, DOWN / UP and ACCENT / SLIDE LEDs mirror the cursor step; PITCH / TIME LEDs the mode. Every edit → `send()` and `redraw()` (the grid follows).
- **Extras:** `al` (Accent Latch) and `seq:sync`, `seq:swing`, `seq:random`, `seq:demo`, `seq:toRoll` as today's buttons and number box, and `seq:grid` = today's 16-step grid (`.steps`, classes unchanged) which also shows the cursor (`.cur` on the step column; a tap on a column's number or background moves the cursor) and the running step (`.now`).
- Inert: TRACK / PATT.GROUP and MODE selectors, FUNCTION, PATTERN 1–8 and A / B, the rear-connector legends (print only).

### 6.3 DX7 (`api.dx`; tokens `dx:*`)

The real DX7 has two continuous controls; everything else is chosen with a button and set with DATA ENTRY or NO / YES. The hardware layout reproduces that.

- **State** (per track, session only, never in the project): `op` 1–6 (default 1), `param` (default ALGORITHM), `eg` 1–4 for EG RATE / LEVEL, `mode: 'edit' | 'function' | 'play'` (default `edit`).
- **Buttons 1–32** (`dx:btn` `n`): in edit mode the live ones select a parameter — 7 `alg`, 8 `fb`, 10 `ls`, 18 `r<op>` (FREQUENCY COARSE), 19 `f<op>`, 20 `d<op>`, 21 `R<eg>_<op>` (pressing 21 again steps `eg` 1 → 4), 22 `L<eg>_<op>` (same), 26 `s<op>`, 27 `l<op>`, 28 `v<op>`, 31 `tr`; in function mode only 17 (MODULATION WHEEL RANGE → `pmd`) is live; in play mode (MEMORY SELECT INTERNAL) buttons 1–n load factory preset n (`api.dx.load`), the rest do nothing. Inert (dimmed, "not emulated"): 1–6, 9, 11–17 (edit), 23–25, 29, 30, 32, every other function, STORE, MEMORY PROTECT ×2, MEMORY SELECT CARTRIDGE, the cartridge slot. The selected parameter's button shows a subtle highlight ring (ours; the hardware relies on the LCD). Each live button carries `data-ctl` = the id it currently addresses (rebound on `op` / `eg` / mode change), so 2b's press-and-hold menu can target it.
- **OPERATOR SELECT** cycles `op` 1 → 6. **EDIT/COMPARE** = edit mode, **FUNCTION** = function mode, **MEMORY SELECT INTERNAL** = play mode.
- **DATA ENTRY** (`dx:data`, a slide pot): `dragB` with a **dynamic** binding (`bindingOf` of the selected control; the cap jumps to the selected parameter's value when the selection changes); **NO / YES** step it by −1 / +1 (`step` or 1 % of the range). **VOLUME** = `vol` (an ordinary slider).
- **LED** (`dx:led`): the factory-preset number (1-based), `--` for Custom / a saved sound. **LCD** (`dx:lcd`, 16 × 2, `aria-live="polite"`): edit mode, line 1 `ALG nn` + six `1`s (operators always on), line 2 operator + parameter + value (`OP3 F COARSE= 2.00`, values through `fmt(c, v)`); function mode, the function name and value; play mode, the preset name. Exact strings: as the research JSON lists, refined against the manual if a scan is found.
- **Algorithm chart** (`dx:chart`, on the graphics panel): all 32 algorithms in two rows of 16 drawn small from `DX_ALGS` with `algoLayout`, the current `alg` highlighted (a live display; read-only).
- `ui` registration: every DX7 id gets an updater that refreshes the LCD / LED / chart when it is the addressed one (one `watch` per id). `dac` is the only extra.

### 6.4 ARP 2600 (slide pots, jack-select, patch points)

- Horizontal slide pots (`orient: 'h'`) for INITIAL OSC FREQUENCY / FINE TUNE / PULSE WIDTH and INITIAL FILTER FREQUENCY / FINE TUNE / RESONANCE; vertical for the input attenuators, ADSR, AR, mixer. All 57 slider positions are drawn: 31 live, the rest inert.
- `w1 w2 w3` = `jacks` on each VCO's output jacks (tap the jack you would patch; the selected one shows a cord stub). `nc` = the NOISE GENERATOR colour slider with its printed marks as detents (`legends: ['WHITE', 'PINK', 'LOW FREQ']`, `map: [0, 1, null]`). Every other jack (74) is inert decor with its normal-source box printed. Speaker grilles = `grille` decor.
- Extras: `sy kb lw src gl`.

### 6.5 MS-20 (patch panel)

The patch bay (29 jacks in 4 rows, its signal-flow strip, the ESP's 6 jacks / 2 LEDs / 5 knobs) is inert decor; VOLUME (top right of the bay) is live. Selectors (VCO WAVE FORM, SCALE, MG WAVE FORM) are `rotary` with printed legends (MG WAVE FORM: the hardware's small knob with 3 detents). EG 1, EG 2 HOLD, FM EG1/EXT, HPF MG/T.EXT inert. No extras.

### 6.6 Moog Modular (cabinet)

Option B of the research (a compact cabinet of the genuine modules this voice uses, at true size, in System 55 order): module row 921 · 921 · 921 · 995 · 903A · 904B · 904A · 902 · 911 (→ 904A) · 911 (→ 902); console row CP3A · blanks · CP8A; walnut cheeks and rails (`rect` with `fill: 'wood'`), black module panels with the module title at the top and the model number in plain type at the bottom (no wordmark), `screws`. 911 order top to bottom T1, T2, T3, E SUS. The 951 keyboard plate (PORTAMENTO, `gl`) is an aux area. `nc` = `jacks` on the 903A WHITE / PINK outputs; the 921 AUX OUT WAVEFORM `map: [0, 1, 2, null, 3, null]`. Every unused knob, switch and jack inert; `kb` in extras.

### 6.7 The others in brief

CS-80: two programmable rows (Channel I above II), the front strip (its amount / speed levers `invert: true`: minimum up), `sw1 sw2 sq1 sq2` as level rockers (`switch` with `level`), Channel II copies of our global controls drawn inert ("same as Channel I here"), TONE SELECTOR buttons inert in their colours, ribbon inert, the left cheek panel as an aux area (PORTAMENTO). OB-Xa / Prophet-5: knobs + LED push buttons, 3-state TRACK / KEYBOARD as `button` with `cycle` and `ledLevels`, Prophet LFO shape as `buttons` (SAW = 1, TRI = 0, SQUARE = 2), OB-Xa fixed-routing switches inert with `lit` LEDs, programmers inert, the empty striped right end kept. Jupiter-8 / Juno-60: header-band sections (`frame: 'header'`), slide pots with black caps (one light line; not today's coloured caps), chrome bat toggles, the coloured lower button row (inert except ASSIGN MODE `as`: SOLO 2 / UNISON 1 / POLY-1 0, POLY-2 inert) and the Juno CHORUS `buttons` with `combo: { 3: [1, 2] }`. Solina: one strip, horizontal slide pots, tab buttons, the modulation panel right of the keys as an aux area.

---

## 7. Instrument modules: Hardware / Resizable

### 7.1 Data: `track.lay.i1.ui`

- `lay.i1.ui === 'flow'` → Resizable layout. Absent → Hardware layout (when the model has a usable layout). No other value is stored; Serum and the FX modules ignore it.
- `song.js normLay` keeps `ui` when it is exactly `'flow'` (dropped otherwise). Additive and view-only: **no schema bump** (`CM.SCHEMA` stays 2). An older canvas build drops the key on its next save (the user's Resizable choice reverts to its only layout there) — accepted, like any view pref.
- `lay.i1.w` keeps meaning "the Resizable width" and is ignored by the Hardware layout: the widths users saved in stage 1b become their Resizable widths (the **migration of saved widths** is: nothing to convert). `ui` and `w` survive a model replace (the module keeps its user's choice; a Serum ignores `ui` and keeps using `w` as its own width as today; after a change back `ui` applies again), `duplicateTrack` (copies `lay`), serialize / History (part of the track).

### 7.2 The `⋯` menu (classic instrument)

```
About the <Model>…
Replace with…
—
✓ Hardware layout          (checked when instUi === 'hw'; without a usable layout: disabled, "Hardware layout (not drawn yet)")
  Resizable layout         (checked when 'flow')
—
Save sound…                (today's presetUI Save; prompt + confirm as today)
Delete saved sound          (disabled unless the track's preset is a saved one)
Init sound                  (today's Init)
—
Reset width                 (Resizable only; disabled unless a width was set)
Fold / Unfold
Bring to front
—
Tidy the canvas
```

Items use `wk.contextMenu`'s `checked` (`menuitemcheckbox`). Serum's menu is unchanged (no layout items, no sound items; its own browser saves). The chip gains ◀ ▶ preset steppers for classic models (today's presetUI step, in both layouts; 28 px buttons in the bar).

### 7.3 Switching, sizes and making room

- `cvSetLayout(ui)`: same as the current → nothing. Else `hist.record(project, ui === 'flow' ? 'Resizable layout' : 'Hardware layout')`, write / delete `t.lay.i1.ui` (creating `lay.i1` from the module's current place if absent, pins as `cvLay` does), `persist()`, `renderPanel()` (via `cvPanelDone` → `cvRender`), `updateUndoUI()`. One History step; undo / redo restore `lay` and `applyRestore → renderAll → renderViews` redraws the right layout. Values, presets and sequencer state never change (they live in the track); every control is rebuilt from them.
- **Sizes:** `host.size(kind)` → for the instrument `{ fixed: cvPanel.sizeOf(L, model) }` in Hardware, else `{ range: widthRange(model) }` (Serum 768–1600, classic flow 480–1600). `createModule` takes `fixed: {w, h}`: width and height set once (`el.style.height` = h px), no grip, `rect()` without measuring, no ResizeObserver needed; `setFixed(size | null)` switches at run time (grip shown / hidden, `data-cv-fixed`). `TrackView.sync` applies `host.size` every time (a model change, a toggle, an undo).
- **`makeRoom(rects, key, gap = GAP) → {k: {x, y}} | null`** (pure, `cv-module.js`): the modules whose left edge is at or right of the instrument's left edge and whose vertical span overlaps it form R; if R is empty or `min(R.x) ≥ inst.x + inst.w + DOT`, null; else every module of R moves right by `gup(inst.x + inst.w + gap) − min(R.x)` (their relative layout kept). Never moves left.
- `cvRender` calls it after a build or sync **when the instrument is fixed-size and (the view was just built, or its size changed since the last call)**; a non-null result is written to `t.lay` through `cvLay(k, entry, 'end', 'room')` (no step of its own: inside the step of the toggle or replace that caused it; on a load or track switch it is a view normalisation like a `z` write) and `persist()`. This also migrates stage-1b projects, whose FX and OUT modules sit where a 1080 px panel ended.
- `cvModuleSize(modelId)` (the Sources drop outline): the hardware size of `modelId` when the current track's instrument is in Hardware layout (or has no `lay.i1.ui`), else today's measured / default flow size. `cvTidy` uses `rect()` (fixed sizes need no measuring).

### 7.4 Presets in the Hardware layout

The panel has no preset plate: the chip (select + ◀ ▶) loads, the ⋯ menu saves, deletes and inits. `presetUI`'s handlers become shared functions (`presetStep(d)`, `presetSave()`, `presetDelete()`, `presetInit()`) used by the plate (Resizable), the chip and the menu; `syncPresetSel` keeps working in both layouts (Hardware: `cvChipSync` only).

### 7.5 Serum and FX

Unchanged: always resizable (Serum grip 768–1600, Reset width), no layout items in their menus.

---

## 8. Zoom consistency (Z1)

### 8.1 `cv-world.js`

| Removed | Replaced by |
|---|---|
| `CARD_K`, `lodOf`, `planMount`, `SLICE_MS`, the `view()` calls and their slicing queue, `[data-cv-lod]`, the `lod` getter and event, `viewOf`, the "cards first" of `add()` / `clear()`, `fitCamera`'s "just short of the card level" retry | nothing: every item always shows its body |
| `CARD_K` as the floor of `focusItem`'s width framing and of the default camera | `READ_K = 0.5`: "the smallest zoom a focus or a default camera lands on" (a readability floor; no look changes at it) |
| culling (`'cull'` / `'budget'` cards) | `planScreen(items, cam, vw, vh, margin = CULL_MARGIN) → { on: ids, off: ids }` (pure): which items intersect the viewport grown by `CULL_MARGIN` (256 screen px) |
| the budget cards | `BUDGET_EL` becomes a soft budget: the sum of item `cost`s above it emits `budget` `{ over: true, cost }` once per crossing and a `console.warn`; nothing visible changes (1e refuses new modules past it with a notice; not this stage) |

- **Items** are `{ id, el, rect(), cost?, onScreen?(on), nudge?, setPos?, onMove? }`. The world caches each item's rect on `add`, `update(id)`, `resize` and at every `cameraend`; during a burst it uses the cache only (no `rect()` call, no layout read). After each written frame it runs `planScreen` on the cached rects and calls `onScreen(on)` for the items whose state changed, then emits `screen` `{ on, off }` (changes only). `world.onScreen(id) → boolean`.
- **Never** hides, unmounts, swaps or resizes an item; never sets `content-visibility`.
- **Controls sleep below `READ_K`** (behaviour only, nothing visible): the cards used to stop a one-finger pan of a zoomed-out canvas from turning whatever knob it landed on; without cards, when `cam.k < READ_K` a press on anything inside a module body (not its bar, chip, `⋯`, `▾` or a jack) whose module is not in edit state is taken by the world in the capture phase (`stopImmediatePropagation` + `preventDefault`, as the momentum guard does) and starts a camera pan; its click is swallowed; a tap selects the module, a double-tap focuses it (`focusItem`: 100 % or the width framing, edit state), which wakes its controls. `wheelVeto()` is also true below `READ_K` (no knob takes a wheel there). From `READ_K` up, controls work as today.
- Unchanged: the camera, gestures, hooks, native hand-over, `--ik` and the canvas rescale at a zoom end, edit state (`EDIT_K` and the double-tap pin), the dot grid, snap, the toolbar, ghost, `dragPointer`.

### 8.2 `cv-module.js`

- Removed: `.cv-card` (and `cardArt`, `card`, `o.art`, `o.onView`, `o.cull`, `cull`, `view()`, `data-cv-view`, `data-cv-why`). The body mounts once at creation and stays mounted for the module's life (`unmount` only in `destroy`).
- Added: `onScreen(on)` (the Item hook) → sets / clears `data-cv-off` on the root and calls `o.onScreen(on)` → `host.shown(key)`; getter `screen`; `fixed` / `setFixed` (§7.3); `makeRoom` (§7.3); `BG_SEL` additions (§5.6). `TrackView.live(key)` = on screen and not folded.
- `createTrackView` no longer passes `cull` / `art`; `host.size(kind)` replaces the hard-coded `resizable` (§7.3).

### 8.3 `main.js`

`initModules`: `W.on('screen', () => monitors.sync())` instead of `lod`. `cvLive(key)` = CANVAS shown and `cvView.live(key)` (on screen, not folded). `monitors.wanted` is unchanged (it calls `cvLive`): a Serum or FX module scrolled off screen stops its `smon` and live displays; it resumes `CULL_MARGIN` px before it re-enters, so the user never sees it paused. `cvReveal`: `W.k < cvWorld.READ_K ? 1 : W.k`; `cvCamRestore`: `READ_K` floor. `host.art` goes.

### 8.4 CSS

- cv-module section: remove the `.cv-card`, `.cv-art`, `.cv-cardname`, `[data-cv-view="card"]`, `[data-cv-why="budget"]` rules; `.cv-mod[data-cv-fixed] > .cv-grip { display: none; }`; `.cv-mod[data-cv-off] * { animation-play-state: paused; }` (no visual effect on screen: it only applies off screen).
- Nothing in any module changes with `--ik` except the existing screen-constant chrome (selection ring, edit outline, bar hit extension, jack hit circles, cable strokes), which are rings and invisible hit areas, not module looks.

### 8.5 Performance on iPad

Pan and pinch stay transform-only (`#world` `will-change` only while busy); the per-frame work adds one `planScreen` over ≤ a dozen cached rects (< 0.05 ms). A zoom end re-rasters the visible modules (≤ 50 ms, SPEC §9.3); hardware panels add no `--ik` restyling. The lead's iPad check (§9.5) includes a pan and pinch from 0.25 to 2 over a CS-80, a Serum and the FX module together, at 60 fps.

---

## 9. Tests

### 9.1 New: `tests/cv-panel.test.mjs` (ENGINE)

Pure, no DOM unless stated; loops over `HW_IDS` and skips models whose layout is still null (each skip logged by name, so the lead sees what is missing).

1. Format: `PX_PER_MM === 2`; `validate` on a fixture layout (in the test file) accepts it and reports each broken rule of §3.3 (one mutation per rule).
2. For every authored model: `validate(L, model)` is `[]`; every `models.js` id exactly once (live or extras); `extras.ids` equals the §10 list; sections in the §10 order; every live control inside a section.
3. Size: `sizeOf` = the model's row in the test's size table (filled from the AUTHOR's hand-back; the §10 target ± one dot until then); `w`, `h` multiples of 32; `h` includes `BAR_H`.
4. Touch: every live hit box ≥ 28 × 28 px; no two overlap; all inside the body.
5. Artwork: `decorSvg` contains no `<image`, `href`, `xlink`, `<foreignObject`, `<script`; no maker name of `models.js` as a whole word; the model name appears only as plain `<text>`.
6. Render on `tests/wk-dom.mjs` with a fake `api`: one `.hw-c[data-ctl]` per live control, in section order; `api.watch` registered for every id; a `set` redraws its widget (`aria-valuenow` / `aria-pressed` / `aria-valuetext`); `map` with `null` positions skips them on tap, drag and keys; a `level` rocker toggles 0 ↔ last; `buttons` with `combo` lights two; a two-finger `pointercancel` on a rotary restores value and preset name; no class equals `knob` / `slider` alone on a renderer widget.
7. Determinism: render → serialize (tags, classes, `data-ctl`, inline geometry) twice is identical (the hardware layout "always comes back exactly").
8. TB-303 and DX7 state machines with a fake `api.seq` / `api.dx` (§6.2, §6.3: keys, modes, cursor, EG stepping, OP SELECT, DATA ENTRY rebinding, NO / YES, LCD strings for three cases).

### 9.2 Adapted (ENGINE)

| File | Change |
|---|---|
| `tests/cv-world.test.mjs` | Remove the `lodOf`, `planMount`, cards / slices / budget-card and "fit at CARD_K" tests. Add: `planScreen` maths (margin in screen px at k 0.25 / 1 / 2); items never receive `view()`; `onScreen` toggles once when an item crosses the margin during a pan (computed per written frame from cached rects, with `rect()` not called during the burst) and at `cameraend`; **a zoom sweep 2 → 0.25 → 1 leaves every item's attributes and children unchanged except `data-cv-off`, `data-cv-sel`, `data-cv-edit`** (the Z1 test); `budget` event past `BUDGET_EL`, nothing hidden; `focusItem` floor is `READ_K`; `fit` may go below 0.5 down to `K_MIN`; sleeping controls: at k 0.4 a press on a fake control in a module body pans and the control's own `pointerdown` / `click` never fire, a tap selects the module, after a double-tap (edit state) the control gets the press; at k 0.6 the control gets it; the bar always moves the module |
| `tests/cv-module.test.mjs` | Remove the card / cull test and `cardArt`. Add: fixed module (no grip, `rect()` = fixed size without measuring, `setFixed` toggles the grip, Reset width absent); `onScreen` → `data-cv-off` + `host.shown`; `live()`; `makeRoom` (overlap pushes R right to `GAP`, keeps relative layout, ignores modules left of / above / below, never moves left, null when clear); `BG_SEL` hardware classes; `host.size` drives `sync` across a toggle |
| `tests/canvas-sim.test.mjs` | Menu labels (layout items with `checked`, sound items, Reset width only in Resizable); boot shows the Hardware layout for a model with a layout (instrument `rect()` = `sizeOf`, no grip); toggle → one History step, `lay.i1.ui`, values / preset / 303 pattern kept, grip appears, undo / redo restore both ways, reload and `duplicateTrack` keep it; `makeRoom` moves FX / OUT inside the toggle's step and on load (no extra step, Undo state unchanged); monitors: `onScreen(false)` → `smon` off, back → on (replaces the card case); `cvReveal` `READ_K` |
| `tests/cv-fixes-sim.test.mjs` | Default camera: `CARD_K` → `READ_K`, the 1080 instrument width → the module's actual width |
| `tests/main.test.mjs` | G2 minimoog knob test unchanged (it must pass in the Hardware layout: the first `className === 'knob'` is a continuous pot); the TB-303 G2 test finds Tempo by `role="slider"` + `aria-label="Tempo"` (a knob in Hardware, a number box in Resizable) and `.snote` in the grid, and runs once per layout |
| `tests/pwa.test.mjs`, `tests/lint.test.mjs` | `panels/*.js` (§2.3) |
| `tests/cv-shell-sim.test.mjs` | only if the drop-outline test needs it (it compares with `cv.size`, which stays consistent) |

### 9.3 AUTHORS

`node tools/panel-check.mjs <model> <scratchpad>/canvas/panels/check` until it reports no problems, then `node --max-old-space-size=2048 --test tests/cv-panel.test.mjs`, then the preview (§9.5). The hand-back note gives the module size (`sizeOf`) for the size table, the inert list, any deviation from the research and why.

### 9.4 Gate set (every lane, before hand-back)

`tests/lint.test.mjs`, `tests/pwa.test.mjs` (after `node tools/precache.mjs --write`), the DSP diff of §0.1 (empty), the lane's own files above, and the page simulations its edits can reach (`main`, `keyboard`, `app`, `app-ios`, `roll`, `canvas-sim`, `cv-shell-sim`, `cv-fixes-sim`), one at a time. Goldens are not needed for UI-only edits; the lead runs `golden-classic` once at integration (sound must be bit-identical: no DSP file changed).

### 9.5 Preview and iPad

`.claude/launch.json` "synth" on port 8817 with the built-in browser tools, at 1440×900, 1366×1024 and 1024×1366: each authored model in Hardware layout at k = 1 and 0.5 (no console errors; every live control responds; nothing changes look while zooming 2 → 0.25 except scale), the toggle both ways with undo, a classic → Serum → classic replace, the drop outline, Tidy. Reset viewport emulation afterwards. iPad checklist for the user (lead): pinch from 0.25 to 2 over three modules at 60 fps with no module changing look; operate the tightest controls (Juno-60 sliders, TB-303 keys, DX7 buttons) at 100 %; the toggle.

---

## 10. Per-model acceptance

**Every model:** `validate` clean; every `models.js` id exactly once (live or extras); extras exactly as listed; sections and their order as listed (research order); control types as listed (no type substitution unless the table says so); hit boxes ≥ 28 px, disjoint; size within one dot of the target until pinned; keyboard and wheels not drawn; no maker name or logo; model name only in plain type; inert items dimmed with the "not emulated" title; preview checked.

| Model | Hardware drawn | Sections (order) | Live on the face | Extras | Must look like | Target size (px) |
|---|---|---|---|---|---|---|
| **modular** | Option-B cabinet (854 × 397 mm) + 951 plate (aux) | 921 ×3 · 995 · 903A · 904B · 904A · 902 · 911→904A · 911→902 / CP3A · blanks · CP8A / 951 | 31: `t r pw w` ×3 (921 FREQUENCY, RANGE rotary 6 detents, RECTANGULAR WIDTH, AUX OUT WAVEFORM rotary `map`), `ea` (995 ATT 1), `nc` (903A jacks), `hp`, `fc rg`, `a1 b1 c1 s1`, `a2 b2 c2 s2` (T1, T2, T3, E SUS top to bottom), `l1 l2 l3 nz vol` (CP3A), `gl` (951) | `kb` | walnut cabinet, black module panels, titles top / model numbers bottom in plain type, screws, chrome jacks; ≈ 82 inert jacks and the 902 / CP8A inert | 1728 × 960 |
| **minimoog** | face 689 × 176 mm + left-hand controller back row (aux) | CONTROLLERS · OSCILLATOR BANK · MIXER · MODIFIERS (FILTER over LOUDNESS CONTOUR) · OUTPUT · power | 37 + `dk` on the aux plate: rotary RANGE / WAVEFORM (6 detents, waveform icons), no osc-1 FREQUENCY knob (header only), larger osc-2/3 FREQUENCY knobs, mixer zig-zag with the column of 5 blue rockers, 3 orange rockers straddling MIXER \| MODIFIERS, OSC MOD rocker on the CONTROLLERS rule | — | matte black, white legends, section names large along the bottom, walnut cheeks; MAIN OUTPUT, A-440, phones, power, GLIDE rocker inert | 1408 × 512 |
| **arp2600** | panel 780 × 398 mm | upper: PREAMP / ENV FOLLOWER / RING MOD · VCO-1 · VCO-2 · VCO-3 · VCF · ADSR over AR · VCA · MIXER-PAN-REVERB; lower: KBD CV + MULTIPLE · grille · LEFT SPEAKER · NOISE · VOLTAGE PROCESSORS · S&H + CLOCK · ELECTRONIC SWITCH · RIGHT SPEAKER · grille · POWER | 31: horizontal top-row sliders, vertical attenuators / ADSR / AR, `w1 w2 w3` jack-select, `nc` the detented NOISE colour slider, `vol` = MIXER input 2 | `sy kb lw src gl` | grey face, white legends in outline boxes with signal-flow arrows, all 57 sliders and every jack drawn (29 sliders and 74 jacks inert), black caps with a white line, speaker grilles; no ARP logo | 1568 × 928 |
| **solina** | strip (+ ≤ 16 mm lid edge) + modulation panel right of the keys (aux) | power · name · tuning · bass voices · sliders · upper voices / modulation panel | 10: `cb ce` · `cr su vol` (horizontal slide pots) · `va vn tp hn` · `en` (aux) | `tn` | one long dark strip, wood ends; power, lamp, tuning, VOLUME BASS inert | 1984 × 256 |
| **cs80** | programmable panel (rows I, II) + front strip + left cheek panel (aux), bands cropped | VCO · VCF · VCA · TOUCH RESPONSE (row I, then row II) / PITCH · DETUNE · RING MODULATOR · SUB OSCILLATOR · FEET · TONE SELECTOR · MIX/BRILLIANCE/RESONANCE · TOUCH RESPONSE · KEYBOARD CONTROL · VOLUME / left panel | 44: slide pots with the coloured caps of the research, `sw1 sw2 sq1 sq2` level rockers, front-strip levers inverted, `ft1 ft2` detented sliders, `gl` on the left panel | — | dark panel with gold pinstripe frames, coloured caps, TONE SELECTOR buttons, ribbon, Channel II mirrors inert; walnut cheeks | 2432 × 768 |
| **prophet5** | wood frame + panel (952 × 191 mm) + wood strip for extras | POLY-MOD · LFO · WHEEL-MOD │ OSCILLATOR A · MIXER · FILTER (+ its envelope) · MASTER TUNE/A-440 · CASSETTE / OSCILLATOR B · AMPLIFIER / GLIDE+UNISON · PROGRAMMER · RELEASE/VOLUME/TUNE | 43: one knob size, latching switches with LEDs, `lw` as 3 switches one lit, `fk` cycling with dim LED, silver MASTER TUNE / VOLUME knobs | `li rev ud` (on the wood strip, `extras.at`) | white rounded outlines with titles breaking the top line; programmer, MASTER TUNE, A-440, CASSETTE, RELEASE, TUNE, SOURCE MIX inert | 1920 × 512 |
| **ms20** | face 545 × 185 mm (+ end cheeks optional) | VCO 1 · VCO 2 · VCO MIXER · HPF · LPF · VCA (art) / PORTAMENTO · MASTER TUNE · FM · HPF MOD · LPF MOD · MG · EG 1 / EG 2 column · PATCH PANEL · ESP | 25: selectors as knobs with printed legends, two knob sizes, VOLUME in the patch bay | — | matte black, white rules, patch bay with flow lines (29 + 6 jacks, ESP knobs inert), no wood | 1120 × 416 (1152 with cheeks) |
| **tb303** | the whole top (300 × 146 mm) | top strip (rear legends + 6 knobs) · middle strip (TEMPO, TRACK/PATT.GROUP, MODE, VOLUME) · programming section | 8 models.js (`tu cf rs em dc ac vol`, `wf` slide switch at the top edge) + the seq tokens of §6.2 | `al` + `seq:sync seq:swing seq:random seq:demo seq:toRoll seq:grid` | silver panel, black legends, red pattern numbers, tact buttons with LEDs, key cells as hit areas (black-key cells widened into the empty printed area to 15 mm) | 608 × 608 |
| **obxa** | cheeks + lid band cut to ≤ 24 mm + striped panel + badge strip for extras | MANUAL · CONTROL · MODULATION (LFO / FREQUENCY / PULSE WIDTH) · OSCILLATORS · FILTER · ENVELOPES / KEYBOARD · PROGRAMMER | 29: one knob style, LED switches, `kb` 3-state, `o2d` LED live | `lc ud` (on the badge strip, `extras.at`) | blue pinstripes, black gutters, wood cheeks; fixed-routing switches inert with their LEDs as our engine has them; empty striped right end kept | 2048 × 576 |
| **jupiter8** | plate with the vent band cut to ≤ 24 mm + both control rows + PERFORMANCE plate trimmed to PORTAMENTO (aux) | (no header) VOLUME… · LFO · VCO MODULATOR · VCO-1 · VCO-2 │ SOURCE MIX · HPF · VCF · VCA │ ENV-1 · ENV-2 / lower row: TUNE · ARPEGGIO/ASSIGN/HOLD · KEY/PANEL MODE · display · PATCH NUMBER · PATCH PRESET · TAPE / PERFORMANCE | 36: slide pots with black caps, rotary selectors, chrome bat toggles (`vd`, `pws` with the MANUAL middle `null`, `sl`, `sy`, `lo`), `vlf` 4-position switch `map`, `as` buttons, `gl` on the aux plate | `pw` "PW (MANUAL)" (beside the aux plate, `extras.at`) | red-orange header bars, black plate, coloured lower button row (inert but for ASSIGN MODE), red source tags | 2144 × 608 |
| **juno60** | vent band cut to 24 mm + the sections + bender panel trimmed to OCTAVE TRANSPOSE (aux) | POWER · KEY TRANSPOSE/HOLD · ARPEGGIO · LFO · DCO · HPF · VCF · VCA · ENV · CHORUS · MEMORY / bender panel | 24: slide pots, LED buttons (`pu sw` …), toggles, CHORUS `buttons` with `combo`, `rg` OCTAVE TRANSPOSE on the aux plate | `hs` (beside the aux plate, `extras.at`) | coloured header bands (orange / blue / grey), white rules, walnut cheeks; arpeggio, memory, key transpose, power inert | 2144 × 416 |
| **dx7** | graphics panel + control strip (1018 × 172 mm) | graphics (name, algorithm chart, EG and KLS diagrams) / VOLUME · DATA ENTRY · NO/YES · mode buttons · LED · LCD · buttons 1–32 · cartridge | `vol` + the `dx:*` tokens of §6.3 (the other 89 ids through buttons 7, 8, 10, 17 (function), 18–22, 26–28, 31 and DATA ENTRY) | `dac` | dark brown body, teal / coral / lavender / tan membrane buttons, lavender edit legends above and tan function legends below, chrome trim, live algorithm chart | 2048 × 480 |

---

## 11. Integration order

| Step | Who | Lands | App state after it |
|---|---|---|---|
| 0 | architect (done) | this contract, `panels/index.js`, 12 null stubs | unchanged (panels/ not imported) |
| E1 | ENGINE | `cv-panel.js` pure part (constants, `validate`, `geometry`, `sizeOf`, `hitBoxes`, `decorSvg`), `tools/panel-check.mjs`, precache / pwa / lint for `panels/`, `tests/cv-panel.test.mjs` with the fixture | unchanged UI; AUTHORS can check files |
| Z1 | ENGINE | §8 (cv-world, cv-module cards out, main.js monitors, CSS, tests) | the user's zoom complaint fixed; today's flowing panels everywhere |
| E2 | ENGINE | `render`, widgets, main.js `renderPanel` / `hwApi` / `dragB` / `seqParts` / presets, fixed modules, the toggle, `makeRoom`, `normLay`, CSS section, sim tests | Hardware layout for every authored model; others Resizable |
| A | AUTHORS, in parallel from step 0 | `panels/<model>.js` | each model switches to Hardware as it lands |
| C | lead | integration run (§9.4 files one at a time, `golden-classic`), preview at three sizes, ROADMAP row updated, iPad hand-off | deployable |

AUTHORS start at once from §3 and the research JSON; until E1 lands they self-check against §3.3 by hand. ENGINE never edits a `panels/<model>.js`; AUTHORS never edit code. A vocabulary gap (a kind, a skin key, a glyph) goes to the lead, who asks ENGINE to add it.

---

## 12. Decisions taken in this contract (for the lead)

1. **One scale, `PX_PER_MM = 2`**: the smallest that keeps the tightest real pitch (15.3 mm, Juno-60 / Jupiter-8) at ≥ 28 px; modules are big (CS-80 ≈ 2432 px) and the camera does the rest.
2. **Aux plates beside the keys are drawn** below the face at their real x with an 8 mm seam (Minimoog DECAY, CS-80 / Jupiter-8 / Moog 951 PORTAMENTO, Juno-60 OCTAVE TRANSPOSE, Solina ENSEMBLE) rather than moving those hardware controls into the extras strip: they are hardware controls, so P1 puts them where the hardware does.
3. **Inert decoration is drawn wherever the research says the face is not recognisable without it** (ARP sliders and jacks, MS-20 patch bay, Prophet / OB-Xa programmers, Jupiter / Juno button rows, DX7 buttons), dimmed and titled "not emulated", plus a caption line.
4. **DX7 = a real DX7 workflow** (select + DATA ENTRY + LCD) with per-button `data-ctl` rebinding; no hidden registry of 84 operator widgets. Tests address DX7 values through the state machine (§9.1.8).
5. **TB-303 = hardware step entry + today's grid in the extras strip** (the grid keeps its classes and doubles as the cursor selector).
6. **CS-80 Saw / Square = level rockers** (the hardware's rocker type, our continuous level), not slide pots.
7. **Detented and mapped controls are renderer widgets** on a generalised `dragB`; continuous pots stay today's `knob` / `slider` widgets with identical behaviour and classes.
8. **`lay.i1.ui = 'flow'` only, no schema bump**; saved stage-1b widths become Resizable widths; overlapping FX / OUT modules are pushed right once by `makeRoom` (also on a toggle or replace that grows the instrument).
9. **Save / Delete / Init move to the ⋯ menu and ◀ ▶ to the chip**, in both layouts, since the Hardware layout has no preset plate.
10. **Z1 drops cards and culling entirely**; the DOM budget becomes a warning, and off-screen pausing applies to monitors and CSS animations only, resuming 256 px before a module re-enters.
11. **Controls sleep below `READ_K` (0.5) unless their module is in edit state** (§8.1): the cards used to protect a zoomed-out pan from turning knobs; the protection stays, invisibly. A double-tap on the module (or zooming in) wakes them. Flag if the user wants controls live at every zoom.
