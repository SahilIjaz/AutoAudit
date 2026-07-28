import { describe, it, expect } from "vitest";
import { normalizeSemgrep } from "./semgrep";
import { normalizeNpmAudit } from "./npmAudit";
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

describe("normalizeNpmAudit", () => {
  it("maps npm severities to our scale, category dependency", () => {
    const out = normalizeNpmAudit({
      vulnerabilities: {
        lodash: {
          name: "lodash",
          severity: "critical",
          range: "<4.17.21",
          via: [{ title: "Prototype Pollution" }],
        },
        cookie: { name: "cookie", severity: "low", via: [] },
      },
    });
    const lodash = out.find((f) => f.ruleId === "lodash")!;
    expect(lodash.severity).toBe("high");
    expect(lodash.category).toBe("dependency");
    expect(lodash.file).toBe("package.json");
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
