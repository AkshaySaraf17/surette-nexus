import { afterEach, describe, expect, it, vi } from "vitest";
import { accountEmailsEnabled } from "@/lib/server/email";

/** The ACCOUNT_EMAILS switch (a demo can run without any mail provider). */
afterEach(() => vi.unstubAllEnvs());

describe("account emails switch", () => {
  it("is off when ACCOUNT_EMAILS=off, even with SMTP configured", () => {
    vi.stubEnv("ACCOUNT_EMAILS", "off");
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    expect(accountEmailsEnabled()).toBe(false);
  });
  it("is on in development by default (Mailpit)", () => {
    vi.stubEnv("ACCOUNT_EMAILS", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(accountEmailsEnabled()).toBe(true);
  });
  it("in production, is on only when SMTP_HOST is set", () => {
    vi.stubEnv("ACCOUNT_EMAILS", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_HOST", "");
    expect(accountEmailsEnabled()).toBe(false);
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    expect(accountEmailsEnabled()).toBe(true);
  });
});
