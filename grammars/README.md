# Grammar override directory

Slimmer loads tree-sitter grammars from the **`tree-sitter-wasms`** npm package
(36 languages, pure WASM), matched to the pinned `web-tree-sitter` version — so
you normally don't need anything here.

To add or override a language, drop a `tree-sitter-<name>.wasm` (built for the
installed web-tree-sitter ABI) into one of these, in priority order:
1. `$SLIMMER_GRAMMARS_DIR`
2. `~/.slimmer/grammars/`
3. this directory

Loaded via `servers/lib/treesitter.js` and used by the AST symbol index
(`treesitter-symbols.js`) and post-edit syntax validation
(`treesitter-validate.js`). If a grammar/runtime is missing for a language, slim
falls back to regex (symbols) or skips (validation) gracefully.
