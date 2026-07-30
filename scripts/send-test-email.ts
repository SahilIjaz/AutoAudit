/**
 * Verifies SMTP settings without running a full audit (which costs API tokens
 * and takes minutes). Sends the real templates with a sample report.
 *
 *   npm run mail:test -- you@example.com
 *   npm run mail:test -- you@example.com --fail    # the failure notice instead
 *
 * Also writes the attachment to /tmp so you can open it in a browser.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AuditReport } from "../src/engine/types";
import { mailConfig } from "../src/engine/config";
import { sendReportEmail, sendFailureEmail } from "../src/engine/notify/sendReport";
import { renderReportAttachment } from "../src/engine/notify/renderAttachment";

if (fs.existsSync(".env.local") && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(".env.local");
}

const SAMPLE: AuditReport = {
  summary:
    "One live API key is committed to the repository and needs rotating today. The other flags are minor or harmless.",
  repo: {
    owner: "example",
    repo: "sample-app",
    headSha: "0123456789abcdef0123456789abcdef01234567",
    defaultBranch: "main",
    url: "https://github.com/example/sample-app",
  },
  metrics: {
    model: "claude-sonnet-5",
    inputTokens: 48_120,
    outputTokens: 3_940,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: 0.2035,
    apiCalls: 7,
    toolCalls: { read_file: 9, get_file_context: 4 },
    wallTimeMs: { clone: 1_800, scan: 12_400, agent: 31_200, report: 4_100 },
  },
  rawFindings: [],
  findings: [
    {
      findingId: "semgrep:generic.secrets:src/config.ts:12",
      verdict: "confirmed",
      severity: "high",
      category: "security",
      file: "src/config.ts",
      line: 12,
      title: "Hardcoded API credential (generic.secrets.security.detected-generic-api-key)",
      explanation:
        "Line 12 assigns a 40-character high-entropy string to STRIPE_KEY. The value is committed, so it is present in every clone and in the git history. It is used to authorise live payment calls in src/billing.ts.",
      evidence:
        "Semgrep flagged the assignment; read_file confirmed the literal is a live-format key, and search_codebase found it used in billing.ts:44.",
      suggestedFix:
        "Read the key from process.env.STRIPE_KEY, remove the literal, and rotate the credential in the Stripe dashboard since the old one is compromised.",
      contextSnippet: "11\t// TODO: move to env\n12\tconst STRIPE_KEY = 'sk_live_51H...redacted';",
      plainTitle: "A live payment password is written into the code",
      plainImpact:
        "Anyone who can read this project — now or in its history — can charge money through your payment account.",
      plainFix: "Move it into an environment variable, then change the key at your payment provider.",
    },
    {
      findingId: "npm-audit:GHSA-xxxx:package-lock.json:0",
      verdict: "confirmed",
      severity: "medium",
      category: "dependency",
      file: "package-lock.json",
      line: null,
      title: "Prototype pollution in lodash < 4.17.21 (GHSA-xxxx)",
      explanation:
        "The lockfile pins lodash 4.17.11, which is vulnerable to prototype pollution via _.merge. The app calls _.merge on parsed request bodies in src/api/update.ts, so untrusted input reaches the vulnerable path.",
      evidence: "npm audit reported the advisory; get_file_context confirmed _.merge on req.body.",
      suggestedFix: "Upgrade lodash to >= 4.17.21 with `npm install lodash@latest`.",
      contextSnippet: null,
      plainTitle: "An outdated library can be tricked by user input",
      plainImpact:
        "A visitor could send crafted data that changes how your app behaves in ways you didn't intend.",
      plainFix: "Update the lodash package to its latest version.",
    },
    {
      findingId: "semgrep:generic.secrets:README.md:30",
      verdict: "false_positive",
      severity: "high",
      category: "security",
      file: "README.md",
      line: 30,
      title: "Hardcoded credential in documentation (generic.secrets)",
      explanation:
        "The flagged value is the literal placeholder YOUR_API_KEY_HERE inside a setup example. It is not a credential and cannot be used to authenticate.",
      evidence: "Semgrep flagged the string; read_file showed it is a placeholder in a code fence.",
      suggestedFix: null,
      contextSnippet: "30\tSTRIPE_KEY=YOUR_API_KEY_HERE",
      plainTitle: "A fake example password in the setup guide",
      plainImpact: "Nothing to worry about — it's placeholder text, not a real password.",
      plainFix: null,
    },
  ],
};

async function main() {
  const args = process.argv.slice(2);
  const to = args.find((a) => !a.startsWith("--"));
  const failMode = args.includes("--fail");

  if (!to) {
    console.error("Usage: npm run mail:test -- <recipient@example.com> [--fail]");
    process.exit(1);
  }

  const cfg = mailConfig();
  if (!cfg) {
    console.error(
      "SMTP is not configured. Set SMTP_USER and SMTP_PASS in .env.local (see .env.local.example)."
    );
    process.exit(1);
  }
  console.log(`SMTP ${cfg.host}:${cfg.port} as ${cfg.user}`);

  const preview = path.join(os.tmpdir(), "autoaudit-report-preview.html");
  fs.writeFileSync(preview, renderReportAttachment(SAMPLE));
  console.log(`Attachment preview written to ${preview}`);

  const outcome = failMode
    ? await sendFailureEmail(to, "https://github.com/example/sample-app", "Clone timed out after 60s.")
    : await sendReportEmail(to, SAMPLE);

  if (outcome.sent) {
    console.log(`Sent to ${to}. Check the inbox (and the spam folder).`);
  } else {
    console.error(`Not sent: ${outcome.reason}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
