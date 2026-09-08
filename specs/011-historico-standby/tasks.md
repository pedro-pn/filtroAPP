# Tasks: Histórico de standby por projeto

**Input**: Design documents from `/specs/011-historico-standby/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Incluídos para a regra de negócio do backend e para a expiração/isolamento da campanha de novidade.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode ser executada em paralelo por tocar arquivos diferentes e não depender de tarefa incompleta.
- **[Story]**: Mapeia a tarefa a uma história de usuário da especificação.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirmar que a feature usa a infraestrutura existente sem dependências ou migrations.

- [X] T001 Verificar os padrões de ignore e confirmar que não há nova dependência ou mudança de schema em `.gitignore`, `backend/package.json`, `frontend/package.json` e `backend/prisma/schema.prisma`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: A autenticação, o cliente HTTP, React Query, `Modal`, `Button` e o modelo de relatórios já existem. Nenhuma nova fundação compartilhada é necessária além da confirmação de T001.

**Checkpoint**: Infraestrutura existente confirmada; histórias podem ser implementadas.

---

## Phase 3: User Story 1 - Consultar histórico de standby do projeto (Priority: P1) 🎯 MVP

**Goal**: Permitir abrir, dentro do dashboard de um projeto individual, um diálogo com uma linha por dia de standby positivo contendo data, duração, efetivo e motivo do projeto correto.

**Independent Test**: Em um projeto com dias com e sem standby, abrir o dashboard, acionar o botão junto ao resumo de standby e confirmar as quatro colunas e somente os dias positivos em ordem decrescente; o card externo e dashboards de agrupamentos não oferecem a ação.

### Tests for User Story 1

- [X] T002 [US1] Escrever testes inicialmente falhos para filtro, seleção de fonte, agregação diária, ordenação, duração, efetivo e motivo em `backend/test/acompanhamento-standby-history.test.js`

### Implementation for User Story 1

- [X] T003 [US1] Implementar a agregação pura e a consulta Prisma somente leitura em `backend/src/lib/acompanhamento/standby-history.js`
- [X] T004 [US1] Expor `GET /projetos/:projectId/standby-historico` com validação Zod, autenticação do Acompanhamento e resposta 404 em `backend/src/routes/resources/acompanhamento-comercial.js`
- [X] T005 [P] [US1] Adicionar `ProjectStandbyHistory`, `ProjectStandbyHistoryEntry` e `getProjectStandbyHistory` em `frontend/src/api/acompanhamentoComercial.ts`
- [X] T006 [US1] Criar a tabela de histórico em diálogo acessível reutilizando `Modal`, `Button` e `acp-manage-head/body/foot` em `frontend/src/components/projects/ProjectStandbyHistoryDialog.tsx`
- [X] T007 [US1] Adicionar o botão `Ver histórico` junto ao KPI de standby de dashboards individuais e controlar o diálogo em `frontend/src/components/projects/ProjectDetailDashboard.tsx`

**Checkpoint**: A história P1 funciona ponta a ponta e os testes de agregação passam.

---

## Phase 4: User Story 2 - Entender estados do histórico em qualquer tela (Priority: P2)

**Goal**: Tornar carregamento, vazio, erro, nova tentativa, fechamento e uso mobile claros e divulgar temporariamente a nova função.

**Independent Test**: Abrir projeto vazio, simular erro e repetir em 320 px; o diálogo comunica cada estado, permite tentar novamente/fechar e converte a tabela em blocos sem overflow horizontal.

### Tests for User Story 2

- [X] T008 [P] [US2] Escrever teste inicialmente falho para marcador por usuário e expiração global em 2026-09-04 em `frontend/test/route-access.test.mjs`

### Implementation for User Story 2

- [X] T009 [US2] Completar estados de carregamento, vazio, erro/nova tentativa e ações de fechamento no diálogo em `frontend/src/components/projects/ProjectStandbyHistoryDialog.tsx`
- [X] T010 [P] [US2] Implementar tabela desktop, linhas empilhadas até 640 px, quebra de motivo, ação shrink-safe e modal sem overflow usando apenas tokens em `frontend/src/styles/base.css`
- [X] T011 [US2] Implementar chave, verificação e marcação da campanha de 10 dias em `frontend/src/auth/moduleNavigation.ts`
- [X] T012 [US2] Criar aviso Driver.js dedicado com anúncio central e apontamento do botão real em `frontend/src/components/projects/ProjectStandbyHistoryNovelty.tsx`
- [X] T013 [US2] Ativar a campanha somente dentro de dashboard individual com ação disponível em `frontend/src/components/projects/ProjectDetailDashboard.tsx`

**Checkpoint**: Histórias P1 e P2 funcionam, inclusive mobile, falha de rede e campanha temporária.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Validar regressões, contrato, impacto e fidelidade visual.

- [X] T014 Executar o teste focal, a suíte completa do backend, a suíte do frontend e o build descritos em `specs/011-historico-standby/quickstart.md`
- [X] T015 Auditar manualmente desktop, 640 px e 320 px, foco/Escape, motivos longos e ausência de scroll horizontal em `frontend/src/components/projects/ProjectStandbyHistoryDialog.tsx` e `frontend/src/styles/base.css`
- [X] T016 Revisar contrato e implementação final contra `specs/011-historico-standby/contracts/project-standby-history-api.md` e `specs/011-historico-standby/spec.md`
- [X] T017 Atualizar o grafo e revisar impacto, fluxos afetados e cobertura dos arquivos alterados contra `specs/011-historico-standby/plan.md`

---

## Phase 6: Correção de localização da ação

**Purpose**: Aplicar a clarificação de que o histórico pertence ao dashboard detalhado, e não ao card externo.

- [X] T018 Remover botão, estado do diálogo e anúncio de standby do card externo em `frontend/src/components/projects/ProjectCardsBoard.tsx` e `frontend/src/components/projects/ProjectTrackingNovelties.tsx`
- [X] T019 Integrar botão, diálogo e anúncio dedicado junto ao resumo de standby em `frontend/src/components/projects/ProjectDetailDashboard.tsx` e `frontend/src/components/projects/ProjectStandbyHistoryNovelty.tsx`
- [X] T020 Atualizar especificação, plano, pesquisa, quickstart e validação visual para refletir o dashboard como única origem da ação

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências.
- **Foundational (Phase 2)**: depende de T001 e confirma o reaproveitamento da infraestrutura.
- **User Story 1 (Phase 3)**: depende da fundação; T002 deve falhar antes de T003; T004 depende de T003; T006 depende de T005; T007 depende de T006.
- **User Story 2 (Phase 4)**: depende do diálogo e do botão da US1; T008 deve falhar antes de T011; T012 depende de T011; T013 depende de T012.
- **Polish (Phase 5)**: depende das histórias desejadas concluídas.

### User Story Dependencies

- **User Story 1 (P1)**: inicia após Setup/Foundation e constitui o MVP completo.
- **User Story 2 (P2)**: integra estados e responsividade ao diálogo da US1, mas pode ser validada separadamente com vazio, erro e viewport estreita.

### Parallel Opportunities

- T005 pode avançar em paralelo com T002–T004 porque toca somente o contrato do frontend.
- T008 e T010 podem avançar em paralelo depois que a estrutura do diálogo da US1 existir.
- Validações automatizadas de backend e frontend de T014 podem ser executadas em paralelo quando não disputarem recursos locais.

## Parallel Example: User Story 1

```text
Task T002: escrever testes da agregação no backend.
Task T005: tipar o contrato e criar o fetcher no frontend.
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Confirmar Setup/Foundation.
2. Escrever e executar o teste falho T002.
3. Implementar serviço, rota, cliente, diálogo e botão T003–T007.
4. Validar a história de forma independente antes dos estados e campanha adicionais.

### Incremental Delivery

1. US1 entrega a consulta diária solicitada.
2. US2 adiciona resiliência, mobile e descoberta sem mudar o contrato central.
3. Polish valida as duas histórias e o impacto arquitetural.

## Notes

- Todas as tarefas seguem o formato de checklist com ID, história quando aplicável e caminhos exatos.
- Não há migration, dependência nova, formulário, dropdown, drag and drop ou persistência de navegação nesta feature.
- Cards agrupados permanecem fora do escopo do histórico individual.
