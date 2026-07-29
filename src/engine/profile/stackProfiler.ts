import fsp from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "../config";
import type { RepoProfile } from "../types";
import type { ClonedRepo } from "../git/cloneRepo";

export class UnsupportedRepoError extends Error {}

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "out", "coverage", "vendor"]);

const KNOWN_FRAMEWORK_DEPS: Record<string, string> = {
  next: "next",
  react: "react",
  express: "express",
  fastify: "fastify",
  koa: "koa",
  vue: "vue",
  svelte: "svelte",
  "@angular/core": "angular",
  "@nestjs/core": "nestjs",
};

interface WalkResult {
  languages: Record<string, number>;
  fileCount: number;
  totalBytes: number;
  largeFiles: string[];
}

async function walk(root: string): Promise<WalkResult> {
  const result: WalkResult = { languages: {}, fileCount: 0, totalBytes: 0, largeFiles: [] };

  async function visit(dir: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await visit(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      const ext = path.extname(entry.name).toLowerCase() || "(none)";
      result.languages[ext] = (result.languages[ext] ?? 0) + 1;
      result.fileCount++;
      const stat = await fsp.stat(full);
      result.totalBytes += stat.size;
      if (stat.size > CONFIG.largeFileBytes) result.largeFiles.push(rel);
    }
  }

  await visit(root);
  return result;
}

export async function profileRepo(
  repoDir: string,
  meta: Pick<ClonedRepo, "owner" | "repo" | "headSha" | "defaultBranch">
): Promise<RepoProfile> {
  const walked = await walk(repoDir);

  let hasPackageJson = false;
  let packageManager: RepoProfile["packageManager"] = null;
  const entryPoints: string[] = [];
  const frameworks: string[] = [];

  try {
    const raw = await fsp.readFile(path.join(repoDir, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      main?: string;
      bin?: string | Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    hasPackageJson = true;
    if (typeof pkg.main === "string") entryPoints.push(pkg.main);
    if (typeof pkg.bin === "string") entryPoints.push(pkg.bin);
    else if (pkg.bin) entryPoints.push(...Object.values(pkg.bin));

    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [dep, name] of Object.entries(KNOWN_FRAMEWORK_DEPS)) {
      if (deps[dep]) frameworks.push(name);
    }
  } catch {
    // no package.json or unparseable — handled below
  }

  const exists = async (p: string) => {
    try {
      await fsp.stat(path.join(repoDir, p));
      return true;
    } catch {
      return false;
    }
  };
  for (const candidate of ["src/index.ts", "src/index.js", "index.js", "index.ts", "app", "pages", "src/app"]) {
    if (await exists(candidate)) entryPoints.push(candidate);
  }

  if (await exists("package-lock.json")) packageManager = "npm";
  else if (await exists("yarn.lock")) packageManager = "yarn";
  else if (await exists("pnpm-lock.yaml")) packageManager = "pnpm";
  else if (hasPackageJson) packageManager = "npm";

  // AutoAudit analyzes repos of any language: Semgrep's rule packs are
  // multi-language and the agent reads files regardless of language. The only
  // thing worth rejecting is a repo with nothing to scan.
  if (walked.fileCount === 0) {
    throw new UnsupportedRepoError("No source files found in the repository — nothing to analyze.");
  }

  return {
    owner: meta.owner,
    repo: meta.repo,
    headSha: meta.headSha,
    defaultBranch: meta.defaultBranch,
    languages: walked.languages,
    fileCount: walked.fileCount,
    totalBytes: walked.totalBytes,
    hasPackageJson,
    packageManager,
    entryPoints: [...new Set(entryPoints)],
    largeFiles: walked.largeFiles,
    frameworks,
  };
}
