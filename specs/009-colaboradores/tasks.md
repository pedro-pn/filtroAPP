---
description: "Task list — Aba Colaboradores no Acompanhamento (feature 009)"
---

# Tasks: Aba Colaboradores no Acompanhamento

**Input**: Design documents from `/specs/009-colaboradores/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/colaboradores-api.md, quickstart.md

**Tests**: INCLUÍDOS. A lógica de cálculo (improdutividade, taxa geral, alocação) é regra de negócio no backend → testes obrigatórios pela Constitution (Princípio V).

**Organization**: Tarefas agrupadas por user story (US1 P1, US2 P2, US3 P3), cada uma entregável e testável de forma independente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- Caminhos exatos incluídos. Drag and drop: **N/A** (não há reordenação nesta feature).

## Path Conventions

- Web app: `backend/src/`, `frontend/src/`, testes em `backend/test/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verificar pré-requisitos; a stack (React/Express/Prisma/Zod) já existe.

- [X] T001 Confirmar branch `009-colaboradores` e ler os design docs em `specs/009-colaboradores/` (plan, data-model, contracts). Nenhuma dependência nova de runtime é necessária.
- [X] T002 [P] Confirmar que `driver.js` já é dependência do frontend (usado pelos componentes `*Novelty.tsx`) para reaproveitar na campanha de novidade; verificar em `frontend/package.json`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infraestrutura compartilhada por TODAS as user stories (schema, carga base de ponto, esqueleto de rota e da seção no frontend).

**⚠️ CRITICAL**: Nenhuma user story começa antes desta fase.

- [X] T003 Adicionar `isOperational Boolean @default(true)` ao model `JobRole` em `backend/prisma/schema.prisma` (cargo compõe a equipe operacional). Criar a migration Prisma versionada; documentar `npx prisma migrate deploy` para o operador rodar no servidor (Princípio I).
- [X] T004 Criar módulo `backend/src/lib/acompanhamento/collaborator-productivity.js` com o **resolvedor de classificação operacional** (Collaborator → cargo/JobRole → `isOperational`), incluindo os fallbacks do data-model (jobRoleId/CostProfile → `Collaborator.role` casado com `JobRole.name` normalizado → default operacional). Não silenciar colaborador sem cargo resolvido.
- [X] T005 Em `collaborator-productivity.js`, implementar a **carga anual base** por colaborador: ler `PontoPeriodSummary` que intersecta o ano, reutilizar `mergePontoPeriods` de `labor-cost.js`, somar `monthly[YYYY-MM].normalMinutes` do ano (÷60 = HH) e contar `mesesAtivos` (FR-017; mês parcial = 1). Excluir `he70/he100Minutes`.
- [X] T006 Criar a rota `backend/src/routes/resources/acompanhamento-colaboradores.js` — `GET /api/acompanhamento/colaboradores` com `requireAuth` + `requireAcompanhamentoManager`, query `year` (Zod, default ano corrente) conforme `contracts/colaboradores-api.md`; registrar em `backend/src/routes/index.js` ao lado de `acompanhamento-custo`.
- [X] T007 Em `frontend/src/pages/acompanhamento/AcompanhamentoPage.tsx`, adicionar a seção `'colaboradores'` ao tipo `Section`, ao `equip-nav` (desktop) e ao `equip-mobile-nav` (select), **visível só para manager** (espelhando o tratamento de `custo`), com persistência em `?section=colaboradores` e limpeza de `?colaborador=` ao sair da seção.
- [X] T008 [P] Adicionar método de API + `queryKey` + hook react-query para `GET /api/acompanhamento/colaboradores` no cliente do módulo Acompanhamento (padrão dos hooks existentes em `frontend/src/hooks/`).
- [X] T009 Criar `frontend/src/components/projects/CollaboratorsBoard.tsx` (shell no padrão de `SedeCostsBoard.tsx`) com estados de carregando (`Skeleton`), vazio (FR-014) e erro (`Toast`); montar no switch de conteúdo de `AcompanhamentoPage.tsx`.

**Checkpoint**: Fundação pronta — schema, carga de ponto, rota protegida e seção do módulo existem; user stories podem começar.

---

## Phase 3: User Story 1 - Taxa de Improdutividade da equipe operacional (Priority: P1) 🎯 MVP

**Goal**: Por colaborador operacional, exibir total/acumulado anual de HH, média mensal, taxa individual (piso 0%) e a Taxa Geral da equipe.

**Independent Test**: Abrir a seção como manager e conferir, para um colaborador, `mediaMensal = totalHH ÷ mesesAtivos` e `taxaGeral = Σ taxaIndividual ÷ N` (tolerância ≤ 0,1); extras não inflam o total; média ≥ 161 → 0%.

### Tests for User Story 1 ⚠️ (escrever antes; devem falhar)

- [X] T010 [P] [US1] Teste em `backend/test/acompanhamento-colaboradores.test.js`: horas extras (`he70/he100`) **não** alteram `totalHHprodutivas`/`mediaMensal`/`taxaIndividual` (invariante 1 / SC-005).
- [X] T011 [P] [US1] Teste em `backend/test/acompanhamento-colaboradores.test.js`: `mediaMensal ≥ 161 ⇒ taxaIndividual = 0` (invariante 2 / FR-008 / SC-003).
- [X] T012 [P] [US1] Teste em `backend/test/acompanhamento-colaboradores.test.js`: `taxaGeral` = média aritmética das taxas individuais dos **operacionais** com `mesesAtivos > 0`; administrativo (`isOperational=false`) fica fora (invariantes 3 e 5 / FR-009 / SC-004).

### Implementation for User Story 1

- [X] T013 [US1] Em `collaborator-productivity.js`, implementar por colaborador: `totalHHprodutivas`, `mediaMensal = total ÷ mesesAtivos` e `taxaIndividual = max(0, (161 − mediaMensal)/161)`; constante nomeada `HH_PRODUTIVAS_REF = 161` com comentário da derivação `176 × 11 ÷ 12`. Excluir colaborador com `mesesAtivos = 0` da taxa. (depende de T004, T005)
- [X] T014 [US1] Em `collaborator-productivity.js`, implementar `taxaGeral` = Σ taxas individuais ÷ N sobre os operacionais com `mesesAtivos > 0` (retornar `null` quando N = 0). (depende de T013)
- [X] T015 [US1] Preencher a resposta da rota `acompanhamento-colaboradores.js` com `{ year, refMensal, taxaGeral, colaboradores[] }` (campos `code/name/role/isOperational/totalHHprodutivas/mesesAtivos/mediaMensal/taxaIndividual`) conforme `contracts/colaboradores-api.md`. (depende de T006, T014)
- [X] T016 [US1] Em `CollaboratorsBoard.tsx`, renderizar a **Taxa Geral** no topo e a tabela/cards por colaborador (HH acumulada, média mensal, taxa individual), com `select` de ano (herda estilo de `base.css`); usar tokens de `variables.css` e componentes do kit. (depende de T009, T015)
- [X] T017 [US1] Em `frontend/src/components/projects/JobRoleManager.tsx`, adicionar o toggle **operacional/administrativo** (`isOperational`) usando estrutura `field-group`/`admin-inline-form` do kit; estender o endpoint/schema Zod de atualização de `JobRole` no backend para aceitar `isOperational`. (depende de T003)
- [X] T018 [US1] Garantir responsivo em `CollaboratorsBoard.tsx`: tabela de indicadores vira cards empilhados em telas estreitas; valores de HH/percentuais quebram/truncam com `min-width: 0`, sem scroll horizontal de página (Princípio II).

**Checkpoint**: US1 funcional — MVP entregável (indicadores + Taxa Geral).

---

## Phase 4: User Story 2 - Calendário/visão de alocação (Priority: P2)

**Goal**: Mostrar onde cada colaborador esteve/está e quem está disponível.

**Independent Test**: Para um colaborador com dias em projeto e dias sem projeto, ver os períodos por obra, a situação atual destacada e o filtro "disponíveis" listando quem está em sede.

### Tests for User Story 2 ⚠️

- [X] T019 [P] [US2] Teste em `backend/test/acompanhamento-colaboradores.test.js`: classificação diária projeto/sede/folga e `disponivel = (situacaoAtual === 'sede')` a partir de ponto × RDO.

### Implementation for User Story 2

- [X] T020 [US2] Em `collaborator-productivity.js`, derivar a **alocação** por colaborador reutilizando `rdoDataByCollaboratorFromReports` e a classificação diária de `labor-cost.js`: `periodos[]` (agrupamento contíguo de `workedDates` por projeto), `situacaoAtual` (registro mais recente), `projetoAtual`, `disponivel`. (depende de T005)
- [X] T021 [US2] Estender a resposta da rota com `alocacao{ situacaoAtual, projetoAtual, disponivel, periodos[] }` e o filtro de query `disponivel` (Zod) conforme contrato. (depende de T015, T020)
- [X] T022 [US2] Em `CollaboratorsBoard.tsx`, exibir a visão de alocação (períodos por projeto/obra), badge de situação atual e o filtro **disponíveis**; badges e rótulos truncam sem estourar. (depende de T016, T021)
- [X] T023 [US2] Auditoria de overflow dos badges/linhas de alocação em telas estreitas (sem scroll horizontal de página).

**Checkpoint**: US1 e US2 funcionam independentemente.

---

## Phase 5: User Story 3 - Detalhe mensal do colaborador (Priority: P3)

**Goal**: Ver HH produtivas por mês de um colaborador e a comparação com 161 HH.

**Independent Test**: Abrir o detalhe (via `?colaborador=`) e conferir que a soma dos meses bate com o total anual e a média = total ÷ meses ativos.

### Tests for User Story 3 ⚠️

- [X] T024 [P] [US3] Teste em `backend/test/acompanhamento-colaboradores.test.js`: `Σ porMes[].hhProdutivas = totalHHprodutivas` (invariante 4).

### Implementation for User Story 3

- [X] T025 [US3] Em `collaborator-productivity.js`, adicionar `porMes[] = { mes, hhProdutivas, acimaDaRef: hh ≥ 161 }` ao resultado por colaborador. (depende de T013)
- [X] T026 [US3] Em `CollaboratorsBoard.tsx`/subcomponente, exibir o **detalhe do colaborador** (desdobramento mensal vs 161 HH) selecionado via `?colaborador=...`, sobrevivendo a refresh; voltar à lista limpa o parâmetro. (depende de T016, T025)
- [X] T027 [US3] Garantir responsivo do detalhe mensal (tabela → cards; sem overflow horizontal).

**Checkpoint**: Todas as user stories independentes e funcionais.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T028 Criar `frontend/src/components/projects/CollaboratorsNovelty.tsx` (campanha de novidade no padrão dos `*Novelty.tsx` + `driver.js`): card centralizado, "visto" em `localStorage` por usuário/navegador, expiração global 10 dias corridos após a data de implementação registrada no código; disparar no primeiro acesso do manager à seção Colaboradores.
- [X] T029 Tutorial guiado de primeiro acesso à função nova (mesma janela de 10 dias), apontando os controles reais (Taxa Geral, filtro de ano, disponíveis); termina sem bloquear o uso.
- [X] T030 Validação de campo obrigatório na UI do toggle de cargo (`JobRoleManager`): ao salvar inválido, o campo recebe `.field-group.field-invalid` + `.field-error` + `aria-invalid` (não depender da validação nativa).
- [X] T031 Continuidade de navegação: `?section=colaboradores` e `?colaborador=` sobrevivem a refresh/deep-link; parâmetros incompatíveis são limpos ao trocar de seção.
- [X] T032 [P] Auditoria de overflow mobile em toda a seção (board, detalhe, badges, métricas): filhos flex/grid com `min-width: 0`, mínimos com `minmax(min(100%, ...), 1fr)`; sem scroll horizontal de página.
- [X] T033 [P] Passe de consistência visual: componentes de `components/ui/`, tokens de `variables.css`, `select` com estados default/foco/disabled/erro; shell largo `equip-page` no desktop.
- [X] T034 Rodar a validação de `specs/009-colaboradores/quickstart.md` (cenários 1–6).
- [X] T035 [P] Garantir `cd backend && npm test` verde (todos os testes de `acompanhamento-colaboradores.test.js` passam).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências.
- **Foundational (Phase 2)**: depende do Setup; **bloqueia** todas as user stories.
- **User Stories (Phase 3–5)**: dependem da Fase 2. US1 → US2 → US3 por prioridade, mas cada uma é testável isoladamente.
- **Polish (Phase 6)**: depende das user stories desejadas concluídas.

### User Story Dependencies

- **US1 (P1)**: após Fase 2. Sem dependência de outras stories.
- **US2 (P2)**: após Fase 2. Estende a mesma rota/board da US1, mas testável de forma independente (T019–T023).
- **US3 (P3)**: após Fase 2 (usa T013 da US1 para o cálculo base). Detalhe independente.

### Within Each User Story

- Testes escritos e falhando antes da implementação.
- Cálculo (lib) antes da rota; rota antes do board; board antes do detalhe.

### Parallel Opportunities

- Setup: T002 em paralelo.
- Foundational: T008 em paralelo com o restante do frontend (após T007).
- US1: testes T010/T011/T012 em paralelo entre si.
- Polish: T032/T033/T035 em paralelo.

---

## Parallel Example: User Story 1

```bash
# Testes de US1 juntos (devem falhar antes da implementação):
Task: "T010 extras não contam em backend/test/acompanhamento-colaboradores.test.js"
Task: "T011 piso 0% em backend/test/acompanhamento-colaboradores.test.js"
Task: "T012 taxa geral operacional-only em backend/test/acompanhamento-colaboradores.test.js"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Fase 1 (Setup) → 2. Fase 2 (Foundational, crítica) → 3. Fase 3 (US1) → 4. **PARAR e VALIDAR** US1 (indicadores + Taxa Geral) → 5. Deploy/demo.

### Incremental Delivery

1. Setup + Foundational → fundação pronta.
2. US1 → testar → demo (MVP: Taxa de Improdutividade).
3. US2 → alocação/disponíveis → demo.
4. US3 → detalhe mensal → demo.
5. Polish → novidade, tutorial, auditorias, quickstart.

---

## Notes

- [P] = arquivos diferentes, sem dependência pendente.
- Comandos de servidor (migration deploy) **não** são executados pelo agente — entregar em bloco "rode no servidor".
- Migration `JobRole.isOperational` usa `@default(true)`: a feature funciona sem reclassificação; o gestor marca administrativos pela UI (T017).
- Reutilizar `mergePontoPeriods`, `rdoDataByCollaboratorFromReports` e a classificação diária de `labor-cost.js`; não duplicar o cruzamento ponto × RDO.
- Commit após cada tarefa ou grupo lógico; parar em cada checkpoint para validar a story.
