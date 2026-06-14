---
name: slim-login
description: Save a condense API key (lifts the trial limit). Prompts to paste the key if not given.
allowed-tools: Bash(node *)
argument-hint: [API_KEY]
---

The user wants to register their personal condense API key.

Arguments passed to this command: "$ARGUMENTS"

Do this:

1. If the arguments above are NON-EMPTY, treat them as the API key and run:
   ```bash
   node --no-warnings=ExperimentalWarning ${CLAUDE_PLUGIN_ROOT}/cli/slim.js login "$ARGUMENTS"
   ```

2. If the arguments are EMPTY, do NOT run anything yet. Instead ask the user
   exactly:
   "🔑 Paste your condense API key here (you get one after registering on the site):"
   Then WAIT for their next message. Take their reply as the key (trim
   whitespace, ignore surrounding quotes) and run the same login command with
   that value substituted for the key.

Never echo the full key back to the user — confirm only with a masked form
(e.g. the first 8 characters + "…"). After saving, relay the CLI output and
remind them to restart Claude Code (or that it applies on the next check).
