DO $$ BEGIN
  CREATE TYPE "RomaneioType" AS ENUM ('OUTBOUND', 'INBOUND');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Romaneio"
ADD COLUMN IF NOT EXISTS "type" "RomaneioType" NOT NULL DEFAULT 'OUTBOUND';

CREATE INDEX IF NOT EXISTS "Romaneio_type_idx" ON "Romaneio"("type");
CREATE INDEX IF NOT EXISTS "Romaneio_projectId_type_idx" ON "Romaneio"("projectId", "type");
