import type { AuditReport, Severity, VerifiedFinding } from "../types";
import { CONFIG } from "../config";

/**
 * Email rendering rules that differ from the web UI, and why:
 *  - Table layout + inline styles only. Gmail strips <style> blocks, Outlook
 *    ignores flexbox, and no client supports CSS custom properties.
 *  - Light palette. Dark-mode handling is inconsistent across clients and
 *    inverted text on a dark card is the most common way it breaks.
 *  - Body carries ONLY the plain-language layer. Email has no expand button,
 *    so the technical depth ships as an attached HTML file instead.
 */

const C = {
  text: "#101828",
  muted: "#475467",
  faint: "#667085",
  border: "#e4e7ec",
  panel: "#f9fafb",
  accent: "#4f46e5",
  good: "#067647",
  goodBg: "#ecfdf3",
};

const SEV: Record<Severity, { label: string; fg: string; bg: string }> = {
  high: { label: "High risk", fg: "#b42318", bg: "#fef3f2" },
  medium: { label: "Medium risk", fg: "#b54708", bg: "#fffaeb" },
  low: { label: "Low risk", fg: "#475467", bg: "#f2f4f7" },
};

const SEV_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** Finding text is model- and repo-derived, so it is never trusted as markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Problems worth reading first: real ones, worst first. */
export function actionableFindings(findings: VerifiedFinding[]): VerifiedFinding[] {
  return findings
    .filter((f) => f.verdict !== "false_positive")
    .slice()
    .sort((a, b) => {
      const verdict = Number(b.verdict === "confirmed") - Number(a.verdict === "confirmed");
      return verdict !== 0 ? verdict : SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
    });
}

function shortLocation(f: VerifiedFinding): string | null {
  if (!f.file) return null;
  const name = f.file.split("/").pop() ?? f.file;
  return f.line ? `${name}, line ${f.line}` : name;
}

function pill(severity: Severity): string {
  const s = SEV[severity];
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${s.bg};color:${s.fg};font-size:12px;font-weight:600;">${s.label}</span>`;
}

function findingBlock(f: VerifiedFinding): string {
  const location = shortLocation(f);
  return `
  <tr><td style="padding:0 0 14px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="border:1px solid ${C.border};border-radius:10px;background:#ffffff;">
      <tr><td style="padding:16px 18px;">
        ${pill(f.severity)}
        <div style="margin:10px 0 0 0;font-size:16px;font-weight:600;color:${C.text};line-height:1.4;">
          ${escapeHtml(f.plainTitle)}
        </div>
        <div style="margin:6px 0 0 0;font-size:14px;color:${C.muted};line-height:1.6;">
          ${escapeHtml(f.plainImpact)}
        </div>
        ${
          f.plainFix
            ? `<div style="margin:12px 0 0 0;padding:10px 12px;background:${C.goodBg};border-radius:8px;font-size:14px;color:${C.text};line-height:1.5;">
                 <strong style="color:${C.good};">What to do:</strong> ${escapeHtml(f.plainFix)}
               </div>`
            : ""
        }
        ${
          location
            ? `<div style="margin:10px 0 0 0;font-size:12px;color:${C.faint};">
                 Found in <span style="font-family:Menlo,Consolas,monospace;">${escapeHtml(location)}</span>
               </div>`
            : ""
        }
      </td></tr>
    </table>
  </td></tr>`;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderReportEmail(report: AuditReport, reportUrl: string | null): RenderedEmail {
  const repoName = `${report.repo.owner}/${report.repo.repo}`;
  const actionable = actionableFindings(report.findings);
  const shown = actionable.slice(0, CONFIG.maxFindingsInEmail);
  const hidden = actionable.length - shown.length;
  const real = report.findings.filter((f) => f.verdict === "confirmed").length;
  const dismissed = report.findings.filter((f) => f.verdict === "false_positive").length;

  const subject =
    real > 0
      ? `AutoAudit: ${real} real ${real === 1 ? "problem" : "problems"} in ${repoName}`
      : `AutoAudit: nothing serious found in ${repoName}`;

  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${C.panel};padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:600px;max-width:100%;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

      <tr><td style="padding:0 0 18px 0;">
        <div style="font-size:13px;font-weight:700;letter-spacing:0.08em;color:${C.accent};">AUTOAUDIT</div>
        <div style="margin:6px 0 0 0;font-size:22px;font-weight:700;color:${C.text};">Your code review is ready</div>
        <div style="margin:4px 0 0 0;font-size:14px;color:${C.faint};font-family:Menlo,Consolas,monospace;">
          ${escapeHtml(repoName)}
        </div>
      </td></tr>

      <tr><td style="padding:0 0 18px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="border:1px solid ${C.border};border-radius:10px;background:#ffffff;">
          <tr><td style="padding:18px;">
            <div style="font-size:28px;font-weight:700;color:${C.text};line-height:1.2;">
              ${real} <span style="font-size:15px;font-weight:400;color:${C.muted};">real ${
                real === 1 ? "problem" : "problems"
              } worth fixing</span>
            </div>
            <div style="margin:8px 0 0 0;font-size:14px;color:${C.muted};line-height:1.6;">
              We checked ${report.findings.length} ${
                report.findings.length === 1 ? "flag" : "flags"
              } raised by the scanners${dismissed > 0 ? ` and ruled out ${dismissed} as harmless` : ""}.
            </div>
            <div style="margin:12px 0 0 0;padding:12px 0 0 0;border-top:1px solid ${C.border};font-size:14px;color:${C.text};line-height:1.6;">
              ${escapeHtml(report.summary)}
            </div>
          </td></tr>
        </table>
      </td></tr>

      ${shown.map(findingBlock).join("")}

      ${
        hidden > 0
          ? `<tr><td style="padding:0 0 14px 0;font-size:13px;color:${C.faint};">
               + ${hidden} more ${hidden === 1 ? "finding" : "findings"} in the attached full report.
             </td></tr>`
          : ""
      }

      <tr><td style="padding:4px 0 0 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="border:1px solid ${C.border};border-radius:10px;background:#ffffff;">
          <tr><td style="padding:16px 18px;font-size:14px;color:${C.muted};line-height:1.6;">
            <strong style="color:${C.text};">Want the depth?</strong> The attached
            <span style="font-family:Menlo,Consolas,monospace;font-size:13px;">autoaudit-report.html</span>
            has the technical analysis for every finding — file paths, the evidence each tool
            produced, and the code the agent actually read. Open it in any browser.
            ${
              reportUrl
                ? `<br /><br /><a href="${escapeHtml(reportUrl)}" style="color:${C.accent};font-weight:600;text-decoration:none;">View the interactive report →</a>`
                : ""
            }
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:20px 0 0 0;font-size:12px;color:${C.faint};line-height:1.6;">
        Findings come from Semgrep, npm audit and ESLint, then a Claude agent read the code to
        confirm or dismiss each one. Nothing here was invented by the model.
      </td></tr>

    </table>
  </td></tr>
</table>`.trim();

  // Plain-text alternative — multipart mail scores better with spam filters.
  const lines = [
    `AutoAudit — ${repoName}`,
    "",
    `${real} real ${real === 1 ? "problem" : "problems"} worth fixing.`,
    `Checked ${report.findings.length} ${report.findings.length === 1 ? "flag" : "flags"}${
      dismissed > 0 ? `, ruled out ${dismissed} as harmless` : ""
    }.`,
    "",
    report.summary,
    "",
    ...shown.flatMap((f) => {
      const loc = shortLocation(f);
      return [
        `[${SEV[f.severity].label}] ${f.plainTitle}`,
        `  ${f.plainImpact}`,
        ...(f.plainFix ? [`  What to do: ${f.plainFix}`] : []),
        ...(loc ? [`  Found in ${loc}`] : []),
        "",
      ];
    }),
    ...(hidden > 0 ? [`+ ${hidden} more in the attached full report.`, ""] : []),
    "Full technical analysis: see the attached autoaudit-report.html",
    ...(reportUrl ? [`Interactive report: ${reportUrl}`] : []),
  ];

  return { subject, html, text: lines.join("\n") };
}

/** Sent when the pipeline fails, so nobody is left waiting on a dead job. */
export function renderFailureEmail(repoUrl: string, message: string): RenderedEmail {
  const subject = `AutoAudit: the review of ${repoUrl} could not finish`;
  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${C.panel};padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:600px;max-width:100%;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <tr><td style="padding:0 0 14px 0;">
        <div style="font-size:13px;font-weight:700;letter-spacing:0.08em;color:${C.accent};">AUTOAUDIT</div>
        <div style="margin:6px 0 0 0;font-size:20px;font-weight:700;color:${C.text};">The review didn't finish</div>
      </td></tr>
      <tr><td style="padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="border:1px solid ${C.border};border-radius:10px;background:#ffffff;">
          <tr><td style="padding:18px;font-size:14px;color:${C.muted};line-height:1.6;">
            We couldn't complete the review of
            <span style="font-family:Menlo,Consolas,monospace;color:${C.text};">${escapeHtml(repoUrl)}</span>.
            Nothing was charged to you and no report was produced.
            <div style="margin:12px 0 0 0;padding:12px;background:${C.panel};border-radius:8px;font-family:Menlo,Consolas,monospace;font-size:13px;color:${C.text};">
              ${escapeHtml(message)}
            </div>
            <div style="margin:12px 0 0 0;">Trying again usually works if the repository is large or was briefly unreachable.</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>`.trim();

  const text = `AutoAudit — the review of ${repoUrl} could not finish.\n\n${message}\n\nTrying again usually works if the repository is large or was briefly unreachable.`;
  return { subject, html, text };
}
