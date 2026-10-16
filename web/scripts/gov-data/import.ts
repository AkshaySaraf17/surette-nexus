/** Import the checked-in government data snapshots (data/gov/) into the database: npm run data:gov:import */
import { getPool } from "../../src/lib/server/db";
import { importSnapshots } from "../../src/lib/server/gov-data";
import { closeRedis } from "../../src/lib/server/redis";

async function main() {
  console.log("Imported:", await importSnapshots());
  await getPool().end();
  await closeRedis();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
