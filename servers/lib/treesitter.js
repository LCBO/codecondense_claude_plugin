// Shared tree-sitter runtime loader (pure WASM via web-tree-sitter). Grammars
// come from the `tree-sitter-wasms` package (36 languages), with override dirs
// ($SLIM_GRAMMARS_DIR, ~/.slim/grammars, plugin grammars/). Version-agnostic
// across web-tree-sitter API shapes. Used by both syntax validation and the AST
// symbol index. Lazy + cached + graceful: returns null when unavailable.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _mod = null, _init = null, _parser = null, _disabled = false;
const _langs = new Map();

function wasmsDir() {
  try { return path.join(path.dirname(require.resolve("tree-sitter-wasms/package.json")), "out"); }
  catch { return null; }
}
function grammarDirs() {
  const dirs = [];
  if (process.env.SLIM_GRAMMARS_DIR) dirs.push(process.env.SLIM_GRAMMARS_DIR);
  dirs.push(path.join(process.env.SLIM_HOME || path.join(os.homedir(), ".slim"), "grammars"));
  const w = wasmsDir(); if (w) dirs.push(w);
  dirs.push(path.resolve(__dirname, "..", "..", "grammars"));
  return dirs;
}
export function findGrammar(name) {
  for (const d of grammarDirs()) {
    const p = path.join(d, `tree-sitter-${name}.wasm`);
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}
async function loadModule() {
  if (_disabled) return null;
  if (_mod) return _mod;
  try {
    const M = await import("web-tree-sitter");
    const Parser = M.Parser || M.default || M;
    if (!Parser || !Parser.init) { _disabled = true; return null; }
    _mod = { Parser, M };  // Language is resolved post-init (it's Parser.Language in 0.2x)
  } catch { _disabled = true; return null; }
  return _mod;
}

// { parser, lang } ready to parse, or null. Parser is shared — set the language
// per parse via the returned lang (callers do parser.setLanguage(lang)).
export async function getParser(name) {
  if (_langs.has(name)) {
    const lang = _langs.get(name);
    return lang ? { parser: _parser, lang } : null;
  }
  const m = await loadModule();
  if (!m) { _langs.set(name, null); return null; }
  try {
    if (!_init) _init = m.Parser.init();
    await _init;
    const Language = m.Parser.Language || m.M.Language;  // available only after init()
    if (!Language || !Language.load) { _disabled = true; _langs.set(name, null); return null; }
    const file = findGrammar(name);
    if (!file) { _langs.set(name, null); return null; }
    const lang = await Language.load(file);
    _langs.set(name, lang);
    if (!_parser) _parser = new m.Parser();
    return { parser: _parser, lang };
  } catch { _langs.set(name, null); return null; }
}

// isError / isMissing are a method in older web-tree-sitter, a getter in newer.
const callOrProp = (n, k) => { const v = n[k]; return typeof v === "function" ? n[k]() : v; };
export const nodeIsError = (n) => n.type === "ERROR" || callOrProp(n, "isError") === true;
export const nodeIsMissing = (n) => callOrProp(n, "isMissing") === true;
