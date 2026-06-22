// Flat-file storage primitives shared by slimmer's local stores.
// Replaces node:sqlite entirely — pure JS, no native deps, runs on Node >=18.
//
// Two shapes:
//   • JSON document store   — whole-file load/save, written atomically (memory,
//     read-cache shards, code index, recall files manifest).
//   • JSONL append-only log — one event per line (telemetry, recall messages).
//
// Plus a lightweight tokenizing full-text search that stands in for the FTS5
// virtual tables the SQLite build used (memory search, recall search).
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
  renameSync, appendFileSync, statSync, unlinkSync,
} from "node:fs";
import path from "node:path";

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── JSON document store ───
export function loadJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch { return fallback; }
}

// Atomic write: serialize to a sibling temp file then rename over the target so
// a crash mid-write never leaves a half-written (corrupt) JSON file.
export function saveJson(file, obj) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj));
  renameSync(tmp, file);
}

export function removeFile(file) {
  try { unlinkSync(file); return true; } catch { return false; }
}

// ─── JSONL append-only log ───
export function appendJsonl(file, obj) {
  ensureDir(path.dirname(file));
  appendFileSync(file, JSON.stringify(obj) + "\n");
}

export function readJsonl(file) {
  let raw;
  try { raw = readFileSync(file, "utf8"); } catch { return []; }
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* tolerate a torn final line */ }
  }
  return out;
}

export function truncateFile(file) {
  try { writeFileSync(file, ""); } catch {}
}

export function fileMtime(file) {
  try { return statSync(file).mtimeMs; } catch { return 0; }
}

// ─── Lightweight full-text search (FTS5 replacement) ───
// Cheap English stopword list — keeps scores meaningful without a real index.
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "is", "it", "for", "on",
  "with", "as", "by", "at", "be", "this", "that", "are", "was", "from",
]);

// Crude porter-ish stemmer: trims a few common English suffixes so "running"
// and "runs" collapse to "run". Not linguistically correct — just forgiving.
export function stem(w) {
  if (w.length <= 3) return w;
  for (const suf of ["ingly", "edly", "ing", "ies", "ed", "ly", "es", "s"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) return w.slice(0, -suf.length);
  }
  return w;
}

export function tokenize(s) {
  const m = String(s || "").toLowerCase().match(/[a-z0-9_]+/g);
  if (!m) return [];
  const out = [];
  for (const w of m) {
    if (w.length < 2 || STOP.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

// tf-idf-ish ranking over an in-memory array. getText(doc) returns the
// searchable string. Returns [{ doc, score, hits }] sorted best-first, where
// `hits` is the count of distinct query terms matched (primary sort key).
export function searchDocs(docs, getText, query, { limit = 10 } = {}) {
  const qterms = [...new Set(tokenize(query))];
  if (!qterms.length || !docs.length) return [];
  const qset = new Set(qterms);

  // document frequency per query term
  const df = new Map();
  const tfs = new Array(docs.length);
  for (let i = 0; i < docs.length; i++) {
    const toks = tokenize(getText(docs[i]));
    const tf = new Map();
    for (const t of toks) if (qset.has(t)) tf.set(t, (tf.get(t) || 0) + 1);
    tfs[i] = tf;
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  }

  const N = docs.length;
  const scored = [];
  for (let i = 0; i < docs.length; i++) {
    const tf = tfs[i];
    if (!tf.size) continue;
    let score = 0;
    for (const [t, f] of tf) {
      const idf = Math.log(1 + N / (1 + (df.get(t) || 0)));
      score += idf * (f / (f + 1.5)); // saturating term frequency
    }
    scored.push({ doc: docs[i], score, hits: tf.size });
  }
  scored.sort((a, b) => b.hits - a.hits || b.score - a.score);
  return scored.slice(0, limit);
}

// Build a short snippet around the first query-term match, wrapping matched
// words in the given delimiters (FTS5 snippet() analogue).
export function snippet(text, query, { window = 16, open = "«", close = "»", ellipsis = "…" } = {}) {
  const qset = new Set(tokenize(query));
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  let hit = words.findIndex(w => qset.has(stem(w.toLowerCase().replace(/[^a-z0-9_]/g, ""))));
  if (hit < 0) hit = 0;
  const start = Math.max(0, hit - Math.floor(window / 2));
  const seg = words.slice(start, start + window).map(w => {
    const norm = stem(w.toLowerCase().replace(/[^a-z0-9_]/g, ""));
    return qset.has(norm) ? `${open}${w}${close}` : w;
  });
  let out = seg.join(" ");
  if (start > 0) out = ellipsis + out;
  if (start + window < words.length) out += ellipsis;
  return out;
}
