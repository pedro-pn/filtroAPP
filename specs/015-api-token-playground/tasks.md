# Tasks: API Playground e tokens de integração

**Input**: Design documents from `specs/015-api-token-playground/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Obrigatórios porque a especificação exige matriz automatizada de escopos, projeções sem campos proibidos, regras de ciclo de vida e autorização no backend.

**Organization**: As tarefas estão agrupadas pelas cinco histórias da especificação. As duas histórias P1 formam juntas o MVP operacional: emissão administrativa e consumo de Qualidade.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode ser executada em paralelo após suas dependências explícitas, pois trabalha em arquivos distintos.
- **[Story]**: Rastreia a tarefa até `US1`–`US5` da especificação.
- Todos os caminhos são relativos à raiz do repositório.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Preparar dependências e configuração segura sem iniciar servidor, aplicar migração ou executar deploy.

- [X] T001 Adicionar `ipaddr.js` como dependência direta para validação CIDR IPv4/IPv6 em `backend/package.json` e `backend/package-lock.json`
- [X] T002 [P] Declarar `API_TOKEN_HASH_KEY_V1`, versão ativa da chave, limites globais e configuração de proxy confiável, sem valores secretos versionados, em `backend/src/config/env.js` e `backend/.env.example`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Construir a base de persistência, criptografia, restrições, catálogo, paginação, cotas, auditoria e fronteiras de rota necessárias a todas as histórias.

**⚠️ CRITICAL**: Nenhuma história pode ser concluída antes desta fase.

### Foundational tests

- [X] T003 [P] Criar testes inicialmente falhos para geração, parsing, entropia, HMAC versionado, comparação constante, seletor inexistente e ausência do segredo em serializações em `backend/test/api-token-security.test.js`
- [X] T004 [P] Criar testes inicialmente falhos para normalização CIDR, proxy confiável, cursor assinado, vínculo a filtros e snapshot estável em `backend/test/api-token-restrictions.test.js`
- [X] T005 [P] Criar testes inicialmente falhos para reserva concorrente de cotas, reconciliação de linhas e redação de eventos/logs em `backend/test/api-token-foundation.test.js`

### Foundational implementation

- [X] T006 Modelar `ApiCredential`, `ApiCredentialScope`, `ApiCredentialProject`, `ApiCredentialEvent`, `ApiRequestLog` e `ApiUsageBucket`, com índices, relações e enums, e gerar migração Prisma aditiva em `backend/prisma/schema.prisma` e `backend/prisma/migrations/`
- [X] T007 [P] Implementar geração/parsing do formato `fva_<selector>_<secret>`, HMAC-SHA-256 versionado, verificador fictício e serialização pública em `backend/src/lib/api-credentials/token.js`
- [X] T008 [P] Implementar resolução segura do IP efetivo e comparação de allowlist CIDR IPv4/IPv6 em `backend/src/lib/api-credentials/restrictions.js`
- [X] T009 [P] Implementar cursor opaco assinado com operação, versão, filtros, `(updatedAt,id)` e `snapshotAt` em `backend/src/lib/api-credentials/cursor.js`
- [X] T010 Implementar reserva atômica e reconciliação das janelas `MINUTE`/`DAY` por requisições, linhas e bytes em `backend/src/lib/api-credentials/quota.js`
- [X] T011 Implementar eventos administrativos imutáveis e logs de uso por allowlist, sem token, Authorization, corpo ou resposta integral, em `backend/src/lib/api-credentials/audit.js`
- [X] T012 [P] Criar registro versionado de escopos e operações com os cinco escopos disponíveis de Qualidade e validações de integridade no boot/teste em `backend/src/lib/api-credentials/catalog.js`
- [X] T013 Criar schemas Zod compartilhados e declarações TypeScript para credenciais, validade, projetos, CIDRs, limites, filtros, cursores e envelopes em `shared/schemas/api-credentials.js`, `shared/schemas/api-credentials.d.ts`, `shared/schemas/integration-api.js` e `shared/schemas/integration-api.d.ts`
- [X] T014 [P] Implementar requestId, `Cache-Control: no-store`, erros estáveis/redigidos e limites de query/corpo/tempo para a nova árvore em `backend/src/middleware/api-request-context.js`
- [X] T015 Implementar a separação básica entre sessão humana administrativa e token de integração, incluindo limite grosseiro por IP antes da busca de seletor, em `backend/src/middleware/api-token-auth.js`
- [X] T016 Criar e montar os roteadores vazios `/api/admin/api-*` e `/api/integracoes/v1` sem alterar as autorizações das rotas existentes em `backend/src/routes/resources/api-credentials.js`, `backend/src/routes/integrations/v1/index.js` e `backend/src/routes/index.js`

**Checkpoint**: Modelos, token, schemas, catálogo, restrições, cursor, cota, auditoria e fronteiras de autenticação passam nos testes fundamentais.

---

## Phase 3: User Story 1 — Criar uma credencial de leitura com menor privilégio (Priority: P1) 🎯 MVP parte 1

**Goal**: Permitir que somente uma conta `ADMIN` configure e emita uma credencial temporária ou sem expiração, selecione escopos/restrições e veja o segredo uma única vez.

**Independent Test**: Uma conta `ADMIN` cria token limitado a Qualidade e depois só consulta prefixo/metadados; conta não admin é negada e aumento de privilégio sem rotação é recusado.

### Tests for User Story 1

- [X] T017 [P] [US1] Criar testes inicialmente falhos de `requireAuth` + `requireHubAdmin`, catálogo, criação, listagem, detalhe, confirmação sem expiração e idempotência em `backend/test/api-credentials-admin.test.js`
- [X] T018 [P] [US1] Criar testes inicialmente falhos para negar `/admin/tokens` a `INTERNAL`/`MANAGER` legado e preservar a rota após refresh em `frontend/test/admin-api-tokens-access.test.mjs`
- [X] T019 [P] [US1] Criar testes inicialmente falhos para validação dos campos, dependências de escopo, revelação única e ausência do token em URL/cache/storage em `frontend/test/admin-api-tokens-form.test.mjs`

### Implementation for User Story 1

- [X] T020 [US1] Implementar criação transacional, idempotência, cálculo de status, listagem e detalhe sem segredo em `backend/src/lib/api-credentials/service.js`
- [X] T021 [US1] Implementar comparação de políticas que aceite somente redução de escopos, projetos, IPs, validade e limites e exija rotação para ampliação em `backend/src/lib/api-credentials/authorization.js`
- [X] T022 [US1] Implementar `GET /admin/api-scopes`, `GET/POST /admin/api-credentials`, `GET/PATCH /admin/api-credentials/:id` sob `requireAuth` + `requireHubAdmin` em `backend/src/routes/resources/api-credentials.js`
- [X] T023 [P] [US1] Criar cliente tipado para catálogo, criação, listagem, detalhe e redução, impedindo que a resposta `token` entre no cache do TanStack Query, em `frontend/src/api/apiCredentials.ts`
- [X] T024 [US1] Adicionar `/admin/tokens` ao grupo `admin` com `allowedAccountTypes: ['ADMIN']` e regenerar o registry em `shared/modules/registry.json` e `frontend/src/modules/registry.generated.ts`
- [X] T025 [US1] Registrar `AdminTokensPage` no `RoleRoute` do módulo Admin sem usar isoladamente o helper legado `isHubAdmin` em `frontend/src/modules/moduleRoutes.tsx`
- [X] T026 [US1] Construir o shell amplo, navegação Contas/Tokens, filtros básicos e estados loading/vazio/erro com `Shell`, `TopBar`, `SearchBar`, `Button` e `Skeleton` em `frontend/src/pages/admin/AdminTokensPage.tsx`
- [X] T027 [P] [US1] Implementar formulário RHF+Zod de identidade, finalidade, destinatário, início, presets de validade, confirmação digitada `SEM EXPIRAÇÃO`, projetos, CIDRs, formatos e limites com `.field-group.field-invalid`, `aria-invalid` e `.field-error` em `frontend/src/components/admin/api-tokens/ApiCredentialForm.tsx`
- [X] T028 [P] [US1] Implementar catálogo pesquisável de escopos, dependências, badges e resumo de menor privilégio usando `SearchCombobox` e `HelpTip` em `frontend/src/components/admin/api-tokens/ApiScopeCatalog.tsx`
- [X] T029 [P] [US1] Implementar revelação única em memória, confirmação de cópia, fallback manual, aviso de irrecuperabilidade e exemplo com `$FILTRO_API_TOKEN` usando `Modal` e `Button` em `frontend/src/components/admin/api-tokens/ApiTokenRevealModal.tsx`
- [X] T030 [P] [US1] Implementar cartões/tabela de credenciais com prefixo, últimos quatro, status, validade, escopos e último uso em `frontend/src/components/admin/api-tokens/ApiCredentialCards.tsx`
- [X] T031 [US1] Integrar as etapas de configuração, permissão, revisão, emissão, revelação e recarga segura na página em `frontend/src/pages/admin/AdminTokensPage.tsx`
- [X] T032 [US1] Adicionar estilos com tokens do app, grid `minmax(min(100%, ...), 1fr)`, cartões mobile e modal com corpo rolável/rodapé fixo sem copiar o débito visual de `AdminAccountsPage` em `frontend/src/styles/base.css`

**Checkpoint**: US1 funciona isoladamente e cria uma identidade de integração segura, embora o valor de negócio completo dependa de US2.

---

## Phase 4: User Story 2 — Extrair todos os registros permitidos de Qualidade (Priority: P1) 🎯 MVP parte 2

**Goal**: Permitir carga completa e sincronização incremental de Qualidade pela credencial emitida, com paginação estável, projeção explícita e escopos separados.

**Independent Test**: Uma credencial fixture com apenas `qualidade.registros.read` percorre registros dos projetos permitidos sem evidências/excluídos/campos internos; escopos adicionais liberam exatamente seu subconjunto.

### Tests for User Story 2

- [X] T033 [P] [US2] Criar testes inicialmente falhos para token ausente/malformado/desconhecido/agendado/expirado/revogado, sessão humana recusada e erros 401 indistinguíveis em `backend/test/api-token-auth.test.js`
- [X] T034 [P] [US2] Criar testes inicialmente falhos de contrato para todos os campos públicos e ausência de `seq`, `year`, IDs completos de usuário, `storagePath`, `publicToken` e colunas não contratadas em `backend/test/integration-quality-contract.test.js`
- [X] T035 [P] [US2] Criar testes inicialmente falhos para carga completa, `updatedSince`, `snapshotAt`, desempate `(updatedAt,id)`, cursor adulterado/filtro divergente e limites em `backend/test/integration-quality-api.test.js`
- [X] T036 [P] [US2] Criar testes inicialmente falhos para projetos permitidos, metadados/download de evidência e tombstones com cada escopo presente/ausente em `backend/test/integration-quality-scope-matrix.test.js`

### Implementation for User Story 2

- [X] T037 [US2] Adicionar índices Prisma de sincronização por `(updatedAt,id)` e `(deletedAt,updatedAt,id)` e gerar migração versionada em `backend/prisma/schema.prisma` e `backend/prisma/migrations/`
- [X] T038 [US2] Completar autenticação externa com parse estrito, lookup por seletor, HMAC/dummy compare, datas, revogação, CIDR, escopos, projetos e cotas em `backend/src/middleware/api-token-auth.js`
- [X] T039 [P] [US2] Implementar projeções públicas por allowlist para `QualityRecord`, `QualityNature` e `QualityEvidence`, incluindo `evidenceSummary` e recorrência funcional, em `backend/src/lib/qualidade/public-serializer.js`
- [X] T040 [US2] Implementar consulta de registros/detalhe com `select` explícito, projetos permitidos, filtros, snapshot e paginação por cursor em `backend/src/lib/qualidade/integration-service.js`
- [X] T041 [P] [US2] Implementar consulta paginada de naturezas sem reutilizar serialização Prisma irrestrita em `backend/src/lib/qualidade/integration-natures.js`
- [X] T042 [P] [US2] Implementar resolução e streaming autenticado de evidência por ID sem revelar URL pública/caminho físico em `backend/src/lib/qualidade/integration-evidence.js`
- [X] T043 [US2] Implementar `GET` de registros, detalhe, naturezas e download conforme `contracts/openapi.yaml` em `backend/src/routes/integrations/v1/qualidade.js`
- [X] T044 [US2] Montar o roteador de Qualidade sob `/api/integracoes/v1/qualidade` e garantir que somente métodos/operações registrados sejam alcançáveis em `backend/src/routes/integrations/v1/index.js`
- [X] T045 [US2] Aplicar requestId, envelopes `items/page/generatedAt/schemaVersion`, `no-store`, códigos 400/401/403/404/429 e `Retry-After` em `backend/src/routes/integrations/v1/qualidade.js`
- [X] T046 [US2] Integrar reserva/finalização de cota e registro redigido de toda chamada autenticada, inclusive falha, no pipeline em `backend/src/middleware/api-token-auth.js` e `backend/src/lib/api-credentials/audit.js`
- [X] T047 [P] [US2] Documentar autenticação, paginação, sincronização, erros e exemplos sem segredo em `docs/API_INTEGRACOES.md`

**Checkpoint**: US1 + US2 formam o MVP: um admin emite token e o colaborador extrai Qualidade sem acesso ao banco.

---

## Phase 5: User Story 3 — Explorar e testar a API no painel (Priority: P2)

**Goal**: Entregar fluxo visual em três etapas e console seguro de requisição/resposta baseado somente no catálogo allowlisted.

**Independent Test**: Um admin escolhe uma operação permitida, preenche apenas parâmetros conhecidos e vê requisição redigida, resultado limitado e `curl` com variável; URL/método/header/corpo arbitrários não existem.

### Tests for User Story 3

- [X] T048 [P] [US3] Criar testes inicialmente falhos para endpoint admin de teste aceitar somente `operationId`/parâmetros catalogados, aplicar escopos/projetos/cotas e rejeitar URL, método, header e corpo livres em `backend/test/api-playground.test.js`
- [X] T049 [P] [US3] Criar testes inicialmente falhos para etapas, seletor de operação, autorização redigida, truncamento, variável de ambiente e ausência do segredo na URL/storage em `frontend/test/admin-api-playground.test.mjs`

### Implementation for User Story 3

- [X] T050 [US3] Implementar executor administrativo que reutiliza catálogo, schemas, escopos, projetos e cotas sem fingir IP do consumidor e grava evento `TESTED` em `backend/src/lib/api-credentials/playground.js`
- [X] T051 [US3] Implementar `POST /admin/api-credentials/:id/test` estritamente conforme `operationId`, `pathParams` e `query` do contrato em `backend/src/routes/resources/api-credentials.js`
- [X] T052 [P] [US3] Criar seletor de operações permitidas com busca, método/caminho imutáveis e explicação de escopo ausente em `frontend/src/components/admin/api-tokens/ApiOperationSelector.tsx`
- [X] T053 [P] [US3] Criar formulários de parâmetros derivados do catálogo, sem inputs livres de destino/header/body e com estados compartilhados de erro em `frontend/src/components/admin/api-tokens/ApiOperationParameters.tsx`
- [X] T054 [P] [US3] Implementar console de requisição/resposta com status, duração, requestId, quantidade, truncamento e rolagem interna em `frontend/src/components/admin/api-tokens/ApiRequestConsole.tsx`
- [X] T055 [US3] Implementar formatador redigido e cópia segura de `curl` usando literalmente `$FILTRO_API_TOKEN` em `frontend/src/components/admin/api-tokens/apiRequestFormatting.ts`
- [X] T056 [US3] Persistir somente `etapa`, `operation` e filtros não sensíveis em query params, limpando incompatíveis e restaurando refresh/deep-link, em `frontend/src/pages/admin/AdminTokensPage.tsx`
- [X] T057 [US3] Integrar seleção, parâmetros, execução simulada e painéis de requisição/resposta à terceira etapa em `frontend/src/pages/admin/AdminTokensPage.tsx`
- [X] T058 [US3] Implementar layout desktop em duas colunas e empilhamento mobile com scroll apenas no bloco de código em `frontend/src/styles/base.css`

**Checkpoint**: US3 permite configurar e diagnosticar a integração no painel sem criar um proxy/cliente HTTP arbitrário.

---

## Phase 6: User Story 4 — Administrar ciclo de vida, limites e auditoria (Priority: P2)

**Goal**: Permitir acompanhamento, redução, rotação, revogação, auditoria e inspeção de uso com efeito imediato e sem recuperar segredos.

**Independent Test**: Um admin localiza uma credencial, reduz acesso, rotaciona ou revoga e verifica eventos/uso; a chamada seguinte observa a mudança e retries idempotentes não criam outro segredo.

### Tests for User Story 4

- [X] T059 [P] [US4] Criar testes inicialmente falhos para redução, rotação imediata/com sobreposição, linhagem, expiração terminal, revogação e idempotência em `backend/test/api-credential-lifecycle.test.js`
- [X] T060 [P] [US4] Criar testes inicialmente falhos para cotas concorrentes, `lastUsedAt`, eventos, agregados de uso e retenção sem conteúdo sensível em `backend/test/api-credential-observability.test.js`
- [X] T061 [P] [US4] Criar testes inicialmente falhos para filtros, alertas, diálogos com justificativa, auditoria e ações de ciclo de vida em `frontend/test/admin-api-token-lifecycle.test.mjs`

### Implementation for User Story 4

- [X] T062 [US4] Implementar rotação transacional, cópia da política, linhagem, revelação nova e revogação imediata/sobreposição datada em `backend/src/lib/api-credentials/service.js`
- [X] T063 [US4] Implementar redução declarativa, concorrência otimista, expiração antecipada e revogação terminal com justificativa em `backend/src/lib/api-credentials/service.js`
- [X] T064 [US4] Aplicar `Idempotency-Key` único em criar/rotacionar/revogar, retornando conflito sem reexibir segredo quando a resposta original se perde, em `backend/src/lib/api-credentials/service.js`
- [X] T065 [US4] Implementar endpoints de rotação e revogação com contratos de erro/versão em `backend/src/routes/resources/api-credentials.js`
- [X] T066 [US4] Implementar endpoints paginados de eventos e resumo de uso por intervalo em `backend/src/routes/resources/api-credentials.js`
- [X] T067 [US4] Atualizar `lastUsedAt`, buckets e `ApiRequestLog` com contenção controlada e preservação da revogação em `backend/src/lib/api-credentials/audit.js` e `backend/src/lib/api-credentials/quota.js`
- [X] T068 [P] [US4] Completar cartões com volume recente, expiração próxima, token sem expiração e linhagem em `frontend/src/components/admin/api-tokens/ApiCredentialCards.tsx`
- [X] T069 [P] [US4] Implementar redução, rotação e revogação com `Modal`, `ConfirmDialog`, justificativa e confirmação de sobreposição em `frontend/src/components/admin/api-tokens/ApiCredentialActions.tsx`
- [X] T070 [P] [US4] Implementar histórico paginado e painel de uso sem headers/corpos/segredos em `frontend/src/components/admin/api-tokens/ApiCredentialActivity.tsx`
- [X] T071 [US4] Implementar filtros por texto, status efetivo, vencimento e escopo em query params e integrar ações/atividade em `frontend/src/pages/admin/AdminTokensPage.tsx`
- [X] T072 [US4] Estender o job de retenção para remover `ApiRequestLog`/buckets vencidos e preservar eventos de ciclo de vida conforme política, com dry-run antes de apply, em `backend/scripts/run-data-retention.js`

**Checkpoint**: US4 mantém credenciais controláveis e investigáveis durante todo o ciclo de vida.

---

## Phase 7: User Story 5 — Consultar o catálogo completo de dados mapeados (Priority: P3)

**Goal**: Exibir os 126 modelos agrupados em 20 domínios, com disponibilidade, sensibilidade, candidatos a endpoint e exclusões; somente Qualidade fica concedível.

**Independent Test**: O catálogo cobre todos os modelos Prisma, permite pesquisar cada domínio e mantém planejados/reservados/proibidos desabilitados com justificativa.

### Tests for User Story 5

- [X] T073 [P] [US5] Criar teste de cobertura que compare os 126 modelos Prisma ao inventário em código e falhe para modelo ausente, duplicado ou sem classificação em `backend/test/api-data-catalog-coverage.test.js`
- [X] T074 [P] [US5] Criar testes de UI para busca, agrupamento, badges, explicações e bloqueio de escopos não disponíveis em `frontend/test/admin-api-scope-catalog.test.mjs`

### Implementation for User Story 5

- [X] T075 [US5] Codificar os 20 domínios, 126 modelos, estados, escopos candidatos, campos/exclusões e famílias futuras definidos no catálogo em `backend/src/lib/api-credentials/data-catalog.js`
- [X] T076 [US5] Integrar o inventário ao `GET /admin/api-scopes` sem registrar/montar operações futuras e validar consistência contra `catalog.js` em `backend/src/lib/api-credentials/catalog.js`
- [X] T077 [US5] Expandir o seletor para pesquisa por domínio/modelo/código, acordeões e badges `DISPONÍVEL/PLANEJADO/SENSÍVEL/RESERVADO/PROIBIDO` em `frontend/src/components/admin/api-tokens/ApiScopeCatalog.tsx`
- [X] T078 [US5] Exibir campos incluídos/excluídos, dependências e família candidata mantendo checkbox desabilitado fora de `DISPONÍVEL` em `frontend/src/components/admin/api-tokens/ApiScopeCatalog.tsx`
- [X] T079 [US5] Criar teste de consistência entre o inventário executável e `specs/015-api-token-playground/contracts/data-catalog.md` em `backend/test/api-data-catalog-contract.test.js`

**Checkpoint**: US5 torna a expansão futura governada e auditável, sem expor automaticamente nenhum novo modelo.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Concluir adoção, acessibilidade, hardening, documentação e validação integrada.

- [X] T080 Implementar constante de lançamento, selo/cartão “Novo”, marcador por usuário/navegador e expiração global exatamente 10 dias depois em `frontend/src/pages/admin/apiTokenPlaygroundNovelty.ts`
- [X] T081 Implementar tutorial Driver.js das três etapas, menor privilégio, validade, revelação única, teste e revogação durante a mesma janela de 10 dias em `frontend/src/pages/admin/apiTokenPlaygroundTour.ts`
- [X] T082 [P] Auditar teclado, foco, leitor de tela, textos+ícones de estado, 360/768/desktop e ausência de scroll horizontal, registrando testes em `frontend/test/admin-api-tokens-responsive.test.mjs` e ajustes em `frontend/src/styles/base.css`
- [X] T083 [P] Adicionar regressão de redação para impedir token, HMAC, `Authorization`, caminhos, respostas e PII em logs/erros/telemetria em `backend/test/api-token-redaction.test.js`
- [X] T084 [P] Validar as 14 operações e todos os `$ref` do OpenAPI contra handlers/schemas reais em `backend/test/api-openapi-contract.test.js` e `specs/015-api-token-playground/contracts/openapi.yaml`
- [X] T085 Revisar timeouts, limites globais, headers `no-store`, CORS fechado e tratamento de 400/401/403/404/409/429/5xx em `backend/src/routes/integrations/v1/index.js` e `backend/src/middleware/api-request-context.js`
- [X] T086 [P] Atualizar documentação administrativa, runbook de vazamento/revogação e exemplo de cofre sem segredo em `docs/API_INTEGRACOES.md` e `docs/OPERACOES.md`
- [X] T087 Executar as suítes definidas em `backend/package.json`, `frontend/package.json` e `package.json`, corrigir falhas e confirmar build/architecture check sem iniciar servidor
- [ ] T088 Executar o roteiro de `specs/015-api-token-playground/quickstart.md` apenas em ambiente de homologação pelo operador autorizado e registrar evidências não sensíveis em `specs/015-api-token-playground/checklists/implementation.md`
- [X] T089 Revisar mudanças com code-review-graph, confirmar zero campo proibido/rota futura concedível e atualizar o status de implementação em `specs/015-api-token-playground/spec.md`

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 — Setup**: sem dependências.
- **Phase 2 — Foundational**: depende de Setup e bloqueia todas as histórias.
- **US1 e US2 (P1)**: podem começar após Foundational; podem usar fixtures separadas, mas ambas são necessárias para o MVP operacional.
- **US3 (P2)**: depende de US1 para o painel/credencial e de US2 para operações reais de Qualidade.
- **US4 (P2)**: depende de US1 para ciclo de vida e de US2 para métricas reais de uso.
- **US5 (P3)**: backend pode começar após Foundational; integração visual depende do seletor criado em US1.
- **Polish**: depende de todas as histórias escolhidas para a entrega.

### User story dependency graph

```text
Setup → Foundational ┬→ US1 ─┬→ US3
                    │       └→ US4
                    ├→ US2 ─┬→ US3
                    │       └→ US4
                    └→ US5 backend

US1 → US5 frontend
US1 + US2 → MVP operacional
US1 + US2 + US3 + US4 + US5 → Polish/Release candidate
```

### Within each user story

- Escrever os testes da história primeiro e confirmar que falham pela capacidade ausente.
- Persistência e schemas antecedem serviços; serviços antecedem rotas; rotas/clientes antecedem integração de página.
- Tarefas que editam o mesmo arquivo devem ser sequenciais mesmo quando outras tarefas da fase estão marcadas `[P]`.
- Cada checkpoint deve passar isoladamente antes de avançar para a história dependente.

## Parallel Opportunities

### User Story 1

```text
T017 backend admin tests || T018 frontend access tests || T019 frontend form tests
Após T022/T023: T027 formulário || T028 catálogo || T029 revelação || T030 cartões
```

### User Story 2

```text
T033 autenticação || T034 contrato || T035 paginação || T036 matriz de escopos
Após T038: T039 serializers || T041 naturezas || T042 evidências || T047 documentação
```

### User Story 3

```text
T048 backend playground tests || T049 frontend playground tests
Após contrato do executor: T052 seletor || T053 parâmetros || T054 console
```

### User Story 4

```text
T059 lifecycle tests || T060 observabilidade tests || T061 frontend tests
Após rotas: T068 cartões || T069 ações || T070 atividade
```

### User Story 5

```text
T073 cobertura de modelos || T074 testes de UI
T075 inventário backend pode avançar enquanto o seletor base de US1 é concluído
```

## Implementation Strategy

### MVP first

1. Concluir Setup e Foundational.
2. Concluir US1 e validar emissão administrativa isoladamente.
3. Concluir US2 e validar carga completa/incremental de Qualidade.
4. Parar no checkpoint US1 + US2 e homologar o caso original antes de ampliar a interface.

### Incremental delivery

1. **MVP**: tokens administrativos + Qualidade v1.
2. **Operabilidade**: playground visual (US3).
3. **Governança contínua**: ciclo de vida/auditoria (US4).
4. **Expansão controlada**: catálogo completo visível (US5).
5. **Release candidate**: hardening, tutorial, acessibilidade e quickstart.

### Safety boundaries

- Não iniciar servidor, Docker, deploy ou manutenção de staging/produção durante a execução das tarefas pelo agente.
- Não aplicar migração diretamente em banco compartilhado; gerar e revisar a migração no repositório para execução humana no ambiente apropriado.
- Nunca usar token real em fixture, snapshot, documentação, comando copiado ou evidência de homologação.
- Não implementar endpoints futuros só porque aparecem no catálogo; sua habilitação exige nova especificação/revisão.

## Phase 10: Incremento operacional e seleção unificada (adendo 2026-09-08)

- [x] T090 Registrar contrato tipado das coleções operacionais em `contracts/operational-read.md` e OpenAPI, preservando exclusões e candidatos pendentes.
- [x] T091 Implementar e testar descritores, projeções, isolamento de projetos e paginação em `backend/src/lib/api-credentials/operational-*.js` e `backend/test/integration-operational-api.test.js`.
- [x] T092 Montar endpoints medidos e integrar catálogo/simulação em `backend/src/routes/integrations/v1/operational.js`, `catalog.js`, `playground.js` e rota administrativa.
- [x] T093 Unificar seleção por domínio no catálogo e alimentar operações/parâmetros pelo servidor em `frontend/src/components/admin/api-tokens/` e `AdminTokensPage.tsx`.
- [x] T094 Executar gates locais, atualizar documentação de consumo e registrar alcance/pendências deste incremento, sem migração/deploy.
- [x] T095 Corrigir reserva de página maior que a cota diária e cobrir regressão em `quota.js`/`api-token-foundation.test.js`.

T090–T095 concluídas localmente em 2026-09-08. A homologação própria das coleções novas permanece roteiro do operador em `quickstart.md`, seção 12; não foi executada em banco real. Os demais candidatos do catálogo não fazem parte deste incremento e não foram habilitados. T088 conserva seu registro original de evidências/aceite operacional.

## Phase 11: Relatórios, estoque e manutenção (solicitação 2026-09-08)

- [x] T096 Definir expansão e limites em `contracts/operational-expanded-read.md`.
- [x] T097 Criar testes de contrato, isolamento, paginação composta e downloads em `backend/test/integration-expanded-api.test.js`.
- [x] T098 Implementar as 13 coleções adicionais, dependências e paginação no serviço operacional.
- [x] T099 Implementar os três downloads autenticados com validação de propriedade/caminho e medição.
- [x] T100 Disponibilizar permissões e parâmetros no Playground, atualizar OpenAPI e testes de UI.
- [x] T101 Executar gates locais e atualizar documentação de consumo/evidências, sem migração ou deploy.

T096–T101 concluídas localmente em 2026-09-08. Resultado: 16 novos escopos, 13 novas coleções e 3 downloads (33 escopos e 35 operações externas no total). Gates: 191 arquivos de teste backend e 49 frontend aprovados; 25 cenários dedicados da expansão; OpenAPI e projeções contra Prisma; build TypeScript/Vite, ESLint dos componentes alterados e architecture:check aprovados. Build mantém aviso de chunks grandes, sem erro.

Navegador existente em 5174, somente fixtures: payload de estoque preservou itemId e converteu corretamente criação local para UTC; selecionar custos incluiu itens e movimentos sem emitir token. Layout conferido em 360/768/1440, com largura de rolagem do main igual à largura disponível (345/753/1425), sem overflow horizontal da página. Capturas locais ignoradas pelo git em `output/playwright/expanded-api-{360,768,1440}.png`. Sessão de teste encerrada. Não foram usados dados/segredos reais, nem executados migração, deploy ou homologação em banco real. Roteiro do operador em `quickstart.md`, seção 13; T088 permanece pendente, fora do aceite local.

## Phase 12: Testar qualquer permissão implementada (2026-09-08)

- [x] T102 Registrar contrato do Playground genérico em `contracts/generic-playground.md`.
- [x] T103 Escrever testes de cobertura por escopo/parâmetro, downloads e validação genérica de formulário.
- [x] T104 Publicar descritores de parâmetros e habilitar verificação segura dos quatro downloads no executor administrativo.
- [x] T105 Implementar seleção por permissão e formulário genérico RHF/Zod, removendo condições específicas de Qualidade da página.
- [x] T106 Atualizar OpenAPI, documentação/tutorial e executar testes, build, lint e validação visual local.

Evidências do incremento (2026-09-08): backend com 191 arquivos de teste e frontend com 50 arquivos aprovados; build TypeScript/Vite, ESLint dos arquivos frontend envolvidos, architecture:check e git diff --check aprovados. Vite mantém o aviso já existente de chunks acima de 500 kB. Backend validado com ambiente de teste e URL fictícia, sem banco real. No Playwright, com APIs interceptadas e credenciais fictícias, foram confirmados consulta de estoque sem ID, erro acessível de ID obrigatório sem envio, verificação JSON de anexo, limpeza de ID/resposta ao trocar operação e bloqueio de credencial sem permissão/dependências. Busca após seleção preserva o texto digitado (correção pontual no SearchCombobox). Capturas locais em output/playwright/generic-api-{360,768,1440}.png, sem overflow horizontal nessas larguras. OpenAPI 1.3.0, contrato genérico, quickstart, tutorial e documentação atualizados. T088 continua pendente de aceite do operador; sem migração nova, deploy ou alteração de servidor.

## Phase 13: Correções da revisão C1/C2/I1–I4 (2026-09-08)

As marcações históricas T013/T054/T056/T069/T070/T078 não comprovam o aceite das lacunas encontradas. Esta fase registra o trabalho remanescente autorizado pelo usuário; T088 continua exclusivo do operador.

- [X] T107 Detalhar contrato e sequência de correção em `contracts/admin-corrections.md`, `spec.md` e `plan.md`.
- [X] T108 Escrever regressões backend para parâmetros operacionais/IDs/cursores inválidos antes de Prisma e catálogo de campos, em `backend/test/api-admin-corrections.test.js`.
- [X] T109 Corrigir validação em `playground.js`, `service.js` e rotas administrativas; padronizar erro seguro com requestId sem alterar a API externa.
- [X] T110 Escrever regressões de formulários, redução/rotação, paginação/navegação e erro do console em `frontend/test/admin-api-corrections.test.mjs`.
- [X] T111 Completar formulários RHF/Zod de redução/rotação/revogação, edição de política com dependências, confirmação e datas locais em `ApiCredentialActions.tsx` e helpers compartilhados.
- [X] T112 Paginar tokens/eventos, mostrar ator/resumo e preservar credencial/detalhe por URL sem fallback silencioso em `AdminTokensPage.tsx` e `ApiCredentialActivity.tsx`.
- [X] T113 Exibir falhas completas e seguras no console, limpar sucesso anterior e descartar respostas atrasadas em cliente/página/console.
- [X] T114 Declarar campos reais dos cinco escopos de Qualidade em `catalog.js`, alinhados aos serializadores e OpenAPI.
- [X] T115 Atualizar contratos/documentação/tutorial e validar testes completos, build, lint, arquitetura e UI com fixtures em 360/768/1440, sem servidor/deploy/migração.

Ordem: T107 → T108 → T109; T110 antecede T111–T113; T108 antecede T114; T115 encerra somente após os aceites locais. Permissões futuras permanecem bloqueadas e tokens existentes não são ampliados automaticamente.

Concluída a correção local em 2026-09-08. Evidências em `contracts/admin-corrections-evidence.md`: 192 arquivos backend e 51 frontend aprovados, build/lint/arquitetura/diff sem falhas, navegador com APIs interceptadas e responsividade 360/768/1440. OpenAPI 1.3.1 documenta o envelope administrativo compatível. Aviso preexistente de tamanho de chunks mantido. Sem hooks de implementação registrados. T088 permanece aberta; nenhuma ação em servidor, migração ou token real.

## Notes

- `[P]` indica arquivos diferentes e dependências satisfeitas, não autorização para ignorar checkpoints.
- Cada tarefa inclui o arquivo de destino e deve terminar com teste proporcional ao risco.
- Commits devem agrupar uma tarefa ou conjunto lógico pequeno e nunca incluir os arquivos não relacionados já presentes no worktree.
- O checklist de implementação criado em T088 não pode conter segredo, Authorization, resposta integral ou dados pessoais.
