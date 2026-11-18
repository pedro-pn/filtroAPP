# Produção

Este repositório agora tem o esqueleto inicial de produção:

- `docker-compose.prod.yml`
- `backend/Dockerfile`
- `deploy/nginx/Dockerfile`
- `backend/.env.production`
- `deploy/nginx/default.conf`

## O que já está pronto

- PostgreSQL isolado na rede interna Docker
- Backend sem porta exposta diretamente ao host
- Worker de jobs recorrentes separado do processo HTTP
- Nginx HTTP interno, conectado ao proxy externo pela rede `proxy-net`
- Volumes nomeados para banco, relatórios, assets e certificados
- Frontend React compilado no build da imagem do nginx
- SPA React servida pelo nginx, com proxy para `/api`, `/assets`, `/uploads` e `/relatorios`

Na homologação atual, os assets padrão da aplicação são servidos da própria
imagem do backend. Por isso o `docker-compose.prod.yml` não monta um volume
separado em `/data/assets`.

## Proxy compartilhado e TLS

O Caddy do repositório independente `infra-proxy` atende as portas públicas
`80/443`, emite e renova certificados e encaminha o tráfego para o Nginx interno.
O checkout sugerido é `../infra-proxy`, ao lado da raiz do filtroAPP. Prepare o
proxy e a rede `proxy-net` antes de subir a aplicação, conforme
[INFRA-PROXY.md](INFRA-PROXY.md) e o `RUNBOOK.md` externo. Para uma VPS existente,
migre a montagem do Caddyfile antes de atualizar o checkout do filtroAPP.

Alterações de rotas e domínios são publicadas pelo repositório do proxy. Não há
Certbot ativo nessa topologia. O backup ainda pode salvar o volume compartilhado
`infra_proxy_data`; o restore opcional usa o Compose externo, conforme
[BACKUP.md](BACKUP.md).

## Frontend React

O cutover para React em produção é feito pelo nginx:

- `deploy/nginx/Dockerfile` compila `frontend/` com `npm run build`
- o resultado de `frontend/dist` é copiado para `/usr/share/nginx/html`
- `deploy/nginx/default.conf` usa `try_files` para rotas da SPA
- chamadas `/api`, arquivos `/assets`, `/uploads` e `/relatorios` continuam no backend

## Modo manutenção

A página de manutenção liga e desliga **em tempo de execução**, sem rebuild do
nginx: o nginx confere a cada requisição se existe o arquivo
`/root/backups/filtrovali/maintenance/on` (pasta do host montada só leitura em
`/maintenance`; mude com `MAINTENANCE_DIR`). Com ele:

- rotas do app respondem **503** com a página estática `deploy/nginx/maintenance/index.html`
  (recarrega sozinha a cada 30 s; sem script, compatível com a CSP);
- `/api/*` responde **503** em JSON `{"error": "...", "code": "MAINTENANCE"}`; o app
  aberto mostra essa mensagem nos avisos de erro (não derruba a sessão);
- continuam respondendo: `/nginx-health`, `/assets/*` e qualquer requisição de
  `127.0.0.1` dentro do container (healthcheck do Docker e conferências do
  `deploy-prod.sh`). O teste usa o endereço da conexão (`$realip_remote_addr`), então
  um cliente não escapa da manutenção mandando `X-Forwarded-For`;
- as respostas mantêm os cabeçalhos de segurança, `Cache-Control: no-store` e
  `Retry-After: 120`.

**Rode no servidor:**

```bash
cd ~/apps/filtroAPP
deploy/maintenance.sh on "migração de dados"   # liga
deploy/maintenance.sh status
deploy/maintenance.sh off                      # desliga
```

O `deploy-prod.sh` liga a manutenção sozinho quando há migration pendente (pastas de
`backend/prisma/migrations` que não estão em `_prisma_migrations`) ou quando não
consegue conferir; desliga depois da conferência pós-deploy e também em qualquer
falha ou volta. `--maintenance` força ligar, `--no-maintenance` não liga. Se a
manutenção já estava ligada à mão, o deploy não a desliga.

Durante os poucos segundos em que o próprio container do nginx é recriado, o Caddy
pode responder 502. Opcional (no repositório `infra-proxy`, não aqui): uma página
de erro no Caddy para esse intervalo, por exemplo:

```caddy
app.filtrovali.com.br {
	reverse_proxy filtrovali-nginx:80
	handle_errors 502 503 504 {
		respond "Sistema em atualização. Tente novamente em instantes." 503
	}
}
```

O método antigo (rebuild do nginx com `VITE_MAINTENANCE_MODE=true`) continua
funcionando, mas troca a imagem no ar; prefira o flag acima.

## Conversão DOCX -> PDF em produção

O backend agora suporta dois caminhos:

- Windows: Microsoft Word via COM/PowerShell
- Linux: LibreOffice headless (`soffice`)

No container de produção, o `Dockerfile` já instala `LibreOffice Writer`
e o exemplo de ambiente define:

```env
LIBREOFFICE_BINARY=/usr/bin/soffice
```

Isso remove o bloqueio principal que existia para o `P3`.

## Caminho recomendado

1. Validar a stack Docker em um ambiente de homologação
2. Confirmar que os PDFs gerados no Linux mantêm a formatação esperada
3. Só então subir a stack final no Windows Server com WSL2

## Subida em produção

O Compose define o limite de PDFs de assinatura em 200 MB, inclusive quando o
env-file ainda contém o limite antigo de 20 MB. Mudanças de ambiente exigem recriar
os serviços com `docker compose up -d`; `docker compose restart` conserva as
variáveis antigas. Para conferir somente esse limite no backend em execução:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml exec -T backend \
  node --input-type=module -e "import env from './src/config/env.js'; console.log(env.assinaturasMaxPdfMb)"
```

1. Preencher `backend/.env.production` com segredos e URLs reais
   - Definir `TRUST_PROXY=uniquelocal` para a stack Docker com Nginx, ou CIDRs explícitos da rede/proxy confiável.
   - Definir `SURVEY_TOKEN_SECRET` com um segredo longo e estável para tokens de pesquisa.
   - Definir `SIGNATURE_TOKEN_SECRET` com um segredo longo e estável para os links de assinatura de RDO.
   - Em upgrades de versões antigas, definir `SIGNATURE_TOKEN_SECRET_PREVIOUS` com a chave anterior. Se não havia `SURVEY_TOKEN_SECRET`, a chave anterior era o `DATABASE_URL`.
   - Em homologação/teste com banco de produção, definir `SEND_CLIENT_EMAILS=false` para bloquear todos os envios operacionais do sistema.
   - Para observabilidade operacional, configurar `OPERATIONS_BACKUP_STATUS_FILE`,
     `OPERATIONS_RESTORE_STATUS_FILE`, `OPERATIONS_REQUIRE_BACKUP_STATUS=true`,
     `OPERATIONS_ALERT_JOB_ENABLED=true` e `OPERATIONS_ALERT_EMAILS` (e-mail da
     equipe que recebe os alertas; veja "Alertas por e-mail" abaixo). Os webhooks
     `OPERATIONS_ALERT_WEBHOOK_URL` e `ERROR_TRACKING_WEBHOOK_URL` são opcionais e
     podem funcionar junto com o e-mail. Use `OPERATIONS_REQUIRE_RESTORE_STATUS=false` no
     deploy inicial e altere para `true` depois que o restore periódico estiver
     agendado e publicando `restore-latest.json`.
   - Para rastreamento de erro do frontend em Docker, configurar
     `VITE_ERROR_TRACKING_ENABLED` e, se necessário, `VITE_ERROR_TRACKING_ENDPOINT`
     antes do build da imagem `nginx`.
2. Garantir que o Compose receba `POSTGRES_PASSWORD`. Use `--env-file backend/.env.production` nos comandos abaixo ou mantenha um `.env` na raiz do projeto no servidor com essa variável.
3. Garantir que o diretório de status operacional exista no host:

```bash
mkdir -p /root/backups/filtrovali/status
```

O `docker-compose.prod.yml` monta esse diretório em `/ops-status:ro` no backend
por padrão. Para usar outro caminho no host, defina `OPERATIONS_STATUS_DIR` no
env-file usado pelo Compose.

4. Buildar as imagens sem iniciar o backend. O serviço `migrate` aplica as
   migrations antes de o backend subir, então nada além do Postgres deve subir antes
   do preflight dos índices:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml build migrate backend nginx worker
```

5. Subir somente o Postgres:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml up -d postgres
```

6. Antes de iniciar o backend, criar os índices de produção de forma
   concorrente para evitar bloqueio de escrita em tabelas ativas:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres -d filtrovali -v ON_ERROR_STOP=1 \
  < deploy/create-performance-indexes-concurrently.sql
```

`CREATE INDEX CONCURRENTLY` não pode rodar dentro de transação. Não execute esse
arquivo via Prisma. Depois que os índices existirem, as migrations com
`CREATE INDEX IF NOT EXISTS` passam a ser no-op para esses índices e não seguram
writes de produção durante o deploy.

O compose inicia os jobs recorrentes no serviço `worker` e define
`BACKGROUND_JOBS_IN_API=false` no backend, evitando que pós-processamentos,
sincronizações e lembretes disputem o event loop HTTP. Os pools são limitados a
8 conexões no backend e 2 no worker por padrão; ajuste
`BACKEND_DATABASE_CONNECTION_LIMIT` e `WORKER_DATABASE_CONNECTION_LIMIT` apenas
depois de observar `dbPool.waiting` nos logs de operações lentas.

### Entrega dos e-mails de assinatura e liberação de relatórios

A migration `20261030180000_report_email_outbox` grava as intenções de envio
em `ReportEmailJob`, na mesma transação das assinaturas e liberações (inclusive
assinaturas físicas). Publique a API e o worker da mesma versão após aplicar a
migration. O worker consulta a fila a cada 10 segundos; falhas de PDF, SMTP ou
configuração permanecem pendentes, com espera crescente até uma hora, sem
limite de tentativas. Tarefas interrompidas são retomadas após a expiração da
trava de 15 minutos. Não é necessário pedir outra assinatura para tentar de novo.

Os envios SMTP e as gerações de PDF são serializados em cada processo.
Cada relatório de serviço/revisão possui uma entrega própria; cada RDO assinado
é enviado individualmente ao signatário. O worker registra os destinatários
concluídos para não repeti-los quando outro destinatário falhar. Antes de enviar,
ele reconfirma as permissões, a revisão e eventual revogação da liberação.
`SEND_CLIENT_EMAILS=false` preserva as tarefas pendentes sem enviar mensagens.

Para consultar a fila sem enviar nada:

```sql
SELECT id, kind, status, attempts, "nextAttemptAt", "lockedUntil", "lastError"
FROM "ReportEmailJob"
WHERE status <> 'COMPLETED'
ORDER BY "createdAt";
```

A migration não reenvia eventos anteriores à sua instalação. Falhas históricas
precisam de recuperação explícita, após conferir os logs e o rastreamento SMTP.
O registro de entrega confirma a aceitação pelo servidor SMTP. Uma interrupção
entre essa aceitação e a gravação do comprovante pode causar duplicação na
retomada; não existe transação compartilhada entre SMTP e PostgreSQL.

O PostgreSQL inicia com `pg_stat_statements`, `track_io_timing` e log de
statements acima de 1 s habilitados. A migration cria a extensão; depois do
deploy, confirme com `SELECT * FROM pg_extension WHERE extname = 'pg_stat_statements'`
e use a view apenas para diagnóstico, resetando seus
contadores somente em uma janela de medição planejada.

7. Subir backend, worker e Nginx. O Compose roda antes o serviço `migrate`
   (`npx prisma migrate deploy` com `MIGRATION_DATABASE_URL`, o dono das tabelas)
   e só inicia backend e worker se ele terminar com sucesso:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml up -d backend nginx worker
```

Se o `migrate` falhar, veja o motivo com
`docker compose --env-file backend/.env.production -f docker-compose.prod.yml logs migrate`.
Backend e worker continuam na versão anterior até a migration passar.

Para deploys futuros que não adicionem índices grandes, o fluxo normal pode voltar a
ser:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml up -d --build
```

## Deploy versionado e volta de versão

`deploy/deploy-prod.sh` é o caminho padrão de publicação. Ele publica o commit em
`HEAD`, marca as imagens com o SHA (`filtrovali-{backend,worker,nginx}:<sha>`),
confere a versão no ar e, se algo falhar, volta sozinho para as imagens que
estavam rodando. **Rode no servidor:**

```bash
cd ~/apps/filtroAPP
git pull --ff-only
deploy/deploy-prod.sh
```

O que o script faz, em ordem:

1. recusa checkout com arquivo rastreado alterado (o que vai ao ar precisa estar no Git);
2. lê o commit em execução (`APP_GIT_SHA` gravado na imagem) e marca as imagens
   em execução como `:previous`;
3. builda backend, worker e nginx com `APP_GIT_SHA=<sha de HEAD>`; se o build
   falhar, nada muda;
4. faz um dump só do banco em `/root/backups/filtrovali/pre-deploy` (mantém 3);
5. liga a página de manutenção se houver migration pendente (veja "Modo
   manutenção") e roda `docker compose up -d --wait` (migrations antes do backend);
6. confere `/health` do backend, `app-version.json` do frontend (deve ser o SHA)
   e o healthcheck do worker;
7. se 5 ou 6 falharem, sobe as imagens `:previous` sem build e sem migrations e
   confere de novo. O resultado vai para
   `/root/backups/filtrovali/status/deploy-latest.json` e
   `/root/backups/filtrovali/deploy/deploy-history.log`.

Depois de um deploy ou de uma volta, `:latest` aponta para o que está no ar; por
isso `docker compose ... up -d backend` sem `APP_GIT_SHA` continua subindo a versão
certa. O script mantém as 5 imagens de commit mais recentes (`KEEP_IMAGES`).

Volta manual:

```bash
deploy/deploy-prod.sh --rollback                       # versão anterior ao último deploy
deploy/deploy-prod.sh --rollback-to <sha>              # imagem local de um commit
deploy/deploy-prod.sh --rollback-to before-rollback    # desfaz a volta
```

**Migrations só andam para frente.** A volta troca o código, não o schema. Quando
a migration nova só acrescenta tabelas/colunas (padrão do projeto), o código
anterior funciona com o banco novo. Se ela apagou ou reescreveu dados, a volta de
dados é o restore do dump do passo 4: `docs/RUNBOOK_INCIDENTES.md`, seção 3.

Opções: `--maintenance` / `--no-maintenance` (força ligar / não ligar a página de
manutenção), `--skip-backup` (sem o dump do passo 4), `--force` (republica o mesmo
commit), `--allow-dirty` (só em emergência; o commit gravado na imagem não
descreve as alterações locais). Variáveis: `HEALTH_TIMEOUT_SECONDS` (240),
`KEEP_IMAGES` (5), `PRE_DEPLOY_BACKUP_KEEP` (3).

**Aviso do resultado.** Ninguém precisa abrir o JSON para saber que um deploy deu
errado:

- o painel de Operações mostra o card "Último deploy" (commit, versão anterior,
  horário e motivo) e trata `ROLLED_BACK` e `FAILURE` como problema até um deploy
  seguinte terminar com `SUCCESS`; com `OPERATIONS_ALERT_JOB_ENABLED=true`, o job
  de status operacional manda e-mail para `OPERATIONS_ALERT_EMAILS` na próxima
  verificação (`OPERATIONS_ALERT_INTERVAL_MS`, padrão 1 h). O backend lê
  `OPERATIONS_DEPLOY_STATUS_FILE` (padrão `/ops-status/deploy-latest.json`, a mesma
  pasta montada do backup); arquivo ausente não é problema, a não ser com
  `OPERATIONS_REQUIRE_DEPLOY_STATUS=true`;
- o próprio script avisa no Telegram, na hora, quando o deploy falha ou volta
  sozinho. Ele lê só `TELEGRAM_TOKEN` e `TELEGRAM_CHAT_ID` de
  `DEPLOY_NOTIFY_ENV_FILE` (padrão `/root/.config/filtroapp-backup/env`, o mesmo do
  backup); `DEPLOY_NOTIFY_SUCCESS=true` também avisa os deploys que deram certo.
  Falha no envio nunca muda o resultado do deploy.

A volta automática, sozinha, não gera e-mail imediato: o e-mail sai pelo job de
status (até 1 h depois) e o aviso imediato é o Telegram.

O caminho manual da seção "Subida em produção" continua válido como plano B; sem
`APP_GIT_SHA`, as imagens saem marcadas como `:latest` e o `/health` mostra
`unknown`.

### Ensaio de restauração

`deploy/restore-drill.sh` prova que o backup fora do servidor volta: baixa o
último backup diário do B2, confere os checksums, restaura num PostgreSQL
descartável (container próprio, sem rede, apagado no fim), confere migrations,
usuários, projetos, relatórios e a data do último relatório, e grava o resultado
em `restore-latest.json`, o mesmo arquivo que o painel de Operações lê. Nunca
toca o banco de produção. **Rode no servidor** a primeira vez à mão:

```bash
cd ~/apps/filtroAPP
deploy/restore-drill.sh
cat /root/backups/filtrovali/status/restore-latest.json
```

Precisa de espaço livre em disco para o dump descompactado mais o banco
restaurado. Depois do primeiro ensaio com sucesso, agende-o (mensal) e ligue a
cobrança no painel/alerta:

```bash
( crontab -l; echo '30 4 2 * * /root/apps/filtroAPP/deploy/restore-drill.sh >> /root/logs/restore-drill.log 2>&1' ) | crontab -
```

```env
OPERATIONS_BACKUP_STATUS_FILE=/ops-status/backup-latest.json
OPERATIONS_RESTORE_STATUS_FILE=/ops-status/restore-latest.json
OPERATIONS_REQUIRE_BACKUP_STATUS=true
OPERATIONS_REQUIRE_RESTORE_STATUS=true
OPERATIONS_RESTORE_MAX_AGE_DAYS=35
```

(recrie backend e worker depois de editar o env-file).

## Papel restrito do banco

API e worker conectam com o papel `filtrovali_app` (`DATABASE_URL`), que só lê e
grava linhas: não é superusuário, não cria nem altera tabelas, não trunca e não
mexe em `_prisma_migrations`. As migrations rodam no serviço `migrate` com o dono
das tabelas (`MIGRATION_DATABASE_URL`, hoje `postgres`). O Compose zera
`MIGRATION_DATABASE_URL`, `POSTGRES_PASSWORD` e `STAGING_POSTGRES_PASSWORD` em
backend e worker (o env-file é o mesmo do container do Postgres), então a
credencial do dono só existe no container `migrate`, que termina logo após
aplicar as migrations. `check-database-role.js --require-restricted` reprova se
alguma dessas variáveis estiver preenchida no ambiente da aplicação.

Os GRANTs ficam em `deploy/db/app-role.sql` (idempotente). Ele também define
`ALTER DEFAULT PRIVILEGES`, então tabelas, sequences e funções criadas por
migrations futuras já nascem acessíveis ao papel. O job de CI
`Database least-privilege role` aplica as migrations como dono e roda suítes de
integração (triggers, outbox, advisory locks) como o papel restrito.

Sem `MIGRATION_DATABASE_URL`, o `migrate` usa `DATABASE_URL`. Por isso este
código pode ir ao ar antes da troca de credencial: tudo segue como hoje.

### Ativação (rode no servidor, uma vez)

```bash
cd ~/apps/filtroAPP
# 1. Senha do papel: só [A-Za-z0-9._~-], porque vai na URL de conexão.
install -d -m 700 /root/secrets
openssl rand -hex 32 > /root/secrets/filtrovali_app_db_password
chmod 600 /root/secrets/filtrovali_app_db_password

# 2. Cria o papel e aplica os GRANTs. A saída deve mostrar superuser=f,
#    can_create_in_public=f e tables_missing_grants=0.
deploy/db/apply-app-role.sh --password-file /root/secrets/filtrovali_app_db_password

# 3. Backup do env-file antes de editar.
cp -p backend/.env.production backend/.env.production.bak-$(date +%Y%m%d%H%M)
```

4. Edite `backend/.env.production`:
   - copie a linha atual de `DATABASE_URL` para uma linha nova
     `MIGRATION_DATABASE_URL=...` (mesmo valor, com `postgres`);
   - em `DATABASE_URL`, troque o usuário `postgres` por `filtrovali_app` e a senha
     pelo conteúdo de `/root/secrets/filtrovali_app_db_password`;
   - acrescente `OPERATIONS_REQUIRE_RESTRICTED_DB_ROLE=true`, para o painel de
     operações (e o alerta) acusar se a API voltar a usar o dono.

```bash
# 5. Confere o papel com o env-file novo, sem subir nada.
docker compose --env-file backend/.env.production -f docker-compose.prod.yml run --rm --no-deps \
  backend node scripts/check-database-role.js --require-restricted

# 6. Recria os serviços (env-file novo exige recriar; restart não basta).
#    --force republica o commit atual pelo deploy versionado, com volta automática.
deploy/deploy-prod.sh --force
docker compose --env-file backend/.env.production -f docker-compose.prod.yml logs --tail=80 backend worker \
  | grep -i "privilégios de dono" || echo "ok: sem aviso de papel privilegiado"
```

Depois de restaurar um backup, rode de novo `deploy/db/apply-app-role.sh` (sem
`--password-file` ele só reaplica os GRANTs). `deploy/restore-prod.sh` já faz
isso e, num servidor novo, cria o papel sem senha; nesse caso defina a senha com
`--password-file` antes de subir a API.

Scripts de manutenção rodados com `docker compose ... exec backend node scripts/...`
passam a usar o papel restrito, o que basta para backfills e importações (só
DML). O que precisar de DDL vai numa migration.

### Voltar atrás (rode no servidor)

```bash
cd ~/apps/filtroAPP
# Volta o env-file anterior (DATABASE_URL com postgres) e recria os serviços.
cp -p backend/.env.production.bak-AAAAMMDDHHMM backend/.env.production
docker compose --env-file backend/.env.production -f docker-compose.prod.yml up -d backend worker
```

O papel `filtrovali_app` pode ficar no banco: sem uso, não dá acesso a nada. Para
removê-lo:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres -d filtrovali -v ON_ERROR_STOP=1 \
  -c 'DROP OWNED BY filtrovali_app' -c 'DROP ROLE filtrovali_app'
```

## Falhas de rede no build (`npm ci`)

O build do frontend usa Node 24, exigido por `@zxing/library@0.23.0`.
Os Dockerfiles usam BuildKit com cache persistente do npm e executam
`deploy/npm-ci.sh`. O script aumenta as tentativas de download, evita as
requisições de auditoria durante o build e repete a instalação até três
vezes somente em falhas de rede, com pausas de 10 e 20 segundos.
Erros de lockfile, dependências, autenticação ou integridade interrompem
a instalação imediatamente. Falhas persistentes de rede também encerram
o build com erro.

Se ocorrer `ECONNRESET`, atualize o código no servidor e refaça o build.
Para reduzir downloads simultâneos, execute os serviços em sequência:

```bash
COMPOSE_PARALLEL_LIMIT=1 docker compose --env-file backend/.env.production -f docker-compose.prod.yml build backend nginx worker
```

Após o build concluir, siga o fluxo de subida em produção acima. Se a
falha persistir, verifique o acesso ao registry dentro de um container:

```bash
docker run --rm node:24-alpine npm ping --registry=https://registry.npmjs.org
```

Esse teste verifica a conexão inicial com o registry; não comprova que
os downloads completos estejam estáveis. Investigue a rede de saída,
o DNS ou o proxy do servidor se os downloads continuarem interrompidos.

## Gate de anexos e miniaturas

Sempre que o deploy alterar uploads, anexos, `/relatorios`, miniaturas,
autorização de arquivos ou organização de fotos, trate `ReportAttachment`
como fonte crítica de autorização. Antes de publicar em produção, rode em
homologação com uma cópia do banco e do volume `relatorios`:

```bash
docker compose -f docker-compose.prod.yml exec backend npm run backfill:report-attachments -- --dry-run
docker compose -f docker-compose.prod.yml exec backend npm run audit:report-files
docker compose -f docker-compose.prod.yml exec backend npm run repair:report-file-paths -- --limit=500
```

O deploy só deve seguir se:

- anexos referenciados no JSON tiverem índice `ReportAttachment` compatível;
- `audit:report-files` não mostrar arquivos ausentes que afetem relatórios ativos;
- divergências reparáveis tiverem sido aplicadas ou justificadas;
- casos ambíguos tiverem sido revisados manualmente quando afetarem miniaturas;
- não houver dependência de grants transitórios para anexos já persistidos.

Se houver divergência, corrija primeiro em dry-run e só depois aplique:

```bash
docker compose -f docker-compose.prod.yml exec backend npm run repair:report-file-paths -- --apply --limit=500
```

Após aplicar, rode novamente `audit:report-files`. Mudanças que endurecem
autorização de arquivos não devem remover fallback legado sem esse gate.
Para bloquear o deploy automaticamente quando ainda houver arquivo ausente,
use:

```bash
docker compose -f docker-compose.prod.yml exec backend npm run audit:report-files -- --fail-on-missing
```

## Saúde do backend e chamadas externas

`GET /health` (healthcheck do Docker do `backend` e rota pública via nginx)
executa `SELECT 1` no banco com prazo de `HEALTH_DB_TIMEOUT_MS` (padrão 2000 ms)
e responde:

- `200 {"ok":true,"database":"ok","version":"<sha>"}` com o banco respondendo;
- `503 {"ok":false,"database":"unavailable"|"timeout","version":"<sha>"}` quando
  o banco não responde. Depois de 10 falhas seguidas (intervalo de 15 s) o
  container fica `unhealthy` em `docker compose ps`.

`version` vem de `APP_GIT_SHA` gravado na imagem (ou `unknown`). O resultado é
reaproveitado por 2 s, para que chamadas repetidas à rota pública não virem
carga no banco.

Chamadas a serviços externos têm prazo máximo: Omie (`OMIE_TIMEOUT_MS`, padrão
30000, com até 2 novas tentativas em falha de rede, tempo esgotado ou
502/503/504), ZapSign (`ZAPSIGN_TIMEOUT_MS`, padrão 30000, novas tentativas só
em GET/downloads) e imagens remotas do PDF de relatório
(`REMOTE_IMAGE_TIMEOUT_MS`, padrão 15000; sem resposta, o PDF sai sem a
imagem). Conecta RH, ComercialAPP, PontoMais, OpenAI e o token OAuth2 do SMTP
já tinham prazo próprio.

## Observabilidade operacional

O backend expõe `GET /api/operations/status` para administradores. O endpoint
mostra:

- últimos jobs recorrentes e locks ativos;
- fila de pós-processamento de aprovação;
- retenção de dados;
- último backup e último restore/teste, quando os arquivos de status estiverem
  montados no container;
- estado do rastreamento de erros e do job de alertas.

Configuração recomendada em produção:

```env
OPERATIONS_BACKUP_STATUS_FILE=/ops-status/backup-latest.json
OPERATIONS_RESTORE_STATUS_FILE=/ops-status/restore-latest.json
OPERATIONS_REQUIRE_BACKUP_STATUS=true
OPERATIONS_REQUIRE_RESTORE_STATUS=false
OPERATIONS_BACKUP_MAX_AGE_HOURS=26
OPERATIONS_RESTORE_MAX_AGE_DAYS=30
OPERATIONS_ALERT_JOB_ENABLED=true
OPERATIONS_ALERT_INTERVAL_MS=3600000
OPERATIONS_ALERT_EMAILS=ti@empresa.example,responsavel@empresa.example
OPERATIONS_ALERT_EMAIL_THROTTLE_MINUTES=30
OPERATIONS_ALERT_REPEAT_HOURS=6
# Opcionais (podem ficar vazios quando só o e-mail for usado):
OPERATIONS_ALERT_WEBHOOK_URL=
ERROR_TRACKING_PROVIDER=webhook
ERROR_TRACKING_WEBHOOK_URL=
VITE_ERROR_TRACKING_ENABLED=true
VITE_ERROR_TRACKING_ENDPOINT=
```

### Alertas por e-mail

Com `OPERATIONS_ALERT_EMAILS` preenchido, o backend e o worker enviam e-mail
pelo mesmo SMTP/OAuth2 dos demais e-mails do sistema para:

- erros HTTP 5xx, `unhandledRejection` e exceções não tratadas da API e do worker;
- falhas de jobs recorrentes (com o banco fora do ar, as falhas de todos os jobs
  viram um único alerta);
- o job `operational-alert-check` (backup com falha ou velho, restore, jobs
  parados, Omie, banco comercial), quando `OPERATIONS_ALERT_JOB_ENABLED=true`.

Controle de repetição:

- erros: no máximo um e-mail por tipo de erro e rota/job a cada
  `OPERATIONS_ALERT_EMAIL_THROTTLE_MINUTES` (padrão 30). O próximo e-mail informa
  quantas ocorrências iguais foram suprimidas. O controle é em memória, por
  processo: um reinício zera a janela, e API e worker contam separadamente;
- status operacional: um e-mail quando o problema aparece ou muda, outro a cada
  `OPERATIONS_ALERT_REPEAT_HOURS` (padrão 6) enquanto persistir, e um aviso de
  normalização quando some. Esse estado fica no resultado do próprio job no banco.

Os e-mails levam só a primeira linha da mensagem de erro, as linhas `at ...` da
pilha, rota, método, status, request id (o mesmo devolvido no cabeçalho `X-Request-Id` da resposta
5xx e gravado no log como `[http-5xx] requestId=...`), id numérico do usuário,
ambiente e versão (`APP_GIT_SHA`). E-mails e CPFs são mascarados. Erros enviados
pelo navegador para a rota pública `/api/operations/client-errors` nunca geram
e-mail, só vão para o webhook, se houver.

`SEND_CLIENT_EMAILS=false` bloqueia todo e-mail de saída, inclusive os alertas.

Para provar que o alerta chega (pilar 12.1), rode no servidor depois do deploy:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml exec backend npm run ops:test-alert
```

O comando informa o resultado por canal e sai com código 1 se nenhum entregou.

Depois que o restore periódico estiver agendado e validado, altere
`OPERATIONS_REQUIRE_RESTORE_STATUS=true` (o ensaio é `deploy/restore-drill.sh`,
seção "Ensaio de restauração"; com agenda mensal use
`OPERATIONS_RESTORE_MAX_AGE_DAYS=35`).

O frontend também pode enviar erros não tratados para o backend:

```env
VITE_ERROR_TRACKING_ENABLED=true
```

Se o endpoint padrão `/api/operations/client-errors` não for usado, defina
`VITE_ERROR_TRACKING_ENDPOINT`.

Os scripts `deploy/backup-prod.sh`, `deploy/restore-prod.sh` e
`deploy/restore-drill.sh` escrevem os arquivos de status. O compose de produção já monta
`${OPERATIONS_STATUS_DIR:-/root/backups/filtrovali/status}` no backend em
`/ops-status:ro`; a tarefa manual é criar esse diretório no host e preencher as
variáveis no env-file de produção.

## Certificado

O `nginx` já está preparado para servir o domínio principal
`app.filtrovali.com.br` e redirecionar o domínio legado
`relatorios.filtrovali.com.br` para ele. Emita/renove o certificado com os
dois nomes antes do `443` ficar operacional.

## Backup

Não existe rotina automática de backup embutida no compose de produção.
Os dados ficam persistidos localmente nos volumes Docker:

- `filtrovali_pgdata`
- `filtrovali_relatorios`

Para backup operacional do servidor, use:

- `deploy/backup-prod.sh`
- `deploy/BACKUP.md`

O fluxo recomendado é:

1. `pg_dump` do PostgreSQL
2. compactação do volume `filtrovali_relatorios`
3. cópia para S3 ou outro destino externo
4. snapshot periódico do disco EBS
