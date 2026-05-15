-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ADMIN', 'INTERNAL', 'CLIENT');

-- CreateEnum
CREATE TYPE "AppModule" AS ENUM ('RDO', 'ROMANEIO', 'EPI');

-- CreateEnum
CREATE TYPE "ModuleRoleCode" AS ENUM ('RDO_MANAGER', 'RDO_COORDINATOR', 'RDO_COLLABORATOR', 'RDO_CLIENT', 'ROMANEIO_MANAGER', 'ROMANEIO_OPERATOR', 'EPI_TECHNICIAN', 'EPI_COLLABORATOR');

-- AlterTable: add accountType to User
ALTER TABLE "User" ADD COLUMN "accountType" "AccountType" NOT NULL DEFAULT 'INTERNAL';

-- CreateTable
CREATE TABLE "ModuleRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" "AppModule" NOT NULL,
    "role" "ModuleRoleCode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModuleRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModuleRole_userId_module_role_key" ON "ModuleRole"("userId", "module", "role");

-- AddForeignKey
ALTER TABLE "ModuleRole" ADD CONSTRAINT "ModuleRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: MANAGER -> ADMIN + rdo:manager
UPDATE "User" SET "accountType" = 'ADMIN' WHERE "role" = 'MANAGER';

-- Backfill: CLIENT -> CLIENT account type
UPDATE "User" SET "accountType" = 'CLIENT' WHERE "role" = 'CLIENT';

-- Backfill: COLLABORATOR and COORDINATOR stay INTERNAL (already default)

-- Backfill module roles from legacy role field
INSERT INTO "ModuleRole" ("id", "userId", "module", "role", "createdAt")
SELECT
  gen_random_uuid()::text,
  "id",
  'RDO'::"AppModule",
  'RDO_MANAGER'::"ModuleRoleCode",
  NOW()
FROM "User"
WHERE "role" = 'MANAGER'
ON CONFLICT DO NOTHING;

INSERT INTO "ModuleRole" ("id", "userId", "module", "role", "createdAt")
SELECT
  gen_random_uuid()::text,
  "id",
  'RDO'::"AppModule",
  'RDO_COORDINATOR'::"ModuleRoleCode",
  NOW()
FROM "User"
WHERE "role" = 'COORDINATOR'
ON CONFLICT DO NOTHING;

INSERT INTO "ModuleRole" ("id", "userId", "module", "role", "createdAt")
SELECT
  gen_random_uuid()::text,
  "id",
  'RDO'::"AppModule",
  'RDO_COLLABORATOR'::"ModuleRoleCode",
  NOW()
FROM "User"
WHERE "role" = 'COLLABORATOR'
ON CONFLICT DO NOTHING;

INSERT INTO "ModuleRole" ("id", "userId", "module", "role", "createdAt")
SELECT
  gen_random_uuid()::text,
  "id",
  'RDO'::"AppModule",
  'RDO_CLIENT'::"ModuleRoleCode",
  NOW()
FROM "User"
WHERE "role" = 'CLIENT'
ON CONFLICT DO NOTHING;
