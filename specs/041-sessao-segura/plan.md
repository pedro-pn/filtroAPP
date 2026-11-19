# Plan: Sessão segura no navegador (041)

## Opções avaliadas

| | O que fecha | O que não fecha | Esforço | Risco de regressão |
|---|---|---|---|---|
| **1. Cookie `HttpOnly` + CSRF** | Roubo do token por XSS/extensão (o token nunca chega ao JS); critério 4.2 inteiro | Um XSS ainda age **dentro** da página enquanto ela está aberta (mas não leva a sessão embora) | 3–4 dias | Médio: toca login, todas as chamadas, downloads protegidos, multi-aba |
| **2. Bearer + inatividade + prazos curtos + rotação** | Reduz a janela de uso de um token roubado (horas, não 30 dias) | Token continua legível por JS; critério 4.2 ("cookie seguro") segue 🟡 | 1–1,5 dia | Baixo |
| **3. Híbrido (1 + inatividade)** *(recomendado)* | Tudo de 1, mais a janela curta de 2 | Igual à 1 | 4–5 dias | Médio |

Por que não só a 2: a régua pede explicitamente cookie com `HttpOnly/Secure/SameSite`, e a
mesma origem (nginx) torna a opção 1 barata em termos de CORS. A inatividade é pequena e
cobre o caso "computador do campo deixado logado".

## Abordagem (opção 3)

### Backend
- `backend/src/lib/auth.js`: `createSession` devolve token + metadados; novo
  `sessionCookieOptions(env)`; prazos por env (`SESSION_ABSOLUTE_HOURS`,
  `SESSION_REMEMBER_DAYS`, `SESSION_IDLE_HOURS`).
- Migration aditiva `UserSession.lastUsedAt DateTime?` (+ índice se o job de retenção usar).
- `backend/src/middleware/auth.js` (`requireAuth`): lê `fv_session` do cookie (parser
  mínimo, sem dependência nova, ou `cookie` do Express 5) **ou**, durante a transição,
  `Bearer`; aplica inatividade; marca `req.auth.via = 'cookie' | 'bearer'`; ao autenticar
  por Bearer, emite o cookie (upgrade silencioso).
- Middleware `csrfGuard` em `backend/src/app.js`, depois do CORS e antes do `apiRouter`:
  para `via === 'cookie'` e método de escrita, exige `Origin`/`Referer` permitido +
  `X-Filtrovali-Request: 1`; isenções listadas em um único lugar e testadas.
- `routes/resources/auth.js`: `/login` e `/2fa/verify` emitem `fv_session` (e o cookie do
  navegador lembrado); `/logout` limpa; resposta com `token` só enquanto
  `SESSION_BEARER_TRANSITION=on`.
- Retenção (`lib/data-retention.js`): já apaga sessões expiradas; passa a apagar também as
  paradas por inatividade.
- Rotas protegidas de arquivo (`/uploads/*`, `/relatorios/*`, `app.js`) passam a aceitar o
  cookie (hoje só Bearer) — permite trocar o `fetch`+blob por URL direta no futuro.

### Frontend
- `frontend/src/api/client.ts`: remove leitura/escrita do token; axios envia
  `X-Filtrovali-Request: 1`; 401 dispara o evento atual (`UNAUTHORIZED_EVENT`).
- `frontend/src/auth/AuthProvider.tsx`: estado de login vem de `GET /api/auth/me`; na
  transição, apaga `filtrovali-react-token` e `filtrovali-trusted-device:*` do
  `localStorage` depois do upgrade; `BroadcastChannel('filtrovali-auth')` para logout em
  todas as abas; mensagem "sessão expirada por inatividade" (código `SESSION_IDLE`).
- `frontend/src/utils/uploadAssetUrl.ts` e os outros `fetch` diretos
  (`api/assinaturas.ts`, `pages/qualidade/QualityEvidenceThumbnail.tsx`,
  `components/reports/PublicReportDocumentPreview.tsx`): `credentials: 'same-origin'`.
- Aviso de nova versão (`utils/appUpdates.ts`) não depende da sessão — sem mudança.

### Infra
- nginx: nada obrigatório (mesma origem); conferir que `proxy_pass` repassa `Cookie`/
  `Set-Cookie` (padrão) e que a página de manutenção não emite cookie.
- Homologação tem domínio próprio → cookies separados, sem vazamento entre ambientes.

## Rollout

1. Deploy com `SESSION_BEARER_TRANSITION=on`: login novo recebe cookie **e** token; quem
   está logado com Bearer ganha o cookie no próximo request. Ninguém é deslogado.
2. Depois de **N dias** (D4; ≥ prazo absoluto antigo de "lembrar"), `SESSION_BEARER_TRANSITION=off`
   → Bearer só vale para `/api/integracoes/v1`. Quem não abriu o app no período faz login
   de novo (aceitável).
3. Verificação no navegador de produção: cookie com os 3 atributos, `localStorage` limpo,
   POST de outra origem recusado.

## Fases e esforço (opção 3)

| Fase | Entrega | Esforço |
|---|---|---|
| F1 | Cookie + leitura dupla no `requireAuth` + upgrade Bearer→cookie + testes | 1 dia |
| F2 | `csrfGuard` + isenções + testes | 0,5–1 dia |
| F3 | Inatividade (`lastUsedAt`, migration, throttle de escrita, retenção) + testes | 0,5 dia |
| F4 | Frontend (client, AuthProvider, fetch diretos, multi-aba, mensagens) + testes | 1–1,5 dia |
| F5 | Cookie do navegador lembrado do 2FA + migração do `localStorage` | 0,5 dia |
| F6 | Docs (README, PRODUCTION, RUNBOOK, ROPA) + rollout em 2 etapas | 0,5 dia |

Total: **4–5 dias**. Opção 2 isolada: F3 + prazos menores ≈ **1–1,5 dia**.

## Riscos

- **Telas quebrando por chamada sem o cabeçalho CSRF** (ex.: `fetch` direto esquecido):
  mitigado pela busca de todos os `fetch(` (7 hoje) e pelo e2e real do spec 040.
- **Navegadores em modo restrito / cookies de terceiros**: não se aplica (primeira parte,
  mesma origem).
- **Campo (celular) perdendo a sessão pela inatividade** no meio de um RDO: rascunhos já são
  salvos no servidor; escolher o limite de inatividade com isso em mente (D2).
- **Escrita em `lastUsedAt` a cada request**: throttle de 5 min por sessão.

## Decisões tomadas (2026-11-19)

1. **D1 — Opção:** híbrido — cookie `HttpOnly` + CSRF + inatividade.
2. **D2 — Prazos:** absoluto 7 dias / "lembrar" 30 dias / inatividade 12 h.
3. **D3 — `SameSite`:** `Strict`.
4. **D4 — Transição do Bearer:** 30 dias com upgrade silencioso; depois o Bearer do navegador deixa de valer (a API v1 continua com Bearer).
5. **D5 — Navegador lembrado do 2FA:** vai para cookie `HttpOnly` no mesmo PR.
