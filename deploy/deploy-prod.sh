#!/usr/bin/env bash
# Deploy versionado da stack de produção, com conferência e volta automática.
#
# Uso (no servidor, na raiz do checkout, depois de `git pull --ff-only`):
#   deploy/deploy-prod.sh                    # publica o commit em HEAD
#   deploy/deploy-prod.sh --rollback         # volta às imagens que estavam no ar antes do último deploy
#   deploy/deploy-prod.sh --rollback-to SHA  # volta a uma imagem local marcada com esse commit
#
# Opções: --skip-backup (sem dump antes do deploy), --allow-dirty (aceita
# arquivos rastreados alterados), --force (republica o mesmo commit),
# --maintenance / --no-maintenance (força ligar/não ligar a página de manutenção;
# o padrão liga só quando há migration pendente).
#
# Fluxo do deploy:
#   1. confere checkout limpo e descobre o commit no ar (APP_GIT_SHA da imagem);
#   2. marca as imagens em execução como :previous (alvo da volta);
#   3. builda backend/worker/nginx marcados com o SHA de HEAD;
#   4. faz um dump só do banco (volta de dados se uma migration destruir algo);
#   5. sobe a stack (migrations rodam antes do backend) e espera os healthchecks;
#      com migration pendente, liga a página de manutenção antes e desliga depois;
#   6. confere /health do backend, a versão do frontend e o worker;
#   7. se 5 ou 6 falharem, sobe de novo as imagens :previous e confere.
#
# Migrations só andam para frente: a volta troca o código, não o schema. Se a
# migration nova apagou ou reescreveu dados, a volta de dados é o restore do dump
# do passo 4 (veja docs/RUNBOOK_INCIDENTES.md).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(dirname "$SCRIPT_DIR")}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-backend/.env.production}"
IMAGE_PREFIX="${IMAGE_PREFIX:-filtrovali}"
STATE_DIR="${STATE_DIR:-/root/backups/filtrovali/deploy}"
DEPLOY_STATUS_FILE="${DEPLOY_STATUS_FILE:-/root/backups/filtrovali/status/deploy-latest.json}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-240}"
HEALTH_INTERVAL_SECONDS="${HEALTH_INTERVAL_SECONDS:-5}"
PRE_DEPLOY_BACKUP="${PRE_DEPLOY_BACKUP:-true}"
BACKUP_CMD="${BACKUP_CMD:-$SCRIPT_DIR/backup-prod.sh}"
PRE_DEPLOY_BACKUP_ROOT="${PRE_DEPLOY_BACKUP_ROOT:-/root/backups/filtrovali/pre-deploy}"
PRE_DEPLOY_BACKUP_KEEP="${PRE_DEPLOY_BACKUP_KEEP:-3}"
KEEP_IMAGES="${KEEP_IMAGES:-5}"
# Página de manutenção (mesmo flag de deploy/maintenance.sh). auto = liga só com
# migration pendente; on/off forçam. Migrations pendentes: pastas de
# backend/prisma/migrations do checkout que não estão aplicadas em _prisma_migrations.
MAINTENANCE="${MAINTENANCE:-auto}"
MAINTENANCE_DIR="${MAINTENANCE_DIR:-/root/backups/filtrovali/maintenance}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-backend/prisma/migrations}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-filtrovali}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
# Aviso por Telegram em FAILURE/ROLLED_BACK (e em SUCCESS com DEPLOY_NOTIFY_SUCCESS=true).
# Do arquivo só são lidas TELEGRAM_TOKEN e TELEGRAM_CHAT_ID; nada mais é carregado.
DEPLOY_NOTIFY_ENV_FILE="${DEPLOY_NOTIFY_ENV_FILE:-/root/.config/filtroapp-backup/env}"
DEPLOY_NOTIFY_SUCCESS="${DEPLOY_NOTIFY_SUCCESS:-false}"
TELEGRAM_API_URL="${TELEGRAM_API_URL:-https://api.telegram.org}"
APP_SERVICES=(backend worker nginx)

MODE="deploy"
TARGET_TAG=""
ALLOW_DIRTY=false
FORCE=false
STARTED_AT="$(date -Iseconds)"
NEW_SHA=""
PREV_SHA="unknown"

while [ $# -gt 0 ]; do
  case "$1" in
    --rollback) MODE="rollback"; TARGET_TAG="previous"; shift ;;
    --rollback-to) MODE="rollback"; TARGET_TAG="${2:?--rollback-to exige um SHA ou tag}"; shift 2 ;;
    --skip-backup) PRE_DEPLOY_BACKUP=false; shift ;;
    --allow-dirty) ALLOW_DIRTY=true; shift ;;
    --force) FORCE=true; shift ;;
    --maintenance) MAINTENANCE=on; shift ;;
    --no-maintenance) MAINTENANCE=off; shift ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "Opção desconhecida: $1" >&2; exit 2 ;;
  esac
done

log() { echo "[deploy $(date '+%H:%M:%S')] $*"; }

compose() {
  if [ -f "$ENV_FILE" ]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r'
}

# Lê uma chave KEY=valor (aceita `export` e aspas) sem executar o arquivo.
read_env_key() {
  local file="$1" key="$2"
  [ -r "$file" ] || return 0
  sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?${key}=[\"']?([^\"']*)[\"']?[[:space:]]*$/\\2/p" "$file" | tail -n 1
}

notify_deploy() {
  local status="$1" message="$2" token chat text
  case "$status" in
    FAILURE|ROLLED_BACK) ;;
    SUCCESS) [ "$DEPLOY_NOTIFY_SUCCESS" = "true" ] || return 0 ;;
    *) return 0 ;;
  esac
  token="${TELEGRAM_TOKEN:-$(read_env_key "$DEPLOY_NOTIFY_ENV_FILE" TELEGRAM_TOKEN)}"
  chat="${TELEGRAM_CHAT_ID:-$(read_env_key "$DEPLOY_NOTIFY_ENV_FILE" TELEGRAM_CHAT_ID)}"
  [ -n "$token" ] && [ -n "$chat" ] || return 0
  command -v curl > /dev/null 2>&1 || return 0
  case "$status" in
    SUCCESS) text="✅ Deploy Filtrovali ($MODE) em $(hostname): ${NEW_SHA:-$TARGET_TAG}" ;;
    ROLLED_BACK) text="⚠️ Deploy Filtrovali falhou em $(hostname) e voltou para ${PREV_SHA:0:12}: $message" ;;
    *) text="❌ Deploy Filtrovali ($MODE) falhou em $(hostname): $message" ;;
  esac
  curl -sS --max-time 15 -X POST "${TELEGRAM_API_URL%/}/bot${token}/sendMessage" \
    -d "chat_id=${chat}" --data-urlencode "text=${text:0:900}" > /dev/null 2>&1 \
    || log "AVISO: não foi possível enviar o aviso do deploy pelo Telegram"
  return 0
}

write_status() {
  local status="$1" message="$2"
  mkdir -p "$(dirname "$DEPLOY_STATUS_FILE")" "$STATE_DIR"
  cat > "${DEPLOY_STATUS_FILE}.tmp" <<EOF
{
  "kind": "deploy",
  "mode": "$MODE",
  "status": "$status",
  "startedAt": "$STARTED_AT",
  "finishedAt": "$(date -Iseconds)",
  "sha": "$(json_escape "${NEW_SHA:-$TARGET_TAG}")",
  "previousSha": "$(json_escape "$PREV_SHA")",
  "message": "$(json_escape "$message")"
}
EOF
  mv "${DEPLOY_STATUS_FILE}.tmp" "$DEPLOY_STATUS_FILE"
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -Iseconds)" "$MODE" "$status" "$PREV_SHA" "${NEW_SHA:-$TARGET_TAG}" \
    >> "$STATE_DIR/deploy-history.log"
  notify_deploy "$status" "$message" || true
}

MAINTENANCE_SET_BY_DEPLOY=false
PENDING_MIGRATIONS=()

maintenance_on() {
  local reason="$1"
  if [ -f "$MAINTENANCE_DIR/on" ]; then
    log "página de manutenção já estava ligada (fica como está ao final)"
    return 0
  fi
  # Não ligar a manutenção não pode impedir o deploy: só avisa.
  if ! { mkdir -p "$MAINTENANCE_DIR" \
      && printf '%s\tdeploy-prod.sh\t%s\n' "$(date -Iseconds)" "$reason" > "$MAINTENANCE_DIR/on.tmp" \
      && mv "$MAINTENANCE_DIR/on.tmp" "$MAINTENANCE_DIR/on"; } 2>/dev/null; then
    log "AVISO: não foi possível ligar a página de manutenção em $MAINTENANCE_DIR; seguindo sem ela"
    return 0
  fi
  MAINTENANCE_SET_BY_DEPLOY=true
  log "página de manutenção LIGADA: $reason"
}

maintenance_off() {
  [ "$MAINTENANCE_SET_BY_DEPLOY" = "true" ] || return 0
  rm -f "$MAINTENANCE_DIR/on"
  MAINTENANCE_SET_BY_DEPLOY=false
  log "página de manutenção desligada"
}

# Sempre desliga o que o deploy ligou, inclusive em falha, volta ou Ctrl+C.
trap 'maintenance_off' EXIT

# Preenche PENDING_MIGRATIONS. Retorna 1 quando não dá para saber (banco fora,
# tabela ausente): quem chama trata como "há migration pendente".
find_pending_migrations() {
  local applied name dir
  PENDING_MIGRATIONS=()
  [ -d "$MIGRATIONS_DIR" ] || return 0
  if ! applied="$(compose exec -T "$POSTGRES_SERVICE" psql -X -q -At -v ON_ERROR_STOP=1 \
      -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -c 'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL' 2>/dev/null)"; then
    return 1
  fi
  for dir in "$MIGRATIONS_DIR"/*/; do
    [ -f "${dir}migration.sql" ] || continue
    name="$(basename "$dir")"
    grep -qxF -- "$name" <<< "$applied" || PENDING_MIGRATIONS+=("$name")
  done
  return 0
}

container_id() {
  compose ps -q "$1" 2>/dev/null | head -n 1
}

running_sha() {
  local cid
  cid="$(container_id backend)"
  [ -n "$cid" ] || return 0
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$cid" 2>/dev/null \
    | sed -n 's/^APP_GIT_SHA=//p' | head -n 1
}

tag_running_images() {
  local tag="$1" svc cid image
  for svc in "${APP_SERVICES[@]}"; do
    cid="$(container_id "$svc")"
    if [ -z "$cid" ]; then
      log "AVISO: $svc não está rodando; sem imagem $tag para ele"
      continue
    fi
    image="$(docker inspect -f '{{.Image}}' "$cid")"
    docker tag "$image" "${IMAGE_PREFIX}-${svc}:${tag}"
    log "imagem em execução de $svc marcada como ${IMAGE_PREFIX}-${svc}:${tag}"
  done
}

images_exist() {
  local tag="$1" svc
  for svc in "${APP_SERVICES[@]}"; do
    docker image inspect "${IMAGE_PREFIX}-${svc}:${tag}" > /dev/null 2>&1 || return 1
  done
}

# Script rodado dentro do container do backend: /health deve responder 200 e,
# quando um SHA é esperado, a resposta (ou a imagem) deve apontar para ele.
BACKEND_CHECK='
const want = process.argv[1] || "";
fetch("http://localhost:4000/health", { signal: AbortSignal.timeout(5000) })
  .then(async response => {
    const text = await response.text();
    let body = {};
    try { body = JSON.parse(text); } catch {}
    if (!response.ok || body.ok === false) {
      console.error(`health ${response.status} ${text.slice(0, 300)}`);
      process.exit(1);
    }
    if (want) {
      const short = want.slice(0, 12);
      const reported = text.includes(short) || (process.env.APP_GIT_SHA || "").startsWith(short);
      if (!reported) {
        console.error(`backend não está no commit ${short}: ${text.slice(0, 300)}`);
        process.exit(1);
      }
    }
  })
  .catch(error => { console.error(error.message); process.exit(1); });
'

check_release_once() {
  local expected="$1" worker_cid worker_health version
  compose exec -T backend node -e "$BACKEND_CHECK" "$expected" || return 1
  compose exec -T nginx wget -q -O /dev/null http://127.0.0.1/nginx-health || return 1
  if [ -n "$expected" ]; then
    version="$(compose exec -T nginx wget -q -O - http://127.0.0.1/app-version.json 2>/dev/null || true)"
    case "$version" in
      *"$expected"*) ;;
      *) echo "frontend não está no commit $expected: $version" >&2; return 1 ;;
    esac
  fi
  worker_cid="$(container_id worker)"
  [ -n "$worker_cid" ] || { echo "worker não está rodando" >&2; return 1; }
  worker_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$worker_cid")"
  [ "$worker_health" = "healthy" ] || { echo "worker: $worker_health" >&2; return 1; }
}

verify_release() {
  local expected="$1" deadline
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))
  while true; do
    if check_release_once "$expected"; then
      log "conferência OK${expected:+ (commit $expected)}"
      return 0
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      log "conferência falhou depois de ${HEALTH_TIMEOUT_SECONDS}s"
      return 1
    fi
    sleep "$HEALTH_INTERVAL_SECONDS"
  done
}

# `:latest` acompanha o que está no ar, para comandos manuais sem APP_GIT_SHA
# (`docker compose up -d backend`) não ressuscitarem uma imagem velha.
mark_as_latest() {
  local tag="$1" svc
  for svc in "${APP_SERVICES[@]}"; do
    docker tag "${IMAGE_PREFIX}-${svc}:${tag}" "${IMAGE_PREFIX}-${svc}:latest"
  done
}

switch_to_images() {
  local tag="$1"
  log "subindo backend, worker e nginx com as imagens :$tag (sem build, sem migrations)"
  APP_GIT_SHA="$tag" compose up -d --no-build --no-deps --force-recreate "${APP_SERVICES[@]}" || return 1
  mark_as_latest "$tag"
}

rollback_after_failure() {
  local reason="$1"
  log "FALHA: $reason"
  if ! images_exist previous; then
    log "CRÍTICO: não há imagens :previous para voltar; siga docs/RUNBOOK_INCIDENTES.md"
    write_status "FAILURE" "$reason; sem imagens :previous"
    exit 1
  fi
  log "voltando automaticamente para a versão anterior ($PREV_SHA)"
  if switch_to_images previous && verify_release ""; then
    write_status "ROLLED_BACK" "$reason"
    log "versão anterior ($PREV_SHA) no ar. O checkout continua em $NEW_SHA."
    log "Migrations já aplicadas continuam no banco; se a nova migration alterou dados, veja o runbook."
    exit 1
  fi
  write_status "FAILURE" "$reason; a volta automática também falhou"
  log "CRÍTICO: a volta automática falhou; siga docs/RUNBOOK_INCIDENTES.md"
  exit 1
}

prune_images() {
  local svc tag kept
  [[ "$KEEP_IMAGES" =~ ^[1-9][0-9]*$ ]] || return 0
  for svc in "${APP_SERVICES[@]}"; do
    kept=0
    while IFS= read -r tag; do
      [[ "$tag" =~ ^[0-9a-f]{40}$ ]] || continue
      if [ "$tag" = "$NEW_SHA" ] || [ "$kept" -lt "$KEEP_IMAGES" ]; then
        kept=$((kept + 1))
        continue
      fi
      docker image rm "${IMAGE_PREFIX}-${svc}:${tag}" > /dev/null 2>&1 \
        && log "imagem antiga removida: ${IMAGE_PREFIX}-${svc}:${tag}" || true
    done < <(docker image ls "${IMAGE_PREFIX}-${svc}" --format '{{.Tag}}' 2>/dev/null || true)
  done
}

pre_deploy_backup() {
  if [ "$PRE_DEPLOY_BACKUP" != "true" ]; then
    log "dump antes do deploy desativado"
    return 0
  fi
  log "dump do banco antes do deploy em $PRE_DEPLOY_BACKUP_ROOT"
  mkdir -p "$PRE_DEPLOY_BACKUP_ROOT"
  BACKUP_ROOT="$PRE_DEPLOY_BACKUP_ROOT" \
  BACKUP_STATUS_FILE="$PRE_DEPLOY_BACKUP_ROOT/status.json" \
  BACKUP_LOCK_FILE="$PRE_DEPLOY_BACKUP_ROOT/backup.lock" \
  BACKUP_LOCK_TIMEOUT_SECONDS=600 \
  INCLUDE_REPORTS=false INCLUDE_CERTS=false INCLUDE_PROXY=false B2_URI="" \
  LOCAL_BACKUP_KEEP="$PRE_DEPLOY_BACKUP_KEEP" \
  PROJECT_DIR="$PROJECT_DIR" COMPOSE_FILE="$COMPOSE_FILE" \
    "$BACKUP_CMD"
}

cd "$PROJECT_DIR"
mkdir -p "$STATE_DIR"

exec 8> "$STATE_DIR/deploy.lock"
if command -v flock > /dev/null 2>&1 && ! flock -n 8; then
  echo "[deploy] outro deploy está em andamento" >&2
  exit 1
fi

PREV_SHA="$(running_sha)"
PREV_SHA="${PREV_SHA:-unknown}"

if [ "$MODE" = "rollback" ]; then
  if ! images_exist "$TARGET_TAG"; then
    echo "[deploy] não existem imagens ${IMAGE_PREFIX}-{backend,worker,nginx}:$TARGET_TAG neste servidor" >&2
    exit 1
  fi
  tag_running_images before-rollback
  [ "$MAINTENANCE" = "on" ] && maintenance_on "volta manual para :$TARGET_TAG"
  expected=""
  [[ "$TARGET_TAG" =~ ^[0-9a-f]{40}$ ]] && expected="$TARGET_TAG"
  if switch_to_images "$TARGET_TAG" && verify_release "$expected"; then
    write_status "SUCCESS" "volta manual para :$TARGET_TAG"
    log "no ar: :$TARGET_TAG. Para desfazer: deploy/deploy-prod.sh --rollback-to before-rollback"
    exit 0
  fi
  write_status "FAILURE" "volta manual para :$TARGET_TAG falhou"
  log "a versão :$TARGET_TAG não passou na conferência; para desfazer: deploy/deploy-prod.sh --rollback-to before-rollback"
  exit 1
fi

if [ "$ALLOW_DIRTY" != "true" ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "[deploy] há arquivos rastreados alterados no checkout; o que vai ao ar precisa estar no Git." >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

NEW_SHA="$(git rev-parse HEAD)"
if [ "$NEW_SHA" = "$PREV_SHA" ] && [ "$FORCE" != "true" ]; then
  log "o commit $NEW_SHA já está no ar (use --force para republicar)"
  exit 0
fi

log "publicando $NEW_SHA (no ar: $PREV_SHA)"
tag_running_images previous

export APP_GIT_SHA="$NEW_SHA"
BUILD_SERVICES=("${APP_SERVICES[@]}")
if compose config --services 2>/dev/null | grep -qx migrate; then
  BUILD_SERVICES=(migrate "${APP_SERVICES[@]}")
fi
log "build de ${BUILD_SERVICES[*]}"
if ! compose build "${BUILD_SERVICES[@]}"; then
  write_status "FAILURE" "build falhou; nada foi trocado"
  log "build falhou; a versão no ar não foi alterada"
  exit 1
fi

if ! pre_deploy_backup; then
  write_status "FAILURE" "dump antes do deploy falhou; nada foi trocado"
  log "dump antes do deploy falhou; a versão no ar não foi alterada (use --skip-backup só se souber o que faz)"
  exit 1
fi

case "$MAINTENANCE" in
  on) maintenance_on "deploy $NEW_SHA (--maintenance)" ;;
  off) log "página de manutenção desativada para este deploy (--no-maintenance)" ;;
  *)
    if find_pending_migrations; then
      if [ "${#PENDING_MIGRATIONS[@]}" -gt 0 ]; then
        log "migrations pendentes (${#PENDING_MIGRATIONS[@]}): ${PENDING_MIGRATIONS[*]}"
        maintenance_on "deploy $NEW_SHA: ${#PENDING_MIGRATIONS[@]} migration(s) pendente(s)"
      else
        log "nenhuma migration pendente; deploy sem página de manutenção"
      fi
    else
      log "não foi possível listar as migrations aplicadas; ligando a manutenção por segurança"
      maintenance_on "deploy $NEW_SHA: migrations não conferidas"
    fi
    ;;
esac

log "subindo a stack (migrations antes do backend) e aguardando healthchecks"
if ! compose up -d --wait --wait-timeout "$HEALTH_TIMEOUT_SECONDS" "${APP_SERVICES[@]}"; then
  # Versões antigas do Compose tratam um serviço one-shot encerrado (migrate)
  # como falha do --wait; só volta se a versão nova realmente não respondeu.
  log "docker compose up --wait retornou erro; conferindo se a versão nova está no ar mesmo assim"
  if ! verify_release "$NEW_SHA"; then
    rollback_after_failure "docker compose up não ficou saudável (migration ou healthcheck)"
  fi
elif ! verify_release "$NEW_SHA"; then
  rollback_after_failure "conferência pós-deploy falhou"
fi

maintenance_off
mark_as_latest "$NEW_SHA"
printf '%s\n' "$NEW_SHA" > "$STATE_DIR/current-sha"
write_status "SUCCESS" "deploy concluído"
prune_images
log "deploy concluído: $NEW_SHA no ar (anterior: $PREV_SHA)"
