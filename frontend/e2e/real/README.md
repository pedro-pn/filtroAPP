# Jornadas ponta a ponta reais (spec 040)

Navegador → bundle de produção (`vite preview`) → backend real (`node src/server.js`) →
PostgreSQL real, com o e-mail do 2FA capturado pelo [Mailpit](https://mailpit.axllent.org/).
Nenhuma resposta da API é simulada (um teste de guarda falha se aparecer `page.route`).

| Jornada | Arquivo | Prova |
|---|---|---|
| Login ADMIN + 2FA por e-mail | `login-2fa.real.spec.ts` | 4.1: sessão só depois do código; código errado recusado; navegador lembrado dispensa o código |
| RDO do rascunho ao PDF | `rdo-pdf.real.spec.ts` | fluxo principal: `POST /api/rdo/reports` grava no banco; PDF do backend é válido e traz o projeto |
| Permissão negada | `permission-denied.real.spec.ts` | 5.1: colaborador recebe 403 da API para RDO de outro projeto e não entra na gestão |

No CI roda no job **E2E (real stack)** (informativo até 10 execuções seguidas sem falha).

## Rodar localmente

Precisa de um PostgreSQL com um banco **descartável terminado em `_e2e`** e do Mailpit
(SMTP 1025, HTTP 8025). Na raiz do repositório:

```bash
export E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/filtrovali_e2e
export E2E_SEED_OUTPUT="$PWD/output/e2e-real/seed.json"
(cd backend && DATABASE_URL="$E2E_DATABASE_URL" npm run prisma:deploy && DATABASE_URL="$E2E_DATABASE_URL" npm run e2e:seed)
(cd frontend && npm run build && npm run test:e2e:real)
```

A jornada do PDF precisa do LibreOffice no backend (`soffice` no PATH ou
`LIBREOFFICE_BINARY`). No CI o backend roda da imagem de produção
(`backend/Dockerfile`), que já o traz, e o Playwright só sobe o `vite preview`
(`E2E_BACKEND_EXTERNAL=1`).

O seed (`backend/prisma/e2e-seed.js`) só cria dados fictícios e recusa bancos que não
terminem em `_e2e`. O relatório e os traces ficam em `output/e2e-real/`.

Próximas jornadas: Efetivo (missão e alocação) num segundo PR; Data Book só se o job
continuar abaixo de ~3 min.
