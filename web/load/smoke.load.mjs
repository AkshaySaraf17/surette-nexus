/**
 * Load test (autocannon, MIT): `npm run test:load` against a running PRODUCTION build
 * (npm run build && npx next start -p 3300). The dev server is much slower and not representative.
 *
 *   LOAD_BASE_URL=http://localhost:3300 LOAD_SECONDS=15 LOAD_CONNECTIONS=25 npm run test:load
 *
 * Each scenario runs for LOAD_SECONDS with LOAD_CONNECTIONS concurrent clients and must meet its
 * thresholds (no errors, no 5xx, p99 latency under the limit). Results are written to
 * load/results/latest.json so runs can be compared over time.
 */
import autocannon from "autocannon";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.LOAD_BASE_URL ?? "http://localhost:3300";
const duration = Number(process.env.LOAD_SECONDS ?? 15);
const connections = Number(process.env.LOAD_CONNECTIONS ?? 25);

const SCENARIOS = [
  { name: "Home page (HTML)", path: "/", p99Ms: 1500 },
  { name: "Listings page (HTML)", path: "/listings", p99Ms: 1500 },
  { name: "Listings API (cached)", path: "/api/properties?limit=24", p99Ms: 400 },
  { name: "Market API (cached)", path: "/api/market?years=10", p99Ms: 600 },
  { name: "Government datasets API", path: "/api/market/datasets", p99Ms: 400 },
  { name: "Readiness check", path: "/api/health/ready", p99Ms: 300 },
];

const results = [];
let failed = false;
for (const s of SCENARIOS) {
  const r = await autocannon({ url: base + s.path, duration, connections, headers: { "X-Real-IP": "10.250.0.1" } });
  const non2xx = r.non2xx;
  const ok = r.errors === 0 && r.timeouts === 0 && non2xx === 0 && r.latency.p99 <= s.p99Ms;
  failed ||= !ok;
  const row = { scenario: s.name, path: s.path, requests: r.requests.total, reqPerSec: Math.round(r.requests.average), p50Ms: r.latency.p50, p90Ms: r.latency.p90, p99Ms: r.latency.p99, maxMs: r.latency.max, errors: r.errors + r.timeouts, non2xx, thresholdP99Ms: s.p99Ms, pass: ok };
  results.push(row);
  console.log(`${ok ? "PASS" : "FAIL"}  ${s.name.padEnd(26)} ${String(row.reqPerSec).padStart(6)} req/s   p50 ${String(row.p50Ms).padStart(4)} ms   p99 ${String(row.p99Ms).padStart(5)} ms (limit ${s.p99Ms})   errors ${row.errors}   non-2xx ${non2xx}`);
}

mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("./results/latest.json", import.meta.url),
  JSON.stringify({ base, duration, connections, ranAt: new Date().toISOString(), machine: `${process.platform} ${process.arch}, Node ${process.version}`, results }, null, 2) + "\n",
);
process.exit(failed ? 1 : 0);
