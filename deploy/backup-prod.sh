#!/usr/bin/env bash
set -euo pipefail

TELEGRAM_TOKEN="${TELEGRAM_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

notify_failure() {
  local exit_code="$?"
  local line_no="${BASH_LINENO[0]}"
  local cmd="${BASH_COMMAND}"

  echo "[backup] failed with exit code $exit_code at line $line_no: $cmd" >&2

  if [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    local host
    host="$(hostname)"

    local message
    message="❌ Falha no backup Filtrovali

Servidor: $host
Data: $(date '+%Y-%m-%d %H:%M:%S')
Linha: $line_no
Comando: $cmd
Exit code: $exit_code"

    curl -sS \
      -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${message}" \
      >/dev/null || true
  fi

  exit "$exit_code"
}

trap notify_failure ERR

PROJECT_DIR="${PROJECT_DIR:-/home/ubuntu/apps/RDOAPP}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-filtrovali}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
REPORTS_VOLUME="${REPORTS_VOLUME:-filtrovali_relatorios}"
CERTS_VOLUME="${CERTS_VOLUME:-filtrovali_certs}"
BACKUP_ROOT="${BACKUP_ROOT:-/home/ubuntu/backups/filtrovali}"
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

UPLOAD_SUCCEEDED=false

if [ -n "$AWS_S3_URI" ]; then
  if command -v aws >/dev/null 2>&1; then
    echo "[backup] uploading to $AWS_S3_URI/$TIMESTAMP"
    aws s3 cp "$RUN_DIR" "$AWS_S3_URI/$TIMESTAMP" --recursive
    UPLOAD_SUCCEEDED=true
  else
    echo "[backup] aws cli not found, skipping S3 upload" >&2
  fi
fi

if [ "$UPLOAD_SUCCEEDED" = "true" ]; then
  echo "[backup] removing local backups except latest"
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name "20*" ! -path "$RUN_DIR" -exec rm -rf {} +
else
  echo "[backup] keeping local backups because S3 upload did not complete"
fi

echo "[backup] done: $RUN_DIR"
