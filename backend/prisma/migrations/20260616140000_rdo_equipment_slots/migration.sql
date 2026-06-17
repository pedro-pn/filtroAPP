-- Mapeamento configurável de slots de equipamento do RDO -> categoria
CREATE TABLE "RdoEquipmentSlot" (
    "id" TEXT NOT NULL,
    "slotKey" TEXT NOT NULL,
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RdoEquipmentSlot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RdoEquipmentSlot_slotKey_key" ON "RdoEquipmentSlot"("slotKey");
CREATE INDEX "RdoEquipmentSlot_categoryId_idx" ON "RdoEquipmentSlot"("categoryId");
