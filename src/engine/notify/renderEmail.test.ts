import { describe, expect, it } from "vitest";
import type { AuditReport, VerifiedFinding } from "../types";
import { CONFIG } from "../config";
import { actionableFindings, escapeHtml, renderReportEmail } from "./renderEmail";
import { renderReportAttachment } from "./renderAttachment";

function finding(over: Partial<VerifiedFinding> = {}): VerifiedFinding {
  return {
    findingId: "semgrep:rule:a.ts:1",
    verdict: "confirmed",
    severity: "high",
    category: "security",
    file: "src/deep/nested/a.ts",
    line: 12,
    title: "detected-generic-api-key",
    explanation: "Technical explanation of the key.",
    evidence: "Semgrep flagged it.",
    suggestedFix: "Use an env var.",
    contextSnippet: "const K = 'x'",
    plainTitle: "A password is written into the code",
    plainImpact: "Anyone reading the project could use it.",
    plainFix: "Move it into an environment variable.",
    ...over,
  };
}

function report(findings: VerifiedFinding[]): AuditReport {
  return {
    summary: "One key needs rotating.",
    findings,
    repo: {
      owner: "acme",
      repo: "app",
      headSha: "abc1234def",
      defaultBranch: "main",
      url: "https://github.com/acme/app",
    },
    metrics: {
      model: "claude-sonnet-5",
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0.01,
      apiCalls: 1,
      toolCalls: {},
      wallTimeMs: { scan: 1000 },
    },
    rawFindings: [],
  };
}

describe("escapeHtml", () => {
  it("neutralises markup from model- and repo-derived text", () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;"
    );
  });
});

describe("actionableFindings", () => {
  it("drops false positives and puts confirmed high risk first", () => {
    const out = actionableFindings([
      finding({ findingId: "low", severity: "low" }),
      finding({ findingId: "dismissed", verdict: "false_positive" }),
      finding({ findingId: "review", verdict: "needs_review", severity: "high" }),
      finding({ findingId: "high" }),
    ]);
    expect(out.map((f) => f.findingId)).toEqual(["high", "low", "review"]);
  });
});

describe("renderReportEmail", () => {
  it("puts the plain layer in the body and keeps the technical detail out", () => {
    const { html, text } = renderReportEmail(report([finding()]), null);
    expect(html).toContain("A password is written into the code");
    expect(html).toContain("Anyone reading the project could use it.");
    expect(html).toContain("Move it into an environment variable.");
    // Technical fields belong in the attachment only.
    expect(html).not.toContain("detected-generic-api-key");
    expect(html).not.toContain("Semgrep flagged it.");
    expect(html).not.toContain("const K = 'x'");
    // The body shows the file name, not the full path.
    expect(html).toContain("a.ts, line 12");
    expect(html).not.toContain("src/deep/nested/a.ts");
    expect(text).toContain("A password is written into the code");
  });

  it("escapes finding text instead of emitting it as markup", () => {
    const { html } = renderReportEmail(
      report([finding({ plainTitle: `<script>alert(1)</script>` })]),
      null
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("counts real problems in the subject", () => {
    const one = renderReportEmail(report([finding()]), null);
    expect(one.subject).toBe("AutoAudit: 1 real problem in acme/app");

    const none = renderReportEmail(report([finding({ verdict: "false_positive" })]), null);
    expect(none.subject).toBe("AutoAudit: nothing serious found in acme/app");
  });

  it("caps the body and says how many were held back", () => {
    const many = Array.from({ length: CONFIG.maxFindingsInEmail + 4 }, (_, i) =>
      finding({ findingId: `f${i}` })
    );
    const { html } = renderReportEmail(report(many), null);
    expect(html).toContain("+ 4 more findings in the attached full report.");
  });

  it("only links to the interactive report when a public URL exists", () => {
    expect(renderReportEmail(report([finding()]), null).html).not.toContain("View the interactive");
    expect(
      renderReportEmail(report([finding()]), "https://audit.example.com/report").html
    ).toContain("https://audit.example.com/report");
  });
});

describe("renderReportAttachment", () => {
  it("carries the technical depth the email body omits", () => {
    const html = renderReportAttachment(report([finding()]));
    expect(html).toContain("detected-generic-api-key");
    expect(html).toContain("Semgrep flagged it.");
    expect(html).toContain("src/deep/nested/a.ts");
    expect(html).toContain("More depth analysis");
    // Deep-linked to the exact commit, not a moving branch.
    expect(html).toContain("https://github.com/acme/app/blob/abc1234def/src/deep/nested/a.ts#L12");
  });

  it("separates dismissed findings from what needs attention", () => {
    const html = renderReportAttachment(
      report([finding(), finding({ findingId: "d", verdict: "false_positive" })])
    );
    expect(html).toContain("What needs attention");
    expect(html).toContain("Ruled out as harmless (1)");
  });

  it("escapes code snippets", () => {
    const html = renderReportAttachment(
      report([finding({ contextSnippet: "</pre><script>alert(1)</script>" })])
    );
    expect(html).not.toContain("<script>");
  });
});
