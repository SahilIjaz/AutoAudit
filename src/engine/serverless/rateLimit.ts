/**
 * Caps how many audits a deployment will run. This is the only thing standing
 * between a public URL and an unbounded Anthropic bill — every audit spends real
 * model credit, so the limit is on *audits started*, not requests served.
 *
 * Two tiers:
 *  - per client IP, to stop one visitor looping it;
 *  - a global daily budget, to bound total spend no matter how many visitors.
 *
 * In-memory and therefore per-instance: on serverless, several warm instances
 * each keep their own counters, so the real global ceiling is a multiple of the
 * configured one. That is a deliberate tradeoff — a durable counter needs an
 * external store (Redis/Postgres), which this deployment intentionally avoids.
 * Treat it as a brake, not a hard cap; set AUDIT_DAILY_LIMIT conservatively.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const IP_WINDOW_MS = 60 * 60 * 1000;

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const ipHits = new Map<string, number[]>();
let dayStart = 0;
let dayCount = 0;

export interface AuditLimitResult {
  allowed: boolean;
  message: string;
  retryAfterMs: number;
  remainingToday: number;
}

/** Vercel sets x-forwarded-for; the first entry is the client. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function checkAuditRateLimit(req: Request, now = Date.now()): AuditLimitResult {
  const perIp = intFromEnv("AUDIT_IP_LIMIT", 3);
  const perDay = intFromEnv("AUDIT_DAILY_LIMIT", 25);

  if (now - dayStart >= DAY_MS) {
    dayStart = now;
    dayCount = 0;
  }

  if (dayCount >= perDay) {
    return {
      allowed: false,
      message:
        "AutoAudit has hit its daily limit of free audits. Try again tomorrow, or run it locally — it's open source.",
      retryAfterMs: dayStart + DAY_MS - now,
      remainingToday: 0,
    };
  }

  const ip = clientIp(req);
  const recent = (ipHits.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  if (recent.length >= perIp) {
    ipHits.set(ip, recent);
    return {
      allowed: false,
      message: `You've run ${perIp} audits in the last hour, which is this demo's limit. Try again later, or run it locally.`,
      retryAfterMs: IP_WINDOW_MS - (now - recent[0]),
      remainingToday: perDay - dayCount,
    };
  }

  recent.push(now);
  ipHits.set(ip, recent);
  dayCount++;

  if (ipHits.size > 5000) {
    for (const [k, times] of ipHits) {
      if (times.every((t) => now - t >= IP_WINDOW_MS)) ipHits.delete(k);
    }
  }

  return { allowed: true, message: "", retryAfterMs: 0, remainingToday: perDay - dayCount };
}

/** Test seam. */
export function resetAuditRateLimit(): void {
  ipHits.clear();
  dayStart = 0;
  dayCount = 0;
}
