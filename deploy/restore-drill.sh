#!/usr/bin/env bash
# Ensaio de restauração: prova que o backup mais recente fora do servidor volta.
#
# Baixa o dump mais recente do Backblaze B2 (ou usa uma pasta local), confere os
# checksums, restaura num PostgreSQL descartável (container próprio, sem rede,
# apagado no fim), roda conferências de sanidade e grava o resultado no mesmo
# JSON de status lido por /api/operations/status (restore-latest.json).
# NUNCA toca o banco de produção nem a stack Docker Compose.
#
# Uso (no servidor):
#   deploy/restore-drill.sh                         # último backup em b2://filtrovali-backups/daily
#   RESTORE_DRILL_B2_URI=b2://filtrovali-backups/monthly deploy/restore-drill.sh
#   RESTORE_DRILL_SOURCE=/root/backups/filtrovali/latest deploy/restore-drill.sh   # pasta local
#
# Agendamento sugerido (mensal, dia 2 às 04:30; ajuste OPERATIONS_RESTORE_MAX_AGE_DAYS=35):
#   30 4 2 * * /root/apps/filtroAPP/deploy/restore-drill.sh >> /root/logs/restore-drill.log 2>&1
set -euo pipefail

# Cron tem PATH mínimo: acrescenta (sem sobrepor) os diretórios do b2/docker.
PATH="${PATH:-/usr/bin:/bin}:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH

STARTED_AT="$(date -Iseconds)"
STARTED_EPOCH="$(date +%s)"
RESTORE_DRILL_B2_URI="${RESTORE_DRILL_B2_URI:-b2://filtrovali-backups/daily}"
RESTORE_DRILL_SOURCE="${RESTORE_DRILL_SOURCE:-}"
B2_BIN="${B2_BIN:-b2}"
B2_ENV_FILE="${B2_ENV_FILE:-/root/.config/newrdo-backup/b2.env}"
RESTORE_STATUS_FILE="${RESTORE_STATUS_FILE:-/root/backups/filtrovali/status/restore-latest.json}"
WORK_ROOT="${RESTORE_DRILL_WORK_ROOT:-/root/backups/filtrovali/restore-drill}"
POSTGRES_IMAGE="${RESTORE_DRILL_POSTGRES_IMAGE:-postgres:16-alpine}"
CONTAINER_NAME="filtrovali-restore-drill-$$"
APP_DB_ROLE="${APP_DB_ROLE:-filtrovali_app}"
MAX_DATA_AGE_HOURS="${RESTORE_DRILL_MAX_DATA_AGE_HOURS:-96}"
CHECK_REPORTS_ARCHIVE="${RESTORE_DRILL_CHECK_REPORTS_ARCHIVE:-true}"
DRILL_MEMORY="${RESTORE_DRILL_MEMORY:-1g}"
DRILL_CPUS="${RESTORE_DRILL_CPUS:-1}"
TELEGRAM_TOKEN="${TELEGRAM_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

WORK_DIR=""
BACKUP_LABEL=""
SANITY_JSON="{}"

log() { echo "[restore-drill $(date '+%H:%M:%S')] $*"; }

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r'
}

write_status() {
  local status="$1" message="$2"
  local finished_epoch
  finished_epoch="$(date +%s)"
  mkdir -p "$(dirname "$RESTORE_STATUS_FILE")"
  cat > "${RESTORE_STATUS_FILE}.tmp" <<EOF
{
  "kind": "restore-drill",
  "status": "$status",
  "startedAt": "$STARTED_AT",
  "finishedAt": "$(date -Iseconds)",
  "durationSeconds": $((finished_epoch - STARTED_EPOCH)),
  "backupSource": "$(json_escape "$BACKUP_LABEL")",
  "target": "throwaway-container",
  "sanity": $SANITY_JSON,
  "message": "$(json_escape "$message")"
}
EOF
  mv "${RESTORE_STATUS_FILE}.tmp" "$RESTORE_STATUS_FILE"
}

cleanup() {
  docker rm -f "$CONTAINER_NAME" > /dev/null 2>&1 || true
  if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
    rm -rf -- "$WORK_DIR"
  fi
}

on_error() {
  local exit_code="$?" line_no="${BASH_LINENO[0]}"
  log "FALHA (exit $exit_code, linha $line_no): ${BASH_COMMAND}"
  write_status "FAILURE" "linha $line_no: ${BASH_COMMAND}" || true
  if [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    curl -sS --max-time 15 -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=❌ Ensaio de restauração Filtrovali falhou em $(hostname): linha $line_no" \
      > /dev/null || true
  fi
  cleanup
  exit "$exit_code"
}

trap on_error ERR
trap cleanup EXIT

psql_drill() {
  docker exec -i "$CONTAINER_NAME" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d filtrovali "$@"
}

mkdir -p "$WORK_ROOT"
WORK_DIR="$(mktemp -d "$WORK_ROOT/run-XXXXXX")"

# 1. Origem do backup ---------------------------------------------------------
if [ -n "$RESTORE_DRILL_SOURCE" ]; then
  SOURCE_DIR="$(readlink -f "$RESTORE_DRILL_SOURCE")"
  BACKUP_LABEL="$SOURCE_DIR"
  log "usando backup local $SOURCE_DIR"
else
  if [ -f "$B2_ENV_FILE" ]; then
    # shellcheck disable=SC1090
    source "$B2_ENV_FILE"
  fi
  command -v "$B2_BIN" > /dev/null 2>&1 || { log "CLI b2 não encontrada (B2_BIN=$B2_BIN)"; false; }
  log "procurando o backup mais recente em $RESTORE_DRILL_B2_URI"
  LATEST="$("$B2_BIN" ls "${RESTORE_DRILL_B2_URI%/}/" | sed 's#/$##' | awk -F/ '{print $NF}' \
    | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}$' | sort | tail -n 1 || true)"
  [ -n "$LATEST" ] || { log "nenhum backup encontrado em $RESTORE_DRILL_B2_URI"; false; }
  BACKUP_LABEL="${RESTORE_DRILL_B2_URI%/}/$LATEST"
  SOURCE_DIR="$WORK_DIR/backup"
  mkdir -p "$SOURCE_DIR"
  log "baixando $BACKUP_LABEL"
  "$B2_BIN" sync "$BACKUP_LABEL" "$SOURCE_DIR"
fi

[ -s "$SOURCE_DIR/postgres.sql.gz" ] || { log "postgres.sql.gz ausente ou vazio em $SOURCE_DIR"; false; }

# 2. Integridade --------------------------------------------------------------
if [ -f "$SOURCE_DIR/SHA256SUMS" ]; then
  log "conferindo SHA256SUMS"
  (cd "$SOURCE_DIR" && sha256sum -c --quiet SHA256SUMS)
else
  log "SHA256SUMS ausente; o backup não pode ser comprovado"
  false
fi
gzip -t "$SOURCE_DIR/postgres.sql.gz"
if [ "$CHECK_REPORTS_ARCHIVE" = "true" ] && [ -f "$SOURCE_DIR/relatorios.tar.gz" ]; then
  log "conferindo a leitura de relatorios.tar.gz"
  tar -tzf "$SOURCE_DIR/relatorios.tar.gz" > /dev/null
fi

# 3. PostgreSQL descartável, sem rede ------------------------------------------
log "subindo PostgreSQL descartável ($POSTGRES_IMAGE, sem rede)"
docker run -d --rm --name "$CONTAINER_NAME" --network none \
  --memory "$DRILL_MEMORY" --cpus "$DRILL_CPUS" \
  -e POSTGRES_PASSWORD="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  -e POSTGRES_DB=filtrovali \
  "$POSTGRES_IMAGE" > /dev/null

for _ in $(seq 1 60); do
  docker exec "$CONTAINER_NAME" pg_isready -U postgres -d filtrovali -q 2> /dev/null && break
  sleep 2
done
docker exec "$CONTAINER_NAME" pg_isready -U postgres -d filtrovali -q

# O dump traz GRANTs para o papel da aplicação; papéis não vêm no dump.
docker exec -i "$CONTAINER_NAME" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -v "app_role=$APP_DB_ROLE" <<'SQL'
SELECT format('CREATE ROLE %I NOLOGIN', :'app_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role')
\gexec
SQL

# 4. Restore ------------------------------------------------------------------
RESTORE_STARTED="$(date +%s)"
log "restaurando o dump (ON_ERROR_STOP)"
gunzip -c "$SOURCE_DIR/postgres.sql.gz" | psql_drill > /dev/null
RESTORE_SECONDS=$(( $(date +%s) - RESTORE_STARTED ))
log "restore concluído em ${RESTORE_SECONDS}s"

# 5. Sanidade -----------------------------------------------------------------
SANITY_LINE="$(psql_drill -At -F '|' <<'SQL'
SELECT
  (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
  (SELECT count(*) FROM "User"),
  (SELECT count(*) FROM "Project"),
  (SELECT count(*) FROM "Collaborator"),
  (SELECT count(*) FROM "Report"),
  COALESCE((SELECT max("reportDate")::date::text FROM "Report"), ''),
  COALESCE((SELECT floor(extract(epoch FROM now() - max("createdAt")) / 3600)::int::text FROM "Report"), ''),
  pg_size_pretty(pg_database_size(current_database()));
SQL
)"
IFS='|' read -r MIGRATIONS USERS PROJECTS COLLABORATORS REPORTS LATEST_REPORT_DATE HOURS_SINCE_LAST_REPORT DB_SIZE <<< "$SANITY_LINE"

SANITY_JSON="$(cat <<EOF
{
    "restoreSeconds": $RESTORE_SECONDS,
    "appliedMigrations": ${MIGRATIONS:-0},
    "users": ${USERS:-0},
    "projects": ${PROJECTS:-0},
    "collaborators": ${COLLABORATORS:-0},
    "reports": ${REPORTS:-0},
    "latestReportDate": "$(json_escape "$LATEST_REPORT_DATE")",
    "hoursSinceLastReport": ${HOURS_SINCE_LAST_REPORT:-null},
    "databaseSize": "$(json_escape "$DB_SIZE")"
  }
EOF
)"
log "migrations=$MIGRATIONS usuários=$USERS projetos=$PROJECTS colaboradores=$COLLABORATORS relatórios=$REPORTS último RDO=$LATEST_REPORT_DATE (${HOURS_SINCE_LAST_REPORT}h) tamanho=$DB_SIZE"

FAILURES=()
[ "${MIGRATIONS:-0}" -gt 0 ] || FAILURES+=("nenhuma migration aplicada")
[ "${USERS:-0}" -gt 0 ] || FAILURES+=("nenhum usuário")
[ "${PROJECTS:-0}" -gt 0 ] || FAILURES+=("nenhum projeto")
[ "${REPORTS:-0}" -gt 0 ] || FAILURES+=("nenhum relatório")
if [ -n "${HOURS_SINCE_LAST_REPORT:-}" ] && [ "$HOURS_SINCE_LAST_REPORT" -gt "$MAX_DATA_AGE_HOURS" ]; then
  FAILURES+=("último relatório criado há ${HOURS_SINCE_LAST_REPORT}h (limite ${MAX_DATA_AGE_HOURS}h): backup velho?")
fi

if [ "${#FAILURES[@]}" -gt 0 ]; then
  message="sanidade reprovada: $(IFS='; '; echo "${FAILURES[*]}")"
  log "$message"
  trap - ERR
  write_status "FAILURE" "$message"
  exit 1
fi

trap - ERR
write_status "SUCCESS" "restore de $BACKUP_LABEL em ${RESTORE_SECONDS}s"
log "ensaio OK: $BACKUP_LABEL restaurado em ${RESTORE_SECONDS}s (total $(( $(date +%s) - STARTED_EPOCH ))s)"
