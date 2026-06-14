// Minimal LSP client over stdio. Spawns one server per language, caches it.
// Config: ~/.slim/lsp.json e.g.
// { "ts": ["typescript-language-server","--stdio"],
//   "py": ["pyright-langserver","--stdio"],
//   "go": ["gopls"], "rs": ["rust-analyzer"] }
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { safeWriteFile } from "./guardrails.js";

const EXT_LANG = {
  ts: "typescript", tsx: "typescriptreact", js: "javascript", jsx: "javascriptreact",
  py: "python", go: "go", rs: "rust", java: "java", rb: "ruby",
  cpp: "cpp", c: "c", h: "c", hpp: "cpp", kt: "kotlin",
};
const EXT_KEY = {
  ts: "ts", tsx: "ts", js: "ts", jsx: "ts", mjs: "ts", cjs: "ts",
  py: "py", go: "go", rs: "rs", java: "java", rb: "rb",
  cpp: "cpp", c: "cpp", h: "cpp", hpp: "cpp", kt: "kt",
};

let _config;
async function loadConfig() {
  if (_config !== undefined) return _config;
  const p = path.join(os.homedir(), ".slim", "lsp.json");
  try { _config = JSON.parse(await fs.readFile(p, "utf8")); }
  catch { _config = {}; }
  return _config;
}

const servers = new Map(); // key -> { proc, send, pending, nextId, openDocs, ready, diagnostics }

function startServer(key, cmd, root) {
  const proc = spawn(cmd[0], cmd.slice(1), { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  const diagnostics = new Map(); // uri -> Diagnostic[]
  let nextId = 1;
  let buffer = Buffer.alloc(0);

  proc.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const m = /Content-Length:\s*(\d+)/.exec(header);
      if (!m) { buffer = buffer.slice(headerEnd + 4); continue; }
      const len = +m[1];
      const total = headerEnd + 4 + len;
      if (buffer.length < total) return;
      const body = buffer.slice(headerEnd + 4, total).toString("utf8");
      buffer = buffer.slice(total);
      let msg; try { msg = JSON.parse(body); } catch { continue; }
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || "lsp error"));
        else resolve(msg.result);
      } else if (msg.method === "textDocument/publishDiagnostics" && msg.params) {
        const uri = msg.params.uri;
        diagnostics.set(uri, msg.params.diagnostics || []);
      } else if (msg.method && msg.id != null) {
        // server->client request — reply empty so it doesn't hang
        const reply = { jsonrpc: "2.0", id: msg.id, result: null };
        const rb = JSON.stringify(reply);
        try { proc.stdin.write(`Content-Length: ${Buffer.byteLength(rb)}\r\n\r\n${rb}`); } catch {}
      }
    }
  });
  proc.stderr.on("data", () => {}); // silence
  proc.on("exit", () => { servers.delete(key); });

  function send(method, params, expectReply = true) {
    const id = expectReply ? nextId++ : undefined;
    const msg = { jsonrpc: "2.0", method, params };
    if (id != null) msg.id = id;
    const body = JSON.stringify(msg);
    proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    if (id == null) return;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("lsp timeout: " + method)); } }, 15000);
    });
  }

  return { proc, send, pending, diagnostics, openDocs: new Set(), ready: null };
}

async function ensureServer(key, root) {
  if (servers.has(key)) return servers.get(key);
  const cfg = await loadConfig();
  const cmd = cfg[key];
  if (!cmd) throw new Error(`no LSP configured for '${key}' — add to ~/.slim/lsp.json`);
  const s = startServer(key, cmd, root);
  servers.set(key, s);
  s.ready = (async () => {
    await s.send("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(root).href,
      capabilities: {
        textDocument: {
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
          hover: { dynamicRegistration: false },
          rename: { dynamicRegistration: false, prepareSupport: true },
          implementation: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: false },
        },
        workspace: { symbol: { dynamicRegistration: false }, applyEdit: true, workspaceEdit: { documentChanges: true } },
      },
    });
    s.send("initialized", {}, false);
  })();
  await s.ready;
  return s;
}

async function ensureOpen(s, file) {
  if (s.openDocs.has(file)) return;
  const ext = file.split(".").pop();
  const lang = EXT_LANG[ext] || "plaintext";
  const text = await fs.readFile(file, "utf8");
  s.send("textDocument/didOpen", {
    textDocument: { uri: pathToFileURL(file).href, languageId: lang, version: 1, text },
  }, false);
  s.openDocs.add(file);
}

function extKey(file) {
  return EXT_KEY[file.split(".").pop()];
}

export async function workspaceSymbol({ query, file, root }) {
  const key = file ? extKey(file) : null;
  if (!key) throw new Error("need `file` (or pass language `key`) so the right server is picked");
  const s = await ensureServer(key, root || process.cwd());
  if (file) await ensureOpen(s, path.resolve(root || process.cwd(), file));
  const r = await s.send("workspace/symbol", { query });
  return Array.isArray(r) ? r : [];
}

export async function definition({ file, line, character, root }) {
  const key = extKey(file);
  if (!key) throw new Error("unsupported extension");
  const s = await ensureServer(key, root || process.cwd());
  const abs = path.resolve(root || process.cwd(), file);
  await ensureOpen(s, abs);
  return await s.send("textDocument/definition", {
    textDocument: { uri: pathToFileURL(abs).href },
    position: { line: line - 1, character },
  });
}

export async function references({ file, line, character, includeDeclaration = true, root }) {
  const key = extKey(file);
  if (!key) throw new Error("unsupported extension");
  const s = await ensureServer(key, root || process.cwd());
  const abs = path.resolve(root || process.cwd(), file);
  await ensureOpen(s, abs);
  return await s.send("textDocument/references", {
    textDocument: { uri: pathToFileURL(abs).href },
    position: { line: line - 1, character },
    context: { includeDeclaration },
  });
}

export async function hover({ file, line, character, root }) {
  const key = extKey(file);
  if (!key) throw new Error("unsupported extension");
  const s = await ensureServer(key, root || process.cwd());
  const abs = path.resolve(root || process.cwd(), file);
  await ensureOpen(s, abs);
  return await s.send("textDocument/hover", {
    textDocument: { uri: pathToFileURL(abs).href },
    position: { line: line - 1, character },
  });
}

// ---- new ops ----

function posKey(file, line, character) {
  return { textDocument: { uri: pathToFileURL(file).href }, position: { line: line - 1, character: character || 0 } };
}

async function prep(file, root) {
  const key = extKey(file);
  if (!key) throw new Error("unsupported extension: " + file);
  const s = await ensureServer(key, root || process.cwd());
  const abs = path.resolve(root || process.cwd(), file);
  await ensureOpen(s, abs);
  return { s, abs };
}

export async function documentSymbols({ file, root }) {
  const { s, abs } = await prep(file, root);
  const r = await s.send("textDocument/documentSymbol", { textDocument: { uri: pathToFileURL(abs).href } });
  return Array.isArray(r) ? r : [];
}

// Find a symbol's range by name in a file's documentSymbol tree.
function findSymbolRange(symbols, name) {
  for (const sym of symbols) {
    if (sym.name === name) return { range: sym.range || sym.location?.range, selectionRange: sym.selectionRange };
    if (sym.children) {
      const hit = findSymbolRange(sym.children, name);
      if (hit) return hit;
    }
  }
  return null;
}

export async function findSymbol({ file, symbol, root }) {
  const syms = await documentSymbols({ file, root });
  return findSymbolRange(syms, symbol);
}

export async function implementations({ file, line, character, root }) {
  const { s, abs } = await prep(file, root);
  return await s.send("textDocument/implementation", posKey(abs, line, character));
}

export async function diagnosticsFor({ file, root, waitMs = 1500 }) {
  const { s, abs } = await prep(file, root);
  const uri = pathToFileURL(abs).href;
  // Trigger re-analysis by didChange-noop. Many servers push on didOpen already; wait briefly.
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    if (s.diagnostics.has(uri)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  return s.diagnostics.get(uri) || [];
}

export async function rename({ file, line, character, newName, root }) {
  const { s, abs } = await prep(file, root);
  const we = await s.send("textDocument/rename", { ...posKey(abs, line, character), newName });
  if (!we) return { files: 0, edits: 0 };
  return await applyWorkspaceEdit(we, root || process.cwd());
}

// Apply a WorkspaceEdit to disk. Returns { files, edits }.
export async function applyWorkspaceEdit(we, cwd) {
  const fileEdits = new Map(); // abs -> [{range,newText}]
  if (we.documentChanges) {
    for (const dc of we.documentChanges) {
      if (!dc.textDocument || !dc.edits) continue;
      const abs = fileURLToPath(dc.textDocument.uri);
      fileEdits.set(abs, (fileEdits.get(abs) || []).concat(dc.edits));
    }
  } else if (we.changes) {
    for (const [uri, edits] of Object.entries(we.changes)) {
      const abs = fileURLToPath(uri);
      fileEdits.set(abs, edits);
    }
  }
  let totalEdits = 0;
  for (const [abs, edits] of fileEdits) {
    const oldContent = await fs.readFile(abs, "utf8");
    const newContent = applyTextEdits(oldContent, edits);
    if (newContent !== oldContent) {
      await safeWriteFile(abs, newContent, { cwd });
      totalEdits += edits.length;
      // refresh open doc in any servers
      for (const s of servers.values()) {
        if (s.openDocs.has(abs)) {
          s.openDocs.delete(abs);
          await ensureOpen(s, abs);
        }
      }
    }
  }
  return { files: fileEdits.size, edits: totalEdits };
}

function applyTextEdits(content, edits) {
  // Sort descending by start position so offsets remain valid.
  const lines = content.split("\n");
  const sorted = [...edits].sort((a, b) => {
    const ar = a.range.start, br = b.range.start;
    if (ar.line !== br.line) return br.line - ar.line;
    return br.character - ar.character;
  });
  for (const e of sorted) {
    const { start, end } = e.range;
    const before = lines.slice(0, start.line);
    const after = lines.slice(end.line + 1);
    const startLine = lines[start.line] || "";
    const endLine = lines[end.line] || "";
    const head = startLine.slice(0, start.character);
    const tail = endLine.slice(end.character);
    const replacement = (head + e.newText + tail).split("\n");
    lines.splice(0, lines.length, ...before, ...replacement, ...after);
  }
  return lines.join("\n");
}

// Replace a symbol's full body. Looks up by name via documentSymbol.
export async function replaceSymbolBody({ file, symbol, newBody, root }) {
  const { abs } = await prep(file, root);
  const found = await findSymbol({ file, symbol, root });
  if (!found) throw new Error(`symbol not found: ${symbol}`);
  const oldContent = await fs.readFile(abs, "utf8");
  const newContent = applyTextEdits(oldContent, [{ range: found.range, newText: newBody }]);
  await safeWriteFile(abs, newContent, { cwd: root || process.cwd() });
  return { file: abs, ok: true };
}

export async function insertAroundSymbol({ file, symbol, content, position, root }) {
  const { abs } = await prep(file, root);
  const found = await findSymbol({ file, symbol, root });
  if (!found) throw new Error(`symbol not found: ${symbol}`);
  const r = found.range;
  const point = position === "before"
    ? { start: r.start, end: r.start }
    : { start: r.end, end: r.end };
  const oldContent = await fs.readFile(abs, "utf8");
  const text = position === "before" ? content + "\n" : "\n" + content;
  const newContent = applyTextEdits(oldContent, [{ range: point, newText: text }]);
  await safeWriteFile(abs, newContent, { cwd: root || process.cwd() });
  return { file: abs, ok: true };
}

export async function safeDelete({ file, line, character, root }) {
  const { s, abs } = await prep(file, root);
  // Count refs (excluding declaration). Refuse if any external use.
  const refs = await s.send("textDocument/references", { ...posKey(abs, line, character), context: { includeDeclaration: false } });
  if (Array.isArray(refs) && refs.length > 0) {
    return { ok: false, refs: refs.length, message: `refused: ${refs.length} references exist` };
  }
  // Fallback to documentSymbol + delete that range.
  const syms = await documentSymbols({ file, root });
  // try to find a symbol whose selectionRange contains the position
  const target = findSymbolAtPosition(syms, line - 1, character || 0);
  if (!target) return { ok: false, message: "could not locate symbol range to delete" };
  const oldContent = await fs.readFile(abs, "utf8");
  const newContent = applyTextEdits(oldContent, [{ range: target.range, newText: "" }]);
  await safeWriteFile(abs, newContent, { cwd: root || process.cwd() });
  return { ok: true, file: abs };
}

function findSymbolAtPosition(symbols, line, character) {
  for (const sym of symbols) {
    const r = sym.range || sym.location?.range;
    if (!r) continue;
    const inside = (line > r.start.line || (line === r.start.line && character >= r.start.character))
      && (line < r.end.line || (line === r.end.line && character <= r.end.character));
    if (inside) {
      if (sym.children) {
        const c = findSymbolAtPosition(sym.children, line, character);
        if (c) return c;
      }
      return { range: r, name: sym.name };
    }
  }
  return null;
}

export async function shutdownAll() {
  for (const [k, s] of servers) {
    try { await s.send("shutdown", {}); s.send("exit", {}, false); } catch {}
    s.proc.kill();
    servers.delete(k);
  }
}
