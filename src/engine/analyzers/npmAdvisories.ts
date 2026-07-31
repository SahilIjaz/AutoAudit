import fsp from "node:fs/promises";
import path from "node:path";
import type { Finding, Severity } from "../types";
import { findingId, type Analyzer } from "./types";

/**
 * `npm audit` without the npm binary.
 *
 * The CLI is just a client for the registry's bulk advisory endpoint, so this
 * reads the lockfile and calls the same endpoint directly. Same advisory data,
 * no subprocess — which is what makes it work on Vercel.
 *
 * Deliberate limitation: no lockfile means no exact versions, and advisories are
 * version-specific. Rather than guess, that case reports nothing.
 */

const BULK_ENDPOINT = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";

const SEVERITY_MAP: Record<string, Severity> = {
  critical: "high",
  high: "high",
  moderate: "medium",
  low: "low",
  info: "low",
};

export interface BulkAdvisory {
  title?: string;
  severity?: string;
  vulnerable_versions?: string;
  url?: string;
  cwe?: string[];
}

export type BulkResponse = Record<string, BulkAdvisory[]>;

interface LockfileV2 {
  lockfileVersion?: number;
  /** v2/v3: keyed by path, e.g. "node_modules/lodash" */
  packages?: Record<string, { version?: string; dev?: boolean }>;
  /** v1: keyed by package name, nested */
  dependencies?: Record<string, { version?: string; dependencies?: LockfileV2["dependencies"] }>;
}

/** name -> sorted unique versions present in the tree. */
export function collectInstalled(lock: LockfileV2): Record<string, string[]> {
  const found = new Map<string, Set<string>>();

  const add = (name: string, version?: string) => {
    if (!name || !version) return;
    // Only exact semver is meaningful to the advisory endpoint.
    if (!/^\d+\.\d+\.\d+/.test(version)) return;
    const set = found.get(name) ?? new Set<string>();
    set.add(version);
    found.set(name, set);
  };

  for (const [pkgPath, entry] of Object.entries(lock.packages ?? {})) {
    if (!pkgPath) continue; // "" is the root project itself
    const marker = "node_modules/";
    const idx = pkgPath.lastIndexOf(marker);
    if (idx === -1) continue;
    add(pkgPath.slice(idx + marker.length), entry.version);
  }

  const walkV1 = (deps: LockfileV2["dependencies"]) => {
    for (const [name, entry] of Object.entries(deps ?? {})) {
      add(name, entry.version);
      if (entry.dependencies) walkV1(entry.dependencies);
    }
  };
  walkV1(lock.dependencies);

  return Object.fromEntries(
    [...found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort()])
  );
}

export function normalizeAdvisories(response: BulkResponse): Finding[] {
  const findings: Finding[] = [];
  for (const [pkg, advisories] of Object.entries(response)) {
    if (!advisories?.length) continue;

    // One finding per package, worst severity wins — matches how `npm audit`
    // summarises, and keeps a repo with 40 transitive CVEs readable.
    let worst: Severity = "low";
    const titles: string[] = [];
    const ranges = new Set<string>();
    for (const a of advisories) {
      const sev = SEVERITY_MAP[(a.severity ?? "").toLowerCase()] ?? "medium";
      if (sev === "high" || (sev === "medium" && worst === "low")) worst = sev;
      if (a.title) titles.push(a.title);
      if (a.vulnerable_versions) ranges.add(a.vulnerable_versions);
    }

    const detail = titles.length > 0 ? titles.join("; ") : "known vulnerability";
    const range = ranges.size > 0 ? ` (${[...ranges].join(", ")})` : "";
    findings.push({
      id: findingId("npm-audit", pkg, "package.json", null),
      tool: "npm-audit",
      ruleId: pkg,
      severity: worst,
      category: "dependency",
      file: "package.json",
      line: null,
      message: `Vulnerable dependency ${pkg}${range}: ${detail}`,
    });
  }
  return findings;
}

export async function runNpmAdvisories(repoDir: string): Promise<Finding[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(path.join(repoDir, "package-lock.json"), "utf8");
  } catch {
    // No lockfile: exact versions are unknowable, so report nothing rather than
    // guessing from semver ranges in package.json.
    return [];
  }

  const installed = collectInstalled(JSON.parse(raw) as LockfileV2);
  const names = Object.keys(installed);
  if (names.length === 0) return [];

  // The endpoint rejects very large bodies; chunk to stay well inside its limits.
  const CHUNK = 400;
  const merged: BulkResponse = {};
  for (let i = 0; i < names.length; i += CHUNK) {
    const slice = Object.fromEntries(names.slice(i, i + CHUNK).map((n) => [n, installed[n]]));
    const res = await fetch(BULK_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "autoaudit" },
      body: JSON.stringify(slice),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new Error(`npm advisory endpoint returned HTTP ${res.status}`);
    }
    Object.assign(merged, (await res.json()) as BulkResponse);
  }

  return normalizeAdvisories(merged);
}

export const npmAdvisoriesAnalyzer: Analyzer = {
  name: "npm-audit",
  isApplicable: (profile) => profile.hasPackageJson,
  async run(repoDir) {
    try {
      return await runNpmAdvisories(repoDir);
    } catch (err) {
      console.error("[autoaudit] npm advisories lookup failed:", err);
      return [];
    }
  },
};
