# Drum machines worth emulating — research for ROADMAP stages 7 (Drum machines) and 8 (Pad controller)

Scope: a survey for the canvas branch (2026-10-20). Nothing in the project was edited. Original content only: circuits and behaviour are
facts, recordings, trademarks, logos and artwork are not ours to copy. Everything below that is a fact carries a source URL and a
confidence tag.

Confidence tags
- **[P]** primary: peer-reviewed paper, manufacturer document, service notes.
- **[S]** reputable secondary: Wikipedia, Sound On Sound, Attack, period magazine reviews, a named expert's page.
- **[W]** weak: retailer / aggregator / fan spec tables. These disagree with each other often (conflicts are called out).
- **[V]** verified by looking at a photograph of the real unit (Wikimedia Commons URLs are given): layout facts only.
- **[K]** my own domain knowledge, not verified in this run. Treat as a to-do for the panel-research lane.

Things that could NOT be fetched in this run (so a few facts stay [W] or [K]): Roland's support spec pages (HTTP 403; the figures below
reached me only through search-result summaries of them), Roland / Sweetwater / static.roland.com PDFs (403), archive.org manuals
(503), the TR-808 service notes (listed on manualslib, body not machine-readable), web.archive.org (blocked). The service notes are
where the missing voice circuits live (see section 5).

---------------------------------------------------------------------------------------------------------------------------------

## 1. Executive summary

1. **Two families, two kinds of honesty.** (A) Analog machines (Roland TR-808 / 606 / CR-78, Korg KR-55, Boss DR-55, Simmons SDS-V
   and the partly analog TR-909): the sound is a circuit, so a circuit-level emulation in the project's 64-bit, oversampled worklet is
   exactly the existing mission, and the circuits are facts. (B) Sample / PCM machines (LM-1, LinnDrum, DMX, Drumulator, Drumtraks,
   SP-1200, TR-707, RX, HR-16, MPC60): the sound is the recordings plus the converter chain. We cannot ship the recordings, so the honest
   emulation is: original kit sounds + a faithful model of the machine's converters, analog stages, tuning law, voice allocation and
   sequencer feel + a "bring your own chip" slot (several of these machines literally swapped EPROMs). Section 2.5.
2. **Recommended order:** TR-808 first (flagship; two peer-reviewed circuit analyses exist; the user's likely first ask) -> TR-606
   (tiny, the TB-303's partner already in the app, DIN-sync story) -> TR-909 (hybrid: analog drums + 3 PCM cymbal/hat samples we must
   replace honestly) -> Simmons SDS-V (analog drum synth, no sequencer, perfect target for the stage 8 pads) -> CR-78 / KR-55 (the
   preset-rhythm engine) -> LinnDrum / DMX / SP-1200 (converter-chain machines) -> TR-707 / RX / HR-16 and the MPC60 idea later.
3. **DSP is cheap.** A rough one-voice micro-benchmark at a 192 kHz internal rate (OS 4) on the M4 Max in plain JS: 808 kick-class chain
   0.3 %, 808 cymbal chain (6 squares + 2 band-pass + 4 high-pass + tone) 1.5 %, 8 ringing resonators + noise 1.7 %, 12 PCM voices
   with 12-bit quantise + zero-order hold 2.1 % of real time, when sounding continuously. A whole machine with every voice ringing is
   about 6-10 %; idle voices cost nothing. For scale the cost table has the TB-303 at 0.019 and a Prophet-5 chord at 0.038
   (cv-cost.js). The hard parts are documentation, UI size and IP, not CPU. (Spike: scratchpad/drums/spike/*.mjs, order of magnitude only.)
4. **Documentation is uneven.** Published circuit-level analysis exists for the TR-808 bass drum and cymbal/hat voices (Werner, Abel,
   Smith) and, abstract-only, its cowbell; everything else (808 snare / toms / clap / rim, 909, 606, CR-78, Simmons) needs the service
   notes or a reconstruction. Section 5 lists where to get them.
5. **Real risks:** (a) Roland has enforced IP on a software 808 before (ReBirth retired 2017), so no sampled audio, no logos, original
   art; the project's existing stance. (b) Per-voice outputs (808 has individual outs for every voice) fight the 1f rule "one
   instrument per track, read-only cables"; decide before building. (c) These panels are big (the 808 is about 508 x 305 mm = ~1016 x
   610 px at 2 px/mm), so the 1f lesson ("the panels get bigger: measure") applies. (d) Several spec numbers conflict between sources;
   the build lane must pin them from service notes / manuals.

---------------------------------------------------------------------------------------------------------------------------------

## 2. Cross-cutting findings

### 2.1 How the analog machines make sound (the building blocks to implement)

| Block | Where | How it works / what to model |
|---|---|---|
| **Ringing bridged-T / twin-T resonator** | 808 BD, SD tone, toms, congas, rim shot / claves; Korg Mini Pops 120 (1976: bass and snare bridged-T, congas twin-T) | An RC network in an op-amp's feedback path is a band-pass; a 1 ms pulse excites it and it rings, decaying by itself (positive feedback sets the decay). No VCO, no envelope generator, no VCA. Accent changes the trigger amplitude. Retrigger before silence continues from the resonator's state: no "machine-gun" effect. [P] Werner DAFx-14 below, footnotes 14-15; [S] SOS bass drum |
| **Noise + filter + VCA/EG** | 808 snare "snappy", clap, maracas, toms' rumble; 909 snare noise path | 808 noise is a reverse-biased transistor junction in avalanche breakdown [S] Whittle. Clap = cluster of closely spaced filtered, distorted noise pulses (a sawtooth-shaped envelope) plus a softer exponential "pseudo-reverb" decay [S] Whittle; clap and snare share the noise source in the 909 (audible phasing) [S] |
| **Metallic oscillator bank** | 808 cymbal, open / closed hat, cowbell | Six square-wave Schmitt-trigger oscillators on one HD14584 hex inverter (nominal 205.3, 369.6, 304.4, 522.7 Hz; #5 and #6 trimmable 359.4-1149.9 and 254.3-627.2 Hz, factory-set 800 and 540 Hz which are the cowbell's pair), summed through resistors into two active band-pass filters (centres about 3440 and 7100 Hz), enveloped in three bands by "swing-type VCAs" (a transistor + diode clipper whose supply is the envelope), then Sallen-Key high-passes (about 10.5 kHz corner, one with resonance), a tone stage and level/buffer. Duty cycle 47.98 % at 5 V. [P] Werner ICMC 2014 |
| **VCO + envelopes** | 909 BD (saw -> waveshaper -> near-sine, pitch EG fast attack / slow decay, click = noise through LPF + short pulse, own EG; accent changes EG1 attack/decay); 909 snare (two triangle oscillators + binary noise, about 180 / 330 Hz shell modes) | [S] SOS bass drum / snare articles; [W] TipTop SD909 listing for the snare layout |
| **Drum-synth module** | Simmons SDS-V | Triangle VCO -> passive LPF (about a sine); noise -> SSM2044 4-pole LPF as body or click; 4 EGs, 3 CA3080-type VCAs, a triangle LFO; controls: noise level, tone level, bend, decay, noise tone, click. The only circuit description I found is a DIY *reconstruction*, not Simmons' own schematic [W] syntherjack |
| **Analog envelope on ROM audio** | 909 hats / crash / ride; 707 cymbals / hats | A ROM sample (6-bit) read by an address counter, DAC, VCA with an envelope from a second DAC through an anti-log converter; tuning = counter clock (about 30 kHz [S] SOS), then LPF. 707: open / closed hat share one source, the open/closed select changes the decay shape; crash and ride each own ROM + counter + DAC + EG [P] 707 service notes |

**TR-808 bass drum, in numbers** [P] Werner, Abel, Smith, DAFx-14 (https://dafx14.fau.de/papers/dafx14_kurt_james_werner_a_physically_informed,_ci.pdf):
CPU (uPD650C-085) sends a common trigger plus per-voice data; a 1 ms pulse, amplitude 4-14 V set by the global accent pot VR3, goes through
a diode pulse shaper (a low shelf with a one-diode-drop clamp) into a bridged-T band-pass in an uPC4558 feedback loop; centre
about 49.5 Hz (Roland's tuning chart says 56 Hz); for about 6 ms after the trigger a transistor (Q43) shorts part of the network, jumping
the centre frequency by over an octave and raising Q (the "punch"); a diode + capacitor (C39 / R161 / D52) then injects a retrigger pulse
so the amplitude does not jump; leakage through R161 into Q43's base is the slow downward "pitch sigh" (the sigh and the attack jump
are different effects, which the paper says people conflate); decay (VR6) is a high-shelf in the feedback buffer; tone (VR5) is a
passive low-pass; level (VR4) a divider + high-pass. Their model: bilinear transform, transposed direct form II (good with
time-varying coefficients), a unit delay in the delay-free feedback loop, memoryless nonlinearities for the diodes and Q43's current
(fit: alpha 14.3150, V0 0.5560, m 1.4765e-5). Tolerances (caps +-20 %, resistors +-5 %) explain why no two 808s sound alike.
**Cymbal paper numbers** [P] (https://speech.di.uoa.gr/ICMC-SMC-2014/images/VOL_2/1453.pdf): attack smoother = one pole with tau about 0.1 ms and a
0.7258 V drop; envelope generators with a decay pot (VR2) per band, release solved as a switched first-order ODE (Von 0.5899); swing-VCA
modelled by two stretched exponentials + a clipping law (alpha 3.5); the tone stage is a fifth-order passive network with weakly
separated controls; the level stage differentiates (6 dB / octave slope); the paper renders at 4x oversampling to tame bilinear
warping. Companion cowbell paper (AES 137th, paper 9207, abstract only): https://aes2.org/publications/elibrary-page/?id=17530
Werner's dissertation uses this bass drum as its running example: https://purl.stanford.edu/jy057cz8322

**Other measured 808 oscillator values** [W] (a Japanese fan page that cites the service manual,
https://scrapbox.io/0b5vr/TR-808): BD about 56 Hz; snare tones about 238 and 476 Hz + noise through a high-pass; toms 90 / 135 / 185 Hz with a
slight attack bend and a little pink-noise "fake reverb"; congas 185 / 250 / 400 Hz (same circuit, no noise); rim shot 455 and 1667 Hz
(each high-passed); claves 2500 Hz; cowbell 540 and 800 Hz through band-passes (confirmed [P] by Werner's oscillator #5/#6 factory
tuning). The 909 snare quoted by SOS (180 / 330 Hz) and this page (238 / 476 Hz) are different machines: do not mix them.

**A Wolfram System Modeler article** gives component-level 808 kick numbers (33 uF feedback cap, 47 k pitch-sweep resistor, trigger
accent 4 V ghost / 8 V normal / 14 V accent, section-5 pulse about 4-6 ms) and measured simulation speed: the full component model
took 3.5 s to simulate 4 s of audio in a general-purpose solver (160 equations, 5 transistors, 2 diodes), and a behavioural reduction took 0.35 s (55 equations); neither claims real-time use. [W/S]
https://blog.wolfram.com/2021/12/29/digital-vintage-sound-modeling-analog-drums-with-the-wolfram-language-and-system-modeler/

### 2.2 The Roland trigger and accent architecture (matters for every Roland-family module)

- The CPU sends a trigger bus (timing + the accent amplitude) ANDed with per-voice data; each voice sees a 1 ms pulse whose amplitude is
  the accent level: 5 V un-accented, 5-14 V accented in stock form (the 808 "4 level accent" mod spans about 2-14 V) [S] Whittle
  http://www.firstpr.com.au/rwi/tr-808/ ; BD pulse 4-14 V, cymbal path 7-14 V [P] Werner.
- Accent therefore changes *timbre* through downstream nonlinearities (BD pulse shaper and Q43; cymbal swing VCAs), not just level. The
  cymbal / hat gating threshold is about 4.5 V in stock form [S] Whittle. A faithful emulation passes a trigger *voltage*, not a velocity.
- DIN sync: Roland 24 PPQN (808, 606, 909 in, 707/727 out, TB-303 in), Korg 48 PPQN (KPR-77, DDM-110/220), pin 5 fill-in used by
  the 808 and 606. [S] https://en.wikipedia.org/wiki/DIN_sync . TR-808 / 606 have an IN / OUT switch; 909 and 303 are in-only.

### 2.3 Sequencer idioms across the machines

| Machine | Steps / scale | Patterns | Song / track | Accent | Shuffle / swing | Flam | Entry | Tempo / sync |
|---|---|---|---|---|---|---|---|---|
| CR-78 (1978) | preset 2-bar rhythms | 34 presets (17 styles x 2 variations), combinable by pressing 2 [S]; WS-1 programmer: 4 user memories, 2-bar patterns, one voice at a time [W] | 8 fill-ins (Fill-in 1-7 + Break), measure selector 2/4/8/12/16 [W] | Accent knob | in the presets | - | step (WS-1) | Tempo knob; trigger out; 12 or 24 PPQ sources disagree [W] |
| TR-808 (1980) | 16 steps, 1-32 over 1st + 2nd part (2 measures); PRE-SCALE 1-4 | 12 basic + 4 intro/fill, each A / AB / B variation (= 32) [P via search, Roland spec] | Rhythm track: 12 tracks x 64 measures = 768 [P]; compose mode records pattern + fill switching live | ACCENT row (an "instrument" that plays no sound) + ACCENT LEVEL knob [S iO-808] | none on the original (the TR-08 added it) [S SOS] | - | step keys; TAP one sound at a time [S SOS] | tempo + fine; AUTO FILL IN every 2/4/8/12/16 measures or manual; DIN 24 PPQ in/out |
| TR-606 (1981) | 16, SCALE 1-4, up to 64th notes | 32 (groups I / II) [S] | 8 track slots (7 x 64 bars + 1 x 256 reported [S]); D.C. bar | "AC" row = total accent only [S manual excerpt] | - | - | step + TAP + WRITE/NEXT | 40-300 BPM [W]; DIN in/out; 2 trigger outs (LT, HT) |
| TR-909 (1983) | 1-16 per measure, SCALE; 32nd-note back-steps are a TR-09 trick [S] | 48 x 2 banks = 96 (16 x 3 groups) [P via search, Roland spec] | 4 tracks x 2 banks, max 896 measures [P via search]; cycle mode | per voice (double-touch) + TOTAL ACCENT knob [S muzines] | SHUFFLE / FLAM button | flam on BD / SD / toms only (not rim, clap, hats, crash, ride) [W/S] | step write (key cycles accent / normal / off) and tap write (two keys per voice: left accented) [S] | 37-290 BPM [P via search]; first Roland with MIDI in/out; DIN in |
| TR-707 (1985) | 1-16 per measure | 64 (4 groups x 16) [S] | 4 tracks, 998 measures [P service notes] | off / mid / strong [W] | 4 global levels | any step | step + tap | 38-250; MIDI + DIN out; trigger out 5 V 20 ms [P] |
| LM-1 (1980) | real-time record | 100 [S] | songs | two pad dynamics (soft / hard, not velocity) [W] | "Feel": a column of LEDs 50 % to 70 % in 4 % steps, one clock later = 54 / 56 [S]; "timing correct" quantise | - | real-time | clock/tape sync, no MIDI |
| LinnDrum (1982) | 2-bar patterns, real / step time, with or without quantise | 42 preset + 56 user [S] | 49 songs | accent on kick, snare, hat [S] | swing built in; 96 ppqn quantise [W] | - | both | no MIDI (third-party), 5 trigger inputs |
| DMX (1981) | quantise 1/4 to 1/48 [W] | 100 sequences [S] | 50 songs | - | swing + "humanise" (rolls, flams, timing) [S] | yes | real-time + step | Parallel Buss; later MIDI |
| Drumtraks (1984) | pattern up to 100 bars, any time signature [S] | 100 | songs of 100 steps with tempo changes; 3289 events; level and tune per event cost memory [S] | - | - | - | real-time | MIDI with velocity; clock in 24/48/96, out 24 |
| SP-1200 (1987) | step or real time | 100 [S] | 100 songs; 5000 notes | per-sound velocity switch | swing + quantise | - | both | MIDI, SMPTE, analog clock |
| HR-16 (1987) | step or real time | 100 | 100 songs; 25 000 events | 8 velocity levels from 16 pads | - | - | both | MIDI, Song Position Pointer |
| KR-55 (1979) | preset only | 16 buttons x 3 banks (A orange / B white / C green) = 48 + 16 intro + 16 fill [V + S] | - | - | SWING BEAT amount knob + "swing only / all rhythms" switch [V] | - | none | trigger out |
| DR-55 (1979/80) | 16 | 6 x 16-step + 2 x 12-step [W] | - | - | - | - | step | - |

Take-aways for a shared sequencer core: the engine needs a "machine personality" layer (pattern memory model, scale, accent model, swing
model, flam model, song model, tap-write semantics), not one generic piano roll. The project's TB-303 sequencer already clocks steps in
the audio thread with a swing parameter and a sync-to-transport mode (engine.js `Inst.seqMsg / seqEvents`); a drum kind would extend that
pattern from one monophonic lane to N voice lanes with per-step accent / flam / sub-step.
Roland Cloud's drum software maps notes 35/36 BD, 37 RS/CL, 38/40 SD, 39 CP/MA, 41/43 LT/LC, 42/44 CH, 45/47 MT/MC, 46 OH, 48/50
HT/HC, 49 CY, 51 CB and uses 8 variations per pattern A-H [S] (https://www.roland.com/global/products/rc_tr-808/ and the owner's manual text): a
reasonable MIDI map for drum tracks in the existing roll / arrangement.

### 2.4 Pads and triggers (input for stage 8)

| Machine | Pads | Dynamics |
|---|---|---|
| LM-1 | 12 hard plastic pads [S] | two levels (soft / hard), not velocity [W] |
| DMX | 18 trigger pads, 24 edit buttons, 10 mixer sliders [W] | none |
| TR-909 | 16 step keys double as pads | none [W polynominal] |
| TR-707 | 16 pads | none (MIDI sends velocity) [W] |
| Drumulator | 4 touch pads [W] | - |
| SP-12 / SP-1200 | 8 buttons | "dynamic buttons" (piezo, 1984), per-sound switch, Multi-Level mode, MIDI velocity depth [S] Rossum |
| HR-16 | 16 pads | 8 velocity levels [S] |
| MPC60 (1988) | 16 pads | velocity (and note repeat) [S] |
| Simmons SDS-V (1981) | hexagonal pads (first hard plastic, later rubber), per-module pad sensitivity, trigger input 1/4" [S] | analog sensing |
| Roger Linn on groove | | pad dynamics added 1984 (Linn 9000); pressure-sensitive note repeat sets roll velocity [S] https://attackmagazine.com/?p=10694 |

Linn's swing definition (still the usable one): the ratio of the first to the second sixteenth inside each eighth; 50 % none, 66 % triplet,
54 % loosens straight sixteenths without sounding like swing; swing applies to quantised sixteenths. [S]
https://brettworks.com/2013/07/23/roger-linn-on-drum-machine-groove-and-j-dillas-off-beat-sound/

### 2.5 An honest, original-content emulation of the sample machines

What actually defines each sample machine, and what we may do about it:

1. **The recordings** (Art Wood's drums on the LM-1, Hoshiai's Paiste / Zildjian cymbals on the 909, etc.) are copyrighted audio: never
   copy, never approximate by resynthesis-to-match. Ship **original kits**: sounds we synthesise ourselves (modal membrane models,
   noise bursts, FM, inharmonic partial banks for cymbals) or record, then pass them through the machine's chain.
2. **The converter chain** (this is where the "sound" of the hardware really is, and it is fact, not content):
   - LM-1: 8-bit non-linear (companded) samples, about 28 kHz, through an AM6070 DAC [W]; no brick-wall reconstruction filter,
     so imaging stays in (the brighter sound) [S hollowsun]; per-sound analog tuning; a hat decay control; sounds in EPROM.
   - LinnDrum: 8-bit, 28-35 kHz [W/S], swappable sound chips; Drumtraks accepts LinnDrum chips [S].
   - DMX: 8-bit companded (about 12-bit equivalent) in 4 KB 2732 EPROMs on removable voice cards, one voice per card, tuning trimmer per
     card (+-half octave) [S/W].
   - SP-1200: 12-bit linear, 26.04 kHz, 8 voices, 2.5 s per sound, pitch by "drop-sample" playback (aliasing and imaging are the
     character), SSM2044 filters on channels 1-2, fixed lower / higher cutoffs on 3-4 / 5-6, 7-8 unfiltered. [S] https://www.rossum-electro.com/pages/education-sp-1200
   - TR-707: 8-bit at 12.5 or 25 kHz, cymbals 6-bit at 25 kHz, analog envelopes / VCAs on the hats and cymbals [W/P].
   - DDM-110: 8-bit about 15.6 kHz [W]; HR-16: 16-bit, 44-47 kHz [S/W]; MPC60: 12-bit non-linear, 40 kHz [S rogerlinndesign]; Yamaha RX5/RX7: 12-bit [W].
   An emulation parameterises: bit depth, companding law, sample rate and how pitch is made (clock change vs drop-sample), the reconstruction
   filter (none / fixed / SSM2044-style), the per-channel analog stage, level / pan / tune quantisation (Drumtraks 00-15), voice
   allocation and choke groups, output grouping.
3. **Bring-your-own chips.** Because LinnDrum, Drumtraks, DMX, Drumulator and SP-1200 were designed around replaceable sounds, a "chip
   slot" that takes the user's own samples (the project already has sample import / storage for Serum) is both historically right and
   keeps us clear of shipping anyone's audio.
4. **Disclosure.** Label shipped kits as ours ("not the original samples"), as the project does with original wavetables.

For the 909 the same logic gives the cymbals and hats: keep the *analog* half (address counter clock tuning, anti-log envelope DAC, VCA,
LPF) and the 6-bit quantisation, but feed it an original source. A synthesised metallic source (a 6-oscillator bank like the 808's)
would be a different sound; say so.

### 2.6 Fit with this project (read from the code, no edits)

- `engine.js` has `Inst.kind` 'analog' | 'serum', per-instrument sequencer code for the 303 (`seqMsg`, `seqEvents`, swing, sync to song
  transport, step events posted to the UI) and a multi-output path for Serum (direct-out and bus pairs, `sxMask`). A third kind 'drums'
  (N fixed voices, per-voice trigger inputs, pattern memory, accent voltage) is the natural shape. `cv-cost.js` has the cost table
  to extend; `tests/bench.json` rows; goldens must stay bit-identical for everything existing.
- `panels/*.js` (the 303 file is 163 lines) is plain layout data in mm at 2 px/mm: controls of kinds knob / button / led / switch /
  rotary, with `seq:` ids that the host wires to the sequencer (the 303's step keys are real panel buttons). The 808 / 909 / 606 / 707
  already *have* 16 real step keys, so the sequencer page is the face, as for the 303.
- `cv-tray.js` `SRC_VIEWS` is a data list; "Drums" is one more entry (HANDOVER 2026-10-19).
- Per-voice individual outputs: the 808 has an output per voice and three trigger outs; the 909 has 10; the LinnDrum 15. With "one
  instrument per track, read-only cables" (1f) these cannot be cables yet. Options: master mix only at first; later "voice -> track" routing in
  milestone 3 or stage 9's patching. **Ask the user.**
- Panel sizes (top view, W x D mm; sources disagree on axes): 808 about 508 x 305 [W] (the photo's aspect 1.68 agrees); 909 about 486 x 300 [W];
  CR-78 300 x 280 [W]; TR-707 380 x 250 [W polynominal; the service notes give 380 x 73 x 250 mm [P]]; TR-606 is the TB-303's sibling (the project's 303
  panel is 300 x 143 mm; one aggregator says 200 x 146, probably wrong: verify). At 2 px/mm the 808 is ~1016 x 610 px, i.e. a 32 x 19
  grid-cell module, larger than any current panel except possibly the modular. The GL face path (1h) handles big faces; the DOM
  controls on it are the cost (16 step keys + ~30 knobs for the 909).
- Naming: the project's models already carry the maker's name (models.js `maker: 'Roland'`); keep the same stance (names as model labels,
  original art, no logos).

### 2.7 IP and risk notes (not legal advice)

- Propellerhead's sample-based ReBirth RB-338 was retired in 2017 after Roland said it infringed its IP [S Wikipedia TR-808
  https://en.wikipedia.org/wiki/Roland_TR-808]. Roland sells ACB-modelled software (TR-808 / 909 / 606 Software Rhythm Composer,
  TR-8S, TR-09) [S roland.com]. A circuit-level emulation with original art and no audio is the project's established position.
- Real recordings (LM-1 / LinnDrum / DMX / 909 cymbals) and service-note schematics as documents are copyrighted; the *circuit facts*
  and component values in them are not. Work from the facts; do not redistribute scans.

---------------------------------------------------------------------------------------------------------------------------------

## 3. Machine-by-machine

Difficulty scale: V = voice DSP, S = sequencer + UI, D = documentation available, C = content / IP risk; 1 (easy / plentiful / safe) to 5.

### A. Analog circuit-level candidates

#### A1. Roland TR-808 Rhythm Composer (1980-83) — the flagship
- **Impact.** About 12,000 built (production ended 1983 / 84; "TR" = transistor rhythm). A commercial flop at launch, then the
  sound of hip-hop, Miami bass, Detroit techno, acid house, trap: Marvin Gaye "Sexual Healing", Afrika Bambaataa "Planet Rock", YMO,
  Run-DMC, LL Cool J, Kanye West "808s & Heartbreak". Designers: Tadao Kikumoto (chief), Makoto Muroi, Hiro Nakamura (voice
  circuits), Hisanori Matsuoka (software / hardware). [S] https://en.wikipedia.org/wiki/Roland_TR-808 . Roland has since reissued it as
  the TR-08, TR-8 / TR-8S, Roland Cloud software, and (2025) the analog TR-1000. [S]
- **Sound generation.** Fully analog (section 2.1): bridged-T ringing for BD, SD tones, toms / congas, rim / claves; noise + filter
  + envelopes for the snare snap, clap, maracas; the six-oscillator metallic bank for cymbal, hats, cowbell. Noise from an avalanche
  transistor. The hat / cymbal gating is a transistor circuit, the clap VCA is reportedly a BA662 [W clone maker]. [P] Werner x2, [S] Whittle, SOS.
- **Voices (11 lanes, 16 sounds).** Bass drum; snare; low / mid / hi tom or conga (slide switch each); rim shot / claves (switch);
  hand clap / maracas (switch); cowbell; cymbal; open hat; closed hat; plus the ACCENT row. The paired sounds share a lane and an
  output and cannot play together [S/W raygum, Roland Cloud manual]. Closed hat chokes open hat [W Cherry Audio].
- **Per-voice controls on the face [V photo + S]:** ACCENT level; BD level / tone / decay; SD level / tone / snappy; each tom-conga
  level / tuning; rim-claves, clap-maracas, cowbell: level only; CY level / tone / decay; OH level / decay; CH level; MASTER VOLUME.
  Internal-only trimmers: tom / conga decay (three small pots), oscillator #5 / #6 tuning (cowbell), accent calibration. Soft attack, clap
  density, noise level and 4-level accent are Robin Whittle's *mods*, not stock. [S] http://www.firstpr.com.au/rwi/tr-808/
- **Sequencer [P/S]:** section 2.3. NEC uPD650C-085 CPU (a mask-ROM 4-bit microcomputer). Three trigger outs (cowbell, clap, accent) [S SOS];
  individual outs on the top rear edge [V]; DIN sync 24 PPQN in/out; no MIDI. Quirk worth emulating? The first pattern / track can
  corrupt from power-transformer transients into the write-enable line [S Whittle]: probably not.
- **Panel [V]** (https://upload.wikimedia.org/wikipedia/commons/e/e6/TR-808_-_MIM%2C_Phoenix_%282019-08-30_14.59.26_by_Bryan_Pocius%29_%28cropped%29.jpg):
  black metal top with a dark grey chassis, vertical end cheeks; jack strip along the rear top edge; top-left POWER slide switch;
  left control block: PATTERN WRITE rotary (1st / 2nd part, manual play, pattern clear, rhythm track play / compose), INSTRUMENT-SELECT rotary
  with the 16 instrument codes around it, STEP NUMBER / PRE-SCALE red button, TRACK CLEAR, AUTO FILL IN rotary (MANUAL 16 12 8 4 2), TEMPO large
  knob with FINE below. Twelve control columns: ACCENT, BASS DRUM, SNARE DRUM, LOW TOM/CONGA, MID, HI, RIM SHOT/CLAVES, HAND CLAP/MARACAS,
  COWBELL, CYMBAL, OPEN HI HAT, CLOSED HI HAT, each with a cream legend plate at the bottom; "Rhythm Composer TR-808 / Computer
  Controlled" in orange script with a thin orange rule; MASTER VOLUME bottom right of the strip. Bottom band: BASIC VARIATION A / AB / B
  switch, big START/STOP bar, the PRE-SCALE legend (note-value staves aligned over the keys), the 1st / 2nd PART LEDs, **16 step keys in four
  colour groups of four: red 1-4, orange 5-8, yellow 9-12, white 13-16**, numbers 1-12 BASIC RHYTHM and 1-4 INTRO/FILL IN underneath, I/F
  VARIATION A/B switch and a TAP (INTRO SET / FILL IN TRIGGER) key at the right.
- **Emulation difficulty: V 4, S 3, D 4, C 2.**
  - Voices: build each as sub-circuit blocks like Werner (trigger logic -> pulse shaper -> bridged-T -> feedback buffer -> tone / level),
    in the existing ZDF / TPT style, 64-bit, OS 4, with explicit time-varying coefficients and memoryless nonlinearities; a unit delay in
    each delay-free loop. Kick, cymbal / hats, cowbell are specified by papers; snare, toms, conga, rim, clave, clap, maracas need the
    service notes (R / C values) and SPICE-style checks (TS-808 and iO-808 / SC-808 exist as open projects to compare against).
  - Optional "unit" seed: +-20 % caps / +-5 % resistors per component (reproducible), because the real machines differ; and
    "voltage starve" / mods are a nice fiction for later.
  - Sequencer: the A / AB / B variation, 1st / 2nd part, pre-scale, auto fill-in and the rhythm-track compose / edit modes are
    the real work; tap writes one sound at a time; accent row + level.
- **Sources.** Werner DAFx-14 https://dafx14.fau.de/papers/dafx14_kurt_james_werner_a_physically_informed,_ci.pdf ; Werner ICMC 2014
  https://speech.di.uoa.gr/ICMC-SMC-2014/images/VOL_2/1453.pdf ; Whittle http://www.firstpr.com.au/rwi/tr-808/ ; Roland spec (via search
  summary) https://support.roland.com/hc/en-us/articles/201963539-TR-808-Technical-Specifications ; iO-808 tutorial https://io808.com/tutorial ; SOS TR-08 review
  https://www.soundonsound.com/node/4918226 ; SOS Synth Secrets: https://www.soundonsound.com/techniques/practical-bass-drum-synthesis , .../practical-snare-drum-synthesis ,
  .../practical-cymbal-synthesis ; service notes / manuals list https://www.manualslib.com/brand/roland/drum-machine.html (e.g. .../manual/695754/Roland-Tr-808.html,
  .../manual/999557/Roland-Tr-808.html).

#### A2. Roland TR-909 Rhythm Composer (1983-85) — hybrid
- **Impact.** About 10,000 built, designed by Kikumoto with Oue (voice circuits) and Hoshiai (software); a commercial failure against
  sampled rivals, then the backbone of Chicago house, Detroit techno, acid, trance (Frankie Knuckles, Derrick May, Jeff Mills, Daft Punk
  "Revolution 909", Chemical Brothers...). First Roland with MIDI and the first with samples; "909 Day" is 9 September. [S] https://en.wikipedia.org/wiki/Roland_TR-909
  Development began 1982 as the TR-880 / 880D / 909D; designed as a "drum synthesizer" so tones could be tweaked live; the cymbals were meant to be analog
  but failed the team's standard, so digital was used for hats, ride, crash. [S] https://www.attackmagazine.com/features/interview/atsushi-hoshiai-the-man-behind-the-tr-909/
- **Sound generation.** Analog: BD, SD, 3 toms (toms designed from an in-house A/D analysis of acoustic toms), rim shot, clap (identical to the
  808's per One Two Testing). Sampled: CH + OH share one hat source, crash and ride: 6-bit, recorded from a 14" Paiste Sound Edge top + 14" Zildjian New Beat bottom
  and an 18" Paiste Thin Crash (edge = crash, bow = ride), no EQ or compression. Playback: ROM, address counter clocked about 30 kHz (SOS) or "18 kHz" (polynominal) [conflict], DAC,
  VCA, envelope from a second DAC through an anti-log converter, LPF; tuning changes the clock so raising pitch shortens the decay. [S] SOS cymbal; muzines
  https://www.muzines.co.uk/articles/roland-tr909/6511 ; [W] https://www.polynominal.com/m/roland-tr-909.htm
- **Controls [V photo + S]:** TOTAL ACCENT; BD tune / level / attack / decay; SD tune / level / tone / snappy; LT, MT, HT tune / level / decay; RIM SHOT and
  HAND CLAP level; HI HAT level(s) + C.H. DECAY + O.H. DECAY; CYMBAL crash / ride level(s) + CRASH TUNE + RIDE TUNE; TEMPO; VOLUME. BD, SD, toms, hats exist
  in accented and normal versions (Roland's spec marks them with an asterisk).
- **Sequencer:** 2.3. Shuffle and flam are dedicated; instrument-select keys double as the numeric keypad; cartridge (memory) slot, tape sync, pulse trigger out,
  pedal start/stop, 10 individual outs + mix [W polynominal].
- **Panel [V]** (https://upload.wikimedia.org/wikipedia/commons/1/1d/Roland_TR-909_%28large%29.png): off-white / light grey plastic, "Roland" top left,
  "TR-909 RHYTHM COMPOSER" top right with a blue-grey rule; a row of 9 blue-headed columns (TOTAL ACCENT, BASS DRUM, SNARE DRUM, LOW TOM, MID TOM, HI TOM, RIM
  SHOT/HAND CLAP, HI HAT, CYMBAL) with dark blue knobs; middle band: START, STOP/CONT keys, 3-digit red MEAS/TEMPO display, big TEMPO knob (SLOW-FAST),
  TRACK PLAY 1-4, PATTERN PLAY 1-3, TEMPO/STEP, BACK/TAP, FWD, AVAILABLE MEAS, CYCLE/GUIDE, TAPE SYNC, CARTRIDGE/ENTER, big VOLUME knob; bottom band: left key
  cluster LAST STEP, SCALE, SHUFFLE/FLAM, CLEAR, INSTRUMENT SELECT, SHIFT; staff-like scale rows above **16 square cream step keys** (all the same colour) with
  numbers 1-16 and below them the instrument / keypad legends: 1-2 BASS DRUM, 3-4 SNARE, 5-6 LOW TOM, 7-8 MID TOM, 9-0 HI TOM, COPY/INS (RIM SHOT, HAND CLAP),
  DEL/SAVE (closed / open hat), VERIFY/LOAD (crash, ride).
- **Emulation difficulty: V 4, S 4, D 3, C 3.**
  - Analog half: SOS-level topologies are public (BD, snare, noise paths); the clap/rim are 808-family; need service notes for values.
  - Hat / crash / ride: the *processing* chain is documented; the *recording* is not ours. Original source + 6-bit quantiser + counter-clock tuning + VCA envelope (section 2.5).
    Decide with the user whether a synthesised metallic source is acceptable and labelled.
  - Sequencer is the largest of the Roland set: 96 patterns, two banks, 8 tracks, per-voice double-touch accent + total accent, shuffle / flam,
    step and tap write, track write, MIDI in/out. Shared clap / snare noise (audible phasing) is a nice authentic detail.
- **Sources.** Roland spec (via search) https://support.roland.com/hc/en-us/articles/201921899-TR-909-Technical-Specifications ; SOS TR-09 review
  https://www.soundonsound.com/reviews/roland-boutique-tr-09-tb-03 ; SOS Synth Secrets (bass drum, snare, cymbal) above ; Attack interview above ; TR-909 software manual
  (note map, CC list) https://www.rolandcloud.com/getmedia/a88fc05f-0b9f-4ba2-8266-b2272ba31572/TR-909-Manual-E.pdf?ext=.pdf .

#### A3. Roland TR-606 Drumatix (1981-84)
- **Impact.** Built as the TB-303's companion (same case family, DIN sync); the acid-house / IDM drum partner: Sisters of Mercy, OMD, Skinny Puppy, Aphex
  Twin, Autechre, Nine Inch Nails, Massive Attack. [S] https://en.wikipedia.org/wiki/Roland_TR-606
- **Sound generation.** Analog; 7 sounds (BD, SD, low tom, hi tom, cymbal, open and closed hat), CPU NEC D650C-128 [W]. Hats / cymbal from six square oscillators ("metal tune"
  in clones), snare from white noise [W Tubbutec]; described as a cut-down 808 [W zoeblade notes]; open + closed together sound different on the 606 [W]. No circuit analysis found.
- **Controls [V]:** six mix-level knobs only (ACCENT, BASS DRUM, SNARE DRUM, L.H.TOM, CYMBAL, O.C.HI-HAT), TEMPO, VOLUME / power. No tune / decay: clones and the
  Roland Cloud / TR-06 versions add them. [V] + [S Wikipedia "sounds cannot be edited"]
- **Sequencer:** 2.3. Accent is a step row for *all* voices; tap + step; D.C. bar; track write by bar numbers (keys labelled 1-9, 0, 100, 200, DEL, INS); trigger outs LT and HT.
- **Panel [V]** (https://upload.wikimedia.org/wikipedia/commons/7/78/Roland_TR-606.jpg): brushed silver / grey metal; top strip with Roland logo, 6 knobs, "Drumatix"
  at right; rear-edge legends RUN/STOP (DP-2), SYNC IN/OUT, TRIGGER OUT LT HT, HEADPHONE, OUTPUT, DC 9V; middle band TEMPO knob, INSTRUMENT / TRACK selector (AC1 BD2
  SD3 LT4 HT5 CY6 OH7 CH8), MODE selector (WRITE / PLAY x TRACK / PATTERN), "TR-606 Computer Controlled" plate, VOLUME / power knob; bottom: PATTERN CLEAR + D.C. BAR RESET, SCALE
  (1-4) + FUNCTION, 16 grey step keys each with a red LED above and a number legend, LAST STEP marker, RUN/STOP with RUN/BATTERY LED, PATTERN GROUP I / II, WRITE/NEXT with TAP /
  STEP RESET. Same size family as the TB-303 (project panel 300 x 143 mm; verify).
- **Emulation difficulty: V 3, S 3, D 2, C 1.** Smallest Roland job; reuses the 808 voice library once it exists; the 303 + 606 pairing (DIN sync) gives a real feature: run a 606
  module and the existing 303 locked together.

#### A4. Roland CR-78 CompuRhythm (1978-81)
- **Impact.** The first microprocessor-controlled rhythm machine with user memory (battery-backed; programmer WS-1 / TS-1): Phil Collins "In the Air Tonight", Blondie "Heart of
  Glass", OMD "Enola Gay", Hall & Oates, Gary Numan, Ultravox; a precursor of the 808's pattern writing. [S] https://en.wikipedia.org/wiki/Roland_CR-78 ; [W] https://vintagesynth.com/roland/cr-78
  (Paia's programmable drum set (1975) and EKO ComputeRhythm (1972) predate it as *programmable* machines [S Wikipedia Drum machine]).
- **Sound generation.** Analog, 14 sounds (kick, snare, rim shot, hi-hat, cymbal, maracas, claves, cowbell, "metal beat", 2 bongos, guiro, tambourine, 2 congas), four-voice polyphony,
  custom 8-bit NEC D8048-C015 CPU [W polynominal https://www.polynominal.com/roland-cr78/]. Circuit details: a user opening one saw 7 inductors on the voice board, two marked for claves and
  rim shot; the TR-77 service manual is related [W electro-music.com forum]. Korg-style twin-T congas are the general analog technique [P Werner fn.14]; whether Roland used them here is unconfirmed.
- **Controls [W]:** LEVEL, BALANCE, ACCENT, TEMPO knobs; sliders for tambourine, guiro and metallic-beat levels; cancel (mute) buttons for BD, SD, cymbal + hat, cowbell + claves;
  8 fill-ins (1-7 + break), rhythm A / B, rolling-HB, SD; measure selector 2 / 4 / 8 / 12 / 16; fade in / out; start / stop; auto / manual; trigger-pulse select 8 beat / 16 beat / combination;
  pedal inputs (DP-1, DP-2). 34 preset rhythms (rock 1-4, disco 1-2, waltz, shuffle, slow rock, swing, fox trot, tango, boogie, enka, bossa nova, samba, mambo, cha-cha, beguine, rhumba...).
- **Panel.** No free photograph was found on Commons (the CR-8000 / CR-5000 are there; not the same panel). Layout above is from a spec list [W]: 5 sliders, 31 buttons, 5 switches, 5 knobs; wood
  sides; 300 x 280 x 205 mm. Needs a photo-based research pass.
- **Emulation difficulty: V 3-4, S 3, D 2, C 1.** The interesting part is the *preset rhythm engine* (two-bar patterns, combine buttons, fills, fade) and its four-voice limit; voice circuits
  need the service manual (https://www.lost-manuals.com/en/manufacturer/roland/cr78 lists one).

#### A5. Korg KR-55 Rhythm 55 / Mini Pops lineage (1979 / 1976)
- **Impact.** Preset-only analog rhythm box; Daniel Miller used it on early Depeche Mode and Fad Gadget records (an ARP 2600 supplied kicks via its trigger), Jean-Michel Jarre, Soft Cell, Cabaret
  Voltaire, Joe Jackson "Steppin' Out". KR-55B (1982) doubled the rhythms to 96. [S] https://docs.cherryaudio.com/cherry-audio/instruments/kr-55c/getting-started ; [S] https://www.synthtopia.com/content/2013/07/02/the-korg-rhythm-55-rhythm-box/
- **Sound.** 12 sounds (BD, SD, two hats, cymbal, low / high conga, rim shot, claves, cowbell, two toms) [W]. SOS credits "multiple pairs of modulated square-wave oscillators" for its metallic sounds.
  The Mini Pops 120's bridged-T bass / snare and twin-T congas are documented in its 1976 service manual (cited by Werner [P], fn.14).
- **Panel [V]** (https://commons.wikimedia.org/wiki/Special:FilePath/Korg_Rhythm_55_(KR-55).jpg): sloped-front case; INSTRUMENTS VOLUME row of 6 knobs (BASS DRUM, SNARE DRUM, CYMBAL, HI-HAT,
  TOMTOM-CONGA, RIM SHOT-COWBELL-CLAVES); 16 black rhythm keys in two rows of eight with three row-selector keys A (orange) / B (white) / C (green) naming 3 x 16 styles (FOXTROT, SWING 1-3, BOSSA NOVA 1-3,
  CHACHA, SAMBA, AFRO, ENKA, TANGO, HABANERA, ROCK 1-12, DISCO 1-6, WALTZ, BALLAD, BEAT, MAMBO, RUMBA, BEGUINE, POPS...), TEMPO and SWING knobs with a SWING ONLY / ALL RHYTHMS slide, VOLUME + POWER,
  INTRO/FILL IN and START/STOP keys.
- **Difficulty: V 3, S 2, D 2, C 1.** A good second analog target after the 808 family because it shares the CR-78 preset engine.

#### A6. Simmons SDS-V (1981) — an analog drum *synth*, no sequencer
- **Impact.** The first widely used electronic drum kit (hexagonal pads, Richard James Burgess + Dave Simmons; Musicaid made the first ones): Genesis (Phil Collins, Chester Thompson), Rick Allen (Def Leppard), Roger Taylor (Queen), Alex Van Halen, Neil Peart (Rush), Danny Carey (Tool). [S] https://en.wikipedia.org/wiki/Simmons_SDS-V
- **Sound.** Per module: variable triangle VCO + noise + SSM2044 filter + envelopes; controls noise level, tone level, bend, decay, noise tone, click; 4 presets per module; 5 standard modules (bass,
  snare, 3 toms), optional cymbal and hi-hat (the cymbal is a digital looped metallic waveform gated by VCF / VCA); mixer section; balanced XLR outs. [S/W] + the DIY reconstruction
  https://syntherjack.net/wp-content/uploads/2014/04/SDSV-DIY-manual-syntherjack.pdf (4 EG, 3 CA3080 VCA, LFO, tone/noise balance, drum/click balance, rim-shot EG, filter used as a second oscillator).
- **Panel.** Pads photographed (hexagonal black, stands) [V https://commons.wikimedia.org/wiki/Special:FilePath/Simmons_SDS5_Electric_Drum.jpg]; the brain's face was not photographed on Commons.
- **Difficulty: V 3, S 1 (no sequencer; the pad is the interface), D 2 (reconstruction only), C 1.** Ideal first customer for the stage 8 pad grid; the "pad sensitivity" and trigger conditioning
  (a piezo / sensing stage) is part of the voice's feel.

#### A7. Boss DR-55 Dr. Rhythm (1979-81) and the Ace Tone / Hammond lineage
- DR-55: four analog voices (kick, snare, rim, hat) from light analog sines and noise; step-programmable, 6 x 16-step + 2 x 12-step patterns; Depeche Mode's first live drummer, New Order, The Cure
  [W/S] https://musictech.com/features/opinion-analysis/boss-dr-rhythm-dr-55/ . DR-110 (1983) six analog sounds. Very simple; a nice small bonus or the "easy first" machine.
- Pre-history for context: Rhythmicon (1930-32), Chamberlin Rhythmate (1957, tape loops), Wurlitzer Side Man (1959, rotating disc), Seeburg Select-A-Rhythm (1964, diode matrix), Ace Tone Rhythm Ace FR-1
  (1965-67, Kakehashi: 16 presets, diode matrix, four hand-played sounds), EKO ComputeRhythm (1972, programmable grid), Maestro Rhythm King (Sly Stone's "Family Affair" 1971, 18 presets, not programmable),
  PAiA Programmable Drum Set (1975), Roland CR-78 (1978), Wendel (1978, 12-bit sampled). [S] https://en.wikipedia.org/wiki/Drum_machine , https://reverb.com/news/gear-tribute-the-maestro-rhythm-king-mrk2-sly-stones-favorite-drum-machine
  Not worth emulating one by one; a "Rhythm box" preset-engine module (KR-55 / CR-78 / Rhythm King style) could cover them.

### B. Sample / PCM candidates (original kit + converter chain; section 2.5)

#### B1. Linn LM-1 (1980) and LinnDrum (1982) — the sampled sound of 1980s pop
- **Impact.** LM-1: Roger Linn; first sample-based drum machine on sale; $4,995-5,500; about 500 (Wikipedia says 525) built; Prince, Michael Jackson, Peter Gabriel, Stevie Wonder, Human League, Gary Numan,
  Jan Hammer's Miami Vice theme; it frightened Los Angeles session drummers. Added "timing correct" quantise and swing. LinnDrum: $2,995, about 5,000 sold, cymbals added, swappable sound chips; Trevor Horn,
  Mark Knopfler, George Michael, Stock Aitken Waterman. [S] https://en.wikipedia.org/wiki/Linn_LM-1 , https://en.wikipedia.org/wiki/LinnDrum , https://rogerlinndesign.com/about/about-museum
- **Sound / chain.** LM-1: 12 instruments (18 sounds: kick, snare, hat, cabasa, tambourine, 2 toms, 2 congas, cowbell, claves, claps; no cymbals), 8-bit non-linear at about 28 kHz via an AM6070 DAC, 9-10
  voices, no brick-wall filter [S/W]; per-sound level slider, 3-position pan switch, rear-panel tune and individual outputs, hat decay. LinnDrum: 15 sounds (adds rim / sidestick, crash, ride, 3 toms),
  12 voices, 8-bit 28-35 kHz [S/W], per-sound level / pan, tuning on snare / toms / congas (sources disagree: "all"), 15 individual outputs, 5 trigger inputs, accent on kick / snare / hat.
- **Sequencer:** 2.3 (swing LED ladder 50-70 %, quantise "timing correct", 42 preset + 56 user patterns, 49 songs, 96 ppqn).
- **Panel [V]** (LM-1: https://commons.wikimedia.org/wiki/Special:FilePath/Linn_LM-1_Drum_Computer.jpg ; LinnDrum: https://commons.wikimedia.org/wiki/Special:FilePath/LinnDrum_digital_drum_machine_front_panel_.jpg):
  both black with orange / red print and wood end cheeks. LM-1: 12 sliders on the right (levels) with tiny pan switches above, 9 + 9 soft / hard plastic pads, two red lighted bank buttons, a cluster of pattern /
  song keys, two knobs. LinnDrum: CASSETTE (store / verify / load) box; CREATE RHYTHM PATTERN / SONG key block (SONG / PATTERN, END, DELETE, INSERT, arrows, ENTER; COPY, LENGTH, ERASE, RECORD; timing-correct +
  SHUFFLE steps 1/8 1/8T 1/16 1/16T 1/32 1/32T) with two red 2-digit displays (step / memory %, pattern) and 7 pattern keys; TEMPO knob + BPM/TRIGGER + EXT SYNC; **TUNING row: 7 knobs (SNARE, TOMS hi / mid / lo, CONGAS hi / lo,
  hat DECAY)**; VOLUME knob; **MIXER: 15 channel faders with a left / right pan slider above each (BASS, SNARE, SIDESTICK, HI-HAT, TOMS HI MID LO, RIDE, CRASH, CABASA, TAMB, CONGAS HI LO, COWBELL, CLAPS, CLICK)**; 16 square drum
  pads in two rows of eight (CABASA 1 2, TAMBOURINE 1 2, CONGA HI LO, COWBELL, CLAPS above; SIDESTICK, SNARE 1-3, TOMS, BASS, CRASH PERCUSSION below), PLAY/STOP; jack strip on the rear top edge.
- **Difficulty: V 2, S 3, D 3, C 5 (the sound *is* the samples).** Honest path: original kit ("a studio kit that is ours") + the chain (companded 8-bit, 28 / 35 kHz clock, no reconstruction filter, pitch by clock, tuning law) + chip slot; the
  sequencer feel (swing ladder, quantise) is the transferable fact.

#### B2. Oberheim DMX (1981) / DX (1983)
- **Impact.** Second commercial digital drum machine (list $2,895); electro / hip-hop / new wave: New Order "Blue Monday", The Police kick on "Every Breath You Take", early Def Jam / hip-hop and
  dancehall. [S] https://en.wikipedia.org/wiki/Oberheim_DMX
- **Sound.** Z80 + 8 plug-in voice cards, each with 4 KB 2732 EPROM(s) (longer sounds across four), companded 8-bit, a tuning trimmer per card (+-half octave), 24 sounds from 11 samples, 12 separate outputs (some say 8) and
  trigger / CV inputs [S/W polynominal https://www.polynominal.com/oberheim-dmx/]. DX (1983): 18 sounds, 6 voices, $1,395.
- **Panel [V]** (https://commons.wikimedia.org/wiki/Special:FilePath/Oberheim_DMX_with_factory_MIDI.jpg): black with blue pinstripe lines, wood end cheeks; 9 vertical faders (BASS, SNARE, HI-HAT, TOMS, CYMBAL, PERC 1, PERC 2,
  METRONOME, VOLUME); 3 x 9 grid of square pads under them (BASS 1-3, SNARE 1-3, HAT closed / accent / open, TOMS 1-6, RIDE 1 / 2 / CRASH, TAMB 1 2 / RIMSHOT, SHAKER 1 2 / CLAPS); METRONOME TEMPO / SIGNATURE / QUANTIZE
  keys; CHECK-PLAY-RECORD, SWING, SONG, EDIT, STEP, RECORD, ERASE, COPY, LENGTH keys; numeric keypad with arrows; red alphanumeric display "SELECT SEQ"; PLAY/STOP.
- **Difficulty: V 2-3 (voice-card tuning + companding), S 3, D 2, C 5.** Same plan as the Linn.

#### B3. E-mu Drumulator (1983), SP-12 (1985) and SP-1200 (1987) — the hip-hop sampler
- **Impact.** Drumulator: first programmable sampled drum machine under $1,000 ($995; over 10,000 sold; 8 voices; synth-pop and Italo disco: Depeche Mode, Cocteau Twins, Tears for Fears; real-time pattern entry
  only, [S] https://en.wikipedia.org/wiki/E-mu_Drumulator ; [W] vintagesynth lists "12-bit" and 8 sounds, Wikipedia 8-bit and 12 sounds: unresolved). SP-1200 (2.5 s per sound, 10 s total, $2,995):
  Public Enemy, N.W.A, Tribe Called Quest, Wu-Tang, Pete Rock, Notorious B.I.G., Daft Punk; the grit of 12-bit / 26.04 kHz with drop-sample pitch shifting and SSM2044 filters is the sound of golden-age
  New York. Reissued by Rossum Electro-Music in 2021 (20 s). [S] https://en.wikipedia.org/wiki/E-mu_SP-1200 , https://www.rossum-electro.com/products/sp-1200/
- **Chain (section 2.5).** Eight 12-bit channels; 26.04 kHz; pitch by dropping samples (aliasing + imaging kept); channel 1-2 dynamic SSM2044, 3-4 / 5-6 fixed filters, 7-8 raw; eight sliders for pitch / volume, 8 pads
  with piezo dynamics, velocity switch per sound; swing / quantise; 100 patterns, 100 songs, 5000 notes; MIDI / SMPTE / analog sync.
- **Panel [V]** (https://commons.wikimedia.org/wiki/Special:FilePath/E-mu_SP-1200_(111607sp1200).jpg): dark grey / navy; section headers Set-up, Disk, Sync, Sample (knob), Mode Control (LCD), Programming (a row of 9 keys),
  Performance (8 vertical sliders over 8 pads), numeric keypad and two knobs.
- **Difficulty: V 3 (resampler + analog filter model), S 3, D 3, C 4.** The most "sampler" of the list: it needs a sample editor / truncation page to be faithful, which edges toward a separate stage.

#### B4. Sequential Drumtraks (1984) and TOM (1985)
- **Impact.** About 8,000 units; Dave Smith's team; one of the first with MIDI (velocity, 1984); Daft Punk "Short Circuit", Tame Impala, Prince (disputed), Orbital. $1,295. [S] https://en.wikipedia.org/wiki/Drumtraks ;
  EMM review https://www.muzines.co.uk/articles/sequential-circuits-drumtraks/1581
- **Sound.** 13 sounds, 8-bit, 12-note polyphony, ROM chips swappable (LinnDrum chips fit), level 00-15 and tune 00-15 per sound (programmable per event), 6 audio channels + metronome out.
- **Panel [V]** (https://commons.wikimedia.org/wiki/Special:FilePath/SCI_Drumtraks.jpg): black, wood end cheeks; CASSETTE, TEMPO slower / faster, SELECT SONG FUNCTIONS block, 2-digit display + keypad, SELECT PATTERN FUNCTIONS block,
  METRONOME and MASTER volume knobs; run/stop, accent, volume and tune knobs for the "selected instrument"; 13 pads grouped by output channel (CH1 bass; CH2 snare, rim; CH3 toms; CH4 crash, ride; CH5 closed / open hat; CH6 claps, tambourine, cowbell, cabasa).
- **Difficulty: V 2, S 3, D 2, C 5.** A good "chip slot" demonstrator; per-event level / tune is a nice sequencer idea.
- Sequential TOM (1985, £799, 4 voices, 8 core sounds + cartridges, reverse playback) is a footnote. [W]

#### B5. Roland TR-707 / TR-727 (1985) (and TR-505 / TR-626)
- **Impact.** First all-sampled Roland; the house / acid workhorse (Marshall Jefferson "Move Your Body", Mr. Fingers; INXS "Need You Tonight"; al jeel pop). Cheap, full-featured (flam on any step, 4 shuffle levels, MIDI,
  DIN out). TR-727 is the Latin set. [S] https://en.wikipedia.org/wiki/Roland_TR-707
- **Sound / chain [P/W].** Hitachi HD6303X; 4 x 32 KB mask ROMs, 15 samples; 8-bit at 12.5 / 25 kHz, cymbals 6-bit 25 kHz; 10-note polyphony with shared channels (cowbell with rim, tambourine with clap, open / closed hat one source); analog envelopes /
  VCAs on the hats and cymbals; 11 sliders (AC, BD, SD, LT, MT, HT, RIM/COW, HCP/TAMB, HH, CRASH, RIDE) + volume; trigger out from rim shot 5 V 20 ms. https://archive.org/stream/roland_Roland_TR707/Roland_TR707_djvu.txt ; https://www.polynominal.com/roland-tr707/
- **Panel [V]** (https://upload.wikimedia.org/wikipedia/commons/1/1a/Roland_TR-707.jpg): light grey; memory-cartridge slot at left, a backlit LCD showing the instrument x step grid, 11 vertical faders + VOLUME at the top right; PATTERN (CLEAR, SCALE, LAST STEP, INSTRUMENT/GUIDE,
  SHUFFLE/FLAM, TEMPO/MEAS), PLAY (TRACK / PATTERN), PATTERN GROUP A-D, ENTER/CARTRIDGE and ACCENT, big TEMPO knob, STOP/CONT, START, SHIFT, 16 black step keys with orange legends.
- **Difficulty: V 2, S 3, D 3, C 4.** Mid-priority; its flam / shuffle / group model reuses the 909's.

#### B6. Korg DDM-110 / DDM-220 (1984-85)
- Cheap digital: 9 sampled sounds, 8-bit, about 15.6 kHz [W], 32 patterns, 6 songs, per-sound accent, **DIN sync at 48 PPQN** (Korg), no MIDI. Low-fi charm; low priority. [W] https://www.vintagesynth.com/korg/ddm-110 , https://www.smemmusic.ch/en/korg-ddm-110-super-drums-programmable-digital-drum-machine

#### B7. Yamaha RX11 (1984) -> RX15 / RX21 / RX5 (1986) / RX7 (1988)
- RX11: Yamaha's first, ¥137,000 / $895, 29 PCM sounds in six 256 Kbit ROMs, 100 patterns, 10 songs, 16 mini keys, individual outs; users from New Order to Aphex Twin. RX5: 12-bit, 24 pads, 16 notes, 100 patterns, 20 songs, 12 individual outs, cartridges,
  $1,200. RX7 (1988): 100 12-bit waveforms, 16 notes, 96 PPQN. [S/W] https://en.wikipedia.org/wiki/Yamaha_RX-11 , https://soundprogramming.net/drum-machines/yamaha/yamaha-rx5/ , https://soundprogramming.net/drum-machines/yamaha/yamaha-rx7
  Bit depth / sample rate and per-voice controls conflict or are missing (pitch, envelope, velocity, 12-channel mixer). Low priority.

#### B8. Alesis HR-16 (1987) and the budget wave
- "First truly low-cost digital drum machine" ($600): 49 16-bit sounds, 16 voices, 16 velocity pads (8 levels), tune about two octaves, 4 outputs (2 stereo pairs), 100 patterns / 100 songs / 25 000 events; Orbital, Leftfield, Autechre. HR-16B has newer samples. [S/W]
  https://www.attackmagazine.com/reviews/the-best/top-ten-classic-drum-machines/ ; https://www.muzines.co.uk/articles/alesis-hr16-drum-machine-and-mmt8-midi-recorder/2078 (47 kHz, 16-bit, 48 sounds in the preview) . Peers: Roland TR-505 / TR-626 / R-8, Casio RZ-1 (1986, first affordable sampler-drum box),
  Korg DDD-1, Alesis SR-16 (1991). All "just sample playback"; their identity is the kit, not the circuit.

#### B9. Akai MPC60 (1988) and Linn 9000 (1984) — the pad era (relevant to stage 8)
- MPC60: Roger Linn + Akai, $5,000, 16 touch (velocity) pads, 12-bit non-linear at 40 kHz, about 26 s, 16 voices, the swing / quantise groove J Dilla's and hip-hop's feel hangs on. Linn 9000 (1984, $5,000): user sampling + MIDI sequencer + SMPTE,
  programmable hat slider, buggy OS; Linn Electronics closed in 1986. [S] https://rogerlinndesign.com/about/about-museum ; https://musictech.com/guides/essential-guide/drum-machines-history/ . Not a stage 7 machine: the *pad grid + swing + note repeat* is stage 8's design material.

### C. Modern references (not to emulate, but prior art for web / software ports and for behaviour checks)
- Roland Cloud TR-808 / 909 / 606 Software Rhythm Composer (ACB circuit modelling; 8 variations per pattern; flams and sub-steps; MIDI map) [S roland.com];
  TR-8 / TR-8S / TR-08 / TR-09 / TR-06 (SOS TR-09 review confirms the shared clap / snare noise phasing is modelled);
  open projects: iO-808 (Web Audio; https://io808.com), HTML-909 (MIT, no samples), SC-808 (SuperCollider), TR-909 in FAUST (GitLab), TS-808 (SPICE-based);
  Cherry Audio Misfit "Transistor 808 hats / cymbal" docs (a six-oscillator, split-band description) https://docs.cherryaudio.com/misfit-audio/transistor-808-cymbal .
  Werner's CCRMA models are in Gen~ (not a ready port).

---------------------------------------------------------------------------------------------------------------------------------

## 4. Priority and difficulty matrix

| # | Machine | Family | Why | V | S | D | C | Suggested slot |
|---|---|---|---|---|---|---|---|---|
| 1 | TR-808 | analog | flagship, best documented, the user's likely first ask | 4 | 3 | 4 | 2 | 7a |
| 2 | TR-606 | analog | tiny, 303 partner, DIN-sync story, reuses 808 voices | 3 | 3 | 2 | 1 | 7b |
| 3 | TR-909 | hybrid | enormous impact; honest-hat decision needed | 4 | 4 | 3 | 3 | 7c |
| 4 | Simmons SDS-V | analog | pad-triggered, no sequencer, ties to stage 8 | 3 | 1 | 2 | 1 | 7d with 8 |
| 5 | CR-78 / KR-55 | analog | preset-rhythm engine, new-wave sound | 3-4 | 2-3 | 2 | 1 | 7e |
| 6 | LinnDrum (+ LM-1) | PCM | the 80s pop sound; converter chain + chip slot | 2 | 3 | 3 | 5 | 7f |
| 7 | SP-1200 | PCM | hip-hop; drop-sample + SSM filters; needs sample editing | 3 | 3 | 3 | 4 | 7g |
| 8 | DMX / Drumtraks | PCM | cards / chips, tuning trimmers, per-event level / tune | 2-3 | 3 | 2 | 5 | 7g |
| 9 | TR-707 / 727 | PCM | popular, small, flam / shuffle model reuse | 2 | 3 | 3 | 4 | later |
| 10 | RX5 / RX7 / HR-16 / DDM | PCM | breadth only | 2 | 2-3 | 1-2 | 4-5 | later |
| 11 | DR-55 / Rhythm Ace / Rhythm King | analog | tiny; folds into the "rhythm box" engine | 2 | 1-2 | 1-2 | 1 | optional |
| 12 | MPC60 style pad sampler | PCM | stage 8 territory | 2 | 3 | 2 | 3 | with 8 |

A shared base to build once: a 'drums' Inst kind + voice-set registry; a "machine personality" sequencer (pattern memory, scale, accent, swing, flam, song, tap semantics);
trigger bus with accent *voltage*; pad / trigger input interface (stage 8); converter-chain module for PCM machines; per-voice meters; MIDI note map (808 / 909 style) so the existing roll
and arrangement can drive a drum track.

---------------------------------------------------------------------------------------------------------------------------------

## 5. Where the missing facts live (for the build lane)

- **TR-808 service notes (voice schematics for every voice, accent / trigger logic, CPU):** listed on manualslib: https://www.manualslib.com/manual/999557/Roland-Tr-808.html ,
  .../1019016/Roland-Tr-808.html , .../1217113/Roland-Tr-808.html , .../1294765/Roland-Tr-808.html (16-17 pages each); operation manual: .../695754/Roland-Tr-808.html (43 pages; table of contents:
  front / back panel, control description, trigger outputs, pedal, sync, memory back-up, playing patterns, variation, writing, pre-scale, A / B variation, 1st / 2nd part, rhythm track composing / editing,
  specifications). Also Eric Archer's 808 pages (certificate error from this machine) and Vintage Digital's scanned service notes.
- **TR-707 service notes** are on archive.org (text fetched): https://archive.org/stream/roland_Roland_TR707/Roland_TR707_djvu.txt (specs, hat / cymbal block descriptions, test mode). Its TR-606 sibling item
  https://archive.org/stream/roland_Roland_TR606/Roland_TR606_djvu.txt returned OCR junk in this run.
- **CR-78 service manual:** https://www.lost-manuals.com/en/manufacturer/roland/cr78 ; TR-77 manual for related coil values.
- **TR-909 / TR-606 owner's manuals:** Roland's manual archive https://www.roland.com/us/support/manual_archive/ (blocked here). The software manuals (808 / 909 / 606) were parsed for control names and the
  MIDI note map; they describe the software, not the hardware, so use them only for structure.
- **Korg Mini Pops 120 service manual (1976):** cited by Werner for the bridged-T / twin-T technique.
- **Simmons:** the museum blog https://blog.simmonsmuseum.com/?p=130 and the DIY manual above.

## 6. Open questions for the user

1. Order and scope: 808 first, then 606, 909? Or start with the machine that matters most to you (the pad story suggests the SDS-V soon)?
2. Hats / cymbals of the 909 and every sampled machine: original synthesised sounds clearly labelled as ours, plus "load your own"? (The only honest options.)
3. Authentic limits on or off by default: 808 taps one sound at a time and shares lane pairs (tom/conga, rim/claves, clap/maracas); CR-78 four voices; 606 has no tune / decay. Or modern conveniences (the TR-08 added swing, tune, decay, mute / solo)?
4. Individual outputs: master mix only for now, with per-voice outs arriving with milestone 3 cabling? Or one track per voice group?
5. Per-unit tolerance ("each 808 differs") and "aging" as an optional seed? Mods (accent range, longer BD decay, hat threshold) as an extras strip?
6. DIN-sync emulation between the 606 / 808 and the existing TB-303 (Roland 24 PPQN, fill-in line), in addition to the project transport?
7. A drum track's notes in the existing piano roll / arrangement (a GM-like map: 36 BD, 38 SD ... 49 CY, 51 CB) and recording from the step keys: both?
8. Panel size: the 808 / 909 are about 1000 x 600 px at 2 px/mm: fine on the iPad, or add a compact "Simple" layout like the classic synths?

## 7. Source index

Papers / primary: Werner, Abel, Smith, DAFx-14 bass drum https://dafx14.fau.de/papers/dafx14_kurt_james_werner_a_physically_informed,_ci.pdf ; ICMC 2014 cymbal https://speech.di.uoa.gr/ICMC-SMC-2014/images/VOL_2/1453.pdf ;
cowbell (AES 9207) https://aes2.org/publications/elibrary-page/?id=17530 ; dissertation https://purl.stanford.edu/jy057cz8322 ; talk "Boom Like an 808" https://www.musica.ed.ac.uk/?p=597 ; TR-707 service notes (archive.org, above).
Magazines / reviews: SOS Synth Secrets (Gordon Reid) bass drum / snare / cymbal https://www.soundonsound.com/techniques/practical-bass-drum-synthesis ; SOS TR-08 review https://www.soundonsound.com/node/4918226 ;
SOS TR-09 review https://www.soundonsound.com/reviews/roland-boutique-tr-09-tb-03 ; One Two Testing TR-909 https://www.muzines.co.uk/articles/roland-tr909/6511 ; EMM Drumtraks https://www.muzines.co.uk/articles/sequential-circuits-drumtraks/1581 ;
Music Tech HR-16 preview https://www.muzines.co.uk/articles/alesis-hr16-drum-machine-and-mmt8-midi-recorder/2078 ; Attack Hoshiai interview https://www.attackmagazine.com/features/interview/atsushi-hoshiai-the-man-behind-the-tr-909/ ;
Attack top ten https://www.attackmagazine.com/reviews/the-best/top-ten-classic-drum-machines/ ; Attack on Roger Linn's swing https://attackmagazine.com/?p=10694 .
Reference: Wikipedia pages Roland TR-808 / TR-909 / TR-606 / CR-78 / TR-707, Linn LM-1, LinnDrum, Oberheim DMX, E-mu Drumulator / SP-1200, Drumtraks, Yamaha RX-11, Simmons SDS-V, Drum machine, DIN sync (https://en.wikipedia.org/wiki/...) ;
Roland product pages https://www.roland.com/global/products/rc_tr-808/ , rc_tr-909/ , rc_tr-606 ; Rossum SP-1200 https://www.rossum-electro.com/pages/education-sp-1200 ; Roger Linn museum https://rogerlinndesign.com/about/about-museum ;
Roger Linn on swing https://brettworks.com/2013/07/23/roger-linn-on-drum-machine-groove-and-j-dillas-off-beat-sound/ .
Expert / community: Whittle http://www.firstpr.com.au/rwi/tr-808/ ; iO-808 tutorial https://io808.com/tutorial ; Wolfram https://blog.wolfram.com/2021/12/29/digital-vintage-sound-modeling-analog-drums-with-the-wolfram-language-and-system-modeler/ ;
scrapbox 808 notes https://scrapbox.io/0b5vr/TR-808 ; Cherry Audio https://docs.cherryaudio.com/misfit-audio/transistor-808-hats ; syntherjack SDS-V DIY pdf (above).
Aggregators [W]: polynominal.com (TR-606, TR-909, TR-707, DMX, CR-78, FR-1), vintagesynth.com (808, 909, 606, CR-78, Drumtraks, LinnDrum, KR-55, DDM-110, Drumulator), soundprogramming.net (RX5, RX7, 808), smemmusic.ch, sequencer.de.
Photographs viewed for layout [V]: Wikimedia Commons files for the TR-808, TR-909, TR-606, TR-707, Korg Rhythm 55, Linn LM-1, LinnDrum, Oberheim DMX, E-mu SP-1200, Sequential Drumtraks, Simmons SDS5 pads, Maestro Rhythm King MRK-1 (URLs above).

Local artefacts (scratchpad, not part of the project): scratchpad/drums/spike/cost.mjs and kick.mjs (cost micro-benchmarks), scratchpad/drums/tools/pdftxt.swift (PDFKit text extractor used on the papers),
scratchpad/drums/dl/kick/kick.txt and dl/cymbal/cymbal.txt (extracted text of the two Werner papers, for the build lane).
