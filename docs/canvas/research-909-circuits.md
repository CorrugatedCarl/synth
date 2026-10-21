# The TR-909's circuits, sequencer and panel — research appendix to IMPL-7c

Facts for the stage 7c build lanes, cited from [IMPL-7c.md](IMPL-7c.md) as **R9 §n**. Everything is in our own words: circuit
topologies, component values, frequencies, behaviours and panel positions are facts; no manual or service-note prose is
reproduced, no schematic or photograph is redistributed, no recording is used — and **no data of the 909's cymbal and hi-hat ROMs
is ever fetched, read, analysed or compared** (IMPL-7c D4). Gathered 2026-10-20 (two research passes; the lead re-read the
sampled-voice section and the trigger / accent paragraphs of the service notes). [research-drums.md](research-drums.md) §3 A2 is
the wider survey (its "sawtooth" BD and "18 kHz" sample rate are superseded here); [research-808-circuits.md](research-808-circuits.md)
(**RC**) and [research-606-circuits.md](research-606-circuits.md) (**R6**) are the 808's and the 606's appendices.

Tags: **[P]** primary — the TR-909 service notes (**SN9**) or owner's manual (**OM9**) through their archive.org OCR text, the
manual's page images viewed (not downloaded); **[S]** reputable secondary — a magazine review, Sound On Sound, a documented clone
or research project that read the schematic and measured units (their own CONFIRMED / DERIVED / MEASURED / UNVERIFIED labels kept as
[S-d] derived, [S-m] measured, [S-u] unverified); **[W]** weak (a forum post, an aggregator); **[V]** seen on a photograph; **calc**
our arithmetic. Component designators are the service notes'.

## 0. Sources

- **SN9** — Roland TR-909 Service Notes, 1st edition (15 June 1984), archive.org OCR [P]:
  https://archive.org/download/synth_Roland_TR-909_service_notes/Roland_TR-909_service_notes_djvu.txt (a second OCR:
  https://archive.org/download/roland_TR-909_SERVICE_NOTES/TR-909_SERVICE_NOTES_djvu.txt). The OCR carries the circuit
  descriptions, the parts list, the engineering changes, the MIDI tables and the specifications; the schematic's component values
  are images only (not fetched).
- **OM9** — the TR-909 owner's manual, archive.org OCR + page images viewed [P]:
  https://archive.org/download/synthmanual-roland-tr-909-owners-manual/rolandtr-909ownersmanual_djvu.txt ("p.N" = the printed page).
- **MW** — mattWoolly/mw909, research notes from the schematic and one or two measured units [S] (AGPL code: facts only, nothing
  copied): https://github.com/mattWoolly/mw909 — `research/01-voices-analog.md` (**MW1**), `02-voices-sample.md` (**MW2**),
  `03-system-sequencer.md` (**MW3**).
- **M9** — DMDaudio/model909, `research/909-circuits.md` [S]: https://github.com/DMDaudio/model909
- **CF** — Colin Fraser's 909 pages (sound mods, his clone, "cloning the 909 cymbals") [S]: http://colinfraser.com/tr909/
- **ED** — Electric Druid, "A look at the TR-909's noise generator" [S]: https://electricdruid.net/tr-909-noise-generator/
- **SOS** — Sound On Sound Synth Secrets: practical bass drum / snare / cymbal synthesis [S] (functional block diagrams; their
  frequencies are SOS's own models, not Roland data).
- **MUZ** — One Two Testing, April 1984 review [S]: https://www.muzines.co.uk/articles/roland-tr909/6511
- **ATK** — Attack magazine's interview with the cymbal samples' maker (history only) [S]:
  https://www.attackmagazine.com/features/interview/atsushi-hoshiai-the-man-behind-the-tr-909/
- **MAME** — the `roland_tr909.cpp` skeleton driver (a memory map, ROM sizes; no sound) [S]:
  https://github.com/mamedev/mame/blob/master/src/mame/roland/roland_tr909.cpp
- **N90** — the 9090 clone's archived notes [S]: https://nuxx.net/wiki_archive/A/9090 ; **NS** — normalsounds' 909 modifications
  [W]: https://normalsounds.com/blog/tr-909-modifications/ ; **Whittle** — R. Whittle's 909 modification notes [S]:
  https://www.firstpr.com.au/rwi/tr-909/ ; **Tiptop RS909** (a clone's description) [S]: https://modulargrid.net/e/tiptop-audio-rs909
- **FLAM** / **SHUF** — two forum measurements (flam spacing from the trigger out; shuffle from recorded rim shots) [W]:
  http://www.e-licktronic.com/forum/viewtopic.php?f=25&t=1430 , https://www.kvraudio.com/forum/viewtopic.php?t=261858
- Photograph [V]: Wikimedia Commons `Roland_TR-909_(large).png` (a keystone-corrected top view, 2284 × 1349, measured at
  4.70 px/mm against the 486 mm width; ± 3 %). Aggregators [W]: Wikipedia "Roland TR-909" / "DIN sync", polynominal, vintagesynth.

## 1. Trigger and accent [P SN9; S MW3]

- **CPU** µPD7811G (NEC, NMOS) at 12 MHz; 8 KB program ROM, 8 KB battery-backed static RAM [P SN9 parts list; S MAME].
- **Trigger**: per voice a latched bit (two hex D latches, IC1 for BD SD LT MT HT, IC10 for RS HC RIDE CRASH HH and the hats'
  CLOSED / OPEN line) appears as a **+5 V pulse, 2 ms wide**; TRIG resets the voice's generators and starts its envelopes [P SN9].
  Ten trigger lines for eleven sounds: the two hats are **one voice** with a CLOSED / OPEN select line [S MW3].
- **Accent is a held DC level per voice, not the trigger's height** (≠ the 808 / 606): the CPU writes an accent code into one of
  **eight latches (IC2–IC9)** chosen by two decoders; a resistor array (RM-0621) turns each code into a voltage that is **held until
  the next write** [P SN9]. The eight: BD, SD, LT, MT, HT, HH, **RS + HC (shared)**, **CRASH + RIDE (shared)**; 6-bit codes, a
  binary-weighted 5 kΩ network, 0–5 V [S-d MW3]. Each analog voice buffers it × 3.13 (1 + 10k / 4.7k) to ≈ 0–15.6 V; its envelope
  capacitors charge to ≈ V_acc − 1.2 V during the trigger [S-d MW1, MW3]; the buffer probably clips above code ≈ 52–56 [S-u MW3].
- **The front end of an analog voice**: an NPN switch on the trigger, a PNP making an unaccented +15 V pulse (it resets the VCOs,
  forces the comparators and charges the pitch-envelope capacitors), a PNP accent switch passing the held accent voltage during the
  pulse [S MW1].
- **Two accents** [P OM9 p.11, p.25–26]: a **per-voice accent** on BD, SD, LT, MT, HT and the **closed** hat (their two keys: accent
  / normal) — a **fixed** depth; and **TOTAL ACCENT**, a step row of its own that accents every voice sounding on that step, its
  depth the TOTAL ACCENT knob. Both may be set on one step; with TOTAL ACCENT high the per-voice accent "may not be noticed" (the
  buffer's clip). RS, HC, the open hat, crash and ride have total accent only. The TOTAL ACCENT knob (VR1, 100 kΩ B) is read by the
  CPU's analog input, not in the audio path [S MW3; S MAME: an analog input "TOTAL"].
- **How the CPU combines the two into a code** is undocumented (believed additive) [S-u MW3]. Measured spans of TOTAL ACCENT from 0
  to full (one or two units, ± 2 dB): BD +6.2, SD +4.8, LT / MT / HT +7.3 / +7.7 / +7.4, RS +3.9, HC +2.7 dB [S-m MW3]; the closed
  hat's per-voice accent ≈ +4.4 dB [S-m MW2].

## 2. Bass drum [S MW1, CF, N90; S SOS for the blocks]

- **VCO**: a **triangle** (not SOS's "sawtooth"): integrator IC13a (R59 47 kΩ, C14 0.033 µF) with comparator IC13b (R49 100 kΩ, R50
  47 kΩ) and a ± 1 stage IC12b switched by Q10 — symmetric; every hit **resets it to the same phase** [S MW1; S CF; S N90].
- **Shaper**: the triangle through R52 10 kΩ into anti-parallel diodes (1SS133, D10 / D11) and a 2.2 kΩ + 47 Ω divider into the VCA
  Q12's emitter: a rounded near-sine (measured H2 −28, H3 −25.7, H5 / H7 −41 dB re H1) [S-m MW1].
- **Pitch envelope (TUNE)**: C9 charged at the trigger (D7, R21), discharged through R57 and VR2 (TUNE, 100 kΩ A); C9 → IC12A
  (R28 150 kΩ gain, R27 1.5 MΩ offset: the floor) → the VCO's control. f(t) ≈ f_base + Δf · e^(−t/τ): **τ 6.8 ms (TUNE 0) … 29.4 ms
  (10)** [S-d MW1; measured 7.6–29.1], Δf ≈ 216 Hz [S-d] (225–247 [S-m]), so ≈ **280–296 Hz falling to f_base**; **TUNE changes only
  the sweep's decay** — not the base pitch, not the amplitude decay [S MW1, CF; P OM9]. **f_base**: 56.0 Hz derived, **49.2–49.7 Hz
  measured** on two units [S MW1]; ≈ 55 Hz [W NS] — a conflict (§15). C9 was 0.22 µF below s/n 381500 (τ 4.5–19.6 ms) [P SN9, §14].
- **Amplitude envelope (DECAY)**: ENV1 = C8 0.33 µF charged through D9, **clamped ≈ 2.6 V** (D8, R36, R22) — so accent saturates
  near 80 % TOTAL ACCENT [S MW1]; a **hold** stage first (C7 0.033 µF, R18 470 kΩ, Q3: ≈ 47–50 ms derived, 61–63 ms measured, whatever
  the accent and DECAY); then C8 discharges through VR5 (DECAY, 1 MΩ A) + R58 47 kΩ ∥ R54 470 kΩ: **τ ≈ 14–107 ms** [S-d]; the tail
  reaches zero in finite time (a threshold). −20 dB at DECAY 0 / 25 / 50 / 75 / 100 %: ≈ 91–101, 141–145, 171–176, 203–212, 298–299 ms
  [S-m MW1].
- **ATTACK (the click)** [P OM9 "the attack sound"; S MW1, CF]: VR3 (500 Ω rheostat) in the emitter of the click VCA Q6 (≈ 7.5 dB of
  range). The click = a pulse path (C2 3.3 nF differentiator → a unity Sallen-Key low-pass ≈ 3.7 kHz, Q ≈ 3.1) + the shared noise
  (§7) divided by ≈ 3.6, high-passed ≈ 26 Hz, low-passed ≈ 513 Hz; its own fast envelope ENV2 (C12 0.033 µF; τ 0.7 or 15.5 ms
  [S-u]). Measured: the click peaks at 1.5–1.6 ms, −20 dB by 2.5–3.8 ms, ≈ 7 dB under the hit's peak [S-m MW1].
- **Output**: Q12 and Q6 summed by IC11a; LEVEL VR4 (100 kΩ B) as its feedback resistor [S MW1]. ≈ 1.2 / 0.61 Vp-p accented /
  not at the multi-out, knobs centred [S-u MW1, from the service notes' scope drawing].
- **Accent**: ENV1's start (clamped) and the click's amplitude; **not** the sweep's depth, base or τ (measured constant over 0–100 %)
  [S-m MW1] — SN9's block diagram seems to show accent into the pitch envelope [S MW3]: a conflict, the measurement kept (§15).

## 3. Snare drum [P SN9 text; S MW1, SOS]

- **Two triangle VCOs** sharing one control-voltage generator (IC35): each a hysteresis comparator, inverting buffers acting as a
  voltage-dependent resistor, an integrator and a switch; VCO-1 the lower (C69 0.01 µF), VCO-2 the same circuit with C71 0.0068 µF;
  diode rounding (D65 / 66, D69 / 70); VCO-2 ≈ 9 dB under VCO-1 [P SN9; S MW1]. The trigger resets VCO-1 and mutes its VCA (Q50)
  for a moment, so both start in phase [P SN9].
- **TUNE** (VR6 10 kΩ) sets a node between 1.25 and 2.50 V — an exact 2 : 1 [S MW1]. Measured at 0 / 25 / 50 / 75 / 100 %: VCO-1
  117.4 / 144.7 / 173.5 / 200.9 / 230.7 Hz, VCO-2 176.3 / 217.1 / 260.2 / 301.3 / 346.1 Hz — the ratio **1.500 at every setting**
  (the capacitors predict 1.47: unexplained) [S-m MW1]. SOS's 180 / 330 Hz are SOS's own model [S].
- **Pitch bend**: the CV generator pulses IC36's supplies (ENV-1, ≈ 20 ms) [P SN9]: C66 0.01 µF via D56 / R247 47 kΩ, discharged
  through 470 kΩ + 100 kΩ, τ ≈ 5.7 ms (4.8–5.5 measured), ≈ +216 Hz on VCO-1 at the onset, whatever TUNE and accent [S MW1].
- **Tone VCAs**: VCO-1 → Q50 with ENV3 (τ ≈ 24 ms), VCO-2 → Q51 with ENV2 (τ ≈ 21 ms) [S-d MW1].
- **Noise (SNAPPY)**: the shared noise (§7) divided to a quarter, high-passed ≈ 48 Hz, a unity Sallen-Key low-pass 8.5 kHz (Q ≈ 1.9),
  then split [P SN9 topology; S MW1 values]: (a) a first-order high-pass 1.52 kHz → VCA Q48 with **ENV4, whose decay TONE sets** (VR7
  500 kΩ B: τ ≈ 32–76 ms after a ≈ 24 ms hold; the tail cut off; −40 dB at ≈ 99 ms (TONE 0) … 295 ms (10)); (b) a Sallen-Key high-pass
  4.05 kHz (Q 1.31) → VCA Q47 with ENV5, a ≈ 2 ms burst (the crack; accent gated by Q41) [P SN9]. Recombined at IC39b, **SNAPPY (VR9
  10 kΩ) its feedback** — linear, silent at 0 [S MW1]. OM9: TONE "brightens" the sound [P].
- **Accent**: the starts of ENV2–5 and ENV4's end voltage (a longer snappy); not the bend; +4.8 dB span [S MW1, MW3]; Q4 gates
  accent for ENV3, Q41 for ENV5 [P SN9].

## 4. Toms (LT, MT, HT) [S MW1; P SN9 block diagram]

- Each tom: **three phase-synced triangle VCOs** with diode shapers and transistor VCAs, sharing a TUNE-driven supply; ratios VCO-1 :
  VCO-2 : VCO-3 ≈ 1 : 0.667 : 1.8 (VCO-1 the "middle"); integrators 47 kΩ with C = (LT) 0.022 / 0.033 / 0.012 µF, (MT) 0.018 / 0.027 /
  0.010 µF, (HT) 0.015 / 0.022 / 0.0082 µF [S MW1]. SN9 draws SD, BD and the toms as one family sharing the noise generator [P].
- **TUNE** (10 kΩ linear) gives a 2 : 1 range of the supply; VCO-1 measured at TUNE 0 / 50 / 100 %: **LT 57.0 / 85.8 / 117.2, MT
  71.9 / 106.6 / 141.3, HT 82.8 / 125.4 / 166.7 Hz** [S-m MW1] (M9's fitted centres 61 / 92 / 120 Hz [S]).
- **Pitch envelope**: only the negative supply moves, fed by a fast (0.047 µF · 470 kΩ = 22 ms) and a slow (0.1 µF · 2.2 MΩ = 220
  ms) capacitor: VCO-1 starts 25–38 % sharp, settles in ≈ 42–55 ms, then droops ≈ 7 % over 150–600 ms [S MW1].
- **Attack overdrive**: a timer (0.01 µF · 1 MΩ, ≈ 32 ms on the LT) shunts a 1 kΩ path, ≈ 10× diode drive — VCO-1 starts near-square
  and relaxes to a rounded triangle over 20–30 ms [S MW1].
- **DECAY** (500 kΩ + 56 kΩ) sets VCO-2's "bloom" envelope; ENV1 τ 103 ms (LT) / 70.5 ms (MT, HT), ENV3 τ ≈ 26 (LT, MT) / 22 ms (HT);
  −20 dB over DECAY 0 → 100 % at TUNE 50: LT 165 → 213, MT 103 → 138, HT 108 → 160 ms [S-m MW1].
- **Tom noise**: the shared noise high-passed into a ≈ 0.6–1.6 kHz band: a sub-millisecond tick (Q33, C54) and a steady part (R194)
  gated by each tom's ENV3 into VCO-3 [S MW1]; C54 / R194 changed at s/n 426700 (§14).
- **Accent**: ENV1, ENV2 and ENV3, no clamp; ≈ +7.5 dB span [S MW1, MW3].

## 5. Rim shot [S MW1; P SN9 change note]

- **Not the 808's** (two bridged-T generators, RC §5): **three bridged-T resonators** rung by the trigger's edge — ≈ 220, 488 and 1036
  Hz (measured 219–222, 481–495, 1019–1053 Hz; ring τ ≈ 9.6 / 4.6 / 2.8–3.0 ms) — summed into **anti-parallel diodes clipping at ≈
  ± 0.6 V** → VCA Q65 → a Sallen-Key high-pass ≈ 229 Hz (Q 1.58) [S MW1; S Tiptop RS909's description agrees].
- LEVEL only (100 kΩ B ∥ 220 pF); accent changes the level only (+3.9 dB) [S MW1, MW3]. From s/n 415300 R417 12 kΩ → 3.3 kΩ (the
  1 kHz resonator ≈ 3.6× stronger) [P SN9, §14]. The RS row also fires the rear TRIG OUT (§11).

## 6. Hand clap [S MW1; S MUZ]

- MUZ called it the 808's clap [S]; its **structure** is the 808's (staggered noise bursts + a reverb-like tail, RC §6) but its values
  and its noise (the shared digital noise, §7) are its own [S MW1]:
  - noise → a 47 kΩ feed into a multiple-feedback band-pass ≈ 963 Hz (Q ≈ 2.1);
  - the burst path: a high-pass ≈ 181 Hz → an OTA (BA662A, IC30) with its exponential converter Q38 → a high-pass ≈ 1.94 kHz;
    the burst timing from a quad comparator (AN6912, IC29) and RC timers: onsets **0 / 9.8 / 21.5 / 31.4 ms** [S-m];
  - the tail: a low-pass ≈ 440 Hz → VCA Q37 with a two-pole RC envelope that swells (peak ≈ 25–30 ms) and decays (≈ 90 ms).
- The analog voices' only trimmer: HC's, set for 2 Vp-p at the multi-out with LEVEL centred [S MW1]. LEVEL only [P OM9]; accent into
  the burst generator only (+2.7 dB), not the tail [S MW1, MW3].

## 7. Noise: a digital shift register [P SN9; S ED, MW1]

- A "quasi-random" generator: two 18-bit shift registers (HD14006) cascaded, XOR feedback (HD14070), clocked fast by two XOR gates
  of the same package; a power-up pulse (D48) starts it [P SN9]. 31 stages used, taps 31 and 13 (x³¹ + x¹³ + 1), period 2³¹ − 1;
  the start-up holds the input high ≈ 20–30 ms so the register fills with ones (an all-zero register would lock) [S ED].
- **Clock ≈ 300 kHz** (R184 10 kΩ, C47 100 pF; 0.3–0.46 MHz with the parts' spread); output 0 / +15 V CMOS bits (IC33); its
  spectrum flat beyond 100 kHz [S ED, MW1].
- **One stream feeds** the snare's snappy, the BD's click, the toms' noise and the clap (the rim shot takes none) — so the snare and
  the clap are correlated (the "phasing" users hear) [P SN9 for SD / BD / toms; S MW1, Whittle; S SOS on the TR-09].

## 8. What accent does, voice by voice (summary of §1–§9)

| voice | where the held accent level acts | measured span (TOTAL ACCENT 0 → full) |
|---|---|---|
| BD | ENV1's start (clamped ≈ 2.6 V: saturates ≈ 80 %), the click's amplitude | +6.2 dB |
| SD | ENV2–5's starts, ENV4's end voltage (longer snappy) | +4.8 dB |
| LT / MT / HT | ENV1–3, no clamp | +7.3 / +7.7 / +7.4 dB |
| RS | the VCA's start | +3.9 dB |
| HC | the burst generator only | +2.7 dB |
| hats | the log / exp converter of the hat VCA (Q84, via R481 4.7 kΩ) | CH per-voice accent ≈ +4.4 dB (and longer) |
| crash / ride | their anti-log converters (Q70 / Q68, via R426 / R435 4.7 kΩ) — one shared accent DAC | — |

## 9. Hi-hats, crash and ride: the ROM playback path [P SN9; S MW2, CF, SOS]

- **Sampled, not analog**: the three are PCM played from ROM, recorded from real cymbals and edited before storing; the service notes
  describe one circuit for all three, the hi-hat as the example [P SN9].
- **ROMs**: three Hitachi **HN61256P** mask ROMs, **32 768 × 8** — crash (IC62), hi-hat (IC69), ride (IC54) [P SN9 parts list; S MAME
  sizes]; only **D0–D5** reach the latch: **6-bit unsigned words** (0–63) [S MW2, CF]; the samples' maker worked at 6 bits [S ATK].
- **The hat ROM holds two recordings**: **open 0x0000–0x5FFF (24 576 words)** and **closed 0x6000–0x7FFF (8 192 words)** — the CLOSED
  / OPEN line, through diode OR gates (D196–D199) on the upper address lines, moves the start and the end [P SN9: the stop addresses
  110 0…0 (OPEN) and 010 0…0 (CLOSED, counted from its start); S MW2 the regions]. Crash and ride: 32 768 words each, the counter
  stopping at its end [S MW2].
- **Clock**: a gated RC oscillator (IC72c / d) runs **≈ 60 kHz while the counter runs**, divided by two (IC73) for the address
  counters (HD14040 12-bit + TC4520) — **≈ 30 kHz a word** [P SN9]; ≈ 32 kHz measured from a crash trace (29–35) [S-m MW2]; the RC
  formula gives ≈ 40 kHz (unexplained) [S-d MW2]; polynominal's "18 kHz" has no source [W]. **TRIG resets the counters to zero and
  starts the clock** (run); the clock stops at the end address (stop) [P SN9]. Timing parts [S MW2]: hat R492 12 kΩ fixed, C160 470
  pF, R493 33 kΩ; crash R443 6.8 kΩ + **VR25 10 kΩ B (TUNE)**, C131 470 pF, R442 33 kΩ; ride R441 6.8 kΩ + **VR27 10 kΩ B (TUNE)**,
  C130 470 pF, R440 33 kΩ (R442 / R440 → 10 kΩ from s/n 392600, §14). The TUNE span: 6.8–16.8 kΩ, **× 2.47** (≈ 15.7 semitones;
  ≈ 21–53 kHz about the centre, derived) [S-d MW2]. **A higher TUNE plays the chip faster: higher and shorter** [S MUZ]. The hats have
  **no TUNE** (a well-known mod adds one) [S CF].
- **The end**: the latch (HD14174) **holds the last word** until the next trigger; no loop, no fade beyond the envelope [P SN9; S MW2].
- **DAC**: the latched word through a six-resistor network (RM-0621: RA9 hat, RA10 crash, RA12 ride; latches IC68 / IC63 / IC53),
  coupled by 10 µF (C157 / C127 / C128) [P SN9; S MW2]; the network's weights unverified, binary-weighted assumed (an R-2R in the
  707's descendant [W]) [S-u MW2].
- **Pre-compensated data**: the hat sounds were **compressed** before digitising for signal-to-noise and resolution; the analog
  envelope restores the shape [P SN9]. The crash's envelope was **altered before storing** and is restored at playback by an
  envelope made from the ROM address [P SN9] (the samples' maker: no EQ or compression while recording; levels adjusted on the
  computer afterwards [S ATK]).
- **Crash and ride envelopes — from the address**: the upper address bits (A9–A14) through a second resistor network (RA11 crash, RA13
  ride) and R432 270 kΩ (crash) / R439 470 kΩ (ride) into an anti-log stage (IC52b / IC52a, Q70 / Q68) driving the base of a VCA
  wired as a voltage-controlled potentiometer (Q71 / Q69) [P SN9 for the crash; S MW2]: a **64-step staircase, one step every 512
  words** (≈ 17 ms at 30 kHz) across the whole sample — so the decay **stretches with TUNE** (always the sample's length) [S MW2, CF,
  SOS]. RA13's input map unverified [S-u].
- **Hat envelope — analog RC**: C135 (1 µF) is charged at the trigger through Q73; **CLOSED** switches in R451 10 kΩ + **VR21 (CH
  DECAY, 100 kΩ B)**, about a tenth of the OPEN path, so the closed decay is VR21's alone; **OPEN** uses only R452 100 kΩ + **VR23 (OH
  DECAY, 1 MΩ A)** [P SN9 topology; S MW2 values]: τ ≈ 10–110 ms (CH), 100 ms–1.1 s (OH) [calc]. C135 → R453 220 kΩ → IC67a → R484
  2.2 kΩ → Q84 (a dual PNP log / exp converter) → the VCA Q85 on the coupled DAC signal → IC67b (R483 47 kΩ) → R480 5.6 kΩ → the
  filters [S MW2]; the converter's constants unverified [S-u].
- **The hats are one voice**: one counter, one ROM, one VCA; a closed hit during an open one (or the reverse) resets the counter and
  switches the region — the closed hat "chokes" the open one by retriggering the single voice, not by a choke line; open and closed
  never sound together [P SN9 the common reset; S MW2, CF].
- **Reconstruction**: two cascaded unity-gain Sallen-Key low-passes with emitter-follower buffers, the same in all three voices —
  (1) 5.6 kΩ / 5.6 kΩ, 1200 pF / 1000 pF: f₀ 25.9 kHz, Q 0.548; (2) 5.6 kΩ / 5.6 kΩ, 2700 pF / 390 pF: f₀ 27.7 kHz, Q 1.316 (≈ −3 dB
  at 27 kHz) [S MW2; calc re-checked]. **Above the ≈ 15 kHz Nyquist of a 30 kHz word rate: the staircase's images from 15 to ≈ 25 kHz
  pass** — part of the sound [S MW2, SOS].
- **Output**: an inverting stage (22 kΩ in, **LEVEL 50 kΩ B** as its feedback: hat IC65b / VR22, crash IC65a / VR24, ride IC64a /
  VR26; gain ≤ 2.27) [S MW2]; the hat's output coupling C134 10 µF → 0.01 µF from s/n 415300 (a ≈ 723 Hz high-pass) [P SN9, §14].
- **Levels and decays** from the service notes' scope drawings (± 10 %, time scale unverified) [S-u MW2]: crash ≈ 2.3 Vp-p, −14 dB at
  ≈ 0.91 s; ride ≈ 2.2 Vp-p, −14 dB at ≈ 0.30 s; CH accented ≈ 1.6 Vp-p (−14 dB ≈ 53 ms), not ≈ 0.96 Vp-p (−14 dB ≈ 87 ms); OH ≈ 1.2
  Vp-p, −14 dB ≈ 0.29 s.
- **What the originals were** (history, not used): hats from a 14" top and a 14" bottom of two makes, crash and ride from one 18"
  thin crash struck at the edge and on the bow; a studio microphone and a tape recorder [S ATK]. Our images are our own (IMPL-7c §2.4).

## 10. Mixer and outputs [P SN9, OM9; S MW3]

- **Master out L and R / MONO**: 6 Vp-p, 1 kΩ [P]; with only R / MONO plugged, L is normalled onto it (≈ −6 dB a side) [S-d MW3]. The
  voices are **placed between L and R by fixed mix resistors** (LT, RIDE 8.2 kΩ / 15 kΩ; HT, HH 15 / 8.2; CRASH 12 / 10; BD, SD, MT, RS,
  HC 12 / 12) — which side is louder conflicts between two board readings [S-u MW3].
- **Ten multi-outs** (BD SD LT MT HT RS HC HH CRASH RIDE; HH = both hats), each 1 kΩ in series; **a plugged multi-out removes its
  voice from the mix**, at the level of its own LEVEL knob [P OM9, SN9; S MW3]. Their level / impedance: not found.
- **LEVEL pots** are each voice's summing amplifier's feedback (linear: 50 % = −6 dB, 0 = silence): BD 100 kΩ B; SD, toms, HC 50 kΩ B;
  RS 100 kΩ B ∥ 220 pF; the sampled voices 50 kΩ B (§9) [S MW3]. Relative Vp-p at LEVEL 50 % re the BD: SD +3.6, LT −0.6, MT +0.3, HT
  +0.4, RS +0.3, HC +9.0 dB [S-m MW3].
- **Master**: IC66a / b (L / R), **MASTER VOLUME VR28 dual 50 kΩ B** in the feedback; a ≈ 130 Hz first-order high-pass from the input
  coupling; muting transistors at power on / off [S MW3]. From s/n 415300: 0.01 µF at each output jack (≈ 15.9 kHz pole, "high noise
  in output") and a ≈ 6.6 kHz low-pass at the master (R473 1k + R530 2.2k into C511 0.01 µF ∥ R531 10k) [P SN9 the change; S-d MW3
  the values — §15: re-read before modelling].

## 11. CPU, tempo, sync, MIDI [P SN9, OM9]

- **Tempo** 37–290 BPM (a quarter note), a continuous knob read by the CPU's analog input (TEMPO, 50 kΩ linear), shown in whole BPM
  on the 3-digit display; the internal grid ≥ 48 per quarter [S-d MW3] (96 per quarter has no primary source).
- **Sync**: SHIFT + TEMPO MODE cycles INT → MIDI → DIN (stopped; powers up in INT); **DIN sync input only** (1 run / stop, 2 ground, 3
  clock, 5 continue; 24 per quarter [S DIN-sync]); **tape sync** a 1200 / 2400 Hz tone toggling every 1/24 of a quarter [P].
- **TRIG OUT**: the rim shot's row, +14 V; 20 ms (spec) vs 18 ms (one manual paragraph) [P].
- **MIDI** (first Roland drum machine with it): IN, two OUTs (one a thru); receive channel 10, OMNI ON at power-up; **receive notes:
  BD 35 / 36, RS 37, SD 38 / 40, HC 39, LT 41 / 43, CH 42 / 44, MT 45 / 47, OH 46, HT 48 / 50, CRASH 49, RIDE 51** (others ignored); a
  note-on is a trigger, note-off ignored, velocity 1–127 accepted but its effect undocumented (MUZ says velocity sets the level: a
  conflict) [P SN9; S MUZ]. Transmit (the external-instrument pattern): channel 11, notes 36–51 = the 16 keys, velocity 64–96 =
  "accent min–max"; song position, song select, clock, start / continue / stop [P].
- Firmware: Ver. 0 / 1, then Ver. 2 (MIDI stop / continue fix) [P SN9].

## 12. Sequencer and memory [P OM9 unless tagged]

- **Patterns**: 2 **banks** (I / II) × 3 **groups** × 16 keys = **96**; each pattern 1–16 steps (**LAST STEP**); one pattern address holds
  an **INT** layer (the 11 voices) and an **EXT** layer (16 external MIDI notes + its own accent row) sharing SCALE, LAST STEP and
  SHUFFLE [p.12, p.37, p.40; P SN9 p.1]. Longer rhythms: **chains of adjacent patterns** (pattern write: the range's two end keys
  together + ENTER; up to a whole group; a chain then counts as one pattern in play and in tracks; clearing a pattern takes it out of
  its chain) [p.28].
- **SCALE** (per pattern; a key that cycles): **16ths (4 a beat) → 32nds (8) → 8th triplets (3) → 16th triplets (6)**; changing it sets
  LAST STEP to 16 / 16 / 12 / 12; set while the pattern runs in step or tap write; four indicator rows with an LED each [p.24].
- **SHUFFLE** (per pattern): SHUFFLE/FLAM held + key 1–7; **16ths: seven settings** (1 = none), **32nds: four** (1 = 2, 3 = 4, 5 = 6, 7);
  none on the triplet scales [p.26]. Measured: each even-numbered 16th late by **2, 4, 6, 8, 10, 12 / 96 of a beat** for the six
  non-zero settings (≈ 54–75 %) [W SHUF, one tempo, one unit]; the grid 1/48 beat [S MW3].
- **FLAM** (per pattern): SHUFFLE/FLAM held + key 9–16 = eight spacings, longer towards 16; **BD, SD, LT, MT, HT only**; **the first
  hit on the step, the second later**; **the spacing does not follow the tempo** (absolute time) [p.26]. Measured on the trigger out:
  **10, 14, 18 … 38 ms** for keys 9–16 (4 ms steps) [W FLAM] (Roland's later software: 20–48 ms, a different product). A step written
  with flam replaces a plain one and vice versa; flam write = INSTRUMENT SELECT with both keys of the voice's pair; only while running
  in step write [p.10, p.26].
- **Modes and keys** [p.7–19]: **PATTERN PLAY** (a group key 1–3 then a key 1–16; two keys at once = **block play**, the range in
  order); **PATTERN WRITE** = SHIFT + a group key, its sub-mode **STEP** (SHIFT + TEMPO, the default) or **TAP** (SHIFT + BACK); **TRACK
  PLAY** = a TRACK key 1–4; **TRACK WRITE** = SHIFT + a TRACK key; the bank by SHIFT + FWD (I) / AVAILABLE MEAS (II) from a track mode
  (a track uses one bank's patterns). Pattern changes take effect at the **next measure** [p.14]. Writing happens **while running**.
- **INSTRUMENT SELECT** (held) + a key chooses the voice: keys 1 / 2 BD (accent / normal), 3 / 4 SD, 5 / 6 LT, 7 / 8 MT, 9 / 10 HT, 11
  RS, 12 HC, 13 / 14 **CH** (accent / normal), **13 + 14 together OH**, 15 CRASH, 16 RIDE; + ENTER = **TOTAL ACCENT**; both keys of a
  BD / SD / tom pair = **flam write** for it [p.10–11, p.25–26].
- **Step write** (running): a key **cycles off → normal → accented → off** for the accent-capable voices (LED dark → dim → bright),
  **off ↔ on** for RS, HC, OH, CRASH, RIDE [p.11, p.25; S MUZ].
- **Tap write** (running): the keys play and write as tapped — **the left key of a pair accented, the right normal** — quantised to the
  scale's step (nearest or floor: not stated); **CLEAR + a voice key erases that voice while held**; total accent cannot be tapped;
  **CYCLE/GUIDE** = a guide click (the **rim shot on the quarter notes**) [p.14].
- **CLEAR** + a key erases that pattern [p.10]; **LAST STEP** + a key; **SCALE**; tapping SHUFFLE/FLAM alone shows its value on the
  keys' LEDs [p.24–26].
- **Tracks**: **4 per bank** (8 in all), sharing **896 measures per bank**; AVAILABLE MEAS shows what is left [p.15–17, p.40]. Track
  write: pick a pattern (group + key) and ENTER — written, the pointer advances; BACK steps back; FWD / SHIFT + digits + ENTER locate;
  DEL / INS / COPY of measures and LAST MEAS by SHIFT + the keys' second legends + ENTER [p.15–16, p.28–31]. **Track play: CYCLE on
  loops, off plays once and stops**; a located measure starts by STOP/CONT [p.19]. **Tempo per track**: TEMPO + ENTER stores it; the
  track selected with TEMPO held recalls it (the knob then ignored) [p.32].
- **START** from the top; **STOP/CONT** stops, and continues from there [p.19]. **The display** (3 digits): measure, tempo, free
  measures, MIDI channel, file number, "0" for empty / errors [p.19, p.40].
- **SHIFT legends** under the keys: 1–9, 0, COPY, INS, DEL, SAVE, VERIFY, LOAD (keys 1–16) [V; p.4–5].
- Memory: battery-backed; factory demo in bank I (Roland's — never used); the M-64C cartridge; tape save / load [p.7, p.19–23, p.33].

## 13. Panel layout (for our own art) [V photo at 4.70 px/mm, ± 3 %; P OM9 drawing, SN9 spec]

- **486 W × 300 D × 105 H mm**, 4.5 kg [P]. Coordinates: mm from the photograph's left / top (its left edge cropped; the case
  ≈ 0–486 by x).
- **Maker and wordmark zones** (ours stay empty or plain type): a maker mark x 37–114, y 13.6–24.9; a model wordmark x 34.7–141.7,
  y 72.3–87.2; a product line x 305–440, y 80–87.
- **Knob band**: nine blocks with a slate header bar (y 93.8–99.1) carrying the block's name — TOTAL ACCENT x 36.4–69.4, BASS DRUM
  70.6–115.1, then SNARE DRUM, LOW TOM, MID TOM, HI TOM, RIM SHOT / HAND CLAP, HI HAT, CYMBAL every ≈ 46 mm to 438.5; knob rows at **y 113.4
  and 133.0**; knob bodies ≈ 12.3 mm; two columns a block, 20.9 mm apart. Knob x (top / bottom): TOTAL ACCENT 53.0 (bottom only); BD
  83.0 (TUNE / ATTACK), 103.8 (LEVEL / DECAY); SD 129.1 (TUNE / TONE), 150.0 (LEVEL / SNAPPY); LT 175.1 (TUNE / DECAY), 196.2 (LEVEL); MT
  221.3, 242.3; HT 267.2, 288.3; RS LEVEL 313.2, HC LEVEL 334.5 (top); HI HAT: CH DECAY 359.8 (bottom), LEVEL 380.6 (top) / OH DECAY
  380.6 (bottom); CYMBAL: CRASH LEVEL 406.0 / RIDE LEVEL 426.8 (top), CRASH TUNE 406.0 / RIDE TUNE 426.8 (bottom). Dark navy knobs with
  an orange pointer line [V].
- **Middle band** (y ≈ 164–186): START (49.4, 173.8) and STOP/CONT (74.0) — ivory keys ≈ 19 × 18 mm; the **red 3-digit display**
  x 94.3–133.4, y 164.5–183.4; the **TEMPO** knob (160.0, 171.1, ≈ 22 mm; SLOW / FAST); small LED keys ≈ 7 mm square at y ≈ 169: TRACK
  1–4 x 192.8 / 204.7 / 216.6 / 228.3, PATTERN 1–3 247.0 / 258.9 / 270.9, EXT INST 281.9, TEMPO 299.8, BACK 312.6, FWD 324.7, AVAILABLE MEAS
  336.4, CYCLE/GUIDE 350.4, TAPE SYNC 362.6 (pitch ≈ 11.9 inside a group); their orange shift legends (TRACK WRITE, PATTERN WRITE, EXT
  INST, PATTERN WRITE MODE (STEP / TAP), BANK (I / II), LAST MEAS, TEMPO MODE) at y 179.8–185.7; **CARTRIDGE / ENTER** (385.7, ≈ 19 ×
  18 mm, an LED window; TOTAL ACCENT legend); **VOLUME** (426.6, 171.5, ≈ 23 mm; MIN / MAX).
- **Bottom band**: the **left cluster** (x 35–68, y 191–262): six ≈ 8 mm keys in two columns (x 44.5, 59.4) × three rows (y 201.9,
  219.6, 237.2) — LAST STEP · SCALE / SHUFFLE/FLAM · CLEAR / INSTRUMENT SELECT · SHIFT; the **scale indicator** (x 67.9–438.9, y
  190.9–218.7: four slate rows, ≈ 6.2 mm, an LED dot at the left of each; our glyphs); the **16 step keys**: centres x **81.7 + 23.0 (k −
  1)** (to 427.4), caps ≈ 17 × 19.5 mm at y 236.4, an LED window at the top of each cap (y 229.4); numbers 1–16 above (y ≈ 223.4); a
  slate legend strip (y 249.6–254.5: the shift legends 1–9, 0, COPY, INS, DEL, SAVE, VERIFY, LOAD); the instrument boxes (y 256.4–262.1,
  one per pair at a 46 mm pitch: BASS DRUM … HI TOM, RIM SHOT and HAND CLAP singly, CLOSED · OPEN · CLOSED under 13–14, CRASH, RIDE); the
  front edge ≈ y 268.5 (the photo shortens the depth to ≈ 287 mm).
- **Colours** (a retouched photograph, approximate): case warm off-white ≈ `#e8e8e2`; header bars, scale rows, legend strips ≈ slate
  `#5b6580`; orange labels and shift boxes ≈ `#f28c28`; START / STOP / ENTER caps cream ≈ `#fffddc`; step caps warm ivory ≈ `#d0c8b0`;
  knobs ≈ `#2c3550` with an orange line; red LEDs and display [V].
- **Rear** (print only, IMPL-7c D3): the cartridge slot; MASTER OUT L, R / MONO; MULTI OUT × 10; SYNC IN, START / STOP pedal, TRIG OUT (RIM
  SHOT); tape SAVE / OUT, LOAD / IN; MIDI OUT × 2, IN [P OM9 p.6].

## 14. Revisions by serial number [P SN9 change notes; S MW]

| from s/n | change | effect |
|---|---|---|
| 381500 | BD C9 0.22 → 0.33 µF | a wider TUNE (sweep τ 4.5–19.6 → 6.8–29.4 ms) |
| 392600 | crash / ride R442 / R440 33 kΩ → 10 kΩ | their clocks ≈ +0.4 semitone [S-u] |
| 415300 | RS R417 12 kΩ → 3.3 kΩ | the 1 kHz resonator ≈ 3.6× |
| 415300 | hat C134 10 µF → 0.01 µF | a ≈ 723 Hz high-pass on the hats |
| 415300 | 0.01 µF at each output; a ≈ 6.6 kHz master low-pass [S-d values] | less output noise |
| 426700 | tom C54 0.0022 → 0.0047 µF, R194 47 → 100 kΩ | "emphasise the toms' attack" |

## 15. Gaps and the reconstruction rule (lanes V9, R9)

- **Values**: the schematic's component values are image-only; MW's reading (and its measurements) is this appendix's main source.
  **Re-read** every value used from the service notes' schematic images (or a clone's documented redraw) where one is reachable without
  a download the user has not approved; record the final table in §16 with designators; flag every value read differently; no scan or
  crop is committed, nothing of the notes' prose copied.
- **Two targets per voice** (7a / 7b's rule): (a) the model equals **its own analog prototype** (centres ± 1 %, time constants ± 2 %,
  magnitude ± 0.2 dB to 5 kHz at OS 4); (b) **the measured / derived numbers above** — frequencies ± 3 % (the measured ones), time
  constants ± 15 %, the TOTAL ACCENT spans ± 2 dB, the LEVEL ratios of §10 ± 2 dB.
- **Conflicts decided by the build** [C, recorded in §16]: the BD's base pitch (measured 49.5 Hz kept: two units agree; the 56 Hz is a
  derivation); accent into the BD's sweep (no: measured); the snare's 1.500 ratio (the measured one); the word clock (**30 kHz at the
  centre, SN9's figure**; the RC constant fitted to it); the flam spacings (FLAM's 10–38 ms); the shuffle offsets (SHUF's 2 … 12 / 96,
  and for 32nds 0 / 2 / 4 / 6 / 96 by key pairs — our reading of OM9's "1 = 2, 3 = 4, 5 = 6, 7"); the late master low-pass (re-read: if
  it is not on the schematic, leave it out).
- **Not in the sources — the lanes decide, tag [C] or [fit], record here**: the accent codes (normal, per-voice, TOTAL ACCENT's span;
  fitted to §8's spans and the clip near code 52–56); the RM-0621 weights (binary assumed); the hat log / exp and the cymbals' anti-log
  constants (fitted to §9's scope decays and levels); RA13's map (the ride's envelope: RA11's with its own R439); the BD click's
  envelope (ENV2) τ; the noise's level into each consumer (the dividers above); the multi-out level (not modelled: mix only); MIDI
  velocity's effect (ours: IMPL-7c §1.3).
- **Never**: the ROM contents (not even their levels or lengths beyond the counts above), recordings of a 909, Roland's demo patterns.

## 16. The component tables as modelled (lane V9 fills in)

(V9: the component tables per voice, designators and values as used, every [fit] and [C], the early-revision values beside the late
ones. The source-material recipes as built are lane R9's notes in IMPL-7c §14 — one owner per file.)
