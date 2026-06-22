// Semantic similarity for the memory store — corpus-aware TF-IDF vectors.
//
// No model download, no network, no native deps. Works offline immediately.
//
// How it works
// ────────────
// Each memory item is represented as a sparse TF-IDF vector over the shared
// vocabulary built from all stored items. Cosine similarity between the query
// vector and item vectors surfaces semantically related memories even when
// exact keywords don't match — e.g. "authentication" will find memories that
// discuss "JWT", "token", "login" because those terms co-occur.
//
// A small dev-term synonym table expands queries before vectorisation so
// common abbreviations bridge correctly ("pkg" → "package", "auth" → "authentication").
//
// Mix weight ALPHA controls BM25 ↔ cosine blend (0 = pure BM25, 1 = pure cosine).
// At 0.55 the cosine score dominates while BM25 acts as a tiebreaker.
//
// Public API  (mirrors the neural-model API so callers are identical)
//   isReady()                         → boolean (always true)
//   warmup()                          → Promise (no-op, resolves immediately)
//   embed(text, idf)                  → Float32Array | null
//   cosine(a, b)                      → number 0–1
//   hybridScore(cosScore, bm25Score)  → number
//   embedAll(items)                   → Promise<{embedded, skipped}>
//   buildIdf(items)                   → Map<term, idf_weight>
//
// Vectors stored in items as `_vec` (plain JS array, JSON-safe).

import { tokenize } from "./flatstore.js";

const ALPHA = 0.55;

// ─── synonym expansion ────────────────────────────────────────────────────
// Each entry: [ canonical, ...synonyms ] — synonyms are rewritten to canonical
// before tokenisation so they share the same IDF bucket.
const SYNONYMS = [
  ["package",      "pkg", "packages", "dependency", "dep", "deps", "module", "lib", "library"],
  ["install",      "setup", "installed", "installing"],
  ["authenticate", "auth", "authentication", "login", "signin", "sign-in", "credential", "credentials"],
  ["token",        "jwt", "bearer", "api-key", "apikey", "secret", "session", "cookie"],
  ["password",     "passwd", "pass", "passphrase", "credentials"],
  ["database",     "db", "sql", "postgres", "postgresql", "mysql", "sqlite", "mongo", "mongodb", "redis"],
  ["error",        "err", "exception", "bug", "fail", "failure", "crash"],
  ["test",         "tests", "testing", "spec", "specs", "unit-test", "jest", "vitest", "mocha"],
  ["deploy",       "deployment", "release", "ship", "ci", "cd", "pipeline", "build"],
  ["config",       "configuration", "settings", "options", "env", "environment"],
  ["typescript",   "ts", "tsx", "type", "types", "typing"],
  ["javascript",   "js", "jsx", "node", "nodejs", "esm"],
  ["python",       "py", "pip", "venv", "virtualenv"],
  ["function",     "fn", "func", "method", "handler", "callback"],
  ["component",    "widget", "element", "view", "page"],
  ["api",          "endpoint", "route", "rest", "graphql", "http", "request", "response"],
  ["format",       "formatter", "formatting", "style", "lint", "linter", "prettier", "eslint"],
  ["performance",  "perf", "optimize", "optimise", "speed", "cache", "caching", "slow", "fast"],
  ["version",      "semver", "bump", "upgrade", "update", "migration", "migrate"],
  ["branch",       "git", "commit", "pr", "pull-request", "merge", "repo", "repository"],
];

// Build synonym→canonical map once
const SYN_MAP = new Map();
for (const [canonical, ...syns] of SYNONYMS) {
  for (const s of syns) SYN_MAP.set(s, canonical);
}

function expandTerms(tokens) {
  return tokens.map(t => SYN_MAP.get(t) ?? t);
}

// ─── IDF builder ─────────────────────────────────────────────────────────
/**
 * Build an IDF weight map from a corpus of items.
 * Returns Map<term, idf_weight>.
 */
export function buildIdf(items) {
  const N = items.length;
  if (N === 0) return new Map();
  const df = new Map();
  for (const item of items) {
    const terms = new Set(expandTerms(tokenize(`${item.name} ${item.body}`)));
    for (const t of terms) df.set(t, (df.get(t) || 0) + 1);
  }
  const idf = new Map();
  for (const [t, freq] of df) {
    idf.set(t, Math.log((N + 1) / (freq + 1)) + 1); // smoothed IDF
  }
  return idf;
}

// ─── public ──────────────────────────────────────────────────────────────

/** Always ready — no model load needed. */
export function isReady() { return true; }

/** No-op — kept for API compatibility with the neural-model variant. */
export async function warmup() {}

/**
 * Embed text as a sparse TF-IDF vector.
 * @param {string} text
 * @param {Map<string,number>} idf  — pre-built IDF map (pass null to get raw TF)
 * @returns {Map<string,number>}    — sparse vector (term → weighted score)
 */
export function embedSparse(text, idf) {
  const raw = tokenize(text);
  const terms = expandTerms(raw);
  const tf = new Map();
  for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
  if (!idf || !idf.size) return tf; // raw TF fallback
  const vec = new Map();
  for (const [t, f] of tf) {
    const w = idf.get(t) || 0;
    if (w > 0) vec.set(t, (f / (f + 1.5)) * w); // BM25-saturated TF × IDF
  }
  return vec;
}

/**
 * Cosine similarity between two sparse vectors (Map<term, score>).
 * Returns 0–1.
 */
export function cosine(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (const [t, va] of a) {
    normA += va * va;
    const vb = b.get(t);
    if (vb !== undefined) dot += va * vb;
  }
  for (const vb of b.values()) normB += vb * vb;
  if (normA === 0 || normB === 0) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
}

/**
 * Blend cosine + BM25 into a single score.
 * bm25Norm should be in [0, 1] (caller normalises by max BM25 score).
 */
export function hybridScore(cosScore, bm25Norm) {
  return ALPHA * cosScore + (1 - ALPHA) * bm25Norm;
}

/**
 * Embed all items that don't yet have `_svec` (sparse vector).
 * Called by Memory.embedAll() and transparently on every search.
 * Stores the sparse vector as `_svec` (plain object, JSON-safe).
 */
export async function embedAll(items) {
  const idf = buildIdf(items);
  let embedded = 0, skipped = 0;
  for (const item of items) {
    const vec = embedSparse(`${item.name} ${item.body}`, idf);
    item._svec = Object.fromEntries(vec);
    embedded++;
  }
  return { embedded, skipped };
}

/** Restore a stored `_svec` plain-object back to a Map for cosine(). */
export function restoreVec(obj) {
  if (!obj) return null;
  if (obj instanceof Map) return obj;
  return new Map(Object.entries(obj).map(([k, v]) => [k, Number(v)]));
}
