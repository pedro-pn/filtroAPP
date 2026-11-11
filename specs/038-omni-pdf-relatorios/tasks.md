# Tasks: Documentos para o Omni

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/omni.md.
**Tests**: Obrigatórios para regras de backend conforme spec e constitution.

## Phase 1: Setup

- [X] T001 Registrar spec e decisões em specs/038-omni-pdf-relatorios/ na branch feat/omni-pdf-relatorios.

## Phase 2: Fundamentos

- [X] T002 Extrair seleção de origem e fingerprint/cache compartilhados para backend/src/lib/reports/pdf-download-source.js e pdf-cache.js; adaptar backend/src/routes/resources/reports.js preservando comportamento interno.

## Phase 3: US1 - Download (P1)

**Independent test**: cinco origens, prioridade, autorização e falhas sem geração/rede/escrita.

- [X] T003 [US1] Criar testes de origem, segurança e limites em backend/test/integration-report-pdf.test.js.
- [X] T004 [US1] Implementar leitor pronto seguro em backend/src/lib/reports/integration-pdf.js.
- [X] T005 [US1] Registrar escopo/operação e dispatch, cotas e playground em backend/src/lib/api-credentials/ e backend/src/routes/integrations/v1/operational.js.

## Phase 4: US2 - Descoberta (P2)

**Independent test**: indicador barato condicional e IDs de manutenção aprovados/visíveis.

- [X] T006 [US2] Testar e implementar projeção PDF condicional e descoberta de manutenção em backend/src/lib/api-credentials/report-pdf-projection.js e backend/test/integration-report-pdf.test.js.

## Phase 5: US3 - Contato corporativo (P2)

**Independent test**: escopo próprio, conta presente/ausente e domínio exato sem e-mail pessoal.

- [X] T007 [US3] Testar e implementar escopo, select e projeção de emailCorporativo/userId em backend/src/lib/api-credentials/ e backend/test/integration-report-pdf.test.js.

## Phase 6: Contrato e validação

- [X] T008 Atualizar OpenAPI para 1.14.0 e testes de contrato em specs/015-api-token-playground/contracts/openapi.yaml e backend/test/api-openapi-contract.test.js.
- [X] T009 Documentar token, limitações, manutenção e proposta SIGNED em docs/API_INTEGRACOES.md e specs/038-omni-pdf-relatorios/implementation-report.md.
- [X] T010 Executar npm test no backend, architecture:check e revisão com grafo; registrar evidências em specs/038-omni-pdf-relatorios/implementation-report.md.

## Dependencies and strategy

T001 → T002 → US1 → US2 → contrato/validação. US3 independente após setup; testes de US3 e pesquisa de US1 podem ocorrer em paralelo, sem editar arquivos compartilhados. MVP: US1; entrega desta feature inclui as três histórias. Sem mudanças visuais ou migrations.
