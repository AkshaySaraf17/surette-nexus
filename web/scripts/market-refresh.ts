/** npm run market:refresh — fetch all public market series (for cron or first setup). */
import { getPool } from "../src/lib/server/db";
import { refreshAll } from "../src/lib/server/market";

refreshAll()
  .then((results) => {
    for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.id}${r.ok ? ` (${r.count} observations)` : ` — ${r.error}`}`);
    return getPool().end();
  })
  .catch(async (e) => {
    console.error(e);
    await getPool().end();
    process.exit(1);
  });
