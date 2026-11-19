# Plan: Verificação em duas etapas por e-mail (039)

## Abordagem

- **Dados** (migration aditiva `20261119120000_two_factor_email`): `User.twoFactorEnabled`,
  `User.twoFactorBypassUntil`; tabelas `TwoFactorChallenge`, `TrustedDevice`,
  `AuthSecurityEvent`; enums `TwoFactorChallengePurpose`, `AuthSecurityEventType`.
- **Biblioteca** `backend/src/lib/accounts/two-factor.js`: regra por papel, criação/verificação/reenvio
  do desafio, navegador lembrado, emergência, envio do código (com prazo de 20 s e
  `skipped` = não entregue), trilha de eventos.
- **Rotas** (`/api/auth`): `/login` devolve `{ twoFactorRequired, challengeToken, emailHint }`
  quando necessário; `/2fa/verify`, `/2fa/resend`; `GET /2fa`, `/2fa/enable`,
  `/2fa/enable/confirm`, `/2fa/disable`, `DELETE /2fa/devices[/:id]`.
- **Revogação**: os mesmos pontos que derrubam sessões (PR #587) removem `TrustedDevice`.
- **Emergência**: `backend/scripts/disable-2fa.js`; `TWO_FACTOR_ENFORCEMENT=on|off`
  (padrão `on` só com `NODE_ENV=production`; homologação força `off` no compose).
- **Frontend**: `LoginPage` com a segunda etapa; `AuthProvider` guarda o token do navegador
  lembrado por conta em `localStorage`; card em **Minha conta**; coluna "2 etapas" em
  **Gestão de contas** e e-mail obrigatório para ADMIN.
- **Catálogo/LGPD**: modelos novos como PROIBIDO no catálogo de dados da API; regras na
  anonimização da homologação; linha nova no ROPA; alvos novos na retenção.

## Riscos

- SMTP parado bloqueia admins → emergência documentada no runbook.
- Caixa de e-mail comprometida → trade-off aceito e documentado; TOTP pode vir depois.
- Contador de limite em memória (como o login atual) zera em deploy; os limites por desafio
  (tentativas, envios) ficam no banco.
