// LWC custom-bytenode header transforms (P1-P5).
// V8 cachedData real layout varies by Node version. We treat the first
// HEADER_SIZE bytes of cachedData as opaque "real header", store it
// encrypted alongside the file, and surface a fabricated header that
// breaks public tools (View8, ghidra_nodejs) until the loader restores it.

import crypto from 'node:crypto';

export const HEADER_SIZE = 0x18;
export const LWC_MAGIC = 0xDEAD4C57 >>> 0;
export const FAKE_VERSION = 0xDEADBEEF >>> 0;
export const SALT_SOURCE = 0x4C574348 >>> 0; // "LWCH"
export const SEED_CKSUM = 0x4C415743 >>> 0;  // "LAWC"

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function customChecksum(payload, seed = SEED_CKSUM) {
  let crc = seed >>> 0;
  for (let i = 0; i < payload.length; i++) {
    crc = ((crc >>> 8) ^ CRC32_TABLE[(crc ^ payload[i]) & 0xFF]) >>> 0;
  }
  return (crc ^ seed) >>> 0;
}

export function obfuscateSourceHash(realLength, buildTs) {
  return ((realLength ^ SALT_SOURCE) ^ (buildTs & 0xFFFF)) >>> 0;
}
export function recoverSourceLength(fakeHash, buildTs) {
  return ((fakeHash ^ SALT_SOURCE) ^ (buildTs & 0xFFFF)) >>> 0;
}

// P4 — chunked Fisher-Yates shuffle keyed by 32-byte key
const CHUNK = 64;
function* prng(key) {
  let i = 0;
  while (true) {
    yield key[i % key.length];
    i++;
  }
}
export function shufflePayload(payload, key) {
  const chunks = [];
  for (let i = 0; i < payload.length; i += CHUNK) chunks.push(payload.subarray(i, i + CHUNK));
  const order = chunks.map((_, i) => i);
  const rng = prng(key);
  for (let i = order.length - 1; i > 0; i--) {
    const j = (rng.next().value + i) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const out = Buffer.concat(order.map(idx => chunks[idx]));
  return { shuffled: out, order };
}
// Permutation semantics: shuffled[i] is original chunk #order[i].
// Original chunk sizes: all CHUNK except last (which fills `origLen`).
export function unshufflePayload(shuffled, order, origLen) {
  const N = order.length;
  const sizes = new Array(N);
  for (let i = 0; i < N - 1; i++) sizes[i] = CHUNK;
  sizes[N - 1] = origLen - (N - 1) * CHUNK;
  // Walk shuffled stream; chunk at output position i has size sizes[order[i]]
  const slots = new Array(N);
  let cur = 0;
  for (let i = 0; i < N; i++) {
    const origIdx = order[i];
    const sz = sizes[origIdx];
    slots[origIdx] = shuffled.subarray(cur, cur + sz);
    cur += sz;
  }
  return Buffer.concat(slots);
}

// Build fabricated header that public tools choke on
export function fabricatedHeader(payloadAfterShuffle, buildTs, realLength) {
  const h = Buffer.alloc(HEADER_SIZE);
  h.writeUInt32LE(LWC_MAGIC, 0x00);
  h.writeUInt32LE(FAKE_VERSION, 0x04);
  h.writeUInt32LE(obfuscateSourceHash(realLength, buildTs), 0x08);
  h.writeUInt32LE(crypto.randomInt(0, 0xFFFFFFFF), 0x0C); // P1 random flag-hash poison
  h.writeUInt32LE(payloadAfterShuffle.length, 0x10);
  h.writeUInt32LE(customChecksum(payloadAfterShuffle), 0x14);
  return h;
}
