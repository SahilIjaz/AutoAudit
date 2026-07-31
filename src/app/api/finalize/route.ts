import { NextResponse } from "next/server";
import { z } from "zod";
import { runFinalize } from "@/engine/serverless/steps";
import { isEmailEnabled } from "@/engine/config";
import { VerifiedFindingSchema } from "@/engine/output/schema";
import { normalizeFinding } from "@/engine/output/schema";
import { readBody, errorResponse } from "../_lib/handler";

export const runtime = "nodejs";
// One summary call plus an optional SMTP handshake.
export const maxDuration = 60;

const metricsSchema = z.object({
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  estimatedCostUsd: z.number(),
  apiCalls: z.number(),
  toolCalls: z.record(z.string(), z.number()),
  wallTimeMs: z.record(z.string(), z.number()),
});

const bodySchema = z.object({
  repo: z.object({
    owner: z.string(),
    repo: z.string(),
    headSha: z.string(),
    defaultBranch: z.string(),
    url: z.string(),
  }),
  findings: z.array(VerifiedFindingSchema),
  metrics: metricsSchema,
  email: z.union([z.email(), z.literal("")]).optional(),
});

export async function POST(req: Request): Promise<Response> {
  const parsed = await readBody(req, bodySchema);
  if ("error" in parsed) return parsed.error;

  const email = parsed.data.email?.trim() || undefined;
  if (email && !isEmailEnabled()) {
    return NextResponse.json(
      {
        error:
          "Email delivery isn't configured on this deployment. Set SMTP_USER and SMTP_PASS, or run without an email address.",
      },
      { status: 503 }
    );
  }

  try {
    const result = await runFinalize({
      repo: parsed.data.repo,
      // Re-normalized: these round-tripped through the browser, so the plain
      // fields are re-derived rather than trusted to still be present.
      findings: parsed.data.findings.map(normalizeFinding),
      metrics: parsed.data.metrics,
      ...(email ? { email } : {}),
    });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
