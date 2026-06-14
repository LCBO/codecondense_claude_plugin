---
name: slim-savings
description: Show condense plugin savings — tool calls, tokens, cost (session + lifetime). Use when the user asks about /slim-savings, token savings, or cost reduction from the plugin.
---

# Condense Savings

Show the real savings achieved by the CodeCondense / slimmer plugin (local only, no telemetry sent anywhere).

## How to run

Use the `run_terminal_command` tool (or equivalent bash tool) to execute the CLI that lives with the installed plugin.

Preferred (works for both Claude Code and Grok installs — the npx installer and `condense install` always place the canonical tree at `~/.condense/plugin`):

```
node ~/.slimmer/plugin/cli/slim.js savings
```

Alternative (if you installed via `grok plugin install` and the tree is symlinked under `~/.grok/plugins/condense`):

```
node ~/.grok/plugins/condense/cli/slim.js savings
```

Or simply:

```
slim savings
```

(if the `condense` bin from the plugin's package.json is on your PATH).

## Output

Relay the full report verbatim to the user. It includes session savings and lifetime (USD) savings computed from your actual model pricing.

This is the Grok equivalent of the `/slim-savings` slash command.
