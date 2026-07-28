import { describe, it, expect, vi } from "vitest";
import { generateValidatedReport, ReportValidationError } from "./validateWithRetry";
import { MetricsCollector } from "../metrics/metrics";

const usage = { input_tokens: 10, output_tokens: 5 };
const validReport = {
  summary: "ok",
  findings: [
    {
      findingId: "semgrep:x:a.js:1",
      verdict: "confirmed",
      severity: "high",
      category: "security",
      file: "a.js",
      line: 1,
      title: "t",
      explanation: "e",
      evidence: "ev",
      suggestedFix: null,
      contextSnippet: null,
    },
  ],
};

describe("generateValidatedReport", () => {
  it("retries after malformed output and feeds the error back", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ content: [{ type: "text", text: "not json at all" }], usage })
      .mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify(validReport) }], usage });
    const client = { messages: { create } } as never;
    const metrics = new MetricsCollector();

    const report = await generateValidatedReport(
      client,
      [{ role: "user", content: "findings" }],
      new Set(["semgrep:x:a.js:1"]),
      metrics
    );
    expect(report.findings).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(2);
    // The retry conversation must contain the validation feedback.
    const retryCall = create.mock.calls[1][0];
    expect(JSON.stringify(retryCall.messages)).toContain("was invalid");
  });

  it("rejects an invented findingId as a semantic error", async () => {
    const invented = { ...validReport, findings: [{ ...validReport.findings[0], findingId: "made-up" }] };
    const create = vi
      .fn()
      .mockResolvedValue({ content: [{ type: "text", text: JSON.stringify(invented) }], usage });
    const client = { messages: { create } } as never;
    await expect(
      generateValidatedReport(
        client,
        [{ role: "user", content: "findings" }],
        new Set(["semgrep:x:a.js:1"]),
        new MetricsCollector()
      )
    ).rejects.toBeInstanceOf(ReportValidationError);
  });
});
