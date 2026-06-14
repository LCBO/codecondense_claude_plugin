---
name: slim-reindex
description: Rebuild the condense code symbol index (~/.condense/index.json) for the current project. Use when asked for /slim-reindex or when symbol search feels stale.
---

# Condense Reindex

Force a full rebuild of the tree-sitter AST symbol index for the codebase in the current working directory.

Run:

```
node ~/.slimmer/plugin/cli/slim.js reindex
```

(or `slim reindex`).

Report the resulting file and symbol counts.

This is the Grok equivalent of `/slim-reindex`.
