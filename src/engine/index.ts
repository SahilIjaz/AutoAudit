import Anthropic from "@anthropic-ai/sdk";
import { CONFIG, checkToolchain } from "./config";
import type { AuditReport, CompareResult, Finding, RepoMeta, RepoProfile } from "./types";
import { cloneRepo, useLocalRepo, sweepStaleTempDirs, type ClonedRepo } from "./git/cloneRepo";
import { profileRepo } from "./profile/stackProfiler";
import { runAllAnalyzers } from "./analyzers";
import { runAgentLoop } from "./agent/orchestrator";
import type { ToolContext } from "./agent/tools";
import { generateValidatedReport } from "./output/validateWithRetry";
import { MetricsCollector } from "./metrics/metrics";
import { runNaiveReview } from "./compare/naive";
import type { JobStore } from "./jobs/jobStore";

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

async function acquireRepo(repoUrl: string): Promise<ClonedRepo> {
  // A file:// URL or bare local path runs against a local directory (fixtures).
  if (repoUrl.startsWith("file://")) return useLocalRepo(repoUrl.slice("file://".length));
  if (!repoUrl.startsWith("http")) return useLocalRepo(repoUrl);
  return cloneRepo(repoUrl);
}

export interface GroundedRunResult {
  report: AuditReport;
}

/** Shared clone → profile → scan → agent → report pipeline. */
async function analyze(
  repo: ClonedRepo,
  repoUrl: string,
  metrics: MetricsCollector,
  store: JobStore | undefined,
  jobId: string | undefined,
  precomputed?: { profile: RepoProfile; findings: Finding[] }
): Promise<AuditReport> {
  const setPhase = (phase: Parameters<JobStore["appendEvent"]>[1], note?: string) => {
    if (store && jobId) store.appendEvent(jobId, phase, note);
  };

  setPhase("profiling");
  const profile =
    precomputed?.profile ??
    (await metrics.time("profile", () => profileRepo(repo.dir, repo)));

  setPhase("scanning");
  const findings: Finding[] =
    precomputed?.findings ??
    (await metrics.time("scan", () => runAllAnalyzers(repo.dir, profile)));

  const client = anthropic();
  const capped = findings.slice(0, CONFIG.maxFindingsToAgent);
  const overflow = findings.slice(CONFIG.maxFindingsToAgent);

  setPhase("agent", `${capped.length} findings to verify`);
  const ctx: ToolContext = { repoDir: repo.dir, profile, metrics };
  const agentResult = await metrics.time("agent", () =>
    runAgentLoop(client, capped, ctx)
  );

  setPhase("reporting");
  const knownIds = new Set(capped.map((f) => f.id));
  const modelReport = await metrics.time("report", () =>
    generateValidatedReport(client, agentResult.transcript, knownIds, metrics)
  );

  // Overflow findings the agent never saw are reported as unverified.
  const overflowVerified = overflow.map((f) => ({
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
  }));

  return {
    summary: modelReport.summary,
    findings: [...modelReport.findings, ...overflowVerified],
    repo: repoMeta(repo, repoUrl),
    metrics: metrics.snapshot(),
    rawFindings: findings,
  };
}

export async function runAnalysis(
  repoUrl: string,
  jobId: string,
  store: JobStore
): Promise<void> {
  if (!sweptOnce) {
    sweptOnce = true;
    void sweepStaleTempDirs();
  }
  await checkToolchain();

  const metrics = new MetricsCollector();
  let repo: ClonedRepo | undefined;
  try {
    store.appendEvent(jobId, "cloning");
    repo = await metrics.time("clone", () => acquireRepo(repoUrl));
    const report = await analyze(repo, repoUrl, metrics, store, jobId);
    store.update(jobId, { report });
    store.appendEvent(jobId, "done");
  } catch (err) {
    store.update(jobId, { error: (err as Error).message });
    store.appendEvent(jobId, "error", (err as Error).message);
  } finally {
    if (repo) await repo.cleanup();
  }
}

export async function runComparison(
  repoUrl: string,
  jobId: string,
  store: JobStore
): Promise<void> {
  await checkToolchain();
  let repo: ClonedRepo | undefined;
  try {
    store.appendEvent(jobId, "cloning");
    repo = await acquireRepo(repoUrl);

    const groundedMetrics = new MetricsCollector();
    const grounded = await analyze(repo, repoUrl, groundedMetrics, store, jobId);

    store.appendEvent(jobId, "agent", "naive baseline");
    const naiveMetrics = new MetricsCollector();
    const client = anthropic();
    const profile = await profileRepo(repo.dir, repo);
    const naive = await naiveMetrics.time("naive", () =>
      runNaiveReview(client, repo!.dir, profile, naiveMetrics)
    );

    const compareResult: CompareResult = { grounded, naive };
    store.update(jobId, { report: grounded, compareResult });
    store.appendEvent(jobId, "done");
  } catch (err) {
    store.update(jobId, { error: (err as Error).message });
    store.appendEvent(jobId, "error", (err as Error).message);
  } finally {
    if (repo) await repo.cleanup();
  }
}

/** Direct pipeline entry for the CLI harness — no job store. */
export async function analyzeToReport(
  repoUrl: string,
  opts: { agent: boolean }
): Promise<{ report?: AuditReport; findings: Finding[]; profile: Awaited<ReturnType<typeof profileRepo>> }> {
  await checkToolchain();
  const metrics = new MetricsCollector();
  const repo = await acquireRepo(repoUrl);
  try {
    const profile = await profileRepo(repo.dir, repo);
    const findings = await runAllAnalyzers(repo.dir, profile);
    if (!opts.agent) return { findings, profile };
    // Agent path: reuse the already-computed profile/findings.
    const report = await analyze(repo, repoUrl, metrics, undefined, undefined, {
      profile,
      findings,
    });
    return { report, findings, profile };
  } finally {
    await repo.cleanup();
  }
}
