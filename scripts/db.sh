#!/usr/bin/env bash
# Local PostgreSQL for Surette Nexus, kept inside the repo (./.pgdata) on its own port
# so it never touches any other Postgres on this machine.
#
#   scripts/db.sh start    start (and create the cluster + database on first run)
#   scripts/db.sh migrate  apply pending database/migrations/*.sql
#   scripts/db.sh reset    drop everything, re-run all migrations, re-seed demo data
#   scripts/db.sh stop | status | psql
set -euo pipefail
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.pgdata"
PORT="${SURETTE_DB_PORT:-5434}"
DB="surette"
USER_NAME="surette"
URL="postgresql://$USER_NAME@localhost:$PORT/$DB"

start() {
  if [ ! -d "$DATA" ]; then
    initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null
    echo "Initialised database cluster in $DATA"
  fi
  if pg_ctl -D "$DATA" status >/dev/null 2>&1; then
    echo "Postgres already running on port $PORT"
  else
    pg_ctl -D "$DATA" -o "-p $PORT -k /tmp -c timezone=UTC" -l "$DATA/server.log" -w start >/dev/null
    echo "Postgres started on port $PORT"
  fi
  psql "postgresql://$USER_NAME@localhost:$PORT/postgres" -tAc "select 1 from pg_database where datname='$DB'" | grep -q 1 \
    || createdb -h localhost -p "$PORT" -U "$USER_NAME" "$DB"
}

migrate() {
  (cd "$ROOT/web" && npm run --silent db:migrate)
}

case "${1:-start}" in
  start) start ;;
  migrate) start; migrate ;;
  reset)
    start
    psql "$URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/database/reset.sql"
    migrate
    (cd "$ROOT/web" && npm run --silent db:seed)
    ;;
  stop) pg_ctl -D "$DATA" -w stop ;;
  status) pg_ctl -D "$DATA" status ;;
  psql) psql "$URL" ;;
  *) echo "usage: $0 start|migrate|reset|stop|status|psql" >&2; exit 1 ;;
esac
