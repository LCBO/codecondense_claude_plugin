// ROI/decay-scored memory store. Complements MEMORY.md by adding access
// counts, validity decay, and contradiction detection.
//
// Storage: a single flat JSON file ~/.slim/memory.json of shape
//   { seq: <next id>, items: [ <memory>, ... ] }
// loaded/saved atomically. Full-text search is the pure-JS tokenizing ranker
// from flatstore (FTS5 replacement) — no node:sqlite, no native deps.
import { createHash } from "node:crypto";
import path from "node:path";
import { slimDir } from "./telemetry.js";
import { loadJson, saveJson, searchDocs } from "./flatstore.js";

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
  // Half-life style decay, dampened by access count, hurt by contradictions.
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

export function index({ type, name, body, source }) {
  if (!type || !name || !body) throw new Error("type, name, body required");
  const now = Date.now();
  const h = sha(body);
  const existing = findByName(type, name);
  if (existing) {
    if (existing.hash === h) {
      // identical content → just bump last_used + access
      existing.last_used_ts = now;
      existing.access_count = (existing.access_count || 0) + 1;
      persist();
      return { id: existing.id, action: "refreshed" };
    }
    // contradiction: body changed
    existing.body = body;
    existing.hash = h;
    existing.last_used_ts = now;
    existing.contradictions = (existing.contradictions || 0) + 1;
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

export function search({ query, type, limit = 10 }) {
  if (!query) return list({ type, limit });
  const pool = load().items.filter(m => !type || m.type === type);
  const hits = searchDocs(pool, m => `${m.name} ${m.body}`, query, { limit: limit * 3 });
  if (!hits.length) return list({ type, limit });
  const now = Date.now();
  const scored = hits.map(h => ({ m: h.doc, ftScore: h.score, dec: decay(h.doc, now) }));
  // Re-rank by decay first (freshness/usefulness), then text relevance.
  scored.sort((a, b) => (b.dec - a.dec) || (b.ftScore - a.ftScore));
  const top = scored.slice(0, limit);
  touch(top.map(t => t.m), now);
  return top.map(t => toJson({ ...t.m, decay: t.dec }));
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
  // Auto-promote feedback → convention after repeated use.
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
    if (!g) { g = { type: m.type, n: 0, sumV: 0 }; byTypeMap.set(m.type, g); }
    g.n++; g.sumV += m.validity || 0;
  }
  const by_type = [...byTypeMap.values()].map(g => ({ type: g.type, n: g.n, avg_validity: g.n ? g.sumV / g.n : 0 }));
  const top = items.slice()
    .sort((a, b) => (b.access_count || 0) - (a.access_count || 0))
    .slice(0, 5)
    .map(m => ({ id: m.id, type: m.type, name: m.name, access_count: m.access_count, validity: m.validity }));
  return { total: items.length, by_type, top_accessed: top };
}

function toJson(r) {
  return {
    id: r.id, type: r.type, name: r.name, body: r.body, source: r.source,
    created: new Date(r.created_ts).toISOString(),
    last_used: new Date(r.last_used_ts).toISOString(),
    access_count: r.access_count, validity: r.validity,
    decay: r.decay,
    contradictions: r.contradictions, ttl_days: r.ttl_days,
    promoted: r.promoted,
  };
}
