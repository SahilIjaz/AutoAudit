import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, TextBlock } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import { CONFIG } from "../config";
import type { MetricsCollector } from "../metrics/metrics";
import { AuditReportSchema, type AuditReportModelOutput } from "./schema";

export class ReportValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: unknown
  ) {
    super(message);
  }
}

const REPORT_INSTRUCTION = `Now produce the final audit report as a single JSON object and nothing else. It must match this shape exactly:
{
  "summary": string,            // ONE or TWO short sentences, 40 words MAX. Plain English a non-expert can understand — no jargon, no file lists, no per-finding recap. Say (1) the overall verdict in one phrase and (2) the single most important thing to do. Get to the point.
  "findings": [
    {
      "findingId": string,        // MUST be one of the finding ids you were given
      "verdict": "confirmed" | "false_positive" | "needs_review" | "unverified",
      "severity": "high" | "medium" | "low",
      "category": "security" | "dependency" | "code-quality",
      "file": string | null,
      "line": number | null,

      // --- The plain-language layer. This is ALL most readers will see, so it
      // --- must stand alone and be understandable by someone who does not
      // --- code. No jargon, no rule ids, no tool names, no file paths here.
      "plainTitle": string,       // ≤ 10 words, ≤ 72 chars. The problem in everyday words, e.g. "A password is written directly into the code".
      "plainImpact": string,      // EXACTLY ONE sentence, ≤ 25 words. What could actually go wrong, concretely. No hedging, no restating the title.
      "plainFix": string | null,  // EXACTLY ONE short instruction, ≤ 20 words, e.g. "Move the key into an environment variable and rotate it." null if nothing to do (e.g. false positives).

      // --- Technical detail, shown only when the reader opens the deep dive.
      // --- Be precise here; this is where jargon belongs.
      "title": string,            // the technical name for the issue
      "explanation": string,      // grounded in what you actually read
      "evidence": string,         // which tool flagged it + what you verified
      "suggestedFix": string | null,
      "contextSnippet": string | null  // the relevant code you read, if any
    }
  ]
}
Include one entry per finding id you were given. Do not invent findingIds. Respond with ONLY the JSON.`;

function extractText(content: MessageParam["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // Tolerate ```json fences or leading prose.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in model output");
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Asks the model for the final report and validates it with Zod plus semantic
 * checks (every findingId is known, no duplicates). On failure, feeds the
 * errors back and retries up to maxOutputValidationRetries.
 */
export async function generateValidatedReport(
  client: Anthropic,
  transcript: MessageParam[],
  knownFindingIds: Set<string>,
  metrics: MetricsCollector
): Promise<AuditReportModelOutput> {
  const messages: MessageParam[] = [
    ...transcript,
    { role: "user", content: REPORT_INSTRUCTION },
  ];

  let lastIssues: unknown = null;

  for (let attempt = 0; attempt < CONFIG.maxOutputValidationRetries; attempt++) {
    const res = await client.messages.create({
      model: CONFIG.model,
      max_tokens: 8192,
      messages,
    });
    metrics.recordUsage(res.usage);
    const text = extractText(res.content);
    messages.push({ role: "assistant", content: res.content });

    let parsed: AuditReportModelOutput;
    try {
      const json = extractJson(text);
      const result = AuditReportSchema.safeParse(json);
      if (!result.success) {
        lastIssues = result.error.issues;
        throw new z.ZodError(result.error.issues);
      }
      parsed = result.data;

      // Semantic checks the JSON schema can't express.
      const semanticErrors: string[] = [];
      const seen = new Set<string>();
      for (const f of parsed.findings) {
        if (!knownFindingIds.has(f.findingId)) {
          semanticErrors.push(`Unknown findingId "${f.findingId}" — not in the provided list.`);
        }
        if (seen.has(f.findingId)) {
          semanticErrors.push(`Duplicate findingId "${f.findingId}".`);
        }
        seen.add(f.findingId);
      }
      if (semanticErrors.length > 0) {
        lastIssues = semanticErrors;
        throw new Error(semanticErrors.join(" "));
      }

      return parsed;
    } catch (err) {
      const detail = err instanceof z.ZodError ? JSON.stringify(err.issues) : String(err);
      messages.push({
        role: "user",
        content: `Your previous output was invalid: ${detail}\n\n${REPORT_INSTRUCTION}`,
      });
    }
  }

  throw new ReportValidationError(
    "Model failed to produce a valid report after retries",
    lastIssues
  );
}
