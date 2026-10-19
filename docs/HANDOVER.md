# SYNTH — handover briefing (2026-10-18, updated after stage 1e)

Written for the next agent taking over this project. Read it fully, then `docs/canvas/ROADMAP.md`. Project-wide rules are in `CLAUDE.md`
at the repo root (auto-loaded). The user is non-technical-friendly but very engaged: they test on their iPad Pro and Mac, give fast,
concrete UX feedback, and expect finished work to be pushed live.

## 1. What exists

**synth.domlavin.com (branch `main`, v=10)** — the live app:
- 12 classic synths emulated at circuit level (ZDF ladder/OTA/diode/Sallen-Key/SVF filters, polyBLEP oscillators, BBD chorus …), 64-bit
  AudioWorklet DSP, oversampling ×1/2/4/8 up to 384 kHz.
- Multitrack studio: tracks, MIDI recording, piano roll (`roll.js`), arrangement (`arrange.js`), quantize, copy/paste, MIDI file I/O, WAV
  bounce, undo (`song.js`).
- Serum 2 recreation (Phase 1 commit e530ddd, Phase 2 e50e450): wavetable/sample/granular/spectral oscillators, warps, 2 filters, mixer,
  FX buses, 10 LFOs, 4 ENVs, macros, mod matrix, arp/clip sequencer, MPE, tuning; design docs in `docs/serum/`.
- Serum-style FX rack on every track (`fx-core.js`, `fx-dsp.js`, `fx-ui.js`, `fx-mods2.js`).
- iPad work: WebKit playhead/latency clock with a Latency popover (Bluetooth preset), mono-chord warning, touch note editing, piano-roll
  pinch, two-finger false-press protection (`gesture.js`), mod-drag edge auto-scroll, folded powered-off Serum modules, no text selection.
- Installable PWA (`pwa.js`, `sw.js`, `manifest.webmanifest`) with offline cache and an "Update available — Reload" toast.

**canvas.domlavin.com (branch `canvas`, v=9)** — the modular infinite-canvas redesign, in progress (see §3).

## 2. The user — preferences and standing decisions (do not re-litigate)

- Zoom: native iPad page zoom only. An app-owned page zoom that reflowed the layout was built and REJECTED. On the canvas, zoom is a
  transform of the world layer (never reflows the page). Two-finger pan/pinch must always win over single-finger presses, and gesture code
  must stay passive so native scroll/pinch never wait.
- Trays slide and collapse; side trays (Sources/Effects) never close by themselves — only their rail, ✕ or Escape.
- Canvas: modules are NOT resizable (fixed sizes that fit content); classic synths default to fixed, hardware-accurate front panels with a
  per-module "Simple layout" alternative (⋯ menu and the Sources tray's Hardware | Simple switch); modules render identically at every
  zoom (no cards/LOD); grid fixed to the world (32 px dots, 128 px major) with snap-to-dots and a Snap toggle; Lock view toggle (minimap
  and zoom/fit buttons still move the view); NO module collision (requested then withdrawn — modules move freely).
- Canvas decisions from the spec questions: pinch on canvas zooms the canvas; FX panel = pedalboard of effects; start fresh on the canvas
  site (no library export/import, no change to main for it); mouse drag on empty canvas pans, Shift-drag box-selects; mod cables always
  shown; knob-turn undo keeps today's policy; Serum per instance: 3 OSC, 1 SUB, 1 NOISE, 2 FILTER; ONE mod wheel per project.
- Serum on the canvas (milestone 3): a VOICE hub per Serum (notes, poly/mono/legato, glide, bend, ENV 1 amp envelope); OSC/SUB/NOISE/FILTER
  modules plug into it; ENV 2–4, LFOs, macros, velocity, mod wheel are free mod modules cablable to any knob on any synth or effect.
- Press-and-hold on a Serum knob already offers mod sources — don't rebuild it.
- Orchestration scale: the user opted back into the full multi-agent process (contract → parallel builders → integrate → multi-dimension
  review with adversarial verification → fixes → one-file-at-a-time test sweep → deploy). If they mention usage limits, switch to lean
  (one builder + one review/fix agent; two reviewers for audio stages).
- Feedback sometimes comes secondhand from the user's brother (testing on another iPad, with Bluetooth audio) — verify before acting.
- Always: push live when done; keep `main` safe; never surprise the user with changes to the live site they didn't ask for.

## 3. Canvas redesign — status

Full design: `docs/canvas/SPEC-canvas.md` (+ "User decisions" at its end). Living tracker with every post-spec change:
`docs/canvas/ROADMAP.md` (it wins where it differs from the spec). Stage contracts/notes: `docs/canvas/IMPL-1b.md`, `IMPL-panels.md`,
`IMPL-1c.md`, `IMPL-1d.md`. Plain-language plan for the user: `docs/canvas/SUMMARY.md`.

| Stage | State |
|---|---|
| 1a Foundations (own storage `synth-canvas` DB / `synthc.` keys, schema gate, uid, bench page) | done |
| 1b Canvas shell (trays, camera world, Sources art, modules, derived cables) | done |
| 1b+ Hardware panels (12 synths, `cv-panel.js` + `panels/<model>.js`, 2 px/mm, Hardware/Simple) | done |
| 1c Instances + project v2 (schema 3, `cv-model.js` adopt(), canonical compile, classic-panel.js, multi-instance Serum UI, minimap, box-select, Save as classic project) | done |
| UI fixes (no resizing, Lock view, Hardware/Simple round trip, trays stay open) | done (3cd4509) |
| 1d Track engine (`engine.js` → Track / Inst / Chain, bit-identical; per-module CPU) | done (8094026); iPad bench after 1d PASSED (bench.json `"ipad1d"`) |
| 1e Several synths per track: graph engine, N instruments → shared / separate panels → OUT, editable cables, Effects tray, power, key zones, per-instrument MIDI learn / render-last / CPU, Measure this device, soft caps | done (IMPL-1e.md: contract §1–7, notes §8); iPad bench after 1e PASSED (bench.json `"ipad1e"`, row r 0.081). **UI withdrawn in 1f** (engine, model, fixes kept) |
| 1f One instrument per track (UI) — completes milestone 1 (canvas, trays, modules, read-only cables, one synth per track, Effects tray): the user found five hardware panels on one canvas unacceptably laggy on the iPad (pinch zoom mostly; pixelated, aliased panels when zoomed out). Drops replace, no ⏻ / zone pill / device items, read-only cables, Effects tray into the track's panel, several-instrument projects open split (`cv-migrate splitTracks`) | done (IMPL-1e.md §8.5) |
| **2a Performance modulators** (project Mod Wheel, Velocity, Aftertouch, Bend; mod list; cable inspector) + retiring the 1e transition accessors (IMPL-1e §8.3) | **NEXT** — SPEC §10 2a, §7.10 |
| 2b Modulation everywhere (LFO GLOBAL/PER NOTE, ENV, Macro, CC, Chaos on any Serum/FX knob + 237 classic controls) | planned |
| 3 Serum taken apart (VOICE hub + parts as modules) | planned |
| 4–6 later (full patching, per-voice classic modulation, polish) | later |

**Immediate next actions**
0. (1f, 2026-10-19) Several synths per track are out of the UI; the graph engine (`engine.js`), `cv-graph`, `cv-model`'s editing
   API, `cv-cost` and the per-device host code stay and are exercised by the hooks `__synthTest.cv.add / power / zone` (tests,
   `tests/ui-bench.html`). Bringing them back belongs to milestone 3's contract, which must first answer the canvas rendering
   question (ROADMAP feedback 2026-10-19, IMPL-1e §8.5: a smoothed low-resolution raster per module below a zoom threshold, plus
   ui-bench's two switches; measure the touch path and closer zooms on the iPad).
1. (Done 2026-10-19: `"ipad1e"` passed.) For the next engine stage, ask the user to run the iPad bench: `https://canvas.domlavin.com/tests/bench.html` in Safari on the iPad (plugged in, other
   apps closed), Run 5 passes, Copy results, paste. Check the JSON says `"stale": false` and names the deployed build (a browser whose
   service worker has not applied the update measures the previous build). Record it as `tests/bench.json` `"ipad1e"`: every row within
   5 % of `"ipad1d"`, the new row r ≤ 0.12 and within 25 % of the device factor (⚙ → Measure this device on the iPad shows it). Then the
   user tries 1f on the iPad (tile drags from both trays: a Sources drop replaces, an effect goes into the track's panel; a 1e
   project with several instruments in a track opens split, with the notice) and feedback goes into ROADMAP's table before 2a.
2. Start stage 2a with the full process (contract → parallel builders → integrate → multi-dimension review with adversarial verification →
   fixes → one-file-at-a-time sweep → deploy). Scope per SPEC §10 2a and §7.10; add the 1e leftovers of IMPL-1e §8.3 (retire the
   transition accessors — ≈ 180 `t.model` / `t.vals` / `fxOf(t)` sites that mean the primary —, the primary-only paths). The 1e process
   worked well: four parallel lanes with exclusive files, one integration lane after, four reviewers that each reproduce findings by
   script, three fixers that write the failing test first; keep it.
3. After every stage: update ROADMAP (status + feedback table), commit on `canvas`, `tools/deploy-canvas.sh`, tell the user what to try.

## 4. Architecture map (canvas branch)

- `main.js` — app boot, project/state, transport, keyboard, menus, track list, canvas wiring (cvView, cvTidy, makeRoom, monitors, cvCpu).
- `engine.js` — AudioWorklet processor: `Track` (registered `synth-engine`) holding N `Inst`s and M shared `Chain`s (stage 1e graph: `{t:'graph'}`, `patch i`, `chain c`, `power`; alias paths keep today's shapes bit-identical; IMPL-1e §2); facade keeps legacy callers working.
  DSP scripts loaded before it in order (sx-base, sx-filt2, sx-warp, sx-mod, sx-sample, sx-gran, sx-spec, sx-seq, fx-mods2, serum-dsp,
  fx-dsp, engine).
- `cv-graph.js` (compileTrack / compileGraph: canonical v1 view or the graph messages), `cv-model.js` (the editing API: addInst, connect, setPower, setZone, makePrimary, setModel, sharedPanelFix …; adopt + transition accessors), `cv-cost.js` (cost table, estimates, soft caps, Measure this device Worker).
- `main.js` 1e: `instView(t, dev)` (a track-shaped view of any instrument; the primary is the track), `curDevs` (the current instrument), per-device `classicPanels` / `serumPanels` / `fxPanels`, `sendGraph` + per-Inst / per-chain caches, `legacyOk` (one-instrument tracks keep today's message stream), `partsOf` / monitors by device.
- `models.js` (model definitions/params), `serum-core.js`/`serum-dsp.js`/`sx-*.js` (Serum), `fx-*.js` (FX), `laws.js`, `tuning.js`.
- Canvas UI: `cv-world.js` (camera, grid/snap, Lock view, gestures hooks, toolbar, minimap, box-select), `cv-module.js` (module chrome,
  fold, menu, CPU slot), `cv-cables.js`, `cv-tray.js` (top/side trays, Sources), `cv-art.js` (instrument illustrations), `cv-panel.js` +
  `panels/*.js` (hardware panels), `classic-panel.js` (Simple/flow panels), `cv-model.js` / `cv-migrate.js` / `cv-graph.js` / `cv-mods.js`
  (data model, migration, compile, mod descriptors).
- `gesture.js` (two-finger layer), `wk.js` (Serum UI kit: knobs, dragSource with edge auto-scroll, zoomPan, menus), `serum-ui.js`,
  `sx-ui-*.js`, `graph.js`, `wtedit.js`, `roll.js`, `arrange.js`, `audioclock.js`, `appstore.js` (IndexedDB store), `pwa.js`, `sw.js`.
- Tools: `tools/precache.mjs` (sw.js precache + BUILD), `tools/deploy-canvas.sh`, `tools/make-icons.mjs`, `tools/cv-classes.mjs`,
  `tools/panel-check.mjs`.

## 5. Lessons learned (avoid repeating)

- Parallel full-suite test runs crashed the Mac (kernel panic). One test file at a time; a memory watchdog script that kills node test
  processes above ~6 GB RSS was useful during big parallel builds (recreate in your scratchpad if needed; scratch dirs don't survive).
- A failing `assert.equal(fakeDomNode, …)` ate 32 GB. Never pass fake-DOM nodes to assert.
- Disk-wide `find /` from an agent triggered macOS prompts for the user's external drive and Dropbox — alarming for the user.
- WebKit specifics that bit us: `getOutputTimestamp()` is render-stamped (playhead runs ahead by the output latency, Bluetooth ~200 ms);
  worklet warm-up stalls permanently add latency on iOS (hence suspend-until-ready); touch-action resets at scroll containers; script
  scrolls aren't clamped immediately on iOS; 1 ms timer resolution; non-passive window touch listeners delay native scroll.
- Long agent runs die if the Mac sleeps (lid closed) or the usage limit hits; work in the tree survives — resume the agent with a message.
- The harness creates agent worktrees from `main` (ee2a939), not from `canvas`: every builder must `git reset --hard <base>` first (the 1e briefs say so; check `git log -1` in each worktree before merging).
- The 1e review round (four reviewers reproducing by script) found ~35 real bugs the lane tests missed (undo copying sound across devices, a deleted panel re-inserted by an accessor, removed parts fading at the wrong gain, the minimap swallowing clicks on stacked modules…); fixers that write the failing test first refuted nothing and left a 70-test trail. Keep both steps.
- The stacked-modules layout puts a second instrument's bar where the floating minimap was: any overlay over the canvas must be reserved out of `world.band()`.
- Review rounds reliably found real bugs that tests missed (stuck preview voices, playhead freeze, header wrap, wrong-track taps, page
  zoom over the FX rack, MIDI OUT to self after the engine split). Keep at least one real review per stage.

## 6. Infrastructure

- GitHub: `CorrugatedCarl/synth` (public; branches `main`, `canvas`), `CorrugatedCarl/synth-canvas` (public; Pages only, force-pushed by
  the deploy script). `gh` CLI is authenticated on the Mac.
- Pages checks: `gh api repos/CorrugatedCarl/<repo>/pages/builds/latest --jq '.status + " " + .commit[0:7]'`; live BUILD:
  `curl -s https://<site>/sw.js | grep BUILD`.
- Commit messages: descriptive subject + body; end with your harness's co-author attribution line.
