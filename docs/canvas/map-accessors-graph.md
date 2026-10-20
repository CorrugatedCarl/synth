# Milestone 3 map: the 1e transition accessors, and Serum parts on the graph engine and model

Mapper, read-only. Branch `canvas` @ 959ab78 (tree clean). Everything below was read in the code or measured by script; where a
number is an estimate it says so. Scratch scripts (reusable): `scratchpad/m3/` (`acc-hooks.mjs` + `acc-register.mjs` = the call-site
recorder, `agg.mjs`, `groups2.mjs`, `scan2.mjs`).

## 0. Method

- **Static**: regex scan of `main.js` for `<recv>.(model|vals|preset|seq|fx)` with track-or-view receivers (`t tr x T v V trk() curView()`)
  plus `fxOf(` / `isSx(` calls, each assigned to its enclosing function (`groups2.mjs`). Over-counts a little (e.g. `V.model` in
  `buildPatch` is the plain v1 object `c.v1`, not an accessor); misses nothing found by a second grep of every root `*.js`.
- **Dynamic**: a Node loader hook (scratch only, repo untouched) wraps the five getters/setters that `cv-model.adopt` installs with a
  recorder that logs the first non-`cv-model` stack frame. Run, one file at a time (`--max-old-space-size=2048`, peak RSS 0.13–1.06 GB):
  canvas-sim, canvas-1e-sim, canvas-2a-sim, canvas-2b-sim, cv-shell-sim, cv-fixes-sim, main.test, graph-host, midi, canonical-stream,
  cv-migrate, cv-model, cv-graph-engine (+ pure-module files that never load cv-model: classic-panel, cv-graph, cv-module, cv-cables,
  cv-mods, cv-modlayer, cv-cost, appstore, assets: zero hits, they use v1 tracks or stubs). All green with the hook.
  Result: **83 distinct (line, function) accessor call sites in main.js**, 3 in classic-panel.js, 1 in cv-module.js, 1 in midi.js, and
  **169 in 11 test files**. A site not reached is either untested or a false positive (marked `*` below).

## 1. Map 1: the transition accessors

### 1.1 What exists

`cv-model.js` `adopt(p)` (the one entry point: `loadProject`, `freshProject`, `applyRestore`, `addTrack`, `duplicateTrack`, main.js
206/223/1298/3111/3131) turns a v1 track into v2 in place, runs `repair`, then installs five **non-enumerable** accessors on every
track (`V1_KEYS` = model, vals, preset, seq, fx), all aimed at `dev[prim]`:

| accessor | get | set |
|---|---|---|
| `t.model / vals / preset / seq` | the primary instrument's field (`prim(t)` throws "a track without an instrument") | writes it; **model** also runs `reshape` (classic <-> Serum moves the FX state between the panel and the Serum) and `dropGone` (mod rows to knobs the new model lacks) |
| `t.fx` | the FX state of `fxDevOf(t)`: a Serum primary's own, else the panel it feeds; **undefined** for a classic cabled straight to OUT | writes it; a no-op when there is no FX device (H4: never re-insert a deleted panel) |

Non-enumerable, so `JSON.stringify` (autosave, History, files) carries only the v2 form. `main.js fxOf(t)` is the second half: migrates a
v1 rack in place, and returns a **detached** default rack when the primary has no FX device. `instView(t, dev)` (main.js 270) returns a
track-shaped `VIEW` for a non-primary device but **returns the track itself for the primary** (so every `v.model` on the primary is an
accessor read). The header of cv-model says "~120 main.js sites"; the measured number is 195.

### 1.2 Inventory

| where | static | reached by sims | what |
|---|---|---|---|
| main.js | 195 sites / 69 functions (+ ~100 `d.model/d.vals/d.fx` reads that are already device records) | 83 | groups A-F below |
| classic-panel.js | 3 accessor reads (132 `get vals()`, 289 / 293 `track.preset`) + 153 `track.prim` (a plain field, the view has it too) | 3 (18.9k hits: every knob paint) | `this.track` is `instView(...)`: the track itself for the primary |
| midi.js | 2 lines (44 `isMpe`, 190 `instsOf` fallback) | 1 | primary-only MPE test |
| cv-module.js | 12 in the **stage-1b legacy path** (`T.model`, `tidy1`, `devicesOf` without `dev`) | 1 (`tModel`, 733) | used when `host.devices` is absent (module tests); main always passes it |
| song.js | 1 real read: **769** (`exportMidi`: `utf8(tr.model)`, an adopted track) + v1 construction (66, 86, 687-693) | 0 | missed by every earlier list |
| assets.js | 6 lines (545, 1299, 1303, 1366, 1378, 1738) | 0 | `tracks()` -> `t.vals.s`, `t.fx`: **primary only** (see 1.5) |
| cv-cables 140-147, cv-cost 170-184, cv-graph `v2View` | v1 branches | 0 | read v1-shaped objects (own fields), **not accessors**; leave |
| tests | 176 lines in 13 files | **169 in 11**: main.test 46, canvas-sim 43, cv-migrate 35, graph-host 13, cv-shell-sim 11, canvas-2a 10, cv-fixes 5, canonical-stream 2, canvas-2b 2, canvas-1e 1, cv-model 1 | the rest (golden-presets, appstore, assets, classic-panel, cv-graph, smpgen) build v1 tracks: unaffected |

Hot-path hits in the sims: `isSx` 3.9k, `fxOf` 3.8k, `trackVoice` 3.6k (re-run on every chip/list paint), classic-panel `vals` 18.9k.

### 1.3 main.js sites by meaning (`*` = not reached by the 10 page sims)

**A. Identity: "which model is this track" -> names, chips, menus, branches (60 sites; 44 reached).** `isSx 122` (25 callers),
`trackVoice 468`, `voiceSeen 487-493`, `trackOS 719*`, `makeNode 914,946*,953`, `rateText 1062*`, `groupLoads 1107*`, `chordCheck 1230*,1235,1244`,
`instUi 1740*`, `renderPanel 1777`, `hwDx 1811-1815`, `sxHost 2729*,2769*`, `renderCustom 2839-2856`, `renderFxTab 2901,2903*`, `initTransport 3434`,
`bounceSet 3574`, `bounce 3603,3606*`, `trkChipUI 4143-4145`, `trkListUI 4170*,4171*`, `instItems 4182`, `instMenu 4189*`, `instChip 4199-4208`,
`srcDragEnd 4262`, `cvSetLayout 4627*`, `cvChip 4682,4686`, `cvMenu 4733`, `cvDropInstrument 4903,4904`.
Replacement: `CMOD.instOf(t).model` (or `isSerumDev(t, dev)`, which already exists). **Mechanical** (1:1) except the track chip / list /
"Change instrument" menu (4143-4208, `instItems`, `instMenu`): they name the primary's model and `setTrackModel` replaces the primary;
with parts "the track's instrument" needs a rule (the chip already switches to `instsTxt(t)` when `instN(t) > 1`).

**B. Serum state read for Serum-only services (38; 18 reached).** `buildPatch 386*-390*` (false positives: `V` = `c.v1`), `sendPatch 563`,
`sxQuality 706`, `zoneWarm 2095*,2097`, `zoneOf 2105*,2106*`, `sxEdit 2136,2145*`, `projectFile 2193,2195*`, `wheelToWt 2420*,2421*`,
`resampleTo 2484*-2488*`, `renderLast 2535*,2536` (its `legacy` branch), `fxHost 2791*-2806*`, `modToPreset 5748`, `modFromPreset 5758`.
**Mixed.** Reads inside a function that already holds a view/dev are mechanical. The semantic ones are the services that mean "the Serum
on screen" or "every Serum": `sxQuality/trackOS` (a node's quality = the primary's; `sxMaxOS`/`capsOf` already loop devices), `zoneWarm/zoneOf`
(the multisample zone of `sxPanel`, the primary's panel only: `sxMonitor` 2087 calls `zoneWarm` only `if (r === sxPanel)`), `wheelToWt`
(default dev), `resampleTo`, `renderLast` (`legacy = dev === primId && legacyOk` reads `t.vals.s`/`fxOf(t)`/`t.preset`).

**C. FX rack of the primary (15; 9 reached).** `fxOf 131-134`, `fxSet 141*`, `fxOfDev 151*` (falls back to `fxOf` when no device), `applyRestore 1303*`
(`fxOf(t)` for every track after undo), `fxEditDev 2121*` (`isSx`), `setPhases 2164*`, `syncPhases 2176*` (the engine's `fxph` already takes `i`/`c`, engine 3153-3157; the **host** drops every phase message but the primary FX's: `primFx` main 979-984 keeps one `N.fxph`, and `syncPhases`/`sxSave 2292` ask without a part, so another Serum's or panel's LFO phase memory is never stored), plus the call sites `buildPatch 386`, `sendPatch 563`, `makeNode 946,953`, `projectFile 2195`, `sxLoad 2260`,
`sxSave 2278,2289`, `resampleTo 2488`, `sxHost 2729`, `duplicateTrack 3128`.
Replacement: **`fxOf(t)` has one meaning: `fxOfDev(t, null)`** with the H4 rule (a classic with no panel gets a detached default). Make every caller
pass its dev (`fxOfDev` already exists and takes one) and delete `fxOf`. Mostly mechanical; `syncPhases`/`setPhases`/`sxSave` must keep phases per rack (`N.fxph` -> a Map keyed by part id) and ask each rack with `i`/`c`: a host-only semantic fix.

**D. Preset identity and load/save (40; 21 reached).** `valChanged 662` (`t.preset = null` on any classic edit), `applyPreset 1893-1895`, `presetCur/Load/Step 1907-1910`,
`presetSave 1918-1925*`, `presetDelete 1930-1936*`, `sxCurrent 2250*`, `sxLoad 2258-2263`, `sxSave 2274-2289`, `sxRename 2309*`, `programChange 2382*,2405*`,
`cvChipFill 4702-4710`. Meaning: the preset belongs to a **device**. Already view-based for non-primary devices (`views` ids are `trackId/dev`), but the
**primary's view id is the track id**, so session maps keyed by track id mean "the primary": `presetKeys` (1906), `sxKeys` (2230), `sxDirty` (2134),
`voiceShown/voiceOpt` (485), `seqHw/dxHw` (1805-1807). `programChange` loads a preset into `trs.filter(isSx)` = each track's primary and asks through
`sxPanel`. Semantic: re-key to `trackId/dev`, give the preset services a device.

**E. Writes and lifecycle (42; 32 reached).** *After adopt (true accessor writes)*: `loadProject 212-213` (normalise the primary's `vals.s`/`fx`), `freshProject 241`,
`bind 281-283` (`v.model = model.id; v.vals = ...` on every track switch), `setTrackModel 1687,1689,1695` (`tr.vals = loadVals(m); tr.model = id; tr.preset = null`:
vals first so `dropGone` judges the rows against the new model: C11), and the writes inside D. *Before adopt (v1 construction, not accessors yet)*: `loadProject 203-204`,
`freshProject 221`, `addTrack 3108`, `importMidiFile 3530`, `duplicateTrack 3119` (reads `t.model/vals/preset` of the source through the accessors, copies v1 fields,
then deletes `V1_KEYS` from the copy and assigns `dev/wires`). Replacement: `normDevs(t)` already normalises every device **except** the primary and its FX
(`pid`/`f` skipped) -> drop the exclusion and 212-213/241 vanish; `setTrackModel` -> `CMOD.setModel(tr, dev, id, {vals, preset: null})` (what `VIEW.model`'s setter
already calls, same order); construction -> one `CMOD.newTrack(project, {model, vals, fx, ...})` so the v1 detour disappears (or leave: adopt is the ONE entry point).

**F. Homes and singletons (not accessors, but "the primary is special", ~40 lines).** `cvHomeKeys 4480` (`#inst` = primary, `#fxrack` = its FX), `cvBodyEl 4487-4493`
(`P.inst/P.fx/P.scope`), `sxPanel 2817`/`serumPanels`/`sxRec 2829`/`sxRecOf 2836`, `fxTab 2872`/`fxPanels`/`fxRec 2875`/`fxRecOf 2882`, `curOf/setCur/curDevs 251-254, 1725`, `cpSync 1771`, the globals
`model`, `vals`, `cpanel` (`bind()`), `views` cache. 12 test lines reference `#inst`/`#fxrack` (canvas-sim 4, main.test 8). The `dev = CMOD.primId(t)` **default-dev
pattern** (31 `primId(` lines): `sxMonitor 2081`, `modCount 2706`, `mcMonitor 5213` (the ModCore live-meter subscription rides the primary's part), `renderLast 2534`, `sxHost 2724`,
`buildInstPatch 415` (`voiceSeen` only for the primary), `panelKey 1769`, `cvHomeKeys`, `peerRefresh 4880`, `cvDropInstrument 4902`, `fxTarget 5095`, `mcMonitor 5213`.

### 1.4 Outside main.js (all small)

classic-panel.js 132/153/289/293 (becomes accessor-free as soon as `instView` returns a view for the primary: it reads `view.vals`, `view.preset`, `view.prim`);
midi.js 44 `isMpe(t)` and 190 `instsOf` (the host already supplies `H.instsOf`; make `isMpe` ask it: "any Serum with MPE on"); song.js 769 (MIDI file instrument name: `instOf(tr).model`);
assets.js (below); cv-module 733 and the tidy1 path (module tests only).

### 1.5 Primary-only paths: IMPL-1e §8.3's list verified, and what it missed

Verified present: program change (`programChange` 2373, `sxPanel`), MPE (`midi.isMpe`), `zoneOf` (the multisample zone, `sxPanel`), `wtEdit` default (`wheelToWt`), `renderLast`
default device, `voiceSeen` + voice labels (`buildInstPatch 415`, `trackVoice`), `rateText`, `syncPhases`/FX phase memory on preset save (`sxSave 2284-2289`), `resampleTo`, `sxEdit`.
**Not on any list before:**
1. **assets.js (the asset manager)**: `tracks: () => project.tracks` (main 1970) and then `t.vals.s` / `t.fx` in `learnTracks` (545), `relink` (1299-1303), `users` (1366), delete-in-use (1378),
   `uses` (1738). It sees **only the primary Serum and the primary's FX**: a second Serum's user wavetables/samples/IRs are not counted as "in use", not relinked, and a shared panel's IRs are
   invisible. `projectFile` (2191-2200) already loops `t.dev`; the manager does not. Fix: the host hands `states()` = `[{track, dev, s, fx}]` for every Serum and panel.
2. **song.js 769** MIDI export (above).
3. `sxKeys`/`presetKeys`/`sxDirty` keyed by track id (D above); `inputSubs` is already per device (U6).
4. FX phase memory (`primFx`/`N.fxph`/`syncPhases`/`sxSave`, C above): host-side primary-only; the engine's `fxph` already answers per part.
5. `zoneWarm`/`zoneOf`/`sxMonitor` -> `r === sxPanel` (B above).

### 1.6 Retirement plan

Principle: no engine, DSP, compile or message change anywhere (`canonical-stream` and the goldens stay the proof). It is a main.js/UI refactor
whose risk is **uncovered sites** (71 textual sites on lines no sim reaches) and **key changes** (D).

| step | what | size / risk | guards |
|---|---|---|---|
| R0 | **Safety net first.** (a) a ratchet in `lint.test.mjs`: count of `(t\|tr\|x\|T\|v)\.(model\|vals\|preset\|seq\|fx)` + `fxOf(`/`isSx(` per root file against a checked-in allowlist that may only shrink; (b) ~20 characterisation tests for the unreached functions (`presetSave/Delete`, `sxCurrent/Rename`, `programChange`, `wheelToWt`, `fxHost`, `resampleTo`, `renderLast` legacy, `syncPhases/setPhases`, `projectFile`, `importMidiFile`, `addTrack`, `duplicateTrack 3128`, `prefsChanged`, `trkListUI`, `instMenu`, `zone*`), written against today's behaviour; (c) keep the loader hook as a one-off audit (`ACC_OUT` JSON) | S-M, none | new tests green on the current tree |
| R1 | `instView(t, dev)` returns a `VIEW` for the primary too, with `VIEW.id` = `track.id` for the primary (so every id-keyed map is unchanged) | S, medium blast (`v === t` identity checks, `trOf/dvOf`, ClassicPanel `track`), cheap to verify | canvas-sim 22, canvas-1e-sim 24, cv-shell-sim 16, canvas-2a/2b-sim 48, main.test 37, graph-host 22, classic-panel 8, canonical-stream 1. Makes about half (~45) of the 83 reached sites accessor-free at once (the ones that already hold a view) |
| R2 | Groups A and the read half of B/D: `P(t) = CMOD.instOf(t)` (null-safe: `repair` guarantees an instrument); `isSx(t)` -> `isSerumDev(t, dev)` / `serumsOf(t)`; classic-panel, midi `isMpe`, song 769 | M, **mechanical** (~120 sites) | same sims; `midi.test` 23 |
| R3 | Group C: `fxOf` -> `fxOfDev(t, dev)` everywhere; per-rack phase memory (`N.fxph` -> Map by part id, `primFx` filter gone, `syncPhases`/`sxSave` ask each rack with `i`/`c`; the engine already answers) | S-M, mostly mechanical; no engine change | graph-host H4 (detached default), cv-migrate H4, fx-ui, main.test FX cases |
| R4 | Group D: re-key `presetKeys/sxKeys/sxDirty/voiceShown/voiceOpt/seqHw/dxHw` to `trackId/dev`; preset services take a device view; `programChange` iterates Serums; asset manager takes `states()` | M-L, **semantic**, session-only maps (nothing persisted) | new R0 tests + presets.test/presets2.test, assets.test 36 |
| R5 | Group E: `normDevs` for every device; `setTrackModel` via `CMOD.setModel`; `bind()` writes gone (normalise in `normDevs` + `setModel`); optional `CMOD.newTrack` | M, semantic | cv-migrate (adopt tests), cv-shell-sim (replace), canvas-sim (duplicate / undo), appstore |
| R6 | Group F: all device bodies through `cvEls`/per-device records; `sxPanel`/`fxTab`/`#inst`/`#fxrack`/`P.inst` go; globals `model/vals/cpanel` -> `curView()` reads | L, **highest risk** (GL face re-homing `FACES.recheck`, track-switch mounting U17, the 12 test lines) | canvas-sim, cv-shell-sim, canvas-1e-sim (U4, U6, U17), cv-face, ui-bench by hand |
| R7 | Delete `ACC` + `defineProperty` in `adopt` (keep `adopt`, `repair`, `trackToV2`, `V1_KEYS` for `mirror`/`primV1`); tests: 169 sites via a 3-line helper `P = t => instOf(t)` (sed + review); the ~12 accessor tests in cv-migrate (`t.model = 'serum'` reshape, H4 `t.fx = ...`) become `setModel`/`fxDevOf` tests (cv-model.test already has the API ones) | S + M tests | ratchet at zero; one assertion that `'model' in track === false` |

Order: **R0 -> R1 -> R2 -> R3 -> R5 -> R4 -> R6 -> R7**, and R0-R2 before any parts code (every new SerumHost record is keyed by `trackId/dev`; new code must not add accessor uses: the ratchet enforces it). R4 and R6 can ride with the parts lanes
(they are the same files). R3's per-rack phase memory is host-only (no engine change). Estimate of the 195 main.js sites: ~120 mechanical (A 60, B ~25, C ~10, D ~20, E ~5) and ~75 semantic (B ~13 "which Serum", C ~5, D ~20 re-keying / preset services, E ~37 lifecycle and writes); plus all 169 reached test sites, mechanical.
Kept on purpose: `CMOD.primId/instIds/fxDevOf/destOf` (API), `instRoutes/primV1/mirror` (file-format regret path), the v1 branches of cv-cables/cv-cost/cv-graph `v2View`/cv-module `tidy1` (v1 inputs from tests).

## 2. Map 2: Serum parts on the graph engine and the model

### 2.1 Verdict: one `vals.s`, one `Inst`, no DSP change

- A Serum is one `Inst` (engine.js 1462, `setSerum` 1914): it receives one compiled `p.serum` (CP) + `serumT` (CT) built by `patchFor('serum', vals, fx)` -> `compileSerum(s)`. Every
  routing fact (`route`, `fbal`, `f.route<X>`, `*.on`, buses) is *read at compile time*: `chans = [osc0..2, noise, sub]`, `route[k] = intIn(X.route, 1, 0, 3)` (serum-core 2306-2313),
  `fUse`/`chanOn`/`outMask` from `route` and `shares(key, f)` (2363-2392). A part view only changes which fields the UI writes; the writers are the same `kit.edit` -> `sxHost.edit` -> `sxEdit` path as the bundled panel.
- Removing a part is `x.on = 0` (`possOn` gating, 2243-2244): O(1) in the DSP already (SPEC §8.1).
- Protocol unchanged: a single Serum track keeps `{t:'patch', p}` (`legacyOk`); a second Serum makes the track graph-shaped (`compileTrack` -> `no('several')`, `legacyOk` false, `graphCache` adopts i0 by position).
- Parts are **not devices**: `track.dev` stays instruments / panels / OUT / modulators; `validate` would reject `'i2/oscA'` as an unknown device (`end`), which is right: internal cables are derived, like the existing read-only `iN.out -> iN/fx.in` in `cv-cables.cablesOf`. `track.wires` keeps only audio cables between devices.
  `port()` (cv-graph 148) already parses `i2/oscA.out` ("Serum parts: stage 3" in its header), `song.normDev`'s `PORT_ID` accepts it.

### 2.2 Where parts live in the data, and the limits that bite

- Module keys: the VOICE module = the device key `iN` (unchanged), its own FX = `iN/fx` (unchanged), parts `iN/<part>`. Bundled <-> parts is a **view flag** (suggest `lay[iN].parts = 1`, like `ui: 'flow'`: view only, no schema bump; a 2b build opens such a project bundled and loses nothing).
- **`song.normLay` would drop part positions**: `LAY_KEY = /^[a-z][a-z0-9]{0,15}(\/[a-z][a-z0-9]{0,15})?$/` (song.js 507) has no capital letters after the slash, so `i2/oscA` is rejected (use lowercase ids `osca`, or widen the regex); and **`normLay` stops at 64 entries** (`n >= 64`).
  A Serum in parts is up to 25 modules (VOICE, OSC x3, SUB, NOISE, FILTER x2, S1 FX = 9; ENV 2-4 = 3, LFO <= 10, MACROS, CHAOS, ARP, CLIP) so two Serums plus modulators and panels exceed 64. Also `cv-model.dropLay` removes only `id` and `id/fx`: it must remove `id/*`.
  `normDev` caps devices at 64 and wires at 256 (fine: parts add neither).
- Engine limits unchanged: <= 8 Insts, <= 16 chains.

### 2.3 Internal cables <-> existing fields (nothing new is stored)

| cable (view) | fields it reads / writes | notes |
|---|---|---|
| OSC A/B/C, SUB, NOISE `.out` -> FILTER 1 | `src.route = 0`, `p['x.fbal'] = 0`, `p['f.route<X>'] = 1` (X = A B C N S) | lit iff `filterFeeds(s, 0, X)`; `toggleFilterRoute` is the existing tap semantics |
| ... -> FILTER 2 | `route = 0`, `fbal = 1`, `p['f2.route<X>'] = 1` | |
| ... -> both (parallel) | `route = 0`, `fbal` strictly inside (0.5 default: "the knob at the cable's fork"), both switches | share = (1-b)/2 for F1, (1+b)/2 for F2 (`shareOf`) |
| ... -> VOICE MAIN / DIRECT / nothing | `route = 1 / 2 / 3` | OSC A defaults to Filter, the rest to Main (`OSC_ROUTE_DEF`) |
| FILTER 1 -> FILTER 2 (series) | `filter[0].route = 0` (F2 -> Main if it was 0: no loop, serum-core 1762/2779/2899 + sx-ui-mix 344); reverse `filter[1].route = 0` | "most recent choice wins" |
| FILTER k -> MAIN / DIRECT / none | `filter[k].route = 1 / 2 / 3` | |
| AMP ENV toggle | `osc[o].env`, `sub.env`, `noise.env`, `filter[k].env` | shown when route is Main/Direct (`showEnv`) |
| bus sends | `p['x.bus1']`, `p['x.bus2']` | knobs, not cables |
| VOICE MAIN / DIRECT / BUS 1 / BUS 2 -> its own FX | `dev.fx.racks[0..2]` (`.route` of a bus: 0 Main, 1 Direct, 2 the other bus; both buses into each other: the other -> Main), `.byp`, `g.master`, `g.direct`, `g.bus1v`, `g.bus2v` in `s.p` | an edit of the **FX state** too, not only `vals.s` (`kit.editFx`, `peerRefresh`) |
| OSC -> OSC warp / FM / pitch source | `p['x.w1']` / `p['x.w2']` mode families (`isWarpFromOther` 18-20), `osc[o].fm`, `osc[o].pitch.src` (note/A/B/C) | same Serum only; cycles repaired by `breakWarpCycles` / `fixRatioSources` / `pitchChoice` (refuse up front) |
| part power | `p['x.on']` (x = a, b, c, s, n, f, f2) | a **knob** (Serum state): see 2.7 |
| ARP / CLIP -> VOICE note input | `p['arp.on']`, `p['clip.on']`, `s.arp`, `s.clip`, `s.kbd` | |
| Serum LFO / ENV / macro -> a knob | `s.matrix` rows | unchanged (D11); 2b's `i1/lfo3.out` link sources cover cross-Serum |
| canvas modulator -> a part knob | `track.mods` row `dst = '<dev>:<param>'` (`a.level`) | **part-independent**: same row bundled or parts |
| S1 FX out -> shared panel / OUT | `track.wires` | unchanged |

Not a bijection: a source with `route 0` whose filter switches are all off, or a fractional `fbal` with unequal switches, has no clean cable (silent but "routed to Filter"). The
view needs a defined stub/dim for "routed to Filter, lit nowhere". Also **ROADMAP 2026-10-19 wins over SPEC §8.3's last line**: the filter input switches S A B C N are plain switches (not modulation destinations, no `data-dest`): the cable gesture writes them directly.

### 2.4 Three copies of the routing rules today

`sx-ui-mix.js` (`STRIPS`, `routeOf`, `channelStrips`, `routeMenuItems`, the loop rule in the page handler 321-344), `cv-cables.js` (`STRIPS` + `routeOf` + `routeLabel`, a pasted copy: "sx-ui-mix routeOf"), `serum-core.js`
(`filterFeeds`, `toggleFilterRoute`, the normaliser loop rule). Parts add a fourth unless the contract makes **one pure module** (`serumEdges(s, fx) -> cables`, `setEdge(s, fx, from, to) -> edit`) that the MIX page, `routeLabel` and the part cables
all call, so a cable edit and a MIX-page edit cannot disagree. Test: SPEC's `jackrules.test.mjs` (every cable <-> field both ways, round trip state -> cables -> state, F1/F2 loop, fork, refusals).

### 2.5 "Moving an oscillator to another Serum"

- **Data**: `serum-core.copyModule(sDst, sSrc, 'oscX', 'oscB', {mods: true})` (2794) copies `osc[o]` whole (route, env, map, pitch, fm, smpo...) and the `b.*` ids onto `x.*` (`mapDest`, `convN`), plus the matrix rows that target the module (re-targeted by suffix). It
  does **not** do: the destination filter's `f.route<X>` / `fbal` fork, `x.on`, the warp/FM/ratio references to the *source's* other oscillators (dangling in the target: must be dropped and listed, SPEC §8.3), `s.midi` / `s.locks` entries, canvas `track.mods` rows, assets bookkeeping (global ids, fine), bus sends into a rack the target may not have.
  Two **traps**: (1) the copied preset rows keep `src: 'lfo3'|'env2'|'macro1'`, which now read the **target Serum's** LFO 3 / ENV 2 / macro 1 (a different modulator) -> convert LFO/ENV sources to canvas rows from `i1/lfo3.out` (2b's link mechanism, `srcDev` kind `link`, keeps the modulation) and list macro sources; (2) canvas rows `i1:b.level` must be re-targeted `i2:x.level` (new `cv-model.retargetRows`; `modRowsFor` matches by device prefix).
  The slot letter changes (B -> A or C): PRNG streams (A/B use `r`, C `r2`), `memSet` defaults, sample/phase memory defaults differ -> **not bit-identical**, and the moved oscillator now runs under the other Serum's VOICE (poly/glide/ENV 1/master). State this in the notice.
  "Free slot" = `x.on < 0.5` (a hidden-but-kept part counts: its settings are overwritten; say so). Source part: `b.on = 0` (settings kept = a stale duplicate; the spec keeps it).
- **Engine**: needs a **second Serum `Inst` on the same track** (a separate track cannot be cabled: each track has one OUT, D4). That is exactly the withdrawn 1e/1f capability: `cv-model.addInst(t, 'serum', {vals, fx})` (auto-patch into the shared panel with most sources, else OUT), engine graph (`{t:'graph'}` + `patch i` + per-Inst own chain, salts 0 / `devNum*0x9E3779B9`), `legacyOk` false, `cvAddInstrument` + soft caps (`cv-cost.softCap`: a second heavy Serum asks on touch). The tail of §8.3 is relevant: "a dying Inst that fanned out" cannot happen (fan-out is refused), "graph edits switch without a fade" matters when a Serum is deleted (`retire` fades it).
  "A 4th oscillator starts Serum 2" = `addInst('serum', {vals: init with only that oscillator on})`; "cabling into another Serum's filter moves it" = the data steps above in one History step. Both need `track.prim` rules (delete VOICE -> lowest remaining Serum becomes primary: `removeInst`).
- **Test gaps**: two Serums on one track have **no engine-level test** (engine-track covers Serum + classic; canvas-1e-sim U6 covers the input subscriptions). Needed: an engine-track case (two Serums: each Inst's render = a one-Serum track's, summed at the chain input, as the existing copy(A)+B test), `Track.warmGraph` with a second Serum (the first chord on a fresh Serum Inst: voices are built in `msg`, up to `poly` of them, shapes may be JIT-cold), a bench row (row r has one Serum), a moved-oscillator test (Serum 1 all-on vs Serum 1 + Serum 2 with filters off: equal within float rounding; with a filter routed: asserted different, as designed).

### 2.6 Per-device host records (main.js) and what parts need from them

Today: `classicPanels` ('tid/dev' -> ClassicPanel), `serumPanels` ('tid/dev' -> `{ui: SerumUI, vals, el, box, gen}`) + the primary's singleton `sxPanel`, `fxPanels` + `fxTab`, `cvEls`/`cvBuilt`/`cvMounted`/`cvDue` (bodies), `sxMons` ('tid/dev' monitors), `cvChips`, `cpMons`, `modLeftN`. `sxHost(t0, dv)` is already per Serum (`state/edit/fx/editFx/presets/monitor/dev/extraRows/extraMatrix/midiLearn/resample/renderLast/editorOpen`).
The parts need one **controller per Serum** that outlives its views (SPEC §8.6 `SerumHost`): `SerumUI` today *is* that controller (kit, panel undo (4 MB touch), snapshot `smon`, halos, popover layer `lay`, `s.ui` view state) and builds `OscPanel/SubPanel/NoisePanel/FilterPanel/MixerPage/ArpPage/ClipPage` from `makeKit(ui)`, while `envPanel/lfoPanel/macrosPanel/voicingPanel/vcPanel/chaosPanel/unisonPanel/quality/tuning/mpe` are `SerumUI` **methods** (serum-ui.js 3876-4919) to extract. Record shape: `rec.host` + `rec.views: Map(part -> view)`; `sxRec(t, dev)` loses its primary branch (R6); `sxDrop` destroys the UI **and its undo stack** on any rebuild or track switch today (so "switching loses nothing" must mean state *and* the panel undo, which the host-owned stack gives).
Cable endpoints for canvas mod cables: knobs are found by `[data-dest]` inside `[data-dev]` (one module per Serum today; N part modules per Serum in parts: end-point measurement is per module, `d` ids like `a.level` are unique per `[data-dev]`).

### 2.7 Save / undo / preset story

- **Saved**: `dev.iN.vals.s` and `dev.iN.fx` exactly as today; parts add only `lay` entries (+ the view flag); `track.mods` rows are part-independent. No schema bump. "Save as classic project" (`toV1`/`mirror`) is unchanged (the state is the same; two Serums split per instrument with the existing `lost` list; the parts layout is silently dropped, view only).
- **Undo (the load-bearing conflict)**: History (`hist.record` + `applyRestore`) restores a project snapshot but **`keepDevs` keeps each same-model device's current `vals` and `fx`** (knob-tweak policy: Serum edits are never History steps, main 1263-1285). Consequences:
  1. A cable edit *inside one Serum* (`route`, `fbal`, switches, `filter.route`) is a `kit.edit` = panel undo, not History: identical to the bundled MIX page, so the top Undo button does not undo it. Decide whether that parity is what the user wants for *cables* (D12 says "structure is undoable").
  2. **Part presence vs `x.on`**: `lay` is in the snapshot (reverts), `x.on` is Serum state (kept). Undoing "Add OSC B" would remove the module and leave B sounding. Use the machinery 2a built for rows (`modMoveBack`, `entry.meta`): the step carries `{trackId, dev, part, on}` and undo/redo write `p['x.on']` back (and note it if the knob changed since).
  3. **A cross-Serum move** edits two states: its History step carries both modules' before-state in `meta` (the 2a "Save with preset" pattern); both Serum hosts re-base their panel undo and refresh (`peerRefresh`).
  4. Bundled <-> parts is `lay` only: one History step or none (the camera is never in History).
- **Presets**: a Serum preset (`sxPreset`, `{name, cat, v:{s}, fx}`) is whole-Serum: loaded on VOICE, `core.applyPreset` (locks honoured), `sxKeys`/`sxDirty`/`presetKeys` per Serum (R4). Loading never touches `track.mods` (D11) and never changes `lay`; parts "now on" gain modules, "now off" dim (SPEC §8.5): with (2) above that is a `lay` addition made by the host after the load (not a History step). Per-part Copy/Paste/Init/Swap = `copyModule`/`initModule`/`swapModules` (same-kind, same Serum). Nothing exists below the Serum level as a preset.

### 2.8 The four modulator modules on Serum's own panels (data side)

`song.normLfoMod/normEnvMod/normChaosMod` define a module as **a Serum slot in a different layout**: `{lfo: normLfo(...), rate, rise, delay, smooth, phase}` = `s.lfo[k]` + `p['l<k>.*']`; ENV `{env: {bpm, legInv, stealRe}, att..., crv[3], start, end}` = `s.env[k]` + `p['e<k>.*']`; chaos `{chaos: {mono, sh}, rate, bpm, smooth}`; macro `{v[8], names[8]}` = `s.macros`. `cv-graph.slotState/writeSlot` already convert both ways (that is how a PER NOTE module is injected into a Serum slot). So "Serum's own panel" = the extracted `lfoPanel/envPanel/macrosPanel/chaosPanel` bound to a **one-slot shim state** whose `edit` writes back through `CMOD.setModState` (one History step per gesture, today's `modEditState`); no model change, no compile change. Only the panels' dependence on `this.s()` / `this.edSel` / `dKnob(id)` ids (`l1.rate` in the shim) must be kept satisfiable by the host.

### 2.9 What the contract must settle (from this map)

1. Is a second Serum on one track in scope? It is the only way to meet "a 4th oscillator starts Serum 2" and "cabling into another Serum's filter moves it"; the alternative is one Serum per track in milestone 3 (refuse with a message), data untouched. (1f withdrew several instruments for lag; the cost of a second Serum is another set of part modules plus a second voice pool.)
2. Lay budget: raise `normLay`'s 64 and fix `LAY_KEY`/`dropLay` for part keys (lowercase ids).
3. One pure routing module (2.4); the "routed to Filter, lit nowhere" display.
4. Undo scope for cables and part add/remove (2.7), with `meta` write-back.
5. Moved-oscillator semantics: source rows (LFO/ENV -> canvas link rows; macro rows listed), warp refs dropped and listed, canvas rows re-targeted, midi/locks lost and listed, sound not bit-identical.
6. Accessor retirement R0-R3 before parts lanes; R4/R6 with them; asset manager and `fxph` primary-only paths fixed in the same stage.
7. Tests to add: `jackrules`, parts<->bundled byte-identical `vals.s` (bundled -> parts -> bundled), move-on-cable (data + undo meta), two-Serum engine-track + warm-up + bench row, asset-manager over all Serums, the ratchet.
