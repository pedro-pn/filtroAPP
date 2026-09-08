# Runbook — migração para o infra-proxy (Caddy)

Move as portas 80/443 do `filtrovali-nginx` para um proxy reverso único, para que
outros apps possam viver na mesma VPS com domínios próprios.

**Janela de indisponibilidade esperada:** 20–40s do filtroAPP.
**Executar como root, na VPS.** Faça em horário de baixo uso.

---

## Antes de começar

### 1. O que muda

| Antes | Depois |
|---|---|
| `filtrovali-nginx` publica 80/443 e termina TLS | `infra-proxy-caddy` publica 80/443 e termina TLS |
| Certbot manual renova o certificado | Caddy emite e renova sozinho |
| nginx redireciona HTTP→HTTPS | Caddy redireciona; nginx serve só HTTP interno |

### 2. Checagens obrigatórias

```bash
# a) DNS de app. e relatorios. ja apontam para esta VPS?
dig +short app.filtrovali.com.br
dig +short relatorios.filtrovali.com.br

# b) Existe renovacao de certbot agendada? Ela vai brigar pela porta 80.
crontab -l | grep -i certbot
systemctl list-timers | grep -i certbot
ls /etc/cron.d/ | grep -i certbot

# c) Backup do banco antes de qualquer mexida
/caminho/para/deploy/backup-prod.sh
```

Se houver cron/timer de certbot, **desative agora** (comente a linha / `systemctl disable --now`).
O Caddy assume a emissão; deixar os dois ativos causa falha de renovação.

### 3. Faça só o filtroAPP nesta janela

*(Etapa concluída em 2026-08-24.)* Na migração original o bloco
`filtroboard.filtrovali.com.br` ficou comentado de propósito, para a janela ter uma
variável só. Vale a mesma regra ao acrescentar qualquer domínio novo: **publique o DNS
antes**. Um domínio sem DNS faz o Caddy tentar emitir certificado e falhar
repetidamente — não derruba os outros sites, mas polui o log e queima tentativas de
validação no Let's Encrypt (5 falhas por hostname por hora).

---

## Execução

```bash
cd /caminho/do/filtroAPP
git fetch && git checkout feat/infra-proxy-multiapp

# 1. Rede compartilhada entre o proxy e o filtroAPP
docker network create proxy-net

# 2. Baixar a imagem ANTES da janela (evita download com o site fora do ar)
docker compose -f deploy/infra-proxy/docker-compose.yml pull

# 3. Validar as configs antes de aplicar
docker compose -f docker-compose.prod.yml config -q
docker run --rm -v "$PWD/deploy/infra-proxy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.8-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# --- INICIO DA JANELA ---

# 4. Recria o nginx sem as portas 80/443 e ja na proxy-net
docker compose -f docker-compose.prod.yml up -d nginx

# 5. Sobe o proxy, que assume 80/443 e emite os certificados
docker compose -f deploy/infra-proxy/docker-compose.yml up -d

# 6. Acompanhe a emissao do certificado (deve levar poucos segundos)
docker logs -f infra-proxy-caddy
# procure por: "certificate obtained successfully"

# --- FIM DA JANELA ---
```

## Verificação

```bash
# HTTPS respondendo e certificado valido
curl -sSI https://app.filtrovali.com.br/ | head -3

# Redirect HTTP->HTTPS pelo Caddy
curl -sSI http://app.filtrovali.com.br/ | grep -i location

# Redirect do dominio antigo
curl -sSI https://relatorios.filtrovali.com.br/ | grep -i location   # -> /rdo

# API viva
curl -sS https://app.filtrovali.com.br/health

# nginx NAO deve mais aparecer com portas publicadas
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E 'nginx|caddy'
```

No navegador, valide o que os testes de curl não pegam: **login**, um upload
(`client_max_body_size`) e a geração de um relatório.

### Sinais de que algo deu errado

| Sintoma | Causa provável |
|---|---|
| `ERR_TOO_MANY_REDIRECTS` | `default.conf` antigo ainda tem `return 301 https://` |
| Caddy não obtém certificado | Porta 80 ocupada (nginx antigo ou certbot) ou DNS errado |
| Cookies de sessão caem no login | `X-Forwarded-Proto` chegando como `http` — conferir o `map $fwd_proto` |
| Logs do backend com IP do proxy | `set_real_ip_from` não pegou a faixa da rede |

---

## Rollback

O `default.conf` é bind-mount, não está embutido na imagem — então voltar **não exige
rebuild** e leva segundos.

```bash
cd /caminho/do/filtroAPP

# 1. Derruba o proxy, liberando 80/443
docker compose -f deploy/infra-proxy/docker-compose.yml down

# 2. Volta config e compose para o estado anterior
git checkout main -- deploy/nginx/default.conf docker-compose.prod.yml

# 3. Recria o nginx com as portas e o TLS de antes
docker compose -f docker-compose.prod.yml up -d nginx

# 4. Confirma
curl -sSI https://app.filtrovali.com.br/ | head -3
```

O volume `filtrovali_certs` continua montado no nginx justamente para isto: o
certificado antigo do certbot segue lá, válido, durante toda a migração. Só remova
essa montagem depois de algumas semanas de operação estável no Caddy.

---

## Depois da migração

### Buffer UDP para o HTTP/3

O Caddy escuta HTTP/3 na UDP/443 (publicada no compose). O kernel entrega por padrão
um buffer de recepção pequeno demais e o Caddy avisa no log:

```
failed to sufficiently increase receive buffer size (was: 208 kiB, wanted: 7168 kiB)
```

Não quebra nada — o HTTP/3 funciona com throughput menor. Para resolver:

```bash
sysctl -w net.core.rmem_max=7500000
echo 'net.core.rmem_max=7500000' > /etc/sysctl.d/99-caddy-quic.conf
docker restart infra-proxy-caddy   # o aviso deve sumir do log
```

### Checklist

- [ ] `net.core.rmem_max` ajustado (acima)
- [ ] Certbot desativado (cron/timer) e documentado no `deploy/PRODUCTION.md`
- [ ] `deploy/PRODUCTION.md` atualizado: nginx não é mais o serviço exposto
- [ ] Backup do volume `infra_proxy_data` (guarda chaves e certificados do Caddy)
- [ ] Só então: liberar o bloco do app do outro setor no `Caddyfile`

---

## Apêndice — filtroboard (Docker rootless)

Roda sob o usuário `victor`, em daemon próprio. Ele **não** tem acesso ao daemon root
nem aos containers do filtroAPP. Banco próprio, volume próprio, backup próprio.

```yaml
# compose do filtroboard — rodado como victor, NAO como root
name: filtroboard

services:
  app:
    image: registry.exemplo/filtroboard:1.4.2   # tag imutavel, nunca :latest
    restart: unless-stopped
    depends_on: [postgres]
    ports:
      # Gateway da bridge do daemon root: alcancavel pelo Caddy,
      # inalcancavel de fora da VPS. Confirme com: ip -4 addr show docker0
      - "172.17.0.1:8081:3000"
    mem_limit: 1g          # protecao contra OOM afetar o filtroAPP
    networks: [filtroboard-net]

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: filtroboard
      POSTGRES_USER: filtroboard
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - filtroboard_pgdata:/var/lib/postgresql/data
    mem_limit: 1g
    networks: [filtroboard-net]
    # sem `ports`: so a rede interna deste stack alcanca o banco

volumes:
  filtroboard_pgdata:

networks:
  filtroboard-net:
```

Para subir, o `DOCKER_HOST` precisa apontar para o socket do rootless:

```bash
# como victor
export DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock
docker compose up -d
```

### Backup próprio

O `deploy/backup-prod.sh` do filtroAPP **não** cobre este banco e não deve cobrir.
Como o linger está ativo, um timer `--user` resolve:

```bash
# como victor: systemctl --user edit --force --full filtroboard-backup.timer
```

### Cuidados específicos do rootless

- Volumes ficam em `/home/victor/.local/share/docker/volumes/`, **não** em
  `/var/lib/docker`. Confira o espaço livre em `/home` antes de subir o Postgres.
- O IP de origem se perde no port-forward do RootlessKit; o app deve confiar no
  `X-Forwarded-For` que o Caddy envia.
- Portas < 1024 não sobem no rootless. Não é problema: quem tem 80/443 é o Caddy.
