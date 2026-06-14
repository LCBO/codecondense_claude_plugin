#!/usr/bin/env node
// PostToolUse loop detection. Hashes (tool + canonical args) per session and
// warns when the same call repeats N times in a sliding window of last 10.
import { readJsonStdin, logEvent } from "./lib/telemetry.js";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const SLIM = process.env.SLIM_HOME || path.join(os.homedir(), ".slim");
const LOOP_DIR = path.join(SLIM, "loops");
if (!existsSync(LOOP_DIR)) mkdirSync(LOOP_DIR, { recursive: true });

const WINDOW = 10;
const THRESHOLD = 3;

const ev = await readJsonStdin();
const event = ev.hook_event_name || ev.event;
if (event && event !== "PostToolUse") { process.stdout.write("{}"); process.exit(0); }

const tool = ev.tool_name || ev.tool;
const input = ev.tool_input || {};
const sid = ev.session_id || process.env.CLAUDE_SESSION_ID || "_default";
if (!tool) { process.stdout.write("{}"); process.exit(0); }

function canonical(o) {
  if (o == null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(canonical).join(",") + "]";
  return "{" + Object.keys(o).sort().map(k => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
}
const hash = createHash("sha1").update(tool + "|" + canonical(input)).digest("hex").slice(0, 16);

const stateFile = path.join(LOOP_DIR, sid.replace(/[^A-Za-z0-9_-]/g, "_") + ".json");
let ring = [];
try { ring = JSON.parse(readFileSync(stateFile, "utf8")); } catch {}
ring.push({ hash, tool, ts: Date.now() });
if (ring.length > WINDOW) ring = ring.slice(-WINDOW);

const sameHash = ring.filter(r => r.hash === hash);
let ctx = "";
if (sameHash.length >= THRESHOLD) {
  const tools = sameHash.map(r => r.tool).filter((t, i, a) => a.indexOf(t) === i);
  ctx = `LOOP DETECTED: \`${tool}\` called ${sameHash.length}× with identical args in last ${ring.length} tool calls. Either change approach (different tool / different scope), pass narrower args, or stop. Repeating identical calls burns tokens without progress.`;
  logEvent({ session: sid, kind: "loop_detected", tool, meta: { hash, count: sameHash.length, tools } });
  // reset so we only nudge once per loop instead of every subsequent call
  ring = [];
}

try { writeFileSync(stateFile, JSON.stringify(ring)); } catch {}

process.stdout.write(JSON.stringify(
  ctx ? { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: ctx } } : {}
));
