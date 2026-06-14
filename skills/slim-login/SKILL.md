---
name: slim-login
description: Save a condense API key (lifts the trial limit). Prompts to paste the key if not given.
---

# Condense Login

Register a personal or team API key with the local plugin (lifts monthly trial savings cap).

Usage:

```
node ~/.slimmer/plugin/cli/slim.js login <KEY>
```

If no key is provided on the command line the CLI will prompt.

After success, tell the user to restart the coding agent (Claude Code or Grok).

This is the Grok version of `/slim-login`.
