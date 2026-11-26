# Backup

## Configuração verificada em produção em 25/11/2026

A origem dos agendamentos é o **crontab do usuário `root` da VPS**, com o serviço
`cron` ativo. O host usa `Etc/UTC`; não há `TZ` ou `CRON_TZ` no crontab. Os horários
abaixo são UTC, e a coluna Brasília usa UTC−3.

| Rotina | Horário UTC | Horário de Brasília | Destino |
|---|---|---|---|
| Cópia local completa | 00h, 03h, 08h, 13h, 18h e 23h, diariamente | 21h do dia anterior; 00h, 05h, 10h, 15h e 20h | `/root/backups/filtrovali/<timestamp>` |
| Diário completo | 02h, diariamente | 23h do dia anterior | `b2://filtrovali-backups/daily/<timestamp>` |
| Mensal completo | Dia 1 às 01h | Último dia do mês anterior às 22h | `b2://filtrovali-backups/monthly/<timestamp>` |
| Ensaio de restauração | Dia 2 às 04h30 | Dia 2 às 01h30 | PostgreSQL descartável; status local |

A expressão local `0 0,3-23/5 * * *` não representa intervalos uniformes de cinco
horas: também executa às 23h e às 00h, com intervalo de uma hora nessa virada.
Não há backup horário nem envio para um prefixo `hourly-db/` no cron vigente.
Veja as linhas exatas em [Agendamento no cron](#agendamento-no-cron).

As três rotinas de backup chamam `/usr/local/sbin/filtroapp-backup-run` (modo
`700`), instalado no servidor, fora do repositório. Ele exporta as variáveis de
`/root/.config/filtroapp-backup/env` (modo `600`) e executa
`/root/apps/filtroAPP/deploy/backup-prod.sh`. O arquivo de ambiente contém
`POSTGRES_PASSWORD`, `TELEGRAM_TOKEN` e `TELEGRAM_CHAT_ID`; seus valores não devem
ser copiados para a documentação. O cron informa `B2_URI` apenas nas rotinas
diária e mensal. O ensaio usa a CLI `/root/.local/bin/b2` e o arquivo
`/root/.config/filtroapp-backup/b2.env` (modo `600`). O caminho antigo
`/root/.config/newrdo-backup/b2.env` não existe nessa VPS.

### Conteúdo e retenção efetivos

Cada backup completo gera `postgres.sql.gz`, `relatorios.tar.gz`,
`certs.tar.gz`, `proxy.tar.gz` e `SHA256SUMS`. Os arquivos correspondem ao dump do
PostgreSQL e aos volumes `filtrovali_relatorios`, `filtrovali_certs` e
`infra_proxy_data` (Caddy). Os volumes permanecem montados somente para leitura
durante o arquivamento. `latest` aponta para o último diretório que chegou à
etapa de checksum; o link sozinho não comprova upload para o B2.

A cópia local recebe `LOCAL_BACKUP_KEEP=2` e remove os diretórios com timestamp
mais antigos após concluir. Diário e mensal não recebem esse limite: após
upload bem-sucedido, o script deixa **somente o diretório daquela execução** no
host. As cópias locais posteriores voltam a acumular até duas. Execuções com
falha podem deixar diretórios incompletos, além desse limite. Os dumps de
pré-deploy ficam separados em `/root/backups/filtrovali/pre-deploy` (padrão de
três cópias), fora dessa limpeza.

O bucket `filtrovali-backups` está privado. As regras de lifecycle consultadas
na API do B2 são:

| Prefixo exato | Ocultar após o upload | Excluir após ocultar |
|---|---|---|
| `daily/` | 7 dias | 1 dia |
| `monthly` | 60 dias | 1 dia |

Não se trata de retenção diária de 60 dias ou mensal de 365 dias. O prefixo
mensal está configurado como `monthly`, sem barra final. Esta verificação não
altera o cron nem as regras do bucket.

`backend/.env.production`, os arquivos protegidos em `/root/.config` e o
Caddyfile do infra-proxy **não são copiados pelo script**: precisam ser
recuperáveis separadamente do cofre/configuração da infraestrutura. O volume
`filtrovali_pgdata` é persistência local; o backup do banco é o dump lógico.

### Evidência operacional da verificação

O log do cron registra o diário de `2026-11-25-020002` concluído com upload para
`daily/` e a cópia local de `2026-11-25-180001` concluída. A listagem do B2
confirmou os cinco arquivos do diário de hoje, além dos diretórios mensais de
01/10 e 01/11. Na coleta,
`latest` apontava para a cópia das 18h. Entretanto, `backup-latest.json`
registrava uma execução posterior com **`FAILURE`**, iniciada às 18h48m37 UTC,
encerrada às 18h48m38 UTC, código 130, na etapa de dump (linha 148).
Esse horário não corresponde ao cron configurado; a origem e a causa da
interrupção não foram determinadas nesta verificação. O status registra a
última execução, inclusive fora do cron; não confirma isoladamente o último
upload remoto. Desde 26/11, esse papel é do `offsite-latest.json` (seção
[Status da cópia externa](#status-da-cópia-externa-b2)).

O último `restore-latest.json` é um ensaio **`SUCCESS` de 18/11/2026**,
13h56m32–13h59m47 UTC: 195 segundos no total, 24 segundos para restaurar o banco,
a partir de `daily/2026-11-18-020001`. O cron mensal está instalado, mas ainda
não havia `/root/logs/restore-drill.log` na coleta; esse status não comprova uma
execução pelo agendamento mensal.

API e worker exigem os status de backup e restore. Os limites em execução são
`OPERATIONS_BACKUP_MAX_AGE_HOURS=26` e `OPERATIONS_RESTORE_MAX_AGE_DAYS=35`,
com `OPERATIONS_ALERT_JOB_ENABLED=true`. O script de backup tem credenciais de
Telegram configuradas para falhas; não foi feito teste de entrega de alerta.

## Script pronto

O arquivo `deploy/backup-prod.sh` faz:

- `pg_dump` do banco
- compactação do volume `filtrovali_relatorios`
- compactação do volume `filtrovali_certs`
- checksum SHA256
- envio opcional para Backblaze B2
- limpeza dos backups locais antigos quando o envio remoto termina com sucesso
- publicação de status operacional em JSON para o backend monitorar backup velho,
  ausente ou com falha

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
- `PROXY_VOLUME=infra_proxy_data`
- `INCLUDE_PROXY=true`
- `BACKUP_LOCK_TIMEOUT_SECONDS=0`
- `BACKUP_STATUS_FILE=/root/backups/filtrovali/status/backup-latest.json`
- `LOCAL_BACKUP_KEEP` vazio, sem retenção local por quantidade
- `BACKUP_NICE_LEVEL=19`, reduzindo a prioridade da compressão local
- `BACKUP_DOCKER_CPUS=0.5`, limitando CPU dos arquivos tar executados em containers auxiliares
- mantém localmente o backup mais recente em `latest`

## Variáveis opcionais

```bash
B2_URI=b2://meu-bucket/filtrovali-backups
B2_BIN=/root/.local/bin/b2
INCLUDE_CERTS=false
INCLUDE_PROXY=true
INCLUDE_REPORTS=true
BACKUP_LOCK_TIMEOUT_SECONDS=0
LOCAL_BACKUP_KEEP=5
BACKUP_STATUS_FILE=/root/backups/filtrovali/status/backup-latest.json
```

`B2_BIN` é opcional. Use apenas se o cron não encontrar o comando `b2`.

`INCLUDE_PROXY` controla o arquivamento de `infra_proxy_data`, o volume do
infra-proxy (Caddy), gerenciado em repositório independente; veja
[INFRA-PROXY.md](INFRA-PROXY.md). O backup continua incluindo esse volume
compartilhado da VPS e não exige o checkout do proxy. Ele guarda a chave da conta ACME e os certificados
emitidos — sem ele, um restore em servidor novo reemite tudo do zero e pode
esbarrar no rate limit do Let's Encrypt. Se o volume não existir, o backup
apenas avisa no stderr e segue, em vez de gerar um `proxy.tar.gz` vazio.

`LOCAL_BACKUP_KEEP` limita quantos diretórios de backup com timestamp ficam em
`BACKUP_ROOT`. Por exemplo, `LOCAL_BACKUP_KEEP=5` mantém os 5 backups locais
mais recentes mesmo quando o upload para o Backblaze B2 está desativado.

O script usa um lock em `$BACKUP_ROOT/backup-prod.lock` para impedir execuções
simultâneas. Por padrão, se outro backup já estiver rodando, a nova execução é
ignorada com sucesso. Para um backup que deve esperar outro terminar, defina
`BACKUP_LOCK_TIMEOUT_SECONDS` com o tempo máximo de espera em segundos.

## Status operacional do backup

Ao final de cada backup, ou quando ocorre falha, o script atualiza um JSON em
`BACKUP_STATUS_FILE`. Exemplo:

```json
{
  "kind": "backup",
  "status": "SUCCESS",
  "startedAt": "2026-07-02T02:00:00-03:00",
  "finishedAt": "2026-07-02T02:04:00-03:00",
  "backupRoot": "/root/backups/filtrovali",
  "runDir": "/root/backups/filtrovali/2026-07-02-020000",
  "includeReports": true,
  "includeCerts": true,
  "b2Configured": true,
  "uploadSucceeded": true,
  "exitCode": 0,
  "line": 0
}
```

Para o endpoint administrativo `GET /api/operations/status` monitorar isso, o
compose de produção já monta por padrão
`/root/backups/filtrovali/status:/ops-status:ro` no backend. Crie o diretório no
host e configure:

```env
OPERATIONS_BACKUP_STATUS_FILE=/ops-status/backup-latest.json
OPERATIONS_REQUIRE_BACKUP_STATUS=true
OPERATIONS_BACKUP_MAX_AGE_HOURS=26
```

Se o arquivo estiver ausente, inválido, com `status=FAILURE` ou mais velho que
`OPERATIONS_BACKUP_MAX_AGE_HOURS`, o status operacional passa a retornar problema.

### Status da cópia externa (B2)

O `backup-latest.json` registra **qualquer** execução, e a cópia local roda 6 vezes por dia. Por
isso ele não serve para saber se o envio ao B2 continua acontecendo: um backup local bem-sucedido
cobriria um diário que falhou. As rotinas com `B2_URI` (diária e mensal) gravam também
`OFFSITE_STATUS_FILE`, que por padrão é `$BACKUP_ROOT/status/offsite-latest.json`:

```json
{
  "kind": "backup-offsite",
  "status": "SUCCESS",
  "startedAt": "2026-11-27T02:00:01+00:00",
  "finishedAt": "2026-11-27T02:12:40+00:00",
  "destination": "b2://filtrovali-backups/daily/2026-11-27-020001",
  "runDir": "/root/backups/filtrovali/2026-11-27-020001",
  "exitCode": 0
}
```

- **Quando vira `SUCCESS`:** só depois do `b2 sync`.
- **Quando vira `FAILURE`:** qualquer falha numa rotina com `B2_URI`, inclusive sem o comando
  `b2` no servidor. Antes, nesse caso, o script só avisava no log e terminava com sucesso.
- **Leitura pelo backend:** ele lê o arquivo em `/ops-status/offsite-latest.json`. Uma
  `FAILURE` ou uma última cópia com mais de `OPERATIONS_OFFSITE_BACKUP_MAX_AGE_HOURS` (padrão 26)
  viram problema no painel de Operações e alerta por e-mail.
- **Arquivo ausente:** só é problema com `OPERATIONS_REQUIRE_OFFSITE_BACKUP_STATUS=true`. Ligue
  essa opção depois que o primeiro diário gravar o arquivo.

```env
OPERATIONS_OFFSITE_BACKUP_STATUS_FILE=/ops-status/offsite-latest.json
OPERATIONS_OFFSITE_BACKUP_MAX_AGE_HOURS=26
OPERATIONS_REQUIRE_OFFSITE_BACKUP_STATUS=true
```

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
sudo install -d -m 700 /root/.config/filtroapp-backup
sudo editor /root/.config/filtroapp-backup/b2.env
sudo chmod 600 /root/.config/filtroapp-backup/b2.env
```

```bash
# /root/.config/filtroapp-backup/b2.env
export B2_APPLICATION_KEY_ID="<keyID-do-backblaze>"
export B2_APPLICATION_KEY="<applicationKey-do-backblaze>"
```

```bash
sudo -H bash -lc 'source /root/.config/filtroapp-backup/b2.env && b2 account authorize'
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

### Retenção no Backblaze

As regras instaladas são as descritas em [Conteúdo e retenção efetivos](#conteúdo-e-retenção-efetivos).
Elas expiram os uploads com timestamp por prefixo. Para consultar sem modificar:

```bash
set -a
source /root/.config/filtroapp-backup/b2.env
set +a
/root/.local/bin/b2 bucket get filtrovali-backups
```

## Agendamento no cron

Linhas ativas do crontab de `root`, verificadas em 25/11/2026. **Horários UTC**.
Não reinstale estas linhas sem antes conferir `crontab -l`, para evitar duplicar
as rotinas existentes.

```cron
# Local completo: 00h, 03h, 08h, 13h, 18h e 23h UTC; sem upload; até 2 diretórios.
0 0,3-23/5 * * * INCLUDE_CERTS=true BACKUP_LOCK_TIMEOUT_SECONDS=0 LOCAL_BACKUP_KEEP=2 /usr/local/sbin/filtroapp-backup-run >> /root/logs/backup-filtrovali.log 2>&1

# Diário completo às 02h UTC; espera até 2h pelo lock.
0 2 * * * B2_URI=b2://filtrovali-backups/daily INCLUDE_CERTS=true BACKUP_LOCK_TIMEOUT_SECONDS=7200 /usr/local/sbin/filtroapp-backup-run >> /root/logs/backup-filtrovali.log 2>&1

# Mensal completo no dia 1 às 01h UTC; espera até 2h pelo lock.
0 1 1 * * B2_URI=b2://filtrovali-backups/monthly INCLUDE_CERTS=true BACKUP_LOCK_TIMEOUT_SECONDS=7200 /usr/local/sbin/filtroapp-backup-run >> /root/logs/backup-filtrovali.log 2>&1

# Ensaio mensal no dia 2 às 04h30 UTC; credenciais de leitura do B2.
30 4 2 * * B2_BIN=/root/.local/bin/b2 B2_ENV_FILE=/root/.config/filtroapp-backup/b2.env bash /root/apps/filtroAPP/deploy/restore-drill.sh >> /root/logs/restore-drill.log 2>&1
```

O cron antigo de renovação via Certbot está comentado. O TLS em uso é gerenciado
pelo Caddy; veja [INFRA-PROXY.md](INFRA-PROXY.md).

Para executar manualmente com as mesmas variáveis protegidas do cron:

```bash
# Local; preserva até 2 diretórios.
LOCAL_BACKUP_KEEP=2 /usr/local/sbin/filtroapp-backup-run

# Cópia externa diária; sucesso no upload deixa só esta execução no host.
B2_URI=b2://filtrovali-backups/daily BACKUP_LOCK_TIMEOUT_SECONDS=7200 /usr/local/sbin/filtroapp-backup-run
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
- preflight obrigatório de `postgres.sql.gz`, `relatorios.tar.gz`, `certs.tar.gz` e `proxy.tar.gz` quando seus restores estão habilitados
- extração de `relatorios.tar.gz`, `certs.tar.gz` e `proxy.tar.gz` em staging temporário antes de tocar no banco
- subida apenas do Postgres e parada de backend/nginx antes de trocar volumes e banco
- restore do volume `filtrovali_relatorios` a partir do staging antes do drop do banco
- restore opcional de `filtrovali_certs` a partir do staging antes do drop do banco
- restore opcional de `infra_proxy_data`, parando e subindo o infra-proxy em volta da troca
- restore do banco
- `prisma migrate deploy` em container one-off (aplica migrations versionadas)
- subida de backend/nginx somente após banco, migrations e arquivos concluírem
- publicação de status operacional em JSON para comprovar o último restore/teste

Uso:

```bash
chmod +x deploy/restore-prod.sh
```

```bash
BACKUP_SOURCE=/root/backups/filtrovali/2026-04-24-030001 ./deploy/restore-prod.sh
```

Por padrão, o restore escreve status em
`/root/backups/filtrovali/status/restore-latest.json`. Para o backend monitorar o
último restore testado, monte esse arquivo no container e configure:

```env
OPERATIONS_RESTORE_STATUS_FILE=/ops-status/restore-latest.json
OPERATIONS_REQUIRE_RESTORE_STATUS=true
OPERATIONS_RESTORE_MAX_AGE_DAYS=35
```

Sem restaurar certificados:

```bash
BACKUP_SOURCE=/root/backups/filtrovali/2026-04-24-030001 RESTORE_CERTS=false ./deploy/restore-prod.sh
```

### Restaurando o infra-proxy

`RESTORE_PROXY` vem **desligado por padrão**, ao contrário do backup. Restaurar
`infra_proxy_data` para e sobe o Caddy, derrubando o TLS de todos os apps da VPS
— algo que faz sentido em recuperação de desastre num servidor novo, mas não num
rollback de banco, onde o proxy em produção está saudável e não deve ser tocado.

```bash
BACKUP_SOURCE=/root/backups/filtrovali/2026-04-24-030001 RESTORE_PROXY=true ./deploy/restore-prod.sh
```

O Caddy mantém estado aberto em `/data` (conta ACME e locks), por isso o script
o para antes de trocar o volume e o sobe de novo em seguida. Por padrão,
`PROXY_COMPOSE_FILE` aponta para `../infra-proxy/docker-compose.yml`, relativo a
`PROJECT_DIR`, a raiz do filtroAPP. O checkout independente do proxy é necessário
somente quando seu volume será restaurado; o script valida seu Compose antes de
alterar serviços ou volumes. Se ele estiver em outro caminho, use o arquivo que
gerencia o proxy em execução:

```bash
BACKUP_SOURCE=/root/backups/filtrovali/2026-04-24-030001 \
  RESTORE_PROXY=true PROXY_COMPOSE_FILE=/opt/infra-proxy/docker-compose.yml \
  ./deploy/restore-prod.sh
```

Restore parcial explícito (uso excepcional, pois o banco pode referenciar arquivos ausentes):

```bash
BACKUP_SOURCE=/root/backups/filtrovali/2026-04-24-030001 ALLOW_PARTIAL_RESTORE=true ./deploy/restore-prod.sh
```

Sem rodar migrations:

```bash
BACKUP_SOURCE=/root/backups/filtrovali/2026-04-24-030001 RUN_MIGRATIONS=false ./deploy/restore-prod.sh
```

## Ensaio de restauração (`deploy/restore-drill.sh`)

Backup que nunca foi restaurado não é backup comprovado. O ensaio:

1. pega o backup mais recente de `b2://filtrovali-backups/daily` (ou
   `RESTORE_DRILL_B2_URI`, ou uma pasta local em `RESTORE_DRILL_SOURCE`);
2. confere `SHA256SUMS`, a integridade do `postgres.sql.gz` e a leitura do
   `relatorios.tar.gz`;
3. restaura o dump com `ON_ERROR_STOP` num container `postgres:16-alpine`
   descartável, **sem rede** e apagado no fim (nunca no banco de produção);
4. confere migrations aplicadas, usuários, projetos, colaboradores, relatórios e
   a idade do último relatório (`RESTORE_DRILL_MAX_DATA_AGE_HOURS`, padrão 96);
5. grava `restore-latest.json` (`kind: restore-drill`, duração, contagens), lido
   pelo painel de Operações.

O ensaio já está agendado no cron de produção. Para uma execução manual no servidor:

```bash
cd ~/apps/filtroAPP
B2_BIN=/root/.local/bin/b2 B2_ENV_FILE=/root/.config/filtroapp-backup/b2.env bash deploy/restore-drill.sh
```

Em produção já estão ativos `OPERATIONS_REQUIRE_RESTORE_STATUS=true` e
`OPERATIONS_RESTORE_MAX_AGE_DAYS=35` no `backend/.env.production`. Se
`TELEGRAM_TOKEN`/`TELEGRAM_CHAT_ID` estiverem no ambiente do cron, uma falha também
avisa no Telegram, como no backup.
