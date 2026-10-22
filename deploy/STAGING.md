# Homologação

Ambiente de validação entre desenvolvimento e produção. Roda a mesma stack de prod
(Postgres + backend + Nginx) com snapshot de produção sanitizado diariamente,
e-mails para clientes bloqueados e acesso restrito por IP.

## Arquivos do ambiente

| Arquivo | Função |
|---|---|
| `docker-compose.staging.yml` | Stack isolada de homologação |
| `backend/.env.staging` | Único arquivo de configuração — backend e senha do Postgres (gitignored) |
| `deploy/nginx/staging.conf` | Nginx com restrição de acesso por IP |
| `deploy/nginx/15-staging-allowlist.sh` | Gera a lista de IPs autorizados a partir do ambiente |
| `deploy/infra-proxy/Caddyfile` | Rota HTTPS no proxy compartilhado da VPS |
| `deploy/sync-staging.sh` | Sincronização diária do banco com prod |

## URL

```
https://filtrostaging.filtrovali.com.br
```

Crie o registro DNS `A` de `filtrostaging.filtrovali.com.br` apontando para o IP
público da VPS. Se publicar `AAAA`, o IPv6 também precisa alcançar essa VPS.
Faça isso antes de recarregar o Caddy para permitir a emissão do certificado.

O `infra-proxy-caddy` compartilha a rede externa `proxy-net` com o Nginx de staging
e termina TLS nas portas públicas `80/443`. O Caddy emite e renova o certificado e
redireciona HTTP para HTTPS. O Nginx, o backend e o Postgres de staging não publicam
portas no host; banco e backend continuam somente na rede `filtrovali-staging-net`.

## Restrição de acesso

Preencha `STAGING_ALLOWED_IPS` em `backend/.env.staging` com os IPs públicos de saída
do escritório/VPN ou CIDRs autorizados, separados por vírgula ou espaço:

```env
# Exemplos de documentação: substitua pelos endereços reais.
STAGING_ALLOWED_IPS=203.0.113.10,198.51.100.0/24
```

Se usar espaços no valor, envolva-o em aspas, pois `sync-staging.sh` também carrega
esse arquivo como shell: `STAGING_ALLOWED_IPS="203.0.113.10 198.51.100.0/24"`.

O entrypoint do Nginx gera `/etc/nginx/staging-allowed-ips.conf`. Sem a variável,
somente loopback é permitido e todo acesso externo recebe `403`. Endereços inválidos
impedem a inicialização do Nginx. A lista também aceita IPv6.

O Nginx confia no `X-Forwarded-For` somente quando a conexão vem do container
`infra-proxy-caddy`, para aplicar a restrição ao visitante. O proxy deve receber as
conexões diretamente; colocar uma CDN/proxy adicional à frente exige configurar
explicitamente a cadeia de proxies confiáveis antes de usar essa lista.

Depois de alterar a lista, recrie somente o Nginx:

```bash
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml up -d --no-deps --force-recreate nginx
```

A porta `8080` deixa de atender. Remova sua antiga regra no firewall e mantenha
`80/443` acessíveis ao Caddy, inclusive para validação e renovação dos certificados.
O controle de acesso do staging é feito no Nginx por domínio, pois essas portas são
compartilhadas com produção e os outros apps da VPS.

## Configuração inicial (uma vez no servidor)

### 1. Preencher o arquivo de configuração

```bash
nano backend/.env.staging
```

Substitua todos os valores `CHANGE_ME`. A senha do banco —
`STAGING_POSTGRES_PASSWORD` — deve aparecer duas vezes no arquivo: uma como
variável explícita (usada pelo compose ao inicializar o Postgres) e outra dentro do
`DATABASE_URL` (usada pelo backend para conectar). Mantenha os dois valores iguais.
Defina também um login exclusivo de homologação, que será recriado pelo sync após
invalidar as credenciais vindas do dump de produção:

```
STAGING_POSTGRES_PASSWORD=escolha-uma-senha-forte
DATABASE_URL="postgresql://postgres:escolha-uma-senha-forte@postgres:5432/filtrovali?schema=public"
APP_URL=https://filtrostaging.filtrovali.com.br
ALLOWED_ORIGIN=https://filtrostaging.filtrovali.com.br
TRUST_PROXY=uniquelocal
STAGING_ALLOWED_IPS=203.0.113.10
SURVEY_TOKEN_SECRET=segredo-longo-para-homologacao
SIGNATURE_TOKEN_SECRET=outro-segredo-longo-para-homologacao
STAGING_ADMIN_USERNAME=staging-admin
STAGING_ADMIN_PASSWORD=outra-senha-forte
```

Confirme que `SEND_CLIENT_EMAILS=false` está presente. Nunca altere para `true`
em homologação — o banco contém dados reais de clientes.

Para observabilidade operacional, crie o diretório de status no host:

```bash
mkdir -p /root/backups/filtrovali-staging/status
```

O `docker-compose.staging.yml` monta esse diretório em `/ops-status:ro` no backend
por padrão. Para usar outro caminho no host, defina `STAGING_OPERATIONS_STATUS_DIR`
no env-file usado pelo Compose.

Configuração inicial recomendada:

```env
OPERATIONS_BACKUP_STATUS_FILE=/ops-status/backup-latest.json
OPERATIONS_RESTORE_STATUS_FILE=/ops-status/restore-latest.json
OPERATIONS_REQUIRE_BACKUP_STATUS=false
OPERATIONS_REQUIRE_RESTORE_STATUS=false
OPERATIONS_BACKUP_MAX_AGE_HOURS=26
OPERATIONS_RESTORE_MAX_AGE_DAYS=30
OPERATIONS_ALERT_JOB_ENABLED=true
OPERATIONS_ALERT_INTERVAL_MS=3600000
OPERATIONS_ALERT_WEBHOOK_URL=https://seu-monitoramento.example/webhook
ERROR_TRACKING_PROVIDER=webhook
ERROR_TRACKING_WEBHOOK_URL=https://seu-monitoramento.example/errors
VITE_ERROR_TRACKING_ENABLED=true
VITE_ERROR_TRACKING_ENDPOINT=
```

Depois que o restore periódico de staging estiver agendado e escrevendo
`restore-latest.json`, altere `OPERATIONS_REQUIRE_RESTORE_STATUS=true`.

Se o volume `filtrovali_staging_pgdata` for removido, o Postgres inicializa do zero
e exige `STAGING_POSTGRES_PASSWORD` preenchido. O script de sync aborta antes de subir
o container se essa variável estiver vazia.

### 2. Confirmar o proxy compartilhado

O `infra-proxy-caddy` já deve estar rodando e a rede `proxy-net` deve existir:

```bash
docker inspect infra-proxy-caddy --format '{{.State.Status}}'
docker network inspect proxy-net --format '{{.Name}}'
```

Se for uma VPS nova, prepare o proxy conforme
[`infra-proxy/RUNBOOK.md`](infra-proxy/RUNBOOK.md). O Nginx resolve o nome do Caddy
ao iniciar para determinar o proxy confiável.

### 3. Subir o ambiente pela primeira vez

```bash
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml up -d --build
```

### 4. Publicar a rota no Caddy existente

O Caddy é único na VPS. Descubra o arquivo que fornece sua configuração:

```bash
PROXY_CADDYFILE="$(docker inspect infra-proxy-caddy --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')"
printf '%s\n' "$PROXY_CADDYFILE"
```

Atualize esse arquivo com a versão de `deploy/infra-proxy/Caddyfile` desta mudança,
no checkout que o fornece, preservando eventuais rotas locais. Atualizar apenas o
checkout de staging não atualiza um Caddyfile montado de outro diretório. A rota é:

```caddyfile
filtrostaging.filtrovali.com.br {
    reverse_proxy filtrovali-staging-nginx:80
}
```

Valide e recarregue o proxy existente. A leitura por stdin usa o arquivo atualizado
mesmo quando o Git substitui o inode de um arquivo montado individualmente:

```bash
docker exec -i infra-proxy-caddy caddy validate --config - --adapter caddyfile < "$PROXY_CADDYFILE"
# Execute somente se a validação acima passar.
docker exec -i infra-proxy-caddy caddy reload --config - --adapter caddyfile < "$PROXY_CADDYFILE"
docker logs --since 5m infra-proxy-caddy
```

Não suba outro stack de proxy a partir do checkout de staging. A recarga mantém
os demais domínios no proxy existente.

### 5. Popular o banco (somente na configuração inicial)

**Opção A — seed limpo** (sem dados reais):

```bash
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml exec backend npx prisma db seed
```

**Opção B — restaurar o último snapshot de produção** (recomendado):

```bash
./deploy/sync-staging.sh
```

## Migrar o staging existente de HTTP para HTTPS

1. Cadastre o DNS e aguarde sua resolução para a VPS.
2. Antes de atualizar o checkout de staging, copie os IPs/CIDRs de sua lista local
   em `deploy/nginx/staging.conf` para `STAGING_ALLOWED_IPS` no `.env.staging`.
   Preserve também qualquer outra configuração local antes do `git pull`.
3. Atualize o checkout com esta versão e ajuste `APP_URL`, `ALLOWED_ORIGIN` e
   `TRUST_PROXY` conforme o exemplo acima, mantendo os demais segredos do ambiente.
4. Execute a subida com `--build` da etapa 3 e a recarga do proxy da etapa 4.
   O banco existente é mantido; não é necessário executar seed ou sync para migrar HTTPS.
5. Atualize consumidores que chamam `http://IP:8080` para
   `https://filtrostaging.filtrovali.com.br`, incluindo o destino do exportador do
   ComercialAPP (`STAGING_FILTROAPP_API_URL`). O IP público de saída de cada consumidor
   também deve estar em `STAGING_ALLOWED_IPS`.
6. Remova a regra antiga da porta `8080` no firewall.

`COMERCIALAPP_API_URL` aponta para o outro app. Se ele continuar em HTTP, mantenha
`COMERCIALAPP_ALLOW_STAGING_HTTP=true` no filtroAPP até migrar esse produtor também.

### Verificação

De uma máquina cujo IP está autorizado:

```bash
# Certificado válido e cabeçalho X-Environment: staging.
curl -I https://filtrostaging.filtrovali.com.br/
# Redirecionamento para HTTPS.
curl -I http://filtrostaging.filtrovali.com.br/
curl --fail https://filtrostaging.filtrovali.com.br/health
# Nginx de staging sem portas publicadas.
docker port filtrovali-staging-nginx
```

Confirme login e um upload no navegador. De um IP fora da lista, a URL HTTPS deve
retornar `403`, inclusive ao enviar `X-Forwarded-For: 127.0.0.1` manualmente.

O Nginx resolve o IP do Caddy ao iniciar/recarregar. Se o container do proxy for
recriado e mudar de IP, recarregue o Nginx para renovar essa confiança:

```bash
docker exec filtrovali-staging-nginx nginx -s reload
```

### Teste isolado do proxy

```bash
python3 deploy/test-staging-https.py
```

O teste usa containers e rede descartáveis, sem portas no host, sem banco e sem
contatar autoridades de certificação públicas. Valida TLS com uma CA local, rotas,
restrição de IP, headers encaminhados, redirecionamento HTTP e os domínios de
produção/legado. Também roda no job Docker do CI.

## Sincronização diária com produção

O script `deploy/sync-staging.sh` aplica o último snapshot de backup de prod ao banco
de homologação, aplica migrations, substitui o volume de relatórios por artefatos
sintéticos e executa um scrub obrigatório antes de subir backend/Nginx. Esse scrub:

- apaga sessões, tokens de reset/e-mail e tokens de preferência de notificação;
- invalida senhas de usuários restaurados de produção;
- remove tokens públicos de assinatura, pesquisa, certificado e validação;
- expira solicitações pendentes com link público;
- mascara e-mails, nomes, CNPJs/CPFs, assinaturas e dados de contato sensíveis;
- troca referências de PDFs, DOCX, anexos e certificados para arquivos mockados em `_staging_mock`;
- recria o usuário `STAGING_ADMIN_USERNAME` com a senha/hash de staging.

Se `STAGING_ADMIN_PASSWORD` ou `STAGING_ADMIN_PASSWORD_HASH` não estiver configurado,
o sync falha fechado e não publica o banco restaurado no app. Ele detecta se o
ambiente está rodando ou parado e age de acordo:

- **Ambiente parado**: sobe o banco, aplica o snapshot, builda backend/Nginx, roda migrations, cria arquivos mockados, sanitiza o banco, desliga tudo.
- **Ambiente rodando**: para backend e Nginx, aplica o snapshot, builda backend/Nginx, roda migrations, cria arquivos mockados, sanitiza o banco, recria os serviços.

O diretório apontado por `latest` é resolvido uma vez no início da execução. Banco e
backup metadata sempre vêm desse mesmo diretório, mesmo que o backup de produção
atualize o symlink durante o sync. O dump `.gz` é validado antes de qualquer mutação e
restaurado primeiro em um banco temporário com `ON_ERROR_STOP`; o banco de staging só é
trocado após o restore completo retornar sucesso.

O build é feito por padrão para garantir que migrations, backend e bundle React do Nginx
usem o código atual do branch. Para pular o build em um caso excepcional:

```bash
BUILD_SERVICES=false ./deploy/sync-staging.sh
```

O arquivo `relatorios.tar.gz` de produção não é restaurado em homologação. Mesmo que
`RESTORE_REPORTS=true` seja definido por engano, o script ignora a extração e recria
somente PDFs, DOCX e anexos sintéticos para validar os fluxos de download sem publicar
conteúdo real de produção.

### Agendamento no crontab (03h da manhã)

```bash
crontab -e
```

```cron
0 3 * * * /root/apps/filtroAPP-staging/deploy/sync-staging.sh >> /root/logs/sync-staging.log 2>&1
```

Crie o diretório de log se necessário:

```bash
mkdir -p /root/logs
```

O script de backup de prod deve rodar antes das 03h (recomendado às 02h). O sync usa
o symlink `latest` criado pelo backup — se o backup falhar, o sync usa o último backup
disponível e emite um aviso no log se tiver mais de 48 horas.

### Notificações por Telegram (opcional)

Mesmas variáveis do script de backup:

```cron
0 3 * * * TELEGRAM_TOKEN=xxx TELEGRAM_CHAT_ID=yyy /root/apps/filtroAPP-staging/deploy/sync-staging.sh >> /root/logs/sync-staging.log 2>&1
```

## Subida e parada manuais

```bash
# Subir
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml up -d

# Parar (mantém volumes — dados preservados)
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml down

# Rebuild após mudança de código
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml up -d --build
```

## Migrations

As migrations rodam automaticamente na inicialização do backend (mesmo comportamento
de prod). O script de sync também as aplica explicitamente após restaurar o banco,
garantindo que migrations do branch atual sejam aplicadas sobre o dump de prod.

Para aplicar manualmente sem reiniciar o backend:

```bash
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml run --rm --no-deps backend sh -c "npx prisma migrate deploy"
```

## Comandos úteis

Acompanhar logs em tempo real:

```bash
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml logs -f
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml logs -f backend
```

Acessar o banco diretamente:

```bash
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml exec postgres psql -U postgres -d filtrovali
```

Verificar status dos containers:

```bash
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml ps
```

Inspecionar log do último sync:

```bash
tail -50 /root/logs/sync-staging.log
```

## Destruir e recriar do zero

Remove containers, redes e volumes de homologação sem tocar em prod:

```bash
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml down -v
```

Em seguida, repita a etapa de subida inicial.

## O que homologação não substitui

- **Testes automatizados** (`npm test`) — devem passar antes de qualquer merge.
- **`EXPLAIN ANALYZE`** para validar índices — requer o banco real de prod em horário
  de baixo tráfego, pois o planner depende das estatísticas reais de distribuição de dados.
- **Configuração TLS de produção** — staging tem certificado e domínio próprios no
  mesmo Caddy; validar staging não substitui conferir o domínio de produção.

## Notas de segurança

- `backend/.env.staging` está no `.gitignore` (coberto pelo padrão `backend/.env.*`) e nunca deve
  ser commitado.
- O banco de homologação contém uma cópia dos dados de prod. Trate o acesso ao servidor
  com o mesmo cuidado.
- `SEND_CLIENT_EMAILS=false` é a proteção entre testes e e-mails operacionais reais
  enviados pelo sistema. Não altere sem revisão explícita.
