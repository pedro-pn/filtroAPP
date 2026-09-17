# Implementation Plan: Prontidão comercial da gestão de projetos

**Branch**: `feat/016-gestao-projetos-efetivo` | **Date**: 2026-09-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/017-project-commercial-readiness/spec.md`

## Summary

Adicionar ao registro mestre `ProjectWorkflow` uma frente de oito fatos comerciais com situação, evidência, procedência e auditoria. A API calcula a liberação comercial, mantém fatos futuros do CRM somente leitura e expõe os motivos que impedem cada transição. A interface apresenta o semáforo no quadro, os fatos no detalhe e as ações explícitas em um rodapé fixo. O novo papel `efetivo:commercial` edita apenas essa frente.

## Technical Context

**Language/Version**: Node.js 22, JavaScript ESM no backend e TypeScript/React no frontend  
**Primary Dependencies**: Express 5, Prisma 7.9, Zod, React 19, Vite, TanStack Query, React Hook Form  
**Storage**: PostgreSQL via Prisma  
**Testing**: `node --test`, testes estáticos do frontend, ESLint e Vite build  
**Target Platform**: navegador responsivo e API Linux  
**Project Type**: aplicação web em monorepo com backend, frontend e contratos compartilhados  
**Performance Goals**: listar até 100 projetos sem consulta adicional por card; recalcular oito fatos em memória por projeto  
**Constraints**: sem endpoint CRM nesta entrega; concorrência otimista pela versão da gestão; compatibilidade com checklists existentes; nenhuma operação de servidor ou deploy pelo agente  
**Scale/Scope**: uma entidade nova, dois enums, um novo papel, extensão do PATCH existente e três superfícies do Efetivo

## Constitution Check

*GATE: aprovado antes da pesquisa e revisado após o desenho.*

- Nenhum comando de servidor, Docker ou deploy faz parte da execução; a validação é local.
- A interface permanece em pt-BR, usa o modal largo já corrigido, grade que empilha no mobile e rodapé que quebra linhas sem gerar rolagem horizontal.
- O contrato compartilhado Zod valida catálogo, aplicabilidade, data civil, referência e justificativa; o backend repete a autorização sobre o dado persistido.
- A alteração do schema tem migration Prisma própria e o modelo reservado entra no catálogo de credenciais da API.
- Regras de prontidão, permissão, gate, compatibilidade do handover e concorrência recebem testes no backend.
- A interface reutiliza `Modal`, `Button`, tokens e estados globais de formulário. Campos obrigatórios usam `field-group`, `field-invalid`, `aria-invalid` e `field-error`.
- Não existe reordenação nesta feature.
- A campanha vigente da Gestão de Projetos, com expiração em 19/09/2026, passa a citar a frente comercial; não é criada uma campanha concorrente.
- O projeto aberto continua persistido em `?projeto=id`; a nova frente não cria navegação interna adicional.

**Required visual evidence when frontend changes are present:**

| Surface | Existing reference audited | Shared component/classes | Field/dropdown states covered | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial plan | Mobile/desktop overflow evidence |
|---------|----------------------------|--------------------------|-------------------------------|---------------------------|------------------------|------------------------|----------------------------------|
| Frente comercial | `frontend/src/pages/efetivo/ProjectWorkflowModal.tsx` | `Modal`, `Button`, `field-group`, `field-invalid`, `field-error` | default, foco, desabilitado CRM, erro e obrigatório vazio | N/A | projeto em `?projeto=id` | ampliar campanha vigente até 19/09/2026 | grade de duas colunas vira uma; textos usam `min-width: 0` e quebra |
| Semáforo do card | `frontend/src/pages/efetivo/ProjectWorkflowBoard.tsx` | card e badges atuais | N/A | N/A | filtros e projeto mantidos na URL | coberto pela campanha vigente | badge e contagem quebram dentro do card |
| Rodapé de avanço | rodapé atual do `ProjectWorkflowModal` | `Button` e footer do modal | disabled com motivos acessíveis | N/A | etapa atualiza dados sem perder `?projeto` | texto do tutorial explica confirmação explícita | ações quebram linha em 390 px e corpo continua rolável |

## Project Structure

### Documentation (this feature)

```text
specs/017-project-commercial-readiness/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/project-commercial-readiness.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── prisma/schema.prisma
├── prisma/migrations/20260909190000_project_commercial_readiness/migration.sql
├── src/lib/efetivo/access.js
├── src/lib/efetivo/project-workflow/{rules,service}.js
├── src/lib/api-credentials/data-catalog.js
└── test/

frontend/
├── src/pages/efetivo/{ProjectWorkflowBoard,ProjectWorkflowModal,ProjectWorkflowNovelty}.tsx
├── src/pages/efetivo/projectWorkflow.css
├── src/services/api.ts
└── test/

shared/
├── modules/registry.json
└── schemas/project-workflow.{js,d.ts}
```

**Structure Decision**: estender a vertical existente da Gestão de Projetos, mantendo contrato compartilhado, regras puras no backend e componentes do módulo no frontend.

## Complexity Tracking

Nenhuma violação constitucional identificada.

