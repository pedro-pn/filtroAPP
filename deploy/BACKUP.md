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
- envio opcional para S3
- limpeza dos backups locais antigos quando o envio ao S3 termina com sucesso

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
- mantém localmente o backup mais recente em `latest`

## Variáveis opcionais

```bash
AWS_S3_URI=s3://meu-bucket/filtrovali-backups
INCLUDE_CERTS=false
INCLUDE_REPORTS=true
```

## Agendamento no cron

Três agendamentos recomendados — horário, diário e mensal:

```bash
crontab -e
```

```cron
# Horário — banco + relatórios + certificados
0 * * * * AWS_S3_URI=s3://filtrovali-backups/hourly INCLUDE_CERTS=true /root/apps/filtroAPP/deploy/backup-prod.sh >> /root/logs/backup-filtrovali.log 2>&1

# Diário às 02h — banco + relatórios + certificados
0 2 * * * AWS_S3_URI=s3://filtrovali-backups/daily INCLUDE_CERTS=true /root/apps/filtroAPP/deploy/backup-prod.sh >> /root/logs/backup-filtrovali.log 2>&1

# Mensal todo dia 1 às 01h — banco + relatórios + certificados
0 1 1 * * AWS_S3_URI=s3://filtrovali-backups/monthly INCLUDE_CERTS=true /root/apps/filtroAPP/deploy/backup-prod.sh >> /root/logs/backup-filtrovali.log 2>&1
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

- Backup horário completo (banco + relatórios + certificados) com retenção curta no S3
- Backup diário completo com retenção longa
- Snapshot periódico do disco EBS
- Teste de restore pelo menos uma vez
