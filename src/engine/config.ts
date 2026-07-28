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
  maxRepoBytes: 200 * 1024 * 1024,
  maxFilesForAgent: 5_000,
  maxAgentIterations: 25,
  /** Cap on findings handed to the agent; overflow reported as "unverified". */
  maxFindingsToAgent: 40,
  maxToolResultChars: 20_000,
  maxFileReadLines: 400,
  maxOutputValidationRetries: 3,
  largeFileBytes: 500 * 1024,
  jobTtlMs: 60 * 60 * 1000,
} as const;

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
