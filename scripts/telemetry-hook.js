#!/usr/bin/env node
import { logEvent, readJsonStdin } from "./lib/telemetry.js";
import { promises as fs } from "node:fs";

// Parse transcript .jsonl. Sum `assistant` message usage fields. Claude Code
// does NOT pass usage in Stop hook payload — must scan transcript ourselves.
// Retries with backoff: Stop fires before the final assistant turn is flushed
// to disk. ~150-300ms typically suffices.
async function tallyUsageFromTranscript(transcriptPath) {
  if (!transcriptPath) return null;
  const delays = [0, 100, 250, 500, 1000];
  for (const wait of delays) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    let raw;
    try { raw = await fs.readFile(transcriptPath, "utf8"); } catch { continue; }
    const totals = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    let model = null;
    let saw = false;
    for (const line of raw.split("\n")) {
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type !== "assistant") continue;
      const msg = ev.message || {};
      const u = msg.usage;
      if (!u) continue;
      saw = true;
      model = model || msg.model || null;
      totals.input_tokens += u.input_tokens || 0;
      totals.output_tokens += u.output_tokens || 0;
      totals.cache_read_input_tokens += u.cache_read_input_tokens || 0;
      totals.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
    }
    if (saw) return { ...totals, model };
  }
  return null;
}

function normalizeTool(name) {
  const m = /^mcp__slim__(\w+)$/.exec(name || "");
  return m ? "slim." + m[1] : name;
}

function summarizeArgs(rawTool, input = {}) {
  const t = normalizeTool(rawTool);
  if (t === "slim.Edit") {
    return { count: Array.isArray(input.edits) ? input.edits.length : 1 };
  }
  if (t === "slim.Sql") {
    const batch = Array.isArray(input.queries);
    return {
      op: batch ? "batch" : (input.action || "query"),
      count: batch ? input.queries.length : 1,
    };
  }
  if (t === "slim.Search") {
    return {
      has_content: !!input.content_regex,
      globs: Array.isArray(input.file_glob_patterns) ? input.file_glob_patterns.length : 0,
      mode: input.output_mode || null,
    };
  }
  if (t === "slim.Read") {
    return { full: !!input.full };
  }
  return Object.keys(input);
}

const ev = await readJsonStdin();
const event = ev.hook_event_name || ev.event || "unknown";
const sid = ev.session_id || ev.sessionId || process.env.CLAUDE_SESSION_ID || null;

if (event === "PostToolUse") {
  const rawTool = ev.tool_name || ev.tool || "unknown";
  const tool = normalizeTool(rawTool);
  const resp = JSON.stringify(ev.tool_response ?? ev.response ?? "");
  logEvent({
    session: sid,
    kind: "tool_call",
    tool,
    response_bytes: resp.length,
    args_summary: summarizeArgs(rawTool, ev.tool_input || {}),
    meta: { event, raw_tool: rawTool !== tool ? rawTool : undefined },
  });
} else if (event === "Stop" || event === "SubagentStop") {
  // Stop hook payload doesn't include `usage`. Read the transcript instead.
  // Falls back to nulls if transcript_path is missing or unreadable.
  let usage = ev.usage || null;
  let model = ev.model || null;
  const tpath = ev.transcript_path || ev.transcriptPath || ev.transcript;
  if (!usage && tpath) {
    const tallied = await tallyUsageFromTranscript(tpath);
    if (tallied) {
      usage = tallied;
      model = model || tallied.model;
    }
  }
  usage = usage || {};
  logEvent({
    session: sid,
    kind: event === "Stop" ? "session_stop" : "subagent_stop",
    input_tokens: usage.input_tokens ?? null,
    output_tokens: usage.output_tokens ?? null,
    cache_read_tokens: usage.cache_read_input_tokens ?? null,
    cache_creation_tokens: usage.cache_creation_input_tokens ?? null,
    meta: { event, model, source: ev.usage ? "hook" : "transcript" },
  });
} else if (event === "PreCompact" || event === "PostCompact") {
  logEvent({ session: sid, kind: event.toLowerCase(), meta: { event } });
}

process.stdout.write("{}");
