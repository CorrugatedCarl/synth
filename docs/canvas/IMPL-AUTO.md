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

Base ⟨B⟩ = canvas d5aad78 (after DM). The code map: `docs/canvas/map-auto.md`; the skeptic's note is §14 (its facts re-pinned at
712f6d7 and folded into the body: the first draft's `curTick` as the render tick, the four UI writers as playback writers, the
hooks naming the key, the mixer's range, the roll's corner were all wrong — §14.2). Tags: [C] contract, [R] a fact at ⟨B⟩.

## 0. What exists (facts at ⟨B⟩, re-pinned by the skeptic; "→" what they force)
- [R] A control's address is `<dev>:<dest>`: the dest from `closest('[data-dest]')`, the dev from `closest('[data-dev]')` **else the
  module's `data-cv-mod`** (cv-module.js:1232–1249 `indexOf`, cv-cables.js:1424 `devAt`) — kit-ui and rig-ui set no `data-dev`.
  `dev` is `i1` / `fx1` / `mfx`, never a track id (song.js:667 MDST). wk widgets render `data-dest` on the widget root (wk.js:77–80);
  classic panels `data-dest` = the models.js control id (classic-panel.js:194; hardware panels cv-panel.js:2039/:2063/:2140, root
  `data-dev` :154), values in panel units (0…10, an index, 0/1); rig / Serum-engine faces use serum-core `DESTS` ids with n 0…1;
  effects `fx.<inst>.<pid>`, n 0…1 (fx-ui.js:1409); the kit `k<slot><field>` in 0…10 `vals` (kit-ui.js:752; `setK` :728). The mixer
  has no `data-dest`: `t.vol` (0…**1.25**, main.js:4998) / `t.pan` from `<input class=hvol/hpan>` → `mix()` (main.js:1280, every
  track + `ptDim` / `ptHeardSync`), `persist`. → one key space `<dev>:<dest>` + `mix:vol` / `mix:pan` (§2.1); the grab resolves the
  dev by cv-cables' `devAt` rule (§3.1).
- [R] The four UI writers exist only for **mounted** panels (classicPanels / serumPanels / fxRecs) and drag side effects: classic
  `valChanged` (main.js:866: `preset = null` + `renderHeads`, `N.modsHold`, `cpVer++`, `queuePatch`, `persist`); `SerumHost.setN`
  (sx-host.js:2017: the panel's own undo snapshot per call :2130–2150, `dirty`, the wrapper's `peerRefresh` + `cvChipSync` main.js:4222,
  `sxEdit` :3556 — and the host's edit never receives the dest id); `fxEditDev` (main.js:3535: `fxPrune`, `sxDirty`, no id); the kit's
  `kitKnob` (main.js:10251: `preset = null`, `persist`, 15 Hz throttle). The pure model paths exist: `d.vals[id]`, `CORE.setDestBase(s,
  fx, id, n)` (serum-core.js:3542) + `CORE.syncS1` (:3070), `fxSet(t, id, n, dev)` (main.js:258), `t.vol` / `t.pan`; `queuePatch`
  (main.js:692, one rAF per track). → playback writes the **model** through pure `autoApply` and posts through `queuePatch`; recording
  **polls** held keys through pure `autoGet` (§3.2); no change in sx-host.js / fx-ui.js / kit-ui.js.
- [R] Phases: wk.knob / numBox / slider emit 'start' / 'move' / 'end' (wk.js:402, :451; the two-finger rollback 'move' n0 + 'end'
  :444–451); the classic `dragB` emits NO 'start' (classic-panel.js:327–347; `restore` → `set(id, v0)` no phase :300); the kit's
  `setK` drops 'start' (kit-ui.js:728). wk and classic widgets capture the pointer (wk.js:399, main.js:2930) so their pointerup bubbles;
  native range inputs do not. → the grab is a capture-phase `pointerdown` on `[data-dest]`; the release a capture-phase pointerup /
  pointercancel on `window` by pointerId; a gesture exists only from its first changed value (§3.1).
- [R] `curTick(perfTs)` = `AC.heardTick(outFrame(perfTs), T.as)` is the **heard** tick (main.js:2107); no render-tick helper exists;
  `recTick` (:2113) stamps events at the heard line as notes do. → `renderTick()` = `AC.heardTick(ctx.currentTime × sr, T.as)`, once per
  frame (§4.1); recording stamps `recTick` (heard), playback writes at `renderTick` — the two compensate the latency.
- [R] Recording: only bend / wheel / sus / at (`ctl` main.js:2498 → `recCC` :2413 → `track.cc`; `CC_KINDS` song.js:24; `mkCC` :153;
  `songData` main.js:1864 maps unknown kinds to wheel; `ccBytes` song.js:821 exports them as bend). Stage R: `T` :2073, `passOf` :2081,
  `recTick` :2113, `toggleRec` :2183, `recStep` :2391 (one History step per pass at its first change), `recAdv` :2406 (held notes
  committed at `le`, continued from `ls`), `recDropPass` :2047 (held notes only), `applyRestore` replaces track objects, `sweep` :2433
  filters notes only, `frameTick` :6335 (a frame-clock client; stops at songEnd + 1 bar with the loop off :6344), `stop` sets
  `T.pos = T.startPos` :2150. → `track.auto` (§2), never `track.cc`; `recStep()` before a pass's first point; gestures resolve tracks by
  id and end on undo / redo (§3.4); automation is never swept (§3.5).
- [R] The engine: no per-parameter message, no timed parameter path; patches apply at arrival then smooth (`sm` ~6 ms engine.js:1949;
  FX τ 10 ms × smooth fx-dsp.js:44); song events at 4-frame granularity (`songEvents` :4818, :4972). Measured (the skeptic, node, M4
  Max): `sendPatch` classic 0.04–0.1 ms (~1.9 KB), **rig 0.51 ms (34 KB)**; the worklet applying one: classic 0.013, rig 0.078 (+0.036
  clone). play8 1× med 0.18 ms (bench `ui-fps-mac-b`). → no engine change in cut 1; the automation tick runs at **60 Hz with the
  tracks staggered** (§4.2); G7's scene holds two rigs (§9).
- [R] Modulation shows a live marker beside the base (wk `setLive` / `setMod` :364–368; classic `setLive`; `cpHalos` main.js:11358);
  the classic panel has one read point (`api.get` classic-panel.js:546, shared by cv-panel.js's hardware panels); drags start from
  `get()` (dragB `v0` :327, wk `n0` :395); `indexOf` walks children and the rig-grid JSON pins the faces. → `follow` at the read point,
  drags start from the followed value, the dot is an `::after` (§6).
- [R] The roll's strip: `VEL = 72`, the corner `GUT_P = 64` / `GUT_D = 120` (roll.js:13); regions 'vel' / 'velg' (:197–202);
  roll.test.mjs:712 pins the vel / velpaint types; the roll is one canvas, menus come from the host. → a "▾ <short label>" chip in the
  corner opening `host.menu`, the readouts inside the lane (§5).
- [R] Song model: `newTrack` song.js:77; `deserialize` :736 (the track literal :775, unknown fields dropped); `duplicateTrack`
  main.js:5039; `splitTracks` cv-migrate.js:486 (cc :545); range ops song.js:316–406 (cc's seam rule is step-state `ccAt` :309, paste
  pushes = a merge :396); `contentEnd` :124–130; `plain()` slices arrays at 100 000 (:142); `hist.record` :458 (whole-track snapshots,
  64e6 chars); `SCHEMA = 18` cv-migrate.js:133, `STEPS` :154–199 — **pinned in 10 test files** (§10.4). → §2.
- [R] `destOk` (cv-mods.js:652–670) dispatches by family (`/^fx\./` on any device, kit ids, then the device kind); `CLASS_TABLE` :177;
  rig `DESTS` include enum / int / bool laws (`f.type` serum-core.js:588); the 900 Series knobs are `data-nomod` (cv-patch.js:882,
  written by `ptKnob` main.js:9926); MIDI-learned CCs write `s.p` directly (midi.js `writeCC`). → `autoOk` by family, laws excluded,
  900 Series out (§2.2); override on any base change, not only a grab (§4.3).
- [R] Tests: the sim `tests/main-sim.mjs` (real main.js; the fake OfflineAudioContext **at :303**: no `suspend(t)`, param ramps applied
  instantly :131–134, route gains read once :186; every posted message stored with its size :270–272); canvas-R-sim `until` :34, `take`
  :48, `labels` :77; a classic knob in a sim: `cv.classicPanels.get(id + '/i1').set('cf', 3)` (canvas-2b-sim:164); ui-bench-fps
  `SCENE_IDS` :62, `BUDGET` :51; lint's accessor ratchet lint.test.mjs:98 counts `t|tr|x|T|v|V.vals|fx|preset` sites in main.js
  (name device records `d` / `iv`). → §7, §9, §10.4.

## 1. What it is
Per track, per control, a **curve**: breakpoints in ticks, linear between them, flat before the first and after the last. While the
song plays, every automated control follows its curve (the knob moves; the sound follows through the normal patch path). While
record is on, a control the user touches writes its curve (§3). A touch during plain playback overrides that control until
re-enabled (§4.3). The curves are edited in the roll's bottom strip (§5). Everything undoable (edits one step each; recording one
step per pass as stage R). Saved in the project (schema 19); copied, cut, pasted and duplicated with the track's bars; bounced.

Not in cut 1 (§12): switches / menus / selectors / enums; the master canvas's racks (`mfx`) and the master volume; the 900 Series
knobs; curves in the arrangement view; MIDI export of curves; freehand drawing and a box selection in the lane.

## 2. The model
### 2.1 `track.auto` [C]
`track.auto = { [key]: { pts: [[tick, v], …] } }` — `key` is `<dev>:<dest>` or `mix:vol` / `mix:pan`; `pts` sorted by tick, ticks
integer ≥ 0, **no two points at one tick** (a jump is two points one tick apart: the only way, §2.3), `v` finite in the control's own
domain (classic: panel units; rig / FX: n 0…1; kit: `vals` units 0…10; `mix:vol` 0…1.25 as `t.vol`; `mix:pan` −1…1), values rounded
to 1e-4 of the range. A key with no points is removed; an `auto` with no keys is absent (`undefined`): a track without automation
serialises as at ⟨B⟩. `S.normAuto(a)` (song.js) is the one normaliser: drops unknown shapes, non-finite values, keys that fail `MDST`
(or `mix:vol` / `mix:pan`), **any `mfx:` key**, sorts, de-duplicates ticks (the last wins), caps a key at 20 000 points (keeps the
first 20 000 after thinning, §3.2). `deserialize`, `duplicateTrack`, `splitTracks`, History (automatic) carry it; a cross-track paste
leaves foreign keys inert (§2.2). `contentEnd` / `songEnd` count the last point; recording bumps `project.bars` as notes do
(main.js:1944).
**Range ops** (song.js; every one keeps the values outside the range as they were, shifted where time moves):
- copy `[s, e)` → `[0, autoAt(s)]`, the inner points shifted by −s, `[e − s, autoAt(e)]` (the clipboard carries `auto` per track);
- paste at `at` → `autoWrite(pts, at, at + len, copied)` with a jump pair back to the target's own value at `at + len`;
- clear `[s, e)` → the inner points removed, points at `s` and `e` with the old values there (a flat gap);
- insert `len` at `at` → points at `at` and `at + len` with `autoAt(at)`, then the shift;
- delete `[s, e)` → clear, shift, a jump pair at `s` (`autoAt(s−)` → `autoAt(e)`); duplicate = copy + insert + paste.
### 2.2 `autoOk(t, key)` [C] — what may be automated (by family, as `destOk`)
`mix:vol` / `mix:pan` → yes. `fx.<inst>.<pid>` on any device → the row exists, is not `nomod`, its law is not bool / enum / int.
A kit id → the fields u, d, l, 1…4 (not t, not c). A rig / Serum device → a `DESTS` id that is not `PLAIN_SW`, not virtual (`arp.*`
/ `clip.*`), whose law is not enum / int / bool. A classic device → a knob / slider control whose `CLASS_TABLE` class is sm, apply,
proc or chunk (struct / none: no; selectors / toggles: no). `[data-nomod]` (the 900 Series) and `[data-twin]` elements: no. A key
whose control no longer exists (the instrument replaced, an effect removed) is **kept, inert** (greyed in the chooser, "no such
control", deletable); it plays again when the control comes back. A removed kit voice's curve drives the next voice in that slot
(the same `k<slot>` id — recorded, §12).
### 2.3 `S.autoAt(pts, tick)` / `S.autoWrite` [C]
`autoAt`: pts empty → `undefined`; before the first point its value; after the last the last's; between, linear; binary search.
`autoWrite(pts, t0, t1, newPts)` replaces the points in `[t0, t1)` with `newPts` (in it) and adds the **jump pair** at `t1` that keeps
the old curve's value from `t1` on (`[t1 − 1, last new value]`, `[t1, autoAt(old, t1)]`; skipped when they are equal or the old curve is
empty — fix round: no longer skipped past the last old point). `S.autoThin(pts, eps)`: Ramer–Douglas–Peucker at `eps` = 1e-3 of the range (§3.2).
### 2.4 Schema 19 [C]
`SCHEMA = 19`, one additive `STEPS` entry; a 19 file in an 18 build opens read-only (the existing notice). The pins that move: §10.4.

## 3. Recording
### 3.1 The grab [C]
One capture-phase `pointerdown` listener on `document` finds `closest('[data-dest]')` → the dev by cv-cables' `devAt` rule → the key
→ `autoOk`; the mixer's two inputs register their own. From the grab to the release — a capture-phase `pointerup` / `pointercancel` /
`lostpointercapture` on `window` with the same pointerId (gesture.js's synthetic pointercancel bubbles from the target) — the key is
**held** by that track id. A **gesture** exists only from the first frame in which the held key's base differs from its value at the
grab (a press without a move, a long-press menu, a reset: no gesture, no latch). `e.gesture === 'two-finger'` on the release
**drops** the gesture: the key's points return to the copy taken at the grab, no latch, no override, `hist.prune` if the pass's step
holds nothing else. Keyboard, wheel, typed and MIDI-learned writes are not a grab (they count as a base change, §4.3).
### 3.2 While record is on [C]
Record on = `T.rec` (●) **and** the AUTO arm lit (§6.3; default on, remembered in `settings`). The track need not be armed: automation
records on the knob's own track. Each automation tick (§4.2) polls every held key: `autoGet(t, key)` (pure: `d.vals[id]`,
`CORE.destBase(s, fx, id)`, the FX instance's `p`, `t.vol` / `t.pan`) against the last polled value; a change makes a point at
`recTick(now)` (the heard line, as notes). The first point of the gesture is `[tGrab, the grab value]`; `recStep()` runs before a
pass's first point. The gesture's span replaces the old points (`autoWrite`, progressively: each tick erases the old points in
`(lastWritten, now]`). At release the gesture's points are **thinned** (`autoThin`) and the latch starts. Writes during the count-in
or while stopped: none (the knob just moves). AUTO arm off: nothing written, no override either.
### 3.3 Latch to the pass's end [C]
After release the released value is held and written progressively (each tick erases the old points up to now and keeps one flat
value), **closed with a jump pair** at the first of: the pass's end (the loop end `le`; a gesture or latch across the wrap is committed
up to `le` in the old pass's step and continues from `ls` in the new pass's, as `recAdv` does for notes), the song's end + 1 bar with
the loop off, stop, seek, undo / redo. The old curve resumes from the close. A new grab inside the latch continues it (one gesture).
### 3.4 Undo while recording [C]
As stage R: the pass's step holds everything the pass wrote. `undo` / `redo` during a take **ends every gesture and latch first**
(as R ends keys held at Ctrl+Z), then `recDropPass` restores the snapshot; a released key follows the restored curve from the next
tick (the knob is seen jumping back); a key still held stays the user's until release. Gestures hold track **ids**, never objects
(`applyRestore` replaces them).
### 3.5 Replace mode [C]
Replace sweeps notes only; automation is never swept (touch semantics: untouched keys keep their curves).

## 4. Playback
### 4.1 The automation tick [C]
`autoTick()` runs from `frameTick` on a **60 Hz** budget (`perfTs` gating; 120 / 240 Hz displays skip frames; the tracks are
staggered: track n is written on ticks ≡ n mod 2 when more than 4 tracks have curves — the write is still ≤ 33 ms late). For every
track with `auto`, for every key that is not overridden and not held: `v = autoAt(pts, renderTick())`; if `v` differs from the key's
**base** (`autoGet`, not a cache — a base changed by other means is an override, §4.3) → `autoApply(t, key, v)` (pure: classic
`d.vals[id] = v; cpVer++`; rig `CORE.setDestBase` + `syncS1`; FX `fxSet`; kit `d.vals[id] = v`; mixer `t.vol` / `t.pan` + `mixOne(t)` —
one node's gain / pan, not `mix()`), then one `queuePatch(t)` per track per tick. Never: `preset = null`, `persist`, History, `sxDirty`,
`fxPrune`, `modsHold`, the panels' refresh. The **face** follows separately at the display rate: `follow(autoAt(pts,
heardTickNow()))` for every automated control of the shown track (§6.1), `follow(null)` for held keys. Stopped: one `autoApply` at the
playhead's tick on seek and after stop (`T.pos`, the start: the knob rests where the curve is there); none at load. A hidden page has no
frames: automation freezes while audio plays and chases on `visibilitychange` (§12).
### 4.2 Cost [C]
Per automated key per tick: one `autoAt` + one compare (+ one write when it moved). Per written track: one `sendPatch` (classic
≈ 0.1 ms, rig ≈ 0.5 ms main-thread + 0.08 ms in the worklet). Gate G7: scenes `auto8` (2 rigs on `f.cutoff` + 5 classics + 1 FX knob,
16 curves, playing) and `auto8r` (the roll open on a lane) within `BUDGET` at 1× / 6× on d / l / p; a 120 Hz display posts no more
than a 60 Hz one. The iPad: one pass at the end on the real device (`tests/ui-bench.html?fps=1` with the scene) — the lane's estimate
is 2–3 ms a tick with two rigs (recorded, not gated).
### 4.3 Override and re-enable [C]
A key is **overridden** when, with record off (or AUTO arm off), its base differs from playback's last written value at the start of
a tick (a grab, a wheel, a typed value, a reset, a MIDI-learned CC — anything): `override[trackId][key] = true` (session state, never
saved); playback skips it; the face's dot turns a **hollow ring** (fix round: was amber); the transport's ↺ lights ("Re-enable automation · 3 controls"). A tap on ↺
clears every override; the next tick follows the curves again. Overrides clear on load / new project / a Replace of the device. With
record on and the key held, a change writes instead (§3.2); record on and not held: a change is an override too (a wheel during a
take overrides, it does not write — cut 1).
### 4.4 The mixer [C]
`mix:vol` / `mix:pan` play through `mixOne(t)` (the `setTargetAtTime` path) at the render tick; the faders follow by `input.value`
when not held (a held input is the user's; `t.vol` is the base and is snapshotted by History like every other base). In a bounce
they are sample-accurate ramps (§7).

## 5. The lane editor (the roll's bottom strip)
### 5.1 The chooser [C]
The strip's corner (`GUT_P` 64 × 72 px; wider on desktop) holds a chip `▾ Vel` / `▾ Cutoff` (the short label); a tap opens
`host.menu` with **Velocity**, the track's automated keys by label — `autoLabel(t, key)` → `{ short: 'Cutoff', long: 'Minimoog ·
Cutoff' }` ("Filter · Cutoff", "Reverb 1 · Size", "Kick · Decay", "Volume", "Pan": the module's name the user sees + the control's
label) — a greyed "(no such control)" for inert keys with a Delete item, and **Add…** listing every `autoOk` control of the track
grouped by module (a curve can be drawn without recording). The chosen lane is per track for the session (`autoLane(t)`).
### 5.2 The lane [C]
The strip keeps `VEL`'s height; the velocity lane keeps its look. An automation lane draws: the curve (points as 8 px dots, segments
1.5 px, the track's tint), readouts **inside the lane** at the top-left (the value under the finger / the heard value, `autoFmt(t, key,
v)` — the family's own formatter: "2.4 kHz", "−6.0 dB", "75 %"), the heard value as a lit dot on the playhead. Gestures (touch and
mouse, cut 1): **tap** empty → a point at the snapped tick (`project.snap`) and the y value; **drag a point** → move (x snaps, y free);
**drag a segment** (between two points, away from both) → both ends move in y; **double-tap / long-press a point** → delete;
**Delete / Backspace** → delete the selected point. Selecting a point clears the note selection and vice versa (Delete has one
meaning). One finger edits, two fingers pan / zoom (the roll's rule). Every edit = one History step through `host.autoEdit(t, key,
label, fn)` ("Automation: Cutoff"). The y mapping is `autoRange(t, key)` → `{lo, hi}` (classic from the control's min / max; n 0…1;
the kit's 0…10; vol 0…1.25; pan −1…1). Freehand drawing and a box selection: cut 2.
The roll host (main.js): `autoLanes(t)`, `autoPts(t, key)`, `autoEdit`, `autoLabel`, `autoFmt`, `autoRange`, `autoOkList(t)`,
`autoLane(t)` / `setAutoLane(t, key | 'vel')`, `menu(items, x, y)` (the existing one).
### 5.3 What the roll does not do (cut 1) [C]
No curve in the arrangement's mini-roll; no multi-lane view; no curve copy between tracks (bars copy with the track, §2.1).

## 6. The faces
### 6.1 `follow` [C]
`W.follow(v | null)` on wk.knob / slider / numBox and `ClassicPanel.follow(id, v | null)` (at the panel's single read point,
classic-panel.js:546, so cv-panel.js's hardware panels get it): the control **draws** at `v` instead of `get()` (arc, ring, readout)
without calling `set`; a drag that starts on a followed control starts from the followed value (dragB `v0`, wk `n0`), never from the
base (a grab would otherwise jump by the latency). Playback sets it at the display rate to the heard value, `null` on stop / for a
held key (the base shows). The kit's voice knobs and the FX / rig faces get it through wk. The mixer: `input.value` (§4.4).
### 6.2 The automation dot [C]
A control with a curve carries `data-auto="on"` on its `[data-dest]` element (a 6 px `::after` dot in the track's tint at the
control's corner — never a child element: `indexOf` walks children and rig-grid's JSON is pinned); overridden: `data-auto="off"`
(a hollow ring in the tint — a shape, never a colour: fix round, `--hot` is track 1's tint); none: no attribute. The host sets it on every automation change (record, edit, load, Replace, re-enable).
### 6.3 Transport [C]
Two small buttons after ●: **AUTO** (the automation arm, lit by default; off: knob moves while recording write nothing) and **↺**
(re-enable, lit only while any override exists; a tap clears them). ≥ 44 px on touch; tooltips in the app's voice.

## 7. Bounce
### 7.0 The probe first (lane H2's first step) [C]
In Chrome for Testing: an OfflineAudioContext with one engine node, `suspend(t)` at 20 ticks, a `{t:'patch'}` posted inside each
suspend, `resume()`; the rendered output proves whether every patch applied **before** the quantum at `t` (MessagePort delivery into
the worklet is asynchronous: the spec promises nothing). Result in §13. If it holds in Chrome and in the iOS Simulator's WebKit,
§7.1 ships as written. If not, the pre-approved fallback: an inert engine addition `{t:'patch', p, at}` (`at` = the frame to apply at;
a deferred-apply queue in `Track.msg`; absent `at` = today's path, golden-graph / canonical-stream untouched), and live playback may use
it too (quantum-exact).
### 7.1 Baking [C]
`bounce()` writes every automated key at `start` into the model (`autoApply`), builds the items' patches, then **restores** the bases
synchronously (the user's values never see the render). The render schedules `oc.suspend(t)` at every change tick of the range: the
union of the keys' breakpoints plus the moving segments sampled every 512 frames (≈ 11 ms at 48 kHz, live's tick; fix round: was `PPQ / 8` ticks) **only where the value moves ≥ 1/512 of the
range** (a flat curve adds its breakpoints only), never closer than 128 frames. At each suspend: the keys' values at that tick →
`autoApply` on a scratch copy of the devices → the item's patch built → posted to that item's node (graph tracks: their per-Inst
`{t:'patch', i, p}`; the offline nodes keep their own part caches so the tables are not resent) → `resume()`. The mixer's keys become
`g.gain` / `pn.pan` `linearRampToValueAtTime` at the breakpoints. A track without `auto` renders exactly as at ⟨B⟩ (no suspend:
canvas-M-bounce bit-identical). Cost: ≈ 1 000 suspends for a 3-minute song with one moving curve (estimate; recorded in §13).
### 7.2 The sim [C]
tests/main-sim.mjs's fake OfflineAudioContext gains `suspend(t)` / `resume()` (rendering in quanta up to `t`) and a Param timeline
for `linearRampToValueAtTime` on the route gains (today: instant, read once). G4 keeps its bounce to ≤ 2 bars (the sim stores every
posted message).

## 8. Engine work and cost
None in the worklet in cut 1 (§7.0's fallback is the one pre-approved addition). Files: song.js (§2), cv-migrate.js (schema), main.js
(§3, §4, §6.3, §7, the roll host's auto methods), wk.js + classic-panel.js + cv-panel.js (§6), roll.js (§5; `roll-auto.js?v=9` if
split, reachable from roll.js), style.css + the kit's CSS (the dot), index.html (two buttons), tests/main-sim.mjs (§7.2), tests.

## 9. Gates
| gate | what | target |
|---|---|---|
| G1 | every golden exact (classic / fx / presets / random / graph / drums / 606 / 909 / sdsv / kit / lc / moog ×3), canonical-stream fixtures, canvas-M-bounce, engine-track; existing tests green with only §10.4's pins moved | 0 diffs |
| G2 | `normAuto` / `autoAt` / `autoWrite` / `autoThin` / the range ops: property tests (random curves and ranges): values outside a range unchanged (shifted where time moved); copy → paste reproduces the copied values at every tick inside; insert = a flat gap; the jump-pair rule; thinning within eps; the cap | 0 failures in 20 000 cases |
| G3 | `tests/canvas-AUTO-sim.test.mjs`: a take with a classic knob held over two loop passes → points in pass order, one step per pass, undo drops the pass's points (and ends the gesture), redo brings them back; the latch's flat segment and its jump pair at the pass end; a gesture across the wrap; the two-finger drop; a press without a move makes nothing; a rig knob, an FX knob, a kit knob, the fader the same; AUTO arm off → nothing written; override by a grab / a wheel / a MIDI CC and ↺; playback: the node's patch field follows the curve; save → load → identical `auto`; a 19 file in an 18 build read-only; a track without `auto` posts exactly ⟨B⟩'s messages | all pass |
| G4 | timing (the sim at 120 / 240 BPM): the engine's patch field equals the curve at the render tick within 1 automation tick (16.7 ms) + 1 quantum; a 2-bar bounce of an automated cutoff: the patch at every suspend equals the curve; the mixer ramps exact in the fake's timeline; the probe's result recorded | ≤ 1 tick + 128 frames |
| G5 | the lane (roll.test + a Chrome for Testing script, tests/ui-layout-roll-auto.mjs at d / l / p): the chip and menu list the keys with labels; tap / drag / segment lift / delete each one step; the readout equals the family's formatter; point and note selections exclusive; two fingers never edit; nothing clipped in the strip | all pass |
| G6 | the faces: `follow` draws without `set` (no write, no History, no posted message); a drag starts from the followed value; the dot on / off / none as an `::after`; rig-grid's JSON pins identical; classic, hardware, wk, kit, mixer | all pass |
| G7 | fps scenes `auto8` / `auto8r` (§4.2) within `BUDGET`; `kit`, `play8`, `roll8` unchanged (A/B ×3: noise); a 120 Hz cap posts as a 60 Hz one | within BUDGET; no regression |
| G8 | posted messages of a project without automation equal ⟨B⟩'s (canonical-stream); no suspend without `auto` | 0 diffs |
| G9 | words: "automation", "re-enable", the module names the user sees; no brand's | pass |

## 10. Lanes (the leaner shape)
### 10.0 Before the builders (the lead, phase 0)
song.js `normAuto` / `autoAt` / `autoWrite` / `autoThin` + the range ops (§2.1) + `contentEnd`; schema 19 + the pins (§10.4);
`renderTick`, `autoOk`, `autoGet`, `autoApply` (pure, main.js); `__synthTest.cv.auto = { get(tid, key), set(tid, key, pts), held(),
override() }`; the failing sim tests named by G3 / G4; the fps scene stubs; `wt-AUTO`; every lane resets to its tip.
### 10.1 The lanes
| lane | model | files | what |
|---|---|---|---|
| W (widgets), phase 1 | Sonnet | wk.js, classic-panel.js, cv-panel.js, kit-ui.js (through wk only), style.css, the kit's CSS, their tests | §6.1 `follow` at the read points, drags from the followed value; §6.2 the `::after` dot; no host calls |
| L (the lane editor), phase 1 | Opus | roll.js (+ roll-auto.js), tests/roll.test, tests/ui-layout-roll-auto.mjs | §5 against a stub host with §5.2's methods (phase 0 fixes the shapes); the chip + host menu; the four gestures; the readouts |
| H1 (the host), phase 2 | Opus | main.js, index.html, song.js hooks, tests/canvas-AUTO-sim | §3 (grab / poll / latch / wrap / undo / two-finger), §4 (the tick, override, ↺, the mixer), §6.3, the roll host's methods, the dots |
| H2 (the bounce), phase 3 on H1 | Opus | main.js bounce, tests/main-sim.mjs, tests/canvas-AUTO-sim (G4) | §7.0 the probe first (Chrome for Testing + the iOS Simulator's WebKit, its result in §13), then §7.1 / §7.2 |
| G (gates), beside the reviewers | Sonnet | tests/ui-bench-fps.mjs (+ .test), tests/bench.json row `ui-AUTO-mac` | G7's scenes and run; the A/B |
### 10.2 Interfaces (fixed here)
- `S.normAuto(a)`, `S.autoAt(pts, tick)`, `S.autoWrite(pts, t0, t1, newPts)`, `S.autoThin(pts, eps)`, `S.autoKeys(t)`.
- main.js pure: `autoOk(t, key)`, `autoGet(t, key)`, `autoApply(t, key, v)`, `autoRange(t, key)`, `autoFmt(t, key, v)`, `autoLabel(t, key)`.
- wk: `W.follow(v)`, `W.setAuto('on' | 'off' | null)`; classic: `P.follow(id, v)`, `P.setAuto(id, state)`.
- The roll host: §5.2's list.
### 10.3 Rules
Failing test first; goldens bit-identical; one test file at a time; `?v=9`; `node tools/precache.mjs --write` after any site-file
change; no engine.js change unless §7.0's fallback is invoked (then its own failing test, golden-graph green); the lead regenerates
sw.js at every merge; short notes in §13.
### 10.4 Pins that move by design
SCHEMA 18 → 19 in: tests/cv-migrate.test.mjs (13 sites), kit-core.test :297–302 ("a 19 opens read-only" → 20), master-mods-model.test
:21–29, canvas-7c-sim :643 / :655, canvas-8-sim :405 / :418, canvas-9-sim :436, canvas-9b-sim :438, canvas-DM-sim :398, canvas-M-sim
:339; one more `STEPS` entry; ui-bench-fps.test's scene counts (+2); roll.test's region pin if the strip gains a region; lint's accessor
ratchet untouched (device records named `d` / `iv`).

## 11. Questions for the user
The four in the header (asked 2026-11-03 with the lead's guesses). Decided by the lead: the AUTO arm button exists and is on by default;
the skeptic's four (§14.5): pure writers + polling; the bounce probe first with the `at` fallback; a 60 Hz staggered tick; a hidden
page freezes automation (a chase on return).

## 12. Known limits (cut 1)
- Switches, menus, selectors, bools and enums are not automated (a step curve is cut 2); the 900 Series knobs and the master canvas's
  racks / volume are not.
- Timing: live playback is tick-granular (≤ 16.7 ms + the 128-frame quantum late) and smoothed by the family's own smoothing; a bounce
  steps every ≈ 11 ms where a curve moves, as live does, each step landing quantum-exact; the mixer sample-accurate. Fast stepped moves are not
  reproducible; LFO-style motion belongs to the modulators.
- A hidden page (a background tab; the iPad app in the background with audio on) has no frames: automation freezes while the audio
  plays and chases on return.
- A wheel / typed / MIDI CC change during a take overrides the key instead of writing (only a held knob writes).
- A removed kit voice's curve drives the next voice added in that slot; a cross-track paste leaves foreign keys inert.
- (fix round, left) A touch tap within 14 px of the curve adds nothing; the amber-on-ivory dot leans on its dark edge; the roll does not
  redraw during playback (the heard dot rides the playhead); the bounce builds its assets once at the start.
- Curves are not exported to MIDI; imported CCs make no curves. The arrangement view shows no curves (bars still copy with them).

## 13. Notes (the builders fill in)
**Phase 0 M** (the model; branch auto-p0m: eef12c3 the failing tests, 0cbf6f3 song.js, c0ee9f1 schema 19 + the pins). song.js: `normAuto`,
`autoAt`, `autoWrite`, `autoThin`, `autoKeys` (+ `AUTO_MAX` 20 000, `AUTO_KEYS`, `autoKeyOk`); `deserialize` carries `auto`; `contentEnd` /
`songEnd` count the last point + 1 (a cc event's rule); the six range ops per §2.1 (the clip carries `auto` per track, `{key: {pts}}`).
cv-migrate: SCHEMA 19, STEPS[18] the identity; `splitTracks`: `mix:*` on every track, an instrument's keys and its panel's under their new
ids (`i2:` → `i1:`, the panel → `fx1`; a Serum's panel's only when its FX became the Serum's), the keeper the rest (modulators, inert keys);
main.js `duplicateTrack` one line. Tests: tests/auto-model.test.mjs (G2: 22 000 seeded cases, ~1 s; the no-automation digest
tests/fixtures/auto-noauto.json recorded from ⟨B⟩'s song.js), cv-migrate (schema 19, splitTracks), canvas-2a-sim (duplicate). Deviations:
- `autoWrite` also writes a **lead** point `[t0 − 1, autoAt(old, t0 − 1)]` (skipped when the new points start at t0 on the old curve, or
  a point sits at t0 − 1): without it the segment into t0 bends the values before t0 — §2.1's "values outside unchanged". The jump pair
  at t1 is `[t1, old]` whenever an old point lies at or past t1, plus `[t1 − 1, last new]` unless they are equal.
- Paste always jumps back to the target's own value at at + len, past its last point too (the "skipped past the last old point" rule
  is a take's: `autoWrite` keeps it); the clip's last point sits at len (outside [at, at + len)), so the paste writes the clip's value at
  len − 1 there. A key the target lacks arrives as it is (its last value holds).
- Clear's "flat gap" read as no points inside (s, e): the line from autoAt(s) to autoAt(e); nothing inside → nothing changes. Insert
  adds its two points only when the curve has points on both sides of `at` (else the shift alone keeps every value).
- Values: 1e-6 absolute in song.js (the 1e-4-of-the-range rounding is the host's: song.js knows no control's range); `mix:vol` / `mix:pan`
  clamped to their domains, everything else bounded to ±1e6 (so the rounding stays finite). Safety bounds (a hostile file): 4 096 keys a
  track, 2^20 points read from one key. Any other `mix:` key is dropped as `mfx:` is.
- `deserialize` puts `auto` last on the track (where the host adds it to a live track), not inside the literal.
- `autoWrite` checks its inputs in O(n) and sorts only a malformed one (the host calls it every tick); it returns a new array; points are
  pairs never written in place (a clip, History and a track may share them).
- Pins moved beyond §10.4's list: canvas-9-sim :446 and canvas-M-sim :352 ("a schema-19 file: read-only" → 20).
- Not done here: `toV1` (Save as classic project) does not name the curves in its lost lines (the live site drops `auto`).
### Lane W (widgets), branch auto-W
Commits: wk `follow` / `setAuto` + tests/wk-auto; ClassicPanel `follow` / `setAuto` + `api.draw` / `binding.draw` + cv-panel's draws + tests/classic-auto; the `[data-auto]` CSS + sw.js.
Signatures (the host calls these; none posts, writes, or touches History):
- `knob / slider / fader / numBox`: `W.follow(v | null)` — v a normalised n (0..1; non-finite → null). `W.setAuto('on' | 'off' | null)` on those and on `menu` / `toggle` / `seg` / `iconSeg`: sets / clears `data-auto` on `W.el` (the `[data-dest]` root; any other string clears).
- `ClassicPanel#follow(id, v | null)` — v in the control's **model units** (`vals[id]`'s, not normalised); `ClassicPanel#setAuto(id, state)` — sets `data-auto` on the `[data-ctl]` wrap that carries `data-dest` (Simple `.ctl`, hardware `.hw-c`; a seq: / dx: token without `data-dest` is skipped). Inert after `destroy()`.
How: wk keeps `fv`; `update()` draws `vn()` = the followed value (or `get()`); `follow()` is a no-op when unchanged, else one `update()`. ClassicPanel keeps `fol` (id → v); its draw closures (knob / slider / numBox / selector / toggle, `ariaVal`) read `dv(id)`; `follow` runs `ui.get(id)` (which includes cv-panel's `api.watch` updaters). cv-panel draws through `api.draw` (`api.get` stays the base for writes: the tap, the wheel, press, stepping), falling back to `api.get` for a host without it.
Behaviour: a drag draws the base it writes while it lasts (wk: `g.n`; classic: `drg` set) and starts from the followed value (wk `n0` — so the `'start'` set carries the followed value; classic `dragB` `p` from `b.draw`); at the lift the followed value is drawn again until the host calls `follow(null)`. Keys, wheel, dblclick-reset, typed entry act on the base (the drawing stays at the followed value). The wheel / key `put` therefore leaves the control drawn at the followed value — the host clears `follow` on its override.
Deviations: (1) the dot is the `::after` everywhere except a knob wearing `data-rig-ring` (the rig's segmented cord ring owns that `::after`): its dot is the `::before`; (2) the tint is `var(--mc, var(--tc, var(--sx-accent)))` — `--mc` is the module colour (cv-module sets it from the track), `--tc` the track chip's; (3) `.ctl[data-auto]` gets `position: relative` (the Simple layout's flex column is not positioned) — the only positioning added; (4) the typed-entry box on a followed knob still pre-fills the drawn text; (5) cv-drum / other `dragB` callers with their own bindings lack `draw` and fall back to `get` (no follow) — add `draw` there when those faces are wanted. Not done: the mixer fader's host wiring (host's job), tooltips (`tipB`) show the base.
Tests: tests/wk-auto.test.mjs (15), tests/classic-auto.test.mjs (8); green with them: wk, classic-panel, classic-mod, cv-panel, kit-ui, rig-ui, fx-ui, rig-core, rig-model, lc-model, cv-module, cv-mods-ui, cv-world, cv-face, cv-tray, kit-core, app, mod1-model, canvas-WC-sim, lint, pwa. The Chrome script tests/ui-layout-wc.mjs was not run (not this lane's).

### Lane L (the lane editor, 2026-11-03; commits 0e3080a, 3f9bbf4 + this note on auto-L)
**What.** `roll-auto.js?v=9` (imported by roll.js only; precached) holds the lane: the chooser chip, the curve, the gestures, the
readout; roll.js routes its region / pointer / scene / overlay paths to it. A host without `autoLane` gets the roll exactly as at ⟨B⟩
(the "VEL" corner, region 'vel': roll.test's pins, the region pin at :712 included, untouched). With a curve shown the strip's
region is `'auto'` (`'velg'` stays the corner, now the chip). Tests: tests/roll-auto.test.mjs (16, the fake DOM) and
tests/ui-layout-roll-auto.mjs (Chrome for Testing, d / l / p, `--out <dir> --profile <dir>`, exit 1 on a failure; green; contact
sheets roll-auto-<size>.png with the chooser and its Add… level open). Both use the stub host tests/roll-auto-stub.mjs.
**The host shapes (the stub's; main.js gives the same names).** `autoLanes(t)` → `[{ key, short, long, inert }]` (the track's keys
with points, in its order); `autoPts(t, key)` → `[[tick, v], …]` sorted, one per tick, `[]` for none (the roll never mutates it);
`autoEdit(t, key, label, fn)` — `fn(copy)` → the new points (already sorted / de-duplicated by the roll), the host normalises
(`normAuto`), stores, records one History step; `[]` removes the key; label `"Automation: <short>"`; `autoLabel(t, key)` → `{ short,
long }`; `autoFmt(t, key, v)` → string; `autoRange(t, key)` → `{ lo, hi }` finite, `lo < hi` (else the lane is inert); `autoOkList(t)`
→ `[{ key, short, long, group }]` in module order; `autoLane(t)` → key | `'vel'`; `setAutoLane(t, key | 'vel')`; **`menu(items, x,
y)`** — the roll's host had no menu member at ⟨B⟩, so it is defined here: wk context-menu items (`{ label, action, checked, disabled,
sub, sep }`; Add… uses `sub`, nested by module), x / y client px under the chip; main.js: `menu: (items, x, y) => cvTray.popupMenu(x,
y, items)`.
**Roll API (new).** `autoLane()`, `autoSelected()` (the selected point's tick | null), `openAutoMenu()` (→ false without an automation
host), `autoReadout()`, `autoChip()` (`{ x, y, w, h, label, text, tw }` | null); `deleteSelected()` deletes the selected point when no
note is selected (→ 1); `selectNone()` clears it too; `vt` (the strip's top).
**Deviations (each with its reason).**
1. A drag (point / segment) previews on its own copy and commits **one** `autoEdit` at the release — so a second finger simply drops
   it (two fingers never edit, no rollback) and every edit is one step; the cost: playback hears a dragged curve only at the release.
2. The corner is not widened on desktop (GUT_P 64 is pinned across roll.test and the key strip): the chip fits its label at 10 / 9 px
   and ellipsizes a long one ("▾ Empha…"); the readout pill names the control in full ("6.0  Minimoog · Cutoff").
3. With the chip present the velocity lane's corner numbers draw only where they clear the chip (mouse: 64; touch: none); its lines
   and stems are as before.
4. The chooser: Velocity, the automated keys (✓ the shown one), an inert key as a greyed "<long> (no such control)" plus its own
   "Delete <short> automation" item (a disabled wk item cannot hold a sub), a lane just picked from Add… (no points yet) listed ✓,
   a separator, Add… → the module groups → their controls **without a curve** (the automated ones are listed above; one group: flat).
5. Gestures, settled where §5.2 is silent: a tap snaps by `round` (Shift / Fine: no snap); a point never passes a neighbour (clamped
   one tick inside), time follows a touch drag only after 10 px sideways (6 pen, 4 mouse: a value drag keeps its tick); a segment's
   ends clamp each to the range; a drag on the empty lane scrolls time with a finger (rows held), does nothing with a mouse;
   long-press delete is touch / pen (a mouse double-clicks); a touch press within 16 px of a point grabs it (pen 9, mouse 6), a
   segment within 14 / 8 / 5 px of its line. An inert lane (or a bad range) draws greyed and never edits.
6. `autoAt` is a local copy in roll-auto.js marked `// (P0M lands S.autoAt; swap at merge)` (§2.3's rule; tested there).
**What the host must provide / do (lane H1).** The ten members above; call `roll.render()` whenever the shown curve changes
(recording, undo / redo, a lane chosen elsewhere, a track's keys renamed / gone); main's Escape (main.js ~:6098 `roll.getSelection()
.length` → `selectNone`, else panic) should also treat `roll.autoSelected() != null` as a selection; the Delete key / toolbar
Delete already reach `roll.deleteSelected()`. The heard dot / readout read `setPlayhead`'s tick (the heard one) — nothing new.

### Phase 0 H (lane P0H, 2026-11-03; commit 14266a2 on auto-p0h, from 62a7459)
**What.** main.js, pure, no behaviour change without curves: `renderTick()` beside `curTick` (`AC.heardTick(ctx.currentTime × sr, T.as)`,
memoised on `frameN` + the newest anchor; stopped `T.pos`); `autoOf` (key → family `mix` / `fx` / `kit` / `rig` / `classic`), `autoOk`,
`autoOkEl`, `autoGet`, `autoApply`, `autoRange`, `autoFmt`, `autoLabel`; `mixOne(t)` (mix()'s per-track lines; mix() now loops it — the
same calls in the same order). tests/auto-host.test.mjs (10, green): every function on a Minimoog, a rig, the rig's Reverb, a kit voice and
the mixer; `autoApply` posts ONE `{t:'patch'}` = `buildPatch` with only the key's fields moved (classic: `fieldDiff` ⊆ `targetsOf`), no
History step, the preset kept, no `sxDirty`, no autosave write (`ls.writes`; the kit knob's own writer as the probe's control). Scenes
`auto8` / `auto8r` in tests/ui-bench-fps.mjs (+ EXPECT; ui-bench-fps.test's counts 10 → 12). tests/canvas-AUTO-sim.test.mjs: G3 / G4 failing
by design (below).
**`__synthTest.cv.auto`** (by track id; the shown track for okEl): `ok(tid, key)` → bool · `get(tid, key)` → number | undefined ·
`apply(tid, key, v)` → bool (written) · `range(tid, key)` → `{ lo, hi }` | null · `fmt(tid, key, v)` → string ('' for nothing) ·
`label(tid, key)` → `{ short, long }` | null · `okEl(el)` → key | null · `renderTick()` → tick · `mixOne(tid)` · `set(tid, key, pts)` →
the stored pts | null (`track.auto[key] = { pts }` through `S.normAuto` when it exists, else a sorted copy; empty / null pts remove the key,
no key left removes `auto`; no History, no persist) · `held()` / `override()` → `[[trackId, key], …]` (`[]` until H1).
**Deviations, with reasons.**
- `autoApply` calls `queuePatch(t)` itself (patchQ coalesces one patch a track a frame — §4.1's "one queuePatch per track per tick" holds)
  and returns whether it wrote; it clamps to `autoRange`. The mixer: `mixOne`, no patch.
- `autoLabel`'s long names are what the user sees today: the rig's bar title with its ordinal ("Filter 1 · Cutoff", "Envelope 2 · Attack",
  "Amplifier · …" for instrument-wide ids), an effect's `instLabel` ("Reverb · Size"; numbered from the second: "Reverb 2"), the mixer's
  `long = short` ("Volume", "Pan") — not §5.1's examples "Filter · Cutoff" / "Reverb 1 · Size". rig-core.js exports `destPart` (one word,
  pure) for the rig's module.
- `autoOk` beyond §2.2's words: an `fx.` id counts only on a panel or a rig (a classic's effects are its panel's, `fxN:`); the rig also
  refuses the placeholders bus1–16 / g.wheel / g.bend (setDestBase has no base for them); m1–m8 pass (§2.2's "virtual" names arp / clip; a
  modulator's knobs are refused on the DOM side by `data-nomod`) — H1: say if the Macros should go; a kit key needs its voice present
  (`autoApply` still writes an absent voice's vals: §2.2's "the next voice in that slot").
- `autoRange` is null for no control (an inert key, a classic selector / toggle): the lane needs another y range for inert keys (L / H1).
- `autoOkEl(el, t = trk())` walks `parentNode` as cv-cables' `attrUp` (same answer as `closest`; works in the sim's DOM).
- `autoFmt`: FX rows through `core.fmtParam` on the real FX state (fx-ui's `fmtV` uses a one-instance view — equal for the Reverb's size,
  pinned); a rig without the oscillators' frame info (a.wt's 'frame' readout falls back); the fader laws.js 'db' (20·log10), the pan 'pan'
  ("L25" / "C" / "R25") — the heads show no readout today.
- `auto8`: 7 tracks (the project's classic + juno60 / prophet5 / obxa / jupiter8, two rigs), not 8 — §4.2's "2 rigs + 5 classics + 1 FX knob"
  read as 8 automated devices; 16 curves: the classics' cutoff + pan, the rigs' f.cutoff + mix:vol, the Reverb's size, rig 2's f.res (a
  triangle a bar); EXPECT as play8's (head meters min 7) + the roll's playhead for auto8r.
**canvas-AUTO-sim: what it assumes where §3 / §6.3 / §7.2 leave a name open** (H1 / H2 may rename them with the test): the AUTO arm `#tAuto`
(`aria-pressed` 'true' / 'false', `settings.autoArm`), ↺ `#tAutoRe`; the grab is a document capture `pointerdown` (the faces' element:
`data-dest` + `data-dev` / `data-cv-mod`), the release a window `pointerup` / `pointercancel` (`gesture: 'two-finger'`), the fader's own
listeners on `.hvol`; the knob's value moved by its model (the polling's source); the fake OfflineAudioContext records `ctx.suspends`
(seconds) and a Param's `events` as `[kind, value, time]` (kind 'ramp' = linearRampToValueAtTime); H2's probe result is a line of
its own in §13 that starts `Probe (§7.0):` then holds / fallback. "A 19 file in an 18 build" is tested one schema on (a 20 file in the 19 build) + the SCHEMA / STEPS
pins; "posts exactly ⟨B⟩'s messages" as `S.autoKeys` empty + no patch over a pass of plain playback (the byte comparison is G8's).
**The failing tests (2026-11-03, each for its reason).** G3: two passes held / latch / across the wrap / the two-finger drop (no recorder:
no curve, `held()` []); a press without a move (`held()` []); rig / FX / kit / fader (no curve); AUTO arm (`#tAuto` has no aria-pressed);
override + ↺ (`override()` []); playback (the base does not follow); save → load (deserialize drops `auto`, P0M); schema 19 (SCHEMA 18, P0M);
no automation (`S.autoKeys` missing, P0M). G4: timing at 120 / 240 (the base does not follow); the bounce (no `ctx.suspends`); the mixer's
ramps (no `events`); the probe line (none yet).

### Lane H1 (the host, 2026-11-03; branch auto-H1 from 12b9adf: 13a1dde the host, bed44bf tests/auto-host + this note)
**What.** main.js (one block after `autoLabel`, hooks in the transport / History / heads / frame loop / roll host): §3 the grab (a document
capture `pointerdown` → `autoOkEl` on the shown track; the head's `.hvol` / `.hpan` their own; release by pointerId on the window:
`pointerup` / `pointercancel` / `lostpointercapture`, `e.gesture === 'two-finger'` the drop), the poll at the automation tick (`autoGet`),
the spans (`autoWrite` progressively, `autoThin` at the release, the latch closed by `autoWrite`'s jump pair), the wrap inside `recAdv`
(committed to `le` in the old pass's step, a held key continued from `ls` in the new pass's), undo / redo / seek / stop / record off /
AUTO off end every span first; §4 `autoTick` from `frameTick` (60 Hz, staggered over two ticks past 4 tracks with curves), playback at
`renderTick()` vs the base (`autoGet`), the override on any base change since playback's last write, ↺, the stopped rest (`autoRest`
after stop, on a stopped seek, after a stopped lane edit); §6 `follow` at the heard tick (classic / hardware `P.follow`, wk `W.follow`;
the faders' `input.value`), `follow(null)` for held / latched / overridden keys and at stop, the dots (`setAuto` / `P.setAuto`: on every
automation change, and every 30th frame while any shows — a face mounted since); §6.3 `#tAuto` (aria-pressed, `settings.autoArm`,
default on) and `#tAutoRe` (disabled / `.on`, "Re-enable automation · N controls") in index.html + style.css; §5.2 the roll host
(`autoLane` / `setAutoLane` per track for the session, `autoLanes`, `autoPts`, `autoEdit` through `S.normAuto` with one History step,
`autoLabel`, `autoFmt`, `autoRange` ({0, 1} for an inert key), `autoOkList`, `menu` = `cvTray.popupMenu(x, y, items)`); Escape treats
`roll.autoSelected() != null` as a selection; `__synthTest.cv.auto.held()` / `override()` the real lists, + `spans`, `lanes`, `okList`,
`edit`, `lane`, `dots`, `faces`, `grab`, `release`. Tests: canvas-AUTO-sim G3 12 / 12 (and G4's timing); tests/auto-host.test.mjs +6 (the
transport buttons, follow + dots, the faders, the 60 Hz budget at 120 Hz, the roll host, the faces by family).
**Deviations, each with its reason.**
1. canvas-AUTO-sim's rig / FX / kit test selects each track before its grab (`api.selectTrack(tid)`, then back to the Minimoog) — the only
   test change: the canvas's faces are the shown track's, so the grab resolves its key on `trk()`; the test grabbed the rig's and the
   kit's knobs with the Minimoog shown (no face of theirs exists then). No assertion changed.
2. A change seen at a poll is stamped at the **poll before** (the frame the finger moved in: a move lands between two frames' polls), not
   at `recTick(now)` — the kit's tolerance (0.05 at 1/400 a tick) allows 20 ticks; "now" is a frame late (61 ticks at 240 BPM). The
   first point is `[tGrab, the base at the press]`; a first change seen at the first poll replaces it (the same tick).
3. The grab value is the base at the press (the capture listener runs before the face); a wk drag's `'start'` that writes the followed
   value (lane W) is told from a move at the first poll: the base equals the value the faces were last told to follow → taken as the grab
   value (no gesture, no override).
4. The two-finger drop removes the pass's step directly (`hist._drop(hist.u.pop())`, main's own idiom at its other refusals) when the
   step is the top and only that key joined it — `recStep` now records what joins its step (`T.stepK`: the automation key, '' for notes /
   cc / pads; a resumed step after an undo counts as unknown). `hist.prune` compares whole snapshots, and the knob's moved base is in
   them: it would never match.
5. Playback's "last written" (AW) is cleared at ▶ (and per key at a release, an edit, ↺): a knob turned while **stopped** is taken over by
   its curve at play — no override from a stopped move (Ableton lights ↺ there; reversible: keep AW across stop).
6. A written track's patch is sent in the tick itself (`patchQ.delete(t); sendPatch(t)`), not at the next rAF: the model and the posted
   patch agree within the tick (G3 playback's check); still one patch a track a tick.
7. The 60 Hz budget is a 10.5 ms gate on the frame's time (`AUTO_GAP`): 60 / 120 / 240 Hz displays tick at 60 Hz, a 90 Hz one at 90, a 144
   Hz one at 72.
8. Undo / redo during a take end every grab (`dead`), not only the moved ones, so `held()` is [] after Ctrl+Z (G3); the finger's key stays
   the user's until its release (playback skips it; nothing is written).
9. A latch ends at the pass's end (no continuation: G3's "the next pass untouched"); a held gesture continues across the wrap (`[ls, v]`
   written at the wrap, in the new pass's step).
10. AUTO turned off mid-take closes the take's latches at once (nothing more is written).
11. A lane edit while stopped puts the knob on the edited curve at the playhead (as `autoRest`); the points are rounded to 1e-4 of the
    range (recording too) before `normAuto`.
12. kit-ui.js, one line: the voice view exposes its `widgets` (the host's follow / setAuto on the voice's knobs).
13. The faces by family: classic / hardware `classicPanels` (`P.follow` model units, `P.setAuto`); an effect fx-ui's `rec.ui.knobs` (dest
    → widget, n); a rig its SerumHost's bound widgets by `data-dest` (`views[].page.binds` + `headPage.binds`, indexed per host, rebuilt
    when the binds change — a read of sx-host's members, no sx-host change); a kit voice `kitVox`'s `V.widgets` (n = v / 10). The mixer's
    inputs carry no dot (an input draws no `::after`). Keys that fail `autoOk` (inert, a selector) get no face / dot.
**For the fixer / the reviewers.** The rig's and the effects' faces are **not mounted in the sim** (`serumPanels` / `fxPanels` records
without `ui` there): their follow and dots are unverified by node — a Chrome check of a rig's CUTOFF and a Reverb's SIZE (the dot on /
amber / gone; the knob following while playing, the base at stop) is wanted; if the reach into SerumHost's pages is unwelcome, a
`widgetsOf(dest)` on SerumHost / FXRackUI would replace `autoRigWs` / `knobs`. The Macros (m1–m8) stay automatable (P0H's question): Add…
lists them only when the rig shows its Macros module. A MIDI-learned CC during a take overrides (§4.3 / §12). The override test
compares bases with 1e-9: a writer that re-rounds a base by itself between ticks would read as an override — none seen.
**For H2 (the bounce).** The playback writer is `autoPlay(t, rt)` (skips overridden / held / latched keys — a bounce should render every
curve: call `autoApply` itself, not `autoPlay`); `AW` / `AO` are the session's — a bounce must leave them alone (restore the bases it
wrote; never call `autoRest` / `autoOverride`). `autoTick` runs only while `T.playing`; `stop()` ends with `autoFollowOff(); AW.clear();
autoRest()`. G4's timing passes already; the bounce, the mixer's ramps and the probe line are H2's.
**Failing (2026-11-03).** canvas-AUTO-sim's G4: "a 2-bar bounce of an automated cutoff" (no `ctx.suspends`), "the mixer in a bounce"
(no Param timeline), "the bounce probe's result" (no `Probe (§7.0):` line) — lane H2's.
### Lane H2a (the sim's offline context, 2026-11-03; branch auto-H2a: 97ea3b8 `suspend` / `resume`, 5520c4f the Param timeline, this note)
tests/main-sim.mjs only (+ tests/main-sim-offline.test.mjs, 16 tests: the contract below). **API (OfflineAudioContext):**
- `suspend(t)` → a promise resolved when the render reaches the first quantum boundary >= `round(t·sr)` (rounded **up** to a 128 multiple):
  `currentTime` / `frames` exactly there, `state` 'suspended' (statechange fires), no quantum rendered past it. `resume()` continues.
  `ctx.suspends` = the times asked for (seconds, call order — P0H's name and unit, so G4's `s * tps` holds); `ctx.suspendFrames` = the
  frames stopped at (stop order). Rejections as Chrome: InvalidStateError for a negative t, a stop earlier than the current frame, at or
  after `length`, a second suspend in the same quantum (compared after rounding up), a finished render; TypeError for a non-finite t.
  `resume()`: InvalidStateError before `startRendering` and after the render; while running it resolves. A second `startRendering`
  rejects. A render with no suspend is as synchronous as before (no `await` runs: `sim.lastOffline` is set before the first microtask).
- Messages: an offline node's `port.postMessage` queues (structured-cloned, recorded in `node.posted` / `sim.posted` at once, as ever);
  the render drains every node's queue before each quantum (live nodes stay synchronous). So a patch posted inside a suspend reaches
  the processor after the stop and before the next quantum — the §7.0 probe's Chrome (lag 0). Test seam: `new AudioWorkletNode(ctx,
  name, { simProc: { process, msg } })` uses the given processor instead of the engine (live and offline).
- `Param` (offline contexts only; live params stay instant, record nothing, `events` is `[]`): `value`, `setValueAtTime`, `linearRamp…`
  (kind 'ramp'), `exponentialRamp…` ('exp'; a 0 target is a RangeError), `setTargetAtTime` ('target', events carry a 4th member, the
  time constant; tc 0 = a step), `cancelScheduledValues(t)`; `events` = `[kind, value, time]` in time order (a tie in call order; kinds
  'set' | 'ramp' | 'exp' | 'target'); `at(T)` the value at T s. A ramp with nothing before it starts from the value at `currentTime`
  (the spec's implicit setValueAtTime; a hidden anchor, not in `events`); `value` reads at `currentTime` (a stop in a suspend sees a
  ramp half way) and assigning it with events present is a setValueAtTime at `currentTime`.
- The routes (gain products, last panner) are read **per quantum at its start** (`settle`, offline) — a constant gain is the same
  float product in the same order, so every pinned buffer is bit-identical (canvas-M-bounce and the sims passed unchanged). A ramp is
  stepped per quantum (Chrome: per sample), so a ramped mix differs from Chrome's by up to one quantum of slope; a test comparing a
  ramp's render to a formula tolerates 128 frames. Live `sim.run` reads once per call, as before.
- Not modelled: edges connected / disconnected while suspended (routes are fixed at `startRendering`), `setValueCurveAtTime`,
  `cancelAndHoldAtTime`, a ramp right after a `setTargetAtTime` starting from the target's start value (the spec's literal reading),
  two ramps replacing one another at one time, the context's 'suspended' state before `startRendering` and 'closed' after (it stays
  'running').

### Lane H2 (the bounce, 2026-11-03; branch auto-H2 from 126c452: a91e31d the bake, this note + the probe's section moved here)
**What.** main.js only (the bounce path; no engine change — the probe held). `bounce()` builds its items inside `autoAtTick(start, …)`:
every instrument key of every track written at `start` (`autoPut`), `bounceSet` + the items' payloads (patches, graph parts, `songData`,
`seqPayload` / `drumPayload`, `modsFor`) built, everything restored. `autoBake(items, start, end, f, sr, len)` → the suspends
`[[s, fn], …]` for `renderOffline`'s new `o.sus` (each `oc.suspend(s).then(fn(byId); resume())`, before `startRendering`) and each
audible item's `ramp {vol, pan}` (`renderOffline`: `setValueAtTime(v(start), 0)`, then `linearRampToValueAtTime` at every breakpoint
inside the range, and to `v(end)` when the curve goes on past it). The change ticks (`autoTicks`): every breakpoint in (start, end) ∪
the `PPQ / 8` grid inside moving segments where the value has moved ≥ 1/512 of `autoRange` since the last tick kept; each → the next
quantum boundary F (`ceil`), `s = (F + 0.25) / sr`, the values read at the suspend's own tick `start + s · tps`. At a suspend, per item
whose values moved since its last post (`autoPost`): `autoSnap` → `autoPut` its keys → `buildPatch(t, sr, true)` through `postPatch` on
the offline node's own part cache (`autoCache`: `partCache` of its options — `fxrT` / unchanged tables stripped as live), or for a graph
track `graphParts` → `{t: 'patch', i, p}` per Inst (`instCache`), `postChain` per chain, `{t: 'graph'}` if its key moved (never seen),
`buildMods` when its key moved (a cabled classic knob's transfer moves with its base) → the restore. A track without curves: no suspend,
no event, no message (`autoBake` returns `[]`; canvas-M-bounce bit-identical).
**Suspend count.** The grid is 1/32 note: a key moving ≥ 1/512 of its range per 1/32 note costs 16 suspends a second at 120 BPM (32 at
240); G4's 2-bar ramp at 240 BPM: 64. A 3-minute song at 120 BPM with one key moving the whole time: ≤ 2 880 (the probe's cost: ≈ 40–60 ms
a 1 000 suspends with a patch each in a 10 s render, + the builds: classic 4–7 ms a 1 000, a rig ≈ 0.5 ms each → ≈ 1.4 s for 2 880 rig patches); a take that moves a
third of the time ≈ 1 000 (§7.1's estimate). Keys on one track share a suspend (one patch); tracks share the quantum (one suspend).
**Deviations, with reasons.**
1. `autoApply` split: `autoPut` (its model write, clamped; returns the key's `autoOf`) + `autoApply` = `autoPut` + `mixOne` / the classic's
   `cpVer` bump / `queuePatch` — same behaviour (auto-host 16 / 16 unchanged). The bounce must not queue a live patch, touch the live
   mixer or bump the halos' version.
2. Not a scratch copy: the writes go into the track's own objects and come back exactly (`autoSnap`: shallow copies of what `autoPut`
   touches — classic / kit `vals`, a rig's `s.p`, its macros and oscillators (`syncS1`'s phMem), an effect instance's `p` — put back field
   by field, no law round trip; and `modsLast`, which `buildMods` refreshes for the live readers). `buildPatch` stays honest: cv-graph's
   per-track memo and injectMods' slot maps (WeakMaps keyed by the vals object) see the same objects as live; a copy would place the
   matrix slots anew. Everything between snapshot and restore is synchronous (no rAF / autoTick between): the bases are bit-identical
   after, H1's override never fires, `AW` / `AO` / follow untouched; a bounce while playing snapshots afresh at each suspend.
3. A suspend sits on the quantum boundary **after** its change tick, and the value posted is the curve at the suspend's own tick (what
   G4 checks: `s · tps`), so a jump pair lands complete; an item whose values did not move since its last post sends nothing (a
   breakpoint inside a flat stretch adds no suspend) — "one patch a suspend" holds per item.
4. The mixer keys are never written into the model (`t.vol` / `t.pan` untouched): ramps only, on an audible item (a muted MIDI-OUT /
   sidechain source keeps gain 0), clamped to `autoRange`.
5. The probe's section moved from after §14 into §13 (G4's probe test reads §13 and wants `holds` right after the colon: the bold around "holds in Chrome" dropped, the text otherwise unchanged).
6. A suspend callback that throws is logged and still resumes (a hang otherwise); a rejected `suspend` is logged.
**For the fixer / the reviewers.** Checked in the sim beyond G4 (scratch, not committed): a rig's f.cutoff + its Reverb's size + a kit's
kick decay → 64 patches each, none with `fxrT`; a graphed Minimoog (a wheel row on fc) → `{t: 'patch', i: 'i1'}` + `{t: 'mods'}` at each
suspend; the models' JSON identical after, no live message during or after. Not done: a Chrome / WebKit render of an automated bounce
(the reviewer in Chrome: an automated rig cutoff, the render vs live; the wall time of a 3-minute bounce); assets (`needs`) and a drum
machine's payload are built once at `start` (an automated value that changes the needs — a Convolve shaping — is not re-ensured);
resample / render-last bake nothing (they render one device, no song). G4's tests unchanged.

### Probe (§7.0), 2026-11-03 (Chrome for Testing 156, headless, M4 Max; scripts in the lead's scratchpad auto-probe/)
Probe (§7.0): holds in Chrome — 260 suspend points over five configurations (1 node, 2 nodes, a cutoff jump, a 34 KB message, os 4),
every `{t:'patch'}` posted after `oc.suspend(t)` resolved and before `oc.resume()` applied in the quantum at t (lag 0 quanta, no
variance; the first differing sample = t + the engine's 47-frame limiter look-ahead; at os 4 the downsampler smears it 9–29 frames
further). `suspend` resolves with `currentTime` = t exactly; an off-grid t stops at the next 128-frame boundary (H2 schedules suspends
on boundaries, `t = (F + 0.25) / sr`). Wall time, a 10 s render at 48 kHz: 61–70 ms plain, 78–87 ms with 1 000 suspends, 102–128 ms
with a patch posted at each (building 1 000 classic patches 4–7 ms in all); 2 nodes 105 → 185 ms. H2: strip `fxrT` from the offline
patches (36.7 of a classic patch's 38.5 KB; the engine keeps its tables when the key is unchanged, as main.js:784 does); the
engine's ~6 ms smoothing still ramps after a quantum-exact landing. Not tested: WebKit (the iPad pass), graph nodes' per-Inst
patches, a real rig patch. §7.1 ships as written; the `at` fallback stays unused.

### Lane G (the frame gates, 2026-11-03; branch auto-G from bb2d877: e3ad13d the harness + this note's commit)
tests/ui-bench-fps.mjs + .test and this note only; no source file touched. M4 Max, Chrome for Testing 156 headless, dpr 2, app build bb2d877 (H1 merged).
**What is in.**
- `auto8` / `auto8r` finished: the project's Minimoog + Juno-60 / Prophet-5 / OB-Xa / Jupiter-8 + two rigs (a Reverb on the first), 16 triangle curves through `cv.auto.set`, 128 BPM, playing. The **Minimoog is shown last** (a canvas mounts one
  track's faces; P0H's stub left rig 1 shown); `auto8r` opens the roll and sets the Minimoog's cutoff lane through `api.roll().host.setAutoLane`. EXPECT: the shown knob's `aria-valuenow` writes (absolute 60 Hz, tol 0.8), the arrangement /
  roll playheads and head meters (min 7), and a new kind `post` (`t: 'patch'`, one rate per port, min 7 ports, 30 Hz).
- The harness counts what the page **posts** (`MessagePort.postMessage` wrapped in `installHooks`, while recording): per `{t}` and the patches per port with the engine; `finish` returns `posts` (`postsOf`), the cell keeps it.
  One port = one track's node (no track-to-port map is exposed; the engine tells the two rigs `serum` from the classics `analog`).
- Driver checks: `auto patch posts` (`autoCapCheck`: every 1 × cell posts no more patches a second than the cap-60 / 60 Hz cell, +10 % + 2, per port too; no patches at all = not live) and, for `auto8`, `auto faces 60` / `120`
  (`autoFaces` + `autoFaceGates`: shows each family's track — classic knob, classic slider, a rig's cutoff, the Reverb's size — and counts `aria-valuenow` writes per element ≥ 48 Hz and the frame cost med ≤ 2 / p95 ≤ 4 ms with those faces drawing).
- ui-bench-fps.test 33 / 33 (+2: the scenes / judges, the post hook); lint 179, pwa 25 green.
**Measured** (`node tests/ui-bench-fps.mjs --scenes auto8,auto8r --sizes d,l,p --throttle 1,6 --caps 60,120`: 36 cells with the 240 Hz cross cells; every cell passes its gates; a separate cap-240 run at d, 1 ×):
| §4.2 / G7 | measured | |
|---|---|---|
| frame cost 1 × (60, 120, 240@120, 240@60) med ≤ 2, p95 ≤ 4 | med 0.01–1.29, p95 0.98–1.47, max ≤ 1.75 ms (60 cap: d 1.285 / 1.47, l 1.08 / 1.22, p 1.02 / 1.16; auto8r d 1.205, l 1.04, p 1.26); the 120 / 240 displays tick every 2nd / 3rd frame, so their medians are the idle frames (0.01–0.9) and p95 is the tick frame | pass |
| 6 × cap 60 med ≤ 12 | auto8 d 5.53 (p95 6.86), l 6.69 (8.62), p 5.63 (7.15); auto8r d 6.49 (8.05), l 6.05 (8.12), p 6.48 (7.82) | pass |
| 6 × cap 120 (recorded) | med 4.75–7.12, p95 7.1–8.9; frames delivered 67–111 of 120 (the throttled main thread: the clock drops 1–3 levels) | recorded |
| layout + style, heap | 1 ×: 16–38 ms / s (play8 12–21); 6 ×: 94–189; heap −16…66 KB / s (gate 1 MB) | pass / recorded |
| the shown knob follows (Minimoog cutoff) | 60.1 Hz at cap 60 (l 59.7), 110 / 120 at cap 120 | pass |
| patch posts, 7 automated tracks | **30.0 a track = 210 a second** at caps 60, 120 and both 240 Hz cross cells, d / l / p, both scenes (not 60: 7 > 4 tracks are staggered, §4.1); **cap 240: 40 a track = 280 a second** | cap 120 / cross: pass; **cap 240 above a 60 Hz one** (finding 2) |
| faces at 1 × (cap 60 / 120) | classic knob 60 / 120 Hz, cost 0.95–1.19 / 1.1–1.37 ms; Juno slider the same; rig cutoff + Reverb size 59.6–60 Hz, cost d **2.035 / 2.215** (also 2.015 and 1.84 in two more runs), l 1.33 / 2.12, p 1.17 / 1.97; at 120: ≤ 1.17 / 1.5 | d rig cap 60 **fails med ≤ 2 by 0.03** (finding 3) |
| what the automation costs | play8 0.22 ms a frame → auto8 1.0–1.3 (cap 60, Minimoog shown): ≈ 1.1 ms; rig shown ≈ 2.0 — §4.2's "2–3 ms a tick with two rigs" holds as the upper end | |
| clients audit | **fails** in every size and scene: 4 rAF callbacks a frame at cap 60 against 1 at the other cells (finding 1) | **FAIL** |
**A/B** (kit, play8, roll8; d, 1 × and 6 ×, caps 60 / 120, `--no-cross`; this build against 12b9adf (before H1) by `git archive`, **the same harness file on both**, interleaved ×3): cost medians, this build vs the base, three runs each: play8 1 × cap 60 0.255 / 0.22 / 0.215 vs 0.225 / 0.205 / 0.245 and roll8 0.21 / 0.18 / 0.165 vs 0.175 / 0.205 / 0.16, 6 × medians 0.595 vs 0.65 (play8), 0.325 vs 0.345 (roll8): equal. kit 1 × cap 60 0.275 / 0.3 / 0.295 vs 0.27 / 0.28 / 0.27, cap 120 0.245 / 0.24 / 0.24 vs 0.215 / 0.215 / 0.22: **+0.025 ms (≈ 10 %), the same
sign in all three runs**, below NOISE's 0.1 ms margin (finding 4); kit 6 × 1.53 vs 1.335 (cap 60), 1.2 vs 1.185 (cap 120) inside the throttled ×2 spread. p95 and layout + style the same. `--compare` of each of the three runs against bench.json `ui-fps-mac` (8 cells), `ui-fps-mac-b` (8) and `ui-DM-mac`'s fps (4): no regression, 0 improvements. **Noise, not regression** (kit 1 × aside).
**`ui-AUTO-mac`**: the lead's bench.json row, in the lane's scratch dir (auto-G-scratch/ui-AUTO-mac.json): `fps` = ui-fps-mac's compact `benchRow` of the 36 cells, `posts[size/scene/Nx/cap] = [patches a second, ports, fastest port, slowest port]`, `faces`, `ab[cell/cap]` = { costMed, costP95, layoutStyleMsPerS } × { new, base } (the three runs).
**Findings for the lead** (nothing fixed here; every number reproducible with the command above):
1. **A wasted rAF a written track a tick (210 a second).** `autoPlay` → `autoApply` → `queuePatch(t)` arms `requestAnimationFrame` whenever `patchQ` is empty; `autoTick` then does `patchQ.delete(t); sendPatch(t)`, so the queue is empty again for the next track and the
   callback armed finds nothing. A stack trace of every rAF request over 2 s: 210 a second from `queuePatch < autoApply < autoPlay`, 60 from the clock. The clients audit flags it (4 callbacks a frame at cap 60). Fix: no `queuePatch` inside the tick (a flag on `autoApply`, or queue after the loop), or `patchQ.delete` only when nothing else queued.
2. **A 240 Hz display with the cap at 240 ticks at 80 Hz, not 60.** `AUTO_GAP` 10.5 ms: frames are 4.17 ms apart, the next one past the gap is the 3rd (12.5 ms): 40 patches a track, 280 a second, +33 % on the 60 Hz stream (§4.2 "a 120 Hz display posts no more than a 60 Hz one" — H1 deviation 7's "60 / 120 / 240 Hz tick at 60" is wrong for 240).
   The caps 120 / 60 on a 240 Hz display are exact (210). A deadline (`autoLast += 16.67`, resynced when late) or a gap near 16 ms keeps 60 on 120 / 240; a 90 / 144 Hz display then ticks at 45 / 72. The harness gates it: `auto patch posts` fails when `--caps` holds 240 (and with cap 240 alone: no 60 cell to compare with).
3. **A rig's patch is the cost.** Profile (CDP, 100 µs, 4 s, d, cap 60, Minimoog shown): main thread 98 ms / s busy, self time `cpKeyOf` (serum-core.js:2150) **11.6 ms / s** (the largest), `MessagePort.postMessage` 4.6 (the structured clone of 210 patches), `compileCore` 2.7, `compileSerum` 1.8, `buildSerumT` 1.6, `autoFace` 1.5,
   `postPatch` 1.3, `sameVal` 1.2, `keyed` (seq-core) 1.0. A rig's `sendPatch` with nothing changed costs 0.25 ms against a classic's 0.025: a moved base recompiles and hashes the whole Wavecraft patch (60 a second for two rigs). The d / cap 60 frame with a rig shown is 2.0 ms (budget 2): a light per-key message for a moved base,
   or caching the compile keyed on the base, would take most of it. The classic-only frame is 1.0–1.3.
4. kit 1 × +0.025 ms a frame (+10 %) in all three runs of the A/B while play8 / roll8 (which also run `autoFrame`) are equal: not the tick; kit-ui's one-line `widgets` exposure or `autoFace` on a kit track — within noise, noted.
5. `auto8r`: playback does not re-render the roll (`autoChanged` is called by recorded writes only); the heard value's dot rides the playhead overlay (`canvas.proll`, the clock's rate: 60 / 120 / 240 live). The open roll adds 0.7–1.0 ms at 6 × cap 60 (6.49 vs 5.53 ms, d), ≈ 0 at 1 ×.
6. Contract: the brief's "patch post rate ≈ 60 Hz per automated track" is 30 (staggered over two ticks past 4 tracks with curves); the scenes pin 30. 6 × at cap 120 does not reach the display (67–111 fps; recorded, ungated as every throttled non-60 cell).

### Fix round (2026-11-03; branch auto-X from 9416328, one commit per item: a995353 … ae4900b)
The two reviewers' and lane G's findings, the lead's 15 decisions, each with a failing test first (canvas-AUTO-sim "fix N", auto-host,
auto-model, roll-auto, wk-auto / classic-auto, cv-migrate; G's checks and reviewer 2's scripts in Chrome for Testing for 10 / 13).
**Fixed.**
1. (R1 P1-1) undo / redo / seek / AUTO off run `recAdv(recP)` before `autoEndAll` (the frame after the heard wrap no longer wipes the
   finished pass); `autoSpanWrite` never closes a span short of its last write (`sp.w`).
2. (R1 P1-2) `keepDevs` keeps an automated track's live `t.vol` / `t.pan` through ↶ / ↷ (as knob vals): no mixer override.
3. (R2 P1-1) a stopped write (■, a stopped seek / lane edit, ↺ stopped) redraws its faces from the base (`autoRedraw`: `P.update` /
   `W.update`; wk's `follow(null)` is a no-op once nothing is followed).
4. (R1 P2-1) `autoEdit` and the arrangement's range ops end the take's spans first (`autoEndNow`: the latch closed with its jump pair at
   the heard tick). Deviation: the roll's note `edit()` never touches `auto`, so it leaves the spans alone.
5. (R1 P2-2) past 20 000 points a key is thinned harder, never cut: `S.autoCap` (RDP from 1e-3 of the range — of the values' span in
   song.js —, eps doubled until it fits, each pass from the source) in `autoStore`, `normAuto` and the range ops. Deviation: `autoThin(pts,
   eps, cap)` — past a work budget of 32 n a split whose worst point lies outside its segment's middle half goes to the middle (still within
   eps; a hostile 79 000-point zigzag normalises in ≈ 60 ms, plain RDP would be quadratic); past 4 × AUTO_MAX (a hand-made file) every k-th
   point first. P0M's cap test moved to the rule (the ends kept, every point within the thinning).
6. (R1 P2-3) the bake samples moving segments on a 512-frame grid (`autoTicks(…, f)`); §7.1 / §12 corrected. R1's g4-live-bounce at 120
   BPM: 251 live posts (16 ms) vs 376 suspends (10.7 ms, largest step 0.060 of the range; was 64, 61 ms, 0.287).
7. (R1 P2-4) the loop off, a latch closes at the song's end + 1 bar taken at the release (`sp.end`); `project.bars` grows from a gesture's
   writes only.
8. (R1 P2-5) `autoWrite`'s jump pair at t1 is skipped only for an empty old curve (§2.3 updated; P0M's property test and its example moved
   to the rule): a latch over a flat / short curve gives it back from the close.
9. (lane G 1 + 2, R1 P3) `autoApply(t, key, v, q = true)`: the tick, the stopped rest and an edit send their own patch (no rAF armed for
   nothing: 0 requests from inside autoTick, the clients audit green); the tick is a 60 Hz deadline (`AUTO_P` 16.67 ms, a frame up to 2 ms
   early ticks, a late one keeps the grid — catch-up capped at one period —, an early one restarts it): Chrome caps 60 / 120 / 240 and the
   240 Hz cross cells all post 209.8–210.6 patches a second (was 280 at cap 240); `deleteTrack` drops the track's AO / AW / spans / grabs
   (`autoGone`); `autoPost` builds without the track's `seedPend` (R1's s4: 0 suspend patches re-seed, the unpowered bounce = the powered one).
10. (lane G 3) the tick's own `sendPatch` sets `autoMoved`: `buildPatch` → `patchFor` → `compileSerum` ctx `nokey` (the CP's `cpKey` '' —
    no host reads a live rig patch's cpKey) and `postPatch` skips `sameVal`. G's `auto faces 60` d, the rig shown: 2.09 / 2.32 → 1.825 /
    2.015 and 1.855 / 2.085 ms (med ≤ 2: green, a thin margin); the classic faces 1.24 → 0.95.
11. (R2 P2-1) the override dot is a hollow ring (transparent, an inset 1.5 px ring in the tint) — §6.2 / §4.3.
12. (R2 P2-2 + P3) `track.auto[key] = { pts, n, r }`: the last-known long label (≤ 64 chars) and range, kept by `normAuto` / the range ops
    (a clip carries them), written by the host on a take / an edit (`autoRec`); an inert key's lane shows `n` (short = after the last
    " · ") and maps by `r` (`autoRangeOr`). Tracks without curves serialise as before (G8).
13. (R2 P2-3) on touch AUTO and ↺ hit 44.5 × 44.5 (reviewer 2's hitarea scan at l / p; ● 35.5 × 39.5 as before): the coarse `::after` 7.5
    px over the 30 px padding box and across the 4 px gaps; ↺ is 40 wide on touch (as AUTO) — the one layout change (the row 6 px wider).
14. (R2 P3) the rig labels drop the module's name ("Filter 1 · Level", never "· 1 Level"); the empty-lane hint in MUTE (≥ 4.5 : 1); the
    readout pill moves to the lane's right while the playhead is under it; index.html's roll help names the chooser; `toV1` names each
    track's curves in its lost list ("“Bass”: 2 automation curves").
15. (H1 deviation 5) AW survives ▶: the stopped rest and a stopped lane edit write it, a stopped release keeps it — a knob turned while
    stopped (a write, a grab) is an override at ▶; an untouched one follows its curve.
**Fix round, left** (recorded, not fixed): a touch tap within 14 px of the line adds nothing (a dead tap, contract-consistent); the amber
"on" / ivory contrast (the ring and its dark edge keep it visible); lane G 4 (the kit's +0.025 ms, noise); lane G 5 (the roll is not
re-rendered during playback: the heard dot rides the playhead); `save()` writing automated positions into the per-model memory
(inherent); the bounce's needs are built once at its start; resample / render-last bake nothing; WebKit untested (the iPad pass).

## 14. Skeptic (2026-11-03, read-only at 712f6d7; the lead folded every item into the body above)
The full note: the lead's scratchpad `auto/SKEPTIC.md`. In short — 14.1: every §0 pin re-checked; wrong in the first draft: the dev
rule (`data-cv-mod`), `curTick` = heard not render, `mix:vol` 0…1.25, the fake OfflineAudioContext's place and abilities, line drifts.
14.2 (24 items): the four UI writers cannot do playback (unmounted panels; sx-host's own undo per call; `fxPrune`; kit throttle) →
pure `autoApply`; the hooks cannot name the key → polling `autoGet`; override on any base change; `devAt`; release at `window`;
two-finger drop; a gesture only from the first change; the latch written progressively and closed with a jump pair; the wrap as
`recAdv`; undo ends gestures, tracks by id; never swept; the mixer's range / `mixOne` / `input.value`; rig enum / int laws excluded;
the range ops per op (paste was a merge); thinning + the cap (a 3-minute take ≈ 43 k points a key); the bounce: fake at
main-sim.mjs:303, message ordering across a suspend unknown → probe, synchronous write / build / restore, per-item caches, G4 ≤ 2 bars;
`follow` at the read point and drags from it, the dot as `::after`; the corner chip + host menu, selections exclusive; schema pinned
in 10 files; stop writes at the start; `project.bars` bumped; a hidden page; `mfx:` rejected. 14.3: `sendPatch` classic 0.04–0.1 ms,
rig 0.51 ms / 34 KB; play8 med 0.18 ms; 8 classics ≈ +0.6 ms, 2 rigs + 6 classics ≈ +1.4 ms on the Mac (the iPad 3–4× — an
assumption): hence the 60 Hz staggered tick and two rigs in `auto8`. 14.4: lane H split into H1 / H2 (the probe first); W gains
cv-panel.js; L's box selection to cut 2. 14.5: four questions for the lead — all decided (§11).
