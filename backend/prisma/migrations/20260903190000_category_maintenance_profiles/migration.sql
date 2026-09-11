-- Um perfil padrão por categoria reduz a configuração repetitiva. O booleano
-- diferencia "herdar da categoria" de uma exceção individual sem perfil.
ALTER TABLE "EquipmentCategory"
ADD COLUMN "maintenanceProfileId" TEXT;

ALTER TABLE "CompanyEquipment"
ADD COLUMN "maintenanceProfileOverride" BOOLEAN NOT NULL DEFAULT false;

-- Vínculos individuais anteriores continuam sendo exceções explícitas.
UPDATE "CompanyEquipment"
SET "maintenanceProfileOverride" = true
WHERE "maintenanceProfileId" IS NOT NULL;

CREATE INDEX "EquipmentCategory_maintenanceProfileId_idx"
ON "EquipmentCategory"("maintenanceProfileId");

ALTER TABLE "EquipmentCategory"
ADD CONSTRAINT "EquipmentCategory_maintenanceProfileId_fkey"
FOREIGN KEY ("maintenanceProfileId") REFERENCES "MaintenanceProfile"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
