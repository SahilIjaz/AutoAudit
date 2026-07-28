# AutoAudit

Grounded, agentic AI code review. Instead of asking an LLM to "review this code"
(which hallucinates), AutoAudit runs **real static-analysis tools** to find issues,
then a **Claude agent reads the actual code** to verify and triage each finding.
Every finding is backed by a tool + evidence, not a guess.

## How it works

1. **Clone** — shallow-clones a public GitHub repo into a temp dir (auto cleaned up).
2. **Profile** — plain code detects the stack (no LLM).
3. **Scan** — runs Semgrep, `npm audit`, and ESLint (security rules) → normalized findings.
4. **Agent** — a Claude tool-use loop reads files (`read_file`, `get_file_context`,
   `search_codebase`, `list_files`) to confirm or refute each finding. It may only
   reference findings the tools produced — it cannot invent new ones.
5. **Report** — output is forced into a strict Zod schema with a retry-on-validation loop.
6. **Metrics** — tokens, estimated cost, wall time, and tool-call counts per run.
7. **Compare** — optional mode runs the same repo through a naive "just review this"
   prompt vs. the grounded agent, side by side.

## Prerequisites

- Node ≥ 20
- `git` ≥ 2.x
- Semgrep: `brew install semgrep` (or `pipx install semgrep`)
- An Anthropic API key

## Setup

```bash
npm install
cp .env.local.example .env.local   # then add your ANTHROPIC_API_KEY
```

## Run the web app

```bash
npm run dev
# open http://localhost:3000, paste a public GitHub URL
```

## Run the CLI (no UI)

```bash
# Deterministic pipeline only, no LLM:
npm run analyze -- ./fixtures/vuln-repo --no-agent

# Full grounded audit (needs ANTHROPIC_API_KEY):
npm run analyze -- ./fixtures/vuln-repo

# Grounded vs. naive comparison:
npm run analyze -- ./fixtures/vuln-repo --compare

# A real repo:
npm run analyze -- https://github.com/owner/repo
```

A local path or `file://` URL analyzes a directory directly (used for the fixture).

## Tests

```bash
npm test
```

Covers the GitHub URL parser, tool-output normalizers, the path-traversal guard
(`resolveWithin`), the agent loop's iteration cap, and the report retry-on-invalid loop.

## Architecture

The analysis engine (`src/engine/`) never imports `next` or `react`, so it can later
move to a separate service (Railway/Fly) while the Next.js frontend deploys to Vercel.
Route handlers in `src/app/api/` are thin adapters over the engine; jobs run in an
in-memory store (`src/engine/jobs/jobStore.ts`) behind a `JobStore` interface so a
real queue (BullMQ/Redis) can slot in later.

### Safety

- Path traversal is contained by a single `resolveWithin()` chokepoint (realpath +
  symlink check) that every agent tool goes through.
- Only public `https://github.com/owner/repo` URLs are accepted (strict allowlist).
- Untrusted repo code is never executed: `npm audit` uses `--package-lock-only
  --ignore-scripts`, ESLint runs with a bundled config (never the repo's), and the
  agent has no shell/exec tool.
- Repo content is treated as untrusted data in the prompt; the report schema requires
  every `findingId` to match a real tool finding, so injected text can't add findings.
