import { z } from "zod";

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
});

export const AuditReportSchema = z.object({
  // Keep the summary tight — a hard cap the retry loop enforces if the model
  // over-writes. ~40 words ≈ 280 chars; 320 leaves a little headroom.
  summary: z.string().max(320, "summary must be concise (≤ 320 characters, ~40 words)"),
  findings: z.array(VerifiedFindingSchema),
});

export type AuditReportModelOutput = z.infer<typeof AuditReportSchema>;
