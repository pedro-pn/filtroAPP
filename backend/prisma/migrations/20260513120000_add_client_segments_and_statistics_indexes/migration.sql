ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "clientSegment" TEXT;

CREATE TABLE IF NOT EXISTS "ClientSegment" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientSegment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClientSegment_label_key" ON "ClientSegment"("label");
CREATE UNIQUE INDEX IF NOT EXISTS "ClientSegment_slug_key" ON "ClientSegment"("slug");
CREATE INDEX IF NOT EXISTS "Project_clientSegment_idx" ON "Project"("clientSegment");
CREATE INDEX IF NOT EXISTS "Report_reportType_status_reportDate_idx" ON "Report"("reportType", "status", "reportDate");
CREATE INDEX IF NOT EXISTS "Report_projectId_reportType_status_reportDate_idx" ON "Report"("projectId", "reportType", "status", "reportDate");

INSERT INTO "ClientSegment" ("id", "label", "slug", "order", "createdAt", "updatedAt")
VALUES
  ('client_segment_siderurgica', 'Siderúrgica', 'siderurgica', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('client_segment_celulose_papel', 'Celulose e papel', 'celulose_papel', 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('client_segment_geracao_energia', 'Geração de energia', 'geracao_energia', 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('client_segment_farmaceutico', 'Farmacêutico', 'farmaceutico', 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('client_segment_metalurgico', 'Metalúrgico', 'metalurgico', 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('client_segment_petroquimica', 'Petroquímica', 'petroquimica', 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('client_segment_naval', 'Naval', 'naval', 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('client_segment_cimento', 'Cimento', 'cimento', 80, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('client_segment_refinaria', 'Refinaria', 'refinaria', 90, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('client_segment_automotivo', 'Automotivo', 'automotivo', 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('client_segment_mineracao', 'Mineração', 'mineracao', 110, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('client_segment_alimenticio', 'Alimentício', 'alimenticio', 120, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO UPDATE SET
  "label" = EXCLUDED."label",
  "order" = EXCLUDED."order",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
