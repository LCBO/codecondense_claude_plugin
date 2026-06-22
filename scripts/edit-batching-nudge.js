#!/usr/bin/env node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJsonStdin, logEvent } from "./lib/telemetry.js";
import { recordEdit } from "./lib/redirect-state.js";

const STATE_FILE = path.join(os.tmpdir(), "slimmer-edit-state.json");
const WINDOW_MS = 60_000;
const SAME_FILE_THRESHOLD = 2;   // 2+ edits to one file in window
const ANY_FILE_THRESHOLD  = 3;   // 3+ edits across files in window

async function loadState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, "utf8")); }
  catch { return { edits: [] }; }
}

const ev = await readJsonStdin();
const sid = ev.session_id || ev.sessionId || process.env.CLAUDE_SESSION_ID || null;
const tool = ev.tool_name || "";
const input = ev.tool_input || {};

function extractFiles() {
  // Built-in Edit / Write
  if (input.file_path) return [input.file_path];
  if (input.file) return [input.file];
  // slim Edit edits[]
  if (Array.isArray(input.edits)) {
    return input.edits.map((e) => e.file).filter(Boolean);
  }
  return [];
}

const files = extractFiles();
const isEditish = /^(?:Edit|Write|mcp__slim__Edit|mcp__slim__Write)$/.test(tool);

// Only count single-edit calls (the anti-pattern). edits[] of length >=2 is already batched.
const isSingle =
  (tool === "Edit" || tool === "Write" || tool === "mcp__slim__Write")
  || (tool === "mcp__slim__Edit" && files.length <= 1);

if (!isEditish || !isSingle) {
  process.stdout.write("{}");
  process.exit(0);
}

// Track which Edit family fired so we can self-suppress when slim:Edit is unreachable.
const editKind = (tool === "mcp__slim__Edit") ? "slim" : "native";
const counts = await recordEdit(sid, editKind);

// Suppress nudge when the model has done many native Edits and zero slim:Edits in
// this session — it means slim:Edit is not in the available tool surface (no
// permission grant, or running headless without our default-allowed permissions).
// Repeating the nudge in that case is just noise that bloats cache.
if (counts.native >= 4 && counts.slim === 0) {
  process.stdout.write("{}");
  process.exit(0);
}

// Once the model has used slim:Edit at least once, it knows the tool exists —
// don't pollute cache by repeating the nudge on subsequent native edits.
if (counts.slim >= 1) {
  process.stdout.write("{}");
  process.exit(0);
}

const now = Date.now();
const state = await loadState();
state.edits = state.edits.filter((e) => now - e.time < WINDOW_MS);
for (const f of files) state.edits.push({ time: now, file: f });
try { await fs.writeFile(STATE_FILE, JSON.stringify(state)); } catch {}

const byFile = {};
for (const e of state.edits) byFile[e.file] = (byFile[e.file] || 0) + 1;
const sameFile = Object.entries(byFile).find(([, n]) => n >= SAME_FILE_THRESHOLD);
const anyN = state.edits.length;

let ctx = null;
if (sameFile) {
  ctx = `You've made ${sameFile[1]} single Edit calls to \`${sameFile[0]}\` in the last ${WINDOW_MS/1000}s. Batch them into ONE mcp__slim__Edit call: pass an edits[] array with all changes for this file. Saves a roundtrip per edit.`;
} else if (anyN >= ANY_FILE_THRESHOLD) {
  ctx = `You've made ${anyN} single Edit/Write calls across files in the last ${WINDOW_MS/1000}s. mcp__slim__Edit accepts edits across multiple files in one edits[] — collapse them.`;
}

if (ctx) {
  logEvent({ session: sid, kind: "edit_batch_nudge", tool, meta: { sameFile: !!sameFile, count: anyN } });
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: ctx },
  }));
} else {
  process.stdout.write("{}");
}
