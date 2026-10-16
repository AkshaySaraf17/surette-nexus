/**
 * Next.js server start hook. In development, EMBEDDED_WORKER=1 runs the background worker
 * inside the web process so queued jobs (webhooks, scheduled refreshes) work with a single
 * `npm run dev`. In production the worker is its own process/Deployment — leave this off.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.EMBEDDED_WORKER === "1") {
    const { startEmbeddedWorker } = await import("./instrumentation-node");
    await startEmbeddedWorker();
  }
}
