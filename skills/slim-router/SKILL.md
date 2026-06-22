---
name: slim-router
description: Local Anthropic-only model router — start/stop/status the proxy that routes requests to haiku/sonnet/opus per request. (Primarily useful when using Anthropic models.)
---

# Condense Router

Control the local model router (Anthropic-specific).

Subcommands: start, stop, restart, status, config.

Examples:

```
node ~/.slimmer/plugin/cli/slim.js router status
node ~/.slimmer/plugin/cli/slim.js router start
```

After start/stop, the user normally needs to restart the client that is using the ANTHROPIC_BASE_URL (Claude Code).

This skill is the Grok equivalent of `/slim-router`.
