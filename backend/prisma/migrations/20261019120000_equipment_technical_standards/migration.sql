BEGIN;

CREATE TABLE "EquipmentTechnicalStandard" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "technicalSchema" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EquipmentTechnicalStandard_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EquipmentCategory" ADD COLUMN "technicalStandardId" TEXT;
CREATE INDEX "EquipmentCategory_technicalStandardId_idx" ON "EquipmentCategory"("technicalStandardId");
ALTER TABLE "EquipmentCategory" ADD CONSTRAINT "EquipmentCategory_technicalStandardId_fkey"
    FOREIGN KEY ("technicalStandardId") REFERENCES "EquipmentTechnicalStandard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Copia integralmente cada definição, incluindo categorias inativas ou com a aba
-- técnica desabilitada. Não normaliza chaves nem mescla esquemas semelhantes.
INSERT INTO "EquipmentTechnicalStandard" ("id", "name", "technicalSchema", "createdAt", "updatedAt")
SELECT 'ets_' || "id", "name", "technicalSchema", "createdAt", "updatedAt"
FROM "EquipmentCategory"
WHERE "technicalSchema" <> '[]'::jsonb;

UPDATE "EquipmentCategory"
SET "technicalStandardId" = 'ets_' || "id"
WHERE "technicalSchema" <> '[]'::jsonb;

-- technicalSchema permanece como cópia compatível para os consumidores existentes.
-- Valores, revisões, fotos, anexos e modelos DOCX dos equipamentos não são alterados.
COMMIT;
