import { RepoForm } from "@/components/RepoForm";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="text-4xl font-bold tracking-tight">AutoAudit</h1>
      <p className="mt-3 text-lg text-neutral-400">
        Grounded AI code review. Real static-analysis tools find the issues; a
        Claude agent reads the code to verify each one — so findings are backed
        by evidence, not guesses.
      </p>
      <div className="mt-10">
        <RepoForm />
      </div>
      <p className="mt-8 text-sm text-neutral-500">
        Paste a public GitHub repository URL. The analyzer clones it, runs
        Semgrep, npm&nbsp;audit, and ESLint, then an agent triages every finding.
      </p>
    </main>
  );
}
