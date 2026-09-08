# filtroboard — contrato de hospedagem na VPS

Documento para o time que desenvolve o **filtroboard**. Descreve o que a
infraestrutura já entrega pronto e o que o app precisa cumprir para funcionar.

O filtroboard roda **isolado** do filtroAPP: daemon Docker próprio, usuário próprio,
banco próprio. O único ponto compartilhado é o proxy reverso que atende as portas
80/443 da VPS.

---

## O que já está pronto

Nada disto precisa ser feito pelo time do filtroboard:

| Item | Estado |
|---|---|
| Usuário `victor` com acesso SSH | pronto |
| Docker rootless (daemon próprio do usuário) | pronto e validado |
| Containers sobem sozinhos no boot (`linger`) | pronto e validado |
| DNS `filtroboard.filtrovali.com.br` → VPS | pronto |
| HTTPS, certificado e renovação automática | pronto (infra-proxy) |
| Roteamento do domínio até o app | pronto |

O HTTPS é terminado pelo proxy. **O app nunca vê TLS** e não precisa de certificado.

---

## O contrato

Quatro regras. O roteamento já está configurado para elas; mudá-las exige alteração
no repositório do filtroAPP.

### 1. Escutar HTTP puro

O proxy entrega a requisição em texto puro na rede interna. Não configure TLS,
não redirecione para `https://` — o proxy já faz isso antes de chegar no app.
Um redirect para HTTPS dentro do app criaria um loop infinito.

### 2. Publicar em `172.17.0.1:8081`

```yaml
ports:
  - "172.17.0.1:8081:3000"   # 3000 = porta que o app escuta no container
```

`172.17.0.1` é o gateway da bridge do Docker: alcançável pelo proxy, inalcançável
pela internet. **Não publique em `0.0.0.0`** — isso exporia o app sem HTTPS
diretamente na internet, contornando o proxy.

A porta `8081` está fixada no proxy. Trocar exige PR no repositório do filtroAPP.

### 3. Confiar nos headers encaminhados

O IP real do cliente e o esquema original chegam em headers, não na conexão:

| Header | Conteúdo |
|---|---|
| `X-Forwarded-For` | IP real do cliente |
| `X-Forwarded-Proto` | `https` |
| `X-Forwarded-Host` | `filtroboard.filtrovali.com.br` |

Se o app fizer rate limit por IP, log de acesso ou registro de auditoria, ele
**precisa** ler o `X-Forwarded-For`. Caso contrário todos os usuários aparecerão
com o mesmo IP — o do proxy — e compartilharão o mesmo balde de rate limit.

Em Express: `app.set('trust proxy', 'uniquelocal')`.

### 4. Portas abaixo de 1024 não funcionam

Limitação do Docker rootless. Irrelevante na prática: quem atende 80/443 é o proxy.

---

## Como subir

O daemon rootless tem um socket próprio. Sem esta variável, o `docker` tentaria
falar com o daemon root — ao qual o usuário `victor` não tem acesso:

```bash
export DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock
```

Já está no `.bashrc` do usuário. Confirme com `docker info | grep -i rootless`.

### Template de compose

```yaml
name: filtroboard

services:
  app:
    image: registry.exemplo/filtroboard:1.0.0   # tag imutavel, nunca :latest
    restart: unless-stopped
    depends_on: [postgres]
    ports:
      - "172.17.0.1:8081:3000"
    environment:
      DATABASE_URL: postgres://filtroboard:${POSTGRES_PASSWORD}@postgres:5432/filtroboard
    mem_limit: 1g
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
    # sem `ports`: o banco so e alcancavel de dentro deste stack

volumes:
  filtroboard_pgdata:

networks:
  filtroboard-net:
```

```bash
docker compose up -d
docker compose logs -f app
```

---

## Responsabilidades do time

**Backup do banco.** O backup do filtroAPP **não** cobre o filtroboard — é outro
daemon, outro usuário, outro banco. Um `pg_dump` num timer de usuário resolve
(o `linger` já está ativo, então timers `--user` funcionam sem sessão aberta):

```bash
systemctl --user edit --force --full filtroboard-backup.timer
```

**Espaço em disco.** Volumes do rootless ficam em
`/home/victor/.local/share/docker/volumes/`, não em `/var/lib/docker`. Acompanhe
com `df -h /home` antes de crescer o banco.

**Limites de memória.** Mantenha o `mem_limit` em todos os serviços. É o que impede
um vazamento no filtroboard de causar OOM e derrubar o filtroAPP junto.

**Tags de imagem imutáveis.** Nunca `:latest` — sem isso não há como saber o que
está rodando nem como voltar atrás.

---

## O que não fazer

- **Não use `sudo docker`.** Esse é o daemon root, onde vive o filtroAPP. O daemon
  do filtroboard é o do próprio usuário, sem `sudo`.
- **Não publique em `0.0.0.0`.** Exporia o app sem HTTPS, contornando o proxy.
- **Não mexa fora de `/home/victor`.**

---

## Verificação

```bash
# 1. o app responde localmente
curl -sSI http://172.17.0.1:8081/

# 2. o dominio responde com HTTPS valido
curl -sSI https://filtroboard.filtrovali.com.br/

# 3. o app enxerga o cliente real (ajuste a rota)
docker compose logs app | tail -20
```

Enquanto o app não estiver de pé, o domínio responde **502**. É esperado: o
certificado é emitido de qualquer forma, mas não há nada escutando na 8081.

---

## Quando precisar de mudança no proxy

Estes itens vivem no repositório do filtroAPP (`deploy/infra-proxy/Caddyfile`) e
precisam de PR:

- domínio ou subdomínio novo
- porta diferente da 8081
- limite de tamanho de upload específico

WebSockets e uploads grandes já funcionam sem configuração adicional.
