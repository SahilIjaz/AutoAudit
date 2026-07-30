import { CONFIG } from "../config";

/**
 * Per-address send cap. The email field sits on an open form, so without this
 * anyone could point AutoAudit at a stranger's inbox and use it as a relay.
 * In-memory and per-process — the same tradeoff the JobStore already makes.
 */
const hits = new Map<string, number[]>();

/** Lowercased + trimmed, so casing variants share one bucket. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface RateLimitResult {
  allowed: boolean;
  /** Sends left in the current window, after this one. */
  remaining: number;
  retryAfterMs: number;
}

/**
 * `record: false` peeks without consuming a slot — the API route uses it to
 * reject a submission up front, and the actual send consumes the slot later.
 */
export function checkEmailRateLimit(
  email: string,
  { record = true, now = Date.now() }: { record?: boolean; now?: number } = {}
): RateLimitResult {
  const { max, windowMs } = CONFIG.emailRateLimit;
  const key = normalizeEmail(email);
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

  if (recent.length >= max) {
    hits.set(key, recent);
    const retryAfterMs = windowMs - (now - recent[0]);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  if (!record) {
    hits.set(key, recent);
    return { allowed: true, remaining: max - recent.length, retryAfterMs: 0 };
  }

  recent.push(now);
  hits.set(key, recent);

  // Opportunistic sweep so abandoned buckets don't accumulate.
  if (hits.size > 1000) {
    for (const [k, times] of hits) {
      if (times.every((t) => now - t >= windowMs)) hits.delete(k);
    }
  }

  return { allowed: true, remaining: max - recent.length, retryAfterMs: 0 };
}

/** Test seam. */
export function resetEmailRateLimit(): void {
  hits.clear();
}
