-- Dados Técnicos configuráveis por categoria (datasheet estruturado + geração DOCX→PDF)

-- Novos valores do enum de tipo de anexo
ALTER TYPE "EquipmentAttachmentKind" ADD VALUE IF NOT EXISTS 'TECHNICAL_TEMPLATE';
ALTER TYPE "EquipmentAttachmentKind" ADD VALUE IF NOT EXISTS 'TECHNICAL_DOC_GENERATED';

-- Schema técnico e modelo DOCX por categoria
ALTER TABLE "EquipmentCategory" ADD COLUMN "technicalSchema" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "EquipmentCategory" ADD COLUMN "technicalDocEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EquipmentCategory" ADD COLUMN "technicalTemplateId" TEXT;

-- Valores do datasheet por equipamento
ALTER TABLE "CompanyEquipment" ADD COLUMN "technicalData" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "CompanyEquipment" ADD COLUMN "technicalFieldOverrides" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "CompanyEquipment" ADD COLUMN "technicalRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CompanyEquipment" ADD COLUMN "technicalUpdatedAt" TIMESTAMP(3);
