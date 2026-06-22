---
name: slim-stats
description: Show condense code-index stats (files/symbols counts) for current project.
allowed-tools: Bash(node *)
---

```bash
node --no-warnings=ExperimentalWarning ${CLAUDE_PLUGIN_ROOT}/cli/slim.js stats
```

Relay the output. If there is no index yet, tell the user to run `/slim-reindex`.
