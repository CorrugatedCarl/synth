/*
 * dr-seq.js — the drum machines' step sequencer in the audio thread (IMPL-7a §3.5; lane S). Classic script: one IIFE
 * publishing the frozen `globalThis.DrSeq` (null on a load failure); reads no other script's global. It clocks a plan
 * compiled on the main thread by drum-core.js compilePlan (§3.4) and embeds identical copies of the constants it needs
 * (STEP_T, SPB, SWUNG, BEAT, LANE_SOUND, MAX_MEAS, MAX_STEPS, swingTicks, the default note map: compared by
 * tests/drum-core.test.mjs).
 *
 * DrSeq.create(inst) → the Inst's `sq` (the TB-303's field and duck type, so Track.process's `q.run || q.sync` gate and its
 * `q.pos += len` need no change). Fields the Track reads / writes: run (free: running from START; the Track clears it on
 * panic / retire / end), sync, pos (free: frames since START, advanced by the Track after each span), syncStep (null =
 * re-anchor: the Track writes it at power on). Methods:
 *   set(s)          the drum {t:'seq'} payload (§3.5): { plan, sync, run, bpm, swing, at, tap, map, prim, mute, smp } (any
 *                   subset; an invalid plan is ignored with one warning). Kept for the Inst: map (Int8Array(128) note →
 *                   sound, DEF_MAP until one arrives), prim (Int8Array(16) the primaries), mute (16-bit), smp (as sent)
 *   events(F)       fires the steps due at the span start F; returns frames to the next one (≥ 1; 1e9: none)
 *   transport(play) the Inst's transportHook (synced: a start / seek re-anchors at tick 0, a stop silences)
 *   release()       power off / bye: the gate of #34 off, re-anchor at the next run
 * Inst fields read (lazily): tp {play, frame, tick, fpt} (synced), base (sample rate), T.fresh (at transport(true)),
 * T.graphed / id (the post's i), port.postMessage, dm.trig(mask) (the machine, §1.2: latched), p.drum.lts / mts / hts / rss
 * / cps (the switches: a step's lastNote) and the optional hook drStep(n, v) (§15 #34: a step with sounds behaves as a note
 * — the Inst calls rack.trigger(), sets lastNote = n and gates ModCore with velocity v (1 accented, 100 / 127 else); n = the
 * lowest primary note of the step's sounds, −1 when none is mapped; drStep(−1, 0) = the gate off at a stop / release).
 *
 * Timing (D5): a step is due when tickAt(F) ≥ its tick and the distance is (tick − tickAt(F)) · fpt — songEvents'
 * expressions for a note —, so a step and the same note (drum-core toNotes) fire at the same span start. Synced, the plan
 * is anchored at song tick 0 (a step's position is a function of the song position); a start, a seek, a power on and any
 * jump back of the song position (a loop wrap calls no transportHook) re-anchor there, the steps at the transport's anchor
 * tick still due (songEvents' rule: an anchor within 4 frames, or a fresh start up to 0.25 s late). Free, the clock runs at
 * `bpm` from START (pos 0 = tick 0); a tempo change rebases it (no jump). Swing: the odd step of each pair of a 16th /
 * 32nd measure starts swingTicks(swing, stepT) whole ticks late (§3.5; 50 % = none, bit-identical).
 * Plan changes (§3.5): at 'now' with the same shape (n, intro, loopFrom, mPre, mL1, mOff) the steps are replaced in place,
 * position kept; any other change waits for the next measure boundary B and starts there from the plan's loopFrom (the
 * intro plays only from a start), the measure count continuing; 'beat2' (MANUAL PLAY's quirk) swaps at the current
 * measure's second beat — the new plan's measure entered at its own beat-2 step — when that point is still ahead and the
 * new measure is longer than a beat, else at B. A 'now' plan while one is pending replaces the pending one (it carries the
 * newer edit); a plan equal to the playing one (same key) cancels a pending swap; a stopped, idle or re-anchoring machine
 * takes a plan at once. TAP fills (§3.4, §15 #8): each increment of `tap` while running requests one fill: at the next
 * boundary the plan's `fill` plays instead of the cycle's next measure, then the cycle resumes where it was (nothing
 * advances); a loop wrap keeps a request (the fill at the measure start it lands on, else the next boundary); a seek / stop
 * drops it.
 * Posts {t:'step', s, m, k, v, p, o, M, f, F, i?} at every step: s step in the measure, m measure index in the plan (−1 in
 * a TAP fill), k key (−1 a silent PLAY hole), v variation, p part, o ticks into the measure, M measures since the anchor at
 * tick 0 / START (COMPOSE's index), f 1 in a TAP fill, F the frame (heard time on the main thread).
 * Allocation-free in events() but for the post literal (as the TB-303's seqFire); set() allocates nothing either.
 */
(function () {
  'use strict';
  try {
    const VER = 1;
    const BEAT = 960;                                     // ticks a beat (960 PPQ)
    const STEP_T = Object.freeze([0, 320, 160, 240, 120]); // PRE-SCALE 1–4 → step ticks (= drum-core)
    const SPB = Object.freeze([0, 3, 6, 4, 8]);           // steps per beat
    const SWUNG = Object.freeze([0, 0, 0, 1, 1]);         // 16ths / 32nds swing, triplets do not
    const MAX_MEAS = 769, MAX_STEPS = 24576;              // a plan's bounds
    const LANE_SOUND = Object.freeze([[-1, -1], [0, 0], [1, 1], [2, 11], [3, 12], [4, 13], [5, 14], [6, 15], [7, 7], [8, 8], [9, 9], [10, 10]]
      .map(e => Object.freeze(e)));
    const LANE_SW = Object.freeze(['', '', '', 'lts', 'mts', 'hts', 'rss', 'cps', '', '', '', '']);
    const swingTicks = (pct, T) => Math.round((2 * pct - 100) * T / 100);
    // the GM-based default map (§4.1, = drum-core mapTable(DEFAULT_MAP) / primaries(DEFAULT_MAP))
    const DEF_PAIRS = [[36, 0], [35, 0], [38, 1], [40, 1], [41, 2], [43, 2], [45, 3], [47, 3], [48, 4], [50, 4], [37, 5], [39, 6],
      [56, 7], [49, 8], [57, 8], [46, 9], [42, 10], [44, 10], [64, 11], [63, 12], [62, 13], [75, 14], [70, 15]];
    const DEF_MAP = new Int8Array(128).fill(-1);
    for (const [n, s] of DEF_PAIRS) DEF_MAP[n] = s;
    const DEF_PRIM = new Int8Array([36, 38, 41, 45, 48, 37, 39, 56, 49, 46, 42, 64, 63, 62, 75, 70]);
    Object.freeze(DEF_PAIRS);
    const INF = Infinity, V_LO = 100 / 127;
    const fin = x => typeof x === 'number' && x - x === 0;
    const len = a => (a && typeof a.length === 'number' ? a.length : -1);

    // a plan as compilePlan makes it, checked without allocating (the audio thread never trusts a payload's shape)
    function valid(p) {
      if (!p || typeof p !== 'object' || typeof p.key !== 'string') return false;
      const n = p.n, lf = p.loopFrom;
      if (!(fin(n) && n === Math.floor(n) && n >= 0 && n <= MAX_MEAS)) return false;
      if (!(n === 0 || (fin(lf) && lf === Math.floor(lf) && lf >= 0 && lf < n))) return false;
      const K = p.mKey, Vr = p.mVar, P = p.mPre, L = p.mL1, O = p.mOff, T = p.mT, st = p.st;
      if (len(K) < n || len(Vr) < n || len(P) < n || len(L) < n || len(O) < n + 1 || len(T) < n + 1) return false;
      if (O[0] !== 0 || T[0] !== 0) return false;
      for (let i = 0; i < n; i++) {
        const d = O[i + 1] - O[i], pre = P[i];
        if (!(d >= 1 && d <= 32 && pre >= 1 && pre <= 4 && pre === Math.floor(pre) && L[i] >= 1 && L[i] <= d)) return false;
        if (T[i + 1] - T[i] !== d * STEP_T[pre]) return false;
      }
      if (O[n] > MAX_STEPS || len(st) < O[n]) return false;
      const f = p.fill;
      if (f != null) {
        if (typeof f !== 'object' || !(f.pre >= 1 && f.pre <= 4 && f.pre === Math.floor(f.pre))) return false;
        if (!(f.l1 >= 1 && f.l1 <= 16 && f.l2 >= 0 && f.l2 <= 16 && len(f.st) >= f.l1 + f.l2)) return false;
      }
      return true;
    }
    function sameShape(a, b) {
      if (a.n !== b.n || a.loopFrom !== b.loopFrom || (a.intro | 0) !== (b.intro | 0)) return false;
      for (let i = 0; i < a.n; i++) if (a.mPre[i] !== b.mPre[i] || a.mL1[i] !== b.mL1[i] || a.mOff[i + 1] !== b.mOff[i + 1]) return false;
      return true;
    }

    class Seq {
      constructor(inst) {
        this.inst = inst;
        this.run = false; this.sync = false; this.pos = 0; this.syncStep = null; // (the Track's fields, §1.1)
        this.pl = null;                                   // the plan playing
        this.nx = null; this.nxAt = 0;                    // the pending plan: 1 at the next boundary, 2 at beat 2
        this.sw = 50;                                     // swing, %
        this.bpm = 120; this.fT = 0; this.fP = 0; this.ffpt = this.fptOf(120); // free clock: tick fT at pos fP
        this.map = new Int8Array(DEF_MAP); this.prim = new Int8Array(DEF_PRIM); this.mute = 0; this.smp = null;
        this.tapN = null; this.tapReq = 0;
        this.fresh = 0; this.lastT = NaN; this.gate = 0; this.warned = 0;
        // the cursor: the next step to fire — measure cm of pl (or the TAP fill fl, resuming at rm), step cs at tick ct;
        // the measure starts at tick c0, has cn steps of cT ticks (pre cp, 1st part cl1, swing offset cw, steps from cOff),
        // count cM; lf the tick of the last step fired
        this.cm = 0; this.cs = 0; this.ct = INF; this.c0 = 0; this.cn = 0; this.cT = 240; this.cp = 3; this.cl1 = 16;
        this.cw = 0; this.cOff = 0; this.cM = 0; this.fl = null; this.rm = 0; this.lf = -INF;
      }
      get base() { const b = this.inst && this.inst.base; return b > 0 ? b : typeof sampleRate === 'number' ? sampleRate : 48000; }
      fptOf(bpm) { return this.base * 60 / (Math.min(400, Math.max(20, bpm)) * BEAT); }
      runningNow() { if (this.sync) { const tp = this.inst && this.inst.tp; return !!(tp && tp.play); } return this.run; }

      /* ---- the payload ---- */
      set(s) {
        if (!s || typeof s !== 'object') return;
        if (len(s.map) === 128) for (let i = 0; i < 128; i++) { const v = s.map[i]; this.map[i] = v >= 0 && v <= 15 ? v : -1; }
        if (len(s.prim) === 16) for (let i = 0; i < 16; i++) { const v = s.prim[i]; this.prim[i] = v >= 0 && v <= 127 ? v : -1; }
        if (fin(s.mute)) this.mute = s.mute & 0xFFFF;
        if ('smp' in s) this.smp = s.smp || null;
        const wasRun = this.run, wasSync = this.sync;
        if ('sync' in s) this.sync = !!s.sync;
        if ('run' in s) this.run = !!s.run;
        if (fin(s.bpm) && s.bpm !== this.bpm) { // free clock: rebased, no jump
          this.fT += (this.pos - this.fP) / this.ffpt; this.fP = this.pos;
          this.bpm = s.bpm; this.ffpt = this.fptOf(s.bpm);
        }
        if (this.sync !== wasSync) { this.gateOff(); this.syncStep = null; this.lastT = NaN; this.tapReq = 0; }
        if (!this.sync && this.run && (!wasRun || wasSync)) { // free START: step 1 of measure 1, at the knob's tempo
          this.pos = 0; this.fT = 0; this.fP = 0; this.syncStep = null; this.lastT = NaN; this.tapReq = 0;
        }
        if (!this.sync && !this.run && wasRun) this.gateOff();
        if (fin(s.swing)) {
          const w = Math.min(75, Math.max(50, Math.round(s.swing)));
          if (w !== this.sw) { this.sw = w; this.cw = SWUNG[this.cp] ? swingTicks(w, this.cT) : 0; if (this.cs < this.cn && this.ct !== INF) this.ct = this.tickOf(this.cs); }
        }
        if (s.plan !== undefined) this.take(s.plan, s.at);
        if (fin(s.tap)) { // TAP fills: one per increment while running
          if (this.tapN !== null && s.tap !== this.tapN && this.runningNow()) this.tapReq = 1;
          this.tapN = s.tap;
        }
      }
      take(p, at) {
        if (!valid(p)) { this.warn(1, 'dr-seq: invalid plan ignored'); return; }
        const pl = this.pl;
        if (!pl || pl.n === 0 || !this.runningNow() || this.syncStep === null) { // idle / stopped / re-anchoring: at once
          this.pl = p; this.nx = null; this.nxAt = 0; this.syncStep = null; return;
        }
        if (p.key === pl.key) { this.nx = null; this.nxAt = 0; return; } // (the playing plan: a pending swap is cancelled)
        if (at === 'now' || at == null) {
          if (this.nx !== null) { this.nx = p; return; }
          if (sameShape(p, pl)) { this.pl = p; return; }  // in place: the cursor's indices stay valid
          this.nx = p; this.nxAt = 1; return;
        }
        this.nx = p; this.nxAt = at === 'beat2' ? 2 : 1;
      }
      warn(b, m) { if (this.warned & b) return; this.warned |= b; if (typeof console !== 'undefined') console.warn(m); }

      /* ---- transport / power ---- */
      transport(play) {
        if (!this.sync) return;                           // (a free machine is untouched by the transport)
        this.gateOff(); this.syncStep = null; this.lastT = NaN; this.tapReq = 0;
        const T = this.inst && this.inst.T;
        this.fresh = play && T && T.fresh ? 1 : 0;
      }
      release() { this.gateOff(); this.syncStep = null; this.lastT = NaN; this.tapReq = 0; }
      gateOff() { if (this.gate) { this.gate = 0; const I = this.inst; if (I && typeof I.drStep === 'function') I.drStep(-1, 0); } }

      /* ---- the cursor ---- */
      tickOf(s) { return this.c0 + s * this.cT + (s & 1 ? this.cw : 0); }
      geo() { // the current measure's geometry (a plan measure or the TAP fill)
        const f = this.fl;
        if (f !== null) { this.cn = f.l1 + f.l2; this.cp = f.pre; this.cl1 = f.l1; this.cOff = 0; }
        else { const p = this.pl, m = this.cm; this.cn = p.mOff[m + 1] - p.mOff[m]; this.cp = p.mPre[m]; this.cl1 = p.mL1[m]; this.cOff = p.mOff[m]; }
        this.cT = STEP_T[this.cp]; this.cw = SWUNG[this.cp] ? swingTicks(this.sw, this.cT) : 0;
      }
      // re-anchor: the plan anchored at tick 0 (sync) / START (free); the cursor at the first step at or after t0. wrap: a
      // loop wrap keeps a TAP request — one pending, or a fill taken at the boundary the wrap replaced (none of its steps
      // played: a fill cut by the wrap is not replayed) — and plays it at the measure start the cursor lands on, else at
      // the next boundary (review 2 #1); any other re-anchor (start, seek, power on) drops it
      locate(t0, wrap) {
        if (this.nx !== null) { this.pl = this.nx; this.nx = null; this.nxAt = 0; } // (a discontinuity: the pending plan now)
        const tap = wrap && (this.tapReq || (this.fl !== null && this.lf < this.c0)) ? 1 : 0;
        this.fl = null; this.tapReq = tap; this.lf = -INF;
        const p = this.pl;
        if (!p || p.n === 0) { this.ct = INF; this.cn = 0; return; }
        const T = p.mT, n = p.n, lf = p.loopFrom, cyc = T[n] - T[lf], t = t0 > 0 ? t0 : 0;
        let off = 0, j = 0;
        if (t >= T[n]) { j = 1 + Math.floor((t - T[n]) / cyc); off = j * cyc; }
        let lo = j ? lf : 0, hi = n - 1;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T[m] + off <= t) lo = m; else hi = m - 1; }
        this.cm = lo; this.c0 = T[lo] + off; this.cM = j === 0 ? lo : n + (j - 1) * (n - lf) + (lo - lf);
        this.geo();
        let s = Math.floor((t0 - this.c0) / this.cT);
        if (s < 0) s = 0;
        if (this.tickOf(s) < t0) s++;
        if (s === 0 && this.tapReq && p.fill) { this.tapReq = 0; this.rm = this.cm; this.fl = p.fill; this.geo(); } // (boundary()'s rule)
        if (s < this.cn) { this.cs = s; this.ct = this.tickOf(s); } else this.boundary();
      }
      // the end of the current measure: a pending plan (from its loopFrom), a fill's resume, or the cycle's next measure;
      // then a requested TAP fill instead of it
      boundary() {
        const B = this.c0 + this.cn * this.cT, p0 = this.pl;
        this.cM++;
        if (this.nx !== null) { this.pl = this.nx; this.nx = null; this.nxAt = 0; this.fl = null; this.cm = this.pl.loopFrom; }
        else if (this.fl !== null) { this.fl = null; this.cm = this.rm; }
        else this.cm = this.cm + 1 < p0.n ? this.cm + 1 : p0.loopFrom;
        const p = this.pl;
        if (p.n === 0) { this.ct = INF; this.cn = 0; this.c0 = B; return; }
        if (this.tapReq && p.fill) { this.tapReq = 0; this.rm = this.cm; this.fl = p.fill; }
        this.c0 = B; this.cs = 0; this.geo(); this.ct = B;
      }
      // MANUAL PLAY's quirk: at the first step at / after beat 2 of the measure (none fired there yet), the pending plan's
      // loopFrom measure takes over from its own beat-2 step (same measure start); a new measure of a beat or less: at B
      beat2() {
        const b2 = this.c0 + BEAT;
        if (this.lf >= b2) { this.nxAt = 1; return; }     // (beat 2 already played: the next boundary)
        if (this.ct < b2) return;
        const q = this.nx, m = q.loopFrom, d = q.mOff[m + 1] - q.mOff[m], s = SPB[q.mPre[m]];
        if (s >= d) { this.nxAt = 1; return; }
        this.pl = q; this.nx = null; this.nxAt = 0; this.fl = null; this.cm = m; this.geo();
        this.cs = s; this.ct = this.tickOf(s);            // (= b2: beat-2 steps are even or unswung)
      }
      fire(F) {
        const I = this.inst, f = this.fl, s = this.cs;
        const mask = f !== null ? f.st[s] & 0xFFF : this.pl.st[this.cOff + s] & 0xFFF;
        const k = f !== null ? f.k : this.pl.mKey[this.cm], v = f !== null ? f.v : this.pl.mVar[this.cm];
        this.lf = this.ct;
        if (mask & 0xFFE) {
          const dm = I.dm;
          if (dm) dm.trig(mask);
          if (typeof I.drStep === 'function') { // §15 #34: lastNote = the lowest primary of the step's sounds
            const D = I.p && I.p.drum;
            let n = 128;
            for (let l = 1; l < 12; l++) {
              if (!(mask & (1 << l))) continue;
              const q = this.prim[LANE_SOUND[l][D && LANE_SW[l] && D[LANE_SW[l]] ? 1 : 0]];
              if (q >= 0 && q < n) n = q;
            }
            this.gate = 1;
            I.drStep(n < 128 ? n : -1, mask & 1 ? 1 : V_LO);
          }
        }
        const T = I.T, o = this.ct - this.c0, p = s < this.cl1 ? 0 : 1, m = f !== null ? -1 : this.cm, fl = f !== null ? 1 : 0;
        if (I.port) I.port.postMessage(T && T.graphed === 1
          ? { t: 'step', s, m, k, v, p, o, M: this.cM, f: fl, F, i: I.id }
          : { t: 'step', s, m, k, v, p, o, M: this.cM, f: fl, F });
      }

      /* ---- the clock (Track.process: after songEvents, with the span start F) ---- */
      events(F) {
        const I = this.inst;
        let t, fpt;
        if (this.sync) {
          const tp = I && I.tp;
          if (!tp || !tp.play) { this.gateOff(); return 1e9; }
          fpt = tp.fpt; t = tp.tick + (F - tp.frame) / fpt;
          if (this.syncStep === null || t < this.lastT - 0.5) { // a start / seek / power on / loop wrap: anchored at tick 0
            let t0 = t;
            if (tp.tick < t && (tp.frame >= F - 4 - 1e-6 || (this.fresh === 1 && F - tp.frame <= 0.25 * this.base))) t0 = tp.tick;
            this.locate(t0, this.syncStep !== null); this.syncStep = 0; this.fresh = 0; // (syncStep kept: a wrap — no transportHook)
          }
        } else {
          if (!this.run) return 1e9;
          fpt = this.ffpt; t = this.fT + (this.pos - this.fP) / fpt;
          if (this.syncStep === null) { this.locate(t); this.syncStep = 0; }
        }
        if (this.pl === null) { this.lastT = t; return 1e9; }
        while (this.ct <= t) {
          if (this.nxAt === 2) this.beat2();
          if (this.ct > t) break;                         // (beat 2's entry step is never later; kept for safety)
          this.fire(F);
          this.syncStep++;
          if (++this.cs < this.cn) this.ct = this.tickOf(this.cs); else this.boundary();
        }
        this.lastT = t;
        return this.ct === INF ? 1e9 : Math.max(1, (this.ct - t) * fpt);
      }
    }

    // a one-measure plan of masks at a pre-scale (the engine's warm-up, tests): what compilePlan makes for a write mode
    function simplePlan(masks, pre) {
      const n = Math.max(1, Math.min(32, masks.length | 0)), p = pre >= 1 && pre <= 4 ? pre | 0 : 3, st = new Uint16Array(n);
      for (let i = 0; i < n; i++) st[i] = masks[i] & 0xFFF;
      let key = 'w' + p;
      for (let i = 0; i < n; i++) key += '.' + st[i];
      return { key, shape: 's' + p + '.' + n, n: 1, intro: 0, loopFrom: 0, mKey: new Int8Array([0]), mVar: new Int8Array([0]),
        mPre: new Uint8Array([p]), mL1: new Uint8Array([Math.min(16, n)]), mOff: new Int32Array([0, n]), mT: new Int32Array([0, n * STEP_T[p]]),
        st, fill: null };
    }

    globalThis.DrSeq = Object.freeze({
      VER, BEAT, STEP_T, SPB, SWUNG, MAX_MEAS, MAX_STEPS, LANE_SOUND, LANE_SW, DEF_MAP, DEF_PRIM,
      swingTicks, valid, sameShape, simplePlan, Seq,
      create: inst => new Seq(inst),
    });
  } catch (err) {
    globalThis.DrSeq = null;                              // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('dr-seq: load failed', err);
  }
})();
