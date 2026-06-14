#!/usr/bin/env node
// One-command installer for the slimmer Claude Code plugin.
//
//   npx @slimmer/install
//
// Clones (or updates) the plugin into ~/.slim/plugin, installs its runtime
// deps, and wires it into Claude Code (~/.claude): marketplace + enabledPlugins.
// Animated with chalk + ora.
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import chalk from "chalk";
import ora from "ora";

const REPO = process.env.CONDENSE_REPO || "https://github.com/LCBO/codecondense_claude_plugin.git";
const HOME = os.homedir();
const PLUGIN_DIR = process.env.CONDENSE_PLUGIN_DIR || path.join(HOME, ".slimmer", "plugin");
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const PLUGINS_DIR = path.join(CLAUDE_DIR, "plugins");
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json");
const KNOWN_MARKETPLACES = path.join(PLUGINS_DIR, "known_marketplaces.json");
const INSTALLED_PLUGINS = path.join(PLUGINS_DIR, "installed_plugins.json");

// Grok dual support (additive; Claude blocks below are preserved)
const GROK_DIR = path.join(HOME, ".grok");
const GROK_PLUGINS_DIR = path.join(GROK_DIR, "plugins");
const GROK_PLUGIN_LINK = path.join(GROK_PLUGINS_DIR, "slim");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const ps = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    ps.stderr.on("data", (d) => (err += d));
    ps.on("error", reject);
    ps.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.trim().slice(0, 300)}`))));
  });
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}
async function writeJson(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj, null, 2) + "\n");
}

async function banner() {
  const lines = [
    "",
    chalk.bold.cyan("  ╭─────────────────────────────────────────╮"),
    chalk.bold.cyan("  │") + chalk.bold.white("     C o d e C o n d e n s e  ·  install     ") + chalk.bold.cyan("│"),
    chalk.bold.cyan("  │") + chalk.gray("   token-saving plugin for Claude Code   ") + chalk.bold.cyan("│"),
    chalk.bold.cyan("  ╰─────────────────────────────────────────╯"),
    "",
  ];
  for (const l of lines) { console.log(l); await sleep(40); }
}

async function step(text, fn, okText) {
  const sp = ora({ text, spinner: "dots", color: "cyan" }).start();
  try {
    const res = await fn(sp);
    sp.succeed(chalk.white(okText || res || text));
    return res;
  } catch (e) {
    sp.fail(chalk.red(`${text} — ${e.message}`));
    throw e;
  }
}

async function main() {
  await banner();

  if (!existsSync(CLAUDE_DIR)) {
    console.log(chalk.red(`  Claude Code config dir not found at ${chalk.bold(CLAUDE_DIR)}.`));
    console.log(chalk.gray("  Run Claude Code once (or set CLAUDE_CONFIG_DIR), then re-run this installer.\n"));
    process.exit(1);
  }

  // 1) Fetch or update the plugin source.
  await step("Fetching CodeCondense plugin", async (sp) => {
    if (existsSync(path.join(PLUGIN_DIR, ".git"))) {
      sp.text = "Updating CodeCondense plugin";
      // Public repo uses orphan force-push — can't fast-forward, reset hard instead.
      await run("git", ["-C", PLUGIN_DIR, "fetch", "--force", "--depth", "1", "origin", "main", "--quiet"]);
      await run("git", ["-C", PLUGIN_DIR, "reset", "--hard", "origin/main", "--quiet"]);
      await run("git", ["-C", PLUGIN_DIR, "clean", "-fd", "--quiet"]);
      return "Updated CodeCondense plugin";
    }
    await fs.mkdir(path.dirname(PLUGIN_DIR), { recursive: true });
    await run("git", ["clone", "--depth", "1", "--quiet", REPO, PLUGIN_DIR]);
    return `Cloned CodeCondense → ${PLUGIN_DIR}`;
  });

  // 2) Install runtime dependencies (MCP SDK + ripgrep).
  await step("Installing dependencies", async () => {
    await run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--force", "--silent"], PLUGIN_DIR);
    return "Dependencies installed";
  });

  // 2.5) Write .mcp.json with absolute path (.mcp.json is excluded from public repo).
  await step("Configuring MCP server", async () => {
    const mcpPath = path.join(PLUGIN_DIR, ".mcp.json");
    await writeJson(mcpPath, {
      mcpServers: {
        slim: {
          command: "node",
          args: ["--no-warnings=ExperimentalWarning", path.join(PLUGIN_DIR, "servers/code-server.js")],
        },
      },
    });
    return "MCP server configured";
  });

  // 3) Claude wiring.
  await step("Registering marketplace", async () => {
    const km = await readJson(KNOWN_MARKETPLACES, {});
    km["slim-marketplace"] = {
      source: { source: "directory", path: PLUGIN_DIR },
      installLocation: PLUGIN_DIR,
      lastUpdated: new Date().toISOString(),
    };
    await writeJson(KNOWN_MARKETPLACES, km);
    return "Marketplace registered";
  });

  await step("Enabling plugin", async () => {
    const ip = await readJson(INSTALLED_PLUGINS, { version: 2, plugins: {} });
    if (!ip.plugins) ip.plugins = {};
    ip.plugins["slim@slim-marketplace"] = [{
      scope: "user",
      installPath: PLUGIN_DIR,
      version: "0.2.0",
      installedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    }];
    await writeJson(INSTALLED_PLUGINS, ip);

    const settings = await readJson(SETTINGS_PATH, {});
    settings.enabledPlugins = settings.enabledPlugins || {};
    settings.enabledPlugins["slim@slim-marketplace"] = true;
    settings.enabledMcpjsonServers = settings.enabledMcpjsonServers || [];
    if (!settings.enabledMcpjsonServers.includes("slim")) {
      settings.enabledMcpjsonServers.push("slim");
    }
    await writeJson(SETTINGS_PATH, settings);
    return "Plugin enabled";
  });

  // 4) Grok wiring (additive symlink for `grok plugin` discovery / trust)
  // 4) Grok wiring (additive symlink).
  await step("Wiring for Grok (if present)", async () => {
    if (!existsSync(GROK_DIR)) return "no ~/.grok dir — skipped";
    await fs.mkdir(GROK_PLUGINS_DIR, { recursive: true });
    try { await fs.unlink(GROK_PLUGIN_LINK); } catch {}
    await fs.symlink(PLUGIN_DIR, GROK_PLUGIN_LINK, "dir");
    return `symlink → ${GROK_PLUGIN_LINK}`;
  });

  console.log("");
  console.log(chalk.green.bold("  ✓ CodeCondense installed!"));
  console.log("");
  console.log(chalk.white("  Next:"));
  console.log(chalk.gray("   1. Restart Claude Code (so it loads the plugin + commands)."));
  console.log("   2. " + chalk.cyan("/slim-savings") + chalk.gray("   — see your token savings"));
  console.log("   3. " + chalk.cyan("/slim-status") + chalk.gray("    — licensing / trial status"));
  console.log("");
}

main().catch((e) => {
  console.error("\n" + chalk.red("  Install failed: ") + e.message + "\n");
  process.exit(1);
});
