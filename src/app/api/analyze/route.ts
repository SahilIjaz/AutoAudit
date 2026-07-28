import { NextResponse } from "next/server";
import { z } from "zod";
import { getJobStore } from "@/engine/jobs/jobStore";
import { runAnalysis } from "@/engine/index";
import { parseGitHubUrl, RepoUrlError } from "@/engine/git/cloneRepo";

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({ repoUrl: z.string() });

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "repoUrl is required" }, { status: 400 });
  }

  const repoUrl = parsed.data.repoUrl.trim();
  if (repoUrl.startsWith("http")) {
    try {
      parseGitHubUrl(repoUrl);
    } catch (err) {
      if (err instanceof RepoUrlError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  const store = getJobStore();
  const job = store.create({ repoUrl, mode: "grounded" });

  // Fire and forget — the polling endpoint reports progress.
  void runAnalysis(repoUrl, job.id, store).catch((err) => {
    store.update(job.id, { error: String(err) });
    store.appendEvent(job.id, "error", String(err));
  });

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
