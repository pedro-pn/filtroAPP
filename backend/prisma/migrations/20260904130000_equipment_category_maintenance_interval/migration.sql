-- O prazo preventivo pertence à categoria e é aplicado a todos os seus
-- equipamentos. NULL mantém categorias sem programação configurada.
ALTER TABLE "EquipmentCategory"
ADD COLUMN "maintenanceIntervalDays" INTEGER;

ALTER TABLE "EquipmentCategory"
ADD CONSTRAINT "EquipmentCategory_maintenanceIntervalDays_check"
CHECK (
  "maintenanceIntervalDays" IS NULL
  OR "maintenanceIntervalDays" BETWEEN 1 AND 3650
);
