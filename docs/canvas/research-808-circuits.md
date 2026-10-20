# The TR-808's circuits, sequencer and panel — research appendix to IMPL-7a

Facts for the stage 7a build lanes (cited from [IMPL-7a.md](IMPL-7a.md) as **RC §n**). Everything is paraphrased in our own words:
circuit topologies, component values, frequencies and behaviours are facts; no manual or service-note prose is reproduced, no schematic
is redistributed, no recording is used. Gathered 2026-10-20 from the sources of §0; [research-drums.md](research-drums.md) is the wider
survey.

Tags: **[P]** primary (peer-reviewed paper, Roland manual / service notes); **[S]** reputable secondary (Sound On Sound, a named
expert, an open-source reimplementation); **[W]** weak (fan pages, aggregators); **[R?]** in IMPL-7a = anything not [P], to be pinned by
lane V from the schematic (§14).

## 0. Sources

- **DAFX** — K. J. Werner, J. S. Abel, J. O. Smith, "A physically-informed, circuit-bendable, digital model of the Roland TR-808 bass drum
  circuit", DAFx-14 [P]: https://dafx14.fau.de/papers/dafx14_kurt_james_werner_a_physically_informed,_ci.pdf
- **ICMC** — the same authors, "The TR-808 cymbal: a physically-informed, circuit-bendable, digital model", ICMC|SMC 2014 [P]:
  https://speech.di.uoa.gr/ICMC-SMC-2014/images/VOL_2/1453.pdf ; companion pages with the tone-stage coefficients and audio:
  https://ccrma.stanford.edu/~kwerner/papers/icmcsmc2014.html , https://ccrma.stanford.edu/~kwerner/papers/dafx14.html
- **AES** — Werner et al., the cowbell (AES 137th, paper 9207; abstract only): https://aes2.org/publications/elibrary-page/?id=17530 ;
  Werner's dissertation (the BD as its running example): https://purl.stanford.edu/jy057cz8322
- **M** — the TR-808 operation manual, archive.org OCR [P]:
  https://archive.org/download/synthmanual-roland-tr-808-owners-manual/rolandtr-808ownersmanual_djvu.txt
- **SN** — the TR-808 service notes (1st ed., 15 June 1981), archive.org OCR [P]:
  https://archive.org/download/synthmanual-roland-tr-808-service-notes/rolandtr-808servicenotes_djvu.txt and ManualsLib's OCR
  (https://www.manualslib.com/manual/1217113/Roland-Tr-808.html: p.1 specifications, pp.4–6 circuit descriptions, p.14 typical values
  and adjustments, p.15 design changes, p.16 parts list). The OCR is noisy; the "typical values" table's columns are partly misaligned.
- **SCH** — the voice schematic as published scans (e.g. https://synthfool.com/docs/Roland/TR_Series/TR808/TR-808_Schematics.pdf),
  read by eye for component values [P-sch: any single value may be misread; "calc" = our arithmetic on those values]
- **NG** — Norgatronics' 808 notes (snare variants, accent): https://norgatronics.blogspot.com/2021/11/808-snare-mutations.html ,
  https://norgatronics.blogspot.com/2024/05/8081-accent.html [S]; **BT** — Baratatronix's 808 synthesis notes (toms, clap, cymbal /
  hats): https://www.baratatronix.com/blog/808-tom-synthesis , …/cascadia-808-clap-synthesis , …/cascadia-808-cymbal-hi-hat-synthesis
  [S]; **SJ** — syntherjack's rim shot / claves note: https://syntherjack.net/the-perfect-808-rimshot-clave/ [S]; **N8** — n8synth's
  808 snare: https://www.n8synth.co.uk/diy-eurorack/eurorack-808-snare/ [S]; **SOS** — Gordon Reid's Synth Secrets (snare, cowbell)
  [S]; **SL** — https://secretlifeofsynthesizers.com/the-strange-heart-of-the-roland-tr-808/ (the noise transistor) [S]
- **IO** — io808 (a web reimplementation of the original workflow): https://io808.com/tutorial , https://github.com/vincentriemer/io-808 [S]
- **T8** — Roland's TR-08 manual (a 2017 replica of the workflow; weaker evidence for the 1981 unit) [P-TR08]; **SOS93** — Sound On
  Sound, Feb 1993, hands-on TR-808: https://www.muzines.co.uk/articles/hands-on-roland-tr808-drum-machine/10495 [S]
- **WH** — Robin Whittle's TR-808 modification pages: http://www.firstpr.com.au/rwi/tr-808/ [S]
- **FAN** — a Japanese fan page citing the service manual's tuning chart: https://scrapbox.io/0b5vr/TR-808 [W]

## 1. The trigger bus and accent

- The CPU (µPD650C-085) produces a timing signal and an accent signal combined into a **common trigger** whose ON voltage is set by the
  global ACCENT level (VR3); each voice ANDs its own instrument-data line with it, giving a **1 ms** pulse at that height [P DAFX §3, ICMC §5].
- The CPU's ≈ 10 µs step pulse is stretched to **≈ 1 ms** by a monostable (IC6, TC4011B; the width = R100·C23 + R102·C27); a width far
  from 1 ms degrades the voices [P SN p.4, p.14]. Each voice ANDs its instrument-data line with the common trigger through an NPN + PNP
  pair (SD Q45/Q46, LT Q50/Q51, RS Q59/Q60, CP/MA Q28/Q29 …); there is no per-voice latch IC [P-sch].
- Accent stage Q31–Q34: unaccented, Q34 shunts the ACCENT pot (VR3, 10 kΩ B) and the trigger is ≈ **4 V**; accented, VR3 sets
  5–15 V at Q32's base, i.e. a trigger of ≈ **4–14 V** (the spec's "0–10 dB" accent range; 4 → 14 V is +10.9 dB) [P SN p.1, p.4]. WH
  gives 5 V unaccented / 5–14 V accented [S]; NG ≈ 4 V / 5–15 V [S] — IMPL-7a uses 4 V and 4–14 V. Every voice's amplitude is
  proportional to the trigger's [P SN p.4]; the accent / normal ratio differs per voice (typical Vp-p normal / accent: BD 3.5 / 10, SD
  3 / 10, toms 3–3.5 / 10–12, CB 3.5 / 12, CY and OH 3.5 / 7, CH 3 / 6, MA 3 / 5, RS 3 / 10, CL 2.5 / 8) [P SN p.14].
- The metal voices (CB, CY, OH, CH) take a **buffered** common trigger narrowed to **7–14 V** [P ICMC §5, SN].
- Accent changes **timbre** through the nonlinear stages downstream (the BD's pulse shaper and Q43, the cymbal's attack smoother,
  envelopes and swing-type VCAs), not only level [P DAFX, ICMC].
- Trigger outputs (rear): CB, CP (or MA), AC: +15 V, 20 ms, 1 kΩ; they follow the pattern regardless of the voice LEVEL [P M, SN].

## 2. Bass drum [P DAFX]

Blocks (the paper's partition; values from the schematic, §14):
1. **Trigger logic** (Q39, Q40, R152–R155): ANDs the BD data line with the common trigger → a 1 ms pulse of 4–14 V.
2. **Pulse shaper**: a passive low shelf (R162, R163, C40) followed by a diode (D53) that clamps the falling edge at about one diode
   drop below ground. As a transfer function `(b1 s + b0) / (a1 s + a0)` with `b1 = a1 = R162 R163 C40`, `b0 = R162`, `a0 = R162 + R163`
   (DC gain `R162 / (R162 + R163)`); the diode as a memoryless map that leaves positive voltages alone and limits negative ones to
   ≈ −0.71 V. The rising edge kicks the resonator with the full trigger height, the falling edge with about
   `V · R162 / (R162 + R163) + 0.71`.
3. **Bridged-T network** in the negative feedback path of one half of a µPC4558: a band-pass with capacitive arms (C41, C42) and
   resistive bridge / ground path (R167, R_eff). Driven by three inputs: the shaped pulse, the feedback buffer's output (through R170)
   and the retrigger pulse (through R161). The core response `(b2 s² + b1 s + b0) / (a2 s² + a1 s + a0)` with `b2 = a2 = R_eff R167 C41 C42`,
   `b1 = R_eff C41 + R167 C41 + R_eff C42`, `a1 = R_eff (C41 + C42)`, `b0 = a0 = 1`; from the feedback input `b1 s / (a2 s² + a1 s + a0)` with
   `b1 = Rk R167 C41`, `a2 = Rk R167 C41 C42`, `a1 = Rk R170 (C41 + C42)`, `a0 = Rk + R170`, `Rk = R161 ∥ (R165 + R166)`; from the
   retrigger input the same with R161 and R170 exchanged. Centre `fc = 1 / (2π √(R_eff R167 C41 C42))` ≈ **49.5 Hz** with the stock
   values; Roland's tuning chart says **56 Hz**.
4. **Feedback buffer** (the other op-amp half): a high shelf `(b1 s + b0) / (a1 s + a0)`, `b1 = R169 · VR6k · C43`, `b0 = R169`,
   `a1 = R164 (R169 + VR6k) C43`, `a0 = R164` (VR6k = the DECAY pot's resistance at its position). Less attenuation → longer decay.
   The bridged-T ↔ buffer loop is delay-free: the paper breaks it with one sample of delay after the buffer.
5. **Envelope / attack** (Q41, Q42, Q43, C38, R156): the trigger also fires an envelope whose output stays high until ≈ **5 ms** after
   the pulse ends; while high, Q43 grounds its collector so R_eff drops from R165 + R166 to R166 — centre frequency and Q rise by more
   than an octave for ≈ **6 ms** (shorter than one period at the raised frequency): the "punch". A retrigger pulse (C39, R161, D52: a
   high-pass with a diode clipper) is injected so the amplitude does not jump when the network returns to its normal tuning.
   **Durations**: the service notes say the attack lasts ≈ 4 ms [P SN p.5]; Werner ≈ 6 ms and a replica measured at 6.2 ms (the
   Wolfram article, RD §2.1) [S]. **Correction (IMPL-7a review §15 #9)**: R156 (1 MΩ) · C38 (0.1 µF) is **τ = 100 ms**, not ≈ 4 ms
   (an earlier reading of this appendix multiplied wrongly) — the 4–6 ms is how long C38, charged during the 1 ms trigger, takes to
   discharge through R156 below Q43's turn-on, a threshold crossing early on a 100 ms decay. If a re-read finds other values, the
   duration still comes from the network (charge path, R156 · C38, Q43's V_BE), never from the product alone. The model uses the
   component values; the attack lasts what the network gives (4–7 ms is the test band). **Lane V's reading (2026-10-20)**: the
   trigger turns Q41 on (R157 8.2 kΩ, R158 2.7 kΩ), which *discharges* C38; R156 then recharges C38 from +15 V into Q42's base, and
   Q42 (saturated at rest) releases the V_env node (R160 22 kΩ from +15 V, R159 100 kΩ into Q43's base, C39 0.033 µF through D52 /
   R161 to V_comm) while C38 is low — so Q43 is on while C38 recharges past Q42's turn-on: **5.25 ms** in the model at any trigger
   height (§16.1).
- Typical values [P SN p.14]: **56 Hz** (an 18 ms period) at the centre; decay short / mid / long **50 / 300 / 800 ms**; 3.5 / 10 Vp-p.
  Pots: TONE 10 kΩ (C taper), DECAY 500 kΩ B, LEVEL 100 kΩ A [P SN p.16, P-sch].
6. **Pitch sigh**: leakage through R161 lifts Q43's base when the common node swings below about a diode drop; Q43's collector current
   then lowers R_eff. Fitted memoryless law `iC = m · log(1 + e^{−α (Vcomm − V0)}) / α` (sign convention as the paper's figure 9:
   current flows for negative Vcomm) with **α = 14.3150, V0 = −0.5560, m = 1.4765e-5** (lane V: the paper's V0 is negative — the
   current starts as V_comm swings below ≈ −0.56 V; this appendix had dropped the sign); and
   `R_eff = Vcomm R166 (R165 + R166) / (Vcomm (R165 + R166) − R165 (Vcomm − R166 iC))` (= R165 + R166 when iC = 0). The instantaneous
   frequency glides from ≈ 57–58 Hz to ≈ 49–50 Hz over the first 0.3 s (figure 11). The sigh and the attack jump are different effects.
7. **Tone, level, output**: a passive low-pass (R171 + R172 ∥ VR5 with C45: TONE), a divider with a high-pass (VR4 LEVEL, C47), an
   output high-pass (R176, R177, C49) — three first-order sections.
- Discretisation in the paper: bilinear (untuned), transposed direct form II for every block (good under time-varying coefficients),
  memoryless nonlinearities applied directly. Tolerances: capacitors ± 20 %, resistors ± 5 % — why no two 808s sound alike.
- A retrigger before the note dies continues from the filter states: each note differs slightly, no machine-gun effect.

## 3. Snare drum [P SN p.6, p.14; P-sch; S NG, N8, SOS]

- **Two bridged-T resonators** on one dual op-amp (IC14a / b): one for the fundamental, one for the upper mode; centre
  `1 / (2π √(R_shunt R_bridge C1 C2))`. Low: shunt R196 680 Ω, bridge R197 820 kΩ, C58 / C59; high: shunt R195 2.2 kΩ, bridge R198
  1 MΩ, C60 / C61 [P-sch].
- **Three published tunings** (a known inconsistency): the printed values (C58 = C59 = 0.027 µF, C60 = C61 = 0.0068 µF) give
  ≈ **250 / 499 Hz** (Q ≈ 17 / 11) [P-sch calc]; the schematic's own production change (C58 0.056, C61 0.015, R191 8.2 → 10 kΩ, R200
  47 kΩ → 0) gives ≈ **173 / 336 Hz** [P-sch calc] — the most common later units [S NG]; the service table says **238 Hz (4.2 ms) /
  476 Hz (2.1 ms)** (FAN repeats it) and NG says the table was never updated; measured units read 220 / 443, 247 / 526, 177 / 340 Hz [S
  NG]. Typical decay (mid) **60 ms**; 3 / 10 Vp-p [P SN p.14]; the low resonator rings ≈ 25 ms to a tenth of its amplitude [S NG].
- **Excitation**: the gated trigger (Q45 NPN + Q46 PNP) drives the low resonator's input through R189 100 kΩ ∥ C57 0.0068 µF against
  R190 680 Ω (≈ 0.7 % plus the edge) and the high one through R191 / R192 220 Ω (≈ 2.6 %); both scale with the trigger's height. Above
  ≈ 8.3 V of trigger the first peak of the low resonator clips (≈ 20 Vp-p) [S NG].
- **TONE** (VR8, 100 kΩ B): one pot cross-fading the low resonator's output (through C63 0.047 µF) against the high one's (R200 + C65
  0.047 µF); the noise does not pass through it [P SN p.6 "VR8 sets the ratio"; P-sch].
- **Noise ("snappy") path**: white noise → C56 0.022 µF → a swing-type VCA (Q48; collector fed from the envelope through D54; R188 100 Ω ∥
  C54 0.0027 µF at the emitter; R194 2.2 MΩ bias) → a 2nd-order Sallen-Key high-pass (Q49 follower, C66 = C67 = 1.8 nF, R201 22 kΩ,
  R202 47 kΩ): **≈ 2.75 kHz, Q ≈ 0.73** [P-sch calc; S N8 2749 Hz] → C69 0.01 µF / R205 27 kΩ into the summing amp IC13a (R210 470 kΩ ∥
  C70 220 pF; SD LEVEL VR7 100 kΩ A in the feedback).
- **SNAPPY** (VR9, 10 kΩ B with R199 1 kΩ to ground): a divider setting how much gated trigger reaches Q47's base (through R186 33 kΩ);
  Q47 is an emitter follower charging C51 0.47 µF (then R184 15 kΩ, C52 0.1 µF, R185 15 kΩ, C53 0.001 µF) — the noise envelope. So
  SNAPPY scales the noise envelope's level [P-sch]. SOS's reading (the snappy contour fed back into the oscillators' trigger) is not
  confirmed by the schematic.
- Accent: the trigger height scales both the resonators' kick and the noise envelope.

## 4. Toms and congas [P SN p.6, p.14; P-sch; S BT]

- **Three identical circuits** (LT/LC IC15, MT/MC IC17, HT/HC IC18; two op-amps each): a resonator op-amp with a bridged-T in its
  feedback (bridge 820 kΩ, series capacitors, shunt = 1 kΩ + the TUNING pot, 500 Ω B, one per pair) **with an anti-parallel diode pair**
  (1S188FM: D80/81, D82/83, D84/85) in the shunt leg; a second op-amp inverts (33 kΩ / 33 kΩ) and feeds back through 820 kΩ to the
  T's junction (R230 / R259 / R286) — the service notes' "multi-feedback bridged-T".
- **Pitch bend**: just after a hit the diodes conduct, the time constant shortens and the ring is larger and higher; as the amplitude
  decays the diodes' resistance rises and the pitch falls (a cousin of the BD's sigh) [P SN p.6; S BT].
- **Series capacitors** (µF) [P-sch]: LT 0.056 / 0.012 (+ 0.047 in TOM); MT 0.027 / 0.012 (+ 0.0082, + 0.027 in TOM); HT 0.027 / 0.0056
  (+ 0.022 in TOM). With a shunt of ≈ 1.25 kΩ: toms ≈ 86 / 134 / 182 Hz, congas ≈ 192 / 276 / 404 Hz (calc), within ≈ 5 % of the table.
- **Typical values** (TUNING low / mid / high, Hz; Vp-p normal / accent; mid decay) [P SN p.14]: **LT 80 / 90 / 100**, 3.5 / 12, 200 ms;
  **MT 120 / 135 / 160**, 3 / 11, 130 ms; **HT 165 / 185 / 220**, 3.5 / 12, 100 ms; **LC 165 / 185 / 220**, 3.5 / 12, 180 ms; **MC 250 /
  280 / 310**, 3 / 10, 100 ms; **HC 370 / 400 / 455**, 3.5 / 12, 80 ms. (FAN's 250 Hz mid conga is the bottom of MC's range.)
- **The TOM / CONGA switch** (SW8 etc.) changes three things in one circuit: (a) adds series capacitance in TOM (≈ an octave lower);
  (b) adds R224 / R253 / R280 (1.5–2.2 kΩ) across the trigger divider (R226 22 kΩ into 4.7 kΩ) — **in CONGA** (lane V's re-read: the
  switch section's grounded contact is the CONGA side; with R224 in TOM the toms came out ≈ 3 × too quiet and the congas ≈ 4.5 × too
  loud against the table), so the congas are driven ≈ 3.6 × less; (c) enables the noise path (CONGA grounds it) [P SN p.6 "C77 for
  frequency, R224 for level"; P-sch].
- **Tom "reverb" noise** — on all three toms, not only the low one as the service text implies [P-sch]: pink noise (§11) → R216 15 kΩ /
  R217 3.3 kΩ, C71 0.047 µF → a gate (Q52 / Q55 / Q58; base R220 33 kΩ); its envelope: the gated trigger through D55 charges C72
  0.039 µF, which bleeds through R218 2.2 MΩ into the base (τ ≈ 86 ms: audible 150–260 ms) → C74 0.047 µF, R222 / R223 22 kΩ, R232
  100 kΩ into the level amp; slightly longer than the body [P SN p.6 "artificial reverb"].
- The stock unit has **no tom decay pot** (WH's is a modification) [S WH].

## 5. Rim shot and claves [P SN p.6, p.14; P-sch; S SJ]

- **One combined circuit** with two bridged-T generators, the switch changing its components: GEN1 (IC21): bridge R316 1 MΩ, C115 =
  C116 0.0047 µF, shunt R315 5.6 kΩ → **≈ 452 Hz** (chart **455**); GEN2 (IC20a): bridge 820 kΩ, C117 = C119 0.0022 µF, shunt R312 1 kΩ →
  **≈ 2.5 kHz** (chart **2500**, the claves).
- **RIM SHOT** adds C118 0.0022 µF on GEN2 → **≈ 1.8 kHz** (chart **1667**) and sums GEN1 and GEN2; **CLAVES** removes C118 and adds
  positive feedback R313 390 kΩ from the inverter IC20b (33 kΩ / 33 kΩ) for a higher Q and a longer ring; GEN1's part is negligible
  then [P SN p.6; S SJ]. **Lane V**: with R308 820 kΩ and C117 = C119, 390 kΩ gives GEN2 a loop gain of ≈ 1.05 — a self-oscillating
  generator at any op-amp bandwidth — so the model fits R313 to the table's 25 ms: **491 kΩ [fit]** (real units sit on either side of
  1 by their tolerances).
- **Shaping**: the sum into a swing-type VCA (Q62) whose envelope is D61, R107 1 kΩ, C24 0.47 µF, R108 10 kΩ (≈ 5 ms); then a
  passive + follower 2nd-order high-pass (Q63; C121 = C122 0.0047 µF, R322 10 kΩ, R325 330 kΩ): **≈ 590 Hz, Q ≈ 2.9** (calc) → R324
  (its value is not printed: **68 kΩ [fit]** to the table's 3 Vp-p) → C125 into IC19. Q74 (a JFET across IC19's feedback) mutes the
  output except **for ≈ 40–55 ms after** the trigger (lane V's reading, IMPL-7a §15 #36): Q61 pulls Q74's gate (C113 0.047 µF) to
  −15 V while the trigger lasts; R305 1 MΩ ∥ R327 470 kΩ bring it back (τ ≈ 15 ms), and the channel conducts again — the mute — once
  the gate passes the pinch-off (≈ −1 V, 2SK30A typical [typ]). The window keeps IC20's noise out between hits.
- Typical: RS 3 / 10 Vp-p, decay **10 ms**; CL 2.5 / 8 Vp-p, decay **25 ms** [P SN p.14].

## 6. Hand clap and maracas [P SN p.6, p.14, p.15; P-sch; S BT; W]

- **Two separate circuits** sharing the lane's trigger and output (the switch SW12 routes the trigger).
- **Clap**: white noise into the junction of a bridged-T inside an op-amp's feedback (bridge R334 100 kΩ, C128 = C129 0.0047 µF, shunt
  R333 10 kΩ; noise in through R332 27 kΩ ∥ C127 0.0018 µF): a band-pass at **≈ 1.1–1.25 kHz** (calc; BT ≈ 1 kHz) → **two VCAs in
  parallel**: (a) a BA662A (IC22) with a **sawtooth envelope** from an AN6912 comparator network (IC23, on the negative supply only):
  the trigger is integrated (R350 / C140) into a ≈ **30 ms** gate; IC23 runs **three** sawtooth cycles (C144 0.47 µF charged and
  discharged through R365 82 kΩ and D71), then a differentiated pulse (R357 / C141) fires a last, uninterrupted discharge, the result
  shaped exponentially by Q72; (b) a transistor VCA (Q70) with one longer decay — the "reverb" (offset trimmer TM3 "C.P. OFFSET", R348 /
  R349 1 MΩ, C138 0.047 µF). BT: 3 × ≈ 10 ms saw cycles + a ≈ 20 ms final discharge (≈ 50 ms), the reverb ≈ 100 ms [S]. Typical decay
  (mid) **100 ms** [P SN p.14]. Accent reaches the clap also through D68, C143 1 µF, R362 330 kΩ into the Q69 / Q70 offset network.
- Design changes [P SN p.15]: R346 1 kΩ → 680 Ω and R332 22 → 27 kΩ (the clap was too loud, from serial 010600); C201 on IC6 so the
  clap's highs do not disturb the other voices.
- **Lane V's model** (§16.6): the comparator network is not fully read, so its thresholds are fits — the recharge threshold (the ≈ 10 ms
  saws), the converter's offset and accent shift, the OTA's bias [fit]. The reverb stage Q70 as read (the band through R342 15 kΩ /
  R346 680 Ω and C137 to its base; its bias C139 → R348 → C138 → R349 into the junction, no base resistor to ground) leaves the tail at
  −35…−40 dB, a plateau (the junction drains C138 ever more slowly, a 1/t law) rather than an exponential; a gain of **4.5 [fit]** on
  that path puts the tail where the table's 100 ms needs it (R346's divider is the suspect: 3.3 kΩ there would give the same).
- **Maracas**: the gated trigger drives an envelope (Q67; C135 0.1 µF, R344 220 kΩ, R345 150 kΩ; R341 470 kΩ ∥ D66 with C134 0.033 µF at
  Q66's base: ≈ 15 ms release); white noise through C130 0.047 µF / R335 6.8 kΩ, a gate (Q65, Q66), a 2nd-order Sallen-Key high-pass
  (C132 = C133 0.001 µF, R339 3.3 kΩ, R340 68 kΩ: **≈ 10.6 kHz**, calc), Q68, IC19. Typical 3 / 5 Vp-p, decay **25 / 35 ms** [P SN p.14].
  Envelope detail low confidence (lane V checks the scan).

## 7. The metal bank [P ICMC §3–4]

- **Six Schmitt-trigger RC oscillators** on one HD14584 hex inverter at 5 V; nominal **205.3, 369.6, 304.4, 522.7 Hz**; #5 trimmable
  **359.4–1149.9 Hz** (TM2, factory **800 Hz**), #6 **254.3–627.2 Hz** (TM1, factory **540 Hz**); units before serial 000300 used other
  RC values for #5–6. The duty cycle depends only on the inverter's thresholds and output levels: **47.98 %** at 5 V; amplitude 5 V.
  Each half-period follows from the RC charge / discharge between the two thresholds; the inverter's edges (< 250 ns) are instantaneous.
- The six outputs are summed through a **passive resistor network** (each oscillator attenuated by its own divider, e.g. R53 against
  the parallel of the others' resistors) into **two active band-passes** (bridged-T relatives; third-order denominators, second-order
  numerators; #1 from C10, C13, C14, R52, R56, R57): centres ≈ **3440 Hz** and ≈ **7100 Hz**; they favour the squares' upper partials.
- Shared by CB (#5, #6), CY (all six), OH and CH (all six through the high band) [P ICMC §3, SN].
- The paper renders at 4× oversampling with naive squares (aliasing judged masked by the band-passes).
- Component reading [P SN p.14, P-sch]: #5 = R45 100 kΩ + TM2 with C5 0.018 µF → 800 Hz (1.25 ms at TP7); #6 = R44 150 kΩ + TM1 with
  C6 0.022 µF → 540 Hz (1.85 ms at TP6); early units (< 000300): C6 0.01 µF, R44 390 kΩ [P SN p.15]. Band-pass #1 (IC3b): R57 82 kΩ,
  C13 = C14 0.0068 µF, R56 560 Ω, input R52 33 kΩ / C10 0.0033 µF → ≈ 3440 Hz; #2 (IC3a): R59 82 kΩ, C15 = C16 0.0033 µF, R58 560 Ω,
  input R55 22 kΩ / C11 0.001 µF → ≈ 7100 Hz (calc, agreeing with ICMC).

## 8. Cymbal [P ICMC §5–11]

1. **Trigger logic** (Q2, Q6, R3, R6, R10, R15, R83) on the buffered 7–14 V common trigger → a 1 ms pulse.
2. **Attack smoother** (Q19, R84–R86, C35): `Vsmooth = (Vtrig − 0.7258)` through a one-pole low-pass, **τ = 1.0244e-4 s**.
3. **Three envelope generators** fed through D6–D8. EG #1: attack follows the input less **Von = 0.5899 V**; release
   `dV/dt = −V / (VR2k · R93 · C41)` (VR2 = DECAY); an emitter follower (VBE **0.6195 V**) feeds EG 1.2 (a high shelf: R104, R105, C45)
   and EG 1.3 (a divider: R89, R91, R92). EGs #2–#3 alike. Four envelope signals in all; forward Euler in the paper.
4. **Three swing-type VCAs**: a common-emitter stage whose supply is the envelope, with a gating diode. Output estimate
   `Venv − R104 · IES · (e^{VBE / VT} − 1)`; its lower edge `VlowerEdge(Venv)` = two stretched exponentials + an offset (the paper's
   table 1 coefficients); the output a soft clip between the lower edge and Venv with sharpness **α = 3.5**. VCA #2 takes two envelopes
   (EG 1.2 and EG 2); VCAs #2–#3 have capacitors around their diodes (first-order ODEs). One VCA per band.
5. **Three high-passes**: #1 a 2nd-order unity-gain Sallen-Key with an emitter follower (R124, R127, C48, C59); #2 2nd-order non-unity
   gain; #3 3rd-order with a resonance near **10.5 kHz**.
6. **Tone stage**: a passive network giving each band a 5th-order response (coefficients on the companion page); TONE mainly scales the
   third band and shifts the others slightly (weakly separated, non-orthogonal controls).
7. **Output buffer and level** (VR6 here = LEVEL): `(b2 s² + b1 s) / (a2 s² + a1 s + a0)`; it rises 6 dB / octave in the audio band.
- Unit delays break the EG ↔ VCA loops; rendered at 4×.
- **Which band feeds which VCA** [P-sch; P SN p.6; S BT, SOS]: Q18 takes the 3440 Hz band; Q16 and Q17 both take the 7100 Hz band (Q16
  the highest component with a short decay, Q17 a slightly lower one); **only the 3440 Hz path follows the CY DECAY pot** (VR2 2 MΩ B
  with R93 470 kΩ and C41 1 µF: τ ≈ 0.47–2.47 s, calc). HP #1 (Q25 follower; C48 = C59 1.5 nF, R124 22 kΩ, R127 82 kΩ) ≈ 2.5 kHz,
  Q ≈ 1 (calc); the two op-amp high-passes (3rd-order, gain ≈ 2.8; 2nd-order, gain 2) near 9–10.5 kHz, resonant. TONE = VR4 20 kΩ B
  mixing the bands. Typical decay short / mid / long **350 / 800 / 1200 ms**; 3.5 / 7 Vp-p (accent only ≈ 2 ×) [P SN p.14].
- **Lane V**: C50 (VCA #2's node capacitor) is unreadable on the scan (".00?5"); taken as 1.5 nF like its neighbours [R?]. The model's
  −20 dB times at TONE 5 are 26–29 % under the table, at TONE 2.5 within 15 % (the table does not say where TONE stood).

## 9. Open and closed hat [P SN p.6, p.14; P-sch; S BT]

- Both take the metal bank's **7100 Hz band** (IC3a's output).
- **Open hat**: a swing-type VCA (Q27) → a Sallen-Key high-pass (Q26; C66 = C68 0.0015 µF, R147 2.7 kΩ, R146 68 kΩ: **≈ 7.8 kHz, Q ≈ 2.5**,
  calc) → IC7. Envelope from Q29 with C62 0.47 µF, R139 1 MΩ, R134 100 kΩ and the OH DECAY pot (2 MΩ B). Typical decay short / mid /
  long **90 / 450 / 600 ms**; 3.5 / 7 Vp-p [P SN p.14].
- **Closed hat**: its own VCA (Q30) → high-pass (Q31; C72 = C73 0.001 µF, the same resistors: **≈ 11.7 kHz, Q ≈ 2.5**, calc) → half of
  IC7; fixed decay **≈ 50 ms**; 3 / 6 Vp-p [P SN p.14; S BT].
- **The choke**: a CH trigger charges C63 (0.47 µF) through Q28; through R173 (330 kΩ) that holds Q23 on, and Q23 discharges the open
  hat's envelope capacitor — the open hat ends at once and stays held **while C63 keeps Q23 on**: R173 · C63 = **τ ≈ 155 ms** (calc),
  which is the discharge's time constant, not the hold time — the hold ends when C63 falls below what turns Q23 on, so it depends on
  the charge (the CH trigger's height: longer when accented) and on Q23's base network (a re-read should look for a base-to-ground
  resistor) (IMPL-7a review §15 #11). An OH hit inside the hold is cut too; the circuit does not know whether OH is sounding [P SN
  p.6; P-sch]. [R? common use] The usual figure — CH on the beat, OH on the off-beat eighth, 250 ms later at 120 BPM — plays its
  open hats, which bounds the unaccented hold below ≈ 250 ms.
- **Lane V's reading** (2026-10-20): R134 100 kΩ sits in series with **both** Q22's and Q23's collectors (the DECAY drain and the
  choke share it), so the choke drains C62 with τ = R134 · C62 ≈ **47 ms**, not at once; no base-to-ground resistor shows at Q23. C63
  is also the closed hat's VCA supply (through R142 33 kΩ, Q30 switching on the band) — its own ≈ 50 ms decay — so the hold (C63
  above Q23's turn-on) is **≈ 49 ms at 4 V, ≈ 58 / 61 ms accented** (ACCENT 5 / 10) in the model. A sounding OH falls ≈ 20 dB during
  the hold and continues from there on its own decay; an OH hit inside the hold is cut ≈ 15 dB.
- The gate threshold of the hats is ≈ 4.5 V in stock form [S WH] (the metal voices see the 7–14 V bus, §1).

## 10. Cowbell [P SN p.6, p.14; P-sch; S SOS, frisnit; P AES abstract]

- Oscillators **#5 / #6** (800 / 540 Hz) each through 120 kΩ to the mix node (R53 1 kΩ), then R62 / R64 33 kΩ with R63 / R65 2.2 kΩ to
  ground (≈ 1/16), C32 / C33 10 µF, into **two swing-type VCAs** (Q15 / Q14; collector 470 kΩ, emitter 100 Ω, diodes D3 / D4) **sharing
  one envelope node**, mixed by IC2.
- **Envelope**: C9 0.47 µF with R29 100 kΩ (≈ 47 ms) plus a parallel branch R82 33 kΩ + C34 1 µF — charge sharing drops it to ≈ 1/3 in
  ≈ 10 ms, then a long tail (τ ≈ 150 ms): the "abrupt initial decay" of the service notes [P SN p.6; P-sch calc; S frisnit].
- **Band-pass after the VCAs** (IC2a, multiple feedback): two inputs R26 / C30 0.0022 µF and R27 / C31 0.0022 µF, shunt R24 2.2 kΩ,
  C29 0.0033 µF to the output, C28 0.01 µF to the inverting input, R25 470 kΩ feedback: **≈ 860 Hz, Q ≈ 6** (calc); a rebuild measured
  ≈ 850 Hz, ≈ 200 Hz wide [S frisnit]. LEVEL pot 5 kΩ A.
- Typical decay (mid) **50 ms**; 3.5 / 12 Vp-p [P SN p.14]. Design change: R44 / R45 and C6 values changed and TM1 / TM2's range widened
  to keep the tuning in spec [P SN p.15]. Werner's AES 9207 analyses this band-pass (abstract only). **Lane V**: the network's −20 dB
  point is ≈ 175 ms (0.32 in ≈ 10 ms, then τ ≈ 147 ms); the table's 50 ms matches the charge-sharing drop (≈ −10 dB), not −20 dB.

## 11. Noise [P SN p.14, p.16; P-sch; S SL]

- **White noise (WN)**: a selected 2SC828-R transistor (Q35) with its emitter–base junction reverse-biased through R128 1 MΩ from a
  decoupled supply (R124 100 Ω, C29 47 µF) → C31 1 µF → IC24a (non-inverting, gain ≈ 4: R130 1 MΩ over R129 330 kΩ + TM4 22 kΩ + R127
  4.7 kΩ). Set to **130 mV rms at TP4** with TM4. Later units: R129 shorted, R311 100 kΩ, C200 10 µF, C202 22 pF (DC decoupling) [P SN
  p.15]. Substitute transistors sound different; later production used other types [S SL].
- **"Pink" noise (PN)**: WN through a unity-gain 2nd-order Sallen-Key **low-pass** (R133 = R132 22 kΩ, C32 0.039 µF, C33 0.018 µF):
  **≈ 273 Hz, Q ≈ 0.74** (calc) — dark, 12 dB / octave noise, not 1/f.
- **Users**: WN → the snare's noise VCA, the clap and the maracas; PN → the three toms only [P-sch]. One source for the whole machine.

## 12. Mixer and outputs [P M, SN; P-sch]

- Rails ± 15 V, each section decoupled (100 Ω / 47 µF). Each voice ends in its LEVEL pot (mostly **100 kΩ A** in an op-amp's feedback;
  CB **5 kΩ A**), then 1 kΩ in series to its MULTI OUT jack (switched: a plug lifts the voice off the bus).
- **Mix resistors** to the summing bus: BD 22 kΩ; SD, LT/LC, MT/MC, HT/HC, RS/CL, CP/MA 33 kΩ; CB, CH, CY 47 kΩ; OH 56 kΩ; the summing
  amp IC4a (R75 33 kΩ feedback) → voice gains ≈ 1.5 (BD), 1.0, 0.70, 0.59 (OH); then MASTER VOLUME (VR1 50 kΩ A), IC4b (22 kΩ in,
  33 kΩ feedback: × 1.5), a FET mute (Q13), clamp diodes D9 / D10.
- MASTER OUT **HI 6 Vp-p / 1 kΩ** and **LO 0.6 Vp-p / 3 kΩ** (a 27 kΩ / 3.3 kΩ divider, −19.3 dB), mono (the mix); measured with the
  voices at their red mark and ACCENT fully clockwise. Multi outs typically 2.5–3.5 Vp-p normal, up to 12 accented.
- **MULTI OUT**: 11 mono jacks (BD, SD, LC/LT, MC/MT, HC/HT, CL/RS, MA/CP, CB, CY, OH, CH), 1 kΩ; plugging one removes that voice from the
  mix; their level follows the voice's LEVEL knob and ignores MASTER VOLUME.
- No headphone jack, no stereo pair.

## 13. Sequencer and panel [P M unless tagged]

- **MODE** rotary, 6 positions: PATTERN CLEAR, PATTERN WRITE 1st PART, 2nd PART, MANUAL PLAY, PLAY (rhythm track), COMPOSE (rhythm
  track); the first three yellow-coded. **INSTRUMENT / TRACK** rotary, **12** positions: AC, BD, SD, LT, MT, HT, RS, CP, CB, CY, OH, CH
  (also track numbers 1–12 on the outer ring). **AUTO FILL IN** rotary: MANUAL, 16, 12, 8, 4, 2. **PRE-SCALE** 4 positions.
  **BASIC VARIATION** A / AB / B; **I/F VARIATION** A / B; START/STOP; TAP (INTRO SET / FILL IN TRIGGER); red CLEAR (PATTERN CLEAR,
  TRACK CLEAR, STEP NUMBER SET, PRE-SCALE SET).
- **Alternates**: five two-way voice switches (LT/LC, MT/MC, HT/HC, RS/CL, CP/MA) in the voice section; the pattern data is shared, the
  switch chooses at playback, the two sounds of a pair cannot sound together; switch positions are not stored in patterns [P M; P-TR08].
- **32 patterns**: 16 keys (1–12 BASIC RHYTHM, 13–16 INTRO / FILL IN 1–4) × A / B. A and B are separate one-measure patterns that always
  share step count and pre-scale; each has a 1st part (≤ 16 steps) and a 2nd part (≤ 16, so ≤ 32 steps a measure); the 2nd part cannot be
  used alone; a measure plays the 1st part then the 2nd. Cleared: 1st part 16 steps, 2nd part 0.
- **PRE-SCALE** = steps per beat: 1 → 3, 2 → 6, 3 → 4, 4 → 8 (8th triplets, 16th triplets, 16ths, 32nds). Time-signature readings of the
  four positions found on the web disagree with each other [W] and are not used.
- **Writing**: stopped, PATTERN CLEAR, the key, the variation, CLEAR; 1st PART; START (the LEDs run); set PRE-SCALE and press CLEAR (it
  latches); choose an instrument; step keys toggle its steps (a lit key again cancels); repeat per instrument including AC; STOP.
  **Length**: in a write mode, running, CLEAR held + step key N = the current part's last step (2nd part: key 16 = step 32). Running, the
  LEDs show the selected instrument's steps of the current part with the playhead inverted; the PART LEDs show the running part.
- **TAP write**: in a write mode, running, each TAP writes the selected instrument at the current position, one sound per tap. The
  original sources do not say whether it is quantised; the TR-08 writes the nearest step [P-TR08; S].
- **Manual play**: keys 1–12 choose the basic rhythm, 13–16 the I/F pattern. A key pressed while running takes effect at the end of the
  measure; pressed during beat 1, it starts at beat 2 of the current measure. **AB** alternates A, B and always starts on A (after an
  intro: intro, A, B); variation changes apply at the next measure. **Intro**: stopped, TAP arms it (the I/F key flashes), START plays
  it once then the basic rhythm, TAP again cancels. **Fill**: TAP while running plays the selected fill once at the next measure; AUTO
  FILL IN N plays it once every N measures (the intro not counted); MANUAL cancels. No two-key chaining on the original (the TR-08 added
  it) — the original's chaining is AB, fills and the rhythm track.
- **Rhythm track**: 12 tracks × 64 measures = 768; a composition overflows into the next track. COMPOSE: stopped, choose the track,
  CLEAR (TRACK CLEAR), both variations to A, START, press pattern keys live (each recorded at the measure it takes effect), STOP (the
  measure STOP lands in is the last). Stored: pattern numbers per measure (and repeat counts); the variation switch applies at playback.
  Editing (no CLEAR): replace measures; the length cannot change; no insert / delete; fills can be pressed in. PLAY: from measure 1, loops
  at the end until STOP. No measure display.
- **START** begins at step 1 / measure 1; at stop the LEDs return to the flashing selected key.
- **Tempo** 40–300 BPM; the coarse knob has **40 click stops**; FINE beside it. Internal clock 24 per quarter note. DIN SYNC: 24 PPQN,
  pins START/STOP, GND, CLOCK, TTL levels; a rear IN / OUT switch [P SN; S].
- **No swing / shuffle, no MIDI** on the original [S SOS, the TR-08 review]. No copy, undo, insert or delete. The memory is kept by three
  batteries in MANUAL PLAY or PLAY.
- **Panel**: **508 × 305 × 105 mm** (SN: 110 mm high), 5 kg. Top-left block: MODE (extreme upper left), CLEAR under it, INSTRUMENT /
  TRACK, AUTO FILL IN, TEMPO (large) with FINE. Twelve voice columns: ACCENT (LEVEL); BD (LEVEL, TONE, DECAY); SD (LEVEL, TONE,
  SNAPPY); LT/LC, MT/MC, HT/HC (LEVEL, TUNING + switch); RS/CL (LEVEL + switch); CP/MA (LEVEL + switch); CB (LEVEL); CY (LEVEL, TONE,
  DECAY); OH (LEVEL, DECAY); CH (LEVEL); a large MASTER VOLUME at the lower right of the top section beside the title [S IO]. Bottom
  band: BASIC VARIATION with two LEDs, START/STOP, PRE-SCALE with STEP NO and the 1st / 2nd PART LEDs, the note-value staves above the
  16 step keys, the BASIC RHYTHM 1–12 / INTRO-FILL IN 1–4 legends, I/F VARIATION, TAP. Step key caps in four colours (red, orange,
  yellow, white per the service parts list [P SN]); grouped red 1–4, orange 5–8, yellow 9–12, white 13–16 [S IO]. LEVEL knobs orange,
  the others pale [S IO]; the red "standard" mark on the LEVEL knobs at ≈ 2 o'clock [P M]. Panel LEDs red [P SN]. Rear: MASTER OUT
  HI / LO, MULTI OUT × 11, TRIGGER OUT × 3, PEDAL × 2 (START/STOP, FILL IN), DIN SYNC with IN / OUT.
- Photographs for the layout lane: research-drums.md §3 A1 (Wikimedia Commons).

## 14. Gaps and the reconstruction rule (lane V)

- **Component values** of every voice live in the service notes' schematic (SN, SCH; Werner's papers reproduce the BD and cymbal
  schematics as figures). The values in §2–§12 are one careful reading; lane V **re-reads every value it uses** from a high-resolution
  scan (or published clone documentation redrawing the same circuits: Eric Archer's 808 pages, open clone BOMs), writes the final table
  per voice into this file with its reference designators and source, and flags any value it reads differently. No scan or schematic
  image is committed to the repo; nothing of the notes' prose is copied.
- **Two targets per voice**: (a) the model matches **its own analog prototype** built from the chosen values (centre frequencies ± 1 %,
  time constants ± 2 % — a test of the discretisation); (b) the result lands near the **service table's typical values** (frequencies
  within ± 8 %, decays within ± 25 %: the parts were ± 20 % capacitors and ± 5 % resistors, and the table is "typical"). Where a value
  cannot be read at all, the lane fits that one component to (b) and tags it **[fit]**.
- **Decided for the build** (IMPL-7a): the snare uses the schematic's production values (≈ 173 / 336 Hz, §3), the earlier ones recorded
  for a later "unit character" option (the service table's SD tuning belongs to the printed revision; the check uses NG's measured
  later unit, 177 / 340 Hz); the BD attack is what the C38 / R156 / Q43 network gives (τ 100 ms, Q43 on for ≈ 4–7 ms, §2); the BD's
  56 Hz table figure is its early, sighing pitch (§2 item 6), the components' settled centre ≈ 49.5 Hz; CB / CY / OH / CH envelopes
  from their RC networks, the table's decays as the check; the choke's hold from C63 / R173 / Q23 (§9).
- Not fully traced (the lane reconstructs from the topology, then fits to the table): the snare's noise-envelope time constants (the
  C51–C53 ladder through Q47 / Q48 and D54: fit to the 60 ms typical decay); the clap's AN6912 comparator network (implement as the
  topology: a ≈ 30 ms gate, three sawtooth cycles of ≈ 10 ms, a final ≈ 20 ms discharge, an exponential converter, plus the ≈ 100 ms
  reverb VCA; band-pass ≈ 1.1 kHz); the tom diode pair (a Shockley model of 1S188FM); the OH / CH envelope resistances around Q29 / Q28;
  the maracas' envelope. **Lane V (2026-10-20)**: the snare ladder is modelled from its values (no fit needed: 68 ms); the clap and the
  maracas carry the fits listed in §16.6; the 1S188FM as I_s 6e-8 A, n 1.2 [typ]; the hats' envelopes as read (§9). §16 is the final
  table.
- Open sequencer points (IMPL-7a §3.3 decides each one, [C]): whether step keys toggle steps while stopped in a write mode (IO: they
  select the key); whether TAP quantises (TR-08: nearest step); whether the pre-scale CLEAR resets anything else; whether setting the 1st
  part resets the 2nd; TAP in COMPOSE; how a pending key shows while running; the PRE-SCALE control's form (rotary or slide) — the panel
  lane decides from photographs.

## 15. Measured run times (for orientation only)

A web table of total run times [W sequencer.de]: BD 242–1646 ms, SD 199, LT 455, MT 309, LC 341, MC 234, RS 15, CL 41, MA 33, CP 1964,
CB 1157, CY 276–3956, OH 144–586, CH 112 ms. They measure the time to silence, not the service table's "decay", and disagree with it by
design; the tests use the service table (§14).

## 16. The component tables as modelled (lane V, 2026-10-20)

The values `dr-808.js` uses, per voice (its frozen tables `BD`, `SD`, `TOM` / `TM`, `RS`, `CP`, `CB`, `MT`, `CY`, `HH`, `MIX`; exposed
as `Dr808.proto` for the tests). Source of every value: the schematic scan of §0 (SCH), re-read by eye at high zoom [P-sch], except
where tagged: **[fit]** fitted to the service table (§14 rule; the reason beside it), **[R?]** unreadable and assumed, **[typ]** a
typical device parameter, **[P DAFX] / [P ICMC]** the papers' fitted laws. Devices: small-signal NPN / PNP β 300, I_ES 1e-14 A,
V_BE 0.65 V, V_CE,sat 0.1 V [typ]; µPC4558 GBW 3 MHz, rails ± 15 V with a soft knee 11 → 13.5 V [typ]; pot end / wiper 50 Ω.
Values read differently from §2–§12 are in **bold**.

### 16.1 Bass drum
| part | value | role |
|---|---|---|
| R162 / R163 / C40; D53 | 4.7 k / 100 k / 0.015 µ; clamp −0.71 V | pulse shaper, its falling-edge clamp |
| R157 / R158 (Q41) | 8.2 k / 2.7 k | the trigger discharges C38 |
| R156 / C38 (Q42) | 1 M / 0.1 µ | recharge into Q42's base; C38 at rest where R156's current meets the junction |
| R160 / R159 / C39 / R161 (D52) | 22 k / 100 k / 0.033 µ / 1 M | V_env; Q43's base; the retrigger pulse into V_comm |
| C41 / C42 / R167 | 0.015 µ / 0.015 µ / 1 M | the bridged-T's arms and bridge |
| R165 / R166 (Q43) | 47 k / 6.8 k | the shunt leg; Q43 shorts R165 while on (≈ 5.25 ms) |
| R170, R164 / R169 / C43, VR6 | 470 k, 47 k / 47 k / 33 µ, 500 k B | the feedback buffer; DECAY |
| R171 / R172 / VR5 / C45 | 220 / 10 k / 10 k C / 0.1 µ | TONE low-pass |
| C47 / VR4; C49 / R177 / R176 (Q44); C50 / R174 / R175 | 0.47 µ / 100 k A; 0.47 µ / 82 k / 100 k; 1 µ / 100 k / 1 k | LEVEL, output high-passes |
| α / V0 / m | 14.3150 / **−0.5560 V** / 1.4765e-5 | Q43's leakage (the sigh) [P DAFX; the sign corrected, §2] |
| mix | 22 k | to the bus |

### 16.2 Snare (the production values, §3)
| part | value | role |
|---|---|---|
| R189 ∥ C57 / R190 | 100 k ∥ 0.0068 µ / 680 | the low resonator's kick |
| R191 / R192 | 10 k / 220 | the high resonator's kick |
| C58 / C59 / R197 / R196 | 0.056 µ / 0.027 µ / 820 k / 680 | low bridged-T (173.3 Hz) |
| C60 / C61 / R198 / R195 | 0.0068 µ / 0.015 µ / 1 M / 2.2 k | high bridged-T (336 Hz) |
| C63 / C65 / VR8 / R204 | 0.047 µ / 0.047 µ / 100 k B / 100 k | TONE |
| VR9 / R199; Q47 (≈ 430 Ω source) | 10 k B / 1 k | SNAPPY divider, the envelope's charger |
| C51 / R184 / C52 / R185 / C53 | 0.47 µ / 15 k / 0.1 µ / 15 k / 0.001 µ | the envelope ladder, the VCA node |
| C56 / R194 (Q48) | 0.022 µ / 2.2 M | the noise VCA's coupling and bias |
| C66 / C67 / R201 / R202 (Q49) | 1.8 n / 1.8 n / 22 k / 47 k | Sallen-Key high-pass ≈ 2.75 kHz |
| C69 / R205; R210 / C70 / VR7 | 0.01 µ / 27 k; 470 k / 220 p / 100 k A | into IC13; LEVEL |

### 16.3 Toms / congas (LT designators; per circuit low / mid / high)
| part | LT / LC | MT / MC | HT / HC | role |
|---|---|---|---|---|
| bridged-T Ca (+ TOM) | 0.056 µ | 0.027 µ (+ 0.0082 µ) | 0.027 µ | arm to the junction |
| bridged-T Cb (+ TOM) | 0.012 µ (+ 0.047 µ) | 0.012 µ (+ 0.027 µ) | 0.0056 µ (+ 0.022 µ) | arm to the output |
| trigger C_x | 0.0068 µ | 0.0027 µ | 0.0027 µ | into R226 22 k |
| R225-class load / R224-class (**CONGA**) | 4.7 k / 1.5 k | 6.8 k / 2.2 k | 5.6 k / 1.5 k | the + input's divider (§4 corrected) |
| C81-class / feedback C | 0.047 µ / 1 n | 0.039 µ / 1 n | 0.033 µ / 1 n | output coupling; IC13's cap |
| C72-class / C71 / C74 / C75 | 0.039 / 0.047 / 0.047 / 0.018 µ | 0.033 / 0.047 / 0.033 / 0.015 µ | 0.033 / 0.047 / 0.027 / 0.01 µ | the rumble gate and its filters |
- Shared: bridge and feedback 820 k (R229 / R230-class), shunt R231 1 k + TUNING 500 Ω B (+ 10 Ω each side), 1S188FM pair I_s 6e-8 A,
  n 1.2 [typ], R233 / R232 100 k, R235 470 k with LEVEL 100 k A, the rumble path R219 4.7 k, R218 2.2 M, R216 15 k / R217 3.3 k, R220
  33 k, R221 4.7 k, R222 / R223 22 k; mix 33 k.

### 16.4 Rim shot / claves
| part | value | role |
|---|---|---|
| C111 / R307 / D62 / R301 / R302 | 0.01 µ / 100 k / — / 47 k / 10 k | GEN1's excitation |
| C116 / C115 / R316 / R315 | 0.0047 µ / 0.0047 µ / 1 M / 5.6 k | GEN1 (452 Hz) |
| C114 / R306 / D64 / R310 / R311 | 0.001 µ / 22 k / — / 33 k / 10 k | GEN2's excitation |
| C119 / C117 / C118 (RIM) / R308 / R312 | 2.2 n / 2.2 n / 2.2 n / 820 k / 1 k | GEN2 (≈ 1.8 kHz RIM, 2.5 kHz CLAVES) |
| R313 (CLAVES) | **491 k [fit]** (reads 390 k: a loop gain of 1.05, §5) | GEN2's positive feedback |
| R318 / R320 / R317; C120 / R321 (Q62) | 220 k / 22 k / 10 k; 10 µ / 2.2 M | the mix into Q62's base, its bias |
| R107 / C24 / R108 | 1 k / 0.47 µ / 10 k | the VCA's envelope |
| C121 / C122 / R322 / R325 (Q63) | 4.7 n / 4.7 n / 10 k / 330 k | high-pass ≈ 590 Hz |
| R324 / R326 / C125; R319 (CLAVES) | **68 k [fit]** (unprinted) / 10 k / 0.01 µ; 220 k | into IC19 |
| R330 / C153 / VR16 | 470 k / 22 p / 100 k A | IC19's feedback, LEVEL |
| C113 / R305 / R327; Q74 | 0.047 µ / 1 M / 470 k; pinch-off −1 V, R_on 300 Ω [typ] | the mute (§5) |

### 16.5 Cowbell
| part | value | role |
|---|---|---|
| R62 / R63 (R64 / R65), C32 (C33) | 33 k / 2.2 k, 10 µ | oscillators #5 / #6 into the VCAs' bases |
| R30 / R28 (R29) | 470 k / 100 k | base bias, collector (the VCA supply) |
| R122 / C9 / R82 / C34 | 1 k / 0.47 µ / 33 k / 1 µ | the envelope, its charge sharing |
| R26 (R27) / C30 (C31) / R24 / C29 / C28 / R25 | 10 k / 2.2 n / 2.2 k / 3.3 n / 0.01 µ / 470 k | band-pass ≈ 860 Hz |
| C75 / R116 / VR5; C76 / R117 | 1 µ / 8.2 k / 5 k A; 0.022 µ / 22 k | LEVEL and the output high-passes |

### 16.6 Hand clap / maracas
| part | value | role |
|---|---|---|
| R332 ∥ C127 / R333 / C128 / C129 / R334 | 27 k ∥ 1.8 n / 10 k / 4.7 n / 4.7 n / 100 k | band-pass ≈ 1.25 kHz |
| C144 / R365 / R367 (Q73); R368 / R371 | 0.47 µ / 82 k / 330; 470 k / 15 k | the sawtooth, the converter's divider |
| the gate / the recharge threshold | 30 ms [S] / **11.57 V [fit]** (≈ 10 ms saws) | the comparator network |
| converter offset / accent shift | **−0.444 V / 0.01 V per V [fit]** | Q71 / Q72 (through C143 / R362) |
| C136 / R372 / R382; R383; OTA bias | 0.022 µ / 39 k / 1 k; 82 k; **0.40 mA [fit]** (2 Vp-p) | IC22 |
| C150 / R378 | 0.001 µ / 100 k | into IC19 |
| C139 / R348 / C138 / R349 (Q69, Q70) | 0.018 µ / 1 M / 0.047 µ / 1 M | the reverb's bias |
| R342 / R346 / C137; R363 / R369 | 15 k / 680 / 0.033 µ; 10 k / 330 | the reverb stage |
| C146; C152 / R376 | 0.018 µ; 0.0047 µ / 47 k | its output into IC19 |
| the reverb path's gain | **× 4.5 [fit]** (§6) | the table's 100 ms |
| R375 / C149 / VR17 | 470 k / 220 p / 100 k A | IC19, LEVEL |
| MA: C135 / R345 / R344 (Q67) / R343; C134 / R341 (Q66) | 0.1 µ / 150 k / 220 k / 100 k; 0.033 µ / 470 k | the gate |
| MA: the gate's span / noise level | **8 V / 6.4 [fit]** (25 / 35 ms, 3 / 5 Vp-p) | the least certain read (§6) |
| MA: C131 / R338; C132 / C133 / R339 / R340 (Q68); C151 / R377 | 0.01 µ / 15 k; 1 n / 1 n / 3.3 k / 68 k; 0.01 µ / 100 k | high-passes ≈ 10.6 kHz |

### 16.7 Metal bank
| part | value | role |
|---|---|---|
| oscillators | 205.3, 369.6, 304.4, 522.7, 800, 540 Hz; duty 47.98 %; 0 / 5 V | §7 |
| each through R (120 k) to R53 | 120 k / 1 k | the passive sum |
| R52 / C10 / C13 / C14 / R56 / R57 | 33 k / 3.3 n / 6.8 n / 6.8 n / 560 / 82 k | band-pass #1 (3454 Hz analog peak) |
| R55 / C11 / C15 / C16 / R58 / R59 | 22 k / 1 n / 3.3 n / 3.3 n / 560 / 82 k | band-pass #2 (7117 Hz analog peak) |
| the VCAs' coupling / bias | 0.022 µ / 2 M from +15 V | the swing VCAs' bases (CY, OH, CH) |
| the metal bus | 4 V trigger → 6.9 V, ceiling ≈ 13.8 V | R18 / R19 / D1 into a × 31.3 stage (§1) |

### 16.8 Cymbal
| part | value | role |
|---|---|---|
| smoother | V − 0.7258, τ 1.0244e-4 s | [P ICMC] |
| EG1: C41 / R93 / VR2; V_on / V_F | 1 µ / 470 k / 2 M B; 0.5899 / 0.6195 V | DECAY [P ICMC] |
| EG1.2: R105 / C45; VCA1 R104 | 33 k / 2.2 µ; 22 k | the 3440 Hz path |
| EG1.3: R92 / R89 / R91 | 33 k / 10 k / 33 k | into VCA2's supply |
| EG2: C40 / R88 / C39 / R90 | 1 µ / 33 k / 0.47 µ / 33 k | VCA2 (7100 Hz) |
| EG3: C38 / R87 / C37 / R94 | 1 µ / 22 k / 2.2 µ / 39 k | VCA3 (7100 Hz) |
| VCA node caps | C50 **1.5 n [R?]** + C43 1.5 n; C47 + C36 1.5 n each | VCA2, VCA3 |
| HP1: C48 / C59 / R124 / R127 (Q25) | 1.5 n / 1.5 n / 22 k / 82 k | ≈ 2.5 kHz |
| HP2: C51 / C52 / R107 / R113, gain 2 | 1 n / 1 n / 18 k / 18 k | IC5 |
| HP3: C49 / R106 / C53 / R108 / C54 / R109, gain 1 + 39 / 22 | 3.3 n / 6.8 k / 1 n / 18 k / 1 n / 18 k | IC5 |
| tone: C55 / R112, C56 / R120, C58 / R123, C57 / R121, R119 / R129 / R125, VR4 | 0.01 µ / 22 k, 0.01 µ / 10 k, 0.01 µ / 100 k, 3.3 n / 10 k, 22 k / 15 k / 2.2 k, 20 k B | the passive tone network |
| C90 / R128 / C77 / VR6 | 0.01 µ / 470 k / 220 p / 100 k A | LEVEL stage (IC6) |

### 16.9 Hats
| part | value | role |
|---|---|---|
| R137 / C62 / R139 (Q24, Q29) | 470 / 0.47 µ / 1 M | OH envelope |
| R130 / R131 (Q21); C60 / R132 / VR3 / R133 (Q22) | 10 k / 22 k; 10 µ / 100 k / 2 M B / 10 k | the DECAY timer |
| R134 | 100 k, in series with Q22 **and** Q23 (§9) | the drain |
| R144 / C64 + C65 (Q27); C66 / C68 / R147 / R146 (Q26) | 33 k / 1.5 n + 1.5 n; 1.5 n / 1.5 n / 2.7 k / 68 k | OH VCA, high-pass ≈ 7.8 kHz |
| C80 / R160; R159 / C79 / VR7 | 470 p / 39 k; 470 k / 220 p / 100 k A | into IC7, OH LEVEL |
| C63 (Q28) / R142; R173 (Q23) | 0.47 µ / 33 k; 330 k | CH envelope and VCA supply; the choke |
| C69 + C70 (Q30); C72 / C73 / R153 / R155 (Q31) | 1.5 n + 1.5 n; 1 n / 1 n / 2.7 k / 68 k | CH VCA, high-pass ≈ 11.7 kHz |
| C74 / R162; R161 / C82 / VR8 | 470 p / 33 k; 470 k / 220 p / 100 k A | into IC7, CH LEVEL |
| mix OH / CH | 56 k / 47 k | to the bus |

### 16.10 Mixer and output
| part | value | role |
|---|---|---|
| R75 / C18 (IC4a) | 33 k / 220 p | the summing amp; each voice's bus gain 33 k / (1 k + R_mix) |
| C19 / VR1 | 1 µ / 50 k A | MASTER VOLUME |
| C23 / R77 / R76 / C22 (IC4b) | 1 µ / 22 k / 33 k / 220 p | the output amp; clipped at the rails |
| full scale | 0.45 V at the output amp (`OUT_K` 2.2) | IMPL-7a §2.5 |
