# Implementation Plan: preparação D-15 e gate de mobilização

**Branch**: `feat/016-gestao-projetos-efetivo` | **Date**: 2026-09-09 | **Spec**: [spec.md](./spec.md)

## Summary

Adicionar duas etapas ao fluxo, checklists D-15 com autorização por área, uma projeção de gate em nove frentes e uma autorização vinculada à versão do projeto. A interface apresenta o preparo, o gate e riscos D-7/D-1; a API continua sendo a única autoridade para avançar ou revalidar.

## Technical Context

**Language/Version**: Node.js 22, JavaScript ESM, TypeScript/React 19
**Dependencies**: Express 5, Prisma 7.9, Zod, TanStack Query, React Hook Form
**Storage**: PostgreSQL; enum de etapa, papel QSMS e dois campos no `ProjectWorkflow`
**Testing**: `node --test`, testes estáticos, ESLint, Vite build e arquitetura
**Constraints**: concorrência otimista; sem ativar bloqueios em Romaneio/missões; sem servidor, Docker ou deploy
**Scope**: contrato compartilhado, migration, regras, serviço, quadro, modal e administração

## Constitution Check

- A mudança segue specify → plan → tasks → implement.
- Zod valida a nova ação e o backend recalcula o gate com dados persistidos.
- Prisma recebe migration versionada.
- Regras de transição, autorização, suspensão, papéis e datas ganham testes.
- A UI permanece pt-BR, usa modal e botões compartilhados, rodapé fixo e alternativa mobile para o gate.
- O projeto aberto permanece em `?projeto=id` e a campanha vigente mantém expiração em 19/09/2026.
- Nenhum processo de servidor, Docker ou deploy será executado.

## Project Structure

```text
specs/019-project-mobilization-gate/
backend/{prisma,src/lib/efetivo/project-workflow,test}/
frontend/{src/api,src/pages/efetivo,test}/
shared/{modules,schemas}/
```

## Complexity Tracking

O gate expõe um contrato confiável, mas não bloqueia ainda rotas externas. Isso segue a sequência de adoção aprovada e evita interromper projetos históricos antes da classificação e da política de exceção.
