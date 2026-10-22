# Stage "7d + 8": the pad controller and the Simmons SDS-V (IMPL-8) — contract

The user, 2026-10-19 (ROADMAP feedback table): "we will need to add a pad style controller with a resizable grid that lights up and
has full custom mapping functionality". ROADMAP stage 8: a pad-style controller module — a **resizable grid** of pads that **light
up** (velocity-sensitive, colour per pad, note / chord / clip / macro / drum-hit targets), **full custom mapping** of every pad (and
of a hardware pad controller via MIDI learn), stored with the project, its own Sources view **"Controllers"**; "pads map to drum hits
first". The drums proposal ([PROPOSAL-drums.md](PROPOSAL-drums.md) §3, answers 2026-10-20): every drum sound is a pad target, the
pad's velocity the trigger strength, pads light when their drum plays (the machine's own sequencer included), a hardware pad
controller by MIDI learn onto the same targets, pad hits recordable into the pattern or the roll; **the Simmons SDS-V** — a
hexagonal-pad analog drum *synth* with no sequencer, played from pads — **is built with stage 8**; the answers that bind it: **our own
sounds through the real circuit**, the **authentic panel** (original art, no maker name or logo) **+ an extras strip that starts
neutral**, **mix output first**. 7a's, 7b's and 7c's settled answers stand for the family.

Design inputs: this stage's appendix [research-sdsv-circuits.md](research-sdsv-circuits.md) (**RV §n**), [IMPL-7c.md](IMPL-7c.md)
(**7c §n**), [IMPL-7b.md](IMPL-7b.md) (**7b §n**), [IMPL-7a.md](IMPL-7a.md) (**7a §n**) — their §14 notes and §15 review logs are the
reference for what exists and the bug classes reviews found —, [IMPL-1i.md](IMPL-1i.md) (**1i §n**: the keys' pointer engine, the
gesture rules G1 / G2), [IMPL-2a.md](IMPL-2a.md) / [IMPL-2b.md](IMPL-2b.md) (the modulators, the project Mod Wheel), research-drums.md
(**RD**). ROADMAP and its feedback rows win where they differ. Code references are to `canvas` at **8815b14** (the 7c commit; lines
drift, names do not). Part A (§1–§10) is the pad controller, Part B (§11–§13) the SDS-V; §14 lanes, §15 tests and gates, §16 the
questions for the user, §17 the builders' notes, §18 the review log.

**Every number is tagged**: **[R]** from research (its RV section or source), **[R?]** a secondary / reconstructed / conflicting
source or a value the sources do not give (the lane pins it), **[C]** a choice made here (a builder may refine a [C] with a reason in
§17, never an [R] without a source).

**Invariants of the stage**
- **D1 Old sound bit-identical**: every golden shard (`golden-classic`, `-fx`, `-presets`, `-random`, `-graph`), `canonical-stream`,
  **`golden-drums` (ref-7a), `golden-606` (ref-7b) and `golden-909` (ref-7c)** against their frozen refs (untouched, their `PIN`s
  unchanged), `dr-808.test`, `dr-606.test`, `dr-909.test`, `rom909.test` unchanged and green. `dr-808.js`, `dr-seq.js`, `engine.js`
  change only so that every ref-7a / 7b / 7c case renders bit-identically; the 808's, 606's and 909's patch, payload, plan, record and
  session keep their exact shapes — drum-core's 808 pin (tests/drum-core.test.mjs) and 606 pin unchanged, and **a 909 pin of the same
  kind taken at 8815b14 before any change** (§15.3).
- **D2 New sound frozen**: the SDS-V is pinned at the acceptance commit by **`tests/ref-7d/`** (verbatim `dr-808.js`, `dr-seq.js`,
  `engine.js` + `MANIFEST.json`, ref-7a's mechanism) rendered by a new **`tests/golden-sdsv.test.mjs`**; from then on ref-7a / 7b / 7c
  / 7d each guard their machine.
- **D3 One instrument per track, one output**: the SDS-V is a track's instrument with one `out` jack (the mono mix, RV §1); its
  per-channel outputs and stereo pair are drawn `inert: 'later'` ("cable-able with full patching (stage 4)", 7a §7.1's form); its
  trigger inputs, pad inputs and hi-hat pedal socket are print. **The Pads module is not an instrument**: it has no audio jack.
- **D4 Original content**: no Simmons material — no schematic, manual text, logo, maker name or wordmark on the panel, tile or
  extras; our own factory sounds (RV §2.4); the optional hi-hat / cymbal cards' EPROM recordings never used, fetched or approximated
  (RV §3); our own hexagonal pad art. No hardware pad controller is named anywhere (one generic light-back scheme, §8.4; Q6
  answered — review #5).
- **D5 Part A changes no DSP and no existing message stream**: the Pads module plays through the app's note path (`{t:'on'}` /
  `{t:'off'}` posts, main.js `noteOn` / `noteOff`) and modulates through the value table (`{t:'mval'}`, `{t:'mods'}`); a project
  without a Pads module posts the same bytes as today (`canonical-stream`, the compiled mod payloads, every `compileMods` memo
  signature of a track without pad rows unchanged). engine.js, mod-core.js, serum-*.js, sx-*.js, fx-dsp.js are not touched by Part A.
- **D6 Budgets**: Part B's rows on the Mac (V8), the JSC shell and the iPad (§12.7); no allocation on the audio thread; a silent
  SDS-V ≤ 0.0005. Part A: a pad press → its note posts ≤ 1 ms of main-thread work; lights ≤ 1 paint a frame; nothing runs while no pad
  is held, nothing is lit and nothing plays; a 4 × 4 module ≤ 60 DOM elements, an 8 × 8 one ≤ 160, **+ 2 per mod pad** (its
  inline jack's anchor and cv-module's hidden fallback dot, cv-module.js:442–451 — review #19) [C].
- **D7 Determinism**: SDS-V hits are functions of the event's frame, the patch, the payload and the salt; offline bounce = live
  (the payload with its trims reaches the bounce, 7a review 1 F1's rule).
- **D8 Reuse, not fork**: the SDS-V adds **no** Inst kind, worklet script, message type, store or DSP-list entry — a **machine
  descriptor** in `dr-808.js`, a **personality** in `drum-core.js` (a record with no sequencer), a **panel**, data entries. The Pads
  module adds **one** canvas module kind and **one** project field (`project.pads`, schema 11); its pointer engine is the 1i bed's
  (`cv-keys.bed`, three options and `at`'s key), its modulation the 2b value table, its placement the Mod Wheel's (one per project, shown on every
  track). Every machine test in shared code becomes **four-way by the machine id** (§0's list).
- **D9 Note hygiene**: every note-on a pad sends has exactly one note-off, on every path — pointer up / cancel / lost capture,
  `release()`, the body's destroy (a track switch, a re-render, Undo / Redo / load), panic, power off, a hidden page, a window blur,
  the pad's mapping edited while held, the pad / module / target track deleted, a hardware note-off, a MIDI input unplugged (the
  adapter's `H.ports`, §8.2). Notes are reference-counted **per (target track, note)** over every pad and pointer holding them — the count decides
  **only the note-off**: **every press is a hit** (a pointer down, a hardware note-on: `noteOn` again, main.js's `held` retrigger),
  the drum panels' "every finger its own hit" (cv-drum.js:1099–1103, 1110–1117; review #2). Only the host (cv-pads) ends a `pd<k>:<n>` key
  (review #7).

## 0. What exists, and what this stage does with it (read at 8815b14)

| piece | where | 7d + 8 |
|---|---|---|
| the 1i bed: per-pointer notes reference-counted, pointer capture, Pencil pressure → aftertouch ≤ once a frame and 0 at the last pen lift, `release()` / `destroy()`, mouse button 0 without Ctrl, no context menu | cv-keys.js:141–214 (`bed`), 128 (`AT_FROM`), 110–124 (`trackLocal`), 20 (`KEY_VEL`) | **reused for the pad grid** with three options and one more argument (K): `o.hit(x, y, s) → { note, v } \| null` (the hit test; default `keyAt(B, …)` — the 1i path byte-identical), `o.slide` (default true: 1i's glissando; the pads pass false: a pointer keeps its pad until it lifts), **`o.each`** (default false: 1i's one `on` per key over its pointers, cv-keys.js:150; the pads pass true: every pointer down calls `o.on`, `o.off` at the pad's last pointer — review #2) and **`o.at(v, n)`** (n: the pen pointer's key; 1i's callers ignore it — review #10) (§2.1) |
| a pad's velocity from where it is touched (back soft, front loud: the 1i curve); a keyboard press 100 / 127 | cv-drum.js:103 (`padVel`), 105 (`KEY_PAD_V`) | **reused** by the Pads module (§2.2) |
| gesture rules: a `data-gesture="music"` touch never pairs with another music touch and pairs with a non-music one by the time rule only (gesture.js:152–166 `partner`); G2 — a resting finger never takes a later press on an awake music / perf zone inside a `[data-cv-mod]` as its pinch (cv-world.js:1148–1163 `onDownCap`, 1188–1195 `zoneIn`); controls sleep below `READ_K` 0.5 (cv-world.js:61) with the `sleeptap` hint | gesture.js, cv-world.js | **reused unchanged**: the pad grid is a music zone inside its module (§2.3); no gesture.js / cv-world.js edit |
| the drum machines' pads: one per sound in the extras strip, multi-touch, `data-hit` flashes alternated per pad, the monitor's `lit` (sound-id bits) at the heard time, REC writes the lane at the nearest step | cv-drum.js:1077–1142 (`padsCell`), 388–399 (`api.pads.on/off`), 380–386 (`api.lit`: the first subscriber turns the monitor on), 321–328 (`frac`), 332 (`H.mon` → `pump` at the heard time) | the SDS-V's **hexagonal pads** are a `padsCell` with a hex layout (§13.3); the Pads module's **drum lights** subscribe `DRUM.api(tr).lit` (§6); its **drum REC** goes through a new `DRUM.rec(tr, sound, v, ts)` (the pads' REC branch without its note, §4.4) |
| the note path: `noteOn(n, v, src, ts)` → `targets(src)` (src 0 = the selected track + every armed one), `held` keyed `src:n`, `postTo(t, noteMsg(…))`, `recStart` for armed targets, `inputNote`, `playingUI`; `noteOff` | main.js:1660–1690, 1611–1631 (`recStart` / `recEnd` / `commitNote`), 1736 (`inputNote`), 1728 (`inputSubs`), 4251 (`keyVis`); midi.js:63–67 (`targets`), 73 (`noteCh`) | **two optional parameters**: `noteOn(n, v, src, ts, trs = targets(src), o)` — a pad passes its target track as `trs` and `src = 'pd' + k` (k the Pads host's session number of that track — a string with no `:`, since a track id may hold one, song.js:39: `noteCh` → 0, its own `held` keys); `o.rec` (Q5) and the tray-key light only when `trs` holds the selected track (§4.1). Every existing caller unchanged |
| `ctl(kind, v, src, ts, trs)` (channel aftertouch / bend / wheel to explicit tracks; records into armed ones) | main.js:1698–1709 | **reused**: a pad's Pencil pressure → `ctl('at', v, 0, ts, [t])` (§2.4) |
| the drum host: `drumHost` (per-track entries, `api(tr)`, the `sel()` gate), `DRUM = cvDrum.drumHost({…})` (its `noteOn` dep ignores the track: the selected track's path), `drumMonitor` (`live` only for the selected track while a panel is mounted), `drumOf` (re-normalises a record not of the device's machine) | cv-drum.js:207–435; main.js:1898–1913, 3474–3482, 148–153 | the drum panels' own pads **unchanged**; `DRUM.rec` added (P1); `drumMonitor`'s `live` also true while a shown Pads module lights from that track (H, §6) |
| the project Mod Wheel: one per project (`project.perf.wheel`), **shown on every track's canvas** (`cvDevices` adds it), its position per track (`t.lay.wheel`, Tidy-placed elsewhere), its cables rows `src: 'wheel'` on each destination track, the live value broadcast to every holding track, the "+N on other tracks" chip and its jump menu, `removeWheel` dropping its rows and lay entries everywhere | cv-model.js:364, 403–426; main.js:6363–6370 (`cvDevices`), 6593–6601 (`modOthers`, `modJumpItems`, `modJump`), 5465 (`cvReveal`), 1698–1709 (`ctl` + `wheelTracks`) | **the Pads module's placement model** (§1.1): project-level data, a module on every track's canvas, per-track positions, rows on the destination tracks, "+N on other tracks" |
| modulators: devices in `track.dev`, rows in `track.mods` (`src` `'<dev>.<port>'`, `dst` `'<dev>:<param>'`), `srcOf` / `srcDev` / `perNoteOf` / `sourcesOf`, `srcOk`, `addMod`, `destOk` (a modulator's own controls refused) | cv-mods.js:422–500, 555–576; cv-model.js:355–368, 427–485; song.js:625 (`MSRC`), 644 (`normMods`) | **a project-level source kind `pad`** (`'pd<n>.p<i>'`), resolved like `'wheel'` (§5) — Q's |
| the value table: the first macro module's knobs → macros 0–7; every CC module and further macro knobs → **value sources** k 8–23 (16 per track, `VAL_N`), `{t:'mval', k, v}` from `modVal(t, key, port, v)`, smoothed in ModCore, no repost per value (the content key excludes `vals[].v`) | cv-graph.js:515 (`VAL_N`), 587–608 (`sigOf`), 611–617 (`refreshVals`), 618–676 (`compileMods` / `buildMods`, `take` 643–648); main.js:6522–6529 (`modVal`), 6543–6570 (`modCC`: an externally driven source); mod-core.js:302–307, 328–338 | **a mod pad is a value source** (§5): one value slot per track holding its rows; no DSP change |
| module chrome: fixed sizes from `host.size(key)` (the 2026-10-18 rule: no module is resizable, cv-module.js:14–17), mod modules' tables (`MOD_H`, `MOD_W`, `MOD_ORDER`, `MOD_KINDS` 60–101), inline jacks (a macro's name tiles, `modJacks` ≈ 90–94), `devicesOf` 250–262, `readDevs` 865, `sizeOf` 884–893, `jacksOf` 895–902 | cv-module.js | the Pads module: kind `'mod'`, mod kind `'pads'`, its size from the host (its grid setting, §1.3), inline jacks on its mod pads (§5.4) |
| mod cables: drag from a `data-kind="mod"` jack to a `[data-dest]` knob, the inspector, badges, `MOD_COLOR` by kind, read-only derived audio cables; **a row's cable only when `modSrcPort` parses its src — ports `out` / `k1…k8` only** (cv-cables.js:104–108; `modCables` skips the rest, 320–321) and its colour from a device on the track (`mdev`, 312–313); a module's jacks from `jacksOf` → `modJacks(kind, title)` (no data, cv-module.js:895–902), **a changed jack set rebuilds the module** (cv-module.js:903, 1146) | cv-cables.js:62–78, 104–145, 309–360, 884–1091; cv-module.js:439–485, 895–903, 1146 | pad cables in the pad's colour — U teaches `modSrcPort` / `keyKind` the `pd<n>.p<i>` source and `colorOf` the project's pads, and `jacksOf` reads a Pads module's jacks from its `cvDevices` entry (review #4); **note cables** (derived, read-only) from the Pads module to the instruments it plays on this track, **with no jack on the instrument** (review #13, §9) |
| Sources views from data: `SRC_VIEWS` (hw, flow, serum, drums), sections by model filter / the Modulators block (`o.mods`, `o.modPick` / `o.modDrag`, `setPlaced`; a `multi` tile ignores `setPlaced`, cv-tray.js:317–325, 415–420) / placeholder headings, the Serum part-tile groups `boxOf` (parts, notes — **picked through `o.partPick`**, cv-tray.js:453–470), the remembered view `synth.cv.trayLayout` (an unknown stored id opens Hardware) | cv-tray.js:309–344, 365–371, 387–470, 547–578; main.js:4714, 4826–4835 | **a fifth view `ctl` "Controllers"** with a **Pads** tile through a Modulators-style tile row of its own (`o.ctls`, review #16, §1.2); the Drums view's note changes (§13.4) |
| the drum family: Inst kind `'drums'`, machine-generic (`drOn` builds `Dr808.create(this, p.machine)`, `drGain`, `drSeqMsg` keeps another machine's payload in `drPend`, `mch` a machine change with its tail on its own chain), `drHit` (a note through the payload's map, `DrSeq.DEF_MAP` before one), the monitor `{lit, act, F}` (~33 ms) | engine.js:1356–1377 (`DrumP`), 2163–2216, 2253–2276, 2307–2354, 2834–2836 (`seqMsg`: a payload is a drum one **only when it carries `plan`**), 3316–3388 (`warmDrums`, `warmDrums9`), 4338–4370 (`postMon`) | **the SDS-V rides it** (§11): `DrumP` + its ids, a warm-up round, `trim` passed to the machine like `smp` (engine.js:2275's pattern); its payload carries **an empty plan** (n 0: valid, silent) so it routes |
| `DrSeq` (`valid` — an n = 0 plan is valid —, `set`: map / prim / mute / smp / sync / run / bpm / plan …, `DEF_MAP` = GM: 36 bd, 38 sd, 41 lt, 45 mt, 48 ht …) | dr-seq.js:100–135, 175–207 | **one inert line**: `set` keeps `s.trim` (for `drOn`'s adoption, as `smp`); everything else unchanged |
| the machine shell: `MACH` (a descriptor per machine), `create(inst, kind)` (unknown → null → `drFail`), the interface (`set`, `setOS`, `hit`, `trig`, `render`, `post`, `poll`, `live`, `reset`, `mon`, `smp`, `setSalt`), `gain(kind, d)`, the `Voice` sleep rule (`THR` 1e-5 of the circuit's scale for 4 chunks), latches applied per absolute 4-frame chunk, the hashed noise (`white8`, `noiseWake`), the sample slots (`smpHit`, `smpRender`), the blocks (`kBil` 125, `bil1` / `bil2` 131 / 136, `skHP` 143, `Lin` 161, `hash32` 208), the 909's triangle VCO state machine (each corner reflected inside the sample) and its diode shaper (`Tom9` 2829–2905, `dsh` 2480) | dr-808.js:60–360, 3140–3181, 3407–3522, 3647–3700, 3852–3967 | **`MACH.sdsv`** and a fourth branch at each machine selection, made once at `create` (no 808 / 606 / 909 hot loop changes; 7b's "scalars, not tables, in the loops"); five `CardV` voices on the shared blocks + the triangle core's method; **new**: `Ota4` (the SSM2044, engine.js `Ladder`'s OTA method 110–164 re-written in the machine's scope, as 7c re-wrote the DX7's DAC), the trigger / sensitivity stage, the memories (§12) |
| `drum-core`: `PERS` (a table per machine: `sounds` / `names` 16 long by sound id, `sids`, `mask`, `map` …), `MAPS`, `mach`, `machineOf`, `normDrum`, `payload`, `initState`, `press`, `mapTable` / `primaries` / `drumRows` | drum-core.js:106, 162–190, 224–236, 311–383, 645–690, 740 | **a fourth personality `PERS.sdsv`** with no sequencer (§11.3) |
| models / classes / costs / art / tray / roll / song | models.js:807–837 (`tr909`, `MODELS`); cv-mods.js `FIELD_CLASS` / `CLASS_TABLE` (≈ 177); cv-cost.js:90–91; cv-art.js `SIL` / `DRAW`; cv-tray.js:335 (`DRUMS`); roll.js:53–57 (`drumRowsOf`); song.js:548 (`isDrum` by `PERS`), 570 (`normDrum(d.drum, model)`), 795 (channel 10) | one more entry each; `isDrum`, `drumRowsOf`, channel 10 and every `family === 'drums'` filter take the SDS-V with no edit |
| project format: `deserialize` (song.js:662–720; `perf` at 718), `normPerf` 660, History snapshots the project without its tracks as one JSON (song.js:426–431: a project field is undone with it), `SCHEMA = 10` + `STEPS` (cv-migrate.js:93, 111–133; a newer file opens read-only), `toV1` (211–215: drops `perf` with a lost-line) | song.js, cv-migrate.js, main.js:240 / 257 (`perf` in `loadProject` / `freshProject`) | **`project.pads`** (§10), **schema 11** |
| MIDI in: `requestMIDIAccess()` with no options, every input on one `onmidimessage` (no port identity), `decode` → on / off / pat / cc / bend / at / pc, the dispatch (notes → `H.noteOn(n, v, ch)` → the channel's tracks; `H.modCC` before the CC roles), the Serum CC learn (15 s, Esc), the CC module's learn; **no MIDI output anywhere** | midi.js:29–40, 197, 273–299, 304–337; main.js:2547–2566, 6531–6570 | **per-port inputs, a pad pre-hook, outputs** (§8, M's) |
| clips / scenes | — | **none in the studio** (arrange.js is an overview; song.js "clip" is the clipboard; Serum's CLIP is per instance, sx-seq.js / seq-core.js): **deferred** (§3.6) |

**The binary / three-way machine tests a fourth machine breaks** (each reads an SDS-V as an 808; every one becomes a lookup by the
machine id, the 808 / 606 / 909 answering as today): dr-808.js:3179 (`create`'s `X`), 3181 (`is6` / `is9` / `is8`), 3147–3153
(`gain`), 3856–3866 (`hit`'s guards) and every `is9 ? … : is6 ? … : …` selection V5 lists in §17; drum-core.js:188 (`MAPS`), 190
(`mach`), 377 (`machineOf`), 382–383 (`is606` / `is909`) and every dispatch on `D.m` (`normDrum` 354, `payload` 645, `initState`
680, `press` 740–742, `leds`, `gridPat`, `stepLen`, `demoFree`, `planSess`, `rollPlan` / `rollOpts`); cv-drum.js:163 (`machOf`), 218
(`sessOf`), 157–161 (`UI`) and the per-machine branches of `drumPanel` (the 909's `M` lookups, 7c review #13); main.js:3350
(`drMach`: the SDS-V has no tempo), 148–153 (`drumOf`: already by `d.model`); tests/bench-scenarios.mjs `drumTrack` (three-way).
**And the tests that pin the drum list or the schema** (owners in §14): canvas-7a-sim.test.mjs:68, canvas-7b-sim.test.mjs:77,
canvas-7c-sim.test.mjs:85 and 643, cv-tray.test.mjs:550–553 (its fictional later view `'pads'` is appended after five views now:
the expected menu list, `menu.children[4]` → `[5]`, and 553's section list with the Controllers box; renamed `'later'` for
clarity), 566, 568, 569 (the note's text), **570 (the menu's labels: + Controllers)**, 592, 596, 598, **canvas-sim.test.mjs:518
(the menu's labels, the page sim)**, cv-migrate.test.mjs:28, 1052–1058, 1143–1149, 1229–1236 (`[10, 10]` and `schema: 11` read-only
→ 11 / 12, as 7c moved 7b's), cv-panel.test (`HW_IDS`, `EXTRAS`, `TARGET`, `NOKEYS`, **585: xcapFit's "no other strip changed"
list — the SDS-V's longer caption may need 8 px**), classic-panel.test (a vertical switch the layout binds), cv-mods.test (the
control / class counts), cv-cost.test, cv-art.test, **midi.test.mjs:737 (one shared `onmidimessage` for every input: per-port
handlers replace it)**. (No `tests/song.test.mjs` exists: X's song.js checks go into cv-migrate.test.) (Review #14.)

---------------------------------------------------------------------------------------------------------------------------------

# Part A — the pad controller

## 1. The Pads module

### 1.1 Project data, shown on every track

- A **Pads module** is project data, not a track's device: `project.pads` = a list of ≤ **8** modules [C] (§10.1), ids **`pd1` … `pd8`**
  (the next free number; never the id of a track device — those are `i<n>`, `fx<n>`, `out`, `l/e/m/c/h<n>`, `ve` / `at` / `bd` / `nt`:
  cv-model.js:111, cv-mods.js:429–436). Like the Mod Wheel (D9 of 2a) **it shows on every track's canvas**, its position per track in
  `t.lay.pd<n>` (written on the track where it was placed or moved; Tidy-placed on the others until moved there) [C] — a controller on
  the desk, there whatever track you edit (no question: §16's notes).
- The canvas shows one track at a time (main.js:5040 `cvRender` builds one view for `trk()`): **a pad may play any track**; what it
  plays elsewhere is listed, not drawn (§9).
- The module: kind `'mod'`, mod kind **`'pads'`** — **not** in cv-module `MOD_ORDER` (`MOD_KINDS` is derived from it,
  cv-module.js:67–68, and lists track devices; Tidy already puts a kind outside `MOD_ORDER` after the modulators, cv-module.js:315 —
  review #17); the host lists it, as the wheel; cv-cables `keyKind` (which cv-module's `modKind` is) maps `/^pd[1-8]$/` → `'pads'`
  (cv-mods `kindOfId` / `MOD_LABEL` stay track-device tables); the `cvDevices` entry `{ key: 'pd<n>', kind: 'mod', mod: 'pads',
  model: null, dev: null, jacks: [...] }` after the wheel's, main.js:6365 — `jacks` the module's jack specs from the host's pads
  (§5.4, §9; review #4); a bar (title = its name, "Pads 1" by default; a chip
  "4 × 4"; ⋯; fold ▾; no ⏻ — a Pads module draws no CPU), its body the grid + a footer (§1.3). No audio jack (D3).

### 1.2 The Controllers view

- `SRC_VIEWS` gains, after `drums`, **`{ id: 'ctl', label: 'Controllers', tip: 'Pad grids that play and modulate any track', note:
  'A Pads module plays any track (drum hits, notes, chords) and its pads can modulate any knob. More controllers later.', sections:
  [{ id: 'ctls' }] }`** [C] (cv-tray.js:336–344's form; the menu reads Hardware · Simple · Serum · Drums · Controllers). Its one tile
  row `ctls` is **a Modulators-style tile row of its own** (review #16: not `boxOf`'s Serum part tiles, whose tap is `o.partPick`):
  `o.ctls: [{ id: 'pads', name: 'Pads' }]` in `o.ctlsEl` (a section shown in a view with `ctls`), a tap `(o.ctlPick || o.modPick)('pads',
  mode)`, a drag through `(o.ctlDrag || o.modDrag)`, `setPlaced('pads', reason)` honoured (not `multi`: greyed with "8 Pads modules
  in this project" at 8, never before) — lists **Pads** (an original glyph: a 3 × 3 of rounded squares, one lit).
- A tap places a Pads module (one History step "Add Pads", the 2a `modAdd` pattern: main.js:6666–6689 — the module at the next free
  spot of the modulator column, §1.4); a drag drops it where released (the ghost outline, `modTileDrag`'s — **its size the
  footprint**, not `cvModule.modW` / `modHt` of an unknown kind, 240 × 128, main.js:6630–6700; review #18); the view is remembered
  (`synth.cv.trayLayout = 'ctl'`); an older build reading `'ctl'` opens Hardware (cv-tray.js:389).

### 1.3 The grid: "resizable" as a setting, a fixed footprint

The user's rule of 2026-10-18 — **no module is resizable** (ROADMAP feedback; cv-module.js:14–17) — and the user's "resizable grid"
of 2026-10-19 meet here: **the grid's size is a setting, the module's size follows it** (§16 Q2, answered).

- **Rows 1–8 × columns 1–8** (default **4 × 4**, §16 Q1, answered), **pad size** S 56 · **M 72** · L 96 world px [C], gap 8, padding 16, a
  footer 32 (✎ Edit · ⚙ · the hardware status dot). The module's fixed size (host `size(key)` → `{ fixed: { w, h } }`, cv-module
  `sizeOf` 884–893):
  `w = ceil32(2·16 + cols·P + (cols − 1)·8)`, `h = ceil32(BAR_H 40 + 2·16 + rows·P + (rows − 1)·8 + 32)` — 4 × 4 M: **352 × 416**;
  8 × 8 M: 672 × 736; 8 × 8 L: 864 × 928; 1 × 1 S: 96 × 160.
- Set in **⋯ → Grid…** (a popover: Rows, Columns steppers, Size S / M / L, a live outline of the new footprint on the canvas) —
  one History step per change ("Pads 1: 4 × 8"); the module redraws at its new fixed size, its top-left corner fixed (others may
  overlap: modules move freely, ROADMAP 2026-10-18; Tidy repacks).
- **Shrinking keeps the pads**: pads live in a fixed 8 × 8 space (`pads[r · 8 + c]`, r counted from the **bottom** row) [C]; a smaller
  grid hides rows / columns, it never deletes their mapping (growing back shows them again); a hidden pad plays nothing, keeps its
  hardware binding inert and its mod rows (they hold their source's rest value; the inspector of the pad lists them).
- Numbering [C]: **pad 1 bottom-left**, left → right, then upward (the MPC / Launchpad convention): shown number `r · cols + c + 1`.

### 1.4 Placement, Tidy, delete

- First placement: where tapped / dropped (tap: the modulator column's next free spot, `modSpot` main.js:6630); Tidy puts Pads
  modules in the modulator column after the modulators (x = −ceil32(w + MOD_GAP), cv-module.js:101's rule with its width) [C].
- **Delete** (⋯ → Delete, one step "Delete Pads 1", with a confirm when it has mod rows on any track): the module, its `t.lay` entry on
  every track, and every row `src` `pd<n>.*` on every track (`removeWheel`'s pattern, cv-model.js:416–426); its held notes end first
  (D9).

## 2. Playing

### 2.1 The pointer engine (cv-keys `bed`, lane K)

The grid element is one `bed(el, B, o)` (cv-keys.js:141) with `o.hit = (x, y, s) → { note: padIndex, v } | null` (the pad under the
point and its velocity, §2.2; null in a gap or a hidden pad; `B.w` the grid's width in world px, so the bed's `s` = screen px per
world px), **`o.slide = false`**: a pointer keeps the pad it pressed until it lifts (no glissando onto a neighbour; moving off the
pad keeps it held, as a finger rolling on a real pad) [C], and **`o.each = true`**: **every pointer down on a pad is a hit**
(`o.on` each time; `o.off` once, at the pad's last pointer) — the drum panels' "every finger its own hit" (cv-drum.js:1099–1103, 1110–1117,
canvas-7a-sim "two fingers are two hits"), so a second finger on a held pad, or a roll with two fingers on one pad, plays (review
#2) [C]. Reused as is: per-pointer state, the pads' pointer counts (off when the last leaves), pointer capture, mouse button 0
without Ctrl, no context menu, Pencil pressure (§2.4: `o.at(v, n)`, n the pen's pad — review #10), `release()` / `destroy()`, stale
events after them post nothing. `o.on(i, v, ts)` / `o.off(i, ts)` reach the Pads host (§4). **In Edit mode (§7.1) the body
destroys its bed** (taps select, drags swap: the body's own handlers) and makes a fresh one on leaving. **The 1i default path is
byte-identical** (cv-keys.test's 1i cases unchanged; new cases for the three options and `at`'s second argument).

### 2.2 Velocity

- **By position** (default) [C]: `v = padVel(f)` (cv-drum.js:103: the 1i curve 0.30 at the top edge … 1.0 over the bottom 7 %), f
  the touch's height in the pad from its top — "front edge loud", as the drum machines' pads and the keys (PROPOSAL-drums §2).
- Module setting **Velocity: by position · fixed** (⋯ → Velocity…; fixed 1–127, default 100) — canvas presses only; a pad may carry its
  own fixed velocity (§7.2), which **wins for every source** (canvas, keyboard, hardware: a fixed-velocity pad is the user's choice)
  [C, review #22]. Otherwise a hardware pad's velocity passes through as sent (§8). Space / Enter on a focused pad: 100 / 127
  (`KEY_PAD_V`).

### 2.3 Gestures and zoom (1i §4.3, unchanged code)

- The grid is **`data-gesture="music"`** inside the module's `[data-cv-mod]`: two fingers on pads are two hits, never a pinch (gesture.js
  never pairs two music touches); a finger on the canvas joined by a pad within 250 ms pinches (the standing "two fingers win"); **G2**:
  a thumb resting on the canvas > 250 ms never silences a pad (cv-world `zoneIn(…, 'music')` stops at the module). The bar, the
  footer and the gaps are not music: a pinch starting there zooms.
- Pads **sleep below 50 % zoom** like every control (double-tap the module to wake; the `sleeptap` hint "Zoom in, or double-tap the
  module, to play it" — main.js's existing notice text gains "module" for a Pads module [C]). Hardware pads (§8) never sleep.
- The cells' classes never match cv-module's `BG_SEL` (a one-finger press plays, never pans).

### 2.4 Apple Pencil pressure

While a `pen` pointer holds a pad, `at = clamp((pressure − 0.15) / 0.85, 0, 1)` (cv-keys `AT_FROM`) ≤ once a frame, 0 at the last pen
lift (the bed's own) — reported as **`o.at(at, n)`**, n the pad the pen holds (the bed's `o.at(v)` alone names no key, cv-keys.js:159–
164, and fingers may hold other pads: review #10). What it does, per that pad's targets [C]: a **note / chord** target → channel aftertouch to its track
(`ctl('at', at, 0, ts, [t])`, main.js:1698 — the same message a MIDI keyboard's aftertouch is; the CS-80 / Serum read it, the others
record and show it); a **drum** target → nothing (no drum machine reads aftertouch); a **mod** pad in *pressure* mode → its value
(§5.2). Fingers and the mouse carry no pressure (1i §4.4). Two pens: one Pencil (iPad).

### 2.5 Keyboard and accessibility

The grid is one `role="group"` "Pads 1" of `role="button"` pads with a roving tabindex (one tab stop; 64 would be a trap, 1i §4.5) —
the drum panels' `padsCell` pattern (cv-drum.js:1081–1090); a `role="grid"` would need `role="row"` wrappers (review #21): arrows
move the focused pad (a ring drawn only after keyboard use, 7c review 2 F5's rule), **Space / Enter held = the pad held** (velocity
100 / 127), Escape releases. Each pad has `aria-label` "Pad 3: Kick, Drums (TR-808)", `aria-pressed` while held; the lit state is not
announced (it changes many times a second). A pointer-focused grid gives Space / arrows back to the page (main.js `kbFocus`'s rule).

## 3. Targets

### 3.1 The pad record (per pad of the 8 × 8 space; §10.1 for the bounds)

```
{ c: 0–15,                       colour (§6.4)
  l: '' | ≤ 12 chars,            label ('' → from its first target: "Kick", "C3", "Cm7", "Mod")
  t: [≤ 4 × target],             what a hit plays, in order (layering: a kick on the 808 and a sub note on the Juno) [C]
  mod: null | { m: 'gate' | 'vel' | 'press' | 'tog', lo: 0–1, hi: 0–1 },   a modulation source as well (§5)
  v: null | 1–127,               a fixed velocity for this pad (null: the module's rule)
  latch: 0 | 1,                  note / chord targets: a tap holds, the next tap releases [C]
  hw: null | { port, ch: 1–16, n: 0–127, cc: 0 | 1 } }   a learned hardware pad (§8)
target = { k: 'note', tr, n } | { k: 'chord', tr, root, q, inv, oct, spread } | { k: 'notes', tr, ns: [≤ 8] } | { k: 'drum', tr, s }
```

`tr` a track id (`trk_<n>` in practice; song.js:39's `validId`). A pad with no target and no `mod` is **off** (dark, plays nothing).

### 3.2 Note and chord

- **note**: MIDI note n 0–127 on track `tr` (its instruments by their key zones, as a keyboard note).
- **chord** [C]: `root` 0–127, quality `q` ∈ maj · min · 7 · maj7 · m7 · dim · dim7 · aug · sus2 · sus4 · 6 · m6 · add9 · 5 (power), `inv` 0–3,
  `spread` close · open (the third up an octave), `oct` −2…+2; resolved by pads-core `chordNotes(target)` (sorted, unique, notes outside
  0–127 dropped, ≤ 8). **notes**: a custom list (the inspector's "Custom…"). A chord's notes go out together (no strum [C]: later).
- A monophonic target (TB-303, a mono Minimoog) plays a chord as the instrument plays any chord (1e's mono-chord warning applies, once).

### 3.3 Drum hit

`{ k: 'drum', tr, s }`: sound key `s` of the drum machine on track `tr` (`PERS[model].sounds`: the 909's `rd` / `cr`, the SDS-V's
five, §11.2). At the hit the host resolves its **note** = the machine's map primary `D.map[s][0]` (drum-core `primaries`; the record
by `drumOf`) and plays it on `tr` (§4); the machine receives it as every note (`drHit` → `dm.hit(sound, v127)`: the velocity becomes
the trigger volts / the 909's accent states / the SDS-V's pad volts — the "real accent tone"). A target whose track no longer holds a
machine with that sound (a Replace, a deleted track) plays nothing and shows a warning dot on the pad ("no Kick on “Drums” any
more") [C].

### 3.4 Modulation (§5)

`mod` makes the pad a **modulation source** cabled like the other modulators; a pad may be a source and play targets at once (a kick
pad that also ducks a filter) [C].

### 3.5 Defaults and Fill from… (§16 Q3)

A new Pads module **follows the track it is added on** (Q3, answered): a drum machine → its sounds in its own pad order (cv-drum `UI[m].pads`:
the 808's `PAD_ORDER` 4 × 4 with the kick bottom-left, the 606's 8, the 909's 12; the SDS-V's five — bass drum, snare, toms 1 · 2 · 3, the panel's channel order
(lead, after review 1 F / 2 F7; short labels, each pad in its channel's kit colour) — on the bottom row) on a grid of that machine's pad shape; any other instrument → a chromatic run from C3 (48) on that track, 4 × 4.
Review #23: the orders live in cv-drum (`PAD_ORDER` cv-drum.js:92, `PAD6`, `PAD9`), which pads-core (a leaf) does not import — the host
passes them: `defaultsFor(track, D, order, cols)`; they list **the top row first** (left → right), the Pads numbering starts
**bottom-left**, so row r of the order lands on grid row `rows − 1 − r`; the 606's and the 909's **`ac`** cell (the panels' accent
hold, no sound key) is an **empty pad** [C] (any pad at v 127 is the accent); the SDS-V's shape is **1 × 5** [C].
Colours by family (§6.4). **⋯ → Fill from…**: a track (its drum sounds, or chromatic / a scale — major, minor, pentatonic — from a root)
onto the visible pads, one step with "tap to undo".

### 3.6 Clips and scenes — deferred

The studio has **no clip or scene launcher** (§0): the target menu does not offer one. A Serum's own CLIP slots launch from notes in
their trigger octave (seq-core.js), so a **note** pad on that Serum's track already launches a clip slot. A studio clip launcher is a
later stage; a `{ k: 'clip', … }` target joins then (the record's `t` is a list of tagged entries: additive).

## 4. The note path (lane H)

### 4.1 Pads → tracks

The Pads host (`cv-pads.padsHost`, §7.4) owns every pad's held state, independent of any DOM (hardware pads play with the module off
screen). On a hit it resolves the pad's targets to `(track, notes, velocity)` and, per target track `t`, **reference-counts per (t,
note)** over every pad, pointer and hardware pad holding it: **every hit sends** (a note already held is re-struck: main.js's
`noteOn` ends its `held` key and plays it again, main.js:1665 — a recording gets two notes), **the last release ends** [C, D9;
review #2: "the first holder sends" swallowed a second finger's, a second pad's or a second hardware pad's hit on the same drum].

- Send: `noteOn(n, v, 'pd' + k, ts, [t], { rec })` (k: the host's session number of track t) — main.js's own path with **explicit
  targets** (§0): `held` keyed `pd<k>:<n>` (never sharing an entry with the keyboard's `0:n`), `postTo(t, noteMsg(…))` (a drum track's every Inst by its key zone,
  as today), `recStart` (§4.3), `inputNote(t, …)` (the track's Velocity / Note modules, a Serum's render-last group, `inputSubs`),
  `playingUI`. The tray's key light only when `[t]` holds the selected track.
- End: `noteOff(n, 'pd' + k, ts)`. PERF's `held` dep and `perfLetGo` (main.js:1892, 1915) read only the numeric-source keys, so a pad's note on
  another track never lights the selected synth's key bed.
- **Never** the selected track by default: a pad on the 808 plays the 808 while a Juno is selected, and only the 808 (an armed Juno
  hears nothing of it) [C — the pad names its track; the existing `targets(0)` rule is the keyboard's].
- A note to a track whose node is not built yet (`postTo` queues; `powerOn` as `noteOn` does) behaves as a keyboard note.

### 4.2 The selected track and stale views

A Pads body is a view of the host: a pad pressed on the canvas of track A plays the pad's targets whatever A is; a body destroyed
mid-press (track switch, re-render, Undo) releases its pointers through the bed (`destroy` → `release`), and the host ends those notes
(D9). `PADS.release()` joins `PERF.release()` at main.js's sites (`panic`, power off, `visibilitychange` hidden, window `blur`,
`applyRestore`'s top, `deleteTrack`) — a blur / hidden page keeps a *hardware* pad's note until its note-off (1i review F4's rule:
`perfLetGo`).

**The host alone ends `pd<k>:<n>` keys** (review #7). main.js's generic loops over `held` parse the source as a number —
`panic` (main.js:1759) and `selectTrack` (1831) call `noteOff(+n, +src)`, NaN for a pad key (skipped by accident today), `powerOff`
(970) deletes every key — so a fixed loop would end a pad's notes behind the host and leave its counts stale (the next hit of
that note sends nothing). The rules: `panic` and `powerOff` call **`PADS.release({ hw: true })`** (every note, hardware ones too,
counts reset) **before** their loops; `selectTrack`'s loop **skips non-numeric sources explicitly** (a hardware pad held across a
track switch keeps sounding; the canvas pointers end with the old body's `destroy`); a stale key light: `noteOff`'s `keyVis(n,
false)` test (1689) and `buildKeys`' lit set (4178) count only keys that reached the selected track (a numeric source, or a pad key
whose `held` entry names the selected track) — else a tray key stays lit while a pad on another track holds its note.

### 4.3 Recording into the roll (§16 Q5)

- Pad notes record through `recStart` / `recEnd` → `commitNote` on **the target track** (main.js:1611–1631): the take, input quantize,
  replace mode as any input.
- **Which tracks record** (Q5, answered): **a pad's target track records its hits whenever recording runs, armed or not** (a pad
  names its track; finger-drumming the 808 from a Pads module while the Juno is selected is the main use): `o.rec = 'target'`.
- **Replace mode and aftertouch follow the same rule** (review #8): today `replaceSweep` wipes armed tracks only (main.js:1645–1655)
  and `recCC` records into armed tracks only (1632–1643), so a non-armed target would overdub in replace mode and drop its Pencil
  aftertouch. H keeps the take's pad-recorded tracks (`T.padRec`, filled by `recStart` from a pad source, cleared with the take)
  and both functions take them with the armed ones.
- Pencil aftertouch records as the target track's `at` lane (`recCC`). Mod pads are not recorded (no automation lanes for canvas
  sources yet) [C].

### 4.4 Drum REC into the machine's pattern

A drum target on a machine whose **REC** extra is on (`D.x.rec`) also writes its lane at the nearest step: `DRUM.rec(tr, sound, v,
ts)` (cv-drum host, P1) = the pads' REC branch (`press(e.tr, { k: 'pad', sound: i, f: frac(e, D, ts), v })`, cv-drum.js:396) without
their note and without the `sel()` gate — the machine's own rules decide (the 808's selected mode, the 606's accent at v 1, the 909's
four states by velocity; the SDS-V has no REC). Both happen: the pattern write and, when recording runs, the roll note (as the panel's
pads today).

## 5. Pads as modulation sources (lane Q; host H)

### 5.1 The source

- A pad with `mod` ≠ null is the source **`pd<n>.p<i>`** (i the pad's slot 0–63; `MSRC` song.js:625 already accepts it) [C], scope
  **project**, label "<module name> · <pad label or 'Pad k'>". cv-mods: `srcOf` parses it as any `<dev>.<port>`; **`srcDev(t, src)`
  returns `{ q, dev: null, kind: 'pad' }` for a `pd<n>.p<i>` id without looking at the track** (the wheel's pattern, cv-mods.js:456);
  `perNoteOf` → false (GLOBAL); a Serum row from a pad therefore takes an ext slot through `planSerum` with no edit there (cv-graph.js:439–470: any non-native, non-per-note source with a `srcDev` gets `extId`); `sourcesOf(t, p)` lists every mod pad of `p.pads` after the wheel; `srcOk(t, src, p)` (cv-model.js:365)
  → the module exists and that slot's `mod` is on (a hidden slot too: its rows stay, §1.3). `destOk` unchanged (a Pads module has no `[data-dest]`).
- Rows are ordinary `track.mods` rows on the **destination** track (`{ src: 'pd1.p12', dst: 'i1:vcf.cut', … }`): the inspector, Bypass,
  the Mod list, halos — all as today.

### 5.2 The value (pads-core `modValue`, the host's)

| mode | press | while held | release |
|---|---|---|---|
| **gate** | hi | hi | lo |
| **vel** (default) | lo + (hi − lo) · v | — | lo |
| **press** | lo (until pressure) | lo + (hi − lo) · at (Pencil, ≤ once a frame; a hardware pad's poly pressure) | lo |
| **tog** | flips lo ↔ hi | — | unchanged |

`lo` 0, `hi` 1 by default; the toggle's state is session-only (a reload starts at lo) [C]. ModCore smooths every value change (its
macro / value glide, mod-core.js:328–338): a pad is a fast macro, not a sample-accurate gate (values carry no frame) — said in the
inspector's note [C].

### 5.3 Compile and posts

- `compileMods` (cv-graph): a pad source in `need` takes a **value slot** (`take(id, 'val')`, after the track's modules, pad ids sorted:
  deterministic) → `vals` entry `{ k, src, v, id: 'pd1.p12' }`; past 16 the row is `left` with why `'slots'` ("This track's value
  sources are full (16/16)" — shared with CC modules and second macro modules; cv-graph.js:646) [C]. The initial `v` and `refreshVals`
  read `o.padVal(id)` (the host's live value; absent → the pad's `lo`). `sigOf` hashes rows only (the pad's mode / range are the
  host's): **a press never reposts the payload**; a track without pad rows compiles byte-identically (D5).
- A value change → for every track holding rows of that source (`padTracks(project, src)`, cv-model, the `wheelTracks` pattern) →
  `modVal(t, 'pd1', 'p12', v)` (main.js:6522: the entry's `k` per track) [C]. **A press's and a release's values post at once**
  (never coalesced: a hardware note-on / note-off pair inside one frame would otherwise post only the release, and the tap would
  never reach the table — review #11); only pressure moves coalesce, ≤ one post per source per frame. (ModCore's glide, `kM` =
  1 − e^(−4 / (base · 0.006 · smooth)) per chunk, sx-mod.js:809: a 6 ms time constant at smooth 1 — a 20 ms tap reaches ≈ 96 %.)
- A row whose source's module no longer exists (a hostile or partial file: srcDev's pad branch does not read the project) is
  dropped at load with the module check (H, after `normPads`), as `removePads` drops them on delete (review #28).

### 5.4 Jacks and cables

Each mod pad carries an **inline jack** — its anchor `[data-jack="p<i>"]` a **corner dot, a child of the pad, never the pad element
itself** (review #20: cv-module moves `data-cv-jack` onto the anchor, cv-module.js:479–482, and cv-world takes a press inside a
`[data-cv-jack]` as a cable drag, cv-world.js:1135–1143 — an anchored pad would start a cable instead of a hit); the macro's
name-tile precedent (`side: 'inline'`): drawn and pressable **only in Edit mode** (in play mode the dot is transparent and
`pointer-events: none`, never `display: none` — cv-module still measures it); the cable is drawn from it in both modes. A
**hidden** mod pad (a smaller grid, §1.3) keeps its jack in the set (no rebuild at a Grid… change) with its fallback dot hidden too
(cv-module.js:483 shows it when no anchor is found: U adds the spec flag `hide`); its cable ends at the module's right edge at the
bar's height. Dragging a jack onto any `[data-dest]` knob of this track's canvas makes a row (the 2b flow, cv-cables `pressMod` →
`onMod` → `modConnect`); cables take **the pad's colour** (§6.4) instead of `MOD_COLOR[kind]`. The pad's inspector lists its rows on
every track ("+2 on other tracks" with the jump menu, §9).

What cv-cables / cv-module learn for it (U; review #4): `modSrcPort` (cv-cables.js:104–108, today `out | k1…k8` only — every pad
row would be skipped by `modCables`, 320–321) accepts `p0…p63` on a `pd<n>` key; `keyKind('pd<n>') → 'pads'`; `colorOf` takes a
`pd<n>` key's colour from `o.project.pads` (its `mdev` finds nothing on the track, cv-cables.js:312–313); cv-module `jacksOf`
reads a Pads module's jacks from its device entry (`DM.get(key).jacks`: the mod pads' `p<i>` inline jacks and the `notes` jack,
§9) — `modJacks(kind, title)` has no data (cv-module.js:895–902). The set changes only when a pad's Modulation is switched on or
off (Edit mode): the module rebuilds then (cv-module.js:1146; the host keeps every held note, §4).

## 6. Lights

### 6.1 Levels

A pad shows its colour at four levels [C]: **off** (no target: dark grey), **idle** (its colour at 22 %), **lit** (100 %, a short
glow), **held** (100 % + a white inner ring). `prefers-reduced-motion`: no glow transition. Lit decays to idle over 120 ms after its
cause ends [C].

### 6.2 What lights a pad (module setting "Light: on hit · following its target · both", default **both**) [C]

- **Its own hit** (canvas or hardware): at the press, at once (the hand needs it now; the sound follows within the output latency).
- **Its target's activity, at the heard time** (7a §3.6's rule: lights follow the speakers, not the worklet):
  - **drum targets**: the machine's monitor `lit` bits (every hit of that sound: its own sequencer, roll notes, other inputs, sample
    hits) — the Pads host subscribes `DRUM.api(tr).lit(fn)` for each drum track it targets while the module is shown (`cvLive`); H
    extends `drumMonitor`'s `live` (main.js:3479: today `selTrack === id && cvLive(dev)`) with `|| PADS.wants(id)` — a shown Pads module
    lights from that track — so a non-selected 808 still posts its monitor while needed, and stops when not [C];
  - **note / chord targets on other instruments**: live input notes of the track (`inputSubs` of the track, key `'pd<n>'`: the tray,
    MIDI, other pads — main.js:1728, 1736) and **roll playback**: the host's per-frame check of the track's notes at the heard tick
    (`curTick()`; per track a pitch → sorted-notes index rebuilt when `t.notes` changes, perfValue's U13 cache pattern) — a pad is lit
    while one of its notes sounds there [C]; a drum track uses its monitor only (no double light);
  - **mod pads**: brightness = the source's value (idle 22 % at lo … 100 % at hi).
- ≤ **one paint a frame** for the whole module (a dirty set flushed in one rAF; attributes `data-lit`, a CSS custom property for the
  value) [C]; nothing scheduled while nothing changes (D6).

### 6.3 Hardware lights (§8.4)

Every state change of a learned pad is echoed to its hardware pad, coalesced per frame.

### 6.4 Colours [C]

16 swatches of our own (each with an idle and a lit tone, contrast-checked on the light and dark canvas): red, orange, amber, yellow,
lime, green, teal, cyan, sky, blue, indigo, violet, magenta, pink, white, grey. Defaults by target: kick red, snare orange, toms amber,
hats / cymbals cyan, other percussion green, notes violet, chords magenta, mod-only teal. The colour is the pad's light, its cable and
its hardware light (nearest palette entry, §8.4).

## 7. Mapping UI (lane U)

### 7.1 Edit mode

The footer's **✎ Edit** (or ⋯ → Edit pads) toggles the module's mapping mode — **its own attribute `data-pads-edit` on the body**,
never `[data-cv-edit]`, which is cv-world's camera edit state (set and cleared at selection / focus, cv-world.js:898–958; read by
gesture.js:84 for `own` zones — review #3): pads stop playing (hardware pads still
play), a tap **selects** a pad (Shift / a second finger adds to the selection; the selection highlighted), the inspector opens beside
the module; mod pads show their jacks. Drag a selected pad onto another: **swap** (Alt / a long press first: copy) [C]. Drag a pad
onto an instrument module of this canvas: its first target's track becomes that track (a drum machine's own pad: that sound) [C].
Escape or ✎ leaves.

### 7.2 The pad inspector (one popover; edits apply live; one History step per field gesture, "Edit pad 3")

Type per target row: **Note · Chord · Drum · Off**, + "Add target" (≤ 4); **Track** (the project's tracks by name and model, "this
track" first); Note (a note name + octave stepper, and **"Play it"**: the next note from the tray / a MIDI keyboard / a bed sets it —
the drum MAP…'s learn pattern, `inputSubs`); Chord (root, quality, inversion, spread, octave; Custom… a note list); Drum (the machine's
sounds by name, `PERS[m].names` of its `sids`); **Modulation** (off · gate · velocity · pressure · toggle; lo / hi; its cables:
"Drag the pad's jack onto a knob", the list of its rows; **switching it off with rows on any track asks, then removes them in the
same step** [C, review #31]); **Velocity** (module's rule · fixed n); **Latch**; **Colour** (the 16);
**Label**; **Hardware** (§8: Learn · Forget · "Ch 10 · note 36 · <port name>"). A selection of several pads edits the fields they share
(Colour, Velocity, Track: one step).

### 7.3 Module settings (⋯)

Edit pads · **Grid…** (§1.3) · **Velocity…** · **Light…** · **Fill from…** (§3.5) · **Clear pads** (one step, "tap to undo") · **Pad
shape: square · hexagon** (hexagons a cosmetic clip of each cell — the SDS-V's look —, hit boxes unchanged) [C] · **Hardware
controller…** (§8) · Rename · Fold · Delete. Every one undoable.

### 7.4 Modules (who owns what)

- **`pads-core.js`** (new, pure, node-tested; K): `normPads`, the grid geometry (`padAt(G, x, y)`, `footprint(rows, cols, size)`), the
  numbering, `chordNotes`, the velocity laws, `modValue`, target resolution against a project (`resolve(pad, project, drumOf)`), the
  defaults and Fill from… (the machines' pad orders passed in, §3.5), the colour table, the hardware bindings (`bindOf`, `rebind` —
  one binding per (port, ch, n, cc)), the generic light-back encoder (§8.4).
- **`cv-pads.js`** (new; U): `padsHost(deps)` (the held state, reference counts, lights, the hardware echo; deps: `noteOn`, `noteOff`,
  `ctl`, `modVal`-by-source, `drumRec`, `drumLit(tr, fn)`, `inputSub(tr, fn)`, `heardTick()`, `hwOut(port, bytes)`, `project()`,
  `drumOf`, `raf`, `now`) and `padsBody(o)` (the grid DOM through `cv-keys.bed`, the footer, the inspector, the settings popovers, the
  CSS once per document by `ensureCSS`, cv-keys' pattern — no style.css edit).

## 8. Hardware pad controllers over Web MIDI (lane M; host H; UI U)

### 8.1 What is feasible [R]

- **Web MIDI exists in Chrome / Edge (and Firefox) on the Mac; it does not exist in Safari or in any iPad browser** (every iPad browser
  is WebKit; caniuse lists iOS Safari as unsupported through its current versions; WebKit's bug 107250 is open) [R RV §8]. So hardware
  pads work on the Mac only; on the iPad the Hardware items say so ("Hardware pad controllers need a browser with Web MIDI — Chrome or
  Edge on a Mac. iPad browsers have none.") and are disabled [C].
- **Input**: any controller whose pads send note-on / note-off (most do: MPC-style, Launchpad, APC, Maschine in MIDI mode, the
  drum-pad sections of keyboards) — velocity as sent; poly aftertouch where the pads send it; pads that send CC (some "button" modes)
  learn as CC (value > 0 = press, 0 = release) [C].
- **Output (lights)**: `requestMIDIAccess()` without options already gives `outputs` (no SysEx; the same permission prompt Chrome
  shows for inputs — the adapter already handles it, midi.js:308–329). Pad LEDs that follow incoming notes are the common
  convention: the controller lights the pad of note n by an incoming note-on on its note, many devices choosing a colour or a
  brightness by the velocity. Devices whose pads light only from their own hits cannot be lit; SysEx-only devices are out of scope
  [C]. **No SysEx is requested** [C]; **no device profile is built** (Q6 answered: the user owns no controller yet — one generic,
  documented scheme, §8.4; a device's profile is a later, additive `prof` value).

### 8.2 Inputs, per port, and the pre-hook (midi.js, M)

- Each input gets its own handler (`inp.onmidimessage = e => message(e.data, e.timeStamp, inp.name)`; hot-plug re-hooks, as today) —
  midi.test.mjs:737's pin of one shared handler changes with it (M's file; review #14). A port is named by `inp.name` [C] (two
  identical controllers share a name: their bindings match either — said in the dialog).
- **Ports going away** (review #9): the `statechange` hook (midi.js:312–318) re-hooks the inputs but tells nobody that one left, so
  D9's "a MIDI input unplugged" had no signal. After each hook the adapter calls the optional **`H.ports(names)`** (the input names
  now); the host ends the notes of every hardware pad whose port is gone. (There is no "disable MIDI" in midi.js: that D9 / §8.4
  case is dropped.)
- **`H.padIn(e, port, ts) → true | false`** (optional host hook) runs first for note-on / note-off / poly pressure / CC: true = the
  message was a learned pad's (or a learn took it) and goes **nowhere else** (not to the channel's tracks, not to CC learn); false =
  today's dispatch unchanged. Without the hook, midi.js behaves byte-for-byte as today (its tests).
- **Outputs**: the adapter keeps `MIDIAccess`, exposes `outputs()` (names) and `send(port, bytes)` (a no-op for a missing port; never
  throws) [C]. The button text keeps listing the inputs.

### 8.3 Learn

- Per pad (the inspector's **Learn**) or **Learn all** (⋯ → Hardware controller… → "Learn the visible pads in order": the next
  hardware pad hit binds pad 1, the next pad 2 … — the canvas pad to learn pulses; Escape stops): binds `{ port, ch, n, cc }` of the
  next note-on (or CC with value > 0). A binding is unique across the project: learning one already bound elsewhere moves it (that pad
  shows "moved to Pads 1 · pad 7"). 15 s timeout, Esc cancels (midi.js's learn rules, midi.js:15–16, 207–213) [C].
- One History step per learn ("Learn pad 3"); stored with the project (§10).
- A port that is absent today keeps its bindings (they match again when it is plugged in); a binding with port `''` matches any port.

### 8.4 Light-back (module setting; default **Off**) [C; Q6 answered: generic only]

| setting | sends, per learned note pad (a CC-learned pad is never lit) |
|---|---|
| **Off** | nothing |
| **Note velocity (generic)** | lit / held: note-on on its learned channel and note, velocity **127**; idle and off: note-on velocity **0** |

The scheme is documented in the dialog in one line ("Lights the pad of each learned note by sending that note back at velocity 127
— works with controllers whose pads light from incoming notes"). The output port: the input's name by default (controllers present
an input and an output of one name), chosen in the dialog. Echoes are coalesced per frame (≤ one message per pad per frame) and
limited to state changes; on module delete, page hide or a switch to Off: every learned pad is sent velocity 0 once.
`project.pads[].out.prof` is `'off' | 'gen'` (a device profile later is one more value: additive).

## 9. Cables on the canvas

- **Mod cables** (§5.4): editable, from the pad's jack, the pad's colour.
- **Note cables** [C]: derived and read-only (as audio cables since 1f), one per instrument of **this** track that any pad of the
  module plays, from the module's right edge (a `notes` jack, kind `'note'`, **always in the Pads module's set**) to **a fixed point
  on the instrument module's left edge** (`BAR_H + JACK_Y`, from the module's rect — **no jack on the instrument**: a jack shown only
  while a note cable ends there changes its jack set, and cv-module rebuilds a module whose set changed, cv-module.js:903 / 1146 —
  a hardware face re-mounted and its beds released at every mapping edit; review #13); dashed, the module's first such pad's colour;
  tapping one selects it and lists its pads. Pads that
  play **other** tracks: the module's chip "+3 on other tracks" with the jump menu (`modJumpItems`' pattern: select the track, reveal the
  module there) [C].
- Drawn by cv-cables like the others (body under, ends over); **not** shown in `?nogl` differently; a fold keeps jacks outside the bar
  (the 1c rule).

## 10. Project format, schema, undo

### 10.1 `project.pads`

```
pads: [≤ 8 × { id: 'pd1'…'pd8', name: ≤ 24, rows: 1–8, cols: 1–8, size: 0 | 1 | 2, vel: 'pos' | 'fixed', fv: 1–127,
              light: 'hit' | 'follow' | 'both', shape: 'sq' | 'hex', out: { prof: 'off' | 'gen', port: ≤ 64 },
              pads: [64 × pad | null] }]                                     (pad: §3.1; null: an empty pad)
```

pads-core's `normPads` (K; a leaf importing only drum-core, so song.js may import it as it imports drum-core, song.js:10):
exact lengths, every field bounded, ids unique and in `pd1…pd8`, targets ≤ 4 with valid shapes (track ids by
song.js:39's `validId`, sound keys `/^[a-z]{2}$/`, note lists ≤ 8), a hardware binding unique across the project (later duplicates dropped),
unknown fields dropped, idempotent, never throws; anything else → `[]`. A target naming a track that does not exist is **kept** (Undo
may bring the track back) and plays nothing [C]. song.js `deserialize` (X) keeps `project.pads` through it (song.js:718's `perf` line's pattern; main.js:240
/ 257 copy it in `loadProject` / `freshProject`); `t.lay.pd<n>` is an ordinary lay key (`normLay`, song.js:518–536).

### 10.2 Schema 11

`cv-migrate.SCHEMA = 11`, `STEPS[10]` additive (`p => Object.assign({}, p, { schema: 11 })`), its header line "10 → 11: the pad
controller (project.pads) and the SDS-V (a 'sdsv' device and its drum record)" — **one bump for both parts** (a schema-10 build would
drop `project.pads` and read `sdsv` as a Minimoog on autosave: with the bump it opens such a project read-only). The pins that move
(§0) are X's. `toV1` drops `pads` with the lost-line "the Pads controllers (N)"; an SDS-V track's line names the model ("SDS-V track
“Drums”: the live site has no drum machine — its piano-roll notes are kept", cv-migrate's existing drum line).

### 10.3 Undo

Every mapping, settings, placement, learn and delete edit is one History step (the project snapshot holds `project.pads`: song.js
426–431); presses, lights, toggles' states and hardware traffic are never steps. Destructive ones (Clear pads, Fill from…, Delete)
get "tap to undo" (7a §13 answer 3's rule). After Undo / Redo / load the host rebuilds from `project.pads` (held notes ended first,
D9).

---------------------------------------------------------------------------------------------------------------------------------

# Part B — the Simmons SDS-V

## 11. The fourth machine in the family

### 11.1 Why the drum family (not a classic instrument)

The SDS-V is a set of drum voices hit by triggers (RV §1–§2), like the Roland machines minus the sequencer — so it joins the **drums
kind**: notes → hits through a note map (GM drum notes, the roll's named rows, MIDI channel 10), "load your own" sample slots, the
monitor's lights, the pads in its extras strip, the Drums view, the 4-frame chunk determinism and the sleep rule. A classic
`AVoice` instrument would need polyphony, key tracking and envelopes per note that make no sense for five fixed drums [C].

### 11.2 The model `sdsv`, sounds and notes

- `models.js` gains **`sdsv`** after `tr909` (every earlier index unchanged): `name 'SDS-V'`, `model 'Drum synthesizer'`, `maker
  'Simmons'` (a label, never on the panel or tile, D4), `year 1981`, `family: 'drums'`, `tag 'Analog drum synthesizer · bass drum,
  snare and three toms · four memories per drum · played from pads, no sequencer'`, `about` ("Our circuit-level model of the SDS-V's
  drum voices — oscillator, noise through its 4-pole filter, bend, click — with our own factory sounds; no recordings of any
  instrument. …"), `theme`, `presets` (§12.6).
- **Five channels on the 808's sound ids** [C, D8]: **bass drum 0 (`bd`), snare 1 (`sd`), tom 3 2 (`lt`), tom 2 3 (`mt`), tom 1 4
  (`ht`)** — tom 1 the highest, as on the kit's drum names; their names `'Bass drum', 'Snare drum', 'Tom 3 (low)', 'Tom 2 (mid)', 'Tom 1
  (high)'`. `PERS.sdsv.sounds` / `names` stay **16 long** (ids 5–15 keep the 808's keys, inert: `[]` in the map, never a slot, row or
  `sids` member — 7c review #12's rule); `sids = [0, 1, 2, 3, 4]`.
- **The map** (`PERS.sdsv.map`): GM — `bd [36, 35]`, `sd [38, 40]`, `lt [41, 43]`, `mt [45, 47]`, `ht [48, 50]` = `DrSeq.DEF_MAP`'s for
  these ids, so a note before the first payload already plays the right drum (engine.js:2256) [C].
- **Controls** — 40 knobs + 5 switches (`K(id, label, 0, 10, def)`, `S(id, label, opts, def)`), ids `x` + channel + field [C]:
  channels **`b` `s` `1` `2` `3`** (bass, snare, toms 1–3); fields **`n`** NOISE, **`t`** TONE, **`b`** BEND, **`d`** DECAY, **`m`** NOISE /
  TONE, **`c`** CLICK / DRUM (the card's six, RV §2.1), **`s`** SENSITIVITY, **`l`** LEVEL (the mixer's two, RV §1), **`p`** the memory
  (switch: `['1', '2', '3', '4']`, def `'2'` — the knobs, §11.5). E.g. `xbn`, `x2d`, `x3p`. Defaults: the knobs = memory 1's values
  (the panel starts sounding like the factory sound), SENS 5, LEVEL 7 [C]. **`map`** → `{ engine: 'drums', machine: 'sdsv', drum: {
  …every knob 0…1, every switch its index… }, level: 1 }` (7b §1.1's shape). The ids are new to `FIELD_CLASS` (knobs `proc`, the
  switches `struct`) [C].

### 11.3 No sequencer: the record and the payload (lane S5)

- **The record** (`dev.drum` of an `sdsv` device; `normDrum(d, 'sdsv')`, the machine `model ?? d.m`, `'sdsv'` only for the exact
  string):
  ```
  { v: 1, m: 'sdsv', keys: [], ui: {}, x: { sync: false, swing: 50, mute: 0, solo: 0, rec: false, part: 0 }, map: {…}, smp: {…},
    trim: [5 × [2 × [6 × 0–1]]] }       memories 3 and 4 of each channel (§11.5), channel order b s 1 2 3, field order n t b d m c
  ```
  `keys: []` (an empty array: cv-drum's `mem()` gate, cv-drum.js:212, and main.js's `drumOf`, 151, read it as a record), `ui` empty,
  `x` the shared shape with `sync` / `rec` fixed false (normDrum forces them), `trim` exact lengths, values clamped, default our own
  two settings per channel [C]. The 808's / 606's / 909's records unchanged (D1 pins).
- **The payload** (`payload(D, S, at)` on an SDS-V record): `{ m: 'sdsv', plan: EMPTY_PLAN, sync: false, run: false, bpm: 120, swing:
  50, at, tap: 0, map, prim, mute, smp, trim, pk }` — **`EMPTY_PLAN = { key: 'v0', n: 0, loopFrom: 0, mKey: [], mVar: [], mPre: [], mL1:
  [], mOff: [0], mT: [0], st: [] }`** (valid for `DrSeq.valid`, dr-seq.js:115–131: n 0; a plan is what makes engine.js:2835 route the
  payload) — S5 proves it valid, silent and allocation-free in DrSeq (§15.4); `pk` hashes `m` and `trim` (7b review #3's rule).
- **`press(S, D, input)`** for an SDS-V: `map`, `mapReset`, `smp`, **`trim`** (`{ k: 'trim', ch, mem: 3 | 4, f, v }` and `{ k:
  'trimFromKnobs', ch, mem, vals }` / the inverse is the host's knob write), `mute` / `solo` (bits, no UI yet), and the host
  notifications (transport, bpm, panic, heard, release) → `{ state, mem: D, cmds: [] }` (a `send` command when `D` changed);
  `initState('sdsv')` → `{ m: 'sdsv', run: false, play: false, bpm: 120 }` (its own; `sessOf` reads `m`) [C].
- **DrSeq**: `set` keeps `s.trim` (`if ('trim' in s) this.trim = s.trim || null`), inert for the others' payloads (they have none).
- **Engine** (E5): `drSeqMsg` hands `trim` to the machine like `smp` (`if (on && this.dm !== null && 'trim' in s && this.dm.trim)
  this.dm.trim(s.trim)`, beside engine.js:2275) and `drOn` adopts it from a waiting DrSeq (`dm.trim(this.sq ? this.sq.trim : null)`,
  beside `dm.smp`, engine.js:2163–2182) — both inert for the other machines (no `trim` key, no `dm.trim` method).
- **No → Piano roll, no SYNC, no DEMO, no REC** in its extras (no pattern exists); recording is the roll's (pads, keyboard, MIDI).

### 11.4 Velocity → the trigger (RV §2.3)

`hit(sound, v127)` latches the hit's **pad volts** `v_p = 0.005 · 15^((v − 1) / 126)` V [C on R: a pad gives ≤ 0.075 V, the input
reads 0.005–1.5 V]; the channel's SENSITIVITY stage turns it into the hit's dynamic voltage `V_D` at fire time (RV §2.3: a gain of ×20
… ×632 over the knob and a soft limit — "more sensitivity, less dynamic response" [R]). **The comparator's 0.2 V is a threshold**
(review #15): at SENS 0 a hit below **v 34** does not fire, at SENS 1 below **v 18**, at SENS 2 below v 2; above SENS ≈ 2.01 every
velocity fires (G · v_p > 0.2 V) — the original's soft-hit threshold, kept [C]; SENSITIVITY's tooltip says "Low settings ignore soft hits", and a roll note
that fires nothing is not a bug. What `V_D` moves [R]: the levels, **the noise
pitch on bass and toms**, **the bend on toms**; the click is the trigger's own. So a pad's velocity, a roll note's, a MIDI note's and a
hardware pad's all play the instrument's real dynamics. No accent input (the SDS-V has none) [R].

### 11.5 Memories (RV §1)

Four per channel, chosen by the channel's four memory keys (the `x?p` switch): **1 — factory**: our own sound (constants in
dr-808.js, `FACTV`, never editable — the card's internal trimmers [R]); **2 — the knobs** (the panel's six for that card); **3, 4 — the
front trimmers** (two rows of six; `D.trim`, edited in **TRIM…**, §13.3) [R mus83, mx11]. SENSITIVITY and LEVEL (the mixer) act on every
memory. A memory change while a drum rings glides its values in over the shell's 5 ms knob glide [C]. **Modulation acts on the knobs,
so a cable on a channel's knob is heard while that channel is on memory 2** (as the hardware's knobs) — the knob's tooltip says so when
the channel is on another memory, and TRIM… has "Copy to knobs" / "Store knobs here" [C].

## 12. The voices (`dr-808.js`, lane V5; RV §2)

### 12.1 The shell: a fourth descriptor

`create(inst, 'sdsv')` from **`MACH.sdsv`** (knob table, sids, the five `CardV` voices and their tables, the output stage); at every
machine selection of §0's list a fourth branch **chosen at create** (`isV`), the 808's / 606's / 909's functions and hot loops untouched
(7b's rule). `Dr808.gain('sdsv', d)` = the output constant `OUT_KV` (no master knob: the track's volume) [C]; `Dr808.mach.sdsv`;
`proto.sdsv` (the laws: `padVolts`, `sens`, the decay law, `FACTV`, the per-card tables — for the tests and the panel's tooltips). New
interface method **`trim(t)`** (the payload's 5 × 2 × 6, copied into preallocated arrays; no allocation). `hit` guards ids > 4. `mon`:
`lit` by sound id, `act` in slots 0–4.

### 12.2 One channel (`CardV extends Voice`, × 5 with a table each)

| block | topology (RV §2.2–§2.3) | the numbers [C unless tagged] | blocks |
|---|---|---|---|
| trigger | pad volts → SENSITIVITY gain + soft limiter → comparator (fires above 0.2 V) and a peak detector `V_D` sampled at the hit; monostable gates (trigger, click 4 ms) | `G = 20 · 10^(1.5 s)`, `V_D = 10 · tanh(G · v_p / 10)` V; the gates per absolute chunk | new, scalars |
| VCO | triangle core (integrator + comparator ± 5 V) from an exponential converter, **reset at each hit**, each corner reflected inside the sample — a sampled ideal triangle: unbent at ≤ 520 Hz its aliases sit near −87 dB (OS 2) / −101 dB (OS 4), **but the bend lifts a tom up to 2.5 octaves (≈ 2.9 kHz on tom 1 at TONE 10, BEND 10, v 127): raw aliases −57 / −71 dB, and after the RC² (which cuts the bent fundamental more than a low alias) the strongest −46 / −55 dB re the tone** (review #12, `scratchpad/8/rev/tri-alias.mjs`) — so V5 adds a **2-point polyBLAMP at each corner** (its fractional time is already the reflection's) when the gate of §15.1 needs it; + two passive RC sections (a near-sine near the top of TONE: the 3rd harmonic −30 dB at TONE 10, −20 dB at TONE 0) | f over TONE per card (RV §2.4: bass 30–120 Hz … tom 1 90–520 Hz), the RC corners at 1.5 × the card's top | the method of the 909's triangle state machine (`Tom9`, dr-808.js:2829–2905) re-written in `CardV` — `Tom9` untouched (no 909 class edited: 7b / 7c's rule); `bil1` × 2 |
| bend | EG_P: a downward sweep from `BEND` octaves (+ toms: 0.5 · V_D / 10) to 0 | τ_P = 0.3 τ_T ≤ 400 ms; BEND 0–1.5 (bass) / 1 (snare) / 2 (toms) octaves | switched first-order (7a) |
| snare mod | a 31 Hz triangle LFO on the snare VCO, ± 2.5 % [C on R? R26] | snare only | scalar |
| noise | the shell's hashed white noise at the card's own offset (a function of the absolute sample, salted; `white8`, `noiseWake` pre-roll) | gain fixed per card | reused |
| SSM2044 | 4 OTA stages with tanh, a saturating feedback, zero-delay solved per sample (the second iteration where `Ladder` takes it: resonant and g > 0.09, or g > 1, engine.js:133) — `Ota4`, engine.js `Ladder`'s OTA branch method | f_c = NOISE (per card: bass 60 Hz–3 kHz … snare 300 Hz–12 kHz) · 2^(sweep · V_D / 10 · EG_N) on bass and toms (sweep 1.5 / 2 oct) [R: dynamic noise pitch "on bass and toms"]; **the snare's sweep 0** (RV's 0.7 contradicted that [R]; review #25) [C]; **f_c clamped at 0.46 · the OS rate** (the engine's `gMax`, engine.js:582: tom 1's 6 kHz × 2² = 24 kHz is past Nyquist at OS 1, 44.1 kHz; review #26); Q 0, the snare k 2.2 [R?] | **new** `Ota4` |
| VCAs | three OTA VCAs: tone, noise, click; `I · tanh(x / 2V_T)`, the input ± 30 mV at full scale | — | new, scalar |
| envelopes | EG_T (tone: 0.5 ms attack to a peak ∝ V_D, decay `T60 = 0.03 · 167^d` s: 30 ms … **5 s** [R]), EG_N (τ 0.6 τ_T, its peak ∝ V_D too), EG_P, EG_C (the 4 ms click gate, 1 ms release); a retrigger restarts from the level it is at. **V_D scales the envelopes once** — the VCAs read the envelope (RV §2.3's diagram wrote "VCA_T (EG_T · V_D)" beside a peak ∝ V_D: a level ∝ V_D²; review #25) | — | switched first-order (7a) |
| mix | NOISE / TONE and CLICK / DRUM equal-power crossfades; LEVEL an audio taper; the card into the mono sum | — | scalars |

- **The rule of 7a §2.2 holds**: the topology with its component analogues; dynamics, retriggers and memories behave as the circuit
  model does; no sample playback, no envelope-on-a-recording stand-in.
- **Our values** are [C] (RV's preamble: no legible schematic here): V5 fits them to RV §5's targets and records them in RV §6 and §17;
  any value later read from a legible schematic or the reconstruction is recorded with its source.

### 12.3 Knobs → circuit

Each knob position (0…1, `drum.<id>`) → its law in one place (7a §2.3's rule): TONE / NOISE exponential over the card's range, BEND
linear in octaves, DECAY the T60 law, the balances equal-power, SENSITIVITY the gain law, LEVEL audio taper. Glided per absolute
4-frame chunk (the shell's ≈ 5 ms). A memory other than 2 reads its six from `FACTV` / `trim` instead of the knobs (§11.5).

### 12.4 Output and level

**Mono** (D3, the user's "mix output first"; RV §1: the mono mix output): each card at its LEVEL into the sum, the stereo trimmer's pan
ignored. **Calibration** [C, 7b / 7c's rule]: `OUT_KV` so the **bass drum's memory 1 at v 100, SENS 5, LEVEL 7** peaks at the 808's default
BD peak (0.4286 FS at OS 4, 48 kHz) ± 1 dB; the default groove of §12.7's `dvp` through the Track within ± 1 dB RMS of the 808's
default groove, below the limiter (7c review 1 F1's gate).

### 12.5 Your own sounds

7a §5 unchanged: a channel's slot plays **instead of** its circuit — LEVEL (audio taper), the hit's velocity as gain (7a's law over
`V_D`: below the knee proportional), TONE ± 1 octave at its centre (2 playback levels), DECAY a fade only below 5, mute. SOUNDS… lists
the five by name, "Circuit (ours) | Your sound".

### 12.6 Presets, labels

Presets (knobs only): `Init` (the knobs = each card's memory 1) and three of ours [C]: `Big Toms` (toms BEND 8, DECAY 7, NOISE / TONE 2),
`Tight` (every DECAY 3, CLICK 6), `Electro` (bass BEND 6 DECAY 6, snare NOISE 8 NOISE / TONE 7). Labels (D4): about, tile tip "SDS-V
(1981) — our model of its drum voices, with our own factory sounds; no recordings", the extras caption (§13.3).

### 12.7 Rates, CPU, bench rows

- Rates as 7a §2.4 (the app's OS, default 4; 44.1 and 48 kHz first-class). Idle costs nothing (asleep below 1e-5 of the card's scale
  for 4 chunks, 7a's rule); the noise runs only while a card is awake (a function of time).
- Per card, one ringing, OS 4, M4 Max node: ≤ **0.004** [C] (RV §7; recorded in §17).
- **Bench rows** [C] (kind `track`, OS 4, 48 kHz, **roll notes** — the SDS-V has no pattern — at 120 BPM, every timed run audible):

| row | node | jsc | ipad | what |
|---|---|---|---|---|
| **dvp** | **0.03** | 0.03 | **0.035** | a typical groove: bass on the quarters (v 100), snare on 2 / 4 (v 110), a tom fill 3 → 1 in sixteenths on the last beat of every bar (v 70–127), defaults |
| **dvx** | 0.05 | 0.05 | 0.06 | all five every 125 ms, v 127, every DECAY 10, SENS 10 |
| **dvi** | 0.0005 | 0.0005 | 0.001 | powered, a payload, silent — gated as row p / d9i (engine-track), not a `scenarios()` row |

**dvp** (review #6, proposal P-1): 0.025 was below the contract's own ceilings — the groove keeps every card awake (the bass every
beat, the toms every bar, our factory decays long), 5 × 0.004 = 0.020 for the machine plus the Track's ≈ 0.007 (d8p 0.0193 −
its machine 0.0126, IMPL-7a §14; d9p 0.0172 − 0.0099, IMPL-7c §14) = 0.027 — 7c review #9's class; **0.03** is the honest load (7c
P-2's choice). The **jsc** column is informational (the lead's A/B): `bench.json` `targets` carry `{ node, ipad }` only.

`bench.json` `targets` gain `{ node, ipad }` for them; `cv-cost` `COST.synth.sdsv = C('dvp', 'drums', 1, <E5's measured machine
share>, 0.0030)`; `bench.html` adds **c10** (the SDS-V at its defaults playing the dvp groove, `ipad: null`; its note at 118 names
the rows). JSC A/B (the lead): dvp / dvx and, because the shell changed, d8p, d6p, d9p, c1 within 3 %; V8: every existing row within
2 % (`cpu-gate`).

## 13. The panel, the extras, the canvas (lanes P1 / X)

### 13.1 The layout (RV §4; X reads published photographs — viewing only — and records the mm in `panels/sdsv.js`'s notes)

- The brain's face, **≈ 482.6 × 152.4 mm** (19 × 6 in, RV §1) → 966 px at 2 px/mm → a **992 px** module; with the extras strip ≈ **992 ×
  608** [C est.; P1 pins `TARGET.sdsv` from the geometry].
- **Fallback layout until the photo reading** [C]: rack ears (18 mm each, print screws); **seven module slots** of 50 mm — BASS DRUM ·
  SNARE DRUM · TOM 1 · TOM 2 · TOM 3 (the five cards) · two blank plates printed "HI-HAT" / "CYMBAL" ("optional modules — later",
  inert, D3); then the **MIXER** (≈ 82 mm): per channel SENSITIVITY and LEVEL in two rows of five, the channel names. Each card from the
  top: its name plate, the six knobs in two columns of three (NOISE / TONE · BEND / DECAY · NOISE-TONE / CLICK-DRUM — the reviews'
  order, RV §2.1), the **four memory keys in a 2 × 2 square** (1 top left) with an LED each, two rows of six small trimmers (memories 3
  and 4: art; a tap on a row opens TRIM… at it), a printed TRIGGER IN socket.
- **Colours / skins** [C, X refines from the photos]: a dark charcoal face, white legends, light-grey knob caps with a white line,
  square cream memory keys with red LEDs, brushed-metal trimmers — our own art; title "SDS-V" small plain type (the 303 / 606 / 909
  precedent), no maker word or logo (D4).
- **The 14 mm hit rule** (7a §7.3): knobs on a 22 mm column pitch and 20 mm rows, memory keys on a 15 mm pitch, the mixer's on 16 mm —
  all ≥ 14 mm; the trimmers are art (≤ 8 mm: their row is one hit box opening TRIM…).
- **Inert print** (D3): along the top edge the rear sockets with ▲ marks — the per-channel OUT jacks drawn `inert: 'later'` ("BASS OUT —
  cable-able with full patching (stage 4)"), STEREO L / R and MONO, PAD IN 1–7, HI-HAT PEDAL, TRIGGER IN.

### 13.2 Tokens (`TOKENS.sdsv`) and widgets (`cv-drum.js`, P1)

| token | kind |
|---|---|
| `dr:mem` | a radio of four keys with LEDs, **multi** `n` 1–4, `ch` b s 1 2 3 — bound to the channel's `x?p` switch (a panel switch's binding: presets, MIDI learn as any switch; **no History step** — undo / redo never revert a knob or switch tweak, `keepDevs` keeps `vals`, main.js:1380–1395; review #1) |
| `dr:trim` | a trimmer row (multi `ch` × `mem` 3 / 4): art + one hit box opening TRIM… at that row |
| extras | `dr:pads` (hexagonal, §13.3), `dr:map`, `dr:sounds`, `dr:trimMenu` (the TRIM… button) |

`UI.sdsv` (the pads' order and shapes, no grid, no dials, name 'SDS-V'); `machOf` / `sessOf` four-way; every `M` lookup of `drumPanel`
gets the SDS-V's row (no step keys, no grid, no tempo). DOM ≤ **700** elements [C] (40 knobs, 20 keys, 5 pads, the trimmer rows).

### 13.3 The extras strip and the hexagonal pads

- Caption: `XCAPTION_DRUMS` + " · Factory sounds: ours, through our model of its circuits" + "Dimmed controls are not emulated" (the
  layout's `extras.caption`).
- Row 1: the **kit** — five hexagonal pads [C]: the bass drum's (large) bottom centre, the snare left of it, toms 1 · 2 · 3 in an arc
  above, each in its channel's colour; `padsCell`'s multi-touch, flashes and monitor lights, with a hexagon hit test (pure, cv-drum:
  `inHex(cx, cy, r, x, y)`) and the velocity from the touch's height in the hexagon's box (front = loud) [C]. Row 2: MAP… · SOUNDS… ·
  TRIM….
- **TRIM…** (a popover): per channel, memories 3 and 4 as two rows of six small knobs (the trimmers), "Store knobs here", "Copy to
  knobs"; edits are drum-core presses (`trim`) — **record writes, no History step**: the drum host's `put` never takes one (IMPL-7a
  §10.1, main.js:3260 `drumPut`) and undo / redo keep a device's `drum` as they keep its knobs (`keepDevs`, main.js:1385 — a step
  would undo nothing; review #1); a value change re-sends the payload (`pk` changes).

### 13.4 Sources tray, art, canvas

- The **Drums view** lists TR-808, TR-606, TR-909, **SDS-V** (MODELS order; `DRUMS` unchanged); its note → "More machines later." —
  and the Controllers view's note points to the Pads (§1.2).
- `cv-art` `SIL.sdsv` / `DRAW.sdsv` — ours: a dark rack box with five module columns of knobs and small square keys, and a hexagonal
  pad in front; no text (cv-art.test's rules); meta "1981 · drum synth"; the cost label from `COST.synth.sdsv`.
- Tap / drop / Replace / + Track as every instrument; any switch between two drum machines is a machine change (engine `mch`, the
  old one's tail on its own chain); Hardware only; one `out` jack; a GL face like every hardware face.
- **Modulation**: every knob a `proc` destination through `drum.<id>` (one level: `moRec`); the memory switches `struct`
  (`CLASS_TABLE.sdsv` regenerated by `node tools/cv-classes.mjs --write`).

---------------------------------------------------------------------------------------------------------------------------------

## 14. Host wiring (`main.js`, lane H) and the lanes

### 14.1 main.js sites

| site | change |
|---|---|
| imports | `pads-core.js?v=9`, `cv-pads.js?v=9` (both reachable from main.js: precached) |
| `noteOn` (1662) | `noteOn(n, v, src = 0, ts = performance.now(), trs = targets(src), o)`: `trs` explicit; `keyVis(n, true)` only when `typeof src !== 'string' \|\| trs.includes(trk())`; `if (T.rec) for (const t of trs) if (t.arm \|\| (o && o.rec === 'target')) recStart(…)` (Q5, answered; a pad-recorded track joins `T.padRec`, §4.3); every existing caller byte-identical. The pads call it at **every hit** (the `held` retrigger, main.js:1665: review #2) |
| `PADS = cvPads.padsHost({…})` beside `PERF` / `DRUM` (1891–1913) | deps: `noteOn` / `noteOff` (above), `ctl`, `modVal` per source (§5.3, `padTracks`), `drumRec: (t, s, v, ts) => DRUM.rec(instView(t, CMOD.primId(t)), s, v, ts)`, `drumLit: (t, fn) => DRUM.api(instView(t, CMOD.primId(t))).lit(fn)` (the drum host keys its entries by the track view the panels pass), `inputSub` (an `inputSubs` entry per target track), `heardTick: curTick`, `hwOut: (port, b) => midi.send(port, b)`, `project`, `drumOf`, `raf`; `PADS.release()` at `visibilitychange`, `blur` (`perfLetGo`'s keep-hardware rule), `applyRestore`'s top, `deleteTrack`, `selectTrack` (canvas pointers only); **`PADS.release({ hw: true })` at `panic` and power off, before their `held` loops** (§4.2; review #7) |
| `panic` (1759), `selectTrack` (1831), `powerOff` (970), `noteOff`'s key light (1689), `buildKeys` (4178) | the host owns every `pd<k>:<n>` key (§4.2): the loops skip non-numeric sources explicitly (not by `+src` → NaN); the key-light tests count only keys that reached the selected track (review #7) |
| `replaceSweep` (1645), `recCC` (1632) | the take's pad-recorded tracks (`T.padRec`) with the armed ones (Q5's rule in replace mode and for the Pencil's aftertouch; review #8) |
| `PERF`'s `held` dep (1892), `perfLetGo` (1915) | only the keys whose source is a number (a pad's `pd<k>:<n>` never lights the selected synth's bed) |
| `drumMonitor` (3474–3482) | `live: () => (project.selTrack === id && cvLive(dev)) \|\| PADS.wants(id)`; `live()` is read only at `monitors.sync()` (main.js:2196–2215), so the host's dep `monSync: () => monitors.sync()` runs when its wants change while the machine's own panel keeps the subscription (the `lit` count then never reaches 0 or 1: no `monitor` call; review #29) |
| `cvDevices` (6363) | one entry per `project.pads` module after the wheel's (`{ key, kind: 'mod', mod: 'pads', jacks }`: its mod pads' inline `p<i>` jacks and its `notes` jack, §5.4, §9; review #4) |
| `cvHost().size` (5157) | a `pd<n>` key → `{ fixed: pads-core footprint }` |
| `modMount` (6374) | `kind 'pads'` → `cvPads.padsBody(o)` with `o = { host: PADS, id, doc, edit, inspector deps, learn: midi }` |
| `cvTitle` / `cvMenu` / `modKindOfKey` / Tidy | the Pads module's title ("Pads 1"; sub "every track"), its ⋯ items (§7.3), its kind; Tidy's column (§1.4) |
| `modLabel` (6729) | a `pd<n>.p<i>` source → "<module name> · <pad label or 'Pad k'>" (the Mod list, the knob menu, the inspector) |
| `modAdd` / `modSpot` / `modTileDrag` / `modDelete` (6630–6726) | kind `'pads'`: `CMOD.addPads(project)` / `removePads(project, id)` (cv-model, Q) — one step; the lay on the current track; the spot and the ghost at the footprint's size, not `modW` / `modHt` of an unknown kind (review #18); the tray's `ctlPick` / `ctlDrag` (§1.2) |
| `loadProject` (240), `freshProject` (257) | `p.pads = PC.normPads(p.pads)`; then every track's rows whose `pd<n>` module is missing are dropped (review #28) |
| `buildMods` (376) | passes `padVal: id => PADS.value(id)` into `compileMods` options |
| midi host (2547–2566) | `padIn: (e, port, ts) => PADS.midiIn(e, port, ts)`, `ports: names => PADS.ports(names)` (a port gone ends its pads' notes, §8.2; review #9); the Hardware dialog's `outputs()` |
| `toggleRec` / recording | `T.padRec` cleared with the take (above); otherwise unchanged |
| `__synthTest.cv` | `pads: PADS`, `padsBody` access for the sims |

No `t.model` / `t.vals` / `fxOf(t)` in a new line (the accessor ratchet).

### 14.2 Lanes (the leaner shape: contract first, builders in worktrees reset to the base, failing-test-first fixes, one sweep)

| lane | phase | owns (exclusive) | tests | model |
|---|---|---|---|---|
| **V5** voices | 0 | `dr-808.js` (§12: `MACH.sdsv`, the fourth branch, `CardV` × 5, `Ota4`, the trigger stage, memories, `trim`, `gain('sdsv')`, `proto.sdsv`), `tests/dr-sdsv.test.mjs` (new), research-sdsv-circuits.md §6 (the values as modelled) | §15.1; runs dr-808 / dr-606 / dr-909 / rom909, golden-drums / -606 / -909 unchanged | **standard** |
| **S5** drum core | 0 | `drum-core.js` (§11.2–§11.3: `PERS.sdsv`, `MAPS` / `mach` / `machineOf` four-way, the record, `EMPTY_PLAN`, `payload`, `press`, `initState`, the 909 pin first), `dr-seq.js` (the `trim` line), `tests/drum-core.test.mjs`, `tests/dr-seq.test.mjs` | §15.3, §15.4; runs the three goldens | **cheaper** |
| **K** pads core | 0 | `pads-core.js` (new, §7.4), `cv-keys.js` (`bed`'s `o.hit` / `o.slide` / `o.each`, `o.at(v, n)`), `tests/pads-core.test.mjs` (new), `tests/cv-keys.test.mjs` (additions) | §15.6 | standard |
| **M** MIDI | 0 | `midi.js` (§8.2–§8.3: per-port handlers, `padIn`, `ports`, `outputs` / `send`, note learn hooks), `tests/midi.test.mjs` (additions; 737's shared-handler pin) | §15.7 | **cheaper** |
| **E5** engine + data | 1 (**E5a first**: `models.js` `sdsv` + `FIELD_CLASS` / `CLASS_TABLE` + `tools/cv-classes.mjs` + cv-mods.test counts) | `engine.js` (`DrumP` + 45 ids, the `trim` hand-over, `warmDrumsV`), `models.js`, `cv-cost.js` + test, `tests/bench-scenarios.mjs` (four-way `drumTrack`, the dv rows), `tests/bench.json`, `tests/bench.html` (c10), `tests/engine-track.test.mjs` (additions), `tests/golden-sdsv.test.mjs` (new; `ref-7d` frozen by the lead), `tests/classic-mod.test.mjs` | §15.2, §15.5 | standard |
| **Q** mod sources | 1 (after E5a; owns cv-mods.js from then) | `cv-mods.js` (§5.1), `cv-graph.js` (§5.3), `cv-model.js` (`srcOk`, `padTracks`, `addPads` / `removePads` / rows pruning), `tests/cv-mods.test.mjs`, `tests/cv-graph.test.mjs`, `tests/cv-model.test.mjs` | §15.8 | standard |
| **P1** panel code | 1 (after E5a) | `cv-panel.js` (`TOKENS.sdsv`, the memory-key radio, the trimmer art, `XCAPTION`), `cv-drum.js` (`UI.sdsv`, four-way `machOf` / `sessOf`, the hex `padsCell`, TRIM…, `DRUM.rec`), `tools/panel-check.mjs`, `tests/cv-drum.test.mjs`, `tests/cv-panel.test.mjs` (`HW_IDS`, `EXTRAS.sdsv`, `TARGET.sdsv`, `NOKEYS`, 585's xcapFit list), `tests/classic-panel.test.mjs` | §15.9 | standard |
| **U** Pads UI | 1 (after K's merge) | `cv-pads.js` (new: host + body + inspector + settings + learn UI), `cv-module.js` (`jacksOf` from the device entry's `jacks`, host-sized, the inline jacks' `hide` flag), `cv-cables.js` (`modSrcPort` / `keyKind` / `colorOf` for `pd<n>.p<i>`, note cables to an instrument's edge, pad colours), `tests/cv-pads.test.mjs` (new), `tests/cv-module.test.mjs`, `tests/cv-cables.test.mjs` | §15.6 | standard |
| **X** satellites | 1 (from P1's first commit) | `panels/sdsv.js` (new), `panels/index.js`, `cv-art.js`, `cv-tray.js` (the Controllers view, its `ctls` tile row, the Drums note), `cv-migrate.js` (schema 11), `song.js` (`deserialize` through pads-core `normPads`), their tests (`cv-art`, `cv-tray` 550–553 / 566–598 (570 included), `cv-migrate` pins + the song checks), `tests/canvas-7a-sim.test.mjs:68`, `canvas-7b-sim.test.mjs:77`, `canvas-7c-sim.test.mjs:85` / 643, **`canvas-sim.test.mjs:518`** | `panel-check sdsv`, §15.10 | **cheaper** |
| **H** host | 2 | `main.js` (§14.1), `tests/canvas-8-sim.test.mjs` (new, accessor-free), `tests/main.test.mjs` (additions) | §15.10 | standard |
| reviewers × 2 | 3 | (1) **real engine** (golden harness + `main-sim` with the real Track): D1 (ref-7a / 7b / 7c), D2, D5 (`canonical-stream`, compile memos of pad-free tracks), D7 (bounce = live with trims), D9's matrix end to end, pads → the right track only, Q5 recording, drum REC, mod pads → `mval` at the right `k` on every holding track, the SDS-V against RV §5; (2) **headless Chrome** (CDP, `--headless=new --use-angle=metal --force-device-scale-factor=2`; 1440 × 900, 1366 × 1024, 1024 × 1366): the Pads module at 4 × 4 / 8 × 8, synthetic multi-touch (four fingers, a resting thumb, a pinch from the canvas), velocity by height, Edit / inspector / Grid…, lights at the heard time (an 808 synced on another track), the DOM budget, a fake Web MIDI (a CDP-injected `requestMIDIAccess`) learn + light-back bytes, the SDS-V face (GL vs `?nogl`), the hex pads, TRIM…, no console errors | — | standard |
| fixers | after | the finding's files, the failing test first | | cheaper |

### 14.3 Schedule

- **Phase 0** (V5 ∥ S5 ∥ K ∥ M): four lanes, disjoint files; base = `canvas` at this contract's commit (8815b14 + the docs).
- **Phase 1** (E5a first; then E5 ∥ Q ∥ P1 ∥ U, X from P1's first commit): base = `canvas` + phase 0 on the holding branch **`wt-8`**.
- **Phase 2** (H): `wt-8` after phase 1; the lead's fixture check first (a page sim: a Pads module on track 2 plays an 808 on track 1
  while track 2 is selected — the 808's node gets `{t:'on'}`, track 2's none; an SDS-V from the Drums view plays its five rows).
- **Phase 3**: the two reviewers → fixers → **one sweep** (every test file, one at a time; `golden-*` once) → **listening renders** of the
  SDS-V (each card's four memories at v 60 / 127, a groove; five short files) to the user **before** the lead freezes `tests/ref-7d/`
  (a change after the freeze is a new reference). **The listening gate** (review #30): the user's verdict per card — keep, or a
  retune note ("snare brighter", "toms longer"); one retune round by V5 on the factory constants (`FACTV`, the per-card tables),
  new renders, then the freeze; a second round only if the user asks → docs (ROADMAP rows 7 / 8, HANDOVER, §17) → **one squashed
  commit "7d + 8"** on `canvas` → `tools/deploy-canvas.sh` → the user's iPad session (§15.11). The hands-on hardware check waits
  until the user has a pad controller (Q6 answered); reviewer 2's fake Web MIDI is the stage's gate.
- **Known windows** on `wt-8` until the phase-1 merge (order E5 → Q → P1 → U → X): the MODELS-iterating tests (cv-panel `HW_IDS`,
  cv-art, cv-tray's Drums list, canvas-7a / 7b / 7c-sim's lists, canvas-sim's view menu) fail on branches without their owner's change; the schema pins until
  X; `pwa.test`'s precache check until the lead's `node tools/precache.mjs --write` (new files `pads-core.js`, `cv-pads.js`,
  `panels/sdsv.js`); cv-mods.test's counts between E5a and Q (E5a owns the counts, Q the source tests). Each lane runs its own files.
- **Rules for every builder** (7a §11, kept): `git reset --hard <base>` first and check `git log -1`; `?v=9` on every import; new test files
  `import './v8-guard.mjs'` first; never fake-DOM nodes in `assert.*`; one test file at a time (`node --max-old-space-size=2048 --test
  tests/<file>.test.mjs`); dense comments in the existing voice; **no Simmons or controller-maker material** (D4: circuits in our words,
  no schematic read for anything but values, nothing of any manual's prose, no scans committed); no lane commits `sw.js`; commit on the
  worktree branch; report the commit hash and the gates measured.
- **Interfaces** (each lane stubs the other side): `Dr808.create(inst, 'sdsv')` → 7a's machine interface + `trim(t)`; `Dr808.gain('sdsv',
  drum)`; `Dr808.mach.sdsv` (`KNOB_IDS`, `KNOB_DEF`, `SOUNDS`, `sids`); `Dr808.proto.sdsv` (V5 ↔ E5, S5, P1). drum-core: `normDrum(d,
  'sdsv')`, `PERS.sdsv` (`sounds names sids mask map` — the pads' order and shapes are cv-drum's `UI.sdsv`, P1's, as every
  machine's: review #24), `EMPTY_PLAN`, `payload` / `press` / `initState` on `D.m`, the press inputs
  `{ k: 'trim', ch, mem, f, v }` / `trimFromKnobs` (S5 ↔ P1 / H). pads-core (K ↔ U / Q / H / X): `normPads`, `footprint`, `padAt`,
  `chordNotes`, `modValue`, `resolve`, `defaultsFor(track, D, order, cols)`, `fill`, `COLORS`, `bindOf`, `rebind`, `echo('gen', pad,
  state)` → bytes. cv-keys `bed(el, B, { hit, slide, each, on, off, at(v, n) })` (K ↔ U). midi.js (M ↔ H / U): host `padIn(e, port,
  ts)`, `ports(names)`, adapter `outputs()`, `send(port, bytes)`, `message(data, ts, port)`. cv-mods / cv-graph / cv-model (Q ↔ H / U):
  pad sources, `padTracks`, `addPads` / `removePads`, `compileMods(…, { padVal })` (`refreshVals` takes it too). cv-drum (P1 ↔ H / U):
  `DRUM.rec(tr, sound, v, ts)`, `UI.sdsv`, `UI[m].pads` (the orders `defaultsFor` takes). cv-tray (X ↔ H): `o.ctls`, `o.ctlsEl`,
  `o.ctlPick`, `o.ctlDrag`. cv-pads (U ↔ H): `padsHost(deps)` (deps of §7.4 + `monSync`) → `{ value(src), wants(trackId),
  midiIn(e, port, ts), ports(names), release({ hw }?), rebuild(), api(id) }`, `padsBody(o)`.

## 15. Tests and gates

### 15.1 SDS-V voices (`tests/dr-sdsv.test.mjs`, V5; each card alone through `Dr808.create(…, 'sdsv')` at 48 kHz × 4 and 44.1 kHz × 2)

- **Target (a)** per block (RV §5): the passive RC² and the fixed filters against their analog prototypes (± 0.2 dB to 5 kHz at OS 4);
  `Ota4`'s small-signal response (the 4-pole slope ± 1 dB / octave over two octaves above f_c, the snare's Q peak ± 1 dB, no
  self-oscillation at the snare's k, f_c against its control ± 2 %, f_c clamped at 0.46 · the OS rate with no NaN at OS 1, 44.1 kHz);
  the VCO's frequency against its control ± 1 %, reset at the hit (the first period identical whatever the span split), **its aliases
  below 20 kHz ≤ −60 dB re the tone at OS 4 at the bent worst case** (tom 1, TONE 10, BEND 10, v 127, SENS 10: the first 20 ms;
  this review measured −55 dB for the reflection alone — review #12) [C]; the envelopes' τ ± 2 %; T60 at DECAY 10 = 5 s ± 15 % [R];
  **the trigger threshold** (§11.4: no hit at SENS 0 v 33 / SENS 1 v 17 / SENS 2 v 1, a hit at v 34 / 18 / 2; review #15).
- **Target (b)** (RV §5): the downward bend (monotone in BEND, none at 0, the 5 ms pitch above the 200 ms pitch); harder hits raise the
  noise's spectral centroid on bass and toms (not on the snare: neither its tone nor, its sweep 0, its noise) and the toms' bend depth [R]; SENSITIVITY compresses (the
  sounding level ratio v 127 / v 40 at SENS 2 ≥ 1.8 × the ratio at SENS 8); the balances' silent ends; the four memories distinct, the
  knobs acting on memory 2 only, `trim` acting on 3 / 4, a memory switch mid-ring gliding without a step > −40 dB.
- **The shared contracts** (7a §12.1): retrigger continues the state; 44.1 vs 48 kHz within 0.5 %; no NaN / Inf / subnormal (every knob
  at 0 and 10, every memory, OS 4 and 1); determinism; **span invariance** (4, 128, random multiples of 4); order-free latching; no
  allocation over 200 spans (`trim` included); idle (an asleep SDS-V runs no card code); the sleep rule; the sample slots (§12.5); the
  §12.4 level (± 1 dB of the 808's BD). Per-card CPU recorded in §17 (≤ 0.004).
- **The 808, 606 and 909 untouched**: dr-808 / dr-606 / dr-909 / rom909 tests (unchanged files) and golden-drums / -606 / -909 green
  after every V5 commit; d8p / d6p / d9p A/B within run-to-run noise.

### 15.2 Golden refs (`tests/golden-sdsv.test.mjs`, E5; frozen by the lead)

- **Old sound (D1)**: every golden shard, `canonical-stream`, golden-drums (ref-7a), golden-606 (ref-7b), golden-909 (ref-7c) —
  bit-identical.
- **New refs (D2)**: `tests/ref-7d/` = verbatim `dr-808.js`, `dr-seq.js`, `engine.js` + `MANIFEST.json` (`PIN` at the freeze; before it,
  B against itself, said in the header). Cases: each card × memories 1–4 (two trim settings) × v {20, 64, 100, 127} × SENS {0, 5, 10}
(v 20 at SENS 0 is the threshold's silence, §11.4: kept, it pins the threshold);
  every knob at 0 and 10; retrigger trains; the dvp groove as roll notes (with and without a payload: the DEF_MAP path); a memory switch
  mid-ring; OS 2; 44.1 kHz × 1; a sample slot. Gate `max |A − B| === 0`.
- **D7**: the groove with trims bounced offline = live, bit-identical (the payload's `trim` in the bounce).

### 15.3 drum-core (`tests/drum-core.test.mjs`, S5)

The tests of 7c unchanged; **pins**: the 808's and 606's unchanged, and **a 909 pin** of the same form (records, sessions, payloads at
every `at`, plans, notes, tables, `press` × 66 on 6 random records with LEDs and grid) computed on 8815b14's module before any change
and unchanged after. New: `normDrum(·, 'sdsv')` (idempotent, bounds, hostile input, `sync` / `rec` forced false, `keys` `[]`, `trim`
exact, the model wins over `m`); the four-way `machineOf` / `mach` (`'sdsv'` only for the exact string; `'tr999'` still the 808's);
`PERS.sdsv` (names by id, ids 5–15 inert: no `undefined` / `''` key in any record or payload); `mapTable` / `primaries` / `drumRows(map,
'sdsv')` (five named rows: Bass drum 36 … Tom 1 48); the payload (`EMPTY_PLAN`, `trim`, `pk` sensitive to `m` and `trim`); `press`
(trim, trimFromKnobs, map, smp, the notifications → no commands but `send`); `initState('sdsv')`.

### 15.4 dr-seq (`tests/dr-seq.test.mjs`, S5)

The tests of 7c unchanged; new: `EMPTY_PLAN` valid, no step ever fires (free, synced, a transport start / seek / loop wrap), `events()`
returns frames past the span, no allocation; `trim` stored (and not on the other machines' payloads).

### 15.5 Engine (`tests/engine-track.test.mjs` additions, E5)

An SDS-V Inst from `{t:'patch'}` and from `processorOptions` (live = offline); **808 → SDS-V → 909 → SDS-V → 606** on one Inst (each its
own machine and a fresh DrSeq; a payload before its patch waits in `drPend` and its `trim` reaches the machine at `drOn`; the tail
crossing each switch on its own chain); notes before any payload play the five drums (DEF_MAP); a `modRows` row on `drum.x1t` through
the real `moRec` (tom 1's pitch moves while on memory 2, not on memory 1); an OS change through `osFade` (no click above −60 dB, a tom
ringing); a panic while a long tom rings; `warmUp` + `restore` leave a fresh SDS-V; the bench rows dvp / dvx and **dvi** (row p's
method) — V8; JSC by the lead.

### 15.6 Pads core and UI (`tests/pads-core.test.mjs` K; `tests/cv-keys.test.mjs` K; `tests/cv-pads.test.mjs` U)

- **pads-core** (pure): `normPads` (idempotent; every bound; hostile input — wrong types, 9 modules, 70 pads, 5 targets, duplicate
  hardware bindings, unknown fields; never throws); `footprint` (the four sizes of §1.3, on the dots); `padAt` (cells, gaps, hidden
  rows, at three zooms' `s`); the numbering (pad 1 bottom-left); `chordNotes` (every quality × inversion × spread × octave; range
  edges); the velocity laws (= `padVel`; fixed); `modValue` (every mode × press / pressure / release; toggles); `resolve` (a missing
  track, a Replace, a machine without the sound → nothing and a warning); `defaultsFor` (808 / 606 / 909 / SDS-V / a synth); `fill`;
  `rebind` (moves, never duplicates); `echo('gen', …)` (note-on velocity 127 lit / held, 0 idle / off, on the learned channel and note;
  nothing for a CC-learned pad); `defaultsFor` with the passed orders (top row first → bottom-left numbering, `ac` → empty, the
  SDS-V 1 × 5).
- **cv-keys**: `bed` with `o.hit` / `o.slide: false` / `o.each: true` (a pointer keeps its pad across a move; **two pointers on one pad
  two `on`s and one `off`**; Pencil pressure ≤ once a frame as `at(v, n)` with the pen's pad, 0 at the last pen lift); **the 1i cases
  unchanged** (the defaults byte-identical: `each` false — two pointers on one key one `on`).
- **cv-pads** (fake DOM, the safe-assert wrapper of serum-ui.test): a 4 × 4 / 8 × 8 / 1 × 1 body; two pointers on two pads = two hits,
  **one pad two pointers = two hits, one off** (review #2); velocity by height; `data-gesture="music"` on the grid only; the mapping
  mode's `data-pads-edit` (never `data-cv-edit`); a mod pad's jack anchor a child of the pad (a press on the pad never reaches
  `[data-cv-jack]`); release on destroy (every `off` sent);
  keyboard (arrows, Space held, Escape); Edit mode (taps select, no note; jacks only there); the inspector's fields → `normPads`-valid
  records, one History callback per gesture; lights ≤ 1 paint a frame (a burst of 50 lit changes → one flush); the DOM budget (D6);
  the host: reference counts per (track, note) across pads / pointers / hardware (a chord pad and a note pad sharing a note: **an `on`
  at each press**, one `off` at the last release; two hardware pads on one kick: two hits); every D9 path ends every note (destroy,
  `release()`, `release({ hw: true })` resets the counts, a mapping edit while held, the pad / module / track deleted, a hardware
  note-off, a port gone from `ports(names)`); the toggle's state; a press's and a release's mod values posted at once (a note-on and
  its note-off in one frame: both values), pressure ≤ once a frame per source.

### 15.7 MIDI (`tests/midi.test.mjs` additions, M)

Today's tests unchanged (no `padIn`: byte-identical dispatch) **but 737's**, which pinned one shared handler for every input (now:
each input its own, both re-hooked at a hot-plug); per-port handlers (the port name reaches `padIn`); `ports(names)` after every hook
(a removed input missing from the list); `padIn` true → nothing else runs (no `noteOn`, no CC learn, no `modCC`), false → today's
dispatch; note-on velocity 0 as a release; poly pressure to `padIn`; `outputs()` / `send()` (a missing port: no throw);
`requestMIDIAccess` called with no options (no SysEx); an unsupported browser (the iPad case): `outputs()` empty, `send` a no-op.

### 15.8 Mod sources (`cv-mods`, `cv-graph`, `cv-model` tests, Q)

`srcOf` / `srcDev` / `perNoteOf` of `pd<n>.p<i>` (kind `'pad'`, GLOBAL); `sourcesOf` lists the project's mod pads (labels, scope
project) and none when `p.pads` is absent; `srcOk` (the module, the slot, `mod` on); `addMod` from a pad to a classic, a Serum and an FX
knob; `compileMods`: a pad source takes a value slot (sorted ids), the 17th is `left` / `'slots'`, `vals[].v` from `padVal` (and `lo`
without), **a press changes no memo signature** (no repost), a track without pad rows compiles byte-identically to 8815b14 (D5: the
memo and the payload of the 2b fixtures); `padTracks`; `removePads` drops every `pd<n>.*` row and lay entry on every track; `addPads`
ids `pd1…pd8` (the 9th refused).

### 15.9 Panel (`cv-panel.test`, `cv-drum.test`, `classic-panel.test`, P1)

`TOKENS.sdsv` validated (one mutation per rule); `panel-check sdsv` clean; rendered with a fake `api.drum`: the twenty memory keys bound
to the five switches (a press selects, the LED follows the patch value — a knob tweak: no History step, review #1), the trimmer rows open TRIM… at their row, TRIM…'s presses (record writes through `put`, no step), the
hex pads (`inHex` at the edges; velocity by height; two pointers two hits; monitor flashes); without `api.drum` the same nodes,
`aria-disabled`; the module ≤ 700 elements; the 808's, 606's and 909's panels and widgets unchanged (their tests green); `DRUM.rec`
(writes as `pads.on`'s REC branch, plays no note, ignores `sel()`).

### 15.10 Host and data (`tests/canvas-8-sim.test.mjs` H, accessor-free; X's data tests)

- **Pads**: the Controllers view lists Pads; a tap places `pd1` on the current track and it shows on every track (Tidy-placed there);
  a drop places it where released; Grid… 4 × 4 → 8 × 4 → 4 × 4 keeps the mapping (one step each, the footprint from the host); a pad on
  the 808 (track 1) pressed while track 2 (a Juno) is selected → the 808's node gets `{t:'on', n: 36}` and track 2's nothing, the
  808's pads light (monitor at the heard time) and the Pads pad lights from the 808's own synced pattern while track 2 stays selected;
  a chord pad on the Juno → three `on`s, one `off` each; recording (Q5's rule) → notes in the target's roll; drum REC → the 808's lane
  written; a mod pad cabled to a Juno cutoff (the row on the Juno's track, a value slot, `{t:'mval', k}` on press / release, no
  `{t:'mods'}` repost per press); a pad cabled on two tracks → both get `mval`; Pencil pressure → `{t:'at'}` to the target only; every
  D9 path (track switch mid-press — a hardware-held note survives it, a canvas-held one ends —, Undo, delete the pad / module /
  target track, panic — `held` holds no `pd*` key after it and the next hit of that note sounds —); a second finger on a held drum
  pad plays a second `{t:'on'}` (review #2); replace-mode recording of a pad into a non-armed target wipes its passed notes (Q5,
  review #8); a tray key's light does not stick while a pad on another track holds its note (review #7); Save / reload identical (schema 11), a schema-12
  file read-only; a project without Pads posts exactly 8815b14's messages (`canonical-stream` beside it); hardware: a fake MIDI input
  learns pad 3 (one step), its note-on plays pad 3's targets and reaches no track by channel, its note-off ends them, the generic
  light-back bytes on the fake output, the input unplugged mid-hold ends its notes.
- **SDS-V**: the Drums view lists TR-808, TR-606, TR-909, SDS-V; a tap replaces; the face renders with `api.drum`; a memory key press
  (the patch's switch, **no History step**; an undo leaves it); TRIM… (a payload with the new `trim`, **no step**: the record's
  policy — review #1); the hex pads play the five drums; MIDI 36 plays the
  bass drum; the roll's five named rows; MAP…; a sample in a slot; **808 ↔ SDS-V ↔ 909 Replace** and undo / redo twice, plain and graphed
  (each machine plays every time, the panel's session follows the record); a bounce includes its trims (= live).
- **X's**: `song` (`deserialize` keeps `pads` through `normPads`; an SDS-V device keeps `drum` through `normDrum(·, 'sdsv')`; export ch 10),
  `cv-migrate` (schema 11; STEPS[10] additive; `toV1` drops `pads` with its line; the moved pins), `cv-tray` (five views, the Controllers
  tile box, the notes' texts, the renamed fictional view), `cv-art` (`SIL` / `DRAW.sdsv`, the Pads glyph).
- **Tests that iterate MODELS** (none weakened): cv-mods.test counts (+ 45 controls: 40 proc, 5 struct), classic-mod.test (every SDS-V
  knob's `drum.<id>` resolved by the real `moRec`), cv-cost.test, cv-art.test, cv-panel.test, classic-panel.test:93, and the `family`
  rules of golden-graph / smpgen / integration / cv-shell-sim / cv-graph.test (no edit).

### 15.11 Rendering, UI and the iPad

- Reviewer 2 (CDP): the SDS-V face GL vs `?nogl` (≥ 99 % within 8 / 255 at k 0.5 and 1); G1 `equalPx` mid-pinch vs rest; the 808's,
  606's and 909's panels 0 px changed; a Pads module 8 × 8 with every pad lit at 16ths at 290 BPM: ≤ 2 ms main-thread a frame, one
  paint; a pan / pinch with a 4 × 4 Pads module and the 808 in view at 60 fps (no frame over 33 ms in the steady part).
- **iPad session** (after deploy): `bench.html` five passes → `bench.json` `"ipad8"` — **the first iPad run with drum rows** (review #27:
  the newest iPad row, `ipad2b`, was taken after stage 2b — rows c1–c6 and the engine rows, no c7–c9 and no d8* / d6* / d9*; the
  `ipad7a` / `7b` / `7c` sessions are still pending, HANDOVER): its c1–c6 and engine rows within 5 % of `ipad2b`, **every drum row
  (d8* / d6* / d9* / dv*) ≤ its iPad target** and c7–c10 recorded as the drum baselines, `stale: false`, the deployed build — it
  stands in for the three pending sessions; hands-on — the Controllers view, a Pads
  module playing the 808 and the SDS-V while another track is selected, chords on a synth, velocity by where you hit, four fingers at
  once, the Pencil's pressure, Edit and the inspector, Grid… 8 × 8, the SDS-V's memories, TRIM…, its hex pads, recording pads into the
  roll. A hardware pad controller: when the user has one (Q6 answered) — learn, play, the generic lights; until then reviewer 2's
  fake Web MIDI is the gate.

## 16. Questions for the user

Only what you alone can decide; each has the default the build uses until you answer.

1. **The grid's size.** **Recommended:** a new Pads module is **4 × 4** (16 pads, like an MPC or the drum machines' pads), medium pads;
   you can set any size from 1 × 1 to 8 × 8 and small / medium / large pads. Alternatives: 4 × 8, or 8 × 8 (Launchpad-sized).
2. **Resizing.** You said modules should never be resizable (2026-10-18) and asked for a "resizable grid" (2026-10-19). **Recommended:**
   the grid's rows, columns and pad size are a **setting** (⋯ → Grid…), and the module redraws at the size that fits — no drag handle.
   Alternative: a corner handle that adds or removes whole rows / columns as you drag (the only module with one).
3. **What a new Pads module plays.** **Recommended:** it **follows the track you add it on** — on a drum machine, that machine's sounds in
   its own pad layout (kick bottom-left); on a synth, a chromatic run from C3 on that synth. Alternative: empty pads you map yourself.
4. **Which targets matter most.** This stage builds **drum hits, notes, chords and modulation** together (they share one inspector).
   Clip / scene launching waits for a clip launcher (the studio has none yet). **Is any of the four not wanted, or one you want first?**
   Recommended: all four now.
5. **Recording pads.** **Recommended:** when you record, **each pad's hits go into the track it plays, armed or not** (a pad names its
   track). Alternative: only into armed tracks, as the keyboard does today.
6. **A hardware pad controller.** Do you have one, and which? It works **on the Mac only** (Chrome / Edge): no iPad browser supports
   MIDI (Apple's WebKit has none). **Recommended:** we build learn (hit a canvas pad, hit a hardware pad) and lighting the hardware pads
   back in your pads' colours, test it on your device, and support a generic mode for others.
7. **The SDS-V's optional hi-hat and cymbal modules.** The original's extra modules played a short recorded cymbal from a chip — not ours
   to use. **Recommended:** **later** — the five-drum kit (bass drum, snare, three toms) now; the two modules afterwards with our own
   looped metal sound through their chip circuit (the 909 way), if you want them.

**Things you will notice (no decision needed)**: the Sources tray gains **Controllers** with **Pads**; a Pads module appears on every
track's canvas (like the Mod Wheel), plays any track — that track only, never the selected one by accident —, lights when you hit it and
when what it plays sounds (a drum's own pattern included, at the moment you hear it), and its pads can be cabled to any knob as a fast
macro; **Edit** (✎) maps pads (track, note, chord, drum, modulation, colour, label, velocity, latch); pads sleep below 50 % zoom like every
control; the Pencil's pressure is aftertouch on note pads. The Drums view gains the **SDS-V**: its real-size rack face (our art, no
logo), five drums with its six controls each, sensitivity and level per drum, **four memories per drum** (our own factory sound, the
knobs, two trimmer memories edited in TRIM…), no sequencer — you play it from its hexagonal pads, a Pads module, the keyboard, MIDI or
the roll; hard hits change its tone (filter and bend), as the original; its individual outputs are drawn and become cable-able with
full patching (stage 4). Before we lock its sound in, you get five short audio files.

**Answers (the user, 2026-10-21):** all seven settled — the build follows them, no [C] left on them.
1. **Grid size**: a new Pads module is **4 × 4**, medium pads; any size 1 × 1 … 8 × 8 and S / M / L from ⋯ → Grid… (§1.3).
2. **Resizing** (the lead, from the user's rule of 2026-10-18 "modules shouldn't be resizable at all"): the grid's rows, columns
   and pad size are a **setting** (⋯ → Grid…), the module redraws at the fixed size that fits — **no drag handle** (§1.3).
3. **What a new module plays**: it **follows the track it is added on** — a drum machine's track: that machine's pad layout; a
   synth's: chromatic from C3 (§3.5).
4. **Targets** (the lead, from the user's "full custom mapping"): **drum hits, notes, chords and modulation, all now**; clips /
   scenes wait for a studio clip launcher (§3.6).
5. **Recording**: pad hits record into **each pad's target track, armed or not** (§4.3: `o.rec = 'target'`, the build's only
   rule; the `'armed'` branch is not built).
6. **Hardware** (the lead, from the user's "i do not have a midi controller at the moment"): **generic MIDI learn on the Mac**
   (Chrome / Edge), and **one documented generic note-velocity light-back scheme** — no device-specific colour profiles (§8.4);
   the hands-on hardware check waits until the user has a controller (reviewer 2's fake Web MIDI is the gate, §14.3, §15.11).
7. **The SDS-V's hi-hat / cymbal modules**: **later**, with our own sounds through their loop circuit (the 909's way); the
   five-drum kit now (RV §3).

## 17. Notes (the builders fill in)

### Lane K (pads core; phase 0, base f425b4d)

**Files**: `pads-core.js` (new), `cv-keys.js` (`bed` only), `tests/pads-core.test.mjs` (new, 20 tests), `tests/cv-keys.test.mjs`
(20 → 25: five new, the 1i cases untouched). Commits 277525f (the bed options), 7a3640e (pads-core).

**Gates** (node 24, one file at a time): pads-core 19 / 19 + 1 skipped (the SDS-V `resolve` case runs once `PERS.sdsv` lands with
S5 — no edit), cv-keys 25 / 25 (1i's twenty as they were: `each` false = one `on` per key, the glissando, `at(v)`'s callers read v),
gesture 53, cv-world 62 (G1 / G2: no gesture.js / cv-world.js edit), canvas-1i-sim 20, cv-panel 90, lint 145 — green.
`pwa.test`'s BUILD hash is red until the lead's `node tools/precache.mjs --write` (cv-keys.js changed; pads-core.js is reachable
from main.js only after H's import) — the known window of §14.3; no `sw.js` commit.

**The bed (cv-keys, for U)**: `bed(el, { w: G.w }, { hit: PC.padHit(G, () => M), slide: false, each: true, on(i, v, ts), off(i,
ts), at(v, i), shade?, raf? })` — the "note" is the slot i (0–63); `s` = screen px per world px from the element's rect (the grid
element is exactly `gridOf`'s box: the pads and their gaps, no padding). `each`: `on` at every pointer down (a held pad re-struck),
`off` once at its last pointer, `release()` one `off` per held pad. `slide: false`: a pointer keeps its pad on a move (onto a
neighbour, a gap, off the grid); a mouse move without a button still lifts. `at(v, i)`: the pad the pen holds — at the frame, at
the last pen lift (`at(0, i)`), at `release()`. Defaults are 1i's path (`keyAt`, slide, one `on` per key).

**pads-core (for U / H / Q / X)** — a leaf (imports drum-core only):
- Data: `normPads(x)`, `normPad(p)`, `newModule(id, o)` ("Pads n", 4 × 4 M; `o` = `defaultsFor`'s result), `freeId(pads)`,
  `PAD_ID`, `validId`, `padSrc(id, i)` → `'pd1.p12'`, `padOfSrc(src)` → `{ id, i } | null`, `isOff(pad)`.
- Grid: `gridOf(rows, cols, size)` → `{ rows, cols, size, P, gap, w, h }`; `footprint(rows, cols, size)` → `{ w, h, gx, gy, fy }`
  (the host's `{ fixed: { w, h } }`; the grid's top-left from the module's, centred across, 16 under the bar; the footer's top);
  `padAt(G, x, y)` → `{ i, r, c, f } | null`; `padRect(G, i)`; `padHit(G, mod | getter)` (the bed's `o.hit`); numbering `padNo(M,
  i)`, `slotOfNo(M, k)`, `visible(M, i)`, `visibleSlots(M)`, `slotOf(r, c)`, `rcOf(i)`.
- Velocity: `padVel(f)` (= cv-drum's), `hitVel(M, pad, { f } | { key: true } | { hw: 0–127 })`, `KEY_PAD_V`.
- Targets: `chordNotes(target)`, `targetNotes(target)`, `resolve(pad, project, drumOf)` → `{ hits: [{ tr, ns, at }], warn: [{ i,
  tr, why: 'track' | 'sound' | 'unmapped', text }] }` (per track, first-target order; notes sorted and unique across the pad's
  targets — a note two targets share is sent once per hit; `at` true where a note / chord target lies: the Pencil's aftertouch goes
  there), `drumNote(t, s, drumOf)` (the first drum machine of the track, primary first, with that sound → `D.map[s][0]`; main.js's
  `drumOf(t, dev)` passes straight in), `padLabel(pad, project)` / `targetLabel` / `soundName(s, model)`, `noteName`.
- Defaults: `defaultsFor(track, D, order, cols)` (the host passes `cvDrum.UI[m].pads` and the shape's columns: 4 for the 808 / 606 /
  909, **5 for the SDS-V**), `fill(M, { k: 'drum', tr, order, cols } | { k: 'scale', tr, scale, root })` → a new 64-array.
- Modulation: `modValue(mod, { e: 'press', v } | { e: 'at', at } | { e: 'release' }, st)` → the new state `{ v, on }` (the host keeps
  one per source; null = at rest: lo), `modBright(mod, v)` (0.22 … 1).
- Colours: `COLORS[16]` `{ id, name, lit, idle }`, `colorFor(target, mod)`, `C_*` indices, `WELL`, `IDLE_A`.
- Hardware: `bindOf(pads, port, ch, n, cc)` → `{ id, i, hidden } | null` (ch 1–16 and n as midi.js `decode` gives them; this port's
  binding first, then a port-`''` one), `rebind(pads, id, i, b | null)` → `{ pads, moved }` (immutable; a binding held elsewhere
  moves), `echo(prof, pad, state)` → `[0x90 | ch − 1, n, 127 | 0] | null`.

**[C] refinements** (each tested): a **keyboard** press on a fixed-velocity module plays its `fv` (a pad's own `v` still wins; by
position: 100 / 127); a chord's **inversion** past its size is its last inversion, **open** raises the quality's second entry (the
third, a sus chord's 2nd / 4th) before inverting; a custom list's label "C4 +2", a chord's "Cm7" (no octave, no inversion);
`normPads` gives a module with a bad or duplicate id **the lowest free id** (its data kept; no rows can name an id that never
validated) and **drops** a hardware binding whose ch / n are not integers in range (a clamped binding would be one the user never
learned); `defaultsFor` without an order lays the machine's `sids` kick first (its top row padded); **Fill from…** reads a
machine's order bottom row first (kick = pad 1), skips `ac`, empties the visible pads left over and keeps the hidden ones; the
colours sit on a dark pad well (`WELL` #1d1d21, both themes — the hardware look; every lit tone ≥ 3:1 on it, idle = 22 % over it).

**For H / U**: a hidden pad's binding comes back from `bindOf` with `hidden: true` — swallow it (`padIn` → true, nothing plays) so a
smaller grid never hands those notes to the channel's tracks; `echo('off', …)` is null, so the "velocity 0 once" at a module
delete, a hidden page or a switch to Off is `echo('gen', pad, 'off')`; `resolve` reads `project.tracks` each hit (cheap: no record
is normalised when `drumOf` is main's) — cache per pad until the project changes if a profile ever shows it. **For X**: `song.js`
imports `normPads` from `pads-core.js?v=9` (a leaf, as drum-core).

### Lane M (MIDI) — `midi.js`, `tests/midi.test.mjs`

**API for H / U** (every piece optional on the host; without them midi.js is byte-for-byte today's — seeded random streams through
named ports are compared against the hook-less router; `midi.message(data, ts)` without a port still works: port `''`):

| side | name | what |
|---|---|---|
| host hook | `padIn(e, port, ts) → bool` | first, for `on` / `off` / `pat` / `cc` only (never bend / channel pressure / program change); `e` = midi.js's **decoded** event (`{k:'on', ch, n, v}` v **0…1** = velocity / 127; `{k:'off', ch, n, rv?}` — note-on velocity 0 is an `off` without `rv`; `{k:'pat', ch, n, v}`; `{k:'cc', ch, cc, val}` val 0–127); `port` = `inp.name` (`''` for the port-less entry points); truthy = the message goes nowhere else (no `noteOn`, no CC learn, no `modCC`, no wheel / sustain / all-notes-off roles) |
| host hook | `ports(names)` | after **every** hook (first connect, every statechange — also for an equal list: a device that re-enumerated); the names of the inputs still there (`state: 'disconnected'` ports dropped; the button text still lists the map, as before). A throwing hook is re-thrown on a 0 ms timer (the button / `enabled` are not affected) |
| adapter | `learnPad() → Promise<{port, ch, n, cc} \| null>` | **the note-learn hook**: the next hardware **note-on** — or **CC 0–119 with value > 0** — from any port resolves the `project.pads[].hw` shape (`cc` 0 = note `n`, 1 = controller `n`; `port` `''` when unnamed) and is taken **before `padIn`** (a pad already bound elsewhere is learned all the same: H moves it) and goes nowhere else. Note-offs / pressure / CC 0 / CC ≥ 120 do not end it. A CC pad streams values while pressed: after a CC result the same (port, ch, cc) is ignored by the next `learnPad()` until its 0 arrives, so "Learn all" (call it again from the resolution) walks pads in order. Ends with `null`: 15 s (30 s while MIDI still needs enabling), **Esc: main.js's existing `cancelLearn(true)` now also cancels it** (returns true → "a pending learn, not a panic"), another learn of either kind. **No Web MIDI (iPad): `null` at once, no notice, no timer** |
| adapter | `padLearning` | boolean (the Serum `learning` getter is unchanged) |
| adapter | `outputs()` / `inputs()` | connected port names (`[]` without access: unsupported, not enabled, blocked, an access with no `outputs` map) |
| adapter | `send(port, bytes) → bool` | one channel message (status byte, then data bytes < 128; a typed array or an array) to **every** output of that exact name (two identical controllers share one: both light); `false`, never an exception, for a missing / disconnected port, no access, a malformed message, **SysEx** (refused; `requestMIDIAccess()` is called with no options), an output that throws. `hwOut: (port, b) => midi.send(port, b)` is the dep as written. The bytes (127 lit / 0 idle) are pads-core's `echo`; coalescing per frame is the host's |

**Choices / deviations (all additive):** pad learn is **adapter-owned** (§8.3 left "a learn took it" ambiguous): the host's `padIn` need
not implement a learn, nor a timeout. `cancelLearn` is shared so Esc needs no new wiring. `send` returns a boolean (the contract said
"no-op"). The pad learn's own note-off is **not** swallowed (it reaches `padIn`, which returns true once the binding is stored; before
that it reaches `H.noteOff` for a note nobody holds: a no-op in main.js).

**Gates (§15.7), `tests/midi.test.mjs` 34 / 34** (23 old, one — the adapter test's shared-handler pin at 737 — changed to "each input its
own handler, both delivering"; 11 new): per-port handlers + hot-plug re-hook + `ports` after every hook; `padIn` true → nothing else
(learn still waiting, no `modCC`), false / undefined / 0 / null → today's dispatch, never asked for bend / at / pc; the decoded events and
ports it receives; hook-less ≡ always-false hook over seeded streams; pad learn (notes, CC, held CC stream, port-less, before `padIn`,
15 / 30 s, Esc, replace by another learn either way, Serum learn untouched); `outputs` / `send` (two same-name outputs, disconnected,
malformed / SysEx, throwing output, no outputs map); no Web MIDI (`{}` / `undefined` / `null` navigator, a denied permission, a retry);
no options to `requestMIDIAccess`. A scripted mutation check (15 deliberate breakages of midi.js) killed every one. Also green:
`lint`, `accessors`, `main` tests. **`pwa.test` fails only on sw.js's BUILD hash until the lead's `node tools/precache.mjs --write`**
(midi.js changed; no `sw.js` commit from this lane).

### Lane S5 (drum core; phase 0, base f425b4d)

**Files**: `drum-core.js`, `dr-seq.js` (the `trim` line + its constructor `this.trim = null`), `tests/drum-core.test.mjs` (133 → 152 tests; the
909 pin first), `tests/dr-seq.test.mjs` (41 → 47). Commits 73605c9 (the 909 pin, **before any code change**, taken on f425b4d's module) …
the notes commit.

**Gates** (node 24, one file at a time): drum-core 152/152, dr-seq 47/47, **golden-drums 5/5, golden-606 11/11, golden-909 9/9**
(refs untouched), lint 143/143; unchanged and green on this branch: cv-drum 54, roll 52, canvas-7a-sim 23 / 7b-sim 15 / 7c-sim 13,
cv-migrate 56, engine-track 68. **The three pins**: the 808's `04ba14f6…` and the 606's `76c68a68…` unchanged; **the 909's `ce9e221b…`**
(`pin909`: records with and without `m`, read as the 808 / 606, hostile; sessions; payloads at every `at` × 3 sessions; plans with
sessions; `planSess` / `rollPlan` / `rollOpts` / `toNotes`; the tables; the laws `tempo909` / `vel9` / `vTrig9`; 66 + 66 `press` calls on
each of 6 random records with LEDs, grid and pk; DEMO909, PERS.tr909, MAP909, every constant) computed on f425b4d's module, unchanged
after. **Mutations**, each caught (24 tried, `scratchpad/8/s5/mutate.py`): no sdsv in `mach`; trim unclamped; pk blind to trim; payload
mute unmasked; memory rows swapped; a map that keeps duplicates; EMPTY_PLAN's `mT`; no `initState('sdsv')`; a press that always sends;
SYNC not forced; the names; `withTempo` / `compilePlan` / `rollOpts` not dispatched; a foreign session under the 808; `HASV` letting a
sound past the five in; `MAPV` off DrSeq's default map; the payload's key order; an unnormalised payload trim; DrSeq's trim line; `valid`
rejecting n 0. (Survivors, all equivalent: `pkOf` hashing `rst` unconditionally — `fnvNum(h, undefined)` hashes 0 — and DrSeq's
`locate` n 0 guard, which `boundary()` repeats — the cursor starts at INF.)

**Interfaces as built** (for P1 / H / E5 / V5 / X):
- `PERS.sdsv` = `{ id, sounds (the 808's 16 keys), names (16: 'Bass drum', 'Snare drum', 'Tom 3 (low)', 'Tom 2 (mid)', 'Tom 1 (high)',
  then the 808's inert 5–15), sids [0–4], mask 0x3E, map (GM), ch ['b','s','1','2','3'], fields ['n','t','b','d','m','c'], trim
  (TRIM_DEF) }`; exports `NAMESV SIDSV MASKV MAPV TRIM_CH TRIM_F TRIM_DEF EMPTY_PLAN`. `MAPS` / `mach` / `machineOf` four-way
  (`'sdsv'` only for the exact string); `mapTable` / `primaries` / `drumRows(map, 'sdsv')` — five named rows, GM 36 / 38 / 41 / 45 / 48
  (= `DrSeq.DEF_MAP` for ids 0–4, tested); the roll's `drumRowsOf({ model: 'sdsv' })` gives them with no roll.js edit.
- **The record** `{ v: 1, m: 'sdsv', keys: [], ui: {}, x: { sync: false, swing 50–75, mute, solo, rec: false, part 0–1 }, map, smp, trim }`;
  `normDrum(d, 'sdsv')` fresh `keys` / `ui` each call; `trim` 5 × 2 × 6 clamped to 0…1 **at exact bits** (no rounding: pk and the bounce
  see the true values), a non-number its default, −0 → 0; `mute` / `solo` masked to the five lanes (the 808's lane bits, bd 1 … ht 5);
  `sync` / `rec` forced false. Hostile input (cyclic / sparse / huge arrays, throwing getters and proxies at every level) never throws.
- **The payload** `{ m, plan: EMPTY_PLAN (the frozen shared constant, plain arrays: valid for DrSeq, also after a JSON clone), sync false,
  run false, bpm 120, swing 50, at, tap 0, map, prim, mute (soundMute & 0x1F: sound bits 0–4), smp (null or 16 by sound id, the five's
  slots only), trim (a fresh copy of the normalised 5 × 2 × 6), pk }` in that key order; `pk` = `'v0'` + FNV over sync / run / bpm / swing /
  tap / mute / map / prim / smp / **m** / **trim** (Float64 bits) — and nothing else (not `at`, the session, SWING, PART, a slot's name).
  `pkOf`'s `rst` line is now `if (s.rst !== undefined)` (606 / 909 always carry it: their bytes unchanged — the pins).
- **`press`** inputs: `map { sound, notes }` · `mapReset` · `smp { sound, slot }` · **`trim { ch 0–4, mem 3 | 4, f 0–5, v }`** (indices:
  ch order b s 1 2 3, field order n t b d m c = `TRIM_CH` / `TRIM_F`; v 0…1 clamped; a bad index or a v that is no number is refused) ·
  **`trimFromKnobs { ch, mem, vals }`** (`vals` an array of six in field order or an object by the field letters; an entry that is no
  number keeps the trimmer's) · `mute` / `solo { lane 1–5 }` · notifications `transport { play }` / `bpm { v }` / `panic` (the session
  only) — everything else (the sequencer's inputs, `heard`, `release`, junk) changes nothing and returns the same state / record /
  `[]`. **cmds is `[{ c: 'send', at: 'now' }]` exactly when the record changed** (a same-value press: no send, the same record), never a
  `notice` / undo — the memory keys are patch switches (no press) and TRIM edits record writes: **no History step** (review #1). A foreign
  session under an SDS-V record becomes `{ m: 'sdsv', run: false, play, bpm }` (transport and tempo kept); an SDS-V session under the 808's
  / 606's / 909's record becomes theirs (the 808's check gained `|| S.m === 'sdsv'`: no existing input changes).
- `initState('sdsv')` = `{ m: 'sdsv', run: false, play: false, bpm: 120 }`; `compilePlan` / `rollPlan` → EMPTY_PLAN, `toNotes` none,
  `rollOpts(D)` → `{ prim }`, `planSess` null, `gridPat` 0, `leds` → `{ step: 16 × 0, run: false }`, `stepLen` 240, `demoFree` true,
  `freeBpm` 120, `withTempo` the same record.
- **DrSeq**: `set()` keeps `s.trim` (`if ('trim' in s) this.trim = s.trim || null`), initialised `null` in the constructor beside `smp`
  (one more line than the contract's "one inert line": a stable object shape on the audio thread, and `sq.trim` is `null`, not `undefined`,
  for E5's `drOn` adoption); stored **as sent** (the machine's `trim(t)` validates). The empty plan needed no other change: `valid`
  takes n 0, `events()` returns 1e9 on every path (free, synced, a start / seek / loop wrap / stop, a swap to or from a real plan —
  the measure under the cursor plays out, then silence), no allocation.

**Readings where §11 is silent, and [C] refinements** (each tested):
1. **`trim`'s defaults** (§11.3 "our own two settings per channel"): `TRIM_DEF` — memory 3 the tight short one, memory 4 the long, low, bent
   one, per channel (bass `[.30 .35 .45 .30 .15 .60]` / `[.20 .20 .70 .80 .10 .35]` …); all in 0…1 and distinct per channel. They were
   chosen without V5's `FACTV` (not in this base): **V5 / the listening gate may retune them** (a constants change here, and the
   record's `trim` defaults move with it: any frozen ref that renders default trims — `golden-sdsv` — must be taken after).
2. **mute / solo are the 808's lane bits** (`{ k: 'mute', lane 1–5 }`: bd 1 … ht 5), as the 606's and 909's use the 808's lanes; the
   payload's `mute` the five sounds' bits 0–4. No UI yet.
3. **x.swing / x.part are kept** (clamped 50–75 / 0–1) because §11.3 lists the shared shape and forces only `sync` / `rec`; the payload's
   swing is the constant 50, so neither moves `pk` (tested).
4. **`press` ids are indices**, not the knob ids' letters (`ch: '2'` would be ambiguous with the number 2: a string is refused);
   `TRIM_CH` / `TRIM_F` / `PERS.sdsv.ch` / `.fields` map between them for the panel.
5. **A foreign map is read, not defaulted**: `normDrum(606 record, 'sdsv')` keeps the 606's note numbers for the sounds it shares (as every
   machine keeps a shared field) and gives ids 5–15 `[]`; `drumOf` never feeds one a record of another machine (it re-normalises by model).
6. The memory keys (`x?p`) and "Copy to knobs" are the host's patch writes, not presses — nothing in drum-core for them.

### Lane V5 (voices) — `dr-808.js`, `tests/dr-sdsv.test.mjs`, RV §6 (2026-10-21, base f425b4d)

**As built.** `Dr808.create(inst, 'sdsv', opt)` → 7a's machine interface (`set`, `setOS`, `hit`, `trig`, `render`, `post`,
`poll` (nothing), `live`, `reset`, `mon`, `smp`, `setSalt`) + **`trim(t)`** (the SDS-V's only: the 808 / 606 / 909 machines have
no `trim` key — the engine's guard) + `_mach`, `_v` `{ bd, sd, lt, mt, ht }` (the cards by sound id), `_cards` (by channel), `_trv`.
`MACH.sdsv` the fourth descriptor; the fourth branch chosen at `create` (`isV`; `is8 = !is6 && !is9 && !isV`) at each machine
selection (`create`'s voices and the bank's tables, `setRate`, `knobOut`, `readTargets`, `retune`, `apply`, `sources`, `smpHit`'s
gain, `smpRender`'s rules, `post`, `hit`, `trig`, `mon`, `setSalt`, `_v`) and `gain('sdsv')` first in `gain` — no 808 / 606 / 909
class, table or loop changed: golden-drums 5/5, golden-606 11/11, golden-909 9/9, dr-808 25/25, dr-606 25/25, dr-909 29/29,
rom909 8/8 after every commit. Five `CardV` voices (channels b s 1 2 3) on `Ota4` (the SSM2044) and the shell's blocks
(`bil1`, `kBil`, `tapA`, `rail`, `hash32`'s bits); per card its own noise stream; values and tags: RV §6.

**Interfaces (for S5 / E5 / P1 / X)** — `Dr808.mach.sdsv` = `{ KNOB_IDS (40: 'x' + b s 1 2 3 + n t b d m c s l, channel by
channel), KNOB_DEF, SOUNDS (the 808's 16 keys), sids [0, 1, 2, 3, 4], SW_IDS ['xbp', 'xsp', 'x1p', 'x2p', 'x3p'], SW_DEF [1, 1, 1, 1,
1] }` (the 808's / 606's / 909's entries keep their four keys). **The drum object**: every knob 0…1 (a missing one its default),
`x?p` the memory's **index 0…3** (= keys 1…4; a number or a numeric string; anything else → 1, the knobs). `Dr808.proto.sdsv`:
- **`KV_DEF`** = per channel FACTV's six, SENSITIVITY 0.5, LEVEL 0.7 — models.js's knob defaults are these × 10 (E5: bass 3 / 4.2 /
  4.5 / 4.2 / 2.2 / 2.5, snare 6.2 / 4.5 / 2.5 / 3.8 / 6.2 / 3, toms 3 / 4.2 / 6 / 6 · 6.2 · 6.5 (tom 1 · 2 · 3) / 1.5 / 2.5; a test
  should keep models.js = `mach.sdsv`).
- **`TRIMV`** (60 = 5 channels × [memory 3's six, memory 4's six], fields n t b d m c, 0…1): **S5's record default `trim`** is
  this as `[5 × [2 × [6]]]` (`TRIMV[12 c + 6 j + f]`); `trim(t)` takes exactly that shape (clamped 0…1; a missing / foreign value
  its default; `null` all defaults; no allocation). `FACTV` (30) memory 1 (TRIM…'s "Copy to knobs" from memory 1, P1).
- **`minVel(s)`** — the lowest velocity that fires at SENSITIVITY s (0…1): 34 / 18 / 2 / 1 at SENS 0 / 1 / 2 / ≥ 2.1 (P-4's
  threshold; P1's tooltip and the pad's aria text). `padVolts`, `sens`, `vD`, `VCMP` 0.2, `VL` 10, `t60` (DECAY → s), `CV` (the card
  tables), `CH_OF_V` [0, 1, 4, 3, 2] (sound → channel), `KV_IDS`, `SWV_IDS`, `SWV_DEF`, `Ota4`, the constants.
- **`Dr808.gain('sdsv', any)` = `OUT_KV` 0.732** (no master knob).
- `hit(sound, v127)` ids 0–4 (5–15: nothing); `trig(mask)` lanes 1–5 at v 100's volts (no accent; DrSeq's empty plan never trigs);
  `mon()` `lit` by sound id, `act` in slots 0–4 (bd sd lt mt ht = bass, snare, tom 3, tom 2, tom 1).
- **E5's warm-up** should run: the five at several velocities (SENS 5 and 10; one under the threshold), a memory key mid-ring, a
  knob glide (TONE, NOISE), `trim(…)`, an OS change (there and back) — the card's paths: the noise's wake, the one-pass / two-pass
  SSM2044 (the snare above 5.5 kHz at OS 4), the VCO's corners. `COST.synth.sdsv`: the machine's share of dvp, node: **0.0065**
  (this file's CPU test; the Track's ≈ 0.007 on top).

**[C] refinements of §12.2 / RV §2.3 (with reasons):**
- *The toms' dynamic bend is scaled by BEND*: `BEND_oct · (1 + 0.25 · V_D / 10)` — the contract's `+ 0.5 · V_D / 10` octaves at BEND
  10 (2.5 octaves, tom 1 at TONE 10: 2.94 kHz, the alias gate's case), but **none at BEND 0** (§15.1 "none at 0"; the additive form
  bent a tom at BEND 0).
- *The noise*: each card its own stream (a salt per card; `hash32` of the absolute OS sample — one hash a sample, the Irwin–Hall of
  two 16-bit uniforms: white, Gaussian behind the filters — not white8's four), 0.5 rms in 0–20 kHz in the SSM2044's 2 V_T, a
  first-order 20 kHz pole (the noise amplifier's) above 60 kHz; the noise path runs **while it can be heard** (on at a hit with its
  VCAs open, off below 1e-5 V; a wake settles it over the 12 ms before from rest, `noiseWake`'s rule — a function of time only).
- *The SSM2044's cost*: the Ladder's method (secants at 2s − y, the second pass blended where it drifts) — with no feedback (bass,
  toms) solved straight down; on the snare's one pass (its cutoff ≤ 5.5 kHz at OS 4) the loop's critical path is cut: the secants
  at the sample before's prediction, the feedback's saturation secant and 1 / (1 + k Gt) (series below 0.02) a sample behind, the
  loop closed after the open loop's pass. Its cost against the exact implicit solve at the snare's levels: −39 dB re the output
  (the fresh prediction −50 dB) — a noise body, for 0.0043 → 0.0035. Small-signal: = the prototype within 0.01 dB (both paths).
- *VCAs*: the OTA's `tanh(x · 0.03 / 2V_T)` — the tone's by its series (|z| ≤ 0.58), the noise's by its series below 0.8, the Padé
  above; **the filtered noise × NP enters the VCAs' tanh** (a loud noise limits there, as an OTA's input does).
- *Envelopes*: the attack's monostable 0.5 ms charging through 0.1 ms (99.3 % of V_D at its end); EG_P set to 1 at the hit; the
  click's 4 ms gate and its release τ 1 ms, its peak V_D (the trigger's own); the gates counted in OS samples from the hit's chunk.
- *The VCO* starts at its lower peak, rising; no BLEP on a retrigger's reset step (the RC² rounds it); the snare's 31 Hz triangle
  free-running on the absolute time (each snare a little different, deterministic).
- *The balance [fit]*: NP (bass 4.5, snare 3, toms 3 / 3.2 / 3.6: at mid NOISE the noise path peaks about the tone's) and G (bass 11,
  snare 4.8, toms 7.6 / 7.7 / 9.0 V); the toms' factory DECAY 6–6.5 (their sweep: τ_P = 0.3 τ_T ≈ 30 ms); OUT_KV 0.732; the mix
  output's coupling 3 Hz and the 808's rails knee; the samples' knee VK_V 4.40 V (v 100, SENS 5), SMP_LEVELV 2.4 V.

**Measured** (48 kHz × 4, node 24, M4 Max; `tests/dr-sdsv.test.mjs`, **20 tests, ≈ 2.2 s**):
- Target (a): the RC² (180 / 660 / 780 / 570 / 390 Hz), the 20 kHz pole and the 3 Hz coupling within 0.2 dB of their analog
  prototypes to 5 kHz; the triangle's 3rd harmonic −29.9 dB at TONE 10, −20.8 (bass) / −19.9…−20.0 (toms) at TONE 0; Ota4's small
  signal within 0.2 dB (0.01 measured), the 4-pole slope ± 1 dB / octave over [f_c, 4 f_c], the snare's peak (−1.0 dB re unity, 9 dB
  over its passband) within 1 dB, no self-oscillation at k 2.2 (f_c 0.5 / 3 / 12 kHz), f_c = NOISE's law within 2 % (bisection of
  the −12.04 dB corner), the cutoff's top: 24 kHz at OS 4, held at 0.46 fs at OS 1 (44.1 kHz), finite; **the card's noise path =
  `Ota4.step` bit for bit** on the stream recomputed from `hash32` (the wake's pre-roll included); the VCO at TONE 0 / 5 / 10 within
  1 % (TONE 5: bass 60.00, snare 219.94 (mean over its modulation), toms 216.33 / 157.16 / 108.17 Hz), 44.1 × 2 = 48 × 4 within 0.5 %,
  the first period identical from any frame, a retrigger back at the lower peak; **the alias gate: −107.1 dB re the tone at OS 4**
  (OS 2 −93.6; the uncorrected corners −67.7 — the mutation), the pitch at the hit 2940 Hz; the envelopes' τ within 2 % (EG_T,
  EG_N 0.6, EG_P 0.3, the click's 1 ms; DECAY 0 / 5 / 10), the attack 99.3 % at 0.5 ms, **T60 at DECAY 10: 5.01 s** on the sound;
  the trigger: no hit at SENS 0 v 33 / SENS 1 v 17 / SENS 2 v 1, a hit at v 34 / 18 / 2 (every card).
- Target (b): the bend downward, monotone in BEND, none at 0; at BEND 10 the pitch at 2 ms v 40 → v 127: toms 713 → 854 / 522 → 626 /
  364 → 437 Hz, bass and snare unchanged; the noise's centroid v 40 → 127 (NOISE 4): bass 128 → 213, toms 262 → 534 / 265 → 461 /
  190 → 295 Hz, snare 887 → 887; V_D(127) / V_D(40) 6.30 / 2.80 at SENS 2 / 8 (RV §5), the sounding ratio's compression ≥ 1.8 ×;
  the balances' ends exact (NOISE / TONE 0: the noise path never runs with CLICK 0; 10: aT 0; CLICK / DRUM 10: the click alone);
  memories 1 = 2 at the default knobs (bit for bit), 1 / 3 / 4 distinct, the knobs on 2 only, the trims on 3 / 4 only, SENSITIVITY
  and LEVEL on every memory; a memory key mid-ring: no step above −40 dB.
- Contracts: retrigger ≠ fresh = reset-then-hit; order-free latching, `trig` = the hits at v 100, ids 5–15 nothing; no NaN / Inf /
  subnormal (every knob 0 / 10, two ringing extremes, every memory, OS 4 and 1; everything asleep at the end); determinism, span
  invariance (4 / 128 / random, a memory switch and a glide inside; OS 1 at 44.1); no allocation over 200 spans (`trim` included);
  idle (no card code asleep), time to sleep after one hit (SENS 10): bass 459, snare 333, toms 1123 / 1245 / 1472 ms; the sample
  slots (LEVEL, V_D's law, TONE ± 1 octave, DECAY's fade, nothing under the threshold).
- **§12.4 level**: the bass (memory 1, v 100, SENS 5, LEVEL 7) **0.4285 FS vs the 808's BD 0.4286 (0.00 dB)**; each card alone at v
  100: snare 0.477 (+0.9 dB), toms 0.396 / 0.398 / 0.401; **the dvp groove's RMS +0.48 dB re the 808's default groove, its peak 0.856
  FS** (the 808's 0.651) — under the limiter's −1 dBFS by 0.35 dB (E5's Track gate).
- **CPU** (the machine alone, node, OS 4, best of 3; a card retriggered every 100 ms at v 127): **bass 0.0028, snare 0.0035, toms
  0.0029–0.0030** (each ≤ 0.004); **dvp 0.0065, dvx 0.0167**, idle 0.0003 — the rows add the decimators and the Track (E5's).
- **808 / 606 / 909 A/B** (base f425b4d vs this, and this after an SDS-V has run in the scope; the machine alone, their tests'
  patterns, medians of 7, interleaved, two runs): 808 −4.4 / −3.5 % (after an SDS-V +0.5 / +3.9 %), 606 −0.1 / −2.0 % (−0.7 / −2.3),
  909 −2.6 / −1.6 % (+1.7 / −0.6) — within the run-to-run noise.
- **Listening renders** (for the lead / the user, before `ref-7d`): `scratchpad/8/v5/wavs/` of the session scratchpad (48 kHz, 16-bit
  mono, through the band-limited decimation and the output stage; a file passing 0.95 FS scaled to it, the gain in its log):
  `1…5-<card>-memories-1to4-v60-v127` (each card's four memories, v 60 then v 127), `1…5-<card>-settings` (factory, BEND 0 / 10,
  DECAY 2 / 9, NOISE / TONE 0 / 9, CLICK 8, NOISE 1 / 9, TONE 0 / 10, at v 110), `6-velocity-sensitivity-bass-tom2-sens2-5-8` (v 20 →
  127 at SENS 2 / 5 / 8), `7-groove-dvp-defaults`, `8-groove-toms-memory3-sweeps`. Every factory constant (`FACTV`, `TRIMV`, `CV`'s
  NP / G) is a retune candidate at the listening gate.

### Lane U (Pads UI) — `cv-pads.js` (new), `cv-module.js`, `cv-cables.js`, `tests/cv-pads.test.mjs` (new), `tests/cv-module.test.mjs`, `tests/cv-cables.test.mjs`

**Base** e04f5eb (wt-8: K + M). Commits 798b78d (host + body; cv-module / cv-cables), 537446e (cv-pads tests), b918324 (note cables
through a drum machine's map; cv-module / cv-cables tests), 4895fda (lint), 518b3a9 (the grid in its well, the narrow footer / bar —
headless findings).

**Gates** (node 24, one file at a time): cv-pads 21 / 21 (§15.6's list: 4 × 4 / 8 × 8 / 1 × 1 vs `footprint`, two pointers two
hits, one pad two pointers two hits one off, velocity by height and fixed, the music zones, Edit mode's `data-pads-edit`, the
jack anchor a child of the pad, destroy → every off, the keyboard, the inspector → `normPads`-valid records one step per gesture,
Grid… / Velocity… / Light / Fill from… / Clear / shape / Rename, ≤ 1 paint a frame for 50 lit changes, the DOM budget through the
real cv-module (4 × 4 ≤ 60, 8 × 8 ≤ 160, + 2 a mod pad), reference counts over pads / pointers / keys / hardware, every D9 path,
latch, toggle, mod posts at once and pressure ≤ once a frame, the Pencil, hardware echo bytes, learn (moved binding, hidden pad
swallowed), the learn UI hidden without Web MIDI, the pinch-safe chrome, a rebuilt module keeping Edit mode); cv-module 57 → 60;
cv-cables 41 → 44; lint 147; canvas-1i-sim 20, canvas-2b-sim 23, canvas-3-sim 26; canvas-sim 22, canvas-2a-sim 26, canvas-1e-sim
24, cv-shell-sim 16, cv-fixes-sim 5, canvas-7a-sim 23; cv-keys 25, pads-core 19 (+1 skipped, K's) — green. `pwa.test` red on sw.js's
ASSETS only (pads-core.js / drum-core.js now reachable through cv-cables; cv-pads.js once H imports it): the lead's
`node tools/precache.mjs --write`, no `sw.js` commit.
**Headless Chrome** (CDP, `--headless=new --use-angle=metal --force-device-scale-factor=2`, touch emulation, a stub host page —
the real cv-world + gesture.js + a cv-module view of a Juno track + the Pads module; scratchpad `8/u/site/pads-stub.*`, driver
`8/u/cdp.mjs`): **30 / 30** at 1440 × 900 and 1024 × 1366 — the 4 × 4 default (352 × 416, chip "4 × 4"), **ten fingers at once →
ten hits on ten pads, ten offs**, one pad two fingers → two hits one off, **pinches over the grid: from the body's padding across
the pads (k 1 → 0.43), below 50 % with both fingers on pads (0.4 → 1.2), a canvas finger joined by a pad finger within 250 ms (1 →
1.79) — nothing played**, the mod pad's cable from its anchor in the pad's colour and the note cable to the Juno's edge, Edit mode
(the jack visible, a tap opens the inspector, plays nothing), Grid… through ⚙ to **8 × 8** (64 pads, 672 × 736, 90 elements) and
**1 × 1** (128 × 192, the hidden mod pad's cable at the bar's right end, its dot hidden), one step per change, **no console
errors**. Screenshots `8/u/shots/{desktop,portrait}-{4x4,10-fingers,after-pinch,edit-inspector,8x8,1x1}.png`. Finding fixed on
the way: the grid sat in the well but was positioned as if in the body (8 px off, its right column over the well's edge — the fake
DOM cannot see it). Chrome's touch adjustment moves a fingertip in an 8 px gap onto the pad beside it (with or without
`--disable-touch-adjustment`; WebKit has none), so the gaps-only pinch is the node test's (no zone on the grid container).

**For H — the host** (`PADS = cvPads.padsHost(deps)`; every dep optional, a missing one a no-op):
| dep | main.js |
|---|---|
| `project()` | `project` (the host reads `project.pads` / `project.tracks`, and writes `project.pads` inside `edit`, after `step`) |
| `noteOn(tr, n, v, ts, src)` / `noteOff(tr, n, ts, src)` | `noteOn(n, v, src, ts, [track tr], { rec: 'target' })` / `noteOff(n, src, ts)` — src `'pd<k>'`, k the host's session number of tr; called at **every** hit, the off at the last holder (§4.1) |
| `ctl(tr, kind, v, ts)` | `ctl(kind, v, 0, ts, [track tr])` (the Pencil's `'at'`, ≤ once a frame per track) |
| `modVal(src, v)` | `src` 'pd1.p12' → every track of `CMOD.padTracks(project, src)` → `modVal(t, 'pd1', 'p12', v)`; a press / release at once, pressure coalesced |
| `drumRec(tr, s, v, ts)`, `drumLit(tr, fn) → off`, `monSync()` | `DRUM.rec(instView(t, CMOD.primId(t)), …)`, `DRUM.api(instView(…)).lit(fn)`, `monitors.sync()` |
| `inputSub(tr, fn(n, on)) → off`, `heardTick()`, `live(id)` | an `inputSubs` entry of track tr; `curTick()`; `cvLive(id)` (a hidden / folded module lights nothing) |
| `drumOf(t, devId)` | main's `drumOf` |
| `step(label)`, `changed({ id, drop })`, `undo()` | `hist.record(project, label)` (before the write); after it: drop every row whose src is in `drop` on every track (Modulation switched off, review #31 — same step), persist, `cvView.sync` (jacks, size, title, cables), the payloads of tracks with pad rows; `undo()` for the notices' "tap to undo" |
| `rowsOf(src) → [{ track, label }]` | a mod pad's rows on every track (the inspector lists them) |
| `learnPad()`, `cancelLearn()`, `midiOk()`, `inputs()`, `outputs()`, `hwOut(port, bytes)` | midi's `learnPad()`, `cancelLearn(true)`, Web MIDI present, `midi.inputs()` / `outputs()`, `midi.send(port, bytes)` |
| `nextNote(fn) → cancel` | the inspector's "Play it": the next input note (an `inputSubs` one-shot); absent → no button |
| `jump(tr, id)`, `modelName(m)`, `notice(text, ms, onTap)`, `confirm(text)`, `raf`, `now` | select tr + `cvReveal(tr, id)`; `modelById(m).name`; main's notice / confirm |

Returns `{ value(src) (compileMods' padVal), wants(trackId) (drumMonitor's live), midiIn(e, port, ts) (M's padIn), ports(names), release({ hw }?),
rebuild(), resync(), transport(playing), endModule(id), endTrack(tr), hwDark(id?), srcLabel via cvPads.srcLabel, … }`. Sites:
`release({ hw: true })` at panic / power off before their `held` loops; `release()` at a blur / hidden page (hardware kept) —
`hwDark()` too at a hidden page; `rebuild()` after Undo / Redo / load (`applyRestore`); `endTrack(id)` at `deleteTrack`; nothing
at `selectTrack` (the old body's destroy ends its pointers and keys; a latch and a hardware hold stay); a module delete:
`hwDark(id)`, `endModule(id)`, then `removePads`; `transport(true / false)` at play / stop (roll lights); `resync()` where
cv-module's `host.shown` fires (on / off screen, fold), before `monitors.sync()`.
**The canvas**: `cvDevices` adds per module `{ key: M.id, kind: 'mod', mod: 'pads', model: null, dev: null, jacks:
cvPads.moduleJacks(M), color: cvPads.PADS_COLOR }`; `cvHost().size(key)` → `cvPads.moduleSize(M)`; `cvTitle` → `{ title: M.name,
sub: 'every track', chip: cvPads.chipText(M) }`; `cvMenu` → `body.menuItems()` + Fold · Bring to front · Tidy · Delete; `modMount`
kind `'pads'` → `cvPads.padsBody({ host: PADS, id: key, doc: document, track: () => trk().id, tap? })` (`tap`: the kit's
pressOrTap rule — cv-pads' own `tapOn` is the same rule), `b.append(B.el)`, `B.destroy()` at unmount; `modLabel` of a pad source
→ `cvPads.srcLabel(project.pads, src)`; a note cable's tap (`onAction('n:pd1>i1', 'tap')`, its `pads` slots on the cable) → the
module's pads listed, a pick → `B.inspect(slot)`; the mod drag from a pad's jack is the 2b flow (`modSrcOf('pd1.p12')` = the
row src). Body API: `{ el, grid, sync(), release(), menuItems(), edit(on?), inspect(slot), openGrid / openVel / openFill / openHw,
popover(), closePop(), destroy() }`. Pure: `orderOf(model)` / `defaultsOf(track, drumOf)` (a new module following its track, §3.5,
for `addPads`), `drumDev(t)`, `parseNotes`.

**[C] refinements / deviations** (each tested): `data-gesture="music"` sits on **every pad**, not on the grid container — §2.3's
"the gaps are not music: a pinch there zooms" (§15.6's "on the grid only" read as "the grid's pads only"); `BG_SEL` gains `.pd-body`,
`.pd-well`, `.pd-foot` (one finger there pans), never a pad or the grid (a press in a gap neither plays nor pans). The jack anchor
is `visibility: hidden` in play mode (also out of the tab order and the a11y tree; still measured). cv-module: an entry's `jacks`
(validated copies), a spec's `hide` (no dot; an inline one without its anchor ends at `{ x: w, y: BAR_H / 2 }`; `setJackHide` on
every sync / refresh — no rebuild), a `kind: 'mod'` module's non-mod jack (the `notes` one) read-only, an entry's `color`, Tidy
sizing an unmade host-sized modulator by `host.size` (the other kinds' guesses unchanged), a note cable's end `<dev>.@notes`
(`NOTE_END`) on the instrument's left edge (folded: −JACK_OUT, BAR_H / 2), note cables kept tappable under `patch: false`.
cv-cables: `keyKind('pd1')` → `'pads'` (no MOD_PREFIX / MOD_COLOR entry: their pins stand), `modSrcPort` p0…p63, the pad's colour on
its rows; note cables (`kind: 'note'`, `tap: 'pads'`, dashed by cv-pads' CSS) per (module, instrument of this track) — a note /
chord / list target by the instrument's key zone **and, on a drum machine, its note map** (an 808 plays a Juno chord's E4: its low
conga), a drum target the track's first machine with that sound; hidden pads and other tracks out; none without `project.pads`
(a project without pads: today's cables, tested). The "+N on other tracks" is the footer's chip, counting **pads**: "+13 pads on
Drums" / "+5 pads on 2 other tracks" (its tap: `jump`); the bar chip "4 × 4" uses no-break spaces; a module narrower than 256 px
shortens the footer (✎ / ⚙ / "+13"; below 160 the "+N" goes) and its bar (`[data-pd-narrow]`: no chip, no sub). The D9
mapping-edit rule compares a pad's `t`, `mod` and `latch` only (a colour, label, velocity or hardware edit keeps its held notes);
a hidden-by-Grid… held pad ends. Latch: a drum-only pad ignores it; the next tap releases without a new hit. A toggle's release
posts nothing (its value is unchanged); a press always posts. A learn that moves a binding says so in a notice ("That hardware
pad moved here from Pads 1 · pad 7"). Swap / copy and Clear pads keep each slot's hardware binding on its slot. Edit mode, the
selection, the inspector and the roving focus live in the host's `view(id)` (session): a module rebuilt by a jack-set change
(a pad's Modulation switched on / off) comes back in Edit mode with its inspector. Hardware flashes (a hit, the monitor's bit)
are 127 for 120 ms, then 0; idle / lit echoes go out on paint frames, once per change. cv-pads imports cv-drum's `UI` (the pad
orders) — already in the app's graph; pads-core stays a leaf.

### Lane E5 (engine + data; phase 1, base a859c6c = wt-8 after phase 0)

**E5a** (one commit: the patch shape fixed for Q / P1 / X):
- *models.js* `sdsv` after `tr909` (every earlier index unchanged): `name 'SDS-V'`, `model 'Drum synthesizer'`, `maker 'Simmons'` (a
  label: the drums' tiles never show it, cv-tray.js:398), `year 1981`, `family 'drums'`, §11.2's tag, an about naming no maker
  ("our circuit-level model … with our own factory sounds; no recordings of any instrument"). **Five sections, one per channel** —
  `Bass Drum`, `Snare Drum`, `Tom 1`, `Tom 2`, `Tom 3` (tom 1 the highest) — each `x<ch>n t b d m c` (labels `Noise`, `Tone`, `Bend`,
  `Decay`, `Noise / Tone`, `Click / Drum`), `x<ch>s` `Sensitivity`, `x<ch>l` `Level`, then the switch `x<ch>p` `Memory` (`opts ['1',
  '2', '3', '4']`, def 1 = memory 2, the knobs): 45 controls, the knobs in `Dr808.mach.sdsv.KNOB_IDS`' order, the switches = `SW_IDS`
  [C: per-channel sections, so the Mod menus group a channel's eight under its name (main.js `modDescs`); the face's MIXER is the
  panel's (X / P1), not a section]. Knob defaults `KV_DEF × 10` (bass 3 / 4.2 / 4.5 / 4.2 / 2.2 / 2.5, snare 6.2 / 4.5 / 2.5 / 3.8 / 6.2
  / 3, toms 3 / 4.2 / 6 / 6 · 6.2 · 6.5 / 1.5 / 2.5; SENSITIVITY 5, LEVEL 7). **The patch's `v / 10` is within one ulp of `KV_DEF`**
  (4.2 / 10 = 0.42000000000000004: no double d gives 0.42 by d / 10) — memory 2 at the default knobs is memory 1 to an ulp of TONE, not
  bit for bit; DrumP's own defaults are `KV_DEF` exactly. `map` → `{ engine: 'drums', machine: 'sdsv', drum: { knobs v / 10, switches
  their index }, level: 1 }`. `theme` `{ ctl 'knob', knob 'sdsv' (no CSS rule, as `tr9`), panel '#25272a', face '#1b1c1e', ink
  '#f3f3ef', label '#dcdcd6', accent '#e0281e' (the memory LEDs), cap '#c8cac6', capLine '#ffffff', font 'helvetica' }` [C: §13.1's
  charcoal face, white legends, light-grey caps with a white line; X refines from the photos]. Presets §12.6's: Init, Big Toms,
  Tight, Electro (knobs only: a preset puts every channel back on memory 2).
- *cv-mods*: `FIELD_CLASS` `drum.x<ch><f>` proc (40), `drum.x?p` struct (5); `CLASS_TABLE` regenerated (`tools/cv-classes.mjs
  --write`, no tool change): **544 controls — sm 129, apply 70, proc 146, chunk 180, struct 17, none 2**.
- *engine.js* `DrumP` + the 45 fields (`dk(o.x…, KV_DEF[i])`, `x?p` `dk(…, 1)`): one fixed shape (no "unknown patch key").
- *cv-cost* provisional `sdsv: C('dvp', 'drums', 1, 0.0105, 0.0030)` (V5's machine 0.0065 + the Track's ≈ 0.007); `bench.json`
  targets dvp 0.03 / 0.035, dvx 0.05 / 0.06, dvi 0.0005 / 0.001.
- Tests: cv-mods 16/16 (counts; the SDS-V's ids, sections, classes, sweep fields, switch indices, descriptors 40 proc + 5 `struct!`),
  classic-mod 18/18 (+1: models.js = `mach.sdsv` — ids, defaults × 10, SW_IDS / SW_DEF —, DrumP's defaults = KNOB_DEF / SW_DEF
  exactly, every knob through the real moRec, a `drum.x1t` cable), cv-cost 15/15 (+1). Unchanged and green: engine-track 68, lint
  145, presets, integration 44, bench 6, bench-page 2, accessors 30, cv-graph 33, cv-shell-sim 16, smpgen 14, dr-sdsv 20, cv-panel
  90, classic-panel 13, cv-drum 54; **D1**: golden-drums 5/5, golden-606 11/11, golden-909 9/9, golden-classic 8/8, -fx 3/3, -presets
  8/8, -random 1/1, -graph 6/6, canonical-stream 1/1. Known windows (X's, §14.3): cv-art (3: `SIL` / `DRAW.sdsv`), cv-tray (1: the
  Drums list), canvas-7a / 7b / 7c-sim's lists, canvas-sim's view menu.

**E5b** — commits 3940f00 (engine, warm-up, bench rows, engine-track; the §12.4 headroom gate failing first), 7e04214 (OUT_KV),
8812b29 (cv-cost, bench.html c10), 9d93094 (`golden-sdsv`), these notes. The lead's answers to E5a: **dvm** = the "memories" row;
the About title keeps `${maker} ${name}`.
- *engine.js* (no machine branch: the SDS-V rides the generic drum path by its string): `drOn` → `if (dm.trim)
  dm.trim(this.sq !== null ? this.sq.trim : null)` beside `dm.smp` (a waiting payload's trims, else the defaults — a kept machine
  coming back without a payload sheds its old trims); `drSeqMsg` → `if (on && dm !== null && 'trim' in s && dm.trim)
  dm.trim(s.trim)` beside `smp`; `restore()` → `dm.trim(null)` (the warm-up leaves the default trims). The comments' machine lists
  name the SDS-V. **`warmDrumsV`** after the 909's round (inside `warmDrums`' try), twice: the five through DEF_MAP at v 20 / 64 /
  100 / 127 (retriggers; round 0 tom 3 at SENSITIVITY 0: v 20 under the comparator; round 1 SENSITIVITY 10, the toms bent hard,
  the snare's NOISE 0.93: the SSM2044's second pass at OS 4), a patch moving TONE / NOISE and the memory keys to 1 / 3 / 4
  mid-ring, the payload (an empty plan of EMPTY_PLAN's shape, our trims `WTRIMV`, DEF_MAP / DEF_PRIM: DrSeq.set's map branch and
  the hand-over), round 0 a stand-in sample (`smp:~warmV`, 909's `warmSmp9`) in the bass's and tom 1's slots, stored and dropped,
  an OS change each round (there and back), the empty plan synced on a stand-in clock. **Its cost: 27 ms node** (warmDrums 180 ms
  in all; the scope's warm-up ≈ 605–655 ms, noise). What it buys (a later Track's first SDS-V, three runs each): the patch +
  payload 0.48–0.77 → 0.31–0.34 ms, **the first hits' quantum 2.5–3.3 ms (past the 2.67 ms deadline) → 1.3–1.6 ms** (the 808's
  1.4, the 909's 0.5–0.6 in the same harness; a warm five-card wake from rest 0.33–0.47 ms). iPad / JSC: the lead's.
- *bench-scenarios*: `drumTrack(rows, vals, samples, model, o)` four-way — `'sdsv'`: no pattern, its rows a **one-bar song of roll
  notes looping** (transport `loop`, `ls` 0, `le` 3840: every timed run has hits), its payload the record's (the empty plan, the
  default trims), `o.cycle` panel values posted as `{t: patch}` once a bar in turn; `songV(rows)` (rows by sound key, a character
  its velocity: `a` 70, `b` 90, `x` 100, `s` 110, `X` 127); `prepare()` posts `B.song` and runs `B.cycle` between quanta (one
  comparison a quantum on every track row). **dvp** bass on the quarters v 100, snare on 2 / 4 v 110, the tom fill 3 → 2 → 1 → 1
  on the last beat's sixteenths (v 70 / 90 / 110 / 127) [C: §12.7's "3 → 1 in sixteenths, v 70–127" over four sixteenths];
  **dvx** all five every sixteenth (125 ms) at v 127, every DECAY and SENSITIVITY 10; **dvm** dvp's groove with the channels on
  memories 3 / 4 / 3 / 4 / 3 (b s 1 2 3; the payload's default trims), every key flipped (3 ↔ 4) each bar — targets node 0.03 /
  iPad 0.035 [C: dvp's]. `bench.json` targets dvp / dvx / dvm / dvi; `bench.html` **c10** (the SDS-V's default panel playing
  dvp's groove, `ipad: null`) and the note (c1–c10, the dv rows).
- *cv-cost* `sdsv: C('dvp', 'drums', 1, 0.0101, 0.0030)` = the gate's dvp 0.0131.
- **Measured** (node 24, M4 Max; engine-track's gate, calibrated, two runs): **dvp 0.0131 / 0.0132** (0.03), **dvx 0.0194 /
  0.0217** (0.05), **dvm 0.0092 / 0.0103** (0.03), **dvi 0.00018 / 0.00017** (0.0005); `measure()` (uncalibrated, 7 × 1 s) dvp
  0.0136 (its halves 0.011 / 0.014: the tom fill), dvx 0.0183, dvm 0.0130. In the same runs d8p 0.0206, d6p 0.0187, d9p 0.0166.
  V8 A/B (a859c6c's engine.js + dr-808.js vs this, own fast vm contexts, `measure()` alternating, 3 × median of 5 × 1 s): d8p
  ×1.012, d6p ×1.024 / ×0.959 / ×0.996 (three runs), d9p ×1.017, d8x ×0.996, d6x ×0.974, d9x ×1.007 — run-to-run noise.
- **The groove-headroom check — it did trip** (the lead asked; V5's 0.35 dB was the machine alone at OS 4): through the whole
  Track (song notes, decimators, output stage; the pre-limiter peak at the limiter's input) V5's `OUT_KV` 0.732 put the dvp
  groove's beat 4 (bass + tom 3 together) at **0.906 FS at 48 kHz × 2 (−0.15 dB of gain reduction), 0.905 at × 1, 0.895 at 44.1 ×
  2** (0.871 at × 4), and the bass's memory 1 at v 100 **+1.23 dB** over the 808's BD (V5's own helper reads the SDS-V's bass 1.2 dB
  lower than the Track does; the 808's BD agrees within 0.03 dB on both). Failing test first (3940f00), then **`OUT_KV` 0.67**
  (7e04214, dr-808.js — the SDS-V's constant only: golden-drums / -606 / -909 untouched): the bass +0.46 dB re the BD, the groove's
  RMS −0.36 dB re the 808's default groove (48 × 4; −0.31 … −0.37 elsewhere), **the pre-limiter peak 0.797 / 0.830 / 0.828 FS at
  48 kHz × 4 / 2 / 1 and 0.776 / 0.819 / 0.815 at 44.1 kHz — ≥ 0.62 dB under −1 dBFS, the limiter never engaged**; each card
  alone ≤ 0.46 FS at v 100, ≤ 0.72 at v 127; dr-sdsv 20/20 (its machine-alone level: the bass −0.77 dB, the groove −0.29 dB).
  The groove on memories 3 / 4 (default trims) 0.860 / 0.856 FS at 48 × 4 (no gate: the listening gate's; at 0.732 it was 0.885).
  RV §6's row updated. The gate: engine-track's §12.4 test (48 / 44.1 kHz × 4 / 2 (/ 1), 8 bars).
- *Tests*: **engine-track 78/78** (+10: patch / processorOptions / the warm-up's restore with trims — bit for bit, four machines
  on Inst 0, the stand-in gone, the payload's trims in the machine; **808 → SDS-V → 909 → SDS-V → 606** — drPend, the trims at
  drOn, the defaults back without a payload, drSeqMsg's hand-over, no `trim` on the 606; the tails across 808 → SDS-V, SDS-V →
  909, 909 → SDS-V, SDS-V → 606 — level ×0.92–1.19 at sample 8, second difference −72 … −96 dB past the post's first 8 samples,
  drained; DEF_MAP notes (each its card alone, ids 5–15 nothing, a payload's remap rules); a `drum.x1t` cable through the real
  moRec — memory 2 moves tom 1, memory 1 bit-identical; the OS fade (tom 3: −71.7 dB over the change); panic; no allocation (the
  groove as roll notes with trims, memories 1–4, a `trim` inside, notes); the §12.4 level / headroom gate; the dv bench rows and
  dvi) and 7c's warm-up list + `sdsv`. **golden-sdsv 5/5** (8 s, RSS 478 MB): D2's cases (18 card renders: every card × memories
  1–4 (3 / 4 under the default and our trims) × v 20 / 64 / 100 / 127 × SENSITIVITY 0 / 5 / 10; every card knob at 0 / 10; LEVELs
  and SENSITIVITYs at 10; retrigger trains; dvp as roll notes with its payload (our trims, memories 3 / 4) and without (DEF_MAP);
  memory switches and a glide mid-ring; OS 2; 44.1 kHz × 1; two sample slots); the "differ" checks (the memories, the trims,
  SENSITIVITY, **v 20 silent at SENSITIVITY 0, a hit at 5**, the slots); **D7** the groove with our trims offline
  (processorOptions: patch, seq, song, transport) = live; **D5** 55 hits posted as notes = the same as roll notes on a 128-tick grid
  (3200 frames: quantum-aligned at 120 BPM / 48 kHz), the same hits on the same frames, bit-identical. Freeze mode exercised (refs
  written, 5/5 against them; `OUT_KV × (1 + 1e-6)` caught by every memory-1 case, the drSeqMsg hand-over removed caught by 8
  cases), refs deleted — the lead freezes. cv-cost 15/15, cv-mods 16/16, classic-mod 18/18, bench 6/6, bench-page 2/2.
- **D1** at the end of E5b (one file at a time): golden-drums 5/5, golden-606 11/11, golden-909 9/9 (after E5b-2's OUT_KV too),
  golden-classic 8/8, -fx 3/3, -presets 8/8, -random 1/1, -graph 6/6, canonical-stream 1/1; dr-808 25/25, dr-sdsv 20/20, lint
  145/145, integration 44/44, accessors 30/30. `pwa.test` fails only on sw.js's BUILD hash (engine.js / dr-808.js changed; no
  `sw.js` commit from this lane: the lead's `node tools/precache.mjs --write`).

**[C] readings and seen, not fixed** (for the lead):
1. *D5's hit log* reads `p.nowF()` (the frame a note belongs to: a posted note's next quantum), not `spanF` (the last quantum's
   start between quanta) — the renders are bit-identical either way; the log only.
2. *The memories 3 / 4 groove at the default trims* (TRIMV) peaks 0.86 FS before the limiter at OS 4 — under it, by 0.3 dB; a
   louder trim retune at the listening gate may cross it (the limiter's job then, but the dvp gate is the default panel's).
3. *dvx / the D5 case at v 127 with our trims* reach the limiter (0.891): worst cases, as the 808's d8p accents do.
4. *Contract wording*: §12.7 calls `COST.synth.sdsv`'s base "the measured machine share"; built as every drum machine's (base +
   one voice = the row's whole-Track load, 0.0131).

### Lane Q (mod sources; phase 1, base 20854b7 = wt-8 after E5a)

**Files**: `cv-mods.js`, `cv-graph.js`, `cv-model.js`, `tests/cv-mods.test.mjs` (16 → 19), `tests/cv-graph.test.mjs` (33 → 37),
`tests/cv-model.test.mjs` (8 → 13). No DSP, no main.js. cv-mods / cv-graph import pads-core (`padOfSrc`, `padSrc`, `padNo`,
`padLabel`; cv-model also `freeId`, `newModule`, `PAD_ID`, `MAX_MODS`) — so pads-core is reachable from main.js through them.

**D5, pinned first**: the 2a / 2b fixtures' `compileMods` (memo signature — `memoSig`, a test export of `sigOf` —, `key`, a hash
of the payload sans cp / ct with `vals[].v`, the cp / ct keys) taken at 20854b7 (cv-graph = 8815b14's) before any pad change; the
test compiles them again in a plain project and in one with Pads modules and pad rows on another track, with and without a
`padVal`: identical. `project.pads` is never hashed: a track without pad rows signs and compiles as before.

**The source** (§5.1): `srcDev(t, 'pd<n>.p<i>')` → `{ q, dev: null, kind: 'pad' }` without reading the track (pads-core
`padOfSrc` decides: n 1–8, i 0–63, no leading zero; anything else falls through to the device lookup, i.e. null); `perNoteOf` false;
a Serum row from a pad takes an ext slot through `planSerum` with no edit there. `kindOfId` / `MOD_LABEL` / `MOD_ORDER` unchanged;
`destOk` unchanged. `sourcesOf(t, p)`: after the wheel, every mod pad (slot with `mod` on) of `p.pads`, **modules by id, slots in
order** [C], `{ id: 'pd1.p12', label, scope: 'project', kind: 'pad', dev: 'pd1', port: 'p12', perNote: false, hidden }` —
**`hidden`** (only on pad entries): the slot is outside its module's grid (its rows stay, §1.3; a new cable's menu may skip it).
**Labels** [C]: "<module name> · " + the pad's own label, else its first target's ("Kick", "C4" — pads-core `padLabel`), else
"Pad k" (k its shown number; a hidden slot: its number on the full 8 × 8, i + 1) — `padLabel`'s "Mod" fallback would name every
mod-only pad alike. main.js `modLabel` already finds a `<dev>.<port>` source's label in `modSrcList` → `sourcesOf`: the Mod list,
the knob menu and the inspector label pad rows with no main.js edit (`padSrcLabel(p, src)` gives the same text for any slot).

**The compile** (§5.3): a pad source in `need` takes a value slot (`take(id, 'val')`) **after the track's modules and the wheel,
pads sorted numerically by module, then slot** (pd1.p3 < pd1.p12 < pd2.p0); `vals` entry `{ k, src, v, id: 'pd1.p12' }`; past 16
(shared with CC modules and further macro knobs) the row is `left` `'slots'` (a Serum row too: `'slots'`, not `'ext'`, as 2b). The
initial `v` and `refreshVals` (memo hits) read `opts.padVal(id)` (a number → clamped 0…1), else the pad's `mod.lo` from
`project.pads`, else 0 (no module: H prunes such rows at load). `sigOf` / `key` never see the value, the mode or the range: a
press, a release or an inspector edit of lo / hi / mode is a memo hit (the same payload object, `vals[].v` refreshed) — never a
repost. Consequence of "after the modules" (the order 2b already has between a second macro module and the CC modules): a row
from a 9th CC module on a track whose 16 slots are full compiles and the last pad's rows become `left` `'slots'` (the Mod list /
budget show it; `modConnect`'s `modLeftWhy` checks only the new row, so no notice at that drop — as today when a second macro
module's knob evicts a CC row).

**cv-model**: `srcOk(t, src, p)` (now exported): a pad needs `p` — its module there and the slot's `mod` on (a hidden slot too);
**without a project a pad is refused** [C: unlike the wheel's `p === undefined` leniency, which 2a's project-less callers needed]
(code `'src'`). `addMod` from a pad: classic 0.25 by law, a Serum by its drop rules (the wheel stand-in, as every non-native
source), a panel's effect knob; **a pad new to the track whose 16 value slots are taken is refused** (code `'slots'`, why "This
track’s value sources are full (16/16)", the 2a budget's way); a second row from a pad already holding a slot passes; CC / macro
rows keep 2b's behaviour (no addMod budget; the compile's `left`). `addPads(p, o)` → `{ ok, id, why }` (pads-core `newModule(id,
o)`: o's fields — `defaultsFor`'s rows / cols / pads, a name — never its id; the lowest free id; the 9th: "8 Pads modules in this
project"; a missing / non-array `p.pads` becomes `[]`); `removePads(p, id)` → `{ ok, byTrack: [{ trackId, rows }] }` (the module,
every `pd<n>.*` row, `t.lay.pd<n>` — `dropLay` — on every track); `padRows(p, x)` / `dropPadRows(p, x)` → `{ ok, byTrack }` (x a
module id or one source: the confirm's counts / §7.2's "Modulation off removes its rows in the same step"); `prunePads(p)` →
`{ ok, byTrack }` (rows whose pad fails `srcOk`, lay entries of missing modules; idempotent). All pure, in place; the History step
is the caller's (one `hist.record` around the call: the snapshot holds `p.pads` — tested: one undo restores the module, its rows
and lays on every track). Re-exported from cv-mods: `padTracks`, `isPadSrc`, `padSrcLabel`.

**For H (main.js)** — `CMOD.*` unless noted:
- `buildMods`: `CG.compileMods(tr, project, { smooth, qr, ultra, padVal: id => PADS.value(id) })` (a fresh closure per call is
  fine: padVal is not in the signature).
- The value path (U's `modVal(src, v)` dep): `for (const t of CMOD.padTracks(project, src)) modVal(t, q.id, 'p' + q.i, v)` with
  `q = PC.padOfSrc(src)` — main.js `modVal` finds the entry by `'pd1' + '.' + 'p12'` (no edit).
- `modAdd` kind `'pads'`: `hist.record(project, 'Add Pads')`, `const r = CMOD.addPads(project, PC.defaultsFor(…))` → `r.ok ?
  t.lay[r.id] = spot : notice(r.why)`; `modDelete` / ⋯ → Delete: `CMOD.padRows(project, id).byTrack` for the confirm, then
  `CMOD.removePads(project, id)` in one step (queue a patch for every `byTrack` track, as `removeWheel`'s caller does).
- U's `rowsOf(src)` → `CMOD.padRows(project, src)`; U's `changed({ id, drop })` → `CMOD.dropPadRows(project, s)` for each `s` in
  `drop`, in the edit's step, then queue the affected tracks.
- `loadProject` / `freshProject` (review #28): after `p.pads = PC.normPads(p.pads)`, `CMOD.prunePads(p)`.
- `modConnect`: unchanged — `addMod(…, { project })` refuses a pad that is off / gone (`'src'`) or a 17th value source
  (`'slots'`, its why shown by `notice(r.why …)`); `modLeftWhy` still covers a Serum's ext budget. `modSrcPick` may filter
  `s.hidden` out of the "Connect to…" menu.

**Gates** (node 24, one file at a time): cv-mods 19/19, cv-graph 37/37, cv-model 13/13, cv-migrate 56/56 (the 2a wheel /
singleton tests), canonical-stream 1/1, golden-graph 6/6, modcore 24/24, canvas-2a-sim 26/26, canvas-2b-sim 23/23, canvas-3-sim
26/26, lint 145/145, accessors 30/30, cv-graph-engine 5/5, main 43/43 — green. `pwa.test`'s BUILD hash: the lead's
`node tools/precache.mjs --write` (no `sw.js` commit).

### Lane P1 (panel code: `cv-panel.js`, `cv-drum.js`, `tools/panel-check.mjs`, `tests/cv-drum.test.mjs`, `tests/cv-panel.test.mjs`, `tests/classic-panel.test.mjs`)

**P1a (the validator, the geometry, panel-check, the memory keys' radio; lane X's base)**, on E5a 20854b7. Readings where §13 left a
detail open [C]:
- **`TOKENS.sdsv`**: face `dr:mem` (button) and `dr:trim` (button); extras `dr:pads dr:map dr:sounds dr:trimMenu` (no grid, SYNC, REC,
  DEMO, → Piano roll: no sequencer). Two new generic table fields: **`grp`** — a repeated token's group `[field, values]`: `idx` and
  `full` count *within* each group (`dr:mem` n 1–4 and `dr:trim` mem 3–4 per `ch` of `'b' 's' '1' '2' '3'` — strings, the ids'
  letters; drum-core's `TRIM_CH` order) — and **`bind`** (`'dr:mem': 'x?p'`): a grouped token writes a models.js switch per group,
  which its keys place (once per channel present) — the switch is never placed on its own (that is "placed 2 times"), a channel
  without keys leaves it "not placed". `led: ['dr:mem']` (each key shows its LED); `cells { 'dr:pads': [328, 200] }` (`DRV_PADS`),
  `dr:trimMenu` 88 × 64 in `TOK_CELL`; `caption` = `XCAPTION_DRUMS` + " · Factory sounds: ours, through our model of its circuits"
  (§13.3; with the dimmed note 157 characters — **it fits the 976 px strip at 9 px**, estimate × `XCAP_K` 939 px: no step-down, so
  585's "no other strip changed" list stays `['solina', 'tr909']`). "Simmons" joins `MAKERS`.
- **The trimmer row** (`dr:trim`, a button token: `w × h` its art's box): `TRIM_N` 6 trimmers of `d` 2–8 mm (absent: what fits, ≤ 5)
  evenly across the box — they must fit (`6 d ≤ w`, `d ≤ h`); its one hit box (≥ 14 mm, `hit` as any control's). **`hitOff [dx,
  dy]`** (mm, the trimmer rows only): the hit box's centre off the art's, so two rows closer than 14 mm keep disjoint boxes (memory 3's
  up, 4's down); it must still cover the row. The art (cv-panel `trimSvg`, our own): metal discs with a screwdriver slot each at an
  angle of its own, **static** (TRIM… shows the values), one `<path>` for a row's discs and one for its slots (20 elements for the
  ten rows: the DOM budget); colours `scheme.trim { body, rim, slot }` (validated; defaults `TRIM_SKIN`).
- **The memory keys' radio** (render, cv-panel — a patch binding, not `api.drum`): the four `dr:mem` keys of a channel become one
  radio built at its first key in the Tab order — `hwButtons` over the keys' own boxes and hit boxes (the LEDs, the arrows, one tab
  stop) inside one `.hw-c` whose `data-ctl` = `data-dest` = `x<ch>p` (the mod drop, the halo, the ui entry, classic-panel's "one
  data-dest per control"); a key writes index n − 1 through `api.set` (a switch's write: presets carry it, **no History step**,
  review #1); labels "Bass Drum · Memory", "Memory 1 · our factory sound" … "Memory 4 · trimmers (TRIM…)". It works without
  `api.drum` (the patch's own).
- **Geometry**: 482.6 mm → **992** px (`ceil32(965.2)`, offX 13.5); the strip 16 + 200 (the kit) + 64 + 8 = 288 under a 304.8 px
  face → **992 × 640** (`TARGET.sdsv`; any face 140.1–156 mm deep gives 640). The cells: `dr:pads` (8, 321) 328 × 200, then MAP… 88 ·
  SOUNDS… 104 · TRIM… 88 at y 521. (§13.1's ≈ 608 was the estimate; the 200 px kit — the bass pad ≈ 116 px wide, the others ≈ 88 —
  is what makes it 640.)
- `panel-check`: grouped tokens per group (`dr:mem ch s: 4 placed`), the switches the keys write (and a warning if one is also
  placed), each trimmer row's art and hit box, labels `dr:mem#b:1`.
- Tests: `cv-drum.test` 54 → **59** (8 tokens, one mutation per rule — 40-odd —, geometry, art, the radio rendered with a fake
  api); `cv-panel.test` (`HW_IDS` + `sdsv`, `EXTRAS.sdsv`, `TARGET.sdsv` 992 × 640, `NOKEYS` + `sdsv`, the per-model "every id once"
  counting a bound switch through its keys, the xcapFit note): **89 / 90 — the `HW_IDS` pin is the known window** until X lists
  `sdsv`; with the fixture as a scratch `panels/sdsv.js` listed: **94 / 94** (valid, 992 × 640, hit boxes, original art, every
  authored model rendered, usable, determinism, the caption at 9 px), `classic-panel` 13 / 13 (one data-dest per control), `panel-check
  sdsv` valid, no overlaps, smallest hit box 80 × 28 px (a trimmer row). `classic-panel` needs no SDS-V row (no face switch). lint
  145 / 145.
- **Lead-accepted deviation** (2026-10-21, at P1a 23b9418): the memory keys are the contract's `dr:mem` token, but drawn by
  cv-panel as **one radio per channel** whose wrapper is the switch's (`data-ctl` = `data-dest` = `x<ch>p`, written through
  `api.set`, no History step) — not four `dr:` widgets of cv-drum over `api.drum`: a patch switch's binding (presets, mod drops,
  halos, the ui entry; classic-panel's "one data-dest per control"), and it works without a drum host.

**P1 phase 2 (the SDS-V's widgets, `cv-drum.js`; on P1a)** — commits 3734a03 (the code), c5abb96 (the §15.9 tests), 5b2c47e, 6faf2dc,
f3634bf (fixes from the Chrome check) and these notes. Every 808 / 606 / 909 widget and behaviour unchanged (their cv-drum tests as
they were; the panel's 808 / 606 / 909 branches untouched — the SDS-V's is a branch of its own at `widget` / `show` / `extra`).
Readings [C]:
- **Four ways**: `machOf` (`'sdsv'` the exact string), the host's session (an SDS-V session names itself, `S.m`: `changed()` with
  another machine's record starts that machine's, and back); `UI.sdsv` = `{ pads: PADV ['bd', 'sd', 'lt', 'mt', 'ht'] (the Pads
  module's 1 × 5 order, §3.5: bass drum, snare, toms 3 · 2 · 1), padG: PADSV, grid: null, dial: {}, lanes: [], scode, name 'SDS-V' }`.
- **The kit** (`PADSV` = cv-panel `DRV_PADS` 328 × 200; flat-topped hexagons `[cx, cy, r]`: bass (172, 144, 58) bottom centre,
  snare (54, 146, 44) left of it, toms 1 · 2 · 3 at (70, 56) · (172, 46) · (274, 56), r 44 — ≥ 9 px apart): pure `inHex(cx, cy, r, x,
  y)` and `hexAt(x, y)` → `{ s, v }` (the velocity from the touch's height in its hexagon: `padVel`, back 0.30 … front 1). One music
  zone; the hit test at the cell's local point (`wk.localPoint`: any zoom), so a press between pads or in a hexagon's box corner
  plays nothing; every press its own hit (`DR.pads.on`), the off at the pad's last lift; each pad its own flash parity; the
  monitor's lights by sound id; Enter / Space at 100 / 127, the arrows walk tom 1 → 2 → 3 → snare → bass (wrapping); pads one
  element each (the code by CSS, the hexagon a `clip-path`, the channel's colour `--pc`: bass red, snare amber, toms violet / green
  / blue [C]). **P-4**: each pad's aria text and tip name its channel's soft-hit threshold at the SENSITIVITY knob ("SENSITIVITY 1.0:
  hits below velocity 18 fire nothing (low settings ignore soft hits, as on the original)"; "every hit fires" from 2.1), following
  the knob (`api.watch`) — `minVelV(s)` is a copy of dr-808.js `Dr808.proto.sdsv.minVel` (a classic worklet script, not importable
  on the page), equal at 101 SENS values by a test in a dsp-scope; `CH_OF_V` likewise.
- **The trimmer rows**: a transparent button over the face's art (`dr-trim`), its hit area the geometry's (`--hit-w/-h`), moved by
  `hitOff` (`--hit-dx/-dy` on its `::before`, cv-drum's CSS); a tap (`A.tap`: a pinch starting there opens nothing) opens TRIM… at
  that channel and memory; `aria-haspopup="dialog"`, `aria-expanded` while it is open.
- **TRIM…** (a popover; `.dr-trimpop`): in the top layer when the panel is on the canvas (`wk.layer`, fixed at the anchor, a camera
  move closes it: `wk.addTransient`), else the document's body; tabs per drum (one tab stop, the arrows); "Memory 1 · our factory
  sound" → Copy to knobs (the knobs' models.js defaults = FACTV × 10, no FACTV copy needed); Memory 3 / 4 → six small `wk.knob`s
  (drum-core `trim` presses: record writes and a send, no notice / History step — review #1), **Store knobs here**
  (`trimFromKnobs`, the six knobs / 10), **Copy to knobs** (the six knob writes **and the channel on memory 2** [C]: the same sound,
  now from the knobs, where modulation acts); the row the channel plays marked "· playing"; a note on what the memories are and
  that edits stay out of Undo. Escape (focus back on the row), ✕, a press outside, the same row again, destroy close it; after a
  finger's tap the browser's click focuses the row, so the focus is put back into the popover on the next task.
- **`DRUM.rec(tr, sound, v, ts)`** (the host's `rec`): the pads' REC branch (`press({ k: 'pad', sound: i, f: frac(…), v })`)
  without the note and without `sel()`; `sound` the key (`'sd'`), v 0…1; → true when it wrote (REC on), false otherwise (no record,
  an unknown sound, REC off — the SDS-V's REC is forced off).
- **The caption** (fixed here, cv-panel): Chrome measures the SDS-V's 157 characters at **976.5 px at 9 px in its 976 px room**
  (its capitals wider than the plain caption's: 0.972 of the estimate, not `XCAP_K` 0.935) — `xcapFit(text, room, k)` takes the
  calibration, and render reads **a model's own caption on the plain estimate (k 1)**: the SDS-V at **8 px (827 px)**, the 909 as
  before (8 px), every other strip unchanged; 585's list is `['sdsv', 'solina', 'tr909']` once `sdsv` is authored (the test reads
  `authored`).
- **Not done (not P1's file)**: §11.5's "the knob's tooltip says so when the channel is on another memory" — the face knobs' tip is
  classic-panel's (`label: value`); the memory radio's labels say which memory plays the knobs, and TRIM…'s note.
- **DOM**: the fixture face in Chrome **523 elements** (369 live + 154 face SVG); X's face SVG must stay ≤ ≈ 330 for §13.2's 700.
- **Tests**: `cv-drum.test` 59 → **64** (tables + the machine's minVel; the host four ways + `DRUM.rec`; the render with and
  without `api.drum`, DOM, determinism; the kit by touch at three zooms; TRIM…) — 21 mutations tried, each caught. Gates (node 24,
  one file at a time): cv-drum 64 / 64, cv-panel 89 / 90 (the `HW_IDS` window; **94 / 94** with the fixture as a scratch
  `panels/sdsv.js` listed, the caption at 8 px), classic-panel 13 / 13 (and with the scratch layout), lint 145 / 145, drum-core
  153 / 153, cv-face 26 / 26, canvas-1i-sim 20 / 20, cv-fixes-sim 5 / 5, main 43 / 43 (those four with the scratch layout listed);
  canvas-7a / 7b / 7c-sim fail at their Drums-view pins (X's window, `['tr808', 'tr606', 'tr909']`; the 7c sim's later tests
  cascade from its first) — **23 / 23, 15 / 15, 13 / 13** with those lines scratch-edited to list `sdsv`, then reverted.
- **Headless Chrome** (`--headless=new --use-angle=metal --force-device-scale-factor=2`, CDP; the real ClassicPanel → cv-panel →
  cv-drum over the real drumHost with stub deps — an SDS-V record, logs of notes / sends / monitor —, the fixture face; scratch
  `8/p1/`: `serve.mjs` on 8931, `cdp.mjs`, `harness.*`, screenshots in `shots/`; server and Chrome stopped): 1440 × 900, 1366 ×
  1024, 1024 × 1366 — the body 992 × 600; DOM 523; a mouse on the snare's memory 3 and a finger on tom 2's memory 4 (the LEDs, the
  patch, `changed` the switch ids only); the kick's back edge v 0.315, its front 1, between pads and in its box corner nothing;
  two fingers on tom 2: two hits, held, one off at the last lift; the monitor flashes tom 1; the bass pad's tip and aria at SENS
  1 ("below velocity 18"); a trimmer row's hit area 80 × 28 px 6 px above its art, a cancelled touch opens nothing, a tap 10 px
  above the art opens TRIM… at the snare, a knob's ArrowUp writes the record and one send (no notice), Copy to knobs (the knobs =
  memory 3, memory 2), Escape, TRIM… at the last channel, a press outside; TRIM… on screen at each viewport with the focus in its
  row; `?nohost` the kit / rows / TRIM… aria-disabled; **no console error, exception or CDP log error**.

**For H**: `DRUM.rec(instView, sound key, v 0…1, ts)` → bool (no note; call it beside the note path when the target machine's REC
is on — the SDS-V never writes); `cvDrum.UI[m].pads` for every machine (the SDS-V's `PADV`, 5 columns, one row); the SDS-V's
session is `{ m: 'sdsv', run, play, bpm }`; the memory keys are the patch's switches `x<ch>p` (index 0–3) — a `valChanged`
like any knob, no History; TRIM… edits go through `drumPut` (no step) and re-send the payload (its `pk` changes with `trim`).

### Lane X (satellites: `panels/sdsv.js`, `panels/index.js`, `cv-art.js`, `cv-tray.js`, `cv-migrate.js`, `song.js`, their tests and the pins; 2026-10-21, base 23b9418 = P1a)

Five commits: **X1** the panel (`44f2ad6`), **X2** cv-art (`0bb7f65`), **X3** cv-tray (`1bf3d53`), **X4** schema 11 + song (`71f2a6f`), **X5** the sims' pins (`13a570a`).

**The panel** (`panels/sdsv.js`, listed last in `panels/index.js`): one area `main` `src [0, 0, 482.6, 152.4]` → **992 × 640** (`panel-check sdsv`: valid, no overlaps, smallest hit box 76 × 28 px
(a trimmer row), the 40 knobs + 20 `dr:mem` + 10 `dr:trim` placed, the five `x?p` switches placed by their keys only, extras 4 · live 70 · inert 23 (the 5 OUT jacks `'later'`, the other
18 dimmed) · decor 179). **No photograph was fetched or committed** (viewing needs a download, which the user has not approved in this session): the positions are the contract's
§13.1 fallback layout drawn in mm — **estimates, not measurements** — and the file's `notes` say so; a later pass with a published photograph (viewing only) can retune x / y /
sizes without touching an id (the hit-rule constraints below must stay). Readings [C]:
- **Geometry**: rack ears 18 mm (two slotted holes each); the rear strip y 0–13.4 (▲ + legend over each socket); five cards at x 25 + 50 i (50 mm), the HI-HAT / CYMBAL blanking
  plates at x 275 / 325 ("OPTIONAL MODULE", a dimmed inert slot each: a tap says "HI-HAT MODULE (optional on the original) — not emulated"), the MIXER x 375–457. A card: the name plate
  y 15.6–21.8; the six knobs on x + 14 / x + 36 and y 36.5 / 56.5 / 76.5 (d 12.5, an 11-tick ring, legends NOISE · TONE / BEND · DECAY / NOISE / TONE · CLICK / DRUM decor, `lab: 'none'`);
  MEMORY print, the four keys **11 × 11 mm** cream squares on a 15 mm pitch (key 1 top left; y 98 / 113; the digit is `onCap` under the cap's LED); TRIM print, the two trimmer rows
  (`dr:trim` 36 × 5 mm, d 4.5, `hit [38, 14]`, `hitOff` ∓ 3: memory 3's box 121–135, memory 4's 135–149; the keys' lowest box ends at 120.5) at y 131 / 139 with their numerals 3 / 4;
  the TRIGGER IN jack and legend at y 146.8. The mixer: SENSITIVITY (y 48) and LEVEL (y 90) on x 383 + 16 i (d 10.5), the channel names over each row, "SDS-V" in plain type (no
  wordmark, logo or maker name: D4), "5 CHANNELS · 4 MEMORIES EACH".
- **Sockets**: OUT jacks at the cards' centres (`BASS OUT` … `TOM 3 OUT`, `inert: 'later'`); STEREO L / R, MONO, HI-HAT PEDAL, PAD IN 1–7 (x 381 + 11 k) in the top strip and a TRIGGER IN
  under each card as dimmed inert jacks (our placement: the real ones are rear XLRs).
- **Skin**: face #25272a, card plates #1c1e21, name bars #34373c, knobs light grey `#d6d8d4` with a dark pointer, cream keys `#efe6cf`, red LEDs `#e0281e` (off `#4a1612`), metal trimmers
  (`scheme.trim`). Previews (the session scratchpad, `8/x/`): `sdsv-real.png` (the real app, headless Chrome at 2×: the module as the page draws it), `sdsv-check.png` (panel-check's SVG),
  `tray.png` (the Drums view's tiles), `art.png` (the tile at three sizes + the Pads glyph).
- Until P1's phase 2 lands the extras strip of an SDS-V track shows the 808's pads (machOf three-way): expected.

**`cv-art`**: `SIL.sdsv = { body: 'box' }` (no steps), `DRAW.sdsv` — a dark rack box (ears, charcoal face) with five voice cards (a name bar, 2 × 3 light-grey knobs with their pointers, a 2 × 2
square of cream memory keys with key 2's LED lit, two rows of small trimmers), two blank plates, the mixer (ten small knobs, a rule for the name) and **three hexagonal pads in front**
(the bass drum's centre one larger, with a lit red hexagon); no text; the chip keeps a key, a knob and the centre pad. **`glyph('pads')`**: a 3 × 3 of rounded squares, one lit
(`GLYPHS` + 1; the tray's tile has its own 40 × 28 copy in `CTL_GLYPH`, as the Modulators' glyphs, so `.cv-mglyph` styles it). Tests: counts (30 + 10 knobs, 20 keys, 5 lit LEDs, 2 blank
plates, 7 polygons), chip < tile, no maker / model name in the drawing, the glyph's 9 rects and one `currentColor` fill, `tileMeta('sdsv')`.

**`cv-tray`**: `SRC_VIEWS` gains `{ id: 'ctl', label: 'Controllers', tip, note, sections: [{ id: 'ctls' }] }` after Drums (the menu: Hardware · Simple · Serum · Drums · Controllers); the Drums
note is "More machines later."; the SDS-V's Drums tile: meta "1981 · drum synth" (`DR_META`), a tip saying its sounds are ours and it has no sequencer (`DR_TIP.sdsv`), no maker word, no
SIMPLE badge. **The Controllers row** (§1.2, review #16): `o.ctls` (`CTL_TILES` = `[{ id: 'pads', name: 'Pads' }]`) in `o.ctlsEl` / `o.ctlsSec` (without the element: an `h3.cv-chead`
"Controllers" and the tile after the synths in the list), one `button.cv-tile.cv-mtile[data-ctl]` (glyph, name, `span.cv-treason`); a tap → `(o.ctlPick || o.modPick || o.pick)(id, mode)`;
a drag → `(o.ctlDrag || o.modDrag || o.drag)` with `info.ctl = true` (not `info.mod`), `info.over` `'canvas'` or null, `info.at` from `o.toWorld`, the ghost hidden while
`(o.ctlCanvasGhost || o.modCanvasGhost)()`; **`setPlaced('pads', reason | null)` is honoured** (the same `setPlaced` as the modulators': the tile is not `multi`); `ctlTiles()` /
`ctlTile(id)`; the row shows only in a view with a `ctls` section; a stored view `'ctl'` opens Controllers, an id an older build does not know opens Hardware (`viewOf`'s fallback).
Tests: the five-view menu, the renamed fictional view (`'later'`, appended after five), the Drums view (four machines, the SDS-V's tile text and tip), and three new ones (the view and
its row, the drag, `setPlaced`) — `cv-tray` 31 → **34**.

**`cv-migrate` / `song`** (§10.2): `SCHEMA = 11`, `STEPS[10]` additive, its header line; `toV1` drops `pads` with the lost-line **"the Pads controllers (N)"** (after the Mod Wheel's, only
when there is a module; the pad mod rows are each track's "N modulation cables"), an SDS-V track's line is the existing drum line ("SDS-V track “Drums”: the live site has no drum
machine — its piano-roll notes are kept", by `isDrum` / `MODELS`: no code). `song.deserialize`: `if (Array.isArray(o.pads)) p.pads = normPads(o.pads)` — pads-core's bounds; absent or not an
array: **no key** (a project without Pads reads exactly as before); `serialize` and History's project snapshot (the project without its tracks) carry it as they carry `perf`.
Tests (`cv-migrate` 56 → **61**): the moved pins (`SCHEMA` 11, the 7a / 7b / 7c schema tests' `[11, 11]`, `up.p.schema` 11, the read-only rows shifted one, the 7c store seeded with
`STEPS[9]`'s schema-10 project: "a schema-9 build opens it read-only" keeps its meaning) and five new ones: schema 11 (a 10 opens as before with its pads and sdsv record intact, an 11
opens read-only in a schema-10 store, a 12 here), `deserialize` of pads (round trip = `normPads`'s records, idempotent, ≤ 8 modules / 64 pads, hostile input and a hostile getter, a
hardware binding unique, a target on a missing track kept, History undo / redo, a main project: no key), the SDS-V's `normDev` (record bounded and idempotent, the other machines' records
untouched both ways, hostile input), MIDI (an SDS-V exports on channel 10; a channel-10 import is an 808 track), the lost-lines (pads, SDS-V, the mirror, `splitTracks`).

**Pins** (none weakened): `canvas-7a-sim:68` / `canvas-7b-sim:77` / `canvas-7c-sim:85` (the Drums view: + `'sdsv'`), `canvas-7c-sim:643` / `:655` (schema 11; a schema-9 store reads an 11), `canvas-sim:518`
(the menu's labels + Controllers), cv-panel's `HW_IDS` (closed by listing `sdsv`: 94 / 94).

**Gates** (one file at a time, `--max-old-space-size=2048`): `panel-check sdsv` valid, 992 × 640, no overlaps · `cv-panel` 94 / 94 · `cv-drum` 59 / 59 · `classic-panel` 13 / 13 · `cv-art` 4 / 4 ·
`cv-tray` 34 / 34 · `cv-migrate` 61 / 61 · `canvas-7a-sim` 23 / 23 · `canvas-7b-sim` 15 / 15 · `canvas-7c-sim` 13 / 13 · `canvas-sim` 22 / 22 · `appstore` 25 / 25 · `cv-module` 57 / 57 · `lint` 147 / 147 ·
`golden-presets` 8 / 8 (deserialize's reader; every golden is untouched: no DSP). **Known window**: `pwa.test`'s precache check until the lead's `node tools/precache.mjs --write` (new
`panels/sdsv.js`; `pads-core.js` is reached through song.js; no `sw.js` in these commits).

**For lane H**: (1) the tray wiring — `shell.tiles = cvTray.sourcesTray(…, { …, ctls: cvTray.CTL_TILES, ctlsEl: $('#srcCtls'), ctlsSec: $('#srcCtlSec'), ctlPick: id => modAdd(id, null),
ctlDrag: modTileDrag, ctlCanvasGhost: … })` and `shell.tiles.setPlaced('pads', n >= 8 ? '8 Pads modules in this project' : null)` (the section element goes into `index.html` after
`#srcModSec`, hidden like it — **not in X's row: H adds it**, with its CSS only if `.cv-mtiles` does not already serve); without the elements the tray makes a heading and puts the tile after the
synths, so nothing breaks first. (2) `loadProject` / `freshProject`: `deserialize` already bounds `pads`, but a project built by other means still needs `p.pads = PC.normPads(p.pads)` and the
missing-module row drop (review #28). (3) The SDS-V face and its extras are P1 phase 2's; the panel lists `dr:pads` (328 × 200), `dr:map`, `dr:sounds`, `dr:trimMenu` and the 20 keys / 10 trimmer
rows are live without `api.drum` (the keys are the patch's switches). (4) The estimate caveat above: if the user wants the photographed layout, `panels/sdsv.js` is the one file to retune.

### Lane H (host; phase 2, base 5be58fe = wt-8 after phase 1)

**Files**: `main.js` (§14.1 row by row), `index.html` (the Controllers section only: `#srcCtlSec` / `#srcCtls` after `#srcModSec`, hidden;
`.cv-mtiles` serves — no CSS), `classic-panel.js` (§11.5's tip), `tests/canvas-8-sim.test.mjs` (new, accessor-free, 12 tests),
`tests/main.test.mjs` (+1), `tests/classic-panel.test.mjs` (+1). Commits 7a48318 (the lead's fixture check, failing first) → 6ff93bc
(main.js + index.html) → 810e56d (classic-panel) → faeeb48 … 1c88832 (the sim) and 8b13596 (main.test). No `sw.js` commit.

**As built** (main.js): `noteOn(n, v, src = 0, ts, trs = targets(src), o)` — the keyboard / MIDI / beds / drum-host callers unchanged
(their messages and `held` entries byte-identical: main.test's new case and the 43 old); `o.rec === 'target'` records the target
armed or not and adds it to `T.padRec` (cleared at a take's start), which `replaceSweep` and `recCC` take with the armed tracks.
`numSrc` / `heldSel` / `heldLit`: the `held` loops of `panic` and `selectTrack` skip a `pd<k>` key explicitly; `noteOff`'s light test,
`buildKeys`' lit set, PERF's `held` dep and `perfLetGo` count a key that reached the selected track (a numeric source, or a pad key
whose entry names it). `PADS = cvPads.padsHost({…})` beside DRUM with U's deps table; `release({ hw: true })` at `panic` and
`powerOff` before their loops and at `applyRestore`'s top, `rebuild()` after it; `release()` at a blur / hidden page (+ `hwDark()`
hidden); `endTrack(id)` at `deleteTrack`; `transport(on)` at ▶ / ■; `resync()` in `host.shown` before `monitors.sync()`.
`drumMonitor`'s live `… || PADS.wants(id)`. The canvas: `kindOfKey` / `modKindOfKey` ('pads'), `cvDevices` (U's entry: `jacks`,
`color`), `host.size` (`moduleSize`), `cvTitle` ("Pads 1", "every track", chip "4 × 4"), `cvMenu` (the body's items, Fold · Bring to
front · Delete · Tidy), `modMount` (`padsBody`, kept in `modBodies` with `kind 'pads'`: `modUnmount` destroys it, `cvModSync` syncs
it), `padsAdd` / `padsDelete` (one step each, "tap to undo"), `modSpot` / `modClear` / `modTileDrag` at the footprint, `modLabel`
(`CMOD.padSrcLabel`), `modSrcPick` (hidden sources left out), a note cable's tap (`padsNoteTap`: its pads listed, a pick →
`B.inspect`), `cvModDecor`'s `setPlaced('pads', …)` at 8, the tray's `ctls` / `ctlsEl` / `ctlsSec` / `ctlPick` / `ctlDrag` /
`ctlCanvasGhost`, the `sleeptap` hint "Zoom in, or double-tap the module, to play it" for a Pads module (§2.3). `loadProject` /
`freshProject`: `normPads` then `CMOD.prunePads` (after `normDevs`); `buildMods` passes `padVal`; the midi host `padIn` / `ports`
(the footers' hardware dots follow a plug); `__synthTest.cv.pads` / `padsBody(id)` / `padLit` / `loadProject` / `applyRestore`.
classic-panel: `memNote(id)` — an SDS-V card knob (`x<ch>` + n t b d m c) whose channel's `x?p` ≠ 1 tips "Tone: 4.5 · heard on memory
2; this channel plays memory 3" (both layouts: cv-panel binds its knobs through `dragB` → `tipB`; SENSITIVITY / LEVEL never).

**[C] readings / deviations** (each tested):
1. **`selectTrack` calls no `PADS.release()`**: U's host releases latches with it; the old view's body destroy (`attach`'s off) ends
   that view's pointer and key holds — §14.1's "(canvas pointers only)" exactly; a latch and a hardware hold survive the switch.
2. **`applyRestore` releases with `{ hw: true }` at its top** (not the plain `release()` of §4.2): the notes end while their tracks
   are still the project's (a track the undo drops included — after `project = p` its `noteOff` would find no track); then
   `rebuild()` (§10.3) and `padLitAll()`.
3. **`deleteTrack` → `endTrack(id)`** (U's) rather than a full `release()`: other pads' holds on other tracks keep sounding.
4. **The key light / PERF `held` rule is "reached the selected track"** for all four sites (§14.1 said "numeric source" for PERF's
   dep and `perfLetGo`): `noteOn` lights the tray and the bed (`keyVis` → `PERF.lit`) for a pad playing the selected track, so a bed
   mounted mid-hold and a blur's re-light agree with it; a pad on another track never lights either.
5. **The drum lights go through main's `padLit`** (one `DRUM.api(view).lit` per track for every host subscriber): `drumForget` (a
   Replace, a delete) forgets the drum host's entry and its `lits` with it while the host's `dsub` still holds the old off — so the
   track's next machine is subscribed again by `padsRefresh()` (end of `setTrackModel`, `deleteTrack`) / `padLitAll()` (restore).
   The view is the track's first drum machine (`cvPads.drumDev`), not `CMOD.primId` (equal with one instrument per track).
6. **`inputSub` is main's `padIns`** fed by `inputNote` (not an `inputSubs` entry): `deleteTrack` drops `inputSubs.get(id)`, which
   would silence the host's subscription on an undone delete.
7. **`changed({ id, drop })`**: rows of `drop` go (`dropPadRows`) in the edit's step and those tracks get `queuePatch`; the tracks
   holding rows of the edited module's pads get `modVal(…, PADS.value(src))` (a rest value / range edited: the table now — no
   repost); then `cvRender` (size, jacks, title, cables, tray) and the save.
8. **`modLabel` of a pad source is Q's `padSrcLabel`** ("Pads 1 · Kick": the Connect to… menu's text) — U's `srcLabel` / jack labels
   say "Pads 1 · Pad 1" for an unlabelled pad; one wording should win (reviewers).
9. A project without Pads modules now carries `pads: []` (as `perf` does since 2a) in autosave / History; compiles and posts are
   unchanged (canonical-stream, the D5 case of the sim).

**Gates** (node 24, one file at a time, `--max-old-space-size=2048`): **canvas-8-sim 12 / 12** (the fixture check; placement / drop /
one undo / Grid… / the 8th; the 808 from track 2, two fingers two hits, lights at the heard time with `wants`; a chord; Q5 + replace
mode + drum REC; mod pads on two tracks, no repost; the Pencil; a fake Web MIDI port — learn, play, no channel dispatch, light-back
bytes, a track switch, unplugged; every D9 path + the tray light; schema 11 round trip, pruning, a schema-12 file, D5's compile; the
SDS-V face, memory key, TRIM…, hex pads, MIDI 36, MAP…, a slot, a Pads module 1 × 5; 808 ↔ SDS-V ↔ 909 ↶ ↷ twice plain and graphed,
the bounce's trims, a Replace under drum pads re-subscribing — 5 deliberate main.js mutations each caught: no `wants` in the monitor's live, `replaceSweep` without `padRec`, the old key-light test, `panic` without the host's release, no re-subscription after `drumForget`), **main 44 / 44**,
canvas-sim 22, canvas-1i-sim 20, canvas-1e-sim 24, canvas-2a-sim 26, canvas-2b-sim 23, canvas-3-sim 26, canvas-7a-sim 23, canvas-7b-sim
15, canvas-7c-sim 13, cv-fixes-sim 5, cv-shell-sim 16, cv-pads 21, cv-tray 34, midi 34, integration 44, canonical-stream 1, golden-graph
6, lint 149, accessors 30, classic-panel 14, **pwa 22 / 22 with `node tools/precache.mjs --write`** (cv-pads.js and panels/sdsv.js now
precached; BUILD fe5db3094520) — `sw.js` checked out again (the lead's write).

**Headless Chrome** (CDP, `--headless=new --use-angle=metal --force-device-scale-factor=2`, touch emulation, the real app from a copy of
the worktree on a no-store server, 8946 / 9246; scratch `8/h/`: `cdp.mjs`, `serve.mjs`, `site/`): the view menu Hardware · Simple ·
Serum · Drums · Controllers; the Drums view's four machines; the SDS-V replaces the Minimoog; the Controllers row in its own section;
a tap adds Pads 1 following the SDS-V (1 × 5, Bass drum … Tom 1 (high)) left of it with its note cable (a second run's Pads 2 stacked
under Pads 1); two fingers on two pads both held, released; a mouse click; the SDS-V's snare hex pad by touch; ✎ Edit → a tap selects
pad 3 and opens its inspector, ✓ Done leaves; 1366 × 1024 a pad tap; **no console error, exception or log error**. Screenshots
`8/h/{boot-1440,h-1440x900-added,h-1440x900-held,h-1440x900-edit,h-1366x1024}.png`; Chrome and the server stopped.

**For the reviewers**: (a) `panic` / `powerOff` / `applyRestore` order (host first, then the loops); (b) the `padLit` indirection
and `padIns` (5, 6 above) against U's `dsub` / `nsub`; (c) the tray / bed light rule (4); (d) a Pads body as a `modBodies` entry
(`kind 'pads'`: the loops over `modBodies` filter by `B.kind`; `cvModSync` calls its `sync` — a re-render, harmless); (e) `padsChanged`'s `mval` on edits (7).


### Fixes (reviews 1 + 2, against 4816a1e; merged on wt-8 as 7a76b9b (C), 8fe022e (A), c30a34f (B))

Reviews: `scratchpad/8/review-1.md` (real engine: 0 blocker, 1 major, 5 minor, 2 nits) and `review-2.md` (headless Chrome: 0 blocker, 3 major, 6 minor, nits). Every fix failing-test first. Open by decision: R1-C's light-back while ROLL hides the canvas follows the visible modules (§6.2; a 'gen' light-back on ROLL is a later item); R2-F9 re-places x only (a taller module may cover its column on other tracks until Tidy, the accepted overlap).

#### Fixer C (stage "7d + 8"): notes

Worktree `agent-a993a463b404224c9`, base 4816a1e, head **4bf970d**. Seven commits, each failing test first. No `sw.js`, no `docs/`.

## R1-F = R2-F7 — the SDS-V Pads order (2815fc2)
- **Which tom is which** (checked, not assumed): sound id 4 `ht` = tom 1 (the highest; `CH_OF_V[4] = 2` = channel `1`, the 3rd card), id 3 `mt` = tom 2, id 2 `lt` = tom 3
  (`CH_OF_V[2] = 4`); `PADSV` puts `ht` left (x 70), `mt` centre (172), `lt` right (274).
- **Test**: cv-drum.test "8 tables": `UI.sdsv.pads` = `['bd','sd','ht','mt','lt']`, their sids `[0,1,4,3,2]`, their channels `CH_OF_V` = `[0,1,2,3,4]` (the cards b s 1 2 3), the kit x ascending for tom 1·2·3;
  "8 render" the kit's `data-code`s BASS · SNARE · TOM 1 · TOM 2 · TOM 3 with their colours.
- **Fix**: cv-drum.js:172 `PADV = ['bd', 'sd', 'ht', 'mt', 'lt']` (+ the comment above it). `PADSV` untouched (the hexagons keep their places).
  Readers of PADV: `hexAt` (the hexagons are disjoint: order irrelevant) and `kitCell` (DOM / reading order only — the roving tab stop is on `bd`, the arrows use `KEYV`).
- **Pins that moved** (mine): cv-drum.test (2 tests), canvas-8-sim.test:430 (the kit's DOM order), :449 (Enter on the hexagons in DOM order now plays 36,38,48,45,41), :472 (the Pads module 1 × 5 `bd,sd,ht,mt,lt`),
  :476 (the test pressed pad index 4 for "tom 1"; tom 1 is now index 2).
- **Not mine, will fail until fixer A moves it**: `tests/pads-core.test.mjs:322–323` (`defaultsFor` with `CD.UI.sdsv.pads` expects `bd sd lt mt ht`; it now reads `bd sd ht mt lt`; line 324 is A's colours).
  canvas-8-sim:472 may also be touched by A (labels "Tom 1" …): a one-line merge at most.

## R2-F4 — TRIM… off the bottom (baa4e65)
- **Test**: cv-drum.test "8 TRIM… stays on screen": the box's `offsetHeight` stubbed as in Chrome (90 px before its rows exist, 473 after), the anchor placed at `vh − 60` → the top must put the bottom at or above the row
  and ≤ `vh − 8`; room below → opens 4 px under the row; no room either side → kept inside; the TRIM… button too. Failed before (bottom 1119 of 800).
- **Fix**: cv-drum.js:1388–1393 (`openTrim`): `pop = P; build();` first, then measure `box.offsetHeight` and flip / clamp (same rule as before: `max(8, min(ar.top − 4 − bh, vh − 8 − bh))`).
- **Chrome** (1440 × 900, k 0.8): Tom 2's memory-4 row at y 550–558 → the popover top 73, bottom 546 (it was top 562, bottom 1035); from the TRIM… button at y ≈ 570–620: top 104, bottom 577.

## R2-F5 — 753 DOM elements (4bf970d)
- **Test**: cv-drum.test "8 the real panels/sdsv.js …": renders the authored `P.layoutOf('sdsv')` (`mount(…, { real: true })`) and counts
  `live (fake DOM) + 5 × 40 knobs (classic-panel's innerHTML svg: svg, skirt, g, cap, pointer — the fake DOM does not parse it) + face SVG elements + 26 (bar 22 + 4 wrappers)`.
  The model reproduces Chrome's number exactly: 188 + 200 + 339 + 26 = **753** before; asserts ≤ 700. Also bounds the face's `<line>` (≤ 8) and `<path>` (≤ 40) counts so one element per rule/tick can't creep back.
  (The fixture-face count in "8 render with api.drum" is kept; it is not the authored face.)
- **Fix**: `panels/sdsv.js` only — **cv-panel's shared art code is untouched**, so every other model's face SVG is byte-identical
  (`sha256` of `decorSvg` for all 16 `HW_IDS` before / after: only `sdsv` differs).
  The thin art goes into grouped decor paths, one per colour and width: the 40 `<line>`s → 5 paths (ear lines ×2, strip shadow, EDGE rules, card/plate edges);
  16 ▲ → 1; 6 screw slots → 1 (stadium path); the 2 plates' screw holes → 1; the 40 knob tick rings (`scale: { n: 11 }` on the 40 knobs, removed from the control data — geometry-neutral:
  `scale` only drew the ring when `lab: 'none'`) → 1 decor path computed in the file (`ring()`, scaleSvg's math). Groups are drawn after the plates they sit on.
- **Numbers**: face SVG 339 → **244** elements; decor items 179 → 124 (panel-check); the module in Chrome **753 → 658** (bar 22, `.hw-decor` 246 incl. its div, `.hw-ctls` 371, extras 15). `panel-check sdsv`: valid, 992 × 640, no overlaps, smallest hit box 76 × 28 px.
- **Pixels (SDS-V only)**: old vs new face drawn at 2× in headless Chrome: 11 613 of 2.38 M pixels differ, max 10 / 255, all on 1-px edges (the card edge lines were drawn twice before, the stadium vs rounded rect, tick AA); nothing structural.
  Scratch: `scratchpad/8/fc/compare.html`, `base/` and `new/`.

## R2-F10 — the hex pads' tip (b50eb82)
- **Test**: cv-drum.test "8 the kit by touch": the tip text is one short line `Tom 1 (high) · front edge loudest · SENS 0.0: below velocity 34 is silent` (≤ 80 chars; the aria text keeps the long form), and the rect the shared tip is given is pulled inside the window
  (pad at the left edge / right edge: centre ± the text's half-width stays in [0, innerWidth]; in the middle: centred on the pad as before). `fakeApi` now also records the rect (`tipAt`).
- **Fix**: cv-drum.js:1210–1225: `thrTxt(c, short)`; `tipIn(el, text)` hands `A.tip` a rect-like object (`getBoundingClientRect`) whose centre is clamped by the text's estimated half-width (3.6 px × chars + 10) — main.js's `tipText` is untouched (only reads the rect).
  Touch: no tip (as before; the repo has no long-press tip idiom for this; aria carries it).
- **Chrome**: bass hex pad at x ≈ 204 (tip would have started at ≈ −46): tip left 20, right 521 of 1440.

## R2-F11 nits
- **Caption** (a3e8e44): `TOKENS.sdsv.caption` = `XCAPTION + ' · Factory sounds: ours, through our model of its circuits'` (cv-panel.js:165; it was `XCAPTION_DRUMS + …`, which said "Sounds: our model of the circuits" too).
  157 → 121 characters with the dimmed note, so it **fits at 9 px** on the plain estimate: the 8 px step-down for the SDS-V is gone (cv-panel.test: only `solina`, `tr909` step down; the cv-drum geometry / render / token / validate pins follow).
- **MIDI button** (5a5047b): midi.js:360 lists only inputs whose `state !== 'disconnected'` (Chrome keeps an unplugged input in the map); test in midi.test "8 §8.2": disconnected → `MIDI: Pad A` / the plug-in hint with the title, reconnect → listed again.

## R1-H — headroom gate (9e3a35e)
- engine-track.test "8 §12.4": the list gains `[44100, 1]` (title and comment too). Passes as is: 44.1 kHz × 1 RMS −19.77 dBFS (−0.39 dB re the 808's), pre-limiter peak 0.815 (−0.78 dB re the threshold), limiter gain 0.00 dB.

## Gates (one file at a time, `--max-old-space-size=2048`, at 4bf970d)
cv-drum 66/66 · cv-panel 94/94 · classic-panel 14/14 · midi 34/34 · cv-face 26/26 · canvas-7a-sim 23/23 · canvas-7b-sim 15/15 · canvas-7c-sim 13/13 · canvas-8-sim 12/12 · engine-track 78/78 · golden-drums 5/5 · golden-606 11/11 · golden-909 9/9 · golden-sdsv 5/5 · golden-presets 8/8 · lint 149/149 · cv-pads 21/21 · `panel-check sdsv` valid, no overlaps.
**pads-core 19/20**: the pin at :322–323 above (fixer A's file).

## Left open / for the lead
- pads-core.test:322–323 (A) — see above.
- Process note: the scratch folder name `fc` trips the worktree sandbox's command checker when it is the last path component (`…/8/fc` or `…/8/fc/`); files inside it work.
- I overwrote `scratchpad/chrome.sh` (a 2-line exec wrapper for Chrome; same purpose) with the Write tool — it existed already.
- Not re-verified in Chrome: F4's tab-switch case (rows are the same height per tab; placement runs once at open, as before).

#### Fixer A — stage "7d + 8" (pad controller), against 4816a1e

Branch `worktree-agent-a97042933870025e2`. Commits: 5e658cf (failing tests first) → 3abf69e (pads-core / cv-mods / cv-module) →
db2f09f (cv-pads) → 5ba65d4 (pin: the SDS-V default in its panel's order). No sw.js, no docs, no main.js / cv-drum.js / canvas-8-sim edit.
Every test below was seen failing at 5e658cf (pads-core 3, cv-pads 12 incl. two updated old pins, cv-module 2, cv-mods 1), green after.

## Per finding (test → fix, file:line at the head)

- **R1-A** mod value ignores edits. Test: cv-pads.test "R1-A …" (gate pressed once then lo 0 → 0.4; toggle left on: hi edit follows,
  then gate → rest; Modulation off / on; module deleted and an id reused; a restore via `rebuild()`), asserts `value()`, the last
  `modVal`, the light. Fix: `modSync(keepOn)` cv-pads.js:223 — a source whose pad lost / changed its mod drops its state (rest = new lo),
  except a toggle left on in a toggle (on at the new hi; edit only); posts the changed value. Called in `edit()` after `endStale`
  (keepOn true) and in `rebuild()` after `release({hw})` (false: a restore's toggle starts at rest). `padsChanged` (main) still posts
  the edited module's values too (same numbers, harmless).
- **R1-B** stuck aftertouch. Test: "R1-B …" (pen pressure then `release()` / `release({hw})`; hardware pad's note-off; two hardware pads on
  one track; lost port; no spurious 0 when nothing pressed). Fix: `atSet` / `atEnd` cv-pads.js:238–245 (`atCur`: the pressure last queued per
  track; a hold that carried `at` ends → a 0 when no other live hold carries that track); `release()` cv-pads.js:534 sends the queued
  closures instead of `atQ.clear()`; `endTrack` drops the deleted track's queue. The bed's own `at(0)` and `atEnd` share one queue slot → one 0.
- **R1-E = R2-F8** one name. Test: pads-core "R1-E padSourceName", cv-pads "R1-E one name …" (srcLabel / jacks + " out" / cv-mods
  `padSrcLabel` / `sourcesOf` agree; "Pads 1 · Kick", SDS-V "Tom 1", hidden "Pad 41"), cv-mods "R1-E …", cv-module "R1-E a jack's label follows
  its entry". Fix: `padSourceName(project, M, i)` pads-core.js:294 (= Q's wording, incl. its hidden form "Pad 41"); cv-mods.js:502–510 call it
  (its private `padName` gone); cv-pads `srcLabel(pads, src, project)` :87 and `moduleJacks(M, title, project)` :94 call it (no project passed:
  the last host's, module-level `hostProj` — so main.js:6494's `moduleJacks(M)` needs NO edit; passing `project` there would be the explicit form);
  cv-module `setJackLabel` cv-module.js:507, called with `setJackHide` in `decorate` (every sync / refresh; jsig unchanged → no rebuild).
  The old pins "Pads 1 · Pad 1 out" / "Pad (hidden)" in cv-pads.test moved to the new wording.
- **R1-F = R2-F7 (my part)**. Tests: pads-core "R1-F …" (short labels, `nearestColor`, `defaultsFor` / `fill` with a `look`), cv-pads "R1-F a Pads
  module following an SDS-V …" (by sound id: names, kit colours via `nearestColor(CD.COLORV[sid])`, three distinct toms, 808 unchanged, Fill from…,
  inspector Sound). Fix: pads-core `soundShort` :207 (trailing parenthetical dropped) used by `targetLabel` (labels everywhere; `soundName` keeps the
  full names for warnings / roll / inspector's list); `nearestColor(hex)` :87; `defaultsFor(…, look)` :407 / `fill(M, { look })` :425 (`look = { c: { sound: colour } }`);
  cv-pads `lookOf(model)` :116 (SDS-V only: cv-drum `COLORV` by sound id → nearest palette entry; imported, not copied) used by `defaultsOf`, Fill from… and
  `colFor` :675 (inspector Sound / Type / Add target, drag-onto-instrument). Colours today: bass red, snare amber, tom 3 indigo, tom 2 green, tom 1 blue.
  Order is cv-drum's (fixer C's PADV); my tests pass the panel order explicitly (`pads-core.test` 322–323 now `['bd','sd','ht','mt','lt']` → `'bd sd ht mt lt'`).
  **canvas-8-sim: no pin of mine needs to move** (it pins no pad label / colour / jack wording; only the order, which is fixer C's).
- **R2-F1** footer hit areas. Test: "R2-F1 …" evaluates the real `.pd-fb::before` rule (top / height / transform) at --ik 1…4 and asserts the upward reach < the 20 world px
  between the pads' bottom and the button's top. Fix cv-pads.js:1234 — `top: calc(0px - min(16px, max(0px, (44px·ik − 24px)/2)))`, `height: max(100%, 44px·ik)`, `transform: translateX(-50%)`
  (sideways to 44 screen px as before; down is clipped by `.cv-body { overflow: clip }`, up capped at 16). Chrome (1440×900, real app, base vs fixed): share of pad 1 / 2's front half
  taken by the buttons at k 0.6 / 0.567 / 0.5 / 0.4: base 14·4 / 20·6 / 36·15 / 66·33 %, fixed 0 everywhere.
- **R2-F2** inspector after a Modulation switch. Test: "R2-F2 …" (async; body made with edit / sel / insp set, no module; nothing open; appended to a module root in a world with a
  top layer; after a microtask the popover is in the top layer, not inside the body). Fix cv-pads.js:1176 — `reopen` now (module root already there) or in a `queueMicrotask`
  (main appends the body right after `padsBody()` returns; no main.js hook needed). The existing "Edit mode survives a module rebuild" test got an `await Promise.resolve()`.
  Chrome: after Modulation → Velocity the popover is parent `ov` at the module's right (base: `pd-body`, inside the module, 240 px, clipped).
- **R2-F3** popovers on screen. Test: "R2-F3 …" (right of the module; flipped left; clamped at the bottom after the content is measured and a window resize; neither side: clamped;
  Grid… / Velocity… / Fill from… / Hardware… share it). Fix `popOpen` cv-pads.js:921 — `place()` measures after `POP.sync()` builds the content, again at every sync and on window `resize`;
  8 px margin as cv-drum's TRIM / wk's menus (`innerWidth` / `innerHeight`). Chrome: module at the right edge → popover at left 840 (base 1442, off screen); module low → bottom 892 (base 1094); 900×700 resize → 692.
- **R2-F11** nits.
  - Octave stepper: text `oct 4` (aria "Octave: 4"), `stepper(…, shown)` cv-pads.js. Test "R2-F11 … Octave".
  - Light Both double flash: own press records `own[pad]`; the monitor's echo within `ECHO_MS` (400 ms: covers a Bluetooth latency) adds no flash, another pad of the sound still flashes (cv-pads.js:331). Test with injected `now`.
  - Held after the target track is deleted: `endTrack` ends a hold with no notes left and no mod source (cv-pads.js:515); a hold with notes on another track, or a mod source, stays held. Test "R2-F11 a pad whose target track …".
  - Gap + pad finger: `.pd-grid` added to cv-module `BG_SEL` (cv-module.js:160) — a gap inside the grid is a canvas finger (one finger / mouse pans, a joining pad finger pinches by the time rule); pads still never. cv-pads.test "gestures" and cv-module.test BG_SEL pin moved. Chrome: a mouse drag starting in a gap pans the camera (72, 36 px) — base 0; pad presses unchanged.
    **Caveat**: headless Chrome's touch adjustment snaps a fingertip in an 8 px gap (and the well's rim) onto the neighbouring pad (reviewer 2's "gap finger" was therefore a pad finger: two music touches never pair), so the touch pinch itself is only unit-tested (node) — not verifiable in Chrome; WebKit has no adjustment.

## Gates (node 24, one file at a time, `--max-old-space-size=2048`; head 5ba65d4)
cv-pads 31 · pads-core 23 · cv-mods 20 · cv-module 61 · cv-keys 25 (untouched; no cv-keys finding) · cv-cables 44 · cv-graph 37 · cv-model 13 · canvas-8-sim 12 ·
canvas-1i-sim 20 · canvas-3-sim 26 · canonical-stream 1 · golden-graph 6 · lint 149 — all green.

## Notes for the lead
- Commit trailer: the harness's attribution for this session names Claude Sonnet 5.5, so the commits end `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (your brief said Opus 5.5).
- Not done / left: R1-A's suggested canvas-8-sim assertion (the Juno's last `{t:'mval'}` after a `lo` edit) and R1-B's (Undo mid-press → last `{t:'at'}` 0) are in fixer B's file; the host-level tests cover them. main.js `cvDevices` may pass `project`
  to `moduleJacks` (optional: the host's project is the fallback). IMPL-8 §17 text (docs) untouched as asked: §3.5's "toms 3 · 2 · 1", §6.4's family colours (an SDS-V's pads now take the kit's), pad labels short.
- Scratch: `scratchpad/8/fa/` (edit scripts, Chrome step scripts `s/p1…p6.js`, shots `shots/`); Chrome, driver and both servers (8971, 8972; CDP 9461) stopped.

#### Fixer B (stage "7d + 8"): host findings — main.js / index.html / canvas-8-sim

Base `4816a1e`. Files touched: `main.js`, `tests/canvas-8-sim.test.mjs` (+ a `cv-module.js` import there). `index.html`, `tests/main.test.mjs`
needed nothing. All five tests are accessor-free (no `t.model` / `t.vals` / `fxOf(t)`) and were run red first, at the intended assertion.
Commits: 91daf03 (C) · 6cf5dda (D) · 00f6c26 (G) · 1d03ee2 (F6) · 590ae67 (F9).

## R1-C — a hidden Pads module keeps drum monitors on at ROLL
- Test: canvas-8-sim "R1-C …" (last block of the file). Juno selected, the Pads module follows the 808 on track 1: `wants(t1)` true and the 808's
  last `{t:'mon'}` has ids; `cv.openTab('roll')` → `wants` false, last mon `ids.length` 0; `openTab('canvas')` → true / ids again. Red: `[true, 1]`
  at ROLL.
- Fix: `main.js` `openTab` (≈3845): `PADS.resync()` before `monitors.sync()` (after `world.setActive` and the default-camera restore, so
  `cvLive` — which reads `#tab-inst.hidden` — is already right). `shownIds()` filters by `cvLive`, so the host drops its drum / note
  subscriptions at ROLL and takes them again at CANVAS. (Hardware light-back while the canvas is hidden is not kept: the lights follow the
  visible modules, as §6.2 says "while the module is shown". Say if you want it kept for `out.prof === 'gen'` modules.)

## R1-D — power off with a held key leaves pads lit
- Test: "R1-D …". Juno selected; pad 9 a note pad on the Juno's E4; `api.noteOn(64, 1, 0)` → pad `lit`; power off → `idle`, `held` empty;
  power on, E4 on → `lit`, off → `idle` (the count did not stick). Red: `lit` after power off.
- Fix: `main.js` `powerOff` (≈981): before the `held.delete` loop, `for (k of held) if (numSrc(src)) noteOff(+n, +src)` — panic's loop. The nodes
  and ctx are already gone so the posts are no-ops; `inputNote(t, 0, …)` reaches `padIns` (the host's `liveN`), `recEnd` and `keyVis`. The
  old delete loop stays after it for anything non-numeric left.

## R1-G — tray key light after `selectTrack`
- Test: "R1-G …". Pad 10 a latched note pad on the Juno's E4. Juno selected, tap → key 64 `down`; select the 808 → unlit (the hold survives, the
  key is not this track's); back to the Juno → lit; tap releases → unlit. Then the other way: latch from the 808's canvas (unlit), arrive on the
  Juno → lit; release → unlit. Red at the first switch (stale lit); a scratch probe showed the inverse (arrive → unlit) was stale too without
  the fix.
- Fix: `main.js` `selectTrack` (≈1865), after `project.selTrack = id; bind();`: `const L = heldLit(); for (const [n, el] of keyEls) if
  (el.classList.contains('down') !== L.has(n)) keyVis(n, L.has(n));`. After `bind()` (which may rebuild the keys through `buildKeys`) and after
  `selTrack` moved, so `heldLit`'s "reached the selected track" rule uses the new selection (the reviewer's "after the loop" would have read
  the old one). Only keys that differ are touched. The numeric keys were just ended by the loop above, so what is left is the pad holds.

## R2-F6 — the Controllers intro
- Test: "R2-F6 …". Through the real dropdown (`#srcView` / `#srcViewMenu` item `data-view="ctl"`): in replace mode and after
  `cvOpenSources('track')` the `#srcMode` text matches `/^Tap Pads to add a pad grid/` and none of `Juno|in place of|track list|new track`;
  the Hardware view in + Track mode still says "a new track". Red: the instrument's "Juno-60 / “Juno-60 2”". (The fake DOM's `append`
  drops bare strings, so the new branch builds its plain parts with `document.createTextNode`, as main.js:3906 already does — the test sees the
  whole sentence.)
- Fix: `main.js` `srcModeUI` (≈4815): `if (v === 'ctl')` → "Tap **Pads** to add a pad grid to the canvas — it shows on every track — or drag it
  where you want it." One text for both modes (a Pads tap never replaces or adds a track; there is no drop on the track list).

## R2-F9 — Grid… leaves the module pinned at the old size on other tracks
- Test: "R2-F9 …". Two new Juno tracks `ta`, `tb`, each with a layout write (`cv.setLayout('flow')`, which pins the Tidy-placed modules: `ta.lay.pd1.x`
  = the 4 × 4's column x, -448). `tb.lay.pd1` is set to a user place (-1200, 300). On track 1 (the 808) `edit('Pads 1: 8 × 8')` → one step;
  `ta.lay.pd1.x` = the 8 × 8's column x (-768), y unchanged; `tb`'s and track 1's places untouched; on `ta` the module's rect ends left of
  the instrument (`i1`); one undo restores size and every place; redo takes them again. Red: `-448` vs `-768`.
- Fix: `main.js`. `step` dep (≈1995) records every Pads module's footprint width in `padFoot` before the History snapshot; `padsChanged`
  (≈2025), after the value posts and before `cvRender()`: for each module whose width changed, every track other than the selected one whose
  `lay[id].x` equals Tidy's column x for the old width (`-roundW(w + MOD_GAP)`, i.e. a pin or a still-tidy place) gets `x` = the column x for the
  new width (a fresh `lay` object, y / fold / z kept). A place the user moved is left alone; so is the selected track's (§1.3: top-left fixed,
  the user sees it happen — Tidy right-aligns). Undo / redo carry it because the new `lay` is part of the step's post-state. Shrinking is the
  same rule backwards.

## Open / not done
- Nothing left open in my findings. The current track keeps §1.3's overlap (by design, as the reviewer accepted).
- Hardware light-back is not kept while the canvas is hidden (C) — a decision for the lead if wanted.

## 18. Review log

### The skeptic review (2026-10-21, against 3b9aee0 = 8815b14 + this contract)

Every claim about existing code was read at 3b9aee0 (its code = 8815b14's); one scratch measurement (`scratchpad/8/rev/tri-alias.mjs`:
the sampled triangle's aliases at the bent pitch, raw and after the RC²) and hand arithmetic (the footprints, the SENS law, the CPU
sums); no test was run. **Settled before the review** (the lead, recorded in §16's answers, not reopened): Q2 the grid's size a
setting, no drag handle; Q4 drum hits, notes, chords and modulation now; Q6 no hardware owned — generic learn on the Mac and one
generic note-velocity light-back, no device profiles. **During the review** the user answered Q1 / Q3 / Q5 / Q7 as recommended
(§16). Severity as 7a–7c: P0 a silent failure or a broken build, P1 a contract contradiction or an impossible gate, P2 a gap a
builder would trip on, P3 a correction.

**D1 holds as designed**: golden-drums / -606 / -909 swap all three frozen files on side A with every other module current
(golden-909.test.mjs:1–14, 52–58; ref-7c frozen and pinned at 31bb09a), so drum-core's 808 / 606 / 909 outputs are guarded too; an
SDS-V is a fourth `MACH` entry and a fourth branch chosen at `create` (dr-808.js:3139–3143, 3179–3181), `DrumP` gains 45 fields the
other machines never read (engine.js:1356–1377), `drSeqMsg` / `drOn` gain inert `trim` lines (a guard on `dm.trim` for machines
without it, engine.js:2163–2182, 2264–2276), `models.js` adds an entry after `tr909` (the goldens find models by id). Nothing in the
plan touches an 808 / 606 / 909 computation; a builder who moves shared code into helpers keeps operation order (bit-identity is
about order, not structure). **The SDS-V's empty plan routes and stays silent**: `seqMsg` routes any payload with `plan`
(engine.js:2835), `valid` accepts n 0 with `mOff` / `mT` = `[0]` (dr-seq.js:115–131), `locate` and `boundary` stop the cursor at
n 0 (dr-seq.js:258, 303). **iPad**: nothing depends on Web MIDI — `wire()` / `enable()` mark the button unsupported without
`requestMIDIAccess` (midi.js:304–329), `send` is a no-op, hardware items disabled (§8.1).

| # | point | evidence (file:line) | fix |
|---|---|---|---|
| 1 · P1 | **Undo cannot revert the SDS-V's memory keys or TRIM…**: §13.2 / §13.3 / §15.9 / §15.10 gave them History steps and "undo restores", but undo / redo never revert knob or switch tweaks — `keepDevs` copies the current `vals` **and `drum`** onto the restored device — and the drum host's `put` never takes a step (the 303's policy); a step would undo nothing | main.js:1380–1386 (`keepDevs`), 1395 ("undo / redo never revert knob tweaks"), 3260–3267 (`drumPut`); IMPL-7a:1073 (`put`, "never a History step") | **fixed in §13.2, §13.3, §15.9, §15.10**: memory keys are panel switches (no step), TRIM… edits record writes (no step); the tests assert that |
| 2 · P1 | **A second hit on a held drum is swallowed**: §4.1 "the first holder sends" + the bed's one `on` per key (§2.1 "two fingers on one pad: one hit") — a second finger on a pad, a second pad or a second hardware pad on the same kick plays nothing until all lift; the drum panels' rule is "every finger its own hit", and finger-drumming rolls depend on it | cv-drum.js:1099–1103, 1110–1117 (`hit` → `DR.pads.on` at every pointerdown), canvas-7a-sim.test.mjs:225 ("two fingers are two hits"); cv-keys.js:150 (`press`: `o.on` only at count 0); main.js:1665 (`noteOn` re-strikes a held key) | **fixed in D9, §0, §2.1, §4.1, §14.1, §14.3, §15.6, §15.10**: bed option `o.each` (pads: every pointer down `o.on`, `o.off` at the last); the host sends at every hit, the (track, note) count decides only the note-off — see **P-2** |
| 3 · P1 | **The mapping mode used cv-world's camera edit state**: §7.1's `[data-cv-edit]` is set and cleared by the world at selection / focus, and gesture.js reads it to wake `own` zones — the pads' Edit mode would turn on and off by itself | cv-world.js:898, 908, 956–958; gesture.js:66, 81–85 | **fixed in §7.1, §15.6**: the body's own `data-pads-edit` |
| 4 · P1 | **Mod-pad cables are never drawn**: cv-cables parses a row's source with `modSrcPort`, ports `out` / `k1…k8` only — `modCables` skips every `pd<n>.p<i>` row; `colorOf` finds no device on the track; cv-module's `jacksOf` → `modJacks(kind, title)` has no data for per-pad jacks. §0 / §5.4 named only `pressMod` → `onMod` → `modConnect` | cv-cables.js:104–108, 312–313, 320–321; cv-module.js:895–902 | **fixed in §0, §1.1, §5.4, §14.1, §14.2**: U teaches `modSrcPort` / `keyKind` / `colorOf` the source; the `cvDevices` entry carries `jacks`, `jacksOf` reads them |
| 5 · answered | Q6: no device-specific profiles (the APC mini mk2 / Launchpad rows, their palette tables, "channel 7", the "untested" marks, the hardware check on the user's device) | the lead's brief | **fixed in D4, §8.1, §8.4, §10.1, §14.3, §15.6, §15.11**: `prof: 'off' \| 'gen'`, one documented scheme (127 lit, 0 off), the hands-on check when the user has a controller |
| 6 · P1 → P-1 | **dvp 0.025 is below the contract's own ceilings**: the groove keeps all five cards awake (bass every beat, toms every bar, long factory decays); 5 × 0.004 (§12.7's per-card ceiling) + the Track's ≈ 0.007 = 0.027 — 7c review #9's class | IMPL-7a §14 (d8p 0.0193, machine 0.0126); IMPL-7c §14 lane V9 / cv-cost.test.mjs:72–75 (d9p 0.0172, machine 0.0099); bench.json `targets` | **fixed in §12.7**: dvp 0.03 / ipad 0.035 [C]; the jsc column informational — proposal **P-1** |
| 7 · P2 | **main.js's `held` loops and key lights assume numeric sources**: `panic` / `selectTrack` call `noteOff(+n, +src)` — NaN for `pd<k>` (skipped by accident), `powerOff` deletes every key behind the host (stale counts: the next hit of that note sends nothing); `noteOff`'s light test and `buildKeys` count a pad's key on another track, so a tray key stays lit | main.js:970, 1689, 1759, 1831, 4178 | **fixed in D9, §4.2, §14.1, §15.10**: the host alone ends `pd*` keys; `PADS.release({ hw: true })` before panic's / power off's loops; `selectTrack` skips non-numeric sources explicitly (a hardware-held note survives a switch); the light tests count only keys that reached the selected track |
| 8 · P2 | **Q5's rule stops at replace mode and aftertouch**: `replaceSweep` wipes armed tracks only, `recCC` records armed tracks only — a non-armed target overdubs in replace mode and loses the Pencil's aftertouch | main.js:1632–1655 | **fixed in §4.3, §14.1, §15.10**: `T.padRec` (the take's pad-recorded tracks) joins both |
| 9 · P2 | **An unplugged MIDI input sends no signal**: D9 / §15.6 end notes on "a MIDI input unplugged or disabled", but the `statechange` hook only re-hooks, and midi.js has no disable; midi.test pins one shared handler, so "today's tests unchanged" was false | midi.js:304–318; tests/midi.test.mjs:733–738 | **fixed in D9, §8.2, §8.4, §14.1, §15.7**: `H.ports(names)` after each hook; "disable" dropped; 737 is M's to change |
| 10 · P2 | **Pencil aftertouch names no pad**: the bed's `o.at(v)` carries only the value; with fingers on other pads the host cannot tell which pad's targets get it | cv-keys.js:159–164, 181, 187 | **fixed in §0, §2.1, §2.4, §14.3, §15.6**: `o.at(v, n)`, n the pen's key (1i's callers ignore it: byte-identical) |
| 11 · P2 | **Frame coalescing drops taps**: "≤ one post per source per frame" merges a press and its release in one frame (a hardware note-on / note-off pair) — only `lo` is posted, the tap never reaches ModCore | §5.3 (as written); mod-core.js:328–338, sx-mod.js:809 (the glide: 6 ms × smooth) | **fixed in §5.3, §15.6**: press / release post at once; only pressure coalesces |
| 12 · P2 | **The VCO's alias claim ignores the bend**: "≤ 520 Hz, OS ≥ 2: aliases near −90 dB" — but a tom's pitch at the hit is up to 2.5 octaves higher (≈ 2.9 kHz): raw −57 dB (OS 2) / −71 dB (OS 4), after the RC² −46 / −55 dB re the tone; and "3rd harmonic −28 dB" holds only near TONE 10 (−30; −20 at TONE 0) | RV §2.3 (as written); `scratchpad/8/rev/tri-alias.mjs` (this review) | **fixed in §12.2, §15.1, RV §2.3**: a gate ≤ −60 dB at OS 4 at the bent worst case; a 2-point polyBLAMP at the corners V5's means |
| 13 · P2 | **Note cables would rebuild instrument modules**: a `notes` jack on the instrument "shown only while a note cable ends there" changes its jack set, and cv-module removes and re-creates a module whose set changed — a hardware face re-mounted, its beds released, at every mapping edit | cv-module.js:903, 1083, 1146 | **fixed in §0, §9**: the cable ends at a fixed point of the instrument's left edge, no jack there; the Pads module's `notes` jack always present — see **P-3** |
| 14 · P2 | **Test pins no lane owned**: canvas-sim's view-menu labels, cv-tray's menu labels (570) and section list (553), cv-panel's xcapFit "no other strip changed" (585), midi.test's shared handler (737); and there is no `tests/song.test.mjs` for X's song checks | tests/canvas-sim.test.mjs:518; tests/cv-tray.test.mjs:550–553, 570; tests/cv-panel.test.mjs:585; tests/midi.test.mjs:737 | **fixed in §0, §14.2, §14.3**: X, P1, M own them; X's song checks in cv-migrate.test |
| 15 · P2 → P-4 | **The SDS-V's trigger threshold was silent in the contract**: the comparator's 0.2 V means no hit below v 34 at SENS 0, v 18 at SENS 1, v 2 at SENS 2 — the golden case v 20 × SENS 0 is silence, a roll / MIDI ghost note vanishes | RV §2.3 (`G = 20 · 10^(1.5 s)`, `v_p = 0.005 · 15^((v−1)/126)`, 0.2 V) | **fixed in §11.4, §15.1, §15.2, RV §2.3**: kept as the original's threshold [C], the tooltip says so, a test pins it — proposal **P-4** |
| 16 · P2 | **The Pads tile went through the Serum part tiles**: `boxOf`'s groups are picked through `o.partPick`; `multi` tiles ignore `setPlaced`, so "greys at 8" could not happen | cv-tray.js:317–325, 415–420, 453–470 | **fixed in §0, §1.2, §14.1, §14.3**: a Modulators-style row `o.ctls` with `o.ctlPick` / `o.ctlDrag`, not `multi` |
| 17 · P3 | "`MOD_ORDER` but not `MOD_KINDS`" is impossible: `MOD_KINDS` is derived from `MOD_ORDER`; Tidy already puts a kind outside it last | cv-module.js:67–68, 315 | **fixed in §1.1**: not in `MOD_ORDER`; `keyKind` maps `pd<n>` |
| 18 · P3 | `modSpot` / `modTileDrag` size a new module by `modW` / `modHt` (240 × 128 for an unknown kind) | main.js:6618–6700 | **fixed in §1.2, §14.1**: the footprint |
| 19 · P3 | The DOM budget forgot the jacks: each inline jack is the anchor + cv-module's hidden dot — 8 × 8 mod pads ≈ 200 elements | cv-module.js:442–451 | **fixed in D6**: + 2 per mod pad |
| 20 · P2 | An inline jack's anchor **becomes** the jack (`data-cv-jack` moved onto it) and cv-world takes any press inside a jack as a cable drag — an anchor on the pad element would turn hits into cable drags; a hidden pad's jack shows its fallback dot | cv-module.js:458–485; cv-world.js:1135–1143 | **fixed in §5.4, §15.6**: the anchor a child dot of the pad; a `hide` flag for hidden pads' dots |
| 21 · P3 | `role="grid"` / `gridcell` without `row` elements is invalid ARIA | §2.5 (as written); cv-drum.js:1081–1090 (padsCell: group + buttons) | **fixed in §2.5**: padsCell's pattern, roving tabindex |
| 22 · P3 | A pad's own fixed velocity vs a hardware pad's "as sent": which wins was unstated | §2.2, §3.1 (as written) | **fixed in §2.2**: the pad's fixed velocity wins for every source [C] |
| 23 · P3 | `defaultsFor` needs the machines' pad orders, which live in cv-drum (pads-core is a leaf); the orders list the top row first while pad 1 is bottom-left; the 606's / 909's `ac` cell has no sound; the SDS-V's shape unstated | cv-drum.js:92, 136, 150, 157–161 | **fixed in §3.5, §7.4, §14.3, §15.6**: passed in, flipped, `ac` empty, SDS-V 1 × 5 [C] |
| 24 · P3 | `PERS.sdsv` "pads" in the interfaces, while every machine's pad layout is cv-drum's `UI` | §14.3 vs §13.2 (as written); drum-core.js:162–190 | **fixed in §14.3** |
| 25 · P3 | RV's diagram scaled the VCAs by V_D besides the envelopes' peaks ∝ V_D (a level ∝ V_D²); the snare's noise sweep 0.7 contradicted RV's [R lon] "noise pitch on bass and toms" | RV §2.2, §2.3 (as written) | **fixed in §12.2, §15.1, RV §2.3 / §2.4**: V_D once; the snare's sweep 0 [C] |
| 26 · P3 | `Ota4`'s cutoff can pass Nyquist (tom 1: 6 kHz × 2² = 24 kHz at OS 1, 44.1 kHz) | engine.js:582 (`gMax` = tan(π · 0.46)) | **fixed in §12.2, §15.1, RV §2.3**: clamped at 0.46 of the OS rate |
| 27 · P3 | "old rows within 5 % of `ipad2b` at 8815b14": `ipad2b` was taken after 2b (c1–c6, no drum row); no drum row was ever measured on the iPad (`ipad7a` / `7b` / `7c` pending); the jsc column had no home in `targets` | tests/bench.json (`ipad2b.about`, its rows; `targets`); HANDOVER.md:68 | **fixed in §12.7, §15.11**: `ipad8` the first run with drum rows, every drum row ≤ its iPad target, c7–c10 recorded; jsc informational |
| 28 · P3 | A row whose Pads module is missing (a partial file) still compiles: the pad branch of `srcDev` does not read the project, `validRows` keeps it | cv-graph.js:530–534 (`validRows`) | **fixed in §5.3, §14.1**: dropped at load after `normPads` |
| 29 · P3 | `drumMonitor`'s `live()` is read only at `monitors.sync()`; with the machine's own panel subscribed, the Pads host's `lit` subscription never moves the count through 0 / 1, so a change of `wants` alone syncs nothing | main.js:2196–2215, 3474–3482; cv-drum.js:380–386 | **fixed in §14.1, §14.3**: a `monSync` dep |
| 30 · P3 | The listening gate had no verdict or retune rule | §14.3 (as written) | **fixed in §14.3**: per-card keep / retune note, one retune round, then the freeze |
| 31 · P3 | A pad's Modulation switched off while it has rows: unspecified | §7.2 (as written) | **fixed in §7.2**: asks, removes the rows in the same step [C] |
| P-1 · proposal | **dvp's target** (#6): 0.03 node / 0.035 iPad as applied (the honest load, 7c P-2's precedent), or keep 0.025 and thin dvp (the tom fill every other bar). The review recommends 0.03 | #6 | **for the lead** |
| P-2 · proposal | **Re-strike** (#2): as applied, every press is a hit on every target (a keyboard re-strikes a held key today, main.js:1665; a chord pad and a note pad sharing a note re-attack it), or re-strike drum targets only and merge note / chord targets (the 1i bed's rule there). The review recommends re-striking everywhere: one rule, the drum family's, and what a pad controller does | #2 | **for the lead** |
| P-3 · proposal | **Note cables** (#13): as revised (derived, to the instrument's edge), or leave them out of this stage (the leaner shape: the "+N on other tracks" chip and the inspector already say what a module plays) | #13 | **for the lead** |
| P-4 · proposal | **The SDS-V's threshold** (#15): kept (the original's soft-hit threshold at low SENSITIVITY) or let every note fire whatever SENS (the comparator before the gain): roll / MIDI users never lose a ghost note. The review recommends keeping it, said in the tooltip | #15 | **for the lead** |
| 32 · fine | Checked and fine: `noteCh(t, 'pd3')` → 0 (midi.js:73); `MSRC` and `LAY_KEY` accept `pd1.p12` / `pd1` (song.js:518, 625); `srcOf` parses it (cv-mods.js:447–451); a Serum row from a GLOBAL non-native source takes an ext slot through `planSerum` (cv-graph.js:458–471) and the value slot's `ext<k>` (643–648); the payload key excludes `vals[].v` (cv-graph.js:751) and `modVal` finds the entry by id (main.js:6522–6529); drum step posts reach every track's drum entry, selected or not (main.js:1015), so `DRUM.rec`'s `frac` works on a non-selected machine; `drumOf` re-normalises by `d.model` (main.js:148–153); `isDrum` by `PERS` (song.js:548); `seqMsg` / `drSeqMsg` routing (engine.js:2835, 2264–2276); the footprints (352 × 416, 672 × 736, 864 × 928, 96 × 160); the SENS law (V_D ratios 5.3 / 1.6 at SENS 5 / 10, 6.30 / 2.80 at SENS 2 / 8 — RV §5); T60 = 0.03 · 167^d (30 ms … 5.01 s); the bend's τ_P cap never binds (≤ 0.22 s); gesture.js never pairs two music touches and pairs music with non-music by the time rule (gesture.js:152–166), G2 stops at the module (cv-world.js:1152, 1188–1195); `targets(src)` is the keyboard's rule only (midi.js:63–67); no MIDI output exists today (midi.js; main.js:4027 is Serum's own); Web MIDI's outputs need no permission beyond the inputs' prompt the adapter already handles; schema 11 for both parts (a schema-10 build reads `sdsv` as a Minimoog: normDev keeps the id, `isDrum` false) | as cited | — |

**The lead's decisions on the review's proposals (2026-10-21):** P-1 — dvp 0.03 (iPad 0.035), as applied. P-2 — every press
re-strikes its target (drums and notes alike, as the drum panels' "every finger its own hit"); the hold count only decides the
note-off. P-3 — keep the revised note cables (ending on the instrument's edge, no jack). P-4 — keep the SDS-V's authentic
soft-hit threshold at low SENSITIVITY, documented in the panel's tip and the pad's aria text. Phase 0 starts now on the holding
branch `wt-8`, base this commit.

**The lead's decisions during phases 1–3 (2026-10-21):** E5a — `dvm` = the "memories" row (the dvp groove, channels on memories
3 / 4, a memory key flipped every bar; 0.03 node / 0.035 iPad); the About title keeps `${m.maker} ${m.name}` as every model (factual,
not on the panel). E5b — `OUT_KV` 0.732 → 0.67 (the dvp groove never reaches the track limiter at 48 / 44.1 kHz × OS 4 / 2 / 1; SDS-V
only; ref-7a / 7b / 7c untouched). Q — no project, no pad source; a mod-only pad is "Pad k"; pads take value slots after the track's
modules (a full track's new row can leave a pad's row with `'slots'`, as a second macro module can today). P1 — `dr:mem` renders each
channel's four keys as one radio wrapper carrying `data-ctl` = `data-dest` = `x<ch>p` (accepted deviation); Copy to knobs also selects
memory 2 (the sound is unchanged; the channel then plays from the knobs, where modulation works). X — `panels/sdsv.js` from §13.1's
fallback mm (no photograph viewed; that file is the one to retune). H — its seven deviations in §17 "Lane H" accepted for review.
Reviews → **one name for a mod pad everywhere: `padSrcLabel`** ("Pads 1 · Kick"; one function in pads-core) and **the SDS-V's pad
order Bass · Snare · Tom 1 · Tom 2 · Tom 3** with short labels and each pad in its channel's kit colour (supersedes §3.5's 3 · 2 · 1);
the §13.2 DOM limit 700 stands (the code is fixed, not the limit).
