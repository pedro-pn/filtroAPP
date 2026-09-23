# Tasks: preparação D-15 e gate de mobilização

## Phase 1 — Contrato e persistência

- [x] T001 Consolidar artefatos Spec Kit em `specs/019-project-mobilization-gate/`
- [x] T002 Adicionar etapas, seções, checklists e ação ao contrato em `shared/schemas/project-workflow.js` e `.d.ts`
- [x] T003 Adicionar etapa, papel QSMS, campos e migration em `backend/prisma/` e `shared/modules/registry.json`

## Phase 2 — Regras e serviço

- [x] T004 [P] Testar progresso D-15, nove frentes, D-7/D-1 e transições em `backend/test/project-workflow-rules.test.js`
- [x] T005 [P] Testar autorização, suspensão, revalidação e papel QSMS em testes do backend
- [x] T006 Implementar preparo, gate e autorização versionada em `backend/src/lib/efetivo/project-workflow/rules.js`
- [x] T007 Integrar projeções, permissões e mutações em `backend/src/lib/efetivo/project-workflow/service.js` e `access.js`

## Phase 3 — Interface

- [x] T008 [P] Atualizar tipos em `frontend/src/api/projectWorkflow.ts`
- [x] T009 Exibir D-15 e gate no modal em `ProjectWorkflowModal.tsx`
- [x] T010 Exibir etapas, risco e autorização no quadro em `ProjectWorkflowBoard.tsx` e utilitários
- [x] T011 [P] Exibir papel QSMS na administração e atualizar a campanha vigente
- [x] T012 Ajustar Kanban de seis colunas, gate e grupos para desktop/mobile em `efetivo.css`

## Phase 4 — Validação

- [x] T013 Atualizar testes estáticos e registros gerados
- [x] T014 Validar Prisma, testes, lint, build e arquitetura
- [x] T015 Revisar impacto no grafo, atualizar roadmap e registrar o commit
