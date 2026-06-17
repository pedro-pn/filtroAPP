-- Enums: novos valores para o módulo Equipamentos
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'EQUIPAMENTOS';
ALTER TYPE "ModuleRoleCode" ADD VALUE IF NOT EXISTS 'EQUIPAMENTOS_MANAGER';
ALTER TYPE "ModuleRoleCode" ADD VALUE IF NOT EXISTS 'EQUIPAMENTOS_VIEWER';
ALTER TYPE "RomaneioCatalogSource" ADD VALUE IF NOT EXISTS 'EQUIPAMENTOS';

-- Novo enum para tipos de anexo
CREATE TYPE "EquipmentAttachmentKind" AS ENUM ('CALIBRATION_CERTIFICATE', 'TECHNICAL_DOC');

-- Categorias de equipamento (abas configuráveis)
CREATE TABLE "EquipmentCategory" (
    "id" TEXT NOT NULL,
    "systemKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "fieldSchema" JSONB NOT NULL DEFAULT '[]',
    "supportsCalibration" BOOLEAN NOT NULL DEFAULT false,
    "supportsTechnicalDoc" BOOLEAN NOT NULL DEFAULT true,
    "syncToRomaneio" BOOLEAN NOT NULL DEFAULT false,
    "isSystemManaged" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EquipmentCategory_systemKey_key" ON "EquipmentCategory"("systemKey");

-- Equipamentos da empresa (modelo unificado)
CREATE TABLE "CompanyEquipment" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "hasCalibration" BOOLEAN NOT NULL DEFAULT false,
    "calibratedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "hasTechnicalDoc" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyEquipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyEquipment_code_key" ON "CompanyEquipment"("code");
CREATE INDEX "CompanyEquipment_categoryId_idx" ON "CompanyEquipment"("categoryId");
CREATE INDEX "CompanyEquipment_expiresAt_idx" ON "CompanyEquipment"("expiresAt");

-- Anexos (certificados de calibração e documentação técnica)
CREATE TABLE "EquipmentAttachment" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "kind" "EquipmentAttachmentKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "storagePath" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EquipmentAttachment_publicToken_key" ON "EquipmentAttachment"("publicToken");
CREATE INDEX "EquipmentAttachment_equipmentId_kind_createdAt_idx" ON "EquipmentAttachment"("equipmentId", "kind", "createdAt");

-- Chaves estrangeiras
ALTER TABLE "CompanyEquipment" ADD CONSTRAINT "CompanyEquipment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EquipmentCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EquipmentAttachment" ADD CONSTRAINT "EquipmentAttachment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "CompanyEquipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
