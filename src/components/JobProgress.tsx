import type { Job, JobPhase } from "@/engine/types";

const STEPS: { phase: JobPhase; label: string }[] = [
  { phase: "cloning", label: "Cloning repository" },
  { phase: "profiling", label: "Profiling stack" },
  { phase: "scanning", label: "Running static analysis" },
  { phase: "agent", label: "Agent verifying findings" },
  { phase: "reporting", label: "Generating report" },
  { phase: "done", label: "Done" },
];

const ORDER: JobPhase[] = ["queued", "cloning", "profiling", "scanning", "agent", "reporting", "done"];

export function JobProgress({ job }: { job: Job }) {
  const currentIdx = ORDER.indexOf(job.phase);
  return (
    <ol className="relative space-y-1">
      {STEPS.map((step, i) => {
        const idx = ORDER.indexOf(step.phase);
        const state = idx < currentIdx ? "done" : idx === currentIdx ? "active" : "pending";
        const isLast = i === STEPS.length - 1;
        return (
          <li key={step.phase} className="relative flex items-center gap-3 pb-4 last:pb-0">
            {!isLast && (
              <span
                className={`absolute left-[11px] top-6 h-full w-px ${
                  state === "done" ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                }`}
              />
            )}
            <span
              className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs ${
                state === "done"
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[#0a0c12]"
                  : state === "active"
                    ? "border-[var(--accent)] text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--text-faint)]"
              }`}
            >
              {state === "done" ? (
                "✓"
              ) : state === "active" ? (
                <span className="aa-spin inline-block h-3 w-3 rounded-full border-2 border-[var(--accent)]/30 border-t-[var(--accent)]" />
              ) : (
                "○"
              )}
            </span>
            <span
              className={
                state === "pending"
                  ? "text-sm text-[var(--text-faint)]"
                  : state === "active"
                    ? "text-sm font-medium text-[var(--text)]"
                    : "text-sm text-[var(--text-muted)]"
              }
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
