# Runbooks

Each alert in `deploy/observability/prometheus/alerts.yml` links to a section here. Start with the
**Surette Nexus — Overview** Grafana dashboard, then logs in Loki:
`{service=~"surette.*"} | json | level="error"`. Every response carries `X-Request-Id`; search logs
with `| json | requestId="<id>"` to follow one request through the gateway, app and worker.

Useful commands (Kubernetes; use `docker compose` equivalents locally):

```bash
kubectl -n surette get pods
kubectl -n surette logs deploy/web --since=15m | grep '"level":"error"'
kubectl -n surette exec deploy/web -- curl -s localhost:3100/api/health/ready
kubectl -n surette rollout undo deploy/web
```

<a id="target-down"></a>
## A service instance is down

**Symptom:** `SuretteTargetDown`. Prometheus can't scrape a web, worker or realtime pod.
1. `kubectl get pods`: look for CrashLoopBackOff or OOMKilled.
2. Check the logs of the previous container: `kubectl logs <pod> --previous`.
3. A bad deploy? `kubectl rollout undo deploy/<name>`.
4. OOMKilled: raise the memory limit, then look for the leak (heap grows on the dashboard).

<a id="worker-missing"></a>
## No background worker is running

**Impact:** webhooks aren't delivered, scheduled jobs (market refresh, purges) don't run, and the
outbox piles up. The website itself keeps working.
1. `kubectl get deploy worker`, then `kubectl logs deploy/worker`.
2. Usually a database connection problem at startup. Check `DATABASE_DIRECT_URL` in the Secret.
3. Work is durable: nothing is lost, and it drains once a worker is back.

<a id="not-ready"></a>
## Readiness failing from outside

**Symptom:** `SuretteNotReady`. The blackbox probe of `/api/health/ready` fails.
1. `curl -s https://<host>/api/health/ready | jq`. The `checks` object names the failing dependency.
2. `migrations: pending`: the migrate Job didn't run or failed. `kubectl logs job/migrate`.
3. `database`: see [PostgreSQL down](#postgres-down). `pool`: see [pool saturated](#db-pool).
4. All pods ready but the probe fails: check the Ingress, TLS and DNS.

<a id="high-error-rate"></a>
## High API error rate

1. Dashboard → "Requests by status" and "Slowest routes" to find the failing route.
2. Logs: `{service="surette-web"} | json | level="error"`. Each line carries the route and requestId.
3. Recently deployed? Roll back first, investigate second.
4. If errors are from one dependency (open circuit breaker), see [circuit open](#circuit-open).

<a id="slow-requests"></a>
## Slow requests

1. Which routes? Dashboard → "Slowest routes (p95)".
2. Database time? Compare with "DB transaction p95". If the database is slow, see [slow transactions](#db-slow).
3. CPU-bound? Check pod CPU; the HPA should be adding replicas. Raise `maxReplicas` if it's at the cap.

<a id="tls"></a>
## TLS certificate expiring

cert-manager renews automatically 30 days before expiry. If this fires, run
`kubectl describe certificate surette-tls` and `kubectl logs -n cert-manager deploy/cert-manager`.
Usually DNS or the HTTP-01 challenge path is blocked.

<a id="db-pool"></a>
## Database connections saturated

1. Requests are queueing for a pooled connection (`db_pool_connections{state="waiting"}`).
2. Long transactions? In Postgres, `SELECT pid, now() - xact_start, query FROM pg_stat_activity ORDER BY 2 DESC`.
3. More pods means more connections: keep `replicas × DATABASE_POOL_SIZE` under PgBouncer's
   `max_client_conn`, and PgBouncer's `default_pool_size` under Postgres `max_connections`.

<a id="db-slow"></a>
## Slow database transactions

1. Find the queries with `pg_stat_statements`:
   `SELECT calls, mean_exec_time, query FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;`
2. `EXPLAIN (ANALYZE, BUFFERS)` the worst one and add an index in a new migration.
3. Heavy analytics queries belong on the read replica (`DATABASE_READ_URL`).

<a id="postgres-down"></a>
## PostgreSQL down

1. CloudNativePG fails over to a replica automatically (seconds). Check `kubectl cnpg status surette-db`.
2. Managed database: check the provider's console. Apps reconnect on their own.
3. To restore: CNPG point-in-time recovery from the barman backups (see docs/deployment.md).

<a id="replica-lag"></a>
## Read replica lagging

Analytics and market pages may show slightly stale data. Usually caused by a heavy write burst or an
undersized replica. If lag keeps growing, unset `DATABASE_READ_URL` so reads go to the primary.

<a id="redis-down"></a>
## Redis down

**Impact:** limited. Rate limits fall back to per-instance memory (looser) and the shared cache
turns off, so the database sees more reads. Restart Redis; no data needs recovering.

<a id="dead-jobs"></a>
## Jobs moved to the dead-letter state

1. `SELECT id, type, attempts, last_error, payload FROM jobs WHERE status = 'dead' ORDER BY finished_at DESC LIMIT 20;`
2. Webhooks: the receiver has been failing for about a day. Contact its owner or pause the subscription.
3. After fixing the cause, re-queue them:
   `UPDATE jobs SET status = 'queued', attempts = 0, run_at = now() WHERE status = 'dead' AND type = '<type>';`

<a id="queue-backlog"></a>
## Queue backlog

1. Are workers running and healthy? KEDA should be scaling them up (production overlay).
2. Is one job type failing and retrying in a loop? Dashboard → "Jobs processed" by outcome.
3. A receiver timing out makes webhook jobs slow. The circuit breaker should open; check
   [circuit open](#circuit-open).

<a id="outbox-lag"></a>
## Outbox lagging or stalled

Domain events aren't being relayed, so webhooks and cache invalidation are delayed.
1. Is a worker running? See [worker missing](#worker-missing).
2. Is one event failing every time? Check worker logs for "outbox relay failed".
3. Look at the oldest unpublished events: `SELECT id, type, created_at FROM outbox_events WHERE published_at IS NULL ORDER BY id LIMIT 10;`

<a id="circuit-open"></a>
## Circuit breaker open

A dependency kept failing, so calls to it fail fast and fallbacks are used.
- `ollama`: the concierge uses built-in answers. Check the Ollama service.
- `fred` / `census`: market pages show the last stored data with its date.
- `dispatcher`: maintenance requests show "temporarily unavailable" with the office number.
- `webhook:<host>`: deliveries to that receiver are retried later.
The breaker retries on its own after the cool-down. No action is needed unless the dependency stays down.

<a id="rate-limits"></a>
## Rate-limit spike

1. Which bucket? Dashboard → "Rate-limited requests".
2. `login`: possibly credential stuffing. Account lockout still protects users. Consider blocking
   the source at the gateway or WAF.
3. `analytics`: a page may be looping events. Check the SDK version on that site.

<a id="analytics-silent"></a>
## Website analytics silent

No consented events from `nexus-site` for 3 daytime hours.
1. Is the site up, and does the SDK load? Open the site, check `/sdk/surette-analytics.js` and the network tab.
2. Is `/api/analytics/collect` returning 204? A 403 means the origin isn't in the project's allowed origins
   (Portal → Settings).
3. A quiet day with very little traffic can also trigger this. Check the Overview's visitors.
