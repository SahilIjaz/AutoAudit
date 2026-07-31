import { NextResponse } from "next/server";
import { z } from "zod";
import { runVerifyBatch } from "@/engine/serverless/steps";
import { CONFIG } from "@/engine/config";
import { readBody, errorResponse } from "../_lib/handler";

export const runtime = "nodejs";
// One batch of findings: a handful of agent turns. Sized to finish well inside this.
export const maxDuration = 60;

const signedFinding = z.object({
  id: z.string(),
  tool: z.enum(["semgrep", "npm-audit", "eslint", "secret-scan"]),
  ruleId: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  category: z.enum(["security", "dependency", "code-quality"]),
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  endLine: z.number().int().nullable().optional(),
  message: z.string(),
  sig: z.string(),
});

const bodySchema = z.object({
  repoUrl: z.string(),
  sha: z.string(),
  // A batch, not a whole run — the client loops. The cap stops a caller from
  // asking for a single huge batch that would blow the function's time limit.
  findings: z.array(signedFinding).min(1).max(CONFIG.verifyBatchSize * 2),
});

export async function POST(req: Request): Promise<Response> {
  const parsed = await readBody(req, bodySchema);
  if ("error" in parsed) return parsed.error;

  try {
    return NextResponse.json(await runVerifyBatch(parsed.data));
  } catch (err) {
    return errorResponse(err);
  }
}
