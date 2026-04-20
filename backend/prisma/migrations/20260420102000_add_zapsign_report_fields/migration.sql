ALTER TABLE "Report"
ADD COLUMN "zapsignDocToken" TEXT,
ADD COLUMN "zapsignSignerToken" TEXT,
ADD COLUMN "zapsignRequestedAt" TIMESTAMP(3),
ADD COLUMN "zapsignSignedAt" TIMESTAMP(3),
ADD COLUMN "zapsignDocUrl" TEXT;
