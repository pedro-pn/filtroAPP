CREATE TABLE "StockItemDocument" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
  "storagePath" TEXT,
  "publicToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StockItemDocument_pkey" PRIMARY KEY ("id")
);

INSERT INTO "StockItemDocument" (
  "id",
  "itemId",
  "fileName",
  "mimeType",
  "storagePath",
  "publicToken",
  "createdAt"
)
SELECT
  'legacy-fispq-' || "id",
  "id",
  'FISPQ - ' || "code" || ' - ' || "name" || '.pdf',
  'application/pdf',
  NULL,
  "fispqToken",
  "createdAt"
FROM "StockItem"
WHERE "fispqToken" IS NOT NULL AND btrim("fispqToken") <> '';

CREATE UNIQUE INDEX "StockItemDocument_publicToken_key"
  ON "StockItemDocument"("publicToken");

CREATE INDEX "StockItemDocument_itemId_createdAt_idx"
  ON "StockItemDocument"("itemId", "createdAt");

ALTER TABLE "StockItemDocument"
  ADD CONSTRAINT "StockItemDocument_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockItem" DROP COLUMN "fispqToken";
