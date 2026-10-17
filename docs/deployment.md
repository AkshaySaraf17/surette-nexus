# Deployment

The architecture behind these steps is in [system-design.md](system-design.md).

## Local development

```bash
scripts/db.sh start            # private Postgres on port 5434 (data in ./.pgdata)
cd web && cp .env.example .env # then set JWT_SECRET (32+ random characters)
npm install
npm run db:migrate
npm run db:seed                # demo data + demo accounts
npm run dev                    # http://localhost:3100
```

Port 3100 is used so the app doesn't clash with other projects on 3000.

Background work and WebSockets, either way:

- **One process:** `EMBEDDED_WORKER=1` in `web/.env` runs the worker inside `npm run dev`.
- **Like production:** in two more terminals run `npm run worker` (health and metrics on `:9464`) and
  `npm run realtime` (WebSocket on `:3200`). Set `NEXT_PUBLIC_REALTIME_URL=ws://localhost:3200/ws`
  to make browsers use the WebSocket; without it they use SSE.

Redis is optional locally: without `REDIS_URL`, rate limits use memory (dev) or Postgres
(production), and the cache is in-process.

## Docker Compose (tested locally)

Free tooling on a Mac: `brew install colima docker docker-compose docker-buildx`, then `colima start`
(Colima replaces Docker Desktop, whose license isn't free for every organization).

```bash
printf "JWT_SECRET=%s\nMETRICS_TOKEN=%s\n" "$(openssl rand -hex 32)" "$(openssl rand -hex 16)" > .env
docker compose up --build                               # site on http://localhost:8080 via the nginx gateway
docker compose exec web npm run admin:create -- --email you@example.com --name "Your Name"
```

- `--profile observability`: Prometheus `:9090`, Alertmanager `:9093`, Grafana `:3001`, Loki, Promtail and
  the exporters. Write the metrics token for Prometheus with `printf %s "$METRICS_TOKEN" > .metrics-token`,
  and put receiver secrets in `deploy/observability/alertmanager/secrets/`.
- `--profile ai`: Ollama. Set `OLLAMA_URL=http://ollama:11434` and pull a model with
  `docker compose exec ollama ollama pull llama3.2:3b`.
- Email: the stack includes Mailpit (test inbox at http://localhost:8025). For real delivery set `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` and `MAIL_FROM` (any SMTP provider; in production the
  worker refuses to send without `SMTP_HOST`).
- Demo label: on by default (header badge, footer note, page titles, `noindex`). To remove it, set
  `SITE_DEMO=false` in `.env` and rebuild (`docker compose up -d --build`); for `npm run build`, set
  `NEXT_PUBLIC_SITE_DEMO=false`.
- Google sign-in: set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (see [auth-and-roles.md](auth-and-roles.md)).
- Scale web: `docker compose up --scale web=4`. The gateway balances across replicas.

## Kubernetes (manifests validated with kubeconform; not yet run on a cluster)

Prerequisites in the cluster: ingress-nginx, cert-manager (ClusterIssuer `letsencrypt`), the
CloudNativePG operator (for in-cluster Postgres), KEDA (production overlay), and kube-prometheus-stack
(production overlay; it uses ServiceMonitors and a PrometheusRule).

```bash
# 1. Secrets (never in git): see deploy/k8s/base/secret.example.yaml for the keys.
kubectl -n surette create secret generic surette-secrets --from-env-file=prod.env

# 2. Edit hosts and the image name: deploy/k8s/base/{ingress,configmap,kustomization}.yaml

# 3. Deploy (CI does this automatically; see .github/workflows/deploy.yml)
kubectl apply -k deploy/k8s/overlays/staging
```

Using managed Postgres or Redis? Remove `components/data` from the overlay and point
`DATABASE_URL` (pooled), `DATABASE_DIRECT_URL`, `DATABASE_READ_URL` and `REDIS_URL` at them.

## CI/CD

- **CI** (`.github/workflows/ci.yml`) runs on every push and pull request: lint and type checks
  (web + mobile), unit and database tests against Postgres, Playwright end-to-end tests against the
  built app with the worker and WebSocket server, then a container build. On `main` the image is
  pushed to GHCR and scanned with Trivy.
- **CD** (`.github/workflows/deploy.yml`): every green `main` deploys to **staging**.
  **Production** is a manual "Run workflow" with GitHub Environment approval. Each deploy runs the
  migration Job, rolls out web, worker and realtime, smoke-tests `/api/health/ready`, and rolls back
  automatically on failure.
- Repository secrets needed: `KUBECONFIG` in the `staging` and `production` environments, plus the repository
  variable `DEPLOY_ENABLED=true` to turn on automatic staging deploys. CI already passes on GitHub.

## Free software used

Everything is free and open source:

| Purpose | Tool | License |
| --- | --- | --- |
| Containers on a Mac | Colima + Docker CLI + Compose + Buildx | MIT / Apache-2.0 |
| Database | PostgreSQL (+ CloudNativePG operator on Kubernetes) | PostgreSQL / Apache-2.0 |
| Cache and shared rate limits | Valkey (Redis-compatible) | BSD-3 |
| Gateway / load balancer | nginx, ingress-nginx | BSD-2 / Apache-2.0 |
| Local AI | Ollama + Llama 3.2 3B | MIT / Llama 3.2 Community License (free) |
| Monitoring | Prometheus, Alertmanager, Grafana, Loki, Promtail, exporters | Apache-2.0 / AGPL-3.0 |
| Autoscaling on queue depth | KEDA | Apache-2.0 |
| Validation | kubeconform, promtool, amtool, actionlint | Apache-2.0 / MIT |
| Security scanning | Trivy (image), gitleaks (secrets) | Apache-2.0 / MIT |
| Documents | Pandoc, Mermaid, marked, Poppler | GPL / MIT |
| CI/CD | GitHub Actions (free for public repos; free minutes for private) | — |

## Production checklist

- [ ] A long-running Node host or Kubernetes. Serverless platforms cut off `/api/events` and can't run
      the worker.
- [ ] PostgreSQL 15+ with backups and point-in-time recovery (CloudNativePG does this), and PgBouncer
      in transaction mode.
- [ ] `JWT_SECRET` (32+ random characters), `DATABASE_URL`, `DATABASE_DIRECT_URL`, `PUBLIC_SITE_URL`
      (the public HTTPS address), `METRICS_TOKEN`.
- [ ] Optional: `REDIS_URL`, `DATABASE_READ_URL`, Ollama. (No Census key is needed.)
- [ ] At least one **worker** running. Without it, webhooks and scheduled jobs wait in the queue.
- [ ] A persistent shared volume for `STORAGE_DIR`, or move storage to S3/R2.
- [ ] HTTPS in front of the app.
- [ ] Create the owner with `npm run admin:create`; never run the demo seed.
- [ ] Settings → Website tracking: add the public address to the `nexus-site` allowed origins if you
      serve the site on more than one domain.
- [ ] Prometheus scraping, Alertmanager receivers filled in, Grafana dashboard imported.
