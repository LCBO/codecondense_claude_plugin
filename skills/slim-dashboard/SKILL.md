---
name: slim-dashboard
description: Render or serve the local HTML savings dashboard (~/.condense/dashboard.html) showing lifetime and session savings visuals. Use when the user asks to see the dashboard or visual savings report.
---

# Condense Dashboard

Generates a self-contained HTML dashboard with charts and stats from your local telemetry.

## How to run

Basic (writes the file):

```
node ~/.slimmer/plugin/cli/slim.js dashboard
```

Then open the reported path (usually `~/.condense/dashboard.html`).

Serve it live (recommended for interactive use):

```
node ~/.slimmer/plugin/cli/slim.js dashboard --serve
```

This starts a small HTTP server (default http://127.0.0.1:24843).

Or simply:

```
condense dashboard --serve
```

This is the Grok equivalent of the dashboard feature. Great for quick visual overview of token/call savings without parsing raw `condense-savings` output.
