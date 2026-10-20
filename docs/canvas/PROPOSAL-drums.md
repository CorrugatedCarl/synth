# Drum machines on the canvas: a proposal (stage 7)

You asked for drum machines (ROADMAP stage 7) and, after them, a pad controller (stage 8). This page is my suggestion for how to start,
in plain words, from a research pass on 2026-10-20. Nothing is built yet. The five questions at the end are what I need from you; each
has my recommendation, so "yes to all" is a valid answer.

## In one minute

- **Start with four machines: the Roland TR-808, then the TR-606, then the TR-909, then the Simmons SDS-V** (built together with the
  pad controller).
- Each one is a module on the canvas with its **real front panel**, a **working sequencer on that panel** (like the TB-303's),
  **playable pads**, and an **output you cable** like any synth. A new **Drums** view in the Sources tray holds them.
- The 808 is the big first step, because it lays the foundation every other drum machine reuses. After it, each machine is much smaller.
- Proposed timing: right after milestone 3 and the hardware keyboards (1i) ship.

## 1. Which machines first, and why

There are two kinds of classic drum machine, and they need different approaches.

- **Analog machines make their sound with circuits.** This is what the app already does for its 12 synths: we rebuild the circuit,
  part by part, from published facts. Nothing is copied, and the result can be as close to the real machine as our synths are.
  Examples: TR-808, TR-606, CR-78, Korg KR-55, the Simmons SDS-V, and most of the TR-909.
- **Sample-based machines play back recordings stored on chips.** Examples: LinnDrum, Oberheim DMX, E-mu SP-1200, TR-707, Akai MPC.
  Their sound is mostly those recordings, and the recordings belong to someone else, so we can't ship them. We *can* rebuild faithfully
  how each machine played its sounds back: its gritty 8- or 12-bit converters, the way it changed pitch, its filters. Then we feed that
  chain **our own original drum sounds**, plus a slot to **load your own** (several of these machines really did swap sound chips).
  That is honest and has real character, but it won't sound exactly like the famous records. So these come later.

**The recommended first set**

| # | Machine | Why |
|---|---|---|
| 1 | **Roland TR-808** (1980) | The most famous drum machine there is: hip-hop, electro, trap ("Planet Rock", "Sexual Healing"). 100 % analog. It is also the best-documented: Stanford researchers published detailed studies of its kick, cymbal and hi-hat circuits. For example, the kick's punch comes from a tiny pitch jump in its first 6 milliseconds. It has 11 sound slots: kick, snare, three toms that switch to congas, rim shot / claves, clap / maracas, cowbell, cymbal, open and closed hat. |
| 2 | **Roland TR-606** (1981) | Built as the **TB-303's partner** and sold beside it. It is a small job: 7 sounds made by a cut-down version of the 808's circuits, which we will already have. With the 303 that's already in the app, you get the classic acid pair. |
| 3 | **Roland TR-909** (1983) | The sound of house and techno. Its kick, snare, toms, rim shot and clap are analog, so we can model them faithfully. Its hi-hats, crash and ride were short recordings. For those we keep the 909's real playback circuit and feed it our own metallic sounds, clearly labelled as ours (question 2). |
| 4 | **Simmons SDS-V** (1981) | The hexagonal-pad electronic drum kit of the 80s (Genesis, Def Leppard). An analog drum *synth* with no sequencer: you play it from pads. That makes it the natural first instrument for the pad controller, so it is built together with stage 8. |

**After that:**
- **CR-78 and Korg KR-55.** Analog "preset rhythm" boxes with built-in rock / bossa / disco patterns. The CR-78 is on "In the Air
  Tonight" and the KR-55 on early Depeche Mode. One shared engine covers both.
- **LinnDrum, Oberheim DMX, E-mu SP-1200.** Sample machines, done the honest way described above.
- **TR-707, Yamaha RX, Alesis HR-16.** Last.

**Staying on the right side of the line.** Roland has objected to a software 808 before: Propellerhead's ReBirth was withdrawn in 2017.
So we keep to the app's existing rules:
- the circuits are modelled from published facts;
- the panel drawings are our own, with no logos;
- no recordings from any machine are used.

## 2. What a drum machine module is on the canvas

```
┌ TR-808 ───────────────────────────────────────── ⏻ ⋯ ▾ ┐
│  the real front panel, drawn to scale:                 │
│  12 columns of knobs · tempo · pattern / track         │  ● MIX OUT ──▶ FX panel ──▶ OUT
│  selectors · 16 step keys in red / orange / yellow /   │
│  white · start / stop · A / AB / B variation           │
├ extras strip ──────────────────────────────────────────┤
│  step grid: every sound × 16 steps · swing · sync      │
│  pads: BD SD LT MT HT RS CP CB CY OH CH · → Piano roll │
└────────────────────────────────────────────────────────┘
```

- **One per track, like a synth.** A drum machine is a track's instrument. Put the 808 on its own track beside your 303 track; both
  follow the project's tempo and play button, so they stay locked together.
- **The real front panel**, at the same true-to-size scale as the synths (2 px per mm), redrawn by us, with every knob working.
  - Controls we don't emulate are dimmed, as on the synths.
  - The 808 takes about as much screen as the Prophet-5 panel and half as much as the ARP 2600, so it fits the iPad as the synths do.
- **The sequencer is on the panel, as with the TB-303.** The step keys, instrument selector and pattern switches work like the real
  machine's. On the 808 that means patterns in 1st / 2nd parts, A / AB / B variations, fills every 2 to 16 bars, and the rhythm-track
  song mode.
- **An extras strip below the panel**, like the 303's, for things the hardware didn't have:
  - a grid showing every sound × 16 steps at a glance, tap to toggle;
  - swing, and sync to the song;
  - **→ Piano roll**, which writes the pattern into the track as notes.
- **Playable pads.** One pad per sound in the extras strip.
  - Several fingers at once work.
  - Where you touch a pad sets how hard you hit it (front edge = loud), the same as on the 1i keyboards.
  - On the 909 the real step keys also work as tap pads, as on the hardware.
- **Accent the real way.** On these machines a harder hit isn't just louder: a stronger trigger changes the tone inside the circuit.
  We model that.
- **Played from anywhere.** The keyboard tray, a MIDI keyboard and the piano roll play the drums through the standard drum note map
  (kick on C1 = 36, snare 38, closed hat 42 …).
- **Outputs.**
  - The machine's mix output is cabled into the track's FX panel and on to OUT, like any synth.
  - The real per-sound output jacks are drawn on the panel; question 4 asks when they should become separately cable-able.
- **Modulation and MIDI learn.** Drum knobs join the existing canvas LFOs, envelopes, macros and MIDI learn, like the synths' knobs.
- **A "Drums" view in the Sources tray.** The dropdown becomes Hardware · Simple · Serum · Drums. Each machine gets its own original
  drawing; tap or drop one to use it.
- **Same sound guarantee.** Every sound you already have stays exactly the same; drum machines are new code beside the synths.

## 3. How it ties to the pad controller (stage 8)

The pad controller (a resizable grid of lit pads with full custom mapping) is designed around the drum machines.

- **Every drum sound is a pad target.** For example, "808 · Snare" or "909 · Clap". The pad's velocity becomes the trigger strength,
  so a hard hit gets the real accent tone.
- **Pads light up** when their drum plays, including when the drum machine's own sequencer plays it.
- **A hardware pad controller** (via MIDI learn) maps onto the same targets.
- **Hitting pads while a pattern runs** can record into the machine's pattern (like the 909's tap write) or into the piano roll.
- **The Simmons SDS-V** has no sequencer and was made to be played from pads, so it is built with stage 8 as its first instrument.
- **One shared language.** The keyboard, the piano roll, the drum machines and the pads all use the same drum note map, so a pattern
  made one way can be played or edited the other ways.

## 4. Effort and order

| Step | What you get | Size |
|---|---|---|
| **7a** | **Drum foundation + TR-808**: the new drum instrument type, the sequencer with the 808's own rules, the Drums view, pads, the drum note map, → Piano roll, the 808's 11 sound circuits and its panel. One extra research pass first, to pin down the circuit values the published studies don't cover (snare, toms, clap, rim shot). | **Large**: about the size of stage 2b |
| **7b** | **TR-606**: its panel and rules on the 808's circuits | **Small** |
| **7c** | **TR-909**: new kick / snare / tom circuits, the hi-hat and cymbal playback chain with our own sounds, its bigger sequencer (shuffle, flam, accent per step) | **Medium**: about two thirds of 7a |
| **7d + 8** | **Simmons SDS-V together with the pad controller** | Small for the SDS-V; stage 8 is its own size |
| later | CR-78 / KR-55, then LinnDrum / DMX / SP-1200, then the rest | one at a time |

- **When.** After milestone 3 and the hardware keyboards ship, before stages 4–6. The 808's sound circuits touch no shared files, so
  that part can start sooner, beside milestone 3. The panel, sequencer and canvas parts wait for milestone 3's merge.
- **Process.** The usual one: contract, parallel builders, review, fixes, every test file one at a time, deploy. As with every stage,
  I'll ask you to run the iPad speed test.
- **CPU isn't the hard part.** A rough test puts a whole 808 with every sound ringing at once at about two Prophet-5 chords. Real
  patterns cost much less, because drum hits are short and silent sounds cost nothing. The real work is getting the circuit details
  right and the sequencers' feel.

## 5. Questions for you (with my recommendation)

1. **Order and timing.** TR-808 → TR-606 → TR-909 → Simmons SDS-V (with the pad controller), starting right after milestone 3 ships?
   *Recommended: yes.* If one machine matters more to you (the 909 for house, the LinnDrum for 80s pop), say so. The foundation gets
   built with whichever comes first.
2. **Sounds that were recordings.** On the 909 (hats, crash, ride) and later the sample machines: our own original sounds through the
   machine's real playback circuit, clearly labelled "ours, not the original recordings", plus "load your own sounds"?
   *Recommended: yes.* It's the only honest option. It won't be identical to the record, but it will have the machine's character.
3. **Authentic limits or modern conveniences?**
   - The real 808 records one sound at a time when you tap.
   - Its paired sounds (tom / conga, rim / claves, clap / maracas) share a slot and can't play together.
   - The 606 has no tune or decay knobs.

   *Recommended: the panel behaves exactly like the real machine; the modern helpers live in the extras strip and start neutral* (the
   all-sounds step grid, swing on the 808, tune / decay for the 606, mute / solo). Same idea as the 303.
4. **Separate outputs per drum.** The real 808 and 909 have an output jack for each sound, so you can put effects on just the snare.
   *Recommended: start with the mix output, with the per-sound jacks drawn; make them cable-able when cables become editable again
   (full patching, stage 4).* Alternative: a "split to tracks" option sooner, putting each drum on its own track with its own effects.
   That's more work and bends the one-instrument-per-track rule.
5. **Drums in the piano roll and arrangement.** *Recommended: both ways.*
   - The pattern lives in the machine (its own sequencer, as on the hardware).
   - **→ Piano roll** writes it out as notes on named drum rows (Kick, Snare, Closed hat …) for editing and arranging.
   - Notes in the roll play the drums directly.

**Smaller choices I'll make unless you say otherwise**
- **No "every unit sounds slightly different" variation by default.** Real 808s differ because their parts drift; this could be an
  optional "unit character" control later.
- **Panels at real size only at first.** No compact Simple layout at first; one can be added like the synths have.
- **No separate sync cable between machines.** Everything already follows the one project clock, so the 606 and the 303 stay locked.
- **No hardware modifications.** Known 808 mods (wider accent, longer kick decay) are left out.

## Where the details are

The full research (sources, circuit numbers, each machine's panel layout and sequencer rules, a difficulty table and the CPU test) is in [research-drums.md](research-drums.md).
