# Tasks: documentação antecipada e planejamento D-30

**Input**: artefatos em `/specs/018-project-planning-readiness/`  
**Tests**: exigidos para marcos, prontidão, permissões e apresentação correta das etapas.

## Phase 1 — Setup e contrato

- [x] T001 Consolidar os artefatos Spec Kit em `specs/018-project-planning-readiness/`
- [x] T002 Adicionar seções, responsabilidades e novas chaves ao catálogo em `shared/schemas/project-workflow.js` e `shared/schemas/project-workflow.d.ts`
- [x] T003 Adicionar quatro papéis e migration em `backend/prisma/schema.prisma`, `backend/prisma/migrations/20260909210000_project_planning_readiness/migration.sql` e `shared/modules/registry.json`

## Phase 2 — Regras e autorização

- [x] T004 [P] Cobrir marcos, prontidão e progresso em `backend/test/project-workflow-rules.test.js`
- [x] T005 [P] Cobrir permissões por seção e exclusão dos papéis de área da liderança em `backend/test/project-workflow-service.test.js` e `backend/test/efetivo-permissao.test.js`
- [x] T006 Implementar marcos D-90 a D-1, prontidão documental e progresso D-30 em `backend/src/lib/efetivo/project-workflow/rules.js`
- [x] T007 Implementar acesso por área, `canEdit` por item e projeções na lista/detalhe em `backend/src/lib/efetivo/access.js` e `backend/src/lib/efetivo/project-workflow/service.js`

## Phase 3 — Interface

- [x] T008 [P] Tipar seções, prontidão e marcos em `frontend/src/api/projectWorkflow.ts`
- [x] T009 Corrigir a seleção de checklist por etapa e exibir documentação e D-30 agrupados em `frontend/src/pages/efetivo/components/ProjectWorkflowModal.tsx`
- [x] T010 Exibir prontidão documental, progresso D-30 e próximo marco em `frontend/src/pages/efetivo/components/ProjectWorkflowBoard.tsx`
- [x] T011 [P] Exibir os novos papéis na administração em `frontend/src/pages/efetivo/components/AdministrationBoard.tsx`
- [x] T012 Ajustar layout responsivo e a campanha vigente em `frontend/src/pages/efetivo/efetivo.css` e `frontend/src/pages/efetivo/ProjectWorkflowNovelty.tsx`

## Phase 4 — Validação

- [x] T013 [P] Atualizar testes estáticos e de catálogo em `frontend/test/project-workflow.test.mjs` e testes de registro do backend
- [x] T014 Regenerar Prisma e módulos, validar schema, executar testes, lint, build e arquitetura
- [x] T015 Revisar impacto no grafo, marcar tarefas concluídas e registrar o incremento no Git

## Dependencies

- T002 e T003 dependem de T001.
- T004 e T005 antecedem T006 e T007.
- A interface depende do contrato e das projeções do backend.
- A validação final depende de todas as fases.

## Implementation strategy

1. Fechar catálogo, papéis e testes das regras.
2. Expor projeções e autorização granular pela API existente.
3. Corrigir o conteúdo por etapa e adicionar os resumos visuais.
4. Validar o incremento completo sem iniciar servidor ou ambiente externo.
