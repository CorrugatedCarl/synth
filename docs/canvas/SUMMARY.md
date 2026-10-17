# SYNTH Canvas: the plan in plain words

This is the short version of [SPEC-canvas.md](SPEC-canvas.md). Everything happens on the `canvas` branch and at **canvas.domlavin.com**. The live site, synth.domlavin.com, stays exactly as it is, so you can always go back.

## What you'll get

**One big canvas per track, framed by trays.**
- **Top tray**: your header, transport and track list in one row. Pull its handle down to show track rows and the arrangement buttons (Copy, Paste, Insert bars…).
- **Bottom tray**: the keyboard, as today.
- **Left tray, "Sources"**: small drawings of each synth (Minimoog with wood sides, TB-303 as a silver box…), Serum's parts and the modulators. Tap the tray's edge to open it and drag things onto the canvas. The tray slides shut while you drag.
- **Right tray, "Effects"**: FX panels and single effects.
- **The canvas**: scroll it in any direction and zoom out to see everything. Every module has the same top bar (power, name, preset, CPU, menu, fold). Drag the bar to move the module.
- **Piano roll** stays its own tab: `CANVAS │ ROLL`.

**Sound flows left to right**: modulators → synths → FX panels → OUT. Each track ends in one OUT, its "one sound".

**Several synths per track.** Drop a Juno next to a Minimoog and both play.
- Each one has a power button.
- Cable each one into its own FX panel or into the same one.
- Each synth can also be limited to part of the keyboard, for splits.

**Patch cables you can see.** Thick cables carry sound. Thin coloured cables carry modulation and end on the knob they move. By default you see all of them; when there are too many, the ones you're not working on fade.

**Modulators you can drag anywhere.**
- **LFO**: drop it anywhere and cable it to any knob on any synth or effect. It starts as GLOBAL, one wave in sync everywhere. Switch it to PER NOTE to restart it on each note.
- **ENV**: an envelope you can cable to any knob.
- **Mod Wheel**: there is **one for the whole project**. It appears on every track's canvas, and the keyboard's wheel moves every knob it's cabled to, on every track.
- **Velocity, Aftertouch, Bend, Macro (8 knobs), CC** (a knob on your MIDI controller).
- On Serum, envelopes and per-note LFOs really run per note. On classic synths and effects they follow the most recent note you played, and the cable is dashed. Truly per-note behaviour on classic synths comes later.

**Serum taken apart.** OSC A/B/C, SUB, NOISE, FILTER 1/2, LFOs and ENVs become separate modules you cable together. My suggestion for the parts you weren't sure about:
- A **VOICE** module is the heart of each Serum. It holds the notes (poly/mono/legato, glide, bend) and the amp envelope, which decides when a note ends.
- **Envelopes 2–4 and the LFOs float free.** Cable them to anything, even knobs on other synths.
- **Each Serum keeps its own FX**, because Serum's master volume and Bypass live there. Its output can then go into a shared FX panel with other synths.
- One Serum holds at most 3 oscillators, 1 sub, 1 noise and 2 filters. A 4th oscillator makes "Serum 2". Cabling an oscillator into another Serum's filter moves it there.
- You can always switch back to today's all-in-one Serum view.

## The order it arrives in (your three milestones)

| Step | What you'll see on canvas.domlavin.com |
|---|---|
| 1a | Today's app with its own separate storage. I'll ask you to run the speed test on your iPad |
| 1b | The canvas and trays, with today's synth and FX as movable modules |
| 1c | A minimap, box-select, and "Save as classic project" to take a song back to the live site |
| 1d | Same sound, with CPU shown per module (the engine is reorganised inside) |
| **1e** | **Milestone 1 done**: several synths per track, cabled into shared or separate FX panels |
| 2a | The Mod Wheel, Velocity, Aftertouch and Bend modules on Serum knobs |
| **2b** | **Milestone 2 done**: LFOs, envelopes, macros and CC on any Serum knob, any effect knob and most classic-synth knobs |
| **3** | **Milestone 3 done**: Serum taken apart into separate modules |
| later | More patching, per-note modulation on classic synths, polish |

Every step keeps the app fully working, and every sound you already have stays exactly the same.

## Questions for you

1. **Pinching the canvas.** My suggestion: a pinch on the canvas zooms the canvas, so you can zoom out to see everything. A pinch over the trays still zooms the page like today, and if the page is zoomed in you can always pinch back out. The other option: normal page zoom everywhere, with the canvas zoomed only by buttons. Either is one switch in settings.
2. **FX panels.** Is a panel a pedalboard of several effects in a row (my suggestion), or should every effect be its own module?
3. **Serum limits.** Are 3 oscillators, 1 sub, 1 noise and 2 filters per Serum OK, with a 4th oscillator starting "Serum 2"?
4. **Which knobs can be modulated, and when.** Is this order OK?
   - Step 2a: wheel, velocity, aftertouch and bend on every Serum knob.
   - Step 2b: everything on every Serum knob, every effect knob, and 237 of the 425 classic-synth controls (filters, levels, tuning, pulse width, envelope times, LFO rates, glide…).
   - Later: the other 179 classic controls.
   - Never: 7 switches that change how a synth is built, like unison mode or the DX7 algorithm.
5. **Modulation cables.** Show them all the time (my suggestion), only for the selected module, or never?
6. **Your saved sounds.** The new site starts empty: your saved presets, FX chains, wavetables and settings stay on the live site. Songs move by saving on the live site and opening on the canvas site. For everything else, I can add one small "Export library" button to the live site (the only change there) and an "Import library" button on the canvas site. Or you start fresh on the canvas site. Which do you prefer?
7. **Undo for knob turns.** Should turning a knob be undoable, like moving modules and cables?
8. **Mouse on the Mac.** Should dragging empty canvas pan it (my suggestion, with Shift-drag to box-select), or should dragging select?
