// Copies MapLibre's self-contained web worker into public/ so the map can load it by URL
// (bundlers can't resolve MapLibre v6's worker automatically). Runs after every npm install.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve("maplibre-gl/package.json")) + "/dist";
const target = path.resolve("public/vendor/maplibre");
mkdirSync(target, { recursive: true });
copyFileSync(`${dist}/maplibre-gl-worker.mjs`, `${target}/maplibre-gl-worker.mjs`);
console.log("Copied MapLibre worker to public/vendor/maplibre/");
