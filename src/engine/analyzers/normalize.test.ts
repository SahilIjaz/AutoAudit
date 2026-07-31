import { describe, it, expect } from "vitest";
import { normalizeSemgrep } from "./semgrep";
import { normalizeAdvisories, collectInstalled } from "./npmAdvisories";
import { normalizeEslint } from "./eslint";

describe("normalizeSemgrep", () => {
  it("maps severity, category, and builds a stable id", () => {
    const out = normalizeSemgrep(
      {
        results: [
          {
            check_id: "generic.secrets.detected-stripe-api-key",
            path: "/tmp/repo/src/config.js",
            start: { line: 4 },
            end: { line: 4 },
            extra: { message: "Stripe key", severity: "ERROR" },
          },
        ],
      },
      "/tmp/repo"
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      tool: "semgrep",
      severity: "high",
      category: "security",
      file: "src/config.js",
      line: 4,
    });
    expect(out[0].id).toBe(
      "semgrep:generic.secrets.detected-stripe-api-key:src/config.js:4"
    );
  });
});

describe("collectInstalled", () => {
  it("reads exact versions from a v2/v3 lockfile, ignoring the root entry", () => {
    const out = collectInstalled({
      lockfileVersion: 3,
      packages: {
        "": { version: "1.0.0" },
        "node_modules/lodash": { version: "4.17.11" },
        "node_modules/express": { version: "4.16.0" },
        // Nested duplicate of a different version — both are installed.
        "node_modules/express/node_modules/lodash": { version: "3.10.1" },
      },
    });
    expect(out.lodash).toEqual(["3.10.1", "4.17.11"]);
    expect(out.express).toEqual(["4.16.0"]);
    // The root project isn't a dependency and has no advisories to look up.
    expect(Object.keys(out)).toEqual(["express", "lodash"]);
  });

  it("reads a v1 lockfile's nested tree", () => {
    const out = collectInstalled({
      lockfileVersion: 1,
      dependencies: {
        express: { version: "4.16.0", dependencies: { lodash: { version: "3.10.1" } } },
      },
    });
    expect(out).toEqual({ express: ["4.16.0"], lodash: ["3.10.1"] });
  });

  it("skips non-exact versions the advisory endpoint can't use", () => {
    const out = collectInstalled({
      packages: {
        "node_modules/a": { version: "^1.0.0" },
        "node_modules/b": { version: "file:../local" },
        "node_modules/c": { version: "2.3.4" },
      },
    });
    expect(Object.keys(out)).toEqual(["c"]);
  });
});

describe("normalizeAdvisories", () => {
  it("maps npm severities to our scale, one finding per package at worst severity", () => {
    const out = normalizeAdvisories({
      lodash: [
        { title: "Prototype Pollution", severity: "critical", vulnerable_versions: "<4.17.21" },
        { title: "Command Injection", severity: "moderate", vulnerable_versions: "<4.17.19" },
      ],
      cookie: [{ title: "Bad cookie", severity: "low" }],
      clean: [],
    });

    expect(out).toHaveLength(2); // "clean" has no advisories
    const lodash = out.find((f) => f.ruleId === "lodash")!;
    expect(lodash.severity).toBe("high"); // critical wins over moderate
    expect(lodash.category).toBe("dependency");
    expect(lodash.file).toBe("package.json");
    expect(lodash.message).toContain("Prototype Pollution");
    expect(lodash.message).toContain("Command Injection");
    expect(lodash.id).toBe("npm-audit:lodash:package.json:-");
    expect(out.find((f) => f.ruleId === "cookie")!.severity).toBe("low");
  });
});

describe("normalizeEslint", () => {
  it("flags security rules as security category", () => {
    const out = normalizeEslint(
      [
        {
          filePath: "/tmp/repo/src/utils.js",
          messages: [
            { ruleId: "no-eval", message: "eval is bad", line: 6, endLine: 6 },
            { ruleId: null, message: "parse error", line: 1 },
          ],
        } as never,
      ],
      "/tmp/repo"
    );
    expect(out).toHaveLength(1); // null ruleId skipped
    expect(out[0]).toMatchObject({
      tool: "eslint",
      ruleId: "no-eval",
      category: "security",
      file: "src/utils.js",
      line: 6,
    });
  });
});
