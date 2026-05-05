# Backup

## O que este projeto precisa salvar

- Banco PostgreSQL
- Volume `filtrovali_relatorios`
- Opcional: certificados em `filtrovali_certs`
- Arquivo `backend/.env.production`

Os dados do banco em produção ficam no volume Docker `filtrovali_pgdata`, mas isso
é apenas persistência local no host. Não substitui backup externo.

## Script pronto

O arquivo `deploy/backup-prod.sh` faz:

- `pg_dump` do banco
- compactação do volume `filtrovali_relatorios`
- checksum SHA256
- retenção local por dias
- envio opcional para S3

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

- `PROJECT_DIR=/home/ubuntu/apps/RDOAPP`
- `BACKUP_ROOT=/home/ubuntu/backups/filtrovali`
- `POSTGRES_DB=filtrovali`
- `POSTGRES_USER=postgres`
- `REPORTS_VOLUME=filtrovali_relatorios`
- `INCLUDE_REPORTS=true`
- retenção local de `14` dias

## Variáveis opcionais

```bash
AWS_S3_URI=s3://meu-bucket/filtrovali-backups
INCLUDE_CERTS=true
INCLUDE_REPORTS=true
RETENTION_DAYS=30
```

## Agendamento no cron

Três agendamentos recomendados — horário, diário e mensal:

```bash
crontab -e
```

```cron
# Horário — banco + relatórios + certificados, retenção 2 dias
0 * * * * AWS_S3_URI=s3://filtrovali-backups/hourly INCLUDE_CERTS=true RETENTION_DAYS=2 PROJECT_DIR=/home/ubuntu/apps/RDOAPP /home/ubuntu/apps/RDOAPP/deploy/backup-prod.sh >> /home/ubuntu/backup-filtrovali.log 2>&1

# Diário às 03h — banco + relatórios + certificados, retenção 30 dias
0 3 * * * AWS_S3_URI=s3://filtrovali-backups/daily INCLUDE_CERTS=true RETENTION_DAYS=30 PROJECT_DIR=/home/ubuntu/apps/RDOAPP /home/ubuntu/apps/RDOAPP/deploy/backup-prod.sh >> /home/ubuntu/backup-filtrovali.log 2>&1

# Mensal todo dia 1 às 02h — banco + relatórios + certificados, retenção 365 dias
0 2 1 * * AWS_S3_URI=s3://filtrovali-backups/monthly INCLUDE_CERTS=true RETENTION_DAYS=365 PROJECT_DIR=/home/ubuntu/apps/RDOAPP /home/ubuntu/apps/RDOAPP/deploy/backup-prod.sh >> /home/ubuntu/backup-filtrovali.log 2>&1
```

## Restore do banco

Suba a stack e depois restaure:

```bash
gunzip -c /caminho/do/postgres.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres -d filtrovali
```

## Restore dos relatórios

```bash
docker run --rm -v filtrovali_relatorios:/to -v /caminho/do/backup:/backup alpine sh -c "cd /to && tar -xzf /backup/relatorios.tar.gz"
```

## Restore automatizado

O arquivo `deploy/restore-prod.sh` automatiza:

- subida da stack
- `prisma db push` (aplica schema)
- restore do banco
- restore do volume `filtrovali_relatorios` (opcional, se arquivo presente)
- restore opcional de `filtrovali_certs`

Uso:

```bash
chmod +x deploy/restore-prod.sh
```

```bash
BACKUP_SOURCE=/home/ubuntu/restore/filtrovali/2026-04-24-030001 ./deploy/restore-prod.sh
```

Sem restaurar certificados:

```bash
BACKUP_SOURCE=/home/ubuntu/restore/filtrovali/2026-04-24-030001 RESTORE_CERTS=false ./deploy/restore-prod.sh
```

Sem rodar migrations:

```bash
BACKUP_SOURCE=/home/ubuntu/restore/filtrovali/2026-04-24-030001 RUN_MIGRATIONS=false ./deploy/restore-prod.sh
```

## Estratégia recomendada

- Backup horário completo (banco + relatórios) com retenção curta no S3
- Backup diário com certificados e retenção longa
- Snapshot periódico do disco EBS
- Teste de restore pelo menos uma vez
