# Contract: Documentação e medição

## GET `/api/efetivo/project-workflow/:projectId/closeout`

Retorna:

- `documentation`: totais atuais de RDOs, relatórios técnicos, metas, situações e aceites do cliente.
- `financial`: contrato original, adicionais, contrato previsto, faturado e quantidade de documentos financeiros.
- `measurement`: dados editáveis, pendente de medir e pendente de aprovação.

Projetos inexistentes ou fora do escopo autorizado retornam erro conforme o padrão do módulo.

## PATCH `/api/efetivo/project-workflow/:projectId`

Nova ação `measurement`:

```json
{
  "version": 7,
  "action": "measurement",
  "measurement": {
    "quantitiesSummary": "Quantitativos consolidados conforme RDOs.",
    "additionalServicesNote": "Adicional AP-03 incluído.",
    "evidenceNote": "Planilha e RDOs anexados.",
    "executedAmount": 835000,
    "measuredAmount": 835000,
    "approvedAmount": 820000,
    "preparedAt": "2026-09-01",
    "sentAt": "2026-09-03",
    "approvedAt": "2026-09-08"
  }
}
```

Todos os campos são opcionais e aceitam `null` para limpeza. A resposta é o workflow atualizado.
