---
name: slim-reset
description: Clear all condense telemetry events (lifetime savings reset). Irreversible.
allowed-tools: Bash(node *)
---

Confirm with the user before running. If confirmed:

```bash
node --no-warnings=ExperimentalWarning ${CLAUDE_PLUGIN_ROOT}/cli/slim.js reset
```
