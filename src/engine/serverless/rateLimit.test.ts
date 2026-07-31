import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAuditRateLimit, clientIp, resetAuditRateLimit } from "./rateLimit";

function req(ip: string): Request {
  return new Request("https://autoaudit.test/api/scan", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

const ENV = ["AUDIT_IP_LIMIT", "AUDIT_DAILY_LIMIT"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  resetAuditRateLimit();
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("audit rate limit", () => {
  it("caps one visitor without blocking others", () => {
    process.env.AUDIT_IP_LIMIT = "2";
    process.env.AUDIT_DAILY_LIMIT = "100";

    expect(checkAuditRateLimit(req("1.1.1.1")).allowed).toBe(true);
    expect(checkAuditRateLimit(req("1.1.1.1")).allowed).toBe(true);
    const blocked = checkAuditRateLimit(req("1.1.1.1"));
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);

    // A different visitor is unaffected.
    expect(checkAuditRateLimit(req("2.2.2.2")).allowed).toBe(true);
  });

  it("stops spending once the daily budget is gone, whoever is asking", () => {
    process.env.AUDIT_IP_LIMIT = "50";
    process.env.AUDIT_DAILY_LIMIT = "3";

    expect(checkAuditRateLimit(req("1.1.1.1")).allowed).toBe(true);
    expect(checkAuditRateLimit(req("2.2.2.2")).allowed).toBe(true);
    expect(checkAuditRateLimit(req("3.3.3.3")).allowed).toBe(true);

    const blocked = checkAuditRateLimit(req("4.4.4.4"));
    expect(blocked.allowed).toBe(false);
    expect(blocked.message).toMatch(/daily limit/i);
    expect(blocked.remainingToday).toBe(0);
  });

  it("reports the remaining daily budget as it is spent", () => {
    process.env.AUDIT_DAILY_LIMIT = "5";
    expect(checkAuditRateLimit(req("1.1.1.1")).remainingToday).toBe(4);
    expect(checkAuditRateLimit(req("2.2.2.2")).remainingToday).toBe(3);
  });

  it("frees the per-visitor window once an hour passes", () => {
    process.env.AUDIT_IP_LIMIT = "1";
    process.env.AUDIT_DAILY_LIMIT = "100";
    const t0 = 5_000_000;

    expect(checkAuditRateLimit(req("1.1.1.1"), t0).allowed).toBe(true);
    expect(checkAuditRateLimit(req("1.1.1.1"), t0 + 1000).allowed).toBe(false);
    expect(checkAuditRateLimit(req("1.1.1.1"), t0 + 60 * 60 * 1000 + 1).allowed).toBe(true);
  });

  it("rolls the daily budget over to the next day", () => {
    process.env.AUDIT_DAILY_LIMIT = "1";
    const t0 = 9_000_000;
    expect(checkAuditRateLimit(req("1.1.1.1"), t0).allowed).toBe(true);
    expect(checkAuditRateLimit(req("2.2.2.2"), t0 + 1000).allowed).toBe(false);
    expect(checkAuditRateLimit(req("2.2.2.2"), t0 + 24 * 60 * 60 * 1000 + 1).allowed).toBe(true);
  });

  it("reads the client address from the proxy header Vercel sets", () => {
    expect(clientIp(req("9.9.9.9, 10.0.0.1"))).toBe("9.9.9.9");
    expect(clientIp(new Request("https://x.test"))).toBe("unknown");
  });
});
