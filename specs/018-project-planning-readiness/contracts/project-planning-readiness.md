# Contract: projeções de planejamento

## Checklist retornado

Cada item normalizado acrescenta `section`, `areaRoles` e `canEdit`, preservando `key`, `stage`, `label`, `status`, `note` e autoria.

## Readiness

```json
{
  "documentationReadiness": { "status": "IN_PROGRESS", "completed": 3, "total": 10, "blockers": [] },
  "planningReadiness": {
    "completed": 5,
    "total": 25,
    "percentage": 20,
    "sections": [{ "key": "D30_TEAM", "completed": 2, "total": 6 }]
  }
}
```

## Milestones

```json
{
  "daysUntilMobilization": 20,
  "items": [{ "key": "D90", "date": "2026-06-21", "due": true }],
  "dueMilestones": ["D90", "D30"],
  "nextMilestone": { "key": "D15", "date": "2026-09-14" }
}
```

Sem data de mobilização, datas e próximo marco são `null` e as listas ficam vazias.

## PATCH existente

`{ action: "checklist", key, status, note?, version }` mantém o formato. A autorização passa a considerar `section` e `areaRoles` do catálogo; tentativas fora da responsabilidade retornam `403`.
