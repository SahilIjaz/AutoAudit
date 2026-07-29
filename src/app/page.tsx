import { RepoForm } from "@/components/RepoForm";

const STEPS = [
  { n: "01", title: "Scan", body: "Semgrep, npm audit & ESLint find real issues across any language." },
  { n: "02", title: "Verify", body: "A Claude agent reads the actual code to confirm or dismiss each one." },
  { n: "03", title: "Report", body: "Every finding is triaged with evidence, severity, and a fix." },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 pb-24 pt-16 sm:pt-24">
      <div className="aa-fade-up">
        <span className="aa-eyebrow">
          <span className="aa-dot bg-medium aa-pulse" />
          Grounded, agentic code review
        </span>

        <h1 className="mt-6 text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
          <span className="aa-gradient-text">Find real bugs.</span>
          <br />
          Not hallucinations.
        </h1>

        <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--text-muted)]">
          Instead of asking an LLM to eyeball your code, AutoAudit runs real
          static-analysis tools to find issues — then a Claude agent reads the
          code to verify each one. Findings are backed by evidence, not guesses.
        </p>
      </div>

      <div className="aa-fade-up relative mt-10" style={{ animationDelay: "0.08s" }}>
        <div className="pointer-events-none absolute -inset-4 rounded-3xl bg-[radial-gradient(40rem_20rem_at_30%_0%,var(--accent-glow),transparent_70%)] opacity-60 blur-2xl" />
        <div className="aa-panel relative p-6 sm:p-7">
          <RepoForm />
          <p className="mt-4 text-xs text-[var(--text-faint)]">
            Paste any public GitHub repository — any language. It clones, scans,
            and an agent triages every finding.
          </p>
        </div>
      </div>

      <div className="aa-fade-up mt-16 grid gap-4 sm:grid-cols-3" style={{ animationDelay: "0.16s" }}>
        {STEPS.map((s) => (
          <div key={s.n} className="aa-card aa-card-hover p-5">
            <div className="font-mono text-xs text-[var(--accent)]">{s.n}</div>
            <div className="mt-2 font-semibold">{s.title}</div>
            <p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">{s.body}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
