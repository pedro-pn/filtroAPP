-- Categorias existentes permanecem visíveis para preservar o comportamento atual.
-- O gestor pode desabilitar individualmente as que não exigem manutenção.
ALTER TABLE "EquipmentCategory"
ADD COLUMN "showInMaintenance" BOOLEAN NOT NULL DEFAULT true;
