import { z } from "zod";
import type { VerifiedFinding } from "../types";

/** Hard caps for the plain-language layer — enforced by truncation, not by
 *  rejecting the model's output, so a chatty answer costs no retries. */
export const PLAIN_TITLE_MAX = 72;
export const PLAIN_IMPACT_MAX = 200;
export const PLAIN_FIX_MAX = 160;

export const VerifiedFindingSchema = z.object({
  findingId: z.string(),
  verdict: z.enum(["confirmed", "false_positive", "needs_review", "unverified"]),
  severity: z.enum(["high", "medium", "low"]),
  category: z.enum(["security", "dependency", "code-quality"]),
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  title: z.string(),
  explanation: z.string(),
  evidence: z.string(),
  suggestedFix: z.string().nullable(),
  contextSnippet: z.string().nullable(),
  // Optional on the wire: older/naive outputs omit them and normalizeFinding
  // derives a fallback from the technical fields instead of failing validation.
  plainTitle: z.string().optional(),
  plainImpact: z.string().optional(),
  plainFix: z.string().nullish(),
});

export const AuditReportSchema = z.object({
  // Keep the summary tight — a hard cap the retry loop enforces if the model
  // over-writes. ~40 words ≈ 280 chars; 320 leaves a little headroom.
  summary: z.string().max(320, "summary must be concise (≤ 320 characters, ~40 words)"),
  findings: z.array(VerifiedFindingSchema),
});

/** Serverless verification runs in batches, which produce findings but no summary. */
export const FindingsBatchSchema = z.object({
  findings: z.array(VerifiedFindingSchema),
});

export const SummarySchema = z.object({
  summary: z.string().max(320, "summary must be concise (≤ 320 characters, ~40 words)"),
});

export type AuditReportModelOutput = z.infer<typeof AuditReportSchema>;
export type VerifiedFindingModelOutput = z.infer<typeof VerifiedFindingSchema>;
export type FindingsBatchModelOutput = z.infer<typeof FindingsBatchSchema>;

/** Collapse whitespace and cut at a word boundary, with an ellipsis. */
function clamp(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  const body = space > max * 0.6 ? cut.slice(0, space) : cut;
  return body.replace(/[\s,;:.]+$/, "") + "…";
}

/** First sentence only — used when the model didn't give us a plain field. */
function firstSentence(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  const m = /^(.*?[.!?])(?:\s|$)/.exec(t);
  return m ? m[1] : t;
}

function plain(value: string | null | undefined, fallback: string, max: number): string {
  const source = value && value.trim() ? value : fallback;
  return clamp(source, max);
}

/**
 * Guarantees the plain-language layer exists and is short. The UI renders these
 * fields directly, so nothing here may be undefined or paragraph-length.
 */
export function normalizeFinding(raw: VerifiedFindingModelOutput): VerifiedFinding {
  const fix = raw.plainFix ?? raw.suggestedFix;
  return {
    findingId: raw.findingId,
    verdict: raw.verdict,
    severity: raw.severity,
    category: raw.category,
    file: raw.file,
    line: raw.line,
    title: raw.title,
    explanation: raw.explanation,
    evidence: raw.evidence,
    suggestedFix: raw.suggestedFix,
    contextSnippet: raw.contextSnippet,
    plainTitle: plain(raw.plainTitle, raw.title, PLAIN_TITLE_MAX),
    plainImpact: plain(raw.plainImpact, firstSentence(raw.explanation), PLAIN_IMPACT_MAX),
    plainFix: fix && fix.trim() ? clamp(firstSentence(fix), PLAIN_FIX_MAX) : null,
  };
}
