# Data model: documentação antecipada e planejamento D-30

## Persistência reutilizada

`ProjectWorkflowChecklist` continua armazenando `key`, `status`, `note`, autoria e datas. As novas chaves são compatíveis com a restrição única por gestão.

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

Nenhuma nova tabela é necessária.
