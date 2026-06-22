---
name: slim-install
description: Wire condense into Claude Code config (marketplace + enabledPlugins). Restart Claude Code after.
allowed-tools: Bash(node *)
---

```bash
node --no-warnings=ExperimentalWarning ${CLAUDE_PLUGIN_ROOT}/cli/slim.js install
```

Relay the output and remind the user to restart Claude Code.
