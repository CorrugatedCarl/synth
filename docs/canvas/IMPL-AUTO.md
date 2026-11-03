# Stage AUTO (ROADMAP 21): automation recording — contract

**The user's words (2026-10-26)**: "eventually we will need to add modulation recording on the tracks like ableton has for as many
variables as we can". **2026-11-03**: "lets do automation now".

**The four questions (asked 2026-11-03, the lead's first guess each — the body below follows the guesses until the user says otherwise):**
1. Where the curves live → **under the piano roll**: the roll's bottom strip gets a chooser (Velocity | the track's automated knobs);
   one lane shows at a time. The arrangement draws nothing new.
2. Grabbing a knob during playback → **Ableton's way**: the knob follows the curve; a touch makes it obey the finger and dims the curve
   for that knob until "re-enable automation" (a transport button) is tapped. Nothing is written unless record is on.
3. What records → **every knob and slider with a writer**: classic panels, Wavecraft / rig modules, effects, the drum voices' knobs,
   mixer volume and pan. Switches, menus and selectors later.
4. Recording mode → **touch-to-release, then latch to the pass's end**: while record is on, a knob writes from the touch to the
   release and holds the released value to the loop's end (or stop); the old curve resumes after that. One undo step per loop pass.

Base ⟨B⟩ = canvas d5aad78 (after DM). Map of the code: the lead's scratchpad `auto/MAP.md` (every fact below with a file:line is from
it; the skeptic re-pins them). Tags: [C] contract, [R] a fact at ⟨B⟩.

## 0. What exists (facts at ⟨B⟩; "→" what they force)
- [R] A control's address is `<dev>:<dest>` (cv-module.js:1226 `indexOf`; song.js MDST regex; SPEC-canvas §"Destination id"); `dev`
  is `i1` / `fx1` / `mfx`, never a track id. wk widgets render `data-dest` (wk.js:78); classic panels `data-dest` = the models.js
  control id (classic-panel.js:194), values in panel units (0…10, an index, 0/1); rig / Serum-engine faces use serum-core `DESTS`
  ids with n 0…1; effects `fx.<inst>.<pid>`, n 0…1 (fx-ui.js:1409); the kit `k<slot><field>` in 0…10 `vals` (kit-ui.js:735). The
  mixer has no `data-dest`: `t.vol` / `t.pan` from `<input class=hvol/hpan>` (main.js:4998) → `mix()` (main.js:1280, `setTargetAtTime`).
  → one key space `<dev>:<dest>` for every automated control, plus two mixer keys `mix:vol` / `mix:pan` (§2.1).
- [R] Four writers, no `setByDest`: `ClassicPanel.set(id, v, ph)` (classic-panel.js:138 → host `valChanged` main.js:866);
  `SerumHost.setN(id, n, ph)` (sx-host.js:2017 → `sxEdit` main.js:3556); `FXRackUI.setP(id, pid, n, ph)` (fx-ui.js:1035 →
  `fxEditDev` main.js:3535); the kit's `P.set(t, dev, code+f, v, ph)` (kit-ui.js `setK`). Every one ends in `queuePatch` (one rAF
  per track, main.js:692 → `sendPatch` → `{t:'patch'}`), never a History step (the knob-tweak policy, main.js:1946; `keepDevs` :1968).
  → recording hooks in those four + the mixer; playback writes through the same four + `mix()` (§4).
- [R] Phases: wk.knob / numBox / slider emit 'start' / 'move' / 'end' (wk.js:402, :451); the classic `dragB` emits NO 'start' (the first
  'move' is the grab; classic-panel.js:~318); the kit's `setK` drops 'start'. → the grab is a DOM `pointerdown` on `[data-dest]`
  (capture, one listener on the canvas / roll hosts), not a phase (§3.1).
- [R] Recording: only bend / wheel / sus / at are recorded (`ctl` main.js:2498 → `recCC` :2413 into `track.cc = [{t, k, v}]`,
  `CC_KINDS` song.js:24; `mkCC` :153 rejects other kinds; `songData` main.js:1864 maps unknown kinds to wheel; `ccBytes` exports them
  as bend). Stage R: `T` :2073, `passOf` :2081, `recTick` :2113, `toggleRec` :2183, `recStep` :2391 (one History step per pass at
  its first change), `recAdv` :2406, `frameTick` :6335 (`recAdv(heardPass(F))`, the roll / arrangement playheads, `cvModPlay`).
  → a NEW per-track store `track.auto` (§2), never `track.cc`; `recStep()` before the first written point of a pass.
- [R] The engine has no per-parameter message and no timed parameter path: patches apply at arrival, then `sm` slots smooth ~6 ms
  (engine.js:1949), FX one-poles 10 ms × smooth (fx-dsp.js:44); song events (notes, the four CC kinds) are applied at 4-frame
  granularity (`songEvents` engine.js:4818). The goldens pin posted messages (golden-graph, canonical-stream). → **no engine change**:
  playback posts patches from the main thread at the frame rate, as a held knob does today (§4.2); a bounce bakes the curves with
  `OfflineAudioContext.suspend` (§7); the mixer's curves are AudioParam ramps (§4.4).
- [R] Modulation shows a *live marker* beside the base (wk `setLive`, `setMod`; classic `setLive(eff)`; `cpHalos` / `cpMonitor`
  main.js:11358 feed the engine's eff values) — nothing moves a base knob from a timeline. → `follow` (§6.1).
- [R] The roll (roll.js) has one fixed bottom strip: the 72 px velocity lane (`VEL` :13; regions 'vel' / 'velg' :198); the arrangement
  (arrange.js) is one 56 px canvas row per track, no clip model, bar ranges only. → the chooser + the lane replace the strip (§5).
- [R] The song model: `newTrack` song.js:77 (no `normTrack`: the track whitelist is inline in `deserialize` :736–820, unknown fields
  dropped); copies in `duplicateTrack` main.js:5039, cv-migrate.js:545 `splitTracks`, the range ops song.js:314–406 (`cc` carried with
  seam logic), `exportMIDI` / `importMIDI`; History snapshots whole tracks (`hist.record` song.js:456; `prune`, `fold`); `SCHEMA = 18`
  (cv-migrate.js:133, `STEPS`). → schema 19 (§2.4).
- [R] `destOk(dev, id)` (cv-mods.js:652) is the modulation verdict (refuses chunk / struct / kit / modulator knobs / 900 Series); the
  classic `CLASS_TABLE` classes sm / apply / proc / chunk / struct. → `autoOk` is its own rule (§2.2): a patch write is not a cable.
- [R] Tests: the page simulation `tests/main-sim.mjs` (real main.js, fake DOM, real worklet per node, `sim.raf()`); `tests/canvas-R-sim`
  shows a take (`take(o)` :54, `until(pass, to)` :31, `labels(k)` :86); a classic knob moves in a sim through
  `cv.classicPanels.get(id + '/i1').set('cf', 3)`; the fps scenes `tests/ui-bench-fps.mjs` (`SCENE_IDS` :62, `BUDGET` :48).

## 1. What it is
Per track, per control, a **curve**: breakpoints in ticks, linear between them, flat before the first and after the last. While the
song plays, every automated control follows its curve (the knob moves; the sound follows through the normal patch path). While
record is on, a control the user touches writes its curve (§3). A touch during plain playback overrides that control until
re-enabled (§4.3). The curves are edited in the roll's bottom strip (§5). Everything undoable (edits one step each; recording one
step per pass as stage R). Saved in the project (schema 19); copied, cut, pasted and duplicated with the track's bars; bounced.

Not in cut 1 (§12): switches / menus / selectors; the master canvas's own racks (`mfx`) and the master volume; curves in the
arrangement view; MIDI export of curves; a "draw" tool beyond add / move / delete / line-drag (a freehand draw is cut 2).

## 2. The model
### 2.1 `track.auto` [C]
`track.auto = { [key]: { pts: [[tick, v], …] } }` — `key` is `<dev>:<dest>` (the control's address) or `mix:vol` / `mix:pan`;
`pts` sorted by tick, ticks integer ≥ 0, no two points at one tick, `v` finite in the **control's own domain** (classic: panel units;
rig / FX: n 0…1; kit: its `vals` units 0…10; `mix:vol` 0…1 as `t.vol`; `mix:pan` −1…1). A key with no points is removed. An
`auto` with no keys is absent (`undefined`), so every track without automation serialises as at ⟨B⟩ (byte-identical files).
`S.normAuto(a, t)` (song.js) is the one normaliser: it drops unknown shapes, non-finite values, keys that fail `MDST` / `mix:…`, sorts
and de-duplicates; `deserialize`, `duplicateTrack`, `splitTracks`, `History` (automatic: whole-track snapshots) all carry it.
Range ops (song.js copy / clear / delete / insert / paste / duplicate) treat points as `cc` events with one addition: **a cut edge
gets a point** at the boundary value (so a copied bar keeps its curve's entry and exit values — `S.autoAt(pts, tick)`, §2.3).
### 2.2 `autoOk(t, key)` [C] — what may be automated
The control's family writer exists and: classic — a knob / slider whose `CLASS_TABLE` class is sm, apply, proc or chunk (struct and
none: no; selectors and toggles: no); rig / Serum — a `DESTS` id that is not `PLAIN_SW` and not virtual (`arp.*` / `clip.*`); FX — a
row that is not `nomod` and not a bool / enum; kit — the fields u, d, l, 1…4 (not t, not c); mixer — `vol`, `pan`. `data-dest`
controls that fail it do nothing on a grab and take no curve. A key whose control no longer exists (the instrument was replaced, an
effect removed) is **kept, inert** (shown greyed in the chooser with "no such control", deletable there); it plays again when the
control comes back (the user's Replace + undo).
### 2.3 `S.autoAt(pts, tick)` [C]
pts empty → `undefined`; before the first point its value; after the last the last's; between, linear. Binary search (the lanes are
read every frame). `S.autoWrite(pts, t0, t1, newPts)` replaces the points in `[t0, t1)` with `newPts` (which lie in it) and adds
the boundary points that keep the old curve's value at `t1` (the "old curve resumes" rule, §3.3).
### 2.4 Schema 19 [C]
`SCHEMA = 19`, one additive `STEPS` entry; a 19 file in an 18 build opens read-only (the existing notice). `tests/cv-migrate.test.mjs`
pins move with it (§10.4). Nothing else in the file changes.

## 3. Recording
### 3.1 The grab [C]
One capture-phase `pointerdown` listener per host surface (the canvas world, the roll's module hosts) finds `closest('[data-dest]')`
→ `(dev from closest('[data-dev]'), dest)` → `autoOk`. The mixer's two inputs register their own. From the grab until the matching
`pointerup` / `pointercancel` / `lostpointercapture` (by pointerId) the control is **held**. A held control's writes come from the
family writer's existing hook (`valChanged` / `sxEdit` via `setN` / `fxEditDev` / the kit's `P.set` / `mix()`): the hook calls
`autoWritten(t, key, v)` with the control's value in its own domain. Keyboard and wheel edits of a control are not a grab (no write).
### 3.2 While record is on [C]
Record on = `T.rec` (the ● button, stage R) **and** the transport's AUTO arm lit (§6.3; default on, remembered in `settings`).
The track need not be armed: automation records on the knob's own track (Ableton). On the first written point of a pass
`recStep()` records the pass's one History step (its label as R's: "Record pass N" / "Record"); the points are written into
`track.auto[key].pts` at `recTick(ts)` (the render-line tick of the event, as notes), de-duplicated at ≤ 2 ticks apart (the last
wins). The whole gesture's span `[tGrab, tRelease)` replaces the old points in it (`autoWrite`). Writes during the count-in or while
stopped: none (the knob just moves).
### 3.3 Latch to the pass's end [C]
On release the released value is held: the curve from the release to the **end of the pass** (the loop end, or the song's end /
stop without a loop) becomes that flat value, and the old curve resumes from there (a boundary point at the pass end carries the
old value, §2.3). While the held value runs, the control shows it (it is the base). A new grab inside the latch continues the
gesture. Stop ends every latch at the stop tick. With the loop off and the song past its last note, a latch ends at stop.
### 3.4 Undo while recording [C]
As stage R: the pass's step holds everything the pass wrote (notes, cc, auto). `undo` during a take drops the pass (`recDropPass`),
the track's `auto` comes back with the snapshot; the knob itself keeps its position (knob tweaks survive undo) but the **next frame
follows the restored curve** (playback writes it, §4.1), so the user sees the knob jump back.

## 4. Playback
### 4.1 Per frame [C]
In `frameTick` (after `recAdv`): for every track with `auto`, for every key that is not overridden (§4.3) and not held: the value at
the **render tick** (`curTick(perfTs)` — the engine renders ahead of what is heard by the output latency) is written through the
family writer with phase `'auto'` (a new phase the hooks treat like 'move' but with no `preset = null` / "Custom" change, no
`persist`, no record) — one `queuePatch` per track per frame at most (the existing coalescing). Nothing is written when the value
equals the last written one (a flat curve costs nothing). The **heard** value (`heardTickNow()`) goes to the face through `follow`
(§6.1) so the knob is seen where it is heard (on the iPad the two differ by 30–150 ms). Stopped: one write at the playhead's
tick on seek and on stop (the knob rests where the curve is).
### 4.2 Cost [C]
Per automated key per frame: one `autoAt` (binary search) + one write. Per automated track: one `buildPatch` + post (what a
held knob costs). Gate G9: the fps scene `auto8` (8 tracks × 2 curves, playing) within `BUDGET` (med ≤ 2 ms, p95 ≤ 4 ms at 1×;
6× ≤ 12 ms), layout + style ≤ 1 ms / s.
### 4.3 Override and re-enable [C]
A grab while playing with record off (or AUTO arm off) sets `override[t.id][key] = true` (session state, not saved): playback skips
the key; the face's automation dot turns **amber** (§6.2) and the transport's ↺ button lights ("Re-enable automation: 3 controls").
A tap on ↺ clears every override; the next frame follows the curves again. Overrides clear on load / new project. A grab during
recording never sets an override (it writes).
### 4.4 The mixer [C]
`mix:vol` / `mix:pan` play through `mix()` per frame (the `setTargetAtTime` path, the render tick); the faders follow (`follow`
on the two inputs: their drawn value, their `value` untouched while held). In a bounce they are sample-accurate ramps (§7).

## 5. The lane editor (the roll's bottom strip)
### 5.1 The chooser [C]
The strip's left corner (the keys' width) holds a chooser `▾ Velocity` listing **Velocity** and the track's automated keys by
label — `autoLabel(t, key)`: "Minimoog · Cutoff", "Filter · Cutoff", "Reverb 1 · Size", "Kick · Decay", "Volume", "Pan" (the
module's name + the control's label; the host supplies both). A key with no control reads greyed "(no such control)". A **+** entry
"Add… " lists every `autoOk` control of the track (grouped by module) so a curve can be drawn without recording. The chosen lane
is per track, remembered for the session.
### 5.2 The lane [C]
The strip (height `VEL` as today; the velocity lane keeps its look) draws: the curve (points as 8 px dots, segments 1.5 px, the
track's tint), the value scale at the left (the control's own readout: `autoFmt(t, key, v)` — the family's formatter, e.g. "2.4 kHz",
"−6.0 dB", "75 %"), the heard value as a lit dot on the playhead. Gestures (touch and mouse): **tap** empty → a point at the snapped
tick (`project.snap`) and the y value; **drag a point** → move (x snaps, y free; a vertical drag with Shift / a second finger's
hold? no: y only when the drag starts vertical — cut 1: free move, x snaps); **drag a segment** → both ends move in y (a line
lift); **double-tap / long-press a point** → delete; **Delete / Backspace** → delete the selected points; **drag on empty** →
a selection box (then drag moves them, Delete deletes them). The grid's own rules: one finger edits, two fingers pan / zoom (the
roll's existing rule), the pencil draws. Every edit = one History step through `host.edit(label, fn)` ("Automation: Cutoff").
The lane's keys `autoKey(t)`: the roll host gives `autoLanes(t)` (the chooser), `autoPts(t, key)`, `autoEdit(t, key, label, fn)`,
`autoLabel`, `autoFmt`, `autoRange(t, key)` → `{lo, hi}` for the y mapping (classic from the control's min / max, n 0…1, the
kit's 0…10, vol 0…1, pan −1…1), `autoOkList(t)` (the + entry).
### 5.3 What the roll does not do (cut 1) [C]
No curve in the mini-roll of the arrangement; no multi-lane view; no curve copy between tracks (bars copy with the track, §2.1).

## 6. The faces
### 6.1 `follow` [C]
`W.follow(v | null)` on wk.knob / slider / numBox and `ClassicPanel.follow(id, v | null)`: draws the control at `v` instead of
`get()` (its arc, ring and readout), without calling `set`. Playback sets it every frame to the heard value; `null` on stop (the
base shows). The kit's voice knobs and the FX / rig faces get it through wk. The mixer inputs: `follow` sets the thumb's drawn
position via a CSS variable, the `value` stays (a held input is the user's).
### 6.2 The automation dot [C]
A control with a curve carries `data-auto="on"` (a 6 px dot in the track's tint at the control's corner; CSS in wk's sheet, classic
panels' sheet, the kit's, the mixer's); overridden: `data-auto="off"` (amber); none: no attribute. The host sets it on every
automation change (record, edit, load, replace).
### 6.3 Transport [C]
Two small buttons after ●: **AUTO** (the automation arm, lit by default; off: knob moves while recording write nothing) and **↺**
(re-enable, lit only while any override exists; tapping it clears them). Both ≥ 44 px on touch; tooltips in the app's voice.

## 7. Bounce [C]
`bounce()` builds each item's patch at the range start from the curves (every automated key written at `start` before `buildPatch`),
then renders with **`oc.suspend(t)` at every change tick** (the union of every automated key's breakpoints inside the range, plus the
linear segments sampled every `PPQ / 8` ticks, never closer than 128 frames): at each suspend the main thread writes the keys' values
at that tick through the writers (phase 'auto', no `queuePatch`: it builds the patch and posts `{t:'patch', p}` to the item's node
directly), then `oc.resume()`. The mixer's keys become `g.gain` / `pn.pan` `linearRampToValueAtTime` at the breakpoints (no
suspend needed). A track without `auto` renders exactly as at ⟨B⟩ (no suspend scheduled: canvas-M-bounce stays bit-identical).
The node sim's fake OfflineAudioContext gets `suspend` / `resume` (tests/dsp-scope or fakes) rendering in quanta.

## 8. Engine work and cost
None in the worklet. Files: song.js (§2), cv-migrate.js (schema), main.js (§3, §4, §6.3, §7, the roll host's auto methods),
wk.js + classic-panel.js (§6.1, §6.2), roll.js (§5), style.css / the kit's CSS (the dot), index.html (two transport buttons),
tests. Precache list: no new module unless the lane editor wants its own file (`roll-auto.js?v=9`, reachable from roll.js).

## 9. Gates
| gate | what | target |
|---|---|---|
| G1 | every golden exact (classic / fx / presets / random / graph / drums / 606 / 909 / sdsv / kit / lc / moog ×3), canonical-stream fixtures, canvas-M-bounce, engine-track; existing tests green with only §10.4's pins moved | 0 diffs |
| G2 | `S.normAuto` / `autoAt` / `autoWrite` / the range ops: property tests (random curves, random ranges: copy → paste round-trips values at every tick; delete + insert = identity; boundary points at cuts) | 0 failures in 20 000 cases |
| G3 | the sim (`tests/canvas-AUTO-sim.test.mjs`): a take with a classic knob held over two loop passes → points in pass order, one step per pass, undo drops the pass's points, redo brings them; latch to the pass end; a rig knob, an FX knob, a kit knob, the mixer fader the same; AUTO arm off → nothing written; override + re-enable; playback writes the engine's patch (the node's `p` field follows the curve within one frame); save → load → identical `auto`; a 19 file in an 18 build read-only | all pass |
| G4 | timing: the engine's patch field at the render tick within 1 frame + 1 quantum of the curve (sim at 120 and 240 BPM); a bounce of an automated cutoff sweep vs the live render of the same (both through the sim's engine): the bounce's patch at every suspend tick equals the curve; the mixer ramp sample-accurate | ≤ 1 frame + 128 frames; ramps exact |
| G5 | the roll lane (roll.test + a Chrome for Testing script): chooser lists the keys with labels; tap / drag / delete / box / Delete key each one step; the y scale's readout equals the family's formatter; two fingers never edit; the lane at d / l / p sizes within the strip, nothing clipped (tests/ui-layout-roll-auto.mjs) | all pass |
| G6 | the faces: `follow` draws without `set` (no write, no History); the dot on / off / none; classic, wk, kit, mixer | all pass |
| G7 | G9 fps scene `auto8` (8 tracks × 2 curves, playing, the roll closed) and `auto8r` (the roll open on a lane) within `BUDGET`; `kit`, `play8`, `roll8` scenes unchanged (A/B ×3: noise) | within BUDGET; no regression |
| G8 | no new engine-posted message for a track without `auto`; posted messages of a project without automation equal ⟨B⟩'s (canonical-stream) | 0 diffs |
| G9 | words: the UI says "automation", "re-enable", never a brand's; the chooser's labels are the module names the user sees | pass |

## 10. Lanes (the leaner shape)
### 10.0 Before the builders (the lead, phase 0)
song.js `normAuto` / `autoAt` / `autoWrite` + the range ops, schema 19 + the migrate pins, `autoOk` (main.js, pure), the sim's
failing tests (G3's names), the fps scene stubs; `wt-AUTO` holding branch; every lane resets to its tip.
### 10.1 The lanes (phase 1 in parallel, worktrees; phase 2 on their merge)
| lane | model | files | what |
|---|---|---|---|
| W (widgets) | Sonnet | wk.js, classic-panel.js, kit-ui.js (through wk), style.css, the kit's CSS, tests/wk*.test, classic tests | §6.1 `follow`, §6.2 the dot; the mixer inputs' follow; no host changes (the host calls the methods) |
| L (the lane editor) | Opus | roll.js (+ roll-auto.js if split), tests/roll.test, tests/ui-layout-roll-auto.mjs | §5 against a stub host with the §5.2 methods (the lead's phase-0 interface); the chooser; gestures; the y scale |
| H (the host) — phase 2 | Opus | main.js, index.html, song.js hooks, tests/canvas-AUTO-sim | §3, §4, §6.3, §7, the roll host's auto methods, `__synthTest.cv.auto` |
| G (gates) — beside the reviewers | Sonnet | tests/ui-bench-fps.mjs (+ .test), tests/bench.json row `ui-AUTO-mac` | G7's scenes and run; the A/B |
### 10.2 Interfaces (fixed here)
- `S.normAuto(a, t)`, `S.autoAt(pts, tick)`, `S.autoWrite(pts, t0, t1, newPts)`, `S.autoKeys(t)`.
- Writers' phase `'auto'` and the hook `autoWritten(t, key, v)` (H owns both ends; W never calls the host).
- wk: `W.follow(v)`, `W.setAuto('on' | 'off' | null)`; classic: `P.follow(id, v)`, `P.setAuto(id, state)`.
- The roll host: `autoLanes(t)`, `autoPts(t, key)`, `autoEdit(t, key, label, fn)`, `autoLabel(t, key)`, `autoFmt(t, key, v)`,
  `autoRange(t, key)`, `autoOkList(t)`, `autoLane(t)` / `setAutoLane(t, key | 'vel')`.
### 10.3 Rules
Failing test first; goldens bit-identical; one test file at a time; `?v=9`; `node tools/precache.mjs --write` after any site-file
change; no engine.js change; the lead regenerates sw.js at every merge; short notes in §13.
### 10.4 Pins that move by design
`tests/cv-migrate.test.mjs` (SCHEMA 19, one more STEPS entry); `tests/ui-bench-fps.test.mjs` scene counts (+2); the roll's region
pin if roll.test pins the strip's regions; lint's accessor ratchet untouched (a new field is v2).

## 11. Questions for the user
The four in the header (asked 2026-11-03 with the lead's guesses). A fifth the lead decided: the AUTO arm button exists and is on by
default (so notes-only recording is one tap away).

## 12. Known limits (cut 1)
- Switches, menus, selectors, bools and enums are not automated (a step curve is cut 2).
- Timing: live playback is frame-granular (≤ 1 frame + the engine's 128-frame quantum late) and smoothed by the family's own
  smoothing; a bounce is quantum-granular (every breakpoint lands on a 128-frame boundary at most 2.7 ms off at 48 kHz) and the
  mixer sample-accurate. Fast "stepped" moves (a 1 ms square) are not reproducible; LFO-style motion belongs to the modulators.
- A held value during latch is written as a flat segment at the pass end: the curve's old tail returns unchanged.
- The master canvas's racks (`mfx`) and the master volume are not automated.
- Curves are not exported to MIDI; an imported MIDI's CCs become no curves (the four kinds go to `cc` as before).
- The arrangement view shows no curves (bars still copy with them).

## 13. Notes (the builders fill in)
