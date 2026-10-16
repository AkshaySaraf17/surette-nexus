import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests against a running dev server (npm run dev, port 3100) and the local
 * database (scripts/db.sh + npm run db:seed). Uses the installed Google Chrome, so no
 * browser download is needed: `npm run test:e2e`.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    // A fresh client address per run keeps per-IP rate limits (login, contact) from carrying over
    // between runs. Only honoured without a gateway in front — the gateway overwrites X-Real-IP.
    extraHTTPHeaders: { "X-Real-IP": `10.200.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
  },
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run dev", url: "http://localhost:3100", reuseExistingServer: true, timeout: 120_000 },
});
