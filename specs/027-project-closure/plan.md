# Implementation Plan: Encerramento do projeto

## Technical Context

A etapa será adicionada ao contrato compartilhado, ao enum Prisma e ao Kanban único. O gate será calculado no backend a partir dos checklists, dados estruturados de pós-job/medição e pendências. A mesma transação que altera a etapa registra autoria/data e sincroniza a missão oficial. Projetos encerrados serão expostos em modo leitura; a única mutação aceita será a reabertura para Documentação / medição com justificativa.

## Constitution Check

- Reutiliza `Project` como mestre e a missão oficial como projeção operacional.
- Mantém validação Zod compartilhada e no servidor.
- Usa migration Prisma versionada, auditoria existente e controle otimista de versão.
- Preserva o Kanban único, responsividade, arraste e programação da equipe na mesma página.
- Não inicia servidor, Docker ou deploy.

## Project Structure

- `shared/schemas/project-workflow.*`: etapa, checklists e contrato da justificativa.
- `backend/prisma`: enum, campos de encerramento, relação de autor e migration.
- `backend/src/lib/efetivo/project-workflow`: gate, permissões e aplicação das transições.
- `backend/src/lib/efetivo/planning`: sincronização da missão encerrada.
- `frontend/src`: tipos, coluna, gate, modo leitura e formulário de reabertura.
- `backend/test` e `frontend/test`: regras e regressões.

## Validation

Prisma format/validate/generate, testes backend/frontend, lint, build, arquitetura e revisão de impacto pelo grafo.
