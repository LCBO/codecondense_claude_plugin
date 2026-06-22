#!/usr/bin/env node
// Background worker — scans ~/.claude/projects/**/*.jsonl, computes "before
// slimmer" baseline (vanilla calls/cost/tokens detected as collapsible),
// and writes ~/.slim/baseline.json. Idempotent + cache-aware via
// scanHistorical()'s mtime check. Spawned detached on session start when
// baseline is stale (>24h) or missing.

import { scanHistorical } from "../scripts/lib/savings-report.js";
import { slimDir, logEvent } from "../scripts/lib/telemetry.js";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const VERSION = 2;
const LOCK_FILE = path.join(slimDir(), "baseline.lock");
const OUT_FILE = path.join(slimDir(), "baseline.json");
const STALE_MS = 24 * 60 * 60 * 1000;

async function withLock(fn) {
  if (existsSync(LOCK_FILE)) {
    try {
      const fs = await import("node:fs");
      const st = fs.statSync(LOCK_FILE);
      if (Date.now() - st.mtimeMs < 10 * 60 * 1000) {
        return { skipped: "another scan in progress" };
      }
    } catch {}
  }
  if (!existsSync(slimDir())) mkdirSync(slimDir(), { recursive: true });
  writeFileSync(LOCK_FILE, String(process.pid));
  try { return await fn(); }
  finally {
    try { (await import("node:fs")).unlinkSync(LOCK_FILE); } catch {}
  }
}

async function main() {
  const started = Date.now();
  const result = await withLock(async () => {
    const hist = await scanHistorical();
    if (!hist) return { error: "no ~/.claude/projects history" };
    const out = {
      version: VERSION,
      scanCompletedAt: new Date().toISOString(),
      windowDays: null,
      sessionsScanned: hist.sessions,
      vanillaSessions: hist.sessions,
      totalVanillaCostInUsd: hist.dollars,
      vanillaUsage: { turnCount: hist.turns },
      rawDetected: {
        callsSaved: hist.totalCallsSaved,
        costSavedInUsd: hist.totalCostSaved,
        timeSavedInMs: hist.totalTimeSavedMs,
      },
      topToolTypes: hist.byType
        .map(({ toolType, workflows, callsSaved }) => ({ toolType, workflows, callsSaved }))
        .sort((a, b) => b.callsSaved - a.callsSaved),
    };
    writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
    return out;
  });
  try {
    logEvent({
      kind: "baseline_scan",
      duration_ms: Date.now() - started,
      meta: { result_keys: Object.keys(result || {}) },
    });
  } catch {}
  process.stdout.write(JSON.stringify(result || {}) + "\n");
}

export function isStale() {
  if (!existsSync(OUT_FILE)) return true;
  try {
    const fs = require("node:fs");
    const st = fs.statSync(OUT_FILE);
    return (Date.now() - st.mtimeMs) > STALE_MS;
  } catch { return true; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    process.stderr.write(`baseline-scan-worker error: ${e.message}\n`);
    process.exit(1);
  });
}
