"use client";

import { useCallback, useRef, useState } from "react";
import type {
  AnalysisMetrics,
  AuditReport,
  EmailStatus,
  Finding,
  RepoMeta,
  VerifiedFinding,
} from "@/engine/types";
import { RepoForm, type AuditRequest } from "./RepoForm";
import { ReportFindings } from "./ReportFindings";
import { MetricsPanel } from "./MetricsPanel";

/**
 * Drives the audit from the browser.
 *
 * A hosted serverless function can't hold a multi-minute job, so the run is a
 * sequence of short requests — scan, then one verify call per batch of findings,
 * then finalize — with the state living here between calls. No server-side job
 * store, no database, and the progress the user sees is genuine rather than a
 * spinner over an opaque wait.
 *
 * Findings are signed by /api/scan and passed straight back, so the server can
 * still guarantee the agent only ever triages what the tools actually produced.
 */

type SignedFinding = Finding & { sig: string };

interface ScanResponse {
  repo: RepoMeta;
  findings: SignedFinding[];
  skippedFindings: VerifiedFinding[];
  toolsRun: string[];
  toolsSkipped: string[];
  metrics: AnalysisMetrics;
  batchSize: number;
}

type Stage =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "verifying"; done: number; total: number }
  | { kind: "summarizing" }
  | { kind: "done" }
  | { kind: "error"; message: string };

const EMPTY_METRICS: AnalysisMetrics = {
  model: "",
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  estimatedCostUsd: 0,
  apiCalls: 0,
  toolCalls: {},
  wallTimeMs: {},
};

/** Local copy of the engine's merge — importing the engine would pull execa into the bundle. */
function mergeMetrics(parts: AnalysisMetrics[]): AnalysisMetrics {
  const total: AnalysisMetrics = { ...EMPTY_METRICS, toolCalls: {}, wallTimeMs: {} };
  for (const p of parts) {
    total.model = p.model || total.model;
    total.inputTokens += p.inputTokens;
    total.outputTokens += p.outputTokens;
    total.cacheReadTokens += p.cacheReadTokens;
    total.cacheWriteTokens += p.cacheWriteTokens;
    total.estimatedCostUsd += p.estimatedCostUsd;
    total.apiCalls += p.apiCalls;
    for (const [k, v] of Object.entries(p.toolCalls)) {
      total.toolCalls[k] = (total.toolCalls[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(p.wallTimeMs)) {
      total.wallTimeMs[k] = (total.wallTimeMs[k] ?? 0) + v;
    }
  }
  total.estimatedCostUsd = Number(total.estimatedCostUsd.toFixed(6));
  return total;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A batch that failed still has to appear, honestly labelled, not vanish. */
function asUnverified(f: SignedFinding, reason: string): VerifiedFinding {
  return {
    findingId: f.id,
    verdict: "unverified",
    severity: f.severity,
    category: f.category,
    file: f.file,
    line: f.line,
    title: f.message.slice(0, 80),
    explanation: `This finding could not be verified: ${reason}`,
    evidence: `Flagged by ${f.tool} (${f.ruleId}).`,
    suggestedFix: null,
    contextSnippet: null,
    plainTitle: f.message.slice(0, 72),
    plainImpact: "We couldn't check this one, so we don't know if it's a real problem.",
    plainFix: null,
  };
}

export function AuditRunner({ emailEnabled }: { emailEnabled: boolean }) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [report, setReport] = useState<AuditReport | null>(null);
  const [tools, setTools] = useState<{ run: string[]; skipped: string[] }>({ run: [], skipped: [] });
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
  const running = useRef(false);

  const start = useCallback(async (req: AuditRequest) => {
    if (running.current) return;
    running.current = true;
    setReport(null);
    setEmailStatus(null);
    setStage({ kind: "scanning" });

    try {
      const scan = await postJson<ScanResponse>("/api/scan", { repoUrl: req.repoUrl });
      setTools({ run: scan.toolsRun, skipped: scan.toolsSkipped });

      const batches = chunk(scan.findings, Math.max(1, scan.batchSize));
      const verified: VerifiedFinding[] = [];
      const metricParts: AnalysisMetrics[] = [scan.metrics];

      setStage({ kind: "verifying", done: 0, total: scan.findings.length });

      // Sequential on purpose: parallel batches would multiply peak token spend
      // and give the user a progress bar that jumps rather than advances.
      for (const batch of batches) {
        try {
          const res = await postJson<{ verified: VerifiedFinding[]; metrics: AnalysisMetrics }>(
            "/api/verify",
            { repoUrl: req.repoUrl, sha: scan.repo.headSha, findings: batch }
          );
          verified.push(...res.verified);
          metricParts.push(res.metrics);
        } catch (err) {
          verified.push(...batch.map((f) => asUnverified(f, (err as Error).message)));
        }
        setStage({ kind: "verifying", done: verified.length, total: scan.findings.length });
      }

      setStage({ kind: "summarizing" });
      const finalized = await postJson<{ report: AuditReport; emailStatus?: EmailStatus }>(
        "/api/finalize",
        {
          repo: scan.repo,
          findings: [...verified, ...scan.skippedFindings],
          metrics: mergeMetrics(metricParts),
          ...(req.email ? { email: req.email } : {}),
        }
      );

      setReport(finalized.report);
      setEmailStatus(finalized.emailStatus ?? null);
      setStage({ kind: "done" });
    } catch (err) {
      setStage({ kind: "error", message: (err as Error).message });
    } finally {
      running.current = false;
    }
  }, []);

  const busy =
    stage.kind === "scanning" || stage.kind === "verifying" || stage.kind === "summarizing";

  return (
    <div className="space-y-8">
      <div className="aa-panel relative p-6 sm:p-7">
        <RepoForm onStart={start} busy={busy} emailEnabled={emailEnabled} />
        {!busy && stage.kind !== "done" && (
          <p className="mt-4 text-xs text-[var(--text-faint)]">
            Paste any public GitHub repository. It downloads the code, scans it, and an agent
            triages every finding.
          </p>
        )}
      </div>

      {busy && <Progress stage={stage} />}

      {stage.kind === "error" && (
        <div className="rounded-2xl border border-[rgba(255,107,107,0.3)] bg-[var(--high-dim)] p-5">
          <p className="font-medium text-[var(--high)]">Analysis failed</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{stage.message}</p>
        </div>
      )}

      {emailStatus && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            emailStatus.sent
              ? "border-[rgba(74,222,128,0.3)] bg-[var(--good-dim)]"
              : "border-[rgba(255,180,77,0.3)] bg-[var(--medium-dim)]"
          }`}
        >
          {emailStatus.sent ? (
            <>
              <span className="text-[var(--good)]">✓</span> Report emailed to{" "}
              <span className="font-medium">{emailStatus.to}</span>.
            </>
          ) : (
            <>
              <span className="text-[var(--medium)]">!</span> Couldn&apos;t email the report
              {emailStatus.reason ? ` — ${emailStatus.reason}` : ""}. It&apos;s below.
            </>
          )}
        </div>
      )}

      {report && (
        <div className="aa-fade-up space-y-8">
          <div className="aa-panel p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              In short
            </h2>
            <p className="mt-2 leading-relaxed text-[var(--text)]">{report.summary}</p>
          </div>

          {report.findings.length === 0 ? (
            <p className="aa-panel p-4 text-[var(--text-faint)]">
              Nothing to report — the scanners raised no flags.
            </p>
          ) : (
            <ReportFindings findings={report.findings} repo={report.repo} />
          )}

          <ToolNote run={tools.run} skipped={tools.skipped} />
          <MetricsPanel metrics={report.metrics} />
        </div>
      )}
    </div>
  );
}

const STEP_LABELS = ["Downloading code", "Scanning", "Verifying findings", "Writing the summary"];

function Progress({ stage }: { stage: Stage }) {
  const current =
    stage.kind === "scanning" ? 1 : stage.kind === "verifying" ? 2 : stage.kind === "summarizing" ? 3 : 0;
  const pct =
    stage.kind === "verifying" && stage.total > 0
      ? Math.round((stage.done / stage.total) * 100)
      : null;

  return (
    <div className="aa-panel p-6">
      <ol className="space-y-3">
        {STEP_LABELS.map((label, i) => {
          const state = i < current ? "done" : i === current ? "active" : "pending";
          return (
            <li key={label} className="flex items-center gap-3">
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs ${
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
                {label}
                {i === 2 && stage.kind === "verifying" && stage.total > 0 && (
                  <span className="ml-2 font-mono text-xs text-[var(--text-faint)]">
                    {stage.done}/{stage.total}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {pct !== null && (
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <p className="mt-4 text-xs text-[var(--text-faint)]">
        Each finding is verified by an agent that reads the actual code, so this takes a couple of
        minutes. Keep this tab open.
      </p>
    </div>
  );
}

const TOOL_LABEL: Record<string, string> = {
  "npm-audit": "npm advisories",
  "secret-scan": "secret scanner",
  eslint: "ESLint security rules",
  semgrep: "Semgrep",
};

/**
 * Says which scanners actually ran. A hosted run has no Semgrep, and quietly
 * omitting that would overstate the coverage of the result.
 */
function ToolNote({ run, skipped }: { run: string[]; skipped: string[] }) {
  if (run.length === 0 && skipped.length === 0) return null;
  return (
    <p className="text-xs leading-relaxed text-[var(--text-faint)]">
      Findings came from {run.map((t) => TOOL_LABEL[t] ?? t).join(", ") || "no scanners"}, then an
      agent read the code to confirm or dismiss each one.
      {skipped.length > 0 && (
        <>
          {" "}
          {skipped.map((t) => TOOL_LABEL[t] ?? t).join(", ")} can&apos;t run on this hosted
          deployment (it needs a system binary), so coverage here is narrower than a local run.
        </>
      )}
    </p>
  );
}
