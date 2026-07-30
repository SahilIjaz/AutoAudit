import Anthropic from "@anthropic-ai/sdk";
import type { CompareResult } from "../types";
import { cloneRepo, useLocalRepo, type ClonedRepo } from "../git/cloneRepo";
import { profileRepo } from "../profile/stackProfiler";
import { runAllAnalyzers } from "../analyzers";
import { runAgentLoop } from "../agent/orchestrator";
import { generateValidatedReport } from "../output/validateWithRetry";
import { normalizeFinding } from "../output/schema";
import { MetricsCollector } from "../metrics/metrics";
import { runNaiveReview } from "./naive";
import { CONFIG } from "../config";
import type { AuditReport } from "../types";

async function acquire(repoUrl: string): Promise<ClonedRepo> {
  if (repoUrl.startsWith("file://")) return useLocalRepo(repoUrl.slice("file://".length));
  if (!repoUrl.startsWith("http")) return useLocalRepo(repoUrl);
  return cloneRepo(repoUrl);
}

/**
 * One clone, both modes — the case-study experiment. Returns grounded vs naive
 * so the two can be scored against known ground truth.
 */
export async function runExperiment(repoUrl: string): Promise<CompareResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }
  const client = new Anthropic();
  const repo = await acquire(repoUrl);
  try {
    const profile = await profileRepo(repo.dir, repo);
    const findings = await runAllAnalyzers(repo.dir, profile);

    const groundedMetrics = new MetricsCollector();
    const capped = findings.slice(0, CONFIG.maxFindingsToAgent);
    const agentResult = await runAgentLoop(client, capped, {
      repoDir: repo.dir,
      profile,
      metrics: groundedMetrics,
    });
    const modelReport = await generateValidatedReport(
      client,
      agentResult.transcript,
      new Set(capped.map((f) => f.id)),
      groundedMetrics
    );
    const grounded: AuditReport = {
      summary: modelReport.summary,
      findings: modelReport.findings.map(normalizeFinding),
      repo: {
        owner: repo.owner,
        repo: repo.repo,
        headSha: repo.headSha,
        defaultBranch: repo.defaultBranch,
        url: repoUrl,
      },
      metrics: groundedMetrics.snapshot(),
      rawFindings: findings,
    };

    const naiveMetrics = new MetricsCollector();
    const naive = await runNaiveReview(client, repo.dir, profile, naiveMetrics);

    return { grounded, naive };
  } finally {
    await repo.cleanup();
  }
}
