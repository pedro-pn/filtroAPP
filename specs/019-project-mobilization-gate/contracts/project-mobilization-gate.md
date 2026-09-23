# Contract: preparação e autorização

## PATCH

```json
{ "action": "authorize_mobilization", "version": 42 }
```

A ação exige etapa `READY_TO_MOBILIZE`, gate verde e Líder/gestor. Conflitos mantêm o contrato de versão existente.

## Projeções

```json
{
  "preparationReadiness": { "completed": 21, "total": 39, "percentage": 54, "sections": [] },
  "mobilizationGate": {
    "ready": false,
    "fronts": [{ "key": "COMMERCIAL", "label": "Comercial", "status": "BLOCKED", "blockers": [] }],
    "blockers": [],
    "deadlineStatus": "ATTENTION"
  },
  "mobilizationAuthorization": {
    "status": "SUSPENDED",
    "authorized": false,
    "authorizedAt": "2026-09-09T18:00:00.000Z",
    "authorizedVersion": 42,
    "currentVersion": 43
  }
}
```

## Transições

- `MOBILIZATION_PLANNING → PREPARATION`: D-30 completo.
- `PREPARATION → READY_TO_MOBILIZE`: gate verde e emissão automática.
- `READY_TO_MOBILIZE → PREPARATION`: retorno permitido e autorização vigente limpa.
