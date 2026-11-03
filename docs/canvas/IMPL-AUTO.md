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
the old curve's value from `t1` on (`[t1 − 1, last new value]`, `[t1, autoAt(old, t1)]`; skipped when they are equal or `t1` is past the
last old point). `S.autoThin(pts, eps)`: Ramer–Douglas–Peucker at `eps` = 1e-3 of the range (§3.2).
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
saved); playback skips it; the face's dot turns **amber**; the transport's ↺ lights ("Re-enable automation · 3 controls"). A tap on ↺
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
(amber); none: no attribute. The host sets it on every automation change (record, edit, load, Replace, re-enable).
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
union of the keys' breakpoints plus the moving segments sampled every `PPQ / 8` ticks **only where the value moves ≥ 1/512 of the
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
  is quantum-granular (≤ 2.7 ms at 48 kHz) unless §7.0's fallback lands; the mixer sample-accurate. Fast stepped moves are not
  reproducible; LFO-style motion belongs to the modulators.
- A hidden page (a background tab; the iPad app in the background with audio on) has no frames: automation freezes while the audio
  plays and chases on return.
- A wheel / typed / MIDI CC change during a take overrides the key instead of writing (only a held knob writes).
- A removed kit voice's curve drives the next voice added in that slot; a cross-track paste leaves foreign keys inert.
- Curves are not exported to MIDI; imported CCs make no curves. The arrangement view shows no curves (bars still copy with them).

## 13. Notes (the builders fill in)

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
