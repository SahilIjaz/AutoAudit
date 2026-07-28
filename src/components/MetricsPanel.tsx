import type { AnalysisMetrics } from "@/engine/types";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 font-mono text-lg text-neutral-100">{value}</div>
    </div>
  );
}

export function MetricsPanel({ metrics }: { metrics: AnalysisMetrics }) {
  const totalMs = Object.values(metrics.wallTimeMs).reduce((a, b) => a + b, 0);
  const totalToolCalls = Object.values(metrics.toolCalls).reduce((a, b) => a + b, 0);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Est. cost" value={`$${metrics.estimatedCostUsd.toFixed(4)}`} />
      <Stat label="Tokens in/out" value={`${metrics.inputTokens}/${metrics.outputTokens}`} />
      <Stat label="API calls" value={String(metrics.apiCalls)} />
      <Stat label="Tool calls" value={String(totalToolCalls)} />
      <Stat label="Wall time" value={`${(totalMs / 1000).toFixed(1)}s`} />
      <Stat label="Model" value={metrics.model} />
    </div>
  );
}
