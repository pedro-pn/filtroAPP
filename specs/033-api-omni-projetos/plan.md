# Implementation Plan: API de projetos para o Omni

**Date**: 2026-10-28 | **Spec**: [spec.md](spec.md)

## Summary

Estender as projeções existentes, registrar duas coleções por `resource(...)` e manter a rota genérica com autenticação, cotas e auditoria. Compartilhar a paginação assinada e usar loaders específicos somente para a expansão dos papéis. Reutilizar o cálculo de gates e a agregação de avanço existentes no status.

## Technical Context

Node.js/Express, Prisma/PostgreSQL, Zod compartilhado e node:test. Sem alteração de schema, migration, dependência ou infraestrutura. Metadados do catálogo são consumidos pelo frontend; código executável de projeção permanece no backend.

## Constitution Check

I: sem operação de servidor/deploy. II/VI: descritores pt-BR, sem nova superfície visual. III: validação Zod estrita antes das consultas. IV: acesso via Prisma, sem mudança de banco. V: testes de permissão, recorte, projeção e sincronização. Sem exceções.

## Project Structure

- `backend/src/lib/api-credentials/omni-resources.js`: contratos de responsáveis e coleção de status, com nomes próprios de operação e modelo Prisma Project.
- `project-projection.js`: projeção de projetos e e-mail corporativo.
- `project-responsibles.js`: três consultas limitadas, uma por papel, ordenação por projectId/role e maior carimbo Project/ProjectWorkflow.
- `operational-service.js`: paginação e dispatch para loader específico; stage filtra workflow.
- `operational-serialization.js`: enriquecimento/projeção por operação além do modelo.
- `efetivo-project-status.js`: coleção reutiliza projectEfetivoStatus; endpoint individual mantém allowlist atual.
- `backend/test/integration-omni-projects.test.js`: regressões de contrato, filtros, cursor, cotas e acesso.
- `specs/034-api-omni-fase2/spec.md`: backlog sem implementação.

## Decisions

- SchemaVersion 1.0: envelope e contrato individual preservados.
- Responsáveis ordenados por `(projectId, role)`; consultar no máximo limit+1 projetos por papel. O maior carimbo é filtrado em Prisma com AND/OR; não carregar a coleção toda em memória.
- Status ordenado por id, limitado por createdAt no snapshot; leitura completa porque avanço depende de RDOs, históricos, correções, escopo e avanço manual.
- Status respeita a elegibilidade do Efetivo (sem projetos excluídos, exclusivos do gestor ou centros de sede); active vazio inclui ativos e inativos.
- Reutilizar o leitor do workflow com opção interna para inativos; consultas atuais mantêm o filtro de ativos.
- Datas do status conservam formato date; endDate de projetos segue datetime das coleções atuais.
- CNPJ legado inválido retorna null em vez de inventar dígitos. Apenas domínio exato filtrovali.com.br, sem subdomínios, username ou e-mail do colaborador.
- Dados relacionados não são snapshot transacional. Reconciliação completa detecta remoções e alterações de cadastro de pessoas.

## Validation

Testes novos e suítes de API/OpenAPI/Playground; `npm run architecture:check`, `npm test` no backend e `npm run lint` no frontend. Registrar limitações ou falhas existentes com evidências.
