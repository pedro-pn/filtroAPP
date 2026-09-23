# Data model: documentação antecipada e planejamento D-30

## Persistência reutilizada

`ProjectWorkflowChecklist` continua armazenando `key`, `status`, `note`, autoria e datas para materiais e logística. As antigas chaves genéricas de equipe e equipamentos foram substituídas na entrega 031.

`ProjectWorkflowTeamDemand` armazena cargo e quantidade necessária. `ProjectWorkflowEquipmentCategoryPlan` armazena as categorias de equipamentos selecionadas. As decisões `teamPlanDefined` e `equipmentPlanDefined` permanecem nulas até uma resposta explícita.

## Catálogo compartilhado

- `key`: identificador estável.
- `stage`: etapa específica ou `null` para conteúdo paralelo.
- `section`: `HANDOVER`, `INITIAL_ANALYSIS`, `ADVANCE_DOCUMENTATION`, `D30_TEAM`, `D30_EQUIPMENT`, `D30_MATERIALS` ou `D30_LOGISTICS`.
- `areaRoles`: papéis autorizados além de gestor, administrador e Líder atual.

## Papéis

O enum `ModuleRoleCode` recebe `EFETIVO_OPERATIONS`, `EFETIVO_ASSETS`, `EFETIVO_SUPPLIES` e `EFETIVO_ADMINISTRATIVE`, mapeados para os códigos públicos correspondentes.

## Projeções calculadas

- `documentationReadiness`: `status`, `completed`, `total`, `blockers`.
- `planningReadiness`: `completed`, `total`, `percentage`, `sections`.
- `milestones`: `daysUntilMobilization`, lista D-90…D-1, `dueMilestones`, `nextMilestone`.

As tabelas estruturadas da entrega 031 complementam a persistência reutilizada desta entrega.
