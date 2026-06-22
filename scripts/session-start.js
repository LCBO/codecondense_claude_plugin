#!/usr/bin/env node
import { logEvent } from "./lib/telemetry.js";
import { readJsonStdin } from "./lib/telemetry.js";
import { spawn } from "node:child_process";
import { promises as fsp, readFileSync, writeFileSync, openSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = path.resolve(path.dirname(__filename), "..");
const SLIM_HOME = process.env.SLIM_HOME || path.join(os.homedir(), ".slim");
const CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const STATUS_LINE_SCRIPT = path.join(PLUGIN_ROOT, "scripts", "status-line.js");
const STATUS_LINE_CMD = `node --no-warnings=ExperimentalWarning ${STATUS_LINE_SCRIPT}`;



const SLIM_VERBS = [
  "Condensing", "Compressing", "Distilling", "Squeezing", "Packing tight",
  "Code-crunching", "Token-dieting", "Byte-watching", "Context-trimming",
  "Zip-coding", "Cache-hitting", "Batch-crafting", "Symbol-hunting",
  "AST-spelunking", "Tree-shaking", "Minifying thoughts", "De-bloating",
  "Turbo-condensing", "Token-saving", "Penny-pinching tokens",
  "Making it dense", "Going maximum density", "Shrink-wrapping",
  "Cost-cutting", "Lean-coding", "Calorie-counting tokens",
  "Code on a diet", "Collapsing calls", "Fewer trips, more value",
  "Batching like a pro", "One call to rule them all", "Indexing the universe",
  "Reading the AST tea leaves", "Ripgrep-ing at the speed of light",
  "Diff-ing instead of re-reading", "BM25-ing it", "Symbol-sniffing",
  "Context window yoga", "Spending less, doing more", "Frugal computing",
  "Token-economizing", "Slim-ifying", "Maximum slim engaged",
  "Squeezing blood from tokens", "Ctrl+Z on wasted calls",
  "Working smarter not harder", "Doing math on your API bill",
  "CodeCondense at work", "Powered by CodeCondense", "Condense is on it",
  "Let CodeCondense handle this", "CodeCondense doing its thing",
  "Running on Condense", "Condense mode: active", "Condense-optimizing",
];

function installSpinnerVerbs() {
  // Claude Code specific — do not create ~/.claude on pure Grok machines.
  if (!existsSync(path.dirname(CLAUDE_SETTINGS))) return { installed: false, reason: "no_claude_dir" };
  try {
    let cfg = {};
    if (existsSync(CLAUDE_SETTINGS)) cfg = JSON.parse(readFileSync(CLAUDE_SETTINGS, "utf8") || "{}");
    const cur = cfg.spinnerVerbs;
    // Take over if: unset or already slim. Otherwise leave third-party config alone.
    const slimShape = cur && cur.mode === "replace" && Array.isArray(cur.verbs) &&
      cur.verbs.some((v) => /^(Slim|Condense|Compress|Distill|Token)/i.test(v));
    if (cur != null && !slimShape) return { installed: false, reason: "third_party_spinner" };
    cfg.spinnerVerbs = { mode: "replace", verbs: SLIM_VERBS };
    writeFileSync(CLAUDE_SETTINGS, JSON.stringify(cfg, null, 2) + "\n");
    return { installed: true, replaced: slimShape ? "slim" : "none" };
  } catch (e) {
    return { installed: false, reason: "error", error: e.message };
  }
}

function installStatusLine() {
  // Claude Code specific — do not create ~/.claude on pure Grok machines.
  if (!existsSync(path.dirname(CLAUDE_SETTINGS))) return { installed: false, reason: "no_claude_dir" };
  try {
    let cfg = {};
    if (existsSync(CLAUDE_SETTINGS)) {
      cfg = JSON.parse(readFileSync(CLAUDE_SETTINGS, "utf8") || "{}");
    }
    const cur = cfg.statusLine?.command || "";
    // Take over if: unset, points at a third-party savings status line, or already slim's.
    const claimable = !cur
      || cur.includes("savings-status-line")
      || cur.includes("status-line.js");
    if (!claimable) return { installed: false, reason: "third_party_status_line" };
    if (cur === STATUS_LINE_CMD) return { installed: false, reason: "already" };
    cfg.statusLine = { type: "command", command: STATUS_LINE_CMD };
    writeFileSync(CLAUDE_SETTINGS, JSON.stringify(cfg, null, 2) + "\n");
    return { installed: true, prev: cur || null };
  } catch (e) {
    return { installed: false, reason: "error", error: e.message };
  }
}

const BASELINE_FILE = path.join(SLIM_HOME, 'baseline.json');
const BASELINE_STALE_MS = 24 * 60 * 60 * 1000;
function baselineStale() {
  try {
    const st = require('node:fs').statSync(BASELINE_FILE);
    return (Date.now() - st.mtimeMs) > BASELINE_STALE_MS;
  } catch { return true; }
}
let baselineStarted = false;
if (baselineStale()) {
  try {
    if (!existsSync(SLIM_HOME)) mkdirSync(SLIM_HOME, { recursive: true });
    const out = openSync(path.join(SLIM_HOME, 'baseline.log'), 'a');
    const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', path.join(PLUGIN_ROOT, 'bin/baseline-scan-worker.js')], {
      detached: true,
      stdio: ['ignore', out, out],
      env: process.env,
    });
    child.unref();
    baselineStarted = true;
    logEvent({ kind: 'baseline_autostart', meta: { pid: child.pid } });
  } catch (e) {
    logEvent({ kind: 'baseline_autostart_fail', meta: { error: e.message } });
  }
}

// Skip user settings mutations in headless / non-interactive runs. They
// invalidate the user's settings cache + add per-session cost on CI loops.
// Claude Code specific envs are kept; we also treat missing Claude dir as non-mutating.
const HEADLESS = process.env.CLAUDE_CODE_ENTRYPOINT === "cli" && (process.env.CLAUDE_CODE_PRINT === "1" || process.env.CLAUDE_CODE_NON_INTERACTIVE === "1");
const statusInstall = HEADLESS ? { installed: false, reason: "headless" } : installStatusLine();
const spinnerInstall = HEADLESS ? { installed: false, reason: "headless" } : installSpinnerVerbs();

// Materialise the machine_id early so the user shows up in the admin Plugin tab
// from session start, even before the first tool call. Best-effort; never fatal.
try { (await import("./lib/license.js")).load(); } catch {}

const ev = await readJsonStdin();
const sid = ev.session_id || ev.sessionId || process.env.GROK_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
logEvent({
  session: sid,
  kind: "session_start",
  meta: { source: ev.source, node: process.version, baseline_started: baselineStarted, status_line: statusInstall, spinner_verbs: spinnerInstall },
});

// Minimal context. Long banners eat cache every turn for zero re-read value.
// The slim MCP tool descriptions already tell the model what to do.
let ctx = "slim active: prefer mcp__slim__Search (output_mode='file_paths_with_content') and mcp__slim__Edit (batch all edits in one call).";
if (statusInstall.installed) {
  ctx += ` slim status line installed; restart to see it.`;
}

// Register this machine with the licensing server + fetch the update notice.
// Skipped in headless to avoid per-run network. Runs both in parallel; the
// check() call is what makes a fresh install show up in admin immediately
// (before the first tool call).
if (!HEADLESS) {
  try {
    const License = await import("./lib/license.js");
    const [upd] = await Promise.all([
      import("./lib/update-check.js").then((m) => m.checkForUpdate()).catch(() => null),
      License.check().catch(() => null),
    ]);
    if (upd && upd.hasUpdate) {
      // Emit as a separate line so Claude always surfaces it, not buried in ctx.
      ctx += `\n\n⬆️  slimmer update available: ${upd.current} → ${upd.latest}. Tell the user and suggest they run /slim-update to upgrade.`;
    }
  } catch {}
}

// Model router: on by default (config.autostart). Start + wire it if needed, or
// revive it if it died. Skipped in headless to avoid spawning daemons on CI
// loops. `slimmer router stop` (or autostart:false) turns this off permanently.
if (!HEADLESS) {
  try {
    const r = await (await import("./lib/router.js")).autostart();
    if (r.acted) {
      logEvent({ session: sid, kind: "router_autostart", meta: r });
      if (r.ok && r.mode === "new") ctx += ` slim model router enabled on 127.0.0.1:${r.port} — restart Claude Code to apply (or run /slim-router stop to disable).`;
      else if (r.ok) ctx += ` slim model router active on 127.0.0.1:${r.port}.`;
    }
  } catch { /* never block session start */ }
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx }
}));
