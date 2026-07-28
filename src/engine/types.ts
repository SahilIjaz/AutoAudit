export type Severity = "high" | "medium" | "low";
export type Category = "security" | "dependency" | "code-quality";

export interface Finding {
  /** Stable id: `${tool}:${ruleId}:${file}:${line}` */
  id: string;
  tool: "semgrep" | "npm-audit" | "eslint";
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

export type JobPhase =
  | "queued"
  | "cloning"
  | "profiling"
  | "scanning"
  | "agent"
  | "reporting"
  | "done"
  | "error";

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

export interface Job {
  id: string;
  repoUrl: string;
  mode: "grounded" | "compare";
  phase: JobPhase;
  events: { at: number; phase: JobPhase; note?: string }[];
  report?: AuditReport;
  compareResult?: CompareResult;
  error?: string;
  createdAt: number;
}
