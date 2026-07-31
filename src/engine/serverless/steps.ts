import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { CONFIG } from "../config";
import type {
  AnalysisMetrics,
  AuditReport,
  Finding,
  RepoMeta,
  RepoProfile,
  VerifiedFinding,
} from "../types";
import { fetchRepoCached, fetchRepoTarball } from "../git/fetchRepo";
import { profileRepo } from "../profile/stackProfiler";
import { runAnalyzers } from "../analyzers";
import { AGENT_TOOLS, executeTool, type ToolContext } from "../agent/tools";
import { buildSystemPrompt, buildFindingsMessage } from "../agent/prompts";
import { generateValidatedBatch } from "../output/validateWithRetry";
import { normalizeFinding, SummarySchema } from "../output/schema";
import { MetricsCollector, mergeMetrics } from "../metrics/metrics";
import { signFindings, verifySignedFindings, type SignedFinding } from "./sign";
import { sendReportEmail } from "../notify/sendReport";

/**
 * The audit split into three short, independent requests. A serverless function
 * cannot hold a multi-minute job, so the browser drives the sequence:
 *
 *   scan  →  verify (once per batch)  →  finalize
 *
 * Nothing is stored server-side. State lives in the browser between calls, and
 * the findings are signed so the client cannot tamper with them (see ./sign).
 */

function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }
  return new Anthropic();
}

function repoMeta(
  meta: { owner: string; repo: string; headSha: string; defaultBranch: string },
  url: string
): RepoMeta {
  return {
    owner: meta.owner,
    repo: meta.repo,
    headSha: meta.headSha,
    defaultBranch: meta.defaultBranch,
    url,
  };
}

/* ------------------------------------------------------------------ scan */

export interface ScanResponse {
  repo: RepoMeta;
  profile: RepoProfile;
  /** Signed so /api/verify can trust them without server-side state. */
  findings: SignedFinding[];
  /** Findings beyond the triage cap, reported as unverified without an agent. */
  skippedFindings: VerifiedFinding[];
  toolsRun: string[];
  toolsSkipped: string[];
  metrics: AnalysisMetrics;
  batchSize: number;
}

export async function runScan(repoUrl: string): Promise<ScanResponse> {
  const metrics = new MetricsCollector();
  const repo = await metrics.time("fetch", () => fetchRepoTarball(repoUrl));

  try {
    const profile = await metrics.time("profile", () => profileRepo(repo.dir, repo));
    const scan = await metrics.time("scan", () => runAnalyzers(repo.dir, profile));

    const capped = scan.findings.slice(0, CONFIG.maxFindingsToAgent);
    const overflow = scan.findings.slice(CONFIG.maxFindingsToAgent);

    return {
      repo: repoMeta(repo, repoUrl),
      profile,
      findings: signFindings(repoUrl, repo.headSha, capped),
      skippedFindings: overflow.map((f) =>
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
      ),
      toolsRun: scan.toolsRun,
      toolsSkipped: scan.toolsSkipped,
      metrics: metrics.snapshot(),
      batchSize: CONFIG.verifyBatchSize,
    };
  } finally {
    // The tree is re-fetched (or cache-hit) per verify call, so nothing is kept.
    await repo.cleanup();
  }
}

/* ---------------------------------------------------------------- verify */

export interface VerifyRequest {
  repoUrl: string;
  sha: string;
  findings: SignedFinding[];
}

export interface VerifyResponse {
  verified: VerifiedFinding[];
  metrics: AnalysisMetrics;
}

/**
 * Verifies one batch. The agent gets a smaller iteration budget than a whole
 * run would, so a batch always finishes inside a function's time limit.
 */
export async function runVerifyBatch(req: VerifyRequest): Promise<VerifyResponse> {
  const findings: Finding[] = verifySignedFindings(req.repoUrl, req.sha, req.findings);
  if (findings.length === 0) {
    return { verified: [], metrics: new MetricsCollector().snapshot() };
  }

  const metrics = new MetricsCollector();
  const repo = await metrics.time("fetch", () => fetchRepoCached(req.repoUrl, req.sha));
  const profile = await metrics.time("profile", () => profileRepo(repo.dir, repo));

  const client = anthropic();
  const ctx: ToolContext = { repoDir: repo.dir, profile, metrics };
  const system = buildSystemPrompt(profile);
  const messages: MessageParam[] = [{ role: "user", content: buildFindingsMessage(findings) }];

  await metrics.time("agent", async () => {
    for (let i = 0; i < CONFIG.maxIterationsPerBatch; i++) {
      const res = await client.messages.create({
        model: CONFIG.model,
        max_tokens: 8192,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools: AGENT_TOOLS,
        messages,
      });
      metrics.recordUsage(res.usage);
      messages.push({ role: "assistant", content: res.content });
      if (res.stop_reason !== "tool_use") break;

      const toolUses = res.content.filter((b) => b.type === "tool_use");
      const results = await Promise.all(
        toolUses.map(async (tu) => {
          const { content, isError } = await executeTool(tu.name, tu.input, ctx);
          return {
            type: "tool_result" as const,
            tool_use_id: tu.id,
            content,
            ...(isError ? { is_error: true } : {}),
          };
        })
      );
      messages.push({ role: "user", content: results });
    }
  });

  const knownIds = new Set(findings.map((f) => f.id));
  const batch = await metrics.time("report", () =>
    generateValidatedBatch(client, messages, knownIds, metrics)
  );

  return { verified: batch.findings.map(normalizeFinding), metrics: metrics.snapshot() };
}

/* -------------------------------------------------------------- finalize */

export interface FinalizeRequest {
  repo: RepoMeta;
  findings: VerifiedFinding[];
  metrics: AnalysisMetrics;
  email?: string;
}

export interface FinalizeResponse {
  report: AuditReport;
  emailStatus?: { to: string; sent: boolean; reason?: string };
}

const SUMMARY_INSTRUCTION = `Write the one-line verdict for this audit as JSON: {"summary": string}.

The summary must be ONE or TWO short sentences, 40 words MAX, in plain English a non-expert can understand — no jargon, no file lists, no per-finding recap. Say (1) the overall verdict in one phrase and (2) the single most important thing to do. Respond with ONLY the JSON.`;

/**
 * Writes the overall summary across every batch and, if asked, emails the
 * report. One cheap call with no tools — the agent has already done the reading.
 */
export async function runFinalize(req: FinalizeRequest): Promise<FinalizeResponse> {
  const metrics = new MetricsCollector();
  const client = anthropic();

  const digest = req.findings.map((f) => ({
    verdict: f.verdict,
    severity: f.severity,
    category: f.category,
    title: f.plainTitle,
  }));

  let summary = "";
  await metrics.time("summary", async () => {
    for (let attempt = 0; attempt < CONFIG.maxOutputValidationRetries; attempt++) {
      const res = await client.messages.create({
        model: CONFIG.model,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `Verdicts for ${req.repo.owner}/${req.repo.repo}:\n\n\`\`\`json\n${JSON.stringify(
              digest,
              null,
              2
            )}\n\`\`\`\n\n${SUMMARY_INSTRUCTION}`,
          },
        ],
      });
      metrics.recordUsage(res.usage);
      const text = res.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end === -1) continue;
      const parsed = SummarySchema.safeParse(JSON.parse(text.slice(start, end + 1)));
      if (parsed.success) {
        summary = parsed.data.summary;
        return;
      }
    }
  });

  if (!summary) {
    // A missing summary must not sink a completed audit — the findings are the
    // product, and the counts already say most of what a summary would.
    const real = req.findings.filter((f) => f.verdict === "confirmed").length;
    summary = `Found ${real} confirmed ${real === 1 ? "issue" : "issues"} across ${
      req.findings.length
    } checked ${req.findings.length === 1 ? "flag" : "flags"}.`;
  }

  const report: AuditReport = {
    summary,
    findings: req.findings,
    repo: req.repo,
    metrics: mergeMetrics([req.metrics, metrics.snapshot()]),
    rawFindings: [],
  };

  let emailStatus: FinalizeResponse["emailStatus"];
  if (req.email) {
    const outcome = await sendReportEmail(req.email, report);
    emailStatus = { to: req.email, ...outcome };
  }

  return { report, emailStatus };
}
