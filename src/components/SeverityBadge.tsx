import type { Severity, Verdict } from "@/engine/types";

const SEVERITY_STYLES: Record<Severity, string> = {
  high: "bg-red-950 text-red-300 border-red-800",
  medium: "bg-amber-950 text-amber-300 border-amber-800",
  low: "bg-slate-800 text-slate-300 border-slate-600",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`rounded border px-2 py-0.5 text-xs font-medium uppercase ${SEVERITY_STYLES[severity]}`}>
      {severity}
    </span>
  );
}

const VERDICT_STYLES: Record<Verdict, string> = {
  confirmed: "bg-red-900 text-red-200",
  false_positive: "bg-green-900 text-green-200",
  needs_review: "bg-amber-900 text-amber-200",
  unverified: "bg-neutral-800 text-neutral-400",
};

const VERDICT_LABEL: Record<Verdict, string> = {
  confirmed: "confirmed",
  false_positive: "false positive",
  needs_review: "needs review",
  unverified: "unverified",
};

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${VERDICT_STYLES[verdict]}`}>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}
