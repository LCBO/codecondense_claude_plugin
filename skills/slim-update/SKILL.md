---
name: slim-update
description: Update the installed condense plugin (git clone → git pull; Claude Code marketplace install → claude plugin update; Grok equivalent via grok plugin update). Restart the agent after.
---

Run:

```
node ~/.slimmer/plugin/cli/slim.js update
```

(or `slim update`).

The CLI detects whether the current tree is a git clone or a marketplace cache and does the right thing (or gives exact commands for Claude `claude plugin update` or Grok `grok plugin update`).

After it finishes, remind the user to restart Claude Code and/or the Grok TUI.

This is the Grok form of `/slim-update`.
