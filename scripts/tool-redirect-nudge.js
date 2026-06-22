#!/usr/bin/env node
import { readJsonStdin, logEvent } from "./lib/telemetry.js";
import { detectKind } from "./lib/bash-compress.js";
import { loadState } from "./lib/redirect-state.js";

const ev = await readJsonStdin();
const sid = ev.session_id || ev.sessionId || process.env.GROK_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
const tool = ev.tool_name || "";
const input = ev.tool_input || {};

let out = null;

function allowWithNudge(msg) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      additionalContext: "IMPORTANT: " + msg,
    },
  };
}

// In `tiny`/`match` profiles, slim's Read/Write MCP tools aren't exposed.
// Skip the heredoc/echo nudge there — it would point at an unreachable tool.
const PROFILE = process.env.SLIM_PROFILE || "full";
const SKIP_FILE_REWRITES = process.env.SLIM_NO_BASH_REWRITE === "1" || PROFILE === "tiny" || PROFILE === "match";

if (tool === "Bash") {
  const cmd = (input.command || "").trim();
  const lc = cmd.toLowerCase();

  // PreToolUse rewrites are expensive: a softDeny burns a turn (model retries).
  // The PostToolUse hook (`bash-output-redirect.js`) already nudges toward slim
  // tools whenever raw output is actually big. So PreToolUse stays mostly silent
  // and only fires lightweight `allow + additionalContext` hints — no retries.
  if (!SKIP_FILE_REWRITES && (/^(?:echo|printf|cat)\s+.*>\s*[^\s|;&]+\s*$/.test(cmd) || /<<\s*['"]?\w+['"]?/.test(cmd))) {
    out = allowWithNudge("For new files, prefer mcp__slim__Write({ file, content }) over shell heredoc/echo redirects.");
  }
  else {
    // detectKind still drives PostToolUse output-size recording. We do NOT wrap
    // commands at PreToolUse anymore — the deny→retry dance cost ~3 turns per
    // session that runs tests, eclipsing compressor savings on small outputs.
    const kind = detectKind(cmd);
    if (kind && !/\|/.test(cmd) && !/compress-stream/.test(cmd)) {
      const state = await loadState(sid);
      const lastBytes = state.outputBytes?.[kind] ?? null;
      // Only nudge (no deny) when the previous run for this kind was big — and
      // only via additionalContext, leaving the cmd untouched.
      if (lastBytes !== null && lastBytes >= 8192) {
        const root = process.env.GROK_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT || "";
        const wrap = `{ ${cmd}; } 2>&1 | node --no-warnings ${root}/scripts/compress-stream.js ${kind}; exit \${PIPESTATUS[0]}`;
        out = allowWithNudge(`Last ${kind} run produced ${(lastBytes/1024).toFixed(1)}KB. Next time wrap to compress: \`${wrap}\``);
      }
    }
  }
} else if (tool === "Agent") {
  const sub = input.subagent_type;
  const REWRITES = {
    "general-purpose": "explore",
    "Explore": "explore",
  };
  const prompt = String(input.prompt || "");
  const NEEDS_WEB = /\b(web[\s_-]*(?:search|fetch)|websearch|webfetch|internet|online|http?s?:\/\/|\.com\b|\.org\b|github\.com|stackoverflow|reddit|hacker[\s-]?news|blog|article|docs\.anthropic|cite\b|sources?\b|research(?:ing)?\b|fetch\s+url|browse\b)/i;
  const NEEDS_WRITE = /\b(write|create|edit|modify|implement|refactor|fix|patch|apply|commit|push|merge|delete|rename|build|install|run\s+test|deploy)\b/i;
  const NEEDS_SHELL = /\b(npm|pnpm|yarn|pip|cargo|go run|docker|kubectl|gh\s+|git\s+(?:push|commit|merge|reset|rebase))\b/i;
  if (REWRITES[sub] && !NEEDS_WEB.test(prompt) && !NEEDS_WRITE.test(prompt) && !NEEDS_SHELL.test(prompt)) {
    // allow-with-nudge instead of softDeny: model picks the condense agent next time
    // without spending a turn on a forced re-call.
    out = allowWithNudge(`Cheaper alt: subagent_type="slim:${REWRITES[sub]}" (Haiku-backed, read-only). Use it for read-only research; current Agent call proceeds as-is.`);
  }
}

if (out) {
  try { logEvent({ session: sid, kind: "redirect_nudge", tool, meta: { decision: out.hookSpecificOutput.permissionDecision } }); } catch {}
  process.stdout.write(JSON.stringify(out));
} else {
  process.stdout.write("{}");
}
