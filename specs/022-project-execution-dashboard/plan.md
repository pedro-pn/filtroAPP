# Implementation Plan: execução do projeto

**Branch**: `feat/016-gestao-projetos-efetivo` | **Date**: 2026-09-09 | **Spec**: [spec.md](./spec.md)

## Summary

Adicionar `EXECUTION` ao workflow mestre e apresentar, no mesmo modal do projeto, um painel que consolida Acompanhamento, RDOs, relatórios técnicos e desvios da Qualidade. A autorização de mobilização continua válida na execução quando gate e versão permanecem válidos. Metas documentais são auditadas separadamente para não invalidar o gate, e os desvios continuam sendo `QualityRecord`.

## Technical Context

**Language/Version**: Node.js 22, JavaScript ESM, TypeScript e React 19

**Primary Dependencies**: Express 5, Prisma 7.9, Zod, TanStack Query, react-hook-form, driver.js

**Storage**: PostgreSQL via Prisma; uma coluna JSON no `ProjectWorkflow`; desvios existentes em `QualityRecord`

**Testing**: `node --test`, testes estáticos de frontend, ESLint, Vite build e verificação de arquitetura

**Target Platform**: aplicação web responsiva

**Project Type**: frontend React + API Express

**Performance Goals**: uma consulta agregada por projeto aberto; nenhuma consulta adicional por card do Kanban

**Constraints**: reutilizar fontes atuais; manter proteção no servidor; sem servidor, Docker ou deploy; RLR não possui `ReportType`

**Scale/Scope**: uma etapa, um painel detalhado, três mutações e uma migration

## Constitution Check

- Nenhum comando de infraestrutura ou deploy será executado.
- A interface permanece em pt-BR, dentro do modal largo existente, com corpo rolável e rodapé fixo.
- As três entradas novas serão validadas com Zod no backend; os dois formulários usarão react-hook-form e Zod no frontend.
- A mudança de persistência terá migration Prisma versionada.
- Transição, autorização, consolidação e permissões terão testes em `backend/test`.
- O painel usa `Modal`, `Button`, campos globais e tokens do app; não haverá drag and drop.
- A seleção do projeto já persiste na URL. O painel acompanha esse detalhe, sem criar nova navegação.
- A campanha temporária usa novo marcador por usuário e expira em 19/09/2026, dez dias após a implementação.

| Surface | Existing reference audited | Shared component/classes | Field/dropdown states covered | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial plan | Mobile/desktop overflow evidence |
|---|---|---|---|---|---|---|---|
| Painel Em execução | `ProjectWorkflowModal.tsx` e `ProjectDetailDashboard.tsx` | `Modal`, `Button`, `field-group`, rodapé existente | normal, foco global, disabled, inválido e mensagem | N/A | `?projeto=` já existente | campanha v2 até 19/09/2026 | grids viram uma coluna abaixo de 760 px e filhos usam `min-width: 0` |

Gate reavaliado após o desenho: sem violações.

## Project Structure

```text
shared/schemas/project-execution.js
shared/schemas/project-execution.d.ts
backend/prisma/schema.prisma
backend/prisma/migrations/20260910000000_project_execution_dashboard/migration.sql
backend/src/lib/efetivo/project-workflow/execution-dashboard.js
backend/src/routes/efetivo-project-workflow.js
backend/test/project-execution-dashboard.test.js
backend/test/project-workflow-*.test.js
frontend/src/api/projectWorkflow.ts
frontend/src/pages/efetivo/components/ProjectExecutionDashboard.tsx
frontend/src/pages/efetivo/components/ProjectWorkflowModal.tsx
frontend/src/pages/efetivo/components/ProjectWorkflowBoard.tsx
frontend/src/pages/efetivo/efetivo.css
frontend/test/project-workflow.test.mjs
```

**Structure Decision**: manter a regra de workflow no domínio Efetivo, consultar Acompanhamento e Relatórios no backend e reutilizar Qualidade como armazenamento dos desvios.

## Complexity Tracking

Sem violações ou novas dependências.
