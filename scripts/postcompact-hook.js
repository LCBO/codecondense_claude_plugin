#!/usr/bin/env node
import { readJsonStdin, logEvent, readAllEvents, aggregate, groupByTool } from "./lib/telemetry.js";

const ev = await readJsonStdin();
const sid = ev.session_id || ev.sessionId || process.env.CLAUDE_SESSION_ID || null;
logEvent({ session: sid, kind: "postcompact" });
let recapLines = [];
if (sid) {
  try {
    const sevents = readAllEvents().filter(e => e.session === sid);
    const sess = aggregate(sevents);
    const tools = groupByTool(sevents, 5);
    const editTools = new Set(["slim.Edit", "Edit", "Write", "slim.Write"]);
    const editFiles = new Set();
    for (const r of sevents.filter(e => editTools.has(e.tool)).slice(-30).reverse()) {
      try {
        const a = JSON.parse(r.args_summary || "{}");
        if (a.file) editFiles.add(a.file);
      } catch {}
    }
    const fmtTok = (n) => !n ? "0" : n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"k" : String(n);
    recapLines = [
      `─ slim PostCompact context restore ─`,
      `Pre-compact session totals: ${sess.calls || 0} tool calls (${sess.slim_calls || 0} via slim) · in ${fmtTok(sess.in_tok)} / out ${fmtTok(sess.out_tok)}.`,
      `Top tools used: ${tools.map(t => t.tool + "×" + t.n).join(", ") || "—"}.`,
      editFiles.size ? `Files touched (likely the working set): ${[...editFiles].slice(0, 12).join(", ")}.` : "",
      `If you need anything dropped: mcp__slim__Recall({ query: "<topic>" }) searches this session's pre-compact transcript.`,
    ].filter(Boolean);
  } catch (e) {
    recapLines = [`slim PostCompact recap unavailable: ${e.message}`];
  }
}

// Reassert tool preferences: after compaction the agent tends to drift back to
// the built-in Read/Edit/Grep/Glob, which throws away slim's savings. Re-pin the
// condense tools every time context is rebuilt.
const reassert =
  "After compaction, keep using slim tools: prefer mcp__slim__Search / Read / Edit / Write / Sql over the built-in Read/Edit/Grep/Glob (disabled under the slim:code agent), and batch edits into one Edit call.";

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PostCompact",
    additionalContext: [reassert, ...recapLines].join("\n"),
  },
}));
