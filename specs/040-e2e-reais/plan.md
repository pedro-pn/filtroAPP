# Plan: Testes ponta a ponta reais (040)

## Abordagem

### Infra de teste
- **Seed** `backend/prisma/e2e-seed.js` (novo, separado do `seed.js` de desenvolvimento):
  1 ADMIN com e-mail (2FA), 1 MANAGER, 1 COLLABORATOR sem acesso ao projeto B, 2 projetos
  (A com equipe, B sem o colaborador), colaboradores/equipamentos mínimos e sequências de
  relatório. Idempotente, senhas ≥ 10 caracteres. Reaproveita `hashPassword`,
  `moduleRoleRows` e `accountTypeForLegacyRole` como o `seed.js`.
- **Orquestração** `frontend/playwright.real.config.ts`: `webServer` com dois processos
  (backend em `:4100` com `NODE_ENV=test`, `TWO_FACTOR_ENFORCEMENT=on`,
  `SMTP_HOST=127.0.0.1:1025`, `SEND_CLIENT_EMAILS=true`, `REPORTS_DIR` temporário,
  `BACKGROUND_JOBS_IN_API=false`; e `vite preview` em `:4193` com
  `VITE_API_PROXY_TARGET=http://127.0.0.1:4100`), `retries: 0`, `workers: 1`,
  `forbidOnly`, `trace: retain-on-failure`.
- **Ajudantes** `frontend/e2e/real/support/`: `mailbox.ts` (lê o último código da API do
  Mailpit, com espera ativa limitada a 10 s), `login.ts` (login + 2FA reutilizável,
  `storageState` por papel salvo uma vez por execução), `pdf.ts` (valida `%PDF-` e conta
  páginas com `pdf-lib`, já dependência do backend; no frontend usar a mesma lib ou um
  parser mínimo).
- **Specs** `frontend/e2e/real/*.real.spec.ts` — uma por jornada; nenhum `page.route`
  (um teste de guarda falha se aparecer `page.route` nessa pasta).

### CI (`.github/workflows/ci.yml`, pipeline do #611)
- Job novo **`e2e-real`** (`name: E2E (real stack)`), `runs-on: ubuntu-24.04`,
  `timeout-minutes: 8`, `needs: []` (paralelo).
  - `services`: `postgres:16` e `axllent/mailpit` (SMTP 1025, HTTP 8025).
  - Passos: checkout → node 24 + cache de `node_modules` (backend e frontend, mesmas chaves
    do #611) → `prisma migrate deploy` → `node prisma/e2e-seed.js` → build do frontend
    (ou baixar o `dist` do `frontend-unit` como artefato — D3) → Chromium do cache com a
    sonda do #610 → `npx playwright test --config=playwright.real.config.ts`.
  - Artefatos em falha: `output/playwright/real/`, log do backend, `mailpit` dump.
- Entra no agregador? **Não** — check próprio, para o nome aparecer na proteção da `main`
  (D1). O teste `ci-db-suite-coverage` não é afetado (não usa suíte guardada por env).

### Estimativa de tempo do job
| Etapa | Estimativa |
|---|---|
| Serviços + checkout + node (cache quente) | 25–35 s |
| `migrate deploy` (≈265 migrations) + seed | 25–40 s |
| Build do frontend (ou download do artefato) | 30–45 s (5–10 s) |
| Chromium (cache + sonda) | 2–5 s |
| Jornadas 1–4 | 45–75 s |
| **Total** | **≈ 2,5–3,5 min** |

## Fases e esforço

| Fase | Entrega | Esforço |
|---|---|---|
| F1 | Seed e2e, config Playwright real, ajudantes, Jornada 1 (login + 2FA) local | 1 dia |
| F2 | Job `e2e-real` no CI com Postgres + Mailpit; artefatos | 0,5 dia |
| F3 | Jornadas 2 (RDO → PDF) e 4 (permissão negada) | 1 dia |
| F4 | Jornada 3 (Efetivo) | 0,5 dia |
| F5 | 10 execuções seguidas sem falha → check obrigatório | 0,5 dia (+ observação) |
| F6 (opc.) | Jornada 5 (Data Book) se couber no orçamento | 0,5 dia |

Total: **3,5–4 dias** (sem F6).

## Riscos e mitigação

- **Instabilidade** (pilar 2.3): sem retries; esperas por estado da UI/API (nunca
  `waitForTimeout`); banco novo por execução; relógio fixo onde houver data. Falha
  intermitente vira correção na causa antes de tornar o check obrigatório.
- **Tempo de migrations** cresce com o histórico: medir; se passar de 60 s, avaliar
  `prisma migrate diff`/schema snapshot (fora deste escopo).
- **Mailpit indisponível** no Docker Hub: imagem fixada por versão; alternativa é um SMTP
  mínimo em Node no próprio job (sem dependência nova no app).
- **Permissões mudam com frequência**: a jornada 4 usa papéis estáveis (COLLABORATOR fora
  do projeto) para não quebrar a cada ajuste fino de módulo.
- **Dados de seed divergirem do app**: o seed usa as mesmas funções do domínio e roda
  depois de todas as migrations; quebra no seed é sinal real de regressão.

## Fora do escopo

Teste de carga (11.4), testes visuais, cobertura de todas as telas, homologação.

## Decisões para o usuário

1. **D1 — Tornar o job obrigatório na `main`?**
   a) Sim, depois de 10 execuções seguidas sem falha *(recomendado)*;
   b) sim desde o primeiro dia; c) não, só informativo.
2. **D2 — Quais jornadas no primeiro PR?**
   a) Login+2FA, RDO→PDF e permissão negada; Efetivo no segundo *(recomendado)*;
   b) as quatro de uma vez; c) só login+2FA e RDO→PDF.
3. **D3 — Frontend do e2e:**
   a) reaproveitar o `dist` do job `frontend-unit` como artefato (mais rápido, mesmo bundle)
   *(recomendado)*; b) buildar de novo no job e2e (independente, +30–45 s).
4. **D4 — Data Book no e2e?**
   a) Não agora; só se o job ficar abaixo de 3 min *(recomendado)*; b) sim, no primeiro PR.
5. **D5 — Captura do e-mail do 2FA:**
   a) Mailpit como service container *(recomendado — zero código de teste no app)*;
   b) transporte de e-mail "arquivo" ativado por env no backend (mais simples, mas é
   código só de teste dentro do app).
