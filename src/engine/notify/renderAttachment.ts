import type { AuditReport, Severity, VerifiedFinding, Verdict } from "../types";
import { escapeHtml, actionableFindings } from "./renderEmail";

/**
 * A self-contained HTML report to attach to the email. Unlike the mail body
 * this one is opened in a browser, so <details> works — it keeps the same
 * "simple first, depth on demand" shape as the web UI, with every finding's
 * technical analysis one click away and nothing hidden permanently.
 */

const SEV_LABEL: Record<Severity, string> = {
  high: "High risk",
  medium: "Medium risk",
  low: "Low risk",
};

const VERDICT_PLAIN: Record<Verdict, string> = {
  confirmed: "Real problem",
  false_positive: "Not a problem",
  needs_review: "Needs a look",
  unverified: "Not checked",
};

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 20px;
    background: #f9fafb; color: #101828;
    font: 16px/1.6 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .wrap { max-width: 780px; margin: 0 auto; }
  .eyebrow { font-size: 13px; font-weight: 700; letter-spacing: .08em; color: #4f46e5; }
  h1 { margin: 6px 0 4px; font-size: 26px; line-height: 1.2; }
  .repo { font-family: Menlo, Consolas, monospace; font-size: 14px; color: #667085; }
  .card {
    background: #fff; border: 1px solid #e4e7ec; border-radius: 12px;
    padding: 18px 20px; margin: 0 0 16px;
  }
  .big { font-size: 30px; font-weight: 700; line-height: 1.1; }
  .big span { font-size: 15px; font-weight: 400; color: #475467; }
  .muted { color: #475467; }
  .faint { color: #667085; font-size: 13px; }
  h2 { font-size: 18px; margin: 8px 0 12px; }
  .pill {
    display: inline-block; padding: 3px 10px; border-radius: 999px;
    font-size: 12px; font-weight: 600; margin: 0 6px 0 0;
  }
  .sev-high { background: #fef3f2; color: #b42318; }
  .sev-medium { background: #fffaeb; color: #b54708; }
  .sev-low { background: #f2f4f7; color: #475467; }
  .v { background: #f2f4f7; color: #475467; }
  .title { font-size: 17px; font-weight: 600; margin: 10px 0 0; }
  .fix { margin: 12px 0 0; padding: 10px 12px; background: #ecfdf3; border-radius: 8px; font-size: 15px; }
  .fix strong { color: #067647; }
  details { margin: 14px 0 0; border-top: 1px solid #e4e7ec; padding: 12px 0 0; }
  summary {
    cursor: pointer; font-size: 13px; font-weight: 600; color: #475467;
    list-style: none; display: inline-block;
    border: 1px solid #e4e7ec; border-radius: 999px; padding: 5px 12px;
  }
  summary::-webkit-details-marker { display: none; }
  summary:hover { border-color: #4f46e5; color: #101828; }
  .label {
    font-size: 11px; font-weight: 700; letter-spacing: .06em;
    text-transform: uppercase; color: #667085; margin: 14px 0 2px;
  }
  .val { font-size: 14px; color: #475467; }
  pre {
    overflow-x: auto; background: #1d2939; color: #e4e7ec;
    border-radius: 8px; padding: 12px; font-size: 13px; line-height: 1.5;
    font-family: Menlo, Consolas, monospace;
  }
  code { font-family: Menlo, Consolas, monospace; font-size: 13px; }
  a { color: #4f46e5; }
  .foot { margin: 24px 0 0; font-size: 13px; color: #667085; }
  @media print { body { background: #fff; padding: 0; } details { open: true; } }
`;

function githubLink(report: AuditReport, f: VerifiedFinding): string | null {
  const url = report.repo.url;
  if (!f.file || !url.startsWith("https://github.com")) return null;
  const base = url.replace(/\.git$/, "").replace(/\/$/, "");
  return `${base}/blob/${report.repo.headSha}/${f.file}${f.line ? `#L${f.line}` : ""}`;
}

function row(label: string, valueHtml: string): string {
  return `<div class="label">${label}</div><div class="val">${valueHtml}</div>`;
}

function findingSection(report: AuditReport, f: VerifiedFinding): string {
  const link = githubLink(report, f);
  const location = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : null;

  return `
<div class="card">
  <span class="pill sev-${f.severity}">${SEV_LABEL[f.severity]}</span>
  <span class="pill v">${VERDICT_PLAIN[f.verdict]}</span>
  <div class="title">${escapeHtml(f.plainTitle)}</div>
  <p class="muted">${escapeHtml(f.plainImpact)}</p>
  ${f.plainFix ? `<div class="fix"><strong>What to do:</strong> ${escapeHtml(f.plainFix)}</div>` : ""}
  ${location ? `<p class="faint">Found in <code>${escapeHtml(location)}</code></p>` : ""}
  <details>
    <summary>More depth analysis</summary>
    ${row("Technical issue", escapeHtml(f.title))}
    ${row(
      "Classification",
      `${escapeHtml(f.category)} · severity ${escapeHtml(f.severity)} · verdict ${escapeHtml(f.verdict)}`
    )}
    ${
      location
        ? row(
            "Location",
            `<code>${escapeHtml(location)}</code>${
              link ? ` — <a href="${escapeHtml(link)}">view on GitHub</a>` : ""
            }`
          )
        : ""
    }
    ${row("Full analysis", escapeHtml(f.explanation))}
    ${row("Evidence", escapeHtml(f.evidence))}
    ${f.contextSnippet ? `<div class="label">Code</div><pre>${escapeHtml(f.contextSnippet)}</pre>` : ""}
    ${f.suggestedFix ? row("Suggested fix", escapeHtml(f.suggestedFix)) : ""}
  </details>
</div>`;
}

export function renderReportAttachment(report: AuditReport): string {
  const repoName = `${report.repo.owner}/${report.repo.repo}`;
  const actionable = actionableFindings(report.findings);
  const dismissed = report.findings.filter((f) => f.verdict === "false_positive");
  const real = report.findings.filter((f) => f.verdict === "confirmed").length;
  const totalMs = Object.values(report.metrics.wallTimeMs).reduce((a, b) => a + b, 0);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>AutoAudit — ${escapeHtml(repoName)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <div class="eyebrow">AUTOAUDIT</div>
  <h1>Code review report</h1>
  <div class="repo">${escapeHtml(repoName)} · ${escapeHtml(report.repo.headSha.slice(0, 7))}</div>

  <div class="card" style="margin-top:18px;">
    <div class="big">${real} <span>real ${real === 1 ? "problem" : "problems"} worth fixing</span></div>
    <p class="muted">We checked ${report.findings.length} ${
      report.findings.length === 1 ? "flag" : "flags"
    } raised by the scanners${
      dismissed.length > 0 ? ` and ruled out ${dismissed.length} as harmless` : ""
    }.</p>
    <p style="margin:12px 0 0;padding:12px 0 0;border-top:1px solid #e4e7ec;">${escapeHtml(
      report.summary
    )}</p>
  </div>

  <h2>What needs attention</h2>
  ${
    actionable.length > 0
      ? actionable.map((f) => findingSection(report, f)).join("")
      : `<div class="card muted">Nothing needs attention — every flag was ruled out.</div>`
  }

  ${
    dismissed.length > 0
      ? `<h2>Ruled out as harmless (${dismissed.length})</h2>
         ${dismissed.map((f) => findingSection(report, f)).join("")}`
      : ""
  }

  <div class="foot">
    Findings came from Semgrep, npm audit and ESLint; a Claude agent
    (${escapeHtml(report.metrics.model)}) then read the code to confirm or dismiss each one — it
    cannot report an issue the tools didn't find. Review took ${(totalMs / 1000).toFixed(1)}s and
    $${report.metrics.estimatedCostUsd.toFixed(4)} of model usage.
  </div>
</div>
</body>
</html>`;
}
