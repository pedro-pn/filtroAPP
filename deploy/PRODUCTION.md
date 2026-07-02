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
- Nginx como único serviço exposto em `80/443`
- Volumes nomeados para banco, relatórios, assets e certificados
- Frontend React compilado no build da imagem do nginx
- SPA React servida pelo nginx, com proxy para `/api`, `/assets`, `/uploads` e `/relatorios`

Na homologação atual, os assets padrão da aplicação são servidos da própria
imagem do backend. Por isso o `docker-compose.prod.yml` não monta um volume
separado em `/data/assets`.

## Frontend React

O cutover para React em produção é feito pelo nginx:

- `deploy/nginx/Dockerfile` compila `frontend/` com `npm run build`
- o resultado de `frontend/dist` é copiado para `/usr/share/nginx/html`
- `deploy/nginx/default.conf` usa `try_files` para rotas da SPA
- chamadas `/api`, arquivos `/assets`, `/uploads` e `/relatorios` continuam no backend

## Modo manutenção

Durante migrações ou janelas programadas, o frontend pode ser compilado para
exibir somente a página temporária de manutenção. A página não depende de
autenticação nem de chamadas ao backend.

Para ativar:

```bash
docker compose -f docker-compose.prod.yml build --build-arg VITE_MAINTENANCE_MODE=true nginx
docker compose -f docker-compose.prod.yml up -d nginx
```

Para voltar ao app normal:

```bash
docker compose -f docker-compose.prod.yml build --build-arg VITE_MAINTENANCE_MODE=false nginx
docker compose -f docker-compose.prod.yml up -d nginx
```

No modo normal, a página de manutenção não fica disponível em nenhuma rota.

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

1. Preencher `backend/.env.production` com segredos e URLs reais
   - Definir `TRUST_PROXY=uniquelocal` para a stack Docker com Nginx, ou CIDRs explícitos da rede/proxy confiável.
   - Definir `SURVEY_TOKEN_SECRET` com um segredo longo e estável para tokens de pesquisa.
   - Definir `SIGNATURE_TOKEN_SECRET` com um segredo longo e estável para os links de assinatura de RDO.
   - Em upgrades de versões antigas, definir `SIGNATURE_TOKEN_SECRET_PREVIOUS` com a chave anterior. Se não havia `SURVEY_TOKEN_SECRET`, a chave anterior era o `DATABASE_URL`.
   - Em homologação/teste com banco de produção, definir `SEND_CLIENT_EMAILS=false` para bloquear todos os envios operacionais do sistema.
   - Para observabilidade operacional, configurar `OPERATIONS_BACKUP_STATUS_FILE`,
     `OPERATIONS_RESTORE_STATUS_FILE`, `OPERATIONS_REQUIRE_BACKUP_STATUS=true`,
     `OPERATIONS_REQUIRE_RESTORE_STATUS=true`, `OPERATIONS_ALERT_WEBHOOK_URL` e
     `ERROR_TRACKING_WEBHOOK_URL` quando esses recursos estiverem ativos.
2. Garantir que o Compose receba `POSTGRES_PASSWORD`. Use `--env-file backend/.env.production` nos comandos abaixo ou mantenha um `.env` na raiz do projeto no servidor com essa variável.
3. Buildar as imagens sem iniciar o backend. O comando de start do backend aplica
   migrations automaticamente, então ele não deve subir antes do preflight dos índices:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml build backend nginx
```

4. Subir somente o Postgres:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml up -d postgres
```

5. Antes de iniciar o backend, criar os índices de produção de forma
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

6. Subir backend e Nginx. Neste momento o `CMD` do backend roda
   `npx prisma migrate deploy` automaticamente e inicia a API:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml up -d backend nginx
```

Para deploys futuros que não adicionem índices grandes, o fluxo normal pode voltar a
ser:

```bash
docker compose --env-file backend/.env.production -f docker-compose.prod.yml up -d --build
```

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
OPERATIONS_REQUIRE_RESTORE_STATUS=true
OPERATIONS_BACKUP_MAX_AGE_HOURS=26
OPERATIONS_RESTORE_MAX_AGE_DAYS=30
OPERATIONS_ALERT_JOB_ENABLED=true
OPERATIONS_ALERT_INTERVAL_MS=3600000
OPERATIONS_ALERT_WEBHOOK_URL=https://seu-monitoramento.example/webhook
ERROR_TRACKING_PROVIDER=webhook
ERROR_TRACKING_WEBHOOK_URL=https://seu-monitoramento.example/errors
```

O frontend também pode enviar erros não tratados para o backend:

```env
VITE_ERROR_TRACKING_ENABLED=true
```

Se o endpoint padrão `/api/operations/client-errors` não for usado, defina
`VITE_ERROR_TRACKING_ENDPOINT`.

Os scripts `deploy/backup-prod.sh` e `deploy/restore-prod.sh` escrevem os arquivos
de status. O compose/deploy deve montar o diretório desses arquivos no backend em
modo somente leitura.

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
