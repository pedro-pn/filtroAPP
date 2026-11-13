-- AlterTable
ALTER TABLE "Collaborator" ADD COLUMN     "admissionDateProvisional" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rhEmploymentId" TEXT,
ADD COLUMN     "rhFirstReceivedAt" TIMESTAMP(3),
ADD COLUMN     "rhStatus" TEXT;

-- CreateTable
CREATE TABLE "ConectaRhAggregate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "firstReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "localId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reasonCode" TEXT,

    CONSTRAINT "ConectaRhAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConectaRhReceipt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "versionHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reasonCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConectaRhReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConectaRhPerson" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "collaboratorId" TEXT NOT NULL,

    CONSTRAINT "ConectaRhPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConectaRhSyncState" (
    "companyId" TEXT NOT NULL,
    "cursor" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConectaRhSyncState_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE INDEX "ConectaRhAggregate_companyId_aggregateType_status_idx" ON "ConectaRhAggregate"("companyId", "aggregateType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ConectaRhAggregate_companyId_aggregateType_externalId_key" ON "ConectaRhAggregate"("companyId", "aggregateType", "externalId");

-- CreateIndex
CREATE INDEX "ConectaRhReceipt_aggregateId_revision_idx" ON "ConectaRhReceipt"("aggregateId", "revision");

-- CreateIndex
CREATE INDEX "ConectaRhReceipt_companyId_status_idx" ON "ConectaRhReceipt"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ConectaRhReceipt_companyId_eventId_key" ON "ConectaRhReceipt"("companyId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ConectaRhPerson_collaboratorId_key" ON "ConectaRhPerson"("collaboratorId");

-- CreateIndex
CREATE UNIQUE INDEX "ConectaRhPerson_companyId_personId_key" ON "ConectaRhPerson"("companyId", "personId");

-- AddForeignKey
ALTER TABLE "ConectaRhReceipt" ADD CONSTRAINT "ConectaRhReceipt_aggregateId_fkey" FOREIGN KEY ("aggregateId") REFERENCES "ConectaRhAggregate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConectaRhPerson" ADD CONSTRAINT "ConectaRhPerson_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
