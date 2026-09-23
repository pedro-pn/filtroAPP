# Data model

## Controle calculado

- `LEGACY_NOT_ENFORCED`: projeto sem `ProjectWorkflow`; operação permitida.
- `AUTHORIZED`: workflow com autorização vigente; operação permitida.
- `BLOCKED`: workflow sem autorização vigente; operação recusada.

## Dados consultados

- Versão e etapa do `ProjectWorkflow`.
- Data e versão da autorização.
- Checklists, fatos comerciais e pendências necessários ao gate.

Nenhum novo campo persistido é necessário.
