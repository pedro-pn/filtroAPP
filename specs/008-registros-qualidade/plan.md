# Implementation Plan: Módulo de Registros de Qualidade

**Branch**: `008-registros-qualidade` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-registros-qualidade/spec.md`

## Summary

Novo módulo **Qualidade** para registrar melhorias, desvios, lições aprendidas, incidentes e
reclamações de cliente (formulário FR-3-4-11-01). Backend Express + Prisma com rota fina em
`routes/resources/qualidade.js` e lógica em `lib/qualidade/`; frontend React espelhando o padrão do
Estoque (página com abas Registros/Naturezas, tabela→cards, modais de formulário). O Nº Registro é
gerado atomicamente por (Tipo, Ano) via tabela de sequência. Ocorrências 12m/Recorrente? são
**derivados em tempo de leitura** (não persistidos), por Natureza e janela de 12 meses sobre a Data
do Evento. Integração: a seção **Desvios** (somente leitura) no detalhe do projeto do Acompanhamento
(`ProjectDetailDashboard.tsx`) lista os Desvios vinculados àquele projeto. A aba Registros também
oferece **exportação para `.xlsx`** (backend monta OOXML com `adm-zip`, sem lib nova) no layout da
referência FR-3-4-11-01.

## Technical Context

**Language/Version**: Node.js (ESM) no backend; TypeScript + React (Vite) no frontend — conforme o
repo atual.

**Primary Dependencies**: Express, Prisma (`@prisma/client` v7), Zod (v4), react-hook-form +
`@hookform/resolvers`, `@tanstack/react-query`. Schemas Zod compartilhados em `shared/schemas/`.

**Storage**: PostgreSQL via Prisma. Novos modelos: `QualityRecord`, `QualityNature`,
`QualityRecordSeq`. Novos enums: `QualityRecordType`, `QualityImpact`, `QualityDisposition`,
`QualityStatus`. Extensão dos enums `AppModule` (+`QUALIDADE`) e `ModuleRoleCode`
(+`QUALIDADE_MANAGER`, +`QUALIDADE_VIEWER`).

**Testing**: `backend/test/qualidade.test.js` (padrão `*.test.js`, `npm test`) para geração do Nº,
concorrência, cálculo de recorrência, bloqueio de exclusão de Natureza em uso e montagem do `.xlsx`
de exportação (cabeçalho/ordem de colunas e nº de linhas por filtro).

**Target Platform**: Web app (desktop + mobile-first), servidor Linux.

**Project Type**: Web application (backend + frontend + shared schemas).

**Performance Goals**: Interações CRUD < 200ms p95 em cargas típicas do módulo; a listagem calcula
recorrência sem N+1 (contagem agregada por Natureza).

**Constraints**: Não executar comandos de servidor/migração; migração Prisma versionada, aplicada
manualmente pelo operador. UI pt-BR, mobile-first. Geração do sequencial atômica.

**Scale/Scope**: Ordem de milhares de registros; 2 abas; 1 modal de registro (17 campos), 1
CRUD de Natureza; 1 ponto de integração no Acompanhamento; 1 novo módulo no Hub.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Operação de servidor é sagrada**: ✅ Migração Prisma e comandos de deploy/seed serão entregues
  como blocos "rode no servidor"; o agente não executa. Ver quickstart.
- **UI pt-BR e mobile-first**: ✅ Tabela de registros vira cards em telas estreitas; abas usam
  `select` mobile (padrão Acompanhamento); modais com rodapé fixo e corpo rolável; seção Desvios no
  card empilha em mobile. Sem scroll horizontal de página.
- **Validação Zod nas duas pontas**: ✅ `shared/schemas/qualidade.js` (`makeQualidadeSchemas(z)`)
  usado no backend (rota) e no frontend (react-hook-form + resolver Zod), espelhando o padrão de
  `shared/schemas/estoque.js`.
- **Banco só via Prisma**: ✅ Uma migration Prisma para modelos+enums; sem SQL manual (índices de
  performance, se necessários, documentados em `deploy/` para aplicação manual).
- **Testes para lógica de negócio**: ✅ `backend/test/qualidade.test.js` cobre numeração,
  concorrência, recorrência, disposição obrigatória e proteção de Natureza em uso.
- **Consistência visual / componentes padrão**: ✅ Reuso de `Modal`, `Button`, `ConfirmDialog`,
  `SearchBar`, `Skeleton`, `Toast` de `components/ui/`, tokens de `variables.css`, shell largo
  `.equip-page`, `select` estilizado do kit. Padrão copiado do Estoque (auditado nesta análise).
- **Novidade/tutorial**: ✅ Módulo novo → onboarding permanente de primeiro acesso do módulo; a
  seção Desvios no card do projeto (função nova em módulo existente) recebe aviso de novidade de 10
  dias no padrão `driver.js`/DDS.
- **Navegação persistente**: ✅ Aba ativa e filtros em query params (`?tab=registros|naturezas`),
  limpando params incompatíveis ao trocar de aba, como no Estoque/Acompanhamento.

**Required visual evidence (frontend changes present):**

| Surface | Existing reference audited | Shared component/classes | Field/dropdown states covered | Navigation persistence | Novelty/tutorial plan | Mobile/desktop overflow evidence |
|---------|----------------------------|--------------------------|-------------------------------|------------------------|------------------------|----------------------------------|
| Página do módulo + abas | `pages/estoque/EstoquePage.tsx`, `pages/acompanhamento/AcompanhamentoPage.tsx` | `.equip-page`, `.equip-nav-item`, `select` mobile | default/focus/disabled | aba em `?tab=` | onboarding permanente do módulo | abas cabem no módulo; `select` em mobile; sem scroll horizontal |
| Tabela de Registros (+botão Exportar) | `pages/estoque/StockItemsTab.tsx`, `StockMovementsTab.tsx` | tabela padrão, `SearchBar`, `Skeleton`, `ConfirmDialog`, `Button` | default/empty/loading | filtros/página em query param | coberto pelo onboarding | tabela→cards; barra de ações (Registrar/Exportar) quebra sem estourar; valores longos truncam/quebram |
| Modal de Registro | `pages/estoque/StockItemFormModal.tsx`, `StockMovementFormModal.tsx` | `Modal`, `Button`, `field-group`, `select` do kit | default/focus/disabled/error | N/A (modal) | N/A | rodapé fixo, corpo rolável, grid `min-width:0` |
| Aba/Modal Natureza | `pages/estoque/StockCategoriesTab.tsx`, `StockCategoryFormModal.tsx` | mesmos do kit | default/focus/error/empty | aba em `?tab=` | coberto pelo onboarding | tabela→cards |
| Seção Desvios (card projeto) | `components/projects/ProjectDetailDashboard.tsx` | cards/badges já usados no detalhe | default/empty | herda do Acompanhamento | aviso novidade 10 dias (DDS) | lista empilha em mobile; Nº/badges truncam |

- **Reuso auditado**: o padrão do Estoque (página, abas, modais, schema compartilhado) foi
  inspecionado e está aderente à constituição vigente; será a base clonada. `ProjectDetailDashboard`
  já segue os cards do detalhe do projeto — a nova seção reusa esses estilos, sem componente novo.
- **Controles inline**: formulários usam estrutura compartilhada (`field-group`/grid admin), rótulos
  reais (não placeholder).

**Resultado do gate**: PASS — sem violações; a tabela de Complexity Tracking permanece vazia.

## Project Structure

### Documentation (this feature)

```text
specs/008-registros-qualidade/
├── plan.md              # Este arquivo
├── research.md          # Fase 0
├── data-model.md        # Fase 1
├── quickstart.md        # Fase 1
├── contracts/           # Fase 1 (contrato da API)
│   └── qualidade-api.md
└── tasks.md             # Fase 2 (/speckit-tasks — NÃO criado aqui)
```

### Source Code (repository root)

```text
backend/
├── prisma/
│   ├── schema.prisma                     # +enums, +QualityRecord/QualityNature/QualityRecordSeq
│   └── migrations/<ts>_qualidade/        # migration versionada
├── src/
│   ├── routes/resources/qualidade.js     # rota fina (auth + permissão + validação → serviços)
│   ├── routes/index.js                   # monta router.use('/qualidade', qualidadeRouter)
│   ├── middleware/auth.js                # +requireQualidadeAccess/+requireQualidadeManager
│   └── lib/qualidade/
│       ├── service.js                    # CRUD registros/naturezas + regras
│       ├── numbering.js                  # geração atômica do Nº por (tipo, ano)
│       ├── recurrence.js                 # cálculo Ocorrências 12m / Recorrente?
│       └── export-xlsx.js                # monta .xlsx (OOXML via adm-zip) no layout FR-3-4-11-01
└── test/qualidade.test.js                # testes de lógica de negócio

shared/
└── schemas/qualidade.js                  # makeQualidadeSchemas(z) — usado nas duas pontas

frontend/
└── src/
    ├── pages/qualidade/
    │   ├── QualidadePage.tsx             # shell + abas (Registros/Naturezas)
    │   ├── QualityRecordsTab.tsx         # tabela + ações
    │   ├── QualityRecordFormModal.tsx    # criar/editar registro
    │   ├── QualityNaturesTab.tsx         # CRUD Natureza
    │   └── QualityNatureFormModal.tsx
    ├── pages/hubModules.ts               # +módulo Qualidade no Hub
    └── components/projects/
        └── ProjectDetailDashboard.tsx    # +seção Desvios (somente leitura)
```

**Structure Decision**: Web application (Opção 2). Segue o `docs/PADRAO_MODULO.md`: rota fina em
`routes/resources/`, domínio em `lib/qualidade/`, teste em `backend/test/`, schema compartilhado em
`shared/schemas/`, frontend em `pages/qualidade/` espelhando `pages/estoque/`. A integração com o
Acompanhamento é aditiva em `ProjectDetailDashboard.tsx`, sem tocar na lógica de custo/missões.

## Complexity Tracking

> Sem violações da constituição. Nenhuma entrada necessária.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
