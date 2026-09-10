# Data Model: Documentação e medição

## ProjectWorkflowMeasurement

Registro opcional um-para-um com `ProjectWorkflow`.

| Campo | Tipo | Regra |
|---|---|---|
| projectId | UUID | PK e FK de `ProjectWorkflow` |
| quantitiesSummary | texto opcional | até 4000 caracteres |
| additionalServicesNote | texto opcional | até 4000 caracteres |
| evidenceNote | texto opcional | até 4000 caracteres |
| executedAmount | decimal opcional | 14,2; maior ou igual a zero |
| measuredAmount | decimal opcional | 14,2; maior ou igual a zero e não superior ao executado quando ambos informados |
| approvedAmount | decimal opcional | 14,2; maior ou igual a zero e não superior ao medido quando ambos informados |
| preparedAt | data opcional | não posterior ao envio quando ambos informados |
| sentAt | data opcional | não posterior à aprovação quando ambos informados |
| approvedAt | data opcional | data da aprovação da medição |
| createdById | UUID | autor inicial |
| updatedById | UUID | último autor |
| createdAt | timestamp | auditoria |
| updatedAt | timestamp | auditoria |

## Checklist Items

### CLOSEOUT_DOCUMENTATION

1. Todos os RDOs emitidos
2. Todos os RDOs assinados/aprovados
3. Todos os relatórios técnicos elaborados
4. Todos os relatórios revisados
5. Todos os relatórios enviados
6. Pendências documentais resolvidas
7. Documentação técnica aceita pelo cliente

### CLOSEOUT_MEASUREMENT

1. Quantitativos finais consolidados
2. Serviços adicionais incluídos
3. Evidências disponíveis
4. Medição preparada
5. Medição enviada
6. Medição aprovada
7. Valor final aprovado

## Derived View

O painel combina o registro acima com RDOs, relatórios, revisões do cliente, orçamento/adicionais e recebíveis Omie. Nenhum total derivado é persistido no novo registro.
