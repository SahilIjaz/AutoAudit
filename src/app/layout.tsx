import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoAudit — grounded AI code review",
  description: "Agentic code review that verifies real static-analysis findings.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[rgba(8,10,16,0.6)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
            <Link href="/" className="group flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-sm font-bold text-[#0a0c12] shadow-[0_4px_16px_-4px_var(--accent-glow)]">
                ◈
              </span>
              <span className="text-sm font-semibold tracking-tight">AutoAudit</span>
            </Link>
            <a
              href="https://github.com/SahilIjaz/AutoAudit"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            >
              GitHub ↗
            </a>
          </div>
        </header>

        <div className="flex-1">{children}</div>

        <footer className="border-t border-[var(--border)] py-6">
          <div className="mx-auto max-w-5xl px-6 text-xs text-[var(--text-faint)]">
            Findings are backed by real tools + agent verification — evidence, not guesses.
          </div>
        </footer>
      </body>
    </html>
  );
}
