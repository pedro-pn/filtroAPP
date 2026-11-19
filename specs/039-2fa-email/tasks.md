# Tasks: Verificação em duas etapas por e-mail (039)

- [x] T001 Migration aditiva e modelos Prisma (`TwoFactorChallenge`, `TrustedDevice`, `AuthSecurityEvent`, campos em `User`)
- [x] T002 `backend/src/lib/accounts/two-factor.js` (regras, desafio, navegador lembrado, emergência, envio, eventos)
- [x] T003 Template de e-mail `buildTwoFactorCodeEmailTemplate`
- [x] T004 Rotas `/auth/login` (desafio) e `/auth/2fa/*`
- [x] T005 Revogação de navegadores lembrados em troca/redefinição de senha e edição pelo admin
- [x] T006 ADMIN exige e-mail (backend `assertAdminHasEmail` + tela)
- [x] T007 `publicUser.twoFactor` e coluna em Gestão de contas
- [x] T008 `scripts/disable-2fa.js` e `TWO_FACTOR_ENFORCEMENT`
- [x] T009 Retenção: desafios/navegadores vencidos e anonimização de IP/UA dos eventos
- [x] T010 Catálogo de dados da API e anonimização da homologação
- [x] T011 Frontend: segunda etapa do login, card em Minha conta
- [x] T012 Testes: `two-factor.test.js`, `two-factor-login.test.js`, ajustes nos testes de revogação
- [x] T013 Docs: README, `deploy/PRODUCTION.md`, `docs/RUNBOOK_INCIDENTES.md`, `LGPD_ROPA.md`, `.env.example`
- [ ] T014 Rollout no servidor (conferir admins sem e-mail, deploy, testar login) — responsável: operação
