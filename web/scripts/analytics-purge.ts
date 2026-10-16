/** npm run analytics:purge — delete analytics events older than each project's retention (cron daily). */
import { getPool } from "../src/lib/server/db";
import { purgeExpired } from "../src/lib/server/analytics";

purgeExpired()
  .then((n) => console.log(`Removed ${n} expired analytics events.`))
  .then(() => getPool().end())
  .catch(async (e) => {
    console.error(e);
    await getPool().end();
    process.exit(1);
  });
