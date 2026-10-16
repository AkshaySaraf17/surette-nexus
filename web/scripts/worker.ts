/**
 * Background worker process: `npm run worker` (local) / the `worker` Deployment (Kubernetes).
 * See src/lib/server/worker/runtime.ts for what it does.
 */
import { Worker, closeWorkerResources } from "../src/lib/server/worker/runtime";
import { logger } from "../src/lib/server/logger";

process.env.SERVICE_NAME ??= "surette-worker";
const worker = new Worker({ port: Number(process.env.WORKER_PORT ?? 9464) });

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down worker");
  await worker.stop();
  await closeWorkerResources();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

void worker.start().catch((error) => {
  logger.fatal({ err: (error as Error).message }, "worker failed to start");
  process.exit(1);
});
