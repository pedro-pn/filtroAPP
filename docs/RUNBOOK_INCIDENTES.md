# Runbook de operação e incidentes

Passo a passo para a pessoa de plantão, sem depender de quem montou o sistema.
Todos os comandos rodam **no servidor** (`filtrovali`, como root), na raiz do
checkout de produção:

```bash
cd ~/apps/filtroAPP
alias dcp='docker compose --env-file backend/.env.production -f docker-compose.prod.yml'
```

Regra geral: primeiro **estabilizar** (devolver o serviço), depois **investigar**
e por fim **registrar** (seção "Registro do incidente"). Nunca apague logs,
backups ou a trilha de auditoria para "limpar" um incidente.

Referências: `deploy/PRODUCTION.md` (subida e configuração),
`deploy/BACKUP.md` (backup e restore), `docs/OPERACOES.md` (vazamento de token
da API de integrações), `deploy/INFRA-PROXY.md` (Caddy/TLS).

---

## 0. Triagem (2 minutos)

```bash
dcp ps                                           # estado e saúde de postgres, backend, worker, nginx
dcp exec -T backend node -e "fetch('http://localhost:4000/health').then(r=>r.text()).then(console.log)"
dcp exec -T nginx wget -q -O - http://127.0.0.1/app-version.json   # commit do frontend no ar
cat /root/backups/filtrovali/deploy/current-sha 2>/dev/null        # último deploy concluído
tail -n 5 /root/backups/filtrovali/deploy/deploy-history.log 2>/dev/null
df -h / /var/lib/docker
dcp logs --since 30m --tail 200 backend worker nginx
```

O painel **Administração → Operações** (`/api/operations/status`) mostra jobs,
filas, último backup e último restore.

| Sintoma | Vá para |
|---|---|
| Site não abre / 502 / 504 | 1 |
| Erros de banco, "too many connections", disco cheio | 2 |
| Problema começou logo depois de um deploy | 3 |
| Dados perdidos ou corrompidos, servidor perdido | 4 |
| Senha, token ou chave exposta | 5 |
| Omie, Conecta, ZapSign, OpenAI ou e-mail falhando | 6 |

---

## 1. Aplicação fora do ar

Antes de mexer: se o problema vai demorar (restore, migration manual, banco cheio),
ligue a página de manutenção para os usuários verem um aviso em vez de erro:
`deploy/maintenance.sh on "motivo"` (desligue com `deploy/maintenance.sh off`).
Se a tela de manutenção aparece sem ninguém ter ligado, confira
`deploy/maintenance.sh status`: um deploy interrompido com `kill -9` pode ter deixado
o flag ligado.

1. `dcp ps`: algum serviço `exited`, `restarting` ou `unhealthy`?
2. Veja o motivo: `dcp logs --tail 200 <serviço>`.
   - `OOMKilled` / memória: `docker inspect -f '{{.State.OOMKilled}}' filtrovali-backend`.
   - Erro de env (`DATABASE_URL`, segredo ausente): o backend falha no boot de
     propósito. Corrija `backend/.env.production` e **recrie**: `dcp up -d backend worker`
     (`restart` não relê o env-file).
3. Suba de novo o que caiu: `dcp up -d backend worker nginx`.
4. Se o site continua fora, mas `dcp ps` está saudável, o problema está no proxy
   compartilhado (Caddy): `docker compose -f ../infra-proxy/docker-compose.yml ps`
   e `deploy/INFRA-PROXY.md`.
5. Certificado vencido: veja `deploy/PRODUCTION.md`, seção "Certificado".
6. Se começou depois de um deploy, vá direto para a seção 3.

Modo manutenção (página estática enquanto corrige): `deploy/PRODUCTION.md`,
seção "Modo manutenção".

---

## 2. Banco fora do ar ou disco cheio

```bash
dcp exec -T postgres pg_isready -U postgres -d filtrovali
dcp logs --tail 200 postgres
df -h / /var/lib/docker
docker system df
du -sh /root/backups/filtrovali/* 2>/dev/null | sort -h | tail
```

- **Disco cheio** (o Postgres para de aceitar escrita):
  1. backups locais antigos: o cron mantém 2 (`LOCAL_BACKUP_KEEP=2`); remova
     pastas `/root/backups/filtrovali/20*` mais antigas **só depois** de conferir
     que a cópia equivalente está no B2 (`b2 ls b2://filtrovali-backups/daily/`);
  2. dumps de pré-deploy: `/root/backups/filtrovali/pre-deploy` (mantém 3);
  3. imagens Docker antigas: `docker image ls 'filtrovali-*'` e
     `docker image rm` das tags de commit que não são `previous` nem a atual;
     `docker builder prune` libera o cache de build;
  4. logs de container grandes: `du -sh /var/lib/docker/containers/*/*-json.log | sort -h | tail`.
- **Muitas conexões**: o pool é limitado (8 no backend, 2 no worker). Veja quem
  está conectado:

  ```bash
  dcp exec -T postgres psql -U postgres -d filtrovali -c \
    "SELECT usename, application_name, state, count(*) FROM pg_stat_activity GROUP BY 1,2,3 ORDER BY 4 DESC;"
  ```

- **Banco não sobe** (arquivo corrompido, volume perdido): não apague o volume
  `filtrovali_pgdata`; restaure em paralelo (seção 4) e só troque depois de conferir.
- Depois que o banco voltar: `dcp up -d backend worker` e confira a seção 0.

---

## 3. Deploy ruim: voltar de versão

Como você fica sabendo: aviso no Telegram na hora (o `deploy-prod.sh` avisa
`FAILURE` e `ROLLED_BACK`), card "Último deploy" no painel de Operações e e-mail do
job de status operacional na próxima verificação. O estado fica em
`/root/backups/filtrovali/status/deploy-latest.json` até o próximo deploy com
sucesso.

O deploy padrão é `deploy/deploy-prod.sh` (veja `deploy/PRODUCTION.md`,
"Deploy versionado e volta de versão"). Ele já volta sozinho quando a conferência
pós-deploy falha. Para voltar manualmente:

```bash
deploy/deploy-prod.sh --rollback                 # imagens que estavam no ar antes do último deploy
docker image ls filtrovali-backend               # commits disponíveis localmente
deploy/deploy-prod.sh --rollback-to <sha>        # uma versão específica
deploy/deploy-prod.sh --rollback-to before-rollback   # desfaz a volta
```

A volta troca **código** (backend, worker, frontend) sem build e sem migrations.
As migrations só andam para frente; o código anterior continua funcionando
quando a migration nova só acrescentou tabelas ou colunas (o padrão do projeto).

**Se a migration nova apagou ou reescreveu dados**, a volta de dados é o dump
feito pelo próprio deploy, segundos antes de subir a versão nova:

```bash
ls -1 /root/backups/filtrovali/pre-deploy/        # escolha o dump do deploy com problema
# Para tudo que grava, restaura só o banco e volta o código anterior:
dcp stop backend worker
BACKUP_SOURCE=/root/backups/filtrovali/pre-deploy/<timestamp> \
  RESTORE_REPORTS=false RESTORE_CERTS=false RESTORE_PROXY=false REQUIRE_CHECKSUMS=true \
  deploy/restore-prod.sh
deploy/deploy-prod.sh --rollback
```

O que foi gravado entre o deploy e o restore se perde: avise os usuários e
registre no incidente. Antes de publicar a correção, deixe o checkout no commit
bom (`git checkout <sha-anterior>` ou um revert no Git) para o próximo deploy não
repetir a migration ruim.

Sem `deploy/deploy-prod.sh` (primeiro uso, script indisponível), o caminho manual
continua em `deploy/PRODUCTION.md`, "Subida em produção".

---

**Deploy com migration contract** (apaga/renomeia/muda tipo; o script pediu
`--allow-contract`): a volta de código pode não funcionar com o schema novo. Se a
versão anterior falhar depois da volta, restaure o dump pré-deploy em
`/root/backups/filtrovali/pre-deploy` (seção 4a) e volte o código com
`deploy/deploy-prod.sh --rollback`.

## 4. Restaurar backup

Backups: a cada 5 h local (`/root/backups/filtrovali/<timestamp>`, mantém 2),
diário em `b2://filtrovali-backups/daily/<timestamp>` e mensal em
`b2://filtrovali-backups/monthly/<timestamp>`. O ensaio mensal
(`deploy/restore-drill.sh`) prova que o último backup diário restaura; o
resultado aparece no painel de Operações e em
`/root/backups/filtrovali/status/restore-latest.json`.

### 4a. Mesmo servidor, banco/arquivos danificados

```bash
ls -1 /root/backups/filtrovali/                 # escolha o backup local
BACKUP_SOURCE=/root/backups/filtrovali/<timestamp> deploy/restore-prod.sh
```

O script confere os checksums, restaura relatórios, certificados e banco (nesta
ordem) e só então sobe a aplicação. Detalhes e restore parcial: `deploy/BACKUP.md`.

### 4b. Backup só no B2 (local perdido ou servidor novo)

```bash
source /root/.config/newrdo-backup/b2.env && b2 account authorize   # credenciais de leitura
b2 ls b2://filtrovali-backups/daily/
mkdir -p /root/restore && b2 sync b2://filtrovali-backups/daily/<timestamp> /root/restore/<timestamp>
BACKUP_SOURCE=/root/restore/<timestamp> RESTORE_PROXY=true deploy/restore-prod.sh
```

Servidor novo: antes, instale Docker, clone o repositório, recupere
`backend/.env.production` do cofre e crie volumes e redes externos como em
`deploy/PRODUCTION.md` e `deploy/INFRA-PROXY.md`. Tempo de referência do restore
do banco: veja `sanity.restoreSeconds` no último `restore-latest.json`.

---

## 5. Trocar credencial (vazamento ou rotina)

1. Gere o valor novo direto no provedor/cofre. Não cole valores em chat,
   chamado, commit ou log.
2. Atualize `backend/.env.production` (guarde uma cópia:
   `cp -p backend/.env.production backend/.env.production.bak-$(date +%Y%m%d%H%M)`).
3. Recrie os serviços que leem o env-file: `dcp up -d backend worker`.
4. Confirme que a integração voltou e que o valor antigo foi **revogado** no provedor.

| Credencial | Variável | Onde revogar/gerar |
|---|---|---|
| Senha do Postgres (dono) | `POSTGRES_PASSWORD` + senha em `DATABASE_URL`/`MIGRATION_DATABASE_URL` | `dcp exec -T postgres psql -U postgres -c "\password postgres"` |
| Papel da aplicação (se ativo) | senha em `DATABASE_URL` | `deploy/db/apply-app-role.sh --password-file <arquivo novo>` |
| E-mail (Microsoft 365) | `MICROSOFT_CLIENT_SECRET` | Entra ID → App registrations (veja `docs/OUTLOOK_OAUTH2.md`) |
| OpenAI | `OPENAI_API_KEY` | platform.openai.com → API keys |
| Omie | `OMIE_APP_KEY`, `OMIE_APP_SECRET` | painel do desenvolvedor Omie |
| Conecta RH | `CONECTA_RH_READ_TOKEN` | equipe do Conecta |
| ComercialAPP | `COMERCIALAPP_SERVICE_TOKEN` | trocar nos dois sistemas juntos |
| Pontomais | `PONTOMAIS_API_TOKEN` | painel Pontomais |
| Tokens da API de integrações (`fva_…`) | — | `docs/OPERACOES.md` |
| Segredos de link (`SIGNATURE_TOKEN_SECRET`, `SURVEY_TOKEN_SECRET`) | ver `deploy/PRODUCTION.md` | use `*_PREVIOUS` para não invalidar links já enviados |
| B2 (backup) | `/root/.config/newrdo-backup/b2.env` | Backblaze → App Keys; rode `b2 account authorize` de novo |

Se o vazamento envolver dados pessoais, siga também
`LGPD_PROCEDIMENTO_TITULARES_INCIDENTES.md` (prazo de comunicação à ANPD).

---

## 6. Serviço externo parado

O filtroAPP continua no ar sem esses serviços; o objetivo é conter o efeito e
saber quando voltou.

| Serviço | Sintoma | O que fazer |
|---|---|---|
| **Omie** | painel de Operações: "Sincronização Omie falhou" | Nada se perde: o próximo ciclo retoma. Se a falha persistir horas ou travar o worker, desligue com `OMIE_SYNC_ENABLED=false` e `dcp up -d worker`; religue depois. |
| **Conecta RH** | alocações/colaboradores sem atualizar | Confira o status do Conecta com a equipe deles; os eventos têm deduplicação, então reprocessar depois é seguro. |
| **ZapSign** | assinatura avulsa não envia/retorna | Os documentos ficam pendentes; avise os usuários; reenvie depois que voltar. |
| **OpenAI** | "adequar anotações" / revisão do Data Book falha | Funcionalidade auxiliar: os usuários seguem sem ela. Conferir a chave e o limite de gasto no painel da OpenAI. |
| **E-mail (SMTP/Microsoft)** | e-mails de assinatura/liberação não chegam | A fila `ReportEmailJob` guarda e tenta de novo sozinha (espera crescente). Consulta em `deploy/PRODUCTION.md`, "Entrega dos e-mails". Não reenvie à mão: o worker retoma. |

Para ver o erro de cada integração: `dcp logs --since 2h worker | grep -i <omie|conecta|zapsign|openai|smtp>`.

---

## Registro do incidente

Todo incidente com impacto para usuário gera um registro em
`docs/incidentes/AAAA-MM-DD-titulo-curto.md`, no mesmo dia, com:

```markdown
# <título curto>
- Início / detecção / fim (horários):
- Quem detectou e como (alerta, usuário, painel):
- Impacto (quem foi afetado, o que ficou indisponível, dados perdidos?):
- Linha do tempo (o que foi feito, em ordem):
- Causa raiz:
- Correção aplicada (commit/PR):
- O que muda para não repetir (ação, responsável, prazo):
```

Sem dados pessoais nem segredos no registro.
