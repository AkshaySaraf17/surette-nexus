import { invalidateTags, subscribeInvalidations } from "./cache";
import { liveHub } from "./realtime";

/**
 * Keep this instance's cache in step with the database: the same Postgres change feed
 * that powers live updates drops cached public listings the moment a listing or photo
 * changes — whoever made the change (portal, mobile app, worker, raw SQL).
 */
const g = globalThis as unknown as { suretteLiveCache?: boolean };

export function ensureLiveInvalidation() {
  if (g.suretteLiveCache) return;
  g.suretteLiveCache = true;
  liveHub.subscribe((event) => {
    if (event.table === "properties" || event.table === "media_assets") void invalidateTags(["listings"], { broadcast: false });
  });
  subscribeInvalidations();
}
