// wtwork.js — module Worker that builds wavetable and noise entries off the main thread (SPEC-serum §7.5, §11.8):
// factory builds take 30–100 ms. Requests { q, id, table?, rec? }: a factory / sub / noise id, a user Table
// ({ frames, morph }) or a user noise record; the reply { q, entry } transfers every level buffer, { q, err } on failure.
import * as wt from './wt.js?v=10';

self.onmessage = e => {
  const { q, id, table, rec } = e.data || {};
  try {
    let entry = null;
    if (table) entry = wt.makeEntry(id, table);
    else if (rec) entry = wt.noiseEntry(Object.assign({}, rec, { id }));
    else if (typeof id === 'string' && id.startsWith('noise:')) entry = wt.makeNoise(id);
    else { const t = wt.factoryTable(id); entry = t ? wt.makeEntry(id, t) : null; }
    if (!entry) { self.postMessage({ q, err: 'unknown table ' + id }); return; }
    const bufs = entry.kind === 'noise' ? entry.levels.flatMap(l => (l.R ? [l.L.buffer, l.R.buffer] : [l.L.buffer])) : entry.levels.map(l => l.data.buffer);
    self.postMessage({ q, entry }, [...new Set(bufs)]); // (a buffer may back several views)
  } catch (err) {
    self.postMessage({ q, err: String((err && err.message) || err) });
  }
};
