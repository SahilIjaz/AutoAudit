# AutoAudit

Grounded, agentic AI code review. Instead of asking an LLM to "review this code"
(which hallucinates), AutoAudit runs **real static-analysis tools** to find issues,
then a **Claude agent reads the actual code** to verify and triage each finding.
Every finding is backed by a tool + evidence, not a guess.

Deploys to **Vercel** with no second service, no database, and no queue.

## How it works

1. **Fetch** — downloads the repo as a GitHub tarball and extracts it in JS (no `git` binary).
2. **Profile** — plain code detects the stack (no LLM).
3. **Scan** — npm advisories, a committed-secret scanner, and ESLint security rules
   (plus Semgrep when running locally) → normalized findings.
4. **Verify** — a Claude tool-use loop reads files (`read_file`, `get_file_context`,
   `search_codebase`, `list_files`) to confirm or refute each finding. It may only
   reference findings the tools produced — it cannot invent new ones.
5. **Report** — output is forced into a strict Zod schema with a retry-on-validation loop.
   Each finding carries two layers: a plain-language one (`plainTitle`, `plainImpact`,
   `plainFix`) shown by default, and the technical one (rule name, evidence, code
   snippet) revealed behind **More depth analysis**.
6. **Email** — optional. The plain report in the body, full technical analysis attached.
7. **Metrics** — tokens, estimated cost, wall time, and tool-call counts per run.

## Prerequisites

- Node ≥ 20
- An Anthropic API key
- Optional, local only: `git` and Semgrep (`brew install semgrep`) for a richer scan

Nothing else. The hosted path shells out to no binaries at all.

## Setup

```bash
npm install
cp .env.local.example .env.local   # add ANTHROPIC_API_KEY + FINDINGS_SIGNING_SECRET
npm run dev
```

Generate the signing secret with `openssl rand -hex 32`.

## Deploying to Vercel

```bash
vercel        # or import the repo at vercel.com/new
```

Set these in **Project Settings → Environment Variables**:

| Variable | Why |
|---|---|
| `ANTHROPIC_API_KEY` | required |
| `FINDINGS_SIGNING_SECRET` | required — see [Safety](#safety) |
| `AUDIT_IP_LIMIT`, `AUDIT_DAILY_LIMIT` | caps your model spend on a public URL |
| `GITHUB_TOKEN` | optional; lifts GitHub's 60/hr per-IP API limit |
| `SMTP_*`, `MAIL_FROM` | optional; enables emailed reports |
| `APP_BASE_URL` | optional; adds a report link to emails |

To reproduce the hosted behaviour locally — pure JS, no Semgrep — run
`AUTOAUDIT_JS_ONLY=1 npm run dev`. Do this before deploying; it is the difference
between "works on my machine" and "works on Vercel".

### Why the hosted app is split into three requests

A serverless function cannot hold a multi-minute job, so the browser drives the run:

```
POST /api/scan      → fetch, scan, return signed findings   (~5s)
POST /api/verify    → verify ONE batch of findings          (repeat until done)
POST /api/finalize  → write the summary, send the email
```

State lives in the browser between calls. That is what removes the need for a
database, a queue, or a second host — and the progress bar becomes real
("verifying 8/37") instead of a spinner over an opaque wait.

Two consequences worth knowing:

- **Keep the tab open.** The email is sent by `/api/finalize`, so closing the tab
  mid-run means no report and no email.
- **Semgrep cannot run on Vercel.** It is a Python app with a compiled core, far over
  a function's size limit. Hosted runs use npm advisories + the secret scanner +
  ESLint, and the UI says so under every report rather than quietly implying
  full coverage. A local run still uses Semgrep and finds more.

## Run the CLI (no UI, full power)

```bash
# Deterministic pipeline only, no LLM:
npm run analyze -- ./fixtures/vuln-repo --no-agent

# Full grounded audit (needs ANTHROPIC_API_KEY):
npm run analyze -- ./fixtures/vuln-repo

# A real repo:
npm run analyze -- https://github.com/owner/repo
```

A local path or `file://` URL analyzes a directory directly. The CLI runs the whole
pipeline in one process, uses `git clone` when git is present, and includes Semgrep —
so it is the better tool for auditing something seriously.

## Email delivery (optional)

Nodemailer over SMTP. Leave `SMTP_USER`/`SMTP_PASS` unset and the feature disappears
from the form entirely.

For Gmail: enable 2FA, then create an [App Password](https://myaccount.google.com/apppasswords)
(a normal account password will not work).

Verify the credentials without spending an audit:

```bash
npm run mail:test -- you@example.com          # sample report
npm run mail:test -- you@example.com --fail   # the failure notice
```

The body carries only the plain-language layer; the full technical analysis is
attached as a self-contained `autoaudit-report.html`, because email clients have no
expand button. Sends are capped per address.

## Tests

```bash
npm test
```

Covers the GitHub URL parser, tool-output normalizers, lockfile parsing, the
secret-scanner rules, the path-traversal guard (`resolveWithin`), the agent loop's
iteration cap, the report retry-on-invalid loop, the plain-language normalizer, the
finding-signature boundary, both rate limiters, and the email layer.

## Architecture

`src/engine/` never imports `next` or `react`, so it runs identically from a route
handler, the CLI, or a test. Two entry points wrap it:

- `src/engine/index.ts` — one-process pipeline for the CLI.
- `src/engine/serverless/steps.ts` — the three short steps the hosted app uses.

Route handlers in `src/app/api/` are thin adapters over the latter.

### Safety

- Path traversal is contained by a single `resolveWithin()` chokepoint (realpath +
  symlink check) that every agent tool goes through.
- Only public `https://github.com/owner/repo` URLs are accepted (strict allowlist).
- Tarball entries are untrusted: absolute paths, traversal, symlinks and devices are
  filtered out, and the size cap is enforced *during* extraction, not after.
- Untrusted repo code is never executed: ESLint runs with a bundled config (never the
  repo's), dependency data comes from the registry's advisory API rather than an
  `npm install`, and the agent has no shell/exec tool.
- Repo content is treated as untrusted data in the prompt; the report schema requires
  every `findingId` to match a real tool finding, so injected text can't add findings.
- **Findings are HMAC-signed per finding.** The browser holds them between `/api/scan`
  and `/api/verify`, so without a signature a caller could post fabricated findings
  and have the agent "verify" them — destroying the one guarantee the project makes.
  Verification refuses tampered, cross-repo and unsigned findings, and refuses
  everything if `FINDINGS_SIGNING_SECRET` is unset rather than waving it through.
- Finding text reaches the email and HTML attachment through a single `escapeHtml()`,
  since it is model-written and quotes untrusted repo content.
- Audits are rate-limited per IP and per day, because a public URL spending an
  Anthropic key has no natural ceiling.
