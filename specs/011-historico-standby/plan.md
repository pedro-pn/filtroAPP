# Implementation Plan: Histórico de standby por projeto

**Branch**: `feat/011-historico-standby` | **Date**: 2026-08-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-historico-standby/spec.md`

## Summary

Adicionar ao dashboard detalhado de projetos individuais um botão junto ao resumo de standby que abre um diálogo acessível com o histórico diário. Os dados serão carregados sob demanda por uma nova consulta autenticada, construída a partir dos relatórios-fonte já usados pelo Acompanhamento, agregados por dia e filtrados para duração positiva. A interface usará React Query, `Modal`, o padrão de botão compacto do dashboard, tabela responsiva que vira registros empilhados no mobile e campanha temporária de novidade. O card externo permanece sem essa ação.

## Technical Context

**Language/Version**: JavaScript ES modules em Node.js 24 no ambiente de desenvolvimento; TypeScript 5.8 e React 19 no frontend

**Primary Dependencies**: Express 5.2, Prisma 7.9, Zod 4.4, React 19.2, @tanstack/react-query 5.101, Axios 1.19, Driver.js 1.7

**Storage**: PostgreSQL existente via Prisma; nenhuma alteração de schema

**Testing**: `node:test` no backend e frontend; TypeScript/Vite build; validação visual responsiva do diálogo

**Target Platform**: Servidor Node.js/Linux e navegadores modernos em desktop e mobile a partir de 320 px

**Project Type**: Aplicação web com backend REST e frontend SPA

**Performance Goals**: Primeiro conteúdo útil do diálogo em até 2 segundos para históricos de até 500 dias com standby; consulta executada apenas ao abrir o histórico

**Constraints**: Dados somente leitura; apenas relatórios-fonte não excluídos; dias sem standby positivo omitidos; motivo longo sem overflow; ações e rodapé acessíveis com corpo rolável

**Scale/Scope**: Um endpoint de leitura, um serviço de agregação, um diálogo no dashboard do projeto, uma campanha de novidade e testes unitários do contrato de agregação

## Constitution Check

*GATE: aprovado antes da pesquisa e revalidado após o design da Fase 1.*

- **Princípio I — PASS**: nenhuma operação de servidor, Docker, deploy ou ambiente externo faz parte da implementação ou validação local.
- **Princípio II — PASS**: toda UI será pt-BR; o diálogo terá cabeçalho/rodapé fixos, corpo rolável, tabela no desktop e linhas empilhadas no mobile, sem scroll horizontal da página.
- **Princípio III — PASS**: o único dado novo de entrada é `projectId`, validado por schema Zod na rota. Não existe formulário mutável no frontend.
- **Princípio IV — PASS**: a feature apenas lê `Project`, `Report` e `ReportCollaborator`; não requer migration nem escrita no banco.
- **Princípio V — PASS**: agregação, filtro, ordenação, deduplicação e fallbacks do histórico terão testes em `backend/test`.
- **Princípio VI — PASS**: serão reutilizados `Modal` e `Button`; CSS novo ficará limitado às classes `acp-standby-*` e usará tokens globais. A campanha de novidade será individual por usuário/navegador e expirará globalmente em 2026-09-04. Não há drag and drop, campos de formulário, dropdown ou identidade portada.
- **Persistência de navegação — PASS/N/A**: o diálogo é uma inspeção transitória que não substitui a lista e não é estado compartilhável; não será persistido em URL.

**Required visual evidence when frontend changes are present:**

| Surface | Existing reference audited | Shared component/classes | Field/dropdown states covered | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial plan | Mobile/desktop overflow evidence |
|---------|----------------------------|--------------------------|-------------------------------|---------------------------|------------------------|------------------------|----------------------------------|
| Ação no dashboard | `frontend/src/components/projects/ProjectDetailDashboard.tsx` | `mini-btn alt` junto ao KPI de standby | N/A, não há campo | N/A | O dashboard selecionado permanece aberto enquanto o diálogo é exibido | Driver.js apresenta aviso central e aponta para o botão real durante 2026-08-25–2026-09-04 | KPI e ação usam coluna flexível; rótulo não amplia o bloco |
| Diálogo do histórico | `frontend/src/components/ui/Modal.tsx` e padrão `acp-manage-*` em `AcompanhamentoDashboard.tsx` | `Modal`, `Button`, `acp-manage-head/body/foot`; classes `acp-standby-*` com tokens | Estados de carregamento, vazio e erro; N/A para formulário/dropdown | N/A | N/A, não substitui lista | Mesmo anúncio temporário; interação única e rotulada não exige onboarding permanente | Desktop em tabela; até 640 px, `thead` oculto e cada `tr` vira card com `data-label`; motivo quebra linha; corpo rola e rodapé fica fixo |

**Post-design gate**: PASS. O contrato é somente leitura, não altera schema, define estados responsivos e reserva testes para toda regra de negócio nova. Não há violações a justificar.

## Project Structure

### Documentation (this feature)

```text
specs/011-historico-standby/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── project-standby-history-api.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── lib/acompanhamento/
│   │   └── standby-history.js
│   └── routes/resources/
│       └── acompanhamento-comercial.js
└── test/
    └── acompanhamento-standby-history.test.js

frontend/
├── src/
│   ├── api/
│   │   └── acompanhamentoComercial.ts
│   ├── auth/
│   │   └── moduleNavigation.ts
│   ├── components/projects/
│   │   ├── ProjectCardsBoard.tsx
│   │   ├── ProjectStandbyHistoryNovelty.tsx
│   │   ├── ProjectStandbyHistoryDialog.tsx
│   │   └── ProjectTrackingNovelties.tsx
│   └── styles/
│       └── base.css
└── test/
    └── route-access.test.mjs
```

**Structure Decision**: Manter a arquitetura web existente. A regra de agregação fica em serviço dedicado do backend, a rota permanece no recurso comercial do Acompanhamento, o contrato tipado fica na API já consumida pelo módulo e o diálogo vira componente próprio. O dashboard detalhado controla sua abertura e o quadro externo continua responsável apenas por selecionar o projeto.

## Complexity Tracking

Nenhuma violação constitucional ou complexidade excepcional identificada.
