"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RepoForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
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
        body: JSON.stringify({ repoUrl: url }),
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
    <form onSubmit={submit} className="space-y-4">
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://github.com/owner/repo"
        className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-neutral-100 outline-none focus:border-blue-500"
      />
      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={mode === "grounded"}
            onChange={() => setMode("grounded")}
          />
          Grounded audit
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={mode === "compare"}
            onChange={() => setMode("compare")}
          />
          Compare vs. naive LLM
        </label>
      </div>
      <button
        type="submit"
        disabled={busy || !url}
        className="rounded-lg bg-blue-600 px-5 py-3 font-medium text-white disabled:opacity-50"
      >
        {busy ? "Starting…" : "Analyze"}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
