# Contrato: Desmobilização do projeto

## PATCH `/efetivo/project-workflow/:projectId`

### Alterar etapa

```json
{ "action": "stage", "version": 12, "stage": "DEMOBILIZATION" }
```

### Atualizar datas efetivas

```json
{
  "action": "demobilization",
  "version": 13,
  "fieldCompletionDate": "2026-09-18",
  "returnDate": "2026-09-20"
}
```

Os dois campos aceitam `null`. Ao menos um deve ser enviado. A data de retorno não pode anteceder a conclusão de campo nem o fim previsto da execução da missão oficial.

### Resposta

O detalhe passa a incluir:

- `fieldCompletionDate`
- `demobilizationDate`
- `demobilizationReadiness` com `completed`, `total`, `percentage` e `sections`
