import { Worker } from "./lib/server/worker/runtime";

/** Node-only part of instrumentation.ts (kept separate so the Edge build never sees it). */
export async function startEmbeddedWorker() {
  const g = globalThis as unknown as { suretteEmbeddedWorker?: boolean };
  if (g.suretteEmbeddedWorker) return;
  g.suretteEmbeddedWorker = true;
  await new Worker({ id: `embedded-${process.pid}`, port: null }).start();
}
