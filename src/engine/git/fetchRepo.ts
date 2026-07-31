import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import * as tar from "tar";
import { CONFIG } from "../config";
import {
  parseGitHubUrl,
  RepoNotFoundError,
  RepoTooLargeError,
  CloneTimeoutError,
  type ClonedRepo,
} from "./cloneRepo";

/**
 * Gets a repo without the `git` binary: GitHub's tarball endpoint, extracted
 * with a pure-JS tar reader. This is the only acquisition path that works on
 * Vercel, where no binaries exist and only /tmp is writable.
 *
 * A side benefit over `git clone --depth 1`: no .git directory, so the extracted
 * tree is smaller and there is nothing for an analyzer to accidentally scan.
 */

/** GitHub's unauthenticated API allows 60 requests/hour/IP — shared on Vercel. */
function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "autoaudit",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

export interface RepoRef {
  defaultBranch: string;
  headSha: string;
}

/**
 * Resolves the default branch and its head commit. Without this the report can
 * still render, but GitHub deep links would point at a moving branch instead of
 * the exact code that was reviewed — so we degrade rather than fail.
 */
export async function resolveRef(owner: string, repo: string): Promise<RepoRef> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) {
      throw new RepoNotFoundError(`Repository not found or not public: ${owner}/${repo}`);
    }
    if (!res.ok) {
      // Most often a 403 from the unauthenticated rate limit.
      return { defaultBranch: "HEAD", headSha: "" };
    }
    const meta = (await res.json()) as { default_branch?: string };
    const branch = meta.default_branch ?? "HEAD";

    const commitRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`,
      { headers: githubHeaders(), signal: AbortSignal.timeout(15_000) }
    );
    if (!commitRes.ok) return { defaultBranch: branch, headSha: "" };
    const commit = (await commitRes.json()) as { sha?: string };
    return { defaultBranch: branch, headSha: commit.sha ?? "" };
  } catch (err) {
    if (err instanceof RepoNotFoundError) throw err;
    return { defaultBranch: "HEAD", headSha: "" };
  }
}

const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);

/** Paths worth reading. Skips vendored trees and anything that can't be source. */
function shouldExtract(relPath: string): boolean {
  const parts = relPath.split("/");
  if (parts.some((p) => SKIP_DIRS.has(p))) return false;
  // Reject absolute paths and traversal outright — tar entries are untrusted.
  if (path.isAbsolute(relPath) || parts.includes("..")) return false;
  return true;
}

export interface FetchedRepo extends ClonedRepo {
  /** Bytes written to disk. */
  bytes: number;
  fileCount: number;
}

/**
 * Downloads and extracts owner/repo at `ref` into a temp directory.
 *
 * Size is enforced *during* extraction, not after: on a 512 MB /tmp we cannot
 * afford to write a 2 GB repo and measure it afterwards.
 */
export async function fetchRepoTarball(url: string, targetDir?: string): Promise<FetchedRepo> {
  const { owner, repo } = parseGitHubUrl(url);
  const { defaultBranch, headSha } = await resolveRef(owner, repo);
  const ref = headSha || defaultBranch;

  const dir = targetDir ?? (await fsp.mkdtemp(path.join(os.tmpdir(), "autoaudit-")));
  await fsp.mkdir(dir, { recursive: true });

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned || targetDir) return; // caller-owned dirs are theirs to remove
    cleaned = true;
    await fsp.rm(dir, { recursive: true, force: true });
  };

  let bytes = 0;
  let fileCount = 0;

  try {
    const tarUrl = `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`;
    let res: Response;
    try {
      res = await fetch(tarUrl, {
        headers: { "user-agent": "autoaudit" },
        signal: AbortSignal.timeout(CONFIG.cloneTimeoutMs),
      });
    } catch (err) {
      if ((err as Error).name === "TimeoutError") {
        throw new CloneTimeoutError(`Downloading ${owner}/${repo} timed out`);
      }
      throw err;
    }

    if (res.status === 404) {
      throw new RepoNotFoundError(`Repository not found or not public: ${owner}/${repo}`);
    }
    if (!res.ok || !res.body) {
      throw new RepoNotFoundError(`Could not download ${owner}/${repo} (HTTP ${res.status})`);
    }

    let overLimit = false;

    await new Promise<void>((resolve, reject) => {
      const extract = tar.x({
        cwd: dir,
        // GitHub wraps everything in a `${repo}-${ref}/` directory.
        strip: 1,
        // Never honour absolute paths, ownership or links from an untrusted archive.
        preservePaths: false,
        noMtime: true,
        filter: (entryPath, stat) => {
          const rel = entryPath.split("/").slice(1).join("/");
          if (!rel || !shouldExtract(rel)) return false;

          // The second arg is a tar ReadEntry when unpacking; only files and
          // directories are extracted (no symlinks, devices or hardlinks).
          const entry = stat as { type?: string; size?: number };
          if (entry.type === "Directory") return true;
          if (entry.type !== "File") return false;

          const size = entry.size ?? 0;
          if (size > CONFIG.largeFileBytes) return false;

          // Enforced during extraction, not after: on a 512 MB /tmp we cannot
          // write a huge repo first and measure it later. Once over the cap we
          // stop writing and fail after the stream drains.
          if (overLimit) return false;
          bytes += size;
          fileCount++;
          if (bytes > CONFIG.maxRepoBytes || fileCount > CONFIG.maxFilesForAgent) {
            overLimit = true;
            return false;
          }
          return true;
        },
      });
      extract.on("error", reject);
      extract.on("finish", resolve);
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]).pipe(extract);
    });

    if (overLimit) {
      throw new RepoTooLargeError(
        `Repository exceeds this deployment's limit of ${Math.round(
          CONFIG.maxRepoBytes / 1024 / 1024
        )} MB / ${CONFIG.maxFilesForAgent} files. Try a smaller repository, or run AutoAudit locally.`
      );
    }

    return {
      dir: fs.realpathSync(dir),
      owner,
      repo,
      headSha: headSha || ref,
      defaultBranch,
      cleanup,
      bytes,
      fileCount,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/**
 * Directory a given commit extracts to. Verification runs in several requests
 * and a warm serverless instance keeps /tmp, so a second request for the same
 * commit can reuse the tree instead of re-downloading it. Correctness never
 * depends on the cache being there.
 */
export function cacheDirFor(owner: string, repo: string, sha: string): string {
  const key = `${owner}-${repo}-${sha || "head"}`.replace(/[^\w.-]/g, "_");
  return path.join(os.tmpdir(), `autoaudit-cache-${key}`);
}

export async function fetchRepoCached(url: string, sha: string): Promise<FetchedRepo> {
  const { owner, repo } = parseGitHubUrl(url);
  const dir = cacheDirFor(owner, repo, sha);

  // A marker file distinguishes "fully extracted" from "half-written then killed".
  const marker = path.join(dir, ".autoaudit-complete");
  try {
    await fsp.access(marker);
    return {
      dir: fs.realpathSync(dir),
      owner,
      repo,
      headSha: sha,
      defaultBranch: "HEAD",
      cleanup: async () => {},
      bytes: 0,
      fileCount: 0,
    };
  } catch {
    // not cached — extract below
  }

  await fsp.rm(dir, { recursive: true, force: true });
  const fetched = await fetchRepoTarball(url, dir);
  await fsp.writeFile(marker, "");
  return { ...fetched, cleanup: async () => {} };
}
