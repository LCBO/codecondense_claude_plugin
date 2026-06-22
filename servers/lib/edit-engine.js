// Pure edit-logic helpers extracted from code-server.js so they can be unit-tested
// without spinning up the full MCP server.
//
// Exported:
//   normUnicode(s)            — smart-quote / em-dash → ASCII
//   fuzzyFind(haystack, needle) → { idx, len, mode } | null
//   parseFileSpec(spec)       → { file, range?, cell? }
//   applyEditsToContent(edits, content, fileSpec)
//     → { content: string, results: [{ok,mode,error?}] }

// ─── Unicode normalisation ────────────────────────────────────────────────────

const UNICODE_MAP = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"',
  "–": "-", "—": "-", "−": "-",
  "…": "...",
  " ": " ", " ": " ", " ": " ", " ": " ",
};
export function normUnicode(s) {
  return s.replace(/[‘’‚‛“”„‟–—−…    ]/g,
    (c) => UNICODE_MAP[c] || c);
}

// ─── Fuzzy find: exact → unicode → whitespace-collapsed ──────────────────────

export function fuzzyFind(haystack, needle) {
  // 1. exact
  let idx = haystack.indexOf(needle);
  if (idx !== -1) return { idx, len: needle.length, mode: "exact" };
  // 2. unicode-normalised
  const nh = normUnicode(haystack);
  const nn = normUnicode(needle);
  idx = nh.indexOf(nn);
  if (idx !== -1) return { idx, len: nn.length, mode: "unicode" };
  // 3. whitespace-collapsed
  const buildMap = (s) => {
    const compact = [], map = [];
    let last = -1;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (/\s/.test(c)) {
        if (last !== 0x20) { compact.push(" "); map.push(i); last = 0x20; }
      } else {
        compact.push(c); map.push(i); last = c.charCodeAt(0);
      }
    }
    return { compact: compact.join(""), map };
  };
  const H = buildMap(nh);
  const N = buildMap(nn);
  const cIdx = H.compact.indexOf(N.compact.trim());
  if (cIdx !== -1) {
    const trimmed = N.compact.trim();
    const endCompact = cIdx + trimmed.length - 1;
    const endOrig = H.map[endCompact] + 1;
    return { idx: H.map[cIdx], len: endOrig - H.map[cIdx], mode: "whitespace" };
  }
  return null;
}

// ─── File spec parser ─────────────────────────────────────────────────────────

export function parseFileSpec(spec) {
  const hashIdx = spec.lastIndexOf("#");
  if (hashIdx === -1) return { file: spec };
  const file = spec.slice(0, hashIdx);
  const frag = spec.slice(hashIdx + 1);
  if (/^cell=/.test(frag)) return { file, cell: frag.slice(5) };
  const m = frag.match(/^(\d+)(?:-(\d+))?$/);
  if (m) return { file, range: [+m[1], +(m[2] || m[1])] };
  return { file: spec };
}

// ─── Core edit logic (pure, no I/O) ──────────────────────────────────────────
//
// Applies a sequence of edit descriptors to `content` (a string).
// `fileSpec` is already-parsed (from parseFileSpec) so the caller controls
// how file + range are derived (the server resolves abs paths; tests pass
// a dummy spec).
//
// Each edit descriptor has the same shape as the MCP Edit tool's items:
//   { old_string?, new_string, replace_all?, regex?, insert_at_line?, overwrite? }
//
// Returns { content: string, results: Array<{ok, mode, error?}> }

export function applyEditsToContent(edits, content, parsed) {
  const results = [];
  let cur = content;

  for (const e of edits) {
    // insert_at_line: pure insertion before line N (1-based), no old_string.
    if (e.insert_at_line != null) {
      const lines = cur.split("\n");
      lines.splice(e.insert_at_line - 1, 0, ...(e.new_string ?? "").split("\n"));
      cur = lines.join("\n");
      results.push({ ok: true, mode: "insert_at_line" });
      continue;
    }

    // overwrite / create / line-range delete+replace (no old_string).
    if (!e.old_string || e.overwrite) {
      if (parsed?.range && !e.overwrite) {
        const lines = cur.split("\n");
        const [a, b] = parsed.range;
        const repl = (e.new_string ?? "").length > 0 ? e.new_string.split("\n") : [];
        lines.splice(a - 1, b - a + 1, ...repl);
        cur = lines.join("\n");
        results.push({ ok: true, mode: repl.length === 0 ? "delete_lines" : "replace_lines" });
      } else {
        cur = e.new_string ?? "";
        results.push({ ok: true, mode: e.overwrite ? "overwrite" : "create" });
      }
      continue;
    }

    // Compute search scope (full file or line-range).
    let scope = { start: 0, end: cur.length };
    if (parsed?.range) {
      const lines = cur.split("\n");
      const [a, b] = parsed.range;
      const startIdx = lines.slice(0, a - 1).reduce((s, l) => s + l.length + 1, 0);
      const endIdx = startIdx + lines.slice(a - 1, b).join("\n").length;
      scope = { start: startIdx, end: endIdx };
    }

    const before = cur;
    const haystack = cur.slice(scope.start, scope.end);

    // Regex replace mode.
    if (e.regex) {
      try {
        const re = new RegExp(e.old_string, e.replace_all ? "gms" : "ms");
        const repl = (e.new_string ?? "").replace(/\$!(\d+)/g, "$" + "$1"); // $!1 → $1
        const newHaystack = haystack.replace(re, repl);
        if (newHaystack === haystack) {
          results.push({ ok: false, error: "regex: pattern matched nothing" });
          continue;
        }
        cur = cur.slice(0, scope.start) + newHaystack + cur.slice(scope.end);
        if (cur === before) { results.push({ ok: false, error: "no change" }); continue; }
        results.push({ ok: true, mode: "regex" + (parsed?.range ? "_ranged" : "") });
      } catch (err) {
        results.push({ ok: false, error: "invalid regex: " + err.message });
      }
      continue;
    }

    // Exact / fuzzy string replace.
    const find = fuzzyFind(haystack, e.old_string);
    if (!find) {
      results.push({ ok: false, error: "old_string not found (tried exact/unicode/whitespace)" });
      continue;
    }
    if (e.replace_all) {
      let out = "", pos = 0, count = 0;
      while (true) {
        const tail = haystack.slice(pos);
        const f = fuzzyFind(tail, e.old_string);
        if (!f) { out += tail; break; }
        out += tail.slice(0, f.idx) + e.new_string;
        pos += f.idx + f.len;
        if (++count > 1000) break;
      }
      cur = cur.slice(0, scope.start) + out + cur.slice(scope.end);
    } else {
      const absIdx = scope.start + find.idx;
      cur = cur.slice(0, absIdx) + e.new_string + cur.slice(absIdx + find.len);
    }
    if (cur === before) { results.push({ ok: false, error: "no change" }); continue; }
    results.push({ ok: true, mode: find.mode + (parsed?.range ? "_ranged" : "") });
  }

  return { content: cur, results };
}
