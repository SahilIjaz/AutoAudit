import nodemailer, { type Transporter } from "nodemailer";
import { mailConfig } from "../config";
import type { AuditReport } from "../types";
import { renderReportEmail, renderFailureEmail } from "./renderEmail";
import { renderReportAttachment } from "./renderAttachment";
import { checkEmailRateLimit, normalizeEmail } from "./rateLimit";

/** Reused across sends — creating a transport per email reopens the SMTP handshake. */
let cached: Transporter | null = null;

function transport(): Transporter | null {
  const cfg = mailConfig();
  if (!cfg) return null;
  if (!cached) {
    cached = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
  }
  return cached;
}

export interface SendOutcome {
  sent: boolean;
  reason?: string;
}

async function deliver(
  to: string,
  mail: { subject: string; html: string; text: string },
  attachments?: { filename: string; content: string; contentType: string }[]
): Promise<SendOutcome> {
  const cfg = mailConfig();
  const tx = transport();
  if (!cfg || !tx) return { sent: false, reason: "email is not configured on this server" };

  const limit = checkEmailRateLimit(to);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterMs / 60_000);
    return { sent: false, reason: `rate limit reached for this address; retry in ${minutes} min` };
  }

  await tx.sendMail({
    from: cfg.from,
    to: normalizeEmail(to),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    ...(attachments ? { attachments } : {}),
  });
  return { sent: true };
}

/**
 * Emails the finished report: the plain-language layer in the body, the full
 * technical analysis as an attached HTML file.
 *
 * Never throws — a mail failure must not turn a completed audit into a failed
 * job, so the outcome is returned for the caller to log.
 */
export async function sendReportEmail(to: string, report: AuditReport): Promise<SendOutcome> {
  try {
    const cfg = mailConfig();
    const reportUrl = cfg?.baseUrl ? `${cfg.baseUrl}/report` : null;
    const mail = renderReportEmail(report, reportUrl);
    return await deliver(to, mail, [
      {
        filename: "autoaudit-report.html",
        content: renderReportAttachment(report),
        contentType: "text/html; charset=utf-8",
      },
    ]);
  } catch (err) {
    return { sent: false, reason: (err as Error).message };
  }
}

/** Tells the requester a run died, instead of leaving them waiting on it. */
export async function sendFailureEmail(
  to: string,
  repoUrl: string,
  message: string
): Promise<SendOutcome> {
  try {
    return await deliver(to, renderFailureEmail(repoUrl, message));
  } catch (err) {
    return { sent: false, reason: (err as Error).message };
  }
}

/** Test seam — drops the memoized transport. */
export function resetMailTransport(): void {
  cached = null;
}
