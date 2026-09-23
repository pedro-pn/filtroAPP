-- Checklist de verificação obrigatória do contato inicial com o cliente (16 perguntas Sim/Não + observação
-- opcional), na Análise inicial. Ver PROJECT_WORKFLOW_CLIENT_CONTACT_CHECKLIST em shared/schemas/project-workflow.js.
ALTER TABLE "ProjectWorkflow" ADD COLUMN "clientContactChecklist" JSONB NOT NULL DEFAULT '{}';
