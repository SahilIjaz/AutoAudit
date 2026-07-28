import { execa } from "execa";
import path from "node:path";
import { CONFIG } from "../config";
import type { Finding, RepoProfile, Severity, Category } from "../types";
import { findingId, type Analyzer } from "./types";

interface SemgrepResult {
  check_id: string;
  path: string;
  start?: { line?: number };
  end?: { line?: number };
  extra?: {
    message?: string;
    severity?: string;
  };
}

export interface SemgrepOutput {
  results?: SemgrepResult[];
}

const SEVERITY_MAP: Record<string, Severity> = {
  ERROR: "high",
  WARNING: "medium",
  INFO: "low",
};

function categoryFor(checkId: string): Category {
  if (checkId.includes("secret") || checkId.includes("security") || checkId.includes("injection")) {
    return "security";
  }
  return "code-quality";
}

export function normalizeSemgrep(json: SemgrepOutput, repoDir: string): Finding[] {
  const findings: Finding[] = [];
  for (const r of json.results ?? []) {
    const file = path.isAbsolute(r.path) ? path.relative(repoDir, r.path) : r.path;
    const line = r.start?.line ?? null;
    findings.push({
      id: findingId("semgrep", r.check_id, file, line),
      tool: "semgrep",
      ruleId: r.check_id,
      severity: SEVERITY_MAP[r.extra?.severity ?? ""] ?? "medium",
      category: categoryFor(r.check_id),
      file,
      line,
      endLine: r.end?.line ?? null,
      message: r.extra?.message ?? r.check_id,
    });
  }
  return findings;
}

export async function runSemgrep(repoDir: string): Promise<Finding[]> {
  // Semgrep exits non-zero when findings exist — parse stdout regardless.
  const result = await execa(
    "semgrep",
    [
      "scan",
      "--config", "p/security-audit",
      "--config", "p/secrets",
      "--json",
      "--quiet",
      "--timeout", "30",
      "--metrics", "off",
      ".",
    ],
    { cwd: repoDir, timeout: CONFIG.subprocessTimeoutMs, reject: false }
  );
  if (!result.stdout) {
    throw new Error(`semgrep produced no output: ${result.stderr?.slice(0, 500)}`);
  }
  const json = JSON.parse(result.stdout) as SemgrepOutput;
  return normalizeSemgrep(json, repoDir);
}

export const semgrepAnalyzer: Analyzer = {
  name: "semgrep",
  isApplicable: () => true,
  async run(repoDir) {
    try {
      return await runSemgrep(repoDir);
    } catch (err) {
      console.error("[autoaudit] semgrep failed:", err);
      return [];
    }
  },
};
