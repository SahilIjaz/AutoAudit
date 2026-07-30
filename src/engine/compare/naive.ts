import type Anthropic from "@anthropic-ai/sdk";
import fsp from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "../config";
import type { RepoProfile, VerifiedFinding, AnalysisMetrics } from "../types";
import type { MetricsCollector } from "../metrics/metrics";
import { NAIVE_REVIEW_SYSTEM } from "../agent/prompts";
import { AuditReportSchema, normalizeFinding } from "../output/schema";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next"]);
const SOURCE_EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json"]);
const MAX_TOTAL_CHARS = 60_000;

async function collectSource(repoDir: string): Promise<string> {
  const parts: string[] = [];
  let total = 0;

  async function visit(dir: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (total >= MAX_TOTAL_CHARS) return;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await visit(path.join(dir, entry.name));
        continue;
      }
      if (!SOURCE_EXT.has(path.extname(entry.name))) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(repoDir, full);
      const content = await fsp.readFile(full, "utf8");
      const block = `\n// ===== FILE: ${rel} =====\n${content}`;
      parts.push(block.slice(0, MAX_TOTAL_CHARS - total));
      total += block.length;
    }
  }

  await visit(repoDir);
  return parts.join("\n");
}

export interface NaiveResult {
  summary: string;
  findings: VerifiedFinding[];
  metrics: AnalysisMetrics;
}

/**
 * The "just ask the LLM to review this code" baseline — no tools, no static
 * analysis, one prompt over concatenated source, forced into the same shape so
 * the two modes render identically in the compare UI.
 */
export async function runNaiveReview(
  client: Anthropic,
  repoDir: string,
  _profile: RepoProfile,
  metrics: MetricsCollector
): Promise<NaiveResult> {
  const source = await collectSource(repoDir);
  const instruction = `Review the following source code and report every security, dependency, or code-quality issue you find. Respond with ONLY a JSON object of this shape:
{
  "summary": string,
  "findings": [{
    "findingId": string,          // any unique id you choose, e.g. "naive-1"
    "verdict": "confirmed",
    "severity": "high" | "medium" | "low",
    "category": "security" | "dependency" | "code-quality",
    "file": string | null,
    "line": number | null,
    "title": string,
    "explanation": string,
    "evidence": string,
    "suggestedFix": string | null,
    "contextSnippet": string | null
  }]
}

SOURCE CODE:
${source}`;

  const res = await client.messages.create({
    model: CONFIG.model,
    max_tokens: 8192,
    system: NAIVE_REVIEW_SYSTEM,
    messages: [{ role: "user", content: instruction }],
  });
  metrics.recordUsage(res.usage);

  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let summary = "";
  let findings: VerifiedFinding[] = [];
  if (start !== -1 && end !== -1) {
    try {
      const parsed = AuditReportSchema.parse(JSON.parse(text.slice(start, end + 1)));
      summary = parsed.summary;
      findings = parsed.findings.map(normalizeFinding);
    } catch {
      summary = "Naive review produced unparseable output.";
    }
  }

  return { summary, findings, metrics: metrics.snapshot() };
}
