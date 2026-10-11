# SERUM — Master Feature Inventory (consolidated, deduplicated)

Target: a functional recreation of Xfer Records' Serum. **Phase 1 = Serum 1 (final 1.3x build, 1.36b8, Oct 2023). Phase 2 = Serum 2 additions (2.0.16 Mar 2025 → 2.0.24 Nov 2025; manual v1.0.3 for 2.0.18).**

This file merges and supersedes `osc.md`, `mod.md` and `fx.md` (same folder). Those files are kept as detailed working notes; where they disagree with this file, **this file wins** (corrections are listed in §0.3). Everything here is paraphrased; nothing is copied at length from the manuals.

---

## 0. Reading this document

### 0.1 Confidence tags
- **[high]** official Xfer document (S1 manual, S2 User Guide, What's New, official changelog) or a value read back from the plugin's own parameter display / enum strings.
- **[med]** single reliable third-party measurement or reverse-engineering (preset-format work, rendered fixtures), or a strong inference from official material.
- **[low]** secondary source, unconfirmed inference, or conflicting evidence. Verify by ear/measurement before relying on it.
- **IMPL** = a suggested implementation where Xfer publishes no maths. It is **not** a claim about Serum's code.

### 0.2 Sources (keys used in tags)
| Key | Source |
|---|---|
| S1M | Serum manual v1.0.1 (Oct 2014, S. Duda). Local text `scratchpad/pdfs/serum1_manual_2014.txt`. Authoritative but early (pre-8 LFOs, pre-32-slot matrix, pre-later filters/distortions). |
| S2M | Serum 2 User Guide v1.0.3 (2.0.18, 27 Apr 2025). Local text `scratchpad/pdfs/serum2_manual.txt`. Restates most S1 material and documents all S2 features. |
| S2WN | "What's New in Serum 2" PDF (17 Mar 2025). Local `scratchpad/pdfs/serum2_whatsnew.txt`. |
| CL | Official changelog (S1 1.07b4 → 1.36b8; S2 2.0.16 → 2.0.24), gist 0xdevalias/a537a59d… Local `scratchpad/web/changelog_gist.md`. Builds 1.0–1.06 missing. |
| P1 | S1 VST parameter table (SYParameters, build 1.334), gist 0xdevalias/135a18e9…. |
| DT | `serum_display_tables.json` (btesser/serum2vital): S1 plugin display strings read back at all 229 knob steps + enum lists. |
| FMT | serum2vital `FORMATS.md` / `FINDINGS_AND_PLAN.md`: S1 preset-format reverse engineering and rendered measurements. |
| P2 | Serum 2 VST3 parameter dump of a freshly loaded instance (gist 0xdevalias/1b85af59…). |
| S2S | Serum 2 `.SerumPreset` schema/corpus work (Realynx/FL-Automation, user1303836/kumi, pycabbage corpus). Observed ranges, not true limits. |
| SEC | Secondary: SOS review (2015), Splice, CreativeLive, EDMProd, CFA-Sound, ModeAudio, futureproofmusicschool, KVR (DaveGamble = S2 dev), Xfer forum (steve_xfer). |

### 0.3 Critic log — what this pass added or corrected (vs. the three area files)
Corrections:
1. **S2 LFO trigger modes are officially FREE / RETRIG / ENVELOPE** (S2M p191); mod.md guessed "Trig/Env/Off". S2 renames ANCHOR to **HOST**, which now also acts in Hz mode. [high]
2. **S2 Voice Steal Priority has 5 options: Newest, Oldest, Highest, Lowest, Velocity** (S2M p217); mod.md omitted Oldest and attributed it to 2.1.0. [high]
3. **S2 filter category is "New"**, not "S2 Filters", and its exact Var labels are now known (Wsp MORPH, DJ Mixer none, Diffusor STAGES, MG/Acid/EMS Ladder SMOOTH, MG Dirty PAIN, PZ SVF SMOOTH, Comb 2 FRQ2, Exp MM MIX, Exp BPF none). "Acid Ladder" is officially a **diode ladder**. [high]
4. **Arp** play modes are Normal / Reverse / Pendulum / Random / Rand Start / Rand End / One Shot / Static and step modes Normal / New Only / Chord / Chord (new) (S2M p251); mod.md's lists were wrong. Full transpose-range shape list (18) added. MIDI Out = Off / Clip Player / On. [high]
5. **Serum 1 LFO Rise and Delay range = 0–4.0 s, linear** (DT read-back); mod.md had "about 0–4 s [low-med]". [high]
6. S2 matrix menu items have exact names, and "Apply and Delete Macros" semantics are official (bakes macro offsets into params, then deletes all macro routings). [high]
7. The 2.1.x claims in mod.md (K35 filter, "Velocity Legato", LFO direction names "via CL 2.1.0") **could not be verified**: the newest changelog available (gist updated May 2026) ends at 2.0.24. They are kept but downgraded to [low]. LFO direction Forward/Reverse/Ping Pong is official in S2M (2.0.18). [high for direction; low for K35 etc.]
8. **Env 1 has no Start/End level**; Start/End exist only on ENV 2–4 (P2: 3 "Env n Start/End" params). [high]
9. Filter Var functions for Ring Modx2 (SPREAD), SampHold/SampHold- (none; minus = difference of S&H and input), Dist.Comb (COMBFRQ; v1 positive-feedback comb, v2 negative), Scream (SCREAM = feedback-circuit cutoff; DRIVE >50 % brings the scream), Bandreject (WIDTH), EQ types (dB ±, extremes morph response; Res ignored on 6 dB versions) are now official (S2M pp135–139). [high]
10. S2 filter key track tracks **the pitch of the first oscillator with pitch tracking on (incl. portamento)**, else the MIDI note (S2M p141). [high]

Additions (not in any area file):
- Spectral-oscillator warp internal IDs harvested from preset corpus (§B8.6) [med].
- S1/S2 UI & workflow: preset browser, Hybridize, skins, zoom/resize, default preset, drag-export, MIDI CC maps, program change, prefs-file power options (CC rockers), S2 undo/redo, keyboard shortcuts (§A2, §B25) [high].
- S2 Preferences full list, Main Menu full list, MPE menu (XYZ→Macro, YZ→Macro, Y→Mod Wheel, Bend Range 1–96 default 48), MTS-ESP options (§B24) [high].
- Keyboard panel (Transpose ±24, Key/Scale, Swing, Osc Mapping KEY/VEL + FOLD + WARP flags) (§B21) [high].
- Full Clip module spec (§B23) [high].
- S1 matrix "bipolar" measured semantics; LFO point capacity; LFO Bus 1–16 automation params; S1 default LFO mode; extra graph blocks likely = Remap/X-Shaper curves (§A13–A16) [med/low].
- S2 generic FX automation slots (16 Main + 16 per Bus) (§B14.1) [med].
- S2 Main Vol default 50 % = −9.0 dB (different law from S1) (§B19) [high].

---

# PART A — SERUM 1 (Phase 1 target: 1.3x behaviour)

## A1. Architecture & signal flow
- Per voice: **OSC A**, **OSC B** (wavetable), **SUB**, **NOISE** (stereo sample player). [high]
- **One per-voice stereo FILTER**. Routing buttons **A / B / N / S** choose which sources feed it; Init = A only (`OscA>Fil`=1, others 0). Unrouted sources go straight to the voice sum (parallel dry path). No serial/parallel option. [high, S1M/P1/SOS]
- **ENV 1 is hard-wired to voice amplitude** (all osc/sub/noise levels pass through it); no per-osc amp envelope. [high]
- **Direct Out** switches on SUB (from 1.0) and NOISE (added 1.23b2) bypass the filter **and** FX. [high, CL/SEC]
- Voice sum → **FX rack (global, not per-voice; 10 fixed modules, user order)** → **Master Volume** → output. [high, S1M]
- Voices: up to 32 poly notes; one note can use up to 34 osc voices (16+16 unison + sub + noise). [high, S1M]
- Wavetables: 2048-sample frames, up to 256 frames. [high]

## A2. Global UI, presets and workflow (S1)
### A2.1 Header / top bar
- **Preset name** pop-up menu (folders = subfolders of `Presets/`; no sub-sub-folders scanned) + `<` `>` arrows stepping within the current subfolder. [high, S1M]
- **Save (disk icon)** left of the name. **Author** and **Notes/Description** text fields (double-click to edit; saved with preset). [high, S1M]
- **Preset browser** (button next to preset name; present by 1.08): columns incl. Name, Location, Category, Rating, Author and a selectable 4th column incl. **Comment** (1.10b5); click column to sort with **secondary sort** = previously clicked column (1.23b2); **Custom category** (user text, 1.23b2); ratings (backed up automatically, 1.34b4; preserved for missing presets); delete preset (no rescan, 1.33b1); **"Prune Duplicates and Missing Presets"**, **"Erase and Rebuild Database"**; arrow-key navigation. [high, CL]
- **Preset Hybridize** (1.23b2): randomly combines parts of several presets currently visible in the browser filter. [high, CL]
- **Default preset**: save as `Presets/User/default.fxp` → loaded on new instances (1.23b2); MPE-enabled state and tuning/oversampling locks persist via it (1.36b8). [high, CL]
- **Main Menu** ("Menu" button) items known for 1.3x: Init Preset; **init all LFOs** (1.29b7); Show Serum Presets Folder; Rescan Folders on Disk (also rescans formulas, 1.36b3); **Resample to OSC A / OSC B / A+B (Stereo)** (A+B 1.10b8); **Render OSC A Warp / Render OSC B Warp**; **Lock FX Rack**; **Load/Save Effect Chain**; MIDI CC map load/save (maps stored in `System/MIDIccMaps`); MPE settings (1.23b2); **Check for updates** (1.27b6); About. Exact ordering/wording not documented. [med]
- **Logo / Zoom menu** (top-left SERUM logo, 1.23b2): window zoom sizes (pixel dimensions shown, 1.35b7), set default size, **skin** select (factory: Default, **Promethium**), custom skins in `Skins/` folder with fallback to Default images and custom `.ttf` fonts; HiDPI/Retina. Window also resizable by dragging lower-right corner. [high, CL]
- **Drag-export** (1.29b7): waveform icon at very top-left; drag to DAW renders the **last played note (or chord, 1.35b7)** with its velocity/duration to `Serum Presets/Renders/` (WAV, filename includes preset name and MIDI note name; 24-bit in Logic). **Alt-click** opens Renders folder; **Shift-drag** drags the saved `.fxp` file. It is a re-play, so random/sync features may differ. [high, CL]
- **Tooltips** on hover; hovering a modulated knob lists its sources. [high, S1M]
- **On-screen keyboard** with pitch and mod wheels; click Y position = velocity (1.29b7). [high]
- **Program change** (MIDI program change selects presets; VST3 program list 1.36b3). [high, CL]
- Typed values accept comma as decimal separator (1.30b3). [high]
- **No global undo/redo in S1** (undo exists only inside the WT editor). [med]

### A2.2 Locks (S1)
- Parameter lock: right-click any control → Lock (1.08b1). [high]
- Module lock: right-click OSC A/B, Noise, Sub, Filter name/power → Lock module (1.09b5). [high]
- **Lock FX Rack** (1.08b6). Polyphony lock (right-click POLY, 1.10b7). Oversampling lock and Tuning lock (Global page). [high]

### A2.3 MIDI
- MIDI Learn per control (saved in preset); MIDI CC learn on module power buttons (1.09b5). [high]
- Power-user prefs: preset next/prev via CC or notes ("CCForRockers" in prefs file; documented for S2, likely present in late S1 `SerumPrefs.json`) [low for S1].

## A3. OSC A / OSC B (wavetable oscillators)
| Control | Range / units | Default | Behaviour | Conf |
|---|---|---|---|---|
| Power | on/off | A on, B off | Panel greys out; frees CPU; MIDI-learnable (1.09b5). | high |
| Wavetable menu `<` `>` | tables in `Tables/<subfolder>` | "Default" (built-in saw table) | Factory + user tables; arrows step within the folder. | high |
| Save (floppy) | — | hidden | Appears after edit/import (name shows `---`); saves Serum WAV. Edited/user tables are **embedded in presets** anyway (8 KB–4 MB). | high |
| Waveform display | click toggles 2D/3D | 2D | 2D shows current frame + live warp (not FM/AM/RM). 3D: real frames green, interpolated grey, current yellow. Unison detune "stalks" drawn (shape depends on unison Tuning mode). Yellow start-phase line while adjusting PHASE. | high |
| Magnifier | — | — | Opens WT Editor. | high |
| OCT | −4…+4 oct (int) | 0 | | high |
| SEM | −12…+12 st (int) | 0 | | high |
| FIN | −100…+100 cents | 0 | | high |
| CRS (Coarse Pitch) | −64…+64 st, continuous | 0 (shows `--`) | Unsnapped transpose for modulation; number box visible when modulated. | high |
| UNISON | 1…16 voices | 1 | Box colour changes with CPU load. Gain compensated. | high |
| DETUNE | display 0.00–1.00, **display = knob²** | knob 0.5 → **0.25** | Scaled by Global unison Range. Active when unison > 1. | high |
| BLEND | 0–100 | **75** | Level of non-central vs central voice(s) (1 central if odd, 2 if even). 75 = all equal. Active when unison > 2. | high |
| PHASE | 0–360° (100 % shows **"Mem"**) | **180°** | Start phase of the table read at note-on. | high |
| RAND | 0–100 % | **100 %** | Random phase offset per new voice and per unison voice. | high |
| WT POS | 1…N frames (param 1–256) | 1 | Selects audible frame. | high |
| WARP knob | 0–100 % | 0 | Depth of selected warp mode. | high |
| Warp menu `<` `>` | 23 modes (A5) | Off | Pencil icon for Remap modes. | high |
| PAN | −50…+50 | 0 | Pan law undocumented (IMPL: equal-power). | high / law low |
| LEVEL | 0–100 %, **amp = level²** (75 % = −5.0 dB, 50 % = −12.0 dB) | **75 %** | | high |

**Phase states** [high, S1M/CL]:
- PHASE < 100 %: start at PHASE + random offset up to RAND.
- PHASE = 100 % ("Mem"): phase memory — continue from the last note's phase; since 1.09b7 the unison voices' relative phases are locked and saved in the preset.
- PHASE = 100 % **and** RAND = 100 % → **MemTrig** (1.23b2): each note-on restarts unison voices from one stored set of relative phases (no laser zap, repeatable). Temporarily lowering RAND while a note plays captures a new random set (saved in preset). Mono: MemTrig does not fire while the previous note still sounds (1.35b7).
- Voice steal / legato: phase is **not** reset on a note-on that steals a voice with Legato off (avoids clicks); with Legato on in poly it **is** reset. [high, S2M describing S1 behaviour]

**Pitch** [high]: total = OCT·12 + SEM + FIN/100 + CRS + pitch bend + Master Tune (separate params on purpose). **Pitch Tracking** per osc (Global page, default on); when off, every note plays the same low pitch (S2 states C−2/MIDI 0 ≈ 8.18 Hz; assume same in S1 [med]).

**Frame interpolation** [high]: without a Morph, WT POS steps discretely between real frames. Morph (WT editor) fills all 256 slots; only the morph type is stored, frames regenerated at load. Modulating WT POS got much cheaper in 1.23b2. Click-free switching behaviour undocumented [low].

**Anti-aliasing** [high concept / low internals]: official claim of no audible aliasing to the limit of hearing; costs CPU at load and run time. IMPL: per-frame band-limited mip-maps (½-octave or finer) + high-quality interpolation + crossfade between zones.

**Oversampling** (Global): **1x / 2x (default) / 4x**, affects **warp modes only** (plain oscillator always max quality); lock (1.10b7); default settable in config (1.23b2). [high]

## A4. Unison (S1)
Panel controls: voices, DETUNE, BLEND (A3). Advanced settings **per oscillator on the GLOBAL page**: [high, S1M]

| Setting | Range | Default | Behaviour | Conf |
|---|---|---|---|---|
| Range | 0–48 st | **2** | Max detune at DETUNE 1.00. Best evidence: total spread between outer voices = Range (±Range/2). | default high; ±Range/2 med |
| Width (`Uni LR`) | 0–100 | **100** | 0 = all centre; 100 = outer voices hard L/R. | high |
| Warp (`Uni Warp`) | −100…+100 | 0 | Per-voice ± offset around the WARP knob (only audible with a warp mode). | high |
| WT Pos (`Uni WTPos`) | −100…+100 | 0 | Per-voice ± frame offset (several frames sound at once). Scaling undocumented (serum2vital maps 100 → ±half table). | range high / scale low |
| Stack | `off`, `12 (1x)`, `12 (2x)`, `12 (3x)`, `12+7(1x)`, `12+7(2x)`, `12+7(3x)`, `Center-12`, `Center-24` | off | 12(1x): 0,+12,0,+12…; 12(2x): 0,+12,0,+24…; 3x up to 3 oct; +7 adds fifths; Center-12/-24 drop centre voice(s) 1/2 oct. | list high; 3x/+7 patterns med |
| Tuning (detune mode) | `Linear`, `Super`, `Exp.`, `Inv.`, `Random` | Linear | Linear: equal spacing. Super: slight bias to in-tune. Exp: stronger bias to in-tune. Inv: pushed to the edges (two pitch centres). Random: new random offsets every note-on. | high |

- **Detune IMPL [low]**: slot t_i = 2i/(N−1) − 1; offset = (R/2)·d·shape(t_i); Linear t; Exp ≈ sign(t)|t|^2.5; Inv ≈ sign(t)|t|^0.5; Super between; Random per note.
- **Gain compensation** [med, measured on init saw rel. to 1 voice]: 2v −1.9 dB, 3v −3.6, 4v −0.6, 5v −1.5, 6v +0.2, 7v −0.3, 8v +0.9, 10v +1.25, 12v +1.5, 16v +1.4.
- **Blend IMPL [low-med]**: 0 = centre only; 75 = equal; >75 attenuates centre.
- Per-voice random phase from RAND; RAND 0 + PHASE 0 + detune = "laser zap". [high]

## A5. WARP modes (Serum 1, 1.3x; exact menu, stored as index/23) [list high, DT]
On OSC B, entries 18–20 read "(from A)". Slot 23 is empty.

| # | Name | Official behaviour (paraphrase) | IMPL notes | Conf |
|---|---|---|---|---|
| 0 | Off | — | — | high |
| 1 | Sync | Self-sync: internal oscillator restarts at the true period; knob raises internal pitch (formant-like sweep). | `p'=frac(p·r)`, r = 1+k·amount; max ratio unknown (≈1.3× Vital's 16× sweep). | desc high / math low |
| 2 | Sync 1/2 Win. | Windowed sync, half window (edge fades) | multiply by partial taper window | med |
| 3 | Sync Window | Windowed sync, full window (softer) | Hann-type window | med |
| 4 | Bend + | Pinch wave toward cycle centre (each half) | phase warp symmetric about 0.5 | desc high / math low |
| 5 | Bend − | Pull wave toward edges | inverse of Bend+ | high |
| 6 | Bend +/- | Bipolar; 50 % = no change | | high |
| 7 | PWM | Push whole wave left (classic PWM on squares) | `p'=p/(1−w)` for p<1−w; fill of remainder (zero vs hold) **unknown** | desc high / fill low |
| 8 | Asym + | Bend the whole cycle to the right | monotone phase curve e.g. `p^(1/(1+a·k))` | desc high / math low |
| 9 | Asym − | Whole cycle to the left | mirror | high |
| 10 | Asym +/- | Bipolar, neutral at 50 % | | high |
| 11 | Flip | Instant polarity flip at a point set by the knob | `y = p<w ? x : −x` | med |
| 12 | Mirror | 2nd half = mirror of wave (octave-ish); knob acts like Asym± on each half; never bypasses | `q = p<.5 ? 2p : 2−2p` + per-half asym | med |
| 13 | Remap 1 | User graph remaps phase; knob 0 = y=x … 100 = graph | `p'=lerp(p,G(p),a)` | high |
| 14 | Remap 2 | Mirrored remap: graph applied to each half | | desc high / math low |
| 15 | Remap 3 | "Sinusoidal" remap (no drawing needed) | **unknown**, e.g. G((1−cos πp)/2) | low |
| 16 | Remap 4 | Like Remap 2 but graph applied 4× | | desc high / math low |
| 17 | Quantize | Sample-and-hold of the wave read itself (aliasing follows pitch) | `p'=floor(p·M)/M`, M from 2048 down | desc high / curve low |
| 18 | FM (from B) / FM (from A) | FM by the other osc (must be enabled; level may be 0). Only one direction at a time (selecting in the 2nd osc disables the 1st). | Behaves like **phase modulation** (S2 later adds true FM). Serum amount a ≈ Vital FM a^0.8. | high / PM med |
| 19 | AM (from B/A) | Amplitude mod by other osc | `x·(1−a+a·(0.5+0.5m))` | desc high / math low |
| 20 | RM (from B/A) | Ring mod by other osc | `lerp(x, x·m, a)` | med |
| 21 | FM (Noise) | FM from noise osc (enabled, level may be 0) | | high |
| 22 | FM (Sub) | FM from sub osc | index rises faster than Vital | high |

- Warps are oversampled per Global Oversampling. 2D display shows warp shape except FM/AM/RM. [high]
- **Render OSC Warp** (main menu): current frame → 256 frames spanning WARP 0→100 % (bakes the warp). [high]

## A6. Remap graph editor
- Opened by the pencil/magnifier icon when a Remap mode is active; diagonal = identity. [high]
- Same spline editor as LFO / X-Shaper (points, curve handles, grid). Load/save from `LFO Shapes` folder (`.shp`, LFOTool format; 64 points max in `.shp` files). [high]
- One graph per oscillator shared by Remap 1–4 [med]. S1 presets contain 4 extra 480-point graph blocks after the 8 LFOs — most likely Remap A/B and X-Shaper A/B curves [low].

## A7. SUB oscillator (S1)
| Control | Range | Default | Notes | Conf |
|---|---|---|---|---|
| Power | on/off | off | MIDI-learnable | high |
| Shape | **Sine, RoundRect, Saw, Square, Pulse** (5, index/4) | Sine | Plugin enum read-back. Tutorials mention Triangle; S2 has 6 with Triangle. Implement S1 = 5 in this order for preset compatibility. | med (conflict) |
| OCTAVE | −4…+4 | 0 | | high |
| DIRECT OUT | on/off | off | Bypass filter and FX. If off and **S** routed, sub is filtered then FX. | high |
| PAN | −50…+50 | 0 | | high |
| LEVEL | 0–100 % | **75 %** | Measured **linear in amplitude** in S1 renders (S2 display shows squared law). | default high / law conflict |
- No coarse, no phase knob in S1; phase locked at note-on (starts at zero, falling = WT osc at 180°) [med]. Band-limiting undocumented (IMPL: band-limit). Sub is a warp source (FM (Sub)). [high]

## A8. NOISE oscillator (S1)
High-quality **stereo sample player** (SSE2 interpolation, precalc at load; mono files cheaper). [high]

| Control | Range | Default | Notes | Conf |
|---|---|---|---|---|
| Power | on/off | off | | high |
| Noise menu `<` `>` | `Noises/<subfolder>` (sub-subfolders scanned from 1.24) | default noise | Factory noises **not embedded** (missing-file dialog); drag-and-drop user noises (1.10b5) **are embedded** (blue tint); pref to embed all non-factory noises. SerumFX: **Audio In** option. Single-cycle renders via LFO drag (1.30b4) or WT editor "Send to Noise Oscillator". | high |
| One-shot / Loop | toggle | Loop | One-shot stops at end; sample loop points respected. | high |
| Keytrack (piano icon) | on/off | off | On: pitch follows note, PITCH knob snaps to semitones; samples with known rate load in tune. | high |
| PHASE | 0–100 % | 0 | Sample start ("scratch" when modulated). | high |
| RAND | 0–100 % | 0 | Random start per note. | high |
| PITCH | 0–100 % | **50 %** (= original, keytrack off) | Measured: above centre linear to +48 st at 100 %; below centre falls steeply (≈ −35 st at 40 %, −100 st at 25 %). | default high / law med |
| PAN | −50…+50 | 0 | | high |
| LEVEL | 0–100 %, amp = level² | **25 %** | | high |
| DIRECT OUT | on/off | off | Added 1.23b2. | high |
| Noise Fine (Global page) | cents (param −1…+1, ≈ ±1 st) | 0 | Fine-tunes keytracked noise. | med |
- Factory content: noise colours + atmospheres/FX (≈200+ files per Splice); exact folder list not found [low]. Noise output is a matrix source and FM (Noise) warp source. [high]

## A9. Wavetable engine & file format
- Frame = 2048 float samples; ≤ 256 frames (≤ 2 MB). Non-2048 cycles are resampled. [high]
- WAV: mono, typically 32-bit float 44.1 kHz with a **`clm ` RIFF chunk**: `<!>2048 01000000 wavetable (www.xferrecords.com)` — cycle size, flag string, ID. Flag digit 1 = morph type (0 none, 1 crossfade, 2/3/4 spectral variants [2/3/4 mapping med/low]); digit 2 = factory flag (not embedded) [med]. [chunk high]
- Interpolated (morph) frames not stored — only the type flag. [high]
- Built-in basic shapes live inside the plugin. [med]
- **Text override**: `X.txt` or `FolderInfo.txt` next to `X.wav`: line 1 `[samples-per-cycle]` (32–9999), optional line 2 `[interp]` (default) / `[no interp]`. [high]
- Presets: user tables embedded; factory tables referenced by name. Config option disables embedding. [high]

## A10. WAVETABLE EDITOR (S1 1.3x)
### A10.1 Layout [high]
- Large waveform display with **grid size** box (lower right; grid drives draw-tool snapping and "(grid size)" processes; 0 = free draw).
- **FFT area** above: top row magnitudes, bottom row phases. **Wave→FFT** curved-arrow button (realtime FFT since 1.30b3; button is then an on/off switch).
- **Thumbnails** along the bottom (labels 1, 17, 33… after morph).
- Frame controls: `[−]` `[+]` remove/insert, frame number box, `<` `>` navigation.
- **Formula field** with "(enter formula)" placeholder and Formula presets menu.
- Menus: **Single, Process, Morph, Add/Remove, Sort, Import, Export**.
- Zoom settings persist (1.23b9); FFT bin zoom. Mod wheel can scan frames 1–256 while open (pref).

### A10.2 Thumbnails [high]
Click = select/edit frame; click-drag = reorder (yellow insertion cursor); Shift-click = range select (blue); drop an audio file on a thumbnail = replace that frame with a single cycle.

### A10.3 Draw tools (relative to grid) [high]
Flat Line (default; plain draw at grid 0) · Slope Up · Slope Down · Sine (adds the harmonic = grid size) · Half sine (valley) · Half sine (peak) · Curve up (¼ sine) · Curve down (¼ sine) · Interpolate linear (join segment endpoints; LPF-like) · Interpolate curved (smoother) · Nudge (move region up/down; clips if dragged far) · Noise (drag up adds, down removes).

### A10.4 FFT area [high unless noted]
- Bin 1 = fundamental, 2 = octave, 3 = +19 st, 4 = +24 st… Editor/formula domain = **512 bins** (q = 1…512).
- Magnitude display ≈ √(amplitude) relative to fundamental (saw shows as (1/q)^0.5) [med, inferred from formula examples].
- Shift-drag = fine.
- **Right-click menu** (separate for magnitude and phase rows): Clear All · Clear HF (bin X to end) · Clear LF (start to bin X) · Generate Saw · Randomize Low X bins · Randomize Low X bins (with half) · Randomize All · Create random series gaps · Progressive Fade · Shift Octave Up · Shift Octave Down · Draw Odd Harmonics Only · Draw Even Harmonics Only · **Snap vertical draw to quarters** (1.23b2) · **Scale Freq Values by Bin Index** (1.23b2; a flat 50 % line then draws a saw).

### A10.5 SINGLE menu (current frame) [high]
Normalize · Remove DC Offset · Flip Vertical · Flip Horizontal · Shift Horizontal to Zero Crossing · Init (silence) · Fade Edges (grid size) · X-fade Edges (grid size) · Filter (grid size) (FFT brick-wall LPF, removes DC) · Sample Redux at grid size (grid used as amount) · **Send to Noise Oscillator** (1.30b4).

### A10.6 PROCESS menu (all frames) [high unless noted]
Normalize Each · Normalize Same · Remove DC Offset · Flip Vertical · Flip Horizontal · Fade Edges (grid) · X-fade Edges (grid) · X-fade Edges (16 samples) [med for S1] · Filter (grid) · Remove Fundamental (HPF) · Sample Redux at grid size · Resize Tables to be Half · Resize Tables to be Double · Create PWM from this table to all (256-frame PWM sweep) · Nudge all phases for fundamental to 50 %.
1.23b2: Set Spectra same for all frames (from current) · Set Phases same for all frames (from current) · Subtract Spectra from other Osc.
1.30b2: Spectral blur — Bins: Blur Spectra/Phases (adjacent bins, grid) · Frames: Blur Spectra/Phases (adjacent frames; X-grid = depth).
Listed in S2M (presence in late S1 unverified [low]): Remove Low Spectra (grid) · Remove Low Phases (grid) · Set Spectra from Other Osc · Set Phases from Other Osc · Shift Horizontal to Zero-Crossing (all).

### A10.7 MORPH menu [high]
Needs >1 and <256 real frames; fills all 256 slots.
- Morph – Crossfade (linear time-domain; recommended)
- Morph – Spectral (interpolates magnitude and phase)
- Morph – Spectral (zero fundamental phase) — destructive to sources
- Morph – Spectral (zero all phases) — smoothest, destructive
- Remove Morph Tables
IMPL: real frames spread evenly over 0…255; crossfade `(1−t)A+tB`; spectral = per-bin magnitude interp + shortest-arc phase interp → IFFT. [med]

### A10.8 ADD/REMOVE menu [high]
Init All (single saw frame) · Insert at current index · Remove current index · Remove: multiselection · Remove: beginning→selected · Remove: selected→end · Remove: All (except selected) · **Reduce** submenu (keep every Nth frame, 1.23b2).

### A10.9 SORT menu [high]
Peak Spect · Average Spect · Peak Amount · Num w/ Spect · Highest w/ Spect · Fundamental amt. (recommended first try) · **Sort Random** (1.30b6) · Reverse entire table order.

### A10.10 IMPORT (menu and drag-drop zones) [high]
- import: normal (dynamic pitch zero-snap) — pitch map + cut at nearby zero crossings (simple sounds with vibrato).
- import: normal (dynamic pitch follow) — variable segments, no zero-snap (complex sounds).
- Import: constant frame size (pitch avg) — "if in doubt, try this first"; detected size written to formula field and reused until cleared.
- Advanced: constant frame size (manual entry) — type 1–4-digit sample count or note name (`B0`, `C#2`; assumes 44.1 kHz) in formula field; reply "split at: N samples (Hz, note ± cents)"; `0` clears.
- FFT 256 / 512 / 1024 / 2048 — spectral "blurred average" import (drum loops, speech).
- Mono, single-pitch sources work best. Multiple files dropped at once = table of single cycles. Stereo file to OSC B imports the **right** channel (1.10b8).
- **PNG import** (1.10b1): luminance → amplitude (black 0, white max), stretched to 2048×256. Orientation differs between S1 changelog and S2M (S2M: image width = frames, max 256) [med].
- Alt-drag an LFO tile onto the waveform = render LFO shape to the table (official 1.23b2). [high]

### A10.11 EXPORT [high]
Export All as Wav (32-bit float, 44.1 kHz, 2048/frame, `clm ` header; = floppy) · Export All 16-bit · Export Selection · Export All 8-bit (`.256`, Wiard/Piston Honda) · Export All as Single-Cycle Waves (1.23b2).

### A10.12 Formula parser [high unless noted]
- Variables: **x** −1…1 across frame · **w** 0…1 · **y** table index 0…1 · **z** table index −1…1 · **q** bin 1…512 (result written to FFT magnitudes) · **in** current frame value · **sel** value of frame selected at start · **rand** −1…1 per time position, same in every frame · **rrnd** reseeded per frame (1.35b7) · **pi**, **e**.
- Scope: formula containing y or z regenerates **all 256 frames**; otherwise only current frame.
- 1-arg functions: sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh log2 log10 log (base 10) ln exp sqrt sign rint abs. Variadic: min max sum avg.
- Operators & priority: `&&` 1, `||` 2, `<= >= != == > <` 4, `+ −` 5, `* /` 6, `^` 7; examples also use `%` and ternary `?:`. muParser-style [low].
- Examples: `q<17`; `q<z*256`; `(1/q)^0.5` saw (^0.25 brighter, ^0.75 duller); `(1/q)^z`; `((q%2)==1)?in:0`; `z=(q>1)?in:0` (assignment-like prefix, grammar unclear [low]).
- Presets menu: Singles, Multis, User Singles, User Multis; files in `System/` (`FormulaFactorySingles.txt` etc., one `[formula][name]` per line). NaN handled.
- The field doubles as import split-size entry.

### A10.13 Other [high/med]
Drawing updates the sound live. Editor-local undo [med]. "Wavetable to LFO Shape" in LFO load menu (1.31b3).

## A11. FILTER (per-voice, S1)
### A11.1 Module & controls
- Enable switch top-left (**off in Init**); routing **A B N S** lower-left (Init A only); **key-track** piano icon lower-left (off). Click the graph: phase-response view (1.0), "preliminary spectrum view" (1.27b6). Module lock (1.09b5), MIDI-learnable power (1.09b5). Ring Mod and S&H types show a custom display instead of a frequency plot (1.23b2). [high]

| Control | VST param | Range / law | Default | Behaviour | Conf |
|---|---|---|---|---|---|
| Type menu `<` `>` | `Fil Type` | 96 entries (index/95; older builds /89, /88) | **MG Low 12** | Pop-up with Normal / Multi / Flanges / Misc groups; arrows step; mouse wheel steps [S2 documented]. | high |
| CUTOFF | `Fil Cutoff` | **8.18 Hz–22.05 kHz exponential**: f = 8.176·(22050/8.176)^n (MIDI 0 → ≈136.8) | 0.5 ≈ **425 Hz** | Typed Hz accepted. Formants: vowel position. Comb/flange/phaser: comb/notch frequency. | high |
| RES | `Fil Reso` | 0–100 % | **10 %** | Feedback; for comb/flange types = feedback amount. | high |
| PAN ("Stereo" in S1M) | `Fil Stereo` | 0–100 %, 50 = neutral | 50 % | L/R cutoff offset: left of centre raises L / lowers R; right does the opposite. | high |
| DRIVE | `Fil Driv` | 0–100 % | 0 | Gain into the filter circuit, mild colouration (measured ≈ +7.6 dB at 25 %, +16 dB at 100 %). | high / gain med |
| VAR (label per type) | `Fil Var` | 0–100 % | 0 | See A11.2. | high |
| MIX | `Fil Mix` | 0–100 % | **100 %** | Wet/dry; Flanges types best at 50 %; no effect on Combs-type per S2M. | high |
| Key track | switch block | on/off | off | 1 oct MIDI = 1 oct cutoff for most types; reference note undocumented (assume C3/MIDI 60) [low]. | high / ref low |

### A11.2 Complete filter type list (S1 1.3x menu order; names from plugin enum DT) and Var function
Var functions: [high, S1M p69 + S2M pp135–139] unless tagged.

| # | Name(s) | Group | Description | Var |
|---|---|---|---|---|
| 0–3 | MG Low 6 / 12 / 18 / 24 | Normal | Moog-style ladder LP; number = dB/oct | **FAT**: saturation in the resonance path (tames resonance, adds harmonics) |
| 4–7 | Low 6 / 12 / 18 / 24 | Normal | State-variable LP | FAT |
| 8–11 | High 6 / 12 / 18 / 24 | Normal | SVF HP | FAT |
| 12–13 | Band 12 / 24 | Normal | SVF BP | FAT |
| 14–15 | Peak 12 / 24 | Normal | SVF peak | FAT |
| 16–17 | Notch 12 / 24 | Normal | SVF notch | FAT |
| 18–19 | LH 6, LH 12 | Multi | Dual SVF (1st letter primary, 2nd secondary; resonance linked) | **FREQ**: cutoff of 2nd filter |
| 20–30 | LB 12, LP 12, LN 12, HB 12, HP 12, HN 12, BP 12, BN 12, PP 12, PN 12, NN 12 | Multi | Dual SVF (L low, H high, B band, P peak, N notch) | FREQ (2nd filter) |
| 31–38 | L/B/H 12/24, L/P/H 12/24, L/N/H 12/24, B/P/N 12/24 | Multi | Morphing SVF across three responses | **MORPH** (serum2vital: blend = 2·Var per half [med]) |
| 39–40 | Cmb + / Cmb − | Flanges | Comb, +/− = feedback polarity [med] | undocumented [low] |
| 41–42 | Cmb L6+ / L6− | Flanges | Comb with 6 dB LP in feedback | **LP FREQ** |
| 43–44 | Cmb H6+ / H6− | Flanges | Comb with HP in feedback | **HP FREQ** |
| 45–46 | Cmb HL6+ / HL6− | Flanges | Comb with HP+LP in feedback | **HL WID** (band width around cutoff) |
| 47–48 | Flg + / Flg − | Flanges | Flanger (same circuit as comb, different feedback attenuation [high, steve_xfer]) | undocumented [low] |
| 49–54 | Flg L6±, Flg H6±, Flg HL6± | Flanges | as Cmb variants | LP FREQ / HP FREQ / HL WID |
| 55–62 | Phs 12±, 24±, 36±, 48± | Flanges | Allpass phaser, number = order [med] | undocumented [low] |
| 63–68 | Phs 48L6±, Phs 48H6±, Phs 48HL6± | Flanges | Phaser with feedback filter | LP FREQ / HP FREQ / HL WID |
| 69–70 | FPhs 12HL6± | Flanges | Flanger/phaser hybrid [low] | HL WID by analogy [low] |
| 71–72 | Low EQ 6 / Low EQ 12 | Misc | Morphable low-shelf EQ | **DB ±**: pass-band gain; extremes morph the response (e.g. Low EQ 12 goes from HP at 0 dB to low shelf). Res has no effect on 6 dB versions. |
| 73 | Band EQ 12 | Misc | Peaking EQ | DB ± |
| 74–75 | High EQ 6 / 12 | Misc | High-shelf EQ | DB ± |
| 76 | Ring Mod | Misc | Ring modulation at the cutoff frequency | none |
| 77 | Ring Modx2 | Misc | Two ring modulators | **SPREAD**: distance between the two RM frequencies |
| 78 | SampHold | Misc | Sample-and-hold distortion (rate from cutoff) | none |
| 79 | SampHold- | Misc | Outputs the **difference** between S&H output and input | none |
| 80 | Combs | Misc | Bank of musically tuned combs (adds stereo width; Pan exaggerates) | **DAMP** |
| 81 | Allpasses | Misc | Allpass diffusion | DAMP |
| 82 | Reverb | Misc | Delay/allpass network reverb | DAMP |
| 83 | French LP | Misc | Distorting, non-linear LP | **BOEUF**: secondary resonance |
| 84 | German LP | Misc | Clean zero-delay-feedback LP | none |
| 85 | Add Bass | Misc | Phase-rotated LP with a little drive | **THRU**: adds phase-rotated dry |
| 86–88 | Formant-I / II / III | Misc | Vowel filters; CUTOFF morphs between formants | **FORMNT**: formant shift |
| 89 | Bandreject | Misc | Wide notch | **WIDTH** |
| 90–93 | Dist.Comb 1 LP / 1 BP / 2 LP / 2 BP | Misc (1.23b2) | Comb inside the feedback path of an LP/BP; v1 = positive-feedback comb, v2 = negative | **COMBFRQ**: comb frequency |
| 94–95 | Scream LP / Scream BP | Misc (1.23b2) | High-feedback "screaming" filter | **SCREAM**: cutoff of the feedback circuit; raise DRIVE above 50 % to hear the scream |

- The FX-rack Filter uses the same list (A20.4.10). S1 count history: ~90 (SOS 1.01) → 96 (1.23b2+). [high]
- DSP is undocumented; IMPL suggestions: TPT/ZDF SVFs; ladder with tanh stages for MG; FAT = tanh in resonance feedback. [low]

## A12. ENVELOPES (ENV 1–3)
- ENV 1 = amp of every voice (always active, also routable). ENV 2/3 inactive until assigned. Selected env drawn blue; others grey behind if in use. Tabs/tiles "Env 1/2/3" select and are drag sources. [high]
- Stages **A H D S R**; knobs under the graph or drag graph points; **curve handles** on attack, decay, release (drag; right-click resets). [high]

| Param | Range / law | Default | Conf |
|---|---|---|---|
| Attack | 0–32 s, t = 32·n⁵ (n 0.25 → 31 ms; 0.5 → 1.00 s; 0.75 → 7.59 s) | n 0.11 ≈ **0.5 ms** | high |
| Hold | 0–32 s, same law | 0 | high |
| Decay | 0–32 s | n 0.5 = **1.00 s** | high |
| Sustain ENV 1 | dB, −∞…0 (amp = n²) | **0 dB** | high |
| Sustain ENV 2/3 | 0–100 % linear | **100 %** | high |
| Release | 0–32 s | n 0.215 ≈ **15 ms** | high |
| A / D / R curve | 0–100 (50 = linear [med]) | **A 50, D 67, R 67** (P1) | high (S2 VST3 shows 40/60/60 — display-convention conflict [low]) |

- View: **Lock** (auto-fit zoom) vs unlocked with manual zoom strip; lock persists (1.30b6). [high]
- Typed values: ms, or a beat division like `1/8` (converted at current tempo, not re-synced) [med].
- Legato (Mono+Legato) = no retrigger on overlapping notes. Poly Legato (Legato on, Mono off; 1.08) = per-note legato/paraphonic behaviour. [high/med]
- **No velocity→amp by default**; matrix menu **"Velo->Amp"** convenience (1.34b9). [high]
- ENV A/H/D/S/R are matrix destinations; curves are not automatable params. [med]

## A13. LFOs (LFO 1–8)
- 4 at launch; **8 since 1.10b5** (LFO 5 appears once LFO 4 is used, etc.). LFOTool-style drawable graph per LFO; tiles above graph select and are drag sources. [high]
- **Init shape**: triangle (low → high → low; last point tied to first) [med, FMT]. **Default mode (S1)**: probably OFF with BPM + Anchor on [low-med; inferred from the preset reader's defaults for LFO 5–8 in old presets — verify against Init].

**Graph gestures** [high, S1M]: double-click add/remove point · Shift-click/drag draws steps at grid size · Alt-drag point snaps to grid · Alt-drag a curve handle moves all handles · drag on background = marquee multi-select · Cmd/Ctrl-drag = "rainbow" relative multi-move · right-click (Ctrl-click macOS) menu: segment shape for shift-draw, delete selected points, set start/loopback point, flip/invert, **Modulate X / Modulate Y** (point modulation 1.29b7), remove point modulations · Shift-Cmd/Ctrl-click a point = set loopback (Env mode). Clicking overlapping right-edge points selects the left one (1.33b4). LFO curve extremes fixed 1.30b. [high/med]

**Point modulation** (1.29b7) [high]: each modulated point axis links to an **LFO Bus** (automatable params "LFO Bus 1–16"); a matrix slot routes source → bus; several points can share a bus; the menu lists in-use buses + one empty one. Drag a source onto a point → X/Y buttons. Removing point mods deletes unused bus routings.

**Grid** [high]: number box, **global to all LFOs** in S1; type `X,Y` (e.g. `8,12`) for separate horizontal/vertical grids (1.23b2). Range undocumented [low].

**Point capacity**: ≈64–65 points (old layout); current preset layout stores up to **480 points** per LFO [med, FMT].

**Load/Save (folder icon)** [high]: factory shapes (`LFO Shapes`, `.shp`), "Save LFO Shape…", **"Wavetable to LFO Shape"** (1.31b3). Alt-drag LFO tile → wavetable display renders LFO into the table; drag LFO to noise osc renders single cycle (1.30b4); Alt-drag tile onto another tile copies all settings.

| Control | Options / range | Default | Behaviour | Conf |
|---|---|---|---|---|
| Mode | **Trig / Env / Off** | Off [low-med] | Trig: restart per note. Env: one pass then stop; loopback point (orange marker) loops marker→end while held. Off: free-running, ignores notes (song-time locked with BPM+Anchor). | high |
| BPM | on/off | on | Tempo sync | high |
| Dot / Trip | on/off | off | Add dotted/triplet values to the rate ladder (BPM only) | high |
| Anchor | on/off | on [med] | BPM only: phase locked to song position (may jump on rate change) vs no jump/may drift | high |
| Rate (Hz) | **0–100 Hz, f = 100·n⁴** (0.5 → 6.25 Hz) | — | not audio rate | high |
| Rate (BPM) | 229-step knob: **32 bar, 16, 8, 4, 2 bar, bar, 1/2, 1/4, 1/8, 1/16, 1/32, 1/64, 1/128, 1/256, fast** (~16 steps each) | 0.5 → **1/4** | | high |
| Rise | **0–4.0 s linear** | 0 | Fade-in from first point's value to full shape; BPM-mode labels (1.33b7) | high |
| Delay | **0–4.0 s linear** | 0 | Hold at first point's value before rise | high |
| Smooth | 0–100 | 0 | Output slew | high |
- Rise/Delay/Smooth automatable for all 8 LFOs (1.29b7). LFO Rate params for 1–8 automatable. [high]

## A14. Performance sources & Chaos (S1)
- **VELO** and **NOTE** tiles (right of LFO tiles) with **editable remap curves** (LFO-style graph). Right-click option: follow portamento/legato ("Legato (Portamento Time)" in S2 wording; existed in S1 1.08). Default curve = straight diagonal. [high/med]
- **Mod Wheel** (draggable, also automatable param), **Pitch Bend**, **Aftertouch**, **Poly AT** (matrix sources). Pitch bend range: **Bend Up −24…+24, default +2; Bend Down −24…+24, default −2**. [high]
- **Chaos 1 | Chaos 2** (Global page; matrix-only sources) [high, S1M/DT]: Chaos 1 more periodic/bipolar, Chaos 2 chaotic "restarting". **Rate 0–1000 Hz, f = 1000·n⁵, default ≈1.0 Hz (n 0.2512)**; **BPM** sync switch (snaps to musical divisions); **Mono** (one shared generator vs per voice); **S&H** switch (stepped output; existed by 1.09b5).

## A15. MACROS (S1)
- **Macro 1–4**, 0–100 %, default 0; renameable labels; drag tiles to assign; automatable/MIDI-learnable. **Not** modulation destinations in S1. Drag-and-drop macro assign. [high]

## A16. MODULATION ROUTING (S1)
### A16.1 Drag-and-drop & halo [high, S1M]
- Drag a source tile onto a knob ("+" cursor = valid). Tile shows destination count; hovering lists them; hovering a knob lists its sources.
- Blue arc = selected source's depth; negative depth = different hue; grey arc = other assigned sources.
- Depth: drag the small arrow/arc top-left of knob, **Alt-drag the knob**, or matrix. Type "12ST"-style values for pitch depth [med].
- Default polarity on drop: **centred controls → bipolar; others → unipolar**. **Shift+Alt-click** knob toggles uni/bi.
- **Measured bipolar semantics**: bipolar row modulates ±amount·range/2 around the knob value (e.g. LFO→Semi at +100 % bipolar = ±12 st) [med, FMT].

### A16.2 Knob right-click menu [high]
Bypass Modulator: <src> · Remove Modulator · Remove All Modulators · Reset Control (= Cmd/Ctrl-click; double-click optional pref) · **Mod Source ▸** (all sources incl. matrix-only) · MIDI Learn / re-learn / remove · Lock (1.08b1).

### A16.3 Mod Matrix (MATRIX tab)
- **32 slots** in 1.1x+ (16 in 1.0), scrolling list. [high]

| Column | Range / options | Default | Notes |
|---|---|---|---|
| SOURCE | menu (A16.4) | — | drag sources onto menus (1.30b3); **Alt-click** a source menu re-assigns every row with the same source (1.10b1) |
| AMOUNT | bipolar slider −100…+100 | 0 | Cmd/Ctrl-click resets |
| DESTINATION | menu of automatable params | — | |
| TYPE | `->` uni / `<->` bi | per drop rule | |
| CURVE | single-bend response curve on the source (drag) | linear | no free drawing in S1 [med] |
| AUX SOURCE | menu | none | multiplies main source |
| MOD (aux mode) | Default (product) / (inv) / bypass | Default | **Alt-click** toggles bypass (1.10b5) |
| OUTPUT (`Mod N out`) | 0–100 % | 100 % | final row scaling |
- Math: default = amount × src × aux; (inv) = amount × src × (1 − aux). [high concept]
- Top-right matrix menu: **Velo->Amp** (1.34b9), **vibrato quick-assign** (next unused LFO → Global tuning via mod wheel, 1.23b2). [high]

### A16.4 Matrix sources (S1; preset id → name) [high, FMT fixtures + S1M]
1 Mod Wheel · 2–4 Env 1–3 · 5–8 LFO 1–4 · 9–12 LFO 5–8 · 13 Velocity · 14 Note · 15 Aftertouch (channel) · 16 Poly Aftertouch · 17–18 Chaos 1/2 · 19 Noise Osc (audio as mod) · 20–21 NoteOn Rand 1/2 (two independent per-note randoms) · 22–23 NoteOn Alt / NoteOn Alt 2 (flip-flop 0/1; Alt 2 inverse [high per S2M]) · 24–27 Macro 1–4 · 28 Pitch Bend · 29–31 MPE X / Y / Z (1.23b2+) · 32 Release Velocity · 33 Fixed (constant; depth = amount). Matrix-only (no tile): Aftertouch, Poly AT, Chaos 1/2, NoteOn Rand/Alt, Noise Osc, Pitch Bend, MPE, Rel. Velo, Fixed.

### A16.5 Destinations (S1)
- A destination = index into the automatable VST parameter list (≈299 in 1.334; 316 named in final build). Practically every knob. [high]
- Groups: Osc A/B (Vol, Pan, Octave, Semi, Fine, Unison, UniDet, UniBlend, Warp, CoarsePit, WTPos, RandPhase, Phase) · Noise (Level, Pitch, Fine, Pan, RandPhase, Phase) · Sub (Level, Pan) · Filter (Cutoff, Reso, Drive, Var, Mix, Stereo) · Env 1–3 AHDSR · LFO 1–8 Rate/Rise/Delay/Smooth · Porta Time/Curve · Chaos 1/2 Rate/BPM · **Mast.Tun** (hidden, ±64 st; vibrato target) · **Amp.** (hidden per-voice amp destination) · Master Vol · Mod Wheel · Macros? (no) · Unison globals (Uni LR, Uni Warp, Uni WTPos, Uni Stack) · **LFO Bus 1–16** · FX params incl. enables, levels, multiband thresholds · Bend U/D · Pitch Bend · Bypass. [high existence; matrix-amt-as-destination unverified low]
- FX are global: per-voice sources driving FX params are effectively driven by the most recent note [high; "most recent" med].

## A17. VOICING & PORTAMENTO (S1) [high, S1M unless noted]
- **Mono** (new note re-pitches the single voice) · **Legato** (with Mono: no env/LFO retrigger; with Mono off = poly-legato/paraphonic, 1.08) · **Poly** box **1–32**, init **8** [med], greyed in Mono · **voice counter "x / y"** (counts osc voices incl. unison, sub, noise).
- Options: lock polyphony (right-click, 1.10b7); voice stealing prefers released notes (1.29b7 fix); "limit polyphony to one of any note number" [med].
- **Porta** time 0–8 s, t = 8·n⁵ (0.5 → 250 ms), default 0 · **Curve** −100…+100 % default 0 (above centre convex: leave fast/arrive slow; below concave) · **Always** (glide even with no held note) · **Scaled** (1 octave = knob time; shorter intervals faster, larger slower).

## A18. MASTER, TUNING, MPE (S1)
- **Master Volume**: 0–100 %, gain = n³ (60·log10 n dB); **default 70 % = −9.3 dB**; 100 % = 0 dB. [high]
- **Master Tune**: automation/mod destination only (±64 st). [med]
- **A4 reference 430–450 Hz, default 440** (Global). [high]
- **Tuning files** `.tun` (lines >512 chars 1.34b6; UTF-8 paths); tuning embedded in presets; unnamed embedded tuning shows "(special)" — Cmd/Ctrl-click clears it. Tuning lock. [high]
- **MPE** (1.23b2; disabled by default from 1.24b1): main-menu MPE settings; sources MPE X (per-note bend), Y (CC74 timbre), Z (pressure); "MPE XYZ → Macro 1/2/3" style mapping [med]; prefs: incoming MPE pitch bend also routes to MPE X (1.36b8), "MPE Y acts BiDirectional" (1.36b8); MPE bend range follows MPE config messages [low-med]. [high existence]

## A19. GLOBAL page & preferences (S1)
- **Oscillator settings**: Pitch Tracking OSC A / OSC B; Noise Fine; Oversampling (1x/2x/4x + lock); Chaos 1/2 (Rate, BPM, Mono, S&H); per-osc Unison advanced (A4); Noise one-shot/keytrack flags stored here. [high]
- **Tuning**: A4 reference, `.tun` load/clear, lock. [high]
- **Preferences** (Global page; file `Serum.cfg` → `SerumPrefs.json` from 1.33b6; macOS `~/Library/Preferences/`, Win `%APPDATA%\Xfer\Serum`): show tooltips · double-click for typable values (on) vs double-click resets · mouse wheel adjusts controls · Mod Wheel → WT Pos while editor open · default WT view 2D/3D · silence effect tails when transport stops · embed non-factory noises · send parameter automation on preset load (off) · ask before preset change when edited (1.33b6) · MPE enabled by default · automation smoothing scale (config: 1–800 %, 0 = default 100 %) · default oversampling · default author name · default zoom/skin. [med-high]
- All Global settings are saved per preset except Preferences. [high]

## A20. FX RACK (S1)
### A20.1 Architecture [high, S1M/P1]
- Global (monophonic) processing of the summed synth (except Direct Out sources) after the voices, before master volume.
- **10 singleton modules**, any/all enabled. **Default order (top→bottom)**: Hyper/Dimension, Distortion, Flanger, Phaser, Chorus, Delay, Compressor, Reverb, EQ, Filter. Stored as 10 int32 positions (enable-param order Dist, Flg, Phs, Cho, Dly, Comp, Rev, EQ, Filter, Hyper; default vector 1,2,3,4,5,6,7,8,9,0).
- FX tab: left column of 10 name tiles (enable LED + up/down drag handle; drag to reorder; click scrolls rack, 1.09b5); rack on the right in the same order. Per-module power button at far right = temporary bypass (UI/preset state only, no VST param [med]).
- Enables are VST params (`Dist/Flg/Phs/Cho/Dly/Comp/Rev/EQ/FX Fil/Hyp Enable`), all off in Init.
- **Phase memory**: Hyper/Flanger/Phaser/Chorus LFO phases saved and recalled (1.30b9) — freeze with RATE 0.
- Rack menus (main menu and right-click on tiles): **Lock FX Rack**, **Load/Save Effect Chain** (folder `Effect Chains`, 1.08b6). Per-module presets via the small drop-down at each module's top-right ("Save Effect Settings"/load; X-Shaper curves included 1.34b4) [high exists / med UI].
- Prefs: silence effect tails on transport stop (Hall since 1.09b9; click-free 1.36b3); smoothing on FX knobs and level trims (1.30b6).

### A20.2 Common controls [high/med]
- **MIX** (rightmost knob on all but EQ). Measured law: wet = sin²(π·w/2), dry ≈ 1 − w² (−2.4 dB at 50 %) [med].
- **LEVEL** trim: click the MIX label to flip that knob to LEVEL (1.29b7). Normalised 0.5 = 0 dB, display 40·log10(2n) dB (−∞…+12 dB). Params `FX Dist/Flg/Phaser/Chorus/Delay/Comp/Reverb/DimExp/Filter/Hyper Level`; EQ has none; typed dB (1.29b9). [high]

### A20.3 S1 FX automation parameters (build 1.334) [high P1; laws high DT]
| # | Name | Display range | Default | Law (n = 0..1) |
|---|---|---|---|---|
| 81 | Verb Wet | 0–100 % | 33 % | linear |
| 82 | VerbSize | 0–100 % | 33 % | linear |
| 83 | VerbPDly (Plate) / Decay (Hall) | Plate pre-delay (range unpublished); Hall 0.8–12 s | n 0.12 (Hall 2.14 s) | Hall 0.8+11.2n s [med] |
| 84 | VerbLoCt | 0–100 % | 0 | |
| 85 | VerbDamp (Plate) / Spin Rate (Hall) | 0–100 % | 28 % (P1) vs 25 (later dump) | [conflict low] |
| 86 | VerbHiCt | 0–100 % | 50 % | |
| 87 | VerbWdth (Plate) / Spin Depth (Hall) | 0–100 % | 100 % (P1) vs 20 (later dump) | [conflict low] |
| 88/89 | EQ FrqL / FrqH | 21.5 Hz–20 kHz, f = 21.533·(20000/21.533)^n | .333 → 210 Hz / .666 → ≈2.05 kHz | |
| 90/91 | EQ Q L / Q H | 0–100 % | 60 % | |
| 92/93 | EQ VolL / VolH | ±24 dB | 0 | linear |
| 94/95 | EQ TypL / TypH | Shelf / Peak / Pass | Shelf | index/2 |
| 96 | Dist_Wet | 0–100 % | 100 % | |
| 97 | Dist_Drv | 0–100 % | 25 % | |
| 98 | Dist_L/B/H | 0 LP … 50 BP … 100 HP | 0 | morph |
| 99 | Dist_Mode | 16 modes | Tube | index/15 |
| 100 | Dist_Freq | 8.18 Hz–13.29 kHz; MIDI note = 128n | .5 → 330 Hz | |
| 101 | Dist_BW ("Q") | display uncaptured (S2: 0.075–7.575) | .5 | [low] |
| 102 | Dist_PrePost | Off / Pre / Post | Off | index/2 |
| 103–108 | Flg Wet / BPM / Rate / Dep / Feed / Stereo | 0–100 %, sync, 0–20 Hz (20n⁴), 0–100, 0–100, 0–360° | 100 %, off, .25 (0.078 Hz), 100 %, 50 %, 180° | |
| 109–115 | Phs Wet / BPM / Rate / Dpth / Frq / Feed / Stereo | …, Frq 20 Hz–18 kHz (20·900^n) | 100 %, off, 0.078 Hz, 50 %, 600 Hz, 80 %, 180° | |
| 116–123 | Cho Wet / BPM / Rate / Dly / Dly2 / Dep / Feed / Filt | Dly 0–20 ms (20n²), Dep 0–26 ms (26n²), Feed 0–95 %, Filt 50 Hz–20 kHz (50·400^n) | 50 %, off, 0.078 Hz, 5 ms, 0 ms, 26 ms, 9.5 %, 1 kHz | |
| 124–134 | Dly Wet / Freq / BW / BPM / Link / TimL / TimR / Mode / Feed / Off L / Off R | Freq 40 Hz–18 kHz (40·450^n); BW 0.8–8.2; Tim synced fast…4 bar or free 1–501 ms (1+500n⁴); Mode Normal/Ping-Pong/Tap->Delay; Off ×0.5–×1.5 | 30 %, 849 Hz, 6.8, **BPM on**, off, 1/4, 1/4, Normal, 40 %, ×1.0, ×1.0 | |
| 135 | Cmp_Thr | 0 to −120 dB, 60·log10(1−n) | −18.1 dB | |
| 136 | Cmp_Rat | 1:1…32:1 then **Limit** (r = 1/(1−n); Limit ≈ top 5 steps) | 4:1 | |
| 137/138 | Cmp_Att / Rel | 0.1–1000 ms, max(0.1, 1000n²) | 90 ms | |
| 139 | CmpGain | 0–30.1 dB, 20·log10(1+31n²) | 0 | |
| 140 | CmpMBnd | off/on | off | |
| 141–146 | FX Fil Wet / Type / Freq / Reso / Drive / Var | Type 96 enum; Freq ≈8 Hz–22.05 kHz | 100 %, **MG Low 6**, ≈425 Hz, 0, 0, 0 | |
| 147–153 | Hyp Wet / Rate / Detune / Unison / Retrig / Dim Size / Dim Mix | Unison 0–7 | 50 %, 40 %, 25 %, 4, off, 50 %, **0 %** | |
| 154–163 | FX enables | | 0 | |
| 268 | FXFil Pan | 0–100 %, 50 neutral | 50 % | 1.10b8 |
| 269 | Comp_Wet | 0–100 % | 50 % per P1 [low] | 1.10b8 |
| 270–272 | CompMB L / M / H | 0–200 % | 100 % | 1.10b8 |
| 289–298 | FX level trims | −∞…+12 dB | 0 dB | 40·log10(2n) |
- Non-automatable chunk state: rack order, Plate/Hall flag, **chorus "mono" flag** (L/R LFOs in phase; GUI unidentified [low]), X-Shaper A/B curves, mod-FX LFO phases.

### A20.4 Modules (S1)
**A20.4.1 Hyper / Dimension** (one module, two sections) [high]
- Hyper (micro-delay chorus, 1–7 voices, retriggerable): RATE 0–100 % (40; Hz law unknown), DETUNE 0–100 % (25), RETRIG (laser-zap reset per note; mostly for mono), UNISON 0–7 (4; 0 = Hyper off), MIX (50), LEVEL.
- Dimension (pseudo-stereo widener: 4 delay lines summed out of phase, slowly AM'd): SIZE (50), MIX (**0** = off), LEVEL.
- Measured: Hyper is additive (100 % = +2.5 dB, side −4.5 dB); Dimension adds side only (−10 dB at 50 %, −4 dB at 100 %). Hyper → Dimension order implied [low].

**A20.4.2 Distortion** — modes (16; index/15) [high DT]: **Tube** (default) · SoftClip · HardClip · Diode 1 · Diode 2 · Lin.Fold · Sin Fold · Zero-Square · Downsample · Asym · Rectify · X-Shaper · X-Shaper (Asym) · Sine Shaper · **Stomp Box** · **Tape Sat.** (last two 1.27b7; 1.0.1 had 13).
- Controls: MODE `<` `>` · **Edit A / Edit B** (X-Shaper modes only) · **OFF / PRE / POST** filter switch (display turns orange when active) · **F** (8.18 Hz–13.29 kHz) · **Q** · **LP/BP/HP** morph slider · **DRIVE** (Downsample: rate reduction; X-Shaper: morphs curve A→B) · MIX · LEVEL · transfer-curve display.
- Character / measured level on −17 dBFS saw (drive 0 → 100 %) [med]: Tube −6→+7.3 dB · SoftClip −6→+4.3 · HardClip −6→+6 (pre-gain (1+4n³)/2) · Diode 1 +5→+7.3 (clips at 0 drive) · Diode 2 +5.6→+4.8 (sinusoidal transfer, harder clip with drive) · Lin.Fold (full effect by 25 %) · Sin Fold · Zero-Square −6.1→+7.6 · Asym −4.4→+6.7 (even harmonics) · Rectify −6→+7.7 · X-Shaper default linear = −6 dB pad · Stomp Box −6→+5.5 · Tape Sat. −6→+3.5. Most modes sit −6 dB at zero drive.
- **X-Shaper editor**: symmetric mode = lower-left silence to top-right 0 dB, mirrored for negative samples; Asym mode = centre silence, top-right +max, bottom-left −max. Same point/curve editor & `.shp` files as LFO/Remap; shape menu load/save; curves stored in presets/module presets/chains. [high]

**A20.4.3 Flanger** [high]: BPM · RATE 0–20 Hz (20n⁴) or synced · DEPTH (100) · FEED (50; polarity bipolar vs unipolar ambiguous [low]) · PHASE (`Flg_Stereo` 0–360°, 180) · MIX (100) · LEVEL. Base delay ≈16 ms fixed (measured) [low-med].

**A20.4.4 Phaser** [high]: BPM · RATE · DEPTH (50) · FREQ 20 Hz–18 kHz (600) · FEED (80) · PHASE (180°) · MIX (100) · LEVEL. Stage count not exposed [low].

**A20.4.5 Chorus** (4 voices: 2 taps L, 2 R) [high]: BPM · RATE · DELAY 1 (5 ms) · DELAY 2 (0 ms) · DEPTH (26 ms) · FEED (9.5 %) · LPF on wet only (1 kHz) · MIX (50) · LEVEL.

**A20.4.6 Delay** [high]: FEED (40) · BPM (on) · LINK · LEFT time + LEFT offset (×0.5–×1.5; detents **TRIP 1.333**, **DOT 1.5**; "Dot 1/2" at 0.75) · RIGHT time/offset · **F** (849 Hz) · **Q** (0.8–8.2; **inverted**: max = least filtering) · drag in filter display sets F+Q · MODE **Normal / Ping-Pong / Tap->Delay** (Tap: mono, L fires once without feedback then R is a normal feedback delay) · MIX (30) · LEVEL. Synced ladder: fast, 1/256, 1/128, 1/64, 1/32, 1/16, 1/8, 1/4, 1/2, bar, 2 bar, 4 bar.

**A20.4.7 Compressor** [high]: THRESH (0 … −120 dB) · RATIO (labels 1.0–1.9:1 in 0.1, then 2, 3, 4, 5, 6, 7, 8, 10, 16, 32:1, **Limit** = true-peak limiter; in Limit, attack range 0–10 ms = look-ahead, latency changes) · ATTACK · RELEASE · GAIN (0–30.1 dB; S1M "~36 dB") · **MULTIBAND** (3-band upward+downward "OTT-style", fixed crossovers ≈128 Hz / 2.5 kHz [low for S1]; per-band threshold bars **H / M / L** 0–200 % = `CompMB H/M/L`, draggable, mod destinations, 1.10b8) · MIX (1.10b8) · LEVEL · blue GR meter. Measured multiband: quiet +3 dB brighter, loud −8 dB; 1:1 ≈ transparent (+1.9 dB) [med].

**A20.4.8 Reverb** — **PLATE / HALL** switch (Plate = modified TAL-Reverb; Hall added 1.09b5) [high]
| Slot | Plate | Hall |
|---|---|---|
| 82 | SIZE | SIZE |
| 83 | PRE DELAY | **DECAY** (0.8–12 s; 12 s ≈ infinite) |
| 84 | LOW CUT (0 = full lows) | LOW CUT |
| 85 | DAMP | **SPIN** (rate of modulating LFO) |
| 86 | HIGH CUT | HIGH CUT |
| 87 | WIDTH | **SPIN DEPTH** |
| 81 / 295 | MIX / LEVEL | MIX / LEVEL |
- Measured Hall RT60 floor set by SIZE (0.9 s @20 % … 7.0 s @100 %); DECAY dominates above ≈3 s. Default algorithm in Init: Hall per serum2vital [med].

**A20.4.9 EQ** (2-band, no MIX/LEVEL) [high]: left band type **Low Shelf / Peak / High-pass**; FREQ L (≈210 Hz); Q L (60 %); GAIN L ±24 dB (ignored in HP). Right band **High Shelf / Peak / Low-pass**; FREQ R (≈2.05 kHz); Q R; GAIN R. Filters improved 1.24b3.

**A20.4.10 Filter (FX)** [high]: TYPE (same 96 types; default **MG Low 6**) · CUTOFF · RES (0) · DRIVE · VAR · **PAN** (1.10b8) · MIX (100) · LEVEL. No key track in S1. Global (paraphonic when env-modulated).

### A20.5 Tempo-sync ladders
- Chorus/Flanger/Phaser RATE (BPM on): 31 entries incl. dotted & triplet from **Off / 24 bar … 1/32** (measured) — S1M says "0 Hz … 1/32", S2M "8 bars … 1/32"; use measured for S1. [med]
- Delay: see A20.4.6. Typed values with BPM on fixed 1.36b3. [high]

## A21. SerumFX (S1 effect edition, 1.09b2, free with Serum) [high, CL]
Inserts as an audio effect, opens on FX tab, in/out meters; oscillators off by default (presets saved with oscs on reload on, 1.30b6); **Note Latch** in voicing area holds a virtual note so LFOs/envs run without MIDI; **Audio In** selectable as noise-osc source; WT editor capture of input audio to a wavetable; input no longer clipped above 0 dB (1.26b6).

## A22. Files & folders (S1) [high, S1M]
`Serum Presets/` (macOS `/Library/Audio/Presets/Xfer Records/`, Win `Documents/Xfer/`): **Presets** (`.fxp`; one level of subfolders) · **Tables** (Serum WAVs; one level) · **LFO Shapes** (`.shp`; used by LFO, X-Shaper, Remap) · **Noises** (not embedded unless dragged/pref) · **System** (4 formula files, `MIDIccMaps/`, `User.dat`) · **Effect Chains** · **Renders** · **Skins**. Prefs file `Serum.cfg` → `SerumPrefs.json`.

## A23. S1 automatable parameter quick reference (P1 build 1.334; plus later additions)
`MasterVol` · `A/B Vol` 0–100 % (75) · `A/B Pan` ±50 · `A/B Octave` ±4 · `A/B Semi` ±12 · `A/B Fine` ±100 c · `A/B Unison` 1–16 · `A/B UniDet` (0.25 shown) · `A/B UniBlend` (75) · `A/B Warp` · `A/B CoarsePit` ±64 · `A/B WTPos` 1–256 · `A/B RandPhase` (100) · `A/B Phase` (180°) · `Noise Level/Pitch/Fine/Pan/RandPhase/Phase` · `Sub Osc Level/Pan` · `Env1–3 Atk/Hold/Dec/Sus/Rel` · `OscA/B/N/S>Fil` · `Fil Type/Cutoff/Reso/Driv/Var/Mix/Stereo` · `LFO1–8 Rate` · `PortTime/PortCurve` · `Chaos1/2 BPM/Rate` · `A/D/R curve1–3` · `Mast.Tun` · FX params (A20.3) · `OscA/BPitchTrack` · `Bend U/D` · `WarpOscA/B` (index/23) · `SubOscShape` (index/4) · `SubOscOctave` · `A/B Uni LR/Warp/WTPos/Stack` · `Mod 1–32 amt/out` · `Osc A/B/N/S On` · `Filter On` · `Mod Wheel` · `Macro 1–4` · `Amp.` · `LFO1–8 smooth/Rise/Delay` · `Pitch Bend` · `FX * Level` · `LFO Bus 1–16` · `Bypass`.
Non-automatable switches block (FMT): A4 ref (430+20v Hz), unison Tuning A/B (index/4), Mono, Legato, Porta Always, Porta Scaled, Oversampling (index/2), Noise one-shot, Noise pitch-track, Polyphony ((v−1)/31), Filter keytrack, Unison Range A/B (st/48), Chaos Mono ×2, chorus mono flag, Chaos S&H ×2, Reverb Hall flag.

---

# PART B — SERUM 2 ADDITIONS & CHANGES (Phase 2)
Everything in Part A remains unless stated. S1 presets load with **S1 Compatibility Mode** (B24.3).

## B1. Architecture changes [high, S2M/S2WN]
- **Three primary oscillators OSC A / B / C**, each switchable between **Wavetable, Multisample, Sample, Granular, Spectral** (internal enum `kOsc_WT, kOsc_MultiSample, kOsc_Sample, kOsc_Granular, kOsc_Spectral`, plus `kOsc_Noise`, `kOsc_Sub`). Switching between Sample/Granular/Spectral keeps the last loaded sample.
- **SUB** and **NOISE** remain (both upgraded).
- **Two voice filters** (Filter 1, Filter 2; both off in Init).
- **Per-source routing** (each osc, sub, noise and each filter): **Filter** (balance knob: full left = Filter 1, full right = Filter 2, between = blend) · **Main** (through Main FX) · **Direct** (bypass filters and FX) · **None** (silent; modulation-only use) — plus **BUS 1 / BUS 2** send knobs. Enum Filter=0, Main(Master)=1, Direct=2, None=3. Defaults: **OSC A → Filter 1** (balance −100); everything else → Main. Series filters = Filter 1 routed to Filter (2); parallel = both to Main. [high]
- On Main/Direct an **ENV** toggle chooses whether ENV 1 gates the level (`kParamViaEnv1`) [med].
- **Three FX racks**: MAIN, BUS 1, BUS 2 (B14). **Mixer page** (B13).
- **Four envelopes**, **ten LFOs** (with Path/Chaos/S&H types), **eight macros** (also destinations), **64-slot matrix**, **Voice Control** per-voice sequencer, **Clip sequencer**, **Arpeggiator**, keyboard **Key/Scale/Swing/Osc Mapping**. Global undo/redo. [high]

## B2. Common oscillator / module features
- **Header right-click menu**: Lock Module (individual controls can still be unlocked; Init Preset clears locks) · Init Module (also removes the module's modulations) · Copy · Copy (w/mods) · Paste · **Enable Pitch Tracking** (default on) · **Pitch Bend Tracking** (shown only when tracking is off and only for Sample/Granular/Spectral; default on; WT and Multisample always follow bend) · **Edit Note Ranges** (opens mapping editor). [high]
- Tracking off: Multisample/Sample/Granular/Spectral play **C3 (MIDI 60)**; Wavetable plays **C−2 (MIDI 0)** (LFO use). [high]
- **Drag module labels**: Alt-drag = copy without mods; Shift-Alt-drag = copy with mods; plain drag = **swap** (incl. mods). Clipboard survives preset changes, not across instances. Also works on the Mixer page. [high]
- **Pitch controls**: OCT, SEM, FIN (cents), CRS (continuous). **Right-click OCT/SEM → mode**: **Semitones** · **Harmonics** (integer multiples) · **Ratio** (choose source **SRC** and ratio; FM-style) · **Step** (MTS-ESP periods/steps; only when an MTS-ESP source is active). VST params per osc also include **Ratio** (default 1.000) and **Hz Offset** (default 0.00 Hz, linear detune). [high / Hz Offset semantics med]
- `Global > Main Tuning` destination moves all oscillators. [high]
- Type menus: `<` `>` arrows and mouse wheel; **Embed in Preset** for imported tables/samples (not for factory content); missing files dialog with search paths. [high]

## B3. Wavetable oscillator deltas
- **Smooth Interpolation** (right-click WT POS; manual typo "Smooth Interpretation"): non-destructive smooth frame transitions without morph tables. [high]
- **Phase Memory** menu: **All Voices** (default; uses PHASE + RAND), **Contiguous** (continue previous note's phase), **Per Voice** (each note starts from one editable stored set of per-voice phases; switching while notes sound captures them — replaces MemTrig). [high]
- **Phase Legato** (right-click PHASE) inverts the S1 reset-on-steal behaviour. [high]
- **Dual warp**: **WARP 1** and **WARP 2** slots (menu + knob each), **Swap Warps** item; unison spreads each separately. Processing order (1 then 2) undocumented [low]. Sync adds a **WARP Var** fader (hard ↔ soft sync); per-slot `kParamWarpVar/WarpVar2`. [high]
- 2D view shows warp effect for Sync, Alt Warp and Distortion categories. [high]
- Default table `S2 Tables/Default Shapes.wav` (9 frames: saw, sine, triangle, squares, pulses…). [med]
- Defaults (P2): Level 75 % (−5.0 dB), Pan 0, Coarse `--`, Pitch Track on, Unison 1, Detune 0.25, Blend 75, Width 100, Span 0, Rand Start 0, Uni Warp/Warp 2 0. A on, B/C off. [high]

### B3.1 Serum 2 WARP menu (WT and, unless noted, all osc types) [high, S2M pp49–56]
| Category | Items |
|---|---|
| — | **Off** |
| Sync | **Sync** (+ WARP Var fader). Replaces S1's two windowed-sync entries. Whole-number ratios harmonious; others produce a saw-like reset artefact. |
| Alt Warp | Bend +, Bend −, Bend +/-, PWM, Asym +, Asym −, Asym +/-, Flip, Mirror, Remap 1, Remap 2, Remap 3, Remap 4, Quantize, **Odd/Even** (0 % odd only, 50 % original, 100 % even only = octave up; IMPL odd = (x(p)−x(p+½))/2, even = (x(p)+x(p+½))/2) |
| Filter | **LPF**, **HPF** (per-osc filter as a warp; slope/range undocumented) |
| Distortion | Tube, Soft Clip, Hard Clip, Diode 1, Diode 2, Linear Fold, Sine Fold, Zero-Square, Asym, Rectify, Sine Shaper, Stomp Box, Tape Sat., **Soft Sat.** (knob = drive; no Downsample/X-Shaper/Overdrive) |
| FM | FM (other osc, e.g. FM (B), FM (C)), FM (Noise), FM (Sub), **FM (Filter 1)**, **FM (Filter 2)**; FM type **Thru-Zero / Exp / Linear** (Linear = thru-zero clamped at 0) — "true FM" |
| PD | PD (other osc ×2), PD (Noise), PD (Sub), PD (Filter 1), PD (Filter 2), **PD (Self)** — phase modulation; closest to S1 "FM" |
| AM | AM (osc ×2), AM (Noise), AM (Sub), AM (Filter 1), AM (Filter 2) |
| RM | RM (osc ×2), RM (Noise), RM (Sub), RM (Filter 1), RM (Filter 2) |
| — | **Swap Warps** |
- Source must be enabled (level may be 0). Internal IDs seen: `kSync, kBendPos, kBendNeg, kBendPosNeg, kPWM, kAsym…, kMirror, kQuantize, kEvenOdd, kFilterLPF/HPF, kDistTube…kDistSoftSat, kFM_OSC, kFM_OSC2, kFM_NOISE, kFM_SUB, kFM_FILT1/2, kPD_*, kSelfPD, kAM_*, kRM_*`; also `kFMX_OSC`, `kFMP_OSC`, `kDLM` (probably FM-type variants / unidentified) [med IDs / low meaning].
- Quality setting affects warps (changelog fixes for FM (Noise), AM/FM/PD/RM at non-High quality). [high]

## B4. Unison panel (S2, per osc; gear button by the voice count) [high, S2M]
- **MODE**: Linear, Super, Exp, Inv, Random (S2M describes Inv as "lower voices detuned more sharply" vs S1M "pushed to the edges" — same mode, differing prose).
- **STACK**: Off, 12 (1–3x), 12+7 (1–3x), Center-12, Center-24 (same 9 entries).
- **WIDTH**, **RANGE**, **WT POS** (WT mode), **WARP 1**, **WARP 2**; Sample/Spectral/Granular add **START** (random start per voice) and **SPAN** (fixed start offset per voice); Granular adds **SPAWN PATTERN**: Together (default) / Even / Exp / Random. DETUNE and BLEND on panel. VST: `Uni Span`, `Uni Rand Start`.

## B5. MULTISAMPLE type [high]
- Instrument menu or **Load SFZ** (no SF2); zone display highlights playing zone; click shows last note's waveform. Loop metadata respected (2.0.23).
- Envelope pane: **OVERRIDE** (replace SFZ envelopes) with **DELAY** (ms; right-click BPM sync), A, H, D, S, R; draggable graph.
- **VEL TRACK**, **RAND** (random start), **TIMBRE** (inverse zone remap: higher notes use lower-mapped samples; observed −18…+64), UNISON (DETUNE/BLEND + panel), WARP 1/2, PAN, LEVEL.
- **Switch to Single Sample** (last note played → Sample mode); then **Switch to Wavetable** (import submenu).

## B6. SAMPLE type [high]
- Root note default **C3** (MIDI 69 = A3 = 440 Hz convention); filename suffix `<space|_><Note>` sets root (`F2`, `Eb3`, `D#3`); WAV `smpl`/`inst` chunks read; ACIDized WAV root detection.
- Start/End markers. Right-click: Show Marker Animation · Zoom to Start and End · Snap Off / Snap to Zero / Snap to Beats / Snap to Loop · Fade Edges (None, 1–128 ms) · Normalize · Reverse · Trim (all non-destructive; Reload Sample resets) · **Slicing Off / Slice Auto / Slice Manual**.
- Slicing: Auto threshold line; Manual Alt-click add/remove; options Play Slice to End · Play Single Slice (slice chosen by mod destination; rate follows key) · Root Note (C−1…C8) · Send to Selected Clip · Auto-Sync to Clip. VST: Single Slice, Slice Play Mode (default "To Next Marker").
- **Loop menu**: One-shot · Fwd Loop · Rev Loop · Fwd/Rwd Loop · Tailed; toggles Relative Loop · Link Loop Length · Exit Loop on Release. LS/LE markers (reversed if LE<LS by modulation); **X-fade** (auto-scaled inside sample, 2.0.17). Enum `kForward, kPingPong, kTailed, kReverse`.
- **SCAN** (speed & direction): menu Range ±200 % (default) / ±400 % / ±800 %, Reverse, Lock Scan Rate (tempo), **Sample Length to BPM** (knob becomes RATE in bars/beats). VST: Scan Rate 100 %, Scan BPM Rate "bar", Scan Key Track off, Position, Start 0, End 100, Loop Start/End/X-Fade, Loop Mode (default One-shot).
- UNISON (START/SPAN), WARP 1/2, PAN, LEVEL, Switch to Wavetable.

## B7. GRANULAR type [high]
- Up to **256 grains**; shares sample/markers/operations/slicing/loop menus with Sample. Loop menu adds **Loop Grains** and **Manual** (playhead becomes a red X|Y dot; SCAN = X; no auto scan; slicing off).
- **Window** button (Alt-drag sets amount/skew): AMOUNT (+rand), SKEW (+rand), SHAPE: Hann, Welch, Gaussian, Blackman-Harris, Sinc, Tukey, Triangle, Trapezoid, ExpDec, Exp Dec Rev.
- **SCAN** (negative = reverse, 0 = freeze): Range ±200/400/800 %, Reverse, Key Track, Lock Scan Rate, Sample Length to BPM.
- **DENS**: Free (Hz; observed up to 800) / BPM Sync (+Trip/Dot) / Grains (constant overlap count); options Jump Start, Max Grains (cap incl. unison grains).
- **LENGTH**: Free (s/ms; ≤10 s observed) / BPM Sync / Percent (of density period; not with DENS = Grains).
- Per-grain random: OFFSET, DIR (right-click Reverse Grains, modulatable), PITCH (≤12 st observed), RAND LENGTH, RAND PAN, RAND LEVEL (+ Rand Window/Skew/Warp/Warp 2 via X|Y targets).
- **X|Y control**: X = position; **Y target**: None, Level, Warp, Warp 2, Density, Grain Length, Window Amt, Window Skew, Rand Offset, Rand Dir, Rand Pitch, Rand Length, Rand Pan, Rand Gain, Rand Window, Rand Skew, Rand Warp, Rand Warp 2 (+ Y modulation-mode submenu).
- WARP 1/2 (with Warp Var), UNISON (START, SPAN, SPAWN PATTERN), PAN, LEVEL, Switch to Wavetable. Grain count adds to voice count.

## B8. SPECTRAL type
- STFT/phase-vocoder resynthesis; independent time and pitch; FFT size/hop undocumented. [high concept / low internals]
- **Spectrogram** (drag to zoom), optional waveform below; start/end markers; **Hi/Lo frequency markers** (modulatable `Freq Lo/Hi`); right-click **Smooth** (4th-order Butterworth band edges) and **Post Warp** (apply band limits after spectral warps). [high]
- Loop menu as Sample + **Manual** (X|Y). X|Y Y-targets: None, Level, Warp, Warp 2, Spec Flt Cutoff, Spec Flt Wet/Dry, Freq Lo, Freq Hi. [high]
- **SCAN** menu: Range, Reverse, Key Track, Lock Scan Rate, Sample Length to BPM, **Phase Lock** (less smearing, tonal), **Transients** (preserve transients). [high]
- **CUT** (spectral filter shift, −100…+100), **FILTER** display = custom curve editor (double-click add/remove; drag points/curves; Alt-drag snap or move all curves; marquee; GRID field), filter presets (factory/user/Default), or **a wavetable used as the filter** (right-click; "Curve Filter" returns); **MIX** (spectral filter wet/dry). [high]
- **B8.6 Spectral warp modes** — official names not published as a list. Internal IDs observed in factory presets [med, S2S]: `kSpectralComb`, `kGate`, `kAddharmonics`, `kAddsubharmonics`, `kSpread`, `kSmear`, `kDetune`, `kPeakOctaveUp`, `kPeakOctaveDown`, `kPeakHarmUp`, `kPeakHarmDown`, `kShepardFilter`, `kShepardNarrow`, `kVocode_OSC`, `kVocode_NOISE`, `kMask_OSC`, `kMask_NOISE`, `kMirror`, `kSpectralPitchShift`, `kSpectralShift`, `kSpectralPhaseTwist`; the shared Filter/Distortion/FM/PD/AM/RM warps are also available. Changelog 2.0.20: new **"Pitch Shift"** spectral warp; old one renamed **"Pitch Blend"** [high]. Secondary sources name Smear (partials fade, tape-stop-like), Spread (separates partials, freq-shift-like), Harmonics, Comb [low-med]. Likely UI names: Comb, Gate, Add Harmonics, Add Subharmonics, Spread, Smear, Detune, Peak Octave Up/Down, Peak Harm Up/Down, Shepard Filter, Shepard Narrow, Vocode (osc/noise), Mask (osc/noise), Mirror, Pitch Shift, Pitch Blend(?), Shift, Phase Twist [low — read the menu from the plugin].
- UNISON (START/SPAN), PAN, LEVEL, Switch to Wavetable. [high]

## B9. SUB deltas [high]
Shapes **Sine, Rounded Rect, Triangle, Saw, Square, Pulse** (6; enum `kSine…kPulse`). **OCT** and **CRS** (continuous). **PHASE** knob (right-click **Contiguous**). PAN, LEVEL (75 % = −5.0 dB), Pitch Track (on), routing incl. Filter balance (default −100 = Filter 1 side), Bus sends.

## B10. NOISE deltas [high]
- **Colour noises** category: **White, Pink (−3 dB/oct), Brown (−6 dB/oct), Geiger** (random clicks); when selected, **STEREO** (0 mono … 100 decorrelated) and **FILTER** (HP↔LP tilt) knobs appear.
- Menu: Load Sample / drag-drop, **Embed in Preset**; One-shot/Loop; **START** (%, draggable field); **RAND**; **PITCH** (50 % nominal, keytrack off); **FINE** (now on panel); PAN; LEVEL (25 % = −24.1 dB); Pitch Track (default **off**); routing; FM/PD/AM/RM source; **Audio Input** in Serum 2 FX.

## B11. Wavetable editor deltas [high]
Opened by hover edit button top-right of display · **Mirror** draw tool · frame **COPY / PASTE** (contiguous ranges) · Process menu renamed **All** (incl. Remove Low Spectra/Phases, Set Spectra/Phases from Other Osc, Shift to Zero-Crossing (all)) · Add/Remove → **Remove** button with "Reduce to" · **Sort Randomize** · FFT menu adds **Repeat Bin Group (Start to Cursor Pos)**; Shift-Cmd/Ctrl-click phase row nudges phase right · Import adds **FREQUENCY ESTIMATION** and **Switch OSC type** (import as Sample/Granular/Spectral) · Export: All As 16-bit / 32-bit (.wav), Single-Cycle Waves, 8-bit `.256`, Selection · Save via right-click (tinted) table name → **Save Table** · formula **Save Formula** dialog · stereo import L→A/C, R→B · PNG import (8-bit, width = frames ≤256). Long-cycle import crash fixed 2.0.21 (≥6996 samples/frame).

## B12. FILTERS (S2)
- Two filters, each with power button, **routing switches S / A / B / C / N** (S2M p134 — in addition to per-source routing buttons), and its own routing button (Filter→other filter, Main, Direct, None) + Bus sends. [high]
- Controls: CUTOFF (drag cutoff+res directly on graph) · RES · DRIVE (right-click **Clean Mode**: input −24 dB, output +24 dB, less saturation) · VAR (label per type) · PAN (50 neutral) · MIX (100) · **LEVEL** slider (dB; `kParamLevelOut` 0.5 = 0 dB) · key-track switch · **X / Y** params (PZ SVF). [high]
- **Key track**: follows the pitch of the **first oscillator (A/B/C) with pitch tracking on, including portamento**; if none, follows MIDI note. [high]
- **Display options** (right-click; Alt-click cycles): Frequency Response · Frequency Response & FFT · Phase Response & FFT. [high]
- Type menu hierarchical: **Normal, Multi, Flanges, Misc, New**; `<` `>` and mouse wheel. All S1 types retained. Default type **MG Low 12** (P2). [high]
- **"New" category** [high, S2M pp138–139]:

| Type | Description | Var |
|---|---|---|
| Wsp | Circuit model of a classic buzzing synth filter (EDP Wasp-inspired [med]) | **MORPH**: LPF / Notch / HPF |
| DJ Mixer | Xfer's freeware DJM filter (one-knob LP↔HP sweep [med]) | none |
| Diffusor (internal `Diffuser`) | All-pass diffusor stages (phasey/blurry) | **STAGES** (# of APF stages) |
| MG Ladder | Clean transistor-ladder model | **SMOOTH**: slows cutoff modulation |
| Acid Ladder | **Diode-ladder** model (acid) | SMOOTH |
| EMS Ladder | Clean model of the EMS VCF | SMOOTH |
| MG Dirty | MG Ladder with full circuit distortion | **PAIN** (drive/overdrive amount) |
| PZ SVF | **Drawable** pole/zero SVF (X/Y morph params; `PZs` data) | SMOOTH |
| Comb 2 | Comb with extreme resonance | **FRQ2** |
| Exp MM | Multimode output of a classic synth expander module | **MIX**: LPF / Notch / HPF blend |
| Exp BPF | BPF output of the expander module | none |
| K35 | reported added in 2.1.0 (Korg-35 style) | **unverified [low]** |
- Internal keys seen: `MgL12, L24, LBH12, CombP, Phase48HL6N, LEQ12, SNH1/SNH2, RM/RMT, ZDF_A, ADD_BASS, FormantONE/TWO, DistComb1LP, Scream3LP/BP, LadderMg, LadderAcid, LadderEMS, DirtyMg, Wsp, Exp, ExpBPF, DJMixer, Diffuser, Comb2, PZ_SVF, Reverb1`. [med]

## B13. MIXER page [high, S2M pp144–151]
| Channel | Routing | Controls |
|---|---|---|
| OSC A/B/C, SUB, NOISE | Filter (balance F1↔F2) / Main / Direct / None | BUS 1, BUS 2 sends, PAN, level, ENV (ENV 1 gating on Main/Direct) |
| FILTER 1/2 | other Filter / Main / Direct / None | BUS sends, PAN, MIX, level; drag display for cutoff/res |
| BUS 1/2 | Main / Direct / other Bus | level, FX-bypass button (red) |
| MAIN / DIRECT | — | levels; Main FX bypass |
- Params: Direct Vol and Bus 1/2 Vol default 50 % = 0 dB. Bus send ignored when modulated level < 0 (2.0.17). Pre/post-fader send behaviour undocumented [low]. Module-copy shortcuts work here.

## B14. FX (S2)
### B14.1 Rack architecture [high]
- **13 effects + 3 splitters**: Bode, Chorus, Compressor, Convolve, Delay, Distortion, Equalizer, Filter, Flanger, Hyper/Dimension, Phaser, Reverb, Utility; Splitter L/H, Splitter L/M/H, Splitter M/S. Any order, **multiple instances allowed**. Type IDs 0 Distortion, 1 Flanger, 2 Phaser, 3 Chorus, 4 Delay, 5 Comp, 6 Reverb, 7 EQ, 8 Filter, 9 HyperD, 10 Bode, 11 Conv, 12 Utils, 13 Split, 14 Split3, 15 SplitMS [med].
- Racks **MAIN, BUS 1, BUS 2** (tabs; `FXRack0..2`; list order = processing order; ≤16 slots per rack observed/suggested [low]).
- UI: list view (left) + rack view (right); expand **Alt/Option+F**; add via "+" or right-click → Add FX Module; drag to reorder (yellow line); **Alt-drag** copy w/o mods, **Shift-Alt-drag** with mods; X removes; per-module bypass (red); **Alt-click a bypass** toggles all FX on that bus; direct manipulation on graphics.
- Rack presets (`.SerumFXRack`; Init, Save). Right-click rack background: Add module, Cut / Copy / Paste / Clear FX Bus, **Lock FX Bus**, **Lock All FX Busses**, Load / Save FX Bus (lock keeps modules but clears modulations to them).
- Module menu: Factory presets, Save FX Preset (`.SerumFX`, `Effect Chains/<Module>/Factory`, ≈240 factory), Save as Default Preset, Duplicate FX Module, Remove FX Module.
- Every module: **MIX** (0–100) and **LEVEL** (dB; `kParamLevelOut` 0.5 = 0 dB [med]); `kUIParamMixOrGain` remembers which is shown; bypass = `kParamEnable`.
- Automation: dynamic modules expose **16 generic "FX Main Param n" and 16 per bus ("FX Bus 1/2 Param n")** host-automation slots that get bound on demand [med, P2 + CL 2.0.17/18]. Mod addressing: `destModuleTypeString` + `destModuleParamName` + `destModuleID = rack·100 + slot` [med].
- FX remain **global (not per-voice)**. S1 rack loads onto MAIN in S1 order. "FX bus routing" lock group (2.0.22); per-param FX locks removed (2.0.21). Pref: Silence note + FX tails when transport stops.

### B14.2 Changed existing modules
| Module | S2 additions | Conf |
|---|---|---|
| Distortion | **18 modes** (adds **Overdrive** with STAGES 1–16, and **Soft Sat.**); menu order: Tube, SoftClip, HardClip, Diode1, Diode2, Linear Fold, Sin Fold, Zero-Square, Downsample, Asym, Rectify, X-Shaper, X-Shaper (Asym), Sine Shaper, Stomp Box, Tape Sat., Overdrive, Soft Sat. Right-click FREQ → **Key Track** (2.0.17); drag display = DRIVE; LP↔BP↔HP slider now horizontal; Q stored 0.075–7.575; S2WN mentions a **DC bias** control (UI not located [low]). S2M still says "13 types" (stale). | modes high (order med) |
| Delay | MODE adds **High Quality** option (default on); double-click filter display = realtime spectrum overlay; time stored in s; offset Trip/Dot detents; BW 0.75–8.25. | high |
| Chorus | Click **LPF** label → **HPF** toggle; RATE BPM 8 bars–1/32 or 0–20 Hz. | high |
| Phaser | **POLES** (stages; 1–18 observed, default 4 [med]) and **DEPTH 2** (offset between stages). | high |
| Flanger | + LEVEL only. | high |
| Compressor | MODE **SINGLE / MULTIBAND**; multiband adds **X-LOW** (≈128.3 Hz default), **X-HIGH** (2.5 kHz), **BELOW** (ratio below threshold = upward), **H / M / L** band gains (±24 dB); per-band thresholds dragged in graph (0–200 %); right-click RATIO → **Limiter Latency Comp**; Limit: attack 0–10 ms, makeup 0–36 dB; compressor makeup ≈30 dB. Hidden keys: per-band ratios, deadbands, up/down bypass [low UI]. | high |
| Reverb | **TYPE: Plate (default), Hall, Vintage, Nitrous, Basin** (see B14.4). Plate and Hall both get PRE-DLY (BPM-syncable, ≤2.5 s). Enum `kPlate=0, kHall, kVintage, kAbyss, kSpace` → by order **kAbyss = Nitrous, kSpace = Basin** [low-med]. | high |
| EQ | + LEVEL, graphical display; still 2 bands, same type sets. | high |
| Filter (FX) | Uses S2 type list; right-click CUTOFF → Key Track; right-click DRIVE → Clean Mode; display menu as voice filter. | high |
| Hyper/Dimension | separate LEVEL for Hyper and Dimension. | high |

### B14.3 New modules [UI high S2M; ranges med S2S]
- **Bode** (frequency shifter): MONO INPUT · SHIFT (% of RANGE, bipolar; right-click **Retrig**) · RANGE (0.1–5000 Hz) · DIR (centre = channels shift opposite ways) · WIDTH (both or one output) · DELAY (+BPM) · FEED (feedback through shifter → spiralling) · BALANCE (down vs up into delay) · BLUR (diffusion, chorus/wow) · MIX · LEVEL. Hidden Swap A/B [low].
- **Convolve**: IMPULSE menu `<` `>` (factory folders Cab, Coloration, Long, Massive, Medium, Short, Weird; Load IR / drag-drop; Embed in Preset) · SIZE (10–1000 %, 100) · TONE (±100) · **ϕ MIN** (minimum-phase conversion) · PRE-DLY (+BPM) · ATTACK · DECAY · DAMP · IR GAIN (default −18 dB) · MIX · LEVEL.
- **Utility**: POLARITY INV L/R · LPF (50 Hz–20 kHz, off at 20 k) · HPF (≈1–400 Hz) · MONO BASS + FREQ (20–400 Hz, 90 default) · WIDTH (0–800 %, 100) · PAN (balance) · MIX · LEVEL.
- **Splitters**: each branch holds a sub-rack (list shows all branches; rack shows selected branch); add modules by right-clicking a branch panel; per-branch bypass; splitter LEVEL. **L/H** (LOWS/HIGHS, SPLIT FREQ ≈30–5800 Hz) · **L/M/H** (two SPLIT FREQs) · **M/S** (MID/SIDE). Nesting undocumented [low].

### B14.4 Reverb per-type controls [high, S2M]
| Type | Controls (+ MIX, LEVEL) |
|---|---|
| Plate | LO CUT, HI CUT, SIZE, PRE-DLY, DAMP, WIDTH |
| Hall | LO CUT, HI CUT, SIZE, PRE-DLY, DECAY, SPIN RATE, SPIN DEPTH |
| Vintage | LO CUT, HI CUT, SIZE, PRE-DLY, ER SIZE, DECAY, DAMP, DIFF A, DIFF B, CHORUS (rate / depth) |
| Nitrous | LO CUT, HI CUT, SIZE, PRE-DLY, FEEDBACK, DIFFUSION, MODE (Space / Marble / Rectangle / Hexagon / Box), CHORUS (rate / depth) |
| Basin | LO CUT, HI CUT, SIZE, PRE-DLY, FEEDBACK, CHORUS (rate / depth) |
LO/HI CUT 0–100 % (100 = all removed). Measured: S2 Plate RT60 follows SIZE (0.4 s @10 % … ≈12 s from 65 %) and runs ≈6 dB hotter [med].

## B15. ENVELOPES (S2)
- **ENV 1–4** (ENV 1 = amp; others show ENV 1 faintly behind). AHDSR knobs (ATK, HOLD, DEC, SUS, REL) + curve handles (mouse only). Lock / zoom as S1. [high]
- **MS / BPM** units toggle (switching converts to nearest division at host tempo). Graph right-click: **Legato Inverted** (always retrigger even with LEGATO on), **Grid ▸ Time / Beats**, **Voice Steal Retrigger** options (2.0.21). Right-click tab: bypass/remove destinations. **Lock Module** (2.0.22). [high]
- **Start and End levels on ENV 2–4 only** (default −∞ dB; tooltips 2.0.22). [high]
- Defaults (P2): Attack 0.5 ms, Hold 0, Decay 1.00 s, Sustain ENV 1 0 dB / others 100 %, Release 15 ms, curves displayed 40/60/60 (stored 50/66.6/66.6 per S2S) [high display / conflict low]. Ranges to 32 s [high]. Global env-time scaling in Voice Control (B20).

## B16. LFOs (S2) [high, S2M pp188–200]
- **LFO 1–10** (7–10 appear after LFO 6 is used). Settings independent; Alt-drag a tab onto another copies all settings.
- **Drawing tools** (depend on grid): Point, Flat, Ramp Up, Ramp Down are documented (S2M p189; the table may continue beyond the extracted text — verify full tool list in plugin [med]); dedicated **LFO Editor** (large canvas); LFO shape presets. Gestures as S1.
- **TYPE**: **Normal**, **Path** (2-D route; extra "LFO n Y" output source), **Chaos: Lorenz**, **Chaos: Rossler**, **S&H**.
- **MODE**: **FREE** (follows host clock, ignores notes) · **RETRIG** · **ENVELOPE** (one cycle; loopback point via right-click "Set Loopback Point Here").
- **MONO** (shared across voices; default poly). **SHAPE** menu (presets/save; **Wavetable A/B/C to LFO**). **DIRECTION**: Forward / Reverse / Ping Pong. **GRID** (independent horizontal and vertical; double-click to type).
- **HOST** (replaces Anchor): with BPM, phase anchored to transport; **with BPM off** it decides whether phase is derived from host sample position on retrigger (reproducible "free" LFO) vs truly free-running.
- **BPM/HZ**; **RATE** (default **1/4**; right-click **Swing** in BPM uses global swing; right-click **10x** in Hz → up to 1000 Hz); **TRIP / DOT**; **RISE**, **DELAY** (default Off), **SMOOTH**; **PHASE** (start phase 0–360°, right-click Snap to Grid).
- Point modulation via **LFO Bus** menus (Modulate X / Y) or drag a source onto a point → X/Y buttons. Lock Module (2.0.22). Alt-drag LFO tab onto a WT display copies shape to the wavetable.

## B17. VELO / NOTE curves & MACROS (S2) [high]
- VELO and NOTE tabs: drawable graphs (double-click add/remove point, drag point, drag curve, Alt-drag curve = all curves). Right-click tab: **Legato (Portamento Time)** (curve follows portamento when overlapping), **Init Graph** (straight diagonal). Lockable (2.0.22); option whether tuning applies to the Note curve [low, 2.1.4 claim].
- **Macro 1–8**, renameable, **usable as destinations** (macro-to-macro, macro as modulated aux). Drag a macro onto another to **swap** assignments. Macros pane also in CLIP view (record macro automation into clips).

## B18. MOD MATRIX (S2) [high, S2M pp209–214]
- **64 slots**, "49 different modulation sources". Expanded view button / **Alt/Option+F**.
- Row: **SOURCE** · **CRV** (source curve; 50 % = linear; grey = bypassed; double-click or right-click "Editable Curve" → free-drawn curve editor with **RISE / FALL** smoothing = slew) · **AMOUNT** (bipolar; Cmd/Ctrl-click resets) · **POL** (uni / bi) · **DESTINATION** · **OUT** (live output graph) · **AUX SOURCE** · **INV** · aux **CRV** · **OUTPUT** · bypass button · remove button · drag handle to reorder.
- Per-slot keys (S2S): amount ±100, bipolar, aux inverted, aux curve, curve in, main/aux curve data, **SmoothRise / SmoothFall / SmoothLink**, **DelayOffset / DelayBeatSync** (per-route delay [med]), bypass.
- Aux math: amount × src × aux (inv: × (1 − aux)). [high]
- **Matrix menu**: Sort by Source · Sort by Destination · **Lock Matrix (Keep Assignments on Preset Change)** · **Create Vibrato (Unused LFO->Pitch via Wheel)** (next free LFO → Main Tuning, aux Mod Wheel) · **Create Velo->Amp Assignment** · **Apply and Delete Macros** (bake current macro offsets into each assigned parameter's value, then delete all macro routings).
- **Knob context menu**: Mod Source ▸ · **Aux Source ▸** · **Edit Custom Curve** · Bypass Modulator · Remove Modulator · Remove All Modulators · Reset Control · MIDI Learn · Remove MIDI cc · Lock Parameter. Pref "Limit Mod depth on drop" clamps dropped depth to the remaining knob range.
- **Sources**: Env 1–4 · LFO 1–10 (+ LFO n Y for Path) · VELO curve · NOTE curve · Macro 1–8 · Mod Wheel · Aftertouch · Poly Aftertouch · Pitch Bend · **Expr X (Pan) / Y (Timbre) / Z (Press.)** (MPE or VST3 note expression) · Release Velocity · Note-On Rand 1/2 (same value to all destinations) · **Note-On Rand (Discrete)** (different value per destination) · Note-On Alt 1/2 (toggle 0/1 per note; Alt 2 = inverse) · **Oscillators as sources** (OSC A/B/C, SUB, NOISE audio) · **Filter 1/2 outputs** · **Active Voices** (active ÷ POLY) · **Voice Index** (Voice-panel step ÷ active steps) · **Voice Mod 1/2** (Voice-panel step values) · Fixed. S1 Chaos 1/2 sources are gone (use Chaos LFO types). Drag an osc/filter label onto a knob to use it as a source.
- Preset source-ID numbering: mod.md/SMCP (1 Mod Wheel, 2–5 Env, 6–15 LFO, 16 Velo, 17 Note, 18 AT, 19 Poly AT, 20 Noise, 21–24 NoteOn, 25–32 Macro, 33 PB, 34–36 Expr, 37 RelVel, 38 Fixed, 49–52 Osc/Sub, 53–54 Filters, 55 Active Voices, 56–57 Voice Mod, 58 Voice Index, 59 NoteOn Rand Discrete) conflicts with another corpus inference (18 = Mod Wheel, 1 = Env 1) — only matters for preset import [low].

## B19. VOICING (S2) [high, S2M pp215–218]
- MONO, LEGATO (Mono off + Legato = paraphonic env behaviour), POLY (1–32, default 8 [med]), voice count incl. unison and **granular grains**.
- Right-click POLY: **Limit Same Note Poly to 1** · **Voice Steal Priority** ▸ **Newest** (steal earliest) / **Oldest** (steal most recent) / **Highest** (steal lowest) / **Lowest** (steal highest) / **Velocity** (steal lowest velocity) · lock. "Velocity Legato" (2.1.0) [low, unverified].
- Portamento: PORTA, CURVE, ALWAYS, SCALED (as S1; readout 1 decimal below 10 ms; Porta Scaling fix 2.0.19).
- Pitch bend Up/Down (P2 defaults +2/−2; ranges up 0…48, down −48…0 per S2S [med]).
- **Main Vol**: default **50 % = −9.0 dB** (P2) — S2 law differs from S1's n³; meter next to MAIN knob. [high]

## B20. VOICE CONTROL (Global page) [high, S2M pp316–319]
- Preset menu (factory/user; Init; save button). Oscillator selection toggles (A, B, C, N, S; all selected by default, green).
- **Per-voice sequencer**: click 1–8 to set sequence length; per-step SEQ values for Pan, Detune, Cutoff, Env (time), Mod 1, Mod 2 (Mod 1/2 feed "Voice Mod 1/2"; step feeds "Voice Index"). Lock Voice Sequencer option [med].
- **RANDOM**: PAN (%), DETUNE (cents), CUTOFF (%), ENVS (%) per voice (VST: Osc Detune Rnd, Osc Pan Rand, Env Rand, Cutoff Rand).
- **SCALING**: all-envelope time % and LFO scaling (by % or rate), 100 = neutral; LFO-time snap [med].

## B21. KEYBOARD panel [high, S2M pp267–273]
- **TRANSPOSE** −24…+24 st (arrows ±1, mouse wheel ±12); applies to incoming and generated MIDI.
- **KEY** and **SCALE** (large scale list; default Key "--" = off, Scale "Major"); applied to MIDI input and CLIP/ARP output; piano roll highlights in-scale notes.
- **SWING** (default OFF; once set, a **division** field appears, default 1/16); displayed in host convention (e.g. Live 12.5–87.5 %, FL −150…150 %); used by CLIP/ARP grids and LFO swing.
- **OSC MAPPING** editor: **KEY** and **VEL** (1–127) ranges per OSC A/B/C, Noise, Sub and ARP; drag edges or move range; double-click to type; **FOLD** (out-of-range notes folded into range instead of ignored); **WARP** (keep acting as warp source for other oscs outside its range).

## B22. ARPEGGIATOR [high, S2M pp244–266 unless noted]
- **12 arps per bank**; slots arranged like a keyboard; trigger by play button or ARP keyboard (key relaunches); slot right-click: Rename Pattern, Copy/Paste Pattern, Erase Pattern, Show Pattern Names.
- **GLOBAL**: BANK menu (factory/user, Init, Save Arp Bank; modified shows `*`), **LAUNCH QUANT**, **EDIT ALL** (Alt-edit = apply to all).
- **PATTERN**: **SHAPE** menu (internal list [med]: Played, Pattern, Chord, Converge, Diverge, Conv&Div, Down, Up, UpDown, DownUp, Up&Down, Down&Up, Thumb Up, Thumb UD, Rand, Rand Once, Rand Drift, Rand NoDup), **BPM/HZ** RATE (knob or field), **TRIP**, **DOT**.
- **Pattern editor** (SHAPE = Pattern): pattern presets (Init, Save, Rename); **LENGTH** (bars.beats.16ths); **MODE**: Normal, Reverse, Pendulum, Random, Rand Start, Rand End, One Shot, Static; **TIME** (random jump interval 1/16–4 bars); **STEP MODE**: Normal, New Only, Chord, Chord (new); **WRAP** (handling of steps beyond held-key count) with **PITCH** (0–24 st) and **RANGE**; graph editor like the piano roll (grid size, double-click note events, **Accent** lane, **Strum** lane, automation lanes incl. Expression X and per-step chance [med]).
- **TRANSPOSE**: **SHIFT** (± per repetition), **RANGE** (repetitions), right-click RANGE → shape: Up, Down, Up/Down, Down/Up, Up+Down, Down+Up, Thumb Up, Thumb UD, Pinky Up, Pinky UD, Converge, Diverge, Con+Diverge, Chord, Random, Rnd.NoDup, Rnd.Drift, Rnd.Once.
- **PLAYBACK**: **LATCH** (CC64 sustain controls latch while arp on), **THRU** (pass input notes), **OFFSET**, **REPEATS**, **GATE** (0–200 %, default 75 [med]), **CHANCE** (right-click **Pre**: apply before advancing).
- **RETRIGGER**: LAUNCH, RATE (+value), NOTE, FIRST.
- **VELOCITY**: enable, RETRIG, **DECAY**, **TARGET**.
- **MIDI OUT**: Off (default) / Clip Player / On. ARP menu: **Lock Module**, **MIDI Input Trigger Octave** (default lowest octave; Off). Right-click also has Poly Count / Voice Steal Priority (2.1.0) [low].
- VST params: Arp Enable, Rate, Shift, Range, Offset, Repeats, Gate, Chance, Retrig Rate, Velo Decay, Velo Target, Transpose, Wrap Transpose, Wrap Range, Wrap Phantom Note.

## B23. CLIP sequencer [high, S2M pp219–243]
- **12 clips per bank** (keyboard-like slots; CLIP keyboard triggers; green rhythm indicator). GLOBAL: BANK (Init / Save Clip Bank, `*` when modified), **TRIGGER MODE** MONO / POLY, **EDIT ALL** (Alt-edit).
- **Piano roll**: double-click add (newest orange) / double-click delete; marquee/Shift select; time-range select (copy/paste overwrites destination, splits notes); arrows move (↑↓ semitone, ←→ grid step, Shift ↑↓ octave, Shift ←→ shorten/lengthen); right-click/shortcuts: Cut ⌘X, Copy ⌘C, Paste ⌘V, Duplicate ⌘D, Delete ⌫, **Chop ⌘U**, **Conform to Scale ⌘K**, **Legato ⌘L**, **Mute 0**, **Quantize ⌘Q**, **Reverse ⌘R**, Scale Time 50 % `/`, 200 % `*`, **Double Entire Clip ⌘E**, Scale Entire Clip 50 % / 200 %, Select All ⌘A; note-preview (headphones) toggle; keyboard focus indicator (needs Keyboard shortcuts pref).
- Grid (default 1/16; drag or right-click menu); zoom button; Cmd-Opt-drag scroll, Shift-Opt-drag zoom, Shift-Cmd marquee zoom, wheel scroll/zoom; **Fold** (used notes; Cmd-click = scale + used); velocity/expression lanes; **multi-lane automation** incl. macros.
- Length flags (left/right) and **start offset marker** (right-click: **Wrap Clip to Begin Here**, **Quantize**).
- **Clip settings**: CLIP field (load/save/rename) · **LENGTH** · **KB SPAN** (Mono / Poly = transpose by played note rel. C3; **Offset** = start position per key; Off) · **TRANS** · **MODE** (incl. Random, Rand.No Dup, Rand.Start, Rand.End, **Static** (sends only start-position events; good for chord/macro snapshots) + slice TIME) · **RATE** · **LAUNCH QUANT** · **RETRIG** · **VELO TRIG** (scale by input velocity) · **NOTE GATE** (note-off stops clip).
- Slot right-click: Rename Clip, Copy Clip, Paste Clip, Erase Clip, **Set as Preview Clip** (browser preview).
- **Record**: OVERDUB (loop) / EXTEND (grow), metronome, record; new notes red → commit (green) / undo take / finish.
- **MIDI OUT**: Off / **Clip Player** (no key/scale quantize) / **On** (clip → arp → key/scale quantize). Drag clip to DAW [S2WN]. CLIP menu: Lock Module, MIDI Input Trigger Octave. VST: Clip Player Enable, Transpose, Rate, Offset.

## B24. GLOBAL page (S2) [high, S2M pp312–322]
### B24.1 Preferences
User Interface: Help Tooltips · Param value tooltips · Double-click params (reset vs type) · Mouse wheel param control (enable to deactivate) · Keyboard shortcuts · Default waveform view (2D default / 3D). MPE: MPE enabled by default · MPE Pitch Bend (also) maps to Expr X · MPE Expr Y acts bi-directional. General: Limit Mod depth on drop (based on knob value) · Mod Wheel → WT Pos (when WT Editor is open) · Silence note + FX tails when host transport stops · Load MIDI Map from Presets · Use Ultra quality when rendering · Automatically check for updates. Prefs-file-only: Ignore VST3 Note IDs (2.0.24), Fix Cubase Sustain Pedal (2.0.23), S1 ratings import toggle, Default Author, CCForRockers.
### B24.2 Voice Control — see B20.
### B24.3 Quality
**Draft = 1x, High = 2x, Ultra = 4x** oversampling + lock · **S1 Compatibility Mode** (auto-on for S1 presets; reproduces S1 DSP incl. warps/FX filter scaling) · **Disable Smoothing** (sample-accurate automation; smoothing also applies to mouse moves).
### B24.4 Tuning
Concert pitch (A4, drag/type; S1 range 430–450 [range for S2 unconfirmed]) · TUN FILE menu: Load Tuning / Clear Tuning (`.tun` overrides MTS-ESP) · **MTS-ESP** (enabled by default; "Enable MTS-ESP" toggle; **MTS-ESP Note-On Only**) · Step pitch mode for oscs · tuning lock.
### B24.4b MPE / expression
MPE switch (main menu) and "enabled by default" pref; Expr X/Y/Z sources; VST3 Note Expression when MPE is off (VST3 only); MPE values reset when a voice is stolen (2.0.24); "Ignore VST3 Note IDs" pref (2.0.24); XYZ/YZ→Macro and Y→Mod Wheel mappings; MPE Bend Range 1–96 (default 48). [high]
### B24.5 Version pane (build/date).

## B25. Main menu, presets, UI (S2)
- **Main menu** [high, S2M pp323–326]: About · Read the manual · Check for updates · **Init Preset** · **Init LFOs + LFO Mods** · **Init Modulations** · Load Preset · **Revert to Saved** · **Save as Default Preset** (`Presets/User/default.SerumPreset`; FX version `defaultFX.SerumPreset` with fallback) · Import Preset Pack · **Render OSC Warp** (selected osc) · **Resample to** (1 bar; selected osc or A and B) · Open Serum 2 Presets Folder · Rescan Folders on Disk · Load MIDI Map · Save MIDI Map (`System/MIDI CC Maps`; `Default.SerumMIDIMap` auto-loads) · Load Tuning (.tun) · **MPE Enabled** · **MPE: XYZ -> Macro 1,2,3** · **MPE: YZ -> Macro 1,2** · **MPE: Y -> Mod Wheel** · **MPE Bend Range: 48** (1–96 st). VST3 (non-MPE) responds to Note Expression (pitch ±120 st).
- **Header**: preset name menu `<` `>`; **ARTIST** and **DESC** fields; Save (disk; **Alt-click = overwrite silently**); **Embed** button; browser button; **Undo / Redo**; MAIN knob + meter; drag-export wave icon (left of logo; Alt-click opens Renders, Shift-drag exports saved preset); logo menu = **resize** (sizes, "Set x % as Default", Default 100 %), also drag lower-right corner.
- **Preset browser** [high, S2M App. B]: Folders pane; list with **preview play buttons** (embedded preview clip or one of 3 fallback clips; auto-preview option; → plays, ← stops, ↑↓ change preset); macros adjustable while previewing; search by name (Cmd/Ctrl-F, folder-scoped); CATEGORIES and TAGS tabs (match All/Any tags option; Alt-click excludes); Ratings filter (exact match; (no rating), (any rating)); metadata pane (artist, category incl. Custom, description, comments, date, tags with New tag); 1–5 star ratings; menu: Show Preset in Finder/Folder, **Load Random Preset** (key 7), **Hybridize** (4 random presets, key 8), **Hybridize Favoring Selected Preset** (key 9), rename/move/delete (Shift-Backspace), rescan, erase & rebuild database, **Create and Export a Pack**, "Re-import Serum 1 Data" (2.0.23); S1 categories/ratings import.
- **Prefs file** `Serum2Prefs.json` (macOS `~/Library/Preferences/`, Win `%APPDATA%\Xfer\Serum 2\`): "Default Author"; **"Enable CCForRockers"** 0/1 (CC) / 2 (notes) with "CCForRocker Preset +/−" and "CCForRocker OSC A/B/C/N +/−" (value ≥64 triggers; must drop <64 to re-arm).
- **Files** (`Serum 2 Presets`): Arp Banks, Clip Banks, Multisamples, LFO Shapes (`.XferShape`), Presets (`.SerumPreset`), Samples, System (formula files, MIDI CC Maps, User.dat), Tables (one subfolder level), Effect Chains (`.SerumFX`, `.SerumFXRack`), Renders [high]; IR storage folder name for Convolve not documented (IR paths look like `Factory/Long/…flac`) [low].
- **Keyboard shortcuts** (App. G): preset browser keys above; Shift-drag fine; Cmd/Ctrl-click reset; Alt-drag / Shift-Alt-drag module copy; Alt-click filter display cycles view; Alt-click add/remove slice; Alt-drag granular window button; Alt-F expand FX/matrix; Alt-click bypass = whole bus; LFO gestures; Shift-Alt-click toggles uni/bi; clip shortcuts (B23); WT editor: click-drag frame move, Shift-click range, Shift-Cmd/Ctrl-click phase nudge.

## B26. Serum 2 FX plugin [high]
Effect edition: default preset `defaultFX.SerumPreset` (fallback to default); **mono** build (AU 2.0.21); Noise osc **Audio Input**; Note Latch; default master volume fixed (removed +1.37 dB, 2.0.23).

## B27. Serum 1 compatibility [high]
S1 `.fxp` presets load (filters, warps, FX onto MAIN) with S1 Compatibility Mode auto-enabled; changelog fixes for S1 chaos-rate modulation scaling, FX-filter modulation scaling, PWM+FM/PD in S1 mode. S1 Chaos sources map to S2 equivalents [med]. S1 preset ratings/categories importable.

---

# PART C — Open questions, conflicts, and measurement plan
1. **Warp maths** (Bend, Asym, Mirror, Remap 3, Quantize step curve, Sync max ratio, PWM fill, FM/PD index scaling) — unpublished; tune by ear/measurement. [low]
2. **S1 sub shapes**: 5 (plugin enum) vs 6–7 (tutorials). Implement 5 for S1, 6 for S2.
3. **S1 sub level law**: linear (render) vs squared (S2 display).
4. **Unison**: per-mode spacing curves, Blend curve, WT-Pos/Warp spread scaling, gain table — partly measured only.
5. **FFT bin display scaling** (√amp inference) and whether bins above 512 exist.
6. **Noise**: factory folder list; keytracked pitch range; Noise Fine exact range.
7. **PNG import orientation** (S1 changelog vs S2M).
8. **Spectral warp UI names** — IDs known (B8.6), labels not; read from plugin.
9. **Filter Var** for plain Cmb±, Flg±, Phs 12–48± and FPhs: undocumented (likely unused or Fat-like).
10. **Key-track reference note** (assume C3/MIDI 60).
11. **Filter DSP topologies** (Fat, Drive curves, formant tables, Combs tunings) — only partial measurements.
12. **Envelope curve semantics** (50 = linear?) and S2 display 40/60/60 vs stored 50/66.6/66.6.
13. **LFO grid range**, S1 default LFO mode (Off per format reader [med]).
14. **S1 reverb slot defaults** (P1 vs later dump), Plate pre-delay range, default algorithm.
15. **Compressor**: S1 multiband crossovers; S2 hidden per-band ratio/deadband/up-down bypass UI.
16. **Flanger FEED polarity**, Hyper RATE in Hz, Dimension topology.
17. **S2 DC-bias distortion control** location; reverb kAbyss/kSpace ↔ Nitrous/Basin mapping.
18. **S2 2.1.x claims** (K35 filter, Velocity Legato, arp Poly Count menu, Note-curve tuning option) — not in any changelog obtained (latest 2.0.24); verify against a 2.1.x build.
19. **S2 Main Vol law** (50 % = −9 dB) and concert-pitch range.
20. **Matrix source IDs** for S2 preset import (two conflicting reverse-engineered tables).
21. **Arp SHAPE menu exact labels** (only internal list available) and arp/clip param ranges (P2 shows only normalised 0.0 defaults).
