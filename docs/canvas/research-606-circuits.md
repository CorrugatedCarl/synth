# The TR-606's circuits, sequencer and panel — research appendix to IMPL-7b

Facts for the stage 7b build lanes, cited from [IMPL-7b.md](IMPL-7b.md) as **R6 §n**. Everything is in our own words: circuit
topologies, component values, frequencies, behaviours and panel positions are facts; no manual or service-note prose is
reproduced, no schematic or photograph is redistributed (the scans and crops stay in the scratchpad), no recording is used.
Gathered 2026-10-20 (two research passes; the lead re-read the bass drum, the metal oscillators, the hats and the tempo clock on the
schematic). [research-drums.md](research-drums.md) §3 A3 is the wider survey (it said "6 × AA" and "no circuit analysis found": both
superseded here); [research-808-circuits.md](research-808-circuits.md) (**RC**) is the 808's appendix, whose blocks the 606 reuses.

Tags: **[P]** primary — the TR-606 service notes (**SN6**) or owner's manual (**OM6**); **[P-sch]** a value read off SN6's schematic
by eye (any single value may be misread: lane V6 re-reads, §14); **[S]** reputable secondary; **[W]** weak; **[V]** seen on a
photograph; **calc** our arithmetic on those values. "= 808" / "≠ 808" mark what the 7a model already has.

## 0. Sources

- **SN6** — Roland TR-606 Service Notes, 1st edition (6 Jan 1982; 2nd printing 7 Nov 1983), 8 pages: p1 specifications, p2 IC
  pin-outs / CPU port map / block diagram, p3 full block diagram, p4 CPU, RAM, accent and tempo clock, p5 every voice, the power
  supply and the mixer, p6–7 board layouts, p8 adjustments, engineering changes and parts list. Scans:
  http://privat.bahnhof.se/wb447909/dinsync/service_manuals/TR-606.pdf ;
  https://www.polynominal.com/site/studio/gear/drum/roland_tr606/roland-tr606-service-manual.pdf ; the same schematic as images:
  http://machines.hyperreal.org/manufacturers/Roland/TR-606/schematics/ [P]
- **OM6** — the TR-606 owner's manual (48-page scan): https://soundprogramming.net/manuals/drum/Roland_TR-606_Manual.pdf (PDF page =
  printed page + 2) [P]
- **E&MM** — Tony Bacon, "Roland TR606", Electronics & Music Maker, Feb 1982: https://www.muzines.co.uk/articles/roland-tr606/3696 [S]
- **TR06** — Roland TR-06 owner's manual (2020 re-creation; documents the inherited workflow; weaker for the 1981 unit):
  https://www.adorama.com/col/productManuals/ROTR06OP.pdf [S]
- **RA** — Roland Articles, "Drumatix: the perpetual appeal of the TR-606": https://articles.roland.com/?p=10196 [S]
- **TT** — Tubbutec TR-6oh6 user guide (a CPU replacement whose legacy mode mirrors the original):
  https://tubbutec.de/files/TR-6oh6/TR-6oh6%20user%20guide.pdf ; Tubbutec 6m0d6 (a replica; describes the original voices):
  https://tubbutec.de/6m0d6 [S]
- **ZB** — Zoe Blade's notes: https://notebook.zoeblade.com/TR-606.html [S]
- **MK** — Moritz Klein's "TR-606 style hi-hat" (metal oscillator frequencies), as quoted in
  https://publish.obsidian.md/arendleejessurun/Atlas/Musicianship/Synthesis/Synthesizing+a+hi+hat [S/W]
- **DS** — D. Schmidt's TR-606 bass drum page (users.monash.edu/~dschmidt/tr606/bd.html; offline, search snippets only) [W]
- Photographs [V]: Wikimedia Commons `Roland_TR-606.jpg` (a near-orthographic top view, 1123 × 556, measured at 3.69 px/mm),
  `Drumatix_TR-606_used_by_the_Scientific_Americans.jpg`, `TR-606_1.jpg` (rear legends), `TR-606_detail_shot.jpg`; OM6's annotated
  panel photograph and rear drawing. Aggregators [W]: Wikipedia "Roland TR-606" / "DIN sync", polynominal, vintagesynth, ModularGrid.

## 1. The trigger bus and accent [P SN6 p4; P-sch]

- **CPU** IC4 µPD650C-128 (a 4-bit mask-ROM microcomputer of the 808's family; p2's pin table prints "-085", the parts list "-128"),
  two µPD444C RAMs (2048 × 4 bit) [P]. Each step the CPU sets **static instrument lines** (PE0 CH, PE1 OH, PE2 CY, PE3 HT, PF0 LT,
  PF1 SD, PF2 BD, PF3 AC — ports shared with the RAM data lines) and emits one **common strobe** on PI2 [P-sch].
- **Accent generator**: the strobe reaches the base of the emitter follower Q11 (2SC945) through D6 — the unaccented path; a diode
  AND of the strobe and the AC line (D7, D12, R41 47 kΩ to +B) drives Q10 (R42 33 kΩ to ground), which saturates the PNP Q9
  (2SA733; R39 4.7 kΩ, R40 22 kΩ; emitter on +15H). Q9's collector feeds the ACCENT pot **VR2 10 kΩ B wired as a rheostat** in series
  with R43 4.7 kΩ to ground at Q11's base. Q11's emitter (R44 4.7 kΩ load; collector R53 100 Ω / C14 47 µF) is the **trigger bus**
  [P-sch]. = 808 in principle: one global accent carried as the trigger's height (RC §1).
- **Levels (calc)**: unaccented V_N ≈ +B − (V_D6 + V_BE) ≈ +B − 1.3 V — **≈ 4–4.8 V** (+B, the CPU rail, is not printed: ≈ 5.3–6.1 V
  from the +6 V regulator of §2); accented V_A(u) = max(V_N, 15 · 4.7 / (4.7 + R_VR2) − 0.65 V) with R_VR2 = 10 kΩ · (1 − u) (u the
  knob, clockwise = more): **≈ 14.3 V** at full ACCENT, ≈ 6.6 V at mid travel, and at the minimum the accent path (≈ 4.2 V) falls
  under the normal one — accent barely heard, as the spec's output levels say (2 Vp-p at ACCENT MIN, 6 Vp-p at MAX, VOLUME max, the
  levels centred) [P SN6 p1].
- **Per-voice gate**: the voice's instrument line turns on an NPN (2SC945, 22 kΩ / 10 kΩ), which pulls the base of a PNP (2SA733)
  whose emitter sits on the trigger bus (base pull-up 4.7 kΩ; on SD / LT / HT from s/n 161000 a 4.7 kΩ ∥ 1 nF) — the voice receives
  the strobe at its accent height only when its line is high [P-sch]. = 808 (RC §1: NPN + PNP pairs, no latch IC).
- **Pulse width: not in SN6.** The 808 stretches its strobe with a monostable to 1 ms (RC §1); no monostable appears on the 606's
  trigger path, so the width is the CPU's own port timing (firmware). A forum builder guessed 1 ms [W]; the CPU's interrupt clock
  adjustment (TM1) is 1.8 ms per cycle [P SN6 p8] — a lead, not a measurement. **Gap (§14).**
- **Trigger outputs** (rear, mini jacks LT and HT): the strobe through Q20 into IC11 AN6912 comparators timed by R143 / R144 470 kΩ
  with C40 / C50 47 nF (≈ 22 ms, calc), out through Q33 / Q34 (2SA733) from +15C, R157 / R158 1 kΩ, R161 / R162 22 kΩ: **+14 V, 20 ms**
  [P SN6 p1] (OM6's text says +15 V); they fire whenever an LT / HT step plays [P OM6 p19].

## 2. Power and headroom [P SN6 p5]

- **4 × C cells (UM-2, 6 V)** or a 9 V adaptor; 70–150 mA [P] (research-drums' "6 × AA" is wrong).
- **One +15 V rail** from a blocking-oscillator DC–DC converter (T2 MC102C, Q43, Q44 2SD667, D41, zener D42 RD15EB3), split into
  decoupled branches: +15B mixer, +15C trigger outs, +15D band-passes, +15E cymbal and hats, +15F snare and noise, +15G bass drum,
  +15H accent, +15AV the sub board (toms, headphones) [P]. **+6 V** (Q42 2SB596, zener D40 RD6.8EB) and **+5 V** (Q46, from +15 V) for
  the HD14584 chips (tempo clock, metal oscillators) [P].
- **No negative rail**: every op-amp is biased off ground (calc): BD and toms + inputs at **8.9 V**, the snare at **4.2 V**, the noise
  amp, band-passes, high-passes and mixer at **7.5 V**. Op-amps: **NJM2904** everywhere but IC15 (µPC4558, the band-passes); IC10
  (the snare / noise pair) became a µPC4558 from s/n 159500 [P]. The 2904 swings ≈ 0 … 13.5 V on 15 V [S datasheet], so the BD / tom
  stages have ≈ +4.6 / −8.9 V of room and the snare stage ≈ +9.3 / −4.2 V — **asymmetric clipping**, unlike the 808's ± 15 V (RC §16).

## 3. Noise [P SN6 p5, p8; P-sch]

- **Q31** (a 2SC945 marked "selected (NOISE)") as a reverse-biased base–emitter junction (base to ground; emitter fed from +15F via
  R151 100 Ω / C54 47 µF / R150 1 MΩ) — = 808 (RC §11: a junction in breakdown).
- C53 1 µF into **IC10B** (+ input at 7.5 V by R119 / R148 680 kΩ / 680 kΩ); gain 1 + R116 1 MΩ / (R117 22 kΩ + TM3 10 kΩ B) ≈ 32–46
  (calc; TM3 trims the level); **C36 22 pF across R116 rolls the noise off at ≈ 7.2 kHz** (calc) — ≠ 808 (its white source is flat to
  20 kHz).
- Level: **130 mV rms at the test point** (the adjustment; the schematic marks ≈ 1 Vp-p there) [P SN6 p8].
- Feeds the **snare** (C51 47 nF) and the **toms** (sub-board pin 5); the cymbal and hats use only the metal bank [P-sch].

## 4. Bass drum [P-sch]

- Gate Q14 / Q15 (R69 22 kΩ, R68 10 kΩ, R67 10 kΩ, R62 4.7 kΩ). The gated pulse is divided **1/11** (R63 10 kΩ / R64 1 kΩ) and
  coupled by C25 0.47 µF to the + inputs of **both halves of IC5 in parallel**, biased at 8.9 V (R52 10 kΩ, C18 47 µF, R51 22 kΩ,
  R65 47 kΩ).
- **Two fixed bridged-T resonators** (equal capacitors in the op-amp's feedback, R1 bridging them, R2 from their midpoint to ground):
  - **IC5A**: C19 = C20 = 56 nF, R59 680 kΩ (R1), R58 3.3 kΩ (R2) → **60.0 Hz, Q 7.2, τ 38 ms** (calc).
  - **IC5B**: C23 = C24 = 15 nF, R61 560 kΩ, R66 12 kΩ → **129.4 Hz, Q 3.4, τ 8.4 ms** (calc). DS's "60 Hz body, 130 Hz click" agrees [W].
- Bridged-T arithmetic (calc; also for §5–§6): f0 = 1 / (2π C √(R1 R2)), Q = ½ √(R1 / R2), ring τ = R1 · C (independent of R2); with
  the drive on the + input the output is the input plus the band-pass ring (peak gain 1 + R1 / (2 R2)), so the pulse itself is in it.
- Sum: IC5A through R56 10 kΩ + C16 1 µF and IC5B through R60 18 kΩ + C22 1 µF meet at the top of **VR3 50 kΩ B** (BD level) with
  C21 10 nF to ground (≈ 2.5 kHz roll-off with the source resistances, calc); the wiper → R57 47 kΩ → the mixer.
- ≠ 808: two fixed resonators instead of one; **no pitch-attack transistor, no sigh, no tone / decay controls, no trimmers**. = 808:
  the bridged-T in an op-amp loop driven by the gated trigger (RC §2).

## 5. Snare drum [P-sch]

- Gate Q19 / Q18 (R91 22 kΩ, R96 10 kΩ, R95 10 kΩ, R97 4.7 kΩ ∥ C110 1 nF on later units).
- **Tone**: divider R98 10 kΩ / R99 1 kΩ, then **C34 3.3 nF**, which differentiates the pulse into a spike at each edge (τ ≈ 52 µs,
  calc), into IC10A's + input biased at 4.2 V (R101 100 kΩ, C28 47 µF, R113 22 kΩ, R118 47 kΩ). **One** bridged-T: C32 = C33 = 27 nF,
  R112 820 kΩ, R2 = R107 330 Ω + R115 680 Ω → **204.8 Hz, Q 14.2, τ 22 ms** (calc).
- **Pitch kick**: Q17 (collector at the R107 / R115 junction, emitter to ground) shorts R115 while it conducts — toward **≈ 358 Hz**
  at full conduction (calc); its drive: the emitter follower Q16 (base R106 100 kΩ from the gated trigger; collector R104 18 kΩ)
  charges C31 0.47 µF, which reaches Q17's base through R105 27 kΩ (R114 47 kΩ to ground) — so the kick's depth follows the
  trigger's height (accent) and fades over ≈ 10–15 ms (rough calc). The tone leaves through R110 68 kΩ → C30 1 µF → VR4.
- **Noise ("snappy")**: an envelope from the gated trigger — R100 1 kΩ → D26 → C35 0.47 µF → R120 27 kΩ → C37 56 nF to ground → R121
  15 kΩ → a node with C38 1.5 nF → D27 → the **collector of Q30** (C39 2.2 nF to ground); Q30's base takes the noise through C51
  47 nF on a 1 MΩ bias (R147), emitter R146 100 Ω — a swing-type VCA (= 808's snare Q48, RC §3); the output is taken at D27's anode →
  the Sallen-Key high-pass **Q32**: C52 = C58 = 1.8 nF, R153 22 kΩ, base bias 100 kΩ / 100 kΩ, emitter R154 22 kΩ → **≈ 2.67 kHz,
  Q 0.75** (calc) → C57 10 nF → R111 10 kΩ → VR4. Envelope τ ≈ 20 ms (calc, Q30 saturated).
- Level **VR4 50 kΩ B** → R102 10 kΩ → the mixer.
- ≠ 808: one resonator with a transistor pitch kick (the 808 snare has two fixed ones, RC §3); a single envelope; no TONE / SNAPPY.

## 6. Toms (sub board OP3126-060) [P-sch]

- **Low tom**: gate Q303 / Q304 (R303 22 kΩ, R306 10 kΩ, R307 10 kΩ, R308 4.7 kΩ); divider R312 10 kΩ / R311 1 kΩ; **C301 4.7 nF**
  (a differentiated drive) into IC9A's + input at 8.9 V (R322 10 kΩ, C306 47 µF, R320 22 kΩ, R329 47 kΩ). Bridged-T C304 = C305 =
  27 nF, R1 = R324 + R325 = 2 MΩ, R2 = R323 180 Ω + R318 820 Ω with **Q307 across R318** → **131.8 Hz, Q 22.4, τ 54 ms** (calc;
  ≈ 311 Hz with R318 fully shorted). Out R326 15 kΩ → C308 1 µF.
- **High tom**: gate Q301 / Q302 (R301 22 kΩ, R302 10 kΩ, R304 10 kΩ, R305 4.7 kΩ); divider R309 10 kΩ / R310 1 kΩ; **C307 3.9 nF**
  into IC9B (R328 22 kΩ / R330 47 kΩ from the same bias node). C310 = C311 = 18 nF, R1 = R335 + R336 = 2 MΩ, R2 = R334 100 Ω + R333
  820 Ω with **Q308 across R333** → **206.1 Hz, Q 23.3, τ 36 ms** (calc). Out R327 15 kΩ → C309 1 µF.
- **One shared envelope**: D302 / D301 from the two gated triggers and Q305 (base via R313 / R314 100 kΩ from either gate) switch the
  PNP **Q306**, which dumps the reservoir **C302 47 µF** through R321 100 Ω into **C303 0.47 µF** — a peak near +15 V **whatever the
  accent** (calc). It drives Q307 through R317 680 kΩ / R319 39 kΩ and Q308 through R331 680 kΩ / R332 22 kΩ: the low tom's pitch
  kick is audible, the high tom's slight (calc) — and **a hit on one tom also bends the other while it rings**.
- **One shared noise "rumble"**: the noise via R341 22 kΩ into the Sallen-Key low-pass **Q309** (R341 = R342 = 22 kΩ, C314 39 nF,
  C315 18 nF) → **≈ 273 Hz, Q 0.74** — the 808's PN filter exactly (RC §11, `dr-808.js` `nz.p`); then R346 10 kΩ / R347 4.7 kΩ → C312
  47 nF → the base of **Q310**, whose base also takes the shared envelope (R337 2.2 kΩ / C313 68 nF / R338 1 MΩ / R339 33 kΩ): a
  base-driven common-emitter stage (R350 4.7 kΩ + R351 10 kΩ, C318 47 µF) — ≠ the swing VCAs; envelope τ ≈ 120 ms (calc). Out C316
  47 nF → R340 22 kΩ → R348 10 kΩ / C317 10 nF (≈ 1.6 kHz) → R349 100 kΩ → the tom bus.
- Level: **one pot, VR5 50 kΩ B "L,H TOM"**, → R108 22 kΩ → the mixer.
- = 808: bridged-T toms with a PN rumble (RC §4). ≠ 808: the pitch drop of the 808's diode pair is replaced by a transistor kick in
  R2, the envelope, the rumble and the level are shared by the two toms.

## 7. The metal bank and the band-passes [P-sch; S MK]

- **IC16 HD14584BP at +5 V**: six Schmitt-inverter RC oscillators (R from the output back to the input, C from the input to ground):

  | osc (pins) | R | C | R·C | f = 2.07 / RC (calc) | MK [S] |
  |---|---|---|---|---|---|
  | A (1/2) | R226 330 kΩ (**680 kΩ from the "84 lot"**) | C99 15 nF | 4.95 ms (10.2 ms) | **418 Hz** (203 Hz) | 415 |
  | B (3/4) | R225 470 kΩ | C98 10 nF | 4.70 ms | **440 Hz** | 437 |
  | C (5/6) | R224 330 kΩ | C97 10 nF | 3.30 ms | **627 Hz** | 619 |
  | D (13/12) | R244 560 kΩ | C107 15 nF | 8.40 ms | **246 Hz** | 245 |
  | E (11/10) | R245 560 kΩ | C108 12 nF | 6.72 ms | **308 Hz** | 306 |
  | F (9/8) | R246 470 kΩ | C109 12 nF | 5.64 ms | **367 Hz** | 365 |

  The constant: the same chip on the same 5 V in the 808 gives **f · RC ≈ 2.07** at the top of its two trimmed oscillators' ranges
  (#5: 100 kΩ, 18 nF, 1149.9 Hz; #6: 150 kΩ, 22 nF, 627.2 Hz — RC §7, Werner's ranges), and MK's figures imply 2.05: they agree
  within 1 %. The **duty cycle** depends only on the chip's thresholds and rail: **47.98 %** as the 808's (RC §7) [R, same IC and rail].
- **The R226 change** (SN6 p8's engineering changes: "from s/n 148400" / the schematic's "84 lot ~ 680 kΩ") moved oscillator A an
  octave down "for a better cymbal" [P]: early and late 606s differ in their metal. Which to model: IMPL-7b §2.2 / §13 Q3.
- **Sum**: each output through **150 kΩ** (R229 / R228 / R227 / R232 / R231 / R230) into a node with **R210 1 kΩ** to ground (≈ 33 mV
  per oscillator, calc) — ≠ 808 (120 kΩ into R53 1 kΩ, RC §16.7).
- **The band-passes** on IC15 µPC4558 at 7.5 V: **IC15B** (input C92 3.3 nF + R221 33 kΩ; C90 = C91 6.8 nF; R222 560 Ω; R220 82 kΩ)
  → **≈ 3454 Hz, Q ≈ 6**, the cymbal's low band; **IC15A** (input C96 1 nF + R211 22 kΩ; C94 = C95 3.3 nF; R223 560 Ω; R212 82 kΩ) →
  **≈ 7117 Hz**, the hats and the cymbal's high band — **the 808's two band-passes, value for value** (RC §16.7) [P-sch].

## 8. Cymbal [P-sch]

- Gate Q28 / Q29 (R89 22 kΩ, R125 10 kΩ, R126 10 kΩ, R127 4.7 kΩ) → R141 220 Ω, charging two envelopes through D28 and D29.
- **Long envelope E1**: C49 1 µF bled by R163 + R164 = 2 MΩ, buffered by Q35 (emitter load R183 + R184 = 15 kΩ + 15 kΩ): τ ≈ 1.5–2 s
  (calc).
- **Low band**: Q35's emitter → R185 33 kΩ → C61 2.2 µF → R186 33 kΩ → D35 → the **collector of Q39** (C77 2.2 nF to ground); Q39's
  base takes the 3454 Hz band through C76 47 nF on a 1 MΩ bias (R202), emitter R201 100 Ω — a swing-type VCA (= 808 CY Q18, RC §8);
  out at D35's anode → the Sallen-Key high-pass **Q40** (C59 = C60 2.2 nF, R159 22 kΩ, bias 100 kΩ / 100 kΩ, R197 22 kΩ) **≈ 2.18 kHz,
  Q 0.75** → C79 10 nF → R198 47 kΩ / C78 3.3 nF (≈ 1 kHz, one pole) → R200 22 kΩ → VR6. Its envelope arrives ≈ 70 ms late (C61's RC).
- **High band**: D29 → C47 1 µF (with R165 68 kΩ → C48 2.2 µF) → R166 22 kΩ → a node that also takes half of E1 through R181 33 kΩ
  (from the R183 / R184 midpoint) → D34 → the **collector of Q38** (C64 2.2 nF); Q38's base takes the 7117 Hz band through C65 1 µF
  on 1 MΩ (R180), emitter R179 100 Ω; out at D34's anode → C62 2.2 nF → **IC12B** Sallen-Key high-pass (C63 = C73 1 nF, R203 18 kΩ,
  bias 39 kΩ / 39 kΩ, gain 2) **≈ 8.5 kHz, Q ≈ 1.1** → R204 5.6 kΩ → C75 1 µF → VR6. Envelope (calc): a ≈ 22 ms fast part, a ≈ 0.2 s
  tail from C48, a floor of half E1. The high band dominates.
- Level **VR6 50 kΩ B** → R109 10 kΩ → the mixer.
- ≠ 808: two bands (the 808 has three, RC §8), fixed envelopes, no TONE / DECAY pots, its own oscillator frequencies.

## 9. Hats, the choke and the tempo-linked cut [P-sch; S TT, ZB; P OM6 p9]

- **One VCA for both hats**: the 7117 Hz band → C66 1 µF + R173 1 MΩ into the base of **Q37** (emitter R171 100 Ω; collector C43
  2.2 nF to ground) — a swing-type VCA with **two supplies**, each through its own diode into Q37's collector.
- **Open**: gate Q26 / Q27 (R88 22 kΩ, R128 10 kΩ, R129 10 kΩ, R130 4.7 kΩ) → D30 → R140 220 Ω → **C45 1 µF**, bled by R167 1 MΩ;
  buffered by Q36 (R168 33 kΩ in, R169 33 kΩ emitter) → R170 33 kΩ → D33 → Q37's collector. Natural τ ≈ 0.8 s (calc).
- **Closed**: gate Q21 / Q22 (R84 22 kΩ, R85 10 kΩ, R86 10 kΩ, R87 4.7 kΩ, R132 22 kΩ) → R133 220 Ω → D31 → **C42 0.47 µF** → R134
  33 kΩ → D32 → Q37's collector. τ ≈ 14 ms (calc, C42 · R134 ≈ 15.5 ms).
- **Pick-offs**: at each diode's anode, C67 2.2 nF (open) and C44 2.2 nF (closed), summed into R172 12 kΩ → **IC12A** Sallen-Key
  high-pass (C69 = C70 1 nF, R174 18 kΩ, bias R175 / R176 39 kΩ, gain 2 through R177 / R179 39 kΩ) **≈ 8.5 kHz** → C74 1 µF → **VR7
  50 kΩ B "O,C HIHAT"** (one pot for both) → R149 22 kΩ → the mixer.
- **The choke**: C42 holds **Q25** on through R135 330 kΩ; Q25 and **Q24** (collectors joined) drain C45 through **R137 100 kΩ**
  (τ ≈ 100 ms: a soft choke); C46 0.47 µF / R136 100 kΩ hang off that node. = 808 in principle (RC §9: C63 / R173 / Q23 / R134).
- **Open and closed on one step** (OM6 notates it as its own "open + close" hat and says the closed hat then sounds accented): both
  supplies diode-OR into Q37's collector — the higher one carries the signal, the other pick-off goes nearly quiet — and the closed
  hat chokes the open one; ZB: "together they sound different" [P OM6 p9; calc; S ZB]. The model gets this from the circuit.
- **The tempo-linked open-hat cut** (unique to the 606): Q24's base is fed from **C41 56 nF** through R131 100 kΩ; C41 is charged by
  the **tempo clock**'s pulses (IC1 pin 10 → D1 → R6 15 kΩ) and emptied by **Q23** (from the open hat's gate through R138 22 kΩ /
  R139 10 kΩ) at every open-hat hit. So a tempo-dependent number of clock pulses after an open hat, Q24 conducts and drains C45: the
  open hat is cut sooner at faster tempos — **even when the 606 is slaved**, since the internal clock keeps running at the TEMPO knob
  [P-sch; S TT, ZB]. How many pulses: not stated anywhere; it follows from each pulse's width (below) [§14].
- **The tempo clock** [P-sch SN6 p4]: IC1 HD14584B at +5 V — C8 0.039 µF discharged towards ground through R12 47 kΩ + TM2 100 kΩ B
  (trim; 22 kΩ B with R12 100 kΩ on lots 1–46; 220 kΩ B for the "84 lot") + **VR1 1 MΩ C** (TEMPO); when it crosses the lower
  threshold, the second inverter (pins 13 / 12) pulls C10 1 nF down through D4 and turns on the PNP **Q2** (R13 47 kΩ, R22 47 kΩ),
  which recharges C8 at once — a relaxation oscillator whose pin-10 output is a **narrow pulse** each period (Q2 recharging C8 across
  the hysteresis: microseconds, calc). **24 pulses per quarter note**: the adjustment sets **8 ms per cycle at FAST** (≈ 312 BPM) and
  **65 ms at SLOW** (≈ 38 BPM) [P SN6 p8; calc]; IC2a (HD14013) divides it for the CPU. calc: with a ≈ 1–2 µs pulse each one adds
  ≈ 5–10 mV to C41 through R6, i.e. tens of pulses (one to four beats) before Q24 turns on; a wider pulse would cut far sooner (TT
  suggests "after a few steps"): the model takes the pulse from the oscillator's components and lane V6 records the result (§14).

## 10. Mixer and output [P-sch; P SN6 p1]

- Front pots: **ACCENT 10 kΩ B** (§1); **BD, SD, L,H TOM, CY, O,C HIHAT 50 kΩ B**, each a divider from its voice's output; **VOLUME VR8
  50 kΩ A** with the power switch. (The parts list swaps the TEMPO / VOLUME descriptions against the schematic.)
- **IC14A** summing amp at 7.5 V (input C56 2.2 µF): feedback R189 47 kΩ ∥ C86 220 pF (≈ 15.4 kHz); series resistors **BD R57 47 kΩ,
  SD R102 10 kΩ, toms R108 22 kΩ, CY R109 10 kΩ, hats R149 22 kΩ** (gains 1.0 / 4.7 / 2.1 / 4.7 / 2.1 before the pots' own source
  resistance).
- Output: C87 2.2 µF → VR8 → R191 22 kΩ → C83 2.2 µF → **IC14B** (R190 33 kΩ ∥ C88 220 pF: gain −1.5) → clamp diodes D36 / D37 → C89
  2.2 µF → R219 47 kΩ to ground → **R218 1 kΩ** → OUTPUT (¼"): **1 kΩ source, 2 / 6 Vp-p** (accent min / max) [P].
- Headphones: IC13 LA4140 on the sub board (stereo jack, 8–30 Ω; the jack switches +6 V to the amp) — not modelled (the mix is the
  output).

## 11. Same and different, per voice (the build's map)

| voice | = 808 (RC) | ≠ 808 |
|---|---|---|
| trigger / accent | one strobe, per-voice NPN + PNP gate, accent as the trigger's height ≈ 4 → 14 V | the ACCENT pot is a rheostat (a non-linear law, §1); pulse width unknown |
| noise | a junction-noise transistor | one-pole roll-off at ≈ 7.2 kHz; 130 mV rms |
| BD | bridged-T in an op-amp loop | two fixed resonators (60 / 129 Hz), no attack switch, no sigh, no controls; single-supply headroom |
| SD | swing-type noise VCA, Sallen-Key high-pass | one resonator (205 Hz) with a transistor pitch kick (Q17 — the 808 BD's Q43 idea in R2); one envelope |
| toms | bridged-T, the 273 Hz PN rumble (same values) | transistor kicks in R2 from one shared envelope; shared rumble (a CE stage) and one level pot |
| metal bank | six HD14584 squares at 5 V, duty 47.98 %, the same two band-passes | other frequencies (246–627 Hz), 150 kΩ / 1 kΩ sum, the R226 revision |
| CY | swing-type VCAs on the two bands | two bands (not three), fixed envelopes, no TONE / DECAY |
| hats | the 7117 Hz band, a capacitor-held choke | one VCA for both, one high-pass, one level pot; the open hat cut by the tempo clock |
| mix / output | summing amp, master pot, output amp | single supply (7.5 V bias), clamp diodes, 1 kΩ out, 2–6 Vp-p |

## 12. Sequencer and memory [P OM6 unless tagged]

- **MODE rotary, 4 positions** (clockwise): **TRACK WRITE, TRACK PLAY, PATTERN PLAY, PATTERN WRITE** (the schematic's TW / TP / PP /
  PW) [P OM6 p17; SN6]; PATTERN PLAY ↔ PATTERN WRITE may be switched while running (live editing) [W vintagesynth; consistent with
  OM6, which edits only while running].
- **INSTRUMENT / TRACK rotary, 8 positions**: AC 1, BD 2, SD 3, LT 4, HT 5, CY 6, OH 7, CH 8 — the voice (or accent) in pattern
  modes, the track 1–8 in track modes [P OM6 p8, p17; V].
- **32 patterns** = 16 keys × **PATTERN GROUP I / II** (a button with two LEDs; changed only while stopped) [P OM6 p17, p23–24]; **1–16
  steps** each [P spec].
- **SCALE** (a 4-position slide switch, the schematic's "PRE SCALE"; 1 at the bottom, 4 at the top [V]): **1 = sixteenths (4 a beat),
  2 = thirty-seconds (8), 3 = eighth triplets (3), 4 = sixteenth triplets (6)** [P OM6 p32]; **stored per pattern**, latched into the
  playing pattern by pressing FUNCTION while running in PATTERN WRITE (no effect stopped) [P OM6 p17–18]. A bar longer than 16 steps
  is two chained patterns [P OM6 p32–33]. At 24 PPQN every scale is a whole number of clocks a step (6 / 3 / 8 / 4, calc).
- **LAST STEP**: running in PATTERN WRITE, FUNCTION held + the key of the last step [P OM6 p8, p18, p25]; FUNCTION held also shows the
  first step of each beat on the LEDs (scale 1: 1, 5, 9, 13).
- **Selecting / clearing**: stopped in PATTERN WRITE a key selects the pattern (its LED flashes) [p7, p24]; **PATTERN CLEAR** = that
  key held + CLEAR/RESET (the group LED flashes; scale and last step kept) [p17, p24]; two keys held + CLEAR clear a chain's two [p27].
- **Step entry**: the keys toggle the selected voice's steps **only while running** in PATTERN WRITE (stopped they select patterns);
  the lit LEDs are that voice's steps [p8, p18, p25]. **CLEAR/RESET held while running erases the selected voice's notes** (hold until
  they are gone: they go as they pass) [p8, p25].
- **TAP** (the WRITE/NEXT key): running in PATTERN WRITE, writes the selected voice at the current position [p8, p18, p25]; running in
  PATTERN PLAY it is **STEP RESET** — the current pattern restarts from step 1 at once (in a chain, that pattern) [p18, p24] (E&MM
  says "the next pattern of the chain": the manual wins).
- **Accent**: AC (position 1) is a step row like a voice: one accent for every voice on that step; no per-voice accent [p8, p17].
- **Chains** (PATTERN PLAY, or PATTERN WRITE stopped): two keys pressed together **inside one block of four** (1–4, 5–8, 9–12, 13–16)
  play the range first → last in order and loop (max 4; never across blocks); LEDs: the first flashing, the rest steady; each pattern
  keeps its own scale and last step [p13, p24, p27].
- **Pattern changes**: a new pattern starts after the current measure finishes [p23, p13]; with a chain running, the manual's example
  changes "at the end of #4" — the chain's end, or the pattern's (ambiguous) [§14].
- **Tracks**: 8; **tracks 1–7 hold 64 bars, track 8 holds 256** [p3, p17, p29, spec]; writing past bar 64 continues into the next
  tracks ("automatic track selection", up to 4 tracks, ≤ 256 bars; bar numbers count from the first track) [p29, p31]; **one pattern
  group per track** (chosen stopped in TRACK WRITE with PATTERN GROUP; TRACK PLAY recalls it) [p18, p29] — 4 bits a bar in the RAM [I].
- **Writing a track** (while running) [p14–15, p29, p31]: stopped in TRACK WRITE pick the track and group; CLEAR/RESET (= BAR RESET
  stopped) → bar 1; RUN: the bar's pattern loops; a key (or two: a chain) is heard from the next bar but not yet written; **TAP
  writes the pattern heard into the current bar and advances** (a chain advances by its length); the last bar: the pattern, then
  **CLEAR/RESET (D.C.) + TAP** writes it as the D.C. bar; stop. Stopped, TAP steps one bar forward (to check); running in TRACK
  WRITE the LEDs show the current bar's pattern.
- **D.C.**: after the D.C. bar the track returns to bar 1 and loops; one per track (a new one replaces it) [p15, p30–31]. **D.S. /
  segno**: running in TRACK WRITE, PATTERN GROUP then TAP marks the segno bar; in TRACK PLAY, TAP (legend "D.S.") jumps there (p19:
  at once; p31: after the playing bar) [p30–31].
- **The bar keypad** (FUNCTION held + keys): the BAR strip under the keys reads 1–9, 0, 100, 200, two blank, DEL, INS; locate e.g.
  FUNCTION + 100, 1, 5 = bar 115 (hundreds and tens lit, units flashing); FUNCTION while running shows the current bar; stopped,
  FUNCTION + CLEAR shows the D.C. bar, FUNCTION + PATTERN GROUP the segno bar [p18, p31; S TR06]. **DEL / INS** (stopped, TRACK
  WRITE): locate, then FUNCTION + DEL removes that bar; FUNCTION + INS duplicates it, shifting the rest [p31].
- **TRACK PLAY**: CLEAR/RESET stopped returns to bar 1 (or locate any bar), then RUN [p15, p29]; CLEAR does nothing while running
  [p17].
- **Transport and sync**: RUN/STOP (and a rear ¼" pedal jack, DP-2) [p19]; **TEMPO 40–300** (a quarter note), continuous, not stored
  [p17, p23, spec]; **DIN sync** (5-pin: 1 run/stop, 2 ground, 3 tempo clock, the schematic adds 4 = TAP) with an **INPUT / OUTPUT
  slide switch** (at OUTPUT the 606 runs alone and drives others; at INPUT it needs an external clock) [p4, p23; SN6]; 24 PPQN [calc
  §9]. The classic pairing: the 606 at OUTPUT drives the TB-303's SYNC IN (the 303 has an input only) [W Kenton, Wikipedia, Gearspace].
- **Memory**: battery-backed CMOS RAM (the 4 C cells keep it, also on the adaptor); no preset patterns in ROM [p1, p5, p23; I].
- **Quirks**: keys must be released between operations [p8]; the tom pair and the hat pair share their level knobs [spec; E&MM].
- **LEDs**: stopped in pattern modes the selected key flashes (a chain: the first flashing, the rest steady); running in PATTERN PLAY
  they chase 1 → last step [p23]; running in PATTERN WRITE they scan and the selected voice's steps light [p7–8]; FUNCTION held: the
  beat markers; PATTERN CLEAR: the group LED flashes; RUN / BATTERY LED lit while running (flashing or dark: low batteries).

## 13. Panel layout (for our own art) [V `Roland_TR-606.jpg` at 3.69 px/mm; P spec]

- **300 W × 146 D × 55 H mm, 1.2 kg** [P SN6 p1] (OM6's 3.7 kg is a misprint); the TB-303's form factor [S RA]. Coordinates: mm from
  the top-left corner, x right, y towards the player, ± 1.5 mm.
- **Band A** (silver, y 0–26.6): the rear-connector legends with ▲ marks at y ≈ 2.7 / 6 — RUN/STOP (DP-2) x 15.6, INPUT ▲ OUTPUT (the
  sync switch) x 35.0, SYNC x 58.7, TRIGGER OUT LT x 221 / HT x 233, HEADPHONE x 248, OUTPUT x 267.5, DC 9V x 283.5; a maker-mark zone
  (x 11–64, y 13.5–22) and a wordmark zone (x 229–285, y 14–22) — ours stay empty or plain type; dividers at x 75.3 and 215.7; **six
  knobs at y 14.9, pitch 22.8**: ACCENT 88.6, BASS DRUM 111.4, SNARE DRUM 134.1, L.H.TOM 157.0, CYMBAL 179.9, O.C.HIHAT 202.4 (cap
  Ø ≈ 12, skirt ≈ 17, tick ring ≈ 20; names at y ≈ 3).
- **Band B** (silver, y 27.6–71.3; names at y ≈ 32): **TEMPO** (43.2, 52.0), skirt Ø ≈ 24, ticks Ø ≈ 34, SLOW / FAST at y ≈ 64;
  **TRACK / INSTRUMENT** (88.6, 52.3), detent dots at r ≈ 14 at −105° (AC 1), −75°, −45°, −15°, +15°, +45°, +75°, +105° (CH 8)
  clockwise from 12 o'clock (numbers in black squares, TRACK reversed out); **MODE** (134.0, 52.1), dots at +37° TRACK WRITE, +67°
  TRACK PLAY, +97° PATTERN PLAY, +127° PATTERN WRITE with bracketed legends to the right (TRACK / WRITE / PLAY reversed out, PATTERN /
  PLAY / WRITE plain — the TB-303's MODE print, panels/tb303.js); the model name in plain type at x 182–240, y 45–59; **VOLUME /
  POWER** (263.8, 52.6), POWER SW OFF lower left, MAX lower right.
- **Band C** (near-black, y 75–137, x 3.3–297, inside a silver frame y 71.8–139; the case lip to 145.5):
  - left block (x 5–34): upper box — D.C. and BAR RESET boxed at y 81, PATTERN CLEAR at y 87, the **CLEAR/RESET** key (19.7, 93)
    ≈ 13 × 5; lower box — RUN ● BATTERY LED (19.5, 103.5), the **RUN/STOP** key (19.2, 113.8) ≈ 17 × 12, its name at y 125;
  - the scale column (x 35–49): the **SCALE** slide switch at x ≈ 42.5 (stops 4 y 82.1, 3 y 86.2, 2 y 90.2, 1 y 94.9) with slanted
    leaders to the graphic rows; SCALE at y 100, FUNCTION at y 105; the **FUNCTION** key (42, 113.8) ≈ 5 × 12;
  - the scale graphic (x 49.9–266.7), four black rows split by white hairlines — scale 4 (y 75.3–82.4) groups of six keys with
    slurred eighth-note marks, scale 3 (83.2–89.2) groups of three, scale 2 (90.0–94.6) groups of eight with quarter marks at keys 1
    and 9, scale 1 (95.4–99.7) groups of four with quarter marks at 1, 5, 9, 13 (our glyphs);
  - **16 step keys**: cell k at x = 49.9 + 13.55 (k − 1), 13.55 wide; centres x = 56.6 + 13.55 (k − 1); LED at y 103; cap ≈ 5.4 × 12.2
    at y 113.8; the light key strip y 100.3–122.5; the **LAST STEP** band (y 122.8–128.2: an outline arrow and the numbers 1–16 in
    orange-red on black) and the **BAR** band (y 128.5–134.4: 1–9, 0, 100, 200, two slashes, DEL, INS in white on black rounded
    boxes); their labels at x ≈ 35–52;
  - right block (x 267–296): upper box — the segno sign boxed at (280.9, 79.3), the group LEDs I (275.6, 84.5) and II (285.8, 84.5),
    PATTERN GROUP at y 88, its key (281.7, 92.6) ≈ 11 × 5; lower box — D.S. boxed at (280.9, 103.4), the **TAP** key (281.3, 113.8)
    ≈ 17.6 × 12.2, WRITE/NEXT boxed at y 123, TAP at y 127.6, STEP RESET at y 131.
- **Colours** [V]: silver / aluminium-grey top bands with dark grey print; the near-black lower panel with white print and hairline
  boxes; the light grey key strip with grey caps (light grey to greige between photos) and red 3 mm LEDs; aluminium knob caps with
  knurled skirts; the two rotaries with a bar-grip cap in a round skirt (the TB-303's selector skin).
- **Rear** (seen from behind, left → right): DC 9V, OUTPUT, HEADPHONE, the two trigger outs, a gap, the SYNC DIN, the INPUT / OUTPUT
  switch, RUN/STOP [P OM6 p6, p16].

## 14. Gaps and the reconstruction rule (lane V6)

- **Re-read every value** used from the SN6 scans (or a clone's documented redraw of the same circuit); record the final table in §15
  with designators; flag any value read differently from §1–§10. No scan or crop is committed; nothing of the notes' or manual's
  prose is copied.
- **Two targets per voice**: (a) the model equals **its own analog prototype** (centres ± 1 %, time constants ± 2 %, magnitude ± 0.2 dB
  to 5 kHz at OS 4) — the 808's rule (RC §14); (b) there is **no per-voice typical-values table** in SN6 (only the output's 2 / 6 Vp-p
  and the noise's 130 mV), so (b) becomes: the calc numbers above (§4–§9) within ± 2 % (frequencies) / ± 10 % (time constants), the
  spec's output levels within ± 3 dB (IMPL-7b §12.1), and the [S] descriptions as qualitative checks (BD "60 Hz body, 130 Hz click";
  the open hat shorter at faster tempos; the toms bending each other; open + closed louder than closed).
- **Not in the sources** — the lane decides, tags **[C]** or **[fit]**, records here: the **strobe width** (1 ms [C], the 808's,
  unless the lane finds better: it sets how the snare's and toms' two edge spikes add up); **+B** (V_N: the CPU rail from the +6 V
  regulator, ≈ 4.8 V, else 4.5 V [C]); the **tempo clock's pulse** (from IC1 / Q2 / C10 / R13 / R22 / C8: its width and so the
  charge each pulse puts on C41 — record the resulting cut time vs tempo at 60 / 120 / 240 BPM); the HD14584's thresholds (the 2.07
  constant and the 47.98 % duty from the 808's numbers); the NJM2904's swing (0 … 13.5 V on 15 V [typ]); the swing VCAs' bias
  returns (C51 / R147, C76 / R202, C65 / R180, C66 / R173: to which rail); C46 / R136's role at the Q24 / Q25 node; the LA4140
  headphone amp (not modelled).
- **Read twice** (the skeptic review, 2026-10-20): **R179** is Q38's emitter resistor, 100 Ω, in §8 and half of IC12A's gain-2
  network, 39 kΩ, in §9 — one designator is misread (IC12B's gain resistors, §8, are not given at all); V6 re-reads both
  stages' feedback networks.
- **Checked, no gap** (the skeptic review): the NJM2904's finite gain–bandwidth (0.6 MHz typ. [S datasheet]) barely moves the
  bridged-T poles even where the peak gain nears 1000 — with a one-pole op-amp the resonances shift by ≤ 0.8 % at rest (LT 131.2,
  HT 204.5, SD 203.8 Hz; τ + 1–2 %) and the transistor kicks' tops by ≈ − 2–3 % (LT 302.5, SD 353.1 Hz); the calc numbers of
  §4–§6 stand as target (b). V6 may still model the GBW (as the 808's `bandH` does for the 4558).
- **Sequencer points left open by OM6** (IMPL-7b §3.3 decides each one, [C]): TAP's rounding (nearest step, the 808's rule); how the
  PATTERN WRITE LEDs combine the scan and the steps; a pattern change during a chain (end of the pattern or of the chain); a track
  with no D.C. bar; D.C. / segno after DEL / INS; whether chained tracks share one group; the TRACK selector while a track plays; D.S.
  at once or at the bar's end; the two slashes on keys 13–14 (no function documented); whether accent reaches the trigger outs.

## 15. The component tables as modelled (lane V6 fills)

(Lane V6, 2026-10-…: one table per voice with designators, values, sources and every [fit] / [C] — the 808's §16 format.)
