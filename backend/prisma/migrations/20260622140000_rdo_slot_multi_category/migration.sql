-- Slots de RDO passam a aceitar múltiplas categorias por slot.
ALTER TABLE "RdoEquipmentSlot" ADD COLUMN "categoryIds" JSONB NOT NULL DEFAULT '[]';

-- Migra o vínculo único existente (categoryId) para o array.
UPDATE "RdoEquipmentSlot"
  SET "categoryIds" = to_jsonb(ARRAY["categoryId"])
  WHERE "categoryId" IS NOT NULL;
