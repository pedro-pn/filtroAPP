-- Pilar 10: contadores de uso por período (teto da OpenAI e sinais de abuso).
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsageCounter_kind_subject_periodStart_key" ON "UsageCounter"("kind", "subject", "periodStart");

CREATE INDEX "UsageCounter_kind_periodStart_idx" ON "UsageCounter"("kind", "periodStart");
