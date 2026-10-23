// tests/ui-bench-frame.mjs — the bench pages' app frame, with the bench URL's test switches (IMPL-P §4, review 2 F6).
// The bench runs the app in an iframe whose document is a srcdoc string (the test hooks injected before main.js); a srcdoc frame's
// location.search is empty, so cv-world's URL readers (?perf=high|medium|low, ?texmax=N, ?nogl) never saw the bench's own query.
// With one of those switches in the bench URL the frame is now a real page, tests/ui-bench-frame.html?perf=…, which waits for the
// app's page in a message and writes it into itself (document.open / write / close run by the frame's own handler: the frame's
// URL, query included, stays) — the app then reads the very query the bench was given. Without a switch nothing changes: the
// srcdoc as before (every scene's numbers stay comparable). Pure functions + two small DOM ones; node imports the lot
// (tests/ui-bench-frame.test.mjs). Test pages only: nothing here is the app's.

export const FRAME_PAGE = 'ui-bench-frame.html';
const READY = 'ui-bench-frame-ready', MOUNT = 'ui-bench-mount';
/** cv-world's own readers' regexps (cv-world.js perfURL / texmaxURL / glPref; the test checks the source still has them). */
export const SWITCH_RE = Object.freeze({
  perf: /[?&]perf=(high|medium|low)(?:&|$)/,
  texmax: /[?&]texmax=(\d{1,6})(?:&|$)/,
  nogl: /[?&]nogl(?:=1)?(?:&|$)/,
});

/** What the bench URL asks of the app: { perf: 'high' | 'medium' | 'low' | null, texmax: N (0: none), nogl } — as the app reads it. */
export function frameOpts(search) {
  const q = String(search || ''), p = SWITCH_RE.perf.exec(q), t = SWITCH_RE.texmax.exec(q), n = t ? +t[1] : 0;
  return { perf: p ? p[1] : null, texmax: n > 0 ? n : 0, nogl: SWITCH_RE.nogl.test(q) };
}
/** The query the frame carries ('' for none): the switches above, in a fixed order — the bench's own (m9, s55, gl=off …) stay home. */
export function frameQuery(search) {
  const o = frameOpts(search), a = [];
  if (o.perf) a.push('perf=' + o.perf);
  if (o.texmax) a.push('texmax=' + o.texmax);
  if (o.nogl) a.push('nogl=1');
  return a.length ? '?' + a.join('&') : '';
}

/**
 * Puts `doc` (the app's page string, hooks injected) into `frame`: with no query the srcdoc as ever; with one, the frame loads
 * ui-bench-frame.html next to the bench page (pageHref) with that query, answers ready, is sent the page and writes it. `win` is
 * the bench page's window (the answer comes there); rejects when the frame page does not answer within `ms`.
 * @returns {Promise<'srcdoc' | 'url'>}
 */
export function mountFrame(frame, doc, query, pageHref, win = globalThis, ms = 15000) {
  if (!query) { frame.srcdoc = doc; return Promise.resolve('srcdoc'); }
  const url = new URL(FRAME_PAGE + query, pageHref), origin = url.origin;
  return new Promise((resolve, reject) => {
    let done = false;
    const off = () => { done = true; clearTimeout(timer); win.removeEventListener && win.removeEventListener('message', onMsg); };
    const onMsg = e => {
      if (done || !e || e.source !== frame.contentWindow || !e.data || e.data.t !== READY) return;
      off();
      try { frame.contentWindow.postMessage({ t: MOUNT, html: doc }, origin); resolve('url'); } catch (err) { reject(err); }
    };
    const timer = setTimeout(() => { if (!done) { off(); reject(new Error('the app frame page (' + FRAME_PAGE + ') did not answer in ' + ms + ' ms')); } }, ms);
    win.addEventListener('message', onMsg);
    frame.removeAttribute('srcdoc'); // (a srcdoc attribute would win over the src)
    frame.src = url.href;
  });
}
/** The frame page's half (tests/ui-bench-frame.html): says ready to the bench, then writes the page it is sent into itself, once. */
export function installMount(win) {
  win.addEventListener('message', e => {
    const d = e && e.data;
    if (!d || d.t !== MOUNT || typeof d.html !== 'string' || e.source !== win.parent || e.origin !== win.location.origin) return;
    const doc = win.document;
    doc.open(); doc.write(d.html); doc.close();
  });
  try { win.parent.postMessage({ t: READY }, win.location.origin); } catch (err) { /* the page itself, no parent: nothing to answer */ }
}

/**
 * What was asked and what the app frame runs — for the results JSON: { asked (the preset asked for, or null), world (the world's
 * preset, null: no world), texmaxAsked, texSide (the texture side limit cv-face works to: cv-gl's min(the GPU's, ?texmax)), faceBudget,
 * nogl, ok (the switches reached the app: the preset equals what was asked; a side limit at or under the ?texmax asked, on the GL path) }.
 */
export function presetInfo(world, search) {
  const o = frameOpts(search);
  let g = null;
  try { g = world && typeof world.glStats === 'function' ? world.glStats() : null; } catch (err) { g = null; }
  const w = world && typeof world.perf === 'string' ? world.perf : null;
  const ok = !((o.perf || o.texmax) && !world) && (!o.perf || w === o.perf) && (!o.texmax || !g || (+g.texSide > 0 && +g.texSide <= o.texmax));
  return { asked: o.perf, world: w, texmaxAsked: o.texmax || null, texSide: g && g.texSide != null ? g.texSide : null, faceBudget: g && g.faceBudget != null ? g.faceBudget : null, nogl: o.nogl, ok };
}
/** '' when the switches reached the app, else why not (the bench's validity notes and its status line). */
export function presetNote(p) {
  if (!p || p.ok) return '';
  const why = [];
  if (p.asked && p.world !== p.asked) why.push('the preset asked for (' + p.asked + ') did not reach the app frame: it runs ' + (p.world || 'nothing'));
  if (p.texmaxAsked && p.texSide != null && p.texSide > p.texmaxAsked) why.push('texmax ' + p.texmaxAsked + ' did not reach the app frame (texture side limit ' + p.texSide + ')');
  if (!p.world && !why.length) why.push('the app frame has no world to read the switches from');
  return why.join('; ');
}
