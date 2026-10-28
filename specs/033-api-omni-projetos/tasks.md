# Tasks: API de projetos para o Omni

**Input**: [spec.md](spec.md), [plan.md](plan.md)

## Setup

- [x] T001 Ler convenções, grafo, fontes e testes; registrar spec e decisões.

## US1 - Regime operacional

- [x] T002 Ampliar `backend/src/lib/api-credentials/operational-resources.js` e projetar CNPJ/workflow com allowlist.
- [x] T003 Cobrir campos aditivos, projeto sem workflow, CNPJ legado e exclusão de dados extras.

## US2 - Responsáveis

- [x] T004 Registrar resource PERSONAL e catálogo AVAILABLE em `omni-resources.js`/`catalog.js`/`data-catalog.js`.
- [x] T005 Implementar paginação por papel e filtro max(updatedAt) em `project-responsibles.js`.
- [x] T006 Cobrir mapeamento, domínio corporativo, projetos selecionados, 403, cursor, snapshot e updatedSince.

## US3 - Coleção de status

- [x] T007 Registrar coleção, stage/active e enriquecimento com gates/avanço; preservar consulta individual.
- [x] T008 Cobrir equivalência, datas adicionais, filtros e rejeição de updatedSince.

## Entrega

- [x] T009 Atualizar OpenAPI, Playground e `docs/API_INTEGRACOES.md`, com exemplos fictícios e schemaVersion.
- [x] T010 Corrigir README e inventariar divergências de siglas sem alterar templates de clientes.
- [x] T011 Registrar `specs/034-api-omni-fase2/spec.md`, somente backlog.
- [x] T012 Executar arquitetura, testes backend, lint e revisão de diff/grafo.

## Dependencies & Execution Order

T001 → T002–T008 → T009–T011 → T012. Os testes específicos validam cada história de forma independente; a fase 2 não autoriza código.

## Resultado da validação (2026-10-28)

- Backend completo: 2.535 testes, 2.501 passaram, 34 ignorados, zero falhas. Os testes de integração opcionais exigem banco dedicado; foi usada URL sintética não conectável nos testes com doubles.
- Testes novos Omni: 12 cenários passaram, incluindo rotas, Playground e alteração de avanço por RDO.
- Frontend completo: 848 passaram, zero falhas.
- `npm run architecture:check`, lint, build e `git diff --check`: passaram.
- Revisão com detect_changes, get_review_context e get_affected_flows, seguida de conferência na fonte. O grafo não reconheceu a cobertura indireta dos novos testes; a execução real confirmou os cenários.
- Nenhuma operação de servidor, deploy ou alteração de credenciais; mudanças locais de efetivo preexistentes preservadas.
