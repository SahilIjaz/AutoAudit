"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import type { Job } from "@/engine/types";
import { JobProgress } from "@/components/JobProgress";
import { FindingCard } from "@/components/FindingCard";
import { MetricsPanel } from "@/components/MetricsPanel";

export default function ReportPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const [job, setJob] = useState<Job | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const res = await fetch(`/api/status/${jobId}`);
      if (res.status === 404) {
        if (active) setNotFound(true);
        return;
      }
      const data: Job = await res.json();
      if (!active) return;
      setJob(data);
      if (data.phase !== "done" && data.phase !== "error") {
        setTimeout(poll, 1500);
      }
    };
    poll();
    return () => {
      active = false;
    };
  }, [jobId]);

  if (notFound) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-neutral-400">Job not found. It may have expired.</p>
        <Link href="/" className="mt-4 inline-block text-blue-400 hover:underline">
          ← New analysis
        </Link>
      </main>
    );
  }

  if (!job) {
    return <main className="mx-auto max-w-3xl px-6 py-16 text-neutral-400">Loading…</main>;
  }

  const running = job.phase !== "done" && job.phase !== "error";

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-blue-400 hover:underline">
        ← New analysis
      </Link>
      <h1 className="mt-4 text-2xl font-bold">Audit report</h1>
      <p className="mt-1 font-mono text-sm text-neutral-500">{job.repoUrl}</p>

      {running && (
        <div className="mt-8 rounded-lg border border-neutral-800 bg-neutral-900/40 p-6">
          <JobProgress job={job} />
        </div>
      )}

      {job.phase === "error" && (
        <div className="mt-8 rounded-lg border border-red-900 bg-red-950/40 p-6 text-red-300">
          <p className="font-medium">Analysis failed</p>
          <p className="mt-1 text-sm">{job.error}</p>
        </div>
      )}

      {job.report && (
        <div className="mt-8 space-y-8">
          <MetricsPanel metrics={job.report.metrics} />
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Summary
            </h2>
            <p className="mt-2 text-neutral-200">{job.report.summary}</p>
          </div>
          <div>
            <h2 className="mb-3 text-lg font-semibold">
              Findings ({job.report.findings.length})
            </h2>
            <div className="space-y-3">
              {job.report.findings.map((f) => (
                <FindingCard key={f.findingId} finding={f} repo={job.report!.repo} />
              ))}
              {job.report.findings.length === 0 && (
                <p className="text-neutral-500">No findings.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
