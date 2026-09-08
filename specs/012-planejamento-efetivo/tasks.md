# Tasks: Efetivo Operacional — Planejamento Completo

**Input**: Design documents from `/specs/012-planejamento-efetivo/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/efetivo-planning.openapi.yaml`, `contracts/efetivo-integrations.openapi.yaml`, `quickstart.md`

**Tests**: regras de negócio e contratos são obrigatoriamente cobertos no backend; helpers interativos críticos recebem testes no frontend.

**Organization**: tarefas agrupadas por user story, em prioridade P1 antes de P2, mantendo cada incremento verificável pelos critérios da especificação.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: preparar contratos, scripts e estrutura sem alterar comportamento existente.

- [X] T001 Validar que `specs/012-planejamento-efetivo/contracts/efetivo-planning.openapi.yaml` cobre todos os endpoints e códigos de conflito da feature
- [X] T002 [P] Criar a estrutura vazia de serviços de planejamento em `backend/src/lib/efetivo/planning/`
- [X] T003 [P] Criar os barrels/tipos iniciais do cliente de planejamento em `frontend/src/api/efetivoPlanning.ts`
- [X] T004 Registrar os comandos e a matriz de validação local definitiva em `specs/012-planejamento-efetivo/quickstart.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: persistência, datas, transações, validação, permissão e cliente comum usados por todas as histórias.

**⚠️ CRITICAL**: nenhuma user story começa antes desta fase.

- [X] T005 Modelar `EfetivoPlan`, missão, demanda, alocação, contratação planejada, feriado e auditoria e estender `Collaborator`/`JobRole` em `backend/prisma/schema.prisma`
- [X] T006 Criar migration Prisma versionada com enums, tabelas, FKs, índices, índice parcial de oficial ativo e defaults em `backend/prisma/migrations/20260821180000_add_efetivo_planning/migration.sql`
- [X] T007 Implementar backfill idempotente e inequívoco de `Collaborator.jobRoleId` com modo dry-run/apply em `backend/scripts/backfill-efetivo-job-roles.js`
- [X] T008 [P] Implementar datas civis inclusivas, iteração UTC e sobreposição em `backend/src/lib/efetivo/planning/date-only.js`
- [X] T009 [P] Implementar schemas Zod de query, colaborador, ausência, missão, demanda, alocação, cenário, feriado e configuração em `backend/src/lib/efetivo/planning/schemas.js`
- [X] T010 [P] Implementar erros estruturados com pessoa, período, origem, IDs e caminho navegável em `backend/src/lib/efetivo/planning/errors.js`
- [X] T011 Implementar obtenção/criação do oficial, lock transacional, revisão monotônica e helper CAS em `backend/src/lib/efetivo/planning/plan-context.js`
- [X] T012 Implementar auditoria sanitizada no mesmo transaction client em `backend/src/lib/efetivo/planning/audit.js`
- [X] T013 [P] Ampliar autorização do Efetivo para leitura e gestão das rotas novas em `backend/src/lib/efetivo/access.js`
- [X] T014 Montar router fino `/api/efetivo/planning` com Zod e middlewares de viewer/manager em `backend/src/routes/efetivo-planning.js`
- [X] T015 Registrar o router de planejamento sem alterar contratos existentes em `backend/src/app.js`
- [X] T016 [P] Implementar tipos, normalização de erros e funções HTTP base no cliente `frontend/src/api/efetivoPlanning.ts`
- [X] T017 [P] Implementar `SearchCombobox` acessível com listbox, teclado, toque, loading, vazio, disabled e erro em `frontend/src/components/ui/SearchCombobox.tsx`
- [X] T018 [P] Cobrir datas, schemas e erro estruturado com `node:test` em `backend/test/efetivo-planning-foundation.test.js`
- [X] T019 Validar a migração e geração do Prisma sem aplicar em produção usando `backend/prisma/schema.prisma`

**Checkpoint**: foundation pronta; histórias podem usar o mesmo plano, contratos e regras de data.

---

## Phase 3: User Story 1 — Ver a capacidade operacional em uma data (Priority: P1) 🎯 MVP

**Goal**: entregar KPIs, capacidade/déficit por função, próximas mobilizações e utilização planejada em uma data.

**Independent Test**: montar colaboradores, missão confirmada e ausência e reproduzir os cinco totais e déficits mostrados.

### Tests for User Story 1

- [X] T020 [P] [US1] Escrever testes de dias úteis, feriados, vínculo parcial e conjuntos pessoa-dia em `backend/test/efetivo-capacity.test.js`
- [X] T021 [P] [US1] Escrever testes da janela inclusiva de 90 dias, deduplicação, 0/100% e denominador nulo em `backend/test/efetivo-utilization.test.js`
- [X] T022 [P] [US1] Escrever teste de contrato da visão geral e projetos mínimos em `backend/test/efetivo-planning-overview-routes.test.js`

### Implementation for User Story 1

- [X] T023 [US1] Implementar calendário útil por feriados globais em `backend/src/lib/efetivo/planning/business-days.js`
- [X] T024 [US1] Implementar projeção em lote de estado diário/capacidade/utilização em `backend/src/lib/efetivo/planning/capacity.js`
- [X] T025 [US1] Implementar leitura mínima de projetos e projeção de próximas mobilizações em `backend/src/lib/efetivo/planning/read-model.js`
- [X] T026 [US1] Expor `GET /projects` e `GET /overview` no router `backend/src/routes/efetivo-planning.js`
- [X] T027 [P] [US1] Implementar cliente/query keys da visão geral em `frontend/src/api/efetivoPlanning.ts`
- [X] T028 [US1] Construir `OverviewBoard` com KPIs, capacidade por função, mobilizações e estados loading/empty/error em `frontend/src/pages/efetivo/components/OverviewBoard.tsx`
- [X] T029 [US1] Integrar Visão geral, data/função em URL e shell largo em `frontend/src/pages/efetivo/EfetivoPage.tsx` e `frontend/src/pages/efetivo/efetivo.css`

**Checkpoint**: capacidade oficial é verificável sem depender das demais telas.

---

## Phase 4: User Story 2 — Planejar missões e alocar pessoas (Priority: P1)

**Goal**: criar programação e equipe por pessoa sem conflitos, com demanda por função derivada e autoalocação legada determinística.

**Independent Test**: criar missão com duas funções, confirmar, alocar elegíveis e observar déficit restante.

### Tests for User Story 2

- [X] T030 [P] [US2] Escrever testes de cronologia, demanda e confirmação de missão em `backend/test/efetivo-mission-validation.test.js`
- [X] T031 [P] [US2] Escrever testes de elegibilidade, ausência, dupla alocação, vínculo e função em `backend/test/efetivo-allocation-conflicts.test.js`
- [X] T032 [P] [US2] Escrever testes de autoalocação determinística, déficit parcial e idempotência em `backend/test/efetivo-auto-allocation.test.js`
- [X] T033 [P] [US2] Escrever teste concorrente em banco confirmando que apenas uma alocação conflitante vence em `backend/test/efetivo-allocation-concurrency.test.js` — escrito e ignorado por padrão; a execução exige banco descartável migrado (`EFETIVO_DB_TESTS=1`, ver quickstart)
- [X] T034 [P] [US2] Escrever testes dos contratos CRUD/equipe de missão em `backend/test/efetivo-missions-routes.test.js`

### Implementation for User Story 2

- [X] T035 [US2] Implementar serviço transacional de CRUD, cronologia, demanda e versão da missão em `backend/src/lib/efetivo/planning/mission-planning.js`
- [X] T036 [US2] Implementar lock por colaborador e detector único de ausência/missão/vínculo/função em `backend/src/lib/efetivo/planning/conflicts.js`
- [X] T037 [US2] Implementar elegíveis, alocação manual, remoção lógica e limite de demanda em `backend/src/lib/efetivo/planning/allocations.js`
- [X] T038 [US2] Implementar autoalocação estável por função, admissão e nome em `backend/src/lib/efetivo/planning/auto-allocation.js`
- [X] T039 [US2] Expor CRUD de missões, elegíveis, alocações e autoalocação em `backend/src/routes/efetivo-planning.js`
- [X] T040 [P] [US2] Implementar cliente e tipos de missão/equipe em `frontend/src/api/efetivoPlanning.ts`
- [X] T041 [P] [US2] Construir lista/cards de missões com busca, filtros, demanda e déficit em `frontend/src/pages/efetivo/components/MissionsBoard.tsx`
- [X] T042 [US2] Construir formulário RHF/Zod com `Modal`, `SearchCombobox`, `.field-invalid` e rodapé fixo em `frontend/src/pages/efetivo/components/MissionFormModal.tsx`
- [X] T043 [US2] Construir alocação manual/automática e conflitos navegáveis em `frontend/src/pages/efetivo/components/MissionAllocationModal.tsx`
- [X] T044 [US2] Persistir missão/filtros na URL e limpar parâmetros incompatíveis em `frontend/src/pages/efetivo/EfetivoPage.tsx`
- [X] T045 [US2] Adicionar layouts shrink-safe de lista, demanda, equipe e modais em `frontend/src/pages/efetivo/efetivo.css`

**Checkpoint**: programação e equipe funcionam por API/UI e alimentam a capacidade.

---

## Phase 5: User Story 3 — Consultar o calendário integrado (Priority: P1)

**Goal**: combinar missão, férias, folga e afastamento em dia/semana/mês, filtrável por função.

**Independent Test**: cadastrar uma missão e uma ausência e localizá-las nas três visões após refresh.

### Tests for User Story 3

- [X] T046 [P] [US3] Escrever testes de projeção de eventos, filtro e detalhes do dia em `backend/test/efetivo-calendar.test.js`
- [X] T047 [P] [US3] Escrever testes de grade civil mensal/semanal sem deriva de fuso em `frontend/test/efetivo-calendar-grid.test.mjs`

### Implementation for User Story 3

- [X] T048 [US3] Implementar projeção em lote de eventos/conflitos do intervalo em `backend/src/lib/efetivo/planning/calendar.js`
- [X] T049 [US3] Expor `GET /calendar` com limite de intervalo e filtro por função em `backend/src/routes/efetivo-planning.js`
- [X] T050 [P] [US3] Implementar helpers de grade mensal/semanal e rótulos pt-BR em `frontend/src/utils/calendarGrid.ts`
- [X] T051 [P] [US3] Implementar cliente/query do calendário em `frontend/src/api/efetivoPlanning.ts`
- [X] T052 [US3] Construir dia/semana/mês, legenda, Hoje e navegação em `frontend/src/pages/efetivo/components/OperationalCalendar.tsx`
- [X] T053 [US3] Construir detalhe do dia com pessoas, vagas e links de conflito em `frontend/src/pages/efetivo/components/CalendarDayDetail.tsx`
- [X] T054 [US3] Integrar query params e agenda mobile sem grade horizontal em `frontend/src/pages/efetivo/EfetivoPage.tsx` e `frontend/src/pages/efetivo/efetivo.css`

**Checkpoint**: calendário integrado é consultável de forma independente em três visões.

---

## Phase 6: User Story 4 — Gerir colaboradores e indisponibilidades (Priority: P1)

**Goal**: manter campos operacionais do colaborador canônico e programar três tipos de indisponibilidade.

**Independent Test**: editar colaborador, criar afastamento e conferir situação/calendário/capacidade.

### Tests for User Story 4

- [X] T055 [P] [US4] Escrever testes de serviço cadastral, sincronização cargo/texto e vínculo em `backend/test/efetivo-collaborators.test.js`
- [X] T056 [P] [US4] Ampliar testes de ausências para FERIAS/FOLGA/AFASTAMENTO e conflito com missão em `backend/test/efetivo-absences-planning.test.js`
- [X] T057 [P] [US4] Escrever testes de contratos e mínimo privilégio das rotas de colaborador em `backend/test/efetivo-collaborator-routes.test.js`

### Implementation for User Story 4

- [X] T058 [US4] Implementar serviço restrito aos campos operacionais do cadastro canônico em `backend/src/lib/efetivo/planning/collaborators.js`
- [X] T059 [US4] Generalizar o serviço transacional de indisponibilidade e auditoria para três tipos em `backend/src/lib/efetivo/planning/collaborators.js`
- [X] T060 [US4] Expor lista/criação/edição de colaborador e CRUD de ausência em `backend/src/routes/efetivo-planning.js`
- [X] T061 [P] [US4] Implementar cliente/query/mutations de colaboradores e ausências em `frontend/src/api/efetivoPlanning.ts`
- [X] T062 [US4] Construir busca, filtro, data, situação, utilização e alertas em `frontend/src/pages/efetivo/components/CollaboratorsBoard.tsx`
- [X] T063 [US4] Construir modal operacional RHF/Zod com campos permitidos em `frontend/src/pages/efetivo/components/OperationalCollaboratorModal.tsx`
- [X] T064 [US4] Ampliar `AbsenceFormModal` para tipos liberados, conflito navegável e validação visual em `frontend/src/pages/efetivo/components/AbsenceFormModal.tsx`
- [X] T065 [US4] Implementar tabela→cards, ações empilhadas e URL de colaborador/filtros em `frontend/src/pages/efetivo/efetivo.css` e `frontend/src/pages/efetivo/EfetivoPage.tsx`

**Checkpoint**: base operacional pode ser mantida sem acesso RDO e afeta todas as projeções.

---

## Phase 7: User Story 5 — Acompanhar a evolução das missões (Priority: P2)

**Goal**: mover e ordenar missões nas cinco etapas com histórico, toque e alternativa acessível.

**Independent Test**: mover uma missão por arraste/menu, cancelar um arraste e recarregar a etapa/ordem final.

### Tests for User Story 5

- [X] T066 [P] [US5] Escrever testes transacionais de etapa, ordem, versão e auditoria em `backend/test/efetivo-mission-kanban.test.js`
- [X] T067 [P] [US5] Escrever testes do reducer cross-column, rollback e ordem final em `frontend/test/mission-kanban.test.mjs`

### Implementation for User Story 5

- [X] T068 [US5] Implementar mudança/reordenação atômica de etapa com versão em `backend/src/lib/efetivo/planning/mission-planning.js`
- [X] T069 [US5] Expor `PATCH /missions/:id/stage` em `backend/src/routes/efetivo-planning.js`
- [X] T070 [P] [US5] Implementar reducer puro cross-column e snapshot de rollback em `frontend/src/utils/missionKanban.ts`
- [X] T071 [US5] Construir Kanban desktop com handle, live reorder, placeholder/legenda, ghost e persistência no drop em `frontend/src/pages/efetivo/components/MissionKanban.tsx`
- [X] T072 [US5] Adicionar Pointer Events, `touch-action:none`, Escape/cancel e scroll de borda usando `frontend/src/utils/reorderDrag.ts`
- [X] T073 [US5] Adicionar seletor/menu acessível equivalente para teclado e mobile em `frontend/src/pages/efetivo/components/MissionKanban.tsx`
- [X] T074 [US5] Persistir missão selecionada e etapa visível em URL em `frontend/src/pages/efetivo/EfetivoPage.tsx`
- [X] T075 [US5] Implementar colunas desktop e seletor+lista mobile sem scroll de página em `frontend/src/pages/efetivo/efetivo.css`

**Checkpoint**: ciclo das missões é persistente, auditado e acessível sem depender de mouse.

---

## Phase 8: User Story 6 — Simular capacidade antes de alterar o oficial (Priority: P2)

**Goal**: criar cenário materializado, comparar e aplicar/descartar atomicamente.

**Independent Test**: editar cenário e contratação, confirmar isolamento, comparar, descartar; depois aplicar outro uma única vez.

### Tests for User Story 6

- [X] T076 [P] [US6] Escrever testes de clonagem materializada e isolamento do oficial em `backend/test/efetivo-scenarios-isolation.test.js`
- [X] T077 [P] [US6] Escrever testes de comparação com contratação planejada separada do efetivo ativo em `backend/test/efetivo-scenarios-comparison.test.js`
- [X] T078 [P] [US6] Escrever testes de rollback total, revisão obsoleta, retry e aplicação concorrente em `backend/test/efetivo-scenarios-apply.test.js`
- [X] T079 [P] [US6] Escrever testes dos contratos de cenário e estados terminais em `backend/test/efetivo-scenarios-routes.test.js`

### Implementation for User Story 6

- [X] T080 [US6] Implementar clonagem relacional de oficial para cenário e CRUD terminal em `backend/src/lib/efetivo/planning/scenarios.js`
- [X] T081 [US6] Implementar comparação oficial×cenário pela projeção comum em `backend/src/lib/efetivo/planning/scenarios.js`
- [X] T082 [US6] Implementar aplicação transacional/CAS/idempotente criando novo oficial em `backend/src/lib/efetivo/planning/scenarios.js`
- [X] T083 [US6] Expor listar/criar/comparar/contratar/aplicar/descartar em `backend/src/routes/efetivo-planning.js`
- [X] T084 [P] [US6] Implementar cliente/query/mutations de cenários em `frontend/src/api/efetivoPlanning.ts`
- [X] T085 [US6] Construir lista/criação/estado de cenários em `frontend/src/pages/efetivo/components/ScenariosBoard.tsx` e `frontend/src/pages/efetivo/components/ScenarioFormModal.tsx`
- [X] T086 [US6] Construir comparação total/por função e confirmação explícita em `frontend/src/pages/efetivo/components/ScenarioComparison.tsx`
- [X] T087 [US6] Persistir cenário em URL e empilhar comparativos no mobile em `frontend/src/pages/efetivo/EfetivoPage.tsx` e `frontend/src/pages/efetivo/efetivo.css`

**Checkpoint**: simulações não alteram oficial até aplicação integral e repetição não duplica efeitos.

---

## Phase 9: User Story 7 — Administrar regras e rastrear alterações (Priority: P2)

**Goal**: configurar função, meta e feriado e consultar atividade recente conforme permissão.

**Independent Test**: alterar cor/prazo/meta, cadastrar feriado e conferir efeito e auditoria.

### Tests for User Story 7

- [X] T088 [P] [US7] Escrever testes de validação/configuração de função e meta em `backend/test/efetivo-admin-settings.test.js`
- [X] T089 [P] [US7] Escrever testes de CRUD/restauração de feriado e efeito em dia útil em `backend/test/efetivo-holidays.test.js`
- [X] T090 [P] [US7] Escrever testes de auditoria, sanitização, paginação e permissão viewer/manager em `backend/test/efetivo-audit.test.js`

### Implementation for User Story 7

- [X] T091 [US7] Implementar leitura/patch limitado de funções e meta com revisão/auditoria em `backend/src/lib/efetivo/planning/administration.js`
- [X] T092 [US7] Implementar CRUD/restauração de feriados e atividade paginada em `backend/src/lib/efetivo/planning/administration.js`
- [X] T093 [US7] Expor rotas admin de funções, feriados, settings e atividade em `backend/src/routes/efetivo-planning.js`
- [X] T094 [P] [US7] Implementar cliente/query/mutations de Administração em `frontend/src/api/efetivoPlanning.ts`
- [X] T095 [US7] Construir configuração de funções/meta e estados somente leitura em `frontend/src/pages/efetivo/components/AdministrationBoard.tsx`
- [X] T096 [US7] Construir CRUD de feriados com RHF/Zod/Modal e erro visual em `frontend/src/pages/efetivo/components/HolidayManager.tsx`
- [X] T097 [US7] Construir lista de atividade com ator/data/tipo/alvo e paginação em `frontend/src/pages/efetivo/components/EfetivoActivityList.tsx`
- [X] T098 [US7] Integrar subnavegação admin em URL e cards mobile em `frontend/src/pages/efetivo/EfetivoPage.tsx` e `frontend/src/pages/efetivo/efetivo.css`

**Checkpoint**: parâmetros são explícitos e toda mutação relevante deixa trilha consultável.

---

## Phase 10: User Story 8 — Alertas de férias e permanência em obra (Priority: P2)

**Goal**: exibir folgas a programar e férias a programar/vencidas com datas reproduzíveis.

**Independent Test**: criar sequência acima do limite e período concessivo sem férias e conferir pessoa, dias e prazos.

### Tests for User Story 8

- [X] T099 [P] [US8] Escrever testes de intervalos sobrepostos/adjacentes, lacuna, FOLGA e limites em `backend/test/efetivo-continuous-stay.test.js`
- [X] T100 [P] [US8] Escrever testes de períodos aquisitivos, janela concessiva, 120 dias e ano bissexto em `backend/test/efetivo-vacation-alerts.test.js`

### Implementation for User Story 8

- [X] T101 [US8] Implementar permanência contínua por dias corridos e limites de função em `backend/src/lib/efetivo/planning/continuous-stay.js`
- [X] T102 [US8] Implementar alertas operacionais de férias por admissão/ausências em `backend/src/lib/efetivo/planning/vacation-alerts.js`
- [X] T103 [US8] Incorporar alertas em overview e colaboradores sem N+1 em `backend/src/lib/efetivo/planning/read-model.js`
- [X] T104 [P] [US8] Tipar alertas e seus caminhos no cliente em `frontend/src/api/efetivoPlanning.ts`
- [X] T105 [US8] Exibir alertas de permanência com missão/dias/prazo em `frontend/src/pages/efetivo/components/OverviewBoard.tsx`
- [X] T106 [US8] Exibir férias vencidas/programar férias com aviso não jurídico em `frontend/src/pages/efetivo/components/CollaboratorsBoard.tsx`

**Checkpoint**: alertas são derivados, reproduzíveis e não alegam substituir folha/jurídico.

---

## Phase 11: User Story 9 — Manter Produtividade realizada separada (Priority: P1)

**Goal**: preservar integralmente a feature 011 e impedir que planejamento alimente HH realizadas.

**Independent Test**: mesma base Ponto Mais produz os mesmos resultados antes/depois, sem ação manual de HH.

### Tests for User Story 9

- [X] T107 [P] [US9] Fixar regressão das fórmulas/fonte Ponto Mais com planejamento presente em `backend/test/efetivo-produtividade.test.js`
- [X] T108 [P] [US9] Testar que o cliente e navegação não expõem mutation de lançamento de HH em `frontend/test/efetivo-navigation.test.mjs`

### Implementation for User Story 9

- [X] T109 [US9] Revisar e isolar importações para que `backend/src/lib/efetivo/productivity.js` não dependa de modelos de planejamento
- [X] T110 [US9] Manter a seção e filtros de Produtividade ao ampliar `frontend/src/pages/efetivo/EfetivoPage.tsx`
- [X] T111 [US9] Remover qualquer texto/ação de HH manual das novas superfícies em `frontend/src/pages/efetivo/`

**Checkpoint**: produtividade realizada permanece fonte Ponto Mais, funcional e semanticamente separada.

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: integrar as oito seções, cumprir constituição visual e fechar evidência técnica.

- [X] T112 [P] Atualizar a campanha de novidade com expiração global em 2026-08-31 e marcador por usuário/browser em `frontend/src/pages/efetivo/EfetivoPlanningNovelty.tsx`
- [X] T113 Atualizar tutorial temporário para os controles reais e preservar onboarding existente em `frontend/src/pages/efetivo/EfetivoTutorial.tsx`
- [X] T114 Implementar/validar navegação das oito seções e limpeza atômica de query params em `frontend/src/pages/efetivo/EfetivoPage.tsx` e `frontend/src/utils/planningNavigation.ts`
- [X] T115 Auditar formulários: labels, `field-group.field-invalid`, `aria-invalid`, `.field-error`, dropdowns e rodapés fixos em `frontend/src/pages/efetivo/components/`
- [X] T116 Auditar DnD: handle, placeholder/legenda, ghost, live reorder, cancel, drop único, touch e teclado em `frontend/src/pages/efetivo/components/MissionKanban.tsx`
- [X] T117 Auditar 1440, 768 e 390 px e corrigir grids/cards/tabelas/abas/textos sem overflow em `frontend/src/pages/efetivo/efetivo.css`
- [X] T118 [P] Adicionar índices/ajustes das projeções após medir o volume de 500 colaboradores/100 missões em `backend/src/lib/efetivo/planning/capacity.js`
- [X] T119 Rodar testes completos, lint, build e validação de arquitetura conforme `specs/012-planejamento-efetivo/quickstart.md`
- [X] T120 Registrar evidência de critérios, comandos/resultados e pendências operacionais em `specs/012-planejamento-efetivo/quickstart.md`
- [X] T121 Marcar somente tarefas realmente concluídas e conferir formato/contagem em `specs/012-planejamento-efetivo/tasks.md`

---

## Phase 13: Ajuste pós-uso — missões vindas dos projetos e kanban legível

**Purpose**: eliminar o cadastro manual de missão, expor pendências vindas dos projetos cadastrados (FR-046..FR-049) e corrigir a leitura/arraste do kanban (FR-050).

- [X] T122 [P] [US2] Escrever testes de pendência, ordem de rota e contrato em `backend/test/efetivo-missions-pending.test.js`
- [X] T123 [P] [US2] Escrever testes do utilitário de pendências e das regras de UI em `frontend/test/efetivo-missions-pending.test.mjs`
- [X] T124 [US2] Implementar `listPendingMissionProjects` (projetos ativos sem programação, sem criar plano na leitura) em `backend/src/lib/efetivo/planning/read-model.js`
- [X] T125 [US2] Expor `GET /missions/pending` antes da rota por id em `backend/src/routes/efetivo-planning.js` e documentar em `specs/012-planejamento-efetivo/contracts/efetivo-planning.openapi.yaml`
- [X] T126 [P] [US2] Adicionar `PendingMissionProject`/`listPendingMissionProjects` em `frontend/src/api/efetivoPlanning.ts` e `frontend/src/utils/missionPendencies.ts`
- [X] T127 [US2] Substituir "Nova missão" por cards pendentes em amarelo com o que falta e aviso de pendências em `frontend/src/pages/efetivo/components/MissionsBoard.tsx`
- [X] T128 [US2] Travar o projeto no formulário e sugerir datas do projeto em `frontend/src/pages/efetivo/components/MissionFormModal.tsx`
- [X] T129 [US2] Notificar a contagem de pendências na navegação do módulo em `frontend/src/pages/efetivo/EfetivoPage.tsx`
- [X] T130 [US5] Arrastar o card inteiro, encerrar o estado de arraste sem recarregar e manter alternativa acessível em `frontend/src/pages/efetivo/components/MissionKanban.tsx`
- [X] T131 [US5] Marcar a etapa com bolinha colorida ao lado do nome, manter colunas/cards na cor única, remover bordas escuras e estilizar pendências em `frontend/src/pages/efetivo/efetivo.css`

---

## Phase 14: Paridade campo a campo com o exemplo de referência

**Purpose**: fechar as lacunas de campo levantadas na conferência contra o protótipo (FR-051..FR-054) e registrar as divergências deliberadas.

- [X] T132 [P] [US6] Escrever teste de criação de cenário com contratação hipotética inicial em `backend/test/efetivo-scenario-initial-hire.test.js`
- [X] T133 [US6] Aceitar `initialHire` em `scenarioInputSchema` e gravá-lo na mesma transação em `backend/src/lib/efetivo/planning/schemas.js` e `backend/src/lib/efetivo/planning/scenarios.js`, documentando em `specs/012-planejamento-efetivo/contracts/efetivo-planning.openapi.yaml`
- [X] T134 [US6] Reconstruir o diálogo com nome, objetivo e bloco "Contratação hipotética" em `frontend/src/pages/efetivo/components/ScenarioFormModal.tsx` e `frontend/src/pages/efetivo/components/ScenariosBoard.tsx`
- [X] T135 [US2] Adicionar resumo de posições, cor da função na demanda, situação da equipe e "Alocar disponíveis" em `frontend/src/pages/efetivo/components/MissionsBoard.tsx` e `frontend/src/pages/efetivo/components/MissionFormModal.tsx`
- [X] T136 [US5] Adicionar resumo do fluxo, descrição de etapa, estado vazio e detalhe de responsável/equipe em `frontend/src/pages/efetivo/components/MissionKanban.tsx` e `frontend/src/utils/missionKanban.ts`
- [X] T137 [US1] [US3] Exibir dias da semana no calendário mensal e detalhar déficit/permanência na visão geral em `frontend/src/pages/efetivo/components/OperationalCalendar.tsx` e `frontend/src/pages/efetivo/components/OverviewBoard.tsx`
- [X] T138 [P] Registrar divergências deliberadas do protótipo em `specs/012-planejamento-efetivo/spec.md`
- [X] T140 [P] [US3] Escrever testes de conflito do calendário (ausência sobre missão e dupla alocação) em `backend/test/efetivo-calendar.test.js`
- [X] T141 [US3] Calcular os conflitos do recorte em `backend/src/lib/efetivo/planning/calendar.js` e exibir pessoas, vagas em aberto e conflitos do dia em `frontend/src/pages/efetivo/components/CalendarDayDetail.tsx` e `frontend/src/pages/efetivo/components/OperationalCalendar.tsx` (FR-010, FR-055)
- [X] T142 [US4] Honrar `colaborador`, `ausencia` e `ano` na seção Colaboradores em `frontend/src/utils/planningNavigation.ts`, `frontend/src/pages/efetivo/EfetivoPage.tsx`, `CollaboratorsBoard.tsx` e `AbsencesBoard.tsx` (FR-039, FR-056)
- [X] T143 [US8] Identificar as missões que geraram o alerta de permanência em `backend/src/lib/efetivo/planning/read-model.js` e `frontend/src/pages/efetivo/components/OverviewBoard.tsx` (FR-034)
- [X] T144 [US9] Expor a situação da competência por colaborador em `backend/src/lib/efetivo/productivity.js`, `frontend/src/api/efetivo.ts` e `frontend/src/pages/efetivo/components/ProductivityBoard.tsx` (FR-057)
- [X] T145 [US1] Adicionar atalhos de navegação entre os painéis da visão geral em `frontend/src/pages/efetivo/EfetivoPage.tsx` e `frontend/src/pages/efetivo/components/OverviewBoard.tsx` (FR-058)
- [X] T139 [US5] Corrigir o cartão esmaecido após soltar em outra etapa: prévia ao vivo só dentro da coluna, destaque `drop-target` entre colunas e encerramento do arraste no próprio `drop`, com `resolveKanbanDrop`/`missionStage` cobertos em `frontend/test/mission-kanban.test.mjs`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: começa imediatamente.
- **Foundational (Phase 2)**: depende de Setup e bloqueia todas as histórias.
- **US1/US2/US4 (P1)**: começam após Foundation; US1 fica demonstrável primeiro, US2 fornece missões e US4 fornece manutenção de pessoas.
- **US3 (P1)**: depende das projeções de US1 e entidades de US2/US4.
- **US9 (P1)**: pode ser validada em paralelo após Foundation, mas deve ser reexecutada no fechamento.
- **US5 (P2)**: depende de missões de US2.
- **US6 (P2)**: depende de projeção de US1 e regras completas de US2/US4.
- **US7 (P2)**: pode avançar após Foundation; feriados alimentam US1/US3.
- **US8 (P2)**: depende de alocações de US2 e ausências de US4.
- **Polish**: depende de todas as histórias incluídas na entrega.

### User Story Completion Order

```text
Foundation
├── US1 Capacidade ─┬── US3 Calendário
│                  ├── US6 Simulações
│                  └── US8 Alertas
├── US2 Missões ───┼── US3 Calendário
│                  ├── US5 Kanban
│                  ├── US6 Simulações
│                  └── US8 Alertas
├── US4 Pessoas ───┼── US3 Calendário
│                  ├── US6 Simulações
│                  └── US8 Alertas
├── US7 Administração ── US1/US3 (feriados/configuração)
└── US9 Regressão de Produtividade (paralela + fechamento)
```

### Within Each User Story

- Testes de regra/contrato primeiro e inicialmente falhando.
- Serviço puro antes de orquestração transacional.
- Serviço antes de rota; contrato antes do cliente; cliente antes da UI.
- Persistência final apenas após revalidação dentro da transação.
- Checkpoint da história antes de avançar para dependentes.

## Parallel Opportunities

- T008–T010, T013, T016–T018 são independentes por arquivo após schema definido.
- Em US1, os três testes podem ser escritos juntos; cliente pode avançar enquanto o serviço é implementado.
- Em US2, validação, conflitos, autoalocação e contrato têm arquivos de teste independentes.
- Em US3, helper de grade frontend pode avançar junto da projeção backend.
- US7 e US9 podem avançar paralelamente ao núcleo de missões após Foundation.
- CSS/integração final deve permanecer serial para evitar edições concorrentes no mesmo arquivo.

## Parallel Examples

```text
US2:
- backend/test/efetivo-mission-validation.test.js
- backend/test/efetivo-allocation-conflicts.test.js
- backend/test/efetivo-auto-allocation.test.js
- frontend/src/pages/efetivo/components/MissionsBoard.tsx

US6:
- backend/test/efetivo-scenarios-isolation.test.js
- backend/test/efetivo-scenarios-comparison.test.js
- backend/test/efetivo-scenarios-apply.test.js
- frontend/src/api/efetivoPlanning.ts
```

## Implementation Strategy

### MVP First

1. Completar Setup + Foundation.
2. Entregar US1 com leitura da capacidade oficial.
3. Validar totais e desempenho de forma independente.
4. Acrescentar US2/US4 para tornar a base editável.
5. Acrescentar US3 e revalidar o MVP integrado.

### Incremental Delivery

1. Foundation → persistência/versionamento/permissão.
2. US1 → decisão diária.
3. US2 + US4 → manutenção da fonte planejada.
4. US3 → visão temporal integrada.
5. US7 → governança, feriados e parâmetros.
6. US5 + US8 → operação contínua e alertas.
7. US6 → simulações aplicáveis.
8. US9 + Polish → regressão, onboarding, responsividade e evidência.

## Notes

- `[P]` indica arquivos independentes, nunca mutações concorrentes no mesmo arquivo.
- Rotas compartilham um arquivo e devem ser integradas serialmente.
- Nenhuma tarefa autoriza deploy, restart, Docker ou migração em produção.
- Alterações em `package-lock.json` só entram se uma dependência for deliberadamente adicionada; esta feature não prevê nova dependência.

## Phase 15: Convergence

**Purpose**: Fechar lacunas encontradas na verificação cruzada entre especificação, plano, tarefas, implementação e evidências de validação.

- [X] T146 [US2] Ajustar `backend/src/lib/efetivo/planning/mission-planning.js` para restaurar ou reutilizar com segurança a programação excluída do mesmo projeto, preservando histórico/auditoria e a restrição de unicidade, e adicionar regressão do fluxo excluir → pendente → reprogramar conforme FR-049.
- [X] T147 [US6] Invalidar e recarregar a comparação e os metadados do cenário em `frontend/src/pages/efetivo/components/MissionsBoard.tsx` e `frontend/src/pages/efetivo/components/ScenariosBoard.tsx` após mutações de missão/alocação no plano de cenário, com teste de cache/integração para FR-028 e US6/AC2.
- [X] T148 [P] Executar `backend/test/efetivo-allocation-concurrency.test.js` contra PostgreSQL explicitamente descartável e migrado, registrar a evidência de concorrência real e confirmar SC-004/T033 sem acessar banco de produção.
- [X] T149 [P] Coordenar a abertura do onboarding em `frontend/src/pages/efetivo/EfetivoTutorial.tsx` e `frontend/src/pages/efetivo/EfetivoPlanningNovelty.tsx` para impedir drivers simultâneos no primeiro acesso, com teste de componente ou navegador conforme o Princípio VI.
- [X] T150 [P] Remover o limite silencioso de 200 projetos pendentes em `backend/src/lib/efetivo/planning/read-model.js`, adotando paginação completa ou agregação equivalente para a lista e o contador de navegação, com teste cobrindo mais de 200 projetos conforme FR-046.
- [X] T151 Tornar a resolução normalizada de função em `backend/src/lib/efetivo/planning/capacity.js` consciente de ambiguidades, mantendo colaboradores sem `jobRoleId` canônico como pendentes, e adicionar regressão de totais/listagem conforme o modelo de dados e SC-002.
- [X] T152 [P] Tornar `headquartersResponsibleUserId` obrigatório em `MissionInput` de `frontend/src/api/efetivoPlanning.ts` e adicionar verificação de compatibilidade entre tipo TypeScript, OpenAPI e schema Zod conforme FR-016.
- [X] T153 [P] Corrigir os comandos de lint/build e atualizar as contagens de testes/evidências em `specs/012-planejamento-efetivo/quickstart.md` para refletir a execução a partir da raiz ou de `frontend/`.

---

## Phase 16: Ajuste pós-uso — seleção direta da equipe na programação

**Purpose**: substituir a contagem manual por cargo pela seleção de colaboradores do APP, mantendo demanda, capacidade e alocações consistentes (FR-018..FR-021).

- [X] T154 [P] [US2] Escrever regressões backend para derivação por cargo canônico, locks ordenados, conflitos e sincronização lógica da equipe em `backend/test/efetivo-mission-team.test.js`.
- [X] T155 [P] [US2] Escrever regressões frontend para busca por nome/cargo, pré-seleção e contrato `collaboratorIds` em `frontend/test/mission-team-selection.test.mjs` e `frontend/test/efetivo-planning-coordination.test.mjs`.
- [X] T156 [US2] Substituir `demands` por `collaboratorIds` no schema Zod, contrato OpenAPI e cliente TypeScript, preservando demandas derivadas na resposta.
- [X] T157 [US2] Implementar derivação e sincronização atômica de demandas/alocações, com lock por colaborador, revalidação temporal e auditoria única em `backend/src/lib/efetivo/planning/mission-team.js` e `mission-planning.js`.
- [X] T158 [US2] Substituir a grade numérica por uma lista pesquisável e acessível de colaboradores com cargo, resumo derivado e pré-seleção em `MissionFormModal.tsx`, utilitário e CSS.
- [X] T159 [US2] Atualizar textos de pendência e paridade para a equipe direta em `missionPendencies.ts`, `MissionsBoard.tsx` e testes existentes.
- [X] T160 Executar suítes completas, build/lint/arquitetura, validar criação e edição em `localhost:5175` e registrar evidências no quickstart.
- [X] T161 Corrigir a sanitização de snapshots de auditoria para valores Prisma/Decimal e cobrir a exclusão lógica de missão sem falha de serialização em `backend/src/lib/efetivo/planning/audit.js` e `backend/test/efetivo-audit.test.js`.

---

## Phase 17: Foundation das integrações compartilhadas

**Purpose**: criar persistência e serviços corporativos necessários às histórias 10–12 sem alterar fatos produtivos existentes.

- [X] T162 Inventariar leitores/escritores de `Collaborator.role`, cargo EPI, ausências, feriados e equipe RDO com code-review-graph e registrar o mapa final em `specs/012-planejamento-efetivo/research.md`
- [X] T163 Modelar `EpiCollaboratorProfile`, snapshots EPI/RDO, responsável User da missão, `WorkforceCalendarState`, versão/autoria de ausência, calendário manual compartilhado e rastreio opcional da missão no RDO em `backend/prisma/schema.prisma`
- [X] T164 Criar migration Prisma versionada e segura para os modelos compartilhados/produtivos e remodelar diretamente as tabelas inéditas do Efetivo em `backend/prisma/migrations/<timestamp>_centralize_workforce_planning/migration.sql`
- [X] T165 Criar diagnóstico/backfill idempotente com `--dry-run` para cargo canônico e override EPI em `backend/scripts/backfill-collaborator-job-roles.mjs`
- [X] T166 [P] Implementar serviço canônico de cargo e normalização em `backend/src/lib/collaborators/job-role-service.js`
- [X] T167 [P] Implementar calendário corporativo nacional/manual puro em `backend/src/lib/calendar/corporate-calendar.js`
- [X] T168 Implementar serviço compartilhado de disponibilidade, revisão global e missões afetadas em `backend/src/lib/collaborators/availability-service.js`
- [X] T169 Consolidar schemas Zod e contratos internos de cargo, perfil EPI, disponibilidade e contexto oficial em `backend/src/lib/workforce/schemas.js`
- [X] T170 Validar geração Prisma, migration SQL e os dois contratos OpenAPI sem aplicar migração em produção usando `backend/prisma/schema.prisma` e `specs/012-planejamento-efetivo/contracts/`

**Checkpoint**: os serviços compartilhados existem, mas os módulos ainda não mudaram seus fluxos visíveis.

---

## Phase 18: User Story 11 — Centralizar cargo com exceção segura no EPI (Priority: P1)

**Goal**: garantir um único cargo atual no APP, override relacional exclusivo do EPI e snapshots históricos imutáveis em EPI/RDO.

**Independent Test**: trocar o cargo canônico, emitir EPI com cargo anterior, limpar o override e confirmar que apenas novas emissões voltam ao cargo atual; RDOs/documentos anteriores não mudam.

### Tests for User Story 11

- [X] T171 [P] [US11] Cobrir serviço canônico, cargo inativo, ambiguidades e invalidação de alocação futura em `backend/test/collaborator-job-role-service.test.js`
- [X] T172 [P] [US11] Cobrir dry-run/apply idempotente, override produtivo e gate zero-nulos em `backend/test/collaborator-job-role-backfill.test.js`
- [X] T173 [P] [US11] Cobrir isolamento do perfil EPI e snapshots de solicitação, payload público e PDF em `backend/test/epi-role-snapshot.test.js`
- [X] T174 [P] [US11] Cobrir snapshots de cargo do RDO e reprodução histórica após troca canônica em `backend/test/report-collaborator-role-snapshot.test.js`

### Implementation for User Story 11

- [X] T175 [US11] Migrar rotas/importadores/automações de colaborador para o serviço canônico e rejeitar escrita livre de cargo em `backend/src/routes/resources/collaborators.js`, `backend/src/lib/efetivo/planning/collaborators.js` e importadores encontrados no inventário
- [X] T176 [US11] Migrar leitores backend de cargo atual para `jobRole.name`, mantendo snapshots históricos em `backend/src/lib/` e `backend/src/routes/`
- [X] T177 [US11] Implementar perfil/override relacional e resposta de cargo efetivo do EPI em `backend/src/lib/epi/collaborators.js` e `backend/src/routes/resources/epis.js`
- [X] T178 [US11] Capturar e consumir snapshots de ID/nome/origem em toda solicitação/documento EPI em `backend/src/lib/epi-docx.js`, `backend/src/lib/epi-signature.js` e rotas EPI relacionadas
- [X] T179 [US11] Capturar snapshots de cargo ao gravar `ReportCollaborator` e usá-los em PDFs/leitores históricos em `backend/src/lib/report-collaborators.js` e geradores de RDO
- [X] T180 [P] [US11] Atualizar contratos/tipos/formulários de colaborador para `jobRoleId`/`jobRole` em `frontend/src/api/collaborators.ts` e telas Gestor/Efetivo consumidoras
- [X] T181 [P] [US11] Atualizar perfil EPI para selecionar cargo canônico ou inativo sem editar o cargo global em `frontend/src/api/epi.ts` e `frontend/src/pages/epis/EpiPage.tsx`
- [X] T182 [US11] Remover fallbacks e escritas físicas de `Collaborator.role`, impor `jobRoleId` obrigatório e remover a coluna apenas após o gate em `backend/prisma/schema.prisma` e na migration da T164

**Checkpoint**: cargo atual é canônico em todo o APP; a única exceção está isolada e documentada no EPI.

---

## Phase 19: User Story 12 — Compartilhar disponibilidade e feriados (Priority: P1)

**Goal**: unificar ausências/feriados e aplicar políticas adequadas a planejamento, RDO, Ponto e Acompanhamento.

**Independent Test**: cadastrar ausência e feriado manual, observar bloqueio/replanejamento no Efetivo, justificativa no RDO e sinalização sem perda de horas/custos nos módulos realizados.

### Tests for User Story 12

- [X] T183 [P] [US12] Cobrir feriados nacionais fixos/móveis, merge manual, revisão e paridade RDO/Efetivo em `backend/test/corporate-calendar.test.js`
- [X] T184 [P] [US12] Cobrir ausência superveniente, bloqueio de nova alocação, concorrência e cenário obsoleto em `backend/test/workforce-availability.test.js`
- [X] T185 [P] [US12] Cobrir warning/justificativa RDO e alertas Ponto/Acompanhamento sem alterar horas/custos em `backend/test/workforce-actual-conflicts.test.js`
- [X] T186 [P] [US12] Cobrir contrato/RBAC das rotas workforce em `backend/test/workforce-routes.test.js`

### Implementation for User Story 12

- [X] T187 [US12] Expor calendário, preflight e CRUD versionado de ausências em `backend/src/routes/workforce.js` e registrar o router em `backend/src/app.js`
- [X] T188 [US12] Fazer capacidade/calendário/cenários do Efetivo consumirem disponibilidade e revisão globais em `backend/src/lib/efetivo/planning/`
- [X] T189 [US12] Substituir feriado isolado/hardcoded pelo calendário resolvido nos cálculos novos de hora extra em `backend/src/lib/overtime.js` e orquestração de relatórios
- [X] T190 [US12] Permitir ausência superveniente com pendência de missão e consolidar os endpoints duplicados do Efetivo em `backend/src/routes/efetivo-planning.js` e `backend/src/routes/efetivo.js`
- [X] T191 [US12] Implementar preflight e justificativa auditável para trabalho durante ausência no fluxo RDO em `backend/src/routes/resources/reports.js` e `backend/src/lib/reports/`
- [X] T192 [US12] Classificar trabalho durante ausência/feriado no Ponto e separar ausência/feriado de folga residual no Acompanhamento sem recalcular totais em `backend/src/lib/acompanhamento/`
- [X] T193 [P] [US12] Migrar clientes/telas do Efetivo para as rotas workforce e exibir missão pendente após ausência em `frontend/src/api/efetivoPlanning.ts` e `frontend/src/pages/efetivo/components/`

**Checkpoint**: todos os módulos recebem o mesmo calendário e a mesma ausência, preservando fatos realizados.

---

## Phase 20: User Story 10 — Reutilizar o planejamento na execução (Priority: P1)

**Goal**: sugerir o plano ao RDO/Acompanhamento e comparar plano com fatos realizados sem sincronização silenciosa.

**Independent Test**: confirmar missão, receber prefill no RDO, alterar equipe realizada e ver a divergência no Efetivo/Acompanhamento sem reescrever missão ou Project.

### Tests for User Story 10

- [X] T194 [P] [US10] Cobrir lookup oficial por projeto/data, exclusão de cenário/rascunho e fronteiras inclusivas em `backend/test/official-mission-context.test.js`
- [X] T195 [P] [US10] Cobrir RBAC e contrato sanitizado do contexto RDO/Acompanhamento em `backend/test/planning-context-routes.test.js`
- [X] T196 [P] [US10] Cobrir planejado × observado, divergências, freshness e não mutação do plano/Project em `backend/test/mission-execution-comparison.test.js`
- [X] T197 [P] [US10] Cobrir precedência do prefill e preservação de seleção manual no frontend em `frontend/test/rdo-planning-prefill.test.mjs`

### Implementation for User Story 10

- [X] T198 [US10] Implementar `getOfficialMissionContext` restrito ao oficial confirmado em `backend/src/lib/efetivo/planning/official-mission-context.js`
- [X] T199 [US10] Expor contexto mínimo nas permissões próprias de RDO/Acompanhamento em `backend/src/routes/resources/reports.js` e rotas do Acompanhamento
- [X] T200 [US10] Integrar prefill RDO com precedência seleção tocada → missão → último RDO e rastrear revisão usada em `frontend/src/pages/reports/NewReportPage.tsx` e `frontend/src/api/reports.ts`
- [X] T201 [P] [US10] Exibir bloco Planejado separado de Observado/Exceções no detalhe do Acompanhamento em `frontend/src/pages/acompanhamento/` e cliente correspondente
- [X] T202 [US10] Implementar read model de execução reutilizando Project, RDO, progresso e Ponto em `backend/src/lib/efetivo/planning/execution-comparison.js`
- [X] T203 [US10] Expor `GET /planning/missions/:missionId/execution` em `backend/src/routes/efetivo-planning.js` e cliente em `frontend/src/api/efetivoPlanning.ts`
- [X] T204 [US10] Exibir comparação de datas/equipe/horas, pendências e sugestão de etapa sem auto-movimento em `frontend/src/pages/efetivo/components/MissionExecutionPanel.tsx` e `frontend/src/pages/efetivo/efetivo.css`

**Checkpoint**: planejamento é reutilizado como contexto e comparação, nunca como fato realizado automático.

---

## Phase 21: Polish e validação cruzada das integrações

**Purpose**: fechar contratos, migração, regressões, responsividade e evidência sem operar infraestrutura externa.

- [X] T205 Atualizar OpenAPI, modelo, quickstart e rastreabilidade final das FR-059..FR-071 em `specs/012-planejamento-efetivo/`
- [X] T206 [P] Validar formulários/campos novos com Zod nas duas pontas e estados `.field-invalid`/`.field-error` nas superfícies alteradas do frontend
- [X] T207 [P] Auditar RBAC e exposição mínima entre Efetivo, EPI, RDO, Workforce e Acompanhamento em `backend/test/`
- [X] T208 Executar testes backend/frontend, lint, builds, Prisma validate/generate e arquitetura conforme `specs/012-planejamento-efetivo/quickstart.md`
- [X] T209 Executar `detect_changes`, `get_affected_flows` e `tests_for` no code-review-graph e corrigir riscos bloqueantes encontrados
- [X] T210 Registrar resultados, limitações operacionais e comandos destinados ao operador em `specs/012-planejamento-efetivo/quickstart.md`

---

## Dependencies adicionais — integrações

```text
Phase 17 Foundation
├── US11 Cargo/EPI ─────┐
├── US12 Calendário ────┼── US10 Planejado × realizado
└───────────────────────┘
                         └── Phase 21 Validação
```

- T163–T170 bloqueiam as três histórias novas.
- US11 antecede snapshots de cargo usados pelo RDO em US10.
- US12 antecede divergências de ausência/feriado exibidas em US10.
- Dentro de cada história, testes são escritos antes da implementação correspondente.
- T208 só começa após T171–T207; T209 revisa o diff completo; T210 encerra a entrega documental.

### Parallel opportunities das integrações

- T166 e T167 podem avançar em paralelo depois do schema definido.
- T171–T174, T183–T186 e T194–T197 são testes em arquivos distintos.
- T180/T181, T193 e T201 atuam em superfícies frontend separadas depois dos respectivos contratos backend.
- Nenhuma tarefa paralela deve editar simultaneamente `schema.prisma`, `efetivo-planning.js`, `reports.js` ou os lockfiles.

### MVP das integrações

O menor incremento seguro é Phase 17 + US11: cargo canônico e EPI histórico resolvem a divergência cadastral sem depender das telas analíticas. US12 entra em seguida; US10 fecha o reaproveitamento operacional e a comparação gerencial.

---

## Phase 22: Correção do bootstrap de cargos canônicos

**Purpose**: impedir que cargos textuais não cadastrados bloqueiem a inicialização ao aplicar a centralização em ambientes existentes.

- [X] T211 Escrever regressões para materialização deduplicada de cargos canônicos ausentes, vínculo de colaboradores e idempotência do backfill/migration em `backend/test/collaborator-job-role-backfill.test.js`.
- [X] T212 Criar cargos canônicos a partir de nomes legados não vazios antes dos vínculos e do gate `jobRoleId NOT NULL`, preservando bloqueio para nomes vazios/ambiguidades, em `backend/scripts/backfill-collaborator-job-roles.mjs` e na migration `20260826160000_centralize_workforce_planning`.
- [X] T213 Atualizar o handoff operacional e executar regressões focais, suíte backend, Prisma, arquitetura e revisão do code-review-graph.
