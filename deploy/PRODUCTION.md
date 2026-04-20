# Produção

Este repositório agora tem o esqueleto inicial de produção:

- `docker-compose.prod.yml`
- `backend/Dockerfile`
- `backend/.env.production.example`
- `deploy/nginx/default.conf`

## O que já está pronto

- PostgreSQL isolado na rede interna Docker
- Backend sem porta exposta diretamente ao host
- Nginx como único serviço exposto em `80/443`
- Volumes nomeados para banco, relatórios, assets e certificados

Na homologação atual, os assets padrão da aplicação são servidos da própria
imagem do backend. Por isso o `docker-compose.prod.yml` não monta um volume
separado em `/data/assets`.

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

1. Copiar `backend/.env.production.example` para `backend/.env.production`
2. Preencher segredos e URLs reais
3. Definir `POSTGRES_PASSWORD` no shell/ambiente antes do compose
4. Subir:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

5. Aplicar migrations:

```bash
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
```

6. Popular dados iniciais de homologação, incluindo usuários de login:

```bash
docker compose -f docker-compose.prod.yml exec backend npx prisma db seed
```

## Certificado

O `nginx` já está preparado para servir o domínio final
`app.filtrovali.com.br`, mas o certificado ainda precisa ser emitido
no servidor antes do `443` ficar operacional.
