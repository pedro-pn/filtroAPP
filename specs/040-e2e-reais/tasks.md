# Tasks: Testes ponta a ponta reais (040)

- [ ] T001 `backend/prisma/e2e-seed.js` (ADMIN com e-mail, MANAGER, COLLABORATOR fora do projeto B, 2 projetos, dados mínimos) + teste de idempotência
- [ ] T002 `frontend/playwright.real.config.ts` (backend + `vite preview`, `retries: 0`, `forbidOnly`, traces)
- [ ] T003 Ajudantes `frontend/e2e/real/support/` (caixa de e-mail, login por papel com `storageState`, validação de PDF)
- [ ] T004 Guarda: teste que falha se houver `page.route` em `frontend/e2e/real/`
- [ ] T005 Jornada 1 — login ADMIN com 2FA e "lembrar navegador"
- [ ] T006 Job `e2e-real` ("E2E (real stack)") no CI com Postgres + Mailpit, caches do #610/#611, artefatos em falha
- [ ] T007 Jornada 2 — RDO do rascunho ao PDF
- [ ] T008 Jornada 4 — COLLABORATOR recebe acesso negado pela API real e pela tela
- [ ] T009 Jornada 3 — missão e alocação no Efetivo, conflito recusado
- [ ] T010 Script local `npm run test:e2e:real` com `E2E_DATABASE_URL` (exige banco `*_e2e`) e doc no README
- [ ] T011 Validar quebra de contrato injetada (um campo renomeado faz a jornada 2 falhar) e registrar no PR
- [ ] T012 10 execuções seguidas sem falha; incluir "E2E (real stack)" na proteção da `main` (com confirmação do usuário)
- [ ] T013 (opcional) Jornada 5 — fumaça do Data Book
