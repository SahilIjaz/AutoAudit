import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveWithin, PathTraversalError } from "./safePath";

let root: string;
let outside: string;

beforeAll(async () => {
  root = fs.realpathSync(await fsp.mkdtemp(path.join(os.tmpdir(), "safepath-root-")));
  outside = fs.realpathSync(await fsp.mkdtemp(path.join(os.tmpdir(), "safepath-out-")));
  await fsp.mkdir(path.join(root, "src"));
  await fsp.writeFile(path.join(root, "src", "a.js"), "ok");
  await fsp.writeFile(path.join(outside, "secret.txt"), "secret");
  // Symlink inside root pointing outside it.
  await fsp.symlink(outside, path.join(root, "escape"));
});

afterAll(async () => {
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(outside, { recursive: true, force: true });
});

describe("resolveWithin", () => {
  it("resolves a normal repo-relative path", () => {
    expect(resolveWithin(root, "src/a.js")).toBe(path.join(root, "src", "a.js"));
  });

  it("allows the root itself", () => {
    expect(resolveWithin(root, ".")).toBe(root);
  });

  it.each([
    "../../etc/passwd",
    "src/../../../../etc/passwd",
    "/etc/passwd",
    "a/../../..",
    "%2e%2e/secret",
    "..%2f..%2fetc",
    "\0evil",
    "",
    "   ",
  ])("rejects %j", (p) => {
    expect(() => resolveWithin(root, p)).toThrow(PathTraversalError);
  });

  it("rejects a symlink inside the repo that points outside", () => {
    expect(() => resolveWithin(root, "escape/secret.txt")).toThrow(PathTraversalError);
  });
});
