"use client";

import { useState } from "react";
import type { VerifiedFinding, RepoMeta } from "@/engine/types";
import { SeverityBadge, VerdictChip } from "./SeverityBadge";

function githubLink(repo: RepoMeta, file: string | null, line: number | null): string | null {
  if (!file || !repo.url.startsWith("https://github.com")) return null;
  const base = repo.url.replace(/\.git$/, "").replace(/\/$/, "");
  const anchor = line ? `#L${line}` : "";
  return `${base}/blob/${repo.headSha}/${file}${anchor}`;
}

export function FindingCard({ finding, repo }: { finding: VerifiedFinding; repo: RepoMeta }) {
  const [open, setOpen] = useState(false);
  const link = githubLink(repo, finding.file, finding.line);
  const hasDetails = Boolean(finding.contextSnippet || finding.suggestedFix);

  return (
    <div className="finding-card" data-sev={finding.severity}>
      {/* Frosted surface + drifting severity-tinted blob (behind content) */}
      <div className="finding-bg" />
      <div className="finding-blob" />

      <div className="finding-content p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={finding.severity} />
          <VerdictChip verdict={finding.verdict} />
          <span className="aa-chip v-unverified">{finding.category}</span>
        </div>

        <h3 className="mt-3 font-semibold leading-snug text-[var(--text)]">{finding.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">
          {finding.explanation}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-faint)]">
          {finding.file && (
            <span className="font-mono">
              {finding.file}
              {finding.line ? `:${finding.line}` : ""}
            </span>
          )}
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] transition-opacity hover:opacity-80"
            >
              view on GitHub ↗
            </a>
          )}
          {hasDetails && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            >
              {open ? "▾ hide details" : "▸ show details"}
            </button>
          )}
        </div>

        {open && (
          <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4 text-sm aa-fade-up">
            <p className="text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text)]">Evidence: </span>
              {finding.evidence}
            </p>
            {finding.contextSnippet && <pre className="aa-code">{finding.contextSnippet}</pre>}
            {finding.suggestedFix && (
              <p className="text-[var(--text-muted)]">
                <span className="font-medium text-[var(--good)]">Suggested fix: </span>
                {finding.suggestedFix}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
