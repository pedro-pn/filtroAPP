-- Preserva as categorias atuais, inclusive as listas com categorias misturadas.
ALTER TABLE "RdoEquipmentSlot" ADD COLUMN "secondaryCategoryIds" JSONB NOT NULL DEFAULT '[]';
