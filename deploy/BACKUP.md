# Backup

## O que este projeto precisa salvar

- Banco PostgreSQL
- Volume `filtrovali_relatorios`
- Certificados em `filtrovali_certs`
- Arquivo `backend/.env.production`

Os dados do banco em produção ficam no volume Docker `filtrovali_pgdata`, mas isso
é apenas persistência local no host. Não substitui backup externo.

## Fonte de verdade operacional

Este arquivo é a referência operacional de backup e restore. Qualquer PR que altere
`deploy/backup-prod.sh`, `deploy/restore-prod.sh`, `deploy/sync-staging.sh`,
`docker-compose*.yml`, nomes de serviços, nomes de volumes ou artefatos salvos deve
atualizar este documento na mesma mudança.

## Script pronto

O arquivo `deploy/backup-prod.sh` faz:

- `pg_dump` do banco
- compactação do volume `filtrovali_relatorios`
- compactação do volume `filtrovali_certs`
- checksum SHA256
- lock com `flock` para evitar execuções simultâneas
- atualização do symlink local `latest`
- envio opcional para Backblaze B2
- limpeza dos backups locais antigos quando o envio remoto termina com sucesso
- alerta opcional de falha por Telegram

## Uso no servidor

1. Dê permissão ao script:

```bash
chmod +x deploy/backup-prod.sh
```

2. Rode manualmente:

```bash
./deploy/backup-prod.sh
```

## Variáveis do backup

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PROJECT_DIR` | diretório pai de `deploy/` | raiz do projeto usada pelo `docker compose` |
| `COMPOSE_FILE` | `docker-compose.prod.yml` | compose usado pelo backup |
| `POSTGRES_SERVICE` | `postgres` | serviço do banco no compose |
| `POSTGRES_DB` | `filtrovali` | banco exportado pelo `pg_dump` |
| `POSTGRES_USER` | `postgres` | usuário do `pg_dump` |
| `REPORTS_VOLUME` | `filtrovali_relatorios` | volume compactado em `relatorios.tar.gz` |
| `CERTS_VOLUME` | `filtrovali_certs` | volume compactado em `certs.tar.gz` |
| `BACKUP_ROOT` | `/root/backups/filtrovali` | diretório local dos backups |
| `BACKUP_LOCK_FILE` | `$BACKUP_ROOT/backup-prod.lock` | lock de concorrência |
| `BACKUP_LOCK_TIMEOUT_SECONDS` | `0` | tempo máximo para esperar outro backup terminar |
| `INCLUDE_REPORTS` | `true` | inclui `relatorios.tar.gz` |
| `INCLUDE_CERTS` | `true` | inclui `certs.tar.gz` |
| `B2_URI` | vazio | destino remoto opcional, ex.: `b2://bucket/prefix` |
| `B2_BIN` | `b2` | comando da CLI Backblaze B2 |
| `TELEGRAM_TOKEN` | vazio | token do bot para alerta de falha |
| `TELEGRAM_CHAT_ID` | vazio | chat que recebe alerta de falha |

Cada execução cria uma pasta com timestamp em `BACKUP_ROOT` e atualiza o symlink
`latest` para o backup mais recente. Se `B2_URI` estiver configurado e o envio
remoto terminar com sucesso, o script remove backups locais antigos e mantém só o
backup apontado por `latest`. Se o envio remoto falhar ou estiver desabilitado, os
backups locais são mantidos.

## Exemplo de override

```bash
B2_URI=b2://meu-bucket/filtrovali-backups
B2_BIN=/root/.local/bin/b2
INCLUDE_CERTS=false
INCLUDE_REPORTS=true
BACKUP_LOCK_TIMEOUT_SECONDS=0
TELEGRAM_TOKEN=123456:token-do-bot
TELEGRAM_CHAT_ID=-1001234567890
```

`B2_BIN` é opcional. Use apenas se o cron não encontrar o comando `b2`.

O script usa um lock em `$BACKUP_ROOT/backup-prod.lock` para impedir execuções
simultâneas. Por padrão, se outro backup já estiver rodando, a nova execução é
ignorada com sucesso. Para um backup que deve esperar outro terminar, defina
`BACKUP_LOCK_TIMEOUT_SECONDS` com o tempo máximo de espera em segundos.

Se `TELEGRAM_TOKEN` e `TELEGRAM_CHAT_ID` estiverem definidos, qualquer erro no
script dispara uma mensagem com servidor, data, linha, comando e exit code. Isso
cobre falha de execução. Alerta de backup velho ou ausente ainda deve ser tratado
por monitoramento externo ou pela Fase de observabilidade.

## Backblaze B2

O script usa a CLI oficial `b2`, da Backblaze, e envia os arquivos para um
caminho `b2://bucket/prefix`.

1. Crie um bucket privado no Backblaze B2.
2. Crie uma Application Key com acesso somente ao bucket de backup.
3. Instale a CLI `b2` no servidor, se ainda não existir.
4. Autorize a CLI `b2` com essas credenciais.

```bash
python3 -m pip install --upgrade b2
```

Se o cron roda como `root`, autorize como `root`:

```bash
sudo -H b2 account authorize
```

A CLI vai usar:

- `applicationKeyId`: Key ID do Backblaze
- `applicationKey`: Application Key do Backblaze

Não use a Master Application Key da conta. Crie uma Application Key nova,
restrita ao bucket de backup. Para operação simples de backup e teste de
restore, use acesso `Read and Write`.

Para evitar que as credenciais apareçam no histórico do shell, salve-as em
arquivos protegidos e autorize usando variáveis de ambiente:

```bash
sudo install -d -m 700 /root/.config/newrdo-backup
sudo editor /root/.config/newrdo-backup/b2.env
sudo chmod 600 /root/.config/newrdo-backup/b2.env
```

```bash
# /root/.config/newrdo-backup/b2.env
export B2_APPLICATION_KEY_ID="<keyID-do-backblaze>"
export B2_APPLICATION_KEY="<applicationKey-do-backblaze>"
```

```bash
sudo -H bash -lc 'source /root/.config/newrdo-backup/b2.env && b2 account authorize'
```

Teste o acesso:

```bash
sudo -H b2 bucket list
```

Se o comando funcionar no terminal, mas o cron registrar
`b2 command not found`, descubra o caminho absoluto e informe no cron:

```bash
command -v b2
```

Exemplo:

```cron
B2_BIN=/root/.local/bin/b2
```

Rode um backup manual:

```bash
B2_URI=b2://filtrovali-backups/daily \
./deploy/backup-prod.sh
```

### Retenção automática no Backblaze

Configure a expiração no painel do Backblaze, em Lifecycle Rules do bucket. Uma
estratégia simples:

- prefixo `hourly/`: deletar após 7 dias
- prefixo `daily/`: deletar após 60 dias
- prefixo `monthly/`: deletar após 365 dias

Para os backups deste script, cada execução cria arquivos novos dentro de uma
pasta com timestamp. Por isso a regra precisa expirar arquivos por idade do
upload/prefixo, não apenas versões antigas do mesmo arquivo.

## Agendamento no cron

Três agendamentos recomendados — horário, diário e mensal:

```bash
crontab -e
```

```cron
# Horário — banco + relatórios + certificados
# Evita a janela dos backups mensal/diário; se outro backup ainda estiver rodando, pula esta execução.
0 0,3-23 * * * B2_URI=b2://filtrovali-backups/hourly INCLUDE_CERTS=true BACKUP_LOCK_TIMEOUT_SECONDS=0 /root/apps/filtroAPP/deploy/backup-prod.sh >> /root/logs/backup-filtrovali.log 2>&1

# Diário às 02h — banco + relatórios + certificados
# Espera até 2h se houver outro backup finalizando.
0 2 * * * B2_URI=b2://filtrovali-backups/daily INCLUDE_CERTS=true BACKUP_LOCK_TIMEOUT_SECONDS=7200 /root/apps/filtroAPP/deploy/backup-prod.sh >> /root/logs/backup-filtrovali.log 2>&1

# Mensal todo dia 1 às 01h — banco + relatórios + certificados
# Espera até 2h se houver outro backup finalizando.
0 1 1 * * B2_URI=b2://filtrovali-backups/monthly INCLUDE_CERTS=true BACKUP_LOCK_TIMEOUT_SECONDS=7200 /root/apps/filtroAPP/deploy/backup-prod.sh >> /root/logs/backup-filtrovali.log 2>&1
```

## Restore do banco

O restore manual continua possível para recuperação pontual, mas o fluxo preferido
é o restore automatizado da seção seguinte porque valida checksums e troca volumes
antes de publicar a aplicação.

Suba a stack e depois restaure:

```bash
gunzip -c /caminho/do/postgres.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres -d filtrovali
```

## Restore dos relatórios

```bash
docker run --rm -v filtrovali_relatorios:/to -v /caminho/do/backup:/backup alpine sh -c "find /to -mindepth 1 -maxdepth 1 -exec rm -rf {} + && cd /to && tar -xzf /backup/relatorios.tar.gz"
```

## Restore automatizado

O arquivo `deploy/restore-prod.sh` automatiza:

- validação de `SHA256SUMS`
- preflight obrigatório de `postgres.sql.gz`, `relatorios.tar.gz` e `certs.tar.gz` quando seus restores estão habilitados
- extração de `relatorios.tar.gz` e `certs.tar.gz` em staging temporário antes de tocar no banco
- subida apenas do Postgres e parada de backend/nginx antes de trocar volumes e banco
- restore do volume `filtrovali_relatorios` a partir do staging antes do drop do banco
- restore opcional de `filtrovali_certs` a partir do staging antes do drop do banco
- restore do banco
- `prisma migrate deploy` opcional em container one-off quando `RUN_MIGRATIONS=true`
- subida de backend/nginx somente após banco, migrations e arquivos concluírem

Uso:

```bash
chmod +x deploy/restore-prod.sh
```

```bash
BACKUP_SOURCE=/root/backups/filtrovali/2026-04-24-030001 ./deploy/restore-prod.sh
```

### Variáveis do restore

| Variável | Padrão | Uso |
| --- | --- | --- |
| `BACKUP_SOURCE` | obrigatório | diretório contendo `postgres.sql.gz` |
| `PROJECT_DIR` | diretório pai de `deploy/` | raiz do projeto usada pelo `docker compose` |
| `COMPOSE_FILE` | `docker-compose.prod.yml` | compose usado pelo restore |
| `POSTGRES_SERVICE` | `postgres` | serviço do banco no compose |
| `BACKEND_SERVICE` | `backend` | serviço de backend parado e reiniciado |
| `NGINX_SERVICE` | `nginx` | serviço público parado e reiniciado |
| `POSTGRES_DB` | `filtrovali` | banco recriado e restaurado |
| `POSTGRES_USER` | `postgres` | usuário de restore |
| `REPORTS_VOLUME` | `filtrovali_relatorios` | volume restaurado de `relatorios.tar.gz` |
| `CERTS_VOLUME` | `filtrovali_certs` | volume restaurado de `certs.tar.gz` |
| `RESTORE_REPORTS` | `true` | restaura relatórios quando o arquivo existe |
| `RESTORE_CERTS` | `true` | restaura certificados quando o arquivo existe |
| `REQUIRE_CHECKSUMS` | `true` | exige e valida `SHA256SUMS` |
| `ALLOW_PARTIAL_RESTORE` | `false` | permite restore sem todos os artefatos habilitados |
| `RUN_MIGRATIONS` | `false` | roda `prisma migrate deploy` após restaurar o banco |
| `RESTORE_STAGING_DIR` | temporário | diretório para validar arquivos antes de trocar volumes |

Sem restaurar certificados:

```bash
BACKUP_SOURCE=/root/backups/filtrovali/2026-04-24-030001 RESTORE_CERTS=false ./deploy/restore-prod.sh
```

Restore parcial explícito (uso excepcional, pois o banco pode referenciar arquivos ausentes):

```bash
BACKUP_SOURCE=/root/backups/filtrovali/2026-04-24-030001 ALLOW_PARTIAL_RESTORE=true ./deploy/restore-prod.sh
```

Rodando migrations após restaurar o banco:

```bash
BACKUP_SOURCE=/root/backups/filtrovali/2026-04-24-030001 RUN_MIGRATIONS=true ./deploy/restore-prod.sh
```

Use `REQUIRE_CHECKSUMS=false` apenas em recuperação excepcional, quando o backup
foi validado por outro meio e o arquivo `SHA256SUMS` não está disponível.

## Checklist para mudanças futuras

- Se mudar nomes de serviços ou volumes em `docker-compose*.yml`, atualize as tabelas
  de variáveis deste arquivo.
- Se o backup passar a salvar novo artefato, documente o arquivo gerado e inclua o
  comportamento correspondente no restore.
- Se o restore ganhar nova etapa destrutiva ou novo modo parcial, documente o risco e
  o comando explícito necessário para habilitar.
- Se a sincronização de staging mudar a origem dos backups ou o tratamento do symlink
  `latest`, atualize este arquivo e `deploy/STAGING.md`.
- Antes de mergear mudanças operacionais, rode pelo menos `git diff --check` e um
  teste manual em staging ou ambiente descartável quando houver alteração de script.

## Estratégia recomendada

- Backup horário completo (banco + relatórios + certificados) com retenção curta no Backblaze B2
- Backup diário completo com retenção longa
- Snapshot periódico do disco EBS
- Teste de restore pelo menos uma vez
