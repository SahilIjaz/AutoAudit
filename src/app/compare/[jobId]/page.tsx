"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import type { Job } from "@/engine/types";
import { JobProgress } from "@/components/JobProgress";
import { ComparePanel } from "@/components/ComparePanel";

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

export default function ComparePage({ params }: { params: Promise<{ jobId: string }> }) {
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
      <main className="mx-auto max-w-4xl px-6 py-16">
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
      <main className="mx-auto max-w-4xl px-6 py-16">
        <div className="flex items-center gap-3 text-[var(--text-muted)]">
          <span className="aa-spin inline-block h-4 w-4 rounded-full border-2 border-[var(--accent)]/30 border-t-[var(--accent)]" />
          Loading…
        </div>
      </main>
    );
  }

  const running = job.phase !== "done" && job.phase !== "error";

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <BackLink />
      <h1 className="mt-5 text-3xl font-bold tracking-tight">
        Grounded <span className="text-[var(--text-faint)]">vs.</span> naive
      </h1>
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
          <p className="font-medium text-[var(--high)]">Comparison failed</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{job.error}</p>
        </div>
      )}

      {job.compareResult && (
        <div className="mt-8 aa-fade-up">
          <ComparePanel result={job.compareResult} />
        </div>
      )}
    </main>
  );
}
