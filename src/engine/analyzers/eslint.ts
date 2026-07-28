import { ESLint } from "eslint";
import path from "node:path";
import type { Finding, RepoProfile, Category } from "../types";
import { findingId, type Analyzer } from "./types";

// eslint-plugin-security ships flat-config exports but no bundled types.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import securityPlugin from "eslint-plugin-security";

const SECURITY_RULES = new Set(["no-eval", "no-implied-eval", "no-new-func"]);

function categoryFor(ruleId: string | null): Category {
  if (!ruleId) return "code-quality";
  if (ruleId.startsWith("security/") || SECURITY_RULES.has(ruleId)) return "security";
  return "code-quality";
}

export function normalizeEslint(results: ESLint.LintResult[], repoDir: string): Finding[] {
  const findings: Finding[] = [];
  for (const result of results) {
    const file = path.relative(repoDir, result.filePath);
    for (const msg of result.messages) {
      if (!msg.ruleId) continue; // skip parse errors — not actionable findings
      findings.push({
        id: findingId("eslint", msg.ruleId, file, msg.line ?? null),
        tool: "eslint",
        ruleId: msg.ruleId,
        severity: categoryFor(msg.ruleId) === "security" ? "medium" : "low",
        category: categoryFor(msg.ruleId),
        file,
        line: msg.line ?? null,
        endLine: msg.endLine ?? null,
        message: msg.message,
      });
    }
  }
  return findings;
}

export async function runEslintSecurity(
  repoDir: string,
  profile: RepoProfile
): Promise<Finding[]> {
  // SAFETY: overrideConfigFile:true forces our bundled config and never loads
  // the target repo's eslint config or plugins (arbitrary code execution vector).
  const eslint = new ESLint({
    cwd: repoDir,
    overrideConfigFile: true,
    errorOnUnmatchedPattern: false,
    overrideConfig: [
      {
        files: ["**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"],
        ignores: [
          "**/node_modules/**",
          "**/dist/**",
          "**/build/**",
          "**/.next/**",
          ...profile.largeFiles.map((f) => f.split(path.sep).join("/")),
        ],
        languageOptions: {
          ecmaVersion: "latest",
          sourceType: "module",
        },
        plugins: { security: securityPlugin },
        rules: {
          ...(securityPlugin.configs?.recommended?.rules ?? {}),
          "no-eval": "error",
          "no-implied-eval": "error",
          "no-new-func": "error",
        },
      },
    ],
  });

  const results = await eslint.lintFiles(["**/*.{js,jsx,mjs,cjs}"]);
  return normalizeEslint(results, repoDir);
}

export const eslintAnalyzer: Analyzer = {
  name: "eslint",
  isApplicable: () => true,
  async run(repoDir, profile) {
    try {
      return await runEslintSecurity(repoDir, profile);
    } catch (err) {
      console.error("[autoaudit] eslint failed:", err);
      return [];
    }
  },
};
