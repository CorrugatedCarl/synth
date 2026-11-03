# Stage DM: our own drum machine (IMPL-DM) — contract

ROADMAP row 19 ([ROADMAP.md](ROADMAP.md):40 [R]) and its two consumers: row 20, the guided first beat ("needs row 19", :41 [R]), and
row 26, the LFO combiner ("the kick / track hits marked on the grid as a reference", :47 [R]; shipped as LC 480bb3f). **Code
references are to `canvas` at ⟨B⟩ = 615713d** (written against c515abf; the skeptic re-pinned every [R] on 615713d, 2026-11-03; the
builders reset to phase 0's commit on ⟨B⟩). Tags as IMPL-WC: **[R]** a fact (file:line), **[R?]** unconfirmed (the lane pins it),
**[C]** a choice made here (a builder may refine a [C] with a reason in §13, never an [R]); **(skeptic)** marks a sentence the skeptic
changed (§14 says why). House format: IMPL-SC / IMPL-WC.

**Status**: skeptic-checked 2026-11-03 on canvas 615713d (§14: 7 P1 folded into the body, P2 for the briefs, the final lane plan);
the user's answers (the last section) folded into the body. No code yet.

**The user's words** (2026-10-26): "we will have to make our own drum machine first" — in the row: a drum machine of our own design
(not a recreation like the 808 / 606 / 909), **in the Wavecraft family's look and grid**, the prerequisite of the first-beat tutorial,
its design questions (sounds — synthesis or samples —, the pattern sequencer, how it patches with Wavecraft) asked when it starts → §11.

**What we know about the user** (the brief, HANDOVER §2, the memory) and what each forces:
1. No hands-on reference for vintage drum machines → every voice is built to **measured laws** that a test checks (§2), never to
   "sounds like". No listening gate blocks a cut; the user's ear decides later and a retune re-freezes the refs (§12).
2. Judges by feel → a **playable first cut** shipped early; every guess a constant or a table (the list below).
3. Dislikes crowded panels and wasted space → **every face on the RIG grid** (rig-grid.js) with IMPL-WC §3.8's margin / fill gates.
4. The iPad Pro is the ceiling → §7's costs are budgets, measured on the Mac with the iPad's known factor.
5. (skeptic) Serum complete and the parts machinery left canvas (SX0, ROADMAP :49 [R]; serum-ui.js deleted) → **nothing here imports a
   Serum panel, part or donor** (D6); the faces are MOD1's plain faces (decision c).
6. Original content only → our own voice designs, numbers and kits; no sample and no beat ships (the user: an empty grid); no other
   machine's name on it.

**In short.** A new instrument in the Drums view: a **Sequencer** module (a big step grid, one row per drum) and **one small module
per drum** (Kick, Snare, Hi-hat, Clap, Tom, Perc), in the Wavecraft look. Our own synthesized sounds — no recordings. A new machine
opens with its eight starter drums and an empty grid (your answer). Tap steps, press ▶: it plays with the song. Each step has its own
loudness. Eight patterns, swing, mute / solo, choke groups (a closed hat cuts the
open one). The piano roll, MIDI, the keyboard and a Pads module play it too; a Ducker can follow its kick. Cut 1 is that playable core;
your own samples, step chance / repeats / nudge, longer patterns, stereo pan and (if wanted) patch cords come in cut 2.

**The lead's decisions (2026-11-01)** — each argued against what exists (§0):
- **(a) A fifth machine of the drum family.** Model `kit`, `family: 'drums'`, Inst kind `'drums'`, machine `'kit'`; its voices in a
  **new DSP script `kit-dsp.js`** (→ `globalThis.DrKit`, the Dr808 machine interface); its clock is **DrSeq** with two additive plan
  fields (§3.6); its main-side personality in a **new leaf `kit-core.js`** that drum-core dispatches to (the 7b / 7c / 8 pattern:
  the four older machines byte-identical). This reuses, unchanged: the engine's drum lifecycle (engine.js:2382–2581 [R]: build, keep
  per id, tails across machine switches, decimators, idle skip, panic, OS changes), DrSeq's song sync, swing and heard-time posts
  (dr-seq.js [R]), the drum host (cv-drum.js:7–36 [R]: sessions, sends deduped by pk, step / lamp posts at the heard time), the
  bounce (main.js:585, 4569, 5715 [R]), the roll's named rows (roll.js:58 [R]), the Ducker's NOTE menu (main.js:1423 [R]), the Pads
  module's drum targets (pads-core.js:315 [R]), MIDI channel 10 (song.js:872 [R]), the sidechain per lane (engine.js:2484 [R]), and
  (skeptic) the Combiner's marks (main.js:10303–10330 [R]: drum-core's drumRows / rollPlan / toNotes — §6.2).
  Rejected: Wavecraft's Serum engine (a kit is not a Serum state; D6), the 900 Series' patch engine (mono modules, no sequencer, none
  of the family's paths).
- **(b) Synthesized voices of our own** (Q5): six types on generic blocks — a sine with a pitch envelope, filtered noise, a bank of six
  band-limited squares, two-mode resonators, burst envelopes — each a **table of laws** (knob → Hz / s / dB, §2.2). Samples are cut 2's
  seventh type over the family's slots (IMPL-7a §5 [R]).
- **(c) A Sequencer hub + one module per drum** (Q2; the Wavecraft idiom: modules on the canvas, nothing hidden). Faces built by a
  **new `kit-ui.js`** on **rig-grid.js** with wk's primitives (knob / numBox / menu / seg) and rig-ui's markup classes, (skeptic) the
  way MOD1's plain faces and LC's Combiner face are built without a Serum host (cv-mods-ui.js plainFace :176, editor :389, ccBody
  :476, combRecipe :559, combBody :583 [R]) — **not** fx-ui's faces (they lay donor bodies: fx-ui.js:48–49 [R]) nor rig-ui's (the
  Serum panels as donors: rig-ui.js:29–36 [R]). The modules wear the skins through the rig's mark (§4.8), the voices are cv-module
  `'pm'` entries (§0, §4.5).
- **(d) The grid is the main surface.** Tap a cell, press ▶. The machine **always follows the song's ▶ and tempo** (no free-running
  tempo of its own, unlike the vintage machines' SYNC off); roll notes play it too (the family's "both ways", IMPL-7a §4 [R]).
- **(e) No patch cords in cut 1** (Q3): each voice plays its own row and goes to the mix — normalled, so nothing needs a cord; the
  record reserves the row → voice trigger matrix (§5.3) so cords (layering, chokes) are a UI over existing data later.
- **(f) Mono in cut 1**: the voices render into the family's mono OS-rate bus (engine.js:2534–2579 [R]), so every de-click, tail,
  machine-switch and OS path works as for the 808. Per-voice PAN needs a stereo voice bus (engine work) → cut 2. (The 909 shipped mono
  on the user's answer, ROADMAP :92 [R], IMPL-7c :1008.)
- **(g) ↶ undoes grid edits**: the grid is note entry, not a knob tweak — one History step per gesture. The family's rule for the four
  machines (pattern edits never reverted, IMPL-7a §6 [R]; keepDevs main.js:1963 [R]) stays theirs; knob turns keep the app's policy
  (never reverted by ↶) on the kit too. (skeptic) Not a flip in cut 1: the 808's rule on the kit is a lane's work (no grid steps,
  "tap to undo" notices, its own G6 cases), so cut 1 builds this rule only and `KIT.UNDO` is not shipped.
- **(h) Name-neutral**: model id `kit`; files `kit-core.js`, `kit-dsp.js`, `kit-ui.js`; tests `kit-*.test.mjs`; CSS `.kit-*` (kit-ui's
  injected pieces; (skeptic) no `[data-cv-kit]` skin scope, §4.8); the global `DrKit`; lay keys `iN/ka … iN/kp`. The display name is
  **one line in models.js**: `RIG.NAME + ' ' + KIT.WORD` (`KIT.WORD = 'Drums'`) → "Wavecraft Drums" — the user's "RIG.NAME + ' Drums'",
  derived from the one name constant, never a second literal: a Wavecraft rename renames it, and the WC grep test that keeps the
  literal inside rig-core.js stays green (models.js already imports RIG, models.js:15 [R]). A standalone name later = that line.

**Cheap to reverse** (data or a constant): `KIT.STARTER` (the starter voices), `KIT.DEMO` (**`null`**: the user's empty grid; a beat
later = data, and the Sequencer's ⋯ "Demo beat" item shows only while it is non-null), `KIT.KITS` (the four kits), `KIT.VEL` (soft 64 ·
normal 100 · accent 127), `KIT.CHOKE_MS` 3, `KIT.NOTES` (the note per type), `KIT.TYPES` (every law of §2.2), `KIT.TINT` (the six
type colours, §4.8), `KIT.WORD`, the face recipes (`FACE`, data), the grid's row height (`GRID.rows.cell`, rig-grid.js). **Not
cheap**, said plainly: the engine choice (a); folding everything into one module (Q2's other answer) is a face + host change of about
a lane's size, not a flip; stereo (f) is engine work with its own gate; (skeptic) the 808's undo rule on the kit (g).

**Invariants of the stage**
- **D1 Every existing sound bit-identical.** Every frozen golden and ref (§8 G1) exact; ref-7a…7d render their frozen `dr-808.js` /
  `dr-seq.js` / `engine.js` against the current tree, so the engine and DrSeq edits of this stage are proven inert for the four machines.
  (skeptic) Testable as written: golden-drums / -606 / -909 / -sdsv render side A (the frozen three files) against side B (the tree).
- **D2 The four machines' data byte-identical.** drum-core's records, sessions, payloads, plans, pk and notes for tr808 / tr606 /
  tr909 / sdsv (their existing pins); DrumP's shape untouched (JSC tiers on shapes, HANDOVER §5 [R]). (skeptic) The shape had no pin:
  lane V adds one (engine-track: `Object.keys` of a PatchP's `drum` for an 808 patch, frozen at ⟨B⟩).
- **D3 Steps ≡ notes, live ≡ bounce** (the family's D5 / D7): the same hits as steps or as roll notes render the same bytes where
  frames are whole (the same 4-frame point elsewhere); an offline bounce equals the live render.
- **D4 Measured, not by ear.** Every law of §2.2 is a test (§2.3); the frozen refs freeze what passes.
- **D5 Nothing hidden.** Every voice that sounds has a module and a row; mute / solo / choke are printed on the faces; normalled
  connections are the printed default (no invisible routing).
- **D6 No Serum-parts dependency.** `kit-core.js` imports nothing; `kit-dsp.js` reads no other script's global (cut 2: `SxBase`'s
  sample entries, the family's path); `kit-ui.js` imports only `rig-grid.js`, `wk.js` and `kit-core.js`. A grep test (G11).
- **D7 Original content.** Our laws, our hi-hat ratio set (§2.2, tested against every oscillator table in dr-808.js), our kits;
  (skeptic) no beat ships (the tests' fixture groove, §5.7, is ours too); no maker or machine name of another instrument on a kit face,
  tile, notice or about text.
- **D8 The iPad first.** §7's budgets; two fingers always pan / pinch (only the HIT pads are music zones); hits ≥ 44 px at 100 %;
  nothing animates or repaints while stopped.

---------------------------------------------------------------------------------------------------------------------------------

## 0. What exists (facts at ⟨B⟩ = 615713d, re-pinned by the skeptic; "→" what they force)

| piece | where [R] | → DM |
|---|---|---|
| The drum family: models with `family: 'drums'`; `map()` → `{ engine: 'drums', machine, drum: <flat knob positions 0…1, switch indices>, level: 1 }` | models.js:700–865 (808 :708, 606 :747, 909 :783, SDS-V :825) | (skeptic) `kit` appended **last, after the rig** — MODELS **18 → 19** (SX0 removed the bundled model: models.js:891, rig = MODELS[17]); machine `'kit'` |
| Inst kind 'drums': `drOn` builds the machine with `globalThis.Dr808.create(this, id)` and keeps one per id (`dmL`); `drGain` (`Dr808.gain(machine, drum)`); `fadeDrums` renders a 3 ms raised-cosine tail through `dm.render`; `renderDrums`: tails → `dm.render` (mono, OS rate) → decimators → `dm.post` → L / R; the CPU count reads `dm._v`'s `.on` | engine.js:2382–2401, 2411–2416, 2457–2470, 2534–2579 | one factory lookup by id; no new path (decision f); (skeptic) DrKit exposes `_v` (its instances, `.on`) or the count falls back to `live()` = 1 |
| The machine interface: `create / set / setOS / hit / trig / render / post / poll / live / reset / mon / smp / setSalt`, `gain(kind, drum)` | dr-808.js:17–35 (unchanged since c515abf) | DrKit implements it (§9.2) |
| PatchP builds `DrumP`, one fixed-shape class holding every machine's fields | engine.js:1365–1404, 1427 | 'kit' gets its own fixed-shape `KitP`; DrumP untouched (D2) |
| The warm-up's drum rounds (`warmDrums` :3777 — its 808 / 606 rounds, then `warmDrums9` :3850 and `warmDrumsV` :3905, called last at :3839; warmUp calls it at :3758); engine-track pins the machines it built | engine.js:3758, 3777–3957; tests/engine-track.test.mjs:1403, 1678 | a kit round after `warmDrumsV`; both pins gain `,kit` (by design) |
| DrSeq: plans of 12-bit lane masks (bit 0 accent), `LANE_SOUND`, `fire` → `dm.trig(mask[, ac])`, `drStep` (the lowest primary), `drNote` once per sounding lane (the sidechain); `valid(p)` checks every array it reads | dr-seq.js:99–135, 325–345 (unchanged) | additive `vl` (§3.6), inert for every older plan — (skeptic) **`fire` masks `st & 0xFFF` and skips bit 0** (:327, :333): a kit plan (16 lanes, slot 0 = bit 0) needs its own branch before that line, and `valid` checks `vl`'s length |
| drum-core: `PERS` (four personalities), `mach()` (unknown → the 808), dispatch by the record's `m` (`is606 / is909 / isV`), `normDrum / compilePlan / toNotes / payload / initState / press / leds / drumRows / rollPlan / rollOpts / planSess` | drum-core.js:198–231, 265–281, 395–443, 523–745, 789, 1008, 1625–1645 (unchanged) | a five-way dispatch to kit-core for `'kit'`; (skeptic) `toNotes` reads `mask & 0xFFE`, lanes 1–11 (:665–668), so the kit's plan takes its own branch there too (keyed by `plan.vl`, as `plan.mSh` keys the 909's, :655) |
| The record gates: main's `drumOf` re-normalises a record without `keys` (an array) or of another `m`; the drum host's `mem` drops one without `keys` / `ui` / `x`; the SDS-V's record carries `keys: [], ui: {}` to pass both | main.js:219–224; cv-drum.js:262; drum-core.js:2214–2221 | (skeptic) the kit's record carries `keys: []` too (§5.3) — no gate changes |
| `song.isDrum` = a `PERS` key; `normDev` keeps `drum` for drum models | song.js:582, 604 | automatic once `PERS.kit` exists |
| The drum host: sessions, `press(tr, input, ph)`, heard-time step / lamp delivery (one-shot `wk.frame` pump, :255–368; `heard` = the frame's shared heard frame, main.js:2735), the api's `step(fn)` / `lit(fn)` (:431–450), sends deduped by pk; `machOf` four-way (:213), `sessOf` (:268) | cv-drum.js:7–36, 213, 255–368, 431–450; main.js:2729 | reused; `machOf` / `sessOf` / `fresh` learn `'kit'`; (skeptic) the Sequencer's playhead and lamps ride `step` / `lit` (no wk.clock client, §4.2) |
| The 808's extras grid: one canvas + a hit layer (208 cells as DOM ≈ 400 elements), a keyboard cursor, row header tap = mute / long-press = solo; the panel paints ≤ 1 a frame (`dirty` → `wk.frame`) | IMPL-7a §3.6; cv-drum.js:523, 1125 | the Sequencer's grid uses the same technique |
| Roll named rows (`drumRowsOf(dev)` → `drumRows(dev.drum.map, model)`: names by `PERS[model].names`), the Ducker's NOTE menu (`drumRowsOf`), the roll host, Pads' drum targets (`s` must match `/^[a-z]{2}$/`; names `soundName(s, model)` from PERS, order `sidOrder`, colours `colorFor` / an SDS-V `look`), MIDI channel 10 | roll.js:58–61; main.js:1423, 5137; pads-core.js:57, 202–216, 315, 391–400; cv-pads.js:102–130; song.js:872 | (skeptic) names from the record: `drumRows(map, model, D)` and `soundName(s, model, D)` read the kit's `D.ty` / `D.nm` (§5.2); slot codes `ka`…`kp` |
| (skeptic) The Combiner's marks (LC): the Marks menu lists every drum machine's rows (`DC.drumRows(D.map, model)`), the marks expand a synced machine's pattern through `DC.toNotes(DC.rollPlan(D, bpm, sess), { t0, t1, ...DC.rollOpts(D, dev) })` | main.js:10303–10330 | §6.2 is half done: the kit joins by drum-core's dispatch of those three; `cmbMarkList` calls `drumRowsOf(dev)` (the names) |
| The RIG grid: `GRID` (every layout number), `layoutOf(recipe)` (a row's numeric `h` honoured, :52 — LC's list row uses it), the injected CSS | rig-grid.js:17–80 (unchanged) | kit-ui lays every face on it; two additive row numbers (§4.1) |
| (skeptic) MOD1's plain faces: `MOD_FACE` recipes, `plainFace(d, kind, title, pieces)` (section.rig-face, .rig-row / .rig-cell, jacks), `editor(o)` (live / commit), `MOD_CSS` injected once; LC's `combBody` (a head of segs, a numeric-height row, its own clock client) | cv-mods-ui.js:67–176, 389, 476, 549–620, 806–827 | the base of kit-ui's faces (decision c, §4) |
| fx-ui's faces lay donor bodies (mod_<type>'s widgets, kept hidden in the face's park); rig-ui's faces are the Serum panels used as donors | fx-ui.js:48–49, 585; rig-ui.js:29–36 | not used (D6) |
| (skeptic) The skin marks: `rigMark` (`data-cv-rig`: a rig's modules), `fxMark` (`data-cv-fx`), `faceMark` (`data-cv-face=""`: modulators); every skin block of style.css scopes those three (charcoal / ivory / glass, "the same variables in the same order", a cv-tray test); `wkPopSkin` finds them | main.js:8763–8800; style.css:1553–1613, 1676–1760 | the kit's modules take the rig mark (§4.8): no new skin selector, no new token |
| (skeptic) Sub-modules of one instrument: cv-module's `'pm'` entries (the 900 Series: host-sized `fixed`, compact bar, no fold, Tidy by `host.rackLayout`, `costOf`); `'part'` is the rig's (PART_W_DEF, sxViews, sxRemovePart) | cv-module.js:288, 471–480, 1087–1091, 1149, 1171, 1301, 1350; main.js:6905, 7016, 7043, 7220–7223, 7252, 7348, 9776 | the voices are `'pm'` entries; cv-module.js unchanged; main.js's `'pm'` dispatchers branch on `isKitDev` |
| ↶ never reverts knob turns: `keepDevs` keeps `vals` (and a drum machine's `drum`) of a same-model device; canvas steps restore their own fields by meta (`sxBack`, `drBack`, `ptBack`) | main.js:1958–1967, 1979, 2007, 2014 | the kit: `vals` kept, `drum` reverted; structural edits carry `kitBack` (§5.5) |
| The classic modulation class table sweeps every model but `noClassic` (Serum-engine, patch); `destOk` → `classOf` → null → NOMOD | cv-mods.js:105, 157–164, 611, 648–663 | the kit is skipped in cut 1 and refused with its own text (§10) |
| Schema 17 (the MM step); a newer file opens read-only; (SX0) `serumOut` a load pass inside 17; (LC) the combiner took no step | cv-migrate.js:54–59, 129, 200–202; IMPL-LC §2.4 | 18 — (skeptic) kept against LC's choice: a 17 build drops `dev.drum` of a model it does not know (song.js:604) — the whole pattern memory — and autosaves it (§5.6) |
| Bench targets of the family (node): d8p 0.020, d6p 0.025, d9p 0.035, dvp 0.030 (each with x / m / i rows; d8i gated in engine-track) | tests/bench.json:15–19; tests/engine-track.test.mjs:1087; tests/cv-cost.test.mjs:92 | dkp 0.012 (§7.2) |
| Default ⚙ Oversampling 4 | main.js:135 | the voices render at the Inst's OS (decision f) |
| Lay keys `iN` / `iN/<part>` | song.js:551 (`LAY_KEY`) | `iN` = the Sequencer, `iN/ka`…`iN/kp` = the voices |
| The touch "heavy" notice: `SX_HEAVY` 1 866 (a rig in parts) and `PT_HEAVY` 2 048 (a 900 Series); `heavyOf(t)` asks only those two | main.js:8409–8457 (`heavyOf` :8427) | (skeptic) a kit never triggers it today: lane H adds a `'kit'` kind (PT_HEAVY's line and words, §7.3) |
| The patch family's host idiom: `patchHost(deps)` with `edit(t, dev, label, r)` = one History step + a back meta; its knob write `ptKnob` (vals, persist, a throttled patch post, no step) | cv-patch.js:25–42, 140; main.js:9822–9890 | `kitHost(deps)` (§4.6); `kitKnob` = ptKnob's shape |
| (skeptic) The DSP list and its pins: main.js `DSP_FILES` (17 scripts), cv-cost.js's bench worker list, smprender.js, wk.js `DSP_GLOBALS`, tests/golden-harness.mjs, tests/dsp-scope.mjs, **tests/bench.html** (its `<script>` list = dsp-scope's, bench.test.mjs:121); the count pin (18 modules) and modcore's order pin (the script before mod-core.js is dr-seq.js) | main.js:928; cv-cost.js:345; smprender.js:30; wk.js:3530; golden-harness.mjs:29; dsp-scope.mjs:40; tests/bench.html:76–82; tests/app.test.mjs:165; tests/modcore.test.mjs:87; tests/wk.test.mjs:2327; tests/sx-base.test.mjs:428; tests/cv-cost.test.mjs:437 | `kit-dsp.js` **after dr-808.js, before dr-seq.js** (modcore's pin holds); the count 18 → 19; the list pins move |

---------------------------------------------------------------------------------------------------------------------------------

## 1. What the machine is

### 1.1 The modules [C]
```
┌ Sequencer ─────────────────────────────────────────────────────────────────────┐
│ KIT ▾ Starter    PATTERN  A B C D E F G H    LENGTH 16    SWING 50 %    CLEAR  │
│                 1           5           9          13                          │
│ KICK         ▮  ·  ·  ·  ▮  ·  ·  ·  ▮  ·  ·  ·  ▮  ·  ·  ·             ●     │ ──▶ Effects ──▶ OUT
│ CLAP         ·  ·  ·  ·  ▮  ·  ·  ·  ·  ·  ·  ·  ▮  ·  ·  ·             ○     │
│ CLOSED HAT   ▯  ·  ▮  ·  ▯  ·  ▮  ·  ▯  ·  ▮  ·  ▯  ·  ▮  ·             ○     │
│ + ADD DRUM                                                                     │
└────────────────────────────────────────────────────────────────────────────────┘
┌ Kick ───────────────────┐  ┌ Snare ──────────────────┐  ┌ Clap ─────── …   ┌ Closed hat ── …
│ KICK ▾             HIT  │  │ SNARE ▾            HIT  │  │                  │
│ TUNE  DECAY LEVEL CHOKE │  │ TUNE  DECAY LEVEL CHOKE │  │                  │
│ PUNCH SWEEP CLICK DRIVE │  │ TONE  COLOR SNAP  BODY  │  │                  │
└─────────────────────────┘  └─────────────────────────┘
```
- The **Sequencer** is the instrument's own module (key `iN`: the Amplifier's place in a Wavecraft); its OUT is cv-module's right-edge
  line to the track's Effects panel (derived, read-only — every instrument's).
- A **voice module** (key `iN/k<slot>`) is one drum; its row on the grid follows slot order; its bar's stripe is its row's colour.
- **Normalled**: a voice plays its own row and sums into the machine's output; nothing to plug (decision e).

### 1.2 Flows (lane H) [C]
- **The kit tile** (Drums view), tap or drop anywhere on a canvas: replaces the track's instrument (1f's Replace: one step, "Replaced X
  with <NAME> · tap to undo") with the Sequencer + `KIT.STARTER`'s voices and (skeptic, the user's answer) **an empty grid** — every
  pattern empty, pattern A selected. The first view frames the Sequencer at 100 % when its 1248 px fit the canvas width (the iPad's
  1366 px landscape does), else at the fit width.
- **A voice tile** (Kick, Snare, Hi-hat, Clap, Tom, Perc) on a kit canvas: adds that voice in the first empty slot (a new row; its note
  by §3.5; placed where dropped, else at Tidy's place); on any other canvas: replaces the instrument with a kit holding the Sequencer +
  that one voice and an empty pattern A (the Wavecraft idiom, IMPL-WC §3.5 [R]).
- **"+ ADD DRUM"** under the last row: the type menu → adds as a tile tap does.
- **A voice's ⋯**: Remove (the slot emptied, its cells cleared in every pattern, its note freed — one step), Reset sound (its type's
  defaults). **Its TYPE menu** changes the type: TUNE, DECAY and k1–k4 to the new type's defaults, LEVEL / CHOKE kept, an automatic name
  follows (one step).
- **The Sequencer's ⋯**: the items every instrument has (Replace with…, preset Save / Delete, Init sound = the Starter kit's sounds),
  "Clear all patterns" (one step); (skeptic) "Demo beat" (`KIT.DEMO` into the selected pattern; a confirm when it is not empty) only
  while `KIT.DEMO` is non-null — not in cut 1 (the user: an empty grid; row 20's tutorial builds the first beat).
- **A kit tile on a kit**: the Starter sounds load as a preset, patterns kept — the same-model drop rule (IMPL-WC §3.5 [R]).
- **At 16 voices** the "+" row hides and a voice tile says "16 drums is the most". A structural bound — the family's payload is 16
  sounds wide (map, primaries, mute: dr-seq.js [R]) — not a performance cap (ROADMAP 14).

---------------------------------------------------------------------------------------------------------------------------------

## 2. The voices (`kit-dsp.js`, lane V)

### 2.1 Common laws [C]
Knob positions x ∈ [0, 1] (vals 0–10 / 10, the drum models' convention: models.js:736, 769, 808 [R]); t in seconds from the hit.
- **Ranges** are exponential: `lo · (hi / lo)^x` for every TUNE, DECAY, time and cutoff of §2.2.
- **Amplitude**: a 0.3 ms linear attack on the noise and square paths (the Snare's noise, the Hi-hat; the Clap's bursts have their own
  0.2 ms); the sine and resonator paths start at rest — phase 0 — and need none; then `e(t) = 10^(−3t / T60)` (−60 dB at T60).
- **Velocity** v (1–127): gain `(v / 127)²` (100 → −4.2 dB, 64 → −11.9 dB, 127 → 0 dB), and brightness: the type's bright knob
  (Kick CLICK, Snare COLOR, Hi-hat TONE, Clap TONE, Tom NOISE, Perc CLICK) offset by `0.2 · (v − 100) / 127` position units (clamped).
- **LEVEL** l: gain `(l / 0.7)²` (0.7 → 0 dB, 1 → +6.2 dB, 0 → silent). Default 0.7.
- **Drive** (Kick and Tom DRIVE, one block): `y = A · tanh(g·x) / tanh(g·A)`, `A = 0.8`, `g = 0.01 + 6·k²` — continuous to the identity
  at k 0 (|y − x| ≤ 2e-5 for |x| ≤ A), the peak A kept at any drive; first-order antiderivative anti-aliasing (ADAA1).
- **CHOKE** c ∈ {0 none, 1–4}: a hit on a voice of group c fades every sounding instance of the group's other voices by a
  `KIT.CHOKE_MS` (3 ms) raised cosine.
- **Retrigger**: two instances per slot; a hit fades the slot's sounding instance by the same raised cosine and starts the new one at
  rest — one voice per drum with a crossfade, never a growing pile-up.
- **Output**: every instance adds into the Inst's mono OS-rate bus in `render(buf, N, F0)`, scaled by `KIT.OUT` [C: lane V sets it so
  G3's loudness gate holds]; `post()` writes L = R = mono; `gain()` is 1 (no output stage of its own: a tail crossing an 808 ↔ kit switch
  keeps its level through engine.js's `drUnits`, engine.js:2418 [R]).
- **Time base** (the family's, IMPL-7a §2.1 [R]): control-rate work — envelope steps, pitch-envelope coefficients, sleep checks — per
  absolute 4-base-frame chunk; hits latch for the chunk where they land and apply in slot order; a choke cuts only instances started
  before its chunk (two voices of one group hit in the same chunk both sound). Any span split renders the same bytes.
- **Noise**: a hash of (absolute OS-sample index, slot) — sleep and idle skips never change a hit's noise (the 808's rule [R]); the
  seed `KIT_SALT ^ salt` (`setSalt`).
- **Sleep**: an instance below 1e-5 of its peak for 4 chunks is idle and its state zeroed (it costs nothing); `live()` while any
  instance sounds or a hit is latched. Every state flushed below 1e-30 at each chunk (the Windows idle-DSP lesson, HANDOVER §3 item 17 [R]).
- **Rates**: every law holds at OS 1 / 2 / 4 / 8 and 44.1 / 48 kHz — the blocks are band-limited by design (polyBLEP squares, ADAA
  drive, TPT state-variable filters prewarped at their cutoff), so OS 1 is clean and OS ≥ 2 cleaner.
- **Hostile values**: NaN / ±Inf / out of range → the default or the clamp; the output is never NaN.

### 2.2 The six types [C] — TUNE (u), DECAY (d) and the type's four character knobs k1–k4 (the face's second knob row)

| type | blocks | TUNE | DECAY (T60) | k1 | k2 | k3 | k4 |
|---|---|---|---|---|---|---|---|
| **Kick** | sine, pitch sweep `f(t) = f·(1 + (r − 1)·e^(−t/τ))`; a click; drive | f = 30·4^u Hz (30–120; 0.5 → 60) | 0.08·30^d s (0.08–2.4; 0.45 → 0.37) | **PUNCH** r = 2^(4k) (1–16×; 0.5 → 4) | **SWEEP** τ = 2·40^k ms (2–80; 0.4 → 8.7) | **CLICK** a 4 ms Hann noise burst through a 1-pole high-pass at 2 kHz, peak 0.6·k × the body's (0.3) | **DRIVE** (0) |
| **Snare** | two sines at f and 1.594·f (an ideal circular membrane's first two modes) dropping 12 % over τ 8 ms; white noise through a 2-pole high-pass | f = 120·3^u (120–360; 0.5 → 208) | body 0.06·13^d (0.06–0.78; 0.4 → 0.17) | **TONE** body : noise = cos : sin(k·π/2) (0.55) | **COLOR** noise high-pass 1000·8^k Hz (1–8 k; 0.5 → 2.8 k) | **SNAP** noise T60 0.05·12^k s (0.05–0.6; 0.45 → 0.15) | **BODY** the second mode's level 0–1 (0.5) |
| **Hi-hat** | six polyBLEP squares at f·r_i, **r = {1, 1.4471, 1.6170, 1.9265, 2.5028, 2.6637}** (ours), spread `1 + (r − 1)·(0.5 + k4)`; white noise; a 2-pole high-pass and a 2-pole band-pass at 1.5 × its cutoff, summed | f = 200·4^u (200–800; 0.5 → 400) | 0.02·75^d (0.02–1.5; 0.3 → 0.073) | **TONE** high-pass 3000·4^k (3–12 k; 0.5 → 6 k) | **METAL** squares : noise (0.6) | **RING** band-pass Q = 0.7·(8 / 0.7)^k (0.7–8; 0.3) | **SPREAD** (0.5 = the set) |
| **Clap** | white noise through a 2-pole band-pass (Q 1.4); n bursts, each 0.2 ms up and τ 2.5 ms down, s apart; then a tail from the last burst | band-pass 600·4^u Hz (600–2400; 0.5 → 1200) | tail 0.08·10^d (0.08–0.8; 0.4 → 0.2) | **SPREAD** s = 4·4^k ms (4–16; 0.5 → 8) | **COUNT** n = 2 + round(4k) (2–6; 0.5 → 4) | **TONE** 1-pole low-pass 2000·8^k (2–16 k; 0.6 → 6.9 k) | **TAIL** level 0–1 of the burst peak (0.6) |
| **Tom** | sine bending down `f·2^((b/12)·e^(−t/τ))`; a noise burst through a band-pass at 2f (T60 / 4); drive | f = 60·8^u (60–480; 0.4 → 138) | 0.08·20^d (0.08–1.6; 0.5 → 0.36) | **BEND** b = 12k st (0–12; 0.3 → 3.6) | **SWEEP** τ = 10·12^k ms (10–120; 0.4 → 27) | **NOISE** 0–0.4 of the body peak (0.2) | **DRIVE** (0) |
| **Perc** | two resonators (TPT band-pass, `Q = π·f·T60 / ln 1000`) at f and f·(1 + 2k1), struck by an impulse ↔ a 1 ms Hann noise burst; both bend down 0–7 st over 15 ms | f = 150·32^u (150–4800; 0.6 → 1200) | 0.005·200^d (0.005–1; 0.3 → 0.025) | **RATIO** 1 + 2k (1–3; 0.4 → 1.8) | **TONE** the second mode's level 0–1 (0.5) | **CLICK** impulse ↔ noise (0.3) | **BEND** 7k st (0) |

Every type has exactly four character knobs, so every voice face is the same shape (§4.3). Readouts (the classic `fmt`): Hz, ms / s,
dB, st, %, "–" / 1–4 for CHOKE. `KIT.TYPES` holds this table as data (labels, laws, defaults, the bright knob); `kit-dsp.js` embeds an
identical copy compared by a test (the dr-seq / drum-core precedent, dr-seq.js:1–6 [R]).

### 2.3 Targets [C] (`tests/kit-dsp.test.mjs` through the dsp-scope harness; each at 48 kHz × OS 1 / 2 / 4 and 44.1 kHz × 1; the
measuring code lives in the test)
- **Pitch**: the instantaneous frequency (over ≥ 3 periods) after 10 τ within 1 % of the law's end value; the first period within 5 %
  of the start value (Kick r·f, Tom f·2^(b/12)); the Snare's two modes and the Perc's two resonances within 1 % / 2 %.
- **Decay**: T60 from a log-envelope fit between −10 and −40 dB within 5 % of the law (every body; the Snare noise; the Clap tail).
- **Filters**: the noise path's −3 dB point (Snare COLOR, Hi-hat TONE, Clap TONE) within 10 % on a 64-hit averaged spectrum.
- **Bursts**: the Clap's n envelope maxima at `i·s` ± 0.1 ms.
- **Band-limiting**: the Hi-hat at 48 kHz × OS 1 against the same hat rendered naively at 16 × 48 kHz and decimated by a ≥ 100 dB filter:
  the difference ≥ 40 dB below the reference in 0–15 kHz; the drive at k 1 on a 60 Hz Kick: alias energy ≥ 50 dB below the harmonics in
  0–15 kHz.
- **Level**: each type alone at its defaults, LEVEL 0.7: peak ≤ 0.8 FS at v 100, ≤ 1.0 at v 127; DC |mean| ≤ 1e-3 over the hit.
- **Brightness**: spectral centroid at v 127 ≥ 1.05 × at v 100 (Kick, Snare, Hi-hat, Clap).
- **Clicks**: at a retrigger, a choke, an idle slot's hit and the family's fades (power off, panic, mute): max |x[n] − x[n−1]| ≤ 1.05 ×
  (the steady signal's own max step + peak / (0.003·fs)) — IMPL-WC G3's bound [R].
- **Invariance**: any span split, a sleep / wake and a 2 s idle skip render the same bytes as one uninterrupted render.
- **Cost** (informational, the probe recorded in §13): per sounding instance, OS 4, 48 kHz, node on the M4 Max: Kick / Tom ≤ 0.0008,
  Snare / Clap / Perc ≤ 0.0015, Hi-hat ≤ 0.003.

---------------------------------------------------------------------------------------------------------------------------------

## 3. The sequencer (`kit-core.js` + DrSeq; lane S)

### 3.1 The grid [C]
Patterns **A–H** (8). Each has a **LENGTH** of 1–16 steps of sixteenths (240 ticks at 960 PPQ: the family's step code 3,
drum-core.js:98 [R]) and loops at its length (a 12-step pattern is a 12-sixteenth measure: polymeter against the song's bars is
allowed, as the 808's part lengths). Rows are the present voices in slot order. A cell holds a velocity: 0 (off) or 1–127.

### 3.2 Per-step controls [C]
- **Cut 1 edits**: on / off and velocity (`KIT.VEL`: soft 64 · normal 100 · accent 127; any 1–127 by a drag).
- **Held by the record from day one** (§5.3), neutral until cut 2 edits them: chance 0–100 %, repeats 1–4, nudge −120…+120 ticks, pitch
  −24…+24 st. Cut 1's plan ignores them, and so do its frozen refs; cut 2 adds them to the plan additively (its own refs).

### 3.3 Timing [C]
Always synced (IMPL-7a §3.5 [R]): the plan is anchored at song tick 0, so a start at bar 9, a seek or a loop wrap lands where the
machine would be had it played from bar 1; stopped transport → silent. **SWING** 50–75 % on the odd sixteenth by the family's
whole-tick rule (drum-core.js:112 [R]; 50 = off, bit-identical to none). A pattern change while playing swaps at the measure's end
(`at: 'bar'`), stopped at once; a cell edit is `at: 'now'` (the same shape: replaced in place, position kept); a LENGTH change waits for
the measure's end.

### 3.4 Mute / solo [C]
The row header: tap = mute, long-press = solo (the 808 grid's rule, IMPL-7a §3.6 [R]); masks in `x.mute` / `x.solo` (16 bits;
(skeptic) normKit's own bound — the family's `maskIn` is 12-bit, drum-core.js:247 [R]). Muting recompiles the plan (the family's rule:
steps carry the mask after mute / solo) and mutes the voice's notes (the payload's `mute` = mute | ~solo when any solo, 16 bits: DrSeq
keeps 16, dr-seq.js:185, and drHit tests it, engine.js:2477 [R]).

### 3.5 Notes [C]
Each present voice has a primary note (+ aliases) in the family's map shape (`map: { ka: [36], … }`). A voice added takes the first free
note of its type's list (`KIT.NOTES`): Kick 36, 35 · Snare 38, 40 · Clap 39 · Hi-hat 42, 44, 46 · Tom 45, 41, 48, 43, 47, 50 · Perc 37,
56, 75, 76, 77 — else the first free note from 60. The starter's are fixed in `KIT.STARTER` (closed hat 42, open hat 46). Roll notes, MIDI
in, the keyboard tray and Pads play the voices through the map (engine.js:2473 `drHit` [R]); the roll shows the voices' names on their rows
(`drumRowsOf(dev)`, roll.js:58 [R] → (skeptic) `drumRows(map, model, D)`: names by §5.2 from the record). Playing live records notes,
as on every drum track; recording **into the grid** (REC) is cut 2.

### 3.6 The plan and DrSeq (additive; inert without the fields)
`kit-core.compilePlan(D, S)` (skeptic: no `types` argument — presence is the record's `ty`, §5.3) → the family's plan shape
(drum-core.js:29–34 [R]) for one measure — `n 1`, `mPre [3]`, `mL1 [len]`, `st` = 16-bit lane masks (lane j = slot j; **no accent bit**:
velocities carry the accent) of the present (`D.ty[j] > 0`), unmuted voices — plus:
- **`vl`**: Uint8Array, 16 velocities per step (the plan's kit flag: every reader below keys its branch on `plan.vl`, as drum-core keys
  the 909's on `plan.mSh`).
- (skeptic) **no `ls`**: lane j's primary is `prim[j]` (the identity); cords' layering in cut 2 goes through `tr` inside compilePlan.
**(skeptic) The family's readers of `st` assume the 808's layout** — 12 lanes, bit 0 the accent: DrSeq `fire` takes `st & 0xFFF` and
fires only on `mask & 0xFFE` (dr-seq.js:327, 333 [R]: a kick-only kit step on slot 0 would never fire and slots 12–15 never would);
drum-core `toNotes` walks lanes 1–11 of `mask & 0xFFE` (:665–668 [R]); main's `drumAudible` tests `& 0xFFE` (main.js:4665 [R]). Each
takes a kit branch on `plan.vl` **before** that line: DrSeq `fireK(mask)` — `dm.trig(mask, vl, 16·o)` (o the step's index in `st`),
`drStep`'s v = the step's highest velocity / 127 (its n the lowest present primary, as today), `drNote` once per sounding lane with
**that lane's** primary and velocity / 127 — so a Ducker keyed by the kick's note ducks on every kick step (IMPL-SC §2.1 [R]); drum-core
`toNotes` → `kit-core.toNotes` (per lane `{ t, d: 120, n: prim[j], v: vl[…] }`); `drumAudible` → any nonzero `st` of a kit plan. DrSeq's
`valid(p)` (dr-seq.js:121 [R]) also checks `len(vl) ≥ 16 · mOff[n]` when `vl` is present (the audio thread never trusts a payload). An
808 / 606 / 909 / SDS-V plan has no `vl`: every line runs as today (D1, D2: ref-7a…7d). The record's trigger matrix `tr` (§5.3, the
identity in cut 1) maps rows → voices inside compilePlan — no DrSeq change.

### 3.7 Payload
`drum-core.payload(drum, state, at)` for `'kit'` (skeptic: the family's signature, unchanged — presence from `drum.ty`) → the family's
`{ plan, sync: true, run, bpm, swing, at, tap: 0, map, prim, mute, smp: null, m: 'kit', pk }` (IMPL-7a §3.5 [R]); the host dedupes by
`pk`. So every existing caller (main.js:585, 4571, 4583 [R]) and LC's (`rollPlan` / `rollOpts` / `toNotes`, main.js:10325 [R]) works
for a kit by drum-core's dispatch alone.

### 3.8 Press inputs (`kit-core.press(state, drum, input) → { state, mem, cmds }`, the family's pure state machine, drum-core.js:789 [R])
`cell { lane, step, v }` (v 0 = off) · `paint { lane, steps[], v }` · `pat { p }` · `len { n }` · `swing { v }` · `clear` (the selected
pattern) · `clearAll` · `demo` (skeptic: inert while `KIT.DEMO` is null) · `mute { lane }` · `solo { lane }` · `hit { lane, v }` (an audition: a `{ c: 'hit' }` command through the
note path, the 909's idiom [R]) · `voice { slot, op: 'add' | 'remove', type }` (the record's half: the lane cleared, the note assigned /
freed; the vals' half is the host's, §4.6) · the host notifications (transport, heard, bpm, panic). Commands: `send` (now / bar), `hit`,
`notice`. `leds(S, D)` → `{ step: the heard step | −1, lit: 16 bits }`.

---------------------------------------------------------------------------------------------------------------------------------

## 4. The faces and the canvas (`kit-ui.js`, lane F; lane H wires; lane U the tray, art and skins)

### 4.1 The RIG grid (rig-grid.js `GRID` [R])
Two additive numbers (lane F; every WC and FX layout unchanged — G8 re-runs their gates): **`rows.cell: 48`** (a step row) and
**`rows.ruler: 24`** (the step numbers). Everything else is IMPL-WC §3.8: column 64, side padding 16, row gap 12, head 32, the knob cell
64 × 76 with the 40 px knob, num boxes 40 × 28, the text minima and margins, contrast ≥ 4.5 : 1, fill 0.55–0.85. The Sequencer's screen
*is* the instrument: the fill's upper bound is waived for that face alone (its margins and text rules hold). (skeptic) The grid
screen is a recipe row with a numeric `h` (24 + 48 × (rows + 1)) — `layoutOf` honours it (rig-grid.js:52 [R]; LC's list row,
cv-mods-ui.js:562 [R]) — so rig-grid gains the two numbers only, no row type and no code path.

### 4.2 The Sequencer face [C] — 19 columns = **1248 px** (64·19 + 32) = four voice faces (288) + three 32 px gaps, so Tidy's rows line up
- **Head**: KIT ▾ (the preset menu: the four kits + the user's, the model's preset store) · PATTERN A–H (a seg of 8) · LENGTH (num
  1–16) · SWING (num, %) · CLEAR.
- **The grid screen** (24 + 48 × (rows + 1) px): columns 1–2 the row headers (the voice's name, 11 px uppercase; dim when muted, marked
  when soloed); columns 3–18 the sixteen steps — a cell 64 × 48 with a 4 px inset and radius 6: off = the screen tone; on = a bar rising
  from the bottom to v / 127 of the cell in the voice's colour; the beat columns 1 / 5 / 9 / 13 a lighter tone; steps past LENGTH dimmed and
  inert; column 19 the row's **lamp** (lights at the heard time of the row's hits; cut 2 puts a jack beside it if cords come). The ruler
  above shows 1 / 5 / 9 / 13 and the playhead's marker. The last row: "+ ADD DRUM" in the header columns (hidden at 16 voices).
- **Drawing**: one canvas for the cells (repainted on an edit only) + one hit layer (one element; the cell by arithmetic) + the playhead
  (one element moved by a transform at each heard step) + the lamps (one element per row, a CSS flash class: the 808's LED idiom,
  cv-drum.js:49 [R]). No per-frame repaint.
- (skeptic) **The heard time, the 808's way, not a clock client.** The playhead and the lamps / HIT pads subscribe to the drum host's
  api — `step(fn)` (the `{t:'step'}` posts) and `lit(fn)` (the monitor's 16-bit lit mask; the first subscriber turns the track's drum
  monitor on), cv-drum.js:431–450 [R] — which deliver at the heard time from the host's one-shot `wk.frame` pump (cv-drum.js:255–368
  [R]; `heard` = the clock frame's shared heard frame, main.js:2735 [R], FR review P3-3). A listener only records the step / mask and
  marks the face dirty; one `wk.frame` paints (the 808 panel's `dirty` idiom, cv-drum.js:523 [R]): ≤ 1 transform + ≤ 16 class flips,
  never a layout read. Stopped: no post, no frame — nothing runs. No `wk.clock` client: the playhead moves per sixteenth, not per frame
  (LC's playhead is a continuous line, hence its clock client, cv-mods-ui.js:817 [R]; a gliding playhead later = that client, by feel).
  Off screen: the CSS flash pauses (cv-module's `[data-cv-off]` rule) and the pump's work is a few integer writes.

### 4.3 The voice faces [C] — 4 columns = **288 px**; height 12 + 32 + 12 + 76 + 12 + 76 + 16 = **236 px**
- **Head**: TYPE ▾ (Kick / Snare / Hi-hat / Clap / Tom / Perc) · **HIT** (a pad: velocity by the press's height, the 1i curve
  `cv-keys KEY_VEL`, cv-keys.js:20 [R]; it lights on every hit of the voice at the heard time; `data-gesture="music"`).
- **Knob row 1**: TUNE · DECAY · LEVEL · CHOKE (a num cell: – / 1–4).
- **Knob row 2**: k1–k4 of its type (§2.2).
- **The bar**: the voice's name, its colour stripe, ⋯ (Remove, Reset sound). No ⏻: the row's mute is its switch; a muted voice's face dims.
- **Knobs**: wk's knob at 40 px carrying `data-ctl` / `data-dest` = the model's control ids under the module's `[data-dev]` (the classic
  convention, classic-panel.js:15 [R]); writes through the host (§4.6); press-and-hold: Reset / Enter value (no modulation items in cut 1).
  (skeptic) Built as ccBody builds its number box (`wk.numBox` / `wk.knob` `{ get, set(v, ph) }`, cv-mods-ui.js:476 [R]): `get` reads
  `vals[id] / 10`, `set` calls the host's `set(t, dev, id, v · 10, ph)` — main's `kitKnob`, ptKnob's shape (vals write, persist, the patch
  posted on `'end'` or throttled, no History step: main.js:9875 [R]). No Serum host and no donor anywhere on a kit face.

### 4.4 Interactions (touch first) [C]
- **Tap** a cell: toggles it (on at the row's last-used velocity, else 100). **Drag sideways** from a cell: paints the first cell's new
  state along the row (one gesture = one History step). **Drag up / down** from an on-cell: its velocity (up = louder; the bar and a readout
  follow). The first 6 px decide which. **Long-press** (500 ms, ≤ 8 px): the step menu — Soft · Normal · Accent · Off (cut 2 adds chance /
  repeats / nudge / pitch).
- **Two fingers**: a second finger during a paint or a velocity drag cancels it (the cells revert, no step) and the pinch / pan proceeds
  (gesture.js [R]); the grid is not a music zone (only the HIT pads are).
- **Below 50 % zoom** a press pans unless the module was double-tapped (the canvas rule, ROADMAP :120 [R]).
- **Mouse**: as touch; Shift-drag sets velocity from any cell.
- **Keyboard**: the grid is one focusable element with a cursor — arrows; Space / Enter toggle; + / − velocity by 8; Delete off; M mute;
  S solo (the 808 grid's idiom, cv-drum.js:1125 [R]); aria-label "Kick, step 5, on, velocity 100".

### 4.5 Tidy and the first view [C]
The Sequencer at the instrument's place; the voices in rows of four under it in slot order, 32 px apart; the Effects panel and OUT to the
right (cvRoom's rules); the first view as §1.2. (skeptic) The voices are cv-module **`'pm'` entries** (`{ key: 'iN/k<s>', kind: 'pm', dev,
fixed: { w: 288, h: 236 }, title, sub }` — the 900 Series' sub-module path: the entry's size, the compact bar (title over sub, ⋯), no fold,
Tidy by `host.rackLayout(instKey)`, cv-module.js:288, 471–480, 1087–1091, 1149 [R]): the rack layout `kitHost.rack(t, dev)` puts them
under the Sequencer (positive y — the rack's x / y are relative to the instrument's top-left). Not `'part'`: that kind is the rig's
(PART_W_DEF, sxViews, sxRemovePart: cv-module.js:1148; main.js:7018, 7048, 6906 [R]). So cv-module.js needs no change; main.js's
`'pm'` dispatchers (`kindOfKey` :7016, the mount :7043, `size` / `rackLayout` :7220–7223, the title :7252, the ⋯ items :7348, Remove
:6905, `cvDevices` :9776) branch on `isKitDev(t, q.dev)`.

### 4.6 Host wiring [C] — `kitHost(deps)` (kit-ui.js; the cv-patch idiom, cv-patch.js:25–42 [R])
`kitHost(deps) → { face(kind, root, args) → View, devices(t, dev) ('pm' entries, §4.5), size(t, dev, key), rack(t, dev) (Tidy's
offsets), FACE, layoutOf, cellRect(t, dev, lane, step), destroy }` (skeptic: `size` / `rack` as cv-patch's, so main's `'pm'` sites
call the kit's host where they call PATCH's); deps: `doc`, `view()`, `get(t, dev, id)`, `set(t, dev, id, v, ph)` (`kitKnob`, §4.3,
`ph` 'move' / 'end'), `drum(t, dev)` (cv-drum's api: `press / state / step / lit / pads`), `edit(t, dev, label, r)` (ONE History step:
`r = { vals?, drum?, lay? }` with its `kitBack`, §5.5), `notice`, `menu`, `undo`, `heard`, `rate`, `live`.

### 4.7 The Sources tray (lane U) [C]
The Drums view (cv-tray.js:609–610 [R]: `layout: 'hw'`, one section `{ id: 'drums', models: DRUMS }`) gets two sections first — the
kit tile, then "Drum modules" (the six voice tiles: a tile list of their own, `KIT_TILES`, as `RIG_TILES` / `MOD_TILES` are,
cv-tray.js:689, 718 [R]) — and the four machines under "Classic machines" (their filter excludes the kit: `DRUMS` becomes
`m.family === 'drums' && !isKitModel(m)`, cv-tray.js:594 [R]); the view's tip "Our drum machine and the classic ones" (today "Drum
machines with their real front panel"); (skeptic) the kit's tile meta not the drum machines' (cv-tray.js:799 [R]: `DRUMS(m)` picks
it). Original art (cv-art.js): the tile a stylised grid of cells; the six voice glyphs simple shapes (no instrument drawings of any
product).

### 4.8 Skins [C] (skeptic: rewritten — no new scope, no new token)
Every kit module (the Sequencer and the voices) carries the **rig's mark `data-cv-rig`**: `rigMark` (main.js:8768 [R]) gains `||
isKitDev(t, dev)` (lane H). Every skin block already scopes it with the module, its `.rig-face` and the popups (style.css:1560–1586,
1676–1760 [R]; `wkPopSkin` main.js:8763 [R]), so the kit wears charcoal / ivory / glass (glass neutral, blur off on Low) with **no
style.css change** — exact by construction, and the skins' gate ("the same variables in the same order", tests/cv-tray.test.mjs) does
not move. (The modulators' `data-cv-face=""` would do as well; a fourth `[data-cv-kit]` scope would copy ≈ 15 chrome rules and 12 skin
selectors for nothing.) The face's own pieces (cells, lamps, HIT pads, the step menu) are kit-ui's injected CSS (`KIT_CSS`, once per
document, as `MOD_CSS`, cv-mods-ui.js:80–166, 167 [R]), colours only from the existing tokens: the screen `--rig-screen` / `--sxd-*`, the
text `--sx-ink` / `--sx-mute`, the accent `--sx-accent`. The six **type colours** are data, `KIT.TINT` (kit-core; LC's rule for its
list tints, cv-mods-ui.js:553–555 [R]: each ≥ 3 : 1 on the charcoal, glass and ivory screens — a kit-ui test like LC's); the grid canvas
reads the tokens (`wk.theme`) and repaints on a skin change (main's `rigSkinPick`, main.js:8749 [R], already calls `cvRender`). A skin
never changes a number.

---------------------------------------------------------------------------------------------------------------------------------

## 5. The model and the project

### 5.1 The model entry (models.js, appended last — after the rig: MODELS[18]) [C]
`{ id: 'kit', name: RIG.NAME + ' ' + KIT.WORD, model: 'Drum machine', year: 2026, family: 'drums', tag, about (our words: synthesized
voices, no recordings), theme (the charcoal skin's chip accents), sections: 16 × "Drum n" with 10 controls each, presets: KIT.KITS,
map(P, v) → { engine: 'drums', machine: 'kit', level: 1, drum: { the 160 values: knobs / 10; TYPE and CHOKE as indices } } }`; no maker.
`isKitModel(m) = !!m && m.id === 'kit'` beside `isRigModel` (models.js:897 [R]); `classicOf(kit)` is false (it has a family); `isSxId('kit')`
false (models.js:901–902 [R]). (skeptic) The model wrapper fills a missing control at its default on every `map` (models.js:903–915 [R]):
160 controls, a `some()` per patch — fine at the throttled knob rate. models.js imports `KIT` from kit-core.js (a leaf, as rig-core).

### 5.2 Control ids [C]
Per slot s ∈ a…p: `k<s>t` TYPE (0 empty · 1 Kick · 2 Snare · 3 Hi-hat · 4 Clap · 5 Tom · 6 Perc; cut 2: 7 Sample), `k<s>u` TUNE, `k<s>d`
DECAY, `k<s>l` LEVEL, `k<s>c` CHOKE (0–4), `k<s>1`…`k<s>4` the character knobs (knobs 0–10, the drum models' convention). **A voice exists
iff its TYPE > 0**: the vals are the truth of what sounds; the record follows (§5.4) and (skeptic) mirrors the TYPEs in `drum.ty`, so the
main-side readers that see only the record (drum-core's plan / payload / notes / rows, pads-core, cv-cables, LC's marks) need no `vals`.
**Names**: `kit-core.names(D)` (skeptic: from the record alone) → 16 strings — `D.nm[j]` when set, else the type's label (by `D.ty[j]`)
+ an ordinal among same-type voices ("Tom", "Tom 2"), '' for an empty slot; every place that names a kit's rows — the roll and the
Ducker's NOTE menu (`drumRowsOf(dev)`, roll.js:58 / main.js:1423 [R]), the Combiner's Marks menu (main.js:10310 [R], which then calls
`drumRowsOf(dev)` too), the Pads labels (`soundName(s, model, D)`, pads-core.js:202 [R]) — reaches it through drum-core's `drumRows(map,
model, D)` (the four ignore `D`).

### 5.3 The record (`dev.drum` of a kit; `drum-core.normDrum(d, 'kit')` → `kit-core.normKit`: exact lengths, every field bounded, unknown
fields dropped, idempotent, never throws) [C]
```
{ v: 1, m: 'kit',
  pat: [8 × { len 1–16, sc 3, cells: [≤ 256 × { l 0–15, s 0–15, v 1–127, c? 0–100, r? 1–4, n? −120…120, p? −24…24 }] }],
  ui:  { pat 0–7 },
  x:   { sync: true, swing 50–75, mute 0–0xFFFF, solo 0–0xFFFF, rec: false },
  keys: [],                                  (skeptic) the SDS-V's precedent: main's drumOf and the drum host's mem gate pass
  ty:  [16 × 0–6],                            (skeptic) the TYPEs' mirror (reconcile writes it; normKit bounds it)
  map: { ka … kp: [primary, …aliases] },     the family's shape; notes 0–127, unique
  nm:  [16 × '' | ≤ 16 characters],
  tr:  [16 × 16-bit row → voice mask],        the identity in cut 1
  smp: {} }                                   the family's slots, cut 2's Sample type
```
Cells are **sparse**, sorted by (s, l), unique per (l, s); `c / r / n / p` absent = neutral (100 / 1 / 0 / 0). An empty pattern costs
nothing; a typical groove ≈ 20 cells; a full 16 × 16 pattern ≈ 6 KB of JSON. `sc` (the step scale) is held for cut 2's triplets / 32nds.

### 5.4 Reconcile [C]
`kit-core.reconcile(vals, drum) → drum` (pure, idempotent): a slot whose TYPE became 0 keeps its cells (inert: the plan compiles present
voices only — an undo or another kit brings them back) and its note (freed only by Remove); a slot that became present without a note
gets one (§3.5); an automatic name stays ''; (skeptic) `ty` = the vals' TYPEs. The host runs it after a kit load, a TYPE change and every
undo / redo restore (an unchanged result returns the same object: no persist, no repost).

### 5.5 History [C, decision g]
- A grid gesture — a tap, a paint, a velocity drag, a pattern / LENGTH / SWING change, CLEAR, mute, solo — is **one History step** ("Edit
  pattern", "Clear pattern A" …). `keepDevs` (main.js:1958–1967 [R]; its `if (c.drum) d.drum = c.drum` at :1963 gains `&& d.model !== 'kit'`) keeps a kit's `vals` (knob turns are never reverted: the app's policy) but
  **not** its `drum`, so ↶ / ↷ move the pattern.
- **Structural edits** — add / remove a voice, a TYPE change, a kit load, Reset sound — are one step each carrying a **`kitBack`** meta
  with the vals they changed (the `sxBack` / `drBack` / `ptBack` idiom, main.js:1979, 2007, 2014 [R]), so ↶ restores the voice exactly.
- (skeptic) Cut 1 builds this rule only (decision g): the family's "tap to undo" rule on the kit is cut-2 work if the user asks.

### 5.6 Schema 18 [C]
`cv-migrate.SCHEMA = 18`; `STEPS[17]` the identity (no stored data changes); its header line "17 → 18: our drum machine (model 'kit',
`dev.drum` in its shape)". A kit in an 18 file opened by a 17 build would read `'kit'` through `modelById`'s fallback and autosave the
loss → the bump makes it read-only there (the 7a / 7b / 7c / 8 / WC reasoning, cv-migrate.js:28–41 [R]; SCHEMA at :129). (skeptic) Kept
against LC's no-step choice (IMPL-LC §2.4: "canvas saves need no care", and a bump makes every newer save read-only in a lagging tab):
a combiner survives an old build as plain data, a kit does not — the old build's `normDev` drops `dev.drum` (song.js:604 [R]), every
pattern, and autosaves it; the read-only notice costs one Reload. `song.normDev` keeps `drum` for a kit through
`PERS` (song.js:582, 604 [R]); a record of another machine's shape on a kit is normalised to the kit's. Lay: `iN` (the Sequencer),
`iN/ka`…`iN/kp` (song.js:551 `LAY_KEY` [R] accepts them). **toV1** (Save as classic project): the kit track keeps its notes; its lost line "“<track>”:
<NAME> is this app's drum machine — the live site has none; its piano-roll notes are kept" (the 808's rule, IMPL-7a §6 [R]).

### 5.7 Kits (presets) [C]
`KIT.KITS` = four of ours: **Starter** (= the defaults: Kick, Snare, Clap, Closed hat, Open hat (choke 1 with the closed hat), Low tom,
High tom, Rim (a Perc)), **Deep** (a lower, longer kick; darker hats), **Tight** (short decays, a snappy snare), **Crunch** (drive on the
kick and toms, bright hats). Each is a full set of the 160 values, empty slots included, so a kit load sets which voices exist (the record
reconciled, §5.4). The user's own kits through the model's preset store (Save / Delete, as every model). A kit never touches the patterns.
(skeptic) `KIT.DEMO = null` (the user: an empty grid). The groove the contract drafted as the demo becomes the tests' **fixture groove**
`GROOVE` (tests/kit-fixtures.mjs, lane S; ours, 16 steps, never shipped): kick 1 · 5 · 9 · 13; clap 5 · 13; closed hat 3 · 7 · 11 at 100
and 1 · 5 · 9 · 13 at 64; open hat 15 at 100 (choked by the closed hat on the next bar's step 1); rim 12 at 64 — G3's loudness, G4's
steps ≡ notes, G5's refs, the dkp row and G9's scenes play it. The diagram in §1.1 is illustrative, not this data.

### 5.8 Bounce and files
The family's paths: `bounceSet`'s `syncedOf` with `drumAudible` = (skeptic) any nonzero `st` of the kit's plan (its own branch, §3.6;
main.js:4663, 5636, 5715 [R]); `drumPayload` offline (main.js:585, 4569 [R]); MIDI export on channel 10 (song.js:872 [R]); smprender.js's
worker loads `kit-dsp.js` (its DSP list, smprender.js:30 [R]) or an offline render of a kit is silent; no sample needs in cut 1.

---------------------------------------------------------------------------------------------------------------------------------

## 6. Hooks for row 20 (the first beat) and row 26 (the LFO combiner)

This stage builds the hooks, not the tutorial; row 26 shipped (LC, 480bb3f) and already reads the drum family (§6.2). (skeptic) Cut 1
keeps what costs nothing or what its own tests need; the tutorial's event API waits for row 20's contract, which knows what it asks.

### 6.1 Row 20 (skeptic: trimmed)
- **Cut 1**: `__synthTest.cv.kit` (lane H; the sims and G7 drive it) = `{ add(track), state(trackId), cellRect(trackId, lane, step) }`
  — `add` the tile's action (the empty grid, the user's answer: no `{ demo }` option), `state` a copy `{ pattern, len, swing, playing,
  voices: [{ slot, type, name, note, cells: { step: v } }] }`, `cellRect` a cell's box in world px (one canvas, no element: kitHost's
  `cellRect`).
- **Anchors** (cut 1, free: attributes F writes anyway): `[data-kit="seq"]`, `[data-kit="pat"][data-p]`, `[data-kit="voice"][data-slot]`,
  `[data-kit="hit"]`, `[data-kit="swing"]`, `[data-kit="add"]`, knobs by `data-dest`.
- **Row 20's own contract** (not here): `kitApi` handed to the tutorial's module at boot, its events (`on(trackId, fn) → off`:
  cell / pattern / voice / swing / plan), `kick(trackId)` → `{ slot, note }` (the lowest Kick slot — its Ducker step: TRIGGER the kit track,
  NOTE that note, IMPL-SC [R]). The tutorial checks progress; it never edits behind the user's back.

### 6.2 Row 26 (skeptic: rewritten — LC shipped its own reader)
- **Done by LC**: the Combiner's Marks menu lists every drum machine's rows (`cmbMarkList`, main.js:10303–10314 [R]: `DC.drumRows(D.map,
  model)`) and its marks expand a synced machine's own pattern hits through drum-core's "Pattern to notes" reader (`cmbMarks`,
  main.js:10317–10330 [R]: `DC.toNotes(DC.rollPlan(D, bpm, sess), { t0, t1, ...DC.rollOpts(D, dev) })`, then the track's notes), page data
  only (IMPL-LC §6.7 [R]).
- **What the kit adds (lanes S, H)**: drum-core's `drumRows` / `rollPlan` / `rollOpts` / `toNotes` dispatch the kit (§3.6, §3.7; its
  `toNotes` keyed by `plan.vl`), and `cmbMarkList` names the kit's rows through `drumRowsOf(tr.dev[dev])` (one line, H) — so the Marks
  menu lists "Drums · Kick", "Drums · Snare" … and a pick marks exactly where DrSeq fires (swing and the loop included: rollPlan is the
  synced plan, toNotes its whole-tick positions — G4 checks the kit's `toNotes` ≡ its DrSeq fire positions).
- **Dropped**: `kit-core.hitsIn`, `drum-core.hitsIn` and `kitApi.hits` (the contract's reader): LC's path is that reader.

---------------------------------------------------------------------------------------------------------------------------------

## 7. Engine work and cost (lane V; the iPad)

### 7.1 Files [C]
- **`kit-dsp.js`** (new; a classic script, one IIFE publishing the frozen `globalThis.DrKit`, null on a failure — dr-808.js's form).
- **`engine.js`**, three sites, nothing else (Track, Chain, graph, ModCore and the protocol unchanged): PatchP builds `new KitP(o.drum)`
  for machine `'kit'` (a fixed-shape class of the 160 ids in one order with `KIT` defaults), `new DrumP(o.drum)` otherwise (D2);
  `drOn` / `drGain` take the factory by id — `DrKit` for `'kit'`, `Dr808` for the rest (a missing one: the family's `drFail`; engine.js:2383,
  2412 [R]: today both read `globalThis.Dr808` only); `warmUp` adds a kit round after `warmDrumsV` (its call at engine.js:3839 [R], inside
  `warmDrums`' try): every type at v 64 / 127, a retrigger, a choke, a two-step synced plan through DrSeq (a `vl` plan), an OS change —
  then the plain paths' re-warm as today (the 2b JSC lesson, HANDOVER §5 [R]). (skeptic) `KitP` may hold its 160 values as one
  `Float64Array` in `KIT` id order (a frozen id → index map beside it) rather than 160 named fields: a typed array never changes shape
  and the 16-slot loops index it; the lane picks with the JSC A/B and says so in §13. PatchP's `drum` field then holds two classes
  (DrumP | KitP): the JSC A/B covers every drum row (d8p, d6p, d9p, dvp), not only d8p / d9p.
- **`dr-seq.js`**: `vl` and the kit branch of `fire` / `valid` (§3.6; lane S). (skeptic) No `ls`.
- **The DSP lists** (each gains `kit-dsp.js`, (skeptic) **after `dr-808.js`, before `dr-seq.js`** — tests/modcore.test.mjs:87 [R] pins
  `dr-seq.js` as the script before `mod-core.js` —, its global `DrKit`): main.js:928 `DSP_FILES` (lane H applies the line), cv-cost.js:345
  (the bench worker), smprender.js:30 (the offline render worker), wk.js:3530 `DSP_GLOBALS` (the main-thread map), tests/golden-harness.mjs:29,
  tests/dsp-scope.mjs:40, (skeptic) **tests/bench.html:76–77** (the iPad bench page's `<script>` list; tests/bench.test.mjs:121 [R] holds it
  equal to dsp-scope's list — without it the iPad bench has no kit); the pins that move: tests/app.test.mjs:165 (18 → 19 modules, "18 DSP
  scripts + engine.js"), tests/wk.test.mjs:2327, tests/sx-base.test.mjs:428, tests/cv-cost.test.mjs:437; `sw.js` through
  `node tools/precache.mjs --write` (the lead; it follows DSP_FILES and smprender's list, tools/precache.mjs:9–10 [R]).

### 7.2 Budgets [C] (node on the M4 Max; the iPad Pro measured 0.7–1.0 × node on the family's rows, IMPL-7a §2.6 [R]: its target = node's)

| row | what | node | ipad |
|---|---|---|---|
| **dkp** | the Starter kit + (skeptic) the fixture groove (§5.7), 120 BPM, synced, OS 4, 48 kHz (the whole track) | 0.012 | 0.012 |
| **dkx** | 16 voices, every step of every lane at v 127, every DECAY at 10, OS 4 | 0.06 | 0.06 |
| **dki** | powered, synced, stopped, silent (in engine-track, as d8i: tests/engine-track.test.mjs:1087 [R]; not a scenario) | 0.0005 | 0.001 |

`cv-cost` `COST.synth.kit = C('dkp', 'drums', 1, base, voice)` from the measured dkp (cv-cost.js:104–105 [R], the family's rows; their
pin tests/cv-cost.test.mjs:92 gains the kit's); the tile's label from it. (skeptic) The rows go in tests/bench-scenarios.mjs beside the
family's (`drumTrack`'s kind-'track' builds, :679–705 [R]) as a `kitTrack(groove, vals)` builder; bench.json `targets` gains them (the
family's: node = ipad); the measured `ipad` row stays absent until the consolidated iPad pass.
V8: every existing bench row within 2 %. JSC (the shell method, IMPL-2b §9): d8p, d9p, c1, d, mt within 3 % (PatchP and DrSeq changed).
The warm-up's time ≤ 1.1 × today's (engine-track measures it).

### 7.3 The UI on the iPad [C]
Painted elements: the Sequencer ≤ 160, a voice face ≤ 150 → the Starter scene (Sequencer + 8 voices + an empty Effects panel + OUT)
≤ 1 500, under the touch notice's lines (main.js:8413, 8425 [R]); a 16-voice kit ≈ 2 700 — (skeptic) the notice fires only if lane H
adds a `'kit'` kind to `heavyOf` (main.js:8427 [R]: today a rig in parts or a 900 Series only), with PT_HEAVY's line 2 048 and its words
("This many modules may stutter when zooming on this device."; SX_HEAVY's text names the Wavecraft), once a session (§12). While
playing: per heard step one transform + ≤ 16 class flips (lamps, HIT pads), no layout, no canvas repaint; stopped: 0 paints; an edit
repaints the grid canvas once (≤ 2 ms at dpr 2 under the Mac's 4× throttle). (skeptic) The playhead and lamps ride the drum host's heard
queue and its one-shot `wk.frame` pump (cv-drum.js:255–368 [R]; §4.2) — not a `wk.clock` client: the clock's clients are the continuous
painters (frameTick, fastTick, LC's `lc`, main.js:11528–11529, cv-mods-ui.js:817 [R]); nothing of the kit joins them.

---------------------------------------------------------------------------------------------------------------------------------

## 8. Gates

| gate | what | target |
|---|---|---|
| **G1 outside = today (D1, D2)** | every golden — golden-classic / -fx / -presets / -random / -graph; -drums / -606 / -909 / -sdsv with ref-7a…7d (their frozen dr-808 / dr-seq / engine against the current tree); -moog / -moog-b / -moog-c; (skeptic) -lc (ref-LC); ref-1c / -p1 / -M / -SC / -MM / -WC / -P / -9 / -9-core / -9b / -9c / -SX0 (rig-sound, sx0-model) —, canonical-stream's fixtures; drum-core's pins for the four (records, sessions, payloads, plans, pk, notes); the warm-up's "first Track = a fresh one" for every machine; every existing test file green with only §9.4's pins moved | exact |
| **G2 the voice laws (D4)** | every target of §2.3, every type, every rate | the stated tolerances |
| **G3 the machine** | span invariance, sleep / wake, idle skip, denormals (10 s of silence then a hit: no subnormal in any state), hostile values; the click bound at retrigger / choke / power off / panic / mute and at machine switches 808 ↔ kit ↔ 909 (the classic ↔ drums step, ROADMAP :129 [R], recorded, not fixed here); **loudness**: (skeptic) the fixture groove (§5.7) on the Starter kit through the Track within 1 dB RMS of the 808's d8p groove, the limiter untouched (the family's rule, models.js:781 [R]) | exact / stated |
| **G4 the sequencer (D3)** | kit-core: normKit fuzz (never throws, idempotent, bounds), the press table (every input of §3.8), compilePlan memo and pk, reconcile (`ty` = the vals' TYPEs), names from the record, the notes rule, (skeptic) the kit's `toNotes(rollPlan(…))` ≡ DrSeq's fire positions (LC's marks read it); a kit plan through every `st` reader of §3.6 (DrSeq `fire` / `valid`, `toNotes`, `drumAudible`): a slot-0-only step fires, slots 12–15 fire, a bad `vl` length is refused; DrSeq with `vl` (velocities reach the machine; drStep / drNote values; a Ducker keyed by the kick's note ducks on each kick step); **D5**: the fixture groove as steps ≡ the same hits as roll notes through the song path at swing 50 / 62 / 75; **D7**: a bounce ≡ live; seek, loop wrap, a pattern swap at the measure's end, a LENGTH change, a mute's recompile | exact |
| **G5 frozen refs** | `tests/golden-kit.test.mjs` + `tests/ref-DM/` (verbatim kit-dsp.js, dr-seq.js, engine.js + MANIFEST `{ note, commit, files: { sha256 } }`: ref-7d's format, tests/golden-sdsv.test.mjs:1–40 [R]); cases: each type × TUNE / DECAY at 0 / 0.5 / 1 × each k at 0 / 1 × v 32 / 100 / 127; retrigger trains; chokes; the fixture groove synced at 120 and 128 BPM, swing 62; roll notes; OS 1 / 2 / 4; 44.1 × 1. Frozen by the lead at cut 1's acceptance (`GOLDEN_FREEZE_DM=1`); before that a determinism self-check with a diagnostic | exact |
| **G6 files and undo** | schema pins (18, STEPS 18, "a newer file" 19; the files that hold them: §9.4); an 18 file with a kit opens read-only in the base build (⟨B⟩, a scratch worktree, tests/main-sim.mjs — LC's phase-0 method, IMPL-LC §2.4); normKit through song.normDev; toV1's lost line; a gesture = one step, ↶ / ↷ move the pattern; knob turns never reverted; add / remove / TYPE / kit load / Reset restored exactly by `kitBack`; Replace → ↶ restores the old instrument whole; reconcile after every restore | exact |
| **G7 UI flows** (reviewer 2: headless Chrome for Testing, 1440 × 900 and touch 1366 × 1024 / 1024 × 1366, dpr 2, downloads denied) | the kit tile on a Juno, an 808 and a Wavecraft canvas (the Starter on an empty grid — (skeptic) the user's answer; a tapped step, ▶ plays; the notice; ↶); a voice tile on a kit (adds) and on a Juno (a kit with that voice); "+ ADD DRUM"; TYPE change; Remove; tap / paint / velocity drag / the step menu; a pattern switch while playing (at the measure's end); LENGTH; CLEAR + ↶; SWING; mute / solo; HIT pads (velocity by height; two fingers = two hits); lamps and playhead at the heard time; the roll's named rows; the Ducker's NOTE menu lists the kit's names; (skeptic) a Combiner's Marks menu lists the kit's rows and a pick marks its steps; a new Pads module follows the kit (its present voices, their names, `KIT.TINT`'s nearest pad colours); two fingers on the grid zoom, never toggle a cell, and cancel a paint; below 50 % a press pans; the keyboard grid; every other canvas unchanged (its sims green); no console error | pass |
| **G8 layout** (§4.1; `tests/ui-layout-kit.mjs`, the WC harness's method) | widths 64·n + 32; knobs on column centres and row lines ± 0.5; row tops; cells 64 × 48 on the step columns; text ≥ 6 / 8 px from edges / other text, nothing clipped, the minima; contrast ≥ 4.5 : 1 in every skin (text), (skeptic) ≥ 3 : 1 for `KIT.TINT`'s bars on each skin's screen; fill 0.55–0.85 on the voice faces; ui-layout-wc / ui-layout-fx unchanged and rig-grid's existing numbers untouched (G8 re-runs both, and tests/cv-mods-ui's plain-face gates). **Contact sheets** (the three sizes: the Starter kit, every type's face, a 16-voice kit) to the lead's scratchpad, shown to the user before deploy (not committed) | exact / the user's eye |
| **G9 frame cost** (skeptic: the two harnesses that exist) | (a) tests/ui-bench-wc.mjs (WC's pan / pinch harness, its `BAR`, :21–24 [R]; scenes `&scenes=` today juno / rig1 / rigX, :293 [R]) gains `kitS` (the Starter + FX + OUT, the fixture groove) and `kitX` (16 voices): pan / pinch 25–200 % / a module drag P+ at 1× and 4× CPU (bursts median ≤ 17 ms, p95 ≤ 20, no frame > 33), P at 6×; painted elements within §7.3; (b) tests/ui-bench-fps.mjs (FR's display-rate harness, `SCENE_IDS` :62, `EXPECT` [R]) gains a `kit` scene playing at 160 BPM: the playhead and the lamps live at the step rate (a `rate: 'step'` class or `min:` — the lane's call), no layout per step, ≤ 1 transform + ≤ 16 class flips, no `wk.clock` client of the kit's; its idle cell: 0 paints stopped. `ui-DM-mac` recorded in bench.json | pass / recorded |
| **G10 touch / a11y** | hits ≥ 44 px at 100 %; the keyboard grid; aria-labels; music zones only on HIT pads; a second finger cancels; Escape closes menus | pass |
| **G11 our own (D6, D7)** | the import lines of kit-core.js (none), kit-dsp.js (no other global), kit-ui.js (rig-grid / wk / kit-core only) — a grep test; no other instrument's maker or machine name and no "Serum" / "Wavecraft" literal in kit-*.js, the kit's tray texts or notices (the display name only through the model); the Hi-hat's ratio set differs from every oscillator table of dr-808.js (a test) | exact |
| **G12 bench** | dkp / dkx / dki within §7.2 (node); V8 and JSC A/B (every drum row, §7.1); tests/bench.html's script list gains `kit-dsp.js` (bench.test.mjs:121's pin) and its rows come from bench-scenarios (no measured `ipad` row until the consolidated iPad pass) | pass |

---------------------------------------------------------------------------------------------------------------------------------

## 9. Lanes (the leaner shape; cut 1) — (skeptic: re-planned on ⟨B⟩; the final plan is §14's last paragraph)

### 9.0 Before the builders
- **A skeptic pass on this contract** (Opus 5.5, read-only, scripts against ⟨B⟩ 615713d): its findings fixed in the text (§14).
- **Phase 0 — the lead (Opus 5.5; the user's rule: no Fable lanes)**: `kit-core.js` with `KIT` as data (WORD 'Drums', ID, SLOTS 16,
  CODES `ka`…`kp`, TYPES, STARTER, DEMO null, KITS, VEL, NOTES, CHOKE_MS, TINT) and stubs of lane S's functions (`normKit` already
  returns the full empty record: `keys: []`, `ty`); models.js `kit` (appended after the rig) + `isKitModel`; drum-core.js `mach()`
  five-way, `isKit(D)`, `PERS.kit` (sounds `ka`…`kp`, sids 0–15, mask 0xFFFF) / `MAPS.kit` and the dispatch stubs (`drumRows(map, model,
  D)` included); cv-mods.js `noClassic` skips the kit and `destOk` refuses it ("The drum machine's knobs take modulation in its next
  update"); cv-migrate 18; a cv-cost placeholder row; a cv-art placeholder; (skeptic) **a stub `kit-dsp.js`** (a frozen `DrKit` with
  `VER` and a `create` that returns null) **on every DSP list at once** — main.js `DSP_FILES`, cv-cost.js, smprender.js, wk.js, the
  golden harness, dsp-scope, tests/bench.html — after dr-808.js, so no lane edits another's list; `tests/kit-fixtures.mjs` (`GROOVE`,
  §5.7: V's bench / golden, S's tests and G's scenes share it); the pins of §9.4 moved; `tests/ref-DM/` empty; `node tools/precache.mjs
  --write`. Every test green (one file at a time). The builders reset to this commit (`git reset --hard <phase 0>`, `git log -1` checked).

### 9.1 The lanes (phase 1 in parallel in worktrees; H in phase 2 on phase 1's merge; G beside the reviewers)

| lane | owns (exclusive) | gates | model |
|---|---|---|---|
| **V** voices + engine | `kit-dsp.js` (the body), `engine.js` (§7.1), `cv-cost.js` (the measured COST), `tests/kit-dsp.test.mjs` (new), `tests/golden-kit.test.mjs` (new), `tests/engine-track.test.mjs` (+ kit, the two `,kit` pins, DrumP's shape pin), `tests/bench-scenarios.mjs` + `tests/bench.json` (dkp / dkx / dki) | G1 (engine side), G2, G3, G5 (prepared; the lead freezes), G12 | Opus 5.5 |
| **S** sequencer | `kit-core.js` (normKit, press, compilePlan, payload, toNotes, names, reconcile, noteFor, leds, initState, typesOf), `drum-core.js` (the dispatch bodies; `drumRows`' `D`), `dr-seq.js` (`vl`, `fireK`, `valid`), `cv-drum.js` (the host's `machOf` / `sessOf` / `fresh` for 'kit' only — no widget), (skeptic) `pads-core.js` (`soundName` / `sidOrder` / `drumNote` for a kit through `D`), `tests/kit-core.test.mjs` (new), `tests/dr-seq.test.mjs`, `tests/drum-core.test.mjs`, `tests/pads-core.test.mjs`, `tests/cv-drum.test.mjs` (the host part) | G4 (node), G1 (the four's pins, ref-7a…7d) | Opus 5.5 |
| **F** faces | `kit-ui.js` (new: `kitHost`, `FACE`, `KIT_CSS`, the Sequencer face, the voice faces, HIT pads, lamps, the step menu, the "+" menu, `cellRect`, `size` / `rack`), `rig-grid.js` (the two additive numbers), `tests/kit-ui.test.mjs` (new; the fake DOM, `safeAssert`), `tests/ui-layout-kit.mjs` (new; G8 and the contact sheets) | G8, G10, G7's face half | Opus 5.5 |
| **U** tray, art | `cv-tray.js` (§4.7), `cv-art.js` (the tile + six glyphs), `tests/cv-tray.test.mjs`, `tests/cv-art.test.mjs` — (skeptic) no `style.css` (§4.8) | G7's tray half, G11's texts | Sonnet |
| **H** host | `main.js` (`isKitDev` / `kitDevs`; the render branch → kit-ui; the `'pm'` dispatchers, `size` / `rackLayout`; Tidy and the first view; drops, replace, add, remove, TYPE, kit load, Reset, Clear all; `edit` with `kitBack`; `kitKnob`; keepDevs for the kit; reconcile after a restore; `drumAudible`'s branch; the Ducker's and the Marks menu's names (`drumRowsOf`); `heavyOf`'s `'kit'`; `rigMark`; toV1's line; `__synthTest.cv.kit`), `roll.js` (`drumRowsOf(dev)` passes `dev.drum`), `cv-pads.js` (orderOf / defaultsOf / lookOf for a kit), `tests/canvas-DM-sim.test.mjs` (new), the pins in tests/main.test.mjs / roll.test.mjs / cv-pads.test.mjs | G6, G7's flows, G4's host part (Ducker, Pads, roll, marks) | Opus 5.5 |
| **G** frame harness (skeptic: new, LC's G6 shape) | `tests/ui-bench-wc.mjs` + `.test.mjs` (`kitS`, `kitX`), `tests/ui-bench-fps.mjs` + `.test.mjs` (the `kit` scene); runs them, records `ui-DM-mac` (the lead commits bench.json) | G9 | Sonnet |
| reviewers × 2 (phase 3, ∥ G) | (1) **the real engine + sim** (Opus 5.5): G1–G6, G12, adversarial — hostile records (a 909 record on a kit, a `vl` of the wrong length, `ty` against vals), 16 voices in one choke group at 300 BPM, undo storms on the grid, 808 ↔ kit ↔ Wavecraft switches mid-ring, OS changes / power / mute / panic mid-ring, bounce = live, a kit in a 17 build (read-only); (2) **headless Chrome for Testing** (Opus 5.5): G7–G11 at the three sizes, touch-emulated, downloads denied | — | — |
| fixer | the finding's files, the failing test first | | Sonnet / Opus 5.5 |

Then one sweep (`tools/sweep.sh <worktree> <scratchpad out>`: every test file, one at a time), the contact sheets to the user, the
deploy (squash onto `canvas`, `tools/deploy-canvas.sh`), the user's hands-on — their feel decides cut 2's shape.

### 9.2 Interfaces (fixed here)
- **DrKit** (`kit-dsp.js`): `create(inst, 'kit') → machine` — `set(drum)` (a KitP; the lane states in §13 how it re-reads per span),
  `setOS(os, fs)`, `hit(slot, v127)` (a note through the map), `trig(mask, vl, o)` (a step: lane j = slot j, `vl[o + j]` its velocity),
  `render(buf, N, F0)` (adds the live instances into the mono OS-rate bus), `post(L, R, mono, n)`, `poll(F0)` (nothing), `live()`,
  `reset()`, `mon() → { lit: 16 bits, act: Float32Array(16) }`, `smp(slots)` (stored, inert in cut 1), `setSalt(s)`, (skeptic) `_v` (its
  instances, each with `.on`: the engine's CPU count, engine.js:2576 [R]); `DrKit.gain()` → 1, `DrKit.TYPES` (the copy G-tested
  against kit-core's), `DrKit.VER`.
- **kit-core** (a leaf): `KIT`, `normKit(d)`, `initState()`, `press(S, D, input)`, `leds(S, D)`, `compilePlan(D, S)`, `payload(D, S,
  at)`, `toNotes(plan, opts)`, `names(D)`, `rows(D)` (the roll's `{ n, s, name }`), `reconcile(vals, D)`, `noteFor(type, map)`,
  `typesOf(vals)`, `audible(D)`. (skeptic) No `types` argument anywhere and no `hitsIn` (§3.6, §6.2).
- **drum-core**: every exported function dispatches `'kit'` to kit-core by the record's `m` (as `is606 / is909 / isV`) or, for
  `toNotes`, by `plan.vl`; `drumRows(map, model, D)` (the four ignore `D`).
- **DrSeq**: the plan's optional `vl` (Uint8Array, 16 a step), checked by `valid`; without it, every line as today.
- **kitHost** (§4.6) and **`__synthTest.cv.kit`** (§6.1).
- Messages: none new — the family's `{ t: 'patch' }` (machine 'kit', a KitP) and `{ t: 'seq' }` payload.

### 9.3 Rules
`?v=9` on every import; new test files `import './v8-guard.mjs'` first and use the app's `?v=` suffix; never a fake-DOM node in `assert.*`
((skeptic) `safeAssert` from tests/serum-ui-stubs/dom.js:20, as rig-ui.test.mjs:33 uses it — serum-ui.test.mjs left with SX0); one test
file at a time with `--max-old-space-size=2048`; no lane commits `sw.js`; no lane edits another's file (phase 0 put `kit-dsp.js` on every
DSP list; kit-ui injects its own CSS; nobody edits cv-module.js or style.css); headless runs use Chrome for Testing with its own
`--user-data-dir` in the scratchpad and downloads denied; browser first (no iPad app build; its node tests stay in the sweep); a layout
number lives only in rig-grid.js; every voice law lives in `KIT.TYPES` (kit-dsp.js's copy compared by a test).

### 9.4 Pins that move by design (skeptic: re-listed on ⟨B⟩)
MODELS 18 → 19 (tests/rig-model.test.mjs:176–177; cv-art / cv-tray read `MODELS.length`); cv-tray's Drums view (sections, tiles, tip);
cv-cost's rows (tests/cv-cost.test.mjs:92); cv-migrate's 17 → 18 (tests/cv-migrate.test.mjs:32, 1341, 1485, 1703, 1862; canvas-8-sim:418,
canvas-M-sim:339, 353, canvas-9-sim:447, canvas-9b-sim:438; the 7a / 7b / 7c sims read `CM.SCHEMA + 1`); engine-track's warm-up machine
lists (:1403, :1678 → `,kit`); the DSP lists (tests/app.test.mjs:165 18 → 19, wk.test.mjs:2327, sx-base.test.mjs:428, cv-cost.test.mjs:437;
bench.test.mjs:121 follows dsp-scope); lint (`?v=9` on the new files); pwa (the new files precached). **Not changed**: every golden and
frozen ref; drum-core's four-machine pins; DrSeq's existing tests; canonical-stream; cv-mods' class table (the kit is skipped);
tests/modcore.test.mjs:87 (kit-dsp.js before dr-seq.js); the skins' gate (no style.css change).

### 9.5 Docs (the lead, at the end of each cut)
ROADMAP row 19 (status, the user's answers and feedback), HANDOVER (§3 an item; §4 kit-core / kit-dsp / kit-ui, DrSeq's `vl`, the record,
`kitBack`; §5 lessons), `tests/ref-DM/` frozen, bench.json's rows and `ui-DM-mac`.

---------------------------------------------------------------------------------------------------------------------------------

## 10. The cuts

**Cut 1 — playable (this contract's lanes).** The kit tile and six voice tiles in the Drums view; the Sequencer and the voice modules in
the Wavecraft look; six synthesized types; the Starter kit on an empty grid (skeptic: the user's answer); four kits (+ the user's own); patterns A–H of 1–16 sixteenths;
per-step on / off and velocity (drag, long-press presets); swing; mute / solo; choke groups; HIT pads, row lamps and the playhead at the
heard time; follows the song's ▶ and tempo; roll notes, MIDI, the keyboard and Pads play it (named rows); a Ducker follows its kick; the
Combiner's marks read it; ↶ for grid edits; schema 18; the test hook and anchors for row 20 (§6.1). **Not in cut 1**: stereo pan, samples, cords, modulation onto its knobs (refused
with its text), step chance / repeats / nudge / pitch (held in the record), recording into the grid, → Piano roll, longer patterns,
(skeptic) a demo beat (`KIT.DEMO` null), the tutorial's `kitApi` events (row 20's contract), the 808's undo rule on the kit.

**Cut 2 — after the user's hands-on** (no schema change: the record already holds every field):
- your own samples — a **Sample** type (LOAD in its head, the family's importer, slots and `needs`; TUNE ±24 st, DECAY as a fade, START,
  REVERSE);
- step extras in the long-press menu and an edit lane under the grid: **chance** (fixed per song position — the same on every play and in
  the bounce), **repeats** ×2–×4 within the step, **nudge**, **pitch**;
- **→ Piano roll** (the family's toNotes, one step "Pattern to notes"), copy / paste patterns, rename voices, reorder rows;
- longer patterns (32 / 64 steps as pages) and the triplet / 32nd scales (the family's codes);
- **per-voice PAN** — a stereo voice bus in the drums path (engine work: the fade, tail and switch paths in stereo; its own gate);
- **modulation onto kit knobs** (the class table's row, halos, the knob menu's Connect to…, MIDI learn);
- **REC**: pads and keys write into the grid while playing (the nearest step);
- **cords**, if Q3 says so: a row's trigger OUT by its lamp, a voice's TRIG / CHOKE inputs with printed normals, layering (the record's `tr`);
- the light-show skin's pulses on the lamps (WC-2; (skeptic) that skin is not built yet — HANDOVER §0's queue item (3));
- (skeptic) a gliding playhead (a `wk.clock` client as LC's, §4.2) if the stepping one feels wrong.

**Later**: per-step parameter locks (row 21's automation model), pattern chains / a song mode, per-row lengths, more types (metal /
cowbell, cymbal, FM, a pitched bass kick played by notes), a kit browser, a kit lane as a modulation source on other tracks (needs a
cross-track source).

---------------------------------------------------------------------------------------------------------------------------------

## 11. Questions for the user (asked 2026-11-01; answered — the last section; the body follows the answers)

Short ones, each with my first guess. "Yes to all" works; every answer can change after you've played it.

1. **Name.** I'll call it "Wavecraft Drums" for now — one line to change later. OK?
   *First guess: yes.*
2. **Layout.** One big step grid, with one small module per drum (Kick, Snare, Hi-hat…) under it, like Wavecraft's modules. The other way
   is everything in one big module.
   *First guess: a module per drum.*
3. **Cables.** No patch cables at first: each drum plays its own grid row and goes straight to the mix. Cables (layering two drums,
   chokes) can come later.
   *First guess: no cables at first.*
4. **First sound.** A new drum machine starts with a simple beat you can play right away with ▶ (pattern A; B–H empty). The other way is
   an empty grid.
   *First guess: a simple beat.*
5. **Sounds.** The first version has our own built-in drums, made by synthesis (nothing recorded or copied). Loading your own samples
   comes in the second version.
   *First guess: yes.*

---------------------------------------------------------------------------------------------------------------------------------

## 12. Known limits (recorded)
- Mono in cut 1 (per-voice pan is cut 2's stereo voice bus).
- One instrument per track (1f): the drum machine is its own track; Wavecraft meets it through a Ducker and (skeptic) the Combiner's marks (LC, shipped).
- 16 drums, 8 patterns, 16 steps a pattern in cut 1 (the family's 16-wide payload; steps grow in cut 2).
- No modulation onto kit knobs in cut 1 (refused with its text, D5: nothing hidden).
- The voices follow §2's laws, not anyone's ear: the user decides by listening when they like; a retune is a lead's re-freeze of ref-DM
  with a note (never a loosened gate).
- A 16-voice kit (≈ 2 700 painted elements) passes the touch notice's line (2 048, PT_HEAVY's, through `heavyOf`'s new `'kit'` kind): the
  notice shows once a session, on touch.
- The classic ↔ drums switch step (ROADMAP's known engine issue, :127 [R]) applies to the kit as to every drum machine.
- ↶ differs from the four classic machines' (decision g); (skeptic) the other rule is cut-2 work, not a flip.
- (skeptic) A kit project opened in a tab that has not updated (schema 17) opens read-only (§5.6) — one Reload.
- (skeptic) A Pads pad that targets a voice later removed plays nothing and warns (Remove frees the voice's note: pads-core `drumNote`'s
  'unmapped' rule, pads-core.js:216–231 [R], as for a machine whose MAP… lost a sound).
- No free-running tempo: the machine always follows the song.
- (fix round, R2-5) A second finger landing more than 250 ms into a paint / a velocity drag (past gesture.js's PAIR_MS pairing, which
  every machine shares and stays as it is) reverts the gesture when it lands on the Sequencer's face (kit-ui: no edit, no step), but the
  pinch does not start late; a second finger off the face (the empty canvas, a voice face) pans as a second hand and the paint commits.
- (fix round, left) R2-8: a ⏮ seek while playing hides the playhead at the press, 3–4 frames before the heard jump.
- (fix round, left) R2-10: a TYPE change keeps a set name (the Starter's "Rim" turned Tom reads RIM) — §5.2's rule.
- (fix round, left) R2-11: a pattern switch while playing shows the new pattern's button and grid at once (heard at the bar's end); no
  pending mark yet — a follow-up.
- (fix round, left) R2-13: a voice's ⋯ (Remove / Reset sound by touch) is 32 × 32 (28 × 32 at p): cv-module's compact bar, shared.
- (fix round, left) R2-14: under load the playhead is 2 frames late on 1–3 % of frames (16 × 16 at 240 BPM, tempo changes, a hidden tab).
- (fix round, left) R2-15: in ivory, mid-play, the HIT text is 4.16 : 1 for the 0.2 s of its flash (5.23 : 1 stopped).
- (fix round, left) The touch heavy notice never fires for a kit alone: 16 voices paint ≈ 1 664 elements, under PT_HEAVY's 2 048.
- (fix round, left) A tap on a greyed voice tile (16 voices) shows no notice (the "+ Add drum" row and kitAdd say "16 drums is the most").

## 13. Notes (the builders fill in)

### Phase 0 (the lead, 2026-11-03, wt-DM on 8d62d18: 55b4285 the failing tests, 9f8f0ab the code + sw.js) — the builders reset to 9f8f0ab's successor (this note's commit)

**What is in, per file.**
- `kit-core.js` (new leaf, no imports): `KIT` — WORD 'Drums', ID 'kit', SLOTS 16, CODES ka…kp, **FIELDS** `t u d l c 1 2 3 4` and **IDS**
  (the 144 control ids, slot-major: models.js's order = KitP's), TYPES (index = the TYPE value, `TYPES[0] = null`; each `{ n, id, label, u, d,
  k: [4], bright, blk }`, every knob `{ id, label, law: exp | lin | int | bal | drive, lo, hi, unit, def }`, times in s; `blk` the blocks'
  constants: the Kick click's 4 ms / 2 kHz, the Snare's 1.594 / 12 % / 8 ms, our hat ratios + the band-pass at 1.5×, the Clap's Q 1.4 / 0.2 ms /
  2.5 ms, the Tom burst at 2f / T60 ÷ 4, the Perc's 1 ms burst / 15 ms bend), **LAW** (§2.1: att 0.3 ms, vPow 2, vBright 0.2, lRef 0.7, drive
  A 0.8 g0 0.01 g2 6, sleep 1e-5 × 4 chunks, flush 1e-30, chunk 4), STARTER (8 voices `{ t, n, nm, c, u, d, l, k }`), DEMO null, KITS
  (Starter / Deep / Tight / Crunch, each the full 144 values), VEL, NOTES (by type) + **NOTE_FREE** 60, CHOKE_MS 3, TINT (by type). `lawVal(L, x)`
  (a law at a position, clamped; NaN → the default). `normKit` complete (§5.3). Lane S's functions as **stubs with their shapes** (initState,
  press → `{ state, mem, cmds: [] }`, leds → `{ step: −1, lit: 0 }`, compilePlan → an n-0 plan, payload (m 'kit', pk 'k0', no notes), toNotes /
  rows → [], names → 16 × '', reconcile → D, noteFor → −1, typesOf → 16 × 0, audible → 0).
- `models.js`: `kit` = MODELS[18] (19 models), `name: RIG.NAME + ' ' + KIT.WORD` (the one line), no maker, 16 sections "Drum n" × 9 controls
  (TYPE / CHOKE switches, the rest knobs 0–10; defaults = `KIT.KITS[0].v`), presets `KIT.KITS`, map → `{ engine: 'drums', machine: 'kit', drum:
  knobs / 10 + indices, level: 1 }`; `isKitModel`.
- `drum-core.js`: imports kit-core (`KC`); PERS.kit (sounds = CODES, names 'Drum 1…16', sids 0–15, mask 0xFFFF, no default notes) / MAPS.kit;
  `mach()` five-way; `isKit(D)` exported; dispatch in normDrum, compilePlan, toNotes (on `plan.vl`, after the 909's `mSh`), payload,
  initState('kit'), press, leds, rollPlan, rollOpts (`{ swing, prim }`), drumRows(map, model, D) (a kit without D: `KC.rows(normKit({ map }))`);
  inline bodies: gridPat = `D.ui.pat`, stepLen = a 16th, demoFree = the selected pattern empty, freeBpm 120, withTempo the identity.
- `cv-mods.js`: `noClassic` + `isKitModel`; `NOMOD_KIT`; destOk refuses every kit id before the class table. `cv-migrate.js`: SCHEMA 18,
  STEPS[17] the identity, the header's 18 line. `cv-cost.js`: `COST.synth.kit = C('dkp', 'drums', 1, 0.0090, 0.0030)` (placeholder = the dkp
  budget); its worker list. `cv-art.js`: `SIL.kit { box, steps 16 }` + a placeholder `DRAW.kit` (a cell screen over four faces).
  `cv-tray.js`: `DRUMS` excludes the kit (deviation 3).
- `kit-dsp.js` (stub: one IIFE, frozen `DrKit { VER: 1, create → null }`) after dr-808.js in main.js DSP_FILES, cv-cost.js's worker,
  smprender.js, wk.js DSP_GLOBALS (+ its "files 1–18" comments), tests/golden-harness.mjs DSP_V2, tests/dsp-scope.mjs DSP_TABLE, tests/bench.html.
- `tests/kit-core.test.mjs` (new, 16 tests), `tests/kit-fixtures.mjs` (`GROOVE`: the §5.7 pattern in the record's shape on the Starter's
  slots), `tests/ref-DM/README` (empty dir), sw.js (`node tools/precache.mjs --write`: kit-core.js and kit-dsp.js precached).
- dr-808.js, dr-seq.js, engine.js and every frozen ref untouched.

**Pins moved** (each its value; messages that print the number follow it): rig-model :176 (19 models); cv-migrate :32 (SCHEMA 18), the
`[SCHEMA, STEPS.length]` pins :1059 :1150 :1236 :1333 :1477 :1647 :1744 :1852 (18), the saved-schema pins :1063 :1154 :1240 :1337 :1481 :1651
:1699 :1850 (18), "older ones" :1243 :1340 :1484 (18), the store's `newer` :1659 :1752 (18), the newer files :1341 :1485 :1703 :1862 (19), the
readOnly sweeps :1065 :1156 :1242 :1339 :1483 :1653 :1747 (their last entry 18 → 19), :1844 / :1845 (the "already at SCHEMA" copy: 18), :1851
(compared through STEPS[17]); master-mods-model :22 :26 :28 :29; canvas-8-sim :405 :417–418; canvas-M-sim :339 :342 :345 :352–353; canvas-9-sim
:436 :446–447; canvas-9b-sim :438; canvas-7c-sim :643 :655; drum-core :2929 (PERS + 'kit'); app :165 (19 modules); main :52–54 (19 modules,
mod-core at 14, engine at 18); wk :29 (+ DrKit) :2327 :2361 (17 injected) :2378 (9 errors of 17); sx-base :428 :430; cv-cost :437 :442 (16
URLs); canvas-3-sim :134 (18 globals); the sims' DSP-global stand-ins (+ 'DrKit' in 17 files: app-midi, canvas-3 / 7a / 7b / 7c / 8 / 9 / 9b / 9c
/ LC / M / MOD1 / WC / del / tab, m3-fixture, safe — without it wk.loadDSP injects kit-dsp.js into the fake DOM and waits); cv-mods :14 (its
CLASSIC mirrors noClassic: the kit out); cv-tray :844 (`drums` without the kit); integration :658 (the every-model render skips the kit).
Not moved: every golden / frozen ref, engine-track (its warm-up machine pins wait for V's kit round), modcore :87, the skins' gate.

**Deviations from §9.0 (with reasons).**
1. **9 controls a slot, 144 values, not "10 / 160"**: §5.1 counts ten, §5.2 lists nine ids (TYPE TUNE DECAY LEVEL CHOKE k1–k4) and §4.3's face
   has nine; built §5.2. `KIT.IDS` / `KIT.FIELDS` are the source (KitP, dkx, the faces). A tenth (PAN, cut 2) = a field + the model's wrapper fill.
2. KIT gained `FIELDS`, `IDS`, `LAW`, `NOTE_FREE` and the helper `lawVal`; TYPES / NOTES / TINT are indexed by the TYPE value (0: null / [] / null).
   §9.3's "every voice law in KIT.TYPES" read as TYPES + LAW (§2.1's common laws): V's copy compares both.
3. `cv-tray.js` (U's file) got one condition: `DRUMS` excludes the kit, so the kit is in no tray view in phase 0 and the Drums view is byte-identical
   (no sim drops a kit tile before kit-ui exists). U builds its sections on that filter (§4.7's line).
4. `NOMOD_KIT` = 'The drum machine’s knobs take modulation in its next update' — the contract's words with the file's typographic apostrophe.
5. normKit's own bounds: `sc` fixed 3, `x.sync` true / `x.rec` false fixed, mute / solo / tr: a non-negative integer & 0xFFFF (else 0 / the
   identity — the family's maskIn wraps negatives), a neutral `c r n p` dropped (one canonical form), the first of a duplicate cell kept.
6. STARTER's [C]s: notes 36 38 39 42 46 45 50 37 (Low tom 45, High tom 50: GM's), names '' for Kick / Snare / Clap (automatic) and 'Closed hat',
   'Open hat', 'Low tom', 'High tom', 'Rim'; the open hat DECAY 0.6, toms TUNE 0.3 / 0.55, Rim DECAY 0.15 / CLICK 0.6; an empty slot's vals TUNE 5,
   DECAY 5, LEVEL 7, CHOKE 0, k 5. KITS: Deep / Tight / Crunch as position deltas on the starter. The model's character knobs carry neutral
   labels ('Character 1…4': a slot's type names them, KIT.TYPES); its theme copies the rig's chips.
7. toV1 needs no line of its own yet: `isDrum('kit')` puts a kit track on the family's generic lost line ("<NAME> track “X”: the live site has no
   drum machine — its piano-roll notes are kept"); §5.6's own words are H's / S's if wanted.
8. Two expectations of the failing-tests commit were my rounding (§2.2's printed values): corrected to the laws' exact values in 9f8f0ab.

**Tests run** (one file at a time, `--max-old-space-size=2048`; 81 files, 2243 / 2243 green): kit-core 16, drum-core 153, dr-seq 47, cv-mods
21, cv-migrate 77, cv-cost 18, cv-art 7, rig-model 11, master-mods-model 4, lint 175, pwa 25, cv-tray 59, modcore 26, app 11, wk 115, sx-base
23, bench 6, roll 60, main 50, pads-core 23, fx-ui 80, smpgen 14, sx0-model 3, integration 44, golden-drums 5, golden-606 11, golden-909 9,
golden-sdsv 5, golden-graph 6, golden-classic 8, golden-fx 3, engine-track 107, canonical-stream 1, the sims (cv-shell 19, canvas 25, -3 25,
-1e 24, -1i 20, -2a 26, -2b 24, -7a 24, -7b 15, -7c 13, -8 17, -9 22, -9b 15, -9c 3, -M 21, -M-bounce 1, -MM 24, -MOD1 30, -P 15, -SC 15, -WC
51, -LC 20, -FR 15, -del 11, -tab 8, safe 6, safeguard 10, app-midi 7, cv-fixes 5), m3-fixture 13, accessors 29, app-shell 19, assets 38,
classic-mod 18, classic-panel 15, cv-drum 66, cv-graph 37, cv-graph-engine 5, cv-face 45, cv-patch 31, cv-panel 111, fast-lane 14, graph-host
22, inst-denormal 7, lc-engine 19, presets 2, rig-sound 9, sidechain-dsp 9. Not run: the rest of the sweep (the lead's).

**For V.** kit-dsp.js's body replaces the stub (keep the IIFE, `VER`, the frozen global, null on failure; it is already on every list); KitP /
the 160 → **144** ids in `KIT.IDS` order; `DrKit.TYPES` (+ `LAW`) = kit-core's, compared by a test; drOn / drGain: today `Dr808.create(…,
'kit')` returns null (the stub path); **drop the kit skip in tests/integration.test.mjs:658** when the kit sounds; engine-track's two `,kit`
pins and DrumP's shape pin are yours; cv-cost's dkp numbers are placeholders (0.0090 + 0.0030); `KIT.OUT` (§2.1) is not in kit-core —
put it in kit-dsp.js's copy or ask S for the key (kit-core is S's file).
**For S.** Replace the stubs (their shape test in kit-core.test.mjs stays valid; extend it); drum-core's inline kit bodies (gridPat, stepLen —
swung 16ths —, demoFree) and drumRows' D-less fallback are yours to refine; the 808 `press`'s session guard (drum-core :~835, `S.m ===
'tr909' || 'sdsv'`) does not yet convert a kit session; `normKit` is done (bounds above) — reconcile writes `ty`; pads-core `soundName`'s PERS
loop names ka…kp 'Drum n' until it takes D; kit-fixtures' GROOVE is on the Starter's slots 0–7.
**For F.** KIT.TINT passes ≥ 3 : 1 on the three `--rig-screen`s (min 3.24 on ivory; kit-core.test checks it); the faces' labels / readouts come
from KIT.TYPES (the model's are neutral); TYPE 0 is an empty slot.
**For U.** The kit is in no tray view (deviation 3): add its sections and tiles; cv-tray.test :844's `drums` filter already skips it; SIL.kit /
DRAW.kit are placeholders to replace (cv-art's tests pass on them).
**For H.** The model, the record, the dispatch, schema 18 and the DSP lists are in; `isKitModel` (models.js) / `DC.isKit` (records) for the
`isKitDev` sites; the kit is silent until V (create → null).

### Lane V (2026-11-03, dm-V on d60f174: b9c910f the failing tests, 8d71421 kit-dsp.js's body, 72336ec engine / cost / bench, this note's commit)

**What is in, per file.**
- `kit-dsp.js` (the body; the stub's IIFE, `VER` and null-on-failure kept): the frozen `DrKit { VER, create, gain() → 1, TYPES, LAW, CHOKE_MS,
  lawVal }` — TYPES / LAW / lawVal are kit-core.js's lines 53–112 verbatim (tests/kit-dsp.test.mjs compares TYPES, LAW, CHOKE_MS by JSON and
  lawVal on 9 positions × every knob). `create(inst, 'kit', opt)` (another kind → null) → `set / setOS / hit / trig(mask, vl, o) / render /
  post / poll / live / reset / mon / smp / setSalt`, `_v` (the 32 instances, slot j's at 2j / 2j + 1, each `.on`), `_M`, `_smp`, `_mach:
  'kit'`. Inside: `Voice` (one fixed shape for every type), `fire` (the slot's nine read at the hit's chunk → the laws, rate-free) → `prep`
  (the rate-dependent coefficients; setOS reruns it on the ringing instances, their ages rescaled), `segKick / segSnare / segHat / segClap /
  segTom / segPerc` (the per-sample loops), `ctl` (a sweeping instance's chunk step: the sweep term at the chunk's middle), `run`
  (segments cut at chunk boundaries while sweeping, at the end, at the fade's end; a fading instance through the scratch span × the 3 ms
  raised cosine), `apply` (every fade first — the retrigger's own slot, the choke groups —, then the starts). Our constants: `OUT` 1 (§2.1's
  KIT.OUT lives here, not in kit-core: phase 0's note), `TRIM` by type [Kick 1.08, Snare 0.8, Hi-hat 1.2, Clap 0.85, Tom 0.9, Perc 1.5],
  `KIT_SALT` 0x6B697421, the Tom burst's band-pass Q 1.5, the Perc's noise-strike scale `KN`.
- `engine.js` (§7.1, additive, guarded by the machine id): `KitP` (one `Float64Array(144)` in KIT.IDS order — engine's `KIT_IDS`, the same
  codes × fields; a missing id NaN) beside DrumP (untouched, its shape now pinned); PatchP's `drum` = `machine === 'kit' ? KitP : DrumP`;
  `drOn` / `drGain` take the factory by id (DrKit for 'kit' — a missing one: drFail, drumsErr once); `warmDrumsK` after `warmDrumsV` inside
  warmDrums' try (`WDRUMK` two 16-voice panels, `WMAPK` / `WPRIMK` notes 36–51, `WPLANK` empty / `WPLANK2` a two-step plan with `vl`).
- `cv-cost.js`: `COST.synth.kit = C('dkp', 'drums', 1, 0.0037, 0.0030)` (= dkp's measured 0.0066–0.0067 calibrated) and its header row.
- `tests/kit-dsp.test.mjs` (new, 22), `tests/golden-kit.test.mjs` (new, 3: the manifest test fails with the instruction until recorded),
  `tests/engine-track.test.mjs` (+10 DM tests, one a todo; the two `,kit` warm-up pins), `tests/bench-scenarios.mjs` (`kitTrack(groove,
  vals, o)`, `DKX_VALS`, `DKX_GROOVE`, rows dkp / dkx), `tests/bench.json` (targets dkp 0.012 / 0.012, dkx 0.06 / 0.06, dki 0.0005 / 0.001;
  no measured row), `tests/integration.test.mjs` (:658's kit skip dropped: every model, the kit included, renders through the rack).

**[C]s refined (each with its reason).**
1. **set(drum)** stores the KitP; a hit reads its slot's nine at the chunk it applies in and keeps them (a turned knob acts at the next hit,
   no glide): every cut-1 knob is a hit's parameter, and modulation onto kit knobs is cut 2 (then a per-chunk read of the live instance).
2. **KitP = one Float64Array** (§7.1's option): a typed array never changes shape. The JSC A/B (below) covers every drum row.
3. **Perc**: the resonators' **low-pass taps** and the impulse a **doublet** (+v at the hit, −v half a period later). The band-pass tap
   jumps to its peak at the strike (the click §2.1 rules out: "the resonator paths start at rest"); the low-pass tap starts at rest but
   carries DC (1.3e-3 over the hit, the gate is 1e-3) — the doublet's sum is 0, so its DC is 0 and it still starts at rest (3.2e-4 left, from
   the noise strike). The noise strike: a 1 ms Hann burst scaled so its response ≈ the impulse's (KN).
4. **Hi-hat squares: a cubic B-spline BLEP** (a 4-sample residual per edge, the squares' sum 2 samples late) instead of the 2-sample
   polyBLEP: polyBLEP's aliases sat 35.8 dB under the harmonics at 48 kHz × 1 (gate 40 dB); the B-spline's 54.2 dB; the hat's cost 0.0025 an
   instance (≤ 0.003). Starting phases i/6 (the edges spread).
5. **The band-limiting measure**: the energy off the harmonics against the energy on them (held, steady, a Blackman–Harris window ± 6 bins),
   not "against the hat rendered naively at 16 × and decimated": the prewarped TPT filters' bilinear response at 48 kHz × 1 differs from a
   16 × render by more than −40 dB near 15 kHz (a filter difference, not an alias) and the noise differs by construction (a hash of the OS
   index); so the hat is measured on its squares (METAL 1) and the drive on a 61.3 Hz sine (48 kHz is a multiple of 60 Hz: its aliases
   would land on its harmonics).
6. **The noise paths' corners**: Snare COLOR and Clap TONE at their law (the Clap's low-pass read over its band-pass prototype); the Hi-hat's
   summed pair is at +2 dB at TONE (RING 0.3), so its −3 dB point is its prototype's (HP at TONE + BP at 1.5 × TONE, Q = RING: ≈ 0.6–0.9 ×
   TONE), gated within 10 % of that.
7. **The Clap's bursts**: maxima at i·s + the 0.2 ms rise (a burst starts at i·s and peaks when its rise ends).
8. **Brightness** (open point, below): §2.1's offset (0.2 · 27 / 127 = 0.0425 positions at v 127) is exact on every type (read back), the
   Kick's attack centroid rises × 1.074 (≥ 1.05 ✓), the noise types' only × 1.01–1.03 (Hi-hat 1.027, Clap 1.015, the Snare's noise path
   1.011) and the whole Snare × 1.000 (COLOR up thins its noise under the body): gated "brighter" for those, the 1.05 for the Kick. The
   centroid is the attack's (its first 5.3 ms: the Kick's click lasts 4 ms; over a longer window the body hides the click: × 1.03).
9. **The click bound** at an event inside a ringing voice: max step ≤ 1.05 × (the old sound's own + the new one's own max step, each
   rendered alone on the same frames, + peak / (0.003·fs)) — a drum's onset is its own signal (a 240 Hz kick from rest steps by more than
   a 60 Hz one), so "the steady signal's own step" is both sounds'; an idle slot's hit (it rang and slept) = a fresh hit, bit for bit;
   panic and power off through the Track; the switches below.
10. **Loudness reference**: the 808's **default groove** (BD on the beats, SD + CP on 2 / 4, CH eighths, v 100 — the 909's and the SDS-V's
    reference, engine-track 8 §12.4), not d8p: d8p's accents reach the limiter themselves (RMS −15.8 dBFS, its peak at the 0.891
    ceiling), so "within 1 dB of d8p, the limiter untouched" cannot hold for any machine. The RMS half is a **todo** (open point, below).
11. **The switches**: 808 → kit, kit → 909, kit → 808 within the click bound (× 0.53 worst); **909 → kit is the 909's own switch tail**
    (0.0262 — 909 → 808 and 909 → 606 the same, × 3.1 the bound): the family's path, recorded, not the kit's.
12. Sleep by **age**: an instance ends at the first chunk boundary past its slowest envelope's −100 dB point + 4 chunks (an overdamped Perc
    mode by its slow pole), its state zeroed — no level test, so span splits cannot move it, and nothing nears 1e-30 (the zeroing is the flush).
13. Noise density √(fs / 48 kHz) (the 808's rule): a noise path through its filters measures the same at every OS.
14. A retrigger with both instances busy cuts the one further into its fade; `hit` clamps v > 127 to 127; a `vl` shorter than o + 16 (or
    none) plays v 100 on every lane; an empty slot (TYPE 0) plays nothing and is not lit.
15. Test options `opt.hold` (every decay held at 1: the filter and band-limiting gates' steady state) and `opt.trace` (the envelope's first n
    samples per instance in `.etr`: the Clap's bursts).

**Measured** (tests/kit-dsp.test.mjs, every law at 48 kHz × 1 / 2 / 4 and 44.1 kHz × 1; the worst over the rates and the cases):
- **Kick** (3 panels × 4 rates): the end pitch after 10 τ 0.00 % (≤ 1 %), the first period against the law's integral 0.02 % (≤ 5 %), T60
  0.61 % (≤ 5 %). **Tom**: 0.00 % / 0.00 % / T60 0.20 %. **Snare**: the two modes ≤ 0.06 % (≤ 1 %), the body's T60 0.39 %, the noise's
  (SNAP) 0.12 %, COLOR's −3 dB ≤ 3.1 % (≤ 10 %). **Hi-hat**: T60 ≤ 0.37 %, the corner ≤ 2.5 % of its prototype's. **Clap**: every
  burst's maximum within 0.06 ms of i·s + 0.2 ms (± 0.1), the tail's T60 ≤ 1.6 %, TONE's −3 dB ≤ 1.6 %. **Perc**: both resonances
  ≤ 0.02 % (≤ 2 %), T60 ≤ 0.87 %, the bend's end pitch 0.00 %.
- **Band-limiting** (48 kHz × 1, held): the hat's squares 54.2 dB off-harmonic under on-harmonic (≥ 40), the Kick's drive at 1 89.9 dB
  (≥ 50). **Brightness**: Kick × 1.074, Hi-hat × 1.027, Clap × 1.015, the Snare's noise × 1.011, the Snare × 1.000 (refinement 8); the
  gain law (v / 127)² exact (1e-9). **DC** ≤ 3.2e-4 every type (the Track, its first T60).
- **Bench (node, calibrated, the M4 Max)**: **dkp 0.0066** (target 0.012), **dkx 0.0253** (0.06), **dki 0.00019** (0.0005) — the iPad
  targets = node's (§7.2; no measured `ipad` row until the consolidated pass). The family's rows in the same run: d8p 0.0198, d6p 0.0171,
  d9p 0.0169, dvp 0.0132.
- **COST**: kit = 0.0037 + 0.0030 = 0.0067 (dkp's). **Per instance** (§2.3, OS 4, 48 kHz, held, median of 5 × 1 s; informational):
  Kick 0.00035 (+ drive 0.0022), Tom 0.00082 (+ drive 0.0036; held: its noise burst never ends), Snare 0.00074, Clap 0.00069,
  Perc 0.00064, Hi-hat 0.0027 — against §2.3's 0.0008 / 0.0015 / 0.003 (the drives informational; ADAA1's ln cosh per sample).
- **Warm-up**: × 1.015–1.023 with the kit's round (gate ≤ 1.1; 1139 → 1154 ms); 9b's × 1.161 (≤ 1.22) and 9's × 1.306 (≤ 1.35) still hold.
- **Loudness** (the whole Track): the fixture groove −20.97 dBFS = **−1.6 dB** re the 808's default groove (−19.38) at 48 × 4 / 48 × 1 /
  44.1 × 1, pre-limiter peaks 0.758 / 0.857 / 0.779 (threshold 0.891); alone at v 100 / v 127: Kick 0.565 / 0.932, Snare 0.415 / 0.763,
  Hi-hat 0.223 / 0.467, Clap 0.271 / 0.392, Tom 0.435 / 0.667, Perc 0.421 / 0.544; DC ≤ 3.2e-4.
- **A/B against phase 0** (its engine.js and the stub kit-dsp.js, every other script current): V8 (bench-scenarios measure(), 7
  alternating pairs) d8p × 1.024 — an A/A pair of the same harness reads × 1.021 and the swapped order × 1.027 the other way (the second
  scope's bias, 9b's note), so ≈ 1.00 — d6p 0.989, d9p 1.006, dvp 0.998, d 0.972, mt 0.818 (0.0011 → 0.0010: its noise), r 0.998
  (≤ 2 %); JSC (the macOS jsc shell, an offline Track, 0.25 s pre-roll, the median of 5 × 1 s, 5 alternating fresh processes) d8p 0.997,
  d6p 1.008, d9p 0.998, dvp 1.004, c1 1.006, d 0.999 (≤ 3 %; mt not driven: its ModCore payload) — PatchP's `drum` holding KitP | DrumP
  costs nothing measurable; JSC dkp 0.0055.

**Tests run** (one file at a time, `--max-old-space-size=2048`): kit-dsp 22 / 22, golden-kit 2 / 3 (the manifest test: not
recorded — by design), engine-track 116 / 117 + 1 todo (the loudness RMS), golden-drums 5, golden-606 11, golden-909 9, golden-sdsv 5,
golden-classic 8, golden-fx 3, golden-presets 8, golden-random 1, golden-graph 6, golden-moog 6, golden-moog-b 6, golden-moog-c 4,
golden-lc 1, canonical-stream 1, rig-sound 9, sx0-model 3, master-proc 27, canvas-M-bounce 1, canvas-MM-live 1, canvas-SC-live 1,
patch-core 52, bench 6, cv-cost 18, lint 175, integration 44 — every one green but golden-kit's first. `tests/ref-WC/record.mjs`'s compare:
1 difference, `g1.drum:kit` — a fixture key base.json never had (phase 0's model; the record reads no DSP file). Not run: pwa (sw.js not
regenerated: the lead's), the rest of the sweep.

**Open points (the lead's).**
1. **G3's loudness RMS** (engine-track's todo): −1.6 dB. The Starter Kick (DECAY 0.45, T60 0.37 s) has a crest 4 dB above the 808's BD (peak
   0.523 at −2.6 dB less energy over 0.5 s at v 100), so the trims the peak gates allow (the Kick alone at v 127 ≤ 1.0, the groove under the
   limiter) leave the groove 1.6 dB short. Measured fix: the Kick's default DECAY **0.55** (kit-core TYPES[1].d.def, which STARTER takes; lane
   S / the lead — DrKit.TYPES follows by the copy) → **−0.41 dB**, the Kick alone at v 127 0.94 FS, the groove's peak 0.84, the same trims.
   Then drop the todo (the test is written to pass).
2. **Brightness** (refinement 8): ≥ 1.05 × for the noise types needs vBright ≈ 0.4 (Hi-hat: an offset of 0.08 → × 1.052) to ≈ 0.6 (Clap),
   and the Snare's bright knob (COLOR) lowers its centroid at the default TONE — TONE or SNAP would brighten it. kit-core's LAW / TYPES.
3. **cv-cost.test.mjs** (not V's file) has no kit case: a line as the SDS-V's (`estimate('kit')` ≈ 0.0067, under dkp's node target, mono).

**At integration (the lead).**
- Record **tests/ref-DM** ONCE on the merged tree (S's DrSeq `vl` in): `GOLDEN_FREEZE_DM=1 node --max-old-space-size=2048 --test
  tests/golden-kit.test.mjs`, then set `PIN` in tests/golden-kit.test.mjs to the manifest's hashes. Until then its first test fails with
  that instruction (checked here: the freeze writes the three files + MANIFEST and all three tests pass; the files were removed again).
- With lane S's compilePlan in: golden-kit's two step cases sound (their sound check is skipped while compilePlan is the stub), and
  `kitTrack` plays the groove as the kit's steps instead of roll notes (dkp / dkx then measure the DrSeq path: re-run engine-track's DM
  bench test); the warm-up's `WPLANK2` then runs `fireK`.
- `node tools/precache.mjs --write` (kit-dsp.js and engine.js changed; sw.js not committed here — pwa.test.mjs fails on the BUILD hash
  until then).

**For S / F / H.**
- **The machine**: `trig(mask, vl, o)` — lane j = slot j, 16 bits, bit 0 = slot 0 (no accent bit), `vl[o + j]` its velocity (1–127; 0
  nothing); `fireK` passes o = 16 × the step's index in `st`; a vl shorter than o + 16 → v 100 everywhere. `hit(slot, v127)` for notes
  (drHit maps through the payload's `map`: before a kit payload arrives the map is DrSeq.DEF_MAP — the 808's sound ids — so the payload
  must carry the kit's map; tests here build it by hand while S's payload is the stub). Hits latch per chunk, the highest velocity wins.
- **KitP** (engine side only): `p.drum.v`, Float64Array(144) in KIT.IDS order — the main side keeps models.js's flat object; TYPE / CHOKE
  rounded (TYPE outside 1–6 = empty; CHOKE outside 1–4 = none), positions clamped, NaN → the knob's default, LEVEL NaN → 0.7.
- **mon()** → `{ lit: 16 bits (the slots hit since the last mon), act: Float32Array(16) }`, act = each slot's level at its spans' starts
  since the last mon (full scale: the hit's gain × its main envelope × the fade) — drMon posts it as the family's `{ lit, act, F }`.
- **The velocity law**: gain (v / 127)² × (LEVEL / 0.7)²; the type's bright knob + 0.2 · (v − 100) / 127 positions (clamped); a hit reads
  its slot's panel at its chunk; chokes by the slot's CHOKE at the hit (an instance keeps its group); two voices of one group in one chunk
  both sound.
- **Levels** are DrKit's (OUT, TRIM): no face shows them; LEVEL 0.7 = the trim's 0 dB.
- **H**: a kit Inst without kit-dsp.js posts drumsErr once (as the 808's family); `_mach: 'kit'`, `_v` for the CPU count.
### Lane S (2026-11-03, dm-S on d60f174: fb8716b the failing tests, 7696b4f the code)

**What is in.**
- `kit-core.js`: `starter()` (new, below) · `typesOf` · `noteFor` · `names` / `rows` · `audible` · `reconcile` · `compilePlan` · `payload` ·
  `toNotes` · `initState` · `press` · `leds` (the stubs replaced; still a leaf — no import).
- `dr-seq.js`: `valid` checks `vl`; `fire` takes the kit branch on `vl` before the family's `& 0xFFF` / `& 0xFFE` → `fireK(mask, vl, o)`
  (`dm.trig(mask, vl, o)`, `drStep` the lowest primary / the highest velocity ÷ 127, `drNote` once per sounding slot with its primary and
  velocity ÷ 127); the header's DM paragraph.
- `drum-core.js`: the 808 `press` guard converts a kit session (`|| S.m === 'kit'`); `stepLen` swings a kit's 16ths (`stepLenK`: the
  heard pattern's LENGTH, its last step back on the beat); `drumRows(map, 'kit')` without a kit record lists every mapped slot under
  PERS.kit's names; the header. Every other dispatch line is phase 0's (they already called kit-core).
- `cv-drum.js` (host only): `machOf` / `sessOf` five-way (`fresh` follows `machOf`); `khSync` keeps a kit session's held HIT notes.
- `pads-core.js`: imports kit-core's `names`; `soundName(s, model, D)` / `soundShort(s, model, D)`; `drumNote` (a kit slot only while its
  voice is present; a kit's result carries `D`); `resolve`'s warning and `targetLabel` name the voice from the record; `sidOrder` lists a
  kit's present voices.

**[C]s refined (with reasons).**
1. `starter()` exported: the tile's record (KIT.STARTER's types, notes 36 38 39 42 46 45 50 37 and names, an empty grid). `reconcile` from
   vals alone gives the open hat 44, the high tom 41 and automatic names; §3.5 fixes the starter's — H builds a new kit from it.
2. Payload `bpm` 120 (constant), not the session's: a synced machine never reads it, and the project tempo then never moves `pk` (no resend
   per tempo change).
3. Mute / solo as §3.4 says (`mute | ~solo`): a muted voice stays muted when soloed — unlike the 808's solo-wins `audible`.
4. §3.8 additions: `hit { lane, off: true }` (the HIT pad's up; the session's `hits` [[lane, slot]] hold the note — the 909's idiom; the
   host's `khSync` ends it at release / panic / a fresh session), `start` (→ `{ c: 'play' | 'stop' }`), `release`. A cell / paint on an
   empty slot's row or past LENGTH does nothing; `clear` / `clearAll` keep the lengths; `voice add` keeps a slot's kept note (else
   noteFor's) and clears its mute / solo bits (so does `remove`); `paint`'s v 0 paints off.
5. `leds.lit`: the heard step's audible voices in the heard pattern (`pos.k`), from the record — the lamps' fallback between monitor posts.
6. `drumRows(map, 'kit')` without the record: every mapped slot as "Drum n" (phase 0 returned none — a roll before H passes `dev.drum`
   showed no rows).
7. `drumNote` on an empty slot: `'sound'` ("No Drum 10 on “X” any more"), not §12's `'unmapped'` — the voice is gone, not unmapped; a
   present voice without a note stays `'unmapped'` ("Clap has no note on “X”").
8. `names`' ordinal counts the type's automatic names only (a named "Low tom" beside an automatic tom: "Tom", not "Tom 2").
9. `noteFor`: after 60…127 it searches down from 59; −1 only when all 128 are held.
10. `typesOf`: a missing / bad TYPE is the model's default (the Starter kit's: the model wrapper's fill), so `typesOf({})` = the Starter's.
11. `valid`'s `vl`: exactly a Uint8Array (by its `toString` tag: a plan built in another realm passes — node tests, structured clones),
    ≥ 16 · mOff[n]; `vl: null` reads as no kit plan.
12. `fireK` skips `dm.trig` on an empty step (the family's: `mask & 0xFFE`); the post is sent as for every step.
13. `compilePlan`'s memo ignores S (the kit's plan needs no session); `rollPlan` = `compilePlan`.

**Tests run** (one file at a time, `--max-old-space-size=2048`): kit-core 33 / 33 (16 phase 0 + 17), dr-seq 52 / 52 (47 + 5), drum-core
156 / 156 (153 + 3), pads-core 26 / 26 (23 + 3), cv-drum 68 / 68 (66 + 2); golden-drums 5, golden-606 11, golden-909 9, golden-sdsv 5,
golden-lc 1, engine-track 107, integration 44, main 50, roll 60, cv-pads 31, cv-cables 70, cv-keys 25, sidechain-dsp 9, lc-engine 19,
canonical-stream 1, lint 175, bench 6, modcore 26, canvas-7a-sim 24, -7b 15, -7c 13, -8 17, -LC 20, -SC 15, app-midi-sim 7 — all green;
pwa 24 / 25: only sw.js's BUILD hash (25 / 25 after `node tools/precache.mjs --write`, reverted — sw.js is the lead's).

**The four machines' pins untouched**: drum-core's 153 older tests (the 808 / 606 / 909 / SDS-V digests, records, sessions, payloads,
plans, pk, notes) and dr-seq's 47 green unchanged; ref-7a…7d (golden-drums / -606 / -909 / -sdsv render their frozen dr-seq.js against
the tree's) exact; `fire`'s 808 / 606 / 909 lines run as before (`vl` absent → the same mask expression, the same branches).

**For V.** The plan (kit-core `compilePlan`): `{ key, shape, n: 1, intro: 0, loopFrom: 0, mKey: Int8Array [pattern 0–7], mVar: Int8Array
[0], mPre: Uint8Array [3], mL1: Uint8Array [len], mOff: Int32Array [0, len], mT: Int32Array [0, 240 · len], st: Uint16Array(len) (lane j
= slot j, no accent bit), vl: Uint8Array(16 · len) (slot j at step s: vl[16 s + j], 0 where st has no bit), fill: null }` — no `ls`.
DrSeq calls `dm.trig(mask, vl, o)` with **o already × 16** (o = 16 · the step's index in st): slot j's velocity is `vl[o + j]`, 1–127.
The payload: `{ plan, sync: true, run: false, bpm: 120, swing, at, tap: 0, map: Int8Array(128) note → slot (present voices only), prim:
Int8Array(16), mute: 16 bits (mute | ~solo), smp: null, m: 'kit', pk }`.
**For F.** Press inputs (`api.drum.press`): `cell { lane, step, v }`, `paint { lane, steps, v }`, `pat { p }`, `len { n }`, `swing { v }`,
`clear`, `clearAll`, `mute { lane }`, `solo { lane }`, `hit { lane, v }` / `hit { lane, off: true }`, `voice { slot, op, type }`, `start`,
`release` (a cancelled gesture); `leds(S, D)` → `{ step, lit }`; `K.names(D)` (16), `K.rows(D)` → `[{ n, s, name }]`; the heard posts'
`k` is the pattern playing. Velocity edits are `cell` with the new v (one History step per gesture is the host's).
**For H.** The record's fields H reads: `ty` (presence; reconcile writes it), `nm`, `map`, `pat[ui.pat]`, `ui.pat`, `x.swing / mute /
solo`, `keys: []`; a new machine = `K.starter()` (then `reconcile(vals, D)` after a kit load, a TYPE change and every restore); Remove /
add = `press voice` (the record's half) + the vals' TYPE (yours); `drumAudible`'s kit branch = `plan.vl && plan.st.some(m => m)`;
`drumRowsOf(dev)` → `drumRows(dev.drum.map, model, dev.drum)`; pads: `soundName` / `soundShort`' third argument the record, `drumNote`'s
result carries a kit's `D`, `defaultsFor(track, D, [], cols)` (no order) gives the present voices kick bottom-left (cv-pads' `orderOf`
may pass `[]` for a kit); `cmbMarkList` through `drumRowsOf` names the rows.
### Lane F (2026-11-03, dm-F on d60f174: cee4f80 the failing tests, 9d4b842 kit-ui + GRID.steps, a57fa0b the layout gate; this note's commit)

**What is in.**
- `kit-ui.js` (imports rig-grid / wk / kit-core only): `kitHost(deps)` :219 → `face(kind, root, args)` :813 (`seqFace` :297, `voiceFace` :689),
  `size` :260, `rack` :266, `devices` :273, `cellRect` :284, `FACE` / `layoutOf`, `destroy`; the data `FACE` :78 (voice 4 columns, `seqRecipe(n)`
  :71 one frozen recipe per n), `seqH(n)` / `voiceH` (236), `SEQ_COLS` 19, `VOICE_COLS` 4, `RACK_ROW` 4, `RACK_GAP` (derived: (1248 − 4·288) / 3 = 32);
  `KIT_CSS` :128 + `ensureKitCSS` (#kit-css, once a document; colours only the skins' tokens and `--kit-c` = KIT.TINT; sizes GRID's); `fmtKnob` /
  `fmtLevel` / `fmtChoke` (readouts by KIT.TYPES' laws), `padVel` (cv-keys KEY_VEL's curve, copied: D6; a test holds them equal), `PAD_KEY_V`, the
  gesture numbers (`DECIDE_PX` 6, `LONG_MS` 500, `SLOP_PX` 8, `VEL_STEP` 8), `kitStats { paints, grid }` (G9's counters).
- The Sequencer: head (KIT ▾ · PATTERN A–H a radiogroup · LENGTH and SWING wk.numBoxes · CLEAR), the grid row (one canvas — the cells, repainted
  on an edit / sync / zoom end only —, one hit layer `.kit-hits` over columns 3–18, one playhead `.kit-ph` moved by a transform, a ruler 1 5 9 13, a
  DOM header `.kit-rh` and a lamp `.kit-lamp` a present voice, the cursor and the velocity readout inside the hit layer, `+ Add drum`); gestures
  as §4.4 (tap, sideways paint, vertical velocity, Shift-drag, long press / right-click step menu, two-finger revert, keyboard grid); a header tap
  mutes, a long press (≥ 500 ms at the lift) or a right-click solos. The voice face: tint · TYPE ▾ · HIT over TUNE DECAY LEVEL CHOKE and k1–k4
  (wk knobs / numBox carrying `data-ctl` = `data-dest` = `k<s><f>`); a muted (or solo-excluded) voice dims (`data-muted`).
- The heard time: step / lit / on subscriptions → one frame (deps.raf, else wk.frame): ≤ 1 transform + ≤ 16 flips, no layout read, nothing
  created; stopped: no frame; off screen: nothing written, caught up at `shown(true)` / `sync()`. No wk.clock client.
- `rig-grid.js`: `GRID.steps = { cell: 48, ruler: 24 }` (one line + the header); nothing else.
- `tests/kit-ui.test.mjs` (26), `tests/ui-layout-kit.mjs` (G8, Chrome for Testing; not in the sweep).

**[C]s refined (reasons).**
1. §4.1 `rows.cell` / `rows.ruler` → **`GRID.steps.cell` / `.ruler`**: tests/rig-ui.test.mjs:67 pins `GRID.rows` whole (not F's file); a sibling key
   leaves every pin, `gridVars()` and `cssText()` byte for byte (hashes pinned in kit-ui.test; ui-layout-wc / -fx JSON identical before / after).
2. §4.6 `edit(t, dev, label, r)`, r = `{ vals?, drum?, lay? }` → **`{ press?, vals?, kit? }`**: the face never builds a record — lane S's press input
   carries the record's half and its sends (now / bar); H runs it through the drum host inside the one History step. `kit` names a KIT ▾ load.
3. §4.5 `fixed: { w: 288, h: 236 }` → **h = the face + `deps.barH`** (276 with cv-module's BAR_H 40): cv-module's `measure()` reads `fixed.h` as the
   whole module (cv-module.js:722); `barH` is a dep so kit-ui holds no layout literal. size / rack / cellRect are module px.
4. §4.2 the screen `24 + 48 × (rows + 1)` → **+ 1 only while < 16** (the add row hides at 16: no blank band).
5. §4.3 "a HIT pad, a lamp" → **the HIT pad is the voice's lamp** (it flashes on its slot's lit bit): one element, one target.
6. §3.8 `hit { lane, v }` → the HIT pad plays through **`api.pads.on(code, v, ts)` / `off`** (cv-drum's existing pad path: the note, the sel() gate);
   the off at the last lift (the family's rule); Space / Enter at 100.
7. §4.2 the heard time also subscribes **`api.on`** (a record / transport change, change-gated by the record's identity): an undo or a press repaints
   once; the playhead from `deps.leds?(t, dev).step`, else kit-core `leds(S, D).step`.
8. Names: kit-core `names(D)`, else `D.nm`, else the type's label + an ordinal (S's stub returns ''). The bar's sub (`devices`) is the type only when
   the name is another ("KICK · Kick" read twice).
9. The step menu: Soft · Normal · Accent · — · Off (KIT.VEL as hints); the brief's "clear" is Off. LEVEL reads in dB, CHOKE "–" / 1–4.
10. §7.3's "a 16-voice kit ≈ 2 700" → **≈ 1 600 painted** (measured: Sequencer 69, a voice 88 + its bar): under PT_HEAVY's 2 048 — H's `'kit'`
    heavy kind would not fire; the lead's call.

**Measured (G8, tests/ui-layout-kit.mjs; d 1440 × 900 mouse, l 1366 × 1024 and p 1024 × 1366 touch, dpr 2; Inter and Archivo Narrow; every pass
green; the numbers are the same at the three sizes).** Sequencer 1248 × 144 / 336 / 528 / 864 at 0 / 4 / 8 / 16 voices, fill 0.627 / 0.825 / 0.880 /
0.916 (narrow 0.619 / 0.822 / 0.877 / 0.915; lower bound only, §4.1); voice faces 288 × 236, fill 0.685 (all six types). Min text–edge 16, text–control
6, text–text 9 (Sequencer) / 18.2 (voice; narrow 28.4), fonts ≥ 11 (values 10). Hits ≥ 44 on touch (every control's box ∪ its band; cells 64 × 48,
headers 128 × 48, knob cells 64 × 76). Elements: Sequencer 45 / 53 / 61 / 77 (painted 38 / 46 / 55 / 69), a voice 105 (88): ≤ 160 / ≤ 150. Scenes:
the Starter (Sequencer + 8 voices + bars) 855 painted, the six voices 588. Each text on its composited ground ≥ 5.59 (charcoal) / 5.23 (ivory) /
8.24 (glass) : 1; every KIT.TINT on the grid's screen ≥ 4.16 / 3.24 / 4.43 : 1. A skin switch moved no box; no console error. Contact sheets (not
committed): `kit-face-<size>[-narrow]-<skin>.png`, 18, in the lane's scratchpad `dm-F-scratch/g8/`.

**Tests run** (one file at a time, `--max-old-space-size=2048`): kit-ui 26 / 26, rig-ui 32 / 32, cv-mods-ui 27 / 27, fx-ui 80 / 80, lint 177 / 177,
pwa 24 / 25 — #5 the sw.js BUILD hash (any site-file change; the lead's `node tools/precache.mjs --write`; green at d60f174). Chrome for Testing:
ui-layout-kit (d / l / p × Inter / narrow: green), ui-layout-wc (green; its JSON identical with d60f174's rig-grid.js), ui-layout-fx (green; identical).

**For H.**
- `import { kitHost } from './kit-ui.js?v=9'` in main.js (precache follows the graph) and
  `KITUI = kitHost({ doc, barH: BAR_H, get: (t, dev, id) => vals, set: kitKnob (ph 'move' | 'end'), drum: (t, dev) => DRUM.api(t), edit, menu (wk.contextMenu
  with wkPopSkin), notice, presets?, presetName?, rec?, leds? })`. Every dep is called with the `t` / `dev` the face was made with (resolve by id).
- `edit(t, dev, label, r)` = ONE History step: `r.press` → `DRUM.press(t, r.press)` (put + sends) inside it; `r.vals` → write the vals (persist, the
  patch post), reconcile, and the `kitBack` meta of their old values; `r.kit` → the loaded kit's name. Labels: "Edit pattern", "Pattern B", "Length 12",
  "Swing 62 %", "Clear pattern A", "Clear all patterns", "Mute / Unmute / Solo / Unsolo <name>", "Add Tom", "Remove <name>", "<name> → Clap",
  "Reset <name>", "Load kit Deep".
- The `'pm'` sites: `KITUI.devices(t, dev)` (entries `{ key 'iN/k<s>', kind 'pm', dev, slot, code, type, model 'kit', title, sub, color (the
  stripe), fixed, nofold, compact, jacks: [] }`), `size(t, dev, key)` (key = dev: the Sequencer; `iN/k<s>`: a voice; else null), `rack(t, dev)`
  (relative to the Sequencer module's top-left), `cellRect(t, dev, lane, step)` (module px: add the Sequencer module's world x / y).
- Mount: `KITUI.face('seq', body, { t, dev })` for `iN`, `KITUI.face('voice', body, { t, dev, slot })` for `iN/k<s>` → View `{ el, face (a getter:
  its h follows the rows), jacks (empty), update (no-op), sync(), shown(on), menuItems(), value() → null, destroy() }` (+ the Sequencer's
  `pending()`, `cursor()`). Call `sync()` after any vals change (TYPE, add, remove, a kit, undo / redo, a skin: the canvas re-reads the tokens) and
  `shown(on)` from host.shown. ⋯ items: the Sequencer's "Clear all patterns" (Demo beat while KIT.DEMO); a voice's "Reset sound", "Remove".
- The modules take the rig mark (`rigMark || isKitDev`); no style.css. Anchors for row 20: `[data-kit="seq"]`, `[data-kit="pat"][data-p]`,
  `[data-kit="len"]`, `[data-kit="swing"]`, `[data-kit="add"]`, `[data-kit="voice"][data-slot]`, `[data-kit="hit"]`, controls by `data-dest`.
- No events of its own: every write goes through deps (edit / set / menu / notice / pads); a face's `lit` subscription turns the monitor on.
  "16 drums is the most" goes to `notice` from `+ Add drum` at 16 (the row is hidden then; the voice tiles' notice is H's / U's).
**For S.**
- The press inputs the face sends (via H): `{ k: 'cell', lane, step, v }` (v 0 = off; tap, velocity drag, step menu, keys), `{ k: 'paint', lane,
  steps: [sorted, < len], v }`, `{ k: 'pat', p }`, `{ k: 'len', n }`, `{ k: 'swing', v }`, `{ k: 'clear' }`, `{ k: 'clearAll' }`, `{ k: 'mute', lane }`,
  `{ k: 'solo', lane }`, `{ k: 'voice', slot, op: 'add', type }`, `{ k: 'voice', slot, op: 'remove' }` (`{ k: 'demo' }` only while KIT.DEMO). lane = slot.
- What the face reads: the record (`pat[ui.pat].len / .cells {l, s, v}`, `ui.pat`, `x.swing / mute / solo`, `nm`), `names(D)` (16 strings), `leds(S,
  D).step` (the heard step of the selected pattern, 0–15, −1 stopped; only when H gives no `leds`), the monitor's lit mask (bit j = slot j). Presence
  comes from the vals' TYPEs (§5.2), not `D.ty`. The HIT pads use the drum host's `pads` with the codes `ka`…`kp` (`D.map[code][0]`).
### Lane U (the Sources tray and the art; worktree DM-U on dm-U: b8be889 the failing tests, e33820b the art, 1972aae the tray + the sims' pins, and the commit of this note)

**What is in.**
- `cv-art.js`: `DRAW.kit` (the tile — ours, the rig's look in miniature: a charcoal case; the Sequencer's face with six rows of sixteen cells, **empty**
  (the user's answer: no starter pattern on the tile; the beat columns a shade lighter), a stripe of each voice's `KIT.TINT` colour at the row's head, one
  accent mark over step 1; under it six voice faces with a tint bar, a black knob with a cream pointer, two jacks; the chip: the rig chip's mid-grey case,
  the seven dark faces, a run of cream cells a row, the six colours kept); `SIL.kit` unchanged (`box`, 16 steps); six `G` glyphs `kick snare hat clap tom
  perc` (32 × 32, currentColor strokes; GLYPHS 13 → 19). cv-art now imports `kit-core.js?v=9` (for `KIT.TINT` only).
- `cv-tray.js`: `KIT_TILES` (the six `{ id, name, type, scope: 'track' }` from `KIT.TYPES`: ids = the type ids `kick snare hat clap tom perc`, names =
  the labels, `type` = the TYPE value the tile adds) and `KIT_FULL` ('16 drums is the most'); the Drums view = sections `kit` (`isKitModel`), `kitmods`
  (`head: 'Drum modules'`, `tiles: 'kit'`), `drums` (`DRUMS`, which excludes the kit), tip 'Our drum machine and the classic ones'; **the kit's tile** is
  a model tile (the `o.models` loop: `kt = isKitModel(m)` → its own title, meta '2026 · drum machine', no badge; the name is the model's, `RIG.NAME + ' ' +
  KIT.WORD`, never a literal here) and sits last of the model tiles, i.e. **after the four machines** (the brief's order; the DOM order is MODELS', and the
  tray draws no heading over a model section — so §4.7's "kit first, classic machines under a heading" is not drawn: no style.css, no new heading
  mechanism for models); **the voice tiles** = `sourcesTray` `o.kit` (`true` → `KIT_TILES`, or a list): `button.cv-tile.cv-mtile.cv-ktile[data-kit][data-scope=track]`
  (children `.cv-mglyph` = `cvArt.glyph(id, { w: 40, h: 28 })`, `.cv-tname`, `.cv-treason`), in the group `kitmods` (the host's box/section `o.kitEl` / `o.kitSec`,
  else a section of its own in `o.secEl` headed 'Drum modules', else a heading + the tiles in the list — `boxOf` was hoisted out of the `o.parts` block,
  `OWN.kitmods`), shown in the Drums view only (hidden on the master canvas as every section); tap → `(o.kitPick || o.pick)(id, mode)`; drag as the rig's module
  tiles' (`o.kitDrag || o.drag`, `info.kit = true`, `info.over` 'canvas' | 'tracks' | null, `info.at` the world point, `o.kitCanvasGhost`); the return gains
  `kitTiles() kitTile(id) setKitPlaced(id, reason|null) setKitFull(reason|null) kitPlaced(id)`. Without `o.kit` the tray is node-for-node as before.
- Scoping (the brief's question): the Modulators view scopes by `scope` only as a `data-scope` attribute and the host decides (`modTile`); the rig's tiles
  are greyed by the host (`setPartPlaced(rigFull(kind))`). The same here: `scope: 'track'` is data; **nothing in the tray looks at the track's model** — a voice
  tile is never greyed for the wrong model (on a non-kit canvas the host starts a kit with it, §1.2); only the 16-drum cap greys them (`setKitFull(KIT_FULL)`).

**Pins moved** (each its value): tests/cv-art.test.mjs:65 the GLYPHS list (13 → 19 kinds: + clap hat kick perc snare tom); tests/cv-tray.test.mjs:848 and :884
the Drums view's shown tiles (`tr808 tr606 tr909 sdsv` → + `kit`), :851 the view's tip ('Drum machines with their real front panel' → 'Our drum machine and
the classic ones'); tests/canvas-8-sim.test.mjs:111, canvas-7a-sim.test.mjs:68, canvas-7b-sim.test.mjs:77, canvas-7c-sim.test.mjs:85 the same shown-tiles list
(+ `kit`; the 7a / 7b / 7c sims are outside the brief's list but pin the same list — the rest of those files exact). New tests (no pin): cv-art 2 (the tile, the
glyphs), cv-tray 7 (KIT_TILES + sections + tip; the kit tile; o.kit; drags; setKitPlaced / setKitFull; the fallbacks and the master; G11's grep).

**Tests run** (one file at a time, `--max-old-space-size=2048`): cv-art 9, cv-tray 66, canvas-sim 25, canvas-MOD1-sim 30, canvas-8-sim 17, main 50, lint 175, canvas-7a-sim
24, -7b 15, -7c 13, -3 25, -1e 24, -1i 20, -2a 26, -2b 24, -9 22, -9b 15, -9c 3, -M 21, -MM 24, -P 15, -SC 15, -WC 51, -LC 20, -FR 15, -del 11, -tab 8, cv-fixes-sim 5, safe-sim
6, safeguard-sim 10, app-midi-sim 7, cv-drum 66, cv-mods-ui 27, cv-panel 111, app-shell 19: all green. pwa 24 / 25: the one failure is the sw.js BUILD hash ("a site file
changed since precache --write"); sw.js is not committed here (the lead's `node tools/precache.mjs --write` at the merge). Not run: the rest of the sweep.

**For H.** The kit tile is `shell.tiles` model id `'kit'`: a tap/drop → `srcPick('kit', mode)` / `srcDrag` as any model tile (mode 'replace' → Replace; 'track' → a new
track; the Drums view's `layout: 'hw'` is unchanged); a drop on the same-model kit canvas = the Starter sounds as a preset, patterns kept (§1.2); a new kit's grid is
empty. Wire the voice tiles in main.js's `sourcesTray` call: `kit: true` (= `KIT_TILES`), `kitPick: (id, mode) => …`, `kitDrag: …` (info.kit; `info.over` 'canvas' |
'tracks'; `info.at` the world point), `kitCanvasGhost: () => !!world && !$('#tab-inst').hidden`, and — optional — `kitEl` / `kitSec` (index.html is nobody's lane: without
them the tray makes its own 'Drum modules' section in `#srcScroll`, which works). The tile id is the TYPE id (`kick` … `perc`), `KIT_TILES[i].type` the TYPE value to add
(`KIT.TYPES[type]`). A voice tile on a kit canvas → add that voice in the first empty slot (§1.2); on any other canvas → Replace with a kit holding the Sequencer + that one
voice and an empty pattern A; on the track list ('tracks') → a new kit track with it. At 16 voices call `shell.tiles.setKitFull(KIT_FULL)` (null when a slot frees), after
every kit edit / track switch as `setPartPlaced` is. The master canvas needs nothing (the kit sections hide with every section).
**Open.** §4.7's section headings over the model tiles ("Classic machines") are not drawn (see above); the Drums view's note is still 'More machines later.'.

### Fix (the Perc's DC) (dm-P on bf8a84f: 19024ff)

**Cause.** The Perc reads its resonators' low-pass taps (DC gain 1), so the strike's net area stays as DC: the impulse doublet's is 0 (1e-7), but the 1 ms Hann noise burst's own random mean (salt- and index-dependent; CLICK 0.3 + v 127's brightness) left up to 2.9e-3 raw / 1.6e-3 after the 4 Hz output block at v 127 (engine-track "alone": 1.6e-3). Not the bend.
**Fix.** `segPerc`, at the strike's first sample: the burst's Hann-weighted noise mean (the same absolute indices, nN hashes a hit, no allocation, split-invariant) is taken off the noise, so Σ in = 0. No DC blocker; G2 Perc (pitches, T60, bend end) unchanged; a new kit-dsp "G2 DC" gate (every type, v 32…127, 8 salts, every rate, after the 4 Hz block, ≤ 1e-3).
**Numbers** (worst of 9 salts, raw / blocked): v 127 48k×1 4.6e-3/2.5e-3 → 3.9e-6/1.0e-5, ×2 2.4e-3/1.3e-3 → 2.8e-6/2.2e-5, ×4 2.9e-3/1.6e-3 → 3.0e-6/2.2e-5, 44.1k×1 4.4e-3/2.4e-3 → 3.7e-6/1.3e-5 (v 32…100 likewise ≤ 1.3e-5); engine-track alone 6: 5.2e-6 / −1.3e-5. ref-DM to re-freeze (the Perc's cases only).
### Lane H (2026-11-03, dm-H on bf8a84f: 541d56b the failing tests, 8ca478a the host + sw.js, this note's commit)

**What is in, per file.**
- `main.js` (the host; every site by function):
  - helpers: `isKitDev` / `kitDevs` (beside `isDrumDev`: a kit IS a drum device — every family path holds); `loadVals` → the model's
    defaults for a kit and `save` keeps no `synth.v.kit` (a new kit is always the Starter); imports `kit-core` (KC), `kit-ui` (`kitHost`),
    `isKitModel`, cv-mods' `NOMOD_KIT`.
  - the kit block (before "the bodies and their live values"): `KITUI = kitHost({ doc, barH: BAR_H, get, set: kitKnob, drum: DRUM.api(view),
    rec: drumOf, edit: kitEdit, notice, presets (presetList: the four kits + the user's), presetName })` — every dep resolves the track by id
    (`ptT`); `kitSeqs` ('tid/dev' → the Sequencer face) / `kitVox` (voice key → face); `kitOf(t, key)` ('iN/k<s>' of a present voice);
    `kitRack`, `kitTitle`, `kitMount` / `kitUnmount`, `kitSeqDrop`, `kitSync` / `kitSyncAll` (kit-ui's sync after any vals change),
    `kitShownKey`; `kitRec` (kit-core reconcile → d.drum when it changed); `kitVoiceVals` (kit-ui's voiceVals, its keep rules); `kitNew(d,
    type)` (the Starter vals + `KC.starter()`, or a voice tile's one voice in slot a on an empty record via `press voice add`); `kitRelay`
    (the voices' places, below); **`kitEdit(t, dev, label, r)`** (r = `{ press?, vals?, kit?, at? }`: ONE step — `hist.record(…, force when
    it carries meta)`, the press through `DRUM.press` (put + sends), the vals written with meta `{ kit: 1, trackId, dev, f: [[id, before,
    after]], p: [preset before, after] }`, reconcile, kitRelay, a dropped voice's place, `sendPatch` before `drumSend`, `DRUM.changed`, the
    roll's rows when the map moved, `kitSync`, `padsRefresh`, `cvRender`; nothing changed → `hist.prune`, false); `kitBack` / `kitBackOf` /
    `kitBackApply` (per field, only while it still holds the other side — a knob turned since stays); `kitKnob` (ptKnob's shape: vals in
    place, the preset name off, `queuePatch` throttled by PT_KNOB_MS, at once and `kitSync` at 'end'); `kitLoad` (one step "Load kit <name>",
    "Loaded the <name> kit · tap to undo"); `kitAdd` (first empty slot; 16 → KIT_FULL's notice, false) / `kitRemove` / `kitType`;
    `kitSeqItems` / `kitVoiceItems` (the ⋯ items); `kitShown`; `kitTile` (the kit tile on a kit: the Starter loaded, patterns kept);
    `kitPick(id, mode, at)` / `kitDrag` (the voice tiles: a kit canvas adds, another canvas Replaces with a kit of that voice, 'track' / the
    track list a new kit track); `kitTray` (`setKitFull(KIT_FULL)` at 16, null otherwise); `kitState` (§6.1's copy).
  - the `'pm'` dispatchers: `kindOfKey` (`pmOf || kitOf` → 'pm'), `cvMountBody` (kitMount), `cvUnmountBody` (kitUnmount), `cvHost` `size`
    (KITUI.size), `rackLayout` and `cvTidy` (`kitRack`), `shown` (kitShownKey), `cvTitle` (a voice: its name / type; the Sequencer: "Sequencer"
    over the model's name, no chip — KIT ▾ is on its face), `cvMenu` (the Sequencer: About, Replace with…, Clear all patterns, Save sound… /
    Delete saved sound / Init sound = the Starter kit, Bring to front, Tidy — no fold, no layout items; a voice: Reset sound, Remove, Bring to
    front, Tidy), `cvDelOf` (a voice → kitRemove: the canvas Delete key), `cvDevices` (the Sequencer `nofold`, then `KITUI.devices`).
  - the instrument: `renderPanel` (a kit → `KITUI.face('seq', el, { t, dev })`, no ClassicPanel; `kitSeqDrop` first), `cvDropBody` (its face
    goes with its element), `cvInstSize` (KITUI.size: 1248 × the face + bar), `cvCamRestore` (the first view, below), `rigMark` (`||
    isKitDev || kitOf`: the kit wears the rig's skins), `heavyOf` / `sxHeavyRun` ('kit', below).
  - the flows: `setTrackModel` (a kit arrives through `kitNew(d, o.kv)`; `iN/*` places dropped on leave / arrive, then `kitRelay`; its first
    view framed as the 900's), `addTrack` (`kitNew` before `drumOf`), `srcPick` / `srcDrag.drop` (`kitTile`), the `sourcesTray` call (`kit:
    true, kitPick, kitDrag, kitCanvasGhost` — no index.html host element: the tray makes its own "Drum modules" section), `cvRender` (`kitTray`).
  - History / files: `keepDevs` (`c.drum` kept only when `d.model !== 'kit'`: ↶ / ↷ move a kit's pattern, its vals kept), `undo` / `redo`
    (kitBack beside ptBack), `applyRestore` (kitBackApply, then `kitRec` for every kit before the sends, `kitSyncAll` after renderAll),
    `loadProject` (`kitRec` for every kit: a file's `ty` that disagrees, a missing note — the vals win).
  - the family's readers: `drumAudible` (the kit branch: `plan.vl && plan.st.some(m => m)`), `cmbMarkList` (→ roll.js `drumRowsOf`: the
    record's names), `modCan` (NOMOD_KIT's own words instead of the generic refusal).
  - `__synthTest.cv.kit` (below).
- `roll.js`: `drumRowsOf(dev)` passes `dev.drum` as drum-core `drumRows`' D (the four machines ignore it) — the roll, the Ducker's NOTE menu
  (scSources → drumRowsOf) and the Combiner's Marks menu all name a kit's rows from its record.
- `cv-pads.js`: `lookOf(model, D)` (a kit: each present voice's KIT.TINT → `PC.nearestColor`; no record → null); `defaultsOf` passes D (the
  present voices by pads-core sidOrder, kick bottom-left, their colours); `trackList` entries carry a kit's record (`rec`, through deps.drumOf);
  `kitSids` — the inspector's Sound list (present voices by `PC.soundName(s, 'kit', D)`), a target switched to Drum (the first present voice),
  Fill from… (the present voices, their colours). `orderOf('kit')` unchanged (`{ order: null, cols: 4 }`).
- `sw.js`: `node tools/precache.mjs --write` (kit-ui.js now in main.js's module graph: precached; pwa 25 / 25).

**[C]s refined (each with its reason).**
1. **heavyOf('kit')** keeps PT_HEAVY's line 2 048 and its words (§7.3), once a session (`kitHeavyDone`). Lane F measured a 16-voice kit at
   ≈ 1 600 painted (Sequencer 69 + 16 × (88 + bar)), so the notice stays quiet for every kit alone — the line is a paint-cost line (the 900's
   iPad measurement), not an instrument's; it speaks only when a kit's canvas also carries enough other modules to pass it. No new number.
2. **The kit tile first in the Drums view** (U's open point): not done — the tile order is MODELS' and moving it pins seven assertions in five
   other lanes' test files (cv-tray :848 :884 :2180, canvas-7a :68, 7b :77, 7c :85, 8 :111): not the "one line" the brief allowed.
3. **cv-pads' "empty order"**: `orderOf('kit')` stays `{ order: null }` — pads-core's `defaultsFor` treats null and [] alike (sidOrder: the
   present voices), but Fill from… reads `O2.order ||`: an [] there would fill nothing.
4. **kitBack per field**: a structural step's fields are written back only while each still holds the step's other side (sxBack's / ptBack's
   rule) — a knob turned after the step stays (the knob policy), a TYPE (presence) always comes back because knobs never write TYPE.
5. **The voices' places (§4.5)**: without a Sequencer place everything is Tidy's (cv-module rack: rows of four under it). Once the Sequencer
   has a place (a user move pins the canvas), `kitRelay` keeps every voice that stands at its rack place at the rack's new place (the
   Sequencer grows 48 px a row: a pinned voice would be overlapped), leaves a voice the user put elsewhere, drops an empty slot's place; a
   Replace drops the old instrument's `iN/*` places (the 900's rule) and lays the new rack under the Sequencer's place.
6. **The first view (§1.2)**: `cvCamRestore`'s kit branch (k = min(1, band / 1248) ≥ READ_K, the Sequencer's top-left framed) applies when
   the track has no stored camera (a new kit track; the 900's rule) — a Replace on a track whose camera the user moved keeps that camera.
7. **Kit loads say so**: "Loaded the <name> kit · tap to undo" (KIT ▾, ⋯ Init sound, the kit tile on a kit) — the rig tile's idiom; the
   step "Load kit <name>" (F's label) carries kitBack, the patterns untouched.
8. **⋯ Init sound** = the Starter kit as a load (one step, kitBack, patterns kept) — not presetInit (which would bypass reconcile / kitBack).
9. **No last-used values** for the kit (`loadVals` → defaults, `save` stores none): a kit's vals ARE its voices (§5.2), so a new machine is
   always the Starter (§1.2), as a 900's knobs belong to its record.
10. **The Sequencer module**: `nofold` (the 900 controller's rule: folding it would leave its voices standing alone); title "Sequencer", sub
    the model's name, no chip.
11. **toV1**: phase 0's generic family line (`isDrum('kit')`), no line of H's own (cv-migrate is not H's file); the sim checks the kit
    track is in `lost`.
12. **"Other tracks' bytes"**: any ↶ re-sends every track's patch (applyRestore, the app's rule since 1c — not the kit's): the gate is
    that a kit's edits post nothing to a Juno / an 808, and the restores' posts are those tracks' own patches byte for byte, no payload.

**Pins moved**: none of the existing ones — every file of the brief's list green unchanged. Added (no pin moved): tests/cv-pads.test.mjs
+1 (a Pads module on a kit), tests/roll.test.mjs +1 (drumRowsOf on a kit), tests/cv-cost.test.mjs +1 (the kit's dkp row: mono, ≈ 0.0067,
under the 0.012 target and the 808, `~1 %`), tests/main.test.mjs untouched (its 19-module pin already counts kit-dsp.js).

**Tests run** (one file at a time, `--max-old-space-size=2048`): canvas-DM-sim 15 / 15 (new), cv-pads 32 / 32 (+1), roll 61 / 61 (+1), cv-cost 19 / 19 (+1),
main 50, pwa 25 (after precache), lint 177; the family and the sims the host sites touch — canvas-7a 24, -7b 15, -7c 13, -8 17, cv-drum 68,
canvas-sim 25, -MOD1 30, -WC 51, -LC 20, -MM 24, -SC 15, -9 22, -9b 15, -9c 3, -1e 24, -3 25, -del 11, -2a 26, -M 21, -tab 8, cv-shell 19,
app-midi 7, accessors 29, cv-tray 66, integration 44 — all green; golden-drums 5, golden-kit 3, golden-graph 6 exact. **kit-ui 25 / 26**: its
:463 pin reads the Kick's DECAY readout '370 ms' — the integration commit bf8a84f moved the Kick's default DECAY 0.45 → 0.55 ('519 ms'), so
it fails on bf8a84f itself, before any H change (kit-ui.js / kit-core.js / its test untouched here); F's file: the lead's one-line pin.
Not run: the rest of the sweep (the lead's).

**`__synthTest.cv.kit`** (main.js; for lane G's scenes, the reviewers, row 20): `add(trackId | null)` → the kit track's id (the kit tile's
action on that track — a Replace; null: a new kit track), `state(trackId)` → `{ pattern, len, swing, playing, step (the heard step, −1
stopped), voices: [{ slot, type, name, note, cells: { step: v } }] }` (the selected pattern), `cellRect(trackId, lane, step)` → `{ x, y, w,
h }` world px | null (the shown track's; an empty slot null), `cell(trackId, lane, step, v)` (a tap / a velocity drag: one step),
`press(trackId, input, label?)` (any kit-core press input: one step), `voice(trackId, 'add', type | 'remove', slot | 'type', slot, type)`,
`knob(trackId, id, v, ph)` (kitKnob: no step), `load(trackId, name)` (a kit by name: Starter / Deep / Tight / Crunch / a saved one),
`play()` / `stop()` (the song's ▶ / ■), `drag` (kitDrag: `drop(id, { over: 'canvas' | 'tracks', at })`), `pick(id, mode, at)`, `host`
(KITUI), `faces()` → `{ seqs, voices }` (the mounted Views), `heavy()` → `{ kind, line, done }`. The anchors are F's (`[data-kit=…]`).

**For G / the reviewers.**
- A scene: `cv.kit.add(null)` (a new kit track: the Starter on an empty grid, framed at 100 %), then `cv.kit.press(id, { k: 'paint', … })`
  or `cell` per GROOVE cell (tests/kit-fixtures.mjs), `cv.kit.play()`; a 16-voice scene: `voice(id, 'add', type)` × 8. kit-ui's
  `kitStats { paints, grid }` counts the frames; the heard step reaches the face through the drum host's `step` / `lit` (no wk.clock client).
- Worth an adversarial look: undo storms across add / remove / TYPE / kit load with knob turns between (kitBack's per-field rule); a kit
  file whose `ty` / `map` disagree with its vals (loadProject → kitRec); a voice tile dropped on the canvas while a kit is shown (its place
  at the drop point) and on the master canvas (refused); the Sequencer moved by hand, then voices added (kitRelay); Replace kit ↔ 808 ↔
  Wavecraft (the `iN/*` places dropped, the session fresh); the Delete key over a selection of voices (one folded step).
- Not done here: the iPad / Chrome checks (G7's browser half, reviewer 2); the heavy notice never fires for a kit alone (refinement 1).

### Lane G (2026-11-03, dm-G on ae49608: 7ddc8cd the scenes and harness; this note's commit)
tests/ui-bench-fps.mjs + .test, tests/ui-bench-wc.mjs + .test only; no source file touched. Run on the M4 Max, Chrome for Testing 156, headless, dpr 2.

**What is in.**
- fps scene `kit` (SCENE_IDS 9 → 10): `BUILD.kit` = `cv.kit.add(null)` (a new kit track, the Starter's 8 voices), tests/kit-fixtures `GROOVE` painted cell by cell through
  `cv.kit.cell` (15 cells, one step each), Tidy + `fit` (the Sequencer and the voices framed), 128 BPM (the brief; the contract said 160), engine on, ▶. EXPECT (the faces ride the heard
  queue, not the clock, so absolute Hz): the playhead `.kit-ph` `style` writes ≥ 0.8 × 8.5 (a 16th at 128 BPM = 8.53 a second), each lamp `.kit-lamp[data-slot]` `data-hit` flips at its lane's groove
  rate (kick 2.1, clap 1.05, closed hat 3.7, open hat 0.5, rim 0.5; tol 0.6), the HIT pads `.kit-hit` (`any`, min 5). The pin: tests/ui-bench-fps.test (scene counts 10, matrix 110, the
  kit's EXPECT derived from the groove, BUILD.kit's source, the gates). The cell's L+S for a playing scene stays recorded, not gated (as every playing scene).
- `kitProbe` (driver checks `kit probe 1x / 4x / 6x`, cap 120, and `kit stopped`): the face's own `frame` is found in `requestAnimationFrame` by its source (`kitStats.paints++`, `paintGrid()` for the
  Sequencer) and timed; per kit callback a MutationObserver drained before / after (playhead style, `data-hit` flips, anything else) and a count of layout-forcing reads (getBoundingClientRect,
  getComputedStyle); per delivered frame the playhead's step against kitState's heard step (sampled in a microtask after every callback); who writes the DOM at all (diagnostic); then `reps` taps
  (`cv.kit.cell` on / off in the empty snare lane), pattern switches (B / A), voices added and removed — each: the host call, the face frames after it, `kitStats.grid` deltas, the worst rAF cost and
  frame gap. Stopped: ■ (`cv.kit.stop`), 1.5 s settle, 2 s: kit callbacks, `kitStats.paints / grid`, the grid canvas's paints, DOM writes under the kit's modules, the playhead's `data-on`, kit clock clients.
  Gates (`KIT_GATES`): at 1×: Sequencer frame med ≤ 0.1 ms, ≤ 1 playhead write and ≤ 16 flips a callback, 0 other writes, 0 Sequencer frames that wrote nothing, 0 layout reads, the playhead ≤ 2 frames behind
  the heard step and 0 steps skipped, 0 grid repaints while playing, no kit clock client; at every throttle a tap / a pattern switch repaints the grid exactly once; at 4× the repaint frame med ≤ 2 ms (§7.3).
- ui-bench-wc `kitS` / `kitX` (`SCENES`, default run includes them): `kitScene` = `cv.kit.add(null)`, kitX 8 `cv.kit.voice(id, 'add', type)` (types 1–6, 1, 2), `kitCells(n)` (the groove + four hits in every lane
  it leaves empty: all 16 lanes painted), Tidy, 128 BPM, `powerOn`, ▶; phases idle / pan / pinch 25–200 % / settle / **drag** (a voice module nudged 32 px a frame, out and back: no camera burst, so all its frames
  are judged) / rest; `kitGate(res, throttle)`: scene as asked, painted ≤ 1500 / 2048, camera + pan + pinch + drag P+ at 1× / 4× (med ≤ 17, p95 ≤ 20, max ≤ 33), P at 6×, the heavy notice not fired.
  **There was no node CLI for this bench** (the brief assumed one): added one (`node --max-old-space-size=2048 tests/ui-bench-wc.mjs [--scenes juno,rig1,rigX,kitS,kitX] [--throttle 1,4,6] [--out f] [--sweep]`:
  Chrome for Testing, its own profile, downloads denied, CPU throttle by CDP on the page, `window.__wc` read, kitGate printed, exit 1 on a failure) and a `spinMs` calibration in the result (the throttle's evidence:
  14.5 / 38.6 / 56.3 ms at 1× / 4× / 6×).

**G9 vs §8's targets** (`node tests/ui-bench-fps.mjs --scenes kit --sizes d,l,p --throttle 1,6 --caps 60,120`, 18 cells, then the kitProbe at 1× / 4× / 6× and the stopped check; `node tests/ui-bench-wc.mjs --scenes kitS,kitX --throttle 1,4,6`):
| target | measured | |
|---|---|---|
| frame cost 1× (every cap, d / l / p, incl. the two 240 Hz cross cells) med ≤ 2, p95 ≤ 4 ms | med 0.01–0.225, p95 0.17–0.295, max ≤ 0.42 ms | pass |
| frame cost 6× cap 60 med ≤ 12 ms | d 1.115 (p95 2.2), l 0.80 (1.9), p 0.645 (1.6); cap 120: 0.795 / 0.245 / 0.23 (recorded) | pass |
| playhead and lamps live at the step rate (7 entries) | 7 / 7 in every cell; playhead 8.5 Hz (limit 6.8) | pass |
| the face's work per heard step | Sequencer frame med 0.005, p95 0.02, max 0.03 ms (1×; 6×: p95 0.015, max 0.7–1.6); voice frames med 0 | pass |
| ≤ 1 transform + ≤ 16 flips, no layout, nothing created | 1 playhead write, ≤ 3 flips a callback, 0 other writes, 0 layout-forcing reads, 0 grid repaints | pass |
| the playhead on the heard step | 1 frame behind kitState's step (the queue's post, then its one-shot frame), 0 steps skipped, at 8.4 steps / s | pass |
| no `wk.clock` client of the kit's | the clock's clients stay `stall`, `frameTick`, `fastTick` (before and after the kit) | pass |
| an edit repaints the grid once, ≤ 2 ms at 4× | a tap: 1 repaint, frame med 0.155 / 0.45 / 1.3 ms at 1× / 4× / 6× (d; l 0.16 / 0.28 / 0.46, p 0.15 / 0.45 / 0.81); a pattern switch: 1 repaint, 0.13 / 0.8 / 1.4 ms; the host call itself 1.1 / 4.3 / 6.4 ms | pass |
| a voice added / removed (relayout) | host call 2.6 / 8.9 / 14.0 ms (add), 2.3 / 7.4 / 10.9 (remove); worst rAF 0.56 / 2.5 / 3.4 ms; longest frame gap 8 / 17 / 25 ms (l 6×: one 33 ms) — no stall | recorded |
| stopped: 0 paints over 2 s | **58 kit callbacks, 58 `kitStats.paints`** (grid 0, canvas 0, DOM writes 0, playhead hidden, no clock client) | **FAIL** (finding 1) |
| layout + style a second | 62–67 ms / s at 1×, 63–116 at 6× (recorded: a playing scene) — a harness artefact, finding 3 (≈ 21 ms / s with the browser's vsync on; play8 records 12–19) | recorded |
| heap growth | ≤ 19 KB / s at 1×, ≤ 2 KB / s at 6× (gate 1 MB / s); no console error, no build note | pass |
| G9(a) wc: pan / pinch / module drag P+ at 1× and 4×, P at 6× (no frame > 33) | kitS and kitX: P+ at 1× / 4× / **6×** too — bursts 16.7 / 16.7–16.8 / 16.8 ms, 0 frames > 33, the drag's 127 frames 16.7 / 16.8 / 16.8 | pass |
| painted elements within §7.3 | kitS **873** (≤ 1500), kitX **1655** (≤ PT_HEAVY 2048); `heavyOf('kit')` quiet (`done: false`) — lane F's ≈ 1 600 holds | pass |
(The wc bench counts frame intervals in a 60 Hz headless page, so its numbers sit on 16.7 ms until a frame is really missed: nothing near it for this scene even at 6× (spin 56 ms against 14.5).)

**A/B** (`busy` and `mods`, d, 1× and 6×, caps 60 / 120, `--no-cross`; this build against ⟨B⟩ = 615713d by `git archive` in the scratchpad with its own harness, interleaved ×3):
mods 1×/60 med 0.27 / 0.27 / 0.315 → 0.28 / 0.28 / 0.275, 1×/120 0.18 / 0.18 / 0.22 → 0.175 / 0.18 / 0.175, 6×/60 0.275 → 0.235, 6×/120 0.255 → 0.23 (medians of the three runs: equal or lower);
busy 1×/60 1.165 / 1.185 / 1.115 → 1.17 / 1.145 / 1.125, 1×/120 0.795 / 0.825 / 0.78 → 0.795 / 0.78 / 0.755, 6×/60 2.96 / 4.88 / 2.48 → 2.8 / 2.57 / 2.43, 6×/120 2.99 / 2.78 / 2.68 → 2.68 / 2.78 / 1.92;
p95 and layout + style the same within the noise (the A/A spread of the throttled cells is ×2); every cell passes on both (one ⟨B⟩ run dropped busy 6×/60 to 42.6 fps: the known throttled-busy variance).
Against the last recorded cells (bench.json `ui-fps-mac-b`, 56209db, busy d 1× / 6× × 60 / 120; `mods` has none): `--compare` on all three runs: **no regression**, 0 improvements. **Noise, not regression.**

**`ui-DM-mac`** (the lead commits bench.json; also in the scratchpad as dm-G-scratch/ui-DM-mac.json): `fps` = ui-fps-mac's compact `benchRow` of the 18 kit cells (cols costMed, costP95, layoutStyleMsPerS, heapKBperS, fps, liveFails, eff, gatesFailed);
`probe[size][1x|4x|6x]` = { seq [med, p95, max ms], steps, lag, skipped, quietSeq, quietVoice, ph, flips, other, reads, grid, tap / pat [host call ms med, repaint frame ms med, max, worst rAF], add / remove [call med, call max, worst rAF, longest gap], pass }, `probe[size].stopped`;
`wc[1x|4x|6x]` = { spinMs, kitS | kitX: { painted, camera, burst [med, p95, max], over33, drag [med, p95, max, over33] } }.
```json
{"date":"2026-11-03","machine":"Apple M4 Max, arm64, node v24.21.0","about":"IMPL-DM G9 lane G (build ae49608, Chrome Chrome/156.0.8078.47): the `kit` fps scene (a kit track, the Starter's 8 voices on tests/kit-fixtures GROOVE, 128 BPM, playing; d 1440x900 mouse, l 1366x1024 / p 1024x1366 touch; caps 60 / 120 and at 1x two 240 Hz cross cells; 1x and 6x CPU) = fps (benchRow cols as ui-fps-mac), probe (kitProbe at 1x / 4x / 6x, cap 120: seq = the Sequencer frame ms med/p95/max per heard step, tap / pat = host call ms med, repaint frame ms med/max, worst rAF ms; add/remove = host call ms med/max, worst rAF, longest frame gap), stopped (2 s after the transport stop), wc = ui-bench-wc kitS / kitX (painted elements, camera verdict, bursts med/p95/max ms, frames over 33, the module drag med/p95/max/over33). layoutStyleMsPerS of a playing kit cell is dominated by the headless --disable-gpu-vsync running the 0.2 s flash animations unthrottled (about 21 ms/s with vsync on).","build":"ae49608","fps":{"date":"2026-11-03","machine":"Apple M4 Max, arm64, node v24.21.0","about":"","build":"ae49608","cols":["costMed","costP95","layoutStyleMsPerS","heapKBperS","fps","liveFails","eff","gatesFailed"],"cells":{"d/kit/1x":{"60":[0.225,0.295,63.037,18,60,0,60,""],"120":[0.16,0.225,65.769,10,120.2,0,120,""],"120@240":[0.08,0.185,65.626,4,239.6,0,120,""],"60@240":[0.01,0.2,64.707,6,238,0,60,""]},"d/kit/6x":{"60":[1.115,2.2,83.817,1,59.9,0,60,""],"120":[0.795,1.765,84.675,1,119.7,0,120,""]},"l/kit/1x":{"60":[0.205,0.285,65.985,19,60,0,60,""],"120":[0.15,0.205,64.286,10,120.2,0,120,""],"120@240":[0.075,0.18,67.231,3,239.3,0,120,""],"60@240":[0.015,0.195,64.072,6,238.9,0,60,""]},"l/kit/6x":{"60":[0.8,1.9,73.383,0,59.9,0,60,""],"120":[0.245,1.57,70.216,2,119.3,0,120,""]},"p/kit/1x":{"60":[0.2,0.265,63.699,18,60,0,60,""],"120":[0.14,0.205,63.019,9,119.9,0,120,""],"120@240":[0.07,0.17,66.02,3,238.8,0,120,""],"60@240":[0.015,0.18,61.667,7,238.9,0,60,""]},"p/kit/6x":{"60":[0.645,1.595,78.04,1,60,0,60,""],"120":[0.23,1.565,63.031,2,119.3,0,120,""]}}},"probe":{"d":{"1x":{"seq":[0.005,0.02,0.03],"steps":8.4,"lag":1,"skipped":0,"quietSeq":54,"quietVoice":166,"ph":1,"flips":3,"other":0,"reads":0,"grid":0,"tap":[1.1,0.155,0.295,0.735],"pat":[1.08,0.13,0.36,0.58],"add":[2.585,4.335,0.555,8.333],"remove":[2.285,2.33,0.515,8.333],"pass":false},"4x":{"seq":[0.005,0.015,0.78],"steps":8.4,"lag":1,"skipped":0,"quietSeq":55,"quietVoice":176,"ph":1,"flips":3,"other":0,"reads":0,"grid":0,"tap":[4.315,0.45,1.075,2.11],"pat":[4.035,0.805,1.105,1.845],"add":[8.905,9.9,2.495,16.667],"remove":[7.39,7.64,1.335,8.333],"pass":true},"6x":{"seq":[0.005,0.015,0.725],"steps":8.8,"lag":1,"skipped":0,"quietSeq":53,"quietVoice":176,"ph":1,"flips":3,"other":0,"reads":0,"grid":0,"tap":[6.4,1.295,1.77,3.125],"pat":[5.7,1.445,2.035,3.015],"add":[14.03,14.965,3.44,25],"remove":[10.855,12.87,3.54,16.667],"pass":true},"stopped":{"callbacks":58,"paints":58,"grid":0,"canvas":0,"writes":0,"pass":false}},"l":{"1x":{"seq":[0.005,0.02,0.035],"steps":8.4,"lag":1,"skipped":0,"quietSeq":55,"quietVoice":175,"ph":1,"flips":3,"other":0,"reads":0,"grid":0,"tap":[1.135,0.16,0.22,0.845],"pat":[1.085,0.135,0.145,0.515],"add":[2.75,4.435,0.57,8.333],"remove":[2.155,2.32,0.76,8.333],"pass":false},"4x":{"seq":[0.005,0.11,0.75],"steps":8.4,"lag":1,"skipped":0,"quietSeq":54,"quietVoice":168,"ph":1,"flips":3,"other":0,"reads":0,"grid":0,"tap":[4.27,0.28,0.905,1.8],"pat":[4.15,0.475,0.885,2.015],"add":[10.53,12.03,2.535,16.667],"remove":[8.21,9.045,2.38,16.667],"pass":true},"6x":{"seq":[0.005,0.015,1.58],"steps":8.4,"lag":1,"skipped":0,"quietSeq":57,"quietVoice":176,"ph":1,"flips":3,"other":0,"reads":0,"grid":0,"tap":[6.495,0.46,1.515,3.675],"pat":[6.22,1.18,3.04,3.86],"add":[14.495,15.72,3.925,33.333],"remove":[11.455,12.535,3.365,25],"pass":true},"stopped":{"callbacks":58,"paints":58,"grid":0,"canvas":0,"writes":0,"pass":false}},"p":{"1x":{"seq":[0.005,0.015,0.02],"steps":8.4,"lag":1,"skipped":0,"quietSeq":56,"quietVoice":167,"ph":1,"flips":3,"other":0,"reads":0,"grid":0,"tap":[1.115,0.15,0.33,0.695],"pat":[1.12,0.13,0.3,0.535],"add":[2.76,4.315,0.56,8.333],"remove":[2.185,2.325,0.515,8.333],"pass":false},"4x":{"seq":[0.005,0.02,0.845],"steps":8.4,"lag":1,"skipped":0,"quietSeq":55,"quietVoice":168,"ph":1,"flips":3,"other":0,"reads":0,"grid":0,"tap":[3.885,0.445,0.845,1.255],"pat":[4.22,0.185,1.27,2.135],"add":[11.09,11.76,2.01,16.667],"remove":[8.46,8.885,3.695,16.667],"pass":true},"6x":{"seq":[0.005,0.02,0.815],"steps":8.4,"lag":1,"skipped":0,"quietSeq":55,"quietVoice":165,"ph":1,"flips":3,"other":0,"reads":0,"grid":0,"tap":[6.35,0.81,1.875,2.96],"pat":[6.385,0.625,2.91,3.18],"add":[15.055,18.885,3.51,25],"remove":[11.985,14.335,3.955,25],"pass":true},"stopped":{"callbacks":58,"paints":58,"grid":0,"canvas":0,"writes":0,"pass":false}}},"wc":{"1x":{"spinMs":14.5,"kitS":{"painted":873,"camera":"P+","burst":[16.7,16.7,16.8],"over33":0,"drag":[16.7,16.8,16.8,0]},"kitX":{"painted":1655,"camera":"P+","burst":[16.7,16.8,16.8],"over33":0,"drag":[16.7,16.7,16.8,0]}},"4x":{"spinMs":38.6,"kitS":{"painted":873,"camera":"P+","burst":[16.7,16.8,16.8],"over33":0,"drag":[16.7,16.7,16.8,0]},"kitX":{"painted":1655,"camera":"P+","burst":[16.7,16.8,16.8],"over33":0,"drag":[16.7,16.8,16.8,0]}},"6x":{"spinMs":56.3,"kitS":{"painted":873,"camera":"P+","burst":[16.7,16.7,16.8],"over33":0,"drag":[16.7,16.8,16.8,0]},"kitX":{"painted":1655,"camera":"P+","burst":[16.7,16.7,16.8],"over33":0,"drag":[16.7,16.7,16.8,0]}}}}
```

**Findings for the lead** (nothing fixed here; every number above is reproducible with the two commands):
1. **Stopped, the Sequencer is woken ~29 times a second** (G9's "0 paints stopped" fails: 58 frames / 2 s). Stack: cv-drum.js `pump` → `deliver` → `each(e.lits, lit, act)` (it fires for `lit || act`: the monitor's activity posts at the worklet snapshot rate) → kit-ui.js:492 `subscribe(api, 'lit', m => { litMask |= m & 0xFFFF; ask(); })` asks a frame for a **zero mask**; the voice faces guard it (`if (bit(litMask, j)) ask(); else litMask = 0`).
   The frame writes nothing (cheap: 0.005 ms), but it is a `wk.frame` request and a `kitStats.paints` each time, stopped and **playing** (54 of 88 Sequencer frames in 2.5 s wrote nothing — my "moves on every painted frame" check, `quietSeq`). One line: `if (m & 0xFFFF) { litMask |= m & 0xFFFF; ask(); }`.
   Verified on a scratch copy of this tree with only that change: stopped 0 callbacks / 0 paints / 0 DOM writes (the `kit stopped` check passes), playing `quietSeq` 0 (33 Sequencer frames, all with a playhead move or a flip). The harness keeps both gates strict, so `kit stopped` and `kit probe 1x` FAIL on ae49608 until it lands.
2. **Voice faces wake on every heard step** (minor): `subscribe(api, 'on', () => { recDirty = true; ask(); })` — the host's `notify` runs per heard post, so each of the 8 voices asks a frame 8.4 times a second (`quietVoice` ≈ 170 per 2.5 s; 16 voices: twice) to compare `recOf` with its `D` and write nothing. 0.00x ms each; compare the record's identity in the listener and ask only when it changed (as the Sequencer's `recDirty` could).
3. **The kit's L+S (62–67 ms / s) is an artefact of the harness's `--disable-gpu-vsync`**, not a per-frame cost: the 0.2 s flash (`kit-fl0 / kit-fl1`: `background` + `box-shadow` keyframes on `.kit-hit` and `.kit-lamp::before`, i.e. main-thread style + paint every animation frame) runs at ~1 600 frames a second when Chrome is not frame-limited (trace: 4 941 commits in 3 s; StyleRecalcInvalidation "Animation" 8 403 on `.kit-hit` and its ::before). Evidence: the same scene with the flash CSS overridden to `animation: none` → RecalcStyle 3.6 ms/s (136 style recalcs / s, was 2 000), Task 113 ms/s (was 520); with Chrome's own vsync / frame limit on → layout + style 20.7 ms/s. In a real browser it is ≈ 24 frames a hit. A compositor-driven flash (an `opacity` / `transform` keyframe on a pseudo-element) would cost nothing on the main thread; not needed for G9. A future `compareReports` against this row must read the L+S column with that in mind.
4. The playhead is drawn one frame after kitState's step (the heard post, then the face's one-shot frame): `lag` 1 at every display rate — by design; a kit heard step cannot be shown earlier.
5. A voice added is the heaviest thing the face does: 2.6 ms of host work at 1× (max 4.3), 14 ms at 6×, and a frame gap of 25 ms at 6× (33 ms once at l) — no frame is lost at 1×.
6. The wc harness never had a driver: this is the first CDP run of `?wc=1` since lane C wrote it; juno / rig1 / rigX were not re-run here. `window.__wc` and the page are unchanged apart from the kit scenes and `spinMs`.
7. Contract: §8 G9 wrote 160 BPM and "a `rate: 'step'` class or `min:`"; the scene runs at 128 BPM (the brief) with absolute-Hz entries, no new rate class (the lane's call).

### Fix round (2026-11-03, dm-X on e960310: one fixer; a failing test before every change, golden-kit untouched)
**Fixed** (commit · the failing test first · the fix · live):
- R1-1 (P1) `a187553` · canvas-DM-sim "R1-1 the canvas Delete key over 2 / 3 voices" · main `histFold` folds kit metas into ONE kitBack meta
  `{ kit: 1, trackId, dev, f: every field, p: [first p[0], last p[1]] }`, kept out of partMeta · dm-review1/del-kit.mjs (on DM-X): 1 / 2 / 3 voices ↶ whole.
- R1-2 (P3) `5c15028` · canvas-DM-sim "R1-2 a kit gesture that changes nothing keeps the redo stack" · `kitEdit` decides a press's no-op
  before `hist.record` (drum-core's press is pure; DC.press on the session): no record, no dropRedo · g6-host.mjs: 40 041 checks, all pass.
- R2-1 / R2-7 / R2-9 (P2) `167584a` · canvas-DM-sim "R2-1 / R2-7 / R2-9 the Sequencer's host element" · renderPanel's kit branch sets
  `inst custom m-kit` (the rig's own host class: padding 0, no old panel's classes); **cv-module.js** `sync` makes a module again when its
  nofold changes (one condition beside the jack-signature rule) — a Replace to / from a kit gets its bar (no ▾) and "Sequencer out" / "Juno-60
  out" · inst-pad d / p: offset 0 / 0, nothing cut in every flow; seq-edges d: the face = the body (24…1272); clear-hit l new / replace:
  CLEAR's band −24…+20 px (the jack only past +24).
- R2-2 (P2) `ddde138` · kit-ui "(review R2-2) the step menu's close…" · the step menu marks its focus restore; the grid's one focusin
  after it stops at the hit layer (cv-world's reveal never sees it; wk / cv-world untouched); a press on the grid clears the mark · stepmenu-pan
  d / l: camera ty 24 → 24 on every pick.
- R2-3 + G findings 1–2 (P2) `5dfd9ee` · kit-ui "(review R2-3, lane G findings 1–2)…" · `lit` asks a frame only for a nonzero mask; a voice
  face's `on` compares the record's identity first · `ui-bench-fps.mjs --scenes kit --sizes d --throttle 1 --caps 60`: kit stopped ok (0
  callbacks / paints / writes in 2 s), kit probe 1× ok (0 Sequencer / voice frames that wrote nothing), 4× / 6× ok; 0 of 7 checks failed.
- R2-4 (P2) `19ee25f` · kit-ui "(review R2-4) a voice knob's typed value…" · `parseKnob(L, text, cur)` / `parseLevel` invert fmtKnob /
  fmtLevel (unit optional; bare numbers in the readout's unit; ms / s, Hz / kHz, ×, st, Q, %, dB, −∞) · typein: "519 ms" kept, "250" →
  250 ms, "60 Hz", "80" → 80 Hz, "-6 dB" → −6.0 dB.
- R2-5 (P2) `806bc81` · kit-ui "(review R2-5) a second finger landing on the face late…" · a capture pointerdown on the Sequencer's face
  spends the gesture (no write at the lifts); gesture.js untouched; §12's line · paint-cancel l / p: on the grid at 400 ms reverted, 0 steps;
  off the face it still commits (§12).
- R2-12 (P3) `eed90c6` · kit-ui "(review R2-12)…" · numBox labels "Length" / "Swing" (KIT_CSS already hid the label) · —.
- R2-16 (P3) `bb29247` · the gate itself: tests/ui-layout-kit.mjs mounts the Sequencer in its section.inst (`--host inst` = the bug: 88
  failures, "not flush in its body (dx 22, dy 18)") and fails a pass not run at its size (`minimum-scale=1`: p 1024 × 1366, was 1280 ×
  1708) · d / l / p and --narrow green.

**Left** (recorded; the lead's list): §12's "fix round, left" lines (R2-8, R2-10, R2-11, R2-13, R2-14, R2-15, the heavy notice, the greyed
tile); R2-6 the kit tile below the fold at 1440 × 900 (lane H's deviation 2); G finding 3 (the kit's L+S = the harness's
--disable-gpu-vsync); G finding 7 (the scene at 128 BPM, not §8's 160 — accepted).
**Seen, not the kit's**: a classic → classic Replace (Minimoog → Juno) keeps the old OUT jack's name ("Minimoog out"): cv-module sets an
instrument's jack label at make only (no rebuild there); a kit ↔ classic Replace is right since R2-7's rebuild.

## 14. Skeptic + re-plan (2026-11-03)

Read-only against ⟨B⟩ = 615713d (canvas; 20 commits, 168 files since c515abf). Method: every `file:line` of the body listed with its
file's change since c515abf (`dm-skeptic/refs.sh`: drum-core, dr-seq, dr-808, cv-drum, roll, pads-core, cv-patch, rig-grid, cv-keys,
smprender unchanged — their pins hold; main, engine, models, cv-mods, cv-migrate, cv-tray, wk, fx-ui, rig-ui, song, cv-cost moved), then
each re-read at its new line; the DrSeq / drum-core / main readers of a plan, the record gates, the canvas's sub-module kinds, the skin
marks, the frame clock and the harnesses read in full where the contract leans on them. No node run was needed (no claim rests on a
measurement); no source file touched.

### 14.1 Facts re-pinned (c515abf → 615713d)

| fact | where | → |
|---|---|---|
| MODELS count; the rig last | models.js:891 (18; rig = MODELS[17]; SX0 dropped the bundled model) | the kit is MODELS[18]; 18 → 19 (not 19 → 20); tests/rig-model.test.mjs:176–177 move |
| isRigModel, isSxId | models.js:897, 901–902 | `isKitModel` beside :897; `'kit'` is no Sx id |
| drum models, their map convention, the limiter rule | models.js:700–865, :736 / 769 / 808, :781 | pins updated (§2.1, G3) |
| engine drum lifecycle | engine.js:2382 (drOn) · 2411 (drGain) · 2418 (drUnits) · 2457 (fadeDrums) · 2473 (drHit) · 2484 (drNote) · 2534–2579 (renderDrums; act :2576) | unchanged in substance; ranges re-pinned; `_v` named in DrKit's interface |
| the warm-up | engine.js:3758 (call), 3777 (warmDrums), 3839 (warmDrumsV's call), 3905 | the kit round after :3839 |
| engine-track's machine pins | tests/engine-track.test.mjs:1403 and :1678 (two, not one) | both gain `,kit` |
| DrSeq `fire` | dr-seq.js:325–345: `st & 0xFFF` (:327), `mask & 0xFFE` (:333), lanes 1–11 | **P1-1** |
| drum-core `toNotes` | drum-core.js:652–676 (`& 0xFFE`, lanes 1–11; the 909's branch on `plan.mSh` :655) | **P1-1** |
| main `drumAudible` | main.js:4663–4666 (`& 0xFFE`) | **P1-1** |
| the record gates | main.js:219–224 (`keys`, `m`); cv-drum.js:262 (`keys`, `ui`, `x`); drum-core.js:2214–2221 (the SDS-V's `keys: [], ui: {}`) | **P1-2** |
| the Combiner's marks | main.js:10303–10314 (`cmbMarkList`), :10317–10330 (`cmbMarks`); IMPL-LC §6.7 | **P1-3** |
| the canvas's sub-module kinds | cv-module.js:288, 471–480, 1087–1091, 1148–1149, 1171, 1301, 1350 ('pm' generic, 'part' the rig's); main.js:6905–6906, 7016–7018, 7043–7048, 7220–7223, 7252, 7348, 9773–9780 | **P1-4** |
| MOD1's plain faces, LC's face | cv-mods-ui.js:67–76 (MOD_FACE), 80–166 (MOD_CSS), 167, 176 (plainFace), 389 (editor), 476 (ccBody), 549–566 (combRecipe, numeric `h`), 583 (combBody), 817 (its clock client) | **P1-5** |
| the skin marks | main.js:8763 (wkPopSkin), 8768 (rigMark), 8780 (fxMark), 8792 (faceMark); style.css:1553–1613, 1676–1760 (3 skins: charcoal, ivory, glass) | **P1-5** |
| fx-ui / rig-ui as donors | fx-ui.js:48–49, 71, 585; rig-ui.js:29–36 | still not a base (D6) |
| the drum host, heard time | cv-drum.js:213 (machOf), 255–368 (LEAD_S, the queue, the `wk.frame` pump), 431–450 (api: step, lit), 523 (the panel's dirty); main.js:2729–2735 (DRUM, `heard` the frame's shared heard frame) | §4.2: the Sequencer rides `step` / `lit`; no `wk.clock` client |
| the frame clock's clients | main.js:11528–11529 (frameTick, fastTick), cv-mods-ui.js:817 (`lc`); wk.js:3002 (`frame`), 3202 (`clock`) | §7.3 corrected (the contract said the lamps ride `wk.clock`) |
| keepDevs, the back metas | main.js:1958–1967 (:1963 the drum line), 1979, 2007, 2014 | §5.5 |
| the knob-write precedent | main.js:9875 (`ptKnob`), PATCH :9822 | `kitKnob` (§4.3) |
| Ducker NOTE menu, roll host, roll rows | main.js:1423, 5137; roll.js:58–61 | names through `drumRows(map, model, D)` |
| Pads | pads-core.js:57, 202–216, 315, 391–400; cv-pads.js:102, 116 (lookOf), 126 (defaultsOf) | names / presence / colours of a kit through `D` (S: pads-core; H: cv-pads) |
| class table, destOk | cv-mods.js:105 (noClassic), 157 (classTable), 611 (classOf), 648 (destOk) | unchanged plan |
| schema | cv-migrate.js:129 (17), 28–59 (the steps' reasons; SX0's serumOut inside 17); IMPL-LC §2.4 (no step) | 18 kept (§5.6, P3-6) |
| schema pins | tests/cv-migrate.test.mjs:32, 1341, 1485, 1703, 1862; canvas-8-sim:418; canvas-M-sim:339, 353; canvas-9-sim:447; canvas-9b-sim:438 (the contract named -SC / -WC sims: they hold none) | §9.4 |
| the heavy notice | main.js:8413 (SX_HEAVY 1866), 8425 (PT_HEAVY 2048), 8427 (`heavyOf`: rig parts / 900 only) | a kit never triggers it today (§7.3) |
| DSP lists | main.js:928; cv-cost.js:345; smprender.js:30; wk.js:3530; golden-harness.mjs:29; dsp-scope.mjs:40; **tests/bench.html:76–82** (missing from §7.1); pins app.test.mjs:165, modcore.test.mjs:87–88, wk.test.mjs:2327, sx-base.test.mjs:428, cv-cost.test.mjs:437, bench.test.mjs:121 | **P1-7** |
| OS default, lay keys, MIDI ch 10 | main.js:135; song.js:551; song.js:872 | re-pinned |
| bench targets, d8i's gate | tests/bench.json:15–19; engine-track.test.mjs:1087; cv-cost.test.mjs:92 | as the contract; rows in bench-scenarios.mjs:679–705's shape |
| cv-tray | :594 (DRUMS), :609–610 (the Drums view), :689 (RIG_TILES), :718 (MOD_TILES), :799 (tile meta) | §4.7 |
| COST rows | cv-cost.js:104–105 | §7.2 |
| harnesses | tests/ui-bench-wc.mjs:21–24 (BAR), :293 (scenes); tests/ui-bench-fps.mjs:62 (SCENE_IDS), :75–140 (EXPECT; LC's `comb`) | G9 split, lane G |
| the safe assert | tests/serum-ui-stubs/dom.js:20 (`safeAssert`; rig-ui.test.mjs:33) — serum-ui.test.mjs is gone (SX0) | §9.3; CLAUDE.md's pointer is stale (the lead's) |
| ROADMAP | :40 / :41 / :47 hold; :39 → SX0 is :49; :90 → :92 (the 909's answers); :118 → :120; :127 → :129 | re-pinned |
| goldens / refs on the tree | tests/golden-{classic,fx,presets,random,graph,drums,606,909,sdsv,moog,moog-b,moog-c,lc}.test.mjs; tests/ref-{1c,7a,7b,7c,7d,9,9-core,9b,9c,LC,M,MM,P,SC,SX0,WC,p1} | G1's list completed (+ -lc, ref-LC, ref-SX0, ref-1c, ref-p1, ref-9-core) |

### 14.2 P1 — must change before phase 0 (all folded into the body)
- **P1-1 The family's plan readers assume the 808's lanes.** DrSeq `fire` takes `st & 0xFFF` and fires only on `mask & 0xFFE`
  (dr-seq.js:327, 333), drum-core `toNotes` walks lanes 1–11 of `mask & 0xFFE` (:665–668), main's `drumAudible` tests `& 0xFFE`
  (main.js:4665). The contract's kit plan (16 lanes, slot j = bit j, no accent bit) would lose every kick on slot 0 and slots 12–15
  everywhere; "inert without the fields" was true for the four and silent about the kit. → §3.6: each reader branches on `plan.vl`
  before that line (`fireK`, kit-core `toNotes`, the kit's audible), and DrSeq `valid` checks `vl`'s length.
- **P1-2 Presence and names travel with the record, not a `types` argument.** The contract passed `types` (from vals) into
  `compilePlan` / `payload` and `vals` into `names`; but every main-side reader sees only `dev.drum` — `drumPayload` (main.js:4571),
  `drumSend` (:4583), `drumAudible`, LC's `cmbMarks` (:10325), `drumRowsOf` (roll.js:60), pads-core, cv-cables (:450). And the record
  without `keys` fails two gates (main.js:222 re-normalises it on every `drumOf` — a new object each call; cv-drum.js:262 drops it: no
  session, no lamps). → §5.3: the record carries `keys: []` (the SDS-V's precedent, drum-core.js:2217) and `ty` (the TYPEs' mirror,
  written by reconcile); drum-core's signatures stay the family's; `names(D)`; `drumRows(map, model, D)`; `soundName(s, model, D)`.
- **P1-3 Row 26's hooks are LC's now.** LC shipped its own reader of a drum machine's hits (drumRows / rollPlan / rollOpts / toNotes,
  main.js:10303–10330, IMPL-LC §6.7). → §6.2: no `hitsIn` (kit-core, drum-core) and no `kitApi.hits`; the kit joins by drum-core's
  dispatch, `cmbMarkList` names its rows through `drumRowsOf`. And §6.1 trimmed: the tutorial's event API (`kitApi.on`, `kick`) goes to
  row 20's contract; cut 1 keeps the anchors and `__synthTest.cv.kit` (add / state / cellRect).
- **P1-4 The voices are cv-module `'pm'` entries, not parts.** cv-module's `'pm'` path is generic (the entry's fixed size, the compact
  bar, no fold, Tidy by `host.rackLayout`, its cost: cv-module.js:288, 471–480, 1149, 1301, 1350); `'part'` is the rig's (PART_W_DEF,
  sxViews, sxRemovePart: cv-module.js:1148, main.js:6906, 7018, 7048). With `'pm'`, cv-module.js — in no lane's file list — needs no
  change, and the host work is main.js's seven `'pm'` dispatchers. → §4.5, §4.6 (`size`, `rack`), §0.
- **P1-5 The faces are MOD1's plain faces; the skins come from the rig's mark.** Since MOD1 the app has a face system without a Serum
  host — rig-grid + rig-ui's markup through `plainFace` / `editor` / `ccBody`, and LC's `combBody` for a head of segs over a
  numeric-height row (cv-mods-ui.js:176, 389, 476, 559, 583) — while fx-ui's faces lay donor bodies (fx-ui.js:48–49). It is the least
  code: kit-ui copies that construction (≈ 60 lines) and imports only rig-grid / wk / kit-core (D6). For the skins, the contract's new
  `[data-cv-kit]` scope would repeat ≈ 15 chrome rules and 12 skin selectors across three blocks and add eight tokens to the skins'
  same-order gate; marking the kit's modules `data-cv-rig` (`rigMark`, main.js:8768, one condition) gives the exact Wavecraft chrome in
  charcoal / ivory / glass with no style.css change. The six type colours become data (`KIT.TINT`, LC's ≥ 3 : 1-on-every-screen rule).
  → decision (c), §4.3, §4.8; lane U loses style.css.
- **P1-6 The user's answers, everywhere.** An empty grid: `KIT.DEMO = null`, the tile loads the Starter's eight drums on empty
  patterns, the ⋯ "Demo beat" item and the `demo` press stay dormant; the beat the tests need is a fixture (`tests/kit-fixtures.mjs`
  `GROOVE`, never shipped) for G3 / G4 / G5 / dkp / G9. The name: `RIG.NAME + ' ' + KIT.WORD`, `KIT.WORD = 'Drums'` — the one constant.
  No cables; synth drums first (unchanged). `KIT.UNDO` was listed as a cheap flip — it is a lane's work: cut 1 builds one rule.
  → header, decisions (g) (h), §1.2, §3.8, §5.5, §5.7, §6.1, §7.2, §8, §10, §12.
- **P1-7 Phase 0 re-planned on ⟨B⟩.** MODELS 18 → 19 (the kit after the rig); the DSP lists all at once in phase 0 with a stub
  `kit-dsp.js` **after dr-808.js** (modcore.test.mjs:87 pins `dr-seq.js` right before `mod-core.js`) — and **tests/bench.html**, which
  §7.1 missed (bench.test.mjs:121 holds it equal to dsp-scope's list; without it the iPad bench has no kit); so no lane edits another's
  list (V could not reach main.js's line before H). The schema pins are other files than §9.4 said. Models: phase 0, every lane and
  both reviewers on Opus 5.5 / Sonnet (the user: no Fable lanes). → §9.0, §9.1, §9.4, §7.1.

### 14.3 P2 — into the lanes' briefs (30)
**V.** (1) `drOn` / `drGain` read `globalThis.Dr808` only (engine.js:2383, 2412): the factory by machine id; a missing DrKit → `drFail`.
(2) DrKit `_v` for the CPU count (engine.js:2576), else `act` reads `live()` as 1. (3) KitP: one `Float64Array` in `KIT` order (or 160
fields) — pick by the JSC A/B over every drum row (d8p, d6p, d9p, dvp: PatchP's `drum` field now holds two classes); add DrumP's shape
pin. (4) The warm-up's kit round inside `warmDrums`' try after :3839; engine-track :1403 / :1678; warm-up time ≤ 1.1 ×. (5) dkp / dkx in
bench-scenarios beside `drumTrack` (:679–705) as `kitTrack(GROOVE, vals)`; dki in engine-track as d8i (:1087); cv-cost.test :92's pin.
(6) An offline render of a kit through smprender's worker is not silent (phase 0 put kit-dsp.js on its list; a test proves it).
**S.** (7) DrSeq `fireK` before dr-seq.js:327; the four's `fire` / `fire9` / `hook` byte-identical (ref-7a…7d). (8) `valid`: `vl` an
integer-typed array, `len ≥ 16 · mOff[n]`, else the plan refused (one warning, :216's rule). (9) drum-core: `isKit(D)` by `D.m`;
`toNotes` → kit-core's on `plan.vl`; `rollPlan` = the kit's compilePlan; `rollOpts` → `{ swing: D.x.swing, prim }`; `drumRows(map, model,
D)`; the kit's own 16-bit masks (the family's `maskIn` is 12-bit, :247). (10) `PERS.kit` deep-frozen with `sounds` `ka`…`kp`, `sids`
0–15, `names` neutral ("Drum 1"…: every name a person sees comes from `names(D)`). (11) cv-drum: `machOf` (:213), `sessOf` (:268) and
`fresh` (:267) learn `'kit'`; its gate (:262) passes by `keys: []` — a test that main's `drumOf` keeps a kit record's identity across calls
(H's sim). (12) pads-core: `soundName(s, model, D)` (:202), `sidOrder` (:396) and `drumNote` (:216) by `D.ty` (present voices only).
(13) `normKit` bounds `ty` 0–6, `nm` ≤ 16 chars, cells sparse / sorted / unique; `reconcile` returns the same object when nothing changes
(no persist, no repost after a no-op undo). (14) `tests/kit-fixtures.mjs`' GROOVE is phase 0's: S's tests import it.
**F.** (15) Copy, do not import: `plainFace` (cv-mods-ui.js:176), `editor` (:389), ccBody's widget wiring (:476), `combRecipe`'s numeric
row (:559–566), combBody's head segs and `ctl()` (:583–620), `ensureModCSS` (:167) → `KIT_CSS`; wk's `knob` / `menu` / `numBox` / `seg`
(wk.js:323, 577, 937, 1080). (16) The heard time: `api.step` / `api.lit` (cv-drum.js:431–450) → one `wk.frame` paint (cv-drum.js:523's
idiom); counters `kitStats { paints, grid }` as `drumStats` (cv-drum.js:252) for G9. (17) `safeAssert` from tests/serum-ui-stubs/dom.js:20.
(18) `KIT.TINT` ≥ 3 : 1 on the three skins' screen colours (read from style.css's blocks in the test, as LC's tint test). (19) The voice
face's elements: count wk.knob's (8 knobs + head + bar ≤ 150; MOD1's plain faces are ≤ 48 each, G5) before committing to the 236 px face.
**U.** (20) The Drums view (cv-tray.js:609–610) keeps `layout: 'hw'` for the classic machines' drops; the kit's sections and its
`KIT_TILES` group as `RIG_TILES` / `MOD_TILES` (:689, :718) — the `o.parts` groups are the rig's (`OWN` :969), so a group of its own; the
kit tile's meta off the drum machines' (`DRUMS(m)` :799); cv-art's tile + glyphs (MODELS.length counts follow).
**H.** (21) The render branch: a drum model renders a hardware panel; the kit must take kit-ui's before that path (beside main.js:2852's
`isSxModel` branch) [R?: the lane pins the panel lookup it must skip]. (22) The `'pm'` dispatchers: main.js:6905, 7016, 7043, 7220–7223,
7252, 7348, 9776 (cvDevices), each `isKitDev(t, q.dev) ? kit : patch`. (23) `rigMark` (:8768) `|| isKitDev`; nothing else for the skins.
(24) `heavyOf` (:8427) a `'kit'` kind (PT_HEAVY's line and words, once a session). (25) keepDevs :1963 (`&& d.model !== 'kit'`); `kitBack`
beside sxBack / drBack / ptBack (:1979, 2007, 2014); reconcile after every restore. (26) `kitKnob` = `ptKnob` (:9875). (27) `cmbMarkList`
(:10310) → `drumRowsOf(tr.dev[dev])`; roll.js:60 passes `dev.drum`; `drumAudible` (:4663) the kit's branch. (28) cv-pads `lookOf` (:116) /
`defaultsOf` (:126) for a kit: its present voices, `KIT.TINT` → `nearestColor`. (29) The nid quirk (HANDOVER §0: `normTrack` raises
`nid` past the highest device number) does not touch the kit — its voices are lay sub-keys of one device — but a sim saves and reloads
a kit project and checks every `iN/k*` place survives.
**G / reviewers.** (30) ui-bench-wc's scene whitelist (:293) and ui-bench-fps's `SCENE_IDS` (:62) / `EXPECT` gain the kit; reviewer 1 opens
a kit project in a scratch worktree of ⟨B⟩ (read-only, no throw), feeds a `vl` of the wrong length and a `ty` that disagrees with vals
(reconcile wins).

### 14.4 P3 — wording, trims, records
- P3-1 Every stale pin re-pinned (§14.1); ROADMAP :39 / :90 / :118 / :127 → :49 / :92 / :120 / :129.
- P3-2 `ls` dropped (the identity; layering in cut 2 goes through `tr` in compilePlan).
- P3-3 §5.2 "the Mod list" dropped (no modulation onto a kit in cut 1); "Demo beat" dropped from §5.5's notice list.
- P3-4 §7.3's "the lamps ride `wk.clock`" was wrong: the drum host's pump is a one-shot `wk.frame` (cv-drum.js:260); kept that way (§4.2).
- P3-5 G9's "IMPL-P's method" named: the two harnesses that exist (ui-bench-wc, ui-bench-fps), a lane G for them (LC's G6 precedent).
- P3-6 Schema 18 kept against LC's no-step choice, with the reason (§5.6): an old build drops a kit's whole `dev.drum`, a combiner it kept.
- P3-7 G1's list completed (golden-lc, ref-LC, ref-SX0, ref-1c, ref-p1, ref-9-core); the safe-assert pointer (§9.3) — CLAUDE.md's line
  "tests/serum-ui.test.mjs has a safe assert wrapper" is stale since SX0 (the lead may fix it; not this doc's).
- P3-8 The light-show skin (cut 2's lamp pulses) does not exist yet (HANDOVER §0 queue (3)); a gliding playhead is a cut-2 option.
- P3-9 **Trims if a lane runs long** (cut 2, in this order): the Deep / Tight / Crunch kits (the Starter alone; data later); the keyboard
  grid's M / S keys and Shift-drag (arrows, Space / Enter stay: G10); the voice tile on a non-kit canvas (the kit tile, then "+ ADD
  DRUM"); the TYPE menu on an existing voice (Remove + add does it). Nothing else in cut 1 waits on them.

### 14.5 Final lane plan
Phase 0, the lead on Opus 5.5 at ⟨B⟩ 615713d (one commit): kit-core's `KIT` data and stubs, the model (MODELS[18]), drum-core's
five-way stubs (`isKit`, `PERS.kit`, `drumRows`' `D`), cv-mods' skip and refusal, schema 18, the cost and art placeholders, a stub
`kit-dsp.js` on all seven DSP lists after dr-808.js, `tests/kit-fixtures.mjs`, the §9.4 pins, precache — every test green, one file at a
time. Phase 1, four lanes in worktrees reset to it: **V** (Opus 5.5: kit-dsp body, engine, cost, goldens, bench), **S** (Opus 5.5:
kit-core, drum-core, dr-seq, cv-drum's host part, pads-core), **F** (Opus 5.5: kit-ui, rig-grid's two numbers, the layout gate and
contact sheets), **U** (Sonnet: cv-tray, cv-art) — exclusive files, no style.css, no cv-module.js. Phase 2 on their merge into `wt-DM`:
**H** (Opus 5.5: main.js, roll.js, cv-pads.js, the DM sim). Phase 3: lane **G** (Sonnet: the two frame harnesses) ∥ reviewer 1 (Opus 5.5,
the real engine + sims) ∥ reviewer 2 (Opus 5.5, Chrome for Testing at the three sizes) → one fixer (Sonnet / Opus 5.5, failing test
first) → `tools/sweep.sh` once → the contact sheets to the user → squash onto `canvas`, deploy. Cut 1 keeps its scope; P3-9's trims are
the release valve, in that order. H is the long pole (≈ 25 main.js sites, all listed in §0 / §14.3); P1-2 / P1-4 / P1-5 took the
cv-module, style.css and cross-lane list edits out of it.

### 14.6 Questions for the user
None — the answers of 2026-11-01 cover every decision this re-plan touches; the rest are the lead's [C]s.

## The user's answers (2026-11-01)
- **Layout**: the step grid + a module per drum (as proposed).
- **Cables**: not at first (as proposed).
- **Start**: **an empty grid** — a new machine opens with no steps set (the starter kit's 8 drums loaded, pattern A empty). Changes the
  proposal's "simple beat": the tile's starter pattern goes; the tutorial (row 20) builds the beat from the empty grid.
- **Sounds**: our own synth drums first; samples in cut 2 (as proposed).
- **Name** (lead, first guess): the display name is derived from the one name constant (`RIG.NAME` + ' Drums') — never a second literal.
- **Models** (lead): no Fable lanes (the user's budget rule, 2026-10-19) — the skeptic and phase 0 on Opus 5.5.
