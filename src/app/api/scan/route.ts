import { NextResponse } from "next/server";
import { z } from "zod";
import { runScan } from "@/engine/serverless/steps";
import { parseGitHubUrl } from "@/engine/git/cloneRepo";
import { checkAuditRateLimit } from "@/engine/serverless/rateLimit";
import { readBody, errorResponse } from "../_lib/handler";

export const runtime = "nodejs";
// Download + extract + JS analyzers. Comfortably the fastest of the three steps.
export const maxDuration = 60;

const bodySchema = z.object({ repoUrl: z.string() });

export async function POST(req: Request): Promise<Response> {
  const parsed = await readBody(req, bodySchema);
  if ("error" in parsed) return parsed.error;

  const repoUrl = parsed.data.repoUrl.trim();
  try {
    parseGitHubUrl(repoUrl);
  } catch (err) {
    return errorResponse(err);
  }

  // Only the scan endpoint is metered: it is the entry point of a run, so
  // capping it caps whole audits (and therefore model spend), not requests.
  const limit = checkAuditRateLimit(req);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: limit.message },
      { status: 429, headers: { "retry-after": String(Math.ceil(limit.retryAfterMs / 1000)) } }
    );
  }

  try {
    return NextResponse.json(await runScan(repoUrl));
  } catch (err) {
    return errorResponse(err);
  }
}
