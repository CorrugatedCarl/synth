# Stage 1c: instances and project v2 (IMPL-1c)

What stage 1c built, its APIs and data format, and the decisions taken. The spec is [SPEC-canvas.md](SPEC-canvas.md) §10 1c (with §5, §2.11, §2.12, §8.6); [ROADMAP.md](ROADMAP.md) wins where they differ (no Import library: the user starts fresh on the canvas site). No DSP or compile file changed (`git diff main` on them shows only the 11 `?v=` suffix lines); the goldens are untouched.

## 1. Project v2 (`cv-migrate.js`, `cv-model.js`, `song.js`)

**Schema 3.** `CM.SCHEMA = 3`; `STEPS[2] = toV2`. Older data (main's files, 1a/1b autosaves) is converted on load; a newer schema still opens read-only (the 1a gate).

**A v2 track** (autosave, History, files):

```js
{ id, name, color, ch, mute, solo, arm, vol, pan, notes, cc, lay?,
  prim: 'i1', nid: 2,
  dev: { i1:  { kind: 'synth', model, vals, preset, seq?, fx? /* a Serum's own FX */, on?: false, name? },
         fx1: { kind: 'panel', fx /* today's whole v2 FX state */, name? },   // classic tracks only
         out: { kind: 'out' } },
  wires: [{ id: 'w1', a: 'i1.out', b: 'fx1.in' }, { id: 'w2', a: 'fx1.out', b: 'out.in' }] }   // Serum: i1.out → out.in
```

- **A panel holds today's whole FX state** (`fx`: three racks + ui), not the §5.1 single-rack form. A classic panel shows and compiles its Main rack exactly as before, so every sound compiles bit-identically (a rack that kept bus content from an earlier Serum model still compiles as today). `cv-graph` also reads the single-rack form, so 1e can migrate panels to one rack each with a schema step.
- `song.normDev(r)` whitelists `prim`, `nid`, `dev`, `wires` (validated like the v1 fields: an instrument's `vals` through `plain`, its `seq` / `fx` and a panel's `fx` raw, as loadProject read them before). A record whose devices are not valid is read as v1 (its mirror), then adopted.
- **`cv-model.adopt(project)`** is the one entry point (loadProject, freshProject, applyRestore = undo / redo / New / Open / MIDI import, addTrack, duplicateTrack). It converts a v1 track in place (same object) and defines non-enumerable accessors `model`, `vals`, `preset`, `seq`, `fx` onto the primary, so JSON carries only the v2 form and today's ~120 `t.model` / `t.vals` / `fxOf(t)` sites keep working. `t.model = …` across classic ↔ Serum reshapes the graph and moves the FX state between the panel and the Serum (today's "the rack is kept when the model changes"). Also `isAdopted`, `instOf(t, id)`, `primId`, `fxDevOf`.
- **`cv-migrate`**: `trackToV2`, `toV2`, `toV1` (`{p, lost}`), `primV1(t)`, `mirror(o)`, `panelOf(t, id)`, `V1_KEYS`, `V2_KEYS`.
- **File mirror (§5.8)**: Save writes each track's primary (`model, vals, preset, seq, fx`) at track level too; main opens such a file as each track's primary instrument with its FX; the canvas reader ignores the mirror when `dev` is valid. Autosave and History never carry it.
- **Save as classic project** (`≡` → *Save as classic project*, `#fSaveV1`): `toV1` of the project file (assets embedded as in Save). A track of today's shape with one instrument converts exactly (`toV1(toV2(x)) = x`, tested on project-p1); otherwise each instrument becomes its own track (notes copied) and a confirm lists what main cannot hold. No `schema` in the file.

## 2. Canonical compile (`cv-graph.js`, `main.js buildPatch`)

`buildPatch` asks `compileTrack(track)`; a canonical track (§5.5) is compiled through today's `patchFor` with its v1 view — the very `vals` / FX objects the track holds — so the part caches and the node stream are today's. A non-canonical shape (stage 1e) would compile its primary alone. **Proof**: `tests/canonical-stream.test.mjs` runs a scripted main-sim session (open project-p1, power, play, select tracks, knobs on a classic and a Serum track, a classic and a Serum preset, effects added / removed, classic → classic and classic ↔ Serum model changes, undo / redo, oversampling, a power cycle) and compares every node's processorOptions and every posted message with `tests/fixtures/stream-main.json`, recorded once from main's code at the merge base `a02ab5d` (`git archive` into the scratchpad; `STREAM_REC=<dir>` re-records). Messages are compared by a canonical text of their structured clone (key order, types, values), not `v8.serialize` bytes: those encode the same number as Smi or double depending on V8's object-shape history, which differs between the two builds for identical data. Monitor subscriptions (`smon`) and the FX phase read-backs they replace (`fxph`) are left out: which displays are live is UI by design.

## 3. Instances

- **`classic-panel.js` `ClassicPanel(root, {track, model, layout, host})`**: today's renderPanel, controls, drag / wheel / keys (`binding`, `dragB`), preset plate and TB-303 sequencer with the track passed in; own `ui` map, own sequencer / step elements; `set`, `update`, `refresh`, `syncPreset`, `seqStep`, `seqRunUI`, `destroy()` (empties the root). Hardware (cv-panel `render` through `api()`) and Resizable layouts. Every control wrapper carries `data-ctl` = `data-dest` = its models.js id; the root carries `data-dev`. `main.js` keeps the page services (`classicHost`: value side effects, presets per track, sequencer state, DX7 state) and `cpanel`, the selected track's instance. Preset actions take a track (`presetKeys` per track instead of one global key).
- **SerumUI, several at once**: `data-dev` on its root (`host.dev`); on the canvas its popovers, overlays (WT editor, dialogs) and preset browser open in a twin root in the top layer (`div.sx-root.sx-layer[data-dev]` in `#ov`: screen size at any zoom, the panel's CSS and container queries apply); a camera move closes a popover (`wk.addTransient`, called by `closeTransient`); panel undo capped at 4 MB on touch devices (`undoMax`). Off the canvas (tests, main) nothing changes.
- **One FXRackUI per panel**: a panel record (`fxPanelRec`: ui, track, device, meters, its monitor subscription); its host reads its own record. The canvas shows the selected track's one panel (`fxTab`).
- **Monitors as subscriptions**: `monitors.sub(trackId, dev, {live, deliver}) → off`, one per mounted module with live displays (the Serum panel, the FX panel); a node sends `smon` while any subscription of its track is live (CANVAS shown, module on screen and unfolded, page visible).

## 4. Canvas

- **Minimap** (toolbar, `MAP_PREF` `synth.cv.minimap`, shown by default): item rects (the selection in orange) and the visible area from the world's cached rects; redrawn only after a written camera frame or a layout change; drag pans (the mapping frozen while dragging), tap centres. `cv-world.mapFit`, `MAP_W × MAP_H` 176 × 112.
- **Selection and marquee**: `world.select(id, {add | keep})`, `selectMany`, `selection`; Shift-click on a bar adds / removes; ⌘/Ctrl-A all; Escape clears; edit state only with one selected. Marquee: Shift + mouse drag on empty canvas (a plain mouse drag still pans: the user's decision); a finger held 250 ms on empty canvas, then dragged (SPEC §4.1); items touched are selected live; a second finger during a finger's marquee ends it unapplied and pinches (two fingers always win). `cv-world.inRect`.
- **Group moves**: the selected module that starts a move carries the others (live transforms, same delta); one undo step (the mover's 'end' records, the others' entries are written inside it); a two-finger cancel / Escape puts all back; arrow nudges carry the group.
- **Track switch mounting**: on a switch the new frames and the camera go up at once; the bodies (instrument, FX) mount over the next frames, nearest the view's centre first, as many per frame as fit in 12 ms (at least one), with `#world` hidden (`[data-cv-mounting]`) until the last is built (a Serum / FX UI: until it is up, at most 0.5 s: past it the frames show with the panel's own "Loading…"), then a 140 ms fade in (none under reduced motion). An edit during the mounting completes it at once. Off the canvas a switch renders at once.
- **Folded jacks** (iPad report): folded, the jacks sit at the bar's middle height `JACK_OUT` = 14 world px outside the module's edges (cables attached there); the bar's ⋯ / ▾ / chip / power are above the jacks in the hit test (z 4 over z 3), so a jack's enlarged touch circle never takes their taps.
- **Sources "Hardware | Simple"** (user request): a segmented switch over the synths (`synth.cv.trayLayout`, 44 px on coarse pointers, `aria-pressed`); Simple marks the classic tiles SIMPLE and a tap / drop creates the synth in its Resizable layout (`lay.i1.ui = 'flow'`) inside the add's / replace's own undo step; Serum ignores it; Hardware behaves as before. (A tap on the current model's tile in Simple switches it to Resizable as its own step.)

## 5. Decisions the user may want to revisit

1. Panels keep the whole FX state (above) until 1e.
2. The stream comparison uses canonical text, not v8 bytes; `smon` / `fxph` excluded (UI).
3. Serum popovers on the canvas open at screen size over everything (anchored at ≥ 1100 px of screen, full-screen sheets below by the existing container rule), and close on a pan.
4. A switch hides the canvas for a few frames (longer the first time a Serum panel loads, capped at 0.5 s) instead of showing half-built modules.
5. The existing makeRoom on a track's build (IMPL-panels §7.3: a hardware panel pushes overlapping FX / OUT right) is kept.

## 6. Not done here

- The iPad DOM / memory measurement with 3 Serum + 2 classic + 3 panels (§10 1c acceptance) needs several instruments per track (1e) and the iPad: left for the lead / user.
- The Effects tray tiles and module power arrive in 1e as planned.

## 7. Tests

New: `tests/classic-panel.test.mjs`, `tests/canonical-stream.test.mjs` (+ `tests/fixtures/stream-main.json`). Extended: `cv-migrate` (v2, toV1, adopt, mirror, normDev), `cv-world` (selection, marquee mouse / touch, minimap), `cv-module` (group move, folded jacks), `cv-tray` (the switch), `canvas-sim` (switch mounting, v2 after History steps, Save as classic, Simple), `serum-ui` (two instances on one canvas).
