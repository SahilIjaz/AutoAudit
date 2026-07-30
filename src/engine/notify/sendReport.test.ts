import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditReport } from "../types";
import { CONFIG } from "../config";

const sendMail = vi.fn();
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
}));

// Imported after the mock is registered.
const { sendReportEmail, sendFailureEmail, resetMailTransport } = await import("./sendReport");
const { resetEmailRateLimit } = await import("./rateLimit");

const REPORT: AuditReport = {
  summary: "One key needs rotating.",
  findings: [
    {
      findingId: "semgrep:secrets:src/config.ts:12",
      verdict: "confirmed",
      severity: "high",
      category: "security",
      file: "src/config.ts",
      line: 12,
      title: "detected-generic-api-key",
      explanation: "The literal on line 12 is a live key.",
      evidence: "Semgrep flagged it; the agent confirmed it by reading the file.",
      suggestedFix: "Read it from process.env instead.",
      contextSnippet: "12\tconst K = 'sk_live_x';",
      plainTitle: "A password is written into the code",
      plainImpact: "Anyone who can read this project could charge money through your account.",
      plainFix: "Move it into an environment variable and rotate the key.",
    },
  ],
  repo: {
    owner: "acme",
    repo: "app",
    headSha: "abc1234",
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
    wallTimeMs: { scan: 1 },
  },
  rawFindings: [],
};

const ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "APP_BASE_URL"];
const saved: Record<string, string | undefined> = {};

function configureSmtp() {
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "465";
  process.env.SMTP_USER = "sender@example.com";
  process.env.SMTP_PASS = "app-password";
  process.env.MAIL_FROM = "AutoAudit <sender@example.com>";
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  sendMail.mockReset();
  sendMail.mockResolvedValue({ messageId: "<1@example.com>" });
  resetMailTransport();
  resetEmailRateLimit();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("sendReportEmail", () => {
  it("reports itself unavailable rather than half-working when SMTP is unset", async () => {
    const out = await sendReportEmail("a@b.com", REPORT);
    expect(out).toEqual({ sent: false, reason: "email is not configured on this server" });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("sends the plain body with the technical report attached", async () => {
    configureSmtp();
    const out = await sendReportEmail("Recipient@Example.COM", REPORT);
    expect(out.sent).toBe(true);

    const mail = sendMail.mock.calls[0][0];
    expect(mail.from).toBe("AutoAudit <sender@example.com>");
    expect(mail.to).toBe("recipient@example.com"); // normalized
    expect(mail.subject).toBe("AutoAudit: 1 real problem in acme/app");
    // Both alternatives present — multipart mail scores better with spam filters.
    expect(mail.text).toContain("A password is written into the code");
    expect(mail.html).toContain("A password is written into the code");
    // Depth is in the attachment, not the body.
    expect(mail.html).not.toContain("detected-generic-api-key");

    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0].filename).toBe("autoaudit-report.html");
    expect(mail.attachments[0].contentType).toBe("text/html; charset=utf-8");
    expect(mail.attachments[0].content).toContain("detected-generic-api-key");
    expect(mail.attachments[0].content).toContain("More depth analysis");
  });

  it("adds the interactive link only when APP_BASE_URL is set", async () => {
    configureSmtp();
    await sendReportEmail("a@b.com", REPORT);
    expect(sendMail.mock.calls[0][0].html).not.toContain("View the interactive report");

    process.env.APP_BASE_URL = "https://audit.example.com/";
    resetMailTransport();
    await sendReportEmail("c@d.com", REPORT);
    expect(sendMail.mock.calls[1][0].html).toContain("https://audit.example.com/report");
  });

  it("stops sending to an address past the rate limit", async () => {
    configureSmtp();
    for (let i = 0; i < CONFIG.emailRateLimit.max; i++) {
      expect((await sendReportEmail("a@b.com", REPORT)).sent).toBe(true);
    }
    const blocked = await sendReportEmail("a@b.com", REPORT);
    expect(blocked.sent).toBe(false);
    expect(blocked.reason).toMatch(/rate limit reached/);
    expect(sendMail).toHaveBeenCalledTimes(CONFIG.emailRateLimit.max);
  });

  it("swallows transport failures so a finished audit isn't marked failed", async () => {
    configureSmtp();
    sendMail.mockRejectedValue(new Error("535 authentication failed"));
    const out = await sendReportEmail("a@b.com", REPORT);
    expect(out).toEqual({ sent: false, reason: "535 authentication failed" });
  });
});

describe("sendFailureEmail", () => {
  it("sends a bare notice with no attachment", async () => {
    configureSmtp();
    const out = await sendFailureEmail("a@b.com", "https://github.com/acme/app", "Clone timed out.");
    expect(out.sent).toBe(true);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.subject).toContain("could not finish");
    expect(mail.text).toContain("Clone timed out.");
    expect(mail.attachments).toBeUndefined();
  });
});
