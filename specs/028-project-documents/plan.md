# Implementation Plan: Documentos do projeto

**Branch**: `feat/016-gestao-projetos-efetivo` | **Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/028-project-documents/spec.md`

## Summary

Adicionar ao detalhe do projeto um catálogo documental versionado, com arquivo gerenciado ou referência externa, responsável, aceite por versão e exigência opcional por gate. O desenho reutiliza o armazenamento protegido, o módulo de Assinaturas e os RDOs/relatórios atuais. Documentos comerciais já reservam procedência e ordenação do CRM, mas o conector fica fora deste incremento.

## Technical Context

**Language/Version**: JavaScript ESM no backend e TypeScript/React no frontend, conforme as versões atuais do repositório

**Primary Dependencies**: Express, Zod, Prisma, PostgreSQL, React, Vite, TanStack Query, react-hook-form, componentes compartilhados e fluxo de Assinaturas existente

**Storage**: PostgreSQL para metadados e auditoria; armazenamento gerenciado atual para arquivos; referências HTTP(S) para conteúdo mantido pelo CRM

**Testing**: `node --test`/`npm test` em `backend/test`, testes de contrato do frontend em `frontend/test`, lint, build e Prisma validate/generate

**Target Platform**: Aplicação web responsiva e API Node.js no ambiente já suportado

**Project Type**: Aplicação web com backend e frontend no mesmo repositório

**Performance Goals**: listar até 200 registros documentais de um projeto em até 2 s no p95; inclusão de metadados em até 1 s no p95, sem contar o tempo de transferência do arquivo

**Constraints**: arquivos manuais de até 20 MB por padrão; download autenticado; versões imutáveis; nenhuma duplicação de RDO, relatório ou auditoria de assinatura; compatibilidade retroativa com projetos sem requisitos documentais

**Scale/Scope**: um catálogo por projeto, centenas de documentos/versões por obra, quatro histórias de usuário, uma migration aditiva, API e uma categoria no diálogo existente

## Constitution Check

*GATE avaliado antes e depois do desenho: aprovado, sem exceções.*

- Nenhum comando de servidor, Docker ou deploy faz parte da preparação ou da futura implementação automatizada.
- A interface será em pt-BR, dentro do diálogo largo existente, com corpo rolável, rodapé fixo, categorias recolhíveis e listas convertidas em cards no mobile.
- Todos os corpos, parâmetros e formulários novos terão schemas Zod; o frontend usará react-hook-form e o estado visual compartilhado para erros.
- A mudança de banco será uma migration Prisma aditiva e versionada, sem backfill obrigatório ou SQL executado diretamente.
- Versionamento, permissões, prontidão, invalidação do gate, procedência CRM e vínculo de assinatura terão testes de negócio no backend.
- A UI reutilizará `ProjectWorkflowModal`, `ProjectWorkflowCategory`, `Modal`, `Button`, badges, tokens e classes globais. Não se aplica exceção de identidade portada.
- Não haverá reordenação por arraste. O arraste do card do Kanban não será alterado por esta entrega.
- O projeto aberto continuará no parâmetro de URL já usado pelo Kanban. Estado local de categorias não será tratado como navegação compartilhável.
- A implementação incluirá novidade centralizada e tutorial guiado temporários, com expiração global exatamente 10 dias após a data registrada no código.

### Required visual evidence

| Surface | Existing reference audited | Shared component/classes | Field/dropdown states covered | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial plan | Mobile/desktop overflow evidence |
|---------|----------------------------|--------------------------|-------------------------------|---------------------------|------------------------|------------------------|----------------------------------|
| Categoria documental no detalhe | `frontend/src/pages/efetivo/components/ProjectWorkflowModal.tsx` e `ProjectWorkflowCategory.tsx` | Modal atual, `ProjectWorkflowCategory`, Button, badges e tokens | vazio, carregando, erro, leitura, arquivado e bloqueado | N/A | projeto aberto permanece na query atual | acrescentar passos à campanha `ProjectWorkflowNovelty.tsx`, por 10 dias | corpo rolável; cards com `min-width: 0`; nomes longos quebram/truncam |
| Formulário de documento/versão/aceite | formulários internos do `ProjectWorkflowModal.tsx` | react-hook-form, Zod, `field-group`, `field-invalid`, `field-error`, Modal/Button | padrão, foco, disabled, obrigatório vazio, arquivo/tamanho inválido, envio | N/A | N/A, formulário transitório | tutorial aponta inclusão, nova versão e aceite | uma coluna no mobile; ações empilham; sem largura mínima fixa |
| Histórico e documentos operacionais | cards de pendências e relatórios do detalhe atual | cards/listas, badges, Button e links compartilhados | vigente, anterior, pendente, aceito, rejeitado, externo, indisponível | N/A | N/A | coberto pela mesma campanha | desktop pode usar linhas; mobile usa cards sem scroll horizontal da página |

## Project Structure

### Documentation (this feature)

```text
specs/028-project-documents/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── project-documents-api.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
shared/schemas/
└── project-documents.{js,d.ts}

backend/
├── prisma/
│   ├── schema.prisma
│   └── migrations/<timestamp>_project_documents/migration.sql
├── src/
│   ├── app.js
│   ├── lib/
│   │   ├── documents/storage.js
│   │   └── efetivo/project-workflow/
│   │       ├── documents.js
│   │       ├── rules.js
│   │       └── service.js
│   └── routes/efetivo-project-workflow.js
└── test/
    ├── project-documents.test.js
    ├── project-documents-files.test.js
    ├── project-documents-integration.test.js
    └── project-workflow-rules.test.js

frontend/
├── src/
│   ├── api/projectDocuments.ts
│   └── pages/efetivo/
│       ├── ProjectWorkflowNovelty.tsx
│       └── components/
│           ├── ProjectDocumentsCategory.tsx
│           ├── ProjectDocumentForm.tsx
│           └── ProjectWorkflowModal.tsx
└── test/
    ├── project-documents.test.mjs
    └── project-workflow-novelty.test.mjs
```

**Structure Decision**: Manter o limite do módulo existente: contrato compartilhado, regras e rotas sob Gestão de Projetos, armazenamento em `lib/documents`, integração visual no mesmo diálogo da Evolução. O catálogo é novo; Assinaturas, RDOs e relatórios são apenas referenciados.

## Design Phases

### Phase 0 - Decisions and reuse boundaries

Consolidar no [research.md](research.md) a separação entre documento lógico e versão, armazenamento local e referência externa, aceite, gates, CRM, Assinaturas e documentos operacionais.

### Phase 1 - Data and interfaces

Definir entidades e transições no [data-model.md](data-model.md), rotas no [contrato da API](contracts/project-documents-api.md) e cenários executáveis no [quickstart.md](quickstart.md).

### Phase 2 - Implementation increments

1. Fundação: schemas, migration, parser seguro, acesso e auditoria.
2. MVP manual: catálogo, arquivos, versões, aceite e categoria no diálogo.
3. Gates: requisito por etapa, evidência do handover e invalidação de autorização.
4. Reuso: Assinaturas e projeção de RDOs/relatórios.
5. Preparação CRM: upsert idempotente, ordenação de versão e somente leitura.
6. Acabamento: campanha temporária, responsividade e validação completa.

## Rollout and Compatibility

- Migration aditiva; nenhum documento é criado automaticamente e nenhum backfill é exigido.
- Projetos históricos mantêm a regra atual até que um documento seja explicitamente marcado como obrigatório ou vinculado como evidência.
- O modo manual entra primeiro. O adaptador interno de CRM pode ser validado por testes, mas nenhuma rota pública de webhook será ativada nesta entrega.
- Uma cópia local de referência externa só será criada por ação que exija assinatura, retenção ou disponibilidade operacional; a procedência original permanece registrada.
- Mudança relevante para mobilização incrementa a versão do workflow, invalida a autorização e gera evento. O card não muda de coluna automaticamente.

## Complexity Tracking

Nenhuma violação da constitution ou tecnologia adicional foi identificada.
