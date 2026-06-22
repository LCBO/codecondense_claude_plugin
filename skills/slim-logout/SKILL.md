---
name: slim-logout
description: Remove the saved condense API key (returns to trial limits). Use when the user wants to logout or clear their key.
---

# Condense Logout

Removes the locally stored API key. The plugin will fall back to trial mode (limited monthly savings tracking).

## How to run

Use your terminal tool:

```
node ~/.slimmer/plugin/cli/slim.js logout
```

Or simply:

```
slim logout
```

This is the Grok equivalent of a logout action paired with `/slim-login`.

After running, the change takes effect on the next session or tool use.
