import { describe, expect, it } from "vitest";
import { scanText } from "./secretScan";

describe("scanText", () => {
  it("flags known provider key formats", () => {
    const cases: [string, string][] = [
      // Deliberately not AWS's documented AKIAIOSFODNN7EXAMPLE — that contains
      // "EXAMPLE" and the placeholder filter correctly rejects it.
      ["aws-access-key-id", "const k = 'AKIA4RQ7TZK2WPLM93XD'"],
      ["github-token", "TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
      ["stripe-secret-key", "const s = 'sk_live_abcdef1234567890'"],
      ["google-api-key", "key: 'AIzaSyA1234567890abcdefghijklmnopqrstuv'"],
      ["private-key-block", "-----BEGIN RSA PRIVATE KEY-----"],
      ["database-url-with-password", "DB='postgres://admin:hunter2pass@db.internal:5432/app'"],
    ];
    for (const [ruleId, line] of cases) {
      const out = scanText("src/config.js", line);
      expect(out.map((f) => f.ruleId), `expected ${ruleId} for: ${line}`).toContain(ruleId);
    }
  });

  it("catches secret-shaped assignments generically", () => {
    const out = scanText("src/config.js", `const DB_PASSWORD = "s0me-real-looking-password";`);
    expect(out).toHaveLength(1);
    expect(out[0].ruleId).toBe("hardcoded-secret-assignment");
    expect(out[0].severity).toBe("high");
    expect(out[0].category).toBe("security");
  });

  it("ignores placeholders and env lookups", () => {
    const benign = [
      `const API_KEY = "YOUR_API_KEY_HERE";`,
      `const API_KEY = "changeme";`,
      `const API_KEY = process.env.API_KEY;`,
      `API_SECRET="<your-secret-here>"`,
      `PASSWORD="xxxxxxxxxxxx"`,
      `const API_KEY = "example-key-placeholder";`,
    ];
    for (const line of benign) {
      expect(scanText("README.md", line), `should ignore: ${line}`).toEqual([]);
    }
  });

  it("records the right file and 1-based line, and one finding per rule per line", () => {
    const content = ["// header", "", `const SECRET_TOKEN = "abcdefghijklmnop";`].join("\n");
    const out = scanText("app/config.ts", content);
    expect(out).toHaveLength(1);
    expect(out[0].file).toBe("app/config.ts");
    expect(out[0].line).toBe(3);
    expect(out[0].id).toBe("secret-scan:hardcoded-secret-assignment:app/config.ts:3");
    expect(out[0].tool).toBe("secret-scan");
  });

  it("skips generated single-line bundles rather than flooding the report", () => {
    const minified = `var a=1;`.repeat(200) + `const API_KEY="abcdefghijklmnop";`;
    expect(minified.length).toBeGreaterThan(1000);
    expect(scanText("dist/bundle.js", minified)).toEqual([]);
  });
});
