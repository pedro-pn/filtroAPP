# Modelo de dados: Pós-job e fechamento técnico

## ProjectWorkflowStage

- Nova etapa `POST_JOB` depois de `DEMOBILIZATION`.
- A projeção operacional permanece `EfetivoMissionStage.FINAL_MEASUREMENT`.

## ProjectWorkflowPostJob

Registro único por `projectId`:

- `meetingDate`
- `fieldLeaderFeedback`
- `teamFeedback`
- `problemsFound`
- `solutionsAdopted`
- `improvementOpportunities`
- `lessonsLearned`
- `equipmentFeedback`
- `planningFeedback`
- `serviceTypes[]`
- `qualityRecordId`
- autoria e datas de criação/atualização

## ProjectWorkflowChecklist

- `POST_JOB_FEEDBACK`: reunião e feedbacks.
- `POST_JOB_LEARNING`: problemas, soluções, melhorias e lições.

## Invariantes

1. Há no máximo um pós-job por projeto.
2. Há no máximo um registro ativo de Qualidade sincronizado por pós-job.
3. O gate da desmobilização exige 15 controles resolvidos e as duas datas efetivas.
4. A atualização do pós-job e da lição aprendida é atômica.
