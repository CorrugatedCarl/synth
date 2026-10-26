import './v8-guard.mjs';
// Tap tempo (the user, 2026-10-26: "we need a tap button for tapping in the tempo"): the header's TAP (#tTap, joined to the BPM
// field; ≤ 900 px ⋯'s #tTapM) in the page simulation with the real engine. From the 2nd tap the tempo is 60 / the mean of the
// last ≤ 8 intervals, a whole BPM, 20–300, through the tempo box's path (setProjectBpm: the field, a playing song re-anchored);
// a gap ≥ 2 s or an interval > 2× the running mean starts a new sequence; one History step "Tempo" a sequence, its own (Ctrl+Z:
// the tempo before it). The header's room for it is checked as text here; the widths themselves in a browser (the review's
// Chrome for Testing sweep: the track chip and dots never narrower than before TAP, at 375–1920 px, 1–8 tracks).
// It acts on pointerdown (its click is no second tap; a keyboard / assistive click — detail 0 — is one), on Enter, and on
// Space when focused from the keyboard; no letter shortcut (KeyT plays a note); a two-finger gesture landing on it takes its
// tap back. The taps' clock is the events' timeStamp (ms). One boot; strings, numbers and booleans only into assert (never a
// stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/tap-tempo-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as S from '../song.js?v=9';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8'), CSS = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const sim = await bootMain({ ls: fakeStorage({}), hash: '#minimoog', clock: 'std' });
const api = sim.api, cv = globalThis.__synthTest.cv;
await sim.power(); await sim.settle(10); sim.raf();
sim.$('#modal').hidden = true;
const P = () => api.project(), B = () => sim.$('#tTap'), bpm = () => P().bpm, field = () => +sim.$('#tBpm').value;
const steps = () => cv.hist.u.length;
// a fresh sequence's first tap: 10 s past the last tap (whatever came before)
let LAST = 1e5;
const fresh = () => LAST + 10000;
const ev = (type, o) => Object.assign({ type, target: B(), currentTarget: B(), defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }, o);
// one press at time ts (a mouse by default): its pointerdown event (defaultPrevented read back)
const tap = (ts, o = {}) => { LAST = Math.max(LAST, ts); const e = ev('pointerdown', Object.assign({ timeStamp: ts, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }, o)); B().dispatchEvent(e); return e; };
// taps from t0, then one after each interval in dts; the last tap's time
const taps = (t0, ...dts) => { let t = t0; tap(t); for (const d of dts) tap(t += d); return t; };
// the tempo v after an edit of its own (a History step, then a change: the top step never already holds the state a tap
// sequence starts from — as after any real edit; the BPM field alone records none)
let edits = 0;
const at = v => { cv.hist.record(P(), 'Edit'); P().name = 'tap ' + (++edits); cv.setProjectBpm(v); assert.equal(bpm(), v); };
const undoKey = () => { sim.key('KeyZ', true, { key: 'z', ctrlKey: true }); sim.key('KeyZ', false, { key: 'z', ctrlKey: true }); };
const redoKey = () => { sim.key('KeyZ', true, { key: 'z', ctrlKey: true, shiftKey: true }); sim.key('KeyZ', false, { key: 'z', ctrlKey: true, shiftKey: true }); };
const key = (k, ts, o = {}) => { LAST = Math.max(LAST, ts); const e = ev('keydown', Object.assign({ key: k, code: k === ' ' ? 'Space' : k, timeStamp: ts, repeat: false }, o)); B().dispatchEvent(e); return e; };

// a @media (max-width: N px) block of style.css, as text (the first one of that width)
const mq = w => { const i = CSS.indexOf(`@media (max-width: ${w}px) {`); assert.ok(i >= 0, w + ' px stage'); return CSS.slice(i, CSS.indexOf('\n}', i)); };
// the max-width of the media block each line of style.css sits in (a one-line block: its own; Infinity: none)
const widthOf = (() => { let w = Infinity; return CSS.split('\n').map(l => { const m = /^@media \(max-width: (\d+)px\) \{(.*)$/.exec(l); if (m && !m[2].trim()) { w = +m[1]; return { l, w }; } const r = { l, w: m ? +m[1] : w }; if (l === '}') w = Infinity; return r; }); })();

test('TAP in the header: once, in #transport joined to the BPM field (.cv-tempo: BPM, then TAP — one box under its label), a .tt button with an accessible name, the perf touch zone, no double-tap zoom; only at ≤ 900 px, where the row has no room, it folds into ⋯ (#tTapM, the same taps)', () => {
  const tag = (/<button id="tTap"[^>]*>/.exec(HTML) || [''])[0], i = HTML.indexOf('id="tTap"'), w = HTML.indexOf('<div class="cv-tempo">');
  assert.equal((HTML.match(/\sid="tTap"/g) || []).length, 1, 'once');
  assert.match(tag, /\sclass="tt cv-tap"/); assert.match(tag, /\stype="button"/);
  assert.match(tag, /\saria-label="Tap tempo"/); assert.match(tag, /\stitle="[^"]+"/);
  assert.match(tag, /\sdata-gesture="perf"/, 'a performance control: a key pressed by the other hand never pairs with it (gesture.js)');
  assert.deepEqual([w > HTML.indexOf('id="transport"'), HTML.indexOf('id="tBpm"') > w, i > HTML.indexOf('id="tBpm"'), HTML.indexOf('</div>', w) > i, i < HTML.indexOf('id="tMore"'), i < HTML.indexOf('id="tMorePop"')],
    [true, true, true, true, true, true], 'in .cv-tempo after the BPM field, outside the ⋯ fold');
  // the folded twin: in ⋯ (#tMorePop) first, shown there at ≤ 900 px only
  const tagM = (/<button id="tTapM"[^>]*>/.exec(HTML) || [''])[0], j = HTML.indexOf('id="tTapM"');
  assert.equal((HTML.match(/\sid="tTapM"/g) || []).length, 1, 'once');
  assert.match(tagM, /\sclass="tt cv-tapm"/); assert.match(tagM, /\stype="button"/); assert.match(tagM, /\saria-label="Tap tempo"/); assert.match(tagM, /\sdata-gesture="perf"/);
  assert.deepEqual([j > HTML.indexOf('id="tMorePop"'), j < HTML.indexOf('id="tSigN"'), j < HTML.indexOf('id="tUndo"')], [true, true, true], 'the first item of ⋯');
  assert.match(CSS, /\.cv-tap\s*\{[^}]*touch-action:\s*manipulation/, 'quick taps never zoom the page (touch-action: manipulation)');
  assert.match(CSS, /\.cv-tapm\s*\{[^}]*touch-action:\s*manipulation/);
  assert.match(CSS, /\n\.cv-tapm \{ display: none;/, 'the twin: hidden but at ≤ 900 px');
  assert.match(mq(900), /\.cv-tap \{ display: none; \} \.cv-tx \.cv-tapm \{ display: flex;/, '≤ 900 px: TAP in ⋯');
  const hides = widthOf.filter(x => /cv-tap\b|tTap\b/.test(x.l) && /display:\s*none|visibility:\s*hidden/.test(x.l));
  assert.deepEqual(hides.map(x => x.w), [900], 'no other rule hides it');
});

test('the room for TAP: never the position readout (shown from 801 px up, as before) nor the track chip — TAP is as tall as the field it joins and the row\'s spacing pays for it (the transport\'s gaps 4 px, the row\'s 8 / 6 px, ⋯\'s group 4 px, the ≡ button without its ▾, the BPM box 56 px)', () => {
  const tpos = widthOf.filter(x => /\.tpos\b/.test(x.l) && /display:\s*none/.test(x.l));
  assert.ok(tpos.length >= 1);
  assert.deepEqual(tpos.filter(x => !(x.w <= 800)).map(x => x.l.trim()), [], 'no rule wider than 800 px hides the readout (iPad Air / Pro 11" portrait: 820 / 834 px)');
  assert.match(CSS, /\n\.cv-tempo \{ display: flex; align-items: flex-end; \}/, 'BPM and TAP: one row, TAP level with the number');
  assert.match(CSS, /\n\.cv-tempo #tBpm \{ width: 56px; padding: 3px 5px; border-radius: 6px 0 0 6px; \}/, '"128.25" (a drum machine\'s FINE) still fits');
  assert.match(CSS, /\n\.cv-tap \{[^}]*height: 24px; margin-left: -1px;[^}]*border-radius: 0 6px 6px 0;/, 'joined: no gap, one border between');
  assert.match(CSS, /\n\.cv-transport \{[^}]*gap: 4px;/);
  assert.match(CSS, /\n\.cv-row \{[^}]*gap: 8px;/);
  assert.match(mq(1499), /\.cv-row \{ gap: 6px; \}/);
  assert.match(CSS, /\n\.cv-tx \{ display: flex; align-items: center; gap: 4px; \}/);
  assert.match(CSS, /\n\.cv-brand \.cv-caret \{ display: none; \}/);
  assert.match(mq(900), /\.cv-tempo #tBpm \{ width: 50px; padding: 3px 6px; border-radius: 6px; \}/, '≤ 900 px: the BPM field as it was (TAP in ⋯)');
});

test('4 taps 500 ms apart → 120 BPM, set from the 2nd tap (the BPM field shows it); the press is taken (preventDefault) and flashes — each tap restarts the flash (its class alternates: a new animation-name) without forcing a layout', () => {
  at(100);
  const t = fresh(), cl = B().classList;
  let reads = 0;
  const gbr = B().getBoundingClientRect;
  for (const k of ['offsetWidth', 'offsetHeight']) Object.defineProperty(B(), k, { configurable: true, get() { reads++; return 1; } });
  B().getBoundingClientRect = function () { reads++; return gbr.call(this); };
  const e = tap(t);
  const f1 = [cl.contains('fa'), cl.contains('fb')];
  assert.deepEqual([bpm(), e.defaultPrevented, f1[0] !== f1[1]], [100, true, true], 'one tap: no tempo yet; the press taken; the flash');
  tap(t + 500);
  assert.deepEqual([cl.contains('fa'), cl.contains('fb')], [f1[1], f1[0]], 'the next tap: the other class (the flash starts again)');
  assert.equal(reads, 0, 'no forced layout (offsetWidth & co. never read)');
  for (const k of ['offsetWidth', 'offsetHeight']) delete B()[k];
  B().getBoundingClientRect = gbr;
  assert.deepEqual([bpm(), field()], [120, 120], 'the 2nd tap sets it');
  tap(t + 1000); tap(t + 1500);
  assert.deepEqual([bpm(), field()], [120, 120]);
  at(100);
  taps(fresh(), 500, 500, 500);
  assert.equal(bpm(), 120, 'the same with taps()');
});

test('the mean of the last 8 intervals: 4 × 600 ms → 100, then 4 × 400 → 120 (8 intervals averaged), 4 more × 400 → 150 (the 600s out of the window)', () => {
  at(90);
  let t = taps(fresh(), 600, 600, 600, 600);
  assert.equal(bpm(), 100);
  t = taps(t + 400, 400, 400, 400);
  assert.equal(bpm(), 120, '(4 × 600 + 4 × 400) / 8 = 500 ms');
  t = taps(t + 400, 400);
  assert.equal(bpm(), 133, '(2 × 600 + 6 × 400) / 8 = 450 ms → 133.3');
  taps(t + 400, 400);
  assert.equal(bpm(), 150, 'the last 8 all 400 ms');
});

test('rounding to a whole BPM: 461 ms → 130 (130.15), 478 ms → 126 (125.52), 500 + 480 → 122 (122.45)', () => {
  at(100);
  taps(fresh(), 461, 461, 461);
  assert.equal(bpm(), 130);
  taps(fresh(), 478, 478);
  assert.equal(bpm(), 126);
  taps(fresh(), 500, 480);
  assert.equal(bpm(), 122);
  assert.equal(Number.isInteger(bpm()), true);
});

test('clamped to 20–300: taps 150 ms apart → 300 (400 asked); 1990 ms apart → 30 (the slowest a sequence reaches: 2 s starts a new one)', () => {
  at(120);
  taps(fresh(), 150, 150, 150);
  assert.deepEqual([bpm(), field()], [300, 300]);
  taps(fresh(), 1990, 1990);
  assert.deepEqual([bpm(), field()], [30, 30]);
});

test('a new sequence: after a gap ≥ 2 s (2000 ms exactly), or an interval > 2× the running mean — that tap is the new sequence\'s first; exactly 2× is averaged in', () => {
  at(100);
  let t = taps(fresh(), 500, 500, 500);
  assert.equal(bpm(), 120);
  tap(t += 2000);
  assert.equal(bpm(), 120, 'the gap: a new sequence\'s first tap sets nothing');
  tap(t += 1000);
  assert.equal(bpm(), 60, 'only the new sequence\'s interval (the 500s and the 2 s gap forgotten)');
  at(100);
  t = taps(fresh(), 500, 500, 500);
  tap(t += 1001);
  assert.equal(bpm(), 120, '> 2× the mean (500): a new sequence, nothing set');
  tap(t += 750);
  assert.equal(bpm(), 80, 'from the new first tap');
  at(100);
  t = taps(fresh(), 500, 500, 500);
  tap(t += 1000);
  assert.equal(bpm(), 96, 'exactly 2×: averaged in — (3 × 500 + 1000) / 4 = 625 ms');
});

test('one undo step "Tempo" a sequence: Ctrl+Z restores the tempo before it, redo puts it back; a second sequence is a second step; a sequence that lands on the tempo it had adds none', () => {
  at(100);
  const n0 = steps();
  let t = taps(fresh(), 500, 500, 500, 500, 500, 500);
  assert.deepEqual([bpm(), steps() - n0, cv.hist.undoLabel], [120, 1, 'Tempo'], 'six taps, one step');
  t = taps(t + 5000, 400, 400, 400);
  assert.deepEqual([bpm(), steps() - n0], [150, 2], 'another sequence: another step');
  undoKey(); sim.raf();
  assert.deepEqual([bpm(), field()], [120, 120], 'Ctrl+Z: the tempo before the 2nd sequence');
  undoKey(); sim.raf();
  assert.deepEqual([bpm(), field()], [100, 100], 'again: before the 1st');
  redoKey(); sim.raf();
  assert.equal(bpm(), 120, 'redo');
  undoKey(); sim.raf();
  const n1 = steps();
  taps(fresh(), 600, 600, 600);
  assert.deepEqual([bpm(), steps()], [100, n1], 'taps on the tempo it has: nothing changes, no step');
});

test('an undo in the middle of a sequence: its next tap is a new step on top (the tempo again), never lost', () => {
  at(100);
  const n0 = steps();
  let t = taps(fresh(), 500, 500);
  assert.deepEqual([bpm(), steps() - n0], [120, 1]);
  undoKey(); sim.raf();
  assert.equal(bpm(), 100);
  tap(t += 500);
  assert.deepEqual([bpm(), steps() - n0, cv.hist.undoLabel], [120, 1, 'Tempo'], 'the sequence goes on: its own step again');
  tap(t += 500);
  assert.equal(steps() - n0, 1, 'still one');
  undoKey(); sim.raf();
  assert.equal(bpm(), 100);
});

test('one action per press: its click (detail ≥ 1) is no second tap, nor a keyboard / assistive click right after the pointer; a right button nothing; a touch press the same as a mouse one', () => {
  at(100);
  const t = fresh();
  for (let k = 0; k < 4; k++) {
    tap(t + 500 * k, { pointerType: k % 2 ? 'touch' : 'mouse', pointerId: 5 + k });
    B().dispatchEvent(ev('click', { detail: 1, timeStamp: t + 500 * k + 90 }));
    B().dispatchEvent(ev('click', { detail: 0, timeStamp: t + 500 * k + 95 }));
  }
  assert.equal(bpm(), 120, 'four presses, four taps (a click counted would make it 600+)');
  tap(t + 1600, { button: 2 });
  tap(t + 1700, { button: 1 });
  assert.equal(bpm(), 120, 'the right / middle button: nothing');
  tap(t + 2000);
  assert.equal(bpm(), 120, '(the sequence went on as if they were never pressed: 500 ms)');
});

test('a keyboard / VoiceOver / Switch Control click (detail 0, no pointer) taps', () => {
  at(100);
  const t = fresh();
  for (let k = 0; k < 3; k++) B().dispatchEvent(ev('click', { detail: 0, timeStamp: t + 500 * k }));
  assert.equal(bpm(), 120);
});

test('Enter taps on its keydown (taken: no click of its own, the page\'s keys never see it; a held key\'s repeats taken but no taps); Space taps only when focused from the keyboard — focused by a press it stays Play / stop', () => {
  at(100);
  let t = fresh();
  const e = key('Enter', t);
  key('Enter', t + 500);
  const r = key('Enter', t + 600, { repeat: true });
  assert.deepEqual([bpm(), e.defaultPrevented, r.defaultPrevented], [120, true, true], 'Enter: 120; its repeat taken');
  key('Enter', t + 1000);
  assert.equal(bpm(), 120, 'the repeat was no tap (500 ms intervals)');
  // Space with the button focused by a press (no keyboard focus): not taken — the page's Space plays / stops
  at(100);
  t = fresh();
  const s = key(' ', t);
  assert.deepEqual([bpm(), s.defaultPrevented], [100, false], 'not a tap');
  // focused from the keyboard (a key went down, then focus came to it): Space taps
  sim.key('ShiftLeft', true, { key: 'Shift' }); sim.key('ShiftLeft', false, { key: 'Shift' });
  for (const f of sim.dom.docL.focusin || []) f({ type: 'focusin', target: B() });
  const s1 = key(' ', t + 100);
  key(' ', t + 600);
  assert.deepEqual([bpm(), s1.defaultPrevented], [120, true], 'Space: 120');
  for (const f of sim.dom.docL.focusin || []) f({ type: 'focusin', target: sim.$('#tBpm') }); // (focus elsewhere again)
});

test('no letter shortcut: KeyT plays a note (the computer keyboard\'s letters are notes) and never taps', () => {
  at(100);
  const n0 = steps(), N = sim.nodeOf(P().tracks[0].id);
  N.posted.length = 0;
  for (let k = 0; k < 4; k++) { sim.key('KeyT', true, { key: 't' }); sim.advance(250); sim.key('KeyT', false, { key: 't' }); sim.advance(250); }
  assert.deepEqual([bpm(), steps()], [100, n0], 'the tempo untouched');
  assert.equal(N.posted.filter(x => x.m.t === 'on').length, 4, 'four notes played');
});

test('while the song plays: each tap re-anchors the transport live (the tempo box\'s path) — the nodes get the new frames per tick', async () => {
  at(100);
  const T = api.transport(), sr = sim.ctx().sampleRate;
  sim.$('#tPlay').click(); await sim.settle(5); sim.run(4800);
  assert.equal(T.playing, true);
  assert.equal(T.a.fpt, sr * 60 / (100 * S.PPQ));
  const N = sim.nodeOf(P().tracks[0].id);
  N.posted.length = 0;
  taps(fresh(), 300, 300);
  assert.equal(bpm(), 200);
  assert.equal(T.a.fpt, sr * 60 / (200 * S.PPQ), 'the anchor at the new tempo');
  const tr = N.posted.map(x => x.m).filter(m => m.t === 'transport');
  assert.equal(tr.length >= 1, true, 'a transport post');
  assert.equal(tr[tr.length - 1].fpt, sr * 60 / (200 * S.PPQ), 'the node plays on at 200');
  sim.run(4800);
  sim.$('#tPlay').click(); await sim.settle(5);
  assert.equal(T.playing, false);
});

test('a two-finger gesture landing on TAP (gesture.js: pointercancel flagged two-finger) takes its tap back — the tempo, its step, the sequence; a plain pointercancel keeps it', () => {
  at(100);
  const n0 = steps();
  let t = taps(fresh(), 500);
  assert.deepEqual([bpm(), steps() - n0], [120, 1]);
  tap(t + 200, { pointerId: 9, pointerType: 'touch' });
  assert.equal(bpm(), 171, '(500 + 200) / 2 = 350 ms');
  B().dispatchEvent(ev('pointercancel', { pointerId: 9, pointerType: 'touch', gesture: 'two-finger' }));
  assert.deepEqual([bpm(), field(), steps() - n0], [120, 120, 1], 'back: the sequence\'s one step as it was');
  tap(t += 500);
  assert.equal(bpm(), 120, 'the sequence goes on without it (500, 500)');
  // the cancelled tap was the one that opened the step: the step goes too
  at(100);
  const n1 = steps();
  t = fresh(); tap(t);
  tap(t + 500, { pointerId: 11, pointerType: 'touch' });
  assert.deepEqual([bpm(), steps() - n1], [120, 1]);
  B().dispatchEvent(ev('pointercancel', { pointerId: 11, pointerType: 'touch', gesture: 'two-finger' }));
  assert.deepEqual([bpm(), steps() - n1], [100, 0], 'no step left');
  // a plain pointercancel (the browser took the touch for a scroll): the tap stays
  tap(t + 1000, { pointerId: 12, pointerType: 'touch' });
  B().dispatchEvent(ev('pointercancel', { pointerId: 12, pointerType: 'touch' }));
  assert.deepEqual([bpm(), steps() - n1], [60, 1], 'kept (1000 ms: the cancelled tap is out of the sequence)');
  // a cancel for another pointer, or after its lift: nothing
  tap(t + 1500, { pointerId: 13, pointerType: 'touch' });
  B().dispatchEvent(ev('pointerup', { pointerId: 13, pointerType: 'touch' }));
  B().dispatchEvent(ev('pointercancel', { pointerId: 13, pointerType: 'touch', gesture: 'two-finger' }));
  B().dispatchEvent(ev('pointercancel', { pointerId: 99, pointerType: 'touch', gesture: 'two-finger' }));
  assert.equal(bpm(), 80, 'kept ((1000 + 500) / 2 = 750 ms)');
});

test('⋯\'s TAP (#tTapM, ≤ 900 px) taps the same sequence as the row\'s: a press on either goes on with it, its click is no second tap, Enter taps, it flashes; one undo step', () => {
  at(100);
  const M = () => sim.$('#tTapM'), n0 = steps();
  const press = (b, ts, o = {}) => { LAST = Math.max(LAST, ts); const e = Object.assign(ev('pointerdown', Object.assign({ timeStamp: ts, button: 0, buttons: 1, pointerId: 21, pointerType: 'touch', isPrimary: true }, o)), { target: b, currentTarget: b }); b.dispatchEvent(e); return e; };
  const t = fresh();
  const e = press(M(), t);
  M().dispatchEvent(Object.assign(ev('click', { detail: 1, timeStamp: t + 80 }), { target: M(), currentTarget: M() }));
  assert.deepEqual([bpm(), e.defaultPrevented, M().classList.contains('fa') !== M().classList.contains('fb')], [100, true, true], 'the press taken, the flash; no tempo yet');
  press(M(), t + 500);
  assert.deepEqual([bpm(), field()], [120, 120], 'its 2nd tap: 120 (its click no tap)');
  press(B(), t + 1000);
  M().dispatchEvent(Object.assign(ev('keydown', { key: 'Enter', code: 'Enter', timeStamp: t + 1500, repeat: false }), { target: M(), currentTarget: M() }));
  assert.equal(bpm(), 120, 'the row\'s TAP and Enter on ⋯\'s go on with the same sequence (500 ms)');
  press(M(), t + 1900);
  assert.deepEqual([bpm(), steps() - n0, cv.hist.undoLabel], [126, 1, 'Tempo'], '(3 × 500 + 400) / 4 = 475 ms → 126; one step');
  undoKey(); sim.raf();
  assert.equal(bpm(), 100);
});

test('a sequence\'s step is always its own (History.record forced): when the top step already holds the state — another action\'s, its change outside the snapshot (meta) — one Ctrl+Z takes back only the taps, and that step stays, named; a two-finger cancel of the tap that opened it drops only its own', () => {
  at(100);
  cv.hist.record(P(), 'Other'); // (an action whose step holds the state as it is now: what it did lives in its meta)
  const other = cv.hist.u[cv.hist.u.length - 1];
  other.meta = { note: 'outside the snapshot' };
  const n0 = steps();
  let t = taps(fresh(), 500, 500);
  assert.deepEqual([bpm(), steps() - n0, cv.hist.undoLabel], [120, 1, 'Tempo'], 'a step of its own, named Tempo');
  undoKey(); sim.raf();
  assert.deepEqual([bpm(), steps() - n0, cv.hist.u[cv.hist.u.length - 1] === other, cv.hist.undoLabel], [100, 0, true, 'Other'], 'one Ctrl+Z: the taps only — the other step still there');
  // the tap that opened the sequence's step taken back by a two-finger gesture: that step goes, the other stays
  t = fresh(); tap(t);
  tap(t + 500, { pointerId: 31, pointerType: 'touch' });
  assert.deepEqual([bpm(), steps() - n0], [120, 1]);
  B().dispatchEvent(ev('pointercancel', { pointerId: 31, pointerType: 'touch', gesture: 'two-finger' }));
  assert.deepEqual([bpm(), steps() - n0, cv.hist.u[cv.hist.u.length - 1] === other], [100, 0, true], 'only its own step dropped');
  cv.hist._drop(cv.hist.u.pop()); // (the stand-in step gone: the tests after start clean)
});

test('the flash plays once a tap and never again with no tap: its class goes when its animation ends, or is cancelled as the button hides (⋯ closed; the row\'s TAP folded at ≤ 900 px) — a CSS animation restarts when its element shows again (the review: ⋯\'s "Tap tempo" flashed each time ⋯ opened); a tap mid-flash (the old animation cancelled for the new, or its end arriving late) keeps the new flash', () => {
  at(100);
  const M = () => sim.$('#tTapM');
  for (const [name, b] of [['the row\'s TAP', B()], ['⋯\'s TAP', M()]]) {
    const cl = b.classList, on = () => [cl.contains('fa'), cl.contains('fb')];
    const anim = () => cl.contains('fa') ? 'tapfa' : 'tapfb';
    const fire = (type, animationName) => b.dispatchEvent(Object.assign(ev(type, { animationName, elapsedTime: 0.2 }), { target: b, currentTarget: b }));
    const press = ts => { LAST = Math.max(LAST, ts); b.dispatchEvent(Object.assign(ev('pointerdown', { timeStamp: ts, button: 0, buttons: 1, pointerId: 41, pointerType: 'touch', isPrimary: true }), { target: b, currentTarget: b })); };
    let t = fresh();
    press(t);
    assert.equal(on()[0] !== on()[1], true, name + ': the flash');
    fire('animationend', anim());
    assert.deepEqual(on(), [false, false], name + ': its animation ended — no class left to replay it');
    press(t += 500);
    const a1 = anim();
    press(t += 300); // (mid-flash: the other class, a new animation — the old one cancelled)
    const a2 = anim();
    assert.notEqual(a1, a2);
    fire('animationcancel', a1);
    fire('animationend', a1); // (the old one's end, queued before the tap)
    assert.deepEqual([cl.contains(a2 === 'tapfa' ? 'fa' : 'fb'), on()[0] !== on()[1]], [true, true], name + ': the old flash\'s cancel / late end keeps the new one');
    fire('animationcancel', a2); // (hidden mid-flash: ⋯ closed, the window narrowed)
    assert.deepEqual(on(), [false, false], name + ': cancelled as it hid — nothing to replay when it shows');
    press(t += 400);
    assert.equal(on()[0] !== on()[1], true, name + ': the next tap flashes again');
    fire('animationend', anim());
    assert.deepEqual(on(), [false, false]);
  }
});
