-- Tabela de segmentos de clientes
CREATE TABLE IF NOT EXISTS "ClientSegment" (
    "id"        TEXT NOT NULL,
    "label"     TEXT NOT NULL,
    "slug"      TEXT NOT NULL,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "order"     INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientSegment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClientSegment_label_key" ON "ClientSegment"("label");
CREATE UNIQUE INDEX IF NOT EXISTS "ClientSegment_slug_key" ON "ClientSegment"("slug");

-- Campo de segmento no Projeto
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "clientSegment" TEXT;

-- Índices de performance para consultas de estatísticas
CREATE INDEX IF NOT EXISTS "Report_reportType_status_reportDate_idx" ON "Report"("reportType", "status", "reportDate");
CREATE INDEX IF NOT EXISTS "Report_projectId_reportType_status_reportDate_idx" ON "Report"("projectId", "reportType", "status", "reportDate");
