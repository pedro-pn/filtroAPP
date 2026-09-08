# Implementation Plan: Recebimento de projetos por webhook

**Branch**: `feat/project-intake-webhook` | **Date**: 2026-08-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-project-intake-webhook/spec.md`

## Summary

Adicionar um endpoint sistema-a-sistema autenticado por Bearer token exclusivo para
receber os dados de um projeto, incluindo `proposalCode` e a revisão comercial. O backend normaliza e valida o payload, cria o
`Project` com `registrationPending=true` e defaults seguros, e usa `code` como chave de
idempotência, inclusive em corridas concorrentes. Quando proposta e revisão existirem na
base comercial, a mesma regra da seleção manual materializa essa revisão no orçamento;
reenvios não substituem escolhas já existentes. O estado pendente já existente será
reaproveitado sem migração: ele impede provisionamento de contas, será reforçado nos
endpoints que criam relatórios e alimenta o contador/bloco prioritário do gestor. A UI
terá texto genérico de criação automática, cartão integralmente destacado, revisão
acessível dos seis campos e campanha de novidade de 10 dias.

## Technical Context

**Language/Version**: JavaScript ES modules no backend (Node.js 22); TypeScript/TSX no frontend

**Primary Dependencies**: Express 5, Zod 4, Prisma Client 7, React 18, TanStack Query, react-hook-form, Driver.js

**Storage**: PostgreSQL 16 via Prisma; sem alteração de schema, reutilizando `CommercialProposal`, `ProjectBudget` e `Project.commercialProposalCode`

**Testing**: `node:test`, testes HTTP por `app.handle`, Vite SSR para helpers frontend, ESLint, TypeScript e build Vite

**Target Platform**: aplicação web responsiva; backend Linux/containerizado

**Project Type**: aplicação web com frontend e API backend no mesmo repositório

**Performance Goals**: responder ao recebimento individual normalmente em menos de 1 segundo; refletir pendências em até 5 segundos após atualização do painel

**Constraints**: uma entidade por requisição, corpo JSON até 1 MB, autenticação sem sessão humana, idempotência concorrente, nenhum segredo no log/resposta, projeto indisponível até revisão, seleção automática sem sobrescrever escolha manual, `proposalCode` obrigatório e `contractCode` rejeitado no webhook

**Scale/Scope**: um endpoint novo, uma credencial por ambiente, baixo volume esperado, sete campos, integração focada com propostas principais já importadas e ajustes na aba Projetos e nos fluxos de criação de relatórios

## Constitution Check

*GATE: aprovado antes da pesquisa e revisto depois do design.*

- Nenhum comando de servidor, implantação, Docker ou banco será executado; a configuração
  do ambiente fica documentada para o operador.
- Toda a UI nova é pt-BR, responsiva e usa classes/tokens existentes ou tokens globais
  de alerta; a grade de revisão passa a uma coluna em telas estreitas.
- O payload usa Zod no backend e os seis campos da confirmação usam Zod no frontend,
  com estados de erro visíveis e acessíveis.
- Não há alteração de schema. Os modelos de pendência, proposta comercial e orçamento
  existentes são suficientes.
- Idempotência, concorrência e bloqueio operacional terão testes em `backend/test`.
- Não há drag and drop.
- A novidade terá card centralizado e passo Driver.js, marcador por usuário/navegador e
  expiração global em 2026-08-23, exatamente 10 dias após a implementação.
- A aba Projetos já é representada por `?tab=projetos`; a abertura inline não é uma
  visão compartilhável e permanece local.

**Required visual evidence when frontend changes are present:**

| Surface | Existing reference audited | Shared component/classes | Field/dropdown states covered | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial plan | Mobile/desktop overflow evidence |
|---------|----------------------------|--------------------------|-------------------------------|---------------------------|------------------------|------------------------|----------------------------------|
| Aba Projetos do gestor | `GestorPage.tsx`, `ProjectTabPendingBadges.tsx`, padrões `RdoDdsNovelty` e `moduleNavigation.ts` | `nav-tab-count`, `project-registration-*`, `card admin-card`, `field-group`, botões existentes | Seis campos obrigatórios com schema Zod, mensagem `.field-error`, `field-invalid`, `aria-invalid` e `aria-describedby`; código somente leitura durante a revisão | N/A: não há ordenação | `?tab=projetos` já é persistido; abrir revisão permanece estado local por não ser uma visão compartilhável | Card centralizado e passo Driver.js, por usuário/browser, ativo de 2026-08-13 a 2026-08-23 | seção/cartões a 100%, grid de revisão em uma coluna até 640 px, `min-width: 0`, quebra de texto e ações; conferir 360/430/768 px e desktop |

O componente-fonte foi auditado. O plano corrige, na área tocada, o texto incorreto de
Romaneio, as cores hardcoded de alerta, a ausência de `.field-error`, o destaque parcial
do cartão e a regra móvel contraditória do grid.

## Project Structure

### Documentation (this feature)

```text
specs/009-project-intake-webhook/
├── contracts/project-intake-webhook.openapi.yaml
├── data-model.md
├── plan.md
├── quickstart.md
├── research.md
├── spec.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── src/config/env.js
├── src/lib/acompanhamento/access-import.js
├── src/lib/projects/project-intake.js
├── src/routes/index.js
├── src/routes/resources/project-intake-webhook.js
├── src/routes/resources/reports.js
├── .env.example
└── test/project-intake-webhook.test.js

frontend/
├── src/auth/moduleNavigation.ts
├── src/pages/gestor/GestorPage.tsx
├── src/pages/gestor/ProjectIntakeWebhookNovelty.tsx
├── src/pages/gestor/projectPendingReview.ts
├── src/styles/base.css
├── src/styles/variables.css
└── test/project-pending-review.test.mjs
```

**Structure Decision**: manter a arquitetura web existente. A rota HTTP fica isolada
dos endpoints humanos; a regra idempotente fica em biblioteca testável; o painel do
gestor reaproveita o estado e componentes já existentes. Nenhum novo serviço, pacote ou
tabela é necessário.

## Complexity Tracking

Nenhuma violação identificada. O desenho passa novamente pelo gate após a Fase 1:
validação dupla, testes backend, tokens visuais, estados acessíveis, responsividade,
navegação persistida e campanha temporária estão explicitamente planejados.
