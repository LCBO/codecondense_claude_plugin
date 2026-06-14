// AST-accurate symbol extraction via tree-sitter (all languages with a grammar).
// Returns [{ name, type, line }] — `type` is the real symbol kind
// (function/class/method/interface/struct/...). Powers the symbol index; the
// caller keeps a per-language `kind` for back-compat and adds this `type`.
// Returns null when the language/grammar/runtime isn't available (regex fallback).
import path from "node:path";
import { getParser } from "./treesitter.js";

// file ext -> tree-sitter-wasms grammar name
export const SYMBOL_LANGS = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", pyi: "python",
  go: "go", rs: "rust", rb: "ruby", java: "java", kt: "kotlin", kts: "kotlin",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
};

// declaration node type -> symbol type, per grammar. "function" becomes "method"
// when nested in a class/impl body.
const DECL = {
  typescript: { function_declaration: "function", generator_function_declaration: "function", class_declaration: "class", abstract_class_declaration: "class", method_definition: "method", interface_declaration: "interface", type_alias_declaration: "type", enum_declaration: "enum" },
  javascript: { function_declaration: "function", generator_function_declaration: "function", class_declaration: "class", method_definition: "method" },
  python: { function_definition: "function", class_definition: "class" },
  go: { function_declaration: "function", method_declaration: "method", type_spec: "type" },
  rust: { function_item: "function", struct_item: "struct", enum_item: "enum", trait_item: "trait", mod_item: "module" },
  java: { class_declaration: "class", interface_declaration: "interface", method_declaration: "method", enum_declaration: "enum" },
  ruby: { method: "method", singleton_method: "method", class: "class", module: "module" },
  kotlin: { function_declaration: "function", class_declaration: "class", object_declaration: "object" },
  c: { function_definition: "function", struct_specifier: "struct" },
  cpp: { function_definition: "function", class_specifier: "class", struct_specifier: "struct" },
};
DECL.tsx = DECL.typescript;
const CLASS_NODES = new Set(["class_definition", "class_declaration", "abstract_class_declaration", "impl_item", "class_specifier", "struct_specifier", "class", "object_declaration"]);
const ARROW = new Set(["arrow_function", "function", "function_expression"]);

function nameOf(node) {
  const n = node.childForFieldName && node.childForFieldName("name");
  if (n) return n.text;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c.type === "identifier" || c.type === "type_identifier" || c.type === "field_identifier" || c.type === "simple_identifier" || c.type === "constant") return c.text;
  }
  return null;
}

export async function extractSymbols(file, content) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const lang = SYMBOL_LANGS[ext];
  if (!lang) return null;
  const got = await getParser(lang);
  if (!got) return null;
  const map = DECL[lang] || {};
  const out = [];
  let tree;
  try {
    got.parser.setLanguage(got.lang);
    tree = got.parser.parse(content);
  } catch { return null; }
  try {
    const stack = [{ node: tree.rootNode, inClass: false }];
    while (stack.length) {
      const { node, inClass } = stack.pop();
      let type = map[node.type];
      let nm = type ? nameOf(node) : null;
      // const foo = () => {}  /  const foo = function(){}
      if (!type && node.type === "variable_declarator") {
        const val = node.childForFieldName && node.childForFieldName("value");
        if (val && ARROW.has(val.type)) { type = inClass ? "method" : "function"; nm = nameOf(node); }
      }
      if (type && nm) {
        if (type === "function" && inClass) type = "method";
        out.push({ name: nm, type, line: (node.startPosition ? node.startPosition.row : 0) + 1 });
      }
      const childInClass = inClass || CLASS_NODES.has(node.type);
      for (let i = node.childCount - 1; i >= 0; i--) stack.push({ node: node.child(i), inClass: childInClass });
    }
  } finally { try { tree && tree.delete && tree.delete(); } catch { /* ignore */ } }
  out.sort((a, b) => a.line - b.line);
  return out;
}
