import { NextResponse } from "next/server";
import { getJobStore } from "@/engine/jobs/jobStore";
import { runComparison } from "@/engine/index";
import { parseAnalyzeRequest } from "../_lib/analyzeRequest";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  const parsed = await parseAnalyzeRequest(req);
  if ("error" in parsed) return parsed.error;
  const { repoUrl, email } = parsed.data;

  const store = getJobStore();
  const job = store.create({ repoUrl, mode: "compare", email });

  void runComparison(repoUrl, job.id, store, { email }).catch((err) => {
    store.update(job.id, { error: String(err) });
    store.appendEvent(job.id, "error", String(err));
  });

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
