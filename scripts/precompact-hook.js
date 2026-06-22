#!/usr/bin/env node
import { readJsonStdin, logEvent, readAllEvents, aggregate, groupByTool } from "./lib/telemetry.js";

const ev = await readJsonStdin();
const eventName = ev.hook_event_name || ev.event || "PreCompact";
const sid = ev.session_id || ev.sessionId || process.env.CLAUDE_SESSION_ID || null;
logEvent({ session: sid, kind: "precompact", meta: { event: eventName } });
let ctx = "";
if (sid) {
  try {
    const sevents = readAllEvents().filter(e => e.session === sid);
    const sess = aggregate(sevents);
    const topTools = groupByTool(sevents, 6);
    const editTools = new Set(["slim.Edit", "Edit", "Write", "slim.Write"]);
    const editFiles = new Set();
    for (const r of sevents.filter(e => editTools.has(e.tool)).slice(-12).reverse()) {
      try {
        const a = JSON.parse(r.args_summary || "{}");
        if (a.file) editFiles.add(a.file);
      } catch {}
    }
    const fmtTok = (n) => !n ? "0" : n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"k" : String(n);
    ctx = [
      `─ slim PreCompact recap (this session) ─`,
      `Tool calls: ${sess.calls || 0} (${sess.slim_calls || 0} via slim) · in ${fmtTok(sess.in_tok)} / out ${fmtTok(sess.out_tok)}`,
      `Top tools: ${topTools.map(t => t.tool + "×" + t.n).join(", ") || "—"}`,
      editFiles.size ? `Files edited recently: ${[...editFiles].slice(0, 8).join(", ")}` : "",
      `Run mcp__slim__Recall({query:"<topic>"}) to surface anything that would otherwise drop in compaction.`,
    ].filter(Boolean).join("\n");
  } catch (e) {
    ctx = `slim PreCompact recap unavailable: ${e.message}`;
  }
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: eventName,
    additionalContext: ctx,
  },
}));
