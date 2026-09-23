# Data Model: disponibilidade no romaneio

Nenhuma entidade persistida foi adicionada.

## Disponibilidade derivada

| Tipo | Projeto gerenciado | Projeto sem workflow |
|---|---|---|
| Saída | autorização de mobilização vigente | `Project.isActive = true` |
| Entrada | disponível | disponível |

Em todos os casos, `Project.deletedAt` e `managerOnly` continuam compondo a visibilidade do usuário. Os dados de `ProjectWorkflow` usados no cálculo não fazem parte da resposta pública da listagem.
