/**
 * Download the government datasets from the agencies and write snapshots to data/gov/:
 *   npm run data:gov:download            (all)
 *   npm run data:gov:download -- acs5    (one: acs5 | bls_laus | census_bps | fhfa_hpi)
 * Each CSV is listed in data/gov/manifest.json with the source URLs, file sizes and
 * SHA-256 of what was downloaded, the retrieval time, and the CSV's own checksum.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DOWNLOADERS } from "../../src/lib/server/gov-download";
import { snapshotDir, toCsv, type Manifest } from "../../src/lib/server/gov-data";

async function main() {
  const dir = snapshotDir();
  mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, "manifest.json");
  const manifest: Manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : { generatedAt: "", license: "U.S. Government works — public domain (17 U.S.C. § 105).", datasets: {} };

  const only = process.argv.slice(2);
  for (const [name, fn] of Object.entries(DOWNLOADERS)) {
    if (only.length && !only.includes(name)) continue;
    process.stdout.write(`Downloading ${name}… `);
    const result = await fn();
    const file = `${name}.csv`;
    const csv = toCsv(result.observations);
    writeFileSync(path.join(dir, file), csv);
    const { observations, ...meta } = result;
    manifest.datasets[name] = { ...meta, file, fileSha256: createHash("sha256").update(csv).digest("hex"), rows: observations.length };
    console.log(`${observations.length} observations from ${result.files.length} file(s)`);
  }
  manifest.generatedAt = new Date().toISOString();
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${manifestPath}`);
}

main().then(
  () => process.exit(0), // exit explicitly: nothing else should keep running
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
