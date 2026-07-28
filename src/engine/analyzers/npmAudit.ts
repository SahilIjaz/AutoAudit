import { execa } from "execa";
import fsp from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "../config";
import type { Finding, Severity } from "../types";
import { findingId, type Analyzer } from "./types";

interface NpmAuditVulnerability {
  name: string;
  severity: string;
  via?: (string | { title?: string; url?: string })[];
  range?: string;
}

export interface NpmAuditOutput {
  vulnerabilities?: Record<string, NpmAuditVulnerability>;
}

const SEVERITY_MAP: Record<string, Severity> = {
  critical: "high",
  high: "high",
  moderate: "medium",
  low: "low",
  info: "low",
};

export function normalizeNpmAudit(json: NpmAuditOutput): Finding[] {
  const findings: Finding[] = [];
  for (const [pkg, vuln] of Object.entries(json.vulnerabilities ?? {})) {
    const advisories = (vuln.via ?? [])
      .filter((v): v is { title?: string; url?: string } => typeof v === "object")
      .map((v) => v.title)
      .filter(Boolean);
    const detail = advisories.length > 0 ? advisories.join("; ") : "known vulnerability";
    findings.push({
      id: findingId("npm-audit", pkg, "package.json", null),
      tool: "npm-audit",
      ruleId: pkg,
      severity: SEVERITY_MAP[vuln.severity] ?? "medium",
      category: "dependency",
      file: "package.json",
      line: null,
      message: `Vulnerable dependency ${pkg}${vuln.range ? ` (${vuln.range})` : ""}: ${detail}`,
    });
  }
  return findings;
}

export async function runNpmAudit(repoDir: string): Promise<Finding[]> {
  const hasLockfile = await fsp
    .stat(path.join(repoDir, "package-lock.json"))
    .then(() => true)
    .catch(() => false);

  if (!hasLockfile) {
    // Synthesize a lockfile WITHOUT installing or executing anything.
    await execa(
      "npm",
      ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: repoDir, timeout: CONFIG.subprocessTimeoutMs }
    );
  }

  // npm audit exits non-zero when vulnerabilities exist — parse anyway.
  const result = await execa("npm", ["audit", "--json"], {
    cwd: repoDir,
    timeout: CONFIG.subprocessTimeoutMs,
    reject: false,
  });
  if (!result.stdout) {
    throw new Error(`npm audit produced no output: ${result.stderr?.slice(0, 500)}`);
  }
  const json = JSON.parse(result.stdout) as NpmAuditOutput;
  return normalizeNpmAudit(json);
}

export const npmAuditAnalyzer: Analyzer = {
  name: "npm-audit",
  isApplicable: (profile) => profile.hasPackageJson,
  async run(repoDir) {
    try {
      return await runNpmAudit(repoDir);
    } catch (err) {
      console.error("[autoaudit] npm audit failed:", err);
      return [];
    }
  },
};
