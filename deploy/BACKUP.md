# Backup

## O que este projeto precisa salvar

- Banco PostgreSQL
- Volume `filtrovali_relatorios`
- Certificados em `filtrovali_certs`
- Arquivo `backend/.env.production`

Os dados do banco em produção ficam no volume Docker `filtrovali_pgdata`, mas isso
é apenas persistência local no host. Não substitui backup externo.

## Script pronto

O arquivo `deploy/backup-prod.sh` faz:

- `pg_dump` do banco
- compactação do volume `filtrovali_relatorios`
- compactação do volume `filtrovali_certs`
- checksum SHA256
- envio opcional para Backblaze B2
- limpeza dos backups locais antigos quando o envio remoto termina com sucesso

## Uso no servidor

1. Dê permissão ao script:

```bash
chmod +x deploy/backup-prod.sh
```

2. Rode manualmente:

```bash
./deploy/backup-prod.sh
```

Por padrão ele usa:

- `PROJECT_DIR` detectado automaticamente pelo caminho do script
- `BACKUP_ROOT=/root/backups/filtrovali`
- `POSTGRES_DB=filtrovali`
- `POSTGRES_USER=postgres`
- `REPORTS_VOLUME=filtrovali_relatorios`
- `INCLUDE_REPORTS=true`
- `INCLUDE_CERTS=true`
- `BACKUP_LOCK_TIMEOUT_SECONDS=0`
- `LOCAL_BACKUP_KEEP` vazio, sem retenção local por quantidade
- mantém localmente o backup mais recente em `latest`

## Variáveis opcionais

```bash
B2_URI=b2://meu-bucket/filtrovali-backups
B2_BIN=/root/.local/bin/b2
INCLUDE_CERTS=false
INCLUDE_REPORTS=true
BACKUP_LOCK_TIMEOUT_SECONDS=0
LOCAL_BACKUP_KEEP=5
```

`B2_BIN` é opcional. Use apenas se o cron não encontrar o comando `b2`.

`LOCAL_BACKUP_KEEP` limita quantos diretórios de backup com timestamp ficam em
`BACKUP_ROOT`. Por exemplo, `LOCAL_BACKUP_KEEP=5` mantém os 5 backups locais
mais recentes mesmo quando o upload para o Backblaze B2 está desativado.

O script usa um lock em `$BACKUP_ROOT/backup-prod.lock` para impedir execuções
simultâneas. Por padrão, se outro backup já estiver rodando, a nova execução é
ignorada com sucesso. Para um backup que deve esperar outro terminar, defina
`BACKUP_LOCK_TIMEOUT_SECONDS` com o tempo máximo de espera em segundos.

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
- `prisma migrate deploy` em container one-off (aplica migrations versionadas)
- subida de backend/nginx somente após banco, migrations e arquivos concluírem

Uso:

```bash
chmod +x deploy/restore-prod.sh
```

```bash
BACKUP_SOURCE=/root/backups/filtrovali/2026-04-24-030001 ./deploy/restore-prod.sh
```

Sem restaurar certificados:

```bash
BACKUP_SOURCE=/root/backups/filtrovali/2026-04-24-030001 RESTORE_CERTS=false ./deploy/restore-prod.sh
```

Restore parcial explícito (uso excepcional, pois o banco pode referenciar arquivos ausentes):

```bash
BACKUP_SOURCE=/root/backups/filtrovali/2026-04-24-030001 ALLOW_PARTIAL_RESTORE=true ./deploy/restore-prod.sh
```

Sem rodar migrations:

```bash
BACKUP_SOURCE=/root/backups/filtrovali/2026-04-24-030001 RUN_MIGRATIONS=false ./deploy/restore-prod.sh
```

## Estratégia recomendada

- Backup horário completo (banco + relatórios + certificados) com retenção curta no Backblaze B2
- Backup diário completo com retenção longa
- Snapshot periódico do disco EBS
- Teste de restore pelo menos uma vez
