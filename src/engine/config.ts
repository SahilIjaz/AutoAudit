import { execa } from "execa";

export const CONFIG = {
  model: "claude-sonnet-5",
  /** USD per million tokens. Sonnet 5 sticker pricing ($2/$10 intro through 2026-08-31). */
  pricingPerMTok: {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  cloneTimeoutMs: 60_000,
  subprocessTimeoutMs: 120_000,
  /** Serverless /tmp is 512 MB and shared with the extracted tarball. */
  maxRepoBytes: 60 * 1024 * 1024,
  maxFilesForAgent: 5_000,
  maxAgentIterations: 25,
  /** Cap on findings handed to the agent; overflow reported as "unverified". */
  maxFindingsToAgent: 40,
  /**
   * Serverless verification is batched: each request verifies a few findings so
   * it finishes well inside a function's time limit, and the browser drives the
   * loop. Smaller batches = more requests but no timeout risk.
   */
  verifyBatchSize: 4,
  /** Tool-calling turns allowed per batch (the full cap applies to a whole run). */
  maxIterationsPerBatch: 8,
  maxToolResultChars: 20_000,
  maxFileReadLines: 400,
  maxOutputValidationRetries: 3,
  largeFileBytes: 500 * 1024,
  jobTtlMs: 60 * 60 * 1000,
  /** Findings listed in the email body; the rest live in the attachment only. */
  maxFindingsInEmail: 15,
  /** Per-address send cap, so an open form can't be used as a mail relay. */
  emailRateLimit: { max: 5, windowMs: 60 * 60 * 1000 },
} as const;

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  /** Public base URL for report links. Omitted when only running locally. */
  baseUrl: string | null;
}

/**
 * SMTP settings from the environment. Returns null when unconfigured — the
 * email feature then reports itself as unavailable instead of half-working.
 */
export function mailConfig(): MailConfig | null {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;

  const port = Number(process.env.SMTP_PORT ?? 465);
  return {
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port,
    // 465 is implicit TLS; 587 upgrades via STARTTLS.
    secure: port === 465,
    user,
    pass,
    from: process.env.MAIL_FROM ?? `AutoAudit <${user}>`,
    baseUrl: process.env.APP_BASE_URL?.replace(/\/$/, "") ?? null,
  };
}

export function isEmailEnabled(): boolean {
  return mailConfig() !== null;
}

/**
 * What this environment can actually do. AutoAudit runs in two places with very
 * different capabilities:
 *
 *  - Local / CLI: git and Semgrep on PATH, so the full analyzer set runs.
 *  - Vercel (serverless): no binaries at all. Repos arrive as GitHub tarballs
 *    and only the pure-JS analyzers run.
 *
 * Nothing here throws. A missing binary downgrades the analyzer set rather than
 * failing the run, because on Vercel every binary is missing by definition.
 */
export interface Capabilities {
  git: string | null;
  semgrep: string | null;
  /** True when nothing can be shelled out to — i.e. a serverless function. */
  jsOnly: boolean;
}

let cached: Capabilities | null = null;

/** Set VERCEL/AUTOAUDIT_JS_ONLY to skip probing entirely — no binaries exist there. */
function forcedJsOnly(): boolean {
  return Boolean(process.env.VERCEL) || process.env.AUTOAUDIT_JS_ONLY === "1";
}

export async function detectCapabilities(): Promise<Capabilities> {
  if (cached) return cached;

  if (forcedJsOnly()) {
    cached = { git: null, semgrep: null, jsOnly: true };
    return cached;
  }

  const version = async (cmd: string, args: string[]): Promise<string | null> => {
    try {
      // semgrep's first invocation can take ~10s to initialize.
      const { stdout } = await execa(cmd, args, { timeout: 30_000 });
      return stdout.split("\n")[0].trim();
    } catch {
      return null;
    }
  };

  const [git, semgrep] = await Promise.all([
    version("git", ["--version"]),
    version("semgrep", ["--version"]),
  ]);

  cached = { git, semgrep, jsOnly: git === null && semgrep === null };
  return cached;
}

/** Test seam. */
export function resetCapabilities(): void {
  cached = null;
}
