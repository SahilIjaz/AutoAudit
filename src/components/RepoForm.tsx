"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RepoForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [wantEmail, setWantEmail] = useState(false);
  const [mode, setMode] = useState<"grounded" | "compare">("grounded");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const endpoint = mode === "compare" ? "/api/compare" : "/api/analyze";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repoUrl: url,
          ...(wantEmail && email.trim() ? { email: email.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        setBusy(false);
        return;
      }
      const path = mode === "compare" ? "/compare/" : "/report/";
      router.push(path + data.jobId);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
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
        />
      </div>

      {/* Optional email delivery — a full audit takes minutes, so this lets the
          user close the tab and get the report in their inbox instead. */}
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
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 text-xs text-[var(--text-faint)]">
              <span>The plain-English report lands in your inbox, full analysis attached.</span>
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
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
          >
            <span aria-hidden>✉</span>
            Email me the report
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="aa-segment" role="tablist" aria-label="Analysis mode">
          <button type="button" data-active={mode === "grounded"} onClick={() => setMode("grounded")}>
            Grounded audit
          </button>
          <button type="button" data-active={mode === "compare"} onClick={() => setMode("compare")}>
            Compare vs. naive
          </button>
        </div>

        <button type="submit" disabled={busy || !url} className="aa-btn">
          {busy ? (
            <>
              <span className="aa-spin inline-block h-4 w-4 rounded-full border-2 border-[#0a0c12]/40 border-t-[#0a0c12]" />
              Starting…
            </>
          ) : (
            <>Analyze →</>
          )}
        </button>
      </div>

      {error && (
        <p className="aa-chip sev-high w-full justify-start !rounded-lg py-2 text-xs normal-case">
          {error}
        </p>
      )}
    </form>
  );
}
