# Integração com o infra-proxy

O proxy reverso compartilhado da VPS pertence ao repositório independente
`infra-proxy`. Seu checkout sugerido é `../infra-proxy`, ao lado da raiz do
filtroAPP. O `Caddyfile`, `docker-compose.yml`, `RUNBOOK.md` e `FILTROBOARD.md`
ficam na raiz desse repositório. O remoto GitHub será configurado quando o novo
repositório for criado.

O filtroAPP mantém seu Nginx interno e os stacks de produção e homologação.
Alterações de domínio, TLS ou roteamento compartilhado devem ser feitas no
repositório `infra-proxy`; publicar o filtroAPP não atualiza o proxy.

## Contrato entre os stacks

| Item | Contrato |
|---|---|
| Rede Docker externa | `proxy-net`, no mesmo daemon Docker |
| Proxy compartilhado | Container `infra-proxy-caddy`; publica TCP `80/443` e UDP `443` |
| Produção | `app.filtrovali.com.br` → `filtrovali-nginx:80` |
| Homologação | `filtrostaging.filtrovali.com.br` → `filtrovali-staging-nginx:80` |
| Domínio legado | `relatorios.filtrovali.com.br` → aplicação; `/` redireciona para `/rdo` |
| Headers encaminhados | IP do visitante em `X-Forwarded-For`; esquema em `X-Forwarded-Proto` |
| Estado persistente do proxy | Volumes `infra_proxy_data` e `infra_proxy_config` |

O Nginx, o backend e o Postgres do filtroAPP não publicam portas no host. O Nginx
de staging confia no nome `infra-proxy-caddy` para aplicar a restrição por IP.
Mantenha esse nome ao operar o proxy em seu repositório próprio.

## Servidor novo

Prepare o checkout independente ao lado do filtroAPP antes de executar os
comandos abaixo, a partir da raiz do filtroAPP. Confira DNS e portas conforme
o `RUNBOOK.md` externo.

```bash
docker network inspect proxy-net >/dev/null 2>&1 || docker network create proxy-net
docker compose -f ../infra-proxy/docker-compose.yml config -q
docker compose -f ../infra-proxy/docker-compose.yml up -d
```

Depois siga [PRODUCTION.md](PRODUCTION.md) ou [STAGING.md](STAGING.md) para subir
a aplicação. Para outro local de checkout, ajuste o caminho do Compose nos
comandos de operação do proxy.

## VPS com o proxy já em execução

Atualizar o filtroAPP remove sua antiga pasta do proxy. Antes de atualizar esse
checkout na VPS, prepare o repositório independente e confira a montagem atual:

```bash
docker inspect infra-proxy-caddy --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}'
docker inspect infra-proxy-caddy --format '{{index .Config.Labels "com.docker.compose.project"}}'
```

Se o arquivo montado está no antigo checkout do filtroAPP, copie suas rotas
operacionais para o `Caddyfile` externo e versione-as lá antes de remover a pasta
antiga. Preserve os domínios dos demais apps da VPS. Valide e recrie o serviço a
partir do novo checkout, ainda antes de atualizar o filtroAPP:

```bash
docker compose -f ../infra-proxy/docker-compose.yml config -q
docker exec -i infra-proxy-caddy caddy validate --config - --adapter caddyfile < ../infra-proxy/Caddyfile
# Somente após a validação, em uma janela de manutenção:
docker compose -f ../infra-proxy/docker-compose.yml up -d --force-recreate caddy
```

O Compose externo preserva o projeto `infra-proxy`, o nome do container, a rede
e os nomes dos volumes. Confirme que o projeto inspecionado se chama
`infra-proxy` antes de recriar o serviço com esse Compose. Recriar o Caddy
interrompe brevemente o HTTPS de todos os apps; não remova seus volumes.

Após recriar o proxy, recarregue o Nginx de staging para atualizar o IP confiável:

```bash
docker exec filtrovali-staging-nginx nginx -s reload
curl --fail https://app.filtrovali.com.br/health
# Execute a partir de um IP autorizado na allowlist de staging.
curl --fail https://filtrostaging.filtrovali.com.br/health
```

Confirme novamente a montagem e os demais domínios antes de atualizar o filtroAPP.

## Backup, restore e testes

O backup do filtroAPP continua incluindo o volume compartilhado
`infra_proxy_data` por padrão, mesmo sem o checkout externo. O restore desse
volume é opcional (`RESTORE_PROXY=false` por padrão). Quando habilitado, usa
`../infra-proxy/docker-compose.yml` relativo a `PROJECT_DIR`; configure
`PROXY_COMPOSE_FILE` para outro caminho. Veja [BACKUP.md](BACKUP.md).

O teste `python3 deploy/test-staging-https.py` usa uma configuração exclusiva de
teste e roda sem o repositório externo, inclusive no CI. O teste
`test-filtroapp-https.py` do `infra-proxy` usa o Caddyfile real e recebe o caminho
do filtroAPP por `FILTROAPP_DIR`; veja [STAGING.md](STAGING.md).
