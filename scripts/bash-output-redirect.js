#!/usr/bin/env node
// PostToolUse hook on Bash. If raw output is large, suggest re-running
// the same intent through structured condense tools. Also: scan for secrets,
// project compression savings (logged for dashboard baseline).
import { readJsonStdin, logEvent } from "./lib/telemetry.js";
import { scanSecrets, compress, detectKind } from "./lib/bash-compress.js";
import { recordOutputSize } from "./lib/redirect-state.js";

const BIG_BYTES = 8000;
const HUGE_BYTES = 20000;

const ev = await readJsonStdin();
const sid = ev.session_id || ev.sessionId || process.env.CLAUDE_SESSION_ID || null;
const tool = ev.tool_name || "";
if (tool !== "Bash") { process.stdout.write("{}"); process.exit(0); }

const input = ev.tool_input || {};
const resp = ev.tool_response ?? ev.response ?? "";
let text;
if (typeof resp === "string") text = resp;
else if (resp && typeof resp === "object") text = resp.stdout ?? resp.output ?? JSON.stringify(resp);
else text = "";
const bytes = Buffer.byteLength(text || "");

// Always scan for secrets, regardless of size.
const secrets = bytes > 0 ? scanSecrets(text) : [];
if (secrets.length) {
  logEvent({ session: sid, kind: "bash_secret_leak", tool, meta: { secrets, bytes } });
}

if (bytes < BIG_BYTES && !secrets.length) { process.stdout.write("{}"); process.exit(0); }

// Project what compression would save (model already saw raw output;
// this feeds baseline_bytes for the dashboard).
let projection = null;
if (bytes >= BIG_BYTES) {
  const { savedBytes } = compress(text);
  projection = { saved_bytes: savedBytes, ratio: savedBytes / bytes };
  logEvent({
    session: sid,
    kind: "bash_compress_projection",
    tool: "Bash",
    response_bytes: bytes,
    baseline_bytes: bytes,
    saved_bytes: savedBytes,
    meta: projection,
  });
}

const cmd = (input.command || "").trim();

// Record output size per detected kind so the PreToolUse compressor redirect
// can skip suggesting a wrap when the prior output was tiny (<2KB).
{
  const kind = detectKind(cmd);
  if (kind) { try { await recordOutputSize(sid, kind, bytes); } catch {} }
}

const lc = cmd.toLowerCase();
let suggest = null;
let why = `Bash returned ${(bytes/1024).toFixed(1)}KB — most of that is wasted tokens.`;

let m;
if ((m = cmd.match(/^cat\s+([^\s|;&<>]+)/))) {
  suggest = `mcp__slim__Read({ file: "${m[1]}", line_start: 1, line_end: 200 })`;
} else if ((m = cmd.match(/^(?:ls|tree|find)\b/))) {
  suggest = `mcp__slim__Search({ file_glob_patterns: ["<scope>"], output_mode: "file_paths_only" })`;
} else if ((m = cmd.match(/^(?:rg|grep|ag|ack)\s+(?:-[a-zA-Z]+\s+)*['"]?([^'"\s|;&]+)['"]?(?:\s+(\S+))?/))) {
  const pat = m[1].replace(/"/g, '\\"');
  const path = m[2] || ".";
  suggest = `mcp__slim__Search({ content_regex: "${pat}", path: "${path}", output_mode: "file_paths_with_match_count" })  // ranked, lighter`;
} else if (/\b(jq|awk|sed)\b/.test(lc)) {
  suggest = `Pipe to head/tail or paginate — or use mcp__slim__Search with line ranges if reading code.`;
} else {
  suggest = `Re-run with output narrowed (head, --max-results, file path), or pipe through grep first.`;
}

let urgency = bytes > HUGE_BYTES ? "CRITICAL" : "NOTE";
let parts = [];
if (secrets.length) {
  urgency = "SECURITY";
  parts.push(`SECURITY: bash output contained credentials [${secrets.map(s => `${s.kind}×${s.count}`).join(", ")}]. Rotate them. Avoid printing secrets in future commands.`);
}
if (bytes >= BIG_BYTES) {
  let line = `${urgency}: ${why} Next time use: ${suggest}`;
  if (projection && projection.saved_bytes > 500) {
    line += ` (compression alone would have saved ${(projection.saved_bytes / 1024).toFixed(1)}KB / ${Math.round(projection.ratio * 100)}%.)`;
  }
  parts.push(line);
}
const ctx = parts.join("\n");
logEvent({ session: sid, kind: "bash_output_redirect", tool, meta: { bytes, urgency, secrets: secrets.length, projection } });
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: ctx },
}));
