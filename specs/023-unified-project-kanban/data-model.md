# Modelo de dados: Kanban único de projetos

## ProjectWorkflow

- `projectId`: vínculo único com o projeto mestre.
- `stage`: etapa canônica da gestão.
- Nova etapa `MOBILIZATION`, entre `READY_TO_MOBILIZE` e `EXECUTION`.
- `mobilizationAuthorizedAt` e `mobilizationAuthorizationVersion`: autorização válida nas três etapas operacionais protegidas.

## EfetivoMissionPlan

- Mantém `scheduleStatus`, responsável de campo, demandas, alocações, ciclos e datas.
- `stage` funciona como projeção operacional para projetos gerenciados.
- Projetos legados continuam usando a etapa da missão até iniciarem o workflow.

## Relações e invariantes

1. Um projeto possui no máximo um `ProjectWorkflow`.
2. A programação oficial ativa possui no máximo uma missão do projeto.
3. Mobilização e Execução exigem missão oficial confirmada e completa.
4. A etapa da missão e a etapa operacional do workflow mudam na mesma transação.
5. Uma missão gerenciada não pode mudar de etapa diretamente pela API operacional.
