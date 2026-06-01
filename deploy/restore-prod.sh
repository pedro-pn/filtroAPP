#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/ubuntu/apps/RDOAPP}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
BACKEND_SERVICE="${BACKEND_SERVICE:-backend}"
NGINX_SERVICE="${NGINX_SERVICE:-nginx}"
POSTGRES_DB="${POSTGRES_DB:-filtrovali}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
REPORTS_VOLUME="${REPORTS_VOLUME:-filtrovali_relatorios}"
CERTS_VOLUME="${CERTS_VOLUME:-filtrovali_certs}"
BACKUP_SOURCE="${BACKUP_SOURCE:-}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-false}"
RESTORE_REPORTS="${RESTORE_REPORTS:-true}"
RESTORE_CERTS="${RESTORE_CERTS:-true}"
REQUIRE_CHECKSUMS="${REQUIRE_CHECKSUMS:-true}"

if [ -z "$BACKUP_SOURCE" ]; then
  echo "[restore] set BACKUP_SOURCE to the directory containing postgres.sql.gz" >&2
  exit 1
fi

if [ ! -f "$BACKUP_SOURCE/postgres.sql.gz" ]; then
  echo "[restore] file not found: $BACKUP_SOURCE/postgres.sql.gz" >&2
  exit 1
fi

if [ "$REQUIRE_CHECKSUMS" = "true" ]; then
  if [ ! -f "$BACKUP_SOURCE/SHA256SUMS" ]; then
    echo "[restore] file not found: $BACKUP_SOURCE/SHA256SUMS" >&2
    exit 1
  fi
  echo "[restore] validating backup checksums"
  (cd "$BACKUP_SOURCE" && sha256sum -c SHA256SUMS)
fi

cd "$PROJECT_DIR"

echo "[restore] starting compose stack"
docker compose -f "$COMPOSE_FILE" up -d --no-recreate

echo "[restore] waiting for postgres to be ready"
until docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" pg_isready -U "$POSTGRES_USER" -q; do
  sleep 1
done

echo "[restore] dropping and recreating database $POSTGRES_DB"
docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" psql -U "$POSTGRES_USER" -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS $POSTGRES_DB;" \
  -c "CREATE DATABASE $POSTGRES_DB;"

echo "[restore] restoring postgres database from $BACKUP_SOURCE/postgres.sql.gz"
gunzip -c "$BACKUP_SOURCE/postgres.sql.gz" | docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "[restore] applying prisma schema"
  docker compose -f "$COMPOSE_FILE" exec -T "$BACKEND_SERVICE" npx prisma db push --accept-data-loss
fi

if [ "$RESTORE_REPORTS" = "true" ] && [ -f "$BACKUP_SOURCE/relatorios.tar.gz" ]; then
  echo "[restore] restoring reports volume $REPORTS_VOLUME"
  docker run --rm -v "${REPORTS_VOLUME}:/to" -v "${BACKUP_SOURCE}:/backup:ro" alpine sh -c "find /to -mindepth 1 -maxdepth 1 -exec rm -rf {} + && cd /to && tar -xzf /backup/relatorios.tar.gz"
else
  echo "[restore] skipping reports volume restore (file not found or RESTORE_REPORTS=false)"
fi

if [ "$RESTORE_CERTS" = "true" ] && [ -f "$BACKUP_SOURCE/certs.tar.gz" ]; then
  echo "[restore] restoring cert volume $CERTS_VOLUME"
  docker run --rm -v "${CERTS_VOLUME}:/to" -v "${BACKUP_SOURCE}:/backup:ro" alpine sh -c "find /to -mindepth 1 -maxdepth 1 -exec rm -rf {} + && cd /to && tar -xzf /backup/certs.tar.gz"
  echo "[restore] reloading nginx"
  docker compose -f "$COMPOSE_FILE" exec -T "$NGINX_SERVICE" nginx -s reload
fi

echo "[restore] done"
