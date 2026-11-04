# Implementation Plan: Conferência semanal de alocação

**Branch**: `feat/037-conferencia-alocacao` | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/037-conferencia-alocacao/spec.md`

## Summary

Nova seção **Conferência** no módulo Efetivo. Ela mostra, por semana, a alocação diária que o
app já calcula (ponto, RDO, Efetivo e ausências) e deixa o responsável corrigir, conferir cada
linha e fechar a semana.

Os dias de linhas conferidas passam a ter precedência máxima em três lugares:

- no custo HH (`labor-cost.js`);
- no relatório Alocação dos colaboradores (`allocation-monthly-report.js`);
- no envio automático do relatório, que espera as semanas fecharem até o 3º dia útil.

Marcar Folga, Férias ou Afastamento sem ausência cadastrada gera aviso aos gestores do Efetivo
na central de notificações. Dia não conferido continua idêntico ao comportamento atual.

As decisões técnicas e suas justificativas estão em [research.md](./research.md). A principal
diferença em relação à descrição original: a conferência fica em **tabelas próprias** com
precedência sobre o ajuste manual, em vez de gravar `PontoDayProjectOverride`. O ajuste manual
não representa "dia sem projeto" e é apagado por outros fluxos (R1).

## Technical Context

**Language/Version**: Node.js (ESM) no backend; React 18 + TypeScript + Vite no frontend.

**Primary Dependencies**:

- Backend: Express, Prisma, Zod, pdf-lib (PDF do relatório).
- Frontend: @tanstack/react-query, zustand, react-hook-form + Zod e driver.js (novidade).

**Storage**: PostgreSQL via Prisma, com 6 tabelas e 4 enums novos e um valor novo em
`ModuleRoleCode` ([data-model.md](./data-model.md)).

**Testing**: `node --test` em `backend/test` (fakes de `client`/prisma, sem biblioteca de
mock). Frontend validado com `npm run build` (`tsc -b`). `tsc --noEmit` solto não serve neste
repo.

**Target Platform**: aplicação web (desktop e celular), servidor Linux.

**Project Type**: web application (`backend/` + `frontend/` + `shared/`).

**Performance Goals**: a grade de uma semana com cerca de 60 colaboradores responde em até 2 s
com o cache da auditoria quente. Cada escrita responde em até 1 s, já com as linhas recalculadas.

**Constraints**:

- Reaproveitar a trilha memorizada de `classifyProjectHours`, sem novo cálculo pesado.
- Dia não conferido precisa dar resultado idêntico ao atual (FR-016).
- O envio mensal precisa continuar idempotente.

**Scale/Scope**:

- Cerca de 40 a 60 colaboradores e 7 dias por semana.
- Uma tela nova, um painel e um diálogo, mais ajustes em relatório, custo, notificações,
  ausências e permissões.

## Constitution Check

| Princípio | Situação | Como é atendido |
|---|---|---|
| I. Operação de servidor | ✅ | Migration e deploy aparecem só como instrução "rode no servidor", sem execução pelo agente |
| II. pt-BR e mobile-first | ✅ | Tela em pt-BR. Grade vira um card por colaborador em até 640px. Painel em `Modal` com rodapé fixo. Filtros e segmentos quebram linha. Sem scroll horizontal de página |
| III. Zod nas duas pontas | ✅ | Schemas Zod em todas as rotas novas. O painel do dia usa react-hook-form + Zod |
| IV. Só via Prisma | ✅ | Uma migration com enums, tabelas e `ALTER TYPE "ModuleRoleCode" ADD VALUE`. Sem backfill |
| V. Testes de backend | ✅ | Seis arquivos de teste novos ou atualizados (quickstart) |
| VI. Consistência visual | ✅ | Kit `ui/ds`, `Modal`, `ConfirmDialog`, `SearchCombobox`, tokens de `variables.css`, shell fluido do Efetivo, `?section=conferencia&semana=…` na URL e novidade de 10 dias com tutorial. Sem drag and drop |

**Evidência visual exigida:**

| Surface | Existing reference audited | Shared component/classes | Field/dropdown states covered | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial plan | Mobile/desktop overflow evidence |
|---------|----------------------------|--------------------------|-------------------------------|---------------------------|------------------------|------------------------|----------------------------------|
| Seção Conferência (grade) | `pages/efetivo/EfetivoPage.tsx` (SECTIONS, `efetivo-page-v2`), `components/projects/AllocationAuditPanel.tsx`, prévia aprovada | `Card`, `Badge`, `Button`, `MetricCard`, `ProgressBar`, `EmptyState`, `SearchBar`, segmentado do kit, tokens | Busca e segmentos: default, foco e disabled; vazio com `EmptyState` | N/A | `section`, `semana`, `mostrar`, `agrupar` e `q` em `PARAMS_BY_SECTION` | `AllocationReviewNovelty` (driver.js, 10 dias, localStorage por usuário), coordenado por `efetivoGuideCoordinator` | Desktop: tabela com coluna fixa e rolagem horizontal só no contêiner. Até 640px: um card por colaborador com 7 linhas; CNPJ e rótulos quebram |
| Painel do dia | `components/ui/Modal.tsx`, `AbsenceFormModal.tsx` | `Modal`, `Field`/`field-group`, `Select`, `SearchCombobox`, `Textarea`, `Alert` | "Outro projeto" ou "Viagem" sem projeto: `.field-invalid`, `aria-invalid` e `.field-error`; select com foco, disabled e erro | N/A | Estado transitório, não vai para a URL | Coberto pelo tutorial | Lateral no desktop e tela cheia no celular; rodapé fixo; corpo rolável |
| Barra de seleção em massa | Barras de ação do Acompanhamento | `Button`, `Select` do kit | Select do kit | N/A | N/A | Coberto pelo tutorial | Celular: botão "Selecionar dias"; barra fixa no rodapé quebra linha |
| Fechar e reabrir semana | `components/ui/ConfirmDialog.tsx` | `ConfirmDialog` / `useConfirmDialog` | Reabrir: textarea opcional | N/A | N/A | N/A | Padrão do kit |
| Abertura do cadastro de ausência pelo aviso | `CollaboratorsBoard.tsx`, `AbsenceFormModal.tsx` | `AbsenceFormModal` existente | Já cobertos | N/A | Novo `cadastrarAusencia`, `tipo`, `de` e `ate` em `PARAMS_BY_SECTION.colaboradores`, limpos ao fechar | N/A | Existente |
| Relatório Alocação dos colaboradores | `components/stats/StatsDashboard.tsx` (tabelas e cards) | Existentes; `Badge` "Conferido" | N/A | N/A | Existente | N/A (ajuste em tela existente) | Rótulos sem projeto quebram linha, sem nova coluna |

O `AllocationAuditPanel` usado como referência está em conformidade com o kit atual (`ui/ds`) e
não carrega dívida visual. Nenhuma exceção de identidade portada.

**Resultado do gate**: aprovado, sem violações. Nenhum item em Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/037-conferencia-alocacao/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/allocation-review-api.md
├── checklists/requirements.md
└── tasks.md            # gerado por /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── prisma/
│   ├── schema.prisma                                  # enums + 6 modelos + ModuleRoleCode
│   └── migrations/<ts>_allocation_review/migration.sql
├── src/
│   ├── lib/efetivo/
│   │   ├── access.js                                  # canReviewAllocation, requireAllocationReviewer
│   │   └── allocation-review/
│   │       ├── suggestion.js                          # regra pura de sugestão + indicadores (R2)
│   │       ├── read-model.js                          # monta a semana: trilhas + ausências + feriados (R2, R3)
│   │       ├── service.js                             # rascunho, conferir, desconferir, fechar, reabrir, versão (R4)
│   │       ├── confirmed-days.js                      # leitura de dias conferidos para custo e relatório
│   │       ├── absence-alerts.js                      # criar, cancelar e resolver avisos (R8)
│   │       └── schemas.js                             # Zod
│   ├── lib/acompanhamento/labor-cost.js               # precedência REVIEW_* (R1)
│   ├── lib/acompanhamento/allocation-audit.js         # fingerprint + rótulos (R11)
│   ├── lib/allocation-monthly-report.js               # substituição de RDO + janela/espera de envio (R6, R7)
│   ├── lib/calendar/business-day-deadline.js          # nthBusinessDayOfMonth (R7)
│   ├── lib/notifications/center.js                    # kind, escopo e destino novos (R8)
│   ├── lib/efetivo/absences.js                        # chama resolveAllocationReviewAbsenceAlerts (R8)
│   ├── lib/email-templates.js                         # texto do e-mail mensal
│   └── routes/
│       ├── index.js                                   # monta /efetivo/conferencia-alocacao
│       └── resources/allocation-review.js             # contrato da API
└── test/                                              # ver quickstart.md

shared/modules/registry.json                           # papel efetivo:allocation-review (R9)

frontend/src/
├── modules/registry.generated.ts                      # regenerado (npm run modules:generate)
├── api/allocationReview.ts                            # cliente da API + tipos
├── api/statistics.ts                                  # AllocationReportDay: kind, source, nulos
├── utils/planningNavigation.ts                        # seção conferencia + params; cadastrarAusencia
├── utils/allocationReviewNovelty.ts                   # datas da campanha
├── pages/efetivo/
│   ├── EfetivoPage.tsx                                # SECTIONS filtrado por permissão
│   ├── AllocationReviewNovelty.tsx
│   └── components/
│       ├── AllocationReviewBoard.tsx                  # cabeçalho, resumo, filtros, grade/cards
│       ├── AllocationReviewDayPanel.tsx               # painel do dia (Modal)
│       ├── AllocationReviewBulkBar.tsx
│       ├── allocationReviewPresentation.ts            # rótulos, cores e agrupamento
│       ├── AllocationReviewBoard.css                  # só tokens
│       └── CollaboratorsBoard.tsx / AbsenceFormModal.tsx   # abrir via URL com valores
├── components/projects/allocationReasons.ts           # rótulos REVIEW_*
├── components/stats/StatsDashboard.tsx                # dias sem projeto, selo "Conferido", textos de envio
└── components/notifications/…                         # ícone/rótulo do kind novo, se necessário
```

**Structure Decision**: aplicação web existente (`backend/`, `frontend/` e `shared/`). A regra
de negócio nova fica em `backend/src/lib/efetivo/allocation-review/`, separada em uma regra
pura (testável sem banco), um read-model e um serviço transacional. Os pontos de integração
(custo, relatório, notificações e ausências) recebem mudanças pequenas e localizadas.

## Fases de entrega (para /speckit-tasks)

1. **Fundação**: migration, enums, papel novo, access helpers e registry.
2. **US1, a grade só leitura**: `suggestion.js`, `read-model.js`, `GET /semanas/:weekStart` e
   seção no frontend (grade, cards no celular, filtros e URL). Já entrega valor sem nenhuma
   escrita.
3. **US2, correção e conferência**: serviço, rotas de escrita, painel, edição em massa,
   conferir, fechar e reabrir, com versão.
4. **US3, efeitos**: precedência no custo HH, substituição no relatório (tela e PDF) e rótulos
   na auditoria.
5. **US4, envio**: prazo do 3º dia útil, janela e espera, e textos na UI.
6. **US5, avisos**: tabela de avisos, notificação, resolução por ausência e abertura do
   cadastro pela URL.
7. **Acabamento**: novidade e tutorial, badge de pendências e validação completa do quickstart.

## Pós-merge (operador)

A migration precisa ser aplicada no servidor e o backend precisa de rebuild. Os comandos serão
entregues como bloco "rode no servidor" na PR (Princípio I).

## Complexity Tracking

Sem violações da constituição.
