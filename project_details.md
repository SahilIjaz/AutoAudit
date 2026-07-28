Let's break this into two parts: a full technical walkthrough of how the project works end-to-end, and then a complete skills/tools inventory so you know exactly what to learn and where the gaps might be.

## Part 1: Detailed Project Explanation

### The core concept, explained simply

Most AI code-review tools do this: paste code into a prompt → "please review this" → LLM guesses at problems based on pattern-matching from training data. This hallucinates a lot — it invents vulnerabilities that aren't there, or misses real ones, because the LLM never actually *ran* anything.

Your project flips this: the LLM's job is to **orchestrate real tools and interpret their real output**, not to imagine problems. This is the actual definition of "agentic" — an LLM that takes actions in a loop (call tool → observe result → decide next action → repeat) until it reaches a goal.

### Walking through a single request, end-to-end

**Step 1: User submits a repo URL**
Your Next.js frontend sends `https://github.com/user/repo` to an API route.

**Step 2: Clone and profile the repo**
Your backend clones the repo (shallow clone, depth=1, to keep it fast) into a temp directory. Before any AI involvement, plain code:
- Detects the stack (package.json → Node/React? requirements.txt → Python?)
- Counts files, finds entry points, flags obviously huge files
- This produces a small JSON "repo profile" — no LLM yet.

**Step 3: Run static analysis tools**
Still no LLM. You run:
- **Semgrep** — pattern-based static analysis, finds real security issues (SQL injection patterns, hardcoded secrets, unsafe eval, etc.) and outputs structured JSON
- **npm audit** (or `pip-audit` for Python) — checks dependencies against known vulnerability databases
- **ESLint** (optionally with security plugins) — code quality issues

Each of these produces **structured, factual JSON** — findings that are true because a deterministic tool found them, not because an LLM guessed.

**Step 4: The agent takes over — orchestration loop**
Now you hand the LLM:
- The repo profile
- The raw tool outputs
- A set of "tools" it's allowed to call, e.g. `read_file(path)`, `get_file_diff_context(path)`, `search_codebase(pattern)`

The LLM's job now is *not* to invent findings, but to:
- Decide which flagged issues are worth deeper inspection (read the actual file around that line)
- Cross-reference — e.g., "Semgrep flagged a hardcoded string in config.js — let me read that file to confirm it's actually a secret and not a placeholder"
- Decide when it has enough information to stop (this is the "agentic" loop — call tool, evaluate, decide to continue or finish)

This is the part of the project that teaches you real function-calling / tool-use patterns — the same pattern used in production agent systems everywhere (customer support agents, coding agents, research agents).

**Step 5: Structured output generation**
Instead of letting the LLM free-write a report (which is inconsistent and hard to render in UI), you force it to return JSON matching a strict schema:
```
{
  "findings": [
    {
      "severity": "high" | "medium" | "low",
      "category": "security" | "dependency" | "code-quality",
      "file": "src/config.js",
      "line": 42,
      "description": "...",
      "evidence": "which tool found this",
      "suggested_fix": "..."
    }
  ],
  "summary": "...",
  "metrics": { "files_scanned": 84, "tools_used": [...] }
}
```
You validate this with **Zod**. If the LLM returns malformed JSON (it will, sometimes), you catch the validation error and re-prompt with the error message — "your output was invalid because X, please fix." This retry-on-validation-failure pattern is a very real production pattern worth having in your portfolio.

**Step 6: Render the report**
Next.js frontend takes the validated JSON and renders a clean dashboard — severity badges, expandable code context, links to the exact file/line on GitHub.

**Step 7: The metrics layer (this is a differentiator)**
Track and display: tokens used, estimated cost of the analysis, time taken, number of tool calls made. This proves you think about running this as a *real product*, not just a demo — cost and latency awareness is exactly what separates "junior AI tinkerer" from "engineer who could ship this at a company."

### The experiment that makes your case study stand out

Build a tiny side-by-side comparison: run the same repo through (a) a naive "just ask the LLM to review this code" prompt, and (b) your grounded, tool-based agent. Manually check both outputs against a repo where you know the actual issues (plant a few real ones intentionally). Show that the naive approach hallucinates issues or misses real ones, while your grounded approach doesn't. This turns your project from "I built a thing" into "I proved a design decision was correct" — which is a completely different level of portfolio material.

## Part 2: Skills and Tools Needed

### Already in your toolkit (based on your background)
- Next.js (App Router, API routes)
- Node.js
- React
- Basic LLM API integration (you've done this at Tinkerbyte)

### Skills you'll need to build or sharpen

**1. Function calling / tool use with LLMs**
This is the centerpiece skill. Learn the tool-use pattern specifically:
- Defining tool schemas (name, description, input parameters)
- Handling the model's tool-call requests
- Feeding tool results back into the conversation
- Anthropic and OpenAI both document this clearly — Anthropic's docs on tool use are a good place to start since the pattern is very explicit there.

**2. Structured output validation**
- **Zod** (TypeScript-first schema validation) — you'll use this constantly
- The retry-on-validation-failure pattern (catch bad output, feed the error back to the model, ask it to correct itself)

**3. Working with subprocess/CLI tools from Node**
- `child_process.exec` / `execa` (a nicer wrapper) — for running Semgrep, ESLint, npm audit from your backend
- Parsing CLI tool JSON output formats (each tool has its own output schema — you'll need to normalize them)

**4. Git operations programmatically**
- `simple-git` (npm package) or shelling out to `git clone --depth 1`
- Basic understanding of temp directory handling and cleanup (don't leave cloned repos on disk forever)

**5. Static analysis tools (you don't need to master these, just integrate them)**
- **Semgrep** — install their CLI, learn to run it with `--json` output, understand their rule sets for security patterns
- **npm audit** — built into npm, just needs JSON parsing
- **ESLint** — you likely already know this

**6. Async job handling**
- Since repo analysis takes time (cloning + scanning + LLM calls), you shouldn't block an HTTP request for 30+ seconds
- Simplest version: a job queue in-memory with polling (`/api/status/:jobId`)
- More impressive version: **BullMQ + Redis** — a real job queue, which is a legitimate production pattern worth having on your resume

**7. Prompt engineering specifically for agents**
- System prompts that clearly define the agent's role, available tools, and stopping conditions
- Learning to write good tool descriptions (the model's ability to use a tool well depends heavily on how clearly you describe it)

**8. Cost/token tracking**
- Learn how token counting works (tiktoken for OpenAI models, or the equivalent for Claude)
- Simple math: track input/output tokens per call, multiply by the model's per-token price, sum across the session

**9. Deployment**
- Vercel for the Next.js app itself
- For the parts that need to run subprocesses (git clone, Semgrep) — Vercel's serverless functions have limitations here (execution time limits, no persistent filesystem in some cases), so you may need a small separate backend service on **Railway, Render, or Fly.io** that handles the heavier repo-analysis work, while Next.js/Vercel handles the frontend and light API routes. This is actually a good thing to learn and mention — real production Gen-AI systems are rarely single-deployment-target, and knowing *why* you split it is a strong talking point.

### Suggested learning order (if any of this is new)
1. Tool use / function calling basics — build the smallest possible example first, unrelated to this project (e.g., an agent that calls a weather API)
2. Zod schema validation
3. Running Semgrep locally, understanding its output
4. Combine: build Week 1 (tool layer) → Week 2 (agent loop) → Week 3 (validation + UI + metrics) as outlined earlier

Want me to write out the actual tool schema definitions and the first version of the orchestrator prompt so you have real starter code instead of just the plan?