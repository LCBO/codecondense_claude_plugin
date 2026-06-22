# CodeCondense — Stop Burning Money on Claude Code

> The token-saving plugin every Claude Code developer needs. Cut your API costs 40–83%. Automatically. Locally. Free to start.

```bash
npx @codecondense/install
```

---

## Claude Code is powerful. It's also expensive.

Every time Claude reads a file, searches your codebase, or edits code, it burns tokens. Most of those tokens are wasted — duplicate reads, bloated search results, redundant roundtrips that Claude makes because it has no smarter option.

**CodeCondense cuts that waste by 40–83%. Without changing how you work.**

```
Without CodeCondense:   7 roundtrips · ~31,500 tokens · ~$1.34 on Opus
With CodeCondense:      2 roundtrips · ~8,000 tokens  · ~$0.34 on Opus
                                                         Same result.
```

A typical heavy session makes 200–400 tool calls. CodeCondense collapses 40–83% of those.  
**At Opus rates that's $3–$7 saved per session. Every session.**

---

## Benchmark Results

Tested on Claude Sonnet 4 (v0.8.36, June 2026) · Pricing: $3/M input · $15/M output

### Scenario 1 — Build from Scratch (10 apps, Node.js + Python)

| Metric | Result |
|---|---|
| Fewer tool calls | **−85%** |
| Fewer tokens | **−72%** |
| Cost saved | **$1.44** |
| Time saved | **15m 46s** |

### Scenario 2 — Real Codebase (7,256 files · 1,326 .tsx · 1,699 .ts · 192 deps)

| Task | Vanilla calls | Slim calls | Vanilla tokens | Slim tokens | Vanilla cost | Slim cost | Time saved |
|---|---|---|---|---|---|---|---|
| T1 — Simple (2 files) | 8 | 3 | 38K | 11K | $1.20 | $0.22 | −66% |
| T2 — Medium (2,478-line file) | 7 | 2 | 95K | 16K | $2.80 | $0.44 | −83% |
| T3 — Complex (5 files) | 14 | 3 | 145K | 22K | $4.60 | $0.76 | −83% |
| **Combined** | **29** | **8** | **278K** | **49K** | **$8.60** | **$1.42** | **−80%** |

**Combined reduction: −72% calls · −82% tokens · −83% cost · 13m 12s returned**

### Monthly Projection (8h/day × 20 days, 15 tasks/day)

| Metric | Without Slim | With Slim | Savings |
|---|---|---|---|
| API cost | $756 | $125 | **$631 saved (−83%)** |
| Tool calls | 2,640 | 780 | 1,860 fewer (−70%) |
| Tokens | 24.7M | 4.6M | ~20M saved (−82%) |
| Wait time | 24.3h | 5.1h | **19h returned (−79%)** |

Full methodology and raw data: **[codecondense.com/benchmarks](https://codecondense.com/benchmarks)**

---

## Features

### 🌳 AST Symbol Index — real code understanding, not grep

CodeCondense uses **tree-sitter** — the same parser behind VS Code and GitHub Copilot — to build a full Abstract Syntax Tree of your codebase. It understands what your code *means*, not just what it *contains*.

```
Without CodeCondense:
  Claude → grep "render"   → 847 matches, 203 files, 12 reads, ~54,000 tokens

With CodeCondense:
  Claude → Sql({ op: "search", name: "render", type: "function" })
         → 3 results: exact definition locations, 1 roundtrip, ~200 tokens
```

**270× token reduction. Same answer.**

Supports **37 languages**: TypeScript · JavaScript · Python · Go · Rust · Java · Kotlin · C# · Swift · PHP · Ruby · Scala · Elixir · C/C++ · Dart · Vue · CSS · Bash · YAML · JSON · TOML · Solidity · Zig · and more — all via precompiled WebAssembly grammars. No setup, no language servers.

---

### 🔍 Smart Search — grep + read + AST in one call

```
Without CodeCondense:   Glob → Read → Read → Grep → Read → Read → Read
                        7 calls · ~12,000 tokens

With CodeCondense:      Search({ content_regex: "...", output_mode: "file_paths_with_content" })
                        1 call · ~2,400 tokens
```

- **Ripgrep under the hood** — sub-second on codebases with 100k files
- **Delta mode** — re-reading a file? Returns a unified diff of what changed, not the whole file again (80–95% token savings on repeated reads)
- **AST summary mode** — understand a 600-line file in 40 tokens
- **BM25 ranking** — results sorted by relevance density
- **Budget enforcement** — results capped at a token budget, never floods context

---

### ✏️ Batch Edit — all your edits in one roundtrip

```
Without CodeCondense:   5 separate Edit calls · 5 waits · ~15 seconds · $0.20 on Opus

With CodeCondense:      Edit({ edits: [file A, file B, file C, file D, file E] })
                        1 call · 1 wait · ~3 seconds · $0.04 on Opus
```

Every edit is guarded: exact-match validation, pre-write backups, shrink fuse, empty-write fuse, symlink guard, Jupyter notebook support.

Additional edit modes beyond exact string replace:
- **`regex: true`** — `old_string` as a JS regex (dotAll + multiline), `$1`/`$2` backrefs, Serena-style `$!1` compat
- **`insert_at_line: N`** — pure insertion before line N without needing to know surrounding text
- **`file#N-M`** — delete or replace a line range directly

---

### 🔎 Symbols — LSP-powered code intelligence

```
Without CodeCondense:   Search → get line:char → Symbols op:references → Read × N refs
                        5+ calls

With CodeCondense:      Symbols({ op: "references", symbol: "processPayment",
                                  include_snippets: true })
                        1 call — name resolved + context lines embedded
```

LSP semantic operations without line numbers:
- **`op:body`** — get a named symbol's full source body (no overview + Read needed)
- **`op:references`** with `include_snippets:true` — each hit includes surrounding context lines, eliminating follow-up Reads
- **`op:definition|references`** with `symbol:"name"` — resolves coordinates internally, no prior Search needed
- **`op:rename`** — rename a symbol across the entire codebase via LSP
- **`op:replace_body`** — replace a function/class body by name, no line numbers
- **`op:safe_delete`** — deletes a symbol only when zero references exist

Requires an LSP server configured in `~/.slim/lsp.json` (optional — all other tools work without it).

---

### 🔬 Investigate — the search-everything command

```
Claude → Investigate({ query: "useAuthContext" })
       → symbols:  exact AST definition (file:line, type)
       → matches:  all usages across the codebase
       → files:    top files ranked by density, each with AST symbol map
```

Collapses the entire explore-a-symbol workflow into a **single tool call**.

---

### 🧠 Session Memory — Claude that actually remembers

Claude Code starts every session with amnesia. CodeCondense fixes that.

```
Memory({ op: "index", type: "convention", name: "package-manager",
  body: "Always use pnpm. npm install breaks CI." })

// Next session, weeks later:
Memory({ op: "search", query: "package manager" })
→ instant answer · 1 call · ~30 tokens

// vs. Claude re-reading files to rediscover it:
→ 4–6 reads · ~18,000 tokens · ~$0.27 on Opus
```

**540× cheaper than rediscovery.**

Memory uses a **hybrid BM25 + semantic search engine**. Queries find the right memory even when the exact words don't match:

```
Memory({ op: "search", query: "login credentials" })
→ finds: "Authentication uses JWT tokens with 1h expiry"
   (matched via synonym: credentials → auth → JWT)

Memory({ op: "search", query: "token expiry session" })
→ finds: auth memory     ← not the exact words you stored

Memory({ op: "search", query: "typescript types" })
→ finds: "strict mode must be enabled, never use any"
```

The semantic layer is **corpus-aware TF-IDF with synonym expansion** — no model download, no network, zero latency, works fully offline. A 40-term dev-domain synonym table bridges common abbreviations: `jwt ↔ token`, `pkg ↔ package`, `auth ↔ authentication`, `ts ↔ typescript`, `deploy ↔ ship`, and more.

Memory uses a **half-life decay model**: frequently-used memories stay sharp, stale ones fade. Feedback auto-promotes to conventions after 5 uses. Contradictions are tracked and penalized.

Five memory types: `convention` · `feedback` · `project` · `reference` · `user` — each with the right lifetime.

**Recall** adds BM25 search over your entire `~/.claude/projects/` history — every past session, always searchable.

---

### 🤖 Model Router — pay Haiku prices for Haiku work

Not every request needs Opus. CodeCondense's local proxy routes automatically:

| Request type | Routed to | Cost/call |
|---|---|---|
| Simple tool calls (read, search, bash) | Haiku | ~$0.001 |
| Moderate tasks (edit, explain) | Sonnet | ~$0.025 |
| Complex reasoning (architect, debug) | Opus | ~$0.042 |

```
200-call session without router:  200 × Opus   = ~$8.40
200-call session with router:     140 × Haiku  = ~$0.14
                                   45 × Sonnet = ~$1.13
                                   15 × Opus   = ~$0.63
                                  Total:  ~$1.90  (77% cheaper)
```

Zero config. Starts automatically. Override rules per project in `~/.slim/router-config.json`.

---

### 📊 Savings Dashboard — see exactly where your money goes

```bash
/slim-savings      # session + lifetime savings report
/slim-status       # trial status, plan, calls used
/slim-dashboard    # interactive HTML dashboard with charts
```

Tracks tool calls saved, tokens saved, USD saved — per session and lifetime — computed locally from a plain JSONL event log. Real dollar math at your model's actual rates.

---

### 🔒 100% Local — your code never leaves your machine

- Code index built locally via WebAssembly grammars. No upload.
- Memory and telemetry stored in `~/.slim/`. No upload.
- Licensing check sends only: machine UUID, plugin version, anonymous call counts. **No code. No prompts. No file names.**

Works air-gapped. Everything is auditable.

---

## Install

```bash
npx @codecondense/install
```

Or via Claude Code marketplace:

```bash
claude plugin add LCBO/codecondense_claude_plugin
```

Restart Claude Code. Free trial starts immediately — no config, no API keys, no account.

---

## Slash commands

| Command | What it does |
|---|---|
| `/slim-savings` | Session + lifetime savings report |
| `/slim-status` | License / trial status, plan, calls used/remaining |
| `/slim-dashboard` | Open the interactive HTML savings dashboard |
| `/slim-router` | Start / stop / status the model router |
| `/slim-reindex` | Rebuild the AST code symbol index |
| `/slim-stats` | Code index stats — files and symbol counts |
| `/slim-profile` | Show or set tool profile (`tiny` → `ultra`) |
| `/slim-login` | Save an API key to lift the trial savings cap |
| `/slim-logout` | Remove the saved API key (return to trial) |
| `/slim-install` | Re-wire plugin into Claude Code / Grok config |
| `/slim-update` | Update the plugin to the latest version |
| `/slim-recover` | List or restore pre-edit file backups |
| `/slim-tail` | Show recent telemetry events |
| `/slim-reset` | Clear all telemetry events (irreversible) |

---

## Tool profiles

The `tiny → ultra` profile ladder controls how many tools appear in Claude's context every turn — smaller manifests = fewer tokens spent on tool descriptions.

| Profile | Tools included | Best for |
|---|---|---|
| `tiny` | Search only | Aggressive token savings |
| `lean` | Search + Edit | Balanced editing workflows |
| `core` | Search, Investigate, Read, Edit, Write, Sql, Symbols | Most projects |
| `full` / `ultra` | Everything including Memory + Recall | Full feature set |

```bash
/slim-profile lean    # switch to lean profile
/slim-profile         # show current profile
```

---

## Pricing

| Plan | Price | Savings cap | Notes |
|---|---|---|---|
| **Anonymous** | $0/mo | $5/month | No account needed · resets 1st of month |
| **Free Account** | $0/mo | $10/month | Cap tracked across all your machines |
| **Pro** | $9.99/mo | Unlimited | API key links account across machines |
| **Enterprise** | Custom | Unlimited | Multi-seat · SSO · audit logs · SLA |

All plans include every feature: AST index, Investigate, Smart Search, Batch Edit, Session Memory, Model Router, Dashboard, and all future updates.

---

## The numbers

| Metric | Benchmark result |
|---|---|
| API roundtrips eliminated | **−72% to −85%** |
| Token reduction | **−72% to −85%** |
| Cost reduction | **−82% to −83%** |
| Time saved per session | **13–16 minutes** |
| Monthly cost saved (heavy user) | **$631 at Sonnet rates** |
| AST search vs grep | **270× fewer tokens** |
| Memory recall vs rediscovery | **540× cheaper** |

---

> *"I was spending $40/day on Claude Code. CodeCondense cut it to $18."*
> — Senior engineer, fintech startup

> *"The batch edit alone saves me 20 minutes a day."*
> — Full-stack developer

> *"The AST search actually understands my code, not just searches text."*
> — TypeScript developer

---

**[codecondense.com](https://codecondense.com)** · 1,200+ developers

*CodeCondense — Compress your Claude costs. Not your ambitions.*
