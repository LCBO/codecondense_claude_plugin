// LWC loader: read .lwc, decrypt, restore real V8 cached data, run.

import crypto from 'node:crypto';
import vm from 'node:vm';
import v8 from 'node:v8';
import fs from 'node:fs';
import { Module } from 'node:module';
import { unshufflePayload, HEADER_SIZE } from './header.js';
import { FILE_MAGIC, REQUIRED_FLAGS } from './compile.js';

let flagsApplied = false;
function ensureFlags() {
  if (flagsApplied) return;
  for (const f of REQUIRED_FLAGS) v8.setFlagsFromString(f);
  flagsApplied = true;
}

export function loadLwc(filePath, { aesKey, filename = filePath } = {}) {
  const buf = fs.readFileSync(filePath);
  return loadLwcBuffer(buf, { aesKey, filename });
}

export function loadLwcBuffer(buf, { aesKey, filename = '<lwc>' } = {}) {
  if (!aesKey || aesKey.length !== 32) throw new Error('aesKey must be 32 bytes');
  if (!buf.subarray(0, 6).equals(FILE_MAGIC)) throw new Error('bad LWC magic');
  ensureFlags();

  let off = 6;
  const iv = buf.subarray(off, off + 12); off += 12;
  const tag = buf.subarray(off, off + 16); off += 16;
  const buildTs = buf.readUInt32LE(off); off += 4;
  const realHeaderLen = buf.readUInt16LE(off); off += 2;
  const wrapSourceLen = buf.readUInt32LE(off); off += 4;
  const origTailLen = buf.readUInt32LE(off); off += 4;
  const orderLen = buf.readUInt32LE(off); off += 4;
  const order = new Array(orderLen);
  for (let i = 0; i < orderLen; i++) { order[i] = buf.readUInt16LE(off); off += 2; }
  const enc = buf.subarray(off);

  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(tag);
  const inner = Buffer.concat([decipher.update(enc), decipher.final()]);

  if (realHeaderLen !== HEADER_SIZE) throw new Error('header size mismatch');
  const realHeader = inner.subarray(0, realHeaderLen);
  const shuffled = inner.subarray(realHeaderLen);
  if (shuffled.length !== origTailLen) throw new Error('tail length mismatch');

  const tail = unshufflePayload(shuffled, order, origTailLen);
  const cached = Buffer.concat([realHeader, tail]);

  const dummy = ' '.repeat(wrapSourceLen);
  const script = new vm.Script(dummy, {
    filename,
    cachedData: cached,
    produceCachedData: false,
  });
  if (script.cachedDataRejected) throw new Error('V8 rejected cachedData');

  return { script, buildTs };
}

// Convenience: run as a CommonJS-style module wrapper, return module.exports
export function runLwc(filePath, { aesKey, filename = filePath } = {}) {
  const { script } = loadLwc(filePath, { aesKey, filename });
  const fn = script.runInThisContext({ filename });
  const mod = { exports: {} };
  fn(mod.exports, (id) => Module.createRequire(filename)(id), mod, filename, filePath);
  return mod.exports;
}
