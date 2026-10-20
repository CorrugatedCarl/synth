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
references are to `canvas` at 5129c60 (they drift; the names do not). Sections 1–10 are the contract, §11 the lanes, §12 the gates,
§13 the questions for the user, §14 the builders' notes.

**Every number is tagged**: **[R]** comes from research (with its RC / RD section; **[R?]** = a secondary or conflicting source that
lane V pins from the service-note schematic, RC §14) and **[C]** is a choice made here (the builder may refine a [C] with a reason in
§14; never an [R] without a source).

**Invariants of the stage**
- **D1 Old sound bit-identical**: every golden shard (`golden-classic`, `-fx`, `-presets`, `-random`, `-graph`), `canonical-stream`
  (fixture untouched), the cp2 / ct2 / 2b fixtures, the bench rows' outputs. `engine.js` gains branches reached only by
  `kind === 'drums'`; `AVoice` / `FVoice` / Serum code untouched (`v8-guard` clean); no existing patch gains a key.
- **D2 New sound frozen**: the drum DSP is pinned at the acceptance commit by a new frozen reference set (`tests/ref-7a/`, §12.2), so
  7b (the 606 reuses these circuits) and every later stage keep the 808 bit-identical.
- **D3 One instrument per track** (1f): the 808 is a track's instrument, fed into the track's FX panel and OUT like a classic synth;
  its one `out` jack is the mix; the per-drum jacks are drawn on the panel, inert, "cable-able with full patching (stage 4)".
- **D4 Original content**: no Roland (or other) recordings, schematics, manual text, logos or maker names on the panel or the tile;
  circuits are modelled from published facts in our own code; the panel and tile art are ours; the sounds are labelled "our model of
  the circuits, not recordings" (§2.5, §7.5).
- **D5 Both ways are one sound**: a pattern played by the 808's sequencer and the same pattern written to the piano roll ("→ Piano
  roll") and played as notes render **bit-identically** where the step frames are whole numbers (120 BPM at 48 kHz: 25 frames a
  tick), and with every hit on the same 4-frame grid point or the next one at any other tempo (swing 50 %; §2.1 span invariance,
  §4.4, gate §12.2).
- **D6 Budgets**: §2.6's rows on the Mac (V8), the JSC shell and the user's iPad; no allocation on the audio thread; a silent machine
  costs ≤ 0.0005 (SPEC §9.2's quiet-instrument budget).
- **D7 Determinism**: hits fall on frames that are a function of the transport, the plan and the tempo only; noise is seeded per Inst
  (salted as SPEC §6.2.1); offline bounce = live.

## 1. The drum family

### 1.1 The model and the Inst kind

- `models.js` gains `tr808` (`name 'TR-808'`, `model 'Rhythm Composer'`, `maker 'Roland'` — a model label as for every synth, never
  printed on the panel or the tile, D4 —, `year 1980`, **`family: 'drums'`**, `custom` falsy, `theme`, `sections` with the controls
  of §2.3, `presets` (§2.5), `map(P, v, G)` → a patch `{ engine: 'drums', drum: {…§2.3…}, level, … }` built **without** `base(G)`'s
  voice fields (an unknown key warns once: `PatchP` gains `drum` as a pass-through like `serum` / `seq` / `fxr`, engine.js:1369).
  `MODELS` = the 13 of today + `tr808`, **appended last** (after `serum`), so every index-based use of the 13 (`modelById`'s
  `MODELS[1]` fallback, the tests) is unchanged [C].
- **Filters**: every `!m.custom` site that means "a classic keyboard synth" gains `&& m.family !== 'drums'` (cv-tray `CLASSIC`, the
  Simple-layout paths `instUi` / `srcUi` / `cvSetLayout` / the ⋯ item, `POLY_TO`, chordCheck); the tests that iterate non-custom
  `MODELS` are listed in §12.6 with the rule each gets.
- **Engine**: `Inst.kind = 'drums'` (from `p.engine`). The Inst owns one machine object `this.dm` (null for every other kind; built
  between quanta at the first drums `setPatch`: `globalThis.Dr808.create(this)`) and one sequencer `this.sq` (a `DrSeq`, §3.5 —
  the same field and duck type the TB-303's state uses, so `Track.process`'s `q.run || q.sync` gate and its `q.pos += len` need no
  change). The kind's branches (engine.js; lane E): `setPatch` (kind change: `allOff(true)`, voices emptied, `dm.set(p.drum)`),
  `anyActive`, `fadeOut` (the machine renders its own ≈ 3 ms raised-cosine tail like the voices), `noteOn` / `noteOff` (§1.4),
  `transportHook` (→ `sq.transport`), `seqMsg` / `seqEvents` / `seqRelease` (→ `DrSeq`; a drum `seq` payload that arrives before the
  drums patch is kept and applied when the kind becomes 'drums'; `seqEvents`' `kind !== 'analog'` early return comes after the drums
  branch), `renderSpan` (§2.1), the idle rule, `os` (→ `dm.setOS`
  through `reqOS` / `osFade`), `stats` (voices = sounding lanes), `postMon` (§3.5), `warmUp` (a drums entry **appended at the end** of
  `WARM` — it is index-addressed), `restore` (machine and sequencer back to fresh), `setSalt` (the noise seed). The Track, Chain,
  graph, ModCore and protocol code is unchanged.
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
- **Choke**: a closed-hat trigger **discharges the open hat's envelope and holds it discharged for ≈ 155 ms** (an open-hat hit inside
  that window is cut too: the circuit does not know whether the open hat sounds) [R RC §9]; no other chokes. A muted lane (§3.6)
  neither triggers nor chokes.

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

`Inst.noteOn(n, v, ch, ext, aud)` for kind 'drums': `s = map[n]` (the device's note map, carried in `p.drum.map` as a 128-entry
sound index, −1 = none) → `dm.hit(s, round(v · 127))` at the event's frame (the machine turns the velocity into V by §1.3's law);
unmapped notes do nothing. `noteOff` does
nothing to the sound (one-shots) but the Track's held-note bookkeeping runs as for any Inst. `sus`, `bend`, `wheel`, `at`, MPE
channels are stored and ignored. An audition (`aud`) plays like a note. The map is applied **in the worklet**, so the song, live keys,
MIDI in, the bottom keyboard tray and the pads all reach the drums through one path (D5, I2 of 1i).

## 2. The voices (`dr-808.js`, lane V)

### 2.1 Shared blocks and the render path

- **Render** (Inst kind 'drums', `renderSpan(n)`): `dm.render(buf, n · OS)` adds every live circuit into the Inst's mono OS-rate
  `buf` (as the classic path); the Inst's existing decimator chain (`decChain(OS)`) → `monoBuf`; then `dm.post(Lb, Rb, mono, n)`:
  the sample lanes at the base rate (§5, stereo when a sample is), MASTER VOLUME, the output stage (RC §12: the mix amplifier's
  high-pass and level), `Lb` / `Rb` (dual mono when no stereo sample sounds). Then the track's FX panel and OUT as for any classic.
- **Blocks** (each a small class in dr-808.js, Float64, preallocated, state in fields; every filter from its analog prototype by the
  bilinear transform **prewarped at the block's characteristic frequency** [C: so OS 4 → 2 → 1 (the CPU safeguard) keeps every
  centre frequency; Werner rendered at 4× without prewarp, RC §7], TDF-II or TPT (the lane's choice, stated in §14) with coefficients
  recomputed per control chunk (`CH = 4 · OS` samples) and **per sample while a coefficient sweeps fast** (the BD attack):
  - `Trig` — a lane's 1 ms pulse of height V (4-frame-grid timing like every event) [R RC §1];
  - `Shaper` — the BD pulse shaper (passive low shelf + one-diode clamp of the falling edge, ≈ −0.71 V) [R RC §2];
  - `BridgedT` — the bridged-T band-pass in an op-amp loop with up to three inputs (shaped pulse, feedback buffer, retrigger pulse),
    time-varying R_eff, a unit delay breaking the delay-free loop [R RC §2]; the snare, toms / congas, rim / claves and the clap's
    band-pass use the same block with their own component values (the toms' with the diode pair in the shunt leg) [R RC §3–6];
  - `Metal` — the six Schmitt-trigger square oscillators (5 V, duty **47.98 %**) [R RC §7] with **polyBLEP edges** [C: Werner used
    naive edges at 4×; polyBLEP keeps OS 2 clean for ≈ 20 % more bank cost], summed by the passive network into the two band-passes
    (≈ **3440 Hz**, ≈ **7100 Hz**) [R RC §7]; **runs only while a metal voice is live**; while idle its phases advance analytically
    by the elapsed time at wake-up (exact: the frequencies are fixed), so it behaves as the free-running hardware;
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
  never straddles a span), never per span (unlike the classic `smStep`); a hit lands at the chunk where its event fires. So the same
  hits render the same bytes whatever splits the spans (a sequencer step with no hit, a song note, a quantum edge) [C].
- **Denormals**: every feedback state is flushed below 1e-30 at the chunk (the Serum scripts' rule) [C]; a circuit whose state and
  envelope are below 1e-7 (−140 dB) for 4 chunks is **asleep** and costs nothing until its next trigger [C].
- **Seeds**: the noise seed `0x2545F491 ^ salt` [C]; reset by `restore` and by `setSalt`.

### 2.2 The circuits

| circuit | topology (RC section) | the numbers | knobs (§2.3) |
|---|---|---|---|
| **BD** | trigger AND → pulse shaper → bridged-T in a µPC4558 loop with the feedback buffer (high shelf, DECAY) and the retrigger pulse; Q43 shorts part of the network after the trigger (attack: centre and Q up > 1 octave); leakage into Q43's base = the slow pitch sigh; tone LPF → level → output HPF (RC §2) | centre ≈ **49.5 Hz** from the components, the table's **56 Hz** [R]; attack **R156 · C38 ≈ 4 ms** (Werner ≈ 6, a replica 6.2: the components decide, 4–7 ms) [R]; Q43 leakage fit **α 14.3150, V0 0.5560, m 1.4765e-5** [R]; the sigh ≈ 57 → 50 Hz over 0.3 s [R]; decay **50 / 300 / 800 ms** (knob short / mid / long) [R]; 3.5 / 10 Vp-p [R] | LEVEL (100 k A), TONE (10 k C), DECAY (500 k B) |
| **SD** | two bridged-T resonators kicked by the gated trigger (≈ 0.7 % and 2.6 % of it); TONE cross-fades their outputs; white noise → a swing-type VCA whose envelope (Q47, the C51–C53 ladder) SNAPPY scales → Sallen-Key HPF → the summing amp (RC §3) | **≈ 173 / 336 Hz** (the schematic's production values [R]; the printed 250 / 499 and the table's 238 / 476 recorded, RC §3) [C: which revision]; HPF **≈ 2.75 kHz, Q 0.73** [R]; decay (mid) **60 ms** [R]; the low peak clips above ≈ 8.3 V of trigger [R] | LEVEL (100 k A), TONE (100 k B), SNAPPY (10 k B) |
| **LT/LC, MT/MC, HT/HC** | a multi-feedback bridged-T with an **anti-parallel diode pair** in its shunt leg (the pitch falls as the ring decays); the switch adds capacitance (TOM ≈ an octave lower), lowers the drive ≈ 3.6 × (TOM) and enables the PN "reverb" gate (TOM; τ ≈ 86 ms, slightly longer than the body) (RC §4) | TUNING low / mid / high: **LT 80 / 90 / 100, MT 120 / 135 / 160, HT 165 / 185 / 220, LC 165 / 185 / 220, MC 250 / 280 / 310, HC 370 / 400 / 455 Hz**; decay **200 / 130 / 100 / 180 / 100 / 80 ms** [R]; no decay pot on the stock unit [R] | LEVEL (100 k A), TUNING (500 Ω B), TOM / CONGA |
| **RS/CL** | two bridged-T generators (≈ 452 Hz; ≈ 2.5 kHz, ≈ 1.8 kHz with RIM SHOT's extra capacitor); CLAVES adds positive feedback (higher Q, longer ring) and drops the first; a swing-type VCA (≈ 5 ms envelope) → 2nd-order HPF ≈ 590 Hz, Q 2.9; muted outside the trigger (RC §5) | RS **455 + 1667 Hz**, CL **2500 Hz** (table) [R]; decay RS **10 ms**, CL **25 ms** [R] | LEVEL (100 k A), RS / CL |
| **CP** | WN → bridged-T band-pass ≈ 1.1 kHz → two VCAs: the sawtooth envelope (≈ 30 ms gate, three ≈ 10 ms saws, a final ≈ 20 ms discharge, exponential) and the ≈ 100 ms "reverb" decay; accent also into the offset network (RC §6) | decay (mid) **100 ms** [R]; the saw timing from the comparator network's RC values, fitted where untraced [R?] | LEVEL (100 k A), CP / MA |
| **MA** | WN → a gate → 2nd-order Sallen-Key HPF ≈ 10.6 kHz → a ≈ 15 ms-release envelope (RC §6) | decay **25 / 35 ms**; 3 / 5 Vp-p [R] | (CP's LEVEL) |
| **CB** | oscillators **#5 (800 Hz)** and **#6 (540 Hz)** → two swing-type VCAs on **one** envelope (a fast droop to ≈ 1/3 in ≈ 10 ms, then a ≈ 150 ms tail) → a multiple-feedback band-pass **≈ 860 Hz, Q ≈ 6** (RC §10) | trim ranges 359.4–1149.9 / 254.3–627.2 Hz [R]; decay (mid) **50 ms**; 3.5 / 12 Vp-p [R] | LEVEL (5 k A) |
| **CY** | all six oscillators → both band-passes → attack smoother (V − **0.7258**, τ **1.0244e-4 s**) → 3 EGs (Von **0.5899**, follower VBE **0.6195**; only the 3440 Hz band's EG follows DECAY) → 3 swing-type VCAs (Q18 on 3440 Hz, Q16 / Q17 on 7100 Hz) → 3 high-passes (≈ 2.5 kHz; two near 9–10.5 kHz, resonant) → the 5th-order tone network → level / output buffer (+6 dB/oct in band) (RC §8) | oscillators 205.3, 369.6, 304.4, 522.7, 800, 540 Hz, duty 47.98 % [R]; band-passes 3440 / 7100 Hz [R]; decay **350 / 800 / 1200 ms**, DECAY τ 0.47–2.47 s [R]; bus 7–14 V [R] | LEVEL (100 k A), TONE (20 k B), DECAY (2 M B) |
| **OH** | the 7100 Hz band → swing-type VCA → Sallen-Key HPF **≈ 7.8 kHz, Q 2.5** → buffer; envelope with DECAY (RC §9) | decay **90 / 450 / 600 ms** [R]; held discharged ≈ 155 ms by a CH hit [R] | LEVEL (100 k A), DECAY (2 M B) |
| **CH** | the 7100 Hz band → its VCA → HPF **≈ 11.7 kHz, Q 2.5**; fixed decay; its trigger charges the choke hold (RC §9) | decay **≈ 50 ms**; 3 / 6 Vp-p [R] | LEVEL (100 k A) |
| **mix** | 11 LEVEL pots → the mix resistors → the summing amp → MASTER VOLUME → × 1.5 → the output (RC §12) | master out **6 Vp-p** (HI) [R] | ACCENT (10 k B), MASTER VOLUME (50 k A) |

Ranges in the "numbers" column are the service table's knob short / mid / long (or TUNING low / mid / high) typical values. Lane V
**re-reads every component value it uses** from a high-resolution scan (RC §14: the values in RC are one careful reading) and records
the final table per voice in RC with designators and sources; where a value cannot be read it fits that one component to the table
and tags it **[fit]**. Two targets per voice (RC §14): the model equals **its own analog prototype** (frequencies ± 1 %, time
constants ± 2 %) and lands near **the service table** (frequencies ± 8 %, decays ± 25 %: ± 20 % capacitors, "typical" values). Every
circuit is the analog topology with component values — never an envelope-on-oscillator stand-in — so accent, retriggering and the
knobs behave as the circuit does.

### 2.3 Knobs → circuit (`models.js` `tr808`, lane E with lane V's names)

28 controls: 23 knobs, all dials 0–10 like the TB-303's (`K(id, label, 0, 10, def)`), and 5 switches (`S`): **`ac`** ACCENT; **`bdl bdt bdd`**
BD level / tone / decay; **`sdl sdt sds`** SD level / tone / snappy; **`ltl ltt`**, **`mtl mtt`**, **`htl htt`** level / tuning;
**`lts mts hts`** the tom / conga switches (`['Tom', 'Conga']`); **`rsl`**, **`rss`** (`['Rim Shot', 'Claves']`); **`cpl`**, **`cps`**
(`['Hand Clap', 'Maracas']`); **`cbl`**; **`cyl cyt cyd`**; **`ohl ohd`**; **`chl`**; **`vol`** MASTER VOLUME. TEMPO / FINE and every
sequencer control are not models.js controls (they are sequencer state, §3.2). `map` emits knob positions 0…1 and each pot's
**taper** (`p.drum = { ac, bd: { lv, tn, dc }, …, sw: { lt, mt, ht, rs, cp }, vol, map, mute, smp }`); `dr-808` turns a position into
the pot's resistance (`VRk = VR · taper(k)`) and the circuit's coefficients — one place, testable [C]. Pots and tapers as the parts
list gives them (§2.2's last column: A = audio, B = linear, C = reverse audio) [R RC §2–12]. Defaults: every LEVEL **7**, TONE / DECAY / SNAPPY / TUNING **5**, ACCENT **5**, MASTER
**7.5**, switches on the first sound [C]; the panel's red "standard" mark of the LEVEL knobs sits at ≈ 2 o'clock [R RC §13] — drawn,
not a default.

### 2.4 Rates and oversampling

- The Inst's OS (the model default **4** [C: Werner's cymbal rendering, RC §8]; the CPU safeguard may halve it, session-only, with
  the "OS 4→2" badge as for classics). All circuits run at `fs = base · OS`; sample lanes at the base rate (§5).
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
  `dr-808.test`'s cost probe and recorded in §14 (informational: the gates are the rows below).
- **Per machine** — bench rows [C] (`jsc` = the macOS JSC shell, the lead's IMPL-2b §9 method; the iPad's targets equal the Mac's: the
  user's iPad Pro has measured at 0.7–1.0 × the node rows, `ipad2b`):

| row (kind `track`, OS 4, 48 kHz, every timed run audible: retriggered) | node | jsc | ipad | what |
|---|---|---|---|---|
| **d8p** | 0.020 | 0.020 | 0.020 | a typical pattern: BD on quarters, SD on 2 / 4, CH eighths, OH on the off-beats, CP, two toms, CB, accent every 4th step, 120 BPM, the sequencer running (the whole track) |
| **d8x** | 0.10 | 0.10 | 0.10 | every lane triggered every 250 ms, accented, every DECAY at 10 (the worst case) |
| **d8m** | 0.035 | 0.035 | 0.035 | CY + OH + CB ringing (the metal bank and three VCAs: the diagnostic row) |
| **d8i** | 0.0005 | 0.0005 | 0.001 | the machine powered, synced, the transport stopped, nothing sounding (minus an empty track; on the iPad informational, the 1 ms timer) |
| **d8s** | 0.012 | 0.012 | 0.012 | d8p with all 16 sounds as user samples (§5; the bench's own 1 s fixture) |

`bench.json` `targets` get the five rows (`bench.test` requires both numbers ≤ 0.6); `cv-cost.js` `COST.synth.tr808 = C('d8p', 'drums',
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
  stop in MANUAL PLAY) [R]; `tempo` (40–300 BPM [R], 40 click stops [R] on a log scale [C: ≈ 4.9 % a click]), `fine` (± half a click
  [C]).
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
| **BASIC VARIATION** | A or B loops that one; **AB alternates A, B, …, always starting on A** (after an intro: intro, A, B) [R]; a change applies at the next measure [R]; the AB phase counts basic measures since START or the last key change, fills and the intro excluded [C] |
| **AUTO FILL IN** | MANUAL: fills only by TAP; N: the selected fill **replaces every N-th measure** (the intro not counted) [R]/[C: "replaces the N-th" is our reading of "plays once every N"]; back to MANUAL cancels [R] |
| **INSTRUMENT / TRACK** | the instrument written by step keys and TAP; the track for PLAY / COMPOSE [R] |
| **PRE-SCALE** | the scale of the next CLEAR-latched pattern (write modes) [R]; patterns keep their own |
| **TEMPO / FINE** | free: the machine's tempo. Synced: the knobs **show and set the project tempo** (one gesture = one tempo edit, as the tempo box) [C, question 1] |

LEDs [R RC §13]: the 16 step LEDs show, running in a write mode, the selected instrument's steps of the current part with the playhead
**inverted**; in MANUAL PLAY / PLAY / COMPOSE the playing key (steady) and a pending one (flashing); stopped, the selected key
flashing. The **1st / 2nd PART** LEDs show the running part; the two **variation** LEDs above START/STOP show which variation plays
(running) or plays first (stopped) [R].

### 3.4 The plan (drum-core `compilePlan(mem, ui, x) → plan`, pure)

What the machine plays is compiled on the main thread into an explicit, cyclic list of **measures** (a measure = one pattern: its
1st part then its 2nd part [R]): `plan = { key: string, n, intro: 0 | 1, loopFrom, mKey: Int8Array(n), mVar: Int8Array(n), mPre: Uint8Array(n),
mOff: Int32Array(n + 1) (step offsets), st: Uint16Array(total steps) }` — MANUAL PLAY: [intro?] + one cycle of **lcm(AB ? 2 : 1,
N or 1)** measures (≤ 48) with the fills in place; PLAY: the track's measures (≤ 768); write modes: the selected key (A, B or A + B);
COMPOSE: as MANUAL PLAY. Steps carry the 12-bit mask after **mute / solo** (§3.6) — so muting re-compiles, never branches in the
worklet. ≤ 24 576 steps (48 KB) [C bound]. `plan.key` is a content hash (FNV-1a over the arrays, as `seq-core` keys) so an unchanged
plan is never re-posted.

### 3.5 The clock (`dr-seq.js` `DrSeq`, lane S; wired by lane E)

- **Payload** `{t:'seq', s, i?}` (the 303's message; `seqMsg` routes by kind): `s = { plan, sync, run, bpm, swing, at: 'now' | 'bar'
  | 'beat2' }`.
- **Sync** (`x.sync` on): the plan is anchored at **song tick 0** — the position of every step is a function of the song position, so a
  start at bar 9, a seek or a loop wrap lands where the machine would be had it started at bar 1 (`tp`, `tickAt`, 960 PPQ). Stopped
  transport → silent. **Free** (`sync` off): the machine's own clock from its START, at `bpm` (tempo + fine), `pos` advanced by
  `Track.process` as the 303's (engine.js:3742).
- **Live changes**: a new plan with `at: 'now'` and the same **shape** (measure lengths and tick sizes; a step toggle) replaces the steps
  in place, position kept; any other change (`at: 'bar'`: a key, a variation, a fill knob, a length) swaps at the **next measure
  boundary B** and re-anchors there (the new plan's measure 0 starts at B); a stop, a seek or a fresh play re-anchors at tick 0 again
  (sync) or at START (free) [C]. The beat-2 quirk (§3.3) is `at: 'beat2'`: swap at the current measure's second beat, the new plan
  entered at its own beat-2 step.
- **Swing** (extras, 50–75 % [C: Linn's convention, RD §2.4]): the odd step of each pair starts `(2 · swing − 1) · stepTicks` late,
  for PRE-SCALE 3 and 4 only (triplet scales are not swung) [C]; 50 % = off, bit-identical to no swing.
- **Hits**: at each step's start, `dm.trig(mask)` (the AC bit selects V_A, from the machine's own ACCENT knob, else V_N; muted lanes
  are already out of the mask); the frame is on the Track's 4-frame event
  grid (`seqEvents` returns frames to the next step, ≥ 1, as the 303's). A step is due when `tickAt(F) ≥` its tick and the distance is
  `(tick − tickAt(F)) · fpt` — **the expressions `songEvents` uses for a note** (engine.js:3581), so a step and the same note fire at
  the same span start (D5).
- **Posts** `{t:'step', s, m, k, v, p, F, i?}` (step in measure, measure index in the plan, key, variation, part, **the frame**) at
  every step — ≤ 40 a second at 300 BPM in thirty-seconds; main shows a step at the **heard** time of `F` (audioclock), so the LEDs
  match what is heard on Bluetooth too [C]. COMPOSE recording reads the measure starts (`s === 0`).
- **Monitor** (`postMon`, only while subscribed): `{ lit: sounds hit since the last post (16-bit mask), act: Float32Array(12) circuit
  levels }` for the pad lights and meters.
- Power off / panic / `bye`: the sequencer stops with the Inst (`seqRelease` analogue: nothing held, nothing to release for one-shots).

### 3.6 Extras helpers (start neutral)

- **The step grid** (`dr:grid`): every lane × the current part's steps of the pattern being edited (write modes) or played (play
  modes), the playhead column; tap toggles a step (any mode: a modern helper; nothing changes unless used); the row headers are
  **mute** (tap) / **solo** (long-press) [C]; a 1st / 2nd part switch when `l2 > 0`. Drawn as **one canvas** + a hit layer (208 cells
  as DOM would cost ≈ 400 elements) at `wk.storeDensity` (milestone 3's H5 rule) [C].
- **SYNC** (`dr:sync`), **SWING** (`dr:swing`), **→ PIANO ROLL** (`dr:toRoll`, §4.3), **REC** (`dr:rec`: pad hits write their lane
  at the nearest step while a write mode runs; off by default), **MAP…** (`dr:map`, §4.1), **SOUNDS…** (`dr:sounds`, §5), **DEMO**
  (`dr:demo`: loads our own two example patterns into basic key 1 A / B and fill 1, after a confirm if they are not empty) [C].
- **Pads** (`dr:pads`): 16 pads (4 × 4, one per sound) [C]; velocity from where the pad is touched — the 1i curve (`0.3 + 0.75 · f`,
  front edge loud; `cv-keys.js` `KEY_VEL`, which is main.js `velAt`'s curve); multi-touch; `data-gesture="music"` (two fingers are two hits, never a pinch; 1i §4.3);
  a press → `noteOn(map note, v, 0, ts)` (so recording, held keys and the Velocity module work as for keys); a pad lights on its own
  press and on every hit of its sound (the monitor's `lit`).

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
"other" row at the top [C, question 4]. The roll's row ↔ note conversions go through two methods (`n2y` / `y2n`, roll.js:109), five
direct `127 − n` sites (197, 216, 300, 807, 930), the row-drawing loops over `nLo…nHi` (1010, 1173–1188, 1266) and the `noteName`
labels (1087, 1188, 1205–1214): the lane routes all of them through a row table (`this.rows`: null = the piano; `rowOf(n)`, `noteAt(r)`,
`label(n)`) so compact mode is a table, not a fork; a vertical note drag moves between drum rows. Transpose on a drum track asks first ("changes
which drums play"). The velocity lane is unchanged (100 = normal, 127 = accent: two guide lines drawn).

### 4.3 → Piano roll (`drum-core.toNotes(plan, opts)`, one History step "Pattern to notes")

- Writes what the plan plays — the current mode's: the selected pattern (with AB, intro and fills as they would play), or the whole
  rhythm track — for **N bars** (a popover: 1, 2, 4, 8, 16, the track's length; default 4 [C]) from the playhead floored to a bar (the
  303's rule, main.js:3069). A hit becomes `{ t, d: 120, n: the sound's primary note, v: 100 | 127 }` (the lane's switch at the time
  picks the sound); positions are the swung tick positions rounded to whole ticks [C].
- Then **SYNC is switched off and the machine stopped** (so the pattern is not heard twice), with the notice "Written to the piano
  roll · the 808's own sequencer is off so it isn't heard twice · tap to undo" (the undo restores both) [C, question 2].

### 4.4 Playing notes, recording, bounce

- The track's notes reach the drums through `songEvents` → `Track.noteOn` → §1.4 (unchanged path). With SYNC on and notes in the roll,
  both play (they sum) [C, question 2].
- **D5**: for any plan at swing 50 %, `toNotes` + the song path renders as the sequencer does — bit-identically where the step frames
  are whole numbers, on the same or the next 4-frame grid point elsewhere (both fire at the first span start at or after the same tick;
  the same V; the machine is span-invariant, §2.1). Gate §12.2.
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
  (`{t:'smp'}`, `SxBase.storeAsset`): the drum patch lists its ids in `patch.needs` (models.js:771) and `tables.ensure` delivers them;
  dr-808 reads `SxBase.getAsset(id)` lazily (null → the circuit plays, as if `on` were off).
- **Limits** [C]: ≤ **10 s** per slot (under `LIMITS` 60 s), mono or stereo (stereo plays stereo: the machine's only stereo source),
  ≤ **32 MiB** of worklet entries per machine on touch devices, 64 MiB elsewhere (inside `assets.js`'s 128 / 192 MiB worklet budgets;
  `fits()` refuses beyond with its message).
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
  destructive operations (PATTERN CLEAR, TRACK CLEAR, DEMO, → Piano roll's sync change) get the one-tap undo notice (§3.3).
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
  MULTI OUT jacks, TRIGGER OUT × 3, PEDAL × 2, DIN SYNC) [R RC §13].
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
   m.family === 'drums' }] }`; `CLASSIC` excludes drums (Hardware and Simple list the twelve synths only). A stored view `'drums'` opens
   Drums; the dropdown reads Hardware · Simple · Serum · Drums.
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

- Every **knob** of the 808 is a modulation destination of class **`proc`** (IMPL-2b §5.2): `cv-mods` / `tools/cv-classes.mjs` gain
  `tr808` (the table's keys must equal the non-custom ids); the target is the field path `drum.<lane>.<field>` (`moRec` handles numeric
  field paths, engine.js:1712); `Inst.modSpan(off, setv)` for kind 'drums' applies `setv` only (no slots) and `dm` reads its knob
  fields per chunk. The five switches are `struct` (no modulation). Halos and the press-and-hold menu work through `data-dest` (models.js
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
| `drumSend(tr, dev, at)` | `compilePlan` → if `plan.key` changed or `at` → `postTo(tr, { t: 'seq', s }, dev)`; `persist()` |
| `makeNode` (929) | `seq` for drums: the drum payload |
| the `{t:'step'}` handler (953) | a drum step (`d.m != null`) → `DRUM.step(t, dev, d)` (heard-time LEDs; COMPOSE recording at `s === 0`) |
| transport `play` / `stop` / `reanchor` / the tempo box | synced drum machines need nothing (the worklet derives position from the transport); free machines are untouched by the transport; `setBpm` from TEMPO when synced = the tempo box's path |
| `setTrackModel` | to tr808: `drum` from `normDrum(undefined)` (empty memory, defaults), `drumSend`; from tr808: the machine stops (`allOff`) |
| `keepDevs` (1317) | `if (c.drum && d.model === c.model) d.drum = c.drum;` |
| `voiceInfo` / `trackVoice` / `chordCheck` / `POLY_TO` | §8 item 6 |
| `instUi` / `srcUi` / `cvSetLayout` / the ⋯ Simple item | drums: Hardware only |
| `bounceSet` / `syncedOf` (3608) | §4.4 |
| `importMidiFile` (3558) | §4.5 |
| `userSmps` / `states()` (2041, assets.js) | §5 |
| `panic` / `powerOff` / hidden page / blur | `DRUM.release()` (pads' pointers, a held CLEAR) |
| `__synthTest` | `cv.drum: DRUM` (the sims) |

No `t.model` / `t.vals` / `fxOf(t)` in any new line (the accessor ratchet, IMPL-3 §4.3).

### 10.2 The DSP lists (lane E; every site from the engine map)

`dr-808.js` and `dr-seq.js` join, in this order after `fx-dsp.js` and before `engine.js`: `main.js` `DSP_FILES` (739), `wk.js`
`DSP_GLOBALS` (3151: `Dr808`, `DrSeq`), `smprender.js` (30), `cv-cost.js`'s worker list (279), `tests/golden-harness.mjs` `DSP_V2`
(28), `tests/dsp-scope.mjs` `DSP_TABLE` (39), `tests/bench.html` (64–76); the tests that pin the list (`sx-base.test` 427, `wk.test`
2233, `cv-cost.test` 299 / 305, `bench.test` 117, `pwa.test` 141, `smpgen.test` 371, `integration.test` 675, `main.test` 47,
`app.test` 165); `sw.js` by the lead (`node tools/precache.mjs --write`). `engine.js` looks both globals up lazily (a missing script →
the drum Inst renders silence and posts `drumsErr` once, as the optional-script isolation test expects).

## 11. Lanes and the schedule (the leaner shape)

| lane | phase | owns (exclusive) | tests | model |
|---|---|---|---|---|
| **V** voices | 0 | `dr-808.js` (new), `tests/dr-808.test.mjs` (new), `docs/canvas/research-808-circuits.md` (the component tables, §14 rule) | §12.1 | **standard** (the stage's hardest code) |
| **S** sequencer core | 0 | `drum-core.js` (new), `dr-seq.js` (new), `tests/drum-core.test.mjs`, `tests/dr-seq.test.mjs` (new) | §12.3, §12.4 | standard |
| **E** engine + data plumbing | 1 | `engine.js` (the `kind === 'drums'` branches, `PatchP.drum`, `WARM` append, `restore`, `modSpan` for drums), `models.js` (`tr808`), the DSP lists of §10.2, `cv-cost.js`, `tests/bench-scenarios.mjs` + `tests/bench.json` (targets, rows), `tests/golden-drums.test.mjs` (new; its `ref-7a` is frozen by the lead, §12.2), the golden-graph / integration / smpgen / classic-mod rules of §12.6 | §12.2, §12.5, §12.6 | standard |
| **P1** panel code | 1 | `cv-panel.js` (§7.2–7.3), `cv-drum.js` (new), `tools/panel-check.mjs`, `tests/cv-drum.test.mjs` (new), `tests/cv-panel.test.mjs` | §12.7 | standard |
| **P2** panel data + art | 1 (from P1's first commit: the validator first) | `panels/tr808.js` (new), `panels/index.js`, `cv-art.js` (`SIL` / `DRAW`), `tests/cv-art.test.mjs` | `panel-check tr808`, cv-panel, cv-art | cheaper |
| **H2** data + UI satellites | 1 | `song.js` (normDev, MIDI export), `cv-migrate.js` (schema), `cv-tray.js` (Drums view), `cv-mods.js` + `tools/cv-classes.mjs` (classes), `assets.js` (states), `roll.js` (§4.2), their tests (`song`, `cv-migrate`, `cv-tray`, `cv-mods`, `assets`, `roll`) | §12.6 | standard (roll.js); the rest mechanical |
| **H1** host | 2 | `main.js` (§10.1), `classic-panel.js` (`api().drum`), `tests/canvas-7a-sim.test.mjs` (new, accessor-free), additions to `tests/main.test.mjs`, `tests/classic-panel.test.mjs` | §12.6 | standard |
| reviewers × 2 | 3 | (1) **real engine**: golden harness + `main-sim` with the real Track: D1, D2, D5, D7, every §3.3 row end to end, sync / seek / loop, the circuits against RC's numbers; (2) **headless Chrome** (CDP, `--headless=new --use-angle=metal --force-device-scale-factor=2`, 1440 × 900, 1366 × 1024, 1024 × 1366): the face, LEDs at heard time, pads multi-touch, the grid canvas density, the Drums view, the roll's drum rows, no console errors | — | standard |
| fixers | after | the finding's files, failing test first | | cheaper |

- **Phase 0** (V ∥ S): new files only — they may start beside milestone 3's last phase if the lead has room (the proposal's note; the
  user's answer starts 7a after milestone 3 ships, so by default they start then). Base: `canvas` at this contract's commit.
- **Phase 1** (E ∥ P1 → P2 ∥ H2): after milestone 3's deploy (and 1i, which ships before it); base = that `canvas` commit + V + S merged
  on the holding branch **`wt-7a`**. **E's first commit (E1a) is the `tr808` entry in `models.js`** (§2.3's ids, defaults and `map`) with
  E's own test rules of §12.6 (golden-graph, integration, smpgen, cv-cost); P1, P2 and H2 branch from E1a (the panel validates against
  the model's controls). Until the phase-1 merge, the MODELS-iterating tests that P2 and H2 own (cv-art, cv-mods, cv-tray,
  classic-panel's model loop) fail on the branches that lack the owning lane's change — a known window on `wt-7a`, closed by the merge
  order E → P1 → P2 → H2; each lane runs its own files. **Phase 2** (H1): base = `wt-7a` after phase 1's merge, and the lead's fixture
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
  trig(mask), render(buf, N), post(L, R, mono, n), live(), reset(), mon() }` (V ↔ E); `DrSeq.create(inst)` → `{ set(s),
  events(F), transport(play), release(), run, sync, pos }` (S ↔ E); `drum-core`'s `normDrum`, `press`, `compilePlan`, `toNotes`,
  `vTrig`, `DEFAULT_MAP`, `SOUNDS`, `PERS.tr808` (S ↔ P1 / H1 / H2); `api.drum = { state(), press(input), step(fn) → off, lit(fn) →
  off, pads: { on, off }, popover hooks }` (P1 ↔ H1); `host.drumRows(track)` (H2 ↔ H1).

## 12. Tests and gates

### 12.1 Voices (`tests/dr-808.test.mjs`, lane V; each circuit alone through `Dr808` at 48 kHz × 4 and 44.1 kHz × 2)

- **The two targets for every circuit** (§2.2, RC §14): against **its own analog prototype** (each block's frequency response from
  the chosen component values: centre frequencies ± 1 %, time constants ± 2 %, magnitude ± 0.2 dB to 5 kHz at OS 4) and against **the
  service table** (§2.2's numbers: frequencies ± 8 %, decays measured as the table does — to −20 dB [C] — ± 25 %), at the knob's three
  table positions.
- **BD**: instantaneous frequency (Hilbert, as Werner) at 100 ms near the prototype's centre (≈ 49.5 Hz) at DECAY 5; during the attack
  above 2 × that, for R156 · C38 (4–7 ms); the sigh: the frequency at 20 ms exceeds the one at 250 ms by ≥ 3 Hz [R Werner fig. 11];
  the pulse shaper's falling edge clamps at −0.71 V ± 0.05; DECAY 0 → 10 lengthens the −40 dB time monotonically.
- **Metal bank**: each oscillator's period within 0.1 % of RC §7; duty 47.98 % ± 0.1; the band-passes' centres within 2 % of 3440 /
  7100 Hz at OS 4, 2 and 1 (the prewarp); the bank asleep when no metal voice is live, and a hit after 1.3 s of sleep has the phases a
  free-running bank would have (vs a never-sleeping reference: identical output).
- **Toms / congas**: the pitch falls during the ring (the diode pair): the frequency at 10 ms exceeds the one at 150 ms; TUNING sweeps the
  table's low → high; TOM has PN rumble, CONGA none; a per-hit flip (a note naming the other sound) restrikes the same circuit.
  **RS / CL**: the two tunings and the per-hit flip. **CP**: the envelope has three saw peaks ≈ 10 ms apart and a longer tail.
- **Every circuit**: a retrigger while ringing continues the state (the output differs from a fresh hit's and from a reset-then-hit —
  no machine-gun); **accent is timbre**: the 14 V hit's spectrum, level-normalised, differs from the 4 V hit's (correlation of the
  normalised magnitude spectra < 0.99) for BD, SD, CY, OH, RS; the CH choke (OH −40 dB within its discharge, and an OH hit 100 ms after a
  CH is cut, 200 ms after is not); 44.1 vs 48 kHz frequencies equal within 0.5 %; no NaN / Inf, no denormal (states flushed);
  determinism (two machines, same hits → identical bytes); **span invariance** (the same hits rendered with spans split at 4, 128 and
  random multiples of 4 frames → identical bytes); `noAlloc` over 200 spans with hits; idle: an asleep machine runs no circuit code (a
  counter).

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
  panel, no 2 s silence in the pattern so neither render idle-skips): **bit-identical** over 8 bars synced at 120 BPM / 48 kHz,
  swing 50; at 97 BPM and at swing 62 % every hit fires on the same 4-frame grid point or the next (a hit log from `dm.hit`), and
  aligned at the hits the renders match.

### 12.3 drum-core (`tests/drum-core.test.mjs`, lane S)

`normDrum` (idempotent, every bound, hostile input never throws, size bound); **one test per row of §3.3** through `press` (state +
memory + commands), including the beat-2 quirk, AB from A, intro → A → B, fill every N not counting the intro, TAP fill on top,
CLEAR + N, A / B sharing lengths, COMPOSE record / edit / STOP-as-last / overflow into the next track, PLAY loop; `compilePlan` for
every mode × variation × fill × pre-scale × parts (lengths, offsets, the lcm cycle, mute / solo applied, the content key stable and
sensitive); `toNotes` (positions, primary notes, the switch picks the sound, v 100 / 127, bars, swing rounding); `vTrig` (the table of
§1.3 at 1, 50, 99, 100, 113, 127 and ACCENT 0 / 5 / 10); `DEFAULT_MAP` (unique notes, GM numbers); the constants equal `dr-seq.js`'s.

### 12.4 dr-seq (`tests/dr-seq.test.mjs`, lane S; a fake Inst / Track clock)

Sync: a start at bar 1, bar 9 and mid-measure plays the steps the plan says at the frames the ticks say; seek and a loop wrap; tempo
change mid-measure (positions follow the ticks); stop → silent; free: START from step 1 at the knob's tempo, `pos` advance; `at: 'now'`
keeps the position, `at: 'bar'` swaps at the boundary and re-anchors, `'beat2'`; swing at 50 / 62 / 75 %, triplet scales unswung;
every pre-scale's tick length; the step posts carry the frame; `events(F)` ≥ 1; offline = live (the same frames from the same
transport messages); no allocation in `events`.

### 12.5 Engine (lane E; `tests/engine-track.test.mjs` additions)

A drum Inst from `{t:'patch'}` and from `processorOptions` (live = offline); the 808 on a graphed node (`{t:'seq', i}` and `step` with
`i`); power off stops the sequencer and splits no spans (the 303's test); the co-resident span-grid bound for a neighbour (as the 303's
2e-3); `warmUp` + `restore` leave a fresh machine (a render after equals a fresh processor's); OS change through `osFade` (no click
above −60 dB); `modSpan` with a `drum.bd.dc` row moves the decay; the bench rows of §2.6 (V8 gate; JSC by the lead).

### 12.6 Host, data and the tests that iterate models (H1, H2, E)

- `canvas-7a-sim` (new, accessor-free): a Drums-view tap replaces the instrument; the face renders with `api.drum`; START (synced)
  starts the project; a step key in 1st PART (running) toggles and the posted plan changes in place; CLEAR + 4 sets length 4; the LEDs
  follow `{t:'step'}` at the heard time (a fake audioclock); COMPOSE records three measures; PLAY loops; TAP fill; a pad press posts
  `{t:'on', n: 38, v}` with the touch velocity and lights; MIDI note 36 plays the kick through the worklet; → Piano roll writes the
  notes (v 100 / 127, primary notes), turns SYNC off and its notice's undo restores both; MAP… re-maps snare to 40; a sample loaded
  into SD posts its `smp` entry and `needs`; Save embeds it; a project with an 808 reloads identically; History: an unrelated undo
  keeps the pattern memory; Save as classic project lists the drum track; bounce includes a synced machine with no notes; the Simple
  layout is never offered; `noteOn(NaN)` nothing; panic stops a free-running machine and its START state / LEDs follow; SYNC off +
  START runs the machine alone at its TEMPO while the transport is stopped.
- H2: `song` (normDev keeps `drum`; MIDI export ch 10; import ch 10 → tr808), `cv-migrate` (schema 8: a schema-8 project read-only in a
  schema-7 gate test; STEPS[7] changes nothing stored), `cv-tray` (the Drums view; Hardware / Simple list 12 — its "asserts 12" stays
  true), `cv-mods` (the class table has `tr808`: knobs `proc`, switches `struct`), `assets` (`states()` lists drum slots), `roll` (drum
  rows: names, compact mode, drag between rows, the "other" row, the piano unchanged for synth tracks).
- **Tests that iterate non-custom `MODELS`** (each gets its rule, none is weakened): `golden-graph:23` → `family !== 'drums'` (§12.2);
  `integration:654 / 818` (every model sounds at note 60) → drums sound at note **36**; `smpgen.test:562-575` (farm patches) → drums
  are not farm instruments (filtered, with the reason in a comment); `classic-mod.test` (every control has a target) → the 808's knobs
  have `drum.*` targets; `classic-panel.test:93` → the 808 renders its hardware panel; `cv-art.test` → `SIL` / `DRAW` for tr808;
  `cv-cost.test` → `COST.synth.tr808`; `cv-panel.test` → `HW_IDS` includes tr808, TARGET / PINNED from P2.

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

## 14. Notes (the builders fill in)
