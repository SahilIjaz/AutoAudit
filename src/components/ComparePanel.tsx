"use client";

import type { CompareResult, VerifiedFinding, RepoMeta } from "@/engine/types";
import { SeverityBadge, VerdictChip } from "./SeverityBadge";
import { MetricsPanel } from "./MetricsPanel";

function Column({
  title,
  subtitle,
  findings,
  repo,
}: {
  title: string;
  subtitle: string;
  findings: VerifiedFinding[];
  repo?: RepoMeta;
}) {
  return (
    <div className="flex-1">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mb-3 text-sm text-neutral-500">{subtitle}</p>
      <div className="space-y-2">
        {findings.map((f, i) => (
          <div
            key={f.findingId + i}
            className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3"
          >
            <div className="flex items-center gap-2">
              <SeverityBadge severity={f.severity} />
              <VerdictChip verdict={f.verdict} />
            </div>
            <p className="mt-2 text-sm font-medium text-neutral-100">{f.title}</p>
            {f.file && (
              <p className="mt-1 font-mono text-xs text-neutral-500">
                {f.file}
                {f.line ? `:${f.line}` : ""}
              </p>
            )}
            <p className="mt-1 text-xs text-neutral-400">{f.explanation}</p>
          </div>
        ))}
        {findings.length === 0 && <p className="text-sm text-neutral-500">No findings.</p>}
      </div>
    </div>
  );
}

export function ComparePanel({ result }: { result: CompareResult }) {
  const grounded = result.grounded.findings;
  const confirmed = grounded.filter((f) => f.verdict === "confirmed").length;
  const falsePos = grounded.filter((f) => f.verdict === "false_positive").length;

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-300">
        <p>
          The grounded agent verified <strong>{grounded.length}</strong> tool-reported
          findings — confirming <strong>{confirmed}</strong> and marking{" "}
          <strong>{falsePos}</strong> as false positives. The naive prompt reported{" "}
          <strong>{result.naive.findings.length}</strong> findings with no tools and no
          verification. Compare which are grounded in real evidence.
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Grounded cost
        </h3>
        <MetricsPanel metrics={result.grounded.metrics} />
        <h3 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Naive cost
        </h3>
        <MetricsPanel metrics={result.naive.metrics} />
      </div>

      <div className="flex flex-col gap-8 md:flex-row">
        <Column
          title="Grounded agent"
          subtitle="Tool-found, agent-verified"
          findings={grounded}
          repo={result.grounded.repo}
        />
        <Column
          title="Naive LLM"
          subtitle="Just-ask-the-model, unverified"
          findings={result.naive.findings}
        />
      </div>
    </div>
  );
}
