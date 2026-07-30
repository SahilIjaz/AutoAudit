"use client";

import type { CompareResult, VerifiedFinding, RepoMeta } from "@/engine/types";
import { SeverityBadge, VerdictChip } from "./SeverityBadge";
import { MetricsPanel } from "./MetricsPanel";

function Column({
  title,
  subtitle,
  accent,
  findings,
}: {
  title: string;
  subtitle: string;
  accent: "grounded" | "naive";
  findings: VerifiedFinding[];
  repo?: RepoMeta;
}) {
  return (
    <div className="flex-1">
      <div className="mb-4 flex items-center gap-2.5">
        <span
          className={`aa-dot ${accent === "grounded" ? "bg-[var(--accent)]" : "bg-low"}`}
          style={{ width: 8, height: 8 }}
        />
        <div>
          <h2 className="font-semibold leading-tight">{title}</h2>
          <p className="text-xs text-[var(--text-faint)]">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-2.5">
        {findings.map((f, i) => (
          <div key={f.findingId + i} className="aa-card p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={f.severity} plain />
              <VerdictChip verdict={f.verdict} plain />
            </div>
            <p className="mt-2 text-sm font-medium text-[var(--text)]">{f.plainTitle}</p>
            {f.file && (
              <p className="mt-1 font-mono text-xs text-[var(--text-faint)]">
                {f.file}
                {f.line ? `:${f.line}` : ""}
              </p>
            )}
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{f.plainImpact}</p>
          </div>
        ))}
        {findings.length === 0 && (
          <p className="aa-panel p-4 text-sm text-[var(--text-faint)]">No findings.</p>
        )}
      </div>
    </div>
  );
}

function Highlight({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="aa-card px-4 py-3 text-center">
      <div className="text-2xl font-bold" style={{ color: tone }}>
        {value}
      </div>
      <div className="mt-0.5 text-[0.68rem] uppercase tracking-wider text-[var(--text-faint)]">
        {label}
      </div>
    </div>
  );
}

export function ComparePanel({ result }: { result: CompareResult }) {
  const grounded = result.grounded.findings;
  const confirmed = grounded.filter((f) => f.verdict === "confirmed").length;
  const falsePos = grounded.filter((f) => f.verdict === "false_positive").length;

  return (
    <div className="space-y-10">
      <div className="aa-panel p-5">
        <div className="grid grid-cols-3 gap-3">
          <Highlight value={confirmed} label="Confirmed" tone="var(--high)" />
          <Highlight value={falsePos} label="False positives" tone="var(--good)" />
          <Highlight value={result.naive.findings.length} label="Naive (unverified)" tone="var(--low)" />
        </div>
        <p className="mt-4 text-sm leading-relaxed text-[var(--text-muted)]">
          The grounded agent verified <strong className="text-[var(--text)]">{grounded.length}</strong>{" "}
          tool-reported findings — confirming{" "}
          <strong className="text-[var(--text)]">{confirmed}</strong> and dismissing{" "}
          <strong className="text-[var(--text)]">{falsePos}</strong> as false positives. The naive
          prompt reported <strong className="text-[var(--text)]">{result.naive.findings.length}</strong>{" "}
          findings with no tools and no verification.
        </p>
      </div>

      <div className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
          Grounded cost
        </h3>
        <MetricsPanel metrics={result.grounded.metrics} />
        <h3 className="pt-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
          Naive cost
        </h3>
        <MetricsPanel metrics={result.naive.metrics} />
      </div>

      <div className="flex flex-col gap-8 md:flex-row">
        <Column
          title="Grounded agent"
          subtitle="Tool-found, agent-verified"
          accent="grounded"
          findings={grounded}
          repo={result.grounded.repo}
        />
        <Column
          title="Naive LLM"
          subtitle="Just-ask-the-model, unverified"
          accent="naive"
          findings={result.naive.findings}
        />
      </div>
    </div>
  );
}
