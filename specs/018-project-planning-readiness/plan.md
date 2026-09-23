# Implementation Plan: documentação antecipada e planejamento D-30

**Branch**: `feat/016-gestao-projetos-efetivo` | **Date**: 2026-09-09 | **Spec**: [spec.md](./spec.md)

## Summary

Estender o catálogo de checklists da gestão com seções paralelas de documentação antecipada e quatro frentes de planejamento D-30. O backend calcula permissões por item, prontidão e marcos relativos; a interface agrupa o conteúdo correto por etapa e apresenta semáforos e progresso no quadro e no detalhe.

## Technical Context

**Language/Version**: Node.js 22, JavaScript ESM no backend e TypeScript/React no frontend  
**Primary Dependencies**: Express 5, Prisma 7.9, Zod, React 19, Vite, TanStack Query  
**Storage**: PostgreSQL via Prisma; novos papéis exigem migration do enum  
**Testing**: `node --test`, testes estáticos do frontend, ESLint e Vite build  
**Target Platform**: navegador responsivo e API Linux  
**Performance Goals**: cálculos lineares sobre um catálogo pequeno, sem consulta adicional por card  
**Constraints**: sem job, servidor, Docker, deploy ou integração externa; compatibilidade com checklists persistidos  
**Scale/Scope**: catálogo compartilhado, quatro papéis, regras puras, serviço e duas superfícies do Efetivo

## Constitution Check

- A especificação e as tarefas antecedem a implementação.
- Entradas continuam validadas pelo schema Zod compartilhado e autorizadas novamente no backend.
- A migration Prisma versiona os novos valores de papel; não há SQL aplicado diretamente.
- Regras de data, prontidão e permissão ganham testes de backend.
- O modal usa componentes e tokens existentes, rodapé fixo e grades mobile-first.
- O projeto aberto permanece em `?projeto=id`.
- A campanha vigente é atualizada e mantém expiração em 19/09/2026, sem campanha concorrente.
- Nenhum comando de servidor, Docker ou deploy será executado.

## Project Structure

```text
specs/018-project-planning-readiness/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/project-planning-readiness.md
├── checklists/requirements.md
└── tasks.md

backend/{prisma,src/lib/efetivo,test}/
frontend/{src/pages/efetivo,src/api,test}/
shared/{modules,schemas}/
```

**Structure Decision**: estender a vertical existente sem criar entidade de alerta; checklist e histórico existentes permanecem como fonte persistida.

## Complexity Tracking

Nenhuma violação constitucional identificada.
