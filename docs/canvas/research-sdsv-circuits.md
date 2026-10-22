# The Simmons SDS-V: what is known of its circuits (appendix to IMPL-8, Part B)

Scope: a research pass for stage "7d + 8" (2026-10-21). Facts about the instrument in our own words; no manual text, no schematic,
no photograph is reproduced or committed. Read with [research-drums.md](research-drums.md) §3 A6 (RD) and [IMPL-8.md](IMPL-8.md)
Part B. Tags as the other circuit appendices: **[R]** a published fact (source in §8), **[R?]** a secondary / reconstructed /
conflicting source or a fact one source gives, **[C]** a choice made for the model (lane V5 may refine a [C] with a reason in IMPL-8
§17, never an [R] without a source).

**The honest state of the documentation.** Unlike the TR-808 (two peer-reviewed analyses) or the TR-909 (service notes read for
values), the SDS-V's own schematic is not reachable from here: the two community copies (a hand-drawn sheet and a service-manual
scan) are referred to as partly illegible and with missing values; the one detailed modern description is a DIY *reconstruction*
of a voice card whose site refused connections during this pass; two commercial emulations describe their own models. What is
solid: the system (modules, rack, mixer, outputs, memories), the six front controls and the eleven internal trimmers of a voice
card (their names), the trigger input levels, the filter chip, the bend direction, the dynamics' targets. So Part B models **the
topology** those facts pin, with **our own component values** fitted to the behaviour they describe — each value tagged [C], each
range a test (§7). If a legible schematic or the reconstruction becomes reachable, lane V5 reads it for values only and records
what it changed in IMPL-8 §17.

## 1. The system [R]

- **1981**, made first by Musicaid (Hatfield, UK) for Simmons; designers Dave Simmons and Richard James Burgess [R wiki]. The first
  widely used electronic drum kit; hexagonal pads [R wiki, RD].
- **The brain**: a 19-inch rack box, about **19 × 6 × 7 in** (W × H × D) [R mus83], holding **up to seven drum-sound modules plus
  an output mixer** [R mus83, mx11]. The standard kit fills **five: bass drum, snare drum and three toms** [R wiki, mus83]; a
  **hi-hat** and a **cymbal** module were optional and sold separately [R wiki, mus83]; owners also fitted extra bass or tom cards
  (listings with two bass drums, or four toms) [R mx11, mx14].
- **Memories**: **four sounds per module** [R wiki, mus83, jan81]: one **factory** sound set on the card's internal trimmers and not
  adjustable from the front, **one set by the front knobs**, **two set by rows of small front trimmers** (screwdriver) [R mus83,
  mx11 — mx11: "1 internal trimpots, 2 knobs, 3 and 4 front trimpots"]. Recalled by **four square push-buttons on each module**
  [R mx11b]; the 1981 prototype review places them in a square with the factory one top left [R? jan81: a prototype].
- **Mixer section**: per channel a **pad sensitivity** and an **output level** [R mus83, wiki]; a stereo balance per voice is an
  internal trimmer (R28) [R lon]; mix channel levels act on the mix outputs only [R lon].
- **Outputs**: an individual output per channel (low impedance, mic level), a **pre-panned stereo pair** and a **mono mix**
  (line level) [R mus83, lon]; balanced XLR throughout [R wiki, hollow].
- **Inputs**: seven pad inputs, a hi-hat pedal input and a **trigger input per channel** (a sequencer, e.g. the SDS-6, or audio)
  [R mus83, wiki].
- **Pads**: hexagonal; the first production ones hard polycarbonate / perspex over a piezo pickup [R wiki, mus83]; the prototype
  review describes 11-inch pads and a 22-inch bass pad [R? jan81]; rubber pads came with later models [R wiki].

## 2. A voice card (bass, snare, tom)

### 2.1 Controls [R]

The six front controls, in the order the reviews give them [R mus83, jan81, wiki]: **NOISE** (the noise's pitch — "hiss pitch"),
**TONE** (the oscillator's pitch), **BEND**, **DECAY**, **NOISE / TONE** (the balance), **CLICK / DRUM** (the balance of the attack
click against the drum). The cards look alike; each card's ranges are tuned to its drum [R hollow].

The **eleven internal trimmers** of a voice card [R lon]: the factory memory's six (noise pitch R18, tone pitch R17, bend R1, decay
R5, click balance R13, noise / tone balance R9) and five that voice the card for every memory: **left / right balance** R28,
**filter Q** R27, **filter dynamic sweep** R25, **noise generator gain** R71, **snare oscillator modulation depth** R26.

### 2.2 Topology

| block | what is known | tag |
|---|---|---|
| trigger input | pad input: a pad gives at most ≈ 0.075 V; the input accepts 0.005–1.5 V (4.7 kΩ); the sequencer input 1–15 V (1 MΩ) | [R lon] |
| sensitivity | the mixer's SENSITIVITY; raising it **reduces the dynamic response** (a steady sound for less effort) | [R mus83] |
| dynamics | the hit's strength reaches the sound: **the noise pitch on bass and toms**, **the bend on toms**; the attack click from the hit | [R lon; R hollow] |
| timing | CD4528 dual monostables (fixed-length gates from the trigger) | [R? hexa] |
| oscillator | one VCO with a **triangle** core and a **passive low-pass** after it, giving nearly a sine; one source calls it a sine | [R? sj, msp; hise] |
| bend | a pitch sweep **downward** after the hit, its depth set by BEND (upward bend is a later model's) | [R? ajl] |
| noise | a **transistor junction noise** source → an op-amp gain (R71) | [R? gs] |
| filter | an **SSM2044** 4-pole (24 dB / octave) low-pass on the noise; its output is the body (the snare) or the click; resonance usually none on bass / toms, some on the snare (R27) | [R lon; R? ajl, sj] |
| VCAs | three CA3080-type OTAs | [R? sj] |
| envelopes | four envelope generators, simple attack / release types; one depends on the trigger's length (a later clone made it independent) | [R? sj, roz] |
| LFO | one triangle-core LFO (on the reconstruction's block list; the snare's oscillator modulation R26 is the trimmer we know) | [R? sj; R lon] |
| decay | up to about **5 s** | [R simm: an SDS7 card modified to reach the SDS-V's decay] |
| output | the voice at its level into the mono mix and, through its balance trimmer, the stereo pair | [R lon] |

### 2.3 Our reading, as modelled (all values [C] unless tagged)

The model's signal flow per channel (one monophonic voice, as the card):

```
 hit v127 ─▶ pad volts v_p ─▶ SENS gain + limiter ─▶ comparator ─▶ gates (trigger, click)
                                   └─▶ peak hold V_D (the hit's dynamics)
 TONE + BEND·EG_P (+ toms: k_b·V_D) ─▶ triangle VCO (reset at the hit) ─▶ passive RC² ─▶ VCA_T (EG_T) ─────┐
 noise ─▶ gain ─▶ SSM2044 4-pole LP (NOISE + sweep·V_D·EG_N (bass, toms) , Q) ─┬▶ VCA_N (EG_N) ─────┤ NOISE/TONE ─▶ drum ─┐
                                                                              └▶ VCA_C (EG_C)  ─────────────── click ──┤ CLICK/DRUM ─▶ LEVEL ─▶ mono mix
```

- **Pad volts** [C on R]: `v_p = 0.005 · 15^((v − 1) / 126)` V (v 1 → 0.005 V, the input's floor; v 127 → 0.075 V, a pad's peak).
- **Sensitivity** [C on R]: gain `G = 20 · 10^(1.5 · s)` (s 0…1: ×20 … ×632), then a soft limiter `V_D = V_L · tanh(G · v_p / V_L)`,
  `V_L` 10 V: at SENS 5 (×112) v 127 reaches 0.68 of `V_L` and v 40 0.13; at SENS 10 v 40 already 0.62 and v 127 1.00 (a ratio of 1.6 against 5.3) — the reduced dynamics
  the review describes. The comparator fires above 0.2 V — a threshold: at SENS 0 nothing below v 34 fires, at SENS 1 below v 18,
  at SENS 2 below v 2, above SENS ≈ 2.01 every velocity (IMPL-8 review #15; checked: the ratios above and §5's 6.3 / 2.8).
- **V_D** sampled at the hit (a peak detector: the envelopes start from levels it sets, so it never shortens a long decay; a
  retrigger takes the new hit's). It scales the envelopes' peaks **once** — the VCAs read the envelopes (an earlier draft of the
  diagram also multiplied the VCAs by V_D: a level ∝ V_D²; IMPL-8 review #25).
- **EG_T** (tone VCA): attack 0.5 ms to a peak ∝ V_D, then an exponential decay whose time to −60 dB is DECAY's: `T60 = 0.03 ·
  167^d` s (d 0…1: 30 ms … 5 s, the [R] 5 s), τ_T = T60 / 6.91; a retrigger restarts the attack from the level it is at.
  **EG_N** (noise VCA): τ_N = 0.6 · τ_T. **EG_P** (bend): τ_P = 0.3 · τ_T, capped at 400 ms. **EG_C** (click): a 4 ms gate from the
  monostable, 1 ms release (the gate's length one of the trigger's: an external trigger's is shorter — not modelled: every hit is a
  pad's).
- **VCO**: an integrator charged by the exponential converter's current, reversed by a comparator at ± 5 V (the 909 lane's triangle
  state machine, dr-808.js `Tom9` 2829: the corner reflected inside the sample — exact in position; a sampled ideal triangle),
  **reset to its lower peak at each hit** (a consistent attack; the card's behaviour unknown, [C]); pitch `f = f_TONE · 2^(BEND_oct
  · EG_P (+ toms: 0.5 · V_D / V_L))`; then two passive RC sections at 1.5 · f_TONE's range top (fixed per card: the triangle's 3rd
  harmonic, −19.1 dB raw, at −30 dB at TONE 10 and −20 … −21 dB at TONE 0 — a near-sine at the top of the range only). **Aliasing**
  (IMPL-8 review #12, `scratchpad/8/rev/tri-alias.mjs`): unbent at ≤ 520 Hz the sampled triangle's aliases below 20 kHz sit at
  −87 dB (OS 2) / −101 dB (OS 4) re the fundamental, but the bend lifts a tom up to 2.5 octaves at the hit (≈ 2.9 kHz on tom 1):
  raw −57 / −71 dB, and after the RC² — which cuts the bent fundamental (−23 dB at 3.8 × its corner) more than a low alias — the
  strongest is −46 / −55 dB re the tone. IMPL-8 §15.1 gates ≤ −60 dB at OS 4; a 2-point polyBLAMP at each corner (its fractional
  time is the reflection's) is V5's means.
- **Snare oscillator modulation** (R26): a 31 Hz triangle LFO moving the snare's VCO by ± 2.5 % (a slight shell roughness); 0 on
  the other cards [C on R? — the trimmer exists; what feeds it is not known here].
- **Noise**: dr-808.js's hashed white noise (a function of the absolute sample, salted; RD / IMPL-7a §2.1) — one stream for the
  machine, each card reading it at its own offset (independent channels) [C].
- **SSM2044**: a 4-stage OTA cascade with a saturating feedback (tanh per stage), zero-delay solved per sample — the method of
  engine.js `Ladder` (OTA branch, 110–164), re-written inside dr-808.js (an engine class is out of the machine's scope); cutoff
  exponential in its control: `f_c = f_NOISE · 2^(sweep · V_D / V_L · EG_N)` on bass and toms (the [R] dynamic noise pitch), sweep
  1.5 octaves (bass), 2 (toms), **0 on the snare** (the [R lon] statement names bass and toms only; an earlier 0.7 contradicted it —
  IMPL-8 review #25); f_c clamped at 0.46 of the OS rate (the engine's `gMax`: tom 1's 6 kHz × 2² = 24 kHz is past Nyquist at OS 1,
  44.1 kHz); Q: 0 on bass and toms, k 2.2 on the snare (below oscillation).
- **VCAs**: OTA law `y = I · tanh(x / (2 V_T))` with the input attenuated to ± 30 mV at full scale (a gentle compression of the
  hardest hits) [C].
- **Mix**: NOISE / TONE an equal-power crossfade (m 0: tone only); CLICK / DRUM likewise (c 0: drum only); the channel's LEVEL an
  audio-taper pot; mono sum (the stereo trimmer's pan ignored: the mix output, IMPL-8 D3).

### 2.4 Per card ranges (the cards "tuned to their drum") [C]

| card | TONE (Hz, 0 … 10) | NOISE f_c (Hz) | BEND (octaves at 10) | DECAY (T60) | Q | sweep (oct) | snare mod |
|---|---|---|---|---|---|---|---|
| bass drum | 30 – 120 | 60 – 3 000 | 0 – 1.5 | 30 ms – 5 s | 0 | 1.5 | 0 |
| snare drum | 110 – 440 | 300 – 12 000 | 0 – 1 | 30 ms – 5 s | 2.2 | 0 | ± 2.5 % |
| tom 1 (high) | 90 – 520 | 150 – 6 000 | 0 – 2 | 30 ms – 5 s | 0 | 2 | 0 |
| tom 2 (mid) | 65 – 380 | 120 – 5 000 | 0 – 2 | 30 ms – 5 s | 0 | 2 | 0 |
| tom 3 (low) | 45 – 260 | 90 – 4 000 | 0 – 2 | 30 ms – 5 s | 0 | 2 | 0 |

TONE and NOISE exponential over their knob, BEND linear in octaves, DECAY as §2.3. **Factory memories** (memory 1) are our own
sounds [C] (IMPL-8 §11.5): a round kick with a short noise thump, a snare with a bright resonant noise body, three toms with the
deep downward sweep the instrument is known for; V5 tunes them by ear and the listening renders go to the user before the freeze.

## 3. The hi-hat and cymbal cards (optional on the original; not in this stage)

Digital: an **8-bit** EPROM (a 2732) holding a metallic waveform taken from a recorded cymbal, read **forwards then backwards in a
continuous loop** by a 555 clock and CD4516 counters (a CD4013 switching the direction), a linear 8-bit DAC, then gated by a VCF and
a VCA (so the decay can be long); bending the clock and filtering give the sweeps; the hi-hat's open / closed from a pedal [R simm,
ajl, wiki]. **Someone else's recording**: never used, fetched or approximated (IMPL-8 D4). If the user wants them later: our own
looped metal through this loop circuit — the TR-909's approach (IMPL-7c §2.4) [C, IMPL-8 §16 Q7].

## 4. The panel (layout facts; our own art)

- 19-inch rack box ≈ 482.6 × 152.4 mm face [R mus83 (19 × 6 in)]; seven module slots and the mixer [R]; the knobs, the four memory
  keys and two trimmer rows on each module [R mx11, mus83]; the per-channel trigger and output sockets are rear XLRs [R].
- No photograph of the brain's face was viewable here (RD §3 A6: none on Commons): lane X reads published photographs (viewing
  only, layout facts) and records the mm in `panels/sdsv.js`'s notes; IMPL-8 §13.1 gives the fallback layout [C].
- The maker's name and logo: never drawn (D4); the face's title "SDS-V" small plain type, the TB-303 / 606 / 909 precedent.

## 5. Behaviour the tests pin (targets for lane V5)

- (a) Each block against its own prototype: the passive RC², the OTA cascade's small-signal response (± 0.2 dB to 5 kHz at OS 4,
  the 4-pole slope, Q's peak), the VCO's frequency against its control (± 1 %), the envelopes' τ (± 2 %).
- (b) The described behaviour: the downward bend (the pitch at 5 ms above the pitch at 200 ms, monotone in BEND, none at 0); harder
  hits raise the noise's centroid on bass and toms and the bend on toms, not on the snare's tone; SENSITIVITY compresses dynamics
  (the V_D ratio of v 127 to v 40 is 6.3 at SENS 2 and 2.8 at SENS 8; the sounding level ratio at SENS 2 ≥ 1.8 × the one at SENS 8); DECAY 10 decays to −60 dB in 5 s ± 15 % (the [R] 5 s);
  NOISE / TONE and CLICK / DRUM silent ends (m 0: no noise; c 0: no click); the four memories distinct and the knobs acting only on
  memory 2 (the card's, [R mus83, mx11]).

## 6. What the build lane pins (V5)

Every [C] value of §2.3–§2.4 (the component analogues it chooses, the fitted constants), recorded in IMPL-8 §17 with the bench and
the listening notes; any value read later from a legible schematic or the reconstruction, with its source.

**The values as modelled** (lane V5, 2026-10-21; dr-808.js `CV`, `FACTV`, `TRIMV` and the SDS-V constants; `Dr808.proto.sdsv`).
No schematic value was read: every row is [C] (fitted to §5's targets or chosen), none is [R] beyond what §2 tags. Tested in
`tests/dr-sdsv.test.mjs`.

| block | as modelled | tag / where it differs from §2.3 |
|---|---|---|
| trigger | `v_p = 0.005 · 15^((v − 1)/126)` V; `G = 20 · 10^(1.5 s)`; `V_D = 10 · tanh(G v_p / 10)` V; fires when V_D > 0.2 V — the lowest velocity that fires: SENS 0 → 34, 1 → 18, 2 → 2, from 2.1 → 1 (`minVel`); V_D at SENS 5: v 40 1.29 V, v 100 4.40 V, v 127 6.88 V | [C] as §2.3 |
| gates | the attack's monostable 0.5 ms, the envelopes charging toward V_D through 0.1 ms from the level they are at (99.3 % at its end); the click's 4 ms; counted in OS samples from the hit's chunk | [C] (the gates' "per chunk": the hit's chunk; their lengths in samples) |
| EG_T / EG_N / EG_P / EG_C | τ_T = T60 / ln 1000, `T60 = 0.03 · 167^DECAY` (30 ms … 5.01 s); τ_N = 0.6 τ_T; EG_P set to 1 at the hit, τ_P = 0.3 τ_T (≤ 0.22 s: the 0.4 s cap never binds); the click's release τ 1 ms | [C] as §2.3; EG_P's charge instant [C] |
| VCO | a triangle ± 1 reset to its lower peak at the hit (rising), each corner reflected at its time and rounded by a 2-point polyBLAMP (u³/6 before, (1 − u)³/6 after; one sample late); the pitch per chunk, linear within it | [C]; aliases (the bent worst case, the first 20 ms, OS 4): −107 dB re the tone (uncorrected −68) |
| bend | f = f_TONE · 2^(BEND_oct · EG_P), toms × (1 + 0.25 · V_D / 10) — at BEND 10 and V_D 10 the contract's 2.5 octaves (tom 1 at TONE 10: 2.94 kHz) | [C] refined: §2.3 added 0.5 · V_D / 10 octaves outside BEND; scaled by BEND so BEND 0 bends nothing (§5 "none at 0") |
| snare mod | a 31 Hz triangle, ± 2.5 %, free-running on the absolute time | [C on R? R26] |
| RC² | two first-order sections at 1.5 × the card's top (bass 180, snare 660, tom 1 780, tom 2 570, tom 3 390 Hz): the 3rd harmonic −29.9 dB at TONE 10, −20.8 (bass) / −20.0 (toms) dB at TONE 0 | [C] as §2.3 |
| noise | each card its own stream (its salt; hash32 of the absolute OS sample, the Irwin–Hall of two 16-bit uniforms), 0.5 rms in 0–20 kHz in the SSM2044's 2 V_T; a 20 kHz first-order pole (the noise amplifier's) above 60 kHz; a wake settles the path over the 12 ms before from rest; the path runs while it can be heard | [C] (one stream a card; two uniforms, not four: Gaussian behind the filters) |
| SSM2044 | 4 OTA stages, tanh secants (Padé), TPT, g = tan(π f_c / fs), f_c clamped at 0.46 · fs; f_c = NOISE · 2^(SW · EG_N / 10): SW 1.5 (bass), 0 (snare), 2 (toms); the snare's k 2.2 (its peak ≈ 9 dB over its passband), its feedback saturation 0.25; the secants at the prediction 2s − y (the Ladder's), on the snare's one pass at the sample before's (its cost: −39 dB re the output against the exact solve, the fresh −50), its feedback's saturation and 1 / (1 + k Gt) a sample behind | [C]; the small-signal response = 1 / ((1 + s/ω)⁴ + k) within 0.01 dB |
| VCAs | `I · tanh(x · 0.03 / 2V_T)` (± 30 mV full scale): the tone's by its series, the noise's / click's (the same filtered noise) by its series below 0.8, the Padé above | [C] as §2.3 |
| balances, LEVEL | equal-power (sin of the knob's quarter-turn: exact zeros at the ends); LEVEL the shell's audio taper (`tapA`: LEVEL 7 → 0.244) | [C] as §2.3 |
| the cards' scaling | the filtered noise into its VCAs' input × NP (inside their tanh: a loud noise limits): bass 4.5, snare 3, toms 3 / 3.2 / 3.6 (at mid NOISE the noise peaks about the tone's); each card's output G (V at full bias, LEVEL 10): bass 11, snare 4.8, tom 1 7.6, tom 2 7.7, tom 3 9.0 — at the factory sounds, v 100: snare +0.9 dB, toms −0.6 dB re the bass | [fit] the cards' balance |
| output | the mono sum; its coupling 3 Hz; the mix amplifier's rails (± 13.5 V, the 808's knee); OUT_KV 0.67 (the bass's memory 1 at v 100, SENS 5, LEVEL 7 → +0.46 dB re the 808's default BD through the whole Track, the dvp groove's RMS −0.36 dB re the 808's default groove, ≥ 0.6 dB under the track limiter at 48 / 44.1 kHz × 4 / 2 / 1 — lane E5, engine-track; V5's 0.732 matched the BD on the machine alone but was +1.2 dB through the Track and the groove reached the limiter at OS 2 / 1) | [fit] IMPL-8 §12.4 |
| your own sounds | 7a's law over V_D: proportional below VK_V 4.40 V (v 100, SENS 5), + 0.6 at the limit; a full-scale sample at LEVEL 10 = 2.4 V on the bus (the bass's peak there) | [C] |

**The memories** (knob units 0…10; ours, [C]): memory 1 (`FACTV`, the knobs' defaults) and the default trims (`TRIMV`, memories
3 and 4 until a payload's arrive — the record's defaults, drum-core's):

| card | memory 1 (factory) | memory 3 | memory 4 |
|---|---|---|---|
| bass | NOISE 3 (194 Hz) · TONE 4.2 (54 Hz) · BEND 4.5 (0.68 oct) · DECAY 4.2 (0.26 s) · N/T 2.2 · C/D 2.5 | 2 · 2.5 (42 Hz) · 7 (1.05 oct) · 6.5 (0.84 s) · 1 · 1.5 | 5 · 5 (60 Hz) · 3 · 2.5 (0.11 s) · 3.5 · 5 |
| snare | 6.2 (2.95 kHz) · 4.5 (205 Hz) · 2.5 (0.25 oct) · 3.8 (0.21 s) · 6.2 · 3 | 4.5 · 3.5 (179 Hz) · 4 · 4.5 (0.30 s) · 4 · 2 | 8 (5.74 kHz) · 6 (253 Hz) · 1.5 · 2.5 (0.11 s) · 7.5 · 5 |
| tom 1 | 3 (454 Hz) · 4.2 (188 Hz) · 6 (1.2 oct) · 6 (0.65 s) · 1.5 · 2.5 | 2 · 3.5 (166 Hz) · 8.5 (1.7 oct) · 7 (1.08 s) · 0.5 · 1.5 | 4.5 · 5.5 (236 Hz) · 3 · 3 (0.14 s) · 3 · 4 |
| tom 2 | 3 (367 Hz) · 4.2 (136 Hz) · 6 · 6.2 (0.72 s) · 1.5 · 2.5 | 2 · 3.5 (121 Hz) · 8.5 · 7 (1.08 s) · 0.5 · 1.5 | 4.5 · 5.5 (172 Hz) · 3 · 3 (0.14 s) · 3 · 4 |
| tom 3 | 3 (281 Hz) · 4.2 (94 Hz) · 6 · 6.5 (0.84 s) · 1.5 · 2.5 | 2 · 3.5 (83 Hz) · 8.5 · 7.2 (1.20 s) · 0.5 · 1.5 | 4.5 · 5.5 (118 Hz) · 3 · 3.2 (0.15 s) · 3 · 4 |

Memory 1: a round kick with a short noise thump, a snare with a bright resonant noise body, three toms with the long downward
sweep; memory 3: a deep long sweep (bass), a fat snare, electro toms; memory 4: a short punch, a crack, tight toms. Every one is a
retune candidate at the listening gate (IMPL-8 §14.3).

## 7. CPU (estimate)

Per card at OS 4, one sounding: the VCO, the OTA cascade (two iterations a sample, as `Ladder`), three VCAs, four envelopes ≈ the
909's analog circuits (IMPL-7c §14: 0.0016–0.0056 each) — ≤ **0.004** [C]; asleep below 1e-5 of the card's scale for 4 chunks
(7a's rule) [C].

## 8. Sources

- [R wiki] Wikipedia, "Simmons SDS-V" (https://en.wikipedia.org/wiki/Simmons_SDS-V): year, maker, five standard modules, optional
  hi-hat and cymbal, the six controls, four adjustable presets, pads, XLR outputs, trigger inputs.
- [R mus83] *Music UK*, September 1983, review "Simmons SDS 5 Electronic Drums Kit & SDS 6 Sequencer" (muzines.co.uk article 12013):
  rack size and capacity, the controls in order, the memories (one factory, two trimmer rows, one knob set), sensitivity, outputs,
  inputs, the cymbal modules sampled.
- [R? jan81] a January 1981 review of the prototype, reposted on the Simmons Museum blog (blog.simmonsmuseum.com, April 2013): the
  control names (hiss pitch, tone pitch, bend, decay, balance, click balance), the four memory buttons in a square.
- [R lon] snw.lonningdal.no/sds5.php (a restorer's notes): the SSM2044 4-pole, the trigger input table, "trigger voltage affects the
  noise pitch on bass and toms and the bend on toms", the eleven internal trimmers by reference, outputs and the stereo trimmer.
- [R mx11 / mx11b / mx14] matrixsynth.com listings (2011-05, 2011-02, 2014-11): memories 1 internal / 2 knobs / 3–4 front trimmers,
  the four square buttons on each module, cards fitted.
- [R hollow] hollowsun.com nostalgia SDS5 page: the triangle oscillator + noise per module, cards tuned to their drum, the click
  from the pad's velocity, XLRs.
- [R? msp] a Music Swop Shop listing (musicswopshop.com.au, "Simmons - SDSV"): a variable triangle-wave oscillator with pitch and bend,
  a noise generator, an SSM2044 4-pole filter shaping the white noise.
- [R? sj] SyntherJack's SDSV DIY reconstruction (syntherjack.net; site unreachable in this pass — its block list as quoted in
  search summaries: 4 EG, 3 CA3080 VCAs, one VCO with triangle and filtered-triangle outputs, a triangle LFO, a noise generator, the
  SSM2044 as body or click, the schematics' errors); [R? roz] Timo Rozendal SDSV+ (modulargrid.net): one envelope made independent
  of the trigger length.
- [R? ajl] Aly James Lab VSDSX pages (alyjameslab.com): the SSM2044 on noise and click, resonance on the snare, bend down only on
  the SDS-V, the click from the trigger circuitry, the hi-hat / cymbal cards' EPROM loop (2732, 555, CD4516, CD4013, 8-bit DAC) —
  an emulator's description, facts only.
- [R? hexa] Morphoice HexaDrum page: oscillators, SSM2044, OTA VCAs, CD4528 monostables (an emulator's statement).
- [R? hise] HISE forum (a sine and a noise oscillator, the SSM2044); [R? gs] a repair thread summary (the transistor noise → op-amp
  → SSM2044 → balance pots); [R simm] the Simmons Museum blog (?p=130): the cymbal card's EPROM loop; the 5 s decay remark.
- Web MIDI facts for IMPL-8 §8: caniuse.com/webmidi (Safari / iOS: none), WebKit bug 107250 (open).
