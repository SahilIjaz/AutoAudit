import type { Finding, RepoProfile, Severity } from "../types";
import { semgrepAnalyzer } from "./semgrep";
import { npmAuditAnalyzer } from "./npmAudit";
import { eslintAnalyzer } from "./eslint";
import type { Analyzer } from "./types";

const ANALYZERS: Analyzer[] = [semgrepAnalyzer, npmAuditAnalyzer, eslintAnalyzer];

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export async function runAllAnalyzers(
  repoDir: string,
  profile: RepoProfile
): Promise<Finding[]> {
  const applicable = ANALYZERS.filter((a) => a.isApplicable(profile));
  const settled = await Promise.allSettled(applicable.map((a) => a.run(repoDir, profile)));

  const all: Finding[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") all.push(...result.value);
  }

  const seen = new Set<string>();
  const deduped = all.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });

  deduped.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return deduped;
}
