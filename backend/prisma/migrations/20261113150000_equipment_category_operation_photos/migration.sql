-- Fotos do modelo de passos do Manual de Operação pertencem à categoria.
ALTER TABLE "EquipmentAttachment" ALTER COLUMN "equipmentId" DROP NOT NULL;
ALTER TABLE "EquipmentAttachment" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "EquipmentAttachment" ADD CONSTRAINT "EquipmentAttachment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EquipmentCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "EquipmentAttachment_categoryId_kind_createdAt_idx" ON "EquipmentAttachment"("categoryId", "kind", "createdAt");
