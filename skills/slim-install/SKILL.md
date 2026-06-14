---
name: slim-install
description: Wire condense into Claude Code config (marketplace + enabledPlugins) and/or Grok (~/.grok/plugins symlink). Restart the agent after.
---

Re-run the wiring for the current plugin tree (useful after moving the install or on a new machine profile).

Run:

```
node ~/.slimmer/plugin/cli/slim.js install
```

(or `condense install`).

It will set up Claude if ~/.claude exists and create the Grok symlink if ~/.grok exists.

This is the Grok equivalent of `/slim-install`.
