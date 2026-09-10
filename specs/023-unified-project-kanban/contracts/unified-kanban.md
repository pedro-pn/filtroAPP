# Contrato: Kanban único de projetos

## Consulta

As respostas de listagem e detalhe do workflow incluem `project.operationalMission`, quando existe missão oficial ativa, com identificador, etapa, situação, datas, responsável e total de participantes.

Projetos sem workflow permanecem na resposta e recebem posição visual derivada da missão:

| Etapa da missão | Coluna exibida |
|---|---|
| STANDBY | Handover comercial |
| MOBILIZATION | Mobilização |
| EXECUTION | Em execução |
| FINAL_MEASUREMENT | Documentação / medição |
| FINISHED | Encerrado |

O detalhe do mesmo card mantém um controle temporário de etapa para projetos legados. Ao iniciar o handover, esse controle desaparece e todas as mudanças passam pelo workflow.

## Mudança de etapa do projeto

`POST /project-workflows/:projectId/actions` com ação `stage` mantém controle otimista pela versão. Ao entrar em Mobilização ou Execução, a missão oficial é validada e sincronizada. Ao retornar dessas etapas para Pronto para mobilizar, a missão retorna a Stand by.

Erros relevantes:

- `PROJECT_WORKFLOW_STAGE_BLOCKED`: checklist, gate ou autorização pendente.
- `MISSION_INCOMPLETE_FOR_KANBAN`: programação oficial ausente ou incompleta.
- `MISSION_STAGE_MANAGED_BY_PROJECT`: tentativa de alterar diretamente a etapa de uma missão controlada pelo Kanban único.
