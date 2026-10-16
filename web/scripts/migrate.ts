/**
 * Applies database/migrations/*.sql in filename order. Each file runs in its own
 * transaction and is recorded (with a SHA-256 checksum) in schema_migrations, so
 * re-running is safe and an edited, already-applied migration is reported loudly.
 *
 *   npm run db:migrate            apply pending migrations
 *   npm run db:migrate -- --status
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const dir = path.resolve(__dirname, "../../database/migrations");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Map(
      (await client.query<{ version: string; checksum: string }>("SELECT version, checksum FROM schema_migrations")).rows.map((r) => [r.version, r.checksum]),
    );
    const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    const statusOnly = process.argv.includes("--status");
    let ran = 0;
    for (const file of files) {
      const sql = readFileSync(path.join(dir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const version = file.replace(/\.sql$/, "");
      const previous = applied.get(version);
      if (previous) {
        if (previous !== checksum) console.warn(`! ${file} changed after it was applied (checksum mismatch). Create a new migration instead.`);
        else if (statusOnly) console.log(`  applied  ${file}`);
        continue;
      }
      if (statusOnly) {
        console.log(`  pending  ${file}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [version, checksum]);
        await client.query("COMMIT");
        console.log(`✓ applied ${file}`);
        ran++;
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(`✗ ${file} failed — nothing from it was applied.`);
        throw error;
      }
    }
    if (!statusOnly) console.log(ran ? `${ran} migration(s) applied.` : "Database is up to date.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
