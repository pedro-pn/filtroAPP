# Implementation Plan: Gestão de projetos no Efetivo

**Branch**: `feat/016-gestao-projetos-efetivo` | **Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

## Summary

Registrar o estudo aprovado e implementar uma primeira entrega vertical: handover, aceite do líder, análise e encaminhamento de riscos até o planejamento. Gestão pertence ao Project; não depende da criação de EfetivoMissionPlan nem é copiada para cenários. O fluxo completo de onze etapas está em [roadmap.md](roadmap.md).

## Technical Context

- Node.js/Express 5, JavaScript ESM, Zod 4, Prisma 7 e PostgreSQL.
- React 19/TypeScript/Vite, React Query, react-hook-form e zodResolver; nenhuma dependência nova.
- Testes node:test para regras/rotas, build/lint frontend, verificação visual Playwright com dados fictícios.
- Lista paginada de 100 projetos, busca por código/nome/cliente; detalhe consultado ao abrir.
- Migração aditiva, sem backfill, sem comandos em produção/staging, sem copiar segredos para a worktree.

## Constitution Check

Pré e pós-design: princípios I–VI atendidos. Sem comandos de servidor ou Docker; migração versionada; validação nas duas pontas; testes de negócio; UI pt-BR baseada no kit e tokens. Sem exceção de identidade portada. Nova visão sem drag and drop (mudança de etapa por ação explícita com gate).

| Surface | Existing reference audited | Shared component/classes | Field/dropdown states covered | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial plan | Mobile/desktop overflow evidence |
|---|---|---|---|---|---|---|---|
| Quadro inicial | EfetivoPage, MissionsBoard | SearchBar, Button, page-card, variables.css | select global com label e foco | Sem reordenação | visao/projeto/busca/pagina na URL | Driver.js coordenado, 10 dias | Validar 390/1440px, colunas internas e select mobile |
| Formulários e detalhe | Modal.tsx, MissionCompletionModal | Modal em portal, efetivo-modal-layout/body/footer, Button | RHF/Zod, field-invalid/field-error, aria-invalid, disabled | Não aplicável | projeto na URL | Guia aponta visão e quadro | Corpo rolável e rodapé fixo |

## Project Structure

- `shared/schemas/project-workflow.js`: catálogo das quatro etapas iniciais, checklists e perguntas; fábrica Zod consumida nos dois lados.
- `backend/prisma/schema.prisma` e migration: ProjectWorkflow, ProjectWorkflowChecklist, ProjectWorkflowCriticalAnswer, ProjectWorkflowIssue, ProjectWorkflowEvent.
- `backend/src/lib/efetivo/project-workflow/`: regras puras e serviços transacionais.
- `backend/src/routes/efetivo-project-workflow.js`: router sob `/efetivo/project-workflow` após autenticação existente.
- `frontend/src/api/projectWorkflow.ts`: API e tipos.
- `frontend/src/pages/efetivo/components/ProjectWorkflow*.tsx`: quadro, detalhe e formulários; CSS escopado.
- `frontend/src/pages/efetivo/EfetivoPage.tsx`, `utils/planningNavigation.ts`: visão adicional em Evolução, programação existente preservada.
- `backend/test/project-workflow*.test.js`, `frontend/test/project-workflow*.test.mjs`: verificação das regras e contratos.

## Implementation Strategy

Sequencial: contratos/testes → modelo/migração → serviços/rotas → quadro/detalhe → novidade e validação. Primeiro incremento termina em Planejamento da mobilização, oferecendo link para programação atual. Não modificar estágios nem gates operacionais antigos nesta entrega. Futuras integrações devem substituir essa coexistência por visão consolidada somente após validação de compatibilidade.

## Complexity Tracking

Sem violações previstas. Entidades separadas são necessárias para preservar gestão oficial ao aplicar simulações. A migração não inicializa automaticamente estados de projetos antigos.
