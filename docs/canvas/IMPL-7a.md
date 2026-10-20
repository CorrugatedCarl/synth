# Stage 7a: the TR-808 drum machine (IMPL-7a) — contract

The user, 2026-10-19: drum machines on the canvas (ROADMAP stage 7); the proposal [PROPOSAL-drums.md](PROPOSAL-drums.md) and its
answers (2026-10-20): the order **TR-808 → TR-606 → TR-909 → Simmons SDS-V**, starting after milestone 3 ships; (1) **original
sounds only** — our own circuit-level emulation of the 808's voice circuits, labelled as ours — plus **"load your own sounds"** into a
voice slot; (2) the **authentic panel** (original art, no logos, no maker names) + an **extras strip that starts neutral**, like the
TB-303's; (3) **mix output first** (one stereo out), the per-drum jacks drawn and cable-able later (stage 4); (4) **"both ways"**: the
808's own step sequencer with its real workflow, **and** a piano-roll path (named drum rows; roll notes play the drums).

Design inputs: [research-drums.md](research-drums.md) (the survey, cited **RD §n**) and this stage's appendix
[research-808-circuits.md](research-808-circuits.md) (the 808's circuits, trigger bus, sequencer and panel facts, cited **RC §n**);
[IMPL-panels.md](IMPL-panels.md) (the layout format, 2 px/mm); [IMPL-1i.md](IMPL-1i.md) (velocity from where a key is touched, the
`perf` host, music zones); [IMPL-2b.md](IMPL-2b.md) (the classic adapter: drum knobs as modulation destinations); [IMPL-3.md](IMPL-3.md)
(milestone 3, whose deploy this stage follows; `wk.storeDensity`). ROADMAP and its feedback rows win where they differ. Code
references are to `canvas` at 5129c60 (they drift; the names do not; the review's are at deed338). Sections 1–10 are the contract,
§11 the lanes, §12 the gates, §13 the questions for the user (answered), §14 the builders' notes, §15 the review log (the fixes it
lists are applied in the sections it names).

**Every number is tagged**: **[R]** comes from research (with its RC / RD section; **[R?]** = a secondary or conflicting source that
lane V pins from the service-note schematic, RC §14) and **[C]** is a choice made here (the builder may refine a [C] with a reason in
§14; never an [R] without a source).

**Invariants of the stage**
- **D1 Old sound bit-identical**: every golden shard (`golden-classic`, `-fx`, `-presets`, `-random`, `-graph`), `canonical-stream`
  (fixture untouched), the cp2 / ct2 / 2b fixtures, the bench rows' outputs. `engine.js` gains branches reached only by
  `kind === 'drums'`; `AVoice` / `FVoice` / Serum code untouched (not in the diff; `tests/v8-guard.mjs` only sets a V8 flag, it
  checks no code — §15 #31); no existing patch gains a key.
- **D2 New sound frozen**: the drum DSP is pinned at the acceptance commit by a new frozen reference set (`tests/ref-7a/`, §12.2), so
  7b (the 606 reuses these circuits) and every later stage keep the 808 bit-identical.
- **D3 One instrument per track** (1f): the 808 is a track's instrument, fed into the track's FX panel and OUT like a classic synth;
  its one `out` jack is the mix; the per-drum jacks are drawn on the panel, inert, "cable-able with full patching (stage 4)".
- **D4 Original content**: no Roland (or other) recordings, schematics, manual text, logos or maker names on the panel or the tile;
  circuits are modelled from published facts in our own code; the panel and tile art are ours; the sounds are labelled "our model of
  the circuits, not recordings" (§2.5, §7.5).
- **D5 Both ways are one sound**: a pattern played by the 808's sequencer and the same pattern written to the piano roll ("→ Piano
  roll") and played as notes render **bit-identically** where the step frames are whole numbers (120 BPM at 48 kHz: 25 frames a
  tick), and with every hit on the same 4-frame grid point or the next one at any other tempo — at any swing, because both paths
  put a swung step on the same whole tick (§3.5); with an empty FX panel and no cables on the 808 (§9, §15 #34); §2.1 span
  invariance and the order-free trigger latch, §4.4, gate §12.2.
- **D6 Budgets**: §2.6's rows on the Mac (V8), the JSC shell and the user's iPad; no allocation on the audio thread; a silent machine
  costs ≤ 0.0005 (SPEC §9.2's quiet-instrument budget).
- **D7 Determinism**: hits fall on frames that are a function of the transport, the plan and the tempo only; noise is seeded per Inst
  (salted as SPEC §6.2.1); offline bounce = live.

## 1. The drum family

### 1.1 The model and the Inst kind

- `models.js` gains `tr808` (`name 'TR-808'`, `model 'Rhythm Composer'`, `maker 'Roland'` — a model label as for every synth, never
  printed on the panel or the tile, D4 —, `year 1980`, **`family: 'drums'`**, `custom` falsy, `theme`, `sections` with the controls
  of §2.3, `presets` (§2.5), `map(P, v, G)` → a patch `{ engine: 'drums', drum: {…§2.3: flat knob positions and switches…}, level:
  a constant, … }` built **without** `base(G)`'s voice fields (an unknown key warns once: `PatchP` gains `drum` as a pass-through like
  `serum` / `seq` / `fxr`, engine.js:1369). The patch is a pure function of the panel values (as every model's: `patchFor`,
  `buildPatch` and `CG.instPatch` see `vals` only — models.js:756, main.js:396, cv-graph.js:276); the device's memory, note map,
  mute / solo and sample slots travel in the drum `{t: 'seq'}` payload instead (§3.5; §15 #2).
  `MODELS` = the 13 of today + `tr808`, **appended last** (after `serum`), so every index-based use of the 13 (`modelById`'s
  `MODELS[1]` fallback, the tests) is unchanged [C].
- **Filters**: every `!m.custom` site that means "a classic keyboard synth" gains `&& m.family !== 'drums'` (cv-tray `CLASSIC`, the
  Simple-layout paths `instUi` / `srcUi` / `cvSetLayout` / the ⋯ item and main's `o.ui === 'flow' && !m.custom` paths, the tile's
  SIMPLE badge and aria text, `POLY_TO`, chordCheck — §8, §10.1); the tests that iterate non-custom `MODELS` are listed in §12.6 with
  the rule each gets.
- **Engine**: `Inst.kind = 'drums'` (from `p.engine`). The Inst owns one machine object `this.dm` (null for every other kind; built
  between quanta at the first drums `setPatch`: `globalThis.Dr808.create(this)`) and one sequencer `this.sq` (a `DrSeq`, §3.5 —
  the same field and duck type the TB-303's state uses, so `Track.process`'s `q.run || q.sync` gate and its `q.pos += len` need no
  change). The kind's branches (engine.js; lane E): `setPatch` (kind change: `allOff(true)`, voices emptied to `[]` — `moRefresh`
  and the voice loops read `voices.length` —, `dm.set(p.drum)`, `moRefresh()` kept for cabled fields; a kind change **to or from**
  'drums' first releases and then **drops `this.sq`** (`= null`): today `seqMsg` reuses whatever object is there,
  `this.sq || (this.sq = {…})` + `Object.assign` (engine.js:2534–2536), so a 303 payload would write into a `DrSeq` and the reverse),
  `anyActive` (→ `dm.live()`), `allOff(hard)` (hard: the tail of `fadeOut`, then `dm.reset()` — the voices' `kill()`), `fadeOut` (the
  machine renders its own ≈ 3 ms raised-cosine tail like the voices), `isQuiet` (also `!dm.live()`), `panicClear` (`dm.reset()`: else
  a ringing circuit resumes after the panic's 5 ms output fade, engine.js:3493 / 3519), `noteOn` / `noteOff` (§1.4), `transportHook`
  (→ `sq.transport`), `seqMsg` / `seqEvents` / `seqRelease` (→ `DrSeq`; `seqMsg` routes by the **payload's shape** (`s.plan`
  present: a drum payload), so a drum payload that arrives before the drums patch is kept and applied when the kind becomes 'drums',
  and a 303 payload reaching a drums Inst is dropped; `seqEvents`' `kind !== 'analog'` early return comes after the drums branch),
  `renderSpan` (§2.1), the idle rule, `os` (→ `dm.setOS` through `reqOS` / `osFade`), `stats` (voices = sounding lanes), `postMon`
  (§3.5), `warmUp` (a **drums round of its own** after the `WARM` loop and before `SD.warmUp` / `warmGraph` — every sound at V_N and
  V_A, a retrigger, the choke, a short synced plan through `DrSeq`, an OS change — so `warmGraph`'s re-warm of the classic paths
  comes after it (the 2b JSC lesson); **not** a `WARM` entry: those are played with notes 48 / 67 only (engine.js:2983, = HT and an
  unmapped key) and replayed twice more on a graphed Inst by `warmGraph` (3019); `WARM` stays as it is), `restore` (machine and
  sequencer back to fresh: `dm.reset()`, `this.sq = null` — today's `restore` leaves `sq` alone, 1491–1508), `setSalt` (the noise
  seed). The Track's own writes into `x.sq` stay: `run = false` (panic, retire, end: 3328, 3484, 3515 — a free machine stops) and
  `syncStep = null` (power on, 3412: `DrSeq` declares a `syncStep` field and reads null as "re-anchor"), so `DrSeq`'s fixed shape is
  `{ run, sync, pos, syncStep }` + methods. The Track, Chain, graph, ModCore and protocol code is unchanged.
- **One DSP script, one sequencer script** (classic worklet scripts, IIFE publishing a frozen global, `try/catch` → null, as
  serum-dsp.js): **`dr-808.js`** → `globalThis.Dr808` (the circuits, §2) and **`dr-seq.js`** → `globalThis.DrSeq` (the clock, §3.5).
  Both join every DSP list (§10.2). The pure main-side model is **`drum-core.js`** (ES module, no DOM: memory, panel state machine,
  plan compile, note map, velocity law, roll export, normalisers; node-tested); `dr-seq.js` embeds identical copies of the constants it
  needs, compared by a test (the `seq-core.js` / `sx-seq.js` precedent).
- **Generic for 7b–7d**: `Dr808.create(inst, kind)` takes a machine descriptor (`'tr808'` now) so the TR-606 adds a descriptor that
  reuses the 808's blocks (RD §3 A3); `drum-core` keeps the 808's personality in one table `PERS.tr808` (modes, keys, scales, the
  variation / fill / track rules) so a 606 / 909 personality is a second table, not a fork.

### 1.2 Lanes, sounds and polyphony

| lane (pattern bit) | 0 AC | 1 BD | 2 SD | 3 LT | 4 MT | 5 HT | 6 RS | 7 CP | 8 CB | 9 CY | 10 OH | 11 CH |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sounds | accent (no sound) | bass drum | snare | low tom / **low conga** | mid tom / **mid conga** | hi tom / **hi conga** | rim shot / **claves** | hand clap / **maracas** | cowbell | cymbal | open hat | closed hat |

- **12 lanes, 16 sounds** [R RC §13]: the lane order is the INSTRUMENT / TRACK selector's (AC first). A pattern step is a 12-bit mask
  (bit = lane). The five alternates are **panel switches**, not pattern data: a lane's switch decides which of its two sounds a step
  plays, at playback [R RC §13]. Sound codes (drum-core `SOUNDS`): `bd sd lt mt ht rs cp cb cy oh ch lc mc hc cl ma`.
- **Polyphony = one voice per circuit** [R RC §2, Werner]: an analog voice circuit has one state; a new trigger while it rings
  **continues from that state** (no voice reset, no "machine-gun" effect). The machine has **12 circuits** (§2.2): BD, SD, the three
  tom / conga circuits and the rim shot / claves circuit (each **one circuit whose components the switch changes** [R RC §4–5]), CP and
  MA (**two circuits** sharing their lane's trigger and output [R RC §6]), CB, CY, OH, CH; plus the shared metal bank and noise source.
- **Paired sounds**: a step plays one of the pair (the switch). A **note** may name either sound of a pair (§4.1): it plays that sound
  for that hit whatever the switch says — for a tom / conga or rim / claves pair through the same circuit (that hit restrikes the
  shared resonators with the other components switched in), for clap / maracas through the pair's other circuit (the two may then
  ring together, as their separate circuits would) [C].
- **Choke**: a closed-hat trigger **discharges the open hat's envelope and holds it discharged while C63 keeps Q23 on** — C63 discharges
  through R173 with **τ ≈ 155 ms**; the hold lasts until that falls below Q23's turn-on, so it is longer for an accented CH (an
  open-hat hit inside it is cut too: the circuit does not know whether the open hat sounds) [R RC §9; the hold time is the model's,
  §15 #11]; no other chokes. A muted lane (§3.6) neither triggers nor chokes.
- **Hits in one chunk are order-free** [C]: `hit` / `trig` only **latch** a trigger for the chunk where they land; the chunk applies
  the latched triggers in **lane order** (CH's choke after OH's trigger), **one trigger per circuit per chunk** (the highest V wins:
  a step and a note, or two notes mapped to one sound, at one frame; both sounds of a one-circuit pair — tom / conga, RS / CL — in
  one chunk: the panel switch's sound; CP and MA are two circuits and may both fire). So
  a step mask and the same hits as notes — which reach the machine in the song's order, by tick then note number (song.js:112) — give
  the same bytes (D5; §15 #6).

### 1.3 The trigger bus and accent (Roland's architecture, RD §2.2)

- A hit is a **trigger voltage**, never a gain: the common trigger is a **1 ms** pulse [R RC §1] whose height is the accent bus:
  **V_N = 4.0 V** unaccented, **V_A = V_N + ACCENT · (14.0 − V_N)** accented (ACCENT knob 0…1, the 10 kΩ B pot; the spec's 0–10 dB)
  [R RC §1, service notes; Whittle's 5 V and Norgatronics' 5–15 V are the conflicting figures]. Every voice's amplitude follows the
  trigger's height and its nonlinear stages turn it into timbre [R RC §1]. The metal voices (CB, CY, OH, CH) see the buffered bus
  narrowed to **7–14 V** [R RC §1]: `V_m = 7 + (V − 4) · 0.7` [C: the linear map of the two ranges]. Everything downstream (pulse shapers, the BD's Q43, the
  swing-type VCAs) turns that voltage into timbre (§2).
- **Velocity → trigger voltage** (drum-core `vTrig(v127, acc)`, copied into dr-808.js; one law for roll notes, MIDI, the keyboard tray
  and the pads) [C]: `v127 ≥ 100` → `V = V_N + (v127 − 100) / 27 · (V_A − V_N)` (100 = an unaccented step, 127 = an accented one at the
  current ACCENT knob); `v127 < 100` → `V = V_N · (0.6 + 0.4 · (v127 − 1) / 99)` (ghost hits down to 2.4 V; whether a voice still fires
  that low is the circuit's business, e.g. the hats' ≈ 4.5 V gate threshold [R? RC §9, Whittle]). The sequencer sends V_N or V_A exactly, and
  "→ Piano roll" writes 100 / 127, so D5 holds. Above 100 the law is computed as `(1 − u) · V_N + u · V_A`, `u = (v127 − 100) / 27`
  — exact at both ends; the machine applies it with its own ACCENT knob for notes and steps alike (one source for V_A).

### 1.4 Notes into hits

`Inst.noteOn(n, v, ch, ext, aud)` for kind 'drums': `s = map[n]` (the device's note map, carried in the drum `{t: 'seq'}` payload
as `s.map`, a 128-entry sound index, −1 = none; `DEFAULT_MAP` until one arrives — a render farm or a cost probe never sends one) →
`dm.hit(s, round(v · 127))` latched at the event's frame (§1.2; the machine turns the velocity into V by §1.3's law); unmapped notes
and notes on a muted sound (`s.mute`, the effective mute / solo mask) do nothing. `noteOff` does
nothing to the sound (one-shots) but the Track's held-note bookkeeping runs as for any Inst. `sus`, `bend`, `wheel`, `at`, MPE
channels are stored and ignored. An audition (`aud`) plays like a note. The map is applied **in the worklet**, so the song, live keys,
MIDI in, the bottom keyboard tray and the pads all reach the drums through one path (D5, I2 of 1i).

## 2. The voices (`dr-808.js`, lane V)

### 2.1 Shared blocks and the render path

- **Render** (Inst kind 'drums', `renderSpan(n)`): `dm.render(buf, n · OS, T.spanF)` adds every live circuit into the Inst's mono OS-rate
  `buf` (as the classic path); the Inst's existing decimator chain (`decChain(OS)`) → `monoBuf`; then `dm.post(Lb, Rb, mono, n)`:
  the sample lanes at the base rate (§5, stereo when a sample is), MASTER VOLUME, the output stage (RC §12: the mix amplifier's
  high-pass and level), `Lb` / `Rb` (dual mono when no stereo sample sounds). Then the track's FX panel and OUT as for any classic.
- **Blocks** (each a small class in dr-808.js, Float64, preallocated, state in fields; every filter from its analog prototype by the
  bilinear transform **prewarped at the block's characteristic frequency** [C: so OS 4 → 2 → 1 (the CPU safeguard) keeps every
  centre frequency; Werner rendered at 4× without prewarp, RC §7], TDF-II or TPT (the lane's choice, stated in §14) with coefficients
  recomputed per control chunk (`CH = 4 · OS` samples) and **per sample while a coefficient sweeps fast** (the BD attack). The blocks
  whose coefficients move **every sample** (the BD's R_eff — the attack and the sigh's leakage law —, the toms' diode pair) use the
  plain bilinear `K = 2 · fs` instead of a per-sample `tan`: their frequencies stay ≤ 500 Hz, where the warp is < 0.1 % even at
  OS 1 (44.1 kHz) [C; §15 #23]:
  - `Trig` — a lane's 1 ms pulse of height V (4-frame-grid timing like every event) [R RC §1];
  - `Shaper` — the BD pulse shaper (passive low shelf + one-diode clamp of the falling edge, ≈ −0.71 V) [R RC §2];
  - `BridgedT` — the bridged-T band-pass in an op-amp loop with up to three inputs (shaped pulse, feedback buffer, retrigger pulse),
    time-varying R_eff, a unit delay breaking the delay-free loop [R RC §2]; the snare, toms / congas, rim / claves and the clap's
    band-pass use the same block with their own component values (the toms' with the diode pair in the shunt leg) [R RC §3–6];
  - `Metal` — the six Schmitt-trigger square oscillators (5 V, duty **47.98 %**) [R RC §7] with **polyBLEP edges** [C: Werner used
    naive edges at 4×; polyBLEP keeps OS 2 clean for ≈ 20 % more bank cost], summed by the passive network into the two band-passes
    (≈ **3440 Hz**, ≈ **7100 Hz**) [R RC §7]; **runs only while a metal voice is live**; each oscillator's phase is a **function of
    the absolute OS-sample index** `n = spanF · OS + i` (`ph = frac(n · f / fs)`, the edges for polyBLEP from it), never an
    accumulated sum, so a bank that slept or an Inst that idle-skipped wakes with **exactly** the phases a never-sleeping bank has
    (an accumulated phase and an analytic jump would differ in rounding; §15 #16) and behaves as the free-running hardware;
  - `SwingVCA` — Werner's memoryless swing-type VCA (the common-emitter estimate, the lower-edge fit, the soft clip, α 3.5) [R RC §8];
  - `EG` — switched first-order envelopes (attack follows the input less a diode drop, release `dV/dt = −V / RC`), forward Euler at
    the OS rate [R RC §8];
  - `Noise` — one white source per machine (xorshift32, density `nzW = sqrt(fs / 192000)` as engine.js:1599, so the noise level is the
    same at every OS) [C: the engine's convention]; level **130 mV rms** at the source [R RC §11], taken as the 0–20 kHz band [C]: a
    density of 0.13 V / √20 kHz, i.e. σ = 0.13 · √(fs / 40 000) V per sample; **WN** feeds the snare, the clap and the maracas, **PN** =
    WN through the 2nd-order low-pass at ≈ 273 Hz, Q ≈ 0.74 feeds the three toms [R RC §11]; one source for the machine, as the hardware;
  - `Mixer` — per-lane LEVEL pots (100 kΩ A; CB 5 kΩ A) into the summing bus through the circuit's mix resistors (BD 22 kΩ; SD, toms,
    RS/CL, CP/MA 33 kΩ; CB, CY, CH 47 kΩ; OH 56 kΩ, against 33 kΩ feedback), MASTER VOLUME (50 kΩ A), the × 1.5 output stage [R RC §12].
- **Span invariance** (D5): the machine does all its control-rate work — knob smoothing, coefficient updates, envelopes stepped per
  chunk, sleep checks — per **absolute 4-base-frame chunk** (spans start on 4-frame boundaries and are multiples of 4, so a chunk
  never straddles a span: `Track.process` cuts at `max(4, ceil(d / 4) · 4)` inside 128-frame quanta, engine.js:3740), never per span
  (unlike the classic `smStep`); a hit is latched at the chunk where its event fires (§1.2). So the same hits render the same bytes
  whatever splits the spans (a sequencer step with no hit, a song note or note-off, a quantum edge) [C].
- **Denormals**: every feedback state is flushed below 1e-30 at the chunk (the Serum scripts' rule) [C]; a circuit whose state and
  envelope are below 1e-7 (−140 dB) for 4 chunks is **asleep** and costs nothing until its next trigger [C].
- **Seeds**: the noise seed `0x2545F491 ^ salt` [C]; reset by `restore` and by `setSalt`.

### 2.2 The circuits

| circuit | topology (RC section) | the numbers | knobs (§2.3) |
|---|---|---|---|
| **BD** | trigger AND → pulse shaper → bridged-T in a µPC4558 loop with the feedback buffer (high shelf, DECAY) and the retrigger pulse; Q43 shorts part of the network after the trigger (attack: centre and Q up > 1 octave); leakage into Q43's base = the slow pitch sigh; tone LPF → level → output HPF (RC §2) | centre ≈ **49.5 Hz** from the components, the table's **56 Hz** [R] (the table's figure is the early, sighing pitch: §12.1 checks it over 10–40 ms); attack: Q43 held on **≈ 4–7 ms** (the notes ≈ 4, Werner ≈ 6, a replica 6.2) — the time C38's discharge through R156 (**τ = 1 MΩ · 0.1 µF = 100 ms**, not 4 ms) takes to fall below Q43's turn-on after the 1 ms charge: the network decides [R; §15 #9]; Q43 leakage fit **α 14.3150, V0 0.5560, m 1.4765e-5** [R]; the sigh ≈ 57 → 50 Hz over 0.3 s [R]; decay **50 / 300 / 800 ms** (knob short / mid / long) [R]; 3.5 / 10 Vp-p [R] | LEVEL (100 k A), TONE (10 k C), DECAY (500 k B) |
| **SD** | two bridged-T resonators kicked by the gated trigger (≈ 0.7 % and 2.6 % of it); TONE cross-fades their outputs; white noise → a swing-type VCA whose envelope (Q47, the C51–C53 ladder) SNAPPY scales → Sallen-Key HPF → the summing amp (RC §3) | **≈ 173 / 336 Hz** (the schematic's production values [R]; the printed 250 / 499 and the table's 238 / 476 recorded, RC §3) [C: which revision] — the table belongs to the printed revision, so the service-table check uses a measured later unit, **177 / 340 Hz** [R? S NG] (§12.1); HPF **≈ 2.75 kHz, Q 0.73** [R]; decay (mid) **60 ms** [R]; the low peak clips above ≈ 8.3 V of trigger [R] | LEVEL (100 k A), TONE (100 k B), SNAPPY (10 k B) |
| **LT/LC, MT/MC, HT/HC** | a multi-feedback bridged-T with an **anti-parallel diode pair** in its shunt leg (the pitch falls as the ring decays); the switch adds capacitance (TOM ≈ an octave lower), lowers the drive ≈ 3.6 × (TOM) and enables the PN "reverb" gate (TOM; τ ≈ 86 ms, slightly longer than the body) (RC §4) | TUNING low / mid / high: **LT 80 / 90 / 100, MT 120 / 135 / 160, HT 165 / 185 / 220, LC 165 / 185 / 220, MC 250 / 280 / 310, HC 370 / 400 / 455 Hz**; decay **200 / 130 / 100 / 180 / 100 / 80 ms** [R]; no decay pot on the stock unit [R] | LEVEL (100 k A), TUNING (500 Ω B), TOM / CONGA |
| **RS/CL** | two bridged-T generators (≈ 452 Hz; ≈ 2.5 kHz, ≈ 1.8 kHz with RIM SHOT's extra capacitor); CLAVES adds positive feedback (higher Q, longer ring) and drops the first; a swing-type VCA (≈ 5 ms envelope) → 2nd-order HPF ≈ 590 Hz, Q 2.9; muted outside the trigger (RC §5) | RS **455 + 1667 Hz**, CL **2500 Hz** (table) [R]; decay RS **10 ms**, CL **25 ms** [R] | LEVEL (100 k A), RS / CL |
| **CP** | WN → bridged-T band-pass ≈ 1.1 kHz → two VCAs: the sawtooth envelope (≈ 30 ms gate, three ≈ 10 ms saws, a final ≈ 20 ms discharge, exponential) and the ≈ 100 ms "reverb" decay; accent also into the offset network (RC §6) | decay (mid) **100 ms** [R]; the saw timing from the comparator network's RC values, fitted where untraced [R?] | LEVEL (100 k A), CP / MA |
| **MA** | WN → a gate → 2nd-order Sallen-Key HPF ≈ 10.6 kHz → a ≈ 15 ms-release envelope (RC §6) | decay **25 / 35 ms**; 3 / 5 Vp-p [R] | (CP's LEVEL) |
| **CB** | oscillators **#5 (800 Hz)** and **#6 (540 Hz)** → two swing-type VCAs on **one** envelope (a fast droop to ≈ 1/3 in ≈ 10 ms, then a ≈ 150 ms tail) → a multiple-feedback band-pass **≈ 860 Hz, Q ≈ 6** (RC §10) | trim ranges 359.4–1149.9 / 254.3–627.2 Hz [R]; decay (mid) **50 ms**; 3.5 / 12 Vp-p [R] | LEVEL (5 k A) |
| **CY** | all six oscillators → both band-passes → attack smoother (V − **0.7258**, τ **1.0244e-4 s**) → 3 EGs (Von **0.5899**, follower VBE **0.6195**; only the 3440 Hz band's EG follows DECAY) → 3 swing-type VCAs (Q18 on 3440 Hz, Q16 / Q17 on 7100 Hz) → 3 high-passes (≈ 2.5 kHz; two near 9–10.5 kHz, resonant) → the 5th-order tone network → level / output buffer (+6 dB/oct in band) (RC §8) | oscillators 205.3, 369.6, 304.4, 522.7, 800, 540 Hz, duty 47.98 % [R]; band-passes 3440 / 7100 Hz [R]; decay **350 / 800 / 1200 ms**, DECAY τ 0.47–2.47 s [R]; bus 7–14 V [R] | LEVEL (100 k A), TONE (20 k B), DECAY (2 M B) |
| **OH** | the 7100 Hz band → swing-type VCA → Sallen-Key HPF **≈ 7.8 kHz, Q 2.5** → buffer; envelope with DECAY (RC §9) | decay **90 / 450 / 600 ms** [R]; held discharged by a CH hit while C63 (τ ≈ 155 ms through R173) keeps Q23 on — the hold time is the model's [R; §15 #11] | LEVEL (100 k A), DECAY (2 M B) |
| **CH** | the 7100 Hz band → its VCA → HPF **≈ 11.7 kHz, Q 2.5**; fixed decay; its trigger charges the choke hold (RC §9) | decay **≈ 50 ms**; 3 / 6 Vp-p [R] | LEVEL (100 k A) |
| **mix** | 11 LEVEL pots → the mix resistors → the summing amp → MASTER VOLUME → × 1.5 → the output (RC §12) | master out **6 Vp-p** (HI) [R] | ACCENT (10 k B), MASTER VOLUME (50 k A) |

Ranges in the "numbers" column are the service table's knob short / mid / long (or TUNING low / mid / high) typical values. Lane V
**re-reads every component value it uses** from a high-resolution scan (RC §14: the values in RC are one careful reading) and records
the final table per voice in RC with designators and sources; where a value cannot be read it fits that one component to the table
and tags it **[fit]**. Two targets per voice (RC §14): the model equals **its own analog prototype** (frequencies ± 1 %, time
constants ± 2 %) and lands near **the service table** (frequencies ± 8 %, decays ± 25 %: ± 20 % capacitors, "typical" values) —
with two stated exceptions, because the chosen components cannot meet ± 8 % of the table: the BD (49.5 Hz settled vs 56 Hz: the
table is checked against the sigh's early pitch) and the SD (production values vs the printed revision's table: checked against
NG's measured later unit) (§12.1; §15 #10). Every
circuit is the analog topology with component values — never an envelope-on-oscillator stand-in — so accent, retriggering and the
knobs behave as the circuit does.

### 2.3 Knobs → circuit (`models.js` `tr808`, lane E with lane V's names)

28 controls: 23 knobs, all dials 0–10 like the TB-303's (`K(id, label, 0, 10, def)`), and 5 switches (`S`): **`ac`** ACCENT; **`bdl bdt bdd`**
BD level / tone / decay; **`sdl sdt sds`** SD level / tone / snappy; **`ltl ltt`**, **`mtl mtt`**, **`htl htt`** level / tuning;
**`lts mts hts`** the tom / conga switches (`['Tom', 'Conga']`); **`rsl`**, **`rss`** (`['Rim Shot', 'Claves']`); **`cpl`**, **`cps`**
(`['Hand Clap', 'Maracas']`); **`cbl`**; **`cyl cyt cyd`**; **`ohl ohd`**; **`chl`**; **`vol`** MASTER VOLUME. TEMPO / FINE and every
sequencer control are not models.js controls (they are sequencer state, §3.2). `map` emits a **flat** `p.drum` keyed by the
models.js ids — every knob's position 0…1 (`p.drum.bdd = v.bdd / 10`, …, `p.drum.ac`, `p.drum.vol`) and every switch's index
(`p.drum.lts` …) — and nothing else: no nesting, no tapers, no map / mute / samples (those ride the drum `seq` payload, §3.5).
Flat because the classic modulation adapter addresses a **one-level** field path: `Inst.moRec` splits `drum.bdd` into `p.drum` and
`bdd` at the first dot only (engine.js:1713–1715), so a nested `drum.bd.dc` would return null and a cable on an 808 knob would
silently do nothing — and `classic-mod.test`'s own probe walks any depth (tests/classic-mod.test.mjs:77), so no test would notice
(§15 #1). `cv-mods.FIELD_CLASS` gains `drum.<id>`: the 23 knobs **proc**, the 5 switches **struct** (`classTable()` throws on a patch
field it does not know, cv-mods.js:123). MASTER VOLUME lives in `p.drum.vol`, never in `level` (FIELD_CLASS `level` is an **sm**
slot on every engine, which the drums branch does not read). `dr-808` holds the pot table by id (value, taper) and turns a position
into the pot's resistance (`VRk = VR · taper(k)`) and the circuit's coefficients — one place, testable [C]. Pots and tapers as the parts
list gives them (§2.2's last column: A = audio, B = linear, C = reverse audio) [R RC §2–12]. Defaults: every LEVEL **7**, TONE / DECAY / SNAPPY / TUNING **5**, ACCENT **5**, MASTER
**7.5**, switches on the first sound [C]; the panel's red "standard" mark of the LEVEL knobs sits at ≈ 2 o'clock [R RC §13] — drawn,
not a default.

### 2.4 Rates and oversampling

- The Inst's OS is **the app's oversampling, as for every classic** — there is no per-model default: a classic node runs at
  `osFor(sr)` = `settings.os` (default **4**) capped at 384 kHz (main.js:89, 690, 734) and follows `{t: 'os'}` (engine.js:2222);
  4 matches Werner's cymbal rendering (RC §8); the CPU safeguard may drop it a step, session-only, with the "OS 4→2" badge; at 8× the
  machine costs ≈ 2× its rows (§15 #22). All circuits run at `fs = base · OS`; sample lanes at the base rate (§5).
- 44.1 kHz and 48 kHz contexts are both first-class: every time constant and frequency is computed from `fs` (tests at both, §12.1).

### 2.5 Level, presets and labels

- **Calibration** [C]: one constant `OUT_K` (volts at the output amplifier → full scale) set by lane V so that the BD at the default
  knobs, unaccented, peaks at the level of the TB-303's default note at its default volume (measured in the same harness: ±1 dB);
  pinned by the frozen refs. The output limiter of the track (`outStage`, −1 dBFS) catches accented stacks.
- **Presets** (knob settings only; patterns are separate, §3.1): `Init` (the defaults) and three of ours [C]: `Long Boom` (BD decay
  10, tone 2), `Tight` (short decays, SD snappy 7), `Bright Metal` (CY tone 8, OH decay 6). The ⋯ menu's Save / Delete / Init sound
  and the chip's ◀ ▶ work as for every classic.
- **Labels** (D4): the model's `about` says "Our circuit-level model of the TR-808's voice circuits — no recordings of any machine";
  the extras caption adds "Sounds: our model of the circuits" (§7.5); the tile's tip says the same.

### 2.6 CPU: rules and bench rows

- Idle costs nothing: asleep circuits are skipped; the metal bank runs only while CB / CY / OH / CH are live; a machine with every
  circuit asleep, no sample sounding and the output stage settled is **idle** (the Inst's 2 s idle skip then applies as for a classic).
- Measured ballpark (RD §1.3, a plain-JS spike at OS 4 on the M4 Max, every voice ringing continuously) [R]: a BD-class chain 0.003,
  the cymbal chain 0.015, a whole machine ringing 0.06–0.10.
- **Per circuit** (one circuit ringing continuously, OS 4, the M4 Max, node) [C]: BD, SD, each tom / conga, RS/CL, CP, MA ≤ **0.004**;
  the metal bank alone ≤ **0.008**; CB, OH, CH ≤ **0.006** each on top of the bank; CY ≤ **0.012** on top of the bank. Measured by
  `dr-808.test`'s cost probe and recorded in §14 (informational: the gates are the rows below). Note: these ceilings summed over
  the circuits d8p keeps awake (BD, SD, CP, two toms, CB, OH, CH + the bank ≈ 0.046) exceed d8p's 0.020 — with §2.1's −140 dB sleep
  rule most of them never sleep at 120 BPM — so d8p needs the circuits near RD §1.3's measured spike (≈ 0.002–0.003 a resonator),
  not at the ceilings (§15 #20).
- **Per machine** — bench rows [C] (`jsc` = the macOS JSC shell, the lead's IMPL-2b §9 method; the iPad's targets equal the Mac's: the
  user's iPad Pro has measured at 0.7–1.0 × the node rows, `ipad2b`):

| row (kind `track`, OS 4, 48 kHz, every timed run audible: retriggered) | node | jsc | ipad | what |
|---|---|---|---|---|
| **d8p** | 0.020 | 0.020 | 0.020 | a typical pattern: BD on quarters, SD on 2 / 4, CH eighths, OH on the off-beats, CP, two toms, CB, accent every 4th step, 120 BPM, the sequencer running (the whole track) |
| **d8x** | 0.10 | 0.10 | 0.10 | every lane triggered every 250 ms, accented, every DECAY at 10 (the worst case) |
| **d8m** | 0.035 | 0.035 | 0.035 | CY + OH + CB ringing (the metal bank and three VCAs: the diagnostic row) |
| **d8i** | 0.0005 | 0.0005 | 0.001 | the machine powered, synced, the transport stopped, nothing sounding (minus an empty track; on the iPad informational, the 1 ms timer) — **not a `scenarios()` row** (below) |
| **d8s** | 0.012 | 0.012 | 0.012 | d8p with all 16 sounds as user samples (§5; the bench's own 1 s fixture) |

`bench.json` `targets` get the rows as `{ node, ipad }` (the only keys `bench.test` compares, tests/bench.test.mjs:83; every scenario
needs `ipad ≤ 0.6`, line 23): the **jsc** column is the lead's A/B gate (IMPL-2b §9), not a stored target. **d8i** cannot be a
`scenarios()` row: every timed scenario must be audible (`measure` throws on a silent run, tests/bench-scenarios.mjs:403; bench.test
asserts a peak, line 22), so it is measured as row **p** is (tests/bench.test.mjs:91–106: an idle machine past the 2 s quiet window,
`cpu-gate.gateLoad` against `targets.d8i.node`, in `tests/engine-track.test.mjs`), its iPad number informational (§15 #4). `cv-cost.js` `COST.synth.tr808 = C('d8p', 'drums',
1, base, voice)` with lane E's measured d8p (base) and a per-hit term (voice) [C]; `bench.html`'s `CLASSIC` list adds `c7` (the 808 at
the default pattern, `ipad: null`). JSC: the shell method of IMPL-2b §9 on d8p / d8x and, because `Inst` changed, on c1, d, e, mc0, mt
(≤ 3 %). V8: every existing row within 2 % (`cpu-gate`). iPad: §12.8.

## 3. The sequencer (the 808's personality)

### 3.1 Memory (`dev.drum`, normalised by `drum-core.normDrum`)

- **32 patterns** [R RC §13]: 16 pattern keys (1–12 **BASIC RHYTHM**, 13–16 **INTRO / FILL IN** 1–4) × variation **A / B**. Pattern
  `p = key · 2 + var`: `st[p]` = 32 step masks (12 bits each; steps 0–15 the **1st part**, 16–31 the **2nd part**).
- Per **key** (A and B always share them [R]): `pre` (PRE-SCALE 1–4), `l1` (1st part's last step, 1–16), `l2` (2nd part's, 0 = no 2nd
  part, 1–16). Cleared: `l1 16, l2 0` [R]; `pre 3` [C: the cleared default].
- **Rhythm tracks** [R RC §13]: one 768-measure store `rt` (12 tracks × 64 measures; a composition overflowing its 64 measures
  continues into the next track's region, as the original), each entry a pattern key 0–15 or −1; `rtEnd[12]` = each track's last
  measure (absolute index, −1 = empty). What a measure plays (A / B / AB) is the variation switch **at playback**, not stored [R].
- **PRE-SCALE** = steps per beat [R RC §13]: **1 → 3** (eighth triplets), **2 → 6** (sixteenth triplets), **3 → 4** (sixteenths), **4 → 8**
  (thirty-seconds) — **step ticks 320 / 160 / 240 / 120** at the song's 960 PPQ (exact integers) [C: the tick mapping].

### 3.2 Panel state (`dev.drum.ui`, saved) and session state

- Saved: `mode` (the MODE rotary, 6 positions [R]: 0 PATTERN CLEAR, 1 PATTERN WRITE 1st PART, 2 2nd PART, 3 MANUAL PLAY, 4 PLAY
  (rhythm track), 5 COMPOSE (rhythm track)); `inst` (the INSTRUMENT / TRACK rotary, 12 positions: AC … CH, also tracks 1–12) [R];
  `fill` (AUTO FILL IN: MANUAL, 16, 12, 8, 4, 2) [R]; `bvar` (BASIC VARIATION A / AB / B) [R]; `ifv` (I/F VARIATION A / B) [R]; `pre`
  (the PRE-SCALE selector 1–4) [R]; `sel` (the selected basic key 0–11), `ifk` (the selected I/F key 0–3); `intro` (armed: TAP at
  stop in MANUAL PLAY) [R]; `tempo` (40–300 BPM [R], 40 click stops [R] on a log scale [C: 39 steps of (300 / 40)^(1/39) ≈ **5.3 %**
  a click]), `fine` (± half a click [C]).
- Extras (`dev.drum.x`, saved, neutral defaults): `sync` (**on** for a new machine [C, question 1]), `swing` (50 %, off), `mute` /
  `solo` (12-bit masks, 0), `rec` (off), `part` (the grid's shown part).
- Session only (never saved, as the 303's `seqRun`): running (free mode), the pending key, the TAP-fill request, the clear-undo copy.

### 3.3 The behaviours (drum-core `press(state, mem, input) → { state, mem, cmds }`, a pure state machine)

The original's rules [R RC §13] and the gaps filled [C] (each row a test, §12.3):

| input | behaviour |
|---|---|
| **START/STOP** (synced, §3.5) | the project's play / stop (the top tray's ▶): one clock [C, question 1]; the machine's position follows the song — a play from the song's start is step 1 / measure 1, a play from bar 9 lands where the machine would be had it started at bar 1 (so a seek or a loop never shifts the drums against the other tracks) [C]. Free (SYNC off): runs / stops the machine at its TEMPO, always from step 1 of the pattern or measure 1 of the rhythm track [R]. At stop the step LEDs return to the flashing selected key [R] |
| **step key, MANUAL PLAY** | keys 1–12 select the basic rhythm; 13–16 the I/F key. Running: the new basic key **takes effect at the next measure** [R]; pressed during beat 1 of a measure it starts **at beat 2 of the current measure** (the original's quirk) [R]. One pending selection (the last pressed) [R]; no two-key chaining (the original has none: chaining is the rhythm track, AB and fills [R]) |
| **step key, PATTERN WRITE 1st / 2nd** | stopped: selects the pattern key (flashing LED) [R? IO; RC §14]; running: toggles the selected instrument's bit at that step of the current part (key 16 in the 2nd part = step 32) [R] |
| **TAP, write modes, running** | writes the selected instrument (AC included) at the **nearest step** of the current part at the heard time [C: the TR-08's rule, the original is silent, RC §14]; one sound per tap [R] |
| **TAP, MANUAL PLAY** | stopped: toggles the **intro** (the I/F key flashes; START plays the intro once, then the basic rhythm) [R]; running: requests **one fill** at the next measure [R] (and on top of auto fill [R]) |
| **CLEAR, PATTERN CLEAR mode** | clears the selected key's pattern per BASIC VARIATION (A, B, or both for AB), lengths to 16 / 0 [R]; the original has no undo; ours: a notice "Pattern 3 A cleared · tap to undo" (a one-level session copy) [C] |
| **CLEAR, write modes, running** | latches PRE-SCALE for the key [R]; **CLEAR held + step key N** sets the current part's last step to N (2nd part: N = 16 → 32) [R]; setting the 1st part does not touch `l2` [C: M is silent, RC §14] |
| **CLEAR, COMPOSE, stopped** | TRACK CLEAR of the selected track (the notice + undo as above) [R]/[C] |
| **COMPOSE, running** | records, at each measure start, the key in effect into `rt` from the track's start; pattern keys pressed take effect (and are recorded) at the next measure [R]; STOP marks the measure it lands in as the last [R]; without a TRACK CLEAR first it **edits**: replaces measures, the length unchanged [R]; I/F keys write a fill into a measure [R]. Synced, the measure index is the song's (play from the song's start to compose from measure 1; a play from later records from there and leaves the earlier measures as they were) [C] |
| **PLAY** | plays the selected track from measure 1 with the variation switches, **loops** at its end [R] |
| **BASIC VARIATION** | A or B loops that one; **AB alternates A, B, …, always starting on A** (after an intro: intro, A, B) [R]; a change applies at the next measure [R]; the AB phase counts basic measures since START or the last key, variation or AUTO FILL IN change (each a re-anchor, §3.5), fills and the intro excluded [C] |
| **AUTO FILL IN** | MANUAL: fills only by TAP; N: the selected fill **replaces every N-th measure** (the intro not counted) [R]/[C: "replaces the N-th" is our reading of "plays once every N"]; back to MANUAL cancels [R] |
| **INSTRUMENT / TRACK** | the instrument written by step keys and TAP; the track for PLAY / COMPOSE [R] |
| **PRE-SCALE** | the scale of the next CLEAR-latched pattern (write modes) [R]; patterns keep their own |
| **TEMPO / FINE** | free: the machine's tempo. Synced: the knobs **show and set the project tempo** (one gesture = one tempo edit, as the tempo box) [C, question 1] |

**Inputs the table did not cover** (review §15 #25; each a test of §12.3; lane S may refine one with a reason in §14) [C]:
- **Which part plays while writing**: the whole measure (1st part, then the 2nd when `l2 > 0`), as it will play; the step keys and
  LEDs address the MODE's part, its playhead shown only while that part runs (with `l2 = 0`, 2nd PART mode plays the 1st part until
  CLEAR + N gives the 2nd part a length).
- **MODE while running**: the panel's rules change at once; the plan swaps at the next measure (`at: 'bar'`); WRITE 1st ↔ 2nd PART
  keeps the pattern running (the hardware's write-the-1st-then-the-2nd workflow).
- **INSTRUMENT / TRACK while running in PLAY / COMPOSE**: the next track starts at the next measure, from its measure 1.
- **AB in PLAY**: the AB phase counts the track's basic measures from its measure 1 (a key change does not reset it there: with the
  MANUAL PLAY rule a track that changes key every measure would never play a B).
- **AUTO FILL IN in PLAY**: ignored (the track's own fills play). **TAP in PLAY**: one fill at the next measure, as in MANUAL PLAY;
  **in COMPOSE**: that fill, recorded into the measure it plays in.
- **CLEAR in a write mode, running**: PRE-SCALE latches on CLEAR's **release** when no step key was pressed while it was held (CLEAR
  + N only sets the length).
- Everything else not in the table (START in PATTERN CLEAR, step keys in PLAY or PATTERN CLEAR, TAP in PATTERN CLEAR …) does
  nothing.

LEDs [R RC §13]: the 16 step LEDs show, running in a write mode, the selected instrument's steps of the current part with the playhead
**inverted**; in MANUAL PLAY / PLAY / COMPOSE the playing key (steady) and a pending one (flashing); stopped, the selected key
flashing. The **1st / 2nd PART** LEDs show the running part; the two **variation** LEDs above START/STOP show which variation plays
(running) or plays first (stopped) [R].

### 3.4 The plan (drum-core `compilePlan(mem, ui, x) → plan`, pure)

What the machine plays is compiled on the main thread into an explicit, cyclic list of **measures** (a measure = one pattern: its
1st part then its 2nd part [R]): `plan = { key: string, n, intro: 0 | 1, loopFrom, mKey: Int8Array(n), mVar: Int8Array(n), mPre: Uint8Array(n),
mOff: Int32Array(n + 1) (step offsets), st: Uint16Array(total steps), fill: { pre, l1, l2, st: Uint16Array } | null }` — MANUAL
PLAY: [intro?] + one cycle of **`AB ? 2N : N`** measures with the auto fills in place (N = AUTO FILL IN's interval; MANUAL: N = 1
with no fill, i.e. `AB ? 2 : 1`). N is even, so a fill cycle holds N − 1 basic measures — an odd number — and with §3.3's rule (the
AB phase counts basic measures, fills excluded) AB returns to A only after two fill cycles: the earlier `lcm(AB ? 2 : 1, N)` would
play A B A F **A** B A F for AB with fills every 4, against the rule's A B A F **B** A B F (§15 #7); ≤ 32 measures + the intro.
PLAY: the track's measures (≤ 768); write modes: the selected key (A, B or A + B); COMPOSE: as MANUAL PLAY. `fill` = the selected
I/F key's pattern at the I/F VARIATION, for **TAP** fills: `DrSeq` plays it at the next measure boundary **instead of** the cycle's
next measure and then resumes the cycle where it was (the cycle index does not advance), so a TAP fill needs no plan swap and no
AB phase or fill count has to cross threads; the payload's `tap` counter requests one (§3.5; §15 #8). Steps carry the 12-bit mask
after **mute / solo** (§3.6) — so muting re-compiles, never branches in the worklet. ≤ 24 576 steps (48 KB) [C bound]. `plan.key` is
a content hash (FNV-1a over the arrays, as `seq-core` keys) so an unchanged plan is never re-posted.

### 3.5 The clock (`dr-seq.js` `DrSeq`, lane S; wired by lane E)

- **Payload** `{t:'seq', s, i?}` (the 303's message; `seqMsg` routes by the payload's shape, §1.1): `s = { plan, sync, run, bpm,
  swing, at: 'now' | 'bar' | 'beat2', tap, map, mute, smp }` — `tap` a counter (one TAP fill per increment, §3.4), `map` the 128-entry
  note → sound table (§4.1), `mute` the effective mute / solo mask of the 16 sounds (notes obey it; the plan's steps already do),
  `smp` the 16 slots `{ id, on }` or null (§5). `drumSend` posts it when any of them changes (`plan.key` + a key of the rest).
- **Sync** (`x.sync` on): the plan is anchored at **song tick 0** — the position of every step is a function of the song position, so a
  start at bar 9, a seek or a loop wrap lands where the machine would be had it started at bar 1 (`tp`, `tickAt`, 960 PPQ). A loop
  wrap calls no `transportHook` (engine.js:3598–3606 only re-seeks the song), so `DrSeq` re-anchors at tick 0 whenever the song
  position goes back (§15 #27). Stopped transport → silent. **Free** (`sync` off): the machine's own clock from its START, at `bpm`
  (tempo + fine), `pos` advanced by `Track.process` as the 303's (engine.js:3742).
- **Live changes**: a new plan with `at: 'now'` and the same **shape** (measure lengths and tick sizes; a step toggle) replaces the steps
  in place, position kept; any other change (`at: 'bar'`: a key, a variation, a fill knob, a length) swaps at the **next measure
  boundary B** and re-anchors there (the new plan's measure 0 starts at B; so a variation or AUTO FILL IN change restarts the AB
  phase on A and the fill count, as a key change does [C]); a stop, a seek or a fresh play re-anchors at tick 0 again
  (sync) or at START (free) [C]. The beat-2 quirk (§3.3) is `at: 'beat2'`: swap at the current measure's second beat, the new plan
  entered at its own beat-2 step.
- **Swing** (extras, 50–75 % [C: Linn's convention, RD §2.4]): the odd step of each pair starts **`round((2 · swing − 1) · stepTicks)`
  whole ticks** late, for PRE-SCALE 3 and 4 only (triplet scales are not swung) [C]; 50 % = off, bit-identical to no swing. Whole
  ticks because the roll's notes are whole ticks: "→ Piano roll" writes exactly these positions, so D5 holds at any swing (at 62 %
  on sixteenths the exact offset is 57.6 ticks; a sequencer on 57.6 and a note on 58 would sit 0.4 tick = 10 frames — two or three
  grid points — apart at 120 BPM / 48 kHz; the rounding moves a step by ≤ 0.26 ms there) (§15 #5).
- **Hits**: at each step's start, `dm.trig(mask)` (the AC bit selects V_A, from the machine's own ACCENT knob, else V_N; muted lanes
  are already out of the mask); the frame is on the Track's 4-frame event
  grid (`seqEvents` returns frames to the next step, ≥ 1, as the 303's). A step is due when `tickAt(F) ≥` its tick and the distance is
  `(tick − tickAt(F)) · fpt` — **the expressions `songEvents` uses for a note** (engine.js:3581), so a step and the same note fire at
  the same span start (D5).
- **Posts** `{t:'step', s, m, k, v, p, F, i?}` (step in measure, measure index in the plan, key, variation, part, **the frame**) at
  every step — ≤ 40 a second at 300 BPM in thirty-seconds; main shows a step at the **heard** time of `F` (audioclock), so the LEDs
  match what is heard on Bluetooth too [C]. COMPOSE recording reads the measure starts (`s === 0`).
- **Monitor** (`postMon`, only while subscribed): `{ lit: sounds hit since the last post (16-bit mask), act: Float32Array(12) circuit
  levels, F: the frame of the post }` for the pad lights and meters; main lights the pads at the **heard** time of `F`, as the step
  LEDs (a monitor post leads the sound by the output latency — ≈ 200 ms on Bluetooth — like an unshifted step post would; §15 #26).
- Power off / panic / `bye`: the sequencer stops with the Inst (`seqRelease` analogue: nothing held, nothing to release for one-shots).

### 3.6 Extras helpers (start neutral)

- **The step grid** (`dr:grid`): every lane × the current part's steps of the pattern being edited (write modes) or played (play
  modes), the playhead column; tap toggles a step (any mode: a modern helper; nothing changes unless used); the row headers are
  **mute** (tap) / **solo** (long-press) [C]; a 1st / 2nd part switch when `l2 > 0`. Drawn as **one canvas** + a hit layer (208 cells
  as DOM would cost ≈ 400 elements) at `wk.storeDensity` (milestone 3's H5 rule) [C].
- **SYNC** (`dr:sync`), **SWING** (`dr:swing`), **→ PIANO ROLL** (`dr:toRoll`, §4.3), **REC** (`dr:rec`: pad hits write their lane
  at the nearest step while a write mode runs; off by default), **MAP…** (`dr:map`, §4.1), **SOUNDS…** (`dr:sounds`, §5), **DEMO**
  (`dr:demo`: loads our own two example patterns into basic key 1 A / B and fill 1, after a confirm if they are not empty — written
  for this project, not transcribed from a record or a manual's example, D4) [C].
- **Pads** (`dr:pads`): 16 pads (4 × 4, one per sound) [C]; velocity from where the pad is touched — the 1i curve (`0.3 + 0.75 · f`,
  front edge loud; `cv-keys.js` `KEY_VEL`, which is main.js `velAt`'s curve); multi-touch; `data-gesture="music"` (two fingers are two hits, never a pinch; 1i §4.3);
  a press → `noteOn(map note, v, 0, ts)` (so recording, held keys and the Velocity module work as for keys); a pad lights on its own
  press and on every hit of its sound (the monitor's `lit`, at its heard time, §3.5).

## 4. Both ways: notes and the piano roll

### 4.1 The note map (`dev.drum.map`, configurable; drum-core `DEFAULT_MAP`)

GM-based [C, question 4's alternative is Roland's TR-8S map]: **bd 36** (+35), **rs 37**, **sd 38** (+40), **cp 39**, **lt 41** (+43),
**ch 42** (+44), **mt 45** (+47), **oh 46**, **ht 48** (+50), **cy 49** (+57), **cb 56**, **hc 62**, **mc 63**, **lc 64**, **ma 70**,
**cl 75**. Stored as sound → `[primary, …aliases]`; a note maps to at most one sound (`normDrum` drops later duplicates). **MAP…**
(extras) edits it: per sound a primary note (a picker, or "learn": the next played note) and aliases; Reset to default.

### 4.2 Roll rows (`roll.js`, lane H2)

For a drum track (`host.drumRows(track) → [{ n, name }] | null`): the gutter shows the **sound names** on the mapped rows ("Kick 36",
"Snare 38", "Closed hat 42" …: the primary of each sound) and dims unmapped rows; **compact drum rows** (on by default for a drum
track, a toolbar toggle "Drum rows") show only the mapped primaries, in the map's order (kick at the bottom), every other note in one
"other" row at the top [C, question 4]. The roll's row ↔ note conversions go through two methods (`n2y` / `y2n`, roll.js:109–110),
the direct `127 − …` row sites (197, 216, 930), the 128-row assumptions — the scroll clamp `128 * rowH` (`clampY`, 122), the keyboard
extent `n2y(127)` / `n2y(-1)` (1012, 1171) —, the note culls by note range `x.n < nLo || x.n > nHi` (1027, 1044: wrong in compact
mode, where the visible rows are not a note range), the row-drawing loops over `nLo…nHi` (1010–1016, 1173–1188, 1266), the
vertical-drag clamps in notes (300, 807 `127 − g.maxN`; the touch path `_rowsMoved`, 796 / 855; a compact drag moves by rows), the
keys column (768) and the `noteName` labels (1087, 1188, 1205–1214): the lane routes all of them through a row table (`this.rows`:
null = the piano; `rowOf(n)`, `noteAt(r)`, `label(n)`, `nRows`) so compact mode is a table, not a fork; a vertical note drag moves
between drum rows (§15 #18). Transpose on a drum track asks first ("changes
which drums play"). The velocity lane is unchanged (100 = normal, 127 = accent: two guide lines drawn).

### 4.3 → Piano roll (`drum-core.toNotes(plan, opts)`, one History step "Pattern to notes")

- Writes what the plan plays — the current mode's: the selected pattern (with AB, intro and fills as they would play), or the whole
  rhythm track — for **N bars** (a popover: 1, 2, 4, 8, 16, the track's length; default 4 [C]) from the playhead floored to a bar (the
  303's rule, main.js:3069). A hit becomes `{ t, d: 120, n: the sound's primary note, v: 100 | 127 }` (the lane's switch at the time
  picks the sound); positions are the sequencer's own whole-tick swung positions (§3.5), so nothing is rounded here [C].
- Then **SYNC is switched off and the machine stopped** (so the pattern is not heard twice), with the notice "Written to the piano
  roll · the 808's own sequencer is off so it isn't heard twice · tap to undo" (the undo restores both) [C, question 2]. **The
  project's ↶ restores both too**: `keepDevs` keeps a same-model device's `drum` on every undo (§6), which would leave SYNC off while
  the notes go — silence. So the History step "Pattern to notes" carries `meta: { drumSync: { track, dev, sync: true } }`, put back by
  `applyRestore` after `keepDevs` (the `modMoveBack` precedent, main.js:1305–1316 / 1333); redo turns it off again (§15 #12).

### 4.4 Playing notes, recording, bounce

- The track's notes reach the drums through `songEvents` → `Track.noteOn` → §1.4 (unchanged path). With SYNC on and notes in the roll,
  both play (they sum) [C, question 2].
- **D5**: for any plan at any swing, `toNotes` + the song path renders as the sequencer does — bit-identically where the step frames
  are whole numbers, on the same or the next 4-frame grid point elsewhere (both fire at the first span start at or after the same
  whole tick, the distance computed by the same expression `(tick − tickAt(F)) · fpt` from the same last span start — a note-off of
  `d: 120` lies ≥ 40 ticks (≥ 367 frames even at 300 BPM / 44.1 kHz) before the next hit, so it never adds a span start in the
  hit's quantum; the same V; order-free latching, §1.2; the machine is span-invariant, §2.1). Scope: an empty FX panel and no
  cables — a note also calls the panel's `rack.trigger()` / `lastNote` and ModCore (engine.js:2248–2261, 3431), a step does not
  (§15 #34). Gate §12.2.
- Recording: armed drum tracks record keys, pads and MIDI as notes (unchanged `recStart` / `recEnd`); the 808's own sequencer is never
  recorded as notes (→ Piano roll does that on request).
- Bounce: `bounceSet` treats a drum track whose machine is synced and has any step as audible with no notes (the 303's `syncedOf`,
  main.js:3608); `makeNode` passes `seq` for drums (main.js:929); offline = live (D7).

### 4.5 MIDI

- **In**: live MIDI notes reach a drum track as any track (`targets(src)`: selected / armed, or the track's channel) and play through
  the map; note-offs are ignored by the sound. A new drum track's channel stays **omni** [C].
- **Files**: `exportMIDI` writes a drum track on **channel 10** when its channel is omni (today's `AUTO_CH` skips 10, song.js:709);
  `importMidiFile` makes a channel-10 track a **TR-808 track** (its notes as they are; a notice counts notes on unmapped keys) [C].
- **Out**: the app has no hardware MIDI out (`midi.js` is input-only), so none here; the in-worklet track-to-track MIDI OUT (the Serum
  ARP's) for the 808's pattern is a later step [C].
- **Keyboard tray and computer keys**: play through the map (C1 = 36 = kick; the tray's Oct − reaches it); nothing else changes.

## 5. Your own sounds (sample slots)

- **One slot per sound** (16): `dev.drum.smp[sound] = { id: 'smp:<hash>', name, on }`; `on` plays the sample **instead of** that
  sound's circuit [C, the proposal's "load your own"]. SOUNDS… (extras): per sound "Circuit (ours) | Your sound", Load… (file picker),
  the name, ✕. A loaded slot shows a small dot on the pad and the grid row.
- **Import**: the existing sample importer (`smp.js` / `assets.js importFiles`: WAV 8–32-bit int / float and AIFF natively; FLAC,
  OGG, MP3, M4A via `decodeAudioData`), the existing store (`synth-canvas-smp`, content-hash ids, dedup), the existing worklet entries
  (`{t:'smp'}`, `SxBase.storeAsset`). The slots are **not** in the patch (it is a function of `vals` only, §1.1): `drumSend` calls
  `tables.ensure(ids, { trackId, node })` for the slots that are on before it posts the payload naming them (as `sendPatch` does
  for `patch.needs`, main.js:574–579), `makeNode` / `graphParts` add them to the node's needs, and the bounce adds them to its item's
  `needs` (main.js:2480). dr-808 reads `SxBase.getAsset(id)` lazily (null → the circuit plays, as if `on` were off).
- **Limits** [C]: ≤ **10 s** per slot (under `LIMITS` 60 s), mono or stereo (stereo plays stereo: the machine's only stereo source),
  entries built with **2 playback levels** (TUNING's ± 1 octave needs one level down; `maxLevels` as `ZONE_HEADROOM.touch` — ≈ 1.5×
  the level-0 bytes instead of ≈ 2×), ≤ **32 MiB** of worklet entries per machine on touch devices, 64 MiB elsewhere. That cap is
  the machine's **own** accounting in SOUNDS… (the importer's estimate, assets.js:1455: a 10 s stereo slot ≈ 7.7 MB at 8 levels,
  ≈ 5.8 MB at 2): `fits()` (assets.js:1326) checks only the project-wide worklet budget (128 / 192 MiB, assets.js:135) and refuses
  beyond that with its message (§15 #19).
- **What acts on a sample** [C]: LEVEL; the hit's voltage as gain (`g = V / V_N` below V_N, `1 + 0.6 · (V − V_N) / (14 − V_N)` above:
  +4 dB at full accent); TUNING (toms / congas) ± 1 octave over the knob, centre = as recorded (playback rate, the mip level by ratio);
  DECAY (BD, CY, OH) a fade-out whose time runs from 30 ms (0) to the whole sound (10, no fade); the CH → OH choke; mute / solo. TONE and
  SNAPPY do nothing to a sample (their tooltips say so while the slot is on).
- **Rendering**: at the base rate after the decimator (§2.1), linear interpolation on the entry's level for the playback ratio; one
  voice per sound, a new hit restarts it with a 2 ms fade of the old one [C].
- **Project files and gc**: `userSmps` / `assets.js states()` include every drum device's slots (so a Save embeds them as pcm24 and
  the store's gc keeps them); Save as classic project keeps the ids (main ignores them).

## 6. Project format

- **Device record** (`track.dev.iN`): `{ kind: 'synth', model: 'tr808', vals: {…§2.3…}, preset, drum: { v: 1, keys: [16 × { pre, l1, l2
  }], st: [32 × [32 masks]], rt: [768], rtEnd: [12], ui: {…§3.2…}, x: {…§3.2…}, map: {…§4.1…}, smp: {…§5…} } }` (≈ 10 KB as JSON).
- **`song.normDev`** keeps `drum` for a `tr808` device through `drum-core.normDrum` (exact lengths, masks 0–0xFFF, keys −1…15,
  `rtEnd` ≥ its track's start or −1, every `ui` / `x` field clamped to its range, map notes 0–127 unique, slot ids `/^smp:[0-9a-f]{16}$/`,
  names ≤ 64 chars; unknown fields dropped; idempotent; never throws). `History` snapshots carry it.
- **Undo** (keepDevs, main.js:1317): `drum` joins `seq` — **project undo never reverts the pattern memory** of a same-model device
  (the 303's policy: pattern edits are instrument tweaks), so an unrelated undo can never restore an old pattern [C, question 3]; the
  destructive operations (PATTERN CLEAR, TRACK CLEAR, DEMO, → Piano roll's sync change) get the one-tap undo notice (§3.3), and
  "Pattern to notes" also carries its SYNC in the History step's `meta` (§4.3).
- **A model switch away from tr808 deletes `drum`** from the device: `cv-model.setModel` changes a device in place (cv-model.js:302–
  309), so it would otherwise stay on the new model's device in memory and History while `normDev` drops it on the next load; the
  "Replaced TR-808 with …" undo brings it back with the History snapshot (§15 #28).
- **Schema 8** (`cv-migrate.SCHEMA = 8`, `STEPS[7]`: no change to stored data). A schema-7 build meeting a drum device would read
  `tr808` as a Minimoog (`modelById`'s fallback) and autosave the loss; with the bump it opens the project read-only (SPEC §5.8). If
  milestone 3 or 1i takes 8 first, 7a takes the next number (the lead names it at the merge).
- **The file mirror and Save as classic project**: a drum primary mirrors `model: 'tr808'`, `vals`, no `seq`; the live site (main)
  plays such a track with its Minimoog fallback. Save as classic project keeps drum tracks with their notes and lists them in its
  notice ("TR-808 tracks: the live site has no drum machine — their piano-roll notes are kept") [C].
- `splitTracks` and `single()` need no change (one instrument). The `seq` field is never written on a drum device.

## 7. The panel (`panels/tr808.js`, `cv-panel.js`, `cv-drum.js`; lanes P1 / P2)

### 7.1 The layout (P2: photo research → mm, as IMPL-panels' AUTHOR lanes)

- **508 × 305 mm** [R RC §13] (one area `main`), 2 px/mm → **1024 px** wide; height 610 px + the 40 px bar + the extras strip
  (≈ 370 px: the grid row 272 + the controls row 64 + padding and caption) → ≈ **1024 × 1024** px (± one dot until P2 pins it)
  [C est.].
- Content, left to right, top to bottom [R RC §13; P2 measures from photographs, ± 1.5 mm, sources in `notes`]: the **MODE** rotary
  (6 legends) at the extreme upper left, the red **CLEAR** key under it (legends PATTERN CLEAR / TRACK CLEAR / STEP NUMBER SET /
  PRE-SCALE SET), the **INSTRUMENT / TRACK** rotary (12 codes AC … CH, track numbers 1–12 on the outer ring), **AUTO FILL IN** (6
  legends), the large **TEMPO** knob (40 click stops) and **FINE**; the twelve **voice columns** (ACCENT; BD LEVEL / TONE / DECAY; SD
  LEVEL / TONE / SNAPPY; LT/LC, MT/MC, HT/HC LEVEL / TUNING + their switch; RS/CL LEVEL + switch; CP/MA LEVEL + switch; CB LEVEL; CY
  LEVEL / TONE / DECAY; OH LEVEL / DECAY; CH LEVEL), each with its name plate (the two-letter code highlighted), LEVEL knobs orange,
  the others pale [R? RC §13]; **MASTER VOLUME** large, beside the plain-type title; the bottom band: **BASIC VARIATION** A / AB / B
  with its two LEDs, **START/STOP**, **PRE-SCALE** (4 positions) with STEP NO and the **1st / 2nd PART** LEDs, the printed note-value
  staves above the **16 step keys** (red 1–4, orange 5–8, yellow 9–12, off-white 13–16 [R? RC §13]) each with its red LED, the 1–12
  BASIC RHYTHM / 1–4 INTRO / FILL IN legends, **I/F VARIATION** A / B, **TAP** (INTRO SET / FILL IN TRIGGER). The rear strip is not
  the top face: its jacks are drawn as a printed legend band along the top edge with ▲ marks, as the TB-303's (MASTER OUT, the 11
  MULTI OUT jacks, TRIGGER OUT × 3, PEDAL × 2, DIN SYNC) [R RC §13]; each MULTI OUT is also drawn as a small jack under its ▲ legend
  (the `inert: 'later'` control below) — the TB-303's WAVEFORM precedent, a rear control drawn under its printed legend so the panel
  stays complete without drawing the rear (panels/tb303.js:26, 157; §15 #24).
- Title in **plain type** "TR-808 · Rhythm Composer · Computer Controlled" (no script logotype, no maker name; the 303 precedent) [C].
- Inert (dimmed): the power switch, the rear legends' jacks; the **11 MULTI OUT jacks** are inert controls whose title reads
  "BD OUT — cable-able with full patching (stage 4)" (a new `inert: 'later'` form, §7.3) [C].

### 7.2 Tokens (`TOKENS.tr808`, `RENDERED_TOKENS`)

| token | kind | | token | kind |
|---|---|---|---|---|
| `dr:mode` | rotary (6) | | `dr:start` | button |
| `dr:inst` | rotary (12) | | `dr:tap` | button |
| `dr:fill` | rotary (6) | | `dr:clear` | button |
| `dr:tempo` | knob (40 detents) | | `dr:step` | button, **multi**, `n` 1–16 unique, led |
| `dr:fine` | knob | | `dr:part1`, `dr:part2`, `dr:varA`, `dr:varB` | led |
| `dr:bvar` | switch (3) | | `dr:pre` | switch (4) or rotary (4) as the photos show [R? RC §14] |
| `dr:ifv` | switch (2) | | extras: `dr:grid dr:pads dr:sync dr:swing dr:toRoll dr:rec dr:map dr:sounds dr:demo` | |

`liveWidget` / `showWidget` dispatch `dr:` to `cv-drum.js` (`drumWidget(c, o, api.drum)`, like `seqWidget` for `seq:`); the switch
token allows 3–4 positions where today's `switch` allows 2–4 (unchanged rule); `cellW` / `cellH` gain the extras sizes (grid
**640 × 272**, pads **232 × 232**, the small controls 72–128 × 64) [C].

### 7.3 Validator and geometry additions (`cv-panel.js`, P1)

- `TOKENS.tr808` and the `dr:` prefix; `dr:step` needs `n` 1–16, each once, all 16 present; every other `dr:` token at most once;
  `RENDERED_TOKENS` gains them; `usable('tr808')` returns the layout once it validates — without `api.drum` (a stub host, tests) the
  `dr:` widgets are built with no listeners and `aria-disabled="true"` (1i's rule for `perf`).
- `inert: 'later'`: an inert control drawn at full contrast (not dimmed) whose `<title>` ends "— cable-able with full patching
  (stage 4)" instead of "— not emulated"; only kind `jack`.
- The model's `family: 'drums'` exempts nothing: hit boxes ≥ 14 mm, disjoint, inside sections, content ≤ 2000 × 1000 mm, no maker word
  (`MAKERS`), the model name only as plain text (cv-panel.test's rule). Where two real controls sit closer than 14 mm (the variation
  switch and START/STOP may), P2 records the conflict and the nudge (≤ 1.5 mm) in `notes`, as the 303's keys did.
- `tools/panel-check.mjs` knows `tr808` (HW_IDS from `panels/index.js`).

### 7.4 The widgets (`cv-drum.js`, P1)

- `drumWidget` builds: the three rotaries (detented, `api.dragB`, tap = next position, aria slider with the legend as value text), the
  slide switches, START/STOP / TAP / CLEAR (CLEAR held is a state: a step key pressed while it is held is "CLEAR + N"), the 16 step
  keys with LEDs (one `data-lit` attribute each: off / on / flash / inverted playhead), the PART and variation LEDs, TEMPO (40
  detents) and FINE. Every press calls `api.drum.press(input)` (§3.3's pure machine runs in the host).
- `drumExtras` builds the extras cells (§3.6) and the popovers (MAP…, SOUNDS…, → Piano roll's bar count) with `wk` menus.
- **LED updates** at most once per animation frame, from the host's step clock (§3.5 heard time); off-screen modules don't update.
- CSS injected once per document (`ensureCSS(doc)`, the cv-keys pattern), so `style.css` is untouched [C].
- `drumHost(deps)` (pure parts node-tested with fakes, as 1i's `perfHost`): `{ api(view), step(msg), live(kind) … }`; main.js only
  wires it (§10).

### 7.5 The extras strip

Full width under the face (no `at`), caption "EXTRAS · not on the original · Sounds: our model of the circuits · Dimmed controls are
not emulated" [C]; row 1: grid + pads; row 2: SYNC · SWING · → PIANO ROLL · REC · MAP… · SOUNDS… · DEMO.

## 8. Canvas and the Sources tray

1. **Drums view**: `SRC_VIEWS` gains `{ id: 'drums', label: 'Drums', tip: 'Drum machines with their real front panel', layout: 'hw',
   note: 'More machines later: TR-606, TR-909, then the Simmons SDS-V with the pad controller.', sections: [{ id: 'drums', models: m =>
   m.family === 'drums' }] }`; `CLASSIC` excludes drums (Hardware and Simple list the twelve synths only), and so do the tile's other
   `!m.custom` sites — the hidden "SIMPLE" badge (cv-tray.js:372) and the "simple / hardware panel" aria-description (473). A stored
   view `'drums'` opens Drums; the dropdown reads Hardware · Simple · Serum · Drums.
2. **The tile**: `cv-art` `SIL.tr808 = { body: 'box', steps: 16 }` and `DRAW.tr808` — our own drawing: a wide low case, twelve knob
   columns, the four-colour run of sixteen keys, no text (cv-art.test's rules); the tile's cost label from `COST.synth.tr808`.
3. **Tap / drop** as every instrument (1f): a drop anywhere on the canvas or a tap replaces the track's instrument ("Replaced X with
   TR-808 · tap to undo"); + Track (or a drop on the tracks list) adds a track named "TR-808". `srcUi` gives drums `null` (always
   Hardware).
4. **The module**: fixed size from the panel (`sizeOf`, ≈ 1024 × 1024 px); one `out` jack (the mix); the face is a GL texture like
   every hardware face (≈ 4.2 Mpx at dpr 2, ≈ 22 MB with mips, inside `BASE_MAX_PX` and the one-face budget of IMPL-1i §3.3); no **Simple layout** item in ⋯ (and `cvSetLayout` refuses 'flow' for drums); ⋯ keeps
   Save / Delete / Init sound, preset arrows, Replace with…, Tidy, Delete. If the layout were ever unusable the flowing Simple panel
   renders its knobs (no sequencer) with the console warning `usable()` already gives — a safety net, tested not to be reached.
5. **makeRoom / Tidy**: unchanged code; the 808 is ≈ 1024 px wide (narrower than the CS-80).
6. **Voice info**: `voiceInfo` for `engine: 'drums'` → `{ mode: 'drums', n: 16, label: 'Drums' }`; chordCheck never warns on a drum
   track.

## 9. Modulation and controllers

- Every **knob** of the 808 is a modulation destination of class **`proc`** (IMPL-2b §5.2): `cv-mods.FIELD_CLASS` gains the
  `drum.<id>` paths and `CLASS_TABLE` gains `tr808` (regenerated: `node tools/cv-classes.mjs --write`; the table's keys must equal the
  non-custom ids); the target is the **one-level** field path `drum.<id>` (`drum.bdd`: `moRec` splits at the first dot only,
  engine.js:1713, §2.3); with proc rows only there are no slots (`moN = 0`), so today's `modSpan` / `moFields` / `moWrite` run
  unchanged and write the value into `p.drum` — no drums branch in `modSpan` — and `dm` reads its knob fields from `p.drum` per
  chunk. The five switches are `struct` (no modulation). Halos and the press-and-hold menu work through `data-dest` (models.js
  ids only; `dr:` tokens carry `data-nomod`, as the 303's `seq:`).
- Controllers reach drum knobs through CC modules (2b's rule for classic knobs). `bend` / `wheel` / `at` do nothing on the 808.
- ModCore delivers `setv` per span, so a cabled 808 knob is span-stepped like every classic `proc` field: D5's identity is stated (and
  tested) for an 808 with no cables; with a cable both paths still play the same hits and differ only by where the spans fall.

## 10. Host wiring (`main.js`, `classic-panel.js`; lane H1)

### 10.1 Sites

| site | change |
|---|---|
| imports | `drum-core.js?v=9`, `cv-drum.js?v=9` |
| `classicHost` | `drum: DRUM.api` (from `cvDrum.drumHost({ press, send, toRoll, bpm, setBpm, play, stop, playing, heard, noteOn, noteOff, notice, persist, … })`); `classic-panel.js` `api()`: `drum: H.drum && m.family === 'drums' ? H.drum.api(tr) : null` |
| `drumSend(tr, dev, at)` | `compilePlan` + the payload's `map` / `mute` / `smp` / `tap` (§3.5) → if their key changed or `at` → `tables.ensure` the slots that are on (§5), then `postTo(tr, { t: 'seq', s }, dev)`; `persist()` |
| `buildPatch` / `buildInstPatch` / `CG.instPatch` | **unchanged**: the drum patch is `patchFor` of `vals` like every model's (smpgen.test's "buildPatch = patchFor" check stays, tests/smpgen.test.mjs:562–573) |
| `makeNode` (922–929) / `graphParts` (431–440) | `seq` / `seqs[id]` for drums: the drum payload (offline: only when synced, `run: false`, as the 303's); its slot ids join the node's needs |
| the `{t:'step'}` handler (948) | a drum step (`d.m != null`) → `DRUM.step(t, dev, d)` (heard-time LEDs; COMPOSE recording at `s === 0`) — **before** the 303 branch, whose `seqOf` would write a `seq` onto the drum device (main.js:3042–3046) |
| transport `play` / `stop` / `reanchor` / the tempo box | synced drum machines need nothing (the worklet derives position from the transport); free machines are untouched by the transport; `setBpm` from TEMPO when synced = the tempo box's path |
| `setTrackModel` (1716) | to tr808: `drum` from `normDrum(undefined)` (empty memory, defaults), `drumSend` after `sendPatch`; from tr808: the machine stops (`allOff`) and the device's `drum` is deleted (§6) |
| `keepDevs` (1317) / `applyRestore` (1333) | `if (c.drum && d.model === c.model) d.drum = c.drum;` then the "Pattern to notes" entry's `meta.drumSync` (§4.3) |
| `voiceInfo` / `trackVoice` / `chordCheck` / `POLY_TO` | §8 item 6 |
| `instUi` / `srcUi` / `cvSetLayout` / the ⋯ Simple item, and the `o.ui === 'flow' && !m.custom` paths (1718, 3146, 5024) | drums: Hardware only |
| `bounceSet` / `syncedOf` (3608) | §4.4; the item's `needs` gets the slot ids (2480) |
| `importMidiFile` (3558) | §4.5 |
| `userSmps` / `states()` (2041, assets.js) | §5 |
| `panic` / `powerOff` / hidden page / blur | `DRUM.release()` (pads' pointers, a held CLEAR) |
| `__synthTest` | `cv.drum: DRUM` (the sims) |

No `t.model` / `t.vals` / `fxOf(t)` in any new line (the accessor ratchet, IMPL-3 §4.3).

### 10.2 The DSP lists (lane E; every site from the engine map)

`dr-808.js` and `dr-seq.js` join, in this order, **between `fx-dsp.js` and `mod-core.js`** — `mod-core.js` stays last before
`engine.js`, as `modcore.test` (86: "loaded last"), `main.test` (47) and `integration.test` (675) pin it (§15 #15): `main.js`
`DSP_FILES` (739), `wk.js` `DSP_GLOBALS` (3151: `Dr808`, `DrSeq`), `smprender.js` (30), `cv-cost.js`'s worker list (279),
`tests/golden-harness.mjs` `DSP_V2` (28), `tests/dsp-scope.mjs` `DSP_TABLE` (39), `tests/bench.html` (64–76); the tests that pin the
list (`sx-base.test` 427, `wk.test` 28 (`DSP_GLOBAL_NAMES`) and 2233, `cv-cost.test` 299 / 305, `bench.test` 117, `pwa.test` 141,
`smpgen.test` 371, `integration.test` 675, `main.test` 47 and `app.test` 165 — module counts 13 → 15); `sw.js` by the lead (`node
tools/precache.mjs --write`). `engine.js` looks both globals up lazily (a missing script → the drum Inst renders silence and posts
`drumsErr` once, as the optional-script isolation test expects; a missing `Dr808` must not throw inside `warmUp`, whose one
`try` would skip every later warm-up step, engine.js:2936). Phase 0's tests (V, S) load their scripts through `dspScope(…).run(src)`
(tests/dsp-scope.mjs:22–24) — `DSP_TABLE` is E's.

## 11. Lanes and the schedule (the leaner shape)

| lane | phase | owns (exclusive) | tests | model |
|---|---|---|---|---|
| **V** voices | 0 | `dr-808.js` (new), `tests/dr-808.test.mjs` (new), `docs/canvas/research-808-circuits.md` (the component tables, §14 rule) | §12.1 | **standard** (the stage's hardest code) |
| **S** sequencer core | 0 | `drum-core.js` (new), `dr-seq.js` (new), `tests/drum-core.test.mjs`, `tests/dr-seq.test.mjs` (new) | §12.3, §12.4 | standard |
| **E** engine + data plumbing | 1 | `engine.js` (the `kind === 'drums'` branches of §1.1, `PatchP.drum`, the drums warm-up round, `restore`), `models.js` (`tr808`), **`cv-mods.js` (`FIELD_CLASS` `drum.*`, the regenerated `CLASS_TABLE`) + `tools/cv-classes.mjs` + `tests/cv-mods.test.mjs`** (§15 #3: `classTable()` throws on an unknown patch field the moment `tr808` exists, cv-mods.js:123), the DSP lists of §10.2, `cv-cost.js`, `tests/bench-scenarios.mjs` + `tests/bench.json` (targets, rows), `tests/golden-drums.test.mjs` (new; its `ref-7a` is frozen by the lead, §12.2), the golden-graph / integration / smpgen / classic-mod rules of §12.6 | §12.2, §12.5, §12.6 | standard |
| **P1** panel code | 1 | `cv-panel.js` (§7.2–7.3), `cv-drum.js` (new), `tools/panel-check.mjs`, `tests/cv-drum.test.mjs` (new), `tests/cv-panel.test.mjs` (its pinned `HW_IDS` gains `tr808`, tests/cv-panel.test.mjs:92; `TARGET.tr808 = [1024, 1024]` — the 1016 × ≈ 1020 px box on the 32 px dots, §7.1 — written by P1 from this contract; P2 lands within a dot or hands its number to the lead) | §12.7 | standard |
| **P2** panel data + art | 1 (from P1's first commit: the validator first) | `panels/tr808.js` (new), `panels/index.js`, `cv-art.js` (`SIL` / `DRAW`), `tests/cv-art.test.mjs` | `panel-check tr808`, cv-panel, cv-art | cheaper |
| **H2** data + UI satellites | 1 | `song.js` (normDev, MIDI export), `cv-migrate.js` (schema), `cv-tray.js` (Drums view), `assets.js` (states), `roll.js` (§4.2), their tests (`song`, `cv-migrate`, `cv-tray`, `assets`, `roll`) | §12.6 | standard (roll.js); the rest mechanical |
| **H1** host | 2 | `main.js` (§10.1), `classic-panel.js` (`api().drum`), `tests/canvas-7a-sim.test.mjs` (new, accessor-free), additions to `tests/main.test.mjs`, `tests/classic-panel.test.mjs` | §12.6 | standard |
| reviewers × 2 | 3 | (1) **real engine**: golden harness + `main-sim` with the real Track: D1, D2, D5, D7, every §3.3 row end to end, sync / seek / loop, the circuits against RC's numbers; (2) **headless Chrome** (CDP, `--headless=new --use-angle=metal --force-device-scale-factor=2`, 1440 × 900, 1366 × 1024, 1024 × 1366): the face, LEDs at heard time, pads multi-touch, the grid canvas density, the Drums view, the roll's drum rows, no console errors | — | standard |
| fixers | after | the finding's files, failing test first | | cheaper |

- **Phase 0** (V ∥ S): new files only — they may start beside milestone 3's last phase if the lead has room (the proposal's note; the
  user's answer starts 7a after milestone 3 ships, so by default they start then). Base: `canvas` at this contract's commit.
- **Phase 1** (E ∥ P1 → P2 ∥ H2): after milestone 3's deploy (and 1i, which ships before it); base = that `canvas` commit + V + S merged
  on the holding branch **`wt-7a`**. **E's first commit (E1a) is the `tr808` entry in `models.js`** (§2.3's ids, defaults and `map`)
  **together with `FIELD_CLASS` / `CLASS_TABLE`** (cv-mods.js) and E's own test rules of §12.6 (golden-graph, integration, smpgen,
  cv-cost, cv-mods, classic-mod); P1, P2 and H2 branch from E1a (the panel validates against the model's controls). Until the phase-1
  merge, the MODELS-iterating tests that P1, P2 and H2 own (cv-panel's `HW_IDS`, cv-art, cv-tray) fail on the branches that lack the
  owning lane's change — a known window on `wt-7a`, closed by the merge order E → P1 → P2 → H2; each lane runs its own files.
  (classic-panel's model loop renders the 808's flowing panel until P2's layout lands and needs no edit.) **Phase 2** (H1): base = `wt-7a` after phase 1's merge, and the lead's fixture
  check first: a page sim with the real engine plays the demo pattern synced from bar 3 and posts the plan the panel shows.
- **Phase 3**: the two reviewers → fixers → **one sweep** (every test file, one at a time, by the lead; `golden-*` and
  `canonical-stream` once) → the lead freezes `tests/ref-7a/` (§12.2) → docs (ROADMAP row 7, HANDOVER, §14) → **one squashed commit
  "7a" on `canvas`** → `tools/deploy-canvas.sh` → the user's iPad session (§12.8).
- **Rules for every builder**: `git reset --hard <base>` first (harness worktrees start from `main`; check `git log -1`); `?v=9` on
  every import; `import './v8-guard.mjs'` first in new test files; never fake-DOM nodes in `assert.*` (compare ids, numbers, strings);
  one test file at a time with `node --max-old-space-size=2048 --test tests/<file>.test.mjs`; dense comments in the existing voice;
  no Roland material (D4: describe circuits in our words, read schematics for values only, never copy manual text or redistribute
  scans); **no lane commits `sw.js`**; commit on the worktree branch; report the commit hash and the gates measured. Briefs are short:
  the lane's row, the sections it implements, the base.
- **Interfaces** (each lane stubs the other side): `Dr808.create(inst, 'tr808')` → `{ set(drum), setOS(os, fs), hit(sound, v127),
  trig(mask), render(buf, N, F0), post(L, R, mono, n), live(), reset(), mon() }` (V ↔ E; `hit` / `trig` latch, §1.2; `F0` = the
  span's absolute frame, for the metal phases, §2.1); `DrSeq.create(inst)` → `{ set(s), events(F), transport(play), release(), run,
  sync, pos, syncStep }` (S ↔ E); `drum-core`'s `normDrum`, `press`, `compilePlan`, `toNotes`,
  `vTrig`, `DEFAULT_MAP`, `SOUNDS`, `PERS.tr808` (S ↔ P1 / H1 / H2); `api.drum = { state(), press(input), step(fn) → off, lit(fn) →
  off, pads: { on, off }, popover hooks }` (P1 ↔ H1); `host.drumRows(track)` (H2 ↔ H1).

## 12. Tests and gates

### 12.1 Voices (`tests/dr-808.test.mjs`, lane V; each circuit alone through `Dr808` at 48 kHz × 4 and 44.1 kHz × 2)

- **The two targets for every circuit** (§2.2, RC §14): against **its own analog prototype** (each block's frequency response from
  the chosen component values: centre frequencies ± 1 %, time constants ± 2 %, magnitude ± 0.2 dB to 5 kHz at OS 4) and against **the
  service table** (§2.2's numbers: frequencies ± 8 %, decays measured as the table does — to −20 dB [C] — ± 25 %), at the knob's three
  table positions. Two stated exceptions (§2.2; §15 #10): the **BD**'s 56 Hz is checked as the mean instantaneous frequency over
  10–40 ms (the sigh's start, Werner fig. 11: 57 → 50 Hz), ± 8 %; the **SD**'s production values against the measured later unit,
  177 / 340 Hz ± 8 % [R? S NG], not the printed revision's 238 / 476.
- **BD**: instantaneous frequency (Hilbert, as Werner) at 100 ms near the prototype's centre (≈ 49.5 Hz) at DECAY 5; during the attack
  above 2 × that, for the time the model's Q43 stays on (C38 / R156 discharging, τ 100 ms, below Q43's turn-on), which must lie in
  4–7 ms [R; §15 #9]; the sigh: the frequency at 20 ms exceeds the one at 250 ms by ≥ 3 Hz [R Werner fig. 11];
  the pulse shaper's falling edge clamps at −0.71 V ± 0.05; DECAY 0 → 10 lengthens the −40 dB time monotonically.
- **Metal bank**: each oscillator's period within 0.1 % of RC §7; duty 47.98 % ± 0.1; the band-passes' centres within 2 % of 3440 /
  7100 Hz at OS 4, 2 and 1 (the prewarp); the bank asleep when no metal voice is live, and a hit after 1.3 s of sleep has the phases a
  free-running bank would have (vs a never-sleeping reference: identical output — exact because a phase is a function of the
  absolute sample index, §2.1).
- **Toms / congas**: the pitch falls during the ring (the diode pair): the frequency at 10 ms exceeds the one at 150 ms; TUNING sweeps the
  table's low → high; TOM has PN rumble, CONGA none; a per-hit flip (a note naming the other sound) restrikes the same circuit.
  **RS / CL**: the two tunings and the per-hit flip. **CP**: the envelope has three saw peaks ≈ 10 ms apart and a longer tail.
- **Every circuit**: a retrigger while ringing continues the state (the output differs from a fresh hit's and from a reset-then-hit —
  no machine-gun); **accent is timbre**: the 14 V hit's spectrum, level-normalised, differs from the 4 V hit's (correlation of the
  normalised magnitude spectra < 0.99) for BD, SD, CY, OH, RS; the CH choke (OH −40 dB within its discharge; an OH hit inside the
  model's own hold — computed from C63, R173 and Q23's turn-on, at V_N and at V_A, recorded in §14 — is cut, one after it is not; and
  [R? common use] the classic figure, CH on the beat and OH on the off-beat eighth at 120 BPM (250 ms later), lets the OH sound within
  6 dB of a free OH hit — §15 #11); 44.1 vs 48 kHz frequencies equal within 0.5 %; no NaN / Inf, no denormal (states flushed);
  determinism (two machines, same hits → identical bytes); **span invariance** (the same hits rendered with spans split at 4, 128 and
  random multiples of 4 frames → identical bytes); **order-free hits** (the same hits at one frame latched in two orders, and a step
  mask vs the same hits one by one → identical bytes, §1.2); `noAlloc` over 200 spans with hits; idle: an asleep machine runs no
  circuit code (a counter).

### 12.2 Golden refs (`tests/golden-drums.test.mjs`, lane E; frozen by the lead)

- **Old sound (D1)**: every existing golden shard, `golden-graph` (its loop over non-custom models filtered to `family !== 'drums'` —
  the 12 models ref-1c can render; `n === 12 + presets` stays), `canonical-stream` (fixture untouched) — bit-identical.
- **New refs (D2)**: `tests/ref-7a/` = verbatim `dr-808.js`, `dr-seq.js`, `engine.js` + `MANIFEST.json` `{ note, commit, files: { f:
  { sha256 } } }` (ref-1c's format), frozen by the lead at the acceptance commit (after the fix round, before deploy); the test pins
  the hashes and renders side A (the frozen three, the rest of the DSP list current, as ref-1c's side) against side B (current)
  through `golden-harness` `renderTrack` with a drum event script:
  every sound × { V_N, V_A at ACCENT 5, 10 } × { the defaults, every knob at 0, at 10 }; a 2-bar pattern synced from tick 0 and from
  bar 2 with a loop; a retrigger train; the choke; a per-hit tom / conga flip; OS 2; 44.1 kHz × 1; a sample slot (a fixture sample).
  Gate: `max |A − B| === 0`. Until the freeze the test compares B with itself twice (determinism) and is marked so in its header.
- **D5 (B only)**: the demo pattern + a fill + AB through the sequencer vs `toNotes` of its plan through the song path (an empty FX
  panel, no 2 s silence in the pattern so neither render idle-skips — the skip starts at a span start, and the two renders' span
  starts differ by the note-offs): **bit-identical** over 8 bars synced at 120 BPM / 48 kHz at swing 50 **and at swing 62 %** (whole-
  tick swing, §3.5); at 97 BPM every hit fires on the same 4-frame grid point or the next (a hit log from `dm.hit` / `dm.trig`), and
  aligned at the hits the renders match.

### 12.3 drum-core (`tests/drum-core.test.mjs`, lane S)

`normDrum` (idempotent, every bound, hostile input never throws, size bound); **one test per row of §3.3** through `press` (state +
memory + commands), including the beat-2 quirk, AB from A, intro → A → B, fill every N not counting the intro, TAP fill on top,
CLEAR + N, A / B sharing lengths, COMPOSE record / edit / STOP-as-last / overflow into the next track, PLAY loop, and every input of
§3.3's "not covered" list; `compilePlan` for every mode × variation × fill × pre-scale × parts (lengths, offsets, the `AB ? 2N : N`
cycle — AB with fills every 4 plays A B A F B A B F —, the `fill` measure, mute / solo applied, the content key stable and
sensitive); `toNotes` (positions = the sequencer's whole-tick swung ticks, primary notes, the switch picks the sound, v 100 / 127,
bars); `vTrig` (the table of
§1.3 at 1, 50, 99, 100, 113, 127 and ACCENT 0 / 5 / 10); `DEFAULT_MAP` (unique notes, GM numbers); the constants equal `dr-seq.js`'s.

### 12.4 dr-seq (`tests/dr-seq.test.mjs`, lane S; a fake Inst / Track clock)

Sync: a start at bar 1, bar 9 and mid-measure plays the steps the plan says at the frames the ticks say; seek and a loop wrap; tempo
change mid-measure (positions follow the ticks); stop → silent; free: START from step 1 at the knob's tempo, `pos` advance; `at: 'now'`
keeps the position, `at: 'bar'` swaps at the boundary and re-anchors, `'beat2'`; a loop wrap (the tick going back, no
`transportHook`) re-anchors at tick 0; a `tap` increment plays the plan's `fill` at the next boundary and the cycle resumes where it
was (AB phase kept); swing at 50 / 62 / 75 % on whole ticks, triplet scales unswung; every pre-scale's tick length; the step posts
carry the frame; `events(F)` ≥ 1; offline = live (the same frames from the same transport messages); no allocation in `events`.

### 12.5 Engine (lane E; `tests/engine-track.test.mjs` additions)

A drum Inst from `{t:'patch'}` and from `processorOptions` (live = offline); the 808 on a graphed node (`{t:'seq', i}` and `step` with
`i`); power off stops the sequencer and splits no spans (the 303's test); the co-resident span-grid bound for a neighbour (as the 303's
2e-3); `warmUp` + `restore` leave a fresh machine (a render after equals a fresh processor's); OS change through `osFade` (no click
above −60 dB); a `modRows` row on `drum.bdd` (through the real `moRec`, not a test-side path walk) moves the decay; a kind change
303 → 808 → 303 leaves each its own `sq` (a 303 payload never lands in a `DrSeq`); a panic while the BD rings is silent after the
5 ms fade; the bench rows of §2.6 and **d8i** as row p's gate (V8; JSC by the lead).

### 12.6 Host, data and the tests that iterate models (H1, H2, E)

- `canvas-7a-sim` (new, accessor-free): a Drums-view tap replaces the instrument; the face renders with `api.drum`; START (synced)
  starts the project; a step key in 1st PART (running) toggles and the posted plan changes in place; CLEAR + 4 sets length 4; the LEDs
  follow `{t:'step'}` at the heard time (a fake audioclock); COMPOSE records three measures; PLAY loops; TAP fill; a pad press posts
  `{t:'on', n: 38, v}` with the touch velocity and lights; MIDI note 36 plays the kick through the worklet; → Piano roll writes the
  notes (v 100 / 127, primary notes), turns SYNC off and its notice's undo restores both — and so does the project's ↶ (the
  `meta.drumSync`), redo turns it off again; MAP… re-maps snare to 40 (the payload's `map`); a sample loaded into SD is ensured
  (`{t: 'smp'}` entry) before the payload naming it; Save embeds it; a project with an 808 reloads identically; History: an unrelated
  undo keeps the pattern memory; replacing the 808 deletes `drum` and the notice's undo brings it back; Save as classic project lists
  the drum track; bounce includes a synced machine with no notes (and its slot entries); the Simple
  layout is never offered; `noteOn(NaN)` nothing; panic stops a free-running machine and its START state / LEDs follow; SYNC off +
  START runs the machine alone at its TEMPO while the transport is stopped.
- H2: `song` (normDev keeps `drum`; MIDI export ch 10; import ch 10 → tr808), `cv-migrate` (schema 8: a schema-8 project read-only in a
  schema-7 gate test; STEPS[7] changes nothing stored), `cv-tray` (the Drums view; Hardware / Simple list the 12 classics — the test's
  own `classic = MODELS.filter(m => !m.custom)` (tests/cv-tray.test.mjs:492) would count 13 and fail its `length === 12`: it filters
  `family !== 'drums'` too; the menu's items and `S.views()` (494–496) gain `drums`; the 808 tile has no SIMPLE badge), `assets`
  (`states()` lists drum slots), `roll` (drum rows: names, compact mode, drag between rows, the "other" row, the scroll extent of the
  compact rows, the piano unchanged for synth tracks).
- **Tests that iterate non-custom `MODELS`** (each gets its rule, none is weakened): `golden-graph:23` → `family !== 'drums'` (§12.2);
  `integration:654 / 818` (every model sounds at note 60) → drums sound at note **36**; `smpgen.test:562-575` → the farm-patch check
  skips drums (not farm instruments; the reason in a comment) while the "buildPatch = patchFor" check runs for the 808 too (the patch
  is `vals`-only, §1.1); `classic-mod.test` (every control has a target) → the 808's knobs have `drum.<id>` field targets, and one
  case checks the engine's `moRec` resolves each (its own probe walks any depth, line 77); `cv-mods.test:23–31` (E) → the counts
  become 453 controls, proc 60, struct 12, the struct list + the five 808 switches; `classic-panel.test:93` → the 808 renders both
  layouts with one `data-dest` per control (no edit); `cv-art.test` → `SIL` / `DRAW` for tr808; `cv-cost.test` → `COST.synth.tr808`;
  `cv-panel.test` → `HW_IDS` includes tr808, `TARGET.tr808` (P1, §11); `cv-shell-sim:257` (the track chip lists every model) and
  `cv-graph.test:20` (every model's v1 track compiles to today's patch) include the 808 with no edit; `golden-classic` / `golden-fx`
  iterate the frozen ref-p1 list (tests/golden-classic.test.mjs:12, golden-fx.test.mjs:15) and are untouched.

### 12.7 Panel (P1 / P2)

`cv-panel.test` + `cv-drum.test`: the tokens validated (one mutation per rule: `dr:step` twice with one `n`, a missing `n`, a `dr:` token
of the wrong kind, `inert: 'later'` on a knob); `panel-check tr808` clean; render with a fake `api.drum`: 16 step keys with `data-lit`,
the rotaries step through their legends, CLEAR-held + key → `press({ k: 'clear+step', n })`; without `api.drum` the same nodes, no
listeners, `aria-disabled`; the extras grid canvas hit-tests to (lane, step) at 3 zooms; pads: velocity from y (back 0.30, front 1),
two pointers = two hits, `data-gesture="music"`; LEDs ≤ 1 update per frame; determinism (render twice → identical serialisation);
artwork rules (no maker word, the title plain text, cv-art's shape rules).

### 12.8 Rendering, UI and the iPad

- Reviewer 2 (CDP): the 808 face GL vs `?nogl` ≥ 99 % of pixels within 8 / 255 at k 0.5 and 1; G1 `equalPx` mid-pinch vs rest with
  the 808 on the canvas; the grid canvas ≥ 1:1 at rest (H5); a pad press → `postTo` in the same task, ≤ 1 ms main thread; LED updates
  ≤ 1 per frame under a 300 BPM 32nd-note pattern with no frame over 16.7 ms on the Mac; DOM of the module ≤ 900 elements [C].
- **iPad session** (after deploy): `bench.html` five passes → `bench.json` `"ipad7a"` (old rows within 5 % of `ipad2b` or its spread;
  d8p / d8x / d8m / d8i / d8s ≤ their iPad targets; `stale: false`, the deployed build); hands-on: the Drums view and a drop; the demo
  pattern synced with the TB-303 on another track (locked); write a pattern on the face with step keys (1st and 2nd part, CLEAR + N);
  TAP-write a hi-hat line; AB variation and auto fill 4; compose and play a rhythm track; the pads with several fingers (soft at the
  back, loud at the front); → Piano roll and edit the drum rows; load your own kick into the BD slot; Bluetooth headphones: do the step
  LEDs match what is heard?

## 13. Questions for the user

Only genuine decisions; each has the default the build uses until answered.

1. **The 808 and the play button.** **Recommended (default): the 808 follows the song** — its START/STOP is the project's play
   button, it plays whenever the song plays, in step with the TB-303 and every track, and turning its TEMPO knob changes the project's
   tempo. A switch in the extras strip (SYNC) lets one 808 run on its own instead, at its own tempo, started by its own START/STOP — as
   the TB-303 does today. Is following the song the right default?
2. **Pattern and piano roll on the same track.** If an 808 track has notes in the piano roll and its own pattern running, **both play**
   (recommended), so you can add a few hand-played hits over the pattern. And "→ Piano roll" switches the 808's own pattern off after
   writing it, so it isn't heard twice (one tap undoes both). OK?
3. **Undo and the pattern memory.** On the real 808 nothing can be undone. **Recommended**: like the TB-303 today — the ↶ button
   doesn't undo step edits (they're part of the instrument, so undoing something else can never bring back an old pattern), but
   clearing a pattern or a rhythm track, loading the demo and "→ Piano roll" each show a "tap to undo" notice. The alternative: every
   step key press becomes an undo step of its own.
4. **Drums in the piano roll.** **Recommended**: a drum track's piano roll shows **only the drum rows**, named (Kick, Snare, Closed
   hat …), with a toggle back to the full keyboard; notes use the standard General MIDI drum numbers (kick 36, snare 38, closed hat
   42 …), so drum MIDI files and pad controllers line up; the map is editable per machine. The alternative numbering is Roland's own
   TR-8S layout.

**Things you will notice (no decision needed)**: the Sources menu gains **Drums**; the 808 is drawn at its real size (with its
extras strip a square about 1 000 points across at 100 %: smaller than the Prophet-5 with its keyboard); its sounds are our model of
its circuits, not recordings (the about text says so); the snare follows the later production units' tuning (808s varied; an "early
unit" character can come later); the paired sounds (tom / conga, rim shot / claves, clap / maracas) share a column and follow its switch, as on the original, but the
pads, the piano roll and MIDI can play either sound of a pair directly; the per-drum output jacks are drawn and become cable-able with
full patching (stage 4); swing, the step grid, mute / solo, the pads and → Piano roll live in the extras strip and start neutral; there
is no hardware MIDI out in the app yet, so the 808 can't drive an external machine; the 808 has no Simple layout for now.

**And one request**: after the deploy, a 20-minute iPad session — `canvas.domlavin.com/tests/bench.html` (five passes, Copy results)
and the hands-on list of §12.8.

**Answers (the user, 2026-10-20):** all four as recommended. (1) The 808 **follows the song** by default (its START/STOP is the
project's play button, TEMPO sets the project tempo); SYNC off in the extras strip runs one machine on its own. (2) **Both play**:
roll notes and the machine's own pattern sum; "→ Piano roll" turns the pattern off after writing it, one undo restores both. (3)
**Undo like the TB-303**: step edits are not undone by ↶; clearing a pattern or a rhythm track, the demo and "→ Piano roll" get a
"tap to undo" notice. (4) **Named drum rows on the General MIDI numbers** (kick 36, snare 38, closed hat 42 …), with a toggle back to
the full keyboard; the note map is editable per machine. Settled: the review (§15) does not reopen them.

## 14. Notes (the builders fill in)

### Lane S (sequencer core; phase 0, base f0305f7)

**Files**: `drum-core.js` (ES module, no imports), `dr-seq.js` (classic IIFE → frozen `globalThis.DrSeq`, null on a load
failure), `tests/drum-core.test.mjs` (41 tests), `tests/dr-seq.test.mjs` (17 tests: a fake Track whose span loop, transport,
loop wrap, end and song notes are engine.js's `process` / `songEvents` / `transportMsg`). Gates measured (node 24, one file at
a time): drum-core 41/41, dr-seq 17/17, lint 127/127. Known window: `pwa.test`'s precache check fails (the two new root
scripts are not reachable from main.js) until E adds `dr-seq.js` to the DSP lists, H1 imports `drum-core.js` and the lead
runs `tools/precache.mjs --write`.

**Interfaces as built** (refinements of §3 / §11, each with its reason):
- `press(state, drum, input) → { state, mem, cmds }`: `state` = the session (`initState()`: run, play, tap, undo, pos, cmp,
  bpm), `drum` = the whole `dev.drum` (memory + `ui` + `x`); immutable, an unchanged record returns as the same reference.
  Inputs `{ k, … }`: start · step n · clear (the widget sends it at CLEAR's release when no step key was pressed while held)
  · clear+step n · tap f · mode / inst / fill / bvar / ifv / pre / tempo / fine v · sync / swing / rec / part v · mute / solo
  lane · grid lane s · pad sound f · map sound notes · mapReset · smp sound slot · undo · demo; host notifications: transport
  play · heard post (each `{t:'step'}` at its heard time: the LEDs' position and COMPOSE's recording) · bpm v (the project
  tempo, for the synced knobs) · panic. Cmds: `{c:'send', at}`, `{c:'play'}` / `{c:'stop'}`, `{c:'bpm', v}`,
  `{c:'notice', text, undo: true}`. Also `leds(state, drum)` (step codes 0 off · 1 on · 2 flash · 3 / 4 the inverted
  playhead over an unset / set step; part; vari), `gridPat`, `stepLen(drum, post)` (ticks to the next step: TAP's
  f = elapsed / that), `demoFree`, `planTicks` (the popover's "track's length"), `drumRows(map)`, `mapTable`, `primaries`,
  `tempoBpm` / `bpmTempo`, `payload(drum, state, at)`.
- `ui.edf` (0 / 1) added to §3.2: which key the write / clear modes edit (`sel` or the I/F key `12 + ifk`) — §3.2's fields
  cannot say that an I/F key was selected for writing; the last step key pressed decides, so the fill just written is the
  one MANUAL PLAY plays. `ui.tempo` = the TEMPO click 0–39, `ui.fine` ± 0.5 click; `tempoBpm` rounds to 0.01 BPM (the
  default 21 + 0.2645 = 120.00). `x.swing` a whole percentage (no .5 ties in `round((2·pct − 100)·T / 100)`).
- The plan gains `mL1` (the post's part), `mT` (cumulative ticks: DrSeq checks it without allocating), `shape` (FNV over n,
  intro, loopFrom, mPre, mL1, mOff), `fill.k` / `fill.v`. The payload gains `prim` (Int8Array(16): the primaries, for a
  step's lastNote, §15 #34) and `pk` (plan.key + a key of the rest, for drumSend's dedupe); `map` is an Int8Array(128),
  `mute` 16 bits (1 = muted), `smp` 16 × `{id, on}` | null, or null.
- Posts `{t:'step', s, m, k, v, p, o, M, f, F, i?}`: `o` = ticks into the measure (the beat-2 test, LED timing), `M` =
  measures since the anchor at tick 0 (synced) / START (free), continuing across swaps (COMPOSE's index), `f` = 1 in a TAP
  fill (`m` −1 there), `k` −1 in a silent PLAY hole.
- For lane E: `seqMsg(s)` with `s.plan !== undefined` is a drum payload → `(this.sq || (this.sq = DrSeq.create(this))).set(s)`
  (kept until the kind is 'drums'); drums `seqEvents(F)` → `this.sq.events(F)`, `transportHook(p)` → `sq.transport(p)`
  (DrSeq reads `T.fresh` there), `seqRelease()` → `sq.release()`; `noteOn` reads `sq.map[n]` / `sq.mute` (`DrSeq.DEF_MAP`
  without an sq); DrSeq calls `dm.trig(mask)` (only when a sound bit is set) and, if the Inst has it, **`drStep(n, v)`** per
  step with sounds (§15 #34: `rack.trigger()`, `lastNote = n`, ModCore gated — n = the lowest primary note of the step's
  sounds after the switches `p.drum.lts…cps`, −1 if none is mapped; v = 1 accented, 100 / 127 else) and `drStep(−1, 0)` as
  the gate off at a stop / release / sync change. No gate-off events are scheduled (no extra spans). `DrSeq.simplePlan(masks,
  pre)` builds a valid one-measure plan for the warm-up round.

**Readings where §3 is silent or contradicts itself** [C]:
1. *Step keys in PATTERN CLEAR*: the "not covered" list says they do nothing, but the CLEAR row clears "the selected key"
   and RC §13's workflow selects it in PATTERN CLEAR — they select the key there (stopped or synced-running); START still
   does nothing there. PATTERN CLEAR's plan is the edited key's, as the write modes'.
2. *TAP's "current part"* vs the step keys' MODE part: TAP writes at the nearest step wherever it falls (the part heard —
   the hardware's "at the heard time"); a TAP or REC pad needs a heard step of the edited key, else nothing.
3. *Which variation a write edits*: a basic key per BASIC VARIATION (AB: the one heard, A when none); an I/F key per I/F
   VARIATION (also for PATTERN CLEAR's "per variation").
4. *PATTERN CLEAR's lengths*: "lengths to 16 / 0" applies to the key even when only A or B is cleared (A and B share them);
   pre-scale to 3.
5. *COMPOSE's index*: `rt[track · 64 + M − m0]` with m0 = 0 (synced: the song's measure index; free: from START); a TRACK
   change while composing records the new track from its measure 1 at the next measure (m0 = M + 1, synced too — the TRACK
   row's "from its measure 1" wins over "the song's index" there); entering COMPOSE mid-run free: the next measure is measure
   1. A new composition (the track empty at the start) extends `rtEnd` measure by measure (STOP's measure = the last heard),
   overwriting into a later track's region ends that track (`rtEnd = −1`), the store's end (767) bounds it; an edit replaces
   measures up to `rtEnd` only. I/F keys pressed while composing request one fill (the tap counter) and set the fill key.
6. *Mute / solo and AC*: a solo of sound lanes mutes the others but keeps AC; AC is muted only by its own mute (a solo of AC
   alone changes nothing).
7. *PLAY*: a −1 inside a track plays a silent 16-step measure; an empty track plays nothing (n = 0); the intro is MANUAL PLAY /
   COMPOSE's only.
8. *DrSeq plan changes*: `at: 'now'` with another shape waits for the boundary (as 'bar'); a 'now' plan while a swap is
   pending replaces the pending one (it carries the newer edit; e.g. a mute after a key press waits with the key); a plan
   equal to the playing one (same key) cancels a pending swap; a stopped, idle (n = 0) or re-anchoring machine takes a plan at
   once. A swap at a boundary starts the new plan at its `loopFrom` (no intro replay); 'beat2' enters the new loopFrom
   measure at its own beat-2 step when the current measure's beat 2 is still ahead and the new measure is longer than a beat,
   else it falls back to the boundary. A re-anchor (start, seek, loop wrap, power on) takes a pending plan at once and drops
   a TAP request. Selecting another I/F key while auto fills play is a 'now' change — a fill of another length changes the
   shape, so it swaps (and re-anchors the AB phase) at the boundary.
9. *Timing*: a step fires at the first span start whose `tickAt` reaches its tick, the distance `(tick − tickAt(F))·fpt`
   (songEvents' expressions) — the first 4-frame grid point at or after its exact frame, or the next when the float distance
   rounds a hair up (also at 120 BPM / 48 kHz: `tickAt` of a quantum start is not exact); the notes path does the same
   arithmetic from the same quantum start, so the fake-Track D5 test measured **identical hit frames** (sequencer vs
   `toNotes` through the song path, intro + AB + fills every 4, 8 bars) at 120 BPM / 48 kHz with swing 50 and 62 %, and
   ≤ 4 frames apart (same grid point or the next) at 97 BPM.
10. *Free clock*: `pos` = frames since START (the Track adds each span), ticks = `fT + (pos − fP) / fpt`; a tempo change
    rebases (no jump); the transport never touches a free machine; a sync change re-anchors.

### Lane V (voices) — `dr-808.js`, `tests/dr-808.test.mjs`, RC §16 (2026-10-20)

**As built.** `Dr808.create(inst, 'tr808', opt)` reads `inst.base`, `inst.OS`, `inst.seedSalt`; the machine has the §11 methods plus
`smp(slots)` (§5: the drum payload's 16 slots `{ id, on }`; entries read lazily through `SxBase.getAsset`, played at the base rate in
`post`, a 2 ms fade on restart, a CH hit cuts an OH sample) and `setSalt(s)` (the noise's salt). `opt` is for the tests only:
`noSleep`, `bankOn` (the metal bank free-running); `_M`, `_v`, `_bank`, `_TB` expose state to `tests/dr-808.test.mjs`. `render(buf,
N, F0)` adds the mix bus (volts, the summing amp's output) at the OS rate; `post(L, R, mono, n)` adds the sample lanes, runs MASTER
VOLUME and the output amp (rails) and scales by `OUT_K`. `setOS(os)` ignores its `fs` (fs = base · os).

**[C] refinements of §2 (for the lead):**
- *Spans and chunks* (D5): each circuit renders a whole span per call, taking its control-rate steps at the absolute 4-frame chunk
  boundaries; each has an attack loop (trigger, excitation, charging envelopes, per sample) and a ringing loop (the same model at rest:
  the settled trigger inputs dropped, the slow envelopes — every τ ≥ 15 ms — stepped per chunk on the chunk's mean VCA current, the
  VCAs' supply per chunk). Latched hits apply at the next render's first chunk in lane order: per circuit the highest volts, both
  sounds of a one-circuit pair → the panel switch's. Span splits change no byte (tested at 4 / 128 / random spans, OS 4 and OS 1).
- *Metal bank*: the six oscillators through the passive sum and the two band-passes as their **periodic steady state** — a 2048-point
  table per oscillator and band from the analog response (the op-amps' GBW included), phase from the absolute OS index anchored per
  chunk — instead of polyBLEP squares and IIR band-passes: alias-free, exact phases, cheap, and the realised bands equal the analog
  prototype at every OS (the "prewarp" check holds by construction). The swing VCAs' coupled bases: a peak tracker with the bias'
  linear leak (the junction clamping through 22 nF; KPK = 4 [C] sets the conduction window); the bank's trackers restart exactly from
  a pre-roll of 2 W samples when the bank wakes (a woken bank = a free-running one, byte for byte).
- *Noise*: a hash of the absolute OS index (Irwin–Hall of four 16-bit uniforms), 130 mV rms in 0–20 kHz (a 20 kHz smoothing low-pass
  above 60 kHz); PN at the base rate from its own hash (the 273 Hz low-pass), interpolated to the OS samples; a waking filter settles
  over a 12 ms pre-roll.
- *Toms*: the diode leg as 33 shared tables over the TUNING travel (built once at the first `create`, ≈ 1–2 ms), blended per knob
  change; Newton from the last V_J on the table with the leg's current linearised (the trapezoid's equation exact), more steps only
  at the attack. *RS*: Q62's base node tabulated (R_M, R321, the junction), C120 per chunk. *CP / MA*: two circuits sharing IC19's
  coefficients. Rails: a soft knee 11 → 13.5 V on every op-amp output.
- **#35**: a circuit sleeps after 4 chunks below 1e-5 × its trigger scale (V_N 4 V → 4e-5 V; the metal bus 6.9 V → 6.9e-5 V), the
  activity being its output peak, its resonators' states and what its supplies can still swing (`v − V_le(v)`); states zeroed.
  Time to sleep after one hit (V_N / accented, ms): BD 1270 / 1330, SD 410 / 445, LT 810 / 910, MT, HT 640 / 720, RS 150, CL 120,
  CB 2740 / 2850, CY 3780 / 3900, OH 550 / 570, CH 460, LC 820 / 920, MC 400 / 445, HC 430 / 470, MA 30 / 40; **CP does not sleep
  for > 6 s**: its reverb's bias drains C138 through Q70's junction (a 1/t law), so in a pattern the clap stays awake (≈ 0.0034).
- **#36** (Q74): read and modelled (RC §5) — Q61 pulls the gate (C113) to −15 V for the trigger, R305 ∥ R327 return it (τ ≈ 15 ms),
  the channel mutes IC19 again past the pinch-off (−1 V [typ]): the output passes for ≈ 40–55 ms. Claves muted −104 dB after 80 ms.
- **§2.5**: `OUT_K` = 2.2 (full scale = 0.45 V at the output amp): BD at the default knobs, unaccented, peaks at **0.4286** (OS 1:
  0.410) against the TB-303's default note (default panel, C3, velocity 0.75, empty rack, 48 kHz × 4) **0.4283** (−7.36 dBFS).
  Consequence: a single accented hit at the default knobs reaches 1.9 FS, and raised LEVEL / VOLUME more — the track's limiter
  (`outStage`) catches them, as the hardware's level structure implies.

**Measured** (48 kHz × 4 unless noted; every gate of §12.1 is in `tests/dr-808.test.mjs`, 23 tests, ≈ 2.6 s):
- Target (a): the SD resonators, RS GEN1, the five Sallen-Key high-passes (CH and MA prewarped at 9 kHz, their 11–12 kHz corners
  otherwise leave 0.21 dB below 5 kHz), the BD's tone / output sections: within 0.2 dB to 5 kHz, peaks within 1 %; CY EG1 τ (0.47 /
  2.47 s) and the toms' C72 · R218 (86 ms) within 2 %.
- Target (b), decays to −20 dB (1 ms peaks after the first 2 ms; model / table, ms): BD 43 / 50, 302 / 300, 876 / 800; OH 98 / 90,
  496 / 450, 603 / 600; CY at TONE 2.5 314 / 350, 689 / 800, 1251 / 1200; SD 68 / 60; CH 40 / 50; CL 26 / 25; MA 25 / 25; LT 209 / 200;
  MT 135 / 130; HT 99 / 100; LC 215 / 180; MC 104 / 100. Frequencies: BD 53.0 Hz mean over 10–40 ms (56, −5.4 %), 49.7 at 100 ms; SD
  172.9 / 336.9 (177 / 340); RS GEN1 452 (455), GEN2 1770 (1667, +6 %); CL 2496; CB 540 / 800; TUNING 0 / 5 / 10: LT 79.1 / 86.4 / 96.7,
  MT 122.3 / 134.0 / 149.4, HT 166.3 / 181.6 / 202.9 (−7.8 % at the top), LC 175.0 / 191.2 / 213.9, MC 252.0 / 275.4 / 308.3, HC 368.4 /
  403.6 / 451.2; 44.1 × 2 vs 48 × 4 within 0.5 %.
- BD: Q43 on 5.25 ms; the attack at ≈ 179 Hz (0.5–3 ms); the sigh 6.4 Hz accented (55.8 → 49.4 Hz), 2.1 Hz at 4 V (the ≥ 3 Hz gate is
  checked accented, as Werner's figure); the clamp −0.71 V; DECAY lengthens the −40 dB time monotonically.
- Levels (Vp-p at LEVEL 10, 4 V / 14 V; table): BD 3.54 / 11.6 (3.5 / 10), SD 3.0 / 15.3 (3 / 10), LT 3.3 / 17.8, MT 3.4 / 16.9, HT 3.7 /
  19.0 (3–3.5 / 11–12), LC 2.9 / 13.5, MC 1.9 / 9.2, HC 3.1 / 13.0, RS 2.9 / 19.5 (3 / 10), CL 2.6 / 9.6 (2.5 / 8), CP 2.0 / 4.5 (2 / 6), CB
  4.8 / 10.1 (3.5 / 12), CY 7.2 / 16.0 (3.5 / 7), OH 5.7 / 14.3 (3.5 / 7), CH 4.6 / 11.1 (3 / 6), MA 3.0 / 5.5 (3 / 5). Accent / normal
  runs hot on the toms and RS (5–6.7 × against ≈ 3.4 ×) and the metal voices are 1.4–2 × the table (KPK moves them little) — reported,
  not fitted. Accent as timbre (normalised spectra's correlation, 4 V vs 14 V): BD 0.948, SD 0.919, CY 0.978, OH 0.988, RS 0.839.
- Choke: the hold (C63 above Q23's turn-on) **49.5 ms at V_N, 58 / 61 ms at V_A** (ACCENT 5 / 10); a sounding OH −19.7 dB (150–200
  ms after a CH at 100 ms, against a free OH), an OH 5 ms into the hold −14.7 dB, one two holds after the CH −0.2 dB, the classic
  off-beat OH (+250 ms) +0.1 dB.
- CPU (node 24, M4 Max, OS 4, 48 kHz, s per s; informational, the bench rows are lane E's): one circuit retriggered every 100 ms with
  the machine's overhead — BD 0.0029, SD 0.0040, LT 0.0036, MT 0.0031, HT 0.0030, RS 0.0028, CP 0.0034, CB 0.0026 (+ its squares), CY
  0.0082 (+ both bands), OH 0.0033, CH 0.0034 (+ the high band), LC / MC / HC 0.0026, CL 0.0018, MA 0.0015; the machine alone (no
  decimator, no rack): **d8p 0.0126** (OS 2: 0.0077, OS 1: 0.0054), **d8x 0.028**, **d8m 0.010**, a set but silent machine 0.0003 —
  ≈ 0.007 of d8p's 0.020 is left for the decimator, the rack and the track (run to run ± 10 %). One-off costs: the first `create`
  in a scope ≈ 10 ms (the shared tom and RS tables, cold code), later ones ≈ 1.4 ms; `setOS` ≈ 1.3 ms (the bank's tables) — for
  lane E's warm-up round.

**Targets not met (the reasons; the test pins them as measured):**
- **Choke depth**: "OH −40 dB within its discharge" — R134 (100 kΩ) is in series with Q23 as well as Q22, so the drain's τ is 47 ms,
  and the hold lasts only as long as the CH's own envelope (C63 also feeds its VCA): ≈ −20 dB, not −40 (RC §9). Not fitted: a
  different reading of R134 / Q23's network would be needed.
- **Decays**: RS 7 / 10 ms (−30 %: C24's envelope through R108); HC 105 / 80 ms (+31 %); CB 174 / 50 ms (the network's −20 dB point;
  the table's 50 ms is its −10 dB charge-sharing drop, RC §10); CP 46 / 100 ms at LEVEL 7 (112 at LEVEL 10: the reverb tail is a
  plateau near −24 dB that the −20 dB line straddles, RC §6); CY at TONE 5 −26…−29 % (within 15 % at TONE 2.5; the table's TONE
  position is not printed).
- **The sigh at 4 V** is 2.1 Hz (≥ 3 Hz accented). **HT TUNING 10** −7.8 % (inside the ± 8 % band).
- **Fits** [fit] (RC §16): RS R313 491 kΩ (390 kΩ self-oscillates), R324 68 kΩ (unprinted), the clap's threshold / offset / accent
  shift / OTA bias / reverb gain × 4.5, the maracas' gate span and level; C50 1.5 nF [R?].
- For the lead / lane E: `dr-808.js` is a new root script — `tests/pwa.test.mjs` fails until the precache lists it (`node
  tools/precache.mjs --write`, not committed here); the DSP list and the worklet wiring are lane E's.

### Lane P1 (panel code: `cv-panel.js`, `cv-drum.js`, `tools/panel-check.mjs`, `tests/cv-drum.test.mjs`, `tests/cv-panel.test.mjs`)

**P1a (the validator, the geometry, panel-check; lane P2's base)**, on E1a 1b86dcb. Readings where §7 left a detail open [C]:
- `TOKENS.tr808`: the §7.2 table; a token's kind may be a list (`dr:pre`: `['switch', 'rotary']`); the repeated tokens'
  index is generic now (`idx`: `seq:key` note 0–12, `dx:btn` n 1–32, `dr:step` n 1–16 — the messages as before) and
  `full` makes all 16 step keys required ("dr:step: n 7 missing"); `pos` gives each detented token its positions (MODE 6,
  INSTRUMENT / TRACK 12, AUTO FILL IN 6, BASIC VARIATION 3, I/F VARIATION 2, PRE-SCALE 4): `legends` (when given; a
  rotary token must print them) and a switch's `positions` must match. A step key must show its LED (`led` ≠ 'none').
  The other face tokens are "at most once" (§7.3); `cv-panel.test` checks the authored 808 has every one.
- `inert` is `true` or `'later'`; `'later'` only on a jack, with its label (the title names the output). It is drawn at
  full contrast, `<g class="hw-inert hw-later">`, titled / tipped "BD OUT — cable-able with full patching (stage 4)"
  (`LATER_TIP`), and does not count toward the caption's "Dimmed controls are not emulated".
- Extras cells (`TOK_CELL`, world px): `dr:grid` 640 × 272 (`DR_GRID`: a 64 px header column + 16 × 36; a 32 px header row +
  12 × 20), `dr:pads` 232 × 232 (`DR_PADS`: 4 × 56 + gaps), `dr:sync` 96, `dr:swing` 104, `dr:toRoll` 128, `dr:rec` 72,
  `dr:map` 88, `dr:sounds` 104, `dr:demo` 72 (× 64); the 303's cells moved into the same table (unchanged sizes). The
  full-width strip starts a new row after `dr:pads` (`XBREAK`, §7.5's two rows): 16 + 272 + 64 + 8 = 360 px, so a 508 ×
  305 mm face is 1024 × 1024 (`TARGET.tr808`).
- A drum machine's default caption is `XCAPTION_DRUMS` "EXTRAS · not on the original · Sounds: our model of the circuits"
  (D4, §2.5: from `model.family`, so the layout leaves `extras.caption` unset); the renderer appends the dimmed note.
- `RENDERED_TOKENS` has every `dr:` token from P1a on (phase 2 builds their widgets), so a valid 808 layout is `usable()`.
- `panel-check`: loads `panels/<model>.js` directly while it is not in `panels/index.js` yet; prints the model's tokens
  (placed / missing, the step keys by n, each detented token's positions and legends), the extras cells, the 'later' jacks;
  the SVG labels a repeated token with its index.
- Known window: `cv-panel.test`'s pinned `HW_IDS` (now with `tr808`) fails until lane P2 lists `tr808` in `panels/index.js`
  (checked with a scratch copy of the test fixture as `panels/tr808.js`: the four per-model tests pass, 78 / 78).

**P1 phase 2 (the widgets, `cv-drum.js`, the host; on P1a).** `cv-panel` render hands every `dr:` token to `cv-drum.drumPanel(
api.drum | null, ctx)` (`ctx`: its doc, the hw api, the root, its knob drawing helpers): `widget` (face), `show` (the four LEDs),
`extra` (the cells), `start()` after the build, `destroy()` in render's destroy. **For lane H1** — main.js wires
`cvDrum.drumHost(deps)`; every dep optional but `mem` / `put` (the header of `cv-drum.js` is the reference):
`mem(tr)` → the track's `dev.drum` (resolve `tr` by id: undo replaces the track objects), `put(tr, D)` (persist, never a History
step), `send(tr, D, S, at)` (= `drumSend`: `drum-core.payload(D, S, at)`), `play(tr)` / `stop(tr)` (the transport), `playing()`,
`bpm()`, `setBpm(v, ph)` (ph `'move'` inside a TEMPO / FINE drag, `'end'` once at its end — one History step per gesture —,
undefined for one key / wheel step), `heard(ts?)` (main's `outFrame(perfTs)`), `rate()`, `barTicks()`, `noteOn(tr, n, v, ts)` /
`noteOff(tr, n, ts)`, `sel(tr)`, `notice(text, ms, onTap)`, `toRoll(tr, bars)` (§4.3, main's whole step: notes, History with
`meta.drumSync`, then `DRUM.press(tr, { k: 'sync', v: false })` and `DRUM.changed(tr)`), `confirm(text)`, `loadSample(tr, sound)
→ Promise<{ id, name }>` (the importer and §5's per-machine cap), `learn(tr, fn) → off`, `monitor(tr, on)` (subscribe the drum
`postMon` while a panel's pads are mounted). Host methods for main: `api(tr)` (classic-panel `api().drum`), `step(tr, dev, d)`
(the `{t:'step'}` handler, a drum post), `mon(tr, d)` (a drum monitor post `{ lit, act, F }`), `transport(play)` (from `play()` /
`stop()`: synced machines' START state and LEDs), `bpm(v)` (every project tempo change), `panic()` (panic / power off: the
sessions stop, queues cleared, `release()`), `release()` (hidden page, blur), `press(tr, input, ph)`, `changed(tr)` (main wrote
`dev.drum`: undo, → Piano roll), `forget(tr)` (a deleted track).
Readings [C]:
- **Heard time**: posts and monitor lights queue per track and are delivered by one frame loop when `F ≤ heard() + 1/60 s`
  (the panel paints on the next frame, so a step shows within a frame of being heard); the frame's last post goes to the step
  listeners, every post to drum-core's `'heard'` (COMPOSE records each measure start even when several land in one frame); no
  audio clock (`heard()` NaN) → at once. A stop / panic clears the queues.
- **TAP and REC** act at the press (pointerdown / keydown, not a tap's release: the timing is the point) and send
  `f = (heard(ts) − post.F) / fpt / stepLen` after delivering what is heard by then (`fpt` from the project tempo when synced,
  the machine's TEMPO free).
- **CLEAR** held is panel state (pointer capture; Enter / Space held); a step key pressed meanwhile → `clear+step`; released
  with none → `clear`; cancelled (two-finger cancel, lost capture, blur, release-all) → nothing. **Shift + a step key** is CLEAR +
  N (a mouse has one pointer; `aria-keyshortcuts="Shift+Enter"`). CLEAR, the step keys, TAP and the pads are
  `data-gesture="music"` zones (two of them never pinch: CLEAR + N and finger drumming work on the iPad).
- Step-key `data-lit`: `off` / `on` / `flash` (a CSS animation, 2 Hz, steady-dim with reduced motion, paused off screen by
  cv-module's rule) / `head-on` / `head-off` (drum-core `leds()` codes 0–4); `aria-pressed` = a set step, `aria-current` = the
  flashing one. Rotaries / switches are sliders over their positions (`dragB`, tap = next, arrows, the two-finger rollback);
  a vertical slide switch's first position is at the top (up = the first). Value texts from drum-core (`Manual play`,
  `Track 3` in PLAY / COMPOSE, `120 BPM`, `3 · sixteenths`).
- One paint per frame per panel (`drumStats.paints`), never off screen (`[data-cv-off]`: looked at again 4× a second).
- **Grid**: one canvas at `wk.fitCanvas` (storeDensity; repainted at a zoom end and after a release), only when its
  signature changed; rows AC…CH (the switch's sound: LC / MC / HC / CL / MA), the shown part = the write mode's own, else
  `x.part` (the corner switch when the key has a 2nd part), the playhead column at the heard post. Tap a cell → `grid`
  (the mouse at the press, a finger on its tap ≤ 10 px); a header: tap = mute, held ≥ 0.5 s / Alt / right click = solo;
  keyboard: arrows, Space / Enter, M, S; `role="application"` with a live `aria-label` of the cell.
- **Pads**: 4 × 4, the kick bottom-left (LC MC HC CL / RS CB CY MA / LT MT HT OH / BD SD CP CH); every finger a hit
  (`pads.on` at its velocity, `0.3 + 0.75 · f` from the back edge), the pad's off when its last finger lifts; lit on its press
  and on every monitor hit at the heard time (two alternating keyframes restart the flash); a loaded slot's dot; keyboard
  Space / Enter = 100 / 127, arrows move (one tab stop).
- Popovers (`wk.contextMenu`): → Piano roll 1 / 2 / 4 / 8 / 16 bars / the pattern's length; MAP… per sound: Learn (disabled
  without `deps.learn`), Notes… (`wk.ask`), No note, Reset to GM; SOUNDS… per sound: Circuit (ours) / Your sound / Load… /
  Remove. DEMO asks `confirm` only when its keys are not empty.
- Headless Chrome (CDP, `--headless=new --use-angle=metal`, dpr 2; a scratch page: the real `ClassicPanel` → `cv-panel` →
  `cv-drum` over a stub host with a fake transport, a 200 ms-latency audio clock and a fake sequencer; the test fixture as the
  layout, P2's not in yet): two fingers on two pads → two notes at 0.314 (the back edge) and 1.0 (the front), two offs; the
  pads lit by the monitor while the demo plays; 16 paints in 121 frames (≤ 1 a frame); the write mode's playhead LED on the
  heard step in every one of 121 frames (106 exact, 15 within a frame of a step boundary, 0 wrong); CLEAR (a finger) + step 4
  (another) → the 1st part ends at 4; the grid store 1280 × 544 at dpr 2 (≥ 1:1); 674 live-layer elements (+ the face SVG);
  no console errors; 1440 × 900, 1366 × 1024, 1024 × 1366 looked at.
- Tests: `cv-drum.test` 16 / 16, `cv-panel.test` 73 / 74 (the `HW_IDS` window), `lint` 137 / 137, `classic-panel` 9 / 9,
  `main` 39 / 39. `pwa.test`'s precache check now also lists `cv-drum.js` and `drum-core.js` (reachable from main.js through
  cv-panel): the lead's `node tools/precache.mjs --write`.

### Lane H2 (data + UI satellites; phase 1, base 1b86dcb = E1a)

**Files**: `song.js`, `cv-migrate.js`, `cv-tray.js`, `assets.js`, `roll.js` and their tests (`cv-migrate` — song.js's tests
live there —, `cv-tray`, `assets`, `roll`); `tests/canvas-sim.test.mjs` line 518 (the view menu reads Hardware · Simple · Serum
· Drums now). Gates (node 24, one file at a time): cv-migrate 48/48, cv-tray 31/31, assets 38/38, roll 47/47, midi 23/23,
canonical-stream 1/1, lint 135/135 (accessor ratchet unchanged: no new `t.model`-style site), canvas-sim 22/22, accessors 30/30,
main 39/39, cv-shell-sim 16/16, canvas-1e / 2a / 2b sims 24 / 26 / 23; golden-classic 8/8, -fx 3/3, -presets 8/8, -random 1/1,
-graph 6/6 (bit-identical). Known window: `pwa.test`'s precache check (as on the base: `dr-808.js`, `dr-seq.js` until E's
DSP lists; `drum-core.js` is now reachable through song.js / roll.js — the lead's `node tools/precache.mjs --write`).

**As built** (each a refinement of §4–§8 with its reason):
- `song.js`: `isDrum(model)` (a model drum-core has a `PERS` entry for; `__proto__` / `toString` are not). `normDev` keeps
  `drum` on a drum device through `normDrum` (absent / null stays absent: the host makes one at a model switch), drops it on
  any other model's. `exportMIDI`: a drum track on omni → channel 10 (a hand-set channel wins; `AUTO_CH` still never hands 10
  to a synth). `importMIDI`: a channel-10 track carries `model: 'tr808'` and `unmapped` (notes on keys the default map
  leaves silent) — the only new keys, on that track only.
- `cv-migrate.js`: `SCHEMA = 8`, `STEPS[7]` additive; `toV1` adds one `lost` line naming the drum tracks ("TR-808 track(s)
  “…”: the live site has no drum machine — its / their piano-roll notes are kept"); `mirror` / `toV1` never carry `drum`
  (v1 fields only); `splitTracks` keeps a drum device's `drum` with it.
- `cv-tray.js`: the Drums view (`layout: 'hw'`, §8's tip and note); `CLASSIC` excludes drums (badge, aria text). [C] D4 on
  the tile: a drum tile's meta line reads "1980 · drum machine" and its tip "TR-808 (1980) — our model of its circuits, not
  recordings — …" (no maker name; the classics keep theirs).
- `assets.js`: `states()` entries may carry `drum` (`{ track, dev, s: null, fx: null, drum }`): `host.smp.users` names
  the track, `relink` rewrites its slots through a new `editDrum(state, fn, {label})` option (without it the slot keeps the
  missing id: the circuit plays). `drumSmpIds(drum)` (every loaded slot, on or off) and `userAssetIds(s, fx, drum)` for
  Save's embed. §5's 2 playback levels: `ensure(needs, { trackId, node, levels: 2 })` records the track's cap (`M.lv`);
  a sample id is built with `M.want(id)` = the most any track playing it asks for (8 = full), rebuilt in full when a track
  plays it directly (as the zone caps), never down; `release` forgets the cap; bounces (`entries`) build every level —
  levels 0 / 1 are the same samples either way (tested), and dr-808 reads level 0 or 1 only, so offline = live.
- `roll.js` (§4.2): one row table — `this.rows` null = the piano (row = 127 − n, 128 rows), else the compact drum rows
  (`{ n: Int16Array(128) note → row, at: Int16Array(K + 1) row → note }`, row 0 "Other", rows 1…K the primaries, kick at
  the bottom); every conversion goes through `_row`, `_noteAt`, `_rowN`, `_nRows`, `r2y` / `y2r` (`n2y` / `y2n` on top),
  `_lab` / `_nlab`; the piano draws and edits **byte-identically** to before (a scratch differential run of the old and
  new roll.js over mouse / touch drags, hovers, the key strip, nudges, Fit and Keys ±: identical draw calls, notes, log,
  selection and view; the 42 existing roll tests unchanged). [C] choices: the gutter is `GUT_D` = 120 px whenever a track
  has drum rows (names fit: "Closed hat" + its number); aliases (35, 40 …) sit in "Other" (drumRows lists primaries only;
  the piano dims them too); "Other" draws / adds / auditions nothing and a vertical move never enters it — a note in it
  may move onto the named rows and back (its pitch kept at 0 rows); one clamp for the whole selection, as the piano's;
  `nudge(dt, dn)` moves by rows; a double-tap on a drum row's key selects that row's notes; ghosts of other tracks show on
  named rows only; the velocity lane adds accent-tinted lines at 100 and 127 and the corner label 100 for 64.

**For H1 (main.js)** — the roll and asset APIs as built:
- `PianoRoll` host: `drumRows: t => R.drumRowsOf(<t's instrument device>)` (`roll.js` export: `[{ n, name }]` | null from
  `{ model, drum }`), `drumRowsOn: <the saved "Drum rows" choice>` (default on). Roll: `setDrumRows(on)` (the toolbar
  toggle; on a synth track it only keeps the choice), `isDrum()` (show the toggle; Transpose asks first), `drumRows()`
  (`{ on, rows }` | null), `refreshRows()` after MAP… (a dirty frame notices a changed map anyway). `roll.setTrack()` after a
  model switch re-reads the rows.
- `importMidiFile`: `it.model` → that model (with `normDrum(undefined)` for its `drum`), the notice from `it.unmapped`.
- `projectFile` / `userSmps`: pass the drum device's `drum` as the third argument (`userAssetIds(s, fx, drum)`) — the loop
  today skips non-Serum instruments; `states`: add `{ track, dev, s: null, fx: null, drum: dev.drum }` per drum device and an
  `editDrum` option.
- **Every** `tables.ensure` for a drum track (`sendPatch`'s and `drumSend`'s) passes the patch's needs **plus** the slots
  that are on and `levels: 2`: `ensure` replaces a track's needs, so a patch post without the slot ids would leave them to
  the 10 s GC, and one without `levels` asks the full 8.

### Lane E (engine + data plumbing; phase 1, base b6b5601)

**Commits**: E1a 1b86dcb (`tr808` in models.js, `FIELD_CLASS` `drum.*` + `CLASS_TABLE`, E's test rules of §12.6); E2 db3f6aa (the
engine's drums kind, the DSP lists); E3 2653cbc (engine-track 7a tests, golden-drums, bench rows, cv-cost, sw.js); E3b f78b18e
(d8p's pattern); E4 these notes.

**As built** (refinements of §1.1 / §2.1 / §3.5, each with its reason) [C]:
- *models.js*: one section per voice column, each switch inside its column (the flowing panel reads as the face); labels Level /
  Tone / Decay / Snappy / Tuning, switches `Tom / Conga` …; `map` → `{ engine: 'drums', drum, level: 1 }` (level never read).
- *PatchP.drum* is a **DrumP** — a fixed-shape normalised copy, not a raw pass-through: the Inst owns the object the classic
  adapter's span setters write (`drum.bdd`), dr-808 reads one hidden class per span, a missing knob is its panel default.
  `tests/cv-mods.test.mjs` parses it as the other patch tables (`DrumP: ['drum.']`).
- *Inst fields*: `dm` (built once at the first drums patch — `Dr808.create(this, 'tr808')`, ≈ 10 ms the first time in a scope —
  then kept and reset across kind changes and `restore`, so its code stays warm), `dmOS`, `sq` (a DrSeq while the kind is
  'drums', else the 303's object or null), `drPend` (the DrSeq of a drum payload that arrived before the drums patch: moved into
  `sq` on entering), `drCur` (#34's gate), `drErr`, `dmV` (the circuits, for stats' voice count).
- *Kind changes* (`setPatch`): crossing the drums boundary releases and drops `sq` first. Leaving: `allOff(true)` renders the
  machine's ≈ 3 ms tail (bus volts, OS rate, through the span buffer a quantum at a time) and `drUnits(drGain)` turns the pending
  tails and the decimators' history into output units; entering (`drOn`): the old model's tails and history are scaled by
  `1 / drGain` (volts), so a de-click fade crossing the change keeps its level. `drGain` = the output stage's static gain at
  MASTER VOLUME (`Dr808.proto.MIX` / `tapA`, `OUT_K`). The chorus / ensemble lines reset on leaving drums (as on leaving Serum).
- *renderDrums*: tails → `dm.render(buf, N, T.spanF)` → the Inst's decimators → `osFade` on mono → `dm.post(Lb, Rb, mono, n)`;
  no smoothing, no LFO, no chorus. `stats.voices` = circuits awake.
- *seqMsg* routes by shape (`s.plan !== undefined`); a payload without `plan` on a drums Inst is dropped (a 303 payload never
  reaches a DrSeq); `smp` in a payload → `dm.smp(slots)`. *noteOn*: lastNote, `nOn`, the rack's RETRIG, then `drHit` (map →
  mute → `dm.hit(s, round(v · 127))`); *noteOff* returns at once. *drStep* (#34): RETRIG (and a Track-driven panel's), lastNote
  and `nOn` when a primary is mapped, ModCore `noteOff(prev, 0)` + `noteOn(n, v, 0, 0)` (the 303's seqFire); `drStep(−1, 0)`:
  `noteOff(prev, nHeld)`.
- *Monitor*: a subscribed drums Inst's `{t: 'smon'}` gains `dr: { lit, act: Float32Array(12) (a copy), F }`, F = the frame after
  the quantum (legacy and graph forms). *drumsErr*: `{t: 'drumsErr'[, i]}` once per Inst when dr-808.js / dr-seq.js is missing
  (the Inst then renders silence; the warm-up skips its round).
- *Warm-up* (`warmDrums`, after the WARM loop, before `SD.warmUp` / `warmGraph`): two panels (switches 0 / 1, knobs off the
  integers), every sound through the note map plain and accented (each a retrigger), the choke, a tom / conga pair in one chunk,
  a free plan at 287 BPM in 32nds with swing (`DrSeq.simplePlan`), an OS change, a synced plan on a stand-in clock (the warm-up's
  currentFrame stands still: `I.tp` swapped for a copy whose frame steps back); the step posts go to a stand-in port. Cost:
  ≈ 80 ms cold in node (the scope warm-up 540 → 660 ms). Samples are not warmed (no asset in a fresh scope).
- *main.js*: only its `DSP_FILES` line (§10.2: the list is E's); the rest of §10.1 is H1's — **for H1**: `drumSend` must
  `tables.ensure` the slots that are on before posting the payload naming them (the machine reads `SxBase.getAsset` at the hit:
  an entry not yet stored plays the circuit, and is looked up again at the next hit); `makeNode` / `graphParts` pass the drum
  payload as `seq` / `seqs[id]`; a drum step is `d.m != null`; the monitor's `dr`; `drumsErr`.

**Measured** (node 24, M4 Max; one file at a time):
- Bench rows (node, OS 4, 48 kHz, the whole track, `cpu-gate` calibrated; targets in bench.json): **d8p 0.0193** (0.020),
  **d8x 0.036** (0.10), **d8m 0.017** (0.035), **d8s 0.0057** (0.012), **d8i 0.00018** (0.0005, gated as row p in
  engine-track). d8p's split (uninstrumented 0.0196): the machine 0.014, the decimators 0.0036, post 0.0003, the Track ≈ 0.001.
  d8p's pattern has both halves alike but for its toms (one a half): `measure()` times 1 s runs = half a bar, and a bar-long
  pattern made the runs alternate (0.017 / 0.034). cv-cost: `COST.synth.tr808 = C('d8p', 'drums', 1, 0.0175, 0.0030)`.
- JSC (the macOS jsc shell, the rows rendered as `measure()` does after the scope's warm-up; a scratch driver, not a repo
  runner): steady d8p **0.014**, d8x 0.026, d8m 0.012, d8s 0.0055 — **the first 3 s ≈ 1.9× steady** (d8p 0.026: JSC's tiers;
  the warm-up's two rounds don't reach them). A/B row c1 (base b6b5601 vs this engine): JSC 0.0400 / 0.0400, 0.0405 / 0.0407;
  V8 c1 −1.5 %, d −1.9 %, r +1.2 % (noise). The lead's JSC gate on d / e / mc0 / mt is still to run.
- D5 (`tests/golden-drums.test.mjs`, side B): the demo pattern with AB and a fill every 4 through the sequencer vs `toNotes`
  through the song path — **bit-identical** over 8 bars at 120 BPM / 48 kHz at swing 50 and 62 % (126 hits each), and at
  **97 BPM every hit on the same frame** (61 of 61), so bit-identical there too.
- Co-resident (a Juno beside the synced 808 on one panel): max |sum − (A + B)| 3.9e-7 of the Juno's peak (−128 dB; bound 1e-5).
  OS change while the BD rings: second difference −83.5 dB over the change (−93.7 before). Panic: the output stage's input is
  below 1e-6 from the third quantum after; the Track's DC block then decays what it held of a 50 Hz drum (its 4 Hz memory, ≈ 0.04 at a
  full BD) — the same for any low note.
- golden-drums before the freeze compares the current tree with itself (determinism); its freeze mode (`GOLDEN_FREEZE_7A=1`)
  was exercised once and passed against its own refs, which were then deleted (§12.2: the lead freezes).

**Known windows** (other lanes' files): `pwa.test`'s precache check fails only on `drum-core.js` (unreachable until H1 imports
it); `cv-tray.test` (views) and `canvas-sim.test` ("Hardware | Simple": 13 classics) until H2's `CLASSIC` filter; cv-panel /
cv-art until P1 / P2.

### Lane H1 (host: `main.js`, `classic-panel.js` `api().drum`; phase 2, base 3de026a = wt-7a after phase 1)

**Files**: `main.js`, `classic-panel.js` (one line + its header), `tests/canvas-7a-sim.test.mjs` (new, 19 tests, accessor-free:
the guard build, device views and `__synthTest` hooks only), `tests/main.test.mjs` (+1), `tests/classic-panel.test.mjs` (+1),
`sw.js` (`tools/precache.mjs --write`: BUILD only — the lists already held the 7a scripts). No DSP / engine / other lane's file.

**The lead's fixture check (§11 phase 2)** — the first sim test, real engine: the Sources tray's Drums view lists the 808 alone,
a tap replaces the Minimoog ("Replaced Minimoog with TR-808 · tap to undo"), Hardware only, an empty record; DEMO, then START
(synced = the project's ▶) from bar 3: 32 step posts over bars 3–4, each `{M, s, m, k, v, p, f, o}` the plan's step at the
tick, `F` on the 4-frame grid at its tick's frame (+0 … +4 frames); with a 200 ms output latency (the sim's Chromium clock)
the panel shows the post heard by now — the newest still ahead of the ear — and the LEDs (key 1 steady, variation A).

**As built** (§10.1's sites; readings [C]):
- `DRUM = cvDrum.drumHost(deps)` beside `PERF`; `classicHost.drum = DRUM`. Every dep resolves the panel's view by its track id
  (`drumTrack`). `play` / `stop` = main's (START synced), `heard` = `outFrame(ts)` (NaN without a context or while a WebKit
  context is held), `noteOn` / `noteOff` = the selected track's note path (src 0: recording, held keys, Velocity / Note), `sel`
  = the selected track, `notice(text, ms, onTap)` through `noticeActs`, `confirm` = the page's, `learn` = an `inputSubs`
  entry `'learn/<dev>'` of the track (the next note in: a key, a pad, MIDI), `monitor` = a `monitors.sub(track, dev, { role:
  'inst', live: selected and cvLive })` delivering `d.dr` to `DRUM.mon` (legacy `i0` / graphed device part).
- `drumSend(view | track, dev?, at, S?, force)`: `drum-core payload(record, session, at)`; posted when `pk` differs from the
  node's (`N.drPk`, by device; set from `processorOptions` / a graph's `fresh` post; a new node starts clean) or `at` ≠ 'now'
  or forced. A slot set switched on / off re-sends the track's patch first (`sendPatch`: needs = patch needs ∪ the slots
  that are on, `levels: 2` when the track has no Serum — `ensure` replaces a track's list, so the patch path and the slot path
  are one list; `N.drIds` remembers the set); a payload naming a slot whose entry is still building (`tables.pend`) waits for
  it, a newer payload of the machine replacing a waiting one — so the `{t:'smp'}` entry always precedes the payload naming it
  (the sim checks the order and the entry's 2 levels). `makeNode` / `graphParts` carry the payload (`seq` / `seqs[id]`;
  offline only synced, from a fresh session: never running) and the slot needs; the bounce's legacy item adds `needs` (the
  slots) beside its patch's (`renderOffline` now unions `patch.needs` and `needs`).
- The `{t:'step'}` handler: `d.m != null` → `DRUM.step(view, dev, d)` before the 303 branch; `{t:'drumsErr'}` → one notice a
  session ("The drum machine's sound engine did not load — reload the page to hear it") + a console warning.
- Transport: `play()` → `DRUM.transport(true)`, `stop()` → `false`. TEMPO / FINE synced → `drumSetBpm`: the tempo box's path
  (`setProjectBpm`, now the box's own handler too: field, re-anchor, synced 303s, every node, `DRUM.bpm`), **one History step
  "Tempo" per gesture** (recorded at a drag's first change; the tempo box itself records none, as before). `applyRestore`
  calls `DRUM.bpm` and `drumChanged()` (every panel re-reads its record) and `drumSend` per drum device.
- `panic()`: `DRUM.panic()` (sessions stop, queues and lights cleared, pads / CLEAR released) and every machine's payload
  forced (`run` off — the worklet's free machine is already stopped by the panic; without the post the next START's payload
  would dedupe against the old running one). `powerOff`: `DRUM.panic()`. Hidden page, blur, a track switch: `DRUM.release()`.
  Delete track / model switch: `drumForget` (session, monitor, the node's payload key).
- History: `keepDevs` keeps a same-model device's `drum`; "Pattern to notes" carries `meta.drumSync { track, dev, sync }`
  (`drBack`, read after `hist.undo` / `hist.redo` as `sxBack`): ↶ puts SYNC back, ↷ turns it off. → Piano roll (`drumToRoll`):
  `toNotes` of the compiled plan from the playhead floored to a bar, the device's switches (`vals`) and map; one step labelled
  "Pattern to notes" (an equal top step is taken as this one: its undo is this edit's); then `press sync false` (+ START when a
  free machine runs) and the notice "Written to the piano roll · the 808's own sequencer is off so it isn't heard twice · tap
  to undo" — the tap undoes the step while it is the newest, else removes those notes and puts SYNC back as a step of its own.
- `setTrackModel`: to a drum machine `drum = normDrum(undefined)` and a forced payload after the patch; away from one `drum`
  deleted (the Replace undo brings it back from History); the session forgotten either way; `ui` forced 'hw' (a stale
  `lay.<dev>.ui = 'flow'` is cleared through the raw `layFlow` check — `instUi` answers 'hw' for any drum device). `srcUi`
  returns **'hw'** for drums, not null as §10.1 wrote: the drag ghost then takes the panel's size (`cvModuleSize`) and the
  stale Simple key is cleared; the effect is "Hardware always". `cvSetLayout` refuses drum devices; the ⋯ menu has no layout
  items for them; `addTrack` / `cvAddInstrument` never give them a Simple layout; `normDevs` (load) and `addTrack` /
  `importMidiFile` write the record, `drumOf` makes one on first read for any drum device without it (a fresh `#tr808`).
- `voiceInfo` → `{ mode: 'drums', n: 16, label: 'Drums' }`; `chordCheck` returns on it. `syncedOf` / the bounce: a synced machine
  with a sounding step (`& 0xFFE` in the compiled plan) is audible with no notes. `states()` lists `{ track, dev, s: null, fx:
  null, drum }` per drum device, `editDrum` writes / sends / tells the panel; `projectFile` embeds every loaded slot.
- `importMidiFile`: a channel-10 track (`it.model`) becomes a TR-808 track with a fresh record; the notice counts `it.unmapped`.
  **Bug fixed (failing test first: the sim's MIDI test)**: importing a file into a project with no notes read `curModel()`
  after the tracks were cleared — a crash for every model, older than 7a; it is read before now.
- The roll: host `drumRows: t => drumRowsOf(instOf(t))`, `drumRowsOn` from `synth.roll.drumRows` (this device, default on);
  the toolbar's "Drum rows" checkbox (`#rollDrums`) shows on a drum track only (`rollDrumUI` after a track switch, a model
  switch, `renderAll`), Transpose asks first ("Transposing a drum track changes which drums play"); `drumPut` refreshes the
  rows when the map changed. SOUNDS… Load… (`drumLoad`): the file picker → `smpHost.import` → a slot of ≤ 10 s (longer:
  refused with a notice — the importer cuts at its own 60 s and has no per-call cap) within the machine's own memory (the
  records' estimate at 2 levels, 6 B a frame and channel at ≤ 48 kHz: 32 MiB touch / 64 MiB elsewhere).

**Gates** (node 24, one file at a time): canvas-7a-sim 19/19, main 40/40, classic-panel 10/10, pwa 22/22, lint 139/139 (accessor
ratchet unchanged), canvas-sim 22/22, canvas-1e-sim 24/24, canvas-1i-sim 20/20, canvas-2a-sim 26/26, canvas-2b-sim 23/23,
canvas-3-sim 25/25, cv-shell-sim 16/16, cv-fixes-sim 5/5, accessors 30/30, roll 47/47, assets 38/38, cv-drum 16/16,
engine-track 44/44; golden-classic 8/8, -fx 3/3, -presets 8/8, -random 1/1, -graph 6/6, golden-drums 5/5, canonical-stream 1/1
(bit-identical). The sim's "both ways" check: the synced pattern and its → Piano roll notes **bounce bit-identically** (max
|A − B| = 0 over the 4-bar loop, 120 BPM, 48 kHz × 4, an empty FX panel).

**Headless Chrome** (`--headless=new --use-angle=metal`, dpr 2, a fresh browser context, `window.__synthTest = {}` before
main.js so the guard build runs), 1440 × 900 and 1024 × 1366 (touch emulated): the Drums view's tile (a real click) replaces
the instrument; DEMO and START (real clicks) play — the project plays, the step posts reach the panel, the key LED lit; two
fingers on SD (near the back) and BD (the front) at once → `{on 38 v 0.34}` and `{on 36 v 1.00}`, both held; a step key in
WRITE 1st PART writes; "→ Piano roll" → its menu → "1 bar" writes 15 notes and turns SYNC off with its notice; the roll shows
the 16 named rows and the toggle; no console errors or exceptions. The module is 1237 elements with the face SVG (P1: 674
live-layer + the face). A smoke artefact worth knowing: an element under the keyboard tray takes the press elsewhere — the
driver pans the world camera to reach the extras strip first.

### Fixes (review 1)

Review 1 (`scratchpad/7a/review-1.md`, against 6ef3128). Fixer A: `main.js`, `dr-808.js`, `engine.js`, tests; every fix failing
test first, each repro (`scratchpad/7a/r/`) re-run after it.

| # | finding | fix | test (failed before) | commit |
|---|---|---|---|---|
| F1 · P0 | a SYNC-off machine (→ Piano roll's normal state) bounced without its payload: the default map, no mute, no slots (bounce ≠ live) | `graphParts` / `bounce()` send the drum payload offline whatever SYNC says — from a fresh session, so `run: false` keeps a free machine stopped; only its tables and a synced plan apply | canvas-7a-sim "review 1 F1": map (note 60 → cowbell), a muted lane, a sample slot (900 Hz ping: 35 zero crossings / 20 ms, not the circuit's 167), plain and graphed node; r1 / r1b: bounce = live | 020d7ac |
| F2 · P0 | ↶ / ↷ across "Replace … with TR-808" left the machine silent (the engine drops its DrSeq leaving 'drums'; `drumSend` deduped against `N.drPk`) | `postPatch`: an Inst whose engine leaves 'drums' forgets its payload key (legacy node: the node's map; graphed: its id) — the key then says what the worklet holds, so the restore's `drumSend` posts | canvas-7a-sim "review 1 F2": plain ↶ ↷ twice, graphed ↶ ↷ ↶ — the synced demo's step posts each time; r10 / r10b | 020d7ac |
| F3 · P1 | the CH → OH choke was lost with a sample on either hat | dr-808 `apply()`: every CH hit fades an OH sample (2 ms, `smpCut`) before the sample branch; a CH sample fires the closed hat's circuit with `mute` (bus gain 0; its C63, its sleep as a sounding CH's), only while an OH circuit can read C63 (not while the OH plays its own sample asleep: d8s stays 0.0058) | dr-808.test "the choke with samples": the four mixed rows ≤ −15 dB (−66.9 / −66.9 / −21.3 / −21.3), the OH's C62 equal under a CH sample and a CH circuit; circuit-only renders byte-identical (golden-drums against 6ef3128's dr-808.js) | f959bde, d922c74 |
| F4 · P2 | one clap kept the machine awake ≈ 75 s | **the 1/t tail is the circuit as read, not a bug**: RC §6 / §16.6 read no base resistor at Q70, so C138 (with C139) drains only through Q70's junction — an ideal exponential junction gives exactly that law (v138 0.47 V at 1 s, 0.44 at 3 s, 0.36 at 40 s; ib ≈ C·V_T / t). Its far end (below ≈ −60 dB, past ≈ 1 s) depends on what the schematic does not fix — the junction's low-current β (recombination), D69's and the board's leakage — so the model is kept and a sleep rule added [C]: the reverb stage's bias and gain fade linearly 2.0 → 2.9 s after the clap's last trigger (`CP_T0` / `CP_T1`; × 1 before, exact: the first 2 s are the circuit's bytes), then the circuit sleeps — **2.87 s** after one clap (2.88 at LEVEL 10 accented; ≤ 3 s at all 27 tested settings). Asleep, C139 / C138 keep their charge (`zero()` leaves them, `rest()` for a fresh machine): a later clap starts from the ≈ 0.44 V a never-sleeping circuit holds — its first second within 0.015 dB of the old model (zeroing them: −0.3 dB). What the fade removes: the tail 62–72 dB under the clap's first 50 ms (LEVEL 10 accented, 2–3 s) | dr-808.test "CP sleeps": ≤ 3 s at v 40 / 100 / 127 × LEVEL 0 / 7 / 10 × ACCENT 0 / 5 / 10; the first 2 s byte-identical to the fade moved out of reach (`Dr808._cpTail`, tests only); the idle test now includes the clap; r11: CP 75.4 → 2.87 s | f614f73 |
| F5 · P2 | → Piano roll while playing dropped ≈ 60 ms of hits (the notes rode `changed()`'s debounced song post, the SYNC-off payload went at once) | `drumToRoll`: `sendSong(t, true)` right after `changed()` (and in its notice's later undo, beside the SYNC-on press: no step twice) | canvas-7a-sim "review 1 F5": the song post before the SYNC-off payload; every CH of bars 2–3 once (r15: `missingCHticks: []`) | 020d7ac |
| F6 · P2 | golden-graph's one-off: `Track.stats` loads from `Date.now()` differences, unclamped — a wall clock stepped back inside a rack's window made a load negative and the tap's `load >= 0` throw | the track's, a panel's and a Serum's own FX's loads clamped at 0 (the Inst's already were); a stat, no audio reads it | engine-track "stats under a wall clock that steps backwards" (legacy and graph node, a 1 s step back inside a rack call); r9: every step position passes | de884d6 |

**golden-drums** (refs not frozen, §12.2) changes only through F4, checked against 6ef3128's three files as a scratch freeze
(never committed): the sweep cases differ by the faded clap tail after 2 s (≤ 2.3e-4 FS, −72.7 dB); the pattern cases by a
waking circuit's start where the old clap held things awake — a later clap's band-pass starts at rest (its first second
+0.015 dB), and the white noise re-wakes, so a snare's VCA tracker starts from the new pre-roll's peak (`M.wnPeak`; sample-level
differences up to 0.087 FS in its first ms, its level within 0.007 dB). F1–F3, F5, F6 leave it byte-identical.

**Seen, not fixed** (for lane V / the lead): (a) the snare's tracker start `M.wnPeak` is the peak of the white noise's *last
wake* pre-roll, so a snare's first ms depends on whether another noise voice (CP, MA) kept the noise awake — a history
dependence (level ≤ 0.01 dB), now visible because the clap sleeps; (b) after r13's fuzz (random knobs out of range, OS
changes, resets, trains) a BD can stay awake 20–64 s, silent (its output ≤ 1e-7 V): C39 sits ≈ 0.17 V off V_sat and relaxes
with τ ≈ 6.8 s through the network's DC path; not reproduced by one OS change, one knob jump or a retrigger train (BD at DECAY
10: 4 s).

**Gates** (fixer A's HEAD, node 24, one file at a time): canvas-7a-sim 22/22, dr-808 25/25, engine-track 45/45 (d8p 0.0205,
d8x 0.037, d8m 0.017, d8s 0.0058, d8i 0.00017), golden-drums 5/5, main 40/40, integration 44/44, bench 6/6, lint 139/139,
pwa 22/22 (`precache --write` run, `sw.js` not committed: the lead rebuilds it after merging both fixers); golden-classic 8/8,
-fx 3/3, -presets 8/8, -random 1/1, -graph 6/6, canonical-stream 1/1 (bit-identical).

### Fixes (review 2) — fixer B, base 6ef3128 (reviewer 2's headless-Chrome report, `scratchpad/7a/review-2.md`)

Each a failing test first (node), then reviewer 2's CDP repro before (6ef3128) / after in headless Chrome (`--headless=new
--use-angle=metal`, dpr 2; scripts and outputs in `scratchpad/7a/fixB/`). No DSP / engine change: goldens bit-identical.

| # | finding | fix | test (failing first) | measured before → after |
|---|---|---|---|---|
| 1 · P1 | a TAP fill asked for in the loop's last bar never played: `locate()` dropped the request at the loop wrap (and the fill `boundary()` had already armed for the wrap's measure) | `dr-seq.js` `locate(t0, wrap)`: a loop wrap (the song position going back with no `transportHook`) keeps a pending request — or the fill armed at the boundary the wrap replaced, none of its steps played — and plays it at the measure start the cursor lands on, else at the next boundary; start / seek / power on still drop it (S's note 8); a fill cut by the wrap is not replayed | `dr-seq.test` "TAP in the loop's last bar": the fill first after the wrap (TAP before / after bar 4's last step), a loop from mid-measure (the next boundary), a seek drops it, a fill cut by the wrap not restarted | `tapfill.mjs` (loop bars 1–4): bar 4 `A2 A3 A0 A1 A2` (no fill) → `A2 A3 F0 A1 A2`; bars 1–3 unchanged |
| 2 · P1 | CLEAR + N by touch depended on which finger lifted first (the key's tap runs at its release) | `cv-drum.js` step keys: a capture `pointerdown` latches CLEAR's state (and marks CLEAR used) at the key's **press**; the tap uses the latch for its own pointer, so a key pressed before CLEAR is a plain step and CLEAR's release then latches PRE-SCALE as before | `cv-drum.test` "CLEAR + N by touch reads CLEAR at the step key's press": CLEAR lifted first, the key lifted first, both in one event, key before CLEAR | `clearn.mjs 1024 1366`: 1 of 4 orders set the length (3 toggled a BD step) → 4 of 4, no toggle |
| 3 · P2 | the module was 1263 elements (§12.8: ≤ 900) | the knob tick ring and shine (13 a knob) and a slide pot's printed ticks (12) that `style.css` already hid on a hardware panel are not built there (`classic-panel` `knob` / `slider` with `c.hw`; cv-panel passes `hw`); a pad is one element (code / name / slot dot: `::before` / `::after` on `data-code` / `data-name`, a background on `[data-smp]`); the staves' 30 note glyphs are 4 texts (decor `text` gains `xs`: one x per character, validated); the name plates one text each (#6) | `classic-panel.test` (no ticks / shine / sticks on the hardware panels, kept on the Resizable ones), `cv-drum.test` (a pad has no child), `cv-panel.test` (`xs` validated and rendered; the 808's 4 stave texts) | the 808 module **1263 → 847** (face SVG 557 → 487, controls 591 → 292, extras 87 → 40 with the #4 hint); the other hardware panels (module elements): modular 1977 → 1665, minimoog 1036 → 776, arp2600 1689 → 1353, solina 291 → 255, cs80 1967 → 1522, prophet5 1224 → 912, ms20 1433 → 1173, tb303 648 → 557, obxa 906 → 646, jupiter8 1686 → 1395, juno60 1041 → 837, dx7 798 → 786. Pixels (`panels.mjs`, the module at k 0.5 and k 1, GL and `?nogl`, animations off): the 12 other panels **0 px changed** in GL at k 0.5 and k 1 and in `?nogl` at k 1; `?nogl` k 0.5: DX7 25 px and OB-Xa 43 px of antialiasing (Δ ≤ 15 / 255, a knob skirt's / slider's edge; stable run to run) — the `?nogl` path's own run-to-run noise is of that class (before vs before: DX7 k 1 475 px Δ 18; after vs after: MS-20 16, TB-303 31 px …) |
| 4 · P2 | synced cycles longer than the loop never complete (the lead: keep §3.5) | `cv-drum.js` `loopHint(D, loop)` (pure, memoised): SYNC on, the song loop on and shorter than the plan's cycle after the intro → one line after DEMO in the extras strip: "Loop is shorter than the fill cycle — fills fall outside it" (an AB-only cycle: "… the A / B cycle — B falls outside it"; PLAY: "… the rhythm track — its end falls outside it"), hidden otherwise; host dep `loop()` = main's `loopInfo`, `transportUI()` calls `DRUM.loop()` (a loop change repaints) | `cv-drum.test` "SYNC on and a song loop shorter than the machine's cycle" (the pure rule: 8 cases; the panel's node, a resize of the loop, the stub host) | `hint.mjs` (1440 × 900, 1024 × 1366): demo + AUTO FILL IN 8 on the 4-bar loop → shown (inside the strip); loop off / MANUAL / SYNC off → hidden; AB + 4 → shown |
| 5 · P2 | MODE's two-line legends sat on their ticks and under the knob | `cv-panel.js` `detentsSvg`: a dial with a multi-line legend lays its word legends by their estimated boxes — a multi-line one as a block centred on its radial line, pushed out until it clears the knob (d / 2) and every detent tick by 0.5 mm; a single-line one where it was unless its box touches a tick (MODE's PLAY moved out, COMPOSE unchanged); dials without multi-line legends untouched | `cv-panel.test` "#5": each MODE legend ≥ 0.3 mm from every tick (Helvetica's widths, independent of the renderer's estimate), the two-line ones clear of the knob; COMPOSE and AUTO FILL IN where they were | `crop-mode-before.png` / `crop-mode-after2.png` (k 1, 3×) |
| 6 · P2 | name plates spaced by a 0.66 em estimate ("LowConga", "BassDrum"); STEP NUMBER touched the PATTERN CLEAR box | `panels/tr808.js`: one centred text per plate, `font-variant="small-caps"` (decor `text` gains `variant`, validated): the code letters capitals, the rest small capitals (≈ 0.7: the old 1.45 ratio), a space between words — the renderer measures it; STEP / NUMBER 0.7 mm lower. `panel-check tr808` valid, 1024 × 1024 | `cv-panel.test` "#3 / #6": 17 small-caps texts, centred, the names; STEP's cap top ≥ the box's foot + 0.6 mm | `crop-plates-before.png` / `-after.png`; −44 elements |
| 7 · P2 | PRE-SCALE's ArrowUp moved the lever down (`dragB` keys ignored `invert`) | `classic-panel.js` `dragB` keydown: `b.invert` flips the arrows and Page keys (Home / End stay min / max), as it flips the pointer. The other inverted controls (the CS-80's minimum-up levers, the ARP 2600's NOISE colour) now move up with ArrowUp too | `classic-panel.test` "#7": PRE-SCALE, three CS-80 levers, the ARP's NOISE colour, a plain slider unchanged | `play.mjs` step K: ArrowUp 3 → 2 (was → 4) |
| 8 · P2 | the compact drum rows filled 306 of 540 px on the portrait iPad | `roll.js` `_drumFit()`: without a chosen row height the compact drum rows size to the grid (`floor(gh / rows)`, up to Fit's caps 32 px mouse / 44 touch, never below the touch minimum) when a drum track opens and when the roll's height changes; the piano unchanged | `roll.test` "#8": five sizes (mouse / touch), the piano's rows as a roll that never showed drums, a resize refits, a stored row height wins | `rollrows.mjs`: 1024 × 1366 touch 18 px → **31 px (527 of 540)**; 1440 × 900 12 → 13 px (221 of 226); 1366 × 1024 18 px (306 of 306, unchanged) |
| 9 · P2 | the lead's decision on the note below: a hardware panel's vertical switch draws position 0 at the top but its binding ran "up = more", so a drag up / ArrowUp / PageUp moved it down on screen | `cv-panel.js` `posBinding(c, mc, stp, axis, invert = !!c.invert)`; `hwSwitch` passes `invert = (orient === 'v')`: a vertical switch's up is always its first position (cv-drum `slide()` already did). A switch's own `invert` is not read (the art ignores it, no layout sets one; `invert` is a slider's, whose art draws it), so the gesture follows the drawing; a horizontal switch (right / up = more), a level rocker (its fill grows up), rotaries and slide pots (the CS-80's levers, the ARP's NOISE colour: #7) are untouched. The stored value for a drawn position, the art, the sound: unchanged — only the gesture's direction | `classic-panel.test` "the lead's decision": all 17 bound vertical switches of the 13 panels (End → ArrowUp / PageUp / a drag up lands above, Home → ArrowDown / PageDown / a drag down lands below, the knob's `--f` agrees; the dr: ones through the machine's memory), every horizontal one unchanged (ArrowRight / ArrowUp / drag right = more), a vertical and a horizontal switch given `invert: true` behave the same | the gesture reversed on **16 controls** (before: drag up / ArrowUp → the next position down the screen): Minimoog OSC 3 CONTROL (`o3k`: 0 top, 1 bottom) and NOISE (`nc`: White top, Pink bottom); Jupiter-8 FREQ MOD DEST (`vd`: VCO-1, Both, VCO-2), PWM SOURCE (`pws`: LFO, —, Env-1), SYNC (`sy`: 0 top), RANGE (`lo`: 0 top), SLOPE (`sl`: 12 dB top, 24 dB bottom), LFO MOD slide (`vlf`: 3, 2, 1, 0: drag up = more); Juno-60 PWM SOURCE (`pm`: LFO top, Manual), ENV POLARITY (`ep`: + top, − bottom), ENV / GATE (`vm`: Env top, Gate bottom); TR-808 LOW / MID / HI TOM-CONGA (`lts` `mts` `hts`: Conga top, Tom bottom), RIM SHOT / CLAVES (`rss`: Claves top, Rim Shot bottom), HAND CLAP / MARACAS (`cps`: Maracas top, Hand Clap bottom). Unchanged: the 808's BASIC / INTRO-FILL VARIATION (horizontal) and PRE-SCALE (already inverted), TB-303 WAVEFORM, Juno RANGE (horizontal), the CS-80 level rockers, every slider / knob / rotary |

**Gates** (node 24, one file at a time): dr-seq 18/18, drum-core 41/41, cv-drum 19/19, cv-panel 80/80, cv-face 26/26,
classic-panel 12/12, roll 48/48, canvas-7a-sim 19/19, canvas-1i-sim 20/20, canvas-sim 22/22, main 40/40, lint 139/139, pwa 22/22
(`tools/precache.mjs --write`), cv-module 57/57, cv-art 4/4, cv-tray 31/31, canvas-1e / 2a / 2b / 3-sim 24 / 26 / 23 / 25,
cv-shell-sim 16/16, cv-fixes-sim 5/5, accessors 30/30, engine-track 44/44; golden-classic 8/8, -fx 3/3, -presets 8/8, -random
1/1, -graph 6/6, canonical-stream 1/1 (bit-identical), golden-drums 5/5 (refs not frozen yet: determinism only); `panel-check`
valid, sizes unchanged, no overlaps, for all 13 models. Every reviewer-2 repro re-run on the fixed build at 1440 × 900 and
1024 × 1366 (plus the fixed-viewport ones): no `console.error`, exception or CDP log error in any run.

**For the lead** (decided 2026-10-20 — row 9, fixed): a hardware panel's *non-inverted* vertical switch (cv-panel `hwSwitch`,
e.g. the 808's five tom / conga switches, the Jupiter-8's FREQ MOD / PWM / LFO MOD bats and slide, the Juno-60's PWM SOURCE)
drew position 0 at the top (`--f` 0 / `data-pos` 0) while its binding's y axis ran "up = more", so a drag up or ArrowUp
moved it towards the bottom — the 808's own PRE-SCALE avoided it by passing `invert` for a vertical switch (cv-drum `slide()`).
The lead chose to make them all follow the finger: `invert: orient === 'v'` in `hwSwitch`'s `posBinding`.

## 15. Review log (the skeptic review, 2026-10-20, against deed338)

Every claim about existing code was read at `canvas` deed338 (= 5129c60 for the code; `wt-m3` b004627 and `wt-1i` 5129c60 for the
lanes in flight). Scratch checks only (MODELS consumers, the bench rows, the research arithmetic); no test was run. The user's §13
answers are settled and not reopened. **The D5 / 4-frame claim holds, with three repairs**: events are not sample-accurate — a song
note and a sequencer step both fire at the first span start whose `tickAt(F)` reaches their tick, spans start on absolute multiples
of 4 frames inside 128-frame quanta (engine.js:3740), and the distance is the same expression from the same last span start (a
`d: 120` note-off lies ≥ 40 ticks ≥ 367 frames before the next hit, so it never adds a span start in that hit's quantum); the Limiter
and DC block are per-sample (1223–1241, 3945–3959). What broke it: fractional swing ticks (#5), the order of hits at one frame (#6),
and the side effects a note has and a step does not (#34, scope). Severity: P0 a silent failure or a broken build, P1 a contract
contradiction or an impossible gate, P2 a gap a builder would trip on, P3 a correction.

| # | point | evidence (file:line) | fix |
|---|---|---|---|
| 1 · P0 | Drum knobs addressed as `drum.<lane>.<field>` (`drum.bd.dc`): the classic adapter resolves a field path **one level deep**, so every cable on an 808 knob would silently do nothing; `classic-mod.test`'s own probe walks any depth and would not notice | engine.js:1713–1715 (`moRec`: split at the first dot, `this.p[sub][key]`); tests/classic-mod.test.mjs:77; IMPL §2.3 / §9 / §12.5 (as written) | **fixed in §2.3, §9, §12.5, §12.6**: a flat `p.drum` keyed by the models.js ids (`drum.bdd`); `FIELD_CLASS` `drum.<id>` (knobs proc, switches struct); MASTER VOLUME in `p.drum.vol`, never `level` (an sm slot on every engine); no drums branch in `modSpan` is needed (proc rows only: `moN = 0`); a test through the real `moRec` |
| 2 · P0 | `map(P, v, G)` cannot see `dev.drum`: the note map, mute and sample slots were to be in `p.drum` and `patch.needs`, but `patchFor` / `buildPatch` / `CG.instPatch` receive `vals` only and the compiled v1 view carries `{model, vals, preset, seq}` | models.js:756–763; main.js:396–401, 418–421, 431–440; cv-graph.js:263, 276, 314; tests/smpgen.test.mjs:562–573 ("buildPatch = patchFor") | **fixed in §1.1, §1.4, §2.3, §3.5, §5, §10.1**: the patch stays a function of `vals` (knobs + switches); `map`, the effective `mute`, `smp` and `tap` ride the drum `{t:'seq'}` payload; `drumSend` ensures the slots' entries before posting (as `sendPatch`, main.js:574–579), node and bounce needs gain the ids (2480); no cv-graph change |
| 3 · P0 | E1a (`tr808` in models.js) makes `cv-mods.classTable()` **throw** (an unknown patch field) and E's own classic-mod rule depends on H2's cv-mods.js; the counts are pinned | cv-mods.js:123, 133; tests/cv-mods.test.mjs:23–31 (425 controls, proc 37, struct 7, the struct list) | **fixed in §11, §12.6**: E1a carries `FIELD_CLASS` / the regenerated `CLASS_TABLE` / `tools/cv-classes.mjs` / cv-mods.test (453, proc 60, struct 12 + the five switches); H2 no longer owns cv-mods |
| 4 · P1 | d8i (silent machine) as a bench scenario: every timed run must be audible, `measure` throws on silence and bench.test asserts a peak per scenario; bench.json targets hold only `{node, ipad}` | tests/bench-scenarios.mjs:401–404; tests/bench.test.mjs:18–23, 82–83; row p 91–106 | **fixed in §2.6, §12.5**: d8i is gated as row p is (`cpu-gate.gateLoad` on an idle machine past the 2 s window, in engine-track); the jsc column is the lead's A/B, not a stored target |
| 5 · P1 | D5 at swing 62 %: "→ Piano roll" rounds swung positions to whole ticks, the sequencer would play 57.6 ticks — 0.4 tick = 10 frames (2–3 grid points) apart at 120 BPM / 48 kHz, not "same or next" | IMPL §3.5 / §4.3 (as written); roll notes are whole ticks (song.js:238; roll.js:837, 861) | **fixed in D5, §3.5, §4.3, §4.4, §12.2**: the sequencer's swing offset is `round((2·swing − 1)·stepTicks)` whole ticks; `toNotes` writes exactly those; D5 bit-identical at 62 % too |
| 6 · P1 | Hits at one frame arrive in different orders on the two paths (one mask in lane order vs notes sorted by tick then note number); the CH→OH choke, a pair's two sounds on one circuit, a step + a note on one lane are order-dependent | song.js:112 (`sortNotes`); engine.js:3653–3661 | **fixed in §1.2, §1.4, §2.1, §12.1**: `hit` / `trig` latch per chunk, applied in lane order, one trigger per circuit per chunk (highest V; a pair in one chunk: the switch's sound); an order-free test |
| 7 · P1 | MANUAL PLAY's cycle `lcm(AB ? 2 : 1, N)` contradicts §3.3's own rule (AB phase counts basic measures, fills excluded): AB + fills every 4 would play A B A F **A** B A F instead of A B A F **B** A B F; the "≤ 48" bound is unreachable | IMPL §3.3 BASIC VARIATION row vs §3.4 (as written) | **fixed in §3.4, §12.3**: cycle `AB ? 2N : N` (N even → N − 1 basics per fill cycle, odd), ≤ 32 + the intro |
| 8 · P1 | A TAP fill (and the AB phase / fill count) cannot be carried by an `at: 'bar'` plan swap: `compilePlan` has no phase input, a re-anchored cycle restarts at A, and main's view of the measure is stale at a boundary race | IMPL §3.4 / §3.5 (as written) | **fixed in §3.4, §3.5, §12.4** (lead may revisit): the plan carries the selected `fill`; a `tap` counter makes `DrSeq` play it at the next boundary instead of the cycle's next measure, the cycle index not advancing — nothing crosses threads |
| 9 · P1 | Research arithmetic: R156 1 MΩ · C38 0.1 µF = **100 ms**, not ≈ 4 ms; the 4–7 ms is how long Q43 stays on (a threshold crossing), and the BD test was written against the product | research-808-circuits.md §2 item 5 and §14 (as written); IMPL §2.2, §12.1 | **fixed in RC §2, §14, IMPL §2.2, §12.1**: the duration comes from the network (charge, R156 · C38, Q43's V_BE); 4–7 ms stays the test band |
| 10 · P1 | "Lands within ± 8 % of the service table" is impossible for two voices with the chosen values: BD settled 49.5 Hz vs 56 Hz (−12 %); SD production 173 / 336 vs the table's 238 / 476 (−27 %, the printed revision's) | IMPL §2.2 rows BD / SD, §12.1; RC §2, §3 | **fixed in §2.2, §12.1, RC §14**: BD's 56 Hz checked as the 10–40 ms mean (the sigh's start); SD against NG's measured later unit 177 / 340 Hz [R? S] |
| 11 · P1 | The choke "holds ≈ 155 ms": that is R173 · C63's τ, not the hold, which lasts until C63 drops below Q23's turn-on (longer when accented); the fixed 100 / 200 ms test could fail a correct model | RC §9 (as written); IMPL §1.2, §2.2 OH row, §12.1 | **fixed in §1.2, §2.2, §12.1, RC §9**: the test uses the model's own hold at V_N and V_A; [R?] the CH-on-beat / OH-off-beat-eighth figure (250 ms at 120 BPM) must let the OH sound |
| 12 · P1 | Project ↶ after "→ Piano roll": `keepDevs` keeps a same-model device's `drum` (incl. `x.sync`) on every undo, so ↶ removes the notes and leaves SYNC off — silence | main.js:1317–1324, 1333 | **fixed in §4.3, §6, §10.1, §12.6**: the History step carries `meta.drumSync`, put back after `keepDevs` (the `modMoveBack` precedent, main.js:1305–1316) |
| 13 · P1 | Engine branches missing or unsafe: `allOff` / `panicClear` / `isQuiet` (a ringing circuit would resume after the panic fade); `this.sq` is shared — `seqMsg` reuses whatever object `this.sq` holds and `Object.assign`s the payload into it, `restore` never resets it, a 303 ↔ 808 switch would write one sequencer's fields into the other; the Track writes `x.sq.run` / `x.sq.syncStep` directly | engine.js:2534–2549, 1491–1508, 2151–2157, 2236–2242, 3328, 3412, 3484, 3493, 3515, 3519 | **fixed in §1.1, §11, §12.5**: those branches; a kind change to / from drums drops `sq`; `seqMsg` routes by payload shape; `restore` resets `sq` and `dm`; `DrSeq`'s shape `{run, sync, pos, syncStep}` |
| 14 · P2 | A `WARM` entry warms one circuit: the warm-up plays notes 48 / 67 (HT, unmapped) and `warmGraph` replays `WARM` twice more on a graphed Inst; a throw inside `warmUp`'s single `try` skips everything after it | engine.js:2978–2995, 3019, 2936 | **fixed in §1.1, §10.2**: a drums round of its own (every sound, V_N / V_A, a synced plan, an OS change) before `SD.warmUp` / `warmGraph`, `WARM` unchanged; a missing `Dr808` never throws there |
| 15 · P2 | "After `fx-dsp.js`" is ambiguous: `mod-core.js` follows it and three tests pin "mod-core.js last"; `wk.test`'s `DSP_GLOBAL_NAMES` and the module counts were not listed; phase 0 cannot edit `DSP_TABLE` | tests/modcore.test.mjs:86; tests/main.test.mjs:47; tests/integration.test.mjs:675; tests/wk.test.mjs:28; tests/app.test.mjs:165; tests/dsp-scope.mjs:22–24, 36–40 | **fixed in §10.2, §11**: between `fx-dsp.js` and `mod-core.js`; counts 13 → 15; phase-0 tests load their script with `dspScope().run()` |
| 16 · P1 | "A hit after 1.3 s of sleep has identical output vs a never-sleeping bank" is infeasible with phases "advanced analytically at wake-up": an accumulated phase and a jump differ in rounding | IMPL §2.1 Metal, §12.1 (as written) | **fixed in §2.1, §11, §12.1**: each phase is `frac(n · f / fs)` of the absolute OS-sample index (`render(buf, N, F0)`), exact through sleep and the idle skip |
| 17 · P2 | cv-tray: "its asserts 12 stays true" is false — the test computes `classic = MODELS.filter(!custom)` (13 with the 808) and pins three views; the tile's SIMPLE badge and aria text are other `!m.custom` sites; main's `o.ui === 'flow' && !m.custom` paths too | tests/cv-tray.test.mjs:492–499; cv-tray.js:322, 372, 473; main.js:1718, 3146, 5024 | **fixed in §8, §10.1, §12.6** |
| 18 · P2 | roll.js site list incomplete for compact rows: `clampY`'s 128 rows, the note culls by note range, the keyboard extent, the touch drag `_rowsMoved`; 807 is a clamp, not a `127 − n` site | roll.js:109–110, 122, 300, 768, 796, 807, 855, 930, 1012, 1027, 1044, 1171 | **fixed in §4.2** |
| 19 · P2 | iPad sample memory: a 10 s stereo slot ≈ 7.7 MB (8 B / frame / channel), 16 slots far above the per-machine 32 MiB, and `fits()` checks only the project budget | assets.js:135, 1326, 1452–1458; smp.js:49 (`levels: 8`) | **fixed in §5**: 2 playback levels (± 1 octave), the per-machine cap as SOUNDS…'s own accounting; `fits()` stays the project gate |
| 20 · P2 | d8p (0.020) is below the sum of the per-circuit ceilings of the circuits it keeps awake (≈ 0.046): with the −140 dB sleep rule they never sleep at 120 BPM | IMPL §2.6; RD §1.3 (spike ≈ 0.002–0.003 a resonator) | **noted in §2.6** (the rows win; lane V aims at the spike, not the ceilings); see #35 |
| 21 · P3 | TEMPO: 40 click stops over 40–300 BPM are 39 steps of 5.3 %, not 4.9 % | (300 / 40)^(1/39) = 1.053 | **fixed in §3.2** |
| 22 · P2 | "The model default OS 4" does not exist: a classic node runs at the app's `settings.os` (default 4) and follows `{t:'os'}` | main.js:89, 690, 734; engine.js:2222–2224 | **fixed in §2.4** (the 808 follows the app's oversampling; ≈ 2× at 8×) |
| 23 · P2 | Prewarp on blocks whose coefficients move every sample (BD R_eff, the toms' diodes) means a `tan` per sample at 192 kHz for no gain (≤ 500 Hz: < 0.1 % warp even at OS 1) | IMPL §2.1 Blocks (as written) | **fixed in §2.1**: plain bilinear `K = 2·fs` for those; prewarp for the fixed-frequency blocks |
| 24 · P3 | The rear MULTI OUT jacks were both a printed legend band and `inert: 'later'` jack controls | IMPL §7.1 / §7.3; panels/tb303.js:26, 157 | **fixed in §7.1**: small jacks under their ▲ legends (the 303's WAVEFORM precedent) |
| 25 · P2 | Sequencer inputs the table did not cover: which part plays while writing, MODE / TRACK changes while running, AB and AUTO FILL in PLAY (the MANUAL PLAY reset rule would never play a B in a track that changes key every measure), TAP in PLAY / COMPOSE, CLEAR latch vs CLEAR + N, the rest | IMPL §3.3; RC §14 open points | **fixed in §3.3, §12.3**: [C] defaults listed after the table; lane S may refine with a reason |
| 26 · P3 | Pad lights from `postMon` lead the sound by the output latency (≈ 200 ms on Bluetooth) while the step LEDs are at heard time | engine.js:3746, 3896–3911 | **fixed in §3.5, §3.6**: the monitor carries its frame; pads light at its heard time |
| 27 · P2 | A loop wrap calls no `transportHook` (it only re-seeks the song), so a `DrSeq` re-anchored at a 'bar' swap would not return to tick 0 there | engine.js:3598–3606 vs 3588–3593 | **fixed in §3.5, §12.4**: re-anchor whenever the song position goes back |
| 28 · P2 | `cv-model.setModel` changes the device in place, so a replaced 808's `drum` would ride on the next model's device (memory, History) while `normDev` drops it on load | cv-model.js:302–309; song.js:546–549 | **fixed in §6, §10.1, §12.6**: switching away deletes `drum`; the Replace undo restores it |
| 29 · P3 | smpgen's loop does two things: the farm-patch check (skip drums) and "buildPatch = patchFor" (keep: the 808's patch is `vals`-only after #2) | tests/smpgen.test.mjs:559–577 | **fixed in §12.6** |
| 30 · P2 | P1 owns cv-panel.test, which pins `HW_IDS` and each model's `TARGET`, but the 808's numbers come from P2's layout | tests/cv-panel.test.mjs:28–30, 92, 177–185; cv-panel.js:117, 430, 479 (`ceil32`) | **fixed in §11**: P1 writes `HW_IDS` + `TARGET.tr808 = [1024, 1024]` (1016 × ≈ 1020 on the dots); P2 within a dot or a number to the lead |
| 31 · P3 | "`v8-guard` clean" checks nothing: the module only sets `--no-sparkplug` | tests/v8-guard.mjs:9–11 | **fixed in D1** |
| 32 · P3 | The jsc column is not a bench.json field | tests/bench.json `targets`; tests/bench.test.mjs:83 | **fixed in §2.6** (with #4) |
| 33 · P3 | DEMO patterns: say they are ours, not a record's or a manual's (D4) | IMPL §3.6 | **fixed in §3.6** |
| 34 · proposal | A note also calls the panel's `rack.trigger()` (Hyper RETRIG), sets `lastNote` (FX key tracking) and reaches ModCore's pseudo-voice; a sequencer step through `dm.trig` does none of it, so a Hyper or a track ENV cabled to an 808 knob follows roll notes but not the pattern | engine.js:2248, 2261, 3425–3451; the 303 precedent 2550–2564 (its steps gate ModCore, IMPL-2b review E5) | **for the lead**: a step with hits calls `rack.trigger()` once, sets `lastNote` to its lowest sound's primary note and gates ModCore like the 303's `seqFire`; D5 is stated without cables / FX (done, D5 / §4.4) either way |
| 35 · proposal | The −140 dB absolute sleep threshold (1e-7 V) keeps a CY at DECAY 10 (τ 2.47 s) awake ≈ 40 s after each hit; the classic voices stop at 1e-5 of their envelope (−100 dB) | IMPL §2.1 Denormals; engine.js:94, 696 | **for lane V / the lead**: sleep below 1e-5 · V_N of the circuit's own trigger scale (≈ −100 dB), recorded in §14 with the d8p number |
| 36 · R? | RS / CL "muted outside the trigger" (Q74) cannot hold literally with 10 / 25 ms decays and a 1 ms trigger: the JFET's gate must follow something longer | RC §5; IMPL §2.2 RS/CL row | **for lane V**: read Q74's gate network from the scan; model what it gives |
| 37 · fine | Checked and fine: `MODELS` appended last changes no index (`modelById`'s `MODELS[1]`, main.js:81; golden-classic / golden-fx draw from the frozen ref-p1 list, golden-classic.test.mjs:12, golden-fx.test.mjs:15; golden-random is Serum-only; no other indexed draw); schema 8 is free (`SCHEMA = 7` on canvas, wt-m3, wt-1i: cv-migrate.js:82); the code lines cited (PatchP 1369, nzW 1599, songEvents 3581, `q.pos` 3742, makeNode 922–929, the step handler 948, keepDevs 1317, AUTO_CH song.js:709, `importMIDI`'s channel song.js:888) are right; `MAKERS` has Roland and the 303 prints its model name and "Computer Controlled" (cv-panel.js:37; panels/tb303.js:111, 131); the research's derived values re-computed agree (SD 249.6 / 173.3 / 499 / 336 Hz; OH / CH / MA high-passes 7.83 / 11.75 / 10.6 kHz, Q 2.5 / 2.5 / 2.3; PN 273 Hz, Q 0.74; metal band-passes 3454 / 7117 Hz; toms 86 / 134 / 182 and congas 192 / 276 / 404 Hz; CB 0.32 in 10.5 ms then τ 147 ms; CY DECAY 0.47–2.47 s; tom reverb 86 ms; accent +10.9 dB; LO out −19.3 dB); the iPad has run at 0.75–0.9 × the node rows (bench.json `ipad2b`), so iPad targets equal to the node's leave margin; lanes: phase 0 is new files only (no overlap with milestone 3's lane D, which owns main.js now, or `wt-1i`'s K1 / K2 / H), phase 1 starts after milestone 3's deploy with 1i already shipped (schedule A), so no 7a lane shares a file with work in flight | as cited | — |

**The lead's decisions on §15 (2026-10-20):** #34 — yes: a sequencer step with hits behaves as a note does (one `rack.trigger()`, `lastNote` = its lowest sound's primary note, ModCore gated like the 303's `seqFire`), so a Hyper RETRIG or a track ENV cabled to an 808 knob follows the pattern and the roll alike. #35 — yes: sleep below 1e-5 · V_N of the circuit's own trigger scale (≈ −100 dB, as the classic voices), recorded in §14 with the d8p number. #8 — accepted as fixed (TAP fills played inside `DrSeq`). #36 — lane V. Phase 0 (V ∥ S) starts now on the holding branch `wt-7a` (the user: use the week's usage freely); phase 1 waits for milestone 3's deploy as written.
