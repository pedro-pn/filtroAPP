# Tasks: execução do projeto

## Fundamentos

- [x] T001 [P] Ampliar contratos compartilhados e tipos do frontend em `shared/schemas/project-workflow.*`, `shared/schemas/project-execution.*` e `frontend/src/api/projectWorkflow.ts`
- [x] T002 [P] Adicionar estágio e metas documentais em `backend/prisma/schema.prisma` e migration versionada
- [x] T003 [P] Escrever testes da transição, autorização e consolidação em `backend/test/project-workflow-*.test.js` e `backend/test/project-execution-dashboard.test.js`

## User Story 1 — Entrar em execução

- [x] T004 [US1] Implementar a transição autorizada e preservar/revalidar o gate em `backend/src/lib/efetivo/project-workflow/rules.js` e `service.js`
- [x] T005 [US1] Expor a coluna e ações de execução em `frontend/src/utils/projectWorkflow.ts`, `ProjectWorkflowBoard.tsx` e `ProjectWorkflowModal.tsx`

## User Story 2 — Painel operacional

- [x] T006 [US2] Implementar a consolidação de Acompanhamento e Relatórios em `backend/src/lib/efetivo/project-workflow/execution-dashboard.js`
- [x] T007 [US2] Expor consulta e metas validadas em `backend/src/routes/efetivo-project-workflow.js`
- [x] T008 [US2] Criar API e painel responsivo em `frontend/src/api/projectWorkflow.ts`, `ProjectExecutionDashboard.tsx` e `frontend/src/pages/efetivo/efetivo.css`

## User Story 3 — Desvios

- [x] T009 [US3] Integrar criação e atualização de desvios com Qualidade em `execution-dashboard.js` e `efetivo-project-workflow.js`
- [x] T010 [US3] Implementar formulário e lista de desvios em `ProjectExecutionDashboard.tsx`

## Validação e adoção

- [x] T011 Atualizar campanha temporária e testes estáticos em `ProjectWorkflowNovelty.tsx`, `projectWorkflowNovelty.ts` e `frontend/test/project-workflow.test.mjs`
- [x] T012 Executar Prisma, testes direcionais e completos, lint, build e arquitetura
- [x] T013 Revisar o impacto no grafo, atualizar roadmap e documentação e registrar commit
