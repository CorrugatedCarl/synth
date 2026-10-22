# The Moog modular, module by module: what is known (research appendix for the proposed stage 9)

Scope: a research pass for stage 9 "Moog Modular, module by module" (2026-10-21). Facts about the instruments in our own words: no manual prose, no
schematic, no panel art and no logo is reproduced. Module numbers and names are facts. Read with [ROADMAP.md](ROADMAP.md) row 9 and
[research-sdsv-circuits.md](research-sdsv-circuits.md) (same tags and citation style). Tags: **[R]** a published fact from a source that restates Moog's own
spec text, quotes the original manual, is the patent, or bench-measures a genuine vintage unit; **[R?]** secondary: a clone / emulation manual, a
forum post, a retailer line, a search excerpt, or a fact the sources disagree on; **[C]** our arithmetic or a choice made for the model. Source codes
(`MS-911`, `JD-901`, `VK-15` …) are listed with URLs in §9.

**The honest state of the documentation.** Moog's own 900-series manuals and the service manual exist only as page scans (GIF / image PDFs) that this
pass could not read; the AES papers (Moog 1965: 901B and 902; 904A/B/C) are paywalled. What was read instead: (1) Vintage King product pages that restate
Moog's 2015 reissue spec text, module by module (VK-xx); (2) restoration pages with bench measurements of genuine 1967-75 units (MS-xx); (3) a blogger who
copies the original manual's spec lines for the 901, 907, 911 and 961 (JD-xx); (4) the ladder patent and a patent review (PAT, TIL-P); (5) Cherry Audio's
VM900 manual pages (CH-xx), which describe an *emulation*; where only CH says something it is [R?] "emu"; (6) Behringer clone reviews (BON, ZB-BEH). Where a
number is only in (5) or (6), a test must not treat it as the Moog's. One thing to know up front: **"6401 bass/treble" is not a Moog modular module that any
source mentions**; bass/treble tone controls belong to the **984** mixer (§3.4).

## 1. Conventions: format, power, levels, pitch, triggers, jacks

### 1.1 Panel format (the "Moog unit", 5U)

| fact | value | tag |
|---|---|---|
| module height | **5U = 8.75 in** (1U = 1.75 in) | [R? synthesizers.com form-factor page, excerpt] |
| module width | multiples of **2⅛ in = 2.125 in = 1 MU** ("Moog Unit") | [R ZB-900; R? SYN-FF] |
| console panels (CP series) | multiples of 2⅛ in wide × **5⅝ in** tall, a second row under the modules | [R ZB-900] |
| cabinet capacity | a cabinet row holds **22 MU** of modules; System 55's top cabinet: 22 MU, 16 modules + a blank; bottom: 22 MU, 14 modules + 6 console panels | [R ZB-900; R MS-S55] |
| System 55 reissue cabinets | main 48.5 × 15.5 × 14 in, 100 lb; upper 48.5 × 10 × 8.5 in, 60 lb | [R VK-55] |
| Model 15 reissue case | 18 W × 25 H × 9.5 D in, 50 lb, 130 W supply | [R VK-15] |
| edge connector | each module plugs into a **22-pin** edge socket at the rear; pin 1 +12 V, pin 2 ground, pin 3 −6 V; signals (outs, the 901 pins 9/11/12/16, the 911's trigger and S-trigger pins) also appear there so cabinet bus wiring can link modules | [R JD-901, JD-907, JD-911] |

### 1.2 Power

| rail | where | tag |
|---|---|---|
| **+12 V and −6 V**, regulated: the supply of every 900 module | oddball rails attributed to 1960s op-amps | [R JD-901/907/911; R? MF-PWR] |
| −10 V unregulated: from the 909 / 910 supplies; the later 930 has none (the 901B drew it) | | [R? MF-PWR; R JD-901] |
| **930** (System 55): ±15 V @ 5 A each, +12 V @ 5 A, −6 V @ 8 A; linear LM723-based boards; the CP3A later models run ±15 V op-amps | | [R MS-930, MS-CPANELS55] |
| almost every 1968-72 system used the 910 supply module; reissue supplies: 350 W (IIIc / IIIp / System 55), 180 W (System 35), 130 W (Model 15) | | [R VK-55, VK-35, VK-15, VK-3C; R? MF-PWR] |
| per-module draw: 911 +12 V 30 mA, −6 V 15 mA (max 50 mA); 907 +12 V 20 mA, −6 V 10 mA; 901A max 25 mA | | [R JD-911, JD-907, JD-901] |
| the original **CP3** mixer ran on +12 / −6 V and so clipped asymmetrically (the negative half first, ≈ 5 V); the **CP3A** has ±15 V and more headroom | | [R ZB-EVO; R MS-CPANELS55] |
| a 10 V p-p signal overloads rail-limited stages of the original system; modern 10 Vpp VCOs are "too hot" for it | | [R? MF-LVL, MF-PWR] |

### 1.3 Signal levels (all voltages ground-referenced; audio and control are the same kind of signal)

| signal | level | tag |
|---|---|---|
| **901 / 901B fixed audio outputs**, four at once | **0.5 V RMS (−4 dB)**, source impedance **600 Ω**; variable (attenuated) outputs 0 … 0.5 V | [R JD-901] |
| one bench-measured 901B | RMS ramp 0.50 V (1.73 V p-p), triangle 0.65 V (2.25 p-p), sine 0.50 V (1.41 p-p), 50 % pulse 1.20 V (2.4 p-p); the author notes outputs vary from the spec | [R MS-901B]; p-p recomputed [C] ramp 0.5·√12 = 1.73 ✓ |
| 921B vs 901B: 921B rectangle ≈ 3 dB and triangle ≈ 6 dB lower | | [R? EME, search excerpt] |
| 921 aux outputs | variable gain up to ×5 ≈ ±4 V; rectangle aux unipolar 4 V p-p; left jack inverted, right in phase | [R MS-921] |
| **control-voltage span of a 901 control input** | **−4 V … +6 V** per the manual (the maker of the page prefers 0 … +5 V) | [R JD-901] |
| **911 output** | peak (Emax) **5.5 V ±10 %**, source impedance **10 kΩ**, Esus 0 … Emax | [R JD-911] |
| **902**: full gain (×2 = +6 dB) at **6 V** total control, or pot at max; max summed control ≈ 7.5 V (source says "+4.7 dB or gain of 3", self-inconsistent, see §8) | | [R VK-15, VK-35, VK-55] |
| 912 control output | ≈ 3 … 6 V for 63 mV … 4 V p-p in (table in §3.4) | [R MS-912] |
| 960 row output | 0 … 2 / 4 / 8 V (×1 / ×2 / ×4 range switch); column and clock logic is RTL: V-triggers **+3.6 V** | [R VK-55; R MS-960, MS-S55; R? ELM-960] |
| 907 | unity gain; input 10 kΩ; output 680 Ω; noise −65 dB | [R JD-907] |
| 904A (clone sheet) | input 100 kΩ, output 1 kΩ, control 1 V/oct | [R? MODC] |
| 962 | built for positive-only CV: a bipolar signal passes only under 2 V p-p, the negative half clips beyond | [R MS-962] |

### 1.4 Pitch and control conventions

- **1 V per octave**, popularised by Moog; every VCO and VCF control input is exponential at 1 V/oct and the inputs of a module are **summed** (three identical
  control jacks per 901A / 921A / 904 / 902; the fixed-control knob adds to the jacks) [R VK-15; R? WK-CV; CH-904abc].
- The 901 and 921 families split the job: **a driver** (901A / 921A) sums and scales the controls and feeds up to **three** (MS-901A, MS-921A; JD-901 quotes the manual
  as up to 12; BE 921A claims 12) slave oscillators (901B / 921B) over the rear edge connector (§8). The 901A turns 1 V/oct into a voltage that doubles per octave and
  the 901B's ramp is linear in it, so a fixed detune in the 901B is a fixed number of Hz at every pitch; the 921A passes the 1 V/oct sum and each 921B has
  **its own exponential converter** (the 921B and 921 boards carry a tempco resistor thermally bonded under a core IC, consistent with an on-board converter), so a detune is a fixed interval at every pitch [R? ZB-EVO; R MS-921B, MS-921; conflict: MS-921A "describes no exponential conversion", §8].
- Other 0 … 5 V controls (envelopes, sequencer rows): the 960 reads **1 V = one octave** for pitch; its row C can modulate its own clock at 1 V = ×2 [R VK-55; R? CH-960].
- Keyboards (950 / 951 / 952 / 953) output a pitch voltage plus an S-trigger; the 951 has **Scale, Range and Glide** controls; the 953 is two-voice (§3.5).

### 1.5 Triggers and gates (important: three kinds)

| kind | what it is | levels | where | tag |
|---|---|---|---|---|
| **S-trigger** ("switch trigger") | a **passive switch closure to ground**; wires in parallel make a logical OR; the *receiver* supplies the voltage; closed = envelope runs, opening = release (§8: the quoted manual wording says "closure … directs to T3") | open level not specified by any source read: +12 V (a forum measurement of a 911; the line "pre-set to −12 V through 470 k" on the 950 interface) vs "+5 V → 0 V" (sdiy wiki); a 911 starts while the line is within ≈ 1 V of 0 V (a forum SPICE run) | **911, 911A, keyboards, ribbon, 961, 912 (1/4" jack), 993** | [R? MF-S, SDIY-MM, SYN-GT] |
| **V-trigger** = today's gate | positive pulse from 0 V | ≈ **3 V** nominal; 960 / 962 RTL logic **+3.6 V**; the 961's S→V output **4 V** | 960 column outs, 962 outs, 961 | [R JD-961, MS-960, MS-962, MS-961; R? SYN-GT] |
| clock / audio-to-trigger | 961 audio→V-trig with a sensitivity knob | — | 961 | [R MS-961] |

- **961 interface** (3 MU): 2 multichannel V→S converters (6 A inputs, level-following; 6 B inputs, edge-triggered into a variable one-shot, **Switch-On Time design
  range 50 ms … 4 s**; measured on one unit 37 ms … a little over 5 s; 500 ms at mid-travel) [R MS-961; JD-961 40 ms … 4 s], 2 S→V converters (4 V out), 1 audio→V-trigger.
- A V→S conversion needs one NPN: a reviewer's cable uses a 2N3904 and a 10 kΩ (and a 1N4148 in another) [R? THO, JD-CABLE].
- **S-trigger plug**: Moog's own 2-contact **Cinch-Jones 300-series** (socket S-302, plug P-302); no other maker's synth, even among 900 clones, uses it; the Model 15 reissue ships short S-trigger cables [R ZB-CJ; R? search excerpt (Model 15 cable list)]. The 912's trigger out is a plain 1/4" jack instead [R MS-912].
- Wrong trigger type symptoms (no sound, fires on key release, attack + release only with no decay) [R? THO, WK-CV].

### 1.6 Jacks and cords

- Audio, CV, V-trigger: **1/4" TS phone jacks** and cords [R ZB-900]. Normalled paths: 902 signal inputs normalled to ground [R MS-902]; 912 control out normalled to its comparator input [R MS-912]; 995 inputs normalled (§8) [R MS-995]; 962 input 3 patched switches 2:1 to 3:1 [R MS-962]; CP and 992/993 panels route controller outputs through **trunk lines** and rear bus wiring (jack-less) [R MS-S55, MS-CPANELS55].
- The 902 inputs / outputs are **differential**: the lower input is *subtracted* from the upper; the upper output is *inverted*; use "upper in → lower out" to keep phase [R MS-902].

## 2. Systems and what each one holds

### 2.1 Sizes (Moogseum's evolution table) [R MSG-EVO]

| system | years | complement (all monophonic) |
|---|---|---|
| Synthesizer I (Ic console / Ip portable) | 1967-73 | 1 VCO + 2 oscillators on 1 driver; 1 fixed filter bank; 1 VCF; 2 VCAs; 2 ADSR |
| Synthesizer II (IIc / IIp) | 1967-73 | 1 VCO + 5 osc. on 2 drivers; 1 FFB; 2 VCFs; 2 VCAs; 2 ADSR |
| Synthesizer III (IIIc / IIIp, portable = 3 cases) | 1967-73 | 1 VCO + 9 osc. on 3 drivers; 1 FFB; 2 VCFs; 3 VCAs; 3 ADSR |
| Model 10 | 1971-73 | 1 VCO + 2 osc. on 1 driver; 1 FFB; 1 VCF; 1 VCA; 2 ADSR (one suitcase) |
| Model 12 | 1972-73 | same mix, a more pitch-stable VCO and a new keyboard |
| **Model 15** (the "System 15") | 1973-81 | 1 VCO + 2 osc. on 1 driver; 1 FFB; 1 VCF; 2 VCAs; 2 ADSR (suitcase, like the Synthesizer I) |
| **System 35** | 1973-81 | 1 VCO + 4 osc. on 2 drivers; 1 FFB; 2 VCFs; 3 VCAs; 3 ADSR (wedge wood cabinet) |
| **System 55** | 1973-81 | 1 VCO + 6 osc. on 2 drivers; 1 FFB; 2 VCFs; 5 VCAs; 5 ADSR (two cabinets, the largest production set) |

Moog's modular run is also given as 1965-1981 and again from 2014 [R WK-MOOG]. Orders for modules began 1965; production models were hand-built in Trumansburg, NY by 1967 [R STP-3P]. Serial numbers began at 1001 in 1967 [R MS-911, MS-901]. The names "Series I / II / III" vs "Synthesizer I / II / III" and "System 15" vs "Model 15" vary by source (§8).

### 2.2 Which module is in which system (reissue lists restate the 1973 specs)

Counts. Reissue lists: Model 15 [VK-15], System 35 [VK-35], System 55 [VK-55], IIIc [VK-3C] (IIIp has the same plus 991: [VK-3P, STP-3P]). The 1973 "System 55" was built to the same spec [R AX].

| module | Model 15 | System 35 | System 55 | IIIc / IIIp | note |
|---|---|---|---|---|---|
| 901 (VCO, 3 MU, = 901A + 901B) | | | | 1 | IIIc/p only |
| 901A controller | | | | 3 | |
| 901B oscillator | | | | 9 | |
| 921 VCO | 1 | 1 | 1 | | 1972+ |
| 921A driver | 1 | 2 | 2 | | |
| 921B oscillator | 2 | 4 | 6 | | |
| 902 VCA | 2 | 3 | 5 | 3 | |
| 903A random signal | | | 1 | 1 | |
| 923 noise + filters | 1 | 1 | | | 1974+ |
| 904A low-pass | 1 | 1 | 1 | 1 | |
| 904B high-pass | | 1 | 1 | 1 | |
| 904C coupler | | | | 1 | |
| 905 reverb | | | | 1 | |
| 907A FFB (8 bands) | 1 | 1 | | | |
| 914 FFB (12 bands) | | | 1 | 1 | |
| 911 envelope | 2 | 3 | 5 | 3 | |
| 911A dual trigger delay | | | 1 | 1 | |
| 912 envelope follower | | | | 1 | |
| 960 / 961 / 962 | | (opt.) | 1/1/1 (+B complement) | | Sequencer Complement B = 2×960, 961, 2×962, 994 |
| 984 four-channel mixer | | | | 1 | |
| 991 LP+HP + attenuator | | | | 1 (p) | |
| 992 / 993 / 994 / 995 | 995 | 995 | 992, 993, 994, 995 | 992, 993, 994 | |
| CP panels | CP15 | CP3A×2, CP4A, CP8A, CP35 | CP2, CP3A×3, CP8 (+961CP) | CP3×4, CP1, CP9 / CP2, CP8 | CP contents §3.6 |
| keyboard | 953 (opt.) | 953 | 953 | period 950 / 951 types (no list says) | 953: 2018-23 reissue |
| power | 130 W | 180 W | 350 W | 350 W | |

Totals: System 55 reissue "36 modules" in 2 cabinets [R? search excerpt]; IIIc "36 hand-stuffed" and IIIp "37" (the listings differ by one: the power supply) [R VK-3C, VK-3P, STP-3P]; Model 15 "13 units" (11 types) [VK-15].

### 2.3 System 55 layout [R MS-S55]
Top cabinet (22 MU, 16 modules + a blank): 914, 904B, 904A, 992, 993, 902 ×5, 911 ×5, 911A. Bottom cabinet (22 MU, 14 modules + 6 CP panels): 921A ×2, 921B ×6, 921, 903A, 994, 995, 960, 962; panels CP2, CP3A ×3, CP8 / 961CP. (The page names fewer than its stated counts: the counts above are those that reconcile with the reissue list [C].) The 960 / 961 / 962 use RTL logic on a +3.6 V rail.

### 2.4 Keyboards on the reissues
The **953** is a 61-note two-voice keyboard (43.25 × 9.12 × 3.5 in) for System 55 / 35 / IIIc / IIIp / Model 15 / 10; per channel Scale, Range, Portamento; Glide 1 and 2 with on / off, a gated-glide switch and linear-constant-rate or exponential glide; one 8-pin DIN "Controller Out" to the synth's rear connector; no MIDI; the trigger wiring of Model 15 / 10 differs from System 35 / 55 / IIIc / IIIp and a power-on key chooses the type [R? PC-953, MF-953]. The 2015 reissue also offers an optional 5-octave duophonic keyboard [R AX].

## 3. The module catalogue

Column "W": panel width in MU (2.125 in each). `d` = documented; `≈` = estimated as Behringer's HP ÷ 8 (their 902 / 904 / 911 are 8 HP) [C on ZB-BEH]. The Behringer scaling is not exact (their 921 is 14 HP, the page says 2 MU; their 961 21 HP vs 3 MU) so every ≈ is within ½ MU at best.

### 3.1 Oscillators

| module | W | controls and jacks | ranges, levels, targets | circuit essentials | tag |
|---|---|---|---|---|---|
| **901** (1965, "VCO + LFO") | 3 d | = a 901A + a 901B on one panel. Fixed Voltage Control (pitch, −5 … +6 oct), Frequency Range (**Lo, 32′, 16′, 8′, 4′, 2′**), fine tune (±1 oct; emu: "0/1/2"), pulse width, 3 summed control inputs; **4 fixed outputs** (sine, sawtooth, triangle, pulse) and **4 variable outputs** (0 … 0.5 V) | span **0.1 Hz … 15 kHz** (manual); a bench unit: min 1.7 Hz, max 31.7 kHz, Lo 35 mHz … 70 Hz (one cycle / 28 s); optimum ≈ 5 kHz (least distortion); pulse width 47.8 … 91.5 % (one unit); manual claims 5-octave keyboard tracking, the author finds ≈ 2; 0.5 V RMS / 600 Ω outputs; large temperature drift | unijunction-transistor ramp generator (the first 901B design); triangle from the ramp by a 2-transistor circuit, pulse by a comparator, sine by a diode shaper, a small cap filter on the triangle's peak glitch | [R JD-901, MS-901, MS-901B; R? CH-901abbb] |
| **901A** controller | 1 d | precision 1 V/oct sum and pulse-width control; 3 control jacks; "Fixed Voltage Control", range, fine | drives **3** 901Bs (MS) or 12 (JD manual quote); supplies +12 V ramp core, control voltage and pulse reference to the 901Bs | summing amplifier + exponential converter (precision matched) | [R MS-901A, JD-901] |
| **901B** oscillator | 1 d | Range (Lo + 5), frequency vernier (≈ ±1 oct + a major third; emu), 4 fixed + 4 attenuated outputs | tracking trimmer + ramp-symmetry trimmer; no pulse-width of its own (set on the 901A) | UJT ramp core | [R MS-901B, JD-901] |
| **901C** output stage (1967, hand-wired, **15 made**) | ? | patched to a 901-family output: controls amplitude and polarity so the oscillator becomes a CV source; two CV outputs 180° apart | | | [R MSG-901C] |
| **901D** "variable waveform output stage" | ? | also called a mixer; at least two versions | a 1967-catalogue module may be a 982 two-channel mixer | | [R? MF-901D] |
| **921** (1972) | 2 d | Scale (±12 / ±6 st), Coarse range (sub-audio / audio), Frequency, Range (organ footages; a bench unit shows an added 1′ position), Waveform volumes (master out), Pulse Width, **Clamping Point** (0 … 100 % of the cycle), Aux out waveform select + level; **3 frequency control** jacks, **2 width** jacks, **Clamp Trig V and S**; 4 waveform outs (sine, triangle, saw, rectangle) + 2 aux (L inverted, R normal) | **0.01 Hz … 40 kHz**, four waveforms at once; clamp = a hard reset, edge-triggered, time constant just over 1 ms; Clamp Level sets the voltage the core resets to (a bench unit); stable at low frequency | self-contained 921A + 921B | [R VK-15, VK-35, VK-55, MS-921; R? CH-921, BON] |
| **921A** driver | 1 d | semitone / octave switch on the Frequency pot (**±12 st** = 2-oct compass, or **±6 oct** = 12-oct compass); **3 summed frequency inputs, 2 width inputs**; pulse-width pot | outputs a frequency control (0.5× gain: ±3 V ⇒ ±6 oct) and a duty-cycle voltage; **one driver per bank, width shared by all its 921Bs**; the width control voltage sets the rectangle duty on every slave | summer + scaling; internal wiring to the 921Bs by edge connector | [R VK-15, MS-921A, JD-921; R? CH-921abbb] |
| **921B** oscillator | 1 d | Range (Lo + 5; "organ pipe" labels), frequency pot (**±1 oct fine**, 2 oct total; semitone ±12 in emu), **DC and AC modulate inputs** (linear), **Sync** input with a 3-position switch (weak / off / strong), 4 outputs (sine, triangle, saw, rectangle) | **1 Hz … 40 kHz** minimum; LFO on a bench unit ≈ 2 … 13 Hz front panel, 29 mHz at −6 oct CV; at ≈ 16 kHz the triangle is degraded and the pulse gone unless width is raised; **sync is phase-locked-loop style, locking about the first six harmonics; "weak" cuts the reach by 4**; sawtooth gives the best sync; lock range ±6 semitones (clone) | exponential converter with a tempco resistor + IC; improved waveshaping over the 901B | [R VK-15, MS-921B, BON; R? ADO-921B] |
| **LO/LFO use** | | any of them as an LFO via Lo | 901 Lo 35 mHz … 70 Hz [R MS-901] | | |
| Mixing of 921 waveforms | | 921B has no mixer: use a mixer module | | | [R ZB-EVO] |

### 3.2 Noise, sample and hold, controllers' siblings

| module | W | controls and jacks | ranges, targets | circuit | tag |
|---|---|---|---|---|---|
| **903** (1965) / **903A** (1971) random signal | ≈ ½ … 1 | white and pink outputs (two jacks of each in emu) | pink = equal energy per octave; noise band roughly 25 Hz … 20 kHz; both usable as audio or CV | edge-finger PCB | [R VK-55, MS-903A; R? CH-903] |
| **923** (1974) noise + two filters | 1 ≈ | White (2 jacks), Pink; low-pass and high-pass sections with In / Out jacks and **one knob each**; no CV | each section **one-pole RC, 6 dB/oct**; cutoff sweep 10 Hz … 10 kHz (emu); replaces 903A + a filter | | [R VK-15, VK-35; R? CH-923, BON] |
| **928** sample and hold + glide | ? | Clock rate (0.3 … 30 Hz emu), Sample Int / Ext, Trig in, Clock Out (pulse or triangle), Glide, inputs X1 (≈ ±0.25 V) and X3 (±0.75 V), outs | | | [R? SEQ-B, CH-928] |

### 3.3 Filters and spectral modules

| module | W | controls and jacks | ranges, slopes, targets | circuit essentials | tag |
|---|---|---|---|---|---|
| **904A** low-pass VCF | ≈ 1 | **Fixed Control Voltage** knob (12-octave sweep, 1 V/oct), **Frequency Range** switch (2-octave steps), **Regeneration** (resonance, *not* voltage-controllable), 1 signal in, **3 summed control inputs**, 1 out | 3 ranges **1 Hz – 5 kHz, 4 Hz – 20 kHz, 16 Hz – 80 kHz** (a clone gives 60 kHz) ≈ 12.3 octaves each; **24 dB/oct**; self-oscillates as a sine VCO (1 V/oct tracking); passband gain falls as regeneration rises; low-frequency self-oscillation starts ≈ 72 Hz on a clone; the 1960s 904A is preferred for tone, the 1970s one self-oscillates more easily | 4-stage transistor ladder, base-emitter resistance as the tunable R, exponential current control, feedback 0 … 4, §4.1 | [R VK-15, VK-35, VK-55, PAT; R? ZB-EVO, AION, MODC, E490] |
| **904B** high-pass VCF | ≈ 1 | as 904A without regeneration; 1 in, 3 control, 1 out | **24 dB/oct**; low range 4 Hz – 20 kHz, high range 10 Hz – 50 kHz (the shift ≈ 1.32 oct [C]; sources say 1½ oct and 1.25 oct) | complementary NPN / PNP ladder with buffers between stages, balanced so control voltage does not leak to the output | [R VK-35, VK-55, PAT; R? CH-904abc] |
| **904C** filter coupler (1965; omitted from the 1970s systems) | ? | Mode switch **Band Reject / Off / Band Pass**, Center Frequency, Bandwidth (≤ 3 oct emu), CV jacks for centre frequency and bandwidth | joins a 904A and 904B in series (band-pass) or parallel (band-reject) *internally*; the other 904s must be centred; one control moves both cutoffs together, the other moves them in opposite directions | | [R PAT, MS-904C, MSG-901C; R? CH-904abc] |
| **907** (1965) / **907A** fixed filter bank | **4 d / 3 d** | one pot + switch per band, 1 in, 1 out; **8 band-passes + low "shelf" + high "shelf"** | band centres **250, 350, 500, 700, 1k, 1.4k, 2k, 2.8k Hz** (half-octave); low corner 175 Hz, high corner 4 kHz [JD + CH, [C] recompute 250/√2 = 177, 2828·√2 = 4000]; unity gain (a bench unit reads −1.35× at its peak), −65 dB noise; band-pass attenuation 24 dB/oct; 36 Hz … 100 kHz usable response; not voltage-controlled | **10 overlapping LC networks** (inductors); two PCBs of five sections | [R JD-907, MS-907, VK-15; R? CH-907a] |
| **914** extended FFB (1972) | ≈ 3.5 | 12 band pots + low and high shelf pots, 2 in, 2 out (emu) | **12 band-passes at half-octave spacing from 125 Hz to ≈ 5.7 kHz** [C: 125·2^(k/2); AJH clone says 5.8 kHz]; shelves ≈ 90 Hz / 8 kHz (emu; Behringer: 100 Hz / 7.5 kHz); 12 dB/oct per band (AJH); each band "can cut ≈ 80 dB" (Behringer); no gain; no CV | 14 filter sections on two PCBs; hand-selected turret parts | [R MS-914, VK-55; R? SOS-914, CH-914, BON] |
| **991** | ? | LP + HP filters with attenuator | IIIp only | | [R ZB-900, VK-3P] |
| **905** reverb (1965) | ? | a single **wet / dry** control; in, out | spring tank (Gibbs); output phase-inverted | minimal circuit | [R MS-905; R? CH-905] |
| **902A** "bandpass adapter" (a list item) | ? | | no other source mentions it | | [R? ZB-900] |

### 3.4 Amplifiers, envelopes, mixers

| module | W | controls and jacks | ranges, targets | circuit essentials | tag |
|---|---|---|---|---|---|
| **902** VCA | ≈ 1 | **Fixed Control Voltage** knob, **Lin / Exp** switch, 3 control inputs, 2 signal in (differential, normalled to ground), 2 out | gain **×2 (+6 dB)** at 6 V total control or pot max; exp mode **−12 dB per volt below 6 V**, lin mode ∝ control (the switch acts on the control inputs, not the audio path); max summed control ≈ 7.5 V | three differential stages (MS-902); a later revision matches the transistors electrically and thermally (search excerpt of the revised page) | [R VK-15, MS-902; R? MF-902] |
| **911** envelope | 1 d | **T1** (attack), **T2** (initial decay), **Esus** (sustain level), **T3** (final decay); S-trigger input, output; (22-pin: trigger-out pin 14) | **T1/T2/T3 2 ms … 10 s** (spec; the range list says 10 ms … 10 s); **Emax 5.5 V ±10 %**, Esus 0 … Emax; output 10 kΩ; "closure of the trigger switch sends the contour to T3 from whatever stage" (§8); a single fixed attack slope (log, from capacitor charging; main timing cap 10 µF; the 911 shares the Minimoog contour circuit) | S-trigger sets a flip-flop; a sustain-level trimmer must match the end of attack (too high = a step, too low = a notch); revised 911s add calibration trimmers | [R JD-911, MS-911, VK-15; R? MF-911, MF-S, THO] |
| **911A** dual trigger delay (1969) | ≈ 1 | 2 delay pots, 1 S-trigger in, 2 S-trigger out (plus the 993 routing); **Mode: Off (independent) / Parallel (one in starts both) / Series (2nd starts after 1st)** | spec **2 ms … 2 s** (a bench unit 2 ms … 10 s; Behringer 2 ms … 10 s); delays add in series | hand-wired; turns an ADSR into a delayed one | [R MS-911A, VK-55; R? BON] |
| **912** envelope follower | ? | Response (short / medium / long), Threshold (comparator), Signal in, Control out (normalled to the comparator), S-trigger out (1/4" jack, externally pulled up) | in 31 mV → 2.4 V, 127 mV → 3.5, 500 mV → 4.5, 1 V → 5.0, 2 V → 5.5, 4 V → 6.0 V (spec; measured within 0.2 V): **≈ 0.5 V per amplitude doubling (log)**; calibrated at 250 Hz, 500 mV p-p; takes up to 4 V p-p; response 0.01 … 0.1 s (emu); comparator thresholds with hysteresis: 320 mV / 120 mV, 2.88 V / 0.2 V, 5.7 V / 0.3 V | 3 trimmers, two interact | [R MS-912; R? CH-912] |
| **984** four-channel mixer (1965) | ? | 4 inputs × 4 output busses (a 4 × 4 level matrix), master per bus, **Bass and Treble** (flat at 5); AC-coupled, audio only | max gain 1.25 through any channel (tone centred) | PCB per two channels | [R MS-984, VK-3C; R? CH-984] |
| **982** two-channel mixer | ? | | | | [R? ZB-900, MF-901D] |
| **CP3 / CP3A** (§3.6) | | 4 inputs, + and − outputs, master gain, **click filter**, 4 routing switches, 3 multiples, trunks | audio PCB **2× gain**; CV PCB scale 1.0 … 1.08× | CP3 on +12/−6 V; CP3A ±15 V op-amps | [R MS-CPANELS55, VK-35] |

### 3.5 Controllers, sequencing, interfaces

| module | W | controls and jacks | ranges, targets | circuit essentials | tag |
|---|---|---|---|---|---|
| **950** (1965) / **951** (1971) keyboard controller | ? | Scale, Range, Glide; pitch CV + S-trigger | Pratt-Read keys; a 950B "scale programmer" (1969) | | [R ZB-900, MS-951] |
| **952** (1972) duophonic keyboard; **953** (reissue) | | see §2.4 | | | [R? ZB-900, PC-953] |
| **955 / 956 ribbon** (1965 / 1969), **958 foot pedal, 959 joystick** (1971), 1120 pedal, 1121 footswitch, 1125 S&H, 1130 percussion controller, 1150 ribbon (1973); Bode 1630 frequency shifter (1972), 1631, 1632 ring modulators | | | ribbon = a longitudinal resistance; the 1630 shifts all frequencies by a fixed Hz (Bode / Moog patent US 3,800,088) | | [R? ZB-900, TIL-P] |
| **960** sequential controller (1969) | ? (≈ 7 [C]) | **3 rows × 8 stages**; per stage: 3 knobs, **Skip / Normal / Stop** switch, Set button, In and Out jacks (the Out = a stage gate); a 9th "off" stage with Skip / Stop (emu); clock oscillator (Osc On / Off buttons + CV, Control Input, Range, Vernier, Output); per-row **range switch ×1 / ×2 / ×4 (max 2 / 4 / 8 V)** and **two outputs per row** (quantised and unquantised; emu: half-volt steps, §8); Shift button + Shift jack | clock **0.1 Hz … 1 kHz** (a bench unit's max: just over 400 Hz, 90 % duty); column outs **+3.6 V V-trig**; **row C can modulate the clock** (1 V = ×2); two 960s join into 16 stages; pot values drift for minutes after power-up | RTL (MC700-series) logic on +3.6 V; a UJT LFO clock; one-shot multivibrators; said to follow the Buchla 123 sequential voltage source with a built-in clock (search excerpt of Zoë Blade) | [R VK-55, MS-960, MS-S55, ZB-SQ, ZB-900; R? CH-960, WK-AS, ELM-960] |
| **961** interface (1969; 961CP console version) | 3 d | 6 A + 6 B inputs V→S; 2 S→V; audio→V-trig + sensitivity; Switch On Time | §1.5 | RTL, single-sided PCB | [R MS-961, JD-961, VK-55] |
| **962** sequential switch (1969) | 1 d | 3 signal inputs, 1 output (two duplicate jacks emu), 3 trigger ins, 3 trigger outs (lamps), Set 1 / 2 / 3 buttons, Shift in | 2:1 by default, **3:1 when input 3 is patched**; with a 960 gives 16 or 24 steps | RTL | [R MS-962, VK-55; R? CH-962] |
| **993** trigger and envelope voltages | ≈ 1 | switches: *from 1 / from 2* (which controller feeds the 911A), left column (S-trigger → 911 #1 direct, #2 via 911A #1, #3 via 911A #2), right column (green: each 911's envelope → its 902); any combination at once | S-trigger only; three 100 kΩ 1 % resistors in the envelope paths to the 902s | switch wiring to the rear connector | [R MS-993, VK-55] |
| **992** control voltages | ≈ 1 | routes up to 4 controller CVs (keyboard, ribbon …) to the 904B (and so on); the **4th input has an inverting attenuator** | | small PCB, inverter | [R MS-992, VK-55] |

### 3.6 Passive panels (multiples, attenuators, console panels)

| module | W | content | tag |
|---|---|---|---|
| **994** dual multiples (1971) | ≈ ½ … 1 | **8 jacks in two groups of 4** (tips and sleeves common within a group); also adds two cords' signals; passive | [R MS-994] |
| **995** attenuators (1974) | ≈ 1 | **3 passive 25 kΩ pots**, 0 = zero gain, clockwise = unity; the top input is normalled to the others (series chains, §8); one source → up to 3 variable outputs | [R MS-995, VK-15] |
| **CP1** | | 3 CV + trigger outputs from the controller jacks | [R VK-3C ] |
| **CP2** | | passive low-pass and high-pass filters, multiples, pitch and trigger outputs | [R MS-CPANELS55] |
| **CP3 / CP3A** | | see §3.4; 4 per IIIp | [R VK-3C, MS-CPANELS55] |
| **CP4 / CP4A** | | four controller-CV routing switches, trigger routing switches, trigger and CV input jacks, 4 trunks | [R MS-CPANELS1; ZB-900] |
| **CP5, CP6, CP7, CP11** | | CV / trigger outs, power, multiples, CV switches, attenuator, trigger / envelope routing | [R? ZB-900] |
| **CP8 / CP8A, CP9** | | power switch, pilot lamp, fuses | [R MS-CPANELS55; VK-3C] |
| **CP15** | | included in the Model 15; no source describes it | gap (§8) |
| **CP35** (1974) | | normalled attenuators, CV sources (including +6 V and −6 V), multiples, trunks (Behringer: 4 channels, 21 HP) | [R? ZB-900, BON] |

### 3.7 Power and housekeeping modules
**909 / 910 / 920 / 930** supplies (910 and 920 are listed for 1965; 909 appears in forum posts; the 930 is the System 55's); **CM1A** is a Behringer MIDI-CV interface, not Moog [R ZB-900, ZB-BEH; R? MF-PWR].

## 4. Circuit essentials, deeper

### 4.1 The ladder (904A, 904B, 904C)
- **US 3,475,623**, filed 10 Oct 1966, granted 28 Oct 1969: the base-to-emitter diode resistance of bipolar transistors is the tunable R of RC sections, its value
  inversely proportional to the standing current; cutoff ∝ exp(summed control voltage); tuning range quoted ≈ 1000 : 1; **four identical stages**, each a transistor pair
  with a capacitor between emitters; an input stage of matched drivers as a near-ideal current source; an output buffer set to match input at very low frequency, inverting;
  a variable resistor from output back to input reduces low-frequency gain, and enough makes it oscillate [R PAT]. The high-pass is a complementary NPN / PNP ladder
  with unity-gain buffers and a diode setting the operating point (temperature compensation) [R PAT]. The coupler (three-position switches: parallel = band-reject,
  series = band-pass; one control voltage sets the centre, a second, inverted for one filter, the bandwidth) is Fig. 3 [R PAT].
- Transfer functions (review): low-pass `V/Vin = 1 / (s⁴ + 4ωs³ + 6ω²s² + 4ω³s + ω⁴(1 + k))`, high-pass `s⁴ / (s⁴ + 4ωs³ + 6ω²s² + 4ω³s + ω⁴)`; **feedback k from 0 (no resonance)
  to 4 (oscillation)**; all four poles at −ω with k = 0, spreading as k grows; at k = 4 the two right-most poles are on the imaginary axis [R TIL-P].
  [C] Check: the denominator is (s + ω)⁴ + kω⁴, roots s = −ω + ω·(−k)^{1/4}; at k = 4 that is s = ±jω, so **the oscillation frequency equals the per-stage corner ω** (each stage is 45° at ω, four stages 180°, the same fact in [R ROSS]); the −3 dB point of the open-loop cascade is ω·√(2^{1/4} − 1) = 0.435 ω.
- Per-stage corner: Stinchcombe's exact expression (2008, equation 13, cited by course notes [R? GATECH]) was not readable here. From the small-signal form r_e′ = V_T / I_bias and a stage `1 / (1 + j2ω r_e′ C)` [R? AAC, search excerpt] it follows [C] that ω_stage = I_bias / (2 C V_T), i.e. Ic / (4 C V_T) when a tail current Ic splits over two legs; the engine's existing ladder already fixes this scale, so only the control law needs the Moog numbers.
- The 904A / E-mu-type ladder **loses passband gain as resonance rises** (the feedback is subtracted from the input); no distortion well below cutoff, distortion grows near and above cutoff with level [R ROSS].
- Digital methods for the DSP lane: Huovilainen's per-stage tanh model (DAFx 2004; abstract read, paper not) [R? HUO]; a zero-delay-feedback closed form y = (G⁴x + S)/(1 + kG⁴) with G = g/(1+g) (the posted version has k misplaced: [C] re-derived, §8) [R? KVR]. The engine already has a ladder (engine.js `Ladder`), so the new work is the Moog-specific *control law* (three summed 1 V/oct inputs + a 12-octave fixed knob + the 2-octave range switch) and the 904B / 904C topologies.

### 4.2 Exponential converter and the oscillator families
901A: summer + exponential converter producing a voltage that doubles per octave; 901B: UJT relaxation core (linear in control) + shapers. 921B: own exponential converter, tempco-compensated; 921A: sum / scale only. Consequence for the model [C]: model one exponential law with `f = f0·2^(V_sum + knob + range)`; on the 901 family the *detune vernier acts in the linear domain* (fixed Hz) [R? ZB-EVO]; on the 921B it acts before the converter (fixed interval). Real units drift with temperature (the 901 strongly; the 921 less) [R JD-901, MS-921B].

### 4.3 The 911
Four controls (T1, T2, Esus, T3), three timed stages; **trigger from an S-trigger sets a flip-flop**, independent of the line voltage as long as it is near 0 V; **release = opening of the switch → T3** [R? MF-S]. The curves come from charging / discharging one capacitor through the three time pots: log-shaped, "tame, most of the action in the upper half"; one fixed attack slope [R? MF-911]. Release has nothing to fall from if Esus is 0 [R? MF-911r]. Esus must equal the level at the end of the attack stage or a step / notch appears [R MS-911]. The 902 in *exp* mode turns the 911's contour into the percussive shape; lin mode stays soft [R? MF-902].

### 4.4 Digital-friendly facts for the rest
- 960 / 961 / 962 are digital state machines with RTL logic; their analog parts are the row pots, a UJT LFO clock, and the one-shot [R MS-960/961/962].
- 907 / 914 are passive LC networks with unity-gain buffering [R JD-907, MS-907]; their "low-pass / high-pass" are shelves ["Moog's naming error", R? SOS-914].
- 905 is an acoustic spring: any plausible spring/allpass model is [C].

## 5. Measurable targets for the model (proposed test ledger, all [C] on the cited fact)

| id | target | source fact |
|---|---|---|
| T-OSC1 | 901/921 frequency = f0·2^V, 1 V/oct, summed inputs | [R VK-15, PAT lineage] |
| T-OSC2 | 901 fixed outputs 0.5 V RMS; ramp 1.73, triangle 2.25 (0.65 RMS), sine 1.41, 50 % pulse 2.4 V p-p as a *bench* default; 921B triangle −6 dB, rectangle −3 dB | MS-901B, EME |
| T-OSC3 | 921B range sweep 1 Hz … 40 kHz; 901 Lo 35 mHz … 70 Hz; 921 0.01 … 40 kHz | VK-15, MS-901 |
| T-OSC4 | 921B sync: PLL-type, captures harmonics ≈ 1…6, weak = ¼ the reach | BON, VK-15 |
| T-VCF1 | 904A: 24 dB/oct asymptote; k 0…4; oscillation at k = 4 at the per-stage corner; 3 ranges (1–5k, 4–20k, 16–80k Hz); knob = 12.3 oct | PAT, TIL-P, AION |
| T-VCF2 | 904B: complementary high-pass; ranges 4 Hz–20 kHz and 10 Hz–50 kHz; no resonance | VK-35 |
| T-VCF3 | 904C: series = band-pass, parallel = reject, centre / bandwidth voltage-controlled; bandwidth ≤ 3 oct | PAT, CH |
| T-VCA1 | 902: gain = ×2 at 6 V; lin ∝ V; exp −12 dB/V below 6 V; differential in, upper out inverted | VK-15, MF-902, MS-902 |
| T-EG1 | 911: T1/T2/T3 2 ms … 10 s; Emax 5.5 V; Esus 0 … Emax; opening the S-trigger → T3 from any stage | JD-911 |
| T-FFB1 | 907: bands 250 … 2828 Hz (half-octave), shelves 177 / 4000 Hz, 24 dB/oct, unity gain; 914: 12 bands 125 … 5657 Hz, shelves ≈ 88 / 8000 Hz | JD-907, CH, SOS-914 |
| T-SEQ1 | 960: clock 0.1 Hz … 1 kHz; row maxima 2 / 4 / 8 V; V-trig +3.6 V; stage Skip / Normal / Stop | VK-55, MS-960 |
| T-TRG1 | 961: V→S switch-on 50 ms … 4 s; S→V 4 V; 962 2:1 / 3:1 | MS-961, MS-962 |
| T-ENVF1 | 912: control out vs level table (§3.4), ≈ 0.5 V per doubling | MS-912 |
| T-MIX1 | 984 max gain 1.25; CP3A audio ×2; CP3 clips asymmetrically (+12 / −6 V) | MS-984, ZB-EVO |
| T-LVL1 | all stages clip at their rails (+12 / −6 V originals; ±15 V CP3A) | MF-LVL, MS-CPANELS55 |

## 6. The first scope: a Model 15 ("System 15") sized set, and why

**Proposal: the Moog Model 15 complement as stage 9a.** 9 module types / 13 instances / ≈ 15 MU (fits two ≈ 8 MU rows of the 18 in case [C]):

| module | n | MU | jacks (est. [C] from §3) |
|---|---|---|---|
| 921 VCO | 1 | 2 | 3 freq + 2 width + 2 clamp + 4 out + 2 aux = 13 |
| 921A driver | 1 | 1 | 3 + 2 = 5 (+ a hard link to its 921Bs) |
| 921B oscillator | 2 | 1 | 2 mod + 1 sync + 4 out = 7 each |
| 904A low-pass | 1 | 1 | 1 + 3 + 1 = 5 |
| 902 VCA | 2 | 1 | 3 CV + 2 in + 2 out = 7 each |
| 911 envelope | 2 | 1 | S-trigger in + out = 2 each |
| 907A fixed filter bank | 1 | 3 | 1 in + 1 out |
| 923 noise + filters | 1 | 1 | LP in/out, HP in/out, white ×2, pink ≈ 7-8 |
| 995 attenuators | 1 | 1 | 3 in + 3 out |
| controller panel (our own "CP15", plus a keyboard source) | 1 | row 2 | pitch CV ×2, S-trigger ×2, 4-in mixer ± , multiples |

About **70 jacks** plus the controller panel. Reasons: (1) it is the smallest *complete* Moog voice (3 oscillators + LFO use, noise, 24 dB filter, fixed filter bank, two envelopes, two VCAs) and
it is exactly the reissue Moog sold, so every number above exists in a first-party spec [VK-15]; (2) the DSP it needs is small and mostly in hand: the ladder exists, the 911 shares a
contour circuit with the Minimoog, a differential VCA, an exponential converter, a PLL-style sync, one S-trigger cable type; (3) it forces the three modelling decisions every later module needs
(volts as the unit and rail clipping; driver / slave "hard links"; the S-trigger cable) without the 960 logic or the 24-voice cabinet; (4) 9 panels is a render load the S0 answer can
carry. Pitfall to decide early: the CP15 contents are unknown, so design the controller / mixer panel ourselves (CP3A: 4-in mixer with ± outputs and click filter is the proven shape) [C].

Staging beyond it [C]: **9b = System 35 delta** (+904B, +1 each of 902 and 911, +1 921A, +2 921B, CP3A ×2, CP4A); **9c = System 55 delta** (+914, 911A, 903A, 960 / 961 / 962 + Sequencer Complement B, 992 / 993 / 994, 5 × 902 / 911, 6 × 921B); **9d = the 1960s extras** (901 family, 904C, 905, 912, 984, 991, CP3 ×4). Order by dependency: S-trigger first, then V-trigger with 961, then sequencer logic.

## 7. Implications the modular engine inherits (from the facts, [C])
- Treat every jack as a **ground-referenced voltage** with a module-specific input impedance and rail clip; no "audio vs CV" type distinction at the cable. Two cord kinds: 1/4" (everything) and Cinch-Jones (S-trigger).
- AC vs DC coupling is a per-jack property (921B has both; 984 is AC; 962 is positive-only; 902 is DC-coupled differential).
- Hard links: 901A→901B and 921A→921B (a rear edge connector, not a jack); the width voltage is shared per driver.
- Normalled paths (902 inputs to ground, 912 control→comparator, 995 chain, 993 / 992 buses) are state, not cables.

## 8. Uncertain / conflicting

| item | the conflict | what we used |
|---|---|---|
| S-trigger open voltage | +12 V (forum, 911 line; 950 collector "−12 V via 470 k"), +5 V (sdiy wiki), "the receiver supplies it" (Behringer / amsynths excerpts), a ≤ 1 V low threshold (forum SPICE) | model as a switch to ground read through a pull-up ≈ +12 V; start threshold < 1 V |
| 911 trigger polarity wording | VK and JD quote "closure … directs the contour to T3"; every working description (961 A inputs follow the V-trig, the 950's Q6, Behringer symptoms) has *closure = key held = attack / hold*, opening = release | closure starts, opening releases [C] |
| 911 time range | spec 2 ms … 10 s vs range list 10 ms … 10 s | 2 ms … 10 s |
| 911A delay range | 2 ms … 2 s spec; bench 2 ms … 10 s; Behringer 2 ms … 10 s | 2 ms … 2 s with a trimmer-able max |
| 911 attack shape | one fixed slope, "log" from capacitor charge (forum); CH emu: nearly linear attack | log RC charge toward a target above Emax [C] |
| 902 "gain of 3 = +4.7 dB" | 7.5 V ⇒ ×3 is +9.5 dB, +4.7 dB is ×1.7; at 6 V the gain is ×2 | gain ∝ V (lin) clamped at 7.5 V ⇒ ×2.5 [C]; check on a unit |
| 904B range shift | VK "1½ octaves"; CH 1.25-oct steps; the listed numbers 4 → 10 Hz = 1.32 oct | 1.32 oct |
| 904A top range | 80 kHz (Aion, VK-implied) vs 60 kHz (Modcan) | 80 kHz |
| 914 shelf corners | 90 Hz / 8 kHz (CH, = 125/√2 and 5657·√2), 100 Hz / 7.5 kHz (Behringer) | 88 Hz / 8 kHz |
| 914 top band | 5.6 / 5.7 / 5.8 kHz | 125·2^(11/2) = 5657 Hz |
| 995 normalling | series chain "1 → 1-2-3" (MS) vs each input normalled to the jack above (CH emu) | series chain per MS (a bench unit) |
| 921A scale | "0.5× gain, ±3 V ⇒ ±6 oct" (restorer's trimmers) vs "1 V/oct" everywhere else | outwardly 1 V/oct |
| 901A: 921A fan-out | 3 (restorer, wiring) vs 12 (manual quote via JD; Behringer 921A) | 3 per driver in the UI; allow up to 12 [C] |
| 921 waveform count | 4 main + 2 aux (VK, MS) vs "6 waveforms" (Moogseum, Behringer: up/down saw, pulse, sub mode) | 4 main + selectable aux |
| 960 quantised output | emu: half-volt steps (can't be semitones: 1/12 V); other sources: not said | unquantised outputs first; quantised = 1/12 V steps [C] |
| 960 "9th off stage" | CH emu only | not in v1 |
| 912 | trigger output on a 1/4" jack (restorer) vs S-trigger family elsewhere | S-trigger via a 1/4" jack |
| 903A band | "25 Hz … 20 kHz" odd retailer wording | white to ≥ 20 kHz, 1/f pink |
| widths | only 901 (3), 901A/B (1), 907 (4), 907A (3), 911 (1), 921 (2), 921A/B (1), 961 (3), 962 (1) documented; the rest estimated | `≈` column of §3 |
| system names | "Model 15" (Moog, 1973 and the reissue) = "System 15" (sequencer.de, Behringer) = the `Synthesizer I` class; "System 10 / 12" in sequencer.de vs "Model 10 / 12" in Moogseum | Model 15 |
| IIIc / IIIp counts | 36 vs 37 modules (the power supply) | 36 + power |
| "6401 bass/treble" | no Moog modular module of that number was found | 984 bass / treble |
| CP15, 950, 952, 956, 958, 959, 982, 991, 906 | numbers listed in catalogues; no controls / ranges found | out of the first scope |
| "916 interface" | JD-911 says a "916" is needed to drive from CV; every other source says 961 | 961 |
| ZDF closed form of the ladder | the KVR post prints y = (G⁴x + kS)/(1 + G⁴); the nested form y = S + G⁴(x − k·y) gives y = (G⁴x + S)/(1 + k·G⁴) [C] | the re-derived form |
| the 904A "1960s vs 1970s" | the 1960s unit is preferred for tone, the 1970s one oscillates more easily (opinion, ZB-EVO) | one 904A with a "revision" option later, not in v1 |

## 9. Sources

Primary-ish (patent, quoted Moog spec, bench measurements):
- PAT — US 3,475,623 (Moog, ladder filter), Google Patents: https://patents.google.com/patent/US3475623A/en
- TIL-P — Don Tillman, Moog patent reviews: https://till.com/articles/moog/patents.html ; TIL-A (lists AES preprints 346, 413): https://till.com/articles/moog/
- JD-901 https://djjondent.blogspot.com/2020/05/moog-modular-901-vco.html ; JD-907 https://djjondent.blogspot.com/2020/06/moog-907-fixed-filter-bank.html ; JD-911 https://djjondent.blogspot.com/2020/06/moog-911-envelope-generator.html ; JD-961 https://djjondent.blogspot.com/2020/05/triggers-moog-961-interface.html ; JD-921 https://djjondent.blogspot.com/2025/03/moog-921-vs-921a921b-combinations.html ; JD-CABLE https://djjondent.blogspot.com/2020/06/moog-cable-s-trig-to-v-trig.html
- MS — restoration pages, base https://modularsynthesis.com/moog/ + `901/901.htm`, `901a/901a.htm`, `901b/901b.htm`, `902/902.htm`, `903a/903a.htm`, `904a/904a.htm`, `904b/904b.htm`, `904c/904c.htm`, `905/905.htm`, `907/907.htm`, `911/911.htm`, `911a/911a.htm`, `912/912.htm`, `914/914.htm`, `921/921.htm`, `921a/921a.htm`, `921b/921b.htm`, `930/930.htm`, `951_keyboard/951.htm`, `960/960.htm`, `961/961.htm`, `962/962.htm`, `984/984.htm`, `992/992.htm`, `993/993.htm`, `994/994.htm`, `995/995.htm`, `cp3/cp3.htm`, `cpanels/cpanels55.htm` (MS-CPANELS55), `cpanels/cpanels1.htm` (MS-CPANELS1), `system55/moog_system55.htm` (MS-S55)
- VK — Vintage King product pages that restate the Moog reissue spec: VK-15 https://vintageking.com/moog-music-model-15 ; VK-35 https://vintageking.com/moog-music-system-35 ; VK-55 https://vintageking.com/moog-music-system-55 ; VK-3C https://vintageking.com/moog-music-synthesizer-iiic ; VK-3P https://vintageking.com/products/moog-synthesizer-iiip ; VK-SQB https://vintageking.com/moog-music-sequencer-complement-b
- MSG-EVO — Moogseum / Bob Moog Foundation, Evolution of Moog Synthesizers 1964-2002: https://artsandculture.google.com/story/agUh-zsKII1HOQ ; MSG-901C https://artsandculture.google.com/story/FgURBDetmLOPcw
- AX — audioXpress, reissue announcement: https://audioxpress.com/news/Moog-Recommences-Manufacturing-Large-Format-Modular-Synthesizers ; STP-3P https://synthtopia.com/?p=93453

Secondary:
- ZB-900 https://notebook.zoeblade.com/900_Series_Moog.html ; ZB-EVO https://notebook.zoeblade.com/The_evolution_of_the_900_Series.html ; ZB-CJ https://notebook.zoeblade.com/Cinch-Jones_connector.html ; ZB-SQ https://notebook.zoeblade.com/Sequencer_Complement.html ; ZB-BEH https://notebook.zoeblade.com/900_Series_Behringer.html
- SEQ https://www.sequencer.de/syns/moog/Modular.html (System 10 / 15 / 35 / 55 lists) ; SEQ-B https://www.sequencer.de/blog/moog-modular-module-modules/2490 (module functions incl. 928) ; SDIY-MM https://sdiy.info/wiki/Moog_modular_synthesizer ; SYN-GT https://shop.synthesizers.com/blogs/learn/gates-and-triggers-explained ; SYN-FF https://synthesizers.com/formfactors.html (excerpt)
- WK-CV https://en.wikipedia.org/wiki/CV/gate ; WK-MOOG https://en.wikipedia.org/wiki/Moog_synthesizer ; WK-AS https://en.wikipedia.org/wiki/Analog_sequencer
- ROSS — Dave Rossum on the ladder: https://www.rossum-electro.com/pages/daves-lab-evolution-of-evolution ; GATECH (Stinchcombe equation 13 cited): https://lanterman.ece.gatech.edu/ems11/hw4_11/ ; AAC (search excerpt): https://www.allaboutcircuits.com/technical-articles/small-signal-open-loop-transfer-function-moog-filter/ ; HUO (abstract): https://dafx.de/paper-archive/details/UervgvkeeDC1a4sWDluM4Q ; KVR https://www.kvraudio.com/forum/viewtopic.php?p=8239203
- MODC https://modcan.com/amodules/904A.html ; AION https://analoguehaven.com/aion-modular/904a ; E490 (excerpt) https://synthtech.com/docs/E490_manual.pdf ; ADO-921B (excerpt) https://www.adorama.com/BE921BOSC.html ; SOS-914 https://www.soundonsound.com/reviews/ajh-synth-fixed-filter-bank-914 ; BON https://www.bonedo.de/artikel/behringer-system-55-test/ ; THO https://www.thomann.co.uk/behringer_911_envelope_generator.htm ; EME (excerpt) https://emeapp.org/sonic-evaluation-of-a-moog-model-15 ; MX-15 https://www.matrixsynth.com/2017/01/moog-modular-15-clone-mos-lab-system-8a.html ; PC-953 (excerpt) https://www.perfectcircuit.com/moog-953-duophonic-61-note-keyboard.html
- Emulation manuals (CH): https://docs.cherryaudio.com/cherry-audio-mrb/vm900-NNN with NNN = 901, 901abbb, 902, 903, 904abc, 905, 907a, 911, 911a, 912, 914, 921, 921abbb, 923, 927, 928, 958, 960, 962, 984, 995, cp3
- Moog Music forum: MF-S https://forum.moogmusic.com/t/s-trig/15618 ; MF-902 https://forum.moogmusic.com/t/902-vca-lin-v-exp/12863 ; MF-911 https://forum.moogmusic.com/t/slowing-down-911-eg-possible/21063 ; MF-911r https://forum.moogmusic.com/t/911-release/16903 ; MF-953 https://forum.moogmusic.com/t/model-15-and-953-triggering/17964 ; MF-LVL https://forum.moogmusic.com/t/output-levels-901b-synth-com-oakley-compared/7273 ; MF-901D https://forum.moogmusic.com/t/found-info-on-the-901d-and-a-modular-patch-book/13327 ; MF-PWR (excerpt) https://forum.moogmusic.com/t/powe-supply-for-modulars/12316

Not read (listed so the next pass can): the Moog modular service manual page scans (https://emusic-diy.org/moogmanuals:moogmodular), Moog's Model 15 Tutorial Reference PDF (moogmusic.com/downloads/…/Model_15_Tutorial_Reference.pdf, 404 / image text), the 953 quick-start, the Synthesizers.com Q960 and Behringer 960 data sheets, AES preprints 346 / 413, Stinchcombe 2008 and Huovilainen 2004 full papers (binary PDFs), moogarchives.com (connection refused).
