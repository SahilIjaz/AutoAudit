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

export interface Toolchain {
  git: string;
  semgrep: string;
  hasRipgrep: boolean;
}

let cachedToolchain: Toolchain | null = null;

/**
 * Verifies the required external tools exist. Throws with install
 * instructions if something is missing. Result is cached per process.
 */
export async function checkToolchain(): Promise<Toolchain> {
  if (cachedToolchain) return cachedToolchain;

  const version = async (cmd: string, args: string[]): Promise<string | null> => {
    try {
      // semgrep's first invocation can take ~10s to initialize.
      const { stdout } = await execa(cmd, args, { timeout: 30_000 });
      return stdout.split("\n")[0].trim();
    } catch {
      return null;
    }
  };

  const git = await version("git", ["--version"]);
  if (!git) {
    throw new Error("git is required but was not found on PATH. Install git >= 2.x.");
  }

  const semgrep = await version("semgrep", ["--version"]);
  if (!semgrep) {
    throw new Error(
      "semgrep is required but was not found on PATH. Install it with `brew install semgrep` (macOS) or `pipx install semgrep`."
    );
  }

  const rg = await version("rg", ["--version"]);

  cachedToolchain = { git, semgrep, hasRipgrep: rg !== null };
  return cachedToolchain;
}
