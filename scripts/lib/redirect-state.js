// Shared per-session state for redirect/nudge degradation. Tracks:
//  - denial counts per (rewrite-pattern, session) so we can soft-degrade
//  - sizes of recent test/build outputs so we can skip the compressor wrap
//    when historical output is small enough that the suggestion costs more
//    than it saves.
//  - native Edit / slim Edit call counts so the batching nudge can
//    suppress itself when slim:Edit is unreachable.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const stateFile = (sid) => path.join(os.tmpdir(), `slimmer-redirect-${sid || "default"}.json`);

const DEFAULT = {
  denials: {},          // key → count
  outputBytes: {},      // kind → last size (bytes)
  edits: { native: 0, slim: 0 },
  reads: 0,             // consecutive slim:Read calls (resets on Search)
};

export async function loadState(sid) {
  try {
    const raw = await fs.readFile(stateFile(sid), "utf8");
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    return structuredClone(DEFAULT);
  }
}

export async function saveState(sid, state) {
  try { await fs.writeFile(stateFile(sid), JSON.stringify(state)); } catch {}
}

export async function bumpDenial(sid, key) {
  const s = await loadState(sid);
  s.denials[key] = (s.denials[key] || 0) + 1;
  await saveState(sid, s);
  return s.denials[key];
}

export async function recordOutputSize(sid, kind, bytes) {
  const s = await loadState(sid);
  s.outputBytes[kind] = bytes;
  await saveState(sid, s);
}

export async function recordEdit(sid, kind) {
  const s = await loadState(sid);
  if (kind === "native") s.edits.native++;
  else if (kind === "slim") s.edits.slim++;
  await saveState(sid, s);
  return s.edits;
}

export async function bumpRead(sid) {
  const s = await loadState(sid);
  s.reads = (s.reads || 0) + 1;
  await saveState(sid, s);
  return s.reads;
}

export async function resetReads(sid) {
  const s = await loadState(sid);
  s.reads = 0;
  await saveState(sid, s);
}
