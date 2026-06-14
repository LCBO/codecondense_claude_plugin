#!/usr/bin/env node
// Stop / SubagentStop hook: regenerate dashboard HTML.
import { readJsonStdin, logEvent } from "./lib/telemetry.js";
import { buildDashboard } from "./lib/dashboard.js";

const ev = await readJsonStdin().catch(() => ({}));
const sid = ev.session_id || ev.sessionId || process.env.CLAUDE_SESSION_ID || null;
try {
  const { path: p } = buildDashboard();
  logEvent({ session: sid, kind: "dashboard_regen", meta: { path: p } });
} catch (e) {
  logEvent({ session: sid, kind: "dashboard_regen_fail", meta: { error: e.message } });
}
process.stdout.write("{}");
