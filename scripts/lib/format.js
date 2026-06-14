// Terminal formatting helpers shared by the savings report and CLI.
// ANSI colors + Unicode box-drawing tables. Colors auto-disable when stdout is
// not a TTY, when NO_COLOR is set, or under TERM=dumb — so piped/redirected
// output stays clean and copy-pasteable.

const USE_COLOR =
  !!process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const CODES = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m", gray: "\x1b[90m",
};

function wrap(code, s) {
  return USE_COLOR ? code + s + CODES.reset : String(s);
}

export const c = {
  enabled: USE_COLOR,
  bold: (s) => wrap(CODES.bold, s),
  dim: (s) => wrap(CODES.dim, s),
  red: (s) => wrap(CODES.red, s),
  green: (s) => wrap(CODES.green, s),
  yellow: (s) => wrap(CODES.yellow, s),
  blue: (s) => wrap(CODES.blue, s),
  magenta: (s) => wrap(CODES.magenta, s),
  cyan: (s) => wrap(CODES.cyan, s),
  gray: (s) => wrap(CODES.gray, s),
};

const ANSI_RE = /\x1b\[[0-9;]*m/g;
export function stripAnsi(s) { return String(s).replace(ANSI_RE, ""); }
export function visibleLen(s) { return stripAnsi(s).length; }

function pad(s, width, align) {
  const gap = Math.max(0, width - visibleLen(s));
  if (align === "right") return " ".repeat(gap) + s;
  if (align === "center") {
    const l = Math.floor(gap / 2);
    return " ".repeat(l) + s + " ".repeat(gap - l);
  }
  return s + " ".repeat(gap);
}

// Plain key: value list — no borders, works on any terminal width.
// rows: array of [key, col1, col2?, ...]. Empty/null rows emit a blank line.
// headers: first element is ignored as a label; subsequent elements become
// column headers printed above the first data row when there are 3+ columns.
export function table(headers, rows) {
  const dataRows = rows.filter(Boolean);
  const kw = Math.max(0, ...dataRows.map((r) => visibleLen(String(r[0] ?? ""))));
  const cols = Math.max(0, ...dataRows.map((r) => r.length));
  const lines = [];

  // 3+ column tables: print column headers as a "key  col1  col2" legend.
  if (cols >= 3 && headers.length >= 3) {
    const gap = " ".repeat(kw + 2);
    lines.push(`  ${c.gray(gap)}  ${headers.slice(1).map((h) => c.bold(String(h))).join("  ")}`);
  }

  for (const r of rows) {
    if (!r) { lines.push(""); continue; }
    const key = pad(String(r[0] ?? ""), kw, "left");
    if (cols <= 2) {
      lines.push(`  ${c.gray(key)}  ${String(r[1] ?? "")}`);
    } else {
      const vals = r.slice(1).map((v) => String(v ?? "")).join("  ");
      lines.push(`  ${c.gray(key)}  ${vals}`);
    }
  }
  return lines.join("\n");
}

// A bold section heading.
export function heading(label) {
  return "\n" + c.bold(label);
}
