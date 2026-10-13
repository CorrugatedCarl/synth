// Test file builders shared by the S1 tests (owner S1; not a test file): WAV files with arbitrary chunks (smpl, inst,
// acid), AIFF / AIFC files (NONE, sowt, fl32, fl64; INST + MARK loops), and minimal ZIP archives (stored entries, or
// "deflated" ones whose raw bytes a stub inflater maps back).
function wavFile(o) {
  const chs = o.ch, n = chs[0].length, nch = chs.length, bits = o.bits || 16, bps = bits / 8;
  const chunks = [];
  const fmt = new DataView(new ArrayBuffer(16));
  fmt.setUint16(0, bits === 32 && o.float ? 3 : 1, true); fmt.setUint16(2, nch, true); fmt.setUint32(4, o.rate, true);
  fmt.setUint32(8, o.rate * nch * bps, true); fmt.setUint16(12, nch * bps, true); fmt.setUint16(14, bits, true);
  chunks.push(['fmt ', new Uint8Array(fmt.buffer)]);
  for (const [id, body] of o.extra || []) chunks.push([id, body]);
  const data = new DataView(new ArrayBuffer(n * nch * bps));
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) {
    const v = Math.max(-1, Math.min(1, chs[c][i])), off = (i * nch + c) * bps;
    if (bits === 16) data.setInt16(off, Math.round(v * 32767), true);
    else if (bits === 32 && o.float) data.setFloat32(off, v, true);
  }
  chunks.push(['data', new Uint8Array(data.buffer)]);
  const size = 4 + chunks.reduce((a, [, b]) => a + 8 + b.length + (b.length & 1), 0), out = new Uint8Array(8 + size), dv = new DataView(out.buffer);
  const str = (o2, s) => { for (let i = 0; i < 4; i++) out[o2 + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, size, true); str(8, 'WAVE');
  let p = 12;
  for (const [id, b] of chunks) { str(p, id); dv.setUint32(p + 4, b.length, true); out.set(b, p + 8); p += 8 + b.length + (b.length & 1); }
  return out;
}
const smplChunk = (unity, frac, loop) => { const dv = new DataView(new ArrayBuffer(36 + (loop ? 24 : 0))); dv.setUint32(12, unity, true); dv.setUint32(16, frac, true); dv.setUint32(28, loop ? 1 : 0, true); if (loop) { dv.setUint32(36 + 8, loop[0], true); dv.setUint32(36 + 12, loop[1], true); } return new Uint8Array(dv.buffer); };
const instChunk = (note, fine) => Uint8Array.from([note, fine & 255, 0, 127, 1, 127, 0]);
const acidChunk = (flags, note) => { const dv = new DataView(new ArrayBuffer(24)); dv.setUint32(0, flags, true); dv.setUint16(4, note, true); return new Uint8Array(dv.buffer); };

function ext80(rate) { // positive integer rate → 10-byte IEEE extended
  const b = new Uint8Array(10), e = Math.floor(Math.log2(rate)), m = rate / Math.pow(2, e); // m ∈ [1, 2)
  const exp = e + 16383; b[0] = exp >> 8; b[1] = exp & 255;
  const hi = Math.floor(m * 2147483648), lo = Math.round((m * 2147483648 - hi) * 4294967296);
  new DataView(b.buffer).setUint32(2, hi); new DataView(b.buffer).setUint32(6, lo);
  return b;
}
function aiffFile(o) { // {rate, ch: [Float32Array…], bits, comp ('NONE' | 'sowt' | 'fl32' | 'fl64' | null for AIFF), inst, marks}
  const chs = o.ch, n = chs[0].length, nch = chs.length, comp = o.comp || null, bits = comp === 'fl32' ? 32 : comp === 'fl64' ? 64 : o.bits;
  const bps = Math.ceil(bits / 8), chunks = [];
  const comm = new DataView(new ArrayBuffer(comp ? 24 : 18));
  comm.setInt16(0, nch); comm.setUint32(2, n); comm.setInt16(6, bits);
  new Uint8Array(comm.buffer).set(ext80(o.rate), 8);
  if (comp) { for (let i = 0; i < 4; i++) comm.setUint8(18 + i, comp.charCodeAt(i)); comm.setUint8(22, 0); }
  chunks.push(['COMM', new Uint8Array(comm.buffer)]);
  if (o.marks) {
    const parts = [];
    for (const [id, pos, name] of o.marks) { const len = 7 + name.length + ((1 + name.length) & 1), d = new DataView(new ArrayBuffer(len)); d.setInt16(0, id); d.setUint32(2, pos); d.setUint8(6, name.length); for (let i = 0; i < name.length; i++) d.setUint8(7 + i, name.charCodeAt(i)); parts.push(new Uint8Array(d.buffer)); }
    const total = 2 + parts.reduce((a, x) => a + x.length, 0), m = new Uint8Array(total);
    new DataView(m.buffer).setUint16(0, o.marks.length);
    let p = 2; for (const x of parts) { m.set(x, p); p += x.length; }
    chunks.push(['MARK', m]);
  }
  if (o.inst) { const d = new DataView(new ArrayBuffer(20)); d.setInt8(0, o.inst.base); d.setInt8(1, 0); d.setInt16(8, o.inst.mode); d.setInt16(10, o.inst.begin); d.setInt16(12, o.inst.end); chunks.push(['INST', new Uint8Array(d.buffer)]); }
  const data = new DataView(new ArrayBuffer(8 + n * nch * bps));
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) {
    const v = chs[c][i], off = 8 + (i * nch + c) * bps;
    if (comp === 'fl32') data.setFloat32(off, v);
    else if (comp === 'fl64') data.setFloat64(off, v);
    else {
      const full = Math.pow(2, 8 * bps - 1);
      let q = Math.max(-full, Math.min(full - 1, Math.round(v * full)));
      if (q < 0) q += 2 * full;
      for (let k = 0; k < bps; k++) { const byte = Math.floor(q / Math.pow(2, 8 * (bps - 1 - k))) & 255; data.setUint8(comp === 'sowt' ? off + bps - 1 - k : off + k, byte); }
    }
  }
  chunks.push(['SSND', new Uint8Array(data.buffer)]);
  const size = 4 + chunks.reduce((a, [, b]) => a + 8 + b.length + (b.length & 1), 0), out = new Uint8Array(8 + size), dv = new DataView(out.buffer);
  const str = (p, s) => { for (let i = 0; i < 4; i++) out[p + i] = s.charCodeAt(i); };
  str(0, 'FORM'); dv.setUint32(4, size); str(8, comp ? 'AIFC' : 'AIFF');
  let p = 12;
  for (const [id, b] of chunks) { str(p, id); dv.setUint32(p + 4, b.length); out.set(b, p + 8); p += 8 + b.length + (b.length & 1); }
  return out;
}
// minimal ZIP (local headers + central directory); entries [{name, data: Uint8Array, method (0 | 8), raw (stored bytes)}]
function zipFile(entries) {
  const enc = new TextEncoder(), parts = [], cd = [];
  let off = 0;
  for (const e of entries) {
    const name = enc.encode(e.name), raw = e.raw || e.data, lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, e.method || 0, true); lh.setUint32(18, raw.length, true); lh.setUint32(22, e.data.length, true);
    lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, raw);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, e.method || 0, true); ch.setUint32(20, raw.length, true); ch.setUint32(24, e.data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    cd.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + raw.length;
  }
  const cdLen = cd.reduce((a, x) => a + x.length, 0), eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, entries.length, true); eocd.setUint16(10, entries.length, true); eocd.setUint32(12, cdLen, true); eocd.setUint32(16, off, true);
  const all = [...parts, ...cd, new Uint8Array(eocd.buffer)], out = new Uint8Array(all.reduce((a, x) => a + x.length, 0));
  let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}
export { wavFile, smplChunk, instChunk, acidChunk, aiffFile, zipFile };
