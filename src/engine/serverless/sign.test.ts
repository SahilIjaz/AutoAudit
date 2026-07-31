import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Finding } from "../types";
import {
  FindingsTamperedError,
  signFindings,
  verifySignedFindings,
  type SignedFinding,
} from "./sign";

const REPO = "https://github.com/acme/app";
const SHA = "abc1234";

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "secret-scan:aws-access-key-id:src/config.ts:12",
    tool: "secret-scan",
    ruleId: "aws-access-key-id",
    severity: "high",
    category: "security",
    file: "src/config.ts",
    line: 12,
    message: "AWS access key ID appears to be hardcoded.",
    ...over,
  };
}

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.FINDINGS_SIGNING_SECRET;
  process.env.FINDINGS_SIGNING_SECRET = "test-secret-value-long-enough";
});
afterEach(() => {
  if (saved === undefined) delete process.env.FINDINGS_SIGNING_SECRET;
  else process.env.FINDINGS_SIGNING_SECRET = saved;
});

describe("finding signatures", () => {
  it("round-trips and strips the signature back off", () => {
    const signed = signFindings(REPO, SHA, [finding()]);
    expect(signed[0].sig).toMatch(/^[0-9a-f]{64}$/);

    const out = verifySignedFindings(REPO, SHA, signed);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toHaveProperty("sig");
    expect(out[0].id).toBe(finding().id);
  });

  it("validates any subset, so verification can run in batches", () => {
    const signed = signFindings(REPO, SHA, [
      finding({ id: "a" }),
      finding({ id: "b" }),
      finding({ id: "c" }),
    ]);
    expect(verifySignedFindings(REPO, SHA, [signed[1]])).toHaveLength(1);
    expect(verifySignedFindings(REPO, SHA, [signed[0], signed[2]])).toHaveLength(2);
  });

  it("rejects an invented finding — the guarantee the product sells", () => {
    const invented: SignedFinding = { ...finding({ id: "made-up" }), sig: "00".repeat(32) };
    expect(() => verifySignedFindings(REPO, SHA, [invented])).toThrow(FindingsTamperedError);
  });

  it("rejects a finding whose contents were edited after signing", () => {
    const [signed] = signFindings(REPO, SHA, [finding()]);
    for (const tampered of [
      { ...signed, message: "something far worse" },
      { ...signed, severity: "high" as const, file: "other.ts" },
      { ...signed, line: 999 },
      { ...signed, id: "different-id" },
    ]) {
      expect(() => verifySignedFindings(REPO, SHA, [tampered])).toThrow(FindingsTamperedError);
    }
  });

  it("refuses a finding replayed against a different repo or commit", () => {
    const signed = signFindings(REPO, SHA, [finding()]);
    expect(() => verifySignedFindings("https://github.com/acme/other", SHA, signed)).toThrow(
      FindingsTamperedError
    );
    expect(() => verifySignedFindings(REPO, "deadbeef", signed)).toThrow(FindingsTamperedError);
  });

  it("rejects malformed signatures without throwing something unexpected", () => {
    for (const sig of ["", "not-hex", "abc"]) {
      const bad: SignedFinding = { ...finding(), sig };
      expect(() => verifySignedFindings(REPO, SHA, [bad])).toThrow(FindingsTamperedError);
    }
  });

  it("refuses to sign without a usable secret, rather than signing with a weak one", () => {
    delete process.env.FINDINGS_SIGNING_SECRET;
    expect(() => signFindings(REPO, SHA, [finding()])).toThrow(/FINDINGS_SIGNING_SECRET/);

    process.env.FINDINGS_SIGNING_SECRET = "tooshort";
    expect(() => signFindings(REPO, SHA, [finding()])).toThrow(/FINDINGS_SIGNING_SECRET/);
  });

  it("treats a missing secret at verify time as invalid, never as a pass", () => {
    const signed = signFindings(REPO, SHA, [finding()]);
    delete process.env.FINDINGS_SIGNING_SECRET;
    expect(() => verifySignedFindings(REPO, SHA, signed)).toThrow(FindingsTamperedError);
  });
});
