# Stage 2a: performance modulators (IMPL-2a) — contract

What stage 2a builds, the lane split and the rules. Design: [SPEC-canvas.md](SPEC-canvas.md) §2.9 (mod cables), §2.10 (modulator
modules), §5.1 (`track.mods`, `project.perf`), §7.1–7.5, §7.7 items 1, 2, 6, 7, §7.10, §7.11, §10 2a, decisions D9 / D11 / Q5;
[ROADMAP.md](ROADMAP.md) wins where they differ. What exists: [IMPL-1c.md](IMPL-1c.md), [IMPL-1e.md](IMPL-1e.md) §8 (1e, the 1f
withdrawal: one instrument per track in the UI; the engine graph and `cv-model` editing API stay). **No DSP change in this stage**:
`engine.js`, `serum-dsp.js`, `sx-*.js`, `fx-dsp.js` are not touched.

**Invariant**: a project with no modulation cables compiles to the same bytes as today (every golden, `canonical-stream` and the
compiled-patch fixtures unchanged); a canvas wheel cable to a Serum knob renders identically to the same row written by that Serum's
own WHEEL tile.

## 1. Vocabulary and data

- **Modulator module**: a canvas module with one **mod-out jack** (right edge, `kind: 'mod'`) and no audio jacks. Stage 2a has four:
  the project **Mod Wheel** (`wheel`, one per project, shown on every track; D9), and per track **Velocity** (`ve`), **Aftertouch**
  (`at`), **Bend** (`bd`), singletons (`kind: 'velo' | 'at' | 'bend'` devices in `track.dev`, ids fixed `ve` / `at` / `bd`). LFO, ENV,
  Macro, CC, Note are stage 2b (their tiles are not shown yet).
- **Mod cable** = a row of `track.mods` (§5.1): `{ id: 'r<n>', src, dst, amt, bi, curve, crv, aux, inv, rise, fall, slink, byp, out }` —
  every field after `dst` exactly as `serum-core.normRow` defines it (defaults from `emptyRow`); `src` is `'wheel'` or `'<devId>.out'`
  (`'ve.out'`, `'at.out'`, `'bd.out'`); `dst` is `'<devId>:<paramId>'` where the device is a Serum and the param one of its `DESTS` ids or
  one of its own FX ids (`fx.<inst>.<pid>`). Row ids never reused within a track (`track.nid`-style counter `track.mid`, or the
  max + 1 rule, builder's choice, documented). `aux` is a Serum-native source id or `''` (stage 2a; a canvas aux is 2b).
- **Preset row**: a row of a Serum's own `s.matrix` whose `src` is `wheel` / `velo` / `at` / `bend`. Drawn as a cable with a "preset"
  tag from the matching module when that module exists on the canvas; edited through the Serum (D11). Not stored in `track.mods`.
- **`project.perf`**: `{ wheel: { v: 1 } | null }`; `track.lay.wheel` holds the wheel module's position on that track (first placement:
  top-left of the instrument column).
- Destinations other than a Serum knob or a Serum's own FX knob (classic knobs, shared-panel knobs) are refused with "…from stage 2b".

## 2. Compile and data (lane A: `cv-graph.js`, `cv-mods.js`, `cv-model.js`, `cv-migrate.js`, `song.js`, `main.js` host functions)

### 2.1 Injection (§7.7 items 1–2, D11)

`cv-graph.injectMods(dev, rows) → { s, placed: [{id, slot}], left: [id] }`: `dev` a Serum device, `rows` the track's rows whose `dst`
names it. With no rows it returns `dev.vals.s` **by identity** (so `patchFor` sees the same object and the output is bit-identical).
Otherwise a shallow copy of `s` whose `matrix` is a copied array: each row, in `track.mods` order, goes into the **first free slot**
(`src === ''`, `serum-core.freeSlot`'s rule) as a normalised Serum row — `src` mapped `wheel → 'wheel'`, `ve.out → 'velo'`,
`at.out → 'at'`, `bd.out → 'bend'`; `dst` = the param id; the other fields copied — so that `buildSerumT` keys its custom curve
`'crv<slot>'` and `mSlot` / slew / `mOut` work per slot as today. Rows that find no free slot are returned in `left` (the inspector
says "Serum 1's mod rows are full (64/64)", §2.13) and are not compiled. `vals.s` is never mutated; a preset load replaces `s.matrix`
and the next compile re-injects.

The merged state reaches **both** `compileSerum` and `fxModded2`: `patchFor(m, { s: merged }, fx, opts)` (main.js `buildPatch` on
the legacy path and `cv-graph.instPatch` on the graph path; bounces and render-last go through them; the preset preview and the
render farm do not inject). `cv-graph` also exports `modRowsFor(track, devId)` and `modBudget(track, dev) → { preset, canvas, left,
max: 64 }` (active preset rows + placed canvas rows; shown as "23/64").

### 2.2 Model API (`cv-model.js`, pure; History is the caller's)

```
addModDev(t, kind) → id | null            kind 'velo' | 'at' | 'bend' → device id 've' | 'at' | 'bd'; null when it already exists
removeModDev(t, id) → { rows: [ids] }      removes the device and every row with src '<id>.out'
placeWheel(p) / removeWheel(p) → { byTrack: [{trackId, rows}] }   project.perf.wheel; removeWheel deletes every 'wheel' row on every track
hasWheel(p)
addMod(t, src, dst, { amt, bi, … }) → { ok, row, why, code }   validates: src a known source of this track / project, dst a Serum device of
                                           this track and a DESTS id or one of its own FX ids (cv-mods.destOk), not nomod; defaults from
                                           serum-core.addMod's drop rules (bi = the destination's ctr flag, amount rules, aux '')
setMod(t, rowId, fields) → { ok }          normalised through normRow's rules (amt / curve / rise / fall ranges, crv ≤ 64 pts, aux a known source)
removeMod(t, rowId)
presetRows(dev) → [{slot, src, dst, …}]    a Serum's s.matrix rows with a performance source (wheel / velo / at / bend)
toPreset(t, rowId, s) / fromPreset(t, dev, slot) → the row moved between track.mods and a copy of s.matrix (the caller applies the copy through
                                           sxEdit so the Serum's panel undo and queuePatch see it); refused when no free slot
```
`cv-mods.destOk(dev, paramId) → { ok, why, stage }`: Serum DESTS / own-FX ids ok unless `nomod`; classic → `{ ok: false, stage: '2b' }`;
panel → `{ ok: false, stage: '2b' }`. `cv-mods.sourcesOf(track, project)` lists the sources a cable may start from on this track
(`[{id: 'wheel', label: 'Mod Wheel', scope: 'project'}, {id: 've.out', …}]`).

### 2.3 Project format

- `song.normDev` keeps `mods` (each row through `normRow`'s field rules plus `id` / `src` / `dst` string checks; invalid rows dropped;
  ≤ 256 rows), `track.mid`; `deserialize` / `serialize` keep `project.perf` (`{ wheel: { v: 1 } | null }`, anything else → null).
  `cv-migrate`: `SCHEMA = 5`, `STEPS[4]` additive. `toV1`'s lost list already names modulation cables; `splitTracks` keeps `mods`
  whose device survives on that track (rows to a removed instrument are dropped and named). `History` snapshots carry both.
- `cv-model.removeInst` already drops rows of a removed device; `setModel` classic ↔ Serum: rows to a device that is no longer a
  Serum are dropped with a notice line (the caller shows it).

### 2.4 Host (`main.js`, lane A owns these functions only)

- `buildPatch` / `buildInstPatch`: inject (2.1) before `patchFor`. The part caches (`partDelta` / `sameVal`) see the merged patch;
  nothing else changes.
- **Live wheel broadcast** (§7.10): `ctl('wheel', v, src)` posts `{t:'wheel'}` to `targets(src)` ∪ every track with at least one
  `'wheel'` row (`wheelTracks()`), and records (`recCC`) into `targets(src)` only, as today. `at` and `bend` are unchanged (per track).
  Without the module nothing changes (`canonical-stream`).
- `modCount(t)` / the "n/64" badge text for a Serum module (`cvBadge` reads it: "mods 23/64" only when canvas rows exist, else the
  safeguard text as today).
- Serum UI halos: `sxHost.extraRows(destId) → rows` (the canvas rows targeting this Serum, mapped to `{src, amt, bi, byp, out}`), read by
  `serum-ui.haloArcs` through a new optional `host.extraRows` so canvas cables show their range on the knob; the live value already
  comes from the engine snapshot per destination.
- Velocity / aftertouch / bend module readouts: `inputNote` exposes the last velocity per track (`lastVel(t)`); `ctl` exposes the
  last `at` / `bend` / `wheel` values (`perfValue(kind, t)`) and, during playback, the selected track's lane value (`songData` cc).
- `__synthTest.api` gains `wheelTracks`, `perfValue`, `modCount`.

## 3. Canvas widgets (lane B: `cv-module.js`, `cv-cables.js`, `cv-tray.js`, `cv-world.js`, `style.css`, `index.html`)

- **Modules of kind `'mod'`** (`createTrackView` `readDevs` admits `mod`; `make` gives one right jack `{id: 'out', kind: 'mod',
  label}`; width `W_MOD = 240`, fixed height per kind; cost 40; `port('out')` as other right jacks; `tidy` puts modulators in a column
  left of the instruments (the wheel first, then `ve`, `at`, `bd`), `layOf` keys `wheel` / `ve` / `at` / `bd`). Bodies are built by the
  host (`bodies.mount(key, el)`): the widgets live in `cv-mods-ui.js` (new, lane B): `wheelBody({ get, set })` (a vertical wheel mirroring
  the perf tray's `#modw`: dragging it calls `set(v)`; `update(v)` from the host), `veloBody({ get })` (a meter of the last velocity and
  the default curve), `atBody` / `bendBody` (meters, bend bipolar). The wheel module's jack carries "+N on other tracks" (host-supplied
  count; tap → host list).
- **Mod cables** (`cablesOf(track, { project, presetRows })`): one per `track.mods` row (`kind: 'mod'`, id = row id, `a: '<src module>.out'`,
  `b: '<dev>:<param>'`, `amt`, `bi`, `byp`, `preset: false`) plus preset rows (`preset: true`, a "preset" tag, thin) when their module exists;
  dashed when the source is per note on a non-per-note target (not in 2a: velocity → Serum knob is per voice; keep the flag). Rendering
  per §2.9: 2 px, the source module's colour, body in the **under** layer, **the last 24 screen px and the amount badge in the over layer**
  (`svg.cv-cable-ends`), the badge the only part with pointer events (tap → `onSelect(id)`, the inspector); bypassed rows `cv-off`;
  "Always / On select / Never" visibility (toolbar `∿` button enabled: `setModsVisible(mode)`, remembered pref `synthc.cv.mods`), the
  24+ fade rule with the one-time hint. Knob end point: `host.destPort(dev, paramId) → {x, y}` (world px), cached by the view per module
  from the `[data-dest]` element's rect at layout time and after the module's ResizeObserver fires, never per frame.
- **Mod drag** (`createCableDrag`): a press on a mod-out jack starts a cable whose targets are **knobs**: `elementFromPoint` →
  `closest('[data-dest]')` → `closest('[data-dev]')`, validity through `canConnect(src, '<dev>:<param>')`; while dragging, `#world` gets
  `[data-cv-patching="mod"]` and modulatable knobs light up (`.cv-ok` on their `[data-dest]`, host-provided through `markDests(src)`),
  others and whole non-Serum modules dim; release on a module's top bar → `onBarDrop(src, key)` (the host opens the parameter list);
  tap on the jack → `onJackTap(src)` (the "Connect to…" list). Audio jacks are not targets of a mod drag and vice versa. Two-finger
  cancel, Escape, Lock view as for audio cables (1e C1).
- **Sources tray**: a **Modulators** section with four tiles (Mod Wheel, Velocity, Aftertouch, Bend; original glyphs, no logos) and
  `o.pick` / `o.drag.drop(id, info)` as the synth tiles (the drop target is the canvas; `info.at` world px); a tile greys out with the
  reason text when its singleton exists ("already on this track" / "already in this project") via `setPlaced(id, reason | null)`.
- `style.css`: the mod jack, mod cable styles (`.cv-cable-g[data-kind=mod]`, `.cv-preset`, the badge), the knob highlight / dim states,
  the module bodies; `index.html` the Modulators section markup.

## 4. The mod layer (lane C: `cv-modlayer.js`, new; DOM-unit tested on wk-dom)

`createModLayer(host)` with `host = { doc, descs(dev), sources(), rowsOf(dev), presetRows(dev), budget(dev), edit(rowId, fields),
remove(rowId), toPreset(rowId), fromPreset(dev, slot), connect(src, dst), select(id), notice(text) }`:
- **Inspector** (`openInspector(rowId | {preset: dev, slot}, x, y)`): a `wk` popover with amount (bipolar slider, −100…100 %), Bipolar,
  Curve (the matrix's `curve` −1…1 and "Custom…" → the existing Serum curve editor is 2b; 2a offers the slider), Aux source (Serum-native
  sources list), Slew (rise / fall, link), Bypass, **Save with preset** (canvas row → preset) / **Keep on canvas** (preset row → canvas),
  Disconnect. Edits call `host.edit` live (one History step per gesture end, coalesced like the zone pill).
- **Mod list** (`openList(trackKey)`): a sheet listing every mod row of the track (canvas and preset) grouped by destination device,
  with the budget "n/64" per Serum, tap → inspector; the `left` rows marked "not compiled: matrix full".
- **Parameter list** (`openDestList(src, dev, x, y)`): the Serum's destinations grouped as `serum-core.destMenu` groups them plus its own
  FX instances; pick → `host.connect(src, '<dev>:<id>')`.
- Refusal texts per §2.13 ("This knob can't be modulated", "…from stage 2b", "Serum 1's mod rows are full (64/64)").

## 5. Integration (lane D, phase 2, `main.js` + page sims)

- `cvHost.devices(track)`: `devicesOf(track)` plus the project wheel (when placed) and the track's mod devices; bodies for mod modules
  from `cv-mods-ui.js` with the host's live values (`perfValue`, `lastVel`); the wheel body ↔ `ctl('wheel')` both ways; during playback
  the wheel shows the selected track's lane value.
- Sources tray: a modulator tile dropped on the canvas → `CMOD.addModDev` / `placeWheel` + `lay` at the drop point, one History step,
  "Added Velocity · tap to undo"; tap → the same at a default position; tiles greyed through `setPlaced`.
- ⋯ menu of a mod module: Delete (the wheel: `confirm` listing "Remove the Mod Wheel and its N cables on M tracks?"), Fold, Bring to
  front, Tidy.
- Mod drag wired: `canConnect` via `cv-mods.destOk`; `onConnect` → `CMOD.addMod` + History ("Modulate <knob> with <source>") +
  `queuePatch` + `cvRender`; `onBarDrop` / `onJackTap` → the mod layer's lists; `markDests(src)` from `descs`; the inspector and Mod
  list hosted (the `edit` / `toPreset` / `fromPreset` callbacks go through `sxEdit` for the Serum side); the Serum module's badge
  "mods n/64"; `cvBadge`.
- Visibility: the toolbar `∿` (Always / On select / Never) persisted; the 24+ hint once.
- A Serum preset load keeps every canvas cable (re-injected on the next compile; the view re-derives preset cables).
- Page sims (`tests/canvas-2a-sim.test.mjs`): a Velocity tile drop adds the module (one step, notice undoes); the project wheel placed
  from one track shows on another and greys its tile; a mod drag from the wheel to a Serum knob writes a `track.mods` row and posts a
  patch whose compiled matrix equals the row written by the Serum's own WHEEL tile for the same knob (compare the two `{t:'patch'}`
  messages' CP matrices); a preset load keeps the row; the live wheel reaches a cabled, unselected, unarmed track and is recorded only
  into armed targets; the inspector edits amount / bipolar / bypass (one step each gesture) and Save with preset moves the row into
  `s.matrix` (the compiled result unchanged); Delete wheel removes rows on every track with the confirm; the mod list shows n/64.

## 6. Lanes, ownership, order

| Lane | Files (exclusive) | Tests it owns |
|---|---|---|
| **A compile / data / host** | `cv-graph.js`, `cv-mods.js`, `cv-model.js`, `cv-migrate.js`, `song.js`; `main.js` ONLY: `buildPatch` / `buildInstPatch`, `ctl` / `wheelTracks` / `perfValue` / `lastVel` (inside `inputNote`), `modCount`, `sxHost.extraRows`, `loadProject` / `freshProject` (`perf`), `__synthTest.api` entries; `serum-ui.js` ONLY the optional `host.extraRows` read in `haloArcs` / `knobMenuItems` | `cv-graph`, `cv-mods`, `cv-migrate`, `serum-core` (injection: free slots, CT `crv<slot>`, `fxModded2` with injected FX rows, no rows → same object), `midi` / `main` (broadcast set, recording targets), `serum-ui` (extraRows arcs), `golden-presets` + `canonical-stream` unchanged |
| **B widgets** | `cv-module.js`, `cv-cables.js`, `cv-tray.js`, `cv-world.js`, `cv-mods-ui.js` (new), `style.css`, `index.html` | `cv-module`, `cv-cables`, `cv-tray`, `cv-world`, `cv-mods-ui` (new) |
| **C mod layer** | `cv-modlayer.js` (new), `tests/cv-modlayer.test.mjs` | `cv-modlayer` |
| **D integration** (phase 2) | `main.js` canvas / tray / menu regions, `tests/canvas-2a-sim.test.mjs`, `tests/main-sim.mjs` additive, `node tools/precache.mjs --write` | page sims, `pwa`, `lint` |

Rules: each lane in its own worktree reset to the base commit named in its brief; one test file at a time; never fake-DOM nodes in
`assert`; `import './v8-guard.mjs'` first; `?v=9`; goldens bit-identical; new modules reachable from `main.js` (lane D); the user's
rules (native zoom only, two fingers win, trays never auto-close, no resizable modules, no collision, snap, Lock view). Lane B starts
after stage 1g (grid canvas, panel bitmap tier) is merged, since both touch `cv-world.js` and `style.css`.

## 7. Gates (SPEC §10 2a acceptance)

- No cables → bytes and goldens unchanged (`golden-presets`, `golden-classic`, `golden-fx`, `golden-random`, `golden-graph`,
  `canonical-stream`, the cp2 / ct2 fixtures); `serum-core` proves `injectMods` with no rows returns the same object.
- A canvas wheel cable renders identically to the same row written by Serum's own WHEEL tile (page sim comparing compiled matrices,
  and a `serum-core` compile equality).
- A preset load keeps every canvas cable; "Save with preset" round-trips (canvas → preset → canvas) with the compiled result unchanged.
- The live wheel reaches a cabled, unselected, unarmed track and is recorded only into armed targets.
- The 64-row budget: rows beyond it are listed as not compiled; the badge and the Mod list agree with the compile.
- UI: the four modules, the tray section, the drag onto a knob (snap, glow, refusal texts), the inspector, the Mod list, visibility
  modes; iPad: the user tries it after the deploy (touch drag onto a knob, two-finger cancel).

## 8. Notes

_(filled in at the end)_
