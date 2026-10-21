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
    LEVEL, **`rdl`** RIDE LEVEL, **`cru`** CRASH TUNE, **`rdu`** RIDE TUNE; **`vol`** VOLUME (def 7.5). Levels def 7, the rest 5 [C].
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
  kHz; 7a §14) within ± 1 dB (7b's rule); the track's limiter catches accented stacks.
- **Presets** (knobs only): `Init`, and three of ours [C]: `Long Kick` (bdd 9, bda 3, bdu 3), `Tight` (bdd 3, sdt 3, chd 3, ohd 3, ltd 3,
  mtd 3, htd 3), `Bright Cymbals` (cru 7, rdu 6, crl 8).
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
