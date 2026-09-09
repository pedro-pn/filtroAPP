# Modelo de dados da primeira entrega

- ProjectWorkflow: projectId (PK/FK Project), stage (HANDOVER/INITIAL_ANALYSIS/WAITING_PLANNING/MOBILIZATION_PLANNING), leaderUserId (FK User), acceptedAt, plannedMobilizationDate, version, createdAt/updatedAt. Uma gestão por projeto; sem planId.
- ProjectWorkflowChecklist: id, projectId, key, status PENDING/DONE/NOT_APPLICABLE, note, updatedByUserId, updatedAt. Único projectId/key. Catálogo inicial versão 1.
- ProjectWorkflowCriticalAnswer: id, projectId, key, answer boolean, updatedByUserId/updatedAt. Ausência de registro = sem resposta; false é resposta válida. Único projectId/key.
- ProjectWorkflowIssue: id, projectId, sourceQuestion (opcional e único com projectId), description, area, ownerName, requiredLeadTimeDays, dueDate (data civil), criticality HIGH/MEDIUM/LOW, status OPEN/IN_PROGRESS/RESOLVED, updatedAt. A pendência automática começa sem responsável/prazo e precisa ser encaminhada antes do fim da análise.
- ProjectWorkflowEvent: id, projectId, actorUserId (FK User), action, data JSON, createdAt. Histórico ordenado, sem IP/segredos em payload de usuário.

Relações: gestão removível somente por ciclo de vida futuro; APIs deste incremento não excluem gestão nem evidências. FK Project e User restritas conforme regras existentes. Migração cria somente tabelas/índices e enum novo; não modifica missões ou projetos antigos.

Gates: HANDOVER → INITIAL_ANALYSIS exige checklist handover e aceite; INITIAL_ANALYSIS → WAITING_PLANNING ou MOBILIZATION_PLANNING exige checklist análise, cinco respostas e pendências positivas encaminhadas (área, responsável, prazo necessário e data limite). WAITING_PLANNING → MOBILIZATION_PLANNING revalida análise; volta à análise permitida para revisão. Troca de líder volta ao handover e invalida aceite.
