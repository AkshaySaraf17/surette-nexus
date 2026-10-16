/** WebSocket live-update server: `npm run realtime` (local) / the `realtime` Deployment. */
import { logger } from "../src/lib/server/logger";
import { startRealtimeServer } from "../src/lib/server/realtime-server";

void startRealtimeServer(Number(process.env.REALTIME_PORT ?? 3200)).then((rt) => {
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "draining realtime server");
    await rt.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
});
