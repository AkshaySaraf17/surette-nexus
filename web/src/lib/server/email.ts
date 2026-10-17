import nodemailer, { type Transporter } from "nodemailer";
import { breaker } from "./circuit-breaker";
import type { Db } from "./db";
import { enqueue } from "./jobs";
import { childLogger, mask } from "./logger";

/**
 * Outgoing email (verification and password-reset links).
 *
 * Messages are queued as `email.send` jobs in the same transaction as the change that
 * caused them, and the worker delivers them with retries — a slow or down mail server
 * never blocks a request, and nothing is lost.
 *
 * SMTP settings come from SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_SECURE and
 * MAIL_FROM. Any provider works (e.g. a Gmail account with an app password). In development,
 * without SMTP_HOST, mail goes to Mailpit on localhost:1025 (free local test inbox; view it
 * at http://localhost:8025) so no real person is ever emailed while testing.
 */
const log = childLogger("email");

/**
 * Whether the site sends account emails (sign-up confirmation, password reset).
 * ACCOUNT_EMAILS=off switches them off (e.g. a demo with no mail provider): new customers are
 * confirmed straight away and "Forgot password?" is hidden. Unset, emails are on in development
 * (Mailpit) and in production only when SMTP_HOST is configured.
 */
export function accountEmailsEnabled(): boolean {
  const flag = process.env.ACCOUNT_EMAILS?.trim().toLowerCase();
  if (flag === "off") return false;
  if (flag === "on") return true;
  return process.env.NODE_ENV !== "production" || Boolean(process.env.SMTP_HOST?.trim());
}

export const EMAIL_OFF_MESSAGE = "Password reset by email isn't available on this demo site. Contact the office and we'll reset it for you.";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transporter: Transporter | null = null;
function transport(): Transporter {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST?.trim();
  if (!host && process.env.NODE_ENV === "production") throw new Error("SMTP_HOST is not set; can't send email");
  transporter = nodemailer.createTransport({
    host: host || "127.0.0.1",
    port: Number(process.env.SMTP_PORT ?? (host ? 587 : 1025)),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
    connectionTimeout: 10_000,
  });
  return transporter;
}

export function mailFrom(): string {
  return process.env.MAIL_FROM?.trim() || "Surette Real Estate <no-reply@localhost>";
}

/** Send now (used by the worker). Throws on failure so the job is retried. */
export async function sendEmail(message: EmailMessage): Promise<void> {
  await breaker("smtp", { failureThreshold: 5, resetAfterMs: 60_000, timeoutMs: 20_000 }).exec(() =>
    transport().sendMail({ from: mailFrom(), to: message.to, subject: message.subject, text: message.text, html: message.html }),
  );
  log.info({ to: mask(message.to), subject: message.subject }, "email sent");
}

/** Queue an email inside the caller's transaction. */
export function queueEmail(db: Db, message: EmailMessage): Promise<boolean> {
  return enqueue(db, "email.send", { ...message }, { queue: "default", maxAttempts: 6 });
}
