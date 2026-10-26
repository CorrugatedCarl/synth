# SYNTH — handover briefing (2026-10-18, updated after stages 1f, 1g, 2a, 1h and 2b)

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
  zoom (no cards/LOD); grid fixed to the world (32 px dots, 128 px major) with snap-to-dots ALWAYS on (no toggle since 2026-10-22); Lock view toggle (minimap
  and %/fit buttons still move the view); the toolbar has no ⊖/⊕ and folds to one button; NO module collision (requested then withdrawn — modules move freely).
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
| 1g Canvas rendering at zoom — the grid on a device-px canvas (`cv-world gridDraw`: no flicker, aligned dots), hardware faces as smoothed bitmaps below 100 % (`cv-panel faceTier`), the top tray's grip keeps the canvas still (ROADMAP feedback 2026-10-19) | done (IMPL-1e.md §8.5) |
| 2a Performance modulators (project Mod Wheel, Velocity, Aftertouch, Bend cabled to Serum knobs / own FX; rows injected at compile; inspector; Mod list; ∿ visibility; live-wheel broadcast) | done (IMPL-2a.md); **the user's iPad try pending** (touch drag onto a knob, two-finger cancel) |
| 1h GPU faces and grid — the dot grid as a procedural WebGL shader (exact dot centres every frame, nothing stored or transformed) and every hardware face as a GPU texture held ≥ 1 device px per on-screen px (a mipmapped base for k ≤ 1, a finer budgeted window of the visible part above 1), one WebGL2 canvas under the world (`cv-gl.js`, `cv-face.js`); the picture mid-pinch and at rest is the same — the user's three 2026-10-19 rules (no resolution "rendering in" at a zoom end, the grid as a precise measurement tool, devices never below 1:1). The 2D grid + the 1g bitmap tier stay as the fallback (`?nogl`, pref `synth.cv.gl = off`) | done (IMPL-1h.md: contract §1–7, notes §8 incl. the review round); **iPad verdict 2026-10-19: "pinch zoom feels great, no hitching"** (ui-bench G1/G3 pass on the device; the window cap bottomed at 4e6 — a window paint is 79 ms on the iPad — so faces are ≥ 1:1 to 100 %, the base texture above; accepted) |
| 2b Modulation everywhere — ModCore in the worklet (`mod-core.js`: a voice-less Serum modulation state + a "most recent note" pseudo-voice per track), LFO (GLOBAL / PER NOTE) / ENV / Macro / CC / Chaos / Note modules, every modulator on every Serum knob (ext sources, per-note slot injection, linked Serum LFOs/ENVs), every FX knob (chain `setMods` vectors) and 236 classic controls (tier-1 slot offsets + span setters with transfer tables), classic halos + press-and-hold mod menu, live meters — **completes milestone 2** | done (IMPL-2b.md; 48 review findings fixed failing-first; V8 and JSC gates passed; goldens bit-identical); **iPad bench after 2b recorded** (`ipad2b`: new rows ≤ targets; i 0.055 / c4 0.025 marginally over the 5 % band — device noise per the JSC A/B; re-run if it matters) |
| 1i Hardware keyboards — every hardware synth's real keyboard (key count, range, position) and working controllers (wheels, levers, ribbon, pad) baked into its GL face, DOM hit zones / shades on top (`cv-keys.js`); velocity only on CS-80 / DX7 / 303 accent; aftertouch by Apple Pencil; bend ±2 | done (IMPL-1i.md; squashed commit "1i" on `canvas`; 2 reviews, 11 findings fixed failing-first; goldens bit-identical); **deployed 2026-10-20 (95d117f)** after the user's S0 session; pending the user's hands-on |
| 3 Serum taken apart (VOICE hub + parts as modules, Serum-faithful modulators, accessors retired) | **done, deployed 2026-10-20 (e75eff2)** (IMPL-3.md; S0 `"ui-m3"` §9.0; Q2 whole panel → parts opt-in; 2 reviews, 18 findings fixed; swept 85 files); pending the user's hands-on + `?m3=1&real=1` (`"ui-m3b"`) |
| 3R GPU module painter (Serum parts drawn on the GPU, no soft look mid-pinch) | parked: the user accepted soft-while-pinching ("save the soft pinching fix for later maybe"); research `docs/canvas/map-rendering.md` |
| 7a TR-808 (first drum machine) | **done, deployed 2026-10-20** (IMPL-7a.md; lanes V, S, E, P1, P2, H2, H1; 2 reviews → 16 findings fixed + the vertical-switch direction on every panel; `tests/ref-7a` frozen; swept 91 files / 2557 tests); pending the user's `bench.html` (`"ipad7a"`) + §12.8 hands-on |
| 7b TR-606 | **done, deployed 2026-10-20** (IMPL-7b.md; lanes V6, S6, E6, P1, X, H1; 2 reviews → 12 findings fixed; `tests/ref-7b` frozen at e697387 (golden-606) beside ref-7a (golden-drums); swept 94 files / 2700 tests); pending the user's hands-on |
| 7c TR-909 | **done, deployed 2026-10-21** (IMPL-7c.md; lanes V9, R9 (our ROM images), S9, E9, P1, X, H1; 2 reviews → 10 findings fixed; `tests/ref-7c` frozen at 31bb09a (golden-909) beside ref-7a / ref-7b; swept 98 files / 2873 tests); pending the user's hands-on and sound comparison (they will research the originals later) |
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
2. (Done 2026-10-19.) Stage 2a shipped with the full process; next is **stage 2b** with the same process (contract → parallel builders → integrate → multi-dimension review with adversarial verification →
   fixes → one-file-at-a-time sweep → deploy). Scope per SPEC §10 2a and §7.10; add the 1e leftovers of IMPL-1e §8.3 (retire the
   transition accessors — ≈ 180 `t.model` / `t.vals` / `fxOf(t)` sites that mean the primary —, the primary-only paths). The 1e process
   worked well: four parallel lanes with exclusive files, one integration lane after, four reviewers that each reproduce findings by
   script, three fixers that write the failing test first; keep it.
3. **HANDOFF (2026-10-19, to an Opus chat — the user's Fable budget is spent for the week).** State: `canvas` at the deploy commit, canvas.domlavin.com live with 1h + 2b; the iPad verdict is in ("pinch zoom feels great, no hitching"; "everything feeling good so far" on 2b after a short try); `ipad2b` recorded. Open: a longer hands-on of 2b on the iPad (a PER NOTE LFO / ENV, a Macro on several knobs, a CC module with MIDI learn, the classic knob long-press menu, halos, the Mod list) and any feedback into ROADMAP's table; the two marginal bench rows (i, c4) if a re-run is wanted. **Process from here (the user's decision, 2026-10-19): leaner** — cheaper models for mapping / mechanical lanes / fixers, two reviewers (one with the real engine, one in the browser) instead of four, one sweep, shorter briefs; keep: a contract first, builders in worktrees reset to the base, failing-test-first fixes, one file at a time, goldens bit-identical. Next stage: **milestone 3** (below).
4. (Done 2026-10-19.) Stage **2b** shipped with the full process (five lanes incl. a ModCore spike first, four reviews, three fixers). **Pending on the iPad**: `canvas.domlavin.com/tests/bench.html` five passes → `tests/bench.json` `"ipad2b"` (old rows within 5 % of `ipad1e`; new rows mc0 / mc / mt / me / mk / ms ≤ their iPad targets; a run must say `"stale": false` and name the deployed build), and the hands-on try: drop an LFO, cable it to a Serum knob, a Juno cutoff and a panel knob; a PER NOTE LFO / ENV; a Macro sweeping several knobs; a CC module with MIDI learn; the classic knob long-press menu; halos; the Mod list. Known limits if asked: classic `chunk` controls (180) and true per-voice classic modulation are stage 5; a Serum's own matrix page shows injected rows read-only. **Next: milestone 3** (Serum taken apart, SPEC §8 / §10 3): its contract must first answer the many-modules rendering question (1h's GL faces cover hardware panels only; Serum parts are DOM) and retire the 1e transition accessors (IMPL-1e §8.3; the primary-only paths listed in the 2b host map).
5. (2026-10-19, after 2a.) The user's rendering feedback produced stage **1h** (IMPL-1h.md): GPU grid + faces. Pending: the user's iPad verdict on canvas.domlavin.com — a fast pinch past 60 % and up to 200 % with several hardware panels (no snap on the grid or the faces, no hitch at the rest), the four wood cases, a module dragged over another (the face falls to the 1g tier while they overlap). The DOM parts (controls, module chrome, Simple / Serum / FX modules) still follow WebKit's own pinch behaviour (compositor-scaled, re-rastered at rest): if that still bothers the user, the next rendering stage is the hardware controls as GPU sprites (IMPL-1h §4). Then stage 2b.
7. **(2026-10-20, Opus chat after the Fable handoff.)** Holding branches (never deploy one directly; each lands on `canvas` as a
   merge / squash): `wt-m3` (milestone 3; scratch worktree `scratchpad/m3-wt`), `wt-1i` (squashed onto canvas as "1i"), `wt-7a`
   (808). Waiting on the user: the S0 iPad session at `canvas.domlavin.com/tests/ui-bench.html?m3=1` (steps in IMPL-3 §1.5 / the
   page) → record `"ui-m3"`, ask Q2 (parts or whole panel by default), apply §1.5's table → deploy 1i at once → the user's 1i
   session → milestone 3 merged and deployed (e75eff2) → `?m3=1&real=1` (`"ui-m3b"`) pending. 808: all lanes + both fix rounds on `wt-7a` (b47543f); next: merge canvas, sweep, freeze `tests/ref-7a`, one squashed "7a" commit, deploy.
8. **(2026-10-21.)** Drums 808 → 606 → 909 deployed; **stage 7d + 8 (pad controller + Simmons SDS-V) deployed** as one squashed
   commit on `canvas` (holding branch `wt-8`; contract IMPL-8; `tests/ref-7d` frozen beside ref-7a / 7b / 7c — any change to
   dr-808.js / dr-seq.js / engine.js keeps all four bit-identical). The user isn't a drum-machine expert yet: drum sound feedback comes
   later from their own research — don't block on it. Pending from the user, whenever they like: `ui-m3b`, `ipad7a` bench, hands-on of
   the keyboards / Serum parts / drums / Pads. Next on the roadmap: stage 9 (Moog Modular module by module), then stages 4–6; 3R
   (the GPU module painter, "soft while pinching") parked.
9. **(2026-10-22.)** **Stage 9 (the Moog Modular, module by module — the Model 15 set as the "900 Series") deployed** as one squashed
   commit on `canvas` (holding branch `wt-9`; contract IMPL-9; `tests/ref-9` frozen beside ref-p1 / 1c / 7a–7d). Physics patch cords
   (only on instruments patched with cords in real life; only the plug ends take touches). Also this day: the canvas always snaps to the
   grid (no magnet), the toolbar collapses to one button, no zoom −/+; the bundled Serum's touch line removed; synth.domlavin.com is
   obsolete but stays online untouched. Pending from the user: the `?m9=1` iPad session, `ui-m3b`, `ipad7a`, hands-on. Next: System 35 / 55
   modules, then the ARP 2600 / MS-20 patch panels on the same engine; later the Colossus (row 11), our own synth (row 10), a standalone
   offline app (row 12).
10. **(2026-10-22.)** **Stage 9b (the System 35 / 55 sets: 16 Moog module types incl. the 960 sequencer, our Song clock, routing panels,
   set tiles, seven presets) deployed** as one squashed commit on `canvas` (holding branch `wt-9b`; contract IMPL-9b; `tests/ref-9b` frozen).
   The user: no per-stage iPad sessions (one real-device pass after the features); performance presets Low / Medium / High next (ROADMAP 14:
   mid-range Android too — the iPad Pro is the ceiling), then the Master canvas (13); monetisation (15) after the features.
11. **(2026-10-22.)** **Stage P (performance presets, ROADMAP 14) deployed** as one squashed commit "P" on `canvas` (holding branch
   `wt-P`; contract IMPL-P). ⚙ → Canvas → Performance (High / Medium / Low; every device starts on High; visual only: face textures and
   cord physics — never audio, the ⚙ Oversampling untouched); no artificial caps (512 modules / 4 096 cords a patch, 1 024 devices a
   track, 64 Pads, ids to m999999; schema 13); Panic in the top bar (and Esc); the right Effects tray gone (its estimates in each rack's
   "+"), Sources / keyboard / track list fold to pull tabs. Next: **the Master canvas** (ROADMAP 13, contract `docs/canvas/IMPL-M.md`,
   skeptic-reviewed, the user's answers in its header) — G0 (the base's bounce hashes) by the lead from the "P" commit, then lanes D / U
   (phase 1) and A (phase 2).
12. **(2026-10-23.)** **Stage M (the Master canvas, ROADMAP 13) deployed** as one squashed commit "M" on `canvas` (holding branch
   `wt-M`; contract IMPL-M; `tests/ref-M` frozen: G0's base bounce hashes + MASTER's output and meter readings). An always-on
   `synth-master` processor (registered before `synth-engine`) between the tracks' pans and the Volume; schema 14 (`project.master`);
   canonical-stream split by processor name (the `synth-engine` part = main's fixture). Next on the roadmap (the user's order): 9c (1960s
   Moog extras), the ARP 2600 / MS-20 patch panels on the 900 Series engine, the Colossus (11), our own synth (10), the standalone offline
   app (12); one consolidated real-device iPad pass after the features; the commercial release (15) after that.
13. **(2026-10-23.)** **Stage 9c (the 1960s Moog extras) deployed** as one squashed commit "9c" on `canvas` (holding branch `wt-9c`;
   contract IMPL-9c; `tests/ref-9c` frozen beside ref-9 / ref-9b; golden-moog-c). The user doesn't expect to patch the Moog much
   ("not having it physically defeats why it's pleasurable") and asked for **the standalone app next** (ROADMAP 12), before the patch-panel
   stages: Xcode 27.1 is installed (`xcode-select` → Xcode), the iOS 27.0 simulator runtime holds the iPads (27.1's only the "iPhone
   Duo"); the simulator **SYNTH iPad Pro 13** (iOS 27.0) exists. Process: Fable 5.1 for the spike / contract / native bridges / reviews,
   Opus 5.5 for builders, Sonnet for mechanical lanes. The user's Apple Developer account / TestFlight is their step.
14. **(2026-10-23.)** **Stage A (the iPad app) built** (contract IMPL-A; the spike spike-app.md): `app/ios/SYNTH.xcodeproj` (hand-written
   pbxproj + `Config.xcconfig`; the team / a bundle-id suffix only in the gitignored `app/ios/Local.xcconfig`, included last), Swift ≈ 600
   lines (scheme handler, downloads, dialogs, audio session, lifecycle); the site enters the bundle from **HEAD** via
   `tools/app-bundle.sh` (commit first — a dirty tree refuses); **`tools/app-smoke.sh`** builds, installs and checks the app on the
   simulator **SYNTH iPad Pro 13** (iOS 27.0; `-smokeMode log` for by-hand review). The web side: the fonts are local (`fonts/`, OFL texts
   precached), the shell seams dormant in browsers (`window.SYNTH_SHELL`). To install on the user's iPad (their free Apple ID): they add the
   Apple ID in Xcode → Settings → Accounts, connect the iPad by cable (Trust), turn on Developer Mode; the lead builds signed with the
   personal team and installs (`xcrun devicectl`); every 7 days a reinstall. **Installed on the user's iPad 2026-10-23** (team 4RXV48235Y in the gitignored Local.xcconfig, bundle id `com.domlavin.synth.personal`; `xcrun devicectl device install app`; the user trusted the developer in Settings → General → VPN & Device Management; re-sign within 7 days) — "feeling great … smoother than browser version". Stage B next: CoreMIDI and the Mac (Pencil haptics dropped by the user).
15. **(2026-10-24.)** **Stage B (hardware MIDI in the iPad app) done** (contract IMPL-B): CoreMIDI (`app/ios/SYNTH/Midi.swift`) feeds the
   page's Web MIDI shim (`MidiShim.js`, a WKUserScript; midi.js unchanged). Tools: `tools/midi-harness/run.sh` (the real Midi.swift on the
   Mac against a fake host — run it after any Midi.swift change), `tools/midi-sender.swift` (sends into the app's "SYNTH" input from
   `xcrun simctl spawn`, the simulator's only "other app"). **The user's first MIDI test** (no gear yet — a MIDI-keyboard app): open SYNTH and
   play one key (or press Power) first; put the keyboard app **beside SYNTH in Split View / Slide Over** (full-screen in front, iPadOS
   suspends SYNTH after ≈ 30 s in the simulator — the device may differ); in the keyboard app pick the output **"SYNTH"** (or its own
   virtual output — not both: doubled notes); SYNTH's MIDI button reads "MIDI: From other apps"; a stuck note → Panic. No Mac version.
16. **(2026-10-24.)** **Stage SC (sidechain ducking, ROADMAP 17) deployed** as one squashed commit "SC" on `canvas` (holding branch
   `wt-SC`; contract IMPL-SC): a **Ducker** effect (type `duck`; TRIGGER = another track's notes, NOTE filter, 1/8 synced, 100 %, SHAPE
   presets + an inline curve) and the **Compressor's sidechain key** (v3 only once keyed: KEY INT | EXT, FROM, KEY HPF, LISTEN); every
   Track node has one input; key edges are GainNodes (`N.scIn`); a muted / soloed-out / fader-0 source still ducks (the bounce renders it
   at gain 0); cycles refused; schema 15. Browser only (the browser-first rule). **Open P3s** (IMPL-SC §12 review 2): a source pasted via
   the rack clipboard is not re-checked (a refused one looks normal; a paste can take over a working edge — `clipIn` → `S.ok()`, `srcState`
   warns); the master's Ducker dips ≈ 1 ms (the tracks' 47-sample look-ahead) before the kick arrives. Not yet frozen: a golden of a
   Ducker / keyed-compressor render (G2 / G3 are exact formula tests). Live Safari on the Mac is unchecked (needs the user's click).
17. **(2026-10-26.)** **Stage R + the Windows idle-DSP fix deployed** as one squashed commit "R" on `canvas` (holding branch `wt-R`;
   docs/canvas/IMPL-R.md, IMPL-SC §12): recording overwrites same-pitch notes (Ableton), one undo step per loop pass (Ctrl+Z while recording
   too; held notes kept out of the engine until key-up), the piano roll lights its keys and notes for what the engine plays (live + playback).
   The user's Windows report (DSP climbing to 100 % while stopped): float32 / float64 subnormals in never-calm racks and instruments —
   FXRack.sweep (reverb pools after ≥ 1 s of silence), FXRack.rest (one spread pass when a track enters its idle skip), the drums' / Solina's /
   output stage's states flushed, the Juno's hiss silent with its skip (the lead's call), the CPU safeguard arms only while something sounds
   and never saves a lowered ⚙ Oversampling. Reviewed by ultracode workflows (6 + 5 reviewers, 3 skeptics per finding, fix → verify loops).
   **Tell the user**: on the Windows PC check ⚙ Oversampling (the old safeguard may have saved 1×).
18. **(2026-10-26.)** **Wavecraft WC-1 + the TAP tempo button deployed** as one squashed commit "WC-1" on `canvas` (holding branch
   `wt-WC`; contract docs/canvas/IMPL-WC.md + map-wc.md): our own modular synth on the Serum engine (model `rig`, the name only in
   `RIG.NAME`), its own faces on one grid (rig-ui.js), physics cords on the Wavecraft canvas only (lines elsewhere; `RIG.WIRES` the regret
   switch), a mod cord ends at its knob's rim ("directly to the back of the knob"), the Amplifier's KEYS gate (3 ms), modulators above
   what they drive (rig Tidy), Serum complete without Show parts, schema 16, charcoal skin + Archivo Narrow. TAP: beside BPM (⋯ under
   900 px), the mean of the last 8 taps, whole BPM, one undo step per run. Built by workflows (contract + skeptic, lanes S/K/C/F/U/H,
   2 reviews, an in-app check, fixers with skeptic loops), 145 test files green. **Next: the user's hands-on** — §12's "ask after"
   list (the Amplifier's presence, cords vs lines, the 3 ms, auto-plug, the portrait Fit floor, first-view / Tidy zoom with the track
   list open, the badge over the Filter's display after Tidy) — then WC-2. Browser tests use Chrome for Testing (CLAUDE.md).
6. After every stage: update ROADMAP (status + feedback table), commit on `canvas`, `tools/deploy-canvas.sh`, tell the user what to try.

## 4. Architecture map (canvas branch)

- `main.js` — app boot, project/state, transport, keyboard, menus, track list, canvas wiring (cvView, cvTidy, makeRoom, monitors, cvCpu).
- `engine.js` — AudioWorklet processor: `Track` (registered `synth-engine`) holding N `Inst`s and M shared `Chain`s (stage 1e graph: `{t:'graph'}`, `patch i`, `chain c`, `power`; alias paths keep today's shapes bit-identical; IMPL-1e §2); facade keeps legacy callers working.
  DSP scripts loaded before it in order (sx-base, sx-filt2, sx-warp, sx-mod, sx-sample, sx-gran, sx-spec, sx-seq, fx-mods2, serum-dsp,
  fx-dsp, engine).
- `cv-modlayer.js` (2a: the cable inspector, Mod list and parameter list; host interface in IMPL-2a §4), `cv-mods-ui.js` (2a: the wheel / velocity / aftertouch / bend module bodies), `cv-mods.js` (descriptors, `destOk`, `sourcesOf`, `wheelTracks`); `track.mods` rows + `track.mid`, `project.perf.wheel`, schema 5; `cv-graph.injectMods` / `modBudget`; `main.js` `modVals` (injection), `ctl` wheel broadcast, the "cv MODULATION" section (modPre / modStep / modUnstep / modMoveBack History glue), `__synthTest.cv.mod` / `.modUI` hooks.
- `cv-graph.js` (compileTrack / compileGraph: canonical v1 view or the graph messages), `cv-model.js` (the editing API: addInst, connect, setPower, setZone, makePrimary, setModel, sharedPanelFix …; adopt + transition accessors), `cv-cost.js` (cost table, estimates, soft caps, Measure this device Worker).
- `main.js` 1e/1f: `instView(t, dev)` (a track-shaped view of any instrument; the primary is the track), `curDevs` (the current instrument — since 1f always the primary), per-device `classicPanels` / `serumPanels` / `fxPanels` (one each per track since 1f), `sendGraph` + per-Inst / per-chain caches (dormant: every track is canonical since 1f, `legacyOk` keeps today's message stream), `partsOf` / monitors by device, `cvAddInstrument` reachable only as the `__synthTest.cv.add` hook; `cv-migrate.splitTracks` splits multi-instrument projects on load.
- `models.js` (model definitions/params), `serum-core.js`/`serum-dsp.js`/`sx-*.js` (Serum), `fx-*.js` (FX), `laws.js`, `tuning.js`.
- `mod-core.js` (2b: the worklet ModCore — `SerumDSP.attach` on a shim, the pseudo-voice, `setRows` from the `{t:'mods'}` payload, `span` → `ext` / `cls0`/`cls1` / `setv` / `fxv` / `live`, the warm-up payload), `engine.js` 2b regions (Track: `mc`, `modPre`, `wheel/at/bendRaw`, `nHeld`/`holdM`, `modsMsg`/`modsErr`, `warmMods`; Inst: `modRows`/`modSpan`/`modEff` — the classic adapter), `sx-mod.js`/`sx-base.js`/`serum-dsp.js` NSRC 78 + ext copies, `serum-core.js` `compileSerum(s, {ext: true})`; `cv-graph.js` `compileMods` (the synthetic CP, keep-alive rows, parked slots, ext allocation, per-note injection, the hash signature memo, `pay.slots`), `cv-mods.js` (`targetsOf`/`depsOf`/`xferOf`/`knobOf` transfer maths, `destOk` per class), `cv-model.js` (`addModDev`/`setModState`/`pruneRows`), `main.js` (`buildMods`/`postMods` content-keyed with the 66 ms drag throttle, `modVal` → `{t:'mval'}`, `cpHalos`/`cpSnap` classic halos, `mcMonitor` live meters, `fxPrune`), `cv-mods-ui.js` (the six bodies), `classic-panel.js` (`setMods`/`setLive`, the long-press menu).
- `cv-gl.js` (1h: the WebGL2 layer — grid shader, textured face quads with a rounded-rect clip and a gray uniform, upload/free, context loss) and `cv-face.js` (1h: the hardware-face registry — modes gl / dom / svg, base + window textures, the raster queue (one job per frame, never in a burst, split raster/upload over 8 Mpx), budget, the adaptive window cap `synth.cv.winpx`, the overlap rule against every world item, the patching / power dims as quad alpha + gray).
- Canvas UI: `cv-world.js` (camera, grid/snap, Lock view, gestures hooks, toolbar, minimap, box-select; 1h: the GL path `buildGL`, `glStats`, `rectOf`), `cv-module.js` (module chrome,
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
- 2b lessons: a content key that holds a knob's own value reposts on every drag frame — throttle reposts and keep live values (macros, CC) out of the key; memoise anything that sweeps `models.js map()` (`targetsOf` per (model, ctl), `xferOf` per (model, ctl, target, deps)) — a 17 ms compile per knob turn became 0.04 ms; JavaScriptCore tiers the shared SxMod/AVoice code to whichever receiver shape it saw last — warm up every new mode (the ModCore round) and re-warm the plain paths after it; a bypassed row must not decide whether a source is evaluated (keep-alive rows for every listed source); reviewers reproducing with the real engine (not the lane's stub) found the FX index and the set-rows-as-slots bugs the lane tests missed.
- Rendering at zoom (1g → hotfixes → 1h): anything rasterised at the rest zoom and scaled by the compositor during a pinch "renders in" when the finger lifts — the user rejects that (a bitmap grid, the bitmap face tier, WebKit's own layer re-raster). The fix that holds is GPU-resident content drawn every frame from sources that never change at rest (a procedural grid shader, mipmapped textures); per-frame CPU rasters/uploads (a full-viewport 2D canvas) are the hitch. The headless-Chrome CDP harness (`--headless=new --use-angle=metal --force-device-scale-factor=2`) measures what the browser pane cannot (its rAF runs at ~2/s).
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
- 1f pre-split copy: when the canvas build splits an autosave whose tracks held several instruments (stage 1f), the stored
  project as it was is kept once under the store key `synth.project.pre1f` (database `synth-canvas`, object store `kv`, key
  `synthc.project.pre1f`; localStorage `synthc.project.pre1f` in the fallback mode), written before the first save and never
  overwritten. Recovery is by hand, on the same origin (canvas.domlavin.com: Safari's Web Inspector from the Mac with the iPad
  connected → Storage → IndexedDB): copy the record's text into a `.synth.json` file; a stage-1e build opens it as it was, this
  build opens it split.
