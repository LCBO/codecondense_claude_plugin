// Lightweight "new version available" check.
//
// Installed version: read from `git describe --tags --abbrev=0` in the plugin
// root — the git tag IS the version, no package.json bump required.
// Fallback chain: git tag → .claude-plugin/plugin.json → package.json.
//
// Latest version: fetched from the GitHub releases/tags API.
// Returns null when the repo is private or unreachable — fail-silent.
// Cached in ~/.slim/update-check.json (12h TTL).
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { slimDir } from "./telemetry.js";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CACHE = () => path.join(slimDir(), "update-check.json");
const TTL_MS = 12 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;
const GITHUB_REPO = "LCBO/codecondense_claude_plugin";

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
}

// Primary: ask git for the nearest tag on the current commit.
function gitTagVersion() {
  try {
    const v = execFileSync("git", ["describe", "--tags", "--abbrev=0"], {
      cwd: PLUGIN_ROOT,
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    return v ? v.replace(/^v/i, "") : null;
  } catch {
    return null;
  }
}

export function currentVersion() {
  const git = gitTagVersion();
  if (git) return git;
  for (const rel of [".claude-plugin/plugin.json", "package.json"]) {
    const v = readJson(path.join(PLUGIN_ROOT, rel), {}).version;
    if (v) return v;
  }
  return "0.0.0";
}

function parseSemver(v) {
  const m = String(v).replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function cmp(a, b) { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }

export function cached() {
  return readJson(CACHE(), null);
}

// Fetch latest version from GitHub releases/tags API.
// Returns null when the repo is private or unreachable — fail-silent.
async function fetchLatest() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // releases/latest — preferred; requires a published GitHub release.
    const r1 = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { accept: "application/vnd.github+json", "user-agent": "slimmer-update-check" }, signal: ctrl.signal },
    );
    if (r1.ok) {
      const { tag_name } = await r1.json();
      if (tag_name) return tag_name.replace(/^v/i, "");
    }
    // tags API — works even without a formal release.
    const r2 = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/tags?per_page=1`,
      { headers: { accept: "application/vnd.github+json", "user-agent": "slimmer-update-check" }, signal: ctrl.signal },
    );
    if (r2.ok) {
      const tags = await r2.json();
      const v = tags?.[0]?.name?.replace(/^v/i, "");
      if (v) return v;
    }
    return null; // private repo or network error — caller treats as unreachable
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function refresh() {
  const current = currentVersion();
  const latest = await fetchLatest();
  if (!latest) return null;
  const cur = parseSemver(current), lat = parseSemver(latest);
  const hasUpdate = !!(cur && lat && cmp(lat, cur) > 0);
  // Only cache `latest` + metadata — never `current` (installed version).
  // Caching `current` causes stale version strings to survive across updates.
  const out = { latest, hasUpdate, ts: Date.now() };
  try { writeFileSync(CACHE(), JSON.stringify(out)); } catch {}
  // Return with current resolved live so callers always see the real version.
  return { ...out, current };
}

// Returns { current, latest, hasUpdate } using the 12h cache; refreshes inline
// (bounded by TIMEOUT_MS) only when the cache is stale or missing.
export async function checkForUpdate() {
  const c = cached();
  // Always inject the live installed version, never trust the cached one.
  const withCurrent = (o) => o ? { ...o, current: currentVersion() } : null;
  if (c && typeof c.ts === "number" && Date.now() - c.ts < TTL_MS) return withCurrent(c);
  return (await refresh()) || withCurrent(c) || null;
}
