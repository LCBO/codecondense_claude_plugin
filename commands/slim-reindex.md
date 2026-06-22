---
name: slim-reindex
description: Rebuild the condense code symbol index (~/.condense/index.json) for the current project.
allowed-tools: Bash(node *)
---

```bash
node --no-warnings=ExperimentalWarning ${CLAUDE_PLUGIN_ROOT}/cli/slim.js reindex
```

Relay the reported files/symbols counts.
