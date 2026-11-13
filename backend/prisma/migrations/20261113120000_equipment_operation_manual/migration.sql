ALTER TYPE "EquipmentAttachmentKind" ADD VALUE 'OPERATION_MANUAL_GENERATED';

ALTER TABLE "EquipmentCategory" ADD COLUMN "operationSteps" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "CompanyEquipment"
  ADD COLUMN "operationSteps" JSONB,
  ADD COLUMN "operationRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "operationUpdatedAt" TIMESTAMP(3);
