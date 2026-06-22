// Post-edit syntax validation. Returns up to N errors as {line, message}.
//
// Built-ins (zero dep): JSON.
// Optional (lazy require, ignored if missing): typescript, yaml, html-validate.
// Cross-language (tree-sitter / WASM, lazy): Python/Go/Rust/Java/C/C++.
// Trims to first 3 errors so the response stays compact.

import path from "node:path";
import { validateWithTreeSitter } from "./treesitter-validate.js";

const MAX_ERRORS = 3;

let _ts = null;     // typescript module
let _yaml = null;   // yaml module
let _hv = null;     // html-validate module
let _loaded = { ts: false, yaml: false, hv: false };

async function loadTS() {
  if (_loaded.ts) return _ts;
  _loaded.ts = true;
  try { _ts = (await import("typescript")).default; } catch { _ts = null; }
  return _ts;
}
async function loadYaml() {
  if (_loaded.yaml) return _yaml;
  _loaded.yaml = true;
  try { _yaml = await import("yaml"); } catch { _yaml = null; }
  return _yaml;
}
async function loadHV() {
  if (_loaded.hv) return _hv;
  _loaded.hv = true;
  try { _hv = await import("html-validate"); } catch { _hv = null; }
  return _hv;
}

function validateJSON(content) {
  try { JSON.parse(content); return null; }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const m = /line (\d+)|position (\d+)/i.exec(msg);
    let line = 1;
    if (m && m[1]) line = Number(m[1]);
    else if (m && m[2]) line = content.slice(0, Number(m[2])).split("\n").length;
    return [{ line, message: msg }];
  }
}

async function validateTS(file, content) {
  const ts = await loadTS();
  if (!ts) return null;
  const lower = file.toLowerCase();
  const kind = lower.endsWith(".tsx") || lower.endsWith(".jsx") ? ts.ScriptKind.TSX
    : lower.endsWith(".mjs") || lower.endsWith(".js") ? ts.ScriptKind.JS
    : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind);
  const diags = sf.parseDiagnostics || [];
  if (!diags.length) return null;
  const out = [];
  for (const d of diags) {
    if (d.start == null) continue;
    const { line } = sf.getLineAndCharacterOfPosition(d.start);
    out.push({ line: line + 1, message: ts.flattenDiagnosticMessageText(d.messageText, "\n") });
  }
  return out.length ? out : null;
}

async function validateYAML(content) {
  const y = await loadYaml();
  if (!y) return null;
  const docs = y.parseAllDocuments(content, { uniqueKeys: false });
  const errs = [];
  for (const d of docs) {
    for (const e of d.errors || []) {
      errs.push({ line: (e.linePos?.[0]?.line) ?? 1, message: e.message });
    }
  }
  return errs.length ? errs : null;
}

async function validateHTML(content) {
  const m = await loadHV();
  if (!m) return null;
  const HtmlValidate = m.HtmlValidate || m.default?.HtmlValidate;
  if (!HtmlValidate) return null;
  const v = new HtmlValidate();
  const r = await v.validateString(content);
  if (r.valid) return null;
  const errs = [];
  for (const result of r.results || []) {
    for (const msg of result.messages || []) {
      if (msg.severity < 2) continue;  // warnings only — skip
      errs.push({ line: msg.line, message: msg.message });
    }
  }
  return errs.length ? errs : null;
}

export async function validateContent(file, content) {
  const ext = path.extname(file).slice(1).toLowerCase();
  let errs = null;
  switch (ext) {
    case "json": errs = validateJSON(content); break;
    case "ts": case "tsx": case "js": case "jsx": case "mjs": case "cjs":
      errs = await validateTS(file, content); break;
    case "yaml": case "yml":
      errs = await validateYAML(content); break;
    case "html": case "htm":
      errs = await validateHTML(content); break;
    default:
      // Python/Go/Rust/Java/C/C++ etc. via tree-sitter (returns null for
      // unknown extensions or when grammars/runtime aren't available).
      errs = await validateWithTreeSitter(file, content); break;
  }
  if (!errs || !errs.length) return null;
  return errs.slice(0, MAX_ERRORS).concat(
    errs.length > MAX_ERRORS ? [{ line: 0, message: `...and ${errs.length - MAX_ERRORS} more` }] : []
  );
}

export function formatErrors(errs) {
  if (!errs || !errs.length) return "";
  const lines = errs.map((e) =>
    e.line === 0 ? "  " + e.message : `  Line ${e.line}: ${e.message}`
  );
  return "\nSyntax errors in file:\n" + lines.join("\n");
}
