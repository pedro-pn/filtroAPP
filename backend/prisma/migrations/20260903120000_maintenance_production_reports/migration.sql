-- Relatórios internos de manutenção (5002) e produção (5004).
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'RDO_MAINTENANCE';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'RDO_PRODUCTION';

CREATE TYPE "ReportEmissionPermission" AS ENUM ('SITE_RDO', 'MAINTENANCE', 'PRODUCTION');
CREATE TYPE "MaintenanceAttachmentKind" AS ENUM ('PHOTO', 'DOCUMENT');
CREATE TYPE "ChemicalCleaningMaterial" AS ENUM ('CARBON_STEEL', 'STAINLESS_STEEL', 'CUNIFE', 'OTHER');

ALTER TABLE "User"
  ADD COLUMN "reportEmissionPermissions" "ReportEmissionPermission"[] NOT NULL DEFAULT ARRAY[]::"ReportEmissionPermission"[];

-- Preserva somente a emissão de RDO de obra para quem já tinha um papel interno no módulo.
UPDATE "User" AS u
SET "reportEmissionPermissions" = ARRAY['SITE_RDO']::"ReportEmissionPermission"[]
WHERE u."accountType" IN ('ADMIN', 'INTERNAL')
  AND EXISTS (
    SELECT 1
    FROM "ModuleRole" AS mr
    WHERE mr."userId" = u."id"
      AND mr."module" = 'RDO'
      AND mr."role" IN ('RDO_MANAGER', 'RDO_COORDINATOR', 'RDO_COLLABORATOR')
  );

CREATE TABLE "MaintenanceProfile" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaintenanceProfileItem" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceProfileItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaintenanceConfiguration" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "supervisorCollaboratorId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaintenanceRecord" (
  "id" TEXT NOT NULL,
  "reportId" TEXT,
  "equipmentId" TEXT NOT NULL,
  "profileId" TEXT,
  "maintenanceDate" DATE NOT NULL,
  "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
  "createdByUserId" TEXT,
  "reviewedByUserId" TEXT,
  "responsibleNameSnapshot" TEXT NOT NULL,
  "profileNameSnapshot" TEXT NOT NULL,
  "selectedServices" JSONB NOT NULL,
  "observations" TEXT,
  "reviewNotes" TEXT,
  "supervisorNameSnapshot" TEXT,
  "supervisorSignatureSnapshot" TEXT,
  "approvedAt" TIMESTAMP(3),
  "returnedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaintenanceThirdPartyService" (
  "id" TEXT NOT NULL,
  "maintenanceId" TEXT NOT NULL,
  "serviceDate" DATE NOT NULL,
  "location" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceThirdPartyService_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaintenanceAttachment" (
  "id" TEXT NOT NULL,
  "maintenanceId" TEXT NOT NULL,
  "kind" "MaintenanceAttachmentKind" NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "publicToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaintenanceAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChemicalCleaning" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "material" "ChemicalCleaningMaterial" NOT NULL,
  "otherMaterial" TEXT,
  "quantityKg" DECIMAL(12,3) NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChemicalCleaning_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChemicalCleaning_quantityKg_check" CHECK ("quantityKg" > 0),
  CONSTRAINT "ChemicalCleaning_otherMaterial_check" CHECK (
    ("material" = 'OTHER' AND NULLIF(BTRIM("otherMaterial"), '') IS NOT NULL)
    OR ("material" <> 'OTHER')
  )
);

CREATE TABLE "OperationalReviewAudit" (
  "id" TEXT NOT NULL,
  "reportId" TEXT,
  "maintenanceId" TEXT,
  "actorUserId" TEXT,
  "actorNameSnapshot" TEXT NOT NULL,
  "previousStatus" "ReportStatus" NOT NULL,
  "nextStatus" "ReportStatus" NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationalReviewAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperationalReviewAudit_single_target_check" CHECK (
    ("reportId" IS NOT NULL AND "maintenanceId" IS NULL)
    OR ("reportId" IS NULL AND "maintenanceId" IS NOT NULL)
  )
);

ALTER TABLE "CompanyEquipment" ADD COLUMN "maintenanceProfileId" TEXT;

CREATE UNIQUE INDEX "MaintenanceProfile_key_key" ON "MaintenanceProfile"("key");
CREATE INDEX "MaintenanceProfile_isActive_order_idx" ON "MaintenanceProfile"("isActive", "order");
CREATE UNIQUE INDEX "MaintenanceProfileItem_profileId_order_key" ON "MaintenanceProfileItem"("profileId", "order");
CREATE INDEX "MaintenanceProfileItem_profileId_isActive_order_idx" ON "MaintenanceProfileItem"("profileId", "isActive", "order");
CREATE INDEX "MaintenanceConfiguration_supervisorCollaboratorId_idx" ON "MaintenanceConfiguration"("supervisorCollaboratorId");
CREATE INDEX "MaintenanceRecord_reportId_idx" ON "MaintenanceRecord"("reportId");
CREATE INDEX "MaintenanceRecord_equipmentId_status_maintenanceDate_idx" ON "MaintenanceRecord"("equipmentId", "status", "maintenanceDate");
CREATE INDEX "MaintenanceRecord_status_maintenanceDate_idx" ON "MaintenanceRecord"("status", "maintenanceDate");
CREATE INDEX "MaintenanceRecord_profileId_status_idx" ON "MaintenanceRecord"("profileId", "status");
CREATE UNIQUE INDEX "MaintenanceThirdPartyService_maintenanceId_order_key" ON "MaintenanceThirdPartyService"("maintenanceId", "order");
CREATE INDEX "MaintenanceThirdPartyService_maintenanceId_idx" ON "MaintenanceThirdPartyService"("maintenanceId");
CREATE UNIQUE INDEX "MaintenanceAttachment_publicToken_key" ON "MaintenanceAttachment"("publicToken");
CREATE INDEX "MaintenanceAttachment_maintenanceId_kind_createdAt_idx" ON "MaintenanceAttachment"("maintenanceId", "kind", "createdAt");
CREATE UNIQUE INDEX "MaintenanceAttachment_one_document_per_maintenance_idx"
  ON "MaintenanceAttachment"("maintenanceId") WHERE "kind" = 'DOCUMENT';
CREATE UNIQUE INDEX "ChemicalCleaning_reportId_order_key" ON "ChemicalCleaning"("reportId", "order");
CREATE INDEX "ChemicalCleaning_reportId_idx" ON "ChemicalCleaning"("reportId");
CREATE INDEX "ChemicalCleaning_material_idx" ON "ChemicalCleaning"("material");
CREATE INDEX "OperationalReviewAudit_reportId_createdAt_idx" ON "OperationalReviewAudit"("reportId", "createdAt");
CREATE INDEX "OperationalReviewAudit_maintenanceId_createdAt_idx" ON "OperationalReviewAudit"("maintenanceId", "createdAt");
CREATE INDEX "OperationalReviewAudit_actorUserId_createdAt_idx" ON "OperationalReviewAudit"("actorUserId", "createdAt");
CREATE INDEX "CompanyEquipment_maintenanceProfileId_idx" ON "CompanyEquipment"("maintenanceProfileId");

ALTER TABLE "MaintenanceProfileItem" ADD CONSTRAINT "MaintenanceProfileItem_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "MaintenanceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceConfiguration" ADD CONSTRAINT "MaintenanceConfiguration_supervisorCollaboratorId_fkey"
  FOREIGN KEY ("supervisorCollaboratorId") REFERENCES "Collaborator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MaintenanceConfiguration" ADD CONSTRAINT "MaintenanceConfiguration_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_equipmentId_fkey"
  FOREIGN KEY ("equipmentId") REFERENCES "CompanyEquipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "MaintenanceProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MaintenanceThirdPartyService" ADD CONSTRAINT "MaintenanceThirdPartyService_maintenanceId_fkey"
  FOREIGN KEY ("maintenanceId") REFERENCES "MaintenanceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceAttachment" ADD CONSTRAINT "MaintenanceAttachment_maintenanceId_fkey"
  FOREIGN KEY ("maintenanceId") REFERENCES "MaintenanceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChemicalCleaning" ADD CONSTRAINT "ChemicalCleaning_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationalReviewAudit" ADD CONSTRAINT "OperationalReviewAudit_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationalReviewAudit" ADD CONSTRAINT "OperationalReviewAudit_maintenanceId_fkey"
  FOREIGN KEY ("maintenanceId") REFERENCES "MaintenanceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationalReviewAudit" ADD CONSTRAINT "OperationalReviewAudit_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyEquipment" ADD CONSTRAINT "CompanyEquipment_maintenanceProfileId_fkey"
  FOREIGN KEY ("maintenanceProfileId") REFERENCES "MaintenanceProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Centros internos. Registros existentes com o mesmo código são preservados.
INSERT INTO "Project" ("id", "code", "name", "clientName", "clientCnpj", "contractCode", "location", "visibleToCollaborators", "updatedAt")
VALUES
  ('internal-maintenance-5002', '5002', 'Manutenção', 'Filtrovalle', '', '5002', 'Sede', false, CURRENT_TIMESTAMP),
  ('internal-production-5004', '5004', 'Produção', 'Filtrovalle', '', '5004', 'Sede', false, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "MaintenanceProfile" ("id", "key", "name", "order", "updatedAt") VALUES
  ('maintenance-profile-ufi', 'UFI', 'UFI', 1, CURRENT_TIMESTAMP),
  ('maintenance-profile-uth', 'UTH', 'UTH', 2, CURRENT_TIMESTAMP),
  ('maintenance-profile-ufp-regular', 'UFP_REGULAR', 'UFP regular', 3, CURRENT_TIMESTAMP),
  ('maintenance-profile-ufp-pneu', 'UFP_PNEU', 'UFP pneu', 4, CURRENT_TIMESTAMP),
  ('maintenance-profile-uto', 'UTO', 'UTO', 5, CURRENT_TIMESTAMP),
  ('maintenance-profile-ubp', 'UBP', 'UBP', 6, CURRENT_TIMESTAMP),
  ('maintenance-profile-ulq-regular', 'ULQ_REGULAR', 'ULQ regular', 7, CURRENT_TIMESTAMP),
  ('maintenance-profile-ulq-diesel', 'ULQ_DIESEL', 'ULQ diesel', 8, CURRENT_TIMESTAMP),
  ('maintenance-profile-tro', 'TRO', 'TRO', 9, CURRENT_TIMESTAMP),
  ('maintenance-profile-cmr', 'CMR', 'CMR', 10, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "MaintenanceProfileItem" ("id", "profileId", "label", "order", "updatedAt") VALUES
  ('mp-ufi-01', 'maintenance-profile-ufi', 'Drenagem e limpeza das carcaças dos filtros', 1, CURRENT_TIMESTAMP),
  ('mp-ufi-02', 'maintenance-profile-ufi', 'Limpeza da válvula de retenção', 2, CURRENT_TIMESTAMP),
  ('mp-ufi-03', 'maintenance-profile-ufi', 'Aperto dos parafusos do motor', 3, CURRENT_TIMESTAMP),
  ('mp-ufi-04', 'maintenance-profile-ufi', 'Aperto das conexões', 4, CURRENT_TIMESTAMP),
  ('mp-ufi-05', 'maintenance-profile-ufi', 'Aperto dos parafusos das válvulas', 5, CURRENT_TIMESTAMP),
  ('mp-ufi-06', 'maintenance-profile-ufi', 'Verificação do medidor de saturação dos filtros', 6, CURRENT_TIMESTAMP),
  ('mp-ufi-07', 'maintenance-profile-ufi', 'Troca do filtro de ar do painel', 7, CURRENT_TIMESTAMP),
  ('mp-ufi-08', 'maintenance-profile-ufi', 'Reaperto dos fios do painel', 8, CURRENT_TIMESTAMP),
  ('mp-ufi-09', 'maintenance-profile-ufi', 'Verificação dos rodízios do skid', 9, CURRENT_TIMESTAMP),
  ('mp-ufi-10', 'maintenance-profile-ufi', 'Verificação do varão', 10, CURRENT_TIMESTAMP),
  ('mp-ufi-11', 'maintenance-profile-ufi', 'Verificação das mangueiras hidráulicas', 11, CURRENT_TIMESTAMP),
  ('mp-ufi-12', 'maintenance-profile-ufi', 'Pintura', 12, CURRENT_TIMESTAMP),
  ('mp-ufi-13', 'maintenance-profile-ufi', 'Teste', 13, CURRENT_TIMESTAMP),
  ('mp-uth-01', 'maintenance-profile-uth', 'Verificação do plug de alimentação', 1, CURRENT_TIMESTAMP),
  ('mp-uth-02', 'maintenance-profile-uth', 'Verificação do manômetro', 2, CURRENT_TIMESTAMP),
  ('mp-uth-03', 'maintenance-profile-uth', 'Verificação da correia (apenas UTH 008)', 3, CURRENT_TIMESTAMP),
  ('mp-uth-04', 'maintenance-profile-uth', 'Verificação da válvula agulha', 4, CURRENT_TIMESTAMP),
  ('mp-uth-05', 'maintenance-profile-uth', 'Verificação das mangueiras', 5, CURRENT_TIMESTAMP),
  ('mp-uth-06', 'maintenance-profile-uth', 'Verificação das polias (apenas UTH 008)', 6, CURRENT_TIMESTAMP),
  ('mp-uth-07', 'maintenance-profile-uth', 'Verificação da pintura', 7, CURRENT_TIMESTAMP),
  ('mp-uth-08', 'maintenance-profile-uth', 'Verificação dos rodízios', 8, CURRENT_TIMESTAMP),
  ('mp-uth-09', 'maintenance-profile-uth', 'Teste', 9, CURRENT_TIMESTAMP),
  ('mp-ufpr-01', 'maintenance-profile-ufp-regular', 'Drenagem e limpeza das carcaças dos filtros', 1, CURRENT_TIMESTAMP),
  ('mp-ufpr-02', 'maintenance-profile-ufp-regular', 'Limpeza da válvula de retenção', 2, CURRENT_TIMESTAMP),
  ('mp-ufpr-03', 'maintenance-profile-ufp-regular', 'Aperto dos parafusos da bucha de expansão', 3, CURRENT_TIMESTAMP),
  ('mp-ufpr-04', 'maintenance-profile-ufp-regular', 'Aperto dos parafusos das válvulas', 4, CURRENT_TIMESTAMP),
  ('mp-ufpr-05', 'maintenance-profile-ufp-regular', 'Aperto das conexões', 5, CURRENT_TIMESTAMP),
  ('mp-ufpr-06', 'maintenance-profile-ufp-regular', 'Limpeza do medidor de vazão', 6, CURRENT_TIMESTAMP),
  ('mp-ufpr-07', 'maintenance-profile-ufp-regular', 'Troca do filtro de ar do painel', 7, CURRENT_TIMESTAMP),
  ('mp-ufpr-08', 'maintenance-profile-ufp-regular', 'Pintura', 8, CURRENT_TIMESTAMP),
  ('mp-ufpr-09', 'maintenance-profile-ufp-regular', 'Teste', 9, CURRENT_TIMESTAMP),
  ('mp-ufpp-01', 'maintenance-profile-ufp-pneu', 'Drenagem e limpeza das carcaças dos filtros', 1, CURRENT_TIMESTAMP),
  ('mp-ufpp-02', 'maintenance-profile-ufp-pneu', 'Limpeza da válvula de retenção', 2, CURRENT_TIMESTAMP),
  ('mp-ufpp-03', 'maintenance-profile-ufp-pneu', 'Aperto dos parafusos da bucha de expansão', 3, CURRENT_TIMESTAMP),
  ('mp-ufpp-04', 'maintenance-profile-ufp-pneu', 'Aperto dos parafusos das válvulas', 4, CURRENT_TIMESTAMP),
  ('mp-ufpp-05', 'maintenance-profile-ufp-pneu', 'Aperto das conexões', 5, CURRENT_TIMESTAMP),
  ('mp-ufpp-06', 'maintenance-profile-ufp-pneu', 'Limpeza do medidor de vazão', 6, CURRENT_TIMESTAMP),
  ('mp-ufpp-07', 'maintenance-profile-ufp-pneu', 'Troca do filtro de ar do painel', 7, CURRENT_TIMESTAMP),
  ('mp-ufpp-08', 'maintenance-profile-ufp-pneu', 'Verificação das mangueiras de calibração dos pneus', 8, CURRENT_TIMESTAMP),
  ('mp-ufpp-09', 'maintenance-profile-ufp-pneu', 'Pintura', 9, CURRENT_TIMESTAMP),
  ('mp-ufpp-10', 'maintenance-profile-ufp-pneu', 'Teste', 10, CURRENT_TIMESTAMP),
  ('mp-uto-01', 'maintenance-profile-uto', 'Limpeza da carcaça do filtro', 1, CURRENT_TIMESTAMP),
  ('mp-uto-02', 'maintenance-profile-uto', 'Limpeza do Filtro Y', 2, CURRENT_TIMESTAMP),
  ('mp-uto-03', 'maintenance-profile-uto', 'Verificação das borrachas de vedação das câmaras de vácuo', 3, CURRENT_TIMESTAMP),
  ('mp-uto-04', 'maintenance-profile-uto', 'Verificação do acrílico das câmaras de vácuo', 4, CURRENT_TIMESTAMP),
  ('mp-uto-05', 'maintenance-profile-uto', 'Verificação das fiações do painel', 5, CURRENT_TIMESTAMP),
  ('mp-uto-06', 'maintenance-profile-uto', 'Verificação dos manômetros', 6, CURRENT_TIMESTAMP),
  ('mp-uto-07', 'maintenance-profile-uto', 'Verificação do filtro de ar', 7, CURRENT_TIMESTAMP),
  ('mp-uto-08', 'maintenance-profile-uto', 'Verificação do conduíte da fiação de alimentação', 8, CURRENT_TIMESTAMP),
  ('mp-uto-09', 'maintenance-profile-uto', 'Verificação da resistência', 9, CURRENT_TIMESTAMP),
  ('mp-uto-10', 'maintenance-profile-uto', 'Verificação das mangueiras', 10, CURRENT_TIMESTAMP),
  ('mp-uto-11', 'maintenance-profile-uto', 'Verificação de vazamentos', 11, CURRENT_TIMESTAMP),
  ('mp-uto-12', 'maintenance-profile-uto', 'Verificação da iluminação', 12, CURRENT_TIMESTAMP),
  ('mp-uto-13', 'maintenance-profile-uto', 'Verificação dos rodízios', 13, CURRENT_TIMESTAMP),
  ('mp-uto-14', 'maintenance-profile-uto', 'Abastecimento de óleo Lubrax AC 100', 14, CURRENT_TIMESTAMP),
  ('mp-uto-15', 'maintenance-profile-uto', 'Pintura', 15, CURRENT_TIMESTAMP),
  ('mp-uto-16', 'maintenance-profile-uto', 'Teste', 16, CURRENT_TIMESTAMP),
  ('mp-ubp-01', 'maintenance-profile-ubp', 'Conferir engate rápido de ar', 1, CURRENT_TIMESTAMP),
  ('mp-ubp-02', 'maintenance-profile-ubp', 'Conferir o diafragma', 2, CURRENT_TIMESTAMP),
  ('mp-ubp-03', 'maintenance-profile-ubp', 'Apertar os parafusos', 3, CURRENT_TIMESTAMP),
  ('mp-ubp-04', 'maintenance-profile-ubp', 'Conferir as vedações', 4, CURRENT_TIMESTAMP),
  ('mp-ubp-05', 'maintenance-profile-ubp', 'Testar com água', 5, CURRENT_TIMESTAMP),
  ('mp-ulqr-01', 'maintenance-profile-ulq-regular', 'Verificação do sentido do giro do motor (roda sentido horário)', 1, CURRENT_TIMESTAMP),
  ('mp-ulqr-02', 'maintenance-profile-ulq-regular', 'Limpeza do tanque de alimentação', 2, CURRENT_TIMESTAMP),
  ('mp-ulqr-03', 'maintenance-profile-ulq-regular', 'Verificação do conduíte da fiação de alimentação', 3, CURRENT_TIMESTAMP),
  ('mp-ulqr-04', 'maintenance-profile-ulq-regular', 'Verificação da fiação do painel', 4, CURRENT_TIMESTAMP),
  ('mp-ulqr-05', 'maintenance-profile-ulq-regular', 'Verificação do manômetro e selo', 5, CURRENT_TIMESTAMP),
  ('mp-ulqr-06', 'maintenance-profile-ulq-regular', 'Verificação da mangueira do nível do tanque', 6, CURRENT_TIMESTAMP),
  ('mp-ulqr-07', 'maintenance-profile-ulq-regular', 'Verificação da conexão de inox e vazamentos', 7, CURRENT_TIMESTAMP),
  ('mp-ulqr-08', 'maintenance-profile-ulq-regular', 'Verificação de vazamentos no caracol', 8, CURRENT_TIMESTAMP),
  ('mp-ulqr-09', 'maintenance-profile-ulq-regular', 'Limpeza', 9, CURRENT_TIMESTAMP),
  ('mp-ulqr-10', 'maintenance-profile-ulq-regular', 'Teste', 10, CURRENT_TIMESTAMP),
  ('mp-ulqd-01', 'maintenance-profile-ulq-diesel', 'Limpeza do tanque de alimentação', 1, CURRENT_TIMESTAMP),
  ('mp-ulqd-02', 'maintenance-profile-ulq-diesel', 'Verificação do conduíte da fiação de alimentação', 2, CURRENT_TIMESTAMP),
  ('mp-ulqd-03', 'maintenance-profile-ulq-diesel', 'Verificação do manômetro e selo', 3, CURRENT_TIMESTAMP),
  ('mp-ulqd-04', 'maintenance-profile-ulq-diesel', 'Verificação da mangueira do nível do tanque', 4, CURRENT_TIMESTAMP),
  ('mp-ulqd-05', 'maintenance-profile-ulq-diesel', 'Verificação da conexão de inox e vazamentos', 5, CURRENT_TIMESTAMP),
  ('mp-ulqd-06', 'maintenance-profile-ulq-diesel', 'Verificação de vazamentos no caracol', 6, CURRENT_TIMESTAMP),
  ('mp-ulqd-07', 'maintenance-profile-ulq-diesel', 'Verificação do nível de óleo do motor e filtro do combustível', 7, CURRENT_TIMESTAMP),
  ('mp-ulqd-08', 'maintenance-profile-ulq-diesel', 'Verificar o nível de óleo Diesel', 8, CURRENT_TIMESTAMP),
  ('mp-ulqd-09', 'maintenance-profile-ulq-diesel', 'Verificar o cabo de bateria', 9, CURRENT_TIMESTAMP),
  ('mp-ulqd-10', 'maintenance-profile-ulq-diesel', 'Verificar o aditivo do radiador e o filtro', 10, CURRENT_TIMESTAMP),
  ('mp-ulqd-11', 'maintenance-profile-ulq-diesel', 'Limpeza', 11, CURRENT_TIMESTAMP),
  ('mp-ulqd-12', 'maintenance-profile-ulq-diesel', 'Teste', 12, CURRENT_TIMESTAMP),
  ('mp-tro-01', 'maintenance-profile-tro', 'Revisar a tensão (voltagem)', 1, CURRENT_TIMESTAMP),
  ('mp-tro-02', 'maintenance-profile-tro', 'Revisar plug de alimentação', 2, CURRENT_TIMESTAMP),
  ('mp-tro-03', 'maintenance-profile-tro', 'Revisar os cabos', 3, CURRENT_TIMESTAMP),
  ('mp-tro-04', 'maintenance-profile-tro', 'Limpeza', 4, CURRENT_TIMESTAMP),
  ('mp-tro-05', 'maintenance-profile-tro', 'Teste', 5, CURRENT_TIMESTAMP),
  ('mp-cmr-01', 'maintenance-profile-cmr', 'Verificação da pintura', 1, CURRENT_TIMESTAMP),
  ('mp-cmr-02', 'maintenance-profile-cmr', 'Verificação das válvulas', 2, CURRENT_TIMESTAMP),
  ('mp-cmr-03', 'maintenance-profile-cmr', 'Verificação dos manômetros', 3, CURRENT_TIMESTAMP),
  ('mp-cmr-04', 'maintenance-profile-cmr', 'Verificação do plug de alimentação', 4, CURRENT_TIMESTAMP),
  ('mp-cmr-05', 'maintenance-profile-cmr', 'Verificação do cabo elétrico', 5, CURRENT_TIMESTAMP),
  ('mp-cmr-06', 'maintenance-profile-cmr', 'Verificação da correia', 6, CURRENT_TIMESTAMP),
  ('mp-cmr-07', 'maintenance-profile-cmr', 'Verificação do filtro de ar', 7, CURRENT_TIMESTAMP),
  ('mp-cmr-08', 'maintenance-profile-cmr', 'Verificação dos rodízios', 8, CURRENT_TIMESTAMP),
  ('mp-cmr-09', 'maintenance-profile-cmr', 'Limpeza', 9, CURRENT_TIMESTAMP),
  ('mp-cmr-10', 'maintenance-profile-cmr', 'Teste', 10, CURRENT_TIMESTAMP)
ON CONFLICT ("profileId", "order") DO NOTHING;

INSERT INTO "MaintenanceConfiguration" ("id", "updatedAt")
VALUES ('global', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
