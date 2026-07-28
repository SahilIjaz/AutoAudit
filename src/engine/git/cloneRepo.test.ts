import { describe, it, expect } from "vitest";
import { parseGitHubUrl, RepoUrlError } from "./cloneRepo";

describe("parseGitHubUrl", () => {
  it("accepts a canonical https URL", () => {
    expect(parseGitHubUrl("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("accepts a .git suffix and trailing slash", () => {
    expect(parseGitHubUrl("https://github.com/owner/repo.git/")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("accepts dashes and dots in names", () => {
    expect(parseGitHubUrl("https://github.com/my-org/my.repo")).toEqual({
      owner: "my-org",
      repo: "my.repo",
    });
  });

  it.each([
    "http://github.com/owner/repo",
    "https://gitlab.com/owner/repo",
    "git@github.com:owner/repo.git",
    "https://github.com/owner",
    "https://github.com/owner/repo/tree/main",
    "https://github.com/../../etc/passwd",
    "ftp://github.com/owner/repo",
    "https://evil.com/github.com/owner/repo",
  ])("rejects %s", (url) => {
    expect(() => parseGitHubUrl(url)).toThrow(RepoUrlError);
  });
});
