#!/usr/bin/env bash
# Cria/atualiza o papel restrito do banco (deploy/db/app-role.sql) no Postgres
# da stack Docker. Idempotente. Roda no servidor, na raiz do checkout.
#
# Uso:
#   deploy/db/apply-app-role.sh [--staging] [--password-file ARQUIVO] [--role NOME]
#
#   --staging            usa docker-compose.staging.yml e backend/.env.staging
#   --password-file F    define/rotaciona a senha do papel com o conteúdo de F
#                        (sem o arquivo, só reaplica os GRANTs)
#   --role NOME          nome do papel (padrão: filtrovali_app)
#
# A senha nunca vai para a linha de comando: é enviada ao psql pela entrada
# padrão. Use só [A-Za-z0-9._~-] (vai dentro de uma URL de conexão).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SQL_FILE="$SCRIPT_DIR/app-role.sql"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE="backend/.env.production"
APP_ROLE="filtrovali_app"
PASSWORD_FILE=""
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-filtrovali}"

while [ $# -gt 0 ]; do
  case "$1" in
    --staging)
      COMPOSE_FILE="docker-compose.staging.yml"
      ENV_FILE="backend/.env.staging"
      shift
      ;;
    --password-file)
      PASSWORD_FILE="${2:?--password-file exige um caminho}"
      shift 2
      ;;
    --role)
      APP_ROLE="${2:?--role exige um nome}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      echo "Opção desconhecida: $1" >&2
      exit 2
      ;;
  esac
done

if ! [[ "$APP_ROLE" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
  echo "Nome de papel inválido: $APP_ROLE" >&2
  exit 2
fi

PASSWORD=""
if [ -n "$PASSWORD_FILE" ]; then
  if [ ! -r "$PASSWORD_FILE" ]; then
    echo "Arquivo de senha não encontrado: $PASSWORD_FILE" >&2
    exit 2
  fi
  PASSWORD="$(tr -d '\r\n' < "$PASSWORD_FILE")"
  if ! [[ "$PASSWORD" =~ ^[A-Za-z0-9._~-]{24,128}$ ]]; then
    echo "A senha deve ter de 24 a 128 caracteres em [A-Za-z0-9._~-]." >&2
    exit 2
  fi
fi

cd "$PROJECT_DIR"

COMPOSE=(docker compose -f "$COMPOSE_FILE")
if [ -f "$ENV_FILE" ]; then
  COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
fi

echo "[app-role] aplicando papel ${APP_ROLE} em ${POSTGRES_DB} (${COMPOSE_FILE})"
{
  if [ -n "$PASSWORD" ]; then
    printf '%s\n' "\\set app_password '${PASSWORD}'"
  fi
  cat "$SQL_FILE"
} | "${COMPOSE[@]}" exec -T "$POSTGRES_SERVICE" \
  psql -v ON_ERROR_STOP=1 -v "app_role=${APP_ROLE}" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q

echo "[app-role] concluído. Confira acima: superuser=f, can_create_in_public=f, tables_missing_grants=0."
