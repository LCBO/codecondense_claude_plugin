#!/usr/bin/env node
import { summary } from "./lib/telemetry.js";

// Savings shown here are MEASURED, not guessed: every slim Search/Read logs the
// real `baseline_bytes` (what a built-in Read/Grep would have returned) and the
// `response_bytes` we actually sent. The difference is bytes the model never had
// to ingest. We convert that to ~tokens (≈4 bytes/token) and to ~dollars at a
// representative input price. The `~` prefix marks the bytes→tokens→$ derivation;
// the byte delta itself is real.
const BYTES_PER_TOKEN = 4;
const INPUT_PRICE_PER_MTOK = 3; // representative cache-miss input $/Mtok

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RST = "\x1b[0m";

// Claude Code passes a JSON blob on stdin (session_id, model, cwd, cost, …).
// Read it so we scope to the ACTUAL current session instead of guessing the
// most-recent global event. Short timeout + TTY guard so a manual run can't hang.
function readStdin(timeoutMs = 300) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve({});
    let buf = "";
    const finish = () => { try { resolve(JSON.parse(buf || "{}")); } catch { resolve({}); } };
    const t = setTimeout(finish, timeoutMs);
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => { clearTimeout(t); finish(); });
    process.stdin.on("error", () => { clearTimeout(t); resolve({}); });
  });
}

function fmtUsd(n) {
  if (!n || n < 0.01) return "<$0.01";
  if (n >= 100) return "$" + n.toFixed(0);
  return "$" + n.toFixed(2);
}
function fmtTokens(n) {
  if (!n) return "0";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

const input = await readStdin();
const sid = input.session_id || input.sessionId || process.env.CLAUDE_SESSION_ID || null;
const sess = summary(true, sid) || {};

const slimCalls = sess.slim_calls || 0;
// Real bytes the model never had to read: baseline (full file/grep) minus what
// slim actually served, summed over the calls that tracked a baseline.
const bytesSaved = Math.max(0, (sess.baseline || 0) - (sess.bytes_tracked || 0));
const tokensSaved = Math.round(bytesSaved / BYTES_PER_TOKEN);
const usdSaved = (tokensSaved * INPUT_PRICE_PER_MTOK) / 1e6;

const prefix = `${DIM}🪄 slim${RST}`;
let line;
if (slimCalls === 0) {
  line = `${prefix} ${DIM}ready${RST}  `;
} else {
  line =
    `${prefix} session: ` +
    `${BOLD}${slimCalls}${RST} ${DIM}slim calls${RST} · ` +
    `${BOLD}~${fmtTokens(tokensSaved)} tokens${RST} ${DIM}trimmed${RST} · ` +
    `${BOLD}~${fmtUsd(usdSaved)}${RST} ${DIM}saved${RST}  `;
}

process.stdout.write(line);
