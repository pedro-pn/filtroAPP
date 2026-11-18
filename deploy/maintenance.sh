#!/usr/bin/env bash
# Liga/desliga a página de manutenção de produção sem rebuild do nginx.
#
# Uso (no servidor):
#   deploy/maintenance.sh on ["motivo"]   # 503 para usuários; API responde JSON MAINTENANCE
#   deploy/maintenance.sh off
#   deploy/maintenance.sh status
#
# O nginx confere, a cada requisição, se existe $MAINTENANCE_DIR/on (pasta do host
# montada só leitura em /maintenance). Conferências internas (127.0.0.1),
# /nginx-health e /assets/ continuam respondendo. deploy-prod.sh usa o mesmo flag
# e não desliga uma manutenção que já estava ligada à mão.
set -euo pipefail

MAINTENANCE_DIR="${MAINTENANCE_DIR:-/root/backups/filtrovali/maintenance}"
FLAG="$MAINTENANCE_DIR/on"

case "${1:-status}" in
  on)
    mkdir -p "$MAINTENANCE_DIR"
    reason="${2:-manutenção manual}"
    printf '%s\t%s\t%s\n' "$(date -Iseconds)" "${SUDO_USER:-${USER:-root}}" "$reason" > "$FLAG.tmp"
    mv "$FLAG.tmp" "$FLAG"
    echo "[maintenance] LIGADA: $reason"
    ;;
  off)
    rm -f "$FLAG"
    echo "[maintenance] desligada"
    ;;
  status)
    if [ -f "$FLAG" ]; then
      echo "[maintenance] LIGADA desde: $(cat "$FLAG")"
    else
      echo "[maintenance] desligada"
    fi
    ;;
  *)
    echo "Uso: $0 on [motivo] | off | status" >&2
    exit 2
    ;;
esac
