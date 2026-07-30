import type { Severity, Verdict } from "@/engine/types";

/** Everyday wording for the default (simple) view. */
export const SEVERITY_PLAIN: Record<Severity, string> = {
  high: "High risk",
  medium: "Medium risk",
  low: "Low risk",
};

export const VERDICT_PLAIN: Record<Verdict, string> = {
  confirmed: "Real problem",
  false_positive: "Not a problem",
  needs_review: "Needs a look",
  unverified: "Not checked",
};

/** The technical terms — only shown inside the deeper analysis. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  confirmed: "confirmed",
  false_positive: "false positive",
  needs_review: "needs review",
  unverified: "unverified",
};

const VERDICT_ICON: Record<Verdict, string> = {
  confirmed: "●",
  false_positive: "✓",
  needs_review: "◐",
  unverified: "○",
};

export function SeverityBadge({
  severity,
  plain = false,
}: {
  severity: Severity;
  plain?: boolean;
}) {
  return (
    <span className={`aa-chip sev-${severity}${plain ? "" : " uppercase"}`}>
      <span className={`aa-dot bg-${severity}`} />
      {plain ? SEVERITY_PLAIN[severity] : severity}
    </span>
  );
}

export function VerdictChip({ verdict, plain = false }: { verdict: Verdict; plain?: boolean }) {
  return (
    <span className={`aa-chip v-${verdict}`}>
      <span aria-hidden>{VERDICT_ICON[verdict]}</span>
      {plain ? VERDICT_PLAIN[verdict] : VERDICT_LABEL[verdict]}
    </span>
  );
}
