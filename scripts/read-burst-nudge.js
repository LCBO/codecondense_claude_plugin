#!/usr/bin/env node
// PostToolUse on slim:Read / Read / slim:Search.
// Tracks consecutive Read calls. After threshold, suggests Search w/ content.
// Resets on any Search call. Suppresses after one nudge per session.
import { readJsonStdin, logEvent } from "./lib/telemetry.js";
import { bumpRead, resetReads, loadState, saveState } from "./lib/redirect-state.js";

const THRESHOLD = 2;  // 2nd consecutive Read fires nudge

const ev = await readJsonStdin();
const sid = ev.session_id || ev.sessionId || process.env.CLAUDE_SESSION_ID || null;
const tool = ev.tool_name || "";

const isRead = tool === "mcp__slim__Read" || tool === "Read";
const isSearch = tool === "mcp__slim__Search" || tool === "Grep" || tool === "Glob";

if (isSearch) {
  await resetReads(sid);
  process.stdout.write("{}");
  process.exit(0);
}

if (!isRead) { process.stdout.write("{}"); process.exit(0); }

const n = await bumpRead(sid);
const state = await loadState(sid);
if (state.readNudgeFired) { process.stdout.write("{}"); process.exit(0); }

if (n < THRESHOLD) { process.stdout.write("{}"); process.exit(0); }

state.readNudgeFired = true;
await saveState(sid, state);

const ctx = `${n} consecutive Read calls. For multi-file exploration, ONE \`mcp__slim__Search({file_glob_patterns:[...], output_mode:"file_paths_with_content"})\` returns all content in a single roundtrip — no chained Reads. Switch now if more files to inspect.`;
logEvent({ session: sid, kind: "read_burst_nudge", tool, meta: { reads: n } });
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: ctx },
}));
