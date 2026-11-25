# Feature Specification: Contratos, validação e erros da API interna

**Feature Branch**: `docs/spec-042-contratos-api` (plano) → implementação em fases (`feat/api-contract-*`)

**Created**: 2026-11-19

**Status**: Draft — aguardando decisões do usuário

**Input**: Auditoria "13 pilares", pilar 7 (APIs e integrações) e critério 13.2 (contrato de cada
módulo e API). Reavaliação de 2026-11-19: pilar 7 🟡 — é o único pilar de nível 1 ainda parcial
fora da LGPD.

## Contexto (como é hoje, conferido no código em 2026-11-19)

- **API interna `/api/*`**: 24 montagens em `backend/src/routes/index.js` (auth, notifications,
  privacy, webhooks/projects, rdo, romaneio, logistica, epi, equipamentos, estoque, qualidade,
  acompanhamento/{comercial,custo,ponto}, operations, efetivo, efetivo/conferencia-alocacao,
  workforce, assinaturas, admin, admin/workforce-classification, admin/accounts, users) sobre 56
  arquivos de rota. Varredura estática: **208 rotas GET e 281 de escrita**
  (POST/PUT/PATCH/DELETE). **Não existe contrato** (OpenAPI ou equivalente) para nenhuma delas.
- **API de integração `/api/integracoes/v1`** já tem contrato: `specs/015-api-token-playground/contracts/openapi.yaml`,
  catálogo executável (`backend/src/lib/api-credentials/catalog.js`) e teste
  `backend/test/api-openapi-contract.test.js` (YAML + Ajv: toda operação do catálogo existe no
  contrato e as respostas validam). É o padrão a reaproveitar.
- **Validação (7.2)**: zod 4 (`"zod": "^4.6.7"`) na maioria das rotas. A varredura achou **86 rotas
  de escrita sem `parse`/`safeParse` no próprio handler**. Parte delas é `DELETE`/ação sem corpo
  ou valida dentro de `lib/`; gaps confirmados: `databook` repassa `req.body.edicoes` cru
  (`routes/resources/databook.js` ~53–72), destinatários de estatísticas normalizados à mão
  (`routes/resources/statistics.js` ~846–870), `POST /api/privacy/me/delete-request`,
  `PUT /api/operations/retention-holds`, `POST /api/integracoes/v1/conecta-rh/eventos` (validação
  própria, a confirmar), entre outras.
- **Limite de corpo**: já é por rota (`jsonBodyLimitForRequest` em `backend/src/app.js`): 1 MB
  padrão; 3–30 MB para assinatura/uploads; **70 MB** no upload manual de PDF (PDF em base64 dentro
  do JSON, todo em memória).
- **Erros (7.3)**: a API interna responde `{ error: string, code?: string }` (278 respostas
  `res.status(4xx/5xx).json({ error … })` nas rotas + handler central em `app.js`); 5xx levam
  `X-Request-Id` no cabeçalho (#588) e escondem códigos internos em produção (#606). A v1 usa
  `{ error: { code, message }, requestId }`. O frontend lê **`error` como texto**
  (`extractApiErrorMessage` em `frontend/src/api/client.ts` e ~10 outros pontos) e `code` em
  alguns fluxos.
- **Integrações (7.5)**: chamadas externas com prazo de 15 s (Conecta RH, ComercialAPP) e
  `fetchWithTimeout` (#590). O sync do ComercialAPP **já tem espera exponencial por proposta**
  (`commercial-proposal-sync.js`: `nextAttemptAt` de 1 a 60 min). O Conecta RH roda a cada 5 min
  (`lib/conecta-rh/job.js`); falha vira `JobRun` FAILED e alerta (#588), mas **não há nova
  tentativa dentro do ciclo** para falhas passageiras (502/503/504/timeout).
- **Webhook do PrismaCRM (7.6)**: `POST /api/webhooks/projects` (token, rate limit, idempotência)
  **sem versão** no caminho; compatibilidade feita com campos opcionais
  (`docs/comercialapp-bridge.md`). O ComercialAPP é outro repositório.

## User Scenarios & Testing *(mandatory)*

### US1 — Contrato da API interna publicado e sempre em dia (Priority: P1) — 7.1 / 13.2

Um dev novo abre `docs/api/` e encontra, para cada rota de `/api/*`, o que ela recebe, o que
devolve e quais erros pode dar, sem ler o código. Se alguém cria ou muda uma rota sem atualizar o
contrato, o CI falha.

**Acceptance**:
1. 100% das rotas montadas em `routes/index.js` (exceto a v1, que já tem o dela) aparecem no
   contrato, com método, caminho, permissão exigida, corpo, resposta de sucesso e erros.
2. Um teste no job `Backend` (obrigatório) compara as rotas registradas no Express com o contrato
   e falha em rota sem entrada (ou entrada sem rota).
3. As respostas exercitadas pelos testes de integração existentes validam contra o schema do
   contrato (Ajv), como já é feito na v1.

### US2 — Nenhuma escrita sem validação (Priority: P1) — 7.2

Todo POST/PUT/PATCH/DELETE com corpo ou parâmetros valida a entrada com zod antes de usar; dado
inválido recebe 400 claro, nunca 500 nem gravação parcial.

**Acceptance**:
1. Inventário gerado pelo próprio registro de rotas: cada rota de escrita declara o schema de
   `body`/`params`/`query` (ou `none`, justificado). CI falha em rota de escrita sem declaração.
2. Os gaps confirmados (databook `edicoes`, destinatários de estatísticas e os demais do
   inventário) passam a ter schema e teste de entrada inválida.
3. Corpo acima do limite da rota → 413 no formato padrão; o upload manual de PDF deixa de exigir
   70 MB de JSON (ver decisão D3).

### US3 — Erro no mesmo formato em toda a API interna (Priority: P2) — 7.3

Todo erro da API interna sai como `{ error: string, code: string, requestId: string, details? }`,
com status HTTP correto e sem detalhe interno. O frontend continua mostrando `error` como hoje.

**Acceptance**:
1. 4xx e 5xx do handler central e das rotas têm `code` (catálogo único de códigos) e `requestId`
   (o mesmo do cabeçalho `X-Request-Id` e dos logs/alertas).
2. Nenhuma mudança de comportamento no frontend (teste de `extractApiErrorMessage` cobre o formato
   novo); testes de contrato verificam o formato.

### US4 — Integração resiste a falha passageira e avisa quando persiste (Priority: P2) — 7.5

Uma queda curta do Conecta RH (502/503/504, timeout, reset) é absorvida no próprio ciclo com até 3
tentativas e espera crescente com jitter; falha que persiste por N ciclos gera um único alerta
(canal de e-mail já existente, com controle de repetição).

**Acceptance**:
1. Teste com servidor falso: 2 falhas 503 seguidas de sucesso → ciclo concluído, sem alerta.
2. Falha 4xx (token inválido, payload) não é repetida.
3. ComercialAPP: a espera exponencial por proposta continua; o job de leitura em lote ganha a
   mesma política de nova tentativa para falhas de transporte.

### US5 — Webhook versionado (Priority: P3) — 7.6

O PrismaCRM chama `POST /api/webhooks/v1/projects`. O caminho antigo continua funcionando
durante a transição, respondendo com `Deprecation`/`Sunset` no cabeçalho, e é desligado com aviso.

**Acceptance**:
1. Os dois caminhos chegam ao mesmo handler e aos mesmos testes.
2. Política de versão escrita (o que é mudança compatível, como sai uma `v2`, prazo de desligamento).

## Fora de escopo

- Reescrever a API v1 (já tem contrato) ou trocar o framework de rotas.
- Expor a documentação interna publicamente (ver D2).
- Mudanças de regra de negócio nas rotas.
