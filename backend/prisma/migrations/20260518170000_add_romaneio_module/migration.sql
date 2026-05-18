DO $$ BEGIN
  CREATE TYPE "RomaneioItemKind" AS ENUM ('EQUIPMENT', 'CONNECTION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RomaneioMeasureType" AS ENUM ('UNIT', 'LENGTH', 'WEIGHT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RomaneioCatalogSource" AS ENUM ('FILE', 'MANUAL', 'UNIT', 'PARTICLE_COUNTER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Romaneio" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "romaneioDate" TIMESTAMP(3) NOT NULL,
  "driverName" TEXT NOT NULL,
  "vehiclePlate" TEXT NOT NULL,
  "docxUrl" TEXT,
  "pdfUrl" TEXT,
  "emailStatus" TEXT,
  "emailError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Romaneio_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RomaneioCatalogItem" (
  "id" TEXT NOT NULL,
  "sourceType" "RomaneioCatalogSource" NOT NULL DEFAULT 'MANUAL',
  "sourceId" TEXT,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "categoryName" TEXT NOT NULL,
  "kind" "RomaneioItemKind" NOT NULL DEFAULT 'EQUIPMENT',
  "measureType" "RomaneioMeasureType" NOT NULL DEFAULT 'UNIT',
  "defaultUnitLabel" TEXT NOT NULL DEFAULT 'unidade',
  "isSerialized" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RomaneioCatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RomaneioItem" (
  "id" TEXT NOT NULL,
  "romaneioId" TEXT NOT NULL,
  "catalogItemId" TEXT,
  "itemName" TEXT NOT NULL,
  "itemCode" TEXT,
  "categoryName" TEXT NOT NULL,
  "kind" "RomaneioItemKind" NOT NULL DEFAULT 'EQUIPMENT',
  "measureType" "RomaneioMeasureType" NOT NULL DEFAULT 'UNIT',
  "quantity" DECIMAL(12,3) NOT NULL,
  "unitLabel" TEXT NOT NULL,
  "isCustom" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "RomaneioItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RomaneioNotificationRecipient" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  "email" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RomaneioNotificationRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Romaneio_projectId_idx" ON "Romaneio"("projectId");
CREATE INDEX IF NOT EXISTS "Romaneio_createdByUserId_idx" ON "Romaneio"("createdByUserId");
CREATE INDEX IF NOT EXISTS "Romaneio_romaneioDate_idx" ON "Romaneio"("romaneioDate");
CREATE INDEX IF NOT EXISTS "Romaneio_createdAt_idx" ON "Romaneio"("createdAt");

CREATE INDEX IF NOT EXISTS "RomaneioItem_romaneioId_idx" ON "RomaneioItem"("romaneioId");
CREATE INDEX IF NOT EXISTS "RomaneioItem_catalogItemId_idx" ON "RomaneioItem"("catalogItemId");

CREATE UNIQUE INDEX IF NOT EXISTS "RomaneioCatalogItem_sourceType_sourceId_key" ON "RomaneioCatalogItem"("sourceType", "sourceId");
CREATE UNIQUE INDEX IF NOT EXISTS "RomaneioCatalogItem_categoryName_code_name_key" ON "RomaneioCatalogItem"("categoryName", "code", "name");
CREATE INDEX IF NOT EXISTS "RomaneioCatalogItem_categoryName_idx" ON "RomaneioCatalogItem"("categoryName");
CREATE INDEX IF NOT EXISTS "RomaneioCatalogItem_kind_idx" ON "RomaneioCatalogItem"("kind");
CREATE INDEX IF NOT EXISTS "RomaneioCatalogItem_isActive_idx" ON "RomaneioCatalogItem"("isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "RomaneioNotificationRecipient_email_key" ON "RomaneioNotificationRecipient"("email");
CREATE INDEX IF NOT EXISTS "RomaneioNotificationRecipient_isActive_idx" ON "RomaneioNotificationRecipient"("isActive");

DO $$ BEGIN
  ALTER TABLE "Romaneio"
    ADD CONSTRAINT "Romaneio_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Romaneio"
    ADD CONSTRAINT "Romaneio_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "RomaneioItem"
    ADD CONSTRAINT "RomaneioItem_romaneioId_fkey"
    FOREIGN KEY ("romaneioId") REFERENCES "Romaneio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "RomaneioItem"
    ADD CONSTRAINT "RomaneioItem_catalogItemId_fkey"
    FOREIGN KEY ("catalogItemId") REFERENCES "RomaneioCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
