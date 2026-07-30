import { describe, expect, it } from "vitest";
import {
  normalizeFinding,
  PLAIN_IMPACT_MAX,
  PLAIN_TITLE_MAX,
  type VerifiedFindingModelOutput,
} from "./schema";

const base: VerifiedFindingModelOutput = {
  findingId: "semgrep:rule:app.ts:3",
  verdict: "confirmed",
  severity: "high",
  category: "security",
  file: "app.ts",
  line: 3,
  title: "Hardcoded credential in generic.secrets.security-detected-generic-api-key",
  explanation:
    "The literal on line 3 is a live API key. It is committed to the repository, so anyone with read access to the history can use it. Rotating is required.",
  evidence: "Semgrep flagged it; read_file confirmed a 40-char high-entropy literal.",
  suggestedFix: "Move the key to an environment variable. Then rotate the exposed credential.",
  contextSnippet: "3\tconst KEY = 'sk-live-...'",
};

describe("normalizeFinding", () => {
  it("keeps the model's plain-language layer when provided", () => {
    const f = normalizeFinding({
      ...base,
      plainTitle: "A password is written directly into the code",
      plainImpact: "Anyone who can see this project can log in as you.",
      plainFix: "Move it into an environment variable and change the password.",
    });
    expect(f.plainTitle).toBe("A password is written directly into the code");
    expect(f.plainImpact).toBe("Anyone who can see this project can log in as you.");
    expect(f.plainFix).toBe("Move it into an environment variable and change the password.");
  });

  it("derives short fallbacks when the plain fields are missing", () => {
    const f = normalizeFinding(base);
    expect(f.plainTitle.length).toBeLessThanOrEqual(PLAIN_TITLE_MAX + 1);
    // Fallback impact is the first sentence of the explanation, not all of it.
    expect(f.plainImpact).toBe("The literal on line 3 is a live API key.");
    // Fallback fix is the first instruction only.
    expect(f.plainFix).toBe("Move the key to an environment variable.");
  });

  it("truncates over-long plain text at a word boundary instead of failing", () => {
    const f = normalizeFinding({
      ...base,
      plainImpact: "word ".repeat(120),
    });
    expect(f.plainImpact.length).toBeLessThanOrEqual(PLAIN_IMPACT_MAX + 1);
    expect(f.plainImpact.endsWith("…")).toBe(true);
  });

  it("leaves plainFix null when there is nothing to do", () => {
    const f = normalizeFinding({ ...base, verdict: "false_positive", suggestedFix: null });
    expect(f.plainFix).toBeNull();
  });

  it("preserves the technical fields for the deep view", () => {
    const f = normalizeFinding(base);
    expect(f.title).toBe(base.title);
    expect(f.explanation).toBe(base.explanation);
    expect(f.evidence).toBe(base.evidence);
    expect(f.contextSnippet).toBe(base.contextSnippet);
  });
});
