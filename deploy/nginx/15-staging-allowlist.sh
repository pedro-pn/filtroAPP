#!/bin/sh
# Executado pelo entrypoint oficial do Nginx, somente no stack de staging.
set -eu
set -f

staging_allowlist=/etc/nginx/staging-allowed-ips.conf
: > "$staging_allowlist"

# Aceita IPs/CIDRs separados por vírgula ou espaço. O Nginx valida os endereços
# ao iniciar; a checagem abaixo impede inserir diretivas pela variável.
for staging_allowed_ip in $(printf '%s' "${STAGING_ALLOWED_IPS:-}" | tr ',' ' '); do
  case "$staging_allowed_ip" in
    *[!0-9a-fA-F.:/]*)
      echo '[staging] STAGING_ALLOWED_IPS deve conter somente IPs ou CIDRs.' >&2
      exit 1
      ;;
  esac
  printf '%s 1;\n' "$staging_allowed_ip" >> "$staging_allowlist"
done
