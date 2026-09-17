# Tasks: gate nas saídas operacionais

## Phase 1 — Setup e fundamento

- [x] T001 Consolidar artefatos Spec Kit em `specs/020-operational-mobilization-gate/`
- [x] T002 Criar testes da decisão legado/autorizado/bloqueado em `backend/test/project-operational-mobilization-gate.test.js`
- [x] T003 Implementar a decisão central em `backend/src/lib/efetivo/project-workflow/operational-gate.js`

## Phase 2 — User Story 1: bloquear saídas

- [x] T004 [P] [US1] Cobrir o gate ao mover missão oficial em `backend/test/efetivo-mission-kanban.test.js`
- [x] T005 [P] [US1] Cobrir o gate em uso direto de estoque em `backend/test/estoque-movements-saida.test.js`
- [x] T006 [P] [US1] Cobrir o gate na integração de romaneio em `backend/test/romaneio-stock-integration.test.js`
- [x] T007 [US1] Aplicar o gate à Mobilização/Execução em `backend/src/lib/efetivo/planning/mission-planning.js`
- [x] T008 [US1] Aplicar o gate ao uso em projeto em `backend/src/lib/estoque/stock-movements.js`
- [x] T009 [US1] Validar romaneios de saída antes dos arquivos e movimentos em `backend/src/routes/resources/romaneios.js`

## Phase 3 — User Stories 2 e 3: compatibilidade

- [x] T010 [US2] Confirmar em testes que retornos, cenários e reordenação permanecem disponíveis nos arquivos de teste afetados
- [x] T011 [US3] Confirmar adoção pela existência do workflow e erro uniforme nos testes do backend

## Phase 4 — Interface e validação

- [x] T012 [P] Atualizar o painel do gate e a campanha vigente em `frontend/src/pages/efetivo/ProjectWorkflowNovelty.tsx` e `components/ProjectWorkflowModal.tsx`
- [x] T013 Atualizar testes estáticos em `frontend/test/project-workflow.test.mjs`
- [x] T014 Executar testes direcionais e completos, lint, build e arquitetura
- [x] T015 Revisar impacto no grafo, atualizar `specs/016-gestao-projetos-efetivo/roadmap.md` e registrar o commit

## Dependencies

- T002 precede T003.
- T004–T006 podem ser escritos em paralelo após T003 e precedem T007–T009.
- T010–T011 validam o conjunto integrado.
- T012 pode avançar em paralelo ao backend.

## Independent tests

- **US1**: cada saída falha sem autorização e funciona com autorização vigente.
- **US2**: retornos, cenários e reordenação permanecem livres.
- **US3**: projeto sem workflow passa; iniciar workflow ativa a proteção.
