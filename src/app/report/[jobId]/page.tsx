"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import type { Job } from "@/engine/types";
import { JobProgress } from "@/components/JobProgress";
import { ReportFindings } from "@/components/ReportFindings";

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
    >
      ← New analysis
    </Link>
  );
}

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
        <div className="aa-panel p-6">
          <p className="text-[var(--text-muted)]">Job not found. It may have expired.</p>
          <div className="mt-4">
            <BackLink />
          </div>
        </div>
      </main>
    );
  }

  if (!job) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="flex items-center gap-3 text-[var(--text-muted)]">
          <span className="aa-spin inline-block h-4 w-4 rounded-full border-2 border-[var(--accent)]/30 border-t-[var(--accent)]" />
          Loading…
        </div>
      </main>
    );
  }

  const running = job.phase !== "done" && job.phase !== "error";

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <BackLink />
      <h1 className="mt-5 text-3xl font-bold tracking-tight">Audit report</h1>
      <p className="mt-1.5 inline-block rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1 font-mono text-xs text-[var(--text-muted)]">
        {job.repoUrl}
      </p>

      {running && (
        <div className="aa-panel mt-8 p-6">
          <JobProgress job={job} />
        </div>
      )}

      {job.phase === "error" && (
        <div className="mt-8 rounded-2xl border border-[rgba(255,107,107,0.3)] bg-[var(--high-dim)] p-6">
          <p className="font-medium text-[var(--high)]">Analysis failed</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{job.error}</p>
        </div>
      )}

      {job.report && (
        <div className="mt-8 space-y-8 aa-fade-up">
          <div className="aa-panel p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              Summary
            </h2>
            <p className="mt-2 leading-relaxed text-[var(--text)]">{job.report.summary}</p>
          </div>
          {job.report.findings.length === 0 ? (
            <p className="aa-panel p-4 text-[var(--text-faint)]">No findings.</p>
          ) : (
            <ReportFindings findings={job.report.findings} repo={job.report.repo} />
          )}
        </div>
      )}
    </main>
  );
}
