CREATE TABLE "PontoExternalEmployee" (
    "externalEmployeeId" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "externalName" TEXT NOT NULL,
    "isActive" BOOLEAN,
    "ignoredAt" TIMESTAMP(3),
    "ignoredByUserId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PontoExternalEmployee_pkey" PRIMARY KEY ("externalEmployeeId")
);

CREATE INDEX "PontoExternalEmployee_ignoredAt_externalName_idx"
ON "PontoExternalEmployee"("ignoredAt", "externalName");

INSERT INTO "PontoExternalEmployee" (
    "externalEmployeeId",
    "registrationNumber",
    "externalName",
    "firstSeenAt",
    "lastSeenAt",
    "createdAt",
    "updatedAt"
)
SELECT DISTINCT ON (period."externalEmployeeId")
    period."externalEmployeeId",
    period."registrationNumber",
    period."rawName",
    MIN(period."createdAt") OVER (PARTITION BY period."externalEmployeeId"),
    MAX(period."createdAt") OVER (PARTITION BY period."externalEmployeeId"),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "PontoPeriodSummary" AS period
WHERE period."externalEmployeeId" IS NOT NULL
ORDER BY period."externalEmployeeId", period."createdAt" DESC;
