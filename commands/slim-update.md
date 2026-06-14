---
name: slim-update
description: Update the installed condense plugin (git clone → git pull; Claude Code marketplace install → claude plugin update). Restart Claude Code after.
allowed-tools: Bash(node *)
---

```bash
node --no-warnings=ExperimentalWarning ${CLAUDE_PLUGIN_ROOT}/cli/slim.js update
```

Relay full output verbatim, then remind the user to restart Claude Code.
