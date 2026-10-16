import pino from "pino";
import { currentContext } from "./request-context";

/**
 * Structured JSON logs (one object per line) for Loki / CloudWatch / any log shipper.
 *
 *  - Every line carries the request id from the current request context.
 *  - Personal data is redacted: passwords, tokens, cookies, emails and phone numbers.
 *  - LOG_LEVEL controls verbosity (default "info"; "debug" locally if you need it).
 *  - LOG_PRETTY=1 prints short human-readable lines in development (no extra dependency).
 */
const REDACT = [
  "password", "*.password", "token", "*.token", "secret", "*.secret",
  "authorization", "*.authorization", "cookie", "*.cookie", "headers.cookie", "headers.authorization",
  "email", "*.email", "contactEmail", "*.contactEmail", "phone", "*.phone", "contactPhone", "*.contactPhone",
];

const pretty = process.env.LOG_PRETTY === "1";

const base = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.SERVICE_NAME ?? "surette-web" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: REDACT, censor: "[redacted]" },
  formatters: { level: (label) => ({ level: label }) },
  mixin() {
    const ctx = currentContext();
    return ctx ? { requestId: ctx.requestId, ...(ctx.route && { route: ctx.route }), ...(ctx.userId && { userId: ctx.userId }) } : {};
  },
  ...(pretty && {
    // Minimal pretty mode without pino-pretty: write "LEVEL msg {fields}" lines.
    hooks: {
      streamWrite(s: string) {
        try {
          const { level, msg, time, service, ...rest } = JSON.parse(s) as Record<string, unknown>;
          void time; void service;
          const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
          return `${String(level).toUpperCase().padEnd(5)} ${msg ?? ""}${extra}\n`;
        } catch {
          return s;
        }
      },
    },
  }),
});

const globalForLog = globalThis as unknown as { suretteLogger?: pino.Logger };
export const logger = (globalForLog.suretteLogger ??= base);

export function childLogger(component: string) {
  return logger.child({ component });
}

/** Mask an email or phone for logs: "j***@example.com", "+1207***6893". */
export function mask(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.includes("@")) {
    const [user, domain] = value.split("@");
    return `${user.slice(0, 1)}***@${domain}`;
  }
  return value.length > 8 ? `${value.slice(0, 5)}***${value.slice(-4)}` : "***";
}
