-- Estrutura nova e vazia: não altera relatórios, aliases, quantitativos nem vínculos existentes.
CREATE TABLE "ReportMeasurementLink" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "measurementKey" TEXT NOT NULL,
    "projectSystemId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReportMeasurementLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReportMeasurementLink_reportId_measurementKey_key" ON "ReportMeasurementLink"("reportId", "measurementKey");
ALTER TABLE "ReportMeasurementLink" ADD CONSTRAINT "ReportMeasurementLink_reportId_fkey"
    FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
