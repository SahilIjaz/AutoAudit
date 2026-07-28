import { describe, it, expect, vi } from "vitest";
import { runAgentLoop } from "./orchestrator";
import { MetricsCollector } from "../metrics/metrics";
import { CONFIG } from "../config";
import type { Finding, RepoProfile } from "../types";

function fakeProfile(): RepoProfile {
  return {
    owner: "o",
    repo: "r",
    headSha: "sha",
    defaultBranch: "main",
    languages: {},
    fileCount: 1,
    totalBytes: 1,
    hasPackageJson: true,
    packageManager: "npm",
    entryPoints: [],
    largeFiles: [],
    frameworks: [],
  };
}

const finding: Finding = {
  id: "semgrep:x:a.js:1",
  tool: "semgrep",
  ruleId: "x",
  severity: "high",
  category: "security",
  file: "a.js",
  line: 1,
  message: "test",
};

const usage = { input_tokens: 10, output_tokens: 5 };

describe("runAgentLoop", () => {
  it("stops when the model stops requesting tools", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "done" }], usage });
    const client = { messages: { create } } as never;
    const metrics = new MetricsCollector();
    const result = await runAgentLoop(client, [finding], {
      repoDir: "/tmp",
      profile: fakeProfile(),
      metrics,
    });
    expect(result.stopReason).toBe("completed");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("respects the max-iteration cap when the model keeps calling tools", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t1", name: "list_files", input: {} }],
      usage,
    });
    const client = { messages: { create } } as never;
    const metrics = new MetricsCollector();
    // list_files will error (repoDir doesn't exist) but that returns is_error,
    // it does not throw — the loop keeps going until the cap.
    const result = await runAgentLoop(client, [finding], {
      repoDir: "/nonexistent-autoaudit-test-dir",
      profile: fakeProfile(),
      metrics,
    });
    expect(result.stopReason).toBe("max_iterations");
    expect(create).toHaveBeenCalledTimes(CONFIG.maxAgentIterations);
  });
});
