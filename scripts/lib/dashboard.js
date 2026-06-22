// Renders a single-file HTML dashboard from the flat telemetry event log.
// Output: ~/.slim/dashboard.html (overwritten each call).
import { writeFileSync } from "node:fs";
import path from "node:path";
import { slimDir, dbPath, readAllEvents, aggregate, groupByTool } from "./telemetry.js";

const COST_INPUT = 3, COST_OUTPUT = 15, COST_CACHE_READ = 0.3;

function fmt(n) {
  if (!n) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "G";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n | 0);
}
function fmtBytes(n) {
  if (!n) return "0 B";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + " MB";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + " KB";
  return n + " B";
}
function cost(s) {
  return ((s.in_tok || 0) * COST_INPUT + (s.out_tok || 0) * COST_OUTPUT + (s.cache_r || 0) * COST_CACHE_READ) / 1e6;
}

const num = (v) => (typeof v === "number" ? v : 0);

// Most-recently-active session, aggregated. Mirrors the old GROUP BY session.
function lastSessionRow(events) {
  const by = new Map();
  for (const e of events) {
    if (!e.session) continue;
    let g = by.get(e.session);
    if (!g) { g = { session: e.session, start_ts: e.ts, end_ts: e.ts, calls: 0, bytes: 0, baseline: 0, saved: 0, in_tok: 0, out_tok: 0 }; by.set(e.session, g); }
    g.calls++;
    g.start_ts = Math.min(g.start_ts, e.ts);
    g.end_ts = Math.max(g.end_ts, e.ts);
    g.bytes += num(e.response_bytes);
    g.baseline += num(e.baseline_bytes);
    g.saved += num(e.saved_bytes);
    g.in_tok += num(e.input_tokens);
    g.out_tok += num(e.output_tokens);
  }
  let best = {};
  for (const g of by.values()) if (best.end_ts == null || g.end_ts > best.end_ts) best = g;
  return best;
}

// Bytes saved per UTC day (last 30 days with tracked savings), oldest-first.
function dailySavedRows(events) {
  const by = new Map();
  for (const e of events) {
    if (e.saved_bytes == null) continue;
    const d = new Date(e.ts).toISOString().slice(0, 10);
    let g = by.get(d);
    if (!g) { g = { d, saved: 0, baseline: 0, calls: 0 }; by.set(d, g); }
    g.saved += num(e.saved_bytes);
    g.baseline += num(e.baseline_bytes);
    g.calls++;
  }
  return [...by.values()].sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-30);
}

export function buildDashboard(opts = {}) {
  const events = readAllEvents();
  const sid = opts.session || process.env.CLAUDE_SESSION_ID;
  const life = aggregate(events);
  const sess = sid ? aggregate(events.filter(e => e.session === sid)) : {};

  const lastSession = lastSessionRow(events);
  const topToolsLife = groupByTool(events, 15);
  const dailySaved = dailySavedRows(events);

  const secrets = { n: events.filter(e => e.kind === "bash_secret_leak").length };
  const loops = { n: events.filter(e => e.kind === "loop_detected").length };

  const savedPct = (life.baseline && life.saved) ? Math.round(100 * life.saved / life.baseline) : 0;
  const sessSavedPct = (sess.baseline && sess.saved) ? Math.round(100 * sess.saved / sess.baseline) : 0;

  const html = render({
    life, sess, lastSession, topToolsLife, dailySaved, secrets, loops,
    savedPct, sessSavedPct, sid,
  });
  const out = path.join(slimDir(), "dashboard.html");
  writeFileSync(out, html);
  return { path: out, life, sess };
}

const MIN_SAMPLE = 50;
function comparisonBlock(s, actualCost) {
  // Compare only events that recorded a baseline (Search file_paths_with_content,
  // Read delta-mode). Mixing in response_bytes from untracked events would inflate
  // the "served" side and produce negative savings.
  const baseline = s.baseline || 0, served = s.bytes_tracked || 0;
  const slimCalls = s.slim_calls || 0;
  if (!baseline) {
    return `<div class=cmp><div class=cmp-empty>No baseline data yet — run a few slim tool calls and the comparison will populate.</div></div>`;
  }
  if (slimCalls < MIN_SAMPLE) {
    return `<div class=cmp><div class=cmp-empty>Insufficient sample (${slimCalls}/${MIN_SAMPLE} slim calls) — byte-level comparison too noisy. Trust the call-count savings instead.</div></div>`;
  }
  const tokWithout = Math.round(baseline / 4);
  const tokWith = Math.round(served / 4);
  const tokSaved = Math.max(0, tokWithout - tokWith);
  const pct = baseline ? Math.max(0, Math.round(100 * (baseline - served) / baseline)) : 0;
  // Rough $ projection at $3/M input.
  const $without = (tokWithout * COST_INPUT / 1e6).toFixed(4);
  const $with = (tokWith * COST_INPUT / 1e6).toFixed(4);
  const $saved = (tokSaved * COST_INPUT / 1e6).toFixed(4);
  const ratio = baseline ? Math.round(served / baseline * 100) : 100;
  return `<div class=cmp>
    <div class=cmp-side cmp-bad>
      <div class=l>Without slimmer</div>
      <div class=v>${fmt(tokWithout)} tok</div>
      <div class=sub>${fmtBytes(baseline)} raw · ~$${$without}</div>
    </div>
    <div class=cmp-arrow>→ −${pct}%</div>
    <div class=cmp-side cmp-good>
      <div class=l>With slimmer</div>
      <div class=v>${fmt(tokWith)} tok</div>
      <div class=sub>${fmtBytes(served)} served · ~$${$with}</div>
    </div>
    <div class=cmp-side cmp-saved>
      <div class=l>Saved</div>
      <div class=v>${fmt(tokSaved)} tok</div>
      <div class=sub>~$${$saved} input · ${ratio}% ratio</div>
    </div>
  </div>`;
}

function barChart(rows) {
  if (!rows.length) return "<p class=muted>No data yet.</p>";
  const max = Math.max(1, ...rows.map(r => r.saved || 0));
  return `<table class=bars>${rows.map(r => `
    <tr><td class=label>${r.d}</td>
        <td class=barcell><div class=bar style="width:${Math.round((r.saved || 0) / max * 100)}%"></div></td>
        <td class=val>${fmtBytes(r.saved || 0)}</td></tr>`).join("")}</table>`;
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function render(d) {
  const lifeCost = cost(d.life);
  const sessCost = cost(d.sess);
  const savedTokensLife = Math.round((d.life.saved || 0) / 4); // ~4 chars/token
  const savedTokensSess = Math.round((d.sess.saved || 0) / 4);
  const savedDollarsLife = (savedTokensLife * COST_INPUT / 1e6).toFixed(4);
  const savedDollarsSess = (savedTokensSess * COST_INPUT / 1e6).toFixed(4);

  return `<!doctype html><html><head><meta charset="utf-8"><title>Slimmer Dashboard</title><style>
body{font:14px/1.45 -apple-system,system-ui,sans-serif;margin:0;padding:24px;background:#0e1116;color:#e6edf3}
h1,h2{margin:0 0 12px;font-weight:600}
h1{font-size:20px;color:#7ee787}
h2{font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#8b949e;margin-top:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px}
.card{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:14px}
.card .v{font-size:22px;font-weight:600;color:#7ee787}
.card .l{font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px}
.card .sub{font-size:12px;color:#8b949e;margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:12px}
table.t td,table.t th{padding:6px 8px;border-bottom:1px solid #21262d;text-align:left}
table.t th{color:#8b949e;font-weight:500;text-transform:uppercase;font-size:10px;letter-spacing:.5px}
table.bars td{padding:3px 8px;border:0}
table.bars td.label{width:90px;color:#8b949e;font-family:monospace}
table.bars td.val{width:80px;text-align:right;color:#7ee787;font-family:monospace}
table.bars td.barcell{width:auto}
table.bars .bar{background:#238636;height:10px;border-radius:2px;min-width:1px}
.muted{color:#8b949e}
.warn{color:#f0883e}
.bad{color:#f85149}
.row{display:flex;gap:24px;align-items:baseline}
.split{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.footer{margin-top:24px;color:#8b949e;font-size:11px}
.cmp{display:grid;grid-template-columns:1fr auto 1fr 1fr;gap:12px;align-items:center;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:14px;margin-bottom:16px}
.cmp-side{padding:8px 12px;border-radius:4px}
.cmp-side .l{font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px}
.cmp-side .v{font-size:24px;font-weight:600;margin:4px 0}
.cmp-side .sub{font-size:11px;color:#8b949e}
.cmp-bad{background:#3d1d1d;border:1px solid #6e2c2c}.cmp-bad .v{color:#f85149}
.cmp-good{background:#0f2a18;border:1px solid #1e5630}.cmp-good .v{color:#7ee787}
.cmp-saved{background:#1c2233;border:1px solid #1f6feb}.cmp-saved .v{color:#79c0ff}
.cmp-arrow{font-size:16px;color:#7ee787;font-weight:600;text-align:center}
.cmp-empty{grid-column:1/-1;color:#8b949e;text-align:center;padding:8px}
</style></head><body>
<h1>▸ Slimmer Dashboard</h1>
<div class=muted>Generated ${new Date().toISOString()} · db ${esc(dbPath())}</div>

<h2>Last Session ${d.sid ? `(${esc(d.sid).slice(0,8)}…)` : ""}</h2>
${comparisonBlock(d.sess, sessCost)}
<div class=cards>
  <div class=card><div class=l>Tool calls</div><div class=v>${fmt(d.sess.calls || 0)}</div><div class=sub>${fmt(d.sess.slim_calls || 0)} via slim MCP</div></div>
  <div class=card><div class=l>Tokens in/out</div><div class=v>${fmt(d.sess.in_tok)} / ${fmt(d.sess.out_tok)}</div><div class=sub>cache read ${fmt(d.sess.cache_r)}</div></div>
  <div class=card><div class=l>Est cost</div><div class=v>$${sessCost.toFixed(4)}</div><div class=sub>API list price</div></div>
</div>

<h2>Lifetime</h2>
${comparisonBlock(d.life, lifeCost)}
<div class=cards>
  <div class=card><div class=l>Tool calls</div><div class=v>${fmt(d.life.calls || 0)}</div><div class=sub>${fmt(d.life.slim_calls || 0)} via slim (${d.life.calls ? Math.round(100 * (d.life.slim_calls || 0) / d.life.calls) : 0}%)</div></div>
  <div class=card><div class=l>Tokens in/out</div><div class=v>${fmt(d.life.in_tok)} / ${fmt(d.life.out_tok)}</div><div class=sub>cache read ${fmt(d.life.cache_r)}</div></div>
  <div class=card><div class=l>Est cost</div><div class=v>$${lifeCost.toFixed(4)}</div><div class=sub>API list price</div></div>
  <div class=card><div class=l>Loops detected</div><div class=v ${d.loops.n ? "class=warn" : ""}>${d.loops.n}</div><div class=sub>repeated tool calls</div></div>
  <div class=card><div class=l>Secret leaks</div><div class=v ${d.secrets.n ? "class=bad" : ""}>${d.secrets.n}</div><div class=sub>credentials in bash output</div></div>
</div>

<div class=split>
  <div>
    <h2>Daily Bytes Saved (last 30d)</h2>
    ${barChart(d.dailySaved)}
  </div>
  <div>
    <h2>Top Tools (lifetime)</h2>
    <table class=t>
      <thead><tr><th>Tool</th><th>Calls</th><th>Resp</th><th>Saved</th></tr></thead>
      <tbody>${d.topToolsLife.map(r => `<tr>
        <td>${esc(r.tool || "?")}</td>
        <td>${fmt(r.n)}</td>
        <td>${fmtBytes(r.bytes || 0)}</td>
        <td class=muted>${r.saved ? fmtBytes(r.saved) : "—"}</td>
      </tr>`).join("")}</tbody>
    </table>
  </div>
</div>

<div class=footer>slim plugin · fully local · zero telemetry sent off-machine</div>
</body></html>`;
}
