// Copies the analytics SDK and the demo website into web/public so the app serves them:
//   analytics-sdk/src/surette-analytics.js -> web/public/sdk/surette-analytics.js
//   demo-site/*                             -> web/public/demo-site/*
// Runs automatically before `npm run dev` / `npm run build` in web/.
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "web/public");
mkdirSync(path.join(pub, "sdk"), { recursive: true });
cpSync(path.join(root, "analytics-sdk/src/surette-analytics.js"), path.join(pub, "sdk/surette-analytics.js"));
if (existsSync(path.join(root, "demo-site"))) {
  rmSync(path.join(pub, "demo-site"), { recursive: true, force: true });
  cpSync(path.join(root, "demo-site"), path.join(pub, "demo-site"), { recursive: true });
}
console.log("Synced analytics SDK and demo site into web/public.");
