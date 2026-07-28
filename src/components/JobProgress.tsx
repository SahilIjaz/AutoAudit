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
    <ol className="space-y-2">
      {STEPS.map((step) => {
        const idx = ORDER.indexOf(step.phase);
        const state = idx < currentIdx ? "done" : idx === currentIdx ? "active" : "pending";
        return (
          <li key={step.phase} className="flex items-center gap-3">
            <span
              className={
                state === "done"
                  ? "text-green-400"
                  : state === "active"
                    ? "text-blue-400"
                    : "text-neutral-600"
              }
            >
              {state === "done" ? "✓" : state === "active" ? "⟳" : "○"}
            </span>
            <span className={state === "pending" ? "text-neutral-600" : "text-neutral-200"}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
