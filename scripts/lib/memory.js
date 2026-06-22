// ROI/decay-scored memory store. Complements MEMORY.md by adding access
// counts, validity decay, and contradiction detection.
//
// Storage: a single flat JSON file ~/.slim/memory.json of shape
//   { seq: <next id>, items: [ <memory>, ... ] }
// loaded/saved atomically. Full-text search is the pure-JS tokenizing ranker
// from flatstore (BM25) — no node:sqlite, no native deps.
//
// Semantic search (hybrid BM25 + TF-IDF cosine) is provided by memory-embed.js.
// No model download required — works offline, always available.  Vectors are
// stored as `_svec` alongside each item and rebuilt from the corpus on demand.
import { createHash } from "node:crypto";
import path from "node:path";
import { slimDir } from "./telemetry.js";
import { loadJson, saveJson, searchDocs } from "./flatstore.js";
import * as Embed from "./memory-embed.js";

const TTL_BY_TYPE = { user: 365, feedback: 180, project: 60, reference: 365, convention: 365 };
const PROMOTE_AFTER = 5;

function file() { return path.join(slimDir(), "memory.json"); }

let _store = null;
function load() {
  if (_store) return _store;
  _store = loadJson(file(), { seq: 1, items: [] });
  if (!_store.items) _store = { seq: 1, items: [] };
  return _store;
}
function persist() { saveJson(file(), load()); }

function sha(s) { return createHash("sha1").update(s).digest("hex").slice(0, 16); }

function decay(m, now = Date.now()) {
  const days = Math.max(0, (now - m.last_used_ts) / 86400000);
  const halflife = m.ttl_days || 90;
  const useBoost = 1 + Math.log(1 + (m.access_count || 0)) / 4;
  const contraPenalty = Math.pow(0.7, m.contradictions || 0);
  const v = m.validity * Math.pow(0.5, days / halflife) * useBoost * contraPenalty;
  return Math.max(0, Math.min(1.5, v));
}

function findByName(type, name) {
  return load().items.find(m => m.type === type && m.name === name) || null;
}
function findById(id) {
  return load().items.find(m => m.id === id) || null;
}

// Rebuild IDF over the full corpus and re-embed any items missing `_svec`.
// Cheap — pure JS tokenization, no I/O. Called lazily before any search.
function _rebuildVecs(items) {
  const idf = Embed.buildIdf(items);
  let changed = false;
  for (const item of items) {
    if (item._svec) continue; // already embedded
    const vec = Embed.embedSparse(`${item.name} ${item.body}`, idf);
    item._svec = Object.fromEntries(vec);
    changed = true;
  }
  return { idf, changed };
}

/** Store a memory item. Clears `_svec` on update so it gets re-embedded. */
export function index({ type, name, body, source }) {
  if (!type || !name || !body) throw new Error("type, name, body required");
  const now = Date.now();
  const h = sha(body);
  const existing = findByName(type, name);
  if (existing) {
    if (existing.hash === h) {
      existing.last_used_ts = now;
      existing.access_count = (existing.access_count || 0) + 1;
      persist();
      return { id: existing.id, action: "refreshed" };
    }
    // Content changed — clear stale vector
    existing.body = body;
    existing.hash = h;
    existing.last_used_ts = now;
    existing.contradictions = (existing.contradictions || 0) + 1;
    existing._svec = undefined;
    if (source) existing.source = source;
    persist();
    return { id: existing.id, action: "updated_with_contradiction" };
  }
  const store = load();
  const id = store.seq++;
  store.items.push({
    id, type, name, body, source: source || null,
    created_ts: now, last_used_ts: now, access_count: 0,
    validity: 1.0, contradictions: 0, ttl_days: TTL_BY_TYPE[type] || 90, hash: h,
  });
  persist();
  return { id, action: "inserted" };
}

function touch(rows, now) {
  for (const r of rows) {
    r.last_used_ts = now;
    r.access_count = (r.access_count || 0) + 1;
  }
  if (rows.length) persist();
}

/**
 * Hybrid search: BM25 + TF-IDF cosine.
 * Corpus vectors are built/updated lazily before each search.
 */
export async function search({ query, type, limit = 10 }) {
  if (!query) return list({ type, limit });
  const items = load().items;
  const pool = items.filter(m => !type || m.type === type);
  if (!pool.length) return [];

  // ── ensure all pool items have vectors ───────────────────────────────────
  const { idf, changed } = _rebuildVecs(items); // rebuild over full corpus for IDF
  if (changed) persist();

  // ── BM25 pass ────────────────────────────────────────────────────────────
  const ftHits = searchDocs(pool, m => `${m.name} ${m.body}`, query, { limit: limit * 4 });
  const ftMap = new Map(ftHits.map(h => [h.doc.id, h.score]));
  const maxFt = ftHits.reduce((mx, h) => Math.max(mx, h.score), 0) || 1;

  // ── Cosine pass ──────────────────────────────────────────────────────────
  const qVec = Embed.embedSparse(query, idf);
  const cosMap = new Map();
  for (const item of pool) {
    const itemVec = Embed.restoreVec(item._svec);
    if (!itemVec) continue;
    const cos = Embed.cosine(qVec, itemVec);
    if (cos > 0.05) cosMap.set(item.id, cos); // skip near-zero hits
  }

  // ── Merge candidate set: BM25 hits ∪ top cosine hits ─────────────────────
  const candidateIds = new Set(ftHits.map(h => h.doc.id));
  const cosSorted = [...cosMap.entries()].sort((a, b) => b[1] - a[1]);
  for (const [id] of cosSorted.slice(0, limit * 2)) candidateIds.add(id);

  const now = Date.now();
  const candidates = pool.filter(m => candidateIds.has(m.id));

  const scored = candidates.map(m => {
    const ftNorm = (ftMap.get(m.id) || 0) / maxFt;
    const cosScore = cosMap.get(m.id) || 0;
    const score = Embed.hybridScore(cosScore, ftNorm);
    const dec = decay(m, now);
    return { m, score, dec };
  });

  scored.sort((a, b) => (b.dec - a.dec) || (b.score - a.score));
  const top = scored.slice(0, limit);
  touch(top.map(t => t.m), now);
  return top.map(t => toJson({ ...t.m, decay: t.dec, semantic: cosMap.has(t.m.id) }));
}

export function list({ type, limit = 50 }) {
  const now = Date.now();
  const rows = load().items
    .filter(m => !type || m.type === type)
    .slice()
    .sort((a, b) => b.last_used_ts - a.last_used_ts)
    .slice(0, limit);
  return rows.map(r => toJson({ ...r, decay: decay(r, now) }));
}

export function get({ id, type, name }) {
  let row = id != null ? findById(id) : (type && name ? findByName(type, name) : null);
  if (!row) return null;
  const now = Date.now();
  row.last_used_ts = now;
  row.access_count = (row.access_count || 0) + 1;
  let promoted = false;
  if (row.type === "feedback" && row.access_count >= PROMOTE_AFTER) {
    row.type = "convention";
    promoted = true;
  }
  persist();
  return toJson({ ...row, decay: decay(row, now), promoted });
}

export function forget({ id, type, name }) {
  const store = load();
  const before = store.items.length;
  if (id != null) store.items = store.items.filter(m => m.id !== id);
  else if (type && name) store.items = store.items.filter(m => !(m.type === type && m.name === name));
  else throw new Error("id or (type+name) required");
  const deleted = before - store.items.length;
  if (deleted) persist();
  return { deleted };
}

export function stats() {
  const items = load().items;
  const byTypeMap = new Map();
  for (const m of items) {
    let g = byTypeMap.get(m.type);
    if (!g) { g = { type: m.type, n: 0, sumV: 0, embedded: 0 }; byTypeMap.set(m.type, g); }
    g.n++; g.sumV += m.validity || 0;
    if (m._svec) g.embedded++;
  }
  const by_type = [...byTypeMap.values()].map(g => ({
    type: g.type, n: g.n,
    avg_validity: g.n ? g.sumV / g.n : 0,
    embedded: g.embedded,
  }));
  const top = items.slice()
    .sort((a, b) => (b.access_count || 0) - (a.access_count || 0))
    .slice(0, 5)
    .map(m => ({ id: m.id, type: m.type, name: m.name, access_count: m.access_count, validity: m.validity }));
  const totalEmbedded = items.filter(m => m._svec).length;
  return {
    total: items.length, embedded: totalEmbedded,
    semantic_ready: Embed.isReady(),
    by_type, top_accessed: top,
  };
}

/**
 * Force-rebuild all vectors from scratch (renames IDF over new corpus).
 * Useful after bulk imports or when the corpus has grown significantly.
 */
export async function embedAll() {
  const items = load().items;
  const result = await Embed.embedAll(items);
  if (result.embedded > 0) persist();
  return { ...result, total: items.length };
}

/** No-op kept for API compatibility with the warmup call in code-server.js. */
export function warmup() {}

// ─── internal ──────────────────────────────────────────────────────────────

function toJson(r) {
  return {
    id: r.id, type: r.type, name: r.name, body: r.body, source: r.source,
    created: new Date(r.created_ts).toISOString(),
    last_used: new Date(r.last_used_ts).toISOString(),
    access_count: r.access_count, validity: r.validity,
    decay: r.decay,
    contradictions: r.contradictions, ttl_days: r.ttl_days,
    promoted: r.promoted,
    semantic: r.semantic,  // true when cosine contributed to this result's rank
  };
}
