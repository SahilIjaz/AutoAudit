import type { Finding, RepoProfile } from "../types";

export interface Analyzer {
  name: Finding["tool"];
  isApplicable(profile: RepoProfile): boolean;
  /** Never throws — returns [] and logs on tool failure. */
  run(repoDir: string, profile: RepoProfile): Promise<Finding[]>;
}

export function findingId(
  tool: Finding["tool"],
  ruleId: string,
  file: string | null,
  line: number | null
): string {
  return `${tool}:${ruleId}:${file ?? "-"}:${line ?? "-"}`;
}
