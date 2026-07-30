import { beforeEach, describe, expect, it } from "vitest";
import { CONFIG } from "../config";
import { checkEmailRateLimit, normalizeEmail, resetEmailRateLimit } from "./rateLimit";

const { max, windowMs } = CONFIG.emailRateLimit;

describe("email rate limit", () => {
  beforeEach(resetEmailRateLimit);

  it("allows up to the cap, then blocks", () => {
    for (let i = 0; i < max; i++) {
      expect(checkEmailRateLimit("a@b.com").allowed).toBe(true);
    }
    const blocked = checkEmailRateLimit("a@b.com");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("treats casing and whitespace variants as one address", () => {
    const now = Date.now();
    for (let i = 0; i < max; i++) {
      checkEmailRateLimit("a@b.com", { now });
    }
    expect(checkEmailRateLimit("  A@B.COM  ", { now }).allowed).toBe(false);
  });

  it("does not consume a slot when peeking", () => {
    for (let i = 0; i < max * 3; i++) {
      expect(checkEmailRateLimit("a@b.com", { record: false }).allowed).toBe(true);
    }
    expect(checkEmailRateLimit("a@b.com").allowed).toBe(true);
  });

  it("forgets hits once the window passes", () => {
    const start = 1_000_000;
    for (let i = 0; i < max; i++) {
      checkEmailRateLimit("a@b.com", { now: start });
    }
    expect(checkEmailRateLimit("a@b.com", { now: start + 1 }).allowed).toBe(false);
    expect(checkEmailRateLimit("a@b.com", { now: start + windowMs + 1 }).allowed).toBe(true);
  });

  it("keeps addresses in separate buckets", () => {
    for (let i = 0; i < max; i++) checkEmailRateLimit("a@b.com");
    expect(checkEmailRateLimit("c@d.com").allowed).toBe(true);
  });

  it("normalizes for display and delivery", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });
});
