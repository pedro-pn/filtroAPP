# Plan: Contratos, validação e erros da API interna (042)

## Opções para o contrato (7.1 / 13.2)

| | Como | A favor | Contra | Esforço |
|---|---|---|---|---|
| **A. Gerado do zod com registro de rotas** *(recomendado)* | Cada rota declara `{ method, path, auth, body?, params?, query?, response?, errors[] }` num registro (`backend/src/lib/api-contract/registry.js`); os schemas zod já existentes viram JSON Schema com `z.toJSONSchema()` (nativo do zod 4, sem dependência nova); um script monta `docs/api/openapi.internal.json` | Uma fonte só: o schema que valida é o que documenta; o mesmo registro alimenta a checagem de validação (US2) | Precisa tocar as 56 rotas para registrar (mecânico, por domínio) | 6–8 dias no total, em fases |
| B. OpenAPI escrito à mão (como a v1) | YAML por domínio + teste que compara com as rotas do Express | Sem mudar o código das rotas | Duplica o que os schemas zod já dizem; desatualiza fácil em ~490 rotas | 5–7 dias, manutenção alta |
| C. Biblioteca externa (`@asteasolutions/zod-to-openapi`) | Igual à A, com a lib | Mais recursos de OpenAPI | Dependência nova e compatibilidade com zod 4 a validar; a A resolve com o nativo | ≈ A |

## Abordagem (opção A)

### Fase 0 — Base (1 dia)
- `lib/api-contract/registry.js`: `defineRoute(router, spec, ...handlers)` que registra o spec e
  monta a rota; `spec.body/params/query` são schemas zod e o wrapper **faz o parse** (400 no
  formato padrão) — o que já elimina o `schema.parse(req.body)` repetido em cada handler.
- `scripts/build-internal-openapi.js` → `docs/api/openapi.internal.json` (gerado, versionado; CI
  confere que está atualizado: "rode `npm run contract:build`").
- `backend/test/internal-api-contract.test.js` (job `Backend`): percorre o `apiRouter` do Express
  (`router.stack`) e compara com o registro — rota sem spec, spec sem rota e rota de escrita sem
  `body`/`params`/`query` declarados (ou `none` com motivo) **falham**. Começa com uma *allowlist*
  do que ainda não migrou, que só pode diminuir (o teste falha se a allowlist crescer).
- Reuso da v1: Ajv já está no projeto; helper de teste `expectMatchesContract(response, routeId)`
  para os testes de integração existentes.

### Fase 1–4 — Migração por domínio (4–5 dias)
Ordem por risco e uso: **auth / account** → **rdo/reports** (inclui uploads, PDF, manual-upload)
→ **efetivo + workforce + conferência de alocação** → **equipamentos, epi, estoque, qualidade,
romaneio, logística** → **acompanhamento (comercial/custo/ponto), operations, privacy, admin,
notifications, assinaturas, webhooks**. Cada fase é um PR que: registra as rotas do domínio,
fecha os gaps de validação do domínio (US2), reduz a allowlist e acrescenta
`expectMatchesContract` nos testes que já exercitam o domínio.

### 7.2 — Validação e limites
- Gaps confirmados entram na fase do domínio: `databook` `edicoes` (schema das edições: chaves
  permitidas, tamanho de texto), `statistics` recipients (e-mails válidos, limite de itens),
  `privacy/me/delete-request`, `operations/retention-holds`, `assinaturas/lotes*`,
  `api-credentials/*`, `counters/*`, `manometers/*`, `epis/catalog*` etc. (lista completa sai do
  inventário da Fase 0).
- `params`/`query` também com schema (ids `cuid`, paginação com máximo, filtros com enum).
- Limites: manter `jsonBodyLimitForRequest`, mas o limite passa a viver no spec da rota
  (`bodyLimit`) e o 413 sai no formato padrão. Upload manual de PDF: ver D3 (multipart em
  streaming exige uma dependência nova — `busboy`, sem parser de multipart hoje no
  `package-lock` — ou manter base64 com limite menor).

### 7.3 — Formato único de erro (compatível)
- Formato interno: `{ error: string, code: string, requestId: string, details?: object }`.
  `error` continua sendo a mensagem em texto (o que o frontend já lê); `code` passa a ser
  **sempre** presente (catálogo em `lib/http/error-codes.js`, com os existentes como
  `EPI_SIGNED_HISTORY_LOCKED`, `SESSION_IDLE`, `CSRF_*`, `MAINTENANCE`); `requestId` igual ao
  `X-Request-Id`, agora também em 4xx; `details` para erros de validação (campo + motivo).
- Implementação: helper `sendError(res, status, code, message, details)` + handler central;
  migração das 278 respostas `res.status(...).json({ error })` por domínio junto com as fases
  (codemod simples; onde não houver código específico, `code` genérico por status:
  `BAD_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`...).
- A v1 continua com o formato dela (`{ error: { code, message }, requestId }`) — contrato
  público já publicado; não muda.
- Frontend: nenhuma mudança obrigatória; `extractApiErrorMessage` ganha teste com o formato novo
  e passa a anexar `requestId` às mensagens de erro inesperado ("informe o código X ao suporte").

### 7.5 — Nova tentativa nas integrações (0,5–1 dia)
- `lib/http/outbound.js`: `withRetry(fn, { attempts: 3, baseMs: 500, maxMs: 5000, jitter: true,
  retryOn: [network, timeout, 502, 503, 504, 429 com Retry-After] })`.
- Conecta RH (`lib/conecta-rh/sync.js` e `compliance.js`): leituras (GET/feed/snapshot) com
  `withRetry`; sem retry para 4xx. Alerta só depois de N ciclos seguidos com falha
  (`CONECTA_RH_ALERT_AFTER_FAILURES`, padrão 3 = 15 min), usando o canal e o controle de repetição
  de `alert-email.js`.
- ComercialAPP: mantém a espera exponencial por proposta; a leitura em lote ganha `withRetry`.

### 7.6 — Versão do webhook (0,5 dia + coordenação)
- `router.use('/webhooks/v1/projects', projectIntakeWebhookRouter)` além do caminho atual.
- Caminho antigo responde `Deprecation: true` e `Sunset: <data>`; contador de uso do caminho
  antigo no painel de Operações (para saber quando o ComercialAPP migrou).
- Ordem de deploy: (1) filtroAPP com os dois caminhos; (2) ComercialAPP passa a chamar `/v1`;
  (3) depois do prazo (D5) sem chamadas no caminho antigo, ele é removido.
- `docs/comercialapp-bridge.md` e `docs/API_INTEGRACOES.md`: política de versão (mudança
  compatível = campo novo opcional; remover/renomear campo ou mudar significado = `v2`; versões
  antigas desligadas com aviso e prazo mínimo).

### Publicação do contrato (D2)
- `docs/api/openapi.internal.json` no repositório (gerado) + `docs/api/README.md` explicando como
  ler e gerar. Viewer opcional: página estática com Redoc/Swagger UI servida só em dev
  (`npm run contract:view`), sem expor em produção.

## Testes

- Unitários: wrapper `defineRoute` (parse de body/params/query, 400 padrão, 413), `sendError`,
  `withRetry` (tentativas, jitter, não repete 4xx, respeita `Retry-After`).
- Contrato: `internal-api-contract.test.js` (rotas × registro; allowlist só diminui; arquivo
  gerado atualizado) e `expectMatchesContract` nos testes de integração por domínio.
- Frontend: `extractApiErrorMessage` com o formato novo; e2e real (spec 040) segue verde — é a
  rede de segurança contra quebra de contrato entre frontend e backend.

## Rollout e riscos

- Cada fase é um PR pequeno por domínio; o comportamento das rotas não muda (só validação
  adicional e formato de erro com campos a mais).
- **Risco 1 — validação nova recusando payload que o frontend manda hoje.** Mitigação: schemas
  escritos a partir do que o frontend envia (tipos em `frontend/src/api/*.ts`), testes de
  integração existentes + e2e real; em caso de dúvida, `passthrough` no primeiro momento e
  aperto num PR seguinte.
- **Risco 2 — erro com formato novo quebrando algum `catch` específico do frontend.** Mitigação:
  `error` continua string; busca por usos de `response.data.*` no frontend antes de cada fase.
- **Risco 3 — webhook: quem chama é o PrismaCRM, sistema externo (URL configurada no CRM).** Mitigação: dois caminhos em paralelo e
  contador de uso antes de desligar.

## Esforço total estimado

| Parte | Dias |
|---|---|
| Fase 0 (registro, gerador, teste de contrato, `sendError`) | 1 |
| Fases 1–4 (migração por domínio, gaps de validação, erros) | 4–5 |
| 7.5 nova tentativa nas integrações | 0,5–1 |
| 7.6 webhook versionado | 0,5 |
| Upload manual em multipart (se D3 = a) | 1 |
| **Total** | **7–8,5** |

## Critérios da régua atendidos

- 7.1 / 13.2: contrato de toda a API interna, gerado e verificado no CI.
- 7.2: toda escrita com schema declarado (checado no CI); limites por rota com 413 padrão.
- 7.3: formato único com `code` e `requestId` em toda resposta de erro.
- 7.4: já ✅ (idempotência existente) — sem mudança.
- 7.5: nova tentativa com espera crescente e jitter + alerta por falha persistente.
- 7.6: webhook versionado e política de versão escrita.

## Decisões tomadas (2026-11-19)

Todas as recomendações foram aceitas pelo usuário:

- **D1 — Como gerar o contrato:** a partir dos schemas zod, com registro de rotas (`defineRoute`) e `z.toJSONSchema` nativo do zod 4, sem dependência nova.
- **D2 — Onde publicar:** arquivo gerado no repositório (`docs/api/openapi.internal.json`), com visualizador só em desenvolvimento.
- **D3 — Upload manual de PDF:** trocar o JSON em base64 por multipart em streaming, no PR da fase de RDO.
- **D4 — Ordem das fases:** auth → RDO → Efetivo → equipamentos/EPI/estoque/qualidade → resto.
- **D5 — Caminho antigo do webhook:** desligado 60 dias depois que o PrismaCRM migrar, confirmado pelo contador de uso.
- **D6 — Formato de erro:** `{ error: string, code, requestId, details? }`, compatível com o frontend atual.
