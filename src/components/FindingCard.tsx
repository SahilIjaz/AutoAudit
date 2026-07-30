"use client";

import { useState } from "react";
import type { VerifiedFinding, RepoMeta } from "@/engine/types";
import { SeverityBadge, VerdictChip, VERDICT_LABEL } from "./SeverityBadge";

function githubLink(repo: RepoMeta, file: string | null, line: number | null): string | null {
  if (!file || !repo.url.startsWith("https://github.com")) return null;
  const base = repo.url.replace(/\.git$/, "").replace(/\/$/, "");
  const anchor = line ? `#L${line}` : "";
  return `${base}/blob/${repo.headSha}/${file}${anchor}`;
}

/** Just the file name — the full path lives in the deeper analysis. */
function shortLocation(file: string | null, line: number | null): string | null {
  if (!file) return null;
  const name = file.split("/").pop() ?? file;
  return line ? `${name}, line ${line}` : name;
}

function DeepRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[0.68rem] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
        {label}
      </div>
      <div className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">{children}</div>
    </div>
  );
}

/**
 * Two levels of detail. By default a reader sees only the plain-language layer:
 * risk, one-line problem, one-line consequence, one-line fix. Everything
 * technical — paths, rule evidence, code, the agent's reasoning — is collapsed
 * behind "More depth analysis".
 */
export function FindingCard({ finding, repo }: { finding: VerifiedFinding; repo: RepoMeta }) {
  const [deep, setDeep] = useState(false);
  const link = githubLink(repo, finding.file, finding.line);
  const location = shortLocation(finding.file, finding.line);

  return (
    <div className="finding-card" data-sev={finding.severity}>
      {/* Frosted surface + drifting severity-tinted blob (behind content) */}
      <div className="finding-bg" />
      <div className="finding-blob" />

      <div className="finding-content p-4 sm:p-5">
        {/* ---- Simple view: risk + verdict, nothing else ---- */}
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={finding.severity} plain />
          <VerdictChip verdict={finding.verdict} plain />
        </div>

        <h3 className="mt-3 text-lg font-semibold leading-snug text-[var(--text)]">
          {finding.plainTitle}
        </h3>

        <p className="mt-2 leading-relaxed text-[var(--text-muted)]">{finding.plainImpact}</p>

        {finding.plainFix && (
          <div className="mt-3 flex gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3">
            <span className="text-[var(--good)]" aria-hidden>
              →
            </span>
            <p className="text-sm leading-relaxed text-[var(--text)]">
              <span className="font-medium text-[var(--good)]">What to do: </span>
              {finding.plainFix}
            </p>
          </div>
        )}

        {location && (
          <p className="mt-3 text-xs text-[var(--text-faint)]">
            Found in <span className="font-mono text-[var(--text-muted)]">{location}</span>
          </p>
        )}

        {/* ---- The gate ---- */}
        <button
          type="button"
          onClick={() => setDeep((d) => !d)}
          aria-expanded={deep}
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
        >
          <span aria-hidden className={deep ? "rotate-90 transition-transform" : "transition-transform"}>
            ›
          </span>
          {deep ? "Hide depth analysis" : "More depth analysis"}
        </button>

        {/* ---- Deep view: the technical detail ---- */}
        {deep && (
          <div className="aa-fade-up mt-4 space-y-4 border-t border-[var(--border)] pt-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="aa-chip v-unverified">{finding.category}</span>
              <span className="aa-chip v-unverified">severity: {finding.severity}</span>
              <span className="aa-chip v-unverified">verdict: {VERDICT_LABEL[finding.verdict]}</span>
            </div>

            <DeepRow label="Technical issue">{finding.title}</DeepRow>

            {finding.file && (
              <DeepRow label="Location">
                <span className="font-mono text-xs">
                  {finding.file}
                  {finding.line ? `:${finding.line}` : ""}
                </span>
                {link && (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-3 text-xs text-[var(--accent)] transition-opacity hover:opacity-80"
                  >
                    view on GitHub ↗
                  </a>
                )}
              </DeepRow>
            )}

            <DeepRow label="Full analysis">{finding.explanation}</DeepRow>
            <DeepRow label="Evidence">{finding.evidence}</DeepRow>

            {finding.contextSnippet && (
              <DeepRow label="Code">
                <pre className="aa-code mt-0.5">{finding.contextSnippet}</pre>
              </DeepRow>
            )}

            {finding.suggestedFix && <DeepRow label="Suggested fix">{finding.suggestedFix}</DeepRow>}
          </div>
        )}
      </div>
    </div>
  );
}
