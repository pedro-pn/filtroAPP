CREATE TABLE "ProjectRealizedCorrection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "measureDate" DATE NOT NULL,
    "serviceType" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "sourceQuantityM" DECIMAL(14,2) NOT NULL,
    "quantityM" DECIMAL(14,2),
    "reason" VARCHAR(1000) NOT NULL,
    "reference" VARCHAR(500),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectRealizedCorrection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectRealizedCorrection_projectId_measureDate_serviceType_revision_key"
ON "ProjectRealizedCorrection"("projectId", "measureDate", "serviceType", "revision");

CREATE INDEX "ProjectRealizedCorrection_projectId_measureDate_idx"
ON "ProjectRealizedCorrection"("projectId", "measureDate");

ALTER TABLE "ProjectRealizedCorrection" ADD CONSTRAINT "ProjectRealizedCorrection_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
