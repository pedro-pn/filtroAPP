ALTER TABLE "Project"
ADD COLUMN "inhibitionServiceEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "InhibitionVessel" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InhibitionVessel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InhibitionSystem" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "diagram" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InhibitionSystem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InhibitionVessel_code_key" ON "InhibitionVessel"("code");
CREATE UNIQUE INDEX "InhibitionSystem_code_key" ON "InhibitionSystem"("code");

INSERT INTO "InhibitionVessel" ("id", "code", "order", "updatedAt") VALUES
  ('inhibition-vessel-51632', '51632', 0, CURRENT_TIMESTAMP),
  ('inhibition-vessel-51633', '51633', 1, CURRENT_TIMESTAMP),
  ('inhibition-vessel-51634', '51634', 2, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "order" = EXCLUDED."order",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
