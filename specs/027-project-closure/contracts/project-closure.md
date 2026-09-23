# Contract: Encerramento do projeto

## PATCH `/api/efetivo/project-workflows/:projectId`

Encerrar:

```json
{ "action": "stage", "version": 12, "stage": "FINISHED" }
```

Reabrir:

```json
{ "action": "stage", "version": 13, "stage": "FINAL_MEASUREMENT", "reason": "Correção solicitada pelo cliente." }
```

`reason` é opcional no contrato geral e obrigatório no servidor somente para `FINISHED → FINAL_MEASUREMENT`, com 3 a 1000 caracteres.

## Resposta do workflow

Inclui `closureReadiness`, `closureGate`, `closedAt`, `closedBy` e permissão `canReopen`.
