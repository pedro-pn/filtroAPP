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

1. Copie o script para a EC2, por exemplo em `/home/ubuntu/apps/RDOAPP/deploy/backup-prod.sh`
2. Dê permissão:

```bash
chmod +x deploy/backup-prod.sh
```

3. Rode manualmente:

```bash
./deploy/backup-prod.sh
```

Por padrão ele usa:

- `PROJECT_DIR=/home/ubuntu/apps/RDOAPP`
- `BACKUP_ROOT=/home/ubuntu/backups/filtrovali`
- `POSTGRES_DB=filtrovali`
- `POSTGRES_USER=postgres`
- `REPORTS_VOLUME=filtrovali_relatorios`
- retenção local de `14` dias

## Variáveis opcionais

```bash
AWS_S3_URI=s3://meu-bucket/filtrovali-backups
INCLUDE_CERTS=true
RETENTION_DAYS=30
```

Exemplo:

```bash
AWS_S3_URI=s3://meu-bucket/filtrovali-backups INCLUDE_CERTS=true ./deploy/backup-prod.sh
```

## Agendamento no cron

Executar diariamente às 03:00:

```bash
crontab -e
```

```cron
0 3 * * * /home/ubuntu/apps/RDOAPP/deploy/backup-prod.sh >> /home/ubuntu/backup-filtrovali.log 2>&1
```

Com upload para S3:

```cron
0 3 * * * AWS_S3_URI=s3://meu-bucket/filtrovali-backups /home/ubuntu/apps/RDOAPP/deploy/backup-prod.sh >> /home/ubuntu/backup-filtrovali.log 2>&1
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

## Estratégia recomendada

- Backup diário via script
- Cópia para S3
- Snapshot periódico do disco EBS
- Teste de restore pelo menos uma vez
