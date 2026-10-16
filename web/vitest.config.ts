import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { loadEnv } from "vite";

/**
 * Integration tests run against the local database from .env (scripts/db.sh).
 * Each test file creates its own throwaway workspace and deletes it afterwards.
 */
export default defineConfig(({ mode }) => ({
  plugins: [tsconfigPaths()],
  resolve: { alias: { "server-only": new URL("./tests/helpers/server-only-stub.ts", import.meta.url).pathname } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: loadEnv(mode, process.cwd(), ""),
    fileParallelism: false,
    testTimeout: 20_000,
  },
}));
