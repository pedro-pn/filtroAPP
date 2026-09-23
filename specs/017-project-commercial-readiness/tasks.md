# Tasks: prontidão comercial da gestão de projetos

**Input**: artefatos em `/specs/017-project-commercial-readiness/`  
**Tests**: exigidos pela especificação para regras comerciais, permissões, gates e interface.

## Phase 1 — Setup

- [x] T001 [P] Consolidar especificação, pesquisa, plano, modelo, contrato e quickstart em `specs/017-project-commercial-readiness/`

## Phase 2 — Fundação

- [x] T002 Adicionar enums, modelo, relações e migration em `backend/prisma/schema.prisma` e `backend/prisma/migrations/20260909190000_project_commercial_readiness/migration.sql`
- [x] T003 Registrar `efetivo:commercial`, regenerar o catálogo e exibir o papel em `shared/modules/registry.json`, `frontend/src/modules/registry.generated.ts` e `frontend/src/pages/efetivo/components/AdministrationBoard.tsx`
- [x] T004 Criar catálogo e schema Zod da ação `commercial_fact` em `shared/schemas/project-workflow.js` e `shared/schemas/project-workflow.d.ts`

## Phase 3 — User Story 1: registrar prontidão comercial (P1)

**Goal**: permitir que Comercial ou gestor resolva oito fatos e consultar uma liberação consolidada sem bloquear o planejamento.  
**Independent test**: resolver todos os fatos, conferir `RELEASED`, reabrir um deles e conferir `NOT_RELEASED` sem mudança de etapa.

- [x] T005 [P] [US1] Cobrir validação, prontidão e permissões em `backend/test/project-workflow-rules.test.js`, `backend/test/project-workflow-service.test.js` e `backend/test/efetivo-permissao.test.js`
- [x] T006 [US1] Implementar normalização e cálculo da prontidão em `backend/src/lib/efetivo/project-workflow/rules.js`
- [x] T007 [US1] Implementar permissão comercial, lista, detalhe, mutação versionada e histórico em `backend/src/lib/efetivo/access.js` e `backend/src/lib/efetivo/project-workflow/service.js`
- [x] T008 [P] [US1] Tipar fatos, prontidão e nova ação em `frontend/src/api/projectWorkflow.ts`
- [x] T009 [US1] Exibir semáforo no card e frente comercial responsiva no detalhe em `frontend/src/pages/efetivo/components/ProjectWorkflowBoard.tsx`, `frontend/src/pages/efetivo/components/ProjectWorkflowModal.tsx` e `frontend/src/pages/efetivo/efetivo.css`

## Phase 4 — User Story 2: preservar a futura fonte CRM (P1)

**Goal**: manter procedência e metadados externos e impedir que a interface sobrescreva fatos CRM.  
**Independent test**: consultar um fato CRM e confirmar que o PATCH manual retorna conflito sem mudar versão, histórico ou conteúdo.

- [x] T010 [P] [US2] Cobrir origem somente leitura, metadados e compatibilidade de propostas em `backend/test/project-workflow-service.test.js` e `backend/test/project-workflow-rules.test.js`
- [x] T011 [US2] Proteger origem persistida e expor metadados no detalhe em `backend/src/lib/efetivo/project-workflow/service.js`
- [x] T012 [P] [US2] Exibir fatos CRM desabilitados com procedência em `frontend/src/pages/efetivo/components/ProjectWorkflowModal.tsx`
- [x] T013 [US2] Fazer propostas comerciais válidas satisfazerem o handover legado em `backend/src/lib/efetivo/project-workflow/rules.js`

## Phase 5 — User Story 3: entender e confirmar o avanço (P2)

**Goal**: manter a ação adequada e seus bloqueios visíveis no rodapé do diálogo.  
**Independent test**: abrir gates incompleto e completo, observar a atualização do botão e confirmar a transição em 390 px e 1440 px.

- [x] T014 [P] [US3] Cobrir avaliação de gate e presença das ações em `backend/test/project-workflow-service.test.js` e `frontend/test/project-workflow.test.mjs`
- [x] T015 [US3] Expor gate do handover e opções de transição com motivos em `backend/src/lib/efetivo/project-workflow/service.js`
- [x] T016 [US3] Mover aceite e avanço para o rodapé fixo e responsivo em `frontend/src/pages/efetivo/components/ProjectWorkflowModal.tsx` e `frontend/src/pages/efetivo/efetivo.css`
- [x] T017 [P] [US3] Atualizar a campanha vigente em `frontend/src/pages/efetivo/ProjectWorkflowNovelty.tsx`

## Phase 6 — Polish e validação

- [x] T018 [P] Reservar o novo modelo e atualizar a documentação do catálogo em `backend/src/lib/api-credentials/data-catalog.js`, `backend/test/api-data-catalog-coverage.test.js`, `backend/test/api-data-catalog-contract.test.js` e `specs/015-api-token-playground/contracts/data-catalog.md`
- [x] T019 Regenerar Prisma e módulos, validar schema, executar testes, lint, build, arquitetura e revisão do grafo nos diretórios `backend/`, `frontend/` e `shared/`

## Dependencies

- Phase 2 depende do setup documental da Phase 1.
- US1 depende da Phase 2 e entrega o incremento funcional mínimo.
- US2 depende da entidade e mutação da US1; seu teste permanece independente com fato CRM preparado no estado.
- US3 depende somente da gestão existente e da avaliação de gate; pode ser revisada isoladamente depois da Phase 2.
- A validação final depende de todas as histórias.

## Parallel opportunities

- T001 pode ser produzido em paralelo à leitura estrutural do código.
- T005 e T008 atuam em arquivos distintos depois do contrato compartilhado.
- T010 e T012 podem avançar em paralelo depois de T007.
- T014 e T017 podem avançar em paralelo depois de T015.
- T018 pode avançar em paralelo às superfícies do frontend.

## Implementation strategy

1. Entregar US1 como MVP: oito fatos manuais, papel Comercial e semáforo calculado.
2. Endurecer a fronteira da US2 antes de existir qualquer adaptador CRM.
3. Concluir a descoberta das ações com o rodapé e motivos da US3.
4. Validar o conjunto sem executar servidor, container ou deploy.
