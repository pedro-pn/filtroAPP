#!/usr/bin/env bash
# =============================================================================
#  RASCUNHO PARA REVISÃO — alternativa em curl (Linux/macOS, ou Git Bash no Windows)
# -----------------------------------------------------------------------------
#  Envia o banco comercial Access para o app. Agende via cron / Agendador.
#  Variáveis (exporte no ambiente ou edite abaixo):
#    APP_URL  -> URL do app
#    TOKEN    -> valor de COMMERCIAL_IMPORT_TOKEN do servidor
#    DB_PATH  -> caminho do propostas_bd.accdb
# =============================================================================
set -euo pipefail

APP_URL="${APP_URL:-https://relatorios.suaempresa.com.br}"
TOKEN="${TOKEN:-COLE_AQUI_O_COMMERCIAL_IMPORT_TOKEN}"
DB_PATH="${DB_PATH:-/caminho/propostas_bd.accdb}"

FILE_NAME="$(basename "$DB_PATH")"

# -T faz upload do arquivo como corpo binário (octet-stream).
curl --fail --show-error --silent \
  -X POST "$APP_URL/api/acompanhamento/comercial/import" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  -H "X-File-Name: $FILE_NAME" \
  --data-binary "@$DB_PATH" | tee /dev/stderr

# Exemplo cron (a cada hora):
#   0 * * * * APP_URL=... TOKEN=... DB_PATH=/c/Comercial/propostas_bd.accdb /caminho/enviar-propostas.sh
