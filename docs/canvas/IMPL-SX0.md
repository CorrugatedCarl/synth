# Stage SX0: Serum out of the canvas app (IMPL-SX0) — contract, amended after the skeptic + re-plan (2026-11-02)

**Amended 2026-11-02** (§15, "Skeptic + re-plan"). No schema bump: an old Serum becomes a Wavecraft in a load pass inside schema 17
(§2). renderLast stays as plumbing (§1). D1 also takes the stand-in path and the sims that ran on it (§3). The sections below already
carry each finding. Where an older reading of this file conflicts, §15 wins.

ROADMAP row 28 (docs/canvas/ROADMAP.md:49 [R]). MOD1 (IMPL-MOD1 §14) left this stage its seams. `mountSlot` has no caller. The
modulators wear rig faces. The Modulators have their own view. The `mods` frame-cost scene stands beside the `serum` scene.

**The user's words (binding).**
- "the only thing left of serum in the end should be the serum complete and even that should be hidden and be made legacy".
- The same day: "you can remove serum complete entirely then. but keep serum in the old synth app (not canvas) because i gave that
  to my brother … with respect to the canvas app dont worry about any saves".

So the **Serum complete instrument** and the **Serum parts machinery** leave canvas. **Nothing changes on `main`**
(synth.domlavin.com): it is never checked out, merged or pushed by this stage. Canvas saves need no care, but a project that
holds a Serum must still open without an error; §2 decides what it becomes. Original content only: no Xfer name, URL or text
stays on canvas. "Wavecraft" appears only in `RIG.NAME` (rig-core; the rig-model test).

**Base ⟨B⟩.** `canvas` **3db44a8** (MOD1 live: 589d966). Line references are to ⟨B⟩. The lead re-checks them at phase 0. Tags as
IMPL-MOD1: **[R]** a fact (file:line), **[R?]** unconfirmed (the lane pins it), **[C]** a choice made here. A builder may refine a
[C] with a reason in §14, never an [R].

**Standing rules.**
- Browser first: no iPad app rebuild. The app's node tests stay in the sweep.
- No per-stage iPad session.
- The lean shape: a contract first, then builders in worktrees reset to their base (`git log -1` checked: the harness makes
  worktrees from `main`'s ee2a939). Then two reviewers, failing-test-first fixers, one sweep, one test file at a time
  (`node --max-old-space-size=2048 --test tests/<file>.test.mjs`).
- **No Fable**: Opus 5.5 for the judgment lanes and phase 0, Sonnet for the mechanical lanes.
- Chrome for Testing only: downloads denied, its own `--user-data-dir`, killed after.
- Never touch `main`. "Push it live when it's done."

**Invariants**
- **S1 No sound changes.** These files are not in the diff: engine.js, every `DSP_FILES` script (main.js:931 [R]) and serum-core.js
  (the compile and the factory presets the rig uses). Every golden and frozen ref stays exact, ref-WC included (§6.2). A Wavecraft,
  a modulator, a rack and the master sound bit-identical. An old Serum opens as a Wavecraft with the same patch (§2).
- **S2 `main` untouched.** "Save as classic project" (the regret path) still writes a Wavecraft as main's Serum, so main opens it.
- **S3 No Serum a user can see on canvas.** No instrument, tile, view, panel, menu item, notice, tooltip, file name or "Xfer" (§5).
- **S4 The survivors behave as at ⟨B⟩.** The Wavecraft (faces, cords, ⋯ menus, drawer, Preferences / Info dialogs), the ten
  modulators, every FX rack and the master. Only their Serum words change.
- **S5 Seams untouched.** IMPL-MOD1 §7 (Cut B) and the slot hosts' ring path.
- **S6 No test weakened.** A removed case either tested deleted code, or its behaviour is pinned elsewhere (named in §14). A frozen
  ref is never re-recorded (§6).

---------------------------------------------------------------------------------------------------------------------------------

## 0. What exists (facts at ⟨B⟩; "→" what they force)

| piece | where [R] | → SX0 |
|---|---|---|
| **The models.** The `serum` entry (name 'Serum', maker 'Xfer Records', `presets: FACTORY_PRESETS`). The rig: `map: serum.map`, `presets: FACTORY_PRESETS`, `custom: true`, `family: RIG.ID`. `MODELS` puts serum at index 12. `isSerumModel`; `isSxModel` = custom (both); `isSxId` (both). Site code indexes `MODELS` only at [1] | models.js:704–719 (:705), :894–903 (:901, :902), :905, :910–915; main.js:125 | the rig owns its map (the same `compileSerum` call) and presets; serum leaves `MODELS`. Indices 13–18 shift by one: no site code reads them; rig-model.test's pins move |
| **One patch for both.** `patchFor('rig', v, fx, o)` deep-equals `patchFor('serum', …)`: the same raw map, `controls` empty on both, both custom; the patch holds no model id | models.js:901, :916–928, :940–967; rig-model.test:99, rig-sound.test:85 | every re-point serum → rig is byte-identical by construction (§6) |
| **The rig's host is a SerumUI.** `uiMods` imports serum-ui.js as `M.sx`. renderCustom: `parts = !isSerumModel(m) && …`, `new M.sx.SerumUI(box, sxHost(t, dev), parts ? {parts: true} : undefined)`, `rec.mode`. `sxViews` wants 'parts' only when `typeof H.dropShell === 'function'`. SerumUI's parts constructor adds only unread shell fields over `super()` + `start()`. sx-host `createHost(host, o)` = `new SerumHost(host, o).start()`, already used by rig-ui.test:47 and m3-fixture:131 | main.js:3009–3010, :4339–4345, :8064–8076; serum-ui.js:53–76; sx-host.js:4736 | the rig's host becomes `createHost` and its mode is 'parts' by construction. Then serum-ui.js has no caller (§3) |
| **serum-ui.js's other users.** `programChange` reads `M.sx.browserList` / `M.sx.BROWSER_KEY`. It targets every `isSxDev` track, so a rig too. Both are sx-host.js exports that serum-ui.js re-exports. Tests import its re-exports (accessors, canvas-2a-sim `dropRow`, m3-fixture, ui-layout-wc `SU.SerumUI`). Several sims inject `{sx: …}` into `uiLoad` | main.js:3775–3791, :3779; serum-ui.js:36–42; tests as named | the sx-host module takes `M.sx`'s place in `uiMods` (§3) |
| **The parts machinery.** sx-ui-mod.js: `PART_W` :51, `PART_PH` :60, `phaseOf` :65, `COL` :71, `VoiceHeader` :564, `MpePanel` :739, `VoicePanel` :926, `partView` :983, `mountPart` :997, `mountSlot` :1005 (no caller since MOD1), the view registrations :1021–1044. main.js: `SXMOD` / `SXW` :8044, `sxPartW` / `sxPartH` :8049–8050 (`RIGUI === false`, where "the stage-3 views stand in": a test loader only), `sxViews`' fallback `SXMOD.mountPart` :8088, the hook's `module / widths / setModule` :11214. cv-module.js `PART_W_DEF` / `PART_H_DEF` `voice` :131–133 | as cited | all of it goes except one thing: **the Arpeggiator and the Clip sequencer**. A rig shows them when its state has them on. rig-ui has no face for them (`KINDS`, rig-ui.js:90), so `mountPart` is their one view (Q1) |
| **Serum-complete-only paths in main.js** | `sxDefault` / the default-preset defaults :174–176; `newFx` :249; renderCustom's bundled branch :4341–4344; `srcModeUI`'s 'Serum' :6520; the Serum ⋯ items :7315–7316; `rigConvert` ("Make it a <NAME>") :9205–9221 and the hook's `convert` :11198; `sxViews`' bundled branch :8070–8073; `renderLast` :3995–4030 (wired only by `VoiceHeader`, sx-ui-mod.js:572 / :592 → sx-host.js:3116) | they go (lane D) |
| **Tray, art, sizes.** cv-tray: `TO_MODS` names the Serum view; `SRC_VIEWS` 'serum' (the tile, the Modulators); the rig view's note keeps "Arpeggiator and Clip sequencer arrive in a later update". cv-art: 'Serum (complete)'. cv-module: `W_SERUM`, `H_GUESS.serum`, the 'serum' branches, costOf 3700 | cv-tray.js:592, :596–597, :602; cv-art.js:727; cv-module.js:73, :208, :283, :350, :534, :1276 | they go (lane D) |
| **Old projects.** `SCHEMA` 17, `STEPS`. STEPS[15] `partsWhole` writes notes saying "its Serum … Make it a <NAME>". `toV1` turns a rig into `model: 'serum'` (main's id) with a note "saved as a Serum". `upgrade` collects `notes`. midi.js `sxInsts` routes MPE to `model === 'serum'` only, and midi.js stays byte-identical (IMPL-B) | cv-migrate.js:117, :135–178, :191–213, :292–315 (:303–313), :180–189; midi.js:53–57 | a load pass in `upgrade` converts the device, inside schema 17 (§2). toV1 keeps main's id but its words change. midi.js unchanged |
| **adopt is the identity here.** rig-core `adopt(s)` (the AMP ENV switches, as "Make it a <NAME>") changes neither project-p1's two Serums nor any of the 86 factory presets: the lead's read-only probe at ⟨B⟩ | rig-core.js:165–218; tests/ref-p1/project-p1.json trk_1 / trk_2 | the conversion may adopt and still keep project-p1's sound exact (§2) |
| **Presets.** 86 factory presets; no "Serum" or "Xfer" in any field (scan at ⟨B⟩). The user store `synth.user.serum`. Export / import (file types 'synth.serum.preset' / '.pack'; file names `.serum.json`, `.serum-pack.json`). The preview. `programChange` reaches a rig today. sx-host `PresetBrowser` is built by `mount` for any host with `presets`, but its UI opens only from `VoiceHeader` / `mainMenu` | serum-core.js:5020; main.js:3624–3760 (:3731, :3738), :3775, :4032–4150; sx-host.js:1982, :2009–2025, :3922, :4738– | the data and the host plumbing stay: they are the Wavecraft's, IMPL-WC Q6 (a) WC-2, and program change uses them. The file names lose "serum" (§5) |
| **Assets on the 'serum' id.** smpgen farm jobs: Drum Loop 120, Break 96 and Arp Loop 128 use `model: 'serum'`, through assets.js `farmPatch` (`MODELS.find`). cv-cost's measure worker calls `patchFor('serum')` | smpgen.js:133–135, :824, :849–852; assets.js:351–360; cv-cost.js:300 | re-pointed to `RIG.ID`: the same presets and patch, so the same sample bytes (§6) |
| **Words.** A literal scan at ⟨B⟩ (comments and identifiers skipped) finds 50 lines with "Serum" / "Xfer" in 23 files, plus the manifest | §5 | 16 go with the code; 23 + the manifest are re-worded; 11 are not user-visible |
| **The deploy publishes the whole tree.** docs/ and tests/ are on canvas.domlavin.com too | tools/deploy-canvas.sh:7–16 | §7 |
| **Precache.** `BUILD` '201d76bf753e'. 'serum-ui.js' is listed. 105 ASSETS = 9,119,085 B; 14 STATIC (index.html as './') = 734,970 B. **Total 9,854,055 B.** serum-ui.js is 48,886 B. The iPad bundle is this list (tools/app-bundle.sh) | sw.js:40, :54; measured at ⟨B⟩ | §7 |
| **The Serum frame-cost scene** | tests/ui-bench-fps.mjs:62, :106, :667–720; .test.mjs:108, :319, :339, :359–360, :375 | goes; the `mods` scene (MOD1) stays |
| **(skeptic) The presets' model.** `const SXM = MODELS.find(m => m.id === 'serum')` at module top; `sxPresetList`, `sxPreset` and the preview's `patchFor(SXM, …)` read it | main.js:3628, :3639, :3643, :4061 | D1 points it at the rig (the same presets and map): else program change, `sxLoad` and the preview throw |
| **(skeptic) A rig's values on a model change.** `keep = rigM && o.keepLay && o.vals`; without `keepLay` the vals are `loadVals(m)` (the rig's starter) | main.js:2600–2601 | canonical-stream's step passes `keepLay: true` (§6.2) |
| **(skeptic) The stand-in path's consumers.** Loaders without `rig`: canvas-3-sim:79 (25 cases on a rig with stage-3 panels), canvas-del-sim:66, canvas-MM-sim:60 (no rig track). The bundled branch: canvas-FR-sim:63 / :78 (`SxStub(box, host)`, `mod: null`), cv-shell-sim:318 (`SerumUI: class {}`, `mod: {}`). `RIGUI === false` sites: main.js:7118, :7205, :8049–8050, :8717 | as cited | D1 moves them (§3) |
| **(skeptic) MPE cases.** accessors.test:267 (R2), canvas-R-sim:641 (R-15), main.test:241 route MPE through midi.js, which keys on main's `'serum'` (byte-identical: app-midi.test:22, :372). midi.test's `'serum'` objects (:34, :71, :251) test midi.js itself | as cited | no re-point (§6.3) |
| **(skeptic) render-last as a probe.** Offline single-track renders are checked through `api.renderLast`: graph-host:251 (buildInstPatch offline), :525 (canvas mod rows), :538; canvas-M-sim:596; canvas-SC-sim:437; app-shell:399; accessors:151–154; main.test:61, :193–215 | as cited | renderLast stays (§1) |
| **(skeptic) The installed iPad app** is built from 96409fa (stage B, 2026-10-24): `SCHEMA` 14 there | `git show 96409fa:cv-migrate.js` :105 | it has opened browser-saved projects read-only since SC (schema 15); §2 needs no bump for it |

---------------------------------------------------------------------------------------------------------------------------------

## 1. What goes, what stays [C]

**Goes**
1. **Serum complete.**
   - The `serum` model and `isSerumModel`.
   - The tile, the Serum view, the `#serum` route (it is generic: a hash names no model and opens the default) and every
     "new Serum" path.
   - serum-ui.js, the Serum ⋯ items, "Make it a <NAME>" and `rigConvert`.
   - `sxDefault` / `newFx` (Save as Default Preset) and the header's render (VoiceHeader's wave icon). **(§15 P1-4) `renderLast`,
     `resampleTo` and the `renderLast` / `resample` host members stay:** no UI reaches them once VoiceHeader goes, but seven test files
     use render-last as the probe of an offline single-track render (§0). Their removal is ROADMAP 15's cleanup. main.js:3997's
     "Serum-engine" error is re-worded (§5).
   - The size, cost and art entries (`W_SERUM`, `H_GUESS.serum`, 'Serum (complete)').
   - The `serum` scene of the frame-cost harness, and tests/ui-bench-m3.mjs with its `?m3=1` route (the milestone-3 S0 spike: a
     bundled Serum against Serum parts).
2. **The parts machinery.**
   - `mountSlot`, `partView`, `PART_W`, `PART_PH`, `COL`, `phaseOf`, and every view registration but `arp` / `clip`.
   - `VoicePanel`, `VoiceHeader`, `MpePanel`.
   - main.js's `RIGUI === false` path (the stage-3 views standing in), `SXW`, and the hook's `widths / setModule`.
   - cv-module's `voice` part sizes and the lay flag `ui: 'parts'` (main.js:7146, :7859).
3. **The shell-only kit, bounded (§15 P2-7).** Inside sx-host.js / sx-ui-mod.js / sx-ui-mix.js / sx-ui-seq.js / sx-edges.js, only:
   - the named shell members: `logo`, `about()`, `mainMenu` and the host methods only `mainMenu` calls (sx-host.js:3929–3947:
     `loadPresetFile`, `revertPreset`, `saveDefault`, `resample`, `loadTuning`, `renderOscWarp`, `initPreset` — each only if its grep
     shows no other caller);
   - `addRoot`'s bundled branch;
   - the MIX page's build (`MixerPage.build` and its strips, but not `OutputsPanel`'s);
   - `KeyboardPanel` / `OscMapEditor` if no rig caller remains;
   - anything holding a string G4 flags.

   Each comes with a "no caller" proof in §14. The shell's CSS groups (sx-host.js:766–1121) go only where a selector-match check
   on the mounted faces and modulators (the three viewport sizes) finds no element: a part root is `.sx-root` too
   (sx-host.js:1876). Any further dead-code sweep is ROADMAP 15's.
4. **Dead CSS, Serum's only.** The bundled-only `.cv-body > .inst.custom .sx-root` (style.css:1105) and `:root --sx-*` (642–644) go,
   if the same check finds no element [R?]. MOD1's modulator-body leftovers (`.cv-mbody` … `.cv-mkeyon`, 1199–1317) are not Serum.
   They wait for ROADMAP 15 (§15 P3-3), and cv-tray.test's pins on them (:1063, :1066) stay.

**Stays**
- **The engine.** serum-dsp, every sx-* DSP script, mod-core, engine.js's kind `'serum'`, serum-core.js whole. That includes
  `FACTORY_PRESETS` and its dead helpers `sortMatrix` / `applyMacros` / `chaosToLfo`, which S1 keeps out of the diff (ROADMAP 15's
  cleanup).
- **The Wavecraft.**
  - rig-ui / rig-core / rig-grid.
  - Its host (sx-host `SerumHost`, `slotHost`, `createHost`, the kit, the mod layer, `PresetBrowser`).
  - The donors (sx-ui-osc whole; sx-ui-mod's Macros / Env / Lfo / Curve / Voicing / Chaos / Quality / Tuning / Vc / Prefs / Info
    panels, `panelDialog`, `OutputsPanel`; sx-ui-mix's `OutputsPanel` and its strips; sx-ui-seq's `ArpPage` / `ClipPage` and their
    internals — Q1).
  - sx-edges, graph.js, wtedit, wk.
- **The presets' data and host plumbing.** These are the Wavecraft's: IMPL-WC §3.7, program change.
- **"Save as classic project"** (S2), the modulators, the racks, the master.
- **File and identifier names** (serum-core.js, serum-dsp.js, `SerumHost`, `compileSerum`, the engine kind, the store keys
  `synth.user.serum` / `synth.sx.*`, the file types 'synth.serum.*'). These are not words a user sees. Renaming them moves every
  import and the golden harness, so it is ROADMAP 15's, not this stage's.
- **docs/serum/.** The engine's design and reference notes: the DSP they describe stays. docs/canvas/IMPL-* stay as history. The
  living docs (ROADMAP, HANDOVER, SUMMARY) say Serum is gone from canvas (the lead, after deploy). CLAUDE.md is the user's file: its
  description line ("a full Serum 2 recreation") is true of `main`, so the lead proposes "(the live app; not canvas)" to the user
  rather than editing it.

---------------------------------------------------------------------------------------------------------------------------------

## 2. Old projects (phase 0) [C]

**A load pass inside schema 17: every Serum opens as a Wavecraft (§15 P1-1).**
- **Where.** `upgrade` (cv-migrate.js:180–189) runs `serumOut(p, notes)` after the STEPS loop, on every file that is not read-only, at
  any schema.
  - It is the identity when no device has `model: 'serum'`. It then returns its input, so `upgrade`'s "already at SCHEMA: a copy" and
    every "byte for byte" pin (master-mods-model:21–24, cv-migrate.test) hold.
  - When it converts, the changed tracks are copied (partsWhole's idiom); the input is untouched.
  - loadProject (main.js:300) is the one load path: file, autosave, classic project. Its notes reach the notice as `up.notes` do
    today (main.js:311).
- **What converts.** Every `{kind: 'synth', model: 'serum'}` device, on any track (a main file arrives through STEPS[2] first).
- **What it becomes.**
  - `model: RIG.ID`, `vals: {s: RC.adopt(s).s}`.
  - Its `fx`, `preset`, `name` and every row are kept.
  - No `rig` record: `normRig` defaults it.
  - Its `lay` entry loses any `ui`. The old part places (`iN/<part>`) stay, as the places of the Wavecraft's modules ("Make it a
    <NAME>"'s keepLay rule). The modules with no place get the canvas's placement for an unplaced module [R?: phase 0 pins it in
    G2; they may overlap: Tidy]. A Serum shown whole had no part places, so this is the common case (§15 P3-1).
  - **Default names (§15 P2-6).** setTrackModel's rule (main.js:2596): a track or device name that is the old default, "Serum" or
    "Serum <n>", becomes "<NAME> <n>". Any other name is the user's text.
- **One note per device.** "“<track>”: its wavetable synth opens as a <NAME> — the same sound", with adopt's notes appended. When
  that state had MPE on, `RC.WORDS.mpeLater` is added too.
- **`SCHEMA` stays 17.** Why no bump:
  - A converted device is schema-17 data: `model: 'rig'` exists since 16, and nothing new is stored. A schema-17 build (an
    un-updated tab) opens it fully, so a bump would only make that tab read-only for no data reason.
  - Every bump in STEPS guards an older build that would misread or drop something. Nothing here can be misread.
  - The installed iPad app is schema 14 (96409fa). It already opens every browser-saved project read-only, bump or not (§11.1).
  - Loads already normalise in place without a step: `adopt` / `normDevs` (main.js:326–327) and `fxLoad` (:292).
  - The pins stay: cv-migrate.test:32 / :1056, master-mods-model:21–22, canvas-M-sim, canvas-9b-sim.
- **Sound.** By S1: the compiled patch is unchanged, because adopt is the identity on every known state (§0) and W2 makes a rig
  holding S sound as a Serum holding S. **The proof is the existing frozen refs.** Every test that loads tests/ref-p1/project-p1.json
  through the app now plays its two Serums as Wavecrafts and must stay exact:
  - ref-M bounce-hashes, ref-MM live-p1-mm.sha, ref-SC live-p1.sha;
  - canonical-stream's stream-main.json (recorded from main: never re-recorded);
  - canvas-M-bounce, MM-live / -session, SC-live, appstore.
- **STEPS[15]'s notes go.** Its lay change stays: a schema-15 file meets the pass next, whose note covers it.
- **The words.** No "Serum" in any note. The device is "its wavetable synth".

**Save as classic project.**
- `toV1` keeps rig → `model: 'serum'` (main's id; S2).
- Its notes are re-worded without the name. "<NAME> is saved as the classic site's wavetable synth (same sound)". cv-migrate.js:338's
  "after the Serum" becomes the same idea.

**Stored preferences ("no care").**
- `synth.cv.trayLayout = 'serum'` opens Hardware (the existing rule).
- `settings.model = 'serum'` falls back to `MODELS[1]` (main.js:125).
- `synth.sx.default` is no longer read.
- `synth.user.serum` stays (program change; WC-2).

---------------------------------------------------------------------------------------------------------------------------------

## 3. The Wavecraft without serum-ui.js (lane D, commit D1) [C]

- **Loading.** `uiMods` loads `./sx-host.js` in serum-ui.js's place (`M.host`). sx-host.js is already precached: sx-ui-mod.js imports
  it statically and cv-mods-ui.js:368 lazily.
- **The host.** renderCustom builds a rig's host as `M.host.createHost(sxHost(t, dev), {doc})`. `rec.mode` is `'parts'`. The bundled
  branch, the `isSerumModel` test and the "Loading the … panel" model words go.
- **sxViews.** `want` is `'parts'` for a rig (`sxParts`), with no `dropShell` / `buildShell` test. Every other Serum-engine device is
  gone, and a non-rig `isSxDev` cannot exist after §2.
- **programChange** reads `M.host.browserList` / `M.host.BROWSER_KEY`.
- **`SXM` (§15 P1-2)** = `MODELS.find(m => m.id === RIG.ID)` (main.js:3628). It has the same presets and the same map, so the
  preview's patch (:4061) is unchanged.
- **The guard (§15 P2-9).** setTrackModel, addTrack and the drop paths refuse an id that is not in `MODELS`: nothing changes, no
  step. Today `modelById` falls back to MODELS[1] while `CMOD.setModel` would store the unknown id on the device.
- **The stand-in path goes in D1 (§15 P1-3).** That is main.js's `RIGUI === false` branches (:7118, :7205, :8049–8050, :8717), `SXW`,
  and the hook's `widths / setModule`. With no rig-ui loaded (a test loader), `sxViews` mounts nothing and throws nothing. In the
  same commit:
  - canvas-3-sim and canvas-del-sim load `rig: RU`, as canvas-WC-sim / MOD1-sim do. canvas-3's 25 cases each get a §14 row: re-pointed
    onto the faces, already pinned by canvas-WC-sim (named), or removed with the stand-ins.
  - canvas-FR-sim's stub becomes `host: { createHost: (h, o) => new SxStub(h) }`. Its `el` is no longer appended to a box, because the
    record's box is VOICE's: the amp face. Only its loader and the stub's constructor change. Its cases (G7) stay byte for byte.
    [R?] Its monitor's `live` reads `cvLive(dev)` in both modes for a host without `anyShown` (main.js:3470), so the watched ids
    should not move. D1 runs it, and a differing case goes to §14 for the lead; it is never edited to pass.
  - cv-shell-sim gets `host: { createHost: () => ({ refresh() {}, destroy() {} }) }`.
  - canvas-MM-sim's loader changes shape only (no rig track).
- **Parity.** A rig's faces mount on a `SerumHost` exactly as on SerumUI's parts host: the shell fields were never read (§0). G6
  proves it: the rig's faces' DOM, boxes and element counts equal ⟨B⟩'s (ui-layout-wc, rig-ui.test, canvas-WC-sim).
- **The SerumUI-only surface (the skeptic's inventory, §15 P2-10).**
  - **SerumUI-only members.**
    - Fields: `root`, `footPage` and shellReset's set (serum-ui.js:62–76).
    - Methods: `dropHeadKit`, `dropShell`, `buildShell`, `get bundled`, and everything from `buildHead` to `chaosPanel`.
    - Overrides that equal the host's own in parts mode: `allPages`, `shownPages`, `rackShown`, `destroyShell`, `toggleExpand`.
  - **Readers outside serum-ui.js.**
    - main.js:4344 (`rec.ui.bundled`), :8067 / :8069 (`H.dropShell`), :8073 (`H.buildShell`). All are rewritten here.
    - `SerumHost.pagesNow` reads `this.page` (sx-host.js:2720): '' under SerumUI, undefined here. The first call is a change either
      way (`M.all === null`), so nothing differs.
    - `vcEl` / `vcText` / `statusEl` are set only by VoiceHeader / VoicePanel (deleted). Every read is guarded, and a rig never had them.
  - **Already the host's.** These need no change:
    - every `rec.ui.*` main.js reads: `refresh`, `paintMods`, `fastReset`, `fr`, `dead`, `setFast`, `reshow`, `fastLive`, `fastIx`,
      `edit`, `anyShown`, `addModUI`, `snap`, `setSnapshot`, `confirmChange`, `el`;
    - the Cut B seam (`tickOn` / `tickLive` / `fastTick` / `heavyHz`, `sl`);
    - the slot hosts (`slotHost`, cv-mods-ui.js:368 / :394) and `bodyAns` / `bodyReset` (main.js:3259–3261): never SerumUI;
    - the FX racks: fx-ui `FXRackUI`, never SerumUI's `rack`;
    - rig-ui: it mounts through `H.mount(fn, …)` with the donor classes, never a registered view kind.
  - **Tests that read the surface.** Each moves in D1:
    - canvas-3-sim :113 / :132 / :138 (`bundled`);
    - m3-fixture :47 / :154, ui-layout-wc.mjs :52 / :73–74, ui-bench-m3.mjs (`SerumUI`);
    - accessors :103 / :285, canvas-2a-sim :17 (re-exports);
    - the stubs of canvas-FR-sim and cv-shell-sim (`SerumUI(box, host)`).
- **Tests.** Every sim's injected `uiLoad` shape changes from `{sx: …}` to `{host: …}` (canvas-3 / WC / MM / del / MOD1 / FR-sim,
  cv-shell-sim, accessors). accessors / canvas-2a-sim import `browserList`, `BROWSER_KEY` and `dropRow` from sx-host.js.
- **Deletion.** D1 deletes serum-ui.js and the test infrastructure only serum-ui.test used:
  - tests/serum-ui-stubs/hooks-ui.mjs and its stand-ins sx-ui-osc.js / sx-ui-mix.js / sx-ui-seq.js;
  - serum-ui.hooks.mjs's `redirectUI` / `UI_NAMES` / `resolveUI`.

  The other stubs and `redirect` / `resolve` stay: rig-ui.test, cv-mods-ui.test and sx-host.test use them.
- **serum-ui.test.mjs splits (S6).**
  - Its pure-helper cases (:117–502, :3219–3253: `haloArcs`, `knobMenuItems`, `dropRow`, `busMenuItems`, `captureDue`, `clipModule`
    …, `undoStack`, `virtGet`, `s1Diff`, `sortPresets` … `browserList`, `withMeta`, …) test sx-host.js code the Wavecraft runs. They
    **move unchanged** to tests/sx-helpers.test.mjs (new; `v8-guard` first; imports from sx-host.js). They move **with their
    harness**: the safe-assert Proxy and the `redirect` hooks, as sx-host.test registers them (sx-host.js imports graph.js / wt.js /
    wtedit.js), not with one changed line (§15 P3-5). serum-ui.test has 64 cases. 17 of the helper cases sit in :117–502; none of
    them touches a stub or SerumUI.
  - Its `SerumUI` cases go only where the code they test goes: the header, the pages, MATRIX, GLOBAL, the main menu, the browser
    opened from the header, the bundled shell, render-last.
  - A case that exercised a kit / host behaviour the Wavecraft still has is **re-pointed** onto a `createHost` with a rig face:
    touch `settled()`, two-finger rollback, hidden canvases neither drawn nor measured, the FR B3 rate class, locks, panel undo.
  - The per-case table (case → removed with X / re-pointed to Y / already pinned by Z) is D's in §14, and reviewer 1 checks it.

---------------------------------------------------------------------------------------------------------------------------------

## 4. The kit after (lane K, from D1) [C]

- **sx-ui-mod.js.** Delete `mountSlot`, `partView`, `PART_W`, `PART_PH`, `COL`, `phaseOf`, `VoicePanel`, `VoiceHeader`, `MpePanel`,
  and every `defineView` but `arp` / `clip` (Q1's first guess).
  - **`mountPart(host, part, root, args)` stays** for `part` 'arp' | 'clip' only: `bare`, their fixed width (1184 [R?]), `shown`,
    `dev`. Any other part returns null.
  - **The interface D codes against:** no `PART_W` export; `mountPart` arp / clip only.
  - If Q1 is answered "hide them", `mountPart` and both registrations go and sx-ui-seq's `ArpPage` / `ClipPage` with them.
- **sx-host.js.** Delete the shell-only members of §1.3's bounded list, proved by a grep table in §14. These stay:
  - **the Cut B seam** (IMPL-MOD1 §7: the slot host's ring path `H.live`, `tickOn` / `tickLive` / `fastTick` / `fastLive` /
    `fastReset`, `heavyMs` / `rateMs` / `capMs`, `heavyHz`): not one line;
  - `PresetBrowser` and the host's preset plumbing (WC-2; built by `mount` today);
  - `PAGES` while `initPreset` / `s.ui.page` read it.

  `BUILD`'s fallback 'Serum v2 panel …' (:101) is re-worded. The rig supplies `words.build`, so the fallback is never shown. The
  shell CSS comments (:980, :1098) go.
- **sx-ui-mix.js** keeps `MixerPage` as `OutputsPanel`'s base and the shared strips, and drops the MIX page's own build. The dormant
  `V1_NOTE` / `V1_MAIN` words go: every host sets `v2Fx`.
- **sx-ui-seq.js** loses `KeyboardPanel` / `OscMapEditor` if no caller remains after `VoicePanel` and serum-ui.
- **sx-edges.js** re-words `WHY.voice` / `.fx` / `.note` / `.notes` / `.bad` and `LABEL.voice` / `.fx` neutrally. rig-core's WORDS
  already override them on a rig.
- **The parity gates lose their reference panels, so the reference is frozen first.** **Phase 0** records the stage-3 views'
  `data-dest` sets per kind (osc / sub / noise / filter / env / lfo / macros / voicing / chaos / curve) from the pristine ⟨B⟩, with
  ref-SX0, into tests/fixtures/sx0-dests.json, frozen (§15 P3-2). rig-ui.test's `both()`, ui-layout-wc G5 and m3-fixture's body half
  then compare the faces against it: the same check, without the deleted code (S6).
- **sx-host.test's** 25 `mountPart` sites mount through `X.mount(kind, …)` with the donor classes. The `PART_W` / `PART_PH` / part
  CSS cases (:73–88, :850–903) go with what they pin.
- **m3-fixture's** parts half (:214–392). Each case has three legs: the bundled MIX page, the stage-3 part views, and sx-edges
  `setEdge` / `cutEdge` through a host against the direct state write, rendered (§15 P2-4). The first two legs go. The third is the
  Wavecraft's own cord path, so it stays: on a `createHost` with no views, rendered as today. :214's part mount and N2 (:546,
  bundled ↔ parts) go with what they test.

---------------------------------------------------------------------------------------------------------------------------------

## 5. Words (S3)

**Re-worded, reachable from the survivors.** The first 23 rows and the manifest come from the scan's class (b); the last row adds
the export file names.

| where [R] | today | → (the lane's wording; through `RIG.NAME` where it names the synth) |
|---|---|---|
| main.js:1722 | CPU readout " · Serum 96 kHz" | " · <NAME> 96 kHz" |
| main.js:1840, :1845 | "Serum oversampling capped…", "Serum quality step…" | "<NAME> oversampling / quality" |
| models.js:896, :897 | the rig's tag / about: "the Serum engine underneath", "Serum's parts", "as Serum holding it" | our own words (a wavetable engine) |
| cv-tray.js:592 | `TO_MODS`: "… Serum: the Serum view" | the Modulators sentence only |
| cv-migrate.js:312, :338 | "saved as a Serum", "after the Serum" | §2 |
| fx-ui.js:241, :996, :2777, :2830, :2846, :2857–2858 | "Serum 1 variant / module", "the Serum 2 FX rack", "(no Serum state)", "Convert to Serum 2 Module", … | "the older (v1) …" / "Convert to the current module" |
| sx-ui-mix.js:97–98 | `V1_NOTE` / `V1_MAIN` (dormant) | go (K) |
| cv-model.js:397, cv-modlayer.js:76, :228, cv-mods.js:554, cv-cost.js:262 | the fallback name 'Serum' / 'This Serum' | the device's name, else `RIG.NAME` |
| wt.js:1241 | exported wavetable WAVs' `clm ` chunk: "… wavetable (www.xferrecords.com)" | "… wavetable (SYNTH)". Readers parse only `<!>size` + the two digits (`CLM_RE` :1231; other synths write their own URL there); wt.test.mjs:472 / :500 move |
| manifest.webmanifest:5 | "a Serum-style wavetable synth" | "a modular wavetable synth" |
| main.js:3731, :3738 | export file names `.serum.json`, `.serum-pack.json` | `.preset.json`, `.preset-pack.json` (import accepts both by type id) |

**Removed with the code.** The 16 class-(a) lines:
- cv-art:727, cv-graph:224's Serum branch, cv-migrate:205, cv-model:335's `was === 'serum'` branch;
- cv-tray:596, main:6520, :7242's Serum branch, models:705;
- serum-ui:468, sx-host:4048–4049 (`about`), sx-host:101, sx-edges:51 / :53, sx-ui-mod:689, sx-ui-osc:2972 (fallbacks the rig
  overrides, re-worded or gone).

**Not user-visible.** These are allowed in the gate, with the reason the test checks:
- serum-dsp.js:1729, :2621 (console text), mod-core.js:136 (a thrown internal Error), sx-mod.js:726 (console.warn). These are DSP
  files, which S1 freezes.
- wk.js:3529 'SerumDSP': the worklet global's name.

Everything else in class (c) is re-worded anyway, because it is cheap: main.js:3011, :3997, rig-ui.js:681, cv-cost.js:93.

**Out of scope.** These are not "Serum words" and are not renamed here:
- the Serum-derived effect and parameter names: IMPL-WC §14 "Names to choose", the user's list before any sale;
- "Chaos" (IMPL-MOD1 Q answer 1);
- the tests/*.html developer pages (bench.html, ui-bench.html): not the app.

---------------------------------------------------------------------------------------------------------------------------------

## 6. Tests and frozen refs (phase 0, 0b; S1, S6)

### 6.1 The rules
- **Re-point first, while Serum still exists.** Phase 0 and 0b re-point every test that uses 'serum' only as "a Serum-engine
  instrument" to `RIG.ID`. They do it on ⟨B⟩'s tree, where `serum` is still a model, so a green sweep with every frozen ref exact
  proves each re-point byte-identical before anything is deleted. A re-point keeps its assertion's meaning. If a case depends on
  `defaultSerum` rather than `rigStarter` (a heavy-Serum estimate, a default-state pin), it passes explicit `vals`. If it cannot keep
  its meaning, the case goes to §14 for the lead, never silently.
- **Remove only with the code.** A file or case is removed only when the code it tests is deleted (§1). When a behaviour survives
  elsewhere, the case moves or is re-pointed (§3, §4). The per-file / per-case tables are each lane's §14 notes. Reviewer 1 checks
  every row.
- **Not re-pointable: leave for D (§15 P1-5).** 0b leaves these alone:
  - The MPE cases: accessors.test:267 (R2), canvas-R-sim:641 (R-15), main.test:241. They route MPE through midi.js, which keys on
    main's `'serum'` and stays byte-identical. On a rig they fail, and "fixing" them would weaken them.
    - D removes each when `serum` leaves `MODELS`, with the reason "MPE input on canvas leaves with Serum complete (§11.3)".
    - A case that still means something without MPE routing (the R-15 voice end on a plain channel) is re-pointed instead, said in §14.
  - midi.test: its `'serum'` objects (:34, :71, :251) are plain records that test midi.js's own literal. It is not touched at all.

### 6.2 The goldens and frozen refs [C]
- **golden-presets / -random / -graph (+ m3-fixture :93, rig-sound :91).**
  - tests/golden-harness.mjs `trackPatch` (:116) maps 'serum' → `RIG.ID` **whenever side X's `MODELS` has the rig** (§15 P2-2). That
    is side B and golden-graph's sides. Mapping only when serum is absent would never run on ⟨B⟩, so phase 0's green sweep would
    prove nothing.
  - Side A, tests/ref-p1's frozen models.js, keeps 'serum'.
  - The patches are equal, so the renders are byte-identical. No caller is edited.
  - golden-presets' p1-project checks read 'serum' from the file's own data: unchanged. ref-p1 / ref-1c are untouched.
  - golden-classic and -fx filter `!custom`: unchanged.
- **The fixtures.** tests/fixtures/graph-1e.mjs:24, mods-2a.mjs:20, mods-2b.mjs:25 build `model: RIG.ID`. graph-1e.mjs:52's
  `model === 'serum'` becomes `isSxId`, which keeps `osCap`.
- **tests/ref-WC (base.json must not change).**
  - record.mjs builds its 94 Serum fixtures as rigs: 86 `serum:<preset>` (:62–68), `1e:b`, `2a:0–2` and `2b:0–3`.
  - The `mods`, `cables`, `destOk` and `messages` columns hash the same by construction: all of them key on `isSxId`, and no id is
    echoed.
  - The `track` and `graph` columns echo the device's model id (cv-graph `v1.model`, `patches[].model`). For those 94 keys alone,
    record.mjs hashes them with that one field (a synth device's, a v1's or a patch's `model` equal to `RIG.ID`) written back as
    'serum'. The claim is "the output equals the base output with the input's id renamed", which is stronger than deleting the keys.
    A test pins that the rename is the only transform.
  - **G12 sessions** `serum` (:142) and `fade` (:150) become rig tracks and stay exact. **[R] (the skeptic's probe at ⟨B⟩)** The probe
    took a scratch copy of record.mjs and made three changes:
    - every `'serum'` device renamed to `'rig'` before hashing;
    - `model: 'rig'` written back as 'serum' in the `track` and `graph` hashes (both are needed: without the graph write-back, all 94
      graph hashes differ);
    - the rigs' patch messages given graph-1e's `osCap`.

    base.json matched exactly: 114 fixtures, 5 sessions. With `osCap` left out, the only differences are the 94 `messages` hashes, which
    is why graph-1e.mjs:52 becomes `isSxId`. **No key may be deleted from base.json** (§15 P2-3).
- **canonical-stream** (stream-main.json, recorded from main: never re-recorded):
  - project-p1's Serums now load as rigs (§2);
  - :83 reads `RIG.ID`'s presets (the same list);
  - :95's classic → Serum step becomes `setTrackModel(…, RIG.ID, {keepLay: true, vals: {s: <the default Serum with the prefs>}})`, so
    the same Serum-engine patch is posted. **`keepLay: true` is required (§15 P2-1):** without it, setTrackModel ignores `o.vals` and
    loads the rig's starter (main.js:2600–2601).
  - The script stays runnable from main's tree, for the documented `STREAM_REC` path. It takes `'serum'` (and `defaults(prefs)`) when
    the root's `MODELS` has it, else the rig with that call. It never imports rig-core.js by a fixed path (main has none).

  Must be exact, and this is proven at phase 0 on ⟨B⟩. There the pass already converts p1's two Serums and both models still exist.
  If the rig's path posts anything more, the lead decides with the diff while Serum still exists. It is never re-recorded.
- **New frozen ref tests/ref-SX0/** (phase 0; recorded **once from the pristine ⟨B⟩ before any edit**, record.mjs `--write`, the
  ref-WC protocol). It holds the sha256 of `patchFor('serum', …)` for:
  - every factory preset;
  - `defaultSerum`;
  - the three smpgen farm jobs' patches;
  - cv-cost's measure patch.

  project-p1's patches after load are not in it (§15 P3-4): that would need an app boot, and ref-M / ref-MM / ref-SC /
  canonical-stream already pin them. tests/sx0-model.test.mjs (new) compares `patchFor(RIG.ID, …)` against the hashes from phase 0
  on, so it proves the rig on ⟨B⟩ too. This covers the 38 v2 presets, which golden-presets (48 v1) does not A/B.
- **tests/fixtures/sx0-dests.json** (phase 0, from the same pristine tree): §4's frozen `data-dest` sets.

### 6.3 Removed with the code
These are the X files and cases. Each lane's §14 gives the detail.
- tests/serum-ui.test.mjs: split, §3. tests/serum-ui-stubs/hooks-ui.mjs and the three stand-ins.
- tests/ui-bench-m3.mjs and tests/ui-bench.html's `?m3=1` route. The `ui-m3*` rows in bench.json stay as history.
- tests/ui-bench-fps.mjs's `serum` scene and its .test pins. bench.json's `*/serum/*` cells stay as history.
- **Serum-only cases:**
  - rig-model.test: `serum.defaults`, the `MODELS` list pins, the `isSerumModel` / SRC_VIEWS 'serum' pins;
  - mod1-model.test: :62–63;
  - canvas-1e: the "About the Serum…" menu and the tile cost;
  - canvas-3: the boot Serum's whole panel, a new Serum opening whole. Every other canvas-3 case gets its row in D1's triage (§3);
  - canvas-WC: the first drop on a Serum, "Make it a <NAME>", the Serum `words === null` cases. The schema-15 parts-shown case becomes
    the load-pass case;
  - the MPE cases of §6.1 (accessors R2, canvas-R R-15, main.test :241), with that reason;
  - canvas-sim: `cv.size('serum')`, the Serum view;
  - cv-art: 'Serum (complete)', `art('serum')`;
  - cv-module: `W_SERUM`, `sizeFor('serum')`, the Serum parts Tidy;
  - cv-tray: the Serum tile and view;
  - cv-shell-sim: the stored 'serum' view, the "+" menu's Serum;
  - cv-migrate: STEPS[15]'s notes, the parts flags;
  - pwa.test: serum-ui.js in its lists.
- sx-host.test: `PART_W` / `PART_PH` / part CSS (§4). m3-fixture: the MIX-page and part-view legs, :214, N2 (§4).
- **Not removed:** the render-last cases (graph-host :251 / :525 / :538, canvas-M-sim :596, canvas-SC-sim :437, app-shell :399,
  accessors :151–154, main.test :61 / :193–215). renderLast stays (§1), so 0b re-points them like any other.

---------------------------------------------------------------------------------------------------------------------------------

## 7. Precache, bundle, service worker

**Before (⟨B⟩).** 9,854,055 B in 119 entries (§0).

**After.**
- `node tools/precache.mjs --write` (the crawl from main.js drops serum-ui.js) gives a new `BUILD`.
- **Gate: total ≤ 9,805,169 B** (⟨B⟩ − serum-ui.js). The lead records the measured total in §14 with K's and D's shrink.
- pwa.test's lists follow sw.js. `?v=9` stays: canvas never bumps, and BUILD carries the update.
- **The iPad bundle** is the same list (tools/app-bundle.sh refuses a dirty tree). It shrinks on its next build. Under browser-first
  that is the next major update, not this stage.

**The deploy.** It publishes the whole tree, so tests/ and docs/ ship as before. After the stage none of the app's files holds a
Serum word (§5). docs/serum/ stays as the engine's notes (§1). It is public on main and in history anyway.

---------------------------------------------------------------------------------------------------------------------------------

## 8. Gates

| gate | what | target |
|---|---|---|
| **G1 sound (S1)** | `git diff --stat 3db44a8..HEAD -- engine.js <DSP_FILES> serum-core.js` empty (reviewer 1 and the lead before the squash). Every golden (classic / fx / presets / random / graph, 606 / 909 / drums / sdsv, moog ×3) and frozen ref (p1, 1c, 7a–7d, 9 / 9-core / 9b / 9c, M, MM, SC, P, **WC** via `node --max-old-space-size=2048 tests/ref-WC/record.mjs`, the new **SX0**) in the sweep, with master-proc, engine-track, canonical-stream, canvas-M-bounce, fast-lane, tempo-mods. smpgen's farm samples byte-identical | exact |
| **G2 old projects (§2)** | The sim (`bootMain`, the app's load path) opens: a schema-17 project with a Serum (own FX, a preset name, a track named "Serum 2", canvas modulators on its knobs, a link row from its part `iN/lfo3.out`, MPE on, an ARP on); a schema-15 file with a Serum shown as parts; a 1e file whose track held a Serum beside a Juno (split first); main's project-p1.json; the autosave in IndexedDB holding a Serum. Each opens with no throw and no console error, and saves as schema 17. Each Serum is a `RIG.ID` device with `vals.s` equal to adopt's output (= the input on these). The one note has no "Serum" (the track is "<NAME> 2"). Its modules mount; where they stand is recorded (§2 [R?]). The engine gets the same patch (ref-SX0 hashes). A file with no Serum comes out of `upgrade` exactly as at ⟨B⟩. Reviewer 1 renders each through the real engine: finite and not silent; project-p1 is exact (G1) | pass |
| **G3 removal** | No 'serum' model; `#serum` boots the default; + Track, Replace with… and the tray hold no Serum; `setTrackModel(…, 'serum')` and `addTrack` of an unknown id are refused (the §3 guard: nothing changes, no step). Program change and the preset preview read `SXM` = the rig. Save as classic project writes a Wavecraft as `model: 'serum'`, with the new words. MIDI program change on a Wavecraft still loads a factory preset (sxLoad). A rig's host is a `createHost`; `rec.mode` 'parts'. An Arp / Clip on a rig still mounts (Q1). No file imports serum-ui.js | exact |
| **G4 words (S3)** | **Static** (tests/sx0-words.test.mjs, new, the lead at integration): every file of the precache list, index.html and manifest. Comments are stripped. In every string / template / regex literal, HTML text or attribute, and CSS `content`: no "Serum" (case-sensitive), no "Xfer", no "xferrecords", no `/\.serum(-pack)?\.json/` file name. The kept type ids 'synth.serum.preset' / 'synth.serum.pack' and the store keys are identifiers (§1), so the pattern must not hit them (§15 P2-5). The allow-list of §5 is checked by pattern (console / throw / the global's name in a DSP file or wk.js). **Dynamic** (reviewer 2): a DOM scan of every tray view, every instrument's and module's ⋯ menu, a Wavecraft's faces, drawer and dialogs (Preferences / Info), the racks' menus and tooltips, the master, the load notice of an old project, the CPU readout, the classic-project confirm, the update toast. `/Serum\|Xfer/i` in text, `title`, `aria-label`, `placeholder`. Text the user typed (a track, device or preset name other than a default) is exempt and listed | 0 |
| **G5 dead code** | grep over the site files: no `SerumUI`, `isSerumModel`, `mountSlot`, `partView`, `PART_W`, `PART_PH`, `phaseOf`, `VoiceHeader`, `VoicePanel`, `MpePanel`, `W_SERUM`, `rigConvert`, `RIGUI === false`. `mountPart` is called from main.js only for 'arp' / 'clip' (Q1). `renderLast` stays (§1). The style.css rules of §1.4's Serum-only pair are gone if proven; MOD1's leftovers and cv-tray.test's pins on them stay | exact |
| **G6 the survivors (S4)** | ui-layout-wc.mjs in CfT at 1440 × 900, 1366 × 1024, 1024 × 1366: every rig face and modulator face's boxes and element counts equal ⟨B⟩'s; the `data-dest` sets equal sx0-dests.json; rig-ui.test, canvas-WC-sim, canvas-MOD1-sim, canvas-MM-sim, fx-ui.test green. tests/ui-bench-fps.mjs A/B against ⟨B⟩ on the `mods`, `tutorial`, `master` and `clip` scenes: ≤ +5 % frame cost (nothing should move) | within |
| **G7 the seams (S5)** | IMPL-MOD1 §7's tests unchanged and green (sx-host.test's slot-ring cases, canvas-FR-sim :349 / :389 / :430, canvas-MM-sim, motion, fast-lane). canvas-FR-sim's loader line and stub constructor change in D1 (§3); not one of its cases does. Reviewer 1 reads the diff: no line inside §7's functions | exact |
| **G8 precache / bundle** | sw.js regenerated; pwa.test, app-ios / app-native / app-shell tests green; total ≤ 9,805,169 B | within |
| **G9 the sweep** | every test file one at a time (2 GB each), after phase 0, after 0b, at integration | green |

---------------------------------------------------------------------------------------------------------------------------------

## 9. Lanes, order, models

| lane | base | owns (exclusive while it runs) | gates | model |
|---|---|---|---|---|
| **phase 0** (the lead) | ⟨B⟩ | tests/ref-SX0/ and tests/fixtures/sx0-dests.json (recorded **first**, from the untouched tree) + tests/sx0-model.test.mjs; tests/golden-harness.mjs (the mapping unconditional); tests/fixtures/graph-1e / mods-2a / mods-2b; tests/ref-WC/record.mjs (base.json untouched: the skeptic's probe already matched it, §6.2); cv-migrate.js (the load pass `serumOut`, SCHEMA stays 17, STEPS[15]'s notes out, toV1's words); cv-cost.js (:300, :262, :93); smpgen.js (farm jobs → `RIG.ID`); tests cv-migrate, cv-cost, smpgen, canonical-stream (`keepLay`, root-aware), and every project-p1-model pin that moves (the sims asserting trk_1 / trk_2 are `'serum'`). No schema pin moves | G1, G2's model half, G9 | **Opus 5.5** |
| **0b** re-points | phase 0 | every class-R test file and the R cases of the mixed ones (the map: assets, bench, bench-scenarios, engine-track, fast-lane, fx-denormal, inst-denormal, integration, modcore, presets, presets2, sidechain-dsp, jackrules, cv-graph-engine, cv-panel, classic-mod, cv-graph, cv-cables, cv-mods, cv-model, graph-host, cv-fixes-sim, the page sims booting `#serum` / `addTrack(Serum)` (accessors, app-midi-sim, app-shell, appstore, canvas-2a / 2b / FR / M / P / R / SC / del / MOD1 / MM, safeguard-sim, fps-determinism, main.test), serum-core.test :4173–4242, rig-sound's W2 case). **Not** midi.test, and not §6.1's MPE cases (they stay `'serum'` for D). The render-last cases are re-pointed like the rest. No site file | G9: green with every frozen ref exact | **Sonnet** (mechanical) |
| **D** the instrument out | 0b | models.js, main.js, cv-tray.js, cv-art.js, cv-module.js, index.html, style.css, manifest.webmanifest, serum-ui.js (deleted); tests: serum-ui.test (split → sx-helpers.test.mjs, new), serum-ui.hooks.mjs + the stubs of §3, rig-model, mod1-model, canvas-1e / 3 / del / WC / FR (loader + stub only) / MM (loader only) / sim, canvas-2a's import, every sim's `uiLoad` shape, accessors, canvas-R-sim (R-15 only), cv-art, cv-module, cv-tray, cv-shell-sim, main.test, pwa.test, ui-bench-fps(.test), ui-bench-m3.mjs (deleted), ui-bench.html; **at D1 only**: m3-fixture's and ui-layout-wc.mjs's serum-ui imports | G3, G5's half, G9 | **Opus 5.5** |
| **K** the kit | D1 | sx-ui-mod.js, sx-host.js, sx-ui-mix.js, sx-ui-seq.js, sx-ui-osc.js (:2972 only), sx-edges.js, rig-ui.js (:681; Q1's loader if it moves); tests: sx-host, sx-helpers (after D1), m3-fixture, rig-ui, cv-mods-ui (the G8 grep pin), ui-layout-wc.mjs, sx-ui-mix / -seq / -osc tests (reads tests/fixtures/sx0-dests.json from phase 0) | G5's half, G6, G7 | **Opus 5.5** |
| **W** words | 0b | fx-ui.js, cv-modlayer.js, cv-mods.js, cv-model.js, cv-graph.js (words only), wt.js (:1241); tests fx-ui, wt, cv-modlayer, cv-mods, cv-model, cv-graph (word pins only) | G4's static half for its files | **Sonnet** |
| integration (the lead) | D + K + W | the merges, `precache --write`, tests/sx0-words.test.mjs (G4 static), a Chrome smoke (a Wavecraft with an ARP on, a Juno with modulators, the master, an old project with a Serum) | G4, G8 | Opus 5.5 |
| reviewers × 2 | integration | (1) **real engine + sim**: S1, G1, G2 renders, G3, G5, G7, every §14 removal / re-point table (S6), the ref-WC rename. (2) **Chrome for Testing**: G4 dynamic, G6, the iPad sizes, an old project in IndexedDB opened in the browser, the classic-project confirm (downloads denied: the export through the hook, no file), the service-worker update from ⟨B⟩'s build (§11) | — | Opus 5.5 × 2 |
| fixers | — | the finding's files, failing test first | | Sonnet (one file) / Opus 5.5 (across files) |

**Order.**
1. Phase 0 from ⟨B⟩: ref-SX0 and sx0-dests.json recorded first; the sweep with every frozen ref exact.
2. **0b** from phase 0: the sweep.
3. **D ∥ W** from 0b, in worktrees reset to it.
4. D commits **D1** first. It holds:
   - the models (serum out, the rig owns its map, `SXM`, the guard);
   - the host re-point;
   - serum-ui.js and every importer of it;
   - the stand-in path and its sims (canvas-3 / del on rig-ui with canvas-3's triage, the FR / cv-shell stubs, every loader);
   - the MPE removals;
   - the tray view.

   After D1, no test outside K's files mounts a stage-3 view. **K** resets to D1 while D goes on (D2: the words, tray, art, sizes,
   the remaining tests). After D1, D does not touch K's files, and K does not touch D's.
5. Integration in the order D → K → W.
6. The two reviews, then the fixers, then the sweep.
7. Deploy: `tools/deploy-canvas.sh`, with the service worker active when checking.
8. ROADMAP / HANDOVER / SUMMARY. The user tries it.

**Rules.**
- `?v=9` on every import.
- New test files import `./v8-guard.mjs` first.
- Never pass fake-DOM nodes to `assert.*` (sx-helpers keeps serum-ui.test's safe wrapper).
- One test file at a time with `--max-old-space-size=2048`.
- No lane commits sw.js.
- Nothing in S1's list in any diff.
- Every user-visible Wavecraft word through `RIG.NAME`.
- Never check out or push `main`.

---------------------------------------------------------------------------------------------------------------------------------

## 10. Pins that change by design (and the ones that must not)

**Move by design.**
- **phase 0:** STEPS[15]'s notes (cv-migrate.test :1685–1710); toV1's words (:1728–1744); every sim that asserts project-p1's
  trk_1 / trk_2 are `model: 'serum'`; smpgen.test's job model ids (:64, :421, :586–589); cv-cost.test's 'serum' rows. **Not** `SCHEMA`
  / `STEPS.length` (no bump, §2).
- **0b:** the model id in each re-pointed file (`v1.model` / `patches[].model` in cv-graph.test :41, :53, :159, :178, :192); the
  `#rig` boots; the default-state pins that `rigStarter` changes (explicit `vals` where the meaning needs Serum's default).
- **D:** rig-model.test's `MODELS` pins (length 19 → 18, the id list, `isSxModel` / `isSerumModel` lists); cv-tray's views / tile
  pins and its `.cv-mw` / `.cv-mbar` CSS pins (:1063, :1066); cv-module's size pins; ui-bench-fps.test's `SCENE_IDS` (− 'serum')
  and the matrix test's scenes; pwa.test's lists; accessor-allow.json's `has` strings for the edited lines (lint N5); canvas-1e's
  "About the …" menu.
- **K:** sx-host.test's export list (:73–88); rig-ui.test's `both()` (against sx0-dests.json); ui-layout-wc's parity source;
  cv-mods-ui.test's G8 grep (now: no `mountSlot` anywhere, `mountPart` only for arp / clip).
- **W:** wt.test :472 / :500 (the `clm ` text); fx-ui.test's words.

**Must not change.**
- Every golden and frozen ref: **ref-WC/base.json included**, every key.
- `SCHEMA` 17, `STEPS`, and every "a 16 / 17 opens byte for byte" pin.
- stream-main.json / stream-master.json.
- bench.json (history).
- The Cut B tests (§8 G7).
- rig-sound's audio cases (re-pointed, exact).
- master-mods G2 / G3.
- app.test's worklet list.
- midi.js (byte-identical, IMPL-B).
- tests/ref-p1/* and ref-1c.

---------------------------------------------------------------------------------------------------------------------------------

## 11. Risks

1. **The iPad app.** It is built from 96409fa (stage B, 2026-10-24, `SCHEMA` 14), has its own storage, and keeps Serum complete until
   its next rebuild (browser first: a major update).
   - It has opened every browser-saved canvas project read-only ("saved by a newer SYNTH Canvas") since SC made schema 15. SX0 changes
     nothing there: no bump (§2).
   - Its free-team signature was due for renewal by ≈ 2026-10-31, and no reinstall is recorded since [R?]. On the iPad the user runs
     canvas in the browser, which takes SX0 through the update toast.
   - Its own projects, which may hold Serums, convert when opened in the browser (Save → Open), or in the app after its next rebuild.
   - The next app build takes the new precache list automatically (`tools/app-bundle.sh`); its smoke runs then. That build is Q3.
2. **The service worker.**
   - An open tab of ⟨B⟩'s build has its own versioned cache, so a lazy `import('./serum-ui.js?v=9')` there is served from that cache
     until the user reloads through the toast.
   - Reviewer 2 checks the edge where the old shell meets the new deploy. Start ⟨B⟩'s build, deploy locally, open a Wavecraft before
     reloading: no 404, then the update toast, then the new build.
   - Two tabs (§15 P3-6): one accepts the update. The new worker activates, deletes the old caches and claims the other tab. A later
     lazy `serum-ui.js?v=9` there misses and shows "Reload the page". In practice nothing is fetched: `uiMods` is in memory from the
     first FX rack. Reviewer 2 tries it once.
   - Verify with the service worker active (CLAUDE.md).
3. **The MIDI shim / MPE.** midi.js stays byte-identical and routes MPE only to `model === 'serum'` (:53–57). After §2 no device has
   that id, so MPE input on a former Serum is no longer MPE-routed. That is the same as every Wavecraft today (`RC.WORDS.mpeLater`).
   The note says so. MidiShim.js / Midi.swift do not change; `tools/midi-harness/run.sh` is not needed.
4. **Old saves.**
   - Modules without a place may overlap (Tidy).
   - The rig's I1 / I2 rules decide which modules show, and every powered part shows ("nothing hidden"), so a converted Serum can
     open with many modules (≈ SX_HEAVY: the existing notice).
   - A Serum's preset rows and link rows stay valid on a rig (`isSxId` compile).
   - An old project whose Serum was the source of canvas cables keeps them (the same jack ids).
   - The user said no care, but G2 makes sure these files open.
5. **The host swap.** SerumUI's parts host becomes a plain `SerumHost`. By analysis nothing differs, and G6 proves it on the faces.
   The skeptic's inventory (§3) found four site readers, all in main.js and all rewritten. D re-runs the grep at D1 and puts it in
   §14.
6. **Weakening by deletion.** 64 cases in serum-ui.test, 25 `mountPart` sites in sx-host.test and canvas-3-sim's 25 cases are affected. The per-case
   tables and the frozen data-dest sets (§3, §4) are the guard, and reviewer 1 checks them.
7. **ref-WC's rename.** The rename could hide a real difference if it went beyond `model`. The test pins it to that one field on
   synth devices, v1 and patches, and reviewer 1 re-derives one fixture by hand. The skeptic's probe at ⟨B⟩ matched base.json with
   exactly this rename (§6.2).
8. **canonical-stream.** If the rig's model-change path posts more than main's classic → Serum step, the fixture cannot be matched.
   It is never re-recorded from canvas code. `keepLay: true` is required (§6.2). Phase 0 runs it on ⟨B⟩, where both models exist,
   so any diff is seen before anything is deleted.
9. **The Cut B seam inside sx-host.js.** K deletes in a 5,252-line file that holds the slot hosts' ring path. G7, and reviewer 1
   reads the diff.

---------------------------------------------------------------------------------------------------------------------------------

## 12. Questions for the user (short; the build follows the first guess until answered)

- **Q1 The Arpeggiator and Clip sequencer on a Wavecraft.** A Wavecraft can't add them yet: the tray says "arrive in a later
  update". But when its sound already has one switched on (an old Serum project that opens as a Wavecraft, a sound loaded by MIDI
  program change), it shows that module with the old Serum-style panel, the last piece of it. Keep showing them like that until they
  get Wavecraft faces, or show nothing until then (the arpeggio still plays)? **First guess: keep them as they are** ("nothing should
  be hidden").
- **Q2 MPE controllers (the skeptic).** An MPE keyboard (per-note bend and pressure) only ever reached Serum complete on canvas. Once it
  is gone, an old sound with MPE on opens as a Wavecraft and plays as a normal keyboard sound until the Wavecraft learns MPE (a later
  update). Is that fine? **First guess: yes**: there is no MPE gear yet, and the old site keeps MPE.
- **Q3 The iPad app (the skeptic).** The app on the iPad dates from Oct 24, three stages back, and its free signing ran out around Oct 31.
  Rebuild and reinstall it with this stage (a cable session), or keep using canvas in the iPad's browser until the next big update?
  **First guess: the browser**, with a rebuild at the next major update. Old app projects open in the browser and convert there.

**The user's answers (2026-11-02):** Q1 "Keep showing them (Recommended)"; Q2 "yes fine i guess. i have no idea what an mpe is" (= the
first guess); Q3 "Use the browser (Recommended)". All three follow the first guesses.

(Settled here, not asked:
- an old Serum opens as a Wavecraft with the same sound (§2; the user: no care for saves, but it must open);
- "Save as classic project" keeps writing a Wavecraft as the old app's Serum (S2, the regret path);
- MIDI program change keeps loading the factory sounds into a Wavecraft;
- docs/serum/ stays as the engine's notes;
- the effect names wait for the user's naming list before any sale (IMPL-WC §14).)

---------------------------------------------------------------------------------------------------------------------------------

## 13. Known limits (recorded)

- **What a Wavecraft does not do that Serum complete did.** Some of these may come back in WC-2:
  - the MATRIX page (a 64-row table; rows are edited from the inspector and the cords);
  - the MIX page's per-source strips (the Amplifier's drawer keeps the outputs);
  - the GLOBAL page as a page (Quality, Tuning, Voice control and the curves are drawer dialogs; MPE "in a later update");
  - the main menu (Init Preset with locks, Resample ▸, the chain library from the header, vibrato / velocity quick-assign, Save as
    Default Preset);
  - the preset browser and strip (WC-2, IMPL-WC §3.7);
  - render-last from the header (its main.js plumbing stays for the tests: ROADMAP 15);
  - the bundled keyboard panel.
- **A former Serum** with MPE on is no longer MPE-routed (§11.3).
- **The Arp / Clip modules** keep the old look until they have faces (Q1).
- **Identifier and file names** with "serum" stay: they are not user-visible. Their rename is ROADMAP 15's.

---------------------------------------------------------------------------------------------------------------------------------

## 14. Notes (the builders fill in)

(Each lane fills in: built as written; [C] refined, with reasons; pins moved; the removal / re-point tables of §6.1 (case → removed
with X / re-pointed to Y / pinned by Z); the "no caller" grep tables of §1.3; anything found for the other lanes. The lead adds the
measured precache total, G6's A/B numbers and the deploy commit.)

**Phase 0 (2026-11-02; from b82067c = 3db44a8's sources + the glass skin; the records first, the failing tests next, then the code).**
- **Recorded first, from the untouched tree** (fe3da9e, before any code change):
  - tests/ref-SX0/base.json (record.mjs, the ref-WC protocol): 192 sha256 of `patchFor('serum', …)` — each factory preset as program
    change / sxLoad posts it (applyPreset + applyPresetFx, the host's live options) and as stored (normalizeSerum / normalizeFx at "odd"
    options: 44.1 kHz, 97 BPM, lowered quality caps, flipped preferences, a re-seed), the default plain / odd / with the GLOBAL
    preferences (applyPrefs; checked equal to serum.defaults at write), the 8 farm-loop patches (as smpgen + assets build them, and by
    id), cv-cost's row e (deviceRows). 184 distinct. record(RIG.ID) matches at ⟨B⟩ and after: tests/sx0-model.test.mjs.
  - tests/fixtures/sx0-dests.json (tests/ref-SX0/dests.mjs): the data-dest sets of every partView part (30: osc A–C, sub, noise,
    filters, env1–4, lfo1–10, macros, voicing, chaos1–2, velo / note curves, voice, arp, clip) on four consumers' states (rig-ui.test's
    rig(), its sample variant, ui-layout-wc's page, m3-fixture's base, each with its host object), plus the four slot panels
    (lfo / env / macro / chaos, ui-layout-wc's mount). A paint changed no set. The recorder runs only until K deletes the views.
- **Built as written**: cv-migrate `serumOut` (exported) run by `upgrade` after the steps at any schema, identity (the same object)
  without a Serum; STEPS[15]'s notes out (its lay change kept); toV1's words; SCHEMA 17. golden-harness maps 'serum' → `X.rig.ID`
  whenever side X has rig-core.js and its MODELS the rig (side B, golden-graph's). graph-1e / mods-2a / mods-2b build `RIG.ID`
  (graph-1e's osCap on `isSxId`). ref-WC/record.mjs: the 86 preset fixtures and both G12 sessions are rigs, `back()` writes the
  model back on the track / graph columns of the 94 rig fixtures — **base.json matches untouched** (114 fixtures, 5 sessions);
  sx0-model.test pins back() as the only transform (a synth device's, a v1's, a patch's `model`). cv-cost :93 / :262 / :300; smpgen's
  three loops.
- **[C] refined**:
  - The note: "— the same sound" only when adopt changed nothing; with adopt's notes it reads "“<track>”: its wavetable synth opens as a
    <NAME> · <the notes>" (rigConvert's nowA / nowAChanged rule: a switch turned on is not the same sound). A named device is quoted
    ("its wavetable synth “Bass”", partsWhole's idiom). mpeLater appended when the state has MPE on.
  - Names: the track rule is setTrackModel's exactly (the primary only, "<NAME> <position>"); a device's "Serum" / "Serum <n>" keeps its
    number ("<NAME>" / "<NAME> <n>": a device has no position). The pattern is built from the id ('serum' capitalised), so cv-migrate.js
    holds no Serum literal (G4).
  - canonical-stream takes the rig whenever the root's MODELS has it — ⟨B⟩ too — not "'serum' when MODELS has it" (§6.2's wording would
    never run the rig at phase 0: P2-2's reasoning); main's tree takes 'serum'. rig-core / serum-core are imported from the root only on
    that branch. **Exact on ⟨B⟩'s phase 0 with the rig path: nothing more is posted** (§11.8 settled).
  - smpgen: `SX_FARM = 'rig'` (exported), not an import of rig-core — smpgen is a leaf of the smp worker and rig-core would pull
    serum-core into it; smpgen.test pins `SX_FARM === RIG.ID`.
- **Pins moved** (phase 0's files): cv-migrate.test (p1's models through the pass; the 3 / 4 / 5 "nothing converted" pins now against
  `serumOut(p)`; STEPS[15]'s notes; toV1's words in WC and H8 — H8's device a rig now; 2a H3's lost list gains the three "saved as"
  lines: mods-2a is rigs), cv-cost.test (its Serum devices / ids → `RIG.ID`), smpgen.test (the farm model), canonical-stream.
  **Outside phase 0's list, forced by the fixture re-point** (one line each, isSxId for `=== 'serum'`): cv-graph.test :159 / :178,
  graph-host.test :128; lint's accessor-allow.json `has` for smpgen's `x.model !== SX_FARM`. **canvas-WC-sim's G5 case** (D's file in §9)
  became the load-pass case here: the pass changes what it loads, so it could not wait for D; D has nothing left to do on it.
- **G2 (model half)**: cv-migrate.test — serumOut (states, FX, preset, rows, part places, ui, names, notes, idempotent, input untouched),
  upgrade (no Serum: byte for byte; a 17 converts with no bump; p1 from schema 0; a newer file untouched), the converted preset Serum's
  `patchFor(RIG.ID)` = ref-SX0's stored hash, and a page case (bootMain: an IndexedDB autosave with Serums — MPE on, ARP on, own FX, a
  preset name, a canvas LFO row, a link row from i1/lfo3.out, shown as parts once, a "Serum 3" track, an AMP ENV switch off; then
  project-p1 and a 1e Juno + Serum file from Files: split, "Duo · <NAME>"): no throw, the one notice without "Serum", saved as 17, its
  node's first patch the Serum engine's. main-sim has no WebGL: a rig's cord layer logs "cv-cords: shader failed" (console.error) and
  falls back — the page case filters exactly that line.
- **Where a converted Serum's modules land (§2 [R?], P3-1) — settled, no code**: main.js `sxPlaceNew` on the first render. No part place
  (a Serum shown whole: the common case) → Tidy's group (sxLayParts) at the instrument's place; old places (a schema-15 parts view) →
  kept, the others by sxSpot beside them. canvas-WC-sim checks both: every module the rig shows mounted and placed, none over another.
- **FR-sim's watched ids (§3 [R?])**: not probed — it needs 0b's `#rig` boot and D1's stub. By reading main.js:3470 the monitor's live
  test is `cvLive(dev)` in both modes for a host without `anyShown`, so the expectation stands.
- **Run** (one file at a time, 2 GB): sx0-model, cv-migrate, cv-cost, smpgen, canonical-stream, canvas-WC-sim, cv-graph, graph-host,
  canvas-2a / MOD1 / M / MM / 9b / 7a / P / 1e-sim, cv-shell-sim, mod1-model, rig-sound, m3-fixture, golden-classic / -fx / -presets /
  -random / -graph, canvas-M-bounce, canvas-MM-live / -session, canvas-SC-live (p1 through the app: exact), appstore, master-mods-model,
  main, accessors, app-shell, fx-denormal, cv-graph-engine, lint, pwa — green; tests/ref-WC/record.mjs and tests/ref-SX0/record.mjs
  match. sw.js BUILD 37fcc121592b (105 + 14 entries; no file added to the crawl).

**Lane 0b (2026-11-02; from 201c0d9; tests only, no site file).** A re-point changes the model a test builds (`RIG.ID`, `isSxId`, `isRigModel`,
`'#' + RIG.ID`), never an assertion, except where a case echoed the model id (then the expected id is `RIG.ID`). Each file below was run alone
(2 GB) green on this tree before its commit.
- **Re-pointed** (patchFor / device `model` / `addTrack` / `setTrackModel` / boot hash): assets, bench, bench-scenarios (consumers modcore,
  fast-lane, inst-denormal, engine-track, sidechain-dsp, bench, cv-cost, fx-dsp, master-proc, golden-moog / -sdsv re-run green), engine-track,
  fast-lane, fx-denormal, inst-denormal, integration, modcore, presets, presets2, sidechain-dsp, jackrules, cv-graph-engine, cv-panel (`usable`),
  classic-mod (`xferOf`), cv-graph (v1Tracks picks the rig once via `isRigModel`; shape / canonical tests via `isSxId`), cv-cables (the
  `presetRows` echo `'i2:' + RIG.ID`), cv-mods, cv-model, graph-host, cv-fixes-sim, app-midi-sim, app-shell, safeguard-sim, fps-determinism,
  canvas-M / P / SC / FR-sim (FR: boot `#rig` and `setTrackModel(RIG.ID)`; its loader and stub untouched, **all 15 cases pass unchanged on the
  rig**, §3's watched-ids [R?] settled), accessors, main.test, serum-core.test (the 2a injectMods block). The render-last cases ride along
  (graph-host :251 / :525, canvas-M :596, canvas-SC :437, app-shell :399, accessors :151, main.test :61 / :193): green on the rig.
- **Kept 'serum' on purpose** (D1 owns them):
  - main.test **:241 MPE** and, found beyond the contract's list, **RULINGS2 fix 2** (:264, MPE on / off through midi.js): both add their own
    `'serum'` track on the shared page (the boot is a rig now) and delete it at the end. accessors R2 MPE (:267–277) and canvas-R R-15 untouched.
  - main.test **:1090** (the Serum → rig conversion, W2 by hand): boots `#serum` and finds its Serum itself; on a rig it would compare a rig with
    itself. accessors' "every Serum" filter is `isSxId`, so the leftover MPE Serum is still counted.
  - midi.test untouched; appstore.test :36 and main.test :439 (`settings.model: 'serum'` inside main's p1 snapshot blob: data, no model built).
- **STOPPED, cannot pass unchanged on the rig (reverted to 'serum'; list for the lead / D1)**:
  - **canvas-2a-sim** (boot `#serum`, `fresh()`): 9 of 26 fail on a rig. The module set of a rig is `i1,i1/env1,i1/filter,i1/fx,i1/oscA,out`,
    not the Serum's `i1,i1/fx,out` (keys() pins), the rig's macro rows appear as `o:` cables, the ⋯ menu pins ("About the Serum…"), the
    Serum tray view (`setView('serum')`), and the replace notice reads "Wavecraft".
  - **canvas-2b-sim** (same boot): 15 of 23 fail (Serum's default LFO / ENV state, `f.cutoff` knob drags, the module set).
  - **canvas-del-sim**: boot `#rig` fails only the harness case (`keys()` = 'i1,i1/fx,out'); the other 10 pass. The boot is shared, so the file stays
    on `#serum` (D1 moves its loader and the boot together with the keys pin).
  - **cv-mods.test :272 "modulator ids, labels, sources"**: only that device stays 'serum' (the rest of the file is re-pointed). `linkSources`
    on a rig lists just the LFOs / Envelopes whose module stands on its canvas, labelled "LFO 1 · Lead" (3 sources), not the Serum's 14 "Lead LFO 1".
  - **rig-sound.test W2** (:84–95): an A/B of the rig against `patchFor('serum')` that no re-point can keep (both sides would be the rig; :91's
    render is already the rig through golden-harness' mapping). Untouched. Suggestion: pin the rig against `compileSerum` (serum-core stays whole)
    or ref-SX0's hashes when `serum` leaves `MODELS`.
- **Word pins D / W will meet** (no edit here): graph-host :259 `/Serum/` on renderLast's error (main.js :3997 is re-worded), accessors' rate-line
  `'Serum ' + kHz…` (main.js rateText), cv-cables :422 / :431 refusal text, cv-model.js :335's "the Serum" notice.

**Lane D, commit D1 (2026-11-02; from fe47fef = 0b).** Built as §3 says; the [C] refinements, then the per-file case tables (reviewer 1).
- **Site.**
  - models.js: `serum` out of `MODELS` (18 models; dx7 → tr808 one index lower: no site code reads them), `isSerumModel` out; the rig's own
    `map` (the very `compileSerum` call the bundled entry made) and `presets: FACTORY_PRESETS`. **[C] `isSxId` keeps `'serum'`** (main's id):
    cv-migrate's STEPS run before `serumOut` and read the engine by id — `trackToV2` keeps a v1 Serum's FX inside (`isSxId(t.model)`); without
    it project-p1's two Serums would be migrated as classics (an fx1 panel) before the pass converts them. No MODELS entry has the id.
  - main.js: `uiMods` loads sx-host.js as `M.host` (`{host, fxui, wk, mod, rig}`); renderCustom builds `M.host.createHost(sxHost(t, dev), {doc})`
    (the doc rule SerumUI's: the box's document, else the page's — **[C]** not `document` alone: the sims' boot boxes predate their DOM fix, and
    with the page's document their faces' stub elements reach wk's clock, which main.test's sims cannot answer), `rec.mode = 'parts'`, "Loading…"
    for the model words; `sxViews` with no bundled branch — a face per kind, `SXMOD.mountPart` for `arp` / `clip` only (Q1), nothing without
    rig-ui; programChange `M.host.browserList` / `BROWSER_KEY`; `SXM` = the rig; the guard (`knownModel`) in setTrackModel (returns null),
    addTrack (an id or a MODELS object: **[C]** it now takes an id too, so "addTrack of an unknown id" has a meaning), srcPick and srcDrag.drop
    (cvDropInstrument / cvAddInstrument / the hashchange already looked the id up); the `RIGUI === false` branches (:7118, :7201 edges, :7205,
    sxPartW / sxPartH, rigWm), `SXW`, the hook's `widths / setModule`, `sxDefault` / `newFx`'s default preset (a rig never read it), the Serum
    ⋯ branch with "Make it a <NAME>", `rigConvert` and the hook's `convert`, srcModeUI's 'Serum' word. **[C] `cv.mod.hintReset()`** (a hook:
    the 24+ hint's session flag) — canvas-2a's H8 now says the hint first (a rig draws its 64 own rows as cords).
  - cv-tray.js: the `serum` view and the `isSerumModel` import out; `TO_MODS` "Modulators: the Modulators view (the menu above)." (§5).
  - cv-art.js: `SIL.serum`, its drawing and "Serum (complete)" out (cv-art.test's "SIL describes every model" needs it with the model; an unknown
    id falls back to the generic keyboard drawing).
  - serum-ui.js deleted. sw.js rebuilt (serum-ui.js out of the list).
- **The SerumUI-only surface, re-grepped (§11.5).** Site readers of `bundled` / `dropShell` / `buildShell` / `M.sx`: none left (main.js's four
  rewritten). `SerumUI` / `serum-ui.js` in site files: comments only (fx-core.js :512, wtedit.js :4, wk.js :7, sx-host.js, sx-ui-*.js — not
  D's; cv-tray :61 / main.js re-worded).
- **For lane K.** `mountPart` is called for `arp` / `clip` only. m3-fixture loads (its serum-ui import gone, `UI.PAGES` → `SX.PAGES`; its
  `modTrack` device `'serum'` → `'rig'`, a 0b-class re-point D1 forced: the four canvas-modulator face cases were failing on "patchFor: unknown
  model serum" — green again); its `bundledOf` throws "the bundled panel left with serum-ui.js": the 8 cases with a bundled leg (:220 … :546,
  N2) fail until K re-points or removes those legs (§4) — 5 / 13 pass at D1. ui-layout-wc.mjs
  builds its hosts with `createHost`. The fork's findings for K: `chains` / `chainMenu` / `loadChain` lose their last caller with the header and
  the FX page (if K deletes them, sx-helpers' two chain cases go too); the C1 fold code (`foldable` / `peeks`) is unreachable on a face; the
  sx-host.js :1690 comment should point at sx-helpers; a rate-class redraw deferred while a face is off screen waits for the next paint if
  nothing painted meanwhile (`reshow` sees no stale face) — before SX0 too. For the lead: knob menus are off inside every drawer dialog
  (sx-host `onCtx` skips `.sx-ov`), so Voice control's LFO scaling mode cannot be set — before SX0 too; `extraMatrix` and `scSources` /
  `fxCost` on sxHost lose their one reader (serum-ui's MATRIX / FX pages).
- **serum-ui.test → tests/sx-helpers.test.mjs (52 cases; the fork's table).** 64 = 20 moved + 33 re-pointed + 11 removed.
  - Moved byte-identical (20): :117 :151 :166 :200 :224 :247 :262 :275 :293 :320 :356 :396 :418 :435 :462 :482 :502, :3219 :3233 :3253.
  - Re-pointed onto `createHost` + rig-ui faces (33): :78 / :87 (imports: sx-host.js), :96 (parity: the four kept stubs), :830 (Bypass All /
    Remove All on the Envelope 2 / LFO 1 faces; the VELO tile part went with the strip), :875 (knob menu on the Filter face: CUTOFF's menu is the
    real FILTER panel's, by design), :935 (routing switches on the Filter face; the strip-drag lines went), :993 (module menus: ⏻ slot, ⋯
    menuItems, labelDrag), :1052 (Alt-drag depth, Shift+Alt polarity; drops on matrix / LFO point / macro went with MATRIX and the strip), :1332
    (halos, dots, phase capture; voice counter / output meter went with the header), :1552 (QUALITY, S1, TUNING, VOICE CONTROL through the drawer
    dialogs; the page list, MPE, UNISON A–C, CHAOS (S1) went), :1676 (Preferences…), :1718 (PresetBrowser via `browser.open()`), :1833 (panel undo;
    Alt-F went with MATRIX), :1882 (touch first-class; wave icon / modifier bar went), :2024 (the kit half: msg / frame / stub parity), :2054 (LFO
    PHASE snap via the LFO face), :2134 + :2173 (one CSS case: popovers, 44 px targets, reduced motion), :2500 (outside preset load; the header's
    name pin went, the step label pins it), :2559, :2633 (lock via ⋯ Lock Module), :2675, :2772, :2835 (hidden: a face whose `shown()` is false),
    :2874 (FR B3: `paint(true)` for setPage's paint), :2910 :2939 (chains, bodies unchanged), :2970 (settled(), unchanged), :2988 (bar-title
    labelDrag), :3031 (two-finger rollback: Tuning numField, face Alt depth, dialog backdrop; the matrix curve cell went), :3130, :3172 (two hosts),
    :3242 (extra rows on the Amplifier's MASTER).
  - Removed with the code (11): :766 (header, seven pages, keyboard foot), :1130 (strip touch drag; settled() pinned by :2970's), :1403 (MATRIX),
    :1486 (main menu), :1935 (dropShell / buildShell), :1951 (header wave icon / render-last UI), :2008 (serum-ui's FX page `scSources` adapter:
    the canvas FX module's host is fxHost, canvas-SC-sim :426), :2217 :2402 :3098 (C1 folds and peeks: no fold on a face), :3259 (MATRIX extra rows).
  - Also out: tests/serum-ui-stubs/hooks-ui.mjs and its sx-ui-osc / -mix / -seq stand-ins (no other user: grep), serum-ui.hooks.mjs's
    `redirectUI` / `UI_NAMES` / `resolveUI` (`redirect` / `resolve` stay: sx-host.test 41/41, rig-ui.test 32/32 after).
- **canvas-3-sim (25 cases → 24).** The loader `{host, …, rig: RU}`, `setUi(false)` gone, the boot `#rig`; the old `rigParts` (a Serum's model
  swapped) is `serumIn`: the default Serum state (serum.defaults with this sim's preferences) written into the rig, no step. The DOM fix gains
  `querySelector('[data-dest="…"]')` over the subtree (rig-ui findDest takes the donors' widgets by it; the stub answered a fresh div) and fixes
  every other answer (a box, the document) so the painted count can walk it.

  | case | fate | reason |
  |---|---|---|
  | :111 boot | re-pointed | a rig: createHost (no shell), mode 'parts', no Show-parts hooks, the starter's modules, then serumIn; "a Serum is the whole panel, a stored flag ignored" removed with the bundled model |
  | :118 DSP globals | unchanged | |
  | :128 a rig in parts view | re-pointed | the Serum-with-flag half and the model-swap stand-in removed (bundled model, stand-in path); kept: a lay-only change keeps the state (N2), the one host and its panel undo, each face a view of it |
  | :152 :167 :194 :219 :260 :304 :339 :354 | unchanged | pass on the faces |
  | :285 a row ends at VOICE | unchanged | passes once the stub resolves data-dest (the face's LEVEL is the donor's knob) |
  | :368 D-R5 retired | re-pointed | a new track is a rig (its starter's modules) where a new Serum opened whole |
  | :395 :414 :434 (F2–F4) | unchanged | the `rigParts` guards dropped (a rig is always parts) |
  | :451 P1-5 stub popover | removed | the stand-in path: stage 3's OSC ROUTE popover and sx-edges' stub cable; a rig has cords (no stub) — P1-6 here, canvas-WC-sim §4.1 / review 2 P2-2 |
  | :471 P1-2 off-screen paint | re-pointed | onto the rig's Macros face: its view's stale / shown (the stub builds no donor name tiles; canvas-MOD1-sim reads its slot faces so) — the same on-screen → reshow path |
  | :486 :500 :508 :536 :557 :574 | unchanged | |
  | :598 S0 notice | re-pointed | the new track is a rig; serumIn before the Add sequence (the starter's Filter is on, the default Serum's is off); the count is the faces' (2391 fully opened > 1866) |
- **canvas-2a-sim** (0b's stop: 9 of 26). The boot `#rig`, `fresh` a rig, `dropRow` from sx-host.js. Re-pointed by design: the keys pins carry
  the rig's modules (a rig is always its modules); the Modulators tiles' view is 'mods' (MOD1 §5; the Serum view is gone); the rig's ⋯ (About the
  <NAME>…, Replace with…, Init, Modulation list…: the Amplifier's, WC §8.2 — no face loads in this sim, so no panel items); the preset load's
  cable list filters the rig's own-source cables (`o:`, its rows drawn from its modules — canvas-3's own-sources case pins them); the Mod list
  counts `cv.parts.presetRows` (a rig lists every matrix row, main.js modPresetRows; a Serum listed the canvas sources' alone); H4's notice names the
  device ("the <NAME>") and its model id; U10 resets the hint's session flag first (H8's 65 own cords said it). The other three failures were cascades.
  26 / 26.
- **canvas-2b-sim** (0b's stop: 15 of 23). The boot `#rig`, every fresh Serum a rig. On a rig the Modulators tile puts an LFO / Envelope / Macros into
  the rig (MOD1 §5, pinned by canvas-MOD1-sim / canvas-WC-sim), so `drop` adds those three as the track's own device through `M.add` (modAdd: the step
  and notice the tile gave on a Serum) — this file's modulators are the track's; keys `RK(…)`; the view 'mods'; linkSources lists the rig's standing
  Envelope 1 (MOD1 reviewer 1 P2; a Serum listed every LFO slot); i1's title is 'Amplifier'. 23 / 23.
- **canvas-del-sim.** The loader `{host, …, rig: RU}`, the boot `#rig` (the harness's keys pin: the starter's modules), `rigParts` gone (the boot is
  a rig). 11 / 11. Its boot render logs one "doc.getElementById is not a function" (console.error, caught): the boot box predates the sim's DOM
  fix, so SerumUI's doc rule (kept) reads the stub's inert `ownerDocument`; the render after the loader is clean.
- **canvas-FR-sim** loader + stub constructor only (`createHost: (h, o) => new SxStub(h)`, no box); its 15 cases byte for byte, green (G7).
  **canvas-MOD1-sim / canvas-MM-sim** loader shape only (30 / 30, 24 / 24). **cv-shell-sim**: `createHost` stub; the views case re-pointed to a
  stored rig view (+ 'serum' and 'nope' both open Hardware: §2's rule); "a Serum's FX page: its host's fxCost" removed (serum-ui's FX page was
  the member's one reader; every FX module's rack takes the cost — pinned in the same case). 19 / 19.
- **canvas-WC-sim** (51 / 51). G13's "a Serum: the kit's own words" removed (no Serum-engine device but a rig). §3.5's first drop: the Serum half
  removed, the Minimoog and + Track halves kept. "Make it a <NAME>" removed with rigConvert; "G2 (host level)" removed with the Serum track it
  compared against — pinned by rig-sound W2 / sx0-model (patch) and canonical-stream, ref-M / MM / SC (the live path: p1's Serums as rigs, exact).
  G5 (the load pass) re-pointed: the old project's Serum is written into the file (main's id, the default Serum state, no rig record, "Serum <n>")
  — no Serum can be added any more; its assertions unchanged. G12: the Serum-complete canvas left the list. Review 1 P2-3: the Serum's MPE half
  removed. B3: the Make it a <NAME> entry point removed.
- **canvas-1e-sim** (24 / 24): every Serum a rig; the rig's ⋯ (About the <NAME>…: "About the Serum…" removed); Tidy's instrument column at 1024
  (the rig's chain to its left, WC review 2 P2-5) where it was 0; the rig's keys; the heavy confirm's words ("a heavy <NAME>": cv-cost's);
  1f's read-only pins leave out the rig's own cords and jack-row jacks (its edits, WC §4.4) — every device wire and other jack still read-only.
  The tile-cost case reads the rig tile's cost.
- **canvas-sim** (25 / 25): the Serum-engine instrument a rig; the monitors case's keys; the lay case's drag relative to the Amplifier's place;
  the classic → rig → classic case: the rig lays its group out on arrival (its FX in the group), the user's drag ends where it ended relative
  to the instrument; the classic file writes a rig as 'serum' (S2) — `mainId`; the Sources views walk on the rig view. `cv.size('serum')`
  (W_SERUM) stays for D2.
- **cv-tray.test** (59 / 59): `VIEW_IDS` and `TO_MODS`; the views walk-through on the rig view (third, where the Serum view was); a stored
  'serum' is an unknown view (Hardware); the 2a / MM cases that needed "a view that shows the Modulators with their heading" use the rig view;
  indices one lower (Modulators 3, Controllers 5, Moog 6); no Serum tile / view (asserted absent).
- **accessors**: R2 MPE removed (below); the program-change loaders `{host: sx-host}`. 29 / 29. **canvas-R-sim**: R-15 (follow-up) MPE removed.
  27 / 27. **main.test** (49 / 49 with the new G3 case): §12.6's MPE half and RULINGS2 fix 2 removed; §12.6 re-pointed — a rig gets the Phase-1
  messages with its state's MPE switch off **and on** (Q2, by design); the lane D case boots `#rig` (its W2 leg is rig-sound's / sx0-model's).
  The MPE removals' reason: MPE input on canvas leaves with Serum complete (§11.3) — midi.js routes MPE to main's 'serum' alone; midi.test keeps
  midi.js's own cases.
- **rig-sound W2**: re-pinned against `SERUM_B`, the bundled entry as it stood at ⟨B⟩ (custom, its map `compileSerum`), frozen in the test; patchFor
  and the harness take a model object, so both the patch and the render compare the rig with the old model, never with itself. 9 / 9.
  **rig-model**: `MODELS` pins (18; rig at 17), W2 against `SERUM_B`, `serum.defaults` → rig-core `applyPrefs` (the preference rule; "the
  Serum's defaults are what they were" removed), `isSerumModel` and the Serum view asserted absent. 11 / 11. **mod1-model**: "a Serum: every LFO
  and ENV slot" removed. 9 / 9. **cv-art**: the Serum label / drawing pins out. 7 / 7. **pwa**: sx-host.js in serum-ui.js's place (the lazily
  loaded module), serum-ui.js asserted out of the list. 25 / 25.
- **Deleted**: tests/ui-bench-m3.mjs; ui-bench.html's `?m3=1` now only says so (the flag stays: ui-bench-wc.test pins the `!M3 && …` chain).
- **The guard, failing first.** main.test's new G3 case ("an unknown model id is refused everywhere a model comes in": setTrackModel 'serum' /
  'nope', addTrack by id and by an object of no model, srcPick replace / track, srcDrag.drop canvas / tracks, the add hook; the project JSON and
  History unchanged; `#serum` boots the default; a known id still goes in) fails with the guard taken out (addTrack('serum') throws) and passes
  with it.
- **cv-migrate.test** (phase 0's; one line, outside D's list — D1 forced it): "2a cv-model: preset rows, Save with preset … — the compiled patch
  unchanged" compiles its `sxTrack()` device, a `'serum'` record → `patchFor: unknown model serum`; the device is made a rig in that case alone
  (`d.model = RIG.ID`, the same patch), `sxTrack` itself untouched (its 'serum' records still test main's id through the migrations and toV1).
  76 / 76. Lane W edited this file too (:754, :797, :805, its notice words): D1's line is an insert after :758, clear of theirs.
- **Run (one file at a time, 2 GB; sw.js BUILD 40c1d150b1c3, 104 + 14 entries)**: pwa, lint, golden-classic / -fx / -presets / -random / -graph,
  sx0-model, canvas-WC / MOD1 / FR / MM / R / 3 / del / 2a / 2b / 1e-sim, canvas-sim, cv-shell-sim, accessors, rig-sound, rig-model, mod1-model,
  cv-tray, cv-art, cv-module, sx-helpers, sx-host, rig-ui, cv-mods-ui, app-shell, main — green; m3-fixture 5 / 13 (K's bundled legs, above).
  Beyond D's list, every other file that names 'serum' or boots a sim: canonical-stream (exact), cv-migrate, app-midi-sim, canvas-M / SC / P /
  9b / 7a-sim, safeguard-sim, master-mods-model, cv-graph, cv-cost, smpgen, graph-host, cv-mods, cv-model, cv-cables, cv-modlayer, cv-panel,
  app-ios, app-native, app-midi, midi, fps-determinism, ui-bench-wc, ui-bench-fps, integration, inst-denormal, sidechain-dsp, engine-track,
  presets, presets2, assets, fx-ui, serum-core, sx-ui-seq / -mix / -osc — green.
- **Not in D1 (D2)**: the words (§5: models.js tag / about, main.js rate line, manifest…), `W_SERUM` / `H_GUESS.serum` / the 'serum' branches /
  the `voice` part sizes and the `ui: 'parts'` flag in cv-module, canvas-sim's `cv.size('serum')`, ui-bench-fps's `serum` scene (it now picks a
  refused id), the remaining comments.

**Lane D, D2 (2026-11-02; on e144abd).** The words, the sizes, the scene; D's files only.
- **Words (§5, G4)** — a literal scan of main.js, models.js, cv-tray.js, cv-art.js, cv-module.js, index.html, style.css and the manifest (comments
  stripped) now finds no "Serum", "Xfer" or `.serum(-pack).json`:
  - main.js: the rate line " · <NAME> 96 kHz"; the two CPU notices "<NAME> oversampling capped …" / "<NAME> quality step …"; the uiMods console
    text "The panel modules failed to load"; renderLast's error "Rendering needs a <NAME>"; the own-FX module title always the rig's ("Effects":
    the 'Serum FX (own)' branch went — no other Serum-engine device exists); the export names `<name>.preset.json`, `<name>.preset-pack.json`
    and render-last's Shift `<name>.preset.json` (the type ids 'synth.serum.preset' / '.pack' stay: sxImport reads the type, never the name).
    (:6520's view word, cv-tray :592 / :596 and cv-art :727 went in D1.)
  - models.js: the rig's tag "… · a wavetable engine underneath" and about "built on a wavetable engine … Every module of a <NAME> is one part of
    that engine under a plain name …" (RIG.NAME kept in it: rig-model's pin).
  - manifest.webmanifest: "… a modular wavetable synth and a multitrack MIDI studio …".
- **Sizes (cv-module)**: `W_SERUM`, `H_GUESS.serum`, `defaultW`'s / `hOf`'s / `sizeFor`'s 'serum' branches and `costOf`'s 3700 out — an id of no
  model (and a Serum-engine instrument shown whole, which only a test still builds) takes the instrument default 1080 × 560, cost 600.
  **[C] deferred**: the `voice` part sizes and the lay flag `ui: 'parts'`. The flag is load-bearing for every rig (cv-module's `isParts`: the
  hidden-knob tag at VOICE's corner, `intPatch`, the cables' parts opts; main.js writes it on a rig's first place, :7151 / :9778), and
  `PART_W_DEF.voice` / `PART_H_DEF.voice` are the geometry of cv-module's stage-3 VOICE path (no `wires`: `voiceJacks`, the parts Tidy) that
  stays as code — taking the numbers alone would re-shape a path nobody removes. One refactor with that path: ROADMAP 15. The cv-module.test
  cases of that path (the Serum parts Tidy :1424, the part modules / VOICE :1467, the internal cables :1494) stay with it (S6).
- **style.css**: `:root { --sx-osc-a … --sx-clip }` out — every reader either sits inside an `.sx-root` (the kit's CSS defines the same eleven
  tokens there; a face's and a slot face's roots are `.sx-root`) or names the same value as its fallback (sx-ui-seq :242 / :290, sx-ui-osc :332,
  wk :3837); main.js / index.html / style.css read none. **Kept**: `.cv-body > .inst.custom .sx-root` (:1105) — the check finds an element: the
  Amplifier's face root (`.cv-body > .inst.custom.m-rig > .sxhost > .sx-root.sx-part`, the path canvas-3-sim's stub walks).
- **ui-bench-fps**: the `serum` scene (BUILD, EXPECT, SCENE_IDS) out — the `mods` scene is the modulators' one; bench.json's `*/serum/*` cells
  stay as history; ui-bench.html's scene list text follows.
- **Tests (case · fate · reason).**

  | file · case | fate | reason |
  |---|---|---|
  | main.test · new "(SX0 D2) preset export file names" | new, failing first | the three names were `.serum.json` / `.serum-pack.json` (it failed on them), pass after; the type ids pinned unchanged |
  | accessors · R2 the rate line | re-pointed | the line names RIG.NAME (§5) |
  | graph-host · :252 render-last of a classic | re-pointed | the error matches `needs a <NAME>` (§5; graph-host is not D's — its pin moves with main.js's word) |
  | cv-module · fxKey / ids | re-pointed | `W_SERUM` absent (pinned absent) |
  | cv-module · FLOW_W / defaultW | re-pointed | `defaultW(inst, 'serum')` is the default, as 'nosuch' |
  | cv-module · tidy (1b), tidy (1e) ×2, lay pins, sync model change ×2, device-driven view (widths, Tidy, costs ×2) | re-pointed | a Serum-engine instrument shown whole takes 1080 × 560 and cost 600 (the bundled panel's 1200 × 840 and 3700 went): the expected places follow (i1/fx 1248, OUT 2176; the 1e rows) |
  | cv-module · sizeFor "Serum wider" | re-pointed | its Serum lines out; `sizeFor('serum')` equals an unknown id's |
  | cv-module · knob end points, hidden twins | re-pointed | the half-size placement is 540 client px (half the default 1080) where it was 600 (half 1200): every expected point unchanged |
  | canvas-sim · `cv.size('serum')` | re-pointed | `cv.size(RIG.ID)`: the default outline 1080 × 560 (the Serum tile's 1200 × 840 went) |
  | ui-bench-fps.test · EXPECT.serum knob-dot tol | removed | with the scene (the tutorial / master knob dots stay pinned) |
  | ui-bench-fps.test · matrix, SCENE_IDS, defaults count, GR loop, knob-dot boxes, "serum stays until 28" | re-pointed | 8 scenes; the GR loop the tutorial's Ducker; the last pin now asserts the scene gone |
  | lint · N5 accessor ratchet | re-pointed | cv-module's allowed sites 6 → 5 (the removed `=== 'serum' ? 3700` site) in tests/fixtures/accessor-allow.json |
- **Run (one file at a time, 2 GB; sw.js BUILD 95fd51643344)**: pwa, lint, main, accessors, graph-host, cv-module, canvas-sim, ui-bench-fps,
  rig-model, cv-art, cv-tray, canvas-1e / WC / SC / 3 / 2a / 2b / MOD1 / M-sim, safeguard-sim, app-shell, cv-shell-sim, golden-classic, sx0-model
  — green.
**Lane W (2026-11-02; from fe47fef; words only, no sound).** Each file was run alone (2 GB) green on this tree.
- **Re-worded** (old → new):
  - fx-ui.js: the S1 badge tip "Serum 1 variant (Convert to Serum 2 Module in its menu)" / "Serum 1 module (it has no Serum 2 variant)" →
    "Older (v1) variant (Convert to the current module in its menu)" / "Older (v1) module (it has no current variant)"; the v1-host refusal
    "…needs the Serum 2 FX rack…" → "…needs the current FX rack…"; "Modulations were not copied (no Serum state)" → "(no synth state)"; the
    menu item, the reverb confirm, the undo label and the notice "…Serum 2 (Module)" → "…the current module".
  - cv-modlayer.js: `refusal('full')`'s "This Serum" and `ownTag`'s fallback "Serum" → `RIG.NAME` (new import of rig-core, a leaf).
  - cv-model.js: `setModel`'s notice drops the `was === 'serum'` branch ("the Serum" → "the instrument", as a rig already read); `fullWhy`'s fallback
    "Serum" → `RIG.NAME`. cv-mods.js `linkSources`' fallback model name → `RIG.NAME`. cv-graph.js `own-fx`: the Serum branch out, one wording
    "Its own FX take only this instrument · Make a shared panel".
  - wt.js `clmText`: "… wavetable (www.xferrecords.com)" → "… wavetable (SYNTH)".
- **Pins moved** (by design): fx-ui.test (the menu label, the badge tips, the refusal regexp; new: the reverb confirm text and the "converted"
  notice are pinned); wt.test (:472 now "(SYNTH)" + a round trip; :471 / :500 read another synth's file with a neutral URL — the reader's
  size + two-digit rule still pinned, no Xfer text left in the file); cv-modlayer.test (new: `refusal('full')` with no device, an own row's tag
  for a named / unnamed device); cv-model.test (new: the full text for an unnamed / named device); cv-graph.test (new: the `own-fx` message);
  **cv-migrate.test** (phase 0's file, forced by cv-model's words): :754 / :797 "Serum’s mod rows…" → `RIG.NAME`, :805 "to the Serum" → "to the
  instrument". main.js builds its own removed-cables text (`nm` :2616), so canvas-2a-sim's H4 pin is unaffected.
- **cv-mods.test "modulator ids, labels, sources" re-pointed** from lane 0b's stop: its device is `RIG.ID` now. A rig's `linkSources` lists
  only the modules on its canvas (here the LFO and the Envelopes the matrix reads), each by its own title (MOD1 §2.2): 3 sources
  ("LFO 1 · Lead", "Envelope 1 · Lead", "Envelope 3"; a title the track's modulators hold gets " · <device>"), not a bundled Serum's 14
  "Lead LFO 1". Nothing the case checked is loosened: the same `used` links (lfo1, env1, env3), `perNoteOf` (a MONO LFO global, only a
  Serum-engine device links), the first source's whole record; plus the labels and the unnamed-device label (`RIG.NAME`).
- **Not in my files**: the cv-cables refusal text ("own FX take only that Serum", cv-cables.test :423 / :432) is a stub host's string
  (the real text is cv-graph's, above): the test echoes it, nothing to change. The `fxr-xfer` class and `xferOf` are transfer-curve names, not Xfer.
  **Found for D / K** (user-visible, in the §5 list or not): main.js :4002 `slug(name) + '.serum.json'` (renderLast's Shift branch, which stays
  per P1-4: a third export name beside :3731 / :3738, not in §5; G4's pattern hits it); sx-ui-mix.js :97–98 and sx-ui-mix.test :236 / :354 / :355 ("…Serum 2 FX rack", K); main.js :7242 'Serum FX (own)'.
- sw.js: BUILD 3ec1759e2655 (committed by this lane on the lead's order; §9's "no lane commits sw.js" — the lead regenerates at integration).
**Lane K (2026-11-02; from D1 e144abd; §15 P2-7's bounded list).** Built as §1.3 / §4 say; the [C] refinements, the "no caller" table, the per-case
tables (reviewer 1), the run. **Cut B untouched**: every member of IMPL-MOD1 §7 in sx-host.js (heavyMs, ringOn, sxInto, setSnapshot … heavyHz,
paint, paintCanvas, canvas, reshow, the whole setSnapshot → scanMods span, slotHost → createHost) byte for byte against e144abd (a scripted
compare); no diff hunk lies in them.
- **Deleted, each with no caller in the site files (grep of every top-level / panels/ .js):**

  | what | file | its one caller (gone) / proof |
  |---|---|---|
  | `PART_W`, `PART_PH`, `phaseOf`, `COL`, `partView`, `mountSlot` (+ `SLOT_VIEW`) | sx-ui-mod | none (MOD1); cv-mods-ui.test's G8 scan pins it site-wide on code |
  | `VoiceHeader`, `VoicePanel` (+ `FOLDS`), `MpePanel` | sx-ui-mod | the `voice` / `header` / `mpe` registrations and VoicePanel's fold-outs |
  | the registrations osc … vc but `arp` / `clip` (+ `oscSel`) | sx-ui-mod | no `mount('<kind>')` on the site but mountPart's; rig-ui and panelDialog mount builders |
  | `KeyboardPanel` (+ `KBD_SECS`, `SCALE_GROUPS`, `scaleGroup`, `swingParse`), `OscMapEditor` (+ `oscMapSig`, `MAP_ROWS`, `mapOf`, `DEF_MAP`) | sx-ui-seq | VoicePanel's KEYS fold-out; OscMapEditor's: KeyboardPanel.openMap |
  | `MixerPage.build` and its strips (`shell`, `srcStrip`, `filtStrip`, `envToggle`, `kn`, `filterDisplay`, `drawFilter`, `typeIdx`, `pzOf`, `magAt`, `warnOnce`), the SUB S2 scale of `dbOf` | sx-ui-mix | serum-ui's MIX page (no `new MixerPage` on the site; OutputsPanel overrides build) |
  | `V1_NOTE` / `V1_MAIN` and their gate `v2ok` | sx-ui-mix | dormant: every host sets `v2Fx` (main.js sxHost, fxHost, FXRackUI); OutputsPanel's one mount is the Amplifier face on sxHost |
  | `mainMenu`, `about` | sx-host | VoiceHeader's Menu button |
  | `initPreset`, `loadPresetFile`, `revertPreset`, `saveDefault` (+ `DEFAULT_KEY`), `resample`, `renderOscWarp` (the host's; OscData's stays), `veloAmp`, `vibrato`, `chainMenu`, `saveChainDialog` | sx-host | mainMenu alone (each grepped) |
  | the chain library `rawChains`, `chains`, `chainCopy`, `storeChains`, `loadChain`, `importChains`, `importChainText` (+ `CHAINS_KEY`, `fxWalk`) | sx-host | chainMenu / saveChainDialog alone (D1's note); the canvas FX module's chain menu is fx-ui's own |
  | `logo`, `MPE_XYZ_LABEL` (and their exports) | sx-host | serum-ui's header; mainMenu |
  | `addRoot`'s bundled branch | sx-host | serum-ui (no `bundled: true` on the site) |
- **Words (§5).** sx-host `BUILD` "Wavetable engine · state v2 · CP v2" (a rig's words.build wins), the about text gone with about(); the two CSS
  comments re-worded; sx-ui-mod :689's S1 fallback "S1 renditions (the first engine version) …"; sx-ui-osc :2972 "no S1 equivalent"; sx-ui-mix's
  V1 words gone; sx-edges `WHY.voice / .fx / .note / .notes / .bad` "…its instrument" (rig-core's WORDS override them on a rig); rig-ui :681
  "a face needs its rig's host (args.host: sx-host createHost)". sx-host's "SerumUI" comments re-worded but :2693 (pagesNow's, next to the seam:
  left as it is).
- **[C] refined**:
  - "The methods only `mainMenu` calls": §1.3 cites :3929–3947, but the menu runs to :3965 — its chain, Velo->Amp and vibrato items are the same
    rule, and the library they alone reach went with them (D1's finding). `loadTuning` / `clearTuning` stay: TuningPanel calls them.
  - `mountPart(host, part, root, args)`: 'arp' | 'clip' → `host.mount(part, root, { k: 0, bare: true, width: 1184, col: 'P', part, phase: null, …args })`,
    the old call's arguments exactly (data-col P has no rule; kept so the DOM is ⟨B⟩'s); anything else → null.
  - sx-ui-mix: with the V1 words the `v2ok` gate went: `canRack()` = an FX state exists; a v1 state converts at its first rack edit for any host
    (every host had `v2Fx`); no FX state → disabled and inert, silently. The bypass tip a constant (still painted by its custom).
  - **sx-edges `LABEL.voice / .fx` kept** ('VOICE' / 'FX' hold no Serum word; jackrules.test :320 — not K's file — pins `partLabel('voice') ===
    'VOICE'`). §4 asked to re-word them: for the lead.
  - **No CSS removed** (§1.3: only with a selector-match check): the shell groups, `.sx-logo`, `.sx-opan` / `.sx-fpan`, `.sx-voice` / `.sx-fold*`,
    sx-ui-mix's `.sxm-off` / `-type` / `-fdisp` / `-env`, sx-ui-seq's `.sx-kbd` / `.sx-oscmap*` now match nothing (their only makers went) →
    ROADMAP 15. Kept, bounded, no caller left (ROADMAP 15): SerumHost `renderLast` / `keepRender` / `dropRender` / `rendersMenu` (G5: renderLast
    stays), `savePresetUI` / `stepPresetUI` / `authorDialog`, the C1 fold code (`foldable` / `folding` / `peeks`), `alignPhase` (no view passes a
    phase), the `rackShown` / `toggleExpand` / `destroyShell` no-ops, the input hub's `keys` count, `swingN` / `swingS` (exported, tested), `PAGES`.
  - **m3-fixture re-pointed onto the faces** (the lead's brief over §4's "third leg only"): where a rig face holds the control the leg drives it —
    the filters' input switches, an oscillator's BALANCE (its drawer), the Amplifier's bus routes / FX bypass (its drawer). A face has no ROUTE (the
    cord is the route), so the MIX page's route legs went and those cases keep the cord (sx-edges) against the direct write, rendered. N2 became
    "faces mounted, painted, drawers opened, unmounted, twice: vals.s, fx and the patch byte-identical" (the base + the six richest presets).
  - **The parity source.** rig-ui.test `both()`, ui-layout-wc and m3-fixture's rig case read tests/fixtures/sx0-dests.json (states rig / wc / m3,
    the slots); where an element count or a ⋯ list was compared, the "old panel" is its donor class mounted through `host.mount(builder)` as its
    registration mounted it (sx-host.test `donor` / `slotDonor`, rig-ui.test `oldPanel`, cv-mods-ui.test `oldPanel`, ui-layout-wc `donorView`);
    VOICE has no donor left (ui-layout-wc: its frozen ids alone). tests/ref-SX0/dests.mjs (phase 0's recorder) can no longer mount the views, as its
    header says.
- **Cases** (case · fate · reason).
  - sx-host.test (41 → 37): exports · re-pointed (the donors' and mountPart's exports, the registry `['arp', 'clip']`, mountPart null for the
    rest, the main menu's members gone); mount / H4 / label-drag guard / ghosts / bare / H1-H3 / review 1 F1 / review 2 P1-2 / the FR-B cases at
    :1097 :1119 :1137 / B3 :670 :919 · re-pointed (`donor()`: the same panel classes through `X.mount(builder)`; bodies otherwise unchanged; :90's
    width / column passed as a face passes them); bare's last lines (sx-opan / data-o / s.ui.osc) · removed with `oscSel`; slot host LFO's width
    · removed (PART_W); slot host chaos's "CHAOS 2" · removed with the registration's label rule (a slot face titles its bar: rig-ui.test slot
    faces); every slot-host case (MM lock, the slot-ring cases :1201 / :1230 / :1256) · the `slot()` helper alone changed, bodies byte for byte;
    VOICE / VOICE status line / VOICE remount · removed with VoicePanel (the Amplifier face: rig-ui.test; Preferences… / Info…: sx-helpers);
    review 2 P2 parity (PART_W / PART_PH) · removed with them; part CSS · kept (its rules stay; §4 listed it to go), title re-worded.
  - sx-helpers.test (52 → 50): RULINGS2 F1 chains, Phase-1 chain · removed with the host's chain library (fx-ui.test :1484 / :1748 / :1770 pin
    the same rules on the canvas FX module's menu).
  - sx-ui-mix.test (18 → 13): imports, OutputsPanel, channelStrips, routeMenuItems, touch rules · unchanged; strips in order, bus routes, faders /
    meters, bus / main bypass, two-finger fader rollback, destroy, v1 conversion, FR-B §4.3 meters · re-pointed onto OutputsPanel (the source /
    filter halves went with the MIX page; the "v1 disables" half → "no FX state disables"; the v1 case converts with or without `v2Fx`; :236 /
    :354 / :355's V1 words gone); collapse, module labels, filter strips, SUB scale, filter mini display · removed with the MIX page's strips
    (the Filter / Sub faces' own controls: sx-ui-osc.test, rig-ui.test).
  - sx-ui-seq.test (59 → 56): exports · re-pointed (no KeyboardPanel / OscMapEditor); ARP / CLIP mount, kit.live(shown) · re-pointed without the
    strip; "the keyboard strip is recorded" · re-pointed to the recorder alone (host input recorded, previews not, velocity units, subscribed while
    recording, destroy releases input and metronome); KeyboardPanel ×2, OscMapEditor · removed with them.
  - m3-fixture (5 / 13 at D1 → 13 / 13): the rig · re-pointed (faces + the Amplifier, each ⊇ the frozen m3 set); OSC B → FILTER 2, fork, cuts,
    NOISE / SUB, stub, FILTER → FILTER, FX in / out · re-pointed (above); the four canvas modulator cases · unchanged; N2 · re-pointed (above).
  - rig-ui.test (32): `both()` reads the frozen set (each face case asserts a non-empty one); slot faces / ⋯ / Chaos · `oldPanel` (the donor) +
    the frozen slot sets; "refuses without a host" · /createHost/ for the re-worded error.
  - cv-mods-ui.test (19): the slot bodies' parity · the donor + the frozen sets; G8 · adds a site-wide scan of code (comments stripped): no
    mountSlot / partView / PART_W / PART_PH / phaseOf, every mountPart call on an 'arp' + 'clip' line.
  - ui-layout-wc.mjs: the parity source as above; **G11 green at 1440 × 900, 1366 × 1024, 1024 × 1366** (CfT, its own profile in the scratchpad,
    downloads denied, killed after): every face and modulator ⊇ its frozen set, the slot faces ≤ 1.2 × their donor.
- **Bytes** (e144abd → K): sx-ui-mod 69,898 → 51,281; sx-host 333,593 → 317,687; sx-ui-mix 33,918 → 20,514; sx-ui-seq 193,866 → 180,649; sx-ui-osc
  −5; sx-edges +81; rig-ui +15 — the kit −61,053 B. sw.js BUILD 703d70d6543b (104 + 14 entries), **9,742,550 B** (gate ≤ 9,805,169).
- **For the lead / D.** G5's grep over comments still finds "SerumUI" in fx-core.js :512, wtedit.js :4, wk.js :7, sx-ui-osc.js :9 (not K's line)
  and sx-host.js :2693 (kept: the seam's neighbour), and "PART_W" in cv-module.js :129's comment (D's). main.js :8528's comment quotes the old
  WHY.voice. sxHost's `extraMatrix` / `scSources` / `fxCost` (D1's finding) are main.js's.
- **Run** (one file at a time, 2 GB): pwa, lint, sx-host, sx-helpers, m3-fixture, rig-ui, cv-mods-ui, sx-ui-mix, sx-ui-seq, sx-ui-osc, sx0-model,
  jackrules, canvas-WC / MOD1 / FR / 3 / del / MM / 1e / 2a / 2b / R / M / SC-sim, canvas-sim, motion, fast-lane, master-ui, fx-ui, main,
  golden-graph / -presets / -random / -classic / -fx, accessors, app-shell, app-ios, app-native, cv-module, cv-tray, cv-shell-sim, ui-bench-wc,
  ui-bench-fps, graph-host, safeguard-sim, rig-model, rig-sound — green.

**Fixer 1 (2026-11-02; from e9156cd; the reviews' findings, tests first).** Cut B untouched: sx-host.js's hunks are 1266, 2013, 2693 (a comment),
2936 (a console label in paintCanvas's catch), the overlay (3221–3232) and 4050 / 4055 — none in §7's members; no sound file changed.
- **R1 P2-1** — canvas-3-sim's new last case: a rig with `arp.on` / `clip.on` has i1/arp and i1/clip in `rec().views` (V.kind 'arp' / 'clip', a
  built panel, mountPart's args: bare, width 1184, col 'P', phase null; the root's data-col 'P', width 1184px); off, no view (it removes the
  places the S0 case above leaves). Proved: `&& SXMOD ?` → `&& false ?` at main.js sxViews fails this case alone (restored).
- **R1 P3-1** — the note named the track as it stood before the split. serumOut still runs first (the split's names for a new track need the
  <NAME>: `modelById('serum')` falls back since serum left MODELS; so the order stays and nothing stored changes). `serumOut(p, notes, said)`
  now also reports `{ i, track, dev, tail }` per note (upgrade returns it as `said`); `splitTracks` returns `moved` (`{ track, dev, name }` per
  instrument of a changed track: the name its track has now); `notesAfterSplit(up, sp)` rewrites each note to “<that name>”: tail; main.js
  loadProject says `sp.notices.concat(CM.notesAfterSplit(up, sp))`. A keeper keeps its name (the note as it was); a project that did not split
  is the notes as they were. **Pin moved by design**: the G2 page case's `endsWith(OPENS('Duo'))` → `OPENS('Duo · ' + RIG.NAME)` (cv-migrate.test;
  a new pure case: Juno + Serum, Serum first, two Serums (“Wavecraft 2”), a long name cut to 100, a single track).
- **R2 P3-a** — `overlayOpen` (sx-host.js; every host dialog: Preferences… / Info…, the wavetable editor, Save Preset…) also listens for Escape at
  the document while open (focus stays on the ⋯ button, outside the overlay); the same `!defaultPrevented` rule, so a number field's or popover's
  Escape wins; released in `close()` (and `destroy` closes the overlay, :4291). sx-helpers.test: Preferences and Info, focus on the opener, the
  listener count back to 0, a handled Escape leaves it open, a second dialog replaces the first (one listener), `close()` releases, inside the overlay.
- **R1 P3-4** — "SerumUI" / "serum-ui" re-pointed in the five places named (fx-core :512, wtedit :4, sx-ui-osc :9 / :13, sx-host :2693) and the
  five console tags are 'sx-host: …' (no test pinned them; grep of tests / tools). Other "serum-ui" words in comments (sx-ui-osc's kit notes,
  sx-ui-seq, wk.js, sx-host :7 / :467 / :1669 …) are left: not user-visible, not in the finding.
- sw.js BUILD 8830128cc491. **Run** (one file at a time, 2 GB): canvas-3-sim 25/25, canvas-WC-sim, cv-migrate 77, sx-host, sx-helpers 51, main, lint,
  pwa, sx-ui-osc, rig-ui, cv-mods-ui, canvas-1e / MOD1-sim, sx0-model, master-mods-model, wtedit, golden-fx — green.

---------------------------------------------------------------------------------------------------------------------------------

## 15. Skeptic + re-plan (2026-11-02)

Against the contract at 7b28fb0 and the tree at ⟨B⟩ 3db44a8. The user's words (the top of this file) are binding and unchanged.
The sections above already carry every edit below. There are 5 P1, 10 P2 and 6 P3 findings.

**P1**
- **P1-1 The schema bump is not needed, and its premise was wrong.** §2 and §11.1 assumed the installed iPad app is a schema-17 build
  that would start opening new projects read-only.
  - **The app.** It is built from 96409fa (stage B), where `SCHEMA` is 14 (`git show 96409fa:cv-migrate.js` :105). It has opened every
    browser-saved project read-only since SC made schema 15, so a bump changes nothing for it. Its free signing was due ≈ 10-31.
  - **The data.** A converted device is schema-17 data: `model: 'rig'` exists since 16, and nothing new is stored. A schema-17 build
    (an un-updated ⟨B⟩ tab) opens it fully. Every bump in STEPS guards an older build against misreading or dropping data; a bump here
    would only make that tab read-only.
  - **The precedent.** MOD1 avoided its bump by storing nothing new. Here a stored id does change, but loads already normalise in
    place without a step (`adopt` / `normDevs` main.js:326–327, `fxLoad` :292).
  - **→ §2.** An always-run, idempotent `serumOut` at the end of `upgrade`, after the STEPS loop: the same coverage (every load path
    goes through loadProject → `upgrade`) and the same notes. `SCHEMA` stays 17, so phase 0's pin moves in cv-migrate.test,
    master-mods-model, canvas-M-sim and canvas-9b-sim are gone. **The iPad needs nothing at this stage** (Q3).
- **P1-2 `SXM` was missed.** main.js:3628 resolves `MODELS.find(m => m.id === 'serum')` at module top. `sxPresetList` (:3639),
  `sxPreset` (:3643) and the preview (:4061) read it. Once serum leaves `MODELS`, program change, `sxLoad` on a Wavecraft and the
  preview throw, and so does canonical-stream's `sxLoad`. → §3: `SXM` = the rig (the same presets and map) in D1. G3 names it.
- **P1-3 The stand-in path has consumers the plan did not see.** Two sims run with no `rig` in their loader, so `RIGUI === false`
  and the rig's modules mount the stage-3 views:
  - canvas-3-sim: 25 cases (:79), budgeted as 2 removals;
  - canvas-del-sim (:66), which turns its boot Serum into a rig by hand (:86).

  Two run on the bundled branch: canvas-FR-sim (`SxStub(box, host)`, `mod: null`, :63 / :78) and cv-shell-sim (`SerumUI: class {}`,
  `mod: {}`, :318). D owned none of these except canvas-3. K deletes the views they stand on, and K must not edit D's files.
  - **→ §3, §9.** D1 takes the `RIGUI === false` branches out (main.js:7118, :7205, :8049–8050, :8717, `SXW`, `widths / setModule`).
    With no rig-ui loaded, `sxViews` mounts nothing and throws nothing.
  - In the same commit, canvas-3 and canvas-del load `rig: RU`, with canvas-3's 25 cases triaged in §14. FR and cv-shell get
    `createHost` stubs; FR's cases stay byte for byte (G7).
  - K starts only after D1, when no test outside K's files mounts a stage-3 view.
- **P1-4 Deleting renderLast weakens tests in files D does not own.** Seven files use `api.renderLast` as the probe of an offline
  single-track render:
  - graph-host :251 (buildInstPatch offline), :525 (canvas mod rows), :538;
  - canvas-M-sim :596 (the master), canvas-SC-sim :437 (the sidechain key);
  - app-shell :399, accessors :151–154, main.test :61 / :193–215.

  Removing them "with the code" loses those paths' coverage. Re-pointing them all to the bounce is lane work nobody owns. No UI reaches
  renderLast once VoiceHeader goes, so keeping it costs nothing. → §1: renderLast, `resampleTo` and their host members stay, as
  ROADMAP 15 cleanup. :3997's error is re-worded. G5 and §13 follow.
- **P1-5 Some 0b cases cannot be re-pointed.**
  - **The MPE cases** (accessors R2 :267, canvas-R-sim R-15 :641, main.test :241) route MPE through midi.js, which keys on main's
    `'serum'` and is byte-identical (app-midi.test :22 / :372). Moved onto a rig they fail, and a mechanical Sonnet lane "fixing" them
    would weaken them.
  - **midi.test's `'serum'` objects** (:34, :71, :251) are plain records testing midi.js's own literal.
  - **→ §6.1.** midi.test leaves 0b untouched. The MPE cases stay `'serum'` through 0b. In D1 each is removed with the reason "MPE
    input on canvas leaves with Serum complete (§11.3)", or re-pointed where it means something without MPE (said in §14). Q2 asks
    the user.

**P2**
- **P2-1 canonical-stream's step would not post the default Serum.** setTrackModel honours `o.vals` only with `o.keepLay`
  (main.js:2600–2601): `keep = rigM && o.keepLay && o.vals`. Without it the rig loads its starter, a different patch.
  - → §6.2: `{keepLay: true, vals: {s: …}}`.
  - The script stays runnable from main's tree (the documented `STREAM_REC` path). It uses `'serum'` when the root's `MODELS` has it,
    and never imports rig-core.js by a fixed path.
- **P2-2 The golden mapping proved nothing at phase 0.** golden-harness was to map 'serum' → `RIG.ID` only "when side X's `MODELS`
  has no serum", which is never the case on ⟨B⟩. → §6.2: map whenever side X has the rig, so phase 0's sweep renders the rig
  against the frozen side A before anything is deleted.
- **P2-3 ref-WC: the escape clause goes, because the [R?] is now settled.** The skeptic probed ⟨B⟩ with a scratch copy of record.mjs:
  - The 94 Serum fixtures were built as rigs.
  - `model` was written back to 'serum' in the `track` and `graph` hashes. Both are needed: without the graph write-back all 94
    graph hashes differ.
  - graph-1e's `osCap` was applied on `isSxId`. Without it the only differences are the 94 `messages` hashes.

  base.json matched exactly: 114 fixtures and 5 sessions, G12's `serum` and `fade` included. → §6.2, §10: no key may be deleted
  from base.json.
- **P2-4 m3-fixture's parts half is not "both sides gone".** Each case's third leg survives: sx-edges `setEdge` / `cutEdge`
  through a host against the direct write, rendered, which is the Wavecraft's cord path. → §4: K keeps that leg on a `createHost`
  and drops the MIX-page and part-view legs. Only :214 and N2 (:546) go.
- **P2-5 G4 would flag kept identifiers.** The pattern `.serum.` hits 'synth.serum.preset' / 'synth.serum.pack' (main.js:3730,
  :3737, :4001), which §1 keeps. → G4: `/\.serum(-pack)?\.json/`.
- **P2-6 Default names keep the word.** setTrackModel names tracks "Serum <n>" (main.js:2596). A converted project's track and the
  load note quoting it would fail G4's dynamic scan.
  - → §2: the pass applies setTrackModel's own rename rule (the default name becomes "<NAME> <n>"; devices likewise).
  - G4 dynamic exempts names the user typed, and lists them. G2 includes a "Serum 2" track.
- **P2-7 K's dead-code hunt was open-ended, next to the Cut B seam.** §1.3 said "anything with no caller", a transitive closure
  inside a 5,252-line file. It included the shell's CSS groups, yet a part root is `.sx-root` too (sx-host.js:1876), so `.sx-root …`
  rules style the faces. → §1.3: a bounded list:
  - the named shell members and the methods only `mainMenu` calls (sx-host.js:3929–3947);
  - whatever G4 forces;
  - CSS only where a selector-match check on the mounted faces finds no element.

  The rest is ROADMAP 15's.
- **P2-8 Owners for D's test edits.** canvas-del, canvas-FR (loader and stub), canvas-MM (loader) and canvas-R (R-15) belonged
  to 0b only. → §9: D owns those edits from D1 on.
- **P2-9 The G3 refusal needs code.** `modelById` falls back to MODELS[1], and `CMOD.setModel` would store the unknown id on the
  device (main.js:2583–2601). → §3: the guard in setTrackModel, addTrack and the drop paths.
- **P2-10 The SerumUI-only surface (task 2), inventoried.** §0's claim holds. The site has 4 readers, all in main.js
  (:4344, :8067, :8069, :8073) and all rewritten.
  - These are the host's already: the Cut B members, the slot hosts, `bodyAns` / `bodyReset`, the FX racks and rig-ui's mounts.
  - `pagesNow`'s `this.page` ('' vs undefined) changes nothing.
  - → §3 lists the full inventory, with the tests that read it.

**P3**
- **P3-1 Where a converted Serum's modules stand.** A Serum shown whole had no `iN/<part>` places, so conversion is mostly the
  unplaced case [R?].
  - Phase 0 records it in G2.
  - If the modules pile up, the lead may lay the group out once on first show (`sxLayParts`, "Make it a <NAME>"'s rule: no old
    places → Tidy's group), from a session set loadProject fills. No stored flag.
  - The user said saves need no care, so this is cosmetic.
- **P3-2** sx0-dests.json is recorded by phase 0 from the pristine ⟨B⟩, beside ref-SX0, not by K at D1 (§4). D1 has already swapped
  the host.
- **P3-3** style.css's `.cv-mbody` … `.cv-mkeyon` are MOD1's leftovers, not Serum's. → ROADMAP 15. cv-tray.test's pins stay.
- **P3-4** ref-SX0 drops "project-p1's patches after load": it needs an app boot, and ref-M / MM / SC / canonical-stream pin them
  (§6.2).
- **P3-5 Counts and citations.**
  - serum-ui.test has 64 cases, not ≈ 70. sx-host.test has 25 `mountPart` sites, not ≈ 35.
  - sx-host.js is also imported by sx-ui-mod.js (static) and cv-mods-ui.js:368 (lazy): it is precached either way.
  - The helper cases move to sx-helpers.test with their harness (the Proxy, `redirect`), not one line (§3).
- **P3-6** The service worker's two-tab edge (§11.2): bounded by `uiMods` loading with the first FX rack. Reviewer 2 tries it once.

**The schema answer.** No bump, for the reasons in P1-1. If a later stage ever stores something a schema-17 build would misread,
that stage bumps. The iPad needs nothing now: the installed app has been read-only for browser files since SC, and its signing has
lapsed. The browser on the iPad takes SX0 through the update toast. Whether to rebuild the app is Q3.

**The re-plan.**

| step | model | what |
|---|---|---|
| phase 0 | Opus 5.5 (the lead) | ref-SX0 + sx0-dests.json from pristine ⟨B⟩; the load pass (no bump); the golden mapping made unconditional; fixtures; record.mjs (base.json exact, as the probe showed); canonical-stream (`keepLay`); cv-cost / smpgen; the sweep |
| 0b | Sonnet | the re-points, without midi.test or the MPE cases; the sweep |
| D ∥ W | Opus 5.5 ∥ Sonnet | D1 = models + `SXM` + guard + host swap + serum-ui.js out + stand-in path out + every sim moved (canvas-3 triage) + MPE removals. Then **K** (Opus 5.5) from D1 (bounded). D2 = words, tray, art, sizes, remaining tests |
| after | Opus 5.5 | integration D → K → W; two reviewers (real engine; Chrome for Testing); fixers (Sonnet for one file, Opus across files); one sweep; deploy |

No Fable. What was cut: the bump and its pins, renderLast's seven-file triage, the open-ended kit hunt, MOD1's CSS leftovers, ref-WC's
escape clause and ref-SX0's p1 bullet.
