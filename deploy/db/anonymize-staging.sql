-- Anonimização da cópia de produção usada pela homologação (LGPD, pilares 9.1/3.1).
--
-- Roda no banco TEMPORÁRIO restaurado por deploy/sync-staging.sh, antes de ele
-- virar o banco da homologação. Tudo numa transação: qualquer erro desfaz o que
-- foi feito, o psql sai com erro (ON_ERROR_STOP) e o sync aborta sem tocar no
-- banco de homologação em uso.
--
-- Como funciona:
--   1. _anon_plan lista, por coluna, o que fazer com o dado pessoal:
--        delete  apaga todas as linhas da tabela (col = '*');
--        null    NULL (ou vazio/'{}' quando a coluna é NOT NULL);
--        set     expressão SQL; {col} é a própria coluna. Pode usar "id".
--      Tabela ou coluna ausente no banco restaurado (produção atrás da main) é
--      pulada: sem a coluna, não há dado a vazar.
--   2. _anon_allow lista colunas com nome "suspeito" que podem ficar, com motivo.
--   3. Trava final: qualquer coluna de texto/JSON cujo nome casa com o padrão
--      de dado pessoal (_anon_pattern), preenchida, e que não esteja no plano
--      nem nas exceções, faz a transação falhar. Isso pega colunas novas que
--      alguém esqueceu de incluir aqui, inclusive as que só existem em produção.
--
-- backend/test/staging-anonymization-coverage.test.js confere o schema do Prisma
-- contra este arquivo (toda coluna suspeita precisa de regra; toda regra precisa
-- apontar para coluna existente). Ao criar coluna com dado pessoal, inclua-a aqui.
--
-- Uso: psql -X -v ON_ERROR_STOP=1 -d <banco_temporario> -f deploy/db/anonymize-staging.sql

\set ON_ERROR_STOP on
SET client_min_messages = warning;

BEGIN;

-- Sal aleatório por execução: o hash é estável dentro da cópia (preserva as
-- ligações entre tabelas) e não pode ser revertido por força bruta.
CREATE TEMP TABLE _anon_salt ON COMMIT DROP AS
SELECT md5(random()::text || clock_timestamp()::text || pg_backend_pid()::text) AS salt;

CREATE FUNCTION pg_temp.anon_hash(v text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN v IS NULL THEN NULL ELSE left(md5((SELECT salt FROM _anon_salt) || v), 12) END
$$;

-- Troca todo texto de um JSON por um marcador, mantendo números, booleanos e a
-- estrutura (estatísticas da pesquisa de satisfação continuam funcionando).
CREATE FUNCTION pg_temp.anon_scrub_json(j jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;
  CASE jsonb_typeof(j)
    WHEN 'object' THEN
      RETURN COALESCE((SELECT jsonb_object_agg(e.key, pg_temp.anon_scrub_json(e.value)) FROM jsonb_each(j) AS e), '{}'::jsonb);
    WHEN 'array' THEN
      RETURN COALESCE((SELECT jsonb_agg(pg_temp.anon_scrub_json(e.value)) FROM jsonb_array_elements(j) AS e), '[]'::jsonb);
    WHEN 'string' THEN
      RETURN to_jsonb('texto removido em homologação'::text);
    ELSE
      RETURN j;
  END CASE;
END
$$;

-- Nomes de coluna que indicam dado pessoal (comparação sem maiúsculas/minúsculas).
-- O teste de cobertura lê esta linha; mantenha o padrão numa linha só.
CREATE TEMP TABLE _anon_pattern ON COMMIT DROP AS
SELECT 'cpf|^rg$|^pis$|email|phone|telefone|celular|whatsapp|ipaddress|ip$|useragent|signatureimage|dataurl|token|secret|password|salar|registrationnumber|drivername|vehicleplate|payload|rawname|normalizedname|externalname|signername|contactname|recipientname|comment|notes?$|identifier|evidence|address|endereco'::text AS re;

CREATE TEMP TABLE _anon_plan (
  ord serial,
  tbl text NOT NULL,
  col text NOT NULL,
  strategy text NOT NULL CHECK (strategy IN ('delete', 'null', 'set')),
  expr text
) ON COMMIT DROP;

INSERT INTO _anon_plan (tbl, col, strategy, expr) VALUES
  -- Sessões, tokens, rascunhos e filas com conteúdo de e-mail: nada disso vai para homologação.
  ('UserSession', '*', 'delete', NULL),
  ('PasswordResetToken', '*', 'delete', NULL),
  -- 2FA (spec 039): desafios e navegadores lembrados de produção não valem na homologação;
  -- a trilha de segurança perde IP e navegador.
  ('TwoFactorChallenge', '*', 'delete', NULL),
  ('TrustedDevice', '*', 'delete', NULL),
  ('AuthSecurityEvent', 'ipAddress', 'null', NULL),
  ('AuthSecurityEvent', 'userAgent', 'null', NULL),
  ('EmailChangeToken', '*', 'delete', NULL),
  ('NotificationPreferenceToken', '*', 'delete', NULL),
  ('ReportDraft', '*', 'delete', NULL),
  ('ReportEmailJob', '*', 'delete', NULL),
  ('ApiRequestLog', '*', 'delete', NULL),

  -- Usuários (o admin exclusivo de homologação é criado depois pelo sync).
  ('User', 'username', 'set', '''staging-user-'' || "id"'),
  ('User', 'name', 'set', '''Usuário Staging '' || "id"'),
  ('User', 'email', 'null', NULL),
  ('User', 'passwordHash', 'set', '''staging-disabled'''),
  ('User', 'clientCnpj', 'null', NULL),

  -- Colaboradores e Conecta RH (CPF, salário e demais dados vêm em ConectaRhAggregate.data).
  ('Collaborator', 'name', 'set', '''Colaborador Staging '' || "code"'),
  ('Collaborator', 'email', 'null', NULL),
  ('Collaborator', 'cpf', 'null', NULL),
  ('Collaborator', 'registrationNumber', 'set', '''STG-'' || pg_temp.anon_hash({col})'),
  ('Collaborator', 'signatureImage', 'null', NULL),
  ('Collaborator', 'efetivoNote', 'null', NULL),
  ('CollaboratorJobRoleHistory', 'note', 'null', NULL),
  ('CollaboratorAbsence', 'note', 'null', NULL),
  ('ConectaRhAggregate', 'data', 'set', '''{}'''),
  ('AllocationReviewWeekEvent', 'note', 'null', NULL),
  ('AllocationReviewDay', 'note', 'null', NULL),

  -- Ponto: nomes e matrículas viram hash estável (as ligações entre tabelas continuam).
  ('PontoPeriodSummary', 'registrationNumber', 'set', '''STG-'' || pg_temp.anon_hash({col})'),
  ('PontoPeriodSummary', 'rawName', 'set', '''pessoa '' || pg_temp.anon_hash({col})'),
  ('PontoPeriodSummary', 'normalizedName', 'set', '''pessoa '' || pg_temp.anon_hash({col})'),
  ('PontoNameAlias', 'rawName', 'set', '''pessoa '' || pg_temp.anon_hash({col})'),
  ('PontoNameAlias', 'normalizedName', 'set', '''pessoa '' || pg_temp.anon_hash({col})'),
  ('PontoExternalEmployeeLink', 'registrationNumber', 'set', '''STG-'' || pg_temp.anon_hash({col})'),
  ('PontoExternalEmployeeLink', 'externalName', 'set', '''pessoa '' || pg_temp.anon_hash({col})'),
  ('PontoExternalEmployee', 'registrationNumber', 'set', '''STG-'' || pg_temp.anon_hash({col})'),
  ('PontoExternalEmployee', 'externalName', 'set', '''pessoa '' || pg_temp.anon_hash({col})'),

  -- Contatos de clientes nos projetos.
  ('Project', 'clientEmailPrimary', 'set', ''''''),
  ('Project', 'clientEmailCc', 'set', 'ARRAY[]::text[]'),
  ('Project', 'clientSigners', 'set', 'ARRAY[]::jsonb[]'),
  ('ProjectWorkflow', 'commercialWhatsappGroupUrl', 'null', NULL),
  ('ProjectWorkflow', 'commercialClientContactName', 'set', '''Contato Staging'''),
  ('ProjectWorkflow', 'commercialClientContactPhone', 'null', NULL),
  ('ProjectWorkflow', 'commercialClientContactEmail', 'null', NULL),
  ('ProjectWorkflow', 'analysisClientContactName', 'set', '''Contato Staging'''),
  ('ProjectWorkflow', 'analysisClientContactPhone', 'null', NULL),
  ('ProjectWorkflowEmailNotification', 'recipientEmail', 'set', '''notificacao-'' || "id" || ''@staging.invalid'''),
  ('CommercialProposal', 'contactName', 'set', '''Contato Staging'''),
  ('CommercialProposal', 'contactEmail', 'null', NULL),
  ('CommercialAppReceipt', 'payload', 'set', '''{}'''),
  ('LogisticsUnloading', 'confirmadaPorEmail', 'set', '''logistica-'' || "id" || ''@staging.invalid'''),

  -- RDO: assinaturas, revisões do cliente, acessos e auditoria.
  ('Report', 'zapsignDocToken', 'null', NULL),
  ('Report', 'zapsignSignerToken', 'null', NULL),
  ('ClientReportReview', 'comment', 'null', NULL),
  ('ClientReportReview', 'ipAddress', 'null', NULL),
  ('ClientReportReview', 'userAgent', 'null', NULL),
  ('ReportClientAccess', 'recipientEmail', 'set', '''cliente-'' || "id" || ''@staging.invalid'''),
  ('ReportClientAccess', 'tokenHash', 'set', '''staging-scrubbed-'' || "id"'),
  ('ReportSignature', 'signerName', 'set', '''Assinante Staging '' || "id"'),
  ('ReportSignature', 'declaredSignerName', 'null', NULL),
  ('ReportSignature', 'clientComment', 'null', NULL),
  ('ReportSignature', 'signerEmail', 'set', '''assinatura-'' || "id" || ''@staging.invalid'''),
  ('ReportSignature', 'ipAddress', 'null', NULL),
  ('ReportSignature', 'userAgent', 'null', NULL),
  ('ReportSignature', 'signatureImageDataUrl', 'null', NULL),
  ('ReportSignature', 'tokenHash', 'null', NULL),
  ('ReportSignature', 'tokenEncrypted', 'null', NULL),
  ('ReportSignature', 'tokenIv', 'null', NULL),
  ('ReportSignature', 'tokenAuthTag', 'null', NULL),
  ('ReportAuditLog', 'description', 'null', NULL),
  ('ReportAuditLog', 'ipAddress', 'null', NULL),
  ('ReportAuditLog', 'userAgent', 'null', NULL),
  ('EfetivoAuditEvent', 'ipAddress', 'null', NULL),
  ('EfetivoAuditEvent', 'userAgent', 'null', NULL),

  -- Links públicos por token (dariam acesso a arquivos de produção se vazassem).
  ('MaintenanceAttachment', 'publicToken', 'set', '''staging-'' || "id"'),
  ('CalibrationCertificate', 'publicToken', 'set', '''staging-'' || "id"'),
  ('EquipmentAttachment', 'publicToken', 'set', '''staging-'' || "id"'),
  ('StockItemDocument', 'publicToken', 'set', '''staging-'' || "id"'),
  ('QualityEvidence', 'publicToken', 'set', '''staging-'' || "id"'),
  ('RomaneioCatalogItem', 'publicToken', 'set', '''staging-'' || "id"'),
  ('StockMovement', 'nfAttachmentToken', 'set', '''staging-'' || "id"'),

  -- Destinatários de notificações.
  ('EquipmentNotificationRecipient', 'email', 'set', '''equipamento-'' || "id" || ''@staging.invalid'''),
  ('RomaneioNotificationRecipient', 'email', 'set', '''romaneio-'' || "id" || ''@staging.invalid'''),
  ('AllocationReportRecipient', 'email', 'set', '''alocacao-'' || "id" || ''@staging.invalid'''),
  ('AllocationReportRecipientDelivery', 'email', 'set', '''alocacao-envio-'' || "id" || ''@staging.invalid'''),

  -- Credenciais de API (o verificador de produção valeria contra a API de homologação).
  ('ApiCredential', 'secretVerifier', 'set', '''staging-disabled-'' || "id"'),
  ('ApiCredential', 'secretLastFour', 'set', '''0000'''),
  ('ApiCredential', 'recipientName', 'set', '''Destinatário Staging'''),
  ('ApiCredentialEvent', 'actorIp', 'null', NULL),
  ('ApiCredentialEvent', 'actorUserAgent', 'null', NULL),

  -- EPI.
  ('EpiRecord', 'signatureImageDataUrl', 'null', NULL),
  ('EpiRecord', 'signatureSignerName', 'null', NULL),
  ('EpiSignatureRequest', 'tokenHash', 'set', '''staging-scrubbed-'' || "id"'),
  ('EpiSignatureRequest', 'signatureImageDataUrl', 'null', NULL),
  ('EpiSignatureRequest', 'signatureSignerName', 'null', NULL),
  ('EpiSignatureRequest', 'signatureImageHash', 'null', NULL),
  ('EpiSignatureRequest', 'ipAddress', 'null', NULL),
  ('EpiSignatureRequest', 'userAgent', 'null', NULL),
  ('EpiSignatureRequestAuditLog', 'ipAddress', 'null', NULL),
  ('EpiSignatureRequestAuditLog', 'userAgent', 'null', NULL),

  -- Romaneio.
  ('Romaneio', 'driverName', 'set', '''Motorista Staging'''),
  ('Romaneio', 'vehiclePlate', 'set', '''STG0000'''),
  ('Romaneio', 'checklistSignatureImage', 'null', NULL),
  ('Romaneio', 'emailError', 'null', NULL),

  -- Pesquisa de satisfação (respostas: texto removido, notas mantidas).
  ('SatisfactionSurvey', 'tokenHash', 'set', '''staging-scrubbed-'' || "id"'),
  ('SatisfactionSurvey', 'tokenEncrypted', 'set', ''''''),
  ('SatisfactionSurvey', 'tokenIv', 'set', ''''''),
  ('SatisfactionSurvey', 'tokenAuthTag', 'set', ''''''),
  ('SatisfactionSurvey', 'emailTo', 'set', '''pesquisa-'' || "id" || ''@staging.invalid'''),
  ('SatisfactionSurvey', 'followUpNotes', 'null', NULL),
  ('SatisfactionSurvey', 'responses', 'set', 'pg_temp.anon_scrub_json({col})'),
  ('SatisfactionSurvey', 'submittedIp', 'null', NULL),
  ('SatisfactionSurvey', 'submittedUserAgent', 'null', NULL),

  -- Pedidos de titulares (LGPD).
  ('DataSubjectRequest', 'name', 'set', '''Titular Staging '' || "id"'),
  ('DataSubjectRequest', 'email', 'set', '''titular-'' || "id" || ''@staging.invalid'''),
  ('DataSubjectRequest', 'identifier', 'null', NULL),
  ('DataSubjectRequest', 'details', 'set', '''Sanitizado em homologação'''),
  ('DataSubjectRequest', 'ipAddress', 'null', NULL),
  ('DataSubjectRequest', 'userAgent', 'null', NULL),
  ('DataSubjectRequest', 'responseNotes', 'null', NULL),
  ('DataSubjectRequest', 'responseEmailError', 'null', NULL),
  ('DataSubjectRequest', 'identityVerificationEvidence', 'null', NULL),
  ('DataSubjectRequest', 'completionNotes', 'null', NULL),
  ('DataSubjectRequestResponseAttempt', 'emailTo', 'set', '''resposta-'' || "id" || ''@staging.invalid'''),
  ('DataSubjectRequestResponseAttempt', 'emailSubject', 'null', NULL),

  -- Assinaturas avulsas de documentos.
  ('SignatureInviteGroup', 'tokenHash', 'set', '''staging-scrubbed-'' || "id"'),
  ('SignatureInviteGroup', 'tokenEncrypted', 'set', ''''''),
  ('SignatureInviteGroup', 'tokenIv', 'set', ''''''),
  ('SignatureInviteGroup', 'tokenAuthTag', 'set', ''''''),
  ('SignatureInviteGroup', 'emailLastError', 'null', NULL),
  ('SignatureDocumentSigner', 'name', 'set', '''Signatário Staging '' || "id"'),
  ('SignatureDocumentSigner', 'email', 'set', '''signatario-'' || "id" || ''@staging.invalid'''),
  ('SignatureDocumentSigner', 'tokenHash', 'null', NULL),
  ('SignatureDocumentSigner', 'tokenEncrypted', 'null', NULL),
  ('SignatureDocumentSigner', 'tokenIv', 'null', NULL),
  ('SignatureDocumentSigner', 'tokenAuthTag', 'null', NULL),
  ('SignatureDocumentSigner', 'emailLastError', 'null', NULL),
  ('SignatureDocumentSigner', 'declaredSignerName', 'null', NULL),
  ('SignatureDocumentSigner', 'signatureImageDataUrl', 'null', NULL),
  ('SignatureDocumentSigner', 'ipAddress', 'null', NULL),
  ('SignatureDocumentSigner', 'userAgent', 'null', NULL),
  ('SignatureDocumentAuditLog', 'ipAddress', 'null', NULL),
  ('SignatureDocumentAuditLog', 'userAgent', 'null', NULL),
  ('SignatureDocumentCompletionNotification', 'emailTo', 'set', '''assinatura-doc-'' || "id" || ''@staging.invalid'''),

  -- Integrações financeiras: o payload bruto do Omie traz nomes e dados de fornecedores/clientes.
  ('OmiePurchase', 'rawPayload', 'set', '''{}'''),
  ('OmieReceivable', 'rawPayload', 'set', '''{}''');

-- Colunas com nome "suspeito" que podem ficar como estão. Toda linha precisa de motivo.
CREATE TEMP TABLE _anon_allow (
  tbl text NOT NULL,
  col text NOT NULL,
  reason text NOT NULL CHECK (length(reason) > 10)
) ON COMMIT DROP;

INSERT INTO _anon_allow (tbl, col, reason) VALUES
  ('ConectaRhReceipt', 'payloadHash', 'hash do evento; não reversível'),
  ('CrmOpportunity', 'payloadHash', 'hash do payload; não reversível'),
  ('CrmPlanningReceipt', 'payloadHash', 'hash do payload; não reversível'),
  ('CostParameterSet', 'note', 'nota de parâmetro de custo por cargo, sem dado de pessoa'),
  ('ProjectWorkflow', 'qsmsVerificationNote', 'nota operacional do projeto, necessária para testar o fluxo'),
  ('ProjectWorkflowCommercialFact', 'note', 'nota comercial do projeto, necessária para testar o fluxo'),
  ('ProjectWorkflowCommercialFact', 'evidenceDocumentId', 'identificador interno de documento, não é dado pessoal'),
  ('ProjectDocumentVersion', 'acceptanceNote', 'nota de aceite de documento do projeto'),
  ('ProjectWorkflowChecklist', 'note', 'nota de checklist operacional do projeto'),
  ('ProjectExecutionWeeklyReview', 'note', 'nota da revisão semanal do projeto'),
  ('ProjectWorkflowMeasurement', 'additionalServicesNote', 'nota de medição de serviços do projeto'),
  ('ProjectWorkflowMeasurement', 'evidenceNote', 'nota de evidência de medição do projeto'),
  ('ProjectManualCost', 'note', 'descrição de custo manual do projeto'),
  ('ProjectPlannedService', 'note', 'nota de serviço planejado do projeto'),
  ('ProjectPlannedNormalHours', 'note', 'nota de horas planejadas por cargo'),
  ('ProjectPlannedOvertime', 'note', 'nota de horas extras planejadas por cargo'),
  ('Report', 'reviewNotes', 'observação de revisão técnica do RDO, necessária para testar o fluxo'),
  ('ReportApprovalPostProcessingJob', 'evidence', 'evidência técnica do processamento pós-aprovação'),
  ('MaintenanceRecord', 'reviewNotes', 'observação técnica de manutenção de equipamento'),
  ('OperationalReviewAudit', 'notes', 'nota da revisão operacional'),
  ('StockMovement', 'notes', 'observação de movimentação de estoque'),
  ('QualityRecord', 'evidence', 'descrição técnica da evidência de qualidade'),
  ('Romaneio', 'emailStatus', 'status técnico do envio do romaneio'),
  ('DataSubjectRequest', 'responseEmailStatus', 'status técnico do envio da resposta');

CREATE TEMP TABLE _anon_result (
  tbl text,
  col text,
  rows_affected bigint,
  note text
) ON COMMIT DROP;

DO $plan$
DECLARE
  r record;
  n bigint;
  v_nullable text;
  v_type text;
  v_expr text;
BEGIN
  FOR r IN SELECT * FROM _anon_plan ORDER BY ord LOOP
    IF to_regclass(format('public.%I', r.tbl)) IS NULL THEN
      INSERT INTO _anon_result VALUES (r.tbl, r.col, NULL, 'tabela ausente neste banco');
      CONTINUE;
    END IF;

    IF r.strategy = 'delete' THEN
      EXECUTE format('DELETE FROM public.%I', r.tbl);
      GET DIAGNOSTICS n = ROW_COUNT;
      INSERT INTO _anon_result VALUES (r.tbl, '*', n, 'linhas apagadas');
      CONTINUE;
    END IF;

    SELECT c.is_nullable, c.data_type INTO v_nullable, v_type
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = r.tbl AND c.column_name = r.col;
    IF NOT FOUND THEN
      INSERT INTO _anon_result VALUES (r.tbl, r.col, NULL, 'coluna ausente neste banco');
      CONTINUE;
    END IF;

    IF r.strategy = 'null' THEN
      v_expr := CASE
        WHEN v_nullable = 'YES' THEN 'NULL'
        WHEN v_type IN ('json', 'jsonb', 'ARRAY') THEN '''{}'''
        ELSE ''''''
      END;
    ELSE
      v_expr := replace(r.expr, '{col}', format('%I', r.col));
    END IF;

    EXECUTE format('UPDATE public.%I SET %I = %s WHERE %I IS NOT NULL', r.tbl, r.col, v_expr, r.col);
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO _anon_result VALUES (r.tbl, r.col, n, r.strategy);
  END LOOP;
END
$plan$;

-- Trava: coluna "suspeita", preenchida, sem regra no plano nem exceção -> falha.
DO $guard$
DECLARE
  r record;
  has_data boolean;
  missing text[] := ARRAY[]::text[];
  pattern text := (SELECT re FROM _anon_pattern);
BEGIN
  FOR r IN
    SELECT c.table_name AS tbl, c.column_name AS col
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name <> '_prisma_migrations'
      AND c.data_type IN ('text', 'character varying', 'json', 'jsonb', 'ARRAY')
      AND c.column_name ~* pattern
      AND NOT EXISTS (
        SELECT 1 FROM _anon_plan p
        WHERE p.tbl = c.table_name AND (p.col = c.column_name OR p.col = '*')
      )
      AND NOT EXISTS (
        SELECT 1 FROM _anon_allow a WHERE a.tbl = c.table_name AND a.col = c.column_name
      )
    ORDER BY 1, 2
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I WHERE %I IS NOT NULL AND %I::text NOT IN ('''', ''{}'', ''[]'', ''null''))',
      r.tbl, r.col, r.col
    ) INTO has_data;
    IF has_data THEN
      missing := missing || format('%s.%s', r.tbl, r.col);
    END IF;
  END LOOP;

  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'anonimização de homologação: coluna(s) com possível dado pessoal sem regra: %', array_to_string(missing, ', ')
      USING HINT = 'Inclua a coluna em deploy/db/anonymize-staging.sql (_anon_plan ou _anon_allow com motivo).';
  END IF;
END
$guard$;

-- Resumo para o log do sync.
SELECT tbl AS tabela, col AS coluna, rows_affected AS linhas, note AS regra
FROM _anon_result
ORDER BY tbl, col;

SELECT
  count(*) FILTER (WHERE rows_affected IS NOT NULL) AS regras_aplicadas,
  coalesce(sum(rows_affected), 0) AS linhas_alteradas,
  count(*) FILTER (WHERE rows_affected IS NULL) AS regras_puladas
FROM _anon_result;

COMMIT;
