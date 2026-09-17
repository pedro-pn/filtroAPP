# Implementation Plan: Documentação e medição do projeto

## Technical Context

- Frontend React/TypeScript com React Query, React Hook Form e Zod.
- Backend Express/JavaScript com validação Zod e Prisma/PostgreSQL.
- Workflow único em `ProjectWorkflow`, com checklists, controle otimista e sincronização com a missão operacional.
- RDOs e relatórios já são consolidados pelo dashboard de execução.
- Contrato previsto vem do detalhe financeiro do projeto; faturamento vem dos recebíveis Omie.

## Constitution Check

- A mudança permanece no módulo Efetivo e reutiliza os módulos Relatórios, Acompanhamento e Omie.
- Toda entrada é validada no frontend e backend.
- Alterações de schema terão migration e atualização do catálogo de API.
- A implementação terá testes de unidade/integração e validação de build, lint e arquitetura.
- Nenhum servidor, Docker ou deploy será executado.

## Implementation Strategy

1. Promover `FINAL_MEASUREMENT` de coluna legada para etapa gerenciada do workflow.
2. Adicionar as seções `CLOSEOUT_DOCUMENTATION` e `CLOSEOUT_MEASUREMENT` ao catálogo compartilhado.
3. Criar o registro um-para-um `ProjectWorkflowMeasurement` para os dados que não existem em fontes integradas.
4. Implementar o gate Pós-job → Documentação / medição e preservar a missão em Medição final.
5. Criar um painel de fechamento que reutiliza o consolidado de relatórios e o detalhe financeiro do projeto.
6. Expor leitura do painel e escrita da medição com permissão, versão e transação.
7. Integrar coluna, card, formulário, checklists e bloqueios ao Kanban único.
8. Atualizar testes, roadmap e campanha temporária de apresentação.

## Files and Boundaries

- `shared/project-workflow.js`: etapa, seções, itens e schemas compartilhados.
- `backend/prisma/schema.prisma` + migration: persistência da medição.
- `backend/src/lib/efetivo/project-workflow/*`: regra, serviço e painel do fechamento.
- `backend/src/routes/efetivo-project-workflow.js`: endpoint do painel.
- `frontend/src/api/efetivo/projectWorkflow.ts`: contratos e chamadas.
- `frontend/src/components/efetivo/*`: painel e edição no detalhe.
- `frontend/src/pages/EfetivoPage.tsx` e utilitário do workflow: coluna, transições e progresso.

## Risks and Mitigations

- Totais financeiros podem parecer equivalentes: usar rótulos e campos separados, sem derivar medição do faturamento.
- Não existe uma fonte universal para quantidade esperada de documentos: apresentar evidências automáticas e manter confirmação manual.
- `FINAL_MEASUREMENT` já existe para projetos legados: evitar duplicar a coluna e preservar cards sem workflow.
- Projetos antigos não terão o novo registro: serializar valores opcionais e criar somente ao salvar.
