---
name: slim-uninstall
description: Remove condense wiring from Claude Code and/or Grok config (marketplaces, enabled plugins, symlinks). Use when you want to completely uninstall the plugin.
---

# Condense Uninstall

Cleans up the plugin registration:

- Removes from Claude marketplace / enabledPlugins (if present)
- Removes the Grok symlink at ~/.grok/plugins/condense (if present)

## How to run

```
node ~/.slimmer/plugin/cli/slim.js uninstall
```

Or:

```
condense uninstall
```

You will likely need to restart Claude Code and/or your Grok session afterward.

The actual plugin files at ~/.condense/plugin (or the Grok plugin install) remain until you manually delete them or run a fresh install that overwrites.

This is the Grok equivalent of the uninstall command (pairs with install).
