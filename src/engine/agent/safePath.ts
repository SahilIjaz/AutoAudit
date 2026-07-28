import fs from "node:fs";
import path from "node:path";

export class PathTraversalError extends Error {}

/**
 * Resolve a model-supplied, repo-relative path and guarantee it stays inside
 * `rootRealPath`. This is the single security chokepoint every agent tool uses.
 *
 * Rejects: null bytes, empty/whitespace paths, absolute paths, and any path
 * that escapes the root — including via symlinks inside the repo pointing out
 * (defeated by realpath-ing the deepest existing ancestor).
 *
 * `rootRealPath` MUST already be a realpath (cloneRepo returns one).
 */
export function resolveWithin(rootRealPath: string, userPath: string): string {
  if (typeof userPath !== "string" || userPath.trim() === "") {
    throw new PathTraversalError("Empty path");
  }
  if (userPath.includes("\0")) {
    throw new PathTraversalError("Null byte in path");
  }
  // Explicitly reject encoded traversal even though it wouldn't resolve to a
  // real file — defense in depth.
  if (/%2e|%2f|%5c/i.test(userPath)) {
    throw new PathTraversalError("Encoded path segment not allowed");
  }
  if (path.isAbsolute(userPath)) {
    throw new PathTraversalError("Absolute paths are not allowed");
  }

  const resolved = path.resolve(rootRealPath, userPath);

  // Walk up to the deepest ancestor that exists, realpath it, and re-append the
  // not-yet-existing tail. This defeats symlink escapes on existing segments.
  let existing = resolved;
  const tail: string[] = [];
  while (!fs.existsSync(existing)) {
    tail.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break; // reached filesystem root
    existing = parent;
  }
  const realExisting = fs.realpathSync(existing);
  const finalPath = tail.length > 0 ? path.join(realExisting, ...tail) : realExisting;

  if (finalPath !== rootRealPath && !finalPath.startsWith(rootRealPath + path.sep)) {
    throw new PathTraversalError("Path escapes the repository root");
  }
  return finalPath;
}
