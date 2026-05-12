-- AddColumn
ALTER TABLE "ReportVersion" ADD COLUMN IF NOT EXISTS "validationCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReportVersion_validationCode_key" ON "ReportVersion"("validationCode");
