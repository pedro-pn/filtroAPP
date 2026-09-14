CREATE TABLE "ProjectServiceSystem" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "equipment" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "equipmentKey" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "aliases" JSONB NOT NULL DEFAULT '[]',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectServiceSystem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectServiceSystem_projectId_equipmentKey_nameKey_key"
  ON "ProjectServiceSystem"("projectId", "equipmentKey", "nameKey");
CREATE INDEX "ProjectServiceSystem_projectId_idx" ON "ProjectServiceSystem"("projectId");
ALTER TABLE "ProjectServiceSystem" ADD CONSTRAINT "ProjectServiceSystem_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectPlannedServiceSystem" ADD COLUMN "projectSystemId" TEXT;
ALTER TABLE "ProjectPlannedServiceSystem" ADD CONSTRAINT "ProjectPlannedServiceSystem_projectSystemId_fkey"
  FOREIGN KEY ("projectSystemId") REFERENCES "ProjectServiceSystem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ProjectPlannedServiceSystem_projectSystemId_idx" ON "ProjectPlannedServiceSystem"("projectSystemId");
