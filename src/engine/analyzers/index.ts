import type { Finding, RepoProfile, Severity } from "../types";
import { detectCapabilities } from "../config";
import { semgrepAnalyzer } from "./semgrep";
import { npmAdvisoriesAnalyzer } from "./npmAdvisories";
import { secretScanAnalyzer } from "./secretScan";
import { eslintAnalyzer } from "./eslint";
import type { Analyzer } from "./types";

/**
 * Analyzers that need no binaries — the only ones that can run on Vercel.
 * `npm-audit` is in here because it now calls the registry's advisory endpoint
 * over HTTP instead of shelling out to the npm CLI.
 */
const JS_ANALYZERS: Analyzer[] = [npmAdvisoriesAnalyzer, secretScanAnalyzer, eslintAnalyzer];

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export interface ScanResult {
  findings: Finding[];
  /** Analyzers that actually ran, for honest reporting in the UI. */
  toolsRun: string[];
  /** Analyzers unavailable in this environment (e.g. Semgrep on serverless). */
  toolsSkipped: string[];
}

/**
 * Picks the analyzer set this environment can support. Semgrep joins in only
 * when the binary exists (local/CLI); on Vercel it is skipped and reported as
 * skipped rather than silently omitted — a scan that quietly lost its biggest
 * rule pack would misrepresent the result.
 */
export async function runAnalyzers(repoDir: string, profile: RepoProfile): Promise<ScanResult> {
  const caps = await detectCapabilities();
  const available = caps.semgrep ? [semgrepAnalyzer, ...JS_ANALYZERS] : JS_ANALYZERS;

  const applicable = available.filter((a) => a.isApplicable(profile));
  const settled = await Promise.allSettled(applicable.map((a) => a.run(repoDir, profile)));

  const all: Finding[] = [];
  const toolsRun: string[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      all.push(...result.value);
      toolsRun.push(applicable[i].name);
    }
  });

  const seen = new Set<string>();
  const deduped = all.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
  deduped.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const toolsSkipped = caps.semgrep ? [] : ["semgrep"];
  return { findings: deduped, toolsRun: [...new Set(toolsRun)], toolsSkipped };
}

/** Back-compat wrapper for the CLI harness, which only wants the findings. */
export async function runAllAnalyzers(
  repoDir: string,
  profile: RepoProfile
): Promise<Finding[]> {
  return (await runAnalyzers(repoDir, profile)).findings;
}
