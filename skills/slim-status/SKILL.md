---
name: slim-status
description: Show condense licensing / trial status — registered, plan, calls used/remaining. Use when the user asks for /slim-status or license/trial info.
---

# Condense Status

Report the current licensing / trial state for this machine.

Run via terminal tool:

```
node ~/.slimmer/plugin/cli/slim.js status
```

(or the equivalent under a Grok plugin install path, or just `slim status`).

Relay the table output (machine ID, registered, plan, $ saved lifetime, trial limit/used/left, version, etc.).

This is the Grok equivalent of `/slim-status`.
