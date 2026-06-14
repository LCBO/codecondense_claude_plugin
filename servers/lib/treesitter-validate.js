// Cross-language post-edit syntax validation via tree-sitter (shared runtime).
// Covers the languages syntax-validate.js doesn't handle precisely (Python, Go,
// Rust, Java, C, C++, Ruby, Kotlin, ...). Walks to the first ERROR/MISSING nodes
// and reports line + a trimmed snippet (deduped, capped). Graceful: returns null
// when the language/grammar/runtime isn't available.
import path from "node:path";
import { getParser, nodeIsError, nodeIsMissing } from "./treesitter.js";

const EXT_LANG = {
  py: "python", pyi: "python", go: "go", rs: "rust", java: "java",
  rb: "ruby", kt: "kotlin", kts: "kotlin",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
};
export function treeSitterExts() { return Object.keys(EXT_LANG); }

function collectErrors(root, max = 3) {
  const out = []; const seen = new Set(); const stack = [root];
  while (stack.length && out.length < max) {
    const node = stack.pop(); if (!node) continue;
    const err = nodeIsError(node), miss = nodeIsMissing(node);
    if (err || miss) {
      const line = (node.startPosition ? node.startPosition.row : 0) + 1;
      if (!seen.has(line)) {
        seen.add(line);
        if (miss) { const t = node.type && node.type !== "ERROR" ? `'${node.type}'` : "token"; out.push({ line, message: `Missing ${t}` }); }
        else { const snip = (node.text || "").split("\n")[0].trim().slice(0, 40); out.push({ line, message: snip ? `Syntax error near "${snip}"` : "Syntax error" }); }
      }
      continue;
    }
    for (let i = node.childCount - 1; i >= 0; i--) stack.push(node.child(i));
  }
  return out;
}

export async function validateWithTreeSitter(file, content) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const name = EXT_LANG[ext];
  if (!name) return null;
  const got = await getParser(name);
  if (!got) return null;
  let tree;
  try {
    got.parser.setLanguage(got.lang);
    tree = got.parser.parse(content);
    if (!tree || !tree.rootNode.hasError) return null;
    const errs = collectErrors(tree.rootNode, 3);
    return errs.length ? errs : null;
  } catch { return null; }
  finally { try { tree && tree.delete && tree.delete(); } catch { /* ignore */ } }
}
