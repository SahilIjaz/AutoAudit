"use client";

import { useMemo, useState } from "react";
import type { VerifiedFinding, RepoMeta, Severity, Verdict } from "@/engine/types";
import { FocusFindings } from "./FocusFindings";
import { SEVERITY_PLAIN, VERDICT_PLAIN, VERDICT_LABEL } from "./SeverityBadge";

const SEVERITIES: Severity[] = ["high", "medium", "low"];
const VERDICTS: Verdict[] = ["confirmed", "needs_review", "false_positive", "unverified"];

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
  const [deep, setDeep] = useState(false);

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
  const real = count(findings, "verdict", "confirmed");
  const dismissed = count(findings, "verdict", "false_positive");

  return (
    <div className="space-y-6">
      {/* Overview — one plain sentence, then the bar */}
      <div className="aa-panel p-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-3xl font-bold tracking-tight">{real}</span>
          <span className="text-[var(--text-muted)]">
            {real === 1 ? "real problem" : "real problems"} worth fixing
          </span>
        </div>
        <p className="mt-1.5 text-sm text-[var(--text-muted)]">
          We checked {total} {total === 1 ? "flag" : "flags"} raised by the scanners
          {dismissed > 0 && <> and ruled out {dismissed} as harmless</>}.
        </p>

        {/* Risk mix */}
        <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
          {sevCounts.map(
            ({ s, n }) =>
              n > 0 && (
                <div
                  key={s}
                  className={`bg-${s}`}
                  style={{ width: `${(n / total) * 100}%` }}
                  title={`${n} ${SEVERITY_PLAIN[s]}`}
                />
              )
          )}
        </div>

        <button
          type="button"
          onClick={() => setDeep((d) => !d)}
          aria-expanded={deep}
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
        >
          <span aria-hidden className={deep ? "rotate-90 transition-transform" : "transition-transform"}>
            ›
          </span>
          {deep ? "Hide the breakdown" : "More depth analysis"}
        </button>

        {deep && (
          <div className="aa-fade-up mt-4 space-y-3 border-t border-[var(--border)] pt-4">
            <div className="flex flex-wrap gap-4 text-xs text-[var(--text-muted)]">
              {sevCounts.map(({ s, n }) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span className={`aa-dot bg-${s}`} />
                  {n} {s}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs uppercase tracking-wider text-[var(--text-faint)]">
                Verdict
              </span>
              <FilterPill active={verdict === "all"} onClick={() => setVerdict("all")}>
                all
              </FilterPill>
              {verdictCounts.map(({ v, n }) => (
                <FilterPill key={v} active={verdict === v} onClick={() => setVerdict(v)}>
                  {VERDICT_LABEL[v]} <span className="opacity-60">{n}</span>
                </FilterPill>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Risk filter — plain wording */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs uppercase tracking-wider text-[var(--text-faint)]">Show</span>
        <FilterPill active={sev === "all"} onClick={() => setSev("all")}>
          everything
        </FilterPill>
        {sevCounts.map(({ s, n }) => (
          <FilterPill key={s} active={sev === s} disabled={n === 0} onClick={() => setSev(s)}>
            {SEVERITY_PLAIN[s]} <span className="opacity-60">{n}</span>
          </FilterPill>
        ))}
        {verdict !== "all" && (
          <FilterPill active onClick={() => setVerdict("all")}>
            {VERDICT_PLAIN[verdict]} ✕
          </FilterPill>
        )}
      </div>

      {/* One-at-a-time focus scroll */}
      {filtered.length === 0 ? (
        <p className="aa-panel p-4 text-[var(--text-faint)]">Nothing matches these filters.</p>
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
