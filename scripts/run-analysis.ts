/**
 * CLI harness for the AutoAudit engine — exercises the pipeline with no UI.
 *
 *   tsx scripts/run-analysis.ts <repoUrl|localPath> [--no-agent] [--compare]
 *
 * Examples:
 *   tsx scripts/run-analysis.ts ./fixtures/vuln-repo --no-agent
 *   tsx scripts/run-analysis.ts https://github.com/owner/repo
 *   tsx scripts/run-analysis.ts ./fixtures/vuln-repo --compare
 */
import fs from "node:fs";
import { analyzeToReport } from "../src/engine/index";
import { runExperiment } from "../src/engine/compare/experiment";

// Next.js auto-loads .env.local for the web app; the CLI must do it itself.
if (fs.existsSync(".env.local") && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(".env.local");
}

async function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith("--"));
  const noAgent = args.includes("--no-agent");
  const compare = args.includes("--compare");

  if (!target) {
    console.error("Usage: tsx scripts/run-analysis.ts <repoUrl|localPath> [--no-agent] [--compare]");
    process.exit(1);
  }

  if (compare) {
    console.error(`[autoaudit] running comparison experiment on ${target} …`);
    const result = await runExperiment(target);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.error(`[autoaudit] analyzing ${target}${noAgent ? " (no agent)" : ""} …`);
  const result = await analyzeToReport(target, { agent: !noAgent });
  console.log(JSON.stringify(noAgent ? { profile: result.profile, findings: result.findings } : result, null, 2));
}

main().catch((err) => {
  console.error("[autoaudit] failed:", err);
  process.exit(1);
});
