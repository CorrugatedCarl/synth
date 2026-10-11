# SPEC-serum — Serum-style instrument + FX rack: implementation contract (v2)

Binding contract for six engineers working in parallel (E1–E6) and the later integrator. Read §0 completely before anything else. Every table here is normative unless a row is marked **IMPL-free** (engineer's choice within the stated constraints). v2 incorporates the coverage and contract reviews; the **Review log** at the end lists every review point and where it was resolved.

- Precedence: **this spec** > `ARCH.md` (only where §0.3 says so) > `serum-inventory.md` (feature authority; cited as "inv A3", "inv A20.4.6", …). Part A of the inventory is in scope except the ARCH.md exclusions (preset-browser extras: ratings, comment column, prune, hybridize; skins/zoom/resize; MIDI CC map files; drag-export; default.fxp; MPE behaviour; tuning files) and the deviations in §0.3.
- Where Serum's maths is unpublished the formulas below are **normative for this project** (marked IMPL in the inventory). Do not "improve" them silently — tests on both sides of every interface depend on them.
- MUST / SHOULD / MAY carry their usual meaning.

---

## 0. Ground rules

### 0.1 Files, owners, module kinds

| File | Owner | Kind | May import | Exposes |
|---|---|---|---|---|
| `serum-core.js` | E1 | ES module, pure (no DOM, no timers), node-importable | nothing | named exports §8.1 |
| `wt.js` | E2 | ES module, pure, node- and Worker-importable | nothing | named exports §8.2 |
| `wtstore.js` | E2 | ES module, browser only (IndexedDB) | `wt.js` | named exports §8.3 |
| `wtedit.js` | E2 | ES module, browser | `wk.js`, `wt.js`, `serum-core.js` | `WTEditor` §8.9 |
| `serum-dsp.js` | E3 | classic script, **no import/export**, whole-file IIFE (§0.2) | nothing | `globalThis.SerumDSP` §8.4 |
| `fx-dsp.js` | E4 | classic script, **no import/export**, whole-file IIFE (§0.2) | reads `globalThis.SerumDSP` lazily (inside functions, never at load) | `globalThis.FXDSP` §8.5 |
| `wk.js` | E6 | ES module, browser (pure helpers node-importable) | nothing | widget kit, `contextMenu`, `tooltip`, `injectStyles`, `setPrefs`, `loadDSP` §8.7.1 |
| `graph.js` | E6 | ES module, browser (pure `pts` helpers node-importable) | `wk.js`, `serum-core.js` | `CurveEditor`, `EnvEditor`, `pts` §8.6 |
| `fx-ui.js` | E6 | ES module, browser (pure helpers node-importable) | `wk.js`, `graph.js`, `serum-core.js` | `FXRackUI` §8.7.2 |
| `serum-ui.js` | E5 | ES module, browser (pure helpers node-importable) | `serum-core.js`, `wt.js`, `wk.js`, `graph.js`, `fx-ui.js`, `wtedit.js` | `SerumUI`, `PresetBrowser`, pure helpers §8.8 |
| `tests/*.test.mjs`, `tests/fixtures/*` | each owner for own module; fixtures E1 (M1) | `node --test` | see §10 | — |
| `engine.js`, `models.js`, `main.js`, `song.js`, `index.html`, `style.css`, `tests/integration.test.mjs` | Integrator (later) | existing | — | §11 |

Import graph (acyclic): `wk ← graph ← fx-ui ← serum-ui`; `wk ← wtedit ← serum-ui`; `serum-core` and `wt` are leaves. Develop against this spec and stub the other side until it lands.

**Browser modules** (`wk.js`, `graph.js`, `fx-ui.js`, `serum-ui.js`, `wtedit.js`, `wtstore.js`) MUST NOT touch `document`, `window`, `localStorage`, `navigator`, `indexedDB` or `customElements` at module top level — only inside functions and constructors — so node can import them for the pure-helper tests.

### 0.2 Code rules (all files)
- Site style: 2-space indent, semicolons, single quotes, no dependencies, no build step, ES2020.
- No `eval`, `new Function`, `with`, string-to-code of any kind (the formula parser is an AST interpreter).
- **DSP script shape** (`serum-dsp.js`, `fx-dsp.js`): the whole file is one IIFE; nothing is declared at top level:
  ```js
  (function () {
    'use strict';
    const prev = globalThis.SerumDSP;                       // idempotent re-evaluation
    try {
      const tables = (prev && prev.tables) || new Map();     // the wavetable Map MUST survive re-evaluation
      /* … every declaration lives here … */
      globalThis.SerumDSP = Object.freeze({ /* exports §8.4 */ });
    } catch (err) {
      globalThis.SerumDSP = null;                            // a load failure never throws out of the script
      console.error('serum-dsp: load failed', err);
    }
  })();
  ```
  The scripts are evaluated in three places — the AudioWorkletGlobalScope (`addModule`, module scope), the main thread (`<script>` injected by `loadDSP`, shared classic global scope) and node `vm` contexts — and the IIFE makes them collision-free and re-evaluable in all three. `fx-dsp.js` follows the same shape with `globalThis.FXDSP`.
- **Environment neutrality**: the DSP scripts MUST NOT reference `sampleRate`, `currentTime`, `currentFrame`, `registerProcessor`, `AudioWorkletProcessor`, `window`, `document`, `self`. All rates arrive through constructor/`proc` arguments. They must not use `instanceof` against typed-array constructors or `Array` (test arrays come from another realm): use `ArrayBuffer.isView` / `Array.isArray`.
- DSP hot paths: all state in typed arrays or numeric fields initialised in constructors (monomorphic shapes); **no allocation** per sample/chunk/span/`render`/`process` (allocate in constructors, `attach`, `apply()`, `set()`, `storeWT`, `setType`); no closures, `arguments`, destructuring, `try`, array literals or `Array.prototype` iteration inside render loops; patch scalars are copied into constructor-initialised numeric fields in `apply()`/`set()`/`begin()` and never read from the patch object in hot loops (structured-clone numbers flip representation and deoptimise, see engine.js §"patch normalisation"); feedback states flushed: `if (Math.abs(s) < 1e-30) s = 0` at least once per span per state.
- **Transcendental approximations** are allowed in per-sample paths provided: warped phase within 1e-5 absolute of the exact §3.3 formula, `tanh`/`sin` within 1e-4, `exp2`/`pow` within 1e-6 relative; neutral settings MUST be exact (warp K = 1 or I = 0 ⇒ φ' = φ bit-for-bit, i.e. the warp is skipped). Recommended: polynomial `exp2`/`log2` (engine.js already has a table `exp2`), per-chunk phase-map tables for Bend/Asym/Mirror.
- Main-thread pure modules: functions MUST NOT mutate their inputs unless the doc says "in place".
- Randomness in DSP comes from internal xorshift32 generators seeded deterministically (processor seed and voice index, like engine.js `AVoice`), never `Math.random`, so offline renders and tests are reproducible. Main-thread generators (factory content, `sort.random`) use the seeded PRNGs named in this spec.
- Supported host ranges: `proc.base` 22.05–192 kHz, `proc.OS` 1/2/4/8 (internal rate ≤ 384 kHz), render calls of 4–128 base frames (multiples of 4).

### 0.3 Deviations from ARCH.md (decided here, binding for the integrator; items 9–10 need the lead's sign-off)
1. **`patch.fxr`, not `patch.fx`.** The engine's existing `p.fx` (`FxP`: chorus/ensemble/hiss of the analog models) would collide. The compiled FX rack for every track travels as `patch.fxr` (§4.2). Large curve tables travel beside the patch as `patch.serumT` / `patch.fxrT` and are sent only when their content key changes (§4.1, §4.2, §11).
2. **Direct-out bus.** Sub/Noise DIRECT OUT bypass filter *and* FX (inv A1, A7, A8). Voice signature becomes `render(bufL, bufR, N, dirL, dirR)`; `dirL/dirR` are a second OS-rate stereo pair supplied when `CP.direct === 1` (else `undefined`; if they are absent while `CP.direct = 1` — main-thread tools, tests — voices add the direct sources to `bufL/bufR` after the filter). The engine decimates the pair and passes it to `FXRack.process(L, R, n, dL, dR)`.
3. **Master volume and Bypass are post-FX** (inv A1, A18, A16.5): FX-segment destinations `g.master` (fx idx 0) and `g.bypass` (fx idx 86), applied by the rack's output stage. `compileFx(fx, { master, bypass })` receives Serum's values; non-Serum tracks pass nothing (gain 1, not bypassed).
4. **Table transport** carries a `kind` (`'wt'` | `'noise'`). Sub shapes and noise sources travel through the same `{t:'wt'}` message (ids `sub:*`, `noise:*`, `nzuser:*`). Extra messages main→worklet: `wtf`, `wtdel`, `smon`, `fxph`, `pat`; `off` gains `rv`. Worklet→main: `smon`, `fxph` (§11).
5. **FXRack** gains `set(null)`, `trigger()`, `reset(soft)`, `idle()`, `gr()`, `phases()`, `transport()`, `warmUp()`, `latency` (§8.5).
6. **New file `wk.js`** (widget kit + shared browser infrastructure, owner E6). Ownership differs from ARCH's grouping: `graph.js` → E6, `wtedit.js` → E2 (it is mostly `wt.js` operations), E5 keeps `serum-ui.js` (incl. the preset browser).
7. **DSP scripts run on the main thread too** (UI displays use the real code: filter response, warp preview, Render OSC Warp, distortion transfer curve, EQ/delay-filter curves).
8. **Poly AT and release velocity come from the host** (new `pat` message, `off.rv`, §11). **MPE X/Y/Z** keep their source slots but read 0 (MPE excluded).
9. **Oversampling = the Serum track's processor OS.** A Serum track's processor runs at `min(CP.os, osCap(base))`; the app-wide oversampling setting and the CPU safeguard (`lowerOS`) do not apply to Serum tracks; voices have no internal oversampling (§6.9). Consequence: the plain (unwarped) oscillator also runs at that rate; mip-maps keep it alias-free at every setting, but at 1x some pitches lose part of the top audible octave (§7.4) whereas Serum's plain oscillator is "always max quality" (inv A3).
10. **LFOTool `.shp` shape files are not supported** (undocumented binary format). Shapes are saved/loaded as JSON (`synth.sx.shapes` library shared by LFO, Remap and X-Shaper editors, plus JSON file import/export).
11. **Engine contract refinements** (ARCH "Engine host contract"): `render` spans are ≤ 128·OS frames and MUST work without a preceding `begin`; Serum processors pre-allocate 32 voices and never rebuild them on POLY/mono changes; the names `pitch`, `target`, `glc`, `det` on a voice are engine-owned; `noteOff(rv)` carries release velocity; `proc.songBeat()` is computed from the start frame of the current span; per-processor Serum state is created by `SerumDSP.attach(proc)` (§8.4).
12. **Preset objects** are `{ name, cat, v: { s }, fx }` (adds `cat`); exported preset/project files additionally carry `wts` (embedded user tables, §7.10).

**Lead sign-off on items 9–10 (binding):**
- Item 9 APPROVED WITH CHANGE: a Serum track's processor OS = `min(CP.os, osCap(base), autoCap)` where `CP.os` is Serum's Global quality (1x/2x/4x), `osCap(base)` keeps the internal rate ≤ 384 kHz, and `autoCap` is the app's CPU-safeguard cap (main.js may lower it when the summed DSP load stays high; it never raises a Serum track above its own quality). The app-wide oversampling *selection* does not apply to Serum tracks. The mip-map level rule (§7.4) must keep as many harmonics below the OS-rate Nyquist as possible so 1x loses as little top octave as the octave-spaced levels allow (use a finer level step or a crossfade between adjacent levels if needed to avoid audible level jumps while gliding).
- Item 10 APPROVED as written.

### 0.4 Notation

| Symbol | Meaning |
|---|---|
| `n` | normalised knob value ∈ [0,1]. **Every destination parameter is stored as `n`.** |
| `v = law(n)` | engine value (Hz, s, gain, semitones …) per §3.1 |
| base / eff | user-set `n` / `n` after modulation (`clamp(base + Σ offsets, 0, 1)`) |
| `proc` | the host `SynthProcessor` (fields in §8.4.1) |
| `fs` | `proc.fs` = OS-rate = `proc.base · proc.OS` |
| chunk | `proc.CH = 4·OS` OS-rate frames (= 4 base frames) — the control-rate step |
| span | one `renderSpan` call: `n` base frames (multiple of 4, ≤ 128) = `N = n·OS` OS frames = `nCh = N/CH` chunks (≤ 32) |
| voice | one `SerumVoice` (one note) |
| unison voice | one of 1–16 oscillator copies inside a voice |
| `bend(t, k)` | the single curve function used everywhere (§4.4) |
| `MIDI0` | `440·2^(−69/12)` = 8.175798915643707 Hz (MIDI note 0) |

### 0.5 Milestones and parallel work

| Milestone | Content | Owners | Unblocks |
|---|---|---|---|
| **M1** (first, small) | `serum-core.js` constants (§3), `defaultSerum`/`normalizeSerum`/`compileSerum`/`defaultFx`/`normalizeFx`/`compileFx`, `lawValue`/`lawNorm`/`fmtParam`; `tests/fixtures/` = `dests.json`, `filters.json` (copied verbatim from `exp/fixtures/` next to this spec, generated by `exp/gen.mjs` from the same source as §3.4/§3.13; `gen.mjs` is copied to `tests/fixtures/` too), `cp-default.json`, `ct-default.json`, `fxp-default.json` (compiled defaults; typed arrays encoded as `{"$t": "Float64Array", "v": [...]}`) | E1 | everyone |
| M1 | `wk.js` minimal: `knob`, `menu`, `toggle`, `contextMenu`, `injectStyles`, `loadDSP` with the final signatures | E6 | E5, E2 (wtedit) |
| M1 | `serum-dsp.js` skeleton: IIFE, constants (`DIDX`/`FIDX`/`SIDX`/`LAW_TAB`/`SRC_POL`), `SFilter` stub with the full API implementing only MG Low 12, `filterImpulse` | E3 | E4 (FX filter), E5/E6 displays |
| M2 | full modules in parallel: `wt.js`/`wtstore.js`/`wtedit.js` (E2), `serum-dsp.js` (E3), `fx-dsp.js` (E4), `serum-ui.js` (E5), `graph.js`/`fx-ui.js`/rest of `wk.js` (E6), `serum-core` helpers (E1) | all | M3 |
| M3 | `FACTORY_PRESETS` (≥ 24) authored by listening through the integration harness after E3 + E4 land (E1); factory table polish (E2); integration (§11) | E1, E2, integrator | release |

---

## 1. Signal flow (normative)

Per **voice** (all stereo, OS rate):

```
                       ┌── routed (eff f.route[A,B,N,S] and eff f.on) ──► FILTER (SFilter, stereo) ──► wet/dry by f.mix ──┐
OSC A ─ unison sum ─┐  │                                                                                                    │
OSC B ─ unison sum ─┼──┤                                                                                                    ├─► × ENV1 × AMP ─► bufL/bufR (main bus)
SUB  (mono→pan) ────┤  └── not routed (or filter off), and not direct ───────────────────────────────────────────────────────┘
NOISE (stereo) ─────┘
SUB / NOISE with DIRECT OUT on ────────────────────────────────────────────────────────────────────────────► × ENV1 × AMP ─► dirL/dirR (direct bus)
```

- Each source is multiplied by its on-gain (eff `a.on`/`b.on`/`s.on`/`n.on`), LEVEL law and PAN (balance) **before** routing. ENV 1 is hard-wired to the amplitude of every source (inv A1) and is applied **after** the filter (so filter resonance rings with the note and dies with ENV 1).
- Switch destinations (on, route) act as gains ramped linearly over one chunk when their eff value flips (no clicks); a source whose on-gain is 0 for a whole chunk is not rendered.
- FILTER off ⇒ routed sources go to the dry path unchanged.
- A DIRECT source never enters the filter, even if its route is on (inv A7: "if off and S routed, sub is filtered").
- Per **processor**: Σ voices main bus → decimate (engine) → `FXRack.process` (modules in user order, §8.5) → + decimated direct bus → × master (`g.master`) × bypass gate (`g.bypass`) → engine DC block / limiter.

---

## 2. Serum state schema — `defaultSerum()`

Stored at `track.vals.s`; presets are `{ name, cat, v: { s }, fx }`. Plain JSON (no typed arrays, no `undefined`, no `NaN`). Typical size < 24 KB; MUST stay < 256 KB (worst case with every graph at `MAX_PTS` ≈ 200 KB; user wavetables are referenced by id, never embedded here).

### 2.1 Skeleton with defaults

```js
{
  v: 1,                                  // schema version (§4.3)
  author: '', notes: '',                 // inv A2.1 (≤ 64 / ≤ 2000 chars)
  p: { /* every SYNTH-segment DEST id (§3.13, idx 0–147) + 'g.master' (idx 148) + 'g.bypass' (idx 234) → n */ },
  osc: [                                 // [0] = OSC A, [1] = OSC B
    { wt: 'factory:Default', remap: [[0, 0, 0], [1, 1, 0]], memSet: MEMSET_DEFAULT_A },
    { wt: 'factory:Default', remap: [[0, 0, 0], [1, 1, 0]], memSet: MEMSET_DEFAULT_B },
  ],
  sub:    { direct: 0 },
  noise:  { src: 'noise:White', oneshot: 0, keytrack: 0, direct: 0 },
  filter: { keytrack: 0 },
  lfo:    [ /* ×8 */ { mode: 'off', bpm: 1, dot: 0, trip: 0, anchor: 1,
                       pts: [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]], loop: -1, start: 0 } ],
  lfoGrid: { x: 8, y: 8 },
  velo:   { pts: [[0, 0, 0], [1, 1, 0]], porta: 0 },
  note:   { pts: [[0, 0, 0], [1, 1, 0]], porta: 0 },
  chaos:  [ { mono: 0, sh: 0 }, { mono: 0, sh: 0 } ],
  macros: [ { name: 'Macro 1', v: 0 }, { name: 'Macro 2', v: 0 }, { name: 'Macro 3', v: 0 }, { name: 'Macro 4', v: 0 } ],
  matrix: [ /* ×32 */ { src: '', amt: 0, dst: '', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 } ],
  voicing: { mono: 0, legato: 0, poly: 8, always: 0, scaled: 0, oneNote: 1 },
  global: { os: 2, a4: 440, uniRange: [2, 2], uniMode: [0, 0] },
  midi:   {},                            // { "<cc 0-119>": "<DEST id>" | "macro1".."macro4" }  MIDI learn (inv A2.3)
  locks:  { p: [], mod: [], misc: { poly: 0, os: 0, tuning: 0 } },   // inv A2.2; see §8.1 applyPreset
  ui:     { page: 'osc', env: 0, mod: 'lfo1', envLock: 1, envZoom: 1, view3d: [0, 0], wtSel: [0, 0], filtView: 0 }
}
```
`MEMSET_DEFAULT_A[i] = frac(0.137 + 0.6180339887·i)`, `MEMSET_DEFAULT_B[i] = frac(0.511 + 0.6180339887·i)`, i = 0…15 (16 numbers each, rounded to 6 decimals).

The host creates new Serum tracks (and **Init Preset**) from `defaultSerum()` with `global.os = prefs.defOs` and `author = prefs.author` applied (§9.7).

### 2.2 Field reference

| Path | Type / range | Default | Meaning (inventory) |
|---|---|---|---|
| `v` | int | 1 | schema version |
| `author`, `notes` | string | `''` | inv A2.1 Author / Notes |
| `p[id]` | number ∈ [0,1] | DEST `def n` (§3.13) | every synth-segment destination (incl. the switch/enum destinations idx 119–147 and matrix-only `g.tune`, `g.amp`, `bus1..16`, `g.wheel`, `g.bend`), plus `g.master` and `g.bypass`. int/enum/bool laws store the grid value `k/(hi−lo)` exactly. `bus1..16` are always 0.5; `g.wheel` 0 and `g.bend` 0.5 are placeholders (the host's wheel/bend are their bases, §6.15) — `normalizeSerum` forces these values. |
| `osc[i].wt` | table id (§7.6) | `'factory:Default'` | inv A3 wavetable menu |
| `osc[i].remap` | points (§2.3) | diagonal | Remap graph shared by Remap 1–4 (inv A6) |
| `osc[i].memSet` | 16 numbers ∈ [0,1) | see above | stored unison phases for Mem / MemTrig (inv A3 phase states); captured by serum-ui (§6.4) |
| `sub.direct` | 0/1 | 0 | inv A7 DIRECT OUT |
| `noise.src` | noise id (§7.9) | `'noise:White'` | inv A8 noise menu |
| `noise.oneshot` | 0/1 | 0 (loop) | inv A8 One-shot / Loop |
| `noise.keytrack` | 0/1 | 0 | inv A8 Keytrack |
| `noise.direct` | 0/1 | 0 | inv A8 DIRECT OUT |
| `filter.keytrack` | 0/1 | 0 | inv A11.1 key track |
| `lfo[l].mode` | `'trig'` \| `'env'` \| `'off'` | `'off'` | inv A13 Mode |
| `lfo[l].bpm` / `.dot` / `.trip` / `.anchor` | 0/1 | 1 / 0 / 0 / 1 | inv A13 switches (not automatable in S1) |
| `lfo[l].pts` | points (§2.3) | triangle | LFO graph; points may carry bus links (§2.3) |
| `lfo[l].loop` | point index or −1 | −1 | Env-mode loopback point (inv A13) |
| `lfo[l].start` | point index | 0 | start point: playback starts at `pts[start].x` on trigger |
| `lfoGrid` | `{x,y}` ints 1–64 | 8 / 8 | graph grid, global to all LFOs (inv A13 Grid) |
| `velo.pts`, `note.pts` | points | diagonal | VELO / NOTE remap curves (inv A14) |
| `velo.porta`, `note.porta` | 0/1 | 0 | "follow portamento/legato": NOTE uses the gliding pitch; VELO is re-captured on legato notes |
| `chaos[c].mono/.sh` | 0/1 | 0 | inv A14 Chaos switches (BPM is the destination `c1.bpm`/`c2.bpm`) |
| `macros[m].name` | string ≤ 24 | `Macro m+1` | inv A15 label |
| `macros[m].v` | ∈ [0,1] | 0 | macro value (a source, not a DEST) |
| `matrix[r]` | §2.4 | empty | 32 slots (inv A16.3) |
| `voicing.mono/.legato` | 0/1 | 0 | inv A17 (Legato with Mono off = poly legato, §6.1) |
| `voicing.poly` | int 1–32 | 8 | inv A17 POLY |
| `voicing.always/.scaled` | 0/1 | 0 | inv A17 portamento switches |
| `voicing.oneNote` | 0/1 | 1 | "limit polyphony to one of any note number" (inv A17): 1 = a repeated note reuses its sounding voice |
| `global.os` | 1 \| 2 \| 4 | 2 | inv A3/A19 oversampling = the track's processor OS (§6.9) |
| `global.a4` | 430–450 (0.1 steps) | 440 | inv A18 |
| `global.uniRange[i]` | 0–48 (0.01 steps) | 2 | inv A4 Range (semitones, total outer spread) |
| `global.uniMode[i]` | 0–4 (§3.8) | 0 Linear | inv A4 Tuning |
| `midi` | object cc (0–119, as string) → DEST id or `macro1`…`macro4` | `{}` | MIDI learn map, saved with the preset (inv A2.3); values written per §8.1 `midiValue` |
| `locks.p` | DEST ids (synth or FX) | `[]` | locked parameters |
| `locks.mod` | subset of `['oscA','oscB','noise','sub','filter']` | `[]` | locked modules (fields per `MODULE_FIELDS`, §8.1) |
| `locks.misc` | `{poly, os, tuning}` 0/1 | 0 | polyphony lock (POLY right-click), oversampling lock, tuning (A4) lock (inv A2.2) |
| `ui.*` | UI-only | as above | never compiled; edits flagged `{ui:true}` (§8.8). `filtView`: 0 magnitude, 1 phase, 2 spectrum |

Automatable switches/enums that were structured fields in v1 are destinations now (inv A16.5/A23): `a.on`, `b.on`, `n.on`, `s.on`, `f.on`, `f.routeA/B/N/S`, `a.track`, `b.track`, `a.warpMode`, `b.warpMode`, `s.shape`, `s.oct`, `f.type`, `e1..3.ca/cd/cr`, `c1.bpm`, `c2.bpm` (§3.13 idx 119–147). The warp single-direction rule (inv A5): at most one of `a.warpMode`/`b.warpMode` base values may be in 18–20; `normalizeSerum` keeps A and sets B to 0 (loaded/invalid states); the UI resolves interactively (§9.3).

### 2.3 Points (graphs)
A graph is an array of points `[x, y, c]` or `[x, y, c, mx, my]`:

| Field | Range | Meaning |
|---|---|---|
| `x` | [0,1], non-decreasing; first point x = 0, last point x = 1 | position (equal x allowed = vertical step) |
| `y` | [0,1] | value (LFO: 0 bottom, 1 top; remap: output phase; velo/note: output; X-Shaper: output) |
| `c` | [−1,1] | curvature of the segment from this point to the next (`bend(t, CURVE_K·c)`, §4.4) |
| `mx`, `my` | int 0–16 | LFO graphs only: link the point's X / Y to LFO bus 1–16 (0 = none). Omitted when both 0. First/last point `mx` is always 0. Several points may share a bus. |

Limits: 2 ≤ length ≤ `MAX_PTS` (480, inv A13). `normalizeSerum` sorts by x (stable), clamps, forces end x values, drops points beyond 480 and rounds `x`, `y`, `c` to 5 decimals. LFO end points: editing the y of the first or last point of an LFO graph sets both (§8.6); `normalizeSerum` does not force them equal (a loaded shape may differ).

### 2.4 Matrix row

| Field | Type | Default | Meaning (inv A16.3) |
|---|---|---|---|
| `src` | SOURCE id (§3.12) or `''` | `''` | SOURCE |
| `amt` | [−1, 1] | 0 | AMOUNT (−100…+100 %) |
| `dst` | DEST id (§3.13) or `''` | `''` | DESTINATION (any DEST id, incl. matrix-only ids) |
| `bi` | 0/1 | 0 | TYPE `->` (0) / `<->` (1) |
| `curve` | [−1, 1] | 0 | CURVE (single bend on the source, §5.2) |
| `aux` | SOURCE id or `''` | `''` | AUX SOURCE |
| `inv` | 0/1 | 0 | aux mode: 0 = Default (product), 1 = (inv) |
| `byp` | 0/1 | 0 | row bypassed (MOD column "bypass", Alt-click; knob menu "Bypass Modulator") |
| `out` | [0, 1] | 1 | OUTPUT row scaling |

A row is **active** iff `src && dst && !byp && amt !== 0 && out !== 0`.

### 2.5 FX state schema — `defaultFx()` (every track, any model: `track.fx`)

```js
{
  v: 1,
  order: ['hyper', 'dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil'],   // processing order, top → bottom
  byp:   { hyper: 0, dist: 0, flg: 0, phs: 0, cho: 0, dly: 0, cmp: 0, rev: 0, eq: 0, fil: 0 },
  p:     { /* every FX-segment DEST id except 'g.master' and 'g.bypass' (fx idx 1–85, 87–99) → n */ },
  dist:  { xa: [[0, 0, 0], [1, 1, 0]], xb: [[0, 0, 0], [1, 1, 0]] },
  cho:   { mono: 0 },
  rev:   { type: 1 },
  phase: [0, 0, 0, 0],
  lock:  0,
  ui:    { lvl: { hyper: 0, dim: 0, dist: 0, flg: 0, phs: 0, cho: 0, dly: 0, cmp: 0, rev: 0, fil: 0 }, sel: '' }
}
```

| Path | Type / range | Default | Meaning (inventory) |
|---|---|---|---|
| `order` | permutation of the 10 module ids | default order | rack order (inv A20.1) |
| `byp[m]` | 0/1 | 0 | temporary bypass = module power button (UI/preset state, not a DEST; inv A20.1) |
| `p['fx.<m>.on']` | 0/1 (bool law) | 0 | module enable (VST param, DEST; inv A20.1). `hyper` enable covers Hyper and Dimension. |
| `p[...]` other | [0,1] | DEST def | all FX knobs and automatable FX switches/enums (§3.13 fx idx 1–85, 87–99): e.g. `fx.dist.mode`, `fx.dist.filt`, `fx.flg.bpm`, `fx.dly.bpm/link/mode`, `fx.cmp.mb`, `fx.eq.typeL/H`, `fx.fil.type`, `fx.hyper.retrig` |
| `dist.xa`, `dist.xb` | points (§2.3, no bus links) | linear | X-Shaper curves A/B (x = abs(input) 0…1 sym, or (input+1)/2 asym; y likewise) |
| `cho.mono` | 0/1 | 0 | chorus "mono" flag: L/R LFOs in phase (inv A20.3 chunk flag, not automatable) |
| `rev.type` | 0 Plate / 1 Hall | 1 | inv A20.4.8 (not automatable) |
| `phase` | 4 numbers ∈ [0,1) | 0 | saved LFO phases of Hyper, Flanger (L), Phaser (L), Chorus (inv A20.1 phase memory; §8.5.2) |
| `lock` | 0/1 | 0 | Lock FX Rack: `applyPresetFx` keeps the current FX state (inv A2.2) |
| `ui.lvl[k]` | 0/1 | 0 | knob shows MIX (0) or LEVEL (1) (inv A20.2 label toggle) — UI only |
| `ui.sel` | module id or `''` | `''` | rack scroll target — UI only |

`normalizeFx(fx)` fills missing keys, repairs `order` (drops unknown/duplicate ids, appends missing ones in default order), clamps values, snaps bool/int/enum laws, validates curves (§2.3). Idempotent. A track's `fx` is kept when the track's model changes.


---

## 3. Canonical constants (exported by `serum-core.js` unless stated)

Every list has a stable numeric index (array position) and, where named, a stable string id. **Indices and ids never change after v1 ships**; new entries append.

### 3.1 Laws (`LAWS`, `LAW` name→index)

| idx | name | `v = law(n)` | inverse `n = norm(v)` | notes |
|---|---|---|---|---|
| 0 | `lin` | `lo + (hi−lo)·n` | `(v−lo)/(hi−lo)` | |
| 1 | `int` | `Math.round(lo + (hi−lo)·n)` | `(v−lo)/(hi−lo)` | UI snaps n to `k/(hi−lo)` |
| 2 | `enum` | `Math.round(hi·n)` (lo = 0) | `v/hi` | `hi` = option count − 1; UI shows a menu |
| 3 | `bool` | `n >= 0.5 ? 1 : 0` | `v ? 1 : 0` | |
| 4 | `exp` | `lo·(hi/lo)^n` | `ln(v/lo)/ln(hi/lo)` | |
| 5 | `pow2` | `lo + (hi−lo)·n²` | `√((v−lo)/(hi−lo))` | |
| 6 | `pow3` | `lo + (hi−lo)·n³` | cube root | |
| 7 | `pow4` | `lo + (hi−lo)·n⁴` | 4th root | |
| 8 | `pow5` | `lo + (hi−lo)·n⁵` | 5th root | |
| 9 | `rpow3` | `max(lo, hi·(1−n)³)` | `1 − (v/hi)^(1/3)` | compressor threshold amplitude (dB = 60·log10(1−n), floor −120 dB) |
| 10 | `ratio` | `n >= 0.9825 ? 1e9 : min(hi, 1/(1−n))` | `v >= 1e6 ? 1 : min(0.9824, 1 − 1/v)` | `1e9` = Limit mode |
| 11 | `npitch` | `n >= 0.5 ? 2·hi·(n−0.5) : max(lo, 100·log2(2n))` | `v >= 0 ? 0.5 + v/(2·hi) : 2^(v/100)/2` | noise pitch (semitones), inv A8 measured law |

`lawValue(idOrIdx, n)` and `lawNorm(idOrIdx, v)` MUST satisfy, for every continuous law: `lawNorm(lawValue(n)) = n ± 1e-9` over the law's **invertible domain** — [0,1] except `ratio` n ∈ [0, 0.96875], `rpow3` n ∈ [0, 0.99], `npitch` n ∈ [0.125, 1] (outside these the law clamps) — and `lawValue(lawNorm(v)) = v ± 1e-9·max(1,|v|)` for v in the law's value range. The same law/lo/hi tables are embedded in the DSP scripts as `LAW_TAB` (§8.4.2).

### 3.2 Display formats (`FMT`; used by `fmtParam(id, n, ctx)`)

`ctx` (optional) = `{ s, fx, bpm, frames: [Fa, Fb], interp: [ia, ib] }` — `frames` = the oscillators' **display** frame counts (256 for morph tables, else R real frames), `interp` = 1 for morph tables. Output strings use ASCII `-`, no trailing zeros rules exactly as written.

| code | output | example |
|---|---|---|
| `pct` | `Math.round(n·100) + '%'` | `75%` |
| `pct1` | `Math.round(v·100) + '%'` | chorus feed 0.095 → `10%`; MB 1.0 → `100%` |
| `pan` | v = 0 → `C`; else `L`/`R` + `Math.round(abs(v)·50)` | `L12` |
| `fpan` | n = 0.5 → `C`; else `L`/`R` + `Math.round(abs(n−0.5)·200)` (n < 0.5 = `L`) | `R40` |
| `oct` | `(v>0?'+':'') + v + ' oct'` | `+1 oct` |
| `st` | `(v>0?'+':'') + v + ' st'` | `-2 st` |
| `st2` | `(v>0?'+':'') + v.toFixed(2) + ' st'` | `+0.50 st` |
| `ct` | `(v>0?'+':'') + Math.round(v) + ' ct'` | `+7 ct` |
| `crs` | `abs(v) < 0.005 → '--'`, else `(v>0?'+':'') + v.toFixed(2) + ' st'` | `--` |
| `int` | `String(v)` | `4` |
| `det` | `v.toFixed(2)` | `0.25` |
| `phase` | n ≥ 0.9995 → `Mem`; else `Math.round(v) + '°'` | `180°` |
| `deg` | `Math.round(v) + '°'` | |
| `frame` | interp (or ctx absent): `1 + round(n·(F−1))`; discrete: `1 + min(F−1, floor(n·F))`; F = `ctx.frames[o]`, no ctx: F = 256 | `17` |
| `bip100` | `(v>0?'+':'') + Math.round(v·100) + '%'` (v ∈ [−1,1]) | `-35%` |
| `hz` | f < 10: 2 dp; < 100: 1 dp; < 1000: 0 dp + ` Hz`; else `(f/1000).toFixed(f < 10000 ? 2 : 1) + ' kHz'` | `425 Hz`, `2.05 kHz` |
| `time` | s < 1: ms = 1000·s → `ms<10 ? 2dp : ms<100 ? 1dp : 0dp` + ` ms`; else `s<10 ? 2dp : 1dp` + ` s` | `0.52 ms`, `14.7 ms`, `1.00 s` |
| `ms` | same as `time` with v in ms | `5.00 ms` |
| `msFloor` | `time` of `max(0.1, v)` ms | `90.0 ms` |
| `cmpAtt` | eff ratio (from `ctx.fx`, base + mods when a snapshot is given) is Limit (n ≥ 0.9825) → `(10·n²).toFixed(2) + ' ms'` (look-ahead, inv A20.4.7); else `msFloor` | `0.90 ms` |
| `db` | v ≤ 1e-6 → `-inf dB`; else `(20·log10 v).toFixed(1) + ' dB'` | `-9.3 dB` |
| `dbv` | `(v>0?'+':'') + v.toFixed(1) + ' dB'` (v already dB) | `+3.0 dB` |
| `dbtrim` | n = 0 → `-inf dB`; else `(40·log10(2n)).toFixed(1) + ' dB'` | `0.0 dB` |
| `bool` | `On` / `Off` | |
| `enum:LIST` | the option label of `LIST[v]`; `enum:WARPS` uses `nameB` for `b.warpMode`; `enum:FILTERS` / `enum:SUB_SHAPES` use `.name` | `12 (2x)`, `FM (from A)` |
| `ratio` | v ≥ 1e6 → `Limit`; v < 2 → `v.toFixed(1) + ':1'`; else `Math.round(v) + ':1'` | `4:1` |
| `xoff` | v within ±0.01 of 4/3 → `TRIP`; of 1.5 → `DOT`; of 0.75 → `Dot 1/2`; else `'x' + v.toFixed(2)` | `x1.00` |
| `q01` | `v.toFixed(2)` | `2.00` |
| `q2` | `v.toFixed(1)` | `6.8` |
| `lbh` | n < 0.25 → `LP`, n ≤ 0.75 → `BP`, else `HP`, followed by ` ` + `Math.round(n·100)` | `LP 0` |
| `var` | `Math.round(n·100) + '%'`; for DB-type filters (eq family): `dbv` of the EQ gain law (§6.11) | |
| `npitch` | keytrack off: `(v>0?'+':'') + v.toFixed(1) + ' st'`; keytrack on: integer `st` | |
| `lfoRate` | `ctx.s.lfo[l].bpm` on: ladder label (§3.9, `lfoLadder(dot, trip)`); off: `hz` | `1/4`, `6.25 Hz` |
| `lfoTime` | BPM off: `time`; BPM on: `(v·2).toFixed(2) + ' beats'` (4 s = 8 beats, §6.12) | |
| `chaosRate` | `ctx.s.p['cN.bpm']` on: nearest straight ladder label (§6.13); off: `hz` | |
| `modRate` | `ctx.fx.p['fx.<m>.bpm']` on: MODFX ladder label (`Off` at index 0); off: `hz` | |
| `dlyTime` | `ctx.fx.p['fx.dly.bpm']` on: DLY ladder label; off: `time` of ms | `1/4` |
| `revT` | Plate: `Math.round(200·n) + ' ms'`; Hall: `(0.8 + 11.2·n).toFixed(1) + ' s'` (n = 1 → `inf`) | |

`fmtParam` MUST NOT throw for any id/n; unknown id → `String(n)`. Without `ctx`, switch-dependent formats use the dest's default switch state.

### 3.3 Warp modes (`WARPS = [{id, name, nameB}]`)

`speed` = factor applied to the read frequency for mip-level selection (§7.4); `w` = effective warp amount ∈ [0,1] (WARP eff ± unison warp offset, clamped). `x(φ)` = table read at phase φ ∈ [0,1). Formulas are normative (IMPL).

| idx | id | name (OSC A / OSC B) | phase / output transform | `speed` |
|---|---|---|---|---|
| 0 | `off` | Off | φ | 1 |
| 1 | `sync` | Sync | `r = 2^(4.4·w)`; read `x(frac(φ·r))` | r |
| 2 | `sync_half` | Sync 1/2 Win. | sync, output × (`φ<0.25 \|\| φ>0.75 ? sin²(2πφ) : 1`) | r |
| 3 | `sync_win` | Sync Window | sync, output × `sin²(πφ)` | r |
| 4 | `bend_p` | Bend + | per half: `u = φ<.5 ? 2φ : 2−2φ`, `u' = u^K`, `K = 2^(2.5·w)`; `φ' = φ<.5 ? u'/2 : 1−u'/2` | max(K, 1/K) |
| 5 | `bend_n` | Bend − | as Bend + with `K = 2^(−2.5·w)` | max(K, 1/K) |
| 6 | `bend_pn` | Bend +/- | as Bend + with `K = 2^(2.5·(2w−1))` (neutral at w = 0.5) | max(K, 1/K) |
| 7 | `pwm` | PWM | `φ' = min(1−2⁻²⁴, φ/(1 − 0.995·w))` (remainder holds the end value) | 1/(1−0.995w) |
| 8 | `asym_p` | Asym + | `φ' = φ^K`, `K = 2^(2.5·w)` | max(K, 1/K) |
| 9 | `asym_n` | Asym − | `K = 2^(−2.5·w)` | max(K, 1/K) |
| 10 | `asym_pn` | Asym +/- | `K = 2^(2.5·(2w−1))` (neutral at w = 0.5) | max(K, 1/K) |
| 11 | `flip` | Flip | output = `φ < w ? x(φ) : −x(φ)` | 1 |
| 12 | `mirror` | Mirror | `q = φ<.5 ? 2φ : 2−2φ`; `φ' = q^K`, `K = 2^(2.5·(2w−1))` | 2·max(K, 1/K) |
| 13 | `remap1` | Remap 1 | `φ' = φ + w·(G(φ) − φ)` | 2 |
| 14 | `remap2` | Remap 2 | `q = φ<.5 ? G(2φ)/2 : 1 − G(2−2φ)/2`; `φ' = φ + w·(q−φ)` | 2 |
| 15 | `remap3` | Remap 3 | `φ' = frac(φ − (0.9·w/2π)·sin(2πφ))` (sinusoidal, graph unused) | 1 + 0.9w |
| 16 | `remap4` | Remap 4 | `s = floor(4φ)`, `u = 4φ−s`, `u' = s odd ? 1−G(1−u) : G(u)`, `q = (s+u')/4`; `φ' = φ + w·(q−φ)` | 4 |
| 17 | `quantize` | Quantize | w < 1e-6 → identity; else `M = max(2, round(2048·2^(−10w)))`, `φ' = floor(φ·M)/M` | 1 |
| 18 | `fm_osc` | FM (from B) / FM (from A) | phase modulation: `φ' = frac(φ + I·m)`, `I = 3·w^1.5`, `m` = other osc (§6.7) | 1 + 6.3·I |
| 19 | `am_osc` | AM (from B) / AM (from A) | output `x·(1 − w + w·(0.5 + 0.5·m))` | 1 |
| 20 | `rm_osc` | RM (from B) / RM (from A) | output `x + w·(x·m − x)` | 1 |
| 21 | `fm_noise` | FM (Noise) | as 18 with `m` = noise osc raw output (mono avg) | 1 + 6.3·I |
| 22 | `fm_sub` | FM (Sub) | as 18 with `m` = sub osc raw output, `I = 4·w^1.5` | 1 + 6.3·I |
| (23) | — | (empty slot, never used) | | |

`G(p)` = the oscillator's remap graph evaluated through the CT `remap` table (§4.1, linear interpolation). Modes 18–22 require the modulator source to be **on** (eff `a.on`/`b.on`/`n.on`/`s.on` ≥ 0.5; its LEVEL may be 0); when it is off, `m = 0` **and** `I = 0` (speed 1, output identical to Off). 2D display shows the warp for all modes except 18–22 (inv A5).

**Neutral settings** (identity within 1e-12, exact where §0.2 requires): w = 0 for modes {1, 4, 5, 7, 8, 9, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22}; w = 0.5 for {6, 10}. Modes 2, 3, 11, 12 are audible at every setting (inv A5: Mirror never bypasses).

**Single direction** (inv A5): only one of OSC A/B may use 18–20. Base values: `normalizeSerum` keeps A and sets B to Off; the UI makes the most recent choice win (§9.3). Effective values (modulated `a.warpMode`/`b.warpMode`): if both eff modes are in 18–20 in a chunk, B's is treated as Off for that chunk.

### 3.4 Filter types (`FILTERS`, `FILTER_CATS = ['Normal','Multi','Flanges','Misc']`)

`f_var` (filters whose Var is a frequency: L6/H6 LP/HP FREQ, dual FREQ, Scream) = `MIDI0·(22050/MIDI0)^var` Hz. `w` (HL WID) = `0.25 + 5·var` octaves. Families are SFilter implementation classes (§6.11); recipe hints are normative where tests check them (§10.4) and IMPL-free otherwise. The type is the destination `f.type` (voice filter) / `fx.fil.type` (FX filter).

| # | id | name | category | Var label | family | recipe hint |
|---|---|---|---|---|---|---|
| 0 | `mg_low6` | MG Low 6 | Normal | FAT | ladder | 1 ladder stage(s) tapped (6 dB/oct); tanh per stage; FAT = tanh drive in the resonance feedback |
| 1 | `mg_low12` | MG Low 12 | Normal | FAT | ladder | 2 ladder stage(s) tapped (12 dB/oct); tanh per stage; FAT = tanh drive in the resonance feedback |
| 2 | `mg_low18` | MG Low 18 | Normal | FAT | ladder | 3 ladder stage(s) tapped (18 dB/oct); tanh per stage; FAT = tanh drive in the resonance feedback |
| 3 | `mg_low24` | MG Low 24 | Normal | FAT | ladder | 4 ladder stage(s) tapped (24 dB/oct); tanh per stage; FAT = tanh drive in the resonance feedback |
| 4 | `low6` | Low 6 | Normal | FAT | svf | TPT one-pole LP (res ignored) |
| 5 | `low12` | Low 12 | Normal | FAT | svf | TPT SVF LP |
| 6 | `low18` | Low 18 | Normal | FAT | svf | SVF LP → one-pole LP |
| 7 | `low24` | Low 24 | Normal | FAT | svf | SVF LP → SVF LP |
| 8 | `high6` | High 6 | Normal | FAT | svf | TPT one-pole HP (res ignored) |
| 9 | `high12` | High 12 | Normal | FAT | svf | TPT SVF HP |
| 10 | `high18` | High 18 | Normal | FAT | svf | SVF HP → one-pole HP |
| 11 | `high24` | High 24 | Normal | FAT | svf | SVF HP → SVF HP |
| 12 | `band12` | Band 12 | Normal | FAT | svf | SVF BP (unity peak) |
| 13 | `band24` | Band 24 | Normal | FAT | svf | SVF BP → SVF BP |
| 14 | `peak12` | Peak 12 | Normal | FAT | svf | SVF peak = x + 2k·bp·res-gain (boost at fc) |
| 15 | `peak24` | Peak 24 | Normal | FAT | svf | peak → peak |
| 16 | `notch12` | Notch 12 | Normal | FAT | svf | SVF notch = lp + hp |
| 17 | `notch24` | Notch 24 | Normal | FAT | svf | notch → notch |
| 18 | `lh6` | LH 6 | Multi | FREQ | dual | one-pole LP @cutoff → one-pole HP @f2 |
| 19 | `lh12` | LH 12 | Multi | FREQ | dual | SVF LP @cutoff → SVF HP @f2 |
| 20 | `lb12` | LB 12 | Multi | FREQ | dual | SVF L @cutoff → SVF B @f2 (series, shared res) |
| 21 | `lp12` | LP 12 | Multi | FREQ | dual | SVF L @cutoff → SVF P @f2 (series, shared res) |
| 22 | `ln12` | LN 12 | Multi | FREQ | dual | SVF L @cutoff → SVF N @f2 (series, shared res) |
| 23 | `hb12` | HB 12 | Multi | FREQ | dual | SVF H @cutoff → SVF B @f2 (series, shared res) |
| 24 | `hp12` | HP 12 | Multi | FREQ | dual | SVF H @cutoff → SVF P @f2 (series, shared res) |
| 25 | `hn12` | HN 12 | Multi | FREQ | dual | SVF H @cutoff → SVF N @f2 (series, shared res) |
| 26 | `bp12` | BP 12 | Multi | FREQ | dual | SVF B @cutoff → SVF P @f2 (series, shared res) |
| 27 | `bn12` | BN 12 | Multi | FREQ | dual | SVF B @cutoff → SVF N @f2 (series, shared res) |
| 28 | `pp12` | PP 12 | Multi | FREQ | dual | SVF P @cutoff → SVF P @f2 (series, shared res) |
| 29 | `pn12` | PN 12 | Multi | FREQ | dual | SVF P @cutoff → SVF N @f2 (series, shared res) |
| 30 | `nn12` | NN 12 | Multi | FREQ | dual | SVF N @cutoff → SVF N @f2 (series, shared res) |
| 31 | `lbh12` | L/B/H 12 | Multi | MORPH | morph | SVF output blend L→B (var 0..0.5) → H (0.5..1) |
| 32 | `lbh24` | L/B/H 24 | Multi | MORPH | morph | SVF×2 output blend L→B (var 0..0.5) → H (0.5..1) |
| 33 | `lph12` | L/P/H 12 | Multi | MORPH | morph | SVF output blend L→P (var 0..0.5) → H (0.5..1) |
| 34 | `lph24` | L/P/H 24 | Multi | MORPH | morph | SVF×2 output blend L→P (var 0..0.5) → H (0.5..1) |
| 35 | `lnh12` | L/N/H 12 | Multi | MORPH | morph | SVF output blend L→N (var 0..0.5) → H (0.5..1) |
| 36 | `lnh24` | L/N/H 24 | Multi | MORPH | morph | SVF×2 output blend L→N (var 0..0.5) → H (0.5..1) |
| 37 | `bpn12` | B/P/N 12 | Multi | MORPH | morph | SVF output blend B→P (var 0..0.5) → N (0.5..1) |
| 38 | `bpn24` | B/P/N 24 | Multi | MORPH | morph | SVF×2 output blend B→P (var 0..0.5) → N (0.5..1) |
| 39 | `cmb_p` | Cmb + | Flanges | FAT | comb | feedback comb, delay = 1/cutoff, positive feedback = res |
| 40 | `cmb_n` | Cmb - | Flanges | FAT | comb | feedback comb, delay = 1/cutoff, negative feedback = res |
| 41 | `cmb_l6p` | Cmb L6+ | Flanges | LP FREQ | comb | as Cmb +; one-pole LP @f_var in loop |
| 42 | `cmb_l6n` | Cmb L6- | Flanges | LP FREQ | comb | as Cmb -; one-pole LP @f_var in loop |
| 43 | `cmb_h6p` | Cmb H6+ | Flanges | HP FREQ | comb | as Cmb +; one-pole HP @f_var in loop |
| 44 | `cmb_h6n` | Cmb H6- | Flanges | HP FREQ | comb | as Cmb -; one-pole HP @f_var in loop |
| 45 | `cmb_hl6p` | Cmb HL6+ | Flanges | HL WID | comb | as Cmb +; HP @cutoff·2^-w and LP @cutoff·2^w in loop |
| 46 | `cmb_hl6n` | Cmb HL6- | Flanges | HL WID | comb | as Cmb -; HP @cutoff·2^-w and LP @cutoff·2^w in loop |
| 47 | `flg_p` | Flg + | Flanges | FAT | flange | flanger (x + comb)/2, delay = 1/cutoff, positive feedback = res |
| 48 | `flg_n` | Flg - | Flanges | FAT | flange | flanger (x + comb)/2, delay = 1/cutoff, negative feedback = res |
| 49 | `flg_l6p` | Flg L6+ | Flanges | LP FREQ | flange | as Flg +; one-pole LP @f_var in loop |
| 50 | `flg_l6n` | Flg L6- | Flanges | LP FREQ | flange | as Flg -; one-pole LP @f_var in loop |
| 51 | `flg_h6p` | Flg H6+ | Flanges | HP FREQ | flange | as Flg +; one-pole HP @f_var in loop |
| 52 | `flg_h6n` | Flg H6- | Flanges | HP FREQ | flange | as Flg -; one-pole HP @f_var in loop |
| 53 | `flg_hl6p` | Flg HL6+ | Flanges | HL WID | flange | as Flg +; HP @cutoff·2^-w and LP @cutoff·2^w in loop |
| 54 | `flg_hl6n` | Flg HL6- | Flanges | HL WID | flange | as Flg -; HP @cutoff·2^-w and LP @cutoff·2^w in loop |
| 55 | `phs12p` | Phs 12+ | Flanges | FAT | phaser | 4 first-order allpasses @cutoff, +feedback = res, out = (x+ap)/2 |
| 56 | `phs12n` | Phs 12- | Flanges | FAT | phaser | 4 first-order allpasses @cutoff, −feedback = res, out = (x+ap)/2 |
| 57 | `phs24p` | Phs 24+ | Flanges | FAT | phaser | 8 first-order allpasses @cutoff, +feedback = res, out = (x+ap)/2 |
| 58 | `phs24n` | Phs 24- | Flanges | FAT | phaser | 8 first-order allpasses @cutoff, −feedback = res, out = (x+ap)/2 |
| 59 | `phs36p` | Phs 36+ | Flanges | FAT | phaser | 12 first-order allpasses @cutoff, +feedback = res, out = (x+ap)/2 |
| 60 | `phs36n` | Phs 36- | Flanges | FAT | phaser | 12 first-order allpasses @cutoff, −feedback = res, out = (x+ap)/2 |
| 61 | `phs48p` | Phs 48+ | Flanges | FAT | phaser | 16 first-order allpasses @cutoff, +feedback = res, out = (x+ap)/2 |
| 62 | `phs48n` | Phs 48- | Flanges | FAT | phaser | 16 first-order allpasses @cutoff, −feedback = res, out = (x+ap)/2 |
| 63 | `phs48l6p` | Phs 48L6+ | Flanges | LP FREQ | phaser | 16 allpasses; LP @f_var in loop |
| 64 | `phs48l6n` | Phs 48L6- | Flanges | LP FREQ | phaser | 16 allpasses; LP @f_var in loop |
| 65 | `phs48h6p` | Phs 48H6+ | Flanges | HP FREQ | phaser | 16 allpasses; HP @f_var in loop |
| 66 | `phs48h6n` | Phs 48H6- | Flanges | HP FREQ | phaser | 16 allpasses; HP @f_var in loop |
| 67 | `phs48hl6p` | Phs 48HL6+ | Flanges | HL WID | phaser | 16 allpasses; HP/LP pair around cutoff in loop |
| 68 | `phs48hl6n` | Phs 48HL6- | Flanges | HL WID | phaser | 16 allpasses; HP/LP pair around cutoff in loop |
| 69 | `fphs12hl6p` | FPhs 12HL6+ | Flanges | HL WID | fphs | comb (1/cutoff) whose loop holds 4 allpasses + HL6 pair |
| 70 | `fphs12hl6n` | FPhs 12HL6- | Flanges | HL WID | fphs | comb (1/cutoff) whose loop holds 4 allpasses + HL6 pair |
| 71 | `loweq6` | Low EQ 6 | Misc | DB | eq | 1st-order low shelf @cutoff, gain from var (0 → −96 dB = HP) |
| 72 | `loweq12` | Low EQ 12 | Misc | DB | eq | RBJ low shelf, Q = 0.5+4·res |
| 73 | `bandeq12` | Band EQ 12 | Misc | DB | eq | RBJ peaking, Q = 0.5+9.5·res |
| 74 | `higheq6` | High EQ 6 | Misc | DB | eq | 1st-order high shelf (0 → LP) |
| 75 | `higheq12` | High EQ 12 | Misc | DB | eq | RBJ high shelf, Q = 0.5+4·res |
| 76 | `ringmod` | Ring Mod | Misc | — | ring | x·sin(2π·cutoff·t); custom display |
| 77 | `ringmod2` | Ring Modx2 | Misc | SPREAD | ring | ½x·(sin(2πf(1+s)t)+sin(2πf(1−s)t)), s = 0.5·var; custom display |
| 78 | `samphold` | SampHold | Misc | — | snh | hold input at rate = cutoff; custom display |
| 79 | `samphold_n` | SampHold- | Misc | — | snh | x − held; custom display |
| 80 | `combs` | Combs | Misc | DAMP | bank | 6 parallel feedback combs at cutoff·[1,1.5,2,2.5,3,4] (R ×1.007), fb = 0.97·res, LP damping in loop; voice-filter MIX forced to 1 (inv A11.1) |
| 81 | `allpasses` | Allpasses | Misc | DAMP | bank | 6 series Schroeder allpasses, delays (fs/cutoff)·[1,.77,.59,.45,.34,.26], g = 0.5+0.45·res |
| 82 | `reverb` | Reverb | Misc | DAMP | bank | 4-line Hadamard FDN, lengths (fs/cutoff)·[1,1.33,1.57,1.91], fb = 0.5+0.49·res |
| 83 | `french_lp` | French LP | Misc | BOEUF | french | saturating 4-pole ladder ×2 drive + BP @2·cutoff fed back (amount var) |
| 84 | `german_lp` | German LP | Misc | — | german | linear ZDF 4-pole ladder, res to self-oscillation |
| 85 | `add_bass` | Add Bass | Misc | THRU | addbass | tanh(1.5·SVF-LP) + var·(1st-order allpass of x @cutoff) |
| 86 | `formant1` | Formant-I | Misc | FORMNT | formant | 3 parallel BP (table I), cutoff picks vowel, var shifts ×2^(2·var) |
| 87 | `formant2` | Formant-II | Misc | FORMNT | formant | table II |
| 88 | `formant3` | Formant-III | Misc | FORMNT | formant | table III |
| 89 | `bandreject` | Bandreject | Misc | WIDTH | breject | x − BP(x), bandwidth 0.1..4 oct from var, res narrows |
| 90 | `distcomb1_lp` | Dist.Comb 1 LP | Misc | COMBFRQ | distcomb | SVF LP; comb (f = cutoff·2^(4(var−.5))) + tanh in feedback, +fb |
| 91 | `distcomb1_bp` | Dist.Comb 1 BP | Misc | COMBFRQ | distcomb | SVF BP; +fb |
| 92 | `distcomb2_lp` | Dist.Comb 2 LP | Misc | COMBFRQ | distcomb | SVF LP; −fb |
| 93 | `distcomb2_bp` | Dist.Comb 2 BP | Misc | COMBFRQ | distcomb | SVF BP; −fb |
| 94 | `scream_lp` | Scream LP | Misc | SCREAM | scream | SVF LP + feedback loop: one-pole LP @f_var, gain 2+30·drive², tanh, ×res |
| 95 | `scream_bp` | Scream BP | Misc | SCREAM | scream | SVF BP + same loop |

`FILTER_FAMILY` (exported by serum-core *and* serum-dsp, identical): `['ladder','svf','dual','morph','comb','flange','phaser','fphs','eq','ring','snh','bank','french','german','addbass','formant','breject','distcomb','scream']` — family index = position. `FILTERS[i] = { id, name, cat, varLabel, family }` (`varLabel` `''` = Var unused: knob shown disabled). Delay-based families (comb, flange, fphs, bank, distcomb) own sample-rate-dependent delay memory (§8.4.5).

### 3.5 Formant tables (Formant-I/II/III; F1, F2, F3 in Hz; vowels in order a, e, i, o, u)

| Table | a | e | i | o | u |
|---|---|---|---|---|---|
| I | 730, 1090, 2440 | 530, 1840, 2480 | 270, 2290, 3010 | 570, 840, 2410 | 300, 870, 2240 |
| II | 850, 1220, 2810 | 610, 2330, 2990 | 310, 2790, 3310 | 590, 920, 2710 | 370, 950, 2670 |
| III | 1030, 1370, 3170 | 690, 2610, 3570 | 370, 3200, 3730 | 680, 1060, 3180 | 430, 1170, 3260 |

Vowel position `P = 4·clamp(log(fc/80)/log(8000/80), 0, 1)` (fc = cutoff Hz); formant k = linear interpolation of table rows floor(P), ceil(P); then × `2^(2·var)` (FORMNT shift); band gains 1, 0.7, 0.5; Q = 5 + 20·res.

### 3.6 Sub shapes (`SUB_SHAPES`; inv A7 — S1 has 5)

| idx | id | name | table id | waveform x(φ) before band-limiting (starts at 0 and falls, inv A7) |
|---|---|---|---|---|
| 0 | `sine` | Sine | `sub:Sine` | `−sin(2πφ)` |
| 1 | `roundrect` | RoundRect | `sub:RoundRect` | `−tanh(4·sin(2πφ))/tanh(4)` |
| 2 | `saw` | Saw | `sub:Saw` | `1 − 2·frac(φ + 0.5)` |
| 3 | `square` | Square | `sub:Square` | `φ < 0.5 ? −1 : 1` |
| 4 | `pulse` | Pulse | `sub:Pulse` | `φ < 0.25 ? −1 : 1/3` (25 % duty, DC-free) |

The DSP knows the five table ids as the constant `SUB_IDS` (§8.4.2); the sub table in use is `SUB_IDS[eff s.shape]`.

### 3.7 Noise catalogue
Lives in `wt.js` (`NOISES`, §7.9) because it ships with its generators. serum-core only knows the default id `'noise:White'`.

### 3.8 Unison (`UNI_STACKS`, `UNI_MODES`)

| idx | stack label | semitone offset of unison voice i (voices sorted by detune slot, i = 0…N−1) |
|---|---|---|
| 0 | `off` | 0 |
| 1 | `12 (1x)` | i odd → +12 |
| 2 | `12 (2x)` | i odd → 12·(1 + ((i−1)/2 mod 2)) → 0, 12, 0, 24, 0, 12, … |
| 3 | `12 (3x)` | i odd → 12·(1 + ((i−1)/2 mod 3)) |
| 4 | `12+7(1x)` | cycle `[0, 7, 12]` by i |
| 5 | `12+7(2x)` | cycle `[0, 7, 12, 19, 24]` |
| 6 | `12+7(3x)` | cycle `[0, 7, 12, 19, 24, 31, 36]` |
| 7 | `Center-12` | centre voice(s) −12 (odd N: i = (N−1)/2; even N: i = N/2−1 and N/2) |
| 8 | `Center-24` | centre voice(s) −24 |

| idx | mode | detune slot shape `s(t)`, slot `t_i = N>1 ? 2i/(N−1) − 1 : 0` |
|---|---|---|
| 0 | `Linear` | `t` |
| 1 | `Super` | `sign(t)·abs(t)^1.5` |
| 2 | `Exp.` | `sign(t)·abs(t)^2.5` |
| 3 | `Inv.` | `sign(t)·abs(t)^0.5` |
| 4 | `Random` | uniform in [−1, 1], drawn per unison voice at every note-on (centre voice(s) included) |

Detune of unison voice i (semitones) = `s(t_i) · d · R/2`, d = `det` engine value (0…1), R = `global.uniRange` (inv A4: total outer spread = R at d = 1).
Pan position = `t_i · width` (width = `uniw` value). Blend gains: centre voice(s) `g_c`, others `g_s`: b ≤ 0.75 → `g_c = 1, g_s = b/0.75`; b > 0.75 → `g_s = 1, g_c = (1−b)/0.25`. N = 1: g = 1; N = 2: both voices are "centre" (g_c) — BLEND inactive for N ≤ 2 (inv A3). Gain compensation: whole unison sum × `1/√(Σ g_i²)` (N = 1 → 1).
WT position offset of voice i = `t_i · uniwt · 0.5` (in table-position units n, i.e. ±half table at ±100 %); warp offset = `t_i · uniwarp · 0.5`; both added to the eff value then clamped to [0,1].
These tables are constant: serum-core exports them (`uniTables()`, `detuneShape`, `stackSemis`) and serum-dsp computes identical copies at load (§8.4.2; an integration test compares them).

### 3.9 LFO tempo ladder (`LFO_LADDER`, `lfoLadder(dot, trip)`)

Straight entries, slowest → fastest (beats; 1 bar = 4 beats); entry i has `128·2^(−i)` beats:

| i | label | beats |
|---|---|---|
| 0 | `32 bar` | 128 |
| 1 | `16 bar` | 64 |
| 2 | `8 bar` | 32 |
| 3 | `4 bar` | 16 |
| 4 | `2 bar` | 8 |
| 5 | `1 bar` | 4 |
| 6 | `1/2` | 2 |
| 7 | `1/4` | 1 |
| 8 | `1/8` | 0.5 |
| 9 | `1/16` | 0.25 |
| 10 | `1/32` | 0.125 |
| 11 | `1/64` | 0.0625 |
| 12 | `1/128` | 0.03125 |
| 13 | `1/256` | 0.015625 |
| 14 | `fast` | 0.0078125 |

`lfoLadder(dot, trip)` returns `[{label, beats}]` sorted by beats **descending**: the 15 straight entries, plus (dot) entries 0–13 × 1.5 labelled `<label>.`, plus (trip) entries 0–13 × 2/3 labelled `<label>T` (e.g. `1/8T`, `4 barT`). Lengths 15 / 29 / 29 / 43; ties keep straight first. Rate eff n → entry `round(n·(L−1))` (stepped, never interpolated); cycle Hz = `bpm / 60 / beats`. Default n 0.5 → `1/4`.

### 3.10 Mod-FX and delay ladders

`MODFX_LADDER` (Flanger/Phaser/Chorus RATE with BPM on; inv A20.5 measured; 31 entries, index = `round(n·30)`; cycle Hz = `bpm/60/beats`, index 0 = `Off` = 0 Hz):

| i | label | beats | i | label | beats | i | label | beats |
|---|---|---|---|---|---|---|---|---|
| 0 | Off | ∞ | 11 | 4 bar T | 32/3 | 21 | 1/4 | 1 |
| 1 | 24 bar | 96 | 12 | 2 bar | 8 | 22 | 1/8. | 0.75 |
| 2 | 32 bar T | 256/3 | 13 | 1.5 bar | 6 | 23 | 1/4 T | 2/3 |
| 3 | 16 bar | 64 | 14 | 2 bar T | 16/3 | 24 | 1/8 | 0.5 |
| 4 | 12 bar | 48 | 15 | 1 bar | 4 | 25 | 1/16. | 0.375 |
| 5 | 16 bar T | 128/3 | 16 | 1/2. | 3 | 26 | 1/8 T | 1/3 |
| 6 | 8 bar | 32 | 17 | 1 bar T | 8/3 | 27 | 1/16 | 0.25 |
| 7 | 6 bar | 24 | 18 | 1/2 | 2 | 28 | 1/32. | 0.1875 |
| 8 | 8 bar T | 64/3 | 19 | 1/4. | 1.5 | 29 | 1/16 T | 1/6 |
| 9 | 4 bar | 16 | 20 | 1/2 T | 4/3 | 30 | 1/32 | 0.125 |
| 10 | 3 bar | 12 | | | | | | |

`DLY_LADDER` (Delay TIME with BPM on; inv A20.4.6; index = `round(n·11)`; time = beats·60/bpm × offset):

| i | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| label | fast | 1/256 | 1/128 | 1/64 | 1/32 | 1/16 | 1/8 | 1/4 | 1/2 | 1 bar | 2 bar | 4 bar |
| beats | 1/128 | 1/64 | 1/32 | 1/16 | 1/8 | 1/4 | 1/2 | 1 | 2 | 4 | 8 | 16 |

Default `fx.dly.timeL/R` n = 0.625 → index 7 = `1/4` (BPM on) or 77.3 ms (BPM off). Delay offset detents (UI snapping, ±0.02 in value): 0.75 (`Dot 1/2`), 1.0, 4/3 (`TRIP`), 1.5 (`DOT`). Both ladders are also embedded in fx-dsp as constants.

### 3.11 FX enumerations

| Constant | Values (index: label) |
|---|---|
| `FX_MODULES` (module index, id, label) | 0 `hyper` Hyper/Dimension · 1 `dist` Distortion · 2 `flg` Flanger · 3 `phs` Phaser · 4 `cho` Chorus · 5 `dly` Delay · 6 `cmp` Compressor · 7 `rev` Reverb · 8 `eq` EQ · 9 `fil` Filter |
| default order | `['hyper','dist','flg','phs','cho','dly','cmp','rev','eq','fil']` (inv A20.1) |
| `DIST_MODES` | 0 Tube · 1 SoftClip · 2 HardClip · 3 Diode 1 · 4 Diode 2 · 5 Lin.Fold · 6 Sin Fold · 7 Zero-Square · 8 Downsample · 9 Asym · 10 Rectify · 11 X-Shaper · 12 X-Shaper (Asym) · 13 Sine Shaper · 14 Stomp Box · 15 Tape Sat. |
| `DIST_FILTER` | 0 Off · 1 Pre · 2 Post |
| `DLY_MODES` | 0 Normal · 1 Ping-Pong · 2 Tap->Delay |
| `REV_TYPES` | 0 Plate · 1 Hall |
| `EQ_TYPES_L` | 0 Shelf · 1 Peak · 2 HP |
| `EQ_TYPES_H` | 0 Shelf · 1 Peak · 2 LP |
| `REV_LABELS` | Plate: `['SIZE','PRE DELAY','LOW CUT','DAMP','HIGH CUT','WIDTH','MIX']`; Hall: `['SIZE','DECAY','LOW CUT','SPIN','HIGH CUT','SPIN DEPTH','MIX']` for slots size, t, locut, c, hicut, w, mix |
| `CMP_RATIO_DETENTS` | ratio values the RATIO knob snaps to while dragged (inv A20.4.7 labels): 1.0, 1.1 … 1.9 (0.1 steps), 2, 3, 4, 5, 6, 7, 8, 10, 16, 32, Limit; n = `1 − 1/r` (Limit n = 1) |

### 3.12 Modulation sources (`SOURCES`, `SRC_INDEX`, `SRC_MENU`)

Index = Serum 1 preset source id (inv A16.4). `pol`: native range `uni` = [0,1], `bi` = [−1,1] (embedded in the DSP as `SRC_POL`). `scope`: V per voice, G global (same for all voices), V/G = depends on a switch.

| idx | id | label | pol | scope | value |
|---|---|---|---|---|---|
| 0 | `''` | (none) | — | — | 0 |
| 1 | `wheel` | Mod Wheel | uni | G | `proc.wheel` smoothed 1.5 ms, plus `g.wheel` modulation (§6.15) |
| 2 | `env1` | Env 1 | uni | V | envelope output 0–1 |
| 3 | `env2` | Env 2 | uni | V | |
| 4 | `env3` | Env 3 | uni | V | |
| 5–12 | `lfo1`…`lfo8` | LFO 1…8 | uni | V/G | graph value 0–1 after delay/rise/smooth (§6.12); G when mode `off` |
| 13 | `velo` | Velocity | uni | V | VELO curve(note-on velocity) |
| 14 | `note` | Note | uni | V | NOTE curve(note/127) (gliding pitch/127 when `note.porta`) |
| 15 | `at` | Aftertouch | uni | G | `proc.at` (channel pressure), smoothed 1.5 ms |
| 16 | `pat` | Poly AT | uni | V | `proc.pat[note]` (host poly pressure, smoothed 1.5 ms per voice); equals Aftertouch until the processor has received a poly-pressure message (`proc.patSeen`) |
| 17 | `chaos1` | Chaos 1 | bi | V/G | §6.13; G when `chaos[0].mono` |
| 18 | `chaos2` | Chaos 2 | bi | V/G | |
| 19 | `noise` | Noise Osc | bi | V | noise osc raw output (pre-level, mono avg) at chunk start; 0 if noise off |
| 20 | `rand1` | NoteOn Rand 1 | uni | V | uniform [0,1) drawn at note-on |
| 21 | `rand2` | NoteOn Rand 2 | uni | V | independent second draw |
| 22 | `alt1` | NoteOn Alt | uni | V | processor flip-flop: toggles 0↔1 at every note-on (first note-on after reset/transport seek → 1); the voice keeps the value it got |
| 23 | `alt2` | NoteOn Alt 2 | uni | V | `1 − alt1` |
| 24–27 | `macro1`…`macro4` | Macro 1…4 | uni | G | `s.macros[m].v` (patch), smoothed 6 ms × `CP.smooth` |
| 28 | `bend` | Pitch Bend | bi | G | `proc.bendRaw` smoothed 1.5 ms, plus `g.bend` modulation (§6.15) |
| 29 | `mpex` | MPE X | bi | V | 0 (Phase 1) |
| 30 | `mpey` | MPE Y | uni | V | 0 |
| 31 | `mpez` | MPE Z | uni | V | 0 |
| 32 | `relvel` | Rel. Velo | uni | V | release velocity from `noteOff(rv)`; 0.5 before note-off and when the host gives none |
| 33 | `fixed` | Fixed | uni | G | 1 |

`NSRC = 34`. Drag tiles exist for: Env 1–3, LFO 1–8, Velo, Note, Mod Wheel, Macro 1–4; every other source is matrix/menu-only (inv A16.4).
`SRC_MENU` (menu order): `env1, env2, env3, lfo1…lfo8, velo, note, wheel, at, pat, bend, chaos1, chaos2, noise, rand1, rand2, alt1, alt2, macro1…macro4, mpex, mpey, mpez, relvel, fixed`.

### 3.13 Destinations (`DESTS`, `DEST_INDEX`, `NS = 148`, `NF = 100`, `ND = 248`)

Two segments:
- **SYNTH** (idx 0–147): base values in `s.p`, delivered in `CP.base` (Float64Array(148), index = idx). Consumed by voices and the mono context (§5.5).
- **FX** (idx 148–247, *fx idx* = idx − 148): base values in `fx.p`, except `g.master` (fx idx 0) and `g.bypass` (fx idx 86), which live in `s.p` and reach `compileFx` through `ctx.master` / `ctx.bypass`; delivered in `FXP.base` (Float64Array(100), index = fx idx). Consumed once per processor by `FXRack`.

Idx 0–118 (synth) and fx idx 0–85 keep their v1 meaning; idx 119–147 and fx idx 86–99 are the automatable switches/enums and performance destinations added in v2 (inv A16.5, A20.3, A23).

Machine-readable copy: `exp/fixtures/dests.json` (`{NS, NF, ND, DESTS: [{id, label, law, lo, hi, def, fmt, scope, ctr, group, ref}]}`, `law` = law name, `ctr` 0/1, full-precision `lo`/`hi`/`def`) and `exp/fixtures/filters.json` (`{FILTERS: [{id, name, cat, varLabel, family, hint}]}`), both generated by `exp/gen.mjs` from the same source as the tables below; E1 copies them verbatim into `tests/fixtures/` in M1. The tables below remain normative; a test checks that the fixtures equal `DESTS`/`FILTERS`.

Columns: **law/lo/hi** per §3.1 (lo/hi in engine units; ¹ = `MIDI0` = 440·2^(−69/12) exactly, ² = 440·2^(59/12) exactly); **def n** = default base, written as an exact fraction where it is not a short decimal (stepped laws are exactly on the grid); **fmt** per §3.2; **scope**: `V` per voice (evaluated every chunk), `V*` per voice but drives a source or is sampled at note-on (one-chunk lag, §5.6; `a.uni`/`b.uni` sampled at note-on only, §6.1), `V*M` per voice and also mono-evaluated for global consumers (Off-mode LFOs, mono chaos, Off-mode point links), `G` global performance destination (evaluated in the mono context only, §6.15), `M` mono only (FX segment); **ctr** `C` = centred control → drag-and-drop default is bipolar (inv A16.1); **group** = menu group (`DESTS[i].group`).

Deliberate default choices where the sources conflict: `fx.cmp.mix` = 100 % (P1 says 50 % [low]); Reverb type Hall with the Hall-era slot defaults (`fx.rev.c` SPIN 25 %, `fx.rev.w` SPIN DEPTH 20 %, later dump; P1's 28 %/100 % are the Plate-era DAMP/WIDTH pair); `fx.rev.t` 0.12 (Hall 2.14 s); ENV 2/3 time defaults equal ENV 1 (A 0.11, H 0, D 0.5, R 0.215) with sustain 100 %.

Not destinations (deliberate): enum menus that S1 does not automate — wavetable, noise source, unison Tuning mode, LFO mode, reverb type (inv A20.3 chunk state); switches that S1 does not automate — sub/noise DIRECT OUT, noise one-shot/keytrack, filter key track, LFO BPM/Dot/Trip/Anchor, chaos Mono/S&H, voicing Mono/Legato/Always/Scaled/one-note, chorus mono flag, module bypass buttons; macros (S1); matrix amounts/outputs (`Mod N amt/out` are automatable in S1 but their use as matrix destinations is unverified [low]; excluded to keep the matrix free of self-reference); unison Range, A4, oversampling (A23 non-automatable block).

| idx | fx idx | id | label | law | lo | hi | def n | fmt | scope | ctr | group | inventory |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 |  | `a.level` | Osc A Level | pow2 | 0 | 1 | 0.75 | pct | V |  | Osc A | A3 LEVEL |
| 1 |  | `a.pan` | Osc A Pan | lin | -1 | 1 | 0.5 | pan | V | C | Osc A | A3 PAN |
| 2 |  | `a.oct` | Osc A Octave | int | -4 | 4 | 0.5 | oct | V | C | Osc A | A3 OCT |
| 3 |  | `a.semi` | Osc A Semi | int | -12 | 12 | 0.5 | st | V | C | Osc A | A3 SEM |
| 4 |  | `a.fine` | Osc A Fine | lin | -100 | 100 | 0.5 | ct | V | C | Osc A | A3 FIN |
| 5 |  | `a.crs` | Osc A Coarse Pitch | lin | -64 | 64 | 0.5 | crs | V | C | Osc A | A3 CRS |
| 6 |  | `a.uni` | Osc A Unison | int | 1 | 16 | 0 | int | V* |  | Osc A | A3 UNISON (sampled at note-on, §6.1) |
| 7 |  | `a.det` | Osc A Uni Detune | pow2 | 0 | 1 | 0.5 | det | V |  | Osc A | A3 DETUNE (display = knob²) |
| 8 |  | `a.blend` | Osc A Uni Blend | lin | 0 | 1 | 0.75 | pct | V |  | Osc A | A3 BLEND |
| 9 |  | `a.phase` | Osc A Phase | lin | 0 | 360 | 0.5 | phase | V |  | Osc A | A3 PHASE (n=1 → Mem) |
| 10 |  | `a.rand` | Osc A Rand Phase | lin | 0 | 1 | 1 | pct | V |  | Osc A | A3 RAND |
| 11 |  | `a.wt` | Osc A WT Pos | lin | 0 | 1 | 0 | frame | V |  | Osc A | A3 WT POS |
| 12 |  | `a.warp` | Osc A Warp | lin | 0 | 1 | 0 | pct | V |  | Osc A | A3 WARP |
| 13 |  | `a.uniw` | Osc A Uni Width | lin | 0 | 1 | 1 | pct | V |  | Osc A | A4 Width (Uni LR) |
| 14 |  | `a.uniwarp` | Osc A Uni Warp | lin | -1 | 1 | 0.5 | bip100 | V | C | Osc A | A4 Warp (Uni Warp) |
| 15 |  | `a.uniwt` | Osc A Uni WT Pos | lin | -1 | 1 | 0.5 | bip100 | V | C | Osc A | A4 WT Pos (Uni WTPos) |
| 16 |  | `a.stack` | Osc A Uni Stack | enum | 0 | 8 | 0 | enum:UNI_STACKS | V |  | Osc A | A4 Stack |
| 17 |  | `b.level` | Osc B Level | pow2 | 0 | 1 | 0.75 | pct | V |  | Osc B | A3 LEVEL |
| 18 |  | `b.pan` | Osc B Pan | lin | -1 | 1 | 0.5 | pan | V | C | Osc B | A3 PAN |
| 19 |  | `b.oct` | Osc B Octave | int | -4 | 4 | 0.5 | oct | V | C | Osc B | A3 OCT |
| 20 |  | `b.semi` | Osc B Semi | int | -12 | 12 | 0.5 | st | V | C | Osc B | A3 SEM |
| 21 |  | `b.fine` | Osc B Fine | lin | -100 | 100 | 0.5 | ct | V | C | Osc B | A3 FIN |
| 22 |  | `b.crs` | Osc B Coarse Pitch | lin | -64 | 64 | 0.5 | crs | V | C | Osc B | A3 CRS |
| 23 |  | `b.uni` | Osc B Unison | int | 1 | 16 | 0 | int | V* |  | Osc B | A3 UNISON (sampled at note-on, §6.1) |
| 24 |  | `b.det` | Osc B Uni Detune | pow2 | 0 | 1 | 0.5 | det | V |  | Osc B | A3 DETUNE (display = knob²) |
| 25 |  | `b.blend` | Osc B Uni Blend | lin | 0 | 1 | 0.75 | pct | V |  | Osc B | A3 BLEND |
| 26 |  | `b.phase` | Osc B Phase | lin | 0 | 360 | 0.5 | phase | V |  | Osc B | A3 PHASE (n=1 → Mem) |
| 27 |  | `b.rand` | Osc B Rand Phase | lin | 0 | 1 | 1 | pct | V |  | Osc B | A3 RAND |
| 28 |  | `b.wt` | Osc B WT Pos | lin | 0 | 1 | 0 | frame | V |  | Osc B | A3 WT POS |
| 29 |  | `b.warp` | Osc B Warp | lin | 0 | 1 | 0 | pct | V |  | Osc B | A3 WARP |
| 30 |  | `b.uniw` | Osc B Uni Width | lin | 0 | 1 | 1 | pct | V |  | Osc B | A4 Width (Uni LR) |
| 31 |  | `b.uniwarp` | Osc B Uni Warp | lin | -1 | 1 | 0.5 | bip100 | V | C | Osc B | A4 Warp (Uni Warp) |
| 32 |  | `b.uniwt` | Osc B Uni WT Pos | lin | -1 | 1 | 0.5 | bip100 | V | C | Osc B | A4 WT Pos (Uni WTPos) |
| 33 |  | `b.stack` | Osc B Uni Stack | enum | 0 | 8 | 0 | enum:UNI_STACKS | V |  | Osc B | A4 Stack |
| 34 |  | `n.level` | Noise Level | pow2 | 0 | 1 | 0.25 | pct | V |  | Noise | A8 LEVEL |
| 35 |  | `n.pitch` | Noise Pitch | npitch | -200 | 48 | 0.5 | npitch | V | C | Noise | A8 PITCH |
| 36 |  | `n.fine` | Noise Fine | lin | -100 | 100 | 0.5 | ct | V | C | Noise | A8/A19 Noise Fine |
| 37 |  | `n.pan` | Noise Pan | lin | -1 | 1 | 0.5 | pan | V | C | Noise | A8 PAN |
| 38 |  | `n.rand` | Noise Rand Phase | lin | 0 | 1 | 0 | pct | V |  | Noise | A8 RAND |
| 39 |  | `n.phase` | Noise Phase | lin | 0 | 1 | 0 | pct | V |  | Noise | A8 PHASE |
| 40 |  | `s.level` | Sub Level | lin | 0 | 1 | 0.75 | pct | V |  | Sub | A7 LEVEL (linear amplitude) |
| 41 |  | `s.pan` | Sub Pan | lin | -1 | 1 | 0.5 | pan | V | C | Sub | A7 PAN |
| 42 |  | `f.cutoff` | Filter Cutoff | exp | 8.1758¹ | 22050 | 0.5 | hz | V |  | Filter | A11.1 CUTOFF |
| 43 |  | `f.res` | Filter Res | lin | 0 | 1 | 0.1 | pct | V |  | Filter | A11.1 RES |
| 44 |  | `f.drive` | Filter Drive | lin | 0 | 1 | 0 | pct | V |  | Filter | A11.1 DRIVE |
| 45 |  | `f.var` | Filter Var | lin | 0 | 1 | 0 | var | V |  | Filter | A11.1 VAR |
| 46 |  | `f.mix` | Filter Mix | lin | 0 | 1 | 1 | pct | V |  | Filter | A11.1 MIX |
| 47 |  | `f.pan` | Filter Pan | lin | 0 | 1 | 0.5 | fpan | V | C | Filter | A11.1 PAN (Stereo) |
| 48 |  | `e1.att` | Env 1 Attack | pow5 | 0 | 32 | 0.11 | time | V* |  | Env 1 | A12 Attack |
| 49 |  | `e1.hold` | Env 1 Hold | pow5 | 0 | 32 | 0 | time | V* |  | Env 1 | A12 Hold |
| 50 |  | `e1.dec` | Env 1 Decay | pow5 | 0 | 32 | 0.5 | time | V* |  | Env 1 | A12 Decay |
| 51 |  | `e1.sus` | Env 1 Sustain | pow2 | 0 | 1 | 1 | db | V* |  | Env 1 | A12 Sustain ENV1 (amp = n²) |
| 52 |  | `e1.rel` | Env 1 Release | pow5 | 0 | 32 | 0.215 | time | V* |  | Env 1 | A12 Release |
| 53 |  | `e2.att` | Env 2 Attack | pow5 | 0 | 32 | 0.11 | time | V* |  | Env 2 | A12 Attack |
| 54 |  | `e2.hold` | Env 2 Hold | pow5 | 0 | 32 | 0 | time | V* |  | Env 2 | A12 Hold |
| 55 |  | `e2.dec` | Env 2 Decay | pow5 | 0 | 32 | 0.5 | time | V* |  | Env 2 | A12 Decay |
| 56 |  | `e2.sus` | Env 2 Sustain | lin | 0 | 1 | 1 | pct | V* |  | Env 2 | A12 Sustain ENV2/3 |
| 57 |  | `e2.rel` | Env 2 Release | pow5 | 0 | 32 | 0.215 | time | V* |  | Env 2 | A12 Release |
| 58 |  | `e3.att` | Env 3 Attack | pow5 | 0 | 32 | 0.11 | time | V* |  | Env 3 | A12 Attack |
| 59 |  | `e3.hold` | Env 3 Hold | pow5 | 0 | 32 | 0 | time | V* |  | Env 3 | A12 Hold |
| 60 |  | `e3.dec` | Env 3 Decay | pow5 | 0 | 32 | 0.5 | time | V* |  | Env 3 | A12 Decay |
| 61 |  | `e3.sus` | Env 3 Sustain | lin | 0 | 1 | 1 | pct | V* |  | Env 3 | A12 Sustain ENV2/3 |
| 62 |  | `e3.rel` | Env 3 Release | pow5 | 0 | 32 | 0.215 | time | V* |  | Env 3 | A12 Release |
| 63 |  | `l1.rate` | LFO 1 Rate | pow4 | 0 | 100 | 0.5 | lfoRate | V*M |  | LFO 1 | A13 Rate (Hz) / ladder (BPM) |
| 64 |  | `l1.rise` | LFO 1 Rise | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 1 | A13 Rise |
| 65 |  | `l1.delay` | LFO 1 Delay | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 1 | A13 Delay |
| 66 |  | `l1.smooth` | LFO 1 Smooth | lin | 0 | 1 | 0 | pct | V*M |  | LFO 1 | A13 Smooth |
| 67 |  | `l2.rate` | LFO 2 Rate | pow4 | 0 | 100 | 0.5 | lfoRate | V*M |  | LFO 2 | A13 Rate (Hz) / ladder (BPM) |
| 68 |  | `l2.rise` | LFO 2 Rise | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 2 | A13 Rise |
| 69 |  | `l2.delay` | LFO 2 Delay | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 2 | A13 Delay |
| 70 |  | `l2.smooth` | LFO 2 Smooth | lin | 0 | 1 | 0 | pct | V*M |  | LFO 2 | A13 Smooth |
| 71 |  | `l3.rate` | LFO 3 Rate | pow4 | 0 | 100 | 0.5 | lfoRate | V*M |  | LFO 3 | A13 Rate (Hz) / ladder (BPM) |
| 72 |  | `l3.rise` | LFO 3 Rise | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 3 | A13 Rise |
| 73 |  | `l3.delay` | LFO 3 Delay | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 3 | A13 Delay |
| 74 |  | `l3.smooth` | LFO 3 Smooth | lin | 0 | 1 | 0 | pct | V*M |  | LFO 3 | A13 Smooth |
| 75 |  | `l4.rate` | LFO 4 Rate | pow4 | 0 | 100 | 0.5 | lfoRate | V*M |  | LFO 4 | A13 Rate (Hz) / ladder (BPM) |
| 76 |  | `l4.rise` | LFO 4 Rise | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 4 | A13 Rise |
| 77 |  | `l4.delay` | LFO 4 Delay | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 4 | A13 Delay |
| 78 |  | `l4.smooth` | LFO 4 Smooth | lin | 0 | 1 | 0 | pct | V*M |  | LFO 4 | A13 Smooth |
| 79 |  | `l5.rate` | LFO 5 Rate | pow4 | 0 | 100 | 0.5 | lfoRate | V*M |  | LFO 5 | A13 Rate (Hz) / ladder (BPM) |
| 80 |  | `l5.rise` | LFO 5 Rise | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 5 | A13 Rise |
| 81 |  | `l5.delay` | LFO 5 Delay | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 5 | A13 Delay |
| 82 |  | `l5.smooth` | LFO 5 Smooth | lin | 0 | 1 | 0 | pct | V*M |  | LFO 5 | A13 Smooth |
| 83 |  | `l6.rate` | LFO 6 Rate | pow4 | 0 | 100 | 0.5 | lfoRate | V*M |  | LFO 6 | A13 Rate (Hz) / ladder (BPM) |
| 84 |  | `l6.rise` | LFO 6 Rise | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 6 | A13 Rise |
| 85 |  | `l6.delay` | LFO 6 Delay | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 6 | A13 Delay |
| 86 |  | `l6.smooth` | LFO 6 Smooth | lin | 0 | 1 | 0 | pct | V*M |  | LFO 6 | A13 Smooth |
| 87 |  | `l7.rate` | LFO 7 Rate | pow4 | 0 | 100 | 0.5 | lfoRate | V*M |  | LFO 7 | A13 Rate (Hz) / ladder (BPM) |
| 88 |  | `l7.rise` | LFO 7 Rise | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 7 | A13 Rise |
| 89 |  | `l7.delay` | LFO 7 Delay | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 7 | A13 Delay |
| 90 |  | `l7.smooth` | LFO 7 Smooth | lin | 0 | 1 | 0 | pct | V*M |  | LFO 7 | A13 Smooth |
| 91 |  | `l8.rate` | LFO 8 Rate | pow4 | 0 | 100 | 0.5 | lfoRate | V*M |  | LFO 8 | A13 Rate (Hz) / ladder (BPM) |
| 92 |  | `l8.rise` | LFO 8 Rise | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 8 | A13 Rise |
| 93 |  | `l8.delay` | LFO 8 Delay | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 8 | A13 Delay |
| 94 |  | `l8.smooth` | LFO 8 Smooth | lin | 0 | 1 | 0 | pct | V*M |  | LFO 8 | A13 Smooth |
| 95 |  | `c1.rate` | Chaos 1 Rate | pow5 | 0 | 1000 | 0.2512 | chaosRate | V*M |  | Chaos | A14 Chaos 1 Rate |
| 96 |  | `c2.rate` | Chaos 2 Rate | pow5 | 0 | 1000 | 0.2512 | chaosRate | V*M |  | Chaos | A14 Chaos 2 Rate |
| 97 |  | `g.porta` | Porta Time | pow5 | 0 | 8 | 0 | time | V |  | Global | A17 Porta |
| 98 |  | `g.curve` | Porta Curve | lin | -1 | 1 | 0.5 | bip100 | V | C | Global | A17 Curve |
| 99 |  | `g.tune` | Master Tune | lin | -64 | 64 | 0.5 | st2 | V | C | Global | A18 Mast.Tun (matrix-only) |
| 100 |  | `g.amp` | Amp | pow2 | 0 | 1 | 1 | pct | V |  | Global | A16.5 Amp. (matrix-only) |
| 101 |  | `g.bendup` | Bend Up | int | -24 | 24 | 13/24 | st | V |  | Global | A14 Bend Up |
| 102 |  | `g.benddn` | Bend Down | int | -24 | 24 | 11/24 | st | V |  | Global | A14 Bend Down |
| 103 |  | `bus1` | LFO Bus 1 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 104 |  | `bus2` | LFO Bus 2 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 105 |  | `bus3` | LFO Bus 3 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 106 |  | `bus4` | LFO Bus 4 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 107 |  | `bus5` | LFO Bus 5 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 108 |  | `bus6` | LFO Bus 6 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 109 |  | `bus7` | LFO Bus 7 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 110 |  | `bus8` | LFO Bus 8 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 111 |  | `bus9` | LFO Bus 9 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 112 |  | `bus10` | LFO Bus 10 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 113 |  | `bus11` | LFO Bus 11 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 114 |  | `bus12` | LFO Bus 12 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 115 |  | `bus13` | LFO Bus 13 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 116 |  | `bus14` | LFO Bus 14 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 117 |  | `bus15` | LFO Bus 15 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 118 |  | `bus16` | LFO Bus 16 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 119 |  | `a.on` | Osc A On | bool | 0 | 1 | 1 | bool | V |  | Osc A | A23 Osc A/B On |
| 120 |  | `b.on` | Osc B On | bool | 0 | 1 | 0 | bool | V |  | Osc B | A23 Osc A/B On |
| 121 |  | `n.on` | Noise On | bool | 0 | 1 | 0 | bool | V |  | Noise | A23 Osc N On |
| 122 |  | `s.on` | Sub On | bool | 0 | 1 | 0 | bool | V |  | Sub | A23 Osc S On |
| 123 |  | `f.on` | Filter On | bool | 0 | 1 | 0 | bool | V |  | Filter | A23 Filter On |
| 124 |  | `f.routeA` | A>Filter | bool | 0 | 1 | 1 | bool | V |  | Filter | A23 OscA>Fil |
| 125 |  | `f.routeB` | B>Filter | bool | 0 | 1 | 0 | bool | V |  | Filter | A23 OscB>Fil |
| 126 |  | `f.routeN` | Noise>Filter | bool | 0 | 1 | 0 | bool | V |  | Filter | A23 OscN>Fil |
| 127 |  | `f.routeS` | Sub>Filter | bool | 0 | 1 | 0 | bool | V |  | Filter | A23 OscS>Fil |
| 128 |  | `a.track` | Osc A Pitch Track | bool | 0 | 1 | 1 | bool | V |  | Osc A | A23 OscAPitchTrack |
| 129 |  | `b.track` | Osc B Pitch Track | bool | 0 | 1 | 1 | bool | V |  | Osc B | A23 OscBPitchTrack |
| 130 |  | `a.warpMode` | Osc A Warp Mode | enum | 0 | 22 | 0 | enum:WARPS | V |  | Osc A | A23 WarpOscA |
| 131 |  | `b.warpMode` | Osc B Warp Mode | enum | 0 | 22 | 0 | enum:WARPS | V |  | Osc B | A23 WarpOscB |
| 132 |  | `s.shape` | Sub Shape | enum | 0 | 4 | 0 | enum:SUB_SHAPES | V |  | Sub | A23 SubOscShape |
| 133 |  | `s.oct` | Sub Octave | int | -4 | 4 | 0.5 | oct | V | C | Sub | A23 SubOscOctave |
| 134 |  | `f.type` | Filter Type | enum | 0 | 95 | 1/95 | enum:FILTERS | V |  | Filter | A23 Fil Type |
| 135 |  | `e1.ca` | Env 1 Attack Curve | lin | 0 | 1 | 0.5 | pct | V* |  | Env 1 | A23 A curve1 |
| 136 |  | `e1.cd` | Env 1 Decay Curve | lin | 0 | 1 | 0.666 | pct | V* |  | Env 1 | A23 D curve1 |
| 137 |  | `e1.cr` | Env 1 Release Curve | lin | 0 | 1 | 0.666 | pct | V* |  | Env 1 | A23 R curve1 |
| 138 |  | `e2.ca` | Env 2 Attack Curve | lin | 0 | 1 | 0.5 | pct | V* |  | Env 2 | A23 A curve2 |
| 139 |  | `e2.cd` | Env 2 Decay Curve | lin | 0 | 1 | 0.666 | pct | V* |  | Env 2 | A23 D curve2 |
| 140 |  | `e2.cr` | Env 2 Release Curve | lin | 0 | 1 | 0.666 | pct | V* |  | Env 2 | A23 R curve2 |
| 141 |  | `e3.ca` | Env 3 Attack Curve | lin | 0 | 1 | 0.5 | pct | V* |  | Env 3 | A23 A curve3 |
| 142 |  | `e3.cd` | Env 3 Decay Curve | lin | 0 | 1 | 0.666 | pct | V* |  | Env 3 | A23 D curve3 |
| 143 |  | `e3.cr` | Env 3 Release Curve | lin | 0 | 1 | 0.666 | pct | V* |  | Env 3 | A23 R curve3 |
| 144 |  | `c1.bpm` | Chaos 1 BPM | bool | 0 | 1 | 0 | bool | V*M |  | Chaos | A16.5 Chaos1 BPM |
| 145 |  | `c2.bpm` | Chaos 2 BPM | bool | 0 | 1 | 0 | bool | V*M |  | Chaos | A16.5 Chaos2 BPM |
| 146 |  | `g.wheel` | Mod Wheel | lin | 0 | 1 | 0 | pct | G |  | Global | A16.5 Mod Wheel (matrix-only; base = host wheel) |
| 147 |  | `g.bend` | Pitch Bend | lin | -1 | 1 | 0.5 | bip100 | G | C | Global | A16.5 Pitch Bend (matrix-only; base = host bend) |
| 148 | 0 | `g.master` | Master Volume | pow3 | 0 | 1 | 0.7 | db | M |  | Master | A18 Master Volume (state lives in Serum s.p) |
| 149 | 1 | `fx.hyper.on` | Hyper/Dim Enable | bool | 0 | 1 | 0 | bool | M |  | FX Hyper/Dim | A20.1 Hyp Enable |
| 150 | 2 | `fx.hyper.rate` | Hyper Rate | lin | 0 | 1 | 0.4 | pct | M |  | FX Hyper/Dim | A20.4.1 RATE |
| 151 | 3 | `fx.hyper.detune` | Hyper Detune | lin | 0 | 1 | 0.25 | pct | M |  | FX Hyper/Dim | A20.4.1 DETUNE |
| 152 | 4 | `fx.hyper.unison` | Hyper Unison | int | 0 | 7 | 4/7 | int | M |  | FX Hyper/Dim | A20.4.1 UNISON |
| 153 | 5 | `fx.hyper.mix` | Hyper Mix | lin | 0 | 1 | 0.5 | pct | M |  | FX Hyper/Dim | A20.4.1 MIX |
| 154 | 6 | `fx.hyper.level` | Hyper Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Hyper/Dim | A20.2 LEVEL trim |
| 155 | 7 | `fx.dim.size` | Dimension Size | lin | 0 | 1 | 0.5 | pct | M |  | FX Hyper/Dim | A20.4.1 SIZE |
| 156 | 8 | `fx.dim.mix` | Dimension Mix | lin | 0 | 1 | 0 | pct | M |  | FX Hyper/Dim | A20.4.1 Dim MIX |
| 157 | 9 | `fx.dim.level` | Dimension Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Hyper/Dim | A20.2 LEVEL trim |
| 158 | 10 | `fx.dist.on` | Distortion Enable | bool | 0 | 1 | 0 | bool | M |  | FX Distortion | A20.1 Dist Enable |
| 159 | 11 | `fx.dist.drive` | Dist Drive | lin | 0 | 1 | 0.25 | pct | M |  | FX Distortion | A20.4.2 DRIVE |
| 160 | 12 | `fx.dist.lbh` | Dist LP/BP/HP | lin | 0 | 1 | 0 | lbh | M |  | FX Distortion | A20.4.2 LP/BP/HP |
| 161 | 13 | `fx.dist.freq` | Dist Freq | exp | 8.1758¹ | 13289.75² | 0.5 | hz | M |  | FX Distortion | A20.4.2 F |
| 162 | 14 | `fx.dist.q` | Dist Q | exp | 0.5 | 8 | 0.5 | q01 | M |  | FX Distortion | A20.4.2 Q (engine Q = 0.5·16^n) |
| 163 | 15 | `fx.dist.mix` | Dist Mix | lin | 0 | 1 | 1 | pct | M |  | FX Distortion | A20.4.2 MIX |
| 164 | 16 | `fx.dist.level` | Dist Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Distortion | A20.2 LEVEL trim |
| 165 | 17 | `fx.flg.on` | Flanger Enable | bool | 0 | 1 | 0 | bool | M |  | FX Flanger | A20.1 |
| 166 | 18 | `fx.flg.rate` | Flanger Rate | pow4 | 0 | 20 | 0.25 | modRate | M |  | FX Flanger | A20.4.3 RATE (ladder MODFX when BPM) |
| 167 | 19 | `fx.flg.depth` | Flanger Depth | lin | 0 | 1 | 1 | pct | M |  | FX Flanger | A20.4.3 DEPTH |
| 168 | 20 | `fx.flg.feed` | Flanger Feed | lin | 0 | 1 | 0.5 | pct | M |  | FX Flanger | A20.4.3 FEED |
| 169 | 21 | `fx.flg.phase` | Flanger Phase | lin | 0 | 360 | 0.5 | deg | M |  | FX Flanger | A20.4.3 PHASE (Flg_Stereo) |
| 170 | 22 | `fx.flg.mix` | Flanger Mix | lin | 0 | 1 | 1 | pct | M |  | FX Flanger | A20.4.3 MIX |
| 171 | 23 | `fx.flg.level` | Flanger Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Flanger | A20.2 LEVEL trim |
| 172 | 24 | `fx.phs.on` | Phaser Enable | bool | 0 | 1 | 0 | bool | M |  | FX Phaser | A20.1 |
| 173 | 25 | `fx.phs.rate` | Phaser Rate | pow4 | 0 | 20 | 0.25 | modRate | M |  | FX Phaser | A20.4.4 RATE |
| 174 | 26 | `fx.phs.depth` | Phaser Depth | lin | 0 | 1 | 0.5 | pct | M |  | FX Phaser | A20.4.4 DEPTH |
| 175 | 27 | `fx.phs.freq` | Phaser Freq | exp | 20 | 18000 | 0.5 | hz | M |  | FX Phaser | A20.4.4 FREQ |
| 176 | 28 | `fx.phs.feed` | Phaser Feed | lin | 0 | 1 | 0.8 | pct | M |  | FX Phaser | A20.4.4 FEED |
| 177 | 29 | `fx.phs.phase` | Phaser Phase | lin | 0 | 360 | 0.5 | deg | M |  | FX Phaser | A20.4.4 PHASE |
| 178 | 30 | `fx.phs.mix` | Phaser Mix | lin | 0 | 1 | 1 | pct | M |  | FX Phaser | A20.4.4 MIX |
| 179 | 31 | `fx.phs.level` | Phaser Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Phaser | A20.2 LEVEL trim |
| 180 | 32 | `fx.cho.on` | Chorus Enable | bool | 0 | 1 | 0 | bool | M |  | FX Chorus | A20.1 |
| 181 | 33 | `fx.cho.rate` | Chorus Rate | pow4 | 0 | 20 | 0.25 | modRate | M |  | FX Chorus | A20.4.5 RATE |
| 182 | 34 | `fx.cho.dly1` | Chorus Delay 1 | pow2 | 0 | 20 | 0.5 | ms | M |  | FX Chorus | A20.4.5 DELAY 1 |
| 183 | 35 | `fx.cho.dly2` | Chorus Delay 2 | pow2 | 0 | 20 | 0 | ms | M |  | FX Chorus | A20.4.5 DELAY 2 |
| 184 | 36 | `fx.cho.depth` | Chorus Depth | pow2 | 0 | 26 | 1 | ms | M |  | FX Chorus | A20.4.5 DEPTH |
| 185 | 37 | `fx.cho.feed` | Chorus Feed | lin | 0 | 0.95 | 0.1 | pct1 | M |  | FX Chorus | A20.4.5 FEED |
| 186 | 38 | `fx.cho.lpf` | Chorus LPF | exp | 50 | 20000 | 0.5 | hz | M |  | FX Chorus | A20.4.5 LPF |
| 187 | 39 | `fx.cho.mix` | Chorus Mix | lin | 0 | 1 | 0.5 | pct | M |  | FX Chorus | A20.4.5 MIX |
| 188 | 40 | `fx.cho.level` | Chorus Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Chorus | A20.2 LEVEL trim |
| 189 | 41 | `fx.dly.on` | Delay Enable | bool | 0 | 1 | 0 | bool | M |  | FX Delay | A20.1 |
| 190 | 42 | `fx.dly.feed` | Delay Feed | lin | 0 | 1 | 0.4 | pct | M |  | FX Delay | A20.4.6 FEED |
| 191 | 43 | `fx.dly.timeL` | Delay Time L | pow4 | 1 | 501 | 0.625 | dlyTime | M |  | FX Delay | A20.4.6 LEFT time (ladder DLY when BPM) |
| 192 | 44 | `fx.dly.timeR` | Delay Time R | pow4 | 1 | 501 | 0.625 | dlyTime | M |  | FX Delay | A20.4.6 RIGHT time |
| 193 | 45 | `fx.dly.offL` | Delay Offset L | lin | 0.5 | 1.5 | 0.5 | xoff | M |  | FX Delay | A20.4.6 LEFT offset |
| 194 | 46 | `fx.dly.offR` | Delay Offset R | lin | 0.5 | 1.5 | 0.5 | xoff | M |  | FX Delay | A20.4.6 RIGHT offset |
| 195 | 47 | `fx.dly.freq` | Delay Filter Freq | exp | 40 | 18000 | 0.5 | hz | M |  | FX Delay | A20.4.6 F |
| 196 | 48 | `fx.dly.q` | Delay Filter Q | lin | 0.8 | 8.2 | 6/7.4 | q2 | M |  | FX Delay | A20.4.6 Q (bandwidth, octaves) |
| 197 | 49 | `fx.dly.mix` | Delay Mix | lin | 0 | 1 | 0.3 | pct | M |  | FX Delay | A20.4.6 MIX |
| 198 | 50 | `fx.dly.level` | Delay Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Delay | A20.2 LEVEL trim |
| 199 | 51 | `fx.cmp.on` | Compressor Enable | bool | 0 | 1 | 0 | bool | M |  | FX Compressor | A20.1 |
| 200 | 52 | `fx.cmp.thr` | Comp Threshold | rpow3 | 0.000001 | 1 | 0.5 | db | M |  | FX Compressor | A20.4.7 THRESH (dB = 60·log10(1−n)) |
| 201 | 53 | `fx.cmp.ratio` | Comp Ratio | ratio | 1 | 32 | 0.75 | ratio | M |  | FX Compressor | A20.4.7 RATIO |
| 202 | 54 | `fx.cmp.att` | Comp Attack | pow2 | 0 | 1000 | 0.3 | cmpAtt | M |  | FX Compressor | A20.4.7 ATTACK (floor 0.1 ms; Limit: 0–10 ms look-ahead) |
| 203 | 55 | `fx.cmp.rel` | Comp Release | pow2 | 0 | 1000 | 0.3 | msFloor | M |  | FX Compressor | A20.4.7 RELEASE (floor 0.1 ms) |
| 204 | 56 | `fx.cmp.gain` | Comp Gain | pow2 | 1 | 32 | 0 | db | M |  | FX Compressor | A20.4.7 GAIN (amp 1+31n²) |
| 205 | 57 | `fx.cmp.mbL` | Comp MB Low | lin | 0 | 2 | 0.5 | pct1 | M |  | FX Compressor | A20.4.7 CompMB L |
| 206 | 58 | `fx.cmp.mbM` | Comp MB Mid | lin | 0 | 2 | 0.5 | pct1 | M |  | FX Compressor | A20.4.7 CompMB M |
| 207 | 59 | `fx.cmp.mbH` | Comp MB High | lin | 0 | 2 | 0.5 | pct1 | M |  | FX Compressor | A20.4.7 CompMB H |
| 208 | 60 | `fx.cmp.mix` | Comp Mix | lin | 0 | 1 | 1 | pct | M |  | FX Compressor | A20.4.7 MIX (default 100 %, see §3.13 note) |
| 209 | 61 | `fx.cmp.level` | Comp Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Compressor | A20.2 LEVEL trim |
| 210 | 62 | `fx.rev.on` | Reverb Enable | bool | 0 | 1 | 0 | bool | M |  | FX Reverb | A20.1 |
| 211 | 63 | `fx.rev.size` | Reverb Size | lin | 0 | 1 | 0.33 | pct | M |  | FX Reverb | A20.4.8 SIZE |
| 212 | 64 | `fx.rev.t` | Reverb PreDelay / Decay | lin | 0 | 1 | 0.12 | revT | M |  | FX Reverb | A20.4.8 slot 83 |
| 213 | 65 | `fx.rev.locut` | Reverb Low Cut | lin | 0 | 1 | 0 | pct | M |  | FX Reverb | A20.4.8 LOW CUT |
| 214 | 66 | `fx.rev.c` | Reverb Damp / Spin | lin | 0 | 1 | 0.25 | pct | M |  | FX Reverb | A20.4.8 slot 85 (Hall-era default 25 %) |
| 215 | 67 | `fx.rev.hicut` | Reverb High Cut | lin | 0 | 1 | 0.5 | pct | M |  | FX Reverb | A20.4.8 HIGH CUT |
| 216 | 68 | `fx.rev.w` | Reverb Width / Spin Depth | lin | 0 | 1 | 0.2 | pct | M |  | FX Reverb | A20.4.8 slot 87 (Hall-era default 20 %) |
| 217 | 69 | `fx.rev.mix` | Reverb Mix | lin | 0 | 1 | 0.33 | pct | M |  | FX Reverb | A20.4.8 MIX |
| 218 | 70 | `fx.rev.level` | Reverb Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Reverb | A20.2 LEVEL trim |
| 219 | 71 | `fx.eq.on` | EQ Enable | bool | 0 | 1 | 0 | bool | M |  | FX EQ | A20.1 |
| 220 | 72 | `fx.eq.freqL` | EQ Freq L | exp | 21.533 | 20000 | 0.333 | hz | M |  | FX EQ | A20.4.9 FREQ L |
| 221 | 73 | `fx.eq.qL` | EQ Q L | lin | 0 | 1 | 0.6 | pct | M |  | FX EQ | A20.4.9 Q L |
| 222 | 74 | `fx.eq.gainL` | EQ Gain L | lin | -24 | 24 | 0.5 | dbv | M | C | FX EQ | A20.4.9 GAIN L |
| 223 | 75 | `fx.eq.freqH` | EQ Freq H | exp | 21.533 | 20000 | 0.666 | hz | M |  | FX EQ | A20.4.9 FREQ R |
| 224 | 76 | `fx.eq.qH` | EQ Q H | lin | 0 | 1 | 0.6 | pct | M |  | FX EQ | A20.4.9 Q R |
| 225 | 77 | `fx.eq.gainH` | EQ Gain H | lin | -24 | 24 | 0.5 | dbv | M | C | FX EQ | A20.4.9 GAIN R |
| 226 | 78 | `fx.fil.on` | FX Filter Enable | bool | 0 | 1 | 0 | bool | M |  | FX Filter | A20.1 |
| 227 | 79 | `fx.fil.cutoff` | FX Filter Cutoff | exp | 8.1758¹ | 22050 | 0.5 | hz | M |  | FX Filter | A20.4.10 CUTOFF |
| 228 | 80 | `fx.fil.res` | FX Filter Res | lin | 0 | 1 | 0 | pct | M |  | FX Filter | A20.4.10 RES |
| 229 | 81 | `fx.fil.drive` | FX Filter Drive | lin | 0 | 1 | 0 | pct | M |  | FX Filter | A20.4.10 DRIVE |
| 230 | 82 | `fx.fil.var` | FX Filter Var | lin | 0 | 1 | 0 | var | M |  | FX Filter | A20.4.10 VAR |
| 231 | 83 | `fx.fil.pan` | FX Filter Pan | lin | 0 | 1 | 0.5 | fpan | M | C | FX Filter | A20.4.10 PAN |
| 232 | 84 | `fx.fil.mix` | FX Filter Mix | lin | 0 | 1 | 1 | pct | M |  | FX Filter | A20.4.10 MIX |
| 233 | 85 | `fx.fil.level` | FX Filter Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Filter | A20.2 LEVEL trim |
| 234 | 86 | `g.bypass` | Bypass | bool | 0 | 1 | 0 | bool | M |  | Master | A16.5 Bypass (state lives in Serum s.p; matrix-only) |
| 235 | 87 | `fx.hyper.retrig` | Hyper Retrig | bool | 0 | 1 | 0 | bool | M |  | FX Hyper/Dim | A20.3 Hyp Retrig |
| 236 | 88 | `fx.dist.mode` | Dist Mode | enum | 0 | 15 | 0 | enum:DIST_MODES | M |  | FX Distortion | A20.3 Dist_Mode |
| 237 | 89 | `fx.dist.filt` | Dist Pre/Post | enum | 0 | 2 | 0 | enum:DIST_FILTER | M |  | FX Distortion | A20.3 Dist_PrePost |
| 238 | 90 | `fx.flg.bpm` | Flanger BPM | bool | 0 | 1 | 0 | bool | M |  | FX Flanger | A20.3 Flg BPM |
| 239 | 91 | `fx.phs.bpm` | Phaser BPM | bool | 0 | 1 | 0 | bool | M |  | FX Phaser | A20.3 Phs BPM |
| 240 | 92 | `fx.cho.bpm` | Chorus BPM | bool | 0 | 1 | 0 | bool | M |  | FX Chorus | A20.3 Cho BPM |
| 241 | 93 | `fx.dly.bpm` | Delay BPM | bool | 0 | 1 | 1 | bool | M |  | FX Delay | A20.3 Dly BPM |
| 242 | 94 | `fx.dly.link` | Delay Link | bool | 0 | 1 | 0 | bool | M |  | FX Delay | A20.3 Dly Link |
| 243 | 95 | `fx.dly.mode` | Delay Mode | enum | 0 | 2 | 0 | enum:DLY_MODES | M |  | FX Delay | A20.3 Dly Mode |
| 244 | 96 | `fx.cmp.mb` | Comp Multiband | bool | 0 | 1 | 0 | bool | M |  | FX Compressor | A20.3 CmpMBnd |
| 245 | 97 | `fx.eq.typeL` | EQ Type L | enum | 0 | 2 | 0 | enum:EQ_TYPES_L | M |  | FX EQ | A20.3 EQ TypL |
| 246 | 98 | `fx.eq.typeH` | EQ Type H | enum | 0 | 2 | 0 | enum:EQ_TYPES_H | M |  | FX EQ | A20.3 EQ TypH |
| 247 | 99 | `fx.fil.type` | FX Filter Type | enum | 0 | 95 | 0 | enum:FILTERS | M |  | FX Filter | A20.3 FX Fil Type |

DSP code refers to destinations through `SerumDSP.DIDX` / `FXDSP.FIDX`: frozen objects mapping a constant name to the index above, e.g. `DIDX.A_LEVEL = 0`, `DIDX.B_LEVEL = 17` (for idx 0–16, osc B = osc A + 17), `DIDX.N_LEVEL = 34`, `DIDX.S_LEVEL = 40`, `DIDX.F_CUTOFF = 42`, `DIDX.E1_ATT = 48` (env e = 48 + 5·(e−1)), `DIDX.L1_RATE = 63` (LFO l = 63 + 4·(l−1)), `DIDX.C1_RATE = 95`, `DIDX.G_PORTA = 97`, `DIDX.G_TUNE = 99`, `DIDX.G_AMP = 100`, `DIDX.G_BENDUP = 101`, `DIDX.BUS1 = 103`, `DIDX.A_ON = 119`, `DIDX.N_ON = 121`, `DIDX.S_ON = 122`, `DIDX.F_ON = 123`, `DIDX.F_ROUTEA = 124`, `DIDX.A_TRACK = 128`, `DIDX.A_WARPMODE = 130`, `DIDX.S_SHAPE = 132`, `DIDX.S_OCT = 133`, `DIDX.F_TYPE = 134`, `DIDX.E1_CA = 135` (env e curves = 135 + 3·(e−1): CA, CD, CR), `DIDX.C1_BPM = 144`, `DIDX.G_WHEEL = 146`, `DIDX.G_BEND = 147`; `FIDX.G_MASTER = 0`, `FIDX.HYPER_ON = 1` …, `FIDX.G_BYPASS = 86`, `FIDX.HYPER_RETRIG = 87`, `FIDX.DIST_MODE = 88`, `FIDX.FIL_TYPE = 99`. Naming rule: id upper-cased, `.` → `_`, `fx.` prefix dropped, e.g. `fx.dly.timeL` → `FIDX.DLY_TIMEL`, `a.warpMode` → `DIDX.A_WARPMODE`. `DIDX` covers idx 0–147, `FIDX` covers fx idx 0–99. Sources: `SIDX.WHEEL = 1`, `SIDX.ENV1 = 2`, `SIDX.LFO1 = 5`, `SIDX.VELO = 13`, `SIDX.NOTE = 14`, `SIDX.AT = 15`, `SIDX.PAT = 16`, `SIDX.CHAOS1 = 17`, `SIDX.NOISE = 19`, `SIDX.RAND1 = 20`, `SIDX.ALT1 = 22`, `SIDX.MACRO1 = 24`, `SIDX.BEND = 28`, `SIDX.MPEX = 29`, `SIDX.RELVEL = 32`, `SIDX.FIXED = 33`. These index objects plus the constant tables `LAW_TAB` (law index, lo, hi, cont for every DEST, synth segment then FX segment), `SRC_POL`, `SUB_IDS`, the unison tables (§3.8), the ladders (§3.9, §3.10) and `FILTER_FAMILY` are the **only** id knowledge the DSP scripts have; the integration test (§10.7) checks each against serum-core.

`MATRIX_ONLY` = `g.tune`, `g.amp`, `g.wheel`, `g.bend`, `g.bypass`, `bus1`…`bus16`: offered only in the matrix DESTINATION menu (inv A16.5). Every other destination is bound to a panel widget carrying `data-dest` — including the switch/enum destinations (power buttons, routing buttons, warp/filter/sub-shape menus, BPM/mode switches) — so drag-and-drop, the knob menu and MIDI learn work on all of them (inv A2.3: MIDI learn on module power buttons).

---

## 4. Compiled formats

### 4.1 `compileSerum(s, ctx) → engine patch`

`ctx = { bpm = 120, smooth = 1 }` (`smooth` = the preference "smoothing scale", 0.01–8 = 1–800 %, §9.7). Pure, deterministic, ≤ 1 ms for a typical patch and ≤ 2 ms for a dense one (called on every knob move at ≤ 60 Hz). `s` must already be normalized: the host runs `normalizeSerum` when state enters from outside (project/preset load, track creation, imports), not per knob move; `compileSerum` never throws for normalized input. It memoises the CT (below) by content key.

Host-facing fields (read by engine.js):

| Field | Value |
|---|---|
| `engine` | `'serum'` |
| `mode` | `s.voicing.mono ? 'mono' : 'poly'` |
| `poly` | `s.voicing.mono ? 1 : s.voicing.poly` |
| `prio` | `'last'` |
| `legato` | `!!s.voicing.legato` (engine mono legato) |
| `glide`, `glideLegato`, `unison`, `unisonDetune`, `drift`, `bendRange`, `level` | `0, false, 1, 0, 0, 2, 1` (unused; the voice does portamento, unison, bend) |
| `bpm` | `ctx.bpm` |
| `needs` | table/noise ids the patch can play. A switch destination is *possibly on* when its base ≥ 0.5 or an active row targets it. `osc[i].wt` for each possibly-on oscillator; `SUB_IDS[base s.shape]` when the sub is possibly on, all five `SUB_IDS` if `s.shape` is also targeted; `noise.src` when the noise is possibly on |
| `serum` | `CP` (below) |
| `serumT` | `CT` (below) — the host strips it from a live message when `CT.key` equals the key last sent to that node (§11) |

`CP` — every field always present (fixed shapes; empty = zero-filled):

| Field | Type | Length | Content |
|---|---|---|---|
| `ver` | number | — | `CP_VER = 1` |
| `NS`, `NSRC` | number | — | 148, 34 |
| `base` | Float64Array | 148 | `s.p[DESTS[i].id]` |
| `mN` | number | — | number of active matrix rows (§2.4), compacted in slot order |
| `mSrc` | Int8Array | 32 | source index (1–33) |
| `mDst` | Int16Array | 32 | destination index (0–247) |
| `mAmt` | Float64Array | 32 | `amt · out` |
| `mBi` | Uint8Array | 32 | TYPE |
| `mK` | Float64Array | 32 | `MC_K · curve` (0 = linear) |
| `mAux` | Int8Array | 32 | aux source index, 0 = none |
| `mInv` | Uint8Array | 32 | aux (inv) |
| `mCtx` | Uint8Array | 32 | contexts that evaluate the row, from the destination's scope: bit 1 voice (`V`, `V*`, `V*M`), bit 2 mono (`V*M`, `G`), bit 4 FX (FX segment) |
| `mOn` | Uint8Array | 32 | 1 if the destination is sampled at note-on (`a.uni`, `b.uni`, `a.phase`, `b.phase`, `a.rand`, `b.rand`, `n.phase`, `n.rand`; §6.1) |
| `srcUsed` | Uint8Array | 34 | 1 if any active row reads the source (as src or aux); the DSP may skip computing unused per-voice sources (LFOs, chaos, noise-as-source) |
| `modded` | Uint8Array | 148 | 1 if any active row targets synth destination i; voices recompute only modded destinations per chunk (others follow the smoothed base), and `modded[f.type] = 1` makes every filter family preallocate (§8.4.5) |
| `wt` | Array(2) of string | 2 | table ids |
| `uniMode` | Uint8Array | 2 | §3.8 |
| `uniRange` | Float64Array | 2 | semitones |
| `memSet` | Float64Array | 32 | `[o·16 + i]` |
| `subDirect`, `noiseOneshot`, `noiseKey`, `noiseDirect`, `filKey` | number | — | structured switches |
| `noiseId` | string | — | |
| `direct` | number | — | 1 if (`subDirect` and sub possibly on) or (`noiseDirect` and noise possibly on) |
| `lfoMode` | Uint8Array | 8 | 0 trig, 1 env, 2 off |
| `lfoBpm`, `lfoAnchor` | Uint8Array | 8 | |
| `lfoLad` | Float64Array | 8·43 | beats of `lfoLadder(dot, trip)` entries, slowest first, zero-padded |
| `lfoLadN` | Uint8Array | 8 | ladder lengths (15/29/43) |
| `chaosMono`, `chaosSh` | Uint8Array | 2 | |
| `macro` | Float64Array | 4 | macro values |
| `mono`, `legato`, `poly`, `always`, `scaled`, `oneNote` | number | — | voicing |
| `os` | number | — | 1/2/4 (the engine runs the processor at `min(os, osCap)`, §6.9) |
| `a4` | number | — | Hz |
| `smooth` | number | — | `ctx.smooth` |
| `ctKey` | string | — | key of the CT compiled with this CP |

Constant tables are **not** part of CP: the DSP embeds `LAW_TAB`, `SRC_POL`, `SUB_IDS`, the unison tables and the ladders (§3.13).

`CT` — curve tables (`patch.serumT`), memoised by content:

| Field | Type | Length | Content |
|---|---|---|---|
| `key` | string | — | FNV-1a 32-bit (hex) over every point of the 8 LFO graphs, both remaps and the velo/note curves (coordinates as `round(v·1e5)`, `mx`, `my`), the point counts, and each LFO's `start`/`loop` index |
| `lfoTab` | Float32Array | 8·1025 | `[l·1025 + j] = evalPts(pts, j/1024)` |
| `lfoPtsOff` | Uint16Array | 9 | prefix offsets into `lfoPts`, **in points** |
| `lfoPts` | Float64Array | 3·Σpts | interleaved `[x, y, c]` per point |
| `lfoPm` | Uint8Array | 2·Σpts | interleaved `[mx, my]` per point |
| `lfoPmAny` | Uint8Array | 8 | 1 if the LFO has any bus link |
| `lfoStart` | Float64Array | 8 | `pts[start].x` |
| `lfoLoop` | Float64Array | 8 | `pts[loop].x` or −1 |
| `remap` | Float32Array | 2·2049 | `[o·2049 + j] = G(j/2048)` (osc remap graph) |
| `veloTab`, `noteTab` | Float32Array | 129 | curve at j/128 |

`lfoPts`/`lfoPm` lengths vary with the point count; DSP scratch for point-modulated evaluation is sized for `MAX_PTS` per LFO. The engine keeps the last CT it received per processor in `proc.ct` (cleared by `restore`); voices read curves only from `proc.ct`. A CP whose `ctKey` differs from `proc.ct.key` logs `console.warn` once per key and keeps using `proc.ct`; before any CT has arrived the DSP uses its built-in default CT (default triangle ×8, identity remaps, diagonal velo/note).

### 4.2 `compileFx(fx, ctx) → FXP` (stored as `patch.fxr` for every model)

`ctx = { bpm = 120, master, bypass, modded = null, seed = false, smooth = 1, silence = 1 }`: `master`/`bypass` = Serum's `s.p['g.master']`/`s.p['g.bypass']` (omit for non-Serum tracks → gain 1, not bypassed); `modded` = `fxModded(s)` (Uint8Array(100), §8.1; omit → zeros); `seed` = true only for the first patch after a preset, project, effect chain or module preset was loaded or the track was created (§8.5.2); `smooth`, `silence` = preferences (§9.7).

| Field | Type | Length | Content |
|---|---|---|---|
| `ver` | number | — | `FXP_VER = 1` |
| `NF` | number | — | 100 |
| `base` | Float64Array | 100 | fx idx order; `[0] = ctx.master ?? 1`, `[86] = ctx.bypass ?? 0`, others from `fx.p` |
| `order` | Uint8Array | 10 | module indices (§3.11) in processing order |
| `byp` | Uint8Array | 10 | by module index |
| `revType`, `choMono` | number | — | structured switches |
| `alloc` | Uint8Array | 10 | 1 when module m's enable base ≥ 0.5 or `modded[enable]`: the rack allocates that module's buffers inside `set()` |
| `filTypeAll` | number | — | 1 if `modded[fx.fil.type]`: the FX filter preallocates every family |
| `phase` | Float64Array | 4 | saved mod-FX LFO phases |
| `seed` | number | — | `ctx.seed ? 1 : 0` |
| `any` | number | — | advisory only (1 if any enable base ≥ 0.5); never used to bypass — bypass is decided from effective values |
| `bpm`, `smooth`, `silence` | number | — | |
| `xsKey` | string | — | key of the X-Shaper tables |

`FXT` — X-Shaper tables (`patch.fxrT`) = `{ key, xsA: Float32Array(1025), xsB: Float32Array(1025) }` (curves at j/1024), memoised by content and delivered like CT (the host strips an unchanged one; the rack keeps the last; built-in default = linear).

### 4.3 Versioning
- State: `s.v`, `fx.v` (int). `normalizeSerum`/`normalizeFx` migrate any older version step by step and always return the current version; unknown future versions are normalized best-effort (unknown keys dropped).
- Compiled: `CP.ver`, `FXP.ver`. A DSP script that receives a different major version MUST render silence (voices inactive / rack bypassed) and `console.warn` once; it MUST NOT throw.
- Tables: `entry.v = 1` on every `'wt'` entry.
- Additive changes (new DESTS/SOURCES appended) bump the minor only and keep indices.

### 4.4 Curves (`bend`, `evalPts`, `renderPts`) — shared definitions

```
bend(t, k) = |k| < 1e-4 ? t : (1 − e^(−k·t)) / (1 − e^(−k))          t ∈ [0,1]
  k > 0: fast start / slow end (concave);  k < 0: slow start (convex);  bend(0)=0, bend(1)=1, monotone.
evalPts(pts, x):
  x ≤ 0 → pts[0].y;  x ≥ 1 → pts[last].y
  j = largest index with pts[j].x ≤ x            (binary search; equal-x pairs ⇒ the later point wins = vertical step)
  if j = last → pts[last].y
  dx = pts[j+1].x − pts[j].x;  if dx ≤ 1e-9 → pts[j+1].y
  y = pts[j].y + (pts[j+1].y − pts[j].y) · bend((x − pts[j].x)/dx, CURVE_K · pts[j].c)
renderPts(pts, n) → Float32Array(n+1), [j] = evalPts(pts, j/n)
```
Constants: `CURVE_K = 10`, `ENV_K = 10`, `MC_K = 6`, `PORTA_K = 6`, `LFO_N = 1024`, `REMAP_N = 2048`, `XS_N = 1024`, `CURVE_N = 128` (velo/note), `MAX_PTS = 480`, `N_MATRIX = 32`, `N_LFO = 8`, `N_ENV = 3`, `N_MACRO = 4`, `N_BUS = 16`, `FRAME = 2048`, `MAX_FRAMES = 256`. serum-dsp re-implements `bend` and the segment evaluation verbatim (it cannot import) as `evalPts(ptsF64, off, n, x)` over the interleaved layout (`off`, `n` in points); a test compares them.

---

## 5. Modulation semantics (normative)

### 5.1 Knob space
All modulation happens in normalised space: a destination's eff `n` = `clamp(base + Σ offsets, 0, 1)`; the law (§3.1) is applied **after** summing. Stepped laws (int/enum/bool) round the eff `n` through the law. Modulation never writes back into state.

### 5.2 Row evaluation (identical in serum-dsp voice context, mono context and FX context)

```
s  = SRC[mSrc]                                   // native value: uni ∈ [0,1], bi ∈ [−1,1] (§3.12, SRC_POL)
if mK ≠ 0: s = uni ? bend(s, mK) : sign(s)·bend(|s|, mK)
x  = mBi ? 0.5·(uni ? 2s − 1 : s)                // bipolar row: ±amount·range/2 around base (inv A16.1, measured)
         :      s                                // unipolar row: up to amount·range (bi sources keep their sign)
if mAux: a = SRC[mAux]; a = (pol(aux) = bi) ? (a + 1)/2 : a;  a = clamp(a, 0, 1)
         x *= mInv ? (1 − a) : a                 // Default = product, (inv) = 1 − aux (inv A16.3)
offset[mDst] += mAmt · x                         // mAmt = amount·output
```
Example (test): LFO→`a.semi`, amount +1, bipolar, LFO value 1 → offset +0.5 → eff 1.0 → +12 st; value 0 → −12 st (inv A16.1).

### 5.3 Sources: timing
- Per-voice sources are computed once per chunk **before** the matrix (§5.6). Envelopes and LFOs return their value at the chunk start; the voice ramps audio-affecting results across the chunk (§5.4).
- Global sources (`wheel`, `at`, `bend`, `macro*`, `fixed`, Off-mode LFOs, mono chaos) are computed per chunk by `SerumDSP.begin` into `proc.sx.g[src·32 + c]` (c = chunk index within the span) and read by every voice. A render call not preceded by its own `begin` (fade-out tails, §8.4.3) reads chunk `sx.nCh − 1` for every chunk.
- `velo`, `rand1/2`, `alt1/2`, `note` (unless `note.porta`) are sampled at note-on and constant for the voice (`velo` updates on a legato note only if `velo.porta`).
- Destinations sampled at note-on (`mOn` rows) are evaluated once inside `noteOn` with note-on source values (§6.1).

### 5.4 Smoothing

| What | How |
|---|---|
| Base values (`CP.base`, continuous laws) | `SerumDSP.begin` keeps per-processor smoothed copies: two cascaded one-poles, τ = 6 ms × `CP.smooth` each, advanced once per span (as engine.js `smStep`); provides `baseA` (span start) and `baseD` (delta over the span). Voices use `baseA + baseD·(c+1)/nCh` for chunk c. A patch arriving while nothing sounds snaps (no glide). Stepped laws jump. |
| Wheel / AT / bend / poly AT | one-pole τ = 1.5 ms per chunk |
| Macros | one-pole τ = 6 ms × `CP.smooth` per chunk |
| Gains (levels, pans, on/route switches, ENV1×AMP, blend gains, filter mix) | evaluated at chunk boundaries, linearly ramped per sample across the chunk |
| Pitch / phase increments | per chunk (glide and modulation are smooth at 4-base-sample resolution); phase accumulators run per sample |
| Filter coefficients | per chunk (`SFilter.set`) |
| LFO output | optional SMOOTH one-pole (§6.12) |
| FX params | `FXRack`: base n smoothed (one-pole τ = 10 ms × `FXP.smooth` per span), mods ramped linearly across the `process` call (§5.5); coefficients recomputed every 16 samples |

### 5.5 Per-voice vs mono evaluation and the FX path
- **Voice context**: each active voice evaluates the active rows with `mCtx & 1` every chunk into its own offset vector (Float64Array(148)).
- **Most recent voice**: `proc.sx.recent` = the voice that received the latest `noteOn` (set inside `noteOn`). It stays the reference after release/until another note starts (its per-voice source values then freeze at their last values).
- **Mono source vector** `proc.sx.monoSrc` (Float64Array(34)): at the end of every span the recent voice copies its last-chunk per-voice source values into it; global sources are filled by `begin`.
- **`begin(proc, N)` order** (normative): (1) advance base smoothing (§5.4) and the performance smoothers (wheel, AT, bend, macros) per chunk; (2) **mono context**: evaluate the active rows with `mCtx & 2` from the previous span's `monoSrc` (global sources: their values at the last chunk of the previous span) → `proc.sx.monoOff` (Float64Array(148), raw offset sums) and `proc.sx.monoEff` (Float64Array(148), eff n = clamp(base + monoOff)); (3) per chunk: final `wheel`/`bend` source values (smoothed host value + `monoOff` of `g.wheel`/`g.bend`, §6.15), then the Off-mode LFOs and mono chaos advanced with `monoEff` rate/smooth/BPM and bus values; (4) write `sx.g` for every global source and chunk. The UI snapshot uses the recent voice's own eff vector (§8.4.4).
- **FX context** (`SerumDSP.fxMods(proc)`, after the voices, current span's `monoSrc`): evaluates the active rows with `mCtx & 4` → returns a reused `Float64Array(100)` of **offsets** (fx idx order). The engine passes it to `FXRack.setMods(arr)`. When a processor's model changes away from Serum the engine calls `setMods(null)` (offsets back to 0); other models never call `setMods`.
- FX modulation from per-voice sources therefore follows the most recently triggered note (inv A16.5 / A20.1).

### 5.6 Order inside one voice chunk (normative; breaks every feedback cycle)
1. Advance envelopes and LFO/chaos phases using the **previous chunk's** eff values of their own destinations (`V*`/`V*M`: env times and curves, LFO rate/rise/delay/smooth, chaos rate and BPM, bus values for point links).
2. Compute the voice's per-voice sources; read the global ones for chunk c.
3. Evaluate voice rows → eff[0…147] (destinations with `modded = 0` take the smoothed base without evaluation).
4. Derive engine values (pitch, levels, warp, filter …) for the chunk end; ramp continuous ones from the previous values across the chunk; stepped destinations take effect at the chunk boundary (on/route switches become gains ramped over the chunk, §1; a filter-type change calls `SFilter.setType`).
5. Render CH samples.
The first chunk after `noteOn` uses the base values for step 1 (and the note-on evaluation, §6.1, for the `mOn` destinations).

### 5.7 LFO point modulation (inv A13)
A point with `my = b` uses `y' = clamp(y + vb, 0, 1)`; with `mx = b`: `x' = clamp(x + vb, x_prev, x_next)` (neighbours' unmodulated x), where `vb` = engine value of `bus<b>` (lin −1…1; base always 0.5 → 0). An LFO with `lfoPmAny = 1` is evaluated with `evalPts` on the modified point list (per chunk, per voice — or once per chunk in `begin` for Off mode with the bus values from `monoEff`; bus destinations have scope `V*M`); otherwise via `lfoTab` (linear interpolation between the 1025 samples).

### 5.8 Drag-and-drop defaults and halo maths (UI, `serum-core` helpers; FX bases come from `fx.p`)
- Drop polarity: `bi = DESTS[dst].ctr ? 1 : 0`. Drop amount: bipolar 0.5; unipolar: with the preference "Limit mod depth on drop" on (default; `opts.limit`) `max(0.05, min(0.5, 1 − base))`, off → 0.5; bool destinations: `base ≥ 0.5 ? −1 : +1` (the source flips the switch once it passes the middle). Row goes to the first slot with `src === ''`; none free → no-op + notice "Matrix full (32 slots)".
- Halo arc of a row on its control (normalised, clamped to [0,1]): unipolar row with a unipolar source `[base, base + mAmt]` (ordered); unipolar row with a bipolar source (Chaos, Pitch Bend, Noise Osc, MPE X) `[base − |mAmt|, base + |mAmt|]`; bipolar row `[base − |mAmt|/2, base + |mAmt|/2]`. Aux sources are ignored (the arc shows the maximum reach). Colour: `sel` if the row's source is the selected source, `neg` if `amt·out < 0`, otherwise `other`. Live indicator = snapshot eff (§8.4.4).

---

## 6. Voice behaviour (serum-dsp, normative)

### 6.1 Note-on (`noteOn(n, vel01, legato, glc)`; `glc` ignored)

| Situation | Behaviour |
|---|---|
| note-on evaluation (every note-on, first) | the active rows with `mOn = 1` are evaluated once with note-on source values: `velo`, `note`, `rand1/2`, `alt1/2` of this note; global sources at their latest values (`sx.g`, chunk `sx.nCh − 1`); `env1–3` = their current value (0 for a fresh voice); LFO sources = their output at τ = 0 per §6.12 (restarting Trig/Env LFOs: value after the delay/rise rules at τ = 0; continuing ones: current value; Off: shared value); chaos = its current (or freshly seeded) output; `noise` = 0; `relvel` = 0.5; `pat` = current. The results give eff `a.uni`/`b.uni` (unison count N), and the eff phase/rand values used by §6.4 and §6.8. |
| fresh (voice inactive) | envelopes start from 0 (attack), Trig/Env LFOs restart at `lfoStart`, Off LFOs untouched, chaos (per-voice) reseeded from the voice PRNG, `rand1/2` drawn, `alt` taken from the processor flip-flop, unison count N sampled, Random-mode detunes drawn, oscillator phases initialised for **both** oscillators whatever their on state (§6.4), noise read position initialised, sub phase = 0, filter state cleared, `proc.sx.recent = this` |
| steal (voice active, `legato = false`) | as fresh **except**: envelopes restart from their current level (no jump), filter state kept, and oscillator phases are **not** reset unless poly legato is on (`CP.legato && !CP.mono`; inv A3: S1 steal behaviour) |
| poly legato (`CP.legato && !CP.mono`, `legato = false`, and another voice of this processor has `gate`) | R = the gated voice with the highest `stamp` other than this one. Envelopes copy R's stage, stage progress and level (no attack restart; R in Sustain ⇒ this voice starts in Sustain); Trig/Env-mode LFOs copy R's phase and delay/rise elapsed time; the portamento start pitch is R's current pitch; oscillator phases are initialised per §6.4 (inv A3: reset with Legato on in poly); everything else as fresh/steal. IMPL (inv A12/A17 describe it only as per-note legato / paraphonic). |
| legato (`legato = true`: engine mono legato with an overlapping key) | no envelope/LFO retrigger, phases continue, N is not re-sampled, pitch glides if porta > 0 else jumps; `velo` re-captured only if `veloPorta` |
| mono, previous note still sounding | `CP.mono` and this voice `active` at note-on (gated or in its release): Mem / MemTrig phase resets are skipped and the oscillator phases continue (inv A3, 1.35b7) |
| portamento | applies when porta time > 0 and (`always` or overlapping: `legato` arg, or mono with `proc.held.length > 1`, or poly with another voice `gate`); start pitch = R's pitch under poly legato, else `proc.sx.lastPitch` (current pitch of the previous recent voice, before this note). Duration T = time (`scaled`: × abs(Δst)/12). Progress `p(τ) = bend(τ/T, PORTA_K·c)`, c = eff `g.curve` value; pitch = start + (target − start)·p |
| pitch tracking off | while eff `a.track`/`b.track` = 0 that oscillator's note is MIDI 0 (8.18 Hz at A4 = 440) instead of `n`, with no glide (offsets, bend and modulation still apply) |

The engine decides same-note reuse (`CP.oneNote`, §11); a voice never inspects other voices except through `proc.voices` for poly legato and portamento overlap.

### 6.2 Note-off (`noteOff(rv)`), kill
`noteOff`: `gate = false`; envelopes enter release from their current level; Env-mode LFOs leave their loop and run to the end; `relvel = rv ?? 0.5` (the host passes the MIDI note-off velocity / 127; on-screen keyboard, song playback and `allOff` pass nothing). `kill()`: every state cleared, `active = false` (no fade; the engine renders its de-click tail beforehand). A voice becomes inactive when not gated and ENV 1 ≤ 1e-5 (−100 dB).

### 6.3 Pitch
Per oscillator o, unison voice i (semitones, MIDI scale):
`P = note' + 12·oct + semi + fine/100 + crs + stack_i + detune_i + bendSt + tune` where `note'` = gliding note (0 while that oscillator's eff tracking is off), `bendSt = bend ≥ 0 ? bend·bendUp : −bend·bendDn` (bend = the `bend` source value, §6.15; bendUp/Dn = eff `g.bendup`/`g.benddn` values), `tune` = eff `g.tune` value. `f = a4 · 2^((P − 69)/12)`, clamped to [0.01 Hz, 0.45·fs].
Sub: `P_sub = note' + 12·subOct + bendSt + tune` (subOct = eff `s.oct` value; the sub always tracks the gliding note; no fine/semi). Noise: §6.8.

### 6.4 Phase (OSC A/B; inv A3)
Let `ph` = eff `phase` n, `rd` = eff `rand` value (both from the note-on evaluation for the start phase), `u_i` uniform [0,1) per unison voice per note. The row is selected by the **base** values:

| Base PHASE | Base RAND | Start phase of unison voice i |
|---|---|---|
| n < 0.9995 | any | `frac(rd·u_i)`; the knob acts as a continuous offset (below) |
| n ≥ 0.9995 (Mem) | n < 0.9995 | `frac(proc.sx.memPh[o] + memSet[o·16+i])` — continues the previous note (`memPh[o]` = running phase of the recent voice's unison voice 0, updated per chunk) |
| Mem | n ≥ 0.9995 (MemTrig) | `memSet[o·16+i]` exactly (repeatable; inv A3 MemTrig) |

Read phase = accumulator + `min(ph, 0.99999)` (the PHASE knob is a continuous phase offset in cycles, so modulating it phase-modulates; in Mem modes the offset is 0). In mono with the previous note still sounding the start-phase rule is skipped (§6.1).
**Phase capture** (inv A3: "temporarily lowering RAND while a note plays captures a new random set, saved in the preset"; Mem locks the relative unison phases since 1.09b7): the snapshot carries `memNow` = the recent voice's unison phases relative to its unison voice 0, `frac(φ_i − φ_0)` (16 per oscillator; detuned voices drift apart, so these are a "new random set"). serum-ui captures them: while base PHASE of oscillator o is Mem and `snapshot.notes > 0`, when base RAND goes from < 0.9995 to ≥ 0.9995, it writes `memNow[o·16 … o·16+15]` into `osc[o].memSet` with `host.edit` (label `Capture phases`). The PHASE knob menu item `New MemTrig phase set` re-randomises `memSet` (seeded from the current time).

### 6.5 Wavetable read
- Table entry from `SerumDSP.tables.get(CP.wt[o])`, re-resolved when the id changes or `SerumDSP.epoch` changes (bumped by `storeWT`, `storeWTFrame`, `dropWT`). Missing entry ⇒ that oscillator contributes 0 (no throw); after `dropWT` of its id it goes silent.
- Frame: discrete (`entry.interp = 0`): `k = min(F−1, floor(pos·F))`; interpolating (`interp = 1`): `pos·(F−1)`, linear blend of two frames (F = `entry.frames`: R real frames for discrete and crossfade-morph tables, 256 for spectral-morph tables, §7.1). `pos` = eff `wt` value + unison offset, clamped. When the discrete frame changes, the voice crossfades old → new frame linearly over one chunk.
- Mip level per §7.4 with `speed` from §3.3. Hysteresis: a level with fewer harmonics is taken immediately (alias safety); a level with more harmonics only when H ≥ 1.05 × its `MIP_HARM`. A level change crossfades old → new level over one chunk.
- Sample read: 4-point cubic Hermite (Catmull-Rom) on the level's `len` (power of two, wrap with mask): `c1 = ½(x₁−x₋₁)`, `c2 = x₋₁ − 2.5x₀ + 2x₁ − ½x₂`, `c3 = ½(x₂−x₋₁) + 1.5(x₀−x₁)`, `y = ((c3·f + c2)·f + c1)·f + x₀`.

### 6.6 Unison mix
For osc o with N voices: `L_o = Σ_i g_i·cL_i·x_i`, `R_o = Σ_i g_i·cR_i·x_i`, then × `1/√(Σg²)`; `cL = √2·cos((p+1)π/4)`, `cR = √2·sin((p+1)π/4)`, p = pan position (§3.8). Then × on-gain × LEVEL (`pow2` value) and PAN balance with the same equal-power law (p = eff pan value). Sub: mono × on-gain × level (linear) × pan. Noise: stereo × on-gain × level (`pow2`) × pan balance.

### 6.7 Warp evaluation
- Mode per oscillator per chunk = eff `a.warpMode`/`b.warpMode` (stepped: changes at chunk boundaries), with the single-direction rule of §3.3.
- Warp amount per unison voice `w_i = clamp(eff warp + t_i·uniwarp·0.5, 0, 1)` (eff values).
- FM/AM/RM from the other oscillator: the modulator is the other osc's unison voice `i mod N_other`, raw (post its own warp, pre level/pan), **same sample**; the modulator osc is rendered first in that chunk. The modulator must be on (§3.3), else `m = 0`, `I = 0`. FM (Noise): mono average of the noise raw output; FM (Sub): sub raw output.
- Remap modes use the CT `remap` table with linear interpolation at `p·2048`.
- Per-sample transcendental approximations per §0.2.

### 6.8 Noise oscillator (inv A8)
Entry (§7.5) at its own `rate`. Read increment per OS sample (in level-0 samples): `inc = (rate/fs)·2^((pitchSt + key + (noiseKey ? fine/100 + bendSt : 0))/12)`, with `pitchSt` = eff `n.pitch` value (keytrack on: `round` to semitones), `key = noiseKey ? (note' − root) : 0`, fine = eff `n.fine` value; fine and pitch bend apply only with keytrack on (inv A19 "fine-tunes keytracked noise"). The Pitch Tracking switches affect OSC A/B only. Start position at note-on = `(phase + rand·u)·len` (phase/rand eff values from the note-on evaluation); PHASE also acts as a continuous position offset (scratch). Loop: when `!noiseOneshot`, wrap inside `[loopStart, loopEnd)` (whole file if absent); one-shot: output 0 after the end. **Band-limiting**: the voice reads level ℓ = the smallest available level with `inc/2^ℓ ≤ 1` (§7.5; position and loop points scaled by `2^−ℓ`), crossfading over one chunk when ℓ changes; increments above the last level alias (accepted). 4-point Hermite interpolation; mono files feed both channels.

### 6.9 Oversampling (inv A3/A19)
The processor of a Serum track runs at `OS = min(CP.os, osCap(base))` (engine, §11; deviation 9). Voices render everything at `proc.fs`; there is no voice-internal oversampling or decimation. Mip-level and noise-level selection use `proc.fs`. An OS change reaches the voices through `apply(p)` (§8.4.3).

### 6.10 Envelopes (ENV 1–3; inv A12)
AHDSR, value ∈ [0,1], ticked once per chunk (dt = CH/fs), times and curves from eff values (one-chunk lag). Stage progress `q` advances by dt/T (T = 0 ⇒ immediate). Attack: `v = v0 + (1 − v0)·bend(q, kA)` (v0 = level at trigger); Hold: 1; Decay: `v = 1 + (S − 1)·bend(q, kD)`; Sustain: `v = S` (follows S modulation); Release: `v = vR·(1 − bend(q, kR))` (vR = level at release). `kA = ENV_K·(2·ca − 1)`, `kD = ENV_K·(2·cd − 1)`, `kR = ENV_K·(2·cr − 1)` with ca/cd/cr = eff `eN.ca`/`eN.cd`/`eN.cr`. ENV 1's S is the `pow2` value (amplitude), ENV 2/3 linear. ENV 1 multiplies every source (ramped per sample); ENV 2/3 are sources only.

### 6.11 Filter (SFilter; inv A11)
- On/type/routing: eff `f.on` and `f.routeA/B/N/S` act as gains ramped over one chunk (§1); eff `f.type` changes call `SFilter.setType` at the chunk boundary (switching family resets that family's state).
- Cutoff Hz per channel: `fcL = fc·2^(+(0.5 − pan)·3)`, `fcR = fc·2^(−(0.5 − pan)·3)` (pan = eff `f.pan` n; ±1.5 octaves at the extremes; left of centre raises L). Key track: × `2^((note' − 60)/12)`. Clamp [8 Hz, 0.45·fs].
- Drive: input gain `10^(16·√drive / 20)` (≈ +8 dB at 25 %, +16 dB at 100 %, inv A11.1) into the family's nonlinearity (families without one apply soft `tanh` only above |x| > 1).
- Res ∈ [0,1], Var ∈ [0,1] per family (§3.4). Resonance laws (normative): SVF-based families `Q = 0.7071 / (1 − 0.99·res)` (res 0 = Butterworth, res 1 ≈ self-oscillation); ladder families feedback `k = 4.1·res` (self-oscillates from res ≈ 0.98; MG Low 6/12/18 tap earlier stages of the same 4-stage loop); comb/flange/phaser/bank feedback magnitudes as in §3.4. FAT (Normal and plain Cmb/Flg/Phs types): the resonance-path term `x` passes through `sat(x) = x + var·(tanh(3x)/3 − x)` (var 0 = linear). EQ family gain law: `dB = var < 0.5 ? max(−96, 40·log10(2·var)) : 48·(var − 0.5)` (0 → −96 dB, 0.5 → 0 dB, 1 → +24 dB).
- Mix: `out = (1 − mix)·dry + mix·wet` (linear). For type 80 (Combs) the voice filter uses mix = 1 regardless of `f.mix` (inv A11.1: MIX has no effect on Combs); the MIX knob is shown disabled.
- Level calibration: with res 0, drive 0, every LP/HP/BP/EQ family has passband gain 1 ± 1 dB (BP: peak gain 1).
- The recent voice writes its post-filter mono signal `(L+R)/2` (wet path only) into a 1024-sample ring `proc.sx.tap` while monitoring is on (`proc.sx.mon`); the snapshot exposes it as `filtTap` for the spectrum view (§9.3).

### 6.12 LFOs (inv A13)
- Phase φ ∈ [0,1). Rate: BPM off → Hz = eff `lN.rate` value (n = 0 ⇒ 0 Hz: phase holds); BPM on → ladder entry (§3.9) at the current `proc.bpm`.
- **Trig**: φ = `lfoStart` at note-on (not on legato), then advances. **Env**: like Trig but stops at φ = 1 (holds `y(1)`); with `lfoLoop ≥ 0` and `gate`, wraps from 1 to `lfoLoop`. **Off**: one shared phase per processor (in `begin`); BPM + Anchor and transport playing (`proc.songBeat()` ≠ null): `φ = frac(lfoStart + beat/beats)`; BPM + Anchor while stopped: `φ` advances from a processor beat clock at `proc.bpm`; otherwise free-running accumulation (reset to `lfoStart` by `SerumDSP.transport`, §6.16).
- **Anchor** in Trig/Env + BPM: `φ = frac(lfoStart + (beatNow − beatAtTrigger)/beats)` (jumps on rate change); Anchor off: accumulate increments (no jumps).
- Raw value `y = lfoTab` (or point-modulated `evalPts`). Delay/Rise (per voice, also for Off-mode LFOs, measured from note-on): during DELAY `out = y0` (first point's y); during RISE `out = y0 + (y − y0)·(τ/rise)`; then `out = y`. DELAY/RISE seconds = eff value (0–4 s); BPM on: × `120/proc.bpm` (tempo-relative; display in beats).
- SMOOTH: one-pole on `out`, τ = `0.5·smooth³` s (0 = off), per voice (Off mode: applied to the shared raw value before delay/rise).

### 6.13 Chaos 1 / 2 (inv A14)
- Chaos 1 = Rössler x (a = 0.2, b = 0.2, c = 5.7), output `clamp(x/12, −1, 1)`; Chaos 2 = Lorenz x (σ = 10, ρ = 28, β = 8/3), output `clamp(x/20, −1, 1)`. RK2 integration once per chunk with `dt_sys = rateHz·T0·CH/fs` (T0 = 6.07 for Rössler, 0.75 for Lorenz) and at most 0.02 per sub-step (sub-step as needed).
- BPM (eff `c1.bpm`/`c2.bpm`) on: rate snaps to the nearest straight ladder entry (`128·2^(−i)` beats, i = 0…14, log distance) at `proc.bpm`.
- S&H on: output holds and updates once per `1/rate` seconds. Mono on: one generator in `begin` (global source; initial state from the processor seed, re-seeded by `SerumDSP.transport`); off: one per voice, initial state at note-on from the voice PRNG (x, y, z ~ uniform ±1 offset from (1, 1, 1)).

### 6.14 Voice counter (inv A17)
`snapshot.oscVoices` = Σ over active voices of (A on ? N_A : 0) + (B on ? N_B : 0) + sub on + noise on (eff on values); `snapshot.maxVoices` = `poly · (16·onA + 16·onB + onSub + onNoise)` (base on values); `snapshot.notes` = number of gated voices.

### 6.15 Performance destinations and Bypass (inv A16.5)
- `g.wheel` (scope G): the `wheel` source per chunk = `clamp(wheelSmoothed + Σ offsets(g.wheel), 0, 1)`, where Σ offsets = `sx.monoOff[g.wheel]`, the raw (unclamped) sum of the mono-context row offsets (its `s.p` value is a placeholder and is ignored: the host's wheel is the base).
- `g.bend` (scope G): the `bend` source = `2·clamp((bendSmoothed + 1)/2 + sx.monoOff[g.bend], 0, 1) − 1`.
- Rows targeting G destinations are evaluated only in the mono context (one-span lag; a row whose source is the same performance control therefore feeds back with that lag and stays bounded by the clamp).
- `g.bypass` (FX segment, fx idx 86): when its eff value is on, the rack's output stage fades the processor output (main and direct bus, after master) to 0 over 5 ms and keeps it at 0; off fades back in over 5 ms. Voices and the rack keep running (state is not reset).

### 6.16 Transport, idle and reset hooks
- `SerumDSP.transport(proc, playing)` — the engine calls it whenever a transport *play with seek* is applied (`playing = true`) and on stop (`false`, bookkeeping only). On play: Off-mode LFO accumulators → `lfoStart`, the processor beat clock → `songBeat()`, mono chaos → its seeded initial state, the alt flip-flop → 0 (next note-on gives 1), the processor PRNG → its construction seed (voice PRNGs are reseeded from it at note-on). Voices are not touched. Together with `FXRack.transport()` this makes a song rendered from a given tick identical live and offline (§10.7).
- `SerumDSP.idle(proc, n)` — the engine's silence-skip path (§11) calls it instead of rendering: advances Off-mode LFO phases, the beat clock, mono chaos and the base/performance/macro smoothers by `n` base frames.
- `SerumDSP.reset(proc)` — panic and engine `restore()`: every `proc.sx` field back to its `attach` state (seeds included); voices are killed by the engine.

---

## 7. Wavetable data

### 7.1 Table object (main thread, `wt.js`)
```js
Table = {
  name: 'Basic Shapes',
  frames: [Float32Array(2048), ...],   // R real frames, 1 ≤ R ≤ 256
  morph: 0,                            // 0 none · 1 crossfade · 2 spectral · 3 spectral (zero fund. phase) · 4 spectral (zero all phases)
  factory: 0                           // 1 for factory content (never written as user data)
}
```
Playback interpolation is implied: smooth frame interpolation iff `morph ≠ 0` and R > 1 (inv A3: without a morph, WT POS steps between real frames).
`expandTable(t) → Float32Array(F·2048)` (display, export, spectral playback): if `morph ≠ 0` and 1 < R < 256 → F = 256 slots, else F = R raw frames.
- Crossfade (`morph = 1`): slot s = linear interpolation at `u = s·(R−1)/255` between frames `floor(u)` and `ceil(u)` — exactly what playback of the R real frames with interpolation produces (§7.5).
- Spectral (`morph = 2–4`): real frame k sits at slot `s_k = round(k·255/(R−1))`; slot s between `s_k` and `s_{k+1}` uses `t = (s − s_k)/(s_{k+1} − s_k)`: per bin k = 1…1023 magnitude `(1−t)|A_k| + t|B_k|` and phase `arg A_k + t·wrap(arg B_k − arg A_k)` (shortest arc, wrap to (−π, π]), DC = lerp, then inverse FFT (inv A10.7). Modes 3/4 differ only in what the MORPH menu op did to the real frames (§8.2.6).

### 7.2 Raw frame format
Contiguous `Float32Array(F·2048)`, frame f sample i at `[f·2048 + i]`, nominal range ±1 (values beyond are allowed and played as is).

### 7.3 Mip-map levels (`MIP_HARM`, `MIP_LEN`)

| level ℓ | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `harm` (max harmonic kept) | 1023 | 512 | 256 | 128 | 64 | 32 | 16 | 8 | 4 | 2 | 1 |
| `len` (samples per frame) | 2048 | 2048 | 2048 | 1024 | 512 | 256 | 256 | 256 | 256 | 256 | 256 |

`len = clamp(8·nextPow2(harm), 256, 2048)`. Level data: for each frame, `X = rfft(frame)` (2048 points), keep bins 0…harm (DC kept; bin 1024 always dropped), scale by `len/2048`, inverse real FFT of size `len`. Stored Float32, `data[f·len + j]`. Memory ≈ 36 KB per frame. Measured design point (§10.3): with 4-point Hermite reads this gives ≤ −74 dBc aliasing at 48/96/192 kHz.

### 7.4 Level selection (per unison voice, per chunk)
```
flim = proc.fs − min(20000, 0.45 · proc.base) // harmonics up to flim alias only above the audible band after decimation
H    = flim / (f0 · speed)                    // f0 = unison voice frequency, speed per warp (§3.3, with current w)
ℓ*   = first level with MIP_HARM[ℓ] ≤ H; if H < 1 → ℓ* = 10;  hysteresis per §6.5
```
A change of ℓ crossfades over one chunk. With OS ≥ 2 every harmonic below 20 kHz is kept; at OS 1 the octave-spaced levels may drop part of the top audible octave for some pitches (accepted, deviation 9).

### 7.5 Entries, messages, processor options
```js
// wavetable entry (also the payload of {t:'wt'}; transfer every data buffer)
{ t: 'wt', id, v: 1, kind: 'wt', frames: F, interp: 0|1, morph: 0..4,
  levels: [ { len, harm, data: Float32Array(F·len) } × 11 ] }
//   morph 0: F = R, interp 0 · morph 1 (crossfade): F = R real frames, interp 1 (not expanded) ·
//   morph 2–4: F = 256 expanded frames, interp 1 · R = 1: interp 0
// noise entry: level ℓ holds the source band-limited and decimated by 2^ℓ (§7.9)
{ t: 'wt', id, v: 1, kind: 'noise', rate: 48000, ch: 1|2, root: 60, len, loopStart, loopEnd,
  levels: [ { len, loopStart, loopEnd, L: Float32Array(len), R: Float32Array(len) | null } × 1–6 ] }
// replace one frame of a stored wavetable (live editing; F = R tables only — spectral-morph tables are re-sent whole)
{ t: 'wtf', id, frame: f, levels: [ { len, harm, data: Float32Array(len) } × 11 ] }
// free memory
{ t: 'wtdel', id }
```
- `SerumDSP.tables` is one `Map` per AudioWorkletGlobalScope, shared by every processor of the context. A message on any node's port reaches it. `SerumDSP.epoch` (global counter) is bumped by `storeWT`, `storeWTFrame` and `dropWT`; voices re-resolve their entries when it changes. Missing id → silent source until it arrives (output becomes non-silent within one chunk after `storeWT`).
- `processorOptions.wts` = array of entries (same objects without `t`) for `OfflineAudioContext` bounces, passed to the **first** node created in that context only (the Map is shared); the processor calls `SerumDSP.storeWT(e.id, e)` for each in its constructor.
- The host sends each id at most once per context (tracks `sent: Set`), re-sends after edits (`wt` or `wtf`), keeps a reference count of ids over every track's `needs`, and sends `wtdel` for an id that has been unreferenced for 10 s (then removes it from `sent`).
- Entries are always freshly built buffers (`makeEntry`/`makeNoise` never return cached buffers), because transferring detaches them.

### 7.6 Ids

| Prefix | Example | Source |
|---|---|---|
| `factory:` | `factory:Basic Shapes` | `wt.FACTORY_TABLES` (generated, deterministic) |
| `sub:` | `sub:RoundRect` | `wt.SUB_TABLES` (1-frame tables for the sub osc) |
| `noise:` | `noise:Pink` | `wt.NOISES` (generated, deterministic) |
| `user:` | `user:3f2a…` (UUID v4) | wavetables imported/edited/resampled by the user (`wtstore`) |
| `nzuser:` | `nzuser:9b1c…` | user noise samples (imports, "Send to Noise Oscillator", LFO → noise) |

Ids are opaque to DSP code. Copy-on-write: the first edit of a `factory:` table, or of a `user:` table in a new editor session, creates a new `user:` id named `<name> *` and repoints only the edited oscillator.

### 7.7 Morph / interpolation behaviour summary (inv A3, A9, A10.7)
- No morph → WT POS selects real frames discretely (one-chunk crossfade on change, no other smoothing).
- Crossfade morph → the R real frames are played with linear interpolation across the whole position range (identical to the 256-slot expansion).
- Spectral morphs → 256 frames expanded on the main thread before mip building; linear blend between adjacent slots at playback.
- `.txt` override (`X.txt` / `FolderInfo.txt`, inv A9): line 1 `[N]` samples per cycle (32–9999), line 2 `[interp]` (default) → morph 1 applied on import, `[no interp]` → morph 0.

### 7.8 Factory wavetables (`wt.FACTORY_TABLES`; original content, deterministic)
All frames are generated additively or in the time domain at 4× (8192 points) and band-limited by FFT truncation to 1023 harmonics, then peak-normalised to 1 (unless stated). `R` = real frames.

| id (`factory:` + name) | cat | R | morph | recipe |
|---|---|---|---|---|
| Default | Basic | 1 | 0 | saw `Σ_{k=1}^{1023} (2/πk)·sin(2πkφ)` (falling ramp) |
| Basic Shapes | Basic | 6 | 1 | sine, triangle, saw, square, pulse 25 %, pulse 12.5 % |
| Sine | Basic | 1 | 0 | `sin(2πφ)` |
| Triangle | Basic | 1 | 0 | odd harmonics `(8/π²)(−1)^((k−1)/2)/k²` |
| Square | Basic | 1 | 0 | odd harmonics `(4/π)/k` |
| Pulse 25 | Basic | 1 | 0 | band-limited 25 % pulse, DC removed |
| PWM Sweep | Analog | 64 | 1 | pulse duty 50 % → 2 % (frame f: duty `0.5 − 0.48·f/63`), DC removed |
| Sync Sweep | Analog | 64 | 1 | saw hard-synced at ratio `1 + 7·f/63` (time domain, then band-limit) |
| Sync Square | Analog | 64 | 1 | square hard-synced at ratio `1 + 5·f/63` |
| Analog Ramp | Analog | 32 | 1 | RC ramp `(1 − e^(−aφ))/(1 − e^(−a))·2 − 1`, `a = 0.01 + 6·f/31` |
| Saw to Square | Analog | 2 | 2 | saw, square (spectral morph) |
| Harmonic Sweep | Digital | 256 | 0 | frame f: harmonics 1…f+1 with amplitude 1/k |
| Odd Sweep | Digital | 64 | 1 | odd harmonics 1…(2f+1), amplitude 1/k |
| Bit Steps | Digital | 32 | 1 | sine quantised to `2^(8 − 7f/31)` levels (rounded) |
| Fold Sweep | Digital | 64 | 1 | `sin(π/2 · g · sin(2πφ))`, `g = 1 + 11·f/63` |
| Random Spectra | Digital | 64 | 2 | seeded: magnitude `k^(−u)`, u ∈ U[0.4, 1.6], random phase, bins 1…256 |
| FM Ratio 1 | FM | 64 | 1 | `sin(2πφ + I·sin(2πφ))`, `I = 10·f/63` |
| FM Ratio 2 | FM | 64 | 1 | `sin(2πφ + I·sin(4πφ))`, `I = 8·f/63` |
| FM Bell | FM | 64 | 1 | `sin(4πφ + I·sin(6πφ))`, `I = 6·f/63` |
| Phase Distortion | FM | 64 | 1 | `(1 − φ)·cos(2π·(1 + 15·f/63)·φ)` (resonant PD), DC removed |
| Vowels | Vocal | 5 | 2 | harmonic series f0 = 110 Hz, amplitude `Σ_formants g_j / (1 + ((k·f0 − F_j)/(F_j/8))²)` with table I vowels a e i o u (§3.5) |
| Formant Sweep | Vocal | 64 | 1 | single formant (BW = F/6) swept 200 → 3200 Hz (exp) over a 110 Hz harmonic series |
| Reed | Organic | 16 | 1 | odd harmonics `1/k^p` + even `0.2/k^p`, `p = 1.6 − f/15` |
| Bowed | Organic | 16 | 1 | saw spectrum × tilt `k^(−f/30)`, seeded phase jitter ±0.2 rad |
| Glass | Organic | 32 | 1 | harmonics {1,3,7,12,19,27,38,52} amplitude `k^(−0.5)`, seeded phases, brightness `k ≤ 8 + 1.5f` |
| Choir | Organic | 16 | 2 | as Vowels with table II, 16 frames cycling a e i o u |
| Granular Grit | Digital | 32 | 0 | seeded white noise segments, low-passed (harmonics ≤ 64 + 6f) |

`wt.SUB_TABLES`: `sub:Sine`, `sub:RoundRect`, `sub:Saw`, `sub:Square`, `sub:Pulse` (1 frame each, recipes §3.6, morph 0). They never appear in the wavetable menus.

### 7.9 Noise sources (`wt.NOISES`; original procedural content, deterministic)
Common: `rate = 48000`, `root = 60` (MIDI 60 = C4 in this app's naming, 261.63 Hz), seeded PRNG `mulberry32(fnv1a32(id))`, stereo = two independent streams unless stated. Loopable sources are generated with 4096 extra samples which are equal-power crossfaded into the start (seamless loop), `loopStart = 0`, `loopEnd = len`. `oneshot` = default for `noise.oneshot` when the user picks the source (UI sets it). Colours: RMS −12 dBFS; everything else peak −1 dBFS.
**Levels** (`noiseLevels`, §8.2.1): level 0 = the source; level ℓ+1 = level ℓ filtered by a 63-tap half-band FIR (Kaiser β = 9; circular convolution when the source loops over its whole length, linear otherwise) and decimated by 2, loop points halved (rounded); levels are built until `len < 64` or 6 levels exist (memory ≤ 2× the source). Whole-length loops shorter than 8192 samples (single cycles) are instead band-limited exactly by FFT truncation per level, so every level loops seamlessly.

| id (`noise:` + name) | cat | len (s) | oneshot | recipe |
|---|---|---|---|---|
| White | Colors | 2.73 (131072) | 0 | uniform white |
| Pink | Colors | 2.73 | 0 | Voss-McCartney 16 rows (−3 dB/oct) |
| Brown | Colors | 2.73 | 0 | leaky integrator of white (pole 0.998), −6 dB/oct |
| Blue | Colors | 2.73 | 0 | differentiated pink (+3 dB/oct) |
| Violet | Colors | 2.73 | 0 | first difference of white (+6 dB/oct) |
| Grey | Colors | 2.73 | 0 | white through an inverse-A-weighting-style filter (boost < 300 Hz and > 8 kHz) |
| Velvet | Colors | 2.73 | 0 | sparse ±1 impulses, density 2000/s |
| Mono White | Colors | 2.73 | 0 | white, mono (`ch = 1`) |
| Tape Hiss | Analog | 4 | 0 | pink + high shelf +6 dB @ 6 kHz, slow AM ±1 dB @ 0.3 Hz |
| Vinyl Crackle | Analog | 4 | 0 | Poisson pops (8/s, exp-decay 0.3–2 ms) + rumble (brown LP 40 Hz) |
| Mains Hum | Analog | 2 | 0 | 50 Hz + harmonics 1/k (k ≤ 20) + −30 dB hiss |
| Radio Static | Analog | 4 | 0 | BP-white (1–4 kHz) gated by random bursts |
| Circuit Bend | Analog | 4 | 0 | white through random S&H (rate random-walk 200–4000 Hz) |
| Analog Drift | Analog | 4 | 0 | very slow smoothed random walk (useful as Noise Osc mod source) |
| Bitcrush | Digital | 2.73 | 0 | white, S&H at 6 kHz, 4-bit |
| LFSR Long | Digital | 2.73 | 0 | 15-bit LFSR clocked at 32 kHz, ±1 |
| LFSR Short | Digital | 1 | 0 | 7-bit LFSR clocked so its period is 261.63 Hz (tonal, keytrack-ready) |
| Digital Grit | Digital | 2.73 | 0 | random steps, random lengths 1–64 samples |
| Data Stream | Digital | 4 | 0 | random bytes as signed 8-bit audio with sparse silence gaps |
| Modem | Digital | 4 | 0 | FSK tones 1200/2200 Hz switching on a seeded bit stream |
| Wind | Atmos | 6 | 0 | white → BP (Q 2) swept by a slow random walk 300–1500 Hz, AM |
| Rain | Atmos | 6 | 0 | dense droplets (2000/s, 1–3 ms decaying BP clicks) + pink bed |
| Surf | Atmos | 8 | 0 | pink with 0.12 Hz swells and LP sweep |
| Fire | Atmos | 6 | 0 | crackles (Poisson 30/s) + low roar (brown, LP 300 Hz) |
| Air Vent | Atmos | 4 | 0 | white → BP 600 Hz Q 0.7 + 120 Hz hum −20 dB |
| Breath | Tonal | 2 | 0 | white through 8 harmonic BPs at k·261.63 Hz (Q 30), amplitude 1/k |
| Choir Air | Tonal | 2 | 0 | white through formant table II vowel `a` at 261.63 Hz harmonics |
| Metal Ring | Tonal | 2 | 1 | inharmonic partials 1, 2.76, 5.40, 8.93, 13.34 × 261.63 Hz, exp decay 1.5 s |
| Glass Tone | Tonal | 2 | 1 | partials 1, 2.32, 4.25, 6.63 × 523.25 Hz, decay 1 s |
| Hollow Pipe | Tonal | 2 | 0 | white through a feedback comb at 261.63 Hz (g 0.97) |
| Click | Transient | 0.05 | 1 | 1-sample impulse + 2 ms BP 3 kHz ring |
| Tick | Transient | 0.05 | 1 | 5 ms decaying 6 kHz burst |
| Snap | Transient | 0.2 | 1 | white burst, 25 ms exp decay, HP 1 kHz |
| Thump | Transient | 0.3 | 1 | sine 60 Hz with pitch drop from 180 Hz, 120 ms decay |
| Hat Burst | Transient | 0.3 | 1 | white HP 7 kHz, 60 ms decay |
| Pluck Noise | Transient | 0.4 | 1 | white through decaying LP (8 kHz → 500 Hz in 200 ms) |
| Riser | FX | 4 | 1 | white → BP sweep 200 Hz → 10 kHz (exp), crescendo |
| Downlifter | FX | 4 | 1 | reverse of Riser with decrescendo |
| Whoosh | FX | 2 | 1 | pink → BP sweep up then down, Hann envelope |
| Impact Tail | FX | 3 | 1 | brown burst + 2.5 s exp decay with LP closing |
| Laser Zap | FX | 0.5 | 1 | sine 4 kHz → 80 Hz exponential glide + light noise |

`frameToNoise(frame)` (Send to Noise Oscillator, inv A10.5) and LFO → noise (inv A8): a 1-cycle loop, `len = 2048`, `rate = 2048·261.6256` (so it plays at the root pitch, MIDI 60, with PITCH 50 % and keytrack on), `ch = 1`, loop whole; its levels are exact FFT band-limits (above), so it is alias-free up to the last level.

### 7.10 Persistence (`wtstore.js`) and embedding
- IndexedDB database `synth-wt`, version 1, object store `tables` (keyPath `id`), index `kind`.
- Record: `{ id, kind: 'wt', name, frames: R, morph, data: ArrayBuffer (Float32 R·2048, little-endian), created, modified }` or `{ id, kind: 'noise', name, rate, ch, len, loopStart, loopEnd, root, L: ArrayBuffer, R: ArrayBuffer|null, created, modified }` (noise records store level 0 only; levels are rebuilt by `noiseEntry`).
- Portability (integrator): **exported** project files (`Save` download) and **exported** preset files (§9.10) carry `wts: { [id]: encodeEmbedded(record) }` for every `user:`/`nzuser:` id they reference. `wts` never lives in the in-memory project, the autosave (`localStorage`), the undo history or `localStorage` user presets. On import `decodeEmbedded` → `wtstore.put` (skip if an identical id exists), then the `wts` key is dropped.
- `encodeEmbedded(rec)` = the record with each ArrayBuffer replaced by base64 (`b64`, `b64L`, `b64R`); pure, in `wt.js`.

---

## 8. Module APIs

### 8.1 `serum-core.js` (E1)

Constants (all deep-frozen): `VERSION` (state, 1), `CP_VER` (1), `FXP_VER` (1), `MIDI0`, every constant in §4.4, `LAWS`, `LAW`, `FMT_CODES`, `WARPS`, `FILTERS`, `FILTER_CATS`, `FILTER_FAMILY`, `FORMANTS` (§3.5), `SUB_SHAPES`, `SUB_IDS`, `UNI_STACKS`, `UNI_MODES`, `LFO_LADDER`, `MODFX_LADDER`, `DLY_LADDER`, `FX_MODULES`, `FX_ORDER_DEFAULT`, `DIST_MODES`, `DIST_FILTER`, `DLY_MODES`, `REV_TYPES`, `REV_LABELS`, `EQ_TYPES_L`, `EQ_TYPES_H`, `CMP_RATIO_DETENTS`, `SOURCES` (`[{id, label, pol, scope, tile}]`), `SRC_INDEX`, `SRC_MENU`, `NSRC`, `DESTS` (`[{id, label, law, lo, hi, def, fmt, scope, ctr, group}]` — `law` = law name, `ctr` 0/1), `DEST_INDEX`, `NS`, `NF`, `ND`, `DIDX`, `FIDX`, `SIDX`, `MATRIX_ONLY`, `MODULE_FIELDS`, `FACTORY_PRESETS` (M3).

`group` values (menus): `Osc A`, `Osc B`, `Noise`, `Sub`, `Filter`, `Env 1`…`Env 3`, `LFO 1`…`LFO 8`, `Chaos`, `Global`, `LFO Bus`, `Master`, `FX Hyper/Dim`, `FX Distortion`, `FX Flanger`, `FX Phaser`, `FX Chorus`, `FX Delay`, `FX Compressor`, `FX Reverb`, `FX EQ`, `FX Filter`. The destination menu hides `MATRIX_ONLY` ids unless it is opened from the matrix.

`MODULE_FIELDS` (module locks, copy/paste/init of a module):

| module | `s.p` destinations | structured paths |
|---|---|---|
| `oscA` | every DEST with group `Osc A` (incl. `a.on`, `a.warpMode`, `a.track`, `a.stack`, uni dests) | `osc[0]` (`wt`, `remap`, `memSet`), `global.uniRange[0]`, `global.uniMode[0]` |
| `oscB` | group `Osc B` | `osc[1]`, `global.uniRange[1]`, `global.uniMode[1]` |
| `noise` | group `Noise` (incl. `n.on`) | `noise` |
| `sub` | group `Sub` (incl. `s.on`, `s.shape`, `s.oct`) | `sub` |
| `filter` | group `Filter` (incl. `f.on`, `f.type`, `f.routeA..S`) | `filter` |

| Function | Semantics |
|---|---|
| `bend(t, k)`, `evalPts(pts, x)`, `renderPts(pts, n)` | §4.4 |
| `lawValue(idOrIndex, n)`, `lawNorm(idOrIndex, v)` | §3.1 |
| `fmtParam(id, n, ctx?)` | §3.2 |
| `parseParam(id, text, ctx?) → n \| null` | accepts the formats `fmtParam` prints plus: comma decimal separator; units case-insensitive (`hz`, `k`/`khz`, `ms`, `s`, `%`, `db`, `st`, `ct`, `oct`, `°`); bare numbers in display units; time dests accept `1/8`, `1/4.`, `1/8T` (beats → s at `ctx.bpm`, not re-synced, inv A12); with their BPM switch on (from `ctx`), `lfoRate`, `modRate` and `dlyTime` dests accept their ladder labels (`1/8T`, `1/4.`, `4 bar T`; case and spaces ignored) → n = idx/(L−1), and `chaosRate` accepts straight ladder labels → n = `lawNorm(id, bpm/60/beats)`; `fx.cmp.att` in Limit accepts look-ahead ms 0–10 → n = √(ms/10); enums accept labels; returns clamped n or null |
| `semitoneAmount(dst, st, bi) → amt \| null` | matrix "12st" typing (inv A16.1): for semitone-linear dests with u semitones per engine unit — `a/b.semi`, `a/b.crs`, `g.tune`, `g.bendup`, `g.benddn` (u = 1), `a/b.oct`, `s.oct` (u = 12), `a/b.fine` (u = 0.01) — `amt = clamp((st/u)/(hi−lo)·(bi ? 2 : 1), −1, 1)`; other dests → null |
| `midiValue(id, cc) → n` | MIDI learn value (inv A2.3): `macro1..4` → cc/127; continuous DEST → cc/127; stepped DEST → `lawNorm(id, lawValue(id, cc/127))` (grid-exact; bool: cc ≥ 64 → on) |
| `isCenter(id)` | `DESTS[i].ctr` |
| `destLabel(id, s?, fx?)` | label; filter Var uses the current type's Var label (`f.var` → `FAT`…); reverb slots use `REV_LABELS` by `fx.rev.type` |
| `varLabel(type)` | `FILTERS[type].varLabel` |
| `lfoLadder(dot, trip)` | §3.9 |
| `defaultSerum()` / `normalizeSerum(s)` | §2. normalize: returns a **new** valid state; idempotent; tolerant of any JSON, `null`, older versions; clamps; snaps stepped laws; forces `bus*`, `g.wheel`, `g.bend` placeholders; repairs and rounds points (§2.3); drops unknown DEST/SOURCE ids in rows (row cleared) and unknown `midi` targets; enforces the warp single-direction rule (keeps A); pads/truncates matrix to 32 |
| `defaultFx()` / `normalizeFx(fx)` | §2.5 |
| `compileSerum(s, ctx)` / `compileFx(fx, ctx)` | §4 |
| `fxModded(s) → Uint8Array(100)` | 1 at fx idx k if an active row of `s` targets FX destination k (for `compileFx` ctx) |
| `uniTables()` | returns `{ uniShape, uniStack, uniCenter }` constant tables (§3.8; layouts `[mode·256 + (N−1)·16 + i]`, `[stack·256 + (N−1)·16 + i]`, `[(N−1)·16 + i]`) — the DSP's copies must equal them |
| `detuneShape(mode, t)`, `stackSemis(stack, i, N)` | §3.8 |
| `addMod(s, fx, src, dst, {amt, bi, slot, limit})` | mutates s; returns slot or −1 (full); defaults §5.8 (`limit` default true) |
| `modsFor(s, dst)` | `[{slot, row}]` rows with `row.dst === dst` (any state) |
| `removeMods(s, dst, src?)` | clears matching rows (to the empty row) |
| `setModAmount(s, slot, amt)`, `toggleModBypass(s, slot)`, `toggleModPolarity(s, slot)`, `reassignSource(s, fromSrc, toSrc)` | matrix edits (reassign = Alt-click on a source menu, inv A16.3) |
| `veloToAmp(s)` | adds row `{src: 'fixed', amt: −1, dst: 'g.amp', aux: 'velo', inv: 1}` (eff amp = velocity; inv A16.3 "Velo->Amp") unless an identical row exists |
| `vibratoAssign(s)` | next LFO (1…8) not used by any row: set it Trig, BPM off, rate n 0.48 (≈ 5.3 Hz), sine-like points; add row `{src: lfoK, dst: 'g.tune', bi: 1, amt: 0.008, aux: 'wheel'}` (±0.5 st at full wheel) |
| `initLfos(s)` | every LFO back to default, rows using LFO sources cleared (inv A2.1 "init all LFOs") |
| `copyLfo(s, from, to)` | Alt-drag tile onto tile (inv A13): mode, switches, points, loop/start, the four `lN.*` base values |
| `linkedBuses(s) → Map<bus, {points: [{lfo, pt, axis}], sources: [srcId]}>` | buses linked by any point, with the sources of rows targeting them |
| `newBus(s) → 1–16 \| 0` | lowest bus that no point links and no row targets (0 = none free) |
| `pruneBuses(s)` | in place: removes matrix rows whose destination is a bus that no point links any more (inv A13 "removing point mods deletes unused bus routings") |
| `clearPointMods(s, lfo, idxs)` | in place: clears `mx`/`my` on those points of `lfo[lfo].pts`, then `pruneBuses(s)` |
| `warpChoice(s, o, mode)` | in place (UI, inv A5): sets `p[a/b.warpMode] = mode/22`; if mode ∈ 18–20 and the other oscillator's base mode ∈ 18–20, sets the other to 0 (most recent choice wins). Modes 21–22 never affect the other oscillator |
| `lfoUsed(s, l)` | any matrix row (bypassed included) with `src` or `aux` = `lfo<l+1>` |
| `applyPreset(cur, preset)` | returns a **new** state: `normalizeSerum(preset.v.s)` (deep copy; never shares objects with `preset`), then: values of `cur.locks.p` synth ids copied from `cur`; whole modules in `cur.locks.mod` copied from `cur` per `MODULE_FIELDS`; `locks.misc.poly` → keep `voicing.poly`, `.os` → keep `global.os`, `.tuning` → keep `global.a4`; `locks` and `ui` from `cur`; `midi` = the preset's map when non-empty, else `cur.midi`; the warp single-direction rule re-applied (keeps A) |
| `applyPresetFx(curFx, presetFx, lockedIds)` | `curFx.lock` → deep copy of `curFx`; else `normalizeFx(presetFx ?? defaultFx())` with the values of locked FX dest ids from `curFx`, `ui` and `lock` from `curFx` |
| `FACTORY_PRESETS` | ≥ 24 original presets `{name, cat, v: {s}, fx}` (cats: Init, Bass, Lead, Pad, Pluck, Keys, Seq, FX) using only `factory:`/`sub:`/`noise:` ids; `Init` = defaults. Deep-frozen; consumers clone (via `applyPreset`). Milestone M3 |

### 8.2 `wt.js` (E2)

Pure and Worker-safe (no DOM, no `localStorage`), so the integrator may build entries in a module Worker (§11).

#### 8.2.1 Exports

| Export | Signature / semantics |
|---|---|
| `FRAME`, `MAX_FRAMES`, `MIP_HARM`, `MIP_LEN` | §7.3 |
| `fft(re, im, inverse)` | in-place radix-2 complex FFT, Float64Array, power-of-two n ≤ 65536; inverse scales by 1/n |
| `rfft(x) → {re, im}` | n/2+1 bins; `irfft(re, im, n) → Float64Array(n)` |
| `toSpectrum(frame) → {mag: Float64Array(1024), ph: Float64Array(1024)}` | editor units: index k−1 = harmonic k (1…1024); `mag = √A_k` **unclamped**, `A_k = 2·abs(X_k)/2048` (a full-scale sine shows 1; a peak-normalised square's fundamental ≈ 1.04); `ph = frac((arg X_k + π/2)/(2π) + 0.5)` — sine phase (arg = −π/2) = **0.5**, cosine phase = 0.75 |
| `fromSpectrum(mag, ph, dc = 0) → Float32Array(2048)` | exact inverse (A = max(0, mag)², arg = 2π·(ph − 0.5) − π/2, bins > 1023 ignored): `fromSpectrum(toSpectrum(f))` reproduces f within 1e-6 |
| `buildMips(table) → levels` | per §7.3 over the playback frames (§7.5: R frames for morph 0/1, `expandTable` for spectral morphs); `buildMipFrame(frame) → levels` (one frame, for `wtf`) |
| `makeEntry(id, table) → entry` | §7.5 wavetable entry, freshly allocated buffers on every call (generated tables are cached as `Table`s, never as entries) |
| `expandTable(table)` | §7.1 |
| `FACTORY_TABLES` | `[{id, name, cat, frames, morph}]` (§7.8, menu order) |
| `factoryTable(id) → Table` | generated on first call, cached; unknown → null |
| `SUB_TABLES` | ids of §3.6; `factoryTable('sub:Saw')` works too |
| `NOISES` | `[{id, name, cat, oneshot, seconds}]` (§7.9, menu order) |
| `makeNoise(id) → noise entry` | generated samples cached; returns an entry with fresh level buffers (§7.5) every call; unknown → null |
| `noiseLevels(L, R, len, loopStart, loopEnd, loopsWhole) → levels` | §7.9 level builder; `noiseEntry(rec) → entry` builds a §7.5 noise entry from a `wtstore` record or a `frameToNoise` result |
| `frameToNoise(frame, name)` / `lfoToNoise(tab)` | §7.9 |
| `bandlimit(x, over) → Float32Array(2048)` | one cycle rendered at `2048·over` points (e.g. `SerumDSP.renderWarp(…, {over: 4})`) → FFT, keep harmonics 1…1023 (+DC), inverse at 2048 (Render OSC Warp, PWM op) |
| `resampleCycle(x) → Float32Array(2048)` | any-length single cycle → 2048 by FFT resampling (band-limited) |
| `readWav(arrayBuffer) → {sr, bits, float, ch: Float32Array[], clm: {size, morph, factory} \| null, loop: {start, end} \| null}` | RIFF/WAVE little-endian; PCM 8 (unsigned), 16, 24, 32-bit; IEEE float 32/64; `WAVE_FORMAT_EXTENSIBLE` (PCM/float sub-formats); any channel count (returns all); `smpl` loop; tolerant of odd chunk padding; throws `Error('Not a WAV file')` / `Error('Unsupported WAV format')` |
| `writeWav({sr, ch, bits: 8\|16\|24\|32, float, clm?}) → ArrayBuffer` | `clm` chunk (§8.2.2) placed before `data` |
| `parseClm(text)`, `clmText({size, morph, factory})` | §8.2.2 |
| `parseTxtOverride(text) → {size, interp} \| null` | §7.7 |
| `parseSplitSize(text) → size \| null` | import split-size field (§9.9): integer 1–9999, or a note name (`B0`, `C#2`, `Db3`; C4 = MIDI 60, A4 = 440 Hz) → `round(44100 / f)`; `'0'`, `''` → null |
| `tableFromWav(wav, opts) → Table` | §8.2.5 import modes; `opts = {mode, size, channel}` |
| `tableToWav(table, {bits, frames?}) → ArrayBuffer` | Export All 32 f / 16-bit / selection (44100 Hz, mono, `clm` with morph flag, factory 0) |
| `tableTo256(table) → ArrayBuffer` | `.256`: each real frame resampled (FFT) to 256 samples, unsigned 8-bit (128 = 0), frames concatenated, no header |
| `tableToSingles(table) → [{name, buffer}]` | one 2048-sample 32-bit float WAV per real frame (`<name> 001.wav` …) |
| `importImage({width, height, data}) → Table` | PNG import (inv A10.10, S2M orientation): column x → frame (width > 256 → resampled to 256 columns), rows top → bottom = samples (resampled to 2048), luminance `0.2126R + 0.7152G + 0.0722B` (0…1) → amplitude `2·lum − 1`, then DC removed per frame |
| `importSingles([{ch, sr}]) → Table` | each file = one frame (first channel, resampled to 2048), ≤ 256 |
| `replaceFrame(table, f, wav) → Table` | drop on a thumbnail (inv A10.2) |
| `parseFormula`, `evalFormula`, `applyFormula`, `FORMULA_PRESETS` | §8.2.3 |
| `OPS` (registry), `applyOp(table, opId, ctx) → Table` | §8.2.6 |
| `drawTool(frame, tool, ctx) → Float32Array` | §8.2.7 |
| `fftOp(spec, row, opId, ctx) → spec` | §8.2.8 |
| `frameToPoints(frame, maxPts = 64) → pts` | Wavetable to LFO Shape (inv A13): Douglas-Peucker simplification of `(i/2048, 0.5 + 0.5·x)` to ≤ maxPts points, c = 0 |
| `ptsToFrame(tab1025) → Float32Array(2048)` | LFO → wavetable (Alt-drag LFO tile onto the display): `2y − 1` resampled, then band-limited |
| `encodeEmbedded(rec)`, `decodeEmbedded(obj)` | §7.10 |
| `uuid()` | `crypto.randomUUID()` when present, else RFC 4122 v4 from `Math.random` |

#### 8.2.2 `clm ` chunk
Chunk id `clm ` (with trailing space), payload ASCII `<!>2048 MF000000 wavetable (www.xferrecords.com)` where M = morph digit (0–4), F = factory digit (always 0 when written by us); pad byte if odd. The ID string is kept verbatim for file-format interoperability (it is a format marker, not branding shown to users). Reading: regex `/<!>(\d+)\s+(\d)(\d)/` → `size`, `morph`, `factory`; missing/garbled → `null`. `size ≠ 2048` → frames of `size` samples resampled to 2048 (FFT resampling, band-limited). Without `clm` and without a `.txt` override, a file whose length is a multiple of 2048 and ≤ 256·2048 imports as frames of 2048 (default import); otherwise the user's chosen import mode applies (default `pitchAvg`; a split size held in the formula field forces `manual`, §9.9).

#### 8.2.3 Formula parser (inv A10.12) — safe AST interpreter
Grammar (whitespace ignored; identifiers and function names case-insensitive):
```
formula   := assign
assign    := IDENT '=' assign | ternary            // assignment-like prefix: IDENT must be a variable name (x w y z q in sel rand rrnd);
                                                    // value = right side; if IDENT is y or z the formula is forced multi-frame
ternary   := land ( '?' ternary ':' ternary )?     // right-associative, lowest precedence
land      := lor  ( '&&' lor )*                    // priority 1 (binds loosest, muParser order)
lor       := cmp  ( '||' cmp )*                    // priority 2
cmp       := add  ( ('<='|'>='|'!='|'=='|'<'|'>') add )*   // priority 4, left-assoc, result 1 or 0
add       := mul  ( ('+'|'-') mul )*               // priority 5
mul       := unary( ('*'|'/'|'%') unary )*         // priority 6; % = JS remainder (sign of dividend)
unary     := ('-'|'+'|'!') unary | power           // so -2^2 = -4
power     := primary ( '^' unary )?                // priority 7, right-assoc: 2^3^2 = 512
primary   := NUMBER | IDENT | IDENT '(' args ')' | '(' formula ')'
args      := ternary ( ',' ternary )*
NUMBER    := digits [ '.' digits ] [ ('e'|'E') ['+'|'-'] digits ] | '.' digits
```
- Variables (per evaluation): `x` = `2i/2048 − 1` (−1…1 across the frame), `w` = `i/2048`, `y` = `f/255` (frame index of 256), `z` = `2y − 1`, `q` = harmonic 1…512, `in` = current value (time domain: sample; q-formula: magnitude of bin q in editor units, unclamped), `sel` = same position in the frame that was current when the formula started, `rand` = U(−1,1) per position, identical for every frame of one run, `rrnd` = reseeded per frame, `pi`, `e`.
- Functions: 1-arg `sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh log2 log10 log (base 10) ln exp sqrt sign rint (round half to even) abs`; variadic (≥ 1 arg) `min max sum avg`. Wrong arity → parse error.
- Logical ops treat ≠ 0 as true and return 1/0; `!` is logical not.
- Errors: `parseFormula(src) → { ok: false, pos, msg }` for unknown identifier, unbalanced parentheses, trailing input, empty input, wrong arity; identifiers `__proto__`, `constructor`, `prototype` are unknown. Success: `{ ok: true, ast, usesQ, multi, uses: Set }` where `multi` = uses `y` or `z` (incl. assignment target), `usesQ` = mentions `q` (q-formulas write magnitudes; mixing q with x/w evaluates x = w = 0).
- `evalFormula(src, vars) → number` (helper for tests). Non-finite results → 0.
- `applyFormula(table, {src, cur, sel, seed}) → {table, error?}`:
  - time-domain single: frame `cur` ← f(x…), clamped to [−1, 1];
  - time-domain multi: table becomes 256 real frames (morph 0); frame f uses `in` from frame `round(f·(F−1)/255)` of `expandTable(table)`;
  - q-formula: magnitudes of bins 1…512 ← `max(0, f(q…))`, bins 513…1023 ← 0, phases kept (bins whose old magnitude was 0 get sine phase, ph 0.5), then `fromSpectrum`; if the result peaks above 1 it is scaled to peak 1; multi q-formulas do this for all 256 frames;
  - errors leave the table untouched.
- `FORMULA_PRESETS = { singles: [{name, src}], multis: [{name, src}] }` (original): singles — Saw (spectral) `(1/q)^0.5`, Bright Saw `(1/q)^0.25`, Dull Saw `(1/q)^0.75`, Square (spectral) `(q%2==1)?(1/q)^0.5:0`, Triangle (spectral) `(q%2==1)?1/q:0`, Sine `sin(pi*x)`, Squarify `(q%2==1)?in:0`, Remove Fundamental `(q>1)?in:0`, First 16 `q<17`, Pulse 25 `(w<0.25)?1:-1`, Half Rectify `max(in,0)*2-1`, Soft Clip `tanh(3*in)`; multis — Harmonic Build `q<y*255+2`, Slope Sweep `(1/q)^(0.25+y)`, PWM `(w<0.5-0.48*y)?1:-1`, Fold Sweep `sin(pi*x*(1+6*y))`, Sync Sweep `sin(pi*(w*(1+7*y))*2)`, Odd to Even `(q%2==1)?(1-y)*(1/q)^0.5:y*(1/q)^0.5`. User formulas are stored by the UI in `host.storage` (`synth.sx.formulas`).

#### 8.2.4 Formula examples that MUST evaluate as stated (tests)
`1+2*3` = 7 · `2^3^2` = 512 · `-2^2` = −4 · `(1||0)&&0` = 0 · `1||0&&0` = 0 (&& binds loosest) · `1<2==1` = 1 · `5%3` = 2 · `-5%3` = −2 · `0?1:0?2:3` = 3 · `min(3,1,2)` = 1 · `avg(1,2,3)` = 2 · `sum(1)` = 1 · `log(100)` = 2 · `ln(e)` = 1 · `rint(2.5)` = 2 · `rint(3.5)` = 4 · `sign(-3)` = −1 · `!0` = 1 · `1/0` → 0 (non-finite) · `sum()` → error · `foo(1)` → error · `(1+2` → error at pos 4 · `constructor` → error.

#### 8.2.5 Import modes (`tableFromWav(wav, {mode, size})`; inv A10.10)

| mode | Behaviour |
|---|---|
| `clm` (auto) | `clm` chunk present: frames of `clm.size`, morph flag from chunk |
| `zeroSnap` | YIN pitch track (window 2048, hop 512, threshold 0.15); cycle boundaries at the predicted period, each snapped to the nearest upward zero crossing within ±10 % of a period; each cycle resampled to 2048 |
| `pitchFollow` | as zeroSnap without the snapping (variable-length segments from the pitch map) |
| `pitchAvg` | mean detected period P (median of voiced frames); cut every P samples; detected size returned in `table.importSize` (the editor writes it into the formula field, where it is reused, §9.9) |
| `manual` | `size` = integer 1–9999 samples (from `parseSplitSize`); returns `table.importMsg = 'split at: N samples (Hz, note ± cents)'` (Hz = 44100/N) |
| `fft256` / `fft512` / `fft1024` / `fft2048` | STFT with Hann window N, hop N/2: frame k = magnitudes of bins 1…N/2 mapped to harmonics 1…N/2 (≤ 1023) with the STFT phases, then `fromSpectrum` |

Common: first channel (OSC B drop of a stereo file → right channel, inv A10.10, `opts.channel = 1`); > 256 cycles → 256 evenly spaced cycles kept; each frame normalised to the global peak (Normalize Same); result morph 0.

#### 8.2.6 Editor operations (`OPS`, `applyOp(table, id, ctx)`)
`ctx = { cur, sel: [a, b] (inclusive frame range), to, grid (0–64), other: Table|null (the other oscillator's table), seed, n }`. Ops are pure (return a new Table). `grid` cell length `L = grid > 0 ? round(2048/grid) : 64`. "Sine phase" = ph 0.5 in editor units (§8.2.1).

| id | menu | label | semantics |
|---|---|---|---|
| `single.normalize` | Single | Normalize | frame cur scaled to peak 1 (no-op if silent) |
| `single.removeDC` | Single | Remove DC Offset | subtract mean |
| `single.flipV` | Single | Flip Vertical | negate |
| `single.flipH` | Single | Flip Horizontal | `y[i] = x[2047 − i]` |
| `single.shiftZero` | Single | Shift Horizontal to Zero Crossing | rotate so index 0 is the first upward zero crossing (`x[i−1] < 0 ≤ x[i]`), none → no-op |
| `single.init` | Single | Init (silence) | zeros |
| `single.fadeEdges` | Single | Fade Edges (grid size) | raised-cosine fade-in over first L and fade-out over last L samples |
| `single.xfadeEdges` | Single | X-fade Edges (grid size) | `y[2048−L+j] = x[2048−L+j] + ((j+1)/L)·(x[0] − x[2047])` (removes the wrap step) |
| `single.filter` | Single | Filter (grid size) | keep harmonics 1…H, H = grid > 0 ? grid : 1023, DC removed |
| `single.redux` | Single | Sample Redux at grid size | steps M = grid > 0 ? 16·grid : 64; `y[i] = x[floor(i·M/2048)·2048/M]` |
| `single.toNoise` | Single | Send to Noise Oscillator | host action (§8.9) |
| `all.normalizeEach` | Process | Normalize Each | per frame |
| `all.normalizeSame` | Process | Normalize Same | one factor from the global peak |
| `all.removeDC`, `all.flipV`, `all.flipH`, `all.fadeEdges`, `all.xfadeEdges`, `all.filter`, `all.redux`, `all.shiftZero` | Process | (as Single, all frames) | per frame |
| `all.xfade16` | Process | X-fade Edges (16 samples) | L = 16 |
| `all.removeFund` | Process | Remove Fundamental (HPF) | bins 0 and 1 zeroed |
| `all.half` | Process | Resize Tables to be Half | each frame split into two halves, each resampled to 2048 (frames ×2, ≤ 256; excess dropped from the end) |
| `all.double` | Process | Resize Tables to be Double | consecutive pairs concatenated (4096) and resampled to 2048 (frames ÷2, odd last frame paired with itself) |
| `all.pwm` | Process | Create PWM from this table to all | 256 frames: frame f = frame cur through PWM warp w = f/255 (§3.3 formula, read at 4× then band-limited) |
| `all.nudgeFund` | Process | Nudge all phases for fundamental to 50% | rotate each frame (circular shift by the fractional amount, via FFT) so harmonic 1 has sine phase (ph 0.5 = "50 %") |
| `all.setSpectra` / `all.setPhases` | Process | Set Spectra / Phases same for all frames | every frame takes frame cur's magnitudes / phases |
| `all.subtractOther` | Process | Subtract Spectra from other Osc | `mag_f = max(0, mag_f − mag_other(f'))`, f' = `round(f·(R_o−1)/(R−1))` (disabled if no `other`) |
| `all.blurBinsSpectra` / `all.blurBinsPhases` | Process | Bins: Blur Spectra / Phases | box blur over ±max(1, grid) bins |
| `all.blurFramesSpectra` / `all.blurFramesPhases` | Process | Frames: Blur Spectra / Phases | box blur over ±max(1, grid) frames |
| `all.removeLowSpectra` / `all.removeLowPhases` | Process | Remove Low Spectra / Phases (grid) | bins 1…grid magnitude 0 / phase reset to sine phase |
| `all.spectraFromOther` / `all.phasesFromOther` | Process | Set Spectra / Phases from Other Osc | per frame from `other` (f' as above) |
| `morph.crossfade` / `morph.spectral` | Morph | Morph – Crossfade / Spectral | `morph = 1 / 2` (needs 1 < R < 256, else no-op) |
| `morph.spectralZeroFund` | Morph | Morph – Spectral (zero fundamental phase) | real frames rotated so harmonic 1 has sine phase; `morph = 3` |
| `morph.spectralZeroAll` | Morph | Morph – Spectral (zero all phases) | real frames rebuilt with every bin at `arg X_k = 0` (cosine phase); `morph = 4` |
| `morph.remove` | Morph | Remove Morph Tables | `morph = 0` |
| `add.initAll` | Add/Remove | Init All | table = 1 frame of `factory:Default` |
| `add.insert` | Add/Remove | Insert at current index | copy of frame cur inserted after cur (≤ 256) |
| `add.remove` | Add/Remove | Remove current index | (R > 1) |
| `add.removeSel` | Add/Remove | Remove: multiselection | remove sel range (keep ≥ 1 frame) |
| `add.removeToSel` | Add/Remove | Remove: beginning→selected | remove frames 0…a−1 |
| `add.removeFromSel` | Add/Remove | Remove: selected→end | remove frames b+1…R−1 |
| `add.removeOthers` | Add/Remove | Remove: All (except selected) | keep sel range |
| `add.reduce` | Add/Remove | Reduce ▸ keep every Nth | `ctx.n` ∈ 2…16: keep frames with index % n = 0 |
| `add.move` | (thumbnail drag) | — | move frames `sel = [a, b]` to insertion index `ctx.to` ∈ [0, R] (index in the original numbering; R = end): `to ∈ [a, b+1]` → no-op; else remove the range and insert it at `to > b ? to − (b − a + 1) : to`; morph kept |
| `sort.peakSpect` / `sort.avgSpect` / `sort.peakAmt` / `sort.numSpect` / `sort.highSpect` / `sort.fund` | Sort | Peak Spect / Average Spect / Peak Amount / Num w/ Spect / Highest w/ Spect / Fundamental amt. | stable ascending sort by: index of the largest bin / centroid Σk·m/Σm / largest magnitude / count of bins with m > 1e-3·max / highest bin with m > 1e-3·max / magnitude of bin 1 |
| `sort.random` | Sort | Sort Random | seeded Fisher–Yates (`ctx.seed`) |
| `sort.reverse` | Sort | Reverse entire table order | |

Import/Export menu items map to §8.2.1/§8.2.5 functions (they need files, so wtedit owns them).

#### 8.2.7 Draw tools (`drawTool(frame, tool, {x0, x1, y0, y1, grid, cell})`; inv A10.3)
Coordinates: x ∈ [0,1] across the frame, y ∈ [−1,1]. With grid g > 0 the stroke is quantised to whole cells (`cell = [i0, i1)` sample range of the cell under the pointer); with g = 0, `flat` is free-hand (line from previous to current pointer sample) and the shaped tools act on the dragged span.

| tool id | label | effect on the cell / span `[i0,i1)` at height y (pointer) |
|---|---|---|
| `flat` | Flat Line | constant y |
| `slopeUp` / `slopeDown` | Slope Up / Down | linear ramp −y→y / y→−y |
| `sine` | Sine | add `y·sin(2π·g·i/2048)` over the whole frame (harmonic = grid size; g = 0 → harmonic 1) |
| `halfValley` / `halfPeak` | Half sine (valley / peak) | `−abs(y)·sin(π·u)` / `abs(y)·sin(π·u)`, u = cell position 0…1 |
| `curveUp` / `curveDown` | Curve up / down (¼ sine) | `y·sin(π/2·u)` / `y·cos(π/2·u)` |
| `interpLin` | Interpolate linear | straight line between the cell's endpoint samples |
| `interpCurve` | Interpolate curved | half-cosine blend between the endpoints |
| `nudge` | Nudge | add (pointer dy) to the cell, clip to ±1 |
| `noise` | Noise | drag up: add seeded noise of amplitude dy; drag down: low-pass (one-pole forward-backward) towards smooth |

#### 8.2.8 FFT area menu (`fftOp(spec, row, id, {bin, seed})`; `spec = {mag, ph}` in editor units; `row` = `'mag'` \| `'ph'`)
`bin` = the harmonic (1…1024) under the pointer when the menu was opened ("bin X" in the labels). Ops: `clearAll`, `clearHF` (bins ≥ bin cleared), `clearLF` (bins ≤ bin cleared), `saw` (mag `(1/k)^0.5`, ph 0.5), `randLow` (bins 1…bin random 0…1), `randLowHalf` (bins 1…bin random from {0, 0.5, 1}), `randAll`, `gaps` (random series gaps: each bin cleared with p 0.5), `fade` (progressive fade `× (1 − k/1024)²`), `octUp` (bin k → 2k), `octDown` (bin 2k → k), `odd` / `even` (clear the other parity), plus draw modes (UI state, not ops) `snapQuarter` (drawn values snap to 0/0.25/0.5/0.75/1 of the display range) and `scaleByBin` (drawn value v is stored as `v·(1/k)^0.5·√2` so a flat 50 % line draws a saw). Phase-row ops act on `ph`; on that row "cleared" means sine phase (0.5), `saw` sets every phase to 0.5 and `fade` moves phases toward 0.5 by the same factor.

### 8.3 `wtstore.js` (E2)

| Export | Semantics |
|---|---|
| `openStore() → Promise<Store>` | opens/creates DB (§7.10); rejects if IndexedDB is unavailable (callers fall back to memory) |
| `store.list({kind}?) → Promise<[{id, kind, name, frames?, seconds?, modified}]>` | sorted by name |
| `store.get(id) → Promise<Table \| NoiseRecord \| null>` | wavetables return a `Table` (frames sliced from the buffer); noise returns the record (level 0; `wt.noiseEntry` builds the entry) |
| `store.put(obj, {id?, name}) → Promise<id>` | Table or noise record/entry (level 0 stored); assigns `user:`/`nzuser:` + `uuid()` when no id; sets `created`/`modified` |
| `store.rename(id, name)`, `store.del(id)` | |
| `store.gc(keepIds) → Promise<count>` | deletes records not in `keepIds` and older than 7 days |
| `memoryStore()` | same API backed by a `Map` (fallback, tests) |

### 8.4 `serum-dsp.js` (E3) — `globalThis.SerumDSP`

#### 8.4.1 Host fields the DSP may read on `proc` (engine.js provides them; tests stub them)

| Field | Meaning |
|---|---|
| `fs`, `base`, `OS`, `CH` | OS rate, context rate, oversampling factor, chunk length (`4·OS`) |
| `p` | current engine patch; `p.serum` = CP, `p.fxr` = FXP |
| `ct` | last CT received (`patch.serumT`), or null |
| `bendRaw` (−1…1), `wheel` (0…1), `at` (0…1) | performance controls (raw; SerumDSP smooths) |
| `pat` (Float64Array(128)), `patSeen` (bool) | poly pressure per note (0…1) and whether any arrived |
| `bpm` | `60·base/(fpt·960)` while the transport plays, else `p.bpm` |
| `songBeat()` | song position in beats at the start of the current span, or `null` when the transport is stopped |
| `held` | mono note stack (array of notes) |
| `voices` | array of the processor's voices |
| `sx` | **reserved for SerumDSP** per-processor state (created by `attach`) |

#### 8.4.2 Exports

| Member | Semantics |
|---|---|
| `VER` | 1 (CP major understood) |
| `DIDX`, `FIDX`, `SIDX` | frozen index constants (§3.13 naming rule) |
| `LAW_TAB` | `{ law: Uint8Array(248), lo: Float64Array(248), hi: Float64Array(248), cont: Uint8Array(248) }` in DEST index order (synth 0–147, FX 148–247); `law` = §3.1 index, `cont` = 1 for continuous laws (smoothed, §5.4), 0 for int/enum/bool (jump) |
| `SRC_POL` | Uint8Array(34), 1 = bipolar source |
| `SUB_IDS`, `FILTER_FAMILY`, `FILTER_FAM_OF` (Uint8Array(96): family index per type) | constants (§3.4, §3.6) |
| `UNI` | `{ uniShape, uniStack, uniCenter }` computed at load (§3.8) |
| `tables` | `Map<id, entry>` (survives re-evaluation of the script) |
| `epoch` | getter: global counter bumped by `storeWT`, `storeWTFrame`, `dropWT` |
| `storeWT(id, entry) → boolean` | validates (`kind`, frames 1–256, 11 levels with `data.length = frames·len`, noise level lengths), stores, bumps `epoch`; invalid → `console.warn` once per id, returns false |
| `storeWTFrame(id, f, levels) → boolean` | copies one frame into the stored entry in place, bumps `epoch` |
| `dropWT(id)` | deletes, bumps `epoch` |
| `attach(proc)` | idempotent: creates `proc.sx` on first call with every buffer at its maximum size (OS-independent: global source block `Float64Array(34·32)`, smoothers, `monoSrc`, `monoOff`, `monoEff`, FX offsets, tap ring, snapshot object, processor PRNG seed); later calls reallocate nothing (OS-dependent sizes, if any, are resized only when `proc.OS` changed). Called from the `SerumVoice` constructor and `apply` — so `noteOn` works before the first `begin`. A CP change never resets `sx` state. |
| `reset(proc)`, `idle(proc, n)`, `transport(proc, playing)` | §6.16 |
| `begin(proc, N)` | once per span before the voices; order §5.5; increments `sx.span`, sets `sx.nCh`; never allocates |
| `fxMods(proc) → Float64Array(100)` | after the voices: FX-context rows (§5.5); reused array; zeros when no rows target FX |
| `snapshot(proc) → object \| null` | null when `proc.sx` is absent; else a reused object: `{ eff: Float32Array(248)` (recent voice's last eff for 0–147, FX base + offsets clamped for 148–247, base when nothing played yet), `lfoPh: Float32Array(8)`, `lfoOut: Float32Array(8)`, `env: Float32Array(3)`, `envStage: Uint8Array(3)` (0 idle, 1 A, 2 H, 3 D, 4 S, 5 R), `envT: Float32Array(3)` (seconds into the current stage), `wtPos: Float32Array(2)` (eff position n of unison voice 0, incl. its unison offset), `noisePos` (0–1), `notes` (int: gated voices), `oscVoices` (int), `maxVoices` (int), `memNow: Float32Array(32)` (§6.4), `filtTap: Float32Array(1024)` (§6.11, oldest first), `tapRate` (Hz) `}` |
| `warmUp(proc)` | JIT warm-up (§11): stores a synthetic table `'__warm'` (64 frames, crossfade morph), builds two temporary `SerumVoice`s on `proc`, renders ≈ 0.25 s through every hot path (unison 16 on both oscillators, discrete and interpolating tables, one mode of every warp family incl. FM from B, every filter family, LFO Trig/Env/Off incl. point modulation, chaos, noise on two levels, direct out), then drops the table, discards the voices and calls `reset(proc)` |
| `SerumVoice` | §8.4.3 |
| `SFilter` | §8.4.5 |
| `bend(t, k)`, `evalPts(ptsF64, off, n, x)` | §4.4 (for tests) |
| `renderWarp(frame, mode, amt, opts) → Float32Array(2048·over)` | main-thread helper (2D display, Render OSC Warp): one cycle of `frame` (Float32Array 2048) through warp `mode` at amount `amt`; `opts = { over = 1, remap: Float32Array(2049)?, mod: Float32Array(2048)? }` (mod = modulator cycle for 18–22, read at the same phase; absent → `m = 0`); Hermite reads of level 0 |
| `filterImpulse(type, fc, res, drive, vr, fs, len = 4096) → Float64Array(len)` | main-thread helper: left-channel response of a fresh `SFilter` to a 0.01-amplitude impulse, divided by 0.01 (UI FFTs it for the display) |

#### 8.4.3 `SerumVoice`
```
new SerumVoice(proc, i)              // calls SerumDSP.attach(proc); allocates per-voice buffers (16 unison voices × 2 oscs, envs, LFOs, tap); SFilter without family memory
fields (engine-visible): active = false, gate = false, note = -1, stamp = 0, sus = false, vel = 0
engine-owned names — the voice never defines, reads or writes them: det, pitch, target, glc
apply(p)                             // patch changed OR the processor's OS changed (engine setOS calls it): copies CP scalars into
                                     // constructor-initialised numeric fields; re-reads proc.fs/OS/CH, resizes OS-dependent buffers
                                     // (allocation allowed here), SFilter.setRate; calls SFilter.setType(base type) and
                                     // prealloc(true) when CP.modded[f.type]; never resets sounding state; resolves tables lazily
noteOn(n, vel01, legato, glc)        // §6.1 (works before any begin)
noteOff(rv)                          // §6.2 (rv optional release velocity 0–1)
kill()                               // §6.2
render(bufL, bufR, N, dirL, dirR)    // ADDS N OS-rate samples (N multiple of proc.CH, N ≤ 128·OS); dirL/dirR only when CP.direct
```
- **Render without `begin`** (engine fade-out tails, §11): `begin` increments `sx.span`; a voice that already rendered in the current span (or for which `begin` never ran) treats the call as an *extra render*: span-end base values (`baseA + baseD`) and the global sources of chunk `sx.nCh − 1` for every chunk. Any number of consecutive extra renders produce finite, continuous output.
- `begin` rescales its per-chunk coefficients when `proc.CH` changed since the last span.
- **CPU budgets** (normative targets; node, M-class laptop, base 48 kHz; a test fails only beyond 3× the target, machines vary):
  (a) OS 2: 8 voices × unison 16 × 2 oscillators, no warp, 1-frame table, filter MG Low 24 → 1 s of audio in ≤ 0.4 s;
  (b) OS 2: 8 voices × unison 16 × 2 oscillators, 256-frame interpolating table, WT POS modulated by an LFO at 2 Hz, Bend + at 50 % on both → 1 s in ≤ 0.9 s;
  (c) `begin` + `fxMods` ≤ 2 % of (a); idle voices cost nothing. (a) and (b) are also printed for OS 1 and 4 (informative).
- **Memory budget**: a voice whose filter family has no delay memory ≤ 256 KB at fs 192 kHz; delay families allocate on demand (≤ 2 MB per voice at fs 192 kHz).

#### 8.4.4 Snapshot / monitor
The engine posts `{t:'smon', s: snapshot | null, gr: rack.gr(), fxph: rack.phases()}` at ≤ 30 Hz of audio time while a UI has asked for it (`proc.sx.mon`, §11). Arrays are copied (not transferred).

#### 8.4.5 `SFilter` (standalone; also used by fx-dsp's Filter module)
```
new SFilter(fs)                      // no delay memory yet
setRate(fs)                          // recompute rate-dependent constants; resizes the memory of families already allocated
setType(t)                           // 0–95; switching family resets state, same family keeps state; allocates the family's memory if missing
prealloc(all)                        // all = true: allocate every family now (type is modulated: setType must never allocate in render)
set(fcL, fcR, res, drive, vr)        // Hz, Hz, 0–1, 0–1, 0–1; cheap enough to call per sample
tick(xl, xr)                         // one stereo sample → this.yl, this.yr
process(L, R, off, n)                // in place on Float64Array range [off, off+n), current params
reset()
```
Behaviour per family/type: §3.4 + §6.11 (drive gain, EQ gain law, Var mapping, `f_var`, HL width). `set` clamps fc to [8, 0.45·fs]. Delay families size their lines for the 8 Hz minimum at the current fs (grow-only pool; Float32Array for lines longer than 4096 samples). `setType` from `render` happens only for modulated types, which `prealloc`ated in `apply`.

### 8.5 `fx-dsp.js` (E4) — `globalThis.FXDSP`

#### 8.5.1 Exports

| Member | Semantics |
|---|---|
| `VER` | 1 |
| `FIDX`, `LAW_TAB_FX` | same constants as SerumDSP (FX segment, fx idx order) |
| `FXRack` | §8.5.2 |
| `distCurve(mode, drive, xsA, xsB, n = 257) → Float64Array(n)` | static transfer y(x) for x = −1…1 (UI display; Downsample returns y = 0.5x) |
| `eqResponse(fxp, effN, freqs, fs) → Float64Array` | magnitude dB of the 2-band EQ at `freqs` (exact biquad maths used by the module) |
| `delayFilterResponse(F, bwOct, freqs, fs) → Float64Array` | dB response of the delay's band filter (flat 0 dB when bypassed, §8.5.3) |
| `MODFX_HZ(n, bpmOn, bpm)` | rate helper used by UI tooltips |
| `filterImpulse(...)` | re-export of `SerumDSP.filterImpulse`, resolved at call time (null if SerumDSP is missing) — so `fx-ui.js` needs only FXDSP |

#### 8.5.2 `FXRack`
```
new FXRack(base)                     // base = context sample rate; bookkeeping only (no module buffers)
set(fxp | null, fxt?)                // apply compiled FXP (any time; smooth; first call snaps). null = every module off, master 1, not
                                     // bypassed. Allocates the buffers of modules with fxp.alloc[m] (Float32 for lines > 100 ms) and every
                                     // filter family when fxp.filTypeAll. fxt = patch.fxrT when present (X-Shaper tables, kept until
                                     // replaced). fxp.seed = 1 → re-seed the LFO phases from fxp.phase. Module enable 0→1 resets that module.
setMods(offsets | null)              // Float64Array(100) of normalised offsets (fx idx); copied; reached linearly across the next process(); null = zeros
process(L, R, n, dL?, dR?)           // in place, Float64Array, n ≤ 128 base frames; modules in fxp.order; + dL/dR; × master × bypass gate
trigger()                            // a note-on happened (Hyper RETRIG)
reset(soft = false)                  // clear every delay line / state; soft: first fade the rack output to 0 over 5 ms (click-free tails off)
idle() → boolean                     // true when no module is effectively enabled, or every enabled module's output stayed < 1e-6 for ≥ 1 s with zero input
gr() → Float32Array(4)               // [single-band GR dB (≥ 0), MB low GR, MB mid GR, MB high GR] (multiband: GR may be negative = upward gain)
phases() → Float64Array(4)           // current LFO phases [hyper, flanger L, phaser L, chorus]
transport()                          // transport play with seek: re-seed LFO phases from the last fxp.phase (no state is cleared)
warmUp()                             // runs every module and mode for ≈ 0.1 s on internal noise, then reset(); restores the previous fxp
latency                              // samples of look-ahead (Compressor Limit mode), else 0
```
- **Effective values**: per `process` call, `eff = clamp(baseSmoothed + mod, 0, 1)` → law (§3.1) → engine value. Module enabled ⇔ eff `fx.<m>.on` ≥ 0.5 **and** `byp[m] = 0` (`alloc` guarantees its buffers exist whenever this can be true). Enable/disable crossfades the module's output with its input over 5 ms; after a disable fade the module stops and resets (tail cut, as Serum). Switch/enum destinations (BPM, modes, types, link, multiband, retrig) take effect at the next 16-sample coefficient update.
- **Bypass-cheap**: when no module is enabled, `dL` is absent, master gain = 1 ± 1e-9 and bypass is off, `process` returns after O(1) work and leaves L/R bit-identical.
- **Mix law** (inv A20.2): `out = in·(1 − m²) + wet·sin²(π·m/2)`; LEVEL trim gain `(2n)²` after the mix (`fx.<m>.level`). EQ: no mix/level. Hyper and Dimension are additive: `out = in + m·wet` (their MIX scales the added signal).
- **Hyper/Dimension order**: the module's output = Dimension(Hyper(x)); each section applies its own MIX and LEVEL (inv A20.4.1).
- Master stage: `× g.master` value (pow3; base from `ctx.master`) ramped per sample, then the bypass gate (§6.15).
- **Phase memory** (inv A20.1): LFO k (0 Hyper, 1 Flanger L, 2 Phaser L, 3 Chorus) is re-seeded from `fxp.phase[k]` when `set` receives `seed = 1` and on `transport()` — never on ordinary edits. Flanger/Phaser R = L + PHASE offset; Chorus taps per §8.5.3 relative to `phase[3]`; Hyper voice j starts at `frac(phase[0] + 0.618·j)`. Rate 0 (Hz law n = 0, or ladder index 0 `Off`) holds the phase.
- Smoothing τ = 10 ms × `fxp.smooth`. Denormal flushing on every feedback state once per call.
- **Memory budget**: an idle rack (nothing allocated) ≤ 64 KB; all modules allocated ≤ 4 MB at base 192 kHz.

#### 8.5.3 Module recipes (normative where tested in §10.5; otherwise IMPL-free within the stated character)

| Module | Recipe |
|---|---|
| Hyper | N = unison (0 = Hyper off). Voice j: delay line read at `d_j = 1.5 + 2.2·j ms + depth_j(t)`, `depth_j = detune·3 ms·(0.5 + 0.5·sin(2π·φ_j))`, φ_j advancing at `f_j = rateHz·(0.83 + 0.11·j)`, `rateHz = 0.1 + 6·rate²`; voices panned alternately (±(0.3 + 0.1·j)); wet = Σ voices·(1/√N); RETRIG (eff `fx.hyper.retrig`): `trigger()` sets every φ_j to `frac(phase[0] + 0.618·j)` (unison "laser" start, repeatable). Measured target: at mix 1, +2.5 dB ± 1.5 dB total on a saw, side ≈ −4.5 dB. |
| Dimension | 4 lines at `T_k = (0.3 + 1.7·size)·[7.3, 11.9, 17.1, 23.3] ms` fed with mono `(L+R)/2`, each with AM `1 + 0.3·sin(2π·[0.13,0.17,0.23,0.29]·t)`; `side = (l0 − l1 + l2 − l3)/2`; `L += mix·side·0.45`, `R −= mix·side·0.45` (mid untouched; side ≈ −10 dB at mix 0.5); input = Hyper section output |
| Distortion | filter (eff `fx.dist.filt` OFF/PRE/POST) TPT SVF at `F = fx.dist.freq`, `Q = fx.dist.q` value (0.5·16^n), output `lbh ≤ 0.5 ? lerp(lp, bp, 2·lbh) : lerp(bp, hp, 2·lbh − 1)`; shaper (eff `fx.dist.mode`) per §8.5.4; DC blocker (5 Hz) after asymmetric modes (0, 3, 9, 10, 12, 14); mix/level. Shaper runs at 2× (polyphase half-band up/down, 31 taps) for all modes except Downsample. |
| Flanger | per channel delay `d = 0.25 + 15.75·depth·(0.5 − 0.5·cos 2πφ) ms`, φ_R = φ_L + phase/360; feedback `0.95·feed` (positive) from the delay output into the line; `wet = 0.5·(in + delayed)`; rate Hz (`pow4` 0–20) or MODFX ladder (eff `fx.flg.bpm`) |
| Phaser | 6 first-order allpasses per channel, corner `f = freq·2^(depth·4·(0.5 − 0.5·cos 2πφ) − depth·2)` (± 2 oct sweep at depth 1), feedback `0.95·feed` from the chain output; `wet = 0.5·(in + chain)` |
| Chorus | 4 taps: L1/L2/R1/R2 with base `dly1` (L1, R1) and `dly2` (L2, R2), modulation `depth·(0.5 + 0.5·sin(2πφ + θ))`, θ = 0, π, π/2, 3π/2 (mono flag: R taps use L's θ); minimum read delay 0.1 ms; feedback `feed` (value 0–0.95) from each tap into its own line; wet = `(L1+L2)/2`, `(R1+R2)/2` through a 2-pole LP at `lpf` |
| Delay | lines L/R up to 2 s; time `T = bpm ? beats(DLY_LADDER[round(n·11)])·60/bpm : (1 + 500n⁴) ms`, × offset; LINK: R uses L's time and offset; band filter in the feedback path *and* on the wet: HP at `F·2^(−bw/2)`, LP at `F·2^(+bw/2)` (2-pole Butterworth each, bw = Q value in octaves), **bypassed (flat) when the Q value ≥ 8.19** (n ≥ 0.999: "least filtering"); modes (eff `fx.dly.mode`): Normal (independent L/R, each feeds back into itself), Ping-Pong (input = mono sum into L; L's output feeds R, R's feeds L), Tap->Delay (mono: input → L line once (no feedback) → R line with feedback; both outputs to both channels); delay-time changes slew (read position glides, ≤ 1 ms per ms) |
| Compressor | stereo-linked peak detector (max(abs L, abs R)) in dB with attack/release one-poles; hard knee; GR = (level − thr)·(1 − 1/ratio) above thr; makeup = `gain` value; MIX; **Limit** (ratio law 1e9): look-ahead = `10·n²` ms where n = eff `fx.cmp.att` (0–10 ms, inv A20.4.7), gain = min over the window of `thrAmp/abs(x)` (≤ 1), release one-pole; `latency` = look-ahead samples. **Multiband** (eff `fx.cmp.mb`): LR4 crossovers at 128.3 Hz and 2500 Hz; band b threshold amp `thrAmp·mb_b` (mb value 0–2); per band static curve: above T: `T + (in − T)/R`; below `Tl = T − 24 dB` (and above −80 dBFS): `Tl − (Tl − in)/R` (upward, boost ≤ +24 dB); between: unchanged; R = 1 ⇒ identity |
| Reverb Plate | Dattorro plate (1997 topology; delay lengths scaled from 29761 Hz to `base` and by `0.5 + size`), pre-delay `200·t` ms, input LP `20000·0.05^hicut` Hz, input diffusion 0.75/0.625, decay diffusion 0.7/0.5, tank decay `0.2 + 0.78·size`, tank damping one-pole LP at `20000·0.03^damp` (c slot), output HP at `20·50^locut` Hz, width (w slot) scales the side of the wet; tank modulation 0.5 Hz ±8 samples |
| Reverb Hall | 4 input diffusion allpasses (g 0.7) → 8-line FDN (Householder), base lengths `[1009, 1123, 1277, 1361, 1489, 1597, 1733, 1867]` samples @48 kHz × `(0.4 + 1.6·size)` (scaled to base), decay T60 = `0.8 + 11.2·t` s (t ≥ 0.999 → infinite, gain 1), per-line gain `10^(−3·len/(T60·fs))`, in-loop LP `20000·0.05^hicut`, SPIN: delay modulation rate `0.05 + 3·c²` Hz, depth `12·w` samples, output HP `20·50^locut` Hz; outputs L/R = alternating-sign sums of the lines |
| EQ | two RBJ biquads (cookbook), `A = 10^(gain/40)`, `Q = 0.25·40^q`, `w0 = 2πF/fs`, `α = sin w0/(2Q)`; left band (eff `fx.eq.typeL`): Shelf = low shelf, Peak = peaking, HP = high-pass (gain ignored); right band (`fx.eq.typeH`): Shelf = high shelf, Peak, LP = low-pass; series L → H |
| Filter | `SerumDSP.SFilter` (type = eff `fx.fil.type`), cutoff/res/drive/var eff values, pan as §6.11 (no key track), MIX linear wet/dry (also for Combs), then LEVEL |

#### 8.5.4 Distortion shapers (`u = G·x`; d = drive value 0–1; output before mix)

| Mode | G | y |
|---|---|---|
| 0 Tube | `0.5·10^(1.2d)` | `tanh(u + 0.2d) − tanh(0.2d)` |
| 1 SoftClip | `0.5·10^(0.9d)` | `abs(u) < 1.5 ? u − u³/6.75 : sign(u)` |
| 2 HardClip | `(1 + 4d³)/2` | `clamp(u, −1, 1)` |
| 3 Diode 1 | `1 + 9d²` | `u ≥ 0 ? 0.9(1 − e^(−2u)) : −0.7(1 − e^(2u))` |
| 4 Diode 2 | `1.8(1 + 3d)` | `sin(clamp(u, −π/2, π/2))` |
| 5 Lin.Fold | `0.5 + 14d` | `(2/π)·asin(sin(π·u/2))` |
| 6 Sin Fold | `0.5 + 6d` | `sin(π·u/2)` |
| 7 Zero-Square | `0.5(1 + 15d²)` | `abs(u) < 0.1d ? 0 : sign(u)·min(1, abs(u)^(1+d))` |
| 8 Downsample | — | `0.5·held(x)`, hold length `2^(8d)` samples (fractional accumulator) |
| 9 Asym | `0.5(1 + 12d²)` | `u ≥ 0 ? tanh(1.2u) : tanh(0.6u)` |
| 10 Rectify | `0.5(1 + 4d²)` | `clamp(u ≥ 0 ? u : −min(1, 2d)·u, −1, 1)` |
| 11 X-Shaper | — | `v = clamp(0.5x, −1, 1)`; `y = sign(v)·((1−d)·A(abs v) + d·B(abs v))` (A/B = `xsA/xsB` tables, linear interpolation) |
| 12 X-Shaper (Asym) | — | `v = clamp(0.5x, −1, 1)`; `y = 2·((1−d)·A((v+1)/2) + d·B((v+1)/2)) − 1` |
| 13 Sine Shaper | `0.5(1 + 3d)` | `sin(π/2·clamp(u, −1, 1))` |
| 14 Stomp Box | `0.5·10^(1.3d)` | input one-pole HP 720 Hz → `tanh(1.5(u + 0.25u²))·(2/3)` → one-pole LP 6 kHz |
| 15 Tape Sat. | `0.5·10^(0.8d)` | `u / √(1 + u²)` |

### 8.6 `graph.js` (E6) — shared curve editors

```js
import { CurveEditor, EnvEditor, pts } from './graph.js';
const ed = new CurveEditor(container, {
  get: () => points,                 // current points ([x,y,c(,mx,my)])
  set: (points, phase) => {},        // phase: 'start' | 'move' | 'end' | 'set'
  grid: () => ({ x, y }),            // snapping grid (0 = free)
  kind: 'lfo' | 'remap' | 'xshape' | 'curve',   // lfo: loop/start markers, point mods, tied ends; others: none of these
  loop: () => idx, setLoop: (idx) => {}, start: () => idx, setStart: (idx) => {},   // lfo only
  playhead: () => phase | null,      // animated marker (rAF while visible)
  pointMenu: (idxs, axis) => [{ label, action }],   // lfo only: items of the Modulate X / Modulate Y submenus (serum-ui: busMenuItems)
  removePointMods: (idxs) => {},     // lfo only: "Remove Point Modulations" (serum-ui: clearPointMods)
  fromWavetable: () => [{ label, action }],         // lfo only: "Wavetable to LFO Shape" submenu (From OSC A / From OSC B)
  shapes: { list: () => [{ name, pts, factory }], save: (name, pts) => {}, del: (name) => {}, exportFile: () => {}, importFile: (file) => Promise },
  bipolar: false, readOnly: false, height: 160,
});
ed.refresh(); ed.destroy();
```
Gestures (inv A13, normative): double-click empty = add point (snapped if grid), double-click point = delete (not first/last); drag point (Alt = snap to grid; first/last only move in y); drag curve handle (segment midpoint) vertically = curvature (`c`), Alt-drag handle = all handles; Shift-click/drag on background = step-draw at grid x (segment shape from the menu: step, ramp up, ramp down, curve); drag on background = marquee select; Cmd/Ctrl-drag selected = relative "rainbow" move (weight `1/(1 + distance·8)`); Delete/Backspace deletes selection; right-click / long-press menu (from `wk.contextMenu`): Segment shape ▸ (Step, Ramp Up, Ramp Down, Curve), Delete Selected, Set Start Point, Set Loopback Point (lfo), Clear Loopback, Flip Horizontal, Flip Vertical, Modulate X ▸, Modulate Y ▸ (lfo; submenus from `pointMenu`), Remove Point Modulations (lfo), Load Shape ▸ (factory shapes + user library), Save Shape…, Wavetable to LFO Shape ▸ (lfo, from `fromWavetable`). Shift-Cmd/Ctrl-click a point = set loopback. Keyboard: Tab cycles points, arrows move (Shift = fine), +/− adds/removes. Clicking overlapping right-edge points selects the left one (inv A13).
**Tied ends** (kind `lfo`, inv A13 "last point tied to first"): any edit that changes the y of the first or the last point (drag, keyboard, step-draw, Flip Vertical) writes the same y to both. Remap, xshape and curve ends are independent.

`EnvEditor(container, { env: () => ({a, h, d, s, r, ca, cd, cr}) /* engine values, s and curves 0–1 */, set: (patch, phase) => {}, ghosts: () => [env...], lock: () => bool, zoom: () => seconds, playhead: () => ({stage, t}) | null })` — draws A-H-D-S-R with draggable corner points (time in x on a lock-to-fit or zoomed axis; S in y) and three curve handles (drag; right-click resets to 0.5); emits engine values which serum-ui converts with `lawNorm` (curves are the destinations `eN.ca/cd/cr`). The playhead comes from the snapshot's `envStage`/`envT`.

Pure helpers (`pts` namespace, node-testable): `insert(p, x, y)`, `remove(p, idxs)`, `move(p, i, x, y, {snap, grid, tie})`, `setCurve(p, i, c)`, `stepDraw(p, x0, x1, y, gridX, shape, {tie})`, `flipH(p, {tie})`, `flipV(p)`, `normalize(p)` — all return new arrays and satisfy §2.3; `tie = true` applies the tied-ends rule. Factory shapes (`pts.SHAPES`, valid for every kind): Triangle, Sine (8 points, c ±0.45), Saw Up `[[0,0,0],[1,1,0],[1,0,0]]`, Saw Down `[[0,1,0],[1,0,0],[1,1,0]]` (vertical step at x = 1 keeps the ends tied), Square, Pulse 25, Ramp Exp, Stairs 4, Stairs 8, Bounce, S&H-ish (16 random steps, seeded), Sidechain (fast dip). **Shape library**: one list `synth.sx.shapes` (`[{name, pts}]`, via `host.storage`) shared by the LFO, Remap and X-Shaper editors (and VELO/NOTE curves), plus JSON file import/export of the whole library (deviation 10: no `.shp`).

### 8.7 `wk.js` and `fx-ui.js` (E6)

#### 8.7.1 `wk.js` — widget kit and shared browser infrastructure (imported by graph.js, fx-ui.js, serum-ui.js, wtedit.js)

| Export | Signature | Behaviour |
|---|---|---|
| `injectStyles(doc = document)` | once (`<style id="wk-css">`) | widget + rack + editor CSS; tokens §9.1 |
| `setPrefs({ tooltips, dblClick: 'type' \| 'reset', wheel })`, `getPrefs()` | module-level | shared by all widgets |
| `knob(o) → Knob` | `o = { dest?, label, get: () => n, set: (n, phase) => void, def, fmt: n => text, parse?: text => n \| null, steps?, detents?: number[], bipolar?, size?: 'sm' \| 'md' \| 'lg', disabled?: () => bool, title?, labelToggle?: { alt, get: () => 0 \| 1, set: v => void } }` | `Knob = { el, update(), setMod({ arcs: [{from, to, kind: 'sel' \| 'neg' \| 'other'}], live: n \| null }), focus(), destroy() }`; `detents` = n values the drag snaps to (Compressor RATIO, §3.11) |
| `numBox(o) → NumBox` | `{ dest?, label, get, set, def, fmt, parse?, steps, min?, max? }` (value in n; steps = grid count) | drag vertically (8 px per step), wheel, type; `setMod` draws an underline bar |
| `menu(o) → Menu` | `{ dest?, label, items: () => [{ v, label, group?, disabled? }], get, set, arrows = true, wheel = true }` | button + ◀ ▶; popup grouped list, keyboard (arrows, Enter, Escape, type-ahead); `setMod` draws an underline bar |
| `toggle(o) → Toggle` | `{ dest?, label, get: () => 0 \| 1, set, kind: 'led' \| 'btn' \| 'power' }` | `aria-pressed`; `setMod` draws a ring segment |
| `seg(o) → Seg` | `{ dest?, label?, items: [labels], get: () => idx, set }` | segmented switch, radio semantics |
| `slider(o) → Slider` | `{ get, set, def, fmt, bipolar, orient: 'h' \| 'v', dest? }` | matrix amount/output, LP/BP/HP, MB bars |
| `contextMenu(x, y, items, { anchor? }) → { close() }` | `items: [{ label, action?, checked?, disabled?, sub?: items, sep? }]` | closes on outside click, Escape, scroll; arrow-key navigation; submenus open on hover/ArrowRight |
| `tooltip(el, textFn)` | | hover/focus tooltip (honours prefs) |
| `loadDSP(urls = ['serum-dsp.js', 'fx-dsp.js']) → Promise<{SerumDSP, FXDSP}>` | | injects each classic script once per document (cache-busted by the caller's `?v=`), resolves when all have loaded or failed; a missing or failed script yields `null` for its global (never rejects) |

Knob DOM contract (relied on by serum-ui's mod layer):
```html
<div class="wk-knob wk-md" data-dest="f.cutoff" role="slider" tabindex="0" aria-label="CUTOFF" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" aria-valuetext="425 Hz">
  <svg class="wk-svg" viewBox="0 0 64 64"><g class="wk-halo"></g><circle class="wk-track"/><path class="wk-val"/><line class="wk-ptr"/></svg>
  <span class="wk-lab">CUTOFF</span><span class="wk-num">425 Hz</span>
</div>
```
`el.wk` = the widget instance (every widget with `dest`). Every widget with `dest` renders `data-dest`. Interaction (normative): vertical drag 200 px = full range (horizontal movement also counts), Shift = ×0.1; stepped: 1 step per 8 px; wheel 1 notch = 1 % (stepped: 1 step) when prefs.wheel; double-click = typed entry (or reset, per prefs); Cmd/Ctrl-click = reset to `def`; keys: ↑/→ +1 % (stepped +1), Shift ±0.1 %, PageUp/PageDown ±10 %, Home/End, Delete/Backspace reset, Enter typed entry, ContextMenu/Shift+F10 dispatches `contextmenu`; touch: drag, long-press 500 ms → `contextmenu`, double-tap → typed entry. A knob ignores `pointerdown` with `altKey` only if a capturing ancestor already called `stopPropagation` (serum-ui's mod layer does). `set` phases: `start` on pointerdown, `move` while dragging, `end` on release, `set` for discrete changes (keys, wheel, reset, typed).

#### 8.7.2 `fx-ui.js` — `FXRackUI`
```js
const rack = new FXRackUI(root, host, { embedded: false, dsp: FXDSP | null });   // dsp absent → calls wk.loadDSP() for its displays
host = {
  fx: () => fxState,                          // track.fx (treat read-only)
  editFx: (fn, { label, phase, ui }) => {},   // fn mutates fx in place; host compiles & sends unless ui
  bpm: () => number,
  gr: () => Float32Array(4) | null,           // gain reduction relayed from FXRack.gr() via the smon message (optional)
  locked: (destId) => bool,                   // optional: parameter locks (Serum tracks); module presets keep locked values
  storage: { get(k, def), set(k, v) },
  notify: (text) => {},
};
rack.knobs  // Map<destId, widget>
rack.refresh(); rack.scrollTo(moduleId); rack.destroy();
```
SerumUI passes its embedded rack the adapter `{ fx: host.fx, editFx: host.editFx, bpm: host.bpm, gr: () => lastSmon ? lastSmon.gr : null, locked: id => state().locks.p.includes(id), storage: host.storage, notify: host.notify }`.
Pure helpers (node-testable): `moveModule(order, id, toIndex) → order`, `ladderLabel(kind: 'modfx' \| 'dly', n)`, `moduleTitle(id)`, `modulePresetPayload(fx, m, name) → payload`, `applyModulePreset(fx, payload, lockedIds) → fx` (§9.6).

### 8.8 `serum-ui.js` (E5)
```js
import { SerumUI, PresetBrowser } from './serum-ui.js';
import { loadDSP } from './wk.js';
await loadDSP(['serum-dsp.js?v=5', 'fx-dsp.js?v=5']);
const ui = new SerumUI(root, host);
host = {
  state: () => s,                              // track.vals.s (treat read-only)
  edit: (fn, { label, phase, ui }) => {},      // fn(s) mutates in place; host: compile + queue patch (rAF) unless ui; persist (debounced)
  fx: () => fx, editFx: (fn, opts) => {},
  bpm: () => number,
  wt: {
    list: () => [{ id, name, cat, user }],    // factory catalogue (wt.FACTORY_TABLES) + user tables
    get: (id) => Promise<Table | null>,
    saveNew: (table, name) => Promise<id>,     // wtstore.put + post {t:'wt'}
    update: (id, table, { frames }) => {},     // live edit: {t:'wtf'} per listed frame, else full {t:'wt'}; persists debounced
    noises: () => [{ id, name, cat, user, oneshot }],
    saveNoise: (entry, name) => Promise<id>,
  },
  audition: { on: (note, vel) => {}, off: (note) => {} },
  monitor: (on) => {},                         // host toggles {t:'smon'} and calls ui.setSnapshot(msg) at ≤ 30 Hz
  presets: {                                   // required (§9.10)
    list: () => [{ key, name, cat, author, user }],
    load: (key) => void,                       // host: applyPreset/applyPresetFx, compile with seed, refresh
    save: ({ name, cat }) => key,              // stores a deep-cloned { name, cat, v: { s }, fx } in the user list
    del: (key) => void,                        // user presets only
    exportFile: (key) => void,                 // JSON download with embedded wts (§7.10)
    importFile: (file) => Promise<key | null>,
    current: () => key | null,
  },
  midiLearn: (destId) => Promise<number | null>, midiForget: (destId) => {},   // optional
  resample: (target /* 'A' | 'B' | 'AB' */) => Promise<void>,                // required (§9.8)
  storage: { get(k, def), set(k, v) },
  notify: (text) => {},
};
ui.setSnapshot(msg /* { s: snapshot, gr, fxph } */); ui.refresh(); ui.setPage('osc' | 'fx' | 'matrix' | 'global'); ui.destroy();
```
- UI-only changes (`s.ui.*`, editor selection, page) call `host.edit(fn, { ui: true })` (no compile, no patch).
- Continuous gestures send `phase` start → move… → end with a stable `label` (host may coalesce for undo; main.js keeps knob tweaks out of the project history).
- SerumUI tracks *dirty* = any non-ui edit since the last `presets.load`/`save`, for the "ask before preset change" preference (§9.10).
- Pure helpers exported for tests: `haloArcs(s, fx, destId, selSrc) → arcs` (§5.8), `knobMenuItems(s, fx, destId, caps) → [{label, kind}]`, `dropRow(s, fx, src, dst, {limit}) → {slot, row} | null` (wraps `addMod`), `busMenuItems(s, lfo, pt, axis) → [{label, bus}]` (`Bus k (<source labels>)` for each linked bus, then `New bus` = `newBus(s)`, omitted when 0), `lfoTileCount(s)` (§9.3), `sortPresets(list, {sort, sort2, dir})`, `stepPreset(list, key, dir, cat)`, `captureDue(prev, next, notes) → [o…]` (§6.4).

### 8.9 `wtedit.js` (E2)
```js
const ed = new WTEditor(root, { host, osc: 0 | 1, onClose });   // host = SerumUI host
ed.open(); ed.close();
```
Owns: working `Table` copy (copy-on-write id, §7.6), editor-local undo/redo (64 snapshots, ≤ 64 MB), live updates (`host.wt.update` throttled to 30 Hz with the changed frame indices; spectral-morph tables send a full update debounced 150 ms), file import (`<input type=file>` and drag-and-drop of WAV/PNG/TXT; reads with `wt.readWav`, PNG via `createImageBitmap` + canvas → `wt.importImage`), the import split-size field (§9.9), exports (Blob downloads), "Send to Noise Oscillator" (`host.wt.saveNoise(wt.frameToNoise(frame))`, then `host.edit(s => { s.noise.src = id; s.p['n.on'] = 1; })`), zoom persistence (`host.storage` key `synth.sx.wte` = `{ binZoom, waveZoom }`).

---

## 9. UI specification (serum-ui.js, wtedit.js, graph.js, fx-ui.js, wk.js)

### 9.1 Look
Original dark artwork (no Xfer imagery, fonts or logos). Root classes: `.sx-root` (Serum panel), `.fxr-root` (rack), `.wte-root` (editor), `.gx-*` (graphs), `.wk-*` (widgets), `.pb-*` (preset browser). Tokens (CSS custom properties on the roots; widgets read them with fallbacks):
`--sx-bg #0f1216 · --sx-panel #161b21 · --sx-panel2 #1c232b · --sx-line #2a333d · --sx-ink #dfe6ee · --sx-mute #7f8b98 · --sx-accent #4fb3ff (selected source, halos, curves) · --sx-neg #ffb347 (negative depth) · --sx-on #6fe3a1 (LEDs) · --sx-warn #ff6a4a · --sx-graph #59c2ff`; fonts `var(--ui)` / `var(--mono)` from the site. Knob sizes sm 28 px, md 40 px, lg 52 px; touch targets ≥ 32 px. `prefers-reduced-motion`: no animated playheads except at 10 fps.

### 9.2 Page structure (`.sx-root`)

| Area | Content |
|---|---|
| Header | original logo mark · tabs **OSC · FX · MATRIX · GLOBAL** (`role=tablist`) · preset area (§9.10: name button opening the browser, ◀ ▶, save) · **Menu** · author/notes button · voice counter `x / y` · **MASTER** knob (`g.master`) |
| OSC page | row A: [NOISE over SUB] [OSC A] [OSC B] [FILTER] · row B: source tile strip · row C: [MACROS 2×2] [ENV editor] [LFO / VELO / NOTE editor] [VOICING] |
| FX page | `FXRackUI` (embedded) · row B tile strip · macros |
| MATRIX page | 32-row table · row B tile strip |
| GLOBAL page | section grid §9.7 |
| WT editor / preset browser | full-panel overlays over the page (`role=dialog`, Escape closes) |

Breakpoints: ≥ 1280 px as listed; 900–1279 px: row A and row C become 2 × 2; < 900 px: single column, tile strip scrolls horizontally, knobs default to sm, matrix rows become two-line cards.

### 9.3 OSC page controls (inventory-keyed)
Every control bound to a DEST carries `data-dest` (knob, numBox, menu, toggle, seg, slider) and is therefore a drop target, has the knob menu (§9.4) and is MIDI-learnable.

| Panel | Control | Widget | Binding |
|---|---|---|---|
| OSC A/B (inv A3) | power | toggle power | `a.on` / `b.on` |
| | title / power right-click (also long-press): Lock Module, Copy OSC, Paste OSC, Init OSC | context menu | `locks.mod` (`oscA`/`oscB`), clipboard in memory; copy/paste/init act on `MODULE_FIELDS` |
| | wavetable | menu ◀ ▶ (groups = categories, then "User"); a Rename button appears for user tables; dropping WAV/PNG files on the display imports (default mode Pitch Avg, or the held split size §9.9) | `osc[i].wt` |
| | edit | icon button | opens WT editor |
| | display | canvas: click toggles 2D/3D (`ui.view3d[i]`); 2D = current frame at live WT pos with live warp preview (`SerumDSP.renderWarp`, not for 18–22), yellow start-phase line while PHASE is dragged; 3D = frames stacked (real frames green, interpolated grey, current yellow), unison detune stalks | — |
| | OCT, SEM, FIN, CRS | knobs sm (OCT/SEM stepped) | `a.oct`, `a.semi`, `a.fine`, `a.crs` |
| | UNISON | numBox 1–16 (tinted amber while `snapshot.oscVoices > 128`, inv A3 CPU colour) | `a.uni` |
| | DETUNE, BLEND | knobs sm | `a.det`, `a.blend` |
| | PHASE, RAND | knobs sm; PHASE menu adds `New MemTrig phase set`; phase capture per §6.4 | `a.phase`, `a.rand` |
| | WT POS | knob md | `a.wt` (display frame number with `ctx.frames/interp`) |
| | warp | menu ◀ ▶ (OSC B shows "(from A)") + pencil button for Remap 1–4 (popover `CurveEditor` kind `remap` on `osc[i].remap`); choosing a mode calls `warpChoice` (choosing FM/AM/RM here turns them off on the other oscillator, inv A5) | `a.warpMode` / `b.warpMode` |
| | WARP | knob md (bipolar arc for modes 6, 10, 12) | `a.warp` |
| | PAN | knob sm bipolar | `a.pan` |
| | LEVEL | knob md | `a.level` |
| SUB (inv A7) | power · title/power menu (Lock Module, Copy, Paste, Init) · shape menu (icons) · OCTAVE numBox −4…+4 · DIRECT OUT toggle · PAN · LEVEL | | `s.on`, `locks.mod` `sub`, `s.shape`, `s.oct`, `sub.direct`, `s.pan`, `s.level` |
| NOISE (inv A8) | power · title/power menu (Lock Module, Copy, Paste, Init) · noise menu ◀ ▶ (choosing sets `oneshot` to the source default) · one-shot toggle · keytrack toggle · overview display with play position (dropping a WAV here imports a user noise: `wt.readWav` → `host.wt.saveNoise`, keeps its `smpl` loop) · PHASE · RAND · PITCH · PAN · LEVEL · DIRECT toggle | | `n.on`, `noise.*`, `n.phase`, `n.rand`, `n.pitch`, `n.pan`, `n.level` |
| FILTER (inv A11) | power · title/power menu (Lock Module, Copy, Paste, Init) · type menu (grouped Normal / Multi / Flanges / Misc, ◀ ▶, wheel) · display: click cycles `ui.filtView` **magnitude → phase → spectrum** (inv A11.1 1.0 / 1.27b6). Magnitude/phase from `filterImpulse` + FFT at 48 kHz (Ring Mod / S&H types show a custom icon); spectrum = 1024-point Hann FFT of `snapshot.filtTap` at `tapRate`, log-frequency axis, "no signal" while no note sounds; drag x = cutoff, y = res · routing toggles **A B N S** · key-track toggle · CUTOFF (lg) · RES · PAN (bipolar) · DRIVE · VAR (label = `varLabel(type)`, disabled when `''`) · MIX (disabled while the eff type is Combs, §6.11) | | `f.on`, `locks.mod` `filter`, `f.type`, `f.routeA/B/N/S`, `filter.keytrack`, `f.cutoff` … `f.mix` |
| Tile strip (inv A13/A14/A16.1) | ENV 1–3 · LFO tiles 1…`lfoTileCount(s)` = min(8, max(4, highest LFO index used by any row + 1)) (a used LFO is never hidden) · VELO · NOTE · WHEEL | draggable tiles with destination-count badge; hover lists destinations; click selects (selected source drives `sel` halos and the editor) | `ui.mod` |
| MACROS (inv A15) | 4 knobs (not destinations) with editable labels (double-click, ≤ 24 chars); the label is the drag tile for `macroN` | knob md + tile | `macros[m].v`, `.name` |
| ENV editor (inv A12) | `EnvEditor` (selected env blue, others grey if used) · knobs ATTACK, HOLD, DECAY, SUSTAIN, RELEASE · curve handles (destinations, reachable for modulation from the matrix) · LOCK toggle · zoom slider | | `eN.*` incl. `eN.ca/cd/cr`, `ui.envLock`, `ui.envZoom` |
| LFO editor (inv A13) | `CurveEditor` kind `lfo` with playhead · seg TRIG / ENV / OFF · toggles BPM, DOT, TRIP, ANCHOR (DOT/TRIP/ANCHOR disabled when BPM off) · GRID text box `x` or `x,y` · knobs RATE, RISE, DELAY, SMOOTH · folder menu: shapes (factory + library), Save Shape…, Import/Export library (JSON), **Wavetable to LFO Shape ▸ From OSC A / From OSC B** (that oscillator's frame at its base WT POS → `wt.frameToPoints`) | | `lfo[l].*`, `lfoGrid`, `lN.*` |
| VELO / NOTE editor (inv A14) | `CurveEditor` kind `curve` · "Follow portamento/legato" toggle | | `velo`, `note` |
| VOICING (inv A17) | MONO · LEGATO toggles · POLY numBox 1–32 (disabled in mono; right-click menu: `Lock Polyphony` ✓ = `locks.misc.poly`, `Limit polyphony to one of any note number` ✓ = `voicing.oneNote`) · PORTA knob · CURVE knob (bipolar) · ALWAYS · SCALED toggles · voice counter | | `voicing.*`, `g.porta`, `g.curve` |

### 9.4 Modulation interactions (inv A16)
- **Drag a tile** (pointer moves > 4 px): a ghost label follows; elements with `data-dest` under the pointer (knobs, numBoxes, menus, toggles, segs, sliders, MB bars — incl. the FX page) get an outline and `cursor: copy`; release on one → `dropRow` (§5.8) → selected source = that tile. Release on a matrix SOURCE/AUX menu → sets that row's source. Release over an LFO graph point (within 8 px) → small menu **X / Y** → the point's `mx`/`my` = `newBus(s)` and a row `tile → bus<k>` (bipolar, amount 0.5) is added; no free bus → notice "All 16 LFO buses in use". Escape cancels.
- **Halos** (`setMod`, refreshed on state change and at ≤ 30 fps from snapshots): one arc per row (§5.8) on knobs; an underline bar on numBoxes/menus/sliders; a ring segment on toggles. Selected source in `--sx-accent`, negative depth in `--sx-neg`, others in `--sx-mute`; live dot at the snapshot eff when it differs from base by > 0.002. A modulated knob also shows a small depth handle at its top-left.
- **Depth**: Alt-drag on the knob or drag the depth handle (vertical, 200 px = 2.0 of amount, Shift fine) edits the row of the selected source on this control, else the most recently added row. **Shift+Alt-click** toggles that row's TYPE.
- **Right-click / long-press menu** on any DEST-bound control (exact order): `Bypass Modulator: <src>` (checkbox, one per row) · `Remove Modulator: <src>` (one per row) · `Remove All Modulators` · separator · `Reset Control` · `Enter Value…` · separator · `Mod Source ▸` (SRC_MENU labels; picks add a row with drop defaults) · separator · `MIDI Learn` / `MIDI Re-learn (CC n)` / `Remove MIDI CC n` (when `host.midiLearn`) · `Lock` / `Unlock`. PHASE knobs add `New MemTrig phase set`. Module power buttons put this menu after the module items (Lock Module, Copy, Paste, Init) and a separator. Items without rows are omitted, never shown disabled.
- **LFO point modulation menus** (graph right-click): `Modulate X ▸` / `Modulate Y ▸` list `busMenuItems` — `Bus k (<source labels>)` for each bus already linked by some point (points may share a bus, inv A13) and `New bus` (lowest free); picking links the selected points' axis to that bus; `New bus` also adds the row `ui.mod source → bus<k>` (bipolar, amount 0.5). `Remove Point Modulations` → `clearPointMods` (rows of buses no point links any more are deleted).
- **Tile gestures**: Alt-drag an LFO tile onto another LFO tile = `copyLfo`; Alt-drag an LFO tile onto an oscillator display = render the LFO cycle into a new 1-frame user table (`wt.ptsToFrame`) and select it; drag an LFO tile onto the NOISE panel = `wt.lfoToNoise` → new user noise, selected (inv A10.10, A8, A13).
- **Tooltips**: `<Label>: <value>` plus one line per modulator `<src> <±amount%> <-> or ->`.
- Keyboard parity: every action above is reachable from the focused control's context menu; tiles are buttons (`Enter` selects; `Shift+Enter` opens a "Modulate…" destination picker = `addMod` to the chosen dest).

### 9.5 MATRIX page (inv A16.3)
Columns: `#` · SOURCE (menu; accepts tile drops; Alt-click = `reassignSource`) · CURVE (thumbnail of `bend(·, MC_K·curve)`; drag vertically, double-click resets) · AMOUNT (bipolar slider −100…+100; Cmd/Ctrl-click resets; typing accepts `%`, and on semitone-linear destinations `12st` / `-7 st` → `semitoneAmount(dst, st, bi)`, §8.1) · DESTINATION (menu grouped by `DESTS.group`, includes `MATRIX_ONLY` ids) · TYPE (`->` / `<->`) · AUX SOURCE (menu) · AUX MODE (`Default` / `(inv)`) · BYPASS (toggle; Alt-click anywhere on the AUX MODE cell also toggles it) · OUTPUT (slider 0–100) · row menu ⋯ (Clear, Duplicate, Move Up, Move Down). Top-right menu: `Velo->Amp`, `Vibrato quick-assign`, `Clear All Modulations`. Inactive rows are dimmed. 32 rows in a scroll area.

### 9.6 FX page and `FXRackUI` (inv A20)
- Left column: 10 module tiles in `fx.order` (LED enable toggle bound to `fx.<m>.on` with `data-dest`, name, drag handle ≡; drag to reorder with a yellow insertion line; Alt+↑/↓ moves the focused tile; click scrolls the rack to the module). Rack menu (⋯ above the tiles and on tile right-click): `Lock FX Rack` (`fx.lock`), `Load Effect Chain…`, `Save Effect Chain…` (localStorage `synth.fxchains` `[{name, fx}]` with `fx` deep-copied without `ui`/`lock`, plus JSON file export/import), `Reset Rack` (`defaultFx()` keeping `ui`). `Load Effect Chain…` is an explicit action and works even while `fx.lock` is on; it replaces everything but `ui`/`lock` and compiles with `seed`.
- Right: enabled modules in order; each panel header = title, per-module preset menu ▾ (`Save Effect Settings…`, list of saved settings in localStorage `synth.fxmod.<m>`, `Init Module`), power button (`fx.byp[m]`, far right). Disabled modules are hidden.
- **Module preset payload** (`modulePresetPayload`): `{ name, p: { every fx.p entry whose id starts with 'fx.<m>.' except 'fx.<m>.on' — Hyper also every 'fx.dim.*' }, sub: deep copy of fx[m] when it exists (dist: X-Shaper curves `xa`/`xb`, inv A20.1 1.34b4; cho: `mono`; rev: `type`) }`. Loading (`applyModulePreset`) applies `p` and `sub`, leaves the module's enable, bypass and the rack order unchanged, keeps values of locked dest ids (`host.locked`), and the host compiles with `seed` (that module's LFO phase restarts). `Init Module` = the same with defaults.
- MIX knobs whose label is clicked flip to LEVEL (`fx.ui.lvl`, inv A20.2).

| Module | Controls (widget → binding; every DEST-bound widget carries `data-dest`) |
|---|---|
| Hyper/Dimension | Hyper: RATE, DETUNE knobs · RETRIG toggle (`fx.hyper.retrig`) · UNISON numBox 0–7 · MIX/LEVEL (`fx.hyper.mix` / `.level`); Dimension: SIZE · MIX/LEVEL (`fx.dim.*`) — processing order Hyper → Dimension (§8.5.2) |
| Distortion | MODE menu ◀ ▶ (`fx.dist.mode`) · Edit A / Edit B buttons (X-Shaper modes; popover `CurveEditor` kind `xshape` on `dist.xa/xb`) · seg OFF/PRE/POST (`fx.dist.filt`) · filter display (drag x = F, y = Q; orange when active) · F knob · Q knob (engine Q, e.g. `2.00`) · LP/BP/HP vertical slider (`fx.dist.lbh`) · transfer display (`FXDSP.distCurve`) · DRIVE · MIX/LEVEL |
| Flanger | BPM toggle (`fx.flg.bpm`) · RATE · DEPTH · FEED · PHASE · MIX/LEVEL |
| Phaser | BPM (`fx.phs.bpm`) · RATE · DEPTH · FREQ · FEED · PHASE · MIX/LEVEL |
| Chorus | BPM (`fx.cho.bpm`) · RATE · DELAY 1 · DELAY 2 · DEPTH · FEED · LPF · MONO toggle (`cho.mono`) · MIX/LEVEL |
| Delay | FEED · BPM (`fx.dly.bpm`) · LINK (`fx.dly.link`) toggles · LEFT time knob + offset knob (detents §3.10) · RIGHT time + offset (disabled with LINK) · filter display (drag x = F, y = Q; `FXDSP.delayFilterResponse`) · F · Q · seg Normal / Ping-Pong / Tap->Delay (`fx.dly.mode`) · MIX/LEVEL |
| Compressor | THRESH · RATIO (knob `detents` = `CMP_RATIO_DETENTS`) · ATTACK (`cmpAtt` format: look-ahead ms in Limit) · RELEASE · GAIN · MULTIBAND toggle (`fx.cmp.mb`) · three draggable horizontal bars H / M / L (`fx.cmp.mbH/M/L`, 0–200 %) shown when multiband · GR meter (`host.gr`) · MIX/LEVEL |
| Reverb | seg PLATE / HALL (`rev.type`) · SIZE · PRE DELAY\|DECAY · LOW CUT · DAMP\|SPIN · HIGH CUT · WIDTH\|SPIN DEPTH (labels from `REV_LABELS`) · MIX/LEVEL |
| EQ | response display with two draggable band handles (x = freq, y = gain) · left: seg Shelf/Peak/HP (`fx.eq.typeL`) · FREQ · Q · GAIN; right: seg Shelf/Peak/LP (`fx.eq.typeH`) · FREQ · Q · GAIN |
| Filter | TYPE menu (grouped, ◀ ▶; `fx.fil.type`) · display · CUTOFF · RES · DRIVE · VAR (label per type) · PAN · MIX/LEVEL |

On Serum tracks the embedded rack is part of Serum's mod layer; on other tracks the same UI simply has no mod layer.

### 9.7 GLOBAL page (inv A19, A4, A14, A18, A2.2)

| Section | Controls |
|---|---|
| OSCILLATORS | Pitch Track A / B toggles (`a.track`, `b.track`) · NOISE FINE knob (`n.fine`) · OVERSAMPLING seg 1x / 2x / 4x (`global.os`) with a lock toggle (`locks.misc.os`) and the effective internal rate ("running at 96 kHz", capped by the device rate, deviation 9) |
| UNISON A, UNISON B | RANGE numBox 0–48 st (`global.uniRange[i]`) · WIDTH knob (`a.uniw`) · WARP knob bipolar (`a.uniwarp`) · WT POS knob bipolar (`a.uniwt`) · STACK menu (`a.stack`) · TUNING menu (`global.uniMode[i]`) |
| CHAOS 1, CHAOS 2 | RATE knob (`c1.rate`) · BPM toggle (`c1.bpm`) · MONO · S&H toggles (`chaos[c]`) |
| TUNING & BEND | A4 numBox 430–450 Hz (0.1) with a lock toggle (`locks.misc.tuning`) · BEND UP / BEND DOWN numBoxes (`g.bendup`, `g.benddn`) |
| PREFERENCES | stored with `host.storage` key `synth.sx.prefs`, app-wide, not in presets (inv A19); defaults `{ tooltips: 1, dblClick: 'type', wheel: 1, view3d: 0, wheelWt: 0, limitDrop: 1, silenceTails: 1, defOs: 2, author: '', askPreset: 0, smooth: 1 }`: Show tooltips · Double-click: Type value / Reset · Mouse wheel adjusts controls · Default WT view 2D/3D · Mod wheel → WT Pos while editor open · Limit mod depth on drop (§5.8) · Silence effect tails when transport stops (every track's rack, §11) · Default oversampling (new Serum tracks and Init Preset) · Default author name (same) · Ask before preset change when edited (§9.10) · Smoothing scale 1–800 % (`smooth` 0.01–8: base/macro smoothing of every Serum track and FX-rack smoothing of every track, §5.4) |
| INFO | Author, Notes text fields (`author`, `notes`) |

### 9.8 Main menu (header "Menu"; inv A2.1)
`Init Preset` (`defaultSerum()` with `prefs.defOs`/`prefs.author`, applied through `applyPreset` so locks hold; FX via `applyPresetFx`) · `Init All LFOs` · separator · `Render OSC A Warp` / `Render OSC B Warp` · `Resample to OSC A` / `OSC B` / `A+B (Stereo)` · separator · `Lock FX Rack` · `Load Effect Chain…` · `Save Effect Chain…` · separator · `Velo->Amp` · `Vibrato quick-assign` · separator · `About`.
- **Render OSC Warp** (inv A5): 256 frames; frame f = the oscillator's frame at its base WT POS through its base warp mode at amount f/255 via `SerumDSP.renderWarp(…, {over: 4, remap, mod})`, band-limited with `wt.bandlimit`; `mod` for modes 18–20 = the other oscillator's table frame at its base WT POS (raw: its own warp not applied, ratio 1); 22 = the current sub shape's table frame (`SUB_IDS[s.shape]`, level 0); 21 = a seeded white-noise cycle (`mulberry32(0x5EED)`, 2048 samples uniform ±1). Result: new user table `<name> warp`, selected, warp mode set to Off.
- **Resample to OSC A / OSC B / A+B** (inv A2.1; `host.resample`, required, §11): renders MIDI note 60 at velocity 1 through the current patch **including the FX rack**, offline at 44.1 kHz, gate = 1 bar at the song tempo, followed by the release tail until the output stays below −90 dBFS for 50 ms or 2 s have elapsed; A / B take the mono sum `(L+R)/2`; A+B puts L into A and R into B; import = `wt.tableFromWav(…, {mode: 'manual', size: round(44100 / f60)})` with `f60 = a4·2^(−9/12)` (169 samples at A4 = 440), at most 256 evenly spaced frames, saved as a new user table `Resample <n>` and selected on the target oscillator(s).

### 9.9 Wavetable editor layout (inv A10)
```
┌ toolbar: SINGLE ▾ PROCESS ▾ MORPH ▾ ADD/REMOVE ▾ SORT ▾ IMPORT ▾ EXPORT ▾ │ ↶ ↷ │ name │ ✕ ┐
├ FFT area: magnitude bars (bins 1…512, bin-zoom slider 32–512) / phase bars; Wave→FFT toggle (live) ┤
├ tool palette (12 tools, §8.2.7) │ waveform display (2048 samples, grid lines, zoom 1–16× with scroll) │ grid numBox 0–64 (bottom-right) ┤
├ formula / split-size field "(enter formula)" · presets ▾ (Singles / Multis / User Singles / User Multis / Save Formula…) · Apply ┤
└ [−] [+] frame box ◀ ▶ │ thumbnail strip (labels 1, 17, 33 … after morph; click select, Shift-click range (blue), drag reorder (yellow insertion), drop audio = replace frame) ┘
```
- FFT magnitudes are shown in absolute editor units (§8.2.1) on a range `[0, max(1, largest magnitude)]`, so nothing is clipped; drawn values are clamped to that range. Phase bars show `ph` with the centre line = 0.5 = sine phase. FFT right-click menus: §8.2.8 items (per row) with `bin` = the bin under the pointer. Shift-drag = fine. Drawing on bars sets values (snap/scale modes as checkable items).
- Thumbnail drag reorder applies `add.move` (`sel` = dragged range, `to` = insertion index).
- **Split size** (inv A10.10): the formula field doubles as the import split-size entry. While it holds a value `wt.parseSplitSize` accepts (1–9999 samples or a note name), every audio import — menu or drop — except the FFT modes, PNG and files with a `clm` chunk uses `manual` with that size; a `pitchAvg` import writes its detected size into the field, so it is reused until cleared; entering `0` or clearing the field reverts to the chosen mode. The field shows `importMsg`.
- Drop zones over the display while dragging a file: four labelled zones (Pitch Avg · Zero-Snap · Pitch Follow · FFT 1024); PNG files always use image import.
- Zoom (`binZoom`, `waveZoom`) persists in `host.storage` key `synth.sx.wte` (inv A10.1).
- Mod wheel → WT pos (pref): while open, the host maps the wheel to `a.wt`/`b.wt` of the edited oscillator (integrator).

### 9.10 Preset browser (`PresetBrowser`, inv A2.1; ARCH excludes only ratings, comment column, prune and hybridize)
- **Header**: preset name button (opens the browser) · ◀ ▶ = previous/next entry of the browser's current sorted list **within the current preset's category** (wraps) · save (disk) button → dialog Name + Category (menu of existing categories plus free text = custom category, inv A2.1 1.23b2) → `host.presets.save`.
- **Browser panel** (overlay, `role=dialog`): category filter menu (All + every category present, alphabetical) · search box (name/author substring) · table with columns **Name / Category / Author**; clicking a header sorts by it (clicking again flips direction); ties fall back to the **previously clicked** column (secondary sort, inv A2.1 1.23b2), then Name. Factory and user presets are both listed (user rows marked). ↑/↓ move the selection and load it (browse-to-audition); Enter/double-click loads and closes; Escape closes; Delete key or row menu `Delete` on a user preset (confirm) → `host.presets.del`; row menu `Export…` → `exportFile`; panel button `Import…` → `importFile`.
- **Ask before change** (pref `askPreset`): when on and the state is dirty (§8.8), any preset change (browser, ◀ ▶, program change) asks `confirm('Discard changes to “<name>”?')` first.
- Browser state `{ sort, sort2, dir, cat, q }` persists in `host.storage` key `synth.sx.browser`; the filtered, sorted list is also what MIDI program change indexes (§11).

---

## 10. Tests (node ≥ 20, `node --test tests/`)

### 10.1 Rules
- One file per owner: `tests/serum-core.test.mjs` (E1), `tests/wt.test.mjs` + `tests/wtstore.test.mjs` (E2), `tests/serum-dsp.test.mjs` (E3), `tests/fx-dsp.test.mjs` (E4), `tests/serum-ui.test.mjs` (E5, pure helpers + headless checks), `tests/fx-ui.test.mjs` (E6, pure helpers of `wk.js`, `graph.js`, `fx-ui.js`). Integrator: `tests/integration.test.mjs`.
- A unit test file imports only its own module(s) plus `tests/fixtures/*` (M1). Other fixtures (a CP, a wavetable entry) are built inside the test from this spec or decoded from `cp-default.json`/`ct-default.json`/`fxp-default.json` (typed arrays as `{"$t": "<Type>", "v": [...]}`). Cross-module consistency is the integrator's file (§10.7).
- Deterministic: fixed seeds; no timers; run time < 60 s per file on a laptop. Tolerances in this section are normative. Test items are cited as §10.x.N (item N of §10.x) and §10.7a–l.
- DSP scripts are loaded with `node:vm` (classic scripts; IIFE, §0.2):
```js
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
export function loadDSP(ctx = vm.createContext({ console })) {
  for (const f of ['serum-dsp.js', 'fx-dsp.js']) vm.runInContext(readFileSync(new URL('../' + f, import.meta.url), 'utf8'), ctx, { filename: f });
  return { ctx, SerumDSP: ctx.SerumDSP, FXDSP: ctx.FXDSP };
}
export function makeProc(base = 48000, OS = 2) {
  return { base, OS, fs: base * OS, CH: 4 * OS, p: null, ct: null, bendRaw: 0, wheel: 0, at: 0,
    pat: new Float64Array(128), patSeen: false, bpm: 120, songBeat: () => null, held: [], voices: [], sx: null };
}
// render loop: per span of n = 128 base frames: N = n*OS; SerumDSP.begin(proc, N); voices[i].render(L, R, N); SerumDSP.fxMods(proc)
```
- **Allocation-free check** (used by §10.4 and §10.5): after construction, `apply`/`set` and one warm span, replace the vm context's `Float64Array`, `Float32Array`, `Uint8Array`, `Uint16Array`, `Int8Array`, `Int16Array`, `Int32Array`, `Array`, `Map` and `Object` with functions that throw, then render; the hot paths must not reach any of them (array/object literals are banned in hot paths by §0.2).
- Spectral measurements: Blackman-Harris 4-term window, FFT N = 65536, "alias" = largest bin below `min(20 kHz, 0.45·base)` farther than 10 bins from every harmonic of f0, in dB relative to the fundamental bin.

### 10.2 serum-core (E1)
1. `DESTS.length = 248`, `NS = 148`, `NF = 100`; ids unique; `DEST_INDEX[id] = i`; every row equals `tests/fixtures/dests.json` (id, label, law, lo, hi, def ±1e-12, fmt, scope, ctr, group) and §3.13; defaults of stepped laws are bit-exact grid values `k/(hi−lo)`.
2. `SOURCES.length = 34` and §3.12 matches; `SRC_MENU` is a permutation of ids 1–33.
3. `FILTERS` equals `tests/fixtures/filters.json` (96 types, ids/names/categories/Var labels/families); `WARPS.length = 23` with `nameB` (18–20 read "(from A)"); `UNI_STACKS.length = 9`; `UNI_MODES.length = 5`; `DIST_MODES.length = 16`; `MODFX_LADDER.length = 31` strictly decreasing beats after index 0; `DLY_LADDER.length = 12` increasing; `CMP_RATIO_DETENTS` as §3.11.
4. Laws: `lawNorm(lawValue(n))` ≈ n (1e-9) for 1001 n over each continuous dest's invertible domain (§3.1); `lawValue(lawNorm(v))` ≈ v over the value range; spot values: `f.cutoff` 0.5 → 424.6 ± 0.5 Hz; `e1.att` 0.25 → 0.03125 s, 0.5 → 1.000 s, 0.75 → 7.594 s; `g.porta` 0.5 → 0.25 s; `l1.rate` 0.5 → 6.25 Hz; `c1.rate` 0.2512 → 1.000 ± 0.005 Hz; `g.master` 0.7 → −9.29 ± 0.01 dB; `a.level` 0.75 → −5.00 ± 0.01 dB; `fx.cmp.thr` 0.5 → −18.06 dB; `fx.cmp.ratio` 0.75 → 4, 0.99 → 1e9; `fx.cmp.att` 0.3 → 90 ms; `fx.cmp.gain` 1 → 30.10 dB; `fx.dist.freq` 0.5 → 329.6 Hz, 1 → 13289.75 ± 0.01 Hz; `fx.dist.q` 0.5 → 2.000; `fx.eq.freqL` 0.333 → 209.6 ± 1 Hz; `fx.eq.freqH` 0.666 → 2041 ± 5 Hz; `fx.dly.freq` 0.5 → 848.5 Hz; `fx.dly.q` 6/7.4 → 6.8; `fx.cho.lpf` 0.5 → 1000 Hz; `fx.phs.freq` 0.5 → 600 Hz; `fx.flg.rate` 0.25 → 0.078125 Hz; `fx.dly.timeL` 0.625 → 77.29 ms; any `.level` 0.5 → gain 1; `n.pitch` 1 → +48, 0.25 → −100, 0 → −200 st; `g.bendup` default → +2 st, `g.benddn` → −2 st.
5. `fmtParam`: `('f.cutoff', 0.5)` → `425 Hz`; `('a.level', 0.75)` → `75%`; `('e1.att', 0.11)` → `0.52 ms`; `('e1.rel', 0.215)` → `14.7 ms`; `('e1.dec', 0.5)` → `1.00 s`; `('g.master', 0.7)` → `-9.3 dB`; `('a.phase', 1)` → `Mem`; `('a.crs', 0.5)` → `--`; `('a.semi', 0.75)` → `+6 st`; `('l1.rate', 0.5, {s: defaultSerum()})` → `1/4`; `('fx.cmp.ratio', 1)` → `Limit`; `('fx.cmp.att', 0.3, {fx: <ratio n 1>})` → `0.90 ms`, without Limit → `90.0 ms`; `('fx.dly.offL', (4/3 − 0.5))` → `TRIP`; `('a.pan', 0.5)` → `C`; `('b.warpMode', 18/22)` → `FM (from A)`; `('f.type', 1/95)` → `MG Low 12`; `('fx.dist.q', 0.5)` → `2.00`.
6. `parseParam`: `('f.cutoff', '425 Hz')` → 0.5 ± 1e-3; `('f.cutoff', '1,2 kHz')` → norm of 1200; `('e1.att', '1/8', {bpm: 120})` → norm of 0.25 s; `('a.semi', '+7')` → 19/24; `('a.level', '50%')` → 0.5; `('l1.rate', '1/8T', {s: <lfo 1 BPM, trip>})` → idx/(L−1) of `1/8T`; `('fx.dly.timeL', '1/8', {fx: <BPM on>})` → 6/11; `('fx.flg.rate', '1/4', {fx: <flg BPM on>})` → 21/30; `('c1.rate', '1/4', {s: <c1.bpm on>, bpm: 120})` → `lawNorm('c1.rate', 2)`; `('fx.cmp.att', '5 ms', {fx: <Limit>})` → √0.5; garbage → null.
7. `semitoneAmount`: `('a.semi', 12, 1)` → 1; `('a.semi', 12, 0)` → 0.5; `('a.oct', 12, 0)` → 0.125; `('a.fine', 0.5, 0)` → 0.25; `('g.tune', 64, 1)` → 1; `('a.semi', 48, 0)` → 1 (clamped); `('f.cutoff', 12, 0)` → null.
8. `midiValue`: bool cc 63 → 0, 64 → 1; `a.semi` cc 64 → exactly 13/24 (grid); `f.cutoff` cc 127 → 1; `macro2` cc 32 → 32/127.
9. `normalizeSerum`: idempotent (deep-equal); `({})`, `(null)`, `('x')` equal `defaultSerum()`; JSON round trip; stringified default < 24 KB; a worst-case state (every graph at 480 points) < 256 KB after normalization; out-of-range values clamped; stepped laws snapped; `bus*`/`g.wheel`/`g.bend` forced; points repaired (unsorted, missing ends, > 480, coordinates rounded to 5 decimals); warp conflict (`a.warpMode` 18/22 and `b.warpMode` 19/22) → B Off; matrix padded to 32; unknown `midi` targets dropped.
10. `compileSerum(defaultSerum())`: every §4.1 CP and CT field present with exact type and length; `base` equals `s.p` in DEST order; `mN = 0`; CT `lfoTab` for the default triangle: `[0] = 0`, `[512] = 1`, `[1024] = 0`; `veloTab[64] = 0.5`; `needs` = `['factory:Default']`; `direct = 0`; `CP.ctKey === serumT.key`; equal states give equal keys; moving one LFO point changes the key; changing only `s.p` keeps it and does not rebuild the CT (same object returned).
11. `needs`: a row targeting `b.on` adds `osc[1].wt`; `s.shape` targeted with the sub on → all five `SUB_IDS`; noise off and not targeted → no noise id.
12. Matrix compile: bypassed, empty-source, empty-dest, zero-amount and zero-output rows are excluded; `mAmt = amt·out`; `mCtx` = 1 for `V`/`V*`, 3 for `V*M`, 2 for `G`, 4 for FX dests; `mOn = 1` exactly for the eight note-on dests; `srcUsed` and `modded` correct.
13. `lfoLadder`: lengths 15/29/29/43; descending; default n → `1/4`; straight entry i = `128·2^(−i)` beats.
14. `bend`: `bend(0,k) = 0`, `bend(1,k) = 1`, monotone for k ∈ {−10…10}, `bend(t, 0) = t`; `evalPts` vertical step semantics.
15. Unison tables: N = 1 → shape 0; N = 2 → ±1 (Linear); N = 7 Exp `s(t)` matches §3.8; stack patterns for N = 8 for all 9 stacks; centre flags.
16. Helpers: `addMod` defaults (§5.8) with `limit` on and off, bool destinations (amount ±1), FX bases read from `fx`, full matrix → −1; `removeMods`; `veloToAmp` row; `vibratoAssign` uses the first unused LFO; `reassignSource`; `warpChoice` (A = 18, choose B 19 → A Off, B 19; choose B 21 → A stays 18); `linkedBuses`/`newBus`/`pruneBuses`/`clearPointMods` (two points share bus 3 with a row Env2 → bus3: clearing one point keeps the row, clearing both deletes it; `newBus` skips buses that are linked or targeted); `fxModded`; `applyPreset` with a parameter lock, each module lock (all `MODULE_FIELDS` fields kept), each `locks.misc` flag, `midi` (non-empty preset map wins, empty keeps current), and the result shares no object with the preset (mutating it leaves a deep-frozen preset intact); `applyPresetFx` with `fx.lock` and with locked FX ids.
17. `compileFx(defaultFx())`: `order = [0…9]`, `any = 0`, `base[0] = 1`, `base[86] = 0`, `alloc` all 0, `seed = 0`; with `{master: 0.7}` → `base[0] = 0.7`; with `modded[fx.dly.on]` → `alloc[5] = 1`; `{seed: true}` → `seed = 1`; equal X-Shaper curves → equal `xsKey`; `normalizeFx` repairs a corrupt order.
18. Performance: `compileSerum` of a dense patch (32 rows, 8 LFOs with 480 points, both remaps) ≤ 2 ms mean over 200 runs with one `s.p` change per run (CT memoised).
19. (M3) Every `FACTORY_PRESETS` entry normalizes unchanged, uses only `factory:`/`sub:`/`noise:` ids, and compiles.

### 10.3 wt.js and wtstore.js (E2)
1. FFT: round trip error < 1e-12 (n = 2048, 4096); cosine at bin 5 → |X5| = n/2.
2. `buildMips`: 11 levels with exact `harm`/`len` (§7.3); for a white-noise frame, level ℓ has |X_k| < 1e-6 for k > harm and matches the raw spectrum (relative 1e-5) for k ≤ harm; DC preserved; data length `frames·len`.
3. Aliasing design check (pure JS reference player in the test, 4-point Hermite, level rule §7.4): `factory:Default` at f0 ∈ {110, 440, 1046.5, 2093, 4186} Hz, fs ∈ {48000 (base 48000), 96000 (base 48000)}: alias ≤ −70 dBc.
4. Every `FACTORY_TABLES`/`SUB_TABLES` id: frames = catalogue count, finite, peak ≤ 1.0001, deterministic (generate twice, identical); `expandTable` of spectral-morph tables returns 256 frames with real frames at slots `round(k·255/(R−1))` unchanged; of crossfade tables, slot s equals the lerp at `u = s·(R−1)/255` (1e-6); `makeEntry`: morph 0 → `frames = R`, `interp = 0`; morph 1 → `frames = R`, `interp = 1`; morph 2 → `frames = 256`, `interp = 1`; two calls return distinct buffers.
5. `NOISES`: deterministic; colours RMS −12 ± 0.5 dBFS; Pink slope −3 ± 1 dB/oct (100 Hz–10 kHz, octave-band RMS); Brown −6 ± 1.5; loop seam: |x[len−1] − x[0]| < 4·RMS of first differences; one-shots end within −60 dB of silence; levels: level ℓ has rate/2^ℓ, content above `0.45·rate/2^ℓ` ≤ −50 dB relative to the passband (white noise), loop points halved; `frameToNoise` levels are exact FFT band-limits and loop seamlessly.
6. WAV: write/read round trip for 32 f (exact), 24-bit (error ≤ 2⁻²³), 16-bit (≤ 2⁻¹⁵), 8-bit; stereo; `clm` round trip (`size 2048`, morph 0–4); parse a hand-built `<!>2048 01000000 wavetable (www.xferrecords.com)` → `{size: 2048, morph: 0, factory: 1}`; WAVE_FORMAT_EXTENSIBLE float; odd-sized chunk padding; non-WAV → throws.
7. Formula: all cases of §8.2.4; `applyFormula` `sin(pi*x)` → correlation > 0.9999 with a sine; `(1/q)^0.5` → correlation > 0.999 with the band-limited saw (after peak normalisation); `q<17` → exactly harmonics 1–16 non-zero; a `y` formula → 256 frames; error leaves the table unchanged.
8. Ops: every id in `OPS` runs on a 1-frame, a 7-frame and a 256-frame table without throwing; specific: normalize peak = 1; removeDC mean < 1e-9; flipH twice = identity; `add.reduce` n = 2 on 7 frames → 4; `sort.reverse` twice = identity; `all.half` on 200 frames → 256; `morph.crossfade` on 2 frames → `expandTable` slot 128 = lerp(A, B, 128/255) within 1e-6; `add.move` on frames 0…6 with sel [1,2]: to 5 → 0,3,4,1,2,5,6; to 0 → 1,2,0,3,4,5,6; to ∈ {1,2,3} → unchanged; `all.nudgeFund` → harmonic 1 at ph 0.5 ± 1e-6 for every frame.
9. Spectrum: `toSpectrum` of `factory:Square` has `mag[0] > 1` (unclamped, ≈ 1.04); `fromSpectrum(toSpectrum(f))` reproduces `factory:Square` and a seeded random frame within 1e-6; a sine frame gives `mag[0] = 1 ± 1e-9`, `ph[0] = 0.5`; a cosine frame `ph[0] = 0.75`.
10. `fftOp`: `clearHF` with bin 10 zeroes bins ≥ 10 only; `clearLF` bin 10 zeroes bins ≤ 10 only; `randLow` bin 5 changes only bins 1–5; on the phase row `clearAll` sets every phase to 0.5.
11. Import: synthetic 220 Hz sawtooth (44.1 kHz, 1 s) with `pitchAvg` → `importSize` = 200.45 ± 1 samples and ≥ 200 frames (≤ 256); `manual` with `parseSplitSize('A3')` = 200 (MIDI 57 = 220 Hz in this app); `parseSplitSize('0')`, `('')` → null, `('169')` → 169; PNG fixture 4×8 → 4 frames.
12. `encodeEmbedded`/`decodeEmbedded` exact round trip; `frameToPoints` of a triangle ≤ 64 points with max error < 0.01.
13. `wtstore.memoryStore()`: put (table and noise record, auto ids with the right prefix) → get (equal content) → list (sorted, kind filter) → rename → del → gc (keeps listed ids, deletes old unlisted ones).

### 10.4 serum-dsp (E3)
1. Loading: the script loads in `vm` without AudioWorklet globals; evaluating `serum-dsp.js` and `fx-dsp.js` **twice into the same context** does not throw and keeps `tables`; a copy of the script that throws inside its body leaves `SerumDSP === null` and does not throw out of `runInContext`; `DIDX`/`FIDX`/`SIDX`/`LAW_TAB`/`SRC_POL`/`UNI`/`FILTER_FAMILY` match the fixtures and §3.
2. Default CP (from `cp-default.json`) + a test-built saw entry: note 69 → 440.0 ± 0.05 Hz (FFT peak interpolation); osc level 0.75 → peak ≈ 0.5625 × table peak ± 0.5 dB; ENV 1 default release: −60 dB reached in < 50 ms after note-off; voice becomes inactive afterwards.
3. Aliasing (no warp, unison 1) as §10.3 item 3 measured on `render` output (proc base 48000 OS 1 and OS 2): ≤ −70 dBc.
4. Unison: N = 7, detune knob 1 (d = 1), range 2: outer voices at ±100 ± 2 cents (separate the partials with a long FFT); Exp mode inner voices closer to centre than Linear; width 0 → L = R exactly.
5. Pitch maths: `a.semi` +1 → ×2^(1/12) ± 0.02 cents; `a.crs` n 1 → +64 st; bend +1 with bendUp 2 → +2 st; `a.track` 0 → f = a4·2^(−69/12) (MIDI 0) regardless of note; `s.oct` −1 → sub one octave down.
6. Matrix: Fixed→`a.semi` bipolar amount 1 → +12 st; LFO with all points y = 0 → −12 st (bipolar); unipolar amount 0.5 from Fixed on `f.cutoff` base 0.25 → eff 0.75; aux (inv) with aux = Fixed → no modulation; curve k ≠ 0 bends; clamping at 1; a row Fixed → `b.on` turns OSC B on at the next chunk with a one-chunk gain ramp.
7. Warps: identity (max |Δ| ≤ 1e-12 vs warp Off) at w = 0 for modes {1, 4, 5, 7, 8, 9, 13–22} and at w = 0.5 for {6, 10}; FM 18/21/22 with the modulator off ≡ Off (same mip level, ≤ 1e-12); Sync w = 1 raises the spectral centroid ≥ 4×; PWM on a square table changes duty (measured via mean of sign) monotonically with w; AM w = 1 with B on at level 0 → 0.5·x (B silent but on); both `a.warpMode` and `b.warpMode` modulated into 18–20 → B behaves as Off; `renderWarp` vs the exact §3.3 formulas within the §0.2 tolerances for 200 random w per mode.
8. Phase: PHASE 0.5, RAND 0 → output starts at the table value at φ = 0.5 for every note (laser-zap repeatability); MemTrig (PHASE 1, RAND 1) → two notes produce identical first 512 samples; mono with the previous note sounding: no reset (max |Δy| over the note-on ≤ 2× steady); `snapshot.memNow` for 2 detuned unison voices equals `frac(φ1 − φ0)` (1e-6).
9. Filter (`SFilter` standalone at fs 96000, white noise or swept sine, res 0, drive 0): every Normal LP type: gain at fc/8 within ±1.5 dB of 0 dB and slope between 2·fc and 8·fc = −(6, 12, 18, 24 by suffix) ± 4 dB/oct; HP mirrored; Band 12 peak within ±1 dB at fc; Notch 12 ≥ 20 dB attenuation at fc; Peak 12 with res 0.8 boosts ≥ 6 dB at fc; Band EQ 12 with var 1 → +24 ± 1.5 dB at fc, var 0.5 → 0 ± 0.5 dB; Low EQ 6/12 var 0 attenuate ≥ 40 dB at fc/16; comb types (Cmb +) peaks at k·fc ± 1 %; Ring Mod with a 1 kHz sine and fc 200 Hz → components at 800 and 1200 Hz; SampHold output is piecewise constant with run length ≈ fs/fc; formant types peak within 15 % of table F1/F2 for vowels at P = 0 and 4; **all 96 types**: 1 s of noise at drive 1, res 1, random var/fc changes every 64 samples → finite output, |y| < 16, no state stuck at NaN; `process(L, R, off, n)` touches only `[off, off+n)`. Voice level: Combs with `f.mix` 0 is still fully filtered.
10. MG Low 24 self-oscillates at res 1 (sine within ±5 % of fc for fc = 500 Hz, fs 96000); German LP clean (THD < 0.1 % at −20 dBFS, res 0).
11. Portamento: mono, porta n 0.5 (0.25 s), curve 0, 60 → 72 with overlap: pitch at 125 ms = 66 ± 0.3 st; `scaled` with a 24-st jump → 0.5 s.
12. Voice steal: retrigger a sounding voice at the same note: max |Δy| over the following 64 samples ≤ 2× the steady-state max |Δy| (no click); `kill()` then `render` → exact zeros.
13. Tables: missing table id → silence, no throw; `storeWT` with an invalid entry → false; `storeWTFrame` changes the output on the next chunk; a voice playing id X goes silent after `dropWT(X)` and sounds again within one chunk after `storeWT(X)`; `epoch` increases on each.
14. Point modulation: LFO with one point linked to bus 1 and a Fixed→bus1 row (+1 unipolar: base 0.5 + 1 → eff 1 → v = 1) raises that point's y to 1; an Off-mode LFO with a bus link uses the mono-context bus value.
15. `fxMods`: a row Env1→`fx.fil.cutoff` returns a non-zero offset at fx idx 79 while the recent voice's env is > 0; `snapshot().eff[42]` reflects an LFO→cutoff modulation; `snapshot(procWithoutSx)` → null.
16. Envelopes: attack with `e1.ca` 0.5 linear (mid-time value 0.5 ± 0.02); `e1.cd` 0.666 → decay at half time below the linear value; a Fixed→`e1.ca` row changes the attack shape; `envT` counts seconds into the stage.
17. CPU: §8.4.3 budgets (a), (b), (c) measured and printed; fail only beyond 3×.
18. Lifecycle: `noteOn` on a voice of a fresh proc before any `begin` → no throw, then renders; 100 successive `apply` calls with fresh but equal CP objects keep the Off-LFO phase and the alt flip-flop (output equals a run without them); re-applying an identical CP mid-note → bit-identical output; OS change through `apply` (proc OS 2 → 4 mid-note: update `fs/OS/CH`, call `apply`) → no NaN, pitch unchanged (FFT peak ± 0.05 Hz); 36 consecutive chunks rendered in two calls (32 + 4 chunks) **without `begin`** → finite, max |Δy| ≤ 2× steady; with `CP.direct = 1` and no `dirL/dirR` the direct sources are in `bufL/bufR`, with them the main bus excludes them.
19. Allocation-free (§10.1) for 1 s of a busy patch: unison 16 on both oscs, FM from B, LFOs Trig/Env/Off with point modulation, chaos per voice and mono, noise, filter type modulated (prealloc), direct out, `begin`/`render`/`fxMods`/`snapshot`.
20. LFOs: BPM 120, ladder `1/4` → period 0.5 s ± 1 chunk; Off + Anchor with a stub `songBeat` → φ = `frac(lfoStart + beat/beats)`; Env mode holds `y(1)`; a loop point wraps while gated and runs out after note-off; delay then rise ramps as §6.12; SMOOTH τ = 0.5·smooth³ s (±10 %); rate n 0 holds the phase.
21. Chaos: bounded (|out| ≤ 1) over 60 s at maximum rate; deterministic for fixed seeds; `c1.bpm` on snaps to the straight ladder.
22. Noise: keytrack ratio (note 72 vs 60 doubles the increment: FFT of LFSR Short); one-shot end → zeros; loop seam continuity; `frameToNoise` of a saw played at notes 60 and 84 at fs 96 kHz: alias ≤ −50 dBc (level selection works).
23. Hooks: after `transport(proc, true)` two renders with identical events are identical (Off LFO, alt, mono chaos, PRNG reset); `idle(proc, n)` advances an Off LFO exactly like rendering n frames (1e-9); `reset(proc)` restores the attach state.
24. Performance destinations: Fixed → `g.wheel` amount 0.5 with host wheel 0.3 → `wheel` source 0.8; host wheel 0.8 → 1 (clamped); `g.bend` likewise in bipolar space.
25. Note-on evaluation: Velocity → `a.uni` (unipolar, amount 1): velocity 1 → N = 16, velocity 0 → N = 1; Rand1 → `a.phase` (RAND 0) gives a different start phase per note, identical for identical seeds.
26. Poly legato: `CP.legato`, poly, a second note while the first is gated: ENV 1 of the second voice at its first chunk ≈ the first voice's level (no attack from 0) and its stage = the first's; without legato it starts at 0.
27. Poly AT: before any `pat` the `pat` source equals channel AT; after `proc.pat[n] = 0.7; proc.patSeen = true` it reads 0.7 for note n only.
28. Release velocity: `noteOff(0.2)` → `relvel` = 0.2 (via a row relvel → `f.cutoff`); `noteOff()` → 0.5.
29. `warmUp(proc)` leaves no state: afterwards `tables` has no `'__warm'`, and a subsequent render equals that of a processor that never warmed up, bit-exactly.

### 10.5 fx-dsp (E4)
1. Loads in `vm` after serum-dsp (twice → no throw); `new FXRack(48000)`; `set(defaultFXP)` and `set(null)` → `process` leaves random L/R bit-identical; with master n 0.7 → gain 0.343 ± 1e-6 after the ramp; `g.bypass` on → output reaches 0 within 5 ms (+1 sample) and returns after it is off.
2. Mix law: Delay feed 0, mix 0.5, Q n 1 (band filter bypassed), impulse → dry tap 0.75, echo 0.5 (± 1e-3) at the delay time; LEVEL n 1 → +12.04 dB, n 0.5 → 0 dB.
3. Delay sync (Q n 1): 120 BPM, BPM on, n 0.625 → echo at 500 ms ± 1 sample; offset ×1.5 → 750 ms; Ping-Pong alternates L/R; Tap->Delay: first echo once at L time, then repeats at R time; at the default Q, `delayFilterResponse` equals the measured response of the band filter within 0.1 dB.
4. EQ: Peak +12 dB at 1 kHz, Q n 0.6 → +12 ± 0.3 dB at 1 kHz; `eqResponse` equals the measured impulse response within 0.1 dB over 20 Hz–20 kHz.
5. Compressor: 1 kHz sine at −6 dBFS, thr n 0.5 (−18.06 dB), ratio 4, attack/release default, mix 1, gain 0 → steady output −15.05 ± 0.5 dBFS; Limit mode: output peak ≤ threshold + 0.1 dB after the look-ahead; attack n 0.3 → look-ahead 0.9 ms → `latency` = 43 samples at 48 kHz; multiband with ratio n → 1:1 (n = 0) → transparent within ±0.5 dB (compare magnitude spectra).
6. Reverb Hall: RT60 (Schroeder integration) for t ∈ {0.1, 0.3} within ±25 % of `0.8 + 11.2t` s at size 1; L/R tails correlation < 0.5; Plate: tail decays monotonically; `idle()` true within 1.2 s after decay below −120 dB with reverb t 0 and input silent.
7. Filter module equals standalone `SFilter` output (≤ 1e-12) for MG Low 6 with identical params.
8. `setMods` offset on `fx.fil.cutoff` reaches the target value by the end of the next `process` call and changes linearly (no step larger than 1/n of the total per sample); `setMods(null)` returns to base the same way.
9. Robustness: every module enabled, every distortion mode, extreme params, 10 s of full-scale noise → finite output, |y| < 32; `reset()` then zero input → exact zeros; `reset(true)` fades over 5 ms before clearing.
10. Enable toggle: switching a module on/off during a sine produces no sample-to-sample jump larger than 2× the sine's max slope (5 ms crossfade).
11. Hyper RETRIG: `trigger()` resets phases (two renders after trigger are identical).
12. `idle()` for every module: each module alone, 0.1 s of noise then silence → `idle()` becomes true within 1.2 s plus the module's maximum tail at default settings (reverb t 0).
13. Phases: `set(fxp with phase P, seed 1)` → `phases()` = P before processing; processing at rate n 0 keeps P (hold); a later `set` with `seed 0` and a different `phase` leaves the phases running unchanged; `transport()` re-seeds to the last `phase`.
14. `distCurve` equals the shaper's static response: a slow ramp x = −1…1 through the module (mix 1, filter OFF, level n 0.5) matches within 1e-3 for the stateless modes {1, 2, 4, 5, 6, 7, 11, 12, 13, 15}.
15. Sanity: chorus (wet/dry correlation < 0.99, L ≠ R), flanger (comb notches move over time), phaser (notch sweep ±2 oct at depth 1), Hyper → Dimension (Dimension adds side only: mid unchanged within 0.1 dB).
16. Lazy allocation: a rack whose FXP has `alloc` all 0 holds no module buffers (`rack.bytes()` test hook ≤ 64 KB); `set` with `alloc[5] = 1` allocates the delay; a module reaches "enabled" only when its buffers exist.
17. Allocation-free `process` (§10.1) for 1 s with every module enabled and `setMods` moving switch destinations (`fx.dly.mode`, `fx.dist.mode`, `fx.fil.type` with `filTypeAll`) → no throw, finite.

### 10.6 UI (E5, E6) — node pure tests + browser QA checklist
Node: importing every browser module (`wk.js`, `graph.js`, `fx-ui.js`, `serum-ui.js`, `wtedit.js`, `wtstore.js`) in node does not throw (no top-level DOM access); `graph.js` `pts` helpers keep §2.3 invariants (random operation fuzz, 1000 steps, with and without `tie`; with `tie` the first/last y are always equal after any y edit); `haloArcs` cases (uni, bi, bipolar source on a unipolar row, negative, clamp, selected source, FX base from `fx`); `knobMenuItems` exact labels/order for 0, 1, 2 rows and with/without MIDI, for a knob and for a power button; `dropRow` defaults (limit on/off, bool dest); `busMenuItems` (linked buses with source labels, then `New bus`; none free → no `New bus`); `lfoTileCount` (only LFO 7 used → 8; nothing used → 4; LFO 5 used → 6); `sortPresets` (secondary sort = previously clicked column); `stepPreset` (wraps within the category); `captureDue`; `moveModule`; `ladderLabel`; `modulePresetPayload`/`applyModulePreset` (Hyper includes `fx.dim.*`; X-Shaper curves included; enable, bypass and order unchanged; locked values kept).
Browser QA checklist (manual, recorded in the PR): every control in §9.3–§9.7 and §9.10 renders, updates the patch (audible), shows correct text; drag-to-modulate onto every control type (knob, numBox, menu, toggle incl. power and routing buttons, seg, slider, MB bar) incl. FX page; halos and live dots animate with LFO→cutoff; right-click menus exact; MIDI learn on a power button; module locks on OSC A/B, SUB, NOISE, FILTER and the three misc locks survive a preset change; filter display cycles magnitude/phase/spectrum; LFO point bus menu and Remove Point Modulations prune rows; keyboard-only: assign LFO 1 → cutoff via context menu, change depth via matrix; touch (Chrome device emulation): long-press menu, drag knob; WT editor: draw, formula, morph, import WAV/PNG, split-size reuse, export WAV re-imports identically, zoom persists; Render OSC Warp with FM from B; Resample A/B/A+B; preset browser sort/filter/arrows/◀ ▶/delete/import/export; responsive at 1440, 1024, 390 px widths; no console errors.

### 10.7 Integration tests (integrator)
- `serum-core` DESTS/SOURCES/FILTERS/uni tables/ladders ↔ `SerumDSP.DIDX/SIDX/FIDX/LAW_TAB/SRC_POL/UNI/FILTER_FAMILY` and `FXDSP.FIDX/LAW_TAB_FX` identical; fixtures in `tests/fixtures/` equal serum-core.
- (M3) `compileSerum` output accepted by `SerumVoice` for all factory presets (each renders non-silent at note 60: peak between −40 and 0 dBFS through `FXRack`).
- `wt.makeEntry`/`makeNoise`/`noiseEntry` output accepted by `storeWT`; `FXDSP.eqResponse` used by fx-ui equals the module.
- Engine harness (node `vm` running `engine.js` after the DSP scripts, with stubs for `AudioWorkletProcessor`, `registerProcessor`, `sampleRate`, `currentFrame` and a fake port):
  a. a patch arrives before its table → silence; after `{t:'wt'}` the output is non-silent within one chunk;
  b. a song note at frame 0 (`songEvents` before the first `begin`, the bounce path) → no throw;
  c. `setPatch` while voices sound (fade-out path) at base 48 kHz (36 chunks) and 192 kHz → finite, click-free tail;
  d. POLY 8 → 4 → 32 and mono ↔ poly while notes sound: the `voices` array is never rebuilt, no throw;
  e. CP.os 2 → 4 while sounding → the engine's OS fade path; voices continue without NaN;
  f. bounce equivalence: a song rendered from tick T via `processorOptions` (patch/song/transport, as bounce) and via messages after 1 s of pre-roll (live path), both with a transport play-with-seek at T → outputs after T equal within −80 dB;
  g. model switch Serum → minimoog: FX modulation offsets cleared (FX dests back at base);
  h. 3 s of silence → the skip path calls `SerumDSP.idle` (an Off LFO's phase matches a fully rendered run);
  i. the warm-up processor and a later processor render identical output for the same events;
  j. `SerumDSP = null` (load failure) → other models render normally, Serum tracks are silent, the rack is bypassed;
  k. `{t:'pat'}` and `{t:'off', rv}` reach the voices (`pat`, `relvel` sources);
  l. a live patch message without `serumT` keeps using the stored CT.
- main.js level (headless browser or manual): project save → load keeps `track.fx` and embedded `wts`; autosave and history contain no `wts`; undo keeps FX edits (keepSound); duplicate track copies `fx`; tempo change resends patches; MIDI program change loads the n-th browser entry.

---

## 11. Integration (for the later integrator; normative where it says MUST, otherwise complete guidance)

Line numbers refer to the current engine.js / main.js / song.js.

### 11.1 Loading and failure isolation
- `addModule` order for the live context **and** every `OfflineAudioContext` (bounce, resample): `serum-dsp.js?v=…`, `fx-dsp.js?v=…`, `engine.js?v=…`. Each DSP `addModule` is awaited with its own `catch` (log, continue): a missing or broken DSP script MUST NOT stop the other models.
- The engine checks `globalThis.SerumDSP` / `globalThis.FXDSP` before every use: with `SerumDSP` missing a `'serum'` patch creates no voices (silent track); with `FXDSP` missing `this.rack = null` (no FX; every rack call guarded).
- Main thread: `wk.loadDSP()` (UI displays). `PatchP` accepts and keeps `serum`, `serumT`, `fxr`, `fxrT`, `needs`, `bpm` without "unknown key" warnings; these objects are consumed only through `SerumVoice.apply` / `FXRack.set`, which copy scalars into fixed-shape fields (§0.2).

### 11.2 Processor fields and the span
- New processor fields: `rack`, `ct` (last CT), `pat = new Float64Array(128)`, `patSeen = false`, `spanF`, getters `bpm` (`tp.play ? 60·base/(tp.fpt·960) : p.bpm`) and `songBeat()` (`tp.play ? tickAt(spanF)/960 : null`). `process()` sets `this.spanF = F0 + off` before each `renderSpan`.
- `renderSpan` for kind `'serum'`: `SerumDSP.begin(this, N)` → active voices `render(bufL, bufR, N, dirL, dirR)` (OS-rate stereo buffers; `dirL/dirR` only when `p.serum.direct`) → `this.rack.setMods(SerumDSP.fxMods(this))` → decimate L, R (and dL, dR) with their own half-band chains → `osFade` on every channel → `this.rack.process(Lb, Rb, n, dLb, dRb)` → DC block → limiter. Other models: unchanged up to chorus/ensemble, then `this.rack.process(Lb, Rb, n)`.
- Silence skip (lines 1980–1987): additionally requires `!this.rack || this.rack.idle()`; in the skip path a Serum processor calls `SerumDSP.idle(this, n)`.
- `stats.voices` = `snapshot.oscVoices` for Serum (cheap: read from `sx`).

### 11.3 Voices and allocation (kind `'serum'`)
- `setPatch`: on a kind change to `'serum'` build **32** `SerumVoice`s once; never rebuild them on POLY or mono/poly changes (the existing `rebuild` condition is replaced for Serum by `kind !== this.kind`). `nUse = p.mode === 'poly' ? p.poly : 1`; a POLY decrease sends `noteOff()` to `voices[nUse…]`; a mono ↔ poly switch does `allOff(false)`, clears `held` and re-triggers keys still held (as the existing `keep` logic).
- Skip lines 1584–1586 (`det`, `pitch`, `target` rewrite) for Serum; the voice never uses those names (§8.4.3).
- Poly allocation considers only `voices[0…nUse−1]`; same-note reuse (line 1680) only when `p.serum.oneNote`, else a repeated note takes a voice by the steal order; mono (`monoPlay`, `seqFire` legato) addresses `voices[0]` only.
- `noteOn` → also `this.rack && this.rack.trigger()`. `noteOff(n, rv)` passes `rv` to the voices it releases (poly: matching gated voices; mono: when the last key is released); `allOff`, sustain release and song playback pass nothing.
- Kind change away from `'serum'`: `this.rack.setMods(null)`, `this.ct = null`.
- `setOS` already calls `v.apply(p)`: the Serum voice handles OS changes there (§8.4.3).
- **Fade-out** (`fadeOut`, lines 1598–1630) for Serum: render stereo into `tailL/tailR` (plus `tailDL/tailDR` when `p.serum.direct`) in pieces of at most `128·OS` frames (`fadeN` is 36 chunks at 48 kHz, 144 at 192 kHz), apply the raised-cosine fade per sample, and mix the tails into the next spans' buffers. Voices treat these calls as extra renders (§8.4.3).

### 11.4 Oversampling (deviation 9)
- For kind `'serum'` the processor's target OS = `min(p.serum.os, cap)`, `cap = 2^floor(log2(384000/base))`. In `setPatch`, a target ≠ `this.OS` goes through the existing `os` message path (fade + `osPend`, or immediate when silent). `{t:'os'}` messages from the host are ignored while the kind is `'serum'`.
- main.js: `makeNode` passes Serum's target in `processorOptions.os`; the oversampling select and `lowerOS` (line 291) skip Serum tracks; the status line reports Serum tracks at their own rate. Bounce/resample: a Serum track's `processorOptions.os` = `min(CP.os, osCap(sr))` regardless of the dialog value.

### 11.5 FX rack, transport, warm-up, reset
- Every processor: `this.rack = FXDSP ? new FXDSP.FXRack(this.base) : null`; `setPatch` → `this.rack.set(p.fxr || null, p.fxrT)`; `{t:'patch'}` with `p.serumT` → `this.ct = p.serumT`.
- Transport: when `songEvents` applies a pending play with `seek` (or starts playing), call `SerumDSP.transport(this, true)` (Serum) and `this.rack.transport()`; on stop, `SerumDSP.transport(this, false)` and, if `p.fxr && p.fxr.silence`, `this.rack.reset(true)` (pref "silence effect tails", inv A19/A20.1).
- Panic: `allOff(true)` plus `this.rack.reset(false)` and `SerumDSP.reset(this)`. `restore()`: `SerumDSP.reset(this)`, `this.rack.reset()`, `this.ct = null`, `this.pat.fill(0)`, `this.patSeen = false`.
- `warmUp()`: after the `WARM` loop, inside the existing `try`: `SerumDSP && SerumDSP.warmUp(this)`; `this.rack && this.rack.warmUp()`.

### 11.6 Messages

| Message | Handling |
|---|---|
| `patch` | `setPatch(d.p)` (incl. `serumT` → `ct`, `fxrT` → rack, Serum OS rule) |
| `on` / `off` | `noteOn(n, v)` / `noteOff(n, d.rv)` |
| `pat` `{n, v}` | `this.pat[n] = v; this.patSeen = true` |
| `wt` | `SerumDSP.storeWT(d.id, d)` |
| `wtf` | `SerumDSP.storeWTFrame(d.id, d.frame, d.levels)` |
| `wtdel` | `SerumDSP.dropWT(d.id)` |
| `smon` `{on}` | `this.sx && (this.sx.mon = on)`; while on, post `{t:'smon', s: SerumDSP.snapshot(this) (Serum) or null, gr: rack.gr(), fxph: rack.phases()}` every ~33 ms of audio |
| `fxph` | reply `{t:'fxph', v: this.rack ? this.rack.phases() : null}` (lets the host save `fx.phase` while monitoring is off) |
| `processorOptions.wts` | `SerumDSP.storeWT(e.id, e)` for each, in the constructor (given to the first node of a bounce/resample context only) |

### 11.7 models.js
- Add the `serum` model: custom-panel flag; main.js `defaults(m)` gains a hook so models with `m.defaults` use it — Serum: `() => ({ s: withPrefs(defaultSerum()) })` (`global.os = prefs.defOs`, `author = prefs.author`); `map(P, v, G)` = `compileSerum(v.s, { bpm: G.bpm, smooth: G.smooth })`; `presets` = `FACTORY_PRESETS` (M3). Naming/branding text must not use Xfer artwork or logos.

### 11.8 main.js
- **Patches**: `buildPatch` passes `G = { …, bpm: project.bpm, smooth: prefs.smooth }`; every track gets `p.fxr = compileFx(tr.fx, { bpm, master, bypass, modded, seed, smooth, silence })` and `p.fxrT` (`master`/`bypass`/`modded` from the Serum state for Serum tracks); `seed` is a one-shot per-track flag set by preset/project/effect-chain/module-preset loads and track creation. `sendPatch` deletes `patch.serumT`/`patch.fxrT` when their key equals the last key sent to that node (per-node maps, cleared when a node is recreated); `makeNode`, bounces and resamples always include them. A tempo change (`tBpm`, line 1402) queues every track's patch after `reanchor`.
- **Tables**: before posting a patch, `ensureTables(patch.needs)`: for ids not yet `sent` to this context → factory (`wt.factoryTable`/`makeNoise` + `makeEntry`) or `wtstore` (`get` + `makeEntry`/`noiseEntry`) → post `{t:'wt', …}` with the data buffers transferred; keep a reference count of ids over all tracks' `needs`; post `{t:'wtdel'}` for ids unreferenced for 10 s. Entries SHOULD be built in a module Worker importing `wt.js` (factory builds take 30–100 ms). Bounce/resample: `processorOptions.wts` = entries for every id any rendered track needs, on the first node only.
- **Track data**: every track-creation path sets `t.fx = defaultFx()` — `freshProject`, `addTrack`, MIDI import (line 1452), and any `S.newTrack` caller; `duplicateTrack` deep-copies `t.fx`; `loadProject` copies `normalizeFx(r.fx)` per track id (as it does for `seq`) and gives tracks without one `defaultFx()`; Serum `vals.s` goes through `normalizeSerum` on load. song.js stays unchanged (its `deserialize` whitelist is bypassed the same way as for `seq`). `track.fx` is kept when a track's model changes.
- **Embedded tables** (§7.10): the `Save` download adds `wts` for every referenced `user:`/`nzuser:` id; `loadProject` decodes `o.wts` into `wtstore` and drops it; autosave (`S.serialize` to localStorage) and `History` never see `wts`.
- **Undo**: `applyRestore(p, keepSound)` also keeps `t.fx = cur.fx` when `keepSound` (FX edits follow the knob-tweak policy, like `vals`).
- **Presets (Serum)**: user presets in localStorage `synth.user.serum` as deep clones (JSON) `{ name, cat, v: { s }, fx }` without `wts`; loading goes through `applyPreset`/`applyPresetFx` (never `Object.assign` of preset objects: factory presets are frozen and `host.edit` mutates in place), followed by a compile with `seed`. Export/import of preset files (JSON with `wts`) via `host.presets.exportFile/importFile`. The host's plain preset `<select>` is not shown for Serum tracks (the panel has its own browser, §9.10).
- **MIDI** (`onMIDI`, line 1774):
  - `0xA0` (poly pressure) → targeted tracks: `{t:'pat', n: d1, v: d2/127}`.
  - `0x80` → `noteOff(d1, …)` with `rv = d2/127` → `{t:'off', n, rv}`; `0x90` with velocity 0 → no `rv`.
  - `0xB0`: CC 1, 64, 120, 123 keep their roles; additionally, for every targeted Serum track, `s.midi[cc]` → write `midiValue(id, d2)` into `s.p` (synth, `g.master`, `g.bypass`), `fx.p` (FX dests) or `macros[m].v`, without a history record, then compile/send (rAF-coalesced) and refresh the UI; `host.midiLearn(destId)` resolves with the next CC 0–119 received (and stores it in `s.midi`).
  - `0xC0 n` → a targeted Serum track loads the n-th entry (0-based) of its preset browser's current filtered, sorted list (`synth.sx.browser`), honouring `askPreset`.
  - Pref "Mod wheel → WT Pos" while a WT editor is open: CC 1 also writes the edited oscillator's `a.wt`/`b.wt` base.
- **Preferences**: read `synth.sx.prefs` for `smooth`, `silenceTails`, `defOs`, `author`, `wheelWt` (defaults §9.7).
- **Resample** (`host.resample(target)`, §9.8): `OfflineAudioContext` (2 ch, 44100 Hz) with the DSP scripts and `engine.js`, one node with the current track's patch (incl. `fxr`) and `processorOptions.wts`; a `song` payload with note 60, velocity 127, from tick 0 for one bar at `project.bpm`, transport playing; length = 1 bar + 2 s; trim the tail after the output stays below −90 dBFS for 50 ms; channels per target; `wt.tableFromWav({sr: 44100, ch}, {mode: 'manual', size: round(44100/f60)})`; ≤ 256 frames; `wtstore.put` as `Resample <n>`; `host.edit` sets `osc[o].wt`.
- **Monitoring**: `host.monitor(on)` posts `{t:'smon', on}` to the track's node and relays `smon` replies to `ui.setSnapshot`; the FX tab of a non-Serum track also turns `smon` on while visible and feeds `FXRackUI`'s `host.gr()` from the replies (`s` is null there); before saving a preset or project with monitoring off, request `{t:'fxph'}` and store the reply in `fx.phase` (no recompile with `seed`).

---

## Appendix A — Inventory Part A coverage map

| Inventory | Spec |
|---|---|
| A1 architecture, Direct Out, FX/master order | §1, §0.3-2/3, §6.6, §8.5.2 |
| A2.1 header, presets, browser (columns, secondary sort, custom category, delete, arrows, ◀ ▶), program change, main menu, resample, author/notes, tooltips, keyboard velocity | §9.2, §9.8, §9.10, §11.8, §2 (`author`, `notes`), §8.7.1 tooltips; **excluded** (ARCH): browser ratings, comment column, prune, hybridize, skins/zoom/resize, drag-export, default.fxp |
| A2.2 locks (parameter, module ×5, FX rack, polyphony, oversampling, tuning) | §2 `locks`, §8.1 `MODULE_FIELDS`/`applyPreset`, §9.3, §9.4, §9.6, §9.7 |
| A2.3 MIDI learn (every DEST-bound control incl. power buttons, saved in the preset) | §2 `midi`, §3.13 (switch destinations), §8.1 `midiValue`, §8.8 `host.midiLearn`, §11.8; **excluded** (ARCH): CC map files, CC rockers |
| A3 OSC A/B controls, phase states incl. capture and mono MemTrig, pitch, frame interpolation, AA, OS | §2.2, §3.3, §3.13, §6.1, §6.3–6.7, §6.9, §7 |
| A4 unison | §3.8, §3.13 (uni dests), §2 `global.uniRange/uniMode`, §6.6 |
| A5 warps (23) incl. single direction, Render OSC Warp | §3.3, §6.7, §8.1 `warpChoice`, §9.3, §9.8 |
| A6 remap editor | §2 `osc[i].remap`, §3.3 remap formulas, §8.6 (`.shp`: deviation 10) |
| A7 sub | §3.6, §3.13 (`s.on`, `s.shape`, `s.oct`), §2 `sub`, §6.3, §6.6 |
| A8 noise (original procedural content), band-limited levels | §7.9, §2 `noise`, §6.8 |
| A9 wavetable format, clm, txt override | §7, §8.2.2 |
| A10 WT editor (layout, zoom persistence, thumbnails incl. reorder, draw tools, FFT area, Single/Process/Morph/Add-Remove/Sort/Import (split-size reuse)/Export, formula parser) | §8.2.3–8.2.8, §8.9, §9.9 |
| A11 filter (96 types, routing, controls, key track, phase and spectrum views, Combs MIX) | §3.4, §3.5, §3.13, §6.11, §8.4.5, §9.3 |
| A12 envelopes (curves automatable) | §3.13, §6.10, §8.6 EnvEditor |
| A13 LFOs (modes, BPM/dot/trip/anchor, rate, rise/delay/smooth, gestures, tied ends, point modulation incl. shared buses and pruning, grid, shapes, loop/start, 480 points) | §2 `lfo`, §3.9, §5.7, §6.12, §8.1 bus helpers, §8.6, §9.3, §9.4 |
| A14 VELO/NOTE, wheel, bend, AT, poly AT, chaos | §3.12, §3.13 (`c1.bpm`, `g.wheel`, `g.bend`), §2 `velo/note/chaos`, §6.3, §6.13, §6.15 |
| A15 macros | §2 `macros`, §3.12, §9.3 |
| A16 drag-and-drop, halos, knob menu, matrix (32 slots, all columns), sources, destinations incl. switches, performance controls, Bypass and FX | §5, §3.12, §3.13, §9.4, §9.5 |
| A17 voicing & portamento, poly legato, one-note limit, polyphony lock | §2 `voicing`, §6.1, §9.3, §11.3 |
| A18 master volume, master tune, A4 | §3.13 (`g.master`, `g.tune`), §2 `global.a4`; **excluded** (ARCH): tuning files, MPE behaviour (MPE sources kept as zero) |
| A19 global page & preferences (incl. silence tails, default OS, default author, ask before preset change, smoothing scale) | §9.7, §11.5, §11.8 |
| A20 FX rack (10 modules, order, enable/bypass, all params and switches modulatable, mix/level, sync ladders, phase memory, chains, module presets incl. X-Shaper curves, lock, Hyper → Dimension) | §2.5, §3.10–3.11, §3.13 (FX segment), §8.5, §9.6 |
| A21 SerumFX, A22 folders | not applicable (web app; storage = IndexedDB/localStorage) |
| A23 parameter quick reference | §3.13 (matrix amounts/outputs not destinations, §3.13 note) |

---

## Review log (v1 → v2)

Every point raised by the two v1 reviews, with its resolution. "Fixed" = adopted as proposed; "Adapted" = the problem is fixed differently, with the reason; "Rejected" = not adopted, with the reason.

### Critic A (coverage)

| # | Point | Resolution |
|---|---|---|
| A1 | Destination list incomplete | **Fixed.** 29 synth (idx 119–147: on/route/track/warp mode/sub shape+octave/filter type/env curves/chaos BPM/Mod Wheel/Pitch Bend) and 14 FX (fx idx 86–99: Bypass + every automatable FX switch/enum) destinations appended; state moved into `s.p`/`fx.p` (§2, §2.5); NS/NF/ND = 148/100/248; `exp/gen.mjs` regenerated; DSP reads them per chunk (§5.6, §6). Bypass is a post-FX output gate (§6.15). Matrix amounts/outputs stay excluded (§3.13 note). |
| A2 | Oversampling inaudible on the real host | **Fixed** (with B15): Serum processor OS = `min(CP.os, cap)`, host OS setting not applied, no internal OS (§6.9, §11.4, deviation 9); GLOBAL page shows the effective rate. |
| A3 | Poly legato undefined | **Fixed.** §6.1 row (IMPL) + test §10.4.26. |
| A4 | Phase-memory capture missing | **Fixed.** `memNow` in the snapshot, capture rule in serum-ui (§6.4, `captureDue`), mono MemTrig rule (§6.1); tests §10.4.8. |
| A5 | Locks incomplete | **Fixed.** `locks.misc {poly, os, tuning}`, Lock Module on all five modules, full `MODULE_FIELDS` map (§2.2, §8.1, §9.3, §9.7). |
| A6 | MIDI learn too narrow | **Fixed / adapted.** With A1 every power button is a DEST, so the DEST-id map covers them (no special `osc0.on` keys needed); preset map wins when non-empty (`applyPreset`); every CC routed (§11.8); grid snapping via `midiValue` (B37). Non-automatable structured switches stay unlearnable (they are not automatable in S1 either). |
| A7 | Base preset browser unspecified | **Fixed.** §9.10 `PresetBrowser`, `host.presets`, `cat` in presets (deviation 12), program change (§11.8). |
| A8 | Preferences incomplete | **Fixed.** Full `synth.sx.prefs` set (§9.7) incl. `limitDrop` off behaviour (§5.8), `defOs`/`author` (§2.1, §9.8), `smooth` (§4.1, §4.2, §5.4), `silenceTails` (§11.5), `askPreset` (§9.10). |
| A9 | Warp single-direction UI reverts the choice | **Fixed.** `warpChoice` (most recent wins), keep-A only in normalize, runtime rule for modulated modes (§3.3, §8.1). |
| A10 | Warp identity test wrong | **Fixed** (with B42): §3.3 neutral settings, §10.4.7. |
| A11 | `toSpectrum` clamps | **Fixed / adapted.** Unclamped magnitudes, exact round trip test on `factory:Square` (§8.2.1, §10.3.9). Display: **absolute** editor units with an auto range `[0, max(1, max)]` rather than relative-to-fundamental (inv A10.4 [med]) — relative scaling is undefined once the fundamental is removed and would rescale every bar when bin 1 is edited; q-formulas are normalised afterwards, so the presets behave identically. |
| A12 | Reverb default pair mismatched | **Fixed.** Hall default with `c` 0.25 / `w` 0.20 (§3.13). |
| A13 | Filter MIX on Combs | **Fixed** for the voice filter (§6.11, §9.3). The FX Filter module keeps its MIX for Combs: inv A11.1 describes the voice filter only, and the module's MIX is the rack's per-module mix. |
| A14 | FX phase memory under-specified | **Adapted.** Re-seeding is triggered by an explicit `seed` flag (§4.2, §8.5.2) instead of "phase array differs": saving `fx.phase` would otherwise change the array and re-seed audibly mid-play. L/R and chorus/Hyper rules, rate-0 hold and `transport()` specified; test §10.5.13. |
| A15 | Hyper/Dimension order | **Fixed.** Dimension(Hyper(x)), separate MIX/LEVEL (§8.5.2). |
| A16 | Point-mod bus menu and cleanup | **Fixed.** `busMenuItems`, `linkedBuses`, `newBus`, `pruneBuses`, `clearPointMods`; drop on a point = New bus (§8.1, §8.8, §9.4); tests. |
| A17 | Resample optional and vague | **Fixed.** Required, fully defined (§9.8, §11.8). Velocity 1 = MIDI 127. |
| A18 | Render OSC Warp modulator for 18–22 | **Fixed** (§9.8). |
| A19 | LFO point capacity | **Fixed.** `MAX_PTS = 480` (§2.3, §4.4); state limit raised with B40. |
| A20 | `.shp` silently dropped | **Adapted.** Explicit exclusion as deviation 10 (needs lead sign-off; the LFOTool binary format is undocumented), JSON library shared by LFO/Remap/X-Shaper (§8.6). |
| A21 | Split-size reuse | **Fixed** (§9.9, `parseSplitSize` §8.2.1). |
| A22 | Thumbnail reorder op | **Fixed.** `add.move` + tests (§8.2.6, §10.3.8). |
| A23 | FFT menu arguments | **Fixed** (§8.2.8). |
| A24 | "Nudge to 50 %" vs phase units | **Fixed.** Phase units centred: sine phase = 0.5 everywhere (§8.2.1, §8.2.6, §8.2.8, §9.9). |
| A25 | Halos for bipolar sources on unipolar rows | **Fixed** (§5.8). |
| A26 | Compressor display | **Fixed.** `cmpAtt` format, `CMP_RATIO_DETENTS` knob detents, Dist Q law changed to the engine value `0.5·16^n` (§3.2, §3.11, §3.13). |
| A27 | Poly AT / release velocity stubbed | **Fixed.** `pat` message and `off.rv` (§3.12, §6.2, §11.6, §11.8; deviation 8 rewritten). main.js does receive these bytes but currently ignores 0xA0 and the note-off velocity; the integrator adds both. |
| A28 | One-note limit not optional | **Fixed.** `voicing.oneNote` / `CP.oneNote` (§2.2, §9.3, §11.3). |
| A29 | Module-preset payload undefined | **Fixed** (§9.6, `modulePresetPayload`/`applyModulePreset`). |
| A30 | Typed synced rates | **Fixed** (§8.1 `parseParam`). Chaos uses the Hz equivalent of the label because its rate law stays continuous (§6.13). |
| A31 | Matrix "12st" formula | **Fixed** (`semitoneAmount`, incl. octave and cent units; §8.1, §9.5). |
| A32 | LFO tile visibility | **Fixed** (`lfoTileCount`, §9.3). |
| A33 | LFO end points | **Fixed.** Tied ends for kind `lfo` on edit; factory saws use a vertical step at x = 1 (§2.3, §8.6). |
| A34 | Wavetable to LFO Shape source | **Fixed** (submenu From OSC A / B, §9.3). |
| A35 | Filter spectrum view | **Fixed** (`filtTap`, display cycle; §6.11, §9.3). |
| A36 | WT editor zoom persistence | **Fixed** (`synth.sx.wte`, §8.9, §9.9). |

### Critic B (contract / implementability)

| # | Point | Resolution |
|---|---|---|
| B1 | fadeOut path | **Fixed.** Extra-render rule (§8.4.3), pieces ≤ 128·OS and stereo tails (§11.3), tests §10.4.18 and §10.7c. |
| B2 | `proc.sx` before first begin / wiped per CP | **Fixed.** `attach`/`reset` (§8.4.2), never reset on CP change; tests §10.4.18. |
| B3 | Engine mutates voice fields | **Fixed.** Reserved names, `note = −1`, integrator skips lines 1584–1586 (§8.4.3, §11.3). |
| B4 | `apply` is the OS hook | **Fixed** (§8.4.3; `begin` rescales on CH change); test §10.4.18. |
| B5 | Re-evaluation as classic scripts | **Fixed.** Mandatory IIFE (§0.2); test loads both scripts twice into one context (§10.4.1). |
| B6 | Load failure kills all audio | **Fixed.** try/catch → `null` global; per-script `addModule` catch; engine guards (§0.2, §11.1); tests §10.4.1, §10.7j. |
| B7 | `DEFAULT_FXR` undefined | **Fixed.** `FXRack.set(null)` (§8.5.2). |
| B8 | Stale FX mods after model switch | **Fixed.** `setMods(null)` on kind change (§5.5, §11.3); test §10.7g. |
| B9 | song.js drops data; track creation paths | **Fixed** in main.js (song.js unchanged, extras carried like `seq`); FX persists across model changes (§2.5, §11.8). |
| B10 | Embedded tables bloat autosave/history | **Fixed.** `wts` only in exported files (§7.10, §11.8). |
| B11 | Presets alias live state | **Fixed.** `applyPreset` returns fresh objects; deep-frozen factory presets; JSON deep clone on save (§8.1, §11.8). |
| B12 | Undo inconsistency | **Fixed.** `keepSound` keeps `fx` too (§11.8). |
| B13 | Tempo plumbing | **Fixed.** `G.bpm`, patch resend on tempo change, `spanF`, `songBeat`, `bpm` precedence (§8.4.1, §11.2, §11.8). |
| B14 | POLY change reallocates voices | **Fixed.** 32 voices once, no rebuild (§11.3, deviation 11); test §10.7d. |
| B15 | Host OS multiplies cost; lowerOS backfires | **Fixed** (with A2); budgets restated per OS (§8.4.3). |
| B16 | ~90 KB patch messages | **Fixed / adapted.** Constant tables removed from CP and embedded in the DSP (instead of a `sxconst` message: one fewer message type, and the integration test already compares constants); curve tables moved to CT/FXT sent only when their key changes (§4.1, §4.2, §11.8). |
| B17 | Structured-clone deopt | **Fixed** (§0.2, `apply`/`set`/`begin` copy scalars). |
| B18 | Filter/FX memory | **Fixed.** Per-family lazy allocation, `prealloc` when the type is modulated, FX `alloc` from `modded`, Float32 long lines, budgets (§8.4.5, §8.5.2, §4.2). |
| B19 | Per-sample transcendentals | **Fixed.** Approximation tolerances with exact neutral settings (§0.2), tests (§10.4.7). |
| B20 | CPU scenario too narrow | **Fixed.** Budgets (a) 0.4 s, (b) 0.9 s, (c); mip hysteresis (§6.5); modded-only recompute (`CP.modded`, §5.6). |
| B21 | JIT warm-up misses Serum | **Fixed.** `SerumDSP.warmUp`, `FXRack.warmUp`, engine call site (§8.4.2, §8.5.2, §11.5); tests §10.4.29, §10.7i. |
| B22 | Table memory lifecycle / transfer vs caches | **Fixed.** Fresh entry buffers, `wts` to the first bounce node only, refcount + `wtdel` after 10 s, crossfade tables not expanded (normative), Worker build as SHOULD (§7.5, §8.2.1, §11.8). |
| B23 | Replaced/freed tables | **Fixed.** `SerumDSP.epoch` (§6.5, §8.4.2); test §10.4.13. |
| B24 | Note-on sampled values undefined | **Fixed.** Note-on evaluation with `mOn` (§4.1, §6.1); test §10.4.25. |
| B25 | No source-polarity table | **Adapted.** Embedded constant `SRC_POL` (polarity is constant per source, so it need not travel in CP); straight chaos ladder defined as `128·2^(−i)` (§3.9, §6.13). |
| B26 | Mono context cannot see buses | **Fixed.** Bus scope `V*M` (§3.13, §5.7). |
| B27 | `begin` order | **Fixed** (§5.5). |
| B28 | Snapshot vs consumers | **Fixed.** `envT`, int `notes`, `wtPos` units, null without `sx`, `smon` shape for non-Serum tracks, `fxph` request (§8.4.2, §8.4.4, §11.6). |
| B29 | Helpers cannot see FX bases | **Fixed.** `fx` parameter and `opts.limit` (§8.1, §8.8). |
| B30 | Host `monitor` name collision | **Fixed.** FXRackUI host uses `gr()`; adapter specified (§8.7.2); `FXRack.monitor()` renamed `gr()` too. |
| B31 | graph.js cannot get a context menu | **Fixed.** New `wk.js` (§0.1, §8.7.1, deviation 6). |
| B32 | FX rack UI cannot load the DSP | **Fixed.** `loadDSP` in `wk.js`; `FXDSP.filterImpulse` re-export (§8.5.1, §8.7). |
| B33 | `SFilter.process` without offset | **Fixed** (§8.4.5). |
| B34 | Point-table layouts ambiguous | **Fixed** (§4.1 CT, §4.4). |
| B35 | `frame` format ctx | **Fixed** (`frames` + `interp`, §3.2). |
| B36 | `FXP.any` misuse | **Fixed.** Advisory only (§4.2, §8.5.2). |
| B37 | MIDI learn off-grid values | **Fixed** (`midiValue`, §8.1). |
| B38 | Silence skip freezes `begin` | **Fixed.** `SerumDSP.idle` in the skip path (§6.16, §11.2); tests §10.4.23, §10.7h. |
| B39 | Noise band-limiting | **Fixed.** Decimated noise levels with selection by increment; aliasing beyond the last level accepted (§6.8, §7.5, §7.9); tests. |
| B40 | 64 KB state limit unachievable | **Fixed.** Limit 256 KB, coordinates rounded to 5 decimals (§2, §2.3); test §10.2.9. |
| B41 | Inexact defaults, `hi` mismatch, fixture names, temp location | **Fixed.** Exact fractions in §3.13, `MIDI0`/`440·2^(59/12)` bounds, fixtures with §8.1 field names generated into `exp/fixtures/` and copied into `tests/fixtures/` by E1 in M1 (§0.5, §3.13). The fixtures were not written into the repository by the architect: the project is a deployed static site and the M1 owner commits them with the first code. |
| B42 | Warp test contradicts §3.3 | **Fixed** (with A10; tolerance 1e-12; FM off ⇒ I = 0). |
| B43 | Law round trip fails on clamped laws | **Fixed.** Invertible domains + reverse check (§3.1, §10.2.4). |
| B44 | Delay tests impossible with the band filter | **Fixed.** Band filter bypassed at Q n ≥ 0.999; tests run at Q n 1 and a separate filter-response test (§8.5.3, §10.5.2–3). |
| B45 | Bounce ≠ live render | **Fixed.** `SerumDSP.transport`/`FXRack.transport` reset on play-with-seek; equivalence defined on the node engine harness (§6.16, §10.7f). |
| B46 | Missing tests | **Fixed.** Added across §10.3–§10.7 (fadeOut, pre-begin noteOn, identical CP, OS change, allocation-free, direct bus, LFO/chaos/noise, FX idle/phases/distCurve/sanity/`set(null)`, memoryStore, patch-before-table). |
| B47 | Browser modules importable in node | **Fixed** (§0.1 rule, §10.6 import test). |
| B48 | E5 overload, cross-dependency, presets authored blind | **Fixed.** graph.js + wk.js → E6, wtedit.js → E2, factory presets in M3, milestone M1 defined (§0.1, §0.5). |
