// MIDI input (SPEC-serum2 §0.2 role I2, §12.6; split out of main.js, B19): Web MIDI input, MPE zone routing and MIDI Learn
// dispatch. Two layers:
//  - a pure routing core (no DOM, no navigator, no storage, no state; node-testable): message decoding, the track targets of
//    an input, the MPE zone rules (§6.17, §12.4), MIDI Learn map edits and learned-controller writes (every learnable
//    destination: synth ids, macros, the virtual arp / clip destinations, static and dynamic FX ids, §3.11.3);
//  - `createMidi(host)`: the router (the Phase-1 main.js onMIDI dispatch, the pending learn) and a thin adapter over
//    navigator.requestMIDIAccess (the 'Enable MIDI' button). main.js implements the host and keeps the live input routing
//    shared with the on-screen and computer keyboards (held notes, recording, power, the wheels).
// Browser-module rule: nothing here touches the DOM, window or navigator at module top level.
import { midiValue, isFxId, VIRTUAL, S1_PAIRS, syncS1 } from './serum-core.js?v=7';

/* ======================================================== pure routing core */

export const LEARN_CCS = 120;        // controllers 0–119 can be learned and mapped; 120–127 are channel mode messages
export const LEARN_MS = 15000;       // a pending learn times out after 15 s …
export const LEARN_MS_OFF = 30000;   // … or 30 s while MIDI still needs enabling
export const MPE_MASTER = 1;         // MPE lower zone: channel 1 is the master channel, 2–16 are member channels (§6.17)
export const MPE_K = Object.freeze({ b: 0, y: 1, z: 2, x: 3 }); // proc.mpe[ch·4 + MPE_K[k]] in the worklet (§12.4)

// One MIDI message (MIDIMessageEvent.data: status byte + data bytes) → a decoded event, or null for anything this app
// ignores (system and real-time messages). ch = 1–16. Note-on with velocity 0 is a note-off without release velocity.
//   {k: 'on', ch, n, v}          note-on, v = velocity/127
//   {k: 'off', ch, n, rv?}       note-off; rv = release velocity/127 (absent for note-on velocity 0)
//   {k: 'pat', ch, n, v}         polyphonic key pressure /127
//   {k: 'cc', ch, cc, val}       control change, val 0–127 (raw: learned controllers map it through midiValue)
//   {k: 'bend', ch, v}           pitch bend −1…1 (14-bit centre 8192 → 0)
//   {k: 'at', ch, v}             channel pressure /127
//   {k: 'pc', ch, n}             program change
export function decode(data) {
  const st0 = data[0], d1 = data[1], d2 = data[2], cmd = st0 & 0xf0, ch = (st0 & 0x0f) + 1;
  if (cmd === 0x90 && d2 > 0) return { k: 'on', ch, n: d1, v: d2 / 127 };
  if (cmd === 0x80) return { k: 'off', ch, n: d1, rv: d2 / 127 };
  if (cmd === 0x90 && d2 === 0) return { k: 'off', ch, n: d1 };
  if (cmd === 0xa0) return { k: 'pat', ch, n: d1, v: d2 / 127 };
  if (cmd === 0xb0) return { k: 'cc', ch, cc: d1, val: d2 };
  if (cmd === 0xe0) return { k: 'bend', ch, v: ((d2 << 7) | d1) / 8192 - 1 };
  if (cmd === 0xd0) return { k: 'at', ch, v: d1 / 127 };
  if (cmd === 0xc0) return { k: 'pc', ch, n: d1 };
  return null;
}

// A track receives MPE (§6.17, §12.6): a Serum track whose state has global.mpe.on
export function isMpe(t) {
  const s = t && t.model === 'serum' && t.vals && t.vals.s, g = s && s.global;
  return !!(g && g.mpe && g.mpe.on);
}

// The tracks an input plays (Phase 1): src 0 = on-screen / computer keyboard → the selected track and the armed tracks;
// src 1–16 = MIDI channel → the tracks listening on that channel, plus the selected and armed tracks listening on Omni
// (ch 0); nobody → the selected track. MPE zone (§12.6): an MPE track listening on a channel receives every channel of
// its input (channel 1 master, 2–16 members); on Omni it follows the Phase-1 rule, which already passes every channel.
// The zone listens on every channel, so while such a track exists no channel falls back to the selected track (else an
// MPE controller's notes, which rotate over the member channels, would reach the selected track on the channels nobody
// else listens to and not on the others); program change and learned controllers follow the same targets.
export function targets(tracks, sel, src) {
  if (!src) return tracks.filter(t => t.id === sel || t.arm);
  const r = tracks.filter(t => t.ch === src || (t.ch === 0 && (t.id === sel || t.arm)) || (t.ch > 0 && isMpe(t)));
  return r.length ? r : tracks.filter(t => t.id === sel);
}

// The channel a live note to track t carries (§12.4): the MIDI channel src when the track receives MPE, else 0 (none).
// The engine releases a Serum voice by (note, channel), so a note-off must carry the channel its note-on carried even
// when MPE was switched (or a preset with another MPE setting loaded) while the key was down: the host keeps noteCh of
// the note-on with the held note and passes it to noteMsg for the note-off.
export function noteCh(t, src) { return src > 0 && isMpe(t) ? src : 0; }

// The worklet message of a live note for track t (§12.4 {t: 'on'|'off', n, v|rv, ch}): with ch (0 or a channel, as
// noteCh gave at note-on) or, without it, noteCh(t, src) now; ch 0 keeps the Phase-1 message (the same object)
export function noteMsg(t, m, src, ch) {
  const c = ch === undefined ? noteCh(t, src) : ch;
  return c > 0 ? { ...m, ch: c } : m;
}

// CC10 as MPE Expression X (§6.17): 0 → −1, 64 → 0, 127 → +1
export function exprX(cc) { return cc <= 64 ? (cc - 64) / 64 : (cc - 64) / 63; }

// The MPE expression a decoded event carries for MPE tracks, or null (§12.6): pitch bend on a member channel → 'b'
// (−1…1); CC74 → 'y' (/127); channel pressure on a member channel → 'z' (/127); CC10 on a member channel → 'x'
// (exprX). Channel 1 (master) bend and pressure stay the Phase-1 global bend / aftertouch; CC10 on channel 1 is not MPE.
export function mpeExpr(e) {
  if (!e) return null;
  const member = e.ch > MPE_MASTER;
  if (e.k === 'bend') return member ? { k: 'b', v: e.v } : null;
  if (e.k === 'at') return member ? { k: 'z', v: e.v } : null;
  if (e.k === 'cc') {
    if (e.cc === 74) return { k: 'y', v: e.val / 127 };
    if (e.cc === 10 && member) return { k: 'x', v: exprX(e.val) };
  }
  return null;
}

// MIDI Learn map edits, in place on a Serum state's `midi` ({cc: destination id}): one controller per destination
export function learnTo(map, cc, dest) {
  for (const k of Object.keys(map)) if (map[k] === dest) delete map[k];
  map[String(cc)] = dest;
  return map;
}
export function forgetIn(map, dest) {
  for (const k of Object.keys(map)) if (map[k] === dest) delete map[k];
  return map;
}

// The macro (0–7) a learn target addresses: the macro knobs ('macro1'…'macro8', source ids) and the macro destinations
// ('m1'…'m8', virtual: base = s.macros[m].v, §3.11.3); −1 otherwise
export function macroOf(dest) {
  const m = /^(?:macro|m)([1-8])$/.exec(dest);
  return m ? +m[1] - 1 : -1;
}

// The virtual sequencer destinations arp.* / clip.* (§3.11.3: never stored in s.p) written to Serum state s (in place),
// as their knobs write them: the selected arp slot's / clip's n[key] (s.arp.slots[sel].n, s.clip.clips[sel].n), every
// slot / clip under EDIT ALL; key = the id's suffix, except arp.rate: n.rate in BPM mode, n.hz in HZ mode (each slot by
// its own mode, §2.4.1 — the sequencer reads n.hz when bpm = 0); a write marks the bank modified (dirty = 1, the ' *'
// of the ARP / CLIP header). Returns false when dest is not one of them or nothing could be written.
export function seqWrite(s, dest, n) {
  if (VIRTUAL.indexOf(dest) < 0) return false;
  const q = /^(arp|clip)\.(\w+)$/.exec(dest), A = q && s ? s[q[1]] : null;
  const list = A && typeof A === 'object' ? (q[1] === 'arp' ? A.slots : A.clips) : null;
  if (!Array.isArray(list)) return false;
  const sel = A.sel | 0, rate = dest === 'arp.rate';
  let w = false;
  for (let j = 0; j < list.length; j++) {
    const it = list[j];
    if ((j === sel || A.editAll) && it && it.n && typeof it.n === 'object') { it.n[rate && !it.bpm ? 'hz' : q[2]] = n; w = true; }
  }
  if (w) A.dirty = 1;
  return w;
}

// A field of an S1 pair (§2.6.4: v1 or S2 side, including the phase-memory knobs a/b.phase, a/b.rand)
export function s1Paired(id) {
  for (const p of S1_PAIRS) if (p.v1.indexOf(id) >= 0 || p.s2.indexOf(id) >= 0) return true;
  return false;
}

// A learned controller's value val (0–127) written to Serum state s (in place, §8.1 midiValue; fx = the track's FX state,
// so that FX destinations — static and dynamic ids — are grid-exact for the instance they address, B26): macros
// ('macro1…8' and the virtual 'm1…m8') → s.macros[m].v; the virtual arp.* / clip.* → seqWrite; FX destinations (isFxId;
// except g.master / g.bypass, which live in s.p) → fxSet(id, n); the rest → s.p[id], followed for a field of an S1
// pair by syncS1 (§2.6.4: the counterpart kept consistent, as after a panel edit). Returns false (nothing written) for a
// destination midiValue does not know (with a v2 FX state: an FX id no instance of it has) or that has no place in s.
export function writeCC(s, dest, val, fxSet, fx) {
  const n = midiValue(dest, val, fx);
  if (n == null) return false;
  const m = macroOf(dest);
  if (m >= 0) {
    const M = s.macros && s.macros[m];
    if (!M || typeof M !== 'object') return false;
    M.v = n;
  } else if (VIRTUAL.indexOf(dest) >= 0) return seqWrite(s, dest, n);
  else if (isFxId(dest) && dest !== 'g.master' && dest !== 'g.bypass') fxSet(dest, n);
  else { s.p[dest] = n; if (s1Paired(dest)) syncS1(s, dest); }
  return true;
}

/* ============================================================ router + adapter */

// host (implemented by main.js):
//   targets(src) → tracks                     the tracks an input plays (main.js: `targets` above over the project)
//   noteOn(n, v, src, ts)                     live note-on / note-off (main.js: held notes, recording, power, key lights;
//   noteOff(n, src, ts, rv?)                    its messages go through noteMsg; a note-off with the noteCh of its note-on)
//   ctl(kind, v, src, ts, trs?)               'wheel' | 'sus' | 'bend' | 'at' to trs (default targets(src)), recorded
//   post(t, msg)                              a message to track t's worklet node
//   heldNotes(src) → note numbers             notes held from input src (All Notes Off / All Sound Off)
//   programChange(trs, n)                     MIDI program change (the preset browser's list, §9.10)
//   modUI(v), bendUI(v01)                     the on-screen wheels follow the controller (no callback)
//   track(id) → track | undefined, isSx(t)
//   fxSet(t, id, n)                           an FX destination's base value in track t's FX state
//   changed(t, patch, refresh)                a Serum state was edited by MIDI: dirty mark, (queue a patch), persist,
//                                               (repaint the panel), in this order
//   notice(text, ms)
//   button() → element                        the 'Enable MIDI' button (adapter)
//   nav                                       optional: the navigator (default globalThis.navigator, read lazily)
//   setTimeout, clearTimeout                  optional: timers (default the globals)
export function createMidi(host) {
  const H = host;
  let enabled = false;   // Web MIDI requested and granted (or being requested)
  let pending = null;    // the pending MIDI Learn { id: track id, dest, res, t: timeout }
  const later = (f, ms) => (H.setTimeout ? H.setTimeout(f, ms) : setTimeout(f, ms));
  const unlater = t => (H.clearTimeout ? H.clearTimeout(t) : clearTimeout(t));
  const navOf = () => ('nav' in H ? H.nav : globalThis.navigator);
  const onmidimessage = e => message(e.data, e.timeStamp);

  /* ---- MIDI Learn (§11.8): the next controller 0–119 is stored in s.midi; learned controllers write their destinations.
     A pending learn ends with the next controller, or is cancelled: Esc, a timeout (15 s, 30 s while MIDI still needs
     enabling), another learn, or the panel going away (track change, model change, another project) */
  function learn(id, dest) {
    cancelLearn(false);
    if (!enabled) H.notice('MIDI Learn: enable MIDI (the MIDI button by the keyboard), then move a controller — Esc cancels', 6000);
    else H.notice('MIDI Learn: move a controller — Esc cancels', 6000);
    return new Promise(res => { pending = { id, dest, res, t: later(() => cancelLearn(true), enabled ? LEARN_MS : LEARN_MS_OFF) }; });
  }
  function cancelLearn(say) {
    const P = pending;
    if (!P) return false;
    pending = null; unlater(P.t);
    P.res(null);
    if (say) H.notice('MIDI Learn cancelled', 3000);
    return true;
  }
  function learnCC(cc) {
    const P = pending;
    pending = null; unlater(P.t);
    const t = H.track(P.id);
    if (t && H.isSx(t)) { learnTo(t.vals.s.midi, cc, P.dest); H.changed(t, false, false); }
    P.res(t ? cc : null);
  }
  function forget(t, dest) {
    if (!H.isSx(t)) return;
    forgetIn(t.vals.s.midi, dest);
    H.changed(t, false, true);
  }
  // learned controllers of the targeted Serum tracks
  function mapCC(trs, cc, val) {
    for (const t of trs) {
      if (!H.isSx(t)) continue;
      const s = t.vals.s, dest = s.midi && s.midi[String(cc)];
      if (!dest) continue;
      if (!writeCC(s, dest, val, (id, n) => H.fxSet(t, id, n), t.fx)) continue;
      H.changed(t, true, true);
    }
  }

  // MPE expression (§6.17): sent as {t: 'mpe', ch, k, v} to the MPE tracks the channel targets, while the other targets
  // get the Phase-1 control `kind` (bend / at; null for CC74 / CC10, which only map learned controllers). Returns true
  // when it handled the event; false without MPE expression or MPE targets (then nothing happened: Phase-1 routing).
  function mpe(e, ts, kind, v) {
    const x = mpeExpr(e);
    if (!x) return false;
    const trs = H.targets(e.ch);
    if (!trs.some(isMpe)) return false;
    const rest = [];
    for (const t of trs) { if (isMpe(t)) H.post(t, { t: 'mpe', ch: e.ch, k: x.k, v: x.v }); else rest.push(t); }
    if (kind && rest.length) {
      H.ctl(kind, v, e.ch, ts, rest);
      if (kind === 'bend') H.bendUI((v + 1) / 2);
    }
    return true;
  }

  // CC120 / CC123 (Phase 1 §11.8: they keep their roles in the classic app): the notes held from channel ch are released;
  // on the MPE master channel of an MPE target (§12.6), the notes held from every channel of the zone
  function allOff(ch, ts) {
    const zone = ch === MPE_MASTER && H.targets(ch).some(isMpe);
    for (let c = zone ? 1 : ch; c <= (zone ? 16 : ch); c++) for (const n of H.heldNotes(c)) H.noteOff(n, c, ts);
  }

  // One MIDI message from an input (the Phase-1 onMIDI dispatch, in its order)
  function message(data, ts) {
    const e = decode(data);
    if (!e) return;
    const ch = e.ch;
    switch (e.k) {
      case 'on': H.noteOn(e.n, e.v, ch, ts); break;
      case 'off': if ('rv' in e) H.noteOff(e.n, ch, ts, e.rv); else H.noteOff(e.n, ch, ts); break;
      case 'pat': for (const t of H.targets(ch)) H.post(t, { t: 'pat', n: e.n, v: e.v }); break; // poly aftertouch
      case 'cc': {
        const cc = e.cc, val = e.val;
        if (cc < LEARN_CCS && pending) learnCC(cc); // Serum MIDI Learn takes the next controller 0–119 (§11.8)
        if (cc === 1) { H.ctl('wheel', val / 127, ch, ts); H.modUI(val / 127); }
        else if (cc === 64) H.ctl('sus', val >= 64 ? 1 : 0, ch, ts);
        else if (cc === 120 || cc === 123) allOff(ch, ts);
        else if (cc === 74 || cc === 10) mpe(e, ts, null, 0); // MPE Y / X (learned controllers below still apply)
        if (cc < LEARN_CCS) mapCC(H.targets(ch), cc, val);
        break;
      }
      case 'bend':
        if (mpe(e, ts, 'bend', e.v)) break; // a member channel's bend is the MPE tracks' per-note bend
        H.ctl('bend', e.v, ch, ts); H.bendUI((e.v + 1) / 2);
        break;
      case 'at': if (!mpe(e, ts, 'at', e.v)) H.ctl('at', e.v, ch, ts); break;
      case 'pc': H.programChange(H.targets(ch), e.n); break;
    }
  }

  /* ---- Web MIDI adapter. Access is only requested from the 'Enable MIDI' button (a permission prompt — in Firefox an
     add-on install dialog — should never be a side effect of Power); it connects by itself only when permission was
     already granted. */
  async function enable() {
    const b = H.button(), nav = navOf();
    if (!nav || !nav.requestMIDIAccess) { b.textContent = 'MIDI: not supported in this browser'; b.disabled = true; b.classList.add('unsup'); return; }
    if (enabled) return;
    enabled = true;
    b.textContent = 'MIDI: connecting…';
    try {
      const m = await nav.requestMIDIAccess();
      const hook = () => {
        const names = [];
        for (const inp of m.inputs.values()) { inp.onmidimessage = onmidimessage; names.push(inp.name); }
        b.textContent = names.length ? 'MIDI: ' + names.join(', ') : 'MIDI: no devices';
        b.title = names.length ? 'Connected MIDI inputs' : 'Plug in a MIDI controller — it is picked up automatically';
      };
      hook(); m.onstatechange = hook;
    } catch {
      enabled = false; // allow another try
      b.textContent = 'MIDI blocked — click to retry';
      b.title = 'If no prompt appears, allow MIDI for this site in the browser’s site settings';
    }
  }
  function wire() {
    const b = H.button(), nav = navOf();
    if (!nav || !nav.requestMIDIAccess) { enable(); return; }
    b.onclick = () => enable();
    try {
      if (nav.permissions && nav.permissions.query) {
        nav.permissions.query({ name: 'midi' }).then(s => {
          if (s.state === 'granted') enable();
          s.onchange = () => { if (s.state === 'granted') enable(); };
        }).catch(() => {});
      }
    } catch { /* 'midi' permission name unsupported */ }
  }

  return {
    message, onmidimessage, enable, wire,
    learn, cancelLearn, forget, mapCC,
    get enabled() { return enabled; },
    get learning() { return pending ? { id: pending.id, dest: pending.dest } : null; },
  };
}
