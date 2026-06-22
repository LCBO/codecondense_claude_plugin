// Autostart helper for the slimmer admin server.
// Same pattern as lib/router.js: check → spawn detached → write PID.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// Return the first non-loopback IPv4 address (the LXC/LAN IP).
function localIp() {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (!i.internal && i.family === "IPv4") return i.address;
    }
  }
  return "127.0.0.1";
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const SERVER_SCRIPT = path.join(PLUGIN_ROOT, "admin-server", "server.js");
const SLIM_HOME = process.env.SLIM_HOME || path.join(os.homedir(), ".slim");
const PID_FILE = path.join(SLIM_HOME, "admin.pid");
const LOG_FILE = path.join(SLIM_HOME, "admin.log");

function readConfig() {
  try {
    return JSON.parse(readFileSync(path.join(SLIM_HOME, "config.json"), "utf8"));
  } catch { return {}; }
}

export function getPort() {
  const cfg = readConfig();
  return Number(process.env.SLIM_ADMIN_PORT || cfg.admin_port || 7842);
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readPid() {
  try { return Number(readFileSync(PID_FILE, "utf8").trim()); } catch { return null; }
}

async function ping(port) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${port}/v1/slim/version`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch { return false; }
}

export async function status() {
  const port = getPort();
  const pid = readPid();
  const alive = pid ? isAlive(pid) : false;
  const reachable = alive ? await ping(port) : false;
  const ip = localIp();
  return { port, pid, alive, reachable, url: `http://${ip}:${port}` };
}

export async function autostart() {
  if (!existsSync(SERVER_SCRIPT)) {
    return { acted: false, reason: "server_script_missing" };
  }
  const port = getPort();
  const pid = readPid();
  if (pid && isAlive(pid) && await ping(port)) {
    return { acted: false, reason: "already_running", port, pid };
  }

  const cfg = readConfig();
  const env = {
    ...process.env,
    SLIM_ADMIN_PORT: String(port),
    ...(cfg.admin_user     ? { ADMIN_USER:     cfg.admin_user }     : {}),
    ...(cfg.admin_password ? { ADMIN_PASSWORD: cfg.admin_password } : {}),
    ...(cfg.admin_secret   ? { SLIM_VERDICT_PRIVATE_KEY: cfg.admin_secret } : {}),
  };

  try {
    const out = existsSync(SLIM_HOME) ? openSync(LOG_FILE, "a") : undefined;
    const child = spawn(process.execPath, ["--no-warnings=ExperimentalWarning", SERVER_SCRIPT], {
      detached: true,
      stdio: ["ignore", out ?? "ignore", out ?? "ignore"],
      env,
    });
    child.unref();
    writeFileSync(PID_FILE, String(child.pid));
    // Give it a moment then verify.
    await new Promise(r => setTimeout(r, 600));
    const ok = await ping(port);
    const ip = localIp();
    return { acted: true, ok, port, pid: child.pid, url: `http://${ip}:${port}` };
  } catch (e) {
    return { acted: true, ok: false, error: e.message };
  }
}

export function stop() {
  const pid = readPid();
  if (!pid) return { ok: false, reason: "no_pid" };
  try {
    process.kill(pid, "SIGTERM");
    try { unlinkSync(PID_FILE); } catch {}
    return { ok: true, pid };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
