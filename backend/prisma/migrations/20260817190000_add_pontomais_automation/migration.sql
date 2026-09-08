-- Audit whether a synchronization was requested manually or by the automatic bootstrap/daily job.
ALTER TABLE "PontoSyncRun"
ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'MANUAL';

-- Singleton cursor for resumable Ponto Mais history and daily synchronization.
CREATE TABLE "PontoSyncState" (
    "id" TEXT NOT NULL,
    "bootstrapStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "historyStart" DATE,
    "historyThrough" DATE,
    "nextPeriodStart" DATE,
    "lastDailySyncDate" DATE,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessfulAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PontoSyncState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PontoSyncState_bootstrapStatus_updatedAt_idx"
ON "PontoSyncState"("bootstrapStatus", "updatedAt");
