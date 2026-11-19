# Tasks: Sessão segura no navegador (041)

- [ ] T001 Prazos por env (`SESSION_ABSOLUTE_HOURS`, `SESSION_REMEMBER_DAYS`, `SESSION_IDLE_HOURS`, `SESSION_BEARER_TRANSITION`) em `config/env.js` + `.env.example`
- [ ] T002 Migration aditiva `UserSession.lastUsedAt` e uso no `requireAuth` (throttle de 5 min)
- [ ] T003 Cookie `fv_session` em `/auth/login` e `/auth/2fa/verify`; limpeza em `/auth/logout`
- [ ] T004 `requireAuth` lê cookie ou Bearer (transição) e faz upgrade Bearer→cookie; `/uploads` e `/relatorios` aceitam cookie
- [ ] T005 `csrfGuard` (Origin/Referer + `X-Filtrovali-Request`) com isenções centralizadas e testadas
- [ ] T006 Retenção: sessões paradas por inatividade entram na limpeza
- [ ] T007 Frontend: `api/client.ts` sem token, cabeçalho CSRF; `AuthProvider` via `/auth/me`, limpeza do `localStorage`, `BroadcastChannel`, mensagem de inatividade
- [ ] T008 Frontend: `fetch` diretos com `credentials: 'same-origin'` (uploadAssetUrl, assinaturas, qualidade, preview público)
- [ ] T009 Navegador lembrado do 2FA em cookie `HttpOnly` (se D5 = a)
- [ ] T010 Testes backend (cookie e atributos, inatividade, CSRF aceito/recusado, isenções, upgrade, logout) e frontend (multi-aba, 401)
- [ ] T011 Jornada e2e real (spec 040): login → ação de escrita → POST de outra origem recusado
- [ ] T012 Docs: README "Senhas e sessões", `deploy/PRODUCTION.md` (rollout em 2 etapas), `docs/RUNBOOK_INCIDENTES.md`, ROPA (cookie de sessão)
- [ ] T013 Rollout: etapa 1 (transição ligada) → verificação no navegador → etapa 2 após o prazo (D4) — responsável: operação
