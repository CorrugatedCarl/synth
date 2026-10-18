# SYNTH — handover briefing (2026-10-18)

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
| **1e Several synths per track** (completes milestone 1) | **NEXT** — SPEC §10 1e, §6 |
| 2a Performance modulators (project Mod Wheel, Velocity, Aftertouch, Bend; mod list; cable inspector) | planned |
| 2b Modulation everywhere (LFO GLOBAL/PER NOTE, ENV, Macro, CC, Chaos on any Serum/FX knob + 237 classic controls) | planned |
| 3 Serum taken apart (VOICE hub + parts as modules) | planned |
| 4–6 later (full patching, per-voice classic modulation, polish) | later |

**Immediate next actions**
1. (Done 2026-10-18) The iPad bench after 1d is recorded as `tests/bench.json` `"ipad1d"`: every row within 5 % of the pre-split
   `"ipad"` baseline, so 1d passes on the iPad. Future re-runs (1e, 2b, 5) compare against `"ipad1d"`. When asking for a run, check the
   pasted JSON says `"stale": false` and names the deployed build: Chrome's service worker keeps serving the previous build until its
   update is applied (Safari on the iPad, with no cached copy, measures the server files directly).
2. Start stage 1e with the full process. Scope per SPEC §10 1e (graph/patch/chain/power protocol; N Insts → shared or separate panels →
   OUT; editable audio cables; Effects tray; power; key zones; per-instrument MIDI learn etc.), honouring ROADMAP's feedback table
   (fixed sizes, no collision, trays never auto-close, Lock view, Hardware/Simple). Acceptance includes bit-exact canonical tracks and the
   two-sequencer-free-Insts sum test.
3. After every stage: update ROADMAP (status + feedback table), commit on `canvas`, `tools/deploy-canvas.sh`, tell the user what to try.

## 4. Architecture map (canvas branch)

- `main.js` — app boot, project/state, transport, keyboard, menus, track list, canvas wiring (cvView, cvTidy, makeRoom, monitors, cvCpu).
- `engine.js` — AudioWorklet processor: `Track` (registered `synth-engine`) / `Inst` / `Chain`; facade keeps legacy callers working.
  DSP scripts loaded before it in order (sx-base, sx-filt2, sx-warp, sx-mod, sx-sample, sx-gran, sx-spec, sx-seq, fx-mods2, serum-dsp,
  fx-dsp, engine).
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
- Review rounds reliably found real bugs that tests missed (stuck preview voices, playhead freeze, header wrap, wrong-track taps, page
  zoom over the FX rack, MIDI OUT to self after the engine split). Keep at least one real review per stage.

## 6. Infrastructure

- GitHub: `CorrugatedCarl/synth` (public; branches `main`, `canvas`), `CorrugatedCarl/synth-canvas` (public; Pages only, force-pushed by
  the deploy script). `gh` CLI is authenticated on the Mac.
- Pages checks: `gh api repos/CorrugatedCarl/<repo>/pages/builds/latest --jq '.status + " " + .commit[0:7]'`; live BUILD:
  `curl -s https://<site>/sw.js | grep BUILD`.
- Commit messages: descriptive subject + body; end with your harness's co-author attribution line.
