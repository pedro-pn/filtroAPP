-- AlterTable
ALTER TABLE "OmieInvoice" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "LogisticsCte" (
    "id" TEXT NOT NULL,
    "omieId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "romaneioId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "emissao" TIMESTAMP(3) NOT NULL,
    "transportadora" TEXT NOT NULL,
    "invoiceId" TEXT,
    "nfeKeys" TEXT[],
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LogisticsCte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogisticsUnloading" (
    "id" TEXT NOT NULL,
    "romaneioId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "confirmadaEm" TIMESTAMP(3) NOT NULL,
    "confirmedByUserId" TEXT NOT NULL,
    "confirmadaPorEmail" TEXT NOT NULL,
    "cteId" TEXT,
    "actorCredentialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LogisticsUnloading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationUnloadingReceipt" (
    "credentialId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationUnloadingReceipt_pkey" PRIMARY KEY ("credentialId","key")
);

-- CreateTable
CREATE TABLE "IntegrationInvoicePublication" (
    "invoiceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationInvoicePublication_pkey" PRIMARY KEY ("invoiceId","projectId")
);

-- CreateIndex
CREATE UNIQUE INDEX "LogisticsCte_omieId_key" ON "LogisticsCte"("omieId");

-- CreateIndex
CREATE INDEX "LogisticsCte_projectId_idx" ON "LogisticsCte"("projectId");

-- CreateIndex
CREATE INDEX "LogisticsCte_romaneioId_idx" ON "LogisticsCte"("romaneioId");

-- CreateIndex
CREATE INDEX "LogisticsUnloading_projectId_updatedAt_id_idx" ON "LogisticsUnloading"("projectId", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LogisticsUnloading_romaneioId_tipo_confirmadaEm_key" ON "LogisticsUnloading"("romaneioId", "tipo", "confirmadaEm");

-- CreateIndex
CREATE INDEX "OmieInvoice_updatedAt_id_idx" ON "OmieInvoice"("updatedAt", "id");

-- AddForeignKey
ALTER TABLE "LogisticsCte" ADD CONSTRAINT "LogisticsCte_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsCte" ADD CONSTRAINT "LogisticsCte_romaneioId_fkey" FOREIGN KEY ("romaneioId") REFERENCES "Romaneio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsUnloading" ADD CONSTRAINT "LogisticsUnloading_romaneioId_fkey" FOREIGN KEY ("romaneioId") REFERENCES "Romaneio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsUnloading" ADD CONSTRAINT "LogisticsUnloading_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsUnloading" ADD CONSTRAINT "LogisticsUnloading_cteId_fkey" FOREIGN KEY ("cteId") REFERENCES "LogisticsCte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationUnloadingReceipt" ADD CONSTRAINT "IntegrationUnloadingReceipt_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ApiCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Funções/gatilhos da Entrega B. Relógio de parede evita watermark antigo em transações longas.
CREATE FUNCTION integration_measurement_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(OLD."preparedAt",OLD."sentAt",OLD."approvedAt",OLD."executedAmount",OLD."measuredAmount",OLD."approvedAmount")
    IS NOT DISTINCT FROM ROW(NEW."preparedAt",NEW."sentAt",NEW."approvedAt",NEW."executedAmount",NEW."measuredAmount",NEW."approvedAmount") THEN RETURN NEW; END IF;
  pid := CASE WHEN TG_OP = 'DELETE' THEN OLD."projectId" ELSE NEW."projectId" END;
  UPDATE "Project" SET "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC' WHERE id = pid;
  PERFORM integration_emit('medicao.alterada', pid, 'medicao', pid);
  RETURN NULL;
END $$;
CREATE TRIGGER "Measurement_integration_change" AFTER INSERT OR UPDATE OR DELETE ON "ProjectWorkflowMeasurement"
  FOR EACH ROW EXECUTE FUNCTION integration_measurement_change();

-- Uma primeira publicação por nota/projeto. Conservada após remoção do snapshot.
INSERT INTO "IntegrationInvoicePublication" ("invoiceId","projectId")
  SELECT n.id,p.id FROM "OmieInvoice" n JOIN "OmieProject" op ON op.codigo=n."codigoProjeto"
  JOIN "Project" p ON p.id=op."projectId" WHERE p."deletedAt" IS NULL ON CONFLICT DO NOTHING;
CREATE FUNCTION integration_invoice_publish(invoice_id TEXT, project_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF project_id IS NULL OR NOT EXISTS(SELECT 1 FROM "Project" WHERE id=project_id AND "deletedAt" IS NULL) THEN RETURN; END IF;
  INSERT INTO "IntegrationInvoicePublication" ("invoiceId","projectId") VALUES(invoice_id,project_id) ON CONFLICT DO NOTHING;
  IF FOUND THEN PERFORM integration_emit('nota.emitida',project_id,'nota',invoice_id); END IF;
END $$;
CREATE FUNCTION integration_invoice_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('app.integration_invoice_mapping',true) IS DISTINCT FROM NEW."codigoProjeto" AND (to_jsonb(OLD)-'updatedAt'-'syncedAt') IS NOT DISTINCT FROM (to_jsonb(NEW)-'updatedAt'-'syncedAt') THEN
    NEW."updatedAt" := OLD."updatedAt";
  ELSE NEW."updatedAt" := clock_timestamp() AT TIME ZONE 'UTC'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Invoice_integration_dates" BEFORE INSERT OR UPDATE ON "OmieInvoice" FOR EACH ROW EXECUTE FUNCTION integration_invoice_dates();
CREATE FUNCTION integration_invoice_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid TEXT;
BEGIN
  SELECT "projectId" INTO pid FROM "OmieProject" WHERE codigo=NEW."codigoProjeto";
  PERFORM integration_invoice_publish(NEW.id,pid);
  IF TG_OP='UPDATE' AND OLD."receiptStatus" IS DISTINCT FROM NEW."receiptStatus" AND pid IS NOT NULL THEN
    PERFORM integration_emit('nota.recebimento_alterado',pid,'nota',NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Invoice_integration_change" AFTER INSERT OR UPDATE ON "OmieInvoice" FOR EACH ROW EXECUTE FUNCTION integration_invoice_change();
CREATE FUNCTION integration_omie_mapping_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice_row RECORD;
BEGIN
  IF TG_OP='UPDATE' AND OLD."projectId" IS NOT DISTINCT FROM NEW."projectId" THEN RETURN NEW; END IF;
  -- Atualiza o watermark mesmo se o vínculo for removido; nova ligação publica apenas no destino correto.
  PERFORM set_config('app.integration_invoice_mapping',NEW.codigo,true);
  UPDATE "OmieInvoice" SET "updatedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE "codigoProjeto"=NEW.codigo;
  PERFORM set_config('app.integration_invoice_mapping','',true);
  FOR invoice_row IN SELECT id FROM "OmieInvoice" WHERE "codigoProjeto"=NEW.codigo LOOP
    PERFORM integration_invoice_publish(invoice_row.id,NEW."projectId");
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER "OmieProject_integration_mapping" AFTER INSERT OR UPDATE ON "OmieProject" FOR EACH ROW EXECUTE FUNCTION integration_omie_mapping_change();

CREATE FUNCTION integration_pending_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid TEXT; previous_pid TEXT;
BEGIN
  IF TG_OP='UPDATE' AND (to_jsonb(OLD)-'syncedAt') IS NOT DISTINCT FROM (to_jsonb(NEW)-'syncedAt') THEN RETURN NEW; END IF;
  pid := CASE WHEN TG_OP='DELETE' THEN OLD."projectId" ELSE NEW."projectId" END;
  previous_pid := CASE WHEN TG_OP='UPDATE' THEN OLD."projectId" ELSE NULL END;
  IF pid IS NOT NULL THEN
    UPDATE "Project" SET "updatedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=pid;
    PERFORM integration_emit('pendencia.alterada',pid,'pendencia',pid);
  END IF;
  IF previous_pid IS NOT NULL AND previous_pid IS DISTINCT FROM pid THEN
    UPDATE "Project" SET "updatedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=previous_pid;
    PERFORM integration_emit('pendencia.alterada',previous_pid,'pendencia',previous_pid);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "Purchase_integration_pending" AFTER INSERT OR UPDATE OR DELETE ON "OmiePurchase" FOR EACH ROW EXECUTE FUNCTION integration_pending_change();
CREATE TRIGGER "Receivable_integration_pending" AFTER INSERT OR UPDATE OR DELETE ON "OmieReceivable" FOR EACH ROW EXECUTE FUNCTION integration_pending_change();

CREATE OR REPLACE FUNCTION integration_romaneio_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN NEW."emittedAt" := OLD."emittedAt"; END IF;
  IF NEW."emittedAt" IS NULL AND (NEW."pdfUrl" IS NOT NULL OR NEW."docxUrl" IS NOT NULL) THEN
    NEW."emittedAt" := clock_timestamp() AT TIME ZONE 'UTC';
    PERFORM integration_emit('romaneio.emitido', NEW."projectId", 'romaneio', NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION integration_romaneio_item_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN UPDATE "Romaneio" SET "updatedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=OLD."romaneioId";
  ELSE UPDATE "Romaneio" SET "updatedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=NEW."romaneioId"; END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "RomaneioItem_integration_change" AFTER INSERT OR UPDATE OR DELETE ON "RomaneioItem" FOR EACH ROW EXECUTE FUNCTION integration_romaneio_item_change();

ALTER TABLE "LogisticsUnloading" ADD CONSTRAINT "LogisticsUnloading_tipo_check" CHECK (tipo IN ('PARCIAL','TOTAL'));
CREATE UNIQUE INDEX "LogisticsUnloading_one_total" ON "LogisticsUnloading"("romaneioId") WHERE tipo='TOTAL';
CREATE FUNCTION integration_unloading_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM integration_emit('descarga.confirmada',NEW."projectId",'descarga',NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER "Unloading_integration_change" AFTER INSERT ON "LogisticsUnloading" FOR EACH ROW EXECUTE FUNCTION integration_unloading_change();
