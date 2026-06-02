CREATE TABLE "AllocationReportRecipient" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationReportRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AllocationReportDelivery" (
    "id" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationReportDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AllocationReportRecipient_email_key" ON "AllocationReportRecipient"("email");
CREATE INDEX "AllocationReportRecipient_isActive_idx" ON "AllocationReportRecipient"("isActive");

CREATE UNIQUE INDEX "AllocationReportDelivery_yearMonth_key" ON "AllocationReportDelivery"("yearMonth");
CREATE INDEX "AllocationReportDelivery_sentAt_idx" ON "AllocationReportDelivery"("sentAt");
CREATE INDEX "AllocationReportDelivery_status_idx" ON "AllocationReportDelivery"("status");
