#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/ubuntu/apps/RDOAPP}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-filtrovali}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
REPORTS_VOLUME="${REPORTS_VOLUME:-filtrovali_relatorios}"
CERTS_VOLUME="${CERTS_VOLUME:-filtrovali_certs}"
BACKUP_ROOT="${BACKUP_ROOT:-/home/ubuntu/backups/filtrovali}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
INCLUDE_CERTS="${INCLUDE_CERTS:-false}"
INCLUDE_REPORTS="${INCLUDE_REPORTS:-true}"
AWS_S3_URI="${AWS_S3_URI:-}"

TIMESTAMP="$(date +%F-%H%M%S)"
RUN_DIR="$BACKUP_ROOT/$TIMESTAMP"

mkdir -p "$RUN_DIR"

cd "$PROJECT_DIR"

echo "[backup] dumping postgres database to $RUN_DIR"
docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$RUN_DIR/postgres.sql.gz"

if [ "$INCLUDE_REPORTS" = "true" ]; then
  echo "[backup] archiving reports volume $REPORTS_VOLUME"
  docker run --rm -v "${REPORTS_VOLUME}:/from:ro" -v "${RUN_DIR}:/backup" alpine sh -c "cd /from && tar -czf /backup/relatorios.tar.gz ."
else
  echo "[backup] skipping reports volume archive"
fi

if [ "$INCLUDE_CERTS" = "true" ]; then
  echo "[backup] archiving cert volume $CERTS_VOLUME"
  docker run --rm -v "${CERTS_VOLUME}:/from:ro" -v "${RUN_DIR}:/backup" alpine sh -c "cd /from && tar -czf /backup/certs.tar.gz ."
fi

(
  cd "$RUN_DIR"
  sha256sum ./* > SHA256SUMS
)

LATEST_LINK="$BACKUP_ROOT/latest"
rm -f "$LATEST_LINK"
ln -s "$RUN_DIR" "$LATEST_LINK"

if [ -n "$AWS_S3_URI" ]; then
  if command -v aws >/dev/null 2>&1; then
    echo "[backup] uploading to $AWS_S3_URI/$TIMESTAMP"
    aws s3 cp "$RUN_DIR" "$AWS_S3_URI/$TIMESTAMP" --recursive
  else
    echo "[backup] aws cli not found, skipping S3 upload" >&2
  fi
fi

echo "[backup] removing local backups older than $RETENTION_DAYS days"
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name "20*" -mtime "+$RETENTION_DAYS" -exec rm -rf {} +

echo "[backup] done: $RUN_DIR"
