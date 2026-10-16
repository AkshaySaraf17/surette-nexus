# Surette Nexus — one image, three roles (web, worker, realtime) chosen by the command.
# Build from the repository root:   docker build -t surette-nexus .
#
#   web       npm start                 (default)
#   worker    npm run worker:prod
#   realtime  npm run realtime:prod
#   migrate   npm run db:migrate:prod   (run once per deploy, before rolling out)

# ---- deps: install everything needed to build -------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
# Install scripts run later, in the build stage, once the source (scripts/) is present.
RUN npm ci --ignore-scripts

# ---- build ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=deps /app/web/node_modules web/node_modules
COPY analytics-sdk analytics-sdk
COPY demo-site demo-site
COPY database database
COPY data data
COPY scripts scripts
COPY web web
WORKDIR /app/web
# NEXT_PUBLIC_* values are baked into the browser bundle at build time.
ARG NEXT_PUBLIC_REALTIME_URL=/ws
ARG NEXT_PUBLIC_ANALYTICS_PROJECT=nexus-site
ENV NEXT_PUBLIC_REALTIME_URL=$NEXT_PUBLIC_REALTIME_URL NEXT_PUBLIC_ANALYTICS_PROJECT=$NEXT_PUBLIC_ANALYTICS_PROJECT
RUN node scripts/copy-vendor.mjs && npm run build && npm prune --omit=dev --ignore-scripts

# ---- runtime: small, non-root -----------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100 MIGRATIONS_DIR=/app/database/migrations GOV_DATA_DIR=/app/data/gov
# /data/storage is created here owned by the app user, so a fresh Docker volume mounted there
# inherits that ownership (uploads fail with EACCES otherwise). Kubernetes uses fsGroup instead.
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --home /app app \
 && mkdir -p /data/storage && chown app:app /data/storage \
 && apt-get update && apt-get install -y --no-install-recommends curl tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=app:app /app/database database
COPY --from=build --chown=app:app /app/data data
COPY --from=build --chown=app:app /app/web web
USER app
WORKDIR /app/web
EXPOSE 3100 3200 9464
# Role-aware: worker and realtime set HEALTH_PORT/HEALTH_PATH (9464 or 3200, /healthz).
HEALTHCHECK --interval=20s --timeout=3s --start-period=30s CMD sh -c 'curl -fsS "http://localhost:${HEALTH_PORT:-3100}${HEALTH_PATH:-/api/health/live}" > /dev/null || exit 1'
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
