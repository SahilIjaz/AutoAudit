import type { Severity, Verdict } from "@/engine/types";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`aa-chip sev-${severity} uppercase`}>
      <span className={`aa-dot bg-${severity}`} />
      {severity}
    </span>
  );
}

const VERDICT_LABEL: Record<Verdict, string> = {
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

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`aa-chip v-${verdict}`}>
      <span aria-hidden>{VERDICT_ICON[verdict]}</span>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}
