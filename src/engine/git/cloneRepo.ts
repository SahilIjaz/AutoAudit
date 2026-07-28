import { execa } from "execa";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CONFIG } from "../config";

export class RepoUrlError extends Error {}
export class RepoNotFoundError extends Error {}
export class CloneTimeoutError extends Error {}
export class RepoTooLargeError extends Error {}

export interface ClonedRepo {
  /** realpath of the temp clone dir */
  dir: string;
  owner: string;
  repo: string;
  headSha: string;
  defaultBranch: string;
  cleanup(): Promise<void>;
}

const GITHUB_URL_RE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(\.git)?\/?$/;

export function parseGitHubUrl(url: string): { owner: string; repo: string } {
  const m = GITHUB_URL_RE.exec(url.trim());
  if (!m) {
    throw new RepoUrlError(
      "Only public GitHub HTTPS URLs are supported, e.g. https://github.com/owner/repo"
    );
  }
  const [, owner, repo] = m;
  if (owner === "." || owner === ".." || repo === "." || repo === "..") {
    throw new RepoUrlError("Invalid owner or repository name");
  }
  return { owner, repo };
}

async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeBytes(full);
    } else if (entry.isFile()) {
      const stat = await fsp.stat(full);
      total += stat.size;
    }
    if (total > CONFIG.maxRepoBytes) return total;
  }
  return total;
}

export async function cloneRepo(url: string): Promise<ClonedRepo> {
  const { owner, repo } = parseGitHubUrl(url);
  const canonicalUrl = `https://github.com/${owner}/${repo}.git`;

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "autoaudit-"));
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await fsp.rm(tmpDir, { recursive: true, force: true });
  };

  try {
    try {
      await execa(
        "git",
        ["clone", "--depth", "1", "--single-branch", canonicalUrl, tmpDir],
        {
          timeout: CONFIG.cloneTimeoutMs,
          env: { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" },
        }
      );
    } catch (err: unknown) {
      const e = err as { timedOut?: boolean; stderr?: string };
      if (e.timedOut) {
        throw new CloneTimeoutError(`Cloning ${canonicalUrl} timed out`);
      }
      // Private and nonexistent repos are indistinguishable without auth.
      throw new RepoNotFoundError(
        `Repository not found or not public: ${owner}/${repo}`
      );
    }

    const size = await dirSizeBytes(tmpDir);
    if (size > CONFIG.maxRepoBytes) {
      throw new RepoTooLargeError(
        `Repository exceeds the ${Math.round(CONFIG.maxRepoBytes / 1024 / 1024)} MB limit`
      );
    }

    const { stdout: headSha } = await execa("git", ["rev-parse", "HEAD"], {
      cwd: tmpDir,
      timeout: 10_000,
    });
    const { stdout: defaultBranch } = await execa(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: tmpDir, timeout: 10_000 }
    );

    return {
      dir: fs.realpathSync(tmpDir),
      owner,
      repo,
      headSha: headSha.trim(),
      defaultBranch: defaultBranch.trim(),
      cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/**
 * Wraps an already-existing local directory (e.g. the fixture repo) in the
 * ClonedRepo interface so the CLI harness can analyze it without GitHub.
 * cleanup() is a no-op — we don't own the directory.
 */
export async function useLocalRepo(dir: string): Promise<ClonedRepo> {
  const real = fs.realpathSync(dir);
  let headSha = "local";
  let defaultBranch = "local";
  try {
    const { stdout } = await execa("git", ["rev-parse", "HEAD"], {
      cwd: real,
      timeout: 10_000,
    });
    headSha = stdout.trim();
    const { stdout: branch } = await execa(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: real, timeout: 10_000 }
    );
    defaultBranch = branch.trim();
  } catch {
    // not a git repo — fine for local fixtures
  }
  return {
    dir: real,
    owner: "local",
    repo: path.basename(real),
    headSha,
    defaultBranch,
    cleanup: async () => {},
  };
}

/**
 * Best-effort removal of stale autoaudit-* temp dirs older than 1h,
 * in case a previous process crashed before cleanup.
 */
export async function sweepStaleTempDirs(): Promise<void> {
  const tmp = os.tmpdir();
  let entries: string[];
  try {
    entries = await fsp.readdir(tmp);
  } catch {
    return;
  }
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const name of entries) {
    if (!name.startsWith("autoaudit-")) continue;
    const full = path.join(tmp, name);
    try {
      const stat = await fsp.stat(full);
      if (stat.mtimeMs < cutoff) {
        await fsp.rm(full, { recursive: true, force: true });
      }
    } catch {
      // ignore — best effort
    }
  }
}
