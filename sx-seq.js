/*
 * sx-seq.js — the Serum-style instrument's sequencer in the audio thread: keyboard stage, arpeggiator, clip player
 * (classic script, no imports/exports; owner D6). Contract: SPEC-serum2 §7 (semantics), §7.7 (engine contract), §11.9
 * (exports), §4.4 (SQP v1 and seqT parts, produced by seq-core.js compileSeq), §0.3 / §0.4 (IIFE shape, lazy references,
 * allocation-free hot paths, determinism).
 *
 * Script #8 of the §0.3 list. Evaluated in every AudioWorkletGlobalScope, on the main thread (wk.loadDSP) and in node vm
 * contexts (tests/dsp-scope.mjs). Reads no other script's global at load time; the only cross-script reference is the
 * engine's MIDI OUT registry (below), resolved lazily. The whole file is one IIFE publishing the frozen `globalThis.SxSeq`;
 * a failure inside leaves SxSeq = null (the §0.3 "Failure ⇒" state: the engine plays notes directly).
 *
 * Exports:
 *   VER 1 (= seq-core SQP_VER) · sizes N_SLOTS 12, MAX_EV 512, MAX_STRUM 512, MAX_NOTES 4096 (per processor = per bank),
 *   MAX_CLIP_NOTES 1024, LANE_W 129, ARP_ROW 40, CLIP_ROW 24
 *   constants (identical to seq-core, compared by tests/seq.test.mjs): SCALE_REL Uint16Array(42) (scale steps as a 12-bit
 *   set relative to the key), LAUNCH_BEATS (9), TIME_BEATS (7), GRID_BEATS (7), RRATE_BEATS (6), CLIP_RATE_MUL (11),
 *   SWING_DIV (3), ARP_LAD [4 × Float64Array] (arpLadder(dot, trip) beats, v = dot + 2·trip)
 *   scaleMask(key, scale), quantize(note, key, mask), swingTime(beat, s, d) — = seq-core (§3.15.7, §7.2); allocation-free
 *   Seq — per processor (engine field `sxSeq`, §7.7):
 *     new Seq(proc)                allocates the small tables (≈ 29 KB); the event / note / lane pools (≈ 680 KB) are allocated
 *                                  by the first apply() with seq.active = 1 (an unused sequencer never holds them, §14.2);
 *                                  nothing allocates afterwards
 *     apply(sqp, seqT)             patch.seq (+ optionally patch.seqT {key, parts}, any subset) → true; an invalid / other-major
 *                                  SQP makes the sequencer inert (input passes through unchanged) and warns once → false.
 *                                  An SQP with active = 0 (or an invalid one) releases every generated note at once, stops the
 *                                  clip players and the arpeggiator and writes NaN into proc.seqMacro (nothing keeps sounding or
 *                                  overriding a macro once the engine stops calling the sequencer, §0.7 / §14.1 cheap bypass)
 *     merge(part)                  one seqT part copied into the tables → true; malformed (shape, or a value used as a divisor,
 *                                  loop bound or index: pattern / clip length, region, modes, unsorted or non-finite records)
 *                                  → false (warns once). Before the pools exist a valid part is kept by reference and copied
 *                                  when they are allocated.
 *     next(F)                      frames to the next sequencer event (≥ 1), 1e9 when none
 *     fire(F)                      emits every event due at F (note-offs first) through proc.sxNote(on, n, vel, ch, x, y, z, gen)
 *     input(on, n, vel, ch, F, ext) an input note (§7.1 chain); ext = 1 for a note delivered by another track's MIDI OUT
 *                                  (PROCS ring, §7.9): it is played but never forwarded again (no chains, no loops). The 6th
 *                                  argument extends §7.7's signature (ratified, RULINGS2 D6; engine.js extEvents passes it)
 *     cmd(name, arg)               'arpLaunch' j · 'arpStop' j · 'clipLaunch' j · 'clipStop' j · 'clipStopAll' · 'latch' 0/1 → true
 *     transport(playing), panic(), snapshot(out Float64Array(16)) (§7.10)
 *
 * Engine obligations (beyond §7.7): while seq.active, every note event goes through input(); while seq.active = 0 the engine
 * may skip next() / fire() / input() entirely (apply() has released everything), EXCEPT that an input note-off MUST still be
 * routed to input() while heldN > 0 (keys pressed while the sequencer was active: input() knows which note each one started,
 * after TRANSPOSE / KEY, and releases exactly that). heldN counts held input keys only, never generated notes.
 *
 * Engine fields read (lazily, per span; a missing one degrades as noted):
 *   proc.sxNote(on, n, vel01, ch, x, y, z, gen)   the allocator entry (§12.3); generated notes: ch 0, gen 1, x/y/z ∈ [0, 1]
 *                                                (neutral 0.5, 0.5, 0); input notes passed on: their channel, gen 0, x = y = z = 0
 *   proc.tp {play, frame, tick, fpt}  song transport (beat = tick / 960); absent → the free clock only
 *   proc.bpm (free-clock tempo while stopped), proc.base (sample rate; default 48000)
 *   proc.sx.mod.monoOff / monoEff  (SxMod mono context, §7.3: eff arp.on / clip.on and the offsets of the virtual
 *                                 destinations arp.* / clip.*); absent → CP base (proc.p.serum.base) for arp.on / clip.on, no offsets
 *   proc.p.serum.mapVLo[5] / mapVHi[5]  velocity range of the ARP row of OSC MAPPING (default 1–127)
 *   proc.seqMacro                Float64Array(8): macro bases from clip lanes (§7.5.5), NaN = none; absent → not written
 *   proc.procs                   the engine's PROCS registry (Map trackId → processor, §7.9). An AudioWorklet evaluates every
 *                                script as a module, so engine.js's module-level PROCS is not visible here: the engine MUST
 *                                expose it as this field (an addition to §12.2, ratified by RULINGS2 D6). There is deliberately
 *                                no fallback to a global binding (it would only exist in the node harness and hide a missing
 *                                field). No registry → MIDI OUT events are dropped (single-track renders, §7.9).
 *
 * Normative behaviour: SPEC-serum2 §7. Interpretations fixed here (IMPL, documented in the M2 and review-fix reports):
 *  - Timebase: playing → song beat tickAt(F)/960; stopped → a free clock at proc.bpm, reset to beat 0 when the sequencer
 *    goes from idle to busy. Grids (arp steps, launch quantise) are taken in the UNSWUNG domain u = swingInv(beat); event
 *    times are mapped back through swingTime (kbd swing), so swing moves offbeats of every grid and clip note starts / ends.
 *    Hz-rate arps run in frames (no swing). A discontinuity of the song position without transport(true) (loop wrap,
 *    reposition) shifts every beat-anchored schedule by the jump so running arps / clips continue seamlessly, except a
 *    playing clip with RETRIG off, which resyncs to the new position (§7.5.2: its playhead follows the song beat).
 *    transport(true) applies §7.8 (PRNG ← seed, arps restart at the next LAUNCH QUANT boundary — quant Off: the next step
 *    of their RATE grid —, RETRIG-off clips resync, others restart at their next quant). Until its restart a running arp or
 *    RETRIG-on clip is PAUSED (no note of the skipped span is replayed; a paused clip's playhead stays where it was).
 *    Span granularity: the engine handles transport messages, loop wraps and song notes at the first 4-frame span boundary
 *    at or after their frame, so an event handled at F is placed from up to 4 frames earlier (never before the timebase's
 *    anchor): a seek / wrap starts from the transport anchor (tp.frame / tp.tick) when it lies in (F − 4, F], and a grid
 *    point in that window counts as now for arp kicks, launches and stops — the events at the anchor are due at F, so a
 *    render is the same live and offline (an older anchor, e.g. a node created mid-song, starts from F − 4).
 *    A play with seek also starts the next run of an arp between runs fresh (positions, velocity run), as it reseeds the
 *    PRNG. transport(false) releases the generated notes (§7.8); arps and clips keep running on the free clock (transport
 *    stop is not a §7.5.1 stop source).
 *  - Idle → busy (stopped transport): the free clock, the PRNG, the step / pass / repeat positions, random orders and the
 *    velocity run reset, so a phrase started from idle equals a fresh processor's output (render-last, §12.6 / App. C A6).
 *  - Arp: the first step of a run (H empty → non-empty) lands on the next grid point of its RATE (at once after an idle
 *    free-clock reset); within a busy period step shapes keep their position across runs unless retriggered (FIRST / NOTE /
 *    LAUNCH / RATE), a Pattern restarts at every run start. A RATE change re-grids a BPM arp: the next step lands on the
 *    new RATE's grid (Hz: phase-continuous). REPEATS / One Shot stop the arp until the next retrigger: a fresh press after a
 *    full release, NOTE / FIRST / LAUNCH, or the next RETRIGGER RATE boundary (scheduled while stopped). 'arpStop' (the
 *    stop button) is not undone by RATE. A Pattern's RATE retrigger is its own event on the RRATE grid (the pattern restarts
 *    exactly there, whatever its events). A UI selection (seq.arpG[3]) never launches: it becomes the playing slot only
 *    while the arpeggiator is idle (no run, no pending launch); launches come from the play button / trigger keys (§13.7).
 *    Pattern rows < 0 wrap downwards (negative wrap transposition), Chord inversions
 *    for rows < 0 lower the highest notes, New Only / Chord (new) index the notes that arrived since the previous event,
 *    a pattern event's velocity is its own (VELOCITY: v_run), the vel lane replaces it and accent then multiplies by 1.3,
 *    the note length is len16 · GATE (· gate lane) steps, strum comes from the strum entry at the event's position.
 *    In Pattern mode RANGE passes advance once per pattern loop (Pendulum: per round trip). OFFSET rotates every
 *    deterministic order and Rand Once's permutation. A pitch occurring twice in one step / event group (octave doublings,
 *    RANGE passes with SHIFT 0) sounds once (the loudest velocity, the longest length).
 *  - Clip: Reverse fires a note when the backward-moving playhead crosses its start (as the arp pattern, §7.4.3); a note
 *    crossing the region end is cut there; Static holds the notes covering the start position until the clip stops or
 *    restarts (every (re)start releases the previous snapshot first); MONO
 *    stops the other clips at the new clip's start; launches and stop commands are quantised to the clip's LAUNCH QUANT,
 *    NOTE GATE / clip.on off / One Shot end stop at once. Trigger-octave keys toggle their clip (NOTE GATE: the key's
 *    release stops it). KB SPAN Mono: the first key (re)launches (RETRIG), later keys only transpose.
 *    RETRIG off (§7.5.2) is read with the clip RATE: playhead = start + mod(4·rate·u − 4·rate·u_anchor, len − start), u the
 *    unswung beat, u_anchor = 0 — "as if it had run since the anchor" at its rate (the literal formula, without the rate,
 *    would jump at every resync of a clip whose RATE is not ×1). The current eff rate is used (a modulated rate cannot be
 *    integrated back to the anchor). Ratified by RULINGS2 D6; U4 / I compute the same playhead.
 *  - Edits while playing (merge of the playing slot's / clip's part): changed notes or events re-seek the cursor to the first
 *    record not yet fired and not in the past (a record added behind the playhead plays at the next pass); a clip's new
 *    region / MODE / slice TIME continues from the playhead's position wrapped into the new region (switching to or from
 *    Static restarts there); a pattern's new MODE / LENGTH / TIME restarts the pattern at the next step boundary.
 *  - MIDI OUT: 'Clip Player' taps the clip output (transposed, before key/scale and the arp); 'On' taps everything the
 *    sequencer sends to the voice allocator (input pass-through, THRU, arp and clip notes). Both panes may tap; one
 *    target receives each event once (a clip note reaching a target through the Clip Player tap is not sent to it again by
 *    the On tap of the other pane). Note-offs always go to the processor that received the note-on.
 */
(function () {
  'use strict';
  try {
    const VER = 1;
    const N_SLOTS = 12, MAX_EV = 512, MAX_STRUM = 512, MAX_NOTES = 4096, MAX_CLIP_NOTES = 1024, LANE_W = 129;
    const ARP_ROW = 40, CLIP_ROW = 24, ARP_LANES = 4, CLIP_LANES = 8, NCH = 17;
    const MAXH = 32, MAXOFF = 128, MAXON = 64, MAXP = 16, MAXCOPY = 8, MAXQ = 32, MAXG = 128, MAXKB = 32;
    const MAX_PAT_LEN = 256, MAX_CLIP_LEN = 1024;  // pattern / clip LENGTH bounds, sixteenths (= seq-core)
    const SEED = 0x9E3779B9;                        // sequencer PRNG seed (= seq-core arpOrder's default state)
    const EXT_DELAY = 128;                          // MIDI OUT latency: one render quantum (§7.9)
    const GRAN = 4;                                 // the engine's span granularity (frames): transport / wrap anchors lag F by < GRAN
    // voice-vector indices of the sequencer destinations (§3.11.1: vi = idx − 100 for idx ≥ 248)
    const VI_ARP_ON = 406, VI_ARP_RATE = 407, VI_CLIP_ON = 420, VI_CLIP_TRANS = 421, VI_CLIP_RATE = 422, VI_CLIP_OFF = 423;
    // input record flags
    const R_REC = 1, R_PASS = 2, R_ARP = 4, R_KB = 8, R_TRIGA = 16, R_TRIGC = 32, R_DROP = 64;
    const INF = Infinity;

    /* ------------------------------------------------------------ constants (= seq-core §3.15) */
    const SCALE_STEPS = [
      [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 8, 11], [0, 2, 3, 5, 7, 9, 11], [0, 2, 3, 5, 7, 9, 10],
      [0, 1, 3, 5, 7, 8, 10], [0, 2, 4, 6, 7, 9, 11], [0, 2, 4, 5, 7, 9, 10], [0, 1, 3, 5, 6, 8, 10], [0, 2, 4, 7, 9], [0, 3, 5, 7, 10],
      [0, 3, 5, 6, 7, 10], [0, 2, 3, 4, 7, 9], [0, 2, 4, 6, 8, 10], [0, 2, 3, 5, 6, 8, 9, 11], [0, 1, 3, 4, 6, 7, 9, 10], [0, 3, 4, 7, 8, 11],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 2, 3, 6, 7, 8, 11], [0, 1, 4, 5, 7, 8, 11], [0, 1, 3, 5, 7, 9, 11], [0, 1, 3, 5, 7, 8, 11],
      [0, 1, 4, 5, 6, 8, 11], [0, 1, 4, 5, 7, 8, 10], [0, 2, 4, 6, 7, 9, 10], [0, 1, 3, 4, 6, 8, 10], [0, 2, 4, 5, 7, 8, 9, 11],
      [0, 2, 4, 5, 7, 9, 10, 11], [0, 1, 5, 7, 8], [0, 2, 3, 7, 8], [0, 1, 5, 6, 10], [0, 2, 3, 7, 9], [0, 1, 3, 7, 8], [0, 2, 5, 7, 10],
      [0, 2, 4, 6, 9, 10], [0, 1, 4, 6, 8, 10, 11], [0, 2, 4, 5, 6, 8, 10], [0, 1, 3, 4, 5, 6, 8, 10], [0, 3, 4, 6, 7, 9, 10], [0, 2, 5, 7, 9],
      [0, 2, 4, 5, 7, 9], [0, 2, 3, 5, 7, 10],
    ];
    const SCALE_REL = new Uint16Array(SCALE_STEPS.length);
    for (let i = 0; i < SCALE_STEPS.length; i++) for (const k of SCALE_STEPS[i]) SCALE_REL[i] |= 1 << k;
    const LAUNCH_BEATS = Float64Array.from([0, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16]);
    const TIME_BEATS = Float64Array.from([0.25, 0.5, 1, 2, 4, 8, 16]);
    const GRID_BEATS = Float64Array.from([1, 0.5, 0.25, 0.125, 0.0625, 1 / 3, 1 / 6]);
    const RRATE_BEATS = Float64Array.from([1, 2, 4, 8, 16, 32]);
    const CLIP_RATE_MUL = Float64Array.from([1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2, 3, 4]);
    const SWING_DIV = Float64Array.from([0.5, 0.25, 0.125]);
    // arp RATE ladders in beats: straight entries + dotted (× 1.5) / triplet (× 2/3) of the first 8, slowest first
    const ARP_STRAIGHT = [16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625];
    const ARP_LAD = [];
    for (let v = 0; v < 4; v++) {
      const L = [];
      for (let i = 0; i < ARP_STRAIGHT.length; i++) L.push([ARP_STRAIGHT[i], 0]);
      if (v & 1) for (let i = 0; i < 8; i++) L.push([ARP_STRAIGHT[i] * 1.5, 1]);
      if (v & 2) for (let i = 0; i < 8; i++) L.push([ARP_STRAIGHT[i] * 2 / 3, 2]);
      L.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      ARP_LAD.push(Float64Array.from(L, (e) => e[0]));
    }
    Object.freeze(ARP_LAD);

    /* ------------------------------------------------------------ pure helpers (allocation-free) */
    function scaleMask(key, scale) {
      if (!(key >= 0 && key <= 11)) return 0xFFF;
      const k = key | 0, s = scale >= 0 && scale < SCALE_REL.length ? scale | 0 : 0, rel = SCALE_REL[s];
      return ((rel << k) | (rel >>> (12 - k))) & 0xFFF;
    }
    function quantize(note, key, mask) {
      if (!(key >= 0) || (mask & 0xFFF) === 0xFFF || (mask & 0xFFF) === 0) return note;
      const n = Math.round(note), pc = ((n % 12) + 12) % 12;
      for (let d = 0; d <= 6; d++) {
        if ((mask >> ((pc - d + 12) % 12)) & 1) return n - d;
        if ((mask >> ((pc + d) % 12)) & 1) return n + d;
      }
      return n;
    }
    function swingTime(beat, s, d) {
      if (s === 0 || !(d > 0)) return beat;
      const ss = s < -1 ? -1 : s > 1 ? 1 : s, P = 2 * d, k = Math.floor(beat / P), u = beat - k * P, m = d * (1 + 0.75 * ss);
      return k * P + (u < d ? u * m / d : m + (u - d) * (P - m) / d);
    }
    function swingInv(beat, s, d) {
      if (s === 0 || !(d > 0)) return beat;
      const ss = s < -1 ? -1 : s > 1 ? 1 : s, P = 2 * d, k = Math.floor(beat / P), u = beat - k * P, m = d * (1 + 0.75 * ss);
      return k * P + (u < m ? u * d / m : d + (u - m) * d / (P - m));
    }
    const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);         // NaN → 0
    const mod = (a, m) => { const r = a % m; return r < 0 ? r + m : r; };
    const nextQ = (u, q) => (q > 0 ? Math.ceil(u / q - 1e-9) * q : u);
    // built-ins captured at load: hot paths never look up a constructor (the allocation tests replace them)
    const isView = ArrayBuffer.isView, isArray = Array.isArray, TAG = Symbol.toStringTag;
    const tag = (a) => (a !== null && typeof a === 'object' && isView(a) ? a[TAG] : '');
    const isF64 = (a, n) => tag(a) === 'Float64Array' && a.length === n;
    const isF32 = (a, n) => tag(a) === 'Float32Array' && a.length === n;
    const isInt = (x, lo, hi) => typeof x === 'number' && x >= lo && x <= hi && Math.floor(x) === x;
    const fin = (x) => x - x === 0;                                  // finite number (NaN, ±Infinity → false)
    const finAll = (a, o, n) => { for (let i = 0; i < n; i++) if (!(a[o + i] - a[o + i] === 0)) return false; return true; };
    const pop = (m) => { let n = 0; for (let b = 0; b < 8; b++) if (m & (1 << b)) n++; return n; };
    const EMPTY = Object.freeze([]);
    // 129-point lane table at x ∈ [0, 1], linear interpolation
    function laneAt(T, off, x) {
      const p = (x > 0 ? (x < 1 ? x : 1) : 0) * (LANE_W - 1), i = Math.floor(p);
      if (i >= LANE_W - 1) return T[off + LANE_W - 1];
      return T[off + i] + (p - i) * (T[off + i + 1] - T[off + i]);
    }

    /* ------------------------------------------------------------ §7.4.1–7.4.2 note / pass orders (= seq-core arpOrder) */
    const K_UP = 0, K_DOWN = 1, K_UPDOWN = 2, K_DOWNUP = 3, K_UPANDDOWN = 4, K_DOWNANDUP = 5, K_CONV = 6, K_DIV = 7, K_CONVDIV = 8,
      K_THUMBUP = 9, K_THUMBUD = 10, K_PINKYUP = 11, K_PINKYUD = 12, K_CHORD = 13, K_RAND = 14, K_NODUP = 15, K_DRIFT = 16,
      K_ONCE = 17, K_PLAYED = 18, K_PATTERN = 19;
    // ARP_SHAPES / RANGE_SHAPES index → kind
    const ARP_KIND = Int8Array.from([K_PLAYED, K_PATTERN, K_CHORD, K_CONV, K_DIV, K_CONVDIV, K_DOWN, K_UP, K_UPDOWN, K_DOWNUP,
      K_UPANDDOWN, K_DOWNANDUP, K_THUMBUP, K_THUMBUD, K_RAND, K_ONCE, K_DRIFT, K_NODUP]);
    const RANGE_KIND = Int8Array.from([K_UP, K_DOWN, K_UPDOWN, K_DOWNUP, K_UPANDDOWN, K_DOWNANDUP, K_THUMBUP, K_THUMBUD, K_PINKYUP,
      K_PINKYUD, K_CONV, K_DIV, K_CONVDIV, K_CHORD, K_RAND, K_NODUP, K_DRIFT, K_ONCE]);
    const udLen = (M) => (M > 1 ? 2 * M - 2 : 1);
    const ud = (M, i) => (M <= 1 ? 0 : i < M ? i : 2 * M - 2 - i);
    const conv = (N, p) => ((p & 1) ? N - 1 - (p >> 1) : p >> 1);
    // length of one pass of kind k over N elements
    function seqLen(k, N) {
      if (N <= 1) return k === K_UPANDDOWN || k === K_DOWNANDUP ? 2 : 1;
      switch (k) {
        case K_UPDOWN: case K_DOWNUP: return 2 * N - 2;
        case K_UPANDDOWN: case K_DOWNANDUP: return 2 * N;
        case K_CONVDIV: return 2 * N - 1;
        case K_THUMBUP: case K_PINKYUP: return 2 * (N - 1);
        case K_THUMBUD: case K_PINKYUD: return 2 * udLen(N - 1);
        case K_CHORD: return 1;
        default: return N;
      }
    }
    // element index at position p of a pass of a deterministic kind
    function seqIdx(k, N, p) {
      if (N <= 1) return 0;
      switch (k) {
        case K_DOWN: return N - 1 - p;
        case K_UPDOWN: return p < N ? p : 2 * N - 2 - p;
        case K_DOWNUP: return p < N ? N - 1 - p : p - N + 1;
        case K_UPANDDOWN: return p < N ? p : 2 * N - 1 - p;
        case K_DOWNANDUP: return p < N ? N - 1 - p : p - N;
        case K_CONV: return conv(N, p);
        case K_DIV: return conv(N, N - 1 - p);
        case K_CONVDIV: return p < N ? conv(N, p) : conv(N, 2 * N - 2 - p);
        case K_THUMBUP: return p & 1 ? (p + 1) >> 1 : 0;
        case K_THUMBUD: return p & 1 ? 1 + ud(N - 1, p >> 1) : 0;
        case K_PINKYUP: return p & 1 ? p >> 1 : N - 1;
        case K_PINKYUD: return p & 1 ? ud(N - 1, p >> 1) : N - 1;
        default: return p;
      }
    }

    /* ------------------------------------------------------------ Seq (§7.7) */
    class Seq {
      constructor(proc) {
        this.proc = proc || null;
        this.ok = 0;                                   // a valid SQP has been applied
        this.active = 0;
        this.key = '';                                 // seq.key of the last SQP
        this.tKey = '';                                // seqT.key of the last table delivery
        this.kbd = new Float64Array(8);
        this.arpG = new Float64Array(8);
        this.clipG = new Float64Array(8);
        this.outIds = EMPTY;
        this.arp = new Float64Array(N_SLOTS * ARP_ROW);
        this.clip = new Float64Array(N_SLOTS * CLIP_ROW);
        // event / strum / lane / note pools: allocated by the first active apply (alloc), null until then
        this.arpEv = null; this.arpStrum = null; this.arpLane = null; this.clipNotes = null; this.clipLane = null;
        this.lazy = [];                                // valid parts received before the pools exist (arp 0…11, clip 0…11)
        this.cOff = new Int32Array(N_SLOTS);           // clip j's first note record in clipNotes
        this.cN = new Int32Array(N_SLOTS);
        this.cTotal = 0;
        this.arpKey = [];
        this.clipKey = [];
        this.pend = [];                                // clip parts waiting for room in the note pool
        for (let j = 0; j < N_SLOTS; j++) {
          this.arpKey.push(''); this.clipKey.push(''); this.pend.push(null); this.lazy.push(null, null);
          this.arp[j * ARP_ROW + 33] = j * MAX_EV; this.arp[j * ARP_ROW + 35] = j * MAX_STRUM; this.arp[j * ARP_ROW + 38] = j * ARP_LANES;
          this.arp[j * ARP_ROW + 28] = 16; this.arp[j * ARP_ROW + 30] = 4; this.arp[j * ARP_ROW + 22] = 1;
          this.clip[j * CLIP_ROW] = 64; this.clip[j * CLIP_ROW + 17] = j * CLIP_LANES;
        }
        // input records per (channel, note) — what the note-on did, so the note-off undoes exactly that
        this.rF = new Uint8Array(NCH * 128);           // R_* flags
        this.rP = new Int16Array(NCH * 128);           // note sent on (pass-through / THRU)
        this.rC = new Int8Array(NCH * 128);            // clip index (KB SPAN / trigger octave)
        this.rM = new Int8Array(NCH * 128);            // KB SPAN mode at note-on
        this.heldN = 0;
        // H: the notes held by the arpeggiator, arrival order
        this.hNote = new Int16Array(MAXH); this.hVel = new Float64Array(MAXH); this.hKey = new Int32Array(MAXH);
        this.hPhys = new Uint8Array(MAXH);             // 1 physically held · 0 latched · 2 clip-fed (released by the clip)
        this.hSer = new Int32Array(MAXH); this.hExt = new Uint8Array(MAXH); this.hN = 0; this.hSerial = 0; this.hDirty = 1;
        this.sU = new Int16Array(MAXH); this.sUi = new Int16Array(MAXH); this.sUN = 0;   // sorted unique view
        this.nU = new Int16Array(MAXH); this.nUi = new Int16Array(MAXH); this.nUN = 0;   // "new notes" view (STEP MODE)
        // pending note-offs of generated notes (frames): kind 0 final note, 1 clip note held by the arp (H serial),
        // 2 clip-tap forward only; tap = the clip-tap note forwarded at the note-on (−1 none); owner −1 arp, 0… clip player
        this.oF = new Float64Array(MAXOFF); this.oN = new Int16Array(MAXOFF); this.oK = new Uint8Array(MAXOFF);
        this.oS = new Int32Array(MAXOFF); this.oT = new Int16Array(MAXOFF); this.oP = new Int8Array(MAXOFF); this.nOff = 0;
        // pending note-ons (strum)
        this.qF = new Float64Array(MAXON); this.qO = new Float64Array(MAXON); this.qN = new Int16Array(MAXON);
        this.qV = new Float64Array(MAXON); this.qX = new Float64Array(MAXON); this.qE = new Uint8Array(MAXON); this.nOn = 0;
        // one step / event group under construction
        this.gN = new Int16Array(MAXG); this.gV = new Float64Array(MAXG); this.gX = new Float64Array(MAXG);
        this.gD = new Float64Array(MAXG); this.gE = new Uint8Array(MAXG); this.gC = 0; this.gT = 0;
        // clip players (a launched clip, or one KB SPAN Poly copy)
        this.pSt = new Uint8Array(MAXP);               // 0 free · 1 waiting for its start · 2 playing
        this.pRs = new Uint8Array(MAXP);               // playing, restart pending at pStartU
        this.pJ = new Int8Array(MAXP); this.pKey = new Int16Array(MAXP); this.pTr = new Float64Array(MAXP);
        this.pVel = new Float64Array(MAXP); this.pExt = new Uint8Array(MAXP); this.pSer = new Int32Array(MAXP);
        this.pStartU = new Float64Array(MAXP); this.pStopU = new Float64Array(MAXP).fill(INF); this.pPos0 = new Float64Array(MAXP);
        this.pUA = new Float64Array(MAXP); this.pCA = new Float64Array(MAXP); this.pRate = new Float64Array(MAXP).fill(1);
        this.pC0 = new Float64Array(MAXP); this.pQ = new Float64Array(MAXP); this.pDir = new Int8Array(MAXP); this.pS = new Float64Array(MAXP);
        this.pW = new Int32Array(MAXP); this.pS0 = new Int32Array(MAXP); this.pKA = new Int32Array(MAXP); this.pKB = new Int32Array(MAXP);
        this.pPh = new Uint8Array(MAXP); this.pSl = new Int32Array(MAXP); this.pLast = new Float64Array(MAXP); this.pRe = new Uint8Array(MAXP);
        this.pSerial = 0; this.reSeek = 0;
        this.tmpK = 0; this.tmpI = 0; this.tmpC = 0; this.tmpKind = -1;
        // KB SPAN held keys (Mono / Offset)
        this.kbH = new Int16Array(MAXKB); this.kbV = new Float64Array(MAXKB); this.kbN = 0;
        // arpeggiator
        this.arpCur = 0; this.aRun = 0; this.aStop = 0; this.aDom = 0; this.aD = 0.25; this.aU0 = 0; this.aF0 = 0; this.aE0 = 0;
        this.aNext = 0; this.aNK = 0;                  // next event elapsed (steps) and kind: 0 step / group, 1 segment end, 2 none, 3 static
        this.aPos = 0; this.aPass = 0; this.aCyc = 0; this.aRCur = -1; this.aNPrev = -1; this.aRPrev = -1; this.aShape = -1;
        this.permN = new Int16Array(MAXH); this.permNN = 0; this.permR = new Int16Array(8); this.permRN = 0;
        this.vRun = -1; this.aLastV = 100; this.evMark = 0; this.aPendJ = -1; this.aPendU = 0; this.aPendR = 0; this.aRR = 0;
        this.aHold = 0;                                // paused by a seek until the pending restart (aPendU)
        this.rowTr = 0; this.kick = 0;
        // pattern playhead segment
        this.gE0 = 0; this.gQ = 0; this.gDir = 1; this.gS = 16; this.gW = 0; this.gS0 = 0; this.gAcc = 0; this.gPh = 0; this.gLast = -1;
        this.gRe = 0; this.gMode = -1; this.gLen = 16; this.gTime = 16;
        // effective parameters (§7.3), read once per span
        this.parF = -1; this.arpOn = 0; this.clipOn = 0;
        this.pShift = 0; this.pRange = 1; this.pOffset = 0; this.pRepeats = 0; this.pGate = 0.75; this.pChance = 1; this.pRR = 4;
        this.pVdec = 0; this.pVtgt = 0.5; this.pTrans = 0; this.pWtr = 12; this.pWrg = 0; this.slotLatch = 0;
        this.oCT = 0; this.oCR = 0; this.oCO = 0;
        // timebase
        this.tbPlay = 0; this.tbFrame = 0; this.tbTick = 0; this.tbFpt = 1;
        this.fB0 = 0; this.fF0 = 0; this.fBpm = 120; this.fpb = 24000; this.base = 48000;
        this.tpSeek = 0; this.tpStop = 0; this.lastF = 0; this.syncF = -1;
        // lazily resolved engine references
        this.mod = null; this.cp = null; this.mac = null; this.reg = null; this.vlo = 1; this.vhi = 127;
        this.fwdP = new Array(4 * 128).fill(null);    // MIDI OUT: target that received the note-on, per (pane, tap, note)
        this.fwdSk0 = null; this.fwdSk1 = null;       // targets the Clip Player tap reached for the clip note being emitted
        this.rs = SEED;
        this.cqK = new Int8Array(MAXQ); this.cqA = new Int8Array(MAXQ); this.cqN = 0;
        this.pedal = 0; this.latch = 0; this.playing = 0; this.beat = 0;
        this.warned = 0;
      }

      warn(b, msg) {
        if (this.warned & b) return;
        this.warned |= b;
        if (typeof console !== 'undefined') console.warn(msg);
      }

      /* ---------------------------------------------------------- tables (§4.4) */
      apply(sqp, seqT) {
        const q = sqp;
        if (q === null || typeof q !== 'object' || typeof q.ver !== 'number' || Math.floor(q.ver) !== VER || !isF64(q.kbd, 8)
          || !isF64(q.arpG, 8) || !isF64(q.clipG, 8) || !isArray(q.outIds) || typeof q.key !== 'string') {
          if (this.ok) this.quiesce(this.lastF);       // nothing sounds on, no macro stays overridden
          this.ok = 0;
          this.active = 0;
          this.warn(1, 'sx-seq: invalid or incompatible sequencer patch (SQP ' + VER + ' expected); the sequencer is inert');
          return false;
        }
        const first = this.ok === 0, sel0 = this.arpG[3];
        this.kbd.set(q.kbd);
        this.arpG.set(q.arpG);
        this.clipG.set(q.clipG);
        this.outIds = q.outIds;
        this.active = q.active ? 1 : 0;
        this.key = q.key;
        this.ok = 1;
        if (this.active && this.arpEv === null) this.alloc();
        if (seqT !== undefined && seqT !== null) {
          const P = typeof seqT === 'object' ? seqT.parts : null;
          if (P === null || typeof P !== 'object') this.warn(2, 'sx-seq: malformed seqT ignored');
          else {
            for (const name in P) this.merge(P[name]);
            if (typeof seqT.key === 'string') this.tKey = seqT.key;
          }
        }
        // a UI selection never launches (§13.7: tap = select, play button = launch); it is the slot an idle arp plays next
        const sel = this.arpG[3] >= 0 && this.arpG[3] < N_SLOTS ? this.arpG[3] | 0 : 0;
        if (first || (this.arpG[3] !== sel0 && !this.aRun && this.aPendJ < 0)) this.arpCur = sel;
        this.parF = -1;
        this.resolve();
        if (!this.active) this.quiesce(this.lastF);   // the engine stops calling an inactive sequencer (§0.7, §14.1)
        return true;
      }

      // everything the sequencer generated stops now: pending note-offs fired, strums dropped, players and the arp stopped,
      // macro lanes released, queued commands dropped; held / latched input notes stay (their keys' note-offs still arrive)
      quiesce(F) {
        while (this.nOff > 0) { this.offFire(0, F); this.offRemove(0); }
        this.nOn = 0; this.cqN = 0; this.kick = 0;
        this.aRun = 0; this.aStop = 0; this.aPendJ = -1; this.aHold = 0;
        for (let p = 0; p < MAXP; p++) { this.pSt[p] = 0; this.pRs[p] = 0; this.pStopU[p] = INF; }
        this.arpOn = 0; this.clipOn = 0;               // re-read (and re-kicked) when the sequencer is active again
        const M = this.mac;
        if (M !== null) for (let k = 0; k < 8; k++) M[k] = NaN;
      }

      // the event / note / lane pools (first active apply), then the parts kept until now
      alloc() {
        this.arpEv = new Float64Array(N_SLOTS * MAX_EV * 5);
        this.arpStrum = new Float64Array(N_SLOTS * MAX_STRUM * 2);
        this.arpLane = new Float32Array(N_SLOTS * ARP_LANES * LANE_W);
        this.clipNotes = new Float64Array(MAX_NOTES * 8);
        this.clipLane = new Float32Array(N_SLOTS * CLIP_LANES * LANE_W);
        for (let k = 0; k < 2 * N_SLOTS; k++) {
          const p = this.lazy[k];
          if (p !== null) { this.lazy[k] = null; this.mergeOk(p, k < N_SLOTS ? 0 : 1); }
        }
      }

      merge(part) {
        const p = part;
        if (p === null || typeof p !== 'object' || !isInt(p.j, 0, N_SLOTS - 1)) return this.refuse();
        const k = p.kind === 'arp' ? 0 : p.kind === 'clip' ? 1 : -1;
        if (k < 0 || !(k === 0 ? this.validArp(p) : this.validClip(p))) return this.refuse();
        if (this.arpEv === null) { this.lazy[k * N_SLOTS + p.j] = p; return true; }
        return this.mergeOk(p, k);
      }
      mergeOk(p, k) {
        if (k === 0) { this.mergeArp(p, p.j); if (p.j === this.arpCur) this.gRe = 1; return true; }
        if (this.mergeClip(p, p.j) === 1) this.retry();
        return true;
      }

      refuse() { this.warn(4, 'sx-seq: malformed seqT part refused'); return false; }

      // shapes, and every value used as a divisor, loop bound or index (a compileSeq part always passes)
      validArp(p) {
        const row = p.row;
        if (!isF64(row, ARP_ROW) || !finAll(row, 0, ARP_ROW)) return false;
        const evN = row[34], stN = row[36], mask = row[37], len = row[28], E = p.ev, S = p.strum;
        if (!isInt(evN, 0, MAX_EV) || !isInt(stN, 0, MAX_STRUM) || !isInt(mask, 0, 15) || !isF64(E, 5 * evN) || !isF64(S, 2 * stN)
          || !isF32(p.lane, LANE_W * pop(mask))) return false;
        if (!isInt(row[0], 0, 17) || !isInt(row[18], 0, 17) || !isInt(len, 1, MAX_PAT_LEN) || !isInt(row[29], 0, 7)
          || !(row[30] > 0 && row[30] <= 16) || !isInt(row[31], 0, 3) || !isInt(row[32], 0, 2)) return false;
        let t0 = 0;
        for (let i = 0; i < evN; i++) {                // [t16, len16, row, vel, accent], sorted by t16, inside the pattern
          const t = E[5 * i], r = E[5 * i + 2];
          if (!(t >= t0 && t < len) || !(E[5 * i + 1] > 0) || !finAll(E, 5 * i, 5) || !isInt(r, -32, 32) || r === 0) return false;
          t0 = t;
        }
        for (let i = 0; i < stN; i++) if (!(S[2 * i] >= 0 && S[2 * i] < len) || !fin(S[2 * i + 1])) return false;
        return finAll(p.lane, 0, p.lane.length);
      }
      validClip(p) {
        const row = p.row;
        if (!isF64(row, CLIP_ROW) || !finAll(row, 0, CLIP_ROW)) return false;
        const n = row[15], mask = row[16], len = row[0], st = row[1], N = p.notes;
        if (!isInt(n, 0, MAX_CLIP_NOTES) || !isInt(mask, 0, 255) || !isF64(N, 8 * n) || !isF32(p.lane, LANE_W * pop(mask))) return false;
        if (!isInt(len, 1, MAX_CLIP_LEN) || !isInt(st, 0, len - 1) || !(row[2] >= st && row[2] < len) || !(row[3] >= 0)
          || !isInt(row[4], 0, 3) || !isInt(row[5], 0, 8) || !(row[6] > 0 && row[6] <= 16) || !(row[7] >= 0 && row[7] <= 16)) return false;
        let t0 = 0;
        for (let i = 0; i < n; i++) {                  // [t16, len16, note, vel, mute, x, y, z], sorted by t16
          const t = N[8 * i];
          if (!(t >= t0) || !(N[8 * i + 1] > 0) || !finAll(N, 8 * i, 8)) return false;
          t0 = t;
        }
        return finAll(p.lane, 0, p.lane.length);
      }

      mergeArp(p, j) {
        const row = p.row;
        const o = j * ARP_ROW, A = this.arp, L = this.arpLane, src = p.lane, mask = row[37];
        A.set(row, o);
        A[o + 33] = j * MAX_EV; A[o + 35] = j * MAX_STRUM; A[o + 38] = j * ARP_LANES;
        this.arpEv.set(p.ev, j * MAX_EV * 5);
        this.arpStrum.set(p.strum, j * MAX_STRUM * 2);
        let s = 0;
        for (let b = 0; b < ARP_LANES; b++) {
          if (!(mask & (1 << b))) continue;
          const d = (j * ARP_LANES + b) * LANE_W;
          for (let i = 0; i < LANE_W; i++) L[d + i] = src[s + i];
          s += LANE_W;
        }
        this.arpKey[j] = typeof p.key === 'string' ? p.key : '';
        this.parF = -1;
        return true;
      }

      // a validated part: 1 merged, 2 pending (no room in the note pool yet)
      mergeClip(p, j) {
        const row = p.row, n = row[15], mask = row[16];
        const old = this.cN[j], total = this.cTotal - old + n;
        if (total > MAX_NOTES) { this.pend[j] = p; return 2; }
        const off = this.cOff[j], C = this.clip, L = this.clipLane, src = p.lane, o = j * CLIP_ROW;
        // a new region / mode / slice TIME of a playing clip: its playhead continues from its position in the new region
        const geo = C[o] !== row[0] || C[o + 1] !== row[1] || C[o + 5] !== row[5] || C[o + 6] !== row[6] ? 2 : 1;
        if (n !== old) {
          const end = this.cTotal;
          if (end > off + old) this.clipNotes.copyWithin((off + n) * 8, (off + old) * 8, end * 8);
          for (let k = j + 1; k < N_SLOTS; k++) { this.cOff[k] += n - old; C[k * CLIP_ROW + 14] = this.cOff[k]; }
        }
        this.clipNotes.set(p.notes, off * 8);
        this.cN[j] = n;
        this.cTotal = total;
        C.set(row, j * CLIP_ROW);
        C[j * CLIP_ROW + 14] = off; C[j * CLIP_ROW + 17] = j * CLIP_LANES;
        let s = 0;
        for (let b = 0; b < CLIP_LANES; b++) {
          if (!(mask & (1 << b))) continue;
          const d = (j * CLIP_LANES + b) * LANE_W;
          for (let i = 0; i < LANE_W; i++) L[d + i] = src[s + i];
          s += LANE_W;
        }
        this.pend[j] = null;
        this.clipKey[j] = typeof p.key === 'string' ? p.key : '';
        for (let k = 0; k < MAXP; k++) if (this.pSt[k] !== 0 && this.pJ[k] === j && this.pRe[k] < geo) { this.pRe[k] = geo; this.reSeek = 1; }
        this.parF = -1;
        return 1;
      }

      retry() {
        for (let again = true; again;) {
          again = false;
          for (let k = 0; k < N_SLOTS; k++) { const q = this.pend[k]; if (q !== null && this.mergeClip(q, k) === 1) again = true; }
        }
      }

      /* ---------------------------------------------------------- engine references, timebase (§7.2) */
      resolve() {
        const P = this.proc;
        if (P === null || typeof P !== 'object') return;
        const sx = P.sx, m = sx !== null && typeof sx === 'object' ? sx.mod : null;
        this.mod = m !== null && typeof m === 'object' && m.monoOff && m.monoEff && m.monoEff.length > VI_CLIP_OFF ? m : null;
        const pp = P.p, cp = pp !== null && typeof pp === 'object' ? pp.serum : null;
        this.cp = cp !== null && typeof cp === 'object' && cp.base && cp.base.length > VI_CLIP_OFF ? cp : null;
        if (cp && cp.mapVLo && cp.mapVHi && cp.mapVLo.length > 5) { this.vlo = cp.mapVLo[5]; this.vhi = cp.mapVHi[5]; }
        else { this.vlo = 1; this.vhi = 127; }
        const sm = P.seqMacro;
        this.mac = sm && typeof sm === 'object' && sm.length >= 8 ? sm : null;
        const b = P.base > 0 ? +P.base : 48000;
        if (b !== this.base) { this.base = b; this.fpb = 60 * b / this.fBpm; }
        const r = P.procs;                             // the engine's PROCS registry (no global fallback: see the header)
        this.reg = r !== null && typeof r === 'object' && typeof r.get === 'function' ? r : null;
      }
      beatAt(F) {
        if (this.tbPlay) return (this.tbTick + (F - this.tbFrame) / this.tbFpt) / 960;
        return this.fB0 + (F - this.fF0) / this.fpb;
      }
      frameAtBeat(b) {
        if (this.tbPlay) return this.tbFrame + (b * 960 - this.tbTick) * this.tbFpt;
        return this.fF0 + (b - this.fB0) * this.fpb;
      }
      uAt(F) { return swingInv(this.beatAt(F), this.kbd[3], this.kbd[4]); }
      frameAtU(u) { return this.frameAtBeat(swingTime(u, this.kbd[3], this.kbd[4])); }

      // once per span: references, transport / tempo / position changes, parameters, queued commands, macro lanes
      sync(F) {
        this.lastF = F;
        if (F === this.syncF && this.parF === F && this.cqN === 0 && this.tpSeek === 0 && this.tpStop === 0) return;
        this.syncF = F;
        this.resolve();
        this.syncTime(F);
        this.readParams(F);
        if (this.reSeek) { this.reSeek = 0; for (let p = 0; p < MAXP; p++) if (this.pRe[p] === 2) this.pRegeo(p, F); else if (this.pRe[p] === 1) this.pReseek(p, F); }
        if (this.cqN) this.runCmds(F);
        if (this.kick) { this.kick = 0; this.arpKick(F); }
        this.macros(F);
      }
      syncTime(F) {
        const P = this.proc, tp = P !== null ? P.tp : null;
        const play = tp !== null && typeof tp === 'object' && tp.play ? 1 : 0;
        if (play) {
          const fr = +tp.frame, tk = +tp.tick, fpt = +tp.fpt > 0 ? +tp.fpt : 1;
          if (!this.tbPlay) { const uP = this.uAt(F); this.tbPlay = 1; this.tbFrame = fr; this.tbTick = tk; this.tbFpt = fpt; this.onSeek(F, uP); }
          else if (fr !== this.tbFrame || tk !== this.tbTick || fpt !== this.tbFpt) {
            const uP = this.uAt(F), bOld = (this.tbTick + (fr - this.tbFrame) / this.tbFpt) / 960;
            this.tbFrame = fr; this.tbTick = tk; this.tbFpt = fpt;
            if (this.tpSeek) this.onSeek(F, uP);
            else { const d = tk / 960 - bOld; if (d > 1e-6 || d < -1e-6) this.onJump(d, F); }
          } else if (this.tpSeek) this.onSeek(F, this.uAt(F));
        } else {
          if (this.tbPlay) { const b = this.beatAt(F); this.tbPlay = 0; this.fB0 = b; this.fF0 = F; this.onStop(F); }
          else if (this.tpStop) this.onStop(F);
          const bpm = P !== null && P.bpm > 0 ? +P.bpm : 120;
          if (bpm !== this.fBpm) { this.fB0 = this.beatAt(F); this.fF0 = F; this.fBpm = bpm; this.fpb = 60 * this.base / bpm; }
          if (this.tpSeek) this.onSeek(F, this.uAt(F));
        }
        this.tpSeek = 0; this.tpStop = 0;
      }
      // the position an event handled at F is quantised / placed from: up to one span granule earlier — the engine runs
      // whatever falls due inside the last granule at the span start F (song notes, transport messages, loop wraps), so a
      // grid point (or a transport anchor) in (F − GRAN, F] counts as now —, but never before the timebase's anchor
      uEv(F) {
        const Fa = this.tbPlay ? this.tbFrame : this.fF0, Fe = F - GRAN;
        return this.uAt(Fe > Fa ? Fe : Fa < F ? Fa : F);
      }
      // the next boundary of grid q (beats; 0 = Off: now) for an event at F
      qNext(F, q) { return q > 0 ? nextQ(this.uEv(F), q) : this.uAt(F); }
      // §7.8 play with seek; uP = the position at F before the seek (the timebase it replaced)
      onSeek(F, uP) {
        this.rs = SEED;
        const u = this.uAt(F), ue = this.uEv(F);     // ue: the transport anchor's position when it lies in the last granule
        if (this.aRun) {
          // restart at the next LAUNCH QUANT boundary (Off: the next step of the RATE grid; Hz: at once); the old schedule
          // is paused until then (no step of the skipped span is replayed, whatever is edited meanwhile)
          const qb = this.arpG[0], uB = qb > 0 ? nextQ(ue, qb) : this.aDom === 0 ? nextQ(ue, this.aD) : u;
          const j = this.aPendJ >= 0 ? this.aPendJ : this.arpCur;
          if (uB > u + 1e-9) { this.aPendJ = j; this.aPendU = uB; this.aPendR = 1; this.aNK = 2; this.aHold = 1; }
          else { this.aPendJ = -1; this.arpApply(j, 1, F, uB); }
        } else {
          // an arp between runs starts its next run fresh (as the PRNG: the song renders the same live and offline); a stop
          // (REPEATS / One Shot / the stop button) is kept, its RATE retrigger moves onto the new grid
          const st = this.aStop;
          this.arpRestart();
          this.aStop = st; this.vRun = -1;
          if (this.aPendJ >= 0) this.aPendU = this.qNext(F, this.arpG[0]);
          this.aRR = nextQ(ue, this.pRR);
        }
        const C = this.clip;
        for (let p = 0; p < MAXP; p++) {
          if (this.pSt[p] === 0) continue;
          const o = this.pJ[p] * CLIP_ROW;
          if (this.pStopU[p] < INF) { this.pStop(p, F); continue; }
          if (this.pSt[p] === 2 && C[o + 8] < 0.5) { this.pStartU[p] = ue; this.pPos0[p] = NaN; this.pStart(p, F); continue; }
          this.pStartU[p] = this.qNext(F, C[o + 7]);
          if (this.pSt[p] === 2) {                     // RETRIG on: paused at its playhead until the restart
            if (this.pRs[p] !== 2) this.pCA[p] += (uP - this.pUA[p]) * 4 * this.pRate[p];
            this.pUA[p] = u; this.pRs[p] = 2;
          }
          if (this.pStartU[p] <= u + 1e-9) this.pStart(p, F);
        }
      }
      // the song position jumped without a seek (loop wrap): beat-anchored schedules move with it, except a playing clip
      // with RETRIG off, whose playhead is a function of the song beat (§7.5.2): it resyncs to the new position
      onJump(d, F) {
        this.aU0 += d; this.aPendU += d; this.aRR += d;
        const C = this.clip;
        let u = NaN;
        for (let p = 0; p < MAXP; p++) {
          if (this.pSt[p] === 0) continue;
          this.pUA[p] += d; this.pStartU[p] += d;
          if (this.pStopU[p] < INF) this.pStopU[p] += d;
          if (this.pSt[p] === 2 && !this.pRs[p] && C[this.pJ[p] * CLIP_ROW + 8] < 0.5 && (C[this.pJ[p] * CLIP_ROW + 5] | 0) !== 8) {
            if (u !== u) u = this.uEv(F);              // the loop start when the wrap frame lies in the last granule
            this.pStartU[p] = u; this.pPos0[p] = NaN; this.pStart(p, F);
          }
        }
      }
      // transport stop: the generated notes are released (§7.8); arps and clips go on with the free clock
      onStop(F) {
        while (this.nOff > 0) { this.offFire(0, F); this.offRemove(0); }
        this.nOn = 0;
      }
      busy() {
        if (this.hN > 0 || this.nOff > 0 || this.nOn > 0 || this.aPendJ >= 0) return true;
        for (let p = 0; p < MAXP; p++) if (this.pSt[p] !== 0) return true;
        return false;
      }
      // idle → busy on the free clock: the clock restarts at beat 0 (patterns start on their grid at the first press), and
      // the phrase starts from a fresh state (PRNG, arp positions / passes / repeats / random orders, velocity run), so it
      // equals what a new processor renders from the same input (render-last, §12.6)
      wake(F) {
        if (this.tbPlay || this.busy()) return;
        this.fB0 = 0; this.fF0 = F;
        this.rs = SEED;
        this.arpRestart();
        this.vRun = -1;
      }

      rnd01() { let x = this.rs; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; this.rs = x; return x / 4294967296; }
      draw(n) { return Math.floor(this.rnd01() * n); }

      /* ---------------------------------------------------------- §7.3 parameters */
      offOf(vi) { const m = this.mod; return m !== null ? m.monoOff[vi] : 0; }
      effOn(vi) {
        const m = this.mod;
        if (m !== null) return m.monoEff[vi] >= 0.5 ? 1 : 0;
        const c = this.cp;
        return c !== null && c.base[vi] >= 0.5 ? 1 : 0;
      }
      readParams(F) {
        if (F === this.parF) return;
        this.parF = F;
        const A = this.arp, o = this.arpCur * ARP_ROW;
        // switches: turning a module off releases its generated notes at once (both stay off before the pools exist)
        const big = this.arpEv !== null, aOn = big ? this.effOn(VI_ARP_ON) : 0, cOn = big ? this.effOn(VI_CLIP_ON) : 0;
        if (aOn !== this.arpOn) {
          this.arpOn = aOn;
          if (!aOn) { this.releaseOwner(-1, F); this.aRun = 0; this.aPendJ = -1; this.aHold = 0; } else if (this.hN > 0) this.kick = 1;
        }
        if (cOn !== this.clipOn) {
          this.clipOn = cOn;
          if (!cOn) for (let p = 0; p < MAXP; p++) if (this.pSt[p] !== 0) this.pStop(p, F);
        }
        // RATE → step duration (beats in BPM mode, seconds in Hz mode)
        const L = ARP_LAD[(A[o + 3] >= 0.5 ? 1 : 0) + (A[o + 2] >= 0.5 ? 2 : 0)], oRate = this.offOf(VI_ARP_RATE);
        let D, dom;
        if (A[o + 1] >= 0.5) { D = L[Math.round(clamp01(A[o + 4] + oRate) * (L.length - 1))]; dom = 0; }
        else { D = 2 / Math.pow(100, clamp01(A[o + 5] + oRate)); dom = 1; }
        if (!(D > 0)) { D = 0.25; dom = 0; }
        if (D !== this.aD || dom !== this.aDom) {
          if (this.aRun) {
            // BPM: the step count goes on from the next step, which lands on the new RATE's grid (the arp stays on the song /
            // free-clock grid); Hz: phase-continuous
            const e = this.aEAt(F);
            this.aD = D; this.aDom = dom;
            if (dom === 0) { this.aE0 = Math.ceil(e - 1e-9); this.aU0 = nextQ(this.uAt(F), D); } else { this.aE0 = e; this.aF0 = F; }
          } else { this.aD = D; this.aDom = dom; }
        }
        // the int / enum / lin laws of §3.11.2 (laws.js lawValue)
        this.pShift = Math.round(-24 + 48 * this.nArp(o, 6));
        this.pRange = Math.round(1 + 7 * this.nArp(o, 7));
        this.pOffset = Math.round(15 * this.nArp(o, 8));
        this.pRepeats = Math.round(16 * this.nArp(o, 9));
        this.pGate = 2 * this.nArp(o, 10);
        this.pChance = this.nArp(o, 11);
        this.pRR = RRATE_BEATS[Math.round(5 * this.nArp(o, 12))];
        this.pVdec = -1 + 2 * this.nArp(o, 13);
        this.pVtgt = this.nArp(o, 14);
        this.pTrans = Math.round(-24 + 48 * this.nArp(o, 15));
        this.pWtr = Math.round(24 * this.nArp(o, 16));
        this.pWrg = Math.round(8 * this.nArp(o, 17));
        // LATCH: the slot button or the sustain pedal (§7.4.5)
        const sl = A[o + 19] >= 0.5 ? 1 : 0, was = this.latch;
        this.slotLatch = sl;
        this.latch = sl || this.pedal ? 1 : 0;
        if (was && !this.latch) this.hDropLatched();
        // clip virtual destinations (offsets; the bases are per clip)
        this.oCT = this.offOf(VI_CLIP_TRANS); this.oCR = this.offOf(VI_CLIP_RATE); this.oCO = this.offOf(VI_CLIP_OFF);
        let u = NaN;
        for (let p = 0; p < MAXP; p++) {
          if (this.pSt[p] !== 2) continue;
          const r = this.clipRate(this.pJ[p]);
          if (r !== this.pRate[p]) {
            if (u !== u) u = this.uAt(F);
            if (this.pRs[p] !== 2) this.pCA[p] += (u - this.pUA[p]) * 4 * this.pRate[p];   // a paused playhead stays
            this.pUA[p] = u; this.pRate[p] = r;
          }
        }
      }
      // eff n of the arp row's virtual-destination base k (row 6…17 ↔ vi 408…419)
      nArp(o, k) { return clamp01(this.arp[o + k] + this.offOf(402 + k)); }
      clipRate(j) { return CLIP_RATE_MUL[Math.round(10 * clamp01(this.clip[j * CLIP_ROW + 12] + this.oCR))]; }
      clipTrans(j) { return Math.round(-24 + 48 * clamp01(this.clip[j * CLIP_ROW + 11] + this.oCT)); }

      /* ---------------------------------------------------------- output stage, MIDI OUT (§7.1, §7.9) */
      out(on, n, vel, ch, x, y, z, gen, ext, F) {
        const P = this.proc;
        if (P !== null && typeof P.sxNote === 'function') P.sxNote(on, n, vel, ch, x, y, z, gen);
        this.fwd(2, on, n, vel, ext, F);
      }
      // tap 1 = Clip Player (clip output before the arp), 2 = On (final output); panes 0 arp, 1 clip
      fwd(tap, on, n, vel, ext, F) {
        const reg = this.reg;
        if (reg === null) return;
        let sent = null;
        for (let pane = 0; pane < 2; pane++) {
          const slot = (pane * 2 + tap - 1) * 128 + n;
          if (on) {
            const G = pane ? this.clipG : this.arpG;
            if (ext || G[1] !== tap || !(G[6] >= 0)) continue;
            const id = this.outIds[G[6]];
            if (typeof id !== 'string' || !id) continue;
            const T = reg.get(id);
            // never its own track (the registry holds the engine's Track, proc is its Inst: proc.T)
            if (!T || T === this.proc || T === this.proc.T || typeof T.extNote !== 'function' || T === sent) continue;
            if (tap === 2 && (T === this.fwdSk0 || T === this.fwdSk1)) continue;   // this clip note reached T by the Clip Player tap
            const old = this.fwdP[slot];
            if (old !== null && old !== T) old.extNote(F + EXT_DELAY, 0, n, 0);
            T.extNote(F + EXT_DELAY, 1, n, vel);
            this.fwdP[slot] = T;
            sent = T;
            if (tap === 1) { if (pane) this.fwdSk1 = T; else this.fwdSk0 = T; }
          } else {
            const T = this.fwdP[slot];
            if (T !== null) { T.extNote(F + EXT_DELAY, 0, n, 0); this.fwdP[slot] = null; }
          }
        }
      }
      // a generated note already sounding at pitch n is cut first (§7.4.4 "a repeated pitch retriggers")
      genRetrig(n, F) {
        for (let i = 0; i < this.nOff; i++) if (this.oK[i] === 0 && this.oN[i] === n) { this.offFire(i, F); this.offRemove(i); return; }
      }
      genOn(n, v, x, y, z, owner, offF, tap, ext, F) {
        if (n < 0 || n > 127) { if (tap >= 0) this.offAdd(offF, 2, tap, 0, tap, owner); return; }
        const vel = v >= 127 ? 1 : v > 1 ? v / 127 : 1 / 127;
        this.out(1, n, vel, 0, x, y, z, 1, ext, F);
        this.offAdd(offF, 0, n, 0, tap, owner);
      }
      offAdd(f, kind, n, ser, tap, owner) {
        if (this.nOff >= MAXOFF) {                      // full: the earliest note-off happens now
          let m = 0;
          for (let i = 1; i < this.nOff; i++) if (this.oF[i] < this.oF[m]) m = i;
          this.offFire(m, this.lastF); this.offRemove(m);
        }
        const i = this.nOff++;
        this.oF[i] = f; this.oK[i] = kind; this.oN[i] = n; this.oS[i] = ser; this.oT[i] = tap; this.oP[i] = owner;
      }
      offRemove(i) {
        const k = this.nOff - 1;
        if (i < k) {
          this.oF.copyWithin(i, i + 1, k + 1); this.oK.copyWithin(i, i + 1, k + 1); this.oN.copyWithin(i, i + 1, k + 1);
          this.oS.copyWithin(i, i + 1, k + 1); this.oT.copyWithin(i, i + 1, k + 1); this.oP.copyWithin(i, i + 1, k + 1);
        }
        this.nOff = k;
      }
      offFire(i, F) {
        const k = this.oK[i], t = this.oT[i];
        if (k === 0) this.out(0, this.oN[i], 0, 0, 0, 0, 0, 1, 0, F);
        else if (k === 1) this.hRelSer(this.oS[i]);
        if (t >= 0) this.fwd(1, 0, t, 0, 0, F);
      }
      fireOffs(F) {
        for (let i = 0; i < this.nOff;) {
          if (this.oF[i] < F + 0.5) { this.offFire(i, F); this.offRemove(i); } else i++;
        }
      }
      // every note of one owner released now, its pending strums dropped
      releaseOwner(owner, F) {
        for (let i = 0; i < this.nOff;) {
          if (this.oP[i] === owner) { this.offFire(i, F); this.offRemove(i); } else i++;
        }
        if (owner === -1) this.nOn = 0;
      }
      onAdd(f, off, n, v, x, ext) {
        if (this.nOn >= MAXON) return;
        const i = this.nOn++;
        this.qF[i] = f; this.qO[i] = off; this.qN[i] = n; this.qV[i] = v; this.qX[i] = x; this.qE[i] = ext;
      }
      fireOns(F) {
        for (let i = 0; i < this.nOn;) {
          if (this.qF[i] < F + 0.5) {
            const n = this.qN[i], v = this.qV[i], x = this.qX[i], e = this.qE[i], off = this.qO[i];
            const k = this.nOn - 1;
            if (i < k) {
              this.qF.copyWithin(i, i + 1, k + 1); this.qO.copyWithin(i, i + 1, k + 1); this.qN.copyWithin(i, i + 1, k + 1);
              this.qV.copyWithin(i, i + 1, k + 1); this.qX.copyWithin(i, i + 1, k + 1); this.qE.copyWithin(i, i + 1, k + 1);
            }
            this.nOn = k;
            this.genRetrig(n, F);
            this.genOn(n, v, x, 0.5, 0, -1, off, -1, e, F);
          } else i++;
        }
      }

      /* ---------------------------------------------------------- input chain (§7.1) */
      input(on, n, vel, ch, F, ext) {
        const c = ch >= 0 && ch < NCH ? ch | 0 : 0, n0 = Math.round(n);
        if (!(n0 >= 0 && n0 <= 127)) return;
        const key = c * 128 + n0, f = this.rF[key], Fr = typeof F === 'number' && F === F ? F : this.lastF, e = ext ? 1 : 0;
        if (!this.ok) {                                // inert: notes pass unchanged
          if (!on) { if (f & R_REC) this.releaseKey(key, vel, c, Fr); else this.out(0, n0, vel, c, 0, 0, 0, 0, e, Fr); return; }
          if (f & R_REC) this.releaseKey(key, 0, c, Fr);
          this.rF[key] = R_REC | R_PASS; this.rP[key] = n0; this.heldN++;
          this.out(1, n0, vel, c, 0, 0, 0, 0, e, Fr);
          return;
        }
        this.sync(Fr);
        if (!on) {
          if (f & R_REC) this.releaseKey(key, vel, c, Fr);
          else this.out(0, n0, vel, c, 0, 0, 0, 0, e, Fr);    // started before the sequencer
          return;
        }
        if (f & R_REC) this.releaseKey(key, 0, c, Fr);
        this.wake(Fr);
        const v127 = vel * 127;
        // trigger octaves (raw note; only for a module that is on): launch, consumed
        let flags = R_REC;
        const ta = this.arpG[2], tc = this.clipG[2];
        if (this.arpOn && ta >= 1 && n0 >= 12 * (ta - 1) && n0 <= 12 * (ta - 1) + 11) { this.arpLaunch(n0 - 12 * (ta - 1), Fr); flags |= R_TRIGA; }
        if (this.clipOn && tc >= 1 && n0 >= 12 * (tc - 1) && n0 <= 12 * (tc - 1) + 11) {
          const j = n0 - 12 * (tc - 1);
          this.clipToggle(j, n0, vel, e, Fr);
          this.rC[key] = j;
          flags |= R_TRIGC;
        }
        if (flags !== R_REC) { this.rF[key] = flags; this.heldN++; return; }
        // KEYBOARD TRANSPOSE, KEY / SCALE
        let m = n0 + this.kbd[0];
        if (this.kbd[1] >= 0) m = quantize(m, this.kbd[1], this.kbd[2]);
        if (m < 0 || m > 127) { this.rF[key] = R_REC | R_DROP; return; }
        this.heldN++;
        // clip player: KB SPAN consumes the note
        if (this.clipOn) {
          const j = this.clipG[3] >= 0 && this.clipG[3] < N_SLOTS ? this.clipG[3] | 0 : 0, kb = this.clip[j * CLIP_ROW + 4];
          if (kb >= 1) {
            this.rF[key] = R_REC | R_KB; this.rC[key] = j; this.rM[key] = kb;
            this.kbOn(j, kb, n0, vel, e, Fr);
            return;
          }
        }
        // arpeggiator: held (and passed on as well with THRU)
        if (this.arpOn) {
          const a = this.arpAccept(m, v127);
          if (a >= 0) {
            this.hInsert(a, v127, key, 1, e, Fr);
            if (this.arp[this.arpCur * ARP_ROW + 20] >= 0.5) {
              this.rF[key] = R_REC | R_ARP | R_PASS; this.rP[key] = m;
              this.out(1, m, vel, c, 0, 0, 0, 0, e, Fr);
            } else this.rF[key] = R_REC | R_ARP;
            return;
          }
        }
        this.rF[key] = R_REC | R_PASS; this.rP[key] = m;
        this.out(1, m, vel, c, 0, 0, 0, 0, e, Fr);
      }
      releaseKey(key, vel, c, F) {
        const f = this.rF[key];
        this.rF[key] = 0;
        if (f & R_DROP) return;
        this.heldN--;
        if (f & R_PASS) this.out(0, this.rP[key], vel, c, 0, 0, 0, 0, 0, F);
        if (f & R_ARP) this.hRelKey(key);
        if (f & R_KB) this.kbOff(this.rC[key], this.rM[key], key & 127, F);
        if (f & R_TRIGC) this.clipTrigOff(this.rC[key], key & 127, F);
      }
      // the ARP row of OSC MAPPING (key range, FOLD, velocity range) → the note the arp holds, or −1 (passes)
      arpAccept(m, v127) {
        const v = Math.round(v127), lo = this.kbd[5], hi = this.kbd[6];
        if (v < this.vlo || v > this.vhi) return -1;
        if (m >= lo && m <= hi) return m;
        if (this.kbd[7] < 0.5) return -1;
        if (m < lo) { const x = m + 12 * Math.ceil((lo - m) / 12); return x <= hi ? x : lo; }
        const x = m - 12 * Math.ceil((m - hi) / 12);
        return x >= lo ? x : hi;
      }

      /* ---------------------------------------------------------- H, latch (§7.4.5) */
      hInsert(note, v127, key, phys, ext, F) {
        if (phys === 1 && this.latch) {                // a key pressed while none is physically down replaces the set
          let down = 0;
          for (let i = 0; i < this.hN; i++) if (this.hPhys[i] === 1) { down = 1; break; }
          if (!down) this.hDropLatched();
        }
        const wasEmpty = this.hN === 0;
        if (this.hN >= MAXH) this.hDel(0);
        const i = this.hN++, ser = ++this.hSerial;
        this.hNote[i] = note; this.hVel[i] = v127; this.hKey[i] = key; this.hPhys[i] = phys; this.hSer[i] = ser; this.hExt[i] = ext;
        this.hDirty = 1;
        this.aLastV = v127;
        if (!this.arpOn) return ser;
        const A = this.arp, o = this.arpCur * ARP_ROW;
        if (A[o + 24] >= 0.5 || (A[o + 25] >= 0.5 && wasEmpty) || (wasEmpty && this.aStop)) this.arpRetrig(F);
        if (A[o + 26] >= 0.5 && this.vRun < 0) this.vRun = v127;
        if (!this.aRun) this.arpKick(F);
        return ser;
      }
      hDel(i) {
        const k = this.hN - 1;
        for (let j = i; j < k; j++) {
          this.hNote[j] = this.hNote[j + 1]; this.hVel[j] = this.hVel[j + 1]; this.hKey[j] = this.hKey[j + 1];
          this.hPhys[j] = this.hPhys[j + 1]; this.hSer[j] = this.hSer[j + 1]; this.hExt[j] = this.hExt[j + 1];
        }
        this.hN = k;
        this.hDirty = 1;
        if (k === 0) this.aRun = 0;
      }
      hRelKey(key) {
        for (let i = 0; i < this.hN; i++) {
          if (this.hKey[i] === key && this.hPhys[i] === 1) { if (this.latch) this.hPhys[i] = 0; else this.hDel(i); return; }
        }
      }
      hRelSer(ser) { for (let i = 0; i < this.hN; i++) if (this.hSer[i] === ser) { this.hDel(i); return; } }
      hDropLatched() { for (let i = this.hN - 1; i >= 0; i--) if (this.hPhys[i] === 0) this.hDel(i); }
      // sorted unique notes of H (sU, ascending; sUi = the most recent entry of each note)
      hSort() {
        let n = 0;
        for (let i = 0; i < this.hN; i++) {
          const x = this.hNote[i];
          let j = 0;
          while (j < n && this.sU[j] < x) j++;
          if (j < n && this.sU[j] === x) { this.sUi[j] = i; continue; }
          for (let k = n; k > j; k--) { this.sU[k] = this.sU[k - 1]; this.sUi[k] = this.sUi[k - 1]; }
          this.sU[j] = x; this.sUi[j] = i; n++;
        }
        this.sUN = n;
        this.hDirty = 0;
      }
      // the notes that arrived since the previous pattern event
      hNewSort() {
        let n = 0;
        for (let i = 0; i < this.hN; i++) {
          if (this.hSer[i] <= this.evMark) continue;
          const x = this.hNote[i];
          let j = 0;
          while (j < n && this.nU[j] < x) j++;
          if (j < n && this.nU[j] === x) { this.nUi[j] = i; continue; }
          for (let k = n; k > j; k--) { this.nU[k] = this.nU[k - 1]; this.nUi[k] = this.nUi[k - 1]; }
          this.nU[j] = x; this.nUi[j] = i; n++;
        }
        this.nUN = n;
      }

      /* ---------------------------------------------------------- arpeggiator (§7.4) */
      aFrame(e) { return this.aDom === 0 ? this.frameAtU(this.aU0 + (e - this.aE0) * this.aD) : this.aF0 + (e - this.aE0) * this.aD * this.base; }
      aEAt(F) { return this.aDom === 0 ? this.aE0 + (this.uAt(F) - this.aU0) / this.aD : this.aE0 + (F - this.aF0) / (this.aD * this.base); }
      aUOf(e) { return this.aDom === 0 ? this.aU0 + (e - this.aE0) * this.aD : this.uAt(this.aFrame(e)); }
      isPat() { return ARP_KIND[this.arp[this.arpCur * ARP_ROW] | 0] === K_PATTERN; }
      // a run starts (H non-empty): the next grid point of the RATE (Hz: at once)
      arpKick(F) {
        if (this.aRun || !this.arpOn || this.hN === 0) return;
        if (this.aPendJ >= 0) {
          const j = this.aPendJ;
          this.aPendJ = -1;
          this.arpCur = j; this.parF = -1; this.readParams(F); this.aStop = 0;
          if (this.aPendR) this.arpRestart();
        }
        if (this.aStop) return;
        this.aRun = 1; this.aHold = 0;
        this.aShape = this.arp[this.arpCur * ARP_ROW];
        let uS = this.uAt(F);
        if (this.aDom === 0) { uS = this.qNext(F, this.aD); this.aU0 = uS; } else this.aF0 = F;
        this.aE0 = 0;
        this.aRR = (Math.floor(uS / this.pRR + 1e-9) + 1) * this.pRR;
        if (this.isPat()) { this.arpRestart(); this.patRestart(); } else { this.aNext = 0; this.aNK = 0; }
      }
      // shape position 0, pass 0, repeats 0, velocity decay reset (VELOCITY RETRIG), random orders redrawn
      arpRestart() {
        this.aPos = 0; this.aPass = 0; this.aCyc = 0; this.aNPrev = -1; this.aRPrev = -1; this.aRCur = -1; this.permNN = 0; this.permRN = 0;
        this.aStop = 0;
        const o = this.arpCur * ARP_ROW;
        if (this.arp[o + 26] >= 0.5 && this.arp[o + 27] >= 0.5) this.vRun = this.aLastV;
      }
      // NOTE / FIRST retrigger: positions now; a running pattern restarts at the next step boundary
      arpRetrig(F) {
        this.arpRestart();
        if (this.aRun && this.isPat() && !this.aHold) this.patRestartAt(Math.ceil(this.aEAt(F) - 1e-9));
      }
      // slot j becomes the playing slot at u (launch, quantised by the caller)
      arpApply(j, restart, F, u) {
        this.arpCur = j; this.parF = -1; this.readParams(F);
        this.aStop = 0; this.aHold = 0;
        if (restart) this.arpRestart();
        if (this.aRun) {
          if (this.aDom === 0) this.aU0 = u; else this.aF0 = this.frameAtU(u);
          this.aE0 = 0;
          this.aShape = this.arp[this.arpCur * ARP_ROW];
          this.aRR = (Math.floor(u / this.pRR + 1e-9) + 1) * this.pRR;
          if (this.isPat()) { if (!restart) this.arpRestart(); this.patRestart(); } else { this.aNext = 0; this.aNK = 0; }
        } else if (this.hN > 0 && this.arpOn) this.arpKick(F);
      }
      arpLaunch(j, F) {
        if (!(j >= 0 && j < N_SLOTS)) return;
        const restart = this.arp[j * ARP_ROW + 22] >= 0.5 ? 1 : 0;
        if (this.aRun && this.arpOn) {
          const u = this.uAt(F), uB = this.qNext(F, this.arpG[0]);
          if (uB > u + 1e-9) { this.aPendJ = j; this.aPendU = uB; this.aPendR = restart; return; }
          this.aPendJ = -1;
          this.arpApply(j, restart, F, uB);
          return;
        }
        this.aPendJ = -1;
        this.arpApply(j, restart, F, this.uAt(F));
      }
      // the stop button: aStop 2 (REPEATS / One Shot use 1, which a RETRIGGER RATE boundary undoes)
      arpStopCmd(j) {
        // a cancelled launch: nothing pending, or (paused by a seek) the playing slot's own restart at that boundary
        if (this.aPendJ === j) this.aPendJ = this.aHold && this.arpCur !== j ? this.arpCur : -1;
        if (this.arpCur === j) { this.aStop = 2; this.aRun = 0; this.aHold = 0; }
      }
      // the pass index r (−1: every pass at once, RANGE shape Chord)
      curR() {
        const rk = RANGE_KIND[this.arp[this.arpCur * ARP_ROW + 18] | 0], R = this.pRange;
        if (rk === K_CHORD) return -1;
        if (rk >= K_RAND) {
          if (this.aRCur < 0 || this.aRCur >= R) this.aRCur = this.rDraw(rk, R, -1);
          return this.aRCur;
        }
        return seqIdx(rk, R, this.aPass % seqLen(rk, R));
      }
      // random pass index: prev = the previous pass (−1 at a restart)
      rDraw(rk, R, prev) {
        if (R <= 1) return 0;
        switch (rk) {
          case K_NODUP: { if (prev >= 0 && prev < R) { const k = this.draw(R - 1); return k >= prev ? k + 1 : k; } return this.draw(R); }
          case K_DRIFT: { if (prev < 0 || prev >= R) return 0; let p = prev + (this.draw(2) ? 1 : -1); if (p < 0) p = 1; else if (p > R - 1) p = R - 2; return p; }
          case K_ONCE: {
            if (this.permRN !== R) {
              for (let i = 0; i < R; i++) this.permR[i] = i;
              for (let i = R - 1; i > 0; i--) { const j = this.draw(i + 1), t = this.permR[i]; this.permR[i] = this.permR[j]; this.permR[j] = t; }
              this.permRN = R;
            }
            return this.permR[this.aPass % R];
          }
          default: return this.draw(R);
        }
      }
      advancePass() {
        const rk = RANGE_KIND[this.arp[this.arpCur * ARP_ROW + 18] | 0], R = this.pRange;
        const L = rk === K_CHORD ? 1 : rk >= K_RAND ? R : seqLen(rk, R);
        this.aPass++;
        if (this.aPass >= L) {
          this.aPass = 0;
          this.aCyc++;
          if (this.pRepeats > 0 && this.aCyc >= this.pRepeats) { this.aStop = 1; this.aRun = 0; }
        }
        if (rk >= K_RAND && rk !== K_CHORD) { const p = this.aRCur; this.aRCur = this.rDraw(rk, R, p); }
      }
      rateRetrig(e) {
        if (this.arp[this.arpCur * ARP_ROW + 23] < 0.5) return 0;
        const u = this.aUOf(e), rr = this.pRR;
        if (u < this.aRR - 1e-9) return 0;
        this.aRR = (Math.floor(u / rr + 1e-9) + 1) * rr;
        return 1;
      }
      velOf(v) {
        const o = this.arpCur * ARP_ROW;
        return this.arp[o + 26] >= 0.5 && this.vRun >= 0 ? this.vRun : v;
      }
      velDecay() {
        const o = this.arpCur * ARP_ROW;
        if (this.arp[o + 26] < 0.5 || this.vRun < 0) return;
        const d = this.pVdec, T = d >= 0 ? this.pVtgt * 127 : (1 - this.pVtgt) * 127;
        this.vRun += (T - this.vRun) * 0.5 * (d < 0 ? -d : d);
      }
      // collects note n (+ range passes, ARP transpose, KEY / SCALE) into the group
      grpAdd(n, v, x, dur, r, ext) {
        const R = this.pRange, sh = this.pShift, kk = this.kbd[1], mk = this.kbd[2];
        for (let rr = r < 0 ? 0 : r, re = r < 0 ? R - 1 : r; rr <= re; rr++) {
          if (this.gC >= MAXG) return;
          let m = n + rr * sh + this.pTrans;
          if (kk >= 0) m = quantize(m, kk, mk);
          const i = this.gC++;
          this.gN[i] = m; this.gV[i] = v; this.gX[i] = x; this.gD[i] = dur; this.gE[i] = ext;
        }
      }
      // emits the group at elapsed e (strum a: note j of the ascending chord starts j·a/n steps later)
      grpEmit(e, a, F) {
        // one pitch once per group (octave doublings of Chord inversions, RANGE passes with SHIFT 0): otherwise the second
        // copy would cut the first at the same frame; it keeps the loudest velocity and the longest length
        let n = this.gC;
        for (let i = 1; i < n; i++) {
          for (let k = 0; k < i; k++) {
            if (this.gN[k] !== this.gN[i]) continue;
            if (this.gV[i] > this.gV[k]) this.gV[k] = this.gV[i];
            if (this.gD[i] > this.gD[k]) this.gD[k] = this.gD[i];
            for (let j = i + 1; j < n; j++) {
              this.gN[j - 1] = this.gN[j]; this.gV[j - 1] = this.gV[j]; this.gX[j - 1] = this.gX[j]; this.gD[j - 1] = this.gD[j]; this.gE[j - 1] = this.gE[j];
            }
            n--; i--;
            break;
          }
        }
        if (a > 0 && n > 1) {
          for (let i = 1; i < n; i++) {
            const N = this.gN[i], V = this.gV[i], X = this.gX[i], Dd = this.gD[i], E = this.gE[i];
            let j = i;
            while (j > 0 && this.gN[j - 1] > N) {
              this.gN[j] = this.gN[j - 1]; this.gV[j] = this.gV[j - 1]; this.gX[j] = this.gX[j - 1]; this.gD[j] = this.gD[j - 1]; this.gE[j] = this.gE[j - 1];
              j--;
            }
            this.gN[j] = N; this.gV[j] = V; this.gX[j] = X; this.gD[j] = Dd; this.gE[j] = E;
          }
        }
        for (let i = 0; i < n; i++) {
          const dl = a > 0 && n > 1 ? i * a / n : 0, offF = this.aFrame(e + dl + this.gD[i]);
          if (dl === 0) { this.genRetrig(this.gN[i], F); this.genOn(this.gN[i], this.gV[i], this.gX[i], 0.5, 0, -1, offF, -1, this.gE[i], F); }
          else this.onAdd(this.aFrame(e + dl), offF, this.gN[i], this.gV[i], this.gX[i], this.gE[i]);
        }
        this.gC = 0;
      }
      // one step of a note-order shape (§7.4.1, §7.4.2, §7.4.4)
      arpStep(e, F) {
        const A = this.arp, o = this.arpCur * ARP_ROW, k = ARP_KIND[A[o] | 0];
        this.aNext = e + 1;
        if (this.rateRetrig(e)) this.arpRestart();
        if (this.hDirty) this.hSort();
        const N = k === K_PLAYED ? this.hN : this.sUN;
        if (N === 0) { this.aRun = 0; return; }
        const c = this.pChance, sound = c >= 1 || this.rnd01() < c;
        if (!sound && A[o + 21] >= 0.5) return;       // CHANCE Pre: a silent step does not advance
        const len = seqLen(k, N), p = this.aPos % len;
        if (sound) {
          const r = this.curR(), dur = this.pGate;
          this.gC = 0;
          if (k === K_CHORD) {
            for (let i = 0; i < N; i++) this.grpAdd(this.sU[i], this.velOf(this.hVel[this.sUi[i]]), 0.5, dur, r, this.hExt[this.sUi[i]]);
          } else {
            let idx;
            if (k === K_RAND) idx = this.draw(N);
            else if (k === K_NODUP) {
              const pv = this.aNPrev;
              if (N === 1) idx = 0; else if (pv >= 0 && pv < N) { const q = this.draw(N - 1); idx = q >= pv ? q + 1 : q; } else idx = this.draw(N);
            } else if (k === K_DRIFT) {
              const pv = this.aNPrev;
              if (pv < 0 || pv >= N) idx = 0;
              else if (N > 1) { idx = pv + (this.draw(2) ? 1 : -1); if (idx < 0) idx = 1; else if (idx > N - 1) idx = N - 2; } else idx = 0;
            } else if (k === K_ONCE) {
              if (this.permNN !== N) {
                for (let i = 0; i < N; i++) this.permN[i] = i;
                for (let i = N - 1; i > 0; i--) { const j = this.draw(i + 1), t = this.permN[i]; this.permN[i] = this.permN[j]; this.permN[j] = t; }
                this.permNN = N;
              }
              idx = this.permN[(p + this.pOffset) % len];   // OFFSET rotates the drawn order as well (= seq-core arpOrder)
            } else idx = seqIdx(k === K_PLAYED ? K_UP : k, N, (p + this.pOffset) % len);
            this.aNPrev = idx;
            if (k === K_PLAYED) this.grpAdd(this.hNote[idx], this.velOf(this.hVel[idx]), 0.5, dur, r, this.hExt[idx]);
            else this.grpAdd(this.sU[idx], this.velOf(this.hVel[this.sUi[idx]]), 0.5, dur, r, this.hExt[this.sUi[idx]]);
          }
          this.grpEmit(e, 0, F);
          this.velDecay();
        }
        this.aPos = p + 1;
        if (this.aPos >= len) { this.aPos = 0; this.advancePass(); }
      }

      /* ---------------------------------------------------------- pattern (§7.4.3) */
      // cursor over records sorted by t (offset = when the playhead, started at q, crosses a record's t)
      lowerB(T, b, s, K, x) { let lo = 0, hi = K; while (lo < hi) { const m = (lo + hi) >> 1; if (T[b + m * s] < x - 1e-9) lo = m + 1; else hi = m; } return lo; }
      upperB(T, b, s, K, x) { let lo = 0, hi = K; while (lo < hi) { const m = (lo + hi) >> 1; if (T[b + m * s] <= x + 1e-9) lo = m + 1; else hi = m; } return lo - 1; }
      curIdx(K, dir, s0, w) { return dir > 0 ? w % K : mod(s0 - w, K); }
      curOff(T, b, s, K, q, W, dir, s0, w) {
        if (dir > 0) return T[b + (w % K) * s] - q + Math.floor(w / K) * W;
        return q - T[b + mod(s0 - w, K) * s] + Math.floor((K - 1 - s0 + w) / K) * W;
      }
      patRestartAt(e) {
        if (this.aDom === 0) this.aU0 += (e - this.aE0) * this.aD; else this.aF0 += (e - this.aE0) * this.aD * this.base;
        this.aE0 = 0;
        this.patRestart();
      }
      patRestart() {
        const o = this.arpCur * ARP_ROW;
        this.gAcc = 0; this.gPh = 0; this.gRe = 0; this.gMode = this.arp[o + 29] | 0;
        if (this.gMode === 7) { this.gDir = 0; this.gE0 = 0; this.gQ = 0; this.gS = INF; this.aNext = 0; this.aNK = 3; return; }
        this.patSeg(0, 1);
        this.patNext();
      }
      patSeg(e0, first) {
        const A = this.arp, o = this.arpCur * ARP_ROW, len = A[o + 28], T = Math.max(1, A[o + 30] * 4), mode = A[o + 29] | 0;
        let q = 0, dir = 1, S = len;
        switch (mode) {
          case 1: dir = -1; break;
          case 2: if (this.gPh) { dir = -1; q = len; } break;
          case 3: S = T; if (!first) q = this.draw(len); break;
          case 4: q = this.draw(len); break;
          case 5: S = T * (1 + this.draw(Math.max(1, Math.floor(len / T + 1e-9)))); break;
          default: break;
        }
        this.gE0 = e0; this.gQ = q; this.gDir = dir; this.gS = S; this.gLast = -1; this.gLen = len; this.gTime = T;
        this.patCursor();
      }
      patCursor() {
        const o = this.arpCur * ARP_ROW, b = this.arp[o + 33] * 5, K = this.arp[o + 34] | 0;
        if (this.gDir > 0) { this.gS0 = this.lowerB(this.arpEv, b, 5, K, this.gQ); this.gW = this.gS0; } else { this.gS0 = this.upperB(this.arpEv, b, 5, K, this.gQ); this.gW = 0; }
      }
      patNext() {
        const A = this.arp, o = this.arpCur * ARP_ROW, K = A[o + 34] | 0;
        if (this.gDir === 0) { this.aNK = 2; return; }
        if (K > 0) {
          const off = this.curOff(this.arpEv, A[o + 33] * 5, 5, K, this.gQ, A[o + 28], this.gDir, this.gS0, this.gW);
          if (off < this.gS - 1e-9) { this.aNext = this.gE0 + (off > 0 ? off : 0); this.aNK = 0; return; }
        }
        this.aNext = this.gE0 + this.gS; this.aNK = 1;
      }
      // pattern edited while running: events only → cursor re-seek after the last fired position; a new MODE, LENGTH or
      // TIME → the pattern restarts at the next step boundary
      patReseek(F) {
        this.gRe = 0;
        const A = this.arp, o = this.arpCur * ARP_ROW;
        if ((A[o + 29] | 0) !== this.gMode || (this.gDir !== 0 && (A[o + 28] !== this.gLen || Math.max(1, A[o + 30] * 4) !== this.gTime))) {
          this.patRestartAt(Math.ceil(this.aEAt(F) - 1e-9));
          return;
        }
        if (this.gDir === 0) return;
        const K = A[o + 34] | 0, b = A[o + 33] * 5, len = A[o + 28], x = this.aEAt(F) - this.gE0;
        this.patCursor();
        if (K > 0) {
          for (let g = 0; g < 4 * MAX_EV; g++) {
            const off = this.curOff(this.arpEv, b, 5, K, this.gQ, len, this.gDir, this.gS0, this.gW);
            if (off >= this.gS || (off > this.gLast + 1e-9 && off > x - 1e-9)) break;
            this.gW++;
          }
        }
        this.patNext();
      }
      // (a pattern's RETRIGGER RATE is its own event on the RRATE grid: rrFire)
      patEvent(e, F) {
        if (this.aNK === 1) { this.patSegEnd(e); return; }
        const A = this.arp, o = this.arpCur * ARP_ROW, K = A[o + 34] | 0, b = A[o + 33] * 5;
        this.gC = 0;
        if (this.aNK === 3) {                          // Static: the events at position 0, once per (re)trigger
          for (let i = 0; i < K && this.arpEv[b + i * 5] < 1e-6; i++) this.patEv(b + i * 5);
          this.gT = 0;
          this.aNK = 2;
        } else {
          const len = A[o + 28], off0 = e - this.gE0;
          for (let g = 0; g < MAX_EV && K > 0; g++) {
            const off = this.curOff(this.arpEv, b, 5, K, this.gQ, len, this.gDir, this.gS0, this.gW);
            if (off > off0 + 1e-9 || off >= this.gS - 1e-9) break;
            const i = this.curIdx(K, this.gDir, this.gS0, this.gW);
            if (g === 0) this.gT = this.arpEv[b + i * 5];
            this.patEv(b + i * 5);
            this.gW++;
          }
          this.gLast = off0;
        }
        this.grpEmit(e, this.strumAt(this.gT), F);
        this.evMark = this.hSerial;
        this.velDecay();
        if (this.aNK !== 2) this.patNext();
      }
      strumAt(t) {
        const o = this.arpCur * ARP_ROW, b = this.arp[o + 35] * 2, n = this.arp[o + 36] | 0, S = this.arpStrum;
        for (let i = 0; i < n; i++) { const d = S[b + 2 * i] - t; if (d < 1e-6 && d > -1e-6) return S[b + 2 * i + 1]; }
        return 0;
      }
      // one pattern event [t16, len16, row, vel, accent] → the group
      patEv(ei) {
        const A = this.arp, o = this.arpCur * ARP_ROW, E = this.arpEv, len = A[o + 28], mask = A[o + 37] | 0;
        const lo = (this.arpCur * ARP_LANES) * LANE_W, x01 = E[ei] / len, Ln = this.arpLane;
        let c = this.pChance;
        if (mask & 4) c *= laneAt(Ln, lo + 2 * LANE_W, x01);
        if (c < 1 && this.rnd01() >= c) return;
        let v = A[o + 26] >= 0.5 && this.vRun >= 0 ? this.vRun : E[ei + 3];
        if (mask & 1) v = laneAt(Ln, lo, x01) * 127;
        if (E[ei + 4] >= 0.5) { v *= 1.3; if (v > 127) v = 127; }
        let dur = E[ei + 1] * this.pGate;
        if (mask & 2) dur *= laneAt(Ln, lo + LANE_W, x01);
        const x = mask & 8 ? laneAt(Ln, lo + 3 * LANE_W, x01) : 0.5;
        if (this.hDirty) this.hSort();
        const sm = A[o + 31] | 0, nw = sm === 1 || sm === 3;
        if (nw) this.hNewSort();
        const L = nw ? this.nU : this.sU, Li = nw ? this.nUi : this.sUi, N = nw ? this.nUN : this.sUN;
        if (N === 0) return;
        const row = E[ei + 2] | 0, r = this.curR();
        if (sm >= 2) {                                 // Chord: every note, inversion by row
          const k = row > 0 ? row - 1 : -row - 1, full = Math.floor(k / N), rem = k % N;
          for (let j = 0; j < N; j++) {
            const up = row > 0 ? full + (j < rem ? 1 : 0) : -(full + (j >= N - rem ? 1 : 0));
            this.grpAdd(L[j] + 12 * up, v, x, dur, r, this.hExt[Li[j]]);
          }
          return;
        }
        const idx = this.rowIdx(row, N, A[o + 32] | 0);
        if (idx >= 0) this.grpAdd(L[idx] + this.rowTr, v, x, dur, r, this.hExt[Li[idx]]);
      }
      // row → index into the N held notes (WRAP: Wrap / Phantom −1 / Clamp); this.rowTr = the wrap transposition
      rowIdx(row, N, wrap) {
        this.rowTr = 0;
        if (row > 0) {
          const i = row - 1;
          if (i < N) return i;
          if (wrap === 1) return -1;
          if (wrap === 2) return N - 1;
          this.rowTr = (Math.floor(i / N) % (this.pWrg + 1)) * this.pWtr;
          return i % N;
        }
        const i = -row - 1;
        if (i < N) return N - 1 - i;
        if (wrap === 1) return -1;
        if (wrap === 2) return 0;
        this.rowTr = -(Math.floor(i / N) % (this.pWrg + 1)) * this.pWtr;
        return N - 1 - (i % N);
      }
      patSegEnd(e) {
        const A = this.arp, o = this.arpCur * ARP_ROW, mode = A[o + 29] | 0, len = A[o + 28];
        if (mode === 6) { this.aStop = 1; this.aRun = 0; return; }        // One Shot
        this.gAcc += this.gS;
        const LL = mode === 2 ? 2 * len : len;       // ≥ 1 (validated); the bound only guards against a corrupt table
        for (let g = 0; g < 1024 && LL > 0 && this.gAcc >= LL - 1e-9; g++) { this.gAcc -= LL; this.advancePass(); if (this.aStop) return; }
        if (mode === 2) this.gPh ^= 1;
        this.patSeg(e, 0);
        this.patNext();
      }
      patPos() {
        if (this.gDir === 0 || !this.aRun) return 0;
        const len = this.arp[this.arpCur * ARP_ROW + 28];
        let x = this.aEAt(this.lastF) - this.gE0;
        x = x > 0 ? (x < this.gS ? x : this.gS) : 0;
        return this.gDir > 0 ? mod(this.gQ + x, len) : mod(this.gQ - x, len);
      }
      // RETRIGGER RATE as its own event (aRR, on the RRATE grid): a running pattern (its events may be sparse) and an arp
      // stopped by REPEATS / One Shot (aStop 1). Step shapes check the boundary at every step (arpStep), which lies on it.
      rrOn() {
        if (this.aHold || this.hN === 0 || this.arp[this.arpCur * ARP_ROW + 23] < 0.5) return false;
        return this.aRun ? this.isPat() : this.aStop === 1;
      }
      rrFire(F) {
        const rr = this.pRR, uR = this.aRR;
        // a boundary more than one span granule behind (RATE retrigger switched on later, …) moves to the next one
        if (this.frameAtU(uR) < F - GRAN) { this.aRR = nextQ(this.uEv(F), rr); return; }
        this.aRR = (Math.floor(uR / rr + 1e-9) + 1) * rr;
        this.arpRestart();
        if (this.aRun) {                               // the pattern restarts exactly at the boundary
          this.patRestartAt(this.aDom === 0 ? this.aE0 + (uR - this.aU0) / this.aD : this.aEAt(this.frameAtU(uR)));
          return;
        }
        this.aRun = 1;                                 // a new run from the boundary (arpKick anchored on it)
        this.aShape = this.arp[this.arpCur * ARP_ROW];
        if (this.aDom === 0) this.aU0 = uR; else this.aF0 = this.frameAtU(uR);
        this.aE0 = 0;
        if (this.isPat()) this.patRestart(); else { this.aNext = 0; this.aNK = 0; }
      }
      // arp events due at F: slot launches at their boundary, RATE-retrigger boundaries, steps / pattern events. While paused
      // by a seek (aHold) only the pending restart is scheduled: edits of the slot are read by that restart.
      fireArp(F) {
        for (let g = 0; g < 4096 && this.arpOn; g++) {
          const run = this.aRun;
          if (run && !this.aHold) {
            const sh = this.arp[this.arpCur * ARP_ROW];
            if (sh !== this.aShape) {                  // SHAPE edited while running: the new order from the next step boundary
              this.aShape = sh;
              const e = Math.ceil(this.aEAt(F) - 1e-9);
              if (this.isPat()) { this.arpRestart(); this.patRestartAt(e); } else { this.aNext = e; this.aNK = 0; }
            } else if (this.gRe) { if (this.isPat()) this.patReseek(F); else this.gRe = 0; }
          }
          const fR = this.rrOn() ? this.frameAtU(this.aRR) : INF;
          const fL = run && this.aPendJ >= 0 ? this.frameAtU(this.aPendU) : INF, fS = run && this.aNK !== 2 ? this.aFrame(this.aNext) : INF;
          if (fL <= fS && fL <= fR) {
            if (!(fL < F + 0.5)) break;
            const j = this.aPendJ, r = this.aPendR, u = this.aPendU;
            this.aPendJ = -1;
            this.arpApply(j, r, F, u);
            continue;
          }
          if (fR <= fS) {
            if (!(fR < F + 0.5)) break;
            this.rrFire(F);
            continue;
          }
          if (!(fS < F + 0.5)) break;
          if (this.isPat()) this.patEvent(this.aNext, F); else this.arpStep(this.aNext, F);
        }
      }

      /* ---------------------------------------------------------- clip player (§7.5) */
      findPlayer(j) {
        let best = -1;
        for (let p = 0; p < MAXP; p++) {
          if (this.pSt[p] !== 0 && this.pJ[p] === j && this.pStopU[p] === INF && (best < 0 || this.pSer[p] > this.pSer[best])) best = p;
        }
        return best;
      }
      allocPlayer(F) {
        let best = -1;
        for (let p = 0; p < MAXP; p++) { if (this.pSt[p] === 0) return p; if (best < 0 || this.pSer[p] < this.pSer[best]) best = p; }
        this.pStop(best, F);
        return best;
      }
      // launch (or relaunch player `reuse`) of clip j at its next LAUNCH QUANT boundary; pos = start position (NaN: §7.5.2)
      clipLaunch(j, F, key, tr, vel, ext, pos, reuse) {
        if (!(j >= 0 && j < N_SLOTS)) return -1;
        const u = this.uAt(F), uS = this.qNext(F, this.clip[j * CLIP_ROW + 7]);
        const p = reuse >= 0 ? reuse : this.allocPlayer(F);
        if (this.pSt[p] !== 2) this.pSt[p] = 1; else if (this.pRs[p] !== 2) this.pRs[p] = 1;   // a paused player stays paused
        this.pJ[p] = j; this.pKey[p] = key; this.pTr[p] = tr; this.pVel[p] = vel; this.pExt[p] = ext; this.pSer[p] = ++this.pSerial;
        this.pStartU[p] = uS; this.pStopU[p] = INF; this.pPos0[p] = pos;
        if (this.clipG[4] < 0.5) {                     // MONO: the other clips stop when this one starts
          for (let i = 0; i < MAXP; i++) if (i !== p && this.pSt[i] !== 0 && this.pJ[i] !== j && this.pStopU[i] > uS) this.pStopU[i] = uS;
        }
        if (uS <= u + 1e-9) {
          for (let i = 0; i < MAXP; i++) if (this.pSt[i] !== 0 && this.pStopU[i] <= u + 1e-9) this.pStop(i, F);
          this.pStart(p, F);
        }
        return p;
      }
      clipStopReq(p, F) {
        const u = this.uAt(F), uS = this.qNext(F, this.clip[this.pJ[p] * CLIP_ROW + 7]);
        if (uS <= u + 1e-9 || this.pSt[p] === 1) this.pStop(p, F); else if (uS < this.pStopU[p]) this.pStopU[p] = uS;
      }
      pRegion(p) {
        const j = this.pJ[p], o = j * CLIP_ROW, b = this.cOff[j] * 8, n = this.cN[j];
        this.pKA[p] = this.lowerB(this.clipNotes, b, 8, n, this.clip[o + 1]);
        this.pKB[p] = this.lowerB(this.clipNotes, b, 8, n, this.clip[o]);
        if (this.pKB[p] < this.pKA[p]) this.pKB[p] = this.pKA[p];
        this.pRe[p] = 0;
      }
      pStart(p, F) {
        const j = this.pJ[p], o = j * CLIP_ROW, C = this.clip, len = C[o], st = C[o + 1], W = len - st, rate = this.clipRate(j), uS = this.pStartU[p];
        let pos = this.pPos0[p];
        if (pos !== pos) pos = C[o + 8] >= 0.5 ? C[o + 2] + clamp01(C[o + 13] + this.oCO) * len : st + 4 * rate * uS;
        pos = st + mod(pos - st, W);
        // a restart of a Static snapshot (or into Static) releases the held notes first: only the latest snapshot sounds
        if (this.pSt[p] === 2 && (this.pDir[p] === 0 || (C[o + 5] | 0) === 8)) this.releaseOwner(p, F);
        this.pSt[p] = 2; this.pRs[p] = 0;
        this.pUA[p] = uS; this.pCA[p] = 0; this.pRate[p] = rate; this.pPh[p] = 0;
        this.pSl[p] = Math.floor((pos - st) / Math.max(1, C[o + 6] * 4));
        this.pRegion(p);
        if ((C[o + 5] | 0) === 8) {                    // Static: the notes covering the start position, held until the clip stops
          this.pDir[p] = 0; this.pQ[p] = pos; this.pC0[p] = 0; this.pS[p] = INF;
          const b = (this.cOff[j] + this.pKA[p]) * 8, K = this.pKB[p] - this.pKA[p], N = this.clipNotes;
          for (let i = 0; i < K; i++) {
            const t = N[b + i * 8];
            if (t > pos + 1e-9) break;
            if (t + N[b + i * 8 + 1] > pos + 1e-9 && N[b + i * 8 + 4] < 0.5) this.pEmitAt(p, b + i * 8, INF, F);
          }
          return;
        }
        this.pSeg(p, 0, pos, 1);
      }
      pSeg(p, c0, q, first) {
        const j = this.pJ[p], o = j * CLIP_ROW, C = this.clip, len = C[o], st = C[o + 1], W = len - st, T = Math.max(1, C[o + 6] * 4);
        const mode = C[o + 5] | 0, nSl = Math.max(1, Math.ceil(W / T - 1e-9));
        let dir = 1, S = W;
        switch (mode) {
          case 1: dir = -1; break;
          case 2: if (first) S = len - q; else if (this.pPh[p]) { dir = -1; q = len; } else q = st; break;
          case 3: S = len - q; break;
          case 4: case 5:
            if (!first) {
              let i = this.draw(nSl);
              if (mode === 5 && nSl > 1 && this.pSl[p] >= 0 && this.pSl[p] < nSl) { i = this.draw(nSl - 1); if (i >= this.pSl[p]) i++; }
              this.pSl[p] = i; q = st + i * T;
            }
            S = Math.min(T, len - q);
            break;
          case 6: if (!first) q = st + this.draw(nSl) * T; break;
          case 7: if (!first) q = st; S = Math.min(W, T * (1 + this.draw(nSl))); break;
          default: break;
        }
        if (!(S > 1e-6)) S = 1e-6;
        this.pC0[p] = c0; this.pQ[p] = q; this.pDir[p] = dir; this.pS[p] = S; this.pLast[p] = -1;
        this.pCursor(p);
      }
      // the clip's region / MODE / slice TIME changed while it plays: a new segment from the playhead's position wrapped into
      // the new region, as a fresh start there (no launch quantisation, Pendulum forward first)
      pRegeo(p, F) {
        if (this.pSt[p] !== 2 || this.pRs[p]) { this.pReseek(p, F); return; }  // waiting / restarting: its start reads the new geometry
        const j = this.pJ[p], o = j * CLIP_ROW, C = this.clip, st = C[o + 1], W = C[o] - st;
        const u = this.uAt(F), c = this.pCA[p] + (u - this.pUA[p]) * 4 * this.pRate[p];
        let x = c - this.pC0[p];
        x = x > 0 ? (x < this.pS[p] ? x : this.pS[p]) : 0;
        const pos = st + mod((this.pDir[p] > 0 ? this.pQ[p] + x : this.pDir[p] < 0 ? this.pQ[p] - x : this.pQ[p]) - st, W);
        if (this.pDir[p] === 0 || (C[o + 5] | 0) === 8) {                    // to or from Static: a fresh start at the position
          this.releaseOwner(p, F);
          this.pStartU[p] = u; this.pPos0[p] = pos; this.pStart(p, F);
          return;
        }
        this.pSl[p] = Math.floor((pos - st) / Math.max(1, C[o + 6] * 4));
        this.pPh[p] = 0;
        this.pRegion(p);
        this.pSeg(p, c, pos, 1);
      }
      // the clip's notes were edited while it plays: the cursor moves to the first note not yet fired that is not in the past
      pReseek(p, F) {
        this.pRegion(p);
        if (this.pSt[p] !== 2 || this.pDir[p] === 0) return;
        this.pCursor(p);
        const j = this.pJ[p], o = j * CLIP_ROW, W = this.clip[o] - this.clip[o + 1], N = this.clipNotes;
        const b = (this.cOff[j] + this.pKA[p]) * 8, K = this.pKB[p] - this.pKA[p];
        const x = this.pCA[p] + (this.uAt(F) - this.pUA[p]) * 4 * this.pRate[p] - this.pC0[p];
        for (let g = 0; g < 4 * MAX_CLIP_NOTES && K > 0; g++) {
          const off = this.curOff(N, b, 8, K, this.pQ[p], W, this.pDir[p], this.pS0[p], this.pW[p]);
          if (off >= this.pS[p] || (off > this.pLast[p] + 1e-9 && off > x - 1e-9)) break;
          this.pW[p]++;
        }
      }
      pCursor(p) {
        const b = (this.cOff[this.pJ[p]] + this.pKA[p]) * 8, K = this.pKB[p] - this.pKA[p];
        if (this.pDir[p] > 0) { this.pS0[p] = this.lowerB(this.clipNotes, b, 8, K, this.pQ[p]); this.pW[p] = this.pS0[p]; }
        else { this.pS0[p] = this.upperB(this.clipNotes, b, 8, K, this.pQ[p]); this.pW[p] = 0; }
      }
      // clip-elapsed sixteenths of the next note (tmpK 0, tmpI = its record) or of the segment end (tmpK 1)
      pNextC(p) {
        const j = this.pJ[p], o = j * CLIP_ROW, W = this.clip[o] - this.clip[o + 1], N = this.clipNotes;
        if (this.pRe[p]) {                             // the clip was edited: re-seek after the last fired position
          this.pRegion(p);
          this.pCursor(p);
          const b0 = (this.cOff[j] + this.pKA[p]) * 8, K0 = this.pKB[p] - this.pKA[p];
          for (let g = 0; g < 4 * MAX_CLIP_NOTES && K0 > 0; g++) {
            const off = this.curOff(N, b0, 8, K0, this.pQ[p], W, this.pDir[p], this.pS0[p], this.pW[p]);
            if (off > this.pLast[p] + 1e-9 || off >= this.pS[p]) break;
            this.pW[p]++;
          }
        }
        const b = (this.cOff[j] + this.pKA[p]) * 8, K = this.pKB[p] - this.pKA[p];
        for (let skip = 0; K > 0 && skip <= K; skip++) {
          const off = this.curOff(N, b, 8, K, this.pQ[p], W, this.pDir[p], this.pS0[p], this.pW[p]);
          if (off >= this.pS[p] - 1e-9) break;
          const i = this.curIdx(K, this.pDir[p], this.pS0[p], this.pW[p]);
          if (N[b + i * 8 + 4] >= 0.5) { this.pW[p]++; continue; }        // muted
          this.tmpK = 0; this.tmpI = b + i * 8;
          return this.pC0[p] + (off > 0 ? off : 0);
        }
        this.tmpK = 1;
        return this.pC0[p] + this.pS[p];
      }
      cFrame(p, c) { return this.frameAtU(this.pUA[p] + (c - this.pCA[p]) / (4 * this.pRate[p])); }
      // next event of player p: frame; tmpKind 0 start, 1 stop, 2 note, 3 segment end
      pNextFrame(p) {
        let best = INF, kind = -1;
        if (this.pSt[p] === 1 || this.pRs[p]) { best = this.frameAtU(this.pStartU[p]); kind = 0; }
        if (this.pStopU[p] < INF) { const f = this.frameAtU(this.pStopU[p]); if (f <= best) { best = f; kind = 1; } }
        if (this.pSt[p] === 2 && this.pDir[p] !== 0 && this.pRs[p] !== 2) {   // paused by a seek: no notes until its restart
          const c = this.pNextC(p), f = this.cFrame(p, c);
          if (f < best) { best = f; kind = 2 + this.tmpK; this.tmpC = c; }
        }
        this.tmpKind = kind;
        return best;
      }
      firePlayer(p, F) {
        for (let g = 0; g < 4096 && this.pSt[p] !== 0; g++) {
          const f = this.pNextFrame(p);
          if (!(f < F + 0.5)) break;
          const k = this.tmpKind;
          if (k === 0) this.pStart(p, F);
          else if (k === 1) this.pStop(p, F);
          else if (k === 2) {
            const c = this.tmpC, ei = this.tmpI, t = this.clipNotes[ei], len = this.clip[this.pJ[p] * CLIP_ROW];
            let dur = this.clipNotes[ei + 1];
            if (t + dur > len) dur = len - t;          // a note crossing the loop end is cut there
            this.pW[p]++;
            this.pLast[p] = c - this.pC0[p];
            this.pEmitAt(p, ei, this.cFrame(p, c + (dur > 1e-6 ? dur : 1e-6)), F);
          } else this.pSegEnd(p, F);
        }
      }
      pSegEnd(p, F) {
        const o = this.pJ[p] * CLIP_ROW, mode = this.clip[o + 5] | 0, c = this.pC0[p] + this.pS[p];
        if (mode === 3) { this.pStop(p, F); return; }  // One Shot
        if (mode === 2) this.pPh[p] ^= 1;
        this.pSeg(p, c, this.pQ[p], 0);
      }
      // clip note record ei → the clip output (§7.5.5)
      pEmitAt(p, ei, offF, F) {
        const j = this.pJ[p], o = j * CLIP_ROW, N = this.clipNotes;
        const m = N[ei + 2] + this.pTr[p] + this.clipTrans(j) + this.kbd[0];
        const v = N[ei + 3] * (this.clip[o + 9] >= 0.5 ? this.pVel[p] : 1);
        this.clipOut(m, v, N[ei + 5], N[ei + 6], N[ei + 7], offF, p, this.pExt[p], F);
      }
      // clip output: MIDI OUT 'Clip Player' tap, then the arpeggiator (clip → arp → key/scale) or the allocator
      clipOut(m, v, x, y, z, offF, owner, ext, F) {
        if (m < 0 || m > 127) return;
        if (this.arpOn) {
          const a = this.arpAccept(m, v);
          if (a >= 0) {
            this.fwd(1, 1, m, v >= 127 ? 1 : v / 127, ext, F);
            this.fwdSk0 = null; this.fwdSk1 = null;
            const ser = this.hInsert(a, v, -1, 2, ext, F);
            this.offAdd(offF, 1, a, ser, m, owner);
            return;
          }
        }
        let mq = m;
        if (this.kbd[1] >= 0) mq = quantize(m, this.kbd[1], this.kbd[2]);
        this.genRetrig(mq, F);
        this.fwd(1, 1, m, v >= 127 ? 1 : v / 127, ext, F);   // the Clip Player tap; the On tap of this note skips its targets
        this.genOn(mq, v, x, y, z, owner, offF, m, ext, F);
        this.fwdSk0 = null; this.fwdSk1 = null;
      }
      pStop(p, F) {
        this.pSt[p] = 0; this.pRs[p] = 0; this.pStopU[p] = INF;
        this.releaseOwner(p, F);
      }
      // KB SPAN (§7.5.4); j = the selected clip at the key's note-on
      kbOn(j, kb, n, vel, ext, F) {
        const C = this.clip, o = j * CLIP_ROW;
        if (kb === 2) {                                // Poly: one playhead copy per key (≤ 8)
          for (let p = 0; p < MAXP; p++) if (this.pSt[p] !== 0 && this.pJ[p] === j && this.pKey[p] === n) { this.clipLaunch(j, F, n, n - 60, vel, ext, NaN, p); return; }
          let cnt = 0, old = -1;
          for (let p = 0; p < MAXP; p++) {
            if (this.pSt[p] !== 0 && this.pJ[p] === j && this.pKey[p] >= 0) { cnt++; if (old < 0 || this.pSer[p] < this.pSer[old]) old = p; }
          }
          if (cnt >= MAXCOPY) this.pStop(old, F);
          this.clipLaunch(j, F, n, n - 60, vel, ext, NaN, -1);
          return;
        }
        const wasEmpty = this.kbN === 0;
        for (let i = 0; i < this.kbN; i++) if (this.kbH[i] === n) { this.kbDel(i); break; }
        if (this.kbN < MAXKB) { this.kbH[this.kbN] = n; this.kbV[this.kbN] = vel; this.kbN++; }
        const p = this.findPlayer(j);
        if (kb === 3) {                                // Offset: the key chooses the start position
          const st = C[o + 1], W = C[o] - st;
          this.clipLaunch(j, F, -1, 0, vel, ext, st + mod((n - 60) * C[o + 3] * 4, W), p);
          return;
        }
        if (p < 0) this.clipLaunch(j, F, -1, n - 60, vel, ext, NaN, -1);
        else if (C[o + 8] >= 0.5 && wasEmpty) this.clipLaunch(j, F, -1, n - 60, vel, ext, NaN, p);
        else { this.pTr[p] = n - 60; this.pVel[p] = vel; }
      }
      kbOff(j, kb, n, F) {
        const gate = this.clip[j * CLIP_ROW + 10] >= 0.5;
        if (kb === 2) {
          if (gate) for (let p = 0; p < MAXP; p++) if (this.pSt[p] !== 0 && this.pJ[p] === j && this.pKey[p] === n) this.pStop(p, F);
          return;
        }
        for (let i = 0; i < this.kbN; i++) if (this.kbH[i] === n) { this.kbDel(i); break; }
        const p = this.findPlayer(j);
        if (p < 0) return;
        if (this.kbN > 0) { if (kb === 1) { this.pTr[p] = this.kbH[this.kbN - 1] - 60; this.pVel[p] = this.kbV[this.kbN - 1]; } }
        else if (gate) this.pStop(p, F);
      }
      kbDel(i) {
        for (let k = i; k < this.kbN - 1; k++) { this.kbH[k] = this.kbH[k + 1]; this.kbV[k] = this.kbV[k + 1]; }
        this.kbN--;
      }
      // trigger-octave key: toggles clip j (NOTE GATE: the key's release stops it)
      clipToggle(j, n, vel, ext, F) {
        const p = this.findPlayer(j);
        if (p >= 0) { this.clipStopReq(p, F); return; }
        this.clipLaunch(j, F, n, 0, vel, ext, NaN, -1);
      }
      clipTrigOff(j, n, F) {
        if (this.clip[j * CLIP_ROW + 10] < 0.5) return;
        for (let p = 0; p < MAXP; p++) if (this.pSt[p] !== 0 && this.pJ[p] === j && this.pKey[p] === n) this.pStop(p, F);
      }
      // playhead of player p at u (sixteenths), −1 when not playing
      pPosAt(p, u) {
        if (this.pSt[p] !== 2) return -1;
        const o = this.pJ[p] * CLIP_ROW, len = this.clip[o], st = this.clip[o + 1], W = len - st;
        if (this.pDir[p] === 0) return this.pQ[p];
        let x = this.pCA[p] + (this.pRs[p] === 2 ? 0 : (u - this.pUA[p]) * 4 * this.pRate[p]) - this.pC0[p];
        x = x > 0 ? (x < this.pS[p] ? x : this.pS[p]) : 0;
        return st + mod((this.pDir[p] > 0 ? this.pQ[p] + x : this.pQ[p] - x) - st, W);
      }
      // macro lanes m1…m8 → proc.seqMacro (§7.5.5; the most recently launched playing clip with that lane wins)
      macros(F) {
        const M = this.mac;
        if (M === null) return;
        let u = NaN;
        for (let k = 0; k < 8; k++) {
          let best = -1;
          for (let p = 0; p < MAXP; p++) {
            if (this.pSt[p] === 2 && ((this.clip[this.pJ[p] * CLIP_ROW + 16] | 0) & (1 << k)) && (best < 0 || this.pSer[p] > this.pSer[best])) best = p;
          }
          if (best < 0) { M[k] = NaN; continue; }
          if (u !== u) u = this.uAt(F);
          const j = this.pJ[best];
          M[k] = laneAt(this.clipLane, (j * CLIP_LANES + k) * LANE_W, this.pPosAt(best, u) / this.clip[j * CLIP_ROW]);
        }
      }

      /* ---------------------------------------------------------- engine contract (§7.7) */
      next(F) {
        if (!this.ok) return 1e9;
        this.sync(F);
        let m = INF;
        for (let i = 0; i < this.nOff; i++) if (this.oF[i] < m) m = this.oF[i];
        for (let i = 0; i < this.nOn; i++) if (this.qF[i] < m) m = this.qF[i];
        if (this.clipOn) for (let p = 0; p < MAXP; p++) if (this.pSt[p] !== 0) { const f = this.pNextFrame(p); if (f < m) m = f; }
        if (this.arpOn) {
          if (this.aRun) {
            if (this.aPendJ >= 0) { const f = this.frameAtU(this.aPendU); if (f < m) m = f; }
            if (this.aNK !== 2) { const f = this.aFrame(this.aNext); if (f < m) m = f; }
          }
          if (this.rrOn()) { const f = this.frameAtU(this.aRR); if (f < m) m = f; }
        }
        if (!(m < 1e15)) return 1e9;
        const d = Math.round(m) - F;
        return d >= 1 ? d : 1;
      }

      fire(F) {
        if (!this.ok) return;
        this.sync(F);
        this.fireOffs(F);
        if (this.clipOn) for (let p = 0; p < MAXP; p++) if (this.pSt[p] !== 0) this.firePlayer(p, F);
        this.fireArp(F);
        this.fireOns(F);
      }

      queue(k, a) {
        if (this.cqN >= MAXQ) return;
        this.cqK[this.cqN] = k; this.cqA[this.cqN] = a; this.cqN++;
      }
      runCmds(F) {
        this.wake(F);
        for (let i = 0; i < this.cqN; i++) {
          const a = this.cqA[i];
          switch (this.cqK[i]) {
            case 1: if (this.arpOn) this.arpLaunch(a, F); else if (a >= 0 && a < N_SLOTS) { this.arpCur = a; this.parF = -1; this.readParams(F); } break;
            case 2: this.arpStopCmd(a); break;
            case 3: if (this.clipOn && a >= 0 && a < N_SLOTS) this.clipLaunch(a, F, -1, 0, 1, 0, NaN, this.findPlayer(a)); break;
            case 4: for (let p = 0; p < MAXP; p++) if (this.pSt[p] !== 0 && this.pJ[p] === a) this.clipStopReq(p, F); break;
            case 5: for (let p = 0; p < MAXP; p++) if (this.pSt[p] !== 0) this.clipStopReq(p, F); break;
            default: break;
          }
        }
        this.cqN = 0;
      }
      cmd(name, arg) {
        const j = typeof arg === 'number' && arg >= 0 && arg < N_SLOTS ? arg | 0 : -1;
        switch (name) {
          case 'arpLaunch': if (j >= 0) this.queue(1, j); return true;
          case 'arpStop': if (j >= 0) this.queue(2, j); return true;
          case 'clipLaunch': if (j >= 0) this.queue(3, j); return true;
          case 'clipStop': if (j >= 0) this.queue(4, j); return true;
          case 'clipStopAll': this.queue(5, 0); return true;
          case 'latch': {                              // CC64 while the arp is on (§7.4.5)
            this.pedal = arg ? 1 : 0;
            const was = this.latch;
            this.latch = this.slotLatch || this.pedal ? 1 : 0;
            if (was && !this.latch) this.hDropLatched();
            return true;
          }
          default: this.warn(8, 'sx-seq: unknown command'); return false;
        }
      }

      transport(playing) {
        this.playing = playing ? 1 : 0;
        if (playing) this.tpSeek = 1; else this.tpStop = 1;
      }

      panic() {
        const F = this.lastF;
        for (let i = 0; i < 512; i++) { const T = this.fwdP[i]; if (T !== null) { T.extNote(F + EXT_DELAY, 0, i & 127, 0); this.fwdP[i] = null; } }
        this.rF.fill(0); this.heldN = 0;
        this.hN = 0; this.hDirty = 1; this.sUN = 0; this.nUN = 0;
        this.nOff = 0; this.nOn = 0; this.gC = 0;
        this.pSt.fill(0); this.pRs.fill(0); this.pStopU.fill(INF); this.kbN = 0;
        this.aRun = 0; this.aStop = 0; this.aPendJ = -1; this.aHold = 0; this.vRun = -1;
        this.pedal = 0; this.latch = this.slotLatch; this.cqN = 0;
        if (this.mac !== null) for (let k = 0; k < 8; k++) this.mac[k] = NaN;
      }

      snapshot(out) {
        if (!out || out.length < 16) return;
        const run = this.arpOn && this.aRun;
        out[0] = run ? this.arpCur : -1;
        out[1] = run ? (this.isPat() ? this.patPos() : this.aPos) : 0;
        out[2] = run ? this.aPass : 0;
        out[3] = this.arpOn ? this.hN : this.heldN;
        let mask = 0, rec = -1, selP = -1;
        const sel = this.clipG[3] | 0;
        for (let p = 0; p < MAXP; p++) {
          if (this.pSt[p] !== 2) continue;
          mask |= 1 << this.pJ[p];
          if (rec < 0 || this.pSer[p] > this.pSer[rec]) rec = p;
          if (this.pJ[p] === sel && (selP < 0 || this.pSer[p] > this.pSer[selP])) selP = p;
        }
        const u = mask ? this.uAt(this.lastF) : 0;
        out[4] = mask;
        out[5] = selP >= 0 ? this.pPosAt(selP, u) : -1;
        out[6] = rec >= 0 ? this.pJ[rec] : -1;
        out[7] = rec >= 0 ? this.pPosAt(rec, u) : -1;
        out[8] = this.ok ? this.beatAt(this.lastF) : 0;
        out[9] = this.tbPlay || this.playing ? 1 : 0;
        out[10] = this.latch;
        for (let i = 11; i < 16; i++) out[i] = 0;
      }
    }

    globalThis.SxSeq = Object.freeze({
      VER, N_SLOTS, MAX_EV, MAX_STRUM, MAX_NOTES, MAX_CLIP_NOTES, LANE_W, ARP_ROW, CLIP_ROW,
      SCALE_REL, LAUNCH_BEATS, TIME_BEATS, GRID_BEATS, RRATE_BEATS, CLIP_RATE_MUL, SWING_DIV, ARP_LAD,
      scaleMask, quantize, swingTime, Seq,
    });
  } catch (err) {
    globalThis.SxSeq = null;                                   // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('sx-seq: load failed', err);
  }
})();
