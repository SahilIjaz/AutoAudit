import { NextResponse } from "next/server";
import { z } from "zod";
import { isEmailEnabled } from "@/engine/config";
import { checkEmailRateLimit } from "@/engine/notify/rateLimit";
import { parseGitHubUrl, RepoUrlError } from "@/engine/git/cloneRepo";

const bodySchema = z.object({
  repoUrl: z.string(),
  // Blank means "don't email me" — the field is optional in the form.
  email: z.union([z.email(), z.literal("")]).optional(),
});

export interface ParsedAnalyzeRequest {
  repoUrl: string;
  email?: string;
}

/**
 * Shared body handling for /api/analyze and /api/compare. Email problems are
 * rejected here rather than at send time: the run takes minutes, and a user who
 * asked for mail and then closed the tab would never learn it failed.
 */
export async function parseAnalyzeRequest(
  req: Request
): Promise<{ data: ParsedAnalyzeRequest } | { error: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const badEmail = parsed.error.issues.some((i) => i.path[0] === "email");
    return {
      error: NextResponse.json(
        { error: badEmail ? "That email address doesn't look valid." : "repoUrl is required" },
        { status: 400 }
      ),
    };
  }

  const repoUrl = parsed.data.repoUrl.trim();
  if (repoUrl.startsWith("http")) {
    try {
      parseGitHubUrl(repoUrl);
    } catch (err) {
      if (err instanceof RepoUrlError) {
        return { error: NextResponse.json({ error: err.message }, { status: 400 }) };
      }
      throw err;
    }
  }

  const email = parsed.data.email?.trim() || undefined;
  if (email) {
    if (!isEmailEnabled()) {
      return {
        error: NextResponse.json(
          {
            error:
              "Email delivery isn't configured on this server. Set SMTP_USER and SMTP_PASS in .env.local, or leave the email field empty.",
          },
          { status: 503 }
        ),
      };
    }
    // Peek only — the slot is consumed when the mail is actually sent.
    const limit = checkEmailRateLimit(email, { record: false });
    if (!limit.allowed) {
      const minutes = Math.ceil(limit.retryAfterMs / 60_000);
      return {
        error: NextResponse.json(
          { error: `Too many reports sent to this address. Try again in ${minutes} min.` },
          { status: 429, headers: { "retry-after": String(Math.ceil(limit.retryAfterMs / 1000)) } }
        ),
      };
    }
  }

  return { data: { repoUrl, ...(email ? { email } : {}) } };
}
