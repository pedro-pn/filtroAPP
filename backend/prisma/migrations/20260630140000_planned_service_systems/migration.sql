-- Serviços previstos passam a agrupar "sistemas" (tubulações/tanques/óleo), cada um com quantitativo.

-- AlterEnum: nova unidade (toneladas)
ALTER TYPE "PlannedMeasureUnit" ADD VALUE 'T';

-- CreateTable
CREATE TABLE "ProjectPlannedServiceSystem" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "systemType" TEXT NOT NULL,
    "quantity" DECIMAL(14,2),
    "unit" "PlannedMeasureUnit",
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProjectPlannedServiceSystem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectPlannedServiceSystem_serviceId_idx" ON "ProjectPlannedServiceSystem"("serviceId");

-- AddForeignKey
ALTER TABLE "ProjectPlannedServiceSystem" ADD CONSTRAINT "ProjectPlannedServiceSystem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ProjectPlannedService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropColumns: o quantitativo migra para ProjectPlannedServiceSystem
ALTER TABLE "ProjectPlannedService" DROP COLUMN "tubingQty";
ALTER TABLE "ProjectPlannedService" DROP COLUMN "tubingUnit";
ALTER TABLE "ProjectPlannedService" DROP COLUMN "oilLiters";
ALTER TABLE "ProjectPlannedService" DROP COLUMN "reservoirQty";
ALTER TABLE "ProjectPlannedService" DROP COLUMN "reservoirUnit";
