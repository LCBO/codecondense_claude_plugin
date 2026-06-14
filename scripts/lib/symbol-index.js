// ─── Local symbol index ───
// Shared between the MCP server (servers/code-server.js) and the CLI
// (cli/slim.js) so `/slim-stats` and `/slim-reindex` work regardless of the
// active MCP tool profile (the `Sql` tool is hidden in the default `lean`
// profile). The index is a flat JSON document — no SQL schema.
//   { files:   [{ id, path, lang, size, mtime }],
//     symbols: [{ file_id, name, kind, line }] }

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { loadJson, saveJson, fileMtime } from "./flatstore.js";
import { slimDir } from "./telemetry.js";
import { extractSymbols } from "../../servers/lib/treesitter-symbols.js";

const require = createRequire(import.meta.url);
let RG_PATH;
try { RG_PATH = require("@vscode/ripgrep").rgPath; } catch { RG_PATH = "rg"; }

export const LANG_BY_EXT = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js",
  py: "py", go: "go", rs: "rs", rb: "rb", java: "java",
  cpp: "cpp", cc: "cpp", c: "c", h: "c", hpp: "cpp", kt: "kt", sql: "sql",
};

export const SYMBOL_PATTERNS = {
  ts: [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
    /^\s*(?:export\s+)?class\s+(\w+)/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[:=]/,
    /^\s*(?:export\s+)?interface\s+(\w+)/,
    /^\s*(?:export\s+)?type\s+(\w+)/,
    /^\s*(?:export\s+)?enum\s+(\w+)/,
  ],
  py: [/^\s*(?:async\s+)?def\s+(\w+)/, /^\s*class\s+(\w+)/],
  go: [/^\s*func\s+(?:\([^)]+\)\s+)?(\w+)/, /^\s*type\s+(\w+)/],
  rs: [/^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/, /^\s*(?:pub\s+)?struct\s+(\w+)/, /^\s*(?:pub\s+)?enum\s+(\w+)/, /^\s*(?:pub\s+)?trait\s+(\w+)/],
  rb: [/^\s*def\s+(\w+)/, /^\s*class\s+(\w+)/, /^\s*module\s+(\w+)/],
  java: [/^\s*(?:public|private|protected)?\s*(?:static\s+)?\w[\w<>]*\s+(\w+)\s*\(/, /^\s*(?:public\s+)?class\s+(\w+)/],
  sql: [/^\s*create\s+(?:or\s+replace\s+)?(?:table|view|function|procedure|index)\s+(?:if\s+not\s+exists\s+)?[\w.]*?(\w+)/i],
};
SYMBOL_PATTERNS.tsx = SYMBOL_PATTERNS.ts;
SYMBOL_PATTERNS.js = SYMBOL_PATTERNS.ts;
SYMBOL_PATTERNS.jsx = SYMBOL_PATTERNS.ts;
SYMBOL_PATTERNS.cpp = SYMBOL_PATTERNS.java;
SYMBOL_PATTERNS.c = SYMBOL_PATTERNS.java;
SYMBOL_PATTERNS.kt = SYMBOL_PATTERNS.java;

export const IDENT_RE = /\b([A-Za-z_][A-Za-z0-9_]{2,})\b/g;

async function listFilesViaRg(cwd) {
  const out = await new Promise((resolve) => {
    const c = spawn(RG_PATH, ["--files"], { cwd });
    let so = "";
    c.stdout.on("data", (d) => (so += d));
    c.on("close", () => resolve(so));
    c.on("error", () => resolve(so));
  });
  return out.split("\n").filter(Boolean);
}

export function indexPath() {
  return path.join(slimDir(), "index.json");
}

// Cached in-process, invalidated by file mtime.
let _index = null, _indexMtime = -1;
export function loadIndex() {
  const m = fileMtime(indexPath());
  if (_index && m === _indexMtime) return _index;
  _index = loadJson(indexPath(), { files: [], symbols: [] });
  if (!_index.files || !_index.symbols) _index = { files: [], symbols: [] };
  _indexMtime = m;
  return _index;
}
export function saveIndex(idx) {
  saveJson(indexPath(), idx);
  _index = idx;
  _indexMtime = fileMtime(indexPath());
}

// Extract a file's symbols into index rows for a given file id. Prefers
// AST-accurate tree-sitter kinds (function/class/method/...), with no
// string/comment false positives; falls back to the line-regex patterns when no
// grammar/runtime is available (e.g. sql). Shared by reindex + updateIndexFile.
async function symbolRowsFor(relFile, content, lang, fid) {
  const rows = [];
  let ast = null;
  try { ast = await extractSymbols(relFile, content); } catch { ast = null; }
  if (ast) {
    for (const s of ast) rows.push({ file_id: fid, name: s.name, kind: lang, type: s.type, line: s.line });
  } else {
    const lines = content.split("\n");
    const pats = SYMBOL_PATTERNS[lang] || [];
    for (let i = 0; i < lines.length; i++) {
      for (const p of pats) {
        const m = lines[i].match(p);
        if (m && m[1]) rows.push({ file_id: fid, name: m[1], kind: lang, type: "symbol", line: i + 1 });
      }
    }
  }
  return { rows, ast: !!ast };
}

export async function reindex(cwd = process.cwd()) {
  const files = await listFilesViaRg(cwd);
  const idx = { files: [], symbols: [] };
  let fid = 0, sym = 0;
  for (const f of files) {
    const ext = f.split(".").pop();
    const lang = LANG_BY_EXT[ext];
    if (!lang) continue;
    let stat, content;
    try { stat = await fs.stat(path.resolve(cwd, f)); content = await fs.readFile(path.resolve(cwd, f), "utf8"); } catch { continue; }
    fid++;
    idx.files.push({ id: fid, path: f, lang, size: stat.size, mtime: Math.floor(stat.mtimeMs) });
    const { rows } = await symbolRowsFor(f, content, lang, fid);
    for (const r of rows) { idx.symbols.push(r); sym++; }
  }
  saveIndex(idx);
  return { files: idx.files.length, symbols: sym };
}

// Incremental update for a SINGLE file after an Edit/Write (NEXT-STEPS #4) —
// reparse just that file and swap its rows in place, instead of a full rebuild.
// Best-effort and cheap (one parse). Rules:
//   • No-op if the index hasn't been built yet (files.length === 0) — we don't
//     want a single edit to fabricate a one-file "index" that masks staleness;
//     the first Investigate still does the full build.
//   • No-op for unindexed extensions.
//   • If the file vanished, drop it from the index instead.
export async function updateIndexFile(cwd, relFile) {
  const idx = loadIndex();
  if (idx.files.length === 0) return { skipped: "no-index" };
  const ext = String(relFile).split(".").pop();
  const lang = LANG_BY_EXT[ext];
  if (!lang) return { skipped: "unindexed-ext" };
  const abs = path.resolve(cwd, relFile);
  let stat, content;
  try { stat = await fs.stat(abs); content = await fs.readFile(abs, "utf8"); }
  catch { return removeIndexFile(cwd, relFile); }

  let rec = idx.files.find((f) => f.path === relFile);
  let fid;
  if (rec) {
    fid = rec.id;
    rec.lang = lang; rec.size = stat.size; rec.mtime = Math.floor(stat.mtimeMs);
    idx.symbols = idx.symbols.filter((s) => s.file_id !== fid);
  } else {
    fid = idx.files.reduce((m, f) => Math.max(m, f.id), 0) + 1;
    idx.files.push({ id: fid, path: relFile, lang, size: stat.size, mtime: Math.floor(stat.mtimeMs) });
  }
  const { rows, ast } = await symbolRowsFor(relFile, content, lang, fid);
  for (const r of rows) idx.symbols.push(r);
  saveIndex(idx);
  return { file: relFile, symbols: rows.length, ast };
}

// Drop a file (and its symbols) from the index. No-op if not indexed.
export function removeIndexFile(cwd, relFile) {
  const idx = loadIndex();
  const rec = idx.files.find((f) => f.path === relFile);
  if (!rec) return { skipped: "not-indexed" };
  idx.files = idx.files.filter((f) => f.id !== rec.id);
  idx.symbols = idx.symbols.filter((s) => s.file_id !== rec.id);
  saveIndex(idx);
  return { file: relFile, removed: true };
}

// Structured queries over the local symbol index. Raw SQL was removed with the
// SQLite backend; op:'search' is the workhorse (substring match on symbol name,
// optional kind/file filters).
export function runSql({ op, name, kind, type, file, like, limit = 50 }) {
  const idx = loadIndex();
  if (op === "schema") return { tables: [{ name: "files" }, { name: "symbols" }] };
  if (op === "stats") return { files: idx.files.length, symbols: idx.symbols.length };
  if (op === "search") {
    const fileById = new Map(idx.files.map(f => [f.id, f.path]));
    const needle = String(name || like || "").toLowerCase();
    let rows = idx.symbols;
    if (needle) rows = rows.filter(s => s.name.toLowerCase().includes(needle));
    if (kind) rows = rows.filter(s => s.kind === kind);
    if (type) rows = rows.filter(s => s.type === type);
    if (file) rows = rows.filter(s => (fileById.get(s.file_id) || "").includes(file));
    rows = rows.slice(0, limit).map(s => ({ name: s.name, kind: s.kind, type: s.type ?? null, line: s.line, file: fileById.get(s.file_id) }));
    return { rows, count: rows.length };
  }
  if (op === "query") {
    return { error: "raw SQL on the local index was removed; use op:'search' with { name, kind, file, limit }" };
  }
  return { error: `unknown local op ${op}` };
}
