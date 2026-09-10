# Contrato: Pós-job do projeto

## PATCH `/efetivo/project-workflow/:projectId`

### Avançar para Pós-job

```json
{ "action": "stage", "version": 15, "stage": "POST_JOB" }
```

### Atualizar o fechamento técnico

```json
{
  "action": "post_job",
  "version": 16,
  "meetingDate": "2026-09-25",
  "fieldLeaderFeedback": "Equipe executou a sequência planejada.",
  "teamFeedback": "A preparação documental funcionou.",
  "problemsFound": "A mangueira reserva não estava identificada.",
  "solutionsAdopted": "Conferência cruzada antes do segundo turno.",
  "improvementOpportunities": "Identificar kits por sistema.",
  "lessonsLearned": "Separar kits por sistema reduz o tempo de troca.",
  "equipmentFeedback": "Bomba principal sem desvios.",
  "planningFeedback": "Adicionar conferência de etiquetas no D-15."
}
```

Todos os campos aceitam `null`; ao menos um campo deve ser enviado.

### Resposta

O detalhe inclui:

- `postJob`
- `postJobReadiness`
- `relatedPostJobs`

Quando `lessonsLearned` possui conteúdo, `postJob.qualityRecord` informa o número do registro criado ou atualizado no módulo Qualidade.
