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

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/60">
      <div className="flex items-start gap-3 p-4">
        <div className="flex flex-col items-start gap-1">
          <SeverityBadge severity={finding.severity} />
          <VerdictChip verdict={finding.verdict} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-neutral-100">{finding.title}</h3>
          <p className="mt-1 text-sm text-neutral-400">{finding.explanation}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
            <span className="rounded bg-neutral-800 px-1.5 py-0.5">{finding.category}</span>
            {finding.file && (
              <span className="font-mono">
                {finding.file}
                {finding.line ? `:${finding.line}` : ""}
              </span>
            )}
            {link && (
              <a href={link} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                view on GitHub ↗
              </a>
            )}
          </div>
          {(finding.contextSnippet || finding.suggestedFix) && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="mt-2 text-xs text-neutral-400 hover:text-neutral-200"
            >
              {open ? "▾ hide details" : "▸ show details"}
            </button>
          )}
          {open && (
            <div className="mt-2 space-y-3 text-sm">
              <p className="text-neutral-500">
                <span className="font-medium text-neutral-400">Evidence: </span>
                {finding.evidence}
              </p>
              {finding.contextSnippet && (
                <pre className="overflow-x-auto rounded bg-black/50 p-3 font-mono text-xs text-neutral-300">
                  {finding.contextSnippet}
                </pre>
              )}
              {finding.suggestedFix && (
                <p className="text-neutral-400">
                  <span className="font-medium">Suggested fix: </span>
                  {finding.suggestedFix}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
