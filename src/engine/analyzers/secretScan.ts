import fsp from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "../config";
import type { Finding, RepoProfile, Severity } from "../types";
import { findingId, type Analyzer } from "./types";

/**
 * A pure-JS committed-secret scanner.
 *
 * Semgrep's `p/secrets` pack cannot run on Vercel (Python + a compiled core, far
 * over a function's size limit), and secrets were the highest-value class of
 * finding it produced. This recovers that one class in plain JS.
 *
 * It is deliberately narrow: known provider key formats plus assignments to
 * secret-shaped names. It does NOT attempt Semgrep's dataflow or taint analysis.
 * Anything it flags still goes to the agent for verification, so a placeholder
 * that slips through gets dismissed as a false positive rather than reported.
 */

interface Rule {
  id: string;
  label: string;
  re: RegExp;
  severity: Severity;
}

const RULES: Rule[] = [
  {
    id: "aws-access-key-id",
    label: "AWS access key ID",
    re: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g,
    severity: "high",
  },
  {
    id: "github-token",
    label: "GitHub token",
    re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
    severity: "high",
  },
  {
    id: "stripe-secret-key",
    label: "Stripe secret key",
    re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g,
    severity: "high",
  },
  {
    id: "slack-token",
    label: "Slack token",
    re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
    severity: "high",
  },
  {
    id: "google-api-key",
    label: "Google API key",
    re: /\bAIza[A-Za-z0-9_-]{35}\b/g,
    severity: "high",
  },
  {
    id: "anthropic-api-key",
    label: "Anthropic API key",
    re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    severity: "high",
  },
  {
    id: "openai-api-key",
    label: "OpenAI API key",
    re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/g,
    severity: "high",
  },
  {
    id: "private-key-block",
    label: "Private key block",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
    severity: "high",
  },
  {
    id: "jwt",
    label: "JSON Web Token",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    severity: "medium",
  },
  {
    id: "database-url-with-password",
    label: "Database URL containing a password",
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s:@/]{3,}@/g,
    severity: "high",
  },
  {
    id: "hardcoded-secret-assignment",
    label: "Hardcoded value assigned to a secret-shaped name",
    // KEY/SECRET/TOKEN/PASSWORD/... = "<10+ chars>"
    // The leading name part must be optional: a bare `SECRET_TOKEN = "..."`
    // starts with the keyword itself and would otherwise never match.
    re: /\b[A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSWD|API_?KEY|APIKEY|ACCESS_?TOKEN|AUTH_?TOKEN|PRIVATE_?KEY|CLIENT_?SECRET)[A-Za-z0-9_]*\s*[:=]\s*["'`]([^"'`\n]{10,})["'`]/gi,
    severity: "high",
  },
];

/** Obvious non-secrets. Cheap to skip here; the agent would dismiss them anyway. */
const PLACEHOLDER_RE =
  /^(?:x{3,}|\*{3,}|\.{3,}|<[^>]*>|\$\{[^}]*\}|%[A-Z_]+%|)$|your[_-]?|placeholder|example|changeme|change[_-]?this|dummy|sample|test[_-]?key|redacted|insert[_-]?|todo|fixme|xxxx|process\.env|import\.meta\.env|os\.environ|secrets?\.|dotenv/i;

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  "vendor",
  "__snapshots__",
]);

/** Binaries, lockfiles and minified bundles produce nothing but noise. */
const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".pdf", ".zip", ".gz",
  ".tar", ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mp3", ".wav", ".bin", ".wasm",
  ".map", ".lock",
]);

const SKIP_FILE = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

function isScannable(rel: string, size: number): boolean {
  if (size > 512 * 1024) return false; // minified/generated
  const base = path.basename(rel);
  if (SKIP_FILE.has(base)) return false;
  if (SKIP_EXT.has(path.extname(base).toLowerCase())) return false;
  if (/\.min\.(?:js|css)$/.test(base)) return false;
  return true;
}

export function scanText(rel: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split("\n");
  const seen = new Set<string>();

  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 1000) continue; // generated/minified line
      rule.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.re.exec(line)) !== null) {
        const value = m[1] ?? m[0];
        if (PLACEHOLDER_RE.test(value)) continue;
        // One finding per rule per line, even if the pattern matches twice.
        const key = `${rule.id}:${i + 1}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          id: findingId("secret-scan", rule.id, rel, i + 1),
          tool: "secret-scan",
          ruleId: rule.id,
          severity: rule.severity,
          category: "security",
          file: rel,
          line: i + 1,
          endLine: i + 1,
          message: `${rule.label} appears to be hardcoded in ${rel}. Verify whether the value is a real credential.`,
        });
      }
    }
  }
  return findings;
}

export async function runSecretScan(repoDir: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  let scanned = 0;

  async function visit(dir: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (scanned >= CONFIG.maxFilesForAgent) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;

      const rel = path.relative(repoDir, full).split(path.sep).join("/");
      const stat = await fsp.stat(full);
      if (!isScannable(rel, stat.size)) continue;

      let content: string;
      try {
        content = await fsp.readFile(full, "utf8");
      } catch {
        continue; // unreadable or not valid UTF-8
      }
      if (content.indexOf("\u0000") !== -1) continue; // NUL byte -> binary, not source
      scanned++;
      findings.push(...scanText(rel, content));
    }
  }

  await visit(repoDir);
  return findings;
}

export const secretScanAnalyzer: Analyzer = {
  name: "secret-scan",
  isApplicable: () => true,
  async run(repoDir) {
    try {
      return await runSecretScan(repoDir);
    } catch (err) {
      console.error("[autoaudit] secret scan failed:", err);
      return [];
    }
  },
};
