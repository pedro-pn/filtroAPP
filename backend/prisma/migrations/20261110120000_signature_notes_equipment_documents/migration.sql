ALTER TABLE "ReportSignature" ADD COLUMN "clientComment" TEXT;
ALTER TABLE "EquipmentCategory" ADD COLUMN "attachmentsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TYPE "EquipmentAttachmentKind" ADD VALUE 'DOCUMENT';
