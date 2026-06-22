// LWC compiler: source.js -> .lwc (encrypted custom-headered V8 cached data).
//
// File format on disk:
//   [FILE_MAGIC 6B] "LWC\x01\x00\x00"
//   [iv 12B]
//   [authTag 16B]
//   [buildTs 4B LE]
//   [realHeaderLen 2B LE]
//   [wrapSourceLen 4B LE]
//   [origTailLen 4B LE]      (= cached.length - realHeaderLen)
//   [orderLen 4B LE]
//   [orderBytes orderLen*2 B LE]   (permutation P: shuffled[i] = origChunks[P[i]])
//   [encPayload N B]               AES-256-GCM( realHeader || shuffledTail )

import crypto from 'node:crypto';
import vm from 'node:vm';
import v8 from 'node:v8';
import { Module, createRequire } from 'node:module';
import { HEADER_SIZE, fabricatedHeader, shufflePayload } from './header.js';

export const FILE_MAGIC = Buffer.from('LWC\x01\x00\x00', 'binary');

// V8 lazy parsing would re-parse function bodies from source at call time.
// Loader uses dummy spaces as source so we must disable lazy parsing on both
// sides. Loader applies the same flags before instantiating Script.
export const REQUIRED_FLAGS = ['--no-lazy', '--no-flush-bytecode'];

export function compileSource(source, { aesKey, flags = REQUIRED_FLAGS } = {}) {
  if (!aesKey || aesKey.length !== 32) throw new Error('aesKey must be 32 bytes');
  for (const f of flags) v8.setFlagsFromString(f);

  // Strip shebang line if present — Module.wrap can't accept it.
  const cleaned = source.startsWith('#!') ? source.slice(source.indexOf('\n') + 1) : source;
  const wrapped = Module.wrap(cleaned);
  const script = new vm.Script(wrapped, { produceCachedData: true });
  const cached = Buffer.from(script.createCachedData());
  if (!cached || cached.length === 0) throw new Error('createCachedData returned empty');

  // Bytenode-style: patch source_length+source_hash fields so a dummy-spaces
  // source of the same length validates at load time. Field offsets vary by
  // V8 version; we copy whatever a freshly-built dummy uses.
  const dummy = ' '.repeat(wrapped.length);
  const dummyCached = Buffer.from(
    new vm.Script(dummy, { produceCachedData: true }).createCachedData()
  );
  // V8 cached data layout (Node 18-22):
  //   [0..4) magic, [4..8) version, [8..12) source_length,
  //   [12..16) source_hash, [16..20) flag_hash
  // Patch source_length+source_hash+flag_hash to dummy's so the loader's
  // dummy spaces of length wrapped.length validates.
  dummyCached.subarray(8, 20).copy(cached, 8);

  const realHeader = Buffer.from(cached.subarray(0, HEADER_SIZE));
  const tail = Buffer.from(cached.subarray(HEADER_SIZE));

  const { shuffled, order } = shufflePayload(tail, aesKey);
  const buildTs = Math.floor(Date.now() / 1000);

  const innerPlain = Buffer.concat([realHeader, shuffled]);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const enc = Buffer.concat([cipher.update(innerPlain), cipher.final()]);
  const tag = cipher.getAuthTag();

  const orderBuf = Buffer.alloc(order.length * 2);
  for (let i = 0; i < order.length; i++) orderBuf.writeUInt16LE(order[i], i * 2);

  const out = Buffer.concat([
    FILE_MAGIC,
    iv,
    tag,
    u32LE(buildTs),
    u16LE(HEADER_SIZE),
    u32LE(wrapped.length),
    u32LE(tail.length),
    u32LE(order.length),
    orderBuf,
    enc,
  ]);

  return {
    file: out,
    decoyHeader: fabricatedHeader(shuffled, buildTs, wrapped.length),
    sourceLength: wrapped.length,
    buildTs,
  };
}

function u16LE(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n >>> 0); return b; }
function u32LE(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
