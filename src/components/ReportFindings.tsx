"use client";

import { useMemo, useState } from "react";
import type { VerifiedFinding, RepoMeta, Severity, Verdict } from "@/engine/types";
import { FocusFindings } from "./FocusFindings";

const SEVERITIES: Severity[] = ["high", "medium", "low"];
const VERDICTS: Verdict[] = ["confirmed", "needs_review", "false_positive", "unverified"];
const VERDICT_LABEL: Record<Verdict, string> = {
  confirmed: "confirmed",
  needs_review: "needs review",
  false_positive: "false positive",
  unverified: "unverified",
};

function count<K extends keyof VerifiedFinding>(
  items: VerifiedFinding[],
  key: K,
  val: VerifiedFinding[K]
): number {
  return items.filter((i) => i[key] === val).length;
}

export function ReportFindings({
  findings,
  repo,
}: {
  findings: VerifiedFinding[];
  repo: RepoMeta;
}) {
  const [sev, setSev] = useState<Severity | "all">("all");
  const [verdict, setVerdict] = useState<Verdict | "all">("all");

  const sevCounts = useMemo(
    () => SEVERITIES.map((s) => ({ s, n: count(findings, "severity", s) })),
    [findings]
  );
  const verdictCounts = useMemo(
    () => VERDICTS.map((v) => ({ v, n: count(findings, "verdict", v) })).filter((x) => x.n > 0),
    [findings]
  );

  const filtered = useMemo(
    () =>
      findings.filter(
        (f) => (sev === "all" || f.severity === sev) && (verdict === "all" || f.verdict === verdict)
      ),
    [findings, sev, verdict]
  );

  const total = findings.length;
  const confirmed = count(findings, "verdict", "confirmed");
  const dismissed = count(findings, "verdict", "false_positive");

  return (
    <div className="space-y-6">
      {/* Overview */}
      <div className="aa-panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <span className="text-3xl font-bold tracking-tight">{total}</span>
            <span className="ml-2 text-sm text-[var(--text-muted)]">findings</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span className="text-[var(--high)]">{confirmed} confirmed</span>
            <span className="text-[var(--text-faint)]">·</span>
            <span className="text-[var(--good)]">{dismissed} dismissed</span>
          </div>
        </div>

        {/* Severity distribution bar */}
        <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
          {sevCounts.map(
            ({ s, n }) =>
              n > 0 && (
                <div key={s} className={`bg-${s}`} style={{ width: `${(n / total) * 100}%` }} title={`${n} ${s}`} />
              )
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--text-muted)]">
          {sevCounts.map(({ s, n }) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={`aa-dot bg-${s}`} />
              {n} {s}
            </span>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-xs uppercase tracking-wider text-[var(--text-faint)]">Severity</span>
          <FilterPill active={sev === "all"} onClick={() => setSev("all")}>
            all
          </FilterPill>
          {sevCounts.map(({ s, n }) => (
            <FilterPill key={s} active={sev === s} disabled={n === 0} onClick={() => setSev(s)}>
              {s} <span className="opacity-60">{n}</span>
            </FilterPill>
          ))}
        </div>
        {verdictCounts.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs uppercase tracking-wider text-[var(--text-faint)]">Verdict</span>
            <FilterPill active={verdict === "all"} onClick={() => setVerdict("all")}>
              all
            </FilterPill>
            {verdictCounts.map(({ v, n }) => (
              <FilterPill key={v} active={verdict === v} onClick={() => setVerdict(v)}>
                {VERDICT_LABEL[v]} <span className="opacity-60">{n}</span>
              </FilterPill>
            ))}
          </div>
        )}
      </div>

      {/* One-at-a-time focus scroll */}
      {filtered.length === 0 ? (
        <p className="aa-panel p-4 text-[var(--text-faint)]">No findings match these filters.</p>
      ) : (
        <FocusFindings key={`${sev}-${verdict}`} findings={filtered} repo={repo} />
      )}
    </div>
  );
}

function FilterPill({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-active={active}
      className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs capitalize text-[var(--text-muted)] transition-colors data-[active=true]:border-[var(--accent)] data-[active=true]:bg-[var(--surface-2)] data-[active=true]:text-[var(--text)] disabled:opacity-30"
    >
      {children}
    </button>
  );
}
