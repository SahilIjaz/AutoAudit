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
   Each finding carries two layers: a plain-language one (`plainTitle`, `plainImpact`,
   `plainFix`) that the UI shows by default, and the technical one (rule name, evidence,
   code snippet) revealed behind **More depth analysis**.
6. **Metrics** — tokens, estimated cost, wall time, and tool-call counts per run.
7. **Email** — optional. A full audit takes minutes, so the requester can have the
   report mailed to them and close the tab.
8. **Compare** — optional mode runs the same repo through a naive "just review this"
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

## Email delivery (optional)

Nodemailer over SMTP. Leave `SMTP_USER`/`SMTP_PASS` unset and the feature is off — a
submission that asks for email is then rejected with a clear message rather than
silently dropped.

For Gmail: enable 2FA, then create an [App Password](https://myaccount.google.com/apppasswords)
(a normal account password will not work) and put it in `SMTP_PASS`.

Verify the credentials without spending a real audit run:

```bash
npm run mail:test -- you@example.com          # sample report
npm run mail:test -- you@example.com --fail   # the failure notice
```

The email body carries only the plain-language layer; the full technical analysis is
attached as a self-contained `autoaudit-report.html` (email clients have no expand
button, so the depth ships as a file you open in a browser). Sends are capped per
address — the field is on an open form, and without a cap it would be a mail relay.
Set `APP_BASE_URL` only if the app is publicly reachable; it adds a link to the
interactive report, which is useless while jobs live in an in-memory store on localhost.

## Tests

```bash
npm test
```

Covers the GitHub URL parser, tool-output normalizers, the path-traversal guard
(`resolveWithin`), the agent loop's iteration cap, the report retry-on-invalid loop,
the plain-language normalizer, and the email layer (HTML escaping, body/attachment
split, rate limiting, transport failure handling).

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
- Finding text reaches the email and the HTML attachment through a single `escapeHtml()`,
  since that text is model-written and quotes untrusted repo content.
- Email sends are rate-limited per recipient so the open form can't be used as a relay.
