# SYNTH Canvas: roadmap and status

This is the living tracker for the canvas redesign. The design is [SPEC-canvas.md](SPEC-canvas.md) (with the user's decisions at its end) and the plain-language version is [SUMMARY.md](SUMMARY.md). This file records **where we are**, **every change the user's feedback has made to the plan**, and **what comes next**. Update it at the end of every stage.

- **Branch:** `canvas` of CorrugatedCarl/synth. `main` stays live at synth.domlavin.com and is never merged into or overwritten by canvas work ("in case I regret it").
- **Preview:** canvas.domlavin.com (repo CorrugatedCarl/synth-canvas), deployed with `tools/deploy-canvas.sh` from the committed `canvas` HEAD. The canvas site has its own storage and starts fresh.
- **Every stage:** build → independent review with adversarial verification → fixes → every test file run one at a time → deploy → the user tries it on the iPad → feedback folded in before the next stage.

## Stages

| Stage | What it delivers | Status |
|---|---|---|
| 1a Foundations | Own storage (`synth-canvas` DB, `synthc.` keys), schema gate + read-only open, project uid, platform message, skeletons, iPad bench page | **Done** (1f6721b) |
| 1b Canvas shell | Top tray, keyboard tray, Sources tray with original illustrations, camera world, movable modules, derived cables | **Done** (1f6721b) + feedback fixes below |
| 1b+ Hardware panels | Fixed, hardware-accurate front panels for the 12 classic synths; Hardware/Resizable layout toggle in each module's ⋯ menu; zoom never changes how modules look | **In progress** |
| 1c Instances + project v2 | ClassicPanel instances, multi-instance Serum UI, project v2 + migration, canonical compile, Save as classic project, minimap, box-select, track-switch mounting | Next |
| 1d Track engine | `engine.js` split into Track / Inst / Chain, bit-identical; CPU per module | Planned (iPad bench recorded 2026-10-18) |
| 1e Several synths per track | Multiple instruments per track, shared/separate FX panels (pedalboards), editable audio cables, Effects tray, power, key zones — **completes milestone 1** | Planned |
| 2a Performance modulators | Project Mod Wheel (one per project), Velocity, Aftertouch, Bend on Serum knobs and its own FX; mod list; cable inspector | Planned |
| 2b Modulation everywhere | LFO (GLOBAL / PER NOTE), ENV, Macro, CC, Chaos modules on any Serum knob, any FX knob and 237 classic controls — **completes milestone 2** | Planned |
| 3 Serum taken apart | VOICE hub + OSC A/B/C, SUB, NOISE, FILTER 1/2, ENV, LFO, ARP, CLIP as separate modules with internal cables — **completes milestone 3** | Planned |
| 4–6 (later) | Full patching, per-voice classic modulation, polish | Later |

## Gates

- **iPad bench (before 1d): DONE 2026-10-18** — recorded in `tests/bench.json` `"ipad"` (iPad Pro, iPadOS 26.6, Chrome for iOS/WebKit). Device factor vs the M4 Max node reference ≈ 0.67–1.00 (median ≈ 0.83): every row well inside its iPad target. WebKit's 1 ms timer quantizes the 'worst quantum' columns (0.375 = one tick), so 1d's iPad gate uses the row loads. To re-run: the user opens `https://canvas.domlavin.com/tests/bench.html` in Safari on the iPad (plugged in, other apps closed), taps **Run 5 passes**, then **Copy results**, and pastes them; they go into `tests/bench.json` under `"ipad"`. Stage 1d's performance gates compare against it.
- **Sound:** every stage keeps the golden tests bit-identical for unchanged sounds; DSP files only change from 1d on.

## Changes to the plan from the user's feedback (after the spec)

These override the spec where they differ.

| Date | Feedback | Change |
|---|---|---|
| 2026-10-17 | "clicking on the canvas should not minimize the sources panel" | Side trays stay open on a tap or drag on the canvas; only their rail, ✕ or Escape close them (9913638). |
| 2026-10-17 | Text selection / magnifier bubble on iPad double-taps | No text selection, loupe, long-press callout or tap flash outside text fields — on both main and canvas (fd01596; main ee2a939). |
| 2026-10-17 | "the background grid … jumps around violently while pinch zooming … modules should snap to the grid and it should be toggleable" | Grid fixed to the world: fine dots every 32 world px (fading smoothly when zoomed out), major every 128, never re-spaced. Modules, drops, nudges and the width grip snap to the 32 px dots; a **Snap** toggle in the canvas toolbar (remembered). (e1e8f03) |
| 2026-10-17 | "i shouldnt be able to resize synths that have a physical counterpart … layout should be the same as their real life counterparts and shouldnt be rearrangeable" | Every classic synth defaults to a **fixed-size, hardware-accurate panel** (real section layout, control types, proportions; extras in a separate strip; keyboard not drawn). Serum and FX panels stay resizable. Supersedes the flowing-sections panel as the default. |
| 2026-10-17 | "can we keep the resizable synths as an option in the little ellipsis dropdown menu" | Each classic module's ⋯ menu toggles **Hardware layout** (default) / **Resizable layout** (today's flowing panel with its width grip). Per module, persisted in `track.lay`, one undo step, values kept. |
| 2026-10-17 | "when zoomed out the modules load out and some even change size … keep rendering the modules" | **Spec §2.11 cards/LOD and culling-by-unmount are dropped**: modules render identically at every zoom and simply scale; nothing in or near view is hidden or swapped; only off-screen live displays (meters, scopes, animations) pause, invisibly. The DOM budget is handled without visible changes. |

## Standing preferences (from earlier feedback)

- Native page zoom only; never an app-owned page zoom or viewport rewriting. Canvas zoom is a transform of the world layer.
- Two-finger pan/pinch always wins over single-finger presses (`gesture.js`), and must never slow native scrolling.
- Trays slide and collapse; the keyboard tray is resizable/hideable.
- Agents never search outside the project folder and scratchpad (macOS privacy prompts).
- Test memory safety: never the full suite in parallel agents; one test file at a time; never fake-DOM nodes in `assert.*`.
