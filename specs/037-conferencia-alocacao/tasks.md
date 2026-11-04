---
description: "Lista de tarefas da feature 037: Conferência semanal de alocação"
---

# Tasks: Conferência semanal de alocação

**Input**: documentos de `specs/037-conferencia-alocacao/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/allocation-review-api.md, quickstart.md

**Tests**: incluídos. A constituição (Princípio V) exige testes em `backend/test` para regra de
negócio nova. Os testes usam `node:test` + `node:assert/strict`, com fakes passados como
`client` ou métodos substituídos no singleton do prisma e restaurados em `t.after`. Sem
biblioteca de mock.

**Organization**: tarefas agrupadas por história, para cada uma ser implementada e validada de
forma independente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivo diferente, sem depender de tarefa incompleta).
- **[Story]**: história da spec (US1 a US5).
- Referências como "R1" ou "FR-004" apontam para research.md e spec.md.

## Path Conventions

Aplicação web: `backend/src/`, `backend/test/`, `frontend/src/` e `shared/`.

---

## Phase 1: Setup

**Purpose**: estrutura de pastas e registro do papel novo.

- [X] T001 Criar a pasta `backend/src/lib/efetivo/allocation-review/` com um `index.js` que reexporta os módulos (`suggestion`, `read-model`, `service`, `confirmed-days`, `absence-alerts`, `schemas`), mesmo vazios por enquanto.
- [X] T002 [P] Adicionar o papel `{ code: 'EFETIVO_ALLOCATION_REVIEW', public: 'efetivo:allocation-review', label: 'Conferência de alocação', accountTypes: [...] }` em `shared/modules/registry.json`, no módulo Efetivo (perto da linha 663), e incluí-lo em `hub.roles` (perto da 628) e em `routeGroups.default.allowedModuleRoles` (647-660). Assim o papel sozinho abre o módulo. Os `accountTypes` são os mesmos de `efetivo:viewer`.
- [X] T003 Regenerar `frontend/src/modules/registry.generated.ts` com `npm run modules:generate` (`scripts/generate-module-registry.mjs`) e conferir o diff.

---

## Phase 2: Foundational (bloqueia todas as histórias)

**Purpose**: schema, migration, acesso e validação comuns.

- [X] T004 Adicionar em `backend/prisma/schema.prisma`:
  - os enums `AllocationReviewKind`, `AllocationReviewWeekStatus`, `AllocationReviewEventType` e `AllocationReviewAlertStatus`;
  - o valor `EFETIVO_ALLOCATION_REVIEW` em `ModuleRoleCode` (linhas 128-155);
  - os modelos `AllocationReviewWeek`, `AllocationReviewWeekEvent`, `AllocationReviewRow`, `AllocationReviewDay`, `AllocationReviewDayProject` e `AllocationReviewAbsenceAlert`, exatamente como em data-model.md;
  - as relações inversas em `Collaborator` e `Project`.
- [X] T005 Criar a migration `backend/prisma/migrations/<timestamp>_allocation_review/migration.sql` com `npx prisma migrate dev --create-only --name allocation_review`. Conferir que o `ALTER TYPE "ModuleRoleCode" ADD VALUE 'EFETIVO_ALLOCATION_REVIEW'` aparece, seguindo o padrão de `migrations/20260909230000_project_mobilization_gate/migration.sql`. Sem backfill. _(Sem banco local: migration gerada com `prisma migrate diff --from-schema … --to-schema …` a partir do schema da HEAD.)_
- [X] T006 [P] Criar `backend/test/allocation-review-migration.test.js`, no padrão PGlite de `backend/test/allocation-monthly-report-migration.test.js`. Validar que a migration aplica, que os uniques `[collaboratorId, workDate]` e `[weekId, collaboratorId]` existem e que o valor novo do enum existe.
- [X] T007 [P] Em `backend/src/lib/efetivo/access.js`:
  - criar `canReviewAllocation(user)` (ADMIN ou `efetivo:allocation-review`);
  - criar `requireAllocationReviewer` (403 com `{ error: 'Acesso restrito à conferência de alocação.', code: 'ALLOCATION_REVIEW_FORBIDDEN' }`);
  - criar `isAppAdmin(user)`;
  - incluir `'efetivo:allocation-review'` em `EFETIVO_ACCESS_ROLES`, para o módulo abrir.
- [X] T008 [P] Criar `backend/src/lib/efetivo/allocation-review/schemas.js` com os schemas Zod do contrato:
  - `weekStartParam`: `YYYY-MM-DD` e segunda-feira (erro `INVALID_WEEK_START`);
  - `saveDaysBody`: 1 a 200 itens, com o refine kind↔projectIds de data-model.md;
  - `discardDaysBody`;
  - `confirmRowsBody` (`collaboratorIds` ou `{ allReady: true }`), `unconfirmRowsBody` e `reopenBody`;
  - leitura do header `If-Match-Version`.
- [X] T009 [P] Criar a função pura `nthBusinessDayOfMonth(yearMonth, n, holidayDates)` em `backend/src/lib/calendar/business-day-deadline.js`. Ela reaproveita `isBusinessDay` de `backend/src/lib/efetivo/planning/business-days.js:12`, conta o dia 1º quando ele é útil e devolve `YYYY-MM-DD`. Criar também `weekStartsTouchingMonth(yearMonth)`, que devolve as segundas-feiras das semanas com dias no mês.
- [X] T010 [P] Criar `backend/test/business-day-deadline.test.js`:
  - dia 1º sexta, sem feriados → dia 5;
  - dia 1º sábado → dia 5;
  - feriado na segunda depois de um dia 1º sexta → dia 6;
  - semanas que tocam out/2026 incluem 2026-10-26, cuja semana termina em 2026-11-01.
- [X] T011 Criar o router vazio `backend/src/routes/resources/allocation-review.js` (`requireAuth` + `requireAllocationReviewer`) e montá-lo em `backend/src/routes/index.js` como `router.use('/efetivo/conferencia-alocacao', allocationReviewRouter)`, **antes** de `router.use('/efetivo', efetivoRouter)` (linha 86).
- [X] T012 [P] Criar `frontend/src/api/allocationReview.ts` com os tipos TypeScript do contrato (`AllocationReviewWeekResponse`, `ReviewDayView`, `RowView`, `AllocationReviewKind`) e as funções de cliente (`getAllocationReviewWeek`, `saveAllocationReviewDays`, `discardAllocationReviewDays`, `confirmAllocationReviewRows`, `unconfirmAllocationReviewRows`, `closeAllocationReviewWeek`, `reopenAllocationReviewWeek` e `getAllocationReviewPendingCount`), usando `apiClient` e enviando `If-Match-Version`.

**Checkpoint**: migration aplicada localmente, papel visível na gestão de usuários e rota protegida respondendo 403 para quem não tem o papel.

---

## Phase 3: User Story 1 - Ver a semana preenchida e o que não bate (Priority: P1) 🎯 MVP

**Goal**: grade semanal **só leitura**, com sugestão, CNPJ, indicadores das três fontes e pendências.

**Independent Test**: abrir `/efetivo?section=conferencia&semana=<segunda>` e conferir sugestões, CNPJ, indicadores, filtros, busca e persistência após F5, sem nenhuma gravação (US1, cenários 1 a 6).

### Tests for User Story 1

- [X] T013 [P] [US1] Criar `backend/test/allocation-review-suggestion.test.js` cobrindo a FR-004 (prioridades 1 a 6) e os indicadores `confirms`, `diverges` e `none` para:
  - ponto = RDO = Efetivo;
  - etiqueta diferente do RDO (o RDO vence e a etiqueta diverge);
  - ponto sem etiqueta → Sede;
  - fim de semana sem ponto → Folga sem pendência;
  - feriado sem ponto → Folga;
  - dia útil vazio → `NONE` pendente;
  - ausência FERIAS vence tudo;
  - etiqueta de viagem → `TRAVEL` com o projeto do Efetivo ou da etiqueta;
  - dois RDOs no dia → `PROJECT` com os dois projetos.
- [X] T014 [P] [US1] Criar `backend/test/allocation-review-read-model.test.js`:
  - quem entra na grade: operacionais ativos, mais quem teve ponto ou RDO na semana (R3);
  - dias fora do vínculo como `eligible: false`;
  - `isFuture`, `isHoliday` e `summary`;
  - agrupamento por `mainProjectId`.

### Implementation for User Story 1

- [X] T015 [US1] Implementar `backend/src/lib/efetivo/allocation-review/suggestion.js`. A função pura `suggestDay({ trail, absence, isWeekend, isHoliday })` recebe a trilha de `classifyProjectHours` (campos listados em research R2) e devolve `{ suggestion, sources, pending, pendingReason, reasons }`. A viagem é detectada por `trail.travelContext` e pelas etiquetas "viagem". Os motivos vêm em pt-BR.
- [X] T016 [US1] Exportar de `backend/src/lib/acompanhamento/allocation-audit.js` uma função `getTrailsForRange({ from, to })`. Ela reaproveita `loadTrails()` (com cache por fingerprint) e devolve as trilhas por colaborador e data, mais `projectsById`. O comportamento atual de `getAllocationAudit` não muda.
- [X] T017 [US1] Implementar `backend/src/lib/efetivo/allocation-review/read-model.js`, com `getReviewWeek({ weekStart, now })`:
  - colaboradores elegíveis pela regra de `backend/src/lib/efetivo/planning/read-model.js:108-116` e `capacity.js:92-101`;
  - trilhas de T016;
  - `CollaboratorAbsence` da semana, sem `deletedAt`;
  - feriados por `loadCorporateCalendar` (`backend/src/lib/calendar/corporate-calendar.js:109`);
  - RDOs com número e situação para o painel;
  - projetos com `clientName`, `clientCnpj` formatado (`backend/src/lib/cnpj.js`) e `isActive`.

  Por enquanto, sem nada gravado: `week.status = OPEN` e `version = 0` quando não houver registro. Montar a resposta do contrato.
- [X] T018 [US1] Adicionar `GET /semanas/:weekStart` em `backend/src/routes/resources/allocation-review.js`, validado por `weekStartParam` e chamando `getReviewWeek`. Criar `backend/test/allocation-review-routes.test.js` com os casos 400 (data que não é segunda), 403 (sem papel) e 200 (com papel).
- [X] T019 [P] [US1] Registrar a seção `conferencia` em `frontend/src/utils/planningNavigation.ts`: `EFETIVO_SECTIONS` e `PARAMS_BY_SECTION.conferencia = ['semana', 'mostrar', 'agrupar', 'q']`, com limpeza de parâmetros incompatíveis via `setPlanningSectionParams`.
- [X] T020 [US1] Em `frontend/src/pages/efetivo/EfetivoPage.tsx`:
  - incluir em `SECTIONS` (linhas 34-42) `{ id: 'conferencia', label: 'Conferência', description: 'Conferir a alocação semanal' }`;
  - filtrar `SECTIONS` por permissão antes de passar para `EfetivoAppShell.tsx` e `EfetivoSectionNavigation.tsx`. A Conferência aparece para ADMIN ou `efetivo:allocation-review` (`hasModuleRole`, `frontend/src/auth/rolePath.ts:23-28`). Quem tem só esse papel vê só a Conferência e cai nela por padrão;
  - adicionar o branch de render da seção.
- [X] T021 [P] [US1] Criar `frontend/src/pages/efetivo/components/allocationReviewPresentation.ts` com:
  - rótulos pt-BR por kind;
  - formatação de célula (código, cliente e CNPJ; "CNPJ não cadastrado");
  - classe de estado (projeto, viagem, sede, folga, ausência, divergência, sem informação);
  - agrupamento por projeto principal e por nome;
  - filtros "Todos", "Com pendência" e "Não conferidos";
  - busca normalizada.
- [X] T022 [US1] Criar `frontend/src/pages/efetivo/components/AllocationReviewBoard.tsx` e `AllocationReviewBoard.css` (só tokens de `frontend/src/styles/variables.css`). O conteúdo segue a prévia aprovada:
  - cabeçalho com navegação de semana (`semana` na URL; padrão = segunda da semana anterior completa) e `Badge` de situação;
  - resumo com `MetricCard` clicáveis e `ProgressBar` de linhas conferidas;
  - filtros com `SearchBar` e o segmentado do kit;
  - legenda;
  - grade em `<table>` com coluna do colaborador fixa e rolagem horizontal **só no contêiner**;
  - célula como botão acessível (`aria-label` com nome, data, situação e CNPJ) com os 3 pontinhos;
  - `EmptyState` sem resultados;
  - loading com `Skeleton` do kit.

  Usar `useQuery` com `getAllocationReviewWeek`. Ao clicar na célula, abrir o painel do dia em modo leitura (o painel completo vem na T030). Não criar componentes locais que já existam em `frontend/src/components/ui/ds`.
- [X] T023 [US1] Criar o layout de celular em `AllocationReviewBoard.tsx` e `AllocationReviewBoard.css`. Em até 640px, mostrar um card por colaborador com os 7 dias em linhas. Grid com `minmax(min(100%, …), 1fr)` e `min-width: 0` nos filhos. CNPJ e rótulos quebram linha. Segmentos e filtros quebram linha. Verificar em 375px que não há scroll horizontal de página.

**Checkpoint**: US1 entrega a visão consolidada e a lista de pendências sem gravar nada.

---

## Phase 4: User Story 2 - Corrigir dias e conferir a semana (Priority: P1)

**Goal**: rascunho por dia, repetir, edição em massa, conferir e desconferir linhas, fechar e reabrir semana, com controle de versão.

**Independent Test**: US2, cenários 1 a 8. Dados persistem após F5 e a semana fechada não aceita edição.

### Tests for User Story 2

- [X] T024 [P] [US2] Criar `backend/test/allocation-review-service.test.js`:
  - gravar rascunho cria a semana e a linha;
  - `differsFromSuggestion`;
  - repetir em vários dias;
  - recusas de dia futuro, dia fora do vínculo, kind×projetos inválido, projeto inativo que não é fonte, linha conferida (`ROW_CONFIRMED`) e semana fechada (`WEEK_CLOSED`);
  - conferir linha com pendência → `ROW_HAS_PENDING`;
  - conferir sem pendência grava os 7 dias com a sugestão e o `sourceFingerprint`;
  - `allReady`;
  - desconferir;
  - fechar antes do domingo → `WEEK_NOT_ENDED`;
  - fechar com linha pendente → `ROWS_NOT_CONFIRMED`;
  - reabrir sem ADMIN → `ADMIN_REQUIRED`;
  - versão desatualizada → `WEEK_VERSION_CONFLICT`;
  - eventos CLOSED e REOPENED gravados.
- [X] T025 [P] [US2] Ampliar `backend/test/allocation-review-routes.test.js` com o contrato das rotas de escrita (status e corpo de erro de cada caso do contrato) e com o header `If-Match-Version` obrigatório.

### Implementation for User Story 2

- [X] T026 [US2] Implementar `backend/src/lib/efetivo/allocation-review/service.js`, com cada operação em `prisma.$transaction`, checando e incrementando `AllocationReviewWeek.version`, e usando a sugestão atual de `read-model.js`:
  - `saveDays`;
  - `discardDays`;
  - `confirmRows` (grava os dias não editados com `suggestionSnapshot` e `sourceFingerprint`, research R5);
  - `unconfirmRows`;
  - `closeWeek`;
  - `reopenWeek`.

  Depois de cada escrita, chamar `invalidateAllocationAudit()` e `clearProjectDerivedCaches()` (`backend/src/lib/resource-list-cache.js:32-38`).
- [X] T027 [US2] Fazer `read-model.js` mesclar o que está gravado:
  - dias gravados sobrepõem a sugestão;
  - `confirmed` e `confirmedBy` da linha;
  - `sourceChangedAfterReview`, comparando o fingerprint;
  - `week.status`, `version`, `canClose`/`closeBlockers` e `canReopen` (só ADMIN);
  - `summary.editedDays`/`confirmedRows`/`readyRows`.
- [X] T028 [US2] Adicionar em `backend/src/routes/resources/allocation-review.js`, validadas com os schemas de T008:
  - `PUT` e `DELETE /semanas/:weekStart/dias`;
  - `POST /semanas/:weekStart/linhas/conferir` e `/linhas/desconferir`;
  - `POST /semanas/:weekStart/fechar` e `/reabrir`.

  Mapear os erros de serviço (`AllocationReviewError` com `code`) para os status do contrato.
- [X] T029 [US2] Criar `frontend/src/pages/efetivo/components/AllocationReviewDayPanel.tsx`, usando `Modal` de `frontend/src/components/ui/Modal.tsx` (lateral no desktop, tela cheia no celular, rodapé fixo e corpo rolável). Conteúdo:
  - `Alert` de divergência, sem informação ou "a fonte mudou depois de conferido";
  - lista das fontes: ponto com horas normais, HE70, HE100 e etiquetas, **sem horário** (research R2); RDO com número, projeto e situação; Efetivo; ausência;
  - opções em rádio: candidatos das fontes com selo "pelo RDO/Ponto/Efetivo", Sede, Folga, Férias, Afastamento, Treinamento, "Viagem para outro projeto…" e "Outro projeto…" (`SearchCombobox`). Projetos inativos só aparecem quando são fonte;
  - na opção Projeto, um botão "adicionar outro projeto" para dias com mais de um projeto;
  - chips "repetir nos dias seguintes";
  - `Textarea` de observação (até 500 caracteres).

  Formulário com react-hook-form + Zod. "Outro projeto" ou "Viagem" sem projeto marca o campo com `.field-group.field-invalid`, `aria-invalid` e `.field-error`. O painel fica só leitura quando a linha está conferida ou a semana fechada.
- [X] T030 [US2] Ligar o painel ao board em `AllocationReviewBoard.tsx`:
  - `useMutation` de `saveAllocationReviewDays` e `discardAllocationReviewDays` ("voltar para a sugestão"), enviando a versão atual;
  - em 409 `WEEK_VERSION_CONFLICT`, mostrar um toast pedindo para atualizar e refazer a busca;
  - `Toast` do kit para sucesso;
  - marca ✎ em dias ajustados.
- [X] T031 [P] [US2] Criar `frontend/src/pages/efetivo/components/AllocationReviewBulkBar.tsx`:
  - no desktop, Shift/Ctrl + clique seleciona células;
  - no celular, o botão "Selecionar dias" ativa um modo de seleção por toque;
  - barra fixa no rodapé com Sede, Folga, Férias e um `Select` de projeto, além de "Limpar seleção";
  - quebra linha no celular;
  - Esc limpa a seleção.

  Ligar ao board.
- [X] T032 [US2] Adicionar ao board as ações de linha e de semana:
  - botão "Conferir" por linha, desabilitado com o texto "N pendências" quando houver pendência;
  - "Desfazer";
  - "Conferir linhas sem pendência (N)";
  - "Fechar semana" com `ConfirmDialog`/`useConfirmDialog` (`frontend/src/components/ui/`), com resumo de colaboradores, ajustes e CNPJs e desabilitado com o motivo (`closeBlockers`);
  - "Reabrir semana", só quando `canReopen`, com textarea de motivo opcional.

  Na semana fechada, toda a grade fica só leitura.

**Checkpoint**: US1 e US2 completas. A tela substitui a planilha, mas ainda sem efeito no custo e no relatório.

---

## Phase 5: User Story 3 - Conferência vale no relatório e no custo (Priority: P1)

**Goal**: dias de linhas conferidas com precedência no custo HH, no relatório Alocação dos colaboradores (tela e PDF) e na auditoria existente. Dias não conferidos ficam idênticos.

**Independent Test**: US3, cenários 1 a 6 (quickstart, cenários 3 e 4).

### Tests for User Story 3

- [X] T033 [P] [US3] Criar `backend/test/allocation-review-labor-cost.test.js`, no padrão de `backend/test/acompanhamento-labor-cost.test.js`:
  - `REVIEW_CONFIRMED` vence `MANUAL_OVERRIDE` e o RDO;
  - `REVIEW_SHARED_CONFIRMED` divide como o manual;
  - `REVIEW_IDLE` tira as horas do projeto e manda para Sede;
  - viagem conferida apropria ao projeto de destino;
  - dia útil conferido em projeto sem ponto aplica o piso de 8h48;
  - rascunho (linha não conferida) não afeta nada;
  - a soma dos projetos mais Sede mais Folga continua igual à folha.
- [X] T034 [P] [US3] Ampliar `backend/test/allocation-monthly-report.test.js`: _(Os fakes antigos não precisaram de stub: `loadConfirmedReviewDays` devolve `[]` quando o client não tem o modelo.)_
  - todo `client` falso ganha `allocationReviewDay: { findMany: async () => [] }`;
  - casos novos: dia conferido em B substitui o RDO de A; Sede, Folga e Férias saem sem CNPJ; viagem sai com o CNPJ do destino e o rótulo "Viagem · …"; turno noturno do RDO é preservado quando o projeto conferido é o mesmo; `projectCount` ignora os nulos; `reviewedDayCount`;
  - o PDF gera sem erro com entradas sem projeto (parse com pdfjs-dist, como o teste atual).

### Implementation for User Story 3

- [X] T035 [US3] Implementar `backend/src/lib/efetivo/allocation-review/confirmed-days.js`, com `loadConfirmedReviewDays({ from, to, client = prisma })`. Ela devolve só os dias de linhas com `confirmedAt` não nulo, com `kind`, `projectIds`, `collaboratorId` e `workDate`, indexados por colaborador e data.
- [X] T036 [US3] Em `backend/src/lib/acompanhamento/labor-cost.js`:
  - carregar os dias conferidos junto com os overrides manuais (ao lado de `manualProjectsByCollaborator`, perto da linha 904);
  - em `buildDailyProjectWeights` (linha 999), inserir antes da regra manual (linhas 1028-1045) as regras `REVIEW_CONFIRMED`/`REVIEW_SHARED_CONFIRMED`, com pesos iguais aos do manual (1033-1042), e `REVIEW_IDLE`, sem alocações;
  - incluir `REVIEW_IDLE` em `NON_ACTIONABLE_ALLOCATION_REASONS` (linha 1230);
  - em `classifyProjectHours` (1277-1278), permitir montar pesos quando houver dia conferido em projeto, mesmo com zero horas, aplicando o piso de 8h48 em dia útil como no caso do Efetivo sem RDO (1306-1307).
- [X] T037 [US3] Em `backend/src/lib/acompanhamento/allocation-audit.js`, incluir em `currentFingerprint` (linhas 20-59) a contagem e o `updatedAt` máximo de `allocationReviewDay` e `allocationReviewRow`. Expor nos dias da auditoria `reviewed: true` quando o motivo for `REVIEW_*`.
- [X] T038 [P] [US3] Em `frontend/src/components/projects/allocationReasons.ts`, adicionar os rótulos `REVIEW_CONFIRMED` ("Conferência semanal"), `REVIEW_SHARED_CONFIRMED` ("Conferência semanal (dividido)") e `REVIEW_IDLE` ("Conferência semanal: fora de projeto"). Em `frontend/src/api/acompanhamentoPonto.ts`, adicionar `reviewed?: boolean` em `AllocationDay`.
- [X] T039 [US3] Em `backend/src/lib/allocation-monthly-report.js`, `buildMonthlyAllocationSummary` (linha 245):
  - depois do dedupe (280-286), carregar `loadConfirmedReviewDays` do mês pelo `client`;
  - remover as entradas de RDO dos pares colaborador+data conferidos e emitir as entradas da conferência conforme research R6 (turno, rótulos e CNPJ);
  - adicionar `kind`, `source` e `reviewed` a todas as entradas;
  - `projectCount` só com `projectId` não nulo; `reviewedDayCount` no summary;
  - nome e função do colaborador vindos de `Collaborator`/`jobRole` quando ele não tiver RDO no mês.
- [X] T040 [US3] Em `buildMonthlyAllocationPdf` (mesmo arquivo, linhas 359-367 e 480-485), mostrar o rótulo da situação quando não houver projeto e trocar "Local da obra: …" por "—" nesses dias. Garantir que só se usem caracteres WinAnsi.
- [X] T041 [P] [US3] Em `frontend/src/api/statistics.ts` (linhas 137-176), tornar `projectId`, `reportId` e `sequenceNumber` anuláveis e adicionar `kind`, `source`, `reviewed` e `summary.reviewedDayCount`.
- [X] T042 [US3] Em `frontend/src/components/stats/StatsDashboard.tsx`, nas listas `AllocationDayList` (cerca de 3026-3044), `DesignSystemAllocationDayList` (3075-3111) e nos cards de celular (3163-3182):
  - mostrar o rótulo da situação em dias sem projeto e omitir a linha de local e CNPJ;
  - `Badge` "Conferido" quando `reviewed`;
  - chave estável com `kind` quando `projectId` for nulo;
  - textos longos quebram linha sem scroll horizontal no celular.

**Checkpoint**: a conferência tem efeito real. Validar o cenário SC-004, em que dias não conferidos ficam idênticos.

---

## Phase 6: User Story 4 - Envio do relatório mensal espera a conferência (Priority: P2)

**Goal**: o envio automático espera todas as semanas do mês fecharem, com limite no 3º dia útil.

**Independent Test**: US4, cenários 1 a 6 (quickstart, cenário 5).

### Tests for User Story 4

- [X] T043 [P] [US4] Em `backend/test/allocation-monthly-report.test.js`:
  - reescrever os casos `not_first_day` (perto das linhas 235, 311 e 467-489) para a janela nova;
  - casos novos: semana aberta retorna `awaiting_review` (com `deadline` e `openWeeks`) sem escrever em `allocationReportDelivery`; todas fechadas envia no próprio dia; no 3º dia útil envia mesmo com semana aberta; depois da janela, `outside_send_window`; feriado empurra o limite; envio manual com `yearMonth` ignora a espera;
  - garantir que o fake ganhe `allocationReviewWeek.findMany` e que o calendário seja injetável.
- [X] T044 [P] [US4] Conferir que `backend/test/retry-allocation-monthly-report.test.js` continua passando e adicionar um caso: `awaiting_review` é tratado como falha pelo script `backend/scripts/retry-allocation-monthly-report.js:23-33`. _(O script sempre informa o mês e segue o caminho manual, que não espera a conferência; os testes existentes continuam passando.)_

### Implementation for User Story 4

- [X] T045 [US4] Em `processMonthlyAllocationReport` (`backend/src/lib/allocation-monthly-report.js:626`), no caminho sem `yearMonth`:
  - trocar o gate `not_first_day` (627) pela janela do dia 1º até `nthBusinessDayOfMonth(mês atual, 3, feriados)`, com feriados de `loadCorporateCalendar(client, …)`. Fora dela, retornar `outside_send_window`;
  - depois de `assertClosedMonth` e da checagem do mailer, e **antes** de `claimDelivery` (632), consultar `allocationReviewWeek` para `weekStartsTouchingMonth(yearMonth)`. Se alguma semana não estiver CLOSED e hoje for anterior ao limite, retornar `{ skipped: true, reason: 'awaiting_review', yearMonth, deadline, openWeeks }`.

  Aceitar `calendar` injetável para os testes.
- [X] T046 [P] [US4] Em `backend/src/lib/email-templates.js` (`buildMonthlyAllocationReportEmailTemplate`, linhas 461-495):
  - reescrever "resumo dia a dia por colaborador, projeto e CNPJ" para incluir dias em Sede e ausências;
  - adicionar a linha "Dias conferidos: N" (`summary.reviewedDayCount`), no HTML e no texto.
- [X] T047 [US4] Em `frontend/src/components/stats/StatsDashboard.tsx`:
  - trocar o texto "O envio automático ocorre no dia 1…" (cerca de 3473 e 3626) por "O envio automático espera a conferência de todas as semanas do mês e acontece até o 3º dia útil do mês seguinte.";
  - adicionar mensagens para `awaiting_review` e `outside_send_window` no tratamento de `reason` (cerca de 3290-3297).

**Checkpoint**: o DP passa a receber o relatório conferido.

---

## Phase 7: User Story 5 - Aviso ao Efetivo para cadastrar ausência (Priority: P2)

**Goal**: Folga, Férias ou Afastamento conferidos sem ausência cadastrada geram aviso, que é resolvido sozinho quando a ausência é cadastrada.

**Independent Test**: US5, cenários 1 a 5 (quickstart, cenário 6).

### Tests for User Story 5

- [X] T048 [P] [US5] Criar `backend/test/allocation-review-absence-alerts.test.js`:
  - dias consecutivos do mesmo tipo viram um período;
  - tipos diferentes viram períodos separados;
  - Treinamento não gera aviso;
  - Folga de fim de semana igual à sugestão não gera aviso;
  - desconferir cancela;
  - alterar um dia do período cancela;
  - ausência que cobre o período inteiro resolve;
  - ausência parcial não resolve;
  - a notificação tem `dedupeKey`, escopo e destino corretos.

### Implementation for User Story 5

- [X] T049 [US5] Implementar `backend/src/lib/efetivo/allocation-review/absence-alerts.js`:
  - `createAlertsForConfirmedRows(tx, { weekId, rows })`;
  - `cancelAlertsForRows(tx, …)`;
  - `cancelAlertsForChangedDays(tx, …)`;
  - `resolveAllocationReviewAbsenceAlerts({ collaboratorId, type, startDate, endDate, absenceId })`.

  Criar ou encerrar o `NotificationEvent` correspondente.
- [X] T050 [US5] Em `backend/src/lib/notifications/center.js`:
  - registrar o kind `ALLOCATION_REVIEW_ABSENCE_MISSING`;
  - escopo de gestores do Efetivo e ADMIN em `notificationAccessWhere` (linha 23);
  - destino em `destination()` (linha 85): `/efetivo?section=colaboradores&colaborador=<id>&cadastrarAusencia=1&tipo=<t>&de=<d>&ate=<d>`.

  Seguir o precedente de `backend/src/lib/efetivo/report-team.js:45` (upsert por `dedupeKey`).
- [X] T051 [US5] Chamar `createAlertsForConfirmedRows`, `cancelAlertsForRows` e `cancelAlertsForChangedDays` de dentro das transações de `confirmRows`, `unconfirmRows` e `saveDays` em `backend/src/lib/efetivo/allocation-review/service.js`. Devolver `alertsCreated` e `alertsCancelled` nas respostas. _(`cancelAlertsForChangedDays` não foi necessário: só linhas não conferidas aceitam edição, e desconferir já cancela os avisos.)_
- [X] T052 [US5] Chamar `resolveAllocationReviewAbsenceAlerts` depois de criar ou editar uma ausência em `backend/src/lib/collaborators/availability-service.js` (usado por `POST/PATCH /workforce/absences`) e no caminho de ausências de `backend/src/lib/efetivo/service.js`, sem mudar o contrato dessas rotas.
- [X] T053 [P] [US5] Em `frontend/src/utils/planningNavigation.ts`, adicionar `cadastrarAusencia`, `tipo`, `de` e `ate` a `PARAMS_BY_SECTION.colaboradores`. Em `frontend/src/pages/efetivo/components/CollaboratorsBoard.tsx` e `AbsenceFormModal.tsx`, abrir o modal com colaborador, tipo e período preenchidos quando `cadastrarAusencia=1`, e limpar esses parâmetros ao fechar ou salvar.
- [X] T054 [P] [US5] No painel do dia (`AllocationReviewDayPanel.tsx`), mostrar um `Alert` informativo ao escolher Folga, Férias ou Afastamento sem ausência cadastrada e diferente da sugestão: "Quando a linha for conferida, os administradores do Efetivo recebem um aviso para cadastrar." Na célula do board, mostrar a marca "avisa o Efetivo". O toast de conferir menciona os avisos criados.
- [X] T055 [P] [US5] Em `frontend/src/components/notifications/NotificationCenter.tsx`, adicionar o rótulo e o ícone do kind novo, se a central exigir mapeamento explícito.

**Checkpoint**: todas as histórias completas.

---

## Phase 8: Polish & Cross-Cutting

- [X] T056 [P] Criar o badge de pendências na navegação do Efetivo: _(Contador usa o padrão `.efetivo-section-nav__item > strong` e conta só semanas encerradas desde a primeira conferência registrada.)_
  - `GET /pendencias/contagem` em `backend/src/routes/resources/allocation-review.js`, com o serviço no read-model;
  - contador em `frontend/src/pages/efetivo/EfetivoSectionNavigation.tsx`/`EfetivoAppShell.tsx` para a seção Conferência, mostrando as semanas abertas já encerradas com linhas pendentes.
- [X] T057 [P] Criar a campanha de novidade:
  - `frontend/src/utils/allocationReviewNovelty.ts` com `ALLOCATION_REVIEW_NOVELTY_IMPLEMENTED_AT = '<data do merge>'` e `EXPIRES_AT` 10 dias corridos depois, no padrão de `frontend/src/utils/projectWorkflowNovelty.ts:1-3`;
  - `frontend/src/pages/efetivo/AllocationReviewNovelty.tsx` (driver.js, card centralizado e tutorial guiado), apontando para a célula, o painel do dia, "Selecionar dias", "Conferir" e "Fechar semana";
  - localStorage por usuário e coordenação com `frontend/src/utils/efetivoGuideCoordinator.ts`;
  - montagem em `EfetivoPage.tsx` só para quem tem acesso à Conferência.
- [X] T058 [P] Revisar a gestão de usuários em `frontend/src/pages/admin/AdminAccountsPage.tsx`: o papel "Conferência de alocação" aparece em `assignableRoleOptionsForAccountType` e é salvo pela rota `backend/src/routes/resources/users.js` (linhas 39 e 53-80). Ajustar se o registry não for suficiente.
- [X] T059 Validar a navegação: F5 mantém `section`, `semana`, `mostrar`, `agrupar` e `q`; trocar de seção limpa esses parâmetros; o link do aviso abre o cadastro preenchido. _(Coberto por `e2e/allocation-review.behavior.spec.ts`.)_
- [X] T060 Validar em 375px e em desktop: grade em cards, painel em tela cheia com rodapé fixo, barra de seleção quebrando linha, relatório com dias sem projeto, e nenhum scroll horizontal de página (Princípio II). _(Coberto por `e2e/allocation-review.behavior.spec.ts` em 1366px e 375px.)_
- [X] T061 Rodar `cd backend && npm test` e `cd frontend && npm run build` (não usar `tsc --noEmit` solto) e corrigir falhas.
- [ ] T062 Executar os cenários 1 a 8 de `specs/037-conferencia-alocacao/quickstart.md`, incluindo a comparação antes e depois de um mês de referência para SC-004. _(Pendente: os cenários 3, 4 e a comparação do SC-004 precisam de banco com dados reais de ponto/RDO; executar em staging.)_
- [X] T063 Preparar o texto da PR com o resumo, a menção à prévia e o bloco **"rode no servidor"** com a aplicação da migration e o rebuild do backend (Princípio I). O agente não executa esses comandos. _(Texto entregue na resposta da implementação; a PR não foi aberta.)_

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)** → **Foundational (Fase 2)** → histórias.
- **US1 (Fase 3)**: depende só da Fundação. É o MVP.
- **US2 (Fase 4)**: depende da US1, porque usa o read-model e o board.
- **US3 (Fase 5)**: depende da US2 (só dias de linhas conferidas têm efeito). T033, T034, T041 e T038 podem começar em paralelo com a US2.
- **US4 (Fase 6)**: depende da Fundação (T009) e da tabela de semanas. Pode ser feita em paralelo com a US3 por outra pessoa.
- **US5 (Fase 7)**: depende da US2 (`confirmRows`).
- **Polish (Fase 8)**: depois das histórias desejadas.

### Within Each User Story

Testes primeiro (escritos para falhar), depois regra pura, read-model ou serviço, rota e UI.

### Parallel Opportunities

- Fase 1: T002 em paralelo com T001.
- Fase 2: T006, T007, T008, T009, T010 e T012 em paralelo, depois de T004 e T005.
- US1: T013, T014, T019 e T021 em paralelo.
- US2: T024, T025 e T031 em paralelo.
- US3: T033, T034, T038 e T041 em paralelo.
- US4: T043, T044 e T046 em paralelo.
- US5: T048, T053, T054 e T055 em paralelo.

## Parallel Example: User Story 1

```text
T013 testes da regra de sugestão         (backend/test/allocation-review-suggestion.test.js)
T014 testes do read-model                (backend/test/allocation-review-read-model.test.js)
T019 seção + params de URL               (frontend/src/utils/planningNavigation.ts)
T021 apresentação/rótulos                (frontend/src/pages/efetivo/components/allocationReviewPresentation.ts)
```

## Implementation Strategy

### MVP First

1. Fases 1 e 2.
2. Fase 3 (US1). **Parar e validar**: o responsável já consegue comparar a grade com a planilha atual numa semana real.

### Incremental Delivery

1. US1: visão e pendências.
2. US2: substitui a planilha no trabalho do responsável.
3. US3: efeito no custo e no relatório do DP. A partir daqui o DP pode parar de usar a planilha.
4. US4: envio do relatório depois da conferência.
5. US5: coerência do cadastro de ausências.

Cada incremento pode ir para produção sozinho. A migration da Fase 2 vai no primeiro.

## Notes

- [P] = arquivo diferente, sem dependência pendente.
- Commit por tarefa ou por grupo lógico.
- Nenhum comando de servidor é executado pelo agente (Princípio I).
- Divergências da prévia: o painel não mostra horário de entrada e saída, porque o app não guarda (research R2).
