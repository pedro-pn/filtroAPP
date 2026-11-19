# Contrato da API interna

`openapi.internal.json` é o contrato OpenAPI 3.1 da API interna (`/api/*`, usada pelo
frontend). Ele é **gerado** a partir do código (spec 042): cada rota migrada é declarada com
`defineRoute` (`backend/src/lib/api-contract/registry.js`) e os schemas zod que validam a
entrada são os mesmos que documentam. Não edite o arquivo à mão.

A API pública de integração (v1) tem contrato próprio em
`specs/015-api-token-playground/contracts/openapi.yaml`.

## Comandos (no `backend/`)

| Comando | O que faz |
|---|---|
| `npm run contract:build` | Regera `docs/api/openapi.internal.json` |
| `npm run contract:build -- --check` | Falha se o arquivo estiver desatualizado (o CI confere isso no `npm test`) |
| `npm run contract:allowlist` | Regrava a lista de rotas ainda sem contrato (`backend/src/lib/api-contract/unmigrated-routes.json`) |
| `npm run contract:view` | Abre o contrato no Redoc em `http://127.0.0.1:4010` — **só em desenvolvimento**, não existe em produção |

## Como migrar uma rota

```js
import { defineRoute } from '../../lib/api-contract/registry.js';

defineRoute(router, {
  method: 'post', path: '/login', summary: 'Entrar com usuário e senha', tags: ['auth'],
  auth: 'public',                // public | session | publicToken | apiToken
  body: loginSchema,             // params / query também; escrita sem corpo exige noBody: 'motivo'
  responses: { 200: loginResponseSchema },
  errors: [400, 401, 429]
}, loginRateLimit, asyncHandler(async (req, res) => { /* req.body já validado */ }));
```

Os middlewares passados (limites, `requireAuth`) rodam primeiro; a validação entra logo antes
do handler final. Depois de migrar: rode `npm run contract:build`, tire as linhas do domínio de
`unmigrated-routes.json` e baixe `UNMIGRATED_ROUTES_BASELINE` em
`backend/test/internal-api-contract.test.js` — a lista só pode diminuir.

## Formato de erro

Toda resposta de erro da API interna tem `{ error, code, requestId, details? }`:

- `error`: mensagem em texto para mostrar ao usuário (o frontend lê este campo).
- `code`: código estável (ex.: `VALIDATION_ERROR`, `TWO_FACTOR_INVALID`); sem código específico,
  um genérico pelo status (`BAD_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`...).
- `requestId`: o mesmo do cabeçalho `X-Request-Id`, para achar a requisição no log.
- `details`: quando houver, por exemplo os campos inválidos.

Handlers novos usam `sendError(res, status, code, message, details)` de
`backend/src/lib/http/error-response.js`.

## Fases (spec 042)

1. **auth** ✅ (22 rotas)
2. RDO e relatórios (inclui o upload manual em multipart)
3. Efetivo, workforce e conferência de alocação
4. Equipamentos, EPI, estoque, qualidade, romaneio e logística
5. Acompanhamento, operações, privacidade, admin, notificações, assinaturas e webhooks
