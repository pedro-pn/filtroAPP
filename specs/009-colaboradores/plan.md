# Implementation Plan: Aba Colaboradores no Acompanhamento

**Branch**: `009-colaboradores` | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-colaboradores/spec.md`

## Summary

Adicionar uma nova seção **Colaboradores** ao módulo Acompanhamento (acesso restrito a gestor) com dois blocos: (1) **indicadores de produtividade** — por colaborador operacional, no ano selecionado: total/acumulado anual de HH produtivas, média mensal (total ÷ meses ativos), Taxa de Improdutividade individual `(161 − média) ÷ 161` (piso 0%), e a Taxa Geral da equipe = média das taxas individuais; (2) **visão de alocação** — onde cada colaborador esteve/está e quem está disponível.

Abordagem técnica: reutilizar a base de ponto já persistida (`PontoPeriodSummary`, com `workedMinutes` = horas normais/produtivas, `he70/he100Minutes` = extras excluídas, e `monthly` por `YYYY-MM`) e o cruzamento ponto × RDO já existente em `labor-cost.js` para a alocação. Nenhum novo importador. Introduzir uma **classificação operacional/administrativo** (inexistente hoje) para delimitar a "equipe operacional". Novo serviço de cálculo no backend com testes, nova rota sob `requireAcompanhamentoManager`, e um novo board no frontend seguindo o padrão de `SedeCostsBoard`, com campanha de novidade temporária (10 dias).

## Technical Context

**Language/Version**: Node.js (Express) no backend; React + Vite + TypeScript no frontend (stack fixa da constitution).

**Primary Dependencies**: Express, Prisma + PostgreSQL, Zod (backend); React, @tanstack/react-query, zustand, react-hook-form + Zod, driver.js (novidade) no frontend.

**Storage**: PostgreSQL via Prisma. Fontes já existentes: `PontoPeriodSummary` (HH produtivas/mensal por colaborador), `Collaborator`, `JobRole`, RDO/relatórios (para alocação). Nova coluna de classificação operacional (migration Prisma).

**Testing**: `backend/test/*.test.js` via `npm test` (padrão do projeto) para a lógica de cálculo de improdutividade e seleção da equipe operacional.

**Target Platform**: Web app (desktop + mobile), servido pela mesma aplicação Acompanhamento.

**Project Type**: Web application (backend Express + frontend React) — Option 2.

**Performance Goals**: Cálculo agregado do ano para toda a equipe deve responder de forma interativa (< ~1,5s p95 em carga típica), reaproveitando dados já sumarizados por período/mensal (sem reprocessar planilhas).

**Constraints**: Sem execução automática de comandos de servidor (Princípio I); UI pt-BR e mobile-first; validação Zod nas duas pontas; mudança de schema só por migration Prisma; componentes/tokens do kit.

**Scale/Scope**: Uma seção nova no módulo, ~1 rota GET agregadora (+ possível endpoint de classificação de cargo), 1 serviço de cálculo com testes, 1 migration, 1 board no frontend + hook react-query + campanha de novidade. Dezenas de colaboradores, ~12 meses por ano.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Operação de servidor é sagrada** — ✅ Nenhum comando de servidor/deploy é executado pelo agente. A migration Prisma e o backfill (se houver) são entregues como comandos para o operador rodar no servidor, em bloco de código com "rode no servidor".
- **II. UI pt-BR e mobile-first** — ✅ Toda a UI em pt-BR. A tabela de indicadores por colaborador vira cards empilhados em telas estreitas; a barra de seções já é resolvida pelo `equip-mobile-nav` (select). Valores de HH/percentuais e badges de alocação truncam/quebram sem scroll horizontal de página.
- **III. Validação Zod nas duas pontas** — ✅ Query params da rota (ano, filtros) validados com Zod no backend; filtros/formulário de classificação no frontend usam react-hook-form + Zod quando houver escrita.
- **IV. Banco só via Prisma** — ✅ A classificação operacional entra por migration Prisma versionada. Qualquer backfill de classificação é idempotente e oferece dry-run.
- **V. Testes de lógica de negócio** — ✅ O cálculo de improdutividade (média mensal, meses ativos, piso 0%, Taxa Geral) e a seleção da equipe operacional ganham testes em `backend/test`.
- **VI. Consistência visual e componentes padrão** — ✅ Novo board segue `SedeCostsBoard`/`ProjectCardsBoard`; usa shell `equip-page`, componentes de `components/ui/` (Skeleton, Toast, SearchBar) e tokens de `variables.css`. Navegação por `?section=colaboradores`; detalhe por `?colaborador=...`. Campanha de novidade temporária (driver.js) no padrão dos `*Novelty.tsx` existentes, com expiração global de 10 dias e marca "visto" em localStorage por usuário/navegador. Sem reordenação por drag and drop (N/A).

**Required visual evidence (frontend changes present):**

| Surface | Existing reference audited | Shared component/classes | Field/dropdown states covered | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial plan | Mobile/desktop overflow evidence |
|---------|----------------------------|--------------------------|-------------------------------|---------------------------|------------------------|------------------------|----------------------------------|
| Seção Colaboradores (nav do módulo) | `AcompanhamentoPage.tsx` (`equip-nav`/`equip-mobile-nav`, `?section=`) | `equip-nav-item`, `equip-mobile-nav`, `equip-page/layout/content` | `select` de ano herda `base.css`; foco/disabled/erro do kit | N/A | `?section=colaboradores`; limpa `colaborador` ao sair da seção | Campanha de novidade de função nova (10 dias) | Barra de seções cabe no módulo (via `equip-mobile-nav`); conteúdo sem overflow horizontal |
| Board de indicadores + Taxa Geral | `SedeCostsBoard.tsx`, `ProjectCardsBoard.tsx` | Cabeçalho + cards/tabela do módulo; `Skeleton`, `Toast`, `SearchBar` | Filtro de ano/colaborador; estados vazio/carregando/erro | N/A | Detalhe de colaborador em `?colaborador=...` | Coberto pela campanha acima | Tabela → cards em mobile; HH/percentuais e badge "disponível/alocado" truncam sem estourar |
| Classificação operacional do cargo | `JobRoleManager.tsx` | Form inline do kit (`field-group`/`admin-inline-form`) | Campo obrigatório vazio → `.field-invalid` + `.field-error` + `aria-invalid` | N/A | N/A (config, não navegação) | N/A (config de gestão) | Form inline responsivo sem overflow |

- A auditoria dos componentes-fonte (`SedeCostsBoard`, `JobRoleManager`, componentes `*Novelty`) será registrada na Phase 1; se algum tiver dívida visual, o plano inclui tarefa para corrigir a fonte antes de clonar.

## Project Structure

### Documentation (this feature)

```text
specs/009-colaboradores/
├── plan.md              # Este arquivo (/speckit-plan)
├── research.md          # Phase 0 (/speckit-plan)
├── data-model.md        # Phase 1 (/speckit-plan)
├── quickstart.md        # Phase 1 (/speckit-plan)
├── contracts/           # Phase 1 (/speckit-plan)
│   └── colaboradores-api.md
└── tasks.md             # Phase 2 (/speckit-tasks — NÃO criado aqui)
```

### Source Code (repository root)

```text
backend/
├── prisma/
│   ├── schema.prisma                        # + classificação operacional (JobRole.isOperational OU Collaborator)
│   └── migrations/                          # nova migration Prisma
├── src/
│   ├── lib/acompanhamento/
│   │   ├── ponto-parser.js                  # (existente) horas normais vs extras
│   │   ├── labor-cost.js                    # (existente) cruzamento ponto × RDO p/ alocação
│   │   └── collaborator-productivity.js     # NOVO: cálculo de improdutividade + alocação agregada
│   └── routes/
│       ├── resources/acompanhamento-colaboradores.js  # NOVO: GET indicadores/alocação (requireAcompanhamentoManager)
│       └── index.js                         # registra a nova rota
└── test/
    └── acompanhamento-colaboradores.test.js # NOVO: testes do cálculo e da seleção operacional

frontend/
└── src/
    ├── pages/acompanhamento/AcompanhamentoPage.tsx   # + seção 'colaboradores' no nav e no switch
    ├── components/projects/
    │   ├── CollaboratorsBoard.tsx                    # NOVO: board de indicadores + alocação
    │   ├── CollaboratorsNovelty.tsx                  # NOVO: campanha de novidade (10 dias)
    │   └── JobRoleManager.tsx                        # + toggle operacional/administrativo (se por cargo)
    ├── hooks/                                        # NOVO hook react-query + queryKeys
    └── (api client do módulo Acompanhamento)         # + endpoint colaboradores
```

**Structure Decision**: Web application (Option 2). Reutiliza a estrutura existente do módulo Acompanhamento no backend (`src/lib/acompanhamento/`, `src/routes/resources/`) e no frontend (`pages/acompanhamento/`, `components/projects/`). A lógica de negócio nova concentra-se em `collaborator-productivity.js` (testável isoladamente), com a rota apenas orquestrando e validando entrada.

## Complexity Tracking

> Nenhuma violação da constitution a justificar — a feature reutiliza infra existente e respeita todos os princípios. Seção intencionalmente vazia.
