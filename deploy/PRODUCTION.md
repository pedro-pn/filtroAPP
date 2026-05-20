# Produção

Este repositório agora tem o esqueleto inicial de produção:

- `docker-compose.prod.yml`
- `backend/Dockerfile`
- `deploy/nginx/Dockerfile`
- `backend/.env.production`
- `deploy/nginx/default.conf`

## O que já está pronto

- PostgreSQL isolado na rede interna Docker
- Backend sem porta exposta diretamente ao host
- Nginx como único serviço exposto em `80/443`
- Volumes nomeados para banco, relatórios, assets e certificados
- Frontend React compilado no build da imagem do nginx
- SPA React servida pelo nginx, com proxy para `/api`, `/assets`, `/uploads` e `/relatorios`

Na homologação atual, os assets padrão da aplicação são servidos da própria
imagem do backend. Por isso o `docker-compose.prod.yml` não monta um volume
separado em `/data/assets`.

## Frontend React

O cutover para React em produção é feito pelo nginx:

- `deploy/nginx/Dockerfile` compila `frontend/` com `npm run build`
- o resultado de `frontend/dist` é copiado para `/usr/share/nginx/html`
- `deploy/nginx/default.conf` usa `try_files` para rotas da SPA
- chamadas `/api`, arquivos `/assets`, `/uploads` e `/relatorios` continuam no backend

## Conversão DOCX -> PDF em produção

O backend agora suporta dois caminhos:

- Windows: Microsoft Word via COM/PowerShell
- Linux: LibreOffice headless (`soffice`)

No container de produção, o `Dockerfile` já instala `LibreOffice Writer`
e o exemplo de ambiente define:

```env
LIBREOFFICE_BINARY=/usr/bin/soffice
```

Isso remove o bloqueio principal que existia para o `P3`.

## Caminho recomendado

1. Validar a stack Docker em um ambiente de homologação
2. Confirmar que os PDFs gerados no Linux mantêm a formatação esperada
3. Só então subir a stack final no Windows Server com WSL2

## Subida inicial em homologação

1. Preencher `backend/.env.production` com segredos e URLs reais
   - Definir `TRUST_PROXY=uniquelocal` para a stack Docker com Nginx, ou CIDRs explícitos da rede/proxy confiável.
2. Definir `POSTGRES_PASSWORD` no shell/ambiente antes do compose
3. Subir:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

4. Aplicar migrations:

```bash
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
```

5. Popular dados iniciais de homologação, incluindo usuários de login:

```bash
docker compose -f docker-compose.prod.yml exec backend npx prisma db seed
```

## Certificado

O `nginx` já está preparado para servir o domínio final
`relatorios.filtrovali.com.br`, mas o certificado ainda precisa ser emitido
no servidor antes do `443` ficar operacional.

## Backup

Não existe rotina automática de backup embutida no compose de produção.
Os dados ficam persistidos localmente nos volumes Docker:

- `filtrovali_pgdata`
- `filtrovali_relatorios`

Para backup operacional do servidor, use:

- `deploy/backup-prod.sh`
- `deploy/BACKUP.md`

O fluxo recomendado é:

1. `pg_dump` do PostgreSQL
2. compactação do volume `filtrovali_relatorios`
3. cópia para S3 ou outro destino externo
4. snapshot periódico do disco EBS
