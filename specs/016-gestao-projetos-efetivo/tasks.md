# Tasks: Gestão de projetos no Efetivo

**Input**: Artefatos em `specs/016-gestao-projetos-efetivo/`

## Phase 1: Setup e contratos

- [X] T001 Registrar especificação, pesquisa, modelo, contrato, quickstart e roadmap em `specs/016-gestao-projetos-efetivo/`
- [X] T002 Criar catálogo e schemas Zod compartilhados em `shared/schemas/project-workflow.js`
- [X] T003 [P] Criar testes do catálogo, gates e marcos em `backend/test/project-workflow-rules.test.js`

## Phase 2: Fundação de dados

- [X] T004 Adicionar modelos e relações de gestão em `backend/prisma/schema.prisma`
- [X] T005 Criar migration aditiva em `backend/prisma/migrations/*_project_workflow/migration.sql`

## Phase 3: User Story 1 — Handover e aceite (P1)

**Goal**: iniciar a gestão sem equipe e formalizar a responsabilidade do líder.

**Independent Test**: gestor inicia; terceiro não aceita; líder aceita após checklist completo; troca invalida aceite.

- [X] T006 [US1] Escrever testes de serviço para início, permissão, aceite, versão e troca de líder em `backend/test/project-workflow-service.test.js`
- [X] T007 [US1] Implementar consulta, início, autorização e histórico em `backend/src/lib/efetivo/project-workflow/service.js`
- [X] T008 [US1] Implementar router Zod e montar após autenticação em `backend/src/routes/efetivo-project-workflow.js` e `backend/src/routes/resources/efetivo.js`
- [X] T009 [US1] Adicionar cliente tipado em `frontend/src/api/projectWorkflow.ts`

## Phase 4: User Story 2 — Análise crítica (P1)

**Goal**: exigir análise completa e encaminhar riscos positivos sem duplicação.

**Independent Test**: responder sim duas vezes gera uma pendência; não aplicável exige justificativa; análise incompleta não avança.

- [X] T010 [US2] Ampliar testes de gates, checklist crítico e pendências em `backend/test/project-workflow-service.test.js`
- [X] T011 [US2] Implementar checklist, respostas críticas, pendências e transições em `backend/src/lib/efetivo/project-workflow/service.js`
- [X] T012 [US2] Expor detalhe e ações no contrato de `backend/src/routes/efetivo-project-workflow.js`

## Phase 5: User Story 3 — Quadro e planejamento (P2)

**Goal**: mostrar o ciclo inicial e encaminhar o projeto à programação operacional existente.

**Independent Test**: listar projetos, abrir detalhe pela URL, editar, avançar e acessar programação sem equipe prévia.

- [X] T013 [US3] Criar regras de apresentação e marcos em `frontend/src/utils/projectWorkflow.ts` e testes em `frontend/test/project-workflow.test.mjs`
- [X] T014 [US3] Criar quadro e detalhe com SearchBar, Modal, Button, RHF/Zod e estados acessíveis em `frontend/src/pages/efetivo/components/ProjectWorkflowBoard.tsx` e `ProjectWorkflowModal.tsx`
- [X] T015 [US3] Integrar a visão sem remover o Kanban de missões em `frontend/src/pages/efetivo/EfetivoPage.tsx`, `MissionKanban.tsx` e `frontend/src/utils/planningNavigation.ts`
- [X] T016 [US3] Adicionar CSS responsivo baseado em tokens em `frontend/src/pages/efetivo/efetivo.css`
- [X] T017 [US3] Adicionar campanha Driver.js de 10 dias coordenada em `frontend/src/pages/efetivo/ProjectWorkflowNovelty.tsx` e `frontend/src/utils/projectWorkflowNovelty.ts`

## Phase 6: Validação e documentação

- [X] T018 Gerar cliente, validar schema e executar testes focados do backend conforme `specs/016-gestao-projetos-efetivo/quickstart.md`
- [X] T019 Executar testes, lint e build do frontend e corrigir regressões
- [X] T020 Atualizar o grafo, revisar impacto e conferir diff/finalização dos artefatos

## Dependencies

T002–T005 bloqueiam os serviços; US1 bloqueia US2; US1/US2 bloqueiam o quadro editável de US3. A campanha pode ser implementada após existir a superfície real. Nenhuma etapa exige deploy ou banco compartilhado.

## Implementation Strategy

O MVP é US1 + US2 no backend e a consulta/editabilidade pela UI em US3. O restante do fluxo aprovado está preservado no roadmap para entregas incrementais com integrações próprias.
