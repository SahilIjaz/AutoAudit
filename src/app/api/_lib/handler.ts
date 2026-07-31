import { NextResponse } from "next/server";
import { z } from "zod";
import { RepoUrlError, RepoNotFoundError, RepoTooLargeError, CloneTimeoutError } from "@/engine/git/cloneRepo";
import { UnsupportedRepoError } from "@/engine/profile/stackProfiler";
import { FindingsTamperedError } from "@/engine/serverless/sign";

/**
 * Shared request plumbing for the stateless audit endpoints. Maps engine errors
 * to status codes in one place so each route stays a thin adapter.
 */
export async function readBody<T extends z.ZodType>(
  req: Request,
  schema: T
): Promise<{ data: z.infer<T> } | { error: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: NextResponse.json(
        { error: "Invalid request", issues: parsed.error.issues },
        { status: 400 }
      ),
    };
  }
  return { data: parsed.data };
}

export function errorResponse(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);

  if (err instanceof RepoUrlError) return NextResponse.json({ error: message }, { status: 400 });
  if (err instanceof RepoNotFoundError) return NextResponse.json({ error: message }, { status: 404 });
  if (err instanceof RepoTooLargeError) return NextResponse.json({ error: message }, { status: 413 });
  if (err instanceof CloneTimeoutError) return NextResponse.json({ error: message }, { status: 504 });
  if (err instanceof UnsupportedRepoError) return NextResponse.json({ error: message }, { status: 422 });
  // A bad signature means the client altered findings — refuse, don't triage.
  if (err instanceof FindingsTamperedError) return NextResponse.json({ error: message }, { status: 403 });

  console.error("[autoaudit] request failed:", err);
  return NextResponse.json({ error: message }, { status: 500 });
}
