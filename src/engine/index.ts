import Anthropic from "@anthropic-ai/sdk";
import { CONFIG, detectCapabilities } from "./config";
import type { AuditReport, Finding, RepoMeta } from "./types";
import {
  cloneRepo,
  useLocalRepo,
  sweepStaleTempDirs,
  type ClonedRepo,
} from "./git/cloneRepo";
import { fetchRepoTarball } from "./git/fetchRepo";
import { profileRepo } from "./profile/stackProfiler";
import { runAllAnalyzers } from "./analyzers";
import { runAgentLoop } from "./agent/orchestrator";
import type { ToolContext } from "./agent/tools";
import { generateValidatedReport } from "./output/validateWithRetry";
import { normalizeFinding } from "./output/schema";
import { MetricsCollector } from "./metrics/metrics";

/**
 * Single-process pipeline, used by the CLI harness (`npm run analyze`).
 *
 * The hosted app does NOT use this path — a serverless function cannot hold a
 * multi-minute job, so the web flow is split into short steps in
 * ./serverless/steps.ts and driven from the browser. This entry point stays
 * because locally there is no such limit, and with git + Semgrep on PATH it
 * produces a richer scan than the hosted deployment can.
 */

let sweptOnce = false;

function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local.");
  }
  return new Anthropic();
}

function repoMeta(repo: ClonedRepo, url: string): RepoMeta {
  return {
    owner: repo.owner,
    repo: repo.repo,
    headSha: repo.headSha,
    defaultBranch: repo.defaultBranch,
    url,
  };
}

/**
 * A local path or file:// URL analyzes a directory in place. Remote repos use
 * `git clone` when git is available and fall back to the tarball fetch when it
 * is not, so the CLI still works on a machine without git.
 */
async function acquireRepo(repoUrl: string): Promise<ClonedRepo> {
  if (repoUrl.startsWith("file://")) return useLocalRepo(repoUrl.slice("file://".length));
  if (!repoUrl.startsWith("http")) return useLocalRepo(repoUrl);
  const caps = await detectCapabilities();
  return caps.git ? cloneRepo(repoUrl) : fetchRepoTarball(repoUrl);
}

/** Direct pipeline entry for the CLI harness. */
export async function analyzeToReport(
  repoUrl: string,
  opts: { agent: boolean }
): Promise<{
  report?: AuditReport;
  findings: Finding[];
  profile: Awaited<ReturnType<typeof profileRepo>>;
}> {
  if (!sweptOnce) {
    sweptOnce = true;
    void sweepStaleTempDirs();
  }

  const metrics = new MetricsCollector();
  const repo = await acquireRepo(repoUrl);
  try {
    const profile = await metrics.time("profile", () => profileRepo(repo.dir, repo));
    const findings = await metrics.time("scan", () => runAllAnalyzers(repo.dir, profile));
    if (!opts.agent) return { findings, profile };

    const client = anthropic();
    const capped = findings.slice(0, CONFIG.maxFindingsToAgent);
    const overflow = findings.slice(CONFIG.maxFindingsToAgent);

    const ctx: ToolContext = { repoDir: repo.dir, profile, metrics };
    const agentResult = await metrics.time("agent", () => runAgentLoop(client, capped, ctx));

    const knownIds = new Set(capped.map((f) => f.id));
    const modelReport = await metrics.time("report", () =>
      generateValidatedReport(client, agentResult.transcript, knownIds, metrics)
    );

    // Overflow findings the agent never saw are reported as unverified.
    const overflowVerified = overflow.map((f) =>
      normalizeFinding({
        findingId: f.id,
        verdict: "unverified" as const,
        severity: f.severity,
        category: f.category,
        file: f.file,
        line: f.line,
        title: f.message.slice(0, 80),
        explanation: "Not investigated — exceeded the per-run triage cap.",
        evidence: `Flagged by ${f.tool} (${f.ruleId}).`,
        suggestedFix: null,
        contextSnippet: null,
        plainTitle: f.message,
        plainImpact: "This one wasn't checked — too many findings in a single run.",
        plainFix: null,
      })
    );

    const report: AuditReport = {
      summary: modelReport.summary,
      findings: [...modelReport.findings.map(normalizeFinding), ...overflowVerified],
      repo: repoMeta(repo, repoUrl),
      metrics: metrics.snapshot(),
      rawFindings: findings,
    };
    return { report, findings, profile };
  } finally {
    await repo.cleanup();
  }
}
