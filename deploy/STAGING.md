# Homologação

Ambiente de validação entre desenvolvimento e produção. Roda a mesma stack de prod
(Postgres + backend + Nginx) com dados reais atualizados diariamente, mas com e-mails
para clientes bloqueados e acesso restrito por IP.

## Arquivos do ambiente

| Arquivo | Função |
|---|---|
| `docker-compose.staging.yml` | Stack isolada de homologação |
| `backend/.env.staging` | Único arquivo de configuração — backend e senha do Postgres (gitignored) |
| `deploy/nginx/staging.conf` | Nginx com restrição de acesso por IP |
| `deploy/sync-staging.sh` | Sincronização diária do banco com prod |

## URL

```
http://app.filtrovali.com.br:8080
```

Usa o mesmo DNS de produção — nenhuma alteração de DNS necessária. A porta diferencia
os dois ambientes: prod responde em `443`, staging em `8080`.

## Restrição de acesso

O acesso é controlado em duas camadas independentes:

**Camada 1 — firewall do servidor**

Libere a porta 8080 apenas para os IPs do escritório e da VPN no firewall do servidor
(AWS Security Group, iptables, etc.). Qualquer outro IP sequer chega ao Nginx.

**Camada 2 — Nginx**

Edite `deploy/nginx/staging.conf` e adicione os IPs autorizados no bloco `geo`:

```nginx
geo $staging_allowed {
    default         0;
    127.0.0.1       1;
    177.x.x.x       1;  # IP fixo do escritório
    10.0.0.0/8      1;  # rede VPN interna
}
```

IPs fora da lista recebem `403` antes de qualquer processamento pelo backend.

## Configuração inicial (uma vez no servidor)

### 1. Preencher o arquivo de configuração

```bash
nano backend/.env.staging
```

Substitua todos os valores `CHANGE_ME`. Há apenas uma senha para definir —
`STAGING_POSTGRES_PASSWORD` — e ela deve aparecer duas vezes no arquivo: uma como
variável explícita (usada pelo compose ao inicializar o Postgres) e outra dentro do
`DATABASE_URL` (usada pelo backend para conectar). Mantenha os dois valores iguais:

```
STAGING_POSTGRES_PASSWORD=escolha-uma-senha-forte
DATABASE_URL="postgresql://postgres:escolha-uma-senha-forte@postgres:5432/filtrovali?schema=public"
```

Confirme que `SEND_CLIENT_EMAILS=false` está presente. Nunca altere para `true`
em homologação — o banco contém dados reais de clientes.

Se o volume `filtrovali_staging_pgdata` for removido, o Postgres inicializa do zero
e exige `STAGING_POSTGRES_PASSWORD` preenchido. O script de sync aborta antes de subir
o container se essa variável estiver vazia.

### 2. Adicionar IPs autorizados no Nginx de staging

```bash
nano deploy/nginx/staging.conf
```

Adicione os IPs dentro do bloco `geo $staging_allowed`.

### 3. Subir o ambiente pela primeira vez

```bash
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml up -d --build
```

### 4. Popular o banco

**Opção A — seed limpo** (sem dados reais):

```bash
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml exec backend npx prisma db seed
```

**Opção B — restaurar o último snapshot de produção** (recomendado):

```bash
./deploy/sync-staging.sh
```

## Sincronização diária com produção

O script `deploy/sync-staging.sh` aplica o último snapshot de backup de prod ao banco
de homologação e restaura o volume de relatórios (`relatorios.tar.gz`) para que
miniaturas, anexos e PDFs apontados pelo banco existam no staging. Ele detecta se o
ambiente está rodando ou parado e age de acordo:

- **Ambiente parado**: sobe o banco, aplica o snapshot, restaura arquivos, builda backend/Nginx, roda migrations, desliga tudo.
- **Ambiente rodando**: para backend e Nginx, aplica o snapshot, restaura arquivos, builda backend/Nginx, roda migrations, recria os serviços.

O build é feito por padrão para garantir que migrations, backend e bundle React do Nginx
usem o código atual do branch. Para pular o build em um caso excepcional:

```bash
BUILD_SERVICES=false ./deploy/sync-staging.sh
```

Por padrão, a restauração falha se `relatorios.tar.gz` não existir, porque o banco
restaurado contém referências para esses arquivos. Para sincronizar somente o banco em
um caso excepcional:

```bash
RESTORE_REPORTS=false ./deploy/sync-staging.sh
```

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
- **Certificados TLS** — homologação roda em HTTP simples. Não é necessário emitir
  certificado para o subdomínio de staging.

## Notas de segurança

- `backend/.env.staging` está no `.gitignore` (coberto pelo padrão `backend/.env.*`) e nunca deve
  ser commitado.
- O banco de homologação contém uma cópia dos dados de prod. Trate o acesso ao servidor
  com o mesmo cuidado.
- `SEND_CLIENT_EMAILS=false` é a única proteção entre testes e e-mails reais enviados
  a clientes. Não altere sem revisão explícita.
