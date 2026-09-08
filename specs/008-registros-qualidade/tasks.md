---
description: "Task list — Módulo de Registros de Qualidade (008)"
---

# Tasks: Módulo de Registros de Qualidade

**Input**: Design documents from `/specs/008-registros-qualidade/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/qualidade-api.md, quickstart.md

**Tests**: Testes de backend são **obrigatórios** aqui (Constituição, Princípio V) para numeração,
concorrência, recorrência, unicidade/proteção de Natureza, disposição condicional e papéis. Tarefas
de teste marcadas com ⚠️ devem ser escritas antes da implementação e falhar primeiro.

**Organization**: Tarefas agrupadas por user story (spec.md) para implementação/entrega incremental.

## Path Conventions (web app — ver plan.md)

- Backend: `backend/src/…`, testes em `backend/test/…`
- Schemas compartilhados: `shared/schemas/…`
- Frontend: `frontend/src/…`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Esqueleto de arquivos do módulo, sem lógica.

- [X] T001 [P] Criar stubs de domínio backend: `backend/src/lib/qualidade/service.js`, `backend/src/lib/qualidade/numbering.js`, `backend/src/lib/qualidade/recurrence.js` (exports vazios) e `backend/src/routes/resources/qualidade.js` (router vazio)
- [X] T002 [P] Criar `shared/schemas/qualidade.js` com `makeQualidadeSchemas(z)` (assinatura + placeholders), espelhando `shared/schemas/estoque.js`
- [X] T003 [P] Criar esqueleto frontend `frontend/src/pages/qualidade/QualidadePage.tsx` (componente vazio) e pasta do módulo

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, permissões, roteamento e shell — pré-requisito de TODAS as stories.

**⚠️ CRITICAL**: Nenhuma user story começa antes desta fase.

- [X] T004 Adicionar enums `QualityRecordType` (DESVIO/LICAO_APRENDIDA/INCIDENTE/RECLAMACAO_CLIENTE/MELHORIA), `QualityImpact`, `QualityDisposition`, `QualityStatus` e estender `AppModule` (+QUALIDADE) e `ModuleRoleCode` (+QUALIDADE_MANAGER, +QUALIDADE_VIEWER) em `backend/prisma/schema.prisma`
- [X] T005 Adicionar models `QualityNature`, `QualityRecord`, `QualityRecordSeq` (campos, relações `Project`/`QualityNature`, índices `@@unique([number])`, `@@unique([type, year, seq])`, `@@index([projectId, type])`, `@@index([natureId, eventDate])`) em `backend/prisma/schema.prisma` conforme data-model.md (depende T004)
- [X] T006 Criar migration Prisma versionada do módulo (nome `qualidade`) em `backend/prisma/migrations/` e documentar aplicação para o operador (bloco "rode no servidor" — o agente não executa; Princípio I) (depende T005)
- [X] T007 [P] Índice único case-insensitive de `QualityNature.name` (lower(name)) — via migration/coluna gerada — documentado em `deploy/` se aplicado manualmente (depende T005)
- [X] T008 [P] Adicionar `requireQualidadeAccess` e `requireQualidadeManager` em `backend/src/middleware/auth.js`, espelhando `requireEstoqueAccess`/`requireEstoqueManager`
- [X] T009 [P] Definir constantes/rótulos pt-BR dos selects (tipos+letra, impactos, disposições, status) e o mapa Tipo→letra em `shared/schemas/qualidade.js`
- [X] T010 Montar rota: `router.use('/qualidade', qualidadeRouter)` em `backend/src/routes/index.js`; aplicar `requireAuth` + `requireQualidadeAccess` em `backend/src/routes/resources/qualidade.js`
- [X] T011 [P] `GET /qualidade/naturezas` (só ativas por padrão; flag `includeInactive`; campo `inUse`) — endpoint + `service.js listNatures` (compartilhado por US1 e US4) em `backend/src/lib/qualidade/service.js` e `backend/src/routes/resources/qualidade.js`
- [X] T012 [P] Registrar o módulo Qualidade no Hub (`frontend/src/pages/hubModules.ts`) e rota da página
- [X] T013 Shell do módulo `frontend/src/pages/qualidade/QualidadePage.tsx`: abas Registros/Naturezas com estado em `?tab=`, usando shell largo `.equip-page` e nav `.equip-nav-item` + `select` mobile (referência auditada: `frontend/src/pages/estoque/EstoquePage.tsx` e `frontend/src/pages/acompanhamento/AcompanhamentoPage.tsx`)

**Checkpoint**: Fundação pronta — user stories podem começar.

---

## Phase 3: User Story 1 - Registrar um evento de qualidade (Priority: P1) 🎯 MVP

**Goal**: Gestor cria registros; sistema gera o Nº automático por tipo/ano e lista na tabela.

**Independent Test**: Com ≥1 Natureza existente (criada no setup do teste), criar um Desvio (2026) e
confirmar `D-001/26` na tabela; criar segundo (2026)→`D-002/26`; Desvio em 2027→`D-001/27`; Melhoria→`M-`.

### Tests for User Story 1 ⚠️

- [X] T014 [P] [US1] Teste: numeração sequencial por (tipo, ano) e reinício por ano em `backend/test/qualidade.test.js`
- [X] T015 [P] [US1] Teste: criação concorrente do mesmo tipo/ano gera Nº únicos (sem colisão) em `backend/test/qualidade.test.js`
- [X] T016 [P] [US1] Teste: validação do POST — campos obrigatórios e regra Disposição=TRATAR exige `definedAction` em `backend/test/qualidade.test.js`

### Implementation for User Story 1

- [X] T017 [P] [US1] Schema Zod `recordCreateSchema` com `superRefine` (Tratar→definedAction obrigatório) em `shared/schemas/qualidade.js`
- [X] T018 [US1] `numbering.js`: geração atômica do sequencial via upsert em `QualityRecordSeq` dentro da transação (ano = ano de `registeredAt`) em `backend/src/lib/qualidade/numbering.js`
- [X] T019 [US1] `service.js createRecord`: valida, resolve `projectId|null` (Interno/SGQ), `natureId`, chama numbering e persiste em transação (`backend/src/lib/qualidade/service.js`) (depende T018)
- [X] T020 [US1] `POST /qualidade/registros` (manager) + `GET /qualidade/registros` (paginação/filtros q/type/status/impact/projectId/natureId) + `GET /qualidade/registros/:id` em `backend/src/routes/resources/qualidade.js` (depende T019)
- [X] T021 [US1] `QualityRecordsTab.tsx`: tabela + `SearchBar`/`Skeleton` de `components/ui/`, ações por linha, alternativa empilhada (tabela→cards) em mobile; referência auditada `frontend/src/pages/estoque/StockItemsTab.tsx` (`frontend/src/pages/qualidade/QualityRecordsTab.tsx`)
- [X] T022 [US1] `QualityRecordFormModal.tsx` (criar): `Modal` (rodapé fixo/corpo rolável) + react-hook-form + resolver Zod; `select` estilizado do kit para Tipo/Impacto/Disposição/Status; dropdowns de Projeto (+opção "Interno/SGQ") e Natureza (ativas via T011); Data do Registro default = hoje; referência auditada `frontend/src/pages/estoque/StockItemFormModal.tsx` (`frontend/src/pages/qualidade/QualityRecordFormModal.tsx`)
- [X] T023 [US1] Ligar react-query (create + list) e toast de sucesso/erro; integrar Tab + Modal na `QualidadePage.tsx`

**Checkpoint**: US1 funcional e testável — MVP.

---

## Phase 4: User Story 2 - Editar e excluir registros (Priority: P1)

**Goal**: Gestor edita qualquer campo (exceto Nº e Tipo) e exclui registros com confirmação; viewer é somente leitura.

**Independent Test**: Editar Impacto/Status de um registro (Nº imutável, Tipo desabilitado); excluir com confirmação; viewer não vê ações e chamadas diretas retornam 403.

### Tests for User Story 2 ⚠️

- [X] T024 [P] [US2] Teste: viewer bloqueado (403) em POST/PUT/DELETE; manager autorizado em `backend/test/qualidade.test.js`

### Implementation for User Story 2

- [X] T025 [US2] `service.js updateRecord` (campos editáveis, exceto `number`/`type`) e `deleteRecord` em `backend/src/lib/qualidade/service.js`
- [X] T026 [US2] `PUT /qualidade/registros/:id` e `DELETE /qualidade/registros/:id` (manager) em `backend/src/routes/resources/qualidade.js` (depende T025)
- [X] T027 [US2] Modo edição em `QualityRecordFormModal.tsx` (campo Tipo desabilitado; Nº somente leitura) e ações Editar/Excluir na linha com `ConfirmDialog` de `components/ui/` (`frontend/src/pages/qualidade/QualityRecordsTab.tsx`)
- [X] T028 [US2] Ocultar ações de mutação (Registrar/Editar/Excluir) para papel Visualizador na UI (`frontend/src/pages/qualidade/`)

**Checkpoint**: US1 + US2 funcionando de forma independente.

---

## Phase 5: User Story 4 - Gerenciar Naturezas (Priority: P2)

**Goal**: Aba Naturezas com CRUD; nome único; exclusão bloqueada quando em uso; inativas somem de novos registros.

**Independent Test**: Cadastrar "Atraso de mobilização" → aparece no dropdown do formulário; duplicar (case diferente)→bloqueado; excluir Natureza em uso→bloqueado; desativar→some de novos registros mas continua nos antigos.

### Tests for User Story 4 ⚠️

- [X] T029 [P] [US4] Teste: nome único case-insensitive; exclusão bloqueada quando referenciada; desativação remove da lista ativa em `backend/test/qualidade.test.js`

### Implementation for User Story 4

- [X] T030 [P] [US4] Schema Zod de Natureza (create/rename) em `shared/schemas/qualidade.js`
- [X] T031 [US4] `service.js`: `createNature`/`renameNature`/`setNatureActive`/`deleteNature` (com checagem de uso) em `backend/src/lib/qualidade/service.js`
- [X] T032 [US4] `POST`/`PUT`/`PATCH /naturezas/:id/ativo`/`DELETE` de `/qualidade/naturezas` (manager); `409` em duplicidade e em exclusão de Natureza em uso em `backend/src/routes/resources/qualidade.js` (depende T031)
- [X] T033 [US4] `QualityNaturesTab.tsx` + `QualityNatureFormModal.tsx` (tabela→cards, `Modal`/`Button`/`ConfirmDialog`); referência auditada `frontend/src/pages/estoque/StockCategoriesTab.tsx` e `StockCategoryFormModal.tsx` (`frontend/src/pages/qualidade/`)
- [X] T034 [US4] Garantir que o dropdown de Natureza do formulário de registro use só ativas (T011) e que registros existentes exibam a Natureza mesmo se inativada

**Checkpoint**: US1, US2 e US4 independentes.

---

## Phase 6: User Story 3 - Desvios no card do projeto (Priority: P2)

**Goal**: Seção somente leitura "Desvios" no detalhe do projeto no Acompanhamento, listando só Desvios daquele projeto.

**Independent Test**: 2 Desvios + 1 Melhoria no Projeto X → card mostra só os 2 Desvios; Desvio Interno/SGQ não aparece; projeto sem Desvios mostra estado vazio.

### Tests for User Story 3 ⚠️

- [X] T035 [P] [US3] Teste: endpoint de desvios por projeto retorna só `type=DESVIO` do projeto, exclui outros tipos e Interno/SGQ em `backend/test/qualidade.test.js`

### Implementation for User Story 3

- [X] T036 [US3] `GET /qualidade/registros/projeto/:projectId/desvios` (campos enxutos Nº/Natureza/Impacto/Status) + `service.js listProjectDeviations` em `backend/src/lib/qualidade/service.js` e `backend/src/routes/resources/qualidade.js`
- [X] T037 [US3] Seção "Desvios" somente leitura em `frontend/src/components/projects/ProjectDetailDashboard.tsx` (reusa cards/badges do detalhe; link para o módulo; estado vazio "Nenhum desvio registrado"; empilha em mobile sem estourar o card)
- [X] T038 [US3] Campanha de novidade 10 dias (card centralizado `driver.js` + marcador `localStorage` por usuário/navegador + expiração global 10 dias após a data de implementação) para a seção Desvios, no padrão do aviso de DDS (`frontend/src/components/projects/`)

**Checkpoint**: US3 entregue; integração aditiva sem tocar custo/missões.

---

## Phase 7: User Story 5 - Recorrência automática (Priority: P3)

**Goal**: Ocorrências 12m e Recorrente? calculados por Natureza (janela de 12 meses sobre a Data do Evento; ≥3 → SIM), somente leitura.

**Independent Test**: 2 registros "Stand By" na janela → Ocorrências=2/Recorrente=não; 3º na janela → 3/SIM; um fora da janela não conta.

### Tests for User Story 5 ⚠️

- [X] T039 [P] [US5] Teste: cálculo de recorrência por Natureza — janela 12m, limite ≥3, exclusão de eventos fora da janela em `backend/test/qualidade.test.js`

### Implementation for User Story 5

- [X] T040 [US5] `recurrence.js`: função pura (datas por Natureza → occurrences por registro) em `backend/src/lib/qualidade/recurrence.js`
- [X] T041 [US5] Enriquecer respostas de `GET /qualidade/registros` e `/:id` com `occurrences12m` e `recurrent` (agregação por Natureza, sem N+1) em `backend/src/lib/qualidade/service.js`
- [X] T042 [US5] Exibir colunas/campos Ocorrências 12m e Recorrente? (somente leitura) na tabela e no modal (`frontend/src/pages/qualidade/QualityRecordsTab.tsx`, `QualityRecordFormModal.tsx`)

**Checkpoint**: Todas as user stories independentes e funcionais.

---

## Phase 8: User Story 6 - Exportar registros para xlsx (Priority: P3)

**Goal**: Botão Exportar na aba Registros gera/baixa um `.xlsx` no layout FR-3-4-11-01, respeitando os filtros ativos.

**Independent Test**: Com registros cadastrados, clicar em Exportar e confirmar que o `.xlsx` abre com uma linha por registro e as colunas na ordem da referência; com filtro ativo, só os filtrados; tabela vazia → só cabeçalho.

### Tests for User Story 6 ⚠️

- [X] T043 [P] [US6] Teste: montagem do `.xlsx` — cabeçalho na ordem FR-3-4-11-01, nº de linhas conforme filtro e escape de XML em `backend/test/qualidade.test.js`

### Implementation for User Story 6

- [X] T044 [US6] `export-xlsx.js`: montar o pacote OOXML com `adm-zip` (inline strings; datas `dd/mm/aaaa`; Recorrente? "SIM"/"não"; projeto=código/nome ou "Interno/SGQ") em `backend/src/lib/qualidade/export-xlsx.js` (reusa `service.js` para buscar os registros com os mesmos filtros e derivados)
- [X] T045 [US6] `GET /qualidade/registros/export` (mesmos filtros do list, sem paginação) com `Content-Type` de spreadsheet e `Content-Disposition: attachment` em `backend/src/routes/resources/qualidade.js`
- [X] T046 [US6] Botão **Exportar** (`Button` de `components/ui/`) na `QualityRecordsTab.tsx` disparando o download com os filtros atuais; barra de ações (Registrar/Exportar) quebra sem estourar em mobile (`frontend/src/pages/qualidade/QualityRecordsTab.tsx`)

**Checkpoint**: Exportação funcional; todas as user stories entregues.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T047 [P] Onboarding permanente de primeiro acesso do módulo Qualidade (módulo novo) no padrão do app (`frontend/src/pages/qualidade/`)
- [X] T048 Continuidade de navegação: verificar que `?tab=registros|naturezas` persiste no refresh/deep-link e que params incompatíveis são limpos ao trocar de aba (`frontend/src/pages/qualidade/QualidadePage.tsx`)
- [X] T049 Auditoria de overflow mobile: tabela→cards, barra de abas (select mobile), barra de ações (Registrar/Exportar), badges/Nº/valores longos e lista de Desvios em larguras de celular, com `min-width:0` em filhos de grid/flex e sem scroll horizontal de página
- [X] T050 Passe de consistência visual: selects com estados default/focus/disabled/error/empty; shell largo `.equip-page`; modal com rodapé fixo e corpo rolável; tokens de `variables.css` (sem hex/px hardcoded)
- [X] T051 [P] Documentar em `deploy/` a aplicação da migration e do índice único (blocos "rode no servidor")
- [X] T052 Rodar validação do `quickstart.md` (incl. `npm test -- qualidade`) — apresentar comandos como "rode no servidor"

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências.
- **Foundational (Phase 2)**: depende do Setup — **BLOQUEIA** todas as user stories. T005 depende de T004; T006/T007 dependem de T005.
- **User Stories (Phases 3–8)**: dependem da Fase 2. Depois disso, podem ser paralelizadas por dev.
- **Polish (Phase 9)**: depende das stories desejadas concluídas.

### User Story Dependencies

- **US1 (P1)**: após Fundação. Requer ≥1 Natureza no teste (criada via Prisma no setup).
- **US2 (P1)**: após Fundação (usa o registro/serviço de US1, mas testável isolada).
- **US4 (P2)**: após Fundação. Independente; a listagem ativa de Natureza (T011) já é fundacional.
- **US3 (P2)**: após Fundação. Requer registros do tipo Desvio (criados no teste) — independente.
- **US5 (P3)**: após Fundação. Enriquece leitura; independente das mutações.
- **US6 (P3)**: após Fundação. Usa a busca/derivados de `service.js` (US1/US5) para montar o `.xlsx`; testável isolada com registros de teste.

### Within Each User Story

- Testes ⚠️ escritos e falhando antes da implementação.
- Models/domínio antes de serviço; serviço antes de endpoint; endpoint antes de UI.

### Parallel Opportunities

- Setup: T001, T002, T003 em paralelo.
- Foundational: T007, T008, T009, T011, T012 marcados [P] (arquivos distintos) após T005/T010 conforme dependência.
- Após a Fundação: US1, US2, US4, US3, US5 podem correr em paralelo por devs diferentes.
- Testes marcados [P] de uma mesma story rodam juntos.

---

## Parallel Example: User Story 1

```bash
# Testes de US1 juntos:
Task: "T014 numeração por tipo/ano + reinício anual em backend/test/qualidade.test.js"
Task: "T015 concorrência gera Nº únicos em backend/test/qualidade.test.js"
Task: "T016 validação do POST + Disposição=Tratar em backend/test/qualidade.test.js"

# Schema Zod em paralelo à camada de teste:
Task: "T017 recordCreateSchema com superRefine em shared/schemas/qualidade.js"
```

---

## Implementation Strategy

### MVP First (US1)

1. Fase 1: Setup → 2. Fase 2: Foundational (crítico) → 3. Fase 3: US1 → 4. **Validar US1** → demo.

### Incremental Delivery

Setup + Foundational → US1 (MVP) → US2 → US4 → US3 → US5 → US6, testando cada story de forma isolada.

### Parallel Team Strategy

Depois da Fundação: Dev A → US1/US2 (registro/edição); Dev B → US4 (naturezas) + US6 (exportação);
Dev C → US3 (integração card) + US5 (recorrência). Integração independente por story.

---

## Notes

- [P] = arquivos diferentes, sem dependência mútua.
- Migrations e comandos de servidor: sempre "rode no servidor" (Princípio I) — o agente não executa.
- Nº Registro é imutável; Tipo é imutável na edição (v1).
- Ocorrências 12m/Recorrente? são derivados (não persistidos).
- Commit após cada tarefa ou grupo lógico; parar em cada checkpoint para validar a story.
