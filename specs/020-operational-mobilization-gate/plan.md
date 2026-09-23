# Implementation Plan: gate nas saídas operacionais

**Branch**: `feat/016-gestao-projetos-efetivo` | **Date**: 2026-09-09 | **Spec**: [spec.md](./spec.md)

## Summary

Criar um serviço central que classifica projetos sem workflow como legado e exige autorização vigente nos demais. Aplicar a decisão antes de mobilizar missões oficiais, emitir romaneios de saída e registrar uso de estoque em projeto.

## Technical Context

**Language/Version**: Node.js 22, JavaScript ESM, TypeScript/React 19
**Dependencies**: Express 5, Prisma 7.9, Zod, TanStack Query
**Storage**: modelos existentes; nenhuma migration nova
**Testing**: `node --test`, testes estáticos, ESLint, Vite build e arquitetura
**Constraints**: preservar projetos sem workflow; bloquear antes de efeitos colaterais; sem servidor, Docker ou deploy

## Constitution Check

- Fluxo specify → clarify → plan → tasks → implement aplicado; nenhuma ambiguidade crítica exigiu pergunta.
- O backend é a autoridade e usa o gate calculado já coberto por testes.
- A decisão ocorre dentro da transação quando a operação altera estoque ou planejamento.
- Mensagens visíveis permanecem em pt-BR e usam os Toasts existentes.
- A campanha vigente será atualizada, mantendo a expiração em 19/09/2026.
- Nenhum processo de servidor, Docker ou deploy será executado.

## Project Structure

```text
specs/020-operational-mobilization-gate/
backend/src/lib/efetivo/project-workflow/operational-gate.js
backend/src/lib/{efetivo/planning/mission-planning.js,estoque/stock-movements.js}
backend/src/routes/resources/romaneios.js
backend/test/
frontend/src/pages/efetivo/
```

## Complexity Tracking

O modo legado é determinado pela ausência de workflow. Essa escolha permite adoção por projeto e evita um novo estado persistido que poderia divergir da própria inicialização da Gestão de Projetos.
