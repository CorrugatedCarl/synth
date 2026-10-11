// Shared fixture helpers (spec §10.1). Typed arrays inside JSON fixtures are encoded as
// { "$t": "<TypedArray name>", "v": [numbers…] }; everything else is plain JSON.
//   import { loadFixture } from './fixtures/load.mjs';
//   const CP = loadFixture('cp-default.json');      // → object with real typed arrays
import { readFileSync } from 'node:fs';

const TYPES = { Float64Array, Float32Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, Uint8ClampedArray };

export function encode(x) {
  if (ArrayBuffer.isView(x)) return { $t: x.constructor.name, v: Array.from(x) };
  if (Array.isArray(x)) return x.map(encode);
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x)) o[k] = encode(x[k]);
    return o;
  }
  return x;
}

export function decode(x) {
  if (Array.isArray(x)) return x.map(decode);
  if (x && typeof x === 'object') {
    if (typeof x.$t === 'string' && Array.isArray(x.v)) {
      const T = TYPES[x.$t];
      if (!T) throw new Error('fixture: unknown typed array ' + x.$t);
      return T.from(x.v);
    }
    const o = {};
    for (const k of Object.keys(x)) o[k] = decode(x[k]);
    return o;
  }
  return x;
}

// One top-level key per line keeps the files diffable without exploding long arrays.
export function stringify(obj) {
  const e = encode(obj);
  return '{\n' + Object.keys(e).map(k => ' ' + JSON.stringify(k) + ': ' + JSON.stringify(e[k])).join(',\n') + '\n}\n';
}

export function loadFixture(name) {
  return decode(JSON.parse(readFileSync(new URL('./' + name, import.meta.url), 'utf8')));
}
