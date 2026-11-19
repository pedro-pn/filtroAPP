# Feature Specification: Sessão segura no navegador

**Feature Branch**: `docs/spec-041-sessao-segura` (plano) → implementação em `feat/sessao-segura`

**Created**: 2026-11-19

**Status**: Draft — aguardando decisões do usuário

**Input**: Auditoria "13 pilares", critérios 4.2 ("sessão com prazo, encerramento e cookie
seguro: `HttpOnly`, `Secure`, `SameSite`") e 4.3 (CSRF). Reavaliação de 2026-11-18: 4.2 🟡.

## Contexto (como é hoje)

- Token opaco de 32 bytes; o banco guarda só o SHA-256 (`UserSession.tokenHash`,
  `expiresAt`), `backend/src/lib/auth.js`: **7 dias**, ou **30 dias** com "lembrar".
  Sem expiração por inatividade; `requireAuth` (`backend/src/middleware/auth.js`) lê só
  `Authorization: Bearer`.
- O frontend guarda o token em **`localStorage`** (`filtrovali-react-token`,
  `frontend/src/api/client.ts`) e o envia em todo request do axios; o token do
  **navegador lembrado do 2FA** (#609) também fica em `localStorage` por conta
  (`frontend/src/auth/AuthProvider.tsx`). `frontend/src/utils/uploadAssetUrl.ts` lê o token
  para baixar arquivos protegidos via `fetch` + blob.
- Frontend e API são servidos pela **mesma origem** (nginx faz proxy de `/api/`,
  `/uploads/`, `/relatorios/`), o que torna cookies `SameSite=Strict` viáveis.
- CSP restritiva (`script-src 'self'`, `frame-ancestors 'none'`) reduz, mas não elimina, o
  risco de XSS; CORS só aceita `ALLOWED_ORIGIN` em produção (#606).
- A API de integração (`/api/integracoes/v1`, tokens `fva_` via `requireApiToken`) e as
  rotas públicas por token (assinatura, pesquisa, anexos por token) **não usam a sessão**.

**Risco que o critério cobre**: qualquer XSS (ou extensão maliciosa) lê o `localStorage` e
leva um token que vale até 30 dias, utilizável de qualquer lugar até expirar.

## User Scenarios & Testing *(mandatory)*

### US1 — Token fora do alcance do JavaScript (Priority: P1)

Depois do login, o navegador guarda a sessão num cookie `HttpOnly; Secure; SameSite=Strict;
Path=/`. Nenhum token de sessão em `localStorage`/`sessionStorage`. Um script na página não
consegue ler a sessão.

**Acceptance**: `document.cookie` não mostra a sessão; `localStorage` não tem o token;
todas as telas, downloads e uploads continuam funcionando.

### US2 — Sessão expira por inatividade (Priority: P1)

Sem uso por **X horas** (D2), a sessão expira mesmo dentro do prazo absoluto; o próximo
request devolve 401 e a tela pede login com aviso "sessão expirada por inatividade".

### US3 — Proteção contra CSRF (Priority: P1)

Uma página de outro site não consegue fazer o navegador logado executar ações. Requests de
alteração (POST/PUT/PATCH/DELETE) com cookie exigem origem permitida **e** o cabeçalho
customizado enviado pelo app; GET não altera estado sensível.

**Acceptance**: formulário/`fetch` de outra origem recebe 403; o app funciona normal.

### US4 — Transição sem derrubar todo mundo (Priority: P2)

Quem está logado com o token antigo continua logado: no primeiro request com `Bearer`, o
backend emite o cookie e o frontend apaga o token do `localStorage`. Depois do período de
transição (D4), `Bearer` deixa de valer para rotas do app (continua só para a API v1).

### US5 — Sair encerra em todas as abas (Priority: P2)

"Sair" invalida a sessão no servidor, limpa o cookie e avisa as outras abas
(`BroadcastChannel`), que voltam para o login.

## Requirements *(mandatory)*

- **FR-001**: cookie `fv_session` (`HttpOnly`, `Secure` em produção/homologação,
  `SameSite=Strict`, `Path=/`, `Max-Age` = prazo absoluto) emitido em `/auth/login` e
  `/auth/2fa/verify`; o corpo da resposta deixa de trazer o token após a transição.
- **FR-002**: `UserSession.lastUsedAt` (migration aditiva); `requireAuth` recusa sessão com
  `lastUsedAt` mais antigo que o limite de inatividade e atualiza `lastUsedAt` no máximo a
  cada 5 min por sessão (sem escrita por request).
- **FR-003**: prazos novos (D2): absoluto e inatividade configuráveis por env com padrão
  seguro; "lembrar" continua existindo com prazo absoluto maior, nunca sem inatividade.
- **FR-004**: CSRF — para requests autenticados por cookie com método de escrita: exigir
  `Origin` (ou `Referer`) ∈ origens permitidas **e** cabeçalho `X-Filtrovali-Request: 1`
  (o axios envia sempre); recusar com 403 e código `CSRF_REJECTED`. Isentos: `/auth/login`,
  `/auth/2fa/*` (sem sessão ainda), rotas públicas por token e `/api/integracoes/v1`.
- **FR-005**: token do navegador lembrado do 2FA também vira cookie `HttpOnly`
  (`fv_trusted_<hash do usuário>` ou um cookie único com lista assinada — D5).
- **FR-006**: `uploadAssetUrl.ts` e os demais `fetch` diretos usam `credentials:
  'same-origin'` em vez de ler o token.
- **FR-007**: `POST /auth/logout` apaga a sessão e o cookie; `BroadcastChannel` desloga as
  outras abas; troca/redefinição de senha segue revogando sessões (#587).
- **FR-008**: dev (`vite` com proxy) funciona sem HTTPS (`Secure` desligado só fora de
  produção/homologação; `localhost` é contexto seguro nos navegadores atuais).
- **FR-009**: testes cobrem cookie emitido com os atributos, inatividade, CSRF aceito/recusado,
  isenções, transição Bearer→cookie, logout multi-aba (unit + e2e real do spec 040 quando
  existir).

## Success Criteria

- Nenhum token de sessão acessível por JavaScript em produção (verificado no navegador).
- Request de escrita vindo de outra origem é recusado (teste automatizado).
- Sessão parada pelo limite de inatividade é recusada (teste automatizado).
- Critérios 4.2 e 4.3 da régua em ✅ na próxima reavaliação.
