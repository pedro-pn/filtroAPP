# Plano

1. Migração aditiva: enum ApiWriteMode, ApiCredential.writeMode LIVE e
   ApiRequestLog.simulated false. Schemas, serialização e rotação coerentes.
2. Executor comum: cliente transacional com transações internas reutilizadas,
   isolamento Serializable e rollback por sentinela privada; projetar resultado
   antes do rollback. AsyncLocalStorage limita supressão de caches à execução.
3. Registro explícito por operação e proteção em requireApiOperation; medição e
   logging permanecem fora da transação. Rotas e Playground usam o executor.
4. Edição administrativa específica de writeMode reutiliza PATCH com versão,
   justificativa e METADATA_UPDATED, sem permitir ampliação de escopos.
5. Atualizar painel, contratos OpenAPI, documentação e testes genéricos com banco
   descartável PostgreSQL/PGlite; revisão de efeitos e checks do repositório.

## Efeitos a verificar

Qualidade: QualityRecord, QualityRecordSeq, IntegrationQualityReceipt,
QualityRecordAuditLog, IntegrationEvent, IntegrationEventSequence.
Projeto: Project, segmentos, ProjectBudget e dados derivados da seleção Access.
Oportunidade: CrmOpportunity, CrmOpportunityEvent, CrmPlanningReceipt,
CrmOpportunityLinkEvent, CrmProjectMapping, Project e defaults. Fatos/documentos: tabelas de
domínio e ProjectWorkflow/ProjectWorkflowEvent. Incluir NotificationEvent e
demais tabelas do schema no teste de invariância. As cinco cadeias não enviam
e-mail, não enfileiram jobs, não agendam tarefas nem chamam serviços externos.
Projetos/oportunidades/defaults invalidam cache na real: suprimir em simulação.
Documentos CRM são EXTERNAL_REFERENCE e não chamam funções de upload/assinatura.
