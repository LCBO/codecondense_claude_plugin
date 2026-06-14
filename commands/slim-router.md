---
name: slim-router
description: Local Anthropic-only model router — start/stop/status the proxy that routes Claude Code requests to haiku/sonnet/opus per request.
allowed-tools: Bash(node *)
---

```bash
node --no-warnings=ExperimentalWarning ${CLAUDE_PLUGIN_ROOT}/cli/slim.js router ${ARGUMENTS:-status}
```

Subcommands: `start` (launch daemon + point Claude Code at it), `stop` (kill daemon + restore settings), `restart`, `status`, `config` (print/edit ~/.condense/router-config.json).

After `start` or `stop`, tell the user to restart Claude Code so the changed `ANTHROPIC_BASE_URL` takes effect. Relay output verbatim.
