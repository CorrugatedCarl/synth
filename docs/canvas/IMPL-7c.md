# Stage 7c: the TR-909 drum machine (IMPL-7c) — contract

The user, 2026-10-20 ([PROPOSAL-drums.md](PROPOSAL-drums.md), answers): the order **TR-808 → TR-606 → TR-909 → Simmons SDS-V**; (1)
**our own sounds through the machine's real playback circuit**, labelled as ours, plus **"load your own sounds"** — for the 909 the
proposal named this case: its analog drums are circuits we model, its hi-hats, crash and ride were short recordings played from ROM,
so "we keep the 909's real playback circuit and feed it our own metallic sounds, clearly labelled as ours" (proposal §1, question 2);
(2) the **authentic panel** (original art, no logos, no maker names) + an **extras strip that starts neutral**; (3) **mix output
first**; (4) **both ways** (the machine's own sequencer, and named drum rows in the piano roll that play it). 7a's answers (IMPL-7a
§13: follow the song by default, roll notes and pattern both play, undo like the TB-303, GM drum rows) and 7b's (IMPL-7b §13) stand
for the whole family and apply here unchanged. The proposal also promised "on the 909 the real step keys also work as tap pads, as
on the hardware" (§2) and "a bigger sequencer (shuffle, flam, accent per step)" (§4).

Design inputs: this stage's appendix [research-909-circuits.md](research-909-circuits.md) (**R9 §n**: the 909's circuits, its
sampled-voice playback path, its sequencer and panel, from published facts in our own words); [IMPL-7b.md](IMPL-7b.md) (**7b §n**)
and [IMPL-7a.md](IMPL-7a.md) (**7a §n**) — their §14 as-built notes and §15 review logs are the reference for what exists;
[research-808-circuits.md](research-808-circuits.md) (**RC**), [research-606-circuits.md](research-606-circuits.md) (**R6**),
[research-drums.md](research-drums.md) (**RD**, §3 A2 — superseded by R9 where they differ). ROADMAP and its feedback rows win where
they differ. Code references are to `canvas` at **7b297e5** (the 7b commit; they drift, the names do not). Sections 0–10 are the
contract, §11 the lanes, §12 the gates, §13 the questions for the user, §14 the builders' notes, §15 the review log.

**Every number is tagged**: **[R]** from research (with its R9 section; **[R?]** a secondary or conflicting source, or a value the
sources do not give — lane V9 pins it, R9 §15) and **[C]** a choice made here (a builder may refine a [C] with a reason in §14, never
an [R] without a source).

**Invariants of the stage**
- **D1 Old sound bit-identical — the 808 and the 606 are old sound now**: every golden shard (`golden-classic`, `-fx`, `-presets`,
  `-random`, `-graph`), `canonical-stream`, **`golden-drums` against the frozen `tests/ref-7a/`** and **`golden-606` against the
  frozen `tests/ref-7b/`** (both untouched, their `PIN`s unchanged: tests/golden-drums.test.mjs:30, tests/golden-606.test.mjs:37),
  `tests/dr-808.test.mjs` and `tests/dr-606.test.mjs` unchanged and green, the bench rows' outputs. `dr-808.js`, `dr-seq.js` and
  `engine.js` may change only so that every ref-7a and ref-7b case renders bit-identically (those two tests render the frozen three
  against the current tree: they guard every refactor below). The 808's and the 606's patch, payload, plan, record and session keep
  their exact shapes (no key gained: the 909's discriminators are absent on theirs) — drum-core's 808 pin (tests/drum-core.test.mjs:
  902, `04ba14f6…`) unchanged, and **a 606 pin of the same kind taken at 7b297e5 before any change** (§12.3).
- **D2 New sound frozen**: the 909 is pinned at the acceptance commit by **`tests/ref-7c/`** (verbatim `dr-808.js`, `dr-seq.js`,
  `engine.js` + `MANIFEST.json`, ref-7a's mechanism) rendered by a new **`tests/golden-909.test.mjs`**; from then on ref-7a guards
  the 808, ref-7b the 606 and ref-7c the 909, so the SDS-V (7d) and later machines keep all three. The 909's source material (§2.4)
  lives inside `dr-808.js`, so ref-7c freezes it with the circuits.
- **D3 One instrument per track, one output**: the 909 is a track's instrument with one `out` jack (the mix). Its individual outputs
  (R9 §10) are drawn on the panel as `inert: 'later'` jacks ("cable-able with full patching (stage 4)", 7a §7.1's form); its MIDI,
  sync, tape-sync and trigger-out sockets and its cartridge slot are print or dimmed (§7.1).
- **D4 Original content**: no Roland recordings — **the 909's cymbal and hi-hat ROM data is never used, fetched, analysed or
  approximated by resynthesis-to-match** (RD §2.5 rule 1) —, no schematics, manual text, logos, maker names or wordmark lettering;
  our own source material for the four sampled sounds (§2.4), made by our own tool from our own recipes and labelled "our own
  cymbal and hi-hat sounds through the 909's playback circuit" on the tile, the about text, the extras caption and SOUNDS…; DEMO
  patterns written for this project.
- **D5 Both ways are one sound** for the 909, as 7a §D5 / 7b §D5: its pattern through its sequencer and the same pattern written by
  "→ Piano roll" render **bit-identically** where step frames are whole numbers (120 BPM / 48 kHz), on the same or the next 4-frame
  grid point elsewhere — **at every SHUFFLE, with every FLAM, and with the per-step instrument accents and the total accent** (each
  a whole-tick position and an exact velocity on both paths, §3.4–§3.5, §4).
- **D6 Budgets**: §2.7's rows on the Mac (V8), the JSC shell and the iPad; no allocation on the audio thread; a silent machine
  ≤ 0.0005; the source material built once per scope, never on a hit or a patch (§2.4).
- **D7 Determinism**: hits, the noise, the sample clocks and the source material are functions of the transport, the plan, the
  tempo and the salt; offline bounce = live; **the source material is the same bytes in every JavaScript engine** (§2.4: stored as
  data, never computed from `Math.sin` / `Math.exp` at run time).
- **D8 Reuse, not fork**: the 909 adds **no** Inst kind, worklet script, message type, store, cable or DSP-list entry. It is a
  **machine descriptor** in `dr-808.js` (§2), a **personality** in `drum-core.js` (§3), additions to `DrSeq` that are inert for
  the 808's and the 606's payloads (§3.5), a **panel** (`panels/tr909.js` + cv-drum's 909 widgets, §7) and data entries (models,
  classes, costs, tray, art, bench). Every machine test in shared code becomes **three-way by the machine id** — today's `=== 'tr606'
  ? 606 : 808` tests (§0's list) would read a 909 as an 808.

## 0. What 7a / 7b built, and what 7c does with it (read at 7b297e5)

| piece | where | 7c |
|---|---|---|
| Inst kind `'drums'`: the machine boundary, `drOn`, `drFail`, `drGain`, `drUnits`, `drPost` (a machine-change tail on its own chain), `fadeDrums`, `drHit`, `drSeqMsg` (+ `drPend` by machine), `drClock`, `drStep`, `renderDrums`, `drMon` | engine.js:1917–1950 (setPatch: `mch` 1924, `rebuild` 1931, the `drOn` guard 1947), 2137–2328, 2534 / 2698 (`noteOn` / `noteOff`), 2804 / 2809 / 2823 / 2849 (transport, `seqMsg`, `seqRelease`, `seqEvents`), 4263 / 4281 (monitor) | **reused as is**: every one of them is generic in the patch's `machine` string — `drOn` builds `Dr808.create(this, p.machine)` into the per-kind cache `dmL` (2138–2146), `drGain` calls `Dr808.gain(p.machine, p.drum)` (2165–2170), `drSeqMsg` keeps a payload for another machine in `drPend` (2238–2250), `mch` is any machine change (1924) and so is `drPost` (1927). A third machine needs no engine branch but its warm-up round and its new `DrumP` fields (§1.5) |
| `DrumP` (the patch's flat `drum`, one fixed shape for every machine) | engine.js:1355–1371; `PatchP.machine` 1378, `PatchP.drum` 1395 | gains the 909's new ids (§1.1), defaults its panel's |
| the drums warm-up | engine.js:3288–3348 (`warmDrums`: the 808's round, the 606's round from 3318), `WDRUM` 1452, `WMASK` 1456, `WDRUM6` 1458 | a **909 round** after the 606's (§1.5) |
| the machine shell: one `create(inst, kind, opt)`, a descriptor per machine (`MACH` 2382), `gain(kind, d)` 2388, `mach` 2999 | dr-808.js:2382–2997 | `MACH.tr909` and a **third branch at each machine selection inside `create`** (they are made once, at create: no hot loop changes), the 808's and 606's functions untouched (§2.1). The selections: 2398 (`X`), 2400 (`is6`), 2413 (the tempo clock), 2424–2431 (voices, render order, circuit map), 2443 / 2460 (noise, `setRate`), 2474 (`knobOut`), 2530 (the bank's trackers), 2629 (`whiteRange`), 2696 (`sources`), 2702 (`readTargets`), 2731 (`retune`), 2784 (`apply`), 2798 / 2814 (the sample lanes), 2907–2914 (`hit`), 2915–2930 (`trig`), 2954 (`post`), 2959–2966 / 2967–2978 (`reset`, `mon`), 2991 (`_v`), and `gain` 2390 |
| the shell's shared parts | dr-808.js: latches (`latch` 2743), the chunked render with knob glides (`render` 2931), the sleep rule (`Voice` 349, `THR` 62), the hashed noise (`white8` 2602, `noiseWake` 2646), the sample slots (`SL` 2436, `smpHit` 2789, `smpCut` 2804, `smpRender` 2805), `mon`, `smp`, `setSalt` | **reused**: the 909's voices are `Voice`s, latched and applied in lane order, asleep below 1e-5 of their trigger scale, rendered per absolute 4-frame chunk; its analog sounds' "load your own" slots are 7a's (§5) |
| the blocks | dr-808.js: `kBil` 117, `bil1` / `bil2` 123–133, `skHP` 135, `Lin` 153, `BT2` 188, `hash32` 200, `vle` 212 (Werner's swing VCA), `tapA` / `tapC` 93–94, `bandH` 329, the 606's `btDesign` 1803 / `rail6` 1840 / `pot6` 1838 | **reused by the 909's voices** (§2.2): `Lin` for every small linear network, `bil1` / `bil2` / `skHP` for the fixed filters (the Sallen-Keys of the snare, the click, the rim shot and the ROM voices' reconstruction), `BT2` / `btDesign` for the rim shot's three resonators, `rail6`'s soft rails; new: the triangle VCOs (integrator + comparator, reset at the hit) and their diode shapers, the transistor VCAs, the digital noise, the ROM path |
| the 808's rim shot and clap (`RimClaves` 929, `Clap` 1137) | dr-808.js; their tables `RS` 256, `CP` 265 | **not reused**: the 909's rim shot is three bridged-T resonators into a diode clipper (the 808's: two generators), its clap the 808's structure with its own values and the digital noise (R9 §5–§6) — classes of its own; **no 808 or 606 class is edited** (7b's "reuse at the block level" rule, IMPL-7b §14 lane V6), so their hot loops and bytes cannot move |
| the DX7's DAC staircase (a held value laid onto the OS grid with every step at its true fractional time: 2-point polyBLEP, one grid sample late) | engine.js:2758–2790 (`renderDac`), `blep` 56 | **the method** of the 909's ROM playback (§2.3): the address counter's clock is not a multiple of the OS rate, so every DAC step is placed at its fractional time — re-written inside dr-808.js (the DX7's is an Inst method), never a naive sample-and-hold (aliasing) |
| `DrSeq` | dr-seq.js (all): `valid` 90, `sameShape` 111, `set` 142, `take` 174, `tickOf` 201, `geo` 202, `locate` 212, `boundary` 234, `fire` 256, `events` 284, `restart` 317 (7b), `clock` 320 (7b), `simplePlan` 337 | **unchanged** for the clock, sync, live plan changes, TAP fills, STEP RESET (7b); three additions and two flags, each inert for the 808's and the 606's payloads (ref-7a, ref-7b guard them): a plan's **per-step instrument accents** passed to `dm.trig`, a plan's **per-measure shuffle** in ticks, **flam hits** as events of their own, `once`, `guide`; the plan bounds raised (§3.4–§3.5) |
| `drum-core` | `PERS` 105 (a table per machine), `machineOf` 279 / `is606` 284 (the dispatch), `normDrum` 258, `normMap` 215 / `normSmp` 230, `mapTable` 155 / `primaries` 161 / `drumRows` 167 (the global `SOUNDS` / `SOUND_NAMES` 59–60), `compilePlan` 381 (+ `plan606` 455), `toNotes` 508, `payload` 544 (+ `payload606` 553), `pkOf` 562, `initState` 578, `press` 636 (+ `press606` 924), `leds` 851, `gridPat` 593, `stepLen` 839, `demoFree` 847, `freeBpm` 200, `withTempo` 204, `audible` 341 / `soundMute` 346 | **a third personality**: `PERS.tr909` and a three-way dispatch on the record's `m` (§3); the name tables move into `PERS` (`PERS.<m>.sounds` / `names`, the 808's and the 606's equal to today's globals: their bytes unchanged) because the 909 names sound ids 7 and 8 differently (§1.2); `toNotes` learns per-step velocities, shuffle and flam from the plan (§4) |
| cv-drum (host + widgets) | `drumHost` 171 (`fresh` 181, `sessOf` 182 — `Array.isArray(S.held)`), `drumPanel` 355 (`M` / `six` / `SIDS` 361, `FB` 365), `UI` 133, `machOf` 138, `loopHint` 152, the shared widgets (step keys + LEDs, held states, TAP at the press, rotaries, the grid canvas, pads, popovers) | `UI.tr909` + the 909's widgets (§7.4); `machOf` / `sessOf` three-way (a 909 session carries `m: 'tr909'`) |
| cv-panel | `TOKENS` 77–117, `RENDERED_TOKENS` 120, `TOK_CELL` 130, `tokCell` 139 / `xbreakOf` 140, `XCAPTION_DRUMS` 142 (a layout's own `extras.caption` wins, 627), the `inert: 'later'` jack (7a), `drp()` (1639 / 1680 / 1716) | `TOKENS.tr909` (§7.2), the caption from the layout (§7.5) |
| models / classes / costs / art / tray | models.js:731–797 (`tr808`, `tr606`, `MODELS` 798); cv-mods.js:173 (`CLASS_TABLE.tr606`); cv-cost.js:87; cv-art.js:37–38 / 286 / 307; cv-tray.js:334 (`DRUMS`), 342 (the Drums view's note) | one more entry each (§1.1, §8, §9); the note → "More machines later: the Simmons SDS-V with the pad controller." |
| data and history | song.js:548 (`isDrum` by `PERS`: the 909 joins), 570 (`normDrum(d.drum, o.model)`), 795 (channel 10); main.js:147–151 (`drumOf`, its guard 150), 208 (`normDevs`), 1784–1815 (`setTrackModel`), 3217 / 3222 (`drumPayload` / `drumSend`), 3258 (`drumEdit`), 3299–3329 (→ Piano roll), 3335–3339 (`drTempoOf` / `drTempoPut`), 3394 (`offer303`); roll.js:53–55 (`drumRowsOf`); cv-migrate.js:90 (`SCHEMA = 9`) | the model passed where 7b passes it already; **the binary tests made three-way** (main.js:150, 3335–3338); schema 10 (§6) |
| tests / refs | `golden-drums` + `ref-7a`, `golden-606` + `ref-7b`; `dr-808`, `dr-606`, `dr-seq`, `drum-core`, `cv-drum`, `canvas-7a-sim`, `canvas-7b-sim`; bench d8*, d6*, `bench.html` c7 / c8 (146–148), `drumTrack(rows, vals, samples, model)` (bench-scenarios.mjs:261: a binary `six` at 262) | all kept; the tests that pin the drum list or the schema have owners in §11 (canvas-7a-sim:68, canvas-7b-sim:77 and 487, cv-tray.test:566 / 568 / 590, classic-panel.test:253, cv-panel.test:43 / 46, cv-migrate.test:27); **new**: `dr-909.test`, `rom909.test`, `golden-909` + `ref-7c`, `canvas-7c-sim`; d9p–d9i, c9 (§12) |

**The binary machine tests a third machine breaks** (each `=== 'tr606' ? … : 808` reads a 909 as an 808; every one becomes a
lookup by the machine id, the 808 and the 606 answering as today): dr-808.js:2390 (`gain`), 2398–2400 (`create`); drum-core.js:279
(`machineOf`), 284 (`is606`) and every `is606(D)` / `model === 'tr606'` dispatch (200, 206, 216, 234, 382, 545, 579, 594, 637, 840, 847, 852);
cv-drum.js:138 (`machOf`), 182 (`sessOf`), 361 (`six`); main.js:150 (the record / model guard), 3335 / 3337 / 3338 (→ Piano roll's
tempo undo); tests/bench-scenarios.mjs:262 (`six`). engine.js has none (it carries the machine as a string). **And the global
name tables** (the 808's sound codes read as every machine's — right for the 606, whose sounds are a subset, wrong for the 909's
ids 7 / 8): drum-core.js:155–171 (`mapTable`, `primaries`, `drumRows`), 215–238 (`normMap`, `normSmp`), 535–537 (`slots`);
cv-drum.js:76 (`SOUND_CODE`), 306 (`pads.on`), 775–777 (the pads' codes and names), 786 (a pad's slot title), 825 (the lit
pads), 853–856 (MAP…), 866–867 (SOUNDS…); main.js:160 (`drumNeeds`), 3447 (`drumLoad`'s memory sum) — each reads
`PERS[machine].sounds` / `names` instead. **Also binary (review #13, #14)**: cv-drum's `six` (361) feeds ≈ 20 `six ? 606 : 808`
branches (158, 329, 364, 529, 625, 645, 666–733, 773–779, 883–892) — a 909 panel would take the 808's grid, pads, texts and
cancel rule at each; tests/bench-scenarios.mjs:267 / 269 (the bench's slot names `DC.SOUNDS`, the graph key `'d6' : 'd8'`);
**and two tests use `'tr909'` as the unknown machine** — tests/drum-core.test.mjs:1001 (`normDrum({ m: 'tr909' })` must read
as the 808's) and tests/engine-track.test.mjs:1163 (a `machine: 'tr909'` patch must build no machine and post `drumsErr`):
both fail the day `PERS.tr909` / `MACH.tr909` exist; their owners swap the id for another unknown one (`'tr999'`: the same
check, not weakened — §11).

## 1. The third machine in the family

### 1.1 The model `tr909` and its patch

- `models.js` gains **`tr909`**, appended after `tr606` (every earlier index unchanged): `name 'TR-909'`, `model 'Rhythm Composer'`,
  `maker 'Roland'` (a model label, never on the panel or tile, D4), `year 1983`, **`family: 'drums'`**, `tag 'Drum machine · 11
  sounds: 7 analog voice circuits, hi-hats and cymbals from 6-bit chips (our own sounds) · per-voice and total accent · 16-step
  sequencer with shuffle and flam'`, `about` ("Our circuit-level model of the TR-909's analog voice circuits — no recordings of any
  machine; its hi-hats, crash and ride play our own cymbal sounds through a model of its 6-bit chip playback circuit. …"), `theme`
  (§7.1), `presets` (§2.6).
- **Controls** — 28 knobs, `K(id, label, 0, 10, def)`, no switches; the face's nine blocks (R9 §13):
  - TOTAL ACCENT **`ac`** (def 5); BASS DRUM **`bdu`** TUNE, **`bdl`** LEVEL, **`bda`** ATTACK, **`bdd`** DECAY; SNARE DRUM **`sdu`** TUNE,
    **`sdl`**, **`sdt`** TONE, **`sds`** SNAPPY; LOW / MID / HI TOM **`ltu ltl ltd`**, **`mtu mtl mtd`**, **`htu htl htd`** (TUNE, LEVEL,
    DECAY); RIM SHOT **`rsl`**, HAND CLAP **`cpl`**; HI HAT **`hhl`** LEVEL, **`chd`** CH DECAY, **`ohd`** OH DECAY; CYMBAL **`crl`** CRASH
    LEVEL, **`rdl`** RIDE LEVEL, **`cru`** CRASH TUNE, **`rdu`** RIDE TUNE; **`vol`** VOLUME (def 7.5). Levels def 7, the rest 5 [C] — (review 1 F1, the lead's loudness decision:
    the kick 9, snare and hi-hats 4, clap 1.5, crash 3, ride 3.5, the toms and RS 7; §14 "Fixes").
  - The ids the 808 / 606 already have mean the same thing (one `FIELD_CLASS` entry each: TUNE / LEVEL / DECAY / TONE / SNAPPY and
    the 606's hat level and decays); **new: `bda mtu mtd crl rdl cru rdu`**.
  - TEMPO, SHUFFLE / FLAM and every key are sequencer state (§3), not models.js controls (7a §2.3).
- **`map`** → `{ engine: 'drums', machine: 'tr909', drum: { …every knob 0…1 by id… }, level: 1 }` (7b §1.1's shape).
- Every `family` filter (tray, Simple-layout paths, golden-graph, smpgen, integration, cv-tray's test) covers the 909 with no edit;
  the sites that name `'tr606'` binarily are §0's list.

### 1.2 Lanes and sounds: the 808's space, its own names for two ids

The 909's twelve sequencer rows use **the 808's lane bits and sound ids** [C, D8] — the plan, the payload, `DrSeq`, `dm.trig` /
`dm.hit`, mute / solo, the sample slots and `toNotes` run on them unchanged; the one difference is that **sound ids 7 and 8 are the
ride and the crash** (the 808's cowbell and cymbal slots — the 909 has neither):

| INSTRUMENT (R9 §12) | AC | BD | SD | LT | MT | HT | RS | HC | CH | OH | CR | RD |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lane bit (= 808's) | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 11 | 10 | 9 | 8 |
| sound id | — | 0 bd | 1 sd | 2 lt | 3 mt | 4 ht | 5 rs | 6 cp | 10 ch | 9 oh | **8 cr** | **7 rd** |
| per-voice accent | — | ✓ | ✓ | ✓ | ✓ | ✓ | | | ✓ | | | |
| flam | — | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | | |
| default notes (§1.4) | — | 36, 35 | 38, 40 | 41, 43 | 45, 47 | 48, 50 | 37 | 39 | 42, 44 | 46 | 49, 57 | 51, 59 |

- Every sound list stays **16 long, indexed by sound id** (7b §1.2's rule); `PERS.tr909.sids = [0 … 10]`, `mask 0xFFF`, the accent
  lanes `0x83E`, the flam lanes `0x03E`. **Names move into `PERS`**: `PERS.<m>.sounds` (the record's map / slot keys) and `.names`
  (the roll's rows, MAP…, SOUNDS…, the pads) — the 808's and the 606's exactly today's `SOUNDS` / `SOUND_NAMES` (their records and
  payloads unchanged), the 909's `['bd', 'sd', 'lt', 'mt', 'ht', 'rs', 'cp', 'rd', 'cr', 'oh', 'ch', …]` / `['Kick', 'Snare', 'Low
  tom', 'Mid tom', 'Hi tom', 'Rim shot', 'Hand clap', 'Ride', 'Crash', 'Open hat', 'Closed hat', …]` [C]. **Ids 11–15 keep the
  808's keys** (`lc mc hc cl ma` and their names: every `for (const s of sounds)` loop, `slots()`, `normMap` and `in` test stays
  total — no `''` / `undefined` key in a record) and are inert as the 606's absent sounds are: `[]` in the 909's map, never a
  slot, never a row, never in `sids` (review #12). The global exports (`SOUNDS`, `SOUND_NAMES`, `DEFAULT_MAP`, `LANE_SOUND`, …)
  stay as they are (= `PERS.tr808`'s): golden-drums / golden-606 / the bench import them. The sites that read the global tables
  are §0's list.
- **Circuits**: BD, SD, LT, MT, HT, RS, HC (seven analog circuits), **the hats (one voice, two sounds** — R9 §9: one counter, ROM and
  VCA, a CLOSED / OPEN select), crash, ride (two ROM voices). Latching as 7a §1.2: one trigger per circuit per chunk, applied in lane
  order — so an OH and a CH latched in one chunk play the **closed** hat (its trigger last; they never sound together on the 909)
  [C, R9 §9].
- A note or step for a sound the 909 lacks (ids 11–15) never reaches it from its own map; a hostile payload's is ignored (`HAS9`).

### 1.3 The trigger and the two accents (R9 §1, §8)

- **The trigger is a fixed pulse**: +5 V, **2 ms** at the voice's latch [R]; in each analog voice it becomes an unaccented +15 V
  pulse that resets the VCOs, forces the comparators and charges the pitch envelopes, while an accent switch passes **the voice's held
  accent voltage** to its envelope capacitors for the pulse's length (they charge to ≈ V_acc − 1.2 V) [R MW1]. **Accent is not the
  trigger's height** (≠ the 808 / 606, 7a §1.3).
- **The accent DACs** [R SN9, MW3]: eight 6-bit codes, each held until the next write — BD, SD, LT, MT, HT, HH, **RS + HC shared**,
  **CRASH + RIDE shared**; code → 0–5 V (binary weights [R?]) → ×3.13 in each analog voice (≈ 0–15.6 V, soft-clipping near code 52–56
  [R?]); in the hats and cymbals into their log / anti-log converters (§2.3). **A held level acts between hits**: a ride hit rewrites
  the shared level a ringing crash is reading, an RS hit the level the clap's next burst reads [R topology] — modelled.
- **The four states of a hit** and their codes [C, the values fitted by V9 — R9 §15]: **normal** `N0`; **per-voice accent** `N0 + L`
  (BD SD LT MT HT CH only; else = normal); **total accent** `N0 + T(u)` with `T(u) = round(T_max · u)`, u the TOTAL ACCENT knob 0…1
  (VR1, linear, read by the CPU); **both** `min(63, N0 + L + T(u))` (else = total). Fits: `T_max` to the measured spans (BD +6.2 dB …,
  R9 §8), `L` to the closed hat's ≈ +4.4 dB, `N0` so that both at full TOTAL ACCENT reaches the buffer's clip (the manual's "may not
  be noticed"); one `N0` / `L` / `T_max` for every voice [C]. The sequencer sends the state (§3.5: `trig(mask, acc)`: the AC bit =
  total, `acc` = the per-voice lanes); the machine turns it into each voice's code; a shared DAC latched by two voices in one chunk
  takes the higher code (7a's "highest volts wins") [C].
- **Velocity → code** (`vTrig9`, one law for roll notes, MIDI, the keyboard tray, the pads; the machine's, copied into drum-core with a
  test, as `vTrig`) [C]: at the current TOTAL ACCENT, the four states' codes sorted — `normal ≤ min(per-voice, total) ≤ max(…) ≤ both`
  — sit at **v 100, 110, 119, 127**; between two of them the code is the linear interpolation rounded to an integer (the DAC's);
  below 100, ghosts: `round(N0 · (0.6 + 0.4 (v − 1) / 99))`. So a louder velocity is never a weaker code, and every state has an
  exact velocity: → Piano roll writes **100** (normal), **127** (both), and **110 / 119** for per-voice and total accent in the order
  their codes take at the knob (a voice without per-voice accent: 100 / 127) — `vel9(sound, state, u)` in drum-core, its inverse in
  the machine; the two agree on a grid of u (a test, §12.3). **Open (review P-1, the lead's)**: this rank law makes a written
  note's state depend on TOTAL ACCENT — notes written at one knob position swap per-voice and total accent when the knob (or a
  cable on `drum.ac`) crosses `T(u) = L`, while the sequencer does not; the alternative is fixed velocities per state.
- The 909's own MIDI receive treats a note as a trigger (velocity's effect undocumented, R9 §11) [R]: our law is ours, as 7a's.

### 1.4 Notes into hits

Unchanged (7a §1.4; engine `drHit` 2227): the payload's map → a sound → mute → `dm.hit(sound, v127)` latched at the event's frame.
**The map** (`PERS.tr909.map`): the 909's own receive notes [R SN9] — **bd 36** (+35), **rs 37**, **sd 38** (+40), **cp 39**, **lt 41**
(+43), **ch 42** (+44), **mt 45** (+47), **oh 46**, **ht 48** (+50), **cr 49**, **rd 51** — which are the General MIDI numbers (7a §13
answer 4), + GM's crash 2 (57) and ride 2 (59) as aliases [C]. Before a payload the Inst uses `DrSeq.DEF_MAP` (the 808's: on a 909,
51 plays nothing and 56 the ride until the payload — a render farm or cost probe only) [C, 7b §1.4's rule].

### 1.5 The engine (lane E9)

Nothing in the drums kind is machine-specific any more (§0): `PatchP.machine` carries `'tr909'`, `drOn` builds and caches its
machine, `drGain` asks `Dr808.gain('tr909', …)`, `drSeqMsg` routes its payload by `m`, a switch between any two machines is `mch`
(engine.js:1924) with the old machine's tail on its own chain (`drPost`, 7b review 1 #3). What E9 adds:

- **`DrumP`** gains the 909's new ids (§1.1; defaults its panel's); one shape for all three machines (engine.js:1355).
- **`warmDrums`**: a 909 round after the 606's (engine.js:3318–3346's pattern): two panels with every knob off its integers, every
  sound plain / instrument-accented / total-accented / both (a retrigger), OH + CH in one chunk and the choke, the crash and the ride
  at both ends of TUNE (the clocks and the staircase at two ratios), a free plan through `DrSeq` with a shuffle and a flam on two
  lanes (built by `DrSeq.simplePlan(masks, pre, x)` with S9's optional `x = { ac, fl, sh, fm }` — today's `simplePlan` makes no
  909 arrays, so the round could not reach the new DrSeq paths: review #15), an OS change; the round **decodes the ROM images** (§2.4) if no 909 was built yet, so a later first 909 `create` costs ≈
  the 606's (7b: ≈ 1–6 ms) and never a decode. Its cost recorded in §14 (node; the iPad's first-context ready time in the lead's
  session). A missing machine never throws there (7a §10.2).
- **`drClock`** unchanged (the 909 reads no tempo clock: its hats are not tempo-linked, R9 §9).
- **The flam's second hits** reach the machine through `DrSeq` (§3.5) — `seqEvents` returns frames to the next step **or** the next
  pending flam hit (engine.js:2849: unchanged code, DrSeq's `events` answers it); `drStep` (#34) runs for a flam's hit as for a
  step (a note-like event: the rack's RETRIG, lastNote), so the scope note of 7a D5 (empty FX panel, no cables) is enough. A
  flam's second hit posts no `{t:'step'}` (the step's post covers it: the LEDs and COMPOSE-like readers see steps only) [C].
- Nothing else: `drHit` (a note's velocity → the machine's `hit`, which owns the 909's velocity law, §1.3), `renderDrums`, the
  monitor, `postMon`, the Track. **No DSP-list change.**

## 2. The voices (`dr-808.js`, lane V9)

### 2.1 The shell: a third descriptor

- `create(inst, kind, opt)` takes `kind` 'tr808' (also `undefined`), 'tr606' or **'tr909'**, from **`MACH.tr909`**: its knob table
  (ids, defaults, the circuits each retunes, the level knob of each sound), its sids, its lane → sound map, its voices and their
  render order, its output stage, its sample rules. At every machine selection of §0's list the 909 is a third branch **chosen at
  create** (`const sources = is9 ? sources9 : is6 ? sources6 : sources8`, …): no per-sample or per-chunk code of the 808 or the 606
  changes, so their hot loops stay as they are (7b's rule: scalars, not tables, in the loops; one shape per call site).
- **`Dr808.gain('tr909', drum)`** (the engine's `drGain`: VOLUME into the 909's output amplifier, `OUT_K9`, at rest),
  **`Dr808.mach.tr909`** (`{ KNOB_IDS, KNOB_DEF, SOUNDS (16 by sound id), sids }`); `proto.tr909` (the component tables, the
  laws, the ROM decoder and the test hooks); the top-level exports stay the 808's (dr-808.test reads them).
- **Shared** with the 808 / 606 (7a §2.1, 7b §2.1): the per-absolute-4-frame-chunk control work, the latches applied in lane order (the
  CH's choke after the OH's trigger), one trigger per circuit per chunk (the highest volts), the sleep rule (1e-5 of the trigger scale
  for 4 chunks), noise as a function of absolute time (salted; the 909's its own shift register, §2.2), span invariance, the sample
  lanes. **New to the shell**: **held accent levels per voice** (`trig(mask, acc)`: the AC bit and the step's per-voice accents → each
  voice's DAC code, §1.3 — the trigger itself a fixed pulse) and the **ROM path** (§2.3). `trig(mask)` with one argument (the 808's,
  the 606's, DrSeq's call for their plans) is today's.
- **The monitor**: `lit` the sounds by id; `act` in the 808's circuit slots where the 909 has the sound (BD 0, SD 1, LT 2, MT 3,
  HT 4, RS 5, HC 6, ride 7, crash 8, OH 9, CH 10) [C].

### 2.2 The analog circuits (R9 §2–§7; values re-read by V9, R9 §15–§16)

| circuit | topology (R9) | the numbers | blocks |
|---|---|---|---|
| **noise** (shared) | a 31-stage shift register with XOR feedback (taps 31, 13: period 2³¹ − 1), filled with ones at power-up, clocked ≈ 300 kHz; 0 / +15 V bits (§7) | clock 300 kHz [R?: 0.3–0.46 MHz with the parts' spread, R9 §7 — not "± 20 %"] | **new**: the register's bit stream as a function of absolute time — at a wake the state jumps to its absolute position by GF(2) polynomial powers (x^n mod the polynomial: a few dozen 31-bit multiplications), then steps; each OS sample takes the **mean of the bits** inside it (an exact box integral of the piecewise-constant stream: deterministic, alias-reduced); the bit index of OS sample i is the integer `floor(i · f_clk / fs)` with `f_clk` a whole number of Hz (exact below 2⁵³ for days of frames — never a running sum of a rounded ratio, which drifts with the span splits at 44.1 kHz: review #24); the salt an offset into the sequence [C]. **One stream** for SD, BD's click, the toms and HC: the snare / clap correlation is the hardware's [R] |
| **BD** | a triangle VCO (integrator + comparator + ± 1 switch, reset to one phase at each hit) → diode shaper → VCA Q12 with ENV1 (clamped ≈ 2.6 V, a hold ≈ 50–60 ms, then DECAY); a pitch envelope C9 into the VCO's control (TUNE = its decay); the click: a differentiated pulse through a Sallen-Key low-pass + the noise band-passed, its own VCA Q6 (ATTACK) and envelope; summed by IC11a, LEVEL its feedback (§2) | **f_base 49.5 Hz** [R measured; 56 Hz derived — R9 §15 decides], sweep Δf ≈ 216–247 Hz, **τ 6.8–29.4 ms** (TUNE 0–10, C9 0.33 µF), DECAY τ 14–107 ms after the hold; click LP 3.7 kHz Q 3.1, noise 26 Hz–513 Hz; harmonics re H1 −28 / −25.7 / −41 dB [R] | the VCO as a state machine at the OS rate (the comparator's switching instant placed by linear interpolation inside the sample, its ramp's corner band-limited by a polyBLAMP-type correction — 7a §2.1's rule: the alias-free choice is V9's [C]); the shaper a memoryless diode law (`jTab`-style table, 7b); envelopes switched first-order (7a); filters `bil2` / `skHP` |
| **SD** | two triangle VCOs (1 : 1.5) on one CV generator, VCO-1 reset at the hit; a pitch bend on VCO-1 (≈ +216 Hz, τ ≈ 5.7 ms); two tone VCAs (ENV3, ENV2); noise → HP 48 Hz → SK LP 8.5 kHz → (a) HP 1.52 kHz → VCA Q48, ENV4 (TONE) and (b) SK HP 4.05 kHz → VCA Q47, ENV5 (a 2 ms crack); SNAPPY the summing feedback (§3) | VCO-1 117–231 Hz over TUNE (173.5 at 5), ratio 1.500; ENV3 τ 24, ENV2 21 ms; TONE τ 32–76 ms after a 24 ms hold [R] | the triangle VCO above ×2; `skHP` / `bil2`; switched envelopes |
| **LT / MT / HT** | each: three triangle VCOs (1 : 0.667 : 1.8) on one TUNE supply, VCO-1 overdriven at the attack (≈ 32 ms), a two-capacitor pitch envelope on the negative supply (22 ms + 220 ms); DECAY sets VCO-2's bloom envelope; the noise band 0.6–1.6 kHz as a tick + a steady part gated into VCO-3 (§4) | VCO-1 at TUNE 0 / 5 / 10: LT 57.0 / 85.8 / 117.2, MT 71.9 / 106.6 / 141.3, HT 82.8 / 125.4 / 166.7 Hz; starts 25–38 % sharp; −20 dB 103–213 ms over DECAY [R] | one `Tom9` class × 3 (a table each); the VCO above ×3 |
| **RS** | three bridged-T resonators rung by the trigger's edge → anti-parallel diodes clipping ≈ ± 0.6 V → VCA Q65 → SK HP 229 Hz Q 1.58 (§5) | ≈ 220 / 488 / 1036 Hz, τ 9.6 / 4.6 / 2.9 ms [R] | `BT2` / `btDesign` × 3, a diode law, `skHP` |
| **HC** | the noise → MFB band-pass 963 Hz Q 2.1 → (burst) HP 181 Hz → OTA with its exp converter → HP 1.94 kHz, four bursts from a comparator timer; (tail) LP 440 Hz → VCA with a swelling two-pole envelope (§6) | burst onsets 0 / 9.8 / 21.5 / 31.4 ms; tail peak 25–30 ms, decay ≈ 90 ms; trimmed to 2 Vp-p at LEVEL 5 [R] | `bil2`, the comparator timer as the 808 clap's sawtooth logic **re-written** for the 909's values (7a's class untouched, §0) |

- **The rule of 7a §2.2 holds**: every circuit is its analog topology with its component values — accent, retriggers, the shared
  noise, the reset VCOs behave as the circuit does; no envelope-on-oscillator stand-in.
- **Accent per voice** (R9 §8): the held code's voltage enters where the table of R9 §8 says — so accent is a timbre on BD (ENV1's
  clamp, the click), SD (its envelopes' starts and ENV4's end), and a level on RS and the toms (no clamp) [R]; the TOTAL ACCENT spans
  are target (b) (§12.1).
- **The revision** [C, §13 Q5]: **the late circuit** — every change of R9 §14 applied (C9 0.33 µF, R442 / R440 10 kΩ, R417 3.3 kΩ, C134
  0.01 µF, the toms' C54 / R194, the output caps; the master low-pass only if the schematic shows it, R9 §15): the circuit the service
  notes print and the one every later analysis measured; the early values recorded in R9 §16 for a later "unit character" option.
- **Targets** (R9 §15): (a) each block against its own prototype; (b) R9's measured numbers (frequencies ± 3 %, times ± 15 %, the
  TOTAL ACCENT spans ± 2 dB, the LEVEL ratios ± 2 dB).

### 2.3 The ROM voices: hi-hats, crash, ride (R9 §9)

One class `Rom9` for the three voices (the hats one voice with its region select), each with its table: the clock's timing
resistance (the hats fixed; the crash / ride TUNE), its regions, its envelope (RC for the hats, the address staircase for the
cymbals), its LEVEL, its accent input. Per voice, at the OS rate:

1. **The clock** [R SN9; fit]: a gated RC oscillator **started at the trigger** (phase 0 at the latch's chunk start: span-invariant by
   construction), ÷ 2, so a word every `2 / f_osc`; `f_osc = K / (R_t · C)` with K fitted so the hat's R gives **60 kHz → 30 kHz words**
   (R9 §15) [fit]; crash / ride `R_t` = 6.8 kΩ + their TUNE pot (10 kΩ B) + the series part (V9 re-reads R442 / R493's role) — the word
   rate ≈ 21–53 kHz over TUNE [R-d], read per absolute chunk (a TUNE glide or a cable moves it per chunk); the phase accumulates in
   word units from the trigger, so the k-th word's time is exact and independent of the span splits [C].
2. **The counter** [R]: reset to the region's start at the trigger; one word per clock; at the region's end the clock stops and **the
   latch holds the last word** (no loop, no fade). Regions: hats **open 0–24 575, closed 24 576–32 767**; crash and ride **0–32 767**.
3. **The DAC** [R; C weights]: `v = code · LSB` (6 bits, unsigned; binary weights [R?]); **each new word's step laid on the OS grid at its
   fractional time** (2-point polyBLEP, one OS sample late — the DX7 DAC's method, engine.js:2758–2790): the staircase's images above
   the word rate's Nyquist are kept (they are part of the sound, R9 §9), the aliases of a naive hold are not. The 10 µF coupling as a
   first-order high-pass into the VCA's input.
4. **The VCA and its envelope**:
   - **hats** [R topology, fit constants]: C135 (1 µF) charged at the trigger (from where it is: a retrigger continues), decaying through
     the OH path (R452 + OH DECAY, 1 MΩ A) — and, CLOSED, the CH path in parallel (R451 + CH DECAY, 100 kΩ B); its voltage through the
     buffer into the log / exp converter (Q84) setting Q85's gain; the accent level into the converter (R481) [R]; the converter's
     constants fitted to the scope levels and decays of R9 §9 [fit];
   - **crash / ride** [R SN9, MW2; fit constants]: the counter's top six bits (A9–A14: a step every 512 words) through their network
     and R432 270 kΩ / R439 470 kΩ into the anti-log stage driving the VCA — a **64-step staircase** that **stretches with TUNE**; the
     shared accent level into the anti-log input [R]; the constants fitted [fit].
5. **The reconstruction filters** [R]: the two unity Sallen-Key low-passes (25.9 kHz Q 0.548, 27.7 kHz Q 1.316; `bil2`, prewarped,
   capped at 0.45 · fs at low OS as dr-808 does), then the output stage (22 kΩ in, LEVEL 50 kΩ B feedback) and, the hats, the late
   0.01 µF coupling (≈ 723 Hz high-pass) [R §14].
6. **The hats are one voice** [R]: an OH trigger selects OPEN and its region, a CH trigger CLOSED and its region; a trigger while the
   hat sounds resets the counter to its region (the closed hat cuts the open one by retriggering) and recharges C135 from its level —
   no separate choke. OH + CH in one chunk: the closed hat (§1.2).
7. **Sleep**: the voice sleeps when its counter has stopped and the VCA's output stays below 1e-5 of its scale for 4 chunks (the held
   last word is DC, blocked by the couplings) [C]. **Load your own**: §5.

### 2.4 Our source material (the three "ROM images"; lane R9)

What the 909 played from its ROMs were short recordings of real cymbals (R9 §9) — someone else's audio, never used here (D4). What
fills our three images is **ours**, made by our own tool from our own recipes, in the format the playback path reads:

- **The format** (R9 §9): `hh` (32 768 words: **open 0–24 575, closed 24 576–32 767** — two sounds, as the 909's chip held two
  recordings), `cr` (32 768), `rd` (32 768); **6-bit unsigned codes**, mid-scale 32; the nominal word rate **30 kHz** (the hats' fixed
  clock, the cymbals' TUNE at 5). So the counter, the DAC, the end of the chip and the envelopes meet what the hardware's met: the same
  durations (open 0.82 s, closed 0.27 s, crash / ride 1.09 s at 30 kHz), the same grain, the same images.
- **Pre-compensated, as the originals were** [R SN9]: the hat sounds compressed before quantising (our tool divides each hat region by
  its own smoothed envelope, so the 64 codes carry detail, not decay), the crash's and the ride's envelopes divided by **the playback's
  own address staircase** (the model's constants, read from `Dr808.proto.tr909`) so the circuit restores the decay we designed [C].
  The tool and the model share those constants; a change of either makes the block stale (`--check`, §12.2).
- **The tool** (`tools/rom909.mjs`, node, no dependencies; `--write` regenerates the block in `dr-808.js`, `--check` compares it,
  `--wav <dir>` writes listening renders to the scratchpad) renders each sound at 192 kHz, then — as a sampler of 1983 would have —
  band-limits it to the image's Nyquist, resamples it to 30 kHz, pre-compensates it, normalises it to the codes with 1 dB of headroom,
  ends each region at mid-scale (no DC step when the latch holds the last word) and quantises it (round to nearest, no dither: the
  6-bit grain is the point) [C]. Seeds are fixed (`mulberry32(fnv1a32('rom909:<sound>:<recipe version>'))`, wt.js:50 / 58): the output
  is a pure function of the tool's source; the tool and its recipes are checked in.
- **The recipes** (ours; lane R9's §14 notes record the parameters as built) — a modal model of struck thin plates, the way physical-modelling
  texts describe metal plates, never a match to any recording:
  - *modes*: a thin plate's constant modal density per Hz, drawn from the seed between the plate's lowest mode and 20 kHz, each a
    decaying sinusoid; damping growing with frequency (a frequency-independent plate term + a frequency-dependent air / edge term);
  - *the cascade*: a struck cymbal's energy climbs from its low modes to its high ones over tens to hundreds of milliseconds — each mode's
    envelope rises over a time that grows with its frequency, then decays;
  - *the strike*: a short force pulse (a stick tip, ≈ 0.5–1 ms) through the plate's response — the tick;
  - **hi-hats**: two small plates a little apart in tuning; the **open** region their partial contact as a slow random modulation of the
    upper band (the sizzle), the **closed** region the pair clamped (a short, dry, brighter hit) — two recordings of one pair, as the
    909's chip held;
  - **crash**: a large thin plate, dense modes, a long build-up of the upper band, its decay cut by the image's end (the staircase fades
    it first);
  - **ride**: a heavier plate: a bell cluster of a few strong, long low-mid partials, a bright stick ping on every hit, a quieter wash.
- **Stored as data** (D7): each image a string of one character per word (a 64-symbol alphabet: exactly 6 bits a character), in one
  generated block of `dr-808.js` (`/* ROM909 — generated by tools/rom909.mjs, do not edit */ … /* end ROM909 */`) — ≈ 96 KB of text,
  precached with the script [C] (dr-808.js 210 KB today → ≈ 380 KB with the 909: no lint rule bounds a line or a file, a
  string literal parses in well under a millisecond, and the alphabet avoids the backslash, both quotes, the backquote, `$`
  and `{`, so the block needs no escapes);
  decoded once per scope into `Uint8Array`s (the first 909 `create` or the warm-up, ≤ 1 ms in node,
  recorded in §14) and shared by every 909 machine of the scope; never `Math.sin` at run time — the tool may use any maths, the
  worklet only reads codes, so the Mac's Chrome and the iPad's WebKit play the same bytes.
- **Labelled** (D4): the about text, the tile's tip, the extras caption ("Hi-hats and cymbals: our own sounds through the 909's chip
  circuit"), SOUNDS… ("Open hat (ours)", …) and the tool's header.
- **Listening before the freeze**: R9 renders each image through V9's model (once merged) at the default panel and both ends of each
  TUNE / DECAY, plus a 2-bar groove with the analog drums; the lead sends them to the user (one message, five short files) before
  ref-7c is frozen — a recipe change after the freeze is a new reference (§13 Q1).

### 2.5 Knobs → circuit

- **Face** [R]: each pot by its value and taper in its place (R9 §2–§10): BD TUNE VR2 100 kΩ A (the sweep's discharge), ATTACK VR3 500 Ω
  rheostat (the click VCA's emitter), DECAY VR5 1 MΩ A, LEVEL VR4 100 kΩ B (feedback); SD TUNE VR6 10 kΩ (the CV node, 2 : 1), TONE VR7
  500 kΩ B (ENV4's discharge), SNAPPY VR9 10 kΩ (feedback), LEVEL 50 kΩ B; toms TUNE 10 kΩ linear (the supply, 2 : 1), DECAY 500 kΩ (+
  56 kΩ), LEVEL 50 kΩ B; RS LEVEL 100 kΩ B ∥ 220 pF; HC LEVEL 50 kΩ B; hats CH DECAY VR21 100 kΩ B, OH DECAY VR23 1 MΩ A, LEVEL VR22 50 kΩ
  B; crash / ride TUNE VR25 / VR27 10 kΩ B (the clock), LEVEL VR24 / VR26 50 kΩ B; TOTAL ACCENT VR1 100 kΩ B (the CPU's input: `T(u)`,
  §1.3); VOLUME VR28 50 kΩ B (dual: the mono sum, §2.6). Positions in `drum.<id>` 0…1 → resistance in one place (7a §2.3's rule).
- **No extras knobs** [C, §13 Q3]: every analog drum has its TUNE / DECAY on the face; the hats' TUNE is the one gap (a mod, R9 §9).

### 2.6 Output, level, presets, labels

- **Mono** [C, §13 Q4]: the machine's output is the **MONO jack** — the master out's R / MONO with L normalled onto it, i.e. every
  voice at its LEVEL into the summing amplifier, its fixed L / R placement summed (R9 §10). The stereo pair waits for the per-voice
  outputs (stage 4, D3) — the drums kind stays mono (engine `renderDrums`: one bus, `post` → L = R), so no engine change.
- **Calibration** [C]: `OUT_K9` so the BD at the default panel, unaccented, peaks at the 808's default BD peak (0.4286 FS at OS 4, 48
  kHz; 7a §14) within ± 1 dB (7b's rule); the track's limiter catches accented stacks. (Review 1 F1, the lead: the BD at its
  default LEVEL 9 is that anchor, `OUT_K9 = 0.3029 · 7 / 9`; `MIX9.W` kept; the default LEVELs carry the balance — the default
  groove's RMS through the Track within 1 dB of the 808's, below the limiter; §14 "Fixes".)
- **Presets** (knobs only): `Init`, and three of ours [C]: `Long Kick` (bdd 9, bda 3, bdu 3), `Tight` (bdd 3, sdt 3, chd 3, ohd 3, ltd 3,
  mtd 3, htd 3), `Bright Cymbals` (cru 7, rdu 6, crl 8 → **4**: one step over the new default 3, review 1 F1).
- **Labels** (D4): about, tip and caption as §2.4; the extras caption `XCAPTION_DRUMS` + " · Hi-hats and cymbals: our own sounds
  through the 909's chip circuit" (the layout's `extras.caption`, cv-panel.js:627).

### 2.7 Rates, CPU and bench rows

- Rates as 7a §2.4 (the app's OS, default 4; 44.1 and 48 kHz first-class). The ROM voices' word clock (21–53 kHz) is below the OS
  rate at OS ≥ 2; at OS 1 several steps may fall in one sample (the BLEP sums them, as the DX7's does) and the images fold — the CPU
  safeguard's trade, as on every voice.
- Idle costs nothing (7a §2.6): asleep circuits skipped; the noise register runs only while a consumer is awake (its position is a
  function of time: no work while asleep); a ROM voice costs nothing once its counter stops and its output is below the threshold.
- Per circuit (one ringing continuously, OS 4, M4 Max, node; informational, recorded in §14) [C]: each analog circuit ≤ **0.004**, each
  ROM voice ≤ **0.003**, the noise ≤ **0.001**.
- **Bench rows** [C] (kind `track`, OS 4, 48 kHz, the machine's own pattern synced at 120 BPM, every timed run audible):

| row | node | jsc | ipad | what |
|---|---|---|---|---|
| **d9p** | **0.035** (review #9; was 0.025) | 0.035 | 0.035 | a typical house pattern: BD on the quarters, CH sixteenths with OH on the off-beat eighths, HC + SD on 2 / 4 (a flam on the SD), the ride in eighths, a crash once a bar (never asleep), LT / MT / HT once a half, per-voice and total accents, SHUFFLE 3 |
| **d9x** | 0.08 | 0.08 | 0.08 | every lane every 250 ms, both accents, every DECAY / TONE at 10, crash / ride TUNE at 0 (the longest images), flams on all five |
| **d9m** | 0.025 | 0.025 | 0.025 | the ROM voices: crash + ride + OH every 500 ms (three staircases, filters, envelopes) |
| **d9i** | 0.0005 | 0.0005 | 0.001 | the machine powered, synced, stopped, silent — gated as row p / d8i / d6i (engine-track), not a `scenarios()` row |

d9p's pattern keeps nearly every circuit awake (review #9: BD on the quarters never reaches −100 dB in 500 ms, HC's ≈ 90 ms
tail and the toms' 103 ms ENV1 stay above it between their hits, the three ROM voices never sleep): with §2.7's own ceilings
the machine is up to ≈ 0.032 + the Track's ≈ 0.007 (7b's d6p − machine), at the 606's measured share of its ceilings ≈ 0.026
— so 0.025 would fail a correct build; 0.035 [C] (proposal P-2: or thin d9p to keep 0.025). `bench.json` `targets` gain
`{ node, ipad }` for d9p, d9x, d9m, d9i; `cv-cost` `COST.synth.tr909 = C('d9p', 'drums', 1, base, voice)`
from E9's measured d9p; `bench.html` adds **c9** (the 909 at its default panel playing its DEMO synced, `ipad: null`). JSC A/B (the
lead, IMPL-2b §9's shell method): d9p / d9x and, because `DrSeq` and the shell changed, d8p, d6p, c1 within 3 %; V8: every existing
row within 2 % (`cpu-gate`).

## 3. The sequencer: the 909's personality (`drum-core.js`, `dr-seq.js`; lane S9)

### 3.1 The record (`dev.drum` of a `tr909` device; `normDrum(d, 'tr909')`)

```
{ v: 1, m: 'tr909',
  keys: [96 × { sc 1–4, l1 1–16, sh 1–7, fl 9–16, ch 0 | 1 }],   pattern p = bank · 48 + group · 16 + key: its SCALE, LAST STEP,
                                                                   SHUFFLE, FLAM spacing, "chained to p + 1"   (cleared: 1, 16, 1, 9, 0)
  st:   [96 × [16 masks 0–0xFFF]],     the voices on each step (§1.2's lane bits; bit 0 = TOTAL ACCENT)
  ac:   [96 × [16 masks & 0x83E]],     the per-voice accents (BD SD LT MT HT CH)
  fm:   [96 × [16 masks & 0x03E]],     the flams (BD SD LT MT HT)
  tk:   [8 × [measures: 0–47]],        tracks 1–4 of bank I, 1–4 of bank II (a measure: one pattern of the track's bank —
                                       ENTER on a chain writes its patterns as consecutive measures); per bank Σ lengths ≤ 896
  tt:   [8 × 0 | 37–290],              each track's stored tempo (0: none)
  ui:   { mode, wm, bank, grp, sel, bl, inst, fw, trk, cyc, guide, tempo },
  x:    { sync, mute, solo, rec },  map: {…},  smp: {…} }
```

- `ui` [R R9 §12 unless tagged]: **`mode`** 0 PATTERN PLAY · 1 PATTERN WRITE · 2 TRACK PLAY · 3 TRACK WRITE; **`wm`** the write sub-mode 0
  STEP · 1 TAP; **`bank`** 0 / 1 (I / II); **`grp`** 0–2; **`sel`** 0–15; **`bl`** 0–15 − sel (block play: `sel … sel + bl`); **`inst`** the
  selected instrument's lane bit 0–11 (0 = TOTAL ACCENT), **`fw`** flam write on it (lanes 1–5); **`trk`** 0–3; **`cyc`** CYCLE; **`guide`**
  the tap-write click; **`tempo`** 37–290 BPM, whole numbers (the display's) [R; C: the knob's law `tempo909(u) = round(37 · (290 /
  37)^u)`, log over the travel, as 7b's].
- `x`: as 7a's (sync **on** for a new machine, mute / solo 12-bit masks, rec) — **no `swing`**: SHUFFLE is the 909's, per pattern [C].
- `normDrum(d, 'tr909')` (7a §6's contract): exact lengths, every value in range, masks `& 0x83E` / `& 0x03E` **and each `ac` /
  `fm` mask `& st` of its step** (an accent or a flam is a flag on a sounding voice: a hostile record's flam without its step
  would play the second hit alone — review #22), each bank's tracks cut so their sum ≤ 896 (tracks 1 → 4 kept in order, the
  later ones truncated [C]), unknown fields dropped, idempotent, never throws; **the machine is `model ?? d.m`** — `'tr909'` only for the
  exact string (7b §3.1's rule; an 808 / 606 record unchanged, their pins §12.3).
- The **EXT INST layer** (the 909's MIDI-out pattern, R9 §12) is not stored: the app has no MIDI out yet (7a §4.5) [C].

The **payload** (`payload(D, S, at)` on a 909 record) is 7b's shape (`m: 'tr909'`, `rst` 0, `rstF` −1, `tap` 0) with `bpm` = `ui.tempo`
and `swing` 50 (inert: the plan carries the shuffle); its `pk` hashes `m` (7b review #3's rule).

### 3.2 Panel state (saved) and session (not saved)

- Saved: `ui`, `x` above. Session (`initState('tr909')`; the 808's and 606's sessions unchanged — their pins): `m: 'tr909'` (cv-drum's
  `sessOf`), `run`, `play`, `pos`, `undo`, `bpm`; **`hold`** `{ shift, isel, clear, last, shuf, tkey }` (the held keys); **`keys`** (the step
  keys held: pairs, blocks, chains); **`dig`** (SHIFT + keypad digits typed); **`ptr`** (TRACK WRITE's measure pointer), **`loc`** (TRACK
  PLAY's located measure); **`pend`** (the pattern chosen in TRACK WRITE, ENTER writes it); **`disp`** (what the display shows:
  `'tempo' | 'meas' | 'avail' | 'dig'`); **`erase`** (CLEAR + a voice key held in TAP: the lanes being erased).

### 3.3 The behaviours (`press(state, drum, input)` → the 909's machine when `drum.m === 'tr909'`)

The 909's keys send **down / up** (held states: SHIFT, INSTRUMENT SELECT, CLEAR, LAST STEP, SHUFFLE/FLAM, the TEMPO key, the step keys);
START, STOP/CONT, SCALE, TRACK n, PATTERN n, BACK, FWD, AVAILABLE MEAS, CYCLE/GUIDE and ENTER act at the press as **taps** (`A.tap`: a
finger at its release, so a pinch starting there presses nothing — 7b review 2 #1). A step key's action happens at its **down** unless a
combination needs it held (a pair, a block, a chain: the second key's down) [C]. One row per test (§12.3) [R R9 §12 unless tagged]:

| input | behaviour |
|---|---|
| **START** | synced: the project's ▶ (7a §13 answer 1); free: runs from the top (pattern modes: step 1 of the selection; TRACK PLAY: measure 1) |
| **STOP/CONT** | running: stop; stopped: **continue** from where it stopped (free: the machine's own position; synced: the project's ▶ from the song position, the machine's position being the song's, 7a §3.5) — TRACK PLAY with a located measure (`loc`) starts there [R; C synced] |
| **PATTERN n** (1–3), no SHIFT | PATTERN PLAY, group n (the next key picks the pattern) |
| **SHIFT + PATTERN n** | PATTERN WRITE, group n; the sub-mode as left (STEP the default) |
| **SHIFT + TEMPO (STEP) / SHIFT + BACK (TAP)** | the write sub-mode |
| **TRACK n**, no SHIFT | TRACK PLAY, track n of the bank; **TEMPO held**: also recalls its stored tempo (free: `ui.tempo`; synced: the project's, one tempo edit) |
| **SHIFT + TRACK n** | TRACK WRITE, track n |
| **SHIFT + FWD / SHIFT + AVAILABLE MEAS** | bank I / II (from a track mode only) |
| **key, PATTERN PLAY** (stopped or running) | selects pattern `bank · 48 + grp · 16 + n − 1`; running: **queued to the end of the measure** (`at: 'bar'`); **two keys down together** (the second while the first is held): **block play** `sel … sel + bl`, in order, looping (any two keys of the group; Shift-click the second with a mouse [C]). **A chain counts as one pattern** (R9 §12): a key inside a chain selects the chain from its first pattern; a block walks its keys in order, each contributing its whole chain once, a key inside a chain already contributed skipped [C, review #18] |
| **key, PATTERN WRITE / STEP, stopped** | selects the pattern to edit |
| **key, PATTERN WRITE / STEP, running** | the selected instrument's step n of the edited pattern: **off → normal → accented → off** for BD SD LT MT HT CH, **off ↔ on** for the others and TOTAL ACCENT; in **flam write** (`fw`) **off ↔ flam** (a flammed step replaces a plain one and back) [R]; keys past LAST STEP nothing [C] |
| **INSTRUMENT SELECT held + key(s)** | the instrument: keys 1 / 2 BD … 9 / 10 HT, 11 RS, 12 HC, 13 / 14 CH, 15 CRASH, 16 RIDE; **both keys of a pair**: flam write on BD … HT, **13 + 14: OH**; **+ ENTER**: TOTAL ACCENT; pressing one key of a flam pair again leaves flam write |
| **key, PATTERN WRITE / TAP** (running or stopped) | **a drum pad**: plays its instrument (the left key of a pair accented, the right normal: §1.3's velocity of that state, through the host's note path, so recording and the keyboard tray behave as a pad); running, also **writes it at the nearest step** of the edited pattern (7a's TR-08 rule: R9 §12 leaves rounding open) [R; C nearest]; 13 + 14 down together: OH — key 13's down has already played and written an accented CH, so the second key's down **takes that CH back off its step** (the step it wrote, while 13 is held) and writes / plays the OH there; the CH already heard stays heard (the one hat voice: the OH retriggers it) [C, review #19] |
| **CLEAR + a voice key, TAP, running** | erases that voice's steps as they pass while both are held (7b's wipe, at the heard post) [R] |
| **CLEAR + key, PATTERN WRITE, stopped** | clears that pattern (steps, accents, flams; SCALE / LAST STEP / SHUFFLE / FLAM to the cleared values; out of its chain); ours: "Pattern I-2-5 cleared · tap to undo" (one level) [R; C undo] |
| **LAST STEP + key** (PATTERN WRITE) | LAST STEP n of the edited pattern (`at: 'bar'` when it shortens the bar under the playhead, else 'now', 7b's rule) [R] |
| **SCALE** (PATTERN WRITE, running) | the edited pattern's next scale (16 → 32 → 8T → 16T → 16), **LAST STEP set to 16 / 16 / 12 / 12** [R]; elsewhere nothing [C] |
| **SHUFFLE/FLAM + key 1–7 / 9–16** (PATTERN WRITE, running) | the edited pattern's SHUFFLE / FLAM spacing [R]; a tap of SHUFFLE/FLAM alone lights the current values' keys while held [R] |
| **chain** (PATTERN WRITE, stopped): **two keys + ENTER** | chains the range (adjacent, inside the group: `ch` set on each but the last); **a key held + ENTER** takes it out of its chain [R] |
| **TRACK WRITE**, a group key + a key | `pend` (heard from the next measure while running, as 7b's TRACK WRITE key) [C]; **ENTER**: writes `pend` (or the measure's own pattern) at `ptr` and advances — a chain writes its patterns as consecutive measures and advances by its length (7b's rule) [C]; at the bank's 896: the display shows 0, nothing written [R] |
| **BACK / FWD** (track modes) | `ptr` / `loc` −1 / +1 [R] |
| **SHIFT + digits + ENTER** (track modes) | locate measure n (TRACK PLAY: `loc`, started by STOP/CONT; TRACK WRITE: `ptr`) [R] |
| **SHIFT + DEL / INS / COPY + … + ENTER** (TRACK WRITE, stopped) | delete measures `ptr … n` (or to the end with LAST MEAS), insert `pend` (or a range of adjacent patterns) at `ptr`, copy measures `a … b` to `ptr` (later measures shift) — the 909's sequences, R9 §12; each "· tap to undo" [R; C undo] |
| **SHIFT + COPY + bank + group + key + ENTER** (PATTERN WRITE, stopped) | copies that pattern onto the selected one ("· tap to undo") [R] |
| **SHIFT + LAST MEAS + ENTER** (TRACK WRITE) | `ptr` to the end (appending) [R] |
| **CYCLE/GUIDE** | TRACK PLAY: CYCLE on / off (off while running: the track stops at its end — the plan's `once`, §3.4, sent 'now'); PATTERN WRITE / TAP: the guide click on / off [R] |
| **TEMPO key** | held: the display shows the tempo; **+ ENTER**: stores the tempo into the track (`tt`); the knob turned to its minimum while it is held: erases it [R] |
| **AVAILABLE MEAS** held | the display shows the bank's free measures [R] |
| **TEMPO knob** | free: the machine's tempo; synced: the project's (one gesture = one tempo edit, 7a) [C] |
| **EXT INST, TAPE SYNC (TEMPO MODE), CARTRIDGE, the MIDI channel keys** | not emulated: dimmed / nothing (D3, §7) [C] |
| extras | `sync`, `mute` / `solo`, `rec`, `grid`, `pad`, `map`, `mapReset`, `smp`, `undo`, `demo` as 7a §3.3 / 7b (lanes & 0xFFF; the grid's cell cycles as the step key does) |

- Inputs not in the table do nothing [C]; **a cancelled hold** (two-finger cancel, lost capture, blur, the host's release-all) sends `{ k:
  'release' }` — every hold let go, nothing done (7b's rule).
- **Synced TRACK PLAY with CYCLE off**: the track plays once from song tick 0 and the machine is silent after its end while the song
  plays; a loop wrap / seek / start re-anchors it (7a §3.5) — **at the song position, never wrapped into the track**: a re-anchor
  at or past the track's end stays silent, one before it plays from there (what the → Piano roll notes of the once-played track
  do: review #17) [C]. Free: at the heard last step the session stops (the RUN state, the
  LEDs) [C].
- **Tempo per track, synced**: recalling a stored tempo is a project tempo edit (one History step) [C].

### 3.4 The plan (`compilePlan` → the shared format + the 909's arrays)

7a's plan format and content key (drum-core.js:381–420) with **four optional arrays and two flags, present on a 909 plan only** (absent
on the 808's and the 606's: their keys and shapes unchanged, D1; hashed into a 909 plan's key, `mSh` into its shape too): **`ac`**
(Uint16Array, a step's per-voice accents), **`fl`** (Uint16Array, its flams), **`mSh`** (Uint8Array per measure: the shuffle in ticks),
**`mFl`** (Uint16Array per measure: the flam spacing in ticks), and the flags **`once`** (TRACK PLAY with CYCLE off) and **`guide`**
(the tap-write click). The 909's memo signature and plan key carry **every** input its plan reads — `ui` (mode, bank, grp,
sel, bl, trk, cyc, guide), the flam tempo, the session's `pend` / `ptr` / `loc` — since a change the key misses is a send
`drumSend`'s `pk` dedupe drops (main.js:3223; 7b review #3's class) [review #8]. A measure per pattern (`mKey` 0–95, `mVar` 0, `mPre` the scale's step code — **SCALE 16 / 32 / 8T / 16T → codes
3 / 4 / 1 / 2**, the 606's `SC_CODE`, drum-core.js:96 —, `mL1` its LAST STEP); `fill: null`. Per mode: PATTERN PLAY the selection (a
pattern, its chain, or the block — a chain counts as one pattern, §3.3's rule) looping; PATTERN WRITE the edited pattern alone, looping [C];
TRACK PLAY the track's measures, `once` by CYCLE, free a located start a pre-roll (7b §3.4's mechanism); TRACK WRITE (running) `pend`
looping, else the pointer's measure [C]. Mute / solo mask `st`, `ac` and `fl` alike.

- **Shuffle** (per pattern, R9 §12) [R W SHUF; C 32nds]: 16ths — `mSh = 20 · (sh − 1)` ticks (0 … 120 = 2 … 12 / 96 of a beat, ≈ 54–75 %);
  32nds — `mSh = 20 · floor((sh − 1) / 2)` (0 / 20 / 40 / 60: our reading of the manual's four settings); triplet scales 0. Whole ticks
  at 960 PPQ, so → Piano roll writes the same positions (7a §15 #5's reason). The swung step is the even-numbered one (DrSeq's `s & 1`).
- **Flam** (per pattern) [R W FLAM; C ticks]: the spacing **10 + 4 · (fl − 9) ms** (10 … 38 ms), **absolute time** (R9 §12: it does not
  follow the tempo), held in the plan as whole ticks at the plan's tempo: `mFl = round(ms · bpm · 960 / 60 000)` with `bpm` the tempo
  the machine runs at (synced: the session's project tempo; free: `ui.tempo`) — so a tempo change re-sends the plan ('now': the key
  changes, the shape does not) and both D5 paths read one number [C]. **The synced tempo must reach the plan (review #1)**: today
  a project tempo change only sets the sessions' `bpm` (cv-drum.js:272 `bpm(v)` runs no press, sends nothing), the restore path
  posts the payloads before it (main.js:1401–1402) and the offline payload takes a fresh session at 120 BPM (main.js:3217) — so
  P1's `bpm(v)` runs drum-core's `{ k: 'bpm', v }` for a 909 entry, which returns `send('now')` when the plan's flam ticks change;
  H1 calls `DRUM.bpm(project.bpm)` before the restore's `drumSend` loop and builds the offline payload's session with `bpm:
  project.bpm` (D7: bounce = live at any tempo). The plan's memo signature includes that tempo. **The spacing is clamped**
  [C, review #2]: `mFl[m] ≤ g_m − 1`, `g_m` the measure's smallest distance from a step to the next (or to the measure's end) —
  `STEP_T − mSh` on a shuffled scale, else `STEP_T` — so a flam's second hit always fires before the lane's next step: 38 ms is
  73 ticks at 120 BPM against 32nds at SHUFFLE 7 (`120 − 60 = 60` ticks), 182 ticks at 300 BPM against 16ths at SHUFFLE 7 (120);
  unclamped, DrSeq's one pending hit would be overwritten (a hit lost) and → Piano roll's notes would overlap the next step's.
- Bounds: ≤ 8 tracks × 896 measures + a pre-roll — inside 7a's `MAX_MEAS` 769? **No**: a 909 track may hold up to 896 measures, over
  `MAX_MEAS` (769, drum-core.js:74 = dr-seq.js) — the bound rises to **1 793** (896 + a 896 pre-roll + 1) and `MAX_STEPS` to **28 688**
  (1 793 × 16) for every machine (DrSeq's `valid` only refuses more; the 808's and the 606's plans never reach them: their bytes are
  unchanged) [C]; the constants stay equal in both files (a test). **One 7b test pins the old constant**: drum-core.test.mjs:254
  asserts the 808's longest plan has `C.MAX_STEPS` steps (768 × 32 = 24 576) — it becomes the literal `768 * 32` (the 808's own
  bound, review #3). Memory: the longest 909 plan is ≈ 170 KB (`st` / `ac` / `fl` 57 KB each), cloned per payload — fine for
  TRACK PLAY's rare sends.

### 3.5 The clock (`DrSeq`: three additions and two flags, each inert without the arrays)

Sync, free running, live plan changes, TAP fills, STEP RESET, the clock, the posts, offline = live: **exactly 7a / 7b §3.5**. Additions
(ref-7a and ref-7b render the frozen DrSeq against the current one: they guard every line):

- **Accents**: `fire(F)` calls `dm.trig(mask, acc)` with `acc = pl.ac[cOff + s]` when the plan has `ac`, else `dm.trig(mask)` exactly as
  today [C]; the machine's `trig` reads the AC bit as TOTAL ACCENT and `acc` as the per-voice accents (§1.3). The #34 hook `drStep(n,
  v)` gets the highest of the step's sounds' state velocities (§1.3) / 127 — a step mixing an accented and a plain voice has no
  single state [C, review #7]; the notes path gates ModCore per note, so this stays inside D5's scope note (no cables).
- **Shuffle**: `geo()` takes `cw = pl.mSh[cm]` when the plan has `mSh` (the measure's own), else today's `SWUNG[cp] ? swingTicks(sw, cT)
  : 0`; `sameShape` compares `mSh` when present (a shuffle change is a new shape: it swaps at the boundary, as a LAST STEP change does).
- **Flams**: a step whose `fl` has lanes in its mask schedules **its second hit at `ct + mFl[cm]`** — one pending hit (preallocated
  fields: tick, lane mask, accents, the AC bit); `events(F)` fires whichever of the next step and the pending hit is due first
  (songEvents' expression for each: D5) and returns the frames to the nearer; the second hit calls `dm.trig(flanes | (mask & 1),
  acc & flanes)` and `drStep` like a step. A re-anchor (start, seek, loop wrap, power on) **inside a flam's spacing** still plays its
  second hit when the song path would play its note (the step's tick before `t0`, its second hit's at or after); a stop drops it [C].
  That step may be the previous measure's last (or, after a wrap, the cycle's last): `locate` looks one step back across the
  boundary, with that measure's `mFl` [C]. With §3.4's clamp the pending hit is always due before the next step, so one slot
  suffices (no queue).
- **`once`**: at the plan's end the cursor goes to INF (silent) instead of `loopFrom`; a re-anchor locates at the song position
  **without wrapping** — `t0 ≥ mT[n]` stays silent (today's `locate` wraps `t0` into the cycle, dr-seq.js:221) [C, review #17].
- **`guide`**: at each step whose tick is on a beat (`o % 960 === 0`) the RS lane (bit 6) joins the trig mask, unaccented — never in
  `st`, so → Piano roll does not write it [C]. D5 excludes it: its RS hits rewrite the RS + HC accent DAC a ringing clap reads
  (§1.3), so a plan with `guide` and its notes differ by design (§12.6's D5 cases have it off).
- `valid()` checks the arrays' lengths when present; `set()` allocates nothing; `events()` nothing but the post literal (7a).

### 3.6 LEDs and the display (`leds(S, D)` → the 909's; cv-drum `LIT` gains `'dim'`)

`{ step[16] 0–5, scl[4], trk[4], pat[3], tkey, back, fwd, avail, cyc, enter, disp }` — codes 0 off · 1 on (bright) · 2 flash · 3 / 4 the
inverted playhead (7a's) · **5 dim** (a normal step) [C]. **Step LEDs**: running PATTERN WRITE / STEP — the selected instrument's steps,
dim normal, bright accented (flam write: the flams), the playhead inverted [R]; PATTERN PLAY / TRACK PLAY running — the chase 1 → last
[C, R? the photo's LED per key]; stopped — the selected pattern's key flashing (a block: the first flashing, the rest steady) [C, 7b];
SHUFFLE/FLAM tapped — the keys of the current values [R]; TAP write — the keys flash as they are hit [C]. **Scale rows**: the edited /
playing pattern's [R]. **TRACK 1–4 / PATTERN 1–3**: the mode's key lit, flashing in a write mode [C]. **The display** (3 characters):
pattern modes the tempo (synced: the project's, rounded); track modes the measure (running: the heard one; stopped: `ptr` / `loc`); TEMPO
held: the tempo; AVAILABLE MEAS held: the free measures; SHIFT digits: as typed; an empty track: `  0` [R; C what shows when].

### 3.7 Extras helpers (start neutral; 7a §3.6's, re-tabled)

- **Grid** (`dr:grid`, the 808's 640 × 272 geometry): the 12 rows AC … RD × 16 steps of the pattern edited or heard; a cell shows off /
  normal (a small mark) / accented (a full mark) / flam (a double mark); a tap cycles it as its step key would (flam rows: a long press
  toggles the flam) [C]; the header mutes / solos (7a); cells past LAST STEP dimmed.
- **Pads** (`dr:pads`, 4 × 3: **CR RD OH CH / LT MT HT AC / BD SD RS HC**, the kick bottom-left): velocity from where the pad is touched
  (the 1i curve) through §1.3's law; **AC a hold** (7b's: every hit at 127, "both" on the voices that have it) [C].
- **SYNC**, **→ PIANO ROLL**, **REC**, **MAP…**, **SOUNDS…**, **DEMO** (ours: patterns I-1-1 and I-1-2, a house groove with shuffle 3,
  a snare flam in the second, a crash on the first step, block-played 1–2 in PATTERN PLAY — written for this project, never the 909's
  factory patterns, D4). **No SWING** (the face's SHUFFLE) [C].

## 4. Both ways: notes and the piano roll

- **The note map** (`PERS.tr909.map`: the 909's own receive notes = the GM numbers, §1.4); `normMap(map, 'tr909')`
  keeps only the 909's eleven sounds; MAP… lists those eleven by the 909's names.
- **Roll rows**: `drumRowsOf(dev)` → `drumRows(map, dev.model)` (roll.js:53–55, no edit) — the 909's eleven named rows (Kick 36 … Ride
  51), names from `PERS.tr909.names` (§1.2) — drumRows reads them by the model, drum-core.js:167 (§0's name tables); the 808's sixteen
  and the 606's seven unchanged.
- **→ Piano roll** (`drumToRoll`, main.js:3299): `toNotes(rollPlan(D, bpm), rollOpts(D, dev))` — drum-core's (§10): for the 808 /
  606 exactly today's `{ swing, sw, prim }`; for the 909 its `prim`, the plan carrying its own shuffle (`mSh`), flam (`fl`, `mFl`)
  and accents (`ac` + the AC lane). A hit becomes `{ t, d, n: its sound's primary, v }`:
  - `t` the sequencer's own whole tick — the shuffled position of its step (§3.5), the flam's second hit at `t + mFl` (the plan's whole
    ticks at its tempo, §3.4), the same velocity; **each hit filtered by its own tick** against `[t0, t1)` (a flam whose step lies
    before `t0` keeps its second note: today's `toNotes` skips by the step's tick, drum-core.js:519), and a `once` plan never
    wrapped past `mT[n]` (`measureAt` / the loop at 528 wrap today) [C, review #17];
  - `v` the velocity that names its state exactly (§1.3: 100 normal, 127 both, 110 / 119 per-voice and total accent in the order
    their codes take at the panel's TOTAL ACCENT; `vel9`) [C];
  - `d` 120 ticks as 7a; a flam pair's first note ends where its second starts (`d` = the spacing: no overlap of one pitch, song.js
    752–755's rule never acts) [C]. (A `d: 120` note on a shuffled 32nd still overlaps the lane's next one — `120 − mSh` ticks
    later — and is taken over there; harmless: a drum Inst's note-off does nothing, engine.js:2698.) Where step frames are whole numbers (120 BPM / 48 kHz) every event of both paths lands on its own
    frame, so the note-offs cannot move a hit; elsewhere 7a §4.4's "the same 4-frame grid point or the next" bounds both paths.
- Then SYNC off and the machine stopped, the notice, the one undo (7a §4.3; 7b review 1 #4's `withTempo`: the 909's TEMPO set to
  the project's); its text "the 909's own sequencer is off …" (main.js:3318 takes the model's short name).
- **D5**: §12.6's gate — the DEMO with shuffle, flams and every accent state, sequencer vs notes, bit-identical at 120 BPM / 48 kHz,
  the same grid point or the next at 97 BPM. Scope as 7a (an empty FX panel, no cables).
- Recording, bounce, MIDI files: 7a §4.4–§4.5 unchanged (a channel-10 import still makes a TR-808 track [C]; a 909 track exports on
  channel 10).

## 5. Your own sounds

- **The analog sounds** (BD, SD, LT, MT, HT, RS, HC): 7a §5 unchanged — a slot's sample plays **instead of** the circuit at the base
  rate (dr-808.js `smpHit` 2789 / `smpRender` 2805); what acts on it [C]: its LEVEL (audio taper), the hit's accent code as gain (7a's
  law over the 909's codes, §1.3: below `N0` proportional, `N0` → 1, both at full TOTAL ACCENT → +4 dB), **TUNE ± 1 octave at 5** (BD,
  SD, toms), **DECAY a fade only below 5** (BD, toms: 5 = the whole sound, 0 = 30 ms — 7b's rule), mute / solo. ATTACK, TONE, SNAPPY do
  nothing to a sample (their tooltips say so while the slot is on, 7a).
- **The four sampled sounds** (CH, OH, crash, ride) — §13 Q2; the build's default is the recommendation, **"a chip swap"** [C]: the
  slot's sample becomes that voice's **ROM image** and plays through the 909's own path (§2.3: the counter at its clock, the word
  length, the DAC, the filter, the envelope, TUNE, DECAY, the choke, the accent) — the 909's character on your sound, as swapping a
  chip would have given. The hats keep **two slots** — open (`oh`) and closed (`ch`) — because the 909's hat chip held two recordings
  in two regions (R9 §9): each loads its region of the one hat image [C]. The conversion, in the worklet when a payload names a new
  slot id for a ROM voice: the entry's level 0 read once, resampled (linear, after a one-pole guard at the image's Nyquist) to the
  voice's nominal word rate, cut to its region's word count with a 2 ms fade, normalised like the tool's images, quantised to the word
  length — into the machine's **preallocated** image buffer of that voice (no allocation; ≈ 0.3 ms for 32 k words in node, recorded in
  §14); the built-in image comes back when the slot goes off. **When** (review #20): the payload may arrive before its entry
  (`drumSend` posts at once, the entry follows `sendPatch`'s wait — main.js:3228–3231; 7a reads a slot lazily at its first hit,
  dr-808.js `smpHit`), so a ROM slot whose entry is missing is *pending*: one `getAsset` look per span while pending, the
  conversion at the first span start that finds it (audio thread, between hits — never inside `hit` / `trig`), the built-in
  image playing until then [C]. **Buffers**: the built-in images are shared per scope (§2.4); a machine owns three 32 768-word
  buffers for its slots (≈ 96 KB, allocated at `create`), the hat's holding the built-in region a slot does not replace.
  **"Normalised"** = peak-normalised with the tool's headroom, **not pre-compensated** — a chip swap: the staircase / RC envelope
  acts on your sound as it acts on a swapped chip's (Q2's answer) [C]. The alternative of Q2 (7a's clean playback for these four too) is a flag
  on the machine, not a fork.
- SOUNDS… (cv-drum's popover) lists the 909's eleven slots by its own names ("Kick", …, "Open hat", "Closed hat", "Crash", "Ride") with
  "Circuit (ours) | Your sound" for the analog ones and "Our sound | Your sound (through the 909's chip)" for the ROM ones.
- The machine's memory cap and the 2 playback levels as 7a (§5: a ROM slot's entry is read at level 0 only).

## 6. Project format, schema, undo

- **Device record**: `{ kind: 'synth', model: 'tr909', vals, preset, drum: {…§3.1…} }`; `song.normDev` → `normDrum(d.drum, o.model)`
  (song.js:570: no edit — the model is passed); `drumOf` (main.js:147–151) **re-normalises a record whose machine is not the
  model's** — today's guard `(d.drum.m === 'tr606') !== (d.model === 'tr606')` (150) lets a 909 record under an 808 model (or an
  808 record under a 909 model) through; it becomes `(d.drum.m || 'tr808') !== d.model` [C] (§10).
- `keepDevs` keeps a same-model device's `drum` (7a §6); a model switch deletes the old machine's (7a §15 #28) — every pair of the
  three machines included; PATTERN CLEAR, TRACK / measure edits that destroy data, COPY over a pattern, DEMO and → Piano roll get the
  one-tap undo notice (7a §13 answer 3; the list is §3.3's).
- **Schema 10** (`cv-migrate.SCHEMA = 10`, `STEPS[9]` additive, nothing stored changes): a schema-9 build (7b) reads `tr909` as a
  Minimoog (`modelById`'s fallback) and would autosave the loss; with the bump it opens the project read-only (7a / 7b's precedent).
  The pins that move with it (none weakened): cv-migrate.test.mjs:27 (the constant and its message), **:1051** (7a's test:
  `[M.SCHEMA, M.STEPS.length]` `[9, 9]`), **:1057** and **:1148** (7a's and 7b's tests assert `upgrade({ schema: 10 })` is
  read-only — with SCHEMA 10 it is not: they move to 11, as 7b moved 7a's, IMPL-7b §14 lane X), canvas-7b-sim.test.mjs:487
  (`[9, 9, true]` → the saved schema follows `CM.SCHEMA`) — X's (§11; review #10).
- Save as classic project: the lost-line names the model ("TR-909 track “Drums”: the live site has no drum machine — its piano-roll
  notes are kept"; cv-migrate's `toV1` already names each drum model since 7b).

## 7. The panel (`panels/tr909.js`, `cv-panel.js`, `cv-drum.js`; lanes P1 / X)

### 7.1 The layout (R9 §13)

- **486 × 300 mm** (one area `main`; the face may end at the measured front edge ≈ 268.5 mm of the photo's depth, the case to 300 —
  X's reading) → 972 px wide at 2 px/mm → a **992 px** module (`ceil32`); with the extras strip (§7.5: 16 + 272 + 64 + 8 = 360 px, the
  808's) ≈ **992 × 1024** (P1 pins `TARGET.tr909` from the geometry, ± one dot) [C est.].
- Three bands as the hardware (R9 §13): **the knob band** — nine blocks under slate header bars (TOTAL ACCENT · BASS DRUM · SNARE DRUM ·
  LOW TOM · MID TOM · HI TOM · RIM SHOT / HAND CLAP · HI HAT · CYMBAL), two rows of knobs at y 113.4 / 133.0 at R9 §13's x; **the middle
  band** — START and STOP/CONT, the red three-digit display, TEMPO, the small LED keys (TRACK 1–4, PATTERN 1–3, EXT INST, TEMPO, BACK, FWD,
  AVAILABLE MEAS, CYCLE/GUIDE, TAPE SYNC) with their orange shift legends (TRACK WRITE, PATTERN WRITE, EXT INST, PATTERN WRITE MODE STEP /
  TAP, BANK I / II, LAST MEAS, TEMPO MODE), CARTRIDGE/ENTER (its TOTAL ACCENT legend), VOLUME; **the bottom band** — the left cluster
  (LAST STEP · SCALE / SHUFFLE/FLAM · CLEAR / INSTRUMENT SELECT · SHIFT), the four scale rows with their LEDs (our glyphs), the 16 step
  keys with an LED each, the numbers 1–16, the shift-legend strip (1–9, 0, COPY, INS, DEL, SAVE, VERIFY, LOAD), the instrument boxes
  (BASS DRUM … RIDE, CLOSED · OPEN · CLOSED under 13–14).
- **The 14 mm hit rule** (7a §7.3) [C]: the step keys (23 mm pitch), START / STOP / ENTER and the left cluster (14.9 × 17.7 mm pitch)
  meet it as measured; **the small middle-band keys do not** (≈ 11.9 mm pitch inside a group): X places their caps on a ≥ 14 mm pitch
  between the TEMPO knob and ENTER with the least movement — a scratch minimax (this contract's) moves none by more than **6.2 mm**
  (x ≈ 186.6, 200.6 … 368.6 for the fourteen) — each shift legend moving with its key or keys; recorded in the file's `notes` (the
  TB-303 / 606 precedent, 7b §14 lane X).
- **Colours / skins** (R9 §13): a warm off-white case, slate header bars, scale rows and legend strips, orange labels and shift boxes,
  cream START / STOP / ENTER caps, warm-ivory step caps, dark navy knobs with an orange line, red LEDs and display — **our own art**
  (`theme`: panel `#e8e8e2`, knob a new `'tr9'` skin or the 808's `'tr'` recoloured — P1 / X) [C]. Title: plain type "TR-909 ·
  Rhythm Composer" in the wordmark's zone, small (the 303 / 606 precedent); the maker and wordmark zones otherwise empty (D4).
- **Inert, as print or dimmed** (D3): a printed legend band along the top edge for the rear sockets with ▲ marks — MASTER OUT L, R /
  MONO, SYNC IN, START / STOP, TRIG OUT, TAPE SAVE / LOAD, MIDI — and the **ten MULTI OUT jacks** drawn under their ▲ legends as
  `inert: 'later'` (7a §7.1's form: "BD OUT — cable-able with full patching (stage 4)"); EXT INST and TAPE SYNC keys `inert: true`
  (dimmed, "not emulated"); the cartridge slot print.

### 7.2 Tokens (`TOKENS.tr909`)

| token | kind | | token | kind |
|---|---|---|---|---|
| `dr:start` | button (START, a tap) | | `dr:stop` | button (STOP/CONT, a tap) |
| `dr:disp` | **display** (3 digits) | | `dr:tempo` | knob (continuous) |
| `dr:trk` | button, **multi** `n` 1–4, all present, LED | | `dr:pat` | button, **multi** `n` 1–3, all present, LED |
| `dr:tkey` | button (TEMPO / STEP, held), LED | | `dr:back` | button (BACK / TAP), LED |
| `dr:fwd` | button (FWD / BANK I), LED | | `dr:avail` | button (AVAILABLE MEAS / BANK II, held), LED |
| `dr:cyc` | button (CYCLE/GUIDE / LAST MEAS), LED | | `dr:enter` | button (ENTER / TOTAL ACCENT), LED |
| `dr:last` | button (LAST STEP, held) | | `dr:scale` | button (SCALE, a tap) |
| `dr:shuf` | button (SHUFFLE/FLAM, held) | | `dr:clear` | button (CLEAR, held — the 808's / 606's token) |
| `dr:isel` | button (INSTRUMENT SELECT, held) | | `dr:shift` | button (SHIFT, held) |
| `dr:step` | button, **multi** `n` 1–16, all present, LED | | `dr:scl` | led, **multi** `n` 1–4 (the scale rows) |
| extras | `dr:grid dr:pads dr:sync dr:toRoll dr:rec dr:map dr:sounds dr:demo` | | | |

Token ids another machine uses keep their widget (`dr:clear`, `dr:start` a tap, `dr:tempo`, `dr:step`; the 909's INSTRUMENT SELECT is a
new id, `dr:isel`, because `dr:inst` is a rotary) [C]. New in the validator (P1): a `display` kind for a `dr:` token (the DX7's `dx:led`
precedent, cv-panel.js:1494–1499: a text box, `hw-dsp`), `multi` on the 909's `dr:trk` / `dr:pat` / `dr:scl` (7a's `idx` / `full`
mechanism). `TOKENS.tr909.cells`: `dr:pads` **232 × 184** (4 × 3 pads of 52, 8 px gaps, 8 px top) [C]; the grid the 808's `DR_GRID`;
`xbreak` after `dr:pads` (two rows, §7.5). `RENDERED_TOKENS` gains the new ids; `usable('tr909')` once valid.

### 7.3 Validator and geometry (`cv-panel.js`, P1)

7a §7.3's rules for `tr909` (hit boxes ≥ 14 mm, disjoint, inside sections; no maker word; the model name only as plain text;
`panel-check` knows it); `drp()` passes `model` (7b); the display token's box must hold three characters at the panel's font.

### 7.4 The widgets (`cv-drum.js`, P1)

- **Tables** `UI.tr909`: the grid's 12 rows (codes AC BD SD LT MT HT RS HC RD CR OH CH on their lane bits; the accent / flam marks), the
  pads (§3.7), no dials (the 909 has no rotary), the name '909'; `machOf` / `sessOf` three-way (a 909 session carries `m`); every
  `six` branch of §0 a lookup by `M` (a 909 panel must never fall into the 808's grid hit-test, pad sizes, texts or cancel rule).
- **Held keys** (SHIFT, INSTRUMENT SELECT, CLEAR, LAST STEP, SHUFFLE/FLAM, the TEMPO key, AVAILABLE MEAS, the step keys) send down / up
  with pointer capture, Enter / Space held, 7b's cancel rule (`release`); **two step keys down together** = a pair / block / chain (Shift
  + a key does it with the mouse, 7b) [C]; **Alt + a key** = SHIFT + key (a mouse's keypad) [C].
- **Taps** (START, STOP/CONT, SCALE, TRACK n, PATTERN n, BACK, FWD, CYCLE, ENTER): `A.tap` (7b review 2 #1).
- **The step keys as drum pads** in TAP write: a key's down is a press (`{ k: 'key', n, down: true }`); drum-core decides the
  instrument, its state and the write, and returns `{ c: 'hit', sound, v }` (its up `{ c: 'hit', sound, off: true }`); cv-drum's
  `exec` plays it through the pads' note path (the primary note, `noteOn` / `noteOff` deps, `e.held` for the off, the `sel()`
  gate) **without** the pads' REC write — the press already wrote it. One mechanism (§10 and §11 said `{ c: 'hit' }`, this line
  said `api.drum.pads`: review #21); in the other modes they are the 909's keys. **The step keys and the held keys
  are `data-gesture="music"` zones** (7a's rule: two fingers on them are two presses — SHIFT + a key, a pair, a block, finger drumming —
  never a pinch); the taps are not (a pinch starting on one zooms, 7b review 2 #2) [C].
- **The display**: a text box (three characters, the DX7 LED's look, `hw-dsp`), painted with the LEDs, once a frame at most.
- **LEDs**: `LIT` gains `'dim'` (code 5; a CSS level between off and on, steady with reduced motion); the small keys' and ENTER's
  LEDs, the scale rows'.
- **DOM**: the module ≤ **1000** elements [C] (the 808's 847 at 7a's end; the 909 has 28 knobs, ≈ 24 keys and 16 step keys).

### 7.5 The extras strip

Full width under the face, caption `XCAPTION_DRUMS` + " · Hi-hats and cymbals: our own sounds through the 909's chip circuit" (the
layout's `extras.caption`) + "Dimmed controls are not emulated" (7a). Row 1: the grid (640) and the pads (232). Row 2: SYNC · → PIANO
ROLL · REC · MAP… · SOUNDS… · DEMO (560 px). No knobs (§2.5).

## 8. Canvas and the Sources tray

1. **Drums view**: lists TR-808, TR-606, TR-909 (MODELS order, `DRUMS = m => m.family === 'drums'`, cv-tray.js:334: no code change);
   its `note` (342) → "More machines later: the Simmons SDS-V with the pad controller."
2. **The tile**: `cv-art` `SIL.tr909 = { body: 'box', steps: 16 }` (the 808's body family: a wide low case) and `DRAW.tr909` — ours:
   a light-grey case, a row of nine knob columns with dark caps, a red three-digit display, a dark band of keys, sixteen square
   cream step keys with red LEDs, no text (cv-art.test's rules); meta "1983 · drum machine" (7a H2's rule, no maker); tip "TR-909
   (1983) — our model of its analog circuits; its hi-hats and cymbals are our own sounds through its playback circuit, not
   recordings"; the cost label from `COST.synth.tr909`.
3. **Tap / drop / Replace / + Track** as every instrument (7a §8); any switch between two drum machines is a model switch (7b §1.5,
   engine `mch`).
4. **The module**: fixed size from the panel; one `out` jack; the individual outputs drawn as `inert: 'later'` jacks; a GL face
   like every hardware face; Hardware only (7a's drum rule).

## 9. Modulation

Every 909 knob on the face (§1.1) is a **`proc`** destination (`cv-mods.FIELD_CLASS` `drum.<id>` for its new ids; `CLASS_TABLE.tr909`
regenerated by `node tools/cv-classes.mjs --write`); it has no switches, so no `struct` rows. Through the one-level `drum.<id>`
paths (7a §2.3, §9; engine `moRec`) `modSpan` is unchanged. TEMPO, SHUFFLE / FLAM and every sequencer key are sequencer state
(not models.js controls) and carry `data-nomod`. A crash / ride TUNE under modulation moves its sample clock per chunk (§2.3: the
clock is a function of its control voltage, read per absolute 4-frame chunk) — the span-stepped rule of 7a §9.

## 10. Host wiring (`main.js`; lane H1)

| site | change |
|---|---|
| `drumOf` (147–151) | the guard (150): `(d.drum.m \|\| 'tr808') !== d.model` re-normalises a record of another machine by the model (§6) |
| `normDevs` (208), `setTrackModel` (1784–1815), `drumEdit` (3258), `drumPayload` (3217), `addTrack` / `importMidiFile` (3542, 3989) | unchanged: they pass the model already (7b review #4); `setTrackModel` covers 808 / 606 / 909 in any order |
| `drumToRoll` (3299–3329) | `DC.toNotes(DC.rollPlan(D, project.bpm), DC.rollOpts(D, d))` — drum-core's `rollPlan` is today's `compilePlan(D, D.ui, D.x)` for the 808 / 606 (no session: the 606's track from its first bar, 7b) and, for the 909, its plan at the project's tempo (the flams' ticks: the synced sequencer's, §3.4); `rollOpts` builds the options per machine (§4: the 808 / 606's `swing`, `sw`, `prim` exactly as today; the 909's plan carries its shuffle, flams and accents, `rollOpts` adds its TOTAL ACCENT for `vel9`) [C]; the notice names "the 909's own sequencer" (its short name, 3318: no edit) |
| `drumNeeds` (156–162), `drumLoad` (3447) | the record's sounds by `DC.PERS[model].sounds` (§0's name tables), not the 808's list |
| `drTempoOf` / `drTempoPut` (3335–3339) | by the record's machine: `{ m, tempo }` for the 606 and the 909 (their TEMPO in BPM), `{ m: 'tr808', tempo, fine }` for the 808 |
| `restore` (1401–1402), `drumPayload` offline (3217) | (review #1) `DRUM.bpm(project.bpm)` **before** the `drumSend` loop (a 909's synced flam ticks read the session's tempo); the offline session `Object.assign(DC.initState(model), { bpm: project.bpm })` (a bounce's flams at the project's tempo, D7) |
| `offer303` (3394) and its three callers (1815, 3548, 5530) | unchanged (the 606 only: the 909 had no 303 pairing; the project clock locks it anyway) [C] |
| `DRUM = cvDrum.drumHost(…)` (1893) | unchanged deps (the 909's display reads the project tempo through `bpm()`); drum-core's new command `{ c: 'hit' }` (a TAP-write key, §11) runs through the existing `noteOn` / `noteOff` deps inside cv-drum's `exec` |
| `__synthTest` | unchanged (`cv.drum`) |

No `t.model` / `t.vals` / `fxOf(t)` in a new line (the accessor ratchet).

## 11. Lanes and the schedule (the leaner shape)

| lane | phase | owns (exclusive) | tests | model |
|---|---|---|---|---|
| **V9** voices | 0 | `dr-808.js` (§2: `MACH.tr909`, the third branch of the shell, the seven analog circuits and the shared noise, the ROM playback path, the accent DACs, `Dr808.gain('tr909', …)`, the generated ROM block's frame — its contents are R9's tool's output, never hand-edited), `tests/dr-909.test.mjs` (new), `docs/canvas/research-909-circuits.md` §16 (the component tables as modelled; R9 records its recipes in §14 below) | §12.1; runs `dr-808.test`, `dr-606.test`, `golden-drums`, `golden-606` unchanged | **standard** (the stage's hardest code) |
| **R9** source material | 0 | `tools/rom909.mjs` (new: our recipes → the three ROM images → the block in dr-808.js, `--write` / `--check`; listening renders to the scratchpad), `tests/rom909.test.mjs` (new) | §12.2 | **standard** (sound design: the user hears it) |
| **S9** sequencer | 0 | `drum-core.js` (§3, §4: `PERS.tr909`, the three-way dispatch, the name tables in `PERS`, the record, `press`, the plan, `leds`, `DEMO909`, the map, the velocity law, `toNotes` / `rollPlan` / `rollOpts`, the raised plan bounds, a 606 pin, the `{ k: 'bpm' }` send of §3.4), `dr-seq.js` (§3.5: accents, shuffle, flams, `once`, `guide`, the bounds, `simplePlan`'s optional 909 arrays for E9's warm-up), `tests/drum-core.test.mjs` (incl. :254's literal and :1001's unknown id `'tr999'`, §0), `tests/dr-seq.test.mjs` | §12.3, §12.4; runs `golden-drums`, `golden-606` | standard |
| **E9** engine + data | 1 (E9a first: `models.js` `tr909` + `FIELD_CLASS` / `CLASS_TABLE` + E9's test rules) | `engine.js` (§1.5), `models.js`, `cv-mods.js` + `tools/cv-classes.mjs` + `tests/cv-mods.test.mjs`, `tests/classic-mod.test.mjs`, `cv-cost.js` + `tests/cv-cost.test.mjs`, `tests/bench-scenarios.mjs` (`drumTrack(…, 'tr909')`, three-way — 262, 267, 269; the d9 rows) + `tests/bench.json` + `tests/bench.html` (c9; its note at 118 names the rows), `tests/engine-track.test.mjs` (additions; :1163's unknown machine `'tr909'` → `'tr999'`, §0), `tests/golden-909.test.mjs` (new; `ref-7c` frozen by the lead) | §12.5, §12.6 | standard |
| **P1** panel code | 1 (after E9a) | `cv-panel.js` (§7.2–7.3), `cv-drum.js` (§7.4: incl. every `six` site, `bpm(v)`'s press for a 909, `exec`'s `{ c: 'hit' }`), `tools/panel-check.mjs`, `tests/cv-drum.test.mjs`, `tests/cv-panel.test.mjs` (`HW_IDS` + `tr909`, **`EXTRAS.tr909`** (:33–39: the per-model loop at :330–337 reads `EXTRAS[id]` for every `HW_IDS` entry — review #11), `TARGET.tr909`, `NOKEYS` + `tr909`, 43 / 46), `tests/classic-panel.test.mjs` (253: any vertical switch the 909's layout binds) | §12.8 | standard |
| **X** satellites | 1 (from P1's first commit, the validator) | `panels/tr909.js` (new), `panels/index.js`, `cv-art.js`, `song.js` (if an edit is needed at all: §6), `cv-migrate.js` (schema 10), `cv-tray.js` (the note), `roll.js`, their tests (`cv-art`, `cv-migrate` 27 / 1051 / 1057 / 1148, `cv-tray` 566 / 568 / **569 (the note's text)** / 590, `roll`), `tests/canvas-7a-sim.test.mjs:68`, `tests/canvas-7b-sim.test.mjs:77` and `:487` | `panel-check tr909`, §12.7's data rows | **cheaper** (layout data from R9 §13's mm; mechanical edits) |
| **H1** host | 2 | `main.js` (§10), `tests/canvas-7c-sim.test.mjs` (new, accessor-free), additions to `tests/main.test.mjs` | §12.7 | standard |
| reviewers × 2 | 3 | (1) **real engine**: golden harness + `main-sim` with the real Track — D1 (ref-7a, ref-7b), D2, D5 with shuffle / flam / accents, D7 (the ROM's bytes, offline = live), every §3.3 row end to end, the circuits against R9's numbers, the ROM path against §2.3's prototypes; (2) **headless Chrome** (CDP, `--headless=new --use-angle=metal --force-device-scale-factor=2`; 1440 × 900, 1366 × 1024, 1024 × 1366): the face, the display, SHIFT / INSTRUMENT SELECT / CLEAR held by touch, step keys as tap pads with two fingers, the LEDs at the heard time, the Drums view, the roll's rows, no console errors | — | standard |
| fixers | after | the finding's files, the failing test first | | cheaper |

- **Phase 0** (V9 ∥ R9 ∥ S9): three lanes, each with files nobody else touches; base = `canvas` at this contract's commit (7b297e5
  + the docs). R9 hands V9 the ROM format first (§2.4: per sound a string of 6-bit codes, its length and nominal clock) with a
  placeholder image (its first quick recipe), so V9 never waits; the final images reach dr-808.js by `node tools/rom909.mjs
  --write` (the lead, at the phase-0 merge and again after any recipe change; `rom909.test`'s `--check` fails on a stale block).
  **Phase 1** (E9 → P1 → X; E9a first, P1 and X branch from it): base = `canvas` + V9 + R9 + S9 on the holding branch **`wt-7c`**.
  **Phase 2** (H1): `wt-7c` after phase 1, the lead's fixture check first (a page sim with the real engine: a 909 from the Drums
  view, its DEMO synced from bar 3 with SHUFFLE and a FLAM on — the step posts are the plan's, `F` on the 4-frame grid at its
  ticks' frames, each flam's second hit at its own tick's frame). **Phase 3**: the two reviewers → fixers → **one sweep** (every test
  file, one at a time; `golden-*` once) → the lead freezes `tests/ref-7c/` (§12.6) → docs (ROADMAP row 7, HANDOVER, §14) → **one
  squashed commit "7c" on `canvas`** → `tools/deploy-canvas.sh` → the user's iPad session (§12.9).
- **Known windows** on `wt-7c` until the phase-1 merge (merge order E9 → P1 → X): the MODELS-iterating tests owned by P1 / X
  (`cv-panel` `HW_IDS`, `cv-art`, `cv-tray`'s Drums list, `canvas-7a-sim:68`, `canvas-7b-sim:77`) fail on branches without the
  owner's change; `cv-migrate` / `canvas-7b-sim:487` until X's schema 10; `pwa.test`'s precache check until the lead's `node
  tools/precache.mjs --write` (the new `panels/tr909.js`). **Also (review #5, #14)**: `engine-track.test.mjs:1163` (its unknown
  machine is `'tr909'`) from V9's merge until E9's edit; `rom909.test`'s `--check` on every branch until the lead's `--write`
  at the phase-0 merge (R9 never commits dr-808.js; V9 commits the block's markers with R9's placeholder images — the tool's
  output and V9's hand-written code never share lines). Each lane runs its own files.
- **Rules for every builder** (7a §11, kept): `git reset --hard <base>` first (harness worktrees start from `main`; check `git log
  -1`); `?v=9` on every import; new test files `import './v8-guard.mjs'` first; never fake-DOM nodes in `assert.*`; one test file at a
  time (`node --max-old-space-size=2048 --test tests/<file>.test.mjs`); dense comments in the existing voice; **no Roland
  material** (D4: circuits in our words, schematics read for values only, nothing of the manuals' prose, no scans committed, **no
  ROM data of any machine fetched, read or compared**); no lane commits `sw.js`; commit on the worktree branch; report the commit
  hash and the gates measured. Briefs: the lane's row, its sections, the base.
- **Interfaces** (each lane stubs the other side): `Dr808.create(inst, 'tr909')` → 7a's machine interface (`set`, `setOS`, `hit`,
  `trig(mask[, acc])`, `render(buf, N, F0)`, `post`, `live`, `reset`, `mon`, `smp`, `setSalt`); `Dr808.gain('tr909', drum)`;
  `Dr808.mach.tr909` (`KNOB_IDS`, `KNOB_DEF`, `SOUNDS`, `sids`); `Dr808.proto.tr909` (`ACC9 { N0, L, TMAX }`, `ENV9` — the cymbals'
  staircase and the hats' converter constants —, the clock law, the ROM decoder, the component tables) (V9 ↔ E9, S9, R9). **The ROM
  format** (R9 ↔ V9): `ROM909 = { hh, cr, rd }`, one character per 6-bit word (the alphabet fixed in the tool and the decoder), the hat
  regions 0–24 575 / 24 576–32 767, 30 kHz nominal; the block markers; the tool reads `ENV9` through `tests/dsp-scope.mjs`'s loader.
  `DrSeq`: a plan's `ac`, `fl`, `mSh`, `mFl`, `once`, `guide`; `dm.trig(mask, acc)`; the raised `MAX_MEAS` / `MAX_STEPS`;
  `simplePlan(masks, pre, x?)` with `x = { ac, fl, sh, fm, once, guide }` making a one-measure 909 plan (E9's warm-up, the
  tests) (S9 ↔ E9, V9).
  `drum-core`: `normDrum(d, 'tr909')` (`model ?? d.m`), `PERS.tr909` (`lanes codes rows sids mask acLanes flLanes sounds names map
  scales tempo cleared acc`), `initState('tr909')`, `compilePlan` / `press` / `leds` / `gridPat` / `stepLen` / `demoFree` / `payload`
  dispatching on `D.m`, `vel9(sound, state, u)` / `vTrig9(v127, sound, u)`, `rollPlan(D, bpm)` / `rollOpts(D, dev)`, `tempo909(u)` /
  `tempo909Pos(bpm)`, the press inputs of §3.3 (`{ k: 'key', n, down, shift }`, `{ k: 'hold', b, down }` for SHIFT / ISEL / CLEAR /
  LAST / SHUF / TKEY / AVAIL, `{ k: 'tap', b, n? }` for START / STOP / SCALE / TRK / PAT / BACK / FWD / CYC / ENTER, `{ k: 'tempo', v
  }` in BPM, `release`, the extras, the host notifications) and the command `{ c: 'hit', sound, v, off? }` (a TAP-write key played
  through the host's note path) (S9 ↔ P1 / H1 / X / E9). cv-drum: `UI.tr909`, `machOf` three-way; `api.drum` unchanged in shape (P1 ↔
  H1); `drumRowsOf(dev)` unchanged (X ↔ H1).

## 12. Tests and gates

### 12.1 Voices (`tests/dr-909.test.mjs`, V9; each sound alone through `Dr808.create(…, 'tr909')` at 48 kHz × 4 and 44.1 kHz × 2)

- **Target (a)** per block (R9 §15): every fixed filter and network against its analog prototype — centres ± 1 %, magnitude
  ± 0.2 dB to 5 kHz at OS 4 (above 5 kHz for the ROM path's reconstruction filter: ± 0.5 dB to 0.4 · the word rate); the
  envelopes' time constants ± 2 %; the oscillators' frequency against their control voltage ± 1 %.
- **Target (b)** (R9 §15): R9's measured numbers — frequencies ± 3 %, times ± 15 %, the TOTAL ACCENT spans ± 2 dB, the LEVEL ratios
  ± 2 dB — and the [S] descriptions as qualitative checks.
- **Per circuit**: the BD's pitch sweep (start / end frequency at TUNE 0 / 5 / 10, monotone), ATTACK raising the click's share (the
  first 3 ms' energy over the next 30 ms, monotone over 0 → 10), DECAY monotone; the SD's two tones (1.500 apart over TUNE, the bend at
  the onset) and noise (SNAPPY its share, linear, silent at 0; TONE the main branch's decay, R9 §3); each tom's sweep and TUNE / DECAY;
  the RS (three rings, the ± 0.6 V clip) and HC (the bursts' onsets, the swelling tail) against R9 §5–§6; **the noise**: the register's
  sequence (taps 31 / 13, period 2³¹ − 1 on a reduced-length check), its jump to an absolute position equal to stepping there, the box
  integral per OS sample, one stream for SD, the BD's click, the toms and HC (their noise inputs correlated as the hardware's).
- **The ROM path** (§2.3), on a test image (a ramp, an impulse train, full-scale steps) and on the three images: the counter steps at
  the clock's rate (± 0.1 % at TUNE 0 / 5 / 10, monotone in TUNE), stops at its region's end holding the last word (DC, blocked by the
  couplings); the DAC's levels the code × LSB (exact); the band-limited staircase within −60 dB of a reference staircase rendered at
  64× and filtered, over 0–20 kHz at OS 4 (a naive hold fails it: a mutation test); the clock started at the trigger (the first word at
  the same OS sample whatever the span splits); the staircase's steps at their fractional times (span invariance and the OS change,
  below); **the alias gate (review #4)**: the band-limited staircase against the *exact* band-limited staircase (an integrated
  windowed sinc per step — not a 64× hold, whose own step jitter is ≈ −50 dB at 20 kHz), the error over 0–20 kHz at OS 4 on the
  three images ≥ 15 dB below a naive hold's (the mutation) and ≤ −35 dB re the signal, the numbers recorded in §14 — the
  "within −60 dB" first written here is beyond the 2-point polyBLEP: the review's scratch run of the DX7's method measured
  −40.0 … −44.7 dB (content to 15 / 8 kHz; naive hold −22 / −25 dB), −65 dB only for content under 2 kHz; a 4-point BLEP is
  V9's option if the lead wants more; the reconstruction filter's response; the envelopes (OH / CH DECAY at 0 / 5 / 10, the crash's and the ride's) ± 2 % against
  their RC; **the hats as one voice** (a CH during a ringing OH restarts the counter in the closed region and switches the decay path:
  the open sound gone within the CH's own envelope, the depth recorded in §14; OH + CH latched in one chunk = the closed hat); accent
  on the four sounds as R9 §8 reads it; **the shared DAC** (a ride hit during a ringing crash changes the crash's level as the held
  code says; RS / HC likewise).
- **The shared contracts** (7a §12.1): retrigger continues the state (the analog voices; a sampled voice restarts its counter as
  R9 §9 says); **accent** per R9 §8 (the held codes of the four states, §1.3: timbre where a nonlinearity sits in the path —
  correlation < 0.99 —, level only where it is linear: within 2 % of the ratio); 44.1 vs 48 kHz within 0.5 %; no NaN / Inf /
  subnormal (every knob at 0 and 10, OS 4 and 1); determinism; **span invariance** (4, 128, random multiples of 4 — the sampled
  voices' clocks and staircases included); order-free latching; no allocation over 200 spans; idle (an asleep 909 runs no circuit
  code; the ROM voices sleep when their envelopes are below 1e-5 of their scale); the sleep rule; the sample slots (§5); the §2.6
  level (± 1 dB of the 808's BD).
- **The 808 and the 606 untouched**: `tests/dr-808.test.mjs`, `tests/dr-606.test.mjs` (unchanged files), `golden-drums` (ref-7a)
  and `golden-606` (ref-7b) green after every V9 commit; the machines' CPU A/B (d8p, d8x, d6p, d6x within the run-to-run noise,
  7b's method, IMPL-7b §14 lane V6).

### 12.2 Source material (`tests/rom909.test.mjs`, R9)

- `--check`: the block in dr-808.js equals the tool's output (a stale or hand-edited block fails); the images' lengths, alphabet and
  code range (R9 §9); determinism (two runs, identical); each image's decoded codes through `Dr808`'s decoder equal the tool's.
- Sanity of the sound [C]: no code clipped for more than 0.1 % of an image; the first 2 ms hold the strike (its peak within the
  first 5 ms); the hat image's level 300 ms in ≥ 20 dB below its peak; the crash's spectral centroid rises over its first 100 ms
  (the cascade) and falls after; the ride's bell partials present over its whole length; DC below one LSB.
- **D4 guard**: the tool reads no file but dr-808.js (`--check`, the shared constants) and fetches nothing (a static check: no other
  `fs.read*`, no network module) — nothing of any machine's audio can reach it. (The static check covers `tools/rom909.mjs`; the
  constants come through `tests/dsp-scope.mjs`, which reads the repo's own DSP scripts only — dsp-scope.mjs:50 — said so in
  the test, review #25.)
- **Determinism**: two runs in one process and a fresh process byte-identical. The tool's maths (`Math.sin` / `exp` / `pow`) is
  node's; a later node whose libm moves an ulp could flip a code that sat on a rounding tie (≈ 10⁻⁶ odds over 98 304 words) —
  `--check` then fails loudly and the lead decides (`--write` + a new ref-7c), never a silent change; the worklet only reads
  the stored codes (D7) [review #25].

### 12.3 drum-core (`tests/drum-core.test.mjs`, S9)

The 79 tests of 7b unchanged **but two lines** (review #3, #14 — the same checks, not weakened): :254's `C.MAX_STEPS` → the
literal `768 * 32` (the 808's longest plan), :1001's unknown `m` `'tr909'` → `'tr999'`; **pins**: the 808's (`04ba14f6…`, 902) unchanged, and **a 606 pin** of the same form (records — `tr606`
with and without its `m`, a hostile one —, sessions, payloads at every `at`, plans, notes, the tables, `press` × 66 on 6 random records
with LEDs and grid) computed on 7b297e5's module before any change and unchanged after. New: `normDrum(·, 'tr909')` (idempotent,
bounds, hostile input, model wins over `m`); the three-way `machineOf` (`'tr909'` only for the exact string); the name tables
(`PERS.tr808.sounds` and `.names` deep-equal today's globals; the 909's ids 7 / 8 named `rd` / `cr`); `mapTable` / `primaries` /
`drumRows(map, 'tr909')`; `compilePlan` for the 909 (every mode, the step codes, LAST STEP, the plan's `ac` / `fl` / `mSh` / `mFl`,
mute / solo on the accents too, the key stable and sensitive, the shape timing-only + the shuffle); **one test per row of §3.3**
through `press`; `leds` (every row of §3.6); the display (§3.6); `toNotes` with `rollPlan` / `rollOpts` (the 808 / 606: today's calls'
bytes) of a 909 plan (positions with shuffle, the flam's hits, the velocities of §1.3); `vel9` / `vTrig9` (the four states' velocities
exact at 21 TOTAL ACCENT positions, monotone between, the drum-core and dr-808.js copies equal); the 909's tempo law; the constants
equal `dr-seq.js`'s and dr-808.js's accent constants (`N0`, `L`, `T_max`). Review additions: a synced 909's `{ k: 'bpm' }`
sends 'now' when its flam ticks change (and nothing when they do not); `mFl` clamped below each measure's smallest step gap
(32nds at SHUFFLE 7, 300 BPM); `ac` / `fm` masked by `st` in `normDrum`; `toNotes` keeps a flam's second note when its step
lies before `t0` and never wraps a `once` plan; the block / chain expansion of §3.3.

### 12.4 dr-seq (`tests/dr-seq.test.mjs`, S9)

The 26 tests of 7b unchanged; new: the raised `MAX_MEAS` / `MAX_STEPS` (a 1 793-measure plan valid, one more refused); a 909 plan's
accents reach `dm.trig(mask, acc)` (a fake machine logs them), the 808 / 606 plans call `trig` with one argument's worth (acc 0);
per-measure shuffle (every level, 16ths and 32nds, triplets unswung; a measure change moving the shuffle at its boundary; a live 'now'
plan with another shuffle is a new shape); **flams**: each flammed lane gets its second hit at the plan's spacing (every spacing level;
at a swung step; at the last step of a measure, crossing the boundary; a loop wrap / seek / stop between the two hits: the second is
dropped exactly when a note's would be — the song path's rule); the frames returned by `events(F)` include the pending flam hit (≥ 1);
`valid()` refuses a 909 plan with short `ac` / `fl` / `mSh` / `mFl`; **`once`** (silent after the plan's end, again after a re-anchor);
**`guide`** (RS on the beats, never on a 808 / 606 plan); free and synced; no allocation. Review additions: a `once` plan
re-anchored at or past its end stays silent (a seek, a loop wrap landing there); a re-anchor one step after a measure's last
(flammed) step still plays its second hit; the pending hit always due before the next step at the clamp's limit.

### 12.5 Engine (`tests/engine-track.test.mjs` additions, E9)

(:1163's unknown machine becomes `'tr999'`, §0.) A 909 Inst from `{t:'patch'}` and from `processorOptions` (live = offline); **808 → 606 → 909 → 808 on one Inst** (each its own
machine and a fresh DrSeq; a payload posted after its patch is kept, and one posted before it waits in `drPend` and plays; the
tail crossing each switch keeps its level through each machine's `gain` and drains on its own chain: 7b review 1 #3's `drPost`); a
909 on a graphed node; `warmUp` + `restore` leave a fresh 909 (its images decoded once: a second machine shares them); an OS change
through `osFade` (no click above −60 dB, a hat ringing); a `modRows` row on `drum.cru` through the real `moRec` (the crash's clock
moves); a panic while a crash rings; the bench rows d9p / d9x / d9m and **d9i** (row p's method) — V8; JSC by the lead.

### 12.6 Golden refs (`tests/golden-909.test.mjs`, E9; frozen by the lead)

- **Old sound (D1)**: every golden shard, `canonical-stream`, **`golden-drums` (ref-7a)** and **`golden-606` (ref-7b)** —
  bit-identical.
- **New refs (D2)**: `tests/ref-7c/` = verbatim `dr-808.js`, `dr-seq.js`, `engine.js` + `MANIFEST.json` (ref-7a's format; `PIN` set
  at the freeze; before it, B against itself, said in the header). Cases: every sound × { normal, instrument accent, total accent,
  both } at TOTAL ACCENT 5 and 10 × { the defaults, every knob at 0, at 10 }; OH + CH together and a CH during a ringing OH; a ride
  during a ringing crash (the shared accent level); the crash / ride at
  TUNE 0 and 10 (the clocks); the DEMO synced from tick 0 and from bar 2 with a loop; every SHUFFLE level; FLAM at the smallest and
  the largest spacing, on the last step of a measure; a track with several patterns; retrigger trains; OS 2; 44.1 kHz × 1; two
  sample slots (an analog voice's and a ROM voice's, §5). Gate `max |A − B| === 0`.
- **D5 (B only)**: the DEMO through the sequencer vs `toNotes(rollPlan, rollOpts)` of it through the song path — **bit-identical**
  over 8 bars at 120 BPM / 48 kHz at SHUFFLE off and at two levels, with flams and every accent state present; without a payload
  and with the SYNC-off payload "→ Piano roll" leaves; at 97 BPM every hit (flams' included) on the same 4-frame grid point or the
  next.

### 12.7 Host, data, the model-iterating tests (H1, X, E9)

- `canvas-7c-sim` (new, accessor-free): the Drums view lists TR-808, TR-606, TR-909, a tap replaces; the face renders with
  `api.drum`; START synced starts the project; the display shows the tempo and, running in a track mode, the measure; PATTERN WRITE
  running: a step key cycles the instrument's step through its states (§3.3) in place; LAST STEP; SCALE; SHUFFLE / FLAM set and
  heard (the step posts' frames move); TAP write with the step keys as pads (two fingers: two instruments; the accented key
  accents); a pattern chain; TRACK WRITE → TRACK PLAY; the LEDs at the heard time; MIDI 36 plays the kick; → Piano roll (the
  rows, the velocities, the flams as notes) and its undo; MAP…; a sample in SD and one in the hats' slot (§5), relinked through the
  asset manager (the record stays a 909's); Save / reload identical (schema 10); **808 ↔ 606 ↔ 909 Replace** and undo / redo twice,
  plain and graphed, with an FX asset still building so the patch waits (each machine's synced steps play every time; the panel's
  session follows the record); bounce includes a synced 909 with no notes. Review #1: at a project tempo of 100 BPM a synced
  DEMO with a flam bounces bit-identically to the live render (the offline session's tempo); a tempo edit while it plays moves
  the flam's second hits (one 'now' payload), and its undo moves them back (the restore's order).
- X: `song` (normDev keeps a 909's `drum` through `normDrum(·, 'tr909')`; an 808 / 606 record unchanged; export ch 10), `cv-migrate`
  (schema 10: a schema-10 project read-only in a schema-9 gate; STEPS[9] stores nothing new; the lost-line names the TR-909),
  `cv-tray` (the Drums view lists `['tr808', 'tr606', 'tr909']`; the note text; no SIMPLE badge), `roll` (a 909's rows by its
  names: Ride / Crash on ids 7 / 8; the 808's and 606's unchanged).
- **Tests that iterate MODELS** (none weakened): `cv-mods.test` counts (controls + the 909's, proc + the same, struct unchanged; its
  new `drum.<id>` fields), `classic-mod.test` (every 909 knob's `drum.<id>` target resolved by the real `moRec`), `cv-cost.test`
  (`COST.synth.tr909`), `cv-art.test` (`SIL` / `DRAW.tr909`), `cv-panel.test` (`HW_IDS`, `TARGET.tr909`, `NOKEYS`),
  `classic-panel.test:93` (renders, one `data-dest` per control) and `golden-graph` / `smpgen` / `integration:656` / `cv-shell-sim`
  / `cv-graph.test` (the `family` rules: no edit).

### 12.8 Panel (P1 / X)

`cv-panel.test` + `cv-drum.test`: `TOKENS.tr909` validated (one mutation per rule); `panel-check tr909` clean; rendered with a fake
`api.drum`: 16 keys with `data-lit` (and the accent / flam codes, §3.6), the display's three digits, every button's press / hold
order (SHIFT and INSTRUMENT SELECT held + a key → down, key down, key up, up), the step keys as pads in TAP write (two pointers =
two hits), a cancelled hold sends `release`; without `api.drum` the same nodes, `aria-disabled`; the grid's 12 rows and its accent
/ flam marks hit-test at 3 zooms; LEDs and the display ≤ 1 paint a frame; the module ≤ 1000 elements [C]; the 808's and the 606's
panels and widgets unchanged (their tests green).

### 12.9 Rendering, UI and the iPad

- Reviewer 2 (CDP): the 909 face GL vs `?nogl` (≥ 99 % within 8 / 255 at k 0.5 and 1); G1 `equalPx` mid-pinch vs rest; the grid
  canvas ≥ 1:1 at rest; SHIFT + a key and two-finger tap writing; LED and display updates ≤ 1 a frame at 290 BPM in 32nds; the 808's
  and the 606's panels 0 px changed.
- **iPad session** (after deploy): `bench.html` five passes → `bench.json` `"ipad7c"` (old rows within 5 % of the newest iPad row
  then recorded — `ipad7b`, `ipad7a`, else `ipad2b`; bench.json at 7b297e5 has none of the 7a / 7b ones —, d9p / d9x / d9m / d9i ≤
  their iPad targets, `stale: false`, the deployed build; the iPad's first-context ready time with the 909's warm-up); hands-on — the
  Drums view, a 909 beside the 808 and the 303, a house groove written on the face (accented and normal steps, LAST STEP, SHUFFLE, a
  FLAM on the snare), TAP write on the step keys with two fingers, the hats' DECAY knobs and the choke, the crash / ride TUNE, →
  Piano roll, your own ride in its slot.

## 13. Questions for the user

Only what the user alone can decide; each has the default the build uses until answered.

1. **How our hi-hats and cymbals are made.** The real 909 played short recordings of real cymbals from three memory chips. We can't use
   those, so we feed its real playback circuit (the gritty 6-bit chips, the tuning, the decay circuits) our own sounds.
   **Recommended:** we **synthesise** them — a computer model of struck metal plates (a pair of hi-hats played open and closed, a
   crash, a ride), made by our own tool and labelled "ours"; before we lock the sound in, we send you five short audio files (the hats
   open and closed, the crash, the ride, a groove), and you can ask for brighter / darker / longer. Alternatives: (b) **your own
   recordings** as the built-in kit, if you have cymbals and a decent microphone (five hits; we turn them into the chips); (c) **free
   public-domain cymbal recordings** made by someone else (nearer a real cymbal, but not ours, and credited).
2. **Your own hi-hat and cymbal sounds.** When you load your own sound into the open hat, the closed hat, the crash or the ride:
   **Recommended:** it goes **through the 909's chip circuit**, like swapping the memory chip on the real machine — your sound gets the
   909's 6-bit grit, its TUNE and DECAY knobs and its open / closed hat behaviour. Alternative: played clean, as on the 808 and 606.
3. **Extras knobs.** The 909 already has tune and decay knobs on its panel for every drum. **Recommended:** none (the extras strip
   has the step grid, pads, sync, → Piano roll, map, sounds, demo). Alternative: a **hi-hat TUNE** knob — the real 909 has none for
   the hats; adding one is a well-known modification — at its centre the original.
4. **Mono or stereo.** The 909 has a left / right pair of main outputs that place the toms and cymbals a little to each side (and a
   MONO jack). **Recommended:** **mono** now (the MONO jack — the same as every drum machine so far), and stereo together with the
   per-drum outputs when full patching arrives (stage 4). Alternative: stereo now (more work in the sound engine's drum path).
5. **Which 909.** Roland changed a few parts during production (a wider kick TUNE, a stronger 1 kHz in the rim shot, thinner hi-hats,
   punchier toms). **Recommended:** the **later** version — the circuit the service notes print and the one most analyses measured;
   the earlier one could come later as a "unit character" option. Alternative: the earlier one.

**Things you will notice (no decision needed)**: the Drums view gains the TR-909; its panel is drawn at real size (a little narrower than
the 808's); its kick, snare, toms, rim shot and clap are our model of its circuits and its hats and cymbals our own sounds through its
chip circuit (both labelled); you program it the 909 way — hold INSTRUMENT SELECT and press a drum's key, then each step key cycles
off → normal → accented, and a step row of its own adds the total accent; SCALE, LAST STEP, SHUFFLE and FLAM (kick, snare and toms)
are set per pattern on the panel; in tap-write the step keys are drum pads (left key accented, right normal), several fingers at
once; the closed hat cuts the open one (one voice, as on the original); turning the crash or ride TUNE up also makes it shorter (the
chip is played faster); patterns change at the end of the bar; two keys at once play a block of patterns; tracks are written measure
by measure with ENTER; the small keys in the middle are spaced slightly wider than on the original so a finger hits only one; the
individual outputs are drawn and become cable-able with full patching (stage 4); the MIDI, sync, tape and cartridge parts are printed,
not working; there is no swing knob in the extras strip (the 909's own SHUFFLE does it).

**And one request**: after the deploy, a 15-minute iPad session — `canvas.domlavin.com/tests/bench.html` (five passes, Copy results) and
the hands-on list of §12.9.

**Answers (the user, 2026-10-20):** all five as recommended — **Q1** we synthesise the hi-hats and cymbals (modelled struck
plates by `tools/rom909.mjs`, rendered into the 6-bit chip format; the five listening files before the freeze, §2.4); **Q2**
"load your own" on the hats and cymbals plays through the 909's circuit — a chip swap: reduced to 6 bits, through its tune /
decay / filter (§5's default); **Q3** no extras knobs; **Q4** mono (already settled by the user's "mix output first" for every
drum machine); **Q5** the late revision. Settled: the build's defaults above stand; the review (§15) does not reopen them.

## 14. Notes (the builders fill in)

(One subsection per lane: as built, the [C] refinements with their reasons, the measured gates — 7a / 7b §14's format. V9 also fills
R9 §16 with the component tables as modelled; R9 the recipes as built and the images' statistics.)

### Lane R9 (source material) — `tools/rom909.mjs`, `tests/rom909.test.mjs` (2026-10-20, base b8e97ee)

**As built.** `node tools/rom909.mjs` builds the three images (≈ 3.2 s node, 5.5 s JSC) and prints each sound's statistics and
whether dr-808.js's block is current; `--write` rewrites the block, `--check` exits 1 unless it is current (a missing frame
fails too, saying so), `--block` prints it, `--hash` prints the images' FNV-1a hashes, `--wav <dir>` writes the listening
renders. No dependencies; it reads no file of its own (dr-808.js comes through `tests/dsp-scope.mjs`'s `source` / `dspScope`)
and fetches nothing (D4; the test's static check). The pipeline per sound: the plate model rendered at 192 kHz → a Kaiser
windowed sinc (cut 14 kHz, 13 → 15 kHz transition, ≈ 70 dB, 415 taps, 5 polyphase rows: 192 / 30 = 32 / 5, each row's DC gain
1) → 30 kHz words → pre-compensation (below) → a raised-cosine fade over the region's last `fade` s to exactly 0 → peak
normalised to ± 31 · 10^(−1/20) = ± 27.6 LSB → `32 + round(v)` (no dither). The hat image is the open sound's 24 576 words then
the closed sound's 8 192.

**The format (R9 ↔ V9; handed over at 0e89551).** V9's frame in dr-808.js: two marker lines, each alone on its line at any
indent — `/* ROM909 — generated by tools/rom909.mjs, do not edit */` and `/* end ROM909 */`; every line between them is the
tool's, written at the start marker's indent: three comment lines (recipe version, the format, the images' FNV-1a hashes, which
staircase pre-compensated the cymbals — "the tool's stand-in (placeholder: no ENV9 yet)" until V9's model exists), then
`const ROM909_A = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';` (64 symbols in ASCII order, code = index;
no backslash, quote, backquote, `$` or `{`) and `const ROM909 = { hh: '…', cr: '…', rd: '…' };` (each image on its own line,
32 768 characters). Codes 6-bit unsigned, mid-scale 32; 30 kHz nominal; hh open 0–24 575, closed 24 576–32 767. **Each sound's
peak is ± 28 codes about 32** (V9 calibrates the playback's levels on that) and **each region's last word is exactly 32** (the
latch then holds a silent word); the first words are the strike. Block ≈ 99 KB.

**What the tool reads from V9** (through dsp-scope): `Dr808.proto.tr909.ENV9.cr` / `.rd` — 64 positive numbers each, the cymbal
VCA's gain at staircase step k = word >> 9 (A9–A14), any common scale (the tool divides by entry 0 and quantises to 2⁻³²). If
`Dr808.mach.tr909` exists and ENV9 lacks that shape the tool throws (never a silent stand-in); without a 909 it uses its
stand-in (the anti-log of a linear ramp: 0.263 dB a step for the crash — −14 dB at 0.91 s, R9 §9 — and × R432 / R439 = 270 / 470
for the ride) [C]. **What the test reads**: `Dr808.proto.tr909.rom9()` → `{ hh, cr, rd }` Uint8Arrays equal to the tool's codes
(decoded once: the same object on a second call). The names are R9's proposal; another name is a one-line change in the test.

**The recipes (v1; seeds `mulberry32(fnv1a32('rom909:<name>:1'))`, names `hh` `cr` `rd` (the plates' modes), `oh` `ch` `cr` `rd`
(each hit), `oh-chatter`).** Every sound is struck plates: modes on a jittered grid of constant density per Hz from the plate's
lowest mode to 20 kHz (drawn to 20 kHz; those above 16.5 kHz not rendered — the sampler's filter removes them), each with a
mode-shape coupling (a Gaussian) and a cascade phasor (a complex Gaussian). Each mode is three resonators on its frequency:
the **ring** (decay σ(f) = σ0 + σ1 f + σ2 f², f in kHz), the **move** (σ + 1/ρ(f), ρ = ρ1k (f / 1 kHz)^γ: below the cascade's
knee fc a share `drain` / (1 + (f/fc)²) of the mode's strike energy drains away — into the cascade —, above it the cascade's
energy arrives, rising from 0 over ρ, weight g (f/fc)² / (1 + (f/fc)²) / (1 + (f/fh)²)) and the **tick** (σ + 1/τt: a share q
of the strike, the stick's contact transient, its mode amplitudes a mix `coh` coherent + (1 − coh) the mode shape — the
coherent part is the impact's crack). The strike: the force pulse t·e^(−t/θ) (unit area, spectrum 1 / (1 + (ωθ)²): no nulls)
through every resonator; amplitude tilt (f / 1 kHz)^β · f² / (f² + fl²) / (1 + (f/fh)²).

| | plates (lowest mode, modes / Hz) | θ | tilt β, fl (fh) | σ0, σ1, σ2 | tick q, τt, coh | cascade g, fc (fh), ρ1k, γ, drain | own | pre-compensation, fade |
|---|---|---|---|---|---|---|---|---|
| **oh** | two 14" plates: 380 Hz, 1/27; 415 Hz, 1/25 | 20 µs | 0.2, 900 Hz | 3, 0.4, 0.012 | 0.6, 3 ms, 0.08 | 0.5, 5 kHz, 3 ms, 1.2, 0.25 | **chatter**: impacts on the modes ≥ 3 kHz, 1500 / s, each a Gaussian × 0.006 × the mode's strike amplitude, falling with τ 0.25 s, ramping in over 8 ms, × max(0, 1 + 0.6 m(t)) — m a slow random pressure (Gaussians held 8 ms through two 15 Hz one-poles, unit RMS) | compressed α 0.2 (cap 12 dB), 60 ms |
| **ch** | the same pair clamped: every mode × 1.06 | 18 µs | 0.4, 1.8 kHz | 8, 0.8, 0.02 + 60 (1.5 kHz / f)² (the clamp choking the low modes) | 0.5, 2 ms, 0.08 | 0.3, 6 kHz, 2 ms, 1.0, 0.3 | — | compressed α 0.35 (cap 9 dB), 40 ms |
| **cr** | an 18" thin crash: 115 Hz, 1/13.5 | 60 µs | 0.2, 350 Hz | 0.8, 0.18, 0.006 | 0.4, 6 ms, 0.4 | 0.5, 3.5 kHz (9 kHz), 20 ms, 0.7, 0.3 | — | ÷ the staircase (boost capped 24 dB), 220 ms |
| **rd** | a 20" ride: 160 Hz, 1/15.5 | 20 µs | 0.3, 500 Hz | 2.6, 0.35, 0.01 | 0.45, 4 ms, 0.08 | 0.35, 3 kHz (9 kHz), 12 ms, 0.6, 0.25 | **bell**: partials 742 Hz × 1, 2.13, 3.04, 4.37, 5.55, amplitudes 1, 0.85, 0.7, 0.5, 0.35 (× 2.5), τ 2.6, 2.1, 1.7, 1.3, 1.0 s, each a split pair (+ 0.9 (1 + 0.35 j) Hz, τ / 1.15, 60 / 40 %) — slow beating | ÷ the staircase (cap 24 dB), 180 ms |

The hats' compression divides by the 5 ms-RMS envelope made monotone from its peak (a running maximum from the right: a
compressor with a slow release), to the power α, capped — so the 64 codes carry the sizzle and the image keeps a natural decay
that a long DECAY reveals. The cymbals' pre-compensation divides each word by the staircase's gain at its step, so the circuit
gives back the designed decay at any TUNE (word-based: the staircase stretches with the clock).

**Measured** (the test's numbers; the cymbals as played = codes × their staircase, the hats as stored): no code clipped; DC
≤ 0.005 LSB (every 4096-word block < 1 LSB); each sound's peak at its strike (0.03–0.07 ms; the first 2 ms reach 100 % of it);
**−14 / −20 dB** (the last 5 ms window within that of the loudest): open hat 326 / 516 ms, closed hat 113 / 160 ms, crash 884 /
970 ms (R9 §9's scope ≈ 0.91 s), ride 283 / 914 ms (R9 §9 ≈ 0.30 s; the bell then sustains at ≈ −21 dB); **centroids** (0–15 kHz,
the whole sound): closed hat 8.7 kHz, open hat 7.6 kHz, ride 4.9 kHz, crash 4.7 kHz; the crash's centroid 3.1 kHz (0–34 ms) →
5.0 kHz (100 ms) → 4.3 kHz (500 ms) → 3.6 kHz (800 ms) — the cascade; the ride's three lowest bell partials 12–42 dB over the
spectrum's median within ± 400 Hz at 0.05 … 0.9 s; the open hat's RMS 250–350 ms −25.1 dB re its peak, −8.9 dB re its 20–50 ms.

**Determinism (D7, §12.2).** Every operation that shapes a code is one ECMAScript specifies exactly on doubles: + − × ÷ (IEEE
754, round to nearest; engines never contract to FMA), `Math.floor` / `round` / `ceil` / `abs` / `min` / `max`, mulberry32's
integer ops, literals of ≤ 17 significant digits (parsed correctly rounded). sin / cos / exp / log are fixed series on those
(Cody–Waite-free range reduction by π/2 and ln 2, Taylor / atanh series to < 1e-17), √ a fixed Newton iteration — never the
engine's `Math.sin` / `exp` / `pow` / `sqrt` (ECMAScript leaves them "implementation-approximated": V8 uses its fdlibm port,
JSC the system libm, and either may move an ulp between versions). The test proves it statically (no such call, no `**`, no
`Math.random` in the tool) and dynamically (two builds and a fresh process byte-identical). Measured across engines: **JSC
(the macOS shell, i.e. WebKit's engine) builds the same three hashes as node 24** (hh 0x261674e6, cr 0x76c32136, rd 0x726c5505
at this commit, stand-in staircase); a counterfactual copy with the engines' `Math.sin` / `cos` / `exp` / `log` also gives the
same bytes in both — every word's pre-rounding value sits ≥ 1.6e-6 LSB from a tie (oh 5.9e-6, ch 1.8e-4, cr 1.6e-6, rd 3.0e-6;
the test gates ≥ 1e-9), against ≈ 1e-14 LSB for an ulp-level change — so the exact maths makes a guarantee of what the 6-bit
rounding already absorbs. The one outside input, V9's staircase (its own maths may use `Math.exp`), enters quantised to 2⁻³²;
a last-bit change there moves a gain by ≈ 2⁻²⁰ of a quantum. The worklet only ever reads the stored codes.

**[C] refinements (for the lead):**
- *The strike's force pulse*: θ 18–60 µs (contact ≈ 5θ = 0.1–0.3 ms), not §2.4's "≈ 0.5–1 ms": a 0.5 ms pulse's spectrum falls
  12 dB / octave from ≈ 300 Hz — a dull thud no stick on bronze makes; the crash's broader 60 µs is the stick's shoulder.
- *The open hat's sizzle* as **chatter impacts** re-exciting the upper modes, their strength swelling with a slow random contact
  pressure (§2.4's "slow random modulation"), rather than a gain on the upper band: a gain only moves the energy already there,
  so the sizzle could not outlast the plates' own decay.
- *§12.2's "the hat image's level 300 ms in ≥ 20 dB below its peak"*: read as the RMS over 250–350 ms against the image's peak
  |code − 32| (−25.1 dB), with our own second gate ≥ 6 dB below its 20–50 ms RMS (−8.9 dB). The 5 ms-window reading would need
  the open image down ≈ 15 dB by 300 ms below its sizzle — shorter than R9 §9's *played* open hat (−14 dB at 0.29 s at the
  default panel), which the image must outlast for the RC envelope to shape it.
- *§12.2's strike gate* "the first 2 ms hold the strike (its peak within the first 5 ms)": measured **as played** — the
  cymbals' codes × their staircase —, since the pre-compensation lifts a cymbal's late body in the stored image by design.
  As played, every sound peaks at 0.03–0.07 ms (the crash's strike made coherent, `coh` 0.4, for it).
- *Character gates of our own* (rom909.test "character"): crash −14 dB 0.77–1.05 s and ride 0.255–0.345 s (R9 §9 ± 15 %),
  the hats' images' own −14 dB later than the circuit's at its default panel (OH ≥ 0.25 s, CH ≥ 87 ms) and fading by their ends,
  centroids CH 7.5–10, OH 6–9, crash 3.5–6, ride 3–5.5 kHz, the clamped pair brighter than the open one.
- *For V9*: fit the hats' converter and the cymbals' staircase against the **final** images (after the lead's `--write`), not
  the placeholder — the hat images carry their own decay (above), which the RC envelope multiplies. The cymbals are immune: the
  pre-compensation divides out whatever staircase ENV9 holds (a staircase steeper than ≈ 24 dB over the image ends the played
  crash below the design, where it fades anyway). Any ENV9 change makes the block stale: `--check` fails until `--write`.

**Listening renders** (`node tools/rom909.mjs --wav <dir>`; this run: `scratchpad/7c/r9/renders/`): `naive-oh/ch/cr/rd.wav` (the
stored codes at 30 kHz — the cymbals flat: pre-compensated), and the five for the user — `1-open-hat`, `2-closed-hat`,
`3-crash`, `4-ride` at the default panel and `5-groove` — plus both ends of OH / CH DECAY and crash / ride TUNE (`oh-ohd-0`,
`oh-ohd-10`, …). With a 909 in dr-808.js they are rendered **through Dr808's own 909** (48 kHz × 4, its output stage; the
groove two bars at 120 BPM with BD, SD + HC, the hats, a crash and the ride); without one (this branch) through the tool's
**stand-in** of the path at 960 kHz (`*-standin.wav`, the groove ROM voices only): the clock from the trigger, the counter
holding its last word, code − 32, the VCA (the hats an RC — R9 §9's τ, a linear stand-in for V9's converter —, the cymbals the
staircase), the two Sallen-Key reconstruction filters, the hats' 723 Hz coupling, a windowed-sinc decimation. The lead
re-runs `--wav` after the phase-0 merge for the five files the user hears (§2.4). The render harness was checked with the 808
standing in for the 909 (create / set / hit / render / post).

**Tests** (`node --max-old-space-size=2048 --test tests/rom909.test.mjs`, ≈ 10 s): 8 — the format, the block (parsed in a vm,
decoded; the frame rules on a synthetic dr-808.js: stale, hand-edited word, missing / malformed frame, idempotent `--write`),
**`--check` and the decoder (the known window: fail until V9's frame and the lead's `--write`)**, determinism, D4, sanity,
character: 6 pass, 2 fail as expected on this branch. `--write` / `--check` verified end to end on a temporary (uncommitted)
frame inside dr-808.js's IIFE (dr-808.js still loads). `lint.test` green.

### Lane S9 (sequencer; phase 0, base b8e97ee)

**Files**: `drum-core.js`, `dr-seq.js`, `tests/drum-core.test.mjs` (79 → 130 tests; :254 → the literal `768 * 32`, :1001 → `'tr999'`),
`tests/dr-seq.test.mjs` (26 → 39; the fake machine's `trig` logs its arguments as given in a new `T.targs`, no existing test
changed). Commits 41b15bc (the 606 pin, before any change) … 7b882c3.

**Gates** (node 24, one file at a time): drum-core 130/130, dr-seq 39/39, **golden-drums 5/5** (ref-7a bit-identical; its D5 61
hits on the same frame), **golden-606 11/11** (ref-7b), lint 141/141; and, unchanged and green on this branch, cv-drum 37,
roll 50, engine-track 57 (its :1163 `'tr909'` still unknown here: dr-808.js has no 909 until V9's merge — E9's edit), classic-panel
13, cv-migrate 52, cv-cost 13, sx-base 23, wk 100, canvas-7a-sim 23, canvas-7b-sim 14. **The 808 pin** (`04ba14f6…`) unchanged;
**the 606 pin** — the same form as the 808's: records (`tr606` with and without its `m`, a hostile one, read without a model and as
an 808), sessions, payloads at every `at` with three sessions, plans with sessions, notes, the tables, `track606`, the laws, and
66 `press` calls on each of 6 random records with their LEDs and grid — `76c68a68…` computed on b8e97ee's module before any
change, unchanged after. **Mutations**, each caught: no `flamBack` (a re-anchor drops the second hit); `once` wrapped at a
re-anchor; `once` looping; the shuffle from the payload's swing; `trig(mask)` for a 909 step; flams never firing; `mSh` out of
`sameShape`; the second flam note's `d` 120 (D5); no flam clamp; `toNotes` wrapping a `once` plan; a flam before `t0` dropped;
`vel9` blind to the voice.

**Interfaces as built** (for V9 / E9 / P1 / H1 / X):
- `PERS.tr909` = `{ id, lanes, codes, rows, sids, mask, acLanes, flLanes, sounds, names, laneSound, map, keys, banks, groups,
  patterns, steps, tracks, bankMeas, scCode, stepT, spb, swung, modes, scales, keyLane, tempo, cleared, vel, acc }`; constants
  `LANES909 CODES909 ROWS909 SOUNDS909 NAMES909 SIDS909 MASK909 AC909 FL909 M9_PP/PW/TP/TW MODES909 N_PAT9 N_STEP9 N_TRACKS9
  BANK_MEAS CLEARED9 TEMPO9_LO/HI VEL9 ACC9 MAP909 DEMO909`; `PERS.tr808` / `tr606` `.sounds` / `.names` are the globals
  `SOUNDS` / `SOUND_NAMES` (the same objects). `mapTable` / `primaries` / `drumRows(map, model)` read `PERS[model]`.
- `normDrum(d, 'tr909')`, `initState('tr909')` (`m: 'tr909'` — cv-drum's `sessOf`; a foreign session under any record becomes the
  record's machine's, keeping run / play / pos / bpm, both ways), `compilePlan(D, ui, x, S)` (the 909's reads S: `bpm` — the
  synced flam tempo —, `loc`, `ptr`, `pend`), `payload`, `press`, `leds`, `gridPat`, `stepLen`, `demoFree`, `freeBpm`, `withTempo`
  dispatch on `D.m`; `vel9(sound, state, u)` (u unread), `vTrig9(v127, sound, u)`; `tempo909(u)` / `tempo909Pos(bpm)`;
  `rollPlan(D, bpm)` / `rollOpts(D, dev)` — H1: `DC.toNotes(DC.rollPlan(D, project.bpm), { t0, t1, ...DC.rollOpts(D, d) })`
  gives the 808's / 606's today's bytes (tested against today's call).
- **Press inputs**: `{ k: 'hold', b, down }` (b `shift isel clear last shuf tkey avail`), `{ k: 'tap', b, n }` (b `start stop scale
  trk pat back fwd cyc enter`), `{ k: 'key', n, down, shift, f }` — **`f`** (an addition: TAP write's fraction of the heard step,
  `stepLen` as the 808's TAP; P1 sends it with every key down in TAP write), `{ k: 'tempo', v }` (whole BPM via `tempo909`),
  `{ k: 'start' }` (the host's START / STOP toggle — "→ Piano roll" stops a free machine with it, main.js:3315), `release`, the
  extras (`grid` takes `flam: true` for the long press), the host notifications (`bpm` returns `send('now')` when a synced plan's
  flam ticks move — P1's `bpm(v)` presses it for a 909 entry, review #1). Commands add `{ c: 'hit', sound, v }` / `{ c: 'hit',
  sound, off: true }` (a TAP-write key; its up the off of the sound its down played).
- `leds(S, D)` → `{ step[16] 0–5, scl[4], trk[4], pat[3], tkey, back, fwd, avail, cyc, enter, disp }`, `disp` three characters.
- **DrSeq** (V9 / E9): a 909 step calls `dm.trig(mask, acc)` — `acc` the per-voice accents `& mask & 0x83E`, the AC bit in `mask`;
  a flam's second hit `dm.trig(lanes | AC, acc & lanes)` (its own call, no post); the guide's click `dm.trig(mask | 0x40, acc)`
  joined, or `dm.trig(0x40, 0)` **a second call in the same chunk** when the step has TOTAL ACCENT or no sound (V9: one more
  trigger to latch); an 808 / 606 plan `trig(mask)`, one argument. Exports `AC9 FL9 VEL9`; `simplePlan(masks, pre, x)` with `x =
  { ac, fl, sh, fm, once, guide }` — `ac` / `fl` masks by step, **`sh` / `fm` in whole ticks** (sh on 16ths / 32nds only; fm
  clamped below the smallest step gap; 19 ticks when absent).

**Readings where §3 is silent, and [C] refinements** (each tested):
1. **D5 and the notes' lengths** (refines §4's "`d` 120"): a flam's second note ends where its step's other notes end — the step
   + 120 (+ 240 when the spacing reaches 120): `d2 = 120 · ⌈(mFl + 1) / 120⌉ − mFl`. With `d` 120 its note-off fell off the steps'
   grid (t + mFl + 120, e.g. one tick before a swung 32nd), split the song path's span there and moved that step to the next
   4-frame point against the sequencer's — the fixed D5 case (SHUFFLE 7 on 32nds, FLAM 16) failed bit-identity at 120 BPM / 48
   kHz; every note-off now sits on the 20-tick step grid (or on a note-on), and a random-pattern D5 gate (every SCALE, SHUFFLE,
   FLAM, both accents) is bit-identical at 120 BPM and within a grid point at 97 / 133. §4's premise "every event lands on its own
   frame" holds for steps (multiples of 20 ticks = 500 frames), not for flams' second hits (any tick): those are robust because
   off-grid, the grid's note-offs are what had to move. E9's golden-909 D5 reads the same `toNotes`.
2. **A measure without a flam carries no spacing** (`mFl` 0): a tempo change then leaves its plan's key alone (the `{ k: 'bpm' }`
   send only when a flam would move).
3. **`once` with a free located start** (STOP/CONT from a measure): the plan stays 7b's pre-roll + cycle (`loopFrom` = the
   track's length − the start), so CYCLE toggled while running is the same shape (sent 'now', in place); DrSeq's `once` falls
   silent at the plan's **first pass** — the pre-roll's end when `loopFrom > 0`, else its end (`endOf`); `toNotes` likewise.
4. **START while running does nothing**; synced START / STOP/CONT are the project's ▶ / ■ (the song position is the machine's: a
   located measure `loc` only matters free). Free STOP in TRACK PLAY records the measure heard as `loc`, so CONT continues there
   (from its step 1); in the pattern modes CONT starts the selection again *(superseded — review 1 F4, the [R] row restored: CONT
   continues at the step after the last one played, the pattern modes and TRACK PLAY alike; §14 "Fixes")*. BACK / FWD / locate move `loc` only while stopped —
   the free plan reads it, and a resend under a running pre-roll would swap at the bar to its cycle start.
5. **PATTERN n**: stopped PATTERN PLAY sets the group at once (the selected key kept); running, it arms `pg` and the next key
   selects there ('bar'); from another mode it switches to PATTERN PLAY; **in TRACK WRITE (and INS / COPY) it is the group of the
   next key** — leaving TRACK WRITE for PATTERN PLAY is TRACK n then PATTERN n.
6. **The session** adds `avail` to `hold`, `op` (a SHIFT sequence awaiting ENTER: `{ k: 'del', end }`, `{ k: 'ins' }`,
   `{ k: 'copyT', a }`, `{ k: 'copyP', bank, grp, key }`, `{ k: 'last' }`), `pg`, `tw` (the closed hat a TAP key wrote, taken back
   by 13 + 14, review #19) and `hits` (the pads sounding); `disp` is `'full'` ("  0") until the next press. A SHIFT + key
   (digit, COPY / INS / DEL) never enters `keys` (it would pair with a later key).
7. **The SHIFT sequences** (TRACK WRITE, stopped; ENTER executes, running cancels): DEL deletes `ptr` … the typed measure (none:
   the pointer's; LAST MEAS: to the end); INS inserts `pend` (a key, its chain whole, two keys a range) at `ptr`; COPY takes
   digits, ENTER, digits (none: one measure), ENTER and inserts that range at `ptr`; each needs the bank's room (else "  0") and
   gives the notice ("Measures 2–3 deleted", "A measure inserted at 3", "Measures 2–4 copied to 7" · tap to undo). SHIFT + COPY in
   stopped PATTERN WRITE: FWD / AVAILABLE MEAS the bank, PATTERN n the group, a key, ENTER — steps, accents, flams, SCALE, LAST
   STEP, SHUFFLE, FLAM onto the edited pattern, its chain flag kept ("Pattern II-2-5 copied to I-1-3").
8. **Writing**: a STEP-write press on a flammed step (not in flam write) plays its accent cycle and drops the flam; flam write on
   a plain step keeps its accent. TAP write writes the state it played (left key per-voice accented, right normal, never a flam)
   into the edited pattern only. REC pads: the hit's velocity names the state (≥ 110 per-voice, ≥ 119 total, 127 both).
9. **ENTER, TRACK WRITE, no key chosen**: the pointer's own pattern rewritten and the pointer advanced (stepping through); at the
   appending position nothing. Overwriting needs no room; only growth counts against the bank's 896.
10. **The display**: pattern modes the tempo; TRACK WRITE the pointer (+1, appending shows the next number); TRACK PLAY the
    measure heard running (through a free pre-roll), else `loc`; an empty TRACK PLAY track "  0". **LEDs beyond §3.6** [C]:
    INSTRUMENT SELECT held lights the voice's key(s) (flam write / the open hat both flashing); stopped PATTERN WRITE shows the
    edited pattern's chain steady; a stopped track mode flashes the measure's key; TEMPO lit in STEP write or held, BACK in TAP
    write, FWD / AVAILABLE MEAS the bank (track modes; AVAILABLE also held), CYCLE the TRACK PLAY CYCLE or the TAP guide, ENTER
    the TOTAL ACCENT row selected (1) or an ENTER awaited (2: an op, digits, TRACK WRITE's key).
11. **`ACC9 { N0 20, L 7, TMAX 27 }` are placeholders** (both at full TOTAL ACCENT = 54, the buffer's clip; the toms' +7.4 dB
    span): V9 fits them (§1.3); the test compares `Dr808.proto.tr909.ACC9` (and a `vTrig9` there, if V9 exports one) with
    drum-core's when present — skipped with a diagnostic on this branch; the lead aligns the copy at the phase-0 merge if V9's
    fit differs. Under P-1 nothing but `vTrig9` (the pads' and tests' code law) reads them.
12. **The 909 record's map** has its own 16 keys (`rd` / `cr` for ids 7 / 8, none of `cb` / `cy`): a reader that forgets the
    model (`primaries(D.map)`) would fill the 808's defaults for `cb` / `cy` — H1 passes the model everywhere (§10's list).

### Lane V9 (voices) — `dr-808.js`, `tests/dr-909.test.mjs`, R9 §16 (2026-10-21, base b8e97ee)

**As built.** `Dr808.create(inst, 'tr909', opt)` → 7a's machine interface (`set`, `setOS`, `hit`, `trig(mask[, acc])`, `render`,
`post`, `live`, `reset`, `mon`, `smp`, `setSalt`) + `_mach`; `MACH.tr909` (28 knobs in §1.1's order, defaults levels 0.7 / VOLUME
0.75 / the rest 0.5; `sids` 0–10; the 808's lanes); `Dr808.mach.tr909` `{ KNOB_IDS, KNOB_DEF, SOUNDS (ids 7 / 8 'rd' / 'cr', 11–15
the 808's keys), sids }`; `Dr808.gain('tr909', d)` = VR28 · vol / 12 k · `OUT_K9` (vol linear; the default 0.75). The third branch
is chosen at `create` (`is8 / is6 / is9`); no 808 / 606 class or loop changed: `golden-drums` 5/5, `golden-606` 11/11, `dr-808`
25/25, `dr-606` 25/25 after every commit. Ten voices: `Bd9`, `Sd9`, `Tom9` × 3, `Rs9`, `Hc9`, `Rom9` × 3 (the hats one voice); the
shared state per machine: the eight accent DACs, the noise stream of the span, the images, the chip swap's three 32 768-word
buffers (allocated at `create`). Values and tags: R9 §16.

**Interfaces (for the lead / S9 / E9 / R9)** — `Dr808.proto.tr909`:
- **`ACC9 { N0: 21, L: 11, TMAX: 22 }`** (S9's placeholder `{ 20, 7, 27 }` in drum-core → these at the phase-0 merge), `CBOTH9`
  54, `PV9` (per-voice accent by sound id: 0–4, 10), **`vTrig9(v127, sound, u)`** → the hit's DAC code (P-1: 100 / 110 / 119 / 127
  = normal / per-voice / total / both; between them interpolated and rounded; ghosts below 100), `codes9(sound, u, out4)`.
  `trig(mask, acc)`: bit 0 of `mask` TOTAL ACCENT (T = round(22 · TOTAL ACCENT)), `acc` the step's per-voice lanes (any bits; only
  BD SD LT MT HT CH act); the latches keep the highest code per sound and each shared DAC the highest of its sounds in the chunk —
  so a guide click's second `trig(0x40, 0)` in the step's chunk is the step with RS added (tested). `trig(mask)` alone = no
  per-voice accents. `hit(sound ≥ 11)` and lanes past 11: nothing.
- **The ROM frame** — exactly the lead's format: the two marker lines, between them (the tool's) 3 comment lines,
  `const ROM909_A = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';`, `const ROM909 = {`, `hh: '…', cr: '…',
  rd: '…',`, `};` — committed with **empty strings** (the frame's placeholder: decodes to mid-scale 32, silence; `rom909.test`'s
  `--check` fails here until the lead's `--write`, §11's known window). **`rom9()`** → the scope's frozen `{ hh, cr, rd }` (three
  `Uint8Array(32768)`, decoded once per scope, shared by every 909); `dec9(s)` → 32 768 codes (a short string padded with 32, a
  foreign character read as 32: a load never throws). **`ENV9.cr` / `.rd`**: the 64 staircase gains e^{−1.905 k / 63} and
  e^{−1.905 · 270 / 470 · k / 63} (−16.6 / −9.5 dB over the image), also `ENV9.KX / WORDS / OPEN / RATE / STEP`. Checked end to end
  with R9's tool at 0e89551 copied in, uncommitted, then removed: it reads the model's staircase ("model's staircase" in its header),
  `--write` then `--check` "current", and all 28 dr-909 tests pass on its images (the decoder equals the tool's codes; each region
  ends at 32). The playback is calibrated on images peak-normalised to ±28 codes (R9's ±27.6).
- **E9**: the one-off costs (node, M4 Max): the first 909 `create` in a scope 1.8 ms (the shaper table and the images' decode;
  `rom9()` alone 0.4 ms), a later one 0.1 ms, `setOS` 0.01 ms — the warm-up's `create` decodes the images. A silent powered machine
  costs 0.0003 (its output stage; d9i proper is the Inst's quiet window). **The chip swap's conversion** (32 768 words, two passes)
  0.5 ms warm, **2.3 ms cold** (the first in a context) at a span's start — over the contract's 0.3 ms estimate; if the iPad shows a
  glitch at a first swap, split the passes over two spans [for the lead].
- Test options: `opt.rom { hh, cr, rd }` (stand-in images), `opt.dacTap` (the ROM voices add their DAC's staircase alone); test
  access `_v`, `_Q` (the DACs, the noise offset), `_nz(n0, n, out)`, `_sw`, `_ost`.

**[C] refinements of §2 (with reasons):**
- *The A pots* (BD TUNE / DECAY, OH DECAY): `tapA9`, 15 % at mid — MW1's BD DECAY times fit it within 15 % at 0 / 5 / 7.5 / 10
  (at 2.5: 110 vs 143 ms); `tapA`'s 9 % misses two points by 18–25 %.
- *The VCOs reset and held while the 2 ms trigger is high* (R9 §1's "resets the VCOs, forces the comparators"; SD: "mutes Q50 for a
  moment"): the BD's and the toms' bodies start at the trigger's end; the click / the crack fill the first 2 ms (the click's peak at
  1.35 ms, MW1 1.5–1.6). Naive triangles at the OS rate (the comparator's corner at its fractional time by the reflection; corners
  only, no steps — 1/n² harmonics, −94 dB at the OS Nyquist at OS 4), no polyBLAMP needed.
- *Accent: one law, per-voice offsets.* Every envelope start is (V_acc − 1.2 + D); D 0 (BD, toms), 3.4 V (SD), 5.6 V (RS), 8 V
  (the clap's bursts) [fit] to MW3's spans — a fixed charge beside the accent's, not a saturation, so RS and the toms stay a level
  (within 2 %, tested) and the BD's clamp / the SD's ENV4 / the clap's tail make the timbre. The 909's accent timbre is subtle: the
  accented hit is no scaled copy (residual after the best gain: BD 2.9 %, SD 2.7 %, HC 22 %) while the spectra correlate ≥ 0.997 —
  §12.1's "correlation < 0.99" reads the 808's / 606's stronger accents; gated as "residual ≥ 1 %" (a level-only voice's < 1e-4).
- *The toms' noise FM* follows ENV3 relative to its own start (the accent a level, R9 §8).
- *The RS's drives*: each resonator through its own resistor (3.3 k; R417 3.3 k late) — the 1 kHz rings strongest (its g the
  largest), the late revision's "stronger 1 kHz"; equal-amplitude rings made the 220 Hz dominate.
- *The noise's salt*: a hashed offset into the period (two salts ≈ 2³⁰ bits apart); the plain XOR of 7a's salt moved it by a few
  bits — the same noise a few µs later.
- *The staircase's droop compensated* after the 2-point polyBLEP: [−1, 14, −1] / 12, unity at DC, exact at rest, one more sample
  late. The BLEP's own error against the exact band-limited staircase is its kernel's in-band sinc² droop (0.3 dB at 20 kHz, linear),
  not aliasing (−65…−77 dB alone): uncompensated it measured −35.0…−49 dB on R9's images (borderline at TUNE 10), compensated
  **−61.0…−74.0 dB** (naive hold −12…−22): §12.1's original −60 dB is met; the gate is held at −50 dB and ≥ 15 dB below the naive
  mutation. A 4-point BLEP is not needed.
- *The samples' LEVEL* (§5): the voice's own pot law (the 909's LEVEL pots are linear B), not an audio taper — a sample follows the
  circuit's level at every knob position (`SMP_LEVEL9` 0.65 = the BD's bus peak at LEVEL 10).
- *Left out pending a re-read* (R9 §15): MW3's ≈ 130 Hz first-order high-pass at the master's input (−8.9 dB at 49.5 Hz: one
  reading, a large claim) and the late ≈ 6.6 kHz master low-pass; a 3 Hz coupling stands for the first. The jack's late 0.01 µ
  behind 1 k (15.9 kHz) is in.

**For the lead's ears — the default panel's balance.** With §2.6's anchor (the BD, unaccented, at the 808's 0.4286 FS) the sources'
levels put the clap (MW3: +9 dB re the BD at LEVEL 5; built +10.5 dB, 2.03 Vp-p = the trimmer's 2 Vp-p), the crash and the ride
(the scope drawings' 2.3 / 2.2 Vp-p, [S-u]) well above it: default-panel peaks (FS, unaccented) BD 0.43, SD 0.60, toms 0.44–0.50,
RS 0.43, **HC 1.14**, OH 0.74, CH 0.61–0.66, **ride 1.29, crash 1.53** (stand-in and R9 images alike); a plain groove (BD, SD + HC on 2
/ 4) peaks at +6 dBFS where the 808's same lanes peak at +1.8 dBFS. The track's limiter catches it; if the family's balance
matters more than the anchor, `OUT_K9` −4 dB (0.19) matches the 808's groove peak, or lower the HC / crash / ride defaults.

**Measured** (48 kHz × 4, node 24, M4 Max; `tests/dr-909.test.mjs`, **28 tests, ≈ 7.5 s**):
- Target (a): every fixed filter and network against its analog prototype within 0.2 dB to 5 kHz (the BD's click Sallen-Key, C2 /
  R_D, the noise band; the SD's 48 Hz, its SK low-pass, 1.52 kHz, its SK high-pass; the toms' band; the three RS resonators —
  `btDesign` against 1 + g s / (s² + 2ps + pg) — and its SK high-pass and LEVEL ∥ 220 p; the clap's band-pass, 181 Hz, 1.94 kHz,
  440 Hz; the hats' C134; the output's DC coupling and the jack's pole at the base rate), the reconstruction Sallen-Keys within
  0.5 dB to 12 kHz, the resonant centres within 1 %; every envelope's τ within 2 % of its RC (BD C9 at TUNE 0 / 5 / 10, C8 at DECAY
  0 / 5 / 10; SD ENV2, ENV3, the bend, ENV4 at TONE 0 / 10 and its V_end; each tom's ENV1, ENV3, the 22 / 220 ms supply, ENV2 at
  DECAY 0 / 10; RS Q65; the clap's swell peak 27.9 ms and fall; the hats' C135 OH / CH at 0 / 5 / 10).
- Target (b): BD 49.5 Hz at TUNE 0 / 5 / 10, Δf 217 / 229 Hz at the trigger's end, τ 7.5 / 29.5 ms at TUNE 0 / 10, H2 / H3 / H5
  −27.8 / −24.7 / −43.7 dB, −20 dB 89 / 159 / 281 ms, the click 1.35 ms at −7.1 dB, 0.606 Vp-p, accent +6.35 dB; SD 117.4 / 145.7 /
  174.1 / 202.4 / 230.7 Hz (VCO-2 × 1.500), the bend +216 Hz, TONE's −40 dB 94 / 262 ms (accented longer), SNAPPY linear, accent
  +4.79 dB, +3.76 dB re BD; toms within 1 % of MW1's TUNE points, +31 % sharp, −20 dB LT 167 / 202, MT 111 / 134, HT 113 / 160 ms,
  accent +7.46 dB, −0.54 / +0.36 / +0.48 dB re BD; RS peaks 219 / 484 / 1039 Hz, clip ± 0.61 V, accent +3.91 dB, +0.36 dB re BD; HC
  bursts at 0 / 10 / 21.5 / 31.5 ms, the tail at 60–90 ms −20.6 dB, accent +3.31 dB, 2.03 Vp-p.
- The noise: a literal 31-stage register's bits = the model's for 400 000 bits; the jump = stepping at 40 random positions;
  x^(2³¹ − 1) = 1 (period); the stream at OS 4 / 2 / 1 = the exact box integral of the bits at an hour's position; pieces = one
  call = a fresh jump; the variance 56.25 (1 / T − 1 / 3T²); SD × HC correlated (0.40) on one salt, not on two (0.09).
- The ROM path: the hats 29.997 kHz (± 0.1 %), crash / ride 21.86 / 31.09 / 53.78 kHz (the formula within 0.1 %, × 2.46); the
  staircase bit-for-bit (1e-6 V) an independent BLEP with each step at its fractional time; the DAC's levels exact; the end held,
  blocked by the couplings; the alias gate above; the staircase's gain the step of the word on the latch; accent e^{KX ΔV} within
  0.5 % on OH / CH / crash / ride, the CH's per-voice +4.40 dB; **a CH 100 ms into an OH (DECAY 10): −18.8 dB re the free OH at
  100–200 ms after it, = a lone CH (0.00 dB)**; OH + CH in one chunk = CH byte for byte; a ride hit lifts a ringing crash × 1.66,
  an RS hit the clap's later bursts.
- Contracts: retrigger ≠ fresh ≠ reset-then-hit (the analog voices; a clap retriggered while its tail rings restarts its burst
  timer; a ROM slot given another id plays the built-in image until the new one is converted); 44.1 × 2 vs 48 × 4 within 0.5 %; an OS change mid-sound
  keeps the counters' words; no NaN / Inf / subnormal (every knob 0 and 10, OS 4 and 1; everything asleep at the end);
  determinism, span invariance (4 / 128 / random, OS 1 at 44.1); order-free latching; no allocation over 200 spans (a pending
  chip swap found and converted inside); time to sleep (ms, normal / both): BD 280 / 315, SD 272 / 288, LT 1107 / 1219, MT 765 /
  843, HT 768 / 845, RS 69 / 72, HC 797, ride 1432 / 1533, crash 1571 / 1672, OH 819, CH 272; the samples (§5) and the chip swap
  (pending, ±28 codes, mid-scale end, the hats' other region built-in, off → built-in); §2.6 the BD 0.4286 FS (= the 808's).
- **CPU** (the machine alone, node, OS 4, best of 3; circuits retriggered every 100 ms at v 127): BD 0.0016, SD 0.0024, LT /
  MT / HT 0.0027–0.0028, RS 0.0014, HC 0.0013, ride / crash / OH / CH 0.0015 (each analog ≤ 0.004, each ROM ≤ 0.003), the noise
  0.0004 (≤ 0.001); **d9p 0.0099, d9x 0.0143, d9m 0.0039**, idle 0.0003 — the bench rows add the decimators and the Track (E9's).
- **808 / 606 A/B** (base b8e97ee vs this, and this after a 909 has run in the scope; medians of 7, interleaved, two runs): d8p
  −1.1 / −0.4 %, d8x +1.4 / +0.1 %, d6p +2.5 / +0.3 %, d6x −0.6 / −2.8 % — within the run-to-run noise.
- **Listening renders** (for the lead): `scratchpad/7c/v9/wavs/` of the session scratchpad
  (`/private/tmp/claude-501/-Users-dom-Documents-Claude---Synth-Synth/1970ec50-fa17-41f8-a8ba-68d2b52fc7be/scratchpad/7c/v9/wavs/`):
  each analog voice normal and both (TOTAL ACCENT 10), BD TUNE / DECAY / ATTACK at their ends, SD TONE / SNAPPY, the toms' DECAY,
  a 2-bar analog groove at TOTAL ACCENT 5 and 10 (`LIST.txt`); and, with R9's placeholder images (0e89551) for the lead only, the
  hats (choke), the crash at TUNE 0 / 5 / 10, the ride and a full-kit groove (`LIST-rom.txt`). 48 kHz 16-bit, the bus decimated by a
  windowed sinc then `post()`, normalised only where a file would clip (said in the lists).

**Not re-read**: the component values are R9's reading (§16.0). **For the lead**: one pass over SN9's schematic with R9 §16 beside
it — first the master section (the 130 Hz coupling, the 6.6 kHz low-pass) and RA13's map.

### Lane E9 (engine + data; phase 1, base e22426b)

**Commits**: E9a da63a7b (`models.js` `tr909`, `FIELD_CLASS` / `CLASS_TABLE`, `DrumP`'s seven new fields pulled forward, a
provisional cost, the d9 targets, engine-track :1163 → `'tr999'`); E9b-1 39c8697 (the warm-up's 909 round, `drumTrack`
three-way + d9p / d9x / d9m + c9, cv-cost from the measured d9p, nine engine-track tests); E9b-2 405414e (`golden-909`);
E9b-3 these notes.

**As built** [C]:
- *models.js*: ten sections — Total Accent · Bass Drum · Snare Drum · Low / Mid / Hi Tom · Rim Shot · Hand Clap · Hi Hat ·
  Cymbal · Volume —, the 28 knobs in `Dr808.mach.tr909.KNOB_IDS`' order and defaults; labels as the face prints them inside
  their block ("Tune", "Level", "Attack", "Decay", "Tone", "Snappy"; "Rim Shot Level", "Hand Clap Level"; "CH Decay", "OH
  Decay"; "Crash Level" … "Ride Tune"; "Volume"); `theme` `{ knob: 'tr9', panel '#e8e8e2', face '#f0efe9', ink '#2c3550', label
  '#5b6580', accent '#f28c28' }` (`knob-tr9` is a class with no CSS rule, as the 808's `tr`); presets §2.6's. `CLASS_TABLE`
  499 controls (proc 106, struct 12); `FIELD_CLASS` the seven new `drum.<id>` proc.
- *engine.js*: `DrumP` + `bda mtu mtd` (0.5), `crl rdl` (0.7), `cru rdu` (0.5) — E9a, so a 909 patch is one fixed shape from
  the model's first commit (no "unknown patch key"). No branch: `drOn` / `drGain` / `drSeqMsg` / `drPend` / `drPost` /
  `drClock` / `seqEvents` take the 909 by its string (the tests below prove each); the comments name any machine switch.
- *the warm-up* (`warmDrums9`, after the 606's round, inside `warmDrums`' try): twice — its first `create` decodes the ROM
  images (once per scope, every later 909 shares them); every sound at v 100 / 110 / 119 / 127 (retriggers) and a ghost
  (61) through DEF_MAP (ids 7 / 8 the ride / crash); OH + CH in one chunk and a CH into a ringing OH; the crash and the ride
  at opposite TUNE ends (0.03 / 0.97), then the same panel with the two swapped (their clocks glide); round 0 a **chip swap**
  — a one-level stand-in entry (`smp:~warm909`, 0.25 s of LCG noise) stored, put in the kick's, ride's, crash's and both
  hats' slots, one span (the conversion of four images: 2.3 ms cold paid here), played, `smp(null)` (the built-in images
  again), dropped from the store; a free plan through `DrSeq.simplePlan(WMASK, 3 | 4, x)` — per-voice accents on two steps in
  three, flams on BD / SD (round 1: MT / HT), SHUFFLE 40 / 20 ticks, FLAM 37 / 53 ticks, round 1 the guide click — then synced
  on a stand-in clock (32 quanta at 2.03 frames a tick); an OS change **in each round, there and back**: the 808's round
  leaves OS 2, the 606's 4; a third single flip left Serum's and the graph's warm-up at OS 2 and cost them ≈ 40 ms (node: the
  graph's 219 → 268 ms) — measured, then fixed. `restore()` leaves the machine fresh (`reset`, `smp(null)`: no slot, no
  pending swap; the store empty — tested).
- *bench*: `drumTrack(rows, vals, samples, 'tr909')` — pattern I-1-1 in PATTERN PLAY (16 steps, SHUFFLE 3, FLAM 11 = 18 ms →
  35 ticks at 120 BPM) from rows by the 909's codes (`drumSteps9`, exported: 'X' a per-voice accent, 'f' a flam, 'F' both);
  `'demo'` its DEMO; the slots by `PERS[model]` (the 808's / 606's names unchanged); graph key `d9`. d9p as §2.7 (the crash on
  step 1, the toms once a half each, the SD's flams on 2 / 4, the second with its accent); d9x every lane every 250 ms
  accented (`X`; `F` on the five flam lanes), every DECAY / TONE at 10, the cymbals' TUNE at 0; d9m crash + ride + OH every
  500 ms. `bench.html` c9 (the DEMO synced) and its note.
- *cv-cost*: `tr909: C('d9p', 'drums', 1, 0.0142, 0.0030)` = 0.0172 (the gate's d9p).

**Measured** (node 24, M4 Max, one file at a time):
- Bench rows (cpu-gate, calibrated; engine-track's gate, two runs): **d9p 0.0173 / 0.0171** (0.035), **d9x 0.0209 / 0.021**
  (0.08), **d9m 0.0096 / 0.0092** (0.025), **d9i 0.00018 / 0.00016** (0.0005); in the same runs d8p 0.0199, d8x 0.0367, d8m
  0.0165, d8s 0.0064, d8i 0.00019, d6p 0.0173, d6x 0.0185, d6m 0.0135, d6i 0.00018. The 909's d9p (ten voices, nearly all
  awake) costs what the 606's d6p does: V9's voices are lean (machine 0.0099 + the Track ≈ 0.007).
- V8 A/B (e22426b's engine.js vs this, each in its own fast vm context, `measure()` alternating, 3 × median of 5 × 1 s): c1
  ×1.008, d ×0.968, e ×1.001, r ×0.996, d8p ×1.002, d8x ×1.015, d8m ×0.954, d6p ×0.998, d6x ×0.996 (mc0 / mt: minus-base rows,
  noise) — none slower by 2 %.
- JSC (the macOS jsc shell; 7b's driver `jsc-drums.js`: the rows' messages built in node, the scope's warm-up, 3 s lead-in,
  the median of 5 × 1 s, each row its own process, two runs): **d9p 0.0116, d9x 0.0146, d9m 0.0051** steady, their first
  second 0.0135 / 0.0206 / 0.0065 (the warm-up's round: d6p's first second reads 0.039 beside its 0.014); d8p 0.029 / d6p 0.014
  in the same driver (it reads d8p high, 7b §14 lane E6).
- **The warm-up's cost**: node, the scope's whole warm-up 586 → 625 ms (the 909 round 36 ms; three runs each); JSC 814 → 830
  ms. What it buys (a later Track's first 909, base e22426b vs this): its `create` node 3.2 → 0.45 ms, JSC 2.26 → 0.31 ms; its
  first chip swap (the span with the crash's conversion) node 1.84 → 1.1 ms, JSC 2.43 → 0.75 ms. The iPad's first-context
  ready time: the lead's session.
- engine-track 66/66 (+9: the 909 from `{t: patch}` / processorOptions on the warmed first Track = a later one = offline,
  bit for bit, the machines `tr808, tr606, tr909` kept on Inst 0, the stand-in gone, one decode shared by three machines;
  **808 → 606 → 909 → 808** with the 909's payload waiting in `drPend` while the 606 plays on; the de-click tail across 808 →
  909, 909 → 606, 606 → 909, 909 → 808 — level kept (×0.84–0.97 at sample 8), second difference −80 … −101 dB past the post's
  first 8 samples (−35 … −56 dB inside them: 7b's known dip), drained; a graph node — #34's v the highest state (BD both 127
  over CH total 119 → 1), the flam's own hook 1825 frames (73 ticks) after its step, no post; the OS fade — a tom −76 dB
  over the change, an open hat no step beyond its own content (−14.4 vs −13.1 dB); a `drum.cru` row through the real moRec
  — the crash's word clock 0.5 → 0.9 runs ×1.2 or more faster, 0.1 slower, its counter ahead / behind; panic with the crash
  and a tom ringing; no allocation over 400 quanta with a chip swap converted inside; the d9 gate). cv-mods 16/16,
  classic-mod 17/17, cv-cost 14/14, bench 6/6, bench-page 2/2, lint 141/141.
- **golden-909** 9/9 (not frozen: determinism, said in its header and a diagnostic): D2's 18 cases (≈ 100 s of audio a side);
  the "differ" checks — step 2's tick per measure 240, 260 … 360 (SHUFFLE 1 … 7) and 180 (32nds at 7), 26 flam hits off the
  step frames (kick, snare, toms only), the four states four different hits, a ride lifting a ringing crash (its own LEVEL
  at 0) ×1.3+, the slots; **D5 bit-identical**: the DEMO at SHUFFLE 1 / 3 / 7 with the SYNC-off payload (211 notes: v 100 ×
  124, 110 × 22, 119 × 25, 127 × 40; its snare flam), **the 10-measure track** (every SHUFFLE, 32nds at 7 with its clamped
  flam, 8T, 16T, flams at 10 … 38 ms and one across a measure: 394 notes, 26 flammed steps), the DEMO without a payload
  (the ride muted: below); 97 BPM: 99 hits, all on the same frame. Its freeze mode exercised once (refs written at 39c8697,
  9/9 against them; a flam one tick late caught by four cases, `OUT_K9` × (1 + 1.6e-6) by every case, golden-606 untouched),
  then the refs deleted — the lead freezes.
- D1: golden-drums 5/5 (ref-7a), golden-606 11/11 (ref-7b), golden-classic 8/8, -fx 3/3, -presets 8/8, -random 1/1, -graph
  6/6, canonical-stream 1/1 — bit-identical after E9a and after E9b.

**[C] readings and seen, not fixed** (for the lead):
1. *D5 "without a payload" on a 909*: before a payload the Inst uses `DrSeq.DEF_MAP` (the 808's, §1.4 [C]) — the ride's 51
   plays nothing there, so the DEMO's notes without a payload drop the ride. golden-909's case mutes the ride lane on both
   paths (said in its title); the app never meets it (→ Piano roll always leaves the SYNC-off payload, H1).
2. *The four states at TOTAL ACCENT 5* are three codes: `T(u) = round(22 · 0.5) = 11 = L`, so per-voice and total accent
   sound alike there (P-1's fixed velocities name them apart; the machine cannot) — golden-909's "differ" check uses 10.
3. *Review #1 (H1's half)*: nothing in the engine reads the project tempo for flams — the plan carries whole ticks; golden-909's
   97 BPM case builds its payload with `bpm: 97` in the session and the notes with `rollPlan(D, 97)`: one spacing on both
   paths. A bounce at a project tempo ≠ 120 matches the live render only if the offline session gets `bpm: project.bpm`
   (§10's line): canvas-7c-sim's case.
4. *A 909 asset id*: the warm-up's stand-in is `smp:~warm909` (never a content hash: no project asset can share it) and is
   stored only when that id is free.

### Lane P1 (panel code: `cv-panel.js`, `cv-drum.js`, `tools/panel-check.mjs`, `tests/cv-drum.test.mjs`, `tests/cv-panel.test.mjs`, `tests/classic-panel.test.mjs`)

**P1a (the validator, the geometry, panel-check; lane X's base)**, on E9a da63a7b. Readings where §7 left a detail open [C]:
- `TOKENS.tr909`: §7.2's table — face `dr:start` `dr:stop` buttons, `dr:disp` **display**, `dr:tempo` knob, `dr:trk` (n 1–4)
  `dr:pat` (n 1–3) `dr:tkey` `dr:back` `dr:fwd` `dr:avail` `dr:cyc` `dr:enter` `dr:last` `dr:scale` `dr:shuf` `dr:clear` `dr:isel`
  `dr:shift` `dr:step` (n 1–16) buttons, `dr:scl` (n 1–4) LEDs; extras `dr:grid dr:pads dr:sync dr:toRoll dr:rec dr:map dr:sounds
  dr:demo` (no SWING, no knobs: every models.js knob on the face). `multi` / `idx` / `full` on all four repeated tokens; **an
  LED token's index is validated too** (the display branch returned before the index check: the scale LEDs could repeat or go
  missing unseen). The 808's / 606's tokens are not the 909's and back (`dr:tap`, `dr:fn`, `dr:mode`, `dr:swing`, `dr:link` … on
  a 909; `dr:isel`, `dr:stop`, `dr:enter`, `dr:disp` … on an 808 / 606). `RENDERED_TOKENS` has them from P1a on.
- **New table fields** (generic, per model): `led` — keys that show their LED (`led` never `'none'`; absent = the cap's):
  TRACK, PATTERN, the TEMPO key, BACK, FWD, AVAILABLE MEAS, CYCLE/GUIDE, ENTER (the step keys keep 7a's own rule; the left
  cluster and START / STOP have none on the hardware); `digits` — a display token's characters: its box ≥ `dspMin(n)` =
  n × 0.62 em × 20 px / 2 + 2 mm wide, 20 / 2 + 2 mm tall (`DSP_FONT`: style.css's `.hw-dsp` 700 20 px mono) — the display's 3
  need **≥ 20.6 × 12 mm** (the hardware's window 39.1 × 18.9); `caption` — the model's own extras caption, `XCAPTION_DRUMS` + " ·
  Hi-hats and cymbals: our own sounds through the 909’s chip circuit" (D4): the layout **omits** `extras.caption` (the geometry
  supplies it) or carries it exactly, another is a problem. `cells` `dr:pads` 232 × 184 (`DR9_PADS`; the grid the 808's
  `DR_GRID`), `xbreak` `['dr:pads']`. `XCAPTION` / `XCAPTION_DRUMS` moved above `TOKENS` (the caption reads them).
- **Geometry**: 486 mm → **992** px (`ceil32(972)`, offX 10); with the face 300 mm deep the module is **992 × 1024** (600 + the
  strip 16 + 272 + 64 + 8 = 360 + the bar → 1000 → 1024; `TARGET.tr909`). A face ≥ 284 mm keeps 992 × 992 (within the test's
  dot); **268.5 mm would give 992 × 960, two dots off** — X keeps the area 300 deep (R9 §13's 486 × 300; the photo's 268.5 is
  its perspective). The strip: the grid (8, 616) 640 × 272 and the pads (648, 616) 232 × 184, then SYNC 96 · → PIANO ROLL 128 ·
  REC 72 · MAP… 88 · SOUNDS… 104 · DEMO 72 at y 888 (560 px).
- `panel-check`: the display's box against `dspMin`, the LED keys with their LED, whether the layout carries the caption.
- **For lane X — the hit rule vs the hardware** (the fixture `TR9_FX` in tests/cv-drum.test.mjs validates with every other
  R9 §13 position as measured): the fourteen small middle-band keys (≈ 11.9 mm pitch inside a group) on a **14 mm pitch from
  x 186.6** (… 368.6; none more than 6.2 mm from the hardware's, §7.1), each `hit: [14, 15]` (the default 15 would overlap at
  14 mm); the left cluster's 14.9 mm column pitch with the default 15 mm hit boxes overlaps by 0.1 mm — `hit: [14, 15]` on the
  six; the step keys (23 mm), START / STOP (24.6), ENTER, TEMPO, VOLUME and the knobs (20.9 / 19.6) need nothing.
- Tests: `cv-drum.test` 37 → **41** (7c tokens, one mutation per rule — each new rule's mutation caught: the LED index check,
  the display's characters, the LED keys, the caption —, the geometry, the art); `cv-panel.test` (`HW_IDS` + `tr909`,
  `EXTRAS.tr909`, `TARGET.tr909` 992 × 1024, `NOKEYS` + `tr909`): **84 / 85 — the `HW_IDS` pin is the known window** until X
  lists `tr909` in `panels/index.js` (with the fixture as a scratch `panels/tr909.js` listed there: **89 / 89**, the four
  per-model tests pass; `classic-panel` 13 / 13 with it and without; `panel-check tr909` valid, 992 × 1024, smallest hit box
  28 × 30 px, no overlaps). `lint` 141 / 141, `classic-panel` 13 / 13. `classic-panel.test` needs no 909 row: the 909 binds no
  switch.

### Lane X (satellites: `panels/tr909.js`, `panels/index.js`, `cv-art.js`, `cv-tray.js`, `cv-migrate.js`, `song.js` (a comment), their tests; 2026-10-21, base 6ee6395 = P1a)

Two commits: **X1** the panel (`1030ac8`), **X2** the data rows (`9182840`).

**The panel** (`panels/tr909.js`, listed last in `panels/index.js`): one area `main` `src [0, 0, 486, 300]` → **992 × 1024** (`panel-check tr909`: valid, no
overlaps, smallest hit box 28 × 30 px (the small keys), the 28 knobs + 20 face tokens + 8 extras all placed, live 66 · displays 5 · inert 23 (the ten MULTI OUT
'later' + ten dimmed rear sockets + EXT INST + TAPE SYNC + the cartridge slot) · decor 241). Everything as P1a's hand-off said; readings where it left a detail open [C]:
- **Nudges** (recorded in the file's `notes`): the fourteen small keys on x = 186.6 + 14 i (hardware 192.8 … 362.6: −6.2 −4.1 −2.0 +0.3 −4.4 −2.3 −0.3 +2.7 −1.2 0 +1.9
  +4.2 +4.2 +6.0, the largest 6.2 = the contract's minimax), y 169, `hit [14, 15]` on the twelve live ones, their orange shift legends and brackets moving with them
  (TRACK WRITE over 1–4, PATTERN WRITE over 1–3, EXT INST, STEP / TAP under PATTERN WRITE MODE, I / II under BANK, LAST MEAS, TEMPO MODE); the left cluster's six keys
  `hit [14, 15]` at the measured x 44.5 / 59.4. Nothing else moved.
- **Legends are decor, not `onCap`**: START, STOP/CONT, ENTER (and every knob, key and cluster name) print from `decor` with `lab: 'none'` — the live button's `.hw-cap`
  is a fixed 9 px font that cannot hold "STOP/CONT" on a 19 mm (38 px) cap. The 28 knobs carry `scale { n: 11 }` (a 6.75 mm tick ring: the top row's legends at
  y − 9.35 clear the header bars by ≥ 3 mm, the second row's clear the first row's lowest ticks by 1.6 mm).
- **The face**: nine slate header bars (x 36.4 / 70.6, then 116.3 + 46.2 j, 45 wide), orange rule under the title, TR-909 · Rhythm Composer in plain type in the wordmark
  zone (the maker-mark and product-line zones empty), a dark bezel round the live display, the four scale rows as paths (our beamed notes: 16ths four to a beat, 32nds eight,
  8th triplets three and 16th triplets six over 12 steps, the tuplet numerals as small text; the LEDs `dr:scl` n 1–4 at x 71, y 194.0 + 7.2 (n − 1), d 3 = the scale index
  `scl[sc − 1]`), the step strip, the shift-legend strip (peach on slate), the instrument boxes (CLOSED · OPEN · CLOSED under 13–14), a front fascia from y 270 (the face is
  300 deep: P1's 992 × 1024). Knob skin: P1's fixture colours (skirt / cap `#2c3550`, pointer `#f28c28`) plus `ptrStyle: 'line'`, `knurl`, `capR 0.74`.
- **The rear strip** (y 0–36, ▲ legends, group brackets; the maker-mark zone stays empty): the ten MULTI OUT jacks (BD SD LT MT HT RS HC HH CRASH RIDE, labels "BD OUT" …) at
  x 126.5 + 13.5 i as `inert: 'later'`; the other sockets (MASTER OUT L / R-MONO, SYNC IN, START/STOP pedal, TRIG OUT, TAPE SAVE / LOAD, MIDI IN / OUT / THRU) as **dimmed
  inert jacks** (so their tap says "not emulated") — their order and spacing are estimates (R9 §13 lists the sockets, not their places) — and the cartridge slot. The extras caption is the
  geometry's (the layout carries none).
- Preview (the session scratchpad, `7c/x/`): `tr909-preview.png` (decor + each control as a rough shape + the extras cells), the checker SVG `tr909.svg`.

**The data rows** (§12.7's X row):
- `cv-art`: `SIL.tr909 = { body: 'box', steps: 16 }`, `DRAW.tr909` (light case, nine blocks of 27 dark knobs under slate bars, two cream keys, a red display, TEMPO and VOLUME, the
  small-key row, the left cluster, four scale rows, sixteen cream step keys `#f3ebcf` over a darker strip with a red LED each — every fourth lit —, the legend strip, the dark
  instrument boxes; no text; the chip keeps the step strip). Test: counts of knobs (27), bars, keys, LEDs, cream caps, the digits, chip < tile, no maker word.
- `cv-tray`: the Drums note → "More machines later: the Simmons SDS-V with the pad controller."; the tile tip `DR_TIP.tr909` ("our model of its analog circuits; its hi-hats
  and cymbals are our own sounds through its playback circuit, not recordings"; the 808's and 606's keep "our model of its circuits, not recordings"); meta "1983 · drum machine"
  and no SIMPLE badge by `DRUMS` (no code change); the list `['tr808', 'tr606', 'tr909']` follows MODELS.
- `cv-migrate`: `SCHEMA = 10`, `STEPS[9]` additive (a one-line step, the header comment). Test pins moved (none weakened): :27 (10, the message), the 7a test's `[10, 10]`, its
  `up.p.schema` 10 and the read-only row `{8, 9, 10, 11}` → `[false, false, false, true]`, the 7b test's `[10, 10]`, `up.p.schema` 10, `{9, 10, 11}` and its seed — the schema-9 project
  is now `STEPS[8](p8)` itself (the old seed was `up.p`, which is a 10 now) —; four new 7c tests: schema 10 (a 9 opens as before, a 10 read-only in a gate-9 store, an 11 in this
  one), `song.normDev` (the 909 record: 96 patterns, 12-bit masks, accents & 0x83E & the step, flams & 0x03E, whole-BPM tempo, hostile input, the other two machines' records
  untouched, a record under another model re-normalised, the round trip), MIDI (a 909 exports on channel 10; a channel-10 import is still an 808), the lost-line ("TR-909 track(s) …",
  the order of first appearance), the mirror and `splitTracks`.
- `song.js`: only its comment (7c, schema 10: `isDrum` reads `PERS.tr909`; `normDev` passes the model; the channel-10 export is `isDrum`'s). `roll.js`: no edit (`drumRowsOf` passes
  the model): two new tests pin the 909's eleven rows (Kick 36 … **Ride 51 on id 7, Crash 49 on id 8**, Open hat 46, Closed hat 42), a remap, an 808 map on a 909, the gutter,
  `_row` / `_lab` (the 808's cowbell key 56 and the aliases 57 / 59 sit in "Other"), a vertical nudge (ride up = crash, clamped at the kick).
- `canvas-7a-sim:68` and `canvas-7b-sim:77` list the three machines; `:487` pins the saved schema to `CM.SCHEMA` (and its title no longer says "schema 9").
- **Gates** (one file at a time, `--max-old-space-size=2048`): `panel-check tr909` valid, 992 × 1024, no overlaps · `cv-panel` 89 / 89 (the `HW_IDS` window closed) · `cv-drum` 41 / 41 ·
  `classic-panel` 13 / 13 · `cv-art` 4 / 4 · `cv-tray` 31 / 31 · `cv-migrate` 56 / 56 · `roll` 52 / 52 · `canvas-7a-sim` 23 / 23 · `canvas-7b-sim` 14 / 14 · `lint` 143 / 143 ·
  `cv-face` 26 / 26 · `canvas-1i-sim` 20 / 20 · `cv-fixes-sim` 5 / 5 · `main` 42 / 42 · `golden-drums` 5 / 5 and `golden-606` 11 / 11 (unchanged). **Known window**: `pwa.test`'s
  precache check until the lead's `node tools/precache.mjs --write` (the new `panels/tr909.js`; no `sw.js` in these commits).

**P1 phase 2 (the 909's widgets, `cv-drum.js`; on P1a)** — commits 536dfac, 13ac0dc and these notes. Every 808 / 606 widget,
text and behaviour unchanged (their cv-drum tests and classic-panel's as they were; the shared grid / pads / menus read the
machine's tables, the 808's and the 606's term for term). Readings [C]:
- **Three-way**: `machOf` (a model id or a record; `'tr606'` / `'tr909'` the exact strings), the host's `sessOf` (a 909 session
  names itself, `S.m`), the panel's tables by `M` — every `six` site of §0 (the grid's view / hit-test / dimming / corner / key,
  the pads' size, codes, names, title and monitor, MAP… / SOUNDS…, the SYNC / REC / DEMO texts, the loop hint, the demo's
  confirm) answers the 909 its own; the sounds' keys / names by `PERS[machine]` (`SND` / `NAMES`: the 808's and the 606's are
  `DC.SOUNDS` / `SOUND_NAMES`, the same objects), so a 909 pad, slot or monitor bit 7 / 8 is its ride / crash.
- **`UI.tr909`**: the grid's twelve rows `CODES909` on `LANES909` (the 808's `GRID` geometry; `gridAt909` → `{ lane, row, s }`), the
  4 × 3 pads `PAD9` CR RD OH CH / LT MT HT AC / BD SD RS HC (`PADS9` 52 px pads, 8 px gaps, 8 px top = cv-panel `DR9_PADS`; the HC
  pad's code "HC"), no dials.
- **The face**: the held keys (SHIFT, INSTRUMENT SELECT, CLEAR, LAST STEP, SHUFFLE/FLAM, the TEMPO key, AVAILABLE MEAS) send `{ k:
  'hold', b, down }` with pointer capture, Enter / Space held, music zones, `aria-pressed` from `S.hold`; the step keys `{ k: 'key',
  n, down, shift, ts }` at the press and the release (two keys held: drum-core's pair / block / chain; Shift-click the mouse's;
  **Alt + a key = SHIFT held while Alt is**, up at Alt's keyup or a key's release without Alt — the 606's FUNCTION rule; SHIFT
  held and Alt together are one SHIFT); the taps (START, STOP/CONT, SCALE, TRACK n, PATTERN n, BACK, FWD, CYCLE/GUIDE, ENTER) on
  `A.tap`, no music zone — a pinch starting there presses nothing (7b review 2); TEMPO continuous on `tempo909` / `tempo909Pos`
  (37–290, synced the project's in one gesture). One cancel rule (`cancel9`, the 606's): a pointercancel, a lost capture, a
  blurred keyboard hold, the host's release-all or destroy lets go of every hold with one `{ k: 'release' }`. Labels name each
  key's voice ("Step 1 · Kick, accent") and shift legend ("Track 2 · Shift: track write").
- **LEDs and the display**, painted together ≤ 1 a frame: `LIT` code 5 `'dim'` (a normal step; cv-drum's own rule at 55 % of
  the LED with a faint glow — style.css's generic dim read as off on the 909's caps in Chrome), the LED keys (`dr-lk`: TRACK,
  PATTERN, the TEMPO key, BACK, FWD, AVAILABLE MEAS, CYCLE, ENTER; flashing by a CSS animation, steady with reduced motion), the
  four scale LEDs (`led.scl`), the display (`led.disp`, `.hw-dsp` with its three characters filling the window: 30 px in the
  hardware's 39.1 × 18.9 mm; `role="status"`, "Display: 120").
- **The grid**: a cell's marks — normal a small one (20 × 8), accented (or a voice without its own accent) a full one (28 ×
  12), a flam two side by side (full or small height); a tap cycles as the step key (drum-core's `grid`); the flam (`flam:
  true`, BD … HT) by a touch long press (≥ 500 ms, the header's solo time), Alt-click, a right click or F on the focused cell;
  its aria label names the state (off / normal / accented / on / flam / accented flam).
- **The host**: a 909 key down in TAP write gets `f` (the fraction of the heard step at its `ts`, the posts heard by then
  delivered first — the 808's TAP); `{ c: 'hit', sound, v }` plays the sound's primary note through `noteOn` (v / 127, the
  `sel()` gate, no REC write), kept in `e.kh` for the `{ c: 'hit', off }` of its key's up; a note the session no longer sounds
  (a release, a panic, a fresh session, `forget`) gets its off (`khSync`). **Review #1**: `bpm(v)` presses `{ k: 'bpm', v }` for a
  909 entry, and a synced 909's own TEMPO (its `{ c: 'bpm' }` command) runs the same press **before** `setBpm` — the panel's
  `exec` used to write `S.bpm` itself, so main's echo (`setProjectBpm` → `DRUM.bpm`) found the tempo already set and never
  sent the flams' new ticks.
- **SOUNDS…**: "Kick · circuit (ours)" for the seven analog voices, "Ride · our sound (ours)" for the ride, crash and hats, a
  loaded one "… your sound: name (through the 909’s chip)"; the submenu "Our sound" | "Your sound (through the 909’s chip)".
- **The extras caption** (13ac0dc): with "Dimmed controls are not emulated" the 909's caption is 168 characters — 1047 px at
  9 px in Chrome, cut at the strip's 976. cv-panel `xcapFit(text, room)` estimates the width from the characters (above
  Chrome's measure, never measured) and steps the type to 8 px (887 px in Chrome), else 7, the tracking 0.04 em; `render()`
  applies it to a model with its own caption only (`TOKENS.<model>.caption`), so every other strip is byte-identical. **For
  the lead (not changed, not mine)**: the plain caption "EXTRAS · not on the original · Dimmed controls are not emulated"
  measures 395 px in Chrome — past the Solina's 382 px `extras.at` strip (by ≈ 21 px) and the Prophet-5's and OB-Xa's 400 (≈ 3
  px).
- **DOM**: the live layer is **352** elements (the fixture face's SVG 65 more: 417); **X's face SVG must stay ≤ ≈ 640
  elements** for §7.4's 1000.
- **Headless Chrome** (`--headless=new --use-angle=metal`, dpr 2; the real ClassicPanel → cv-panel → cv-drum over the real
  drumHost with stub deps — a 909 record, a fake transport, an audio clock heard 200 ms after it renders, a fake sequencer
  posting the plan's steps when rendered, the monitor on every step; the fixture face as a scratch `panels/tr909.js` in a copy
  of the tree; `scratchpad/7c/p1/`): 1440 × 900, 1366 × 1024, 1024 × 1366 looked at (screenshots: the face, the display "120",
  the scale LED, PATTERN 1 lit, the 4 × 3 pads, the 12-row grid, the caption in one line); the DEMO synced — every chase LED
  painted **−0.7 … +17.5 ms** of its heard frame (within one frame), 8 paints in 60 frames, and at 38.7 posts a second 78
  paints in 120 frames; STEP write running: BD's steps `on off off off head-off off off off dim … dim` (1 accented, 5 under
  the playhead, 9 and 13 normal); **two fingers on keys 1 + 4 in TAP write → notes 36 @ 110 and 38 @ 100, offs at the lifts,
  written BD 2 accented and SD 2; 13 + 14 → the open hat (46 @ 100), the closed hat taken back off its step**; a touchCancel on a
  held key → its note off; a 700 ms touch on the grid's SD step 11 → its flam; LAST STEP + key 12 by two fingers → 12; STOP/CONT
  touched then cancelled → still running, tapped → stopped; **no console error, exception or CDP log error** (the harness's
  favicon 404 aside).
- Tests: `cv-drum.test` 41 → **50** (the host three ways, review #1's sends, TAP-write hits and their offs; the render with
  `api.drum`; SHIFT / INSTRUMENT SELECT orders, STEP write's cycle, LAST STEP, SCALE, SHUFFLE/FLAM, blocks, Shift / Alt, the
  keyboard, TEMPO; TAP write by two pointers, 13 + 14, the cancels, the taps' pinch, destroy; the grid at 3 zooms with its marks
  and flams; the pads; the LEDs and the display at the heard time ≤ 1 paint a frame; no host; the popovers; xcapFit). Gates
  (node 24, one file at a time): cv-drum 50 / 50, cv-panel 84 / 85 (the `HW_IDS` window), classic-panel 13 / 13, lint 141 / 141,
  main 42 / 42, drum-core 130 / 130, cv-face 26 / 26; canvas-7a-sim / canvas-7b-sim fail at their Drums-view pins (X's
  window, `['tr808', 'tr606']`) — **23 / 23 and 14 / 14** with those two lines scratch-edited to list `tr909`, then reverted.

### Lane H1 (host: `main.js`, `tests/canvas-7c-sim.test.mjs` (new), `tests/main.test.mjs` (+1); phase 2, base aabdb77 = wt-7c after phase 1)

**Commits**: 2fb7458 (main.js + canvas-7c-sim + main.test, failing first), e5d395f (the sim's chip-swap bounce = live, a chain,
MAP…), 1cd5322 (`sw.js` by `tools/precache.mjs --write`: BUILD only), and these notes. No DSP / engine / other lane's file.

**The lead's fixture check** (canvas-7c-sim's first test, real engine): the Drums view lists `tr808, tr606, tr909`; the 909's
tile replaces the Minimoog ("Replaced Minimoog with TR-909 · tap to undo"; Hardware only; an empty 909 record, a 909 session;
16 live step keys, 12 pads, the display "120"); DEMO (I-1-1, I-1-2 block-played; the payload `m: 'tr909'`, its plan the
panel's: `mSh` 40, 40 — SHUFFLE 3 —, `mFl` 0, 35 — FLAM 11 = 18 ms at 120 BPM); START synced = ▶ from bar 3: **32 step posts**
over bars 3–4, each `{M, s, m, k, v, p, f, o}` the plan's with `o` = 240 s + 40 on the even-numbered steps (shuffle in whole
ticks), `F` on the 4-frame grid at its tick's frame; every sounding step **one** `dm.trig(mask, acc)` at its post's frame with
the plan's lanes and per-voice accents (both accents among them); **the snare flam's second hit its own trigger**
(`trig(SD | AC, 0)`) at its tick's frame (step + 35 ticks), no post there, nothing else triggered; the panel at the heard post
(200 ms of output latency), the chase on the heard step, PATTERN 1 lit, the display the tempo.

**As built** (§10's sites; [C] where §10 left a detail open):
- `drumOf`: the guard `(d.drum.m || 'tr808') !== d.model` (three ways; a 909 record under an 808 / 606 model and an 808 / 606
  record under a 909 re-normalised by the model).
- `drumNeeds` / `drumLoad`'s memory sum: `drumSnds(t, dev)` = `DC.PERS[model].sounds` (the 909's `rd` / `cr` on ids 7 / 8).
- `drumToRoll`: `DC.toNotes(DC.rollPlan(D, project.bpm), { t0, t1, ...DC.rollOpts(D, dev) })` (the 808's / 606's bytes as
  before: canvas-7a-sim / -7b-sim's → Piano roll tests unchanged and green).
- `drTempoOf` / `drTempoPut` by the record's machine (`drMach`): `{ m, tempo }` for the 606 and the 909, `{ m: 'tr808', tempo,
  fine }` for the 808.
- `drumPayload` offline: `Object.assign(DC.initState(model), { bpm: project.bpm })` (the 808's / 606's payloads read no `bpm`
  of a session: their bytes unchanged).
- **The restore's order** [C]: `drumChanged(); DRUM.bpm(project.bpm);` **before** the `sendPatch / sendSong / drumSend` loop —
  §10 moved only `DRUM.bpm`; moved alone, a 909 coming back under a view whose session was another machine's (an undone
  Replace) would get its bpm press on that session, which drum-core's `sess9` converts keeping the other machine's `run` /
  `pos`, and `DRUM.changed` would then see a 909 session and no longer make it fresh. With `drumChanged` first, a machine
  change gets its fresh session (the project's tempo, the transport) before any payload reads it — the old loop posted from
  the stale session and only then made it fresh; then `DRUM.bpm` sends only for a 909 whose session's tempo is stale.

**Readings / findings** (each failing first; the new test against the old line):
1. **drTempoPut read a 909 as an 808** (P0-class): → Piano roll at a project tempo other than the 909's TEMPO, then the
   notice's undo / ↶ / ↷ → `normDrum(…, 'tr808')` — **the 909's record replaced by an 808's** (its 96 patterns, tracks and
   slots gone). canvas-7c-sim "→ Piano roll" at 97 BPM failed with `D().m` undefined.
2. **drumNeeds read the 808's keys**: a 909's crash / ride slot (`cr` / `rd`) never joined the track's needs — the entry was
   never built, so the chip swap on the cymbals stayed silent live and in the bounce (the hats', on ids 9 / 10 = the 808's
   keys, worked); a stray `cb` key on a 909 record counted. `drumLoad`'s cap counted three of five slots (canvas-7c-sim:
   five 10 s stereo slots incl. the ride and the crash, a sixth refused "(33 of 32 MB)" on touch's 32 MiB).
3. **→ Piano roll's flams at 120 BPM**: `compilePlan(D, D.ui, D.x)` without a session plans the synced flam at 120 —
   at 97 BPM the notes' second hits sat 35 ticks after their steps, the sequencer's 28.
4. **The bounce's flams at 120** (review #1): the offline session's `bpm: 120`; at 97 the offline payload's `mFl` `0,35`
   against the live `0,28` (its `pk` differed).
5. **The restore's stale payload** (review #1): a project reopened at 120 over a session at 97 posted two payloads, the
   first with the 97 BPM flams (`0,28/0,0,35/0`); now one (`0,35`).
6. The drumOf guard let both pairings through (main.test: a 909 holding an 808's record stayed one).
- Checked fine, no change: `normDevs`, `setTrackModel` (808 → 606 → 909 in any order), `drumEdit` (a relinked 909 slot stays
  a 909's record), `addTrack` / `importMidiFile` (channel 10 still an 808), `offer303` (606 only), `drumAudible` (a 909 plan
  without a session: `st` reads no tempo), the DRUM deps.
- **TAP write in the browser** (the smoke): the step keys write only into the edited pattern once it is the one heard — a
  mode change while running swaps the plan at the bar, so keys pressed before it play (their notes) but write nothing (S9's
  rule, by design); the smoke waits two bars.

**Tests** — `canvas-7c-sim` (11, accessor-free — `ACCESS_STRICT=1 --import ./tests/accessor-hook.mjs`: **0 accessor calls**;
strings / numbers into `assert`): the fixture check; MIDI 36 / 51 / 49 (the kick, the ride on id 7, the crash on id 8; 56
nothing); PATTERN WRITE running (INSTRUMENT SELECT + 3: the snare; a step key off → normal → accented → off, one 'now' payload
each, the shape kept, the LED dim / on / off — the heard playhead 4 / 3; SHUFFLE/FLAM + 7 / + 16 and a snare flam by flam write
heard from the next measure: the even steps 120 ticks late, the second hit **73 ticks** after its step; LAST STEP + 12 at the
bar; SCALE: 32nds, the even ones 60 ticks late; keys 3 + 4 + ENTER chain I-1-3 → I-1-4, played as one pattern; TRACK WRITE —
PATTERN 1 + a key, ENTER ×3, the display the pointer "  4" — then TRACK PLAY 0, 1, 0, 0 with the measure heard on the display);
TAP write by two pointers on the DOM step keys (36 @ 110, 38 @ 100, written at one step, the kick accented; 13 + 14 → 42 @ 110
then 46 @ 100 on the closed hat's step, the closed hat taken back; every note off at the lifts); → Piano roll (the roll's
eleven rows **Kick 36 … Ride 51, Crash 49, Open hat 46, Closed hat 42**, ride / crash on ids 7 / 8; at 120 the DEMO's four bars
= `toNotes(rollPlan, rollOpts)`, v 100 / 110 / 119 / 127, ride ×16 on 51, crash ×2 on 49, the snare flam pairs `2880:35,
2915:85`; **the notes bounce bit-identically to the synced pattern** (D5, the bounce with no notes first), the notice's undo; at
97 the synced sequencer's notes (`2880,2908`), SYNC off at TEMPO 97, the notice's undo / ↷ / ↶ a 909's record with TEMPO 120;
MAP… ride → 59 and its reset); **review #1** (the TEMPO knob at 97: one History step "Tempo", one 'now' payload `0,28`,
heard 28 ticks; ↶ one payload `0,35`, heard 35; ↷ `0,28`; **the bounce at 97 = live**: the offline payload's `plan.key` and
`pk` the live ones, and its machine's triggers — hooked as the offline render builds its processors — the live ones' (26,
the flam's second hit among them) at the same frame from tick 0, **every one 0 frames apart**); the restore's order (one
payload, the file's record at 120); your own sounds (a crash through SOUNDS…: its `{t: 'smp'}` entry before the payload naming
it, the track's needs, live on ≠ off, the bounce's entries and payload hold it, on ≠ off, on again = the same render; **bounce
= live with the chip swaps**: a fresh 909 playing a crash and an open hat from the roll, both your sounds — live from a 4-frame
anchor, passed through the bounce's pan-0 mix — **bit-identical** to the bounce; the slots off: our images, ≤ 1e-12 (3.5e-17:
the live machine's couplings still hold the first round — a bounce starts from rest) and not your sounds; an open hat relinked
through the asset manager: a 909's record, the rest kept; the memory cap); a project with all three machines saved (schema
**10**) and reopened (the three records round-trip, the 808's without `m`, each node its machine, each payload its `pk`; a
schema-9 store's gate opens it read-only; schema 11 read-only here); **808 / 606 / 909 Replace chain** Minimoog → 909 → 808 →
606 and ↶ ↶ ↷ ↷ twice, plain and as a graphed node's second instrument, every restore with the patch held: the arriving
machine's payload first (`m` names it), then its patch; its synced steps the same count every time; record, session and
`dm._mach` that machine's; nothing left sounding (a TAP-write key and a pad held: a hidden page, a track switch, a panic,
power off — every note off, the session's hits empty; a free run (SYNC off, START) stopped by a panic, its payload not running,
no step after). `main.test` +1 (42 → 43): a page booted on `#tr909` — the record, `processorOptions.seq` (`m`, 36 → 0, 51 → 7,
49 → 8, 56 → −1, `mSh`), a step post → a 909 session, `normDevs`, drumOf three ways (a 909 under 808 / 606 records and the
reverse), `drumNeeds` (the 909's ride and open hat, not its crash off, the 808's cowbell), the offline payload = the live one
at 97 BPM.

**Gates** (node 24, one file at a time): canvas-7c-sim 11/11, main 43/43, canvas-7a-sim 23/23, canvas-7b-sim 14/14,
classic-panel 13/13, cv-drum 50/50, roll 52/52, assets 38/38, canvas-sim 22/22, canvas-1e-sim 24/24, canvas-1i-sim 20/20,
canvas-2a-sim 26/26, canvas-2b-sim 23/23, canvas-3-sim 26/26, cv-shell-sim 16/16, cv-fixes-sim 5/5, accessors 30/30,
engine-track 66/66, lint 143/143 (the accessor ratchet unchanged), pwa 22/22 (`precache --write`); once at the end
**golden-classic 8/8, -fx 3/3, -presets 8/8, -random 1/1, -graph 6/6, golden-drums 5/5 (ref-7a), golden-606 11/11 (ref-7b),
golden-909 9/9, canonical-stream 1/1 — bit-identical**.

**Headless Chrome** (`--headless=new --use-angle=metal --force-device-scale-factor=2`, a fresh browser context,
`window.__synthTest = {}` first; my own static server on 8851 over a copy of the worktree; `scratchpad/7c/h1/smoke.mjs`), **1440
× 900 (mouse) and 1024 × 1366 (touch)**, both all ok: Power by a real tap; the Drums view lists `tr808, tr606, tr909`; a real
tap on the 909's tile replaces the Minimoog; DEMO and ▶ by real taps — the session at a heard post, the display "120", one key
of the chase lit; PATTERN WRITE / TAP, then **keys 1 and 4 by two touches**: both sounding at once, `on:36:0.866 on:38:0.787`
(v 110 / 100) and their offs, written at one step (the kick accented, the snare normal); **a 720 ms touch on the grid's snare
cell at step 11: its flam**; "→ Piano roll" → its menu's "1 bar" by real taps: 21 / 22 notes (v 100, 110, 119, 127) and the
notice; the roll's eleven rows (Kick 36 … Closed hat 42); **a chip swap**: a WAV made in the page through `drumLoad` into the
crash, switched on — the track needs it, SOUNDS… (a real tap) reads "Crash · your sound: my crash (through the 909's chip)",
the kick "circuit (ours)", the ride "our sound (ours)"; note 49 played; **no console error, exception or log error**.
Screenshots `out-1440/`, `out-1024/`. Chrome and the server stopped.

**Seen, not fixed** (for the lead): cv-drum's `bars()` (→ Piano roll's "the pattern's length") compiles the 909's plan
without a session — its length reads no tempo, so it is right; noted only because every other 909 plan read in main now goes
through `rollPlan` or a session. (Fixes R1-F2: `bars()` now reads `rollPlan` with the session — TRACK WRITE's chosen chain.)

### Fixes (reviews 1 + 2) — the fixer (2026-10-21, base 0844ac9)

**Commits**: 80b125a (R1-F1), 3417025 (R1-F3), f5bfe6a (R1-F2), 0ecab45 (R1-F4, R1-F5), 952c6b5 (R2-F1, R2-F2), 85e517d (R2-F3),
6b54cd8 (R2-F4, R2-F5), f3ac11e (`sw.js`, `tools/precache.mjs --write`), and these notes. Every fix failing first (the test named
in its row, against the old line), every reviewer repro re-run before and after (scratchpad `7c/fix/`: `r1/` the reviewer 1
scripts repointed, `loud9.mjs` / `scan9.mjs` / `salt9.mjs` the loudness work, `chip-cost2.mjs`; `r2/` reviewer 2's, `latch9.mjs`
new, outputs in `r2/out/`).

| # | fix | test (failing first) | measured |
|---|---|---|---|
| **R1-F1** loudness (the lead's decision) | `MIX9.W` kept; the balance moved into the **default LEVELs** — models.js, `K9_DEF` (= models.js), `DrumP`'s 909-only `crl` / `rdl` (its shared `bdl` / `sdl` / `hhl` / `cpl` keep the 808's 0.7: a patch always carries them): **kick 9, snare 4, hi-hats 4, clap 1.5, crash 3, ride 3.5**, toms and RS 7; `Bright Cymbals` crash 8 → 4 (one over the new default); **`OUT_K9 = 0.3029 · 7 / 9`** — §2.6's anchor kept: the BD at its default LEVEL 9 peaks at the 808's default BD. **Beyond the lead's three knobs** (clap, crash, ride), because the lead's criteria are out of their reach: the 909's BD carries ≈ 5 dB less RMS than the 808's boom at the old anchor, so matching the groove's RMS needs ≈ +3 dB on the BD while the BD + SD + CH stack (the beats 2 / 4) must stay under −1 dBFS — with the three knobs alone the best is either RMS −1.2 dB at 2.6 dB of limiting or no limiting at RMS −3.7 dB. Kick up / snare and hats down meet all four criteria (the 4 / 1.5 rather than 4.5 / 2: over 8 noise salts × 2 note phases the stack's peak varies with the clap's and the snare's noise — worst 0.867 here, 0.98 at 4.5 / 2) | engine-track **"7c §2.6 level through the whole Track"** (the shipped images, the Track's decimators, the pre-limiter peak at the limiter's input): the default groove (BD beats, SD + clap 2 / 4, CH eighths, 120 BPM, v 100) within ± 1 dB of the 808's, below the limiter (no gain reduction); each sound alone ≤ 0.8 FS unaccented, ≤ 1.0 at v 110 / 119 / 127 — failing at 0844ac9 (−2.63 dB, pre-limiter 1.56, −4.8 dB of limiting). dr-909's §2.6 test: the **shipped images** and a **band-limited decimation** (a 95-tap Blackman sinc below 20 kHz, then every 4th), the BD anchor gated (± 1 dB), the groove reported | groove RMS 909 − 808 **−2.63 → −0.18 dB** (over the 16 salt / phase cases −3.11 … −2.59 → −0.19 … −0.14); pre-limiter peak **1.56 → 0.80** (worst case 1.90 → 0.867; threshold 0.891): **no limiting** (was −4.8 dB). Alone, pre-limiter (default panel): unaccented BD 0.462 SD 0.247 LT 0.341 MT 0.337 HT 0.386 RS 0.337 HC 0.328 RD 0.560 CR 0.545 OH 0.307 CH 0.316 (max 0.560; was HC 0.938, CR 1.031); both (v 127) max **0.970** (the BD; CH 0.871, RD 0.929, CR 0.904; was CR 1.711, RD 1.507, CH 1.236). BD alone 0.4286 = the 808's (0.00 dB). **For the lead**: K-weighted (BS.1770, ungated) the groove is **+1.0 dB** over the 808's (was +0.3 … +0.9: RMS weighs the 808's boom; the ear weighs the 909's snare and hats); the DEMOs synced through the Track 909 −16.4 / 808 −18.1 dBFS RMS (different patterns; both meet the limiter on their accents). Reviewer 1's `loud.mjs` groove steps 120 ticks (32nds: a double-time groove) — on it −3.82 → −0.82 dB, peaks 0.773 (no limiting) |
| **R1-F2** TRACK WRITE (synced): bounce / → Piano roll | drum-core **`planSess(D, S)`** — the session fields a synced plan reads: the 909's `{ ptr, pend }`, the 606's `{ bar (TRACK WRITE only), twSel, ds }` (the 606 had the same bug: its bounce played bar 1 for the heard bar, and its D.S.), the 808's none (`null`); main.js's offline payload `Object.assign(initState, { bpm }, planSess(D, live session))`; **`rollPlan(D, bpm, S)`** (the 808's `compilePlan(D, D.ui, D.x)` exactly) from `drumToRoll` with the live session; cv-drum `bars()` through `rollPlan` | drum-core "review 1 F2" (planSess, rollPlan, the offline payload = the live one, 909 and 606; the 808's byte-identical); canvas-7c-sim "review 1 F2" (pointer and chosen key: the bounce's `plan.key` / `pk` = live, → Piano roll the heard I-1-2); canvas-7b-sim "7c review 1 F2" (the 606's bar pointer) | `m1-trackwrite.mjs`: the bounce plays `1` (was `0`), → Piano roll the ride ×8 and no crash (was I-1-1); the chosen key the same |
| **R1-F3** chip swaps | `romPoll9(F0)` converts **at most one image a quantum** (the span start's 128-frame block; the others pending on their built-in images); the machine's **`poll(F0)`** (808 / 606: nothing) from the Inst's **idle skip** (engine.js, beside Serum's `SD.idle`): conversions happen while the 909 waits; `reset()` clears the quantum mark. `conv9` hoisted to one function for every 909, and the warm-up's stand-ins (0.75 s, mono and stereo; smpwork's field order) take both its branches — a branch first met by a user's sample deoptimised it (≈ 2 ms in that quantum, `chip-cost2.mjs` / `--trace-deopt`) | dr-909 "the chip swap converts at most one image a quantum" (four slots, four spans a quantum: `[1, 1, 1, 1, 0, 0]`; `poll` the same; 808 / 606 `poll` nothing) and its swap test's two quanta; engine-track "7c chip swaps on an idle 909" (idle 2.5 s, four entries: one a quantum, nothing rendered, the first hit plays the swap) | `chip-cost.mjs` (node, M4 Max): the worst quantum **5.40 → 1.31 ms** (48 kHz, the quantum 2.67), **5.73 → 1.42 ms** (44.1 kHz); one slot 0.54–0.92 ms. `chip-idle.mjs`: converted while idle (worst quantum there 1.31 ms), **the first hit's quantum 5.72 → 0.03 ms** |
| **R1-F4** STOP/CONT free | §3.3's **[R] row restored** (S9's reading 4 — "in the pattern modes CONT starts the selection again" — had no source; superseded): a free STOP keeps the running plan's structure (`cont`: its shape and patterns; TRACK PLAY its located start); STOP/CONT computes the plan's tick after the last step played (`from9`) — the payload's **`from`** — and DrSeq's free START begins its clock there (the cursor at the first step at or after it; absent: tick 0, as every 808 / 606 payload). TRACK PLAY: its measure as `loc` (a pre-roll from it, the posts heard after the press moving it), the step within. The host delivers a free 909's already-rendered posts at its STOP (they are heard through the latency). START, another selection / mode, a relocation (BACK / FWD / locate): from the top / the located measure's step 1 | dr-seq "review 1 F4" (`from`: the first post m 2 s 8 at its tick's frame, then the cycle; none: step 1; running: ignored; hostile values: 0); drum-core "review 1 F4"; canvas-7c-sim "review 1 F4" (the real host and engine) | `m8-cont.mjs`: the pattern modes, stopped after k1 s8 → CONT **k1 s9** (was k0 s0); TRACK PLAY, stopped in measure 2 at s8 → **m0 k1 s9** (its measure as the pre-roll; was its step 1), the display "  2" |
| **R1-F5** synced CYCLE on after an ended once track | DrSeq `take()`: a 'now' plan without `once` arriving while a once plan's cursor is silent (`ct` INF) re-locates at the song position (the wrapped step plays at once; before the end the in-place swap as before); drum-core marks a synced CYCLE-off TRACK PLAY **ended** at its last step heard (`S.end`) — `leds909` / `disp909` read it as stopped (no chase, the measure's key flashing, the located measure) until CYCLE on, a transport press or a step heard again | dr-seq "review 1 F5" (the fake Track: bar 3, CYCLE on → m 0 s 8 at its song tick's frame; before the end in place, looping); drum-core "review 1 F5" | `m10-cycle.mjs`: posts in the 2.5 bars after CYCLE on **0 → 40**; in bar 3 the LEDs `2000…` (the measure's key, stopped) and the display "  1" (was the chase frozen on step 16, "  2") |
| **R2-F1** held key + a tap | `tapBtn9` latches at its own pointerdown what is held (the holds; the step keys held) — dropped on its pointercancel, cleared after its pointerup — and sends it with the tap: `{ k: 'tap', b, n, held: { <b>: true }, keys }`; `press909` ORs `held` into that press's holds (never stored) and takes `keys` for ENTER's chain when none is held then | cv-drum "review 2 F1" (SHIFT + PATTERN 2 / TRACK 2 / BACK, INSTRUMENT SELECT + ENTER, TEMPO + ENTER, either finger first; 3 + 4 + ENTER, the keys first; a cancelled tap latches nothing) | `holds9.mjs` **48 / 48** at 1024 × 1366, 1366 × 1024 and 1440 × 900 (was 38 / 48 at each); `chain9.mjs` **3 / 3** at the three (was 1 / 3) |
| **R2-F2** desktop holds (the lead's decision) | (a) Alt or Shift on a 909 tap key = SHIFT (`held.shift`, at the tap's press or its keyboard click); (b) a **mouse / pen click or a key press on a held key latches it** (`H9.hold[b].id 'latch'`): `data-latch` (an orange ring), aria-pressed, its label "· latched: for the next key (click again or Escape to cancel)"; the next key that uses it releases it (a step key's up, a tap) — **SHIFT stays through its sequence** (digits, COPY / INS / DEL: `S.dig` / `S.op` set) until ENTER; a combination of two holds (SHIFT + TEMPO = STEP write, SHIFT + AVAILABLE = bank II) uses both; a second click toggles it off; **Escape cancels** (a document listener while a latch is on: `{ k: 'release' }`, nothing done); a blur no longer cancels a latch (focus moves on); a **finger keeps the real hold** | cv-drum "review 2 F2" (Alt- / Shift-click PATTERN 2, PATTERN 1, BACK, TRACK 2; INSTRUMENT SELECT latched → lit, announced → key 3 the snare, released; + ENTER; a second click; a key press latches, Escape cancels; LAST STEP + key; TEMPO + ENTER; SHIFT + digits + ENTER locates; touch holds). Changed (the lead's rule): "a keyboard hold blurred" → a keyboard latch, Escape: no locate; the keyboard alone locates | `latch9.mjs` (new) **13 / 13** at 1440 × 900 and 1024 × 1366 (the ring computed, the label, the touch hold); `mouse9.mjs` its 5 mouse cases ok (were 2 of 5; its two keyboard cases fail as in review 2's own run — the script's Tab leaves the module before PATTERN 2, its Enter carries no text); `kb9.mjs` **6 / 6** with an Escape after its case 2 (INSTRUMENT SELECT left latched there is, by the rule, used by the next key) |
| **R2-F3** pads' flashes | each pad flips its own `data-hit` (`'1' ? '0' : '1'`; at rest no attribute, as before) | cv-drum "review 2 F3" (two pads alternately and together, 808 / 606 / 909); the 909 pads test's `['1', '0']` → `['1', '1']` (it pinned the shared counter) | `lit9.mjs` (DEMO, 2 bars): every flash call an animation start — 909 BD 7 / 8, CH 13 / 14, OH 7 / 7, RD 8 / 8, HC 3 / 4 (were 7 → 3, 13 → 9, 7 → 3, 8 → 2, 3 → 2); 808 and 606 the same. `diffold.mjs` vs 7b297e5: the 808's and the 606's panels **0 of 4 194 304 / 2 101 248 px** (GL and `?nogl`), DOM identical, 847 / 645 elements |
| **R2-F4** the Solina's caption | `xcapFit` on **every** strip, only where the caption does not fit — "fits at 9 px" reads the estimate × **`XCAP_K` 0.935** (Chrome's measure of the plain caption: 379.9 of an estimated 406.8 px); the smaller size chosen on the plain estimate (conservative) | cv-panel "7c review 2 F4" (xcapFit at the Solina's 366 / the Prophet-5's 384 px room; every authored panel rendered: the Solina and the 909 at 8 px, no other strip changed) | `xcap.mjs` (1440 × 900): the Solina **317.6 px at 8 px, 56 px inside its strip** (was 5.9 px past it); the Prophet-5 / OB-Xa 379.9 px at 9 px, 12.1 px inside (unchanged); the 909 838.7 at 8 px; every other strip at 9 px |
| **R2-F5** polish | SOUNDS… "Ride · our sound" (no doubled "ours"; "Kick · circuit (ours)" kept); the grid's yellow cursor only after keyboard navigation — a Tab focus or a key draws it, a mouse / touch press hides it (`kbd`; its signature in the redraw key), blur ends it — the 808's, 606's and 909's grids | cv-drum "review 2 F5" (the three grids: a press's focus draws no box, an arrow does, a press hides it, a Tab focus shows it); the popovers test's text | `grid9.mjs` screenshots after mouse (1440 × 900) and touch (1024 × 1366) presses: no box; `kb9.mjs`'s grid case (arrows, Space, F) ok; `ui9.mjs` **18 / 18** at 1440 × 900 (mouse) and 1024 × 1366 (touch) with "Ride · our sound" |

**Gates** (node 24, one file at a time, `--max-old-space-size=2048`): dr-909 29 / 29, rom909 8 / 8 (`tools/rom909.mjs --check`: the
block current — ENV9 unchanged, no `--write` needed), drum-core 133 / 133, dr-seq 41 / 41, cv-drum 54 / 54, cv-panel 90 / 90,
classic-panel 13 / 13, canvas-7a-sim 23 / 23, canvas-7b-sim 15 / 15, canvas-7c-sim 13 / 13, engine-track 68 / 68 (the d9 bench
rows within their gates), main 43 / 43, roll 52 / 52, lint 143 / 143, pwa 22 / 22 (`sw.js` BUILD 6bc77b26e70b); once at the end
**golden-drums 5 / 5 (ref-7a) and golden-606 11 / 11 (ref-7b) bit-identical**, golden-909 9 / 9 (not frozen: determinism —
the 909's sound changed with F1's levels and `OUT_K9`, as the lead expected), golden-classic 8 / 8, -fx 3 / 3, -presets 8 / 8,
-random 1 / 1, -graph 6 / 6, canonical-stream 1 / 1.

**Headless Chrome** (155, `--headless=new --use-angle=metal --force-device-scale-factor=2`, CDP 9493, own profile; a `git archive`
of HEAD served on 8993, 7b297e5's copy on 8994 for the pixel diff; both servers and Chrome stopped): the rows' repros above, **no
console error, exception or CDP log error** in any run. **Seen, not fixed**: `grid9.mjs` at 1024 × 1366 reports "HC: covered" at
k 1.6 — the script hit-tests a row before its own re-look brings the cell into the portrait band (12 / 12 at 1440 × 900, and the
node grid tests at 3 zooms); not a panel change.

## 15. Review log

### The skeptic review (2026-10-20, against ce0ce80 = 7b297e5 + this contract)

Every claim about existing code was read at ce0ce80 (its code = 7b297e5's); scratch arithmetic and one scratch measurement
only (`scratchpad/r7c/blep.cjs`: the DX7's 2-point polyBLEP DAC against the exact band-limited staircase); no test was run. The
user's §13 answers are settled and not reopened. **D1 holds as designed**: golden-drums / golden-606 render the three frozen
files with every other module current (tests/golden-drums.test.mjs:44–51, golden-606.test.mjs:51–58), so drum-core's 808 / 606
outputs are part of the guard — the 808 pin (drum-core.test.mjs:860–902: records with a hostile `m`, sessions, payloads, plans,
notes, tables, 66 presses) and the 606 pin §12.3 adds cover them; `PERS.tr808` / `PERS.tr606` already carry `sounds` / `names`
(drum-core.js:107, 116), so moving the readers onto them is additive. **What did not hold**: the synced flam tempo never reaches
the worklet (#1), a flam can outlive its lane's next step (#2), two 7b tests contradict the raised bound and the new id (#3,
#14), the staircase gate and d9p are beyond what the design can meet (#4, #9). Severity as 7a / 7b: P0 a silent failure or a
broken build, P1 a contract contradiction or an impossible gate, P2 a gap a builder would trip on, P3 a correction.

| # | point | evidence (file:line) | fix |
|---|---|---|---|
| 1 · P0 | **A synced 909's flam ticks never follow the project tempo**: §3.4 computes `mFl` at the session's `bpm` and says "a tempo change re-sends the plan", but a tempo change only writes the sessions' `bpm` — `DRUM.bpm(v)` runs no press and sends nothing; the restore posts every payload *before* it updates the sessions; the offline payload takes a fresh session at 120 BPM — so the flams keep the old spacing until the next edit, undo leaves them stale, and a bounce at 100 BPM has 120 BPM flams (D7) | cv-drum.js:272 (`bpm(v)`: sessions only); main.js:3274–3281 (`setProjectBpm` → `DRUM.bpm`), 1401–1402 (`drumSend` loop, then `DRUM.bpm`), 3217 (`initState(model)` offline); drum-core.js:579–581 (`bpm: 120`) | **fixed in §3.4, §10, §11, §12.3, §12.7**: P1's `bpm(v)` presses `{ k: 'bpm' }` for a 909 (drum-core sends 'now' when the ticks change); H1 orders the restore and gives the offline session the project's tempo; the memo signature carries the tempo |
| 2 · P1 | **A flam can land after its lane's next step**: 38 ms is 73 ticks at 120 BPM, but 32nds at SHUFFLE 7 put the swung step's successor 60 ticks later (182 ticks at 300 BPM vs 16ths at SHUFFLE 7's 120) — DrSeq's one pending hit is overwritten by the next step's flam (a hit lost) and → Piano roll's first note (`d` = the spacing) overlaps the next one, against §4's "never acts" | §3.4–§3.5 (as written); STEP_T 120 / 240 (drum-core.js:67); 38 · bpm · 960 / 60 000 | **fixed in §3.4, §3.5, §12.3, §12.4**: `mFl[m] ≤ g_m − 1` (the measure's smallest step gap), so one pending slot suffices |
| 3 · P1 | "The 79 tests of 7b unchanged" contradicts raising `MAX_STEPS`: a drum-core test pins the 808's longest plan to the constant | tests/drum-core.test.mjs:254 (`big.st.length === C.MAX_STEPS`, 768 × 32) | **fixed in §3.4, §12.3**: the literal `768 * 32` (the 808's bound), S9's |
| 4 · P1 | **"Within −60 dB of a reference staircase rendered at 64×" is beyond the method §2.3 prescribes**: the DX7's 2-point polyBLEP, run on a 6-bit staircase at 21 / 32 / 53 kHz words, misses the exact band-limited staircase by −40.0 … −44.7 dB over 0–20 kHz at OS 4 for cymbal-like content (15 / 8 kHz; a naive hold −22 / −25 dB), −65 dB only under 2 kHz, −28 … −33 dB at OS 2; and a 64× hold is itself no −60 dB reference (its step jitter ≈ −50 dB at 20 kHz) | engine.js:2763–2790 (`renderDac`); scratchpad/r7c/blep.cjs (this review) | **fixed in §12.1**: the exact staircase as reference; ≥ 15 dB below a naive hold and ≤ −35 dB re the signal, the numbers in §14; a 4-point BLEP V9's option |
| 5 · P2 | Two writers of dr-808.js and a gate no branch can pass in phase 0: the generated block's contents are R9's tool output, its frame V9's, the final `--write` the lead's — `rom909.test`'s `--check` fails on every lane branch until then, unlisted | §11 phase 0, §12.2 (as written) | **fixed in §11** (known windows: R9 never commits dr-808.js; V9 the markers with the placeholder) |
| 6 · P1 → P-1 | **The rank velocity law ties a written note's state to the knob**: `vel9` gives per-voice / total accent 110 / 119 "in the order their codes take" at the panel's TOTAL ACCENT; turn the knob (or cable `drum.ac`) across `T(u) = L` after → Piano roll and v 110 / 119 now name the other state — the sequencer path does not swap, so the two ways diverge at any panel but the one written at (the 808's / 606's v 100 / 127 mean normal / accent at every knob) | §1.3, §4 (as written); engine.js `drHit` (2227: `dm.hit(s, round(v · 127))`) | **for the lead** (P-1); §1.3 says so |
| 7 · P2 | "`drStep(n, v)` gets the state's velocity": a step mixing an accented and a plain voice has no single state | §3.5 (as written); dr-seq.js:265–274 | **fixed in §3.5**: the highest of its sounds' state velocities [C] |
| 8 · P2 | The 909's plan reads more than 7b's (the flam tempo, `once` by CYCLE, `guide`, TRACK WRITE's `pend` / `ptr`, TRACK PLAY's `loc`); one missed by the key or the memo is a payload `drumSend`'s `pk` dedupe drops — 7b review #3's class | drum-core.js:388 / 461 (the memos' signatures), 562–567 (`pkOf`); main.js:3223 | **fixed in §3.4**: every input in the signature and the key |
| 9 · P1 | **d9p 0.025 is below what its own pattern keeps awake**: BD on the quarters never reaches −100 dB in 500 ms, HC's tail and the toms' 103 ms ENV1 stay above it between their hits, the three ROM voices never sleep; §2.7's ceilings give a machine up to ≈ 0.032, the 606's measured share of its ceilings ≈ 0.019, plus the Track's ≈ 0.007 — 7b review #8's class | IMPL-7b §14 lane V6 (per circuit 0.0016–0.0056, d6p machine 0.0104) and lane E6 (d6p 0.0173); IMPL-7a §14 (d8p 0.0193, machine 0.0126); R9 §2, §4, §6 | **fixed in §2.7**: d9p 0.035 [C] — proposal P-2 |
| 10 · P2 | Schema 10 moves three more cv-migrate pins than §6 listed: 7a's `[9, 9]` and two `upgrade({ schema: 10 }).readOnly === true` | tests/cv-migrate.test.mjs:1051, 1057, 1148 | **fixed in §6, §11** (X's: 10 → 11, as 7b moved 7a's) |
| 11 · P2 | `cv-panel.test` reads `EXTRAS[id]` for every `HW_IDS` entry: a listed tr909 without an `EXTRAS.tr909` row throws | tests/cv-panel.test.mjs:33–39, 330–337 | **fixed in §11** (P1's) |
| 12 · P2 | `PERS.tr909.sounds` "ids 11–15: none": every 16-loop over a machine's `sounds` (`normMap`, `normSmp`, `mapTable`, `slots`, `drumNeeds`) would write an `undefined` / `''` key into records and payloads | drum-core.js:157, 163, 169, 218, 233, 537; main.js:160 | **fixed in §1.2**: ids 11–15 keep the 808's keys, inert as the 606's absent sounds; the global exports stay |
| 13 · P2 | §0 named cv-drum's `six` (361) once, but it feeds ≈ 20 binary branches a 909 panel would take as the 808's (grid hit-test, pad sizes, texts, the cancel rule); and 786 (a pad's slot title by `DC.SOUNDS`) | cv-drum.js:158, 329, 361, 364, 529, 625, 645, 666–733, 773–779, 786, 883–892 | **fixed in §0, §7.4, §11** |
| 14 · P1 | **Two tests use `'tr909'` as "an unknown machine"**: normDrum must read `{ m: 'tr909' }` as the 808's, and a `machine: 'tr909'` patch must build nothing and post `drumsErr` — both break the day `PERS.tr909` / `MACH.tr909` exist (the second on wt-7c from V9's merge, owned by phase-1 E9); and the bench's `drumTrack` is binary at 267 / 269 too | tests/drum-core.test.mjs:1001; tests/engine-track.test.mjs:1163; tests/bench-scenarios.mjs:262, 267, 269 | **fixed in §0, §11, §12.3, §12.5**: their owners use `'tr999'` (the same check); the window listed |
| 15 · P2 | The warm-up's 909 round "a free plan with a shuffle and a flam" cannot be built: `DrSeq.simplePlan` makes no `ac` / `fl` / `mSh` / `mFl`, and dr-seq.js is S9's | engine.js:3318 (`DS.simplePlan(WMASK6, 3)`); dr-seq.js:337–345 | **fixed in §1.5, §11**: `simplePlan(masks, pre, x?)` (S9) |
| 16 · P3 | Two texts pinned elsewhere: the Drums view's note (its test) and bench.html's row note | tests/cv-tray.test.mjs:569; tests/bench.html:118 | **fixed in §11** (X's, E9's) |
| 17 · P2 | `once` and re-anchors: DrSeq's `locate` and drum-core's `measureAt` / `toNotes` wrap a position past the plan's end into the cycle, so a seek past a CYCLE-off track's end would play mid-track while its notes are silent; and `toNotes` filters by the step's tick, dropping a flam's second note whose step lies before `t0` | dr-seq.js:219–224; drum-core.js:493–499, 519, 528 | **fixed in §3.3, §3.5, §4, §12.3, §12.4** |
| 18 · P2 | Block play over chains was undefined ("each pattern expanded by its chain" would replay a chain's tail once per key inside it); R9 §12: a chain counts as one pattern | §3.3, §3.4 (as written); R9 §12 | **fixed in §3.3** [C] |
| 19 · P2 | TAP write's 13 + 14 = OH: key 13's down has already played and written an accented CH | §3.3 (as written: "acts at its down unless a combination needs it held") | **fixed in §3.3**: the second key takes the CH back off its step [C] |
| 20 · P2 | The chip swap's conversion "when a payload names a new slot id" can find no entry: payloads overtake their entries (7a reads a slot lazily at its first hit); the shared built-in images vs per-machine slot buffers; "normalised like the tool's" left pre-compensation open | main.js:3228–3231; dr-808.js `smpHit` (≈ 2789: `getAsset` at the hit) | **fixed in §5**: a pending slot converted at the first span that finds its entry, never in `hit`; per-machine buffers; peak-normalised, not pre-compensated (Q2's chip swap) |
| 21 · P2 | The step keys as pads were two mechanisms: §7.4 "through `api.drum.pads`' path", §10 / §11 a drum-core command `{ c: 'hit' }` through `exec` (which has no 'hit' case; `pads.on` also REC-writes) | cv-drum.js:197–208 (`exec`), 305–316 (`pads.on`); §7.4 vs §10, §11 (as written) | **fixed in §7.4**: one — the press returns `{ c: 'hit' }`, `exec` plays it through the pads' note path without its REC write |
| 22 · P3 | `ac` / `fm` were masked by lane only (a flam without its step plays the second hit alone); the 896 cut's order unstated | §3.1 (as written) | **fixed in §3.1** |
| 23 · P3 | D5 and `guide`: the click's RS hits rewrite the RS + HC accent DAC a ringing clap reads, which no note does | §1.3 ("a held level acts between hits"), §3.5 | **fixed in §3.5** (D5 cases with it off) |
| 24 · P3 | The noise clock's "± 20 %" is not R9 §7's 0.3–0.46 MHz; a bit index from a running sum of `f_clk / fs` (not exact at 44.1 kHz) breaks span invariance | R9 §7; §2.2 (as written) | **fixed in §2.2**: integer `floor(i · f_clk / fs)` |
| 25 · P3 | The tool's D4 static check sees `rom909.mjs` only (its constants come through dsp-scope's own `readFileSync` of the DSP scripts); its determinism is node's libm | tests/dsp-scope.mjs:50; §12.2 (as written) | **fixed in §12.2** |
| 26 · P3 | A flam's second hit: posted as a step or not was unstated (the LEDs and the heard-post readers count posts) | §1.5, §3.5 (as written); dr-seq.js:277–280 | **fixed in §1.5**: no post [C] |
| 27 · P3 | A `d: 120` note on a shuffled 32nd overlaps the lane's next note (`120 − mSh` later) — taken over, harmless | engine.js:2697–2698 (a drum Inst's note-off returns) | **noted in §4** |
| P-1 · proposal | **The velocity law** (#6): (a) as written — the four states sorted by code at the knob, louder never weaker, a written note's state knob-dependent; (b) **fixed velocities per state** — 100 normal, 110 per-voice, 119 total, 127 both (100 / 127 for a voice without per-voice accent), the codes between two states interpolated (non-monotone between 110 and 119 only while `T(u) < L`): a note means one state at any knob position and under a cable, so → Piano roll's notes and the sequencer stay one sound after the knob moves (D5 at every panel, as the 808's and the 606's). The review recommends (b) | #6 | **for the lead** |
| P-2 · proposal | d9p's target: 0.035 as applied (#9, the honest load of the house pattern), or keep 0.025 and thin d9p (the toms once a bar, the crash out — d9m has it); 7b's P-1 chose the honest load | #9 | **for the lead** |
| 28 · fine | Checked and fine: §0's line numbers (engine.js 1917–1950, 2137–2328, 3288–3348; dr-808.js 2382–2997 — the selections at 2398 / 2400 / 2413 / 2424–2431 / 2629 / 2696 / 2702 / 2731 / 2784 / 2907–2930 / 2954; drum-core.js 59–60, 105, 155–171, 200–284, 381, 455, 508, 544–567, 578, 593, 637, 840–852; cv-drum.js 133–138, 171–182, 355–365; main.js 147–151, 3217–3231, 3299–3339); the 909 on the 808's lane bits and sound ids — `LANE_SOUND[8] = [7, 7]`, `[9] = [8, 8]` and `SOUND_LANE` put RD on lane 8 / id 7 and CR on lane 9 / id 8 as §1.2's table (drum-core.js:63–64), `0x83E` = BD SD LT MT HT CH, `0x03E` = BD … HT; `pkOf` hashes `m` and `rst` whenever `m` is present (drum-core.js:566), so a 909 payload never shares an 808's or a 606's `pk`; the engine is machine-generic (`mch`, `drOn`'s cache, `drPend`, `drPost`, `drGain` by `p.machine`: engine.js:1924–1947, 2137–2250) and `drHit` passes v 100 / 110 / 119 / 127 exactly (`round(v · 127)` of the song's v / 127); a drum note-off does nothing (2698), so note overlaps never touch the sound; the synced flam and shuffle as whole ticks keep D5 bit-identical at 120 BPM / 48 kHz (25 frames a tick; shuffle 20 · (sh − 1) = 2 … 12 / 96 of a beat, the 32nds' key pairs as OM9's "1 = 2, 3 = 4, 5 = 6, 7"); x³¹ + x¹³ + 1 is a primitive trinomial (period 2³¹ − 1); the ROM clock arithmetic — the hat's 12 kΩ and the crash / ride's 6.8 kΩ + TUNE 5 kΩ give one nominal 30 kHz, TUNE 0–10 21–52 kHz (× 2.47), the late R442 / R440 a +0.4-semitone shift the tool's word-based pre-compensation does not see; the plan bound (a 909 track ≤ 896 measures, a free pre-roll ≤ 895: 1 791 ≤ 1 793; ≈ 170 KB the longest plan); the 14 mm minimax (14 keys at 14 mm need 182 mm against 169.8: ± 6.1–6.2 mm, the row's hit boxes 179.6–375.6 mm between TEMPO's edge at 171 and ENTER's at 376.2) and the 992 px module; the generated block's home — a separate script would cost a DSP-list entry (D8; dsp-scope.mjs:22–42, wk.test / app.test counts) and a fourth file in every ref, while in dr-808.js ref-7c freezes it with the circuits; no lint rule bounds a line or a file (tests/lint.test.mjs); schema 9 → 10 free and the Minimoog fallback precedent (cv-migrate.js SCHEMA 9; the 7a / 7b steps additive); `isDrum` by `PERS` (song.js:548) and `drumRowsOf` (roll.js:54) take the 909 with no edit; classic-panel's vertical-switch test needs no 909 entry while its layout binds no switch (tests/classic-panel.test.mjs:243–253); D4 — the maker only in models.js's label, the face's plain model print the TB-303 / 606 precedent, the tool's seeds from wt.js:50 / 58, no path by which ROM data could enter | as cited | — |

**The lead's decisions on §15 (2026-10-20):** P-1 — fixed velocities per accent state (normal 100 · per-voice accent 110 ·
total accent 119 · both 127), never ranked by the TOTAL ACCENT knob, so "→ Piano roll" notes and the sequencer agree whatever
the knob or a cable does. P-2 — d9p's target 0.035 (its pattern keeps almost every circuit awake; 7b review #8's lesson).
Phase 0 (V9 ∥ R9 ∥ S9) starts now on the holding branch `wt-7c`, base this commit.
