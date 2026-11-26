# Logs centralizados (critério 12.2)

Os logs dos contêineres `filtrovali-*` (produção, homologação e o próprio agente) vão para o
**Grafana Cloud** e ficam **14 dias** pesquisáveis no navegador. Eles continuam lá depois de um
deploy, de uma volta de versão ou de uma queda do servidor. No servidor, cada contêiner guarda
no máximo 100 MB de log (5 arquivos de 20 MB) para não encher o disco.

```
contêineres filtrovali-*  ──stdout──▶  Docker (json-file, rotação 5 × 20 MB)
                                          │ só leitura
                                docker-socket-proxy (rede interna, sem POST)
                                          │
                                 Grafana Alloy (máscara)  ──HTTPS──▶  Grafana Cloud (Loki)
```

Os arquivos ficam em `deploy/logs/`:
- `docker-compose.yml` é um projeto à parte (`filtrovali-logs`). O deploy e a volta de versão do
  app não recriam o agente, e o agente não para o app.
- `config.alloy` descobre os contêineres, coloca os rótulos e mascara os dados.
- `logs.env.example` é o modelo do `deploy/logs/.env`, que fica só no servidor e fora do git.

## O que é mascarado antes do envio

| Dado | Vira |
|---|---|
| E-mail | `<email>` |
| CPF formatado (`000.000.000-00`) | `<cpf>` |
| Senha em URL de conexão (`postgresql://usuario:senha@…`) | `<redacted>` |
| `Authorization: Bearer …` | `<token>` |
| Token da API de integração (`fva_…`) | `<api-token>` |
| `token=`, `key=`, `code=`, `password=`, `senha=`, `secret=`, `signature=` em URL | `<redacted>` |
| Linha `DETAIL: parameters:` do Postgres (valores de consulta lenta) | descartada |
| `GET /health` do healthcheck (a cada 15 s) | descartada |

O IP é mantido porque é ele que permite investigar abuso
([RUNBOOK_INCIDENTES.md](../docs/RUNBOOK_INCIDENTES.md), seção de segurança). O tratamento está
no [ROPA](../LGPD_ROPA.md), na linha "Logs técnicos da aplicação".

## Ativação (rode no servidor, uma vez)

**Não rode o comando de instalação que o Grafana Cloud mostra.** Ele instala o agente direto no
sistema do servidor e coleta também as métricas da máquina inteira. Desse comando só interessam
três valores:

| No comando do Grafana | No `deploy/logs/.env` |
|---|---|
| `GCLOUD_HOSTED_LOGS_URL="…"` | `GRAFANA_LOGS_URL=` (precisa terminar em `/loki/api/v1/push`) |
| `GCLOUD_HOSTED_LOGS_ID="…"` | `GRAFANA_LOGS_USER=` (um número) |
| `GCLOUD_RW_API_KEY="…"` | `GRAFANA_LOGS_TOKEN=` (começa com `glc_`) |

O token só precisa do escopo `logs:write`. Se o que você gerou tiver mais escopos, crie outro em
**Administration → Users and access → Cloud access policies** com só `logs:write` e use esse.

Rode no servidor, na pasta do repositório:

```bash
git pull --ff-only

# 1. Arquivo de credenciais, legível só pelo root.
install -m 600 deploy/logs/logs.env.example deploy/logs/.env
nano deploy/logs/.env        # cole os três valores; LOGS_HOST pode ficar como está

# 2. Sobe o agente e o proxy do Docker.
docker compose -f deploy/logs/docker-compose.yml up -d

# 3. Confere: os dois em "running" e nenhuma linha level=error depois de ~30 s.
docker compose -f deploy/logs/docker-compose.yml ps
docker logs --since 2m filtrovali-logs-agent 2>&1 | grep -E 'level=(error|warn)' || echo "sem erros"
```

**No Grafana Cloud:** abra **Explore**, escolha a fonte `grafanacloud-…-logs` e rode
`{env="production"}`. Em até um minuto aparecem as linhas do backend, do worker, do nginx e do
Postgres.

### Rotação dos logs no app (vem no próximo deploy)

A rotação está em `docker-compose.prod.yml` e `docker-compose.staging.yml`. Ela só vale para um
contêiner quando ele é recriado. O próximo `deploy-prod.sh` recria backend, worker e nginx, e
também **o Postgres, uma vez**: é uma parada de alguns segundos. Faça esse deploy fora do horário
de uso e com a página de manutenção:

```bash
git pull --ff-only && bash deploy/deploy-prod.sh --maintenance
```

Em homologação, recrie a stack inteira uma vez:

```bash
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml up -d
```

## Buscas úteis (LogQL)

| Pergunta | Busca |
|---|---|
| Erros 5xx do backend | `{env="production", service="backend"} \|= "[http-5xx]"` |
| Tudo de uma requisição | `{env="production"} \|= "<requestId>"` |
| Respostas 5xx no nginx | `{env="production", service="nginx"} \|~ "\" 5\\d\\d "` |
| Falhas de login | `{env="production", service="backend"} \|= "/api/auth/login" \|= " 401 "` |
| Erros do worker | `{env="production", service="worker"} \|~ "(?i)erro\|error\|falha"` |
| Consultas lentas do banco | `{env="production", service="postgres"} \|= "duration:"` |
| Homologação | troque `env="production"` por `env="staging"` |

Rótulos disponíveis: `env` (`production`, `staging`, `logs`), `service` (nome do serviço no
compose), `container`, `stream` (`stdout`/`stderr`) e `host`.

## Acesso e segurança

- Convide para a organização do Grafana Cloud só quem cuida da operação. Exija 2FA nas contas.
- O agente não acessa o socket do Docker. Quem acessa é o `docker-socket-proxy`, que só libera
  leitura de contêineres e redes (sem `POST`, `exec`, imagens ou volumes) e fica numa rede sem
  saída para a internet.
- Se o token vazar, revogue-o em **Cloud access policies**, gere outro, troque no
  `deploy/logs/.env` e rode `docker compose -f deploy/logs/docker-compose.yml up -d --force-recreate alloy`.

## Problemas comuns

| Sintoma no `docker logs filtrovali-logs-agent` | Causa |
|---|---|
| `401 Unauthorized` | `GRAFANA_LOGS_USER` ou `GRAFANA_LOGS_TOKEN` errado, ou token sem `logs:write` |
| `404 Not Found` | `GRAFANA_LOGS_URL` sem `/loki/api/v1/push` no fim |
| `429` ou `rate limit` | Cota do plano gratuito estourou: veja qual `service` gera mais em **Explore → Logs volume** |
| `Cannot connect to the Docker daemon` / `connection refused` em `docker-proxy` | O proxy não subiu: `docker logs filtrovali-logs-docker-proxy` |

**Desligar:** `docker compose -f deploy/logs/docker-compose.yml down`. Os logs locais do Docker
continuam funcionando normalmente.
