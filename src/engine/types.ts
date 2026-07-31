export type Severity = "high" | "medium" | "low";
export type Category = "security" | "dependency" | "code-quality";

export interface Finding {
  /** Stable id: `${tool}:${ruleId}:${file}:${line}` */
  id: string;
  tool: "semgrep" | "npm-audit" | "eslint" | "secret-scan";
  ruleId: string;
  severity: Severity;
  category: Category;
  /** Repo-relative path; null for dependency findings */
  file: string | null;
  line: number | null;
  endLine?: number | null;
  message: string;
}

export interface RepoProfile {
  owner: string;
  repo: string;
  headSha: string;
  defaultBranch: string;
  /** extension -> file count */
  languages: Record<string, number>;
  fileCount: number;
  totalBytes: number;
  hasPackageJson: boolean;
  packageManager: "npm" | "yarn" | "pnpm" | null;
  entryPoints: string[];
  /** repo-relative paths of files > 500 KB, excluded from agent reads */
  largeFiles: string[];
  frameworks: string[];
}

export interface AnalysisMetrics {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number;
  apiCalls: number;
  /** tool name -> call count */
  toolCalls: Record<string, number>;
  /** phase name -> wall time ms */
  wallTimeMs: Record<string, number>;
}

export interface RepoMeta {
  owner: string;
  repo: string;
  headSha: string;
  defaultBranch: string;
  url: string;
}

export type Verdict = "confirmed" | "false_positive" | "needs_review" | "unverified";

export interface VerifiedFinding {
  findingId: string;
  verdict: Verdict;
  severity: Severity;
  category: Category;
  file: string | null;
  line: number | null;
  title: string;
  explanation: string;
  evidence: string;
  suggestedFix: string | null;
  contextSnippet: string | null;

  /* ---- Plain-language layer: everything the UI shows by default ----
     Short, jargon-free, one idea each. The technical fields above are only
     revealed when the reader asks for the deeper analysis. */

  /** Jargon-free headline, ≤ 72 chars. */
  plainTitle: string;
  /** One sentence: what could go wrong, in everyday words. */
  plainImpact: string;
  /** One short instruction: what to do about it. Null if there's nothing to do. */
  plainFix: string | null;
}

export interface AuditReport {
  summary: string;
  findings: VerifiedFinding[];
  repo: RepoMeta;
  metrics: AnalysisMetrics;
  /** raw tool findings, for the UI to show what tools reported pre-triage */
  rawFindings: Finding[];
}

export interface CompareResult {
  grounded: AuditReport;
  naive: {
    summary: string;
    findings: VerifiedFinding[];
    metrics: AnalysisMetrics;
  };
}

/** Outcome of the optional "email me the report" step, surfaced in the UI. */
export interface EmailStatus {
  to: string;
  sent: boolean;
  reason?: string;
}

