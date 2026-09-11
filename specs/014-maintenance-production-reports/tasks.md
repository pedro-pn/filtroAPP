# Tasks: Relatórios de Manutenção e Produção

**Input**: Design documents from `/specs/014-maintenance-production-reports/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Obrigatórios para regras de backend pela constituição e explicitamente incluídos antes das implementações correspondentes.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Preparar schema, migration e dados fixos.

- [X] T001 Atualizar enums, relações e entidades da feature em `backend/prisma/schema.prisma`
- [X] T002 Criar migration com tabelas, índices, projetos 5002/5004, perfis/checklists iniciais e backfill conservador em `backend/prisma/migrations/20260903120000_maintenance_production_reports/migration.sql`
- [X] T003 Validar schema e regenerar Prisma Client a partir de `backend/prisma/schema.prisma`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Permissão, validação, cálculo e infraestrutura comum a todos os fluxos.

- [X] T004 [P] Criar testes de capacidades de emissão e backfill lógico em `backend/test/report-emission-permissions.test.js`
- [X] T005 Implementar normalização, serialização e autorização de emissão em `backend/src/lib/operational-reports/permissions.js`
- [X] T006 Propagar `reportEmissionPermissions` no usuário público e na administração de contas em `backend/src/lib/auth.js` e `backend/src/routes/resources/users.js`
- [X] T007 Aplicar `SITE_RDO` à criação/edição do RDO de obra em `backend/src/routes/resources/reports.js`
- [X] T008 [P] Criar schemas e helpers puros de jornada, manutenção, produção, estados e serialização em `backend/src/lib/operational-reports/domain.js`
- [X] T009 Criar esqueleto autenticado da API e montar aliases em `backend/src/routes/resources/operational-reports.js` e `backend/src/routes/index.js`

**Checkpoint**: Schema e autorização compartilhada prontos.

---

## Phase 3: User Story 1 — Acessar somente os relatórios autorizados (Priority: P1) 🎯 MVP

**Goal**: Administrar permissões independentes e escolher/abrir somente tipos autorizados.

**Independent Test**: Cobrir contas com zero, uma, duas e três permissões e tentativa direta indevida.

### Tests for User Story 1

- [X] T010 [P] [US1] Criar testes frontend das combinações e escolha direta em `frontend/test/report-permissions.test.mjs`

### Implementation for User Story 1

- [X] T011 [P] [US1] Adicionar tipos e helpers de permissão em `frontend/src/types/auth.ts` e `frontend/src/auth/reportPermissions.ts`
- [X] T012 [US1] Editar as três permissões como checkboxes independentes usando `field-group` no modal de `frontend/src/pages/admin/AdminAccountsPage.tsx`
- [X] T013 [US1] Implementar seletor responsivo com `Button`/`Modal` e wrapper por `?tipo=` em `frontend/src/components/reports/ReportTypeChooser.tsx` e `frontend/src/pages/collaborator/NewReportPage.tsx`

**Checkpoint**: Tipos não autorizados ficam invisíveis e bloqueados nas duas pontas.

---

## Phase 4: User Story 2 — Registrar e aprovar RDO de manutenção 5002 (Priority: P1)

**Goal**: RDO 5002 com jornada, cartões de equipamentos, aprovação conjunta e PDF individual.

**Independent Test**: Criar RDO com duas manutenções, turno noturno/fotos/terceiros, aprovar e verificar dois documentos sem PDF geral.

### Tests for User Story 2

- [X] T014 [P] [US2] Criar testes de validação, permissão, jornada, transição conjunta e idempotência em `backend/test/operational-reports.test.js`
- [X] T015 [P] [US2] Criar testes estruturais do DOCX para checklist, terceiros, fotos, observação e supervisor em `backend/test/maintenance-docx.test.js`

### Implementation for User Story 2

- [X] T016 [P] [US2] Implementar armazenamento validado de fotos/PDF e download autorizado em `backend/src/lib/operational-reports/maintenance-attachments.js`
- [X] T017 [US2] Implementar preenchimento robusto do modelo e conversão DOCX→PDF em `backend/src/lib/operational-reports/maintenance-docx.js`
- [X] T018 [US2] Implementar contexto, CRUD do RDO 5002 e aprovação/devolução atômica em `backend/src/routes/resources/operational-reports.js`
- [X] T019 [P] [US2] Criar tipos/API TanStack para contexto e RDO 5002 em `frontend/src/api/operationalReports.ts`
- [X] T020 [US2] Criar schema Zod + React Hook Form e formulário mobile-first em etapas usando `Button`, `SearchBar`, `ConfirmDialog`, `.field-invalid` e `.field-error` em `frontend/src/schemas/operationalReport.ts` e `frontend/src/pages/collaborator/OperationalReportFormPage.tsx`
- [X] T021 [US2] Criar listagem/detalhe/revisão responsivos do supervisor e ADMIN em `frontend/src/pages/OperationalReportsPage.tsx` e registrar rotas em `frontend/src/App.tsx`

**Checkpoint**: RDO 5002 completo e aprovável, sem documento geral.

---

## Phase 5: User Story 3 — Manutenção avulsa e histórico do equipamento (Priority: P1)

**Goal**: Registrar uma manutenção sem RDO e consultar somente aprovadas no equipamento.

**Independent Test**: Criar, devolver, corrigir e aprovar avulsa; confirmar documento e snapshot no histórico.

### Tests for User Story 3

- [X] T022 [P] [US3] Estender testes de manutenção avulsa, supervisor ausente, snapshot e histórico em `backend/test/operational-reports.test.js`

### Implementation for User Story 3

- [X] T023 [US3] Implementar CRUD/transição da manutenção avulsa e download do documento em `backend/src/routes/resources/operational-reports.js`
- [X] T024 [US3] Implementar configuração global, elegibilidade, perfis editáveis e histórico aprovado em `backend/src/routes/resources/equipamentos.js`
- [X] T025 [P] [US3] Estender tipos e chamadas de configuração/histórico em `frontend/src/api/equipamentos.ts`
- [X] T026 [US3] Adicionar ação avulsa ao formulário e à página inicial autorizada em `frontend/src/pages/collaborator/OperationalReportFormPage.tsx` e `frontend/src/pages/collaborator/HomePage.tsx`
- [X] T027 [US3] Implementar seção de configuração e histórico em URL/query params usando shell de Equipamentos, `Modal`, `Button`, `SearchBar`, `Skeleton`, cards mobile e controles explícitos de ordem em `frontend/src/pages/equipamentos/EquipamentosPage.tsx`

**Checkpoint**: Registros vinculados/avulsos são indistinguíveis no histórico e usam o supervisor global.

---

## Phase 6: User Story 4 — Registrar e aprovar produção 5004 (Priority: P2)

**Goal**: RDO 5004 com limpeza química, HE e aprovação sem documento.

**Independent Test**: Registrar quatro materiais, validar kg/Outros, aprovar e verificar ausência total de arquivos/assinaturas.

### Tests for User Story 4

- [X] T028 [P] [US4] Estender testes de produção, quantidade/material e ausência de pós-processamento em `backend/test/operational-reports.test.js`

### Implementation for User Story 4

- [X] T029 [US4] Implementar CRUD e aprovação do RDO 5004 sem efeitos documentais em `backend/src/routes/resources/operational-reports.js`
- [X] T030 [US4] Implementar cartões “Limpeza química” e revisão 5004 nos componentes compartilhados de `frontend/src/pages/collaborator/OperationalReportFormPage.tsx` e `frontend/src/pages/OperationalReportsPage.tsx`

**Checkpoint**: Produção controla dados e aprovação sem gerar documento.

---

## Phase 7: User Story 5 — Configurar e acompanhar indicadores da Sede (Priority: P2)

**Goal**: Exibir indicadores aprovados de 5002/5004 no mesmo período dos custos.

**Independent Test**: Comparar somas manuais por período/perfil/equipamento/material com a aba Sede.

### Tests for User Story 5

- [X] T031 [P] [US5] Criar testes puros/agregados dos indicadores e exclusão de não aprovados em `backend/test/sede-operational-metrics.test.js`

### Implementation for User Story 5

- [X] T032 [US5] Implementar consulta/agregação de horas, HE, colaboradores, manutenção e kg em `backend/src/lib/acompanhamento/sede-operational-metrics.js`
- [X] T033 [US5] Anexar métricas à resposta sem alterar custos em `backend/src/routes/resources/acompanhamento-comercial.js` e incluir código 5004 em `backend/src/lib/acompanhamento/sede-cost-centers.js`
- [X] T034 [P] [US5] Estender contrato frontend da Sede em `frontend/src/api/acompanhamentoComercial.ts`
- [X] T035 [US5] Renderizar cards operacionais responsivos e preservar filtros em query params em `frontend/src/components/projects/SedeOperationalCards.tsx` e `frontend/src/components/projects/SedeCostsBoard.tsx`

**Checkpoint**: Indicadores refletem somente aprovados do período e custos permanecem iguais.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T036 Implementar campanha Driver.js centralizada e tutorial guiado, marcador por usuário/navegador e expiração global em 2026-09-13 em `frontend/src/components/reports/OperationalReportsNovelty.tsx` e pontos de montagem da feature
- [X] T037 Aplicar estilos escopados por classes, apenas tokens globais, grids shrink-safe e cards mobile em `frontend/src/styles/operational-reports.css` e importá-los em `frontend/src/main.tsx`
- [X] T038 Auditar todos os campos obrigatórios com `.field-group.field-invalid`, `aria-invalid`, `.field-error`, selects formatados e labels visíveis nos formulários alterados
- [X] T039 Validar continuidade de `?tipo=`, `?etapa=`, seção/perfil/equipamento e filtros Sede após refresh, removendo parâmetros incompatíveis
- [X] T040 Executar Prisma validate/generate, testes backend/frontend, lint, build, architecture check e os cenários de `specs/014-maintenance-production-reports/quickstart.md`
- [X] T041 Atualizar o grafo incremental, executar `detect_changes`, `get_affected_flows` e `tests_for` para revisar impacto e lacunas

---

## Dependencies & Execution Order

- Setup → Foundational bloqueia todas as histórias.
- US1 libera a entrada segura dos fluxos.
- US2 depende da base e do perfil/supervisor persistidos; endpoints de configuração podem ser concluídos junto de US3 antes da aprovação manual.
- US3 reutiliza documento e transição de US2.
- US4 reutiliza cabeçalho/jornada, mas não depende do documento.
- US5 depende de registros aprovados de US2/US4.
- Polish depende das histórias desejadas concluídas.

## Parallel Opportunities

- T004 e T008; T010 e T011; T014 e T015; T016 e T019; T025 e T022; T031 e T034 podem avançar em arquivos independentes após suas dependências.
- US4 pode avançar em paralelo a US3 depois da fundação e dos helpers comuns.

## Parallel Example: User Story 2

```text
T014: testes de transição e autorização backend
T015: testes estruturais do documento
T019: contrato/API frontend
```

## Implementation Strategy

1. Entregar schema e autorização primeiro.
2. Validar US1 isoladamente.
3. Entregar RDO 5002 e geração documental.
4. Acrescentar avulsa/configuração/histórico.
5. Acrescentar 5004 sem pipeline documental.
6. Fechar indicadores, tutorial, responsividade e validação integral.

## Format Validation

Todas as tarefas seguem `- [ ] TNNN [P?] [US?] descrição com caminho` e estão em ordem de dependência.

## Phase 9: Convergence

**Purpose**: Fechar lacunas encontradas na auditoria de implementação contra a especificação e a constituição.

- [X] T042 [US3] Aplicar `react-hook-form` com `zodResolver` ao formulário de manutenção avulsa e ao modal de perfil, mantendo erros por campo no padrão do app, em `frontend/src/pages/collaborator/OperationalReportFormPage.tsx`, `frontend/src/pages/equipamentos/MaintenanceConfigPanel.tsx` e `frontend/src/schemas/operationalReport.ts`
- [X] T043 [US5] Preservar IDs dos serviços ao editar/reordenar perfis, modelar `id`, `order` e `isActive` no contrato e permitir ativação/desativação individual sem `deleteMany` destrutivo, em `backend/src/lib/operational-reports/domain.js`, `backend/src/routes/resources/equipamentos.js`, `frontend/src/api/equipamentos.ts` e `frontend/src/pages/equipamentos/MaintenanceConfigPanel.tsx`
- [X] T044 [US2] Separar edição de revisão: exigir permissão de emissão e autoria para alterações, permitir ao aprovador apenas a transição quando não puder emitir, não executar `PUT` implicitamente ao aprovar/devolver e tornar todo registro aprovado somente leitura independentemente da rota de entrada, em `backend/src/routes/resources/operational-reports.js`, `frontend/src/pages/collaborator/OperationalReportFormPage.tsx` e `frontend/src/pages/OperationalReportsPage.tsx`
- [X] T045 [P] Registrar eventos diagnósticos estruturados e sem conteúdo sensível para recusas de permissão, aprovação, geração de documento e processamento de fotos, em `backend/src/lib/operational-reports/` e `backend/src/routes/resources/operational-reports.js`
- [X] T046 [US2] Criar testes de integração das rotas operacionais cobrindo matriz de autorização, alteração/submissão/upload, aprovação/devolução conjunta e concorrente, documento único, snapshot do supervisor, histórico aprovado e ausência de artefatos em produção, em `backend/test/operational-reports-routes.test.js`
- [X] T047 [P] Montar a campanha `OperationalReportsNovelty` nos pontos de entrada de todos os perfis elegíveis, incluindo gestor/ADMIN e configuração/consulta, e cobrir exibição única e expiração em teste, em `frontend/src/components/reports/OperationalReportsNovelty.tsx`, `frontend/src/pages/gestor/GestorPage.tsx`, `frontend/src/pages/OperationalReportsPage.tsx`, `frontend/src/pages/equipamentos/EquipamentosPage.tsx` e `frontend/test/operational-report-layout.test.mjs`

---

## Phase 10: Dedicated Maintenance and Production Module

**Purpose**: Transformar a feature ainda não publicada em um módulo próprio, com entrada e históricos separados por permissão.

### Tests

- [X] T048 [P] [US1] Atualizar testes da matriz de navegação para módulo, abas e criação/revisão condicionadas à permissão da área em `frontend/test/report-permissions.test.mjs`
- [X] T049 [P] [US3] Criar testes backend do histórico consolidado cobrindo autorização, somente aprovados, ambas as origens, busca, ordenação, paginação e disponibilidade de PDF em `backend/test/operational-reports-routes.test.js`
- [X] T050 [P] [US1] Atualizar testes estruturais de layout para registro do módulo, persistência da aba, cards mobile e tutorial/novidade em `frontend/test/operational-report-layout.test.mjs`

### Implementation

- [X] T051 [US3] Implementar `GET /maintenance/history` paginado e autorizado antes das rotas parametrizadas em `backend/src/routes/resources/operational-reports.js`
- [X] T052 [P] [US3] Adicionar contrato e query do histórico consolidado em `frontend/src/api/operationalReports.ts`
- [X] T053 [US1] Registrar “Manutenção e produção” no Hub/roteamento, derivar acesso e abas das capacidades e bloquear acesso direto sem autorização em `frontend/src/pages/hubModules.ts`, `frontend/src/App.tsx` e `frontend/src/auth/reportPermissions.ts`
- [X] T054 [US1] Substituir a página interna provisória pelo módulo com abas `manutencao`, `producao` e `historico-manutencao`, históricos por tipo, ações de criação condicionais e filtros persistidos em `frontend/src/pages/MaintenanceProductionPage.tsx`
- [X] T055 [US1] Remover manutenção/produção do seletor e dos atalhos do RDO/Home, preservando abertura direta de rascunhos pelo editor, em `frontend/src/pages/collaborator/NewReportPage.tsx`, `frontend/src/pages/collaborator/HomePage.tsx` e consumidores de `ReportTypeChooser.tsx`
- [X] T056 [US3] Implementar tabela desktop e cartões mobile do histórico consolidado com busca, paginação e download seguro em `frontend/src/components/reports/MaintenanceHistoryTable.tsx` e `frontend/src/styles/operational-reports.css`
- [X] T057 Atualizar tutorial permanente de primeira entrada e campanha temporária até 2026-09-14, validar a 360 px e desktop, executar testes, lint, build, architecture check e revisão pelo grafo em `frontend/src/components/reports/OperationalReportsNovelty.tsx`, `frontend/test/` e artefatos da feature

**Checkpoint**: Manutenção e produção possuem módulo próprio desde o primeiro lançamento; RDO de obra não expõe os fluxos e todos os históricos estão acessíveis conforme permissão.

---

## Phase 11: Desktop Width, History Sorting and Required Markers

- [X] T058 Liberar o shell do módulo para a largura operacional em desktop preservando o layout mobile em `frontend/src/styles/operational-reports.css`
- [X] T059 Implementar ordenação crescente/decrescente paginada por cabeçalho, com estado na URL, contrato frontend e validação backend em `frontend/src/components/reports/MaintenanceHistoryTable.tsx`, `frontend/src/pages/MaintenanceProductionPage.tsx`, `frontend/src/api/operationalReports.ts`, `backend/src/lib/operational-reports/domain.js` e `backend/src/routes/resources/operational-reports.js`
- [X] T060 Auditar e indicar com asterisco vermelho todos os campos obrigatórios fixos e condicionais dos formulários 5002, 5004 e manutenção avulsa em `frontend/src/components/reports/ReportCoreFields.tsx` e `frontend/src/pages/collaborator/OperationalReportFormPage.tsx`
- [X] T061 Cobrir largura, ordenação e obrigatoriedade com testes, validar visualmente desktop/mobile e executar lint, build, testes, architecture check e revisão pelo grafo

---

## Phase 12: Preventive Maintenance Schedule

- [X] T062 Persistir `maintenanceIntervalDays` opcional e validado por categoria com migration Prisma, contrato API e formulário React Hook Form/Zod no painel de manutenção de Equipamentos
- [X] T063 Implementar projeção e endpoint paginado da programação usando somente a manutenção aprovada mais recente, data de São Paulo, busca e filtros autorizados
- [X] T064 Adicionar aba “Programação” condicionada à permissão de manutenção, agrupamento por categoria, resumo de situações e destaque visual dos vencidos em tabela desktop e cartões mobile
- [X] T065 Corrigir a navegação interna do módulo com posição sticky relativa ao contêiner e grade responsiva sem sobreposição, incluindo a quarta aba
- [X] T066 Cobrir regra de prazo, rota, permissões e UI; validar desktop/mobile, executar Prisma, testes, lint, build, arquitetura e revisão pelo grafo
