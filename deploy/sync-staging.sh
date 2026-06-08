#!/usr/bin/env bash
# Sincroniza o banco de homologação com o último snapshot de produção.
#
# Comportamento:
#   - Se o ambiente de homologação estiver PARADO: sobe o banco, aplica o snapshot,
#     roda migrations e desliga tudo ao final.
#   - Se o ambiente de homologação estiver RODANDO: para o backend e nginx,
#     aplica o snapshot, roda migrations e sobe tudo novamente.
#
# Uso no crontab (03:00 diário):
#   0 3 * * * /root/apps/filtroAPP-staging/deploy/sync-staging.sh >> /root/logs/sync-staging.log 2>&1
#
# Variáveis configuráveis via ambiente ou backend/.env.staging:
#   PROJECT_DIR, BACKUP_ROOT, STAGING_COMPOSE_FILE, POSTGRES_DB, POSTGRES_USER,
#   STAGING_POSTGRES_PASSWORD, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(dirname "$SCRIPT_DIR")}"
STAGING_COMPOSE_FILE="${STAGING_COMPOSE_FILE:-docker-compose.staging.yml}"
STAGING_ENV_FILE="${STAGING_ENV_FILE:-$PROJECT_DIR/backend/.env.staging}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/backups/filtrovali}"
POSTGRES_DB="${POSTGRES_DB:-filtrovali}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
LOCKFILE="${LOCKFILE:-/tmp/filtrovali-sync-staging.lock}"

TELEGRAM_TOKEN="${TELEGRAM_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

# Carrega variáveis do backend/.env.staging (incluindo STAGING_POSTGRES_PASSWORD).
if [ -f "$STAGING_ENV_FILE" ]; then
  set -o allexport
  # shellcheck source=/dev/null
  source "$STAGING_ENV_FILE"
  set +o allexport
fi

# ---------------------------------------------------------------------------
# Funções auxiliares
# ---------------------------------------------------------------------------

log() {
  echo "[sync-staging] $(date '+%Y-%m-%d %H:%M:%S') $*"
}

notify_failure() {
  local exit_code="$?"
  local line_no="${BASH_LINENO[0]}"
  local cmd="${BASH_COMMAND}"

  log "falhou com exit code $exit_code na linha $line_no: $cmd" >&2

  if [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    local host
    host="$(hostname)"
    local message
    message="❌ Falha no sync-staging Filtrovali

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

  rm -f "$LOCKFILE"
  exit "$exit_code"
}

trap notify_failure ERR

# ---------------------------------------------------------------------------
# Lock — evita execuções simultâneas (ex: cron atrasado)
# ---------------------------------------------------------------------------

if [ -e "$LOCKFILE" ]; then
  log "outro processo em andamento (lockfile: $LOCKFILE), abortando." >&2
  exit 1
fi
touch "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

# ---------------------------------------------------------------------------
# Validação do backup
# ---------------------------------------------------------------------------

LATEST_BACKUP="$BACKUP_ROOT/latest"

if [ ! -L "$LATEST_BACKUP" ] && [ ! -d "$LATEST_BACKUP" ]; then
  log "nenhum backup encontrado em $LATEST_BACKUP" >&2
  exit 1
fi

if [ ! -f "$LATEST_BACKUP/postgres.sql.gz" ]; then
  log "arquivo não encontrado: $LATEST_BACKUP/postgres.sql.gz" >&2
  exit 1
fi

# Alerta se o backup tiver mais de 48 horas (problema no script de backup).
BACKUP_AGE_HOURS=$(( ( $(date +%s) - $(stat -c %Y "$LATEST_BACKUP/postgres.sql.gz") ) / 3600 ))
if [ "$BACKUP_AGE_HOURS" -gt 48 ]; then
  log "AVISO: backup mais recente tem ${BACKUP_AGE_HOURS}h — verifique o script de backup." >&2
fi

log "usando backup: $(readlink -f "$LATEST_BACKUP") (${BACKUP_AGE_HOURS}h atrás)"

# ---------------------------------------------------------------------------
# Estado atual do ambiente de homologação
# ---------------------------------------------------------------------------

cd "$PROJECT_DIR"

STAGING_WAS_UP=false
if docker compose -f "$STAGING_COMPOSE_FILE" ps --quiet --status running 2>/dev/null | grep -q .; then
  STAGING_WAS_UP=true
  log "ambiente de homologação estava RODANDO"
else
  log "ambiente de homologação estava PARADO"
fi

# ---------------------------------------------------------------------------
# Preparação: garantir que o postgres de homologação está disponível
# ---------------------------------------------------------------------------

if [ "$STAGING_WAS_UP" = "true" ]; then
  log "parando backend e nginx para aplicar o snapshot"
  docker compose -f "$STAGING_COMPOSE_FILE" stop backend nginx
else
  log "subindo apenas o postgres de homologação"
  docker compose -f "$STAGING_COMPOSE_FILE" up -d postgres
fi

log "aguardando postgres de homologação ficar pronto"
until docker compose -f "$STAGING_COMPOSE_FILE" exec -T postgres \
    pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q 2>/dev/null; do
  sleep 2
done
log "postgres pronto"

# ---------------------------------------------------------------------------
# Restauração do banco
# ---------------------------------------------------------------------------

log "descartando e recriando o banco $POSTGRES_DB em homologação"
docker compose -f "$STAGING_COMPOSE_FILE" exec -T postgres \
  psql -U "$POSTGRES_USER" -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS $POSTGRES_DB;" \
  -c "CREATE DATABASE $POSTGRES_DB;" \
  >/dev/null

log "restaurando banco a partir de $LATEST_BACKUP/postgres.sql.gz"
gunzip -c "$LATEST_BACKUP/postgres.sql.gz" \
  | docker compose -f "$STAGING_COMPOSE_FILE" exec -T postgres \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q

log "banco restaurado"

# ---------------------------------------------------------------------------
# Migrations pendentes
# ---------------------------------------------------------------------------

log "aplicando migrations pendentes"
docker compose -f "$STAGING_COMPOSE_FILE" run --rm --no-deps \
  backend sh -c "npx prisma migrate deploy"

# ---------------------------------------------------------------------------
# Restauração do estado do ambiente
# ---------------------------------------------------------------------------

if [ "$STAGING_WAS_UP" = "true" ]; then
  log "subindo backend e nginx com o banco atualizado"
  docker compose -f "$STAGING_COMPOSE_FILE" up -d backend nginx
  log "homologação atualizada e RODANDO"
else
  log "desligando ambiente de homologação"
  docker compose -f "$STAGING_COMPOSE_FILE" down
  log "homologação atualizada e PARADA (suba manualmente quando precisar)"
fi

# ---------------------------------------------------------------------------

log "concluído"
