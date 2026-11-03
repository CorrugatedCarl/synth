# Stage DM: our own drum machine (IMPL-DM) — contract

ROADMAP row 19 ([ROADMAP.md](ROADMAP.md):40 [R]) and its two consumers: row 20, the guided first beat ("needs row 19", :41 [R]), and
row 26, the LFO combiner ("the kick / track hits marked on the grid as a reference", :47 [R]). **Code references are to `canvas` at
c515abf** (the base every builder resets to). Tags as IMPL-WC: **[R]** a fact (file:line), **[R?]** unconfirmed (the lane pins it),
**[C]** a choice made here (a builder may refine a [C] with a reason in §13, never an [R]). House format: IMPL-SC / IMPL-WC.

**Status**: the contract, before the user's answers (§11) and the skeptic pass (§14). No code yet.

**The user's words** (2026-10-26): "we will have to make our own drum machine first" — in the row: a drum machine of our own design
(not a recreation like the 808 / 606 / 909), **in the Wavecraft family's look and grid**, the prerequisite of the first-beat tutorial,
its design questions (sounds — synthesis or samples —, the pattern sequencer, how it patches with Wavecraft) asked when it starts → §11.

**What we know about the user** (the brief, HANDOVER §2, the memory) and what each forces:
1. No hands-on reference for vintage drum machines → every voice is built to **measured laws** that a test checks (§2), never to
   "sounds like". No listening gate blocks a cut; the user's ear decides later and a retune re-freezes the refs (§12).
2. Judges by feel → a **playable first cut** shipped early; every guess a constant or a table (the list below).
3. Dislikes crowded panels and wasted space → **every face on the RIG grid** (rig-grid.js) with IMPL-WC §3.8's margin / fill gates.
4. The iPad Pro is the ceiling → §7's costs are budgets, measured on the Mac with the iPad's known factor.
5. The leftover Serum part modules go once Wavecraft is complete (ROADMAP :39 [R]) → **nothing here imports them** (D6).
6. Original content only → our own voice designs, numbers, kits and demo beat; no sample ships; no other machine's name on it.

**In short.** A new instrument in the Drums view: a **Sequencer** module (a big step grid, one row per drum) and **one small module
per drum** (Kick, Snare, Hi-hat, Clap, Tom, Perc), in the Wavecraft look. Our own synthesized sounds — no recordings. Tap steps, press
▶: it plays with the song. Each step has its own loudness. Eight patterns, swing, mute / solo, choke groups (a closed hat cuts the
open one). The piano roll, MIDI, the keyboard and a Pads module play it too; a Ducker can follow its kick. Cut 1 is that playable core;
your own samples, step chance / repeats / nudge, longer patterns, stereo pan and (if wanted) patch cords come in cut 2.

**The lead's decisions (2026-11-01)** — each argued against what exists (§0):
- **(a) A fifth machine of the drum family.** Model `kit`, `family: 'drums'`, Inst kind `'drums'`, machine `'kit'`; its voices in a
  **new DSP script `kit-dsp.js`** (→ `globalThis.DrKit`, the Dr808 machine interface); its clock is **DrSeq** with two additive plan
  fields (§3.6); its main-side personality in a **new leaf `kit-core.js`** that drum-core dispatches to (the 7b / 7c / 8 pattern:
  the four older machines byte-identical). This reuses, unchanged: the engine's drum lifecycle (engine.js:2382–2581 [R]: build, keep
  per id, tails across machine switches, decimators, idle skip, panic, OS changes), DrSeq's song sync, swing and heard-time posts
  (dr-seq.js [R]), the drum host (cv-drum.js:7–36 [R]: sessions, sends deduped by pk, step / lamp posts at the heard time), the
  bounce (main.js:556, 5238 [R]), the roll's named rows (roll.js:58 [R]), the Ducker's NOTE menu (main.js:1388 [R]), the Pads
  module's drum targets (pads-core.js:315 [R]), MIDI channel 10 (song.js:867 [R]), the sidechain per lane (engine.js:2484 [R]).
  Rejected: Wavecraft's Serum engine (a kit is not a Serum state; D6), the 900 Series' patch engine (mono modules, no sequencer, none
  of the family's paths).
- **(b) Synthesized voices of our own** (Q5): six types on generic blocks — a sine with a pitch envelope, filtered noise, a bank of six
  band-limited squares, two-mode resonators, burst envelopes — each a **table of laws** (knob → Hz / s / dB, §2.2). Samples are cut 2's
  seventh type over the family's slots (IMPL-7a §5 [R]).
- **(c) A Sequencer hub + one module per drum** (Q2; the Wavecraft idiom: modules on the canvas, nothing hidden). Faces built by a
  **new `kit-ui.js`** on **rig-grid.js** with wk's primitives (knob / numBox / menu / seg), as fx-ui.js already does without a Serum
  host (fx-ui.js:67–71, 585 [R]) — **not** rig-ui's faces (they are built from the Serum panels as donors: rig-ui.js:30–43 [R]).
- **(d) The grid is the main surface.** Tap a cell, press ▶. The machine **always follows the song's ▶ and tempo** (no free-running
  tempo of its own, unlike the vintage machines' SYNC off); roll notes play it too (the family's "both ways", IMPL-7a §4 [R]).
- **(e) No patch cords in cut 1** (Q3): each voice plays its own row and goes to the mix — normalled, so nothing needs a cord; the
  record reserves the row → voice trigger matrix (§5.3) so cords (layering, chokes) are a UI over existing data later.
- **(f) Mono in cut 1**: the voices render into the family's mono OS-rate bus (engine.js:2534–2580 [R]), so every de-click, tail,
  machine-switch and OS path works as for the 808. Per-voice PAN needs a stereo voice bus (engine work) → cut 2. (The 909 shipped mono
  on the user's answer, ROADMAP :90 [R].)
- **(g) ↶ undoes grid edits**: the grid is note entry, not a knob tweak — one History step per gesture. The family's rule for the four
  machines (pattern edits never reverted, IMPL-7a §6 [R]; keepDevs main.js:1927 [R]) stays theirs; knob turns keep the app's policy
  (never reverted by ↶) on the kit too. Flippable: `KIT.UNDO`.
- **(h) Name-neutral**: model id `kit`; files `kit-core.js`, `kit-dsp.js`, `kit-ui.js`; tests `kit-*.test.mjs`; CSS `.kit-*` /
  `[data-cv-kit]`; the global `DrKit`; lay keys `iN/ka … iN/kp`. The display name is **one line in models.js**: `RIG.NAME + ' ' +
  KIT.WORD` → "Wavecraft Drums" (Q1): a Wavecraft rename renames it, and the WC grep test that keeps the literal inside rig-core.js
  stays green (models.js already imports RIG, models.js:15 [R]). A standalone name later = that line.

**Cheap to reverse** (data or a constant): `KIT.STARTER` (the starter voices), `KIT.DEMO` (the starter beat; `null` = an empty grid,
Q4), `KIT.KITS` (the four kits), `KIT.VEL` (soft 64 · normal 100 · accent 127), `KIT.UNDO` ('project' | 'notice' — the 808's rule),
`KIT.CHOKE_MS` 3, `KIT.NOTES` (the note per type), `KIT.TYPES` (every law of §2.2), `KIT.WORD`, the face recipes (`FACE`, data), the
grid's row height (`GRID.rows.cell`, rig-grid.js). **Not cheap**, said plainly: the engine choice (a); folding everything into one
module (Q2's other answer) is a face + host change of about a lane's size, not a flip; stereo (f) is engine work with its own gate.

**Invariants of the stage**
- **D1 Every existing sound bit-identical.** Every frozen golden and ref (§8 G1) exact; ref-7a…7d render their frozen `dr-808.js` /
  `dr-seq.js` / `engine.js` against the current tree, so the engine and DrSeq edits of this stage are proven inert for the four machines.
- **D2 The four machines' data byte-identical.** drum-core's records, sessions, payloads, plans, pk and notes for tr808 / tr606 /
  tr909 / sdsv (their existing pins); DrumP's shape untouched (JSC tiers on shapes, HANDOVER §5 [R]).
- **D3 Steps ≡ notes, live ≡ bounce** (the family's D5 / D7): the same hits as steps or as roll notes render the same bytes where
  frames are whole (the same 4-frame point elsewhere); an offline bounce equals the live render.
- **D4 Measured, not by ear.** Every law of §2.2 is a test (§2.3); the frozen refs freeze what passes.
- **D5 Nothing hidden.** Every voice that sounds has a module and a row; mute / solo / choke are printed on the faces; normalled
  connections are the printed default (no invisible routing).
- **D6 No Serum-parts dependency.** `kit-core.js` imports nothing; `kit-dsp.js` reads no other script's global (cut 2: `SxBase`'s
  sample entries, the family's path); `kit-ui.js` imports only `rig-grid.js`, `wk.js` and `kit-core.js`. A grep test (G11).
- **D7 Original content.** Our laws, our hi-hat ratio set (§2.2, tested against every oscillator table in dr-808.js), our kits, our
  demo beat; no maker or machine name of another instrument on a kit face, tile, notice or about text.
- **D8 The iPad first.** §7's budgets; two fingers always pan / pinch (only the HIT pads are music zones); hits ≥ 44 px at 100 %;
  nothing animates or repaints while stopped.

---------------------------------------------------------------------------------------------------------------------------------

## 0. What exists (facts; "→" what they force)

| piece | where [R] | → DM |
|---|---|---|
| The drum family: models with `family: 'drums'`; `map()` → `{ engine: 'drums', machine, drum: <flat knob positions 0…1, switch indices>, level: 1 }` | models.js:722–865 | `kit` appended **last** (MODELS 19 → 20, models.js:905), machine `'kit'` |
| Inst kind 'drums': `drOn` builds the machine with `globalThis.Dr808.create(this, id)` and keeps one per id (`dmL`); `drGain`; `fadeDrums` renders a 3 ms raised-cosine tail through `dm.render`; `renderDrums`: tails → `dm.render` (mono, OS rate) → decimators → `dm.post` → L / R | engine.js:2382–2581 | one factory lookup by id; no new path (decision f) |
| The machine interface: `create / set / setOS / hit / trig / render / post / poll / live / reset / mon / smp / setSalt`, `gain(kind, drum)` | dr-808.js:17–35 | DrKit implements it (§9.2) |
| PatchP builds `DrumP`, one fixed-shape class holding every machine's fields | engine.js:1365–1404, 1427 | 'kit' gets its own fixed-shape `KitP`; DrumP untouched (D2) |
| The warm-up's drum rounds; engine-track pins the machines it built | engine.js:3647–3830; tests/engine-track.test.mjs:1402 | a kit round; the pin gains `,kit` (by design) |
| DrSeq: plans of 12-bit lane masks (bit 0 accent), `LANE_SOUND`, `fire` → `dm.trig(mask[, ac])`, `drStep` (the lowest primary), `drNote` once per sounding lane (the sidechain) | dr-seq.js:99–110, 325–395 | additive `vl` / `ls` (§3.6), inert for every older plan |
| drum-core: `PERS` (four personalities), `mach()` (unknown → the 808), `normDrum / compilePlan / toNotes / payload / initState / press / leds / drumRows` | drum-core.js:198–231, 277, 395–1008 | a five-way dispatch to kit-core for `'kit'` |
| `song.isDrum` = a `PERS` key; `normDev` keeps `drum` for drum models | song.js:582, 604 | automatic once `PERS.kit` exists |
| The drum host: sessions, `press(tr, input, ph)`, heard-time step / lamp delivery, sends deduped by pk | cv-drum.js:7–36; main.js:2679 | reused; its `machOf` learns `'kit'` |
| The 808's extras grid: one canvas + a hit layer (208 cells as DOM ≈ 400 elements), a keyboard cursor, row header tap = mute / long-press = solo | IMPL-7a §3.6; cv-drum.js:1125 | the Sequencer's grid uses the same technique |
| Roll named rows, the Ducker's NOTE menu, Pads' drum targets (`s` must match `/^[a-z]{2}$/`), MIDI channel 10 | roll.js:58; main.js:1388, 4745; pads-core.js:57, 315; song.js:867 | names from the kit's voices; slot codes `ka`…`kp` |
| The RIG grid: `GRID` (every layout number), `layoutOf(recipe)`, the injected CSS; the FX faces use it with no Serum host | rig-grid.js:17–80; fx-ui.js:67–71, 585 | kit-ui lays every face on it; two additive row numbers (§4.1) |
| rig-ui's faces are the Serum panels used as donors | rig-ui.js:30–43 | not used (D6) |
| ↶ never reverts knob turns: `keepDevs` keeps `vals` (and a drum machine's `drum`) of a same-model device; canvas steps restore their own fields by meta (`sxBack`, `drBack`, `ptBack`) | main.js:1922–1932, 1943, 1970 | the kit: `vals` kept, `drum` reverted; structural edits carry `kitBack` (§5.5) |
| The classic modulation class table sweeps every non-custom, non-patch model; `destOk` | cv-mods.js:104, 156, 592–606 | the kit is skipped in cut 1 and refused with its own text (§10) |
| Schema 17; a newer file opens read-only | cv-migrate.js:117 | 18 |
| Bench targets of the family (node): d8p 0.020, d6p 0.025, d9p 0.035, dvp 0.030 | tests/bench.json `targets` | dkp 0.012 (§7.2) |
| Default ⚙ Oversampling 4 | main.js:127 | the voices render at the Inst's OS (decision f) |
| Lay keys `iN` / `iN/<part>` | song.js:552 | `iN` = the Sequencer, `iN/ka`…`iN/kp` = the voices |
| The touch "heavy" notice at 1 866 painted elements | main.js:7991–7995 | §7.3's DOM budget |
| The patch family's host idiom: `patchHost(deps)` with `edit(t, dev, label, r)` = one History step + a back meta | cv-patch.js:25–42, 140 | `kitHost(deps)` (§4.6) |

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
  with <NAME> · tap to undo") with the Sequencer + `KIT.STARTER`'s voices + `KIT.DEMO` in pattern A. The first view frames the
  Sequencer at 100 % when its 1248 px fit the canvas width (the iPad's 1366 px landscape does), else at the fit width.
- **A voice tile** (Kick, Snare, Hi-hat, Clap, Tom, Perc) on a kit canvas: adds that voice in the first empty slot (a new row; its note
  by §3.5; placed where dropped, else at Tidy's place); on any other canvas: replaces the instrument with a kit holding the Sequencer +
  that one voice and an empty pattern A (the Wavecraft idiom, IMPL-WC §3.5 [R]).
- **"+ ADD DRUM"** under the last row: the type menu → adds as a tile tap does.
- **A voice's ⋯**: Remove (the slot emptied, its cells cleared in every pattern, its note freed — one step), Reset sound (its type's
  defaults). **Its TYPE menu** changes the type: TUNE, DECAY and k1–k4 to the new type's defaults, LEVEL / CHOKE kept, an automatic name
  follows (one step).
- **The Sequencer's ⋯**: the items every instrument has (Replace with…, preset Save / Delete, Init sound = the Starter kit's sounds),
  "Demo beat" (`KIT.DEMO` into the selected pattern; a confirm when it is not empty), "Clear all patterns" (one step).
- **A kit tile on a kit**: the Starter sounds load as a preset, patterns kept — the same-model drop rule (IMPL-WC §3.5 [R]).
- **At 16 voices** the "+" row hides and a voice tile says "16 drums is the most". A structural bound — the family's payload is 16
  sounds wide (map, primaries, mute: dr-seq.js [R]) — not a performance cap (ROADMAP 14).

---------------------------------------------------------------------------------------------------------------------------------

## 2. The voices (`kit-dsp.js`, lane V)

### 2.1 Common laws [C]
Knob positions x ∈ [0, 1] (vals 0–10 / 10, the drum models' convention: models.js:756 [R]); t in seconds from the hit.
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
The row header: tap = mute, long-press = solo (the 808 grid's rule, IMPL-7a §3.6 [R]); masks in `x.mute` / `x.solo` (16 bits). Muting
recompiles the plan (the family's rule: steps carry the mask after mute / solo) and mutes the voice's notes (the payload's `mute`).

### 3.5 Notes [C]
Each present voice has a primary note (+ aliases) in the family's map shape (`map: { ka: [36], … }`). A voice added takes the first free
note of its type's list (`KIT.NOTES`): Kick 36, 35 · Snare 38, 40 · Clap 39 · Hi-hat 42, 44, 46 · Tom 45, 41, 48, 43, 47, 50 · Perc 37,
56, 75, 76, 77 — else the first free note from 60. The starter's are fixed in `KIT.STARTER` (closed hat 42, open hat 46). Roll notes, MIDI
in, the keyboard tray and Pads play the voices through the map (engine.js:2473 `drHit` [R]); the roll shows the voices' names on their rows
(`drumRowsOf`, names by §5.2). Playing live records notes, as on every drum track; recording **into the grid** (REC) is cut 2.

### 3.6 The plan and DrSeq (additive; inert without the fields)
`kit-core.compilePlan(D, S, types)` → the family's plan shape (drum-core.js:29–34 [R]) for one measure — `n 1`, `mPre [3]`, `mL1 [len]`,
`st` = 16-bit lane masks (lane j = slot j; **no accent bit**: velocities carry the accent) of the present, unmuted voices — plus:
- **`vl`**: Uint8Array, 16 velocities per step;
- **`ls`**: lane → sound (the identity for the kit).
DrSeq, when the plan has `vl`: `dm.trig(mask, vl, 16·i)` in place of `dm.trig(mask)`; `drStep`'s v = the step's highest velocity / 127
(its n the lowest primary, as today); `drNote` once per sounding lane with **that lane's** primary and velocity / 127 — so a Ducker keyed
by the kick's note ducks on every kick step (IMPL-SC §2.1 [R]); `ls` replaces `LANE_SOUND` for the primary lookup. An 808 / 606 / 909 /
SDS-V plan has neither field: every line runs as today (D1, D2: ref-7a…7d). The record's trigger matrix `tr` (§5.3, the identity in
cut 1) maps rows → voices inside compilePlan — no DrSeq change.

### 3.7 Payload
`drum-core.payload(drum, state, at, types)` for `'kit'` → the family's `{ plan, sync: true, run, bpm, swing, at, tap: 0, map, prim, mute,
smp: null, m: 'kit', pk }` (IMPL-7a §3.5 [R]); `types` (the 16 TYPE values from `vals`, passed by the host's `drumPayload`) is read only for
the kit; the host dedupes by `pk`.

### 3.8 Press inputs (`kit-core.press(state, drum, input) → { state, mem, cmds }`, the family's pure state machine, drum-core.js:789 [R])
`cell { lane, step, v }` (v 0 = off) · `paint { lane, steps[], v }` · `pat { p }` · `len { n }` · `swing { v }` · `clear` (the selected
pattern) · `clearAll` · `demo` · `mute { lane }` · `solo { lane }` · `hit { lane, v }` (an audition: a `{ c: 'hit' }` command through the
note path, the 909's idiom [R]) · `voice { slot, op: 'add' | 'remove', type }` (the record's half: the lane cleared, the note assigned /
freed; the vals' half is the host's, §4.6) · the host notifications (transport, heard, bpm, panic). Commands: `send` (now / bar), `hit`,
`notice`. `leds(S, D)` → `{ step: the heard step | −1, lit: 16 bits }`.

---------------------------------------------------------------------------------------------------------------------------------

## 4. The faces and the canvas (`kit-ui.js`, lane F; lane H wires; lane U the tray, art and skins)

### 4.1 The RIG grid (rig-grid.js `GRID` [R])
Two additive numbers (lane F; every WC and FX layout unchanged — G8 re-runs their gates): **`rows.cell: 48`** (a step row) and
**`rows.ruler: 24`** (the step numbers). Everything else is IMPL-WC §3.8: column 64, side padding 16, row gap 12, head 32, the knob cell
64 × 76 with the 40 px knob, num boxes 40 × 28, the text minima and margins, contrast ≥ 4.5 : 1, fill 0.55–0.85. The Sequencer's screen
*is* the instrument: the fill's upper bound is waived for that face alone (its margins and text rules hold).

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

### 4.3 The voice faces [C] — 4 columns = **288 px**; height 12 + 32 + 12 + 76 + 12 + 76 + 16 = **236 px**
- **Head**: TYPE ▾ (Kick / Snare / Hi-hat / Clap / Tom / Perc) · **HIT** (a pad: velocity by the press's height, the 1i curve
  `cv-keys KEY_VEL`, cv-keys.js:20 [R]; it lights on every hit of the voice at the heard time; `data-gesture="music"`).
- **Knob row 1**: TUNE · DECAY · LEVEL · CHOKE (a num cell: – / 1–4).
- **Knob row 2**: k1–k4 of its type (§2.2).
- **The bar**: the voice's name, its colour stripe, ⋯ (Remove, Reset sound). No ⏻: the row's mute is its switch; a muted voice's face dims.
- **Knobs**: wk's knob at 40 px carrying `data-ctl` / `data-dest` = the model's control ids under the module's `[data-dev]` (the classic
  convention, classic-panel.js:15 [R]); writes through the host (§4.6); press-and-hold: Reset / Enter value (no modulation items in cut 1).

### 4.4 Interactions (touch first) [C]
- **Tap** a cell: toggles it (on at the row's last-used velocity, else 100). **Drag sideways** from a cell: paints the first cell's new
  state along the row (one gesture = one History step). **Drag up / down** from an on-cell: its velocity (up = louder; the bar and a readout
  follow). The first 6 px decide which. **Long-press** (500 ms, ≤ 8 px): the step menu — Soft · Normal · Accent · Off (cut 2 adds chance /
  repeats / nudge / pitch).
- **Two fingers**: a second finger during a paint or a velocity drag cancels it (the cells revert, no step) and the pinch / pan proceeds
  (gesture.js [R]); the grid is not a music zone (only the HIT pads are).
- **Below 50 % zoom** a press pans unless the module was double-tapped (the canvas rule, ROADMAP :118 [R]).
- **Mouse**: as touch; Shift-drag sets velocity from any cell.
- **Keyboard**: the grid is one focusable element with a cursor — arrows; Space / Enter toggle; + / − velocity by 8; Delete off; M mute;
  S solo (the 808 grid's idiom, cv-drum.js:1125 [R]); aria-label "Kick, step 5, on, velocity 100".

### 4.5 Tidy and the first view [C]
The Sequencer at the instrument's place; the voices in rows of four under it in slot order, 32 px apart; the Effects panel and OUT to the
right (cvRoom's rules); the first view as §1.2.

### 4.6 Host wiring [C] — `kitHost(deps)` (kit-ui.js; the cv-patch idiom, cv-patch.js:25–42 [R])
`kitHost(deps) → { face(kind, root, args) → View, devices(t, dev), sizeOf(kind), FACE, layoutOf, cellRect(t, dev, lane, step), destroy }`;
deps: `doc`, `view()`, `get(t, dev, id)`, `set(t, dev, id, v, ph)` (the vals write + the patch post: the classic path, `ph` 'move' /
'end'), `drum(t, dev)` (cv-drum's api: `press / state / step / lit / pads`), `edit(t, dev, label, r)` (ONE History step: `r = { vals?, drum?,
lay? }` with its `kitBack`, §5.5), `notice`, `menu`, `undo`, `heard`, `rate`, `live`.

### 4.7 The Sources tray (lane U) [C]
The Drums view (cv-tray.js:597 [R]) gets two sections first — the kit tile, then "Drum modules" (the six voice tiles) — and the four
machines under "Classic machines" (their filter excludes the kit: `DRUMS` becomes `m.family === 'drums' && !isKitModel(m)`,
cv-tray.js:586 [R]); the view's tip "Our drum machine and the classic ones". Original art (cv-art.js): the tile a stylised grid of
cells; the six voice glyphs simple shapes (no instrument drawings of any product).

### 4.8 Skins [C]
Every kit module carries `[data-cv-kit]` and wears the canvas skin as the rig and FX modules do (each skin block in style.css gains the
scope; IMPL-WC §5.1 [R]). New tokens per skin: `--kit-c-kick … --kit-c-perc` (six voice colours), `--kit-cell-off`, `--kit-cell-beat`;
the grid canvas reads them (`wk.theme`) and repaints on a skin change. A skin never changes a number.

---------------------------------------------------------------------------------------------------------------------------------

## 5. The model and the project

### 5.1 The model entry (models.js, appended last) [C]
`{ id: 'kit', name: RIG.NAME + ' ' + KIT.WORD, model: 'Drum machine', year: 2026, family: 'drums', tag, about (our words: synthesized
voices, no recordings), theme (the charcoal skin's chip accents), sections: 16 × "Drum n" with 10 controls each, presets: KIT.KITS,
map(P, v) → { engine: 'drums', machine: 'kit', level: 1, drum: { the 160 values: knobs / 10; TYPE and CHOKE as indices } } }`; no maker.
`isKitModel(m) = !!m && m.id === 'kit'` beside `isRigModel` (models.js:912 [R]); `classicOf(kit)` is false (it has a family).

### 5.2 Control ids [C]
Per slot s ∈ a…p: `k<s>t` TYPE (0 empty · 1 Kick · 2 Snare · 3 Hi-hat · 4 Clap · 5 Tom · 6 Perc; cut 2: 7 Sample), `k<s>u` TUNE, `k<s>d`
DECAY, `k<s>l` LEVEL, `k<s>c` CHOKE (0–4), `k<s>1`…`k<s>4` the character knobs (knobs 0–10, the drum models' convention). **A voice exists
iff its TYPE > 0**: the vals are the truth of what sounds; the record follows (§5.4). **Names**: `kit-core.names(vals, drum)` → 16 strings
— `drum.nm[j]` when set, else the type's label + an ordinal among same-type voices ("Tom", "Tom 2"), '' for an empty slot; every place that
names a kit's rows (the roll, the Ducker's NOTE menu, the Pads labels, the Mod list) calls it with the device.

### 5.3 The record (`dev.drum` of a kit; `drum-core.normDrum(d, 'kit')` → `kit-core.normKit`: exact lengths, every field bounded, unknown
fields dropped, idempotent, never throws) [C]
```
{ v: 1, m: 'kit',
  pat: [8 × { len 1–16, sc 3, cells: [≤ 256 × { l 0–15, s 0–15, v 1–127, c? 0–100, r? 1–4, n? −120…120, p? −24…24 }] }],
  ui:  { pat 0–7 },
  x:   { sync: true, swing 50–75, mute 0–0xFFFF, solo 0–0xFFFF, rec: false },
  map: { ka … kp: [primary, …aliases] },     the family's shape; notes 0–127, unique
  nm:  [16 × '' | ≤ 16 characters],
  tr:  [16 × 16-bit row → voice mask],        the identity in cut 1
  smp: {} }                                   the family's slots, cut 2's Sample type
```
Cells are **sparse**, sorted by (s, l), unique per (l, s); `c / r / n / p` absent = neutral (100 / 1 / 0 / 0). An empty pattern costs
nothing; the demo ≈ 20 cells; a full 16 × 16 pattern ≈ 6 KB of JSON. `sc` (the step scale) is held for cut 2's triplets / 32nds.

### 5.4 Reconcile [C]
`kit-core.reconcile(vals, drum) → drum` (pure, idempotent): a slot whose TYPE became 0 keeps its cells (inert: the plan compiles present
voices only — an undo or another kit brings them back) and its note (freed only by Remove); a slot that became present without a note
gets one (§3.5); an automatic name stays ''. The host runs it after a kit load, a TYPE change and every undo / redo restore.

### 5.5 History [C, decision g]
- A grid gesture — a tap, a paint, a velocity drag, a pattern / LENGTH / SWING change, CLEAR, mute, solo — is **one History step** ("Edit
  pattern", "Clear pattern A" …). `keepDevs` (main.js:1922 [R]) keeps a kit's `vals` (knob turns are never reverted: the app's policy) but
  **not** its `drum`, so ↶ / ↷ move the pattern.
- **Structural edits** — add / remove a voice, a TYPE change, a kit load, Reset sound — are one step each carrying a **`kitBack`** meta
  with the vals they changed (the `sxBack` / `drBack` / `ptBack` idiom, main.js:1943, 1970 [R]), so ↶ restores the voice exactly.
- `KIT.UNDO = 'notice'` flips to the family's rule (no grid steps; CLEAR / Demo beat / Clear all with "tap to undo").

### 5.6 Schema 18 [C]
`cv-migrate.SCHEMA = 18`; `STEPS[17]` the identity (no stored data changes); its header line "17 → 18: our drum machine (model 'kit',
`dev.drum` in its shape)". A kit in an 18 file opened by a 17 build would read `'kit'` through `modelById`'s fallback and autosave the
loss → the bump makes it read-only there (the 7a / WC reasoning, cv-migrate.js:28–36 [R]). `song.normDev` keeps `drum` for a kit through
`PERS` (song.js:582, 604 [R]); a record of another machine's shape on a kit is normalised to the kit's. Lay: `iN` (the Sequencer),
`iN/ka`…`iN/kp` (song.js:552 [R] accepts them). **toV1** (Save as classic project): the kit track keeps its notes; its lost line "“<track>”:
<NAME> is this app's drum machine — the live site has none; its piano-roll notes are kept" (the 808's rule, IMPL-7a §6 [R]).

### 5.7 Kits (presets) [C]
`KIT.KITS` = four of ours: **Starter** (= the defaults: Kick, Snare, Clap, Closed hat, Open hat (choke 1 with the closed hat), Low tom,
High tom, Rim (a Perc)), **Deep** (a lower, longer kick; darker hats), **Tight** (short decays, a snappy snare), **Crunch** (drive on the
kick and toms, bright hats). Each is a full set of the 160 values, empty slots included, so a kit load sets which voices exist (the record
reconciled, §5.4). The user's own kits through the model's preset store (Save / Delete, as every model). A kit never touches the patterns.
`KIT.DEMO` (pattern A, ours, 16 steps): kick 1 · 5 · 9 · 13; clap 5 · 13; closed hat 3 · 7 · 11 at 100 and 1 · 5 · 9 · 13 at 64; open hat
15 at 100 (choked by the closed hat on the next bar's step 1); rim 12 at 64. The diagram in §1.1 is illustrative, not this data.

### 5.8 Bounce and files
The family's paths: `bounceSet`'s `syncedOf` with `drumAudible` = any cell in the selected pattern (main.js:4275, 5238 [R]); `drumPayload`
offline (main.js:556 [R]); MIDI export on channel 10 (song.js:867 [R]); no sample needs in cut 1.

---------------------------------------------------------------------------------------------------------------------------------

## 6. Hooks for row 20 (the first beat) and row 26 (the LFO combiner)

This stage builds the hooks, not the tutorial or the combiner. `main.js` exposes **`kitApi`** (an object handed to the tutorial's module at
boot; `__synthTest.cv.kit` wraps the same).

### 6.1 Row 20
- `kitApi.add(track, { demo })` — the tile's action; `{ demo: false }` starts with an empty pattern A (the tutorial's start), the tile's
  default is `{ demo: true }` (Q4).
- **Anchors** for highlights: `[data-kit="seq"]`, `[data-kit="pat"][data-p]`, `[data-kit="voice"][data-slot]`, `[data-kit="hit"]`,
  `[data-kit="swing"]`, `[data-kit="add"]`, knobs by `data-dest`; a cell (one canvas, no element) through `kitApi.cellRect(track, lane,
  step)` → its box in world px.
- **State**: `kitApi.state(trackId)` → a copy `{ pattern, len, swing, playing, voices: [{ slot, type, name, note, cells: { step: v } }] }`.
- **Events**: `kitApi.on(trackId, fn) → off` — `{ e: 'cell', lane, step, v }`, `{ e: 'pattern', p }`, `{ e: 'voice', slot, op, type }`,
  `{ e: 'swing', v }`, after each applied edit. The tutorial checks progress; it never edits behind the user's back.
- **The kick**: `kitApi.kick(trackId)` → `{ slot, note }` of the lowest Kick slot — the tutorial's Ducker step (TRIGGER = the kit track,
  NOTE = that note: IMPL-SC [R]).

### 6.2 Row 26
- **Pure**: `kit-core.hitsIn(plan, lanes, t0, t1)` → `[{ t (song ticks), lane, v }]` — exactly where DrSeq fires (swing and the loop
  included); for any drum machine `drum-core.hitsIn(drum, model, notes, t0, t1)` over the family's `toNotes` (drum-core.js:652 [R]).
- **Host**: `kitApi.hits(trackId, { role: 'kick' } | { notes: [n…] }, t0, t1)` → the machine's hits (synced) merged with the track's
  roll notes on those notes, sorted; `kitApi.on` also fires `{ e: 'plan' }` when the payload's pk changes and on the track's note edits.
- Row 26's own contract draws them. Nothing in this stage depends on row 26.

---------------------------------------------------------------------------------------------------------------------------------

## 7. Engine work and cost (lane V; the iPad)

### 7.1 Files [C]
- **`kit-dsp.js`** (new; a classic script, one IIFE publishing the frozen `globalThis.DrKit`, null on a failure — dr-808.js's form).
- **`engine.js`**, three sites, nothing else (Track, Chain, graph, ModCore and the protocol unchanged): PatchP builds `new KitP(o.drum)`
  for machine `'kit'` (a fixed-shape class of the 160 ids in one order with `KIT` defaults), `new DrumP(o.drum)` otherwise (D2);
  `drOn` / `drGain` take the factory by id — `DrKit` for `'kit'`, `Dr808` for the rest (a missing one: the family's `drFail`); `warmUp` adds a
  kit round after `warmDrumsV` (engine.js:3807 [R]): every type at v 64 / 127, a retrigger, a choke, a two-step synced plan through
  DrSeq, an OS change — then the plain paths' re-warm as today (the 2b JSC lesson, HANDOVER §5 [R]).
- **`dr-seq.js`**: `vl` / `ls` (§3.6; lane S).
- **The DSP lists** (each gains `kit-dsp.js` after `dr-seq.js`, its global `DrKit`): main.js:899 `DSP_FILES` (lane H applies the line),
  cv-cost.js:345, smprender.js:30, wk.js:3447, tests/golden-harness.mjs:29, tests/dsp-scope.mjs:40, tests/app.test.mjs's list (a pin);
  `sw.js` through `node tools/precache.mjs --write` (the lead).

### 7.2 Budgets [C] (node on the M4 Max; the iPad Pro measured 0.7–1.0 × node on the family's rows, IMPL-7a §2.6 [R]: its target = node's)

| row | what | node | ipad |
|---|---|---|---|
| **dkp** | the Starter kit + the demo beat, 120 BPM, synced, OS 4, 48 kHz (the whole track) | 0.012 | 0.012 |
| **dkx** | 16 voices, every step of every lane at v 127, every DECAY at 10, OS 4 | 0.06 | 0.06 |
| **dki** | powered, synced, stopped, silent (in engine-track, as d8i: not a scenario) | 0.0005 | 0.001 |

`cv-cost` `COST.synth.kit = C('dkp', 'drums', 1, base, voice)` from the measured dkp (cv-cost.js:103 [R]); the tile's label from it.
V8: every existing bench row within 2 %. JSC (the shell method, IMPL-2b §9): d8p, d9p, c1, d, mt within 3 % (PatchP and DrSeq changed).
The warm-up's time ≤ 1.1 × today's (engine-track measures it).

### 7.3 The UI on the iPad [C]
Painted elements: the Sequencer ≤ 160, a voice face ≤ 150 → the Starter scene (Sequencer + 8 voices + an empty Effects panel + OUT)
≤ 1 500, under the touch notice's 1 866 (main.js:7995 [R]); a 16-voice kit ≈ 2 700 (the notice fires once on touch — said in §12). While
playing: per heard step one transform + ≤ 16 class flips (lamps, HIT pads), no layout, no canvas repaint; stopped: 0 paints; an edit
repaints the grid canvas once (≤ 2 ms at dpr 2 under the Mac's 4× throttle). The playhead and lamps ride the drum host's heard queue on
the one frame clock (`wk.clock`, ROADMAP 23 [R]).

---------------------------------------------------------------------------------------------------------------------------------

## 8. Gates

| gate | what | target |
|---|---|---|
| **G1 outside = today (D1, D2)** | every golden — golden-classic / -fx / -presets / -random / -graph; -drums / -606 / -909 / -sdsv with ref-7a…7d (their frozen dr-808 / dr-seq / engine against the current tree); -moog / -moog-b / -moog-c; ref-M / -SC / -MM / -WC / -P / -9 / -9b / -9c —, canonical-stream's fixtures; drum-core's pins for the four (records, sessions, payloads, plans, pk, notes); the warm-up's "first Track = a fresh one" for every machine; every existing test file green with only §9.4's pins moved | exact |
| **G2 the voice laws (D4)** | every target of §2.3, every type, every rate | the stated tolerances |
| **G3 the machine** | span invariance, sleep / wake, idle skip, denormals (10 s of silence then a hit: no subnormal in any state), hostile values; the click bound at retrigger / choke / power off / panic / mute and at machine switches 808 ↔ kit ↔ 909 (the classic ↔ drums step, ROADMAP :127 [R], recorded, not fixed here); **loudness**: the demo beat on the Starter kit through the Track within 1 dB RMS of the 808's d8p groove, the limiter untouched (the family's rule, models.js:800 [R]) | exact / stated |
| **G4 the sequencer (D3)** | kit-core: normKit fuzz (never throws, idempotent, bounds), the press table (every input of §3.8), compilePlan memo and pk, reconcile, names, the notes rule, `hitsIn` ≡ DrSeq's fire positions; DrSeq with `vl` (velocities reach the machine; drStep / drNote values; a Ducker keyed by the kick's note ducks on each kick step); **D5**: the demo beat as steps ≡ the same hits as roll notes through the song path at swing 50 / 62 / 75; **D7**: a bounce ≡ live; seek, loop wrap, a pattern swap at the measure's end, a LENGTH change, a mute's recompile | exact |
| **G5 frozen refs** | `tests/golden-kit.test.mjs` + `tests/ref-DM/` (verbatim kit-dsp.js, dr-seq.js, engine.js + MANIFEST `{ note, commit, files: { sha256 } }`: ref-7d's format, tests/golden-sdsv.test.mjs:1–40 [R]); cases: each type × TUNE / DECAY at 0 / 0.5 / 1 × each k at 0 / 1 × v 32 / 100 / 127; retrigger trains; chokes; the demo beat synced at 120 and 128 BPM, swing 62; roll notes; OS 1 / 2 / 4; 44.1 × 1. Frozen by the lead at cut 1's acceptance (`GOLDEN_FREEZE_DM=1`); before that a determinism self-check with a diagnostic | exact |
| **G6 files and undo** | schema pins (18, STEPS 18, "a newer file" 19); an 18 file with a kit opens read-only in the base build; normKit through song.normDev; toV1's lost line; a gesture = one step, ↶ / ↷ move the pattern; knob turns never reverted; add / remove / TYPE / kit load / Reset restored exactly by `kitBack`; Replace → ↶ restores the old instrument whole; reconcile after every restore | exact |
| **G7 UI flows** (reviewer 2: headless Chrome for Testing, 1440 × 900 and touch 1366 × 1024 / 1024 × 1366, dpr 2, downloads denied) | the kit tile on a Juno, an 808 and a Wavecraft canvas (the Starter + demo; ▶ plays; the notice; ↶); a voice tile on a kit (adds) and on a Juno (a kit with that voice); "+ ADD DRUM"; TYPE change; Remove; tap / paint / velocity drag / the step menu; a pattern switch while playing (at the measure's end); LENGTH; CLEAR + ↶; SWING; mute / solo; HIT pads (velocity by height; two fingers = two hits); lamps and playhead at the heard time; the roll's named rows; the Ducker's NOTE menu lists the kit's names; a new Pads module follows the kit (its voices, their colours); two fingers on the grid zoom, never toggle a cell, and cancel a paint; below 50 % a press pans; the keyboard grid; every other canvas unchanged (its sims green); no console error | pass |
| **G8 layout** (§4.1; `tests/ui-layout-kit.mjs`, the WC harness's method) | widths 64·n + 32; knobs on column centres and row lines ± 0.5; row tops; cells 64 × 48 on the step columns; text ≥ 6 / 8 px from edges / other text, nothing clipped, the minima; contrast ≥ 4.5 : 1 in every skin; fill 0.55–0.85 on the voice faces; ui-layout-wc / ui-layout-fx unchanged. **Contact sheets** (the three sizes: the Starter kit, every type's face, a 16-voice kit) to the lead's scratchpad, shown to the user before deploy (not committed) | exact / the user's eye |
| **G9 frame cost** (the CDP harness, IMPL-P's method) | scenes `kitS` (the Starter + FX + OUT) and `kitX` (16 voices): pan / pinch 25–200 % / a module drag P+ at 1× and 4× CPU (bursts median ≤ 17 ms, p95 ≤ 20, no frame > 33), P at 6×; playing at 160 BPM: no layout per step, ≤ 1 transform + ≤ 16 class flips; stopped: 0 paints; painted elements within §7.3; `ui-DM-mac` recorded in bench.json | pass / recorded |
| **G10 touch / a11y** | hits ≥ 44 px at 100 %; the keyboard grid; aria-labels; music zones only on HIT pads; a second finger cancels; Escape closes menus | pass |
| **G11 our own (D6, D7)** | the import lines of kit-core.js (none), kit-dsp.js (no other global), kit-ui.js (rig-grid / wk / kit-core only) — a grep test; no other instrument's maker or machine name and no "Serum" / "Wavecraft" literal in kit-*.js, the kit's tray texts or notices (the display name only through the model); the Hi-hat's ratio set differs from every oscillator table of dr-808.js (a test) | exact |
| **G12 bench** | dkp / dkx / dki within §7.2 (node); V8 and JSC A/B; bench.html's list gains the kit (`ipad: null` until the consolidated iPad pass) | pass |

---------------------------------------------------------------------------------------------------------------------------------

## 9. Lanes (the leaner shape; cut 1)

### 9.0 Before the builders
- **A skeptic pass on this contract** (Fable 5.1, read-only, scripts against c515abf): its findings fixed in the text (§14).
- **Phase 0 — the lead (Fable 5.1)**: `kit-core.js` with `KIT` as data (WORD, ID, SLOTS 16, CODES `ka`…`kp`, TYPES, STARTER, DEMO,
  KITS, VEL, NOTES, UNDO, CHOKE_MS) and empty stubs of lane S's functions; models.js `kit` + `isKitModel`; drum-core.js `mach()`
  five-way, `PERS.kit` / `MAPS.kit` and the dispatch stubs; cv-mods.js `noClassic` skips the kit and `destOk` refuses it ("The drum
  machine's knobs take modulation in its next update"); cv-migrate 18; a cv-cost placeholder; a cv-art placeholder; the pins of §9.4 moved;
  `tests/ref-DM/` empty. Every test green. The builders reset to this commit (`git reset --hard <phase 0>`, `git log -1` checked).

### 9.1 The lanes (phase 1 in parallel in worktrees; H in phase 2 on phase 1's merge)

| lane | owns (exclusive) | gates | model |
|---|---|---|---|
| **V** voices + engine | `kit-dsp.js` (new), `engine.js` (§7.1), `cv-cost.js` (the list + the measured COST), `smprender.js`, `wk.js` (the DSP map line only), `tests/golden-harness.mjs`, `tests/dsp-scope.mjs`, `tests/kit-dsp.test.mjs` (new), `tests/golden-kit.test.mjs` (new), `tests/engine-track.test.mjs` (+ kit), `tests/bench-scenarios.mjs` + `tests/bench.json` (dkp / dkx / dki), `tests/app.test.mjs` (the list pin) | G1 (engine side), G2, G3, G5 (prepared; the lead freezes), G12 | Opus 5.5 |
| **S** sequencer | `kit-core.js` (normKit, press, compilePlan, payload, toNotes, hitsIn, names, reconcile, noteFor, leds, initState), `drum-core.js` (the dispatch bodies; `hitsIn`), `dr-seq.js` (`vl`, `ls`), `cv-drum.js` (drumHost's `machOf` / session for 'kit' only — no widget), `tests/kit-core.test.mjs` (new), `tests/dr-seq.test.mjs`, `tests/drum-core.test.mjs` | G4 (node), G1 (the four's pins, ref-7a…7d) | Opus 5.5 |
| **F** faces | `kit-ui.js` (new: `kitHost`, `FACE`, the Sequencer face, the voice faces, HIT pads, lamps, the step menu, the "+" menu, `cellRect`), `rig-grid.js` (the two additive rows), `tests/kit-ui.test.mjs` (new; the fake DOM, the safe assert wrapper), `tests/ui-layout-kit.mjs` (new; G8 and the contact sheets) | G8, G10, G7's face half | Opus 5.5 |
| **U** tray, art, skins | `cv-tray.js` (§4.7), `cv-art.js` (the tile + six glyphs), `style.css` (the `[data-cv-kit]` scope in every skin block, the kit tokens), `tests/cv-tray.test.mjs`, `tests/cv-art.test.mjs` | G7's tray half, G11's texts | Sonnet |
| **H** host | `main.js` (`isKitDev` / `kitDevs`; cvDevices; renderCustom → kit-ui; sizes; Tidy and the first view; drops, replace, add, remove, TYPE, kit load, Reset, Demo beat, Clear all; `edit` with `kitBack`; keepDevs for the kit; reconcile after a restore; the DSP_FILES line; `drumPayload`'s `types`; the Ducker's names; toV1's line; `kitApi`; `__synthTest.cv.kit`), `roll.js` (`drumRowsOf(dev)` names for the kit), `cv-pads.js` (orderOf / defaultsOf for a kit), `tests/canvas-DM-sim.test.mjs` (new), the pins in tests/main.test.mjs / roll.test.mjs / cv-pads.test.mjs | G6, G7's flows, G4's host part (Ducker, Pads, roll) | Opus 5.5 |
| reviewers × 2 (phase 3) | (1) **the real engine + sim** (Fable 5.1): G1–G6, G12, adversarial — hostile records, 16 voices in one choke group at 300 BPM, undo storms on the grid, 808 ↔ kit ↔ Wavecraft switches mid-ring, OS changes / power / mute / panic mid-ring, bounce = live; (2) **headless Chrome** (Opus 5.5): G7–G11 at the three sizes, touch-emulated | — | — |
| fixers | the finding's files, the failing test first | | Sonnet / Opus 5.5 |

Then one sweep (every test file, one at a time), the contact sheets to the user, the deploy (commit on `canvas`, `tools/deploy-canvas.sh`),
the user's hands-on — their feel decides cut 2's shape and the flips of the header's constants.

### 9.2 Interfaces (fixed here)
- **DrKit** (`kit-dsp.js`): `create(inst, 'kit') → machine` — `set(drum)` (a KitP; the lane states in §13 how it re-reads per span),
  `setOS(os, fs)`, `hit(slot, v127)` (a note through the map), `trig(mask, vl, o)` (a step: lane j = slot j, `vl[o + j]` its velocity),
  `render(buf, N, F0)` (adds the live instances into the mono OS-rate bus), `post(L, R, mono, n)`, `poll(F0)` (nothing), `live()`,
  `reset()`, `mon() → { lit: 16 bits, act: Float32Array(16) }`, `smp(slots)` (stored, inert in cut 1), `setSalt(s)`; `DrKit.gain()` → 1,
  `DrKit.TYPES` (the copy G-tested against kit-core's), `DrKit.VER`.
- **kit-core** (a leaf): `KIT`, `normKit(d)`, `initState()`, `press(S, D, input)`, `leds(S, D)`, `compilePlan(D, S, types)`, `payload(D, S,
  at, types)`, `toNotes(plan, opts)`, `hitsIn(plan, lanes, t0, t1)`, `names(vals, D)`, `reconcile(vals, D)`, `noteFor(type, map)`,
  `typesOf(vals)`.
- **drum-core**: every exported function dispatches `'kit'` to kit-core (the extra `types` argument read only for it); `hitsIn(drum,
  model, notes, t0, t1)` for every machine.
- **DrSeq**: the plan's optional `vl` (Uint8Array, 16 a step) and `ls` (Int8Array(16)); without them, every line as today.
- **kitHost** (§4.6) and **kitApi** (§6).
- Messages: none new — the family's `{ t: 'patch' }` (machine 'kit', a KitP) and `{ t: 'seq' }` payload.

### 9.3 Rules
`?v=9` on every import; new test files `import './v8-guard.mjs'` first and use the app's `?v=` suffix; never a fake-DOM node in `assert.*`
(serum-ui.test's safe wrapper); one test file at a time with `--max-old-space-size=2048`; no lane commits `sw.js`; no lane edits another's
file (H applies main.js's DSP_FILES line; F's grid CSS is injected by kit-ui as rig-grid's is; U owns style.css); headless runs use Chrome
for Testing with its own `--user-data-dir` in the scratchpad and downloads denied; browser first (no iPad app build; its node tests stay in
the sweep); a layout number lives only in rig-grid.js; every voice law lives in `KIT.TYPES` (kit-dsp.js's copy compared by a test).

### 9.4 Pins that move by design
MODELS 19 → 20 (cv-art, cv-tray, cv-shell-sim counts); cv-tray's Drums view (sections, tiles, tip); cv-cost's rows; cv-migrate's 17 → 18
pins and the schema pins in canvas-8 / -M / -SC / -WC sims; engine-track's warm-up machine list (`,kit`); app.test / golden-harness /
dsp-scope lists; lint (`?v=9` on the new files); pwa (the new files precached). **Not changed**: every golden and frozen ref; drum-core's
four-machine pins; DrSeq's existing tests; canonical-stream; cv-mods' class table (the kit is skipped).

### 9.5 Docs (the lead, at the end of each cut)
ROADMAP row 19 (status, the user's answers and feedback), HANDOVER (§3 an item; §4 kit-core / kit-dsp / kit-ui, DrSeq's `vl`, the record,
`kitBack`; §5 lessons), `tests/ref-DM/` frozen, bench.json's rows and `ui-DM-mac`.

---------------------------------------------------------------------------------------------------------------------------------

## 10. The cuts

**Cut 1 — playable (this contract's lanes).** The kit tile and six voice tiles in the Drums view; the Sequencer and the voice modules in
the Wavecraft look; six synthesized types; the Starter kit + the demo beat; four kits (+ the user's own); patterns A–H of 1–16 sixteenths;
per-step on / off and velocity (drag, long-press presets); swing; mute / solo; choke groups; HIT pads, row lamps and the playhead at the
heard time; follows the song's ▶ and tempo; roll notes, MIDI, the keyboard and Pads play it (named rows); a Ducker follows its kick; ↶ for
grid edits; schema 18; the hooks for rows 20 and 26. **Not in cut 1**: stereo pan, samples, cords, modulation onto its knobs (refused
with its text), step chance / repeats / nudge / pitch (held in the record), recording into the grid, → Piano roll, longer patterns.

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
- the light-show skin's pulses on the lamps (WC-2).

**Later**: per-step parameter locks (row 21's automation model), pattern chains / a song mode, per-row lengths, more types (metal /
cowbell, cymbal, FM, a pitched bass kick played by notes), a kit browser, a kit lane as a modulation source on other tracks (needs a
cross-track source).

---------------------------------------------------------------------------------------------------------------------------------

## 11. Questions for the user

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
- One instrument per track (1f): the drum machine is its own track; Wavecraft meets it through a Ducker and, later, row 26's marks.
- 16 drums, 8 patterns, 16 steps a pattern in cut 1 (the family's 16-wide payload; steps grow in cut 2).
- No modulation onto kit knobs in cut 1 (refused with its text, D5: nothing hidden).
- The voices follow §2's laws, not anyone's ear: the user decides by listening when they like; a retune is a lead's re-freeze of ref-DM
  with a note (never a loosened gate).
- A 16-voice kit (≈ 2 700 painted elements) passes the touch notice's threshold: the notice shows once.
- The classic ↔ drums switch step (ROADMAP's known engine issue, :127 [R]) applies to the kit as to every drum machine.
- ↶ differs from the four classic machines' (decision g); `KIT.UNDO` flips it.
- No free-running tempo: the machine always follows the song.

## 13. Notes (the builders fill in)

## 14. Review log

## The user's answers (2026-11-01)
- **Layout**: the step grid + a module per drum (as proposed).
- **Cables**: not at first (as proposed).
- **Start**: **an empty grid** — a new machine opens with no steps set (the starter kit's 8 drums loaded, pattern A empty). Changes the
  proposal's "simple beat": the tile's starter pattern goes; the tutorial (row 20) builds the beat from the empty grid.
- **Sounds**: our own synth drums first; samples in cut 2 (as proposed).
- **Name** (lead, first guess): the display name is derived from the one name constant (`RIG.NAME` + ' Drums') — never a second literal.
- **Models** (lead): no Fable lanes (the user's budget rule, 2026-10-19) — the skeptic and phase 0 on Opus 5.5.
