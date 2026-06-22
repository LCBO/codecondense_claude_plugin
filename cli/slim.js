#!/usr/bin/env node
import { summary, recentTools, dbPath, tailEvents, resetEvents, readAllEvents, lastSessionId } from "../scripts/lib/telemetry.js";
import { reindex as reindexCode, runSql as queryIndex, indexPath } from "../scripts/lib/symbol-index.js";
import { c, table, heading } from "../scripts/lib/format.js";
import { promises as fs, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const PLUGINS_DIR = path.join(CLAUDE_DIR, "plugins");
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json");
const KNOWN_MARKETPLACES = path.join(PLUGINS_DIR, "known_marketplaces.json");
const INSTALLED_PLUGINS = path.join(PLUGINS_DIR, "installed_plugins.json");

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}
async function writeJson(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj, null, 2) + "\n");
}

async function installPlugin() {
  if (!existsSync(CLAUDE_DIR)) {
    console.error(`Claude Code config dir not found at ${CLAUDE_DIR}. Set CLAUDE_CONFIG_DIR or run claude once first.`);
    process.exit(1);
  }
  const km = await readJson(KNOWN_MARKETPLACES, {});
  km["slimmer-marketplace"] = {
    source: { source: "directory", path: PLUGIN_ROOT },
    installLocation: PLUGIN_ROOT,
    lastUpdated: new Date().toISOString(),
  };
  await writeJson(KNOWN_MARKETPLACES, km);

  const ip = await readJson(INSTALLED_PLUGINS, { version: 2, plugins: {} });
  if (!ip.plugins) ip.plugins = {};
  ip.plugins["slimmer@slimmer-marketplace"] = [{
    scope: "user",
    installPath: PLUGIN_ROOT,
    version: "0.2.0",
    installedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  }];
  await writeJson(INSTALLED_PLUGINS, ip);

  const settings = await readJson(SETTINGS_PATH, {});
  settings.enabledPlugins = settings.enabledPlugins || {};
  settings.enabledPlugins["slimmer@slimmer-marketplace"] = true;
  await writeJson(SETTINGS_PATH, settings);

  console.log("slimmer installed.");
  console.log(`  marketplace path: ${PLUGIN_ROOT}`);
  console.log(`  enabled in:       ${SETTINGS_PATH}`);
  console.log("");
  console.log("Restart Claude Code to activate. Then run /slim-savings.");
}

const SLIM_HOME = process.env.SLIM_HOME || path.join(os.homedir(), ".slim");

async function uninstallPlugin() {
  const cleaned = [];
  const errors = [];

  // Only match these exact slim/slimmer plugin identifiers
  const slimMarketplaces = ["slimmer-marketplace", "slim-marketplace"];
  const slimPlugins = ["slimmer@slimmer-marketplace", "slim@slim-marketplace"];
  function isSlimEntry(name) {
    if (!name) return false;
    return slimMarketplaces.some(m => m === name || name.startsWith(m + "/"));
  }

  // Clean known_marketplaces.json
  const km = await readJson(KNOWN_MARKETPLACES, {});
  slimMarketplaces.forEach(m => delete km[m]);
  await writeJson(KNOWN_MARKETPLACES, km);
  cleaned.push("known_marketplaces.json");

  // Clean installed_plugins.json — only exact slim/slimmer plugin IDs
  const ip = await readJson(INSTALLED_PLUGINS, { version: 2, plugins: {} });
  if (ip.plugins) {
    slimPlugins.forEach(p => delete ip.plugins[p]);
  }
  await writeJson(INSTALLED_PLUGINS, ip);
  cleaned.push("installed_plugins.json");

  // Clean settings.json — only exact slim/slimmer entries
  const settings = await readJson(SETTINGS_PATH, {});
  if (settings.enabledPlugins) {
    slimPlugins.forEach(p => delete settings.enabledPlugins[p]);
  }
  if (settings.enabledMcpJsonServers) {
    delete settings.enabledMcpJsonServers["slim"];
    delete settings.enabledMcpJsonServers["slimmer"];
  }
  if (Array.isArray(settings.statusLine)) {
    settings.statusLine = settings.statusLine.filter(item => item !== "slim" && item !== "slimmer");
  }
  if (Array.isArray(settings.extraKnownMarketplaces)) {
    settings.extraKnownMarketplaces = settings.extraKnownMarketplaces.filter(item => !isSlimEntry(item));
  }
  await writeJson(SETTINGS_PATH, settings);
  cleaned.push("settings.json");

  // Clean settings.local.json — only mcp__plugin_slim_slim__* permissions
  const settingsLocalPath = path.join(CLAUDE_DIR, "settings.local.json");
  const settingsLocal = await readJson(settingsLocalPath, {});
  if (settingsLocal.permissions) {
    for (const key of Object.keys(settingsLocal.permissions || {})) {
      if (key.startsWith("mcp__plugin_slim_slim__")) delete settingsLocal.permissions[key];
    }
  }
  await writeJson(settingsLocalPath, settingsLocal);
  cleaned.push("settings.local.json");

  // Delete directories
  const dirsToDelete = [
    path.join(os.homedir(), ".slimmer"),
    path.join(os.homedir(), ".grok", "plugins", "slim"),
  ];

  for (const dir of dirsToDelete) {
    try {
      if (existsSync(dir)) {
        await fs.rm(dir, { recursive: true, force: true });
        cleaned.push(`deleted ${dir}`);
      }
    } catch (e) {
      errors.push(`failed to delete ${dir}: ${e.message}`);
    }
  }

  // Delete plugin cache entries (slim-marketplace, slimmer-marketplace, etc.)
  const cacheDirs = [
    path.join(CLAUDE_DIR, "plugins", "cache"),
    path.join(CLAUDE_DIR, "plugins", "marketplaces"),
    path.join(CLAUDE_DIR, "plugins", "data"),
  ];

  for (const baseDir of cacheDirs) {
    try {
      if (existsSync(baseDir)) {
        const entries = await fs.readdir(baseDir);
        for (const entry of entries) {
          if (isSlimEntry(entry)) {
            const fullPath = path.join(baseDir, entry);
            await fs.rm(fullPath, { recursive: true, force: true });
            cleaned.push(`deleted ${fullPath}`);
          }
        }
      }
    } catch (e) {
      errors.push(`failed to clean ${baseDir}: ${e.message}`);
    }
  }

  // Report results
  console.log("slimmer uninstalled.");
  for (const msg of cleaned) {
    console.log(`  ✓ ${msg}`);
  }
  if (errors.length) {
    console.log("\nWarnings:");
    for (const err of errors) {
      console.log(`  ⚠ ${err}`);
    }
  }
  console.log("\nRestart Claude Code.");
}

function fmt(n) {
  if (!n) return "0";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

const cmd = process.argv[2] || "savings";

if (cmd === "profile") {
  const fsm = await import("node:fs");
  const cfgPath = path.join(SLIM_HOME, "config.json");
  let cfg = {};
  if (existsSync(cfgPath)) { try { cfg = JSON.parse(readFileSync(cfgPath, "utf8")); } catch {} }
  const sub = process.argv[3];
  const PROFILES = ["tiny", "lean", "core", "full", "ultra"];
  if (!sub) {
    console.log(`Current tool_profile: ${cfg.tool_profile || "full"}`);
    console.log(`Profiles: ${PROFILES.join(", ")}`);
    console.log(`Set with: slim profile <name>  or env SLIM_PROFILE=<name>`);
  } else if (PROFILES.includes(sub)) {
    cfg.tool_profile = sub;
    if (!existsSync(SLIM_HOME)) fsm.mkdirSync(SLIM_HOME, { recursive: true });
    fsm.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
    console.log(`tool_profile = ${sub}  (restart Claude Code to apply)`);
  } else {
    console.error(`unknown profile: ${sub}. one of: ${PROFILES.join(", ")}`);
    process.exit(1);
  }
} else if (cmd === "dashboard") {
  const { buildDashboard } = await import("../scripts/lib/dashboard.js");
  const sub = process.argv[3];
  if (sub === "--serve" || sub === "serve") {
    await import("../bin/slim-dashboard.js");
  } else {
    const { path: p, life, sess } = buildDashboard();
    console.log(`Wrote ${p}`);
    console.log(`Lifetime saved: ${fmt(life.saved || 0)} bytes from ${fmt(life.baseline || 0)} baseline`);
    console.log(`Open: file://${p}  (or run: slim dashboard --serve)`);
  }
} else if (cmd === "savings" || cmd === "report") {
  const { report, actualSpend, detectModel } = await import("../scripts/lib/savings-report.js");
  console.log(await report());
  console.log("");

  const life = summary(false) || {};
  const sess = summary(true) || {};
  const _model = detectModel(readAllEvents(), process.env.CLAUDE_SESSION_ID || lastSessionId());
  console.log(heading("Raw plugin telemetry"));
  console.log(c.gray(`    ${dbPath()}`));
  console.log(table(
    ["Metric", "This session", "Lifetime"],
    [
      ["Tool calls",        String(sess.calls || 0),       String(life.calls || 0)],
      ["  via slim MCP", String(sess.slim_calls || 0),  String(life.slim_calls || 0)],
      ["Tokens in",          fmt(sess.in_tok),              fmt(life.in_tok)],
      ["Tokens out",         fmt(sess.out_tok),             fmt(life.out_tok)],
      ["Cache read",         fmt(sess.cache_r),             fmt(life.cache_r)],
      ["Est. cost (actual)", c.yellow("$" + actualSpend(sess, _model).toFixed(4)), c.yellow("$" + actualSpend(life, _model).toFixed(4))],
    ],
    { align: ["left", "right", "right"] },
  ));
  const MIN_SAMPLE = 50;
  const baseline = life.baseline || 0, served = life.bytes_tracked || 0, slimCalls = life.slim_calls || 0;
  if (!baseline) {
    console.log(c.gray("    Byte-level baseline comparison not available yet (pre-migration events)."));
  } else if (slimCalls < MIN_SAMPLE) {
    console.log(c.gray(`    Byte-level comparison needs ≥${MIN_SAMPLE} slim calls to be reliable (have ${slimCalls}).`));
  } else {
    const tokWithout = Math.round(baseline / 4), tokWith = Math.round(served / 4);
    const tokSaved = Math.max(0, tokWithout - tokWith);
    const pct = Math.max(0, Math.round(100 * (baseline - served) / baseline));
    console.log(`    Tool-result tokens: ~${fmt(tokWithout)} raw → ~${fmt(tokWith)} served  ${c.green("(−" + pct + "%, ~" + fmt(tokSaved) + " tok)")}`);
  }
  console.log("");

  console.log(heading("Top tools (lifetime)"));
  console.log(table(
    ["Tool", "Calls", "Resp bytes"],
    recentTools(15, false).map((r) => [r.tool || "?", String(r.n), fmt(r.bytes || 0)]),
    { align: ["left", "right", "right"] },
  ));
} else if (cmd === "tail") {
  const limit = +process.argv[3] || 30;
  for (const r of tailEvents(limit)) {
    const t = new Date(r.ts).toISOString().slice(11, 19);
    console.log(`${t}  ${(r.kind || "").padEnd(14)} ${(r.tool || "").padEnd(36)} ${String(r.duration_ms ?? "").padStart(6)}ms  ${String(r.response_bytes ?? "").padStart(8)}B  ${r.args_summary || ""}`);
  }
} else if (cmd === "reset") {
  resetEvents();
  console.log("events cleared");
} else if (cmd === "stats") {
  const s = queryIndex({ op: "stats" });
  if (!existsSync(indexPath())) {
    console.log("No code index yet. Run /slim-reindex (or: slim reindex) to build it.");
  } else {
    console.log(`Code index: ${s.files} files, ${s.symbols} symbols`);
    console.log(`  ${indexPath()}`);
  }
} else if (cmd === "reindex") {
  const s = await reindexCode(process.cwd());
  console.log(`Reindexed: ${s.files} files, ${s.symbols} symbols`);
  console.log(`  ${indexPath()}`);
} else if (cmd === "db") {
  console.log(dbPath());
} else if (cmd === "install") {
  await installPlugin();
} else if (cmd === "uninstall") {
  await uninstallPlugin();
} else if (cmd === "recover") {
  const Guard = await import("../servers/lib/guardrails.js");
  const target = process.argv[3];
  const fsm = await import("node:fs");
  if (!target) {
    console.error("usage: slim recover <file>            list backups for <file>");
    console.error("       slim recover <file> latest     restore most-recent backup");
    console.error("       slim recover <file> <ts>       restore backup at timestamp");
    process.exit(1);
  }
  const abs = path.resolve(process.cwd(), target);
  const backups = Guard.listBackups(abs);
  if (!backups.length) { console.log(`no backups for ${abs}`); process.exit(0); }
  const action = process.argv[4];
  if (!action) {
    console.log(`backups for ${abs} (newest first):`);
    for (const b of backups) {
      const t = new Date(b.ts).toISOString().replace("T", " ").slice(0, 19);
      const sz = fsm.statSync(b.path).size;
      console.log(`  ${b.ts}  ${t}  ${String(sz).padStart(8)}B  ${b.path}`);
    }
    console.log(`\nto restore: slim recover ${target} latest`);
  } else {
    const pick = action === "latest" ? backups[0] : backups.find((b) => String(b.ts) === action);
    if (!pick) { console.error(`no backup with ts=${action}`); process.exit(1); }
    const old = fsm.readFileSync(pick.path);
    if (fsm.existsSync(abs)) {
      // Backup the current state before restoring so we can undo.
      await Guard.backup(abs, fsm.readFileSync(abs, "utf8"));
    }
    fsm.writeFileSync(abs, old);
    console.log(`restored ${abs} from ${pick.path} (${old.length} bytes)`);
  }
} else if (cmd === "update") {
  // Two install shapes need two update paths:
  //  1. git clone (git pull in place).
  //  2. Claude Code marketplace cache (~/.claude/plugins/cache/<mkt>/<plugin>/<ver>):
  //     NOT a git clone + version-pinned, so git pull can't work. Update it
  //     through Claude Code's own plugin system.
  const isGit = existsSync(path.join(PLUGIN_ROOT, ".git"));
  const cacheMatch = PLUGIN_ROOT.match(/[/\\]plugins[/\\](?:cache|repos|marketplaces)[/\\]([^/\\]+)[/\\]([^/\\]+)[/\\]/);
  if (isGit) {
    console.log("Updating slimmer from git…");
    // Public repo uses orphan force-push — can't fast-forward, fetch + reset hard.
    const fetch = spawnSync("git", ["-C", PLUGIN_ROOT, "fetch", "--depth", "1", "origin", "main"], { stdio: "inherit" });
    if (fetch.status !== 0) { console.error(c.red("git fetch failed.")); process.exit(1); }
    const reset = spawnSync("git", ["-C", PLUGIN_ROOT, "reset", "--hard", "origin/main"], { stdio: "inherit" });
    if (reset.status !== 0) { console.error(c.red("git reset failed.")); process.exit(1); }
    console.log("Installing dependencies…");
    const inst = spawnSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: PLUGIN_ROOT, stdio: "inherit" });
    if (inst.status !== 0) { console.error(c.red("npm install failed.")); process.exit(1); }
    console.log(c.green("\nslimmer updated. Restart Claude Code."));
  } else if (cacheMatch) {
    const marketplace = cacheMatch[1] || "slimmer-marketplace";
    const plugin = cacheMatch[2] || "slimmer";
    const ref = `${plugin}@${marketplace}`;
    const haveClaude = spawnSync("claude", ["--version"], { stdio: "ignore" }).status === 0;
    if (!haveClaude) {
      console.error(c.yellow("This is a Claude Code marketplace install; update it through Claude Code:"));
      console.error("  " + c.cyan(`claude plugin marketplace update ${marketplace}`));
      console.error("  " + c.cyan(`claude plugin update ${ref}`));
      console.error("Then restart Claude Code.");
      process.exit(1);
    }
    console.log(`Refreshing marketplace ${c.cyan(marketplace)} from source…`);
    const mp = spawnSync("claude", ["plugin", "marketplace", "update", marketplace], { stdio: "inherit" });
    console.log(`Updating plugin ${c.cyan(ref)}…`);
    const up = spawnSync("claude", ["plugin", "update", ref], { stdio: "inherit" });
    if ((mp.status ?? 0) !== 0 || (up.status ?? 0) !== 0) {
      console.error(c.red("\nUpdate via Claude Code failed. Run these manually, then restart:"));
      console.error("  " + c.cyan(`claude plugin marketplace update ${marketplace}`));
      console.error("  " + c.cyan(`claude plugin update ${ref}`));
      process.exit(1);
    }
    console.log(c.green("\nCondense updated via Claude Code. Restart Claude Code to apply."));
  } else {
    console.error(c.yellow(`Cannot auto-update: ${PLUGIN_ROOT} is neither a git clone nor a Claude Code marketplace cache.`));
    console.error("Install with: " + c.cyan("claude plugin add LCBO/slimmer") + "  (or: " + c.cyan("claude plugin marketplace add LCBO/slimmer") + ")");
    process.exit(1);
  }
} else if (cmd === "status") {
  const License = await import("../scripts/lib/license.js");
  const { refresh: refreshUpdate, cached: cachedUpdate, currentVersion } = await import("../scripts/lib/update-check.js");
  const { lifetimeSavings } = await import("../scripts/lib/savings-report.js");
  const s = await License.check();  // live check against the server
  const localSavedUsd = s.saved_usd ?? lifetimeSavings().saved_usd;
  const installed = currentVersion();  // always from git tag / plugin.json — never stale
  const upd = (await refreshUpdate()) || cachedUpdate() || null;  // live remote check, fall back to cache
  console.log(heading("slimmer — license status"));
  if (!s.gating_enabled) {
    console.log(c.gray("    Gating disabled (SLIM_API_URL not set) — all tools are free."));
  }
  const versionVal = !upd?.latest
    ? c.green(`${installed} (latest)`)
    : upd.hasUpdate
      ? c.yellow(`${installed} → ${upd.latest} available`) + c.gray("  (run: slim update)")
      : c.green(`${installed} (up to date)`);
  console.log(table(
    ["Field", "Value"],
    [
      ["Machine ID",   s.machine_id],
      ["Registered",   s.key_valid ? c.green("yes (verified)") : (s.registered ? c.yellow("key set — not verified by server") : c.yellow("no"))],
      ["Plan",         s.paid ? c.green("paid") : (s.allow ? "trial" : c.red("trial exhausted"))],
      ["$ saved (lifetime)", localSavedUsd == null ? "—" : "$" + Number(localSavedUsd).toFixed(2)],
      ["Cap",          !s.checked ? c.yellow("unknown (server unreachable)") : s.usd_limit ? "$" + Number(s.usd_limit).toFixed(2) : "∞ unlimited"],
      ["Used this month", !s.checked ? c.yellow("unknown") : s.used_usd == null ? "—" : "$" + Number(s.used_usd).toFixed(2)],
      ["Remaining",    !s.checked ? c.yellow("unknown") : s.remaining_usd == null ? "∞" : "$" + Number(s.remaining_usd).toFixed(2)],
      ["Usage reset",  !s.checked ? c.yellow("unknown") : s.reset_at ? c.cyan(s.reset_at) + c.gray(" (1st of month)") : "—"],
      ["Version",      versionVal],
    ],
    { align: ["left", "left"] },
  ));
  if (!s.registered && s.register_url) {
    console.log(`\n    Register: ${c.cyan(s.register_url)}`);
    console.log(`    Then: slim login <KEY>  (or export SLIM_API_KEY=<KEY>)`);
  }
} else if (cmd === "login") {
  const License = await import("../scripts/lib/license.js");
  const key = process.argv[3];
  if (!key) {
    console.error("usage: slim login <API_KEY>");
    process.exit(1);
  }
  License.setKey(key);
  process.stdout.write("Verifying key with the server… ");
  let s = null;
  try { s = await License.check(); } catch { s = null; }   // live round-trip
  if (s && s.key_valid) {
    console.log(c.green("ok"));
    console.log(c.green("✓ API key verified — your plan is active, trial limit lifted."));
  } else if (!s || !s.gating_enabled) {
    console.log(c.gray("skipped"));
    console.log("Key saved. Gating is disabled on this install, so there is nothing to verify.");
  } else if (!s.checked) {
    console.log(c.yellow("server unreachable"));
    console.log(c.yellow("Key saved locally but not verified (server unreachable). It will be checked again next session."));
  } else {
    console.log(c.red("not accepted"));
    console.log(c.red("✗ The server did not accept this key — you are still on the trial plan."));
    console.log("Double-check the key on your account page, then run /slim-login <KEY> again.");
  }
  console.log("Restart Claude Code (or continue) to apply.");
} else if (cmd === "logout") {
  const License = await import("../scripts/lib/license.js");
  License.setKey("");
  console.log("Key removed. Back to trial.");
} else if (cmd === "router") {
  const Router = await import("../scripts/lib/router.js");
  const sub = process.argv[3] || "status";
  if (sub === "start") {
    const r = await Router.startDaemon(process.argv[4]);
    if (!r.ok) { console.error(c.red(`router start failed: ${r.error}`)); process.exit(1); }
    if (r.already) {
      console.log(c.yellow(`router already running (pid ${r.pid}, port ${r.port}).`));
    } else {
      console.log(c.green(`router started`) + ` — pid ${r.pid}, 127.0.0.1:${r.port} → ${r.upstream}`);
      console.log(`  default=${r.models.default}  background=${r.models.background}  reason=${r.models.reason || r.models.default}+think  think=${r.models.think}  longContext=${r.models.longContext}`);
      console.log(c.cyan("  Restart Claude Code to pick up ANTHROPIC_BASE_URL."));
    }
  } else if (sub === "stop") {
    const r = Router.stopDaemon();
    console.log(r.killed ? c.green("router stopped") + " and settings restored." : "router not running; settings restored.");
    console.log(c.cyan("  Restart Claude Code to drop ANTHROPIC_BASE_URL."));
  } else if (sub === "restart") {
    const r = await Router.restartDaemon(process.argv[4]);
    if (!r.ok) { console.error(c.red(`router restart failed: ${r.error}`)); process.exit(1); }
    console.log(c.green(`router restarted`) + ` — pid ${r.pid}, port ${r.port}.`);
    console.log(c.cyan("  Restart Claude Code to pick up ANTHROPIC_BASE_URL."));
  } else if (sub === "config") {
    const p = Router.ensureConfig();
    console.log(`router config: ${p}`);
    console.log(readFileSync(p, "utf8"));
  } else if (sub === "status") {
    const s = await Router.status();
    const cfg = s.config;
    console.log(heading("slim model router"));
    console.log(table(
      ["Field", "Value"],
      [
        ["Running",   s.alive ? c.green(`yes (pid ${s.pid}, port ${s.port})`) : c.yellow("no")],
        ["Wired",     s.wired ? c.green(s.wired) : c.gray("settings.json has no ANTHROPIC_BASE_URL")],
        ["Upstream",  s.upstream || cfg.upstream],
        ["default",   cfg.models.default],
        ["background", cfg.models.background],
        ["reason",    (cfg.models.reason || cfg.models.default) + c.gray(`  (+thinking ${cfg.reasoningBudget ?? 6000} tok)`)],
        ["think",     cfg.models.think],
        ["longContext", cfg.models.longContext + c.gray(`  (> ${cfg.longContextThreshold} tok)`)],
      ],
      { align: ["left", "left"] },
    ));
    console.log("");
    console.log(heading("Routing policy"));
    console.log(table(
      ["Flag", "Value"],
      [
        ["Autostart (default on)", cfg.autostart === false ? c.yellow("off") : c.green("on")],
        ["Tool-desc trim",         cfg.trimRequest === false ? c.gray("off") : c.green(`on (cap ${cfg.toolDescCap ?? 1200})`)],
        ["Reasoning ladder",       cfg.reasoningTier === false ? c.gray("off") : c.green(`on (Sonnet+thinking before Opus)`)],
        ["Cache-aware stickiness", cfg.stickiness === false ? c.yellow("off") : c.green("on")],
        ["Overload retries",       String(cfg.overloadRetries ?? 2)],
        ["1h cache TTL",           cfg.cacheTtl1h ? c.green("on") : c.gray("off")],
        ["Daily budget",           cfg.dailyBudgetUsd ? "$" + Number(cfg.dailyBudgetUsd).toFixed(2) : c.gray("none")],
      ],
      { align: ["left", "left"] },
    ));
    console.log("");
    console.log(heading("Measured (from telemetry)"));
    const st = s.stats || {};
    if (!st.n) {
      console.log(c.gray("    No routed turns recorded yet — start the router and use Claude Code."));
    } else {
      const mix = Object.entries(st.byLabel || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ");
      console.log(table(
        ["Metric", "Value"],
        [
          ["Routed turns",       String(st.n) + c.gray(`  (today ${st.today_n})`)],
          ["Tier mix",           mix],
          ["Actual spend",       c.yellow("$" + st.actual.toFixed(4)) + c.gray(`  (today $${(st.today_actual || 0).toFixed(4)})`)],
          ["If every turn = Opus", "$" + st.allOpus.toFixed(4)],
          ["Saved by routing",   c.green("$" + st.saved.toFixed(4) + `  (−${st.savedPct}%)`)],
          ["Spend today (live)",  s.spentToday != null ? "$" + Number(s.spentToday).toFixed(4) : c.gray("—")],
          ["Overload retries",    String(st.retries || 0)],
        ],
        { align: ["left", "left"] },
      ));
    }
  } else {
    console.error(`unknown router subcommand: ${sub}. one of: start, stop, restart, status, config`);
    process.exit(1);
  }
} else if (cmd === "admin") {
  const sub = args[0] || "status";
  const { autostart, stop, status: adminStatus, getPort } = await import("../scripts/lib/admin-server.js");

  if (sub === "start") {
    const r = await autostart();
    if (!r.acted && r.reason === "already_running") {
      console.log(`slim admin already running on http://127.0.0.1:${r.port}`);
    } else if (r.ok) {
      console.log(`slim admin started on http://127.0.0.1:${r.port}`);
    } else {
      console.error(`failed to start admin server: ${r.error || r.reason || "unknown"}`);
      process.exit(1);
    }
  } else if (sub === "stop") {
    const r = stop();
    if (r.ok) console.log(`slim admin stopped (pid ${r.pid})`);
    else console.error(`stop failed: ${r.error || r.reason}`);
  } else if (sub === "status") {
    const s = await adminStatus();
    console.log(`  url       http://127.0.0.1:${s.port}`);
    console.log(`  pid       ${s.pid ?? '—'}`);
    console.log(`  running   ${s.alive ? 'yes' : 'no'}`);
    console.log(`  reachable ${s.reachable ? 'yes' : 'no'}`);
  } else if (sub === "url") {
    console.log(`http://127.0.0.1:${getPort()}`);
  } else if (sub === "build-ui") {
    const uiDir = path.join(PLUGIN_ROOT, "admin-server", "ui");
    console.log("building admin UI…");
    const r = spawnSync("npm", ["run", "build"], { cwd: uiDir, stdio: "inherit", shell: true });
    process.exit(r.status ?? 0);
  } else {
    console.error(`unknown admin subcommand: ${sub}. use start|stop|status|url|build-ui`);
    process.exit(1);
  }

} else if (cmd === "help" || cmd === "-h" || cmd === "--help") {
  console.log(`slim — local token-saving telemetry CLI

Commands:
  savings              show session + lifetime savings (default)
  tail [N]             show last N events
  reset                clear all telemetry events
  db                   print events DB path
  stats                show code-index stats (files/symbols)
  reindex              rebuild the code symbol index for this project
  install              wire slimmer into Claude Code (~/.claude config)
  update               update the installed plugin (git pull, or via Claude Code marketplace)
  uninstall            remove slimmer from Claude Code config
  recover <f>          list backups for file
  recover <f> latest   restore newest backup
  recover <f> <ts>     restore backup at timestamp
  dashboard            render HTML dashboard (~/.slim/dashboard.html)
  dashboard --serve    start http server on 127.0.0.1:24843
  profile [name]       show or set tool profile (tiny|lean|core|full|ultra)
  router <sub>         model router: start|stop|restart|status|config
  admin <sub>          admin server: start|stop|status|url|build-ui
  status               show licensing / trial status
  login <key>          save an API key (lifts the trial limit)
  logout               remove the saved API key
  help                 this message`);
} else {
  console.error(`unknown command: ${cmd}. try 'slim help'`);
  process.exit(1);
}
