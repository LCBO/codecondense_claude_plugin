---
name: slim-recover
description: List or restore file backups created automatically by the plugin before edits. Use when you need to undo a batch edit or recover from a bad change.
---

# Condense Recover

The plugin automatically creates timestamped backups before Write/Edit operations.

## How to run

List backups for a file:

```
node ~/.slimmer/plugin/cli/slim.js recover path/to/file.ts
```

Restore the most recent:

```
node ~/.slimmer/plugin/cli/slim.js recover path/to/file.ts latest
```

Restore a specific timestamp:

```
node ~/.slimmer/plugin/cli/slim.js recover path/to/file.ts 2024-...
```

Or use the short form:

```
condense recover <file> [latest | <ts>]
```

This gives you a safety net that pairs perfectly with the batch Edit capability of the slim MCP tools.

This is the Grok equivalent of the recover command.
