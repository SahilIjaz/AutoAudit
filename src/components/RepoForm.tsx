"use client";

import { useState } from "react";

export interface AuditRequest {
  repoUrl: string;
  email?: string;
}

/**
 * Presentational only. The audit itself is driven by AuditRunner, because on
 * serverless it takes several short requests rather than one long one.
 */
export function RepoForm({
  onStart,
  busy,
  emailEnabled,
}: {
  onStart: (req: AuditRequest) => void;
  busy: boolean;
  emailEnabled: boolean;
}) {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [wantEmail, setWantEmail] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || busy) return;
    onStart({
      repoUrl: url.trim(),
      ...(wantEmail && email.trim() ? { email: email.trim() } : {}),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-faint)]">
          ⌥
        </span>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          className="aa-input !pl-11 font-mono text-sm"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
      </div>

      {emailEnabled && (
        <div>
          {wantEmail ? (
            <div className="aa-fade-up">
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-faint)]">
                  @
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="aa-input !pl-11 text-sm"
                  autoComplete="email"
                  spellCheck={false}
                  disabled={busy}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 text-xs text-[var(--text-faint)]">
                <span>
                  Emailed when the run finishes — keep this tab open until then.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setWantEmail(false);
                    setEmail("");
                  }}
                  className="text-[var(--text-muted)] underline decoration-dotted transition-colors hover:text-[var(--text)]"
                >
                  no thanks
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setWantEmail(true)}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-40"
            >
              <span aria-hidden>✉</span>
              Email me the report
            </button>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={busy || !url.trim()} className="aa-btn">
          {busy ? (
            <>
              <span className="aa-spin inline-block h-4 w-4 rounded-full border-2 border-[#0a0c12]/40 border-t-[#0a0c12]" />
              Running…
            </>
          ) : (
            <>Analyze →</>
          )}
        </button>
      </div>
    </form>
  );
}
