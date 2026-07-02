#!/usr/bin/env bash
set -euo pipefail

TELEGRAM_TOKEN="${TELEGRAM_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

PATH="/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
export PATH

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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(dirname "$SCRIPT_DIR")}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-filtrovali}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
REPORTS_VOLUME="${REPORTS_VOLUME:-filtrovali_relatorios}"
CERTS_VOLUME="${CERTS_VOLUME:-filtrovali_certs}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/backups/filtrovali}"
BACKUP_LOCK_FILE="${BACKUP_LOCK_FILE:-$BACKUP_ROOT/backup-prod.lock}"
BACKUP_LOCK_TIMEOUT_SECONDS="${BACKUP_LOCK_TIMEOUT_SECONDS:-0}"
INCLUDE_CERTS="${INCLUDE_CERTS:-true}"
INCLUDE_REPORTS="${INCLUDE_REPORTS:-true}"
B2_URI="${B2_URI:-}"
B2_BIN="${B2_BIN:-b2}"
LOCAL_BACKUP_KEEP="${LOCAL_BACKUP_KEEP:-}"

prune_local_backups() {
  local backup_root="$1"
  local keep="$2"

  if ! [[ "$keep" =~ ^[1-9][0-9]*$ ]]; then
    echo "[backup] LOCAL_BACKUP_KEEP must be a positive integer; got '$keep'" >&2
    return 1
  fi

  local backups=()
  mapfile -t backups < <(find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name "20*" -printf "%f\n" | sort -r)

  local total="${#backups[@]}"
  if [ "$total" -le "$keep" ]; then
    echo "[backup] local retention: $total backup(s) found; keeping up to $keep"
    return 0
  fi

  echo "[backup] local retention: keeping newest $keep backup(s), deleting $((total - keep)) old backup(s)"

  local index=0
  local backup_name
  for backup_name in "${backups[@]}"; do
    index=$((index + 1))
    if [ "$index" -le "$keep" ]; then
      continue
    fi

    rm -rf "$backup_root/$backup_name"
  done
}

mkdir -p "$BACKUP_ROOT"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$BACKUP_LOCK_FILE"
  if ! flock -w "$BACKUP_LOCK_TIMEOUT_SECONDS" 9; then
    echo "[backup] another backup is already running; skipping this run"
    exit 0
  fi
else
  echo "[backup] flock not found, continuing without concurrency lock" >&2
fi

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

if [ -n "$B2_URI" ]; then
  if command -v "$B2_BIN" >/dev/null 2>&1; then
    B2_DEST="${B2_URI%/}/$TIMESTAMP"
    echo "[backup] uploading to $B2_DEST"
    "$B2_BIN" sync "$RUN_DIR" "$B2_DEST"
    UPLOAD_SUCCEEDED=true
  else
    echo "[backup] b2 command not found, skipping Backblaze B2 upload" >&2
  fi
fi

if [ -n "$LOCAL_BACKUP_KEEP" ]; then
  prune_local_backups "$BACKUP_ROOT" "$LOCAL_BACKUP_KEEP"
elif [ "$UPLOAD_SUCCEEDED" = "true" ]; then
  echo "[backup] removing local backups except latest"
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name "20*" ! -path "$RUN_DIR" -exec rm -rf {} +
else
  echo "[backup] keeping local backups because remote upload did not complete"
fi

echo "[backup] done: $RUN_DIR"
