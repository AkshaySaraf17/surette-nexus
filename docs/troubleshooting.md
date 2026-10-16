# Troubleshooting

| Problem | Fix |
| --- | --- |
| `ECONNREFUSED` on port 5434 | `scripts/db.sh start` |
| "Seed user … missing" in tests | `npm run db:seed` (or `scripts/db.sh reset`) |
| Signed in on the wrong page | Customers use `/sign-in`; team members use `/portal/sign-in`. The message links to the right one. |
| "Too many attempts" when signing in | Wait 15 minutes, or have the owner unlock the account in Portal → Team & accounts |
| Analytics shows "waiting for the first consented visit" | Visit the site, click **Allow** in the banner, browse a little; refresh Settings. Visitors with GPC/DNT, or who chose "No thanks", aren't counted. |
| Analytics 403 from another domain | Add that origin to the `nexus-site` allowed origins in Settings |
| Market page says a series is unavailable | FRED: `npm run market:refresh`. Government data: `npm run data:gov:import` (snapshots) or `npm run data:gov:download` (fresh). Check `/api/market/datasets`. |
| Concierge says "built-in answers" | Expected without Ollama. To enable: install Ollama, `ollama pull llama3.2:3b`, set `OLLAMA_URL` |
| Map is blank | Check the browser console for blocked tile requests; the map uses OpenFreeMap tiles |
| Mobile app can't reach the API | It uses port 3100 on the computer running Expo; or set `EXPO_PUBLIC_API_URL` in `mobile/.env` |
| `next dev` complains about `public/sdk` | `node scripts/sync-public.mjs` from the repo root (runs automatically before dev/build) |
| Webhooks never arrive | A worker must be running: `npm run worker`, or `EMBEDDED_WORKER=1` with `npm run dev`. Check `SELECT status, count(*) FROM jobs GROUP BY 1`. |
| `409 REQUEST_IN_PROGRESS` | The same `Idempotency-Key` is still being processed; retry in a moment. |
| `422 IDEMPOTENCY_KEY_REUSED` | A key was reused with a different body; generate a new key per distinct request. |
| Live updates use SSE instead of WebSocket | Set `NEXT_PUBLIC_REALTIME_URL` and run `npm run realtime`; after 3 failed socket attempts the browser falls back to SSE on purpose. |
| `/api/metrics` returns 403 | In production it needs `Authorization: Bearer $METRICS_TOKEN`. |
| `/api/health/ready` says migrations are pending | Run `npm run db:migrate` (or the migrate Job). |
| Docker build or CI fails with "npm ci can only install packages when your package.json and package-lock.json are in sync" | npm 11 on macOS can drop Linux-only packages from the lock file. Run `scripts/refresh-lockfile.sh` (needs `colima start`) after adding packages. |
| Docker containers "unhealthy" right after a rebuild on a full disk | A build on a full disk can produce a damaged image (e.g. empty files). Free space, then `docker compose build` again. |
| 502 from the gateway after recreating containers | Fixed in `deploy/nginx/nginx.conf` (re-resolves service names every 10 s). If you edited it, keep the `resolver` and `resolve` lines. |
