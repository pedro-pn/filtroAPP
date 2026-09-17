# Data Model: Encerramento do projeto

## ProjectWorkflow

- `stage`: inclui `FINISHED`.
- `closedAt: DateTime?`: instante do último encerramento vigente.
- `closedByUserId: String?`: usuário que realizou o último encerramento vigente.
- `closedBy: User?`: relação de consulta do autor.

Ao reabrir, `closedAt` e `closedByUserId` voltam a nulo. O evento `WORKFLOW_STAGE` preserva `stage: FINAL_MEASUREMENT` e `reason`.

## Checklist final

Seção `FINAL_CLOSEOUT`, com dez chaves estáveis. Os registros continuam usando `ProjectWorkflowChecklist`, incluindo situação, observação, autor e data.
