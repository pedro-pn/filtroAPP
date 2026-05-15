CREATE TYPE "AccountType" AS ENUM ('ADMIN', 'INTERNAL', 'CLIENT');

CREATE TYPE "AppModule" AS ENUM ('RDO', 'ROMANEIO', 'EPI');

CREATE TYPE "ModuleRoleCode" AS ENUM (
  'RDO_MANAGER',
  'RDO_COORDINATOR',
  'RDO_COLLABORATOR',
  'RDO_CLIENT',
  'ROMANEIO_MANAGER',
  'ROMANEIO_OPERATOR',
  'EPI_TECHNICIAN',
  'EPI_COLLABORATOR'
);

ALTER TABLE "User" ADD COLUMN "accountType" "AccountType" NOT NULL DEFAULT 'INTERNAL';

UPDATE "User"
SET "accountType" = CASE
  WHEN "role" = 'MANAGER' THEN 'ADMIN'::"AccountType"
  WHEN "role" = 'CLIENT' THEN 'CLIENT'::"AccountType"
  ELSE 'INTERNAL'::"AccountType"
END;

CREATE TABLE "ModuleRole" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "module" "AppModule" NOT NULL,
  "role" "ModuleRoleCode" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModuleRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModuleRole_userId_module_role_key" ON "ModuleRole"("userId", "module", "role");

ALTER TABLE "ModuleRole"
ADD CONSTRAINT "ModuleRole_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ModuleRole" ("id", "userId", "module", "role")
SELECT "id" || ':RDO_MANAGER', "id", 'RDO'::"AppModule", 'RDO_MANAGER'::"ModuleRoleCode"
FROM "User"
WHERE "role" = 'MANAGER'
ON CONFLICT ("userId", "module", "role") DO NOTHING;

INSERT INTO "ModuleRole" ("id", "userId", "module", "role")
SELECT "id" || ':RDO_COORDINATOR', "id", 'RDO'::"AppModule", 'RDO_COORDINATOR'::"ModuleRoleCode"
FROM "User"
WHERE "role" = 'COORDINATOR'
ON CONFLICT ("userId", "module", "role") DO NOTHING;

INSERT INTO "ModuleRole" ("id", "userId", "module", "role")
SELECT "id" || ':RDO_COLLABORATOR', "id", 'RDO'::"AppModule", 'RDO_COLLABORATOR'::"ModuleRoleCode"
FROM "User"
WHERE "role" = 'COLLABORATOR'
ON CONFLICT ("userId", "module", "role") DO NOTHING;

INSERT INTO "ModuleRole" ("id", "userId", "module", "role")
SELECT "id" || ':RDO_CLIENT', "id", 'RDO'::"AppModule", 'RDO_CLIENT'::"ModuleRoleCode"
FROM "User"
WHERE "role" = 'CLIENT'
ON CONFLICT ("userId", "module", "role") DO NOTHING;
