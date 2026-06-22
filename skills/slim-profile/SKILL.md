---
name: slim-profile
description: Show or set the tool profile (tiny|lean|core|full|ultra) that controls which MCP tools are exposed. Lower profiles reduce prompt tokens significantly by hiding advanced tools. Use for token optimization.
---

# Condense Profile

The tool profile determines the size of the tool manifest sent to the model every turn (a major source of token waste).

Available profiles (from smallest to largest manifest):
- tiny: Search only
- lean: Search + Edit (good for aggressive savings)
- core: Search, Investigate, Read, Edit, Write + Sql + Symbols
- full / ultra: Everything including Memory/Recall

## How to run

Show current:

```
node ~/.slimmer/plugin/cli/slim.js profile
```

Set one (e.g. for heavy savings):

```
node ~/.slimmer/plugin/cli/slim.js profile lean
```

Or via env for a session: `SLIMMER_PROFILE=lean ...`

Restart/reload the coding agent after changing for the new manifest to take effect.

**This is one of the highest-leverage settings for Grok users** — smaller profiles = dramatically fewer tokens spent describing tools every turn.

This is the Grok version of the profile command.
