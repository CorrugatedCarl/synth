# Stage R: recording overwrites, one undo step per loop pass, the piano roll's lights (IMPL-R) — notes

**The user's words (2026-10-25)**: "when recording notes onto the piano roll they should delete the notes they overwrite. and control z
should undo overwritten notes up to the last loop (just like in ableton)" and "when playing notes on the keyboard or otherwise they
should light up in the piano roll". **Their answers**: overwrite = **same pitch only** (as Ableton); lights = **keys + playing notes**.

Built on `canvas` at 919d44a. Files: `main.js` (recording, transport, the roll's host), `roll.js` (the lights), `song.js` (one
`History.record` option). No engine / DSP change: the posted message stream is the same (the anchor's pass number lives beside it in a
WeakMap, never in the `{t: 'transport'}` message); goldens untouched by construction. Tests: `tests/canvas-R-sim.test.mjs` (the page
simulation, real engine) and the "R lights" tests in `tests/roll.test.mjs`. The review's fixes add one engine change (R-15, below): a
song update while playing ends the song's sounding notes it no longer has, and the ones it still has at their new end — the goldens
never swap a song mid-play and stay bit-identical.

## 1. Overwrite (Overdub and Replace)

When a recorded note is committed on a track (`commitNote` → `overwrite`), the track's notes **of the same pitch** that overlap its
final span — after input quantize — are overwritten:
- one **starting inside** `[t, t + d)` (its start included) is deleted;
- one that **started earlier and runs into it** ends where the new one starts (a longer one loses its tail too); below 1 tick it is
  deleted;
- a note ending exactly at the new start, every other pitch, and anything outside the span are untouched.

It applies to every note on the track — other takes and the take's own earlier loop passes (Replace mode's sweep keeps the take's
notes; the overwrite still replaces them pitch by pitch). A note held across the loop wrap keeps the existing **wrap cut** (it ends at
the loop end) and overwrites up to there. Pads (`o.rec 'target'`) and the arm-off commit go through the same path. (Review:) a
removal gives the track a new notes array (as the Replace sweep), so the caches keyed on the array and its length — the pads that
follow the track — see a delete-one-push-one (R-9). While the take loops, a note played inside the loop stays inside it: input
quantize snapping its start to the loop end wraps it to the loop start (Ableton: the downbeat it was aimed at), one snapped before an
off-grid loop start is clamped to it; a lead-in before the loop keeps its place (R-3). A key pressed in the render lead after a seek
in a looping song starts at the seek's tick, never before it (R-7: ⏮ to the loop start never records before the loop).

## 2. One undo step per loop pass (Ableton)

- **Lazy steps.** A take no longer records a History step at ● (toggleRec). Each loop pass records one before its **first change** —
  a note, an overwrite, a CC, a Replace-sweep removal (`recStep`): a pass that changes nothing has no step. Labels: "Record pass N"
  while the take loops (N from the take's first pass), "Record" for a take without a loop (one pass: one step, as before).
- **Which pass.** The heard one, with the event's precision: each anchor carries the pass it was made in (`passOf`, a WeakMap: a
  re-anchor keeps the pass at its frame; `play()` 0) and `passAt(F, a)` adds the wraps on its line (audioclock `tickAt`'s). `recTick`
  sets `recP` beside the tick (the seek line's own pass while it is extrapolated back); the frame loop reads `heardPass` of the
  playhead's frame. A seek while the song loops starts a new pass (its own step); without a loop it does not.
- **Held across a boundary.** When the heard pass moves on (`recAdv`: a key event, CC, the frame loop, stop / ● off), every note still
  held from an earlier pass is committed at once, cut at the loop end — the result the wrap cut gave at its release — into **its own
  pass's** step. (A note held for more than a whole pass used to end where its release fell in the later pass; it now ends at the
  loop end too.) While its key stays down the note is in the project but **not in the engine's song** (`recCut`, review R-1): the
  song's copy would take the held voice over in the next pass and end it at the loop end; the key's release sends it (so do ■ and a
  track delete). An undo / redo meanwhile (recording or not) keeps it out: the restore's copy of the note is found again by its id
  (`recCutMark`, before the restore sends the songs); one the restore takes away waits for its key (a redo may bring it back). The
  same for a commit at a seek or at ● / arm off while playing.
- **Ctrl+Z while recording.** Undo takes the pass in progress back to its loop boundary (the state before its first change) and
  recording carries on; on an empty pass in progress it undoes the pass before, and so on. The notes held at that moment belong to the
  undone pass: they are dropped (never committed — the restore's own releases included); keys pressed after it record as usual, as a
  new step of the pass. Nothing records a step during the restore (`recIdle`). Redo while recording behaves the same way. (Review:)
  a pass in progress whose only content is notes still held (no step yet) is taken back by dropping them alone — the pass before
  stays (R-2; a "tap to undo" notice undoes its own step instead). Undo follows what happened: only the keys that went down after
  the step undo would take back count (a step that changed nothing — the roll's Q with nothing to move — is skipped by undo, so
  here) — a step recorded since (a roll edit, a tempo change) is undone first, its restore dropping the held notes as above; an undo / redo that finds nothing changes nothing (R-5); arming is not undoable — a restore while recording keeps the
  tracks' arm (R-10).
- **An edit in the middle of a pass** (the roll, the arrangement…) gets its own step as usual; the pass's later changes then record a
  new "Record pass N" step on top (`T.stepE`: the pass's step must still be the newest), so undo follows what happened. Undoing that
  edit makes the pass's step the newest again: the pass carries on in it, and its next change drops the undone edit from redo (R-8,
  `History.dropRedo`) — whatever undo / redo came between (an undo, a redo and an undo of the edit; two edits both undone; the
  pass's later step and the edit under it undone back to its first step: `passStep` tags every pass step's History entry with its
  take and pass — whichever of the take's steps is the newest again, its pass carries on in it). A roll gesture (beginEdit … endEdit) never has a pass step taken inside it: what is recorded meanwhile joins
  the gesture's step, and the pass's next change after it records its step again (R-6).
- **Replace's sweep** of a pass's last frame slice (the old notes between the last frame and the loop end) is that pass's: on a wrap
  `recAdv` sweeps `[lastClr, le)` into the old pass's step before the pass moves on, the frame then sweeps `[ls, t]` in the new one
  (R-4). A seek is never such a wrap: a pass reached on a seek's anchor before it wraps (`seekAs`, the anchors carrying a jump) has no
  tail sweep. A re-anchor made just before the loop end (a tempo change, an undo's restore — its anchor already in the next pass while
  the old line is still heard) is no seek: the heard wrap sweeps.
- `History.record(project, label, force)`: a pass's step is pushed even when the top holds the same state (the top is another action's;
  undo skips it as a no-op once the pass is undone) — so a pass always has its own named step.

## 3. The piano roll's lights

- **Key strip.** The notes the track plays from its keys and its song light their keys, once a frame (a row stamp): the held notes
  that reached the track (`heldOn(id)`: the keyboard, the on-screen keys, MIDI, pads, the hardware beds — heldLit's rule, on the track
  exactly: a MIDI channel's note routed only to another track stays dark), the song's notes the engine plays (below), and the roll's
  own audition keys. main.js passes the held set (`roll.setHeld`) on every note-on / -off and the roll pulls it on a track switch
  (`host.heldNotes`); the roll asks for a frame only when the set changes.
- **Playing notes.** While the song plays and the track is heard (not muted / soloed out), the notes under the **heard** playhead
  (main's `curTick`, latency-compensated — `setPlayhead(t, true, audible, floor)`) brighten their blocks (a white wash inside the
  note's rect, the note's name drawn again over it — review R-13). Their keys follow **the engine's rule** (review R-11 / R-12): the
  engine starts a song note only at its start — never one begun before a start's or seek's tick, before the loop start after a wrap,
  or before a panic (main's **chase floor**, `setPlayhead`'s 4th argument; a tempo / loop change releases nothing and keeps it) —,
  and a later note of a sounding pitch takes the pitch over (its end the pitch's). So a block under the playhead may stay dark on the
  key strip: the song does not sound it. None before tick 0 (a count-in from a later bar lights the pre-roll bar's notes, which the
  engine plays), none once stopped (`setPlayhead(t, false, false)`).
- **Drum rows.** With the compact drum rows a lit row's plate lights and its name and note number are drawn again over it ("Other"
  for an unnamed note); "Drum rows" off lights the piano keys — a named row's white key left of its name plate, so the name stays
  readable (review R-14).
- **Cost.** Nothing is redrawn for the lights: the scene (the back canvas) is untouched; the overlay that is composited every playing
  frame anyway draws them. The sounding notes are found without scanning the clip (`_sound`): the notes are sorted by start; a frame
  moving forward walks a cursor over the starts it passed and drops the ended; a jump (a loop pass, a seek) re-finds them with a binary
  search over the starts, back by the longest short note, plus a short list of the long ones (> 2 bars); an edit (`render`) re-reads
  lengths, order and where each note's pitch is next struck once — a note dragged out of order makes it scan until the edit ends. A
  redraw for the view alone (a scroll, a zoom, a tool: `_view`) re-reads nothing (review R-16). Fixed lists and counts: no
  allocation per frame (whole-pixel wash coordinates: V8 boxes no number at the canvas calls).

**Measured** (a 5 000-note clip over 64 bars, ≈ 8 notes sounding, the roll 1366 × 520 at DPR 2, a 120-BPM playhead round an 8-bar loop;
`setPlayhead(t, true, …)` per frame, base = roll.js at 919d44a):

| per frame | base | lights off | lights on | + 3 held keys |
|---|---|---|---|---|
| Chrome (M4 Max), JS + 2D command recording, median of 8 × 2 000 frames | 2.3 µs | 2.0 µs | 6.2 µs | 7.4 µs |
| Chrome, with a forced raster each frame (a 1-px readback; fresh page per row) | 3 653 µs | 3 705 µs | 3 863 µs | 3 823 µs |
| node (no-op 2D context), 200 000 frames | 0.11 µs, 1 GC | 0.15 µs, 0 GC | 0.82 µs, 0 GC | 0.90 µs, 0 GC |

The lights add ≈ 4–5 µs of JS a frame and, with the raster forced, stay within the run-to-run noise (± 200 µs) of a frame dominated by
the composite and the readback; a full scene redraw (an edit) is ≈ 1.7–3.8 ms for comparison. The node run counts garbage collections
over 200 000 frames: none with the lights (the base overlay's own hover closure was made allocation-free on the way). The read budget
is pinned by `tests/roll.test.mjs` (a forward frame ≤ 12 note reads, a jump ≤ 120, never the clip). Not yet measured on the iPad (JSC
does not box doubles; the next device pass can run the same scenes).

## 4. Limits

- The pass's undo step costs one History snapshot (the whole project serialised) at its first change — at a note's release, once a
  pass. A very large project pays that on the main thread once per pass (as every edit does today).
- Keys held when Ctrl+Z is pressed during a take are not recorded (they belong to the undone pass); press them again.
- A song update while playing finds the sounding song notes by (pitch, start) (R-15): one it no longer has ends at once, one it
  still has ends at its new end (a restored shorter note, a note shortened or lengthened under the playhead; an end moved to one
  already passed counts as gone); a moved note (a new start) is a note gone. A song note on a pitch the player holds live on the
  song's channel is left to the key (an MPE key on another channel has a voice of its own: the song's is released).
- Replace: the sweep follows the heard playhead and the engine renders ahead of it, so an old note the playhead passes is already
  sounding when it is swept — R-15 then ends it: a long old note is heard as a short attack (≈ 0.1 s: the render lead, the 60 ms
  song debounce, the output latency); before R-15 it rang on whole. Ideally it is not heard at all (Ableton) — that needs the old
  notes kept out of the engine ahead of the playhead, a later step.
- A key pressed or released within the few milliseconds before the heard loop end, but delivered after the boundary was handled,
  keeps the existing wrap behaviour (a note cut at the loop end) and may land in the next pass's step.
- The roll lights the song's notes of the shown track only (not ghost notes, not a drum machine's internal pattern, a TB-303's or a
  classic panel's step pattern, or a Serum clip / arp); a muted track's notes stay dark while its held keys still light.
- Lights follow the keys and the note blocks, not the sustain pedal: a key released under Hold or a CC64 pedal goes dark while its
  note rings on, and a song note held by the song's sustain goes dark at its block's end (as the keyboard tray and Ableton's key strip).
- The chase floor is the song's, for every track at once: a track whose engine node is made mid-song (an instrument change while
  playing) starts from that moment, and its notes begun before stay lit though silent until they end. Likewise a note drawn or moved
  under the playhead while the song plays sounds from its next pass, lit at once (the engine does not chase a song update).
- Review R-15 (an engine change, not lane B's): until it lands, a note deleted or undone under the playhead rings to its old end
  while its block and key are dark.
- The step labels are kept for a future undo menu: the main toolbar shows none today.

## Review fixes (lane B): the roll's lights

Built on 3c9e725 (the review's R-11 … R-14, R-16 and the lights half of R-17). Failing tests first (48169b6), all in
`tests/roll.test.mjs`; main.js's recording / undo code untouched (lane A's).

- **R-11, the chase floor** (main.js, beside `passOf`): `chase` (a WeakMap: anchor → [pass, floor], never posted) — `play()` the
  anchor's own tick (a count-in's pre-roll bar included), a seek its tick, a tempo / loop re-anchor the floor its frame inherits
  (`floorAt`: a later pass on an anchor's line → its `ls`), a panic the tick each anchor rendered then has reached (one not rendered
  yet: a seek from its own tick). `frame()` passes `heardFloor(F)` as the roll's `setPlayhead` 4th argument — the roll host's existing
  call, one argument more. roll.js: a sounding note lights its key only from the floor on (`_keyOn`); its block keeps "under the
  playhead".
- **R-12, a pitch taken over**: the edit's index pass (`_sIndex`) also notes where each note's pitch is next struck in the song's
  order (`sNx`, a typed array: by start, then pitch, stable — main's `songData`), and the sounding notes keep their clip index
  (`sAI`): a note lights its key while that next start is ahead of the playhead. No read of the clip per frame; mid-drag (unsorted)
  the frame's scan finds each pitch's last started note (`sOwn`). The 5 000-note brute force now checks the keys too, by the
  engine's rule with a floor (more exact, not looser).
- **R-13, lit names**: after the wash, each lit block's name is drawn again where, as and when the scene draws it (its font and
  width kept from the scene, `nfont` / `ncw`; 128 cached names, no string per frame), in the ink the scene's rule gives the washed
  colour (`pal.lit`, always the dark ink): every track colour × velocity × selection reads at 3.92:1 or better (was 1.71). The
  lights' text sits on whole pixels (`y + (h >> 1) + 1`; V8 boxes a fractional double at each canvas call, and the 12 / 18 px
  default rows made `y + h / 2 + 0.5` one), and the scene's in-block and compact drum names moved with it (½ px lower on even
  rows), so the redraw lies exactly on them.
- **R-14, "Drum rows" off**: a named drum row's white key lights left of its name plate (0…BW, as a black key), the plate and name
  untouched; the compact rows draw the note number again too (cached strings, a dimmer dark ink).
- **R-16, view-only redraws**: `_view()` (dirty, a frame — no `nv`) for fonts, resize, tool, zoom, rows, Fit, ghosts, reveal, the
  pointer type switch, the wheel, a one-finger scroll, a select box, a pinch's end and a gesture's end that changed no note; a call
  that may also apply a note gesture keeps `render()`. `sLong` is filled by index. The read counter in tests/roll.test.mjs now counts
  every index read ('90'…'99', '900'… were skipped): the budgets (a forward frame ≤ 12, a jump ≤ 120) hold.
- **R-17 (the lights half)**: §3 and §4 above.

**Measured** (node, M4 Max, the machine shared with other runs): `R-bench/alloc.mjs` (5 000 notes, 1366 × 520, 200 000 frames, a
no-op 2D context) — lights on 0.94–1.05 µs a frame, + 3 held keys 1.02–1.14 µs, **0 GCs** (base 0.11 µs, lights off 0.15); the
review's roll in the same session 1.07 / 1.13 µs (the names and the key rule cost no measurable time: the wash alone 0.33–0.36 µs,
as before). The edit-time index pass
(`_sIndex`, base vs now, interleaved): 5 000 notes 7–8 → 9–18 µs, 50 000 notes 76–144 → 155–248 µs (once per edit; a drag while
playing pays it each moved frame, beside a scene redraw of milliseconds). A per-pitch list of the notes cost 3–4× the base and was
dropped for the typed next-start table.

## Review fixes (lane A)

The review (17 items) split in two lanes; lane A took recording and undo in `main.js`, the engine's R-15 and this half of R-17's
notes (lane B: the roll's lights, `roll.js`). Each item's repro was ported into `tests/canvas-R-sim.test.mjs` first (failing, its own
commit), then fixed. One test each, named after the item:

- **R-1** (P2, regression) — a key held past a loop pass went silent at the next pass's loop end (the boundary commit reached the
  engine; the song's copy took the held voice over and its note-off released it). `recCut` / `recCutN` (a Map by recLive key, a
  WeakSet of the note objects): every commit while the key is down — `recAdv` at a boundary, `finishRec` at a seek or ● off, the
  arm-off commit — is marked; `songData` (the live sends, not a bounce's range) skips it; `recEnd` (every note-off, recording or not)
  sends the track once its key is up; ■ sends the rest, a track delete drops them, a restore finds them again (follow-up below). Test: the debounce
  allowed to fire (120 ms of real time), pass 3 sounds as the play-only control, the engine's song holds the note only after the
  release, the recorded note unchanged.
- **R-2** (P2) — Ctrl+Z in a stepless pass holding only notes still down undid the pass before. `undo()`: while recording, a pass
  in progress without its step (`T.step !== T.pass`) whose held notes are its content (`recDropPass`) drops them alone — no History
  pop, no restore. An empty pass with nothing held still undoes the pass before. The "tap to undo" notices (`undo(true)`: cvDeleteSel,
  cvUndoNotice, the Pads and 900 Series hosts) undo their own newest step as before — a follow-up found while fixing, pinned in R-2's
  test (its own failing commit).
- **R-3** (P2) — `commitNote`: a note played inside the loop (`r.t0` in `[ls, le)`) whose quantized start is `≥ le` wraps to
  `ls + (t − le)`, one `< ls` clamps to `ls` (length kept); lead-ins keep today's placement. The overwrite then replaces the downbeat
  it was aimed at; nothing outside the loop is touched.
- **R-4** (P3, regression) — `recAdv` sweeps the old pass's tail `[lastClr, le)` into its own step before the pass advances, only
  for a wrap on the anchor's own line (`passOf(T.a) ≤ T.pass`; a seek's anchor is the next pass's) — `replaceSweep`'s loop is
  `sweep(ranges)`. A forward seek sweeps nothing ahead of the playhead (tested).
- **R-5** (P3, regression) — `undo()` / `redo()` restore first; `recHold` only when something is restored.
- **R-6** (P3, regression) — `recStep` first: `if (gesture) { T.step = -1; return; }` — a note recorded mid-drag joins the drag's
  step (as before R), the pass's next change records its step again.
- **R-7** (P3) — `recTick`: a seek line that loops is never extrapolated back past its own tick (`max(s.tick, t)`).
- **R-8** (P3) — `recResume` (the undo / redo `finally`): `T.step = −1` only when the pass's step is not the newest
  (`hist.u` top `!== T.stepE`); `recStep`'s join path drops the redo stack (`History.dropRedo`, shared with `record`). Case (a) (a
  redo of the pass, then more notes: a second step) left as §2 says.
- **R-9** (P3) — `overwrite()` builds a new array when it removes something (as the Replace sweep); the old one is not touched.
- **R-10** (P3, pre-existing) — `keepArm(p)`: a restore while recording copies the live tracks' `arm` onto the snapshot by id (one
  project; tracks missing from it ignored).
- **R-15** (P3, engine) — `songMsg` while playing calls `songGone()`: each `seqOn` entry (now `[pitch, end, start]`) whose
  `(pitch, start)` the new song lacks (binary search over the sorted starts) is removed and released — unless the player holds that
  pitch live (`liveK`, a per-pitch count of the `{t: 'on'}` / `'off'` messages, previews excluded; cleared by panic and the warm-up's
  restore): the voice is the key's. No allocation beyond the splice the note-offs already used. The goldens never send a song while
  playing: bit-identical (below).
- **R-17** (docs, this half) — the header, §1, §2 and §4 above describe the recording / undo changes and R-15; the lights wording
  (§3: sustain, step sequencers, count-in; R-11 / R-12 status) is lane B's.

Follow-ups (the fix check's two skeptics per item; each case a failing test first, "… (follow-up)" in canvas-R-sim):

- **R-1** — an undo / redo while a key held across the wrap is still down brought the note back into the engine (the restore's notes
  are new objects; `recHold` dropped `recCut`): the held key went silent at the next loop end. `recCut` keeps the note's id;
  `recCutMark(p)` in `applyRestore` (recording or not, one project) finds each again before the songs are sent; one the restore
  took away stays unmarked until its key is up. Cases: an undo of a later pass, an undo of the note's own pass and its redo, an
  undone roll edit.
- **R-2** — R-2's branch ignored order: a key held in a stepless pass, then a roll edit — Ctrl+Z / the toolbar dropped the held
  note and left the edit (two presses). Each `recLive` entry keeps the newest step at its key-down (`u`); the branch drops only the
  entries whose `u` is still the newest step, else `hist.undo` (the restore drops the held notes, IMPL-R §2). The reverse order (the
  edit first, then the key) keeps the held note first, the edit next (pinned).
- **R-4** — the gate read the newest anchor's pass: a re-anchor in the last ≈ 50 ms + output latency of a pass (a tempo set, an
  undo's restore) is made in the next pass, so the heard wrap skipped the tail sweep. Now `seekPass(p)`: only a pass reached on a
  seek's anchor (`seekAs`, every anchor that carries a jump) skips it. Cases: a tempo set and an undo of a mid-pass edit at heard
  tick 1800 of a 1920 loop at 240 BPM, and the early control.
- **R-8** — `recResume` never put `T.step` back once something had cleared it: an undo, a redo and an undo of the edit, two edits
  both undone, or a roll drag (a note recorded during it, R-6) undone, still split the pass. `T.step = top === T.stepE ? T.stepP : −1` (`stepP`: the pass the step was recorded
  for, so an edit at the start of the next pass undone never joins the pass before); `T.stepE` cleared at a new take.
- **R-15** — MPE: `liveK` counted keys per pitch on any channel, so a song note deleted under a live key on channel 2 lost its
  note-off and its channel-0 voice stayed gated past Stop. `liveK` is now per key `ch × 128 + pitch` (Track.noteOn's), and the prune
  spares only `liveK[pitch]` (channel 0). Replace's short attack of a swept old note is named in §4 (the rule kept: a removed note
  stops).

Residuals (the fix check's round 3: each variant a failing test first, "… (residual)" in canvas-R-sim):

- **R-2** — `recDropPass` compared the held keys' step with the raw top of `hist.u`, but `History.undo` skips a no-op step (its
  snapshot the current state, no meta): a step that changed nothing recorded after the key went down (an edit with no change, the
  roll's Q on notes already on the grid) made Ctrl+Z skip it and undo the pass before, dropping the held note — the next note then
  cleared redo and the pass was lost. Every History entry now carries `seq` (its order of creation, `History.seq` the newest);
  `recLive`'s `u` is `History.seq` at the key-down; a held key counts unless the step `History.undoStep(project)` names — the one
  `undo` would take back, its no-op steps skipped (serialised only when a step is newer than the key) — is newer than it. Cases:
  `host.edit` with no change by Ctrl+Z and the toolbar, the roll's Q with input quantize while a MIDI key (channel 1) is held; the
  next notes are pass 2's own step and the undo after skips the no-op step.
- **R-8** — `T.stepE` remembered only the pass's newest step: a pass with a second "Record pass N" (an edit, or a drag that took a
  note, between its notes) undone back to its first step split the pass. `passStep` (a WeakMap: History entry → `{ take, pass }`,
  set by `recStep`) replaces `T.stepP`: `recResume` resumes whenever the newest step is one of the take's (`T.stepE` = it, `T.step`
  = its pass). Cases: an edit and a roll drag (a note recorded during it) between the pass's notes, Ctrl+Z ×2, then a note — one
  step, redo empty, one undo takes the pass back. A redone step is a new History entry (untagged): a redo of a pass, then more
  notes, still gives a second step (case (a), as before).
- **R-15** — `songGone` kept a sounding entry the new song still had by (pitch, start) with its old end: with input quantize the
  same note re-played each pass (pass 1 C4 `[0, 573)`, pass 2 C4 `[0, 1608)` overwriting it), Ctrl+Z of pass 2 restored `[0, 573)`
  but the engine played on to 1608 (rms 0.10 – 0.14) while the roll showed it dark. A found entry now takes the new song's end
  (the note-on's rule: the wrap's cut; the last note of that pitch at that start); an end moved to one already passed (the tick at
  the message, `tickAt(nowF())`) is a note gone — R-15's rule: released, or left to a live key on the song's channel. Cases: the
  undo at tick 1000 (the end passed: silent at once) and at 300 (sounds on to 573, silent after), the control without input
  quantize; playing only, a song note shortened to an end still ahead (ends there), and to one already passed while its key is
  held live (the key's voice carries on — a plain end update releases it: pinned). Goldens bit-identical (below).

Residual gates, one file at a time: canvas-R-sim 28 / 28 (+ 3 residual tests, each variant failing on the previous head; the
live-key shortening case fails with a plain end update), roll 55, main 47, canvas-sim 24, every canvas-*-sim on main-sim (1e 24,
1i 20, 2a 26, 2b 23, 3 27, 7a 23, 7b 15, 7c 13, 8 17, 9 22, 9b 14, 9c 3, M 20, P 8, SC 15, del 11, tab 8), cv-fixes-sim 5,
cv-shell-sim 17, app-midi-sim 7, lint 165, pwa 25 (after `precache --write`); `History` (song.js: `seq`, `undoStep`) — appstore 25,
cv-module 67, cv-model 14, cv-mods-ui 12, cv-patch 31, patch-core 52, m3-fixture 13, cv-migrate 69, cv-pads 31, cv-panel 111,
cv-drum 66; the goldens bit-identical with the engine change — golden-classic 8, -fx 3, -presets 8, -random 1, -graph 6, -606 11,
-909 9, -drums 5, -moog 6, -moog-b 6, -moog-c 4, -sdsv 5, canonical-stream 1, engine-track 107, canvas-M-bounce 1, canvas-SC-live 1.

Follow-up gates, one file at a time: canvas-R-sim 25 / 25 (+ 5 follow-ups, each failing on the previous head: R-1 undo / redo / edit,
R-2 key / toolbar, R-4 tempo / undo, R-8 urU / two / drag, R-15 MPE), every file of the list below green with the same counts —
engine-track 107 (its System IIIc warm-up timing gate missed once at load average ≈ 21 with other work on the machine, green alone
and on the re-run); the goldens bit-identical.

Gates, one file at a time: canvas-R-sim 20 / 20 (9 + 11 new), roll 55, main 47, canvas-sim 24, every canvas-*-sim on main-sim
(1e 24, 1i 20, 2a 26, 2b 23, 3 27, 7a 23, 7b 15, 7c 13, 8 17, 9 22, 9b 14, 9c 3, M 20, P 8, SC 15, del 11, tab 8), lint 165,
pwa 25 (after `precache --write`), app-midi-sim 7, appstore 25, cv-module 67; the goldens bit-identical with the engine change —
golden-classic 8, -fx 3, -presets 8, -random 1, -graph 6, -606 11, -909 9, -drums 5, -moog 6, -moog-b 6, -moog-c 4, -sdsv 5,
canonical-stream 1, engine-track 107, canvas-M-bounce 1, canvas-SC-live 1.
